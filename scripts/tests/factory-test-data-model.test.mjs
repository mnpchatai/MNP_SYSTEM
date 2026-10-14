import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const model = createRequire(import.meta.url)("../../modules/factory-test-data-model.js");
const MIGRATION = "supabase/migrations/20261014030000_factory_sandbox_test_data_summary.sql";

test("the groups match exactly the counts the summary RPC returns", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const body = sql.slice(sql.indexOf("create or replace function private.factory_test_data_counts()"), sql.indexOf("revoke all on function private.factory_test_data_counts()"));
  const keys = [...body.matchAll(/^\s+'([a-z_]+)', \(select/gm)].map((match) => match[1]);
  assert.deepEqual([...keys].sort(), model.GROUPS.map((group) => group.key).sort());
});

test("every table the purge deletes from is counted by the shared helper", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const purge = sql.slice(sql.indexOf("create or replace function public.app_sandbox_purge_factory()"));
  const deleted = new Set([...purge.matchAll(/delete from public\.(factory_[a-z_]+) where is_test/g)].map((match) => match[1]));
  const helper = sql.slice(0, sql.indexOf("revoke all on function private.factory_test_data_counts()"));
  const counted = new Set([...helper.matchAll(/from public\.(factory_[a-z_]+) where is_test/g)].map((match) => match[1]));
  assert.ok(deleted.size >= 20, `found ${deleted.size} tables`);
  assert.deepEqual([...deleted].filter((table) => !counted.has(table)), [], "a purged table is missing from the counts");
});

test("rows keep every group in order and treat unknown or negative values as zero", () => {
  const rows = model.rows({ items: 27, boms: "17", jobs: -3, lots: 1.5, attachments: "x", details: 120 });
  assert.deepEqual(rows.map((row) => row.key), model.GROUPS.map((group) => group.key));
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.key, row.count])), {
    items: 27, boms: 17, routings: 0, production_orders: 0, material_orders: 0, jobs: 0,
    inventory_movements: 0, lots: 0, attachments: 0, work_centers: 0, warehouses: 0, details: 120,
  });
  assert.equal(model.total(null), 0);
  assert.equal(model.total({ items: 27, boms: 17, details: 120 }), 164);
});

test("the purge plan lists only groups that have data", () => {
  assert.deepEqual(model.purgePlan({ items: 2, boms: 0, attachments: 3 }).map((row) => [row.key, row.count]), [["items", 2], ["attachments", 3]]);
  assert.deepEqual(model.purgePlan({}), []);
});

test("seed set state follows the flags the database reports", () => {
  const [sample, trial, megaform] = model.SETS;
  assert.deepEqual(model.SETS.map((set) => set.rpc), ["app_sandbox_seed_factory", "app_sandbox_seed_factory_trial", "app_sandbox_seed_factory_megaform"]);
  assert.equal(model.setState(sample, { sample_available: true }), "ready");
  assert.equal(model.setState(sample, { sample_available: false }), "blocked");
  assert.equal(model.setState(trial, { trial_loaded: true }), "loaded");
  assert.equal(model.setState(trial, { trial_loaded: false }), "ready");
  assert.equal(model.setState(megaform, { megaform_loaded: true }), "loaded");
  assert.equal(model.setState(megaform, undefined), "ready", "a missing summary never claims a set is loaded");
  assert.equal(model.setState(sample, undefined), "blocked", "a missing summary never offers the empty-only set");
  for (const state of ["loaded", "ready", "blocked"]) assert.ok(model.SET_STATE_LABELS[state]);
});

test("seed messages keep the wording of the old item register buttons", () => {
  assert.equal(model.seedMessage("sample", { seeded: true, items: 16 }), "เติมข้อมูลตัวอย่างแล้ว 16 รายการ");
  assert.equal(model.seedMessage("trial", { seeded: true, items: 27, boms: 17, steps: 77 }), "เติมชุดทดลองแล้ว 27 Item · 17 BOM · 77 ขั้นตอนการผลิต");
  assert.equal(model.seedMessage("megaform", { seeded: true, items: 355, boms: 229, steps: 1896, orders: 14, jobs: 173 }),
    "เติมชุด MEGAFORM แล้ว 355 Item · 229 BOM · ใบสั่งผลิต 14 ใบ · ใบงาน 173 ใบ");
  assert.equal(model.seedMessage("megaform", { seeded: true, items: 300, reused_items: 55, boms: 229, orders: 14, jobs: 173 }),
    "เติมชุด MEGAFORM แล้ว 300 Item (ใช้ Item เดิมที่รหัสซ้ำ 55) · 229 BOM · ใบสั่งผลิต 14 ใบ · ใบงาน 173 ใบ");
  assert.equal(model.seedMessage("sample", { seeded: false }), "มีข้อมูลทดสอบอยู่แล้ว ไม่ได้เติมซ้ำ");
  assert.equal(model.seedMessage("trial", { seeded: false }), "มีชุดทดลองอยู่แล้ว ไม่ได้เติมซ้ำ");
  assert.equal(model.seedMessage("megaform", null), "มีชุด MEGAFORM อยู่แล้ว ไม่ได้เติมซ้ำ");
});

test("the purge message names the first three groups and sums the rest", () => {
  assert.equal(model.purgeMessage({ deleted: 2, counts: { items: 2, boms: 1 } }), "ล้างข้อมูลทดสอบแล้ว Item สินค้า 2 · โครงสร้างสินค้า (BOM) 1");
  assert.equal(model.purgeMessage({ deleted: 27, counts: { items: 27, boms: 17, routings: 17, lots: 4, details: 1200 } }),
    "ล้างข้อมูลทดสอบแล้ว Item สินค้า 27 · โครงสร้างสินค้า (BOM) 17 · ขั้นตอนการผลิต (Routing) 17 และอื่น ๆ อีก 1,204 แถว");
  assert.equal(model.purgeMessage({ deleted: 0, counts: {} }), "ไม่มีข้อมูลทดสอบให้ล้าง");
  assert.equal(model.purgeMessage({ deleted: 5 }), "ล้างข้อมูลทดสอบแล้ว 5 Item", "an older database without counts still gets a message");
});

test("the model cannot be changed by callers", () => {
  assert.throws(() => { "use strict"; model.GROUPS.push({}); }, TypeError);
  assert.throws(() => { "use strict"; model.SETS[0].rpc = "app_evil"; }, TypeError);
  assert.throws(() => { "use strict"; model.SETS[0].includes.push("x"); }, TypeError);
});
