import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// modules/module-itua.js (การเชื่อมต่อ: สิทธิ์ วาดหน้า ตัวกรอง ฟอร์มแก้ไข แก้ชนกัน ถามก่อนทิ้งฟอร์ม พิมพ์/ส่งออก ล้างข้อมูลทดสอบ)
// รันไฟล์จริง (model + pages + module) ใน vm กับ DOM จำลองเล็ก ๆ และฐานข้อมูลจำลองที่รับเฉพาะ RPC ที่สัญญากำหนด · ข้อมูลทั้งหมดเป็นของปลอม
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const tick = async (times = 6) => { for (let index = 0; index < times; index += 1) await flush(); };

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const STAMP = "2026-11-26T05:12:33.123456+00:00";
const LIST_ROWS = [
  { id: USER_ID, auth_id: "somchai.k", name_th: "สมชาย ใจดี", name_en: "Somchai", department_code: "ACC", division: "office", internet: true, status: "active", granted_doc_no: null, granted_on: null, folder_r: 1, folder_f: 0, program_count: 1, internal_email: "somchai@mnp.test", email_count: 1 },
  { id: OTHER_ID, auth_id: "mali.p", name_th: "=HYPERLINK(\"x\")", name_en: "", department_code: "IT", division: "factory", internet: false, status: "active", granted_doc_no: null, granted_on: null, folder_r: 0, folder_f: 0, program_count: 0, internal_email: null, email_count: 0 },
];
const CATALOG = {
  folders: [
    { id: "f1", code: "ACC", name: "บัญชี", description: "เอกสารบัญชี", sort: 10, is_active: true, grant_count: 1, updated_at: STAMP },
    { id: "f2", code: "HR", name: "บุคคล", description: null, sort: 20, is_active: true, grant_count: 0, updated_at: STAMP },
  ],
  programs: [
    { id: "p1", code: "IPRIME", name: "iPrime", sort: 10, is_active: true, grant_count: 0, updated_at: STAMP },
    { id: "p2", code: "OTHER", name: "อื่นๆ", sort: 90, is_active: true, grant_count: 0, updated_at: STAMP },
  ],
};
const detailOf = ({ user: userOverrides, ...overrides } = {}) => ({
  user: { id: USER_ID, auth_id: "somchai.k", name_th: "สมชาย ใจดี", name_en: "Somchai", department_code: "ACC", division: "office", internet: false, status: "active", granted_doc_no: "IT08-01-26/001", granted_on: "2026-01-05", note: null, employee_id: null, created_at: STAMP, updated_at: STAMP, ...userOverrides },
  folders: [{ folder_id: "f1", code: "ACC", name: "บัญชี", is_active: true, level: "R", updated_at: STAMP }],
  emails: [{ id: "e1", address: "somchai@mnp.test", kind: "internal", status: "active", created_at: STAMP, updated_at: STAMP }],
  programs: [],
  log: [{ id: 5, entity: "folder_grant", entity_id: "f1", entity_code: "ACC", action: "created", reason: "ขอใหม่", actor_employee_no: "IT3462", actor_full_name: "ผู้ดูแล ระบบ", old_values: null, new_values: { level: "R" }, source_request_id: null, source_doc_no: null, created_at: STAMP }],
  acknowledgements: [],
  ...overrides,
});

// ฟอร์มจำลองจาก HTML ที่โมดูลวาด: อ่านชื่อช่อง/ค่าเริ่มต้น/ติ๊กจากตัวหนังสือ แล้วให้เทสต์แก้ค่าเหมือนผู้ใช้พิมพ์
const attrsOf = (text) => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2].replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")]));
function makeForm(id, html) {
  const elements = [];
  for (const match of html.matchAll(/<input\b([^>]*)>/g)) {
    const attrs = attrsOf(match[1]);
    if (!attrs.name) continue;
    elements.push(attrs.type === "checkbox" ? { name: attrs.name, type: "checkbox", checked: /\schecked(\s|$)/.test(match[1]), disabled: /\sdisabled(\s|$)/.test(match[1]), value: "on" } : { name: attrs.name, type: attrs.type ?? "text", value: attrs.value ?? "" });
  }
  for (const match of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([^]*?)<\/select>/g)) {
    const options = [...match[2].matchAll(/<option value="([^"]*)"([^>]*)>/g)];
    const picked = options.find((option) => /\bselected\b/.test(option[2])) ?? options[0];
    elements.push({ name: match[1], type: "select-one", value: picked?.[1] ?? "" });
  }
  for (const match of html.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([^]*?)<\/textarea>/g)) elements.push({ name: match[1], type: "textarea", value: match[2].replaceAll("&amp;", "&") });
  for (const element of elements) elements[element.name] = element;
  return { id, elements, querySelector: () => null };
}

