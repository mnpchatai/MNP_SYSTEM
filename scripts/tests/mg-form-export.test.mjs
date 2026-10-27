import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const formExport = require("../../modules/mt-form-export.js");

// โปรเจกต์ Apps Script export ของใบคำร้องถึงฝ่ายบริหาร (แยกจาก export ของ MT) = Code.gs นี้ + สำเนา FormFill.gs ของชีตบริหาร
const gsSource = readFileSync(new URL("../../apps-script/mg-form-export/Code.gs", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(gsSource, context);

const mgOrder = {
  id: "m-1", docNumber: "MG-2026-000005", department: "FT", subject: "ขอซื้อเครื่องพิมพ์", attachmentNote: "ใบเสนอราคา",
  description: "เครื่องเดิมเสีย", requestedBy: "ฐิติวัชร์ คงรอด", position: "ผู้ช่วยผู้จัดการโรงงาน",
  submittedAt: "2026-10-20T03:00:00Z", status: "APPROVED", decision: "approved", comment: "=SUM(1)",
  approvals: { fm: { status: "approved", by: "นพรัตน์ ไชยเวช", at: "2026-10-20T04:00:00Z", note: "" }, gm: null },
  ccDepartments: ["QA", "FT"], ccOther: "",
};

test("the management record has the same values as the row the sheet sync writes", () => {
  const appended = [];
  const sheet = { getLastRow: () => 1, appendRow: (row) => appended.push(row) };
  const mgContext = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../../apps-script/management-backup/Code.gs", import.meta.url), "utf8"), mgContext);
  vm.runInContext("upsertStructuredRow_", mgContext)(sheet, JSON.stringify(mgOrder));
  const headers = JSON.parse(JSON.stringify(vm.runInContext("STRUCTURED_HEADERS", mgContext)));
  const { form, fileName, record } = formExport.buildManagementFormRecord(mgOrder);
  assert.equal(form, "mg");
  assert.equal(fileName, "MG-2026-000005.xlsx");
  assert.deepEqual(formExport.MANAGEMENT_RECORD_HEADERS, headers.slice(0, -1));
  formExport.MANAGEMENT_RECORD_HEADERS.forEach((header, index) => assert.equal(record[header], String(appended[0][index] ?? ""), header));
});

test("the export web app takes the same management keys and cleans the record", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("MG_RECORD_KEYS", context))), formExport.MANAGEMENT_RECORD_HEADERS);
  const validateRecord = vm.runInContext("validateRecord_", context);
  const { record } = formExport.buildManagementFormRecord(mgOrder);
  const clean = JSON.parse(JSON.stringify(validateRecord({ ...record, extra: "x" })));
  assert.equal("extra" in clean, false);
  assert.equal(clean["ความเห็น"], "\u200B=SUM(1)");
  assert.equal(clean["ยื่นเมื่อ"], "2026-10-20T03:00:00Z");
  assert.equal(JSON.parse(JSON.stringify(validateRecord({ ...record, "ยื่นเมื่อ": "+IMPORTXML(1)" })))["ยื่นเมื่อ"], "");
  assert.equal(JSON.parse(JSON.stringify(validateRecord({ ...record, "ผจก.ทั่วไป เมื่อ": "2026-09-22T03:52:07.599209+00:00" })))["ผจก.ทั่วไป เมื่อ"], "2026-09-22T03:52:07.599209+00:00");
  assert.equal(clean["เรื่อง"], "ขอซื้อเครื่องพิมพ์");
  for (const bad of [null, [], { "เลขที่เอกสาร": "" }, { "เลขที่เอกสาร": "X", "เรื่อง": 1 }]) {
    assert.throws(() => validateRecord(bad), /BAD_RECORD/, JSON.stringify(bad));
  }
});

test("every record key FormFill.gs reads is one the web sends and the web app accepts", () => {
  const formFill = readFileSync(new URL("../../apps-script/management-backup/FormFill.gs", import.meta.url), "utf8");
  const read = new Set([...formFill.matchAll(/r\['([^']+)'\]/g)].map((m) => m[1]));
  assert.ok(read.size >= 10);
  for (const key of read) assert.ok(formExport.MANAGEMENT_RECORD_HEADERS.includes(key), key);
});

test("the export project's two files (Code.gs + FormFill.gs) load together without clashing names", () => {
  const names = (source) => new Set([...source.matchAll(/^(?:function|var)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]));
  const formFill = readFileSync(new URL("../../apps-script/management-backup/FormFill.gs", import.meta.url), "utf8");
  const clash = [...names(gsSource)].filter((name) => names(formFill).has(name));
  assert.deepEqual(clash, []);
  const both = vm.createContext({});
  vm.runInContext(gsSource, both);
  vm.runInContext(formFill, both);
  assert.equal(vm.runInContext("typeof ffWrite_ === 'function' && typeof fillManagementForm_ === 'function'", both), true);
});

test("the MG export is its own web app: a different URL from the MT export and every sync web app", () => {
  const urls = [formExport.EXPORT_URL, formExport.MG_EXPORT_URL].filter(Boolean);
  assert.equal(new Set(urls).size, urls.length, "MT และ MG ต้องใช้คนละ Web App");
  for (const file of ["module-mt.js", "module-mg.js", "ncr-sheet-sync.js"]) {
    const source = readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8");
    for (const url of urls) assert.ok(!source.includes(url), `${url} ซ้ำกับ URL ใน ${file}`);
  }
});

test("a management payload goes to the MG web app, never to the MT one", async () => {
  let calledUrl = null;
  const fetchImpl = async (url) => { calledUrl = url; return { ok: true, json: async () => ({ ok: true, base64: "" }) }; };
  const payload = formExport.buildManagementFormRecord(mgOrder);
  if (formExport.MG_EXPORT_URL) {
    await formExport.requestXlsx(payload, fetchImpl);
    assert.equal(calledUrl, formExport.MG_EXPORT_URL);
  } else {
    await assert.rejects(formExport.requestXlsx(payload, fetchImpl), /ยังไม่ได้ตั้งค่า/);
    assert.equal(calledUrl, null);
  }
});

test("the MG web app keeps a safe file name and reports the failing step", () => {
  const gs = vm.runInContext("({ safeFileName_, errorCode_ })", context);
  assert.equal(gs.safeFileName_("MG-2026-000005.xlsx"), "MG-2026-000005.xlsx");
  assert.equal(gs.safeFileName_("../x"), "PP01-FM08.xlsx");
  assert.equal(gs.errorCode_(new Error("FORMFILL_MISSING"), "INPUT"), "FORMFILL_MISSING");
  assert.equal(gs.errorCode_(new Error("EXPORT_HTTP_403"), "EXPORT"), "FAILED_EXPORT_403");
  assert.equal(gs.errorCode_(new Error("boom"), "COPY"), "FAILED_COPY");
});
