import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
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

test("the response is due on response_due (issue date + 5 days), also while the factory manager is still deciding", () => {
  const { rows } = run([
    report({ id: "late", response_due: "2026-10-03" }),                                       // overdue
    report({ id: "edge", response_due: "2026-10-06" }),                                       // due today -> not overdue yet
    report({ id: "wait", status: "awaiting_disposition", issue_date: "2026-09-01", sla_started_on: null, response_due: "2026-09-06" }),
    report({ id: "reached-late", sla_started_on: "2026-10-05", response_due: "2026-09-30" }),  // reaching the department later does not move the date
    report({ id: "answered", status: "awaiting_followup", response_due: "2026-09-30", respondedDate: "2026-10-02" }),
  ]);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.late.overdue, true);
  assert.equal(byId.edge.overdue, false);
  assert.equal(byId.wait.overdue, true, "same rule as the NCR list: late from the issue date");
  assert.equal(byId.wait.slaDue, "2026-09-06");
  assert.equal(byId["reached-late"].overdue, true);
  assert.equal(byId.answered.overdue, false, "an answered report is never overdue");
  assert.equal(byId.answered.onTime, false, "answered after response_due");
  // the NCR list counts the same way (module-ncr.js)
  assert.match(readFileSync(new URL("../../modules/module-ncr.js", import.meta.url), "utf8"), /const RESPONSE_PENDING_STATUSES = \["awaiting_disposition", "awaiting_response"\];\r?\n  const isOverdue = \(ncr\) => RESPONSE_PENDING_STATUSES\.includes\(ncr\.status\) && Boolean\(ncr\.response_due\) && ncr\.response_due < todayBangkok\(\);/);
  assert.equal(model.addDays("2026-10-01", model.SLA_DAYS), "2026-10-06");
});

