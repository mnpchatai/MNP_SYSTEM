import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const costs = require("../../modules/ncr-costs.js");
const entry = (change = {}) => ({ loss_type: "scrap", entry_kind: "loss", cost_status: "estimated", component: "quantity", quantity: 20, unit_cost: 50, unit: "ชิ้น", incurred_on: "2026-10-01", ...change });
const loss = (amount, status = "confirmed", kind = "loss", extra = {}) => ({ amount, cost_status: status, entry_kind: kind, loss_type: "scrap", incurred_on: "2026-10-01", ...extra });

test("confirmed loss, recovery, estimates and legacy reconcile without counting voids", () => {
  const r = costs.summarize([loss(2200), loss(500,"confirmed","recovery"), loss(300,"estimated"), loss(150,"estimated","recovery"), { amount: 999 }, loss(100,"confirmed","loss",{voided_at:"now"})]);
  assert.equal(r.net,1700); assert.equal(r.estimated,300); assert.equal(r.estimatedRecovery,150); assert.equal(r.legacy,999); assert.equal(r.pending,3);
});
test("missing and invalid inputs are rejected while genuine zero rate is accepted", () => {
  for(const change of [{quantity:""},{unit_cost:""},{quantity:NaN},{quantity:0.0001},{unit_cost:-1},{quantity:1e9,unit_cost:1e9}]) assert.throws(() => costs.makeEntry(entry(change)), /INVALID_LOSS/);
  assert.equal(costs.makeEntry(entry({unit_cost:0})).unit_cost,0);
  assert.equal(costs.makeEntry(entry({quantity:1.2345,unit_cost:1.235})).quantity,1.235);
});
test("confirmation requires evidence and a real calendar date", () => {
  assert.throws(() => costs.makeEntry(entry({cost_status:"confirmed"})),/LOSS_EVIDENCE_REQUIRED/);
  assert.throws(() => costs.makeEntry(entry({incurred_on:"2026-02-30"})),/INVALID_LOSS_DATE/);
  assert.equal(costs.makeEntry(entry({cost_status:"confirmed",evidence_ref:" ใบต้นทุน-01 "})).evidence_ref,"ใบต้นทุน-01");
});
test("rework exposes labor, material and external; flat document totals use quantity one", () => {
  assert.deepEqual(costs.allowedComponents("rework"),["labor","material","external"]);
  assert.deepEqual(costs.allowedComponents("repair"),["labor","material","external"]);
  assert.notEqual(costs.TYPES.repair,costs.TYPES.rework);
  assert.equal(costs.makeEntry(entry({loss_type:"repair",component:"labor",quantity:6,unit:"คน-ชม.",unit_cost:60})).loss_type,"repair");
  assert.throws(() => costs.makeEntry(entry({loss_type:"repair"})),/INVALID_LOSS_COMPONENT/);
  assert.equal(costs.fieldSpec("rework","labor").unit,"คน-ชม.");
  assert.equal(costs.fieldSpec("downtime","quantity").unit,"ชม.");
  assert.throws(() => costs.makeEntry(entry({loss_type:"rework"})),/INVALID_LOSS_COMPONENT/);
  assert.throws(() => costs.makeEntry(entry({entry_kind:"recovery",component:"amount",quantity:2})),/INVALID_LOSS/);
  assert.throws(() => costs.makeEntry(entry({loss_type:"other",component:"amount",quantity:1})),/INVALID_LOSS_NOTE/);
});
