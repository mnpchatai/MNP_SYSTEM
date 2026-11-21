import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { pushPanelState, urlBase64ToUint8Array, subscriptionRecord, sameApplicationServerKey, pushPromptKind } = require("../../modules/push-notifications.js");
const { isIos } = require("../../modules/install-app.js");

const ready = { keyConfigured: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true };
const PUBLIC_KEY = "BDTZCvimJouHlMRtOtUfsBAoScH75w60WnUw4Uy1HQprE1NQLqZDHUiIi3Hl1-WrlbF91QUGPsZSNp7CXzAqaCs";

test("the panel is hidden until a VAPID public key is configured", () => {
  assert.equal(pushPanelState({ ...ready, keyConfigured: false }), "hidden");
  assert.equal(pushPanelState(), "hidden");
});

test("iPhone in a Safari tab is told to install first, even though it has no Push API there", () => {
  assert.equal(pushPanelState({ ...ready, ios: true, standalone: false }), "ios-install");
  assert.equal(pushPanelState({ ...ready, hasPushManager: false, hasNotification: false, ios: true, standalone: false }), "ios-install");
  assert.equal(pushPanelState({ ...ready, hasPushManager: false, ios: true, standalone: true }), "ios-old");
  assert.equal(pushPanelState({ ...ready, ios: true, standalone: true }), "off");
});

test("browsers without the Push API are unsupported", () => {
  for (const missing of ["hasServiceWorker", "hasPushManager", "hasNotification"]) {
    assert.equal(pushPanelState({ ...ready, [missing]: false }), "unsupported", missing);
  }
});

test("permission and subscription decide between denied, on and off", () => {
  assert.equal(pushPanelState({ ...ready, permission: "denied", subscribed: true }), "denied");
  assert.equal(pushPanelState({ ...ready, permission: "default" }), "off");
  assert.equal(pushPanelState({ ...ready, permission: "granted", subscribed: false }), "off");
  assert.equal(pushPanelState({ ...ready, permission: "granted", subscribed: true }), "on");
  assert.equal(pushPanelState({ ...ready, permission: "default", subscribed: true }), "off");
});

test("the VAPID public key decodes to a 65-byte uncompressed P-256 point", () => {
  const bytes = urlBase64ToUint8Array(PUBLIC_KEY);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 0x04);
  assert.deepEqual([...urlBase64ToUint8Array("AQID")], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array("-_8")], [251, 255]);
});

test("only a complete subscription is sent to the database", () => {
  assert.deepEqual(subscriptionRecord({ endpoint: "https://x", keys: { p256dh: "a", auth: "b" }, expirationTime: null }), { endpoint: "https://x", p256dh: "a", auth: "b" });
  assert.equal(subscriptionRecord({ endpoint: "https://x", keys: { p256dh: "a" } }), null);
  assert.equal(subscriptionRecord({ keys: { p256dh: "a", auth: "b" } }), null);
  assert.equal(subscriptionRecord({ endpoint: "", keys: { p256dh: "a", auth: "b" } }), null);
  assert.equal(subscriptionRecord(null), null);
});

test("a subscription made with another VAPID key is detected", () => {
  const expected = urlBase64ToUint8Array(PUBLIC_KEY);
  assert.equal(sameApplicationServerKey(expected.buffer.slice(0), expected), true);
  const other = expected.slice();
  other[10] ^= 1;
  assert.equal(sameApplicationServerKey(other.buffer, expected), false);
  assert.equal(sameApplicationServerKey(new Uint8Array(3).buffer, expected), false);
  assert.equal(sameApplicationServerKey(null, expected), false);
});

test("install-app exposes the shared iOS detection", () => {
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }), false);
});

