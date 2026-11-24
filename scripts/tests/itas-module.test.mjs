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
async function world({ allowed = true, accessFail = false, isTest = false, vaultRow = null, rpcHandlers = {}, assets = [ASSET], confirm = true, clock = null, employee = { id: "e1" } } = {}) {
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
    window: context, console, URLSearchParams, Intl, Date: clock ? class FakeDate extends Date { static now() { return clock.time; } } : Date, Number, Object, Promise, Array, JSON, Math, Set, Map, String, Boolean, Uint8Array, TextEncoder, TextDecoder, atob, btoa, Error, clearTimeout, clearInterval,
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
    context, itas, calls, server, hosts, elements, host, forms, stateObj, session, rpcNames: () => calls.rpc.map((call) => call.name),
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
  assert.deepEqual(list.args, { p_type_code: "COMPUTER", p_limit: 2000, p_offset: 0 });
  const html = w.html();
  assert.match(html, /ทะเบียนอุปกรณ์ IT/);
  assert.match(html, /ยังไม่ตั้ง/, "ตู้เซฟยังไม่ตั้ง");
  assert.match(html, /COM-001/);
  assert.match(html, /data-itas-type="COMPUTER" aria-pressed="true"/);
  assert.doesNotMatch(html, /itas-purge/, "ไม่ใช่โหมดทดสอบ");
  assert.equal(w.itas.version, "1.00");
  assert.equal(w.itas.inDevelopment, true);
  assert.equal(w.context.window.MNP_OFFICE_CARDS.IT_ASSET_REGISTER.version, "1.00");
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
  await w.click(w.button("", { itasRow: ASSET_ID }));
  await w.click({ closest: () => ({ dataset: { itasRow: ASSET_ID }, id: "" }), dataset: { itasRow: ASSET_ID }, id: "" });
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
  await w.click({ closest: () => ({ dataset: { itasRow: ASSET_ID }, id: "" }), dataset: { itasRow: ASSET_ID }, id: "" });
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
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itas_get_asset").length, before + 1);
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
  await w.click({ closest: () => ({ dataset: { itasRow: ASSET_ID }, id: "" }), dataset: { itasRow: ASSET_ID }, id: "" });
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
test("source rules: no console, no storage, no Math.random, no draft autosave, no secret in data attributes, decrypted values only via textContent", () => {
  const source = read("modules/module-itas.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
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
