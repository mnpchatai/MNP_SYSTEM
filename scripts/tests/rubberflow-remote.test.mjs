import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// โหมดฐานข้อมูลของ RubberFlow (ข้อมูลทั้ง 11 ชุด: วัตถุดิบ สูตรยางทุก revision ใบสั่งผลิต WO ล็อตวัตถุดิบ ใบเบิก ล็อตผลิต ใบส่งมอบ กล่อง QC NCR แม่พิมพ์ อยู่ใน Supabase ผ่าน app_rf_master / app_rf_save):
// store แบบ remote ใน modules/rubberflow-store.js ทดสอบกับ Supabase จำลองของ harness (scripts/pilot-harness-mock.mjs ที่บังคับสัญญา RPC เดียวกับฐานข้อมูลจริง)
// กฎสิทธิ์ที่ยืนยัน: ผู้วางแผนหรือสมาชิก RB แก้วัตถุดิบ/ร่างสูตร/เปิด WO ได้ · หัวหน้า RB อนุมัติสูตรและปล่อยผลิต · สูตรที่อนุมัติแล้วแก้ไม่ได้ (ออก revision ใหม่) ·
// WO ที่มาจากงาน RB ของ BOM ผูกงานในคำสั่งเดียวกัน และเมื่อ SR รับมอบใบส่งมอบ ยอดที่รับถูกรายงานเข้างานทีละใบส่งมอบ
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
      persona: () => storeApi.personaUser(rows[who.id]), shouldHold: options.shouldHold,
    });
    const events = [];
    store.subscribe((event) => events.push(event));
    await store.ensureLoaded();
    return { store, local, events };
  };
  return { mock, storage, adapter, as, make, call, rows };
}

const RECIPE = { id: "RC-TEST-01", productCode: "P-TEST", uom: "m", batchKg: 50, dumpTol: 5, yieldPerKg: 6, stages: [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }], items: [{ materialCode: "EPDM-55", phr: 100, stage: 1 }, { materialCode: "CB-N550", phr: 60, stage: 2 }] };
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
  assert.equal(storeApi.can(rbStaff, "demoSkip"), true, "the time skip is an explicit RB action on the database (the server stamps the time)");
  assert.equal(storeApi.can(storeApi.personaUser(employee("staff", "ST")), "demoSkip"), false);
  assert.equal(storeApi.can({ role: "mixer" }, "demoSkip"), true, "the in-browser demo keeps it");
  // สิทธิ์ของปุ่มหน้างาน (ฐานข้อมูลตัดสินจริง): ST รับวัตถุดิบ · ST/QA กักกันล็อต · RB เบิก-ชั่ง-ผลิต-ส่งมอบ · SR รับมอบ · WH ส่งกล่อง · QA ผลตรวจ/NCR · RB กรอกการแก้ไข NCR · RB แม่พิมพ์ · กลุ่มวางแผนทุกอย่าง
  const who = Object.fromEntries([["rb", "RB"], ["st", "ST"], ["sr", "SR"], ["wh", "WH"], ["qa", "QA"], ["pp", "PP"], ["mt", "MT"]].map(([key, dept]) => [key, storeApi.personaUser(employee("staff", dept))]));
  const matrix = { receiveMaterial: ["st", "pp"], holdMaterial: ["st", "qa", "pp"], requisition: ["rb", "pp"], station: ["rb", "pp"], sendTransfer: ["rb", "pp"], receiveTransfer: ["sr", "pp"], shipBoxes: ["wh", "pp"], qcDecision: ["qa", "pp"], fillNcr: ["qa", "rb", "pp"], editMold: ["rb", "pp"] };
  for (const [permission, allowed] of Object.entries(matrix)) {
    for (const key of Object.keys(who)) assert.equal(storeApi.can(who[key], permission), allowed.includes(key), `${permission} for ${key}`);
  }
  assert.deepEqual([who.st.st, who.sr.sr, who.wh.wh, who.qa.qa, who.rb.st], [true, true, true, true, false]);
  assert.equal(storeApi.can({ role: "viewer" }, "receiveMaterial"), true, "the demo mode does not restrict these buttons");
  assert.equal(storeApi.can({ role: "viewer" }, "holdMaterial"), false, "...except the ones the demo always restricted");
  assert.equal(storeApi.rightForAction("receiveTransfer"), "receiveTransfer");
  assert.equal(storeApi.rightForDialog("transfer"), "sendTransfer");
  assert.equal(storeApi.rightForDialog("scan"), null, "dialogs that read only are never restricted");
  assert.ok(storeApi.ROLES.warehouse);
  assert.equal(storeApi.personaUser(employee("staff", "WH")).role, "warehouse");
  assert.ok(storeApi.canSee(who.wh, "warehouse") && !storeApi.canSee(who.wh, "mixing"));
  assert.ok(storeApi.canSee(who.rb, "quality"), "RB reads the NCR page to fill corrective / preventive");
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

