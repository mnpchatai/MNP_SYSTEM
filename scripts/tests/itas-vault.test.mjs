import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// ตู้เซฟเข้ารหัสช่องลับของทะเบียนอุปกรณ์ IT (modules/itas-vault.js): ทดสอบด้วย Web Crypto จริงของ Node กับ "ฐานข้อมูลจำลอง" ที่ตรวจเหมือน RPC จริง
// (ตรวจ auth_hash ด้วย sha256 · rev · รูปแบบ base64/ความยาว) · ใช้ 600,000 รอบ (ต่ำสุดที่ยอมรับ) ให้เทสต์เร็ว · ห้ามมีความลับจริงในไฟล์นี้
const require = createRequire(import.meta.url);
const vaultApi = require("../../modules/itas-vault.js");
const { createVault, VaultError, MIN_ITERATIONS, parseVaultState, validEnvelope, authMaterialFromRaw, toBase64, fromBase64, formatRecoveryCode, normalizeRecoveryCode } = vaultApi;
const subtle = webcrypto.subtle;
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

const PASSWORD = "ม้าลายกินหญ้า สีเขียวมะลิ 2026"; // ทดสอบ: วลีหลายคำภาษาไทย (ใช้ NFKC) ไม่ใช่รหัสจริง
const OTHER_PASSWORD = "correct horse battery staple 99";
const ASSET = "2a500000-0000-4000-8000-000000000001";

// ฐานข้อมูลจำลอง: เหมือน app_itas_vault_get / init / rotate ที่สัญญาอธิบาย
function fakeServer({ isTest = false } = {}) {
  const db = { row: null, calls: [], log: [] };
  const sha = (b64) => createHash("sha256").update(Buffer.from(b64, "base64")).digest("base64");
  const checkWrapped = (value) => {
    assert.ok(fromBase64(value.n, { length: 12 }), "nonce 12 ไบต์ base64 มี padding");
    assert.ok(fromBase64(value.c, { length: 48 }), "wrapped 48 ไบต์ base64 มี padding");
  };
  return {
    db,
    async get() {
      db.calls.push("get");
      if (!db.row) return { initialized: false, is_test: isTest };
      const { auth_hash: _hidden, ...visible } = db.row; // ฐานข้อมูลไม่คืน auth_hash
      return { initialized: true, is_test: isTest, ...structuredClone(visible) };
    },
    async init(params) {
      db.calls.push("init");
      if (db.row) throw Object.assign(new Error("ตั้งตู้เซฟไปแล้ว ตั้งซ้ำไม่ได้"), { code: "23514" });
      assert.equal(params.p_kdf, "PBKDF2-SHA256");
      assert.ok(params.p_kdf_iterations >= 600000 && params.p_recovery_kdf_iterations >= 600000);
      assert.ok(fromBase64(params.p_salt, { length: 16 }) && fromBase64(params.p_recovery_salt, { length: 16 }));
      assert.ok(fromBase64(params.p_auth_hash, { length: 32 }));
      checkWrapped(params.p_wrapped_key_pass);
      checkWrapped(params.p_wrapped_key_recovery);
      db.row = {
        key_version: 1, rev: 1, kdf: params.p_kdf, kdf_iterations: params.p_kdf_iterations, salt: params.p_salt, wrapped_key_pass: params.p_wrapped_key_pass,
        recovery_kdf_iterations: params.p_recovery_kdf_iterations, recovery_salt: params.p_recovery_salt, wrapped_key_recovery: params.p_wrapped_key_recovery,
        auth_hash: params.p_auth_hash, updated_at: "2026-11-24T00:00:00.000000+00:00",
      };
      return { rev: 1, key_version: 1 };
    },
    async rotate(params) {
      db.calls.push(`rotate:${params.p_action}`);
      assert.ok(db.row);
      if (params.p_expected_rev !== db.row.rev) throw Object.assign(new Error("ตู้เซฟถูกเปลี่ยนจากที่อื่นแล้ว"), { code: "40001" });
      const token = fromBase64(params.p_auth_token ?? "", { length: 32 });
      if (!token || sha(params.p_auth_token) !== db.row.auth_hash) {
        db.log.push("rotate_failed");
        return { ok: false, code: "AUTH_TOKEN_INVALID", message: "x" };
      }
      if (params.p_action === "change_password") {
        assert.equal(params.p_wrapped_key_recovery, null, "ห้ามส่งชุด recovery ตอนเปลี่ยนรหัส");
        assert.notEqual(params.p_salt, db.row.salt);
        checkWrapped(params.p_wrapped_key_pass);
        Object.assign(db.row, { kdf_iterations: params.p_kdf_iterations, salt: params.p_salt, wrapped_key_pass: params.p_wrapped_key_pass });
      } else {
        assert.equal(params.p_wrapped_key_pass, null, "ห้ามส่งชุดรหัสตู้เซฟตอนออกรหัสกู้คืนใหม่");
        checkWrapped(params.p_wrapped_key_recovery);
        Object.assign(db.row, { recovery_kdf_iterations: params.p_recovery_kdf_iterations, recovery_salt: params.p_recovery_salt, wrapped_key_recovery: params.p_wrapped_key_recovery });
      }
      db.row.rev += 1;
      db.log.push(params.p_action);
      return { ok: true, rev: db.row.rev, key_version: 1 };
    },
  };
}
// ตัวจับเวลาของเทสต์ไม่ให้ค้าง process (ในเบราว์เซอร์ใช้ setTimeout ปกติ)
const quietTimer = (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; };
const makeVault = (server, extra = {}) => createVault({ subtle, setTimer: quietTimer, getRandomValues: (bytes) => webcrypto.getRandomValues(bytes), server, iterations: MIN_ITERATIONS, ...extra });
async function setUp(server = fakeServer(), extra = {}) {
  const vault = makeVault(server, extra);
  await vault.load();
  const { recoveryCode } = await vault.prepareSetup(PASSWORD);
  await vault.commitSetup(recoveryCode);
  return { vault, server, recoveryCode };
}
const reason = (promise) => promise.then(() => null, (error) => error.reason ?? error);

