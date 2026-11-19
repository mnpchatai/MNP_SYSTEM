import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// ส่วนข้อมูลล้วนของใบสั่งงาน IT (modules/itwo-model.js): แท็บตามบทบาท ปุ่มตาม allowed_actions กติกาฟอร์ม รูปแบบวันที่/เลข/สถานะ ไทม์ไลน์ และข้อความ error
const require = createRequire(import.meta.url);
const model = require("../../modules/itwo-model.js");
require("../../modules/form-steps.js"); // MNP_FORM_STEPS.validate = ตัวตรวจฟอร์มจริงที่หน้าแจ้งงานใช้
const { validate } = globalThis.MNP_FORM_STEPS;

const plain = (value) => JSON.parse(JSON.stringify(value));
const params = (query) => new URLSearchParams(query);

/* ---------- แท็บตามบทบาท ---------- */
test("every user gets 'ใบของฉัน'; approvals, IT work and settings follow my_role", () => {
  const keys = (role) => model.visibleTabs(role).map((tab) => tab.key);
  assert.deepEqual(keys({}), ["mine"]);
  assert.deepEqual(keys(null), ["mine"]);
  assert.deepEqual(keys({ is_dept_approver: false, is_it_admin: false, is_it_approver: false }), ["mine"]);
  assert.deepEqual(keys({ is_dept_approver: true }), ["mine", "approvals"]);
  assert.deepEqual(keys({ is_it_approver: true }), ["mine", "approvals", "it"], "the IT-step approver sees approvals and the IT list, but not settings");
  assert.deepEqual(keys({ is_it_admin: true }), ["mine", "it", "settings"]);
  assert.deepEqual(keys({ is_it_admin: true, is_it_approver: true }), ["mine", "approvals", "it", "settings"]);
  assert.deepEqual(plain(model.visibleTabs({}))[0], { key: "mine", label: "ใบของฉัน" });
});

test("a tab the user may not see is turned back, while detail/new/print pages are not tabs", () => {
  const employee = {};
  const approver = { is_dept_approver: true };
  assert.equal(model.viewAllowed("mine", employee), true);
  for (const view of ["approvals", "it", "settings"]) assert.equal(model.viewAllowed(view, employee), false, view);
  assert.equal(model.viewAllowed("approvals", approver), true);
  assert.equal(model.viewAllowed("it", approver), false);
  for (const view of ["new", "order", "print"]) assert.equal(model.viewAllowed(view, employee), true, `${view} is checked by the database, not by tab`);
});

test("?view= picks the page: none is 'ใบของฉัน', unknown is not found", () => {
  assert.equal(model.readView(params("module=work-order")), "mine");
  assert.equal(model.readView(null), "mine");
  for (const view of ["mine", "approvals", "it", "settings", "new", "order", "print"]) assert.equal(model.readView(params(`view=${view}`)), view);
  for (const view of ["MINE", "admin", "constructor", "__proto__"]) assert.equal(model.readView(params(`view=${view}`)), null, view);
});

test("work-order URLs always carry module=work-order, and 'mine' has no view", () => {
  assert.equal(model.workOrderUrl("mine"), "#/office?module=work-order");
  assert.equal(model.workOrderUrl(), "#/office?module=work-order");
  assert.equal(model.workOrderUrl("new"), "#/office?module=work-order&view=new");
  assert.equal(model.workOrderUrl("order", { id: "abc" }), "#/office?module=work-order&view=order&id=abc");
  assert.equal(model.workOrderUrl("order", { id: "" }), "#/office?module=work-order&view=order", "an empty extra is dropped");
});

test("only a UUID is accepted as an order id", () => {
  assert.equal(model.isUuid("00000000-0000-4000-8000-000000000001"), true);
  for (const bad of ["", null, undefined, "abc", "1", "00000000-0000-4000-8000-00000000000g", "' or 1=1 --"]) assert.equal(model.isUuid(bad), false, String(bad));
});

/* ---------- ปุ่มตาม allowed_actions ---------- */
test("buttons come only from allowed_actions, in a fixed order: decide, then IT steps, then the requester's", () => {
  const labels = (allowed) => model.actionButtons(allowed).map((button) => button.action);
  assert.deepEqual(labels([]), []);
  assert.deepEqual(labels(undefined), []);
  assert.deepEqual(labels("approve"), [], "not an array");
  assert.deepEqual(labels(["cancel", "reject", "approve"]), ["approve", "reject", "cancel"], "order does not depend on the input order");
  assert.deepEqual(labels(["receive", "complete", "start"]), ["start", "complete", "receive"]);
  assert.deepEqual(labels(["approve", "reject", "start", "complete", "receive", "request_rework", "cancel"]), ["approve", "reject", "start", "complete", "receive", "request_rework", "cancel"]);
  // รุ่น 3: ถามผู้แจ้งอยู่ท้ายปุ่มตัดสินใจ · ตอบคำถามอยู่ก่อนยกเลิก
  assert.deepEqual(labels(["cancel", "provide_info", "request_info", "reject", "approve"]), ["approve", "reject", "request_info", "provide_info", "cancel"]);
  assert.deepEqual(labels(["cancel", "request_rework", "receive"]), ["receive", "request_rework", "cancel"], "'แก้ไขงาน' sits right after 'ได้รับงานเรียบร้อยแล้ว'");
});

test("an unknown action never becomes a button; edit_access (the removed IT section) is among the unknown ones", () => {
  assert.deepEqual(model.actionButtons(["edit_access", "delete", "__proto__", "constructor"]), []);
  assert.equal(model.canEditAccess, undefined, "nothing in the model edits the IT access section any more");
  assert.equal(model.accessPayload, undefined);
  assert.equal(model.validateAccessChanges, undefined);
});

test("'แก้ไขงาน' opens the rework form instead of calling an RPC; it is a secondary button next to 'received'", () => {
  const rework = model.ACTION_BUTTONS.request_rework;
  assert.equal(rework.label, "แก้ไขงาน");
  assert.equal(rework.opens, "rework");
  assert.equal(rework.rpc, undefined, "the RPC is called by the form with the details, not by the button");
  assert.equal(rework.tone, "secondary");
  assert.deepEqual(model.actionButtons(["receive", "request_rework"]).map((button) => button.label), ["ได้รับงานเรียบร้อยแล้ว", "แก้ไขงาน"]);
});

test("'ส่งงาน' replaces 'ปิดงาน' everywhere IT sees it: button, confirm, toast, timeline, signature slot (status and action keys are unchanged)", () => {
  const complete = model.ACTION_BUTTONS.complete;
  assert.equal(complete.label, "ส่งงาน");
  assert.equal(complete.rpc, "app_itwo_complete", "the RPC and the action key keep their names");
  assert.equal(complete.confirmTitle, "ส่งงานใบสั่งงานนี้?");
  assert.equal(complete.done, "ส่งงานแล้ว รอผู้แจ้งยืนยันรับงาน");
  assert.match(complete.confirmMessage, /เมื่อส่งงานแล้ว/);
  assert.equal(model.eventLabel("completed"), "IT ส่งงาน");
  assert.equal(model.signatureSlots([]).find((slot) => slot.key === "it_operator").label, "IT ผู้ดำเนินการ (ส่งงาน)");
  assert.equal(model.statusLabel("it_closed"), "IT ส่งงาน (รอผู้แจ้งยืนยัน)");
  assert.equal(model.myStatusLabel("it_closed"), "IT ส่งงานแล้ว รอคุณยืนยัน");
  const texts = [...Object.values(model.ACTION_BUTTONS).flatMap((spec) => [spec.label, spec.done, spec.confirmTitle, spec.confirmMessage]), ...Object.values(model.STATUS_LABELS), ...Object.values(model.EVENT_LABELS), model.completeToast({ requester: { full_name: "ก" } }, false), model.completeToast({}, true)];
  assert.ok(texts.filter(Boolean).every((text) => !text.includes("ปิดงาน")), "no 'ปิดงาน' is left in labels, dialogs, toasts or timeline");
});