test("recipes are two-stage: both stages are required, each line has stage 1 or 2, and the database stores them in order", async () => {
  const s = await session();
  const rig = await s.make();
  await s.as("persona-rb");
  await withMaterials(s, rig);
  await s.as("persona-rb");
  const direct = async (over) => {
    const snapshot = unwrap(await s.mock.client.rpc("app_rf_master"));
    return s.mock.client.rpc("app_rf_save", { p_changes: { recipes: { upsert: [{ ...RECIPE, revision: 1, status: "draft", ...over }] } }, p_base_version: snapshot.version, p_action: "createRecipe" });
  };
  const [one, two] = RECIPE.stages;
  assert.equal((await direct({ stages: undefined })).error.code, "RF_INVALID_RECIPE", "stages are required");
  assert.equal((await direct({ stages: [one] })).error.code, "RF_INVALID_RECIPE", "one stage only");
  assert.equal((await direct({ stages: [one, { ...one }] })).error.code, "RF_INVALID_RECIPE", "stage 1 twice");
  assert.equal((await direct({ stages: [one, { ...two, mixMin: 0 }] })).error.code, "RF_INVALID_RECIPE", "zero minutes");
  assert.equal((await direct({ stages: [one, { ...two, dumpTemp: 1001 }] })).error.code, "RF_INVALID_RECIPE", "temperature above 1000");
  assert.equal((await direct({ stages: [one, { stage: 2, mixerTemp: 90, dumpTemp: 130 }] })).error.code, "RF_INVALID_RECIPE", "a stage without minutes");
  assert.equal((await direct({ items: [{ materialCode: "EPDM-55", phr: 100, stage: 3 }] })).error.code, "RF_INVALID_RECIPE", "stage 3 on a line");
  // รหัสสินค้าไม่บังคับ (ไม่ใช้รหัสสูตรแทน) · บรรทัดไม่ระบุขั้น = ขั้น 1 · stages เรียงขั้น 1, 2
  const saved1 = await direct({ productCode: undefined, stages: [two, one], items: [{ materialCode: "EPDM-55", phr: 100 }, { materialCode: "CB-N550", phr: 60, stage: 2 }] });
  assert.ok(!saved1.error, "a recipe without a product code and with unordered stages is accepted");
  const stored = unwrap(await s.mock.client.rpc("app_rf_master")).recipes[0];
  assert.equal(stored.productCode, "");
  assert.deepEqual(stored.stages.map((row) => row.stage), [1, 2]);
  assert.deepEqual(stored.items.map((row) => row.stage), [1, 2]);
  assert.ok(!("name" in stored) && !("productName" in stored) && !("mixSec" in stored) && !("dumpTemp" in stored));
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
  const edit = await saved(rig.store.run("saveRecipe", { ...RECIPE, productCode: "P-TEST-2", items: [{ materialCode: "EPDM-55", phr: 100, stage: 1 }, { materialCode: "CB-N550", phr: 70, stage: 2 }] }));
  assert.equal(edit.result, 2, "the new revision number");
  const rows = rules.revisionsOf(rig.store.data().recipes, "RC-TEST-01");
  assert.deepEqual(rows.map((row) => [row.revision, row.status]), [[2, "draft"], [1, "approved"]]);
  assert.equal(rows[1].productCode, "P-TEST", "revision 1 is untouched");
  assert.equal(rules.currentRecipe(rig.store.data().recipes, "RC-TEST-01").revision, 1, "the approved revision stays the working one");
  assert.deepEqual(rules.approvedRecipes(rig.store.data().recipes).map((row) => row.revision), [1]);
  assert.equal(rules.currentRecipes(rig.store.data().recipes).length, 1, "one row per recipe code");
  // แก้ร่างซ้ำ = แก้ร่างเดิม ไม่ออก revision 3
  const again = await saved(rig.store.run("saveRecipe", { ...RECIPE, productCode: "P-TEST-3" }));
  assert.equal(again.result, 2);
  assert.equal(rules.revisionsOf(rig.store.data().recipes, "RC-TEST-01").length, 2);
  // ฐานข้อมูลปฏิเสธการแก้ revision ที่อนุมัติแล้วตรงๆ
  const snapshot = unwrap(await s.mock.client.rpc("app_rf_master"));
  const direct = await s.mock.client.rpc("app_rf_save", { p_changes: { recipes: { upsert: [{ ...snapshot.recipes[0], stages: [snapshot.recipes[0].stages[0], { ...snapshot.recipes[0].stages[1], dumpTemp: 150 }] }] } }, p_base_version: snapshot.version, p_action: "saveRecipe" });
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
  // ปิดใบ: ยอดผลิตมาจากล็อตตกแต่งที่นับแล้ว ฐานข้อมูลคำนวณเอง ไม่รับค่าจากฟอร์ม
  await saved(a.store.run("setOrderStatus", { id, status: "completed", producedQty: "80" }));
  const closed = a.store.data().orders.find((order) => order.id === id);
  assert.equal(closed.status, "completed");
  assert.equal(closed.producedQty, 0, "the produced quantity of the form is not used on the database");
  assert.equal(typeof closed.completedAt, "number");
  assert.match(a.store.run("setOrderStatus", { id, status: "cancelled" }).error.message, /เปลี่ยนสถานะจาก completed/);
  // ยอดผลิตที่ client ส่งมาตรงๆ ถูกเมิน: ไม่เพิ่มเวอร์ชัน ไม่เปลี่ยนค่า (ยอดมาจากล็อตตกแต่งเท่านั้น)
  const closedRow = unwrap(await s.mock.client.rpc("app_rf_master")).orders.find((order) => order.id === id);
  const version = () => s.call("app_rf_master").then((master) => master.version);
  const before = await version();
  const ignored = await s.mock.client.rpc("app_rf_save", { p_changes: { orders: { upsert: [{ ...closedRow, producedQty: 85 }] } }, p_base_version: before, p_action: "setOrderStatus" });
  assert.equal(ignored.data.version, before, "a produced quantity sent by a client changes nothing");
  assert.equal((await s.call("app_rf_master")).orders.find((order) => order.id === id).producedQty, 0);
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

  // ปิด WO ที่ผูกงาน BOM: ไม่ต้องมียอดผลิต และไม่ส่งยอดเข้างาน (ยอดเข้างานเกิดตอน SR รับมอบใบส่งมอบ ดูเทสต์ transfer ด้านล่าง)
  await s.as("persona-rbh");
  await saved(rig.store.run("setOrderStatus", { id: out.result, status: "released" }));
  await saved(rig.store.run("setOrderStatus", { id: out.result, status: "in_progress" }));
  const bomBefore = await s.call("app_bom_master");
  await saved(rig.store.run("setOrderStatus", { id: out.result, status: "completed" }));
  assert.equal(rig.store.data().orders.find((row) => row.id === out.result).status, "completed", "no produced quantity is needed to close a linked WO");
  const after = await s.call("app_bom_master");
  assert.equal(after.version, bomBefore.version, "closing the WO does not touch the job");
  const job1 = after.jobs.find((row) => row.id === "JOB-RB1");
  assert.deepEqual([job1.qtyDone, job1.reports.length, job1.externalRef.woId], [0, 0, out.result]);
  // กำลังผลิตอยู่ ใบ PI เริ่มผลิตตั้งแต่ผูกงาน (งาน queued → in_progress) ไม่ใช่ตอนปิด
  assert.equal(after.orders.find((row) => row.id === "PI-R").status, "in_progress");
});

test("nothing of RubberFlow's business data stays in the browser: the old local file is neither read nor changed, and a refused save reverts the whole action", async () => {
  const s = await session();
  const local = memoryStorage();
  // ไฟล์ส่วนในเครื่องของรุ่นก่อน (ล็อต ใบเบิก แม่พิมพ์) ไม่ถูกอ่าน ไม่ถูกแก้ ไม่ถูกลบ และไม่โผล่ในหน้า
  local.setItem(storeApi.LOCAL_KEY, JSON.stringify({ counters: { "RM-X": 3 }, materialLots: [{ lotNo: "OLD-LOT" }], requisitions: [], lots: [], transfers: [], fgBoxes: [], qcRecords: [], ncrs: [], molds: [{ id: "OLD-MOLD", name: "เก่า" }] }));
  const oldFile = local.map.get(storeApi.LOCAL_KEY);
  const rig = await s.make({ local });
  await s.as("persona-rbh");
  assert.deepEqual(rig.store.data().molds, [], "the database starts empty: the old tools are not shown");
  assert.deepEqual(rig.store.data().materialLots, []);
  assert.equal(rig.store.data().users.length, 0, "no demo roles in database mode");
  assert.equal(rig.store.user().rbHead, true);
  await withMaterials(s, rig);
  // รับวัตถุดิบเข้าคลังเป็นการบันทึกลงฐานข้อมูล ไม่ใช่ในเครื่อง
  await s.as("persona-st");
  const before = unwrap(await s.mock.client.rpc("app_rf_master")).version;
  const lot = await saved(rig.store.run("receiveMaterial", { materialCode: "EPDM-55", qtyKg: 100, expiry: NOW + 90 * DAY, supplier: "ผู้ขาย", coa: true }));
  assert.match(lot.result, /^RM-EPDM-55-\d{8}-01$/);
  assert.equal(unwrap(await s.mock.client.rpc("app_rf_master")).version, before + 1, "one save call");
  assert.equal(unwrap(await s.mock.client.rpc("app_rf_master")).materialLots[0].receivedBy, "วิชัย คลังวัตถุดิบ", "the database stamps the receiver");
  assert.equal(local.map.get(storeApi.LOCAL_KEY), oldFile, "the old local file is untouched");
  assert.equal(local.map.has(storeApi.STATE_KEY), false, "the demo state key is not used in database mode");
  assert.deepEqual(rig.store.data().counters, {}, "document numbers come from the database snapshot, not from counters");
  assert.equal(rig.store.isPersisted(), true);
  // เลิกใช้วัตถุดิบ: รับเข้าคลังไม่ได้อีก
  await s.as("persona-rbh");
  await saved(rig.store.run("saveMaterial", { code: "EPDM-55", name: "ยาง EPDM", category: "โพลิเมอร์", storage: "A-1", active: "0" }));
  assert.equal(rig.store.data().materials.find((row) => row.code === "EPDM-55").active, false);
  await s.as("persona-st");
  assert.match(rig.store.run("receiveMaterial", { materialCode: "EPDM-55", qtyKg: 1, expiry: NOW + DAY }).error.message, /เลิกใช้แล้ว/);

  // คำสั่งที่แตะหลายชุดแล้วฐานข้อมูลไม่รับ → ย้อนกลับทั้งหมด (ข้อมูล เลขเอกสาร)
  const both = {
    ...A,
    both(d, p, ctx) {
      d.materials.push({ code: "NEW-1", name: "ใหม่", active: true });
      d.molds.push({ id: "NEW-MOLD", name: "ใหม่", kind: "die", unit: "m", perCycle: 1, cleanEvery: 1, pmLimit: 1, usageSinceClean: 0, totalUsage: 0, lastCleanAt: ctx.now });
      d.counters.X = (d.counters.X ?? 0) + 1;
      d.audit.unshift({ at: ctx.now, user: "x", action: "ทดสอบ", detail: "หลายชุด" });
    },
  };
  const failing = { store: storeApi.createStore({ storage: local, seed: () => seed.buildSeed(NOW), actions: both, now: () => NOW, persona: () => storeApi.personaUser(s.rows["persona-rbh"]), remote: { ...s.adapter, save: async () => { throw Object.assign(new Error("RF_FORBIDDEN"), { code: "RF_FORBIDDEN" }); } } }) };
  await failing.store.ensureLoaded();
  const result = failing.store.run("both", {});
  assert.equal(result.ok, true);
  assert.equal(failing.store.data().molds.length, 1, "optimistic: shown at once");
  const outcome = await result.saving;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, "RF_FORBIDDEN");
  assert.deepEqual([failing.store.data().molds.length, failing.store.data().counters.X, failing.store.data().materials.some((row) => row.code === "NEW-1")], [0, undefined, false], "reverted with the refused save");
  assert.equal(local.map.get(storeApi.LOCAL_KEY), oldFile, "still nothing written to the browser");
  // เปิดหน้าใหม่: ข้อมูลเดียวกันจากฐานข้อมูล
  const reopened = await s.make({ local });
  assert.equal(reopened.store.data().materialLots.length, 1);
  assert.equal(reopened.store.data().materials.length, 2);
});

