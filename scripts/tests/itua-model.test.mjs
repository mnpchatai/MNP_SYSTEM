import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// modules/itua-model.js (ทะเบียนสิทธิ์ผู้ใช้: เส้นทาง กรอง ตรวจฟอร์ม ประกอบพารามิเตอร์ RPC ประวัติ พิมพ์/CSV error) · ข้อมูลทั้งหมดเป็นของปลอม
const require = createRequire(import.meta.url);
const model = require("../../modules/itua-model.js");
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

const ID = "11111111-1111-4111-8111-111111111111";
const STAMP = "2026-11-26T05:12:33.123456+00:00";
const params = (query) => new URLSearchParams(query);

/* ---------- เส้นทาง ---------- */
test("readRoute: list by default, matrix/catalog by view, a user by uuid, anything odd is not found", () => {
  assert.deepEqual(model.readRoute(params("module=access")), { view: "list" });
  assert.deepEqual(model.readRoute(params("module=access&view=matrix")), { view: "matrix" });
  assert.deepEqual(model.readRoute(params("module=access&view=catalog")), { view: "catalog" });
  assert.deepEqual(model.readRoute(params(`module=access&user=${ID.toUpperCase()}`)), { view: "user", id: ID });
  for (const query of ["view=other", "user=not-a-uuid", `user=${ID}&view=matrix`, "user="]) {
    const route = model.readRoute(params(`module=access&${query}`));
    // user= ว่างเท่ากับไม่ได้ระบุ (ไปหน้ารายการ) ส่วนที่เหลือต้องไม่พบหน้า
    assert.deepEqual(route, query === "user=" ? { view: "list" } : null, query);
  }
});

test("urls are in the office route, and the tabs link to the three list pages", () => {
  assert.equal(model.listUrl(), "#/office?module=access");
  assert.equal(model.matrixUrl(), "#/office?module=access&view=matrix");
  assert.equal(model.catalogUrl(), "#/office?module=access&view=catalog");
  assert.equal(model.userUrl(ID), `#/office?module=access&user=${ID}`);
  assert.deepEqual(model.TABS.map((tab) => tab.view), ["list", "matrix", "catalog"]);
});

test("module facts: version 1.xx, in development, its own module code, no secret fields anywhere in the user form", () => {
  assert.match(model.MODULE_VERSION, /^\d+\.\d{2}$/);
  assert.equal(model.IN_DEVELOPMENT, true);
  assert.equal(model.ACCESS_CODE, "IT_USER_ACCESS");
  assert.ok(model.USER_FIELDS.every((field) => !/pass|secret|license|cipher/i.test(field.key + field.label)));
  assert.deepEqual(model.USER_FIELDS.map((field) => field.key), ["auth_id", "name_th", "name_en", "department_code", "division", "granted_doc_no", "granted_on", "note"], "internet and status change only through set_grants / set_status");
});

/* ---------- วันที่ ---------- */
test("dates read in Buddhist or Gregorian years, Thai digits, and show as dd/mm/yyyy in Buddhist years", () => {
  assert.equal(model.parseDateInput("05/03/2569"), "2026-03-05");
  assert.equal(model.parseDateInput("05/03/2026"), "2026-03-05");
  assert.equal(model.parseDateInput("๐๕-๐๓-๒๕๖๙"), "2026-03-05");
  assert.equal(model.parseDateInput("05032569"), "2026-03-05");
  assert.equal(model.parseDateInput("2026-03-05"), "2026-03-05");
  assert.equal(model.parseDateInput("31/02/2569"), null);
  assert.equal(model.parseDateInput("abc"), null);
  assert.equal(model.formatDate("2026-03-05"), "05/03/2569");
  assert.equal(model.formatDate(""), "—");
  assert.equal(model.formatDateTime("2026-11-26T17:30:00Z"), "27/11/2569 00:30", "Asia/Bangkok");
  assert.equal(model.dateInputText("2026-03-05"), "05/03/2569");
});

/* ---------- รายการ / กรอง ---------- */
const ROWS = [
  { id: "u1", auth_id: "somchai.k", name_th: "สมชาย ใจดี", name_en: "Somchai Jaidee", department_code: "ACC", division: "office", internet: true, status: "active", folder_r: 3, folder_f: 2, internal_email: "somchai@mnp.test" },
  { id: "u2", auth_id: "mali.p", name_th: "", name_en: "Mali P", department_code: "IT", division: "factory", internet: false, status: "active", folder_r: 0, folder_f: 0, internal_email: null },
  { id: "u3", auth_id: "old.user", name_th: "คนเก่า", name_en: "", department_code: "ACC", division: "office", internet: false, status: "resigned", folder_r: 1, folder_f: 0, internal_email: null },
];