/* ---------- test vector ตามสัญญา ---------- */
test("HKDF/SHA-256 matches the contract's test vector (DEK = 0x42 x 32)", async () => {
  const { token, authHash } = await authMaterialFromRaw(subtle, new Uint8Array(32).fill(0x42));
  assert.equal(Buffer.from(token, "base64").toString("hex"), "30e36db01bf7486b79aed1574c8303f91c4f1ac4cfed16aeb36e611ca15b651c");
  assert.equal(token, "MONtsBv3SGt5rtFXTIMD+RxPGsTP7Raus25hHKFbZRw=");
  assert.equal(Buffer.from(authHash, "base64").toString("hex"), "f12f4d9cbf37097fa525f1f5192857e8c844d0b4284b0d4a39e2a6d14731fe9b");
  assert.equal(authHash, "8S9NnL83CX+lJfH1GShX6MhE0LQoSw1KOeKm0Ucx/ps=");
});

test("base64 helpers are standard with padding and reject anything else", () => {
  assert.equal(toBase64(new Uint8Array([1, 2])), "AQI=");
  assert.deepEqual([...fromBase64("AQI=")], [1, 2]);
  for (const bad of ["AQI", "AQI=\n", "AQ I=", "AQ-_", "AQJ=", "=AQI", 42, null, undefined]) assert.equal(fromBase64(bad), null, String(bad));
  assert.equal(fromBase64("AQI=", { length: 3 }), null);
});

