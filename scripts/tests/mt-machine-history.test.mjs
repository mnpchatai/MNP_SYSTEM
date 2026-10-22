import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const history = require("../../modules/mt-machine-history.js");

const helpers = {
  escapeHtml: (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
  formatDate: (value) => (value ? `D(${value})` : "—"),
  statusBadge: (status) => `<span class="badge ${status}">${status}</span>`,
  docTypeLabels: { request: "ใบคำร้อง", repair: "ใบแจ้งซ่อม" },
};
const row = (extra = {}) => ({
  request_id: "r-1", request_no: "GR070/26", doc_type: "repair", status: "completed",
  created_at: "2026-09-01T02:00:00Z", completed_at: "2026-09-03T02:00:00Z",
  description: "เครื่องมีเสียงดัง", cause_analysis: "ลูกปืนสึก", parts_used: "ลูกปืน 6204",
  technician_names: "สมชาย ใจดี", can_open: true, ...extra,
});

test("the machine card is clickable only for a real machine", () => {
  assert.equal(history.hasMachineHistory({ machine_id: "m-1", machine_code: "B-SB 1-15" }), true);
  assert.equal(history.hasMachineHistory({ machine_id: null, machine_code: "B-SB 1-15" }), true);
  assert.equal(history.hasMachineHistory({ machine_id: null, machine_code: null }), false);
  assert.equal(history.hasMachineHistory({ machine_id: "m-1", machine_code: "   " }), true);
  assert.equal(history.hasMachineHistory(null), false);
});

test("the placeholder machines have no history even though they have a machine id", () => {
  for (const code of history.PLACEHOLDER_CODES) {
    assert.equal(history.hasMachineHistory({ machine_id: "placeholder-id", machine_code: code }), false);
    assert.equal(history.hasMachineHistory({ machine_id: null, machine_code: ` ${code} ` }), false);
  }
  assert.equal(history.hasMachineHistory({ machine_id: "m", machine_code: "สร้างใหม่ 2" }), true);
});

test("rows are normalised, rows without an id are dropped and can_open must be exactly true", () => {
  const rows = history.normalizeRows([
    row({ description: "  อาการ  ", technician_names: null }),
    row({ request_id: null }),
    row({ request_id: "r-2", can_open: "true" }),
    null,
  ]);
  assert.deepEqual(rows.map((item) => item.id), ["r-1", "r-2"]);
  assert.equal(rows[0].description, "อาการ");
  assert.equal(rows[0].technicians, "");
  assert.equal(rows[0].canOpen, true);
  assert.equal(rows[1].canOpen, false);
  assert.deepEqual(history.normalizeRows(null), []);
  assert.deepEqual(history.normalizeRows({}), []);
});

test("a row links only to a request the viewer may open, and shows only the facts it has", () => {
  const [openable, locked] = history.normalizeRows([
    row(),
    row({ request_id: "r-2", request_no: "GR071/26", can_open: false, doc_type: null, completed_at: null, cause_analysis: "", parts_used: "", technician_names: "" }),
  ]);
  const html = history.listHtml([openable, locked], helpers);
  assert.match(html, /<a class="machine-history-no" href="#\/request\?id=r-1">GR070\/26<\/a>/);
  assert.match(html, /<span class="machine-history-no">GR071\/26<\/span>/);
  assert.doesNotMatch(html, /href="#\/request\?id=r-2"/);
  assert.match(html, /ใบแจ้งซ่อม/);
  assert.match(html, /<dt>สาเหตุ<\/dt><dd>ลูกปืนสึก<\/dd>/);
  assert.match(html, /<dt>เสร็จเมื่อ<\/dt>/);
  const lockedHtml = history.listHtml([locked], helpers);
  assert.doesNotMatch(lockedHtml, /machine-history-details|machine-history-type/);
});

test("request text is escaped and an empty history says so", () => {
  const [item] = history.normalizeRows([row({ description: `<img src=x onerror="alert(1)">`, request_no: "A&B" })]);
  const html = history.listHtml([item], helpers);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /A&amp;B/);
  assert.match(history.listHtml([], helpers), /ยังไม่มีประวัติการซ่อมอื่นของเครื่องนี้/);
});

test("the list notes the cap only when it is reached", () => {
  const many = (count) => history.normalizeRows(Array.from({ length: count }, (_, index) => row({ request_id: `r-${index}` })));
  assert.doesNotMatch(history.listHtml(many(history.HISTORY_LIMIT - 1), helpers), /รายการล่าสุด/);
  assert.match(history.listHtml(many(history.HISTORY_LIMIT), helpers), new RegExp(`แสดง ${history.HISTORY_LIMIT} รายการล่าสุด`));
});

test("a database without the migration and a denied caller get specific messages", () => {
  const friendly = (error) => `friendly:${error.message}`;
  assert.match(history.errorMessage({ code: "PGRST202", message: "Could not find the function public.app_get_machine_repair_history(p_request_id) in the schema cache" }, friendly), /ยังไม่เปิดใช้/);
  assert.match(history.errorMessage({ message: "Could not find the function x" }, friendly), /ยังไม่เปิดใช้/);
  assert.match(history.errorMessage({ message: "NOT_AUTHORIZED" }, friendly), /ไม่มีสิทธิ์ดูประวัติ/);
  assert.equal(history.errorMessage({ message: "boom" }, friendly), "friendly:boom");
});
