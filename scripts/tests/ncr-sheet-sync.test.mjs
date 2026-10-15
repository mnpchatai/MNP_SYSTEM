import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const sheetSync = require("../../modules/ncr-sheet-sync.js");

const directory = new Map([
  ["rep", { first_name: "สมชาย", last_name: "ใจดี", job_title: "QC", department_id: "dep-qa" }],
  ["mgr", { first_name: "สมหญิง", last_name: "ตั้งใจ", job_title: "ผจก.ผลิต", department_id: "dep-pp" }],
  ["fm", { first_name: "ผจก", last_name: "โรงงาน", job_title: null, department_id: "dep-fm" }],
]);
const ncr = (change = {}) => ({
  id: "uuid-1", ncr_no: "QA001/69", form_code: "QA02-FM01 Rev.00", is_test: false, status: "awaiting_signoff",
  issue_date: "2026-10-01", reporter_id: "rep", reporter_department_id: "dep-qa", reporter_department: { code: "QA" },
  product_code: "P-01", product_name: "ยางรอง", customer_name: null, po_no: "PO-9", lot_no: null,
  qty_total: "100.000", qty_sampled: null, qty_defect: "5", qty_returned: "0", unit: "ชิ้น", source: "incoming",
  defect_type: [{ name_th: "ขนาดผิด" }], description: "ขนาดเกินสเปค 2 มม.",
  dispositions: ["return", "sort"], disposition_note: null, disposed_by: "fm", disposed_at: "2026-10-01T18:30:00+00:00",
  ncr_responsibilities: [{ department_id: "dep-pp", department: { code: "PP" } }],
  causes: ["man", "method"], responded_by: "mgr", responded_at: "2026-10-03T02:00:00+00:00", correction_due: "2026-10-10",
  followed_up_by: "rep", followed_up_at: "2026-10-12T03:00:00+00:00",
  signoff_qa_by: "rep", signoff_qa_at: "2026-10-13T03:00:00+00:00",
  ...change,
});

test("record resolves names, department codes and Bangkok calendar dates", () => {
  const record = sheetSync.buildRecord(ncr(), { directory, statusLabel: "รอลงนามปิด · ผจก.โรงงาน" });
  assert.equal(record.ncrNo, "QA001/69");
  assert.deepEqual(record.reporter, { name: "สมชาย ใจดี", position: "QC", department: "QA" });
  assert.deepEqual(record.responder, { name: "สมหญิง ตั้งใจ", position: "ผจก.ผลิต", department: "PP", date: "2026-10-03" });
  // 18:30 UTC = 01:30 ของวันถัดไปตามเวลาไทย
  assert.equal(record.disposer.date, "2026-10-02");
  assert.deepEqual(record.responsibilities, ["PP"]);
  assert.equal(record.defectType, "ขนาดผิด");
  assert.equal(record.qtyTotal, 100);
  assert.equal(record.qtySampled, null);
  assert.equal(record.qtyReturned, 0);
  assert.equal(record.customerName, "");
  assert.equal(record.followup.closed, true);
  assert.deepEqual(record.signoffs.qa, { name: "สมชาย ใจดี", date: "2026-10-13" });
  assert.deepEqual(record.signoffs.gm, { name: "", date: "" });
  assert.equal(record.statusLabel, "รอลงนามปิด · ผจก.โรงงาน");
});

test("a returned follow-up is not marked as closed", () => {
  assert.equal(sheetSync.buildRecord(ncr({ status: "awaiting_response" }), { directory }).followup.closed, false);
  assert.equal(sheetSync.buildRecord(ncr({ followed_up_at: null }), { directory }).followup.closed, false);
});

test("nothing is sent without a URL", () => {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url, init }); return Promise.resolve(); };
  assert.equal(sheetSync.sync(sheetSync.buildRecord(ncr(), { directory }), { url: "", fetchImpl }), false);
  assert.equal(calls.length, 0);
});

test("sandbox reports are sent flagged as test data so the Apps Script can accept or drop them", () => {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url, init }); return Promise.resolve(); };
  assert.equal(sheetSync.sync(sheetSync.buildRecord(ncr({ is_test: true, ncr_no: "TEST-QA001/69" }), { directory }), { url: "https://x.test", fetchImpl }), true);
  const record = JSON.parse(JSON.parse(calls[0].init.body).batch[0].value);
  assert.equal(record.isTest, true);
  assert.equal(record.ncrNo, "TEST-QA001/69");
});

test("a real report is posted once as a no-cors batch keyed by the report id", () => {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url, init }); return Promise.resolve(); };
  assert.equal(sheetSync.sync(sheetSync.buildRecord(ncr(), { directory }), { url: "https://x.test", fetchImpl }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.mode, "no-cors");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.batch[0].key, "ncr:uuid-1");
  assert.equal(JSON.parse(body.batch[0].value).ncrNo, "QA001/69");
});
