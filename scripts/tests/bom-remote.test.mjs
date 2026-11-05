import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// โหมดฐานข้อมูลของ BOM (ข้อมูลหลักอยู่ใน Supabase ผ่าน app_bom_master / app_bom_save_master): store แบบ remote ใน modules/bom-store.js
// ทดสอบกับเซิร์ฟเวอร์จำลองในไฟล์นี้ (สัญญา RPC) และกับ Supabase จำลองของ harness (scripts/pilot-harness-mock.mjs) ผ่านโมดูลทั้งชุด
const require = createRequire(import.meta.url);
const rules = require("../../modules/bom-rules.js");
globalThis.MNP_BOM_RULES = rules;
const A = require("../../modules/bom-actions.js");
globalThis.MNP_BOM_ACTIONS = A;
const storeApi = require("../../modules/bom-store.js");

const NOW = Date.parse("2026-11-05T10:00:00+07:00");
const MASTER = storeApi.MASTER_LISTS;
const emptyMaster = () => ({ version: 0, ...Object.fromEntries(MASTER.map((list) => [list, []])) });
const planner = { id: "p1", role: "planner", dept: "PK", name: "ณัฐพล บุญมา" };
const viewer = { id: "v1", role: "viewer", dept: "QA", name: "ผู้ดู" };
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const failure = (code) => Object.assign(new Error(code), { code });

// เซิร์ฟเวอร์จำลองตามสัญญา: ตรวจ version (BOM_STALE) แล้ว upsert/delete ตามกุญแจ คืน snapshot ใหม่ · fail = ครั้งถัดไปล้มด้วยรหัสนี้
function fakeServer(initial = emptyMaster()) {
  const server = { master: structuredClone(initial), loads: 0, saves: [], fail: null, hold: null };
  const key = { items: (r) => r.code, compounds: (r) => r.code, colors: (r) => r.code, processes: (r) => r.code, boms: (r) => r.id, routings: (r) => r.id, colorSets: (r) => `${r.base}|${r.code}`, packages: (r) => `${r.base}|${r.code}` };
  server.remote = {
    load: async () => { server.loads += 1; return structuredClone(server.master); },
    save: async (changes, baseVersion, action) => {
      server.saves.push({ changes: structuredClone(changes), baseVersion, action });
      if (server.hold) await server.hold;
      if (server.fail) { const code = server.fail; server.fail = null; throw failure(code); }
      if (baseVersion !== server.master.version) throw failure("BOM_STALE");
      for (const [list, entry] of Object.entries(changes)) {
        for (const record of entry.upsert ?? []) {
          const at = server.master[list].findIndex((row) => key[list](row) === key[list](record));
          if (at === -1) server.master[list].push(structuredClone(record)); else server.master[list][at] = structuredClone(record);
        }
        for (const target of entry.delete ?? []) server.master[list] = server.master[list].filter((row) => !(row.base === target.base && row.code === target.code));
      }
      server.master.version += 1;
      return structuredClone(server.master);
    },
  };
  return server;
}
function remoteStore({ server = fakeServer(), storage = memoryStorage(), user = planner } = {}) {
  const events = [];
  const store = storeApi.createStore({ storage, actions: A, now: () => NOW, remote: server.remote, persona: () => user });
  store.subscribe((event) => events.push(event.type));
  return { store, server, storage, events };
}
const ready = async (env) => { await env.store.ensureLoaded(); return env; };
const saveItemPayload = (code = "P-TEST-01", extra = {}) => ({ code, kind: "PURCHASED", name: "ของซื้อทดสอบ", uom: "pcs", create: true, ...extra });

test("the persona (state.employee of the sandbox) decides the BOM role: admin, manager level, planning department PP, a producing department, else read-only", () => {
  const employee = (role, dept, extra = {}) => ({ id: "x", first_name: "สมหมาย", last_name: "ใจดี", role: { code: role }, department: { code: dept }, ...extra });
  const role = (...args) => storeApi.roleOfEmployee(employee(...args));
  assert.equal(role("admin", "MT"), "admin");
  assert.equal(role("admin", "PP"), "admin", "admin wins over the department");
  for (const code of ["department_manager", "assistant_factory_manager", "factory_manager", "general_manager"]) assert.equal(role(code, "RB"), "manager", `${code} is manager level even inside a producing department`);
  assert.equal(role("staff", "PP"), "planner");
  assert.equal(role("staff", "pp"), "planner", "department codes compare case-insensitively");
  for (const dept of ["RB", "GR", "PT", "BG", "ST"]) assert.equal(role("staff", dept), dept.toLowerCase());
  for (const dept of ["MT", "QA", "IT", "PK", "", undefined]) assert.equal(role("staff", dept), "viewer", `${dept || "no department"} is read-only`);
  assert.equal(storeApi.roleOfEmployee(null), "viewer");
  assert.equal(storeApi.roleOfEmployee({ role: { code: "staff" } }), "viewer");
  assert.equal(role("technician", "PP"), "planner", "any non-manager member of PP plans");

  const user = storeApi.personaUser(employee("staff", "PP"));
  assert.deepEqual(user, { id: "x", role: "planner", dept: "PK", name: "สมหมาย ใจดี" }, "the planning department takes over PK jobs, like the demo planner");
  assert.equal(storeApi.personaUser(employee("staff", "RB")).dept, "RB");
  assert.equal(storeApi.personaUser(employee("admin", "MT")).dept, "AD");
  assert.equal(storeApi.personaUser(employee("staff", "QA")).dept, "QA", "a department outside the BOM departments keeps its own code and matches no job");
  assert.equal(storeApi.personaUser({ id: "y", employee_no: "E9", role: { code: "staff" } }).name, "E9");
  assert.equal(storeApi.personaUser(null), null);
  assert.ok(storeApi.ROLES.viewer && !storeApi.ROLES.viewer.modules.includes("import") && !storeApi.ROLES.viewer.modules.includes("build"));
  assert.equal(A.helpers.canPlan(storeApi.personaUser(employee("staff", "PP"))), true);
  assert.equal(A.helpers.canPlan(storeApi.personaUser(employee("staff", "MT"))), false);
});

