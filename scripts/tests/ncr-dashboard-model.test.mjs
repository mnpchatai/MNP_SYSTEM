import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const model = require("../../modules/ncr-dashboard-model.js");

const TODAY = "2026-10-06";
const loss = (amount, status = "confirmed", kind = "loss", extra = {}) => ({ amount, cost_status: status, entry_kind: kind, loss_type: "scrap", incurred_on: "2026-10-01", ...extra });
const report = (extra = {}) => ({
  id: "n1", ncr_no: "QA001/69", status: "awaiting_response", issue_date: "2026-10-01", unit: "ชิ้น", qty_total: 1000, qty_defect: 100,
  source: "in_process", causes: [], defect: { code: "surf", name_th: "ผิวบกพร่อง" }, responsibilities: [{ dept: "RB", share: 1 }],
  losses: [], outcome: null, respondedDate: null, closedDate: null, sla_started_on: "2026-10-02", response_due: "2026-10-06", ...extra,
});
const filters = (change = {}) => ({ year: "2026", from: 1, to: 12, dept: "", defect: "", source: "", cause: "", scope: "", ...change });
const run = (reports, change = {}) => {
  const rows = model.deriveRows(reports, TODAY);
  const f = filters(change);
  return { rows, f, list: model.select(rows, f) };
};

test("cancelled reports and voided costs never reach the dashboard", () => {
  const { rows } = run([report({ losses: [loss(100), loss(999, "confirmed", "loss", { voided_at: "x" })] }), report({ id: "n2", status: "cancelled", losses: [loss(9999)] })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fin.confirmed, 100);
});

test("response clock starts when the report reaches the department, and awaiting disposition has no clock", () => {
  const { rows } = run([
    report({ id: "late", sla_started_on: "2026-09-28" }),                                      // due 2026-10-03 -> overdue
    report({ id: "edge", sla_started_on: "2026-10-01" }),                                      // due 2026-10-06 -> not overdue today
    report({ id: "wait", status: "awaiting_disposition", issue_date: "2026-09-01", sla_started_on: null, response_due: "2026-09-06" }),
  ]);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.late.overdue, true);
  assert.equal(byId.edge.overdue, false);
  assert.equal(byId.wait.overdue, false);
  assert.equal(byId.wait.slaDue, null);
  assert.equal(model.addDays("2026-10-01", model.SLA_DAYS), "2026-10-06");
});

test("on-time rate counts unanswered overdue reports as late and ignores a stale response after a return", () => {
  const { rows, f, list } = run([
    report({ id: "ok", status: "awaiting_followup", sla_started_on: "2026-09-20", respondedDate: "2026-09-24" }),
    report({ id: "late-answer", status: "closed", sla_started_on: "2026-09-20", respondedDate: "2026-09-30" }),
    report({ id: "still-late", sla_started_on: "2026-09-20" }),
    report({ id: "returned", sla_started_on: "2026-10-05", respondedDate: "2026-09-24" }),   // back at awaiting_response, not overdue
  ]);
  const s = model.summarize(list, f);
  assert.equal(s.responded, 2); assert.equal(s.onTime, 1); assert.equal(s.overdue, 1);
  assert.equal(s.slaBase, 3); assert.equal(s.onTimeRate, 1 / 3);
  assert.equal(rows.find((row) => row.id === "returned").hasResponse, false);
});

test("headline money is confirmed only; estimated and legacy stay separate and are never zero-filled", () => {
  const { list, f } = run([report({ losses: [loss(1000), loss(400, "confirmed", "recovery"), loss(300, "estimated"), loss(150, "estimated", "recovery"), { amount: 70 }] })]);
  const s = model.summarize(list, f);
  assert.equal(s.gross, 1000); assert.equal(s.recovery, 400); assert.equal(s.net, 600);
  assert.equal(s.estimated, 300); assert.equal(s.estimatedRecovery, 150); assert.equal(s.legacy, 70);
});

test("one time basis: money follows the NCR issue month even when the expense date is later", () => {
  const r = report({ issue_date: "2026-09-15", losses: [loss(100, "confirmed", "loss", { incurred_on: "2026-09-20" }), loss(200, "confirmed", "loss", { incurred_on: "2026-10-04" })] });
  const rows = model.deriveRows([r], TODAY);
  const september = model.summarize(model.select(rows, filters({ from: 9, to: 9 })), filters());
  const october = model.summarize(model.select(rows, filters({ from: 10, to: 10 })), filters());
  assert.equal(september.total, 1); assert.equal(september.net, 300);
  assert.equal(october.total, 0); assert.equal(october.net, 0);
});

