import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// โหมดฐานข้อมูลของ RubberFlow (ข้อมูลหลัก 3 ชุด: วัตถุดิบ สูตรยางทุก revision ใบสั่งผลิต WO อยู่ใน Supabase ผ่าน app_rf_master / app_rf_save):
// store แบบ remote ใน modules/rubberflow-store.js ทดสอบกับ Supabase จำลองของ harness (scripts/pilot-harness-mock.mjs ที่บังคับสัญญา RPC เดียวกับฐานข้อมูลจริง)
// กฎสิทธิ์ที่ยืนยัน: ผู้วางแผนหรือสมาชิก RB แก้วัตถุดิบ/ร่างสูตร/เปิด WO ได้ · หัวหน้า RB อนุมัติสูตรและปล่อยผลิต · สูตรที่อนุมัติแล้วแก้ไม่ได้ (ออก revision ใหม่) ·
// WO ที่มาจากงาน RB ของ BOM ผูกงานในคำสั่งเดียวกันและส่งยอดผลิตกลับเมื่อปิด
const require = createRequire(import.meta.url);
const rules = require("../../modules/rubberflow-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = rules;
const A = require("../../modules/rubberflow-actions.js");
globalThis.MNP_RUBBERFLOW_ACTIONS = A;
const seed = require("../../modules/rubberflow-seed.js");
const storeApi = require("../../modules/rubberflow-store.js");

const NOW = Date.parse("2026-11-06T10:00:00+07:00");
const DAY = 86400000;
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const unwrap = ({ data, error }) => {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
};
const saved = async (out) => {
  assert.equal(out.ok, true, out.error?.message);
  const outcome = await out.saving;
  assert.equal(outcome.ok, true, outcome.error?.message);
  return out;
};
const denied = async (out, code) => {
  assert.equal(out.ok, true, out.error?.message);
  const outcome = await out.saving;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, code, outcome.error.message);
  return outcome;
};

const BOM_KEY = "mnp-harness-bom-master";
const bomJob = (id, extra = {}) => ({ id, orderId: "PI-R", dept: "RB", itemCode: "RB-ITEM", name: "เส้นยางทดสอบ", kind: "RB", uom: "pcs", qtyPlanned: 10, qtyRequired: 10, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: NOW + DAY, status: "queued", externalRef: null, reports: [], ...extra });
// ฐาน BOM ของ Supabase จำลองที่มีใบ PI-R ปล่อยผลิตแล้วกับงาน RB สองงาน (เขียนลง storage ตรงๆ ให้ mock โหลดเป็นข้อมูลเริ่มต้น)
function seedBom(storage) {
  const lists = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs"];
  const master = { version: 4, epoch: "bom-e1", ...Object.fromEntries(lists.map((list) => [list, []])), versions: Object.fromEntries(lists.map((list) => [list, {}])), tombstones: [], audit: [] };
  master.orders = [{ id: "PI-R", status: "released", customer: "ลูกค้า", orderedAt: NOW, items: [], revision: 1 }];
  master.jobs = [bomJob("JOB-RB1"), bomJob("JOB-RB2", { qtyPlanned: 100, qtyRequired: 100 }), bomJob("JOB-RB3", { qtyPlanned: 100, qtyRequired: 100 }),
    bomJob("JOB-RB4", { qtyPlanned: 100, qtyRequired: 100, qtyDone: 30, status: "in_progress", reports: [{ at: 1, by: "ผู้รายงาน", good: 30, reject: 0, note: "กะเช้า" }] })];
  master.versions.orders["PI-R"] = 4;
  master.versions.jobs["JOB-RB1"] = 4;
  master.versions.jobs["JOB-RB2"] = 4;
  master.versions.jobs["JOB-RB3"] = 4;
  master.versions.jobs["JOB-RB4"] = 4;
  storage.setItem(BOM_KEY, JSON.stringify(master));
}

// เซสชันเดียวของ Supabase จำลอง (หนึ่งบัญชีทดสอบต่อครั้ง เหมือนหน้าเว็บ) · make() สร้าง store ของ "เครื่อง" หนึ่งเครื่อง · as(persona) เปลี่ยนบัญชีทดสอบที่ทำหน้าที่อยู่
async function session({ withBom = false, storage = memoryStorage() } = {}) {
  if (withBom) seedBom(storage);
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const status = unwrap(await mock.client.rpc("app_sandbox_status"));
  const rows = Object.fromEntries(status.personas.map((row) => [row.id, row]));
  const who = { id: "persona-1" };
  const call = async (name, args) => unwrap(await mock.client.rpc(name, args));
  const adapter = {
    load: () => call("app_rf_master"),
    save: (changes, baseVersion, action, audit, epoch) => call("app_rf_save", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }),
    since: (version) => call("app_rf_master_since", { p_version: version }),
    audit: (limit) => call("app_rf_audit", { p_limit: limit }),
    purge: () => call("app_sandbox_purge_rf"),
    ...{},
  };
  const as = async (id) => { who.id = id; await call("app_sandbox_enter", { p_persona_id: id }); };
  const make = async (options = {}) => {
    const local = options.local ?? memoryStorage();
    const store = storeApi.createStore({
      storage: local, seed: () => seed.buildSeed(NOW), actions: A, now: () => NOW, remote: options.remote ?? adapter,
      persona: () => storeApi.personaUser(rows[who.id]), localSeed: () => seed.localSeed(NOW), shouldHold: options.shouldHold,
    });
    const events = [];
    store.subscribe((event) => events.push(event));
    await store.ensureLoaded();
    return { store, local, events };
  };
  return { mock, storage, adapter, as, make, call, rows };
}

const RECIPE = { id: "RC-TEST-01", name: "สูตรทดสอบ", productName: "สินค้าทดสอบ", uom: "m", batchKg: 50, dumpTemp: 130, mixSec: 270, yieldPerKg: 6, items: [{ materialCode: "EPDM-55", phr: 100 }, { materialCode: "CB-N550", phr: 60 }] };
const ORDER = { recipeId: "RC-TEST-01", customer: "ลูกค้า ทดสอบ", targetQty: 100, startDate: NOW, dueDate: NOW + DAY };
async function withMaterials(s, rig) {
  await s.as("persona-1");
  await saved(rig.store.run("saveMaterial", { code: "EPDM-55", name: "ยาง EPDM", category: "โพลิเมอร์", storage: "A-1", uom: "kg", active: true }));
  await saved(rig.store.run("saveMaterial", { code: "CB-N550", name: "เขม่าดำ", category: "สารตัวเติม", storage: "B-1", uom: "kg", active: true }));
}
// สร้างสูตร RC-TEST-01 แล้วอนุมัติ (บัญชีที่ทำหน้าที่อยู่ต้องเป็นหัวหน้า RB ขึ้นไป)
async function withApprovedRecipe(s, rig) {
  await withMaterials(s, rig);
  await saved(rig.store.run("createRecipe", RECIPE));
  await saved(rig.store.run("approveRecipe", { id: "RC-TEST-01", revision: 1 }));
}