test("the company flow uses the PP planning and QA inspection department codes while the Thai labels stay", () => {
  assert.deepEqual(rules.PROCESS_FLOW.map((step) => step.dept), ["SA", "PP", "ST", "RB", "SR", "QA", "GR", "PT", "BG", "PK", "WH"]);
  assert.equal(rules.DEPT_LABEL.PP, "ฝ่ายวางแผน");
  assert.match(rules.DEPT_LABEL.QA, /ตรวจขนาดยาง/);
  assert.equal(rules.DEPT_LABEL.PL, undefined);
  assert.equal(rules.DEPT_LABEL.QC, undefined);
  assert.ok(rules.FLOW_DEPTS.includes("QA") && !rules.FLOW_DEPTS.includes("QC"));
});

test("Thai messages for the BOM RPC errors, whatever shape the error arrives in", () => {
  const message = (error) => storeApi.mapRemoteError(error).message;
  const code = (error) => storeApi.mapRemoteError(error).code;
  assert.match(message({ message: "BOM_TEST_MODE_ONLY" }), /โหมดทดสอบ/);
  assert.match(message({ message: "BOM_FORBIDDEN" }), /ไม่มีสิทธิ์/);
  assert.match(message({ message: "BOM_STALE" }), /ผู้อื่นบันทึก.*ลองทำรายการอีกครั้ง/);
  assert.equal(code({ code: "P0001", message: "ERROR: BOM_FORBIDDEN (context)" }), "BOM_FORBIDDEN");
  assert.equal(code({ code: "BOM_STALE", message: "" }), "BOM_STALE");
  assert.match(message({ message: "BOM_INVALID_BOM_LINE" }), /ไม่ผ่านการตรวจ.*BOM_INVALID_BOM_LINE/);
  assert.match(message({ code: "PGRST202", message: "Could not find the function" }), /ยังไม่ได้ติดตั้ง migration/);
  assert.equal(message(new TypeError("Failed to fetch")), "บันทึกข้อมูล BOM ไม่สำเร็จ ลองใหม่อีกครั้ง", "raw messages never reach the user");
  assert.equal(storeApi.mapRemoteError(new TypeError("Failed to fetch"), "โหลดไม่สำเร็จ").message, "โหลดไม่สำเร็จ");
  const again = storeApi.mapRemoteError(storeApi.mapRemoteError({ message: "BOM_STALE" }));
  assert.equal(again.code, "BOM_STALE", "mapping twice keeps the code and the message");
});

test("diffMaster keys records by code, id or base+code, compares whole records and lists removed colour sets and packages", () => {
  const before = emptyMaster();
  Object.assign(before, {
    items: [{ code: "A", name: "a", rubber: { x: 1, y: 2 } }, { code: "B", name: "b" }],
    boms: [{ id: "BOM-69-0001", itemCode: "A", status: "approved", lines: [{ childCode: "B", qty: 1 }] }],
    colorSets: [{ base: "X", code: "A", slots: [] }, { base: "Y", code: "A", slots: [] }],
    packages: [{ base: "X", code: "P", lines: [] }],
  });
  const after = structuredClone(before);
  assert.deepEqual(storeApi.diffMaster(before, after), {}, "identical data has no changes");
  after.items[0].rubber = { y: 2, x: 1 };
  assert.deepEqual(storeApi.diffMaster(before, after), {}, "key order inside a record does not matter");
  after.items[0].name = "a2";
  after.items.push({ code: "C", name: "c" });
  after.boms[0].status = "superseded";
  after.boms.unshift({ id: "BOM-69-0002", itemCode: "A", status: "approved", lines: [{ childCode: "B", qty: 2 }] });
  after.colorSets = [{ base: "Y", code: "A", slots: [{ key: "k", color: "OR01" }] }];
  after.packages = [];
  after.compounds.push({ code: "DM01", name: "x" });
  const changes = storeApi.diffMaster(before, after);
  assert.deepEqual(Object.keys(changes).sort(), ["boms", "colorSets", "compounds", "items", "packages"]);
  assert.deepEqual(changes.items.upsert.map((record) => record.code), ["A", "C"], "a changed record is sent whole, an untouched one is not");
  assert.equal(changes.items.upsert[0].rubber.x, 1);
  assert.deepEqual(changes.boms.upsert.map((record) => `${record.id}:${record.status}`).sort(), ["BOM-69-0001:superseded", "BOM-69-0002:approved"], "a new revision carries the superseded one with it");
  assert.deepEqual(changes.colorSets, { upsert: [after.colorSets[0]], delete: [{ base: "X", code: "A" }] }, "colour sets with the same code in another base are separate records");
  assert.deepEqual(changes.packages, { delete: [{ base: "X", code: "P" }] });
  assert.equal(changes.items.upsert[0] === after.items[0], false, "the payload is a copy");
});