async function world({ allowed = true, accessStatus = "allowed", isTest = false, handlers = {}, confirm = true } = {}) {
  const calls = { rpc: [], toasts: [], confirms: [], went: [], busy: [], renderRoutes: 0, notFound: 0, prints: [], downloads: [], assigned: [] };
  const hosts = {};
  const elements = {};
  const forms = new Map();
  let hash = "#/office?module=access";
  let painted = "";
  let host = null;
  let authListener = null;
  const sheets = [];
  const newHost = () => {
    const listeners = {};
    const node = { listeners, addEventListener(type, handler) { (listeners[type] ??= []).push(handler); }, insertAdjacentHTML(position, html) { sheets.push({ html, removed: false, remove() { this.removed = true; } }); } };
    return node;
  };
  const el = (id) => (elements[id] ??= {
    id, dataset: {}, textContent: "", disabled: false, scrolled: 0, addEventListener() {},
    set innerHTML(html) {
      hosts[id] = html;
      if (id === "itua-form-area") { forms.clear(); const match = /<form id="([^"]+)"/.exec(html); if (match) forms.set(match[1], makeForm(match[1], html)); }
    },
    get innerHTML() { return hosts[id] ?? ""; },
    scrollIntoView() { this.scrolled += 1; },
  });
  const byId = (id) => forms.get(id) ?? el(id);
  const db = {
    app_itua_list_users: () => ({ total: LIST_ROWS.length, items: LIST_ROWS }),
    app_itua_matrix: () => ({ total: 2, folders: [{ id: "f1", code: "ACC", name: "บัญชี", description: "", sort: 10 }, { id: "f2", code: "HR", name: "บุคคล", description: "", sort: 20 }], rows: [{ user_id: USER_ID, auth_id: "somchai.k", name_th: "สมชาย ใจดี", name_en: "", department_code: "ACC", division: "office", status: "active", internet: true, levels: { ACC: "R" } }, { user_id: OTHER_ID, auth_id: "mali.p", name_th: "มะลิ", name_en: "", department_code: "IT", division: "factory", status: "active", internet: false, levels: { HR: "F" } }] }),
    app_itua_list_catalog: () => CATALOG,
    app_itua_get_user: ({ p_id }) => (p_id === USER_ID || p_id === NEW_ID ? detailOf({ user: { id: p_id } }) : (() => { throw Object.assign(new Error("ไม่พบผู้ใช้นี้"), { code: "23514" }); })()),
    app_sandbox_purge_itua: () => ({ deleted: 7 }),
    ...handlers,
  };
  const context = vm.createContext({});
  Object.assign(context, {
    window: context, console, URLSearchParams, Intl, Date, Number, Object, Promise, Array, JSON, Math, Set, Map, String, Boolean, Uint8Array, structuredClone,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; },
    crypto: { randomUUID: () => NEW_ID, getRandomValues: (bytes) => bytes },
    document: {
      getElementById: byId,
      querySelector: (selector) => (selector === ".itua-page" ? host : null),
      querySelectorAll: (selector) => (selector === ".itua-sheet" ? sheets.filter((sheet) => !sheet.removed) : []),
      addEventListener() {}, removeEventListener() {}, visibilityState: "visible",
      body: { appendChild() {} },
      createElement: () => ({ click() { calls.downloads.at(-1).fileName = this.download; }, remove() {} }),
    },
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    print: () => { calls.prints.push(sheets.filter((sheet) => !sheet.removed).map((sheet) => sheet.html)); },
    Blob: class { constructor(parts, options) { this.text = parts.join(""); this.type = options?.type; } },
    URL: { createObjectURL: (blob) => { calls.downloads.push({ text: blob.text, type: blob.type }); return "blob:test"; }, revokeObjectURL() {} },
    MNP_UI_ICONS: { icon: () => "" },
    location: { get hash() { return hash; }, set hash(value) { hash = value; calls.assigned.push(value); } },
    state: { session: { user: { id: "u1" } }, employee: { id: "e1" }, sandbox: isTest ? { active: true } : null },
    sb: {
      rpc: async (name, args) => {
        calls.rpc.push({ name, args });
        if (!db[name]) return { data: null, error: Object.assign(new Error(`unexpected rpc ${name}`), { code: "PGRST202" }) };
        try { return { data: await db[name](args), error: null }; } catch (error) { return { data: null, error }; }
      },
      auth: { onAuthStateChange: (callback) => { authListener = callback; } },
    },
    app: { set innerHTML(value) { painted = value; host = newHost(); }, get innerHTML() { return painted; } },
    shell: (html) => html, bindShell() {}, loadingShell() {},
    renderNotFound() { calls.notFound += 1; },
    go(path) { calls.went.push(path); },
    renderRoute: async () => { calls.renderRoutes += 1; },
    showToast: (message, type = "success") => { calls.toasts.push({ message, type }); },
    confirmDialog: async (options) => { calls.confirms.push(options); return confirm; },
    setFormBusy: (form, busy) => { calls.busy.push(busy); },
    setButtonBusy() {},
  });
  // ตัวแทนของทะเบียนอุปกรณ์ IT: โมดูลนี้ใช้ผลสิทธิ์ของมัน (app_itas_my_access) ไม่เรียก RPC ของ itas เอง
  context.window.MNP_ITAS = { resolveAccess: async () => allowed, hasAccess: () => allowed, accessStatus: () => accessStatus };
  for (const file of ["itua-model.js", "itua-pages.js", "module-itua.js"]) vm.runInContext(read(`modules/${file}`), context);
  const itua = context.window.MNP_ITUA;
  const open = async (query = "module=access") => {
    hash = `#/office?${query}`;
    await itua.render(new URLSearchParams(query));
    await tick();
  };
  const click = async (id, dataset = {}) => {
    const button = { id, dataset, closest: (selector) => (selector === "button, [data-itua-row]" ? button : null) };
    await host.listeners.click[0]({ target: button });
    await tick();
  };
  const clickRow = async (rowId, { onLink = false } = {}) => {
    const row = { id: "", dataset: { ituaRow: rowId }, closest: (selector) => (selector === "button, [data-itua-row]" ? row : selector === "a" && onLink ? {} : null) };
    await host.listeners.click[0]({ target: row });
    await tick();
  };
  const change = (id, value) => host.listeners.change[0]({ target: { id, value } });
  const typeSearch = (value) => host.listeners.input[0]({ target: { id: "itua-search", value } });
  const submit = async (formId) => { await host.listeners.submit[0]({ target: forms.get(formId), preventDefault() {} }); await tick(); };
  // ค่าที่โมดูลส่งมาสร้างในโลกของ vm (prototype คนละชุด) จึงแปลงผ่าน JSON ก่อนเทียบ
  const rpcCalls = (name) => calls.rpc.filter((call) => call.name === name).map((call) => (call.args === undefined ? undefined : JSON.parse(JSON.stringify(call.args))));
  return { context, itua, calls, hosts, forms, db, open, click, clickRow, change, typeSearch, submit, rpcCalls, html: () => painted, byId, setHash: (value) => { hash = value; }, signOut: () => authListener?.("SIGNED_OUT"), sheets };
}
const setValue = (form, name, value) => { form.elements[name].value = value; };