// ---------- แถบบังคับเปิดแจ้งเตือน (pushPromptKind) ----------
test("the prompt asks to enable until the device is allowed and registered", () => {
  assert.equal(pushPromptKind({ ...ready, permission: "default" }), "enable");
  assert.equal(pushPromptKind({ ...ready, permission: "default", subscribed: null }), "enable");
  assert.equal(pushPromptKind({ ...ready, permission: "granted", subscribed: false }), "enable");
  assert.equal(pushPromptKind({ ...ready, permission: "granted", subscribed: true }), null);
  // อนุญาตแล้วแต่ยังไม่รู้ว่าฐานข้อมูลรู้จักเครื่องนี้ไหม: รอตรวจ ไม่แสดงแถบวูบ
  assert.equal(pushPromptKind({ ...ready, permission: "granted" }), "pending");
  assert.equal(pushPromptKind({ ...ready, permission: "granted", subscribed: null }), "pending");
  assert.equal(pushPromptKind({ ...ready, permission: "default", ios: true, standalone: true }), "enable");
});

test("a blocked browser and an iPhone that is not installed get a message-only prompt", () => {
  assert.equal(pushPromptKind({ ...ready, permission: "denied" }), "denied");
  assert.equal(pushPromptKind({ ...ready, permission: "denied", subscribed: true }), "denied");
  assert.equal(pushPromptKind({ ...ready, permission: "default", ios: true, standalone: false }), "ios-install");
  assert.equal(pushPromptKind({ ...ready, hasPushManager: false, hasNotification: false, ios: true, standalone: false }), "ios-install");
});

test("no prompt when the device cannot be fixed by the user", () => {
  assert.equal(pushPromptKind({ ...ready, keyConfigured: false, permission: "default" }), null);
  assert.equal(pushPromptKind(), null);
  assert.equal(pushPromptKind({ ...ready, permission: "default", hasPushManager: false }), null);
  assert.equal(pushPromptKind({ ...ready, permission: "default", hasServiceWorker: false }), null);
  assert.equal(pushPromptKind({ ...ready, permission: "default", hasPushManager: false, ios: true, standalone: true }), null);
});

