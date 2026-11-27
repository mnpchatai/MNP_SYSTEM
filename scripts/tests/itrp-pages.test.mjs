import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// HTML ของหน้าใบแจ้งซ่อมคอมพิวเตอร์ (modules/itrp-pages.js): แท็บ รายการ ฟอร์มแจ้งซ่อม/ส่งงาน รายละเอียด ปุ่มตามสิทธิ์ บันทึกการซ่อม และใบพิมพ์ A4
const require = createRequire(import.meta.url);
globalThis.MNP_UI_ICONS = require("../../modules/ui-icons.js");
globalThis.MNP_ITRP_MODEL = require("../../modules/itrp-model.js");
globalThis.MNP_FORM_STEPS = undefined; // ฟอร์มวาดส่วนหัว/ปุ่มของ stepper ผ่าน MNP_FORM_STEPS ถ้ามี (ที่นี่ตรวจเฉพาะช่องของฟอร์ม)
const model = globalThis.MNP_ITRP_MODEL;
const pages = require("../../modules/itrp-pages.js");

const count = (text, pattern) => (text.match(pattern) ?? []).length;
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const XSS = '<img src=x onerror="alert(1)">';
const ID = "00000000-0000-4000-8000-000000000001";

const MINE = [
  { id: ID, doc_no: "IT01-26/050", status: "it_closed", is_urgent: true, asset_code: "PC-001", device_name: "Dell <b>OptiPlex</b>", request_kind: "repair", request_kind_note: null, repair_target: "computer", symptom: "เปิดไม่ติด", created_at: "2026-11-21T01:00:00Z", rework_round: 0 },
  { id: "00000000-0000-4000-8000-000000000002", doc_no: "TEST-IT01-26/001", status: "pending_dept", is_urgent: false, asset_code: null, device_name: "เครื่องพิมพ์", request_kind: "other", request_kind_note: "ล้างหัวพิมพ์", repair_target: "device", symptom: "", created_at: "2026-11-20T17:30:00Z", rework_round: 0 },
];

/* ---------- หัว แท็บ ---------- */
test("the page head has one h1, a back link to IT SUPPORT, the new button, and the test tag only in test mode", () => {
  const head = pages.head({ actions: pages.newButton() });
  assert.equal(count(head, /<h1>/g), 1);
  assert.match(head, /<h1>ใบแจ้งซ่อม<\/h1>/);
  assert.match(head, /href="#\/office\?module=it-support">‹ IT SUPPORT</);
  assert.match(head, /href="#\/office\?module=repair&amp;view=new"[^>]*>.*แจ้งซ่อมใหม่/s);
  assert.doesNotMatch(head, /itrp-test-tag/);
  assert.match(pages.head({ isTest: true }), /<span class="badge itrp-test-tag"[^>]*>ทดสอบ<\/span>/);
});

