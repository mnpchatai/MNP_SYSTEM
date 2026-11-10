// บัญชี master: ตัวจับข้อผิดพลาด (modules/client-error-log.js) ป้ายและการจัดรูปบันทึกกิจกรรม (modules/master-model.js)
// และการลงทะเบียนหน้า #/master (modules/module-master.js) — ฐานข้อมูลทดสอบที่ supabase/tests/database/master_account.test.sql
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const errorLog = require("../../modules/client-error-log.js");
const model = require("../../modules/master-model.js");
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("secrets and tokens are removed before an error leaves the browser", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
  assert.equal(errorLog.scrub(`failed ${jwt}`, 200), "failed [token]");
  assert.equal(errorLog.scrub("password=hunter22 next", 200), "password=[ซ่อน] next");
  assert.equal(errorLog.scrub('{"token": "abc123"}', 200), '{"token": "[ซ่อน]"}');
  assert.equal(errorLog.scrub(`key ${"a".repeat(48)}`, 200), "key […]");
  assert.equal(errorLog.scrub("x".repeat(30), 10).length, 10, "long text is cut to the limit");
});

test("only the route name of the page is sent, never its query string", () => {
  assert.equal(errorLog.pageOf("#/setup-password?token=secret-value"), "setup-password");
  assert.equal(errorLog.pageOf("#/request?id=123"), "request");
  assert.equal(errorLog.pageOf(""), "home");
});

test("errors are classified as database, network, code or shown-to-user problems", () => {
  assert.deepEqual(
    { ...errorLog.describe({ message: "MASTER_PROTECTED", code: "42501" }), detail: undefined },
    { kind: "rpc", code: "MASTER_PROTECTED", message: "MASTER_PROTECTED", detail: undefined },
  );
  assert.equal(errorLog.describe({ message: "x", code: "PGRST202" }).code, "PGRST202");
  assert.equal(errorLog.describe(new TypeError("Failed to fetch")).kind, "network");
  assert.equal(errorLog.describe("กรอกหัวข้อก่อน").kind, "ui");
  assert.equal(errorLog.describe(new Error("boom"), "js").kind, "js");
  assert.match(errorLog.describe(new Error("boom")).detail, /boom/, "the first lines of the stack go into the detail");
  assert.equal(errorLog.describe({ reason: { message: "NCR_LOCKED" } }).code, "NCR_LOCKED", "a rejection reason is unwrapped");
});

test("the reporter skips repeats, noise and anything over its quota", () => {
  const sent = [];
  let clock = 0;
  const report = errorLog.createReporter({ send: (payload) => sent.push(payload), now: () => clock, page: () => "dashboard" });
  assert.ok(report(new Error("one")));
  assert.equal(report(new Error("one")), null, "the same error on the same page within a minute is sent once");
  clock += errorLog.DEDUPE_MS;
  assert.ok(report(new Error("one")), "it is sent again after a minute");
  assert.equal(report("Script error."), null);
  assert.equal(report(new Error("กำลังเตรียมรูป กรุณารอสักครู่")), null, "waiting for a picked photo to be prepared is not an error");
  assert.equal(report(""), null);
  for (let index = 0; index < 40; index += 1) report(new Error(`error ${index}`));
  assert.equal(sent.length, errorLog.MAX_PER_WINDOW, "at most MAX_PER_WINDOW reports in ten minutes");
  clock += 10 * 60 * 1000;
  assert.ok(report(new Error("later")), "the quota frees up after ten minutes");
  assert.equal(sent.at(-1).page, "dashboard");
});

test("a failing send never throws into the page", () => {
  const report = errorLog.createReporter({ send: () => { throw new Error("offline"); } });
  assert.doesNotThrow(() => report(new Error("x")));
  const rejecting = errorLog.createReporter({ send: () => Promise.reject(new Error("offline")) });
  assert.doesNotThrow(() => rejecting(new Error("y")));
});

test("an update lists only the changed fields, and a status change leads the summary", () => {
  const changes = { status: { old: "pending_approval", new: "approved" }, title: { old: "a", new: "b" } };
  assert.deepEqual(model.changeLines("UPDATE", changes), [
    { field: "status", from: "pending_approval", to: "approved" },
    { field: "title", from: "a", to: "b" },
  ]);
  assert.equal(model.changeSummary("UPDATE", changes), "สถานะ pending_approval → approved");
  assert.equal(model.changeSummary("UPDATE", { title: { old: "a", new: "b" } }), "เปลี่ยน 1 ฟิลด์: title");
  assert.equal(model.changeSummary("UPDATE", {}), "ไม่มีฟิลด์ที่เปลี่ยน");
  assert.deepEqual(model.changeLines("SANDBOX_ENTER", { persona_employee_no: "P1" }), [{ field: "persona_employee_no", value: "P1" }]);
  assert.deepEqual(model.changeLines("UPDATE", null), []);
  assert.equal(model.formatValue(null), "—");
  assert.equal(model.formatValue({ a: 1 }), '{"a":1}');
  assert.equal(model.formatValue("x".repeat(300)).length, 160);
});

