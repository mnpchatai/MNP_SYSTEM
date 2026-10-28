import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const sheet = require("../../modules/qc-sheet.js");
const model = require("../../modules/qc-model.js");

const plain = (value) => JSON.parse(JSON.stringify(value));
const record = (change = {}) => ({
  id: "9f0c2f52-1111-4222-8333-444455556666", reportNo: "QC-26-001", isTest: false, status: "approved", statusLabel: "อนุมัติแล้ว", result: "ok", resultLabel: "ผ่าน (OK)",
  partNumber: "P-100", partName: "ยางรอง", customer: "ลูกค้า", orderNo: "SO-1", code: "C1", sampleLabel: "2M", lots: "L1, L2", inspector: "สมชาย ใจดี",
  inspectedAt: "2026-10-27 09:30", remark: "หมายเหตุ", ncrNo: "",
  approvals: {
    qa: { status: "approved", name: "สมหญิง", date: "2026-10-27 10:00", comment: "" },
    factory: { status: "approved", name: "ผจก โรงงาน", date: "2026-10-27 11:00", comment: "" },
    gm: { status: "approved", name: "ผจก ทั่วไป", date: "2026-10-27 12:00", comment: "" },
  },
  items: [
    { itemNo: "A", name: "ความหนา", instrument: "Caliper", unit: "mm", specMin: 12, specStd: 13, specMax: 14, points: [12.5, 13], min: 12.5, max: 13, avg: 12.75, judge: "O", note: "" },
    { itemNo: "D", name: "รูปร่าง", instrument: "", unit: "", specMin: null, specStd: null, specMax: null, points: [1], min: 1, max: 1, avg: 1, judge: "NA", note: "ตรวจด้วยตา" },
  ],
  ...change,
});

/* ---------- ฝั่งเว็บ ---------- */

test("nothing is sent without a URL", () => {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url, init }); return Promise.resolve(); };
  assert.equal(sheet.sync(record(), { url: "", fetchImpl }), false);
  assert.equal(calls.length, 0);
  assert.equal(sheet.sync(record(), { fetchImpl }), Boolean(sheet.SYNC_URL), "the default URL is the SYNC_URL constant");
});

test("sync posts the record as a text/plain no-cors batch keyed by the report id", () => {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url, init }); return Promise.resolve(); };
  assert.equal(sheet.sync(record(), { url: "https://x.test/exec", fetchImpl }), true);
  assert.equal(calls[0].url, "https://x.test/exec");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.mode, "no-cors");
  assert.equal(calls[0].init.headers["Content-Type"], "text/plain;charset=utf-8");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.batch.length, 1);
  assert.equal(body.batch[0].key, `qc:${record().id}`);
  assert.equal(JSON.parse(body.batch[0].value).reportNo, "QC-26-001");
  assert.equal(sheet.sync(record({ id: "" }), { url: "https://x.test/exec", fetchImpl }), false, "a record without an id is not sent");
  assert.equal(sheet.sync(record({ reportNo: "" }), { url: "https://x.test/exec", fetchImpl }), false);
});

test("a failed copy is only logged", async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    sheet.sync(record(), { url: "https://x.test/exec", fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")) });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
});

test("requestXlsx posts the record and turns the base64 reply into an xlsx blob", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return { ok: true, status: 200, json: async () => ({ ok: true, base64: Buffer.from("PK-fake").toString("base64") }) };
  };
  const payload = model.buildFormExport({ report_no: "QC-26-001", items: [], approvals: [] });
  const blob = await sheet.requestXlsx(payload, fetchImpl, "https://example.test/exec");
  assert.equal(sent.url, "https://example.test/exec");
  assert.equal(sent.init.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.equal(JSON.parse(sent.init.body).form, "qc");
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(await blob.text(), "PK-fake");
});

