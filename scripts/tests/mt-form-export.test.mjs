import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const formExport = require("../../modules/mt-form-export.js");

const names = { "e-fm": "ผจก. โรงงาน", "e-gm": "ผจก. ทั่วไป" };
const nameOf = (id) => names[id] ?? "";
const baseRequest = (extra = {}) => ({
  request_no: "BG026/26", doc_type: "request", department: { code: "BG" },
  machine_code: "ไม่มี", machine_name: "ไม่มี", description: "ทำที่บังแดด",
  submitted_at: "2026-10-21T04:50:00Z", needed_date: "2026-10-21", requester_name: "จุฑารัตน์ ท่าฉลาด",
  received_by_name: "ยุทธไพศาล", assigned_at: "2026-10-21T07:00:00Z", work_expected_date: "2026-10-23",
  execution_plan: "use_existing", inspector_opinion: "self_repair", cause_analysis: "แดดส่อง",
  parts_used_items: [{ name: "ผ้าใบ", qty: "2", unit: "ผืน", price: "300", shop: "ร้าน ก", note: "" }],
  ...extra,
});
const steps = [
  { step_order: 1, step_name: "ผู้จัดการโรงงาน", status: "approved", acted_by: "e-fm", acted_at: "2026-10-21T05:00:00Z" },
  { step_order: 2, step_name: "ผู้จัดการทั่วไป", status: "approved", acted_by: "e-gm", acted_at: "2026-10-21T06:00:00Z" },
];
const history = [
  { to_status: "pending_verify", created_at: "2026-10-22T09:36:00Z" },
  { to_status: "in_progress", created_at: "2026-10-21T08:00:00Z" },
];
const build = (extra = {}, more = {}) => formExport.buildMtFormCells({
  request: baseRequest(extra), steps, history, technicianNames: ["ศักดา สนผา", "ไกรทอง มีผักไหม"], nameOf,
  verifications: [{ result: "pass", created_at: "2026-10-22T09:40:00Z" }], ...more,
});

test("dates use the paper form's dd/MM/yy Buddhist-era format in Bangkok time", () => {
  assert.equal(formExport.formDate("2026-10-21T17:30:00Z"), "22/10/69");
  assert.equal(formExport.formDate("2026-10-21"), "21/10/69");
  assert.equal(formExport.formTime("2026-10-21T04:50:00Z"), "11:50");
  assert.equal(formExport.formDate(null), "");
  assert.equal(formExport.formDate("not a date"), "");
});

test("a finished request fills every section of the form", () => {
  const { fileName, cells } = build();
  assert.equal(fileName, "BG026-26.xlsx");
  assert.equal(cells.AG4, "BG026/26");
  assert.equal(cells.B6, true);
  assert.equal(cells.G6, false);
  assert.equal(cells.F7, "21/10/69 11:50");
  assert.equal(cells.P7, "21/10/69");
  assert.equal(cells.X8, "BG");
  assert.equal(cells.K15, true);
  assert.equal(cells.U15, false);
  assert.equal(cells.B19, "ลงชื่อ  ผจก. โรงงาน  ฝ่ายบริหารโรงงาน");
  assert.equal(cells.T20, "21/10/69");
  assert.equal(cells.K23, "ช่างชื่อ  ศักดา สนผา, ไกรทอง มีผักไหม");
  assert.deepEqual([cells.U23, cells.U24, cells.U25], [false, false, true]);
  assert.deepEqual([cells.L28, cells.Q28, cells.Y28, cells.AC28], [false, false, true, false]);
  assert.deepEqual([cells.B31, cells.D31, cells.T31, cells.X31, cells.Z31, cells.AC31], ["1", "ผ้าใบ", "2", "ผืน", "300", "ร้าน ก"]);
  assert.equal(cells.D32, "");
  assert.equal(cells.B36, "วันที่  21/10/69");
  assert.equal(cells.B37, "เวลา  15:00");
  assert.equal(cells.K37, "เวลา  16:36");
  assert.deepEqual([cells.V36, cells.Y36], ["1", "1"]);
  assert.equal(cells.C39, true);
  assert.equal(cells.T40, "วันที่  22/10/69");
});

