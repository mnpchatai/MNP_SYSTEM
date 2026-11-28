import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// modules/itar-model.js (ใบขอสิทธิ์ IT): สถานะ/ป้าย · สิทธิ์ → แท็บ · ปุ่มตาม allowed_actions · p_items จากสิ่งที่ผู้ใช้เลือก (ส่ง from ตามที่เห็น) · ผู้รับสิทธิ์ · ตาราง ก่อน→หลัง · ไฟล์ · ข้อผิดพลาด
const require = createRequire(import.meta.url);
const model = require("../../modules/itar-model.js");
const plain = (value) => JSON.parse(JSON.stringify(value));

const CATALOG = {
  folders: [
    { code: "ACC", name: "บัญชี", description: "เอกสารบัญชี" },
    { code: "HR", name: "บุคคล", description: null },
    { code: "PUR", name: "จัดซื้อ", description: null },
  ],
  programs: [{ code: "IPRIME", name: "iPrime" }, { code: "OTHER", name: "อื่นๆ" }],
};
const RIGHTS = {
  user_id: "u1", auth_id: "somchai.k", name_th: "สมชาย", status: "active", internet: false,
  folders: [{ code: "ACC", name: "บัญชี", level: "R", is_active: true }, { code: "OLD", name: "โฟลเดอร์เก่า", level: "F", is_active: false }],
  programs: [{ code: "IPRIME", name: "iPrime", note: null, is_active: true }],
  emails: [{ address: "somchai@mnp.test", kind: "internal" }],
};
const context = (overrides = {}) => model.normalizeContext({
  request_type: "change", linked: true, rights: RIGHTS, catalog: CATALOG,
  subject: { employee_id: "e1", name_th: "สมชาย ใจดี", department_name: "บัญชี", division: "office" },
  departments: [], policy: { version: "IT08-01/1", text: "x" }, ...overrides,
});

/* ---------- สถานะ / ป้าย ---------- */
test("every status has a Thai label and a badge class the stylesheet already colours", () => {
  for (const status of ["pending_dept", "pending_it_mgr", "approved", "in_progress", "awaiting_ack", "need_info", "done", "rejected", "cancelled"]) {
    assert.ok(model.statusLabel(status) && model.statusLabel(status) !== status, status);
    assert.ok(model.statusBadgeClass(status), status);
  }
  assert.equal(model.statusLabel("awaiting_ack"), "รอผู้ใช้รับทราบ");
  assert.equal(model.statusBadgeClass("done"), "completed");
  assert.equal(model.statusLabel("unknown_status"), "unknown_status", "unknown statuses show as they are");
});

test("my-list labels tell the user whose turn it is", () => {
  assert.equal(model.myStatusLabel("need_info", { is_requester: true }), "รอคุณตอบ");
  assert.equal(model.myStatusLabel("need_info", { is_requester: false }), "รอผู้ยื่นตอบ", "the subject is not the one who answers");
  assert.equal(model.myStatusLabel("awaiting_ack", { needs_my_ack: true }), "รอคุณรับทราบสิทธิ์");
  assert.equal(model.myStatusLabel("awaiting_ack", { needs_my_ack: false }), "รอผู้ใช้รับทราบ");
  assert.equal(model.myStatusLabel("done"), "จบแล้ว");
});

test("dates show as dd/mm/yyyy in the Buddhist year and Bangkok time", () => {
  assert.equal(model.formatDate("2026-11-28"), "28/11/2569");
  assert.equal(model.formatDateTime("2026-11-28T17:30:00Z"), "29/11/2569 00:30", "UTC evening is already the next day in Bangkok");
  assert.equal(model.formatDate(null), "—");
  assert.equal(model.formatDateTime("not a date"), "not a date");
});

/* ---------- สิทธิ์ → แท็บ ---------- */
test("tabs follow the role: employees get only my list, IT sees the work queue and settings", () => {
  const keys = (role) => model.visibleTabs(role).map((tab) => tab.key);
  assert.deepEqual(keys({}), ["mine"]);
  assert.deepEqual(keys({ is_dept_approver: true }), ["mine", "approvals"]);
  assert.deepEqual(keys({ is_it_viewer: true }), ["mine", "approvals", "it"], "the IT head sees everything but cannot change settings");
  assert.deepEqual(keys({ is_it_approver: true }), ["mine", "approvals", "it"]);
  assert.deepEqual(keys({ is_it_admin: true }), ["mine", "it", "settings"]);
  assert.equal(model.viewAllowed("settings", { is_it_approver: true }), false);
  assert.equal(model.viewAllowed("settings", { is_it_admin: true }), true);
  assert.equal(model.viewAllowed("order", {}), true, "detail and form pages are not tabs");
});