test("'ถามผู้แจ้ง' opens the ask form (no RPC from the button); 'ตอบคำถาม' belongs to the always-open answer form, so it is inline", () => {
  const ask = model.ACTION_BUTTONS.request_info;
  assert.equal(ask.label, "ถามผู้แจ้ง");
  assert.equal(ask.opens, "ask");
  assert.equal(ask.rpc, "app_itwo_request_info", "the form calls it with the message");
  assert.ok(ask.confirmTitle && ask.confirmMessage && ask.confirmLabel && ask.done);
  assert.equal(ask.done, "ส่งคำถามถึงผู้แจ้งแล้ว");
  const answer = model.ACTION_BUTTONS.provide_info;
  assert.equal(answer.opens, "answer");
  assert.equal(answer.inline, true);
  assert.equal(answer.rpc, "app_itwo_provide_info");
  assert.deepEqual(model.actionButtons(["provide_info", "cancel"]).map((button) => button.action), ["provide_info", "cancel"]);
  assert.equal(model.answerToast("it"), "ส่งคำตอบแล้ว ใบกลับไปที่ทีม IT");
  assert.equal(model.answerToast("dept"), "ส่งคำตอบแล้ว ใบกลับไปที่ผู้จัดการแผนก");
  assert.equal(model.answerToast("it_mgr"), "ส่งคำตอบแล้ว ใบกลับไปที่ผู้อนุมัติขั้น IT");
});

test("every button has a Thai label, an RPC name and a confirm text; reject and cancel ask for a reason", () => {
  for (const action of model.ACTION_ORDER.filter((name) => name !== "request_rework")) {
    const spec = model.ACTION_BUTTONS[action];
    assert.match(spec.rpc, /^app_itwo_[a-z_]+$/, action);
    assert.match(spec.label, /[฀-๿]/, action);
    assert.match(spec.done, /[฀-๿]/, action);
    if (action === "reject" || action === "cancel") {
      assert.ok(spec.reason?.title && spec.reason.label && spec.reason.confirmLabel, `${action} asks for a reason`);
      assert.equal(spec.confirmTitle, undefined);
      assert.equal(spec.tone, "danger");
    } else {
      assert.ok(spec.confirmTitle && spec.confirmMessage, `${action} has a confirm dialog`);
      assert.equal(spec.reason, undefined);
    }
  }
  assert.equal(model.ACTION_BUTTONS.receive.label, "ได้รับงานเรียบร้อยแล้ว");
  assert.deepEqual(model.actionButtons(["approve"]).map((button) => button.rpc), ["app_itwo_approve"]);
  assert.deepEqual(Object.keys(model.ACTION_BUTTONS).sort(), [...model.ACTION_ORDER].sort());
});

/* ---------- ฟอร์มแจ้งงาน ---------- */
const NOW = new Date("2026-11-19T05:00:00Z"); // 12:00 น. ตามเวลาไทย
const TODAY = "2026-11-19";
const GOOD = { request_type: "design", misc_detail: "", order_ref: "", attachment_flag: "no", attachment_note: "", details: "ออกแบบกล่อง", needed_date: "2026-11-25", is_urgent: false };
const errorsOf = (values, flag = values.attachment_flag, today = TODAY) => validate(model.orderRules({ today: () => today, attachmentFlag: () => flag, requestType: () => values.request_type }), values);

test("a complete form passes; the request types are design and misc only (no system access) and attachment options keep the form's order", () => {
  assert.deepEqual(errorsOf(GOOD), []);
  assert.deepEqual(plain(model.REQUEST_TYPES), [
    { value: "design", label: "งานออกแบบ" },
    { value: "misc", label: "เบ็ดเตล็ดอื่นๆ" },
  ]);
  assert.ok(!model.REQUEST_TYPES.some((type) => type.value === "system_access"), "the system-access option is gone from the form");
  assert.deepEqual(model.ATTACHMENT_FLAGS.map((flag) => flag.label), ["มี", "ไม่มี", "อื่นๆ"]);
  assert.equal(model.EMPTY_ORDER_FORM.attachment_flag, "no");
});

test("an old order of the removed 'system access' type still has its Thai label, and the print form ticks it only for that order", () => {
  assert.equal(model.requestTypeLabel("system_access"), "สิทธิ์การใช้งานในระบบคอมพิวเตอร์");
  assert.deepEqual(model.printRequestTypes("design").map((type) => type.value), ["design", "misc"]);
  assert.deepEqual(model.printRequestTypes("system_access").map((type) => type.value), ["design", "misc", "system_access"]);
});

test("'เบ็ดเตล็ดอื่นๆ' must say what the work is (up to 200 characters); other types do not ask", () => {
  assert.deepEqual(errorsOf({ ...GOOD, request_type: "misc", misc_detail: "  " }).map((error) => [error.name, error.step, error.message]), [["misc_detail", 1, "กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร"]]);
  assert.deepEqual(errorsOf({ ...GOOD, request_type: "misc", misc_detail: "ซ่อมเมาส์" }), []);
  assert.deepEqual(errorsOf({ ...GOOD, request_type: "misc", misc_detail: "ก".repeat(200) }), []);
  assert.deepEqual(errorsOf({ ...GOOD, request_type: "misc", misc_detail: "ก".repeat(201) }).map((error) => error.name), ["misc_detail"]);
  assert.deepEqual(errorsOf({ ...GOOD, request_type: "design", misc_detail: "" }), [], "design needs no extra text");
  assert.equal(model.requestTypeText("misc", " ซ่อมเมาส์ "), "เบ็ดเตล็ดอื่นๆ · ซ่อมเมาส์");
  assert.equal(model.requestTypeText("design", "ignored"), "งานออกแบบ");
  assert.equal(model.requestTypeText("misc", null), "เบ็ดเตล็ดอื่นๆ", "an old misc order has no detail");
});

test("request type, details and needed date are required, in screen order, with Thai messages", () => {
  const errors = errorsOf({ ...GOOD, request_type: "", details: "   ", needed_date: "" });
  assert.deepEqual(errors.map((error) => [error.name, error.step, error.message]), [
    ["request_type", 1, "กรุณาเลือกประเภทคำขอ"],
    ["details", 1, "กรุณากรอกรายละเอียดงาน"],
    ["needed_date", 2, "กรุณาเลือกวันที่ต้องการงาน"],
  ]);
  assert.deepEqual(errorsOf({ ...GOOD, order_ref: "" }), [], "the order is optional");
});

test("details are limited to 2000 characters and counted as characters, not UTF-16 units", () => {
  assert.deepEqual(errorsOf({ ...GOOD, details: "ก".repeat(2000) }), []);
  assert.deepEqual(errorsOf({ ...GOOD, details: "ก".repeat(2001) }).map((error) => error.name), ["details"]);
  // อีโมจิ 1 ตัว = 2 หน่วยของสตริงแต่ 1 ตัวอักษร (ฐานข้อมูลนับตัวอักษร)
  assert.deepEqual(errorsOf({ ...GOOD, details: "😀".repeat(2000) }), []);
  assert.equal(model.charCount("😀😀"), 2);
  assert.match(errorsOf({ ...GOOD, details: "ก".repeat(2001) })[0].message, /2,000/);
});

test("the needed date cannot be in the past by Thai time, and is read again at every check", () => {
  assert.deepEqual(errorsOf({ ...GOOD, needed_date: TODAY }), [], "today is fine");
  assert.deepEqual(errorsOf({ ...GOOD, needed_date: "2026-11-18" }).map((error) => error.message), ["วันที่ต้องการงานต้องเป็นวันนี้หรือหลังจากนี้"]);
  assert.deepEqual(errorsOf({ ...GOOD, needed_date: "2026-02-30" }).map((error) => error.name), ["needed_date"], "a date that does not exist");
  assert.deepEqual(errorsOf({ ...GOOD, needed_date: "25/11/2026" }).map((error) => error.name), ["needed_date"]);
  // ฟอร์มค้างข้ามเที่ยงคืน: วันที่ที่เมื่อกี้ผ่านต้องไม่ผ่านเมื่อวันเปลี่ยน
  let today = "2026-11-19";
  const rules = model.orderRules({ today: () => today });
  assert.deepEqual(validate(rules, GOOD), []);
  today = "2026-11-26";
  assert.deepEqual(validate(rules, GOOD).map((error) => error.name), ["needed_date"]);
});

test("today is computed in Asia/Bangkok, not UTC", () => {
  assert.equal(model.todayBangkok(new Date("2026-11-18T17:30:00Z")), "2026-11-19", "00:30 in Bangkok is already the next day");
  assert.equal(model.todayBangkok(new Date("2026-11-18T16:59:00Z")), "2026-11-18");
  assert.equal(model.todayBangkok(new Date("2026-12-31T20:00:00Z")), "2027-01-01", "across the new year");
  assert.match(model.todayBangkok(NOW), /^\d{4}-\d{2}-\d{2}$/);
});

