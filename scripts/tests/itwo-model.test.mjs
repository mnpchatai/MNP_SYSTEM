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
  assert.deepEqual(labels(["approve", "reject", "start", "complete", "receive", "cancel"]), ["approve", "reject", "start", "complete", "receive", "cancel"]);
});

test("an unknown action and edit_access never become buttons; edit_access only opens the IT section form", () => {
  assert.deepEqual(model.actionButtons(["edit_access", "delete", "__proto__", "constructor"]), []);
  assert.equal(model.canEditAccess(["start", "edit_access"]), true);
  assert.equal(model.canEditAccess(["start"]), false);
  assert.equal(model.canEditAccess(undefined), false);
});

test("every button has a Thai label, an RPC name and a confirm text; reject and cancel ask for a reason", () => {
  for (const action of model.ACTION_ORDER) {
    const spec = model.ACTION_BUTTONS[action];
    assert.match(spec.rpc, /^app_itwo_[a-z]+$/, action);
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
const GOOD = { request_type: "design", order_ref: "", attachment_flag: "no", attachment_note: "", details: "ออกแบบกล่อง", needed_date: "2026-11-25", is_urgent: false };
const errorsOf = (values, flag = values.attachment_flag, today = TODAY) => validate(model.orderRules({ today: () => today, attachmentFlag: () => flag }), values);

test("a complete form passes; the three FM06 request types and attachment options are in the form's order", () => {
  assert.deepEqual(errorsOf(GOOD), []);
  assert.deepEqual(plain(model.REQUEST_TYPES), [
    { value: "design", label: "งานออกแบบ" },
    { value: "system_access", label: "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" },
    { value: "misc", label: "เบ็ดเตล็ดอื่นๆ" },
  ]);
  assert.deepEqual(model.ATTACHMENT_FLAGS.map((flag) => flag.label), ["มี", "ไม่มี", "อื่นๆ"]);
  assert.equal(model.EMPTY_ORDER_FORM.attachment_flag, "no");
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
    p_request_type: "design", p_order_ref: "SO-1", p_attachment_flag: "yes", p_attachment_note: null,
    p_details: "ทำกล่อง", p_needed_date: "2026-11-25", p_is_urgent: true,
  });
  assert.equal(model.createParams({ ...GOOD, attachment_flag: "other", attachment_note: " แบบ " }).p_attachment_note, "แบบ");
  assert.equal(model.createParams(GOOD).p_order_ref, null, "an empty order is null");
  assert.equal(model.createParams({ ...GOOD, is_urgent: undefined }).p_is_urgent, false);
  const keys = Object.keys(params).join(" ");
  assert.doesNotMatch(keys, /doc_no|requester|department|created|status/, "document number, requester, department and time come from the database");
});

test("the duration note is the FM06 wording", () => {
  assert.equal(model.DURATION_NOTE, "งานออกแบบและงานสิทธิ์ 3–7 วันนับจากวันที่ได้ข้อมูลครบ งานเบ็ดเตล็ดตามตกลง");
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
  const statuses = ["pending_dept", "pending_it_mgr", "approved", "in_progress", "it_closed", "received", "rejected", "cancelled"];
  assert.deepEqual(Object.keys(model.STATUS_LABELS), statuses);
  for (const status of statuses) {
    assert.match(model.statusLabel(status), /[฀-๿]/, status);
    assert.ok(model.statusBadgeClass(status), status);
  }
  assert.equal(model.statusLabel("pending_dept"), "รอผู้จัดการแผนก");
  assert.equal(model.statusLabel("received"), "ได้รับงานแล้ว");
  assert.equal(model.statusLabel("unknown_status"), "unknown_status", "an unknown status is shown as-is, never hidden");
  assert.equal(model.statusLabel(null), "");
  assert.equal(model.myStatusLabel("it_closed"), "IT ปิดงานแล้ว รอคุณยืนยัน", "the requester sees whose turn it is");
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
  for (const action of ["created", "dept_approved", "dept_rejected", "it_mgr_approved", "it_mgr_rejected", "cancelled", "started", "completed", "received"]) {
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
  assert.deepEqual(groups.to_start, []);
  assert.deepEqual(Object.values(model.groupItOrders(undefined)).flat(), []);
});

test("the IT count is work to do (to start + in progress), and the requester count is work waiting for them to confirm", () => {
  const rows = [row(1, "approved"), row(2, "in_progress"), row(3, "pending_dept"), row(4, "pending_it_mgr", { is_urgent: true }), row(5, "it_closed"), row(6, "received")];
  assert.equal(model.itActionableCount(rows), 3);
  assert.equal(model.awaitingMyReceiveCount(rows), 1);
  assert.equal(model.itActionableCount(undefined), 0);
  assert.equal(model.awaitingMyReceiveCount(null), 0);
  assert.deepEqual(plain(model.itApprovalProgress({ has_dept_approved: true, has_it_mgr_approved: false })), [{ label: "ผู้จัดการแผนก", done: true }, { label: "ผู้อนุมัติขั้น IT", done: false }]);
  assert.deepEqual(model.itApprovalProgress(undefined).map((step) => step.done), [false, false]);
});

/* ---------- ตัวเลขบนการ์ด ---------- */
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

/* ---------- ส่วนสำหรับแผนก IT ---------- */
test("access rows: blank rows are dropped, a half-filled row says what is missing, blanks become null", () => {
  const blank = model.blankAccessDraft("k1");
  assert.equal(model.isBlankAccessDraft(blank), true);
  const filled = { ...blank, system: "i_prime", action: "add", newUsername: " user1 ", oldUsername: "", note: " " };
  assert.equal(model.isBlankAccessDraft(filled), false);
  assert.deepEqual(plain(model.accessPayload([blank, filled])), [{ system: "i_prime", action: "add", new_username: "user1", old_username: null, note: null }]);
  assert.deepEqual(plain(model.validateAccessChanges([blank])), { rows: {}, general: null });
  assert.equal(model.validateAccessChanges([{ ...blank, note: "x" }]).rows[0], "กรุณาเลือกระบบ");
  assert.equal(model.validateAccessChanges([{ ...blank, system: "email" }]).rows[0], "กรุณาเลือกการดำเนินการ (เพิ่ม / เปลี่ยน / ยกเลิก)");
  assert.equal(model.validateAccessChanges([filled, { ...blank, system: "other", action: "cancel", newUsername: "ก".repeat(101) }]).rows[1], "ชื่อผู้ใช้ต้องไม่เกิน 100 ตัวอักษร");
  assert.equal(model.validateAccessChanges([{ ...filled, note: "ก".repeat(501) }]).rows[0], "หมายเหตุต้องไม่เกิน 500 ตัวอักษร");
  const many = Array.from({ length: 21 }, (_, index) => ({ ...filled, key: `r${index}` }));
  assert.equal(model.validateAccessChanges(many).general, "บันทึกได้ไม่เกิน 20 รายการต่อใบ");
  assert.equal(model.hasAccessErrors(model.validateAccessChanges(many)), true);
  assert.equal(model.hasAccessErrors(model.validateAccessChanges([filled])), false);
});

test("access drafts from the database drop values that are not in the lists, and the print table has all four systems", () => {
  const drafts = model.draftsFromAccessChanges([{ id: "a1", system: "express", action: "change", new_username: "n", old_username: null, note: null }, { id: "a2", system: "bogus", action: "x" }]);
  assert.deepEqual(plain(drafts[0]), { key: "a1", system: "express", action: "change", newUsername: "n", oldUsername: "", note: "" });
  assert.equal(drafts[1].system, "");
  assert.equal(drafts[1].action, "");
  const rows = model.accessPrintRows([{ id: "a1", system: "express", action: "add", new_username: "u", old_username: null, note: null }, { id: "a2", system: "express", action: "cancel", new_username: null, old_username: "o", note: "n" }]);
  assert.deepEqual(rows.map((entry) => entry.systemLabel), ["I-Prime System", "Express System", "Express System", "E-Mail Address", "อื่นๆ ระบุ"]);
  assert.deepEqual(rows.map((entry) => entry.showSystemLabel), [true, true, false, true, true]);
  assert.deepEqual(model.accessPrintRows(undefined).map((entry) => entry.action), [null, null, null, null], "four empty rows");
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
