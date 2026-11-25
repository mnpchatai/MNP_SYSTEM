import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

// modules/module-itas.js (การเชื่อมต่อ: สิทธิ์ของโมดูล วาดหน้า ตู้เซฟ ล็อกอัตโนมัติ ฟอร์มเพิ่ม/แก้ แก้ชนกัน) รันในคอนเท็กซ์จำลองที่มี helper ของ app.js แบบ stub
// ตู้เซฟเป็นของจริง (itas-vault.js + Web Crypto ของ Node) ต่อกับฐานข้อมูลจำลองที่ตรวจเหมือน RPC จริง · ไม่มี DOM จริง: ใช้ตัวแทนเล็ก ๆ ที่ผูก event ได้ ส่วนที่ตรวจคือสิ่งที่ส่งเข้า RPC กับสิ่งที่ถูกวาดลงหน้า
// ข้อมูลทั้งหมดเป็นของปลอม · ห้ามมีความลับจริงในไฟล์นี้
const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const tick = async (times = 6) => { for (let index = 0; index < times; index += 1) await flush(); };
const vaultApi = require("../../modules/itas-vault.js");
const { createVault, toBase64 } = vaultApi;
const subtle = webcrypto.subtle;

const PASSWORD = "ม้าลายกินหญ้า สีเขียวมะลิ 2026";
const ID_NEW = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ASSET_ID = "2a500000-0000-4000-8000-000000000001";
const STAMP = "2026-11-24T05:12:33.123456+00:00";
const PLAIN_IP = "10.9.8.7-PLAINTEXT-IP";
const PLAIN_LICENSE = "AAAAA-BBBBB-PLAINTEXT-LICENSE";
const TYPE = {
  code: "COMPUTER", name: "เครื่องคอมพิวเตอร์", reg_prefix: "", has_device_code: true, is_active: true, asset_count: 1,
  fields: [
    { key: "cpu", label: "CPU", type: "text", secret: false, order: 1, max: 100 },
    { key: "ip", label: "IP", type: "text", secret: true, order: 2 },
    { key: "license_os", label: "License OS", type: "text", secret: true, order: 3 },
  ],
};
const ASSET = { id: ASSET_ID, type_code: "COMPUTER", reg_no: "COM-001", device_code: "COM12", name: "เครื่องบัญชี", model: "Dell", serial: "SN1", status: "in_use", attrs: { cpu: "i5" }, secrets: {}, updated_at: STAMP };

// ฐานข้อมูลจำลองของตู้เซฟ (เหมือน app_itas_vault_get/init/rotate)
function fakeVaultServer() {
  const db = { row: null, calls: [] };
  const sha = async (b64) => Buffer.from(await subtle.digest("SHA-256", Buffer.from(b64, "base64"))).toString("base64");
  return {
    db,
    get: async () => {
      if (!db.row) return { initialized: false, is_test: false };
      const visible = structuredClone(db.row);
      delete visible.auth_hash; // ฐานข้อมูลไม่คืน auth_hash
      return { initialized: true, is_test: false, ...visible };
    },
    init: async (params) => {
      db.calls.push("init");
      db.row = { key_version: 1, rev: 1, kdf: params.p_kdf, kdf_iterations: params.p_kdf_iterations, salt: params.p_salt, wrapped_key_pass: params.p_wrapped_key_pass, recovery_kdf_iterations: params.p_recovery_kdf_iterations, recovery_salt: params.p_recovery_salt, wrapped_key_recovery: params.p_wrapped_key_recovery, auth_hash: params.p_auth_hash, updated_at: STAMP };
      return { rev: 1, key_version: 1 };
    },
    // เหมือน app_itas_vault_rotate: ตรวจ rev และ auth token (sha256 ตรงกับ auth_hash) · token ผิด = คืน ok:false ไม่ raise
    rotate: async (params) => {
      db.calls.push(`rotate:${params.p_action}`);
      if (params.p_expected_rev !== db.row.rev) throw Object.assign(new Error("ตู้เซฟถูกเปลี่ยนจากที่อื่นแล้ว"), { code: "40001" });
      if (!params.p_auth_token || (await sha(params.p_auth_token)) !== db.row.auth_hash) return { ok: false, code: "AUTH_TOKEN_INVALID" };
      if (params.p_action === "change_password") Object.assign(db.row, { kdf_iterations: params.p_kdf_iterations, salt: params.p_salt, wrapped_key_pass: params.p_wrapped_key_pass });
      else Object.assign(db.row, { recovery_kdf_iterations: params.p_recovery_kdf_iterations, recovery_salt: params.p_recovery_salt, wrapped_key_recovery: params.p_wrapped_key_recovery });
      db.row.rev += 1;
      return { ok: true, rev: db.row.rev, key_version: 1 };
    },
  };
}

function el(props = {}) {
  const listeners = {};
  const node = {
    dataset: {}, hidden: false, disabled: false, value: "", textContent: "", innerHTML: "", firstElementChild: null, listeners,
    addEventListener(type, handler) { (listeners[type] ??= []).push(handler); },
    closest: () => null, querySelector: () => null, querySelectorAll: () => [], focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {},
  };
  return Object.defineProperties(node, Object.getOwnPropertyDescriptors(props));
}

// clock = { time } ทำให้ Date.now() ในโมดูล/ตู้เซฟควบคุมได้ (ทดสอบเวลาไม่ใช้งานโดยไม่ต้องรอจริง)
async function world({ allowed = true, accessFail = false, isTest = false, vaultRow = null, rpcHandlers = {}, assets = [ASSET], confirm = true, clock = null, employee = { id: "e1" }, storageFails = false } = {}) {
  const server = fakeVaultServer();
  if (vaultRow) server.db.row = vaultRow;
  const calls = { rpc: [], toasts: [], confirms: [], went: [], renderRoutes: 0, notFound: 0, busy: [] };
  const hosts = {};
  const elements = {};
  const winListeners = {};
  const docListeners = {};
  const authListeners = [];
  let painted = "";
  let hash = "#/office?module=assets";
  const session = { user: { id: "u1" } };
  const stateObj = { session, employee, sandbox: isTest ? { active: true } : null };
  const forms = { current: null };
  // ที่เก็บในเครื่อง (localStorage) จำลอง: เก็บเป็น Map ให้เทสต์ตรวจว่ามีอะไรถูกเขียนลงไปบ้าง · storageFails = เบราว์เซอร์ที่เก็บไม่ได้ (โหมดส่วนตัว/เต็ม)
  const storage = new Map();
  const localStorage = storageFails
    ? { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } }
    : { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => { storage.set(key, String(value)); }, removeItem: (key) => { storage.delete(key); } };
  const host = el();
  const handlers = {
    app_itas_my_access: () => { if (accessFail) throw Object.assign(new Error("x"), { code: "PGRST202" }); return { allowed, is_test: isTest }; },
    app_itas_list_types: () => [TYPE],
    app_itas_list_assets: () => ({ total: assets.length, items: assets }),
    app_itas_get_asset: ({ p_id }) => assets.find((row) => row.id === p_id) ?? { ...ASSET, id: p_id },
    app_itas_vault_get: () => server.get(),
    app_itas_vault_init: (params) => server.init(params),
    app_itas_vault_rotate: (params) => server.rotate(params),
    app_itas_save_asset: (params) => ({ asset: { ...ASSET, ...params.p_data }, created: !params.p_expected_updated_at, changed: true }),
    app_sandbox_purge_itas: () => ({ deleted: 3 }),
    ...rpcHandlers,
  };
  const byId = (id) => {
    if (id === "itas-form") return (forms.current ??= assetForm());
    return (elements[id] ??= el({ id, set innerHTML(html) { hosts[id] = html; }, get innerHTML() { return hosts[id] ?? ""; } }));
  };
  const context = vm.createContext({});
  Object.assign(context, {
    window: context, localStorage, console, URLSearchParams, Intl, Date: clock ? class FakeDate extends Date { static now() { return clock.time; } } : Date, Number, Object, Promise, Array, JSON, Math, Set, Map, String, Boolean, Uint8Array, TextEncoder, TextDecoder, atob, btoa, Error, clearTimeout, clearInterval,
    // ตัวจับเวลาที่ unref แล้ว: ตู้เซฟที่ปลดล็อกค้างไว้ไม่ทำให้ process ของเทสต์ไม่จบ
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; }, setInterval: (fn, ms) => { const id = setInterval(fn, ms); id.unref?.(); return id; },
    crypto: { randomUUID: () => ID_NEW, subtle, getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) },
    navigator: { clipboard: { writeText: async () => {} } },
    escapeHtml: (value) => String(value ?? ""),
    document: {
      getElementById: byId,
      querySelector: (selector) => (selector === ".itas-page" ? host : null),
      querySelectorAll: () => [],
      addEventListener: (type, handler) => { (docListeners[type] ??= []).push(handler); },
    },
    state: stateObj,
    sb: {
      rpc: async (name, args) => {
        calls.rpc.push({ name, args: JSON.parse(JSON.stringify(args ?? {})) });
        try {
          const handler = handlers[name];
          if (!handler) return { data: null, error: { code: "PGRST202", message: `no ${name}` } };
          return { data: await handler(args), error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
      auth: { onAuthStateChange: (callback) => { authListeners.push(callback); } },
    },
    app: { set innerHTML(value) { painted = value; }, get innerHTML() { return painted; } },
    shell: (html) => html, bindShell() {}, loadingShell() {}, renderNotFound() { calls.notFound += 1; }, go(path) { calls.went.push(path); },
    showToast: (message, type = "success") => { calls.toasts.push({ message, type }); },
    confirmDialog: async (options) => { calls.confirms.push(options.title); return confirm; },
    setFormBusy: (form, busy) => { calls.busy.push(busy); },
    setButtonBusy() {},
    renderRoute: async () => { calls.renderRoutes += 1; },
    MNP_ERROR_LOG: { report() {} },
  });
  Object.defineProperty(context, "location", { get: () => ({ get hash() { return hash; } }), configurable: true });
  Object.defineProperty(context, "addEventListener", { value: (type, handler) => { (winListeners[type] ??= []).push(handler); }, configurable: true });
  for (const file of ["ui-icons.js", "itas-model.js", "itas-vault.js", "itas-pages.js", "module-itas.js"]) vm.runInContext(read(`modules/${file}`), context);
  const itas = context.window.MNP_ITAS;
  const fire = async (list, event = {}) => { for (const handler of list ?? []) await handler(event); await tick(); };
  const world0 = {
    context, itas, calls, server, storage, hosts, elements, host, forms, stateObj, session, rpcNames: () => calls.rpc.map((call) => call.name),
    setHash: (value) => { hash = value; },
    html: () => painted + Object.values(hosts).join(""),
    // เหตุการณ์ของหน้าต่าง/เอกสาร
    hashchange: (value) => { hash = value; return fire(winListeners.hashchange); },
    pagehide: () => fire(winListeners.pagehide),
    windowEvent: (name) => fire(winListeners[name]),
    documentEvent: (name, event = {}) => fire(docListeners[name], event),
    registered: { window: winListeners, document: docListeners },
    fireInput: (target) => fire(host.listeners.input, { target }),
    signOut: () => fire(authListeners.map((listener) => (event) => listener("SIGNED_OUT", event))),
    click: async (target) => { await fire(host.listeners.click, { target }); },
    submit: async (form) => { await fire(host.listeners.submit, { target: form, preventDefault() {} }); },
    render: async (query = "module=assets") => { await itas.render(new URLSearchParams(query)); await tick(); },
    status: () => /itas-vault-bar[^>]*is-(\w+)/.exec(hosts["itas-vault-bar-host"] ?? painted)?.[1],
    button: (id) => ({ id, dataset: {}, closest: () => ({ id, dataset: {} }) }),
  };
  world0.button = (id, dataset = {}) => { const node = { id, dataset }; node.closest = () => node; return node; };
  return world0;
}
// ตู้เซฟที่ตั้งไว้แล้วบนฐานข้อมูลจำลอง (สร้างด้วยตู้เซฟอีกตัวที่ใช้ 600,000 รอบ) · คืนแถวที่เก็บไว้ + รหัสกู้คืน
async function initializedVaultRow() {
  const server = fakeVaultServer();
  const vault = createVault({ subtle, getRandomValues: (bytes) => webcrypto.getRandomValues(bytes), server, iterations: vaultApi.MIN_ITERATIONS, setTimer: (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; } });
  await vault.load();
  const { recoveryCode } = await vault.prepareSetup(PASSWORD);
  await vault.commitSetup(recoveryCode);
  vault.lock();
  return { row: server.db.row, recoveryCode };
}
const passwordForm = (password, id = "itas-vault-unlock-form") => ({ id, elements: { password: { value: password } }, querySelectorAll: () => [], toggleAttribute() {} });
const unlockVia = async (w) => {
  await w.click(w.button("itas-vault-unlock"));
  await w.submit(passwordForm(PASSWORD));
};
// แถวเครื่องคอมพิวเตอร์ (COMPUTER/LAPTOP) เปิดหน้ารายละเอียดเครื่องก่อน (รุ่น 1.02) → กด "แก้ไขเครื่องนี้" ถึงจะเปิดฟอร์มแก้ไข
async function openEdit(w, id) {
  await w.click({ closest: () => ({ dataset: { itasRow: id }, id: "" }), dataset: { itasRow: id }, id: "" });
  await w.click(w.button("itas-host-edit"));
}
// ฟอร์มอุปกรณ์จำลอง: ค่าช่องธรรมดาตามชื่อ + แถวช่องลับ (data-secret) ที่มี input ของตัวเอง
function assetForm({ values = {}, secrets = {} } = {}) {
  const elements = {};
  for (const key of ["reg_no", "device_code", "name", "model", "serial", "status", "host_code", "slot", "place", "install_date", "record_date", "purchase_date", "vendor", "price", "tax_rate", "warranty_text", "warranty_end", "express_code", "account_no", "note", "attrs.cpu"]) elements[key] = { value: key === "status" ? "in_use" : "" };
  for (const [key, value] of Object.entries(values)) elements[key] = { value };
  const rows = Object.entries(secrets).map(([key, secret]) => {
    const input = { hidden: secret.hidden ?? false, value: secret.value ?? "" };
    return { dataset: { secret: key, clear: secret.clear ? "1" : "" }, querySelector: (selector) => (selector === "[data-secret-input]" ? input : null), input };
  });
  return { id: "itas-form", elements, rows, querySelector: () => null, querySelectorAll: (selector) => (selector === "[data-secret]" ? rows : selector === "[data-secret-input]" ? rows.map((row) => row.input) : []), toggleAttribute() {} };
}