test("the attachment note is required only when 'อื่นๆ' is chosen", () => {
  assert.deepEqual(errorsOf({ ...GOOD, attachment_flag: "no", attachment_note: "" }), []);
  assert.deepEqual(errorsOf({ ...GOOD, attachment_flag: "yes", attachment_note: "" }), []);
  const other = errorsOf({ ...GOOD, attachment_flag: "other", attachment_note: " " });
  assert.deepEqual(other.map((error) => [error.name, error.message]), [["attachment_note", "กรุณาระบุเอกสารแนบ (เมื่อเลือก \"อื่นๆ\")"]]);
  assert.deepEqual(errorsOf({ ...GOOD, attachment_flag: "other", attachment_note: "แบบร่าง" }), []);
  assert.deepEqual(errorsOf({ ...GOOD, attachment_flag: "other", attachment_note: "ก".repeat(201) }).map((error) => error.name), ["attachment_note"]);
  assert.deepEqual(errorsOf({ ...GOOD, order_ref: "ก".repeat(101) }).map((error) => error.name), ["order_ref"]);
});

test("create parameters are trimmed, the note is sent only with 'other', and nothing the database decides is sent", () => {
  const params = model.createParams({ ...GOOD, order_ref: "  SO-1 ", details: "  ทำกล่อง\n", attachment_flag: "yes", attachment_note: "ซ่อนอยู่", is_urgent: true });
  assert.deepEqual(plain(params), {
    p_request_type: "design", p_misc_detail: null, p_order_ref: "SO-1", p_attachment_flag: "yes", p_attachment_note: null,
    p_details: "ทำกล่อง", p_needed_date: "2026-11-25", p_is_urgent: true,
  });
  assert.equal(model.createParams({ ...GOOD, request_type: "misc", misc_detail: "  ซ่อมเมาส์ " }).p_misc_detail, "ซ่อมเมาส์", "misc sends what the work is");
  assert.equal(model.createParams({ ...GOOD, request_type: "design", misc_detail: "ค้างจากการเลือกเบ็ดเตล็ด" }).p_misc_detail, null, "a stale misc text is not sent with another type");
  assert.equal(model.createParams({ ...GOOD, attachment_flag: "other", attachment_note: " แบบ " }).p_attachment_note, "แบบ");
  assert.equal(model.createParams(GOOD).p_order_ref, null, "an empty order is null");
  assert.equal(model.createParams({ ...GOOD, is_urgent: undefined }).p_is_urgent, false);
  const keys = Object.keys(params).join(" ");
  assert.doesNotMatch(keys, /doc_no|requester|department|created|status/, "document number, requester, department and time come from the database");
});

test("the duration note is the FM06 wording", () => {
  assert.equal(model.DURATION_NOTE, "งานออกแบบ 3–7 วันนับจากวันที่ได้ข้อมูลครบ · งานเบ็ดเตล็ดตามตกลง");
});