test("recovery code helpers: grouped display, tolerant input, no ambiguous characters", () => {
  const code = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  assert.equal(formatRecoveryCode(code), "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ");
  assert.equal(normalizeRecoveryCode("0123-4567 89ab-cdef ghjk mnpq-rstv-wxyz"), code);
  assert.equal(normalizeRecoveryCode("oiL1"), "0111");
  assert.ok(!vaultApi.RECOVERY_ALPHABET.match(/[ILOU]/));
  assert.equal(vaultApi.RECOVERY_ALPHABET.length, 32);
});

/* ---------- ตั้งครั้งแรก ---------- */
test("first setup: shows the recovery code once, init only after it is typed back, then verifies itself and ends unlocked", async () => {
  const server = fakeServer();
  const vault = makeVault(server);
  assert.equal(vault.status(), "unknown");
  await vault.load();
  assert.equal(vault.status(), "uninitialized");
  const { recoveryCode } = await vault.prepareSetup(PASSWORD);
  assert.match(recoveryCode, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/, "8 กลุ่มกลุ่มละ 4 = 160 บิต");
  assert.ok(!server.db.calls.includes("init"), "ยังไม่ส่งขึ้นเซิร์ฟเวอร์ก่อนผู้ใช้ยืนยันว่าจดรหัสกู้คืนแล้ว");
  assert.equal(vault.hasPending, true);
  assert.equal(await reason(vault.commitSetup("AAAA-AAAA")), "CONFIRM_MISMATCH");
  assert.ok(!server.db.calls.includes("init"));
  await vault.commitSetup(recoveryCode.toLowerCase()); // ตัวพิมพ์เล็กก็ได้
  assert.equal(vault.status(), "unlocked");
  assert.equal(vault.hasPending, false);
  assert.equal(server.db.row.rev, 1);
  assert.equal(server.db.row.kdf_iterations, MIN_ITERATIONS);
  // หลัง init: ปลดล็อกได้ด้วยรหัสตู้เซฟและรหัสกู้คืนจริง
  vault.lock();
  await vault.unlock("pass", PASSWORD);
  assert.equal(vault.status(), "unlocked");
  vault.lock();
  await vault.unlock("recovery", recoveryCode);
  assert.equal(vault.status(), "unlocked");
});

test("setup rejects short passwords (<14 characters) before touching the server", async () => {
  const server = fakeServer();
  const vault = makeVault(server);
  await vault.load();
  assert.equal(await reason(vault.prepareSetup("สั้นไป 123")), "WEAK_PASSWORD");
  assert.equal(await reason(vault.prepareSetup("abcdefghijklm")), "WEAK_PASSWORD", "13 ตัว");
  assert.equal(server.db.calls.filter((call) => call === "init").length, 0);
  await vault.prepareSetup("abcdefghijklmn"); // 14 ตัวผ่าน
});

test("setting up twice is refused and does not overwrite the first vault", async () => {
  const { server } = await setUp();
  const second = makeVault(server);
  await second.load();
  assert.equal(await reason(second.prepareSetup(OTHER_PASSWORD)), "ALREADY_INITIALIZED");
  assert.equal(server.db.row.rev, 1);
});

test("a failed init keeps the pending setup so the user can retry; cancel drops it", async () => {
  const server = fakeServer();
  const realInit = server.init;
  let fail = true;
  server.init = async (params) => { if (fail) { fail = false; throw Object.assign(new Error("Failed to fetch"), { code: "" }); } return realInit(params); };
  const vault = makeVault(server);
  await vault.load();
  const { recoveryCode } = await vault.prepareSetup(PASSWORD);
  await assert.rejects(() => vault.commitSetup(recoveryCode), /Failed to fetch/);
  assert.equal(vault.hasPending, true);
  await vault.commitSetup(recoveryCode);
  assert.equal(vault.status(), "unlocked");
  const fresh = makeVault(fakeServer());
  await fresh.load();
  await fresh.prepareSetup(PASSWORD);
  fresh.cancelPending();
  assert.equal(fresh.hasPending, false);
  assert.equal(await reason(fresh.commitSetup("x")), "NOTHING_PENDING");
});

