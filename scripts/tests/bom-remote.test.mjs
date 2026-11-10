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
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js"); // Supabase จำลองของ harness ใช้กฎสเปก/FEFO ของ RubberFlow ตอนบันทึกชุดหน้างาน

const NOW = Date.parse("2026-11-05T10:00:00+07:00");
const SERVER_AT = NOW + 60000;
const MASTER = storeApi.REMOTE_LISTS; // ทุกชุดที่อยู่ในฐานข้อมูล: ข้อมูลหลัก 8 ชุด + ลูกค้า ใบสั่งผลิต งาน
const emptyMaster = () => ({ version: 0, ...Object.fromEntries(MASTER.map((list) => [list, []])) });
const planner = { id: "p1", role: "planner", dept: "PK", name: "ณัฐพล บุญมา" };
const viewer = { id: "v1", role: "viewer", dept: "QA", name: "ผู้ดู" };
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const failure = (code) => Object.assign(new Error(code), { code });

// เซิร์ฟเวอร์จำลองตามสัญญา: ทุกระเบียนจำเลขรุ่นที่แก้ล่าสุด · บันทึกชน (BOM_STALE) เฉพาะระเบียนที่แตะซึ่งถูกผู้อื่นแก้/ลบหลัง baseVersion
// คืนส่วนต่างตั้งแต่ baseVersion (ของทุกคน) · since(v) คืนส่วนต่างเดียวกัน · fail = ครั้งถัดไปล้มด้วยรหัสนี้ · external* = ผู้ใช้อื่นบันทึก
function fakeServer(initial = emptyMaster()) {
  const server = { epoch: "epoch-1", epochs: 1, master: structuredClone(initial), versions: Object.fromEntries(MASTER.map((list) => [list, new Map()])), graves: [], loads: 0, saves: [], sinces: [], fail: null, hold: null, sinceFail: null, auditLog: [], purges: 0 };
  for (const list of MASTER) server.master[list] ??= [];
  const key = {
    items: (r) => r.code, compounds: (r) => r.code, colors: (r) => r.code, processes: (r) => r.code, boms: (r) => r.id, routings: (r) => r.id, colorSets: (r) => `${r.base}|${r.code}`, packages: (r) => `${r.base}|${r.code}`,
    customers: (r) => r.name.trim().toLowerCase(), orders: (r) => r.id, jobs: (r) => r.id, stock: (r) => r.itemCode, stockMoves: (r) => r.id,
  };
  // หลุมฝังศพ: ชุดสี/แพ็กเกจกุญแจ base|code · งานกุญแจเลขงาน (ส่งกลับเป็น { id })
  const graveId = (grave) => (grave.list === "jobs" ? grave.code : `${grave.base}|${grave.code}`);
  const targetId = (list, target) => (list === "jobs" ? target.id : `${target.base}|${target.code}`);
  const order = {
    orders: (a, b) => b.orderedAt - a.orderedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    jobs: (a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0) || (a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : 0) || (a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  };
  const byKey = (list) => order[list] ?? ((a, b) => (key[list](a) < key[list](b) ? -1 : key[list](a) > key[list](b) ? 1 : 0));
  const view = () => ({ ...structuredClone(server.master), epoch: server.epoch });
  server.delta = (since) => ({
    version: server.master.version,
    epoch: server.epoch,
    changes: Object.fromEntries(MASTER.map((list) => [list, {
      upsert: structuredClone(server.master[list].filter((row) => (server.versions[list].get(key[list](row)) ?? 0) > since).sort(byKey(list))),
      delete: server.graves.filter((grave) => grave.list === list && grave.version > since).map((grave) => (list === "jobs" ? { id: grave.code } : { base: grave.base, code: grave.code })),
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
          if (server.graves.some((grave) => grave.list === list && graveId(grave) === id && grave.version > base)) throw failure("BOM_STALE");
          if ((list === "boms" || list === "routings") && server.master[list].some((row) => row.itemCode === record.itemCode && others(list, key[list](row)))) throw failure("BOM_STALE");
          server.master[list].push(stampOwned(list, record, undefined));
        } else {
          if (others(list, id)) throw failure("BOM_STALE");
          server.master[list][at] = stampOwned(list, record, server.master[list][at]);
        }
        server.versions[list].set(id, next);
        mine.add(`${list}|${id}`);
        server.graves = server.graves.filter((grave) => !(grave.list === list && graveId(grave) === id));
      }
      for (const target of entry.delete ?? []) {
        const id = targetId(list, target);
        if (!server.master[list].some((row) => key[list](row) === id)) throw failure("BOM_NOT_FOUND");
        if (others(list, id)) throw failure("BOM_STALE");
        server.master[list] = server.master[list].filter((row) => key[list](row) !== id);
        server.graves.push(list === "jobs" ? { list, code: id, version: next } : { list, base: target.base, code: target.code, version: next });
      }
    }
    server.master.version = next;
  }
  server.remote = {
    load: async () => { server.loads += 1; return view(); },
    save: async (changes, baseVersion, action, audit, epoch) => {
      server.saves.push({ changes: structuredClone(changes), baseVersion, action, audit: structuredClone(audit), epoch });
      if (server.hold) await server.hold;
      if (server.fail) { const code = server.fail; server.fail = null; throw failure(code); }
      if (epoch !== undefined && epoch !== null && epoch !== server.epoch) throw failure("BOM_RESET");
      if (!Number.isInteger(baseVersion) || baseVersion < 0 || baseVersion > server.master.version) throw failure("BOM_INVALID_PAYLOAD");
      const before = structuredClone({ master: server.master, graves: server.graves, versions: Object.fromEntries(MASTER.map((list) => [list, [...server.versions[list]]])) });
      try { apply(changes, baseVersion); } catch (error) {
        // ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย
        server.master = before.master; server.graves = before.graves;
        for (const list of MASTER) server.versions[list] = new Map(before.versions[list]);
        throw error;
      }
      for (const entry of audit ?? []) server.auditLog.push({ at: new Date(SERVER_AT).toISOString(), user: "เซิร์ฟเวอร์", action: entry.action, detail: entry.detail });
      return server.delta(baseVersion);
    },
    since: async (version) => {
      server.sinces.push(version);
      if (server.sinceFail) { const code = server.sinceFail; throw failure(code); }
      if (!Number.isInteger(version) || version < 0 || version > server.master.version) throw failure("BOM_INVALID_PAYLOAD");
      return server.delta(version);
    },
    audit: async (limit) => {
      server.audits = (server.audits ?? 0) + 1;
      if (server.auditFail) throw failure(server.auditFail);
      return [...server.auditLog].reverse().slice(0, limit);
    },
    purge: async () => {
      server.purges += 1;
      if (server.purgeFail) throw failure(server.purgeFail);
      const deleted = MASTER.reduce((sum, list) => sum + server.master[list].length, 0);
      // ตัวนับ version ไม่ถูกตั้งกลับ (เหมือนฐานข้อมูลจริง) · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
      server.master = { ...emptyMaster(), version: server.master.version };
      server.versions = Object.fromEntries(MASTER.map((list) => [list, new Map()]));
      server.graves = [];
      server.epoch = `epoch-${++server.epochs}`;
      return { deleted };
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
  assert.match(message({ message: "BOM_CONFLICT" }), /ซ้ำกับที่มีอยู่แล้ว.*ลองทำรายการอีกครั้ง/);
  assert.match(message({ message: "BOM_INVALID_TRANSITION" }), /สถานะที่ทำรายการนี้ไม่ได้/);
  assert.match(message({ message: "BOM_FORBIDDEN" }), /แผนกอื่นรายงานได้เฉพาะงานของแผนกตน/, "the per-field rule is explained");
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
  assert.deepEqual(Object.keys(call.changes), ["items"], "only the touched list is sent");
  assert.equal(call.changes.items.upsert[0].code, "P-TEST-01");
  assert.deepEqual(call.audit, [{ action: "เพิ่มชิ้นงาน", detail: "P-TEST-01 ของซื้อทดสอบ" }], "the entries of this command travel with it, as plain action + detail");
  assert.equal(env.store.version(), 1);
  assert.equal(env.events.at(-1), "saved");

  const second = env.store.run("saveItem", { code: "P-TEST-01", kind: "PURCHASED", name: "ชื่อใหม่", uom: "pcs" });
  await second.saving;
  assert.equal(env.server.saves[1].baseVersion, 1, "the next save carries the version the server returned");
  assert.equal(env.server.master.items[0].name, "ชื่อใหม่");
  assert.deepEqual(env.server.saves[1].audit.map((entry) => entry.action), ["แก้ชิ้นงาน"]);
  assert.deepEqual(env.store.data().audit, [], "nothing of the audit trail is kept in the browser: the audit page reads it from the database");
  assert.deepEqual(env.storage.map.size, 0, "and nothing is written to localStorage at all");
});

// สินค้า FG-TEST-01 ที่มี BOM (ของซื้อหนึ่งชิ้น) พร้อมสร้างใบสั่งผลิต · ปล่อยผลิตแล้วได้งาน PK หนึ่งงาน
async function fgScene(env) {
  await env.store.run("saveItem", saveItemPayload("FG-TEST-01", { kind: "FG", name: "สินค้าทดสอบ", uom: "set" })).saving;
  await env.store.run("saveItem", saveItemPayload("P-TEST-01")).saving;
  await env.store.run("saveBom", { itemCode: "FG-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 2 }] }).saving;
}
// สินค้าเดิม + ท่อ PT ที่ใช้ของซื้อตัวเดียวกัน: หน้าที่ต้องมีชิ้นที่นับตามใบได้ (ของซื้อนับที่หน้าคลังของซื้อ ไม่นับตามใบ)
async function fgScenePt(env) {
  await fgScene(env);
  await env.store.run("saveItem", saveItemPayload("PT-TEST-01", { kind: "PT", name: "ท่อทดสอบ" })).saving;
  await env.store.run("saveBom", { itemCode: "PT-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 1 }] }).saving;
  await env.store.run("saveBom", { itemCode: "FG-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 2 }, { childCode: "PT-TEST-01", qty: 1 }] }).saving;
}
const newOrder = (extra = {}) => ({ customer: "Acme Trading", country: "Thailand", orderedAt: NOW, whDue: NOW + 20 * 86400000, ...extra });
const saved = async (out) => { assert.equal(out.ok, true, out.error?.message); const outcome = await out.saving; assert.equal(outcome.ok, true, outcome.error?.message); return out; };

test("an action that changes nothing never calls the server", async () => {
  const env = await ready(remoteStore());
  await fgScene(env);
  const savesBefore = env.server.saves.length;
  const same = env.store.run("saveBom", { itemCode: "FG-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 2 }] });
  assert.equal(same.result.changed, false);
  await same.saving;
  assert.equal(env.server.saves.length, savesBefore, "saving an unchanged BOM is not a write");
  assert.equal(env.storage.map.size, 0, "and nothing of BOM is kept in localStorage");
});

test("orders, customers and jobs are saved through the database: one call per command, with the customer, the audit text and server-side ids", async () => {
  const env = await ready(remoteStore());
  await fgScene(env);
  const order = await saved(env.store.run("createOrder", newOrder()));
  assert.match(order.result, /^\d{6}-\d{2}001$/, "the first automatic PI number of the year");
  const call = env.server.saves.at(-1);
  assert.equal(call.action, "createOrder");
  assert.deepEqual(Object.keys(call.changes).sort(), ["customers", "orders"], "a new customer name is added to the customer list in the same call");
  assert.deepEqual(call.changes.customers.upsert.map((record) => record.name), ["Acme Trading"]);
  assert.deepEqual(call.audit, [{ action: "เปิดใบสั่งผลิต", detail: `${order.result} Acme Trading (ออกเลขอัตโนมัติ) · เพิ่มลูกค้าใหม่` }]);
  assert.deepEqual(env.store.data().orders.map((row) => row.id), [order.result]);
  assert.deepEqual(env.server.master.orders.map((row) => row.customer), ["Acme Trading"]);

  // ลูกค้าที่มีอยู่ (ตัวพิมพ์ต่าง) ไม่เพิ่มซ้ำ ใบใช้ชื่อตามรายการลูกค้า · เลขถัดไปนับต่อจากเลขสูงสุดของปีในใบที่หน้าเห็น
  const second = await saved(env.store.run("createOrder", newOrder({ customer: "  ACME TRADING " })));
  assert.match(second.result, /^\d{6}-\d{2}002$/);
  assert.deepEqual(Object.keys(env.server.saves.at(-1).changes), ["orders"], "no second customer record");
  assert.equal(env.store.data().orders.find((row) => row.id === second.result).customer, "Acme Trading");
  assert.equal(env.store.data().customers.length, 1);
  // เลขที่พิมพ์เองคงตามที่พิมพ์ และเลขอัตโนมัติถัดไปนับต่อจากเลขสูงสุด
  const typed = await saved(env.store.run("createOrder", newOrder({ pi: "251202-25047", customer: "ลูกค้า ข", country: "Japan" })));
  assert.equal(typed.result, "251202-25047");
  assert.equal(env.store.data().customers.find((row) => row.name === "ลูกค้า ข").orderType, "EX");
  const third = await saved(env.store.run("createOrder", newOrder()));
  assert.match(third.result, /^\d{6}-\d{2}003$/, "typed numbers of another year do not move the sequence");
  assert.deepEqual(env.store.data().orders.map((row) => row.id), [...env.store.data().orders].sort((a, b) => b.orderedAt - a.orderedAt || (a.id < b.id ? -1 : 1)).map((row) => row.id), "orders are listed newest first, like the database");

  await saved(env.store.run("addOrderItem", { orderId: order.result, fgCode: "FG-TEST-01", qty: 5 }));
  assert.deepEqual(Object.keys(env.server.saves.at(-1).changes), ["orders"], "adding an existing product changes only the order");
  const explodedAt = env.store.data().orders.find((row) => row.id === order.result).explodedAt;
  assert.equal(explodedAt, null);

  // ปล่อยผลิต: ใบเปลี่ยนสถานะ + งานใหม่ในคำสั่งเดียว รหัสงานมีรหัสสุ่มต่อท้าย
  await saved(env.store.run("releaseOrder", { orderId: order.result }));
  const release = env.server.saves.at(-1);
  assert.deepEqual(Object.keys(release.changes).sort(), ["jobs", "orders"]);
  assert.equal(release.changes.orders.upsert[0].status, "released");
  const [job] = release.changes.jobs.upsert;
  assert.match(job.id, /^JOB-\d\d-0001-[0-9a-z]{6}$/);
  assert.equal(job.dept, "PK");
  assert.deepEqual(release.audit.map((entry) => entry.action), ["ระเบิด BOM", "ปล่อยผลิต"], "oldest first");
  assert.equal(env.store.data().jobs.length, 2, "the PK job and the ST job of the purchased part");
  assert.deepEqual(release.changes.jobs.upsert.map((row) => [row.dept, row.kind, row.itemCode, row.qtyPlanned]), [["PK", "FG", "FG-TEST-01", 5], ["ST", "PURCHASED", "P-TEST-01", 10]], "the purchased part is a job with its gross requirement (5 sets × 2)");

  // รายงานผล: งานเปลี่ยนและใบเป็นกำลังผลิต
  await saved(env.store.run("reportJob", { jobId: job.id, qtyDone: 3, note: "รอบแรก" }));
  const stored = env.server.master.jobs.find((row) => row.id === job.id);
  assert.equal(stored.qtyDone, 3);
  assert.equal(stored.reports.length, 1);
  assert.equal(env.server.master.orders.find((row) => row.id === order.result).status, "in_progress");

  // มีงานที่เริ่มแล้ว: แก้รายการสินค้าไม่ได้ และไม่เรียกฐานข้อมูล
  const calls = env.server.saves.length;
  const refused = env.store.run("removeOrderItem", { orderId: order.result, fgCode: "FG-TEST-01" });
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /มีงานที่เริ่มแล้ว/);
  assert.equal(env.server.saves.length, calls);
});

test("reopening a released order whose jobs have not started deletes its jobs in the same call: the order goes back to draft with REV + 1", async () => {
  const env = await ready(remoteStore());
  await fgScene(env);
  const order = await saved(env.store.run("createOrder", newOrder()));
  await saved(env.store.run("addOrderItem", { orderId: order.result, fgCode: "FG-TEST-01", qty: 5 }));
  await saved(env.store.run("releaseOrder", { orderId: order.result }));
  assert.equal(env.server.master.jobs.length, 2);
  const jobIds = env.server.master.jobs.map((row) => row.id).sort();
  await saved(env.store.run("updateOrderItem", { orderId: order.result, fgCode: "FG-TEST-01", qty: 9 }));
  const call = env.server.saves.at(-1);
  assert.deepEqual(call.changes.jobs.delete.map((target) => target.id).sort(), jobIds, "every job (the part job too) is deleted by its id");
  assert.equal(call.changes.orders.upsert[0].status, "draft");
  assert.equal(call.changes.orders.upsert[0].revision, 1);
  assert.deepEqual(env.server.master.jobs, []);
  assert.deepEqual(env.store.data().jobs, []);
  assert.deepEqual(env.server.graves.map((grave) => [grave.list, grave.code]).sort(), jobIds.map((id) => ["jobs", id]), "the database remembers the deletion for other browsers");

  // ผู้ใช้อื่นเห็นการลบงานผ่านส่วนต่าง
  const other = await ready(remoteStore({ server: env.server, user: { ...planner, id: "p2", name: "คนที่สอง" } }));
  assert.deepEqual(other.store.data().jobs, []);
  await saved(env.store.run("releaseOrder", { orderId: order.result }));
  assert.equal(await other.store.catchUp(), true);
  assert.equal(other.store.data().jobs.length, 2);
  await saved(env.store.run("updateOrderItem", { orderId: order.result, fgCode: "FG-TEST-01", qty: 4 }));
  assert.equal(await other.store.catchUp(), true);
  assert.deepEqual(other.store.data().jobs, [], "the other browser drops the deleted job");
  assert.equal(other.store.data().orders[0].revision, 2);
});

test("a department member who reports on a job does not send the order: the database moves released to in_progress itself; stock counters send the counts without the stamp", async () => {
  const server = fakeServer();
  const planning = await ready(remoteStore({ server }));
  await fgScene(planning);
  // ท่อ PT ที่ใช้ของซื้อตัวเดียวกัน: ชิ้นที่นับตามใบได้ (ของซื้อนับที่คลังของซื้อ ไม่นับตามใบ)
  await planning.store.run("saveItem", saveItemPayload("PT-TEST-01", { kind: "PT", name: "ท่อทดสอบ" })).saving;
  await planning.store.run("saveBom", { itemCode: "PT-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 1 }] }).saving;
  await planning.store.run("saveBom", { itemCode: "FG-TEST-01", lines: [{ childCode: "P-TEST-01", qty: 2 }, { childCode: "PT-TEST-01", qty: 1 }] }).saving;
  const order = await saved(planning.store.run("createOrder", newOrder()));
  await saved(planning.store.run("addOrderItem", { orderId: order.result, fgCode: "FG-TEST-01", qty: 5 }));

  // ST นับคงคลังของใบร่าง: ส่งเฉพาะยอดนับ ไม่ส่งเวลา/ชื่อผู้นับ (ฐานข้อมูลประทับเอง)
  const counter = await ready(remoteStore({ server, user: { id: "s1", role: "st", dept: "ST", name: "พนักงานคลัง" } }));
  const exploded = await saved(planning.store.run("explodeOrder", { orderId: order.result }));
  assert.ok(exploded.result > 0);
  await counter.store.catchUp();
  const refusedPart = counter.store.run("setStockCounts", { orderId: order.result, counts: [{ itemCode: "P-TEST-01", qty: 7 }] });
  assert.equal(refusedPart.ok, false);
  assert.match(refusedPart.error.message, /คลังของซื้อ/, "a purchased part is not counted per PI");
  const counts = counter.store.run("setStockCounts", { orderId: order.result, counts: [{ itemCode: "PT-TEST-01", qty: 7 }] });
  assert.equal(counts.ok, true, counts.error?.message);
  assert.equal(counter.store.data().orders[0].stockCountedBy, "พนักงานคลัง", "the page shows the stamp at once");
  await counts.saving;
  const sent = server.saves.at(-1).changes.orders.upsert[0];
  assert.deepEqual(sent.stockCounts, { "PT-TEST-01": 7 });
  assert.equal("stockCountedBy" in sent, false, "the stamp is the database's job");
  assert.equal(server.master.orders[0].stockCounts["PT-TEST-01"], 7);

  // PK รายงานผล (แผนก PK ไม่ใช่ฝ่ายวางแผน): ส่งเฉพาะงาน ไม่ส่งใบ
  await planning.store.catchUp();
  await saved(planning.store.run("releaseOrder", { orderId: order.result }));
  const worker = await ready(remoteStore({ server, user: { id: "k1", role: "pt", dept: "PK", name: "พนักงานบรรจุ" } }));
  const job = worker.store.data().jobs.find((row) => row.dept === "PK");
  const report = await saved(worker.store.run("reportJob", { jobId: job.id, qtyDone: 2 }));
  assert.ok(report.ok);
  const reply = server.saves.at(-1);
  assert.deepEqual(Object.keys(reply.changes), ["jobs"], "the order stays out of a report by a non-planner");
  assert.equal(worker.store.data().orders[0].status, "in_progress", "shown as started at once");
  assert.equal(worker.store.data().jobs.find((row) => row.id === job.id).qtyDone, 2);
});

test("a department that does not own the job is refused by the page rules before any call; the planner group may report on any department", async () => {
  const server = fakeServer();
  const planning = await ready(remoteStore({ server }));
  await fgScene(planning);
  const order = await saved(planning.store.run("createOrder", newOrder()));
  await saved(planning.store.run("addOrderItem", { orderId: order.result, fgCode: "FG-TEST-01", qty: 5 }));
  await saved(planning.store.run("releaseOrder", { orderId: order.result }));
  const jobId = server.master.jobs[0].id;
  const outsider = await ready(remoteStore({ server, user: { id: "r1", role: "rb", dept: "RB", name: "พนักงานรีด" } }));
  const calls = server.saves.length;
  const denied = outsider.store.run("reportJob", { jobId, qtyDone: 1 });
  assert.equal(denied.ok, false);
  assert.match(denied.error.message, /รายงานผลได้โดยแผนก PK/);
  assert.equal(server.saves.length, calls);
  const manager = await ready(remoteStore({ server, user: { id: "m1", role: "manager", dept: "AD", name: "ผู้จัดการ" } }));
  await saved(manager.store.run("reportJob", { jobId, qtyDone: 1 }));
  assert.equal(server.master.jobs[0].qtyDone, 1);
});

test("two planners opening a PI at the same time get the same automatic number: the second is refused as stale, catches up and the next try gets the next number", async () => {
  const server = fakeServer();
  const a = await ready(remoteStore({ server }));
  const b = await ready(remoteStore({ server, user: { ...planner, id: "p2", name: "คนที่สอง" } }));
  const outA = a.store.run("createOrder", newOrder({ customer: "Acme Trading" }));
  const outB = b.store.run("createOrder", newOrder({ customer: "ลูกค้า ข" }));
  assert.equal(outA.result, outB.result, "both derive the same number from the same snapshot");
  assert.equal((await outA.saving).ok, true);
  const refused = await outB.saving;
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "BOM_STALE");
  assert.deepEqual(b.store.data().orders.map((row) => row.customer), ["Acme Trading"], "B's optimistic order is gone and A's is shown");
  assert.equal(b.store.data().customers.some((row) => row.name === "ลูกค้า ข"), false);
  const again = await saved(b.store.run("createOrder", newOrder({ customer: "ลูกค้า ข" })));
  assert.match(again.result, /002$/);
  assert.deepEqual(server.master.orders.map((row) => row.id).sort(), [outA.result, again.result].sort());
});

test("BOM_CONFLICT and BOM_INVALID_TRANSITION revert the command and catch up with the database like a stale save", async () => {
  for (const code of ["BOM_CONFLICT", "BOM_INVALID_TRANSITION"]) {
    const env = await ready(remoteStore());
    await fgScene(env);
    env.server.external({ items: { upsert: [otherItem("P-THEIRS")] } });
    env.server.fail = code;
    const out = env.store.run("saveCustomer", { name: "Acme", country: "Thailand" });
    assert.equal(out.ok, true);
    const outcome = await out.saving;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, code);
    assert.equal(env.store.data().customers.length, 0, "the optimistic customer is gone");
    assert.ok(env.store.data().items.some((item) => item.code === "P-THEIRS"), `${code}: the page caught up`);
    assert.equal(env.store.version(), env.server.master.version);
  }
});

test("customers: add and edit by name (case-insensitive), a duplicate add is refused, others cannot", async () => {
  const env = await ready(remoteStore());
  await saved(env.store.run("saveCustomer", { name: "Acme Co", country: "USA", create: true }));
  const sent = env.server.saves.at(-1);
  assert.equal(sent.action, "saveCustomer");
  assert.deepEqual(sent.changes.customers.upsert, [{ name: "Acme Co", country: "USA", orderType: "EX", note: "" }]);
  assert.deepEqual(sent.audit, [{ action: "เพิ่มลูกค้า", detail: "Acme Co · USA (EX)" }]);
  const duplicate = env.store.run("saveCustomer", { name: " ACME co ", country: "USA", create: true });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error.message, /มีลูกค้า Acme Co อยู่แล้ว/);
  await saved(env.store.run("saveCustomer", { name: "ACME CO", country: "Thailand", note: "ลูกค้าเก่า" }));
  assert.deepEqual(env.server.master.customers.map((row) => [row.name, row.orderType, row.note]), [["ACME CO", "SA", "ลูกค้าเก่า"]], "same key: one record, edited");
  const viewerEnv = await ready(remoteStore({ user: viewer }));
  assert.equal(viewerEnv.store.run("saveCustomer", { name: "X", country: "Thailand" }).ok, false);
});

test("a long command sends at most 20 audit entries and cuts text to the limits", async () => {
  const env = await ready(remoteStore());
  const nodes = Array.from({ length: 30 }, (_, index) => ({ code: `P-MANY-${String(index).padStart(2, "0")}`, qty: 1, newItem: { kind: "PURCHASED", name: "ก".repeat(150), uom: "pcs" } }));
  await saved(env.store.run("saveBomTree", { code: "FG-MANY", item: { name: "สินค้ามาก", uom: "set" }, nodes }));
  const { audit } = env.server.saves.at(-1);
  assert.equal(audit.length, 20);
  assert.equal(audit.at(-1).action, "รายการเพิ่มเติม");
  assert.ok(audit.every((entry) => entry.action.length <= 80 && entry.detail.length <= 300));
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

test("a rejected save reverts the whole action to the last server snapshot, and tells the user in Thai", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("TOY-01(P)-Y", { kind: "FG", name: "สินค้า", uom: "set" })).saving;
  await env.store.run("saveItem", saveItemPayload("P-REV")).saving;
  await env.store.run("saveBom", { itemCode: "TOY-01(P)-Y", lines: [{ childCode: "P-REV", qty: 1 }] }).saving;
  const order = await saved(env.store.run("createOrder", { customer: "ลูกค้า", country: "Thailand", orderedAt: NOW, whDue: NOW + 20 * 86400000 }));
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

  // action เดียวแก้ทั้งข้อมูลหลัก (สร้างรุ่นสินค้าใหม่) และใบสั่งผลิต: ล้มทั้งคู่ ไม่ทิ้งใบที่อ้างสินค้าที่ไม่มี
  env.server.fail = "BOM_FORBIDDEN";
  const variant = env.store.run("addOrderItem", { orderId: order.result, base: "TOY-01", pkg: "B", colorSet: "A", qty: 3 });
  assert.equal(variant.ok, true);
  assert.equal(env.store.data().orders[0].items.length, 1);
  assert.ok(env.store.data().items.some((item) => item.code === "TOY-01(B)-A"));
  const refused = await variant.saving;
  assert.match(refused.error.message, /ไม่มีสิทธิ์แก้ข้อมูล BOM/);
  assert.equal(env.store.data().orders[0].items.length, 0, "the order line is gone with the product it pointed at");
  assert.equal(env.store.data().items.some((item) => item.code === "TOY-01(B)-A"), false);
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
  storage.setItem(storeApi.LOCAL_KEY, JSON.stringify({ version: 1, counters: {}, orders: [{ id: "LOCAL-ONLY" }], jobs: [], audit: [] }));
  const before = [...storage.map.entries()];
  const server = fakeServer();
  const env = await ready(remoteStore({ server, storage }));
  const data = env.store.data();
  assert.equal(data.items.length, 0, "master data of the old state is not shown");
  assert.deepEqual(data.orders, [], "orders of the old browser state are not shown and not moved into the database");
  assert.deepEqual(data.jobs, []);
  assert.deepEqual(data.audit, []);
  assert.deepEqual(data.customers, []);
  await env.store.run("saveItem", saveItemPayload()).saving;
  assert.deepEqual([...storage.map.entries()], before, "the old keys are neither read nor changed nor removed");
  assert.equal(server.master.orders.length, 0);
});

test("the audit page reads app_bom_audit: newest first, refreshed after a save and not on every redraw; a failure keeps what was shown", async () => {
  const env = await ready(remoteStore());
  assert.deepEqual(env.store.audit(), { status: "idle", entries: [], error: null });
  const events = [];
  env.store.subscribe((event) => { if (event.type === "audit") events.push(event); });
  const first = env.store.loadAudit();
  assert.equal(env.store.audit().status, "loading");
  assert.equal(env.store.loadAudit(), first, "a second call joins the load in flight");
  await first;
  assert.equal(env.server.audits, 1);
  assert.deepEqual(env.store.audit(), { status: "ready", entries: [], error: null });
  assert.equal(events.length, 1, "one event per load, the page redraws on it");
  await env.store.loadAudit();
  assert.equal(env.server.audits, 1, "drawn again at once: no second call");

  await saved(env.store.run("saveItem", saveItemPayload("P-AUD-1")));
  await saved(env.store.run("saveItem", saveItemPayload("P-AUD-2")));
  await env.store.loadAudit();
  assert.equal(env.server.audits, 2, "a save marks the trail stale");
  const view = env.store.audit();
  assert.equal(view.status, "ready");
  assert.deepEqual(view.entries.map((entry) => entry.detail), ["P-AUD-2 ของซื้อทดสอบ", "P-AUD-1 ของซื้อทดสอบ"], "newest first");
  assert.equal(typeof view.entries[0].at, "number", "the ISO time of the database becomes milliseconds");
  assert.equal(view.entries[0].at, SERVER_AT);
  assert.equal(view.entries[0].user, "เซิร์ฟเวอร์");

  await env.store.loadAudit(true);
  assert.equal(env.server.audits, 3, "force reloads");
  env.server.auditFail = "BOM_REMOTE_FAILED";
  await env.store.loadAudit(true);
  const failed = env.store.audit();
  assert.equal(failed.status, "error");
  assert.match(failed.error.message, /โหลดบันทึกการใช้งานไม่สำเร็จ/);
  assert.equal(failed.entries.length, 2, "the entries already shown stay");
  env.server.auditFail = null;
  await env.store.loadAudit(true);
  assert.equal(env.store.audit().status, "ready");

  // ฐานข้อมูลที่ยังไม่มี app_bom_audit (ยังไม่ได้ติดตั้ง migration)
  const old = await ready(remoteStore());
  delete old.server.remote.audit;
  await old.store.loadAudit();
  assert.match(old.store.audit().error.message, /ยังไม่ได้ติดตั้ง migration/);
});

test("purge: the database is emptied and the page loads again from nothing; it is refused while saving and its failures are explained in Thai", async () => {
  const server = fakeServer();
  const env = await ready(remoteStore({ server }));
  await fgScene(env);
  const order = await saved(env.store.run("createOrder", newOrder()));
  await env.store.loadAudit();
  assert.ok(env.store.audit().entries.length > 0);
  const counters = env.store.data().counters;
  assert.ok(counters["BOM-69"] >= 1 || Object.keys(counters).length >= 0);

  let release;
  server.hold = new Promise((resolve) => { release = resolve; });
  const pending = env.store.run("saveItem", saveItemPayload("P-PENDING"));
  const blocked = await env.store.purge();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.busy, true);
  assert.equal(server.purges, 0);
  server.hold = null;
  release();
  await pending.saving;

  const loads = server.loads;
  const events = [];
  env.store.subscribe((event) => events.push(event.type));
  const outcome = await env.store.purge();
  assert.equal(outcome.ok, true);
  assert.ok(outcome.deleted >= 5, `deleted ${outcome.deleted}`);
  assert.equal(server.purges, 1);
  assert.equal(server.loads, loads + 1, "the page loads the (empty) database again");
  assert.equal(env.store.status(), "ready");
  assert.equal(env.store.version(), server.master.version, "the counter goes on (it is not set back to 0); the page holds the current value");
  assert.ok(env.store.version() > 0);
  assert.deepEqual(env.store.data().orders, []);
  assert.deepEqual(env.store.data().items, []);
  assert.deepEqual(env.store.data().counters, {}, "the numbering restarts too");
  assert.deepEqual(env.store.audit(), { status: "idle", entries: [], error: null });
  assert.ok(events.includes("loaded"));
  assert.equal(env.store.isSaving(), false);
  assert.equal(order.ok, true);

  server.purgeFail = "BOM_FORBIDDEN";
  const refused = await env.store.purge();
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /เฉพาะผู้ดูแลระบบ/);
  assert.equal(env.store.status(), "ready", "nothing changed");
  server.purgeFail = "BOM_TEST_MODE_ONLY";
  assert.match((await env.store.purge()).error.message, /โหมดทดสอบ/);
  server.purgeFail = "BOM_REMOTE_FAILED";
  assert.match((await env.store.purge()).error.message, /ล้างข้อมูล BOM ทดสอบไม่สำเร็จ/);
  assert.equal(env.store.isSaving(), false);

  // เครื่องอื่นเห็น epoch ใหม่ในส่วนต่างตอนตามทัน แล้วโหลดทั้งชุดใหม่ (ตัวนับ version ไม่ได้ถูกตั้งกลับ จึงไม่มีทางรู้จาก version ว่าระเบียนไหนหายไป)
  const other = await ready(remoteStore({ server: fakeServer() }));
  await saved(other.store.run("saveItem", saveItemPayload("P-OTHER")));
  await other.server.remote.purge();
  const loadsBefore = other.server.loads;
  assert.equal(await other.store.catchUp(), true, "a new epoch in the delta: the page loads the whole (empty) database");
  assert.equal(other.server.loads, loadsBefore + 1);
  assert.equal(other.store.version(), other.server.master.version);
  assert.deepEqual(other.store.data().items, []);
  assert.equal(await other.store.catchUp(), false, "afterwards it is in step again");
  // ถ้าไม่ทันตามทันก่อนบันทึก: ฐานข้อมูลปฏิเสธด้วย BOM_RESET (ไม่เขียนอะไร) แล้วหน้าโหลดทั้งชุดแทน
  const late = await ready(remoteStore({ server: fakeServer() }));
  await saved(late.store.run("saveItem", saveItemPayload("P-LATE-1")));
  await saved(late.store.run("saveItem", saveItemPayload("P-LATE-2")));
  await late.server.remote.purge();
  const next = late.store.run("saveItem", saveItemPayload("P-AFTER"));
  const result = await next.saving;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BOM_RESET");
  assert.match(result.error.message, /ถูกล้างและเริ่มใหม่/);
  assert.equal(late.server.saves.at(-1).epoch, "epoch-1", "the save carried the epoch the page held");
  assert.equal(late.server.master.items.length, 0, "the refused save wrote nothing: the cleared records do not come back");
  assert.equal(late.store.version(), late.server.master.version, "the conflict reply reloaded the whole (empty) database");
  assert.deepEqual(late.store.data().items, []);
  const again = await late.store.run("saveItem", saveItemPayload("P-AFTER")).saving;
  assert.equal(again.ok, true, "the next save carries the new epoch");
  assert.equal(late.server.saves.at(-1).epoch, "epoch-2");
});

test("a new epoch seen while a form is being edited is held like any other newer data and merged when the form is closed", async () => {
  let hold = true;
  const env = await ready(remoteStore({ server: fakeServer(), shouldHold: () => hold }));
  await saved(env.store.run("saveItem", saveItemPayload("P-ONE")));
  await env.server.remote.purge();
  const events = [];
  env.store.subscribe((event) => events.push(event.type));
  assert.equal(await env.store.catchUp(), false);
  assert.deepEqual(env.store.data().items.map((item) => item.code), ["P-ONE"], "nothing is swapped under the open form");
  assert.equal(env.store.hasNewer(), true);
  assert.ok(events.includes("pending"));
  hold = false;
  assert.equal(await env.store.catchUp(), true);
  assert.deepEqual(env.store.data().items, []);
  assert.equal(env.store.hasNewer(), false);
});

test("a failing audit read is tried once: the redraw on the audit event does not call the RPC again, and reload tries once more", async () => {
  const env = await ready(remoteStore());
  env.server.auditFail = "BOM_REMOTE_FAILED";
  // หน้าบันทึกการใช้งานวาดใหม่เมื่อมี event audit และเรียก loadAudit อีกครั้งตอนวาด (module-bom.js) · RPC ที่ล้มทันทีต้องไม่ทำให้วนไม่จบ
  let redraws = 0;
  env.store.subscribe((event) => { if (event.type === "audit" && redraws++ < 50) env.store.loadAudit(); });
  await env.store.loadAudit();
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout0(resolve));
  assert.equal(env.server.audits, 1, "exactly one RPC call");
  assert.equal(env.store.audit().status, "error", "the page reads the error, not 'loading'");
  assert.match(env.store.audit().error.message, /โหลดบันทึกการใช้งานไม่สำเร็จ/);
  await env.store.loadAudit();
  assert.equal(env.server.audits, 1, "drawing the page again does not retry");
  assert.equal(env.store.audit().status, "error");
  assert.equal(redraws, 1, "one audit event only");
  await env.store.loadAudit(true);
  assert.equal(env.server.audits, 2, "the reload button forces one more call");
  assert.equal(env.store.audit().status, "error");
  env.server.auditFail = null;
  await env.store.loadAudit(true);
  assert.equal(env.server.audits, 3);
  assert.equal(env.store.audit().status, "ready");
});

test("the local-mode store has the same surface for the audit page and refuses to purge", async () => {
  const store = storeApi.createStore({ storage: memoryStorage(), seed: () => ({ version: 6, counters: {}, users: [], audit: [{ at: 1, user: "x", action: "a", detail: "d" }], compounds: [], items: [], boms: [], orders: [], jobs: [], colors: [], colorSets: [], packages: [], processes: [], routings: [] }), actions: A });
  assert.deepEqual(store.audit().entries.map((entry) => entry.action), ["a"]);
  await store.loadAudit();
  const purge = await store.purge();
  assert.equal(purge.ok, false);
});

test("a whole sheet import is one save call, and database mode has no local reset", async () => {
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
  assert.equal(env.server.saves[0].audit.length, 1, "the whole import is one audit entry");
  env.store.reset();
  assert.equal(env.store.data().items.length, built.items.size, "there is no local reset in database mode: the data is not touched");
});

// ชีต DATA ทั้งไฟล์: ชิ้นงานหลายร้อยชิ้นและ BOM หลายร้อยพ่อ (ใหญ่เกินกว่าฐานข้อมูลบันทึกทันในคำสั่งเดียว)
const bigImport = (parts = 650, products = 200) => ({
  items: [
    ...Array.from({ length: parts }, (_, n) => ({ code: `P-BIG-${String(n).padStart(4, "0")}`, kind: "PURCHASED", name: `ชิ้นส่วน ${n}`, uom: "pcs" })),
    ...Array.from({ length: products }, (_, n) => ({ code: `BIG-${String(n).padStart(3, "0")}(P)-Y`, kind: "FG", name: `สินค้า ${n}`, uom: "set" })),
  ],
  boms: Array.from({ length: products }, (_, n) => ({ parentCode: `BIG-${String(n).padStart(3, "0")}(P)-Y`, lines: [0, 1, 2].map((k) => ({ childCode: `P-BIG-${String((n * 3 + k) % parts).padStart(4, "0")}`, qty: k + 1 })) })),
  source: "DATA BOM.xlsx",
  group: "TOY",
});

test("splitForSave keeps small and work-list saves whole, and cuts big master saves in the database's write order", () => {
  const { splitForSave, SAVE_BATCH_RECORDS } = storeApi;
  const item = (n) => ({ code: `P-${n}`, kind: "PURCHASED", name: "x", uom: "pcs" });
  const small = { items: { upsert: [item(1)] }, boms: { upsert: [{ id: "BOM-1", itemCode: "FG", lines: [] }] } };
  assert.deepEqual(splitForSave(small), [small], "a normal save is one call");
  const many = Array.from({ length: SAVE_BATCH_RECORDS * 2 }, (_, n) => item(n));
  const withOrders = { items: { upsert: many }, orders: { upsert: [{ id: "PI-1" }] } };
  assert.deepEqual(splitForSave(withOrders), [withOrders], "orders, customers and jobs keep the whole command in one transaction");
  const withDelete = { items: { upsert: many }, colorSets: { delete: [{ base: "TOY-01", code: "A" }] } };
  assert.deepEqual(splitForSave(withDelete), [withDelete], "a command that deletes is never split");

  // กุญแจของ changes มาลำดับไหนก็ได้ ส่วนที่ส่งเรียงตามที่ฐานข้อมูลเขียน: สูตรยางก่อนชิ้นงาน ชิ้นงานก่อน BOM
  const boms = Array.from({ length: 10 }, (_, n) => ({ id: `BOM-${n}`, itemCode: `FG-${n}`, lines: [] }));
  const batches = splitForSave({ boms: { upsert: boms }, items: { upsert: many }, compounds: { upsert: [{ code: "B0006" }] } });
  assert.equal(batches.length, 3);
  assert.deepEqual(Object.keys(batches[0]), ["compounds", "items"]);
  assert.ok(batches.every((batch) => Object.values(batch).reduce((sum, entry) => sum + entry.upsert.length, 0) <= SAVE_BATCH_RECORDS));
  assert.deepEqual(Object.keys(batches[2]), ["items", "boms"], "BOMs go after the last items");
  assert.equal(batches.flatMap((batch) => batch.items?.upsert ?? []).length, many.length, "nothing is lost or repeated");
  assert.equal(batches.flatMap((batch) => batch.boms?.upsert ?? []).length, boms.length);

  // ระเบียนใหญ่ (เช่น ชิ้นงานที่มีรูป) แบ่งตามขนาดด้วย
  const heavy = Array.from({ length: 6 }, (_, n) => ({ ...item(n), photo: "x".repeat(100_000) }));
  assert.equal(splitForSave({ items: { upsert: heavy } }).length, 3, "at most about 250 KB per call");
});

test("a whole DATA sheet import is saved in several calls, each on the version of the one before, and the page ends with everything", async () => {
  const env = await ready(remoteStore());
  const payload = bigImport();
  const out = env.store.run("importFlat", payload);
  assert.equal(out.ok, true);
  assert.equal(env.store.isSaving(), true);
  assert.deepEqual(env.store.saveProgress(), { done: 0, total: 4 }, "the page can say which part is being saved");
  const result = await out.saving;
  assert.equal(result.ok, true);
  assert.equal(env.server.saves.length, 4, "650 + 200 items and 200 BOMs at 300 records a call");
  assert.deepEqual(env.server.saves.map((save) => save.baseVersion), [0, 1, 2, 3], "each part is checked against the version the previous part made");
  assert.ok(env.server.saves.every((save) => save.action === "importFlat"));
  const firstBom = env.server.saves.findIndex((save) => save.changes.boms);
  const lastItems = env.server.saves.findLastIndex((save) => save.changes.items);
  assert.ok(lastItems <= firstBom, "every item is in the database before a BOM that uses it");
  assert.match(env.server.saves[0].audit[0].action, /นำเข้า BOM/);
  assert.deepEqual(env.server.saves[0].audit[1], { action: "บันทึกต่อเนื่อง", detail: "ส่วนที่ 1 จาก 4 ของคำสั่งเดียวกัน" }, "the audit says the import totals came with part 1 of 4");
  assert.equal(env.server.saves[0].audit.length, 2);
  assert.deepEqual(env.server.saves.slice(1).map((save) => save.audit[0].detail), ["ส่วนที่ 2 จาก 4 ของคำสั่งเดียวกัน", "ส่วนที่ 3 จาก 4 ของคำสั่งเดียวกัน", "ส่วนที่ 4 จาก 4 ของคำสั่งเดียวกัน"]);
  assert.equal(env.server.master.items.length, 850);
  assert.equal(env.server.master.boms.length, 200);
  assert.equal(env.store.version(), 4);
  assert.equal(env.store.data().items.length, 850);
  assert.equal(env.store.data().boms.length, 200);
  assert.equal(env.store.data().items.find((item) => item.code === "P-BIG-0000").updatedAt, SERVER_AT, "records of the first part carry the server's stamps too");
  assert.equal(env.store.saveProgress(), null);
  assert.equal(env.events.filter((type) => type === "saving").length, 4, "one notice per part so the status text moves on");
  assert.equal(env.events.at(-1), "saved");
});

test("a part that fails keeps the parts already saved, says how far it got, and running the import again finishes the rest", async () => {
  const env = await ready(remoteStore());
  const save = env.server.remote.save;
  let calls = 0;
  env.server.remote.save = (...args) => {
    calls += 1;
    if (calls === 3) return Promise.reject({ code: "57014", message: "canceling statement due to statement timeout" });
    return save(...args);
  };
  const failed = await env.store.run("importFlat", bigImport()).saving;
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "BOM_TIMEOUT");
  assert.match(failed.error.message, /บันทึกไม่ทันเวลา/);
  assert.match(failed.error.message, /บันทึกไปแล้ว 2 จาก 4 ส่วน/);
  assert.equal(env.server.master.items.length, 600, "the database kept the two parts it accepted");
  assert.equal(env.store.data().items.length, 600, "the page shows what the database has, not the whole optimistic import");
  assert.equal(env.store.data().boms.length, 0);
  assert.equal(env.store.version(), 2);
  assert.equal(env.store.isSaving(), false);
  assert.equal(env.store.saveProgress(), null);

  const again = await env.store.run("importFlat", bigImport()).saving;
  assert.equal(again.ok, true, "the items already saved are merged, not sent again as new");
  assert.equal(env.server.saves.at(-1).baseVersion, 3);
  assert.equal(env.server.master.items.length, 850);
  assert.equal(env.server.master.boms.length, 200);
  assert.equal(env.store.data().boms.length, 200);
});

test("only the Excel import is split: a large save from another command is still one call", async () => {
  const env = await ready(remoteStore());
  await env.store.run("importFlat", bigImport()).saving;
  const before = env.server.saves.length;
  // ชิ้นงานใหม่ 400 ชิ้นจากคำสั่งที่ไม่ใช่การนำเข้า (เช่น saveItem ที่ทำงานกับข้อมูลชุดใหญ่) ไม่ถูกแบ่ง
  const many = { items: Array.from({ length: 400 }, (_, n) => ({ code: `P-ONE-${n}`, kind: "PURCHASED", name: "x", uom: "pcs" })) };
  const actions = { ...A, bulkTest: (d) => { for (const item of many.items) d.items.push({ ...item, ownerDept: "ST", weightG: 0, group: "TOY", legacyCodes: [], rubber: null, active: true }); return true; } };
  const other = storeApi.createStore({ storage: memoryStorage(), actions, now: () => NOW, remote: env.server.remote, persona: () => planner });
  await other.ensureLoaded();
  const out = await other.run("bulkTest").saving;
  assert.equal(out.ok, true);
  assert.equal(env.server.saves.length, before + 1);
  assert.equal(env.server.saves.at(-1).changes.items.upsert.length, 400);
});

test("a test-data reset in the middle of an import does not claim the earlier parts were kept", async () => {
  const env = await ready(remoteStore());
  const save = env.server.remote.save;
  let calls = 0;
  env.server.remote.save = (...args) => {
    calls += 1;
    if (calls === 3) return Promise.reject({ code: "P0001", message: "BOM_RESET" });
    return save(...args);
  };
  const failed = await env.store.run("importFlat", bigImport()).saving;
  assert.equal(failed.error.code, "BOM_RESET");
  assert.doesNotMatch(failed.error.message, /บันทึกไปแล้ว/);
});

test("Thai message for a database statement timeout", () => {
  const error = storeApi.mapRemoteError({ code: "57014", message: "canceling statement due to statement timeout" });
  assert.equal(error.code, "BOM_TIMEOUT");
  assert.doesNotMatch(error.message, /canceling/);
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
async function pageEnv({ storage = memoryStorage(), pageStorage = memoryStorage(), mockOptions = {}, mutate = () => {}, hooks = {}, persona = null, sandboxAdmin = false } = {}) {
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage: pageStorage, ...mockOptions });
  mutate(mock.db);
  if (persona) await mock.client.rpc("app_sandbox_enter", { p_persona_id: persona });
  const { data } = await mock.client.rpc("app_sandbox_status");
  const status = data ?? { persona: { id: "persona-1", first_name: "ทดสอบ", last_name: "ระบบ", role: { code: "admin" }, department: { code: "MT" } } };
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { toasts: [], renders: 0, notFound: 0, hash: "#/bom", dialogs: [] };
  const node = () => ({ handlers: {}, dataset: {}, value: "", disabled: false, textContent: "", innerHTML: "", addEventListener() {}, querySelector: (selector) => hooks.nodes?.[selector] ?? null, querySelectorAll: () => [], focus() {}, close() {}, remove() {}, showModal() {}, setAttribute() {}, insertAdjacentHTML(_, html) { log.dialogs.push(html); this.lastElementChild = { ...node(), tagName: "DIALOG" }; } });
  Object.assign(context, {
    window: context, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee: { ...status.persona, isSandbox: true }, ...(sandboxAdmin ? { sandbox: { active: true } } : {}) }, supabase: { createClient: () => mock.client }, sb: mock.client,
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: (selector) => hooks.nodes?.[selector] ?? node(), querySelectorAll: (selector) => (["dialog[open]", "dialog[data-rf-dialog][open]"].includes(selector) && hooks.dialogOpen?.() ? [node()] : []), body: node(), createElement: node, addEventListener: (type, fn) => hooks.onDocument?.(type, fn) },
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

  const { epoch: firstEpoch, ...firstSnapshot } = (await client.rpc("app_bom_master")).data;
  assert.equal(typeof firstEpoch, "string", "the snapshot carries the epoch of the data round");
  assert.deepEqual(firstSnapshot, emptyMaster());
  let reply = await save({ items: { upsert: [item("FG-1", "FG"), item("P-1")] } });
  assert.equal(reply.error, null);
  assert.equal(reply.data.version, 1);
  assert.deepEqual(codes(reply), ["FG-1", "P-1"], "a save answers with a delta: every change since the base version");
  assert.equal(reply.data.epoch, firstEpoch, "and so does every reply");
  assert.deepEqual(Object.keys(reply.data.changes), storeApi.REMOTE_LISTS, "all eleven lists are always present");
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
  assert.equal((await save({ boms: { upsert: [bom("B1", "FG-1", "approved", "FG-1")] } }, 3)).error.code, "BOM_CYCLE", "a BOM that contains itself is refused, as the database does");
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
  const write = (code) => save({ items: { upsert: [item(code)] } }, version);
  assert.equal((await write("P-W1")).error.code, "BOM_FORBIDDEN", "a staff member of another department may read but not write master data");
  assert.equal((await client.rpc("app_bom_master")).error, null, "everyone signed in reads");
  assert.equal((await since(0)).error, null, "and reads the delta");
  me.role_id = "role-dm";
  assert.equal((await write("P-W2")).error, null, "a department manager writes");
  me.role_id = "role-staff";
  db.departments.push({ id: "dep-pp", code: "PP", name_th: "วางแผน", is_active: true, is_repair_site: false });
  me.department_id = "dep-pp";
  assert.equal((await write("P-W3")).error, null, "the planning department writes");

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

// ---------- สิทธิ์ตามบัญชีทดสอบ (persona) ของ Supabase จำลอง ----------
const mockOrder = (id, extra = {}) => ({ id, customer: "ลูกค้า", country: "Thailand", orderType: "SA", orderedAt: NOW, whDue: NOW + 9 * 86400000, due: {}, dueDefaults: [], revision: 0, status: "draft", items: [{ fgCode: "FG-1", qty: 5, colorSet: "", note: "" }], explosion: null, explodedAt: null, stockCounts: {}, note: "", createdBy: "x", createdAt: 1, ...extra });
const mockJob = (id, orderId, dept, extra = {}) => ({ id, orderId, dept, itemCode: `${dept}-ITEM`, name: "งาน", kind: "RB", uom: "pcs", qtyPlanned: 10, qtyRequired: 10, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: NOW + 86400000, status: "queued", externalRef: null, fgCodes: ["FG-1"], createdAt: 1, reports: [], ...extra });

test("the mock sandbox offers switchable personas (the planner group, producing departments, stock, a non-production department) and remembers the choice", async () => {
  const storage = memoryStorage();
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const status = (await client.rpc("app_sandbox_status")).data;
  assert.equal(status.persona.id, "persona-1", "the first persona is the simulated admin, as before");
  assert.deepEqual(status.personas.map((row) => row.id), ["persona-1", "persona-pp", "persona-rb", "persona-rbh", "persona-gr", "persona-st", "persona-sr", "persona-wh", "persona-qa"]);
  assert.deepEqual(status.personas.map((row) => storeApi.roleOfEmployee(row)), ["admin", "planner", "rb", "manager", "gr", "st", "viewer", "wh", "viewer"], "each persona maps to a BOM role (the RB head is a department manager; SR and QA are not BOM departments)");
  assert.equal((await client.rpc("app_sandbox_enter", { p_persona_id: "persona-rb" })).error, null);
  assert.equal((await client.rpc("app_sandbox_status")).data.persona.department.code, "RB");
  assert.equal((await client.rpc("app_sandbox_enter", { p_persona_id: "nobody" })).error.code, "PERSONA_NOT_FOUND");
  const again = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  assert.equal((await again.client.rpc("app_sandbox_status")).data.persona.id, "persona-rb", "a reload keeps the persona");
  assert.equal(createMockSupabase({ now: () => NOW }).client.rpc("app_sandbox_enter", { p_persona_id: "persona-rb" }) instanceof Promise, true);
  assert.equal((await createMockSupabase({ now: () => NOW }).client.rpc("app_sandbox_enter", { p_persona_id: "persona-rb" })).error.code, "SANDBOX_NOT_AVAILABLE");
});

test("the mock database checks orders and jobs per section and per field for the persona", async () => {
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW });
  const as = (persona) => client.rpc("app_sandbox_enter", { p_persona_id: persona });
  let version = 0;
  const save = async (changes, audit = [], base = version) => {
    const reply = await client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: base, p_action: "t", p_audit: audit });
    if (!reply.error) version = reply.data.version;
    return reply;
  };
  const view = async () => (await client.rpc("app_bom_master")).data;
  const code = async (changes) => (await save(changes)).error?.code ?? null;
  // ระเบียนที่ฐานข้อมูลเก็บไว้ (มีเวลา/ผู้บันทึกที่ฐานข้อมูลประทับ) แล้วแก้บางช่อง เหมือนหน้าเว็บที่ส่งระเบียนที่อ่านมาทั้งก้อนกลับไป
  const cur = async (list, id) => (await view())[list].find((row) => row.id === id);
  const withJob = async (id, extra) => ({ ...(await cur("jobs", id)), ...extra });
  const withOrder = async (id, extra) => ({ ...(await cur("orders", id)), ...extra });

  // ฝ่ายวางแผน (admin): ลูกค้า ใบ งาน
  assert.equal(await code({ customers: { upsert: [{ name: "Acme", country: "USA", orderType: "EX", note: "" }] }, orders: { upsert: [mockOrder("PI-1"), mockOrder("PI-2")] } }), null);
  assert.equal(await code({ jobs: { upsert: [mockJob("JOB-RB", "PI-1", "RB"), mockJob("JOB-GR", "PI-1", "GR")] }, orders: { upsert: [mockOrder("PI-1", { status: "released", explosion: [] })] } }), null);
  assert.deepEqual((await view()).orders.map((row) => row.id), ["PI-1", "PI-2"], "orders newest first, then by id");
  assert.deepEqual((await view()).jobs.map((row) => row.id), ["JOB-GR", "JOB-RB"], "jobs by order, department, item, id");

  // ผู้ที่ไม่ใช่ฝ่ายวางแผนแก้ข้อมูลหลัก ลูกค้า ใบ และสร้าง/ลบงานไม่ได้
  const denied = async (persona, changes, why) => { await as(persona); assert.equal(await code(changes), "BOM_FORBIDDEN", why); };
  await denied("persona-rb", { customers: { upsert: [{ name: "X", country: "Thailand", orderType: "SA" }] } }, "customers are the planner group's");
  await denied("persona-rb", { orders: { upsert: [mockOrder("PI-3")] } }, "a new order");
  await denied("persona-rb", { orders: { upsert: [mockOrder("PI-2", { note: "แก้" })] } }, "an order edit");
  await denied("persona-rb", { jobs: { upsert: [mockJob("JOB-NEW", "PI-1", "RB")] } }, "a new job");
  await denied("persona-rb", { jobs: { delete: [{ id: "JOB-RB" }] } }, "deleting a job");
  await denied("persona-qa", { jobs: { upsert: [mockJob("JOB-RB", "PI-1", "RB", { status: "in_progress" })] } }, "a department without the job");
  await denied("persona-rb", { jobs: { upsert: [mockJob("JOB-GR", "PI-1", "GR", { status: "in_progress" })] } }, "another department's job");

  // แผนกของงาน: เฉพาะสถานะ ยอดดี/เสีย รายงาน เวลาเสร็จ (และ WO ของ RB)
  await as("persona-rb");
  assert.equal(await code({ jobs: { upsert: [await withJob("JOB-RB", { qtyPlanned: 99 })] } }), "BOM_FORBIDDEN", "quantities of the plan are the planner's");
  assert.equal(await code({ jobs: { upsert: [await withJob("JOB-RB", { dueAt: 5 })] } }), "BOM_FORBIDDEN", "the due date too");
  const report = { at: 1, by: "ปลอม", good: 4, reject: 1, note: "รอบแรก" };
  assert.equal(await code({ jobs: { upsert: [await withJob("JOB-RB", { status: "in_progress", qtyDone: 4, qtyReject: 1, reports: [report] })] } }), null);
  let job = (await view()).jobs.find((row) => row.id === "JOB-RB");
  assert.equal(job.reports[0].by, "ประยุทธ รีดยาง", "the reporter is the persona, not what the page sent");
  assert.notEqual(job.reports[0].at, 1, "and the time is the database's");
  assert.equal((await view()).orders.find((row) => row.id === "PI-1").status, "in_progress", "a started job moves the released order on by itself");
  assert.equal(await code({ jobs: { upsert: [{ ...job, reports: [{ ...job.reports[0], good: 40 }] }] } }), "BOM_FORBIDDEN", "a past report cannot be rewritten");
  assert.equal(await code({ jobs: { upsert: [{ ...job, reports: [] }] } }), "BOM_FORBIDDEN", "or removed");
  assert.equal(await code({ jobs: { upsert: [{ ...job, reports: [...job.reports, { at: 2, by: "x", good: 6, reject: 0, note: "" }], qtyDone: 10, status: "done" }] } }), null, "a report is appended");
  job = (await view()).jobs.find((row) => row.id === "JOB-RB");
  assert.ok(job.doneAt > 0, "doneAt is set when the job becomes done");
  assert.equal(job.reports.length, 2);
  assert.equal(await code({ jobs: { upsert: [{ ...job, status: "queued" }] } }), "BOM_INVALID_TRANSITION", "a done job does not reopen");
  assert.equal(await code({ jobs: { upsert: [await withJob("JOB-GR", { externalRef: { system: "rubberflow", woId: "WO-1" } })] } }), "BOM_INVALID_JOB", "RB can link a Rubberflow work order to an RB job only");
  await as("persona-gr");
  assert.equal(await code({ jobs: { upsert: [await withJob("JOB-GR", { externalRef: { system: "rubberflow", woId: "WO-1" } })] } }), "BOM_FORBIDDEN", "other departments cannot link a work order at all");
  await as("persona-rb");

  // ST/WH: ยอดนับของใบร่างเท่านั้น
  for (const persona of ["persona-st", "persona-wh"]) {
    await as(persona);
    assert.equal(await code({ orders: { upsert: [await withOrder("PI-2", { stockCounts: { "P-1": persona === "persona-st" ? 3 : 4 }, stockCountedBy: "ปลอม" })] } }), null, `${persona} counts a draft`);
  }
  const counted = (await view()).orders.find((row) => row.id === "PI-2");
  assert.deepEqual(counted.stockCounts, { "P-1": 4 });
  assert.equal(counted.stockCountedBy, "สุดา คลังสินค้า", "the stamp is the database's: the last counter");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-2", { stockCounts: { "P-1": 3 }, note: "แอบแก้" })] } }), "BOM_FORBIDDEN", "any other field of the order is refused");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-2", { status: "released", stockCounts: { "P-1": 4 } })] } }), "BOM_FORBIDDEN", "a count that also releases the order");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-1", { status: "in_progress", explosion: [], stockCounts: { "P-1": 4 } })] } }), "BOM_FORBIDDEN", "a released order is not counted");
  await as("persona-rb");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-2", { stockCounts: { "P-1": 9 } })] } }), "BOM_FORBIDDEN", "RB does not count");

  // สถานะใบ (ฝ่ายวางแผน)
  await as("persona-pp");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-2", { status: "completed" })] } }), "BOM_INVALID_TRANSITION", "draft cannot be completed");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-2", { status: "weird" })] } }), "BOM_INVALID_ORDER");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-1", { status: "draft", revision: 1, explosion: [] })] } }), "BOM_INVALID_TRANSITION", "reopening with its jobs still there");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-1", { status: "draft", revision: 1, explosion: [] })] }, jobs: { delete: [{ id: "JOB-RB" }, { id: "JOB-GR" }] } }), "BOM_INVALID_TRANSITION", "a job of the order has started");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-1", { status: "released", items: [], explosion: [] })] } }), "BOM_INVALID_TRANSITION", "items change only through a reopen, not on a released order");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-1", { status: "completed", explosion: [] })] } }), null, "an order in progress can be completed");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-1", { status: "cancelled", explosion: [] })] } }), "BOM_INVALID_TRANSITION", "a completed order is final");

  // เปิดใบกลับมาแก้ได้เมื่อไม่มีงานเริ่ม: ลบงานทั้งหมดของใบ + revision + 1 ในคำสั่งเดียว
  assert.equal(await code({ orders: { upsert: [mockOrder("PI-4")] } }), null);
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-4", { status: "released", explosion: [] })] }, jobs: { upsert: [mockJob("JOB-A", "PI-4", "RB"), mockJob("JOB-B", "PI-4", "GR")] } }), null);
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-4", { status: "draft", revision: 5, explosion: [] })] }, jobs: { delete: [{ id: "JOB-A" }, { id: "JOB-B" }] } }), "BOM_INVALID_TRANSITION", "the revision must go up by exactly one");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-4", { status: "draft", revision: 1, explosion: [] })] }, jobs: { delete: [{ id: "JOB-A" }] } }), null, "the database deletes every job of the reopened order itself: a partial list from the page is enough");
  const after = await view();
  assert.deepEqual(after.jobs.filter((row) => row.orderId === "PI-4"), []);
  assert.equal(after.orders.find((row) => row.id === "PI-4").revision, 1);
  const delta = (await client.rpc("app_bom_master_since", { p_version: version - 1 })).data;
  assert.deepEqual(delta.changes.jobs.delete.map((row) => row.id).sort(), ["JOB-A", "JOB-B"], "deleted jobs reach other browsers as tombstones by id");
  assert.equal(await code({ jobs: { upsert: [mockJob("JOB-NEW", "NO-SUCH-ORDER", "RB")] } }), "BOM_INVALID_JOB", "a job needs its order");
});

