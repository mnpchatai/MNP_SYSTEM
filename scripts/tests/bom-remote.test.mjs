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
const SERVER_AT = NOW + 60000;
const MASTER = storeApi.MASTER_LISTS;
const emptyMaster = () => ({ version: 0, ...Object.fromEntries(MASTER.map((list) => [list, []])) });
const planner = { id: "p1", role: "planner", dept: "PK", name: "ณัฐพล บุญมา" };
const viewer = { id: "v1", role: "viewer", dept: "QA", name: "ผู้ดู" };
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const failure = (code) => Object.assign(new Error(code), { code });

// เซิร์ฟเวอร์จำลองตามสัญญา: ทุกระเบียนจำเลขรุ่นที่แก้ล่าสุด · บันทึกชน (BOM_STALE) เฉพาะระเบียนที่แตะซึ่งถูกผู้อื่นแก้/ลบหลัง baseVersion
// คืนส่วนต่างตั้งแต่ baseVersion (ของทุกคน) · since(v) คืนส่วนต่างเดียวกัน · fail = ครั้งถัดไปล้มด้วยรหัสนี้ · external* = ผู้ใช้อื่นบันทึก
function fakeServer(initial = emptyMaster()) {
  const server = { master: structuredClone(initial), versions: Object.fromEntries(MASTER.map((list) => [list, new Map()])), graves: [], loads: 0, saves: [], sinces: [], fail: null, hold: null, sinceFail: null };
  const key = { items: (r) => r.code, compounds: (r) => r.code, colors: (r) => r.code, processes: (r) => r.code, boms: (r) => r.id, routings: (r) => r.id, colorSets: (r) => `${r.base}|${r.code}`, packages: (r) => `${r.base}|${r.code}` };
  const byKey = (list) => (a, b) => (key[list](a) < key[list](b) ? -1 : key[list](a) > key[list](b) ? 1 : 0);
  const view = () => structuredClone(server.master);
  server.delta = (since) => ({
    version: server.master.version,
    changes: Object.fromEntries(MASTER.map((list) => [list, {
      upsert: structuredClone(server.master[list].filter((row) => (server.versions[list].get(key[list](row)) ?? 0) > since).sort(byKey(list))),
      delete: server.graves.filter((grave) => grave.list === list && grave.version > since).map((grave) => ({ base: grave.base, code: grave.code })),
    }])),
  });
  // ฟิลด์ที่ฐานข้อมูลเป็นเจ้าของ (เวลา/ผู้บันทึก) ประทับใหม่ทับค่าที่ client ส่ง เหมือน RPC จริง (เวลาของเซิร์ฟเวอร์ต่างจากเวลาของ client เสมอ)
  const stampOwned = (list, record, old) => {
    const out = structuredClone(record);
    if (list === "items") { out.createdAt = old?.createdAt ?? SERVER_AT; out.updatedAt = SERVER_AT; }
    if (list === "boms" || list === "routings") {
      out.createdAt = old?.createdAt ?? SERVER_AT; out.createdBy = old?.createdBy ?? "เซิร์ฟเวอร์";
      if (list === "boms") { out.approvedAt = old?.approvedAt ?? SERVER_AT; out.approvedBy = old?.approvedBy ?? "เซิร์ฟเวอร์"; }
      if (out.status === "superseded") out.supersededAt = old?.status === "superseded" ? old.supersededAt : SERVER_AT; else delete out.supersededAt;
    }
    return out;
  };
  // changes: { list: { upsert, delete } } → ธุรกรรมเดียว: ระเบียนที่แตะต้องไม่ถูกผู้อื่นแก้หลัง base · BOM ใหม่ของชิ้นที่มี revision ถูกแก้หลัง base = ชน
  function apply(changes, base) {
    const next = server.master.version + 1;
    const mine = new Set();
    const others = (list, id) => (server.versions[list].get(id) ?? 0) > base && !mine.has(`${list}|${id}`);
    for (const [list, entry] of Object.entries(changes)) {
      for (const record of entry.upsert ?? []) {
        const id = key[list](record);
        const at = server.master[list].findIndex((row) => key[list](row) === id);
        if (at === -1) {
          if (server.graves.some((grave) => grave.list === list && `${grave.base}|${grave.code}` === id && grave.version > base)) throw failure("BOM_STALE");
          if ((list === "boms" || list === "routings") && server.master[list].some((row) => row.itemCode === record.itemCode && others(list, key[list](row)))) throw failure("BOM_STALE");
          server.master[list].push(stampOwned(list, record, undefined));
        } else {
          if (others(list, id)) throw failure("BOM_STALE");
          server.master[list][at] = stampOwned(list, record, server.master[list][at]);
        }
        server.versions[list].set(id, next);
        mine.add(`${list}|${id}`);
        server.graves = server.graves.filter((grave) => !(grave.list === list && `${grave.base}|${grave.code}` === id));
      }
      for (const target of entry.delete ?? []) {
        const id = `${target.base}|${target.code}`;
        if (!server.master[list].some((row) => key[list](row) === id)) throw failure("BOM_NOT_FOUND");
        if (others(list, id)) throw failure("BOM_STALE");
        server.master[list] = server.master[list].filter((row) => key[list](row) !== id);
        server.graves.push({ list, base: target.base, code: target.code, version: next });
      }
    }
    server.master.version = next;
  }
  server.remote = {
    load: async () => { server.loads += 1; return view(); },
    save: async (changes, baseVersion, action) => {
      server.saves.push({ changes: structuredClone(changes), baseVersion, action });
      if (server.hold) await server.hold;
      if (server.fail) { const code = server.fail; server.fail = null; throw failure(code); }
      if (!Number.isInteger(baseVersion) || baseVersion < 0 || baseVersion > server.master.version) throw failure("BOM_INVALID_PAYLOAD");
      const before = structuredClone({ master: server.master, graves: server.graves, versions: Object.fromEntries(MASTER.map((list) => [list, [...server.versions[list]]])) });
      try { apply(changes, baseVersion); } catch (error) {
        // ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย
        server.master = before.master; server.graves = before.graves;
        for (const list of MASTER) server.versions[list] = new Map(before.versions[list]);
        throw error;
      }
      return server.delta(baseVersion);
    },
    since: async (version) => {
      server.sinces.push(version);
      if (server.sinceFail) { const code = server.sinceFail; throw failure(code); }
      if (!Number.isInteger(version) || version < 0 || version > server.master.version) throw failure("BOM_INVALID_PAYLOAD");
      return server.delta(version);
    },
  };
  // ผู้ใช้อื่นบันทึกไปแล้ว (ฐานข้อมูลเดียวกัน เวอร์ชันของมันเอง)
  server.external = (changes) => apply(changes, server.master.version);
  return server;
}
function remoteStore({ server = fakeServer(), storage = memoryStorage(), user = planner, shouldHold } = {}) {
  const events = [];
  const raw = [];
  const store = storeApi.createStore({ storage, actions: A, now: () => NOW, remote: server.remote, persona: () => user, shouldHold });
  store.subscribe((event) => { events.push(event.type); raw.push(event); });
  return { store, server, storage, events, raw };
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
  assert.match(created.id, /^BOM-\d\d-0042-[0-9a-z]{6}$/, "the counter continues after the highest id on the server, with a random suffix so two planners never get the same id");
  assert.match(created.id, /^[A-Za-z0-9._-]{1,40}$/, "and it passes the server id check");
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

const otherItem = (code, name = "ของเครื่องอื่น") => ({ code, kind: "PURCHASED", name, ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true });

test("a stale save (the same record changed by someone else) catches up with the delta, drops the optimistic change and asks the user to try again", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("P-MINE")).saving;
  // เครื่องอื่นแก้ระเบียนเดียวกันไปก่อน และเพิ่มอีกชิ้น
  env.server.external({ items: { upsert: [otherItem("P-MINE", "ชื่อจากเครื่องอื่น"), otherItem("P-THEIRS")] } });
  const loads = env.server.loads;
  const out = env.store.run("saveItem", { code: "P-MINE", kind: "PURCHASED", name: "ชื่อที่ฉันแก้", uom: "pcs" });
  assert.equal(env.store.data().items.find((item) => item.code === "P-MINE").name, "ชื่อที่ฉันแก้", "optimistic");
  const failed = await out.saving;
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "BOM_STALE");
  assert.match(failed.error.message, /ผู้อื่นบันทึก/);
  assert.equal(env.server.loads, loads, "the catch-up is a delta, not a reload of everything");
  assert.deepEqual(env.server.sinces, [1], "asked for what changed since the version the page had");
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-MINE", "P-THEIRS"], "their records are visible, in server order");
  assert.equal(env.store.data().items[0].name, "ชื่อจากเครื่องอื่น", "the lost change is gone, theirs is shown");
  assert.equal(env.store.version(), env.server.master.version);
  assert.equal(env.events.at(-1), "reverted");
  const retry = env.store.run("saveItem", { code: "P-MINE", kind: "PURCHASED", name: "ชื่อที่ฉันแก้", uom: "pcs" });
  await retry.saving;
  assert.equal(env.server.master.items.find((item) => item.code === "P-MINE").name, "ชื่อที่ฉันแก้", "the retry is based on the new version");
});