test("filterUsers searches id, names, department and internal email (any case) and combines with the three filters", () => {
  const ids = (filters) => model.filterUsers(ROWS, filters).map((row) => row.id);
  assert.deepEqual(ids({}), ["u1", "u2", "u3"]);
  assert.deepEqual(ids({ query: "SOMCHAI" }), ["u1"]);
  assert.deepEqual(ids({ query: "ใจดี" }), ["u1"]);
  assert.deepEqual(ids({ query: "@mnp.test" }), ["u1"]);
  assert.deepEqual(ids({ query: "acc" }), ["u1", "u3"]);
  assert.deepEqual(ids({ department: "ACC" }), ["u1", "u3"]);
  assert.deepEqual(ids({ division: "factory" }), ["u2"]);
  assert.deepEqual(ids({ status: "resigned" }), ["u3"]);
  assert.deepEqual(ids({ department: "ACC", status: "active" }), ["u1"]);
  assert.deepEqual(ids({ query: "zzz" }), []);
  assert.deepEqual(model.filterUsers(null, {}), []);
});

test("small list helpers: names, department options, counts, folder summary", () => {
  assert.equal(model.userName(ROWS[0]), "สมชาย ใจดี");
  assert.equal(model.userName(ROWS[1]), "Mali P", "falls back to the English name");
  assert.equal(model.userSubName(ROWS[0]), "Somchai Jaidee");
  assert.equal(model.userSubName(ROWS[1]), "");
  assert.deepEqual(model.departmentOptions(ROWS), ["ACC", "IT"]);
  assert.equal(model.countText(3, 3), "3 คน");
  assert.equal(model.countText(1, 3), "แสดง 1 จาก 3 คน");
  assert.equal(model.folderSummaryText(ROWS[0]), "R 3 · F 2");
  assert.equal(model.folderSummaryText(ROWS[1]), "");
  assert.deepEqual(model.levelCounts({ A: "R", B: "F", C: "R", D: "x" }), { R: 2, F: 1 });
  assert.equal(model.levelOf({ levels: { A: "F" } }, "A"), "F");
  assert.equal(model.levelOf({ levels: { A: "F" } }, "B"), "");
});

/* ---------- ฟอร์มผู้ใช้ ---------- */
const USER = { id: ID, auth_id: "somchai.k", name_th: "สมชาย ใจดี", name_en: "Somchai", department_code: "ACC", division: "office", granted_doc_no: "IT08-01-26/001", granted_on: "2026-01-05", note: null, updated_at: STAMP, status: "active", internet: false };

test("validateUser: Auth. Name format, a name in one language, a division, dates and lengths", () => {
  const ok = { ...model.emptyUserValues(), auth_id: "A.B-1", name_en: "A B", division: "office" };
  assert.deepEqual(model.validateUser(ok), []);
  const fields = (values) => model.validateUser({ ...ok, ...values }).map((item) => item.field);
  assert.deepEqual(fields({ auth_id: "" }), ["auth_id"]);
  assert.deepEqual(fields({ auth_id: "bad name" }), ["auth_id"]);
  assert.deepEqual(fields({ auth_id: ".x" }), ["auth_id"]);
  assert.deepEqual(fields({ name_en: "", name_th: "" }), ["name_th"]);
  assert.deepEqual(fields({ division: "" }), ["division"]);
  assert.deepEqual(fields({ division: "other" }), ["division"]);
  assert.deepEqual(fields({ granted_on: "31/02/2569" }), ["granted_on"]);
  assert.deepEqual(fields({ granted_on: "01/01/1980" }), ["granted_on"]);
  assert.deepEqual(fields({ note: "x".repeat(2001) }), ["note"]);
  assert.deepEqual(fields({ auth_id: "a".repeat(61) }), ["auth_id"], "one message for an over-long id, not two");
});