/* ---------- เหตุผลไม่อนุมัติ / ยกเลิก ---------- */
test("a reason is required and at most 500 characters", () => {
  assert.equal(model.validateReason("", "ไม่อนุมัติ"), "กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  assert.equal(model.validateReason("   ", "ยกเลิก"), "กรุณาระบุเหตุผลที่ยกเลิก");
  assert.equal(model.validateReason(null), "กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  assert.equal(model.validateReason("ไม่จำเป็นแล้ว"), null);
  assert.equal(model.validateReason("ก".repeat(500)), null);
  assert.equal(model.validateReason("ก".repeat(501)), "เหตุผลต้องไม่เกิน 500 ตัวอักษร");
});

/* ---------- วันที่ เวลา เลขที่ สถานะ ---------- */
test("a date-only value shows as dd/mm/yyyy (Buddhist year) without moving by time zone", () => {
  assert.equal(model.formatDate("2026-11-19"), "19/11/2569");
  assert.equal(model.formatDate("2026-01-01"), "01/01/2569");
  assert.equal(model.formatDate("2026-12-31"), "31/12/2569");
  assert.equal(model.formatDate(null), "—");
  assert.equal(model.formatDate(""), "—");
  assert.equal(model.formatDate("ไม่ใช่วันที่"), "ไม่ใช่วันที่");
});

test("a timestamp shows as dd/mm/yyyy hh:mm in Bangkok time", () => {
  assert.equal(model.formatDateTime("2026-11-19T05:07:00Z"), "19/11/2569 12:07");
  assert.equal(model.formatDateTime("2026-11-18T17:00:00Z"), "19/11/2569 00:00", "midnight in Bangkok is the next day, 00:00 not 24:00");
  assert.equal(model.formatDateTime("2026-11-18T16:59:00+00:00"), "18/11/2569 23:59");
  assert.equal(model.formatDateTime("2026-11-19T12:00:00+07:00"), "19/11/2569 12:00");
  assert.equal(model.formatDateTime(null), "—");
  assert.equal(model.formatDateTime("nope"), "nope");
});

test("every status has a Thai label and a badge class that the stylesheet already colours", () => {
  const statuses = ["pending_dept", "pending_it_mgr", "approved", "in_progress", "it_closed", "need_info", "received", "rejected", "cancelled"];
  assert.deepEqual(Object.keys(model.STATUS_LABELS), statuses);
  for (const status of statuses) {
    assert.match(model.statusLabel(status), /[฀-๿]/, status);
    assert.ok(model.statusBadgeClass(status), status);
  }
  assert.equal(model.statusLabel("pending_dept"), "รอผู้จัดการแผนก");
  assert.equal(model.statusLabel("received"), "ได้รับงานแล้ว");
  assert.equal(model.statusLabel("unknown_status"), "unknown_status", "an unknown status is shown as-is, never hidden");
  assert.equal(model.statusLabel(null), "");
  assert.equal(model.myStatusLabel("it_closed"), "IT ส่งงานแล้ว รอคุณยืนยัน", "the requester sees whose turn it is");
  assert.equal(model.statusLabel("need_info"), "รอผู้แจ้งตอบ");
  assert.equal(model.myStatusLabel("need_info"), "รอคุณตอบ", "the requester sees that the question is theirs to answer");
  assert.equal(model.statusBadgeClass("need_info"), "more_info", "the amber '?' badge the stylesheet already has");
  assert.equal(model.myStatusLabel("approved"), model.statusLabel("approved"));
});

test("a test document is recognised by its TEST- prefix and formatted like the database does", () => {
  assert.equal(model.isTestDoc("TEST-IT06-26/001"), true);
  assert.equal(model.isTestDoc("IT06-26/001"), false);
  assert.equal(model.isTestDoc(null), false);
  assert.equal(model.formatDocNo(false, 2026, 1), "IT06-26/001");
  assert.equal(model.formatDocNo(true, 2026, 12), "TEST-IT06-26/012");
  assert.equal(model.formatDocNo(false, 2026, 101), "IT06-26/101");
  assert.equal(model.formatDocNo(false, 2027, 1000), "IT06-27/1000");
});

/* ---------- ไทม์ไลน์ / ลายเซ็น ---------- */
const EVENTS = [
  { id: 1, action: "created", reason: null, created_at: "2026-11-19T01:00:00Z", actor_full_name: "สมชาย ใจดี" },
  { id: 2, action: "dept_approved", reason: null, created_at: "2026-11-19T02:00:00Z", actor_full_name: "สมหญิง ผู้จัดการ" },
  { id: 3, action: "it_mgr_approved", reason: null, created_at: "2026-11-19T03:00:00Z", actor_full_name: "รสริน เชน" },
  { id: 4, action: "started", reason: null, created_at: "2026-11-19T04:00:00Z", actor_full_name: "ไอที หนึ่ง" },
];

test("every history action has a Thai label", () => {
  for (const action of ["created", "dept_approved", "dept_rejected", "it_mgr_approved", "it_mgr_rejected", "cancelled", "started", "completed", "received", "rework_requested", "info_requested", "info_provided"]) {
    assert.match(model.eventLabel(action), /[฀-๿]/, action);
  }
  assert.equal(model.eventLabel("future_action"), "future_action");
});

test("signature slots take the first event of each action, leave unsigned slots blank and show who started the work", () => {
  const slots = model.signatureSlots(EVENTS);
  assert.deepEqual(slots.map((slot) => slot.key), ["requester", "dept_manager", "it_approver", "it_operator", "receiver"]);
  assert.equal(slots[0].name, "สมชาย ใจดี");
  assert.equal(slots[1].name, "สมหญิง ผู้จัดการ");
  assert.equal(slots[2].at, "2026-11-19T03:00:00Z");
  assert.equal(slots[3].name, null, "not closed yet");
  assert.deepEqual(plain(slots[3].note), { label: "รับงาน", name: "ไอที หนึ่ง", at: "2026-11-19T04:00:00Z" });
  assert.equal(slots[4].name, null);
  assert.equal(model.signatureSlots(undefined).every((slot) => slot.name === null), true);
  // เหตุการณ์ซ้ำ: ใช้ครั้งแรก (เซ็นครั้งแรกคือลายเซ็น)
  const doubled = model.signatureSlots([...EVENTS, { ...EVENTS[1], id: 9, actor_full_name: "คนอื่น", created_at: "2026-11-20T00:00:00Z" }]);
  assert.equal(doubled[1].name, "สมหญิง ผู้จัดการ");
  // ใบที่ถูกขอแก้ไขงานปิดงานหลายครั้ง: ช่อง IT ใช้การปิดงานครั้งล่าสุด (ครั้งที่ผู้แจ้งรับ) ส่วนผู้รับงาน (เริ่มทำ) ยังเป็นครั้งแรก
  const reworked = model.signatureSlots([...EVENTS,
    { id: 5, action: "completed", created_at: "2026-11-20T01:00:00Z", actor_full_name: "ไอที หนึ่ง" },
    { id: 6, action: "rework_requested", created_at: "2026-11-20T02:00:00Z", actor_full_name: "สมชาย ใจดี" },
    { id: 7, action: "completed", created_at: "2026-11-21T01:00:00Z", actor_full_name: "ไอที สอง" },
    { id: 8, action: "received", created_at: "2026-11-21T02:00:00Z", actor_full_name: "สมชาย ใจดี" }]);
  assert.equal(reworked[3].name, "ไอที สอง");
  assert.equal(reworked[3].at, "2026-11-21T01:00:00Z");
  assert.equal(reworked[3].note.name, "ไอที หนึ่ง");
  assert.equal(reworked[4].name, "สมชาย ใจดี");
});

test("approval summary says approved / rejected / waiting / none for each of the two steps", () => {
  const states = (detail) => model.approvalSummary(detail).map((step) => step.state);
  const approved = { status: "approved", events: EVENTS, approvals: { dept: { by: "สมหญิง ผู้จัดการ", at: "2026-11-19T02:00:00Z" }, it_mgr: { by: "รสริน เชน", at: "2026-11-19T03:00:00Z" } } };
  assert.deepEqual(states(approved), ["approved", "approved"]);
  assert.equal(model.approvalSummary(approved)[1].by, "รสริน เชน");
  assert.deepEqual(states({ status: "pending_dept", events: [], approvals: { dept: null, it_mgr: null } }), ["waiting", "waiting"]);
  assert.deepEqual(states({ status: "pending_it_mgr", events: [], approvals: { dept: { by: "ก", at: "x" }, it_mgr: null } }), ["approved", "waiting"]);
  const rejected = { status: "rejected", events: [{ action: "dept_rejected", actor_full_name: "สมหญิง ผู้จัดการ", created_at: "2026-11-19T02:00:00Z" }], approvals: { dept: null, it_mgr: null } };
  assert.deepEqual(states(rejected), ["rejected", "none"], "a step after the rejection is not waiting");
  assert.deepEqual(states({ status: "cancelled", events: [], approvals: {} }), ["none", "none"]);
  assert.deepEqual(states(undefined), ["waiting", "waiting"]);
});

/* ---------- งาน IT: จัดกลุ่ม ---------- */
const row = (id, status, extra = {}) => ({ id, doc_no: `IT06-26/${String(id).padStart(3, "0")}`, status, is_urgent: false, needed_date: "2026-11-30", created_at: `2026-11-19T0${id}:00:00Z`, ...extra });

test("IT groups: urgent work that is still waiting for approval can already be started", () => {
  assert.equal(model.itGroupOf(row(1, "approved")), "to_start");
  assert.equal(model.itGroupOf(row(1, "pending_dept")), "awaiting_approval");
  assert.equal(model.itGroupOf(row(1, "pending_it_mgr")), "awaiting_approval");
  assert.equal(model.itGroupOf(row(1, "pending_dept", { is_urgent: true })), "to_start");
  assert.equal(model.itGroupOf(row(1, "pending_it_mgr", { is_urgent: true })), "to_start");
  assert.equal(model.itGroupOf(row(1, "in_progress")), "in_progress");
  assert.equal(model.itGroupOf(row(1, "it_closed")), "awaiting_receive");
  assert.equal(model.itGroupOf(row(1, "need_info")), "awaiting_info", "waiting for the requester's answer is its own group");
  assert.equal(model.itGroupOf(row(1, "need_info", { is_urgent: true })), "awaiting_info", "urgent does not make it work to start");
  assert.equal(model.IT_GROUPS.find((group) => group.key === "awaiting_info").label, "รอผู้แจ้งตอบ");
  for (const status of ["received", "rejected", "cancelled"]) assert.equal(model.itGroupOf(row(1, status)), "closed", status);
});

test("inside a group, urgent work comes first, then the earliest needed date, then the earliest request", () => {
  const groups = model.groupItOrders([
    row(1, "approved", { needed_date: "2026-11-25" }),
    row(2, "approved", { needed_date: "2026-11-21" }),
    row(3, "approved", { needed_date: "2026-12-30", is_urgent: true }),
    row(4, "approved", { needed_date: "2026-11-21" }),
    row(5, "pending_dept", { is_urgent: true, needed_date: "2026-11-28" }),
  ]);
  assert.deepEqual(groups.to_start.map((item) => item.id), [5, 3, 2, 4, 1], "urgent first (by needed date: 5 is Nov 28, 3 is Dec 30), then normal work by needed date and request time (2 before 4)");
});

test("finished work is listed newest first and every group exists even when empty", () => {
  const groups = model.groupItOrders([row(1, "received"), row(2, "cancelled"), row(3, "rejected")]);
  assert.deepEqual(groups.closed.map((item) => item.id), [3, 2, 1]);
  assert.deepEqual(Object.keys(groups), model.IT_GROUPS.map((group) => group.key));
  assert.deepEqual(model.IT_GROUPS.map((group) => group.key), ["to_start", "in_progress", "awaiting_info", "awaiting_receive", "awaiting_approval", "closed"]);
  assert.deepEqual(groups.to_start, []);
  assert.deepEqual(Object.values(model.groupItOrders(undefined)).flat(), []);
});

test("the IT count is work to do (to start + in progress), and the requester count is work waiting for them to confirm", () => {
  const rows = [row(1, "approved"), row(2, "in_progress"), row(3, "pending_dept"), row(4, "pending_it_mgr", { is_urgent: true }), row(5, "it_closed"), row(6, "received")];
  assert.equal(model.itActionableCount(rows), 3);
  assert.equal(model.awaitingMyReceiveCount(rows), 1);
  assert.equal(model.itActionableCount(undefined), 0);
  assert.equal(model.awaitingMyReceiveCount(null), 0);
  assert.equal(model.itActionableCount([...rows, row(7, "need_info"), row(8, "need_info", { is_urgent: true })]), 3, "orders waiting for the requester are not IT's work to do");
  assert.deepEqual(plain(model.itApprovalProgress({ has_dept_approved: true, has_it_mgr_approved: false })), [{ label: "ผู้จัดการแผนก", done: true }, { label: "ผู้อนุมัติขั้น IT", done: false }]);
  assert.deepEqual(model.itApprovalProgress(undefined).map((step) => step.done), [false, false]);
});

test("the requester's count is confirm (IT sent the work) plus answer (someone asked), the approvals count leaves out orders waiting for the requester", () => {
  const rows = [row(1, "it_closed"), row(2, "it_closed"), row(3, "need_info"), row(4, "pending_dept"), row(5, "received")];
  assert.deepEqual(plain(model.mineWaiting(rows)), { confirm: 2, answer: 1, total: 3 });
  assert.equal(model.awaitingMyAnswerCount(rows), 1);
  assert.deepEqual(plain(model.mineWaiting(null)), { confirm: 0, answer: 0, total: 0 });
  assert.equal(model.mineWaitingNote({ confirm: 2, answer: 0 }), " ที่รอคุณยืนยัน");
  assert.equal(model.mineWaitingNote({ confirm: 0, answer: 1 }), " ที่รอคุณตอบ");
  assert.equal(model.mineWaitingNote({ confirm: 2, answer: 1 }), " (รอคุณยืนยัน 2 · รอคุณตอบ 1)");
  assert.equal(model.mineWaitingNote(undefined), " ที่รอคุณยืนยัน", "no breakdown: the old wording");
  const approvals = [row(1, "pending_dept"), row(2, "pending_it_mgr"), row(3, "need_info"), row(4, "need_info"), row(5, "in_progress")];
  assert.equal(model.waitingForMeCount(approvals), 3, "need_info rows are listed but are not 'waiting for me'");
  assert.equal(model.waitingForMeCount(undefined), 0);
});

/* ---------- ตัวเลขบนการ์ด ---------- */
test("the card badge counts orders waiting for my answer next to the ones waiting for my confirmation", () => {
  const summary = model.cardSummary({ approvals: 1, toConfirm: 2, toAnswer: 3 });
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.parts.map((part) => [part.key, part.label, part.count]), [["approvals", "รออนุมัติ", 1], ["confirm", "รอคุณยืนยันรับงาน", 2], ["answer", "รอคุณตอบ", 3]]);
  assert.equal(summary.title, "รออนุมัติ 1 · รอคุณยืนยันรับงาน 2 · รอคุณตอบ 3");
  assert.equal(model.cardSummary({ toAnswer: 0 }).badge, "");
});

test("the card badge adds up what is waiting for me and skips counts that could not be read", () => {
  assert.deepEqual(plain(model.cardSummary({ approvals: 2, itWork: 1, toConfirm: 1 })), {
    total: 4, parts: [{ key: "approvals", label: "รออนุมัติ", count: 2 }, { key: "it", label: "งาน IT ค้าง", count: 1 }, { key: "confirm", label: "รอคุณยืนยันรับงาน", count: 1 }],
    badge: "4 รอคุณ", title: "รออนุมัติ 2 · งาน IT ค้าง 1 · รอคุณยืนยันรับงาน 1",
  });
  const unreadable = model.cardSummary({ approvals: null, itWork: 3, toConfirm: null });
  assert.equal(unreadable.badge, "3 รอคุณ");
  assert.equal(unreadable.parts.length, 1);
  const none = model.cardSummary();
  assert.deepEqual(plain(none), { total: 0, parts: [], badge: "", title: "" }, "no badge at all when nothing waits or nothing could be read");
  assert.equal(model.cardSummary({ approvals: 0, itWork: 0, toConfirm: 0 }).badge, "");
});

/* ---------- ถาม-ตอบ ---------- */
const COMMENTS = [
  { id: 12, kind: "answer", stage: "it", body: "ตอบแล้ว", reply_to: 7, created_at: "2026-11-19T04:00:00Z", author_employee_no: "MK1", author_full_name: "สมชาย ใจดี", attachments: [] },
  { id: 7, kind: "question", stage: "it", body: "ขอไฟล์ต้นฉบับ", reply_to: null, created_at: "2026-11-19T03:00:00Z", author_employee_no: "IT1", author_full_name: "ไอที หนึ่ง", attachments: [{ id: "c1", file_name: "ถาม.pdf" }] },
];

test("stage labels name who asked, and unknown stages are shown as they are", () => {
  assert.deepEqual(plain(model.INFO_STAGE_LABELS), { dept: "ผู้จัดการแผนก", it_mgr: "ผู้อนุมัติขั้น IT", it: "ทีม IT" });
  assert.equal(model.infoStageLabel("it"), "ทีม IT");
  assert.equal(model.infoStageLabel("future"), "future");
  assert.equal(model.infoStageLabel(null), "");
  assert.equal(model.commentKindLabel("question"), "ถาม");
  assert.equal(model.commentKindLabel("answer"), "ตอบ");
});

test("comments are listed in the order they were written (by id) with Thai kind and stage labels and their own files", () => {
  const rows = model.commentRows({ comments: COMMENTS });
  assert.deepEqual(rows.map((row) => [row.no, row.id, row.kindLabel, row.stageLabel, row.by]), [[1, 7, "ถาม", "ทีม IT", "ไอที หนึ่ง"], [2, 12, "ตอบ", "ทีม IT", "สมชาย ใจดี"]]);
  assert.deepEqual(rows[0].files.map((file) => file.id), ["c1"]);
  assert.deepEqual(rows[1].files, []);
  assert.deepEqual(model.commentRows({}), []);
  assert.deepEqual(model.commentRows(undefined), []);
  // ไฟล์ของข้อความเข้า gallery รวมกับไฟล์ของใบ
  assert.deepEqual(model.allFiles({ attachments: [{ id: "f1" }], comments: COMMENTS }).map((file) => file.id), ["f1", "c1"]);
  assert.deepEqual(model.allFiles({}), []);
});

test("the pending question carries its asker, stage, files and where the order returns to", () => {
  const detail = { status: "need_info", info_return_status: "in_progress", comments: COMMENTS.slice(1), info_pending: { comment_id: 7, stage: "it", body: "ขอไฟล์ต้นฉบับ", asked_at: "2026-11-19T03:00:00Z", asked_by_employee_no: "IT1", asked_by_full_name: "ไอที หนึ่ง" } };
  const pending = model.pendingQuestion(detail);
  assert.equal(pending.stageLabel, "ทีม IT");
  assert.equal(pending.askedBy, "ไอที หนึ่ง");
  assert.equal(pending.returnLabel, "กำลังดำเนินการ");
  assert.deepEqual(pending.files.map((file) => file.id), ["c1"]);
  assert.equal(model.pendingQuestion({ ...detail, info_pending: null }), null);
  assert.equal(model.pendingQuestion(undefined), null);
});

test("the 'รอผู้แจ้งตอบ' badge explains who asked and where the order goes back to (only for need_info)", () => {
  const row = { status: "need_info", info_stage: "dept", info_return_status: "pending_dept" };
  assert.equal(model.infoBadgeTitle(row), "ถามโดย ผู้จัดการแผนก · ตอบแล้วใบกลับไปที่ รอผู้จัดการแผนก");
  assert.equal(model.infoBadgeTitle(row, true), "ผู้จัดการแผนก ถามคุณ · ตอบแล้วใบกลับไปที่ รอผู้จัดการแผนก");
  assert.equal(model.infoBadgeTitle({ status: "approved" }), "");
  assert.equal(model.infoBadgeTitle({ status: "need_info" }), "");
});

test("the ask / answer message is required, at most 2000 characters counted as characters, and trimmed before it is sent", () => {
  for (const kind of ["ask", "answer"]) {
    const rules = model.infoRules(kind);
    assert.deepEqual(validate(rules, { body: "ใช่" }), []);
    assert.deepEqual(validate(rules, { body: "   " }).map((error) => error.name), ["body"]);
    assert.deepEqual(validate(rules, { body: "ก".repeat(2000) }), []);
    assert.match(validate(rules, { body: "ก".repeat(2001) })[0].message, /ไม่เกิน 2,000 ตัวอักษร/);
    assert.deepEqual(validate(rules, { body: "😀".repeat(2000) }), [], "an emoji is one character");
  }
  assert.equal(validate(model.infoRules("ask"), { body: "" })[0].message, "กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง");
  assert.equal(validate(model.infoRules("answer"), { body: "" })[0].message, "กรุณาพิมพ์คำตอบ");
  assert.deepEqual(plain(model.infoParams("w1", { body: "  ข้อความ \n" })), { p_work_order_id: "w1", p_body: "ข้อความ" });
  assert.equal(model.MAX_INFO_BODY, 2000);
});

test("a comment file that Storage turns away gets the comment-specific wording, not the approval one", () => {
  const forbidden = { statusCode: "403", message: "new row violates row-level security policy" };
  assert.match(model.describeUploadError(forbidden).message, /มีผู้อนุมัติใบนี้แล้ว/);
  const comment = model.describeUploadError(forbidden, { comment: true });
  assert.match(comment.message, /30 นาทีหลังส่งข้อความ/);
  assert.doesNotMatch(comment.message, /ผู้อนุมัติ/);
});

/* ---------- สิทธิ์ในระบบของใบเก่า (อ่านอย่างเดียว) ---------- */
test("the IT access section is gone: no editor helpers; an old order's rows are only listed for display and print, without empty rows", () => {
  for (const removed of ["blankAccessDraft", "draftsFromAccessChanges", "isBlankAccessDraft", "validateAccessChanges", "hasAccessErrors", "accessPayload", "canEditAccess", "MAX_ACCESS_ROWS"]) {
    assert.equal(model[removed], undefined, `${removed} was removed with the section`);
  }
  assert.deepEqual(model.legacyAccessChanges({ access_changes: [{ id: "a1" }] }).map((row) => row.id), ["a1"]);
  assert.deepEqual(model.legacyAccessChanges({}), [], "no data = no section");
  assert.deepEqual(model.legacyAccessChanges(undefined), []);
  const rows = model.accessPrintRows([{ id: "a1", system: "express", action: "add", new_username: "u", old_username: null, note: null }, { id: "a2", system: "express", action: "cancel", new_username: null, old_username: "o", note: "n" }]);
  assert.deepEqual(rows.map((entry) => entry.systemLabel), ["Express System", "Express System"], "only systems that have rows");
  assert.deepEqual(rows.map((entry) => entry.showSystemLabel), [true, false]);
  assert.deepEqual(model.accessPrintRows(undefined), [], "nothing recorded = nothing to print");
});

/* ---------- ไฟล์แนบ ---------- */
const file = (name, size = 1000, type = "") => ({ name, size, type });

test("the accepted file types are exactly the ones the database accepts, decided by the extension (the browser's type is often empty)", () => {
  assert.deepEqual(Object.keys(model.FILE_MIME_BY_EXTENSION).sort(), ["csv", "doc", "docx", "heic", "heif", "jpeg", "jpg", "pdf", "png", "pptx", "txt", "webp", "xls", "xlsx"]);
  assert.equal(model.fileMime(file("แบบ.PDF", 1, "")), "application/pdf", "case-insensitive, even when the browser sends no type");
  assert.equal(model.fileMime(file("ราคา.xlsx", 1, "application/octet-stream")), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(model.fileMime(file("a.csv")), "text/csv");
  assert.equal(model.fileMime(file("virus.exe")), null);
  assert.equal(model.fileMime(file("noextension")), null);
  assert.equal(model.fileExtension("a.b.JPG"), "jpg");
  assert.match(model.FILE_ACCEPT, /image\/\*/);
  assert.match(model.FILE_ACCEPT, /\.docx/);
  assert.match(model.FILE_HINT, /10 ไฟล์/);
});

test("a file's storage path is <order id>/<uuid>.<ext> in lower case, the shape the database insists on", () => {
  const orderId = "AAAAAAAA-0000-4000-8000-000000000001";
  const path = model.filePath(orderId, "BBBBBBBB-0000-4000-8000-000000000002", file("Photo.JPEG"));
  assert.equal(path, "aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000002.jpeg");
  assert.match(path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|pdf|docx|xlsx|pptx|doc|xls|txt|csv)$/);
  assert.equal(model.fileBucket(false), "itwo-files");
  assert.equal(model.fileBucket(true), "itwo-test-files");
});

test("a file set is checked before sending: at most 10 files, each a known type, not empty, at most 20 MB; the message names the file", () => {
  assert.equal(model.validateFiles([]), null);
  assert.equal(model.validateFiles(Array.from({ length: 10 }, (_, index) => file(`${index}.pdf`))), null);
  assert.match(model.validateFiles(Array.from({ length: 11 }, (_, index) => file(`${index}.pdf`))), /ไม่เกิน 10 ไฟล์/);
  assert.match(model.validateFiles([file("ok.pdf"), file("x.exe")]), /^x\.exe: ชนิดไฟล์นี้ไม่รองรับ/);
  assert.match(model.validateFiles([file("empty.pdf", 0)]), /^empty\.pdf: ไฟล์ว่างเปล่า/);
  assert.equal(model.validateFiles([file("exactly.pdf", 20 * 1024 * 1024)]), null);
  assert.match(model.validateFiles([file("big.pdf", 20 * 1024 * 1024 + 1)]), /^big\.pdf: ไฟล์ต้องมีขนาดไม่เกิน 20 MB/);
  assert.equal(model.formatFileSize(0), "—");
  assert.equal(model.formatFileSize(512), "512 B");
  assert.equal(model.formatFileSize(1536), "1.5 KB");
  assert.equal(model.formatFileSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(model.formatFileSize(150 * 1024), "150 KB");
});

test("the upload runner uploads then registers each file in order, reports progress, and a failed file does not stop the others", async () => {
  const orderId = "00000000-0000-4000-8000-000000000001";
  let counter = 0;
  const entries = model.makeUploadEntries(orderId, [file("a.pdf"), file("b.png"), file("c.txt")], () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "1")}`);
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map((entry) => entry.path)).size, 3, "each file has its own path");
  const log = [];
  const failFor = new Set(["b.png"]);
  const failed = await model.runUploads(entries, {
    upload: async (entry) => { log.push(`upload ${entry.file.name}`); if (failFor.has(entry.file.name)) throw new Error("boom"); },
    register: async (entry) => { log.push(`register ${entry.file.name}`); },
    onStart: (entry) => log.push(`start ${entry.file.name}`),
    onProgress: (done, total) => log.push(`progress ${done}/${total}`),
  });
  assert.deepEqual(log, ["progress 0/3", "start a.pdf", "upload a.pdf", "register a.pdf", "progress 1/3", "start b.png", "upload b.png", "progress 2/3", "start c.txt", "upload c.txt", "register c.txt", "progress 3/3"]);
  assert.deepEqual(failed.map((entry) => entry.file.name), ["b.png"]);
  assert.equal(failed[0].error.message, "boom");
  assert.deepEqual(entries.map((entry) => [entry.uploaded, entry.registered]), [[true, true], [false, false], [true, true]]);
});

test("retrying only does what is left: a file already on Storage is only registered, a registered one is skipped, same path every time", async () => {
  let counter = 0;
  const entries = model.makeUploadEntries("00000000-0000-4000-8000-000000000001", [file("a.pdf"), file("b.pdf"), file("c.pdf")], () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "2")}`);
  const paths = entries.map((entry) => entry.path);
  const calls = [];
  let registerFails = true;
  let uploadFails = true;
  const run = () => model.runUploads(entries, {
    upload: async (entry) => { calls.push(`upload ${entry.file.name}`); if (entry.file.name === "c.pdf" && uploadFails) throw new Error("Failed to fetch"); },
    register: async (entry) => { calls.push(`register ${entry.file.name}`); if (entry.file.name === "b.pdf" && registerFails) throw new Error("rpc failed"); },
  });
  const first = await run();
  assert.deepEqual(first.map((entry) => entry.file.name), ["b.pdf", "c.pdf"]);
  assert.deepEqual(entries.map((entry) => [entry.uploaded, entry.registered]), [[true, true], [true, false], [false, false]], "b is on Storage but not registered; c never reached Storage");
  calls.length = 0;
  registerFails = false;
  uploadFails = false;
  const second = await run();
  assert.deepEqual(second, []);
  assert.deepEqual(calls, ["register b.pdf", "upload c.pdf", "register c.pdf"], "a is skipped, b is not uploaded again, c is uploaded now");
  assert.deepEqual(entries.map((entry) => entry.path), paths, "the retry reuses the same paths: no orphan files");
  assert.ok(entries.every((entry) => entry.error === null));
});