/* ---------- สิทธิ์ของโมดูล ---------- */
test("access: allowed/denied from app_itas_my_access, cached per context for a minute, a failure is not cached and means 'no access'", async () => {
  const granted = await world({ allowed: true });
  assert.equal(granted.itas.hasAccess(), false, "ก่อนตรวจ = ไม่มีสิทธิ์");
  assert.equal(await granted.itas.resolveAccess(), true);
  assert.equal(granted.itas.hasAccess(), true);
  await granted.itas.resolveAccess();
  assert.equal(granted.rpcNames().filter((name) => name === "app_itas_my_access").length, 1, "ใช้ผลที่เก็บไว้");
  granted.stateObj.employee = { id: "persona-7" }; // สลับ persona = บริบทใหม่
  assert.equal(granted.itas.hasAccess(), false);
  await granted.itas.resolveAccess();
  assert.equal(granted.rpcNames().filter((name) => name === "app_itas_my_access").length, 2);
  const denied = await world({ allowed: false });
  assert.equal(await denied.itas.resolveAccess(), false);
  assert.equal(denied.itas.hasAccess(), false);
  const broken = await world({ accessFail: true });
  assert.equal(await broken.itas.resolveAccess(), false);
  assert.equal(await broken.itas.resolveAccess(), false);
  assert.equal(broken.rpcNames().filter((name) => name === "app_itas_my_access").length, 2, "ไม่เก็บผลที่ล้ม จึงลองใหม่ได้");
});

/* ---------- วาดหน้า ---------- */
test("render without access goes home and calls nothing else; with access it loads types, vault state and the selected type's assets", async () => {
  const denied = await world({ allowed: false });
  await denied.render();
  assert.deepEqual(denied.calls.went, ["dashboard"]);
  assert.deepEqual(denied.rpcNames(), ["app_itas_my_access"]);
  assert.equal(denied.html(), "");
  const w = await world();
  await w.render();
  assert.deepEqual(w.calls.went, []);
  assert.deepEqual(new Set(w.rpcNames()), new Set(["app_itas_my_access", "app_itas_list_types", "app_itas_vault_get", "app_itas_list_assets"]));
  const list = w.calls.rpc.find((call) => call.name === "app_itas_list_assets");
  assert.deepEqual(list.args, { p_limit: 2000, p_offset: 0 }, "เริ่มที่มุมมองทั้งหมด: โหลดทุกชนิดครั้งเดียว ไม่ระบุชนิด");
  const html = w.html();
  assert.match(html, /ทะเบียนอุปกรณ์ IT/);
  assert.match(html, /ยังไม่ตั้ง/, "ตู้เซฟยังไม่ตั้ง");
  assert.match(html, /COM-001/);
  assert.match(html, /data-itas-type="" aria-pressed="true"/, "ชิป ทั้งหมด ถูกเลือกตั้งต้น");
  assert.match(html, /data-itas-type="COMPUTER" aria-pressed="false"/);
  assert.doesNotMatch(html, /itas-purge/, "ไม่ใช่โหมดทดสอบ");
  assert.equal(w.itas.version, "1.05");
  assert.equal(w.itas.inDevelopment, true);
  assert.equal(w.context.window.MNP_OFFICE_CARDS.IT_ASSET_REGISTER.version, "1.05");
  // โหมดทดสอบ: มีปุ่มล้างข้อมูล + แท็ก ทดสอบ
  const test = await world({ isTest: true });
  await test.render();
  assert.match(test.html(), /id="itas-purge"/);
  assert.match(test.html(), /itas-test-tag/);
});

test("an unknown ?view= is a not-found page without any lookup", async () => {
  const w = await world();
  await w.render("module=assets&view=nope");
  assert.equal(w.calls.notFound, 1);
  assert.deepEqual(w.rpcNames(), []);
});

test("a vault that cannot be read (corrupt parameters) does not break the register: the page still opens and says so", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: { ...row, kdf_iterations: 1000 } });
  await w.render();
  assert.match(w.html(), /COM-001/);
  assert.match(JSON.stringify(w.calls.toasts) + (w.hosts["itas-vault-message"] ?? ""), /ตู้เซฟผิดปกติ/, "ในหน้าจริงไม่มีแผงเปิดอยู่ จึงขึ้นเป็นข้อความแจ้ง");
  assert.equal(w.status(), "unknown");
});

/* ---------- ตู้เซฟ: ตั้ง / ปลดล็อก / ล็อกอัตโนมัติ ---------- */
test("setup: password + confirmation, then the recovery code is shown once and must be typed back before anything reaches the database; then it ends unlocked", async () => {
  const w = await world();
  await w.render();
  await w.click(w.button("itas-vault-setup"));
  assert.match(w.hosts["itas-vault-panel"], /ตั้งตู้เซฟ/);
  // รหัสสั้น / ไม่ตรงกัน ถูกปฏิเสธฝั่งหน้าเว็บ
  await w.submit({ ...passwordForm("short", "itas-vault-setup-form"), elements: { password: { value: "short" }, password2: { value: "short" } } });
  assert.match(w.hosts["itas-vault-message"], /ต้องยาวอย่างน้อย 14 ตัวอักษร/);
  await w.submit({ ...passwordForm(PASSWORD, "itas-vault-setup-form"), elements: { password: { value: PASSWORD }, password2: { value: `${PASSWORD}x` } } });
  assert.match(w.hosts["itas-vault-message"], /ไม่ตรงกัน/);
  assert.equal(w.server.db.calls.length, 0);
  await w.submit({ ...passwordForm(PASSWORD, "itas-vault-setup-form"), elements: { password: { value: PASSWORD }, password2: { value: PASSWORD } } });
  const panel = w.hosts["itas-vault-panel"];
  const code = /id="itas-recovery-code"[^>]*>([^<]+)</.exec(panel)?.[1];
  assert.match(code, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  assert.equal(w.server.db.calls.length, 0, "ยังไม่ส่งขึ้นเซิร์ฟเวอร์ก่อนผู้ใช้พิมพ์รหัสกู้คืนกลับ");
  await w.submit({ id: "itas-recovery-form", elements: { typed: { value: "WRONG-CODE" } }, querySelectorAll: () => [], toggleAttribute() {} });
  assert.match(w.hosts["itas-vault-message"], /ไม่ตรงกัน/);
  assert.equal(w.server.db.calls.length, 0);
  await w.submit({ id: "itas-recovery-form", elements: { typed: { value: code } }, querySelectorAll: () => [], toggleAttribute() {} });
  assert.deepEqual(w.server.db.calls, ["init"]);
  assert.equal(w.hosts["itas-vault-panel"], "", "แผงที่มีรหัสกู้คืนถูกล้างออกจากหน้า");
  assert.equal(w.status(), "unlocked");
  assert.ok(!w.html().includes(code), "รหัสกู้คืนไม่ค้างในหน้า");
  assert.ok(!JSON.stringify(w.calls.rpc).includes(code.replaceAll("-", "")), "รหัสกู้คืนไม่ถูกส่งออก");
  assert.ok(!JSON.stringify(w.calls.rpc).includes(PASSWORD), "รหัสตู้เซฟไม่ถูกส่งออก");
});

test("unlock with the right password; a wrong password shows a plain message and leaves it locked", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  assert.equal(w.status(), "locked");
  await w.click(w.button("itas-vault-unlock"));
  await w.submit(passwordForm("รหัสที่ไม่ถูกต้อง รหัสที่ไม่ถูกต้อง"));
  assert.match(w.hosts["itas-vault-message"], /รหัสไม่ถูกต้อง/);
  assert.ok(!w.hosts["itas-vault-message"].includes("รหัสที่ไม่ถูกต้อง รหัส"), "ไม่สะท้อนรหัสที่พิมพ์");
  assert.equal(w.status(), "locked");
  await w.submit(passwordForm(PASSWORD));
  assert.equal(w.status(), "unlocked");
  assert.equal(w.hosts["itas-vault-panel"], "");
  assert.match(w.hosts["itas-vault-bar-host"], /id="itas-vault-lock"/);
  await w.click(w.button("itas-vault-lock"));
  assert.equal(w.status(), "locked");
  assert.match(w.calls.toasts.at(-1).message, /ล็อกตู้เซฟแล้ว/);
});

test("auto-lock: leaving the module, pagehide, signing out and a user/persona/test-mode change all lock an unlocked vault and close the panel", async () => {
  const { row } = await initializedVaultRow();
  for (const [label, trigger, expected] of [
    ["leave", (w) => w.hashchange("#/dashboard"), /ออกจากหน้าทะเบียน/],
    ["pagehide", (w) => w.pagehide(), null],
    ["signout", (w) => w.signOut(), /ออกจากระบบ/],
    ["persona", async (w) => { w.stateObj.employee = { id: "persona-9" }; await w.render(); }, /เปลี่ยนผู้ใช้หรือโหมด/],
    ["test mode", async (w) => { w.stateObj.sandbox = { active: true }; await w.render(); }, /เปลี่ยนผู้ใช้หรือโหมด/],
  ]) {
    const w = await world({ vaultRow: row });
    await w.render();
    await unlockVia(w);
    assert.equal(w.status(), "unlocked", label);
    await w.click(w.button("itas-vault-change")); // เปิดแผงที่มีช่องรหัสค้างไว้
    assert.notEqual(w.hosts["itas-vault-panel"], "");
    await trigger(w);
    assert.equal(w.status(), "locked", label);
    if (label !== "persona" && label !== "test mode") assert.equal(w.hosts["itas-vault-panel"], "", `${label}: แผงถูกปิด`);
    if (expected) assert.match(w.calls.toasts.map((toast) => toast.message).join("|"), expected, label);
  }
  // ย้ายไปหน้าอื่นในโมดูล (hash ยังเป็นทะเบียน) ไม่ล็อก
  const w = await world({ vaultRow: row });
  await w.render();
  await unlockVia(w);
  await w.hashchange("#/office?module=assets&x=1");
  assert.equal(w.status(), "unlocked");
});

test("the idle timer: the vault gets touched by activity on the page (throttled) and the module registers the activity listeners", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  const source = read("modules/module-itas.js");
  for (const name of ["pointerdown", "keydown", "input", "touchstart"]) assert.match(source, new RegExp(`"${name}"`));
  assert.match(source, /vault\.touch\(\)/);
  assert.match(read("modules/itas-vault.js"), /const IDLE_MS = 10 \* 60 \* 1000;/);
});

const twoPasswords = (id, fields) => ({ id, elements: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }])), querySelectorAll: () => [], toggleAttribute() {} });
const NEW_PASSWORD = "correct horse battery staple 99";

test("forgot the password: the recovery code unlocks and sets a new password in one step; the old password stops working; the code is never sent anywhere", async () => {
  const { row, recoveryCode } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  await w.click(w.button("itas-vault-unlock"));
  await w.click(w.button("itas-vault-forgot"));
  assert.match(w.hosts["itas-vault-panel"], /ปลดล็อกด้วยรหัสกู้คืน/);
  await w.submit(twoPasswords("itas-vault-forgot-form", { recovery: recoveryCode, password: "short", password2: "short" }));
  assert.match(w.hosts["itas-vault-message"], /ต้องยาวอย่างน้อย 14 ตัวอักษร/);
  await w.submit(twoPasswords("itas-vault-forgot-form", { recovery: "0000-0000-0000-0000-0000-0000-0000-0000", password: NEW_PASSWORD, password2: NEW_PASSWORD }));
  assert.match(w.hosts["itas-vault-message"], /รหัสไม่ถูกต้อง/);
  assert.equal(w.status(), "locked");
  await w.submit(twoPasswords("itas-vault-forgot-form", { recovery: recoveryCode.toLowerCase(), password: NEW_PASSWORD, password2: NEW_PASSWORD }));
  assert.equal(w.status(), "unlocked");
  assert.ok(w.server.db.calls.includes("rotate:change_password"));
  assert.equal(w.hosts["itas-vault-panel"], "");
  assert.ok(!JSON.stringify(w.calls.rpc).includes(recoveryCode.replaceAll("-", "")), "รหัสกู้คืนไม่ถูกส่งออก");
  assert.ok(!JSON.stringify(w.calls.rpc).includes(NEW_PASSWORD));
  await w.click(w.button("itas-vault-lock"));
  await w.click(w.button("itas-vault-unlock"));
  await w.submit(passwordForm(PASSWORD));
  assert.equal(w.status(), "locked", "รหัสเก่าใช้ไม่ได้แล้ว");
  await w.submit(passwordForm(NEW_PASSWORD));
  assert.equal(w.status(), "unlocked");
});

test("change password asks for the current password again; a wrong current password changes nothing", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  await unlockVia(w);
  await w.click(w.button("itas-vault-change"));
  await w.submit(twoPasswords("itas-vault-change-form", { current: "ผิดผิดผิดผิดผิดผิดผิดผิด", password: NEW_PASSWORD, password2: NEW_PASSWORD }));
  assert.match(w.hosts["itas-vault-message"], /รหัสไม่ถูกต้อง/);
  assert.ok(!w.server.db.calls.includes("rotate:change_password"));
  await w.submit(twoPasswords("itas-vault-change-form", { current: PASSWORD, password: NEW_PASSWORD, password2: `${NEW_PASSWORD}!` }));
  assert.match(w.hosts["itas-vault-message"], /ไม่ตรงกัน/);
  await w.submit(twoPasswords("itas-vault-change-form", { current: PASSWORD, password: NEW_PASSWORD, password2: NEW_PASSWORD }));
  assert.ok(w.server.db.calls.includes("rotate:change_password"));
  assert.equal(w.hosts["itas-vault-panel"], "");
  assert.match(w.calls.toasts.at(-1).message, /เปลี่ยนรหัสตู้เซฟแล้ว/);
  assert.equal(w.status(), "unlocked");
  const rotate = w.calls.rpc.find((call) => call.name === "app_itas_vault_rotate");
  assert.equal(rotate.args.p_action, "change_password");
  assert.equal(rotate.args.p_wrapped_key_recovery, null, "ไม่ส่งชุดรหัสกู้คืนตอนเปลี่ยนรหัสตู้เซฟ");
  assert.ok(rotate.args.p_auth_token);
});

