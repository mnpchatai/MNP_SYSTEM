import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const costs = require("../../modules/ncr-costs.js");
const { aggregate } = require("../../modules/ncr-analysis.js");
const entry = (change = {}) => ({ loss_type: "scrap", entry_kind: "loss", cost_status: "estimated", component: "quantity", quantity: 20, unit_cost: 50, unit: "ชิ้น", incurred_on: "2026-10-01", ...change });
const loss = (amount, status = "confirmed", kind = "loss", extra = {}) => ({ amount, cost_status: status, entry_kind: kind, loss_type: "scrap", incurred_on: "2026-10-01", ...extra });
const labels = { CAUSES: {}, SOURCES: {}, STATUS_LABELS: {}, STATUS_ORDER: ["awaiting_response", "closed"] };
const filter = (change = {}) => ({ year: "2026", from: 10, to: 10, dept: "", defect: "", source: "", metric: "value", basis: "cost", ...change });
const report = (extra = {}) => ({ id: "n1", status: "awaiting_response", issue_date: "2026-10-01", unit: "ชิ้น", qty_total: 1000, qty_sampled: 50, qty_defect: 100, source: "in_process", responsibilities: [], losses: [], ...extra });
const analyze = (reports, filters = filter()) => aggregate(reports, filters, labels, () => false);

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
  assert.equal(costs.fieldSpec("rework","labor").unit,"คน-ชม.");
  assert.equal(costs.fieldSpec("downtime","quantity").unit,"ชม.");
  assert.throws(() => costs.makeEntry(entry({loss_type:"rework"})),/INVALID_LOSS_COMPONENT/);
  assert.throws(() => costs.makeEntry(entry({entry_kind:"recovery",component:"amount",quantity:2})),/INVALID_LOSS/);
  assert.throws(() => costs.makeEntry(entry({loss_type:"other",component:"amount",quantity:1})),/INVALID_LOSS_NOTE/);
});
test("NCR counts stay one per report regardless of costs or multiple responsible departments", () => {
  const r = report({responsibilities:[{dept:"QA",share:.5},{dept:"RB",share:.5}], losses:[loss(1000),loss(600),loss(200),loss(400),loss(500,"confirmed","recovery")],outcome:{result_status:"confirmed",qty_scrapped:20,qty_repaired:80,qty_returned:0,cost_reviewed:true}});
  const all = analyze([r]); assert.equal(all.total,1); assert.equal(all.value,2200); assert.equal(all.net,1700); assert.equal(all.units[0].scrap,20); assert.equal(all.units[0].defect,100);
  const dept=analyze([r],filter({dept:"QA"})); assert.equal(dept.total,1); assert.equal(dept.value,1100); assert.equal(dept.net,850);
  assert.equal(analyze([r],filter({metric:"count"})).byDept[0].value,1);
});
test("cost month includes later expenses for an earlier NCR and issue basis includes lifetime expense", () => {
  const r=report({issue_date:"2026-09-15",losses:[loss(100),loss(200,"confirmed","loss",{incurred_on:"2026-09-20"})]});
  const october=analyze([r]); assert.equal(october.total,0); assert.equal(october.value,100); assert.equal(october.months[0].open,100);
  const september=analyze([r],filter({from:9,to:9,basis:"issue"})); assert.equal(september.total,1); assert.equal(september.value,300); assert.equal(september.months[0].open,300);
});
test("cancelled reports and voided costs are excluded; confirmed costs count before NCR closure", () => {
  const r=analyze([report({losses:[loss(100),loss(999,"confirmed","loss",{voided_at:"now"})]}),report({id:"n2",status:"cancelled",losses:[loss(9999)]})]);
  assert.equal(r.total,1); assert.equal(r.value,100); assert.equal(r.closed,0);
});
test("draft outcomes remain unavailable, and different quantity units are kept separate", () => {
  const r=analyze([report({outcome:{result_status:"draft",qty_scrapped:100}}),report({id:"n2",unit:"กก.",qty_defect:2,outcome:{result_status:"confirmed",qty_scrapped:2,qty_repaired:0,qty_returned:0}})]);
  assert.equal(r.units.length,2); assert.equal(r.units.find((u)=>u.unit==="ชิ้น").verified,0); assert.equal(r.unverifiedOutcomes,1); assert.equal(r.ngRate,null);
});
test("a missing assessment never becomes zero loss; a reviewed zero remains distinguishable", () => {
  const r=analyze([report(),report({id:"n2",outcome:{result_status:"confirmed",cost_reviewed:true,qty_scrapped:0,qty_repaired:0,qty_returned:0}})]);
  assert.equal(r.pendingAssessment,1); assert.equal(r.value,0);
  assert.equal(analyze([report({outcome:{cost_reviewed:true},losses:[loss(10,"estimated")]})]).pendingAssessment,1);
});
test("month chart sums match headline and estimates/recovery stay out of confirmed loss charts", () => {
  const r=analyze([report({losses:[loss(100),loss(150,"confirmed","loss",{incurred_on:"2026-11-01"}),loss(20,"estimated"),loss(50,"confirmed","recovery") ]})],filter({to:11}));
  assert.equal(r.months.reduce((s,m)=>s+m.open+m.closed,0),r.value); assert.equal(r.value,250); assert.equal(r.byLossType[0].value,250); assert.equal(r.net,200);
});
