// ลิงก์ของแจ้งเตือนใบขอสิทธิ์ IT (action_url = /office/access/<uuid>) ต้องพาไปหน้ารายละเอียดใบเดียวกันทั้ง 3 ช่องทาง
//   กระดิ่งในเว็บ (app.js notificationHref) · อีเมล (notify-email linkFor) · Web Push (notify-push pushUrlFor)
// และตัวกรองแผนกฝั่งหน้าเว็บ (department-access.js) · ฝั่งฐานข้อมูล (ผู้รับ ข้อความ action_url) ทดสอบใน supabase/tests/database/itar_notify.test.sql
// ลำดับ prefix: /office/access/ ต้องไม่ชนกับเส้นทางของใบแจ้งซ่อม (/office/repair/) ใบสั่งงาน (/office/work-order/) และทะเบียนสิทธิ์ (?module=access ไม่มี action_url)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const departmentAccess = require("../../modules/department-access.js");
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").split("\r\n").join("\n");
const plain = (value) => JSON.parse(JSON.stringify(value));

const ORDER_ID = "2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10";
const ACTION_URL = `/office/access/${ORDER_ID}`;
const DETAIL_HASH = `#/office?module=access-request&view=order&id=${ORDER_ID}`;

// ตัดฟังก์ชันระดับบนสุดออกจากไฟล์ทั้งไฟล์ (จบที่ "}" ตัวแรกที่ขึ้นต้นบรรทัด)
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
}

test("bell: the access request notification opens the order detail page, and the other office links are unchanged", () => {
  const context = vm.createContext({ encodeURIComponent, Array });
  vm.runInContext(extractFunction(read("app.js"), "function notificationHref("), context);
  const href = (item) => vm.runInContext("notificationHref", context)(item);
  assert.equal(href({ request_id: null, action_url: ACTION_URL, kind: "event", digest: null }), DETAIL_HASH);
  assert.equal(href({ request_id: null, action_url: "/office/access/a b/1" }), "#/office?module=access-request&view=order&id=a%20b%2F1", "the id is URL-encoded");
  // ของเดิมต้องไม่เปลี่ยน
  assert.equal(href({ action_url: `/office/repair/${ORDER_ID}` }), `#/office?module=repair&view=order&id=${ORDER_ID}`);
  assert.equal(href({ action_url: "/office/work-order/x" }), "#/office?module=work-order&view=order&id=x");
  assert.equal(href({ request_id: "r1" }), "#/request?id=r1");
  assert.equal(href({ action_url: "/ncr/n1" }), "#/ncr?id=n1");
  assert.equal(href({ action_url: "/office/other" }), null, "an unknown office path still has no link");
  assert.equal(href({ action_url: "/office/accessories/x" }), null, "only the exact /office/access/ prefix counts");
});

test("bell: an access request notification uses the lock icon and the IT colour", () => {
  const app = read("app.js");
  assert.match(app, /href\?\.startsWith\("#\/office\?module=access-request"\) \? "IT_ACCESS_REQUEST"/);
  // IT_ACCESS_REQUEST ไม่มีโมดูลคำร้องกลางและไม่อยู่ใน requestTypePalettes → จานสีตกกลับเป็น "it" (สีเดียวกับเดิม)
  assert.match(app, /requestTypePalettes\[code\] \?\? "it"/);
  assert.match(app, /const NOTIFICATION_TYPE_BY_PREFIX = Object\.freeze\(\{ MT: "MT_REPAIR", MG: "MANAGEMENT", IT: "IT_REPAIR" \}\);/);
});