/* ---------- สิทธิ์ ---------- */
test("without access the page goes home and calls no RPC; a failed check shows a retry; it uses only the asset-register's access result", async () => {
  const denied = await world({ allowed: false, accessStatus: "denied" });
  await denied.open();
  assert.deepEqual(denied.calls.went, ["dashboard"]);
  assert.deepEqual(denied.calls.rpc, []);
  assert.equal(denied.html(), "");
  const failed = await world({ allowed: false, accessStatus: "error" });
  await failed.open();
  assert.deepEqual(failed.calls.went, []);
  assert.match(failed.html(), /ตรวจสิทธิ์ไม่ได้ กรุณาลองใหม่อีกครั้ง/);
  assert.match(failed.html(), /id="itua-retry"/);
  assert.deepEqual(failed.calls.rpc, []);
  const ok = await world();
  await ok.open();
  assert.equal(ok.rpcCalls("app_itas_my_access").length, 0, "no second access lookup of its own");
  const none = await world();
  none.context.window.MNP_ITAS = undefined;
  assert.equal(await none.itua.resolveAccess(), false);
  assert.equal(none.itua.hasAccess(), false);
  assert.equal(none.itua.accessStatus(), "denied");
});

test("an unknown route is not found; the module announces its card and its API is frozen", async () => {
  const app = await world();
  await app.open("module=access&view=nope");
  assert.equal(app.calls.notFound, 1);
  assert.deepEqual(app.calls.rpc, []);
  assert.deepEqual({ ...app.context.window.MNP_OFFICE_CARDS.IT_USER_ACCESS }, { version: "1.00", inDevelopment: true });
  assert.equal(Object.isFrozen(app.itua), true);
  assert.equal(app.itua.version, "1.00");
  assert.equal(app.itua.inDevelopment, true);
});

/* ---------- รายการ / กรอง ---------- */
test("the list loads every user in one call, shows them, and filters in the browser without calling the database again", async () => {
  const app = await world();
  await app.open();
  assert.deepEqual(app.rpcCalls("app_itua_list_users"), [{ p_limit: 2000, p_offset: 0 }]);
  assert.match(app.html(), /ผู้ใช้ในทะเบียน/);
  assert.match(app.html(), /somchai\.k/);
  assert.match(app.html(), /2 คน/);
  assert.match(app.html(), /กำลังพัฒนา/);
  app.typeSearch("somchai");
  assert.match(app.byId("itua-table-host").innerHTML, /somchai\.k/);
  assert.doesNotMatch(app.byId("itua-table-host").innerHTML, /mali\.p/);
  assert.equal(app.byId("itua-count").textContent, "แสดง 1 จาก 2 คน");
  app.typeSearch("");
  app.change("itua-dept", "IT");
  assert.doesNotMatch(app.byId("itua-table-host").innerHTML, /somchai\.k/);
  assert.equal(app.byId("itua-print").disabled, false);
  app.change("itua-dept", "");
  app.change("itua-division", "factory");
  app.change("itua-status", "resigned");
  assert.match(app.byId("itua-table-host").innerHTML, /ไม่พบผู้ใช้/);
  assert.equal(app.byId("itua-print").disabled, true, "nothing to print");
  assert.equal(app.byId("itua-export").disabled, true);
  assert.equal(app.rpcCalls("app_itua_list_users").length, 1);
});

