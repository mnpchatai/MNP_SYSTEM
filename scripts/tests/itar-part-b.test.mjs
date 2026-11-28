import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// ใบขอสิทธิ์ IT ส่วน B: ปรับสิทธิ์ตามใบ (apply) · รับทราบสิทธิ์ · รับทราบด้วยกระดาษ · ใบพิมพ์ A4 (USER-REQ / USER-Page) · งานบนหน้าแรก
// model + pages ทดสอบแบบข้อมูลล้วน/HTML ล้วน · module-itar.js ตรวจแบบอ่านโค้ดว่า RPC และชื่อพารามิเตอร์ตรงกับ migration
const require = createRequire(import.meta.url);
globalThis.MNP_ITAR_MODEL = require("../../modules/itar-model.js");
const model = globalThis.MNP_ITAR_MODEL;
const pages = require("../../modules/itar-pages.js");
const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").split("\r\n").join("\n");
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const ITEM = (overrides) => ({ id: "i1", line_no: 1, kind: "folder", target: "ACC", target_name: "บัญชี", from_known: true, from_value: "R", to_value: "F", note: null, email_kind: null, current_known: true, current_value: "R", result: null, ...overrides });
const applyContext = (overrides = {}, items = [ITEM({})]) => model.normalizeApplyContext({
  request: { id: "r1", doc_no: "IT08-01-26/001", request_type: "change", status: "in_progress", reason: "ย้ายแผนก", subject_employee_id: "e1", subject_user_id: "u1", subject_name_th: "สมชาย ใจดี", subject_name_en: "Somchai", subject_department_code: "ACC", subject_division: "office" },
  needs_user_choice: false, needs_new_user: false, can_apply: true, items, subject_rights: null, suggested_users: [], ...overrides,
});

/* ---------- ปรับสิทธิ์ตามใบ (model) ---------- */
test("apply rows compare the request with the register now and warn when they disagree", () => {
  const ctx = applyContext({}, [
    ITEM({ id: "i1", line_no: 1 }),
    ITEM({ id: "i2", line_no: 2, target: "HR", target_name: "บุคคล", from_value: "R", to_value: "F", current_value: "F" }),
    ITEM({ id: "i3", line_no: 3, kind: "internet", target: null, from_value: "false", to_value: "true", current_value: "true" }),
    ITEM({ id: "i4", line_no: 4, kind: "email", target: "a@mnp.test", from_known: false, from_value: null, to_value: "add", current_value: "active" }),
    ITEM({ id: "i5", line_no: 5, kind: "email", target: "b@mnp.test", from_known: false, from_value: null, to_value: "close", current_value: null }),
    ITEM({ id: "i6", line_no: 6, kind: "program", target: "IPRIME", target_name: "iPrime", from_known: false, from_value: null, to_value: "true", current_value: "true" }),
    ITEM({ id: "i7", line_no: 7, current_known: false, current_value: null }),
  ]);
  const rows = model.applyRows(ctx);
  assert.equal(rows[0].warning, "", "the register still matches what the requester saw");
  assert.equal(rows[0].current, "อ่านอย่างเดียว (R)");
  assert.match(rows[1].warning, /ไม่ตรงกับที่ผู้ยื่นเห็น/);
  assert.match(rows[2].warning, /ไม่ตรงกับที่ผู้ยื่นเห็น/);
  assert.match(rows[3].warning, /ใช้งานอยู่ในทะเบียนแล้ว/);
  assert.match(rows[4].warning, /ไม่พบอีเมลนี้/);
  assert.match(rows[5].warning, /ทะเบียนมีสิทธิ์ตามที่ขออยู่แล้ว/, "from is unknown and the register already has it");
  assert.equal(rows[6].warning, "", "no register value known yet means no warning");
  assert.equal(rows[6].current, "ตรวจกับทะเบียนตอนบันทึก");
  assert.equal(rows[0].before, "อ่านอย่างเดียว (R)");
  assert.equal(rows[0].after, "อ่าน-เขียน-แก้ไข-ลบ (F)");
});

test("apply is blocked with a reason unless the request is in progress", () => {
  assert.equal(model.applyBlockedMessage(applyContext()), "");
  assert.match(model.applyBlockedMessage(applyContext({ can_apply: false, request: { status: "approved" } })), /ต้องกดรับงานก่อน/);
  assert.match(model.applyBlockedMessage(applyContext({ can_apply: false, request: { status: "awaiting_ack" } })), /บันทึกสิทธิ์ลงทะเบียนไปแล้ว/);
  assert.match(model.applyBlockedMessage(applyContext({ can_apply: false, request: { status: "pending_dept" } })), /รอผู้จัดการแผนก/);
});

test("every item needs a decision, a rejection needs a reason, and at least one item must be applied", () => {
  const ctx = applyContext({}, [ITEM({ id: "i1", line_no: 1 }), ITEM({ id: "i2", line_no: 2, target: "HR" })]);
  const state = model.initialApplyState(ctx);
  assert.deepEqual(model.applyProblems(ctx, state).map((problem) => problem.name), ["decision:i1", "decision:i2"], "nothing decided yet");
  state.decisions.i1 = { decision: "applied", reason: "" };
  state.decisions.i2 = { decision: "rejected", reason: "  " };
  assert.deepEqual(model.applyProblems(ctx, state).map((problem) => problem.name), ["decision:i2"]);
  assert.match(model.applyProblems(ctx, state)[0].message, /รายการที่ 2: กรุณาระบุเหตุผล/);
  state.decisions.i2.reason = "ซ้ำกับสิทธิ์เดิม";
  assert.deepEqual(model.applyProblems(ctx, state), []);
  state.decisions.i2.reason = "ก".repeat(501);
  assert.match(model.applyProblems(ctx, state)[0].message, /ไม่เกิน 500/);
  state.decisions.i1 = { decision: "rejected", reason: "ไม่เหมาะสม" };
  state.decisions.i2 = { decision: "rejected", reason: "ไม่เหมาะสม" };
  assert.equal(model.applyProblems(ctx, state)[0].name, "items", "rejecting everything means cancelling the request instead");
  assert.deepEqual(plain(model.applyCounts(ctx, state)), { applied: 0, rejected: 2, undecided: 0, total: 2 });
});