test("'already exists' from Storage (an earlier attempt whose reply was lost) counts as uploaded and the file is registered", async () => {
  const entries = model.makeUploadEntries("00000000-0000-4000-8000-000000000001", [file("a.pdf")], () => "00000000-0000-4000-8000-000000000009");
  const calls = [];
  const failed = await model.runUploads(entries, {
    upload: async () => { throw Object.assign(new Error("The resource already exists"), { statusCode: "409" }); },
    register: async () => { calls.push("register"); },
  });
  assert.deepEqual(failed, []);
  assert.deepEqual(calls, ["register"]);
  assert.equal(model.isAlreadyUploaded({ message: "Duplicate" }), true);
  assert.equal(model.isAlreadyUploaded({ message: "Failed to fetch" }), false);
});

test("an upload error is explained in Thai, and a lost connection says it is safe to try again", () => {
  assert.match(model.describeUploadError({ statusCode: "403", message: "new row violates row-level security policy" }).message, /หมดเวลาแนบไฟล์|มีผู้อนุมัติ/);
  assert.match(model.describeUploadError({ statusCode: "413", message: "The object exceeded the maximum allowed size" }).message, /20 MB/);
  assert.match(model.describeUploadError({ statusCode: "415", message: "mime type text/html is not supported" }).message, /ชนิดไฟล์นี้ไม่รองรับ/);
  const lost = model.describeUploadError(Object.assign(new Error("Failed to fetch"), { code: "" }));
  assert.equal(lost.kind, "unknown");
  assert.match(lost.message, /ลองอีกครั้ง/);
  assert.doesNotMatch(lost.message, /ตรวจรายการก่อนกดซ้ำ/, "files can be retried safely: no need to check first");
  assert.equal(model.describeUploadError({ code: "23514", message: "หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งงาน)" }).message, "หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งงาน)", "a Thai database message is shown as it is");
  assert.doesNotMatch(model.describeUploadError({ statusCode: "500", message: "Internal Server Error", code: "X" }).message, /Internal/);
});