test("the persona decides the RubberFlow role and the planner / RB member / RB head flags (the database repeats the same rules)", () => {
  const employee = (role, dept) => ({ id: `${role}-${dept}`, first_name: "สม", last_name: "ใจดี", role: { code: role }, department: { code: dept } });
  const flags = (role, dept) => { const user = storeApi.personaUser(employee(role, dept)); return [user.role, user.planner, user.rb, user.rbHead]; };
  assert.deepEqual(flags("admin", "MT"), ["admin", true, false, true], "admin is the planner group and counts as a head");
  assert.deepEqual(flags("staff", "PP"), ["planner", true, false, false]);
  assert.deepEqual(flags("staff", "RB"), ["rb", false, true, false], "an RB member of any role may edit but is not a head");
  assert.deepEqual(flags("supervisor", "RB"), ["rb", false, true, false]);
  assert.deepEqual(flags("department_manager", "RB"), ["manager", true, true, true], "the RB department manager is a head and in the planner group");
  assert.deepEqual(flags("assistant_department_manager", "RB"), ["rb", false, true, true], "the assistant department manager of RB is a head");
  assert.deepEqual(flags("assistant_department_manager", "GR"), ["viewer", false, false, false], "...only inside RB");
  assert.deepEqual(flags("department_manager", "GR"), ["manager", true, false, false], "another department's manager plans but does not approve recipes");
  assert.deepEqual(flags("factory_manager", "GR"), ["manager", true, false, true], "the factory manager and above are heads in any department");
  assert.deepEqual(flags("general_manager", "MT"), ["manager", true, false, true]);
  assert.deepEqual(flags("staff", "ST"), ["store", false, false, false]);
  assert.deepEqual(flags("staff", "QA"), ["qc", false, false, false]);
  assert.deepEqual(flags("staff", "SR"), ["gatekeeper", false, false, false]);
  assert.deepEqual(flags("staff", "MT"), ["viewer", false, false, false]);
  assert.equal(storeApi.personaUser(null), null);
  const rbHead = storeApi.personaUser(employee("department_manager", "RB"));
  const rbStaff = storeApi.personaUser(employee("staff", "RB"));
  const planner = storeApi.personaUser(employee("staff", "PP"));
  assert.equal(storeApi.can(rbHead, "approveRecipe"), true);
  assert.equal(storeApi.can(rbStaff, "approveRecipe"), false);
  assert.equal(storeApi.can(planner, "approveRecipe"), false, "planning does not approve recipes");
  assert.equal(storeApi.can(rbStaff, "editMaster") && storeApi.can(rbStaff, "createOrder") && storeApi.can(rbStaff, "workOrder"), true);
  assert.equal(storeApi.can(rbStaff, "releaseOrder"), false, "releasing is for heads and the planner group");
  assert.equal(storeApi.can(planner, "releaseOrder"), true);
  assert.equal(storeApi.can(rbHead, "demoSkip"), false, "no demo time skip on the database");
  assert.equal(storeApi.can({ role: "mixer" }, "demoSkip"), true, "the in-browser demo keeps it");
  for (const role of ["rb", "gatekeeper", "viewer"]) assert.ok(storeApi.ROLES[role], role);
  assert.ok(storeApi.canSee(rbStaff, "recipes") && storeApi.canSee(rbStaff, "mixing"));
  assert.ok(storeApi.canSee(rbStaff, "audit") && storeApi.canSee(rbHead, "audit"), "every database account reads the audit trail");
  assert.equal(storeApi.canSee({ role: "planner" }, "audit"), false, "the demo roles keep their own menus");
  assert.equal(storeApi.canSee(storeApi.personaUser(employee("staff", "SR")), "orders"), false);
});

test("materials and recipes: RB staff and the planner group draft, only the RB head approves, and the database says no to anyone else", async () => {
  const s = await session();
  const rig = await s.make();
  assert.equal(rig.store.isRemote(), true);
  assert.deepEqual(rig.store.data().materials, [], "the database starts empty (no demo seed)");
  assert.deepEqual(rig.store.data().recipes, []);
  await withMaterials(s, rig);
  assert.deepEqual(rig.store.data().materials.map((row) => row.code), ["CB-N550", "EPDM-55"]);
  assert.equal(rig.store.data().materials[0].createdBy, "ปกรณ์ ศรีวัฒนา", "the database stamps the saver");

  // พนักงาน RB สร้างร่างได้ อนุมัติไม่ได้ (คำสั่งปฏิเสธก่อนส่งด้วยข้อความไทย)
  await s.as("persona-rb");
  await saved(rig.store.run("saveMaterial", { code: "ZNO", name: "ซิงค์ออกไซด์", category: "สารกระตุ้น", storage: "D-1", active: "1" }));
  await saved(rig.store.run("createRecipe", RECIPE));
  assert.equal(rig.store.data().recipes[0].status, "draft");
  assert.equal(rig.store.data().recipes[0].createdBy, "ประยุทธ รีดยาง");
  const blocked = rig.store.run("approveRecipe", { id: "RC-TEST-01", revision: 1 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error.message, /หัวหน้าแผนก RB/);
  // ข้ามกฎฝั่งหน้า: ส่งตรงไปที่ฐานข้อมูลในนามพนักงาน RB → ปฏิเสธ RF_FORBIDDEN และไม่มีอะไรเปลี่ยน
  const draft = unwrap(await s.mock.client.rpc("app_rf_master")).recipes[0];
  const version = unwrap(await s.mock.client.rpc("app_rf_master")).version;
  const sneaky = await s.mock.client.rpc("app_rf_save", { p_changes: { recipes: { upsert: [{ ...draft, status: "approved" }] } }, p_base_version: version, p_action: "approveRecipe" });
  assert.equal(sneaky.error.code, "RF_FORBIDDEN");
  assert.equal(unwrap(await s.mock.client.rpc("app_rf_master")).recipes[0].status, "draft");

  // ผู้วางแผน (PP) และ ST: PP อนุมัติไม่ได้ ST แก้ข้อมูลหลักไม่ได้
  await s.as("persona-pp");
  assert.match(rig.store.run("approveRecipe", { id: "RC-TEST-01", revision: 1 }).error.message, /หัวหน้าแผนก RB/);
  await saved(rig.store.run("saveMaterial", { code: "STA", name: "กรดสเตียริก", active: true }));
  await s.as("persona-st");
  assert.match(rig.store.run("saveMaterial", { code: "XX", name: "x" }).error.message, /ไม่มีสิทธิ์/);
  assert.match(rig.store.run("createRecipe", { ...RECIPE, id: "RC-X" }).error.message, /ไม่มีสิทธิ์/);
  const forced = await s.mock.client.rpc("app_rf_save", { p_changes: { materials: { upsert: [{ code: "XX", name: "x", active: true }] } }, p_base_version: version, p_action: "saveMaterial" });
  assert.equal(forced.error.code, "RF_FORBIDDEN", "the database refuses a store keeper too");

  // หัวหน้า RB อนุมัติได้
  await s.as("persona-rbh");
  const approve = await saved(rig.store.run("approveRecipe", { id: "RC-TEST-01", revision: 1 }));
  assert.equal(approve.ok, true);
  const approved = rig.store.data().recipes[0];
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedBy, "สุรีย์ หัวหน้ารีด");
  assert.equal(rules.currentRecipe(rig.store.data().recipes, "RC-TEST-01").revision, 1);
});

test("an approved revision is immutable: editing issues revision + 1 as a draft, approving it supersedes the old one, and orders keep the revision they were opened with", async () => {
  const s = await session();
  const rig = await s.make();
  await s.as("persona-rbh");
  await withApprovedRecipe(s, rig);
  await s.as("persona-rb");
  const first = await saved(rig.store.run("createOrder", ORDER));
  assert.match(first.result, new RegExp(`^WO-${rules.ymd(NOW)}-01$`));
  assert.equal(rig.store.data().orders[0].recipeRevision, 1);

  // แก้สูตรที่อนุมัติแล้ว = ร่าง revision 2 ของรหัสเดิม (revision 1 ใช้งานต่อ)
  const edit = await saved(rig.store.run("saveRecipe", { ...RECIPE, name: "สูตรทดสอบ แก้", items: [{ materialCode: "EPDM-55", phr: 100 }, { materialCode: "CB-N550", phr: 70 }] }));
  assert.equal(edit.result, 2, "the new revision number");
  const rows = rules.revisionsOf(rig.store.data().recipes, "RC-TEST-01");
  assert.deepEqual(rows.map((row) => [row.revision, row.status]), [[2, "draft"], [1, "approved"]]);
  assert.equal(rows[1].name, "สูตรทดสอบ", "revision 1 is untouched");
  assert.equal(rules.currentRecipe(rig.store.data().recipes, "RC-TEST-01").revision, 1, "the approved revision stays the working one");
  assert.deepEqual(rules.approvedRecipes(rig.store.data().recipes).map((row) => row.revision), [1]);
  assert.equal(rules.currentRecipes(rig.store.data().recipes).length, 1, "one row per recipe code");
  // แก้ร่างซ้ำ = แก้ร่างเดิม ไม่ออก revision 3
  const again = await saved(rig.store.run("saveRecipe", { ...RECIPE, name: "สูตรทดสอบ แก้อีก" }));
  assert.equal(again.result, 2);
  assert.equal(rules.revisionsOf(rig.store.data().recipes, "RC-TEST-01").length, 2);
  // ฐานข้อมูลปฏิเสธการแก้ revision ที่อนุมัติแล้วตรงๆ
  const snapshot = unwrap(await s.mock.client.rpc("app_rf_master"));
  const direct = await s.mock.client.rpc("app_rf_save", { p_changes: { recipes: { upsert: [{ ...snapshot.recipes[0], name: "แก้ตรงๆ" }] } }, p_base_version: snapshot.version, p_action: "saveRecipe" });
  assert.equal(direct.error.code, "RF_REVISION_IMMUTABLE");

  // อนุมัติ revision 2 → revision 1 ถูกแทนที่ในคำสั่งเดียวกัน (อนุมัติได้หนึ่ง revision ต่อรหัส)
  await s.as("persona-rbh");
  await saved(rig.store.run("approveRecipe", { id: "RC-TEST-01", revision: 2 }));
  assert.deepEqual(rules.revisionsOf(rig.store.data().recipes, "RC-TEST-01").map((row) => [row.revision, row.status]), [[2, "approved"], [1, "superseded"]]);
  assert.match(rig.store.run("approveRecipe", { id: "RC-TEST-01", revision: 1 }).error.message, /ถูกแทนที่แล้ว/);
  assert.equal(rules.recipeOf(rig.store.data().recipes, "RC-TEST-01", 1).status, "superseded", "an order opened on revision 1 still reads that revision");
  assert.equal(rules.recipeOf(rig.store.data().recipes, "RC-TEST-01", null).revision, 2);
  // ใบใหม่ใช้ revision 2
  const second = await saved(rig.store.run("createOrder", ORDER));
  assert.equal(rig.store.data().orders.find((row) => row.id === second.result).recipeRevision, 2);
  // ออก revision 3 ต่อได้
  await s.as("persona-rb");
  assert.equal((await saved(rig.store.run("saveRecipe", RECIPE))).result, 3);
  // ฐานข้อมูลรับเฉพาะร่างของสูตรที่อนุมัติแล้วเปิดใบ: สูตรที่มีแต่ร่างเปิดใบไม่ได้
  await saved(rig.store.run("createRecipe", { ...RECIPE, id: "RC-DRAFT-ONLY" }));
  assert.match(rig.store.run("createOrder", { ...ORDER, recipeId: "RC-DRAFT-ONLY" }).error.message, /ยังไม่ได้รับอนุมัติ/);
});

