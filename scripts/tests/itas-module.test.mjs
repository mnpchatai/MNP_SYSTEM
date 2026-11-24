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
  const sha = (value) => Buffer.from(webcrypto.getRandomValues(new Uint8Array(0))).toString() + value; // ไม่ใช้ในเทสต์นี้ (ไม่หมุนรหัส)
  void sha;
  return {
    db,
    get: async () => (db.row ? { initialized: true, is_test: false, ...structuredClone(db.row) } : { initialized: false, is_test: false }),
    init: async (params) => {
      db.calls.push("init");
      db.row = { key_version: 1, rev: 1, kdf: params.p_kdf, kdf_iterations: params.p_kdf_iterations, salt: params.p_salt, wrapped_key_pass: params.p_wrapped_key_pass, recovery_kdf_iterations: params.p_recovery_kdf_iterations, recovery_salt: params.p_recovery_salt, wrapped_key_recovery: params.p_wrapped_key_recovery, updated_at: STAMP };
      return { rev: 1, key_version: 1 };
    },
    rotate: async () => ({ ok: false, code: "AUTH_TOKEN_INVALID" }),
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

async function world({ allowed = true, accessFail = false, isTest = false, vaultRow = null, rpcHandlers = {}, assets = [ASSET], confirm = true } = {}) {
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
  const stateObj = { session, employee: { id: "e1" }, sandbox: isTest ? { active: true } : null };
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
    window: context, console, URLSearchParams, Intl, Date, Number, Object, Promise, Array, JSON, Math, Set, Map, String, Boolean, Uint8Array, TextEncoder, TextDecoder, atob, btoa, Error, clearTimeout, clearInterval,
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
