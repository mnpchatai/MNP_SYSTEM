import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// modules/itar-pages.js (ใบขอสิทธิ์ IT): HTML ล้วน · ตรวจโครงสำคัญ การ escape ข้อมูลจากฐานข้อมูล ปุ่มตาม allowed_actions ตาราง ก่อน→หลัง และไม่มีช่องรหัสผ่าน
const require = createRequire(import.meta.url);
globalThis.MNP_ITAR_MODEL = require("../../modules/itar-model.js");
const model = globalThis.MNP_ITAR_MODEL;
const pages = require("../../modules/itar-pages.js");
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const count = (text, pattern) => (text.match(pattern) ?? []).length;

const ID = "2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10";
const CATALOG = {
  folders: [{ code: "ACC", name: "บัญชี", description: "เอกสารบัญชี" }, { code: "HR", name: "บุคคล", description: null }],
  programs: [{ code: "IPRIME", name: "iPrime" }, { code: "OTHER", name: "อื่นๆ" }],
};
const RIGHTS = {
  status: "active", internet: false,
  folders: [{ code: "ACC", name: "บัญชี", level: "R", is_active: true }],
  programs: [{ code: "IPRIME", name: "iPrime", note: null, is_active: true }],
  emails: [{ address: "somchai@mnp.test", kind: "internal" }],
};
const context = (overrides = {}) => model.normalizeContext({
  request_type: "change", linked: true, rights: RIGHTS, catalog: CATALOG,
  subject: { employee_id: "e1", name_th: "สมชาย <b>ใจดี</b>", department_name: "บัญชี", division: "office" }, ...overrides,
});
const detailOf = (overrides = {}) => ({
  id: ID, doc_no: "IT08-01-26/001", status: "pending_dept", request_type: "change", reason: "ย้ายแผนก <script>x</script>", created_at: "2026-11-28T01:00:00Z",
  requester: { employee_no: "AC100", full_name: "มาลี ยื่น" }, department: { code: "ACC", name_th: "บัญชี" },
  subject: { employee_no: "AC200", name_th: "สมชาย ใจดี", name_en: "Somchai", department_code: "ACC", division: "office", has_account: true },
  items: [{ id: "i1", line_no: 1, kind: "folder", target: "ACC", target_name: "บัญชี", from_known: true, from_value: "R", to_value: "F", note: null, result: null }],
  approvals: { dept: null, it_mgr: null }, events: [{ id: 1, action: "created", reason: null, created_at: "2026-11-28T01:00:00Z", actor_employee_no: "AC100", actor_full_name: "มาลี ยื่น" }],
  attachments: [], paper_attachments: [], comments: [], info_pending: null, applied_summary: null, subject_rights: null, allowed_actions: [], ...overrides,
});

test("every page is wrapped with the development banner and version tag, which the flag removes", () => {
  const html = pages.page("<p>x</p>");
  assert.match(html, /itar-dev-notice/);
  assert.match(html, /ระบบใบขอสิทธิ์ IT กำลังพัฒนาและทดสอบ ยังไม่เปิดใช้งานจริง/);
  assert.match(html, /<p class="itar-version no-print"[^>]*>V1\.00<\/p>/);
  assert.doesNotMatch(pages.page("<p>x</p>", { showDevNotice: false }), /itar-dev-notice/);
});