/* ---------- ปลดล็อก / ล็อก ---------- */
test("wrong password and wrong recovery code give a plain failure and stay locked", async () => {
  const { vault } = await setUp();
  vault.lock();
  assert.equal(await reason(vault.unlock("pass", `${PASSWORD}x`)), "WRONG_SECRET");
  assert.equal(await reason(vault.unlock("pass", "")), "WRONG_SECRET");
  assert.equal(await reason(vault.unlock("recovery", "0000-0000-0000-0000-0000-0000-0000-0000")), "WRONG_SECRET");
  assert.equal(vault.status(), "locked");
  const error = await vault.unlock("pass", "ผิดแน่นอน ผิดแน่นอน ผิดแน่นอน").catch((e) => e);
  assert.equal(error.message, "รหัสไม่ถูกต้อง", "ข้อความธรรมดา ไม่บอกรายละเอียด และไม่มีรหัสที่พิมพ์ปนอยู่");
  assert.ok(!error.message.includes("ผิดแน่นอน") && !String(error.stack).includes("ผิดแน่นอน"));
});

test("locking drops the keys: encrypt/decrypt fail afterwards and the lock listeners are told", async () => {
  const { vault } = await setUp();
  const events = [];
  vault.subscribe((event) => events.push(`${event.status}:${event.reason}`));
  const envelope = await vault.encryptField(ASSET, "license_os", "ABCDE-12345");
  vault.lock("manual");
  assert.equal(vault.status(), "locked");
  assert.deepEqual(events, ["locked:manual"]);
  assert.equal(await reason(vault.decryptField(ASSET, "license_os", envelope)), "LOCKED");
  assert.equal(await reason(vault.encryptField(ASSET, "license_os", "x")), "LOCKED");
  vault.lock("manual"); // ล็อกซ้ำไม่ส่งเหตุการณ์ซ้ำ
  assert.equal(events.length, 1);
});

test("auto-lock after the idle time; touch() restarts the clock", async () => {
  const timers = [];
  const { vault } = await setUp(fakeServer(), { idleMs: 600000, setTimer: (fn, ms) => { timers.push({ fn, ms, active: true }); return timers.length - 1; }, clearTimer: (id) => { timers[id].active = false; } });
  assert.equal(timers.at(-1).ms, 600000, "10 นาที");
  const first = timers.length - 1;
  vault.touch();
  assert.equal(timers[first].active, false, "นับใหม่");
  assert.equal(timers.at(-1).active, true);
  timers.at(-1).fn();
  assert.equal(vault.status(), "locked");
  assert.equal(timers.filter((timer) => timer.active).length, 0);
  assert.equal(vault.status(), "locked");
  assert.equal(vaultApi.IDLE_MS, 600000);
});

test("changing user / sandbox / persona context locks the vault on next use", async () => {
  let context = "user-1|real";
  const { vault } = await setUp(fakeServer(), { getContext: () => context });
  const envelope = await vault.encryptField(ASSET, "ip", "10.1.2.3");
  assert.equal(await vault.decryptField(ASSET, "ip", envelope), "10.1.2.3");
  context = "user-1|test|persona-9";
  assert.equal(await reason(vault.decryptField(ASSET, "ip", envelope)), "LOCKED");
  assert.equal(vault.status(), "locked");
});