test("catching up merges other users' saves, a form that is open holds them back, and purge clears the whole database for the admin only", async () => {
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
  await s.as("persona-1");
  await saved(a.store.run("receiveMaterial", { materialCode: "M-1", qtyKg: 5, expiry: NOW + DAY }) );
  assert.equal(a.store.data().materialLots.length, 1);
  const purged = await a.store.purge();
  assert.equal(purged.ok, true);
  assert.equal(purged.deleted, 3, "two materials and the received lot");
  assert.deepEqual(a.store.data().materials, []);
  assert.equal(a.store.data().materialLots.length, 0, "the lots of the database go too");
  assert.deepEqual(a.store.data().molds, [], "and nothing is seeded again: the database starts empty");
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
  assert.match(e("RF_INSUFFICIENT_STOCK").message, /FEFO/);
  assert.equal(e("RF_INSUFFICIENT_STOCK").code, "RF_INSUFFICIENT_STOCK");
  assert.match(e("RF_OUT_OF_TOLERANCE").message, /นอกเกณฑ์/);
  assert.match(e("RF_INVALID_TRANSFER").message, /ใบส่งมอบ/);
  assert.match(e("RF_INVALID_NCR").message, /การป้องกัน/);
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
  for (const id of ["RC 1", "-RC", "รหัส", "R".repeat(61)]) assert.throws(() => A.createRecipe(d, { ...RECIPE, id }, ctx), /รหัสสูตรใช้ได้เฉพาะตัวอักษรอังกฤษ/, id);
  assert.equal(A.saveMaterial(d, { code: "NEW-1", name: "วัตถุดิบใหม่", category: "ทดสอบ", active: "0" }, ctx), "NEW-1");
  assert.equal(d.materials.at(-1).active, false);
  assert.equal(A.saveMaterial(d, { code: "NEW-1", name: "ชื่อใหม่", active: "1" }, ctx), "NEW-1");
  assert.equal(d.materials.filter((row) => row.code === "NEW-1").length, 1, "same code = edit");
  assert.equal(d.materials.find((row) => row.code === "NEW-1").active, true);
  // สูตรสาธิต: ออก revision ใหม่ของสูตรที่อนุมัติแล้ว แล้วอนุมัติแทนของเดิม (ในเครื่องก็ใช้กฎเดียวกัน)
  const before = d.recipes.length;
  assert.equal(A.saveRecipe(d, { ...RECIPE, id: "RC-EPDM-DS01", batchKg: 60, yieldPerKg: 6.1, items: [{ materialCode: "EPDM-55", phr: 100 }] }, ctx), 4);
  assert.equal(d.recipes.length, before + 1);
  assert.throws(() => A.createOrder(d, { recipeId: "RC-NR-AM01", customer: "x", targetQty: 1, startDate: NOW, dueDate: NOW }, ctx), /ยังไม่ได้รับอนุมัติ/);
  A.approveRecipe(d, { id: "RC-EPDM-DS01" }, ctx);
  assert.deepEqual(rules.revisionsOf(d.recipes, "RC-EPDM-DS01").map((row) => [row.revision, row.status]), [[4, "approved"], [3, "superseded"]]);
  assert.throws(() => A.saveRecipe(d, { ...RECIPE, id: "RC-NOPE" }, ctx), /ไม่พบสูตร/);
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

// ---------- ชุดหน้างาน: ล็อตวัตถุดิบ ใบเบิก ล็อตผลิต ใบส่งมอบ กล่อง QC NCR แม่พิมพ์ ----------
const TODAY = rules.ymd(NOW);
const STAGES2 = [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }];
const JSONCLONE = (value) => JSON.parse(JSON.stringify(value));
const KEY = { recipes: (row) => `${row.id}|${row.revision}`, materials: (row) => row.code, materialLots: (row) => row.lotNo };
// ข้อมูลที่หน้าเห็นต้องเท่ากับของฐานข้อมูลทุกชุด (สำเนาที่ action คำนวณเองตรงกับที่ฐานข้อมูลคำนวณ)
async function inSync(s, rig, label) {
  const snapshot = await s.call("app_rf_master");
  for (const list of storeApi.REMOTE_LISTS) {
    const key = KEY[list] ?? ((row) => row.id);
    const order = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    assert.deepEqual(JSONCLONE([...rig.store.data()[list]].sort(order)), JSONCLONE([...snapshot[list]].sort(order)), `${label}: ${list} on the page equals the database`);
  }
}
// เตรียม: วัตถุดิบ สูตรอนุมัติ WO ที่ปล่อยผลิต แม่พิมพ์ และล็อตวัตถุดิบ 2 ล็อตของ EPDM (ล็อต -01 หมดอายุช้ากว่า -02) กับ CB 1 ล็อต
async function prepare(s, rig, { linked = false, target = 90 } = {}) {
  await s.as("persona-1");
  await withApprovedRecipe(s, rig);
  await s.as("persona-rb");
  const order = (await saved(rig.store.run("createOrder", linked
    ? { ...ORDER, customerPo: "PI-R", sourceJobId: "JOB-RB2", uom: "pcs", targetQty: target, targetKg: target * 0.5, kgPerUnit: 0.5 }
    : { ...ORDER, targetQty: target }))).result;
  await saved(rig.store.run("saveMold", { id: "DIE-1", name: "หัวดายทดสอบ", kind: "die", unit: "m", perCycle: 1, cleanEvery: 5000, pmLimit: 100000 }));
  await saved(rig.store.run("saveMold", { id: "MD-1", name: "แม่พิมพ์ 2 cavity", kind: "mold", unit: "shot", perCycle: 2, cleanEvery: 1000, pmLimit: 50000 }));
  await s.as("persona-rbh");
  await saved(rig.store.run("setOrderStatus", { id: order, status: "released" }));
  await s.as("persona-st");
  const lots = [];
  for (const [code, days] of [["EPDM-55", 30], ["EPDM-55", 10], ["CB-N550", 60]]) {
    lots.push((await saved(rig.store.run("receiveMaterial", { materialCode: code, qtyKg: 40, expiry: NOW + days * DAY, supplier: "ผู้ขาย", location: "A-1", coa: true }))).result);
  }
  return { order, lots };
}
const go = async (s, rig, persona, name, payload) => {
  await s.as(persona);
  return saved(rig.store.run(name, payload));
};
// ใบเบิก 1 batch → ชั่งครบ → ผสม → (ข้ามเวลาบ่ม) → ส่งมอบ → SR รับ : คืน id ของแต่ละเอกสาร
async function mixAndSend(s, rig, order, { dump1 = 110, outputKg = 48 } = {}) {
  const requisition = (await go(s, rig, "persona-rb", "createRequisition", { orderId: order, batches: 1, note: "ทดสอบ" })).result;
  const req = rig.store.data().requisitions.find((row) => row.id === requisition);
  for (let index = 0; index < req.lines.length; index += 1) await go(s, rig, "persona-rb", "weighLine", { reqId: requisition, index, actualKg: req.lines[index].targetKg });
  const mx = (await go(s, rig, "persona-rb", "recordMixing", { reqId: requisition, machine: "KN-01 Kneader 75L", shift: "D", stages: [{ ...STAGES2[0], dumpTemp: dump1 }, STAGES2[1]], outputKg, scrapKg: 1 })).result;
  return { requisition, mx };
}

test("the whole line on the database: receive → FEFO requisition → weigh → mix → rest → transfer → receive → extrude → cure → finish → ship, with the page equal to the database at every step", async () => {
  const s = await session();
  const rig = await s.make();
  const { order, lots } = await prepare(s, rig);
  const master = () => s.call("app_rf_master");
  await inSync(s, rig, "prepared");
  const [slow, soon, carbon] = lots;
  assert.deepEqual(lots, [`RM-EPDM-55-${TODAY}-01`, `RM-EPDM-55-${TODAY}-02`, `RM-CB-N550-${TODAY}-01`]);
  assert.equal((await master()).materialLots[0].receivedBy, "วิชัย คลังวัตถุดิบ");

  // ใบเบิก: FEFO หยิบล็อตที่หมดอายุก่อน (-02) แม้รับเข้าทีหลัง · ใบสั่งผลิตที่ยังไม่เริ่มผสมยังเป็น released
  const requisition = (await go(s, rig, "persona-rb", "createRequisition", { orderId: order, batches: 1, note: "รอบแรก" })).result;
  assert.equal(requisition, `REQ-${TODAY}-01`);
  const req = (await master()).requisitions[0];
  assert.deepEqual(req.lines.map((line) => [line.materialCode, line.lotNo, line.targetKg, line.actualKg]), [["EPDM-55", soon, 31.25, null], ["CB-N550", carbon, 18.75, null]]);
  assert.equal(req.requestedBy, "ประยุทธ รีดยาง");
  await inSync(s, rig, "requisition");
  // ใบเบิกที่สองเห็นว่า 31.25 kg ของล็อต -02 ถูกจองแล้ว → หยิบส่วนที่เหลือของ -02 แล้วต่อด้วย -01
  const second = (await go(s, rig, "persona-rb", "createRequisition", { orderId: order, batches: 1 })).result;
  assert.deepEqual((await master()).requisitions.find((row) => row.id === second).lines.filter((line) => line.materialCode === "EPDM-55").map((line) => [line.lotNo, line.targetKg]), [[soon, 8.75], [slow, 22.5]]);
  // สต็อก CB เหลือ 40 − 2 × 18.75 = 2.5 kg: ใบที่สามไม่พอ (หน้าจอปฏิเสธก่อน · ฐานข้อมูลตอบรหัสเอง)
  assert.match(rig.store.run("createRequisition", { orderId: order, batches: 1 }).error.message, /สต็อกไม่พอตามหลัก FEFO/);

  // ชั่ง: นอกเกณฑ์ไม่รับ · สต็อกของล็อตหักทันทีที่ชั่งแต่ละรายการ
  assert.match(rig.store.run("weighLine", { reqId: requisition, index: 0, actualKg: 33 }).error.message, /นอกเกณฑ์/);
  const direct = await s.mock.client.rpc("app_rf_save", { p_changes: { requisitions: { upsert: [{ ...req, lines: [{ ...req.lines[0], actualKg: 33 }, req.lines[1]] }] } }, p_base_version: (await master()).version, p_action: "weighLine" });
  assert.equal(direct.error.code, "RF_OUT_OF_TOLERANCE", "the database refuses it too");
  await go(s, rig, "persona-rb", "weighLine", { reqId: requisition, index: 0, actualKg: 31.3 });
  assert.equal((await master()).materialLots.find((row) => row.lotNo === soon).qtyKg, 8.7, "stock fell by the weighed kilograms");
  assert.equal((await master()).requisitions.find((row) => row.id === requisition).status, "weighing");
  await inSync(s, rig, "first line weighed");
  await go(s, rig, "persona-rb", "weighLine", { reqId: requisition, index: 1, actualKg: 18.7 });
  const issued = (await master()).requisitions.find((row) => row.id === requisition);
  assert.deepEqual([issued.status, issued.issuedBy, issued.lines[0].weighedBy], ["issued", "ประยุทธ รีดยาง", "ประยุทธ รีดยาง"]);
  await inSync(s, rig, "issued");

  // ผสม: สองขั้น · Dump temp ขั้น 2 ตามสูตร → ผ่าน · ใบเบิกถูกใช้ · ใบสั่งผลิต released → in_progress ในคำสั่งเดียวกัน
  const mx = (await go(s, rig, "persona-rb", "recordMixing", { reqId: requisition, machine: "KN-01 Kneader 75L", shift: "D", stages: STAGES2, outputKg: 48, scrapKg: 1 })).result;
  assert.equal(mx, `MX-${TODAY}-01`);
  const mixed = (await master()).lots[0];
  assert.deepEqual([mixed.qc, mixed.holdReasons, mixed.operator, mixed.readyAt], ["pass", [], "ประยุทธ รีดยาง", NOW + 4 * 3600000]);
  assert.equal((await master()).requisitions.find((row) => row.id === requisition).status, "consumed");
  assert.equal((await master()).orders[0].status, "in_progress");
  await inSync(s, rig, "mixed");
  // ยังบ่มไม่ครบ: ส่งมอบไม่ได้ → ข้ามเวลาบ่ม (คำสั่งของ RB ฐานข้อมูลตั้งเวลาเอง) → ส่งมอบ
  assert.match(rig.store.run("createTransfer", { lotId: mx, qty: 48 }).error.message, /บ่มไม่ครบ/);
  await go(s, rig, "persona-rb", "endRest", { lotId: mx });
  assert.equal((await master()).lots[0].readyAt, NOW);
  await inSync(s, rig, "rest skipped");
  const tr1 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: mx, qty: 48, note: "พาเลท A" })).result;
  assert.equal(tr1, `TR-${TODAY}-01`);
  assert.equal((await master()).lots[0].transferredQty, 48, "the database sums what was sent");
  await inSync(s, rig, "transfer sent");
  // สถานีฉีดเริ่มไม่ได้จนกว่า SR จะรับมอบ
  assert.match(rig.store.run("recordExtrusion", { transferId: tr1, useKg: 47, thickness: 2.5, width: 18, weightPerM: 160, goodQty: 100, dieId: "DIE-1" }).error.message, /รับมอบ/);
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr1, qtyReceived: "47" });
  const received = (await master()).transfers[0];
  assert.deepEqual([received.status, received.qtyReceived, received.remaining, received.receivedBy], ["received", 47, 47, "ศิริ รับมอบ"]);
  await inSync(s, rig, "received");

  // ฉีด: ใช้ใบส่งมอบ 47 kg → คงเหลือ 0 · หัวดายนับ 100 m
  const ex = (await go(s, rig, "persona-rb", "recordExtrusion", { transferId: tr1, useKg: 47, thickness: 2.5, width: 18, weightPerM: 160, goodQty: 100, scrapQty: 2, dieId: "DIE-1", machine: "EX-11 Extruder Ø90", shift: "D" })).result;
  assert.equal(ex, `EX-${TODAY}-01`);
  const afterEx = await master();
  assert.deepEqual([afterEx.transfers[0].remaining, afterEx.molds.find((row) => row.id === "DIE-1").usageSinceClean, afterEx.molds.find((row) => row.id === "DIE-1").totalUsage], [0, 100, 100]);
  assert.equal(afterEx.lots.find((row) => row.id === ex).qc, "pass");
  await inSync(s, rig, "extruded");
  const tr2 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: ex, qty: 100 })).result;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr2, qtyReceived: 100 });
  // อบ: แม่พิมพ์ 2 cavity นับรอบ ceil((98 + 2) / 2) = 50
  const cu = (await go(s, rig, "persona-rb", "recordCuring", { transferId: tr2, useQty: 100, moldId: "MD-1", temp: 200, time: 150, pressure: 150, goodQty: 98, scrapQty: 2, shift: "D" })).result;
  assert.equal((await master()).molds.find((row) => row.id === "MD-1").usageSinceClean, 50);
  await inSync(s, rig, "cured");
  const tr3 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: cu, qty: 98 })).result;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr3, qtyReceived: 98 });
  // ตกแต่ง: 98 ชิ้น กล่องละ 40 → 3 กล่อง · ยอดผลิตของใบ 98 ≥ เป้า 90 → ใบปิดเอง
  const fn = (await go(s, rig, "persona-rb", "recordFinishing", { transferId: tr3, useQty: 98, passedQty: 98, scrapQty: 0, perBox: 40, qcResult: "pass", grade: "A", shift: "D" })).result;
  const finished = await master();
  assert.deepEqual(finished.fgBoxes.map((box) => [box.id, box.qty, box.status]), [[`BOX-${TODAY}-01-001`, 40, "in_stock"], [`BOX-${TODAY}-01-002`, 40, "in_stock"], [`BOX-${TODAY}-01-003`, 18, "in_stock"]]);
  assert.deepEqual([finished.orders[0].producedQty, finished.orders[0].status], [98, "completed"]);
  assert.equal(finished.lots.find((row) => row.id === fn).countedToOrder, true);
  await inSync(s, rig, "finished");

  // QA: ผลตรวจค่าแล็บ · WH: ส่งมอบกล่อง
  const qc = (await go(s, rig, "persona-qa", "addQcRecord", { lotId: fn, values: { hardness: 65, tensile: 12 } })).result;
  assert.equal(qc, `QC-${TODAY}-01`);
  const record = (await master()).qcRecords[0];
  assert.deepEqual([record.result, record.inspector, record.tests.map((test) => test.pass)], ["pass", "ธนา ตรวจสอบ", [true, true]]);
  await inSync(s, rig, "qc");
  await go(s, rig, "persona-wh", "shipBoxes", { ids: [`BOX-${TODAY}-01-001`, `BOX-${TODAY}-01-002`] });
  const shipped = (await master()).fgBoxes;
  assert.deepEqual(shipped.map((box) => [box.status, box.shippedBy]), [["shipped", "สุดา คลังสินค้า"], ["shipped", "สุดา คลังสินค้า"], ["in_stock", undefined]]);
  await inSync(s, rig, "shipped");
  assert.match(rig.store.run("shipBoxes", { ids: [`BOX-${TODAY}-01-001`] }).error.message, /ไม่พร้อมส่ง/, "a shipped box cannot ship twice");

  // ประวัติการใช้งานของฐานข้อมูลบอกการกระทำทุกขั้น
  await rig.store.loadAudit(true);
  const actions = rig.store.audit().entries.map((entry) => entry.action);
  for (const name of ["receiveMaterial", "createRequisition", "weighLine", "recordMixing", "endRest", "createTransfer", "receiveTransfer", "recordExtrusion", "recordCuring", "recordFinishing", "addQcRecord", "shipBoxes", "saveMold"]) assert.ok(actions.includes(name), name);
  // ล้างแม่พิมพ์: ตัวนับกลับเป็น 0 (แม่พิมพ์ที่ไม่มีการใช้งานไม่มีอะไรให้ล้าง)
  await go(s, rig, "persona-rb", "cleanMold", { id: "DIE-1" });
  assert.equal((await master()).molds.find((row) => row.id === "DIE-1").usageSinceClean, 0);
  await inSync(s, rig, "cleaned");
  // ล้างข้อมูลทดสอบ: ทุกชุดว่าง
  await s.as("persona-1");
  const purged = await rig.store.purge();
  assert.equal(purged.ok, true);
  for (const list of storeApi.REMOTE_LISTS) assert.deepEqual(rig.store.data()[list], [], list);
});