test("clicking a row opens that person's own route; a click on the link inside the row is left to the browser", async () => {
  const app = await world();
  await app.open();
  await app.clickRow(USER_ID, { onLink: true });
  assert.deepEqual(app.calls.assigned, []);
  await app.clickRow(USER_ID);
  assert.deepEqual(app.calls.assigned, [`#/office?module=access&user=${USER_ID}`]);
  await app.clickRow("not-a-uuid");
  assert.equal(app.calls.assigned.length, 1);
});

test("a list that fails to load shows the Thai message instead of a half page", async () => {
  const app = await world({ handlers: { app_itua_list_users: () => { throw Object.assign(new Error("เฉพาะผู้ดูแลงาน IT เท่านั้น"), { code: "42501" }); } } });
  await app.open();
  assert.match(app.html(), /เฉพาะผู้ดูแลงาน IT เท่านั้น/);
  assert.doesNotMatch(app.html(), /id="itua-table-host"/);
});

test("the matrix loads from its own RPC and shares the filters; the filter survives a trip to the user page and back", async () => {
  const app = await world();
  await app.open("module=access&view=matrix");
  assert.equal(app.rpcCalls("app_itua_matrix").length, 1);
  assert.match(app.html(), /เมทริกซ์สิทธิ์ผู้ใช้ × โฟลเดอร์/);
  assert.match(app.html(), /class="itua-cell is-r">R</);
  assert.doesNotMatch(app.html(), /id="itua-add"/, "no add button on the matrix");
  app.change("itua-division", "factory");
  assert.doesNotMatch(app.byId("itua-table-host").innerHTML, /somchai\.k/);
  await app.open(`module=access&user=${USER_ID}`);
  await app.open("module=access");
  assert.match(app.html(), /<option value="factory" selected>/, "the division filter is still set");
  assert.doesNotMatch(app.byId("itua-table-host").innerHTML ?? "", /somchai\.k/);
});

/* ---------- พิมพ์ / ส่งออก ---------- */
test("print puts a one-off sheet into the page and calls window.print; export downloads a quoted CSV with formula starts neutralised", async () => {
  const app = await world({ isTest: true });
  await app.open();
  await app.click("itua-print");
  assert.equal(app.calls.prints.length, 1);
  assert.match(app.calls.prints[0][0], /class="itua-sheet"/);
  assert.match(app.calls.prints[0][0], /ข้อมูลทดสอบ/);
  assert.match(app.calls.prints[0][0], /somchai\.k/);
  await app.click("itua-export");
  assert.equal(app.calls.downloads.length, 1);
  assert.match(app.calls.downloads[0].fileName, /^itua-list-test-\d{8}\.csv$/);
  assert.equal(app.calls.downloads[0].type, "text/csv;charset=utf-8");
  assert.ok(app.calls.downloads[0].text.startsWith("﻿"));
  assert.ok(app.calls.downloads[0].text.includes(`"'=HYPERLINK(""x"")"`), "formula start neutralised");
  assert.match(app.calls.toasts.at(-1).message, /ส่งออก 2 คนแล้ว/);
  app.change("itua-status", "resigned");
  await app.click("itua-print");
  assert.equal(app.calls.prints.length, 1, "nothing to print for an empty filter");
  assert.equal(app.calls.toasts.at(-1).type, "error");
});

test("the matrix prints a landscape matrix sheet and exports the folder columns", async () => {
  const app = await world();
  await app.open("module=access&view=matrix");
  await app.click("itua-print");
  assert.match(app.calls.prints[0][0], /itua-sheet is-matrix/);
  assert.match(app.calls.prints[0][0], /<span>บัญชี<\/span>/);
  await app.click("itua-export");
  assert.match(app.calls.downloads[0].fileName, /^itua-matrix-real-/);
  assert.match(app.calls.downloads[0].text, /"บัญชี","บุคคล"/);
});

/* ---------- หน้าต่อคน ---------- */
test("a person's page loads the user and the catalog, shows history with folder names, and reports a missing user", async () => {
  const app = await world();
  await app.open(`module=access&user=${USER_ID}`);
  assert.deepEqual(app.rpcCalls("app_itua_get_user"), [{ p_id: USER_ID, p_log_limit: 200 }]);
  assert.equal(app.rpcCalls("app_itua_list_catalog").length, 1);
  assert.match(app.html(), /IT08-01-26\/001/);
  assert.match(app.html(), /เพิ่มสิทธิ์โฟลเดอร์ บัญชี ระดับ R/, "the code in the history is shown as the folder name");
  assert.match(app.html(), /เหตุผล:<\/span> ขอใหม่/);
  assert.match(app.html(), /id="itua-edit-grants"/);
  assert.doesNotMatch(app.html(), /class="itua-tab[ "]/);
  const missing = await world();
  await missing.open(`module=access&user=${OTHER_ID}`);
  assert.match(missing.html(), /ไม่พบผู้ใช้นี้/);
});