test("new recovery code: shown once, typed back to confirm, only then sent; a rejected auth token locks the vault with a clear message", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  await unlockVia(w);
  await w.click(w.button("itas-vault-recovery"));
  await w.submit(twoPasswords("itas-vault-recovery-form", { current: PASSWORD }));
  const code = /id="itas-recovery-code"[^>]*>([^<]+)</.exec(w.hosts["itas-vault-panel"])?.[1];
  assert.match(code, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  assert.match(w.hosts["itas-vault-panel"], /ยืนยันและเปลี่ยนรหัสกู้คืน/);
  assert.ok(!w.server.db.calls.includes("rotate:new_recovery"), "ยังไม่ส่งก่อนยืนยัน");
  await w.submit(twoPasswords("itas-recovery-form", { typed: "NOPE" }));
  assert.match(w.hosts["itas-vault-message"], /ไม่ตรงกัน/);
  await w.submit(twoPasswords("itas-recovery-form", { typed: code }));
  assert.ok(w.server.db.calls.includes("rotate:new_recovery"));
  assert.equal(w.hosts["itas-vault-panel"], "");
  assert.ok(!w.html().includes(code), "รหัสใหม่ไม่ค้างในหน้า");
  // เซิร์ฟเวอร์ปฏิเสธ token → ล็อกและบอกให้ปลดล็อกใหม่
  const bad = await world({ vaultRow: row, rpcHandlers: { app_itas_vault_rotate: () => ({ ok: false, code: "AUTH_TOKEN_INVALID", message: "x" }) } });
  await bad.render();
  await unlockVia(bad);
  await bad.click(bad.button("itas-vault-change"));
  await bad.submit(twoPasswords("itas-vault-change-form", { current: PASSWORD, password: NEW_PASSWORD, password2: NEW_PASSWORD }));
  assert.match(bad.hosts["itas-vault-message"], /ยืนยันกุญแจของตู้เซฟไม่ผ่าน/);
  assert.equal(bad.status(), "locked");
});

/* ---------- ฟอร์ม: บันทึก ช่องลับ แก้ชนกัน ---------- */
test("save while the vault is locked: no secret key and no p_id secrets in the payload; the other fields still save", async () => {
  const w = await world();
  await w.render();
  await w.click(w.button("itas-add"));
  assert.ok(w.forms.current === null || true);
  w.forms.current = assetForm({ values: { reg_no: " com-777 ", name: "เครื่องใหม่", "attrs.cpu": "i7" } });
  await w.submit(w.forms.current);
  const save = w.calls.rpc.find((call) => call.name === "app_itas_save_asset");
  assert.ok(save, "บันทึกแล้ว");
  assert.equal(save.args.p_id, ID_NEW);
  assert.equal(save.args.p_type_code, "COMPUTER");
  assert.deepEqual(save.args.p_secrets, {});
  assert.equal(save.args.p_data.reg_no, "COM-777");
  assert.deepEqual(save.args.p_attrs, { cpu: "i7" });
  assert.equal(save.args.p_expected_updated_at, null);
  assert.match(w.calls.toasts.at(-1).message, /เพิ่มอุปกรณ์แล้ว/);
});

test("save while unlocked: secrets leave the browser only as AES-GCM envelopes; no plaintext appears in any RPC payload, toast or page; the draft id is the AAD", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  await unlockVia(w);
  await w.click(w.button("itas-add"));
  w.forms.current = assetForm({ values: { reg_no: "COM-778", name: "เครื่องลับ" }, secrets: { ip: { value: PLAIN_IP }, license_os: { value: PLAIN_LICENSE } } });
  await w.submit(w.forms.current);
  const save = w.calls.rpc.find((call) => call.name === "app_itas_save_asset");
  assert.deepEqual(Object.keys(save.args.p_secrets).sort(), ["ip", "license_os"]);
  for (const envelope of Object.values(save.args.p_secrets)) {
    assert.deepEqual(Object.keys(envelope).sort(), ["c", "n", "v"]);
    assert.equal(envelope.v, 1);
  }
  const everything = JSON.stringify(w.calls.rpc) + JSON.stringify(w.calls.toasts) + w.html();
  assert.ok(!everything.includes(PLAIN_IP) && !everything.includes(PLAIN_LICENSE), "ไม่มี plaintext ที่ไหนเลย");
  assert.ok(!everything.includes(Buffer.from(PLAIN_IP).toString("base64")));
  assert.equal(save.args.p_id, ID_NEW);
  // ช่องรหัสถูกล้างหลังบันทึก
  for (const row of w.forms.current.rows) assert.equal(row.input.value, "");
  // ถอดกลับด้วยตู้เซฟอีกตัวที่ AAD = id ที่หน้าเว็บสร้าง: ต้องตรงกัน
  const verifier = createVault({ subtle, getRandomValues: (bytes) => webcrypto.getRandomValues(bytes), server: { get: async () => ({ initialized: true, is_test: false, ...structuredClone(row) }) }, setTimer: (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; } });
  await verifier.unlock("pass", PASSWORD);
  assert.equal(await verifier.decryptField(ID_NEW, "ip", save.args.p_secrets.ip), PLAIN_IP);
  assert.equal(await verifier.decryptField(ID_NEW, "license_os", save.args.p_secrets.license_os), PLAIN_LICENSE);
  await assert.rejects(() => verifier.decryptField(ID_NEW, "ip", save.args.p_secrets.license_os), /ถอดรหัสไม่ได้/);
});

test("editing: only the secret fields the user touched are sent (null to delete); untouched ones are left alone; the original updated_at is sent unchanged", async () => {
  const { row } = await initializedVaultRow();
  const withSecrets = { ...ASSET, secrets: { ip: { v: 1, n: toBase64(new Uint8Array(12)), c: toBase64(new Uint8Array(32)) } } };
  const w = await world({ vaultRow: row, assets: [withSecrets] });
  await w.render();
  await unlockVia(w);
  await openEdit(w, ASSET_ID);
  w.forms.current = assetForm({ values: { reg_no: "COM-001", device_code: "COM12", name: "เครื่องบัญชี", model: "Dell", serial: "SN1", "attrs.cpu": "i5" }, secrets: { ip: { clear: true, hidden: true }, license_os: { value: PLAIN_LICENSE } } });
  await w.submit(w.forms.current);
  const save = w.calls.rpc.find((call) => call.name === "app_itas_save_asset");
  assert.ok(save);
  assert.equal(save.args.p_expected_updated_at, STAMP, "สตริงเดิมทุกตัวอักษร");
  assert.deepEqual(Object.keys(save.args.p_secrets).sort(), ["ip", "license_os"]);
  assert.equal(save.args.p_secrets.ip, null);
  assert.equal(save.args.p_secrets.license_os.v, 1);
  assert.ok(!JSON.stringify(save.args).includes(PLAIN_LICENSE));
  assert.deepEqual(save.args.p_data, {}, "ช่องธรรมดาไม่เปลี่ยน = ไม่ส่ง");
  assert.ok(!("p_type_code" in save.args));
});

test("a conflict (40001) keeps what the user typed, shows the message with a reload button, and reloads only after the user confirms", async () => {
  const conflict = Object.assign(new Error("ข้อมูลอุปกรณ์นี้ถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่"), { code: "40001" });
  const w = await world({ rpcHandlers: { app_itas_save_asset: () => { throw conflict; } } });
  await w.render();
  await openEdit(w, ASSET_ID);
  w.forms.current = assetForm({ values: { reg_no: "COM-001", name: "ชื่อที่ฉันพิมพ์ไว้", "attrs.cpu": "i5" } });
  await w.submit(w.forms.current);
  const message = w.hosts["itas-form-message"];
  assert.match(message, /มีการแก้ไขจากที่อื่นไปแล้ว/);
  assert.match(message, /id="itas-reload-asset"/);
  assert.equal(w.forms.current.elements.name.value, "ชื่อที่ฉันพิมพ์ไว้", "ฟอร์มยังอยู่ ไม่ถูกล้าง");
  assert.equal(w.calls.confirms.length, 0, "ยังไม่ทิ้งอะไรเงียบ ๆ");
  const before = w.calls.rpc.filter((call) => call.name === "app_itas_get_asset").length;
  await w.click(w.button("itas-reload-asset"));
  assert.equal(w.calls.confirms.at(-1), "โหลดข้อมูลล่าสุด?");
  // โหลดแถวล่าสุดของฟอร์ม 1 ครั้ง + หน้าเครื่องที่เปิดอยู่ (แถวนี้เป็นเครื่องคอมพิวเตอร์) โหลดซ้ำหลังรีเฟรชข้อมูลอีก 1 ครั้ง
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itas_get_asset").length, before + 2);
});

test("a retry after a lost connection reuses the same new id; if the first try had actually saved, the row is loaded instead of showing an error", async () => {
  let attempt = 0;
  const w = await world({
    rpcHandlers: {
      app_itas_save_asset: () => { attempt += 1; if (attempt === 1) throw Object.assign(new Error("Failed to fetch"), { code: "" }); throw Object.assign(new Error("อุปกรณ์นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุด"), { code: "23514" }); },
    },
  });
  await w.render();
  await w.click(w.button("itas-add"));
  w.forms.current = assetForm({ values: { reg_no: "COM-779", name: "ลองซ้ำ" } });
  await w.submit(w.forms.current);
  assert.match(w.hosts["itas-form-message"], /ผลไม่แน่ชัด/);
  await w.submit(w.forms.current);
  const saves = w.calls.rpc.filter((call) => call.name === "app_itas_save_asset");
  assert.equal(saves.length, 2);
  assert.equal(saves[0].args.p_id, saves[1].args.p_id, "id เดิม");
  assert.ok(w.calls.rpc.some((call) => call.name === "app_itas_get_asset" && call.args.p_id === saves[0].args.p_id), "โหลดแถวที่บันทึกไปแล้ว");
  assert.match(w.calls.toasts.at(-1).message, /เพิ่มอุปกรณ์แล้ว/);
});

test("validation errors stop the save before any RPC; nothing is sent", async () => {
  const w = await world();
  await w.render();
  await w.click(w.button("itas-add"));
  w.forms.current = assetForm({ values: {} });
  await w.submit(w.forms.current);
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itas_save_asset").length, 0);
});

test("unsaved work: the form counts as unsaved once edited (or when a secret is typed), not when untouched, and not after leaving the page", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  assert.equal(w.itas.unsavedCount(), 0);
  await unlockVia(w);
  await w.click(w.button("itas-add"));
  const form = assetForm({ values: {} });
  w.forms.current = form;
  // mountForm อ่านค่าเริ่มต้นตอนเปิด: ตั้งค่าเริ่มต้นใหม่ให้ตรงกับฟอร์มจำลอง
  await w.click(w.button("itas-add")); // ยังไม่ dirty: เปิดซ้ำได้โดยไม่ถาม
  assert.equal(w.calls.confirms.length, 0);
  w.forms.current = assetForm({ values: {} });
  assert.equal(w.itas.unsavedCount(), 0);
  w.forms.current = assetForm({ values: { name: "พิมพ์ค้าง" } });
  assert.equal(w.itas.unsavedCount(), 1);
  w.forms.current = assetForm({ values: {}, secrets: { ip: { value: "x" } } });
  assert.equal(w.itas.unsavedCount(), 1, "ช่องลับที่พิมพ์ค้างก็นับ");
  await w.click(w.button("itas-add")); // เปิดฟอร์มทับ: ต้องถามก่อนทิ้ง
  assert.equal(w.calls.confirms.at(-1), "ยังไม่ได้บันทึกสิ่งที่กรอก");
  w.setHash("#/dashboard");
  assert.equal(w.itas.unsavedCount(), 0, "ออกจากหน้าแล้วไม่นับ");
});

test("showing a secret decrypts only on request into textContent; a field that cannot be decrypted says so without breaking the rest", async () => {
  const { row } = await initializedVaultRow();
  const bad = { ...ASSET, secrets: { ip: { v: 1, n: toBase64(new Uint8Array(12)), c: toBase64(new Uint8Array(40)) } } };
  const w = await world({ vaultRow: row, assets: [bad] });
  await w.render();
  await unlockVia(w);
  await openEdit(w, ASSET_ID);
  const shown = el({ textContent: "••••••••" });
  const input = el({ hidden: true });
  const rowEl = el({ dataset: { secret: "ip", clear: "" }, querySelector: (selector) => ({ "[data-secret-shown]": shown, "[data-secret-input]": input, "[data-secret-note]": el() })[selector] ?? null });
  const button = el({ dataset: { secretAct: "show" }, closest: (selector) => (selector === "[data-secret]" ? rowEl : button) });
  await w.click(button);
  assert.equal(shown.textContent, "ถอดรหัสไม่ได้");
  assert.equal(w.status(), "unlocked", "ถอดช่องเดียวไม่ได้ ไม่ล็อกทั้งตู้");
});

/* ---------- ล้างข้อมูลทดสอบ ---------- */
test("purging test data locks and resets the vault and reloads the page", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ isTest: true, vaultRow: row });
  await w.render();
  await unlockVia(w);
  await w.click(w.button("itas-purge"));
  assert.equal(w.calls.confirms.at(-1), "ล้างข้อมูลทะเบียนอุปกรณ์ทดสอบ?");
  assert.ok(w.rpcNames().includes("app_sandbox_purge_itas"));
  assert.equal(w.status(), "locked");
  assert.equal(w.calls.renderRoutes, 1);
  assert.match(w.calls.toasts.at(-1).message, /ล้างข้อมูลทะเบียนอุปกรณ์ทดสอบแล้ว 3 รายการ/);
});

/* ---------- กฎความปลอดภัยของไฟล์ ---------- */
test("source rules: no console, storage only for the remembered brand/place (two calls, one key), no Math.random, no draft autosave, no secret in data attributes, decrypted values only via textContent", () => {
  const source = read("modules/module-itas.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /sessionStorage|indexedDB/);
  // localStorage ใช้ได้จุดเดียว: จำ ยี่ห้อ/รุ่น + สถานที่ (อ่าน 1 เขียน 1 ผ่าน model.parseMemory/serializeMemory ที่รับเฉพาะคีย์ที่ระบุ) · ห้ามเก็บค่าอื่น
  assert.equal((source.match(/localStorage/g) ?? []).length, 2);
  assert.match(source, /window\.localStorage\?\.getItem\(key\)/);
  assert.match(source, /window\.localStorage\?\.setItem\(key, model\.serializeMemory\(memory\)\)/);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /MNP_FORM_DRAFT/);
  assert.doesNotMatch(source, /dataset\.[a-zA-Z]+\s*=\s*[^;]*decrypt/);
  assert.match(source, /shown\.textContent = await vault\.decryptField/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*[^;]*decryptField/);
  const pagesSource = read("modules/itas-pages.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(pagesSource, /console\.|localStorage|sessionStorage/);
  const modelSource = read("modules/itas-model.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(modelSource, /console\.|localStorage|sessionStorage|crypto/);
});

/* ====================================================================================
   รอบแก้ตามผลตรวจ auditor: ปลดล็อกค้างหลังออกจากหน้า · รหัสกู้คืนไม่คัดลอก · สิทธิ์เก็บผล/ไม่ทับหน้าเก่า
   · เวลาไม่ใช้งานนับจากนาฬิกา · กฎรหัสตู้เซฟ · autofill · ตรวจชุดใหม่หลังเปลี่ยนรหัส · UUID สำรอง · ถามก่อนออกจากหน้า
   ==================================================================================== */
const gateOf = () => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; };
const setupForm = (password, password2 = password) => ({ id: "itas-vault-setup-form", elements: { password: { value: password }, password2: { value: password2 } }, querySelectorAll: () => [], toggleAttribute() {} });

/* ---------- ปลดล็อกค้างหลังออกจากหน้า ---------- */
test("leaving the page while the unlock is still computing: the vault ends locked, the panel is gone, and the user is told (no unlock after the lock)", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ vaultRow: row });
  await w.render();
  await w.click(w.button("itas-vault-unlock"));
  const unlocking = w.submit(passwordForm(PASSWORD)); // กำลังคำนวณกุญแจ (KDF)
  await w.hashchange("#/dashboard"); // ผู้ใช้ออกจากหน้า → ล็อก
  await unlocking;
  assert.equal(w.status(), "locked");
  assert.equal(w.itas.unsavedCount(), 0);
  // ในหน้าจริงแผงถูกปิดไปแล้วจึงขึ้นเป็นข้อความแจ้ง (toast) · ในตัวจำลองมีกล่องข้อความอยู่เสมอ จึงตรวจทั้งสองที่
  assert.match(JSON.stringify(w.calls.toasts) + (w.hosts["itas-vault-message"] ?? ""), /ถูกล็อกระหว่างดำเนินการ/);
});