test("each shop-floor action is open to its own department and the planner group only: the page says no first and the database says RF_FORBIDDEN to a direct call", async () => {
  const s = await session();
  const rig = await s.make();
  const { order, lots } = await prepare(s, rig);
  const { requisition, mx } = await mixAndSend(s, rig, order);
  await go(s, rig, "persona-rb", "endRest", { lotId: mx });
  const tr = (await go(s, rig, "persona-rb", "createTransfer", { lotId: mx, qty: 48 })).result;
  const forbidden = (persona, name, payload) => {
    const out = rig.store.run(name, payload);
    assert.equal(out.ok, false, `${persona} ${name}`);
    assert.match(out.error.message, /ไม่มีสิทธิ์/, `${persona} ${name}`);
  };
  // หน้าจอปฏิเสธก่อนส่ง
  await s.as("persona-rb");
  forbidden("rb", "receiveMaterial", { materialCode: "EPDM-55", qtyKg: 1, expiry: NOW + DAY });
  forbidden("rb", "setMaterialLotStatus", { lotNo: lots[0], status: "hold" });
  forbidden("rb", "receiveTransfer", { id: tr, qtyReceived: 48 });
  forbidden("rb", "shipBoxes", { ids: ["x"] });
  forbidden("rb", "addQcRecord", { lotId: mx, values: { hardness: 65 } });
  forbidden("rb", "createNcr", { title: "x", lotId: mx });
  await s.as("persona-st");
  for (const [name, payload] of [["createRequisition", { orderId: order, batches: 1 }], ["weighLine", { reqId: requisition, index: 0, actualKg: 1 }], ["recordMixing", { reqId: requisition }], ["endRest", { lotId: mx }], ["createTransfer", { lotId: mx, qty: 1 }], ["cleanMold", { id: "DIE-1" }], ["saveMold", { id: "X", name: "x" }], ["receiveTransfer", { id: tr, qtyReceived: 1 }]]) forbidden("st", name, payload);
  await s.as("persona-sr");
  forbidden("sr", "createTransfer", { lotId: mx, qty: 1 });
  forbidden("sr", "receiveMaterial", { materialCode: "EPDM-55", qtyKg: 1, expiry: NOW + DAY });
  await s.as("persona-wh");
  forbidden("wh", "receiveTransfer", { id: tr, qtyReceived: 1 });
  forbidden("wh", "recordFinishing", { transferId: tr });
  await s.as("persona-qa");
  forbidden("qa", "createRequisition", { orderId: order, batches: 1 });
  forbidden("qa", "receiveTransfer", { id: tr, qtyReceived: 1 });
  forbidden("qa", "shipBoxes", { ids: ["x"] });
  await s.as("persona-gr");
  for (const name of ["receiveMaterial", "createRequisition", "createTransfer", "receiveTransfer", "shipBoxes", "addQcRecord", "createNcr", "saveMold", "cleanMold", "recordFinishing"]) forbidden("gr", name, {});

  // ข้ามหน้าจอ: ส่งตรงไปที่ฐานข้อมูลในนามบัญชีที่ไม่มีสิทธิ์ → RF_FORBIDDEN และไม่มีอะไรเปลี่ยน
  const master = () => s.call("app_rf_master");
  const sendAs = async (persona, changes, action) => {
    await s.as(persona);
    const snapshot = await master();
    const reply = await s.mock.client.rpc("app_rf_save", { p_changes: changes, p_base_version: snapshot.version, p_action: action });
    assert.equal((await master()).version, snapshot.version, `${persona} ${action}: nothing was written`);
    return reply.error?.code;
  };
  const snap = await master();
  const lotRow = snap.materialLots[0];
  const trRow = snap.transfers[0];
  const mxRow = snap.lots[0];
  assert.equal(await sendAs("persona-rb", { materialLots: { upsert: [{ ...lotRow, status: "hold" }] } }, "setMaterialLotStatus"), "RF_FORBIDDEN", "RB cannot hold material");
  assert.equal(await sendAs("persona-rb", { materialLots: { upsert: [{ ...lotRow, lotNo: "RM-NEW-1", qtyKg: 5, initialKg: 5, expiry: NOW + DAY }] } }, "receiveMaterial"), "RF_FORBIDDEN", "RB cannot receive material");
  assert.equal(await sendAs("persona-rb", { transfers: { upsert: [{ ...trRow, status: "received", qtyReceived: 48 }] } }, "receiveTransfer"), "RF_FORBIDDEN", "RB cannot receive a transfer");
  assert.equal(await sendAs("persona-wh", { transfers: { upsert: [{ ...trRow, status: "received", qtyReceived: 48 }] } }, "receiveTransfer"), "RF_FORBIDDEN");
  assert.equal(await sendAs("persona-st", { requisitions: { upsert: [{ ...snap.requisitions[0], note: "แก้" }] } }, "weighLine"), "RF_FORBIDDEN", "ST cannot touch requisitions");
  assert.equal(await sendAs("persona-qa", { lots: { upsert: [{ ...mxRow, id: "MX-X-01", goodQty: 5 }] } }, "recordMixing"), "RF_FORBIDDEN", "QA cannot add a lot");
  assert.equal(await sendAs("persona-rb", { lots: { upsert: [{ ...mxRow, qc: "hold", holdReasons: ["x"] }] } }, "addQcRecord"), "RF_FORBIDDEN", "RB cannot decide a lot");
  assert.equal(await sendAs("persona-gr", { molds: { upsert: [{ id: "NEW-M", name: "x", kind: "die", unit: "m", perCycle: 1, cleanEvery: 1, pmLimit: 1 }] } }, "saveMold"), "RF_FORBIDDEN");
  assert.equal(await sendAs("persona-rb", { qcRecords: { upsert: [{ id: "QC-X-01", lotId: mx, tests: [{ key: "hardness", value: 65, pass: true }], result: "pass" }] } }, "addQcRecord"), "RF_FORBIDDEN", "RB cannot write a QC record");
  assert.equal(await sendAs("persona-rb", { ncrs: { upsert: [{ id: "NCR-X-01", lotId: mx, title: "x", whys: [], status: "open" }] } }, "createNcr"), "RF_FORBIDDEN", "RB cannot open an NCR");
  // สิทธิ์ถูก แต่ผิดสถานะ: SR รับซ้ำ = ข้อมูลเท่าเดิม ไม่มีอะไรเปลี่ยน · แก้ผลตรวจเดิมไม่ได้
  assert.equal(await sendAs("persona-sr", { transfers: { upsert: [{ ...trRow, status: "in_transit", qtyReceived: null }] } }, "receiveTransfer"), undefined, "an identical transfer is a no-op");
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr, qtyReceived: 48 });
  const done = (await master()).transfers[0];
  assert.equal(await sendAs("persona-sr", { transfers: { upsert: [{ ...done, status: "in_transit" }] } }, "receiveTransfer"), "RF_INVALID_TRANSITION", "a received transfer cannot go back");
  // ผู้วางแผนทำได้ทุกอย่าง
  const statusOf = async () => (await master()).materialLots.find((row) => row.lotNo === lots[0]).status;
  assert.equal((await go(s, rig, "persona-pp", "setMaterialLotStatus", { lotNo: lots[0], status: "hold" })).ok, true);
  assert.equal(await statusOf(), "hold");
  await go(s, rig, "persona-st", "setMaterialLotStatus", { lotNo: lots[0], status: "available" });
  assert.equal(await statusOf(), "available");
  await go(s, rig, "persona-qa", "setMaterialLotStatus", { lotNo: lots[0], status: "hold" });
  assert.equal(await statusOf(), "hold", "ST and QA both hold and release material lots");
});