test("work orders: the number comes from the database snapshot, a duplicate is a stale conflict that catches up, and the status flow has per-status rights", async () => {
  const s = await session();
  const a = await s.make();
  const b = await s.make();
  await s.as("persona-rbh");
  await withApprovedRecipe(s, a);
  await b.store.catchUp();
  assert.equal(b.store.data().recipes.length, 1, "the second machine sees the recipe after catching up");

  await s.as("persona-pp");
  const one = await saved(a.store.run("createOrder", ORDER));
  assert.equal(one.result, `WO-${rules.ymd(NOW)}-01`);
  assert.deepEqual(a.store.data().counters, {}, "WO numbers do not touch the local counters");
  // เครื่อง B ยังไม่เห็นใบ 01 จึงออกเลข 01 ซ้ำ → ฐานข้อมูลตอบ RF_STALE ย้อนกลับแล้วตามทัน
  const dup = b.store.run("createOrder", { ...ORDER, customer: "อีกคน" });
  assert.equal(dup.result, `WO-${rules.ymd(NOW)}-01`);
  const lost = await denied(dup, "RF_STALE");
  assert.match(lost.error.message, /ลองทำรายการอีกครั้ง/);
  assert.deepEqual(b.store.data().orders.map((row) => row.customer), ["ลูกค้า ทดสอบ"], "reverted and caught up to the database");
  const two = await saved(b.store.run("createOrder", { ...ORDER, customer: "อีกคน" }));
  assert.equal(two.result, `WO-${rules.ymd(NOW)}-02`);
  assert.equal(unwrap(await s.mock.client.rpc("app_rf_master")).orders.length, 2);

  // สถานะ: ปล่อยผลิต = หัวหน้า RB/ผู้วางแผน · ที่เหลือ = สมาชิก RB/ผู้วางแผน · ข้ามลำดับไม่ได้
  const id = one.result;
  await s.as("persona-rb");
  assert.match(a.store.run("setOrderStatus", { id, status: "released" }).error.message, /ปล่อยผลิตได้โดย/);
  assert.match(a.store.run("setOrderStatus", { id, status: "completed" }).error.message, /เปลี่ยนสถานะจาก planned เป็น completed ไม่ได้/);
  await s.as("persona-rbh");
  await saved(a.store.run("setOrderStatus", { id, status: "released" }));
  assert.equal(a.store.data().orders.find((row) => row.id === id).releasedBy, "สุรีย์ หัวหน้ารีด");
  await s.as("persona-st");
  assert.match(a.store.run("setOrderStatus", { id, status: "in_progress" }).error.message, /ไม่มีสิทธิ์/);
  // ฐานข้อมูลตัดสินเองด้วย: ST ส่งตรง → RF_FORBIDDEN เสมอ (ไม่ใช่สมาชิก RB/ผู้วางแผน ตัดตั้งแต่ระดับส่วน แม้ฐานเวอร์ชันเก่า)
  const snapshot = unwrap(await s.mock.client.rpc("app_rf_master"));
  const row = snapshot.orders.find((order) => order.id === id);
  const forced = await s.mock.client.rpc("app_rf_save", { p_changes: { orders: { upsert: [{ ...row, status: "in_progress" }] } }, p_base_version: snapshot.version, p_action: "setOrderStatus" });
  assert.equal(forced.error.code, "RF_FORBIDDEN");
  const staleStore = await s.mock.client.rpc("app_rf_save", { p_changes: { orders: { upsert: [{ ...row, status: "in_progress" }] } }, p_base_version: 0, p_action: "setOrderStatus" });
  assert.equal(staleStore.error.code, "RF_FORBIDDEN", "a store keeper is refused before anything else");
  // สมาชิก RB ขอปล่อยผลิตใบที่ยังไม่ปล่อย (ทำไม่ได้): ฐานเวอร์ชันเก่า → RF_STALE มาก่อนสิทธิ์ ฐานล่าสุด → RF_FORBIDDEN
  await s.as("persona-rb");
  const planned = snapshot.orders.find((order) => order.id === two.result);
  const asked = { orders: { upsert: [{ ...planned, status: "released" }] } };
  assert.equal((await s.mock.client.rpc("app_rf_save", { p_changes: asked, p_base_version: 0, p_action: "setOrderStatus" })).error.code, "RF_STALE", "stale is reported before permissions");
  assert.equal((await s.mock.client.rpc("app_rf_save", { p_changes: asked, p_base_version: snapshot.version, p_action: "setOrderStatus" })).error.code, "RF_FORBIDDEN");
  const badAction = await s.mock.client.rpc("app_rf_save", { p_changes: {}, p_base_version: snapshot.version, p_action: "dropTables" });
  assert.equal(badAction.error.code, "RF_INVALID_ACTION");
  await s.as("persona-rb");
  await saved(a.store.run("setOrderStatus", { id, status: "in_progress" }));
  await saved(a.store.run("setOrderStatus", { id, status: "on_hold" }));
  await saved(a.store.run("setOrderStatus", { id, status: "in_progress" }));
  // ปิดใบที่ไม่ได้มาจากงาน BOM: ยอดผลิตตอนปิดบันทึกได้ ไม่บังคับ
  await saved(a.store.run("setOrderStatus", { id, status: "completed", producedQty: "80" }));
  const closed = a.store.data().orders.find((order) => order.id === id);
  assert.equal(closed.status, "completed");
  assert.equal(closed.producedQty, 80);
  assert.equal(typeof closed.completedAt, "number");
  assert.match(a.store.run("setOrderStatus", { id, status: "cancelled" }).error.message, /เปลี่ยนสถานะจาก completed/);
  // ผลิตเกิน / ปล่อยของช้า: ยอดของใบที่ปิดแล้วเพิ่มได้ ลดไม่ได้ (ฐานข้อมูลตัดสินเอง)
  const closedRow = unwrap(await s.mock.client.rpc("app_rf_master")).orders.find((order) => order.id === id);
  const version = () => s.call("app_rf_master").then((master) => master.version);
  const raise = await s.mock.client.rpc("app_rf_save", { p_changes: { orders: { upsert: [{ ...closedRow, producedQty: 85 }] } }, p_base_version: await version(), p_action: "setOrderStatus" });
  assert.equal(raise.data.changes.orders.upsert[0].producedQty, 85, "a completed order accepts a higher produced quantity");
  const lower = await s.mock.client.rpc("app_rf_save", { p_changes: { orders: { upsert: [{ ...closedRow, producedQty: 70 }] } }, p_base_version: await version(), p_action: "setOrderStatus" });
  assert.equal(lower.error.code, "RF_INVALID_ORDER", "but never a lower one");
});