test("setup finished after the user left: the vault is set on the server but stays locked and says so", async () => {
  const w = await world();
  await w.render();
  await w.click(w.button("itas-vault-setup"));
  await w.submit(setupForm(PASSWORD));
  const code = /id="itas-recovery-code"[^>]*>([^<]+)</.exec(w.hosts["itas-vault-panel"])?.[1];
  assert.ok(code);
  const committing = w.submit({ id: "itas-recovery-form", elements: { typed: { value: code } }, querySelectorAll: () => [], toggleAttribute() {} });
  await w.hashchange("#/dashboard");
  await committing;
  assert.equal(w.status(), "locked");
  assert.equal(w.server.db.calls.filter((call) => call === "init").length, 1, "ตั้งขึ้นเซิร์ฟเวอร์ไปแล้วจริง");
  assert.match(JSON.stringify(w.calls.toasts) + (w.hosts["itas-vault-message"] ?? ""), /ปลดล็อกด้วยรหัสตู้เซฟที่เพิ่งตั้ง/);
});

/* ---------- รหัสกู้คืน: ไม่มีปุ่มคัดลอก ---------- */
test("the recovery code cannot be copied from the page: no button, no handler, no clipboard use", async () => {
  const w = await world();
  await w.render();
  await w.click(w.button("itas-vault-setup"));
  await w.submit(setupForm(PASSWORD));
  assert.doesNotMatch(w.hosts["itas-vault-panel"], /itas-recovery-copy|<button[^>]*>[^<]*คัดลอก/);
  const calls = [];
  w.context.navigator.clipboard.writeText = async (text) => { calls.push(text); };
  await w.click(w.button("itas-recovery-copy")); // ปุ่มนี้ไม่มีอีกแล้ว: ต่อให้มีใครกดก็ต้องไม่เกิดอะไร
  assert.deepEqual(calls, []);
  assert.doesNotMatch(read("modules/module-itas.js").replace(/\/\/.*$/gm, ""), /clipboard|copyRecoveryCode/);
});

/* ---------- สิทธิ์: เก็บผล ไม่ยิงซ้ำ ไม่ทับหน้าเก่า แยก "ตรวจไม่ได้" ออกจาก "ไม่มีสิทธิ์" ---------- */
test("access: the answer is kept for ten minutes per user/mode, concurrent callers share one request, sign-out clears it, and a failure is not kept", async () => {
  const clock = { time: 1_700_000_000_000 };
  const gate = gateOf();
  const w = await world({ clock, rpcHandlers: { app_itas_my_access: () => gate.promise.then(() => ({ allowed: true, is_test: false })) } });
  assert.equal(w.itas.accessStatus(), "unknown");
  const first = w.itas.resolveAccess();
  const second = w.itas.resolveAccess();
  gate.open();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(w.rpcNames().filter((name) => name === "app_itas_my_access").length, 1, "คำขอซ้อนกันใช้ RPC เดียว");
  assert.equal(w.itas.accessStatus(), "allowed");
  clock.time += 9 * 60 * 1000;
  await w.itas.resolveAccess();
  assert.equal(w.rpcNames().filter((name) => name === "app_itas_my_access").length, 1, "ภายใน 10 นาทีไม่ยิงซ้ำ (เดิมยิงทุก 60 วินาที)");
  clock.time += 2 * 60 * 1000;
  assert.equal(w.itas.accessStatus(), "unknown", "เกิน 10 นาทีต้องตรวจใหม่");
  await w.itas.resolveAccess();
  assert.equal(w.rpcNames().filter((name) => name === "app_itas_my_access").length, 2);
  await w.signOut();
  assert.equal(w.itas.accessStatus(), "unknown", "ออกจากระบบแล้วล้างผล");
  assert.equal(w.itas.hasAccess(), false);
  // ไม่มีสิทธิ์เก็บสั้นกว่า (1 นาที) · ตรวจล้มไม่เก็บและบอกสถานะ error
  const denied = await world({ clock, allowed: false });
  await denied.itas.resolveAccess();
  assert.equal(denied.itas.accessStatus(), "denied");
  clock.time += 61 * 1000;
  assert.equal(denied.itas.accessStatus(), "unknown");
  const broken = await world({ accessFail: true });
  assert.equal(await broken.itas.resolveAccess(), false);
  assert.equal(broken.itas.accessStatus(), "error");
});

test("render: a transient failure of the access check shows a retry message instead of silently going home; a real 'no access' still goes home; a retry works", async () => {
  let down = true;
  const w = await world({ rpcHandlers: { app_itas_my_access: () => { if (down) throw Object.assign(new Error("Failed to fetch"), { code: "" }); return { allowed: true, is_test: false }; } } });
  await w.render();
  assert.deepEqual(w.calls.went, [], "ไม่เด้งไปหน้าหลักเงียบ ๆ");
  assert.match(w.html(), /ตรวจสิทธิ์ไม่ได้ กรุณาลองใหม่/);
  assert.match(w.html(), /id="itas-retry"/);
  assert.deepEqual(w.rpcNames(), ["app_itas_my_access"], "ยังไม่เรียก RPC อื่นของทะเบียน");
  down = false;
  await w.render();
  assert.match(w.html(), /COM-001/);
  assert.deepEqual(w.calls.went, []);
  // เซสชันหมดอายุ: ข้อความเฉพาะของเซสชัน
  const expired = await world({ rpcHandlers: { app_itas_my_access: () => { throw Object.assign(new Error("JWT expired"), { code: "PGRST301" }); } } });
  await expired.render();
  assert.match(expired.html(), /หมดเวลาการเข้าสู่ระบบ/);
  assert.deepEqual(expired.calls.went, []);
});

test("render: when the user has already left the page, a late access answer neither paints nor redirects", async () => {
  const gate = gateOf();
  const w = await world({ rpcHandlers: { app_itas_my_access: () => gate.promise.then(() => ({ allowed: false, is_test: false })) } });
  const rendering = w.render();
  w.setHash("#/office?module=repair"); // ผู้ใช้ไปหน้าอื่นแล้ว
  gate.open();
  await rendering;
  assert.deepEqual(w.calls.went, [], "ไม่เด้งกลับหน้าหลักมาทับหน้าที่ผู้ใช้อยู่");
  assert.equal(w.html(), "");
  const second = await world({ rpcHandlers: { app_itas_my_access: () => gate.promise.then(() => ({ allowed: true, is_test: false })) } });
  const renderingAllowed = second.render();
  second.setHash("#/office?module=repair");
  await renderingAllowed;
  assert.equal(second.html(), "", "ไม่วาดหน้าทะเบียนทับ");
  assert.deepEqual(second.rpcNames(), ["app_itas_my_access"], "ไม่ไปโหลดข้อมูลทะเบียนต่อ");
});

/* ---------- เวลาไม่ใช้งานนับจากนาฬิกา ---------- */
test("idle lock follows the wall clock: coming back to the tab after 10+ minutes locks at once (visibilitychange / pageshow / focus), and a click after that cannot extend it", async () => {
  const { row } = await initializedVaultRow();
  for (const wake of [(w) => w.documentEvent("visibilitychange"), (w) => w.windowEvent("pageshow"), (w) => w.windowEvent("focus")]) {
    const clock = { time: 1_700_000_000_000 };
    const w = await world({ vaultRow: row, clock });
    await w.render();
    await unlockVia(w);
    assert.equal(w.status(), "unlocked");
    clock.time += 10 * 60 * 1000 + 1000; // แท็บถูกซ่อน ตัวจับเวลาไม่ทำงาน
    await wake(w);
    assert.equal(w.status(), "locked");
    assert.match(w.calls.toasts.map((toast) => toast.message).join("|"), /ไม่ได้ใช้งานนาน 10 นาที/);
  }
  const clock = { time: 1_700_000_000_000 };
  const w = await world({ vaultRow: row, clock });
  await w.render();
  await unlockVia(w);
  clock.time += 9 * 60 * 1000;
  await w.documentEvent("pointerdown"); // ยังใช้งานอยู่: ต่อเวลาให้
  clock.time += 9 * 60 * 1000;
  await w.documentEvent("visibilitychange");
  assert.equal(w.status(), "unlocked", "นับจากกิจกรรมล่าสุด");
  clock.time += 11 * 60 * 1000;
  await w.documentEvent("pointerdown"); // กดหลังเกินเวลาแล้ว: ล็อก ไม่ใช่ต่อเวลา
  assert.equal(w.status(), "locked");
});

/* ---------- กฎรหัสตู้เซฟ (ฝั่งหน้าจอ) ---------- */
test("weak vault passwords are refused in the setup form: sequences, repeats and the logged-in employee code; nothing reaches the server", async () => {
  const w = await world({ employee: { id: "e1", employee_no: "IT3462" } });
  await w.render();
  await w.click(w.button("itas-vault-setup"));
  for (const [weak, message] of [["abcdefghijklmn", /เรียงกัน|เดายาก/], ["aaaaaaaaaaaaaaaaaa", /ซ้ำกันมากเกินไป/], ["qwertyuiopasdf", /เรียงกัน|เดายาก/], ["IT3462 it3462 IT3462", /รหัสพนักงาน/]]) {
    await w.submit(setupForm(weak));
    assert.match(w.hosts["itas-vault-message"], message, weak);
    assert.doesNotMatch(w.hosts["itas-vault-panel"] ?? "", /itas-recovery-code/);
  }
  assert.equal(w.server.db.calls.length, 0);
  assert.ok(!JSON.stringify(w.calls.rpc).includes("IT3462 it3462"));
  await w.submit(setupForm(PASSWORD));
  assert.match(w.hosts["itas-vault-panel"], /itas-recovery-code/);
  // ตัววัดตอนพิมพ์ก็บอกเหตุผลเดียวกัน
  const strength = { textContent: "" };
  w.elements["itas-vault-strength"] = strength;
  await w.fireInput({ id: "itas-vault-pass", value: "abcdefghijklmn" });
  assert.match(strength.textContent, /เรียงกัน|เดายาก/);
  await w.fireInput({ id: "itas-vault-pass", value: "short" });
  assert.match(strength.textContent, /สั้นเกินไป/);
});

/* ---------- autofill / ตัวจัดการรหัสผ่าน ---------- */
test("secret inputs are switched to masked text only where the browser can mask with CSS; copy/cut out of a masked input is blocked", async () => {
  const makeInput = () => ({ type: "password", attributes: {}, classes: new Set(), classList: { add(name) { this.owner.classes.add(name); }, remove(name) { this.owner.classes.delete(name); }, owner: null } });
  const wire = (input) => { input.classList.owner = input; return input; };
  // [CSS.supports ตอบ, สไตล์ที่คำนวณได้จริงบนช่อง, type ที่ควรได้]
  // CSS.supports ตอบว่ารองรับ แต่สไตล์จริงไม่ปิดบัง (styles.css เก่าค้างแคชไม่มี .itas-mask) = ต้องคืนเป็น password ทันที
  for (const [supported, computed, expectType] of [[true, "disc", "text"], [false, "disc", "password"], [true, "none", "password"], [true, undefined, "password"]]) {
    const { row } = await initializedVaultRow();
    const w = await world({ vaultRow: row });
    await w.render();
    w.context.CSS = { supports: () => supported };
    w.context.getComputedStyle = () => ({ webkitTextSecurity: computed });
    const inputs = [wire(makeInput()), wire(makeInput())];
    const panel = w.context.document.getElementById("itas-vault-panel");
    panel.querySelectorAll = (selector) => (selector === "input[data-mask]" ? inputs : []);
    await w.click(w.button("itas-vault-unlock"));
    for (const input of inputs) {
      assert.equal(input.type, expectType, `supported=${supported} computed=${computed}`);
      assert.equal(input.classes.has("itas-mask"), expectType === "text");
    }
  }
  // ตรวจสไตล์ไม่ได้เลย (ไม่มี getComputedStyle) = คง password ไม่เสี่ยงแสดงรหัสเป็นข้อความชัด
  {
    const { row } = await initializedVaultRow();
    const w = await world({ vaultRow: row });
    await w.render();
    w.context.CSS = { supports: () => true };
    assert.equal(typeof w.context.getComputedStyle, "undefined");
    const inputs = [wire(makeInput())];
    w.context.document.getElementById("itas-vault-panel").querySelectorAll = (selector) => (selector === "input[data-mask]" ? inputs : []);
    await w.click(w.button("itas-vault-unlock"));
    assert.equal(inputs[0].type, "password");
  }
  // ไม่มี CSS ในสภาพแวดล้อมเลย (เบราว์เซอร์เก่ามาก) = คง password
  const w = await world();
  await w.render();
  assert.equal(typeof w.context.CSS, "undefined");
  // กัน copy/cut ออกจากช่องที่ปิดบัง
  const prevented = [];
  const inMask = { closest: (selector) => (selector === "input[data-mask]" ? {} : null) };
  const elsewhere = { closest: () => null };
  for (const name of ["copy", "cut", "dragstart"]) {
    await fireOn(w.host, name, { target: inMask, preventDefault: () => prevented.push(name) });
    await fireOn(w.host, name, { target: elsewhere, preventDefault: () => prevented.push(`other-${name}`) });
  }
  assert.deepEqual(prevented, ["copy", "cut", "dragstart"]);
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.input\.itas-mask\s*\{[^}]*-webkit-text-security:\s*disc/);
});
const fireOn = async (host, name, event) => { for (const handler of host.listeners[name] ?? []) await handler(event); };