test("buildUserPayload (edit): only changed fields, normalised, with expected_updated_at and the reason", () => {
  const values = { ...model.userValuesFromUser(USER), name_th: "  สมชาย ใหม่ ", auth_id: "SOMCHAI.K", department_code: "it", note: "ย้ายแผนก" };
  const payload = model.buildUserPayload({ original: USER, values, reason: " ย้ายแผนก " });
  assert.deepEqual(payload, { p_id: ID, p_data: { name_th: "สมชาย ใหม่", department_code: "IT", note: "ย้ายแผนก" }, p_reason: "ย้ายแผนก", p_expected_updated_at: STAMP });
  // ไม่เปลี่ยนอะไร (วันที่ที่แสดงเป็น พ.ศ. แล้วอ่านกลับต้องเท่าเดิม)
  const same = model.buildUserPayload({ original: USER, values: model.userValuesFromUser(USER), reason: "" });
  assert.equal(model.payloadIsEmpty(same), true);
  // ล้างช่องที่เคยมีค่า = null
  const cleared = model.buildUserPayload({ original: USER, values: { ...model.userValuesFromUser(USER), name_en: "", granted_on: "" }, reason: "ล้าง" });
  assert.deepEqual(cleared.p_data, { name_en: null, granted_on: null });
  // เปลี่ยนวันที่ (ปี พ.ศ.) ส่งเป็น ค.ศ.
  assert.deepEqual(model.buildUserPayload({ original: USER, values: { ...model.userValuesFromUser(USER), granted_on: "06/01/2569" }, reason: "x" }).p_data, { granted_on: "2026-01-06" });
});

test("buildUserPayload (add): every filled field, the draft id, no reason and no expected_updated_at", () => {
  const values = { ...model.emptyUserValues(), auth_id: "New.User", name_th: "ใหม่", division: "factory", department_code: "pp" };
  assert.deepEqual(model.buildUserPayload({ values, userId: ID }), { p_id: ID, p_data: { auth_id: "new.user", name_th: "ใหม่", department_code: "PP", division: "factory" }, p_reason: null, p_expected_updated_at: null });
});

test("reasonProblem and isAlreadyExists", () => {
  assert.match(model.reasonProblem(""), /กรุณาระบุเหตุผล/);
  assert.match(model.reasonProblem("   "), /กรุณาระบุเหตุผล/);
  assert.equal(model.reasonProblem("ok"), "");
  assert.match(model.reasonProblem("x".repeat(1001)), /ยาวเกิน/);
  assert.equal(model.isAlreadyExists({ code: "23514", message: "ผู้ใช้นี้มีอยู่แล้ว กรุณาโหลด" }), true);
  assert.equal(model.isAlreadyExists({ code: "23514", message: "อื่น ๆ" }), false);
});

/* ---------- สถานะ ---------- */
test("holdings: what a user still has, as text, so a resignation can warn before removing", () => {
  const detail = { user: { internet: true }, folders: [{}, {}], programs: [{}], emails: [{ status: "active" }, { status: "closed" }] };
  assert.deepEqual(model.holdingsOf(detail), { folders: 2, programs: 1, internet: true, emails: 1 });
  assert.equal(model.hasHoldings(model.holdingsOf(detail)), true);
  assert.equal(model.holdingsText(model.holdingsOf(detail)), "โฟลเดอร์ 2 รายการ · โปรแกรม 1 รายการ · อินเทอร์เน็ต · อีเมลที่ใช้งานอยู่ 1 รายการ");
  assert.equal(model.hasHoldings({ folders: 0, programs: 0, internet: false, emails: 0 }), false);
  assert.equal(model.hasHoldings(null), false);
  assert.equal(model.statusLabel("resigned"), "ลาออก");
});

/* ---------- สิทธิ์ ---------- */
const CATALOG = {
  folders: [
    { code: "ACC", name: "บัญชี", description: "เอกสารบัญชี", is_active: true },
    { code: "HR", name: "บุคคล", is_active: true },
    { code: "OLD", name: "เก่า", is_active: false },
    { code: "OLD2", name: "เก่า 2", is_active: false },
  ],
  programs: [{ code: "IPRIME", name: "iPrime", is_active: true }, { code: "OTHER", name: "อื่นๆ", is_active: true }, { code: "GONE", name: "เลิกใช้", is_active: false }],
};
const DETAIL = { user: { id: ID, status: "active", internet: false }, folders: [{ code: "ACC", level: "R" }, { code: "OLD", level: "F" }], programs: [{ code: "GONE", note: null }, { code: "OTHER", note: "AutoCAD" }] };