test("a WO made from a BOM RB job links the job in the same save, the job's quantity follows the WO when it closes, and bad links are refused", async () => {
  const s = await session({ withBom: true });
  const rig = await s.make();
  await s.as("persona-rbh");
  await withApprovedRecipe(s, rig);
  const bomVersion = () => s.call("app_bom_master").then((master) => master.version);
  assert.equal(await bomVersion(), 4);

  await s.as("persona-rb");
  const link = { ...ORDER, customerPo: "PI-R", targetQty: 10, sourceJobId: "JOB-RB1", uom: "pcs", targetKg: 12.5, kgPerUnit: 1.25 };
  const out = await saved(rig.store.run("createOrder", link));
  const order = rig.store.data().orders.find((row) => row.id === out.result);
  assert.deepEqual([order.sourceJobId, order.uom, order.targetQty, order.targetKg, order.kgPerUnit], ["JOB-RB1", "pcs", 10, 12.5, 1.25], "the job's unit and the compound kilograms ride on the order");
  const master = await s.call("app_bom_master");
  const job = master.jobs.find((row) => row.id === "JOB-RB1");
  assert.equal(job.externalRef.system, "rubberflow");
  assert.equal(job.externalRef.woId, out.result);
  assert.equal(job.externalRef.kg, 12.5);
  assert.equal(job.externalRef.by, "ประยุทธ รีดยาง");
  assert.equal(master.version, 5, "the BOM counter moved so BOM clients catch the link up");
  const delta = await s.call("app_bom_master_since", { p_version: 4 });
  assert.deepEqual(delta.changes.jobs.upsert.map((row) => row.id), ["JOB-RB1"]);
  assert.equal(master.jobs.find((row) => row.id === "JOB-RB2").externalRef, null);

  // ผูกงานเดิมซ้ำ / งานที่ไม่มี / งานของแผนกอื่น: ปฏิเสธและไม่มี WO ใหม่
  const again = rig.store.run("createOrder", link);
  assert.equal(again.ok, true);
  assert.equal((await again.saving).error.code, "RF_INVALID_SOURCE_JOB");
  assert.equal(rig.store.data().orders.length, 1, "reverted");
  assert.match((await rig.store.run("createOrder", { ...link, sourceJobId: "JOB-NOPE" }).saving).error.message, /ใช้ไม่ได้แล้ว/);
  assert.equal((await rig.store.run("createOrder", { ...link, sourceJobId: "JOB 1" }).saving).error.code, "RF_INVALID_ORDER", "a malformed job number is refused");
  assert.equal((await s.call("app_bom_master")).version, 5, "refused saves do not touch BOM");
  await s.as("persona-st");
  assert.match(rig.store.run("createOrder", { ...link, sourceJobId: "JOB-RB2" }).error.message, /ไม่มีสิทธิ์/);

  // ปิด WO: ต้องมียอดผลิตจริง > 0 แล้วยอดไปเป็นรายงานผลและ qtyDone ของงาน (ครั้งเดียวกับการปิด)
  await s.as("persona-rbh");
  await saved(rig.store.run("setOrderStatus", { id: out.result, status: "released" }));
  await saved(rig.store.run("setOrderStatus", { id: out.result, status: "in_progress" }));
  const noQty = rig.store.run("setOrderStatus", { id: out.result, status: "completed" });
  assert.equal(noQty.ok, false);
  assert.match(noQty.error.message, /ปริมาณผลิตจริง/);
  assert.equal(rig.store.run("setOrderStatus", { id: out.result, status: "completed", producedQty: 0 }).ok, false);
  const snapshot = await s.call("app_rf_master");
  const forced = await s.mock.client.rpc("app_rf_save", { p_changes: { orders: { upsert: [{ ...snapshot.orders[0], status: "completed", producedQty: 0 }] } }, p_base_version: snapshot.version, p_action: "setOrderStatus" });
  assert.equal(forced.error.code, "RF_INVALID_PRODUCED", "the database refuses it too");
  await saved(rig.store.run("setOrderStatus", { id: out.result, status: "completed", producedQty: 6 }));
  const after = await s.call("app_bom_master");
  const fed = after.jobs.find((row) => row.id === "JOB-RB1");
  assert.equal(fed.qtyDone, 6);
  assert.equal(fed.status, "in_progress", "6 of 10 is not done");
  assert.deepEqual(fed.reports.map((row) => [row.good, row.reject, row.note]), [[6, 0, `จาก WO ${out.result}`]]);
  assert.equal(fed.reports[0].by, "สุรีย์ หัวหน้ารีด", "the server stamps who closed it");
  assert.equal(after.orders.find((row) => row.id === "PI-R").status, "in_progress", "the PI starts when the first yield arrives");
  assert.equal(after.version, 6);

  // ปิด WO ที่ผลิตครบแล้วงาน done
  const secondOut = await saved(rig.store.run("createOrder", { ...link, sourceJobId: "JOB-RB2", targetQty: 100, targetKg: 100, kgPerUnit: 1 }));
  const second = secondOut.result;
  await saved(rig.store.run("setOrderStatus", { id: second, status: "released" }));
  await saved(rig.store.run("setOrderStatus", { id: second, status: "in_progress" }));
  await saved(rig.store.run("setOrderStatus", { id: second, status: "completed", producedQty: 100 }));
  const done = (await s.call("app_bom_master")).jobs.find((row) => row.id === "JOB-RB2");
  assert.deepEqual([done.qtyDone, done.status], [100, "done"]);
  assert.equal(typeof done.doneAt, "number");
});

test("the parts that are not on the database yet stay in the browser, and a refused save reverts them with the order", async () => {
  const s = await session();
  const local = memoryStorage();
  const rig = await s.make({ local });
  await s.as("persona-rbh");
  assert.ok(rig.store.data().molds.length >= 5, "the tools are seeded locally");
  assert.equal(rig.store.data().users.length, 0, "no demo roles in database mode");
  assert.equal(rig.store.user().rbHead, true);
  await withMaterials(s, rig);
  // รับวัตถุดิบเข้าคลัง = ส่วนในเครื่อง ไม่เรียกฐานข้อมูล
  const before = unwrap(await s.mock.client.rpc("app_rf_master")).version;
  const lot = rig.store.run("receiveMaterial", { materialCode: "EPDM-55", qtyKg: 100, expiry: NOW + 90 * DAY, supplier: "ผู้ขาย", coa: true });
  assert.equal(lot.ok, true);
  await lot.saving;
  assert.match(lot.result, /^RM-EPDM-55-/);
  assert.equal(unwrap(await s.mock.client.rpc("app_rf_master")).version, before, "no save call for local-only lists");
  const stored = JSON.parse(local.map.get(storeApi.LOCAL_KEY));
  assert.equal(stored.materialLots.length, 1);
  assert.equal(Object.keys(stored.counters).length, 1);
  assert.equal(local.map.has(storeApi.STATE_KEY), false, "the demo state key is not used in database mode");
  // เลิกใช้วัตถุดิบ: รับเข้าคลังไม่ได้อีก
  await saved(rig.store.run("saveMaterial", { code: "EPDM-55", name: "ยาง EPDM", category: "โพลิเมอร์", storage: "A-1", active: "0" }));
  assert.equal(rig.store.data().materials.find((row) => row.code === "EPDM-55").active, false);
  assert.match(rig.store.run("receiveMaterial", { materialCode: "EPDM-55", qtyKg: 1, expiry: NOW + DAY }).error.message, /เลิกใช้แล้ว/);

  // คำสั่งที่แตะทั้งสองส่วน: ฐานข้อมูลไม่รับ → ส่วนในเครื่องย้อนกลับด้วย (ทั้งข้อมูลและไฟล์ local)
  const both = {
    ...A,
    both(d, p, ctx) {
      d.materials.push({ code: "NEW-1", name: "ใหม่", active: true });
      d.molds[0].usageSinceClean += 1;
      d.counters.X = (d.counters.X ?? 0) + 1;
      d.audit.unshift({ at: ctx.now, user: "x", action: "ทดสอบ", detail: "ทั้งสองส่วน" });
    },
  };
  const failing = { store: storeApi.createStore({ storage: local, seed: () => seed.buildSeed(NOW), actions: both, now: () => NOW, remote: { ...s.adapter, save: async () => { throw Object.assign(new Error("RF_FORBIDDEN"), { code: "RF_FORBIDDEN" }); } }, persona: () => storeApi.personaUser(s.rows["persona-rbh"]) }) };
  await failing.store.ensureLoaded();
  const usage = failing.store.data().molds[0].usageSinceClean;
  const result = failing.store.run("both", {});
  assert.equal(result.ok, true);
  assert.equal(failing.store.data().molds[0].usageSinceClean, usage + 1, "optimistic: shown at once");
  assert.equal(JSON.parse(local.map.get(storeApi.LOCAL_KEY)).molds[0].usageSinceClean, usage + 1, "and kept in the local file");
  const outcome = await result.saving;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, "RF_FORBIDDEN");
  assert.equal(failing.store.data().molds[0].usageSinceClean, usage, "reverted with the refused save");
  assert.equal(failing.store.data().counters.X, undefined);
  assert.equal(failing.store.data().materials.some((row) => row.code === "NEW-1"), false);
  assert.equal(JSON.parse(local.map.get(storeApi.LOCAL_KEY)).molds[0].usageSinceClean, usage, "the local file is restored too");
  // ส่วนในเครื่องกลับมาหลังโหลดหน้าใหม่
  const reopened = await s.make({ local });
  assert.equal(reopened.store.data().materialLots.length, 1);
  assert.equal(reopened.store.data().materials.length, 2);
});