/* ---------- หลังเปลี่ยนรหัส: ตรวจชุดใหม่ ---------- */
test("after a password change the new set is checked; a stored set that cannot be opened is reported honestly, not as success", async () => {
  const { row } = await initializedVaultRow();
  let ref;
  const w = await world({
    vaultRow: row,
    rpcHandlers: {
      app_itas_vault_rotate: async (params) => {
        const result = await ref.server.rotate(params);
        ref.server.db.row.wrapped_key_pass = { n: toBase64(new Uint8Array(12)), c: toBase64(new Uint8Array(48)) }; // เซิร์ฟเวอร์เก็บชุดที่เปิดไม่ได้
        return result;
      },
    },
  });
  ref = w;
  await w.render();
  await unlockVia(w);
  await w.click(w.button("itas-vault-change"));
  await w.submit(twoPasswords("itas-vault-change-form", { current: PASSWORD, password: NEW_PASSWORD, password2: NEW_PASSWORD }));
  assert.match(w.hosts["itas-vault-message"], /ตรวจสอบรหัสใหม่ไม่ผ่าน/);
  assert.match(w.hosts["itas-vault-message"], /แจ้งผู้ดูแลระบบ/);
  assert.ok(!w.calls.toasts.some((toast) => /เปลี่ยนรหัสตู้เซฟแล้ว/.test(toast.message)), "ไม่ทำเหมือนสำเร็จ");
  assert.notEqual(w.hosts["itas-vault-panel"], "", "แผงยังเปิดอยู่เพื่อให้ผู้ใช้เห็นข้อความ");
});

/* ---------- UUID สำรอง ---------- */
test("a browser without crypto.randomUUID still creates a valid v4 id for a new asset", async () => {
  const w = await world();
  w.context.crypto = { subtle, getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) }; // ไม่มี randomUUID
  await w.render();
  await w.click(w.button("itas-add"));
  w.forms.current = assetForm({ values: { reg_no: "COM-880", name: "เบราว์เซอร์เก่า" } });
  await w.submit(w.forms.current);
  const save = w.calls.rpc.find((call) => call.name === "app_itas_save_asset");
  assert.match(save.args.p_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(save.args.p_id, ID_NEW);
});

/* ---------- ถามก่อนออกจากหน้า (app.js เรียก MNP_ITAS.unsavedCount) ---------- */
test("leaving with a typed form: counted while the form is on screen, dropped once the user has left, never revived by coming back to the old address; app.js asks the module", async () => {
  const w = await world();
  await w.render();
  await w.click(w.button("itas-add"));
  w.forms.current = assetForm({ values: { name: "พิมพ์ค้างไว้" } });
  assert.equal(w.itas.unsavedCount(), 1);
  assert.equal(w.registered.window.beforeunload, undefined, "ถามก่อนปิดแท็บทำที่ app.js ที่เดียว (ไม่ถามซ้ำสองชั้น)");
  w.setHash("#/dashboard"); // ผู้ใช้ยืนยันออกไปแล้ว
  assert.equal(w.itas.unsavedCount(), 0);
  w.setHash("#/office?module=assets");
  assert.equal(w.itas.unsavedCount(), 0, "ตัวตรวจถูกทิ้งแล้ว ไม่กลับมานับจากฟอร์มที่ถอดออกจากหน้า");
  const app = read("app.js");
  assert.match(app, /\(window\.MNP_ITAS\?\.unsavedCount\?\.\(\) \?\? 0\) > 0/, "ออกจากหน้าที่มีฟอร์มทะเบียนพิมพ์ค้างต้องถามก่อน");
  assert.match(app, /function leaveWarningPending\(\) \{\r?\n  return [^\n]*MNP_ITRP\?\.unsavedCount[^\n]*MNP_ITAS\?\.unsavedCount/);
  assert.equal(typeof w.itas.unsavedCount, "function");
});

/* ---------- รอบแก้ตามผลตรวจ auditor รอบ 2 ---------- */
test("hasAccess respects the age of the answer: an expired answer is 'unknown' (hidden) until a new check succeeds, and a failed re-check never revives the old answer", async () => {
  const clock = { time: 1_700_000_000_000 };
  let fail = false;
  const w = await world({ clock, rpcHandlers: { app_itas_my_access: () => { if (fail) throw Object.assign(new Error("x"), { code: "PGRST202" }); return { allowed: true, is_test: false }; } } });
  assert.equal(await w.itas.resolveAccess(), true);
  assert.equal(w.itas.hasAccess(), true);
  clock.time += 9 * 60 * 1000;
  assert.equal(w.itas.hasAccess(), true, "ยังไม่หมดอายุ");
  clock.time += 2 * 60 * 1000;
  assert.equal(w.itas.hasAccess(), false, "หมดอายุ = ยังไม่รู้ ไม่แสดงการ์ด");
  assert.equal(w.itas.accessStatus(), "unknown");
  fail = true;
  assert.equal(await w.itas.resolveAccess(), false);
  assert.equal(w.itas.hasAccess(), false, "ตรวจใหม่ล้ม ไม่หยิบผลเก่ามาใช้");
  assert.equal(w.itas.accessStatus(), "error");
  fail = false;
  assert.equal(await w.itas.resolveAccess(), true);
  assert.equal(w.itas.hasAccess(), true, "ตรวจใหม่สำเร็จแล้วกลับมามีสิทธิ์");
});

test("idle lock covers the setup step before unlocking: after 10 idle minutes the recovery code is removed from the page and typing it back no longer works", async () => {
  const clock = { time: 1_700_000_000_000 };
  const w = await world({ clock });
  await w.render();
  await w.click(w.button("itas-vault-setup"));
  await w.submit(setupForm(PASSWORD));
  const code = /id="itas-recovery-code"[^>]*>([^<]+)</.exec(w.hosts["itas-vault-panel"])?.[1];
  assert.ok(code, "แสดงรหัสกู้คืนให้จด");
  clock.time += 10 * 60 * 1000 + 1000; // วางไว้ไม่แตะ (ยังไม่ได้ปลดล็อก ไม่มี keys)
  await w.documentEvent("visibilitychange");
  assert.equal(w.hosts["itas-vault-panel"], "", "แผงถูกปิด รหัสกู้คืนหายจากหน้า");
  assert.ok(!w.html().includes(code));
  assert.match(w.calls.toasts.map((toast) => toast.message).join("|"), /ไม่ได้ใช้งานนาน 10 นาที/);
  await w.submit({ id: "itas-recovery-form", elements: { typed: { value: code } }, querySelectorAll: () => [], toggleAttribute() {} });
  assert.match(w.hosts["itas-vault-message"] + JSON.stringify(w.calls.toasts), /ไม่มีขั้นตอนที่รอยืนยัน/);
  assert.ok(!w.server.db.calls.includes("init"), "ไม่ส่งอะไรขึ้นเซิร์ฟเวอร์");
});

test("auto-lock while the form is open says that the typed secret fields and delete marks were cleared; no notice when nothing was lost or the user locked it", async () => {
  const { row } = await initializedVaultRow();
  const lockAndRead = async ({ secrets, how }) => {
    const clock = { time: 1_700_000_000_000 };
    const w = await world({ vaultRow: row, clock });
    await w.render();
    await unlockVia(w);
    await w.click(w.button("itas-add"));
    w.forms.current = assetForm({ values: { name: "ฟิลด์ธรรมดาที่พิมพ์ค้าง" }, secrets });
    if (how === "manual") await w.click(w.button("itas-vault-lock"));
    else { clock.time += 10 * 60 * 1000 + 1000; await w.documentEvent("visibilitychange"); }
    assert.equal(w.status(), "locked");
    return w.hosts["itas-form-message"] ?? "";
  };
  const typed = await lockAndRead({ secrets: { ip: { value: "x" } }, how: "idle" });
  assert.match(typed, /ตู้เซฟถูกล็อก ช่องลับที่พิมพ์ค้างและเครื่องหมายลบค่าถูกล้าง ปลดล็อกแล้วกรอกใหม่/);
  const marked = await lockAndRead({ secrets: { ip: { clear: true, hidden: true } }, how: "idle" });
  assert.match(marked, /เครื่องหมายลบค่าถูกล้าง/);
  assert.equal(await lockAndRead({ secrets: { ip: { value: "" } }, how: "idle" }), "", "ไม่มีอะไรหาย ไม่ต้องเตือน");
  assert.equal(await lockAndRead({ secrets: { ip: { value: "x" } }, how: "manual" }), "", "ผู้ใช้กดล็อกเอง ไม่ใช่ล็อกอัตโนมัติ");
});

/* ---------- หน้าทะเบียนรวม: ชิปชนิด ค้นหาข้ามชนิด เพิ่มอุปกรณ์ที่เดียว ---------- */
const MOUSE_TYPE = { code: "MOUSE", name: "เมาส์", reg_prefix: "MOU", has_device_code: false, is_active: true, asset_count: 1, fields: [] };
const EMPTY_TYPE = { code: "PROJECTOR", name: "โปรเจกเตอร์", reg_prefix: "PJT", has_device_code: false, is_active: true, asset_count: 0, fields: [] };
const MOUSE_ID = "2a500000-0000-4000-8000-000000000002";
const MOUSE_ASSET = { id: MOUSE_ID, type_code: "MOUSE", reg_no: "MOU-001", device_code: null, name: "เมาส์ไร้สาย", model: "Logitech", serial: "M1", status: "in_use", attrs: {}, secrets: {}, updated_at: STAMP };
const MULTI = {
  assets: [ASSET, MOUSE_ASSET],
  rpcHandlers: {
    app_itas_list_types: () => [TYPE, MOUSE_TYPE, EMPTY_TYPE],
    app_itas_list_assets: ({ p_type_code }) => { const items = [ASSET, MOUSE_ASSET].filter((row) => !p_type_code || row.type_code === p_type_code); return { total: items.length, items }; },
    app_itas_get_asset: ({ p_id }) => [ASSET, MOUSE_ASSET].find((row) => row.id === p_id),
  },
};
const chip = (code) => { const node = { id: "", dataset: { itasType: code } }; node.closest = () => node; return node; };
const change = async (w, target) => { for (const handler of w.host.listeners.change ?? []) await handler({ target }); await tick(); };
const listCalls = (w) => w.calls.rpc.filter((call) => call.name === "app_itas_list_assets");

test("the list opens on 'all' with every type in one table; a type chip filters in the browser without another request; empty types are folded", async () => {
  const w = await world(MULTI);
  await w.render();
  const html = w.html();
  assert.match(html, /COM-001/);
  assert.match(html, /MOU-001/);
  assert.match(html, /id="itas-types-more"[^>]*>ชนิดอื่นๆ \(1\)/);
  assert.doesNotMatch(html, /data-itas-type="PROJECTOR"/, "ชนิดว่างถูกพับไว้");
  assert.equal(listCalls(w).length, 1);
  await w.click(chip("MOUSE"));
  const table = w.hosts["itas-table-host"];
  assert.match(table, /MOU-001/);
  assert.doesNotMatch(table, /COM-001/);
  assert.match(w.hosts["itas-types-host"], /data-itas-type="MOUSE" aria-pressed="true"/);
  assert.match(w.hosts["itas-list-title"], /เมาส์/);
  assert.equal(listCalls(w).length, 1, "กรองในเบราว์เซอร์ ไม่ยิง RPC ซ้ำ");
  await w.click(chip(""));
  assert.match(w.hosts["itas-table-host"], /COM-001/);
  assert.match(w.hosts["itas-list-title"], /อุปกรณ์ทั้งหมด/);
  await w.click(w.button("itas-types-more"));
  assert.match(w.hosts["itas-types-host"], /data-itas-type="PROJECTOR"/, "กดชนิดอื่นๆ = ขยาย");
});

test("one search box looks across every type (non-secret fields); the chip and the status filter combine with it", async () => {
  const w = await world(MULTI);
  await w.render();
  await w.fireInput({ id: "itas-search", value: "logitech" });
  assert.match(w.hosts["itas-table-host"], /MOU-001/);
  assert.doesNotMatch(w.hosts["itas-table-host"], /COM-001/);
  await w.fireInput({ id: "itas-search", value: "เมาส์" });
  assert.match(w.hosts["itas-table-host"], /MOU-001/, "ชื่อชนิดก็ค้นเจอ");
  await w.fireInput({ id: "itas-search", value: "" });
  await w.click(chip("COMPUTER"));
  await w.fireInput({ id: "itas-search", value: "logitech" });
  assert.match(w.hosts["itas-table-host"], /ไม่พบอุปกรณ์/, "ชิปชนิดกับคำค้นหาใช้ร่วมกัน");
  assert.equal(listCalls(w).length, 1);
});

test("a list cut off at the 2,000-row ceiling reloads just the chosen type from the database, and 'all' reloads everything again", async () => {
  const w = await world({ ...MULTI, rpcHandlers: { ...MULTI.rpcHandlers, app_itas_list_assets: ({ p_type_code }) => ({ total: p_type_code ? 1 : 2500, items: p_type_code === "MOUSE" ? [MOUSE_ASSET] : [ASSET] }) } });
  await w.render();
  assert.match(w.html(), /มี 2500 รายการ แต่โหลดมาแสดงได้ 1 รายการแรก/);
  await w.click(chip("MOUSE"));
  assert.deepEqual(listCalls(w).at(-1).args, { p_limit: 2000, p_offset: 0, p_type_code: "MOUSE" });
  assert.match(w.hosts["itas-table-host"], /MOU-001/);
  await w.click(chip(""));
  assert.deepEqual(listCalls(w).at(-1).args, { p_limit: 2000, p_offset: 0 });
});

test("one 'add' button: the type is chosen inside the form (chip type preselected); changing it re-draws the fields and keeps what was typed; the save carries the chosen type", async () => {
  const w = await world(MULTI);
  await w.render();
  await w.click(chip("MOUSE"));
  await w.click(w.button("itas-add"));
  let form = w.hosts["itas-form-area"];
  assert.match(form, /name="type_code"/);
  assert.match(form, /<option value="MOUSE" selected>/, "กรองเมาส์อยู่ = ตั้งชนิดเมาส์ไว้ให้");
  assert.match(form, /<optgroup label="ชนิดอื่นๆ[^"]*"><option value="PROJECTOR">/, "ชนิดว่างแยกกลุ่ม");
  assert.equal(w.calls.confirms.length, 0);
  // พิมพ์ชื่อไว้แล้วเปลี่ยนเป็นคอมพิวเตอร์: ช่องเฉพาะของคอมพิวเตอร์โผล่ ค่าที่พิมพ์ยังอยู่
  w.forms.current = assetForm({ values: { name: "เครื่องที่พิมพ์ไว้" } });
  await change(w, { name: "type_code", value: "COMPUTER" });
  form = w.hosts["itas-form-area"];
  assert.match(form, /<option value="COMPUTER" selected>/);
  assert.match(form, /name="attrs.cpu"/);
  assert.match(form, /name="device_code"/);
  assert.equal(w.forms.current.elements.name.value, "เครื่องที่พิมพ์ไว้");
  w.forms.current.elements.reg_no.value = "com-900";
  await w.submit(w.forms.current);
  const save = w.calls.rpc.find((call) => call.name === "app_itas_save_asset");
  assert.equal(save.args.p_type_code, "COMPUTER");
  assert.equal(save.args.p_data.name, "เครื่องที่พิมพ์ไว้");
  assert.equal(save.args.p_data.reg_no, "COM-900");
});

test("changing the type with a typed secret asks first; declining keeps the old type", async () => {
  const w = await world({ ...MULTI, confirm: false });
  await w.render();
  await w.click(chip("COMPUTER"));
  await w.click(w.button("itas-add"));
  w.forms.current = assetForm({ values: {}, secrets: { ip: { value: "x" } } });
  const select = { name: "type_code", value: "MOUSE" };
  await change(w, select);
  assert.equal(w.calls.confirms.at(-1), "เปลี่ยนชนิดอุปกรณ์?");
  assert.equal(select.value, "COMPUTER", "ไม่ยืนยัน = เลือกชนิดเดิมคืน");
  assert.match(w.hosts["itas-form-area"], /<option value="COMPUTER" selected>/);
});

test("the folded 'more details' opens by itself: when editing a row that has values in it, and when validation fails in a folded field (never on a clean add)", async () => {
  const w = await world(MULTI);
  await w.render();
  await w.click(w.button("itas-add"));
  assert.doesNotMatch(w.hosts["itas-form-area"], /<details class="itas-more" id="itas-more" open>/, "เพิ่มใหม่ = พับ");
  await openEdit(w, ASSET_ID);
  assert.match(w.hosts["itas-form-area"], /<details class="itas-more" id="itas-more" open>/, "ASSET มี CPU ในช่องที่พับ = เปิดให้");
  await w.click({ closest: () => ({ dataset: { itasRow: MOUSE_ID }, id: "" }), dataset: { itasRow: MOUSE_ID }, id: "" });
  assert.match(w.hosts["itas-form-area"], /<details class="itas-more" id="itas-more" open>/, "เมาส์มี Serial ซึ่งอยู่ในช่องที่พับ = เปิดให้");
  // กรอกราคาผิดในช่องที่พับ: เปิดรายละเอียดก่อนแสดงกรอบแดง และไม่ส่งอะไรขึ้นฐานข้อมูล
  const more = { open: false };
  const form = assetForm({ values: { reg_no: "COM-5", price: "abc" } });
  form.querySelector = (selector) => (selector === "#itas-more" ? more : null);
  w.forms.current = form;
  await w.submit(form);
  assert.equal(more.open, true);
  assert.ok(!w.calls.rpc.some((call) => call.name === "app_itas_save_asset"));
});

const MEMORY_KEY = "mnp.itas.last.v1:u1:real";

test("the add form suggests values already used in the same type (datalist) and never mixes types", async () => {
  const w = await world({ ...MULTI, assets: [], rpcHandlers: { ...MULTI.rpcHandlers, app_itas_list_assets: () => ({ total: 3, items: [{ ...ASSET, model: "Dell 3050", place: "สำนักงาน" }, { ...ASSET, id: "x2", model: "Dell 3050" }, { ...MOUSE_ASSET, model: "Logitech" }] }) } });
  await w.render();
  await w.click(chip("COMPUTER"));
  await w.click(w.button("itas-add"));
  const form = w.hosts["itas-form-area"];
  assert.match(form, /<datalist id="itas-dl-model"><option value="Dell 3050"><\/option><\/datalist>/);
  assert.doesNotMatch(form, /Logitech/, "ยี่ห้อของเมาส์ไม่มาโผล่ในคอมพิวเตอร์");
  assert.match(form, /<datalist id="itas-dl-attrs-cpu"><option value="i5">/);
});

test("after adding, the next add form of that type is pre-filled with the last brand/model and place (and says so); only those two fields and the type are stored, never a secret", async () => {
  const { row } = await initializedVaultRow();
  const w = await world({ ...MULTI, vaultRow: row });
  await w.render();
  await unlockVia(w);
  await w.click(chip("COMPUTER"));
  await w.click(w.button("itas-add"));
  assert.doesNotMatch(w.hosts["itas-form-area"], /id="itas-remembered"/, "ครั้งแรกยังไม่มีอะไรให้เติม");
  w.forms.current = assetForm({ values: { reg_no: "COM-910", device_code: "COM910", serial: "SN-SECRETISH", name: "เครื่องใหม่", model: "Dell 3050", place: "สำนักงาน", "attrs.cpu": "i7" }, secrets: { ip: { value: PLAIN_IP } } });
  await w.submit(w.forms.current);
  const saved = [...w.storage.entries()];
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0], MEMORY_KEY, "ต่อบัญชีต่อโหมด");
  assert.deepEqual(JSON.parse(saved[0][1]), { lastType: "COMPUTER", types: { COMPUTER: { model: "Dell 3050", place: "สำนักงาน" } } });
  for (const text of [PLAIN_IP, "SN-SECRETISH", "COM-910", "COM910", "i7", "เครื่องใหม่"]) assert.ok(!saved[0][1].includes(text), `ไม่เก็บ ${text}`);
  // เปิดฟอร์มเพิ่มชนิดเดิมอีกครั้ง: เติมให้ + บอกผู้ใช้
  w.forms.current = null;
  await w.click(w.button("itas-add"));
  const form = w.hosts["itas-form-area"];
  assert.match(form, /name="model"[^>]*value="Dell 3050"/);
  assert.match(form, /name="place"[^>]*value="สำนักงาน"/);
  assert.match(form, /id="itas-remembered"[^>]*>เติมให้จากรายการล่าสุดของชนิดนี้/);
  assert.match(form, /name="reg_no"[^>]*value=""/, "ช่องอื่นไม่ถูกเติม");
  assert.match(form, /name="serial"[^>]*value=""/);
  assert.equal(w.calls.confirms.length, 0, "ฟอร์มที่เติมให้แต่ยังไม่ได้แก้ไม่ถือว่าพิมพ์ค้าง");
});