test("grantFormModel lists active catalog entries plus inactive ones the user still holds", () => {
  const form = model.grantFormModel({ detail: DETAIL, catalog: CATALOG });
  assert.deepEqual(form.folders.map((item) => [item.code, item.current, item.isActive]), [["ACC", "R", true], ["HR", null, true], ["OLD", "F", false]], "OLD2 is inactive and not held, so it is left out");
  assert.deepEqual(form.programs.map((item) => [item.code, item.current, item.note]), [["IPRIME", false, ""], ["OTHER", true, "AutoCAD"], ["GONE", true, ""]]);
  assert.equal(form.userId, ID);
  assert.equal(form.resigned, false);
  assert.equal(form.internet, false);
});

test("a resigned user, or an inactive folder, can only be removed: the choices shrink to 'none' and the current level", () => {
  const form = model.grantFormModel({ detail: DETAIL, catalog: CATALOG });
  const options = (item, source = form) => model.folderOptions(source, item).map((option) => option.value);
  assert.deepEqual(options(form.folders[0]), ["", "R", "F"]);
  assert.deepEqual(options(form.folders[2]), ["", "F"], "inactive folder: keep or remove");
  const resigned = model.grantFormModel({ detail: { ...DETAIL, user: { ...DETAIL.user, status: "resigned" } }, catalog: CATALOG });
  assert.deepEqual(options(resigned.folders[0], resigned), ["", "R"]);
  assert.deepEqual(options(resigned.folders[1], resigned), [""], "no level to keep, so only 'none'");
  assert.equal(model.canAddInternet(resigned), false);
  assert.equal(model.canAddProgram(resigned, resigned.programs[0]), false);
  assert.equal(model.canAddProgram(form, form.programs[0]), true);
  assert.equal(model.canAddProgram(form, form.programs[2]), false, "an inactive program cannot be added");
});

test("buildGrantChanges sends from and to for each change and nothing for what stayed the same", () => {
  const form = model.grantFormModel({ detail: DETAIL, catalog: CATALOG });
  const state = model.currentGrantState(form);
  assert.deepEqual(model.buildGrantChanges(form, state), [], "nothing touched = no changes");
  const next = structuredClone(state);
  next.folders.ACC = "F"; // R -> F
  next.folders.HR = "R"; // none -> R
  next.folders.OLD = ""; // F -> none
  next.internet = true;
  next.programs.IPRIME = { on: true, note: "" };
  next.programs.GONE = { on: false, note: "" };
  next.programs.OTHER = { on: true, note: "AutoCAD LT" }; // แก้หมายเหตุ
  assert.deepEqual(model.buildGrantChanges(form, next), [
    { kind: "folder", code: "ACC", from: "R", to: "F" },
    { kind: "folder", code: "HR", from: null, to: "R" },
    { kind: "folder", code: "OLD", from: "F", to: null },
    { kind: "internet", from: false, to: true },
    { kind: "program", code: "IPRIME", from: false, to: true },
    { kind: "program", code: "OTHER", from: true, to: true, note: "AutoCAD LT", from_note: "AutoCAD" },
    { kind: "program", code: "GONE", from: true, to: false },
  ]);
  const withNote = structuredClone(state);
  withNote.programs.IPRIME = { on: true, note: "  Q1  " };
  assert.deepEqual(model.buildGrantChanges(form, withNote), [{ kind: "program", code: "IPRIME", from: false, to: true, note: "Q1" }]);
});

test("validateGrants: needs a change, a reason, a note for the 'other' program, and stays within the limits", () => {
  const form = model.grantFormModel({ detail: { ...DETAIL, programs: [] }, catalog: CATALOG });
  const state = model.currentGrantState(form);
  const fields = (next, reason) => model.validateGrants(form, next, reason).map((item) => item.field);
  assert.deepEqual(fields(state, "เหตุผล"), ["reason"], "no change");
  const grant = structuredClone(state);
  grant.folders.HR = "R";
  assert.deepEqual(fields(grant, "เหตุผล"), []);
  assert.deepEqual(fields(grant, "  "), ["reason"]);
  const other = structuredClone(grant);
  other.programs.OTHER = { on: true, note: "" };
  assert.deepEqual(fields(other, "เหตุผล"), ["note:OTHER"]);
  other.programs.OTHER = { on: true, note: "AutoCAD" };
  assert.deepEqual(fields(other, "เหตุผล"), []);
  other.programs.OTHER = { on: true, note: "x".repeat(501) };
  assert.deepEqual(fields(other, "เหตุผล"), ["note:OTHER"]);
  assert.deepEqual(model.grantParams(form, grant, " เหตุผล "), { p_user_id: ID, p_changes: [{ kind: "folder", code: "HR", from: null, to: "R" }], p_reason: "เหตุผล" });
});