test("the database computes the numbers itself: a client cannot set the stock, the remaining quantity, the produced quantity or the mold counter by writing them", async () => {
  const s = await session();
  const rig = await s.make();
  const { order, lots } = await prepare(s, rig);
  const { mx } = await mixAndSend(s, rig, order);
  await go(s, rig, "persona-rb", "endRest", { lotId: mx });
  const tr = (await go(s, rig, "persona-rb", "createTransfer", { lotId: mx, qty: 48 })).result;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr, qtyReceived: 47 });
  const master = () => s.call("app_rf_master");
  const save = async (changes, action) => {
    const snapshot = await master();
    return s.mock.client.rpc("app_rf_save", { p_changes: changes, p_base_version: snapshot.version, p_action: action });
  };
  const snap = await master();
  await s.as("persona-rbh");
  // ช่องที่ฐานข้อมูลคำนวณเองเขียนทับไม่ได้ (เมินเงียบ ไม่เพิ่มเวอร์ชัน)
  const forged = await save({
    materialLots: { upsert: snap.materialLots.map((row) => ({ ...row, qtyKg: 999 })) },
    lots: { upsert: [{ ...snap.lots[0], transferredQty: 0 }] },
    transfers: { upsert: [{ ...snap.transfers[0], remaining: 1000 }] },
    orders: { upsert: [{ ...snap.orders[0], producedQty: 500 }] },
    molds: { upsert: snap.molds.map((row) => ({ ...row, usageSinceClean: 123456, totalUsage: 1 })) },
  }, "recordMixing");
  assert.equal(forged.data.version, snap.version, "nothing was written");
  assert.deepEqual(forged.data.changes.materialLots.upsert, []);
  const after = await master();
  assert.deepEqual([after.materialLots.map((row) => row.qtyKg), after.lots[0].transferredQty, after.transfers[0].remaining, after.orders[0].producedQty, after.molds.map((row) => row.usageSinceClean)], [[21.25, 40, 8.75], 48, 47, 0, [0, 0]]);
  // ใบส่งมอบ: ส่งเกินที่ส่งต่อได้ไม่ได้ · รับเกิน +2% ไม่ได้ · ส่งซ้ำของล็อตที่ส่งครบแล้วไม่ได้
  assert.match(rig.store.run("createTransfer", { lotId: mx, qty: 1 }).error.message, /ส่งมอบ/);
  const extra = { ...snap.transfers[0], id: `TR-${TODAY}-09`, qtySent: 5, status: "in_transit", qtyReceived: null, remaining: 0 };
  assert.equal((await save({ transfers: { upsert: [extra] } }, "createTransfer")).error.code, "RF_INVALID_TRANSFER", "nothing left to send from the lot");
  // ล็อตวัตถุดิบที่กักกัน (ล็อต -02) ไม่ถูกจัดสรร: ใบเบิกใหม่หยิบจากล็อต -01 ทั้งหมด
  await go(s, rig, "persona-st", "setMaterialLotStatus", { lotNo: lots[1], status: "hold" });
  const next = (await go(s, rig, "persona-rb", "createRequisition", { orderId: order, batches: 1 })).result;
  assert.deepEqual((await master()).requisitions.find((row) => row.id === next).lines.map((line) => line.lotNo), [lots[0], lots[2]], "held stock is not allocated");
});