/* ---------- แก้ไขข้อมูลหลัก ---------- */
test("editing sends only the changed fields with the loaded updated_at and the reason; a missing reason and an empty change send nothing", async () => {
  const app = await world({ handlers: { app_itua_save_user: (args) => ({ user: detailOf().user, created: false, changed: true, args }) } });
  await app.open(`module=access&user=${USER_ID}`);
  await app.click("itua-edit-user");
  const form = app.forms.get("itua-user-form");
  assert.ok(form, "the form is open");
  assert.equal(form.elements.granted_on.value, "05/01/2569");
  await app.submit("itua-user-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_user"), [], "nothing changed: no call");
  assert.match(app.calls.toasts.at(-1).message, /ไม่มีการเปลี่ยนแปลง/);
  setValue(form, "name_th", "สมชาย ใหม่");
  await app.submit("itua-user-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_user"), [], "a reason is required when editing");
  setValue(form, "reason", "แก้ชื่อตามบัตร");
  await app.submit("itua-user-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_user"), [{ p_id: USER_ID, p_data: { name_th: "สมชาย ใหม่" }, p_reason: "แก้ชื่อตามบัตร", p_expected_updated_at: STAMP }]);
  assert.equal(app.byId("itua-form-area").innerHTML, "", "the form closes after saving");
  assert.equal(app.rpcCalls("app_itua_get_user").length, 2, "the page data is reloaded");
  assert.match(app.calls.toasts.at(-1).message, /บันทึกการแก้ไขแล้ว/);
});

test("adding a user uses a draft id, sends every filled field without a reason, and opens the new person's page; a retry after a lost answer finds the saved row", async () => {
  const app = await world({ handlers: { app_itua_save_user: ({ p_id }) => ({ user: { ...detailOf().user, id: p_id }, created: true, changed: true }) } });
  await app.open();
  await app.click("itua-add");
  const form = app.forms.get("itua-user-form");
  setValue(form, "auth_id", "New.User");
  await app.submit("itua-user-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_user"), [], "a name and a division are needed");
  setValue(form, "name_en", "New User");
  setValue(form, "division", "factory");
  setValue(form, "department_code", "pp");
  await app.submit("itua-user-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_user"), [{ p_id: NEW_ID, p_data: { auth_id: "new.user", name_en: "New User", department_code: "PP", division: "factory" }, p_reason: null, p_expected_updated_at: null }]);
  assert.deepEqual(app.calls.assigned, [`#/office?module=access&user=${NEW_ID}`]);
  // เน็ตหลุดหลังบันทึกครั้งแรก แล้วกดซ้ำ: ฐานข้อมูลตอบว่ามีอยู่แล้ว → โหลดแถวมาถือว่าสำเร็จ
  const retry = await world({ handlers: { app_itua_save_user: () => { throw Object.assign(new Error("ผู้ใช้นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไข"), { code: "23514" }); } } });
  await retry.open();
  await retry.click("itua-add");
  const again = retry.forms.get("itua-user-form");
  setValue(again, "auth_id", "x1");
  setValue(again, "name_en", "X");
  setValue(again, "division", "office");
  await retry.submit("itua-user-form");
  assert.deepEqual(retry.rpcCalls("app_itua_get_user"), [{ p_id: NEW_ID, p_log_limit: 1 }]);
  assert.deepEqual(retry.calls.assigned, [`#/office?module=access&user=${NEW_ID}`]);
});

test("a database refusal keeps the form open with its text and the Thai message", async () => {
  const app = await world({ handlers: { app_itua_save_user: () => { throw Object.assign(new Error("Auth. Name somchai.k ซ้ำกับผู้ใช้อื่น"), { code: "23514" }); } } });
  await app.open();
  await app.click("itua-add");
  const form = app.forms.get("itua-user-form");
  setValue(form, "auth_id", "somchai.k");
  setValue(form, "name_en", "X");
  setValue(form, "division", "office");
  await app.submit("itua-user-form");
  assert.match(app.byId("itua-form-message").innerHTML, /ซ้ำกับผู้ใช้อื่น/);
  assert.doesNotMatch(app.byId("itua-form-message").innerHTML, /itua-reload/, "a duplicate is not a conflict");
  assert.equal(app.forms.get("itua-user-form"), form, "still open with the typed values");
  assert.equal(form.elements.auth_id.value, "somchai.k");
  assert.equal(app.calls.toasts.at(-1).type, "error");
  assert.equal(app.calls.busy.at(-1), false, "the buttons are usable again");
});