/* ---------- อีเมล ---------- */
test("validateEmail: address format and kind", () => {
  assert.deepEqual(model.validateEmail({ address: "a@b.co", kind: "internal" }), []);
  assert.deepEqual(model.validateEmail({ address: "a@b", kind: "extra" }).map((item) => item.field), ["address"]);
  assert.deepEqual(model.validateEmail({ address: "a b@c.d", kind: "extra" }).map((item) => item.field), ["address"]);
  assert.deepEqual(model.validateEmail({ address: "a@b.co", kind: "x" }).map((item) => item.field), ["kind"]);
  assert.equal(model.emailKindLabel("internal"), "อีเมลภายใน");
});

/* ---------- รายการกลาง ---------- */
test("catalog forms: code format, duplicate code on add, name, sort; params are normalised", () => {
  const values = { ...model.emptyCatalogValues("folder"), code: "new-1", name: " ใหม่ ", description: " d ", sort: "20" };
  assert.deepEqual(model.validateCatalog("folder", "add", values, ["ACC"]), []);
  assert.deepEqual(model.validateCatalog("folder", "add", { ...values, code: "acc" }, ["ACC"]).map((item) => item.field), ["code"], "an existing code would silently become an edit");
  assert.deepEqual(model.validateCatalog("folder", "edit", { ...values, code: "acc" }, ["ACC"]), [], "editing keeps its code");
  assert.deepEqual(model.validateCatalog("folder", "add", { ...values, code: "bad code" }, []).map((item) => item.field), ["code"]);
  assert.deepEqual(model.validateCatalog("program", "add", { ...values, name: "", sort: "12345" }, []).map((item) => item.field), ["name", "sort"]);
  assert.deepEqual(model.folderParams(values, "  "), { p_code: "NEW-1", p_name: "ใหม่", p_description: "d", p_sort: 20, p_is_active: true, p_reason: null });
  assert.deepEqual(model.programParams({ code: "x", name: "P", sort: "5", is_active: false }, "เหตุผล"), { p_code: "X", p_name: "P", p_sort: 5, p_is_active: false, p_reason: "เหตุผล" });
  const original = { code: "ACC", name: "บัญชี", description: "d", sort: 10, is_active: true };
  assert.equal(model.catalogChanged("folder", original, model.catalogValuesFromItem("folder", original)), false);
  assert.equal(model.catalogChanged("folder", original, { ...model.catalogValuesFromItem("folder", original), is_active: false }), true);
  assert.equal(model.catalogChanged("folder", null, values), true);
});