test("mixing holds the lot per stage, the QC decision releases it and adds the produced quantity, and an NCR runs open → filled by RB → closed by QA", async () => {
  const s = await session();
  const rig = await s.make();
  const { order } = await prepare(s, rig);
  // ผสมขั้น 1 Dump temp 125 (มาตรฐาน 110 ± 5) → ล็อตถูก QC Hold โดยระบบ ระบุขั้น
  const { mx } = await mixAndSend(s, rig, order, { dump1: 125 });
  const held = (await s.call("app_rf_master")).lots[0];
  assert.deepEqual([held.qc, held.holdReasons], ["hold", ["Dump temp ขั้น 1 125°C นอกช่วง 110±5"]]);
  await inSync(s, rig, "mixing hold");
  await go(s, rig, "persona-rb", "endRest", { lotId: mx });
  assert.match(rig.store.run("createTransfer", { lotId: mx, qty: 48 }).error.message, /ยังไม่ผ่าน QC/);
  // RB ตัดสินล็อตเองไม่ได้ · QA บันทึกผล pass (ค่านอกสเปกตัดสินผ่านไม่ได้) ปลดกักกัน
  await s.as("persona-rb");
  assert.match(rig.store.run("addQcRecord", { lotId: mx, values: { hardness: 65 } }).error.message, /ไม่มีสิทธิ์/);
  await s.as("persona-qa");
  assert.match(rig.store.run("addQcRecord", { lotId: mx, values: { hardness: 80 }, result: "pass" }).error.message, /นอกสเปก/);
  await go(s, rig, "persona-qa", "addQcRecord", { lotId: mx, values: { hardness: 65, sg: 1.18 }, result: "pass", note: "ตรวจซ้ำ" });
  const released = (await s.call("app_rf_master")).lots[0];
  assert.deepEqual([released.qc, released.holdReasons], ["pass", []]);
  await inSync(s, rig, "released");
  // ล็อตที่ผ่านแล้วตัดสินเป็น fail ไม่ได้ (hold → pass|fail เท่านั้น) · ฐานข้อมูลปฏิเสธตรงๆ
  const snap = await s.call("app_rf_master");
  const bad = await s.mock.client.rpc("app_rf_save", { p_changes: { lots: { upsert: [{ ...snap.lots[0], qc: "fail" }] }, qcRecords: { upsert: [{ id: `QC-${TODAY}-09`, lotId: mx, tests: [{ key: "hardness", value: 65, pass: true }], result: "fail" }] } }, p_base_version: snap.version, p_action: "addQcRecord" });
  assert.equal(bad.error.code, "RF_INVALID_TRANSITION");

  // ตกแต่งที่ผลตรวจยังไม่ผ่าน: กล่องกักกัน ยอดผลิตยังไม่นับ → QA ผ่านแล้ว กล่องพร้อมส่งและยอดเข้าใบ แต่ QA ปิดใบเองไม่ได้ (ปิดเป็นของฝั่ง RB)
  const tr1 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: mx, qty: 48 })).result;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr1, qtyReceived: 47 });
  const ex = (await go(s, rig, "persona-rb", "recordExtrusion", { transferId: tr1, useKg: 47, thickness: 2.5, width: 18, weightPerM: 160, goodQty: 20, dieId: "DIE-1" })).result;
  const tr2 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: ex, qty: 20 })).result;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr2, qtyReceived: 20 });
  const cu = (await go(s, rig, "persona-rb", "recordCuring", { transferId: tr2, useQty: 20, moldId: "MD-1", temp: 200, time: 150, pressure: 150, goodQty: 20 })).result;
  const tr3 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: cu, qty: 20 })).result;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr3, qtyReceived: 20 });
  const fn = (await go(s, rig, "persona-rb", "recordFinishing", { transferId: tr3, useQty: 20, passedQty: 20, perBox: 20, qcResult: "hold" })).result;
  let snapshot = await s.call("app_rf_master");
  assert.deepEqual([snapshot.orders[0].producedQty, snapshot.fgBoxes[0].status, snapshot.lots.find((row) => row.id === fn).countedToOrder], [0, "hold", false]);
  await inSync(s, rig, "finishing on hold");
  await go(s, rig, "persona-qa", "addQcRecord", { lotId: fn, values: { hardness: 66 }, result: "pass" });
  snapshot = await s.call("app_rf_master");
  assert.deepEqual([snapshot.orders[0].producedQty, snapshot.fgBoxes[0].status, snapshot.lots.find((row) => row.id === fn).countedToOrder, snapshot.orders[0].status], [20, "in_stock", true, "in_progress"]);
  await inSync(s, rig, "finishing released by QA");

  // NCR: QA เปิด (ล็อตที่ผ่านถูกกักกัน) · RB กรอกการแก้ไข/ป้องกันได้แต่ปิดไม่ได้ · QA ปิดได้เมื่อมีครบทั้งสอง
  const ncr = (await go(s, rig, "persona-qa", "createNcr", { title: "ผิวหยาบ", lotId: fn, stage: "finishing", severity: "major", defectQty: 3, whys: ["ผิวหยาบ", "แม่พิมพ์สกปรก"], containment: "กักกันล็อต" })).result;
  assert.equal(ncr, `NCR-${TODAY}-01`);
  snapshot = await s.call("app_rf_master");
  assert.deepEqual([snapshot.lots.find((row) => row.id === fn).qc, snapshot.lots.find((row) => row.id === fn).holdReasons.at(-1), snapshot.ncrs[0].createdBy], ["hold", `เปิด ${ncr}`, "ธนา ตรวจสอบ"]);
  await inSync(s, rig, "ncr opened");
  await s.as("persona-rb");
  assert.match(rig.store.run("closeNcr", { id: ncr }).error.message, /ไม่มีสิทธิ์/);
  assert.match(rig.store.run("createNcr", { title: "x", lotId: fn }).error.message, /ไม่มีสิทธิ์/);
  await go(s, rig, "persona-rb", "updateNcr", { id: ncr, corrective: "ล้างแม่พิมพ์" });
  assert.equal((await s.call("app_rf_master")).ncrs[0].corrective, "ล้างแม่พิมพ์");
  await go(s, rig, "persona-qa", "updateNcr", { id: ncr, preventive: "เพิ่มรอบล้าง" });
  await inSync(s, rig, "ncr filled");
  // ปิดเคสต้องมีทั้งสอง: ลองปิดตอนที่ป้องกันยังว่าง (ฐานข้อมูลปฏิเสธตรงๆ)
  const ncrRow = (await s.call("app_rf_master")).ncrs[0];
  await s.as("persona-qa");
  const early = await s.mock.client.rpc("app_rf_save", { p_changes: { ncrs: { upsert: [{ ...ncrRow, preventive: "", status: "closed", verification: "ok" }] } }, p_base_version: (await s.call("app_rf_master")).version, p_action: "closeNcr" });
  assert.equal(early.error.code, "RF_INVALID_NCR");
  await go(s, rig, "persona-qa", "closeNcr", { id: ncr, verification: "ติดตามแล้ว" });
  const closed = (await s.call("app_rf_master")).ncrs[0];
  assert.deepEqual([closed.status, closed.closedBy, closed.verification], ["closed", "ธนา ตรวจสอบ", "ติดตามแล้ว"]);
  await inSync(s, rig, "ncr closed");
  assert.match(rig.store.run("updateNcr", { id: ncr, corrective: "แก้ต่อ" }).error.message, /ปิดแล้ว/, "a closed NCR is read-only");
  // ปิด WO: หัวหน้า RB ปิดใบเอง
  const closeOrder = await go(s, rig, "persona-rbh", "setOrderStatus", { id: order, status: "completed" });
  assert.equal(closeOrder.ok, true);
});