/* ---------- สถานะ ---------- */
test("resigning asks for a reason, warns what is left, sends set_status and tells the user to remove the rest", async () => {
  const app = await world({ handlers: { app_itua_set_status: ({ p_status }) => ({ user: { ...detailOf().user, status: p_status }, changed: true, remaining: { folders: 1, programs: 0, internet: false, emails: 1 } }) } });
  await app.open(`module=access&user=${USER_ID}`);
  await app.click("itua-change-status");
  assert.match(app.byId("itua-form-area").innerHTML, /ไม่ถอดสิทธิ์ให้เอง/);
  assert.match(app.byId("itua-form-area").innerHTML, /โฟลเดอร์ 1 รายการ/);
  await app.submit("itua-status-form");
  assert.deepEqual(app.rpcCalls("app_itua_set_status"), [], "reason first");
  setValue(app.forms.get("itua-status-form"), "reason", "ลาออก 30/11");
  await app.submit("itua-status-form");
  assert.deepEqual(app.rpcCalls("app_itua_set_status"), [{ p_user_id: USER_ID, p_status: "resigned", p_reason: "ลาออก 30/11" }]);
  assert.match(app.calls.toasts.at(-1).message, /ยังมีสิทธิ์เหลือ: โฟลเดอร์ 1 รายการ · อีเมลที่ใช้งานอยู่ 1 รายการ/);
});

/* ---------- สิทธิ์: แก้เป็นชุด ---------- */
test("the grants form sends the whole change set once with from and to; no change, no reason and a missing note for 'other' send nothing", async () => {
  const app = await world({ handlers: { app_itua_set_grants: ({ p_changes }) => ({ user_id: USER_ID, applied: p_changes.length, changes: p_changes }) } });
  await app.open(`module=access&user=${USER_ID}`);
  await app.click("itua-edit-grants");
  const form = app.forms.get("itua-grants-form");
  assert.equal(form.elements["folder:ACC"].value, "R", "the current level is preselected");
  await app.submit("itua-grants-form");
  assert.deepEqual(app.rpcCalls("app_itua_set_grants"), []);
  assert.match(app.calls.toasts.at(-1).message, /ยังไม่ได้เปลี่ยนสิทธิ์ใด ๆ/);
  setValue(form, "folder:ACC", "F");
  setValue(form, "folder:HR", "R");
  form.elements.internet.checked = true;
  form.elements["program:OTHER"].checked = true;
  await app.submit("itua-grants-form");
  assert.deepEqual(app.rpcCalls("app_itua_set_grants"), [], "no reason and no note for 'other' yet");
  setValue(form, "reason", "ย้ายมาแผนกบัญชี");
  await app.submit("itua-grants-form");
  assert.deepEqual(app.rpcCalls("app_itua_set_grants"), [], "the 'other' program still needs its note");
  setValue(form, "note:OTHER", "AutoCAD");
  await app.submit("itua-grants-form");
  assert.deepEqual(app.rpcCalls("app_itua_set_grants"), [{
    p_user_id: USER_ID,
    p_changes: [
      { kind: "folder", code: "ACC", from: "R", to: "F" },
      { kind: "folder", code: "HR", from: null, to: "R" },
      { kind: "internet", from: false, to: true },
      { kind: "program", code: "OTHER", from: false, to: true, note: "AutoCAD" },
    ],
    p_reason: "ย้ายมาแผนกบัญชี",
  }]);
  assert.equal(app.byId("itua-form-area").innerHTML, "");
  assert.match(app.calls.toasts.at(-1).message, /บันทึกสิทธิ์แล้ว 4 รายการ/);
  assert.equal(app.rpcCalls("app_itua_get_user").length, 2);
});

test("a grants conflict (40001) tells the user to reload; reloading asks first, then reopens the form with the latest data", async () => {
  let attempts = 0;
  const app = await world({ handlers: { app_itua_set_grants: () => { attempts += 1; throw Object.assign(new Error("สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่"), { code: "40001" }); } } });
  await app.open(`module=access&user=${USER_ID}`);
  await app.click("itua-edit-grants");
  const form = app.forms.get("itua-grants-form");
  setValue(form, "folder:HR", "F");
  setValue(form, "reason", "ทดสอบชน");
  await app.submit("itua-grants-form");
  assert.equal(attempts, 1);
  assert.match(app.byId("itua-form-message").innerHTML, /โหลดข้อมูลล่าสุด/);
  assert.match(app.byId("itua-form-message").innerHTML, /id="itua-reload"/);
  assert.equal(app.forms.get("itua-grants-form"), form, "the typed form stays until the user chooses to reload");
  const before = app.rpcCalls("app_itua_get_user").length;
  await app.click("itua-reload");
  assert.match(app.calls.confirms.at(-1).title, /โหลดข้อมูลล่าสุด/);
  assert.equal(app.rpcCalls("app_itua_get_user").length, before + 1);
  const reopened = app.forms.get("itua-grants-form");
  assert.ok(reopened && reopened !== form, "a fresh form with the latest data");
  assert.equal(reopened.elements["folder:HR"].value, "", "the typed change is gone");
  const declined = await world({ confirm: false, handlers: { app_itua_set_grants: () => { throw Object.assign(new Error("x"), { code: "40001" }); } } });
  await declined.open(`module=access&user=${USER_ID}`);
  await declined.click("itua-edit-grants");
  const kept = declined.forms.get("itua-grants-form");
  setValue(kept, "folder:HR", "F");
  setValue(kept, "reason", "r");
  await declined.submit("itua-grants-form");
  await declined.click("itua-reload");
  assert.equal(declined.forms.get("itua-grants-form"), kept, "'stay' keeps what was typed");
});