test("views and urls: unknown views are rejected, urls go to the access-request module", () => {
  const params = (query) => new URLSearchParams(query);
  assert.equal(model.readView(params("")), "mine");
  assert.equal(model.readView(params("view=order&id=1")), "order");
  assert.equal(model.readView(params("view=new")), "new");
  assert.equal(model.readView(params("view=print&id=1&form=page")), "print");
  assert.equal(model.readView(params("view=apply&id=1")), "apply");
  assert.equal(model.readView(params("view=bogus")), null);
  assert.equal(model.printUrl("abc"), "#/office?module=access-request&view=print&id=abc");
  assert.equal(model.printUrl("abc", "page"), "#/office?module=access-request&view=print&id=abc&form=page");
  assert.equal(model.applyUrl("abc"), "#/office?module=access-request&view=apply&id=abc");
  assert.equal(model.viewAllowed("apply", { is_it_admin: true, is_itas_admin: true }), true);
  assert.equal(model.viewAllowed("apply", { is_it_admin: true }), false, "an IT admin outside the register-admin list cannot apply");
  assert.equal(model.viewAllowed("apply", { is_itas_admin: true }), false);
  assert.equal(model.accessUrl("mine"), "#/office?module=access-request");
  assert.equal(model.accessUrl("order", { id: "abc" }), "#/office?module=access-request&view=order&id=abc");
  assert.equal(model.accessUrl("it"), "#/office?module=access-request&view=it");
  assert.ok(model.isUuid("2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10"));
  assert.ok(!model.isUuid("abc"));
});

/* ---------- ปุ่ม ---------- */
test("buttons come from allowed_actions only, in decision order, and unknown actions never become buttons", () => {
  assert.deepEqual(model.actionButtons(["cancel", "reject", "approve", "request_info", "start"]).map((button) => button.action), ["approve", "reject", "request_info", "start", "cancel"]);
  assert.deepEqual(model.actionButtons(["acknowledge_paper", "apply", "cancel", "bogus", "add_paper_attachment", "acknowledge"]).map((button) => button.action), ["apply", "acknowledge", "acknowledge_paper", "add_paper_attachment", "cancel"]);
  assert.deepEqual(model.actionButtons(["bogus"]), []);
  assert.deepEqual(model.actionButtons(null), []);
  assert.equal(model.actionButtons(["provide_info"])[0].inline, true, "the answer form is drawn open in the page, not as a button");
  for (const action of ["acknowledge", "acknowledge_paper", "add_paper_attachment"]) assert.equal(model.ACTION_BUTTONS[action].inline, true, `${action} has its own card`);
  assert.equal(model.ACTION_BUTTONS.apply.opens, "apply", "the apply button opens its own page");
  assert.ok(!model.ACTION_BUTTONS.apply.inline);
  assert.equal(model.deferredActions, undefined, "no part-B step is announced as in development any more");
  assert.equal(model.hasAction({ allowed_actions: ["apply"] }, "apply"), true);
  assert.equal(model.hasAction({}, "apply"), false);
  for (const spec of Object.values(model.ACTION_BUTTONS)) assert.ok(spec.rpc.startsWith("app_itar_"), spec.rpc);
});

test("an IT cancel on behalf is detected by employee number and has its own wording and a shorter limit", () => {
  const detail = { requester: { employee_no: "ID100" } };
  assert.equal(model.isCancelOnBehalf(detail, { employee_no: "IT3462" }), true);
  assert.equal(model.isCancelOnBehalf(detail, { employee_no: "ID100" }), false);
  assert.equal(model.cancelReasonSpec(detail, { employee_no: "IT3462" }).confirmLabel, "ยกเลิกแทนผู้ยื่น");
  assert.equal(model.cancelReasonSpec(detail, { employee_no: "IT3462" }).maxLength, 470);
  assert.equal(model.cancelReasonSpec(detail, { employee_no: "ID100" }).maxLength, 500);
});

test("the approve prompt warns when one click counts as both steps", () => {
  const none = { approvals: { dept: null, it_mgr: null } };
  assert.match(model.confirmMessageFor("approve", none, { is_it_approver: true }), /ทั้งขั้นแผนกและขั้น IT/);
  assert.doesNotMatch(model.confirmMessageFor("approve", none, { is_dept_approver: true }), /ทั้งขั้นแผนกและขั้น IT/);
  assert.doesNotMatch(model.confirmMessageFor("approve", { approvals: { dept: { by: "x" }, it_mgr: null } }, { is_it_approver: true }), /ทั้งขั้นแผนกและขั้น IT/);
});

test("timeline labels, with an IT cancel shown as on behalf", () => {
  assert.equal(model.eventLabel("applied"), "IT บันทึกสิทธิ์ลงทะเบียน");
  assert.equal(model.eventLabel("acknowledged"), "ผู้ใช้รับทราบสิทธิ์");
  const requester = { employee_no: "ID100" };
  assert.equal(model.eventLabelFor({ action: "cancelled", actor_employee_no: "IT3462" }, requester), "IT ยกเลิกแทนผู้ยื่น");
  assert.equal(model.eventLabelFor({ action: "cancelled", actor_employee_no: "ID100" }, requester), "ผู้ยื่นยกเลิก");
});