/* ---------- ประวัติ ---------- */
test("logLines reads every kind of history row in Thai, with names for folder and program codes", () => {
  const names = { folders: { ACC: "บัญชี" }, programs: { IPRIME: "iPrime" } };
  const lines = (entry) => model.logLines(entry, names);
  assert.deepEqual(lines({ entity: "user", action: "created" }), ["เพิ่มผู้ใช้เข้าทะเบียน"]);
  assert.deepEqual(lines({ entity: "user", action: "updated", old_values: { internet: false, status: "active", note: null, updated_at: "a" }, new_values: { internet: true, status: "resigned", note: "x", updated_at: "b" } }), ["อินเทอร์เน็ต: ไม่มี → มี", "สถานะ: ใช้งาน → ลาออก", "หมายเหตุ: — → x"]);
  assert.deepEqual(lines({ entity: "user", action: "updated", old_values: { division: "office", granted_on: "2026-01-05" }, new_values: { division: "factory", granted_on: "2026-02-06" } }), ["ฝ่าย: สำนักงาน → โรงงาน", "วันที่ให้สิทธิ์: 05/01/2569 → 06/02/2569"]);
  assert.deepEqual(lines({ entity: "folder_grant", action: "created", entity_code: "ACC", new_values: { level: "R" } }), ["เพิ่มสิทธิ์โฟลเดอร์ บัญชี ระดับ R"]);
  assert.deepEqual(lines({ entity: "folder_grant", action: "updated", entity_code: "ACC", old_values: { level: "R" }, new_values: { level: "F" } }), ["โฟลเดอร์ บัญชี: R → F"]);
  assert.deepEqual(lines({ entity: "folder_grant", action: "deleted", entity_code: "ZZZ", old_values: { level: "F" } }), ["ถอนสิทธิ์โฟลเดอร์ ZZZ (เดิม F)"], "an unknown code falls back to the code");
  assert.deepEqual(lines({ entity: "program_grant", action: "created", entity_code: "IPRIME", new_values: { note: "ชั่วคราว" } }), ["เพิ่มสิทธิ์โปรแกรม iPrime (ชั่วคราว)"]);
  assert.deepEqual(lines({ entity: "program_grant", action: "deleted", entity_code: "IPRIME", old_values: { note: null } }), ["ถอนสิทธิ์โปรแกรม iPrime"]);
  assert.deepEqual(lines({ entity: "email", action: "created", entity_code: "a@b.co", new_values: { kind: "internal" } }), ["เพิ่มอีเมลภายใน a@b.co"]);
  assert.deepEqual(lines({ entity: "email", action: "updated", entity_code: "a@b.co", old_values: { status: "active" }, new_values: { status: "closed" } }), ["อีเมล a@b.co: ปิดการใช้งาน"]);
});

test("logView carries the time (Bangkok), who, the reason and the request number, newest first as given", () => {
  const view = model.logView({ log: [{ id: 2, entity: "user", action: "created", reason: " เหตุผล ", actor_employee_no: "IT3462", actor_full_name: "เจ้าของ ระบบ", created_at: "2026-11-26T05:12:00Z", source_doc_no: "IT08-01-26/001" }, { id: 1, entity: "email", action: "created", entity_code: "a@b.co", new_values: { kind: "extra" }, actor_employee_no: "", actor_full_name: "", created_at: null }] });
  assert.equal(view.length, 2);
  assert.deepEqual(view[0], { id: 2, lines: ["เพิ่มผู้ใช้เข้าทะเบียน"], reason: "เหตุผล", by: "IT3462 เจ้าของ ระบบ", at: "26/11/2569 12:12", docNo: "IT08-01-26/001" });
  assert.equal(view[1].by, "—");
  assert.deepEqual(model.logView(null), []);
});

/* ---------- พิมพ์ + ส่งออก ---------- */
test("the print list and the matrix print carry only register data, in the order shown, with the filters on the header", () => {
  const view = model.listPrint(ROWS);
  assert.deepEqual(view.columns.map((column) => column.label), ["ลำดับ", "Auth. Name", "ชื่อ", "แผนก", "ฝ่าย", "อินเทอร์เน็ต", "โฟลเดอร์", "อีเมลภายใน", "สถานะ"]);
  assert.deepEqual(view.lines[0], ["1", "somchai.k", "สมชาย ใจดี", "ACC", "สำนักงาน", "มี", "R 3 · F 2", "somchai@mnp.test", "ใช้งาน"]);
  assert.deepEqual(view.lines[1], ["2", "mali.p", "Mali P", "IT", "โรงงาน", "—", "—", "", "ใช้งาน"]);
  assert.deepEqual(model.printFilterItems({}), [["แผนก", "ทุกแผนก"], ["ฝ่าย", "ทุกฝ่าย"], ["สถานะ", "ทุกสถานะ"]]);
  assert.deepEqual(model.printFilterItems({ department: "IT", division: "factory", status: "active", query: "ma" }), [["แผนก", "IT"], ["ฝ่าย", "โรงงาน"], ["สถานะ", "ใช้งาน"], ["ค้นหา", "ma"]]);
  const folders = [{ code: "ACC", name: "บัญชี" }, { code: "HR", name: "บุคคล" }];
  const matrix = model.matrixPrint({ rows: [{ user_id: "u1", auth_id: "a", name_th: "ก", department_code: "IT", internet: true, levels: { ACC: "R", HR: "F" } }, { user_id: "u2", auth_id: "b", name_th: "ข", department_code: "", internet: false, levels: {} }], folders });
  assert.deepEqual(matrix.columns.map((column) => column.label), ["Auth. Name / ชื่อ", "แผนก", "เน็ต", "บัญชี", "บุคคล"]);
  assert.deepEqual(matrix.lines, [["a ก", "IT", "✓", "R", "F"], ["b ข", "", "", "", ""]]);
});