test("catching up merges other users' saves, a form that is open holds them back, and purge clears the database and the local parts for the admin only", async () => {
  const s = await session();
  const state = { holding: false };
  const a = await s.make({ shouldHold: () => state.holding });
  const b = await s.make();
  await s.as("persona-1");
  await saved(b.store.run("saveMaterial", { code: "M-1", name: "หนึ่ง", active: true }));
  // เครื่อง A ตามทัน: เห็นของเครื่อง B แล้ววาดใหม่ (synced)
  assert.equal(await a.store.catchUp(), true);
  assert.deepEqual(a.store.data().materials.map((row) => row.code), ["M-1"]);
  assert.equal(a.events.filter((event) => event.type === "synced").length, 1);
  assert.equal(await a.store.catchUp(), false, "nothing new: no redraw");
  // ฟอร์มค้างอยู่ = ไม่รวม ไม่ขยับเวอร์ชันฐาน แค่จำว่ามีใหม่
  await saved(b.store.run("saveMaterial", { code: "M-2", name: "สอง", active: true }));
  const baseBefore = a.store.version();
  state.holding = true;
  assert.equal(await a.store.catchUp(), false);
  assert.equal(a.store.hasNewer(), true);
  assert.equal(a.store.version(), baseBefore);
  assert.deepEqual(a.store.data().materials.map((row) => row.code), ["M-1"], "the data under the open form is untouched");
  assert.equal(a.events.filter((event) => event.type === "pending").length, 1);
  // บันทึกจากฟอร์มเก่าแตะระเบียนที่ผู้อื่นแก้ → ชน (RF_STALE) ไม่ทับ
  const mine = await a.store.run("saveMaterial", { code: "M-2", name: "ของ A", active: true }).saving;
  assert.equal(mine.error.code, "RF_STALE");
  assert.equal(unwrap(await s.mock.client.rpc("app_rf_master")).materials.find((row) => row.code === "M-2").name, "สอง");
  state.holding = false;
  assert.equal(await a.store.catchUp(), true);
  assert.deepEqual(a.store.data().materials.map((row) => row.code), ["M-1", "M-2"]);

  // ล้างข้อมูลทดสอบ: เฉพาะ admin ตัวจริง · เครื่องเก่าที่ถือรอบข้อมูลเดิมบันทึกไม่ได้ (RF_RESET) และตามทันด้วยการโหลดทั้งชุด
  await saved(a.store.run("receiveMaterial", { materialCode: "M-1", qtyKg: 5, expiry: NOW + DAY }) );
  assert.equal(a.store.data().materialLots.length, 1);
  const purged = await a.store.purge();
  assert.equal(purged.ok, true);
  assert.equal(purged.deleted, 2);
  assert.deepEqual(a.store.data().materials, []);
  assert.equal(a.store.data().materialLots.length, 0, "the local parts that point at the purged rows go too");
  assert.ok(a.store.data().molds.length >= 5, "the tools are seeded again");
  const old = b.store.run("saveMaterial", { code: "M-3", name: "สาม", active: true });
  const reset = await old.saving;
  assert.equal(reset.error.code, "RF_RESET");
  assert.deepEqual(b.store.data().materials, [], "reloaded from the new round");
  assert.equal((await saved(b.store.run("saveMaterial", { code: "M-3", name: "สาม", active: true }))).ok, true);
  const audit = unwrap(await s.mock.client.rpc("app_rf_audit", {}));
  assert.ok(audit.some((row) => row.action === "ล้างข้อมูล RubberFlow ทดสอบ"), "the purge itself is audited, the trail is kept");
  assert.ok(audit.length >= 4);
  // ผู้ที่ไม่ใช่ admin ตัวจริงล้างไม่ได้ (ฐานข้อมูลตรวจเอง · mock ผูกกับผู้ใช้จำลองที่เป็น admin เสมอ จึงทดสอบทางปฏิเสธนอกโหมดทดสอบในเทสต์ถัดไป) store แปลง RF_FORBIDDEN เป็นประโยคไทย
  const noRight = storeApi.createStore({ seed: () => seed.buildSeed(NOW), actions: A, now: () => NOW, persona: () => storeApi.personaUser(s.rows["persona-pp"]), remote: { ...s.adapter, purge: async () => { throw Object.assign(new Error("RF_FORBIDDEN"), { code: "RF_FORBIDDEN" }); } } });
  await noRight.ensureLoaded();
  const rejected = await noRight.purge();
  assert.equal(rejected.ok, false);
  assert.match(rejected.error.message, /เฉพาะผู้ดูแลระบบ/);
  assert.equal(noRight.data().materials.length, 1, "nothing deleted");
});

test("the audit page reads app_rf_audit: the database's own line first (action and counts), the saver's text as a note", async () => {
  const s = await session();
  const rig = await s.make();
  await s.as("persona-rbh");
  await withApprovedRecipe(s, rig);
  await saved(rig.store.run("createOrder", ORDER));
  assert.equal(rig.store.audit().status, "idle");
  await rig.store.loadAudit(true);
  const view = rig.store.audit();
  assert.equal(view.status, "ready");
  const actions = view.entries.map((entry) => entry.action);
  assert.deepEqual(actions, ["createOrder", "approveRecipe", "createRecipe", "saveMaterial", "saveMaterial"], "newest first");
  assert.equal(view.entries[0].detail, "orders +1");
  assert.equal(view.entries[0].user, "ปกรณ์ ศรีวัฒนา");
  assert.match(view.entries[0].entries[0].detail, /WO-/);
  assert.deepEqual(rig.store.audit().entries.map((entry) => typeof entry.at), view.entries.map(() => "number"));
  const failedAudit = await s.make({ remote: { ...s.adapter, audit: async () => { throw Object.assign(new Error("boom"), { code: "XX" }); } } });
  await failedAudit.store.loadAudit(true);
  assert.equal(failedAudit.store.audit().status, "error");
  assert.match(failedAudit.store.audit().error.message, /โหลดบันทึกการใช้งานไม่สำเร็จ/);
  // นอกโหมดทดสอบ: ทุก RPC ปฏิเสธ
  const outside = createMockSupabase({ now: () => NOW });
  for (const name of ["app_rf_master", "app_rf_master_since", "app_rf_save", "app_rf_audit"]) {
    assert.equal((await outside.client.rpc(name, { p_version: 0, p_changes: {}, p_base_version: 0, p_action: "saveMaterial" })).error.code, "RF_TEST_MODE_ONLY", name);
  }
  assert.equal((await outside.client.rpc("app_sandbox_purge_rf")).error.message, "NOT_AUTHORIZED", "the purge asks for the real admin first, like the database");
});