test("files are grouped by round: 'ตอนแจ้ง' first, then 'แก้ไขครั้งที่ N'; empty rounds are not listed; the gallery gets the field names app.js expects", () => {
  const detail = { attachments: [
    { id: "f3", rework_id: "r2", round_no: 2, file_name: "c.pdf", mime_type: "application/pdf", size_bytes: 3, storage_path: "o/3.pdf" },
    { id: "f1", rework_id: null, round_no: 0, file_name: "a.png", mime_type: "image/png", size_bytes: 1, storage_path: "o/1.png" },
    { id: "f2", rework_id: "r1", round_no: 1, file_name: "b.pdf", mime_type: "application/pdf", size_bytes: 2, storage_path: "o/2.pdf" },
    { id: "f4", rework_id: null, round_no: 0, file_name: "d.txt", mime_type: "text/plain", size_bytes: 4, storage_path: "o/4.txt" },
  ] };
  const groups = model.attachmentGroups(detail);
  assert.deepEqual(groups.map((group) => [group.label, group.files.map((item) => item.id)]), [["ตอนแจ้ง", ["f1", "f4"]], ["แก้ไขครั้งที่ 1", ["f2"]], ["แก้ไขครั้งที่ 2", ["f3"]]]);
  assert.deepEqual(model.attachmentGroups({}), []);
  assert.deepEqual(plain(model.galleryFile(detail.attachments[1])), { id: "f1", file_name: "a.png", content_type: "image/png", size_bytes: 1, storage_path: "o/1.png" });
  assert.equal(model.roundLabel(0), "ตอนแจ้ง");
  assert.equal(model.roundLabel(3), "แก้ไขครั้งที่ 3");
});