test("apply params send only what the request needs: decisions, the chosen register user, or the new user", () => {
  const ctx = applyContext({}, [ITEM({ id: "i1", line_no: 1 }), ITEM({ id: "i2", line_no: 2, target: "HR" })]);
  const state = model.initialApplyState(ctx);
  state.decisions.i1 = { decision: "applied", reason: "ignored" };
  state.decisions.i2 = { decision: "rejected", reason: " ซ้ำ " };
  assert.deepEqual(plain(model.applyParams(ctx, state)), { p_request_id: "r1", p_decisions: [{ item_id: "i1", decision: "applied" }, { item_id: "i2", decision: "rejected", reason: "ซ้ำ" }] });
  // เปลี่ยน/ยกเลิกที่ยังไม่ผูกทะเบียน → p_user_id (+ ผูกพนักงานเมื่อผู้ใช้ทะเบียนยังไม่ผูก และ IT ติ๊ก)
  const choose = applyContext({ needs_user_choice: true, suggested_users: [{ id: "u9", auth_id: "somchai.k", name_th: "สมชาย", status: "active", employee_id: null }, { id: "u8", auth_id: "old", status: "resigned" }] });
  const chooseState = model.initialApplyState(choose);
  chooseState.decisions.i1 = { decision: "applied" };
  assert.equal(model.applyProblems(choose, chooseState, model.userCandidates(choose))[0].name, "user");
  chooseState.userId = "u8";
  assert.match(model.applyProblems(choose, chooseState, model.userCandidates(choose))[0].message, /ลาออกแล้ว/);
  chooseState.userId = "u9";
  chooseState.link = true;
  const candidates = model.userCandidates(choose);
  assert.deepEqual(model.applyProblems(choose, chooseState, candidates), []);
  assert.equal(model.canLinkEmployee(choose, chooseState, candidates), true);
  assert.deepEqual(plain(model.applyParams(choose, chooseState, candidates)), { p_request_id: "r1", p_decisions: [{ item_id: "i1", decision: "applied" }], p_user_id: "u9", p_link_employee: true });
  // ผู้รับสิทธิ์ไม่มีบัญชีพนักงาน หรือผู้ใช้ทะเบียนผูกพนักงานอยู่แล้ว = ไม่ส่ง p_link_employee ต่อให้ state.link ค้างอยู่
  assert.equal(model.canLinkEmployee(applyContext({ needs_user_choice: true, request: { ...choose.request, subject_employee_id: null } }), chooseState, candidates), false);
  assert.equal("p_link_employee" in model.applyParams(choose, chooseState, [{ id: "u9", linked: true, active: true }]), false);
  // ขอใหม่ → p_new_user
  const fresh = applyContext({ needs_new_user: true, request: { ...choose.request, request_type: "new", subject_user_id: null } });
  const freshState = model.initialApplyState(fresh);
  freshState.decisions.i1 = { decision: "applied" };
  assert.equal(model.applyProblems(fresh, freshState)[0].name, "auth_id");
  freshState.newUser.auth_id = "Bad Name!";
  assert.match(model.applyProblems(fresh, freshState)[0].message, /ตัวอักษรอังกฤษ/);
  freshState.newUser.auth_id = " Somchai.K ";
  assert.deepEqual(model.applyProblems(fresh, freshState), []);
  assert.deepEqual(plain(model.applyParams(fresh, freshState).p_new_user), { auth_id: "somchai.k", name_th: "สมชาย ใจดี", name_en: "Somchai" }, "names come from the request unless IT changes them");
  assert.ok(!("p_user_id" in model.applyParams(fresh, freshState)));
});

test("revoke-all sends no decisions and the confirmation says everything that will be removed", () => {
  const rights = { status: "active", internet: true, folders: [{ code: "ACC", name: "บัญชี", level: "R" }], programs: [], emails: [{ address: "a@mnp.test", kind: "internal" }] };
  const ctx = applyContext({ subject_rights: rights, request: { id: "r1", doc_no: "IT08-01-26/002", request_type: "revoke_all", status: "in_progress", subject_name_th: "สมชาย" } }, []);
  const state = model.initialApplyState(ctx);
  assert.deepEqual(model.applyProblems(ctx, state), []);
  assert.deepEqual(plain(model.applyParams(ctx, state)), { p_request_id: "r1", p_decisions: [] });
  const message = model.applyConfirmMessage(ctx, state);
  assert.match(message, /จะถอดสิทธิ์ทั้งหมด: โฟลเดอร์ 1 · อีเมล 1 · อินเทอร์เน็ต/);
  assert.match(message, /ลาออก/);
  assert.match(message, /จบงานทันที/);
  const normal = applyContext();
  const normalState = model.initialApplyState(normal);
  normalState.decisions.i1 = { decision: "applied" };
  assert.match(model.applyConfirmMessage(normal, normalState), /บันทึกลงทะเบียน 1 รายการ/);
  assert.match(model.applyConfirmMessage(normal, normalState), /ยกเลิกใบหลังบันทึกไม่ได้/);
});