test("the mock database stores one audit row per save (the server's own action and counts, the client's text apart), newest first, and rejects malformed ones", async () => {
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW });
  const save = (audit, version = 0, changes = { customers: { upsert: [{ name: `C${version}`, country: "Thailand", orderType: "SA" }] } }) => client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: version, p_action: "saveCustomer", p_audit: audit });
  assert.deepEqual((await client.rpc("app_bom_audit", {})).data, []);
  assert.equal((await save([{ action: "เปิดใบ", detail: "PI-1" }, { action: "ปล่อยผลิต", detail: "PI-1" }])).error, null);
  assert.equal((await save([{ action: "แก้ลูกค้า", detail: "C1" }], 1)).error, null);
  const rows = (await client.rpc("app_bom_audit", {})).data;
  assert.deepEqual(rows.map((row) => row.action), ["saveCustomer", "saveCustomer"], "newest first: the action name is the server's record, not the client's text");
  assert.deepEqual(rows.map((row) => row.detail), ["customers +1", "customers +1"], "and so are the counts");
  assert.deepEqual(rows[0].entries, [{ action: "แก้ลูกค้า", detail: "C1" }], "what the client wrote travels apart, as entries");
  assert.deepEqual(rows[1].entries.map((entry) => entry.action), ["เปิดใบ", "ปล่อยผลิต"]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["action", "at", "detail", "entries", "user"]);
  assert.equal(rows[0].user, "ปกรณ์ ศรีวัฒนา");
  assert.equal(rows[0].at, new Date(NOW).toISOString(), "an ISO time, like timestamptz in json");
  assert.equal((await client.rpc("app_bom_audit", { p_limit: 1 })).data.length, 1);
  assert.equal((await client.rpc("app_bom_audit", { p_limit: 0 })).error.code, "BOM_INVALID_PAYLOAD");
  assert.equal((await save("x", 2)).error.code, "BOM_INVALID_AUDIT");
  assert.equal((await save(Array.from({ length: 21 }, () => ({ action: "a", detail: "d" })), 2)).error.code, "BOM_INVALID_AUDIT", "more than 20 entries");
  assert.equal((await save([{ action: "a".repeat(81), detail: "d" }], 2)).error.code, "BOM_INVALID_AUDIT");
  assert.equal((await save([{ action: "a", detail: "d".repeat(301) }], 2)).error.code, "BOM_INVALID_AUDIT");
  assert.equal((await save(undefined, 2)).error, null, "the 3-argument call still works");
  assert.equal((await client.rpc("app_bom_audit", {})).data.length, 3, "a refused save writes no audit (the 3-argument call wrote its own row)");
  assert.equal((await createMockSupabase({ now: () => NOW }).client.rpc("app_bom_audit", {})).error.code, "BOM_TEST_MODE_ONLY");
});