/* ---------- อีเมล ---------- */
test("adding an email defaults to 'other' when an internal one is active; closing one needs a reason", async () => {
  const app = await world({ handlers: { app_itua_add_email: ({ p_address }) => ({ email: { address: p_address }, created: true }), app_itua_close_email: () => ({ email: {}, changed: true }) } });
  await app.open(`module=access&user=${USER_ID}`);
  await app.click("itua-add-email");
  const form = app.forms.get("itua-email-add-form");
  assert.equal(form.elements.kind.value, "extra", "the user already has an internal email");
  setValue(form, "address", "not an email");
  await app.submit("itua-email-add-form");
  assert.deepEqual(app.rpcCalls("app_itua_add_email"), []);
  setValue(form, "address", "  Mali@Example.com ");
  await app.submit("itua-email-add-form");
  assert.deepEqual(app.rpcCalls("app_itua_add_email"), [{ p_user_id: USER_ID, p_address: "Mali@Example.com", p_kind: "extra", p_reason: null }]);
  await app.click("", { ituaCloseEmail: "e1" });
  assert.match(app.byId("itua-form-area").innerHTML, /ปิดอีเมล · somchai@mnp\.test/);
  await app.submit("itua-email-close-form");
  assert.deepEqual(app.rpcCalls("app_itua_close_email"), [], "reason first");
  setValue(app.forms.get("itua-email-close-form"), "reason", "ลาออก");
  await app.submit("itua-email-close-form");
  assert.deepEqual(app.rpcCalls("app_itua_close_email"), [{ p_email_id: "e1", p_reason: "ลาออก" }]);
  assert.match(app.calls.toasts.at(-1).message, /ปิดอีเมลแล้ว/);
});

/* ---------- ตั้งค่า ---------- */
test("settings: a duplicate folder code on add is refused before any call; a new one and an edit send the folder params", async () => {
  const app = await world({ handlers: { app_itua_save_folder: ({ p_code }) => ({ id: "x", code: p_code, created: !CATALOG.folders.some((item) => item.code === p_code), changed: true }), app_itua_save_program: ({ p_code }) => ({ id: "y", code: p_code, created: true, changed: true }) } });
  await app.open("module=access&view=catalog");
  assert.equal(app.rpcCalls("app_itua_list_catalog").length, 1);
  assert.match(app.html(), /รายการโฟลเดอร์แชร์/);
  await app.click("itua-add-folder");
  let form = app.forms.get("itua-catalog-form");
  setValue(form, "code", "acc");
  setValue(form, "name", "ซ้ำ");
  await app.submit("itua-catalog-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_folder"), [], "an existing code would silently become an edit");
  setValue(form, "code", "new-1");
  setValue(form, "name", "โฟลเดอร์ใหม่");
  setValue(form, "description", "ทดสอบ");
  await app.submit("itua-catalog-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_folder"), [{ p_code: "NEW-1", p_name: "โฟลเดอร์ใหม่", p_description: "ทดสอบ", p_sort: 100, p_is_active: true, p_reason: null }]);
  assert.match(app.calls.toasts.at(-1).message, /เพิ่มโฟลเดอร์แล้ว/);
  await app.click("", { ituaEditFolder: "ACC" });
  form = app.forms.get("itua-catalog-form");
  assert.equal(form.elements.code.value, "ACC");
  await app.submit("itua-catalog-form");
  assert.equal(app.rpcCalls("app_itua_save_folder").length, 1, "no change, no call");
  form.elements.is_active.checked = false;
  await app.submit("itua-catalog-form");
  assert.equal(app.rpcCalls("app_itua_save_folder").length, 1, "a reason is needed");
  setValue(form, "reason", "เลิกใช้");
  await app.submit("itua-catalog-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_folder").at(-1), { p_code: "ACC", p_name: "บัญชี", p_description: "เอกสารบัญชี", p_sort: 10, p_is_active: false, p_reason: "เลิกใช้" });
  await app.click("itua-add-program");
  form = app.forms.get("itua-catalog-form");
  setValue(form, "code", "autocad");
  setValue(form, "name", "AutoCAD");
  await app.submit("itua-catalog-form");
  assert.deepEqual(app.rpcCalls("app_itua_save_program"), [{ p_code: "AUTOCAD", p_name: "AutoCAD", p_sort: 100, p_is_active: true, p_reason: null }]);
});