/* ---------- แก้ไขงาน ---------- */
test("the rework tag says which round and the due date (Thai date), and is empty when the order was never sent back", () => {
  assert.equal(model.reworkTag(2, "2026-12-05"), "แก้ไขครั้งที่ 2 · กำหนด 05/12/2569");
  assert.equal(model.reworkTag(1, null), "แก้ไขครั้งที่ 1");
  assert.equal(model.reworkTag(0, "2026-12-05"), "");
  assert.equal(model.reworkTag(undefined, undefined), "");
});

test("rework rounds carry their own details, due date, requester and files, in round order", () => {
  const detail = {
    reworks: [
      { id: "r2", round_no: 2, details: "แก้อีก", due_date: "2026-12-10", created_at: "2026-12-03T03:00:00Z", requested_by_full_name: "สมชาย ใจดี" },
      { id: "r1", round_no: 1, details: "แก้สี", due_date: "2026-12-01", created_at: "2026-11-25T03:00:00Z", requested_by_full_name: "สมชาย ใจดี" },
    ],
    attachments: [{ id: "f1", rework_id: "r1" }, { id: "f2", rework_id: null }, { id: "f3", rework_id: "r1" }],
  };
  const rounds = model.reworkRounds(detail);
  assert.deepEqual(rounds.map((round) => [round.roundNo, round.label, round.dueDate, round.files.map((item) => item.id)]), [[1, "แก้ไขครั้งที่ 1", "2026-12-01", ["f1", "f3"]], [2, "แก้ไขครั้งที่ 2", "2026-12-10", []]]);
  assert.deepEqual(model.reworkRounds({}), []);
});

test("the rework form needs details (up to 2000) and a due date that is today or later by Thai time", () => {
  const rulesFor = (today) => model.reworkRules({ today: () => today });
  assert.deepEqual(validate(rulesFor(TODAY), { details: "แก้สีให้เข้มขึ้น", due_date: TODAY }), []);
  assert.deepEqual(validate(rulesFor(TODAY), { details: " ", due_date: "" }).map((error) => [error.name, error.message]), [
    ["details", "กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข"], ["due_date", "กรุณาเลือกวันที่ต้องการให้แก้ไขเสร็จ"],
  ]);
  assert.deepEqual(validate(rulesFor(TODAY), { details: "x", due_date: "2026-11-18" }).map((error) => error.message), ["วันที่ต้องการให้แก้ไขเสร็จต้องเป็นวันนี้หรือหลังจากนี้"]);
  assert.deepEqual(validate(rulesFor(TODAY), { details: "ก".repeat(2001), due_date: TODAY }).map((error) => error.name), ["details"]);
  assert.deepEqual(validate(rulesFor(TODAY), { details: "ก".repeat(2000), due_date: TODAY }), []);
  assert.deepEqual(validate(rulesFor("2026-12-25"), { details: "x", due_date: "2026-12-01" }).map((error) => error.name), ["due_date"], "today is read again at every check");
  assert.deepEqual(plain(model.reworkParams("wo-1", { details: "  แก้สี \n", due_date: " 2026-12-01 " })), { p_work_order_id: "wo-1", p_details: "แก้สี", p_due_date: "2026-12-01" });
});

test("the message after IT closes an order says it went back to the requester; in test mode it says to switch account", () => {
  const detail = { requester: { full_name: "สมชาย ใจดี" } };
  assert.equal(model.completeToast(detail, false), "ส่งกลับให้ สมชาย ใจดี ตรวจและยืนยันแล้ว");
  assert.equal(model.completeToast(detail, true), "ส่งกลับให้ สมชาย ใจดี ตรวจและยืนยันแล้ว · สลับเป็นบัญชีผู้แจ้งเพื่อยืนยันหรือขอแก้ไข");
  assert.equal(model.completeToast({}, false), "ส่งกลับให้ ผู้แจ้ง ตรวจและยืนยันแล้ว");
});

test("an order that was sent back is ranked by the round's due date in the IT list (same as the database)", () => {
  const rows = [
    { id: "a", status: "in_progress", is_urgent: false, needed_date: "2026-11-20", created_at: "2026-11-01T00:00:00Z", doc_no: "A", rework_round: 1, rework_due_date: "2026-12-30" },
    { id: "b", status: "in_progress", is_urgent: false, needed_date: "2026-12-01", created_at: "2026-11-02T00:00:00Z", doc_no: "B", rework_round: 0, rework_due_date: null },
  ];
  assert.deepEqual(model.groupItOrders(rows).in_progress.map((row) => row.id), ["b", "a"], "a is due 30 Dec after the rework even though it was first needed 20 Nov");
});

test("the test purge result: complete only when every listed file was removed; otherwise it says to press again", () => {
  assert.deepEqual(plain(model.purgeSummary({ deleted: 12, total: 0, removed: 0 })), { complete: true, message: "ล้างข้อมูลทดสอบแล้ว 12 แถว" });
  assert.deepEqual(plain(model.purgeSummary({ deleted: 12, total: 5, removed: 5 })), { complete: true, message: "ล้างข้อมูลทดสอบแล้ว 12 แถว · ลบไฟล์ 5 ไฟล์" });
  const partial = model.purgeSummary({ deleted: 12, total: 5, removed: 3 });
  assert.equal(partial.complete, false);
  assert.match(partial.message, /ลบไฟล์ได้ 3 จาก 5 ไฟล์ ยังเหลือ 2 ไฟล์ กดล้างข้อมูลอีกครั้ง/);
});

/* ---------- ตั้งค่า (it_admin) ---------- */
test("the next document number can only move forward, and your own staff row is locked", () => {
  assert.equal(model.validateNextSeq("101", 1), null);
  assert.match(model.validateNextSeq("abc", 1), /จำนวนเต็ม/);
  assert.match(model.validateNextSeq("", 1), /จำนวนเต็ม/);
  assert.match(model.validateNextSeq("0", 0), /1 ถึง 9999/);
  assert.match(model.validateNextSeq("10000", 1), /1 ถึง 9999/);
  assert.match(model.validateNextSeq("5", 5), /มากกว่าเลขถัดไปปัจจุบัน \(5\)/);
  assert.match(model.validateNextSeq("3", 5), /ถอยหลังหรือซ้ำไม่ได้/);
  assert.match(model.staffEditBlock({ row: { employee_id: "me" }, myEmployeeId: "me", isTest: false }), /แก้สิทธิ์ของตัวเองไม่ได้/);
  assert.equal(model.staffEditBlock({ row: { employee_id: "other" }, myEmployeeId: "me", isTest: false }), "");
  assert.match(model.staffEditBlock({ row: { employee_id: "other" }, myEmployeeId: "me", isTest: true }), /โหมดทดสอบ/);
  assert.match(model.validateStaffForm({ employeeNo: "", isAdmin: true, isApprover: false }), /รหัสพนักงาน/);
  assert.match(model.validateStaffForm({ employeeNo: "IT1", isAdmin: false, isApprover: false }), /อย่างน้อย 1/);
  assert.equal(model.validateStaffForm({ employeeNo: "IT1", isAdmin: false, isApprover: true }), null);
  assert.equal(model.staffRoleText({ is_it_admin: true, is_it_approver: true }), "ผู้ดูแลงาน IT · ผู้อนุมัติขั้น IT");
});