test("requestXlsx explains each failure", async () => {
  await assert.rejects(sheet.requestXlsx({}, async () => ({}), ""), /ยังไม่ได้ตั้งค่า/);
  await assert.rejects(sheet.requestXlsx({}, async () => { throw new TypeError("Failed to fetch"); }, "u"), /เชื่อมต่อ/);
  await assert.rejects(sheet.requestXlsx({}, async () => ({ ok: true, json: async () => ({ ok: false, error: "BAD_RECORD" }) }), "u"), /\(BAD_RECORD\)/);
  await assert.rejects(sheet.requestXlsx({}, async () => ({ ok: true, json: async () => ({ ok: false, error: "<b>x</b>" }) }), "u"), /\(HTTP_/);
  await assert.rejects(sheet.requestXlsx({}, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("html"); } }), "u"), /\(HTTP_200\)/);
});

test("the Web App URLs, once set, look like an Apps Script deployment and belong to this project only", () => {
  const URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
  const urls = [sheet.EXPORT_URL, sheet.SYNC_URL].filter(Boolean);
  for (const url of urls) {
    assert.match(url, URL_PATTERN);
    for (const file of readdirSync(new URL("../../modules/", import.meta.url)).filter((name) => name.endsWith(".js") && name !== "qc-sheet.js")) {
      assert.ok(!readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8").includes(url), `QC URL reused in ${file}`);
    }
  }
  if (sheet.EXPORT_URL && sheet.SYNC_URL) assert.equal(sheet.EXPORT_URL, sheet.SYNC_URL, "one Apps Script project serves both jobs");
});

/* ---------- Apps Script ---------- */

const source = readFileSync(new URL("../../apps-script/qc-sheet/Code.gs", import.meta.url), "utf8");
function load(globals = {}) {
  const context = vm.createContext({ console: { log() {}, error() {} }, ...globals });
  vm.runInContext(source, context);
  return context;
}
const gs = load();
const call = (name, ...args) => vm.runInContext(name, gs)(...args);

test("parseRecord_ accepts only well-formed records with a matching test marker", () => {
  const raw = (change) => JSON.stringify(record(change));
  assert.equal(call("parseRecord_", raw()).reportNo, "QC-26-001");
  assert.equal(call("parseRecord_", ""), null);
  assert.equal(call("parseRecord_", "not json"), null);
  assert.equal(call("parseRecord_", "[]"), null);
  assert.equal(call("parseRecord_", raw({ id: "short" })), null);
  assert.equal(call("parseRecord_", raw({ reportNo: "" })), null);
  assert.equal(call("parseRecord_", raw({ reportNo: "x".repeat(51) })), null);
  assert.equal(call("parseRecord_", "x".repeat(49001)), null);
  assert.equal(call("parseRecord_", raw({ isTest: true, reportNo: "TEST-QC-26-001" })).isTest, true);
  assert.equal(call("parseRecord_", raw({ isTest: true, reportNo: "QC-26-001" })), null, "a test flag needs a TEST- number");
  assert.equal(call("parseRecord_", raw({ isTest: false, reportNo: "TEST-QC-26-001" })), null, "a real report cannot use a TEST- number");
});

test("the Apps Script honours ACCEPT_TEST_REPORTS", () => {
  const strict = load();
  vm.runInContext("ACCEPT_TEST_REPORTS = false", strict);
  assert.equal(vm.runInContext("parseRecord_", strict)(JSON.stringify(record({ isTest: true, reportNo: "TEST-QC-26-001" }))), null);
});

test("validateExportRecord_ keeps the form data and refuses malformed records", () => {
  const clean = plain(call("validateExportRecord_", record()));
  assert.equal(clean.reportNo, "QC-26-001");
  assert.equal(clean.items.length, 2);
  assert.equal(clean.items[1].specMin, null);
  assert.equal(clean.approvals.gm.name, "ผจก ทั่วไป");
  assert.equal(call("validateExportRecord_", record({ remark: "=IMPORTRANGE(1)" })).remark, "'=IMPORTRANGE(1)", "formulas become text");
  assert.equal(call("validateExportRecord_", record({ remark: "x".repeat(9000) })).remark.length, 5000);
  const bad = (change) => assert.throws(() => call("validateExportRecord_", change), /BAD_RECORD/);
  bad(null);
  bad([]);
  bad(record({ reportNo: "" }));
  bad(record({ items: "x" }));
  bad(record({ items: Array.from({ length: 31 }, () => record().items[0]) }));
  bad(record({ items: [{ ...record().items[0], itemNo: "a1" }] }));
  bad(record({ items: [{ ...record().items[0], judge: "ZZ" }] }));
  bad(record({ items: [{ ...record().items[0], points: [1, 2, 3, 4, 5, 6] }] }));
  bad(record({ items: [{ ...record().items[0], points: ["1"] }] }));
  bad(record({ items: [{ ...record().items[0], avg: Infinity }] }));
  bad(record({ customer: { x: 1 } }));
  assert.equal(call("validateExportRecord_", record({ items: Array.from({ length: 30 }, () => record().items[0]) })).items.length, 30, "up to 30 items, the database limit");
});

test("a report without a part number shows a dash on the form and in the backup row", () => {
  for (const partNumber of ["", undefined, null]) {
    const clean = plain(call("validateExportRecord_", record({ partNumber })));
    assert.equal(clean.partNumber, "-", `part number ${JSON.stringify(partNumber)} is drawn as a dash`);
    assert.equal(clean.partName, "ยางรอง", "the part name is kept");
    const { rows } = plain(call("exportLayout_", clean));
    const line = rows.find((row) => row.includes("Part Number"));
    assert.equal(line[2], "-");
  }
  assert.equal(call("validateExportRecord_", record()).partNumber, "P-100", "a part number is kept as is");
  let written;
  const fakeSheet = { getLastRow: () => 0, getRange: () => ({ setNumberFormat() { return this; }, setValues(values) { written = values[0]; return this; } }) };
  call("upsertLogRow_", fakeSheet, record({ partNumber: "" }));
  assert.equal(written[3], "-", "the backup row shows a dash for an empty part number");
  assert.equal(written[4], "ยางรอง");
  call("upsertLogRow_", fakeSheet, record());
  assert.equal(written[3], "P-100");
});

test("exportLayout_ draws the QA01-PM11 form", () => {
  const layout = plain(call("exportLayout_", call("validateExportRecord_", record())));
  const { rows } = layout;
  assert.ok(rows.every((row) => row.length === 15), "A..O");
  assert.equal(rows[0][0], "M&P WORLD POLYMER CO.,LTD.");
  assert.equal(rows[0][12], "Doc No. QA01-PM11");
  assert.equal(rows[1][0], "Data Inspection Report");
  assert.equal(rows[1][12], "Rev. 00");
  const find = (text) => rows.findIndex((row) => row.includes(text));
  for (const label of ["Part Number", "Part Name", "customer", "Order No.", "Code", "Inspecter By", "inspection Date", "Results"]) assert.ok(find(label) >= 0, label);
  assert.equal(rows[find("Part Number")][2], "P-100");
  assert.equal(rows[find("Results")][2], "ผ่าน (OK)");
  assert.match(rows[find("Report No.")][9], /^QC-26-001 \(อนุมัติแล้ว\)$/);
  const head = find("ITEM No.");
  assert.equal(rows[head][6], "Sample (2M)");
  assert.deepEqual(rows[head + 1].slice(3, 11), ["MIN", "STD", "MAX", 1, 2, 3, 4, 5]);
  assert.deepEqual(rows[head].slice(11), ["min", "max", "average", "Judge"]);
  const first = rows[head + 2];
  assert.deepEqual(first.slice(0, 3), ["A", "ความหนา (mm)", "Caliper"]);
  assert.deepEqual(first.slice(3, 6), [12, 13, 14]);
  assert.deepEqual(first.slice(6, 11), [12.5, 13, "", "", ""]);
  assert.deepEqual(first.slice(11), [12.5, 13, 12.75, "O"]);
  assert.equal(rows[head + 3][14], "-", "an item without a spec shows a dash, not NA");
  const remark = rows.find((row) => String(row[0]).startsWith("REMARK"))[0];
  assert.match(remark, /^REMARK : หมายเหตุ/);
  assert.match(remark, /รายการ D: ตรวจด้วยตา/, "per-item notes are printed under REMARK");
  const sign = rows.findIndex((row) => row[0] === "Inspector");
  assert.deepEqual([0, 4, 8, 12].map((col) => rows[sign][col]), ["Inspector", "manager QA", "factory manager", "General Manager Approved"]);
  assert.deepEqual([0, 4, 8, 12].map((col) => rows[sign + 1][col]), ["สมชาย ใจดี", "สมหญิง", "ผจก โรงงาน", "ผจก ทั่วไป"]);
  assert.equal(rows[sign + 2][12], "วันที่/เวลา : 2026-10-27 12:00");
  assert.deepEqual(layout.judges.map((entry) => entry[1]), ["O", "NA"]);
  assert.ok(layout.formats.some((entry) => entry[4] === "General"), "numbers show their real value (no rounding into spec, no trailing dot on integers)");
  assert.equal(call("cleanText_", "+1"), "'+1", "plus-prefixed text is kept as text like asText_");
});

test("the signature boxes show the draft, pending and rejected states", () => {
  const draft = plain(call("exportLayout_", call("validateExportRecord_", record({
    status: "draft", approvals: { qa: { status: "pending" }, factory: { status: "pending" }, gm: { status: "pending" } },
  }))));
  const sign = draft.rows.findIndex((row) => row[0] === "Inspector");
  assert.deepEqual(draft.rows[sign + 1].filter(Boolean), [], "nobody has signed a draft");
  const rejected = plain(call("exportLayout_", call("validateExportRecord_", record({
    status: "rejected", approvals: { qa: { status: "rejected", name: "สมหญิง", date: "2026-10-27 10:00", comment: "ค่าไม่ผ่าน" }, factory: { status: "pending" }, gm: { status: "pending" } },
  }))));
  const row = rejected.rows.findIndex((entry) => entry[0] === "Inspector");
  assert.equal(rejected.rows[row + 1][4], "ไม่อนุมัติ: สมหญิง\nค่าไม่ผ่าน");
});

test("the file name is safe and errors are reported as codes only", () => {
  assert.equal(call("safeFileName_", "QC-26-001.xlsx"), "QC-26-001.xlsx");
  assert.equal(call("safeFileName_", "../../x"), "QA01-PM11.xlsx");
  assert.equal(call("errorCode_", new Error("BAD_RECORD"), "INPUT"), "BAD_RECORD");
  assert.equal(call("errorCode_", new Error("Exception: file 1abc not found"), "CREATE"), "FAILED_CREATE");
  assert.equal(call("errorCode_", new Error("EXPORT_HTTP_403"), "EXPORT"), "FAILED_EXPORT_403");
  assert.equal(call("asText_", "=1+1"), "'=1+1");
  assert.equal(call("asText_", "ปกติ"), "ปกติ");
});

test("doPost routes the export and the backup, and answers malformed posts with a code", () => {
  const outputs = [];
  const created = [];
  const trashed = [];
  const globals = {
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { outputs.push("released"); } }) },
    SpreadsheetApp: { create: (name) => { created.push(name); throw new Error("quota"); }, getActiveSpreadsheet: () => { throw new Error("no spreadsheet"); } },
    DriveApp: { getFileById: (id) => ({ setTrashed: () => trashed.push(id) }) },
  };
  const context = load(globals);
  const post = (contents) => JSON.parse(vm.runInContext("doPost", context)({ postData: { contents } }).text);
  assert.deepEqual(post("x".repeat(200001)), { ok: false, error: "TOO_LARGE" });
  assert.deepEqual(post("not json"), { ok: false, error: "BAD_RECORD" });
  assert.deepEqual(post(JSON.stringify({ form: "qc", record: { items: [] } })), { ok: false, error: "BAD_RECORD" });
  assert.deepEqual(post(JSON.stringify({ form: "qc", fileName: "x.xlsx", record: record() })), { ok: false, error: "FAILED_CREATE" });
  assert.equal(created.length, 1, "a valid export reaches the spreadsheet creation");
  assert.deepEqual(post(JSON.stringify({ batch: [{ key: "ncr:1", value: "{}" }, { key: "qc:other", value: JSON.stringify(record()) }] })), { ok: true, count: 0 }, "foreign keys and mismatched ids are skipped");
  assert.ok(outputs.includes("released"), "the backup always releases the lock");
});