/* ---------- ถามก่อนทิ้งฟอร์ม ---------- */
test("an open form with nothing typed has nothing to lose; typed text counts; leaving the page drops the probe for good", async () => {
  const app = await world();
  await app.open(`module=access&user=${USER_ID}`);
  assert.equal(app.itua.unsavedCount(), 0, "no form");
  await app.click("itua-edit-user");
  assert.equal(app.itua.unsavedCount(), 0, "an untouched form");
  const form = app.forms.get("itua-user-form");
  setValue(form, "name_th", "พิมพ์ค้าง");
  assert.equal(app.itua.unsavedCount(), 1);
  setValue(form, "name_th", "สมชาย ใจดี");
  assert.equal(app.itua.unsavedCount(), 0, "back to the loaded value");
  setValue(form, "note", "x");
  assert.equal(app.itua.unsavedCount(), 1);
  const home = `#/office?module=access&user=${USER_ID}`;
  app.setHash("#/office?module=it-support");
  assert.equal(app.itua.unsavedCount(), 0, "outside the module nothing is counted");
  app.setHash(home);
  assert.equal(app.itua.unsavedCount(), 0, "the probe was dropped, so coming back to the old hash does not revive it");
});

test("opening another form over a typed one asks first; declining keeps the typed form", async () => {
  const app = await world({ confirm: false });
  await app.open(`module=access&user=${USER_ID}`);
  await app.click("itua-edit-user");
  const form = app.forms.get("itua-user-form");
  setValue(form, "note", "พิมพ์ค้าง");
  await app.click("itua-edit-grants");
  assert.equal(app.calls.confirms.length, 1);
  assert.equal(app.calls.confirms[0].danger, true);
  assert.equal(app.forms.get("itua-user-form"), form);
  assert.equal(app.forms.has("itua-grants-form"), false);
  const yes = await world({ confirm: true });
  await yes.open(`module=access&user=${USER_ID}`);
  await yes.click("itua-edit-user");
  setValue(yes.forms.get("itua-user-form"), "note", "พิมพ์ค้าง");
  await yes.click("itua-edit-grants");
  assert.equal(yes.forms.has("itua-grants-form"), true);
  assert.equal(yes.forms.has("itua-user-form"), false);
  // ปุ่มย้อนกลับ/ยกเลิกของฟอร์มที่พิมพ์ค้างถามก่อนเช่นกัน
  const cancel = await world({ confirm: false });
  await cancel.open(`module=access&user=${USER_ID}`);
  await cancel.click("itua-edit-user");
  setValue(cancel.forms.get("itua-user-form"), "note", "x");
  await cancel.click("itua-form-back");
  assert.equal(cancel.calls.confirms.length, 1);
  assert.equal(cancel.forms.has("itua-user-form"), true);
  const clean = await world();
  await clean.open(`module=access&user=${USER_ID}`);
  await clean.click("itua-edit-user");
  await clean.click("itua-form-cancel");
  assert.equal(clean.calls.confirms.length, 0, "nothing typed, nothing to ask");
  assert.equal(clean.forms.size, 0);
});

/* ---------- ล้างข้อมูลทดสอบ / ออกจากระบบ ---------- */
test("the purge button exists only in test mode, asks first, calls the purge RPC and reloads the page", async () => {
  const real = await world();
  await real.open();
  assert.doesNotMatch(real.html(), /itua-purge/);
  const app = await world({ isTest: true });
  await app.open();
  assert.match(app.html(), /id="itua-purge"/);
  await app.click("itua-purge");
  assert.match(app.calls.confirms.at(-1).title, /ล้างข้อมูลทะเบียนสิทธิ์ผู้ใช้ทดสอบ/);
  assert.equal(app.rpcCalls("app_sandbox_purge_itua").length, 1);
  assert.match(app.calls.toasts.at(-1).message, /ล้างข้อมูลทะเบียนสิทธิ์ผู้ใช้ทดสอบแล้ว 7 รายการ/);
  assert.equal(app.calls.renderRoutes, 1);
  const onUser = await world({ isTest: true });
  await onUser.open(`module=access&user=${USER_ID}`);
  await onUser.click("itua-purge");
  assert.deepEqual(onUser.calls.assigned, ["#/office?module=access"], "the test person is gone, so go back to the list");
  const refused = await world({ isTest: true, confirm: false });
  await refused.open();
  await refused.click("itua-purge");
  assert.equal(refused.rpcCalls("app_sandbox_purge_itua").length, 0);
});

test("signing out drops the loaded data (the next page loads it again)", async () => {
  const app = await world();
  await app.open();
  assert.equal(app.rpcCalls("app_itua_list_users").length, 1);
  app.signOut();
  await app.open();
  assert.equal(app.rpcCalls("app_itua_list_users").length, 2);
});

/* ---------- ขอบเขตของโมดูล ---------- */
test("the module only calls its own RPCs, keeps nothing on the device, and has no console output or secret fields", () => {
  const source = read("modules/module-itua.js").replace(/\/\/.*$/gm, "");
  const rpcNames = [...source.matchAll(/rpc\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(rpcNames.length >= 10);
  for (const name of rpcNames) assert.match(name, /^app_itua_|^app_sandbox_purge_itua$/, name);
  assert.doesNotMatch(source, /app_itas_|app_itwo_|app_itrp_/, "access comes from MNP_ITAS, not its RPCs");
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|MNP_FORM_DRAFT|type="password"|data-mask/);
  assert.match(read("modules/module-itua.js"), /window\.MNP_ITUA = api/);
});