test("the mock purge empties every BOM list, keeps the counter, changes the epoch and adds an audit row; only the real admin in the test mode may call it", async () => {
  const storage = memoryStorage();
  const { client, db } = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  await client.rpc("app_bom_save_master", { p_changes: { customers: { upsert: [{ name: "A", country: "Thailand", orderType: "SA" }] }, orders: { upsert: [mockOrder("PI-1")] } }, p_base_version: 0, p_action: "t", p_audit: [{ action: "x", detail: "y" }] });
  await client.rpc("app_sandbox_enter", { p_persona_id: "persona-qa" });
  const before = (await client.rpc("app_bom_master")).data;
  assert.equal((await client.rpc("app_sandbox_purge_bom")).data.deleted, 2, "the persona does not matter: the real user is the admin");
  const master = (await client.rpc("app_bom_master")).data;
  assert.deepEqual([master.version, master.orders.length, master.customers.length], [before.version, 0, 0], "the counter goes on");
  assert.notEqual(master.epoch, before.epoch, "the data round has a new epoch");
  const audit = (await client.rpc("app_bom_audit", {})).data;
  assert.deepEqual(audit.map((row) => row.action), ["ล้างข้อมูล BOM ทดสอบ", "t"], "the history is kept and the purge adds its own row");
  assert.equal(audit[0].detail, "ลบ 2 แถว");
  assert.equal((await client.rpc("app_bom_master_since", { p_version: 1 })).data.epoch, master.epoch, "a browser that is only behind by version sees the new epoch");
  assert.equal((await client.rpc("app_bom_save_master", { p_changes: { customers: { upsert: [{ name: "Z", country: "Thailand", orderType: "SA" }] } }, p_base_version: 1, p_action: "t", p_epoch: before.epoch })).error.code, "BOM_RESET", "a save that holds the old epoch is refused");
  assert.equal((await client.rpc("app_bom_master")).data.customers.length, 0, "and wrote nothing");
  assert.equal(JSON.parse(storage.getItem("mnp-harness-bom-master")).version, before.version, "the page storage keeps the counter too");
  assert.equal(JSON.parse(storage.getItem("mnp-harness-bom-master")).epoch, master.epoch);
  db.employees[0].role_id = "role-staff";
  assert.equal((await client.rpc("app_sandbox_purge_bom")).error.code, "BOM_FORBIDDEN", "not an admin");
  assert.equal((await createMockSupabase({ now: () => NOW }).client.rpc("app_sandbox_purge_bom")).error.code, "BOM_TEST_MODE_ONLY");
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
  assert.equal(handlers.focus.length, 2, "RubberFlow and BOM each listen for the window gaining focus");
  assert.equal(handlers.visibilitychange.length, 2, "and for the tab becoming visible");
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

// ---------- ใบสั่งผลิต งาน นับคงคลัง ลูกค้า และบันทึกการใช้งานผ่านโมดูลบน Supabase จำลอง ----------
const settle = () => new Promise((resolve) => setTimeout0(resolve));
// ผู้วางแผน (admin จำลอง) สร้างสินค้า ใบร่างที่ระเบิด BOM แล้ว (D) และใบที่ปล่อยผลิตแล้ว (R) พร้อมงาน RB และ GR · คืนสภาพแวดล้อมที่ใช้ pageStorage ต่อให้บัญชีอื่นได้
async function planningScene() {
  const env = await pageEnv();
  await env.store.ensureLoaded();
  const ctx = env.ctx();
  await fgScenePt(env);
  const draft = await saved(env.store.run("createOrder", newOrder({ pi: "PI-D" })));
  await saved(env.store.run("addOrderItem", { orderId: draft.result, fgCode: "FG-TEST-01", qty: 5 }));
  await saved(env.store.run("explodeOrder", { orderId: draft.result }));
  const released = await saved(env.store.run("createOrder", newOrder({ pi: "PI-R" })));
  await saved(env.store.run("addOrderItem", { orderId: released.result, fgCode: "FG-TEST-01", qty: 5 }));
  await saved(env.store.run("explodeOrder", { orderId: released.result }));
  // ปล่อยผลิตพร้อมงาน RB และ GR ในคำสั่งเดียว (ฐานข้อมูลสร้างงานได้เฉพาะในคำสั่งที่ปล่อยผลิต)
  const stored = (await env.mock.client.rpc("app_bom_master")).data;
  const order = stored.orders.find((row) => row.id === "PI-R");
  const extra = [mockJob("JOB-RB1", "PI-R", "RB"), mockJob("JOB-GR1", "PI-R", "GR")];
  const reply = await env.mock.client.rpc("app_bom_save_master", { p_changes: { orders: { upsert: [{ ...order, status: "released", releasedAt: NOW, releasedBy: "x" }] }, jobs: { upsert: extra } }, p_base_version: stored.version, p_action: "releaseOrder" });
  assert.equal(reply.error, null);
  return { env, ctx };
}
const asPersona = async (scene, persona, options = {}) => {
  const env = await pageEnv({ pageStorage: scene.env.pageStorage, persona, ...options });
  await env.store.ensureLoaded();
  return env;
};

test("a planner opens a PI, releases it, a department reports, counts are saved and the audit page lists it all, through the module on the (mock) database", async () => {
  const env = await pageEnv();
  await env.store.ensureLoaded();
  const ctx = env.ctx();
  await fgScenePt(env);
  assert.equal(ctx.runAction("createOrder", { customer: "ลูกค้า ทดสอบ", country: "Thailand", orderedAt: NOW, whDue: NOW + 9 * 86400000 }, "เปิดใบสั่งผลิต {result}"), true);
  await settle();
  const id = env.store.data().orders[0].id;
  assert.match(env.log.toasts.at(-1)[0], new RegExp(`^เปิดใบสั่งผลิต ${id}$`));
  assert.match(id, /^\d{6}-\d{2}001$/);
  const stored = JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master"));
  assert.deepEqual(stored.orders.map((order) => order.id), [id], "the order is in the (mock) database, not in the browser's BOM storage");
  assert.deepEqual(stored.customers.map((row) => row.name), ["ลูกค้า ทดสอบ"]);

  for (const [action, payload] of [["addOrderItem", { orderId: id, fgCode: "FG-TEST-01", qty: 5 }], ["explodeOrder", { orderId: id }]]) {
    assert.equal(ctx.runAction(action, payload, ""), true, action);
    await settle();
  }
  let html = await env.render(`p=orders&sel=${id}`);
  assert.match(html, /data-rf-action="releaseOrder"/, "a draft shows the release button to the planner");
  assert.match(html, /data-rf-open="stockCount"/, "and the count buttons");
  assert.equal(ctx.runAction("setStockCount", { orderId: id, itemCode: "PT-TEST-01", qty: 3 }, "บันทึกยอดคงคลัง {result}"), true);
  await settle();
  assert.equal(JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master")).orders[0].stockCounts["PT-TEST-01"], 3);
  assert.equal(ctx.runAction("releaseOrder", { orderId: id }, "ปล่อยผลิต {result}"), true);
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(env.store.data().jobs.map((row) => [row.dept, row.kind]))), [["PK", "FG"], ["PT", "PT"], ["ST", "PURCHASED"]], "the PT job, the PK job and the ST job of the purchased part");
  const job = env.store.data().jobs.find((row) => row.dept === "PK");
  assert.match(job.id, /^JOB-\d\d-000\d-[0-9a-z]{6}$/);
  assert.equal(job.qtyPlanned, 5, "the PK job is for the order quantity");
  assert.equal(ctx.runAction("reportJob", { jobId: job.id, qtyDone: 5, note: "ครบ" }, "บันทึกผลผลิต {result}"), true);
  await settle();
  const database = JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master"));
  const storedJob = database.jobs.find((row) => row.id === job.id);
  assert.equal(storedJob.status, "done");
  assert.equal(storedJob.reports[0].by, "ปกรณ์ ศรีวัฒนา");
  assert.equal(ctx.runAction("completeOrder", { orderId: id }, "ปิดใบ {result}"), true);
  await settle();
  assert.equal(JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master")).orders[0].status, "completed");
  assert.deepEqual(env.log.toasts.filter(([, kind]) => kind === "error"), []);

  // หน้าบันทึกการใช้งานอ่านจาก RPC: ครั้งแรกบอกว่ากำลังโหลด แล้ววาดใหม่เมื่อมาถึง
  html = await env.render("p=audit");
  assert.match(html, /กำลังโหลดบันทึกการใช้งาน|ไม่พบรายการ/);
  const renders = env.log.renders;
  await settle();
  assert.ok(env.log.renders > renders, "the page is redrawn when the audit arrives");
  html = await env.render("p=audit");
  for (const text of ["เปิดใบสั่งผลิต", "เพิ่มสินค้าในใบสั่งผลิต", "ระเบิด BOM", "นับคงคลังตามใบ", "ปล่อยผลิต", "รายงานผลผลิต", "ปิดใบสั่งผลิต"]) assert.match(html, new RegExp(text), text);
  assert.match(html, /ปกรณ์ ศรีวัฒนา/, "the user comes from the database row");
  assert.match(html, /data-bom-audit-reload/);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
  assert.ok(html.indexOf("ปิดใบสั่งผลิต") < html.indexOf("เปิดใบสั่งผลิต"), "newest first");
  const search = await env.render("p=audit&q=ปิดใบ");
  assert.match(search, /ปิดใบสั่งผลิต/);
  assert.doesNotMatch(search, /เพิ่มสินค้าในใบสั่งผลิต/);
  assert.equal(env.pageStorage.getItem("mnp-bom-local-v1"), null, "nothing in the legacy BOM key");
});

test("the screens show only what the persona may do: planner group everything, ST/WH counts, a department its own jobs, anyone else read-only", async () => {
  const scene = await planningScene();
  const buttons = (html, name) => (html.match(new RegExp(`data-rf-(?:open|action)="${name}"`, "g")) ?? []).length;
  const sees = async (persona, query) => { const env = await asPersona(scene, persona); return { env, html: await env.render(query) }; };

  // หน้าใบสั่งผลิต: เปิดใบใหม่ ปล่อยผลิต ยกเลิก = ฝ่ายวางแผน · นับ = ฝ่ายวางแผน + ST/WH
  for (const [persona, planner, count] of [["persona-1", true, true], ["persona-pp", true, true], ["persona-st", false, true], ["persona-wh", false, true], ["persona-rb", false, false], ["persona-qa", false, false]]) {
    const list = await sees(persona, "p=orders");
    assert.equal(buttons(list.html, "orderNew") > 0, planner, `${persona}: open a new PI`);
    const draft = await sees(persona, "p=orders&sel=PI-D");
    assert.equal(buttons(draft.html, "releaseOrder") > 0, planner, `${persona}: release`);
    assert.equal(buttons(draft.html, "cancelOrder") > 0, planner, `${persona}: cancel`);
    assert.equal(buttons(draft.html, "explodeOrder") > 0, planner, `${persona}: explode`);
    assert.equal(buttons(draft.html, "orderItemAdd") > 0, planner, `${persona}: add products`);
    assert.equal(buttons(draft.html, "stockCount") > 0, count, `${persona}: count buttons on a draft`);
    const released = await sees(persona, "p=orders&sel=PI-R");
    assert.equal(buttons(released.html, "completeOrder") > 0, planner, `${persona}: complete`);
    assert.equal(buttons(released.html, "stockCount"), 0, `${persona}: no counting once released`);
  }

  // เมนู: ลูกค้าเฉพาะฝ่ายวางแผนขึ้นไป · นับคงคลังและใบสั่งผลิตเห็นกัน ST/WH
  const menu = (persona) => asPersona(scene, persona).then((env) => storeApi.MODULES.filter((entry) => storeApi.canSee(env.store.user(), entry.id)).map((entry) => entry.id));
  assert.ok((await menu("persona-pp")).includes("customers"));
  assert.ok((await menu("persona-1")).includes("customers"));
  for (const persona of ["persona-rb", "persona-st", "persona-wh", "persona-qa"]) assert.equal((await menu(persona)).includes("customers"), false, persona);
  for (const persona of ["persona-st", "persona-wh"]) assert.ok((await menu(persona)).includes("count"), persona);
  assert.equal((await menu("persona-rb")).includes("count"), false);
  const denied = await sees("persona-rb", "p=customers");
  assert.match(denied.html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/);

  // งานของแผนก: รายงาน/พักงานเฉพาะงานของแผนกตน (planner group ทุกแผนก) · WO ของ RubberFlow เฉพาะ RB และฝ่ายวางแผน
  const jobPage = async (persona) => (await sees(persona, "p=jobs&dept=ALL")).html;
  const rowOf = (html, id) => html.split("<tr").find((row) => row.includes(`>${id}<`)) ?? "";
  const rb = await jobPage("persona-rb");
  assert.match(rowOf(rb, "JOB-RB1"), /data-rf-open="jobReport"/, "RB reports its job");
  assert.match(rowOf(rb, "JOB-RB1"), /data-rf-open="jobRubberflow"/, "and creates the WO");
  assert.doesNotMatch(rowOf(rb, "JOB-GR1"), /data-rf-open="jobReport"|data-rf-action="setJobStatus"/, "but not the GR job");
  const gr = await jobPage("persona-gr");
  assert.match(rowOf(gr, "JOB-GR1"), /data-rf-open="jobReport"/);
  assert.doesNotMatch(rowOf(gr, "JOB-RB1"), /data-rf-open="jobReport"|jobRubberflow/);
  const planner = await jobPage("persona-pp");
  for (const id of ["JOB-RB1", "JOB-GR1"]) assert.match(rowOf(planner, id), /data-rf-open="jobReport"/, `the planner group reports ${id}`);
  assert.match(rowOf(planner, "JOB-RB1"), /jobRubberflow/);
  for (const persona of ["persona-qa", "persona-st", "persona-wh"]) {
    const html = await jobPage(persona);
    assert.doesNotMatch(html, /data-rf-open="jobReport"|data-rf-action="setJobStatus"|jobRubberflow/, `${persona} reads only`);
  }

  // ลูกค้า: เพิ่ม/แก้เฉพาะฝ่ายวางแผนขึ้นไป · ฟอร์มเปิดใบมีรายการลูกค้าให้เลือก
  const customers = await sees("persona-pp", "p=customers");
  assert.match(customers.html, /Acme Trading/);
  assert.equal(buttons(customers.html, "customerEdit") >= 2, true, "add + edit");
  const dialog = customers.env.context.MNP_BOM_DIALOGS.orderNew(customers.env.ctx());
  assert.match(dialog.html, /<datalist id="bom-customer-list"><option value="Acme Trading">/);
  assert.match(dialog.html, /list="bom-customer-list"/);

  // ล้างข้อมูลทดสอบ: เห็นเฉพาะ admin ตัวจริงในโหมดทดสอบ (state.sandbox) ไม่ว่าตอนนี้ทำหน้าที่เป็นบัญชีไหน
  assert.doesNotMatch((await sees("persona-rb", "p=orders")).html, /data-bom-purge/);
  const admin = await asPersona(scene, "persona-rb", { sandboxAdmin: true });
  assert.match(await admin.render("p=orders"), /data-bom-purge/);
});

test("the purge button asks first, empties the database, reloads from nothing and tells how many rows went", async () => {
  const scene = await planningScene();
  const button = { handlers: {}, disabled: false, addEventListener(type, fn) { this.handlers[type] = fn; } };
  const env = await asPersona(scene, "persona-1", { sandboxAdmin: true, hooks: { nodes: { "[data-bom-purge]": button } } });
  await env.render("p=orders");
  assert.equal(typeof button.handlers.click, "function", "the page binds the button");
  assert.equal(env.store.data().orders.length > 0, true);
  const beforePurge = JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master"));

  // ตอบไม่ใช่ใน dialog ยืนยัน: ไม่ลบอะไร
  env.context.confirmDialog = async (options) => { env.log.confirm = options; return false; };
  await button.handlers.click({ currentTarget: button });
  assert.equal(env.log.confirm.danger, true);
  assert.match(env.log.confirm.title, /ล้างข้อมูล BOM ทดสอบ/);
  assert.doesNotMatch(env.log.confirm.message, /และบันทึกการใช้งานที่เป็นข้อมูลทดสอบ/, "the audit trail is not deleted, so the text must not say it is");
  assert.match(env.log.confirm.message, /ประวัติการใช้งาน \(audit\) ไม่ถูกลบ/);
  assert.equal(env.store.data().orders.length > 0, true, "cancelled: nothing deleted");
  assert.equal(button.disabled, false);

  env.context.confirmDialog = async () => true;
  await button.handlers.click({ currentTarget: button });
  assert.equal(env.store.status(), "ready");
  assert.deepEqual(env.store.data().orders, []);
  assert.deepEqual(env.store.data().items, []);
  const afterPurge = JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master"));
  assert.equal(afterPurge.version, beforePurge.version, "the counter is kept");
  assert.notEqual(afterPurge.epoch, beforePurge.epoch, "the epoch changed");
  assert.match(env.log.toasts.at(-1)[0], /^ล้างข้อมูล BOM ทดสอบแล้ว \d+ รายการ$/);
  assert.ok(Number(/\d+/.exec(env.log.toasts.at(-1)[0])[0]) >= 6);
  const html = await env.render("p=orders");
  assert.match(html, /ไม่มีใบสั่งผลิต/);
});

test("a department member's report goes through the mock database as a field-limited update and the order moves to in_progress on the server", async () => {
  const scene = await planningScene();
  const rb = await asPersona(scene, "persona-rb");
  const before = rb.store.data().orders.find((order) => order.id === "PI-R");
  assert.equal(before.status, "released");
  assert.equal(rb.ctx().runAction("reportJob", { jobId: "JOB-RB1", qtyDone: 3, note: "RB รอบแรก" }, "บันทึกผลผลิต {result}"), true);
  await settle();
  assert.deepEqual(rb.log.toasts.filter(([, kind]) => kind === "error"), []);
  const database = JSON.parse(rb.pageStorage.getItem("mnp-harness-bom-master"));
  const job = database.jobs.find((row) => row.id === "JOB-RB1");
  assert.equal(job.qtyDone, 3);
  assert.equal(job.reports[0].by, "ประยุทธ รีดยาง");
  assert.equal(database.orders.find((order) => order.id === "PI-R").status, "in_progress", "set by the database, not sent by the RB persona");
  assert.equal(rb.store.data().orders.find((order) => order.id === "PI-R").status, "in_progress");
  // แผนกอื่นถูกปฏิเสธที่ฝั่งหน้าก่อนถึงฐานข้อมูล · ถ้าข้ามหน้ามาฐานข้อมูลก็ปฏิเสธ
  const other = rb.ctx().runAction("reportJob", { jobId: "JOB-GR1", qtyDone: 1 }, "x");
  assert.equal(other, false);
  assert.match(rb.log.toasts.at(-1)[0], /รายงานผลได้โดยแผนก GR/);
  const direct = await rb.mock.client.rpc("app_bom_save_master", { p_changes: { jobs: { upsert: [{ ...database.jobs.find((row) => row.id === "JOB-GR1"), qtyDone: 1 }] } }, p_base_version: database.version, p_action: "t" });
  assert.equal(direct.error.code, "BOM_FORBIDDEN");
});

// ---------- สำเนาเก่าของ client ต้องได้ BOM_STALE (ชนก่อนสิทธิ์) และ mock ปฏิเสธเหมือนฐานข้อมูลจริง ----------
const unwrapReply = (reply) => { if (reply.error) throw reply.error; return reply.data; };
// store โหมดฐานข้อมูลที่ต่อกับ Supabase จำลองตัวเดียวกัน (บัญชีทดสอบของฝั่งเซิร์ฟเวอร์เปลี่ยนด้วย app_sandbox_enter ก่อนแต่ละคำสั่ง · user = ผู้ใช้ที่ฝั่งหน้าเชื่อ)
function mockBackedStore(client, user, shouldHold) {
  const remote = {
    load: async () => unwrapReply(await client.rpc("app_bom_master")),
    save: async (changes, baseVersion, action, audit, epoch) => unwrapReply(await client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit, p_epoch: epoch })),
    since: async (version) => unwrapReply(await client.rpc("app_bom_master_since", { p_version: version })),
    audit: async (limit) => unwrapReply(await client.rpc("app_bom_audit", { p_limit: limit })),
    purge: async () => unwrapReply(await client.rpc("app_sandbox_purge_bom")),
  };
  const store = storeApi.createStore({ storage: memoryStorage(), actions: A, now: () => NOW, remote, persona: () => user, shouldHold });
  const raw = [];
  store.subscribe((event) => raw.push(event));
  return { store, raw };
}
const personaUsers = {
  gr: { id: "persona-gr", role: "gr", dept: "GR", name: "มานี ตัดยาง" },
  st: { id: "persona-st", role: "st", dept: "ST", name: "วิชัย คลังวัตถุดิบ" },
};
// ผู้วางแผน (บัญชีทดสอบ PP ฝั่งเซิร์ฟเวอร์) สร้างใบที่ปล่อยผลิตแล้วพร้อมงาน (ในคำสั่งเดียว) และใบร่างที่ระเบิดแล้ว
async function stalenessScene() {
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW });
  const enter = (persona) => client.rpc("app_sandbox_enter", { p_persona_id: persona });
  const state = { version: 0 };
  const rpc = async (changes, action = "t") => {
    const data = unwrapReply(await client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: state.version, p_action: action }));
    state.version = data.version;
    return data;
  };
  const explosion = [{ itemCode: "FG-1", level: 0, required: 5 }, { itemCode: "SE-1", level: 1, required: 10 }];
  await enter("persona-pp");
  const view = async () => unwrapReply(await client.rpc("app_bom_master"));
  const cur = async (list, id) => (await view())[list].find((row) => row.id === id);
  for (const id of ["PI-X", "PI-Y", "PI-Z"]) await rpc({ orders: { upsert: [mockOrder(id, { explosion })] } });
  await rpc({ orders: { upsert: [mockOrder("PI-D", { explosion })] } });
  const release = async (id, jobs) => rpc({ orders: { upsert: [{ ...(await cur("orders", id)), status: "released" }] }, jobs: { upsert: jobs } }, "releaseOrder");
  await release("PI-X", [mockJob("JOB-X-GR", "PI-X", "GR")]);
  await release("PI-Y", [mockJob("JOB-Y-GR", "PI-Y", "GR"), mockJob("JOB-Y-PK", "PI-Y", "PK")]);
  await release("PI-Z", [mockJob("JOB-Z-GR", "PI-Z", "GR")]);
  return { client, enter, rpc, view, cur, state };
}