/* ---------- ผู้รับสิทธิ์ ---------- */
test("who may be chosen as the subject: employees only themselves, department managers only for revoke-all, IT anyone", () => {
  const values = (role, type) => model.subjectModes(role, type).map((mode) => mode.value);
  assert.deepEqual(values({}, "change"), ["self"]);
  assert.deepEqual(values({ is_dept_approver: true }, "change"), ["self"]);
  assert.deepEqual(values({ is_dept_approver: true }, "revoke_all"), ["self", "other"], "a manager files revoke-all for their people");
  assert.deepEqual(values({ is_it_admin: true }, "new"), ["self", "other", "manual"]);
  assert.deepEqual(values({ is_it_admin: true }, "revoke_all"), ["self", "other"], "revoke-all needs someone in the register, so no free-typed person");
  assert.equal(model.subjectModeAllowed({}, "change", "other"), false);
});

test("subject params: self always names the employee, new adds the division, a picked user without an account goes by user id", () => {
  const role = { employee_id: "e-self" };
  assert.deepEqual(plain(model.subjectParams({ type: "change", mode: "self" }, role)), { employee_id: "e-self" });
  assert.deepEqual(plain(model.subjectParams({ type: "new", mode: "self", division: "factory", name_en: " Somchai K " }, role)), { employee_id: "e-self", name_en: "Somchai K", division: "factory" });
  assert.deepEqual(plain(model.subjectParams({ type: "revoke_all", mode: "other", pick: { kind: "employee", id: "e2" }, name_en: "ignored" }, role)), { employee_id: "e2" }, "name and division only matter for a new user");
  assert.deepEqual(plain(model.subjectParams({ type: "revoke_all", mode: "other", pick: { kind: "user", id: "u9" } }, role)), { user_id: "u9" });
  assert.deepEqual(plain(model.subjectParams({ type: "new", mode: "manual", name_th: "คนนอก", name_en: "", department_id: "d1", division: "office" }, role)), { name_th: "คนนอก", department_id: "d1", division: "office" });
});

test("subject problems are caught in Thai before the form context is requested", () => {
  const admin = { is_it_admin: true };
  assert.match(model.subjectProblem({ type: "", mode: "self" }, {}), /เลือกประเภทคำขอ/);
  assert.match(model.subjectProblem({ type: "new", mode: "self" }, {}), /เลือกฝ่าย/);
  assert.equal(model.subjectProblem({ type: "new", mode: "self", division: "office" }, {}), "");
  assert.equal(model.subjectProblem({ type: "change", mode: "self" }, {}), "");
  assert.match(model.subjectProblem({ type: "change", mode: "other", pick: { id: "x" } }, {}), /ยื่นแทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT/);
  assert.match(model.subjectProblem({ type: "change", mode: "other" }, admin), /ค้นหาและเลือก/);
  assert.match(model.subjectProblem({ type: "change", mode: "manual" }, admin), /ระบุชื่อ/);
  assert.match(model.subjectProblem({ type: "change", mode: "manual", name_th: "ก" }, admin), /เลือกแผนก/);
  assert.equal(model.subjectProblem({ type: "change", mode: "manual", name_en: "Guest", department_id: "d1" }, admin), "");
});

test("search results: employees and registry users without an employee, never the same person twice", () => {
  const rows = model.searchChoices({
    employees: [{ id: "e1", employee_no: "AC100", full_name: "สมชาย ใจดี", department_name: "บัญชี", user_id: "u1" }, { id: "e2", employee_no: "AC101", full_name: "มาลี", department_name: "บัญชี", user_id: null }],
    users: [{ id: "u1", name_th: "สมชาย ใจดี", employee_id: "e1" }, { id: "u7", auth_id: "guest.g", name_th: "ผู้เยี่ยม", name_en: "Guest", department_code: "ACC", status: "active", employee_id: null }],
  });
  assert.deepEqual(rows.map((row) => [row.kind, row.id]), [["employee", "e1"], ["employee", "e2"], ["user", "u7"]]);
  assert.match(rows[0].meta, /มีในทะเบียนสิทธิ์/);
  assert.match(rows[1].meta, /ยังไม่มีในทะเบียนสิทธิ์/);
  assert.match(rows[2].meta, /ไม่มีบัญชีพนักงาน/);
  assert.deepEqual(model.searchChoices(null), []);
});