test("CSV: UTF-8 BOM, every cell quoted, quotes doubled, formula starts neutralised; file names carry mode and Bangkok date", () => {
  const csv = model.listCsv([{ auth_id: "x", name_th: '=HYPERLINK("http://x")', name_en: "+1", department_code: "-A", division: "office", internet: true, folder_r: 1, folder_f: 2, program_count: 3, internal_email: "@x", granted_doc_no: "", granted_on: "2026-01-05", status: "active" }]);
  assert.ok(csv.startsWith(model.CSV_BOM));
  const [head, line] = csv.slice(1).split("\r\n");
  assert.equal(head.split(",").length, 13);
  assert.ok(line.includes(`"'=HYPERLINK(""http://x"")"`), line);
  assert.ok(line.includes('"\'+1"') && line.includes('"\'-A"') && line.includes('"\'@x"'));
  assert.ok(line.includes('"สำนักงาน"') && line.includes('"มี"') && line.includes('"2026-01-05"') && line.includes('"ใช้งาน"'));
  const folders = [{ code: "ACC", name: "บัญชี" }];
  const matrix = model.matrixCsv({ rows: [{ auth_id: "a", name_th: "ก", name_en: "", department_code: "IT", division: "factory", status: "resigned", internet: false, levels: { ACC: "F" } }], folders });
  assert.equal(matrix, `${model.CSV_BOM}"Auth. Name","ชื่อ (ไทย)","ชื่อ (อังกฤษ)","แผนก","ฝ่าย","สถานะ","อินเทอร์เน็ต","บัญชี"\r\n"a","ก","","IT","โรงงาน","ลาออก","ไม่มี","F"\r\n`);
  const now = new Date("2026-12-31T18:00:00Z"); // 1 ม.ค. เวลาไทย
  assert.equal(model.csvFileName({ kind: "list", isTest: false, now }), "itua-list-real-20270101.csv");
  assert.equal(model.csvFileName({ kind: "matrix", isTest: true, now }), "itua-matrix-test-20270101.csv");
});

/* ---------- error ---------- */
test("describeError: Thai database messages are shown as they are, conflicts and sessions get fixed texts, unknown failures are cautious", () => {
  const thai = "กรุณาระบุเหตุผลที่แก้ข้อมูลผู้ใช้ (บันทึกสำหรับ ISO)";
  assert.deepEqual(model.describeError({ code: "23514", message: thai }), { kind: "rejected", message: thai, forwarded: true });
  assert.deepEqual(model.describeError({ code: "42501", message: "เฉพาะผู้ดูแลงาน IT เท่านั้น" }), { kind: "access", message: "เฉพาะผู้ดูแลงาน IT เท่านั้น", forwarded: true });
  const conflict = model.describeError({ code: "40001", message: "สิทธิ์ปัจจุบันไม่ตรง" });
  assert.equal(conflict.kind, "conflict");
  assert.match(conflict.message, /โหลดข้อมูลล่าสุด/);
  assert.equal(model.describeError({ code: "PGRST301", message: "JWT expired" }).kind, "session");
  assert.equal(model.describeError({ code: "PGRST202", message: "x" }).kind, "missing");
  assert.equal(model.describeError({ message: "Failed to fetch" }, { write: true }).message.includes("ผลไม่แน่ชัด"), true);
  assert.equal(model.describeError({ message: "Failed to fetch" }).message.includes("โหลดข้อมูลไม่สำเร็จ"), true);
  assert.equal(model.describeError({ code: "XX000", message: "internal error" }).kind, "rejected");
  assert.match(model.purgeSummary({ deleted: 4 }).message, /4/);
});

test("the model has no DOM, no Supabase, no storage and no secrets", () => {
  const source = read("modules/itua-model.js").replace(/\/\/.*$/gm, ""); // เทียบเฉพาะโค้ด ไม่รวมคอมเมนต์ที่อธิบายว่าไม่มีช่องลับ
  assert.doesNotMatch(source, /document\.|sb\.|localStorage|sessionStorage|console\./);
  assert.doesNotMatch(source, /password|secret|license|cipher/i);
});