test("a stale save whose catch-up fails falls back to a full load; when that fails too the old data stays", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("P-MINE")).saving;
  env.server.external({ items: { upsert: [otherItem("P-MINE", "ชื่อจากเครื่องอื่น"), otherItem("P-THEIRS")] } });
  env.server.sinceFail = "BOM_INVALID_PAYLOAD";
  const loads = env.server.loads;
  const failed = await env.store.run("saveItem", { code: "P-MINE", kind: "PURCHASED", name: "ฉันแก้", uom: "pcs" }).saving;
  assert.equal(failed.error.code, "BOM_STALE");
  assert.equal(env.server.loads, loads + 1, "the full snapshot was fetched instead");
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-MINE", "P-THEIRS"]);

  env.server.external({ items: { upsert: [otherItem("P-MINE", "อีกครั้ง")] } });
  env.server.remote.load = async () => { throw new TypeError("Failed to fetch"); };
  const again = await env.store.run("saveItem", { code: "P-MINE", kind: "PURCHASED", name: "ฉันแก้อีก", uom: "pcs" }).saving;
  assert.equal(again.ok, false);
  assert.equal(env.store.data().items[0].name, "ชื่อจากเครื่องอื่น", "the data stays at the last version the page had");
  assert.equal(env.store.isSaving(), false);
});

test("the reply to a save carries other users' changes too: merged by key in server order, deletions removed, and the page is told about others only when the reply holds records it did not send", async () => {
  const server = fakeServer();
  server.master.colorSets.push({ base: "X", code: "A", slots: [] }, { base: "X", code: "B", slots: [] });
  const env = await ready(remoteStore({ server }));
  const seen = [];
  env.store.subscribe((event) => { if (event.type === "saved") seen.push([event.changed, event.others]); });
  // ผู้อื่นเพิ่มชิ้น ลบชุดสี และแก้ชิ้นเดิมไปแล้ว
  server.external({ items: { upsert: [otherItem("P-ZZZ"), otherItem("P-AAA")] } });
  server.external({ colorSets: { delete: [{ base: "X", code: "A" }] } });
  await env.store.run("saveItem", saveItemPayload("P-MID")).saving;
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-AAA", "P-MID", "P-ZZZ"], "merged by key, sorted like the database");
  assert.deepEqual(env.store.data().colorSets.map((set) => set.code), ["B"], "their deletion reached this page without a reload");
  assert.equal(env.server.loads, 1, "one load at the start, none after");
  assert.deepEqual(seen, [[true, true]], "something new was shown, and it came from others");
  assert.equal(env.store.version(), server.master.version);
  await env.store.run("saveItem", { code: "P-MID", kind: "PURCHASED", name: "ชื่อใหม่", uom: "pcs" }).saving;
  assert.deepEqual(seen, [[true, true], [true, false]], "a reply that only holds this page's own record (re-stamped by the database) is not reported as others' work");
  assert.equal(env.store.data().items.find((item) => item.code === "P-MID").updatedAt, SERVER_AT, "the server's stamp replaced the client's");
  assert.deepEqual(env.store.data().items.map((item) => item.name), ["ของเครื่องอื่น", "ชื่อใหม่", "ของเครื่องอื่น"]);
});

test("two stores on one server: saves of unrelated records both succeed, the same record conflicts, and catching up shows the other's work without a redraw when nothing changed", async () => {
  const server = fakeServer();
  const a = await ready(remoteStore({ server, user: planner }));
  const b = await ready(remoteStore({ server, user: { ...planner, id: "p2", name: "คนที่สอง" } }));
  const outA = a.store.run("saveItem", saveItemPayload("P-FROM-A"));
  const outB = b.store.run("saveItem", saveItemPayload("P-FROM-B"));
  assert.deepEqual(await outA.saving, { ok: true });
  assert.deepEqual(await outB.saving, { ok: true }, "B saved from the same old version: A changed a different record");
  assert.deepEqual(server.saves.map((call) => call.baseVersion), [0, 0]);
  assert.equal(server.master.version, 2);
  assert.deepEqual(b.store.data().items.map((item) => item.code), ["P-FROM-A", "P-FROM-B"], "B's reply carried A's record");
  assert.deepEqual(a.store.data().items.map((item) => item.code), ["P-FROM-A"], "A has not heard about B yet");

  const synced = [];
  a.store.subscribe((event) => { if (event.type === "synced") synced.push(event.changed); });
  assert.equal(await a.store.catchUp(), true);
  assert.deepEqual(a.store.data().items.map((item) => item.code), ["P-FROM-A", "P-FROM-B"]);
  assert.equal(a.store.version(), 2);
  assert.deepEqual(synced, [true]);
  assert.equal(await a.store.catchUp(), false, "nothing new");
  assert.deepEqual(synced, [true], "no event, so no redraw, when nothing changed");
  assert.deepEqual(server.sinces, [1, 2], "each catch-up asks from the version the page had");

  // ระเบียนเดียวกัน
  const editA = await a.store.run("saveItem", { code: "P-FROM-A", kind: "PURCHASED", name: "A แก้", uom: "pcs" }).saving;
  assert.equal(editA.ok, true);
  const editB = await b.store.run("saveItem", { code: "P-FROM-A", kind: "PURCHASED", name: "B แก้", uom: "pcs" }).saving;
  assert.equal(editB.ok, false);
  assert.equal(editB.error.code, "BOM_STALE");
  assert.equal(b.store.data().items[0].name, "A แก้", "B now sees A's version");
  assert.equal(server.master.items[0].name, "A แก้");
  const ownB = await b.store.run("saveItem", { code: "P-FROM-B", kind: "PURCHASED", name: "B แก้ของตัวเอง", uom: "pcs" }).saving;
  assert.equal(ownB.ok, true, "B's own record is still savable after the conflict");
});