// ---------- ส่วนที่อยู่ใน app.js: ตัดฟังก์ชันออกมารันแยก ----------
const appSource = readFileSync(new URL("../../app.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function extractFunction(signature) {
  const start = appSource.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  return appSource.slice(start, appSource.indexOf("\n}\n", start) + 3);
}



test("clicking an unread notification updates only that row of the signed-in recipient", async () => {
  const calls = [];
  const builder = (result) => {
    const chain = {
      update: (values) => (calls.push(["update", values]), chain),
      eq: (column, value) => (calls.push(["eq", column, value]), chain),
      is: (column, value) => (calls.push(["is", column, value]), Promise.resolve(result)),
    };
    return chain;
  };
  const load = (context) => {
    vm.runInContext(extractFunction("async function markNotificationRead("), context);
    return vm.runInContext("markNotificationRead", context);
  };
  const ok = load(vm.createContext({ sb: { from: (table) => (calls.push(["from", table]), builder({ error: null })) }, state: { employee: { id: "emp-1" } }, console, Date }));
  assert.equal(await ok("n-1"), true);
  assert.deepEqual(calls.filter(([kind]) => kind !== "update"), [["from", "notifications"], ["eq", "id", "n-1"], ["eq", "recipient_id", "emp-1"], ["is", "read_at", null]]);
  assert.equal(typeof calls.find(([kind]) => kind === "update")[1].read_at, "string");
  // ล้ม (ฐานข้อมูลตอบ error หรือเน็ตหลุดจน throw) ต้องคืน false ไม่โยน error ขวางการนำทาง
  const failed = load(vm.createContext({ sb: { from: () => builder({ error: { message: "x" } }) }, state: { employee: { id: "emp-1" } }, console, Date }));
  assert.equal(await failed("n-1"), false);
  const offline = load(vm.createContext({ sb: { from: () => { throw new Error("offline"); } }, state: { employee: { id: "emp-1" } }, console: { warn() {} }, Date }));
  assert.equal(await offline("n-1"), false);
});

test("only unread notifications carry the id that the click handler uses", () => {
  const context = vm.createContext({
    notificationHref: (item) => (item.request_id ? "#/request?id=1" : null),
    uiIcon: () => "", requestTypeIcon: () => "", requestPalette: () => "", formatDate: () => "d",
    escapeHtml: (value) => String(value), NOTIFICATION_TYPE_BY_PREFIX: {},
  });
  vm.runInContext(extractFunction("function notificationItemHtml("), context);
  const html = (item) => vm.runInContext("notificationItemHtml", context)({ title: "t", body: "b", created_at: "x", ...item });
  assert.match(html({ id: "n1", read_at: null, request_id: "r1" }), /^<a class="notification-item unread" data-notification-id="n1" href=/);
  assert.match(html({ id: "n2", read_at: null }), /^<div class="notification-item unread" data-notification-id="n2" role="button" tabindex="0">/);
  assert.doesNotMatch(html({ id: "n3", read_at: "2026-11-21T00:00:00Z" }), /data-notification-id/);
});

// แถบในหน้าจริง: ใช้ MNP_PUSH ตัวจริง ส่วน app.js ตัดฟังก์ชันมารันแยก
function buildPrompt({ sandbox = false, labOnly = false, path = "dashboard", environment = {}, cache = { owner: null, value: null }, storage = null, now = Date.parse("2026-11-21T08:00:00Z") } = {}) {
  const checks = [];
  const store = storage ?? new Map();
  const context = vm.createContext({
    state: { employee: { id: "e" } }, isSandboxMode: () => sandbox, isLabOnly: () => labOnly, currentRoute: () => ({ path }),
    pushEnvironment: () => ({ ...ready, permission: "default", ios: false, standalone: false, ...environment }),
    pushSubscribedCache: cache, verifyPushPrompt: () => checks.push("check"), window: { MNP_PUSH: require("../../modules/push-notifications.js") },
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) },
    Date: { now: () => now }, String,
  });
  vm.runInContext(extractFunction("function pushNotice("), context);
  vm.runInContext(appSource.slice(appSource.indexOf("const PUSH_PROMPT_HIDDEN_KEY"), appSource.indexOf("function pushPromptHtml(")), context);
  vm.runInContext(extractFunction("function pushPromptHtml("), context);
  return {
    html: vm.runInContext("pushPromptHtml", context)(), checks, store,
    hide: () => vm.runInContext("hidePushPromptUntilTomorrow", context)(),
    render: (at) => { context.Date = { now: () => at }; return vm.runInContext("pushPromptHtml", context)(); },
  };
}

test("the prompt offers the enable button and a temporary hide-for-today button", () => {
  const { html } = buildPrompt();
  assert.match(html, /id="push-prompt"/);
  assert.match(html, /กรุณาเปิดแจ้งเตือนบนเครื่องนี้/);
  assert.match(html, /เพื่อรับแจ้งงานที่รอคุณ/);
  assert.equal(html.match(/<button/g).length, 2);
  assert.match(html, /data-push-prompt-enable/);
  assert.match(html, /data-push-prompt-today[^>]*>ปิดชั่วคราววันนี้</);
  // การซ่อนเป็นเรื่องของแถบเท่านั้น ไม่ผูกกับการพักแจ้งเตือนจริง (ไม่เรียก RPC)
  const hider = appSource.slice(appSource.indexOf("function hidePushPromptUntilTomorrow("), appSource.indexOf("function pushPromptHtml("));
  assert.doesNotMatch(hider, /sb\.rpc|app_push_pause/);
  assert.doesNotMatch(appSource, /data-push-prompt-later|ไว้ทีหลัง/);
});

test("the hide button is on every kind of prompt, so a device that cannot enable does not keep a permanent bar", () => {
  for (const environment of [{ permission: "denied" }, { permission: "denied", ios: true, standalone: true }, { ios: true, standalone: false }]) {
    const html = buildPrompt({ environment }).html;
    assert.match(html, /data-push-prompt-today/);
    assert.doesNotMatch(html, /data-push-prompt-enable/);
  }
});

