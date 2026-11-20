// ลิงก์ของแจ้งเตือนใบสั่งงาน IT (action_url = /office/work-order/<uuid>) ต้องพาไปหน้ารายละเอียดใบเดียวกันทั้ง 3 ช่องทาง
//   กระดิ่งในเว็บ (app.js notificationHref) · อีเมล (notify-email linkFor) · Web Push (notify-push pushUrlFor)
// ฝั่งฐานข้อมูล (ผู้รับ ข้อความ action_url) ทดสอบใน supabase/tests/database/itwo_notify.test.sql
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").split("\r\n").join("\n");
const plain = (value) => JSON.parse(JSON.stringify(value));

const ORDER_ID = "2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10";
const ACTION_URL = `/office/work-order/${ORDER_ID}`;
const DETAIL_HASH = `#/office?module=work-order&view=order&id=${ORDER_ID}`;

// ตัดฟังก์ชันระดับบนสุดออกจากไฟล์ทั้งไฟล์ (จบที่ "}" ตัวแรกที่ขึ้นต้นบรรทัด)
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
}

test("bell: the work order notification opens the order detail page", () => {
  const context = vm.createContext({ encodeURIComponent, Array });
  vm.runInContext(extractFunction(read("app.js"), "function notificationHref("), context);
  const href = (item) => vm.runInContext("notificationHref", context)(item);
  assert.equal(href({ request_id: null, action_url: ACTION_URL, kind: "event", digest: null }), DETAIL_HASH);
  assert.equal(href({ request_id: null, action_url: "/office/work-order/a b/1" }), "#/office?module=work-order&view=order&id=a%20b%2F1", "the id is URL-encoded");
  // ของเดิมต้องไม่เปลี่ยน
  assert.equal(href({ request_id: "r1" }), "#/request?id=r1");
  assert.equal(href({ action_url: "/admin" }), "#/admin");
  assert.equal(href({ action_url: "/profile" }), "#/profile");
  assert.equal(href({ action_url: "/ncr/n1" }), "#/ncr?id=n1");
  assert.equal(href({ action_url: "/", kind: "escalation", digest: [] }), "#/dashboard");
  assert.equal(href({ action_url: "/office/other" }), null, "an unknown office path still has no link");
});

test("bell: a work order notification uses the IT icon and colour", () => {
  const app = read("app.js");
  assert.match(app, /href\?\.startsWith\("#\/office\?module=work-order"\) \? "IT_REPAIR"/);
  // รหัสนำหน้าเดิมยังอยู่ครบ (เทสต์อื่นตรวจข้อความนี้ด้วย)
  assert.match(app, /const NOTIFICATION_TYPE_BY_PREFIX = Object\.freeze\(\{ MT: "MT_REPAIR", MG: "MANAGEMENT", IT: "IT_REPAIR" \}\);/);
});

test("push: the work order notification opens the order detail page (relative hash route)", () => {
  const output = ts.transpileModule(read("supabase/functions/notify-push/payload.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, URL, encodeURIComponent, Array, String });
  const row = (overrides = {}) => ({ request_id: null, action_url: null, kind: "event", digest: null, ...overrides });
  assert.equal(exports.pushUrlFor(row({ action_url: ACTION_URL })), DETAIL_HASH);
  assert.equal(exports.pushUrlFor(row({ action_url: "/office/work-order/a b/1" })), "#/office?module=work-order&view=order&id=a%20b%2F1");
  assert.ok(exports.pushUrlFor(row({ action_url: ACTION_URL })).startsWith("#/"), "never an absolute URL or path");
  assert.equal(exports.pushUrlFor(row({ action_url: "/ncr/abc" })), "#/ncr?id=abc", "existing routes are unchanged");
  assert.equal(exports.pushUrlFor(row({ action_url: "/office/other" })), "#/notifications");
});

test("email: the work order notification links to the order detail page on the app host", () => {
  const source = extractFunction(read("supabase/functions/notify-email/index.ts"), "function linkFor(");
  const output = ts.transpileModule(`type PendingNotification = { request_id: string | null; action_url: string | null };\n${source}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ encodeURIComponent, appBaseUrl: () => "https://example.test/app" });
  vm.runInContext(`${output}\nglobalThis.linkFor = linkFor;`, context);
  const link = (row) => plain(vm.runInContext("linkFor", context)(row));
  assert.equal(link({ request_id: null, action_url: ACTION_URL }), `https://example.test/app/${DETAIL_HASH}`);
  assert.equal(link({ request_id: null, action_url: "/office/work-order/a b/1" }), "https://example.test/app/#/office?module=work-order&view=order&id=a%20b%2F1");
  assert.equal(link({ request_id: "r1", action_url: null }), "https://example.test/app/#/request?id=r1", "existing links are unchanged");
  assert.equal(link({ request_id: null, action_url: "/ncr/n1" }), "https://example.test/app/#/ncr?id=n1");
  assert.equal(link({ request_id: null, action_url: "/office/other" }), "https://example.test/app/#/notifications");
});

test("the three link rules and the database use the same action_url prefix and hash route", () => {
  const prefix = "/office/work-order/";
  assert.ok(read("supabase/migrations/20261209010000_itwo_notifications.sql").includes(`'${prefix}'`), "migration builds the action_url");
  for (const file of ["app.js", "supabase/functions/notify-email/index.ts", "supabase/functions/notify-push/payload.ts"]) {
    const source = read(file);
    assert.ok(source.includes(`"${prefix}"`), `${file} recognises the prefix`);
    assert.ok(source.includes("#/office?module=work-order&view=order&id="), `${file} builds the detail hash`);
  }
  // หน้าใบสั่งงานอ่านพารามิเตอร์ชุดเดียวกัน
  assert.ok(read("modules/module-itwo.js").includes('view === "order"') || read("modules/module-itwo.js").includes("view=order"), "the work order page has the order view");
});