test("loading: master lists come from the server snapshot, an empty database is a valid start, and a failed load can be retried", async () => {
  const env = remoteStore();
  assert.equal(env.store.isRemote(), true);
  assert.equal(env.store.status(), "idle");
  const pending = env.store.ensureLoaded();
  assert.equal(env.store.status(), "loading");
  assert.equal(env.store.ensureLoaded(), pending, "a second call joins the load in flight");
  await pending;
  assert.equal(env.store.status(), "ready");
  assert.equal(env.server.loads, 1);
  assert.deepEqual(env.events.filter((type) => type !== "status"), ["loaded"]);
  const data = env.store.data();
  for (const list of MASTER) assert.deepEqual(data[list], [], `${list} starts empty`);
  assert.deepEqual(data.users, [], "no demo roles in database mode");
  assert.equal(env.store.user(), planner);
  await env.store.ensureLoaded();
  assert.equal(env.server.loads, 1, "ready → no second load");

  const broken = remoteStore();
  broken.server.remote.load = async () => { throw new TypeError("Failed to fetch"); };
  await broken.store.ensureLoaded();
  assert.equal(broken.store.status(), "error");
  assert.match(broken.store.error().message, /โหลด/);
  assert.doesNotMatch(broken.store.error().message, /fetch/i);
  assert.equal(broken.store.run("saveItem", saveItemPayload()).ok, false, "no action runs without data");
  await broken.store.ensureLoaded();
  assert.equal(broken.store.status(), "error", "a render never retries by itself");
  broken.server.remote.load = fakeServer().remote.load;
  await broken.store.reload();
  assert.equal(broken.store.status(), "ready", "the retry loads");

  const odd = remoteStore();
  odd.server.remote.load = async () => null;
  await odd.store.ensureLoaded();
  assert.equal(odd.store.status(), "error", "a reply that is not a snapshot is an error");
});

test("a save is optimistic, sends only the changed records with the snapshot version and adopts the reply", async () => {
  const env = await ready(remoteStore());
  const out = env.store.run("saveItem", saveItemPayload("P-TEST-01"));
  assert.equal(out.ok, true);
  assert.equal(out.result, "P-TEST-01");
  assert.equal(env.store.data().items.length, 1, "the page sees the item before the server answers");
  assert.equal(env.store.isSaving(), true);
  assert.deepEqual(env.events.at(-1), "saving");
  const outcome = await out.saving;
  assert.deepEqual(outcome, { ok: true });
  assert.equal(env.store.isSaving(), false);
  assert.equal(env.server.saves.length, 1);
  const [call] = env.server.saves;
  assert.equal(call.baseVersion, 0);
  assert.equal(call.action, "saveItem");
  assert.deepEqual(Object.keys(call.changes), ["items"], "audit and counters stay local");
  assert.equal(call.changes.items.upsert[0].code, "P-TEST-01");
  assert.equal(env.store.version(), 1);
  assert.equal(env.events.at(-1), "saved");

  const second = env.store.run("saveItem", { code: "P-TEST-01", kind: "PURCHASED", name: "ชื่อใหม่", uom: "pcs" });
  await second.saving;
  assert.equal(env.server.saves[1].baseVersion, 1, "the next save carries the version the server returned");
  assert.equal(env.server.master.items[0].name, "ชื่อใหม่");
  assert.equal(env.store.data().audit.length, 2, "the audit trail is still written in the browser");
});

test("an action that changes nothing in the master data never calls the server; orders and jobs stay in localStorage", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("FG-TEST-01", { kind: "FG", name: "สินค้าทดสอบ", uom: "set" })).saving;
  await env.store.run("saveItem", saveItemPayload("P-TEST-01")).saving;
  await env.store.run("saveBom", { itemCode: "FG-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 2 }] }).saving;
  const savesBefore = env.server.saves.length;
  const order = env.store.run("createOrder", { customer: "ลูกค้า", country: "Thailand", orderedAt: NOW, whDue: NOW + 20 * 86400000 });
  assert.equal(order.ok, true);
  await order.saving;
  assert.equal(env.server.saves.length, savesBefore, "an order is local");
  assert.equal(env.store.data().orders.length, 1);
  const stored = JSON.parse(env.storage.getItem(storeApi.LOCAL_KEY));
  assert.equal(stored.orders.length, 1);
  assert.deepEqual(Object.keys(stored).sort(), ["audit", "counters", "jobs", "orders", "version"], "the master lists are never written to localStorage");

  const added = env.store.run("addOrderItem", { orderId: order.result, fgCode: "FG-TEST-01", qty: 5 });
  await added.saving;
  assert.equal(env.server.saves.length, savesBefore, "adding an existing product changes only the order");
  assert.equal(env.store.data().orders[0].items.length, 1);
  const same = env.store.run("saveBom", { itemCode: "FG-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 2 }] });
  assert.equal(same.result.changed, false);
  await same.saving;
  assert.equal(env.server.saves.length, savesBefore, "saving an unchanged BOM is not a write");
});

test("a new BOM revision sends the superseded revision with it and numbers continue from the highest id on the server", async () => {
  const server = fakeServer();
  server.master.items.push({ code: "FG-X", kind: "FG", name: "x", ownerDept: "PK", uom: "set", weightG: 0, legacyCodes: [], active: true }, { code: "P-X", kind: "PURCHASED", name: "p", ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true });
  server.master.boms.push({ id: "BOM-69-0041", itemCode: "FG-X", revision: 1, status: "approved", ownerDept: "PK", lines: [{ childCode: "P-X", qty: 1, uom: "pcs", consumerDept: "PK", producerDept: "ST", scrapPct: 0, flags: [], note: "" }], createdBy: "ก", createdAt: NOW - 1, approvedBy: "ก", approvedAt: NOW - 1, note: "", changeLog: [] });
  const env = await ready(remoteStore({ server }));
  const out = env.store.run("saveBom", { itemCode: "FG-X", lines: [{ childCode: "P-X", qty: 3 }] });
  assert.equal(out.ok, true);
  await out.saving;
  const sent = env.server.saves[0].changes.boms.upsert;
  assert.deepEqual(sent.map((bom) => `${bom.status}:${bom.revision}`).sort(), ["approved:2", "superseded:1"]);
  const created = sent.find((bom) => bom.status === "approved");
  assert.match(created.id, /^BOM-\d\d-0042$/, "the new id does not collide with ids made on another machine");
  assert.equal(created.createdBy, planner.name, "display name of the persona");
});

test("a routing that uses a standard step the database does not have yet saves that step with it", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("BG-TEST", { kind: "BG", name: "กระเป๋า", uom: "pcs" })).saving;
  assert.equal(env.server.master.processes.length, 0);
  await env.store.run("saveRouting", { itemCode: "BG-TEST", steps: [{ processCode: "BG-01", minutesPerPc: 2 }] }).saving;
  assert.deepEqual(env.server.master.processes.map((process) => process.code), ["BG-01"], "the routing never points at a step the database lacks");
  assert.ok(env.server.master.routings.length === 1);
});