test("hiding the prompt keeps it away until 07:00 Bangkok of the next day, then it returns by itself", () => {
  // 21/11/2026 15:00 เวลาไทย (08:00Z) → ซ่อนถึง 22/11/2026 07:00 เวลาไทย (00:00Z)
  const prompt = buildPrompt();
  prompt.hide();
  assert.equal(prompt.store.get("mnp-push-prompt-hidden-until:e"), String(Date.parse("2026-11-22T00:00:00Z")));
  assert.equal(prompt.render(Date.parse("2026-11-21T08:00:00Z")), "");
  assert.equal(prompt.render(Date.parse("2026-11-21T23:59:59Z")), "");
  assert.match(prompt.render(Date.parse("2026-11-22T00:00:00Z")), /id="push-prompt"/);
  assert.match(prompt.render(Date.parse("2026-11-22T03:00:00Z")), /id="push-prompt"/);
  // บัญชีอื่นบนเครื่องเดียวกันไม่ถูกซ่อนตาม: คีย์แยกตามบัญชี
  assert.match(buildPrompt({ storage: new Map([["mnp-push-prompt-hidden-until:other", String(Date.parse("2026-11-22T00:00:00Z"))]]) }).html, /id="push-prompt"/);
});

test("a hidden prompt does not start the registration check, and storage failures never throw", () => {
  const hidden = buildPrompt({ environment: { permission: "granted" }, storage: new Map([["mnp-push-prompt-hidden-until:e", String(Date.parse("2026-11-22T00:00:00Z"))]]) });
  assert.equal(hidden.html, "");
  assert.deepEqual(hidden.checks, []);
  // localStorage ใช้ไม่ได้: แถบแสดงตามปกติ ปุ่มซ่อนไม่ทำให้พัง
  const broken = vm.createContext({ state: { employee: { id: "e" } }, window: { MNP_PUSH: require("../../modules/push-notifications.js") }, Date, String, localStorage: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); } } });
  vm.runInContext(appSource.slice(appSource.indexOf("const PUSH_PROMPT_HIDDEN_KEY"), appSource.indexOf("function pushPromptHtml(")), broken);
  assert.equal(vm.runInContext("pushPromptHiddenNow()", broken), false);
  assert.doesNotThrow(() => vm.runInContext("hidePushPromptUntilTomorrow()", broken));
});

test("the hide button redraws the prompt after storing the time", () => {
  assert.match(appSource, /\[data-push-prompt-today\]"\)\) return;\n {2}hidePushPromptUntilTomorrow\(\);\n {2}refreshPushPrompt\(\);/);
});

test("nextBangkokSevenAm is 07:00 Bangkok of the next Bangkok calendar day, whatever the machine time zone", () => {
  const next = (iso) => new Date(require("../../modules/push-notifications.js").nextBangkokSevenAm(Date.parse(iso))).toISOString();
  assert.equal(next("2026-11-21T08:00:00Z"), "2026-11-22T00:00:00.000Z"); // 15:00 ไทย → 07:00 วันถัดไป
  assert.equal(next("2026-11-21T00:00:00Z"), "2026-11-22T00:00:00.000Z"); // 07:00 ไทยพอดี → 07:00 วันถัดไป
  assert.equal(next("2026-11-21T16:59:59Z"), "2026-11-22T00:00:00.000Z"); // 23:59:59 ไทย
  // หลังเที่ยงคืนไทย (ยังเป็นวันที่ 21 ตาม UTC) = วันปฏิทินไทยที่ 22 → ถึง 07:00 ของวันที่ 23 ไม่ใช่เช้าวันเดียวกัน
  assert.equal(next("2026-11-21T17:00:00Z"), "2026-11-23T00:00:00.000Z"); // 00:00 ไทย
  assert.equal(next("2026-11-21T17:30:00Z"), "2026-11-23T00:00:00.000Z"); // 00:30 ไทย
  assert.equal(next("2026-12-31T20:00:00Z"), "2027-01-02T00:00:00.000Z"); // ข้ามปี: 03:00 ไทยวันที่ 1 ม.ค. → 2 ม.ค.
});

test("nextBangkokSevenAm does not depend on the process time zone", () => {
  for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
    const run = spawnSync(process.execPath, ["-e", `console.log(new Date(require("./modules/push-notifications.js").nextBangkokSevenAm(Date.parse("2026-11-21T17:30:00Z"))).toISOString())`], { env: { ...process.env, TZ: zone }, cwd: new URL("../..", import.meta.url), encoding: "utf8" });
    assert.equal(run.stdout.trim(), "2026-11-23T00:00:00.000Z", zone);
  }
});