/* ---------- ฟอร์มสิทธิ์ → p_items ---------- */
test("a linked change starts from the current rights and sends only what differs, with from exactly as shown", () => {
  const ctx = context();
  const choices = model.initialChoices(ctx);
  assert.equal(choices.folders.ACC, "R", "the form shows the current level");
  assert.equal(choices.folders.HR, "none");
  assert.equal(choices.programs.IPRIME, "yes");
  assert.equal(choices.internet, "no");
  assert.deepEqual(plain(model.buildItems(ctx, choices)), { items: [], problems: [{ name: "items", message: "ยังไม่ได้เปลี่ยนสิทธิ์อะไรเลย กรุณาเลือกสิทธิ์ที่ต้องการเพิ่ม ลด หรือเปลี่ยน อย่างน้อยหนึ่งรายการ" }] });
  choices.folders.ACC = "F"; // R -> F
  choices.folders.HR = "R"; // none -> R
  choices.folders.OLD = "none"; // ถอดโฟลเดอร์ที่ปิดใช้งานแล้ว
  choices.programs.IPRIME = "no";
  choices.internet = "yes";
  choices.internetNote = "  ติดต่อลูกค้า ";
  choices.emailCloses = ["somchai@mnp.test"];
  choices.emailAdds = [{ address: " Extra@MNP.test ", kind: "extra" }, { address: "  ", kind: "extra" }];
  const built = model.buildItems(ctx, choices);
  assert.deepEqual(built.problems, []);
  assert.deepEqual(plain(built.items), [
    { kind: "folder", target: "ACC", from: "R", to: "F" },
    { kind: "folder", target: "HR", from: null, to: "R" },
    { kind: "folder", target: "OLD", from: "F", to: null },
    { kind: "internet", from: false, to: true, note: "ติดต่อลูกค้า" },
    { kind: "program", target: "IPRIME", from: true, to: false },
    { kind: "email", target: "somchai@mnp.test", to: "close" },
    { kind: "email", target: "extra@mnp.test", to: "add", email_kind: "extra" },
  ]);
  assert.ok(built.items.filter((item) => item.kind !== "email").every((item) => "from" in item), "every right sends from, even when it is null");
});

test("a closed folder can only be dropped, never requested", () => {
  const rows = model.folderRows(context());
  const old = rows.find((row) => row.code === "OLD");
  assert.equal(old.active, false);
  assert.deepEqual(old.options.map((option) => option.value), ["none", "F"], "none or keeping what is there");
  assert.deepEqual(rows.find((row) => row.code === "HR").options.map((option) => option.value), ["none", "R", "F"]);
  assert.match(rows.find((row) => row.code === "ACC").options.find((option) => option.value === "R").label, /ปัจจุบัน/);
});

test("a new user and an unlinked person send only to (no from), and unlinked changes may also drop a right", () => {
  const fresh = context({ request_type: "new", linked: false, rights: null });
  const choices = model.initialChoices(fresh);
  assert.equal(choices.folders.ACC, "keep");
  assert.deepEqual(model.folderRows(fresh)[0].options.map((option) => option.value), ["keep", "R", "F"], "new users can only add");
  choices.folders.ACC = "R";
  choices.programs.IPRIME = "yes";
  choices.programs.OTHER = "yes";
  choices.programNotes.OTHER = "AutoCAD";
  choices.internet = "yes";
  choices.internetNote = "ใช้ค้นข้อมูล";
  choices.emailAdds = [{ address: "new.user@mnp.test", kind: "internal" }];
  const built = model.buildItems(fresh, choices);
  assert.deepEqual(built.problems, []);
  assert.deepEqual(plain(built.items), [
    { kind: "folder", target: "ACC", to: "R" },
    { kind: "internet", to: true, note: "ใช้ค้นข้อมูล" },
    { kind: "program", target: "IPRIME", to: true },
    { kind: "program", target: "OTHER", to: true, note: "AutoCAD" },
    { kind: "email", target: "new.user@mnp.test", to: "add", email_kind: "internal" },
  ]);
  const unlinked = context({ linked: false, rights: null });
  assert.deepEqual(model.folderRows(unlinked)[0].options.map((option) => option.value), ["keep", "R", "F", "none"], "an unlinked change can ask to drop (IT checks against the register)");
  const dropped = model.initialChoices(unlinked);
  dropped.folders.HR = "none";
  assert.deepEqual(plain(model.buildItems(unlinked, dropped).items), [{ kind: "folder", target: "HR", to: null }]);
});

test("form problems are reported in Thai against the field that needs fixing", () => {
  const ctx = context();
  const choices = model.initialChoices(ctx);
  choices.internet = "yes"; // ไม่ได้ระบุเหตุผล
  choices.programs.OTHER = "yes"; // ไม่ได้ระบุชื่อโปรแกรม
  choices.emailAdds = [{ address: "not-an-email", kind: "extra" }, { address: "a@b.co", kind: "internal" }, { address: "c@d.co", kind: "internal" }, { address: "a@b.co", kind: "extra" }];
  const names = model.buildItems(ctx, choices).problems.map((problem) => problem.name);
  assert.deepEqual(names, ["internet_note", "program_note", "email_add", "email_add", "email_add"]);
  const messages = model.buildItems(ctx, choices).problems.map((problem) => problem.message).join(" | ");
  assert.match(messages, /เหตุผลที่ขอใช้อินเทอร์เน็ต/);
  assert.match(messages, /โปรแกรมอะไร/);
  assert.match(messages, /รูปแบบอีเมลไม่ถูกต้อง: not-an-email/);
  assert.match(messages, /อีเมลภายในมีได้ 1 ที่อยู่/);
  assert.match(messages, /ซ้ำกัน/);
  const over = model.initialChoices(ctx);
  over.emailAdds = Array.from({ length: 81 }, (_, index) => ({ address: `u${index}@mnp.test`, kind: "extra" }));
  assert.ok(model.buildItems(ctx, over).problems.some((problem) => /ไม่เกิน 80 รายการ/.test(problem.message)));
});