test("tabs follow the role, show counts, and a lone 'mine' tab is hidden unless something waits for the user", () => {
  const html = pages.tabs({ is_it_admin: true, is_dept_approver: true }, "approvals", { mine: 2, mineParts: { confirm: 1, answer: 1 }, approvals: 3, it: 100 });
  assert.deepEqual([...html.matchAll(/class="view-tab[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1].trim()), ["ใบของฉัน", "รออนุมัติ", "งาน IT", "ประวัติการซ่อม", "ตั้งค่า"]);
  assert.match(html, /aria-current="page" href="#\/office\?module=repair&amp;view=approvals"/);
  assert.match(html, /aria-label="2 รายการ \(รอคุณยืนยัน 1 · รอคุณตอบ 1\)"/);
  assert.match(html, />99\+</);
  assert.equal(pages.tabs({}, "mine", {}), "");
  assert.match(pages.tabs({}, "mine", { mine: 1 }), /<nav class="view-tabs"/);
});

/* ---------- รายการ ---------- */
test("the 'mine' list shows the device as the subject, the request kind and symptom beneath, and escapes user text", () => {
  const html = pages.mineList(MINE);
  assert.match(html, /IT01-26\/050/);
  assert.match(html, /PC-001 · Dell &lt;b&gt;OptiPlex&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /ซ่อม · เปิดไม่ติด/);
  assert.match(html, /อื่นๆ · ล้างหัวพิมพ์/);
  assert.match(html, /IT ส่งงานแล้ว รอคุณยืนยัน/);
  assert.match(html, /urgent-flag/);
  assert.doesNotMatch(visibleText(html), /ต้องการงาน|ใบสั่งงาน/, "no needed-date column in repair requests");
  assert.match(pages.mineList([]), /ยังไม่มีใบแจ้งซ่อมที่คุณแจ้ง/);
  assert.doesNotMatch(pages.mineList(MINE.map((row) => ({ ...row, device_name: XSS, symptom: XSS }))), /<img/);
});

test("the approvals list separates requests waiting for me from those waiting for the requester", () => {
  const rows = [
    { ...MINE[1], status: "pending_dept", pending_step: "dept", requester_name: "สมชาย", department_name: "การตลาด" },
    { ...MINE[0], status: "need_info", pending_step: "it_mgr", info_stage: "it_mgr", info_return_status: "pending_it_mgr", requester_name: "สมหญิง", department_name: "บัญชี" },
  ];
  const html = pages.approvalsList(rows);
  assert.match(html, /รอคุณอนุมัติขั้นผู้จัดการแผนก/);
  assert.match(html, /data-group="awaiting_info"/);
  assert.match(html, /สมชาย · การตลาด/);
  assert.match(pages.approvalsList([]), /ไม่มีใบแจ้งซ่อมที่รออนุมัติจากคุณ/);
});

test("the IT list groups by status and folds the closed group", () => {
  const html = pages.itList([
    { ...MINE[0], status: "approved", has_dept_approved: true, has_it_mgr_approved: true, requester_full_name: "ก", department_name: "ข" },
    { ...MINE[1], status: "received", has_dept_approved: true, has_it_mgr_approved: true },
  ]);
  assert.match(html, /data-group="to_start"/);
  assert.match(html, /<details class="card detail-section itrp-group" data-group="closed"/);
  assert.equal(count(html, /itrp-step is-done/g), 4, "2 requests x 2 approval steps");
  assert.match(pages.itList([]), /ยังไม่มีใบแจ้งซ่อม/);
});

/* ---------- ฟอร์มแจ้งซ่อม ---------- */
test("the repair form has the paper form's fields and none of the work order's", () => {
  const html = pages.orderForm({ requester: { name: "สมชาย", department: "การตลาด" } });
  for (const field of ["asset_code", "device_name", "request_kind", "request_kind_note", "repair_target", "repair_target_note", "symptom"]) assert.match(html, new RegExp(`data-field="${field}"`), field);
  assert.equal(count(html, /name="request_kind" value=/g), 5);
  assert.equal(count(html, /name="repair_target" value=/g), 3);
  assert.match(html, /name="is_urgent"/);
  assert.match(html, /id="itrp-files"[^>]*multiple/);
  assert.match(html, /data-attachment-limit="per-file"/);
  assert.match(html, /id="itrp-kind-note-field" hidden/);
  assert.match(html, /id="itrp-target-note-field" hidden/);
  assert.match(html, /ผู้แจ้ง สมชาย · การตลาด/);
  for (const gone of ["needed_date", "order_ref", "attachment_flag", "misc_detail", "request_type\""]) assert.doesNotMatch(html, new RegExp(gone), gone);
  assert.doesNotMatch(visibleText(html), /ใบสั่งงาน|วันที่ต้องการงาน|ออเดอร์/);
  assert.equal(count(html, /data-step="/g), 4, "kind, machine, symptom, review");
  assert.ok(html.indexOf('data-field="request_kind"') < html.indexOf('data-field="asset_code"') && html.indexOf('data-field="asset_code"') < html.indexOf('data-field="symptom"'), "the request kind comes before the machine");
  assert.doesNotMatch(html, /itrp-host-input/, "the old fields are used when the database has no register lookup");
});

test("the picker form: host search only (no 'unknown host' tick), device types after confirming, no old machine fields", () => {
  const html = pages.orderForm({ requester: { name: "สมชาย", department: "การตลาด" }, picker: true });
  assert.match(html, /id="itrp-host-input"[^>]*autocapitalize="characters"[^>]*placeholder="เช่น COM24"/);
  assert.match(html, /id="itrp-host-search"[^>]*>ค้นหา<\/button>/);
  assert.doesNotMatch(html, /host-unknown|host_unknown|ไม่ทราบรหัสเครื่อง|ไม่มีคอมประจำ/, "the way around the lookup is gone");
  assert.match(html, /data-field="devices"/);
  assert.match(html, /ค้นหารหัสเครื่องคอมของคุณก่อน แล้วจึงเลือกอุปกรณ์ที่มีปัญหาได้/, "no device types until the host is found");
  assert.equal(count(html, /data-pick-type="/g), 0);
  for (const gone of ['data-field="asset_code"', 'data-field="device_name"', 'name="repair_target"']) assert.doesNotMatch(html, new RegExp(gone), gone);
  assert.equal(count(html, /data-step="/g), 4);
});

test("host status: found card, not found, error, loading", () => {
  const host = model.normalizeLookup({ found: true, host: { code: "COM24", type_code: "COMPUTER", name: "Dell OptiPlex", model: "3080", user_name: "สมชาย" }, devices: [] });
  const found = pages.hostStatus({ host, lookup: "idle" });
  assert.match(found, /<strong>COM24<\/strong><span> · Dell OptiPlex · 3080 · ผู้ใช้ สมชาย<\/span>/);
  assert.match(pages.hostStatus({ lookup: "notfound" }), /ไม่พบรหัสนี้ในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT/);
  assert.match(pages.hostStatus({ lookup: "error" }), /ค้นหาไม่สำเร็จ ตรวจอินเทอร์เน็ต/);
  assert.doesNotMatch(pages.hostStatus({ lookup: "error" }) + pages.hostStatus({ lookup: "notfound" }), /ไม่ทราบรหัส/);
  assert.match(pages.hostStatus({ lookup: "error", message: "ไม่พบบัญชีพนักงาน" }), /ไม่พบบัญชีพนักงาน/);
  assert.doesNotMatch(pages.hostStatus({ lookup: "error", message: "ไม่พบบัญชีพนักงาน" }), /ตรวจอินเทอร์เน็ต/);
  assert.match(pages.hostStatus({ lookup: "loading" }), /กำลังค้นหา/);
  assert.equal(pages.hostStatus({}), "");
  const hostile = pages.hostStatus({ host: { ...host, code: XSS, name: XSS, model: "", user_name: "" } });
  assert.doesNotMatch(hostile, /<img/);
});

test("device types: ticking shows rows, several registered devices get a tick each, unknown register shows the hint, other needs a note field", () => {
  const host = model.normalizeLookup({ found: true, host: { code: "COM24", type_code: "COMPUTER" }, devices: [
    { type_code: "MONITOR", code: "MNT53", name: "จอ Dell", model: "P2419H" }, { type_code: "MONITOR", code: "MNT54", name: "จอ Dell", model: "P2419H" }, { type_code: "MOUSE", code: "MOU09" },
  ] });
  const ctx = { host };
  let picks = [];
  for (const key of ["COMPUTER", "MONITOR", "MOUSE", "PRINTER", "OTHER"]) picks = model.toggleType(picks, key, ctx);
  const html = pages.pickTypes({ host, picks });
  assert.equal(count(html, /data-pick-type="/g), 8, "every type has a tick");
  assert.equal(count(html, /data-pick-type="[A-Z]+" checked/g), 5);
  assert.equal(count(html, /data-pick-use="/g), 2, "only the two monitors have a per-device tick");
  assert.match(html, /data-pick-code="0"[^>]*value="COM24"/, "the computer code is filled from the host");
  assert.match(html, /value="MNT53"/);
  assert.match(html, /value="MOU09"/);
  assert.match(html, /จอ Dell · P2419H/, "the register name/model sits under the code");
  assert.match(html, /<datalist id="itrp-pick-codes-MONITOR"><option value="MNT53"/);
  assert.match(html, /ไม่มีรายการในทะเบียน พิมพ์รหัสเอง ไม่ทราบเว้นว่างได้ IT จะเติมให้/, "printer has no registered device");
  assert.match(html, /data-pick-note="\d+"[^>]*placeholder="ระบุอุปกรณ์ \(จำเป็น\)/, "other has a required text box");
  assert.equal(count(html, /data-pick-add="/g), 4, "the computer cannot add a row; monitor, mouse, printer and other can");
  assert.doesNotMatch(html, /data-pick-remove/, "register rows cannot be removed");
  const added = pages.pickTypes({ host, picks: model.addPickRow(picks, "MOUSE") });
  assert.match(added, /data-pick-remove="\d+"/);
  assert.match(pages.pickTypes({ host: null, picks: [] }), /ค้นหารหัสเครื่องคอมของคุณ/);
  assert.equal(count(pages.pickTypes({ host: null, hostUnknown: true, picks: [] }), /data-pick-type="/g), 0, "an old 'unknown' flag opens nothing");
  const escaped = pages.pickTypes({ host, picks: [{ type_code: "OTHER", code: XSS, on: true, note: XSS, added: false, meta: XSS }] });
  assert.doesNotMatch(escaped, /<img/);
});

test("the picker review lists the host and the chosen devices", () => {
  const host = model.normalizeLookup({ found: true, host: { code: "COM24", type_code: "COMPUTER", name: "Dell", user_name: "สมชาย" }, devices: [{ type_code: "MOUSE", code: "MOU09" }] });
  const picks = model.toggleType(model.toggleType([], "MOUSE", { host }), "COMPUTER", { host });
  const html = pages.orderReview({ request_kind: "repair", symptom: "เปิดไม่ติด", is_urgent: false, host, picks }, [], { picker: true });
  assert.match(html, /เครื่องคอมของคุณ<\/dt><dd class="review-text">COM24 · Dell · ผู้ใช้ สมชาย/);
  assert.match(html, /อุปกรณ์ที่มีปัญหา<\/dt><dd class="review-text">คอมพิวเตอร์ COM24 · เมาส์ MOU09/);
  assert.doesNotMatch(html, /ประเภทงานซ่อม/);
  assert.doesNotMatch(html, /ไม่ทราบรหัส/);
});

test("the review step shows only filled fields and escapes text", () => {
  const html = pages.orderReview({ asset_code: "", device_name: XSS, request_kind: "other", request_kind_note: "ล้างเครื่อง", repair_target: "computer", repair_target_note: "", symptom: "เปิดไม่ติด", is_urgent: true }, [{ name: "a.jpg", size: 2048 }]);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /รหัสเครื่องคอมพิวเตอร์/, "an empty asset code is not listed");
  assert.match(html, /อื่นๆ · ล้างเครื่อง/);
  assert.match(html, /1 ไฟล์: a\.jpg \(2\.0 KB\)/);
  assert.match(html, /งานด่วน/);
  assert.doesNotMatch(pages.orderReview({ symptom: "x" }), /ไฟล์แนบ/);
});

test("the upload panel summarises progress and offers retry only when something failed", () => {
  const rows = [{ name: "a.jpg", size: 10, state: "done", message: "" }, { name: "b.pdf", size: 10, state: "failed", message: "ใหญ่เกิน" }];
  const html = pages.uploadPanel({ heading: "แจ้งซ่อมแล้ว · เลขที่ IT01-26/050", rows });
  assert.match(html, /แนบไม่สำเร็จ 1 จาก 2 ไฟล์ \(แนบแล้ว 1\)/);
  assert.match(html, /id="itrp-upload-retry"/);
  assert.match(html, /ไปที่ใบแจ้งซ่อม/);
  assert.doesNotMatch(pages.uploadPanel({ heading: "x", rows: [rows[0]] }), /itrp-upload-retry/);
  assert.match(pages.uploadPanel({ heading: "x", rows, busy: true }), /aria-busy="true"/);
});

/* ---------- รายละเอียด ---------- */
const REPORT = { id: "r2", completed_event_id: 9, completed_at: "2026-11-22T03:00:00Z", completed_by_full_name: "ช่าง ไอที", cause: "แรมเสื่อม", cause_kind: "other", cause_kind_note: "ไฟตก", repair_method: "sent_out", repair_vendor: "ร้าน ก.", repair_action: "เปลี่ยนแรม", pr_po_no: "PO-9",
  parts: [{ line_no: 1, item_name: "RAM 8GB", quantity: 2, price: 1250.5, note: "ใหม่" }, { line_no: 2, item_name: "สาย", quantity: 1, price: null, note: null }] };
const EARLIER = { ...REPORT, id: "r1", completed_at: "2026-11-21T10:00:00Z", completed_by_full_name: "ช่าง เก่า", cause: "สาเหตุรอบแรก", parts: [] };
function detail(overrides = {}) {
  return {
    id: ID, is_test: false, doc_no: "IT01-26/050", status: "it_closed", is_urgent: false, asset_code: "PC-001", device_name: "Dell OptiPlex", request_kind: "other", request_kind_note: "ล้างเครื่อง", repair_target: "device", repair_target_note: null,
    symptom: "เปิดไม่ติด\nมีเสียงบี๊บ", created_at: "2026-11-21T01:00:00Z", rework_round: 0, latest_due_date: null, requester: { employee_no: "MK1", full_name: "สมหญิง ผู้แจ้ง" }, department: { code: "MK", name_th: "การตลาด" },
    events: [{ id: 1, action: "created", actor_full_name: "สมหญิง ผู้แจ้ง", actor_employee_no: "MK1", created_at: "2026-11-21T01:00:00Z" }],
    reworks: [], attachments: [], comments: [], info_pending: null, rework_open: false,
    approvals: { dept: { by: "สมชาย ผจก.", at: "2026-11-21T02:00:00Z" }, it_mgr: { by: "รสริน เชน", at: "2026-11-21T03:00:00Z" } },
    started: { by: "ช่าง ไอที", at: "2026-11-21T04:00:00Z" }, completed: { by: "ช่าง ไอที", at: "2026-11-22T03:00:00Z" }, received: null,
    repair_report: REPORT, repair_reports: [EARLIER, REPORT], allowed_actions: [], ...overrides,
  };
}

test("the detail page shows the machine facts once, the latest repair report, and earlier sets as folded history", () => {
  const html = pages.detailPage(detail());
  assert.match(html, /<h1>IT01-26\/050<\/h1>/);
  assert.match(html, /ชื่อเครื่องคอมพิวเตอร์ \/ อุปกรณ์.*Dell OptiPlex/s);
  assert.match(html, /อื่นๆ · ล้างเครื่อง/);
  assert.match(html, /itrp-text">เปิดไม่ติด\nมีเสียงบี๊บ/);
  assert.match(html, /บันทึกการซ่อม \(สำหรับแผนก IT\)/);
  assert.match(html, /อื่นๆ · ไฟตก/);
  assert.match(html, /ส่งซ่อมที่ ร้าน ก\./);
  assert.match(html, /PO-9/);
  assert.match(html, /RAM 8GB/);
  assert.match(html, /1,250\.50/);
  assert.match(html, /<th scope="col">ราคาต่อหน่วย<\/th>/, "the detail table header says unit price");
  assert.match(html, /รวมเวลาในการซ่อม.*5 ชม\./s); // นับเฉพาะเวลาทำงาน: เสาร์ 11:00 → อาทิตย์ 10:00 = 11–12 + 13–17
  assert.match(html, /<details class="card itrp-report-history">/);
  assert.match(html, /สาเหตุรอบแรก/);
  assert.equal(count(html, /id="itrp-report-title"/g), 1);
  assert.equal(count(html, /สรุปสาเหตุเกิดจาก/g), 2, "one in the latest report and one in the earlier set");
  assert.doesNotMatch(visibleText(html), /ใบสั่งงาน/);
  assert.match(html, /href="#\/office\?module=repair&amp;view=print&amp;id=00000000/);
});

test("a request that was never sent has no repair report card, and values are escaped", () => {
  const html = pages.detailPage(detail({ repair_report: null, repair_reports: [], symptom: XSS, device_name: XSS, status: "in_progress" }));
  assert.doesNotMatch(html, /บันทึกการซ่อม/);
  assert.doesNotMatch(html, /<img/);
});

test("buttons and forms are drawn only for the actions the database allows", () => {
  const none = pages.detailPage(detail());
  assert.doesNotMatch(none, /data-itrp-action|itrp-complete-card|itrp-rework-card|itrp-ask-card|itrp-answer-card/);
  const it = pages.detailPage(detail({ status: "in_progress", allowed_actions: ["start", "complete", "request_info", "cancel"] }));
  for (const action of ["start", "complete", "request_info", "cancel"]) assert.match(it, new RegExp(`data-itrp-action="${action}"`), action);
  assert.match(it, /id="itrp-complete-card"[^>]*hidden/);
  assert.match(it, /id="itrp-ask-card"[^>]*hidden/);
  assert.doesNotMatch(it, /itrp-rework-card/);
  const requester = pages.detailPage(detail({ allowed_actions: ["receive", "request_rework"] }));
  assert.match(requester, /data-itrp-action="receive"/);
  assert.match(requester, /id="itrp-rework-card"[^>]*hidden/);
  assert.doesNotMatch(requester, /itrp-complete-card/);
  const answering = pages.detailPage(detail({
    status: "need_info", allowed_actions: ["provide_info", "cancel"], info_return_status: "pending_it_mgr",
    info_pending: { comment_id: 5, stage: "it_mgr", body: "รุ่นอะไร", asked_at: "2026-11-21T05:00:00Z", asked_by_full_name: "รสริน เชน" },
    comments: [{ id: 5, kind: "question", stage: "it_mgr", body: "รุ่นอะไร", created_at: "2026-11-21T05:00:00Z", author_full_name: "รสริน เชน", attachments: [] }],
  }));
  assert.match(answering, /id="itrp-answer-card"/);
  assert.doesNotMatch(answering, /data-itrp-action="provide_info"/, "the answer form is open, so no duplicate button");
  assert.equal(count(answering, /รุ่นอะไร/g), 1, "the pending question is shown once");
  assert.match(answering, /ตอบแล้วใบจะกลับไปที่ รอผู้อนุมัติขั้น IT/);
});

test("the complete form has a devices section before the parts table: code rows with datalist, optional notes, and a no-device tick", () => {
  const html = pages.completeFormCard({ assetCode: "com05 " });
  assert.ok(html.indexOf('data-field="devices"') > 0 && html.indexOf('data-field="devices"') < html.indexOf('data-field="parts"'), "devices come before parts");
  assert.equal(count(html, /data-device-row/g), 1, "starts with one row");
  assert.match(html, /name="device_code" list="itrp-device-codes"[^>]*autocapitalize="characters"[^>]*value="COM05"/, "the requester's code is prefilled in capitals");
  assert.match(html, /<datalist id="itrp-device-codes"><\/datalist>/);
  assert.match(html, /name="device_remark"[^>]*maxlength="500"/);
  assert.match(html, /<details class="itrp-device-notes">/, "the per-device notes are folded when empty");
  assert.match(html, /name="device_symptom"[^>]*maxlength="2000"/);
  assert.match(html, /name="device_action"[^>]*maxlength="2000"/);
  assert.match(html, /id="itrp-device-add"/);
  assert.match(html, /ไม่เกิน 10 เครื่อง/);
  assert.match(html, /id="itrp-no-device"[^>]*> <span>งานนี้ไม่มีรหัสเครื่อง \(เช่น งานเครือข่าย\)<\/span>/);
  assert.match(html, /id="itrp-devices-wrap"/);
  assert.ok(html.indexOf('id="itrp-no-device"') > html.indexOf('id="itrp-device-add"'), "the tick sits under the table so the first focus on error is the first code input");
  assert.match(pages.completeFormCard(), /name="device_code"[^>]*value=""/);
  const noted = pages.deviceRow(1, { device_code: XSS, remark: XSS, symptom_note: "จอดับ", action_note: "" });
  assert.match(noted, /itrp-device-no" aria-hidden="true">2</);
  assert.match(noted, /<details class="itrp-device-notes" open>/, "a row with notes opens its folded part");
  assert.doesNotMatch(noted, /<img/);
  assert.match(noted, /aria-label="รหัสเครื่อง แถวที่ 2"/);
  assert.match(noted, /data-device-remove aria-label="ลบแถวที่ 2"/);
});

test("codeOptions builds datalist options with the register details as the label", () => {
  const html = pages.codeOptions([{ code: "COM05", user_name: "สมชาย", division: "บัญชี" }, { code: XSS }]);
  assert.match(html, /<option value="COM05" label="COM05 · สมชาย · บัญชี"><\/option>/);
  assert.doesNotMatch(html, /<img/);
  assert.equal(pages.codeOptions(undefined), "");
});

test("the report on the detail page lists the repaired devices with their notes, and a report without devices (or an old database) still renders", () => {
  const report = { id: "r1", completed_at: "2026-11-21T03:00:00Z", completed_by_full_name: "ช่าง", cause: "c", cause_kind: "usage", repair_method: "internal", repair_action: "a", parts: [],
    devices: [{ seq: 2, device_code: "PRT22", symptom_note: null, action_note: "ล้างหัวพิมพ์", remark: "ควรเปลี่ยนตลับ" }, { seq: 1, device_code: "COM05", symptom_note: "จอดับ", action_note: null, remark: null }] };
  const html = pages.reportCards({ repair_report: report, repair_reports: [report] });
  assert.match(html, /เครื่อง \/ อุปกรณ์ที่ซ่อม/);
  assert.ok(html.indexOf("COM05") < html.indexOf("PRT22"), "devices in seq order");
  assert.match(html, /ล้างหัวพิมพ์/);
  assert.match(html, /ควรเปลี่ยนตลับ/);
  const without = pages.reportCards({ repair_report: { ...report, devices: undefined }, repair_reports: [{ ...report, devices: undefined }] });
  assert.doesNotMatch(without, /เครื่อง \/ อุปกรณ์ที่ซ่อม/);
  assert.match(without, /บันทึกการซ่อม/);
  assert.equal(pages.devicesTable([]), "");
});

test("the complete form has the IT section fields, a parts table of up to 10 rows, and unit price wording", () => {
  const html = pages.completeFormCard();
  for (const field of ["cause", "cause_kind", "cause_kind_note", "repair_method", "repair_vendor", "repair_action", "pr_po_no", "parts"]) assert.match(html, new RegExp(`data-field="${field}"`), field);
  assert.equal(count(html, /name="cause_kind" value=/g), 3);
  assert.equal(count(html, /name="repair_method" value=/g), 3);
  assert.match(html, /id="itrp-cause-note-field" hidden/);
  assert.match(html, /id="itrp-vendor-field" hidden/);
  assert.match(html, /<th scope="col">ราคาต่อหน่วย \(บาท\)<\/th>/);
  assert.match(html, /name="part_price"[^>]*aria-label="ราคาต่อหน่วย \(บาท\) แถวที่ 1"/);
  assert.equal(count(html, /data-part-row/g), 1, "starts with one row");
  assert.match(html, /id="itrp-part-add"/);
  assert.match(html, /ไม่เกิน 10 แถว/);
  assert.match(html, /<button type="submit" class="btn is-primary">ส่งงาน<\/button>/);
  const row = pages.partRow(2, { item_name: XSS, quantity: "1", price: "5", note: "x" });
  assert.match(row, /itrp-part-no" data-label="ลำดับ">3</);
  assert.doesNotMatch(row, /<img/);
  assert.match(row, /data-part-remove aria-label="ลบแถวที่ 3"/);
  // เลขสูงสุดที่ model รับ (8 หลัก + ทศนิยม 2 ตำแหน่ง ใส่จุลภาคคั่นหลัก = 13 ตัวอักษร) ต้องพิมพ์ลงช่องได้ครบ
  const longest = "99,999,999.99".length;
  for (const field of ["part_quantity", "part_price"]) {
    const limit = Number(row.match(new RegExp(`name="${field}"[^>]*maxlength="([0-9]+)"`))?.[1]);
    assert.ok(limit >= longest, `${field} accepts the largest number the form allows (${limit} >= ${longest})`);
  }
  assert.match(pages.vendorLabel(model.vendorField("sent_out")), /สถานที่ส่งซ่อม.*จำเป็น/);
  assert.doesNotMatch(pages.vendorLabel(model.vendorField("external_onsite")), /จำเป็น/);
});

test("rework rounds, files and the question/answer history", () => {
  const html = pages.detailPage(detail({
    reworks: [{ id: "w1", round_no: 1, details: "ยังไม่หาย", due_date: "2026-11-30", created_at: "2026-11-22T05:00:00Z", requested_by_full_name: "สมหญิง ผู้แจ้ง" }],
    attachments: [{ id: "f1", rework_id: null, round_no: 0, file_name: "รูป.jpg", mime_type: "image/jpeg", size_bytes: 2048 }, { id: "f2", rework_id: "w1", round_no: 1, file_name: "b.pdf", mime_type: "application/pdf", size_bytes: 10 }],
    rework_round: 1, latest_due_date: "2026-11-30",
  }));
  assert.match(html, /id="attachment-gallery"/);
  assert.match(html, /ประวัติการแก้ไขงาน/);
  assert.match(html, /แก้ไขครั้งที่ 1/);
  assert.match(html, /กำหนดเสร็จ 30\/11\/2569/);
  assert.equal(count(html, /data-attachment-open=/g), 2);
  assert.doesNotMatch(pages.detailPage(detail()), /id="attachment-gallery"/);
});

test("the timeline lists each event with who and when, and labels a cancellation by IT on behalf of the requester", () => {
  const html = pages.historyCard([
    { action: "created", actor_full_name: "สมหญิง", actor_employee_no: "MK1", created_at: "2026-11-21T01:00:00Z" },
    { action: "cancelled", actor_full_name: "ไอที", actor_employee_no: "IT1", reason: "IT ยกเลิกแทนผู้แจ้ง: เหตุ <b>x</b>", created_at: "2026-11-21T03:05:00Z" },
  ], { employee_no: "MK1" });
  assert.match(html, /<strong>แจ้งซ่อม<\/strong>/);
  assert.match(html, /<strong>IT ยกเลิกแทนผู้แจ้ง<\/strong>/);
  assert.match(html, /21\/11\/2569 10:05/);
  assert.match(html, /เหตุ &lt;b&gt;x&lt;\/b&gt;/);
});

/* ---------- ใบพิมพ์ A4 ---------- */
const sheet = (overrides) => pages.printSheet(detail(overrides));
const selected = (html, group) => [...html.matchAll(/data-option="(\w+)" data-selected="1"/g)].map((match) => match[1]).filter((value) => group.includes(value));

test("the sheet has the paper form's blocks in order with the right title and number box", () => {
  const html = sheet({ status: "received", received: { by: "สมหญิง ผู้แจ้ง", at: "2026-11-23T04:00:00Z" } });
  assert.match(html, /<h1>ใบแจ้งซ่อมคอมพิวเตอร์<\/h1>/);
  assert.match(html, /เลขที่ใบแจ้งซ่อม<\/span><strong>IT01-26\/050<\/strong>/);
  const labels = ["ผู้แจ้งซ่อม", "หน่วยงาน", "วันที่แจ้งซ่อม", "เวลา", "รหัสเครื่องคอมพิวเตอร์", "ประเภทคำขอ", "ประเภทงานซ่อม", "ระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น", "ลงชื่อผู้อนุมัติ", "สำหรับแผนก IT.", "สาเหตุ", "สรุปสาเหตุเกิดจาก", "การตรวจซ่อม", "การซ่อม-แก้ไขที่เกิดขึ้น", "เอกสารสำคัญอ้างอิง ใบ PR./PO.No.", "รายการอะไหล่ / วัสดุที่ใช้", "เริ่มดำเนินการซ่อม", "ซ่อมเสร็จ", "รวมเวลาในการซ่อม", "ช่างผู้ดำเนินการซ่อม", "สรุปผลการซ่อม", "ใช้งานได้สมบูรณ์", "ส่งแก้ไข", "ส่งมอบงาน (แผนก IT)", "รับมอบงาน", "รับทราบ ฝ่ายบริหาร"];
  let from = 0;
  for (const label of labels) {
    const at = html.indexOf(label, from);
    assert.ok(at >= 0, `${label} appears after the previous block`);
    from = at;
  }
  assert.equal(count(html, /<h1>/g), 1);
  assert.match(html, /<img class="itrp-sheet-logo" src="\.\/icons\/icon-192\.png" alt="">/);
  assert.doesNotMatch(visibleText(html), /ใบสั่งงาน|IT06/);
});

test("request kind and repair target show a filled circle on the chosen option, with the typed text for 'other'", () => {
  const html = sheet();
  assert.deepEqual(selected(html, ["repair", "replace_part", "inspect", "install", "other", "computer", "device"]), ["other", "device", "other"], "kind, target, and the IT report's cause summary");
  assert.match(html, /data-option="other" data-selected="1"><span class="itrp-radio" aria-hidden="true">●<\/span> อื่นๆ \(ระบุ: ล้างเครื่อง\)/);
  assert.equal(count(html, /○/g) >= 6, true, "unchosen options are open circles");
  const plain = sheet({ request_kind: "repair", request_kind_note: null, repair_target: "computer" });
  assert.deepEqual(selected(plain, ["repair", "replace_part", "inspect", "install"]), ["repair"]);
  assert.doesNotMatch(plain, /ระบุ: \)/, "no empty 'specify' text on options that are not 'other'");
});

test("the IT section comes from the latest report: cause summary, repair method with place/name, PR/PO and the parts table", () => {
  const html = sheet();
  assert.deepEqual(selected(html, ["usage", "part_expired"]), []);
  assert.match(html, /data-option="other" data-selected="1"><span class="itrp-radio" aria-hidden="true">●<\/span> อื่นๆ \(ระบุ: ไฟตก\)/);
  assert.match(html, /data-option="sent_out" data-selected="1">.*ส่งซ่อมที่ <span class="itrp-underline">ร้าน ก\.<\/span>/s);
  assert.match(html, /<td class="itrp-sheet-text">เปลี่ยนแรม<\/td>/);
  assert.match(html, /<td>PO-9<\/td>/);
  assert.match(html, /<th>ราคา<\/th>/, "the printed column keeps the paper form's word");
  assert.doesNotMatch(html, /ราคาต่อหน่วย/);
  assert.match(html, /<td class="itrp-right">1,250\.50<\/td>/);
  assert.doesNotMatch(html, /EARLIER|สาเหตุรอบแรก/, "earlier report sets are not printed");
  const external = sheet({ repair_report: { ...REPORT, repair_method: "external_onsite", repair_vendor: "นายช่างบี" } });
  assert.match(external, /data-option="external_onsite" data-selected="1">.*\(นายช่างบี\)/s);
});

test("the parts table has at least 4 rows and grows past that", () => {
  const rows = (html) => count(html.slice(html.indexOf("itrp-sheet-parts")), /<tr/g) - 1; // ไม่นับแถวหัวตาราง
  assert.equal(rows(sheet()) >= 4, true);
  assert.equal(count(sheet(), /itrp-part-blank/g), 2, "2 filled + 2 blank = 4");
  const none = sheet({ repair_report: null, repair_reports: [] });
  assert.equal(count(none, /itrp-part-blank/g), 4);
  const many = Array.from({ length: 7 }, (_, index) => ({ line_no: index + 1, item_name: `อะไหล่ ${index + 1}`, quantity: 1, price: 10, note: null }));
  const long = sheet({ repair_report: { ...REPORT, parts: many } });
  assert.equal(count(long, /itrp-part-blank/g), 0);
  assert.match(long, /อะไหล่ 7/);
});

test("a request that was never sent has an empty IT section (open circles, empty cells) but a full request section", () => {
  const html = sheet({ repair_report: null, repair_reports: [], completed: null, started: null, status: "approved" });
  assert.deepEqual(selected(html, ["usage", "part_expired", "internal", "external_onsite", "sent_out"]), []);
  assert.match(html, /Dell OptiPlex/);
  assert.match(html, /<th scope="row">สาเหตุ<\/th><td class="itrp-sheet-text"><\/td>/);
});

test("start, finish, total time and the technician come from the events", () => {
  const html = sheet();
  assert.match(html, /เริ่มดำเนินการซ่อม<\/th><td>วันที่ 21\/11\/2569 เวลา 11:00<\/td>/);
  assert.match(html, /ซ่อมเสร็จ<\/th><td>วันที่ 22\/11\/2569 เวลา 10:00<\/td>/);
  assert.match(html, /รวมเวลาในการซ่อม<\/th><td>5 ชม\.<\/td>/); // เวลาทำงานเท่านั้น (เสาร์ 11:00 → อาทิตย์ 10:00)
  assert.match(html, /ช่างผู้ดำเนินการซ่อม<\/th><td>ช่าง ไอที<\/td>/);
  const blank = sheet({ started: null, completed: null });
  assert.match(blank, /เริ่มดำเนินการซ่อม<\/th><td>วันที่ <span class="itrp-blank-line"><\/span> เวลา <span class="itrp-blank-line"><\/span><\/td>/);
  assert.match(blank, /รวมเวลาในการซ่อม<\/th><td><span class="itrp-blank-line"><\/span><\/td>/);
});

test("outcome boxes: 'complete' ticks after the requester confirms, 'rework' while a rework request is open, never both by default", () => {
  const outcome = (html, key) => html.match(new RegExp(`data-outcome="${key}">([^]*?)</span> ?[^<]*`))?.[0] ?? "";
  const sent = sheet();
  assert.match(outcome(sent, "complete"), /☐/);
  assert.match(outcome(sent, "rework"), /☐/);
  const done = sheet({ status: "received", received: { by: "สมหญิง ผู้แจ้ง", at: "2026-11-23T04:00:00Z" } });
  assert.match(outcome(done, "complete"), /☑/);
  assert.match(outcome(done, "rework"), /☐/);
  const rework = sheet({ status: "in_progress", rework_open: true });
  assert.match(outcome(rework, "rework"), /☑/);
  assert.match(outcome(rework, "complete"), /☐/);
  assert.match(rework, /ส่งแก้ไข เลขที่ <span class="itrp-blank-line"><\/span>/, "the number is left blank");
});

test("signatures: approver, delivery, receipt (the requester) and management acknowledgement carry name and time", () => {
  const html = sheet({ status: "received", received: { by: "สมหญิง ผู้แจ้ง", at: "2026-11-23T04:00:00Z" } });
  const block = (key) => html.slice(html.indexOf(`data-slot="${key}"`), html.indexOf(`data-slot="${key}"`) + 400);
  assert.match(block("approver"), /ลงชื่อผู้อนุมัติ.*สมชาย ผจก\..*21\/11\/2569 09:00/s);
  assert.match(block("delivered"), /ส่งมอบงาน \(แผนก IT\).*ช่าง ไอที.*22\/11\/2569 10:00/s);
  assert.match(block("received"), /รับมอบงาน.*สมหญิง ผู้แจ้ง.*23\/11\/2569 11:00/s);
  assert.match(block("acknowledged"), /รับทราบ ฝ่ายบริหาร.*รสริน เชน.*21\/11\/2569 10:00/s);
  const early = sheet({ status: "approved", approvals: { dept: null, it_mgr: null }, completed: null, received: null });
  assert.match(early.slice(early.indexOf('data-slot="approver"'), early.indexOf('data-slot="approver"') + 300), /<div class="itrp-sign-name"><\/div>/);
  const single = sheet({ approvals: { dept: { by: "รสริน เชน", at: "2026-11-21T02:00:00Z" }, it_mgr: { by: "รสริน เชน", at: "2026-11-21T02:00:00Z" } } });
  assert.equal(count(single, /\(อนุมัติครั้งเดียว นับเป็นทั้งสองขั้น\)/g), 2);
});

test("a test request is watermarked, and urgent is marked in the title", () => {
  const test = sheet({ is_test: true, doc_no: "TEST-IT01-26/001", is_urgent: true });
  assert.match(test, /itrp-watermark/);
  assert.match(test, /ใบทดสอบ — ไม่ใช่เอกสารจริง/);
  assert.match(test, /\(งานด่วน\)/);
  assert.doesNotMatch(sheet(), /itrp-watermark|\(งานด่วน\)/);
});

test("the sheet escapes every user-supplied value", () => {
  const html = sheet({
    device_name: XSS, asset_code: XSS, symptom: XSS, request_kind_note: XSS, requester: { employee_no: "MK1", full_name: XSS }, department: { name_th: XSS },
    approvals: { dept: { by: XSS, at: "2026-11-21T02:00:00Z" }, it_mgr: { by: XSS, at: "2026-11-21T03:00:00Z" } }, completed: { by: XSS, at: "2026-11-22T03:00:00Z" }, received: { by: XSS, at: "2026-11-23T04:00:00Z" },
    repair_report: { ...REPORT, cause: XSS, cause_kind_note: XSS, repair_vendor: XSS, repair_action: XSS, pr_po_no: XSS, parts: [{ line_no: 1, item_name: XSS, quantity: 1, price: 1, note: XSS }] },
    comments: [{ id: 1, kind: "question", stage: "it", body: XSS, created_at: "2026-11-21T05:00:00Z", author_full_name: XSS, attachments: [] }],
    reworks: [{ id: "w", round_no: 1, details: XSS, due_date: "2026-11-30", created_at: "2026-11-22T05:00:00Z", requested_by_full_name: XSS }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.ok(count(html, /&lt;img src=x/g) >= 12);
});

test("question/answer and rework history are appended after the form only when they exist", () => {
  assert.doesNotMatch(sheet(), /ประวัติถาม-ตอบ|ประวัติการแก้ไขงาน/);
  const html = sheet({
    comments: [{ id: 1, kind: "question", stage: "it", body: "รุ่นอะไร", created_at: "2026-11-21T05:00:00Z", author_full_name: "ช่าง", attachments: [] }],
    reworks: [{ id: "w", round_no: 1, details: "ยังไม่หาย", due_date: "2026-11-30", created_at: "2026-11-22T05:00:00Z", requested_by_full_name: "สมหญิง" }],
  });
  assert.match(html, /ประวัติการแก้ไขงาน/);
  assert.match(html, /ประวัติถาม-ตอบ/);
  assert.ok(html.indexOf("รับทราบ ฝ่ายบริหาร") < html.indexOf("ประวัติการแก้ไขงาน"), "the one-page form comes first");
});

test("the print page has a toolbar that is not printed and links back to the detail", () => {
  const html = pages.printPage(detail());
  assert.match(html, /class="itrp-print-toolbar no-print"/);
  assert.match(html, /id="itrp-print-button"/);
  assert.match(html, /href="#\/office\?module=repair&amp;view=order&amp;id=00000000/);
  assert.match(html, /class="itrp-version no-print"/);
});

/* ---------- ตั้งค่า ---------- */
test("settings: read-only IT team with a pointer to the work order module, plus the document counter", () => {
  const html = pages.settingsPage({
    staff: [{ employee_id: "e1", employee_no: "IT3462", full_name: "สุริยา", department_name: "IT", is_it_admin: true, is_it_approver: false, is_active: true }, { employee_id: "e2", employee_no: "FANG", full_name: "รสริน", department_name: "MGT", is_it_admin: false, is_it_approver: true, is_active: false }],
    counter: { next_doc_no: "IT01-26/051", next_seq: 51, year: 2026, is_test: false },
  });
  assert.match(html, /ผู้ดูแลงาน IT/);
  assert.match(html, /ผู้อนุมัติขั้น IT/);
  assert.match(html, /ปิดใช้งานแล้ว/);
  assert.match(html, /ที่แท็บตั้งค่าของใบสั่งงาน IT/);
  assert.doesNotMatch(html, /data-staff-edit|data-staff-remove|itrp-staff-form|บันทึกสิทธิ์|ถอนสิทธิ์/, "there is no way to edit the team here");
  assert.match(html, /IT01-26\/051/);
  assert.match(html, /id="itrp-counter-form"/);
  assert.match(html, /placeholder="52"/);
  assert.match(pages.settingsPage({ staff: [], counter: null }), /ยังไม่มีรายชื่อทีม IT/);
});

/* ---------- อุปกรณ์ที่ผู้แจ้งเลือก: รายละเอียด ใบพิมพ์ ฟอร์มส่งงาน ---------- */
const REQUESTED = { host_code: "COM24", devices: [
  { seq: 1, type_code: "MONITOR", device_code: "MNT53", from_register: true, note: null },
  { seq: 2, type_code: "MOUSE", device_code: null, from_register: false, note: null },
  { seq: 3, type_code: "OTHER", device_code: "SCN01", from_register: false, note: "เครื่องสแกน" },
] };

test("the detail page of a picked request shows the host and a devices table with the register mark; an old request keeps the old facts", () => {
  const html = pages.detailPage(detail(REQUESTED));
  assert.match(html, /<dt>เครื่องคอม<\/dt><dd>COM24<\/dd>/);
  assert.doesNotMatch(html, /<dt>รหัสเครื่องคอมพิวเตอร์<\/dt>/);
  assert.match(html, /<h3 class="itrp-subhead">อุปกรณ์ที่แจ้ง<\/h3>/);
  assert.match(html, /<strong>MNT53<\/strong> <span class="itrp-from-register">จากทะเบียน<\/span>/);
  assert.equal(count(html, /itrp-from-register/g), 1, "typed codes are not marked");
  assert.match(html, /<strong>SCN01<\/strong>/);
  assert.match(html, /ยังไม่ระบุรหัส<\/span>/, "a device without a code says so");
  assert.doesNotMatch(html, /ไม่ทราบรหัส/, "no 'unknown host' wording any more");
  assert.match(html, /เครื่องสแกน/);
  const old = pages.detailPage(detail({ host_code: null, devices: [] }));
  assert.match(old, /<dt>รหัสเครื่องคอมพิวเตอร์<\/dt>/);
  assert.doesNotMatch(old, /อุปกรณ์ที่แจ้ง|itrp-reqdev-table/);
  const noKeys = pages.detailPage(detail());
  assert.match(noKeys, /<dt>รหัสเครื่องคอมพิวเตอร์<\/dt>/, "a response without the new keys renders the old way");
  assert.doesNotMatch(pages.detailPage(detail({ ...REQUESTED, devices: [{ ...REQUESTED.devices[0], device_code: XSS, note: XSS }] })), /<img src=x/);
});

test("the A4 sheet puts the host and a compact device list in the same row as before, and old requests print as before", () => {
  const html = sheet(REQUESTED);
  assert.match(html, /<th scope="row">เครื่องคอม<\/th><td>COM24<\/td><th scope="row">อุปกรณ์ที่แจ้ง<\/th><td>หน้าจอ MNT53 · เมาส์ · อื่นๆ \(เครื่องสแกน SCN01\)<\/td>/);
  assert.equal(count(html, /<tr>/g), count(sheet({}), /<tr>/g), "no extra table row, so the form stays on one page");
  assert.doesNotMatch(html, /ไม่ทราบรหัส/);
  assert.match(sheet({}), /<th scope="row">รหัสเครื่องคอมพิวเตอร์<\/th><td>PC-001<\/td><th scope="row">ชื่อเครื่อง \/ อุปกรณ์<\/th>/);
  assert.doesNotMatch(sheet({ ...REQUESTED, devices: [{ ...REQUESTED.devices[0], device_code: XSS }] }), /<img src=x/);
});

test("the IT complete form starts from the codes the requester picked", () => {
  const rows = (html) => [...html.matchAll(/name="device_code"[^>]*value="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(rows(pages.detailPage(detail({ ...REQUESTED, allowed_actions: ["complete"] }))), ["MNT53", "SCN01"]);
  assert.deepEqual(rows(pages.detailPage(detail({ allowed_actions: ["complete"] }))), ["PC-001"], "an old request starts from the asset code as before");
  assert.deepEqual(rows(pages.completeFormCard({ assetCode: "COM24", requestedCodes: [] })), ["COM24"]);
  // ใบใหม่ที่ผู้แจ้งไม่มีรหัสอุปกรณ์เลย (เสียแค่จอที่ไม่ทราบรหัส): เริ่มว่าง ไม่เติมรหัสคอมลงแถว
  const noCodes = { asset_code: "COM24", host_code: "COM24", devices: [{ seq: 1, type_code: "MONITOR", device_code: null, from_register: false, note: null }], allowed_actions: ["complete"] };
  assert.deepEqual(rows(pages.detailPage(detail(noCodes))), [""]);
});

test("the purge button and the version tag", () => {
  assert.match(pages.purgeRow(), /id="itrp-purge"[^>]*>ล้างข้อมูลใบแจ้งซ่อมทดสอบ</);
  assert.match(pages.page("<p>x</p>"), /<p class="itrp-version no-print" title="[^"]*2.00[^"]*">V2.00<\/p>/);
  assert.match(pages.errorCard("พัง <b>"), /พัง &lt;b&gt;/);
  assert.doesNotMatch(pages.errorCard("x", { retry: false }), /itrp-retry/);
});

/* ---------- เวลาทำงานจากฐานข้อมูล (work_minutes) ---------- */
test("the repair time shows the database work minutes when present (detail, report card and A4), and falls back to the old computed figure otherwise", () => {
  const html = pages.detailPage(detail({ work_minutes: 660 }));
  assert.match(html, /ใช้เวลาทำงาน.*1 วัน 3 ชม\. 0 นาที/s);
  assert.match(html, /นับเฉพาะเวลาทำงาน จ\.–ส\. ไม่นับวันอาทิตย์ วันหยุดบริษัท และช่วงรอผู้แจ้งตอบ/);
  assert.doesNotMatch(html, /รวมเวลาในการซ่อม/, "the old figure is replaced, not doubled");
  const paper = sheet({ work_minutes: 660 });
  assert.match(paper, /รวมเวลาในการซ่อม<\/th><td>1 วัน 3 ชม\. 0 นาที<\/td>/);
  assert.match(paper, /หมายเหตุ: รวมเวลาในการซ่อม นับเฉพาะเวลาทำงาน/);
  assert.match(sheet({ work_minutes: 0 }), /รวมเวลาในการซ่อม<\/th><td>0 นาที<\/td>/);
  // ฐานข้อมูลเก่า (ไม่มีคีย์) / ยังไม่เคยส่งงาน (null) = เหมือนเดิมทุกอย่าง
  for (const value of [undefined, null]) {
    const old = detail({ work_minutes: value });
    assert.match(pages.detailPage(old), /รวมเวลาในการซ่อม.*5 ชม\./s);
    assert.doesNotMatch(pages.detailPage(old), /ใช้เวลาทำงาน/);
    assert.match(sheet({ work_minutes: value }), /รวมเวลาในการซ่อม<\/th><td>5 ชม\.<\/td>/);
    assert.doesNotMatch(sheet({ work_minutes: value }), /หมายเหตุ: รวมเวลาในการซ่อม/);
  }
  // ขอแก้ไขแล้วกลับมาทำรอบใหม่ (in_progress): ไม่ใช้ work_minutes ของรอบก่อน คงช่อง "รวมเวลาในการซ่อม" แบบเดิม
  const reopened = detail({ status: "in_progress", work_minutes: 660 });
  assert.doesNotMatch(pages.detailPage(reopened), /ใช้เวลาทำงาน|1 วัน 3 ชม/);
  assert.doesNotMatch(sheet({ status: "in_progress", work_minutes: 660 }), /1 วัน 3 ชม|หมายเหตุ: รวมเวลาในการซ่อม/);
  assert.match(sheet({ status: "in_progress", work_minutes: 660 }), /รวมเวลาในการซ่อม<\/th><td>5 ชม\.<\/td>/);
});