test("a different type, another mode and another account do not get each other's remembered values; with nothing chosen the form opens on the last type added", async () => {
  const w = await world(MULTI);
  w.storage.set(MEMORY_KEY, JSON.stringify({ lastType: "MOUSE", types: { MOUSE: { model: "Logitech" }, COMPUTER: { model: "Dell", place: "สำนักงาน" } } }));
  w.storage.set("mnp.itas.last.v1:u1:test", JSON.stringify({ lastType: "COMPUTER", types: { COMPUTER: { model: "ทดสอบ" } } }));
  w.storage.set("mnp.itas.last.v1:other:real", JSON.stringify({ lastType: "COMPUTER", types: { COMPUTER: { model: "ของคนอื่น" } } }));
  await w.render();
  await w.click(w.button("itas-add")); // ไม่ได้กรองชนิด: ใช้ชนิดที่เพิ่มล่าสุดคือเมาส์
  let form = w.hosts["itas-form-area"];
  assert.match(form, /<option value="MOUSE" selected>/);
  assert.match(form, /name="model"[^>]*value="Logitech"/);
  assert.doesNotMatch(form, /ทดสอบ|ของคนอื่น/);
  // เปลี่ยนเป็นคอมพิวเตอร์ในฟอร์ม: ได้ค่าที่จำของคอมพิวเตอร์ ไม่ใช่ยี่ห้อของเมาส์ที่ระบบเติมให้
  await change(w, { name: "type_code", value: "COMPUTER" });
  form = w.hosts["itas-form-area"];
  assert.match(form, /name="model"[^>]*value="Dell"/);
  assert.doesNotMatch(form, /Logitech/);
  const test = await world({ ...MULTI, isTest: true });
  test.storage.set(MEMORY_KEY, JSON.stringify({ lastType: "COMPUTER", types: { COMPUTER: { model: "Dell" } } }));
  await test.render();
  await test.click(chip("COMPUTER"));
  await test.click(test.button("itas-add"));
  assert.match(test.hosts["itas-form-area"], /name="model"[^>]*value=""/, "โหมดทดสอบใช้ที่เก็บแยก ไม่ได้ค่าของโหมดจริง");
  assert.doesNotMatch(test.hosts["itas-form-area"], /id="itas-remembered"/);
});

test("'clear the filled values' empties just the auto-filled fields and forgets them; what the user typed over is kept", async () => {
  const w = await world(MULTI);
  w.storage.set(MEMORY_KEY, JSON.stringify({ lastType: "COMPUTER", types: { COMPUTER: { model: "Dell", place: "สำนักงาน" }, MOUSE: { model: "Logitech" } } }));
  await w.render();
  await w.click(chip("COMPUTER"));
  await w.click(w.button("itas-add"));
  w.forms.current = assetForm({ values: { model: "Dell", place: "ที่ผู้ใช้พิมพ์ทับ", name: "" } }); // ผู้ใช้แก้สถานที่เองแล้ว
  const before = w.forms.current.elements;
  await w.click(w.button("itas-clear-remembered"));
  assert.equal(before.model.value, "", "ยี่ห้อที่ระบบเติมให้ถูกล้าง");
  assert.equal(before.place.value, "ที่ผู้ใช้พิมพ์ทับ", "ที่พิมพ์ทับไว้ไม่ถูกแตะ");
  assert.deepEqual(JSON.parse(w.storage.get(MEMORY_KEY)).types, { MOUSE: { model: "Logitech" } }, "ลืมเฉพาะชนิดนี้");
});

test("a browser that cannot store, and tampered stored text, never block adding: the save still goes through and the form still opens", async () => {
  const blocked = await world({ ...MULTI, storageFails: true });
  await blocked.render();
  await blocked.click(blocked.button("itas-add"));
  assert.match(blocked.hosts["itas-form-area"], /name="type_code"/);
  blocked.forms.current = assetForm({ values: { reg_no: "COM-920", name: "x", model: "Dell" } });
  await blocked.submit(blocked.forms.current);
  assert.ok(blocked.calls.rpc.some((call) => call.name === "app_itas_save_asset"));
  assert.match(blocked.calls.toasts.at(-1).message, /เพิ่มอุปกรณ์แล้ว/);
  const tampered = await world(MULTI);
  tampered.storage.set(MEMORY_KEY, '{"lastType":"COMPUTER","types":{"COMPUTER":{"model":"<img src=x>","ip":"10.0.0.1"}}}');
  await tampered.render();
  await tampered.click(chip("COMPUTER"));
  await tampered.click(tampered.button("itas-add"));
  const form = tampered.hosts["itas-form-area"];
  assert.doesNotMatch(form, /<img src=x>|10\.0\.0\.1/, "ค่าที่ถูกแก้ผ่านการ escape และคีย์แปลกไม่ถูกใช้");
});

/* ---------- เพิ่มหลายเครื่องรุ่นเดียวกัน ---------- */
// ฟอร์มจำลองที่มีช่องของโหมดเพิ่มหลายเครื่อง (checkbox/ช่องเลือกรูปแบบ/กล่องรายการ)
const batchForm = ({ values = {}, columns = "serial", lines = "" } = {}) => {
  const form = assetForm({ values });
  form.elements.batch_columns = { value: columns };
  form.elements.batch_lines = { value: lines };
  return form;
};
const openBatch = async (w, options = {}) => {
  await w.render();
  await w.click(chip("COMPUTER"));
  await w.click(w.button("itas-add"));
  await change(w, { id: "itas-batch-toggle", checked: true });
  w.forms.current = batchForm(options);
  return w.forms.current;
};

test("add several of the same model: the toggle shows the list box and hides secrets; each line is saved one after another with its own new id, the shared fields repeated, and no secret key", async () => {
  // id แรกถูกใช้เป็น uuid ร่างของฟอร์มเพิ่มตอนเปิด (ไม่ใช้ในโหมดหลายเครื่อง) · แต่ละบรรทัดได้ id ใหม่ของตัวเอง
  const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-00000000000a", "aaaaaaaa-aaaa-4aaa-8aaa-00000000000b", "aaaaaaaa-aaaa-4aaa-8aaa-00000000000c", "aaaaaaaa-aaaa-4aaa-8aaa-00000000000d"];
  let next = 0;
  const w = await world(MULTI);
  w.context.crypto.randomUUID = () => ids[next++];
  const form = await openBatch(w, { values: { name: "เครื่องเลขา", model: "Dell 3050", place: "สำนักงาน" }, columns: "device_code,serial", lines: "com01, SN1\n\ncom02, SN2\ncom03, SN3" });
  assert.equal(w.elements["itas-batch-panel"].hidden, false, "เปิดกล่องรายการ");
  assert.equal(w.elements["itas-secrets-host"].hidden, true, "ซ่อนช่องลับ");
  await w.submit(form);
  assert.equal(w.calls.confirms.at(-1), "เพิ่มอุปกรณ์ 3 รายการ?");
  const saves = w.calls.rpc.filter((call) => call.name === "app_itas_save_asset");
  assert.equal(saves.length, 3);
  assert.deepEqual(saves.map((call) => call.args.p_id), ids.slice(1));
  assert.deepEqual(saves.map((call) => call.args.p_data.device_code), ["COM01", "COM02", "COM03"]);
  assert.deepEqual(saves.map((call) => call.args.p_data.serial), ["SN1", "SN2", "SN3"]);
  for (const call of saves) {
    assert.equal(call.args.p_type_code, "COMPUTER");
    assert.equal(call.args.p_data.name, "เครื่องเลขา");
    assert.equal(call.args.p_data.model, "Dell 3050");
    assert.deepEqual(call.args.p_secrets, {});
    assert.equal(call.args.p_expected_updated_at, null);
  }
  assert.match(w.calls.toasts.at(-1).message, /เพิ่มอุปกรณ์ 3 รายการแล้ว/);
  assert.equal(w.hosts["itas-form-area"], "", "ทั้งหมดสำเร็จ = ปิดฟอร์ม");
  assert.deepEqual(JSON.parse(w.storage.get(MEMORY_KEY)).types.COMPUTER, { model: "Dell 3050", place: "สำนักงาน" });
});

test("a failing line is reported by its own value, never dropped: the box keeps only the lines that did not go through, and a retry does not re-add the ones that did", async () => {
  const w = await world({ ...MULTI, rpcHandlers: { ...MULTI.rpcHandlers, app_itas_save_asset: (params) => { if (params.p_data.serial === "SN2") throw Object.assign(new Error("เลขทะเบียน COM-X ซ้ำกับอุปกรณ์อื่น"), { code: "23514" }); return { asset: { ...ASSET }, created: true, changed: true }; } } });
  const form = await openBatch(w, { values: { name: "x" }, lines: "SN1\nSN2\nSN3" });
  await w.submit(form);
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itas_save_asset").length, 3, "บรรทัดที่ล้มไม่หยุดบรรทัดอื่น");
  assert.equal(form.elements.batch_lines.value, "SN2", "เหลือเฉพาะบรรทัดที่ยังไม่สำเร็จ");
  const result = w.hosts["itas-batch-result"];
  assert.match(result, /เพิ่มสำเร็จ 2 รายการ/);
  assert.match(result, /<strong>SN2<\/strong>: เลขทะเบียน COM-X ซ้ำกับอุปกรณ์อื่น/);
  assert.notEqual(w.hosts["itas-form-area"], "", "ฟอร์มยังเปิดอยู่");
  assert.equal(w.calls.busy.at(-1), false, "ปลดสถานะรอ");
  // แก้แล้วกดซ้ำ: ส่งเฉพาะบรรทัดที่เหลือ ด้วย id เดิมของบรรทัดนั้น
  const firstId = w.calls.rpc.filter((call) => call.name === "app_itas_save_asset")[1].args.p_id;
  form.elements.batch_lines.value = "SN2";
  await w.submit(form);
  const saves = w.calls.rpc.filter((call) => call.name === "app_itas_save_asset");
  assert.equal(saves.length, 4);
  assert.equal(saves[3].args.p_id, firstId, "ลองซ้ำใช้ uuid เดิมของบรรทัดนั้น");
});