test("activeHiddenUntil trusts only a future time that this app could have stored", () => {
  const { activeHiddenUntil } = require("../../modules/push-notifications.js");
  const now = Date.parse("2026-11-21T08:00:00Z");
  assert.equal(activeHiddenUntil(String(now + 1000), now), now + 1000);
  assert.equal(activeHiddenUntil(String(now), now), null);
  assert.equal(activeHiddenUntil(String(now - 1), now), null);
  assert.equal(activeHiddenUntil(String(now + 3 * 24 * 3600 * 1000), now), null);
  for (const bad of [null, undefined, "", "abc", "NaN", "Infinity"]) assert.equal(activeHiddenUntil(bad, now), null, String(bad));
});

test("pushPromptKind returns nothing while the prompt is hidden or the person is paused", () => {
  assert.equal(pushPromptKind({ ...ready, permission: "default", hidden: true }), null);
  assert.equal(pushPromptKind({ ...ready, permission: "denied", hidden: true }), null);
  assert.equal(pushPromptKind({ ...ready, permission: "granted", hidden: true }), null);
  assert.equal(pushPromptKind({ ...ready, permission: "default", paused: true }), null);
  assert.equal(pushPromptKind({ ...ready, permission: "default", ios: true, standalone: false, paused: true }), null);
  assert.equal(pushPromptKind({ ...ready, permission: "default", hidden: false, paused: false }), "enable");
});

test("the prompt is skipped in test mode, lab-only accounts and on the notifications page", () => {
  assert.equal(buildPrompt({ sandbox: true }).html, "");
  assert.equal(buildPrompt({ labOnly: true }).html, "");
  assert.equal(buildPrompt({ path: "notifications" }).html, "");
});

test("a blocked browser and an uninstalled iPhone get a message with no enable button, using the panel wording", () => {
  const denied = buildPrompt({ environment: { permission: "denied" } }).html;
  assert.match(denied, /เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้/);
  assert.doesNotMatch(denied, /data-push-prompt-enable/);
  const deniedIos = buildPrompt({ environment: { permission: "denied", ios: true, standalone: true } }).html;
  assert.match(deniedIos, /ตั้งค่า › แจ้งเตือน › MNP/);
  const install = buildPrompt({ environment: { ios: true, standalone: false } }).html;
  assert.match(install, /เพิ่ม MNP ลงหน้าจอโฮมจาก Safari ก่อน/);
  assert.doesNotMatch(install, /data-push-prompt-enable/);
});

test("devices that cannot use push at all show nothing", () => {
  assert.equal(buildPrompt({ environment: { hasPushManager: false } }).html, "");
  assert.equal(buildPrompt({ environment: { keyConfigured: false } }).html, "");
  assert.equal(buildPrompt({ environment: { ios: true, standalone: true, hasPushManager: false } }).html, "");
});

test("an allowed device waits for the registration check, then shows the prompt only if not registered", () => {
  const allowed = { permission: "granted" };
  const unknown = buildPrompt({ environment: allowed });
  assert.equal(unknown.html, "");
  assert.deepEqual(unknown.checks, ["check"]);
  // ผลตรวจของบัญชีอื่นไม่ใช้กับบัญชีนี้
  assert.deepEqual(buildPrompt({ environment: allowed, cache: { owner: "other", value: true } }).checks, ["check"]);
  assert.equal(buildPrompt({ environment: allowed, cache: { owner: "e", value: true } }).html, "");
  const missing = buildPrompt({ environment: allowed, cache: { owner: "e", value: false } });
  assert.match(missing.html, /data-push-prompt-enable/);
  assert.deepEqual(missing.checks, []);
});

