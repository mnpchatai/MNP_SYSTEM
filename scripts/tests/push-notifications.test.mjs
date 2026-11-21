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
function buildPrompt({ sandbox = false, labOnly = false, path = "dashboard", environment = {}, cache = { owner: null, value: null }, storage = null, now = Date.parse("2026-11-21T08:00:00Z"), paused = false } = {}) {
  const checks = [];
  const store = storage ?? new Map();
  const context = vm.createContext({
    state: { employee: { id: "e" } }, isSandboxMode: () => sandbox, isLabOnly: () => labOnly, currentRoute: () => ({ path }),
    pushEnvironment: () => ({ ...ready, permission: "default", ios: false, standalone: false, ...environment }),
    pushSubscribedCache: cache, verifyPushPrompt: () => checks.push("check"), window: { MNP_PUSH: require("../../modules/push-notifications.js") },
    localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) },
    Date: { now: () => now }, String, pushAutoSubscribingFor: null, isPushPaused: () => paused,
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
  assert.match(html, /title="ซ่อนแถบนี้บนเครื่องนี้ถึง 07:00 น\. รอบถัดไป"/);
  assert.doesNotMatch(html, /พรุ่งนี้/);
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

test("hiding the prompt after Thai midnight keeps it away only until 07:00 the same morning", () => {
  // 22/11/2026 00:30 เวลาไทย (21/11 17:30Z) → ซ่อนถึง 22/11/2026 07:00 เวลาไทย (00:00Z) ไม่ใช่วันถัดไป
  const prompt = buildPrompt({ now: Date.parse("2026-11-21T17:30:00Z") });
  prompt.hide();
  assert.equal(prompt.store.get("mnp-push-prompt-hidden-until:e"), String(Date.parse("2026-11-22T00:00:00Z")));
  assert.equal(prompt.render(Date.parse("2026-11-21T23:59:59Z")), "");
  assert.match(prompt.render(Date.parse("2026-11-22T00:00:00Z")), /id="push-prompt"/);
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

test("nextBangkokSevenAm is the next 07:00 Bangkok that is still ahead, whatever the machine time zone", () => {
  const next = (iso) => new Date(require("../../modules/push-notifications.js").nextBangkokSevenAm(Date.parse(iso))).toISOString();
  assert.equal(next("2026-11-21T13:00:00Z"), "2026-11-22T00:00:00.000Z"); // 20:00 ไทย → 07:00 วันรุ่งขึ้น
  assert.equal(next("2026-11-21T08:00:00Z"), "2026-11-22T00:00:00.000Z"); // 15:00 ไทย → 07:00 วันรุ่งขึ้น
  assert.equal(next("2026-11-21T16:59:59Z"), "2026-11-22T00:00:00.000Z"); // 23:59:59 ไทย → 07:00 วันรุ่งขึ้น
  // หลังเที่ยงคืนไทยก่อน 07:00 → 07:00 เช้าวันเดียวกัน (ปฏิทินไทย)
  assert.equal(next("2026-11-21T17:00:00Z"), "2026-11-22T00:00:00.000Z"); // 00:00:00 ไทย (22/11)
  assert.equal(next("2026-11-21T17:30:00Z"), "2026-11-22T00:00:00.000Z"); // 00:30 ไทย
  assert.equal(next("2026-11-21T23:59:59Z"), "2026-11-22T00:00:00.000Z"); // 06:59:59 ไทย
  // 07:00:00 พอดีหรือหลังจากนั้น → 07:00 ของวันถัดไป (ผลต้องอยู่ในอนาคตเสมอ)
  assert.equal(next("2026-11-22T00:00:00Z"), "2026-11-23T00:00:00.000Z"); // 07:00:00 ไทย
  assert.equal(next("2026-11-22T00:00:01Z"), "2026-11-23T00:00:00.000Z"); // 07:00:01 ไทย
  // ขอบเขต UTC: 16:59:59Z และ 17:00:00Z คือก่อน/หลังเที่ยงคืนไทย (ครอบด้วยข้างบนแล้ว) · สิ้นปี/สิ้นเดือน
  assert.equal(next("2026-12-31T20:00:00Z"), "2027-01-01T00:00:00.000Z"); // 03:00 ไทย 1 ม.ค. → 07:00 เช้าวันเดียวกัน
  assert.equal(next("2026-12-31T13:00:00Z"), "2027-01-01T00:00:00.000Z"); // 20:00 ไทย 31 ธ.ค. → 07:00 1 ม.ค.
  assert.equal(next("2026-12-31T00:00:00Z"), "2027-01-01T00:00:00.000Z"); // 07:00 ไทย 31 ธ.ค. → 07:00 1 ม.ค.
  assert.equal(next("2026-11-30T13:00:00Z"), "2026-12-01T00:00:00.000Z"); // 20:00 ไทย 30 พ.ย. → 07:00 1 ธ.ค.
  // ผลต้องมากกว่าเวลากดเสมอ และไม่เกิน 24 ชั่วโมง
  for (let offsetSeconds = 0; offsetSeconds < 2 * 24 * 3600; offsetSeconds += 1801) {
    const now = Date.parse("2026-11-21T00:00:00Z") + offsetSeconds * 1000;
    const result = require("../../modules/push-notifications.js").nextBangkokSevenAm(now);
    assert.ok(result > now && result - now <= 24 * 3600 * 1000, String(now));
    assert.equal(new Date(result).getUTCHours(), 0);
  }
});

test("nextBangkokSevenAm does not depend on the process time zone", () => {
  for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
    const run = spawnSync(process.execPath, ["-e", `const next = (iso) => new Date(require("./modules/push-notifications.js").nextBangkokSevenAm(Date.parse(iso))).toISOString(); console.log(next("2026-11-21T17:30:00Z"), next("2026-11-21T13:00:00Z"), next("2026-11-22T00:00:00Z"))`], { env: { ...process.env, TZ: zone }, cwd: new URL("../..", import.meta.url), encoding: "utf8" });
    assert.equal(run.stdout.trim(), "2026-11-22T00:00:00.000Z 2026-11-22T00:00:00.000Z 2026-11-23T00:00:00.000Z", zone);
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
  vm.runInContext("var pushSubscribedWrites = 0;", context);
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

// ---------- เปิดรับแจ้งเตือนอัตโนมัติหลังล็อกอิน (resyncPushSubscription) ----------
// ตัดฟังก์ชันจริงมารันกับของปลอม: คืน log ของสิ่งที่ถูกเรียก และตัวควบคุมให้แต่ละขั้นค้าง/ล้มได้
function buildResync({ environment = {}, sandbox = false, labOnly = false, existing = null, ensure, save, timeoutMs = 30000 } = {}) {
  const log = { ensured: 0, saved: [], deleted: [], cache: [], refreshed: 0, warned: 0, permissionRequests: 0 };
  const state = { employee: { id: "e" } };
  const subscription = { endpoint: "https://push/new" };
  const context = vm.createContext({
    state, isSandboxMode: () => sandbox, isLabOnly: () => labOnly,
    pushEnvironment: () => ({ ...ready, permission: "granted", ios: false, standalone: false, ...environment }),
    serviceWorkerReady: async () => ({ pushManager: { getSubscription: async () => existing } }),
    ensurePushSubscription: async () => { log.ensured += 1; return ensure ? ensure() : subscription; },
    savePushSubscription: async (value) => { if (save) await save(value); log.saved.push(value.endpoint); },
    setPushSubscribed: (value, owner) => { log.cache.push([value, owner]); },
    refreshPushPrompt: () => { log.refreshed += 1; },
    sb: { rpc: async (name, args) => { log.deleted.push([name, args.p_endpoint]); return { error: null }; } },
    console: { warn: () => { log.warned += 1; } },
    Notification: { requestPermission: () => { log.permissionRequests += 1; } },
    setTimeout, clearTimeout, Promise, Error, PUSH_RESYNC_TIMEOUT_MS: timeoutMs,
  });
  vm.runInContext("var pushResyncedFor = null; var pushAutoSubscribingFor = null;", context);
  vm.runInContext(extractFunction("function withTimeout("), context);
  vm.runInContext(extractFunction("async function resyncPushSubscription("), context);
  return { log, state, context, run: () => vm.runInContext("resyncPushSubscription", context)(), inFlight: () => vm.runInContext("pushAutoSubscribingFor", context) };
}

test("a signed-in device that is already allowed is registered silently and never asks for permission", async () => {
  const fresh = buildResync();
  await fresh.run();
  assert.deepEqual(fresh.log.saved, ["https://push/new"]);
  assert.deepEqual(fresh.log.cache, [[true, "e"]]);
  assert.equal(fresh.log.permissionRequests, 0);
  assert.equal(fresh.log.warned, 0);
  assert.equal(fresh.inFlight(), null);
  assert.equal(fresh.log.refreshed, 1);
  // เดิมเป็นของบัญชีอื่น/ต่ออายุ: บันทึกทับ endpoint เดิมเลย ไม่ยกเลิกการสมัครทิ้ง
  const existing = { endpoint: "https://push/old", unsubscribe: async () => { throw new Error("must not unsubscribe"); } };
  const moved = buildResync({ existing, ensure: () => existing });
  await moved.run();
  assert.deepEqual(moved.log.saved, ["https://push/old"]);
  assert.deepEqual(moved.log.deleted, []);
  // กุญแจเปลี่ยน → ได้ endpoint ใหม่ ลบแถวของ endpoint เดิม
  const rekeyed = buildResync({ existing });
  await rekeyed.run();
  assert.deepEqual(rekeyed.log.deleted, [["app_delete_push_subscription", "https://push/old"]]);
});

test("nothing is registered unless the browser already allowed notifications, and never in test mode, lab-only or without a key", async () => {
  for (const permission of ["default", "denied"]) {
    const run = buildResync({ environment: { permission } });
    await run.run();
    assert.equal(run.log.ensured, 0, permission);
    assert.deepEqual(run.log.cache, []);
    assert.equal(run.inFlight(), null);
  }
  for (const options of [{ sandbox: true }, { labOnly: true }, { environment: { keyConfigured: false } }, { environment: { hasPushManager: false } }, { environment: { hasServiceWorker: false } }]) {
    const run = buildResync(options);
    await run.run();
    assert.equal(run.log.ensured, 0, JSON.stringify(options));
    assert.equal(run.log.permissionRequests, 0);
  }
});

test("a failed silent registration is tried once, leaves the status unknown for the prompt to check, and does not throw", async () => {
  const failed = buildResync({ ensure: () => { throw new Error("NotAllowedError"); } });
  await failed.run();
  assert.equal(failed.log.ensured, 1);
  assert.deepEqual(failed.log.cache, [[null, "e"]]);
  assert.equal(failed.log.warned, 1);
  assert.equal(failed.inFlight(), null);
  assert.equal(failed.log.refreshed, 1);
  // บันทึกล้ม (ออฟไลน์/RPC ล้ม) ก็เหมือนกัน
  const unsaved = buildResync({ save: async () => { throw new Error("offline"); } });
  await unsaved.run();
  assert.deepEqual(unsaved.log.cache, [[null, "e"]]);
  assert.deepEqual(unsaved.log.saved, []);
});

test("while registering silently the prompt stays hidden, then the prompt is redrawn once", async () => {
  let release;
  const slow = buildResync({ save: () => new Promise((resolve) => { release = resolve; }) });
  const pending = slow.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slow.inFlight(), "e");
  assert.equal(slow.log.refreshed, 0);
  release();
  await pending;
  assert.equal(slow.inFlight(), null);
  assert.equal(slow.log.refreshed, 1);
  // แถบไม่แสดงและไม่ยิงตรวจสถานะระหว่างที่ผูกอัตโนมัติอยู่
  const context = vm.createContext({
    state: { employee: { id: "e" } }, isSandboxMode: () => false, isLabOnly: () => false, currentRoute: () => ({ path: "dashboard" }),
    pushEnvironment: () => ({ ...ready, permission: "granted", ios: false, standalone: false }), pushSubscribedCache: { owner: "e", value: false },
    verifyPushPrompt: () => { throw new Error("must not check"); }, window: { MNP_PUSH: require("../../modules/push-notifications.js") },
    localStorage: { getItem: () => null }, Date, String, isPushPaused: () => false,
  });
  vm.runInContext("var pushAutoSubscribingFor = 'e';", context);
  vm.runInContext(appSource.slice(appSource.indexOf("const PUSH_PROMPT_HIDDEN_KEY"), appSource.indexOf("function pushPromptHtml(")), context);
  vm.runInContext(extractFunction("function pushNotice("), context);
  vm.runInContext(extractFunction("function pushPromptHtml("), context);
  assert.equal(vm.runInContext("pushPromptHtml()", context), "");
  vm.runInContext("pushAutoSubscribingFor = null;", context);
  assert.match(vm.runInContext("pushPromptHtml()", context), /data-push-prompt-enable/);
});

test("a silent registration that hangs is given up after the time limit, the flag is cleared and the prompt comes back", async () => {
  // ขั้นใดขั้นหนึ่งไม่ตอบเลย (getSubscription / subscribe / RPC) = จบแบบล้ม ไม่ค้างธงจนโหลดหน้าใหม่
  const hung = buildResync({ timeoutMs: 20, ensure: () => new Promise(() => {}) });
  await hung.run();
  assert.equal(hung.inFlight(), null);
  assert.deepEqual(hung.log.cache, [[null, "e"]]);
  assert.equal(hung.log.warned, 1);
  assert.equal(hung.log.refreshed, 1);
  assert.deepEqual(hung.log.saved, []);
  const savingHung = buildResync({ timeoutMs: 20, save: () => new Promise(() => {}) });
  await savingHung.run();
  assert.equal(savingHung.inFlight(), null);
  assert.deepEqual(savingHung.log.cache, [[null, "e"]]);
  // ผลที่กลับมาทีหลังเกินเวลา: จดสถานะจริงของบัญชีเดิม + วาดแถบใหม่ ไม่ทำให้ธงหรือสถานะเพี้ยน
  let release;
  const late = buildResync({ timeoutMs: 20, ensure: () => new Promise((resolve) => { release = () => resolve({ endpoint: "https://push/late" }); }) });
  await late.run();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(late.log.saved, ["https://push/late"]);
  assert.deepEqual(late.log.cache, [[null, "e"], [true, "e"]]);
  assert.equal(late.log.refreshed, 2);
  assert.equal(late.inFlight(), null);
  // ผลที่มาช้าหลังสลับบัญชี: ห้ามผูกเครื่องให้บัญชีใหม่ และไม่วาดแถบของบัญชีใหม่ซ้ำ
  const switched = buildResync({ timeoutMs: 20, ensure: () => new Promise((resolve) => { release = () => resolve({ endpoint: "https://push/late" }); }) });
  await switched.run();
  switched.state.employee = { id: "other" };
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(switched.log.saved, []);
  assert.deepEqual(switched.log.cache, [[null, "e"]]);
  assert.equal(switched.log.refreshed, 1);
  assert.match(appSource, /const PUSH_RESYNC_TIMEOUT_MS = 30000;/);
});

test("switching accounts while registering does not bind the device to the new account with the old result", async () => {
  let release;
  const run = buildResync({ ensure: () => new Promise((resolve) => { release = () => resolve({ endpoint: "https://push/new" }); }) });
  const pending = run.run();
  await new Promise((resolve) => setImmediate(resolve));
  run.state.employee = { id: "other" };
  release();
  await pending;
  assert.deepEqual(run.log.saved, []);
  assert.deepEqual(run.log.cache, []);
  // ธงของบัญชีใหม่ที่เริ่มรอบของตัวเองแล้วต้องไม่ถูกรอบเก่าล้าง
  const raced = buildResync({ ensure: () => new Promise((resolve) => { release = () => resolve({ endpoint: "https://push/new" }); }) });
  const first = raced.run();
  await new Promise((resolve) => setImmediate(resolve));
  raced.state.employee = { id: "other" };
  vm.runInContext("pushAutoSubscribingFor = 'other'", raced.context);
  release();
  await first;
  assert.equal(raced.inFlight(), "other");
});

test("the silent registration path never asks for permission and the sign-out release re-arms it", () => {
  const body = appSource.slice(appSource.indexOf("async function resyncPushSubscription("), appSource.indexOf("// ออกจากระบบ: เอาเครื่องนี้ออก"));
  assert.doesNotMatch(body, /requestPermission|\.unsubscribe\(/);
  assert.match(body, /environment\.permission !== "granted"/);
  assert.match(appSource, /if \(pushResyncedFor !== state\.employee\.id\) \{\n {4}pushResyncedFor = state\.employee\.id;\n {4}resyncPushSubscription\(\);/);
  const release = appSource.slice(appSource.indexOf("async function releasePushOnThisDevice("), appSource.indexOf("// รอไม่เกิน 4 วินาที"));
  assert.match(release, /pushResyncedFor = null;/);
  // เหตุผลของการเปลี่ยนกติกาเดิมต้องจดไว้ที่ฟังก์ชัน
  assert.match(appSource, /เจ้าของระบบสำนักงานตัดสินเมื่อ 21\/11\/2026/);
});

test("a registration check that was overtaken by a newer status write returns the newer value", async () => {
  const state = { employee: { id: "a" } };
  let release;
  const context = vm.createContext({
    state, console: { warn() {} }, pushSubscribedCache: { owner: null, value: null },
    currentPushSubscription: async () => ({ endpoint: "https://push/e" }),
    sb: { rpc: () => new Promise((resolve) => { release = () => resolve({ data: false, error: null }); }) },
  });
  vm.runInContext("var pushSubscribedWrites = 0;", context);
  vm.runInContext(extractFunction("function setPushSubscribed("), context);
  vm.runInContext(extractFunction("async function checkPushSubscribed("), context);
  const pending = vm.runInContext("checkPushSubscribed", context)();
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext("setPushSubscribed(true)", context); // สมัครเครื่องนี้สำเร็จระหว่างรอคำตอบเก่า
  release();
  assert.equal(await pending, true);
  assert.equal(vm.runInContext("pushSubscribedCache.value", context), true);
});

// ---------- พักแจ้งเตือน ----------
const { isMissingFunctionError } = require("../../modules/push-notifications.js");

test("a database without the pause functions is recognised, other errors are not", () => {
  assert.equal(isMissingFunctionError({ code: "PGRST202", message: "x" }), true);
  assert.equal(isMissingFunctionError({ code: "42883" }), true);
  assert.equal(isMissingFunctionError({ status: 404 }), true);
  assert.equal(isMissingFunctionError({ message: "Could not find the function public.app_push_pause_status without parameters in the schema cache" }), true);
  for (const other of [null, undefined, {}, { code: "AUTH_REQUIRED" }, { code: "42501", message: "LAB_ONLY_ACCOUNT" }, { message: "Failed to fetch" }, { status: 500 }]) {
    assert.equal(isMissingFunctionError(other), false, JSON.stringify(other));
  }
});

// โลกจำลองของส่วนพักแจ้งเตือนใน app.js: ใช้โค้ดจริงของฟังก์ชัน ส่วนฐานข้อมูล/เสียง/นาฬิกาเป็นของปลอมที่ควบคุมได้
function buildPauseWorld({ rpc = async () => ({ data: null, error: null }), labOnly = false, sandbox = false, key = "key" } = {}) {
  const clock = { now: Date.parse("2026-11-21T08:00:00Z") };
  class FakeDate extends Date { static now() { return clock.now; } }
  const log = { rpc: [], warned: 0, toasts: [], refreshedPrompt: 0, played: 0, counted: [], replies: [], unreadAnnounce: [] };
  const state = { employee: { id: "e" } };
  const document = { visibilityState: "visible", querySelector: () => null };
  const panel = {
    isConnected: true, hidden: true, innerHTML: "", handlers: {}, buttons: {},
    querySelector(selector) {
      const attribute = selector.slice(1, -1);
      if (!this.innerHTML.includes(attribute)) return null;
      return this.buttons[attribute] ??= { disabled: false, textContent: "", addEventListener: (type, handler) => { this.handlers[attribute] = handler; } };
    },
  };
  document.querySelector = (selector) => (selector === "#push-panel" ? panel : null);
  const pushWorld = { pushState: "on" };
  const context = vm.createContext({
    state, document, Date: FakeDate, Intl, String, Number, Promise, console: { warn: () => { log.warned += 1; }, error() {} },
    PUSH_PUBLIC_KEY: key, isLabOnly: () => labOnly, isSandboxMode: () => sandbox,
    sb: { rpc: async (name, args) => { log.rpc.push(name); return rpc(name, args); } },
    window: { MNP_PUSH: require("../../modules/push-notifications.js") },
    refreshPushPrompt: () => { log.refreshedPrompt += 1; },
    showToast: (message, kind) => log.toasts.push([message, kind]),
    friendlyError: () => "ข้อความจากตารางกลาง",
    loadPushState: async () => pushWorld.pushState, pushEnvironment: () => ({ ios: false }),
    enablePush: async () => "granted",
    notifySound: {
      canHandle: () => true, playForPush: async () => { log.played += 1; return "played"; },
      observeUnread: (owner, count, options) => { log.unreadAnnounce.push(options.announce); return false; }, setBaseline() {},
    },
    withTimeout: (promise) => promise, updateUnreadBadges() {}, showSoundFallbackNotification: async () => {},
  });
  // loadUnread ต้องเดินเส้นทาง "นับแล้วบอกตัวจัดการเสียง" ด้วยของจริง (ไม่ใช่กลุ่มจำกัดแผนก)
  context.isDeptRestricted = () => false;
  context.sb.from = () => ({ select: () => ({ eq: () => ({ is: async () => ({ count: 3, error: null }) }) }) });
  vm.runInContext(appSource.slice(appSource.indexOf("const PUSH_PAUSE_RELOAD_MS"), appSource.indexOf("\n}\n", appSource.indexOf("async function resumePush(")) + 3), context);
  for (const signature of ["function formatDate(", "function escapeHtml(", "function pushNotice(", "function pushPanelBodyHtml(", "function pushErrorMessage(", "async function refreshPushPanel(", "async function loadUnread(", "async function onNotificationPushMessage("]) {
    vm.runInContext(extractFunction(signature), context);
  }
  const call = (code) => vm.runInContext(code, context);
  return { clock, log, state, context, call, panel, pushWorld, document };
}
const hours = (count) => count * 3600 * 1000;

test("the pause status is read once, kept per account, and expires on its own without another query", async () => {
  const until = new Date("2026-11-22T00:00:00.000Z").toISOString();
  const world = buildPauseWorld({ rpc: async () => ({ data: until, error: null }) });
  assert.equal(await world.call("loadPushPause()"), Date.parse(until));
  assert.equal(world.call("isPushPaused()"), true);
  assert.equal(world.log.rpc.length, 1);
  world.clock.now = Date.parse("2026-11-21T23:59:59Z");
  assert.equal(world.call("isPushPaused()"), true);
  world.clock.now = Date.parse("2026-11-22T00:00:00Z"); // ถึง 07:00 ไทยพอดี = หมดพัก
  assert.equal(world.call("isPushPaused()"), false);
  assert.equal(world.log.rpc.length, 1);
  // อีกบัญชีบนเครื่องเดียวกันไม่ถูกนับว่าพักตาม
  world.clock.now = Date.parse("2026-11-21T08:00:00Z");
  world.state.employee = { id: "other" };
  assert.equal(world.call("isPushPaused()"), false);
  // ไม่ได้พัก/ค่าไม่ใช่เวลา = ไม่พัก
  for (const data of [null, "not a date", 5]) {
    const none = buildPauseWorld({ rpc: async () => ({ data, error: null }) });
    assert.equal(await none.call("loadPushPause()"), null, String(data));
    assert.equal(none.call("isPushPaused()"), false);
  }
});

test("a database without the pause functions hides the feature quietly and is asked only once", async () => {
  const world = buildPauseWorld({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) });
  assert.equal(await world.call("loadPushPause()"), null);
  assert.equal(world.call("pushPauseSupported"), false);
  assert.equal(world.log.warned, 0);
  await world.call("loadPushPause()");
  await world.call("syncPushPause()");
  assert.equal(world.log.rpc.length, 1);
  assert.equal(world.log.refreshedPrompt, 0);
  // หน้าการแจ้งเตือนไม่แสดงปุ่มพัก (แต่ยังแสดงสถานะเปิดอยู่ตามปกติ) และไม่มี error
  world.panel.innerHTML = "";
  await world.call("refreshPushPanel()");
  assert.match(world.panel.innerHTML, /เปิดอยู่/);
  assert.doesNotMatch(world.panel.innerHTML, /data-push-pause/);
  assert.equal(world.log.toasts.length, 0);
});

test("a temporary failure is logged once per try, keeps the old value and is retried later", async () => {
  let fail = true;
  const until = "2026-11-22T00:00:00.000Z";
  const world = buildPauseWorld({ rpc: async () => (fail ? { data: null, error: { message: "Failed to fetch" } } : { data: until, error: null }) });
  assert.equal(await world.call("loadPushPause()"), null);
  assert.equal(world.log.warned, 1);
  assert.equal(world.call("pushPauseSupported"), true);
  fail = false;
  assert.equal(await world.call("loadPushPause()"), Date.parse(until));
  fail = true; // ล้มอีกครั้ง: ค่าที่จำไว้ยังอยู่
  assert.equal(await world.call("loadPushPause()"), Date.parse(until));
});

test("a status answer that arrives after switching accounts or after pressing pause is dropped", async () => {
  let release;
  const later = new Date("2026-11-22T00:00:00.000Z").toISOString();
  const world = buildPauseWorld({ rpc: (name) => (name === "app_push_pause_status" ? new Promise((resolve) => { release = () => resolve({ data: null, error: null }); }) : Promise.resolve({ data: later, error: null })) });
  const pending = world.call("loadPushPause()");
  await new Promise((resolve) => setImmediate(resolve));
  world.state.employee = { id: "other" };
  release();
  await pending;
  assert.equal(world.call("pushPauseCache.owner"), null);
  // กดพักระหว่างรอคำตอบ "ไม่ได้พัก" ที่เก่ากว่า: ค่าที่เพิ่งกดต้องไม่ถูกทับ
  const racing = buildPauseWorld({ rpc: (name) => (name === "app_push_pause_status" ? new Promise((resolve) => { release = () => resolve({ data: null, error: null }); }) : Promise.resolve({ data: later, error: null })) });
  const load = racing.call("loadPushPause()");
  await new Promise((resolve) => setImmediate(resolve));
  await racing.call("pausePush()");
  release();
  await load;
  assert.equal(racing.call("isPushPaused()"), true);
});

test("pausing stores the time the database returns and resuming clears it; failures keep the old state", async () => {
  const until = "2026-11-22T00:00:00.000Z";
  let pauseError = null;
  const world = buildPauseWorld({ rpc: async (name) => (pauseError ? { data: null, error: pauseError } : { data: name === "app_push_pause" ? until : null, error: null }) });
  await world.call("pausePush()");
  assert.equal(world.call("activePushPauseUntil()"), Date.parse(until));
  pauseError = { code: "P0001", message: "AUTH_REQUIRED" };
  await assert.rejects(() => world.call("resumePush()"));
  assert.equal(world.call("isPushPaused()"), true);
  pauseError = null;
  await world.call("resumePush()");
  assert.equal(world.call("isPushPaused()"), false);
  assert.deepEqual(world.log.rpc, ["app_push_pause", "app_push_resume", "app_push_resume"]);
  // ตอบกลับที่อ่านเวลาไม่ได้ = ไม่จดว่าพัก
  const odd = buildPauseWorld({ rpc: async () => ({ data: "oops", error: null }) });
  await assert.rejects(() => odd.call("pausePush()"));
  assert.equal(odd.call("isPushPaused()"), false);
  // ไม่มีฟังก์ชันตอนกด = ปุ่มหายหลังวาดใหม่
  const missing = buildPauseWorld({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) });
  await assert.rejects(() => missing.call("pausePush()"));
  assert.equal(missing.call("pushPauseSupported"), false);
});

test("coming back to the page asks again only after 15 minutes, and redraws the prompt only when the state changed", async () => {
  const until = "2026-11-22T00:00:00.000Z";
  let answer = null;
  const world = buildPauseWorld({ rpc: async () => ({ data: answer, error: null }) });
  await world.call("syncPushPause()"); // หลังล็อกอิน
  assert.equal(world.log.rpc.length, 1);
  assert.equal(world.log.refreshedPrompt, 0);
  world.clock.now += hours(0.2);
  world.call("syncPushPauseIfStale()");
  assert.equal(world.log.rpc.length, 1);
  world.clock.now += hours(0.1); // รวมเกิน 15 นาทีแล้ว
  answer = until;
  world.call("syncPushPauseIfStale()");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(world.log.rpc.length, 2);
  assert.equal(world.log.refreshedPrompt, 1); // ไม่พัก → พัก (จากเครื่องอื่น)
  // หน้าถูกซ่อนอยู่ ไม่ถาม
  world.clock.now += hours(1);
  world.document.visibilityState = "hidden";
  world.call("syncPushPauseIfStale()");
  assert.equal(world.log.rpc.length, 2);
  // ไม่เคยล็อกอินในหน้านี้ (ยังไม่เคยถามของบัญชีนี้) ไม่ถาม
  world.document.visibilityState = "visible";
  world.state.employee = { id: "other" };
  world.call("syncPushPauseIfStale()");
  assert.equal(world.log.rpc.length, 2);
});

test("the 60-second sound poll notices a pause made on another device, still at most every 15 minutes", async () => {
  const until = "2026-11-22T00:00:00.000Z";
  let answer = null;
  const world = buildPauseWorld({ rpc: async (name) => (name === "app_push_pause_status" ? { data: answer, error: null } : { data: null, error: null }) });
  world.context.navigator = { onLine: true };
  world.context.notifySound.isReady = () => true;
  world.context.loadUnread = async () => { world.log.polled = (world.log.polled ?? 0) + 1; };
  world.context.withTimeout = (promise) => promise;
  vm.runInContext(extractFunction("async function pollUnreadForSound("), world.context);
  await world.call("syncPushPause()"); // หลังล็อกอิน: ไม่พัก
  assert.equal(world.log.rpc.length, 1);
  // poll ทุก 60 วินาทีหลายรอบในช่วง 15 นาที ไม่ถามฐานข้อมูล
  for (let minute = 1; minute <= 14; minute += 1) {
    world.clock.now += 60_000;
    await world.call("pollUnreadForSound()");
  }
  assert.equal(world.log.rpc.length, 1);
  assert.equal(world.call("isPushPaused()"), false);
  // เจ้าของกดพักจากมือถือ → รอบ poll แรกที่เลย 15 นาทีรู้เองโดยไม่ต้องมี visibilitychange และไม่ต้องเปิดหน้าใหม่
  answer = until;
  world.clock.now += 2 * 60_000;
  await world.call("pollUnreadForSound()");
  assert.equal(world.log.rpc.length, 2);
  assert.equal(world.call("isPushPaused()"), true);
  assert.equal(world.log.refreshedPrompt, 1);
  assert.equal(world.log.polled, 15);
  // ฐานข้อมูลที่ยังไม่มีฟังก์ชันพัก: ไม่ถามอีกเลย แม้ผ่านไปนาน
  const missing = buildPauseWorld({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) });
  missing.context.navigator = { onLine: true };
  missing.context.notifySound.isReady = () => true;
  missing.context.loadUnread = async () => {};
  missing.context.withTimeout = (promise) => promise;
  vm.runInContext(extractFunction("async function pollUnreadForSound("), missing.context);
  await missing.call("syncPushPause()");
  assert.equal(missing.log.rpc.length, 1);
  missing.clock.now += hours(3);
  await missing.call("pollUnreadForSound()");
  assert.equal(missing.log.rpc.length, 1);
});

test("the test mode, lab-only accounts and a missing VAPID key never ask about pausing", async () => {
  for (const options of [{ labOnly: true }, { key: "" }]) {
    const world = buildPauseWorld(options);
    await world.call("loadPushPause()");
    assert.equal(world.log.rpc.length, 0, JSON.stringify(options));
  }
});

test("no company sound while paused: the page tells the service worker it will not play, and nothing plays", async () => {
  const until = "2026-11-22T00:00:00.000Z";
  const reply = () => { const log = []; return { log, port: { postMessage: (value) => log.push(value), close() {} } }; };
  const open = buildPauseWorld({ rpc: async () => ({ data: null, error: null }) });
  const normal = reply();
  open.context.__port = normal.port;
  await open.call("onNotificationPushMessage({ tag: 'n-1', title: 't', url: '#/x' }, __port)");
  assert.deepEqual(JSON.parse(JSON.stringify(normal.log)), [{ willPlaySound: true }]);
  assert.equal(open.log.played, 1);
  // กำลังพัก
  const paused = buildPauseWorld({ rpc: async () => ({ data: until, error: null }) });
  await paused.call("loadPushPause()");
  const silent = reply();
  paused.context.__port = silent.port;
  await paused.call("onNotificationPushMessage({ tag: 'n-1', title: 't', url: '#/x' }, __port)");
  assert.deepEqual(JSON.parse(JSON.stringify(silent.log)), [{ willPlaySound: false }]);
  assert.equal(paused.log.played, 0);
  // Push สรุปหลังครบเวลาพัก: ล้างสถานะพักที่ค้าง (นาฬิกาเครื่องช้ากว่า) แล้วเล่นตามปกติ
  const digest = reply();
  paused.context.__port = digest.port;
  await paused.call("onNotificationPushMessage({ tag: 'pause-digest-emp1', title: 'สรุป', url: '#/notifications' }, __port)");
  assert.deepEqual(JSON.parse(JSON.stringify(digest.log)), [{ willPlaySound: true }]);
  assert.equal(paused.log.played, 1);
  assert.equal(paused.call("isPushPaused()"), false);
});

test("the unread number is still counted while paused, but it never announces", async () => {
  const until = "2026-11-22T00:00:00.000Z";
  const free = buildPauseWorld();
  await free.call("loadUnread()");
  const paused = buildPauseWorld({ rpc: async () => ({ data: until, error: null }) });
  await paused.call("loadPushPause()");
  await paused.call("loadUnread()");
  assert.deepEqual(free.log.unreadAnnounce, [true]);
  assert.deepEqual(paused.log.unreadAnnounce, [false]);
  // ครบเวลาแล้วกลับมาประกาศตามปกติโดยไม่ต้องถามฐานข้อมูลใหม่
  paused.clock.now = Date.parse("2026-11-22T00:00:01Z");
  await paused.call("loadUnread()");
  assert.deepEqual(paused.log.unreadAnnounce, [false, true]);
  assert.equal(paused.log.rpc.length, 1);
});

test("the pause panel shows the status, the description and the resume button in Thai", () => {
  const world = buildPauseWorld();
  const html = (state, options) => world.context.pushPanelBodyHtml(state, false, options);
  const until = Date.parse("2026-11-22T00:00:00Z");
  const on = html("on", { canPause: true });
  assert.match(on, /<span class="badge">เปิดอยู่<\/span>/);
  assert.match(on, /data-push-pause[^>]*>พักแจ้งเตือนถึง 07:00 น\.<\/button>/);
  assert.match(on, /data-push-pause title="ไม่มีแจ้งเตือนเด้งบนทุกเครื่องของคุณจนถึง 07:00 น\. รอบถัดไป \(อีเมลและรายการในหน้านี้ยังมาตามปกติ\)"/);
  assert.doesNotMatch(on, /พรุ่งนี้/);
  assert.doesNotMatch(on, /ปิดบนเครื่องนี้|data-push-disable|data-push-resume/);
  assert.doesNotMatch(html("on", { canPause: false }), /<button/);
  for (const state of ["on", "off", "denied", "ios-install"]) {
    const paused = html(state, { pausedUntil: until, canPause: true });
    assert.match(paused, /<span class="badge">พักอยู่ถึง 22 พ\.ย\. 2569 07:00 น\.<\/span>/, state);
    assert.match(paused, /ระหว่างพักจะไม่มีแจ้งเตือนเด้งบนทุกเครื่องของคุณ อีเมลและรายการในหน้านี้ยังมาตามปกติ ระบบจะเปิดให้เองเวลา 07:00 น\./, state);
    assert.match(paused, /data-push-resume[^>]*>เปิดแจ้งเตือนต่อ<\/button>/, state);
    assert.doesNotMatch(paused, /data-push-pause|data-push-enable/, state);
  }
  // โหมดทดสอบพักไม่ได้ ไม่แสดงปุ่มพัก/เปิดต่อ
  assert.doesNotMatch(html("sandbox", { pausedUntil: until, canPause: true }), /data-push-resume|data-push-pause/);
  assert.match(html("off", {}), /data-push-enable/);
});

test("pressing pause and resume on the panel calls the database once and redraws without asking again", async () => {
  const until = "2026-11-22T00:00:00.000Z";
  const world = buildPauseWorld({ rpc: async (name) => ({ data: name === "app_push_pause" ? until : null, error: null }) });
  await world.call("refreshPushPanel()");
  assert.deepEqual(world.log.rpc, ["app_push_pause_status"]);
  assert.match(world.panel.innerHTML, /data-push-pause/);
  const pauseButton = world.panel.buttons["data-push-pause"];
  await world.panel.handlers["data-push-pause"]({ currentTarget: pauseButton });
  assert.equal(pauseButton.textContent, "กำลังพัก…");
  assert.deepEqual(world.log.rpc, ["app_push_pause_status", "app_push_pause"]);
  assert.match(world.panel.innerHTML, /พักอยู่ถึง/);
  assert.match(world.panel.innerHTML, /data-push-resume/);
  await world.panel.handlers["data-push-resume"]({ currentTarget: world.panel.buttons["data-push-resume"] });
  assert.deepEqual(world.log.rpc, ["app_push_pause_status", "app_push_pause", "app_push_resume"]);
  assert.match(world.panel.innerHTML, /data-push-pause/);
  assert.equal(world.log.toasts.length, 0);
});

test("a failed pause shows a Thai message and leaves the panel unchanged", async () => {
  const world = buildPauseWorld({ rpc: async (name) => (name === "app_push_pause" ? { data: null, error: { message: "Failed to fetch" } } : { data: null, error: null }) });
  await world.call("refreshPushPanel()");
  await world.panel.handlers["data-push-pause"]({ currentTarget: world.panel.buttons["data-push-pause"] });
  assert.deepEqual(world.log.toasts, [["พักแจ้งเตือนไม่สำเร็จ กรุณาลองอีกครั้ง", "error"]]);
  assert.match(world.panel.innerHTML, /data-push-pause/);
  assert.doesNotMatch(world.panel.innerHTML, /พักอยู่ถึง/);
});

test("the old per-device off switch is gone and the pause is wired into login, visibility and the prompt", () => {
  assert.doesNotMatch(appSource, /disablePush|data-push-disable|ปิดบนเครื่องนี้/);
  assert.match(appSource, /resyncPushSubscription\(\);\n {4}syncPushPause\(\);/);
  assert.match(appSource, /document\.addEventListener\("visibilitychange", syncPushPauseIfStale\);/);
  assert.match(appSource, /hidden: pushPromptHiddenNow\(\), paused: isPushPaused\(\)/);
  // รอบ poll เสียงเรียกได้เฉพาะตัวที่จำกัด 15 นาที ไม่ถามฐานข้อมูลตรงๆ ทุก 60 วินาที
  const poll = appSource.slice(appSource.indexOf("async function pollUnreadForSound("), appSource.indexOf("// ข้อความจาก sw.js"));
  assert.match(poll, /syncPushPauseIfStale\(\)/);
  assert.doesNotMatch(poll, /app_push_pause|loadPushPause|syncPushPause\(/);
  // เสียงของ release ตอนออกจากระบบยังอยู่
  assert.match(appSource, /releasePushOnThisDevice\(\{ server: true \}\)/);
});

test("the prompt is not shown while the person is paused", () => {
  assert.match(buildPrompt().html, /id="push-prompt"/);
  assert.equal(buildPrompt({ paused: true }).html, "");
  assert.equal(buildPrompt({ paused: true, environment: { permission: "denied" } }).html, "");
});
