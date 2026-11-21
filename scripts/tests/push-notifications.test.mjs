import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
function buildPrompt({ sandbox = false, labOnly = false, path = "dashboard", environment = {}, cache = { owner: null, value: null } } = {}) {
  const checks = [];
  const context = vm.createContext({
    state: { employee: { id: "e" } }, isSandboxMode: () => sandbox, isLabOnly: () => labOnly, currentRoute: () => ({ path }),
    pushEnvironment: () => ({ ...ready, permission: "default", ios: false, standalone: false, ...environment }),
    pushSubscribedCache: cache, verifyPushPrompt: () => checks.push("check"), window: { MNP_PUSH: require("../../modules/push-notifications.js") },
  });
  vm.runInContext(extractFunction("function pushNotice("), context);
  vm.runInContext(extractFunction("function pushPromptHtml("), context);
  return { html: vm.runInContext("pushPromptHtml", context)(), checks };
}

test("the prompt has the enable button only and no way to dismiss it", () => {
  const { html } = buildPrompt();
  assert.match(html, /id="push-prompt"/);
  assert.match(html, /กรุณาเปิดแจ้งเตือนบนเครื่องนี้/);
  assert.match(html, /เพื่อรับแจ้งงานที่รอคุณ/);
  assert.equal(html.match(/<button/g).length, 1);
  assert.match(html, /data-push-prompt-enable/);
  assert.doesNotMatch(html, /ไว้ทีหลัง|data-push-prompt-later/);
  assert.doesNotMatch(appSource, /PUSH_PROMPT_SNOOZE|mnp-push-prompt-snooze|parseSnoozedUntil|data-push-prompt-later/);
});

test("the prompt is skipped in test mode, lab-only accounts and on the notifications page", () => {
  assert.equal(buildPrompt({ sandbox: true }).html, "");
  assert.equal(buildPrompt({ labOnly: true }).html, "");
  assert.equal(buildPrompt({ path: "notifications" }).html, "");
});

test("a blocked browser and an uninstalled iPhone get a message with no button, using the panel wording", () => {
  const denied = buildPrompt({ environment: { permission: "denied" } }).html;
  assert.match(denied, /เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้/);
  assert.doesNotMatch(denied, /<button/);
  const deniedIos = buildPrompt({ environment: { permission: "denied", ios: true, standalone: true } }).html;
  assert.match(deniedIos, /ตั้งค่า › แจ้งเตือน › MNP/);
  const install = buildPrompt({ environment: { ios: true, standalone: false } }).html;
  assert.match(install, /เพิ่ม MNP ลงหน้าจอโฮมจาก Safari ก่อน/);
  assert.doesNotMatch(install, /<button/);
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
