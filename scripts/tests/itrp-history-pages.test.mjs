import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// HTML ของแท็บ "ประวัติการซ่อม" และใบพิมพ์ FM02 (modules/itrp-history-pages.js): รายการเครื่อง แผงประวัติ ตาราง 7 คอลัมน์ ฟอร์มลงประวัติ/ทะเบียนเครื่อง รอยแก้ และใบพิมพ์ A4
// (การเรียก RPC / การผูกปุ่มทดสอบที่ itrp-module.test.mjs · กติกาข้อมูลที่ itrp-model.test.mjs)
const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
globalThis.MNP_UI_ICONS = require("../../modules/ui-icons.js");
globalThis.MNP_ITRP_MODEL = require("../../modules/itrp-model.js");
globalThis.MNP_FORM_STEPS = undefined;
const model = globalThis.MNP_ITRP_MODEL;
globalThis.MNP_ITRP_PAGES = require("../../modules/itrp-pages.js");
const pages = require("../../modules/itrp-history-pages.js");

const count = (text, pattern) => (text.match(pattern) ?? []).length;
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const XSS = '<img src=x onerror="alert(1)">';
const ID = "00000000-0000-4000-8000-000000000001";

const DEVICE = { id: 1, code: "COM05", kind: "computer", user_name: "สมชาย", division: "บัญชี", cpu_name: "Intel Core i5", cpu_model: "10400", started_on: "2023-04-01", asset_no: "AS-100", status: "active", note: null };
const ROWS = [
  { source: "import", entry_id: 7, request_id: null, request_status: null, doc_no: "IT01-16/0001", reported_on: "2016-03-05", symptom: "จอเสีย", action: "เปลี่ยนจอ", finished_on: "2016-03-06", remark: null, reporter_name: "สมชาย", revision_count: 2 },
  { source: "manual", entry_id: 8, request_id: null, request_status: null, doc_no: null, reported_on: "2025-05-01", symptom: "พิมพ์ไม่ออก", action: null, finished_on: null, remark: "ควรเปลี่ยน", reporter_name: null, revision_count: 0 },
  { source: "request", entry_id: null, request_id: ID, request_status: "it_closed", doc_no: "IT01-26/050", reported_on: "2026-11-02", symptom: "เปิดไม่ติด", action: "เปลี่ยนแหล่งจ่าย", finished_on: "2026-11-03", remark: "x", reporter_name: "สมหญิง", revision_count: 0 },
];
const DATA = { code: "COM05", is_test: false, device: DEVICE, rows: ROWS };
const LIST = [
  { code: "COM05", in_registry: true, kind: "computer", user_name: "สมชาย", division: "บัญชี", status: "active", history_count: 3, last_repair_on: "2026-11-02" },
  { code: "PRT22", in_registry: true, kind: "printer", user_name: null, division: null, status: "retired", history_count: 0, last_repair_on: null },
  { code: "OLD1", in_registry: false, kind: null, user_name: null, division: null, status: null, history_count: 1, last_repair_on: "2016-03-05" },
];

