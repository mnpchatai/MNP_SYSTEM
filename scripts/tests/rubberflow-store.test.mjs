import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// บทบาทสาธิตและที่เก็บ state ของ RubberFlow (modules/rubberflow-store.js): storage จำลองด้วย Map, action จริงจาก modules/rubberflow-actions.js
const require = createRequire(import.meta.url);
const storeApi = require("../../modules/rubberflow-store.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
const actions = require("../../modules/rubberflow-actions.js");
globalThis.MNP_RUBBERFLOW_ACTIONS = actions;
const seed = require("../../modules/rubberflow-seed.js");

const NOW = Date.parse("2026-10-28T10:00:00+07:00");
const memory = () => {
  const map = new Map();
  return { map, getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
};
const make = (storage = memory()) => ({ storage, store: storeApi.createStore({ storage, seed: () => seed.buildSeed(NOW), actions, now: () => NOW }) });

test("roles see the prototype's module sets and fine-grained permissions", () => {
  assert.equal(storeApi.MODULES.length, 15);
  assert.deepEqual(storeApi.GROUPS, ["ภาพรวม", "วางแผน", "สายการผลิต", "คุณภาพ", "คลังและเครื่องมือ"]);
  assert.deepEqual(storeApi.ROLES.admin.modules, storeApi.MODULE_IDS);
  assert.ok(!storeApi.ROLES.manager.modules.includes("audit"));
  const mixer = { role: "mixer" };
  assert.equal(storeApi.canSee(mixer, "mixing"), true);
  assert.equal(storeApi.canSee(mixer, "quality"), false);
  assert.equal(storeApi.canSee(null, "dashboard"), false);
  assert.equal(storeApi.canSee({ role: "ghost" }, "dashboard"), false);
  assert.equal(storeApi.can({ role: "qc" }, "qcDecision"), true);
  assert.equal(storeApi.can({ role: "planner" }, "qcDecision"), false);
  assert.equal(storeApi.can({ role: "planner" }, "nope"), false);
  assert.equal(storeApi.homeOf({ role: "store" }), "dashboard");
  assert.equal(storeApi.homeOf(null), "dashboard");
  assert.equal(storeApi.findModule("spc").label, "SPC / Cpk");
  assert.equal(storeApi.findModule("nope"), null);
});

test("a fresh store seeds the demo, persists it, and remembers the chosen persona with an audit entry", () => {
  const { store, storage } = make();
  assert.equal(store.user(), null);
  const data = store.data();
  assert.equal(data.orders.length, 5);
  assert.ok(storage.map.has(storeApi.STATE_KEY), "seed is written on first load");
  const user = store.setUser("U05");
  assert.equal(user.role, "mixer");
  assert.equal(store.user().id, "U05");
  assert.equal(JSON.parse(storage.map.get(storeApi.USER_KEY)), "U05");
  assert.equal(store.data().audit[0].action, "เข้าสู่ระบบ");
  assert.equal(store.setUser("nope"), null);
  assert.equal(store.user(), null);
  // เปิดใหม่ด้วย storage เดิม → ข้อมูลและบทบาทเดิม
  store.setUser("U09");
  const again = make(storage).store;
  assert.equal(again.user().id, "U09");
  assert.equal(again.data().audit[0].detail, "qc");
});

test("run clones the state, keeps it only when the rule passes, and reports the Thai error otherwise", () => {
  const { store, storage } = make();
  store.setUser("U03");
  const before = JSON.stringify(store.data().orders);
  const bad = store.run("createOrder", { recipeId: "RC-EPDM-DS01", customer: "", targetQty: 1, startDate: NOW, dueDate: NOW });
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, /ชื่อลูกค้า/);
  assert.equal(JSON.stringify(store.data().orders), before, "a failed action changes nothing");
  const unknown = store.run("nope", {});
  assert.equal(unknown.ok, false);
  assert.match(unknown.error.message, /ไม่รู้จักคำสั่ง/);
  const ok = store.run("createOrder", { recipeId: "RC-EPDM-DS01", customer: "ลูกค้า", targetQty: 10, startDate: NOW, dueDate: NOW });
  assert.equal(ok.ok, true);
  assert.match(ok.result, /^WO-/);
  assert.equal(store.data().orders[0].createdBy, "ณัฐพล บุญมา", "the persona is the actor");
  assert.equal(JSON.parse(storage.map.get(storeApi.STATE_KEY)).orders[0].id, ok.result, "persisted");
  const noResult = store.run("cleanMold", { id: "DIE-DS-01" });
  assert.equal(noResult.result, true, "actions without a return value report true");
  assert.equal(store.isPersisted(), true);
});

test("corrupt or outdated storage is replaced by a fresh seed, and reset rebuilds it", () => {
  const storage = memory();
  storage.setItem(storeApi.STATE_KEY, "{not json");
  const { store } = make(storage);
  assert.equal(store.data().orders.length, 5);
  const stale = memory();
  stale.setItem(storeApi.STATE_KEY, JSON.stringify({ version: 0, counters: {}, orders: [] }));
  assert.equal(make(stale).store.data().version, storeApi.STATE_VERSION);
  assert.equal(storeApi.isValidState({ version: 1, counters: {}, users: [] }), false, "every list is required");
  assert.equal(storeApi.isValidState(seed.emptyState()), true);
  store.run("cleanMold", { id: "DIE-DS-01" });
  assert.equal(store.data().molds[0].usageSinceClean, 0);
  store.reset();
  assert.ok(store.data().molds[0].usageSinceClean > 0, "reset restores the demo");
});

test("a storage that throws keeps the module working in memory and reports that nothing is persisted", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  const { store } = make(broken);
  assert.equal(store.data().orders.length, 5);
  assert.equal(store.isPersisted(), false);
  const result = store.run("cleanMold", { id: "DIE-DS-01" });
  assert.equal(result.ok, true);
  assert.equal(store.data().molds[0].usageSinceClean, 0);
  const none = storeApi.createStore({ storage: null, seed: () => seed.buildSeed(NOW), actions, now: () => NOW });
  assert.equal(none.data().users.length, 9);
});
