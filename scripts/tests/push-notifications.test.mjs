import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { pushPanelState, urlBase64ToUint8Array, subscriptionRecord, sameApplicationServerKey } = require("../../modules/push-notifications.js");
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