test("database errors become short Thai messages and load failures wait for the user instead of looping", async () => {
  const e = (code) => storeApi.mapRemoteError(Object.assign(new Error(code), { code }));
  assert.equal(e("RF_STALE").code, "RF_STALE");
  assert.match(e("RF_FORBIDDEN").message, /ไม่มีสิทธิ์/);
  assert.match(e("RF_REVISION_IMMUTABLE").message, /revision ใหม่/);
  assert.match(e("RF_INVALID_SOURCE_JOB").message, /งาน BOM/);
  assert.match(e("RF_INVALID_RECIPE").message, /ไม่ผ่านการตรวจ.*RF_INVALID_RECIPE/);
  assert.match(e("RF_INVALID_MATERIAL").message, /รหัสใช้ได้เฉพาะตัวอักษรอังกฤษ/);
  assert.match(e("RF_REVISION_ORDER").message, /เรียงต่อจากล่าสุด/);
  assert.match(e("NOT_AUTHORIZED").message, /เฉพาะผู้ดูแลระบบ/, "purge refusals are Thai too");
  assert.match(e("SANDBOX_NOT_ACTIVE").message, /โหมดทดสอบ/);
  assert.equal(storeApi.mapRemoteError({ message: "SANDBOX_NOT_ACTIVE" }).code, "SANDBOX_NOT_ACTIVE");
  assert.match(storeApi.mapRemoteError({ code: "PGRST202", message: "function not found" }).message, /ยังไม่ได้ติดตั้ง migration/);
  assert.equal(storeApi.mapRemoteError({ message: "weird" }).code, "RF_REMOTE_FAILED");
  assert.doesNotMatch(storeApi.mapRemoteError({ message: "select * from secret" }).message, /select/);

  const s = await session();
  let calls = 0;
  const rig = await s.make({ remote: { ...s.adapter, load: async () => { calls += 1; throw Object.assign(new Error("PGRST202"), { code: "PGRST202" }); } } });
  assert.equal(rig.store.status(), "error");
  await rig.store.ensureLoaded();
  await rig.store.ensureLoaded();
  assert.equal(calls, 1, "no reload loop; the user presses retry");
  assert.equal(rig.store.run("saveMaterial", { code: "A", name: "a" }).ok, false);
  await rig.store.reload();
  assert.equal(calls, 2);
});

test("material and recipe actions validate their input and the demo mode keeps working without a database", () => {
  const d = seed.buildSeed(NOW);
  const ctx = { now: NOW, user: seed.USERS.find((row) => row.role === "planner") };
  assert.throws(() => A.saveMaterial(d, { code: "", name: "x" }, ctx), /รหัสวัตถุดิบ/);
  assert.throws(() => A.saveMaterial(d, { code: "A B", name: "x" }, ctx), /ไม่มีช่องว่าง/);
  assert.throws(() => A.saveMaterial(d, { code: "NEW", name: " " }, ctx), /ชื่อวัตถุดิบ/);
  for (const code of ["-LEAD", ".dot", "ก-1", "A/B", "A".repeat(41)]) assert.throws(() => A.saveMaterial(d, { code, name: "x" }, ctx), /รหัสวัตถุดิบใช้ได้เฉพาะตัวอักษรอังกฤษ/, code);
  assert.equal(A.saveMaterial(d, { code: "A".repeat(40), name: "ยาว 40" }, ctx), "A".repeat(40), "40 characters are allowed");
  for (const id of ["RC 1", "-RC", "รหัส", "R".repeat(61)]) assert.throws(() => A.createRecipe(d, { id, name: "n", productName: "p", batchKg: 1, dumpTemp: 1, mixSec: 1, yieldPerKg: 1, items: [{ materialCode: "EPDM-55", phr: 1 }] }, ctx), /รหัสสูตรใช้ได้เฉพาะตัวอักษรอังกฤษ/, id);
  assert.equal(A.saveMaterial(d, { code: "NEW-1", name: "วัตถุดิบใหม่", category: "ทดสอบ", active: "0" }, ctx), "NEW-1");
  assert.equal(d.materials.at(-1).active, false);
  assert.equal(A.saveMaterial(d, { code: "NEW-1", name: "ชื่อใหม่", active: "1" }, ctx), "NEW-1");
  assert.equal(d.materials.filter((row) => row.code === "NEW-1").length, 1, "same code = edit");
  assert.equal(d.materials.find((row) => row.code === "NEW-1").active, true);
  // สูตรสาธิต: ออก revision ใหม่ของสูตรที่อนุมัติแล้ว แล้วอนุมัติแทนของเดิม (ในเครื่องก็ใช้กฎเดียวกัน)
  const before = d.recipes.length;
  assert.equal(A.saveRecipe(d, { id: "RC-EPDM-DS01", name: "EPDM Rev ใหม่", productName: "ซีล", batchKg: 60, dumpTemp: 140, mixSec: 300, yieldPerKg: 6.1, items: [{ materialCode: "EPDM-55", phr: 100 }] }, ctx), 4);
  assert.equal(d.recipes.length, before + 1);
  assert.throws(() => A.createOrder(d, { recipeId: "RC-NR-AM01", customer: "x", targetQty: 1, startDate: NOW, dueDate: NOW }, ctx), /ยังไม่ได้รับอนุมัติ/);
  A.approveRecipe(d, { id: "RC-EPDM-DS01" }, ctx);
  assert.deepEqual(rules.revisionsOf(d.recipes, "RC-EPDM-DS01").map((row) => [row.revision, row.status]), [[4, "approved"], [3, "superseded"]]);
  assert.throws(() => A.saveRecipe(d, { id: "RC-NOPE", name: "x", productName: "y", batchKg: 1, dumpTemp: 1, mixSec: 1, yieldPerKg: 1, items: [{ materialCode: "A", phr: 1 }] }, ctx), /ไม่พบสูตร/);
  // ไม่มี remote = ไม่ตรวจสิทธิ์ในคำสั่ง และเลข WO ใช้ตัวนับในเครื่อง
  const planned = A.createOrder(d, { recipeId: "RC-EPDM-DS01", customer: "ลูกค้า", targetQty: 10, startDate: NOW, dueDate: NOW }, { now: NOW, user: seed.USERS.find((row) => row.role === "mixer") });
  assert.match(planned, /^WO-\d{8}-\d\d$/);
  assert.ok(d.counters[`WO-${rules.ymd(NOW)}`] >= 1);
  assert.equal(d.orders[0].recipeRevision, 4);
  // ใบที่มาจากงาน BOM ต้องมียอดผลิตก่อนปิด
  const linked = A.createOrder(d, { recipeId: "RC-EPDM-DS01", customer: "ลูกค้า", targetQty: 10, startDate: NOW, dueDate: NOW, sourceJobId: "JOB-1", uom: "pcs", targetKg: 12, kgPerUnit: 1.2 }, ctx);
  for (const status of ["released", "in_progress"]) A.setOrderStatus(d, { id: linked, status }, ctx);
  assert.throws(() => A.setOrderStatus(d, { id: linked, status: "completed" }, ctx), /ปริมาณผลิตจริง/);
  A.setOrderStatus(d, { id: linked, status: "completed", producedQty: "7.5" }, ctx);
  assert.equal(d.orders.find((row) => row.id === linked).producedQty, 7.5);
  assert.throws(() => A.setOrderStatus(d, { id: planned, status: "completed", producedQty: -1 }, ctx), /เปลี่ยนสถานะจาก/);
  // โหมดฐานข้อมูล: สิทธิ์ตรวจในคำสั่งด้วย (ผู้ใช้ไม่มี flags หรือไม่มีผู้ใช้ = ปฏิเสธ)
  assert.throws(() => A.saveMaterial(d, { code: "Z", name: "z" }, { now: NOW, user: null, remote: true }), /ไม่พบบัญชีผู้ใช้/);
  assert.throws(() => A.saveMaterial(d, { code: "Z", name: "z" }, { now: NOW, user: { name: "ดู", db: true }, remote: true }), /ไม่มีสิทธิ์/);
});

