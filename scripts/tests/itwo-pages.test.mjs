import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// HTML ของหน้าใบสั่งงาน IT (modules/itwo-pages.js): แท็บ รายการ ฟอร์ม รายละเอียด ปุ่มตามสิทธิ์ ไทม์ไลน์ ส่วนสำหรับแผนก IT และหน้าพิมพ์
const require = createRequire(import.meta.url);
globalThis.MNP_UI_ICONS = require("../../modules/ui-icons.js");
globalThis.MNP_ITWO_MODEL = require("../../modules/itwo-model.js");
globalThis.MNP_FORM_STEPS = undefined; // ฟอร์มวาดส่วนหัว/ปุ่มของ stepper ผ่าน MNP_FORM_STEPS ถ้ามี (ที่นี่ตรวจเฉพาะช่องของฟอร์ม)
const pages = require("../../modules/itwo-pages.js");

const count = (text, pattern) => (text.match(pattern) ?? []).length;
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const MINE = [
  { id: "00000000-0000-4000-8000-000000000001", doc_no: "IT06-26/001", status: "it_closed", is_urgent: true, request_type: "design", details: "ออกแบบกล่องพัสดุ <b>ใหม่</b>", needed_date: "2026-11-25", created_at: "2026-11-19T01:00:00Z" },
  { id: "00000000-0000-4000-8000-000000000002", doc_no: "TEST-IT06-26/001", status: "pending_dept", is_urgent: false, request_type: "misc", details: "", needed_date: "2026-12-01", created_at: "2026-11-18T17:30:00Z" },
];

/* ---------- หัว แท็บ ---------- */
test("the page head has one h1, a back link to IT SUPPORT, the new-order button, and the test tag only in test mode", () => {
  const head = pages.head({ actions: pages.newButton() });
  assert.equal(count(head, /<h1>/g), 1);
  assert.match(head, /<h1>ใบสั่งงาน IT<\/h1>/);
  assert.match(head, /href="#\/office\?module=it-support">‹ IT SUPPORT</);
  assert.match(head, /href="#\/office\?module=work-order&amp;view=new"[^>]*>.*แจ้งงานใหม่/s);
  assert.doesNotMatch(head, /itwo-test-tag/);
  assert.match(pages.head({ isTest: true }), /<span class="badge itwo-test-tag"[^>]*>ทดสอบ<\/span>/);
});