test("on-time rate counts unanswered overdue reports as late and ignores a stale response after a return", () => {
  const { rows, f, list } = run([
    report({ id: "ok", status: "awaiting_followup", response_due: "2026-09-25", respondedDate: "2026-09-24" }),
    report({ id: "late-answer", status: "closed", response_due: "2026-09-25", respondedDate: "2026-09-30" }),
    report({ id: "still-late", response_due: "2026-09-25" }),
    report({ id: "returned", response_due: "2026-10-10", respondedDate: "2026-09-24" }),   // returned: response_due reset to today + 5, not overdue
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

test("scrap per unit counts only confirmed scrap loss rows and never merges units", () => {
  const scrap = (quantity, status = "confirmed", extra = {}) => loss(quantity * 10, status, "loss", { quantity, unit: "ชิ้น", ...extra });
  const { list } = run([
    report({ id: "a", losses: [scrap(20), scrap(5, "estimated"), scrap(3, "confirmed", { loss_type: "claim" }), scrap(4, "confirmed", { entry_kind: "recovery" })] }),
    report({ id: "b", losses: [scrap(0.1), scrap(0.2)] }),
    report({ id: "c", unit: "กก.", qty_defect: 5, losses: [scrap(2, "confirmed", { unit: "กก." })] }),
    report({ id: "d", losses: [scrap(99, "confirmed", { voided_at: "x" })] }),
  ]);
  const units = model.scrapByUnit(list);
  const pieces = units.find((item) => item.unit === "ชิ้น");
  assert.equal(units.length, 2);
  assert.deepEqual(pieces, { unit: "ชิ้น", count: 3, defect: 300, scrapped: 20.3 });
  assert.equal(units.find((item) => item.unit === "กก.").scrapped, 2);
});

test("priority lists overdue first, then the longest wait; closed reports are never listed", () => {
  const { list } = run([
    report({ id: "slow", status: "awaiting_signoff", last_change_on: "2026-08-01" }),
    report({ id: "overdue", response_due: "2026-09-30" }),
    report({ id: "closed", status: "closed", last_change_on: "2026-01-01" }),
    report({ id: "fresh", status: "awaiting_followup", last_change_on: "2026-10-05" }),
  ]);
  assert.deepEqual(model.priority(list, 5).map((row) => row.id), ["overdue", "slow", "fresh"]);
});

test("prevention follows the 5-day response: waiting only during QA follow-up, late after prevention_due, apart from the response SLA", () => {
  const { rows, f, list } = run([
    report({ id: "waiting", status: "awaiting_followup", respondedDate: "2026-10-03", prevention: null, prevention_due: "2026-10-13", responsibilities: [{ dept: "RB", share: 1 }] }),
    report({ id: "late", status: "awaiting_followup", respondedDate: "2026-09-20", prevention: null, prevention_due: "2026-10-05", last_change_on: "2026-09-20", responsibilities: [{ dept: "GR", share: 1 }] }),
    report({ id: "sent", status: "awaiting_followup", respondedDate: "2026-09-20", prevention: "ทำ PM ทุกเดือน", prevention_due: "2026-10-01" }),
    report({ id: "returned", status: "awaiting_response", response_due: "2026-10-10", prevention: null, prevention_due: "2026-09-30" }),
    report({ id: "signoff", status: "awaiting_signoff", prevention: "ทำ PM ทุกเดือน", prevention_due: "2026-09-01", last_change_on: "2026-08-01" }),
  ]);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.deepEqual(["waiting", "late", "sent", "returned", "signoff"].map((id) => [byId[id].preventionPending, byId[id].preventionOverdue]),
    [[true, false], [true, true], [false, false], [false, false], [false, false]]);
  // a missing prevention never makes the 5-day response late
  assert.equal(byId.late.overdue, false);
  const s = model.summarize(list, f);
  assert.equal(s.preventionPending, 2); assert.equal(s.preventionOverdue, 1); assert.equal(s.overdue, 0);
  assert.deepEqual(model.select(rows, filters({ scope: "prevention" })).map((row) => row.id), ["waiting", "late"]);
  // late prevention ranks with late responses, ahead of a longer wait
  assert.equal(model.priority(list, 5)[0].id, "late");
  const table = model.deptTable(list, f).rows;
  assert.deepEqual(table.filter((row) => row.preventionPending).map((row) => [row.dept, row.preventionPending, row.preventionOverdue]).sort(), [["GR", 1, 1], ["RB", 1, 0]]);
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

test("monthly loss by type reconciles with the headline: confirmed types add up to gross, recovery and estimates stay apart", () => {
  const { rows, f, list } = run([
    report({ id: "a", issue_date: "2026-03-02", losses: [loss(1000), loss(500, "confirmed", "loss", { loss_type: "repair" }), loss(400, "confirmed", "recovery"), loss(300, "estimated", "loss", { loss_type: "rework" }), { amount: 70 }] }),
    report({ id: "b", issue_date: "2026-03-20", losses: [loss(200, "confirmed", "loss", { loss_type: "repair" })] }),
    report({ id: "c", issue_date: "2026-04-01", losses: [loss(50)] }),
  ]);
  const months = model.monthlyByLossType(rows, f, 12);
  const march = months[2];
  assert.deepEqual(march.types.map((item) => [item.type, item.confirmed]).sort(), [["repair", 700], ["scrap", 1000]]);
  assert.equal(march.gross, 1700); assert.equal(march.recovery, 400); assert.equal(march.net, 1300);
  assert.equal(march.estimated, 300, "the estimated rework is not a confirmed bar");
  assert.equal(march.types.reduce((sum, item) => sum + item.confirmed, 0), march.gross, "legacy rows are in neither the bars nor the gross");
  assert.deepEqual(months[0].types, []);
  assert.equal(months.reduce((sum, item) => sum + item.gross, 0), model.summarize(list, f).gross);
});

test("monthly loss by type splits money by the department share", () => {
  const { rows, f } = run([report({ id: "a", issue_date: "2026-03-02", responsibilities: [{ dept: "RB", share: 0.25 }, { dept: "PK", share: 0.75 }], losses: [loss(1000)] })], { dept: "RB" });
  const march = model.monthlyByLossType(rows, f, 12)[2];
  assert.deepEqual(march.types, [{ type: "scrap", confirmed: 250 }]);
  assert.equal(march.net, 250);
});

test("the loss scope keeps reports waiting for loss data, closed ones included, and matches the assessment tile", () => {
  const { rows, f, list } = run([
    report({ id: "closed-open", status: "closed", outcome: { cost_reviewed: false }, losses: [loss(100)] }),
    report({ id: "closed-done", status: "closed", outcome: { cost_reviewed: true }, losses: [loss(100)] }),
    report({ id: "estimate", status: "awaiting_signoff", outcome: { cost_reviewed: true }, losses: [loss(50, "estimated")] }),
    report({ id: "disposition", status: "awaiting_disposition" }),
  ], { scope: "loss" });
  assert.deepEqual(list.map((row) => row.id), ["closed-open", "estimate"]);
  const sums = model.summarize(model.select(rows, { ...f, scope: "" }), f);
  assert.equal(sums.need - sums.assessed, list.length);
});

// ---- หน้าจอ (modules/module-ncr-dashboard.js) วาดในบริบท vm โดยไม่มี DOM ----
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const viewSource = readFileSync(new URL("../../modules/module-ncr-dashboard.js", import.meta.url), "utf8");
const STATUS_LABELS = { awaiting_disposition: "รอผู้จัดการโรงงานพิจารณา", awaiting_response: "รอแผนกตอบ", awaiting_followup: "รอ QA ติดตามผล", awaiting_signoff: "รอลงนามปิด", awaiting_info: "รอข้อมูลเพิ่มเติม", closed: "ปิดแล้ว" };

async function renderView({ reports = [], search = "", section = "page", losses = [], querySelector = () => null } = {}) {
  const root = { innerHTML: "", addEventListener() {}, querySelector };
  const ncrModule = { shared: { STATUS_LABELS, SOURCES: { in_process: "ระหว่างผลิต (In-Process)" }, CAUSES: { man: "บุคลากร" }, LOSS_TYPES: { scrap: "ของเสีย/ทิ้ง", material: "ต้นทุนวัตถุดิบ" }, todayBangkok: () => TODAY, formatQty: (value) => String(value) } };
  const tables = {
    ncr_reports: reports.map((item) => ({
      product_name: "สินค้า", customer_name: "ลูกค้า", qty_total: 1000, qty_defect: 100, unit: "ชิ้น", source: "in_process", causes: [], response_due: "2026-10-06", responded_at: null, closed_at: null, prevention: null, prevention_due: null,
      defect_type: { code: "surf", name_th: "ผิวบกพร่อง" }, ncr_responsibilities: [{ share: 1, department: { code: "RB" } }], issue_date: "2026-10-01", ...item,
    })),
    ncr_losses: losses,
    ncr_outcomes: [],
    ncr_status_history: reports.filter((item) => item.status === "awaiting_response").map((item) => ({ ncr_id: item.id, to_status: "awaiting_response", changed_at: "2026-09-28T03:00:00Z" })),
  };
  const sbQuery = (name) => ({ select() { return this; }, neq() { return this; }, is() { return this; }, order() { return this; }, range: async () => ({ data: tables[name] }) });
  const context = vm.createContext({
    window: { MNP_REQUEST_MODULES: { NCR_CAR: ncrModule }, MNP_NCR_DASHBOARD: model, scrollY: 0, scrollTo() {} },
    document: { getElementById: () => root, activeElement: null },
    sb: { from: sbQuery }, state: { employee: { id: "viewer" } }, app: { innerHTML: "" }, shell: (html) => html, bindShell() {}, loadingShell() {},
    escapeHtml, relation: (value) => value, formatDate: (value) => value, URLSearchParams, console, CSS: { escape: (value) => value },
  });
  vm.runInContext(viewSource, context);
  await ncrModule.pages["ncr-dashboard"](new URLSearchParams(`year=2026${search}`));
  const html = root.innerHTML;
  return section === "page" ? html : html.split(section === "act" ? 'data-card="act"' : 'id="nd-drill"')[1].split("</section>")[0];
}
const NCR_ONE = { id: "n1", ncr_no: "QA001/69", status: "awaiting_response" };
const axisLabels = (html) => [...html.matchAll(/<div class="nd-yax">([\s\S]*?)<\/div>/g)].map((match) => [...match[1].matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((item) => item[1]));

test("a chart with nothing to draw shows one line instead of an axis, and a used axis has whole-number ticks", async () => {
  const html = await renderView({ reports: [NCR_ONE] });
  // จำนวน NCR มีข้อมูล (แกน 2, 1, 0 เป็นจำนวนเต็ม) ส่วนบาทไม่มีความสูญเสียเลย → ไม่วาดแกน "1, 1, 0"
  assert.deepEqual(axisLabels(html), [["2", "1", "0"]]);
  assert.match(html, /<p class="nd-empty">ยังไม่มีความสูญเสียยืนยันหรือประมาณการในปี 2569 ตามตัวกรองนี้<\/p>/);
  const none = await renderView({ reports: [] });
  assert.deepEqual(axisLabels(none), []);
  assert.match(none, /แนวโน้มรายเดือน[\s\S]*<p class="nd-empty">ไม่มี NCR ในปี 2569 ตามตัวกรองนี้<\/p>/);
  assert.doesNotMatch(none, /nd-two">\s*<div class="nd-sub">/, "both charts empty: no per-chart empty lines");
  // บาทน้อยมาก (1 บาท) ก็ยังได้ขีดกลางเป็นจำนวนเต็ม
  const small = await renderView({ reports: [NCR_ONE], losses: [{ ncr_id: "n1", loss_type: "scrap", amount: 1, cost_status: "confirmed", entry_kind: "loss", incurred_on: "2026-10-01" }] });
  assert.deepEqual(axisLabels(small), [["2", "1", "0"], ["2", "1", "0"]]);
});

test("each NCR is on the page once: the drill list skips what act-now shows, and a status filter replaces act-now", async () => {
  const page = await renderView({ reports: [NCR_ONE] });
  assert.equal(page.match(/>QA001\/69</g).length, 1, "listed in act-now only");
  // รอบ 11: ทุกใบอยู่ใน "ต้องลงมือตอนนี้" แล้ว จึงไม่มีการ์ดรายการประกอบตัวเลข
  assert.doesNotMatch(page, /id="nd-drill"|ทุกใบอยู่ใน “ต้องลงมือตอนนี้” ด้านบนแล้ว/);
  const filtered = await renderView({ reports: [NCR_ONE], search: "&scope=open" });
  assert.equal(filtered.match(/>QA001\/69</g).length, 1, "the filtered list is the only place");
  assert.doesNotMatch(filtered, /data-card="act"|ไม่แสดงซ้ำ/);
  const closed = await renderView({ reports: [{ id: "n2", ncr_no: "QA002/69", status: "closed" }] });
  assert.match(closed, /<table class="nd-rowlink">[\s\S]*>QA002\/69</, "a closed NCR is not in act-now, so the drill list keeps it");
});

test("act-now says who is waited on once: the status names the role, a second line only adds the department", async () => {
  const act = (status, extra = {}) => renderView({ reports: [{ id: "n1", ncr_no: "QA001/69", status, ...extra }], section: "act" });
  const disposition = await act("awaiting_disposition");
  assert.match(disposition, /<td>รอผู้จัดการโรงงานพิจารณา<\/td>/);
  assert.doesNotMatch(disposition, /ผจก\./);
  assert.match(await act("awaiting_response"), /<td>รอแผนกตอบ<br><span class="nd-muted">RB<\/span><\/td>/);
  assert.match(await act("awaiting_signoff"), /<td>รอลงนามปิด<\/td>/);
  assert.match(await act("awaiting_followup", { prevention: "แนวทางป้องกัน" }), /<td>รอ QA ติดตามผล<\/td>/);
  assert.match(await act("awaiting_followup"), /<td>รอ QA ติดตามผล<br><span class="nd-muted">แผนก RB ส่งแนวทางป้องกัน<\/span><\/td>/);
});

test("pareto falls back to the count when no baht is confirmed, and says so once", async () => {
  const pareto = (html) => html.split('data-card="pareto"')[1].split("</section>")[0];
  const noBaht = pareto(await renderView({ reports: [NCR_ONE] }));
  assert.doesNotMatch(noBaht, /ไม่มีข้อมูลในช่วงที่เลือก/, "NCRs exist, so the chart is not empty");
  assert.match(noBaht, /<span class="nd-val">1 ใบ<\/span>/, "bars are counted in reports");
  // รอบ 13: บอกครั้งเดียวที่ title ของชิปเรียงตามบาท ไม่มีบรรทัดซ้ำใต้ชิป
  assert.doesNotMatch(noBaht, /<p class="nd-hint">ยังไม่มีบาทที่ยืนยันในช่วงนี้/);
  // บอกบนชิปเอง (title ใช้ไม่ได้บนจอสัมผัส)
  assert.match(noBaht, /aria-current="false">เรียงตามบาท<small class="nd-chip-note"> · ยังไม่มีบาทที่ยืนยัน<\/small><\/a><a [^>]*aria-current="true">เรียงตามจำนวนใบ/);
  assert.match(noBaht, /aria-current="false"[^>]*>เรียงตามบาท[^]*?<\/a><a [^>]*aria-current="true">เรียงตามจำนวนใบ/, "the sort control shows the count as the active choice");
  const withBaht = pareto(await renderView({ reports: [NCR_ONE], losses: [{ ncr_id: "n1", loss_type: "scrap", amount: 500, cost_status: "confirmed", entry_kind: "loss", incurred_on: "2026-10-01" }] }));
  assert.match(withBaht, /500 ฿/);
  assert.doesNotMatch(withBaht, /จึงเรียงตามจำนวนใบ/);
  assert.match(withBaht, /aria-current="true">เรียงตามบาท/);
  const none = pareto(await renderView({ reports: [] }));
  assert.match(none, /ไม่มีข้อมูลในช่วงที่เลือก/, "no NCR at all keeps the empty line");
  assert.doesNotMatch(none, /จึงเรียงตามจำนวนใบ/);
});

// โครงจำลองของ DOM แค่พอให้ placeDrill ทำงาน: การ์ดเป็นพี่น้องกัน มี class และ after()
function fakeBoard(classes) {
  const cards = classes.map((cls, index) => ({ name: `c${index}`, cls, classList: { contains: (name) => cls.split(" ").includes(name) }, after(node) { node.placedAfter = this.name; } }));
  cards.forEach((card, index) => { card.previousElementSibling = cards[index - 1] ?? null; card.nextElementSibling = cards[index + 1] ?? null; });
  const drill = { placedAfter: null };
  return { cards, drill };
}

test("the filtered list goes after the right card of a half-width pair, so no half card is left alone in its row", async () => {
  const place = async (classes, hostAt) => {
    const board = fakeBoard(classes);
    await renderView({ reports: [NCR_ONE], search: "&scope=open", querySelector: (selector) => (selector === "#nd-drill" ? board.drill : selector === ".nd-summary" ? { closest: () => board.cards[hostAt] } : null) });
    return board.drill.placedAfter;
  };
  const layout = ["card", "card", "card nd-half", "card nd-half", "card"];
  assert.equal(await place(layout, 2), "c3", "after the pair, not between the halves");
  assert.equal(await place(layout, 3), "c3", "the right card of a pair keeps its place");
  assert.equal(await place(layout, 1), "c1", "a full-width card is unchanged");
  assert.equal(await place(["card nd-half", "card nd-half", "card nd-half", "card nd-half"], 2), "c3", "the second pair of four");
  assert.equal(await place(["card nd-half", "card nd-half", "card nd-half"], 2), "c2", "an odd last card has no partner");
});

test("pareto and loss cards are marked for the two-column grid; the department table is not", async () => {
  const page = await renderView({ reports: [NCR_ONE] });
  // รอบ 12: ยังไม่มีความสูญเสียเลย ไม่มีการ์ดแยกประเภทที่ว่าง (กราฟรายเดือนบอกแล้ว) Pareto เต็มแถว
  assert.match(page, /class="card nd-card" data-card="pareto"/);
  assert.doesNotMatch(page, /data-card="losstype"/);
  for (const card of ["act", "trend", "dept", "scrap"]) assert.match(page, new RegExp(`class="card nd-card" data-card="${card}"`));
});
