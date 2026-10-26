import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../../supabase/functions/notify-push/payload.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(output, { exports, URL, encodeURIComponent, Array, String });
const { pushUrlFor, pushTitle, isAllowedPushEndpoint } = exports;
// ผลลัพธ์ที่สร้างใน vm มี prototype ของอีก realm จึงแปลงเป็น object ธรรมดาก่อนเทียบด้วย deepEqual
const plain = (value) => JSON.parse(JSON.stringify(value));
const classifySendError = (error) => plain(exports.classifySendError(error));
const settleRow = (...args) => plain(exports.settleRow(...args));

const row = (overrides = {}) => ({ request_id: null, action_url: null, kind: "event", digest: null, ...overrides });

test("push links are relative hash routes that match the in-app bell", () => {
  assert.equal(pushUrlFor(row({ request_id: "a b/1" })), "#/request?id=a%20b%2F1");
  assert.equal(pushUrlFor(row({ action_url: "/admin" })), "#/admin");
  assert.equal(pushUrlFor(row({ action_url: "/profile" })), "#/profile");
  assert.equal(pushUrlFor(row({ action_url: "/ncr/abc" })), "#/ncr?id=abc");
  assert.equal(pushUrlFor(row({ action_url: "/", kind: "escalation", digest: [{ item_type: "request", item_id: "r1" }] })), "#/dashboard");
  assert.equal(pushUrlFor(row({ action_url: "/", kind: "reminder", digest: [{ item_type: "request", item_id: "r1" }, { item_type: "ncr", item_id: "n1" }] })), "#/dashboard");
  assert.equal(pushUrlFor(row({ action_url: "/", kind: "reminder", digest: [{ item_type: "request", item_id: "r1" }] })), "#/request?id=r1");
  assert.equal(pushUrlFor(row({ action_url: "/", kind: "reminder", digest: [{ item_type: "ncr", item_id: "n 1" }] })), "#/ncr?id=n%201");
  assert.equal(pushUrlFor(row({ action_url: "/unknown" })), "#/notifications");
  assert.equal(pushUrlFor(row()), "#/notifications");
  for (const value of [pushUrlFor(row({ request_id: "x" })), pushUrlFor(row())]) assert.ok(value.startsWith("#/"), "never an absolute URL or path");
});

test("lock screen text is the title plus the document number and nothing else", () => {
  assert.equal(pushTitle("มีใบคำร้อง รอท่านพิจารณาอนุมัติ", "MT 012/26"), "มีใบคำร้อง รอท่านพิจารณาอนุมัติ · MT 012/26");
  assert.equal(pushTitle("แจ้งเตือน", null), "แจ้งเตือน");
  assert.equal(pushTitle("MT 012/26 อนุมัติแล้ว", "MT 012/26"), "MT 012/26 อนุมัติแล้ว");
  assert.equal(pushTitle("  หลาย\n  บรรทัด ", ""), "หลาย บรรทัด");
  assert.equal(pushTitle("", null), "มีการแจ้งเตือนใหม่");
  const long = pushTitle("ก".repeat(500), "MT 1/26");
  assert.equal(long.length, 180);
  assert.ok(long.endsWith("…"));
});

test("only real browser push services are called (no SSRF through a user-supplied endpoint)", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://android.googleapis.com/gcm/send/abc",
  ]) assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://evil.example.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.example.com/x",
    "https://notfcm.googleapis.com.example/x",
    "https://evilfcm.googleapis.com/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "not a url",
    "",
  ]) assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
});

test("send errors are reduced to short codes without endpoints", () => {
  assert.deepEqual(classifySendError({ statusCode: 410, body: "https://fcm.googleapis.com/secret" }), { outcome: "gone", code: "HTTP_410" });
  assert.deepEqual(classifySendError({ statusCode: 404 }), { outcome: "gone", code: "HTTP_404" });
  assert.deepEqual(classifySendError({ statusCode: 503 }), { outcome: "transient", code: "HTTP_503" });
  assert.deepEqual(classifySendError({ statusCode: 403 }), { outcome: "transient", code: "HTTP_403" });
  assert.deepEqual(classifySendError({ code: "ECONNRESET", message: "to https://fcm.googleapis.com/x" }), { outcome: "transient", code: "NET_ECONNRESET" });
  assert.deepEqual(classifySendError(new Error("https://fcm.googleapis.com/secret")), { outcome: "transient", code: "SEND_ERROR" });
  assert.deepEqual(classifySendError(null), { outcome: "transient", code: "SEND_ERROR" });
});

test("a notification is sent when any device accepts it, retried on transient failure, failed after 3 attempts", () => {
  const sent = { outcome: "sent" };
  const gone = { outcome: "gone", code: "HTTP_410" };
  const transient = { outcome: "transient", code: "HTTP_503" };
  assert.deepEqual(settleRow([sent], 1, 3), { status: "sent", error: null });
  assert.deepEqual(settleRow([gone, transient, sent], 3, 3), { status: "sent", error: null });
  assert.deepEqual(settleRow([transient], 1, 3), { status: "pending", error: "HTTP_503" });
  assert.deepEqual(settleRow([transient], 2, 3), { status: "pending", error: "HTTP_503" });
  assert.deepEqual(settleRow([gone, transient], 3, 3), { status: "failed", error: "HTTP_503" });
  assert.deepEqual(settleRow([gone, gone], 1, 3), { status: "skipped", error: "SUBSCRIPTIONS_EXPIRED" });
});
