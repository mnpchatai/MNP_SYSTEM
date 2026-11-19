import assert from "node:assert/strict";
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
  assert.match(html, /class="view-tab active" aria-current="page" href="#\/office\?module=work-order&amp;view=approvals">รออนุมัติ <span class="itwo-tab-count" aria-label="3 รายการ">3<\/span>/);
  assert.match(html, />99\+</, "a long count is capped");
  assert.doesNotMatch(pages.tabs({ is_dept_approver: true }, "mine", { approvals: 0 }), /itwo-tab-count/, "zero is not shown");
  assert.doesNotMatch(pages.tabs({ is_dept_approver: true }, "mine", {}), /itwo-tab-count/, "an unread count is not shown");
  assert.doesNotMatch(html, /ตั้งค่า<\/a>.*ตั้งค่า<\/a>/s);
});

/* ---------- รายการ ---------- */
test("'ใบของฉัน' lists the number as a link, the status the requester understands, an urgent flag and Thai dates", () => {
  const html = pages.mineList(MINE);
  assert.match(html, /href="#\/office\?module=work-order&amp;view=order&amp;id=00000000-0000-4000-8000-000000000001"[^>]*>IT06-26\/001</);
  assert.match(html, /IT ปิดงานแล้ว รอคุณยืนยัน/);
  assert.match(html, /รอผู้จัดการแผนก/);
  assert.equal(count(html, /badge urgent-flag/g), 1);
  assert.match(html, /25\/11\/2569/);
  assert.match(html, /19\/11\/2569 08:00/, "08:00 Bangkok");
  assert.match(html, /19\/11\/2569 00:30/, "midnight crossing is the next Bangkok day");
  assert.match(html, /เบ็ดเตล็ดอื่นๆ/, "an order without details falls back to the request type");
  assert.doesNotMatch(html, /<b>/, "user text is escaped");
  assert.match(html, /&lt;b&gt;ใหม่&lt;\/b&gt;/);
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
test("the order form has the FM06 fields in order, with required marks only on the three required ones", () => {
  const html = pages.orderForm({ requester: { name: "สมชาย ใจดี", department: "การตลาด" } });
  const names = [...html.matchAll(/name="([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(names)], ["request_type", "order_ref", "attachment_flag", "attachment_note", "details", "needed_date", "is_urgent"]);
  assert.equal(count(html, /name="request_type"/g), 3);
  for (const label of ["งานออกแบบ", "สิทธิ์การใช้งานในระบบคอมพิวเตอร์", "เบ็ดเตล็ดอื่นๆ", "มี", "ไม่มี", "อื่นๆ"]) assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.equal(count(html, /field-required/g), 4, "request type, details, needed date and the 'other' note");
  assert.match(html, /name="attachment_flag" value="no" checked/, "'ไม่มี' is the default");
  assert.match(html, /id="itwo-attachment-note-field" hidden/, "the note field starts hidden");
  assert.match(html, /ออเดอร์ \(ไม่บังคับ\)/);
  assert.match(html, /maxlength="2000"/);
  assert.match(html, /type="date"/);
  assert.match(html, /งานด่วน/);
  assert.match(html, /หมายเหตุ: ระยะเวลาทำงาน งานออกแบบและงานสิทธิ์ 3–7 วันนับจากวันที่ได้ข้อมูลครบ งานเบ็ดเตล็ดตามตกลง/);
  assert.match(html, /ผู้แจ้ง สมชาย ใจดี · การตลาด · ระบบบันทึกวันและเวลาที่แจ้งให้เอง/, "the system fills in name, department and time");
  assert.equal(count(html, /id="itwo-form"/g), 1);
  assert.equal(count(html, /data-step="[123]"/g), 3);
});

test("the review step shows only what was filled in, and the 'other' attachment note", () => {
  const html = pages.orderReview({ request_type: "system_access", order_ref: "", attachment_flag: "other", attachment_note: "แบบฟอร์ม <x>", details: " ขอสิทธิ์ ", needed_date: "2026-11-25", is_urgent: true });
  assert.match(visibleText(html), /ประเภทคำขอ สิทธิ์การใช้งานในระบบคอมพิวเตอร์/);
  assert.match(visibleText(html), /เอกสารแนบ อื่นๆ \(แบบฟอร์ม &lt;x&gt;\)/, "the note is escaped (this is the text of the escaped markup)");
  assert.match(visibleText(html), /วันที่ต้องการงาน 25\/11\/2569/);
  assert.match(visibleText(html), /ความเร่งด่วน งานด่วน/);
  assert.doesNotMatch(html, /ออเดอร์/, "an empty order is not listed");
  assert.doesNotMatch(html, /<x>/);
});

/* ---------- รายละเอียด ---------- */
const DETAIL = {
  id: "00000000-0000-4000-8000-000000000001", is_test: false, doc_no: "IT06-26/001", status: "pending_it_mgr", is_urgent: true,
  request_type: "system_access", order_ref: "SO-9", attachment_flag: "other", attachment_note: "สำเนาบัตร", details: "ขอสิทธิ์ I-Prime\nบรรทัดสอง <script>",
  needed_date: "2026-11-25", created_at: "2026-11-19T01:00:00Z",
  requester: { employee_no: "MK1", full_name: "สมชาย ใจดี" }, department: { code: "MK", name_th: "การตลาด" },
  events: [
    { id: 1, action: "created", reason: null, created_at: "2026-11-19T01:00:00Z", actor_full_name: "สมชาย ใจดี" },
    { id: 2, action: "dept_approved", reason: "เห็นชอบ", created_at: "2026-11-18T17:05:00Z", actor_full_name: "สมหญิง ผู้จัดการ" },
  ],
  access_changes: [{ id: "a1", system: "i_prime", action: "add", new_username: "somchai", old_username: null, note: "ใหม่" }],
  approvals: { dept: { by: "สมหญิง ผู้จัดการ", at: "2026-11-18T17:05:00Z" }, it_mgr: null },
  allowed_actions: [],
};

test("the detail page shows every field, the pending step, the timeline with Bangkok times and reasons, and a print link", () => {
  const html = pages.detailPage(DETAIL);
  assert.equal(count(html, /<h1>/g), 1);
  assert.match(html, /<h1>IT06-26\/001<\/h1>/);
  assert.match(html, /IT01-FM06/);
  assert.match(html, /โดย สมชาย ใจดี · การตลาด · แจ้งเมื่อ 19\/11\/2569 08:00/);
  assert.match(html, /ยังไม่ได้อนุมัติ: ผู้อนุมัติขั้น IT/);
  assert.doesNotMatch(html, /ยังไม่ได้อนุมัติ: ผู้จัดการแผนก/, "the step already approved is not listed as pending");
  const text = visibleText(html);
  assert.match(text, /ประเภทคำขอ สิทธิ์การใช้งานในระบบคอมพิวเตอร์/);
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
  assert.deepEqual([...it.matchAll(/data-itwo-action="([a-z]+)"/g)].map((match) => match[1]), ["start", "complete"], "edit_access and unknown actions are not buttons");
});

test("the 'for the IT department' section is read-only for everyone except those with edit_access, who get an edit button", () => {
  const readOnly = pages.detailPage({ ...DETAIL, allowed_actions: ["approve"] });
  assert.match(readOnly, /สำหรับแผนก IT : สิทธิ์ในระบบ/);
  assert.match(visibleText(readOnly), /I-Prime System เพิ่ม somchai — ใหม่/);
  assert.doesNotMatch(readOnly, /itwo-access-edit|itwo-access-form/);
  const editable = pages.detailPage({ ...DETAIL, status: "approved", allowed_actions: ["start", "edit_access"] });
  assert.match(editable, /id="itwo-access-edit"/);
  assert.match(pages.detailPage({ ...DETAIL, access_changes: [] }), /IT ยังไม่ได้บันทึกสิทธิ์ในระบบสำหรับใบนี้/);
});

test("the access editor has a row per draft with the four systems and three actions, and shows row and general errors", () => {
  const model = globalThis.MNP_ITWO_MODEL;
  const drafts = [{ ...model.blankAccessDraft("n1"), system: "express", action: "change", newUsername: "<n>", oldUsername: "o", note: "" }, model.blankAccessDraft("n2")];
  const html = pages.accessSection({ changes: [], canEdit: true, drafts, validation: { rows: { 1: "กรุณาเลือกระบบ" }, general: "บันทึกได้ไม่เกิน 20 รายการต่อใบ" } });
  assert.equal(count(html, /data-access-row="/g), 2);
  assert.match(html, /<option value="express" selected>Express System<\/option>/);
  assert.match(html, /<option value="change" selected>เปลี่ยน<\/option>/);
  for (const label of ["I-Prime System", "Express System", "E-Mail Address", "อื่นๆ ระบุ", "เพิ่ม", "เปลี่ยน", "ยกเลิก"]) assert.ok(html.includes(`>${label}</option>`), label);
  assert.match(html, /value="&lt;n&gt;"/, "a draft value is escaped");
  assert.match(html, /กรุณาเลือกระบบ/);
  assert.match(html, /บันทึกได้ไม่เกิน 20 รายการต่อใบ/);
  assert.match(html, /บันทึกส่วนของ IT/);
  // ผู้ที่ไม่มีสิทธิ์แก้ไม่เห็นฟอร์ม แม้มี drafts ส่งมา
  assert.doesNotMatch(pages.accessSection({ changes: [], canEdit: false, drafts }), /itwo-access-form/);
});

/* ---------- หน้าพิมพ์ ---------- */
test("the print sheet follows FM06: choices ticked, all four access systems, signature names with Thai date and time", () => {
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
  assert.match(text, /☑ สิทธิ์การใช้งานในระบบคอมพิวเตอร์/);
  assert.match(text, /☐ งานออกแบบ/);
  assert.match(text, /☑ อื่นๆ \(สำเนาบัตร\)/);
  assert.equal(count(html, /<td>(?:I-Prime System|Express System|E-Mail Address|อื่นๆ ระบุ)<\/td>/g), 4, "four systems, even the empty ones");
  assert.match(html, /data-slot="dept_manager">[\s\S]*สมหญิง ผู้จัดการ[\s\S]*19\/11\/2569 09:00/);
  assert.match(html, /data-slot="it_approver">[\s\S]*รสริน เชน[\s\S]*19\/11\/2569 10:00/);
  assert.match(html, /รับงาน: ไอที หนึ่ง 19\/11\/2569 11:00/);
  assert.match(html, /data-slot="receiver">\s*<div class="itwo-signature-label">ผู้รับงาน<\/div>\s*<div class="itwo-signature-name"><\/div>/, "not received yet: the box is left blank");
  assert.doesNotMatch(html, /itwo-watermark/);
  assert.match(html, /สถานะใบสั่งงาน ณ ที่พิมพ์: รอผู้อนุมัติขั้น IT|สถานะใบสั่งงาน ณ ที่พิมพ์: ได้รับงานแล้ว/);
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
