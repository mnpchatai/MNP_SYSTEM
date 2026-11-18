import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase, mockSupabaseScript } from "../pilot-harness-mock.mjs";

// BOM / RubberFlow ใช้งานจริง (20261130010000): ใครเห็นเมนูและหน้า (usesBom / usesRubberFlow ของ store) และ Supabase จำลองของ harness
// แยกข้อมูลจริงกับข้อมูลทดสอบเหมือน is_test ของฐานข้อมูล · นอกโหมดทดสอบผู้ทำรายการคือผู้ใช้จำลองเอง (?real=<รหัส> เลือกแผนก/ตำแหน่ง)
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_BOM_ACTIONS = require("../../modules/bom-actions.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
const bomStore = require("../../modules/bom-store.js");
const rfStore = require("../../modules/rubberflow-store.js");

const NOW = Date.parse("2026-11-18T10:00:00+07:00");
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const employee = (dept, role = "staff", extra = {}) => ({ id: `e-${dept}-${role}`, first_name: "ทดลอง", last_name: dept, role: { code: role }, department: { code: dept }, ...extra });
const item = (code, name) => ({ code, kind: "FG", name, ownerDept: "PK", uom: "set", weightG: 0, legacyCodes: [], active: true });
const material = (code, name) => ({ code, name, category: "โพลิเมอร์", storage: "โกดัง A-1", uom: "kg", active: true });

test("until the owner opens BOM / RubberFlow to staff, real use shows them only to the admin; every persona keeps them in test mode", () => {
  // ผู้ใช้สั่ง 2026-11-18: เห็นเฉพาะ admin (REAL_STAFF_OPEN = false ใน bom-store.js และ rubberflow-store.js)
  assert.equal(bomStore.usesBom(employee("MT", "admin")), true, "the admin sees BOM in real use");
  assert.equal(rfStore.usesRubberFlow(employee("MT", "admin")), true, "the admin sees RubberFlow in real use");
  for (const dept of ["PP", "RB", "GR", "PT", "BG", "PK", "ST", "WH", "QA", "SR", "MT", ""]) {
    for (const role of ["staff", "department_manager"]) {
      assert.equal(bomStore.usesBom(employee(dept, role)), false, `real ${dept || "no-department"} ${role} does not see BOM yet`);
      assert.equal(rfStore.usesRubberFlow(employee(dept, role)), false, `real ${dept || "no-department"} ${role} does not see RubberFlow yet`);
    }
  }
  for (const role of ["assistant_factory_manager", "factory_manager", "general_manager"]) {
    assert.equal(bomStore.usesBom(employee("MT", role)), false, `a real ${role} does not see BOM yet`);
    assert.equal(rfStore.usesRubberFlow(employee("MT", role)), false, `a real ${role} does not see RubberFlow yet`);
  }
  assert.equal(bomStore.usesBom(employee("QA", "staff", { isSandbox: true })), true, "every persona keeps BOM in test mode");
  assert.equal(rfStore.usesRubberFlow(employee("GR", "staff", { isSandbox: true })), true, "every persona keeps RubberFlow in test mode");
  assert.equal(bomStore.usesBom(null), false);
  assert.equal(rfStore.usesRubberFlow(undefined), false);
});

test("the planner group: admin, factory managers, PP, and department managers of production departments only", () => {
  for (const role of ["admin", "assistant_factory_manager", "factory_manager", "general_manager"]) assert.equal(bomStore.isPlanner(employee("MT", role)), true, `${role} is a planner`);
  for (const dept of ["HR", "IT", "MT", "ACC", "ID"]) assert.equal(bomStore.isPlanner(employee(dept, "department_manager")), false, `a ${dept} department manager is not a planner`);
  for (const dept of bomStore.PRODUCTION_DEPTS) assert.equal(bomStore.isPlanner(employee(dept, "department_manager")), true, `a ${dept} department manager is a planner`);
  assert.equal(bomStore.isPlanner(employee("PP")), true, "PP staff are planners");
  assert.equal(bomStore.isPlanner(employee("RB", "assistant_department_manager")), false, "an assistant department manager is not a planner (as before)");
  assert.equal(bomStore.personaUser(employee("MT", "department_manager")).role, "viewer", "an MT department manager gets no BOM role");
  assert.equal(bomStore.personaUser(employee("RB")).role, "rb", "a real RB employee gets the RB role, like the persona");
  assert.equal(rfStore.personaUser(employee("IT", "department_manager")).planner, false, "an IT department manager is not a RubberFlow planner");
  assert.equal(rfStore.personaUser(employee("GR", "department_manager")).planner, true);
  assert.equal(rfStore.personaUser(employee("RB", "department_manager")).rbHead, true, "a real RB department manager is an RB head (approves recipes), like the persona");
});

test("?real=<code> makes the harness user a real employee of that department and role; the test mode ignores it", () => {
  const { db } = createMockSupabase({ real: "whh", now: () => NOW });
  const me = db.employees[0];
  assert.equal(db.departments.find((row) => row.id === me.department_id)?.code, "WH");
  assert.equal(db.roles.find((row) => row.id === me.role_id)?.code, "department_manager");
  assert.equal(me.is_active, true);
  const plain = createMockSupabase({ real: "rb", now: () => NOW }).db;
  assert.equal(plain.departments.filter((row) => row.code === "RB").length, 1, "an existing department is reused, not added twice");
  const sandbox = createMockSupabase({ sandbox: true, real: "rb", now: () => NOW }).db;
  assert.equal(sandbox.roles.find((row) => row.id === sandbox.employees[0].role_id)?.code, "admin", "the sandbox admin stays the admin");
  assert.match(mockSupabaseScript(), /real: params\.get\("real"\)/, "the page script passes ?real= to the mock");
});

test("the harness mock keeps real and test BOM rows apart like is_test, and the real actor is the signed-in employee", async () => {
  const storage = memoryStorage();
  const sandbox = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  await sandbox.client.rpc("app_sandbox_enter", { p_persona_id: "persona-pp" });
  assert.equal((await sandbox.client.rpc("app_bom_save_master", { p_changes: { items: { upsert: [item("GL-FG", "ทดสอบ")] } }, p_base_version: 0, p_action: "importFlat" })).error, null);

  const realPp = createMockSupabase({ real: "pp", now: () => NOW, storage });
  assert.deepEqual((await realPp.client.rpc("app_bom_master")).data.items, [], "real mode does not see the test item");
  assert.deepEqual((await realPp.client.rpc("app_bom_audit", {})).data, [], "nor the test-mode audit");
  assert.equal((await realPp.client.rpc("app_bom_save_master", { p_changes: { items: { upsert: [item("GL-FG", "จริง")] } }, p_base_version: 0, p_action: "importFlat" })).error, null,
    "a real PP planner writes the same code in real data");
  assert.deepEqual((await realPp.client.rpc("app_bom_master")).data.items.map((row) => row.name), ["จริง"]);
  assert.deepEqual((await realPp.client.rpc("app_bom_audit", {})).data.map((row) => row.user), ["สมศรี วางแผน"], "the real audit names the signed-in employee");
  assert.deepEqual((await sandbox.client.rpc("app_bom_master")).data.items.map((row) => row.name), ["ทดสอบ"], "test mode still reads only its own row");
  assert.ok(storage.getItem("mnp-harness-bom-master") && storage.getItem("mnp-harness-bom-master-real"), "each mode is stored under its own key");

  const realRb = createMockSupabase({ real: "rb", now: () => NOW, storage });
  assert.deepEqual((await realRb.client.rpc("app_bom_master")).data.items.map((row) => row.name), ["จริง"], "another real employee reads the same real data");
  assert.equal((await realRb.client.rpc("app_bom_save_master", { p_changes: { items: { upsert: [item("GL-X", "x")] } }, p_base_version: 1, p_action: "importFlat" })).error.code, "BOM_FORBIDDEN",
    "a real RB staff cannot edit the item master");

  const inactive = createMockSupabase({ real: "pp", now: () => NOW, storage });
  inactive.db.employees[0].is_active = false;
  assert.equal((await inactive.client.rpc("app_bom_master")).error.code, "BOM_FORBIDDEN", "an inactive employee is refused");
  assert.equal((await inactive.client.rpc("app_rf_master")).error.code, "RF_FORBIDDEN");
});

test("the harness mock keeps real and test RubberFlow rows apart, and the purge stays with the admin in test mode", async () => {
  const storage = memoryStorage();
  const sandbox = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  await sandbox.client.rpc("app_sandbox_enter", { p_persona_id: "persona-pp" });
  assert.equal((await sandbox.client.rpc("app_rf_save", { p_changes: { materials: { upsert: [material("GL-MAT", "ทดสอบ")] } }, p_base_version: 0, p_action: "saveMaterial" })).error, null);

  const realPp = createMockSupabase({ real: "pp", now: () => NOW, storage });
  assert.deepEqual((await realPp.client.rpc("app_rf_master")).data.materials, [], "real RubberFlow does not see the test material");
  assert.equal((await realPp.client.rpc("app_rf_save", { p_changes: { materials: { upsert: [material("GL-MAT", "จริง")] } }, p_base_version: 0, p_action: "saveMaterial" })).error, null,
    "a real PP planner adds the same material code in real data");
  const realGr = createMockSupabase({ real: "gr", now: () => NOW, storage });
  assert.equal((await realGr.client.rpc("app_rf_save", { p_changes: { materials: { upsert: [material("GL-MAT-2", "x")] } }, p_base_version: 1, p_action: "saveMaterial" })).error.code, "RF_FORBIDDEN",
    "a real GR staff cannot add a RubberFlow material");

  assert.equal((await realPp.client.rpc("app_sandbox_purge_rf")).error.code, "NOT_AUTHORIZED", "a real planner cannot purge");
  assert.equal((await realPp.client.rpc("app_sandbox_purge_bom")).error.code, "NOT_AUTHORIZED");
  const realAdmin = createMockSupabase({ master: true, now: () => NOW, storage });
  assert.equal((await realAdmin.client.rpc("app_sandbox_purge_rf")).error.code, "SANDBOX_NOT_ACTIVE", "an admin outside test mode cannot purge real data");
  assert.equal((await realAdmin.client.rpc("app_sandbox_purge_bom")).error.code, "SANDBOX_NOT_ACTIVE");
  assert.equal((await sandbox.client.rpc("app_sandbox_purge_rf")).data.deleted, 1, "the admin in test mode purges the test material only");
  const after = createMockSupabase({ real: "rb", now: () => NOW, storage });
  assert.deepEqual((await after.client.rpc("app_rf_master")).data.materials.map((row) => row.name), ["จริง"], "the real material survives the purge");
});