/* ---------- รายการเครื่อง ---------- */
test("the device list marks the chosen machine, dims retired ones and offers codes that are only in the history", () => {
  const html = pages.deviceItems(LIST, "COM05");
  assert.equal(count(html, /data-hist-code=/g), 3);
  assert.match(html, /data-hist-code="COM05" aria-pressed="true"/);
  assert.match(html, /itrp-hist-device is-retired" data-hist-code="PRT22" aria-pressed="false"/);
  assert.match(html, /data-hist-code="OLD1"[\s\S]*ไม่อยู่ในทะเบียน/);
  assert.match(html, /คอมพิวเตอร์ตั้งโต๊ะ · สมชาย · บัญชี/);
  assert.match(html, /3 รายการซ่อม · ล่าสุด 02\/11\/2569/);
  assert.match(html, /ยังไม่มีประวัติ/);
  assert.match(pages.deviceItems([]), /ไม่พบเครื่องที่ตรงกับคำค้น/);
  assert.doesNotMatch(pages.deviceItems([{ code: XSS, user_name: XSS, division: XSS, status: "active" }]), /<img/);
  const many = Array.from({ length: 320 }, (_, index) => ({ code: `D${index}` }));
  assert.equal(count(pages.deviceItems(many), /data-hist-code=/g), 300, "only 300 are drawn at once");
  assert.match(pages.deviceItems(many), /แสดง 300 จาก 320 เครื่อง/);
  assert.equal(pages.countText(3, 3), "3 เครื่อง");
  assert.equal(pages.countText(1, 3), "พบ 1 จาก 3 เครื่อง");
});

/* ---------- แผงประวัติของเครื่อง ---------- */
test("the panel shows the FM02 header, the 7 columns in order, links for requests and source tags for the rest", () => {
  const html = pages.historyPanel(DATA, { canEdit: false });
  for (const [label, value] of [["เริ่มใช้วันที่", "01/04/2566"], ["Computer Code", "COM05"], ["User", "สมชาย"], ["Section", "บัญชี"], ["Processor", "Intel Core i5 10400"], ["เลขทะเบียนทรัพย์สินทางบัญชี", "AS-100"]]) {
    assert.match(html, new RegExp(`<dt>${label}</dt><dd>${value}</dd>`), label);
  }
  assert.deepEqual([...html.matchAll(/<th scope="col">([^<]*)</g)].map((match) => match[1]).filter(Boolean), pages.FM02_COLUMNS, "the 7 paper columns (the unnamed actions column is not one of them)");
  assert.deepEqual(pages.FM02_COLUMNS, ["เลขที่ใบแจ้งซ่อม", "วันที่", "อาการเสีย", "การแก้ไข", "ซ่อมเสร็จ", "ข้อเสนอแนะ", "ผู้แจ้ง"]);
  assert.equal(count(html, /<tr data-hist-row=/g), 3, "rows in the order the database sends them");
  assert.ok(html.indexOf("IT01-16/0001") < html.indexOf("พิมพ์ไม่ออก") && html.indexOf("พิมพ์ไม่ออก") < html.indexOf("IT01-26/050"));
  assert.match(html, /<a class="request-no register-no-link" href="#\/office\?module=repair&amp;view=order&amp;id=00000000-0000-4000-8000-000000000001">IT01-26\/050<\/a>/);
  assert.doesNotMatch(html, /<a[^>]*>IT01-16\/0001<\/a>/, "an imported row has no link");
  assert.match(html, /นำเข้าจาก Excel/);
  assert.match(html, /ลงย้อนหลัง/);
  assert.match(html, /ใบในระบบ/);
  assert.match(html, /itrp-hist-badge is-status">IT ส่งงาน \(รอผู้แจ้งยืนยัน\)/, "a request that is not confirmed yet says so");
  assert.match(html, /แก้ไขแล้ว 2 ครั้ง/);
  assert.match(html, /<td data-label="เลขที่ใบแจ้งซ่อม">-</, "a missing paper number is a dash");
  assert.match(html, /<td data-label="ซ่อมเสร็จ">-<\/td>/);
  assert.match(html, /id="itrp-hist-print" href="#\/office\?module=repair&amp;view=history-print&amp;code=COM05">พิมพ์ประวัติ \(A4\)/);
  assert.doesNotMatch(html, /data-hist-edit|data-hist-void/, "the read-only view has no edit or void buttons");
  // ผู้อนุมัติขั้น IT (อ่านอย่างเดียว) ดูรอยแก้ได้: เฉพาะแถวที่เคยถูกแก้
  assert.match(html, /<th scope="col"><span class="sr-only">จัดการ<\/span><\/th>/);
  assert.match(html, /data-hist-revisions="7">ดูรอยแก้<\/button>/);
  assert.equal(count(html, /data-hist-revisions=/g), 1, "only the row that was edited");
  const untouched = pages.historyPanel({ ...DATA, rows: ROWS.map((row) => ({ ...row, revision_count: 0 })) }, { canEdit: false });
  assert.doesNotMatch(untouched, /data-hist-revisions|จัดการ/, "nothing to show = no actions column at all");
});

test("the IT admin gets edit / void / revisions only on imported and manual rows, plus the register button", () => {
  const html = pages.historyPanel(DATA, { canEdit: true });
  assert.match(html, /data-hist-edit="7"/);
  assert.match(html, /data-hist-edit="8"/);
  assert.equal(count(html, /data-hist-edit="/g), 2, "the request row has no edit button");
  assert.equal(count(html, /data-hist-void="/g), 2);
  assert.match(html, /data-hist-revisions="7"/);
  assert.doesNotMatch(html, /data-hist-revisions="8"/, "a never-edited row has no revisions to show");
  assert.match(html, /<button type="button" class="btn secondary" data-hist-edit-device>แก้ข้อมูลเครื่อง<\/button>/);
  assert.match(html, /<th scope="col"><span class="sr-only">จัดการ<\/span><\/th>/);
});

test("a machine that is only in the history shows dashes in the header and offers to add it to the register; an empty machine says so", () => {
  const html = pages.historyPanel({ code: "OLD1", device: null, rows: [] }, { canEdit: true });
  assert.match(html, /ไม่อยู่ในทะเบียน/);
  assert.match(html, /<dt>User<\/dt><dd>-<\/dd>/);
  assert.match(html, /<dt>เริ่มใช้วันที่<\/dt><dd>-<\/dd>/);
  assert.match(html, /เพิ่มเข้าทะเบียนเครื่อง/);
  assert.match(html, /ยังไม่มีประวัติการซ่อมของเครื่องนี้/);
  assert.doesNotMatch(html, /<table/);
  assert.match(pages.historyPanel({ code: "PRT22", device: { ...DEVICE, code: "PRT22", status: "retired" }, rows: [] }), /ยกเลิกการใช้งาน/);
});

test("user text is escaped everywhere in the panel", () => {
  const html = pages.historyPanel({ code: XSS, device: { ...DEVICE, code: XSS, user_name: XSS, division: XSS, cpu_name: XSS, asset_no: XSS }, rows: [{ ...ROWS[0], doc_no: XSS, symptom: XSS, action: XSS, remark: XSS, reporter_name: XSS }] }, { canEdit: true });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(pages.panelError(XSS, XSS), /<img/);
  assert.doesNotMatch(pages.panelLoading(XSS), /<img/);
});

test("the tab holds the toolbar only for the admin, the search box, the list and the panel, and a note when the register is empty", () => {
  const admin = pages.historyTab({ devices: LIST, selected: { code: "COM05", data: DATA }, canEdit: true });
  assert.match(admin, /id="itrp-hist-add-entry"[^>]*>ลงประวัติย้อนหลัง</);
  assert.match(admin, /id="itrp-hist-add-device"[^>]*>เพิ่มเครื่อง</);
  assert.match(admin, /id="itrp-hist-forms"/);
  assert.match(admin, /id="itrp-hist-search" type="search"/);
  assert.match(admin, /id="itrp-hist-count" role="status">3 เครื่อง</);
  assert.match(admin, /data-code="COM05"/);
  assert.doesNotMatch(admin, /id="itrp-hist-panel"[^>]*aria-live/, "the panel is replaced wholesale, so it must not be a live region");
  assert.match(admin, /<p class="sr-only" id="itrp-hist-status" role="status" aria-live="polite"><\/p>/, "a short hidden status line is announced instead");
  const reader = pages.historyTab({ devices: LIST, canEdit: false });
  assert.doesNotMatch(reader, /itrp-hist-add-entry|itrp-hist-add-device/);
  assert.match(reader, /เลือกเครื่องจากรายการ/);
  const failed = pages.historyTab({ devices: LIST, selected: { code: "COM05", error: "โหลดไม่สำเร็จ" } });
  assert.match(failed, /โหลดไม่สำเร็จ/);
  assert.match(failed, /data-hist-retry="COM05"/);
  const filtered = pages.historyTab({ devices: LIST, query: "prt" });
  assert.match(filtered, /พบ 1 จาก 3 เครื่อง/);
  assert.equal(count(filtered, /data-hist-code=/g), 1);
  assert.match(filtered, /value="prt"/);
  const empty = pages.historyTab({ devices: [], canEdit: true, isTest: true });
  assert.match(empty, /ยังไม่มีเครื่องในทะเบียน/);
  assert.match(empty, /โหมดทดสอบเริ่มจากทะเบียนว่าง/);
  assert.match(empty, /กด "เพิ่มเครื่อง"/);
});

/* ---------- ฟอร์ม ---------- */
test("the back-dating form has the eight fields in the paper order and fills the values it is given", () => {
  const html = pages.historyFormCard({ mode: "add", values: { ...model.EMPTY_HISTORY_FORM, device_code: "COM05" }, deviceOptions: [{ code: "COM05", user_name: "สมชาย" }] });
  assert.deepEqual([...html.matchAll(/data-field="(\w+)"/g)].map((match) => match[1]), ["doc_no", "device_code", "reported_on", "finished_on", "symptom", "action", "remark", "reporter_name"]);
  assert.match(html, /<h2 id="itrp-hist-form-title">ลงประวัติย้อนหลัง<\/h2>/);
  assert.match(html, /name="device_code" list="itrp-hist-code-list"[^>]*value="COM05"/);
  assert.match(html, /<option value="COM05" label="COM05 · สมชาย">/);
  // ช่องวันที่พิมพ์เอง (ปฏิทินกลางเลื่อนได้ทีละเดือน ใช้ย้อนหลังหลายปีไม่ไหว): text + ตัวอย่างรูปแบบใต้ช่อง
  assert.match(html, /name="reported_on" type="text" data-date-text[^>]*placeholder="วว\/ดด\/ปปปป" aria-describedby="itrp-hist-reported-hint" value="">/);
  assert.match(html, /name="finished_on" type="text" data-date-text/);
  assert.doesNotMatch(html, /type="date"/);
  assert.equal(count(html, /id="itrp-hist-(?:reported|finished)-hint">พิมพ์เป็น วว\/ดด\/ปปปป เช่น 05\/03\/2566 \(พ\.ศ\.\) หรือ 05\/03\/2023 \(ค\.ศ\.\)<\/small>/g), 2);
  const filled = pages.historyFormCard({ mode: "edit", values: { ...model.EMPTY_HISTORY_FORM, reported_on: "2016-03-05", finished_on: "2016-03-06" } });
  assert.match(filled, /name="reported_on"[^>]*value="05\/03\/2559"/, "a stored ISO date is shown dd/mm/yyyy in the Buddhist year");
  assert.match(filled, /name="finished_on"[^>]*value="06\/03\/2559"/);
  assert.match(pages.historyFormCard({ mode: "add", values: { ...model.EMPTY_HISTORY_FORM, reported_on: "31/04/2566" } }), /value="31\/04\/2566"/, "text the user typed is kept as typed");
  assert.match(html, /ต้องกรอกอาการเสียหรือการแก้ไขอย่างน้อยหนึ่งอย่าง/);
  assert.match(html, /<button type="submit" class="btn is-primary">ลงประวัติ<\/button>/);
  const edit = pages.historyFormCard({ mode: "edit", values: { ...model.EMPTY_HISTORY_FORM, symptom: XSS, doc_no: "IT01-16/0001" } });
  assert.match(edit, /แก้ไขรายการประวัติการซ่อม/);
  assert.match(edit, /ดูรอยแก้/);
  assert.match(edit, /บันทึกการแก้ไข/);
  assert.match(edit, /value="IT01-16\/0001"/);
  assert.doesNotMatch(edit, /<img/);
});

test("the register form sends every field, keeps the code read-only when editing, and warns about passwords", () => {
  const add = pages.deviceFormCard({ mode: "add" });
  assert.deepEqual([...add.matchAll(/data-field="(\w+)"/g)].map((match) => match[1]), ["code", "kind", "user_name", "division", "cpu_name", "cpu_model", "started_on", "asset_no", "status", "note"]);
  assert.doesNotMatch(add, /readonly/);
  assert.equal(count(add, /<option value=/g), model.DEVICE_KINDS.length + model.DEVICE_STATUSES.length);
  assert.match(add, /<option value="computer" selected>คอมพิวเตอร์ตั้งโต๊ะ<\/option>/);
  assert.match(add, /<option value="active" selected>ใช้งาน<\/option>/);
  assert.match(add, /ห้ามใส่รหัสผ่านหรือ License key/);
  const edit = pages.deviceFormCard({ mode: "edit", values: model.deviceFormValues({ ...DEVICE, kind: "laptop", status: "retired", note: XSS }) });
  assert.match(edit, /name="code"[^>]*value="COM05" readonly/);
  assert.match(edit, /<option value="laptop" selected>โน้ตบุ๊ก<\/option>/);
  assert.match(edit, /<option value="retired" selected>ยกเลิกการใช้งาน<\/option>/);
  assert.match(edit, /name="started_on" type="text" data-date-text[^>]*value="01\/04\/2566"/);
  assert.match(edit, /id="itrp-device-started-hint">พิมพ์เป็น วว\/ดด\/ปปปป/);
  assert.match(edit, /รหัสแก้ไม่ได้หลังสร้าง/);
  assert.match(edit, /แก้ข้อมูลเครื่อง COM05/);
  assert.doesNotMatch(edit, /<img/);
});

test("the revisions card lists each earlier version with who, when and why, and says so when nothing was edited", () => {
  const data = { entry: { id: 7, doc_no: "IT01-16/0001", created_by_full_name: "สุริยา", created_at: "2026-11-23T01:00:00Z", voided_at: "2026-11-24T01:00:00Z", void_reason: "ลงผิด" } };
  const revisions = model.revisionsView({ revisions: [{ revision_no: 1, change_kind: "void", snapshot: { doc_no: "IT01-16/0001", symptom: XSS }, changed_by_full_name: "สุริยา", reason: "ลงผิด", created_at: "2026-11-24T01:00:00Z" }] });
  const html = pages.revisionsCard(data, revisions);
  assert.match(html, /รอยแก้ของรายการ IT01-16\/0001/);
  assert.match(html, /ครั้งที่ 1 · ยกเลิกรายการ/);
  assert.match(html, /เหตุผล:<\/strong> ลงผิด/);
  assert.match(html, /ยกเลิกรายการแล้ว: ลงผิด/);
  assert.match(html, /ลงโดย สุริยา/);
  assert.doesNotMatch(html, /<img/);
  assert.match(pages.revisionsCard({ entry: {} }, []), /รายการนี้ยังไม่เคยถูกแก้ไข/);
});

/* ---------- ใบพิมพ์ FM02 ---------- */
test("the FM02 sheet has the title, the info block, a 7-column ruled table and the form code", () => {
  const html = pages.printSheet(DATA);
  assert.match(html, /^<article class="itrp-sheet itrp-fm02"/);
  assert.match(html, /<img class="itrp-sheet-logo" src="\.\/icons\/icon-192\.png"/, "the same logo as the repair request sheet");
  assert.match(html, /<h1>ประวัติการซ่อมเครื่องคอมพิวเตอร์<\/h1><p>\(Computer&#039;s Repair Record\)<\/p>/);
  for (const [label, value] of [["เริ่มใช้วันที่", "01/04/2566"], ["Computer Code", "COM05"], ["User", "สมชาย"], ["Section", "บัญชี"], ["Processor", "Intel Core i5 10400"]]) {
    assert.match(html, new RegExp(`<dt>${label}:</dt><dd>${value}</dd>`), label);
  }
  assert.match(html, /<div class="itrp-fm02-asset"><span>เลขทะเบียนทรัพย์สินทางบัญชี<\/span><strong>AS-100<\/strong><\/div>/);
  assert.deepEqual([...html.matchAll(/<th scope="col">([^<]*)</g)].map((match) => match[1]), pages.FM02_COLUMNS, "7 columns: เลขที่ใบแจ้งซ่อม · วันที่ · อาการเสีย · การแก้ไข · ซ่อมเสร็จ · ข้อเสนอแนะ · ผู้แจ้ง");
  assert.match(html, /<table class="itrp-sheet-table itrp-fm02-table"><thead>/, "the header lives in a thead so it repeats on every page");
  assert.equal(count(html, /<tbody>[\s\S]*<\/tbody>/g), 1);
  assert.equal(count(html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>")), /<tr>/g), 3);
  assert.match(html, /<tfoot><tr><td class="itrp-fm02-code" colspan="7">IT01-FM02<\/td><\/tr><\/tfoot>/, "the form code sits in a tfoot (repeats per page, never overlaps rows)");
  assert.match(html, /<td class="itrp-center">05\/03\/2559<\/td>/, "dates are dd/mm/yyyy in the Buddhist year");
  assert.doesNotMatch(html, /นำเข้าจาก Excel|ลงย้อนหลัง|ใบในระบบ|data-hist/, "no screen-only tags or buttons on paper");
  assert.doesNotMatch(html, /itrp-watermark/);
});

test("the FM02 sheet shows dashes for a machine not in the register, a message when empty, a test watermark and escapes text", () => {
  const html = pages.printSheet({ code: "OLD1", is_test: true, device: null, rows: [] });
  assert.match(html, /<dt>User:<\/dt><dd>-<\/dd>/);
  assert.match(html, /<strong>-<\/strong>/);
  assert.match(html, /ยังไม่มีประวัติการซ่อม/);
  assert.match(html, /itrp-watermark/);
  assert.match(html, /ข้อมูลทดสอบ — ไม่ใช่เอกสารจริง/);
  assert.doesNotMatch(pages.printSheet({ code: XSS, device: { ...DEVICE, user_name: XSS }, rows: [{ ...ROWS[0], symptom: XSS, reporter_name: XSS, doc_no: XSS }] }), /<img src=x/);
});

test("the print page wraps the sheet with a toolbar that is not printed and no development banner", () => {
  const html = pages.printPage(DATA);
  assert.match(html, /<div class="itrp-print-toolbar no-print">/);
  assert.match(html, /href="#\/office\?module=repair&amp;view=history&amp;code=COM05">‹ กลับไปประวัติการซ่อม</);
  assert.match(html, /id="itrp-history-print-button"/);
  assert.doesNotMatch(html, /itrp-dev-notice/);
  assert.match(html, /class="itrp-version no-print"/);
  assert.ok(!/class="[^"]*no-print[^"]*"[^>]*>[^<]*<article/.test(html));
  assert.match(visibleText(html), /ประวัติการซ่อมเครื่องคอมพิวเตอร์/);
});

/* ---------- CSS / การลงทะเบียนไฟล์ ---------- */
test("the print CSS repeats the table head on every page, repeats the form code in the table foot and reuses the A4 sheet rules", () => {
  const css = read("styles.css");
  assert.match(css, /@media print \{[^}]*\.itrp-fm02-table thead \{ display: table-header-group; \}/);
  assert.match(css, /\.itrp-fm02-table tfoot \{ display: table-footer-group; \}/);
  assert.doesNotMatch(css, /\.itrp-fm02-code[^}]*position: fixed/, "no fixed positioning that could cover the last table row");
  assert.match(css, /\.itrp-fm02-table th:nth-child\(7\)/, "all 7 columns have a width rule");
  assert.match(css, /\.itrp-hist-scroll \{[^}]*border/, "the wide table scrolls inside its own box on a phone");
  assert.match(css, /\.itrp-hist-table \{[^}]*min-width: 1000px/);
  // ใช้เปลือก .itrp-sheet ร่วมกับใบแจ้งซ่อม: กฎซ่อมเมนู/ขอบ A4 ตอนพิมพ์มาจากชื่อ class นี้
  assert.match(pages.printSheet(DATA), /class="itrp-sheet itrp-fm02/);
  assert.match(css, /body:has\(\.itrp-sheet\) :is\(\.sidebar/);
});

test("index.html loads the history pages after itrp-pages.js and before module-itrp.js, with the one shared ?v=", () => {
  const html = read("index.html");
  const at = (file) => html.indexOf(`modules/${file}?v=`);
  assert.ok(at("itrp-model.js") > 0 && at("itrp-model.js") < at("itrp-pages.js") && at("itrp-pages.js") < at("itrp-history-pages.js") && at("itrp-history-pages.js") < at("module-itrp.js"));
  const versions = new Set([...html.matchAll(/(?:modules\/[\w-]+\.js|app\.js|styles\.css)\?v=([\w-]+)/g)].map((match) => match[1]));
  assert.equal(versions.size, 1, "every ?v= is the same");
  assert.ok(read("package.json").includes("scripts/tests/itrp-history-pages.test.mjs"), "this test file is in test:unit");
});