/* ---------- เข้ารหัสช่องลับ ---------- */
test("field encryption round-trips Thai text and produces contract-shaped envelopes with a fresh nonce every time", async () => {
  const { vault } = await setUp();
  const first = await vault.encryptField(ASSET, "license_os", "รหัสทดสอบ ไม่ใช่ของจริง XXXXX-YYYYY");
  const second = await vault.encryptField(ASSET, "license_os", "รหัสทดสอบ ไม่ใช่ของจริง XXXXX-YYYYY");
  assert.deepEqual(Object.keys(first).sort(), ["c", "n", "v"]);
  assert.equal(first.v, 1);
  assert.ok(validEnvelope(first));
  assert.notEqual(first.n, second.n, "nonce สุ่มใหม่ทุกครั้งแม้ค่าเดิม");
  assert.notEqual(first.c, second.c);
  assert.equal(await vault.decryptField(ASSET, "license_os", first), "รหัสทดสอบ ไม่ใช่ของจริง XXXXX-YYYYY");
  assert.equal(await vault.encryptField(ASSET, "license_os", "   "), null, "ค่าว่าง = null (ลบค่า)");
  assert.equal(await vault.encryptField(ASSET, "license_os", null), null);
  // ตัดช่องว่างหัวท้าย + NFC
  assert.equal(await vault.decryptField(ASSET, "ip", await vault.encryptField(ASSET, "ip", "  é  ")), "é");
});

test("AAD binds the ciphertext to asset id + field key: moving it elsewhere fails to decrypt", async () => {
  const { vault } = await setUp();
  const envelope = await vault.encryptField(ASSET, "license_os", "secret-test");
  assert.equal(await reason(vault.decryptField(ASSET, "license_office", envelope)), "DECRYPT_FAILED", "คนละช่อง");
  assert.equal(await reason(vault.decryptField("2a500000-0000-4000-8000-000000000002", "license_os", envelope)), "DECRYPT_FAILED", "คนละแถว");
  assert.equal(await vault.decryptField(ASSET.toUpperCase(), "license_os", envelope), "secret-test", "uuid ตัวพิมพ์ใหญ่ถูกแปลงเป็นตัวเล็กตามสัญญา");
  const tampered = { ...envelope, c: toBase64(Uint8Array.from(fromBase64(envelope.c), (byte, index) => (index === 0 ? byte ^ 1 : byte))) };
  assert.equal(await reason(vault.decryptField(ASSET, "license_os", tampered)), "DECRYPT_FAILED");
  for (const bad of [null, {}, { v: 2, n: envelope.n, c: envelope.c }, { v: 1, n: "AAAA", c: envelope.c }, { ...envelope, extra: 1 }, { v: 1, n: envelope.n, c: "AAAA" }]) {
    assert.equal(await reason(vault.decryptField(ASSET, "license_os", bad)), "DECRYPT_FAILED");
  }
});

test("a value over the 4,080-byte limit is refused without putting the value in the error", async () => {
  const { vault } = await setUp();
  const error = await vault.encryptField(ASSET, "ip", "ฬ".repeat(1400)).catch((e) => e); // 1400 × 3 ไบต์ = 4200
  assert.equal(error.reason, "VALUE_TOO_LONG");
  assert.ok(!error.message.includes("ฬ"));
  assert.ok(await vault.encryptField(ASSET, "ip", "a".repeat(4080)));
});