test("while a save is in flight the next action is refused with a Thai message (no queue) and works once the save is done", async () => {
  const env = await ready(remoteStore());
  let release;
  env.server.hold = new Promise((resolve) => { release = resolve; });
  const first = env.store.run("saveItem", saveItemPayload("P-ONE"));
  const second = env.store.run("saveItem", saveItemPayload("P-TWO"));
  assert.equal(second.ok, false);
  assert.equal(second.busy, true);
  assert.match(second.error.message, /กำลังบันทึก/);
  assert.equal(env.store.data().items.length, 1, "the refused action left no trace");
  env.server.hold = null;
  release();
  await first.saving;
  assert.equal(env.server.saves.length, 1, "only the first action reached the server");
  const third = env.store.run("saveItem", saveItemPayload("P-TWO"));
  assert.equal(third.ok, true);
  await third.saving;
  assert.deepEqual(env.server.master.items.map((item) => item.code), ["P-ONE", "P-TWO"]);
});

test("a rejected save reverts the whole action to the last server snapshot and the local lists to before it, and tells the user in Thai", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("TOY-01(P)-Y", { kind: "FG", name: "สินค้า", uom: "set" })).saving;
  await env.store.run("saveItem", saveItemPayload("P-REV")).saving;
  await env.store.run("saveBom", { itemCode: "TOY-01(P)-Y", lines: [{ childCode: "P-REV", qty: 1 }] }).saving;
  const order = env.store.run("createOrder", { customer: "ลูกค้า", country: "Thailand", orderedAt: NOW, whDue: NOW + 20 * 86400000 });
  const before = structuredClone(env.store.data());

  // บันทึกที่ฐานข้อมูลไม่รับ: หน้าเห็นผลทันที แล้วกลับเป็นของฐานข้อมูล
  env.server.fail = "BOM_INVALID_BOM_LINE";
  const bad = env.store.run("saveItem", { code: "P-REV", kind: "PURCHASED", name: "ชื่อที่ฐานข้อมูลไม่รับ", uom: "pcs" });
  assert.equal(bad.ok, true, "the page accepts it optimistically");
  assert.equal(env.store.data().items.find((item) => item.code === "P-REV").name, "ชื่อที่ฐานข้อมูลไม่รับ");
  const failed = await bad.saving;
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "BOM_INVALID_BOM_LINE");
  assert.match(failed.error.message, /ไม่ผ่านการตรวจ/);
  assert.deepEqual(env.store.data(), before, "master and local lists are exactly as before the action");
  assert.equal(env.store.isSaving(), false);
  assert.equal(env.events.at(-1), "reverted");

  // action เดียวแก้ทั้งข้อมูลหลัก (สร้างรุ่นสินค้าใหม่) และรายการในเครื่อง (ใบสั่งผลิต): ล้มทั้งคู่ ไม่ทิ้งใบที่อ้างสินค้าที่ไม่มี
  env.server.fail = "BOM_FORBIDDEN";
  const variant = env.store.run("addOrderItem", { orderId: order.result, base: "TOY-01", pkg: "B", colorSet: "A", qty: 3 });
  assert.equal(variant.ok, true);
  assert.equal(env.store.data().orders[0].items.length, 1);
  assert.ok(env.store.data().items.some((item) => item.code === "TOY-01(B)-A"));
  const refused = await variant.saving;
  assert.match(refused.error.message, /ไม่มีสิทธิ์แก้ข้อมูล BOM/);
  assert.equal(env.store.data().orders[0].items.length, 0, "the order line is gone with the product it pointed at");
  assert.equal(env.store.data().items.some((item) => item.code === "TOY-01(B)-A"), false);
  assert.deepEqual(JSON.parse(env.storage.getItem(storeApi.LOCAL_KEY)).orders, before.orders, "and so is the stored copy");
  assert.deepEqual(env.store.data(), before);

  const again = env.store.run("saveItem", { code: "P-REV", kind: "PURCHASED", name: "ชื่อใหม่ที่ถูกต้อง", uom: "pcs" });
  assert.equal(again.ok, true, "the store works again after a revert");
  await again.saving;
  assert.equal(env.server.master.items.find((item) => item.code === "P-REV").name, "ชื่อใหม่ที่ถูกต้อง");
});

test("an action that fails its own rules (planner role, validation) changes nothing and never reaches the server", async () => {
  const env = await ready(remoteStore({ user: viewer }));
  const denied = env.store.run("saveItem", saveItemPayload());
  assert.equal(denied.ok, false);
  assert.match(denied.error.message, /ฝ่ายวางแผน/);
  assert.equal(env.server.saves.length, 0);
  assert.equal(env.store.data().items.length, 0);
  const nobody = await ready(remoteStore({ user: null }));
  assert.equal(nobody.store.run("saveItem", saveItemPayload()).ok, false);
});