test("counts are whole reports; department filter splits money only; department table reconciles", () => {
  const { rows, list, f } = run([
    report({ id: "shared", responsibilities: [{ dept: "RB", share: 0.5 }, { dept: "PK", share: 0.5 }], losses: [loss(1000), loss(200, "confirmed", "recovery")] }),
    report({ id: "solo", responsibilities: [{ dept: "RB", share: 1 }], losses: [loss(400)] }),
  ]);
  const all = model.summarize(list, f);
  assert.equal(all.total, 2); assert.equal(all.net, 1200);
  const table = model.deptTable(list, f);
  assert.equal(table.rows.find((row) => row.dept === "RB").count, 2);
  assert.equal(table.rows.find((row) => row.dept === "PK").count, 1);
  assert.equal(table.rows.reduce((sum, row) => sum + row.net, 0), all.net);
  const rb = filters({ dept: "RB" }); const rbList = model.select(rows, rb);
  const rbSums = model.summarize(rbList, rb);
  assert.equal(rbSums.total, 2); assert.equal(rbSums.net, 400 + 800 * 0.5);
  assert.equal(model.deptTable(rbList, rb).rows.length, 1);
});

test("causes overlap as whole counts and unanalysed reports have their own key", () => {
  const { list } = run([report({ causes: ["man", "machine"] }), report({ id: "n2", causes: ["man"] }), report({ id: "n3", causes: [] })]);
  const counts = Object.fromEntries(model.countBy(list, model.causeKeys).map((item) => [item.key, item.count]));
  assert.deepEqual(counts, { man: 2, machine: 1, [model.NO_CAUSE]: 1 });
  assert.equal(model.select(model.deriveRows([report({ causes: [] })], TODAY), filters({ cause: model.NO_CAUSE })).length, 1);
});

test("assessment is complete only when reviewed with nothing estimated or legacy outstanding", () => {
  const reviewed = { cost_reviewed: true, result_status: "confirmed" };
  const { rows } = run([
    report({ id: "early", status: "awaiting_disposition", sla_started_on: null }),
    report({ id: "done", status: "closed", outcome: reviewed, losses: [loss(100)] }),
    report({ id: "pending", status: "closed", outcome: reviewed, losses: [loss(100), loss(50, "estimated")] }),
    report({ id: "legacy", status: "closed", outcome: reviewed, losses: [{ amount: 10 }] }),
    report({ id: "unreviewed", status: "awaiting_followup", losses: [loss(100)] }),
    report({ id: "zero", status: "closed", outcome: reviewed, losses: [] }),
  ]);
  const flags = Object.fromEntries(rows.map((row) => [row.id, [row.needsAssess, row.assessed]]));
  assert.deepEqual(flags, { early: [false, false], done: [true, true], pending: [true, false], legacy: [true, false], unreviewed: [true, false], zero: [true, true] });
  const s = model.summarize(rows, filters());
  assert.equal(s.need, 5); assert.equal(s.assessed, 2); assert.equal(s.assessedRate, 0.4);
});

test("pareto sorts by the chosen metric, hides empty groups and marks the first 80% as vital", () => {
  const defect = (code) => ({ code, name_th: code });
  const { list, f } = run([
    report({ id: "a", defect: defect("A"), losses: [loss(700)] }), report({ id: "b", defect: defect("B"), losses: [loss(200)] }),
    report({ id: "c", defect: defect("C"), losses: [loss(100)] }), report({ id: "d", defect: defect("D"), losses: [loss(50, "estimated")] }),
  ]);
  const byNet = model.pareto(list, f, "net");
  assert.deepEqual(byNet.map((item) => item.key), ["A", "B", "C"]);
  assert.deepEqual(byNet.map((item) => item.vital), [true, true, false]);
  assert.equal(byNet[2].cumulative, 1);
  assert.equal(model.pareto(list, f, "count").length, 4);
});

test("units never merge and only confirmed outcomes add to scrapped, repaired and returned", () => {
  const { list } = run([
    report({ id: "a", outcome: { result_status: "confirmed", qty_scrapped: 20, qty_repaired: 70, qty_returned: 0 } }),
    report({ id: "b", outcome: { result_status: "draft", qty_scrapped: 99, qty_repaired: 0, qty_returned: 0 } }),
    report({ id: "c", unit: "กก.", qty_defect: 5 }),
  ]);
  const units = model.outcomesByUnit(list);
  const pieces = units.find((item) => item.unit === "ชิ้น");
  assert.equal(units.length, 2); assert.equal(pieces.verified, 1); assert.equal(pieces.scrapped, 20); assert.equal(pieces.defect, 200);
});