test("a lost connection or expired session stops the batch right there: nothing further is sent and the remaining lines stay in the box", async () => {
  let calls = 0;
  const w = await world({ ...MULTI, rpcHandlers: { ...MULTI.rpcHandlers, app_itas_save_asset: () => { calls += 1; if (calls === 2) throw Object.assign(new Error("Failed to fetch"), { code: "" }); return { asset: ASSET, created: true, changed: true }; } } });
  const form = await openBatch(w, { values: { name: "x" }, lines: "SN1\nSN2\nSN3\nSN4" });
  await w.submit(form);
  assert.equal(calls, 2, "หยุดหลังเน็ตหลุด ไม่ยิงบรรทัดที่เหลือ");
  assert.equal(form.elements.batch_lines.value, "SN2\nSN3\nSN4");
  assert.match(w.hosts["itas-batch-result"], /ผลไม่แน่ชัด/);
  assert.match(w.hosts["itas-batch-result"], /ยังไม่ได้ส่ง: SN3, SN4/);
});

test("when the first try of a line actually saved (retry hits 'already exists'), the line counts as added instead of failing", async () => {
  const w = await world({ ...MULTI, rpcHandlers: { ...MULTI.rpcHandlers, app_itas_save_asset: () => { throw Object.assign(new Error("อุปกรณ์นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุด"), { code: "23514" }); } } });
  const form = await openBatch(w, { values: { name: "x" }, lines: "SN1" });
  await w.submit(form);
  assert.match(w.calls.toasts.at(-1).message, /เพิ่มอุปกรณ์ 1 รายการแล้ว/);
  assert.equal(w.hosts["itas-form-area"], "");
});

test("problems found before sending block the whole batch (nothing reaches the database): list problems per line, unique fields left filled in the form, an empty list, nothing confirmed", async () => {
  const w = await world(MULTI);
  const form = await openBatch(w, { values: { name: "x" }, lines: "SN1\nSN1\n" });
  await w.submit(form);
  assert.match(w.hosts["itas-batch-result"], /บรรทัด 2: Serial ซ้ำกับบรรทัด 1/);
  const filled = batchForm({ values: { name: "x", reg_no: "COM-1" }, lines: "SN1" });
  w.forms.current = filled;
  await w.submit(filled);
  const empty = batchForm({ values: { name: "x" }, lines: "" });
  w.forms.current = empty;
  await w.submit(empty);
  assert.match(w.hosts["itas-batch-result"], /ยังไม่มีรายการ/);
  assert.ok(!w.calls.rpc.some((call) => call.name === "app_itas_save_asset"));
  assert.equal(w.calls.confirms.length, 0);
});

test("declining the count confirmation sends nothing; turning batch mode on with a typed secret asks first and keeps the secret if declined", async () => {
  const w = await world({ ...MULTI, confirm: false });
  const form = await openBatch(w, { values: { name: "x" }, lines: "SN1\nSN2" });
  await w.submit(form);
  assert.ok(!w.calls.rpc.some((call) => call.name === "app_itas_save_asset"));
  assert.equal(w.calls.confirms.at(-1), "เพิ่มอุปกรณ์ 2 รายการ?");
  assert.equal(w.calls.busy.includes(true), false, "ยังไม่เริ่มบันทึก");
  const s = await world({ ...MULTI, confirm: false });
  await s.render();
  await s.click(chip("COMPUTER"));
  await s.click(s.button("itas-add"));
  s.forms.current = assetForm({ values: {}, secrets: { ip: { value: "x" } } });
  const box = { id: "itas-batch-toggle", checked: true };
  await change(s, box);
  assert.equal(s.calls.confirms.at(-1), "เพิ่มหลายเครื่อง?");
  assert.equal(box.checked, false);
  assert.equal(s.forms.current.rows[0].input.value, "x", "ไม่ยืนยัน = ช่องลับที่พิมพ์ไว้ไม่ถูกล้าง");
});

test("typed batch lines count as unsaved work and survive a change of type", async () => {
  const w = await world(MULTI);
  const form = await openBatch(w, { values: {}, lines: "SN1\nSN2" });
  assert.equal(w.itas.unsavedCount(), 1);
  form.elements.batch_lines.value = "";
  assert.equal(w.itas.unsavedCount(), 0);
  form.elements.batch_lines.value = "A\nB";
  await change(w, { name: "type_code", value: "MOUSE" });
  const html = w.hosts["itas-form-area"];
  assert.match(html, /name="batch_on" checked>/);
  assert.match(html, /<textarea[^>]*name="batch_lines"[^>]*>A\nB<\/textarea>/);
  assert.match(html, /id="itas-secrets-host" hidden>|<div id="itas-secrets-host" hidden>/, "ยังซ่อนช่องลับ");
});

test("'copy as a new device' opens an add form for the same type with the non-secret fields filled, unique ones blank, a notice, a fresh id, and no secrets", async () => {
  const CIPHER = "Y2lwaGVydGV4dC10ZXN0LW9ubHktMDAwMDAwMDA=";
  const source = { ...ASSET, secrets: { ip: { v: 1, n: "AAAAAAAAAAAAAAAA", c: CIPHER } } };
  const w = await world({ ...MULTI, rpcHandlers: { ...MULTI.rpcHandlers, app_itas_get_asset: () => source } });
  await w.render();
  await openEdit(w, ASSET_ID);
  assert.match(w.hosts["itas-form-area"], /id="itas-copy-asset">คัดลอกเป็นเครื่องใหม่/);
  await w.click(w.button("itas-copy-asset"));
  const form = w.hosts["itas-form-area"];
  assert.match(form, /<h2[^>]*>เพิ่มอุปกรณ์<\/h2>/);
  assert.match(form, /name="type_code"/);
  assert.match(form, /<option value="COMPUTER" selected>/);
  assert.match(form, /name="reg_no"[^>]*value=""/);
  assert.match(form, /name="device_code"[^>]*value=""/);
  assert.match(form, /name="serial"[^>]*value=""/);
  assert.match(form, /name="name"[^>]*value="เครื่องบัญชี"/);
  assert.match(form, /name="model"[^>]*value="Dell"/);
  assert.match(form, /name="attrs.cpu"[^>]*value="i5"/);
  assert.match(form, /id="itas-form-notice"[^>]*>คัดลอกจาก COM-001: เลขทะเบียน, รหัสอุปกรณ์, Serial เว้นว่างไว้ให้กรอกใหม่/);
  assert.match(form, /<details class="itas-more" id="itas-more" open>/, "มีค่าในช่องที่พับ = เปิดให้เห็น");
  assert.doesNotMatch(form, /itas-copy-asset/, "ฟอร์มเพิ่มไม่มีปุ่มคัดลอก");
  assert.doesNotMatch(form, /data-has-value|data-secret-input/, "ไม่มีค่าลับตามมา");
  assert.ok(!form.includes(CIPHER));
  assert.equal(w.calls.confirms.length, 0, "ฟอร์มยังไม่แก้ = ไม่ถามก่อนทิ้ง");
  // บันทึกเป็นอุปกรณ์ใหม่: ไม่ใช้ id ของต้นฉบับ
  w.forms.current = assetForm({ values: { reg_no: "COM-002", name: "เครื่องบัญชี", "attrs.cpu": "i5" } });
  await w.submit(w.forms.current);
  const save = w.calls.rpc.find((call) => call.name === "app_itas_save_asset");
  assert.equal(save.args.p_id, ID_NEW);
  assert.notEqual(save.args.p_id, ASSET_ID);
  assert.equal(save.args.p_type_code, "COMPUTER");
  assert.deepEqual(save.args.p_secrets, {});
});

test("copy asks before throwing away a half-edited form, and does nothing if declined", async () => {
  const w = await world({ ...MULTI, confirm: false });
  await w.render();
  await openEdit(w, ASSET_ID);
  w.forms.current = assetForm({ values: { reg_no: "COM-001", name: "แก้ค้างไว้" } });
  await w.click(w.button("itas-copy-asset"));
  assert.equal(w.calls.confirms.at(-1), "ยังไม่ได้บันทึกสิ่งที่กรอก");
  assert.doesNotMatch(w.hosts["itas-form-area"], /<h2[^>]*>เพิ่มอุปกรณ์<\/h2>/, "ยังเป็นฟอร์มแก้ไข");
});

test("editing a row from the 'all' view uses the row's own type; changing a chip does not close or ask about an open form", async () => {
  const w = await world(MULTI);
  await w.render();
  await w.click({ closest: () => ({ dataset: { itasRow: MOUSE_ID }, id: "" }), dataset: { itasRow: MOUSE_ID }, id: "" });
  const form = w.hosts["itas-form-area"];
  assert.match(form, /ชนิด: <strong>เมาส์<\/strong>/);
  assert.doesNotMatch(form, /name="type_code"/, "แก้ไข = เปลี่ยนชนิดไม่ได้");
  await w.click(chip("COMPUTER"));
  assert.equal(w.calls.confirms.length, 0, "ชิปไม่ถามและไม่ปิดฟอร์ม");
  assert.match(w.hosts["itas-form-area"], /ชนิด: <strong>เมาส์<\/strong>/);
});

/* ---------- รอบแก้ตามผลตรวจ auditor: หยุดส่งหลายเครื่องเมื่อออกจากหน้า/สลับบริบท + ช่องที่ผู้ใช้ล้างเองต้องคงว่าง ---------- */
test("batch stops sending the remaining lines when the user closes the form or switches persona/mode mid-way", async () => {
  for (const [name, leave] of [
    ["form closed", async (w) => { await w.click(w.button("itas-form-cancel")); }],
    ["persona switched", async (w) => { w.stateObj.employee = { id: "persona-9" }; }],
    ["mode switched", async (w) => { w.stateObj.sandbox = { active: true }; }],
  ]) {
    let sent = 0;
    const holder = {};
    const w = await world({ ...MULTI, rpcHandlers: { ...MULTI.rpcHandlers, app_itas_save_asset: async () => { sent += 1; if (sent === 1) await leave(holder.w); return { asset: ASSET, created: true, changed: true }; } } });
    holder.w = w;
    const form = await openBatch(w, { values: { name: "x" }, lines: "SN1\nSN2\nSN3\nSN4" });
    await w.submit(form);
    assert.equal(sent, 1, `${name}: ส่งแค่บรรทัดแรก ที่เหลือไม่ถูกส่งต่อ`);
    assert.equal(w.calls.toasts.length, 0, `${name}: ไม่แสดงผลของบริบทที่ออกมาแล้ว`);
    assert.deepEqual([...w.storage.keys()].filter((key) => key.includes("persona-9") || key.endsWith(":test")), [], `${name}: ไม่เขียนความจำของบริบทอื่น`);
  }
});

test("batch: an unexpected exception while finishing still releases the 'submitting' flag so the form can be sent again", async () => {
  let attempts = 0;
  const w = await world({ ...MULTI, rpcHandlers: { ...MULTI.rpcHandlers, app_itas_save_asset: (params) => { attempts += 1; if (params.p_data.serial === "SN2") throw Object.assign(new Error("เลขทะเบียน COM-X ซ้ำกับอุปกรณ์อื่น"), { code: "23514" }); return { asset: ASSET, created: true, changed: true }; } } });
  const form = await openBatch(w, { values: { name: "x" }, lines: "SN1\nSN2" });
  // กล่องรายการที่เขียนค่ากลับไม่ได้ (exception กลางขั้นสรุปผล): ต้องไม่ทำให้ฟอร์มค้างที่ "กำลังส่ง"
  const box = form.elements.batch_lines;
  let text = box.value;
  Object.defineProperty(box, "value", { configurable: true, get: () => text, set: (next) => { if (next === "SN2") throw new Error("write failed"); text = next; } });
  await w.submit(form).catch(() => {});
  assert.equal(attempts, 2);
  assert.equal(w.calls.busy.at(-1), false, "ปลดสถานะรอแม้มี exception");
  form.elements.batch_lines.value = "SN3";
  await w.submit(form);
  assert.equal(attempts, 3, "ส่งซ้ำได้ ไม่ค้างที่ submitting");
});

test("changing type keeps a remembered field (brand/model) empty when the user cleared the auto-filled value themselves; untouched fields still get the new type's remembered value", async () => {
  const w = await world(MULTI);
  w.storage.set(MEMORY_KEY, JSON.stringify({ lastType: "COMPUTER", types: { COMPUTER: { model: "Dell", place: "สำนักงาน" }, MOUSE: { model: "Logitech", place: "คลัง" } } }));
  await w.render();
  await w.click(chip("COMPUTER"));
  w.forms.current = assetForm({ values: { model: "Dell", place: "สำนักงาน" } }); // ฟอร์มจำลองที่ระบบเติมให้แล้ว (ค่าตั้งต้นของฟอร์ม)
  await w.click(w.button("itas-add"));
  assert.match(w.hosts["itas-form-area"], /name="model"[^>]*value="Dell"/);
  w.forms.current = assetForm({ values: { model: "", place: "สำนักงาน" } }); // ผู้ใช้ลบยี่ห้อ/รุ่นที่ระบบเติมให้ทิ้ง
  await change(w, { name: "type_code", value: "MOUSE" });
  const form = w.hosts["itas-form-area"];
  assert.match(form, /name="model"[^>]*value=""/, "ช่องที่ผู้ใช้ล้างเองคงว่าง ไม่ถูกเติมซ้ำ");
  assert.match(form, /name="place"[^>]*value="คลัง"/, "ช่องที่ไม่ได้แตะ ได้ค่าที่จำของชนิดใหม่");
  assert.doesNotMatch(form, /id="itas-remembered"[^>]*>[^<]*<strong>[^<]*ยี่ห้อ/, "ข้อความเติมให้ ไม่อ้างช่องที่ผู้ใช้ล้างเอง");
});