test("internal mail is offered only when the person has none yet, and only active mail can be closed", () => {
  assert.deepEqual(model.emailKindOptions(context()).map((kind) => kind.value), ["extra"], "already has an internal address");
  assert.deepEqual(model.emailKindOptions(context({ rights: { ...RIGHTS, emails: [] } })).map((kind) => kind.value), ["internal", "extra"]);
  assert.deepEqual(model.currentEmails(context()).map((email) => email.address), ["somchai@mnp.test"]);
  assert.deepEqual(model.currentEmails(context({ request_type: "new", linked: false, rights: null })), []);
});

test("revoke-all has no items and describes what will be removed", () => {
  const revoke = context({ request_type: "revoke_all" });
  assert.deepEqual(plain(model.buildItems(revoke, model.initialChoices(revoke))), { items: [], problems: [] });
  const summary = model.rightsSummary(RIGHTS);
  assert.equal(model.revokeText(summary), "จะถอดสิทธิ์ทั้งหมด: โฟลเดอร์ 2 · โปรแกรม 1 · อีเมล 1");
  assert.match(model.revokeText(null), /IT ตรวจกับทะเบียนตอนบันทึก/);
  assert.match(model.revokeText(model.rightsSummary({ folders: [], programs: [], emails: [], internet: false })), /ไม่มีสิทธิ์ใดในทะเบียน/);
  assert.equal(model.rightsSummary(null), null);
});

test("create params pass the type, trimmed reason, items and subject straight through", () => {
  assert.deepEqual(plain(model.createParams({ type: "change", reason: "  ย้ายแผนก  ", items: [{ kind: "internet", to: true }], subject: { employee_id: "e1" } })), {
    p_request_type: "change", p_reason: "ย้ายแผนก", p_items: [{ kind: "internet", to: true }], p_subject: { employee_id: "e1" },
  });
  assert.equal(model.createParams({ type: "revoke_all", reason: "ลาออก", items: [] }).p_subject, null);
  assert.deepEqual(model.requestRules()[0].name, "reason");
  const [rule] = model.requestRules();
  assert.equal(rule.required, true);
  assert.equal(rule.message, "กรุณาระบุเหตุผลที่ขอ");
  assert.equal(rule.check("x".repeat(2000)), true);
  assert.equal(rule.check("x".repeat(2001)), false);
  assert.match(rule.checkMessage, /2,000/);
});

test("after a stale-rights error the new context keeps what the user meant to change and drops the rest", () => {
  const oldCtx = context();
  const choices = model.initialChoices(oldCtx);
  choices.folders.ACC = "F"; // ตั้งใจเปลี่ยน
  choices.folders.HR = "R"; // ตั้งใจเปลี่ยน
  choices.emailCloses = ["somchai@mnp.test"];
  choices.emailAdds = [{ address: "x@y.co", kind: "extra" }];
  // ระหว่างนั้น IT แก้ ACC เป็น F ไปแล้ว และถอดอีเมลเดิมออก
  const newCtx = context({ rights: { ...RIGHTS, folders: [{ code: "ACC", name: "บัญชี", level: "F", is_active: true }], emails: [] } });
  const carried = model.carryChoices(oldCtx, choices, newCtx);
  assert.equal(carried.folders.ACC, "F", "still what the user asked for (now equal to the register, so it drops out of the items)");
  assert.equal(carried.folders.HR, "R");
  assert.deepEqual(carried.emailCloses, [], "mail that is already gone is not closed again");
  assert.deepEqual(plain(carried.emailAdds), [{ address: "x@y.co", kind: "extra" }]);
  assert.deepEqual(plain(model.buildItems(newCtx, carried).items.map((item) => item.target)), ["HR", "x@y.co"]);
  assert.equal("OLD" in carried.folders, false, "rows that no longer exist in the new context are gone");
});