test("an SR receive reports the received quantity to the linked BOM job, one report per transfer, kilograms converted to the job's unit", async () => {
  const s = await session({ withBom: true });
  const rig = await s.make();
  const { order } = await prepare(s, rig, { linked: true });
  const bom = () => s.call("app_bom_master");
  const job = async () => (await bom()).jobs.find((row) => row.id === "JOB-RB2");
  // เส้นยาง 100 ชิ้น = 50 kg (0.5 kg ต่อชิ้น): ผูกแล้วงานเริ่ม แต่ยังไม่มียอด
  assert.deepEqual([(await job()).externalRef.woId, (await job()).qtyDone, (await job()).reports.length], [order, 0, 0]);
  const { mx } = await mixAndSend(s, rig, order);
  await go(s, rig, "persona-rb", "endRest", { lotId: mx });
  const tr1 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: mx, qty: 48 })).result;
  const before = (await bom()).version;
  assert.equal((await job()).qtyDone, 0, "sending reports nothing; the receive does");
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr1, qtyReceived: 47 });
  let after = await job();
  assert.deepEqual([after.qtyDone, after.status, after.reports.length], [94, "in_progress", 1], "47 kg ÷ 0.5 kg per piece = 94 pieces");
  assert.deepEqual([after.reports[0].good, after.reports[0].reject, after.reports[0].note, after.reports[0].by], [94, 0, `รับโอน ${tr1} จาก WO ${order}`, "ศิริ รับมอบ"]);
  assert.equal((await bom()).version, before + 1, "the BOM counter moved once so BOM clients catch it up");
  assert.deepEqual((await s.call("app_bom_master_since", { p_version: before })).changes.jobs.upsert.map((row) => row.id), ["JOB-RB2"]);
  assert.ok((await s.call("app_bom_audit", {})).some((row) => row.action === "rubberflow:receiveTransfer"));
  assert.equal((await bom()).orders.find((row) => row.id === "PI-R").status, "in_progress");

  // ใบส่งมอบถัดไป (หน่วยของ WO) บวกตรงๆ ไม่แปลง · ครบแผนแล้วงาน done · ใบถัดไปไม่ถูกบวกอีก
  const ex = (await go(s, rig, "persona-rb", "recordExtrusion", { transferId: tr1, useKg: 47, thickness: 2.5, width: 18, weightPerM: 160, goodQty: 100, dieId: "DIE-1" })).result;
  const tr2 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: ex, qty: 100 })).result;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr2, qtyReceived: 100 });
  after = await job();
  assert.deepEqual([after.qtyDone, after.status, after.reports.length, typeof after.doneAt], [194, "done", 2, "number"]);
  const cu = (await go(s, rig, "persona-rb", "recordCuring", { transferId: tr2, useQty: 100, moldId: "MD-1", temp: 200, time: 150, pressure: 150, goodQty: 100 })).result;
  const tr3 = (await go(s, rig, "persona-rb", "createTransfer", { lotId: cu, qty: 100 })).result;
  const frozen = (await bom()).version;
  await go(s, rig, "persona-sr", "receiveTransfer", { id: tr3, qtyReceived: 100 });
  assert.deepEqual([(await job()).reports.length, (await bom()).version], [2, frozen], "a done job takes no more reports");
  // ปิด WO ไม่ส่งยอดซ้ำ
  await go(s, rig, "persona-rbh", "setOrderStatus", { id: order, status: "completed" });
  assert.equal((await job()).reports.length, 2);

  // ใบสั่งผลิตที่ไม่ผูกงาน BOM: SR รับแล้ว BOM ไม่ขยับ
  const plain = await session({ withBom: true });
  const plainRig = await plain.make();
  const prepared = await prepare(plain, plainRig);
  const sent = await mixAndSend(plain, plainRig, prepared.order);
  await go(plain, plainRig, "persona-rb", "endRest", { lotId: sent.mx });
  const trPlain = (await go(plain, plainRig, "persona-rb", "createTransfer", { lotId: sent.mx, qty: 48 })).result;
  const bomVersion = (await plain.call("app_bom_master")).version;
  await go(plain, plainRig, "persona-sr", "receiveTransfer", { id: trPlain, qtyReceived: 48 });
  assert.equal((await plain.call("app_bom_master")).version, bomVersion);
});

