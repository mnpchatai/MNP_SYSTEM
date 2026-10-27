import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const formExport = require("../../modules/mt-form-export.js");

// โปรเจกต์ Apps Script ของสเปรดชีตใบคำร้องถึงฝ่ายบริหาร = Code.gs (ซิงก์ + ทางเข้า) + FormFill.gs + Export.gs
// โหลดทั้ง 3 ไฟล์เข้า vm เดียว (global scope เดียวกันแบบ Apps Script)
const read = (name) => readFileSync(new URL(`../../apps-script/management-backup/${name}`, import.meta.url), "utf8");
const files = { "Code.gs": read("Code.gs"), "FormFill.gs": read("FormFill.gs"), "Export.gs": read("Export.gs") };
const context = vm.createContext({});
for (const source of Object.values(files)) vm.runInContext(source, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

const mgOrder = {
  id: "m-1", docNumber: "MG-2026-000005", department: "FT", subject: "ขอซื้อเครื่องพิมพ์", attachmentNote: "ใบเสนอราคา",
  description: "เครื่องเดิมเสีย", requestedBy: "ฐิติวัชร์ คงรอด", position: "ผู้ช่วยผู้จัดการโรงงาน",
  submittedAt: "2026-10-20T03:00:00Z", status: "APPROVED", decision: "approved", comment: "=SUM(1)",
  approvals: { fm: { status: "approved", by: "นพรัตน์ ไชยเวช", at: "2026-10-20T04:00:00Z", note: "" }, gm: null },
  ccDepartments: ["QA", "FT"], ccOther: "",
};

test("the three files define each top-level name once, and only Code.gs has doPost/doGet", () => {
  const seen = new Map();
  for (const [file, source] of Object.entries(files)) {
    for (const [, name] of source.matchAll(/^(?:function|var)\s+([A-Za-z0-9_$]+)/gm)) {
      assert.ok(!seen.has(name), `${name} อยู่ทั้งใน ${seen.get(name)} และ ${file}`);
      seen.set(name, file);
    }
  }
  assert.equal(seen.get("doPost"), "Code.gs");
  assert.equal(seen.get("doGet"), "Code.gs");
});

test("doPost sends a form mg request to Export.gs and a sync batch to the sheet sync", () => {
  const calls = [];
  const local = vm.createContext({});
  for (const source of Object.values(files)) vm.runInContext(source, local);
  local.exportManagementXlsx_ = (payload) => { calls.push(["export", payload.record["เลขที่เอกสาร"]]); return "xlsx"; };
  local.getLogSheet_ = () => "log";
  local.getStructuredSheet_ = () => "rows";
  local.upsertRow_ = (sheet, key) => calls.push(["kv", key]);
  local.upsertStructuredRow_ = () => calls.push(["row"]);
  local.jsonOutput_ = (value) => value;
  const post = (body) => vm.runInContext("doPost", local)({ postData: { contents: JSON.stringify(body) } });
  assert.equal(post(formExport.buildManagementFormRecord(mgOrder)), "xlsx");
  post({ batch: [{ key: "mgmt:m-1", value: JSON.stringify(mgOrder) }] });
  assert.deepEqual(plain(calls), [["export", "MG-2026-000005"], ["kv", "mgmt:m-1"], ["row"]]);
});

test("the management record has the same values as the row the sheet sync writes", () => {
  const appended = [];
  const sheet = { getLastRow: () => 1, appendRow: (row) => appended.push(row) };
  vm.runInContext("upsertStructuredRow_", context)(sheet, JSON.stringify(mgOrder));
  const headers = plain(vm.runInContext("STRUCTURED_HEADERS", context));
  const { form, fileName, record } = formExport.buildManagementFormRecord(mgOrder);
  assert.equal(form, "mg");
  assert.equal(fileName, "MG-2026-000005.xlsx");
  assert.deepEqual(formExport.MANAGEMENT_RECORD_HEADERS, headers.slice(0, -1));
  formExport.MANAGEMENT_RECORD_HEADERS.forEach((header, index) => assert.equal(record[header], String(appended[0][index] ?? ""), header));
});

test("Export.gs takes the same keys the web sends and FormFill reads, and cleans the record", () => {
  assert.deepEqual(plain(vm.runInContext("MGX_RECORD_KEYS", context)), formExport.MANAGEMENT_RECORD_HEADERS);
  const readKeys = new Set([...files["FormFill.gs"].matchAll(/r\['([^']+)'\]/g)].map((m) => m[1]));
  assert.ok(readKeys.size >= 10);
  for (const key of readKeys) assert.ok(formExport.MANAGEMENT_RECORD_HEADERS.includes(key), key);
  const validate = vm.runInContext("mgxValidateRecord_", context);
  const { record } = formExport.buildManagementFormRecord(mgOrder);
  const clean = plain(validate({ ...record, extra: "x" }));
  assert.equal("extra" in clean, false);
  assert.equal(clean["ความเห็น"], "​=SUM(1)");
  assert.equal(clean["ยื่นเมื่อ"], "2026-10-20T03:00:00Z");
  assert.equal(plain(validate({ ...record, "ยื่นเมื่อ": "+IMPORTXML(1)" }))["ยื่นเมื่อ"], "");
  assert.equal(plain(validate({ ...record, "ผจก.ทั่วไป เมื่อ": "2026-09-22T03:52:07.599209+00:00" }))["ผจก.ทั่วไป เมื่อ"], "2026-09-22T03:52:07.599209+00:00");
  for (const bad of [null, [], { "เลขที่เอกสาร": "" }, { "เลขที่เอกสาร": "X", "เรื่อง": 1 }]) {
    assert.throws(() => validate(bad), /BAD_RECORD/, JSON.stringify(bad));
  }
});

test("Export.gs keeps a safe file name and reports the failing step", () => {
  const gs = vm.runInContext("({ mgxSafeFileName_, mgxErrorCode_ })", context);
  assert.equal(gs.mgxSafeFileName_("MG-2026-000005.xlsx"), "MG-2026-000005.xlsx");
  assert.equal(gs.mgxSafeFileName_("../x"), "PP01-FM08.xlsx");
  assert.equal(gs.mgxErrorCode_(new Error("FORMFILL_MISSING"), "INPUT"), "FORMFILL_MISSING");
  assert.equal(gs.mgxErrorCode_(new Error("EXPORT_HTTP_403"), "EXPORT"), "FAILED_EXPORT_403");
  assert.equal(gs.mgxErrorCode_(new Error("boom"), "COPY"), "FAILED_COPY");
});

test("MT and MG export through different web apps; MG uses its own spreadsheet's web app", () => {
  assert.ok(formExport.MG_EXPORT_URL);
  assert.notEqual(formExport.MG_EXPORT_URL, formExport.EXPORT_URL);
  const mg = readFileSync(new URL("../../modules/module-mg.js", import.meta.url), "utf8");
  assert.ok(mg.includes(formExport.MG_EXPORT_URL), "MG export = Web App ของสเปรดชีตบริหาร (URL ซิงก์ใน module-mg.js)");
  for (const file of ["module-mt.js", "ncr-sheet-sync.js"]) {
    const source = readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8");
    assert.ok(!source.includes(formExport.MG_EXPORT_URL), file);
  }
});

test("a management payload goes to the MG web app, never to the MT one", async () => {
  let calledUrl = null;
  const fetchImpl = async (url) => { calledUrl = url; return { ok: true, json: async () => ({ ok: true, base64: "" }) }; };
  await formExport.requestXlsx(formExport.buildManagementFormRecord(mgOrder), fetchImpl);
  assert.equal(calledUrl, formExport.MG_EXPORT_URL);
});

test("the spreadsheet project's manifest keeps the menu scope and adds the export scopes", () => {
  const manifest = JSON.parse(read("appsscript.json"));
  for (const scope of ["spreadsheets", "script.container.ui", "drive", "script.external_request"]) {
    assert.ok(manifest.oauthScopes.includes(`https://www.googleapis.com/auth/${scope}`), scope);
  }
});
