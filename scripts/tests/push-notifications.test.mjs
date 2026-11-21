import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { pushPanelState, urlBase64ToUint8Array, subscriptionRecord, sameApplicationServerKey, shouldShowPushPrompt, parseSnoozedUntil, PUSH_PROMPT_SNOOZE_MS } = require("../../modules/push-notifications.js");
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

// ---------- แถบชวนเปิดแจ้งเตือน (shouldShowPushPrompt) ----------
test("the prompt shows only for a capable device that has never answered the permission request", () => {
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "default" }), true);
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "granted", subscribed: true }), false);
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "granted", subscribed: false }), false);
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "denied" }), false);
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "default", hasPushManager: false }), false);
  assert.equal(shouldShowPushPrompt({ ...ready, keyConfigured: false, permission: "default" }), false);
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "default", ios: true, standalone: false }), false);
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "default", ios: true, standalone: true }), true);
  assert.equal(shouldShowPushPrompt({ ...ready, permission: "default", hasPushManager: false, ios: true, standalone: true }), false);
});

test("snoozing hides the prompt for 7 days and then it returns", () => {
  const environment = { ...ready, permission: "default" };
  const now = Date.UTC(2026, 10, 21);
  assert.equal(PUSH_PROMPT_SNOOZE_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(shouldShowPushPrompt(environment, { snoozedUntil: now + PUSH_PROMPT_SNOOZE_MS, now }), false);
  assert.equal(shouldShowPushPrompt(environment, { snoozedUntil: now + PUSH_PROMPT_SNOOZE_MS, now: now + PUSH_PROMPT_SNOOZE_MS - 1 }), false);
  assert.equal(shouldShowPushPrompt(environment, { snoozedUntil: now + PUSH_PROMPT_SNOOZE_MS, now: now + PUSH_PROMPT_SNOOZE_MS }), true);
});

test("a missing or corrupt snooze value counts as not snoozed", () => {
  assert.equal(parseSnoozedUntil(null), 0);
  assert.equal(parseSnoozedUntil(""), 0);
  assert.equal(parseSnoozedUntil("abc"), 0);
  assert.equal(parseSnoozedUntil("-5"), 0);
  assert.equal(parseSnoozedUntil("1790000000000"), 1790000000000);
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

test("the prompt markup is skipped in test mode, lab-only accounts and on the notifications page", () => {
  const build = ({ sandbox = false, labOnly = false, path = "dashboard", show = true } = {}) => {
    const context = vm.createContext({
      state: { employee: { id: "e" } }, isSandboxMode: () => sandbox, isLabOnly: () => labOnly, currentRoute: () => ({ path }), pushEnvironment: () => ({}),
      localStorage: { getItem: () => null }, PUSH_PROMPT_SNOOZE_KEY: "k", window: { MNP_PUSH: { parseSnoozedUntil: () => 0, shouldShowPushPrompt: () => show } },
    });
    vm.runInContext(extractFunction("function pushPromptHtml("), context);
    return vm.runInContext("pushPromptHtml", context)();
  };
  const shown = build();
  assert.match(shown, /id="push-prompt"/);
  assert.match(shown, /data-push-prompt-enable/);
  assert.match(shown, /data-push-prompt-later/);
  assert.equal(build({ sandbox: true }), "");
  assert.equal(build({ labOnly: true }), "");
  assert.equal(build({ path: "notifications" }), "");
  assert.equal(build({ show: false }), "");
});