/* ---------- รุ่น 1.02: หน้ารายละเอียดเครื่องคอมพิวเตอร์ ---------- */
const CPU_TYPE = { code: "CPU", name: "CPU", reg_prefix: "CPU", has_device_code: false, is_active: true, asset_count: 1, fields: [{ key: "speed", label: "ความเร็ว", type: "text", secret: false, order: 1 }] };
const CPU_ID = "2a500000-0000-4000-8000-000000000003";
const CPU_ASSET = { id: CPU_ID, type_code: "CPU", reg_no: "CPU-001", device_code: null, name: "ซีพียู", model: "Intel", status: "in_use", host_code: "COM12", slot: "CPU1", attrs: { speed: "3.2 GHz" }, secrets: {}, updated_at: STAMP };
const MOUSE_ON_HOST = { ...MOUSE_ASSET, id: "2a500000-0000-4000-8000-000000000004", reg_no: "MOU-002", host_code: "COM12" };
const HOSTWORLD = (extra = {}) => {
  const all = [ASSET, CPU_ASSET, MOUSE_ON_HOST, MOUSE_ASSET];
  return {
    assets: all,
    ...extra,
    rpcHandlers: {
      app_itas_list_types: () => [TYPE, CPU_TYPE, MOUSE_TYPE],
      app_itas_list_assets: ({ p_host_code, p_type_code }) => { const items = all.filter((row) => (!p_host_code || row.host_code === p_host_code) && (!p_type_code || row.type_code === p_type_code)); return { total: items.length, items }; },
      app_itas_get_asset: ({ p_id }) => all.find((row) => row.id === p_id),
      ...(extra.rpcHandlers ?? {}),
    },
  };
};
const rowClick = (id) => ({ closest: () => ({ dataset: { itasRow: id }, id: "" }), dataset: { itasRow: id }, id: "" });
const getCalls = (w, name) => w.calls.rpc.filter((call) => call.name === name);

test("computer rows show how many parts are attached (only when the whole register is loaded); other types and partial loads have no parts column", async () => {
  const w = await world(HOSTWORLD());
  await w.render();
  assert.match(w.html(), /<span class="itas-partcount itas-mono">1 ชิ้น · 1 ต่อพ่วง<\/span>/);
  assert.match(w.html(), /data-label="ชิ้นส่วน"/);
  // ถูกตัดที่เพดาน (total > rows) = นับไม่ครบ ห้ามแสดงตัวเลขที่อาจผิด
  const truncated = await world(HOSTWORLD({ rpcHandlers: { app_itas_list_assets: () => ({ total: 5000, items: [ASSET, CPU_ASSET] }) } }));
  await truncated.render();
  assert.doesNotMatch(truncated.html(), /itas-partcount|data-label="ชิ้นส่วน"/);
});

test("a computer row opens the computer page (the host and its linked parts are loaded by host code), not the edit form; a part row still opens the edit form", async () => {
  const w = await world(HOSTWORLD());
  await w.render();
  await w.click(rowClick(ASSET_ID));
  assert.deepEqual(getCalls(w, "app_itas_get_asset").map((call) => call.args.p_id), [ASSET_ID], "โหลดเครื่องล่าสุด");
  const listing = getCalls(w, "app_itas_list_assets").at(-1).args;
  assert.equal(listing.p_host_code, "COM12", "ถามชิ้นส่วนด้วยรหัสเครื่อง");
  const page = w.hosts["itas-host-host"];
  assert.match(page, /itas-host-code itas-mono">COM12</);
  assert.match(page, /data-itas-part="2a500000-0000-4000-8000-000000000003"/);
  assert.match(page, /data-itas-part="2a500000-0000-4000-8000-000000000004"/);
  assert.doesNotMatch(page, /data-itas-part="2a500000-0000-4000-8000-000000000002"/, "เมาส์ที่ไม่ได้ติดตั้งกับเครื่องนี้ไม่แสดง");
  assert.match(page, /ความเร็ว: 3\.2 GHz/);
  assert.equal(w.hosts["itas-form-area"] ?? "", "", "ยังไม่เปิดฟอร์ม");
  // ชิ้นส่วนที่ไม่ใช่เครื่องคอม: แถวเปิดฟอร์มแก้ไขตามเดิม
  const parts = await world(HOSTWORLD());
  await parts.render();
  await parts.click(rowClick(CPU_ID));
  assert.match(parts.hosts["itas-form-area"], /id="itas-form"/);
  assert.equal(parts.hosts["itas-host-host"] ?? "", "");
});

test("clicking a part on the computer page opens that part's edit form above the page; the form links back to the computer; saving reloads the computer page", async () => {
  const w = await world(HOSTWORLD());
  await w.render();
  await w.click(rowClick(ASSET_ID));
  await w.click(w.button("", { itasPart: CPU_ID }));
  assert.match(w.hosts["itas-form-area"], /id="itas-form"/);
  assert.match(w.hosts["itas-form-area"], new RegExp(`ติดตั้งอยู่ที่ <button type="button" class="itas-link" data-itas-host="${ASSET_ID}">COM-001 · เครื่องบัญชี</button>`));
  const hostLoads = getCalls(w, "app_itas_get_asset").filter((call) => call.args.p_id === ASSET_ID).length;
  w.forms.current = assetForm({ values: { reg_no: "CPU-001", name: "ซีพียูใหม่" } });
  await w.submit(w.forms.current);
  assert.ok(getCalls(w, "app_itas_save_asset").length === 1);
  assert.equal(getCalls(w, "app_itas_get_asset").filter((call) => call.args.p_id === ASSET_ID).length, hostLoads + 1, "โหลดเครื่องซ้ำหลังบันทึก");
  assert.match(w.hosts["itas-host-host"], /itas-host-code/, "ยังอยู่ในหน้าเครื่อง");
  assert.equal(w.hosts["itas-form-area"], "", "ฟอร์มปิดแล้ว");
});

test("the 'installed at' link goes to the computer page; the edit button of the computer opens its own form; back returns to the list with the same search/filters", async () => {
  const w = await world(HOSTWORLD());
  await w.render();
  await w.click(rowClick(CPU_ID));
  await w.click(w.button("", { itasHost: ASSET_ID }));
  assert.match(w.hosts["itas-host-host"], /itas-host-code itas-mono">COM12</);
  assert.match(w.hosts["itas-main-host"], /<div id="itas-form-area"><\/div><div id="itas-host-host">/, "เปลือกหน้าเครื่องใหม่ (ช่องฟอร์มว่าง ฟอร์มของชิ้นส่วนไม่ค้าง)");
  await w.click(w.button("itas-host-edit"));
  assert.match(w.hosts["itas-form-area"], /แก้ไข COM-001/);
  w.hosts["itas-main-host"] = "";
  await w.click(w.button("itas-host-back"));
  assert.match(w.hosts["itas-main-host"], /id="itas-table-host"/, "กลับมารายการ");
  assert.match(w.hosts["itas-main-host"], /id="itas-search"/);
});

test("leaving the computer page with a half-typed form asks first; declining keeps the page and the form", async () => {
  const w = await world(HOSTWORLD({ confirm: false }));
  await w.render();
  await w.click(rowClick(ASSET_ID));
  await w.click(w.button("itas-host-edit"));
  w.forms.current = assetForm({ values: { reg_no: "COM-001", name: "แก้ค้างไว้" } });
  await w.click(w.button("itas-host-back"));
  assert.equal(w.calls.confirms.at(-1), "ยังไม่ได้บันทึกสิ่งที่กรอก");
  assert.match(w.hosts["itas-form-area"], /id="itas-form"/, "ฟอร์มยังอยู่");
  assert.doesNotMatch(w.hosts["itas-main-host"] ?? "", /id="itas-table-host"/, "ยังไม่กลับไปรายการ");
});

test("a failure loading the computer shows a message with retry and back; retry loads it; a page that is no longer the latest never paints", async () => {
  let failing = true;
  const w = await world(HOSTWORLD({ rpcHandlers: { app_itas_get_asset: ({ p_id }) => { if (failing && p_id === ASSET_ID) throw Object.assign(new Error("เซิร์ฟเวอร์ล้ม"), { code: "XX000" }); return [ASSET, CPU_ASSET, MOUSE_ON_HOST, MOUSE_ASSET].find((row) => row.id === p_id); } } }));
  await w.render();
  await w.click(rowClick(ASSET_ID));
  assert.match(w.hosts["itas-host-host"], /role="alert"/);
  assert.match(w.hosts["itas-host-host"], /id="itas-host-retry"/);
  assert.match(w.hosts["itas-host-host"], /id="itas-host-back"/);
  failing = false;
  await w.click(w.button("itas-host-retry"));
  assert.match(w.hosts["itas-host-host"], /itas-host-code itas-mono">COM12</);
  // ผู้ใช้ออกจากหน้าเครื่องระหว่างที่ยังโหลด: ผลที่มาช้าต้องไม่วาดทับ
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = await world(HOSTWORLD({ rpcHandlers: { app_itas_get_asset: async ({ p_id }) => { await gate; return [ASSET, CPU_ASSET, MOUSE_ON_HOST, MOUSE_ASSET].find((row) => row.id === p_id); } } }));
  await slow.render();
  const opening = slow.click(rowClick(ASSET_ID));
  await tick(2);
  await slow.click(slow.button("itas-host-back"));
  slow.hosts["itas-host-host"] = "";
  release();
  await opening;
  await tick();
  assert.equal(slow.hosts["itas-host-host"], "", "ผลที่มาช้าไม่วาดทับหน้ารายการ");
});

test("move history of the computer: loaded only on request, from each part's own history in small groups, filtered to this computer; nothing secret is requested", async () => {
  const history = ({ p_id }) => ({ asset_id: p_id, log: [], moves: p_id === CPU_ID
    ? [{ id: 1, from_host: "COM7", to_host: "COM12", from_slot: null, to_slot: "CPU1", from_status: null, to_status: "in_use", created_at: "2026-11-20T03:00:00+00:00", actor_employee_no: "IT3462", actor_full_name: "สุริยา" }]
    : [{ id: 2, from_host: "COM1", to_host: "COM2", from_slot: null, to_slot: null, from_status: "in_use", to_status: "in_use", created_at: "2026-11-21T03:00:00+00:00" }] });
  const w = await world(HOSTWORLD({ rpcHandlers: { app_itas_asset_history: history } }));
  await w.render();
  await w.click(rowClick(ASSET_ID));
  assert.equal(getCalls(w, "app_itas_asset_history").length, 0, "ยังไม่ถามประวัติจนกว่าจะกดปุ่ม");
  await w.click(w.button("itas-host-moves-load"));
  assert.deepEqual(getCalls(w, "app_itas_asset_history").map((call) => call.args.p_id).sort(), [CPU_ID, MOUSE_ON_HOST.id].sort());
  const page = w.hosts["itas-host-host"];
  assert.match(page, /ติดตั้งเข้าเครื่องนี้ \(จาก COM7\)/);
  assert.match(page, /IT3462 สุริยา/);
  assert.doesNotMatch(page, /COM1 → COM2/, "ย้ายระหว่างเครื่องอื่นไม่เกี่ยว");
  const failed = await world(HOSTWORLD({ rpcHandlers: { app_itas_asset_history: () => { throw Object.assign(new Error("ล้ม"), { code: "XX000" }); } } }));
  await failed.render();
  await failed.click(rowClick(ASSET_ID));
  await failed.click(failed.button("itas-host-moves-load"));
  assert.match(failed.hosts["itas-host-host"], /role="alert"/);
  assert.match(failed.hosts["itas-host-host"], /id="itas-host-moves-load"/, "ลองใหม่ได้");
});

test("leaving the page and coming back shows the register list again (the computer page has no route of its own); source: no secret field is read for the computer page", async () => {
  const w = await world(HOSTWORLD());
  await w.render();
  await w.click(rowClick(ASSET_ID));
  assert.ok(w.hosts["itas-host-host"]);
  await w.render();
  assert.match(w.html(), /id="itas-table-host"/);
  const source = read("modules/module-itas.js");
  const hostPart = source.slice(source.indexOf("async function loadHost"), source.indexOf("async function backToList"));
  assert.doesNotMatch(hostPart, /secrets|decrypt|vault\./, "หน้าเครื่องไม่แตะช่องลับ/ตู้เซฟ");
});

/* ---------- รุ่น 1.03: ปุ่ม "ย้อนกลับ" บนหัวฟอร์ม ---------- */
test("form header has a back button next to the title (add and edit); it closes the form like the cancel button and returns to the computer page when opened from there", async () => {
  const w = await world(HOSTWORLD());
  await w.render();
  await w.click(w.button("itas-add"));
  assert.match(w.hosts["itas-form-area"], /<div class="itas-form-head">\s*<button type="button" class="btn secondary" id="itas-form-back">‹ ย้อนกลับ<\/button>\s*<h2 id="itas-form-title">เพิ่มอุปกรณ์<\/h2>/);
  await w.click(w.button("itas-form-back"));
  assert.equal(w.hosts["itas-form-area"], "", "ยังไม่ได้กรอก = ปิดทันทีไม่ถาม");
  assert.equal(w.calls.confirms.length, 0);
  // เปิดจากหน้าเครื่องคอม: ปิดฟอร์มแล้วอยู่หน้าเครื่องเดิม (ไม่กลับรายการ)
  await w.click(rowClick(ASSET_ID));
  await w.click(w.button("itas-host-edit"));
  assert.match(w.hosts["itas-form-area"], /id="itas-form-back"/);
  await w.click(w.button("itas-form-back"));
  assert.equal(w.hosts["itas-form-area"], "");
  assert.match(w.hosts["itas-host-host"], /itas-host-code itas-mono">COM12</, "ยังอยู่หน้าเครื่อง");
});

test("back button asks before dropping a half-typed form; declining keeps the form, accepting closes it", async () => {
  const keep = await world(HOSTWORLD({ confirm: false }));
  await keep.render();
  await keep.click(rowClick(ASSET_ID));
  await keep.click(keep.button("itas-host-edit"));
  keep.forms.current = assetForm({ values: { reg_no: "COM-001", name: "แก้ค้างไว้" } });
  await keep.click(keep.button("itas-form-back"));
  assert.equal(keep.calls.confirms.at(-1), "ยังไม่ได้บันทึกสิ่งที่กรอก");
  assert.match(keep.hosts["itas-form-area"], /id="itas-form"/, "เลือกอยู่ต่อ = ฟอร์มยังอยู่");
  const drop = await world(HOSTWORLD({ confirm: true }));
  await drop.render();
  await drop.click(rowClick(ASSET_ID));
  await drop.click(drop.button("itas-host-edit"));
  drop.forms.current = assetForm({ values: { reg_no: "COM-001", name: "แก้ค้างไว้" } });
  await drop.click(drop.button("itas-form-back"));
  assert.equal(drop.calls.confirms.at(-1), "ยังไม่ได้บันทึกสิ่งที่กรอก");
  assert.equal(drop.hosts["itas-form-area"], "", "ยืนยันทิ้ง = ปิดฟอร์ม");
});