test("push: the access request notification opens the order detail page (relative hash route)", () => {
  const output = ts.transpileModule(read("supabase/functions/notify-push/payload.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, URL, encodeURIComponent, Array, String });
  const row = (overrides = {}) => ({ request_id: null, action_url: null, kind: "event", digest: null, ...overrides });
  assert.equal(exports.pushUrlFor(row({ action_url: ACTION_URL })), DETAIL_HASH);
  assert.equal(exports.pushUrlFor(row({ action_url: "/office/access/a b/1" })), "#/office?module=access-request&view=order&id=a%20b%2F1");
  assert.ok(exports.pushUrlFor(row({ action_url: ACTION_URL })).startsWith("#/"), "never an absolute URL or path");
  assert.equal(exports.pushUrlFor(row({ action_url: `/office/repair/${ORDER_ID}` })), `#/office?module=repair&view=order&id=${ORDER_ID}`, "the repair link is unchanged");
  assert.equal(exports.pushUrlFor(row({ action_url: "/ncr/abc" })), "#/ncr?id=abc", "existing routes are unchanged");
  assert.equal(exports.pushUrlFor(row({ action_url: "/office/other" })), "#/notifications");
});

test("email: the access request notification links to the order detail page on the app host", () => {
  const source = extractFunction(read("supabase/functions/notify-email/index.ts"), "function linkFor(");
  const output = ts.transpileModule(`type PendingNotification = { request_id: string | null; action_url: string | null };\n${source}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ encodeURIComponent, appBaseUrl: () => "https://example.test/app" });
  vm.runInContext(`${output}\nglobalThis.linkFor = linkFor;`, context);
  const link = (row) => plain(vm.runInContext("linkFor", context)(row));
  assert.equal(link({ request_id: null, action_url: ACTION_URL }), `https://example.test/app/${DETAIL_HASH}`);
  assert.equal(link({ request_id: null, action_url: "/office/access/a b/1" }), "https://example.test/app/#/office?module=access-request&view=order&id=a%20b%2F1");
  assert.equal(link({ request_id: null, action_url: `/office/repair/${ORDER_ID}` }), `https://example.test/app/#/office?module=repair&view=order&id=${ORDER_ID}`, "the repair link is unchanged");
  assert.equal(link({ request_id: "r1", action_url: null }), "https://example.test/app/#/request?id=r1", "existing links are unchanged");
  assert.equal(link({ request_id: null, action_url: "/office/other" }), "https://example.test/app/#/notifications");
});

test("the three link rules and the database use the same action_url prefix and hash route", () => {
  const prefix = "/office/access/";
  assert.ok(read("supabase/migrations/20270107010000_itar_access_requests.sql").includes(`'${prefix}'`), "migration builds the action_url");
  for (const file of ["app.js", "supabase/functions/notify-email/index.ts", "supabase/functions/notify-push/payload.ts"]) {
    const source = read(file);
    assert.ok(source.includes(`"${prefix}"`), `${file} recognises the prefix`);
    assert.ok(source.includes("#/office?module=access-request&view=order&id="), `${file} builds the detail hash`);
  }
  // หน้าใบขอสิทธิ์อ่านพารามิเตอร์ชุดเดียวกัน และ url ที่ model สร้างตรงกับ hash ที่ลิงก์ใช้
  assert.ok(read("modules/module-itar.js").includes('view === "order"'), "the access request page has the order view");
  const model = require("../../modules/itar-model.js");
  assert.equal(model.accessUrl("order", { id: ORDER_ID }), DETAIL_HASH);
});

test("department filter: the access request link follows the IT_ACCESS_REQUEST module, so department ID does not see it", () => {
  const id = { department: { code: "ID" } };
  const other = { department: { code: "MT" } };
  const item = { action_url: ACTION_URL, request_id: null };
  assert.equal(departmentAccess.notificationAllowed(other, item, () => null), true, "an unrestricted department sees it");
  assert.equal(departmentAccess.notificationAllowed(id, item, () => null), false, "department ID is limited to repair modules and does not have IT_ACCESS_REQUEST");
  assert.equal(departmentAccess.notificationAllowed(id, { action_url: `/office/repair/${ORDER_ID}`, request_id: null }, () => null), true, "the repair link is still allowed for ID");
  assert.equal(departmentAccess.moduleAllowed(id, "IT_ACCESS_REQUEST"), false);
  assert.equal(departmentAccess.moduleAllowed(other, "IT_ACCESS_REQUEST"), true);
});