/* ---------- ตาราง ก่อน → หลัง ---------- */
test("the before/after table reads what the detail returns, with unknown 'before' and the result IT decided", () => {
  const rows = model.itemRows({ items: [
    { line_no: 2, kind: "internet", from_known: true, from_value: "false", to_value: "true", note: "ติดต่อลูกค้า", result: { decision: "applied", reason: null, at: "2026-11-28T01:00:00Z" } },
    { line_no: 1, kind: "folder", target: "ACC", target_name: "บัญชี", from_known: false, from_value: null, to_value: "F", result: { decision: "rejected", reason: "ซ้ำกับสิทธิ์เดิม", at: "2026-11-28T01:00:00Z" } },
    { line_no: 3, kind: "program", target: "OTHER", target_name: "อื่นๆ", from_known: true, from_value: "false", to_value: "true", note: "AutoCAD" },
    { line_no: 4, kind: "email", target: "a@b.co", from_known: true, from_value: null, to_value: "add", email_kind: "extra" },
    { line_no: 5, kind: "email", target: "c@d.co", from_known: true, from_value: null, to_value: "close" },
  ] });
  assert.deepEqual(rows.map((row) => row.no), [1, 2, 3, 4, 5], "ordered by line");
  assert.equal(rows[0].label, "โฟลเดอร์ ACC บัญชี");
  assert.equal(rows[0].before, "ไม่ทราบ (ยังไม่ผูกทะเบียน)");
  assert.equal(rows[0].after, "อ่าน-เขียน-แก้ไข-ลบ (F)");
  assert.deepEqual(plain(rows[0].result), { decision: "rejected", label: "ไม่บันทึก", reason: "ซ้ำกับสิทธิ์เดิม", at: "2026-11-28T01:00:00Z" });
  assert.deepEqual([rows[1].before, rows[1].after, rows[1].note, rows[1].result.label], ["ไม่มี", "มี", "ติดต่อลูกค้า", "บันทึกแล้ว"]);
  assert.equal(rows[2].label, "โปรแกรม อื่นๆ: AutoCAD", "an 'other' program shows what was typed");
  assert.equal(rows[2].note, "", "and the note is not repeated as a reason");
  assert.deepEqual([rows[3].label, rows[3].before, rows[3].after], ["อีเมล a@b.co (อีเมลอื่น)", "—", "ขอเปิดอีเมลใหม่"]);
  assert.deepEqual([rows[4].before, rows[4].after], ["ใช้งานอยู่", "ปิดอีเมล"]);
  assert.equal(rows[2].result, null);
});

test("the preview shows the same table for items that have not been sent yet", () => {
  const ctx = context();
  const choices = model.initialChoices(ctx);
  choices.folders.ACC = "F";
  choices.folders.HR = "R";
  const rows = model.previewRows(ctx, model.buildItems(ctx, choices).items);
  assert.deepEqual(rows.map((row) => [row.label, row.before, row.after]), [
    ["โฟลเดอร์ ACC บัญชี", "อ่านอย่างเดียว (R)", "อ่าน-เขียน-แก้ไข-ลบ (F)"],
    ["โฟลเดอร์ HR บุคคล", "ไม่มีสิทธิ์", "อ่านอย่างเดียว (R)"],
  ]);
  const fresh = context({ request_type: "new", linked: false, rights: null });
  const newChoices = model.initialChoices(fresh);
  newChoices.internet = "yes";
  newChoices.internetNote = "x";
  assert.deepEqual(model.previewRows(fresh, model.buildItems(fresh, newChoices).items).map((row) => [row.label, row.before, row.after]), [["อินเทอร์เน็ต", "ไม่มี", "มี"]]);
  const unlinked = context({ linked: false, rights: null });
  const unlinkedChoices = model.initialChoices(unlinked);
  unlinkedChoices.folders.ACC = "R";
  assert.equal(model.previewRows(unlinked, model.buildItems(unlinked, unlinkedChoices).items)[0].before, "ไม่ทราบ (ยังไม่ผูกทะเบียน)");
});