test("every cell stays inside the form area A1:AJ41 and holds text or a tick", () => {
  const { cells } = build();
  for (const [a1, value] of Object.entries(cells)) {
    const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(a1);
    const col = [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    assert.ok(col <= 36 && Number(row) <= 41, a1);
    assert.ok(typeof value === "string" || typeof value === "boolean", a1);
  }
});

test("a new request clears the template's sample values", () => {
  const { cells } = build({
    received_by_name: null, assigned_at: null, work_expected_date: null, execution_plan: null,
    inspector_opinion: null, cause_analysis: null, parts_used_items: [], parts_used: null,
  }, { steps: [{ step_order: 1, step_name: "ผู้จัดการโรงงาน", status: "pending" }], history: [], verifications: [], technicianNames: [] });
  assert.equal(cells.K15, false);
  assert.equal(cells.B19, "ลงชื่อ ________________________ ฝ่ายบริหารโรงงาน");
  assert.equal(cells.B20, "");
  assert.equal(cells.T20, "");
  for (const row of formExport.PART_ROWS) assert.equal(cells[`D${row}`], "");
  assert.equal(cells.V36, "");
  assert.equal(cells.AB37, "วันที่ ");
  assert.equal(cells.C39, false);
  assert.equal(cells.T40, "วันที่ ");
});

test("a rejected step ticks 'not approved' and a failed verification ticks 'send back'", () => {
  const { cells } = build({}, {
    steps: [{ step_order: 1, step_name: "ผู้จัดการโรงงาน", status: "rejected", acted_by: "e-fm", acted_at: "2026-10-21T05:00:00Z" }],
    verifications: [{ result: "fail", created_at: "2026-10-22T10:00:00Z" }],
  });
  assert.equal(cells.K15, false);
  assert.equal(cells.U15, true);
  assert.equal(cells.C39, false);
  assert.equal(cells.C40, true);
});

test("a request without a factory manager puts the general manager in the general manager box", () => {
  const { cells } = build({}, {
    steps: [{ step_order: 1, step_name: "ผู้จัดการทั่วไป", status: "approved", acted_by: "e-gm", acted_at: "2026-10-21T06:00:00Z" }],
  });
  assert.equal(cells.K15, true);
  assert.equal(cells.B19, "ลงชื่อ ________________________ ฝ่ายบริหารโรงงาน");
  assert.equal(cells.T19, "ลงชื่อ  ผจก. ทั่วไป  ผู้จัดการทั่วไป");
  assert.equal(cells.B20, "");
  assert.equal(cells.T20, "21/10/69");
});

test("old requests with only parts_used text and more than four parts still fit the four rows", () => {
  assert.equal(build({ parts_used_items: null, parts_used: "ลูกปืน 6204" }).cells.D31, "ลูกปืน 6204");
  const parts = Array.from({ length: 6 }, (_, index) => ({ name: `รายการ ${index + 1}` }));
  const { cells } = build({ parts_used_items: parts });
  assert.equal(cells.D33, "รายการ 3");
  assert.equal(cells.D34, "และอีก 3 รายการ (ดูในระบบ)");
});

test("work times use the first start and the last hand-over after a failed verification", () => {
  const times = formExport.workTimes([
    { to_status: "in_progress", created_at: "2026-10-21T08:00:00Z" },
    { to_status: "pending_verify", created_at: "2026-10-21T09:00:00Z" },
    { to_status: "in_progress", created_at: "2026-10-21T10:00:00Z" },
    { to_status: "pending_verify", created_at: "2026-10-22T11:00:00Z" },
  ]);
  assert.deepEqual(times, { startedAt: "2026-10-21T08:00:00Z", finishedAt: "2026-10-22T11:00:00Z" });
  assert.deepEqual(formExport.workTimes([]), { startedAt: null, finishedAt: null });
});

test("requestXlsx posts the cells and turns the base64 reply into an xlsx blob", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return { ok: true, json: async () => ({ ok: true, base64: Buffer.from("PK").toString("base64") }) };
  };
  const blob = await formExport.requestXlsx({ cells: { AG4: "X" }, fileName: "X.xlsx" }, fetchImpl, "https://example.test/exec");
  assert.equal(sent.init.method, "POST");
  assert.equal(sent.init.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.deepEqual(JSON.parse(sent.init.body).cells, { AG4: "X" });
  assert.equal(blob.size, 2);
  await assert.rejects(formExport.requestXlsx({}, fetchImpl, ""), /ยังไม่ได้ตั้งค่า/);
  await assert.rejects(formExport.requestXlsx({}, async () => { throw new TypeError("Failed to fetch"); }, "u"), /เชื่อมต่อ/);
  await assert.rejects(formExport.requestXlsx({}, async () => ({ ok: true, json: async () => ({ ok: false, error: "NOT_CONFIGURED" }) }), "u"), /ไม่สำเร็จ \(NOT_CONFIGURED\)/);
  await assert.rejects(formExport.requestXlsx({}, async () => ({ ok: true, json: async () => ({ ok: false, error: "FAILED_EXPORT_403" }) }), "u"), /\(FAILED_EXPORT_403\)/);
  await assert.rejects(formExport.requestXlsx({}, async () => ({ ok: true, json: async () => ({ ok: false, error: "<b>x</b>" }) }), "u"), /\(HTTP_undefined\)|\(HTTP_/);
  await assert.rejects(formExport.requestXlsx({}, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("html"); } }), "u"), /\(HTTP_200\)/);
});