test("CryptoKeys are non-extractable and the vault object exposes no key material", async () => {
  const exported = [];
  const spy = new Proxy(subtle, {
    get(target, name) {
      if (name === "exportKey") return (...args) => { exported.push(args); return target.exportKey(...args); };
      const value = target[name];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const { vault } = await setUp(fakeServer(), { subtle: spy });
  assert.equal(exported.length, 0);
  assert.deepEqual(Reflect.ownKeys(vault).sort(), ["cancelPending", "changePassword", "commitNewRecovery", "commitSetup", "decryptField", "encryptField", "ensureContext", "hasPending", "initialized", "isTest", "iterations", "load", "lock", "pendingType", "prepareNewRecovery", "prepareSetup", "snapshot", "status", "subscribe", "touch", "unlock"], "ไม่มีช่องให้อ่านกุญแจ");
  assert.ok(Object.isFrozen(vault));
  // ทุกครั้งที่ import/derive/unwrap ต้องส่ง extractable = false (ตรวจจากซอร์ส)
  const source = read("modules/itas-vault.js").replace(/\/\/.*$/gm, ""); // ตัดคอมเมนต์ก่อนตรวจโค้ดจริง
  assert.doesNotMatch(source, /extractable"?:\s*true/);
  assert.doesNotMatch(source, /,\s*true,\s*\[/, "ไม่มี importKey/deriveKey/unwrapKey ที่ extractable = true");
  assert.doesNotMatch(source, /exportKey/);
  assert.doesNotMatch(source, /Math\.random/);
});

/* ---------- เปลี่ยนรหัส / รหัสกู้คืน ---------- */
test("change password: re-authenticates, sends the auth token, keeps the same DEK so old ciphertext still decrypts", async () => {
  const { vault, server, recoveryCode } = await setUp();
  const envelope = await vault.encryptField(ASSET, "license_os", "keep-me");
  const oldWrapped = structuredClone(server.db.row.wrapped_key_pass);
  assert.equal(await reason(vault.changePassword({ kind: "pass", secret: "ไม่ใช่รหัสเดิม ไม่ใช่รหัสเดิม", newPassword: OTHER_PASSWORD })), "WRONG_SECRET");
  assert.equal(await reason(vault.changePassword({ kind: "pass", secret: PASSWORD, newPassword: "short" })), "WEAK_PASSWORD");
  assert.equal(server.db.row.rev, 1, "ล้มแล้วไม่เปลี่ยนอะไร");
  await vault.changePassword({ kind: "pass", secret: PASSWORD, newPassword: OTHER_PASSWORD });
  assert.equal(server.db.row.rev, 2);
  assert.notDeepEqual(server.db.row.wrapped_key_pass, oldWrapped);
  vault.lock();
  assert.equal(await reason(vault.unlock("pass", PASSWORD)), "WRONG_SECRET", "รหัสเก่าใช้ไม่ได้");
  await vault.unlock("pass", OTHER_PASSWORD);
  assert.equal(await vault.decryptField(ASSET, "license_os", envelope), "keep-me");
  vault.lock();
  await vault.unlock("recovery", recoveryCode); // รหัสกู้คืนเดิมยังใช้ได้
});

test("forgot the password: the recovery code opens the vault and sets a new password", async () => {
  const { vault, server, recoveryCode } = await setUp();
  const envelope = await vault.encryptField(ASSET, "license_os", "after-recovery");
  vault.lock();
  await vault.changePassword({ kind: "recovery", secret: recoveryCode, newPassword: OTHER_PASSWORD });
  assert.equal(server.db.log.at(-1), "change_password");
  await vault.unlock("pass", OTHER_PASSWORD);
  assert.equal(await vault.decryptField(ASSET, "license_os", envelope), "after-recovery");
});

test("new recovery code: two steps (typed back to confirm), old code stops working, password still works", async () => {
  const { vault, server, recoveryCode } = await setUp();
  const { recoveryCode: next } = await vault.prepareNewRecovery({ kind: "pass", secret: PASSWORD });
  assert.notEqual(next, formatRecoveryCode(normalizeRecoveryCode(recoveryCode)));
  assert.ok(!server.db.log.includes("new_recovery"), "ยังไม่ส่งก่อนยืนยัน");
  assert.equal(await reason(vault.commitNewRecovery("AAAA-AAAA")), "CONFIRM_MISMATCH");
  assert.equal(vault.hasPending, true);
  await vault.commitNewRecovery(next);
  assert.equal(server.db.log.at(-1), "new_recovery");
  vault.lock();
  assert.equal(await reason(vault.unlock("recovery", recoveryCode)), "WRONG_SECRET");
  await vault.unlock("recovery", next);
  vault.lock();
  await vault.unlock("pass", PASSWORD);
  assert.equal(await reason(makeVault(server).prepareNewRecovery({ kind: "pass", secret: "ผิดผิดผิดผิดผิดผิดผิด" })), "WRONG_SECRET");
});

test("a wrong auth token from the server is reported (ok:false) and surfaces as a clear error, never as success", async () => {
  const { vault, server } = await setUp();
  const realRotate = server.rotate;
  server.rotate = async (params) => realRotate({ ...params, p_auth_token: toBase64(new Uint8Array(32)) });
  const error = await vault.changePassword({ kind: "pass", secret: PASSWORD, newPassword: OTHER_PASSWORD }).catch((e) => e);
  assert.equal(error.reason, "AUTH_TOKEN_INVALID");
  assert.match(error.message, /ยืนยันกุญแจของตู้เซฟไม่ผ่าน/);
  assert.equal(server.db.row.rev, 1);
  assert.deepEqual(server.db.log.filter((entry) => entry === "rotate_failed"), ["rotate_failed"]);
  // ok:false รูปแบบอื่น ๆ ก็ต้องไม่ถูกมองว่าสำเร็จ
  server.rotate = async () => ({});
  assert.equal(await reason(vault.changePassword({ kind: "pass", secret: PASSWORD, newPassword: OTHER_PASSWORD })), "GENERIC");
  server.rotate = async () => undefined;
  assert.equal(await reason(vault.changePassword({ kind: "pass", secret: PASSWORD, newPassword: OTHER_PASSWORD })), "GENERIC");
});

test("a rev conflict from another browser (40001) propagates as the RPC error and changes nothing", async () => {
  const { vault, server } = await setUp();
  const realGet = server.get;
  server.get = async () => ({ ...(await realGet()), rev: 5 }); // เซิร์ฟเวอร์จริงอยู่ที่ rev 1 แต่หน้าเว็บอ่านได้ 5 → เหมือนมีคนแก้กลางทาง
  const error = await vault.changePassword({ kind: "pass", secret: PASSWORD, newPassword: OTHER_PASSWORD }).catch((e) => e);
  assert.equal(error.code, "40001");
  assert.equal(server.db.row.rev, 1);
});

/* ---------- ตรวจข้อมูลตู้เซฟจากเซิร์ฟเวอร์ ---------- */
test("a vault that asks for fewer than 600,000 KDF rounds (or odd parameters) is refused without deriving anything", async () => {
  const { server } = await setUp();
  const good = await server.get();
  const bad = (patch) => ({ ...structuredClone(good), ...patch });
  const refused = [
    bad({ kdf_iterations: 599999 }), bad({ recovery_kdf_iterations: 1000 }), bad({ kdf_iterations: 10000001 }), bad({ kdf_iterations: "1000000" }),
    bad({ kdf: "PBKDF2-SHA1" }), bad({ kdf: "scrypt" }), bad({ salt: toBase64(new Uint8Array(8)) }), bad({ recovery_salt: "not base64" }),
    bad({ wrapped_key_pass: { n: good.wrapped_key_pass.n, c: toBase64(new Uint8Array(47)) } }), bad({ wrapped_key_recovery: { n: toBase64(new Uint8Array(8)), c: good.wrapped_key_recovery.c } }),
    bad({ wrapped_key_pass: null }), bad({ key_version: 0 }), bad({ rev: 0 }), null, { initialized: "yes" },
  ];
  for (const data of refused) assert.throws(() => parseVaultState(data), (error) => error.reason === "CORRUPT", JSON.stringify(data)?.slice(0, 60));
  assert.ok(parseVaultState(good).initialized);
  // ผ่าน unlock จริง: เซิร์ฟเวอร์ตอบรอบต่ำ → ไม่ derive (ไม่เรียก deriveKey เลย)
  let derived = 0;
  const spy = new Proxy(subtle, { get(target, name) { if (name === "deriveKey") return (...args) => { derived += 1; return target.deriveKey(...args); }; const value = target[name]; return typeof value === "function" ? value.bind(target) : value; } });
  const victim = makeVault({ ...server, get: async () => bad({ kdf_iterations: 1000 }) }, { subtle: spy });
  assert.equal(await reason(victim.unlock("pass", PASSWORD)), "CORRUPT");
  assert.equal(derived, 0);
  assert.equal(victim.status(), "unknown");
});

test("the vault refuses to be created with fewer than 600,000 rounds", () => {
  assert.throws(() => createVault({ subtle, server: fakeServer(), iterations: 100000 }), (error) => error.reason === "CORRUPT");
});

test("test mode and real mode wrap with different AAD: a wrapped key from one mode does not open in the other", async () => {
  const { server: realServer } = await setUp(fakeServer({ isTest: false }));
  const testServer = fakeServer({ isTest: true });
  testServer.get = async () => ({ ...(await fakeServer({ isTest: false }).get()), initialized: true, is_test: true, ...structuredClone((({ auth_hash, ...rest }) => rest)(realServer.db.row)) });
  const vault = makeVault(testServer);
  assert.equal(await reason(vault.unlock("pass", PASSWORD)), "WRONG_SECRET");
});

test("every error the vault raises has a fixed message (no secret can leak into client_error_logs)", async () => {
  const messages = Object.values(vaultApi.MESSAGES);
  assert.ok(messages.every((message) => /[ก-๙]/.test(message)));
  const source = read("modules/itas-vault.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /new Error\(/);
  assert.doesNotMatch(source, /(localStorage|sessionStorage|indexedDB)/);
  assert.doesNotMatch(source, /window\.[A-Za-z_]+\s*=\s*(?!Object\.freeze\(api\))/);
  assert.ok(new VaultError("NOPE").message.length > 0);
});

test("without crypto.subtle the vault says it is unsupported instead of throwing a raw error", async () => {
  const vault = createVault({ subtle: null, getRandomValues: () => {}, server: fakeServer(), iterations: MIN_ITERATIONS });
  assert.equal(await reason(vault.load()), "UNSUPPORTED");
});

/* ---------- ทางที่ 1 (unwrapKey) กับทางสำรอง (decrypt แล้ว import แล้ว fill(0)) ---------- */
const countingSubtle = (overrides = {}) => {
  const counts = { unwrapKey: 0, decrypt: 0 };
  const proxy = new Proxy(subtle, {
    get(target, name) {
      if (name in overrides) return overrides[name];
      if (name === "unwrapKey" || name === "decrypt") return (...args) => { counts[name] += 1; return target[name](...args); };
      const value = target[name];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { proxy, counts };
};
test("unlock uses unwrapKey (no raw key ever visible) when the browser supports HKDF unwrap", async () => {
  const { server } = await setUp();
  const { proxy, counts } = countingSubtle();
  const vault = makeVault(server, { subtle: proxy });
  await vault.unlock("pass", PASSWORD);
  assert.equal(counts.unwrapKey, 2, "AES และ HKDF จากห่อเดียวกัน");
  assert.equal(counts.decrypt, 0);
});

test("unlock falls back to decrypt + import (raw wiped right away) when unwrapKey is unsupported", async () => {
  const { server } = await setUp();
  const { proxy, counts } = countingSubtle({ unwrapKey: async () => { throw new Error("NotSupportedError"); } });
  const vault = makeVault(server, { subtle: proxy });
  const events = [];
  const realFill = Uint8Array.prototype.fill;
  Uint8Array.prototype.fill = function patched(...args) { if (this.length === 32) events.push("fill32"); return realFill.apply(this, args); };
  try {
    await vault.unlock("pass", PASSWORD);
  } finally {
    Uint8Array.prototype.fill = realFill;
  }
  assert.equal(counts.decrypt, 1);
  assert.ok(events.includes("fill32"), "raw ถูก fill(0) ทันที");
  const envelope = await vault.encryptField(ASSET, "ip", "10.0.0.1");
  assert.equal(await vault.decryptField(ASSET, "ip", envelope), "10.0.0.1");
  vault.lock();
  assert.equal(await reason(vault.unlock("pass", `${PASSWORD}!`)), "WRONG_SECRET", "ผิดรหัสยังถูกปฏิเสธบนทางสำรอง");
});