/* ---------- error จาก RPC ---------- */
test("a Thai database message is shown as it is", () => {
  const info = model.describeError({ code: "42501", message: "ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้" }, { write: true });
  assert.deepEqual(plain(info), { kind: "rejected", message: "ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้", forwarded: true });
  assert.equal(model.describeError({ code: "23514", message: "กรุณาระบุเหตุผลที่ยกเลิก" }).forwarded, true);
});

test("an expired session, a lost connection and a missing function each get their own Thai message", () => {
  const session = model.describeError({ code: "PGRST301", message: "JWT expired" }, { write: true });
  assert.equal(session.kind, "session");
  assert.match(session.message, /หมดเวลาการเข้าสู่ระบบ/);
  assert.equal(model.describeError({ status: 401, message: "x" }).kind, "session");
  assert.equal(model.describeError({ code: "", message: "JWT expired" }).kind, "session");

  for (const message of ["Failed to fetch", "TypeError: NetworkError when attempting to fetch resource.", "Load failed", "The Internet connection appears to be offline."]) {
    const write = model.describeError({ code: "", message }, { write: true });
    assert.equal(write.kind, "unknown", message);
    assert.equal(write.message, "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ (ระบบอาจบันทึกไปแล้ว)");
    assert.equal(model.describeError({ code: "", message }).message, "โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่", "a read is not 'maybe saved'");
  }
  assert.equal(model.describeError({ message: "Failed to fetch" }, { write: true }).kind, "unknown", "no code at all");

  const missing = model.describeError({ code: "PGRST202", message: "Could not find the function" });
  assert.equal(missing.kind, "missing");
  assert.match(missing.message, /ฐานข้อมูลยังไม่ได้อัปเดต/);
});

test("English technical messages are never shown to the user", () => {
  for (const error of [{ code: "XX000", message: "duplicate key value violates unique constraint \"itwo_x\"" }, { code: "42501", message: "permission denied for table itwo_events" }, { code: "23505", message: "boom" }]) {
    const info = model.describeError(error, { write: true });
    assert.equal(info.kind, "rejected");
    assert.equal(info.forwarded, undefined, "an unforwarded message is reported to the error log by the caller");
    assert.doesNotMatch(info.message, /[A-Za-z]{4,}/, JSON.stringify(error));
  }
  // ข้อความไทยที่โค้ดของเราโยนเอง (ไม่มี code) แสดงตามนั้น แต่ข้อความไทยที่ปนข้อความเน็ตหลุดนับเป็นเน็ตหลุด
  assert.equal(model.describeError(new Error("ไม่ได้รับเลขที่เอกสารจากระบบ")).forwarded, true);
  assert.equal(model.describeError({ code: "", message: "ล้มเหลว: Failed to fetch" }, { write: true }).kind, "unknown");
});

/* ---------- หมายเหตุใต้ลายเซ็นอนุมัติ / ตัวเลือกพนักงานในหน้าตั้งค่า ---------- */
test("one person approving both steps shows the same name in both signature slots with a remark", () => {
  const events = [
    { action: "created", actor_employee_no: "IT0001", actor_full_name: "ผู้แจ้ง IT", created_at: "2026-11-19T01:00:00Z" },
    { action: "dept_approved", reason: "ผู้แจ้งอยู่แผนก IT", actor_employee_no: "FANG", actor_full_name: "รสริน เชน", created_at: "2026-11-19T02:00:00Z" },
    { action: "it_mgr_approved", reason: null, actor_employee_no: "FANG", actor_full_name: "รสริน เชน", created_at: "2026-11-19T02:00:00Z" },
  ];
  const slots = model.signatureSlots(events);
  assert.equal(slots[1].name, "รสริน เชน");
  assert.equal(slots[2].name, "รสริน เชน");
  assert.match(slots[1].remark, /ครั้งเดียว นับเป็นทั้งสองขั้น/);
  assert.equal(slots[1].remark, slots[2].remark);
  assert.equal(slots[0].remark, null, "the requester slot never carries an approval remark");
});

test("a department manager who files the order approves their own step, and the slot says so", () => {
  const events = [
    { action: "created", actor_employee_no: "RB1", actor_full_name: "หัวหน้า", created_at: "2026-11-19T01:00:00Z" },
    { action: "dept_approved", actor_employee_no: "RB1", actor_full_name: "หัวหน้า", created_at: "2026-11-19T01:00:00Z" },
  ];
  const slots = model.signatureSlots(events);
  assert.match(slots[1].remark, /อนุมัติในตัว/);
  assert.equal(slots[2].name, null);
  assert.equal(slots[2].remark, null, "an empty slot has no remark");
  // อนุมัติแยกคนตามปกติ ไม่มีหมายเหตุ
  assert.equal(model.signatureSlots(EVENTS)[1].remark, null);
  assert.equal(model.signatureSlots(EVENTS)[2].remark, null);
});

test("staff picker options are 'code name · department', sorted by code, without inactive or code-less people", () => {
  const options = model.staffCandidateOptions([
    { employee_no: "RB2", first_name: "สมชาย", last_name: "ใจดี", department: { name_th: "ฝ่ายผลิต RB" }, is_active: true },
    { employee_no: "FANG", first_name: "รสริน", last_name: "เชน", department: null },
    { employee_no: "OLD1", first_name: "ลาออก", last_name: "แล้ว", is_active: false },
    { first_name: "ไม่มี", last_name: "รหัส" },
  ]);
  assert.deepEqual(plain(options), [
    { value: "FANG", label: "FANG รสริน เชน" },
    { value: "RB2", label: "RB2 สมชาย ใจดี · ฝ่ายผลิต RB" },
  ]);
  assert.deepEqual(model.staffCandidateOptions(undefined), []);
});

test("you cannot give yourself staff rights from the form, whatever the letter case", () => {
  assert.match(model.validateStaffForm({ employeeNo: "it3462", isAdmin: true, isApprover: false, myEmployeeNo: "IT3462" }), /แก้สิทธิ์ของตัวเองไม่ได้/);
  assert.equal(model.validateStaffForm({ employeeNo: "FANG", isAdmin: true, isApprover: false, myEmployeeNo: "IT3462" }), null);
});

/* ---------- ข้อความกล่องยืนยันอนุมัติ ---------- */
test("approving as the IT-step approver while the department step is still open says it counts as both steps; everything else keeps the standard message", () => {
  const itApprover = { is_it_approver: true };
  const open = { approvals: { dept: null, it_mgr: null } };
  const standard = model.ACTION_BUTTONS.approve.confirmMessage;
  assert.equal(model.confirmMessageFor("approve", open, itApprover), `${model.BOTH_STEPS_NOTE} · ${standard}`);
  assert.match(model.BOTH_STEPS_NOTE, /ทั้งขั้นแผนกและขั้น IT/);
  // ขั้นแผนกผ่านแล้ว / ไม่ใช่ผู้อนุมัติขั้น IT / ข้อมูลไม่ครบ = ข้อความมาตรฐาน (ไม่บอกเกินจริง)
  assert.equal(model.confirmMessageFor("approve", { approvals: { dept: { by: "x" }, it_mgr: null } }, itApprover), standard);
  assert.equal(model.confirmMessageFor("approve", open, { is_dept_approver: true }), standard);
  assert.equal(model.confirmMessageFor("approve", {}, itApprover), standard);
  assert.equal(model.confirmMessageFor("approve", null, null), standard);
  // ปุ่มอื่นไม่ได้รับข้อความนี้
  assert.equal(model.confirmMessageFor("start", open, itApprover), model.ACTION_BUTTONS.start.confirmMessage);
  assert.equal(model.confirmMessageFor("unknown", open, itApprover), "");
});