test("feedback adds the work order's own output to the job (not a job total), a link starts the job and the PI, and a raise after the close is not fed back again", async () => {
  const s = await session({ withBom: true });
  const rig = await s.make();
  await withApprovedRecipe(s, rig);
  const bom = () => s.call("app_bom_master");
  const jobOf = async (id) => (await bom()).jobs.find((row) => row.id === id);
  await s.as("persona-rb");
  assert.equal((await bom()).orders[0].status, "released");
  // JOB-RB4 had 30 reported before the link; no kilograms are required to link (the database records 0)
  const out = await saved(rig.store.run("createOrder", { ...ORDER, customerPo: "PI-R", sourceJobId: "JOB-RB4", uom: "pcs", targetQty: 70 }));
  let job = await jobOf("JOB-RB4");
  assert.equal(job.externalRef.woId, out.result);
  assert.equal(job.externalRef.kg, 0, "a link without kilograms records 0");
  assert.equal((await bom()).orders[0].status, "in_progress", "the PI starts when a job is linked");
  await saved(rig.store.run("createOrder", { ...ORDER, customerPo: "PI-R", sourceJobId: "JOB-RB3", uom: "pcs", targetQty: 100 }));
  assert.equal((await jobOf("JOB-RB3")).status, "in_progress", "a queued job starts when it is linked");

  await s.as("persona-rbh");
  const id = out.result;
  await saved(rig.store.run("setOrderStatus", { id, status: "released" }));
  await saved(rig.store.run("setOrderStatus", { id, status: "in_progress" }));
  const before = (await bom()).version;
  await saved(rig.store.run("setOrderStatus", { id, status: "completed", producedQty: 70 }));
  job = await jobOf("JOB-RB4");
  assert.deepEqual([job.qtyDone, job.status], [100, "done"], "30 reported before + 70 produced by the WO");
  assert.deepEqual(job.reports.map((row) => [row.good, row.note]), [[30, "กะเช้า"], [70, `จาก WO ${id}`]], "the report holds the WO's own output");
  assert.equal(typeof job.doneAt, "number");
  assert.equal((await bom()).version, before + 1);
  assert.ok((await s.call("app_bom_audit", {})).some((row) => row.action === "rubberflow:setOrderStatus" && row.detail === "jobs +1"), "the BOM history names RubberFlow");

  // ผลิตเกินหลังปิด: เพิ่มยอดของ WO ได้ แต่ไม่ป้อนกลับเข้างานอีก (ป้อนครั้งเดียวต่อ WO)
  const row = (await s.call("app_rf_master")).orders.find((order) => order.id === id);
  const raised = await s.mock.client.rpc("app_rf_save", { p_changes: { orders: { upsert: [{ ...row, producedQty: 90 }] } }, p_base_version: (await s.call("app_rf_master")).version, p_action: "setOrderStatus" });
  assert.equal(raised.data.changes.orders.upsert[0].producedQty, 90);
  job = await jobOf("JOB-RB4");
  assert.deepEqual([job.qtyDone, job.reports.length, (await bom()).version], [100, 2, before + 1], "the job is not fed a second time");
});

test("cancelling a linked WO clears the link and notes it on the job, the job takes a new WO, and cancelling an unlinked WO leaves BOM alone", async () => {
  const s = await session({ withBom: true });
  const rig = await s.make();
  await withApprovedRecipe(s, rig);
  await s.as("persona-rb");
  const first = await saved(rig.store.run("createOrder", { ...ORDER, customerPo: "PI-R", sourceJobId: "JOB-RB4", uom: "pcs", targetQty: 70, targetKg: 8, kgPerUnit: 0.1143 }));
  const before = await s.call("app_bom_master");
  const plain = await saved(rig.store.run("createOrder", ORDER));
  await saved(rig.store.run("setOrderStatus", { id: plain.result, status: "cancelled" }));
  assert.equal((await s.call("app_bom_master")).version, before.version, "cancelling an unlinked WO does not touch BOM");

  await saved(rig.store.run("setOrderStatus", { id: first.result, status: "cancelled" }));
  const after = await s.call("app_bom_master");
  const job = after.jobs.find((row) => row.id === "JOB-RB4");
  assert.equal(job.externalRef, null, "the link is cleared by the server in the same save");
  assert.deepEqual([job.qtyDone, job.status], [30, "in_progress"], "the reported quantity and the status stay");
  assert.deepEqual(job.reports.map((row) => [row.good, row.reject, row.note]), [[30, 0, "กะเช้า"], [0, 0, `WO ${first.result} ถูกยกเลิก`]], "a system note is appended");
  assert.equal(job.reports[1].by, "ประยุทธ รีดยาง", "stamped by the server with the persona");
  assert.equal(after.version, before.version + 1, "the BOM counter moved once");
  assert.deepEqual((await s.call("app_bom_master_since", { p_version: before.version })).changes.jobs.upsert.map((row) => row.id), ["JOB-RB4"], "BOM clients catch the unlink up");
  assert.ok((await s.call("app_bom_audit", {})).some((entry) => entry.action === "rubberflow:setOrderStatus" && entry.detail === "jobs +1"));
  assert.equal(rig.store.data().orders.find((order) => order.id === first.result).sourceJobId, "JOB-RB4", "the cancelled WO keeps its history");

  // ผูกใหม่ได้ (WO ที่ยกเลิกแล้วไม่กันงานนี้) และยอดเดิมคงอยู่
  const again = await saved(rig.store.run("createOrder", { ...ORDER, customerPo: "PI-R", sourceJobId: "JOB-RB4", uom: "pcs", targetQty: 70 }));
  const relinked = (await s.call("app_bom_master")).jobs.find((row) => row.id === "JOB-RB4");
  assert.equal(relinked.externalRef.woId, again.result);
  assert.equal(relinked.qtyDone, 30);
  // ยังผูกอยู่กับ WO ที่ไม่ยกเลิก: ผูกอีกใบไม่ได้
  assert.equal((await rig.store.run("createOrder", { ...ORDER, customerPo: "PI-R", sourceJobId: "JOB-RB4", uom: "pcs", targetQty: 70 }).saving).error.code, "RF_INVALID_SOURCE_JOB");
});

test("QA raises a work order's produced quantity only through addQcRecord (also after the close) and the database refuses everything else", async () => {
  const s = await session({ withBom: true });
  const rig = await s.make();
  await withApprovedRecipe(s, rig);
  await s.as("persona-rb");
  const linked = (await saved(rig.store.run("createOrder", { ...ORDER, customerPo: "PI-R", sourceJobId: "JOB-RB3", uom: "pcs", targetQty: 100 }))).result;
  const running = (await saved(rig.store.run("createOrder", ORDER))).result;
  const idle = (await saved(rig.store.run("createOrder", ORDER))).result;
  await s.as("persona-rbh");
  for (const id of [linked, running]) {
    await saved(rig.store.run("setOrderStatus", { id, status: "released" }));
    await saved(rig.store.run("setOrderStatus", { id, status: "in_progress" }));
  }
  await saved(rig.store.run("setOrderStatus", { id: linked, status: "completed", producedQty: 40 }));

  await s.as("persona-qa");
  const master = () => s.call("app_rf_master");
  const row = async (id) => (await master()).orders.find((order) => order.id === id);
  const save = async (changes, action = "addQcRecord") => s.mock.client.rpc("app_rf_save", { p_changes: changes, p_base_version: (await master()).version, p_action: action });
  const order = async (record, action) => save({ orders: { upsert: [record] } }, action);
  const w = await row(running);
  const c = await row(linked);
  assert.equal((await order({ ...w, producedQty: 20 }, "setOrderStatus")).error.code, "RF_FORBIDDEN", "any other action is refused");
  assert.equal((await order({ ...w, producedQty: 20, note: "แก้" })).error.code, "RF_FORBIDDEN", "only the produced quantity may differ");
  assert.equal((await order({ ...w, producedQty: 20, status: "on_hold" })).error.code, "RF_FORBIDDEN", "no status change");
  assert.equal((await order({ ...c, producedQty: 10 })).error.code, "RF_FORBIDDEN", "never lower");
  assert.equal((await order({ ...w, id: "WO-NEW-01", status: "planned", producedQty: 0 })).error.code, "RF_FORBIDDEN", "no new order");
  assert.equal((await save({ materials: { upsert: [{ code: "QA-M", name: "x", active: true }] } })).error.code, "RF_FORBIDDEN", "no material");
  assert.equal((await save({ recipes: { upsert: [{ ...(await master()).recipes[0], name: "แก้" }] } })).error.code, "RF_FORBIDDEN", "no recipe");
  assert.equal((await order({ ...(await row(idle)), producedQty: 5 })).error.code, "RF_INVALID_ORDER", "a work order that is not released yet cannot report production");

  const bomBefore = (await s.call("app_bom_master")).version;
  assert.equal((await order({ ...w, producedQty: 20 })).data.changes.orders.upsert[0].producedQty, 20, "QA tops up a work order in progress");
  const late = (await order({ ...c, producedQty: 55 })).data.changes.orders.upsert[0];
  assert.deepEqual([late.status, late.producedQty], ["completed", 55], "and a closed one (late release)");
  assert.equal((await s.call("app_bom_master")).version, bomBefore, "the BOM job is not fed again");
  assert.equal((await s.call("app_bom_master")).jobs.find((job) => job.id === "JOB-RB3").qtyDone, 40);
  assert.equal((await s.mock.client.rpc("app_rf_save", { p_changes: {}, p_base_version: (await master()).version, p_action: "dropTables" })).error.code, "RF_INVALID_ACTION");
});