test("shop-floor records collide per record: stale is reported before permissions, a duplicate document number catches up, and a held form keeps other users' data out", async () => {
  const s = await session();
  const state = { holding: false };
  const a = await s.make();
  const b = await s.make({ shouldHold: () => state.holding });
  const { order } = await prepare(s, a);
  await b.store.catchUp();
  assert.equal(b.store.data().materialLots.length, 3, "the second machine catches up with every list");
  // เครื่อง A ออกใบเบิก 01 · เครื่อง B ยังไม่เห็นจึงออก 01 ซ้ำ → RF_STALE ย้อนกลับแล้วตามทัน
  const one = await go(s, a, "persona-rb", "createRequisition", { orderId: order, batches: 1 });
  assert.equal(one.result, `REQ-${TODAY}-01`);
  const dup = b.store.run("createRequisition", { orderId: order, batches: 1, note: "อีกเครื่อง" });
  assert.equal(dup.result, `REQ-${TODAY}-01`);
  assert.equal((await dup.saving).error.code, "RF_STALE");
  assert.equal(b.store.data().requisitions.length, 1, "reverted and caught up");
  assert.equal((await saved(b.store.run("createRequisition", { orderId: order, batches: 1 }))).result, `REQ-${TODAY}-02`);
  // ชั่งพร้อมกัน: A ชั่งรายการ 0 · B (ฐานเก่า) ชั่งรายการ 0 ของใบเดียวกัน → ชน
  await a.store.catchUp();
  await b.store.catchUp();
  await saved(a.store.run("weighLine", { reqId: `REQ-${TODAY}-01`, index: 0, actualKg: 31.25 }));
  const clash = b.store.run("weighLine", { reqId: `REQ-${TODAY}-01`, index: 0, actualKg: 31.3 }); // ค่าต่างจากที่ A ชั่ง (ค่าเท่ากันทุกช่องถือว่าไม่มีอะไรเปลี่ยน)
  assert.equal(clash.ok, true, clash.error?.message);
  assert.equal((await clash.saving).error.code, "RF_STALE");
  // ชนก่อนสิทธิ์: ST ฐานเก่าแก้ใบเบิก → RF_STALE ไม่ใช่ RF_FORBIDDEN; ฐานล่าสุด → RF_FORBIDDEN
  await s.as("persona-st");
  const snapshot = await s.call("app_rf_master");
  const row = snapshot.requisitions.find((item) => item.id === `REQ-${TODAY}-01`);
  const change = { requisitions: { upsert: [{ ...row, note: "แก้" }] } };
  assert.equal((await s.mock.client.rpc("app_rf_save", { p_changes: change, p_base_version: 0, p_action: "weighLine" })).error.code, "RF_STALE");
  assert.equal((await s.mock.client.rpc("app_rf_save", { p_changes: change, p_base_version: snapshot.version, p_action: "weighLine" })).error.code, "RF_FORBIDDEN");
  // ฟอร์มค้าง: B ไม่รวมของ A
  await s.as("persona-rb");
  await saved(a.store.run("saveMold", { id: "DIE-2", name: "หัวดายสอง", kind: "die", unit: "pcs", perCycle: 1, cleanEvery: 100, pmLimit: 1000 }));
  state.holding = true;
  assert.equal(await b.store.catchUp(), false);
  assert.equal(b.store.hasNewer(), true);
  assert.ok(!b.store.data().molds.some((mold) => mold.id === "DIE-2"));
  state.holding = false;
  assert.equal(await b.store.catchUp(), true);
  assert.ok(b.store.data().molds.some((mold) => mold.id === "DIE-2"));
});

test("molds are added and edited through the database; cleaning resets the counter with the server time; the definition is validated", async () => {
  const s = await session();
  const rig = await s.make();
  await s.as("persona-rb");
  assert.deepEqual(rig.store.data().molds, []);
  const bad = (payload, pattern) => assert.match(rig.store.run("saveMold", payload).error.message, pattern);
  const good = { id: "DIE-9", name: "หัวดาย 9", kind: "die", unit: "m", perCycle: "1", cleanEvery: "6000", pmLimit: "250000" };
  bad({ ...good, id: "" }, /รหัสแม่พิมพ์/);
  bad({ ...good, id: "DIE 9" }, /ไม่มีช่องว่าง/);
  bad({ ...good, name: " " }, /ชื่อ/);
  bad({ ...good, kind: "x" }, /ชนิด/);
  bad({ ...good, unit: "kg" }, /หน่วยนับ/);
  bad({ ...good, perCycle: "0" }, /cavity/);
  bad({ ...good, cleanEvery: "0" }, /มากกว่า 0/);
  await saved(rig.store.run("saveMold", good));
  assert.deepEqual((await s.call("app_rf_master")).molds[0], { id: "DIE-9", name: "หัวดาย 9", kind: "die", unit: "m", perCycle: 1, cleanEvery: 6000, pmLimit: 250000, usageSinceClean: 0, totalUsage: 0, lastCleanAt: NOW });
  await saved(rig.store.run("saveMold", { ...good, name: "หัวดาย 9 (แก้)", cleanEvery: 7000 }));
  assert.deepEqual([rig.store.data().molds[0].name, rig.store.data().molds[0].cleanEvery], ["หัวดาย 9 (แก้)", 7000]);
  await inSync(s, rig, "mold edited");
  // ยอดใช้งานสะสมเขียนทับจาก client ไม่ได้ (นับจากล็อตฉีด/อบเท่านั้น)
  const forged = await s.mock.client.rpc("app_rf_save", { p_changes: { molds: { upsert: [{ ...(await s.call("app_rf_master")).molds[0], totalUsage: 99 }] } }, p_base_version: (await s.call("app_rf_master")).version, p_action: "saveMold" });
  assert.equal(forged.data.changes.molds.upsert.length, 0, "a usage counter written by a client is ignored");
  await s.as("persona-st");
  assert.match(rig.store.run("cleanMold", { id: "DIE-9" }).error.message, /ไม่มีสิทธิ์/);
  assert.match(rig.store.run("saveMold", good).error.message, /ไม่มีสิทธิ์/);
});