test("a stale save reloads the latest snapshot, drops the optimistic change and asks the user to try again", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("P-MINE")).saving;
  // เครื่องอื่นบันทึกไปก่อน
  env.server.master.items.push({ code: "P-THEIRS", kind: "PURCHASED", name: "ของเครื่องอื่น", ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true });
  env.server.master.version += 1;
  const loads = env.server.loads;
  const out = env.store.run("saveItem", saveItemPayload("P-LOST"));
  const failed = await out.saving;
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "BOM_STALE");
  assert.match(failed.error.message, /ผู้อื่นบันทึก/);
  assert.equal(env.server.loads, loads + 1, "the latest snapshot was fetched");
  assert.deepEqual(env.store.data().items.map((item) => item.code).sort(), ["P-MINE", "P-THEIRS"], "their record is visible, the lost change is gone");
  assert.equal(env.store.version(), env.server.master.version);
  const retry = env.store.run("saveItem", saveItemPayload("P-LOST"));
  await retry.saving;
  assert.ok(env.server.master.items.some((item) => item.code === "P-LOST"), "the retry is based on the new version");
});

test("when the server answers with other data than the page shows, the page is told to redraw; the same data is silent", async () => {
  const env = await ready(remoteStore());
  const quiet = env.store.run("saveItem", saveItemPayload("P-QUIET"));
  await quiet.saving;
  assert.equal(env.events.filter((type) => type === "saved").length, 1);
  const seen = [];
  env.store.subscribe((event) => { if (event.type === "saved") seen.push(event.changed); });
  await env.store.run("saveItem", { code: "P-QUIET", kind: "PURCHASED", name: "ชื่อ", uom: "pcs" }).saving;
  assert.deepEqual(seen, [false]);
  const original = env.server.remote.save;
  env.server.remote.save = async (...args) => {
    const reply = await original(...args);
    reply.items[0].name = "ปรับโดยฐานข้อมูล";
    return reply;
  };
  await env.store.run("saveItem", { code: "P-QUIET", kind: "PURCHASED", name: "ชื่อ 2", uom: "pcs" }).saving;
  assert.deepEqual(seen, [false, true]);
  assert.equal(env.store.data().items[0].name, "ปรับโดยฐานข้อมูล");
});

test("the browser's older full state keeps its orders, jobs, audit and counters, but its master lists are ignored", async () => {
  const storage = memoryStorage();
  const old = {
    version: 6, counters: { "BOM-69": 7, "PI-69": 2 }, users: [], compounds: [{ code: "OLD" }], items: [{ code: "OLD-ITEM", kind: "FG", name: "เก่า", uom: "set" }], boms: [{ id: "BOM-69-0007" }],
    orders: [{ id: "DEMO-26001", customer: "ลูกค้าเดิม", status: "draft", items: [], stockCounts: {} }], jobs: [{ id: "JOB-69-0001" }], audit: [{ at: 1, user: "x", action: "a", detail: "d" }],
    colors: [], colorSets: [], packages: [], processes: [], routings: [],
  };
  storage.setItem(storeApi.STATE_KEY, JSON.stringify(old));
  const server = fakeServer();
  const env = await ready(remoteStore({ server, storage }));
  const data = env.store.data();
  assert.equal(data.items.length, 0, "master data of the old state is not shown");
  assert.equal(data.boms.length, 0);
  assert.deepEqual(data.orders.map((order) => order.id), ["DEMO-26001"]);
  assert.equal(data.jobs.length, 1);
  assert.equal(data.audit.length, 1);
  assert.equal(data.counters["PI-69"], 2);
  assert.ok(storage.getItem(storeApi.LOCAL_KEY), "the local lists moved to their own key");
  assert.ok(storage.getItem(storeApi.STATE_KEY), "the old key is left untouched");
  assert.equal(JSON.parse(storage.getItem(storeApi.STATE_KEY)).items.length, 1);

  // ครั้งต่อไปอ่านจากคีย์ใหม่ ไม่ย้ายซ้ำจากคีย์เดิม
  const again = await ready(remoteStore({ server, storage }));
  assert.deepEqual(again.store.data().orders.map((order) => order.id), ["DEMO-26001"]);
  await again.store.run("saveItem", saveItemPayload()).saving;
  assert.equal(JSON.parse(storage.getItem(storeApi.STATE_KEY)).items.length, 1, "saving master data never rewrites the old state");
  const third = await ready(remoteStore({ server, storage }));
  assert.equal(third.store.data().audit.length, 2);
  assert.equal(third.store.size() > 0, true);
});

test("a second tab's local changes are picked up before the next action instead of being overwritten", async () => {
  const storage = memoryStorage();
  const env = await ready(remoteStore({ storage }));
  await env.store.run("saveItem", saveItemPayload("P-TAB-1")).saving;
  const stored = JSON.parse(storage.getItem(storeApi.LOCAL_KEY));
  stored.orders.push({ id: "FROM-OTHER-TAB", status: "draft", items: [], stockCounts: {} });
  storage.setItem(storeApi.LOCAL_KEY, JSON.stringify(stored));
  await env.store.run("saveItem", saveItemPayload("P-TAB-2")).saving;
  assert.deepEqual(env.store.data().orders.map((order) => order.id), ["FROM-OTHER-TAB"]);
  assert.deepEqual(JSON.parse(storage.getItem(storeApi.LOCAL_KEY)).orders.map((order) => order.id), ["FROM-OTHER-TAB"]);
});

