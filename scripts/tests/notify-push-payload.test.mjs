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

test("pause digest push: fixed Thai wording, count only, goes to the notifications page, one tag per employee per Thai day", () => {
  const morning = new Date("2026-11-22T00:00:30Z"); // 07:00:30 น. ของ 22/11 เวลาไทย
  const payload = plain(exports.pauseDigestPayload("emp-1", 3, morning));
  assert.deepEqual(payload, {
    title: "แจ้งเตือนที่คุณพลาดระหว่างพัก",
    body: "คุณมี 3 แจ้งเตือนที่ยังไม่ได้อ่าน",
    url: "#/notifications",
    tag: "pause-digest-emp-1-20261122",
  });
  // ส่งซ้ำวันเดียวกัน = tag เดิม (ทับกัน) · วันถัดไป = tag ใหม่ (ไม่ทับสรุปเมื่อวานที่ยังค้างในถาด จึงเด้งพร้อมเสียง)
  assert.equal(exports.pauseDigestPayload("emp-1", 3, new Date("2026-11-22T03:00:00Z")).tag, payload.tag);
  assert.notEqual(exports.pauseDigestPayload("emp-1", 3, new Date("2026-11-23T00:00:30Z")).tag, payload.tag);
  // วันที่ใช้เวลาไทย: 22/11 17:00 UTC = 23/11 00:00 น. ไทย
  assert.equal(exports.pauseDigestPayload("emp-1", 3, new Date("2026-11-22T17:00:00Z")).tag, "pause-digest-emp-1-20261123");
  assert.equal(exports.pauseDigestPayload("emp-1", 3, new Date("2026-11-22T16:59:59Z")).tag, "pause-digest-emp-1-20261122");
  assert.ok(payload.tag.startsWith("pause-digest-"), "the page recognises the digest by this prefix");
  assert.ok(payload.url.startsWith("#/"), "relative hash route like every other push");
  assert.equal(plain(exports.pauseDigestPayload("emp-1", 12.9)).body, "คุณมี 12 แจ้งเตือนที่ยังไม่ได้อ่าน");
  assert.equal(plain(exports.pauseDigestPayload("emp-1", Number.NaN)).body, "คุณมี 0 แจ้งเตือนที่ยังไม่ได้อ่าน");
  assert.equal(plain(exports.pauseDigestPayload("emp-1", -4)).body, "คุณมี 0 แจ้งเตือนที่ยังไม่ได้อ่าน");
  assert.notEqual(exports.pauseDigestPayload("emp-1", 1).tag, exports.pauseDigestPayload("emp-2", 1).tag);
});

test("pause lookup is fail-open: a failed query means nobody is paused this round, with one warning", () => {
  const now = Date.parse("2026-11-22T10:00:00Z");
  const run = (result) => {
    const warnings = [];
    const paused = [...exports.pausedEmployeeSet(result, now, (message) => warnings.push(message))];
    return { paused, warnings };
  };
  const ok = run({ data: [
    { employee_id: "a", paused_until: "2026-11-23T00:00:00Z" },
    { employee_id: "b", paused_until: "2026-11-22T09:00:00Z" },
  ], error: null });
  assert.deepEqual(ok.paused, ["a"]);
  assert.equal(ok.warnings.length, 0);
  assert.deepEqual(run({ data: null, error: null }).paused, []);
  for (const code of ["PGRST205", "42P01", "57014", "PGRST301", undefined]) {
    const failed = run({ data: null, error: { code } });
    assert.deepEqual(failed.paused, [], String(code));
    assert.equal(failed.warnings.length, 1, "one warning per round");
    assert.ok(!failed.warnings[0].includes("employee"), "no personal data in the log");
  }
  assert.match(run({ data: null, error: { code: "PGRST205" } }).warnings[0], /not found/);
  assert.match(run({ data: null, error: { code: "57014" } }).warnings[0], /lookup failed/);
});

test("a recipient counts as paused only while paused_until is in the future", () => {
  const now = Date.parse("2026-11-22T10:00:00Z");
  assert.equal(exports.isPausedAt("2026-11-23T00:00:00+00:00", now), true);
  assert.equal(exports.isPausedAt("2026-11-22T10:00:00Z", now), false, "ends exactly now: not paused");
  assert.equal(exports.isPausedAt("2026-11-22T09:59:59Z", now), false);
  assert.equal(exports.isPausedAt(null, now), false);
  assert.equal(exports.isPausedAt(undefined, now), false);
  assert.equal(exports.isPausedAt("not a date", now), false);
  assert.equal(exports.PAUSED_ERROR, "PAUSED");
});

// ผูกโค้ดของ Edge Function กับ SQL: รหัส PAUSED เดียวกับที่ฐานข้อมูลใช้นับ "แจ้งเตือนที่พลาด" และลำดับการตรวจในตัวส่ง
test("notify-push wiring: PAUSED code matches the migration, checked after NO_SUBSCRIPTION, digest mode is opt-in", () => {
  const index = readFileSync(new URL("../../supabase/functions/notify-push/index.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20261210010000_push_pause.sql", import.meta.url), "utf8");
  assert.match(migration, /n\.push_error = 'PAUSED'/);
  const noSubscription = index.indexOf('"NO_SUBSCRIPTION"');
  const paused = index.indexOf("settle(row, \"skipped\", PAUSED_ERROR)");
  const send = index.indexOf("deliverToSubscriptions(admin, subscriptions, payload");
  assert.ok(noSubscription > 0 && paused > noSubscription && send > paused, "paused recipients are skipped before any device is called");
  assert.match(index, /mode === "pause-digest" \? await drainPauseDigests\(admin\) : await drainQueue\(admin\)/);
  assert.match(index, /app_claim_push_pause_digests/);
  // lookup การพักล้มต้องไม่ throw (fail-open) · lookup ของ employees/push_subscriptions ยัง throw ตามเดิม
  assert.match(index, /pausedEmployeeSet\(pausesResult, Date\.now\(\), \(message\) => console\.warn\(message\)\)/);
  assert.match(index, /if \(employeesResult\.error \|\| subscriptionsResult\.error\) throw new Error\("LOOKUP_FAILED"\)/);
  assert.ok(!/pausesResult\.error/.test(index), "a failed pause lookup never aborts the round");
  assert.match(migration, /body := '\{"mode":"pause-digest"\}'/);
});