test("after a stale register (40001) the decisions already made are kept for the items still in the request", () => {
  const ctx = applyContext({}, [ITEM({ id: "i1", line_no: 1 }), ITEM({ id: "i2", line_no: 2 })]);
  const state = model.initialApplyState(ctx);
  state.decisions.i1 = { decision: "applied", reason: "" };
  state.decisions.gone = { decision: "rejected", reason: "x" };
  state.userId = "u9";
  state.newUser.auth_id = "typed";
  const fresh = model.carryApplyState(state, applyContext({}, [ITEM({ id: "i1", line_no: 1 })]));
  assert.deepEqual(Object.keys(fresh.decisions), ["i1"]);
  assert.equal(fresh.userId, "u9");
  assert.equal(fresh.newUser.auth_id, "typed");
  assert.match(model.staleApplyMessage({ code: "40001", message: "โฟลเดอร์ ACC: ค่าเดิมไม่ตรงกับทะเบียน" }), /^โฟลเดอร์ ACC: ค่าเดิมไม่ตรงกับทะเบียน \(โหลดข้อมูลทะเบียนล่าสุดให้แล้ว/);
  assert.match(model.staleApplyMessage({ code: "40001", message: "stale" }), /^ข้อมูลในทะเบียนสิทธิ์เปลี่ยนไปแล้ว/);
});

/* ---------- ปรับสิทธิ์ตามใบ (หน้า) ---------- */
test("the apply page has one decision per item, hides the reason until needed, escapes names, and has no password field", () => {
  const ctx = applyContext({}, [ITEM({ id: "i1", line_no: 1, note: null }), ITEM({ id: "i2", line_no: 2, target: "HR", target_name: "<b>บุคคล</b>", current_value: "F" })]);
  const state = model.initialApplyState(ctx);
  state.decisions.i2 = { decision: "rejected", reason: "ซ้ำ" };
  const html = pages.applyForm({ ctx, state, candidates: [] });
  assert.match(html, /id="itar-apply-form"/);
  assert.equal((html.match(/name="decision:i\d"/g) ?? []).length, 4, "two radios per item");
  assert.match(html, /data-reason-for="i1" hidden/);
  assert.doesNotMatch(html, /data-reason-for="i2" hidden/, "a rejected item shows its reason");
  assert.match(html, /&lt;b&gt;บุคคล&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>บุคคล/);
  assert.match(html, /id="itar-apply-all"/);
  assert.match(html, /ไม่ตรงกับที่ผู้ยื่นเห็น/, "the stale row carries its warning");
  assert.match(html, /บันทึกลงทะเบียน<\/button>/);
  assert.doesNotMatch(html, /type="password"|รหัสผ่าน|password/i);
  assert.doesNotMatch(html, /id="itar-user-choices"|id="itar-new-auth"/, "linked change needs neither a user pick nor a new user");
});

test("the apply page asks for a register user, or a new Auth. Name, only when the request needs one", () => {
  const choose = applyContext({ needs_user_choice: true, suggested_users: [{ id: "u9", auth_id: "somchai.k", name_th: "สมชาย", department_code: "ACC", status: "active", employee_id: null }, { id: "u8", auth_id: "old.user", status: "resigned" }] });
  const state = model.initialApplyState(choose);
  const html = pages.applyForm({ ctx: choose, state, candidates: model.userCandidates(choose) });
  assert.match(html, /id="itar-user-choices"/);
  assert.match(html, /<input type="radio" name="user_id" value="u9"/);
  assert.match(html, /name="user_id" value="u8" disabled/, "a resigned user cannot be picked");
  assert.match(html, /id="itar-user-search"/);
  assert.match(html, /id="itar-link-box" hidden/, "the link choice appears once an unlinked user is picked");
  state.userId = "u9";
  assert.doesNotMatch(pages.applyForm({ ctx: choose, state, candidates: model.userCandidates(choose) }), /id="itar-link-box" hidden/);
  const fresh = applyContext({ needs_new_user: true, request: { ...choose.request, request_type: "new", subject_user_id: null } });
  const newHtml = pages.applyForm({ ctx: fresh, state: model.initialApplyState(fresh) });
  assert.match(newHtml, /id="itar-new-auth"/);
  assert.match(newHtml, /value="สมชาย ใจดี"/, "the name is filled from the request");
});

test("revoke-all apply page lists what will be removed instead of per-item decisions; a blocked request has no form", () => {
  const rights = { status: "active", internet: true, folders: [{ code: "ACC", name: "บัญชี", level: "R" }], programs: [], emails: [] };
  const ctx = applyContext({ subject_rights: rights, request: { id: "r1", doc_no: "IT08-01-26/002", request_type: "revoke_all", status: "in_progress", reason: "ลาออก", subject_name_th: "สมชาย" } }, []);
  const html = pages.applyForm({ ctx, state: model.initialApplyState(ctx) });
  assert.match(visibleText(html), /จะถอดสิทธิ์ทั้งหมด: โฟลเดอร์ 1 · อินเทอร์เน็ต/);
  assert.doesNotMatch(html, /name="decision:/);
  assert.match(html, /id="itar-apply-form"/);
  const blocked = pages.applyForm({ ctx: applyContext({ can_apply: false, request: { id: "r1", status: "approved" } }), state: model.initialApplyState(ctx) });
  assert.doesNotMatch(blocked, /id="itar-apply-form"/);
  assert.match(blocked, /ต้องกดรับงานก่อน/);
});

/* ---------- รับทราบ / กระดาษ ---------- */
test("acknowledge shows the rights after the change (the snapshot first) and the policy text from the database", () => {
  const detail = { applied_summary: { after: { internet: true, folders: [] } }, subject_rights: { internet: false }, policy: { version: "IT08-01/1", text: "นโยบายจากฐานข้อมูล" } };
  assert.equal(model.rightsAfter(detail).internet, true, "the snapshot taken when IT recorded it wins over the register now");
  assert.equal(model.rightsAfter({ subject_rights: { internet: false } }).internet, false);
  assert.equal(model.rightsAfter({}), null);
  assert.deepEqual(plain(model.policyOf(detail)), { version: "IT08-01/1", text: "นโยบายจากฐานข้อมูล" });
  assert.match(model.policyOf({}).text, /ผู้ใช้รับทราบและต้องปฏิบัติตามนโยบายการใช้งานระบบเครือข่ายและคอมพิวเตอร์/);
});

test("paper acknowledgement needs at least one signed photo and an optional short note", () => {
  assert.match(model.paperAckProblem({ paper_attachments: [] }, ""), /แนบรูปใบรับทราบที่เซ็นแล้วอย่างน้อย 1 ไฟล์/);
  assert.equal(model.paperAckProblem({ paper_attachments: [{ id: "p1" }] }, "ok"), "");
  assert.match(model.paperAckProblem({ paper_attachments: [{ id: "p1" }] }, "ก".repeat(301)), /ไม่เกิน 300/);
  assert.deepEqual(plain(model.paperAckParams("r1", "  ")), { p_request_id: "r1" });
  assert.deepEqual(plain(model.paperAckParams("r1", " เซ็นแล้ว ")), { p_request_id: "r1", p_note: "เซ็นแล้ว" });
  assert.match(model.describeUploadError({ statusCode: "403" }, { paper: true }).message, /รอผู้ใช้รับทราบ/);
  assert.doesNotMatch(model.describeUploadError({ statusCode: "403" }, { paper: true }).message, /30 นาที/, "paper photos have no 30-minute window");
});

const DETAIL = (overrides = {}) => ({
  id: "2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10", doc_no: "IT08-01-26/001", status: "awaiting_ack", request_type: "change", reason: "ย้ายแผนก <script>x</script>", created_at: "2026-11-28T01:00:00Z",
  requester: { employee_no: "AC100", full_name: "มาลี ยื่น" }, department: { code: "ACC", name_th: "บัญชี" },
  subject: { employee_no: "AC200", name_th: "สมชาย ใจดี", name_en: "Somchai", department_code: "ACC", division: "office", has_account: true },
  items: [ITEM({ result: { decision: "applied", reason: null, at: "t" } }), ITEM({ id: "i2", line_no: 2, target: "HR", target_name: "บุคคล", result: { decision: "rejected", reason: "ซ้ำกับสิทธิ์เดิม", at: "t" } })],
  approvals: { dept: { by: "หัวหน้า แผนก", at: "2026-11-28T02:00:00Z" }, it_mgr: { by: "ผู้อนุมัติ ไอที", at: "2026-11-28T03:00:00Z" } },
  events: [{ id: 1, action: "created", created_at: "2026-11-28T01:00:00Z", actor_full_name: "มาลี ยื่น", actor_employee_no: "AC100" }],
  applied: { by: "ไอที ผู้ดูแล", at: "2026-11-28T04:00:00Z" }, acknowledged: null, policy: { version: "IT08-01/1", text: "ผู้ใช้รับทราบและต้องปฏิบัติตามนโยบายการใช้งานระบบเครือข่ายและคอมพิวเตอร์" },
  applied_summary: { applied_count: 1, rejected_count: 1, before: {}, after: { auth_id: "somchai.k", internet: true, folders: [{ code: "ACC", name: "บัญชี", level: "F", is_active: true }], programs: [{ code: "IPRIME", name: "iPrime", note: null }], emails: [{ address: "somchai@mnp.test", kind: "internal" }] } },
  subject_rights: null, attachments: [], paper_attachments: [], comments: [], info_pending: null, allowed_actions: [], ...overrides,
});

test("the acknowledge card shows the rights, the policy and one button, only when allowed_actions says so", () => {
  const html = pages.detailPage(DETAIL({ allowed_actions: ["acknowledge"] }));
  assert.match(html, /id="itar-ack-card"/);
  assert.match(html, /id="itar-ack-button"/);
  assert.match(visibleText(html), /ผู้ใช้รับทราบและต้องปฏิบัติตามนโยบายการใช้งานระบบเครือข่ายและคอมพิวเตอร์/);
  assert.match(html, /นโยบายเวอร์ชัน IT08-01\/1/);
  assert.match(html, /<strong>ACC<\/strong> บัญชี/, "the rights after the change are listed");
  assert.doesNotMatch(html, /data-itar-action="acknowledge"/, "the card has its own button");
  assert.doesNotMatch(pages.detailPage(DETAIL({ allowed_actions: [] })), /itar-ack-card|itar-paper-card/);
});

test("the paper card follows allowed_actions, not has_account: attach and acknowledge, the acknowledge button locked until a photo is attached", () => {
  const none = pages.detailPage(DETAIL({ allowed_actions: ["acknowledge_paper", "add_paper_attachment"], subject: { ...DETAIL().subject, has_account: true } }));
  assert.match(none, /id="itar-paper-card"/, "a closed account that still has_account is decided by allowed_actions");
  assert.match(none, /id="itar-paper-files"/);
  assert.match(none, /id="itar-paper-ack" disabled/);
  assert.match(none, /ยังไม่ได้แนบรูปใบที่เซ็น/);
  const withFile = pages.detailPage(DETAIL({ allowed_actions: ["acknowledge_paper", "add_paper_attachment"], paper_attachments: [{ id: "p1", file_name: "signed.jpg", mime_type: "image/jpeg", size_bytes: 10, storage_path: "p", bucket: "itar-files" }] }));
  assert.doesNotMatch(withFile, /id="itar-paper-ack" disabled/);
  assert.match(withFile, /แนบแล้ว 1 ไฟล์/);
  assert.match(withFile, /รูปใบรับทราบที่เซ็นแล้ว/);
  const onlyAttach = pages.detailPage(DETAIL({ allowed_actions: ["add_paper_attachment"] }));
  assert.match(onlyAttach, /id="itar-paper-form"/);
  assert.doesNotMatch(onlyAttach, /id="itar-paper-ack"/);
});

test("the apply button appears only with the apply action, and the print buttons follow what exists", () => {
  const html = pages.detailPage(DETAIL({ status: "in_progress", applied: null, applied_summary: null, allowed_actions: ["apply", "cancel"] }));
  assert.deepEqual([...html.matchAll(/data-itar-action="([a-z_]+)"/g)].map((match) => match[1]), ["apply", "cancel"]);
  assert.match(html, /id="itar-print-req"/);
  assert.doesNotMatch(html, /id="itar-print-page"/, "no rights document before IT records the rights");
  const done = pages.detailPage(DETAIL());
  assert.match(done, /id="itar-print-page"[^>]*href="#\/office\?module=access-request&amp;view=print&amp;id=[0-9a-f-]+&amp;form=page"/);
  assert.doesNotMatch(pages.detailPage(DETAIL({ request_type: "revoke_all", items: [] })), /id="itar-print-page"/);
});

/* ---------- ใบพิมพ์ ---------- */
test("the request form (USER-REQ) shows who, what, before to after, the IT result, four signatures with time, and escapes everything", () => {
  const html = pages.printRequestSheet(DETAIL({ comments: [{ id: 1, kind: "question", stage: "dept", body: "ทำไมต้อง <i>ขอ</i>", created_at: "2026-11-28T01:30:00Z", author_full_name: "หัวหน้า แผนก", attachments: [] }] }));
  const text = visibleText(html);
  assert.match(html, /itrp-sheet itar-sheet/);
  assert.match(text, /ใบขอสิทธิ์การใช้งานระบบคอมพิวเตอร์/);
  assert.match(html, /<strong>IT08-01-26\/001<\/strong>/, "the document number box");
  assert.doesNotMatch(text, /IT01-FM08|FM01-08|USER-REQ/, "no form code on the paper");
  assert.match(text, /ผู้ยื่นใบขอ มาลี ยื่น/);
  assert.match(text, /ผู้รับสิทธิ์ สมชาย ใจดี \(Somchai\)/);
  assert.match(text, /● เปลี่ยนแปลง/);
  assert.match(text, /○ ขอใหม่/);
  assert.match(html, /ย้ายแผนก &lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x|<i>ขอ/);
  assert.match(text, /อ่านอย่างเดียว \(R\)/);
  assert.match(text, /อ่าน-เขียน-แก้ไข-ลบ \(F\)/);
  assert.match(text, /บันทึกแล้ว/);
  assert.match(text, /ไม่บันทึก ซ้ำกับสิทธิ์เดิม/);
  for (const slot of ["requester", "dept", "it_mgr", "applied"]) assert.match(html, new RegExp(`data-slot="${slot}"`));
  assert.match(text, /หัวหน้า แผนก 28\/11\/2569 09:00/, "the department manager's name and Bangkok time");
  assert.match(text, /ไอที ผู้ดูแล 28\/11\/2569 11:00/);
  assert.match(text, /ประวัติถาม-ตอบ \(ย่อ\)/);
  assert.match(html, /ทำไมต้อง &lt;i&gt;ขอ&lt;\/i&gt;/);
});

test("the request form of a waiting request leaves the signature boxes empty, and a test request is watermarked", () => {
  const html = pages.printRequestSheet(DETAIL({ doc_no: "TEST-IT08-01-26/001", status: "pending_dept", approvals: { dept: null, it_mgr: null }, applied: null, applied_summary: null, items: [ITEM()] }));
  assert.match(html, /itrp-watermark/);
  assert.match(html, /ใบทดสอบ — ไม่ใช่เอกสารจริง/);
  assert.match(html, /<div class="itrp-sign" data-slot="dept">\s*<div class="itrp-sign-label">[^<]*<\/div>\s*<div class="itrp-sign-name"><\/div>/);
  assert.doesNotMatch(html, /ผลที่ IT บันทึก/, "no result column before IT decides");
  const revoke = pages.printRequestSheet(DETAIL({ request_type: "revoke_all", items: [], applied_summary: null, subject_rights: { folders: [{ code: "ACC", name: "บัญชี", level: "R" }], internet: false, programs: [], emails: [] } }));
  assert.match(visibleText(revoke), /จะถอดสิทธิ์ทั้งหมด: โฟลเดอร์ 1/);
});

test("the rights document (USER-Page) lists every right after the change, the policy, and signatures: online, paper left for a pen, or waiting", () => {
  const waiting = pages.printRightsSheet(DETAIL());
  const text = visibleText(waiting);
  assert.match(text, /เอกสารชี้แจงสิทธิ์การใช้งานระบบคอมพิวเตอร์/);
  assert.match(text, /Auth\. Name somchai\.k/);
  assert.match(text, /ACC บัญชี F/);
  assert.match(text, /อินเทอร์เน็ต มีสิทธิ์/);
  assert.match(text, /โปรแกรม iPrime/);
  assert.match(text, /อีเมล somchai@mnp\.test \(อีเมลภายในบริษัท\)/);
  assert.match(text, /นโยบาย \(IT08-01\/1\) ผู้ใช้รับทราบและต้องปฏิบัติตามนโยบายการใช้งานระบบเครือข่ายและคอมพิวเตอร์/);
  assert.match(waiting, /data-slot="recipient"/);
  assert.match(waiting, /\(สมชาย ใจดี \(Somchai\)\)/, "the recipient's printed name under the signing line");
  assert.match(text, /ไอที ผู้ดูแล 28\/11\/2569 11:00/);
  const online = pages.printRightsSheet(DETAIL({ status: "done", acknowledged: { by: "สมชาย ใจดี", at: "2026-11-29T01:00:00Z", method: "online" } }));
  assert.match(visibleText(online), /ผู้รับสิทธิ์ \(รับทราบ\) สมชาย ใจดี 29\/11\/2569 08:00/);
  const paper = pages.printRightsSheet(DETAIL({ status: "done", acknowledged: { by: "ไอที ผู้ดูแล", at: "2026-11-29T01:00:00Z", method: "paper" } }));
  assert.match(visibleText(paper), /รับทราบด้วยกระดาษ · IT บันทึกเมื่อ 29\/11\/2569 08:00/);
  assert.doesNotMatch(paper, /<div class="itrp-sign-name">ไอที ผู้ดูแล<\/div>\s*<div class="itrp-sign-time">29/, "IT's name is not shown as the recipient's signature");
});

test("print sheets never carry a password or secret wording, even for a request that mentions one", () => {
  for (const sheet of [pages.printRequestSheet(DETAIL()), pages.printRightsSheet(DETAIL()), pages.printPage(DETAIL(), { form: "page" }), pages.printPage(DETAIL(), { form: "req" })]) {
    assert.doesNotMatch(sheet, /password|รหัสผ่าน|secret|ช่องลับ|type="password"/i);
  }
});

test("the print page offers the other document only when it exists, and has the print button outside the paper", () => {
  const both = pages.printPage(DETAIL(), { form: "req" });
  assert.match(both, /id="itar-print-button"/);
  assert.match(both, /พิมพ์เอกสารชี้แจงสิทธิ์ \(A4\)/);
  assert.doesNotMatch(both, /พิมพ์ใบคำร้อง \(A4\)/, "the current document is not offered again");
  assert.match(both, /class="itrp-print-toolbar no-print"/);
  assert.doesNotMatch(both, /itar-dev-notice/, "the banner is not printed on the print page");
  const onlyRequest = pages.printPage(DETAIL({ applied_summary: null }), { form: "req" });
  assert.doesNotMatch(onlyRequest, /พิมพ์เอกสารชี้แจงสิทธิ์/);
});

test("the rights document exists only after IT recorded the rights, and never for revoke-all", () => {
  assert.deepEqual(model.printForms({ request_type: "change", applied_summary: null }), ["req"]);
  assert.deepEqual(model.printForms({ request_type: "change", applied_summary: { after: {} } }), ["req", "page"]);
  assert.deepEqual(model.printForms({ request_type: "revoke_all", applied_summary: { after: {} } }), ["req"]);
  assert.equal(model.resolvePrintForm({ request_type: "change", applied_summary: null }, "page"), "req", "asking for a document that does not exist gives the request form");
  assert.equal(model.resolvePrintForm({ request_type: "change", applied_summary: {} }, "page"), "page");
  assert.equal(model.resolvePrintForm({ request_type: "change", applied_summary: {} }, undefined), "req");
  assert.equal(model.printUrl("abc"), "#/office?module=access-request&view=print&id=abc");
  assert.equal(model.printUrl("abc", "page"), "#/office?module=access-request&view=print&id=abc&form=page");
  assert.equal(model.applyUrl("abc"), "#/office?module=access-request&view=apply&id=abc");
});

test("print signatures come from the history: one click counting for both steps and the paper acknowledgement are marked", () => {
  const detail = DETAIL({ events: [{ action: "created", created_at: "2026-11-28T01:05:00Z" }] });
  const sign = model.requestSignoffs(detail);
  assert.deepEqual(plain(sign.requester), { name: "มาลี ยื่น", at: "2026-11-28T01:05:00Z", remark: null });
  const single = model.requestSignoffs({ ...detail, approvals: { dept: { by: "ผู้อนุมัติ", at: "t" }, it_mgr: { by: "ผู้อนุมัติ", at: "t" } } });
  assert.equal(single.dept.remark, model.SINGLE_CLICK_REMARK);
  assert.equal(single.itMgr.remark, model.SINGLE_CLICK_REMARK);
  assert.equal(model.requestSignoffs({ ...detail, approvals: { dept: { by: "มาลี ยื่น", at: "t" }, it_mgr: null } }).dept.remark, model.SELF_APPROVED_REMARK);
  assert.equal(model.formatDateOf("2026-11-28T17:30:00Z"), "29/11/2569", "UTC evening is the next day in Bangkok");
  assert.equal(model.formatTimeOf("2026-11-28T17:30:00Z"), "00:30");
  assert.equal(model.formatDateOf(null), "");
});

/* ---------- หน้าแรก ---------- */
const homeRow = (overrides) => ({ id: "r1", doc_no: "IT08-01-26/001", status: "pending_dept", request_type: "change", subject_name: "สมชาย", requester_name: "มาลี", department_name: "บัญชี", created_at: "2026-11-28T01:00:00Z", is_requester: true, needs_my_ack: false, ...overrides });

test("home work: approvers get approvals (not the ones already asked), IT admins get start / apply / paper-ack, users get answer / acknowledge, nothing twice", () => {
  const role = { is_dept_approver: true, is_it_admin: true, is_itas_admin: true };
  const work = model.homeWork({
    role,
    approvals: [homeRow({ id: "a1" }), homeRow({ id: "a2", status: "need_info" })],
    it: [homeRow({ id: "t1", status: "approved" }), homeRow({ id: "t2", status: "in_progress" }), homeRow({ id: "t3", status: "awaiting_ack" }), homeRow({ id: "t4", status: "awaiting_ack" }), homeRow({ id: "t5", status: "pending_dept" })],
    mine: [homeRow({ id: "m1", status: "need_info", is_requester: true, info_return_status: "pending_dept" }), homeRow({ id: "m2", status: "awaiting_ack", is_requester: false, needs_my_ack: true }), homeRow({ id: "m3", status: "pending_it_mgr" }), homeRow({ id: "m4", status: "done" }), homeRow({ id: "a1" })],
    paperAckIds: ["t3"],
  });
  assert.deepEqual(work.tasks.map((task) => [task.id, task.task]), [["a1", "รออนุมัติ"], ["t1", "รับงาน"], ["t2", "บันทึกลงทะเบียน"], ["t3", "รับทราบด้วยกระดาษ"], ["m1", "รอคุณตอบ"], ["m2", "รอคุณรับทราบสิทธิ์"]]);
  assert.equal(work.tasks[0].href, "#/office?module=access-request&view=order&id=a1");
  assert.equal(work.tasks[0].typeCode, "IT_ACCESS_REQUEST");
  assert.deepEqual(work.mine.map((row) => row.id), ["m3"], "closed and already-queued requests are not listed again");
  assert.equal(work.mine[0].stages, model.HOME_STAGES);
  assert.equal(work.mine[0].progressStatus, "pending_it_mgr");
  assert.equal(work.mine[0].label, "รอผู้อนุมัติขั้น IT");
  assert.equal(work.mine[0].href, "#/office?module=access-request&view=order&id=m3");
});

test("home work: an IT admin outside the register-admin list gets no apply task, and a plain employee gets only their own", () => {
  const it = [homeRow({ id: "t1", status: "in_progress" }), homeRow({ id: "t2", status: "approved" })];
  assert.deepEqual(model.homeWork({ role: { is_it_admin: true }, it }).tasks.map((task) => task.id), ["t2"]);
  assert.deepEqual(model.homeWork({ role: {}, it, approvals: [homeRow()] }).tasks, [], "no role, no rows from other lists");
  assert.deepEqual(model.homeWork({ role: {} }).tasks, []);
  const need = model.homeWork({ role: {}, mine: [homeRow({ id: "n1", status: "need_info", is_requester: false, info_return_status: "pending_dept" })] });
  assert.deepEqual(need.tasks, [], "the subject does not answer the requester's question");
  assert.equal(need.mine[0].progressStatus, "pending_dept", "a waiting request sits at the step that asked");
});

test("the home stages are this module's own and end with waiting for acknowledgement then done", () => {
  assert.deepEqual(model.HOME_STAGES.map((stage) => stage.label), ["ยื่นใบขอสิทธิ์", "ผู้จัดการแผนก", "ผู้อนุมัติ IT", "IT ดำเนินการ", "รอรับทราบ", "จบงาน"]);
  const covered = model.HOME_STAGES.flatMap((stage) => stage.statuses);
  for (const status of ["pending_dept", "pending_it_mgr", "approved", "in_progress", "awaiting_ack", "done"]) assert.ok(covered.includes(status), status);
  assert.equal(model.homeProgressStatus({ status: "need_info", info_stage: "it" }), "in_progress");
  assert.equal(model.homeProgressStatus({ status: "awaiting_ack" }), "awaiting_ack");
});

/* ---------- ส่วนโมดูล (อ่านโค้ด) ---------- */
const migration = read("supabase/migrations/20270107010000_itar_access_requests.sql");
const moduleSource = read("modules/module-itar.js");
function signatureOf(name) {
  const start = migration.indexOf(`function public.${name}(`);
  return start < 0 ? null : migration.slice(start, migration.indexOf("returns", start));
}

test("the new RPC calls exist in the migration with the parameter names the page sends", () => {
  for (const name of ["app_itar_apply_context", "app_itar_apply", "app_itar_add_paper_attachment", "app_itar_search_subjects", "app_itar_get_detail"]) {
    assert.ok(signatureOf(name), `${name} is defined`);
    assert.ok(moduleSource.includes(name), `${name} is used by the module`);
  }
  // รับทราบ 2 แบบเรียกผ่านสเปกของปุ่ม (spec.rpc) ที่ model กำหนด
  assert.ok(moduleSource.includes("rpc(spec.rpc, { p_request_id: detail.id })") && moduleSource.includes("rpc(spec.rpc, model.paperAckParams(detail.id, note))"));
  const ctx = applyContext({ needs_user_choice: true, needs_new_user: true }, [ITEM({})]);
  const state = model.initialApplyState(ctx);
  state.decisions.i1 = { decision: "applied" };
  state.userId = "u1";
  state.newUser.auth_id = "x";
  state.link = true;
  const params = model.applyParams(ctx, state, [{ id: "u1", linked: false, active: true }]);
  for (const key of Object.keys(params)) assert.ok(signatureOf("app_itar_apply").includes(key), `app_itar_apply takes ${key}`);
  assert.ok(Object.keys(params).includes("p_link_employee"));
  for (const key of Object.keys(model.paperAckParams("r", "note"))) assert.ok(signatureOf("app_itar_acknowledge_paper").includes(key), `app_itar_acknowledge_paper takes ${key}`);
  for (const key of ["p_request_id", "p_storage_path", "p_file_name", "p_mime_type", "p_size_bytes"]) assert.ok(signatureOf("app_itar_add_paper_attachment").includes(key), key);
  assert.ok(signatureOf("app_itar_acknowledge").includes("p_request_id"));
  for (const action of ["apply", "acknowledge", "acknowledge_paper", "add_paper_attachment"]) assert.ok(signatureOf(model.ACTION_BUTTONS[action].rpc), `${action} -> ${model.ACTION_BUTTONS[action].rpc}`);
});

test("the module registers its home work under the card's code, handles apply and print routes, and never sends a password", () => {
  assert.match(moduleSource, /\(window\.MNP_OFFICE_HOME \?\?= \{\}\)\.IT_ACCESS_REQUEST = \{ label: "ใบขอสิทธิ์ IT", load: loadHome \};/);
  assert.match(moduleSource, /if \(view === "apply"\) return await renderApply\(params\.get\("id"\), role, version\);/);
  assert.match(moduleSource, /if \(view === "print"\) return await renderPrint\(params\.get\("id"\), params\.get\("form"\), version\);/);
  assert.match(moduleSource, /view === "apply" && model\.isUuid\(id\) \? model\.accessUrl\("order", \{ id \}\)/, "a non-register-admin is sent back to the request page");
  assert.match(moduleSource, /if \(spec\.opens === "apply"\) \{ navigate\(model\.applyUrl\(detail\.id\)\); return; \}/);
  // รายละเอียดใบรอรับทราบ: อ่านไม่ได้/ไม่ทันกรอบเวลา = ข้ามใบนั้น ไม่ทำให้ทั้งหน้าแรกล้ม · กรอบเวลาของตัวเองต้องสั้นกว่ากรอบ 3 วิของ office-home.js
  assert.match(moduleSource, /Promise\.race\(\[rpc\("app_itar_get_detail", \{ p_request_id: row\.id \}\)\.catch\(\(\) => null\), deadline\]\)/, "a detail that cannot be read in time does not break the home page");
  const paperLimit = Number(/const HOME_PAPER_CHECK_MS = (\d+);/.exec(moduleSource)?.[1]);
  const homeLimit = Number(/const LOAD_TIMEOUT_MS = (\d+);/.exec(read("modules/office-home.js"))?.[1]);
  assert.ok(paperLimit > 0 && paperLimit < homeLimit, "paper-ack detail reads have their own time limit below the office home limit");
  assert.match(moduleSource, /model\.isStaleRights\(error\)[\s\S]{0,400}app_itar_apply_context/, "40001 reloads the context");
  for (const file of ["modules/module-itar.js", "modules/itar-pages.js", "modules/itar-model.js"]) {
    assert.doesNotMatch(read(file), /type="password"|service_role|secret key|sb_secret|eyJ[A-Za-z0-9_-]{20}/i, `${file} has no password field or key`);
  }
});

test("office-home.js is untouched by this module: it keeps its own stages and the work-order and repair modules still build with them", () => {
  const rules = globalThis.MNP_OFFICE_HOME_RULES ?? (require("../../modules/office-home.js"), globalThis.MNP_OFFICE_HOME_RULES);
  assert.deepEqual(rules.PROGRESS_STAGES.map((stage) => stage.label), ["แจ้งงาน", "ผู้จัดการแผนก", "ผู้อนุมัติ IT", "IT ดำเนินการ", "รอยืนยัน", "จบงาน"]);
  // แถว mine ที่โมดูลนี้ส่งมาวาดผ่านตัวเดียวกับของโมดูลอื่น (mineRowHtml ใช้ stages ของแถว)
  const work = model.homeWork({ role: {}, mine: [homeRow({ id: "m3", status: "awaiting_ack" })] });
  const html = rules.mineRowHtml(work.mine[0], {
    escapeHtml: (value) => String(value), requestTypeIcon: () => "", requestPalette: () => "it",
    progressTracker: (status, repair, options) => `${status}|${options.stages.map((stage) => stage.label).join(",")}|${options.label}`,
  });
  assert.match(html, /awaiting_ack\|ยื่นใบขอสิทธิ์,ผู้จัดการแผนก,ผู้อนุมัติ IT,IT ดำเนินการ,รอรับทราบ,จบงาน\|รอผู้ใช้รับทราบ/);
  assert.match(html, /IT08-01-26\/001/);
});