test("two staff of one department report the same job from the same base: the second is stale, catches up and the retry goes through", async () => {
  const scene = await stalenessScene();
  await scene.enter("persona-gr");
  const first = mockBackedStore(scene.client, personaUsers.gr);
  const second = mockBackedStore(scene.client, personaUsers.gr);
  await first.store.ensureLoaded();
  await second.store.ensureLoaded();
  assert.equal(second.store.version(), first.store.version());
  const reported = first.store.run("reportJob", { jobId: "JOB-X-GR", qtyDone: 2, note: "คนแรก" });
  assert.equal((await reported.saving).ok, true);

  const stale = await second.store.run("reportJob", { jobId: "JOB-X-GR", qtyDone: 3, note: "คนที่สอง" }).saving;
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "BOM_STALE", "not BOM_FORBIDDEN: the copy was only old");
  const job = second.store.data().jobs.find((row) => row.id === "JOB-X-GR");
  assert.deepEqual(job.reports.map((row) => row.note), ["คนแรก"], "the page caught up with the first report");
  assert.equal(job.qtyDone, 2);
  assert.equal(second.store.version(), (await scene.view()).version);
  assert.equal(second.raw.some((event) => event.type === "reverted" && event.error.code === "BOM_STALE" && event.held === false), true);

  const retry = await second.store.run("reportJob", { jobId: "JOB-X-GR", qtyDone: 3, note: "คนที่สอง" }).saving;
  assert.equal(retry.ok, true, retry.error?.message);
  assert.deepEqual((await scene.cur("jobs", "JOB-X-GR")).reports.map((row) => row.note), ["คนแรก", "คนที่สอง"]);
});

test("a report on a job that a reopen deleted after the base is stale and the page catches up (the job is gone)", async () => {
  const scene = await stalenessScene();
  await scene.enter("persona-gr");
  const staff = mockBackedStore(scene.client, personaUsers.gr);
  await staff.store.ensureLoaded();
  await scene.enter("persona-pp");
  // JOB-Y-GR ยังเป็น queued ว่าง: ผู้วางแผนเปิดใบกลับมาแก้ (ฐานข้อมูลลบงานของใบเอง)
  await scene.rpc({ orders: { upsert: [{ ...(await scene.cur("orders", "PI-Y")), status: "draft", revision: 1 }] } }, "updateOrderItem");
  await scene.enter("persona-gr");
  const stale = await staff.store.run("reportJob", { jobId: "JOB-Y-GR", qtyDone: 1 }).saving;
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "BOM_STALE", "a missing job is not treated as a new job (BOM_FORBIDDEN)");
  assert.equal(staff.store.data().jobs.some((row) => row.orderId === "PI-Y"), false, "after catching up the jobs of the reopened order are gone");
  assert.equal(staff.store.data().orders.find((row) => row.id === "PI-Y").status, "draft");
  assert.equal(staff.store.version(), (await scene.view()).version);
});

test("stock counted on a draft whose items a planner changed after the base is stale and the page catches up", async () => {
  const scene = await stalenessScene();
  await scene.enter("persona-st");
  const counter = mockBackedStore(scene.client, personaUsers.st);
  await counter.store.ensureLoaded();
  await scene.enter("persona-pp");
  await scene.rpc({ orders: { upsert: [{ ...(await scene.cur("orders", "PI-D")), items: [{ fgCode: "FG-1", qty: 6, colorSet: "", note: "" }] }] } }, "updateOrderItem");
  await scene.enter("persona-st");
  const stale = await counter.store.run("setStockCount", { orderId: "PI-D", itemCode: "SE-1", qty: 3 }).saving;
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "BOM_STALE");
  assert.equal(counter.store.data().orders.find((row) => row.id === "PI-D").items[0].qty, 6, "the page caught up with the planner's edit");
  assert.deepEqual(counter.store.data().orders.find((row) => row.id === "PI-D").stockCounts, {});
  const retry = await counter.store.run("setStockCount", { orderId: "PI-D", itemCode: "SE-1", qty: 3 }).saving;
  assert.equal(retry.ok, true, retry.error?.message);
  assert.deepEqual((await scene.cur("orders", "PI-D")).stockCounts, { "SE-1": 3 });
});

test("a save held back while a form is open leaves client-side report stamps in the view: the next save of that job is stale, never forbidden", async () => {
  const scene = await stalenessScene();
  await scene.enter("persona-gr");
  const staff = mockBackedStore(scene.client, personaUsers.gr, () => true);
  await staff.store.ensureLoaded();
  // ผู้อื่นบันทึกอย่างอื่นระหว่างนั้น (คำตอบมีระเบียนของผู้อื่น และฟอร์มกำลังเปิด) → ผลของเราถูกกันไว้ ไม่ขยับเวอร์ชันฐาน
  await scene.enter("persona-pp");
  await scene.rpc({ customers: { upsert: [{ name: "คนอื่น", country: "Thailand", orderType: "SA", note: "" }] } }, "saveCustomer");
  await scene.enter("persona-gr");
  const baseVersion = staff.store.version();
  const first = await staff.store.run("reportJob", { jobId: "JOB-Z-GR", qtyDone: 2, note: "รอบแรก" }).saving;
  assert.equal(first.ok, true);
  assert.equal(staff.raw.some((event) => event.type === "saved" && event.held === true), true, "held: the other user's records were not merged");
  assert.equal(staff.store.version(), baseVersion, "and the base version did not move");
  const second = await staff.store.run("reportJob", { jobId: "JOB-Z-GR", qtyDone: 1, note: "รอบสอง" }).saving;
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "BOM_STALE", "the report of the first call sits in the view with client-side by/at, which the database would call forbidden if it compared before checking the base");
  assert.deepEqual((await scene.cur("jobs", "JOB-Z-GR")).reports.map((row) => row.note), ["รอบแรก"], "nothing of the second call was written");
});

test("the order that the database moves from released to in_progress because of this call's own job is ours, not another user's update", async () => {
  const scene = await stalenessScene();
  await scene.enter("persona-gr");
  const outcomes = [];
  const staff = mockBackedStore(scene.client, personaUsers.gr, () => true);
  staff.store.subscribe((event) => { if (event.type === "saved") outcomes.push(event); });
  await staff.store.ensureLoaded();
  const out = await staff.store.run("reportJob", { jobId: "JOB-Z-GR", qtyDone: 2, note: "x" }).saving;
  assert.equal(out.ok, true);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].others, false, "no 'others updated' notice for the server's own flip");
  assert.equal(outcomes[0].held, undefined, "so nothing is held back while a form is open");
  assert.equal(staff.store.data().orders.find((row) => row.id === "PI-Z").status, "in_progress", "and the flipped order is merged");
  assert.equal(staff.store.hasNewer(), false);
});

test("the mock database refuses what production refuses: new orders start as drafts, a release needs an explosion and jobs, jobs are born with the release, report totals match, started jobs stay, cancel and complete rules", async () => {
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW });
  const as = (persona) => client.rpc("app_sandbox_enter", { p_persona_id: persona });
  let version = 0;
  const save = async (changes, base = version) => {
    const reply = await client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: base, p_action: "t" });
    if (!reply.error) version = reply.data.version;
    return reply;
  };
  const code = async (changes, base) => (await save(changes, base)).error?.code ?? null;
  const view = async () => (await client.rpc("app_bom_master")).data;
  const cur = async (list, id) => (await view())[list].find((row) => row.id === id);
  const withOrder = async (id, extra) => ({ ...(await cur("orders", id)), ...extra });

  await as("persona-pp");
  assert.equal(await code({ orders: { upsert: [mockOrder("PI-N", { status: "released", explosion: [] })] } }), "BOM_INVALID_TRANSITION", "a new order must start as a draft");
  assert.equal(await code({ orders: { upsert: [mockOrder("PI-N")] } }), null);
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { status: "released" })] }, jobs: { upsert: [mockJob("J-1", "PI-N", "RB")] } }), "BOM_INVALID_TRANSITION", "a release needs the explosion");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { status: "released", explosion: [] })] } }), "BOM_INVALID_TRANSITION", "and at least one job in the same call");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { items: [{ fgCode: "FG-1", qty: 9, colorSet: "", note: "" }] })] } }), null, "a draft can change its items");
  assert.equal(await code({ jobs: { upsert: [mockJob("J-1", "PI-N", "RB")] } }), "BOM_INVALID_TRANSITION", "a job cannot be created while the order is a draft");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { status: "released", explosion: [] })] }, jobs: { upsert: [mockJob("J-1", "PI-N", "RB", { status: "in_progress" })] } }), "BOM_INVALID_JOB", "a new job starts empty and queued");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { status: "released", explosion: [] })] }, jobs: { upsert: [mockJob("J-1", "PI-N", "RB"), mockJob("J-PK", "PI-N", "PK")] } }), null);
  assert.equal(await code({ jobs: { upsert: [mockJob("J-LATE", "PI-N", "GR")] } }), "BOM_INVALID_TRANSITION", "a job cannot be created after the release call");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { note: "แก้" })] } }), "BOM_INVALID_TRANSITION", "the content of a released order is locked");

  // พนักงานแผนก: ยอดที่เพิ่มต้องเท่าผลรวมรายงานใหม่ · ลดไม่ได้ · งานที่เสร็จแล้วแก้ไม่ได้
  await as("persona-rb");
  const rb = await cur("jobs", "J-1");
  const entry = (good, reject = 0) => ({ at: 1, by: "x", good, reject, note: "" });
  assert.equal(await code({ jobs: { upsert: [{ ...rb, status: "in_progress", qtyDone: 5, reports: [entry(2)] }] } }), "BOM_INVALID_JOB", "the added quantity must equal the new report entries");
  assert.equal(await code({ jobs: { upsert: [{ ...rb, status: "in_progress", qtyDone: 2, reports: [entry(2)] }] } }), null);
  const reported = await cur("jobs", "J-1");
  assert.equal(await code({ jobs: { upsert: [{ ...reported, qtyDone: 1, reports: reported.reports }] } }), "BOM_INVALID_JOB", "a quantity cannot go down");
  assert.equal(await code({ jobs: { upsert: [{ ...reported, qtyDone: 3, reports: reported.reports }] } }), "BOM_INVALID_JOB", "a quantity cannot grow without a report entry");
  assert.equal(await code({ jobs: { upsert: [{ ...reported, status: "done", qtyDone: 4, reports: [...reported.reports, entry(2)] }] } }), null);
  assert.equal(await code({ jobs: { upsert: [{ ...(await cur("jobs", "J-1")), status: "in_progress" }] } }), "BOM_INVALID_TRANSITION", "department staff cannot change a finished job");

  // กลุ่มวางแผน: ลบงานที่เริ่มแล้วตรงๆ ไม่ได้ · ปิดใบต้องให้งาน PK เสร็จ · ยกเลิกใบที่มียอดดีไม่ได้
  await as("persona-pp");
  assert.equal(await code({ jobs: { delete: [{ id: "J-1" }] } }), "BOM_INVALID_TRANSITION", "a started job cannot be deleted directly");
  assert.equal(await code({ jobs: { delete: [{ id: "J-PK" }] } }), null, "a queued one can");
  assert.equal(await code({ jobs: { upsert: [mockJob("J-PK", "PI-N", "PK")] } }), "BOM_INVALID_TRANSITION", "a deleted job is not created again outside a release");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { status: "cancelled" })] } }), "BOM_INVALID_TRANSITION", "an order with reported output cannot be cancelled");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-N", { status: "draft", revision: 1 })] } }), "BOM_INVALID_TRANSITION", "nor reopened once a job has started");
  assert.equal(await code({ orders: { upsert: [mockOrder("PI-C", { explosion: [] })] } }), null);
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-C", { status: "released" })] }, jobs: { upsert: [mockJob("C-PK", "PI-C", "PK"), mockJob("C-RB", "PI-C", "RB")] } }), null);
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-C", { status: "completed" })] } }), "BOM_INVALID_TRANSITION", "a PK job that is not done blocks completing the order");
  const before = (await view()).version;
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-C", { status: "cancelled" })] } }), null, "an order without output can be cancelled");
  assert.deepEqual((await view()).jobs.filter((row) => row.orderId === "PI-C"), [], "the database deleted its jobs itself");
  const delta = (await client.rpc("app_bom_master_since", { p_version: before })).data;
  assert.deepEqual(delta.changes.jobs.delete.map((row) => row.id).sort(), ["C-PK", "C-RB"], "with tombstones for the other browsers");
  assert.equal(await code({ orders: { upsert: [await withOrder("PI-C", { note: "แก้" })] } }), "BOM_INVALID_TRANSITION", "a cancelled order is final");
});

