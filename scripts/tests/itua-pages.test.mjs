import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// modules/itua-pages.js (HTML ของทะเบียนสิทธิ์ผู้ใช้: หน้า ตาราง เมทริกซ์ หน้าต่อคน ฟอร์ม ใบพิมพ์) · ข้อมูลทั้งหมดเป็นของปลอม
const require = createRequire(import.meta.url);
globalThis.MNP_ITUA_MODEL = require("../../modules/itua-model.js");
const model = globalThis.MNP_ITUA_MODEL;
const pages = require("../../modules/itua-pages.js");
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const XSS = '<img src=x onerror="alert(1)">';
const ID = "11111111-1111-4111-8111-111111111111";
const STAMP = "2026-11-26T05:12:33.123456+00:00";

const ROWS = [
  { id: ID, auth_id: "somchai.k", name_th: "สมชาย ใจดี", name_en: "Somchai", department_code: "ACC", division: "office", internet: true, status: "active", folder_r: 3, folder_f: 2, internal_email: "somchai@mnp.test" },
  { id: "u2", auth_id: "old.user", name_th: "", name_en: "Old", department_code: "", division: "factory", internet: false, status: "resigned", folder_r: 0, folder_f: 0, internal_email: null },
];

/* ---------- เปลือกหน้า ---------- */
test("the page shell has the dev notice, the version, the back link, the tabs and the two host areas; user pages have no tabs", () => {
  const html = pages.pageShell({ view: "matrix", body: "<p>BODY</p>" });
  assert.match(html, /class="itua-page" data-module="it"/);
  assert.match(html, /กำลังพัฒนาและทดสอบ ยังไม่เปิดใช้งานจริง/, "the development notice follows the model flag");
  assert.match(html, new RegExp(`V${model.MODULE_VERSION.replace(".", "\\.")}`));
  assert.match(html, /<a class="request-back-link" href="#\/office\?module=it-support">‹ IT SUPPORT<\/a>/);
  assert.equal(count(html, /class="itua-tab[ "]/g), 3);
  assert.match(html, /href="#\/office\?module=access&amp;view=matrix"[^>]*aria-current="page"|aria-current="page"[^>]*>เมทริกซ์สิทธิ์/);
  assert.equal(count(html, /aria-current="page"/g), 1);
  assert.ok(html.indexOf('id="itua-form-area"') < html.indexOf('id="itua-body-host"'), "forms open above the content");
  assert.doesNotMatch(html, /itua-purge/, "no purge button outside test mode");
  const user = pages.pageShell({ view: "user", body: "x" });
  assert.doesNotMatch(user, /class="itua-tab[ "]/);
  assert.match(user, /<a class="request-back-link" href="#\/office\?module=access">‹ ทะเบียนสิทธิ์ผู้ใช้<\/a>/);
  const test0 = pages.pageShell({ view: "list", isTest: true, body: "x" });
  assert.match(test0, /itua-test-tag/);
  assert.match(test0, /id="itua-purge"/);
});

test("the error and message boxes escape their text and offer retry / reload only when asked", () => {
  assert.match(pages.errorCard(XSS), /&lt;img/);
  assert.doesNotMatch(pages.errorCard(XSS), /<img/);
  assert.match(pages.errorCard("x"), /id="itua-retry"/);
  assert.doesNotMatch(pages.errorCard("x", { retry: false }), /itua-retry/);
  assert.match(pages.messageBox("x", { reload: true }), /id="itua-reload"/);
  assert.doesNotMatch(pages.messageBox("x"), /itua-reload/);
});