test("two planners adding a revision of the same product conflict, adding revisions of different products does not", async () => {
  const server = fakeServer();
  const part = (code, kind) => ({ code, kind, name: code, ownerDept: kind === "FG" ? "PK" : "ST", uom: kind === "FG" ? "set" : "pcs", weightG: 0, legacyCodes: [], active: true });
  const line = { childCode: "P-X", qty: 1, uom: "pcs", consumerDept: "PK", producerDept: "ST", scrapPct: 0, flags: [], note: "" };
  server.master.items.push(part("FG-X", "FG"), part("FG-Y", "FG"), part("P-X", "PURCHASED"));
  for (const [id, itemCode] of [["BOM-69-0001", "FG-X"], ["BOM-69-0002", "FG-Y"]]) {
    server.master.boms.push({ id, itemCode, revision: 1, status: "approved", ownerDept: "PK", lines: [line], createdBy: "ก", createdAt: NOW - 1, approvedBy: "ก", approvedAt: NOW - 1, note: "", changeLog: [] });
  }
  const a = await ready(remoteStore({ server }));
  const b = await ready(remoteStore({ server, user: { ...planner, id: "p2", name: "คนที่สอง" } }));
  const savedA = await a.store.run("saveBom", { itemCode: "FG-X", lines: [{ childCode: "P-X", qty: 2 }] }).saving;
  assert.equal(savedA.ok, true);
  const savedB = await b.store.run("saveBom", { itemCode: "FG-X", lines: [{ childCode: "P-X", qty: 3 }] }).saving;
  assert.equal(savedB.ok, false, "the second new revision of the same product is refused");
  assert.equal(savedB.error.code, "BOM_STALE");
  assert.deepEqual(b.store.data().boms.filter((bom) => bom.itemCode === "FG-X").map((bom) => `${bom.revision}:${bom.status}`), ["1:superseded", "2:approved"], "B caught up with A's revision and the superseded one");
  assert.equal(server.master.boms.filter((bom) => bom.itemCode === "FG-X" && bom.status === "approved").length, 1);
  const otherProduct = await b.store.run("saveBom", { itemCode: "FG-Y", lines: [{ childCode: "P-X", qty: 3 }] }).saving;
  assert.equal(otherProduct.ok, true, "another product is not blocked by A's save");
  assert.equal(server.master.boms.filter((bom) => bom.itemCode === "FG-Y").length, 2);
});

test("catching up is skipped while a save is in flight or nothing is loaded, and a result that arrives after an action started is dropped", async () => {
  const idle = remoteStore();
  assert.equal(await idle.store.catchUp(), false, "nothing loaded yet");
  assert.deepEqual(idle.server.sinces, []);

  const env = await ready(remoteStore());
  let release;
  env.server.hold = new Promise((resolve) => { release = resolve; });
  const saving = env.store.run("saveItem", saveItemPayload("P-ONE"));
  assert.equal(await env.store.catchUp(), false, "busy saving");
  assert.deepEqual(env.server.sinces, []);
  env.server.hold = null;
  release();
  await saving.saving;

  env.server.external({ items: { upsert: [otherItem("P-OTHER")] } });
  const original = env.server.remote.since;
  let late;
  env.server.remote.since = (version) => new Promise((resolve) => { late = () => resolve(original(version)); });
  const catching = env.store.catchUp();
  assert.equal(env.store.catchUp(), catching, "a second call joins the one in flight");
  await Promise.resolve();
  const action = env.store.run("saveItem", saveItemPayload("P-TWO"));
  assert.equal(action.ok, true);
  late();
  assert.equal(await catching, false, "the late answer is dropped because an action started meanwhile");
  env.server.remote.since = original;
  await action.saving;
  assert.equal(await env.store.catchUp(), false, "the second save already carried the other record");
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-ONE", "P-OTHER", "P-TWO"]);

  const failing = await ready(remoteStore());
  failing.server.sinceFail = "BOM_REMOTE_FAILED";
  assert.equal(await failing.store.catchUp(), false, "a failed catch-up is silent");
  assert.equal(failing.store.status(), "ready");
});