test("a whole sheet import is one save call, and reset only clears the local lists", async () => {
  const env = await ready(remoteStore());
  const header = ["ITEM", "น.น RB/g", "CODE", "รหัสแผนก", "สินค้า/สูตรยาง", "สีSE/ประเภทยาง", "ความยาวSE/สีRB", "รู,ความหนา/ความยาวRB", "วงนอกSE/รูในRB", "วงนอกRB", "NAME", "แผนกผู้ผลิต", "จำนวนที่ใช้ต่อชุด", "ความยาวตัด", "หน่วย", "จำนวนชิ้นที่ได้ต่อเส้น RB", "หน่วย", "จำนวนที่ได้ต่อ 1 GR", "หน่วย", "หน่วยนับ RB", "น.น ต่อเส้น RB / ก.ก"].join("\t");
  const tsv = [header,
    ["IMP-01(P)-Y", "1", "IMP-01", "PK", "-", "-", "-", "-", "-", "-", "สินค้านำเข้า", "PK", "-", "-", "-", "-", "-", "-", "-", "ชุด / SET", "-"].join("\t"),
    ["IMP-01(P)-Y", "2", "P-STK-01", "ST", "-", "-", "-", "-", "-", "-", "สติ๊กเกอร์ CE", "PK-ST", "2", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "-"].join("\t"),
    ["IMP-01(P)-Y", "3", "SE-IMP01--50-5-20", "SE", "IMP01", "0", "50", "5", "20", "-", "ชิ้นยางนำเข้า", "SE", "4", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "30"].join("\t"),
    ["IMP-01(P)-Y", "4", "RB-B0006-02- -300-5-22", "RB", "B0006", "02", "", "300", "5", "22", "เส้นยางนำเข้า", "RB", "4", "10", "CM", "28", "ชิ้น", "1", "ชิ้น", "ชิ้น/pcs", "600"].join("\t"),
  ].join("\n");
  const built = rules.buildFromFlat(rules.readFlatRows(tsv), { group: "TOY" });
  const payload = { items: [...built.items.values()], boms: [...built.boms.entries()].map(([parentCode, lines]) => ({ parentCode, lines })), source: "test.tsv", group: "TOY" };
  const out = env.store.run("importFlat", payload);
  assert.equal(out.ok, true);
  await out.saving;
  assert.equal(env.server.saves.length, 1, "one call for the whole import");
  assert.equal(env.server.saves[0].action, "importFlat");
  assert.equal(env.server.master.items.length, built.items.size);
  assert.ok(env.server.master.boms.length >= 2);
  assert.ok(env.server.master.compounds.some((compound) => compound.code === "B0006"));
  env.store.reset();
  assert.equal(env.store.data().audit.length, 0);
  assert.equal(env.store.data().items.length, built.items.size, "master data is not touched by reset");
});