test("tabs follow my_role, mark the open tab, show counts, and a user with only one tab sees no tab bar", () => {
  assert.equal(pages.tabs({}, "mine"), "", "nothing to switch to");
  const html = pages.tabs({ is_dept_approver: true, is_it_admin: true }, "approvals", { approvals: 3, it: 120 });
  assert.deepEqual([...html.matchAll(/class="view-tab[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1].trim()), ["ใบของฉัน", "รออนุมัติ", "งาน IT", "ตั้งค่า"]);
  assert.equal(count(html, /aria-current="page"/g), 1);
  assert.match(html, /class="view-tab active" aria-current="page" href="#\/office\?module=work-order&amp;view=approvals">รออนุมัติ <span class="itwo-tab-count" aria-label="3 รายการ ที่รออนุมัติ"[^>]*>3<\/span>/);
  assert.match(html, />99\+</, "a long count is capped");
  assert.doesNotMatch(pages.tabs({ is_dept_approver: true }, "mine", { approvals: 0 }), /itwo-tab-count/, "zero is not shown");
  assert.doesNotMatch(pages.tabs({ is_dept_approver: true }, "mine", {}), /itwo-tab-count/, "an unread count is not shown");
  assert.doesNotMatch(html, /ตั้งค่า<\/a>.*ตั้งค่า<\/a>/s);
});

test("the 'ใบของฉัน' tab shows how many orders came back for my confirmation, and a one-tab user sees the bar only then", () => {
  const withCount = pages.tabs({ is_it_admin: true }, "it", { mine: 2 });
  assert.match(withCount, /ใบของฉัน <span class="itwo-tab-count" aria-label="2 รายการ ที่รอคุณยืนยัน"[^>]*>2<\/span>/);
  assert.match(pages.tabs({}, "mine", { mine: 1 }), /view-tabs[\s\S]*ใบของฉัน <span class="itwo-tab-count" aria-label="1 รายการ ที่รอคุณยืนยัน"/, "an employee has one tab: the bar appears only when something is waiting");
  assert.equal(pages.tabs({}, "mine", { mine: 0 }), "");
  assert.equal(pages.tabs({}, "mine", {}), "");
});

test("the 'ใบของฉัน' tab says what waits: confirm, answer, or both with their numbers", () => {
  const tab = (counts) => pages.tabs({ is_it_admin: true }, "it", counts).match(/<span class="itwo-tab-count" aria-label="([^"]*)" title="([^"]*)">(\d+)<\/span>/);
  const both = tab({ mine: 3, mineParts: { confirm: 2, answer: 1 } });
  assert.equal(both[1], "3 รายการ (รอคุณยืนยัน 2 · รอคุณตอบ 1)");
  assert.equal(both[2], both[1], "title and aria say the same");
  assert.equal(both[3], "3");
  assert.equal(tab({ mine: 1, mineParts: { confirm: 0, answer: 1 } })[1], "1 รายการ ที่รอคุณตอบ");
  assert.equal(tab({ mine: 2, mineParts: { confirm: 2, answer: 0 } })[1], "2 รายการ ที่รอคุณยืนยัน");
  assert.match(pages.tabs({}, "mine", { mine: 1, mineParts: { confirm: 0, answer: 1 } }), /view-tabs/, "an employee with an unanswered question sees the bar");
});

/* ---------- รายการ ---------- */
test("'ใบของฉัน' lists the number as a link, the status the requester understands, an urgent flag and Thai dates", () => {
  const html = pages.mineList(MINE);
  assert.match(html, /href="#\/office\?module=work-order&amp;view=order&amp;id=00000000-0000-4000-8000-000000000001"[^>]*>IT06-26\/001</);
  assert.match(html, /IT ส่งงานแล้ว รอคุณยืนยัน/);
  assert.doesNotMatch(html, /ปิดงาน/);
  assert.match(html, /รอผู้จัดการแผนก/);
  assert.equal(count(html, /badge urgent-flag/g), 1);
  assert.match(html, /25\/11\/2569/);
  assert.match(html, /19\/11\/2569 08:00/, "08:00 Bangkok");
  assert.match(html, /19\/11\/2569 00:30/, "midnight crossing is the next Bangkok day");
  assert.match(html, /เบ็ดเตล็ดอื่นๆ/, "an order without details falls back to the request type");
  assert.doesNotMatch(html, /<b>/, "user text is escaped");
  assert.match(html, /&lt;b&gt;ใหม่&lt;\/b&gt;/);
});

test("'ใบของฉัน' shows a question waiting for the requester as 'รอคุณตอบ', amber, with who asked and where it returns in the badge title", () => {
  const html = pages.mineList([{ ...MINE[1], status: "need_info", info_stage: "it_mgr", info_return_status: "pending_it_mgr" }]);
  assert.match(html, /<span class="badge more_info" title="ผู้อนุมัติขั้น IT ถามคุณ · ตอบแล้วใบกลับไปที่ รอผู้อนุมัติขั้น IT">รอคุณตอบ<\/span>/);
  assert.doesNotMatch(html, /รอผู้แจ้งตอบ/, "the requester is told it is theirs to answer, not 'waiting for the requester'");
});

test("an empty list says so and points at the new-order button", () => {
  assert.match(visibleText(pages.mineList([])), /ยังไม่มีใบสั่งงานที่คุณแจ้ง/);
  assert.match(visibleText(pages.approvalsList([])), /ไม่มีใบสั่งงานที่รออนุมัติจากคุณ/);
  assert.match(visibleText(pages.itList([])), /ยังไม่มีใบสั่งงาน/);
});

test("approvals show whose step is waiting for me, who asked and which department", () => {
  const html = pages.approvalsList([{ ...MINE[0], status: "pending_it_mgr", pending_step: "it_mgr", requester_name: "สมชาย ใจดี", department_name: "การตลาด" }, { ...MINE[1], pending_step: "dept", requester_name: "ก", department_name: "ข" }]);
  assert.match(html, /รอคุณอนุมัติขั้น IT/);
  assert.match(html, /รอคุณอนุมัติขั้นผู้จัดการแผนก/);
  assert.match(html, /สมชาย ใจดี · การตลาด/);
});

test("approvals: orders already asked (need_info) are a separate 'รอผู้แจ้งตอบ' group with its own count; the first table keeps only what waits for me", () => {
  const waiting = { ...MINE[1], status: "pending_dept", pending_step: "dept", requester_name: "ก", department_name: "ข" };
  const asked = { ...MINE[0], id: "u9", doc_no: "IT06-26/009", status: "need_info", pending_step: "dept", requester_name: "สมชาย <i>ใจดี", department_name: "การตลาด", info_stage: "dept", info_return_status: "pending_dept" };
  const html = pages.approvalsList([asked, waiting]);
  const groups = [...html.matchAll(/data-group="([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(groups, ["awaiting_info"]);
  const [first, second] = html.split('data-group="awaiting_info"');
  assert.match(first, /TEST-IT06-26\/001/);
  assert.doesNotMatch(first, /IT06-26\/009/, "an asked order is not in the 'waiting for you' table");
  assert.match(first, /รอคุณอนุมัติขั้นผู้จัดการแผนก/);
  assert.match(second, /IT06-26\/009/);
  assert.match(second, /<span class="badge more_info" title="ถามโดย ผู้จัดการแผนก · ตอบแล้วใบกลับไปที่ รอผู้จัดการแผนก">รอผู้แจ้งตอบ<\/span>/);
  assert.match(visibleText(second), /รอผู้แจ้งตอบ 1/);
  assert.doesNotMatch(second, /รอคุณอนุมัติ/, "nothing to approve on it");
  assert.doesNotMatch(html, /<i>ใจดี/, "the requester name is escaped");
  // ไม่มีใบ need_info = ผลเดิม (ตารางเดียว ไม่มีกลุ่ม) · มีแต่ need_info = บอกว่าไม่มีใบรอคุณอนุมัติ
  assert.doesNotMatch(pages.approvalsList([waiting]), /awaiting_info|itwo-group/);
  assert.match(visibleText(pages.approvalsList([asked])), /ไม่มีใบสั่งงานที่รออนุมัติจากคุณ/);
});

test("the IT list puts orders waiting for the requester in their own group, not under work to start", () => {
  const base = { requester_full_name: "ก", department_name: "ข", has_dept_approved: true, has_it_mgr_approved: true };
  const html = pages.itList([{ ...MINE[0], ...base, status: "need_info", is_urgent: true, info_stage: "it", info_return_status: "in_progress" }, { ...MINE[1], ...base, id: "x2", doc_no: "IT06-26/077", status: "approved", is_urgent: false }]);
  assert.deepEqual([...html.matchAll(/data-group="([a-z_]+)"/g)].map((match) => match[1]), ["to_start", "awaiting_info"]);
  const asked = html.slice(html.indexOf('data-group="awaiting_info"'));
  assert.match(asked, /IT06-26\/001/);
  assert.match(asked, /<span class="badge more_info" title="ถามโดย ทีม IT · ตอบแล้วใบกลับไปที่ กำลังดำเนินการ">รอผู้แจ้งตอบ<\/span>/);
  assert.doesNotMatch(html.slice(0, html.indexOf('data-group="awaiting_info"')), /IT06-26\/001/);
  assert.match(html.slice(0, html.indexOf('data-group="awaiting_info"')), /IT06-26\/077/);
});

test("the IT list is grouped by status; urgent work is on top; empty groups and finished work are not in the way", () => {
  const rows = [
    { ...MINE[0], id: "u2", doc_no: "IT06-26/002", status: "approved", is_urgent: false, requester_full_name: "ก", department_name: "ข", has_dept_approved: true, has_it_mgr_approved: true, needed_date: "2026-11-20" },
    { ...MINE[0], id: "u1", doc_no: "IT06-26/003", status: "approved", is_urgent: true, requester_full_name: "ก", department_name: "ข", has_dept_approved: true, has_it_mgr_approved: true, needed_date: "2026-12-20" },
    { ...MINE[0], id: "u4", doc_no: "IT06-26/004", status: "pending_dept", is_urgent: false, requester_full_name: "ก", department_name: "ข", has_dept_approved: false, has_it_mgr_approved: false },
    { ...MINE[0], id: "u5", doc_no: "IT06-26/005", status: "received", is_urgent: false, requester_full_name: "ก", department_name: "ข", has_dept_approved: true, has_it_mgr_approved: true },
  ];
  const html = pages.itList(rows);
  assert.deepEqual([...html.matchAll(/data-group="([a-z_]+)"/g)].map((match) => match[1]), ["to_start", "awaiting_approval", "closed"], "only groups that have work, in workflow order");
  const toStart = html.slice(html.indexOf('data-group="to_start"'), html.indexOf('data-group="awaiting_approval"'));
  assert.ok(toStart.indexOf("IT06-26/003") < toStart.indexOf("IT06-26/002"), "urgent first even with a later needed date");
  assert.match(html, /<details class="card detail-section itwo-group" data-group="closed">/, "finished work is folded");
  assert.doesNotMatch(html, /<details[^>]*data-group="to_start"/);
  assert.match(html, /✓ ผู้จัดการแผนก/);
  assert.match(html, /○ ผู้อนุมัติขั้น IT/);
});

/* ---------- ฟอร์มแจ้งงาน ---------- */
test("the order form has the FM06 fields in order: two request types (no system access), the misc text and the file picker start hidden", () => {
  const html = pages.orderForm({ requester: { name: "สมชาย ใจดี", department: "การตลาด" } });
  const names = [...html.matchAll(/name="([a-z_-]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(names)], ["request_type", "misc_detail", "order_ref", "attachment_flag", "attachment_note", "itwo-files", "details", "needed_date", "is_urgent"]);
  assert.equal(count(html, /name="request_type"/g), 2, "design and misc only");
  for (const label of ["งานออกแบบ", "เบ็ดเตล็ดอื่นๆ", "มี", "ไม่มี", "อื่นๆ"]) assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.doesNotMatch(html, /สิทธิ์การใช้งานในระบบคอมพิวเตอร์|system_access/, "the system-access choice is gone");
  assert.equal(count(html, /field-required/g), 5, "request type, details, needed date, the misc text and the 'other' note");
  assert.match(html, /name="attachment_flag" value="no" checked/, "'ไม่มี' is the default");
  assert.match(html, /id="itwo-attachment-note-field" hidden/, "the note field starts hidden");
  assert.match(html, /id="itwo-misc-field" hidden/, "the misc text starts hidden");
  assert.match(html, /<label for="itwo-misc-detail">ระบุว่างานอะไร <span class="field-required">\(จำเป็น\)<\/span><\/label><input class="input" id="itwo-misc-detail" name="misc_detail" maxlength="200"/);
  // ช่องไฟล์: ซ่อนไว้จนเลือกเอกสารแนบ = "มี" · หลายไฟล์ · ชนิดที่ฐานข้อมูลรับ · ใช้ปุ่ม/ตัวอย่างไฟล์ที่เลือกของ Pilot (attachment-image/preview)
  assert.match(html, /id="itwo-files-field" hidden/);
  assert.match(html, /<input class="file-pick-input" id="itwo-files" name="itwo-files" type="file" multiple data-attachment-limit="per-file" accept="image\/\*,\.jpg,[^"]*\.docx[^"]*"/);
  assert.match(html, /for="itwo-files" title="[^"]*10 ไฟล์[^"]*">[\s\S]*ถ่ายรูป \/ เลือกไฟล์/);
  assert.match(html, /ออเดอร์ \(ไม่บังคับ\)/);
  assert.match(html, /maxlength="2000"/);
  assert.match(html, /type="date"/);
  assert.match(html, /งานด่วน/);
  assert.match(html, /หมายเหตุ: ระยะเวลาทำงาน งานออกแบบ 3–7 วันนับจากวันที่ได้ข้อมูลครบ · งานเบ็ดเตล็ดตามตกลง/);
  assert.match(html, /ผู้แจ้ง สมชาย ใจดี · การตลาด · ระบบบันทึกวันและเวลาที่แจ้งให้เอง/, "the system fills in name, department and time");
  assert.equal(count(html, /id="itwo-form"/g), 1);
  assert.equal(count(html, /data-step="[123]"/g), 3);
});

test("the review step shows only what was filled in, the misc work and the 'other' attachment note", () => {
  const html = pages.orderReview({ request_type: "misc", misc_detail: " ซ่อม <b>เมาส์</b> ", order_ref: "", attachment_flag: "other", attachment_note: "แบบฟอร์ม <x>", details: " ขอ ", needed_date: "2026-11-25", is_urgent: true });
  assert.match(visibleText(html), /ประเภทคำขอ เบ็ดเตล็ดอื่นๆ · ซ่อม &lt;b&gt;เมาส์&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>เมาส์/, "the misc text is escaped");
  assert.doesNotMatch(html, /ไฟล์แนบ/, "no files, no row");
  assert.match(visibleText(html), /เอกสารแนบ อื่นๆ \(แบบฟอร์ม &lt;x&gt;\)/, "the note is escaped (this is the text of the escaped markup)");
  assert.match(visibleText(html), /วันที่ต้องการงาน 25\/11\/2569/);
  assert.match(visibleText(html), /ความเร่งด่วน งานด่วน/);
  assert.doesNotMatch(html, /ออเดอร์/, "an empty order is not listed");
  assert.doesNotMatch(html, /<x>/);
});

/* ---------- รายละเอียด ---------- */
const DETAIL = {
  id: "00000000-0000-4000-8000-000000000001", is_test: false, doc_no: "IT06-26/001", status: "pending_it_mgr", is_urgent: true,
  request_type: "misc", misc_detail: "ซ่อมเมาส์ <i>", order_ref: "SO-9", attachment_flag: "other", attachment_note: "สำเนาบัตร", details: "เมาส์เสีย\nบรรทัดสอง <script>",
  needed_date: "2026-11-25", created_at: "2026-11-19T01:00:00Z", rework_round: 0, latest_due_date: "2026-11-25",
  requester: { employee_no: "MK1", full_name: "สมชาย ใจดี" }, department: { code: "MK", name_th: "การตลาด" },
  events: [
    { id: 1, action: "created", reason: null, created_at: "2026-11-19T01:00:00Z", actor_full_name: "สมชาย ใจดี" },
    { id: 2, action: "dept_approved", reason: "เห็นชอบ", created_at: "2026-11-18T17:05:00Z", actor_full_name: "สมหญิง ผู้จัดการ" },
  ],
  access_changes: [], reworks: [], attachments: [],
  approvals: { dept: { by: "สมหญิง ผู้จัดการ", at: "2026-11-18T17:05:00Z" }, it_mgr: null },
  allowed_actions: [],
};
// ใบเก่าที่ IT เคยบันทึกส่วนสิทธิ์ในระบบไว้ก่อนถอดส่วนนี้ออก
const LEGACY = { ...DETAIL, request_type: "system_access", misc_detail: null, access_changes: [{ id: "a1", system: "i_prime", action: "add", new_username: "somchai", old_username: null, note: "ใหม่" }] };
const FILE = (id, name, round = 0, extra = {}) => ({ id, rework_id: round ? `r${round}` : null, round_no: round, storage_path: `o/${id}.pdf`, bucket: "itwo-files", file_name: name, mime_type: "application/pdf", size_bytes: 1536, created_at: "2026-11-19T01:10:00Z", uploaded_by_full_name: "สมชาย ใจดี", ...extra });
const ROUND = (no, details, due, extra = {}) => ({ id: `r${no}`, round_no: no, details, due_date: due, created_at: "2026-11-26T03:00:00Z", requested_by_employee_no: "MK1", requested_by_full_name: "สมชาย ใจดี", ...extra });

test("the detail page shows every field, the pending step, the timeline with Bangkok times and reasons, and a print link", () => {
  const html = pages.detailPage(DETAIL);
  assert.equal(count(html, /<h1>/g), 1);
  assert.match(html, /<h1>IT06-26\/001<\/h1>/);
  assert.match(html, /IT01-FM06/);
  assert.match(html, /โดย สมชาย ใจดี · การตลาด · แจ้งเมื่อ 19\/11\/2569 08:00/);
  assert.match(html, /ยังไม่ได้อนุมัติ: ผู้อนุมัติขั้น IT/);
  assert.doesNotMatch(html, /ยังไม่ได้อนุมัติ: ผู้จัดการแผนก/, "the step already approved is not listed as pending");
  const text = visibleText(html);
  assert.match(text, /ประเภทคำขอ เบ็ดเตล็ดอื่นๆ · ซ่อมเมาส์ &lt;i&gt;/, "misc says what the work is (escaped)");
  assert.match(text, /วันที่ต้องการงาน 25\/11\/2569/);
  assert.match(text, /ออเดอร์ SO-9/);
  assert.match(text, /เอกสารแนบ อื่นๆ \(สำเนาบัตร\)/);
  assert.match(html, /badge urgent-flag/);
  assert.doesNotMatch(html, /<script>/, "details are escaped");
  assert.match(text, /ผู้จัดการแผนกอนุมัติ โดย สมหญิง ผู้จัดการ เห็นชอบ 19\/11\/2569 00:05/, "timeline: name, reason, date and Thai time (00:05 next day)");
  assert.match(text, /แจ้งงาน โดย สมชาย ใจดี 19\/11\/2569 08:00/);
  assert.match(html, /href="#\/office\?module=work-order&amp;view=print&amp;id=00000000-0000-4000-8000-000000000001"/);
  assert.match(html, /หมายเหตุ: ระยะเวลาทำงาน/);
  assert.doesNotMatch(html, /itwo-test-tag/);
});

test("a test document carries the 'ทดสอบ' tag, by flag or by its TEST- number", () => {
  assert.match(pages.detailPage({ ...DETAIL, is_test: true }), /itwo-test-tag/);
  assert.match(pages.detailPage({ ...DETAIL, doc_no: "TEST-IT06-26/001" }), /itwo-test-tag/);
});

test("action buttons appear only for allowed_actions, each carries its action name, and none means no panel", () => {
  const none = pages.detailPage({ ...DETAIL, allowed_actions: [] });
  assert.doesNotMatch(none, /data-itwo-action|itwo-actions/);
  assert.doesNotMatch(none, /สิ่งที่คุณทำได้กับใบนี้/);

  const approver = pages.detailPage({ ...DETAIL, allowed_actions: ["approve", "reject"] });
  assert.deepEqual([...approver.matchAll(/data-itwo-action="([a-z]+)"/g)].map((match) => match[1]), ["approve", "reject"]);
  assert.match(approver, /<button type="button" class="btn success" data-itwo-action="approve">อนุมัติ<\/button>/);
  assert.match(approver, /<button type="button" class="btn danger" data-itwo-action="reject">ไม่อนุมัติ<\/button>/);

  const requester = pages.detailPage({ ...DETAIL, status: "it_closed", allowed_actions: ["receive", "cancel"] });
  assert.deepEqual([...requester.matchAll(/data-itwo-action="([a-z]+)"/g)].map((match) => match[1]), ["receive", "cancel"]);
  assert.match(requester, /ได้รับงานเรียบร้อยแล้ว/);

  const it = pages.detailPage({ ...DETAIL, status: "approved", allowed_actions: ["start", "complete", "edit_access", "bogus"] });
  assert.deepEqual([...it.matchAll(/data-itwo-action="([a-z_]+)"/g)].map((match) => match[1]), ["start", "complete"], "edit_access and unknown actions are not buttons");
});

test("a requester whose order IT closed gets 'ได้รับงานเรียบร้อยแล้ว' and 'แก้ไขงาน' (secondary), with a hidden rework form", () => {
  const html = pages.detailPage({ ...DETAIL, status: "it_closed", allowed_actions: ["receive", "request_rework", "cancel"] });
  assert.deepEqual([...html.matchAll(/data-itwo-action="([a-z_]+)"/g)].map((match) => match[1]), ["receive", "request_rework", "cancel"]);
  assert.match(html, /<button type="button" class="btn secondary" data-itwo-action="request_rework">แก้ไขงาน<\/button>/);
  assert.match(html, /<section class="card itwo-rework-card" id="itwo-rework-card"[^>]* hidden>/, "the form is in the page but hidden until the button is pressed");
  assert.match(html, /id="itwo-rework-due" name="due_date" type="date"/);
  assert.match(html, /id="itwo-rework-files" name="itwo-rework-files" type="file" multiple data-attachment-limit="per-file"/, "files are optional and capped per file (20 MB each)");
  assert.equal(count(html.slice(html.indexOf('id="itwo-rework-card"')), /field-required/g), 2, "details and the due date are required, files are not");
  assert.match(html, /ส่งให้ IT แก้ไข/);
  // ไม่มีสิทธิ์ขอแก้ไข (ไม่ใช่ผู้แจ้ง/ไม่ใช่สถานะ it_closed) = ไม่มีฟอร์มในหน้าเลย
  assert.doesNotMatch(pages.detailPage({ ...DETAIL, allowed_actions: ["approve"] }), /itwo-rework-card|itwo-rework-form/);
});

test("the IT section is gone: nothing to edit; an old order with rows shows them read-only, one without rows shows no heading at all", () => {
  const plainOrder = pages.detailPage({ ...DETAIL, allowed_actions: ["approve"] });
  assert.doesNotMatch(plainOrder, /สำหรับแผนก IT|สิทธิ์ในระบบ|itwo-access/, "no heading and no empty note for an order without access data");
  const legacy = pages.detailPage({ ...LEGACY, allowed_actions: ["start", "edit_access"] });
  assert.match(legacy, /สำหรับแผนก IT : สิทธิ์ในระบบ/);
  assert.match(visibleText(legacy), /I-Prime System เพิ่ม somchai — ใหม่/);
  assert.match(visibleText(legacy), /ประเภทคำขอ สิทธิ์การใช้งานในระบบคอมพิวเตอร์/, "the old type still has its name");
  assert.doesNotMatch(legacy, /itwo-access-edit|itwo-access-form|data-access-|บันทึกส่วนของ IT|แก้ไขสิทธิ์ในระบบ/, "no way to edit it");
  assert.equal(pages.accessSection, undefined);
  assert.equal(pages.accessRowEditor, undefined);
});

test("files are listed by round inside one #attachment-gallery (what app.js hydrates): the initial files, then each rework round with its details, due date and files", () => {
  const detail = {
    ...DETAIL, status: "in_progress", rework_round: 2, latest_due_date: "2026-12-10", attachment_flag: "yes",
    reworks: [ROUND(1, "แก้สี <b>", "2026-12-01"), ROUND(2, "แก้อีกรอบ", "2026-12-10")],
    attachments: [FILE("f1", "แบบ <1>.pdf"), FILE("f2", "ตัวอย่าง.pdf", 1), FILE("f3", "รอบสอง.pdf", 2)],
  };
  const html = pages.detailPage(detail);
  assert.equal(count(html, /id="attachment-gallery"/g), 1, "one gallery root, as app.js looks for it");
  const gallery = html.slice(html.indexOf('id="attachment-gallery"'));
  assert.match(gallery, /ไฟล์แนบ <span class="detail-section-count">1<\/span>/);
  assert.equal(count(html, /<figure class="attachment-tile" data-attachment="f[123]">/g), 3);
  assert.match(html, /data-attachment-open="f1"/);
  assert.match(html, /data-attachment-download="f1" hidden download/, "the gallery fills the download link once it has the signed URL");
  assert.match(html, /แบบ &lt;1&gt;\.pdf/, "file names are escaped");
  assert.match(html, /1\.5 KB/);
  const rounds = [...html.matchAll(/<article class="itwo-rework-round" data-round="(\d)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(rounds.map((match) => match[1]), ["1", "2"], "every round, in order");
  assert.match(visibleText(rounds[0][2]), /แก้ไขครั้งที่ 1 · กำหนดเสร็จ 01\/12\/2569 แก้สี &lt;b&gt; ขอโดย สมชาย ใจดี · 26\/11\/2569 10:00/);
  assert.match(rounds[0][2], /data-attachment="f2"/);
  assert.doesNotMatch(rounds[0][2], /data-attachment="f3"/, "a round shows only its own files");
  assert.match(rounds[1][2], /data-attachment="f3"/);
  assert.match(visibleText(html), /ประวัติการแก้ไขงาน 2/);
  // หัวใบบอกรอบล่าสุด + กำหนด
  assert.match(html, /<span class="badge itwo-rework-tag">แก้ไขครั้งที่ 2 · กำหนด 10\/12\/2569<\/span>/);
});

test("an order with no files and no rework has no gallery and no rework card; an order with files only has the files card", () => {
  const none = pages.detailPage(DETAIL);
  assert.doesNotMatch(none, /attachment-gallery|itwo-files|ประวัติการแก้ไขงาน|itwo-rework-tag/);
  const filesOnly = pages.detailPage({ ...DETAIL, attachments: [FILE("f1", "a.pdf")] });
  assert.match(filesOnly, /id="attachment-gallery"/);
  assert.doesNotMatch(filesOnly, /ประวัติการแก้ไขงาน/);
});

/* ---------- ถาม-ตอบ ---------- */
const CFILE = (id, name) => ({ id, storage_path: `o/${id}.pdf`, bucket: "itwo-files", file_name: name, mime_type: "application/pdf", size_bytes: 1536, created_at: "2026-11-19T03:05:00Z" });
const QUESTION = { id: 7, kind: "question", stage: "it", body: "ขอไฟล์ต้นฉบับ\nบรรทัดสอง <script>alert(1)</script>", reply_to: null, created_at: "2026-11-19T03:00:00Z", author_employee_no: "IT1", author_full_name: "ไอที <b>หนึ่ง</b>", attachments: [CFILE("c1", "ถาม <img src=x onerror=1>.pdf")] };
const ANSWER = { id: 12, kind: "answer", stage: "it", body: "แนบมาให้แล้ว", reply_to: 7, created_at: "2026-11-19T04:00:00Z", author_employee_no: "MK1", author_full_name: "สมชาย ใจดี", attachments: [CFILE("c2", "ต้นฉบับ.pdf")] };
const QUESTION2 = { id: 20, kind: "question", stage: "dept", body: "ใช้กับงานไหน", reply_to: null, created_at: "2026-11-19T05:00:00Z", author_employee_no: "MK0", author_full_name: "สมหญิง ผู้จัดการ", attachments: [] };
const pendingOf = (comment) => ({ comment_id: comment.id, stage: comment.stage, body: comment.body, asked_at: comment.created_at, asked_by_employee_no: comment.author_employee_no, asked_by_full_name: comment.author_full_name });
const NEED_INFO = { ...DETAIL, status: "need_info", info_return_status: "in_progress", comments: [QUESTION], info_pending: pendingOf(QUESTION) };

test("a need_info order shows the amber 'รอผู้แจ้งตอบ' badge and a line saying where it goes back to after the answer", () => {
  const html = pages.detailPage(NEED_INFO);
  assert.match(html, /<span class="badge more_info">รอผู้แจ้งตอบ<\/span>/);
  assert.match(visibleText(html), /รอผู้แจ้งตอบ · ตอบแล้วใบกลับไปที่ กำลังดำเนินการ/);
  assert.doesNotMatch(pages.detailPage({ ...DETAIL }), /ตอบแล้วใบกลับไปที่/);
});

test("'ถามผู้แจ้ง' is a secondary button with a hidden ask form (message required up to 2000, optional files); no right to ask = no form", () => {
  const html = pages.detailPage({ ...DETAIL, allowed_actions: ["approve", "reject", "request_info"] });
  assert.deepEqual([...html.matchAll(/data-itwo-action="([a-z_]+)"/g)].map((match) => match[1]), ["approve", "reject", "request_info"]);
  assert.match(html, /<button type="button" class="btn secondary" data-itwo-action="request_info">ถามผู้แจ้ง<\/button>/);
  assert.match(html, /<section class="card itwo-ask-card" id="itwo-ask-card"[^>]* hidden>/);
  assert.match(html, /<textarea class="textarea" id="itwo-ask-body" name="body" rows="4" maxlength="2000">/);
  assert.match(html, /id="itwo-ask-files" name="itwo-ask-files" type="file" multiple data-attachment-limit="per-file"/);
  assert.equal(count(html.slice(html.indexOf('id="itwo-ask-card"')), /field-required/g), 1, "the message is required, the files are not");
  assert.match(html, /id="itwo-ask-form"/);
  assert.match(html, /id="itwo-ask-cancel"/);
  assert.match(html, /ส่งคำถาม/);
  assert.doesNotMatch(pages.detailPage({ ...DETAIL, allowed_actions: ["approve"] }), /itwo-ask-card|itwo-ask-form/);
});

test("the requester sees the open question first (who, which stage, when, text, files) with an open answer form; no button for it and no copy in the Q&A card", () => {
  const html = pages.detailPage({ ...NEED_INFO, comments: [QUESTION, ANSWER, QUESTION2], info_pending: pendingOf(QUESTION2), allowed_actions: ["provide_info", "cancel"] });
  const card = html.match(/<section class="card itwo-answer-card"[\s\S]*?<\/section>/)[0];
  assert.match(card, /<h2 id="itwo-answer-title">ผู้จัดการแผนก ถามคุณ<\/h2>/);
  assert.match(visibleText(card), /โดย สมหญิง ผู้จัดการ · 19\/11\/2569 12:00/);
  assert.match(card, /ใช้กับงานไหน/);
  assert.match(card, /<textarea class="textarea" id="itwo-answer-body" name="body" rows="4" maxlength="2000">/);
  assert.match(card, /ตอบแล้วใบจะกลับไปที่ กำลังดำเนินการ/);
  assert.match(card, /id="itwo-answer-files" name="itwo-answer-files" type="file" multiple/);
  assert.match(card, /ส่งคำตอบ/);
  assert.doesNotMatch(card, / hidden>/, "the answer form is open");
  assert.deepEqual([...html.matchAll(/data-itwo-action="([a-z_]+)"/g)].map((match) => match[1]), ["cancel"], "answering is the form, not a button; cancelling stays");
  assert.ok(html.indexOf("itwo-answer-card") < html.indexOf("itwo-actions-title"), "the question comes before the buttons");
  // ถาม-ตอบ แสดงประวัติก่อนหน้า ไม่ซ้ำคำถามที่อยู่ในการ์ดตอบ
  const history = html.match(/<section class="card itwo-comments"[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...history.matchAll(/data-comment="(\d+)"/g)].map((match) => match[1]), ["7", "12"]);
  assert.doesNotMatch(history, /ใช้กับงานไหน/);
});

test("without the right to answer the open question is in the Q&A card, marked as waiting for the requester, and there is no answer form", () => {
  const html = pages.detailPage({ ...NEED_INFO, comments: [QUESTION2], info_pending: pendingOf(QUESTION2), allowed_actions: ["reject"] });
  assert.doesNotMatch(html, /itwo-answer-card|itwo-answer-form/);
  const history = html.match(/<section class="card itwo-comments"[\s\S]*?<\/section>/)[0];
  assert.match(history, /ใช้กับงานไหน/);
  assert.match(history, /<span class="badge more_info">รอผู้แจ้งตอบ<\/span>/);
});

test("the Q&A card lists every message in order: ask/answer, stage, author, Thai date and time, escaped text with its line breaks kept, and its own files", () => {
  const html = pages.detailPage({ ...DETAIL, status: "in_progress", comments: [QUESTION, ANSWER] });
  const card = html.match(/<section class="card itwo-comments"[\s\S]*?<\/section>/)[0];
  assert.match(visibleText(card), /ถาม-ตอบ 2/);
  const items = [...card.matchAll(/<article class="itwo-comment is-(\w+)" data-comment="(\d+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(items.map((item) => [item[1], item[2]]), [["question", "7"], ["answer", "12"]]);
  assert.match(visibleText(items[0][3]), /ถาม · ทีม IT โดย ไอที &lt;b&gt;หนึ่ง&lt;\/b&gt; · 19\/11\/2569 10:00/);
  assert.match(visibleText(items[1][3]), /ตอบ · ทีม IT โดย สมชาย ใจดี · 19\/11\/2569 11:00/);
  assert.match(items[0][3], /<p class="itwo-text">ขอไฟล์ต้นฉบับ\nบรรทัดสอง &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p>/, "line breaks stay (pre-wrap) and the markup is inert");
  assert.doesNotMatch(html, /<script>|<b>หนึ่ง|<img src=x/, "nothing from a comment, an author or a file name is live markup");
  assert.match(items[0][3], /data-attachment="c1"/);
  assert.match(items[0][3], /ถาม &lt;img src=x onerror=1&gt;\.pdf/);
  assert.doesNotMatch(items[0][3], /data-attachment="c2"/, "a message shows only its own files");
  assert.match(items[1][3], /data-attachment="c2"/);
  // ไม่มีข้อความ = ไม่มีการ์ด
  assert.doesNotMatch(pages.detailPage({ ...DETAIL, comments: [] }), /itwo-comments|ถาม-ตอบ/);
  assert.doesNotMatch(pages.detailPage(DETAIL), /itwo-comments/);
});

test("files of the Q&A messages are inside the one #attachment-gallery together with the order's own files; with no file anywhere there is no gallery", () => {
  const html = pages.detailPage({ ...DETAIL, attachment_flag: "yes", attachments: [FILE("f1", "แบบ.pdf")], comments: [QUESTION, ANSWER], status: "in_progress" });
  assert.equal(count(html, /id="attachment-gallery"/g), 1);
  const gallery = html.slice(html.indexOf('id="attachment-gallery"'));
  for (const id of ["f1", "c1", "c2"]) assert.equal(count(gallery, new RegExp(`<figure class="attachment-tile" data-attachment="${id}">`, "g")), 1, `${id} once, inside the gallery`);
  assert.equal(count(html, /<figure class="attachment-tile"/g), 3, "no tile is drawn twice (the gallery fills each tile by id)");
  // ไฟล์มีแต่ในข้อความ ก็ต้องมี gallery
  const commentOnly = pages.detailPage({ ...DETAIL, comments: [ANSWER], status: "in_progress" });
  assert.equal(count(commentOnly, /id="attachment-gallery"/g), 1);
  assert.ok(commentOnly.indexOf('id="attachment-gallery"') < commentOnly.indexOf('id="itwo-comments"'));
  // ข้อความที่ไม่มีไฟล์ = ไม่มี gallery
  assert.doesNotMatch(pages.detailPage({ ...DETAIL, comments: [QUESTION2], status: "in_progress" }), /attachment-gallery/);
  // ไฟล์ของคำถามที่ค้างอยู่ขึ้นที่การ์ดตอบ (ครั้งเดียว) ไม่ซ้ำในถาม-ตอบ
  const answering = pages.detailPage({ ...NEED_INFO, allowed_actions: ["provide_info"] });
  assert.equal(count(answering, /<figure class="attachment-tile" data-attachment="c1">/g), 1);
  assert.equal(count(answering, /id="attachment-gallery"/g), 1);
  assert.ok(answering.indexOf('id="attachment-gallery"') < answering.indexOf("itwo-answer-card"), "the gallery wraps the answer card too");
});

test("the print sheet adds a Q&A table only when there are messages: number, ask/answer, stage, by, Thai date and time, text, file count; rows may not split across pages", () => {
  assert.doesNotMatch(pages.printSheet(DETAIL), /ประวัติถาม-ตอบ|itwo-sheet-comments/);
  const html = pages.printSheet({ ...DETAIL, status: "need_info", info_return_status: "in_progress", comments: [ANSWER, QUESTION, QUESTION2] });
  assert.match(html, /<h2 class="itwo-sheet-section">ประวัติถาม-ตอบ<\/h2>/);
  const table = html.match(/<table class="itwo-sheet-table itwo-sheet-comments">[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...table.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((match) => match[1]), ["ลำดับ", "ถาม/ตอบ", "ขั้น", "โดย", "วันเวลา", "ข้อความ", "ไฟล์"]);
  const rows = table.match(/<tr>[\s\S]*?<\/tr>/g);
  assert.equal(rows.length, 4, "a header row and one row per message, in the order written");
  assert.match(visibleText(rows[1]), /^ 1 ถาม ทีม IT ไอที &lt;b&gt;หนึ่ง&lt;\/b&gt; 19\/11\/2569 10:00 ขอไฟล์ต้นฉบับ\s*บรรทัดสอง &lt;script&gt;alert\(1\)&lt;\/script&gt; 1 $/);
  assert.match(visibleText(rows[2]), /^ 2 ตอบ ทีม IT สมชาย ใจดี 19\/11\/2569 11:00 แนบมาให้แล้ว 1 $/);
  assert.match(visibleText(rows[3]), /^ 3 ถาม ผู้จัดการแผนก สมหญิง ผู้จัดการ 19\/11\/2569 12:00 ใช้กับงานไหน 0 $/, "a message without files counts 0");
  assert.doesNotMatch(html, /<script>|<b>หนึ่ง/);
  assert.doesNotMatch(html, /<img|data-attachment|attachment-tile/, "no pictures on paper; only the count");
  assert.ok(html.indexOf("ประวัติถาม-ตอบ") < html.indexOf("ลายเซ็น"), "the Q&A history comes before the signatures");
  assert.match(html, /สถานะใบสั่งงาน ณ ที่พิมพ์: รอผู้แจ้งตอบ/);
});

test("print: the IT signature slot is 'ส่งงาน', and a Q&A history sits after the rework history", () => {
  const html = pages.printSheet({ ...DETAIL, status: "in_progress", reworks: [ROUND(1, "แก้สี", "2026-12-01")], comments: [QUESTION2] });
  assert.match(html, /IT ผู้ดำเนินการ \(ส่งงาน\)/);
  assert.doesNotMatch(html, /ปิดงาน/);
  assert.ok(html.indexOf("ประวัติการแก้ไขงาน") < html.indexOf("ประวัติถาม-ตอบ"));
});

test("the stylesheet keeps the Q&A print table's rows whole and repeats its header like the rework table", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.itwo-sheet-reworks, \.itwo-sheet-comments \{ break-inside: auto; \}/);
  assert.match(css, /\.itwo-sheet-reworks thead, \.itwo-sheet-comments thead \{ display: table-header-group; \}/);
  assert.match(css, /\.itwo-sheet-reworks tr, \.itwo-sheet-comments tr \{ break-inside: avoid; \}/);
});

test("the upload panel shows each file's state, a summary, and offers a retry only for failed files once idle", () => {
  const rows = [{ name: "a.pdf", size: 1536, state: "done", message: "" }, { name: "b <x>.png", size: 2048, state: "failed", message: "เชื่อมต่อระบบไม่ได้" }, { name: "c.txt", size: 10, state: "waiting", message: "" }];
  const busy = pages.uploadPanel({ heading: "แจ้งงานแล้ว · เลขที่ IT06-26/001", intro: "ใบถูกบันทึกแล้ว", rows, busy: true });
  assert.match(busy, /aria-busy="true"/);
  assert.match(visibleText(busy), /กำลังแนบไฟล์ 2 จาก 3/);
  assert.doesNotMatch(busy, /itwo-upload-retry|itwo-upload-continue/, "no buttons while uploading");
  const idle = pages.uploadPanel({ heading: "h", rows, busy: false });
  assert.match(visibleText(idle), /แนบไม่สำเร็จ 1 จาก 3 ไฟล์ \(แนบแล้ว 1\)/);
  assert.match(idle, /itwo-upload-row is-failed[\s\S]*b &lt;x&gt;\.png[\s\S]*เชื่อมต่อระบบไม่ได้/);
  assert.match(idle, /id="itwo-upload-retry"/);
  assert.match(idle, /id="itwo-upload-continue">ไปที่ใบสั่งงาน</);
  const allDone = pages.uploadPanel({ heading: "h", rows: [rows[0]], busy: false });
  assert.match(visibleText(allDone), /แนบครบ 1 ไฟล์/);
  assert.doesNotMatch(allDone, /itwo-upload-retry/);
});

test("lists show what the work is for misc orders and the rework tag with its due date, in 'ใบของฉัน' and the IT list", () => {
  const mine = pages.mineList([{ ...MINE[0], status: "in_progress", request_type: "misc", misc_detail: "ซ่อมเมาส์", rework_round: 2, rework_due_date: "2026-12-05" }]);
  assert.match(mine, /<span class="badge itwo-rework-tag">แก้ไขครั้งที่ 2 · กำหนด 05\/12\/2569<\/span>/);
  assert.match(mine, /เบ็ดเตล็ดอื่นๆ · ซ่อมเมาส์/);
  assert.doesNotMatch(pages.mineList([MINE[0]]), /itwo-rework-tag/, "no rework, no tag");
  const it = pages.itList([{ ...MINE[0], status: "in_progress", is_urgent: false, request_type: "misc", misc_detail: "ซ่อมเมาส์", requester_full_name: "ก", department_name: "ข", has_dept_approved: true, has_it_mgr_approved: true, rework_round: 1, rework_due_date: "2026-12-05" }]);
  assert.match(it, /แก้ไขครั้งที่ 1 · กำหนด 05\/12\/2569/);
  assert.match(it, /เบ็ดเตล็ดอื่นๆ · ซ่อมเมาส์ · ก · ข/);
});

/* ---------- หน้าพิมพ์ ---------- */
test("the print sheet follows FM06: two request types ticked with the misc work, no IT access table, signature names with Thai date and time", () => {
  const html = pages.printSheet({
    ...DETAIL, status: "received", allowed_actions: [],
    events: [
      { action: "created", created_at: "2026-11-19T01:00:00Z", actor_full_name: "สมชาย ใจดี" },
      { action: "dept_approved", created_at: "2026-11-19T02:00:00Z", actor_full_name: "สมหญิง ผู้จัดการ" },
      { action: "it_mgr_approved", created_at: "2026-11-19T03:00:00Z", actor_full_name: "รสริน เชน" },
      { action: "started", created_at: "2026-11-19T04:00:00Z", actor_full_name: "ไอที หนึ่ง" },
      { action: "completed", created_at: "2026-11-19T05:00:00Z", actor_full_name: "ไอที หนึ่ง" },
    ],
  });
  assert.match(html, /<h1>ใบสั่งงานแผนก IT<\/h1>/);
  assert.match(html, /IT01-FM06/);
  assert.match(html, /<strong>IT06-26\/001<\/strong>/);
  assert.match(html, /\(งานด่วน\)/);
  const text = visibleText(html);
  assert.match(text, /☐ งานออกแบบ ☑ เบ็ดเตล็ดอื่นๆ \(ระบุ: ซ่อมเมาส์ &lt;i&gt;\)/);
  assert.doesNotMatch(text, /สิทธิ์การใช้งานในระบบคอมพิวเตอร์/, "the removed type is not on the form");
  assert.match(text, /☑ อื่นๆ \(สำเนาบัตร\)/);
  assert.doesNotMatch(html, /สำหรับแผนก IT : สิทธิ์ในระบบ|itwo-sheet-access|I-Prime/, "no IT access table (the page is shorter)");
  assert.doesNotMatch(html, /ไฟล์แนบ<\/th>|itwo-sheet-files|ประวัติการแก้ไขงาน/, "no files and no rework: neither row nor section");
  assert.match(html, /data-slot="dept_manager">[\s\S]*สมหญิง ผู้จัดการ[\s\S]*19\/11\/2569 09:00/);
  assert.match(html, /data-slot="it_approver">[\s\S]*รสริน เชน[\s\S]*19\/11\/2569 10:00/);
  assert.match(html, /รับงาน: ไอที หนึ่ง 19\/11\/2569 11:00/);
  assert.match(html, /data-slot="receiver">\s*<div class="itwo-signature-label">ผู้รับงาน<\/div>\s*<div class="itwo-signature-name"><\/div>/, "not received yet: the box is left blank");
  assert.doesNotMatch(html, /itwo-watermark/);
  assert.match(html, /สถานะใบสั่งงาน ณ ที่พิมพ์: รอผู้อนุมัติขั้น IT|สถานะใบสั่งงาน ณ ที่พิมพ์: ได้รับงานแล้ว/);
});

test("an old system-access order prints with its own type ticked and its recorded access rows (only systems that have rows)", () => {
  const html = pages.printSheet({ ...LEGACY, status: "received" });
  const text = visibleText(html);
  assert.match(text, /☐ งานออกแบบ ☐ เบ็ดเตล็ดอื่นๆ ☑ สิทธิ์การใช้งานในระบบคอมพิวเตอร์/);
  assert.match(html, /สำหรับแผนก IT : สิทธิ์ในระบบ/);
  assert.equal(count(html, /<td>(?:I-Prime System|Express System|E-Mail Address|อื่นๆ ระบุ)<\/td>/g), 1, "only the system that was recorded");
  assert.match(text, /somchai ใหม่/);
});

test("the print sheet lists the initial files by name (no pictures) and the rework history with each round's details, due date and files", () => {
  const html = pages.printSheet({
    ...DETAIL, status: "in_progress", attachment_flag: "yes", rework_round: 2,
    reworks: [ROUND(1, "แก้สี <b>เข้มขึ้น</b>", "2026-12-01"), ROUND(2, "แก้ขนาด", "2026-12-10", { created_at: "2026-12-03T03:00:00Z" })],
    attachments: [FILE("f1", "แบบกล่อง.pdf"), FILE("f2", "รูป <x>.png", 0, { size_bytes: 3 * 1024 * 1024 }), FILE("f3", "ตัวอย่างสี.pdf", 1)],
  });
  assert.doesNotMatch(html, /<img|data-attachment|attachment-tile/, "no pictures on paper");
  assert.match(html, /<th scope="row">ไฟล์แนบ<\/th><td colspan="3"><ul class="itwo-sheet-files"><li>แบบกล่อง\.pdf <span class="itwo-sheet-file-size">\(1\.5 KB\)<\/span><\/li><li>รูป &lt;x&gt;\.png/);
  assert.doesNotMatch(html.slice(0, html.indexOf("ประวัติการแก้ไขงาน")), /ตัวอย่างสี\.pdf/, "a rework file is in the rework table, not the first-filing row");
  assert.match(html, /<h2 class="itwo-sheet-section">ประวัติการแก้ไขงาน<\/h2>/);
  const rows = html.match(/<table class="itwo-sheet-table itwo-sheet-reworks">[\s\S]*?<\/table>/)[0].match(/<tr>[\s\S]*?<\/tr>/g);
  assert.equal(rows.length, 3, "a header row and one row per round");
  assert.match(visibleText(rows[1]), /1 26\/11\/2569 10:00 สมชาย ใจดี แก้สี &lt;b&gt;เข้มขึ้น&lt;\/b&gt; 01\/12\/2569 ตัวอย่างสี\.pdf/);
  assert.match(visibleText(rows[2]), /2 03\/12\/2569 10:00 สมชาย ใจดี แก้ขนาด 10\/12\/2569 —/, "a round without files shows a dash");
  // ลำดับบนกระดาษ: ข้อมูลใบ → ประวัติแก้ไข → ลายเซ็น (ลายเซ็นไม่ถูกตัดครึ่ง ดู CSS break-inside)
  assert.ok(html.indexOf("ประวัติการแก้ไขงาน") < html.indexOf("ลายเซ็น"));
});

test("a test sheet is stamped as a test on the paper itself", () => {
  const html = pages.printSheet({ ...DETAIL, is_test: true, doc_no: "TEST-IT06-26/001" });
  assert.match(html, /itwo-watermark[^>]*>ทดสอบ</);
  assert.match(html, /ใบทดสอบ — ไม่ใช่เอกสารจริง/);
  assert.match(pages.printSheet({ ...DETAIL, doc_no: "TEST-IT06-26/002" }), /itwo-watermark/, "by number too");
});

test("the print page has a back link and a print button that are left off the paper", () => {
  const html = pages.printPage(DETAIL);
  assert.match(html, /class="itwo-print-toolbar no-print"/);
  assert.match(html, /id="itwo-print-button"/);
  assert.match(html, /href="#\/office\?module=work-order&amp;view=order&amp;id=00000000-0000-4000-8000-000000000001"/);
});

/* ---------- ตั้งค่า ---------- */
test("settings: your own staff row cannot be edited, the next number is shown and can be set forward", () => {
  const staff = [
    { employee_id: "me", employee_no: "IT3462", full_name: "สุริยา", department_name: "IT", is_it_admin: true, is_it_approver: false, is_active: true },
    { employee_id: "x", employee_no: "FANG", full_name: "รสริน", department_name: "ฝ่ายบริหาร", is_it_admin: true, is_it_approver: true, is_active: true },
  ];
  const html = pages.settingsPage({ staff, counter: { year: 2026, next_seq: 7, next_doc_no: "IT06-26/007", is_test: false }, myEmployeeId: "me", isTest: false });
  assert.match(html, /data-staff-edit="IT3462"[^>]*disabled/);
  assert.match(html, /data-staff-remove="IT3462"[^>]*disabled/);
  assert.doesNotMatch(html, /data-staff-edit="FANG"[^>]*disabled/);
  assert.match(html, /แก้สิทธิ์ของตัวเองไม่ได้/);
  assert.match(html, /ผู้ดูแลงาน IT · ผู้อนุมัติขั้น IT/);
  assert.match(html, /IT06-26\/007/);
  assert.match(html, /id="itwo-counter-form"/);
  const test = pages.settingsPage({ staff, counter: null, myEmployeeId: "x", isTest: true });
  assert.match(test, /ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้/);
  assert.doesNotMatch(test, /itwo-counter-form/);
});

test("the error card shows one message and offers a retry only when asked", () => {
  assert.match(pages.errorCard("โหลดข้อมูลไม่สำเร็จ"), /id="itwo-retry"/);
  assert.doesNotMatch(pages.errorCard("ไม่มีสิทธิ์", { retry: false }), /itwo-retry/);
  assert.match(pages.errorCard("<b>x</b>"), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("the print sheet puts the single-click remark under both approval signatures", () => {
  const html = pages.printSheet({
    ...DETAIL,
    events: [
      { action: "created", actor_employee_no: "A1", created_at: "2026-11-19T01:00:00Z", actor_full_name: "ผู้แจ้ง" },
      { action: "dept_approved", actor_employee_no: "FANG", created_at: "2026-11-19T02:00:00Z", actor_full_name: "รสริน เชน" },
      { action: "it_mgr_approved", actor_employee_no: "FANG", created_at: "2026-11-19T02:00:00Z", actor_full_name: "รสริน เชน" },
    ],
  });
  assert.equal(count(html, /itwo-signature-remark[^>]*>\(อนุมัติครั้งเดียว นับเป็นทั้งสองขั้น\)/g), 2);
  assert.match(html, /data-slot="dept_manager">[\s\S]*?รสริน เชน/);
  assert.match(html, /data-slot="it_approver">[\s\S]*?รสริน เชน/);
});

test("settings: the staff form is a searchable list of employees when there is one, a plain code field when there is not, and off in test mode", () => {
  const staff = [{ employee_id: "x", employee_no: "FANG", full_name: "รสริน", department_name: "ฝ่ายบริหาร", is_it_admin: true, is_it_approver: true, is_active: true }];
  const counter = { year: 2026, next_seq: 7, next_doc_no: "IT06-26/007", is_test: false };
  const candidates = [{ value: "RB2", label: "RB2 สมชาย ใจดี · ฝ่ายผลิต RB" }];
  const withList = pages.settingsPage({ staff, counter, myEmployeeId: "me", isTest: false, candidates });
  assert.match(withList, /<select class="select" id="itwo-staff-no" name="employee_no">/);
  assert.match(withList, /<option value="RB2">RB2 สมชาย ใจดี · ฝ่ายผลิต RB<\/option>/);
  const without = pages.settingsPage({ staff, counter, myEmployeeId: "me", isTest: false });
  assert.match(without, /<input class="input" id="itwo-staff-no" name="employee_no"/);
  const test = pages.settingsPage({ staff, counter: null, myEmployeeId: "me", isTest: true, candidates });
  assert.match(test, /<select[^>]*id="itwo-staff-no"[^>]*disabled/);
  assert.match(test, /name="is_it_admin" disabled/);
});