test("when the server answers with other data than the page shows, the page is told to redraw; re-stamped records of this save are never reported as others' work", async () => {
  const env = await ready(remoteStore());
  const quiet = env.store.run("saveItem", saveItemPayload("P-QUIET"));
  await quiet.saving;
  assert.equal(env.events.filter((type) => type === "saved").length, 1);
  const seen = [];
  env.store.subscribe((event) => { if (event.type === "saved") seen.push([event.changed, event.others]); });
  await env.store.run("saveItem", { code: "P-QUIET", kind: "PURCHASED", name: "ชื่อ", uom: "pcs" }).saving;
  assert.deepEqual(seen, [[true, false]]);
  const original = env.server.remote.save;
  env.server.remote.save = async (...args) => {
    const reply = await original(...args);
    reply.changes.items.upsert[0].name = "ปรับโดยฐานข้อมูล";
    return reply;
  };
  await env.store.run("saveItem", { code: "P-QUIET", kind: "PURCHASED", name: "ชื่อ 2", uom: "pcs" }).saving;
  assert.deepEqual(seen, [[true, false], [true, false]]);
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

test("two planners starting from the same version never generate the same BOM or routing id, so unrelated saves both succeed", async () => {
  const server = fakeServer();
  const part = (code, kind) => ({ code, kind, name: code, ownerDept: kind === "FG" ? "PK" : "ST", uom: kind === "FG" ? "set" : "pcs", weightG: 0, legacyCodes: [], active: true });
  server.master.items.push(part("FG-X", "FG"), part("FG-Y", "FG"), part("P-X", "PURCHASED"));
  server.master.processes.push({ code: "BG-01", name: "เย็บ", dept: "BG" }); // ขั้นตอนมาตรฐานมีอยู่แล้ว: สองคนสร้างขั้นตอนเดียวกันพร้อมกันเป็นการชนอีกเรื่อง
  const a = await ready(remoteStore({ server }));
  const b = await ready(remoteStore({ server, user: { ...planner, id: "p2", name: "คนที่สอง" } }));
  // ทั้งสองเครื่องโหลดที่เวอร์ชัน 0 และตัวนับเริ่มเท่ากัน · A บันทึกก่อน แล้ว B บันทึกอีกชิ้นจากเวอร์ชันเดิมโดยไม่ได้ตามทัน
  const outA = a.store.run("saveBom", { itemCode: "FG-X", lines: [{ childCode: "P-X", qty: 1 }] });
  const outB = b.store.run("saveBom", { itemCode: "FG-Y", lines: [{ childCode: "P-X", qty: 2 }] });
  assert.equal(outA.ok && outB.ok, true);
  assert.deepEqual(await outA.saving, { ok: true });
  assert.deepEqual(await outB.saving, { ok: true }, "B's BOM is saved: A touched another product and the ids differ");
  const [idA, idB] = [server.saves[0].changes.boms.upsert[0].id, server.saves[1].changes.boms.upsert[0].id];
  assert.notEqual(idA, idB);
  assert.equal(idA.replace(/-[0-9a-z]{6}$/, ""), idB.replace(/-[0-9a-z]{6}$/, ""), "the readable counter part is the same on both machines");
  for (const id of [idA, idB]) assert.match(id, /^BOM-\d\d-0001-[0-9a-z]{6}$/);
  assert.deepEqual(server.master.boms.map((bom) => bom.itemCode).sort(), ["FG-X", "FG-Y"], "B's work is not reverted");

  // routing: ขั้นตอนผลิตของสองชิ้นจากเวอร์ชันเดียวกันก็ได้รหัสไม่ซ้ำ
  const c = await ready(remoteStore({ server }));
  const d = await ready(remoteStore({ server, user: { ...planner, id: "p3", name: "คนที่สาม" } }));
  const outC = c.store.run("saveRouting", { itemCode: "FG-X", steps: [{ processCode: "BG-01", minutesPerPc: 2 }] });
  const outD = d.store.run("saveRouting", { itemCode: "FG-Y", steps: [{ processCode: "BG-01", minutesPerPc: 3 }] });
  assert.equal(outC.ok && outD.ok, true, outC.error?.message ?? outD.error?.message);
  assert.deepEqual(await outC.saving, { ok: true });
  assert.deepEqual(await outD.saving, { ok: true });
  assert.notEqual(server.saves.at(-2).changes.routings.upsert[0].id, server.saves.at(-1).changes.routings.upsert[0].id);
  assert.match(server.saves.at(-1).changes.routings.upsert[0].id, /^RT-\d\d-0001-[0-9a-z]{6}$/);

  // ตัวนับยังอ่านเลขจากรหัสที่มีรหัสสุ่มต่อท้าย
  const e = await ready(remoteStore({ server }));
  await e.store.run("saveBom", { itemCode: "FG-X", lines: [{ childCode: "P-X", qty: 5 }] }).saving;
  assert.match(server.saves.at(-1).changes.boms.upsert.find((bom) => bom.status === "approved").id, /^BOM-\d\d-0002-[0-9a-z]{6}$/, "continues after the highest counter on the server");
});

test("while the user has a form open the catch-up does not merge or move the base version: it notes that newer data exists once, and the save is checked against the old base", async () => {
  const server = fakeServer();
  const a = await ready(remoteStore({ server }));
  const b = await ready(remoteStore({ server, user: { ...planner, id: "p2", name: "คนที่สอง" } }));
  await a.store.run("saveItem", saveItemPayload("P-SAME", { name: "ของ A" })).saving;

  assert.equal(await b.store.catchUp(() => true), false, "held");
  assert.equal(b.store.version(), 0, "the base version did not move");
  assert.deepEqual(b.store.data().items, [], "and nothing was merged into the data under the open form");
  assert.equal(b.store.hasNewer(), true);
  assert.equal(await b.store.catchUp(() => true), false);
  assert.equal(b.events.filter((type) => type === "pending").length, 1, "the page is told once, not on every focus");
  assert.equal(b.events.includes("synced"), false);

  // ฟอร์มที่เปิดค้างไว้บันทึก: ส่งไปพร้อมเวอร์ชันฐานเดิม ฐานข้อมูลจึงเห็นว่าชิ้นนี้ถูก A แก้ไปแล้ว
  const out = b.store.run("saveItem", saveItemPayload("P-SAME", { name: "ของ B" }));
  assert.equal(out.ok, true);
  assert.equal(server.saves.at(-1).baseVersion, 0, "sent with the version the form was drawn from");
  const result = await out.saving;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BOM_STALE", "A's change is not overwritten silently");
  assert.equal(server.master.items[0].name, "ของ A");
  assert.equal(b.store.data().items[0].name, "ของ A", "B now sees A's version");
  assert.equal(b.store.hasNewer(), false, "caught up by the conflict reply");

  // บันทึกชิ้นอื่นจากฐานเดิม: สำเร็จ และคำตอบพาของผู้อื่นมาให้ด้วย (แจ้งว่าเป็นของผู้อื่น)
  const c = await ready(remoteStore({ server: fakeServer() }));
  const d = await ready(remoteStore({ server: c.server, user: { ...planner, id: "p4", name: "คนที่สี่" } }));
  await c.store.run("saveItem", saveItemPayload("P-FROM-C")).saving;
  assert.equal(await d.store.catchUp(() => true), false);
  assert.equal(d.store.hasNewer(), true);
  const saw = [];
  d.store.subscribe((event) => { if (event.type === "saved") saw.push(event.others); });
  assert.equal((await d.store.run("saveItem", saveItemPayload("P-FROM-D")).saving).ok, true);
  assert.deepEqual(d.store.data().items.map((item) => item.code), ["P-FROM-C", "P-FROM-D"], "the reply brought everything since the old base");
  assert.deepEqual(saw, [true]);
  assert.equal(d.store.hasNewer(), false);

  // ไม่มีอะไรใหม่ = ไม่แจ้ง · ไม่มีฟอร์มค้างแล้ว = รวมตามปกติ
  assert.equal(await d.store.catchUp(() => true), false);
  assert.equal(d.events.filter((type) => type === "pending").length, 1, "nothing newer, no notice");
  c.server.external({ items: { upsert: [otherItem("P-LATE")] } });
  assert.equal(await d.store.catchUp(() => false), true);
  assert.deepEqual(d.store.data().items.map((item) => item.code), ["P-FROM-C", "P-FROM-D", "P-LATE"]);
});

test("a catch-up that finds the page's version ahead of the database falls back to a full load, unless a form is open", async () => {
  const server = fakeServer();
  const env = await ready(remoteStore({ server }));
  server.external({ items: { upsert: [otherItem("P-OLD")] } });
  assert.equal(await env.store.catchUp(), true);
  assert.equal(env.store.version(), 1);
  // ล้างข้อมูลทดสอบฝั่งฐานข้อมูล: เวอร์ชันกลับไปเป็น 0
  server.master = emptyMaster();
  server.versions = Object.fromEntries(MASTER.map((list) => [list, new Map()]));
  server.master.items.push(otherItem("P-NEW"));
  server.versions.items.set("P-NEW", 0);
  const loads = server.loads;
  assert.equal(await env.store.catchUp(() => true), false, "a form is open: nothing is replaced under it");
  assert.equal(server.loads, loads);
  assert.equal(await env.store.catchUp(), true);
  assert.equal(server.loads, loads + 1, "the full snapshot was loaded");
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-NEW"]);
  assert.equal(env.store.version(), 0);
  assert.equal(env.store.status(), "ready", "the page never went back to the loading state");
  assert.equal(env.events.includes("synced"), true);
});

// หน้าเริ่มแก้ฟอร์มอื่น (หรือเปิด dialog) ระหว่างที่การบันทึกกำลังรอคำตอบ: ผู้อื่นแก้ P-Z ไปก่อน · ฟอร์มสร้างจากข้อมูลก่อนหน้านั้น
async function inFlightScene(hold) {
  const state = { holding: false };
  const env = await ready(remoteStore({ shouldHold: () => state.holding }));
  const { store, server } = env;
  await store.run("saveItem", { code: "P-Z", kind: "PURCHASED", name: "Z old", uom: "pcs", create: true }).saving;
  server.external({ items: { upsert: [{ ...server.master.items.find((row) => row.code === "P-Z"), name: "Z renamed by C" }] } });
  const baseBefore = store.version();
  const unrelated = store.run("saveItem", saveItemPayload("P-B", { name: "B" }));
  state.holding = hold; // ผู้ใช้เปิดฟอร์มแก้ P-Z ตอนนี้ (ข้อมูลที่ฟอร์มใช้คือ "Z old")
  const formName = store.data().items.find((row) => row.code === "P-Z").name;
  assert.equal(formName, "Z old");
  return { ...env, state, baseBefore, unrelated, formName };
}
const zPayload = (name) => ({ code: "P-Z", kind: "PURCHASED", name, uom: "kg" });

test("a save reply with other users records does not move the base or the data while a form is open: the form's later save conflicts and the other user's change survives", async () => {
  const scene = await inFlightScene(true);
  const { store, server, state, raw } = scene;
  assert.equal(scene.unrelated.ok, true);
  assert.deepEqual(await scene.unrelated.saving, { ok: true });
  assert.equal(store.version(), scene.baseBefore, "the base version used by the next save did not move");
  assert.equal(store.hasNewer(), true);
  const saved = raw.filter((event) => event.type === "saved").at(-1);
  assert.deepEqual([saved.changed, saved.others, saved.held], [false, true, true], "the page is told the reply was held, so it does not redraw");
  assert.equal(raw.filter((event) => event.type === "pending").length, 1);
  const names = Object.fromEntries(store.data().items.map((row) => [row.code, row.name]));
  assert.equal(names["P-Z"], "Z old", "the data under the open form is untouched");
  assert.equal(names["P-B"], "B", "this client's own record stays visible");

  // ฟอร์มส่ง (เปลี่ยนแค่หน่วย แต่ payload พกชื่อเดิม): ตรวจชนจากฐานเดิม → ชน ไม่ทับชื่อที่ C แก้
  const out = await store.run("saveItem", zPayload(scene.formName)).saving;
  assert.equal(server.saves.at(-1).baseVersion, scene.baseBefore);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "BOM_STALE");
  assert.equal(server.master.items.find((row) => row.code === "P-Z").name, "Z renamed by C", "C's change survived");

  // ชนตอนยังมีฟอร์มค้าง: ไม่ดึงข้อมูลผู้อื่นเข้า data/ฐาน (ย้อนกลับไปที่ snapshot เดิม = ฐานเดิม + P-B ของเราเอง) แค่จำว่ามีข้อมูลใหม่
  assert.equal(store.version(), scene.baseBefore);
  assert.equal(store.data().items.find((row) => row.code === "P-Z").name, "Z old");
  assert.equal(store.data().items.some((row) => row.code === "P-B"), true, "the revert base keeps this client's earlier saved record");
  assert.equal(store.hasNewer(), true);
  assert.equal(raw.at(-1).type, "reverted");
  assert.equal(raw.at(-1).held, true);

  // ฟอร์มจบแล้ว: รวมทุกอย่างพร้อมกัน ฐานขยับ และบันทึกใหม่จากข้อมูลล่าสุดสำเร็จ
  state.holding = false;
  assert.equal(await store.catchUp(), true);
  assert.equal(store.data().items.find((row) => row.code === "P-Z").name, "Z renamed by C");
  assert.equal(store.hasNewer(), false);
  assert.equal(store.version(), server.master.version);
  assert.equal((await store.run("saveItem", zPayload("Z renamed by C")).saving).ok, true);
  assert.equal(server.master.items.find((row) => row.code === "P-Z").uom, "kg");
});

test("a save reply with other users records merges as before when no form is open", async () => {
  const scene = await inFlightScene(false);
  const { store, server, raw } = scene;
  assert.deepEqual(await scene.unrelated.saving, { ok: true });
  assert.equal(store.version(), server.master.version, "the base moved to the reply's version");
  assert.equal(store.hasNewer(), false);
  assert.equal(store.data().items.find((row) => row.code === "P-Z").name, "Z renamed by C", "the other user's record was merged");
  const saved = raw.filter((event) => event.type === "saved").at(-1);
  assert.equal(saved.others, true);
  assert.equal(saved.changed, true);
  assert.equal(saved.held, undefined);
  assert.equal(raw.some((event) => event.type === "pending"), false);
  assert.equal((await store.run("saveItem", zPayload("Z renamed by C")).saving).ok, true);
  assert.equal(server.master.items.find((row) => row.code === "P-Z").uom, "kg");
});

test("a reply without other users records merges even while a form is open; a conflict during a form reverts without pulling data in", async () => {
  const state = { holding: false };
  const env = await ready(remoteStore({ shouldHold: () => state.holding }));
  const out = env.store.run("saveItem", saveItemPayload("P-ONLY"));
  state.holding = true;
  assert.deepEqual(await out.saving, { ok: true });
  assert.equal(env.store.version(), env.server.master.version, "nothing foreign in the reply: the base moves");
  assert.equal(env.store.hasNewer(), false);

  // ชน แล้วผู้ใช้เริ่มแก้ฟอร์มอื่น: ย้อนกลับแต่ไม่ตามทันฐานข้อมูล (ไม่เรียก since)
  env.server.external({ items: { upsert: [otherItem("P-ONLY", "ของ C")] } });
  const before = env.store.version();
  const sinces = env.server.sinces.length;
  state.holding = false;
  const stale = env.store.run("saveItem", { code: "P-ONLY", kind: "PURCHASED", name: "ของเรา", uom: "pcs" });
  state.holding = true;
  assert.equal((await stale.saving).error.code, "BOM_STALE");
  assert.equal(env.server.sinces.length, sinces, "no catch-up while a form is open");
  assert.equal(env.store.version(), before);
  assert.equal(env.store.hasNewer(), true);
  assert.equal(env.store.data().items.find((row) => row.code === "P-ONLY").name, saveItemPayload("P-ONLY").name, "reverted to the snapshot, not to the other user's version");
});

test("the full-load fallback of a catch-up is dropped when a form opens while it is loading", async () => {
  const state = { holding: false };
  const server = fakeServer();
  const env = await ready(remoteStore({ server, shouldHold: () => state.holding }));
  server.external({ items: { upsert: [otherItem("P-OLD")] } });
  assert.equal(await env.store.catchUp(), true);
  server.master = emptyMaster();
  server.versions = Object.fromEntries(MASTER.map((list) => [list, new Map()]));
  server.master.items.push(otherItem("P-NEW"));
  server.versions.items.set("P-NEW", 0);
  const load = server.remote.load;
  server.remote.load = async () => { state.holding = true; return load(); };
  assert.equal(await env.store.catchUp(), false, "a form opened while the snapshot was loading");
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-OLD"], "the page's data was not replaced");
  assert.equal(env.store.version(), 1);
  assert.equal(env.events.filter((type) => type === "synced").length, 1, "only the first catch-up redrew");

  state.holding = false;
  server.remote.load = load;
  assert.equal(await env.store.catchUp(), true, "the next focus tries again");
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-NEW"]);
});

// ---------- โมดูลทั้งชุดบน Supabase จำลองของ harness ----------
const FILES = [
  "modules/ui-icons.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/module-bom.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
async function pageEnv({ storage = memoryStorage(), pageStorage = memoryStorage(), mockOptions = {}, mutate = () => {}, hooks = {} } = {}) {
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
    document: { querySelector: () => node(), querySelectorAll: (selector) => (selector === "dialog[open]" && hooks.dialogOpen?.() ? [node()] : []), body: node(), createElement: node, addEventListener: (type, fn) => hooks.onDocument?.(type, fn) },
    addEventListener: (type, fn) => hooks.onWindow?.(type, fn),
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

test("the mock database enforces the contract: test mode, writer permission, per-record versions, delta replies and the basic BOM rules", async () => {
  const { client, db } = createMockSupabase({ sandbox: true, now: () => NOW });
  const save = (changes, version = 0, action = "t") => client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: version, p_action: action });
  const since = (version) => client.rpc("app_bom_master_since", { p_version: version });
  const item = (code, kind = "PURCHASED") => ({ code, kind, name: code, ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true });
  const bom = (id, itemCode, status, childCode, qty = 1) => ({ id, itemCode, revision: 1, status, ownerDept: "PK", lines: [{ childCode, qty }], note: "" });
  const codes = (reply, list = "items") => reply.data.changes[list].upsert.map((row) => row.code ?? row.id);

  assert.deepEqual((await client.rpc("app_bom_master")).data, emptyMaster());
  let reply = await save({ items: { upsert: [item("FG-1", "FG"), item("P-1")] } });
  assert.equal(reply.error, null);
  assert.equal(reply.data.version, 1);
  assert.deepEqual(codes(reply), ["FG-1", "P-1"], "a save answers with a delta: every change since the base version");
  assert.deepEqual(Object.keys(reply.data.changes), storeApi.MASTER_LISTS, "all eight lists are always present");
  assert.deepEqual(reply.data.changes.colorSets, { upsert: [], delete: [] });

  // ชนรายระเบียน: ระเบียนอื่นที่ผู้อื่นแก้ไม่ขวาง ระเบียนเดียวกันขวาง
  assert.equal((await save({ items: { upsert: [item("P-2")] } }, 0)).error, null, "base 0 while the version is 1: P-2 is a different record, so it saves");
  assert.deepEqual(codes(await since(0)), ["FG-1", "P-1", "P-2"]);
  assert.deepEqual(codes(await since(1)), ["P-2"], "the delta lists only what changed after the version");
  assert.deepEqual(codes(await since(2)), []);
  assert.equal((await save({ items: { upsert: [{ ...item("P-2"), name: "แก้" }] } }, 1)).error.code, "BOM_STALE", "the same record changed after the base version");
  assert.equal((await save({ items: { upsert: [item("P-2")] } }, 0)).error.code, "BOM_STALE", "creating a key that was created after the base version");
  assert.equal((await save({ items: { upsert: [{ ...item("P-1"), name: "แก้" }] } }, 1)).error, null, "P-1 has not changed since version 1");
  assert.equal((await save({}, 9)).error.code, "BOM_INVALID_PAYLOAD", "a base version above the current one");
  assert.equal((await save({}, -1)).error.code, "BOM_INVALID_PAYLOAD");
  assert.equal((await save({}, null)).error.code, "BOM_INVALID_PAYLOAD");
  assert.equal((await since(9)).error.code, "BOM_INVALID_PAYLOAD");
  assert.equal((await since(-1)).error.code, "BOM_INVALID_PAYLOAD");
  const idle = await save({}, 0);
  assert.equal(idle.error, null);
  assert.equal(idle.data.version, 3, "saving nothing does not move the version");
  assert.deepEqual(codes(idle), ["FG-1", "P-1", "P-2"], "but it still answers with the delta");

  assert.equal((await save("x", 3)).error.code, "BOM_INVALID_CHANGES");
  assert.equal((await save({ items: { upsert: [{ name: "no code" }] } }, 3)).error.code, "BOM_INVALID_RECORD");
  assert.equal((await save({ items: { upsert: [item("Z", "NOPE")] } }, 3)).error.code, "BOM_INVALID_ITEM_KIND");
  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "approved", "MISSING")] } }, 3)).error.code, "BOM_INVALID_BOM_LINE");
  assert.equal((await save({ boms: { upsert: [bom("B1", "P-1", "approved", "FG-1")] } }, 3)).error.code, "BOM_INVALID_BOM_LINE", "a purchased part has no components");
  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "approved", "P-1", 0)] } }, 3)).error.code, "BOM_INVALID_BOM_LINE");
  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "draft", "P-1")] } }, 3)).error.code, "BOM_INVALID_BOM_STATUS");
  assert.equal((await client.rpc("app_bom_master")).data.version, 3, "a refused save changes nothing");

  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "approved", "P-1")] } }, 3)).error, null);
  assert.equal((await save({ boms: { upsert: [bom("B2", "FG-1", "approved", "P-1", 2)] } }, 4)).error.code, "BOM_INVALID_BOM_STATUS", "two approved revisions of one item");
  assert.equal((await save({ boms: { upsert: [{ ...bom("B1", "FG-1", "approved", "P-1", 5) }] } }, 4)).error.code, "BOM_REVISION_IMMUTABLE", "a saved revision cannot be edited");
  const supersede = await save({ boms: { upsert: [{ ...bom("B1", "FG-1", "superseded", "P-1"), supersededAt: NOW }, bom("B2", "FG-1", "approved", "P-1", 2)] } }, 4);
  assert.equal(supersede.error, null, "a new revision supersedes the previous one in the same call");
  assert.deepEqual(supersede.data.changes.boms.upsert.map((row) => `${row.id}:${row.status}`), ["B1:superseded", "B2:approved"], "the delta carries the superseded revision too");
  // revision ใหม่ของชิ้นเดียวกันจากผู้ที่ยังไม่เห็น B2 = ชน · ชิ้นอื่นไม่ถูกขวาง
  assert.equal((await save({ boms: { upsert: [bom("B3", "FG-1", "approved", "P-1", 3)] } }, 4)).error.code, "BOM_STALE", "a second new revision of the same item from an old base");
  assert.equal((await save({ items: { upsert: [item("FG-2", "FG")] }, boms: { upsert: [bom("B4", "FG-2", "approved", "P-1", 3)] } }, 4)).error, null, "another item is not blocked");

  // ชุดสี/แพ็กเกจ: ลบ → หลุมฝังศพ → ส่ง delete ใน delta · ผู้อื่นลบแล้วแก้/ลบซ้ำจาก base เก่า = ชน
  assert.equal((await save({ colorSets: { upsert: [{ base: "X", code: "A", slots: [] }] }, packages: { upsert: [{ base: "X", code: "P", lines: [] }] } }, 6)).error, null);
  const removed = await save({ colorSets: { delete: [{ base: "X", code: "A" }] }, compounds: { delete: [{ code: "x" }] } }, 7);
  assert.equal(removed.error.code, "BOM_INVALID_CHANGES", "only colour sets and packages can be deleted");
  assert.equal((await save({ colorSets: { delete: [{ base: "X", code: "A" }] } }, 6)).error.code, "BOM_STALE", "deleting a record that changed after the base");
  const deleted = await save({ colorSets: { delete: [{ base: "X", code: "A" }] } }, 7);
  assert.deepEqual(deleted.data.changes.colorSets, { upsert: [], delete: [{ base: "X", code: "A" }] }, "a deletion is a tombstone in the reply");
  assert.deepEqual((await since(7)).data.changes.colorSets.delete, [{ base: "X", code: "A" }]);
  assert.deepEqual((await since(8)).data.changes.colorSets.delete, []);
  assert.equal((await save({ colorSets: { upsert: [{ base: "X", code: "A", slots: [{ key: "k" }] }] } }, 7)).error.code, "BOM_STALE", "editing a record deleted after the base");
  assert.equal((await save({ colorSets: { delete: [{ base: "X", code: "A" }] } }, 7)).error.code, "BOM_STALE", "deleting what someone already deleted");
  assert.equal((await save({ colorSets: { delete: [{ base: "X", code: "A" }] } }, 8)).error.code, "BOM_NOT_FOUND");
  assert.equal((await save({ colorSets: { upsert: [{ base: "X", code: "A", slots: [] }] } }, 8)).error, null, "created again from the current version");
  assert.deepEqual((await since(7)).data.changes.colorSets.delete, [], "creating the key again drops its tombstone");
  assert.equal((await client.rpc("app_bom_master")).data.colorSets.length, 1);

  // สิทธิ์: ผู้เขียนคือ admin ผู้จัดการแผนกขึ้นไป หรือแผนก PP
  const me = db.employees[0];
  const version = (await client.rpc("app_bom_master")).data.version;
  me.role_id = "role-staff";
  assert.equal((await save({}, version)).error.code, "BOM_FORBIDDEN", "a staff member of another department may read but not write");
  assert.equal((await client.rpc("app_bom_master")).error, null, "everyone signed in reads");
  assert.equal((await since(0)).error, null, "and reads the delta");
  me.role_id = "role-dm";
  assert.equal((await save({}, version)).error, null, "a department manager writes");
  me.role_id = "role-staff";
  db.departments.push({ id: "dep-pp", code: "PP", name_th: "วางแผน", is_active: true, is_repair_site: false });
  me.department_id = "dep-pp";
  assert.equal((await save({}, version)).error, null, "the planning department writes");

  const outside = createMockSupabase({ now: () => NOW });
  assert.equal((await outside.client.rpc("app_bom_master")).error.code, "BOM_TEST_MODE_ONLY");
  assert.equal((await outside.client.rpc("app_bom_master_since", { p_version: 0 })).error.code, "BOM_TEST_MODE_ONLY");
  assert.equal((await outside.client.rpc("app_bom_save_master", { p_changes: {}, p_base_version: 0, p_action: "t" })).error.code, "BOM_TEST_MODE_ONLY");
});