test("priority lists overdue first, then the longest wait; closed reports are never listed", () => {
  const { list } = run([
    report({ id: "slow", status: "awaiting_signoff", last_change_on: "2026-08-01" }),
    report({ id: "overdue", sla_started_on: "2026-09-25" }),
    report({ id: "closed", status: "closed", last_change_on: "2026-01-01" }),
    report({ id: "fresh", status: "awaiting_followup", last_change_on: "2026-10-05" }),
  ]);
  assert.deepEqual(model.priority(list, 5).map((row) => row.id), ["overdue", "slow", "fresh"]);
});

test("loss by type keeps repair and rework apart, splits confirmed from estimated, and leaves recovery and legacy out", () => {
  const typed = (type, amount, status = "confirmed", kind = "loss") => loss(amount, status, kind, { loss_type: type });
  const { list, f } = run([
    report({ id: "a", losses: [typed("repair", 1000), typed("rework", 400), typed("repair", 300, "estimated"), typed("claim", 500, "confirmed", "recovery"), { amount: 70, loss_type: "scrap" }] }),
    report({ id: "b", responsibilities: [{ dept: "RB", share: 0.5 }, { dept: "PK", share: 0.5 }], losses: [typed("repair", 200), typed("rework", 900)] }),
  ]);
  const byKey = Object.fromEntries(model.lossesByType(list, f).map((item) => [item.key, item]));
  assert.deepEqual(Object.keys(byKey).sort(), ["repair", "rework"]);
  assert.equal(byKey.repair.confirmed, 1200); assert.equal(byKey.repair.estimated, 300); assert.equal(byKey.repair.count, 2);
  assert.equal(byKey.rework.confirmed, 1300); assert.equal(byKey.rework.estimated, 0);
  assert.deepEqual(model.lossesByType(list, f).map((item) => item.key), ["rework", "repair"]);
  const sums = model.summarize(list, f);
  assert.equal(sums.gross, 2500); assert.equal(sums.estimated, 300);
  const pk = filters({ dept: "PK" }); const pkList = model.select(model.deriveRows([list[1]], TODAY), pk);
  assert.equal(model.lossesByType(pkList, pk).find((item) => item.key === "rework").confirmed, 450);
});

test("loss type filter keeps only reports with a confirmed or estimated entry of that type", () => {
  const typed = (type, status = "confirmed", kind = "loss") => loss(100, status, kind, { loss_type: type });
  const rows = model.deriveRows([
    report({ id: "repair-only", losses: [typed("repair")] }), report({ id: "both", losses: [typed("repair", "estimated"), typed("rework")] }),
    report({ id: "recovery-only", losses: [typed("repair", "confirmed", "recovery")] }), report({ id: "legacy-only", losses: [{ amount: 5, loss_type: "repair" }] }), report({ id: "none" }),
  ], TODAY);
  assert.deepEqual(model.select(rows, filters({ loss: "repair" })).map((row) => row.id), ["repair-only", "both"]);
  assert.deepEqual(model.select(rows, filters({ loss: "rework" })).map((row) => row.id), ["both"]);
});