test("labels fall back to the raw code, and only plain dates filter the log", () => {
  assert.equal(model.entityLabel("requests"), "คำร้อง");
  assert.equal(model.entityLabel("unknown_table"), "unknown_table");
  assert.equal(model.actionLabel("REVEAL_CREDENTIAL"), "เปิดดูรหัสผ่าน");
  assert.equal(model.errorKindLabel("rpc"), "ฐานข้อมูลปฏิเสธ");
  assert.equal(model.validDate("2026-11-13"), "2026-11-13");
  for (const value of ["2026-11-13'; drop", "13/11/2026", "", null]) assert.equal(model.validDate(value), null);
});

test("company-wide pending work filters by type and by who has to act, including work nobody holds", () => {
  const rows = [
    { item_type: "request", item_id: "r1", holders: [{ id: "e1", employee_no: "E001", name: "A" }, { id: "e2", employee_no: "E002", name: "B" }] },
    { item_type: "request", item_id: "r2", holders: [{ id: "e1", employee_no: "E001", name: "A" }] },
    { item_type: "ncr", item_id: "n1", holders: [] },
    { item_type: "ncr", item_id: "n2", holders: null },
  ];
  assert.deepEqual(model.filterPending(rows, { type: "ncr" }).map((row) => row.item_id), ["n1", "n2"]);
  assert.deepEqual(model.filterPending(rows, { holder: "e2" }).map((row) => row.item_id), ["r1"]);
  assert.deepEqual(model.filterPending(rows, { holder: model.NO_HOLDER }).map((row) => row.item_id), ["n1", "n2"]);
  assert.equal(model.filterPending(rows).length, 4);
  assert.deepEqual(model.holderOptions(rows).map((option) => [option.id, option.count]), [[model.NO_HOLDER, 2], ["e1", 2], ["e2", 1]],
    "nobody-responsible first, then people with the most work");
  assert.deepEqual(model.holderOptions(rows.slice(0, 2)).map((option) => option.id), ["e1", "e2"], "no nobody-responsible option when every item has a holder");
  assert.equal(model.daysLabel(0), "วันนี้");
  assert.equal(model.daysLabel(12), "12 วัน");
  assert.equal(model.isOverdue("2026-11-01", "2026-11-09"), true);
  assert.equal(model.isOverdue("2026-11-09", "2026-11-09"), false);
  assert.equal(model.isOverdue(null, "2026-11-09"), false);
});

test("the master page is a standalone module whose menu shows only for the master", () => {
  const window = { MNP_MASTER_MODEL: model, MNP_UI_ICONS: { icon: (name) => `<svg data-icon="${name}"></svg>` } };
  vm.runInNewContext(read("modules/module-master.js"), { window });
  const entry = window.MNP_REQUEST_MODULES.MASTER;
  assert.equal(entry.standalone, true);
  assert.notEqual(entry.sandbox, true, "hidden in test mode, where the signed-in person is a persona");
  assert.equal(entry.navAllowed({ isMaster: true }), true);
  for (const employee of [{ isMaster: false }, { role: { code: "admin" } }, null]) assert.equal(entry.navAllowed(employee), false);
  assert.equal(typeof entry.pages.master, "function");
});

test("index.html loads the new modules and app.js reports every error the user sees", () => {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script defer src="\.\/([^"?]+)/g)].map((match) => match[1]);
  assert.equal(scripts[1], "modules/client-error-log.js", "the error log loads early, right after the icons");
  assert.ok(scripts.indexOf("modules/master-model.js") < scripts.indexOf("modules/module-master.js"));
  assert.ok(scripts.indexOf("modules/module-master.js") < scripts.indexOf("app.js"));
  const app = read("app.js");
  assert.match(app, /function friendlyError\(error\) \{\r?\n[^\n]*\r?\n[^\n]*\r?\n\s*window\.MNP_ERROR_LOG\?\.report\(error\);/);
  assert.match(app, /MASTER_PROTECTED: "/);
});

test("the master's home queue holds every pending approval step even with an acting role, but bulk approval stays own steps only", () => {
  const app = read("app.js");
  const body = app.slice(app.indexOf("async function getPendingApprovals()"), app.indexOf("const MY_REPAIR_ACTION_STATUSES"));
  assert.match(body, /employee\.role\?\.code === "admin" && \(!employee\.acting_role_id \|\| employee\.isMaster === true\)\) return true;/);
  const own = app.slice(app.indexOf("function isOwnApprovalStep(step)"), app.indexOf("const BULK_APPROVE_LIMIT"));
  assert.doesNotMatch(own, /isMaster|role\?\.code === "admin"/, "the master does not bulk-approve other people's steps");
});