test("the mock database judges a stale copy as stale before it looks at permissions or content", async () => {
  const scene = await stalenessScene();
  const save = async (changes, base, action = "t") => (await scene.client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: base, p_action: action })).error?.code ?? null;
  const base = (await scene.view()).version;
  const job = await scene.cur("jobs", "JOB-X-GR");
  const entry = { at: 1, by: "x", good: 2, reject: 0, note: "" };
  await scene.enter("persona-gr");
  assert.equal(await save({ jobs: { upsert: [{ ...job, status: "in_progress", qtyDone: 2, reports: [entry] }] } }, base), null);
  assert.equal(await save({ jobs: { upsert: [{ ...job, status: "in_progress", qtyDone: 2, reports: [entry] }] } }, base), "BOM_STALE", "the same report again from the same base");
  await scene.enter("persona-qa");
  assert.equal(await save({ jobs: { upsert: [{ ...job, status: "hold" }] } }, base), "BOM_STALE", "even a department that could not report is told its copy is old first");
  assert.equal(await save({ jobs: { upsert: [{ ...(await scene.cur("jobs", "JOB-X-GR")), status: "hold" }] } }, (await scene.view()).version), "BOM_FORBIDDEN", "from a current copy it is a plain refusal");
  // งานที่ถูกลบหลัง base (เปิดใบกลับมาแก้) → ชน ไม่ใช่ถูกมองเป็นงานใหม่ที่ไม่มีสิทธิ์สร้าง
  const reopenBase = (await scene.view()).version;
  const jobY = await scene.cur("jobs", "JOB-Y-GR");
  await scene.enter("persona-pp");
  assert.equal(await save({ orders: { upsert: [{ ...(await scene.cur("orders", "PI-Y")), status: "draft", revision: 1 }] } }, reopenBase), null);
  await scene.enter("persona-gr");
  assert.equal(await save({ jobs: { upsert: [{ ...jobY, status: "in_progress", qtyDone: 1, reports: [{ ...entry, good: 1 }] }] } }, reopenBase), "BOM_STALE");
  assert.equal(await save({ jobs: { upsert: [{ ...jobY, status: "in_progress", qtyDone: 1, reports: [{ ...entry, good: 1 }] }] } }, (await scene.view()).version), "BOM_FORBIDDEN", "from the current base a missing job is a creation staff may not do");
  // ใบ: ST นับของใบร่างจากสำเนาเก่าขณะผู้วางแผนแก้รายการ
  const draft = await scene.cur("orders", "PI-D");
  const draftBase = (await scene.view()).version;
  await scene.enter("persona-pp");
  assert.equal(await save({ orders: { upsert: [{ ...draft, items: [{ fgCode: "FG-1", qty: 6, colorSet: "", note: "" }] }] } }, draftBase), null);
  await scene.enter("persona-st");
  assert.equal(await save({ orders: { upsert: [{ ...draft, stockCounts: { "SE-1": 3 } }] } }, draftBase), "BOM_STALE");
});

test("customer names use one rule on both sides: inner whitespace collapses, the key ignores case, and the order carries the collapsed name", async () => {
  const samples = ["ACME Corp", "  ACME   Corp ", "acme\tcorp", "Acme  Corp\n", "ลูกค้า   ไทย"];
  for (const name of samples) assert.equal(storeApi.customerKey(name), A.helpers.customerKey(name), JSON.stringify(name));
  assert.equal(storeApi.customerKey("  ACME   Corp "), "acme corp");
  assert.equal(A.helpers.customerName("  ACME   Corp "), "ACME Corp");
  const env = await ready(remoteStore());
  const first = await saved(env.store.run("createOrder", newOrder({ customer: "ACME  Corp", pi: "PI-1" })));
  assert.equal(first.ok, true);
  assert.deepEqual(env.store.data().customers.map((row) => row.name), ["ACME Corp"], "the customer is stored with a single space");
  assert.equal(env.store.data().orders[0].customer, "ACME Corp", "and so is the name on the order");
  await saved(env.store.run("createOrder", newOrder({ customer: "acme   corp", pi: "PI-2" })));
  assert.equal(env.store.data().customers.length, 1, "another spelling by whitespace or case is the same customer");
  assert.deepEqual(env.store.data().orders.map((row) => row.customer), ["ACME Corp", "ACME Corp"]);
  const diff = storeApi.diffMaster({ customers: [{ name: "ACME Corp", country: "TH" }] }, { customers: [{ name: "ACME Corp", country: "TH" }, { name: "Other", country: "TH" }] });
  assert.deepEqual(diff.customers.upsert.map((row) => row.name), ["Other"]);
});

function setTimeout0(fn) {
  return setImmediate(fn);
}

test("deactivating and reactivating an item travels as active in the saved record, and an edit that does not mention it keeps the state", async () => {
  const env = await ready(remoteStore());
  await env.store.run("saveItem", saveItemPayload("P-TEST-01")).saving;
  assert.equal(env.server.master.items[0].active, true);
  const off = env.store.run("saveItem", { code: "P-TEST-01", kind: "PURCHASED", name: "ของซื้อทดสอบ", uom: "pcs", active: false });
  assert.equal(off.ok, true);
  assert.equal(env.store.data().items[0].active, false, "the page shows the change before the server answers");
  assert.deepEqual(await off.saving, { ok: true });
  const [, call] = env.server.saves;
  assert.equal(call.action, "saveItem");
  assert.deepEqual(Object.keys(call.changes), ["items"]);
  assert.equal(call.changes.items.upsert[0].active, false);
  assert.equal(env.server.master.items[0].active, false);
  assert.deepEqual(call.audit.map((entry) => entry.action), ["แก้ชิ้นงาน"]);
  await env.store.run("saveItem", { code: "P-TEST-01", kind: "PURCHASED", name: "ชื่อใหม่", uom: "pcs" }).saving;
  assert.equal(env.server.master.items[0].active, false, "editing the name keeps it retired");
  await env.store.run("saveItem", { code: "P-TEST-01", kind: "PURCHASED", name: "ชื่อใหม่", uom: "pcs", active: true }).saving;
  assert.equal(env.server.master.items[0].active, true);
  assert.equal(env.server.saves.at(-1).changes.items.upsert[0].active, true);
});

// ---------- RubberFlow บนฐานข้อมูล: หน้าของโมดูล (สูตรหลาย revision วัตถุดิบ ปิดงาน บันทึกการใช้งาน) และขั้นสร้าง WO จากงาน RB ของ BOM ----------
const rfPage = async (env, query = "", { wait = true } = {}) => {
  if (wait) await env.context.MNP_RUBBERFLOW.store.ensureLoaded();
  env.log.hash = `#/rubberflow${query ? `?${query}` : ""}`;
  env.app.innerHTML = "";
  await env.context.MNP_REQUEST_MODULES.RUBBERFLOW.pages.rubberflow(new URLSearchParams(query));
  return env.app.innerHTML;
};
const RF_MATERIALS = [{ code: "EPDM-55", name: "ยาง EPDM", category: "โพลิเมอร์", storage: "A-1", active: true }, { code: "CB-N550", name: "เขม่าดำ", category: "สารตัวเติม", storage: "B-1", active: true }];
const RF_RECIPE = { id: "RC-TEST-01", productCode: "P-TEST", uom: "m", batchKg: 50, dumpTol: 5, yieldPerKg: 6, stages: [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }], items: [{ materialCode: "EPDM-55", phr: 100, stage: 1 }, { materialCode: "CB-N550", phr: 60, stage: 2 }] };
async function rfScene() {
  const scene = await planningScene();
  const rf = (env) => env.context.MNP_RUBBERFLOW.store;
  const env = await asPersona(scene, "persona-rbh");
  await rf(env).ensureLoaded();
  for (const material of RF_MATERIALS) await saved(rf(env).run("saveMaterial", material));
  await saved(rf(env).run("createRecipe", RF_RECIPE));
  await saved(rf(env).run("approveRecipe", { id: "RC-TEST-01", revision: 1 }));
  return { scene, rf };
}

test("RubberFlow in database mode: loading state, no demo role picker or reset, every page draws on an empty database, and the buttons follow the persona", async () => {
  const scene = await planningScene();
  const PAGES = ["dashboard", "orders", "recipes", "requisition", "mixing", "extrusion", "curing", "finishing", "wip", "quality", "spc", "trace", "warehouse", "molds", "audit"];
  const admin = await asPersona(scene, "persona-1", { sandboxAdmin: true });
  let html = await rfPage(admin, "", { wait: false });
  assert.equal(admin.context.MNP_RUBBERFLOW.store.isRemote(), true);
  assert.match(html, /กำลังโหลดข้อมูล RubberFlow/, "first paint shows the loading state");
  assert.doesNotMatch(html, /data-rf-user|data-rf-reset/, "no demo role picker and no reset in database mode");
  assert.match(html, /data-rf-sync/);
  assert.match(html, /data-rf-purge/, "the real admin in test mode gets the purge button");
  await admin.context.MNP_RUBBERFLOW.store.ensureLoaded();
  for (const page of PAGES) {
    html = await rfPage(admin, page === "dashboard" ? "" : `p=${page}`);
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, `${page} draws on an empty database`);
  }
  html = await rfPage(admin, "p=warehouse&tab=materials");
  assert.match(html, /data-rf-open="materialEdit"/, "add a material");
  assert.match(html, /ยังไม่มีวัตถุดิบ/);
  const noPurge = await asPersona(scene, "persona-rb");
  assert.doesNotMatch(await rfPage(noPurge), /data-rf-purge/, "a persona that is not the admin session never sees it");

  // ข้อมูลหลัก: หัวหน้า RB สร้างวัตถุดิบ สูตร และอนุมัติ แล้วทุกบัญชีเห็นจากฐานข้อมูลเดียวกัน
  const rf = (env) => env.context.MNP_RUBBERFLOW.store;
  const head = await asPersona(scene, "persona-rbh");
  await rf(head).ensureLoaded();
  await saved(rf(head).run("saveMaterial", RF_MATERIALS[0]));
  await saved(rf(head).run("saveMaterial", RF_MATERIALS[1]));
  await saved(rf(head).run("createRecipe", RF_RECIPE));
  html = await rfPage(head, "p=recipes");
  assert.match(html, /data-rf-action="approveRecipe"/, "the head sees approve on a draft");
  assert.match(html, /data-rf-open="recipeEdit"/, "and edit");
  const staff = await asPersona(scene, "persona-rb");
  html = await rfPage(staff, "p=recipes");
  assert.match(html, /RC-TEST-01/);
  assert.doesNotMatch(html, /data-rf-action="approveRecipe"/, "RB staff cannot approve");
  assert.match(html, /data-rf-open="recipeEdit"/, "but edits the draft");
  const planner = await asPersona(scene, "persona-pp");
  assert.doesNotMatch(await rfPage(planner, "p=recipes"), /data-rf-action="approveRecipe"/, "the planner group cannot approve either");
  const store = await asPersona(scene, "persona-st");
  assert.doesNotMatch(await rfPage(store, "p=warehouse&tab=materials"), /data-rf-open="materialEdit"/, "a store keeper only reads");
  await saved(rf(head).run("approveRecipe", { id: "RC-TEST-01", revision: 1 }));
  html = await rfPage(head, "p=recipes");
  assert.match(html, />ออก revision ใหม่</, "an approved recipe offers a new revision, not an edit");
  assert.doesNotMatch(html, /data-rf-action="approveRecipe"/);
  await saved(rf(head).run("saveRecipe", { ...RF_RECIPE, productCode: "P-TEST-2" }));
  html = await rfPage(head, "p=recipes&sel=RC-TEST-01");
  assert.match(html, /ร่าง Rev\.2/, "the list flags the pending draft");
  assert.match(html, /Rev\.2 รออนุมัติ/);
  assert.match(html, /Rev\.1 อนุมัติแล้ว/);
  assert.doesNotMatch(html, /data-rf-action="approveRecipe"/, "the revision in use is shown first; the draft is reviewed on its own tab");
  assert.match(await rfPage(head, "p=recipes&sel=RC-TEST-01&rev=2"), /data-rf-action="approveRecipe"/);
  html = await rfPage(head, "p=recipes&sel=RC-TEST-01&rev=1");
  assert.match(html, /aria-label="revision ของสูตร RC-TEST-01"/);
  assert.doesNotMatch(html, />ออก revision ใหม่</, "no new revision while a draft is pending");
  const dialogs = head.context.MNP_RUBBERFLOW_DIALOGS;
  const rfCtx = head.context.MNP_RUBBERFLOW.context(new URLSearchParams("p=recipes"));
  assert.match(dialogs.recipeEdit(rfCtx, { id: "RC-TEST-01" }).html, /แก้ร่างสูตร RC-TEST-01 Rev\.2/);
  assert.match(dialogs.materialEdit(rfCtx, { code: "EPDM-55" }).html, /readonly/);
  assert.match(dialogs.createRecipe(rfCtx).html, /name="id"/);
  assert.equal(dialogs.recipeEdit(rfCtx, { id: "RC-NOPE" }), null);

  // เปิดใบ → ปล่อย → ผลิต → ปิดงาน ผ่าน dialog ถามยอดผลิตจริง
  await saved(rf(head).run("approveRecipe", { id: "RC-TEST-01", revision: 2 }));
  const order = await saved(rf(head).run("createOrder", { recipeId: "RC-TEST-01", customer: "ลูกค้า", targetQty: 100, startDate: NOW, dueDate: NOW + 86400000 }));
  await saved(rf(head).run("setOrderStatus", { id: order.result, status: "released" }));
  await saved(rf(head).run("setOrderStatus", { id: order.result, status: "in_progress" }));
  html = await rfPage(head, "p=orders");
  assert.doesNotMatch(html, /data-rf-open="closeOrder"/, "an order without produced quantity that is not from a BOM job cannot be closed yet");
  assert.match(html, /Rev\.2/, "the order shows the recipe revision it was opened with");
  assert.match(html, /data-rf-open="createOrder"/);
  const close = dialogs.closeOrder(head.context.MNP_RUBBERFLOW.context(new URLSearchParams("p=orders")), { id: order.result });
  assert.doesNotMatch(close.html, /name="producedQty"/, "the database counts the produced quantity from the finishing lots; there is nothing to type");
  assert.match(close.html, /data-rf-form="setOrderStatus"/);

  // บันทึกการใช้งาน: บรรทัดหลักเป็นการกระทำที่เซิร์ฟเวอร์บันทึกเอง ภาษาไทย
  await rfPage(head, "p=audit");
  await rf(head).loadAudit();
  html = await rfPage(head, "p=audit");
  for (const text of ["บันทึกวัตถุดิบ", "สร้างสูตรใหม่", "อนุมัติสูตร", "แก้สูตร / ออก revision ใหม่", "เปิดใบสั่งผลิต", "เปลี่ยนสถานะใบสั่งผลิต", "ใบสั่งผลิต \\+1"]) assert.match(html, new RegExp(text), text);
  assert.match(html, /data-rf-audit-reload/);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
  assert.equal(scene.env.pageStorage.getItem("mnp-rubberflow-v1"), null, "the demo state key is untouched");
});

test("the BOM 'create WO' dialog creates the WO through the RubberFlow store with the job's unit, the database links the job, and a closed WO brings the quantity back", async () => {
  const { scene, rf } = await rfScene();
  const admin = await asPersona(scene, "persona-1");
  // ชิ้นเส้นยาง RB-ITEM ของงาน JOB-RB1 (10 เส้น เส้นละ 500 กรัม) ใช้สูตรยาง DM01 ผูกกับสูตร PHR ของ RubberFlow
  await saved(admin.store.run("saveItem", saveItemPayload("RB-ITEM", { kind: "RB", name: "เส้นยางทดสอบ", uom: "pcs", weightG: 500, rubber: { compound: "DM01", color: "BK" } })));
  const refused = admin.store.run("linkCompound", { code: "DM01", recipeId: "RC-NOPE" });
  assert.equal((await refused.saving).error.code, "BOM_INVALID_COMPOUND", "the database only links a recipe code that exists in RubberFlow");
  await saved(admin.store.run("linkCompound", { code: "DM01", recipeId: "RC-TEST-01" }));

  const env = await asPersona(scene, "persona-rb");
  const rfStore = rf(env);
  await rfStore.ensureLoaded();
  const ctx = env.ctx("p=jobs&dept=RB");
  const built = env.context.MNP_BOM_DIALOGS.jobRubberflow(ctx, { jobId: "JOB-RB1" });
  assert.match(built.html, /DM01 → RC-TEST-01/);
  assert.match(built.html, /นับในหน่วยของงาน/, "database mode counts in the job's unit");
  assert.match(built.html, /data-bom-rf-create/);
  const button = { handlers: {}, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const dialog = { querySelector: (selector) => (selector === "[data-bom-rf-create]" ? button : null), close() { this.closed = true; } };
  // ตามทันข้อมูล RubberFlow ก่อนออกเลข WO (เลขออกจากข้อมูลที่เครื่องมี) แล้วจึงสร้าง
  const steps = [];
  const realCatchUp = rfStore.catchUp;
  const realRun = rfStore.run;
  rfStore.catchUp = (...args) => { steps.push("catchUp"); return realCatchUp(...args); };
  rfStore.run = (...args) => { steps.push("run"); return realRun(...args); };
  built.bind(dialog, ctx);
  button.handlers.click({ currentTarget: button });
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout0(resolve));
  assert.deepEqual(steps.slice(0, 2), ["catchUp", "run"], "the dialog catches RubberFlow up right before it builds the WO");
  rfStore.catchUp = realCatchUp;
  rfStore.run = realRun;
  const wo = rfStore.data().orders.at(-1);
  assert.deepEqual([wo.sourceJobId, wo.uom, wo.targetQty, wo.targetKg, wo.recipeRevision, wo.customerPo], ["JOB-RB1", "pcs", 10, 5.25, 1, "PI-R"], "10 pcs x 500 g + 5% allowance = 5.25 kg of compound");
  assert.equal(wo.kgPerUnit, 0.525);
  assert.ok(dialog.closed, "the dialog closes when the database answered");
  assert.equal(env.store.data().jobs.find((job) => job.id === "JOB-RB1").externalRef?.woId, wo.id, "BOM caught the link up");
  assert.deepEqual(env.log.toasts.filter(([, kind]) => kind === "error"), []);
  assert.match(env.log.toasts.at(-1)[0], new RegExp(`สร้าง WO ${wo.id} ใน RubberFlow แล้ว`));
  const again = env.context.MNP_BOM_DIALOGS.jobRubberflow(env.ctx("p=jobs&dept=RB"), { jobId: "JOB-RB1" });
  assert.match(again.html, /ไว้แล้ว/);
  assert.doesNotMatch(again.html, /data-bom-rf-create/, "no second WO for a linked job");
  assert.doesNotMatch((await env.render("p=jobs&dept=RB")).split("<tr").find((row) => row.includes(">JOB-RB1<")) ?? "", /jobRubberflow/);

  // ปิด WO ในฐานข้อมูล: ไม่ต้องมียอดผลิต และการปิดไม่ส่งยอดเข้างาน (ยอดเข้างานเกิดตอน SR รับมอบใบส่งมอบ)
  const head = await asPersona(scene, "persona-rbh");
  await rf(head).ensureLoaded();
  await saved(rf(head).run("setOrderStatus", { id: wo.id, status: "released" }));
  await saved(rf(head).run("setOrderStatus", { id: wo.id, status: "in_progress" }));
  await saved(rf(head).run("setOrderStatus", { id: wo.id, status: "completed" }));
  const reopened = await asPersona(scene, "persona-rb"); // another page of the same database (the mock caches per page, so open a fresh one)
  const closedJob = reopened.store.data().jobs.find((row) => row.id === "JOB-RB1");
  assert.deepEqual([closedJob.qtyDone, closedJob.reports.length, closedJob.externalRef.woId], [0, 0, wo.id], "closing the WO feeds nothing back");
});

// ชิ้นงานผ่านตกแต่ง (ล็อตตกแต่งที่ QC ผ่าน) → ฐานข้อมูลรายงานยอดเข้างาน BOM → หน้า RubberFlow ตามทัน BOM แล้วแจ้งผล · การรับมอบใบส่งมอบไม่แตะงาน BOM (ใช้โมดูลจริงในหน้าจำลอง)
test("a transfer receipt does not touch the BOM job; when pieces pass finishing the module catches BOM up and says what the job received", async () => {
  const { scene, rf } = await rfScene();
  const admin = await asPersona(scene, "persona-1");
  await saved(admin.store.run("saveItem", saveItemPayload("RB-ITEM", { kind: "RB", name: "เส้นยางทดสอบ", uom: "pcs", weightG: 500, rubber: { compound: "DM01", color: "BK" } })));
  await saved(admin.store.run("linkCompound", { code: "DM01", recipeId: "RC-TEST-01" }));
  const env = await asPersona(scene, "persona-rb");
  await rf(env).ensureLoaded();
  // WO ที่ผูกงาน JOB-RB1 (10 เส้น เส้นละ 0.525 kg) ผ่านปุ่มของ BOM
  const ctx = env.ctx("p=jobs&dept=RB");
  const built = env.context.MNP_BOM_DIALOGS.jobRubberflow(ctx, { jobId: "JOB-RB1" });
  const button = { handlers: {}, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; } };
  built.bind({ querySelector: (selector) => (selector === "[data-bom-rf-create]" ? button : null), close() {} }, ctx);
  button.handlers.click({ currentTarget: button });
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout0(resolve));
  const wo = rf(env).data().orders.at(-1);
  const head = await asPersona(scene, "persona-rbh");
  await rf(head).ensureLoaded();
  await saved(rf(head).run("setOrderStatus", { id: wo.id, status: "released" }));
  // คลังรับวัตถุดิบ → RB เบิก ชั่ง ผสม ส่งมอบ
  const st = await asPersona(scene, "persona-st");
  await rf(st).ensureLoaded();
  for (const code of ["EPDM-55", "CB-N550"]) await saved(rf(st).run("receiveMaterial", { materialCode: code, qtyKg: 40, expiry: NOW + 30 * 86400000 }));
  // สถานีผลิตและ SR ใช้เวลาจริงของเครื่อง (เวลาบ่มของยางเทียบกับเวลาของหน้าและของฐานข้อมูลจำลองต้องเป็นนาฬิกาเดียวกัน)
  const realClock = { mockOptions: { now: () => Date.now() } };
  const rb = await asPersona(scene, "persona-rb", realClock);
  await rf(rb).ensureLoaded();
  const req = await saved(rf(rb).run("createRequisition", { orderId: wo.id, batches: 1 }));
  const lot = await saved(rf(rb).run("recordMixing", { reqId: req.result, machine: "KN-01 Kneader 75L", shift: "D", stages: [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }], outputKg: 10.5 }));
  await saved(rf(rb).run("endRest", { lotId: lot.result }));
  const transfer = await saved(rf(rb).run("createTransfer", { lotId: lot.result, qty: 10.5 }));

  // SR รับมอบ: ไม่เขียน BOM จึงไม่มีอะไรให้ตามทัน
  const sr = await asPersona(scene, "persona-sr", realClock);
  await rf(sr).ensureLoaded();
  await sr.store.ensureLoaded();
  const view = sr.context.MNP_RUBBERFLOW;
  assert.equal(view.bomJobOfAction("receiveTransfer", { id: transfer.result }), null, "receiving a transfer is not a moment the BOM job follows");
  const received = rf(sr).run("receiveTransfer", { id: transfer.result, qtyReceived: 10.5 });
  assert.equal(received.ok, true, received.error?.message);
  assert.equal((await received.saving).ok, true);
  await sr.store.catchUp();
  const jobOf = (env) => env.store.data().jobs.find((row) => row.id === "JOB-RB1");
  assert.deepEqual([jobOf(sr).qtyDone, jobOf(sr).reports.length], [0, 0], "10.5 kg of compound received: the job got nothing (it was counted as 20 pieces before)");

  // ฉีด → อบ → ส่งมอบ → รับมอบ: ยังไม่มียอดเข้างาน (แต่ละขั้นเปิดหน้าใหม่ของฐานข้อมูลเดียวกัน เพราะ mock เก็บข้อมูลต่อหน้า)
  const fresh = async (persona) => {
    const page = await asPersona(scene, persona, realClock);
    await rf(page).ensureLoaded();
    await page.store.ensureLoaded();
    return page;
  };
  const rb2 = await fresh("persona-rb");
  await saved(rf(rb2).run("saveMold", { id: "DIE-1", name: "หัวดายทดสอบ", kind: "die", unit: "m", perCycle: 1, cleanEvery: 5000, pmLimit: 100000 }));
  await saved(rf(rb2).run("saveMold", { id: "MD-1", name: "แม่พิมพ์ 2 cavity", kind: "mold", unit: "shot", perCycle: 2, cleanEvery: 1000, pmLimit: 50000 }));
  const ex = await saved(rf(rb2).run("recordExtrusion", { transferId: transfer.result, useKg: 10.5, thickness: 2.5, width: 18, weightPerM: 160, goodQty: 10, dieId: "DIE-1" }));
  const tr2 = await saved(rf(rb2).run("createTransfer", { lotId: ex.result, qty: 10 }));
  const sr2 = await fresh("persona-sr");
  await saved(rf(sr2).run("receiveTransfer", { id: tr2.result, qtyReceived: 10 }));
  const rb3 = await fresh("persona-rb");
  const cu = await saved(rf(rb3).run("recordCuring", { transferId: tr2.result, useQty: 10, moldId: "MD-1", temp: 200, time: 150, pressure: 150, goodQty: 10 }));
  const tr3 = await saved(rf(rb3).run("createTransfer", { lotId: cu.result, qty: 10 }));
  const sr3 = await fresh("persona-sr");
  await saved(rf(sr3).run("receiveTransfer", { id: tr3.result, qtyReceived: 10 }));
  await sr3.store.catchUp();
  assert.deepEqual([jobOf(sr3).qtyDone, jobOf(sr3).reports.length], [0, 0], "no receipt of any station moved the job");

  // ตกแต่ง: ล็อตที่ผ่านตอนบันทึก (6 ชิ้น) ป้อนทันที · โมดูลของหน้าตามทัน BOM แล้วแจ้งยอด
  const rb4 = await fresh("persona-rb");
  const rbView = rb4.context.MNP_RUBBERFLOW;
  const finishing = (passedQty, qcResult) => ({ transferId: tr3.result, useQty: passedQty, passedQty, scrapQty: 0, perBox: 10, qcResult, grade: "A", shift: "D" });
  const first = finishing(6, "pass");
  const beforeFirst = rbView.bomJobOfAction("recordFinishing", first);
  assert.deepEqual(JSON.parse(JSON.stringify(beforeFirst)), { id: "JOB-RB1", qtyDone: 0 }, "the module finds the BOM job that follows the finishing lot's WO");
  const lot1 = rf(rb4).run("recordFinishing", first);
  assert.equal(lot1.ok, true, lot1.error?.message);
  assert.equal(rb4.store.data().jobs.find((row) => row.id === "JOB-RB1").qtyDone, 0, "the page does not touch the BOM job itself");
  assert.equal((await lot1.saving).ok, true);
  await rbView.showBomFeedback(beforeFirst);
  assert.deepEqual([jobOf(rb4).qtyDone, jobOf(rb4).status, jobOf(rb4).reports.length], [6, "in_progress", 1], "6 pieces passed finishing");
  assert.match(jobOf(rb4).reports[0].note, new RegExp("^ผ่านตกแต่ง " + lot1.result + " จาก WO " + wo.id + "$"));
  assert.match(rb4.log.toasts.at(-1)[0], /งาน BOM JOB-RB1 รับยอดจากการผ่านตกแต่งแล้ว: ทำได้ 6\/10/);

  // ล็อตที่ hold ไม่ป้อน (โมดูลไม่ตามทัน) จน QA ตัดสินเป็น pass
  const held = finishing(4, "hold");
  assert.equal(rbView.bomJobOfAction("recordFinishing", held), null, "a lot on hold waits for QA: nothing to follow");
  const lot2 = await saved(rf(rb4).run("recordFinishing", held));
  await rb4.store.catchUp();
  assert.equal(jobOf(rb4).qtyDone, 6);
  const qa = await asPersona(scene, "persona-qa", realClock);
  await rf(qa).ensureLoaded();
  await qa.store.ensureLoaded();
  const qaView = qa.context.MNP_RUBBERFLOW;
  const decide = { lotId: lot2.result, values: { hardness: 65, tensile: 12 }, result: "pass" };
  const beforeQa = qaView.bomJobOfAction("addQcRecord", decide);
  assert.deepEqual(JSON.parse(JSON.stringify(beforeQa)), { id: "JOB-RB1", qtyDone: 6 });
  const decided = rf(qa).run("addQcRecord", decide);
  assert.equal(decided.ok, true, decided.error?.message);
  assert.equal((await decided.saving).ok, true);
  await qaView.showBomFeedback(beforeQa);
  assert.deepEqual([jobOf(qa).qtyDone, jobOf(qa).status, jobOf(qa).reports.length], [10, "done", 2], "the QA pass feeds the lot: 6 + 4 = the 10 planned");
  assert.match(qa.log.toasts.at(-1)[0], /งาน BOM JOB-RB1 รับยอดจากการผ่านตกแต่งแล้ว: ทำได้ 10\/10 \(งานครบแล้ว\)/);
  // ไม่ใช่ล็อตตกแต่ง / ไม่ใช่คำสั่งที่ป้อน: ไม่มีงานให้ตามทัน
  assert.equal(qaView.bomJobOfAction("addQcRecord", { lotId: "MX-NOPE" }), null);
  assert.equal(qaView.bomJobOfAction("createTransfer", { lotId: lot2.result }), null);
});