// ---------- โมดูลทั้งชุดบน Supabase จำลองของ harness ----------
const FILES = [
  "modules/ui-icons.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/module-bom.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
async function pageEnv({ storage = memoryStorage(), pageStorage = memoryStorage(), mockOptions = {}, mutate = () => {} } = {}) {
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage: pageStorage, ...mockOptions });
  mutate(mock.db);
  const { data } = await mock.client.rpc("app_sandbox_status");
  const status = data ?? { persona: { id: "persona-1", first_name: "ทดสอบ", last_name: "ระบบ", role: { code: "admin" }, department: { code: "MT" } } };
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { toasts: [], renders: 0, notFound: 0, hash: "#/bom" };
  const node = () => ({ handlers: {}, dataset: {}, value: "", disabled: false, textContent: "", innerHTML: "", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, close() {}, remove() {} });
  Object.assign(context, {
    window: context, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee: { ...status.persona, isSandbox: true } }, supabase: { createClient: () => mock.client }, sb: mock.client,
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => node(), querySelectorAll: () => [], body: node(), createElement: node },
    localStorage: storage, FormData: class { entries() { return []; } }, MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  context.window.MNP_REQUEST_MODULES = context.MNP_REQUEST_MODULES;
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  const registered = context.MNP_REQUEST_MODULES.BOM;
  const render = async (query = "") => {
    log.hash = `#/bom${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await registered.pages.bom(new URLSearchParams(query));
    return app.innerHTML;
  };
  return { mock, context, app, log, storage, pageStorage, render, store: context.MNP_BOM.store, ctx: (query = "") => context.MNP_BOM.context(new URLSearchParams(query)) };
}

test("in the browser the module talks to the (mock) database: loading state, empty database points to the import page, no demo role picker or reset", async () => {
  const env = await pageEnv();
  assert.equal(env.store.isRemote(), true);
  let html = await env.render();
  assert.match(html, /กำลังโหลดข้อมูล BOM/, "first paint shows the loading state");
  assert.doesNotMatch(html, /data-rf-user|data-rf-reset/, "no demo role picker and no reset in database mode");
  await env.store.ensureLoaded();
  assert.ok(env.log.renders >= 1, "the page is redrawn when the data arrives");
  for (const page of ["dashboard", "items", "product", "structure", "variants"]) {
    html = await env.render(page === "dashboard" ? "" : `p=${page}`);
    assert.match(html, /ยังไม่มีข้อมูล BOM ในฐานข้อมูล/, `${page} explains the empty database`);
    assert.match(html, /href="#\/bom\?p=import"/, `${page} points to the import page`);
    assert.match(html, /data-bom-sync/, "status slot in the toolbar");
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
  }
  for (const page of ["build", "import", "compounds", "orders", "count", "jobs", "audit"]) {
    html = await env.render(`p=${page}`);
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, `${page} renders on an empty database`);
    assert.doesNotMatch(html, /ยังไม่มีข้อมูล BOM ในฐานข้อมูล/, `${page} keeps its own empty state`);
  }
  html = await env.render("p=import");
  assert.doesNotMatch(html, /localStorage/, "the browser size ceiling no longer applies to master data");
  assert.match(html, /data-bom-import|data-bom-check/);
});

test("a failed load shows a retry instead of the page", async () => {
  const env = await pageEnv({ mockOptions: { sandbox: false } });
  await env.store.ensureLoaded();
  assert.equal(env.store.status(), "error");
  const html = await env.render();
  assert.match(html, /โหลดข้อมูล BOM ไม่สำเร็จ/);
  assert.match(html, /data-bom-retry/);
  assert.match(html, /โหมดทดสอบ/, "the mock refuses outside the test mode like the real RPC");
});

test("importing a pasted BOMSHEET writes through the mock database, survives a page reload, and a different user sees it", async () => {
  const header = ["ITEM", "น.น RB/g", "CODE", "รหัสแผนก", "สินค้า/สูตรยาง", "สีSE/ประเภทยาง", "ความยาวSE/สีRB", "รู,ความหนา/ความยาวRB", "วงนอกSE/รูในRB", "วงนอกRB", "NAME", "แผนกผู้ผลิต", "จำนวนที่ใช้ต่อชุด", "ความยาวตัด", "หน่วย", "จำนวนชิ้นที่ได้ต่อเส้น RB", "หน่วย", "จำนวนที่ได้ต่อ 1 GR", "หน่วย", "หน่วยนับ RB", "น.น ต่อเส้น RB / ก.ก"].join("\t");
  const tsv = [header,
    ["IMP-01(P)-Y", "1", "IMP-01", "PK", "-", "-", "-", "-", "-", "-", "สินค้านำเข้า", "PK", "-", "-", "-", "-", "-", "-", "-", "ชุด / SET", "-"].join("\t"),
    ["IMP-01(P)-Y", "2", "P-STK-01", "ST", "-", "-", "-", "-", "-", "-", "สติ๊กเกอร์ CE", "PK-ST", "2", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "-"].join("\t"),
    ["IMP-01(P)-Y", "3", "SE-IMP01--50-5-20", "SE", "IMP01", "0", "50", "5", "20", "-", "ชิ้นยางนำเข้า", "SE", "4", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "30"].join("\t"),
    ["IMP-01(P)-Y", "4", "RB-B0006-02- -300-5-22", "RB", "B0006", "02", "", "300", "5", "22", "เส้นยางนำเข้า", "RB", "4", "10", "CM", "28", "ชิ้น", "1", "ชิ้น", "ชิ้น/pcs", "600"].join("\t"),
  ].join("\n");
  const built = rules.buildFromFlat(rules.readFlatRows(tsv), { group: "TOY" });
  const payload = { items: [...built.items.values()], boms: [...built.boms.entries()].map(([parentCode, lines]) => ({ parentCode, lines })), source: "test.tsv", group: "TOY" };

  const env = await pageEnv();
  await env.store.ensureLoaded();
  assert.equal(env.store.user().role, "admin", "the mock sandbox persona is an admin who can write");
  const ok = env.ctx("p=import").runAction("importFlat", payload, "นำเข้าแล้ว {result}");
  assert.equal(ok, true);
  assert.equal(env.store.data().items.length, built.items.size, "optimistic");
  assert.deepEqual(env.log.toasts, [], "the success toast waits for the database");
  assert.equal(env.pageStorage.getItem("mnp-harness-bom-master"), null, "not stored yet: the save is still in flight");
  await new Promise((resolve) => setTimeout0(resolve));
  const saved = JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master"));
  assert.equal(saved.version, 1);
  assert.equal(saved.items.length, built.items.size);
  assert.ok(saved.boms.length >= 2);
  assert.equal(env.log.toasts.length, 1);
  assert.match(env.log.toasts[0][0], /^นำเข้าแล้ว ชิ้นงานใหม่ \d+/);
  assert.equal(env.log.toasts[0][1], "ok");

  // โหลดหน้าใหม่ (Supabase จำลองตัวใหม่ แต่ storage ของหน้าเดิม) ข้อมูลยังอยู่
  const reload = await pageEnv({ storage: env.storage, pageStorage: env.pageStorage });
  await reload.store.ensureLoaded();
  assert.equal(reload.store.data().items.length, built.items.size);
  const html = await reload.render("p=items&dept=PK");
  assert.match(html, /IMP-01\(P\)-Y/);
  assert.doesNotMatch(html, /ยังไม่มีข้อมูล BOM ในฐานข้อมูล/);
  const dashboard = await reload.render();
  assert.doesNotMatch(dashboard, /ยังไม่มีข้อมูล BOM ในฐานข้อมูล/);
  for (const page of ["build", "items", "product", "structure", "variants", "compounds", "import", "orders", "count", "jobs", "audit"]) {
    const rendered = await reload.render(`p=${page}`);
    assert.doesNotMatch(rendered, /undefined|NaN|\[object Object\]/, `${page} renders the imported data`);
  }
  const item = await reload.render("p=items&sel=IMP-01(P)-Y");
  assert.match(item, /SE-IMP01/, "the imported BOM tree is readable through the database snapshot");
});

test("the mock database enforces the contract: test mode, writer permission, version and the basic BOM rules", async () => {
  const { client, db } = createMockSupabase({ sandbox: true, now: () => NOW });
  const save = (changes, version = 0, action = "t") => client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: version, p_action: action });
  const item = (code, kind = "PURCHASED") => ({ code, kind, name: code, ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true });
  const bom = (id, itemCode, status, childCode, qty = 1) => ({ id, itemCode, revision: 1, status, ownerDept: "PK", lines: [{ childCode, qty }], note: "" });

  assert.deepEqual((await client.rpc("app_bom_master")).data, emptyMaster());
  let reply = await save({ items: { upsert: [item("FG-1", "FG"), item("P-1")] } });
  assert.equal(reply.error, null);
  assert.equal(reply.data.version, 1);
  assert.equal(reply.data.items.length, 2);
  assert.equal((await save({ items: { upsert: [item("P-2")] } }, 0)).error.code, "BOM_STALE", "an old version is refused");
  assert.equal((await save("x", 1)).error.code, "BOM_INVALID_CHANGES");
  assert.equal((await save({ items: { upsert: [{ name: "no code" }] } }, 1)).error.code, "BOM_INVALID_RECORD");
  assert.equal((await save({ items: { upsert: [item("Z", "NOPE")] } }, 1)).error.code, "BOM_INVALID_ITEM_KIND");
  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "approved", "MISSING")] } }, 1)).error.code, "BOM_INVALID_BOM_LINE");
  assert.equal((await save({ boms: { upsert: [bom("B1", "P-1", "approved", "FG-1")] } }, 1)).error.code, "BOM_INVALID_BOM_LINE", "a purchased part has no components");
  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "approved", "P-1", 0)] } }, 1)).error.code, "BOM_INVALID_BOM_LINE");
  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "draft", "P-1")] } }, 1)).error.code, "BOM_INVALID_BOM_STATUS");
  assert.equal((await client.rpc("app_bom_master")).data.version, 1, "a refused save changes nothing");

  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "approved", "P-1")] } }, 1)).error, null);
  assert.equal((await save({ boms: { upsert: [bom("B2", "FG-1", "approved", "P-1", 2)] } }, 2)).error.code, "BOM_INVALID_BOM_STATUS", "two approved revisions of one item");
  assert.equal((await save({ boms: { upsert: [{ ...bom("B1", "FG-1", "approved", "P-1", 5) }] } }, 2)).error.code, "BOM_INVALID_REVISION_IMMUTABLE", "a saved revision cannot be edited");
  const supersede = await save({ boms: { upsert: [{ ...bom("B1", "FG-1", "superseded", "P-1"), supersededAt: NOW }, bom("B2", "FG-1", "approved", "P-1", 2)] } }, 2);
  assert.equal(supersede.error, null, "a new revision supersedes the previous one in the same call");
  assert.deepEqual(supersede.data.boms.map((row) => row.status), ["superseded", "approved"]);
  assert.equal((await save({ colorSets: { upsert: [{ base: "X", code: "A", slots: [] }] }, packages: { upsert: [{ base: "X", code: "P", lines: [] }] } }, 3)).error, null);
  const removed = await save({ colorSets: { delete: [{ base: "X", code: "A" }] }, compounds: { delete: [{ code: "x" }] } }, 4);
  assert.equal(removed.error.code, "BOM_INVALID_CHANGES", "only colour sets and packages can be deleted");
  assert.equal((await save({ colorSets: { delete: [{ base: "X", code: "A" }] } }, 4)).data.colorSets.length, 0);

  // สิทธิ์: ผู้เขียนคือ admin ผู้จัดการแผนกขึ้นไป หรือแผนก PP
  const me = db.employees[0];
  me.role_id = "role-staff";
  assert.equal((await save({}, 5)).error.code, "BOM_FORBIDDEN", "a staff member of another department may read but not write");
  assert.equal((await client.rpc("app_bom_master")).error, null, "everyone signed in reads");
  me.role_id = "role-dm";
  assert.equal((await save({}, 5)).error, null, "a department manager writes");
  me.role_id = "role-staff";
  db.departments.push({ id: "dep-pp", code: "PP", name_th: "วางแผน", is_active: true, is_repair_site: false });
  me.department_id = "dep-pp";
  assert.equal((await save({}, 6)).error, null, "the planning department writes");

  const outside = createMockSupabase({ now: () => NOW });
  assert.equal((await outside.client.rpc("app_bom_master")).error.code, "BOM_TEST_MODE_ONLY");
  assert.equal((await outside.client.rpc("app_bom_save_master", { p_changes: {}, p_base_version: 0, p_action: "t" })).error.code, "BOM_TEST_MODE_ONLY");
});

test("the mock database keeps its data in the page storage", async () => {
  const storage = memoryStorage();
  const first = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  await first.client.rpc("app_bom_save_master", { p_changes: { compounds: { upsert: [{ code: "DM01", name: "x" }] } }, p_base_version: 0, p_action: "t" });
  const second = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const { data } = await second.client.rpc("app_bom_master");
  assert.equal(data.version, 1);
  assert.deepEqual(data.compounds, [{ code: "DM01", name: "x" }]);
  const broken = createMockSupabase({ sandbox: true, now: () => NOW, storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } });
  assert.equal((await broken.client.rpc("app_bom_save_master", { p_changes: {}, p_base_version: 0, p_action: "t" })).data.version, 1, "a blocked storage keeps the data in memory");
});

test("a persona who may not write sees read-only pages and a save is refused by the database with a Thai message", async () => {
  const env = await pageEnv({ mutate: (db) => { db.employees[0].role_id = "role-staff"; } });
  await env.store.ensureLoaded();
  assert.equal(env.store.user().role, "viewer", "staff in the maintenance department is read-only");
  const denied = env.store.run("saveItem", saveItemPayload());
  assert.equal(denied.ok, false);
  assert.match(denied.error.message, /ฝ่ายวางแผน/);
  // ฐานข้อมูลปฏิเสธเองแม้หน้าจะไม่ซ่อนปุ่ม (ผู้ใช้ที่มีบทบาท BOM แต่ฐานข้อมูลมองไม่ใช่ผู้เขียน)
  const asPlanner = await pageEnv({ mutate: (db) => { db.employees[0].role_id = "role-staff"; db.departments.push({ id: "dep-pp", code: "PP", name_th: "วางแผน", is_active: true, is_repair_site: false }); db.employees[0].department_id = "dep-pp"; } });
  await asPlanner.store.ensureLoaded();
  assert.equal(asPlanner.store.user().role, "planner");
  asPlanner.mock.db.employees[0].department_id = "dep-mt";
  const out = asPlanner.store.run("saveItem", saveItemPayload());
  assert.equal(out.ok, true);
  const failed = await out.saving;
  assert.equal(failed.ok, false);
  assert.match(failed.error.message, /ไม่มีสิทธิ์แก้ข้อมูล BOM/);
  assert.equal(asPlanner.store.data().items.length, 0, "reverted");
});

function setTimeout0(fn) {
  return setImmediate(fn);
}