test("the export web app is its own project, not one of the sheet sync web apps", () => {
  assert.match(formExport.EXPORT_URL, /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
  for (const file of ["module-mt.js", "module-mg.js", "ncr-sheet-sync.js"]) {
    const source = readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8");
    assert.ok(!source.includes(formExport.EXPORT_URL), `EXPORT_URL ซ้ำกับ URL ใน ${file}`);
  }
});

/* ---------- Apps Script ---------- */

const gsSource = readFileSync(new URL("../../apps-script/mt-form-export/Code.gs", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(gsSource, context);
const gs = vm.runInContext("({ validateCells_, safeFileName_, errorCode_ })", context);

test("the Apps Script accepts only text or ticks inside A1:AJ41", () => {
  const { cells } = build();
  assert.equal(Object.keys(gs.validateCells_(cells)).length, Object.keys(cells).length);
  for (const bad of [null, [], {}, { AK1: "x" }, { A42: "x" }, { A0: "x" }, { a1: "x" }, { A1: 1 }, { A1: { x: 1 } }, { "Sheet!A1": "x" }]) {
    assert.throws(() => gs.validateCells_(bad), /BAD_CELLS/, JSON.stringify(bad));
  }
  assert.equal(gs.validateCells_({ B10: "x".repeat(9000) }).B10.length, 5000);
  assert.equal(gs.validateCells_({ B10: "=IMPORTRANGE(1)" }).B10, "'=IMPORTRANGE(1)");
  assert.equal(gs.validateCells_({ B10: "- ไฟเสีย" }).B10, "- ไฟเสีย");
  assert.equal(gs.validateCells_({ B10: "+66 81" }).B10, "+66 81");
});

test("the Apps Script keeps a safe file name and hides raw errors", () => {
  assert.equal(gs.safeFileName_("BG026-26.xlsx"), "BG026-26.xlsx");
  assert.equal(gs.safeFileName_("../../x"), "MT01-FM05.xlsx");
  assert.equal(gs.errorCode_(new Error("BAD_CELLS")), "BAD_CELLS");
  assert.equal(gs.errorCode_(new Error("Exception: file 1abc not found"), "COPY"), "FAILED_COPY");
  assert.equal(gs.errorCode_(new Error("EXPORT_HTTP_403"), "EXPORT"), "FAILED_EXPORT_403");
  assert.equal(gs.errorCode_(new Error("NOT_CONFIGURED"), "INPUT"), "NOT_CONFIGURED");
});