test("the mock database follows the real revision rule: owner department and an appended change log may change, anything else is BOM_REVISION_IMMUTABLE", async () => {
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW });
  const save = (changes, version) => client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: version, p_action: "t" });
  const part = (code, kind) => ({ code, kind, name: code, ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true });
  const bom = { id: "B1", itemCode: "FG-1", revision: 1, status: "approved", ownerDept: "PK", lines: [{ childCode: "P-1", qty: 1 }], note: "", changeLog: [{ at: NOW, by: "ก", text: "สร้าง" }] };
  assert.equal((await save({ items: { upsert: [part("FG-1", "FG"), part("P-1", "PURCHASED")] } }, 0)).error, null);
  assert.equal((await save({ boms: { upsert: [bom] } }, 1)).error, null);
  assert.equal((await save({ boms: { upsert: [{ ...bom, ownerDept: "ST" }] } }, 2)).error, null, "the owner department can be moved");
  const appended = { ...bom, ownerDept: "ST", changeLog: [...bom.changeLog, { at: NOW, by: "ข", text: "ย้ายแผนก" }] };
  assert.equal((await save({ boms: { upsert: [appended] } }, 3)).error, null, "a change log entry can be appended");
  for (const [label, row] of [
    ["a rewritten entry", { ...appended, changeLog: [{ ...bom.changeLog[0], text: "แก้" }, appended.changeLog[1]] }],
    ["a shortened log", { ...appended, changeLog: [] }],
    ["a changed line", { ...appended, lines: [{ childCode: "P-1", qty: 2 }] }],
    ["a changed note", { ...appended, note: "x" }],
  ]) {
    const refused = await save({ boms: { upsert: [row] } }, 4);
    assert.equal(refused.error?.code, "BOM_REVISION_IMMUTABLE", label);
  }
});