// ---------- สถานะลงทะเบียนต่อบัญชี: ผลที่กลับมาหลังสลับบัญชีต้องทิ้ง ----------
test("a registration check answered after switching accounts is dropped, not recorded for the new account", async () => {
  const state = { employee: { id: "a" } };
  let release;
  const context = vm.createContext({
    state, console: { warn() {} }, pushSubscribedCache: { owner: null, value: null },
    currentPushSubscription: async () => ({ endpoint: "https://push/e" }),
    sb: { rpc: () => new Promise((resolve) => { release = () => resolve({ data: true, error: null }); }) },
  });
  vm.runInContext(extractFunction("function setPushSubscribed("), context);
  vm.runInContext(extractFunction("async function checkPushSubscribed("), context);
  const pending = vm.runInContext("checkPushSubscribed", context)();
  await new Promise((resolve) => setImmediate(resolve));
  state.employee = { id: "b" };
  release();
  assert.equal(await pending, null);
  assert.deepEqual({ ...vm.runInContext("pushSubscribedCache", context) }, { owner: null, value: null });
  // บัญชีเดิมตอบทันทีก็จดได้ตามปกติ
  vm.runInContext("setPushSubscribed(true)", context);
  assert.deepEqual({ ...vm.runInContext("pushSubscribedCache", context) }, { owner: "b", value: true });
  // owner ที่จับไว้ตอนเริ่มไม่ตรงกับบัญชีปัจจุบัน = ไม่จด
  vm.runInContext('setPushSubscribed(false, "a")', context);
  assert.equal(vm.runInContext("pushSubscribedCache.value", context), true);
});

// ---------- ปุ่มบนแถบ: อนุญาตแล้วแต่ลงทะเบียนล้ม ต้องให้ปุ่มกลับมา ----------
function runPromptClick({ permission, enable }) {
  let handler;
  const log = { cache: null, refreshed: 0, toasts: [] };
  const button = { disabled: false, textContent: "เปิดแจ้งเตือน" };
  const context = vm.createContext({
    document: { addEventListener: (type, fn) => { if (type === "click") handler = fn; } },
    state: { employee: { id: "e" } }, console: { error() {} },
    Notification: { permission },
    enablePush: enable, showToast: (message, kind) => log.toasts.push([message, kind]),
    pushErrorMessage: () => "ผิดพลาด", refreshPushPrompt: () => { log.refreshed += 1; },
    setPushSubscribed: (value, owner) => { log.cache = { value, owner }; },
  });
  const start = appSource.indexOf('document.addEventListener("click", async (event) => {\n  const enable = event.target.closest?.("#push-prompt');
  assert.ok(start >= 0, "prompt click handler not found");
  vm.runInContext(appSource.slice(start, appSource.indexOf("\n});\n", start) + 4), context);
  return handler({ target: { closest: () => button } }).then(() => ({ log, button }));
}

test("when permission is granted but registering fails, the prompt is redrawn as a retry button", async () => {
  const failed = await runPromptClick({ permission: "granted", enable: async () => { throw new Error("offline"); } });
  assert.deepEqual(failed.log.cache, { value: false, owner: "e" });
  assert.equal(failed.log.refreshed, 1);
  // ผู้ใช้ยังไม่ตอบ/บล็อก: ไม่จดสถานะลงทะเบียนให้เพี้ยน
  const denied = await runPromptClick({ permission: "denied", enable: async () => "denied" });
  assert.equal(denied.log.cache, null);
  const dismissed = await runPromptClick({ permission: "default", enable: async () => "default" });
  assert.equal(dismissed.log.cache, null);
  // สำเร็จ: enablePush จดเองแล้ว handler ไม่จดซ้ำ
  const ok = await runPromptClick({ permission: "granted", enable: async () => "granted" });
  assert.equal(ok.log.cache, null);
  assert.equal(ok.log.refreshed, 1);
});