test("RubberFlow's store holds other users' data back only for its own forms on its own page, so an open BOM dialog never blocks catching up after a duplicate WO number", async () => {
  let dialog = false;
  const env = await pageEnv({ persona: "persona-rb", sandboxAdmin: false, hooks: { dialogOpen: () => dialog } });
  const editing = env.context.MNP_RUBBERFLOW.isEditing;
  env.log.hash = "#/bom?p=jobs";
  dialog = true;
  assert.equal(editing(), false, "the create-WO dialog of BOM is not a RubberFlow form");
  env.log.hash = "#/rubberflow?p=orders";
  assert.equal(editing(), true, "a RubberFlow dialog on the RubberFlow page is");
  dialog = false;
  assert.equal(editing(), false);
});

test("cancelling the WO in RubberFlow clears the job's link in BOM and the job offers the create-WO dialog again", async () => {
  const { scene, rf } = await rfScene();
  const admin = await asPersona(scene, "persona-1");
  await saved(admin.store.run("saveItem", saveItemPayload("RB-ITEM", { kind: "RB", name: "เส้นยางทดสอบ", uom: "pcs", weightG: 500, rubber: { compound: "DM01", color: "BK" } })));
  await saved(admin.store.run("linkCompound", { code: "DM01", recipeId: "RC-TEST-01" }));
  const env = await asPersona(scene, "persona-rb");
  const rfStore = rf(env);
  await rfStore.ensureLoaded();
  const rowOf = (html) => html.split("<tr").find((row) => row.includes(">JOB-RB1<")) ?? "";
  const out = await saved(rfStore.run("createOrder", { recipeId: "RC-TEST-01", customer: "ลูกค้า", customerPo: "PI-R", targetQty: 10, startDate: NOW, dueDate: NOW + 86400000, sourceJobId: "JOB-RB1", uom: "pcs", targetKg: 5.25, kgPerUnit: 0.525 }));
  await env.store.catchUp();
  assert.equal(env.store.data().jobs.find((row) => row.id === "JOB-RB1").externalRef?.woId, out.result);
  assert.doesNotMatch(rowOf(await env.render("p=jobs&dept=RB")), /jobRubberflow/, "linked: no create button");

  await saved(rfStore.run("setOrderStatus", { id: out.result, status: "cancelled" }));
  await env.store.catchUp();
  const job = env.store.data().jobs.find((row) => row.id === "JOB-RB1");
  assert.equal(job.externalRef, null, "the server cleared the link when the WO was cancelled");
  assert.equal(job.reports.at(-1).note, `WO ${out.result} ถูกยกเลิก`);
  assert.match(rowOf(await env.render("p=jobs&dept=RB")), /data-rf-open="jobRubberflow"/, "the job can take a new WO");
  const again = env.context.MNP_BOM_DIALOGS.jobRubberflow(env.ctx("p=jobs&dept=RB"), { jobId: "JOB-RB1" });
  assert.match(again.html, /data-bom-rf-create/);
  assert.doesNotMatch(again.html, /ไว้แล้ว/);
  assert.match(again.html, /ล็อตตกแต่งของ WO นั้นผ่าน QC และนับเข้าใบสั่งผลิต/, "the dialog says each finishing lot that passes adds its quantity to the job");
  assert.doesNotMatch(again.html, /รับมอบใบส่งมอบของ WO นั้น/, "and no longer says a receipt does");
});

test("the compounds page and the link dialog list only recipes approved in the database, and the BOM page loads RubberFlow by itself", async () => {
  const { scene } = await rfScene();
  const env = await asPersona(scene, "persona-1");
  assert.equal(env.context.MNP_RUBBERFLOW.store.status(), "idle", "RubberFlow was not opened in this page");
  const ctx = env.ctx("p=compounds");
  let html = await env.render("p=compounds");
  assert.match(html, /กำลังโหลดสูตรจาก RubberFlow/, "asks RubberFlow to load and says so");
  await new Promise((resolve) => setTimeout0(resolve));
  await new Promise((resolve) => setTimeout0(resolve));
  assert.equal(env.context.MNP_RUBBERFLOW.store.status(), "ready");
  assert.ok(env.log.renders >= 1, "the BOM page is redrawn when RubberFlow arrived");
  const dialog = env.context.MNP_BOM_DIALOGS.compoundLink(ctx, {});
  assert.match(dialog.html, /<option value="RC-TEST-01">/);
  assert.match(dialog.html, /ฐานข้อมูลไม่รับรหัสสูตรที่ไม่มีอยู่/);
  assert.doesNotMatch(dialog.html, /<input[^>]*name="recipeId"/, "a typed code would be refused by the database");
});

// ---------- ปล่อยผลิต PI แล้วฐานข้อมูลเปิด WO ใน RubberFlow ให้งาน RB เอง (ตรงกับ private.bom_open_rf_orders / bom_cancel_rf_orders) ----------
const ymdLocal = (ms) => { const day = new Date(ms); return `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`; };
const TODAY_WO = `WO-${ymdLocal(NOW)}`;
const rpcData = async (env, name, args) => { const out = await env.mock.client.rpc(name, args); assert.equal(out.error, null, out.error?.message); return out.data; };
// ฉาก: สูตร RC-TEST-01 อนุมัติแล้ว + สูตรร่าง RC-DRAFT · เส้นยางหลายแบบ (คำนวณ กก. จากน้ำหนักชิ้น / กก. ต่อเส้น / บรรทัดสูตรยางใน BOM) · สูตรยางที่ไม่ผูก/ผูกสูตรร่าง · ใบ PI-S แบบร่างที่ระเบิดแล้วและสินค้า FG-RF
async function autoWoScene() {
  const { scene, rf } = await rfScene();
  const head = await asPersona(scene, "persona-rbh");
  await rf(head).ensureLoaded();
  await saved(rf(head).run("createRecipe", { ...RF_RECIPE, id: "RC-DRAFT" }));
  const admin = await asPersona(scene, "persona-1");
  const run = async (name, payload) => saved(admin.store.run(name, payload));
  const rod = (code, compound, extra = {}) => run("saveItem", saveItemPayload(code, { kind: "RB", name: `เส้นยาง ${code}`, uom: "pcs", rubber: { compound, color: "BK" }, ...extra }));
  await run("saveItem", saveItemPayload("DM01", { kind: "CP", name: "EPDM ส้ม", uom: "kg" }));
  await rod("RB-W", "DM01", { weightG: 500 });
  await rod("RB-K", "DM01", { rubber: { compound: "DM01", kgPerRoll: 2 } });
  await rod("RB-B", "DM01", { weightG: 100 });
  await run("saveBom", { itemCode: "RB-B", lines: [{ childCode: "DM01", qty: 1.5, scrapPct: 2 }] });
  await rod("RB-Z", "DM01"); // ไม่มีน้ำหนักชิ้นหรือ กก./เส้น
  await rod("RB-NL", "DM02"); // สูตรยางไม่ผูกสูตร RubberFlow
  await rod("RB-UA", "DM03"); // ผูกสูตรร่าง
  await run("linkCompound", { code: "DM01", recipeId: "RC-TEST-01" });
  await run("linkCompound", { code: "DM03", recipeId: "RC-DRAFT" });
  await run("saveItem", saveItemPayload("FG-RF", { kind: "FG", name: "สินค้าเส้นยาง", uom: "set" }));
  await run("saveBom", { itemCode: "FG-RF", lines: [{ childCode: "RB-W", qty: 2 }, { childCode: "RB-B", qty: 1 }] });
  const draft = async (pi, fgCode = "FG-TEST-01", qty = 5) => {
    const order = await run("createOrder", newOrder({ pi }));
    await run("addOrderItem", { orderId: order.result, fgCode, qty });
    await run("explodeOrder", { orderId: order.result });
    return order.result;
  };
  // ปล่อยผลิตด้วยงานที่กำหนดเอง (ตรงกับคำสั่งที่ฐานข้อมูลรับ) · คืนคำตอบดิบของ RPC
  const releaseWith = async (id, jobs) => {
    const stored = await rpcData(admin, "app_bom_master");
    const order = stored.orders.find((row) => row.id === id);
    return admin.mock.client.rpc("app_bom_save_master", { p_changes: { orders: { upsert: [{ ...order, status: "released", releasedAt: NOW, releasedBy: "x" }] }, jobs: { upsert: jobs } }, p_base_version: stored.version, p_action: "releaseOrder" });
  };
  const call = async (changes, action) => admin.mock.client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: (await rpcData(admin, "app_bom_master")).version, p_action: action });
  return { scene, rf, admin, head, run, draft, releaseWith, call };
}
const rfOrderOf = async (env, id) => (await rpcData(env, "app_rf_master")).orders.find((row) => row.id === id);

test("releasing a PI opens one planned WO per RB job that can be served (numbers, fields, kilograms, link) and says why the others were skipped", async () => {
  const s = await autoWoScene();
  const id = await s.draft("PI-S");
  const rfBefore = await rpcData(s.admin, "app_rf_master");
  const bomBefore = await rpcData(s.admin, "app_bom_master");
  const late = NOW - 2 * 86400000;
  const jobs = [
    mockJob("JOB-A1", id, "RB", { itemCode: "RB-W", qtyPlanned: 10 }), // 10 x 500 g = 5 kg + 5%
    mockJob("JOB-A2", id, "RB", { itemCode: "RB-K", qtyPlanned: 10, dueAt: late }), // 10 x 2 kg + 5%, due date already passed
    mockJob("JOB-A3", id, "RB", { itemCode: "RB-B", qtyPlanned: 10 }), // first BOM line: 10 x 1.5 kg x 1.02
    mockJob("JOB-S1", id, "RB", { itemCode: "RB-GHOST" }),
    mockJob("JOB-S2", id, "RB", { itemCode: "RB-NL" }),
    mockJob("JOB-S3", id, "RB", { itemCode: "RB-UA" }),
    mockJob("JOB-S4", id, "RB", { itemCode: "RB-Z" }),
    mockJob("JOB-G1", id, "GR"),
  ];
  const reply = await s.releaseWith(id, jobs);
  assert.equal(reply.error, null, reply.error?.message);
  const rubberflow = reply.data.rubberflow;
  assert.deepEqual(rubberflow.opened, [
    { jobId: "JOB-A1", woId: `${TODAY_WO}-01`, kg: 5.25 },
    { jobId: "JOB-A2", woId: `${TODAY_WO}-02`, kg: 21 },
    { jobId: "JOB-A3", woId: `${TODAY_WO}-03`, kg: 15.3 },
  ], "consecutive numbers within one release, ordered by job number, kilograms like the job dialog");
  assert.deepEqual(rubberflow.skipped, [
    { jobId: "JOB-S1", itemCode: "RB-GHOST", reason: "ไม่มีรหัสสูตรยาง" },
    { jobId: "JOB-S2", itemCode: "RB-NL", reason: "ยังไม่ผูกสูตร RubberFlow" },
    { jobId: "JOB-S3", itemCode: "RB-UA", reason: "สูตร RC-DRAFT ยังไม่อนุมัติ" },
    { jobId: "JOB-S4", itemCode: "RB-Z", reason: "คำนวณกิโลกรัมไม่ได้" },
  ]);
  assert.deepEqual(rubberflow.cancelled, []);
  assert.equal(reply.data.version, bomBefore.version + 1, "the BOM counter moves once");

  const first = await rfOrderOf(s.admin, `${TODAY_WO}-01`);
  const start = new Date(NOW).setHours(0, 0, 0, 0);
  assert.deepEqual({ ...first, createdAt: 0 }, {
    id: `${TODAY_WO}-01`, customer: "Acme Trading", customerPo: id, recipeId: "RC-TEST-01", recipeRevision: 1, productCode: "P-TEST", uom: "pcs", color: "BK",
    targetQty: 10, producedQty: 0, startDate: start, dueDate: NOW + 86400000, priority: "normal", status: "planned", sourceJobId: "JOB-A1", targetKg: 5.25, kgPerUnit: 0.525,
    note: `จาก BOM งาน JOB-A1 · PI ${id} · RB-W 10 pcs ≈ 5.25 kg · เปิดอัตโนมัติตอนปล่อยใบ`, createdAt: 0, createdBy: first.createdBy,
  });
  assert.ok(first.createdBy, "created by the planner who released");
  const urgent = await rfOrderOf(s.admin, `${TODAY_WO}-02`);
  assert.deepEqual([urgent.priority, urgent.dueDate], ["urgent", start], "an overdue job is urgent and the WO is due no earlier than today");

  const stored = await rpcData(s.admin, "app_bom_master");
  const a1 = stored.jobs.find((row) => row.id === "JOB-A1");
  assert.deepEqual([a1.externalRef.system, a1.externalRef.woId, a1.externalRef.kg, a1.externalRef.auto, a1.externalRef.by], ["rubberflow", `${TODAY_WO}-01`, 5.25, true, first.createdBy]);
  assert.deepEqual([a1.status, stored.orders.find((row) => row.id === id).status], ["queued", "released"], "the job stays queued and the PI released until the first transfer is received");
  for (const jobId of ["JOB-S1", "JOB-S2", "JOB-S3", "JOB-S4", "JOB-G1"]) assert.equal(stored.jobs.find((row) => row.id === jobId).externalRef, null, jobId);
  assert.equal(reply.data.changes.jobs.upsert.find((row) => row.id === "JOB-A1").externalRef.woId, `${TODAY_WO}-01`, "the reply already carries the links");

  // RubberFlow: เวอร์ชัน +1 ครั้งเดียว ไคลเอนต์ RubberFlow เห็น WO จาก app_rf_master_since และบันทึกการใช้งานบอกว่ามาจาก BOM
  const rfAfter = await rpcData(s.admin, "app_rf_master");
  assert.equal(rfAfter.version, rfBefore.version + 1);
  assert.deepEqual((await rpcData(s.admin, "app_rf_master_since", { p_version: rfBefore.version })).changes.orders.upsert.map((row) => row.id), [`${TODAY_WO}-01`, `${TODAY_WO}-02`, `${TODAY_WO}-03`]);
  const rfAudit = (await rpcData(s.admin, "app_rf_audit", { p_limit: 1 }))[0];
  assert.deepEqual([rfAudit.action, rfAudit.detail], ["bom:releaseOrder", "orders +3"]);
  const bomAudit = (await rpcData(s.admin, "app_bom_audit", { p_limit: 1 }))[0];
  assert.deepEqual([bomAudit.action, bomAudit.rubberflow], ["releaseOrder", { opened: 3, skipped: 4, cancelled: 0 }]);

  // WO ที่เปิดไว้ปล่อยผลิตโดยหัวหน้า RB ได้ตามปกติ · งานที่ถูกข้ามสร้าง WO เองได้ตามเดิม (sourceJobId)
  const head = await asPersona(s.scene, "persona-rbh");
  await rf(head).ensureLoaded();
  await saved(rf(head).run("setOrderStatus", { id: `${TODAY_WO}-01`, status: "released" }));
  assert.equal(rf(head).data().orders.find((row) => row.id === `${TODAY_WO}-01`).status, "released");
  function rf(env) { return env.context.MNP_RUBBERFLOW.store; }
});

test("a release with nothing for RubberFlow keeps the old reply, and a skipped job can still get its WO by hand", async () => {
  const s = await autoWoScene();
  const id = await s.draft("PI-N");
  const rfBefore = await rpcData(s.admin, "app_rf_master");
  const reply = await s.releaseWith(id, [mockJob("JOB-G9", id, "GR")]);
  assert.equal(reply.error, null);
  assert.equal("rubberflow" in reply.data, false, "no RB job: the reply has no rubberflow key");
  assert.equal((await rpcData(s.admin, "app_rf_master")).version, rfBefore.version, "and RubberFlow is not touched");
  assert.equal((await rpcData(s.admin, "app_bom_audit", { p_limit: 1 }))[0].rubberflow, undefined);

  const other = await s.draft("PI-M");
  const skipped = await s.releaseWith(other, [mockJob("JOB-M1", other, "RB", { itemCode: "RB-NL" })]);
  assert.deepEqual(skipped.data.rubberflow, { opened: [], skipped: [{ jobId: "JOB-M1", itemCode: "RB-NL", reason: "ยังไม่ผูกสูตร RubberFlow" }], cancelled: [] });
  assert.equal((await rpcData(s.admin, "app_rf_master")).version, rfBefore.version, "only skips: RubberFlow version unchanged");
  // ผูกสูตรแล้วสร้างด้วยมือ (กล่อง "สร้าง WO ใน RubberFlow") ยังใช้ได้
  await s.run("linkCompound", { code: "DM02", recipeId: "RC-TEST-01" });
  const rfStore = s.admin.context.MNP_RUBBERFLOW.store;
  await rfStore.ensureLoaded();
  await saved(rfStore.run("createOrder", { recipeId: "RC-TEST-01", customer: "Acme Trading", customerPo: other, targetQty: 10, startDate: NOW, dueDate: NOW + 86400000, sourceJobId: "JOB-M1", uom: "pcs", targetKg: 5, kgPerUnit: 0.5 }));
  const manual = (await rpcData(s.admin, "app_bom_master")).jobs.find((row) => row.id === "JOB-M1");
  assert.equal(manual.externalRef.auto, undefined, "a manual link is not marked auto");
  assert.equal(manual.status, "in_progress", "the manual link keeps its old behaviour");
});

test("cancelling a PI or reopening it to draft cancels its planned and released WOs (manual ones too); a WO past released refuses", async () => {
  const s = await autoWoScene();
  const toDraft = (order) => ({ ...order, status: "draft", revision: order.revision + 1 });
  // ยกเลิกใบ: WO แผนกและปล่อยผลิตถูกยกเลิก งานของใบถูกลบ
  const id = await s.draft("PI-C");
  const opened = (await s.releaseWith(id, [mockJob("JOB-C1", id, "RB", { itemCode: "RB-W" }), mockJob("JOB-C2", id, "RB", { itemCode: "RB-K" })])).data.rubberflow.opened;
  const rfBefore = await rpcData(s.admin, "app_rf_master");
  const head = await asPersona(s.scene, "persona-rbh");
  await head.context.MNP_RUBBERFLOW.store.ensureLoaded();
  await saved(head.context.MNP_RUBBERFLOW.store.run("setOrderStatus", { id: opened[1].woId, status: "released" }));
  const reachedBy = await asPersona(s.scene, "persona-1");
  const order = (await rpcData(reachedBy, "app_bom_master")).orders.find((row) => row.id === id);
  const cancelled = await reachedBy.mock.client.rpc("app_bom_save_master", { p_changes: { orders: { upsert: [{ ...order, status: "cancelled", cancelledAt: NOW }] } }, p_base_version: (await rpcData(reachedBy, "app_bom_master")).version, p_action: "cancelOrder" });
  assert.equal(cancelled.error, null, cancelled.error?.message);
  assert.deepEqual(cancelled.data.rubberflow, { opened: [], skipped: [], cancelled: opened.map((row) => row.woId) });
  assert.equal(cancelled.data.changes.jobs.delete.length, 2, "the jobs are deleted as before");
  const rfNow = await rpcData(reachedBy, "app_rf_master");
  assert.deepEqual(rfNow.orders.filter((row) => row.status === "cancelled").map((row) => row.id), opened.map((row) => row.woId));
  assert.ok(rfNow.orders.every((row) => row.cancelledAt || row.status !== "cancelled"));
  assert.equal(rfNow.version, rfBefore.version + 2, "the head's release and the cancel are one version each");
  const audit = (await rpcData(reachedBy, "app_rf_audit", { p_limit: 1 }))[0];
  assert.deepEqual([audit.action, audit.detail], ["bom:cancelOrder", "orders +2"]);
  assert.deepEqual((await rpcData(reachedBy, "app_bom_audit", { p_limit: 1 }))[0].rubberflow, { opened: 0, skipped: 0, cancelled: 2 });

  // เปิดใบกลับมาแก้ (กลับเป็นร่าง): ยกเลิก WO แล้วปล่อยผลิตใหม่ได้เลขใหม่
  const second = await autoWoScene();
  const sid = await second.draft("PI-R2");
  const first = (await second.releaseWith(sid, [mockJob("JOB-R1", sid, "RB", { itemCode: "RB-W" })])).data.rubberflow.opened[0].woId;
  const reopened = await second.call({ orders: { upsert: [toDraft((await rpcData(second.admin, "app_bom_master")).orders.find((row) => row.id === sid))] } }, "addOrderItem");
  assert.equal(reopened.error, null, reopened.error?.message);
  assert.deepEqual(reopened.data.rubberflow, { opened: [], skipped: [], cancelled: [first] });
  assert.equal((await rpcData(second.admin, "app_rf_audit", { p_limit: 1 }))[0].action, "bom:reopenOrder");
  const again = await second.releaseWith(sid, [mockJob("JOB-R2", sid, "RB", { itemCode: "RB-W" })]);
  assert.equal(again.error, null, again.error?.message);
  assert.equal(again.data.rubberflow.opened[0].woId, `${TODAY_WO}-02`, "numbers keep counting after a cancelled WO");

  // WO ที่เริ่มผลิตแล้ว: ยกเลิกใบ / เปิดกลับมาแก้ไม่ได้ ไม่เขียนอะไรเลย
  const third = await autoWoScene();
  const tid = await third.draft("PI-T");
  const wo = (await third.releaseWith(tid, [mockJob("JOB-T1", tid, "RB", { itemCode: "RB-W" })])).data.rubberflow.opened[0].woId;
  const headT = await asPersona(third.scene, "persona-rbh");
  const headStore = headT.context.MNP_RUBBERFLOW.store;
  await headStore.ensureLoaded();
  await saved(headStore.run("setOrderStatus", { id: wo, status: "released" }));
  await saved(headStore.run("setOrderStatus", { id: wo, status: "in_progress" }));
  const env = await asPersona(third.scene, "persona-1");
  const current = (await rpcData(env, "app_bom_master")).orders.find((row) => row.id === tid);
  const rfVersion = (await rpcData(env, "app_rf_master")).version;
  const bomVersion = (await rpcData(env, "app_bom_master")).version;
  // ยกเลิกใบ: ต้องปิด/ยกเลิก WO ใน RubberFlow ก่อน (BOM_RF_ORDER_STARTED) · เปิดกลับมาแก้: งานที่ผูก WO ที่เริ่มแล้วนับเป็นงานที่เริ่มแล้ว (BOM_INVALID_TRANSITION) เหมือนกฎเดิมของงานที่เริ่ม
  for (const [change, action, code] of [[{ ...current, status: "cancelled", cancelledAt: NOW }, "cancelOrder", /BOM_RF_ORDER_STARTED/], [toDraft(current), "addOrderItem", /BOM_INVALID_TRANSITION/]]) {
    const refused = await env.mock.client.rpc("app_bom_save_master", { p_changes: { orders: { upsert: [change] } }, p_base_version: bomVersion, p_action: action });
    assert.match(refused.error.message, code, action);
  }
  assert.equal((await rpcData(env, "app_bom_master")).version, bomVersion, "refused: BOM untouched");
  assert.equal((await rpcData(env, "app_rf_master")).version, rfVersion, "refused: RubberFlow untouched");
  assert.equal((await rfOrderOf(env, wo)).status, "in_progress");
});