test("every figure is a subset of the same selected list (drill-through consistency)", () => {
  // deterministic pseudo-random fixture across months, departments and statuses
  let seed = 7; const next = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const statuses = ["awaiting_disposition", "awaiting_response", "awaiting_followup", "awaiting_signoff", "closed"];
  const reports = Array.from({ length: 120 }, (_, i) => report({
    id: `r${i}`, status: statuses[Math.floor(next() * statuses.length)], issue_date: `2026-${String(1 + Math.floor(next() * 10)).padStart(2, "0")}-${String(1 + Math.floor(next() * 27)).padStart(2, "0")}`,
    defect: { code: `d${Math.floor(next() * 4)}`, name_th: "x" }, source: ["incoming", "in_process"][Math.floor(next() * 2)],
    causes: next() < 0.3 ? [] : ["man", "machine"].slice(0, 1 + Math.floor(next() * 2)),
    responsibilities: next() < 0.4 ? [{ dept: "RB", share: 0.5 }, { dept: "PK", share: 0.5 }] : [{ dept: ["RB", "PK", "GR"][Math.floor(next() * 3)], share: 1 }],
    losses: next() < 0.6 ? [loss(Math.round(next() * 5000), next() < 0.7 ? "confirmed" : "estimated"), loss(Math.round(next() * 500), "confirmed", "recovery")] : [],
    sla_started_on: "2026-09-20", respondedDate: next() < 0.5 ? "2026-09-25" : null,
  }));
  const rows = model.deriveRows(reports, TODAY);
  for (const change of [{}, { from: 3, to: 6 }, { dept: "RB" }, { source: "incoming" }, { cause: "man" }, { scope: "open" }, { defect: "d1", from: 5, to: 10 }, { loss: "scrap", dept: "PK" }]) {
    const f = filters(change); const list = model.select(rows, f); const s = model.summarize(list, f);
    assert.equal(s.total, list.length);
    const byType = model.lossesByType(list, f);
    assert.ok(Math.abs(byType.reduce((sum, item) => sum + item.confirmed, 0) - s.gross) < 0.011, "loss types add up to confirmed loss");
    assert.ok(Math.abs(byType.reduce((sum, item) => sum + item.estimated, 0) - s.estimated) < 0.011, "loss types add up to estimates");
    assert.equal(model.countBy(list, (row) => [row.source]).reduce((sum, item) => sum + item.count, 0), s.total);
    assert.equal(model.countBy(list, model.causeKeys).filter((item) => item.key === model.NO_CAUSE).length <= 1, true);
    assert.ok(Math.abs(model.deptTable(list, f).rows.reduce((sum, row) => sum + row.net, 0) - s.net) < 0.011, "department money reconciles to the headline");
    assert.equal(model.pareto(list, f, "count").reduce((sum, item) => sum + item.count, 0), s.total, "pareto by count covers every report once");
    assert.ok(model.pareto(list, f, "net").every((item) => item.net > 0 && item.count <= s.total));
  }
  // trend over the whole year equals the headline for the whole year, with the same non-period filters
  const f = filters({ dept: "PK" }); const whole = model.summarize(model.select(rows, f), f);
  const months = model.monthly(rows, f, 12);
  assert.equal(months.reduce((sum, m) => sum + m.count, 0), whole.total);
  assert.ok(Math.abs(months.reduce((sum, m) => sum + m.net, 0) - whole.net) < 0.011);
});

test("monthly count by department counts whole reports per department and keeps the distinct total", () => {
  const { rows, f } = run([
    report({ id: "a", issue_date: "2026-03-02", status: "closed", responsibilities: [{ dept: "RB", share: 1 }] }),
    report({ id: "b", issue_date: "2026-03-10", responsibilities: [{ dept: "RB", share: 0.5 }, { dept: "PK", share: 0.5 }] }),
    report({ id: "c", issue_date: "2026-03-20", responsibilities: [{ dept: "PK", share: 1 }] }),
    report({ id: "d", issue_date: "2026-03-21", responsibilities: [] }),
    report({ id: "e", issue_date: "2026-04-01", responsibilities: [{ dept: "RB", share: 1 }] }),
  ]);
  const months = model.monthlyByDept(rows, f, 12);
  const march = months[2];
  assert.equal(march.count, 4, "distinct reports");
  assert.equal(march.closed, 1); assert.equal(march.open, 3);
  assert.deepEqual(march.depts.map((item) => [item.dept, item.count, item.closed, item.open]), [["PK", 2, 0, 2], ["RB", 2, 1, 1], ["", 1, 0, 1]], "ordered by code, unassigned last");
  assert.equal(march.depts.reduce((sum, item) => sum + item.count, 0), 5, "the report owned by two departments is counted in both");
  assert.equal(months.reduce((sum, item) => sum + item.count, 0), model.select(rows, f).length, "months add up to the year");
  assert.deepEqual(months[0].depts, [], "a month without reports has no departments");
});

test("monthly count by department follows the department filter and ignores the period filter", () => {
  const { rows, f } = run([
    report({ id: "a", issue_date: "2026-03-10", responsibilities: [{ dept: "RB", share: 0.5 }, { dept: "PK", share: 0.5 }] }),
    report({ id: "b", issue_date: "2026-03-20", responsibilities: [{ dept: "PK", share: 1 }] }),
  ], { dept: "RB", from: 6, to: 6 });
  const march = model.monthlyByDept(rows, f, 12)[2];
  assert.equal(march.count, 1);
  assert.deepEqual(march.depts.map((item) => [item.dept, item.count]), [["RB", 1]]);
});