/* ---------- รายการ ---------- */
test("the toolbar keeps the filter values, lists the departments and disables print/export with no rows", () => {
  const html = pages.toolbar({ filters: { query: XSS, department: "ACC", division: "factory", status: "resigned" }, departments: ["ACC", "IT"], canAdd: true, hasRows: false });
  assert.match(html, /value="&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<option value="ACC" selected>ACC<\/option>/);
  assert.match(html, /<option value="factory" selected>โรงงาน<\/option>/);
  assert.match(html, /<option value="resigned" selected>ลาออก<\/option>/);
  assert.match(html, /id="itua-print" disabled/);
  assert.match(html, /id="itua-export" disabled/);
  assert.match(html, /id="itua-add"/);
  const matrix = pages.toolbar({ filters: {}, departments: [], canAdd: false, hasRows: true });
  assert.doesNotMatch(matrix, /itua-add|disabled/);
});

test("the user table has a row and a link per person with the labels the phone layout uses, and escapes every value", () => {
  const html = pages.userTable([{ ...ROWS[0], name_th: XSS, internal_email: XSS, department_code: XSS }, ROWS[1]]);
  assert.equal(count(html, /<tr class="itua-row/g), 2);
  assert.match(html, new RegExp(`data-itua-row="${ID}" tabindex="0"`));
  assert.match(html, new RegExp(`<a href="#/office\\?module=access&amp;user=${ID}">somchai\\.k</a>`));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  for (const label of ["Auth. Name", "ชื่อ", "แผนก", "ฝ่าย", "อินเทอร์เน็ต", "โฟลเดอร์", "อีเมลภายใน", "สถานะ"]) assert.ok(html.includes(`data-label="${label}"`), label);
  assert.match(html, /R 3 · F 2/);
  assert.match(html, /is-resigned/);
  assert.match(html, /itua-status is-ok">ใช้งาน/);
  assert.match(html, /itua-status is-off">ลาออก/);
  assert.match(pages.userTable([]), /ไม่พบผู้ใช้/);
});

test("the list panel shows the title and the count", () => {
  const html = pages.listPanel({ title: "เมทริกซ์", toolbarHtml: "<i>TB</i>", countText: "2 คน", tableHtml: "<i>TABLE</i>" });
  assert.match(html, /<h2 id="itua-list-title">เมทริกซ์<\/h2>/);
  assert.match(html, /id="itua-count" role="status">2 คน</);
  assert.match(html, /id="itua-table-host"><i>TABLE<\/i>/);
});

/* ---------- เมทริกซ์ ---------- */
test("the matrix has the folder names as column heads, R/F in the cells, a sticky user column and a legend; empty cases explain themselves", () => {
  const folders = [{ code: "ACC", name: "บัญชี", description: "เอกสารบัญชี" }, { code: "HR", name: XSS, description: "" }];
  const rows = [{ user_id: ID, auth_id: "a", name_th: "ก", department_code: "IT", status: "active", internet: false, levels: { ACC: "R", HR: "F" } }, { user_id: "u2", auth_id: "b", name_th: "ข", department_code: "", status: "resigned", internet: false, levels: {} }];
  const html = pages.matrixTable({ rows, folders });
  assert.equal(count(html, /<th scope="col" class="itua-col"/g), 2);
  assert.match(html, /title="บัญชี — เอกสารบัญชี"><span>บัญชี<\/span>/);
  assert.doesNotMatch(html, /<img/);
  assert.equal(count(html, /class="itua-cell is-r">R</g), 1);
  assert.equal(count(html, /class="itua-cell is-f">F</g), 1);
  assert.equal(count(html, /<td class="itua-cell">/g), 2, "no level = an empty plain cell");
  assert.match(html, /class="itua-sticky-col"/);
  assert.match(html, /class="itua-matrix-scroll" tabindex="0" role="region"/);
  assert.match(html, /R = อ่านอย่างเดียว · F = เต็ม/);
  assert.match(html, new RegExp(`href="#/office\\?module=access&amp;user=${ID}"`));
  assert.match(pages.matrixTable({ rows: [], folders }), /ไม่พบผู้ใช้/);
  assert.match(pages.matrixTable({ rows, folders: [] }), /ยังไม่มีรายการโฟลเดอร์/);
});

/* ---------- หน้าต่อคน ---------- */
const DETAIL = {
  user: { id: ID, auth_id: "somchai.k", name_th: "สมชาย", name_en: "Somchai", department_code: "ACC", division: "office", internet: true, status: "active", granted_doc_no: "IT08-01-26/001", granted_on: "2026-01-05", note: XSS, updated_at: STAMP, updated_by_employee_no: "IT3462" },
  folders: [{ folder_id: "f1", code: "ACC", name: "บัญชี", is_active: true, level: "R" }, { folder_id: "f2", code: "OLD", name: "เก่า", is_active: false, level: "F" }],
  emails: [{ id: "e1", address: "a@b.co", kind: "internal", status: "active" }, { id: "e2", address: "c@d.co", kind: "extra", status: "closed" }],
  programs: [{ program_id: "p1", code: "OTHER", name: "อื่นๆ", is_active: true, note: XSS }],
  log: [], acknowledgements: [],
};

test("the user page shows the main data, the grants, the emails and the edit buttons; user data is escaped", () => {
  const html = pages.userBody({ detail: DETAIL, historyHtml: pages.historySection([]) });
  assert.match(html, /somchai\.k/);
  assert.match(html, /IT08-01-26\/001/);
  assert.match(html, /05\/01\/2569/);
  assert.match(html, /26\/11\/2569 12:12 · IT3462/);
  assert.doesNotMatch(html, /<img/, "note and program note are escaped");
  for (const id of ["itua-edit-user", "itua-change-status", "itua-edit-grants", "itua-add-email"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, />เปลี่ยนเป็นลาออก</);
  assert.equal(count(html, /itua-grant is-/g), 3, "two folders and one program");
  assert.match(html, /itua-grant is-f is-off/, "an inactive folder is dimmed");
  assert.match(html, /✓ มีสิทธิ์อินเทอร์เน็ต/);
  assert.match(html, /data-itua-close-email="e1"/);
  assert.doesNotMatch(html, /data-itua-close-email="e2"/, "a closed email has no close button");
  assert.match(html, /ปิดแล้ว/);
  assert.doesNotMatch(html, /รหัสผ่าน<|type="password"/);
});

test("a resigned user shows a warning with what is left (or a plain note when nothing is left) and offers to come back", () => {
  const left = pages.userBody({ detail: { ...DETAIL, user: { ...DETAIL.user, status: "resigned" } } });
  assert.match(left, /ลาออกแล้วแต่ยังมีสิทธิ์เหลืออยู่: โฟลเดอร์ 2 รายการ · โปรแกรม 1 รายการ · อินเทอร์เน็ต · อีเมลที่ใช้งานอยู่ 1 รายการ/);
  assert.match(left, />กลับมาใช้งาน</);
  const clean = pages.userBody({ detail: { user: { ...DETAIL.user, status: "resigned", internet: false }, folders: [], emails: [], programs: [] } });
  assert.match(clean, /ถอนสิทธิ์ได้อย่างเดียว/);
  assert.doesNotMatch(clean, /ยังมีสิทธิ์เหลืออยู่/);
});

test("history: each row has time, who, lines and reason; a full page says it is cut; acknowledgements only when there are some", () => {
  const view = [{ id: 1, at: "26/11/2569 12:12", by: "IT3462 ผู้ทำ", lines: ["ฝ่าย: สำนักงาน → โรงงาน", XSS], reason: XSS, docNo: "IT08-01-26/009" }];
  const html = pages.historySection(view, { limit: 1 });
  assert.match(html, /ตามใบ IT08-01-26\/009/);
  assert.match(html, /เหตุผล:/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /แสดง 1 รายการล่าสุด/);
  assert.doesNotMatch(pages.historySection(view, { limit: 200 }), /รายการล่าสุด/);
  assert.match(pages.historySection([]), /ยังไม่มีประวัติ/);
  assert.equal(pages.acknowledgementsSection({ acknowledgements: [] }), "");
  assert.match(pages.acknowledgementsSection({ acknowledgements: [{ acknowledged_at: STAMP, acknowledged_by_employee_no: "MT1", acknowledged_by_full_name: "ก ข", policy_version: "v1" }] }), /MT1 ก ข · นโยบาย v1/);
});

/* ---------- ฟอร์ม ---------- */
test("the user form has every main field, a division choice, the date hint, and a reason only when editing", () => {
  const add = pages.userForm({ mode: "add", values: model.emptyUserValues() });
  for (const name of ["auth_id", "name_th", "name_en", "department_code", "division", "granted_doc_no", "granted_on", "note"]) assert.ok(add.includes(`name="${name}"`), name);
  assert.doesNotMatch(add, /name="reason"/);
  assert.doesNotMatch(add, /name="internet"|name="status"/, "those change through grants / status");
  assert.match(add, /id="itua-form-back"/);
  assert.match(add, /<form id="itua-user-form" class="itua-form" novalidate/);
  assert.equal(count(add, /type="submit"/g), 2, "a save button in the sticky head and one at the bottom");
  assert.match(add, /data-date-text/);
  assert.match(add, /พิมพ์เป็น วว\/ดด\/ปปปป/);
  assert.equal(count(add, /<option value="(office|factory|manager|office_indesign)"/g), 4);
  const edit = pages.userForm({ mode: "edit", values: { ...model.userValuesFromUser(DETAIL.user), name_th: XSS }, user: DETAIL.user });
  assert.match(edit, /name="reason"/);
  assert.match(edit, /แก้ไขข้อมูลหลัก somchai\.k/);
  assert.doesNotMatch(edit, /<img/);
  assert.match(edit, /<option value="office" selected>/);
  assert.match(edit, /value="05\/01\/2569"/);
});

test("the status form warns about leftover grants only when going to resigned, and always asks for a reason", () => {
  const holdings = { folders: 2, programs: 1, internet: true, emails: 1 };
  const resign = pages.statusForm({ user: DETAIL.user, target: "resigned", remaining: holdings });
  assert.match(resign, /ไม่ถอดสิทธิ์ให้เอง/);
  assert.match(resign, /โฟลเดอร์ 2 รายการ/);
  assert.match(resign, /ยืนยันลาออก/);
  assert.match(resign, /name="reason"/);
  const back = pages.statusForm({ user: DETAIL.user, target: "active", remaining: holdings });
  assert.doesNotMatch(back, /ไม่ถอดสิทธิ์ให้เอง/);
  assert.match(back, /ยืนยันกลับมาใช้งาน/);
  assert.doesNotMatch(pages.statusForm({ user: DETAIL.user, target: "resigned", remaining: { folders: 0, programs: 0, internet: false, emails: 0 } }), /ไม่ถอดสิทธิ์ให้เอง/);
});

const CATALOG = {
  folders: [{ code: "ACC", name: "บัญชี", description: "เอกสารบัญชี", is_active: true }, { code: "HR", name: "บุคคล", is_active: true }, { code: "OLD", name: "เก่า", is_active: false }],
  programs: [{ code: "IPRIME", name: "iPrime", is_active: true }, { code: "OTHER", name: "อื่นๆ", is_active: true }],
};
const grantsHtml = (detail = DETAIL) => {
  const formModel = model.grantFormModel({ detail, catalog: CATALOG });
  return pages.grantsForm({ user: detail.user, formModel, next: model.currentGrantState(formModel) });
};

test("the grants form has a level choice per folder, the internet box, a box and note per program and a required reason; current values are preselected", () => {
  const html = grantsHtml();
  assert.match(html, /<select class="select" id="itua-f-folder-ACC" name="folder:ACC">[^]*?<option value="R" selected>R อ่านอย่างเดียว<\/option>/);
  assert.match(html, /name="folder:HR"/);
  assert.match(html, /name="folder:OLD"/, "an inactive folder the user still holds stays listed");
  assert.match(html, /ปิดใช้งาน/);
  assert.match(html, /name="internet" checked/);
  assert.match(html, /name="program:OTHER" checked/);
  assert.match(html, /name="note:OTHER"[^>]*placeholder="ระบุว่าเป็นโปรแกรมอะไร \(จำเป็น\)"/);
  assert.match(html, /name="note:IPRIME"[^>]*placeholder="หมายเหตุ \(ไม่บังคับ\)"/);
  assert.match(html, /name="reason"/);
  assert.match(html, /บันทึกทั้งชุดพร้อมกัน/);
  assert.match(html, /data-field="folder:ACC"/, "field errors can find the row");
  assert.doesNotMatch(html, /<img/);
});

test("for a resigned user the grants form can only remove: no new levels, no new internet or program", () => {
  const resigned = { ...DETAIL, user: { ...DETAIL.user, status: "resigned", internet: false }, programs: [] };
  const html = grantsHtml(resigned);
  assert.match(html, /ถอนสิทธิ์ได้อย่างเดียว/);
  const hr = /<select[^>]*name="folder:HR">([^]*?)<\/select>/.exec(html)[1];
  assert.equal(count(hr, /<option/g), 1, "HR: only 'none'");
  assert.match(html, /name="internet" disabled/);
  assert.match(html, /name="program:IPRIME" disabled/);
  assert.match(html, /name="note:IPRIME"[^>]*disabled/);
});

test("the email forms: add has a kind choice (internal only when free) and an optional reason; close needs a reason", () => {
  const add = pages.emailAddForm({ user: DETAIL.user, canInternet: true });
  assert.match(add, /<option value="internal" selected>/);
  assert.match(add, /type="email"/);
  assert.match(add, /ไม่บังคับ/);
  const taken = pages.emailAddForm({ user: DETAIL.user, canInternet: false });
  assert.match(taken, /<option value="extra" selected>/);
  assert.match(taken, /มีอีเมลภายในที่ใช้งานอยู่แล้ว/);
  const close = pages.emailCloseForm({ email: { address: XSS } });
  assert.match(close, /เปิดใหม่ไม่ได้/);
  assert.match(close, /name="reason"/);
  assert.doesNotMatch(close, /<img/);
});

test("the settings page lists folders and programs with counts and edit buttons; its forms lock the code when editing", () => {
  const html = pages.catalogPage({ catalog: { folders: [{ code: "ACC", name: XSS, description: XSS, sort: 10, grant_count: 3, is_active: true }, { code: "OLD", name: "เก่า", sort: 20, grant_count: 0, is_active: false }], programs: [{ code: "OTHER", name: "อื่นๆ", sort: 90, grant_count: 1, is_active: true }] } });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-itua-edit-folder="ACC"/);
  assert.match(html, /data-itua-edit-folder="OLD"/);
  assert.match(html, /data-itua-edit-program="OTHER"/);
  assert.match(html, /id="itua-add-folder"/);
  assert.match(html, /id="itua-add-program"/);
  assert.match(html, /ลบไม่ได้/);
  assert.match(html, /itua-status is-off">ปิดใช้งาน/);
  const add = pages.catalogForm({ kind: "folder", mode: "add", values: model.emptyCatalogValues("folder") });
  assert.match(add, /<input class="input" id="itua-f-code" name="code" type="text"/);
  assert.match(add, /name="description"/);
  assert.doesNotMatch(add, /name="reason"/);
  const edit = pages.catalogForm({ kind: "program", mode: "edit", values: model.catalogValuesFromItem("program", { code: "OTHER", name: "อื่นๆ", sort: 90, is_active: true }) });
  assert.match(edit, /<input type="hidden" name="code" value="OTHER">/);
  assert.match(edit, /แก้รหัสไม่ได้/);
  assert.doesNotMatch(edit, /name="description"/, "programs have no description");
  assert.match(edit, /name="reason"/);
  assert.match(edit, /name="is_active" checked/);
});

/* ---------- ใบพิมพ์ ---------- */
test("the print sheet is hidden on screen, escapes every value, carries the filters, the count and the date, and has no secrets", () => {
  const list = pages.printSheet({ title: "ทะเบียนสิทธิ์ผู้ใช้", view: model.listPrint([{ ...ROWS[0], name_th: XSS }]), filters: model.printFilterItems({ department: "ACC" }), countText: "1 คน", printedAt: "26/11/2569 12:12", isTest: true });
  assert.match(list, /class="itua-sheet" aria-hidden="true"/);
  assert.doesNotMatch(list, /<img/);
  assert.match(list, /ข้อมูลทดสอบ/);
  assert.match(list, /<dt>แผนก:<\/dt><dd>ACC<\/dd>/);
  assert.match(list, /<dt>จำนวน:<\/dt><dd>1 คน<\/dd>/);
  assert.match(list, /<dt>วันที่พิมพ์:<\/dt><dd>26\/11\/2569 12:12<\/dd>/);
  assert.doesNotMatch(list, /itua-sheet-legend/);
  const matrix = pages.printSheet({ title: "เมทริกซ์", view: model.matrixPrint({ rows: [{ user_id: "u", auth_id: "a", name_th: "ก", department_code: "IT", internet: true, levels: { ACC: "F" } }], folders: [{ code: "ACC", name: "บัญชี" }] }), filters: [], countText: "1 คน", printedAt: "x", matrix: true });
  assert.match(matrix, /class="itua-sheet is-matrix"/);
  assert.match(matrix, /<th scope="col" class="itua-sheet-level"><span>บัญชี<\/span><\/th>/);
  assert.match(matrix, /<td class="itua-sheet-level">F<\/td>/);
  assert.match(matrix, /itua-sheet-legend/);
  assert.match(pages.printSheet({ title: "t", view: { columns: [{ key: "a", label: "A", cls: "" }], lines: [] }, filters: [], countText: "0", printedAt: "x" }), /ไม่มีรายการ/);
});

test("no page or form of this module ever renders a password field or a secret label", () => {
  const source = read("modules/itua-pages.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /type="password"|data-mask|secret|license|cipher/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|document\./);
});