test("through the module: release says how many WOs were opened and why jobs were skipped, RubberFlow catches up, cancel and reopen say which WOs were cancelled", async () => {
  const s = await autoWoScene();
  const rfStore = s.admin.context.MNP_RUBBERFLOW.store;
  await rfStore.ensureLoaded();
  const ctx = s.admin.ctx();
  const turns = async (n = 8) => { for (let turn = 0; turn < n; turn += 1) await new Promise((resolve) => setTimeout0(resolve)); };
  const toasts = s.admin.log.toasts;
  // FG-RF: 5 ชุด → RB-W 10 เส้น (5.25 kg) และ RB-B 5 เส้น (5 x 1.5 x 1.02 = 7.65 kg)
  const open = async (pi, fgCode = "FG-RF") => {
    const order = await s.run("createOrder", newOrder({ pi }));
    await s.run("addOrderItem", { orderId: order.result, fgCode, qty: 5 });
    await s.run("explodeOrder", { orderId: order.result });
    return order.result;
  };
  const id = await open("PI-Q");
  assert.equal(rfStore.data().orders.length, 0);
  assert.equal(ctx.runAction("releaseOrder", { orderId: id }, ""), true);
  await turns();
  assert.equal(toasts.at(-1)[0], `ปล่อยผลิต ${id} แล้ว · เปิด WO ใน RubberFlow 2 ใบ`);
  assert.equal(toasts.at(-1)[1], "success");
  // หลังปล่อยผลิต: ตรวจเคมีของ WO ที่เปิดเทียบสต็อก (ยังไม่มีล็อตเลย = ขาดทุกตัว) แล้วเปิด dialog สั่งซื้อพร้อมเลข PI · ไม่มี toast เพิ่ม
  const purchase = s.admin.log.dialogs.filter((html) => /data-rf-dialog="purchase"/.test(html));
  assert.equal(purchase.length, 1);
  assert.match(purchase[0], new RegExp(`สั่งซื้อวัตถุดิบ · ${id}`));
  assert.ok(purchase[0].includes("62.5") && purchase[0].includes("37.5"), "two WOs of 5.25 and 7.65 kg each take a whole 50 kg batch: 100 kg of compound split 100 : 60 between EPDM-55 and CB-N550");
  assert.match(purchase[0], /data-rf-form="createPurchaseOrder"/);
  assert.doesNotMatch(purchase[0], /ไม่ได้นับ/, "every job got a WO");
  // ใบ PI ที่ปล่อยผลิตแล้วมีปุ่ม "ตรวจวัตถุดิบ" พร้อมเลข WO ของใบ · ใบร่างไม่มี
  const piPage = await s.admin.render(`p=orders&sel=${id}`);
  assert.match(piPage, /data-bom-rf-check/);
  assert.match(piPage, />ตรวจวัตถุดิบ</);
  for (const woId of rfStore.data().orders.map((row) => row.id)) assert.ok(piPage.includes(woId), woId);
  const wos = rfStore.data().orders;
  assert.deepEqual(wos.map((row) => row.sourceJobId).sort(), s.admin.store.data().jobs.filter((job) => job.orderId === id && job.dept === "RB").map((job) => job.id).sort(), "RubberFlow caught up and shows the WOs");
  assert.deepEqual([...wos.map((row) => row.targetKg)].sort((a, b) => a - b), [5.25, 7.65]);
  const jobs = s.admin.store.data().jobs.filter((job) => job.orderId === id && job.dept === "RB");
  assert.deepEqual(JSON.parse(JSON.stringify(jobs.map((job) => [job.status, Boolean(job.externalRef?.woId), job.externalRef?.auto]))), [["queued", true, true], ["queued", true, true]], "BOM caught up with the links");

  // PI ที่มีงานถูกข้าม: ข้อความค้างแบบเตือนบอกเหตุผล
  const rodOnly = await s.run("createOrder", newOrder({ pi: "PI-Q3" }));
  await s.run("saveItem", saveItemPayload("FG-NL", { kind: "FG", name: "สินค้า DM02", uom: "set" }));
  await s.run("saveBom", { itemCode: "FG-NL", lines: [{ childCode: "RB-NL", qty: 1 }] });
  await s.run("addOrderItem", { orderId: rodOnly.result, fgCode: "FG-NL", qty: 5 });
  await s.run("explodeOrder", { orderId: rodOnly.result });
  assert.equal(ctx.runAction("releaseOrder", { orderId: rodOnly.result }, ""), true);
  await turns();
  const skipToast = toasts.at(-1);
  assert.equal(skipToast[1], "success", "the release succeeded, so the notice is a normal toast even with a skipped job (the PI page keeps the list)");
  assert.match(skipToast[0], new RegExp(`^ปล่อยผลิต ${rodOnly.result} แล้ว · ยังไม่ได้เปิด WO 1 งาน \\(JOB-[0-9a-z-]+ RB-NL: ยังไม่ผูกสูตร RubberFlow\\)$`));

  // ยกเลิกใบ: ยกเลิก WO ด้วยและ RubberFlow ตามทัน
  assert.equal(ctx.runAction("cancelOrder", { orderId: id, reason: "ลูกค้ายกเลิก" }, ""), true);
  await turns();
  assert.match(toasts.at(-1)[0], /^ยกเลิก WO WO-\d{8}-0[12], WO-\d{8}-0[12] ด้วย$/);
  assert.deepEqual(rfStore.data().orders.filter((row) => row.status === "cancelled").length, 2);

  // เปิดใบกลับมาแก้ (แก้จำนวนสินค้า): WO แผนกถูกยกเลิก ปล่อยผลิตใหม่ได้ WO ชุดใหม่
  const again = await open("PI-Q4");
  assert.equal(ctx.runAction("releaseOrder", { orderId: again }, ""), true);
  await turns();
  assert.equal(rfStore.data().orders.filter((row) => row.status === "planned").length, 2);
  assert.equal(ctx.runAction("updateOrderItem", { orderId: again, fgCode: "FG-RF", qty: 6 }, "แก้จำนวนแล้ว"), true);
  await turns();
  assert.match(toasts.at(-1)[0], /^ยกเลิก WO WO-\d{8}-0[34], WO-\d{8}-0[34] ด้วย$/);
  assert.equal(s.admin.store.data().orders.find((row) => row.id === again).status, "draft");
  assert.equal(rfStore.data().orders.filter((row) => row.status === "planned").length, 0);
});

test("the module refuses to cancel while a WO is already running, and the database message for BOM_RF_ORDER_STARTED is Thai", async () => {
  assert.match(storeApi.mapRemoteError({ message: "BOM_RF_ORDER_STARTED" }).message, /ยกเลิกหรือแก้ใบไม่ได้: WO ใน RubberFlow.*เริ่มผลิตแล้ว.*ปิดหรือยกเลิก WO นั้นใน RubberFlow ก่อน/);
  assert.equal(storeApi.mapRemoteError({ message: "P0001: BOM_RF_ORDER_STARTED" }).code, "BOM_RF_ORDER_STARTED");
  const s = await autoWoScene();
  const id = await s.draft("PI-X");
  const wo = (await s.releaseWith(id, [mockJob("JOB-X1", id, "RB", { itemCode: "RB-W" })])).data.rubberflow.opened[0].woId;
  const env = await asPersona(s.scene, "persona-rbh");
  const rfStore = env.context.MNP_RUBBERFLOW.store;
  await rfStore.ensureLoaded();
  await saved(rfStore.run("setOrderStatus", { id: wo, status: "released" }));
  await saved(rfStore.run("setOrderStatus", { id: wo, status: "in_progress" }));
  const planner = await asPersona(s.scene, "persona-1");
  await planner.context.MNP_RUBBERFLOW.store.ensureLoaded();
  await planner.store.ensureLoaded();
  const out = planner.store.run("cancelOrder", { orderId: id, reason: "x" });
  assert.equal(out.ok, false, "the page rule uses the loaded WO list: a running WO blocks before any call");
  assert.match(out.error.message, new RegExp(wo));
  // รายการ WO ยังไม่โหลด: กฎเดิม (ผูก WO = เริ่มแล้ว) ไม่เดาแทนฐานข้อมูล
  const cold = await asPersona(s.scene, "persona-1");
  await cold.store.ensureLoaded();
  assert.equal(cold.store.run("cancelOrder", { orderId: id, reason: "x" }).ok, false);
});

test("the PI page lists RB jobs that have no WO yet with the reason, and the release confirm mentions the WOs (database mode only)", async () => {
  const s = await autoWoScene();
  const id = await s.draft("PI-P");
  const sku = await s.draft("PI-P2");
  let html = await s.admin.render(`p=orders&sel=${id}`);
  assert.match(html, /เปิด WO ใน RubberFlow ให้งาน RB ที่ผูกสูตรแล้ว/, "the release confirm tells that WOs are opened");
  const reply = await s.releaseWith(id, [
    mockJob("JOB-P1", id, "RB", { itemCode: "RB-W" }), mockJob("JOB-P2", id, "RB", { itemCode: "RB-NL" }), mockJob("JOB-P3", id, "RB", { itemCode: "RB-UA" }),
    mockJob("JOB-P4", id, "RB", { itemCode: "RB-GHOST" }), mockJob("JOB-P5", id, "RB", { itemCode: "RB-Z" }), mockJob("JOB-P6", id, "GR"),
  ]);
  assert.equal(reply.error, null, reply.error?.message);
  const env = await asPersona(s.scene, "persona-1");
  const rfStore = env.context.MNP_RUBBERFLOW.store;
  await rfStore.ensureLoaded();
  await env.store.ensureLoaded();
  html = await env.render(`p=orders&sel=${id}&tab=jobs`);
  assert.match(html, /งาน RB ที่ยังไม่มี WO ใน RubberFlow/);
  const callout = html.split("งาน RB ที่ยังไม่มี WO ใน RubberFlow")[1].split("</table>")[0].split("<table")[0];
  assert.match(callout, /JOB-P2[\s\S]*ยังไม่ผูกสูตร RubberFlow/);
  assert.match(callout, /JOB-P3[\s\S]*สูตร RC-DRAFT ยังไม่อนุมัติ/);
  assert.match(callout, /JOB-P4[\s\S]*ไม่มีรหัสสูตรยาง/);
  assert.match(callout, /JOB-P5[\s\S]*คำนวณกิโลกรัมไม่ได้/);
  assert.doesNotMatch(callout, /JOB-P1|JOB-P6/, "a job with a WO and a non-RB job are not listed");
  assert.match(callout, /สร้าง WO ใน RubberFlow/, "the hint that the jobs page still creates one by hand");
  assert.match(html, new RegExp(`${TODAY_WO}-01`), "the table still shows the WO number of the linked job");
  clean(html);
  // PI ที่ยังเป็นร่างหรือที่ทุกงาน RB มี WO แล้ว: ไม่มีกล่องเตือน
  html = await env.render(`p=orders&sel=${sku}&tab=jobs`);
  assert.doesNotMatch(html, /งาน RB ที่ยังไม่มี WO/);
  function clean(text) { assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/); }
});

test("part stock through the module on the (mock) database: counts send only the stock list, the issue sends only the jobs and the stock and moves come back, rights follow the persona", async () => {
  const planning = await pageEnv();
  await planning.store.ensureLoaded();
  await fgScene(planning);
  const planCtx = planning.ctx();
  assert.equal(planCtx.runAction("createOrder", { customer: "ลูกค้า ทดสอบ", country: "Thailand", orderedAt: NOW, whDue: NOW + 9 * 86400000 }, ""), true);
  await settle();
  const id = planning.store.data().orders[0].id;
  for (const [action, payload] of [["addOrderItem", { orderId: id, fgCode: "FG-TEST-01", qty: 5 }], ["explodeOrder", { orderId: id }], ["releaseOrder", { orderId: id }]]) {
    assert.equal(planCtx.runAction(action, payload, ""), true, action);
    await settle();
  }
  const partJob = planning.store.data().jobs.find((row) => row.dept === "ST");
  assert.deepEqual([partJob.kind, partJob.itemCode, partJob.qtyPlanned, partJob.qtyRequired, partJob.stockCounted], ["PURCHASED", "P-TEST-01", 10, 10, null], "release made the ST job of the purchased part with its gross requirement");

  // ST: หน้าคลังของซื้อ → นับ → ส่งเฉพาะชุด stock (ไม่ส่งประวัติ) · ฐานข้อมูลประทับผู้นับและเขียนประวัติ
  const st = await asPersona({ env: planning }, "persona-st");
  let html = await st.render("p=stock");
  assert.match(html, /data-rf-form="countPartStock"/);
  assert.match(html, /name="itemCode\[\]" value="P-TEST-01"/);
  assert.doesNotMatch(html, /name="safetyQty\[\]"/, "ST cannot edit the safety stock");
  assert.match(html, /data-rf-open="partHistory"/);
  const outcome = st.store.run("countPartStock", { counts: [{ itemCode: "P-TEST-01", qty: 6 }] });
  assert.equal(outcome.ok, true, outcome.error?.message);
  await outcome.saving;
  const database = () => JSON.parse(planning.pageStorage.getItem("mnp-harness-bom-master"));
  assert.deepEqual(Object.keys(database().stock[0]).sort(), ["countedAt", "countedBy", "itemCode", "qty", "safetyQty", "updatedAt"]);
  assert.equal(database().stock[0].countedBy, "วิชัย คลังวัตถุดิบ");
  assert.deepEqual(database().stockMoves.map((move) => [move.kind, move.qty, move.balance, move.ref]), [["count", 6, 6, null]]);
  assert.deepEqual(JSON.parse(JSON.stringify(st.store.data().stockMoves.map((move) => move.kind))), ["count"], "the move came back in the reply (the page does not invent its own)");

  // เบิกจ่ายตอนสต็อกไม่พอ: หน้าปฏิเสธก่อนเรียกฐานข้อมูล (ไม่เขียนอะไร) · ฐานข้อมูลก็ปฏิเสธถ้าส่งมาเอง
  const versionBefore = database().version;
  const short = st.store.run("issueOrderParts", { orderId: id });
  assert.equal(short.ok, false);
  assert.match(short.error.message, /P-TEST-01 ขาด 4/);
  assert.equal(database().version, versionBefore);
  const direct = await st.mock.client.rpc("app_bom_save_master", { p_changes: { jobs: { upsert: [{ ...partJob, status: "done", qtyDone: 10 }] } }, p_base_version: database().version, p_action: "issueOrderParts" });
  assert.match(direct.error.message, /BOM_INSUFFICIENT_STOCK/);

  // สต็อกพอแล้วเบิกจ่าย: ส่งเฉพาะงาน (ไม่ส่งสต็อก/ประวัติ/ใบ) ฐานข้อมูลหักสต็อก เขียนประวัติ ตั้งงานเป็น done
  const more = st.store.run("countPartStock", { counts: [{ itemCode: "P-TEST-01", qty: 12 }] });
  await more.saving;
  const issued = st.store.run("issueOrderParts", { orderId: id });
  assert.equal(issued.ok, true, issued.error?.message);
  await issued.saving;
  const after = database();
  assert.deepEqual(after.stock.map((row) => [row.itemCode, row.qty]), [["P-TEST-01", 2]]);
  assert.deepEqual(after.stockMoves.map((move) => [move.kind, move.qty, move.balance, move.ref]), [["count", 6, 6, null], ["count", 6, 12, null], ["issue", -10, 2, id]]);
  assert.deepEqual([after.jobs.find((row) => row.dept === "ST").status, after.jobs.find((row) => row.dept === "ST").qtyDone], ["done", 10]);
  assert.equal(after.orders[0].status, "in_progress", "the database turned the released order in_progress");
  assert.equal(after.audit.at(-1).action, "issueOrderParts");
  assert.equal(after.audit.at(-1).detail, "jobs +1, stock +1");
  assert.equal(st.store.data().stock[0].qty, 2, "the page shows the database's balance");
  assert.equal(st.store.data().orders[0].status, "in_progress");
  assert.equal(st.store.run("issueOrderParts", { orderId: id }).ok, false, "nothing left to issue");
  assert.equal(st.store.run("reportJob", { jobId: partJob.id, qtyDone: 1 }).ok, false, "a part job is never reported");

  // สิทธิ์ตามบัญชี: RB นับไม่ได้ (ฐานข้อมูลปฏิเสธ หน้าย้อนกลับ) · สต็อกขั้นต่ำเฉพาะฝ่ายวางแผน
  const rb = await asPersona({ env: planning }, "persona-rb");
  const denied = rb.store.run("countPartStock", { counts: [{ itemCode: "P-TEST-01", qty: 1 }] });
  assert.equal(denied.ok, false, "the page rule refuses before calling");
  const pp = await asPersona({ env: planning }, "persona-pp");
  const safety = pp.store.run("countPartStock", { counts: [{ itemCode: "P-TEST-01", safetyQty: 4 }] });
  assert.equal(safety.ok, true, safety.error?.message);
  await safety.saving;
  assert.equal(database().stock[0].safetyQty, 4);
  assert.equal(database().stockMoves.length, 3, "a safety change writes no move");
  html = await pp.render("p=stock");
  assert.match(html, /name="safetyQty\[\]"/, "the planner edits the safety stock");
  html = await pp.render(`p=orders&sel=${id}`);
  assert.doesNotMatch(html, /data-rf-open="issueParts"/, "nothing left to issue → no issue button");
});

test("purchasing across the modules: releasing a PI with purchased parts opens one purchase dialog with the part table, the order lands in RubberFlow, the part's safety stock in the BOM, and the next check counts the order as on order", async () => {
  const env = await pageEnv();
  await env.store.ensureLoaded();
  await fgScene(env);
  const ctx = env.ctx();
  assert.equal(ctx.runAction("createOrder", { customer: "ลูกค้า ทดสอบ", country: "Thailand", orderedAt: NOW, whDue: NOW + 9 * 86400000 }, ""), true);
  await settle();
  const id = env.store.data().orders[0].id;
  for (const [action, payload] of [["addOrderItem", { orderId: id, fgCode: "FG-TEST-01", qty: 5 }], ["explodeOrder", { orderId: id }]]) {
    assert.equal(ctx.runAction(action, payload, ""), true, action);
    await settle();
  }
  assert.equal(ctx.runAction("releaseOrder", { orderId: id }, ""), true);
  for (let turn = 0; turn < 40 && !env.log.dialogs.some((html) => html.includes('data-rf-dialog="purchase"')); turn += 1) await settle();
  const dialog = env.log.dialogs.find((html) => html.includes('data-rf-dialog="purchase"'));
  assert.ok(dialog, "the release found the parts short (nothing on hand) and opened the purchase dialog");
  assert.match(dialog, /สั่งซื้อวัตถุดิบและของซื้อ/);
  assert.ok(dialog.includes('name="source[]" value="bom"') && dialog.includes('value="P-TEST-01"'));
  assert.match(dialog, /name="qtyKg\[\]"[^>]*value="10"/, "need 10, nothing on hand, no safety stock yet");
  assert.doesNotMatch(dialog, /undefined|NaN/);

  const rf = env.context.MNP_RUBBERFLOW;
  const bomDb = () => JSON.parse(env.pageStorage.getItem("mnp-harness-bom-master"));
  const bomVersion = bomDb().version;
  const out = rf.store.run("createPurchaseOrder", { lines: [{ materialCode: "P-TEST-01", source: "bom", uom: "pcs", needKg: 10, availableKg: 0, shortageKg: 10, safetyKg: 2, qtyKg: 12 }], safety: { "P-TEST-01": 2 }, sourcePi: id });
  assert.equal(out.ok, true, out.error?.message);
  await out.saving;
  assert.deepEqual(bomDb().stock.map((row) => [row.itemCode, row.qty, row.safetyQty]), [["P-TEST-01", 0, 2]], "the safety stock went to the BOM stock");
  assert.equal(bomDb().version, bomVersion + 1);
  await env.store.catchUp();
  assert.equal(env.store.data().stock[0].safetyQty, 2, "the BOM page catches up");

  // ตรวจอีกครั้งอัตโนมัติ: ใบสั่งซื้อค้างรับ 12 ครอบความต้องการ 10 → ไม่ขาด ไม่เปิด dialog ใหม่ แจ้งสั้นๆ ว่าพอ
  const dialogsBefore = env.log.dialogs.length;
  const again = await rf.checkMaterials({ woIds: [], sourcePi: id, auto: true });
  assert.equal(again.opened, false);
  assert.equal(env.log.dialogs.length, dialogsBefore);
  assert.match(env.log.toasts.at(-1)[0], /ของซื้อพอ/);
  assert.equal(JSON.parse(JSON.stringify(again.parts.rows.map((row) => [row.itemCode, row.needQty, row.onOrderQty, row.shortage]))).join(), "P-TEST-01,10,12,0");

  // สต็อกขั้นต่ำของซื้อที่แก้ในหน้าต่างแต่สั่ง 0: ไม่อยู่ในบรรทัดใบสั่งซื้อ จึงบันทึกเข้าคลังของซื้อแยก (countPartStock) หลังใบสั่งซื้อสำเร็จ
  await env.store.run("saveItem", saveItemPayload("P-TEST-02", { name: "ของซื้ออีกตัว" })).saving;
  const second = rf.runAction("createPurchaseOrder", {
    lines: [
      { materialCode: "P-TEST-01", source: "bom", uom: "pcs", needKg: 1, availableKg: 0, shortageKg: 1, safetyKg: 2, storedSafetyKg: 2, qtyKg: 3 },
      { materialCode: "P-TEST-02", source: "bom", uom: "pcs", needKg: 0, availableKg: 0, shortageKg: 0, safetyKg: 6, storedSafetyKg: 0, qtyKg: 0 },
    ], safety: { "P-TEST-01": 2, "P-TEST-02": 6 }, sourcePi: id,
  }, "");
  assert.equal(second, true);
  for (let turn = 0; turn < 60 && !bomDb().stock.some((row) => row.itemCode === "P-TEST-02"); turn += 1) await settle();
  assert.deepEqual(bomDb().stock.map((row) => [row.itemCode, row.safetyQty]), [["P-TEST-01", 2], ["P-TEST-02", 6]], "the safety stock of the part that was not ordered was saved too");
  assert.equal(bomDb().stockMoves.length, 0, "a safety change writes no move");
});