/* ---------- IT / การ์ด ---------- */
test("the IT queue groups by status with the oldest first, and the card counts only what waits for the user", () => {
  const rows = [
    { id: "1", doc_no: "IT08-01-26/003", status: "approved", created_at: "2026-11-03T00:00:00Z" },
    { id: "2", doc_no: "IT08-01-26/001", status: "approved", created_at: "2026-11-01T00:00:00Z" },
    { id: "3", doc_no: "IT08-01-26/004", status: "in_progress", created_at: "2026-11-04T00:00:00Z" },
    { id: "4", doc_no: "IT08-01-26/005", status: "awaiting_ack", created_at: "2026-11-05T00:00:00Z" },
    { id: "5", doc_no: "IT08-01-26/006", status: "need_info", created_at: "2026-11-06T00:00:00Z" },
    { id: "6", doc_no: "IT08-01-26/007", status: "pending_dept", created_at: "2026-11-07T00:00:00Z" },
    { id: "7", doc_no: "IT08-01-26/002", status: "done", created_at: "2026-11-02T00:00:00Z" },
    { id: "8", doc_no: "IT08-01-26/008", status: "cancelled", created_at: "2026-11-08T00:00:00Z" },
  ];
  const groups = model.groupItOrders(rows);
  assert.deepEqual(groups.to_start.map((row) => row.id), ["2", "1"], "no urgent jobs: oldest first");
  assert.deepEqual(groups.closed.map((row) => row.id), ["8", "7"], "closed jobs: newest first");
  assert.deepEqual(Object.keys(groups), ["to_start", "in_progress", "awaiting_ack", "awaiting_info", "awaiting_approval", "closed"]);
  assert.equal(model.itActionableCount(rows), 3, "waiting to start + in progress");
  assert.equal(model.openOrderCount(rows, [{ id: "1", status: "approved" }, { id: "9", status: "done" }]), 6, "not counted twice, closed ones left out");
  assert.deepEqual(model.mineWaiting([{ status: "awaiting_ack", needs_my_ack: true }, { status: "need_info", is_requester: true }, { status: "need_info", is_requester: false }, { status: "awaiting_ack", needs_my_ack: false }]), { ack: 1, answer: 1, total: 2 });
  assert.equal(model.mineWaitingNote({ ack: 1, answer: 0 }), " ที่รอคุณรับทราบ");
  assert.equal(model.waitingForMeCount([{ status: "pending_dept" }, { status: "need_info" }]), 1);
  const summary = model.cardSummary({ approvals: 2, itWork: 1, toAck: 0, toAnswer: null, openCount: 7 });
  assert.equal(summary.badge, "3 รอคุณ");
  assert.equal(summary.title, "รออนุมัติ 2 · งาน IT ค้าง 1");
  assert.equal(summary.openCount, 7);
  assert.equal(model.cardSummary().openCount, null);
});

test("comments are ordered and pending questions carry their files and the status the request returns to", () => {
  const detail = {
    status: "need_info", info_return_status: "pending_dept",
    comments: [
      { id: 12, kind: "answer", stage: "dept", body: "ตอบ", author_full_name: "ผู้ยื่น", created_at: "t2", attachments: [{ id: "f2" }] },
      { id: 10, kind: "question", stage: "dept", body: "ถาม", author_full_name: "หัวหน้า", created_at: "t1", attachments: [{ id: "f1" }] },
    ],
    info_pending: { comment_id: 10, stage: "dept", body: "ถาม", asked_at: "t1", asked_by_full_name: "หัวหน้า" },
    attachments: [{ id: "f0" }],
    paper_attachments: [{ id: "p1" }],
  };
  assert.deepEqual(model.commentRows(detail).map((row) => [row.no, row.id, row.kindLabel, row.stageLabel]), [[1, 10, "ถาม", "ผู้จัดการแผนก"], [2, 12, "ตอบ", "ผู้จัดการแผนก"]]);
  const pending = model.pendingQuestion(detail);
  assert.equal(pending.stageLabel, "ผู้จัดการแผนก");
  assert.deepEqual(pending.files.map((file) => file.id), ["f1"]);
  assert.equal(pending.returnLabel, "รอผู้จัดการแผนก");
  assert.deepEqual(model.allFiles(detail).map((file) => file.id), ["f0", "f1", "f2", "p1"], "request files, message files, then signed-paper photos");
  assert.equal(model.pendingQuestion({ info_pending: null }), null);
  assert.equal(model.infoBadgeTitle({ status: "need_info", info_stage: "it", info_return_status: "in_progress" }, true), "ทีม IT ถามคุณ · ตอบแล้วใบกลับไปที่ IT กำลังดำเนินการ");
});

test("who filed for whom is read from employee numbers", () => {
  assert.equal(model.filedForOther({ requester: { employee_no: "A1" }, subject: { employee_no: "A1" } }), false);
  assert.equal(model.filedForOther({ requester: { employee_no: "A1" }, subject: { employee_no: "B2" } }), true);
  assert.equal(model.filedForOther({ requester: { employee_no: "A1" }, subject: { employee_no: null } }), true, "no account = always someone else");
  assert.equal(model.subjectName({ name_th: "สมชาย", name_en: "Somchai" }), "สมชาย (Somchai)");
  assert.equal(model.subjectName({ name_th: "สมชาย", name_en: "สมชาย" }), "สมชาย");
});