test("tabs follow the role and show counts with a Thai explanation", () => {
  assert.equal(pages.tabs({}, "mine", {}), "", "a single tab has no tab bar");
  assert.match(pages.tabs({}, "mine", { mine: 1, mineParts: { ack: 1, answer: 0 } }), /รอคุณรับทราบ/);
  const html = pages.tabs({ is_it_admin: true, is_dept_approver: true }, "approvals", { approvals: 3, it: 120 });
  assert.equal(count(html, /<a class="view-tab/g), 4);
  assert.match(html, /aria-current="page" href="#\/office\?module=access-request&amp;view=approvals"/);
  assert.match(html, /99\+/);
  assert.match(html, /ตั้งค่า/);
});

test("lists link to the order detail, escape names and say who filed for whom", () => {
  const rows = [{ id: ID, doc_no: "IT08-01-26/001", status: "need_info", request_type: "change", subject_name: "สมชาย <x>", department_name: "บัญชี", requester_name: "มาลี", created_at: "2026-11-28T01:00:00Z", item_count: 3, info_stage: "dept", info_return_status: "pending_dept", is_requester: false, needs_my_ack: false }];
  const mine = pages.mineList(rows);
  assert.match(mine, new RegExp(`href="#/office\\?module=access-request&amp;view=order&amp;id=${ID}"`));
  assert.match(mine, /สมชาย &lt;x&gt;/);
  assert.doesNotMatch(mine, /<x>/);
  assert.match(visibleText(mine), /เปลี่ยนแปลง · 3 รายการ · ยื่นโดย มาลี/);
  assert.match(mine, /รอผู้ยื่นตอบ/, "the subject is not the one who answers");
  assert.match(pages.mineList([]), /ยื่นขอสิทธิ์ใหม่/);
  const approvals = pages.approvalsList([{ ...rows[0], status: "pending_it_mgr", pending_step: "it_mgr" }, { ...rows[0], id: "x2", status: "need_info" }]);
  assert.match(approvals, /รอคุณอนุมัติขั้น IT/);
  assert.match(approvals, /รอผู้ยื่นตอบ <span class="detail-section-count">1<\/span>|data-group="awaiting_info"/);
  assert.match(pages.approvalsList([]), /ไม่มีใบขอสิทธิ์ที่รออนุมัติจากคุณ/);
  const it = pages.itList([{ ...rows[0], status: "approved", has_dept_approved: true, has_it_mgr_approved: true }, { ...rows[0], id: "x3", status: "done" }]);
  assert.match(it, /data-group="to_start"/);
  assert.match(it, /<details class="card detail-section itar-group" data-group="closed"/, "closed jobs are collapsed");
  assert.match(it, /✓ ผู้จัดการแผนก/);
});

test("the chooser form lists the three request types and hides the subject choice from ordinary employees", () => {
  const values = { type: "", mode: "self", pick: null, search: "", name_th: "", name_en: "", department_id: "", division: "" };
  const employee = pages.chooserForm({ role: { full_name: "มาลี", department: { name_th: "บัญชี" } }, values, search: { state: "idle", results: [] } });
  assert.equal(count(employee, /name="request_type"/g), 3);
  assert.match(employee, /ยกเลิกทั้งหมด \(ลาออก\/ย้าย\)/);
  assert.doesNotMatch(employee, /name="subject_mode"/, "an ordinary employee can only file for themselves");
  assert.match(employee, /id="itar-next"/);
  const it = pages.chooserForm({ role: { is_it_admin: true }, values: { ...values, type: "new" }, search: { state: "idle", results: [] } });
  assert.equal(count(it, /name="subject_mode"/g), 3);
  assert.match(it, /name="division"/, "a new user needs the division");
  assert.match(it, /name="name_en"/);
  const lookups = pages.subjectBody({ role: { is_it_admin: true }, values: { ...values, type: "change", mode: "other" }, search: { state: "idle", searched: true, results: [{ key: "e:1", kind: "employee", id: "1", name: "สมชาย <i>", meta: "AC100" }] } });
  assert.match(lookups, /data-pick="e:1"/);
  assert.match(lookups, /สมชาย &lt;i&gt;/);
  assert.match(pages.subjectBody({ role: { is_it_admin: true }, values: { ...values, type: "change", mode: "other" }, search: { state: "idle", searched: true, results: [] } }), /ไม่พบผู้รับสิทธิ์/);
  const manual = pages.subjectBody({ role: { is_it_admin: true }, values: { ...values, type: "change", mode: "manual" }, departments: [{ id: "d1", code: "ACC", name_th: "บัญชี" }] });
  assert.match(manual, /name="name_th"/);
  assert.match(manual, /<option value="d1">บัญชี \(ACC\)<\/option>/);
  assert.match(manual, /รับทราบด้วยกระดาษ/);
});

test("the rights form for a linked change shows current rights, marks them, and offers closing the existing mail", () => {
  const ctx = context();
  const html = pages.rightsForm({ ctx, choices: model.initialChoices(ctx), reasonText: "" });
  assert.match(html, /id="itar-form"/);
  assert.match(html, /สมชาย &lt;b&gt;ใจดี&lt;\/b&gt;/, "the subject name is escaped");
  assert.doesNotMatch(html, /<b>ใจดี/);
  assert.match(html, /<option value="R" selected>อ่านอย่างเดียว \(R\) · ปัจจุบัน<\/option>/, "the current level is selected and labelled");
  assert.equal(count(html, /data-folder="/g), 2);
  assert.match(html, /ปิด somchai@mnp\.test/, "an existing address can be closed");
  assert.match(html, /id="itar-email-add"/);
  assert.match(html, /name="reason"/);
  assert.match(html, /id="itar-files"[^>]*multiple/);
  assert.match(html, /id="itar-preview"/);
  assert.match(html, /data-note-for="internet" hidden/, "the internet reason appears only when asking for it");
  assert.match(html, /R = เปิดดูได้อย่างเดียว/, "the R/F explanation is shown");
  assert.doesNotMatch(html, /type="password"|รหัสผ่าน/, "no password field anywhere");
  assert.equal(count(html, /class="itar-right-row is-changed"/g), 0, "nothing is highlighted before the user changes something");
  const changed = model.initialChoices(ctx);
  changed.folders.ACC = "F";
  assert.equal(count(pages.rightsForm({ ctx, choices: changed }), /class="itar-right-row is-changed"/g), 1);
});

test("a new user and an unlinked change explain that the current rights are not known or empty", () => {
  const fresh = context({ request_type: "new", linked: false, rights: null });
  const html = pages.rightsForm({ ctx: fresh, choices: model.initialChoices(fresh) });
  assert.match(html, /ผู้ใช้ใหม่ยังไม่มีสิทธิ์ใดในทะเบียน/);
  assert.doesNotMatch(html, /ปัจจุบัน<\/option>/);
  assert.doesNotMatch(html, /name="email_close"/);
  const unlinked = context({ linked: false, rights: null });
  assert.match(pages.rightsForm({ ctx: unlinked, choices: model.initialChoices(unlinked) }), /ยังไม่ผูกกับทะเบียนสิทธิ์ ระบบจึงไม่ทราบสิทธิ์ปัจจุบัน/);
});

test("revoke-all has no rights to pick: only the removal summary, the reason and files", () => {
  const ctx = context({ request_type: "revoke_all" });
  const html = pages.rightsForm({ ctx, choices: model.initialChoices(ctx) });
  assert.match(html, /จะถอดสิทธิ์ทั้งหมด: โฟลเดอร์ 1 · โปรแกรม 1 · อีเมล 1/);
  assert.doesNotMatch(html, /data-folder=|name="internet"|id="itar-preview"/);
  assert.match(html, /name="reason"/);
});

test("the before/after table has a result column only after IT recorded the rights", () => {
  const rows = model.itemRows(detailOf());
  const plainTable = pages.changeTable(rows);
  assert.match(plainTable, /อ่านอย่างเดียว \(R\)/);
  assert.match(plainTable, /<strong>อ่าน-เขียน-แก้ไข-ลบ \(F\)<\/strong>/);
  assert.doesNotMatch(plainTable, /ผลที่ IT บันทึก/);
  const decided = pages.changeTable(model.itemRows(detailOf({ items: [{ ...detailOf().items[0], result: { decision: "rejected", reason: "ซ้ำ", at: "t" } }] })));
  assert.match(decided, /ผลที่ IT บันทึก/);
  assert.match(decided, /ไม่บันทึก/);
  assert.match(decided, /class="is-rejected"/);
  assert.match(pages.previewTable([]), /ยังไม่ได้เลือกสิทธิ์/);
});

test("the detail page shows the facts, the table, the history, and escapes everything from the database", () => {
  const html = pages.detailPage(detailOf());
  assert.match(html, /<h1>IT08-01-26\/001<\/h1>/);
  assert.match(html, /ยังไม่ได้อนุมัติ: ผู้จัดการแผนก · ผู้อนุมัติขั้น IT/);
  assert.match(html, /ย้ายแผนก &lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /<span class="badge itar-type-tag">ยื่นแทน<\/span>/, "requester and subject are different people");
  assert.match(visibleText(html), /ผู้รับสิทธิ์ สมชาย ใจดี \(Somchai\)/);
  assert.match(visibleText(html), /มี \(รับทราบสิทธิ์ในระบบเอง\)/);
  assert.match(html, /รายการสิทธิ์ที่ขอ \(ก่อน → หลัง\)/);
  assert.match(html, /ประวัติเอกสาร/);
  assert.match(html, /ยื่นใบขอสิทธิ์/);
  assert.doesNotMatch(html, /id="attachment-gallery"/, "no files, no gallery");
  assert.doesNotMatch(html, /itar-apply-host|itar-ack-host|itar-print-host/, "the part-B placeholders are replaced by real cards");
  assert.match(html, /id="itar-print-req"/, "the request form can always be printed");
  assert.doesNotMatch(html, /type="password"|รหัสผ่าน/);
});

test("detail buttons come from allowed_actions: decisions and apply are buttons, acknowledge has its own card", () => {
  const html = pages.detailPage(detailOf({ allowed_actions: ["approve", "reject", "request_info", "cancel", "apply", "acknowledge"] }));
  assert.deepEqual([...html.matchAll(/data-itar-action="([a-z_]+)"/g)].map((match) => match[1]), ["approve", "reject", "request_info", "apply", "cancel"]);
  assert.match(html, /id="itar-ask-card"[^>]*hidden/, "the question form waits for its button");
  assert.match(html, /id="itar-ack-card"/);
  assert.doesNotMatch(html, /กำลังพัฒนา\): /, "nothing is announced as unavailable any more");
  const none = pages.detailPage(detailOf({ allowed_actions: [] }));
  assert.doesNotMatch(none, /itar-actions-title|itar-ask-card|itar-ack-card|itar-paper-card/);
  assert.doesNotMatch(none, /data-itar-action/);
});

test("a pending question shows the open answer form with its files and where the request returns to", () => {
  const detail = detailOf({
    status: "need_info", info_return_status: "pending_dept", allowed_actions: ["provide_info", "cancel"],
    comments: [{ id: 5, kind: "question", stage: "dept", body: "ทำไม <b>ต้อง</b> ขอ", created_at: "2026-11-28T02:00:00Z", author_full_name: "หัวหน้า", attachments: [{ id: "f1", file_name: "q.pdf", mime_type: "application/pdf", size_bytes: 2048, storage_path: "p", bucket: "itar-files" }] }],
    info_pending: { comment_id: 5, stage: "dept", body: "ทำไม <b>ต้อง</b> ขอ", asked_at: "2026-11-28T02:00:00Z", asked_by_full_name: "หัวหน้า" },
  });
  const html = pages.detailPage(detail);
  assert.match(html, /id="itar-answer-card"/);
  assert.match(html, /ผู้จัดการแผนก ถามคุณ/);
  assert.match(html, /ทำไม &lt;b&gt;ต้อง&lt;\/b&gt; ขอ/);
  assert.match(html, /ตอบแล้วใบจะกลับไปที่ รอผู้จัดการแผนก/);
  assert.match(html, /id="attachment-gallery"/, "files from the question open in the shared viewer");
  assert.match(html, /data-attachment-open="f1"/);
  assert.doesNotMatch(html, /data-itar-action="provide_info"/, "the answer form is not a button");
  assert.doesNotMatch(html, /id="itar-comments"/, "the open question is not repeated in the history list");
});

test("after IT records the rights the page shows the register after the change, paper photos, and the revoke-all removal summary", () => {
  const after = detailOf({ status: "awaiting_ack", applied_summary: { applied_count: 1, rejected_count: 1, after: { ...RIGHTS, folders: [{ code: "ACC", name: "บัญชี", level: "F", is_active: true }] }, before: RIGHTS }, paper_attachments: [{ id: "p1", file_name: "signed.jpg", mime_type: "image/jpeg", size_bytes: 10, storage_path: "p", bucket: "itar-files" }] });
  const html = pages.detailPage(after);
  assert.match(html, /สิทธิ์ทั้งหมดของผู้ใช้หลังบันทึกลงทะเบียน/);
  assert.match(visibleText(html), /IT บันทึก 1 รายการ · ไม่บันทึก 1 รายการ/);
  assert.match(html, /รูปใบรับทราบที่เซ็นแล้ว/);
  const revoke = pages.detailPage(detailOf({ request_type: "revoke_all", items: [], subject_rights: RIGHTS }));
  assert.match(revoke, /สิทธิ์ที่จะถูกถอด/);
  assert.match(visibleText(revoke), /จะถอดสิทธิ์ทั้งหมด: โฟลเดอร์ 1 · โปรแกรม 1 · อีเมล 1/);
  const done = pages.detailPage(detailOf({ request_type: "revoke_all", status: "done", items: [], applied_summary: { before: RIGHTS, after: { ...RIGHTS, folders: [], programs: [], emails: [] } } }));
  assert.match(done, /สิทธิ์ที่ถอดแล้ว/);
  assert.match(visibleText(done), /ถอดสิทธิ์ทั้งหมด: โฟลเดอร์ 1/);
});

test("settings, upload panel and error card render with their hooks", () => {
  const settings = pages.settingsPage({ staff: [{ full_name: "ผู้ดูแล", employee_no: "IT3462", department_name: "IT", is_active: true, is_it_admin: true, is_itas_admin: true }], counter: { next_doc_no: "IT08-01-26/001", next_seq: 1 } });
  assert.match(settings, /id="itar-counter-form"/);
  assert.match(settings, /IT08-01-26\/001/);
  assert.match(settings, /ผู้ดูแลงาน IT · บันทึกลงทะเบียนสิทธิ์ได้/);
  const upload = pages.uploadPanel({ heading: "ยื่นแล้ว", rows: [{ name: "a.pdf", size: 1024, state: "failed", message: "ล้ม" }, { name: "b.pdf", size: 10, state: "done", message: "" }], busy: false });
  assert.match(upload, /id="itar-upload-retry"/);
  assert.match(upload, /id="itar-upload-continue"/);
  assert.match(pages.uploadPanel({ heading: "x", rows: [{ name: "a", size: 1, state: "working", message: "" }], busy: true }), /aria-busy="true"/);
  assert.match(pages.errorCard("พัง"), /id="itar-retry"/);
  assert.doesNotMatch(pages.errorCard("พัง", { retry: false }), /itar-retry/);
  assert.match(pages.purgeRow(), /id="itar-purge"/);
  assert.match(pages.head({ isTest: true }), /ทดสอบ/);
  assert.match(pages.head({}), /<h1>ใบขอสิทธิ์ IT<\/h1>/);
});