test("a failed save while another form is being edited reverts the data but does not redraw the page over what was typed", async () => {
  const env = await dirtyEnv();
  await env.othersSave("P-SAME");
  await env.fire("input", env.event("input"));
  const renders = env.log.renders;
  const saved = await env.store.run("saveItem", saveItemPayload("P-SAME")).saving;
  assert.equal(saved.error.code, "BOM_STALE");
  await new Promise((resolve) => setTimeout0(resolve));
  assert.equal(env.log.renders, renders, "no redraw while a form is dirty");
  await env.render();
  const again = renders + 1;
  await env.othersSave("P-OTHER");
  const fresh = await env.store.run("saveItem", saveItemPayload("P-NEW")).saving;
  assert.equal(fresh.ok, true);
  assert.ok(env.log.renders >= again, "with nothing to protect the page is drawn as before");
});

test("the mock database keeps its data, record versions and tombstones in the page storage", async () => {
  const storage = memoryStorage();
  const first = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  await first.client.rpc("app_bom_save_master", { p_changes: { compounds: { upsert: [{ code: "DM01", name: "x" }] }, colorSets: { upsert: [{ base: "X", code: "A", slots: [] }] } }, p_base_version: 0, p_action: "t" });
  await first.client.rpc("app_bom_save_master", { p_changes: { colorSets: { delete: [{ base: "X", code: "A" }] } }, p_base_version: 1, p_action: "t" });
  const second = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const { data } = await second.client.rpc("app_bom_master");
  assert.equal(data.version, 2);
  assert.deepEqual(data.compounds, [{ code: "DM01", name: "x", createdAt: NOW }], "server-owned fields are stamped by the database");
  assert.equal("versions" in data || "tombstones" in data, false, "the snapshot never shows the bookkeeping");
  const delta = (await second.client.rpc("app_bom_master_since", { p_version: 1 })).data;
  assert.deepEqual(delta.changes.colorSets.delete, [{ base: "X", code: "A" }], "the tombstone survives a reload");
  assert.deepEqual(delta.changes.compounds.upsert, [], "and so do the record versions");
  const broken = createMockSupabase({ sandbox: true, now: () => NOW, storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } });
  assert.equal((await broken.client.rpc("app_bom_save_master", { p_changes: { compounds: { upsert: [{ code: "DM02", name: "y" }] } }, p_base_version: 0, p_action: "t" })).data.version, 1, "a blocked storage keeps the data in memory");
});