/* ---------- ไฟล์ ---------- */
test("files: the same types, limits and paths as the other office modules, in the itar buckets", () => {
  assert.equal(model.fileBucket(false), "itar-files");
  assert.equal(model.fileBucket(true), "itar-test-files");
  assert.equal(model.fileMime({ name: "ตาราง.CSV" }), "text/csv");
  assert.equal(model.fileMime({ name: "ไฟล์.exe" }), null);
  assert.equal(model.filePath("ABC-1", "UUID-1", { name: "x.PDF" }), "abc-1/uuid-1.pdf");
  assert.equal(model.validateFiles(Array.from({ length: 11 }, () => ({ name: "a.pdf", size: 1 }))), "แนบได้ไม่เกิน 10 ไฟล์ต่อครั้ง");
  assert.match(model.validateFiles([{ name: "a.exe", size: 1 }]), /ชนิดไฟล์นี้ไม่รองรับ/);
  assert.match(model.validateFiles([{ name: "a.pdf", size: 0 }]), /ไฟล์ว่างเปล่า/);
  assert.match(model.validateFiles([{ name: "a.pdf", size: 21 * 1048576 }]), /ไม่เกิน 20 MB/);
  assert.equal(model.validateFiles([{ name: "a.pdf", size: 1000 }]), null);
  assert.equal(model.formatFileSize(1536), "1.5 KB");
  assert.match(model.FILE_HINT, /10 ไฟล์/);
});

test("uploads continue past a failed file, and a retry skips what already succeeded and gives rejected files a new path", async () => {
  const entries = model.makeUploadEntries("req-1", [{ name: "a.pdf" }, { name: "b.pdf" }], (() => { let n = 0; return () => `u${(n += 1)}`; })());
  assert.deepEqual(entries.map((entry) => entry.path), ["req-1/u1.pdf", "req-1/u2.pdf"]);
  const uploads = [];
  const failed = await model.runUploads(entries, {
    upload: async (entry) => { uploads.push(entry.path); },
    register: async (entry) => { if (entry.path.endsWith("u2.pdf")) throw Object.assign(new Error("กรุณาอัปโหลดไฟล์ใหม่"), { code: "23514" }); },
  });
  assert.deepEqual(failed.map((entry) => entry.file.name), ["b.pdf"]);
  assert.notEqual(entries[1].path, "req-1/u2.pdf", "a file the database rejected is uploaded again under a new path");
  const again = await model.runUploads(entries, { upload: async (entry) => { uploads.push(entry.path); }, register: async () => {} });
  assert.deepEqual(again, []);
  assert.equal(uploads.length, 3, "a.pdf was not uploaded twice");
});

/* ---------- ข้อผิดพลาด ---------- */
test("errors become Thai messages: stale rights ask for a reload, a missing function says the database is not updated, network loss is uncertain", () => {
  assert.equal(model.describeError({ code: "PGRST202", message: "Could not find the function" }).kind, "missing");
  assert.match(model.describeError({ code: "PGRST202" }).message, /ฐานข้อมูลยังไม่ได้อัปเดต/);
  assert.equal(model.isMissingFunction({ message: "Could not find the function public.app_itar_my_role in the schema cache" }), true);
  const stale = model.describeError({ code: "40001", message: "โฟลเดอร์ ACC: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่" }, { write: true });
  assert.equal(stale.kind, "stale");
  assert.equal(stale.forwarded, true);
  assert.equal(model.isStaleRights({ code: "40001" }), true);
  assert.equal(model.isStaleRights({ code: "23514" }), false);
  const thai = model.describeError({ code: "23514", message: "กรุณาระบุเหตุผลที่ขอ" });
  assert.deepEqual([thai.kind, thai.forwarded], ["rejected", true]);
  assert.equal(model.describeError({ code: "XX000", message: "internal error" }).message, "ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ");
  assert.equal(model.describeError({ message: "Failed to fetch" }, { write: true }).kind, "unknown");
  assert.match(model.describeError({ message: "Failed to fetch" }, { write: true }).message, /ผลไม่แน่ชัด/);
  assert.equal(model.describeError({ status: 401, message: "JWT expired" }).kind, "session");
  assert.match(model.describeUploadError({ statusCode: "403" }).message, /30 นาที/);
  assert.match(model.describeUploadError({ statusCode: "413" }).message, /20 MB/);
});

test("settings helpers: the doc number format has the form code, the next number only moves forward", () => {
  assert.equal(model.formatDocNo(false, 2026, 7), "IT08-01-26/007");
  assert.equal(model.formatDocNo(true, 2026, 1234), "TEST-IT08-01-26/1234");
  assert.match(model.validateNextSeq("5", 5), /มากกว่าเลขถัดไปปัจจุบัน/);
  assert.equal(model.validateNextSeq("6", 5), null);
  assert.match(model.validateNextSeq("abc", 5), /จำนวนเต็ม/);
  assert.equal(model.staffRoleText({ is_it_admin: true, is_itas_admin: true }), "ผู้ดูแลงาน IT · บันทึกลงทะเบียนสิทธิ์ได้");
  assert.equal(model.validateReason("  ", "ยกเลิก"), "กรุณาระบุเหตุผลที่ยกเลิก");
  assert.equal(model.validateReason("เหตุผล"), null);
});

test("development flag and version are plain constants the card can read", () => {
  assert.equal(model.IN_DEVELOPMENT, true);
  assert.match(model.MODULE_VERSION, /^\d+\.\d{2}$/);
  assert.match(model.VERSION_DATE, /^\d{4}-\d{2}-\d{2}$/);
});