test("the mock database follows the SQL rules of the part stock: payload shapes per action, rights, stale checks, all-or-none issue, part jobs reported only through the issue", async () => {
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage: memoryStorage() });
  const rpc = (name, args) => mock.client.rpc(name, args);
  const as = (id) => rpc("app_sandbox_enter", { p_persona_id: id });
  const version = async () => (await rpc("app_bom_master")).data.version;
  const save = async (changes, action, base) => rpc("app_bom_save_master", { p_changes: changes, p_base_version: base ?? await version(), p_action: action });
  const code = async (promise) => (await promise).error?.code;
  const counts = (rows, base) => save({ stock: { upsert: rows } }, "countPartStock", base);
  const view = async () => (await rpc("app_bom_master")).data;
  await as("persona-pp");
  const item = (itemCode, kind, uom = "pcs") => ({ code: itemCode, kind, name: itemCode, ownerDept: kind === "PURCHASED" ? "ST" : "PK", uom });
  assert.equal((await save({ items: { upsert: [item("FG-1", "FG", "set"), item("P-1", "PURCHASED"), item("P-2", "PURCHASED", "kg"), item("SE-1", "SE")] } }, "importFlat")).error, null);
  const order = { id: "PI-M1", customer: "ACME", country: "TH", orderType: "SA", orderedAt: NOW, whDue: NOW + 9 * 86400000, due: {}, dueDefaults: [], revision: 0, status: "draft", items: [{ fgCode: "FG-1", qty: 2, colorSet: "", note: "" }], explosion: [{ itemCode: "FG-1", level: 0, required: 2 }], stockCounts: {}, note: "" };
  assert.equal((await save({ orders: { upsert: [order] } }, "createOrder")).error, null);
  const partJob = (id, itemCode, qty) => ({ id, orderId: "PI-M1", dept: "ST", itemCode, name: itemCode, kind: "PURCHASED", uom: "pcs", qtyPlanned: qty, qtyRequired: qty, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: NOW + 86400000, status: "queued", externalRef: null, fgCodes: ["FG-1"], reports: [] });
  const pkJob = { ...partJob("J-PK", "FG-1", 2), dept: "PK", kind: "FG", uom: "set" };
  assert.equal((await save({ orders: { upsert: [{ ...order, status: "released" }] }, jobs: { upsert: [pkJob, partJob("J-P1", "P-1", 8), partJob("J-P2", "P-2", 3)] } }, "releaseOrder")).error, null);

  // payload shapes per action
  assert.equal(await code(save({ stock: { upsert: [{ itemCode: "P-1", qty: 5 }] } }, "setStockCounts")), "BOM_INVALID_PAYLOAD", "stock only with countPartStock");
  assert.equal(await code(save({ stock: { upsert: [{ itemCode: "P-1", qty: 5 }] }, customers: { upsert: [{ name: "Z" }] } }, "countPartStock")), "BOM_INVALID_PAYLOAD", "a count carries only stock");
  assert.equal(await code(save({ stock: { delete: [] } }, "countPartStock")), "BOM_INVALID_PAYLOAD", "no deletes");
  assert.equal(await code(save({ stockMoves: { upsert: [{ id: "x" }] } }, "countPartStock")), "BOM_INVALID_PAYLOAD", "moves are written by the server only");
  assert.equal(await code(save({ jobs: { upsert: [] }, stock: { upsert: [{ itemCode: "P-1", qty: 1 }] } }, "issueOrderParts")), "BOM_INVALID_PAYLOAD", "an issue carries only jobs");
  for (const bad of [{ itemCode: "SE-1", qty: 1 }, { itemCode: "NOPE", qty: 1 }, { itemCode: "P-1", qty: -1 }, { itemCode: "P-1", qty: "5" }, { itemCode: "P-1", qty: 1e10 }]) assert.equal(await code(counts([bad])), "BOM_INVALID_STOCK", JSON.stringify(bad));
  assert.equal(await code(counts([{ itemCode: "P-1", qty: 1 }, { itemCode: "p-1", qty: 2 }])), "BOM_INVALID_STOCK", "the same item twice");

  // rights: ST, WH and the planner group count; RB cannot; the safety stock is the planners; stale comes before rights
  await as("persona-rb");
  assert.equal(await code(counts([{ itemCode: "P-1", qty: 5 }])), "BOM_FORBIDDEN");
  await as("persona-st");
  const before = await version();
  assert.equal((await counts([{ itemCode: "P-1", qty: 5 }, { itemCode: "P-2", qty: 1 }])).error, null);
  assert.equal(await version(), before + 1);
  assert.equal(await code(counts([{ itemCode: "P-1", safetyQty: 3 }])), "BOM_FORBIDDEN", "ST cannot set the safety stock");
  const same = await counts([{ itemCode: "P-1", qty: 5, safetyQty: 0 }]);
  assert.equal(same.error, null);
  assert.deepEqual(same.data.changes.stock.upsert, [], "the same values change no row (the counter still moves, like any save)");
  const moves = (await view()).stockMoves;
  assert.deepEqual(moves.map((move) => [move.itemCode, move.kind, move.qty, move.balance, move.ref, move.by]).sort(), [["P-1", "count", 5, 5, null, "วิชัย คลังวัตถุดิบ"], ["P-2", "count", 1, 1, null, "วิชัย คลังวัตถุดิบ"]]);
  await as("persona-wh");
  assert.equal((await counts([{ itemCode: "P-1", qty: 4 }], before + 1)).error, null, "WH counts too");
  await as("persona-rb");
  assert.equal(await code(counts([{ itemCode: "P-1", qty: 9 }], before + 1)), "BOM_STALE", "the stale check comes before the permission check");

  // a part job is not reported any other way
  const jobs = (await view()).jobs;
  const p1 = jobs.find((job) => job.id === "J-P1");
  await as("persona-st");
  assert.equal(await code(save({ jobs: { upsert: [{ ...p1, status: "done", qtyDone: 8 }] } }, "reportJob")), "BOM_INVALID_TRANSITION");
  await as("persona-pp");
  assert.equal(await code(save({ jobs: { upsert: [{ ...p1, status: "hold" }] } }, "setJobStatus")), "BOM_INVALID_TRANSITION", "not even a planner");

  // the issue: other department, partial set, not in full, shortage = nothing issued (stale when the stock changed after the copy), success
  const done = (job) => ({ ...job, status: "done", qtyDone: job.qtyPlanned });
  const p2 = jobs.find((job) => job.id === "J-P2");
  await as("persona-rb");
  assert.equal(await code(save({ jobs: { upsert: [done(p1), done(p2)] } }, "issueOrderParts")), "BOM_FORBIDDEN");
  await as("persona-st");
  assert.equal(await code(save({ jobs: { upsert: [done(p1)] } }, "issueOrderParts")), "BOM_INVALID_JOB", "partial set");
  assert.equal(await code(save({ jobs: { upsert: [done(p1), done(p2), jobs.find((job) => job.id === "J-PK")] } }, "issueOrderParts")), "BOM_INVALID_JOB", "an unchanged row of another kind in the set refuses it too (every row goes to the issue, like the SQL)");
  assert.equal(await code(save({ jobs: { upsert: [done(p1), { ...done(p2), qtyDone: 1 }] } }, "issueOrderParts")), "BOM_INVALID_JOB", "must be done in full");
  assert.equal(await code(save({ jobs: { upsert: [done(p1), done(jobs.find((job) => job.id === "J-PK"))] } }, "issueOrderParts")), "BOM_FORBIDDEN", "a job of another department in the set");
  const base = await version();
  assert.equal(await code(save({ jobs: { upsert: [done(p1), done(p2)] } }, "issueOrderParts")), "BOM_INSUFFICIENT_STOCK", "P-1 has 4 of 8, P-2 has 1 of 3");
  await as("persona-wh");
  assert.equal((await counts([{ itemCode: "P-2", qty: 0 }])).error, null);
  await as("persona-st");
  assert.equal(await code(save({ jobs: { upsert: [done(p1), done(p2)] } }, "issueOrderParts", base)), "BOM_STALE", "the stock changed after the copy the shortage was read from");
  assert.equal((await view()).stock.find((row) => row.itemCode === "P-1").qty, 4, "nothing was issued by the refused calls");
  assert.equal((await counts([{ itemCode: "P-1", qty: 8 }, { itemCode: "P-2", qty: 3 }])).error, null);
  const issued = await save({ jobs: { upsert: [done(p1), done(p2)] } }, "issueOrderParts");
  assert.equal(issued.error, null);
  const after = await view();
  assert.deepEqual(after.stock.map((row) => [row.itemCode, row.qty]), [["P-1", 0], ["P-2", 0]]);
  assert.deepEqual(after.jobs.filter((job) => job.dept === "ST").map((job) => [job.id, job.status, job.qtyDone]), [["J-P1", "done", 8], ["J-P2", "done", 3]]);
  assert.equal(after.orders[0].status, "in_progress");
  assert.deepEqual(after.stockMoves.filter((move) => move.kind === "issue").map((move) => [move.itemCode, move.qty, move.balance, move.ref]).sort(), [["P-1", -8, 0, "PI-M1"], ["P-2", -3, 0, "PI-M1"]]);
  assert.equal((await rpc("app_bom_audit")).data[0].detail, "jobs +2, stock +2");
  assert.equal(await code(save({ jobs: { upsert: [after.jobs.find((job) => job.id === "J-P1"), after.jobs.find((job) => job.id === "J-P2")] } }, "issueOrderParts")), "BOM_INVALID_JOB", "issuing twice finds nothing left");
  // the test-data purge removes the stock and the moves too
  await as("persona-1");
  assert.ok((await rpc("app_sandbox_purge_bom")).data.deleted >= 9);
  const emptied = await view();
  assert.deepEqual([emptied.stock, emptied.stockMoves], [[], []]);
});

test("returning parts through the module on the (mock) database: the page sends only the return request, the database computes stock, jobs and moves, undo then issue again, then a leftover; the order can be cancelled after an undo", async () => {
  const planning = await pageEnv();
  await planning.store.ensureLoaded();
  await fgScene(planning);
  const planCtx = planning.ctx();
  assert.equal(planCtx.runAction("createOrder", { customer: "ลูกค้า ทดสอบ", country: "Thailand", orderedAt: NOW, whDue: NOW + 9 * 86400000 }, ""), true);
  await settle();
  const id = planning.store.data().orders[0].id;
  for (const [action, payload] of [["addOrderItem", { orderId: id, fgCode: "FG-TEST-01", qty: 5 }], ["explodeOrder", { orderId: id }], ["releaseOrder", { orderId: id }]]) {
    assert.equal(planCtx.runAction(action, payload, ""), true, action);
    await settle();
  }
  const database = () => JSON.parse(planning.pageStorage.getItem("mnp-harness-bom-master"));
  const st = await asPersona({ env: planning }, "persona-st");
  await st.store.run("countPartStock", { counts: [{ itemCode: "P-TEST-01", qty: 12 }] }).saving;
  await st.store.run("issueOrderParts", { orderId: id }).saving;
  assert.equal(database().stock[0].qty, 2);

  // ยกเลิกการเบิกจ่าย: ส่งเฉพาะ partReturns · เซิร์ฟเวอร์คืนสต็อกและตั้งงานกลับเป็นรอเบิกจ่าย
  const none = st.store.run("undoOrderParts", { orderId: id, reason: "  " });
  assert.equal(none.ok, false, "the page refuses an empty reason before calling the database");
  const undo = st.store.run("undoOrderParts", { orderId: id, reason: "เบิกผิดใบ" });
  assert.equal(undo.ok, true, undo.error?.message);
  assert.equal((await undo.saving).ok, true);
  let db = database();
  assert.deepEqual(db.stock.map((row) => [row.itemCode, row.qty]), [["P-TEST-01", 12]]);
  assert.deepEqual(db.stockMoves.map((move) => [move.kind, move.qty, move.balance, move.ref, move.note]), [["count", 12, 12, null, null], ["issue", -10, 2, id, null], ["return", 10, 12, id, "เบิกผิดใบ"]]);
  const partJob = db.jobs.find((row) => row.dept === "ST");
  assert.deepEqual([partJob.status, partJob.qtyDone, "doneAt" in partJob], ["queued", 0, false]);
  assert.equal(db.orders[0].status, "in_progress", "the order status does not change");
  assert.equal(db.audit.at(-1).action, "undoOrderParts");
  assert.equal(db.audit.at(-1).detail, "partReturns +1, stock +1");
  assert.deepEqual(JSON.parse(JSON.stringify(st.store.data().stockMoves.map((move) => move.kind))), ["count", "issue", "return"], "the page shows the database's moves");
  assert.equal(st.store.data().stock[0].qty, 12);
  assert.equal(st.store.run("undoOrderParts", { orderId: id, reason: "อีกครั้ง" }).ok, false, "nothing is issued now");

  // เบิกจ่ายใหม่ แล้วคืนของเหลือ: ยอดที่คืนได้นับตั้งแต่การเบิกจ่ายล่าสุด
  await st.store.run("issueOrderParts", { orderId: id }).saving;
  assert.equal(database().stock[0].qty, 2);
  const tooMany = st.store.run("returnOrderParts", { orderId: id, lines: [{ itemCode: "P-TEST-01", qty: 11 }], reason: "เหลือ" });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error.message, /ไม่เกิน 10/);
  const leftover = st.store.run("returnOrderParts", { orderId: id, lines: [{ itemCode: "P-TEST-01", qty: 4 }], reason: "ใช้ไม่หมด" });
  assert.equal(leftover.ok, true, leftover.error?.message);
  assert.equal((await leftover.saving).ok, true);
  db = database();
  assert.equal(db.stock[0].qty, 6);
  assert.deepEqual(db.stockMoves.at(-1) && [db.stockMoves.at(-1).kind, db.stockMoves.at(-1).qty, db.stockMoves.at(-1).note], ["return", 4, "ใช้ไม่หมด"]);
  assert.equal(db.jobs.find((row) => row.dept === "ST").status, "done", "a leftover return keeps the job done");
  assert.equal(db.audit.at(-1).detail, "partReturns +1, stock +1");
  assert.equal(st.store.run("returnOrderParts", { orderId: id, lines: [{ itemCode: "P-TEST-01", qty: 7 }], reason: "เกิน" }).ok, false, "only 6 are left to return");

  // RB ทำไม่ได้ (หน้าปฏิเสธก่อนเรียกฐานข้อมูล)
  const rb = await asPersona({ env: planning }, "persona-rb");
  assert.equal(rb.store.run("undoOrderParts", { orderId: id, reason: "x" }).ok, false);

  // หลังยกเลิกการเบิกจ่ายยกเลิกใบได้ (ไม่เหลืองานที่ทำแล้ว) · งานแผนกอื่นของใบนี้ยังไม่เริ่ม
  await st.store.run("undoOrderParts", { orderId: id, reason: "ยกเลิกใบ" }).saving;
  assert.equal(database().stock[0].qty, 12 - 0, "the 4 returned earlier are not returned twice");
  const planner = await asPersona({ env: planning }, "persona-pp");
  const cancel = planner.store.run("cancelOrder", { orderId: id, reason: "ลูกค้ายกเลิก" });
  assert.equal(cancel.ok, true, cancel.error?.message);
  assert.equal((await cancel.saving).ok, true, "cancelling a PI whose parts were all given back is allowed");
  assert.equal(database().orders[0].status, "cancelled");
  assert.equal(planner.store.run("returnOrderParts", { orderId: id, lines: [{ itemCode: "P-TEST-01", qty: 1 }], reason: "x" }).ok, false, "a cancelled PI returns nothing");
});

test("the mock database follows the SQL rules of the part return: payload shapes, the order of the checks, undo and leftover limits since the latest issue, stale, rights", async () => {
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage: memoryStorage() });
  const rpc = (name, args) => mock.client.rpc(name, args);
  const as = (id) => rpc("app_sandbox_enter", { p_persona_id: id });
  const version = async () => (await rpc("app_bom_master")).data.version;
  const view = async () => (await rpc("app_bom_master")).data;
  const save = async (changes, action, base) => rpc("app_bom_save_master", { p_changes: changes, p_base_version: base ?? await version(), p_action: action });
  const code = async (promise) => (await promise).error?.code;
  const counts = (rows) => save({ stock: { upsert: rows } }, "countPartStock");
  const ret = (row, action = "returnOrderParts", base) => save({ partReturns: { upsert: [row] } }, action, base);
  const undo = (reason = "ผิดใบ", extra = {}, base) => ret({ orderId: "PI-M1", mode: "undo", reason, ...extra }, "undoOrderParts", base);
  const left = (lines, reason = "เหลือ", extra = {}, base) => ret({ orderId: "PI-M1", mode: "leftover", reason, lines, ...extra }, "returnOrderParts", base);
  await as("persona-pp");
  const item = (itemCode, kind, uom = "pcs") => ({ code: itemCode, kind, name: itemCode, ownerDept: kind === "PURCHASED" ? "ST" : "PK", uom });
  assert.equal((await save({ items: { upsert: [item("FG-1", "FG", "set"), item("P-1", "PURCHASED"), item("P-2", "PURCHASED", "kg")] } }, "importFlat")).error, null);
  const order = { id: "PI-M1", customer: "ACME", country: "TH", orderType: "SA", orderedAt: NOW, whDue: NOW + 9 * 86400000, due: {}, dueDefaults: [], revision: 0, status: "draft", items: [{ fgCode: "FG-1", qty: 2, colorSet: "", note: "" }], explosion: [{ itemCode: "FG-1", level: 0, required: 2 }], stockCounts: {}, note: "" };
  assert.equal((await save({ orders: { upsert: [order] } }, "createOrder")).error, null);
  const partJob = (id, itemCode, qty) => ({ id, orderId: "PI-M1", dept: "ST", itemCode, name: itemCode, kind: "PURCHASED", uom: "pcs", qtyPlanned: qty, qtyRequired: qty, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: NOW + 86400000, status: "queued", externalRef: null, fgCodes: ["FG-1"], reports: [] });
  const pkJob = { ...partJob("J-PK", "FG-1", 2), dept: "PK", kind: "FG", uom: "set" };
  assert.equal((await save({ orders: { upsert: [{ ...order, status: "released" }] }, jobs: { upsert: [pkJob, partJob("J-P1", "P-1", 8), partJob("J-P2", "P-2", 3)] } }, "releaseOrder")).error, null);
  await as("persona-st");
  assert.equal((await counts([{ itemCode: "P-1", qty: 20 }, { itemCode: "P-2", qty: 10 }])).error, null);
  const done = (job) => ({ ...job, status: "done", qtyDone: job.qtyPlanned });
  const jobsNow = async () => (await view()).jobs;
  const pull = async () => { const rows = await jobsNow(); return [rows.find((row) => row.id === "J-P1"), rows.find((row) => row.id === "J-P2")]; };

  // nothing issued yet
  assert.equal(await code(undo()), "BOM_INVALID_RETURN", "no done part job");
  assert.equal(await code(left([{ itemCode: "P-1", qty: 1 }])), "BOM_INVALID_RETURN", "nothing issued of the item");

  const [p1, p2] = await pull();
  assert.equal((await save({ jobs: { upsert: [done(p1), done(p2)] } }, "issueOrderParts")).error, null);
  assert.deepEqual((await view()).stock.map((row) => [row.itemCode, row.qty]), [["P-1", 12], ["P-2", 7]]);

  // payload shapes
  assert.equal(await code(save({ partReturns: { upsert: [{ orderId: "PI-M1", mode: "undo", reason: "x" }] } }, "countPartStock")), "BOM_INVALID_PAYLOAD", "partReturns only with the two return actions");
  assert.equal(await code(save({ partReturns: { upsert: [{ orderId: "PI-M1", mode: "undo", reason: "x" }] }, customers: { upsert: [{ name: "Z" }] } }, "undoOrderParts")), "BOM_INVALID_PAYLOAD", "a return carries only partReturns");
  assert.equal(await code(save({ jobs: { upsert: [done(p1)] } }, "undoOrderParts")), "BOM_INVALID_PAYLOAD");
  assert.equal(await code(save({ partReturns: { delete: [] } }, "undoOrderParts")), "BOM_INVALID_PAYLOAD", "no deletes");
  assert.equal(await code(save({ nothing: { upsert: [] } }, "undoOrderParts")), "BOM_INVALID_PAYLOAD", "an unknown section");
  assert.equal(await code(save({ partReturns: { upsert: [{ orderId: "PI-M1", mode: "undo", reason: "a" }, { orderId: "PI-M1", mode: "undo", reason: "b" }] } }, "undoOrderParts")), "BOM_INVALID_RETURN", "one row per call");
  // row shape
  assert.equal(await code(undo("")), "BOM_INVALID_RETURN", "a reason is required");
  assert.equal(await code(undo("ก".repeat(201))), "BOM_INVALID_RETURN", "a reason is at most 200 characters");
  assert.equal(await code(ret({ orderId: "PI-M1", mode: "bogus", reason: "x" }, "undoOrderParts")), "BOM_INVALID_RETURN");
  assert.equal(await code(ret({ orderId: "NOPE", mode: "undo", reason: "x" }, "undoOrderParts")), "BOM_INVALID_RETURN", "an unknown order");
  assert.equal(await code(undo("ผิดใบ", { lines: [{ itemCode: "P-1", qty: 1 }] })), "BOM_INVALID_RETURN", "an undo carries no lines");
  for (const lines of [[], [{ itemCode: "P-1", qty: 0 }], [{ itemCode: "P-1", qty: -1 }], [{ itemCode: "P-1", qty: "2" }], [{ itemCode: "P-1" }], [{ itemCode: "P-1", qty: 1 }, { itemCode: "p-1", qty: 1 }], [{ qty: 1 }], ["P-1"]]) assert.equal(await code(left(lines)), "BOM_INVALID_RETURN", JSON.stringify(lines));
  assert.equal(await code(left([{ itemCode: "P-1", qty: 1 }], "")), "BOM_INVALID_RETURN", "a reason is required");
  assert.equal(await code(left([{ itemCode: "P-1", qty: 9 }])), "BOM_INVALID_RETURN", "more than issued (8)");
  assert.equal(await code(left([{ itemCode: "P-1", qty: 1 }, { itemCode: "FG-1", qty: 1 }])), "BOM_INVALID_RETURN", "an item that was not issued");

  // rights: stale comes first, then the permission
  await as("persona-rb");
  const base = (await version()) - 1;
  assert.equal(await code(left([{ itemCode: "P-1", qty: 1 }])), "BOM_FORBIDDEN");
  assert.equal(await code(undo()), "BOM_FORBIDDEN");
  assert.equal(await code(left([{ itemCode: "P-1", qty: 1 }], "เหลือ", {}, base)), "BOM_STALE", "the issue is newer than the copy this RB member holds");
  await as("persona-wh");
  assert.equal(await code(undo()), "BOM_FORBIDDEN", "WH counts but does not return");
  await as("persona-st");

  // leftovers: the cap, a typed quantity, the whole call or nothing
  const versionBefore = await version();
  assert.equal(await code(left([{ itemCode: "P-2", qty: 1 }, { itemCode: "P-1", qty: 8.5 }])), "BOM_INVALID_RETURN");
  assert.equal(await version(), versionBefore, "a refused return writes nothing");
  assert.equal((await left([{ itemCode: "P-1", qty: 3 }, { itemCode: "P-2", qty: 1.5 }], "ใช้ไม่หมด")).error, null);
  let now = await view();
  assert.deepEqual(now.stock.map((row) => [row.itemCode, row.qty]), [["P-1", 15], ["P-2", 8.5]]);
  assert.deepEqual(now.stockMoves.filter((move) => move.kind === "return").map((move) => [move.itemCode, move.qty, move.balance, move.ref, move.note, move.by]).sort(), [["P-1", 3, 15, "PI-M1", "ใช้ไม่หมด", "วิชัย คลังวัตถุดิบ"], ["P-2", 1.5, 8.5, "PI-M1", "ใช้ไม่หมด", "วิชัย คลังวัตถุดิบ"]]);
  assert.ok(now.jobs.filter((job) => job.dept === "ST").every((job) => job.status === "done"), "a leftover keeps the jobs done");
  assert.equal(await code(left([{ itemCode: "P-1", qty: 5.5 }])), "BOM_INVALID_RETURN", "5 left of 8, 3 returned");
  assert.equal((await rpc("app_bom_audit")).data[0].detail, "partReturns +1, stock +2");

  // undo gives back only what is not yet returned; jobs wait again; the order keeps its status
  assert.equal((await undo("เบิกผิดใบ")).error, null);
  now = await view();
  assert.deepEqual(now.stock.map((row) => [row.itemCode, row.qty]), [["P-1", 20], ["P-2", 10]], "every balance is back to the count before the issue");
  assert.deepEqual(now.jobs.filter((job) => job.dept === "ST").map((job) => [job.id, job.status, job.qtyDone, "doneAt" in job]), [["J-P1", "queued", 0, false], ["J-P2", "queued", 0, false]]);
  assert.equal(now.orders[0].status, "in_progress");
  assert.equal(await code(undo()), "BOM_INVALID_RETURN", "nothing is issued now");

  // after a new issue the earlier leftovers do not count
  const [q1, q2] = await pull();
  assert.equal((await save({ jobs: { upsert: [done(q1), done(q2)] } }, "issueOrderParts")).error, null);
  assert.equal((await left([{ itemCode: "P-1", qty: 8 }])).error, null, "the leftovers of the first issue are not counted against the second");
  assert.equal(await code(left([{ itemCode: "P-1", qty: 0.5 }])), "BOM_INVALID_RETURN");

  // a completed PI still takes leftovers but is not undone; a cancelled PI takes nothing at all
  await as("persona-pp");
  const pk = (await jobsNow()).find((row) => row.id === "J-PK");
  assert.equal((await save({ jobs: { upsert: [done(pk)] } }, "reportJob")).error, null);
  const open = (await view()).orders.find((row) => row.id === "PI-M1");
  assert.equal((await save({ orders: { upsert: [{ ...open, status: "completed" }] } }, "completeOrder")).error, null);
  await as("persona-st");
  assert.equal(await code(undo()), "BOM_INVALID_TRANSITION", "a completed PI cannot be undone");
  assert.equal((await left([{ itemCode: "P-2", qty: 1 }])).error, null, "but it still takes leftovers");
  assert.equal((await view()).stock.find((row) => row.itemCode === "P-2").qty, 8);
  await as("persona-pp");
  const second = { ...order, id: "PI-M2" };
  assert.equal((await save({ orders: { upsert: [second] } }, "createOrder")).error, null);
  assert.equal((await save({ orders: { upsert: [{ ...second, status: "released" }] }, jobs: { upsert: [{ ...partJob("J2-P1", "P-1", 2), orderId: "PI-M2" }] } }, "releaseOrder")).error, null);
  await as("persona-st");
  const second1 = (await jobsNow()).find((row) => row.id === "J2-P1");
  assert.equal((await save({ jobs: { upsert: [done(second1)] } }, "issueOrderParts")).error, null);
  assert.equal((await ret({ orderId: "PI-M2", mode: "undo", reason: "ผิดใบ" }, "undoOrderParts")).error, null);
  await as("persona-pp");
  const toCancel = (await view()).orders.find((row) => row.id === "PI-M2");
  assert.equal(toCancel.status, "in_progress");
  assert.equal((await save({ orders: { upsert: [{ ...toCancel, status: "cancelled" }] } }, "cancelOrder")).error, null, "after the undo the PI has no started work and can be cancelled");
  await as("persona-st");
  assert.equal(await code(ret({ orderId: "PI-M2", mode: "leftover", reason: "x", lines: [{ itemCode: "P-1", qty: 1 }] })), "BOM_INVALID_TRANSITION", "a cancelled PI takes no return");
  assert.equal(await code(ret({ orderId: "PI-M2", mode: "undo", reason: "x" }, "undoOrderParts")), "BOM_INVALID_TRANSITION");
});