test("focusing the page catches up with other users' saves and redraws only when something changed", async () => {
  const handlers = { focus: [], visibilitychange: [] };
  const env = await pageEnv({ hooks: { onWindow: (type, fn) => handlers[type]?.push(fn), onDocument: (type, fn) => handlers[type]?.push(fn) } });
  await env.store.ensureLoaded();
  assert.equal(handlers.focus.length, 1, "the module listens for the window gaining focus");
  assert.equal(handlers.visibilitychange.length, 1, "and for the tab becoming visible");
  const fire = async (type = "focus") => { handlers[type].forEach((fn) => fn()); await new Promise((resolve) => setTimeout0(resolve)); };
  const rendersBefore = env.log.renders;

  await fire();
  assert.equal(env.log.renders, rendersBefore, "nothing changed: no redraw");

  // ผู้ใช้อื่นบันทึก (Supabase จำลองตัวเดียวกัน)
  const other = await env.mock.client.rpc("app_bom_save_master", { p_changes: { items: { upsert: [{ code: "P-OTHER", kind: "PURCHASED", name: "ของคนอื่น", ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true }] } }, p_base_version: 0, p_action: "saveItem" });
  assert.equal(other.error, null);
  env.log.hash = "#/home";
  await fire();
  assert.equal(env.store.data().items.length, 0, "away from the BOM pages the focus does nothing");
  env.log.hash = "#/bom";
  await fire("visibilitychange");
  assert.deepEqual(Array.from(env.store.data().items, (item) => item.code), ["P-OTHER"]);
  assert.equal(env.store.version(), 1);
  assert.equal(env.log.renders, rendersBefore + 1, "the page redrew once");
  await fire();
  await fire("visibilitychange");
  assert.equal(env.log.renders, rendersBefore + 1, "no change since: no further redraw");
  assert.deepEqual(env.log.toasts, []);
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

// ---------- ฟอร์มที่แก้ค้าง: catch-up ต้องไม่รวมข้อมูลของผู้อื่นหรือขยับเวอร์ชันฐานใต้ฟอร์ม ----------
async function dirtyEnv(hooks = {}) {
  const handlers = {};
  const add = (type, fn) => (handlers[type] ??= []).push(fn);
  const env = await pageEnv({ hooks: { onWindow: add, onDocument: add, ...hooks } });
  await env.store.ensureLoaded();
  // event ของเบราว์เซอร์: target.closest ตอบตามตารางที่ให้ (".content" มีเสมอ) · fire ส่งให้ทุก listener ที่หน้าลงทะเบียนไว้แล้วรอให้งานค้างจบ
  const event = (type, { trusted = true, inside = {}, extra = {} } = {}) => ({ type, isTrusted: trusted, target: { closest: (selector) => (selector === ".content" ? {} : selector.includes("[data-rf-search]") ? inside.search ?? null : inside[selector] ?? null) }, ...extra });
  const fire = async (type, ev) => { for (const fn of handlers[type] ?? []) fn(ev ?? { type }); await new Promise((resolve) => setTimeout0(resolve)); };
  const othersSave = (code) => env.mock.client.rpc("app_bom_save_master", { p_changes: { items: { upsert: [{ code, kind: "PURCHASED", name: "ของคนอื่น", ownerDept: "ST", uom: "pcs", weightG: 0, legacyCodes: [], active: true }] } }, p_base_version: 0, p_action: "saveItem" });
  return Object.assign(env, { handlers, event, fire, othersSave });
}
const NOTICE = /ระบบจะรวมข้อมูลล่าสุดให้/;

test("a form with unsaved edits holds the catch-up: no merge, no redraw, the base version stays, one notice; the save is then checked against that base and the conflict is found", async () => {
  const env = await dirtyEnv();
  assert.equal((await env.othersSave("P-SAME")).error, null);
  const renders = env.log.renders;
  // แถวที่ลบ/ลากในตารางสร้าง BOM มีแต่ใน DOM: เหลือโฟกัสที่ body แล้ว ต้องนับจาก event ที่ส่งจริง
  await env.fire("click", env.event("click", { inside: { button: { type: "button" } } }));
  await env.fire("focus");
  assert.equal(env.store.version(), 0, "the base version did not move under the open form");
  assert.deepEqual(env.store.data().items, []);
  assert.equal(env.log.renders, renders, "and nothing was redrawn over it");
  assert.equal(env.store.hasNewer(), true);
  assert.equal(env.log.toasts.filter(([message]) => NOTICE.test(message)).length, 1, "one small notice in Thai");
  await env.fire("focus");
  await env.fire("visibilitychange");
  assert.equal(env.log.toasts.filter(([message]) => NOTICE.test(message)).length, 1, "not repeated on every focus");

  // บันทึกจากฟอร์มเดิม (ชิ้นเดียวกับที่ผู้อื่นแก้) → ฐานข้อมูลเห็นว่าชน
  const out = env.store.run("saveItem", saveItemPayload("P-SAME"));
  assert.equal(out.ok, true);
  const saved = await out.saving;
  assert.equal(saved.ok, false);
  assert.equal(saved.error.code, "BOM_STALE", "the other user's record is not overwritten silently");
  // ฟอร์มยังเปิดอยู่ตอนชน: ย้อนกลับแต่ไม่ดึงงานของผู้อื่นเข้ามา (ฟอร์มอื่นที่ค้างอยู่จะได้ไม่ส่งทับด้วยเวอร์ชันใหม่) · วาดหน้าใหม่ = ฟอร์มจบแล้ว จึงรวม
  assert.deepEqual(Array.from(env.store.data().items, (item) => item.name), []);
  assert.equal(env.store.version(), 0);
  assert.equal(env.store.hasNewer(), true);
  await env.render();
  await new Promise((resolve) => setTimeout0(resolve));
  assert.deepEqual(Array.from(env.store.data().items, (item) => item.name), ["ของคนอื่น"]);
  assert.equal(env.store.hasNewer(), false);
});

test("every kind of edit marks the page dirty (typing, a row button, a drag handle by pointer or keyboard); scripted events, the search box and submit buttons do not", async () => {
  const edits = {
    "typing": ["input", { inside: {} }],
    "a select": ["change", { inside: {} }],
    "a button inside the form": ["click", { inside: { button: { type: "button" } } }],
    "dragging a row handle": ["pointerdown", { inside: { "[data-drag-handle]": {} }, extra: { button: 0 } }],
    "moving a row by keyboard": ["keydown", { inside: { "[data-drag-handle]": {} }, extra: { key: "ArrowDown" } }],
  };
  for (const [name, [type, options]] of Object.entries(edits)) {
    const env = await dirtyEnv();
    await env.othersSave("P-X");
    await env.fire(type, env.event(type, options));
    await env.fire("focus");
    assert.equal(env.store.version(), 0, `${name}: the page is dirty, so nothing was merged`);
    assert.equal(env.store.hasNewer(), true, name);
  }
  const noEdits = {
    "a scripted (untrusted) event": ["input", { trusted: false, inside: {} }],
    "the search box": ["input", { inside: { search: {} } }],
    "a submit button": ["click", { inside: { button: { type: "submit" } } }],
    "a pointer on something that is not a handle": ["pointerdown", { inside: {}, extra: { button: 0 } }],
    "another key on a handle": ["keydown", { inside: { "[data-drag-handle]": {} }, extra: { key: "Tab" } }],
  };
  for (const [name, [type, options]] of Object.entries(noEdits)) {
    const env = await dirtyEnv();
    await env.othersSave("P-X");
    const renders = env.log.renders;
    await env.fire(type, env.event(type, options));
    await env.fire("focus");
    assert.deepEqual(Array.from(env.store.data().items, (item) => item.code), ["P-X"], `${name}: nothing is being edited, so the catch-up merged`);
    assert.equal(env.log.renders, renders + 1, name);
  }
});

test("an open dialog holds the catch-up even before anything is typed, and the notice is not shown for an update with nothing new", async () => {
  let dialog = true;
  const env = await dirtyEnv({ dialogOpen: () => dialog });
  await env.fire("focus");
  assert.deepEqual(env.log.toasts, [], "nothing newer: no notice");
  await env.othersSave("P-D");
  await env.fire("focus");
  assert.equal(env.store.version(), 0);
  assert.deepEqual(env.store.data().items, []);
  assert.equal(env.store.hasNewer(), true);
  dialog = false;
  await env.fire("focus");
  assert.deepEqual(Array.from(env.store.data().items, (item) => item.code), ["P-D"], "once the dialog is closed the next focus merges as before");
  assert.equal(env.store.hasNewer(), false);
});

test("drawing a fresh page clears the dirty state and merges what was held", async () => {
  const env = await dirtyEnv();
  await env.othersSave("P-HELD");
  await env.fire("input", env.event("input"));
  await env.fire("focus");
  assert.equal(env.store.hasNewer(), true);
  const renders = env.log.renders;
  await env.render();
  await new Promise((resolve) => setTimeout0(resolve));
  assert.deepEqual(Array.from(env.store.data().items, (item) => item.code), ["P-HELD"], "the fresh page has no form to protect, so the held data is merged");
  assert.equal(env.store.hasNewer(), false);
  assert.equal(env.log.renders, renders + 1, "and drawn once");
});

test("the server re-stamps a saved record: the user's own save is not reported as someone else's update and draws silently", async () => {
  const env = await dirtyEnv();
  const outcomes = [];
  env.store.subscribe((e) => { if (e.type === "saved") outcomes.push([e.changed, e.others]); });
  const out = env.store.run("saveItem", saveItemPayload("P-MINE"));
  assert.equal((await out.saving).ok, true);
  assert.deepEqual(outcomes, [[true, false]], "stamps differ from what was sent (changed) but nothing foreign came back (others)");
  assert.equal(env.log.toasts.filter(([message]) => /ผู้อื่น/.test(message)).length, 0, "no 'others updated' notice");
  const savedItem = (await env.mock.client.rpc("app_bom_master")).data.items[0];
  assert.equal(typeof savedItem.createdAt, "number");
  assert.equal(savedItem.code, "P-MINE");
});

function setTimeout0(fn) {
  return setImmediate(fn);
}