test("a QA user's finishing release tops up the order through the addQcRecord action and never closes an order; an RB head's closes it", async () => {
  const s = await session();
  const local = memoryStorage();
  const setup = await s.make({ local });
  await withApprovedRecipe(s, setup);
  const open = async (target) => {
    await s.as("persona-rb");
    const id = (await saved(setup.store.run("createOrder", { ...ORDER, targetQty: target }))).result;
    await s.as("persona-rbh");
    await saved(setup.store.run("setOrderStatus", { id, status: "released" }));
    await saved(setup.store.run("setOrderStatus", { id, status: "in_progress" }));
    return id;
  };
  const small = await open(15);
  const big = await open(100);
  const tiny = await open(10);
  // ล็อตตกแต่งที่ถูกกักกัน (ส่วนในเครื่อง) ของใบสามใบ
  const lotOf = (lotId, orderId) => ({ id: lotId, stage: "finishing", orderId, uom: "m", qc: "hold", holdReasons: ["รอตัดสิน"], goodQty: 20, scrapQty: 0, transferredQty: 0, countedToOrder: false, createdAt: NOW });
  const addLots = (...lots) => {
    const file = JSON.parse(local.map.get(storeApi.LOCAL_KEY));
    file.lots.push(...lots);
    local.setItem(storeApi.LOCAL_KEY, JSON.stringify(file));
  };
  addLots(lotOf("FN-T-01", small), lotOf("FN-T-02", big), lotOf("FN-T-05", tiny));
  const seen = [];
  const remote = { ...s.adapter, save: (changes, baseVersion, action, audit, epoch) => { seen.push(action); return s.adapter.save(changes, baseVersion, action, audit, epoch); } };
  const orderOf = async (id) => unwrap(await s.mock.client.rpc("app_rf_master")).orders.find((order) => order.id === id);
  const qa = await s.make({ local, remote });
  await s.as("persona-qa");
  const pass = { values: { hardness: 65 }, result: "pass" };
  await saved(qa.store.run("addQcRecord", { lotId: "FN-T-02", ...pass }));
  assert.deepEqual(seen, ["addQcRecord"], "the action name goes to the database as it is (the database allows QA only through it)");
  assert.equal((await orderOf(big)).producedQty, 20);
  // ครบเป้า (20 >= 15) แต่ QA ปิดใบเองไม่ได้ → ใบยังกำลังผลิต
  await saved(qa.store.run("addQcRecord", { lotId: "FN-T-01", ...pass }));
  const topped = await orderOf(small);
  assert.deepEqual([topped.producedQty, topped.status], [20, "in_progress"], "QA adds the quantity but leaves the closing to the RB team");
  // RB ปิดใบ แล้ว QA ยังเพิ่มยอดของล็อตที่ปล่อยช้าได้
  await s.as("persona-rb");
  await saved(qa.store.run("setOrderStatus", { id: small, status: "completed" }));
  addLots(lotOf("FN-T-03", small));
  const late = await s.make({ local, remote });
  await s.as("persona-qa");
  await saved(late.store.run("addQcRecord", { lotId: "FN-T-03", ...pass }));
  const lateRow = await orderOf(small);
  assert.deepEqual([lateRow.status, lateRow.producedQty], ["completed", 40], "a closed order accepts the late lot");
  // ใบที่ยังไม่ปล่อยผลิตรับยอดไม่ได้ (ข้อความไทยก่อนส่ง)
  await s.as("persona-rb");
  const planned = (await saved(late.store.run("createOrder", ORDER))).result;
  addLots(lotOf("FN-T-04", planned));
  const guarded = await s.make({ local, remote });
  await s.as("persona-qa");
  assert.match(guarded.store.run("addQcRecord", { lotId: "FN-T-04", ...pass }).error.message, /ยังไม่ได้ปล่อยผลิต/);
  // หัวหน้า RB ปล่อยล็อตของใบที่ครบเป้า → ใบปิดเอง
  const rb = await s.make({ local, remote });
  await s.as("persona-rbh");
  await saved(rb.store.run("addQcRecord", { lotId: "FN-T-05", ...pass }));
  assert.equal((await orderOf(tiny)).status, "completed", "the RB side closes it when the target is reached");
});

test("saving what is already stored changes nothing (no version, no audit), and catching up before numbering avoids a duplicate WO number", async () => {
  const s = await session();
  const state = { holding: false };
  const a = await s.make();
  const b = await s.make({ shouldHold: () => state.holding });
  await withApprovedRecipe(s, a);
  const snapshot = await s.call("app_rf_master");
  const rpc = (changes, version, action = "saveMaterial") => s.mock.client.rpc("app_rf_save", { p_changes: changes, p_base_version: version, p_action: action });
  const auditBefore = (await s.call("app_rf_audit", {})).length;
  const same = await rpc({ materials: { upsert: snapshot.materials }, recipes: { upsert: snapshot.recipes } }, snapshot.version);
  assert.equal(same.data.version, snapshot.version, "the version did not move");
  assert.equal((await s.call("app_rf_audit", {})).length, auditBefore, "and no audit row was written");
  const oldBase = await rpc({ materials: { upsert: snapshot.materials } }, 0);
  assert.equal(oldBase.data.version, snapshot.version);
  assert.equal(oldBase.data.changes.materials.upsert.length, 2, "from an old base it still answers with the delta since that base");
  assert.equal((await rpc({ materials: { upsert: [{ ...snapshot.materials[0], name: "เปลี่ยนชื่อ" }] } }, snapshot.version)).data.version, snapshot.version + 1, "a real change still moves it");
  assert.equal((await rpc({ materials: { delete: [{ code: "EPDM-55" }] } }, snapshot.version + 1)).error.code, "RF_INVALID_PAYLOAD", "no deletes");
  assert.equal((await rpc({ materials: { upsert: [{ code: "bad code!", name: "x" }] } }, snapshot.version + 1)).error.code, "RF_INVALID_MATERIAL");
  assert.equal((await rpc({ recipes: { upsert: [{ ...snapshot.recipes[0], revision: 5, status: "draft" }] } }, snapshot.version + 1)).error.code, "RF_REVISION_ORDER");

  // เครื่อง A เปิดใบ 01 · เครื่อง B ตามทันก่อนออกเลข (เหมือนปุ่ม "สร้าง WO" ของ BOM) จึงได้ 02 ทันทีโดยไม่ชน
  await s.as("persona-pp");
  const one = await saved(a.store.run("createOrder", ORDER));
  assert.equal(one.result, `WO-${rules.ymd(NOW)}-01`);
  assert.equal(await b.store.catchUp(), true);
  const two = await saved(b.store.run("createOrder", ORDER));
  assert.equal(two.result, `WO-${rules.ymd(NOW)}-02`, "the number is fresh");
  // ไม่ตามทัน แล้วเลขซ้ำ → RF_STALE · store ไม่ถูก hold (เช่นอยู่หน้า BOM) ตามทันเองแล้วลองใหม่ได้เลขใหม่
  const dup = a.store.run("createOrder", { ...ORDER, customer: "อีกคน" }); // เนื้อหาต่างกัน (ใบที่เหมือนกันทุกช่องฐานข้อมูลถือว่าเขียนซ้ำค่าเดิม)
  assert.equal(dup.result, `WO-${rules.ymd(NOW)}-02`, "A does not know about 02 yet");
  assert.equal((await dup.saving).error.code, "RF_STALE");
  assert.equal(a.store.data().orders.length, 2, "A caught up by itself");
  assert.equal((await saved(a.store.run("createOrder", { ...ORDER, customer: "อีกคน" }))).result, `WO-${rules.ymd(NOW)}-03`);
  // มี dialog ของ RubberFlow เปิดอยู่ (hold) store ไม่รวมข้อมูลของผู้อื่นเอง · ปิดแล้วตามทันได้และออกเลขใหม่
  state.holding = true;
  const held = b.store.run("createOrder", { ...ORDER, customer: "คนที่สาม" });
  assert.equal(held.result, `WO-${rules.ymd(NOW)}-03`);
  assert.equal((await held.saving).error.code, "RF_STALE");
  assert.equal(b.store.hasNewer(), true);
  assert.equal(b.store.data().orders.length, 2, "not merged under the open form");
  state.holding = false;
  assert.equal(await b.store.catchUp(), true);
  assert.equal((await saved(b.store.run("createOrder", ORDER))).result, `WO-${rules.ymd(NOW)}-04`);
});
