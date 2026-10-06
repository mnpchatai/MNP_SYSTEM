import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const model = require("../../modules/mt-dashboard-model.js");
const center = require("../../modules/request-center.js");

const TODAY = "2026-10-06";
const req = (extra = {}) => ({
  id: "r1", request_no: "RB001/69", status: "in_progress", current_step: 0, is_urgent: false, doc_type: "repair",
  machine_code: "M1", machine_name: "เครื่อง 1", requester_name: "ก", dept: "RB",
  submitted_at: "2026-10-01T02:00:00Z", completed_at: null, work_expected_date: "2026-10-10", history: [], verifications: [], ...extra,
});
const at = (to_status, created_at) => ({ to_status, created_at });
const filters = (change = {}) => ({ year: "2026", from: 1, to: 12, dept: "", doc: "", scope: "", stage: "", ...change });
const derive = (requests) => model.deriveRows(requests, TODAY);
const byId = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));

test("drafts and cancelled requests never reach the dashboard, rejected ones count in the total only", () => {
  const rows = derive([req({ id: "ok" }), req({ id: "draft", status: "draft" }), req({ id: "gone", status: "cancelled" }), req({ id: "no", status: "rejected" })]);
  assert.deepEqual(rows.map((row) => row.id), ["ok", "no"]);
  const sums = model.summarize(model.select(rows, filters()));
  assert.equal(sums.total, 2); assert.equal(sums.rejected, 1); assert.equal(sums.open, 1);
  assert.equal(byId(rows).no.isOpen, false);
  assert.deepEqual(byId(rows).no.phases, {});
});

test("open means exactly the request center's pending list for MT_REPAIR, so it matches the module header count", () => {
  const statuses = ["pending_approval", "more_info", "approved", "pending_assign", "assigned", "in_progress", "pending_verify", "completed", "rejected"];
  const rows = derive(statuses.map((status) => req({ id: status, status })));
  const open = rows.filter((row) => row.isOpen).map((row) => row.status).sort();
  assert.deepEqual(open, [...center.pendingStatuses("MT_REPAIR")].sort());
  // every open request sits in exactly one stage, so stage counts add up to the open count
  const stages = model.stageSummary(rows.filter((row) => row.isOpen));
  assert.equal(stages.reduce((sum, stage) => sum + stage.count, 0), open.length);
});

test("stage follows status, and the approval step decides which manager is being waited on", () => {
  const rows = byId(derive([
    req({ id: "a", status: "pending_approval", current_step: 1 }),
    req({ id: "b", status: "pending_approval", current_step: 2 }),
    req({ id: "c", status: "more_info" }),
    req({ id: "d", status: "pending_assign" }),
    req({ id: "e", status: "assigned" }),
    req({ id: "f", status: "in_progress" }),
    req({ id: "g", status: "pending_verify" }),
    req({ id: "h", status: "completed", completed_at: "2026-10-02T02:00:00Z" }),
  ]));
  assert.deepEqual(["a", "b", "c", "d", "e", "f", "g"].map((id) => rows[id].stage), ["approve_fm", "approve_gm", "more_info", "assign", "start", "repair", "verify"]);
  assert.equal(rows.h.stage, null);
});

test("overdue belongs to the technician's stages only and the expected date itself is not late", () => {
  const rows = byId(derive([
    req({ id: "late", status: "in_progress", work_expected_date: "2026-10-03" }),
    req({ id: "edge", status: "assigned", work_expected_date: TODAY }),
    req({ id: "waiting-req", status: "pending_verify", work_expected_date: "2026-09-01" }),
    req({ id: "waiting-approver", status: "pending_approval", work_expected_date: "2026-09-01" }),
    req({ id: "no-date", status: "assigned", work_expected_date: null }),
  ]));
  assert.equal(rows.late.overdue, true); assert.equal(rows.late.daysOverdue, 3);
  assert.equal(rows.edge.overdue, false);
  assert.equal(rows["waiting-req"].overdue, false);
  assert.equal(rows["waiting-approver"].overdue, false);
  assert.equal(rows["no-date"].overdue, false);
});

test("on-time rate: completed on or before the expected date, and an overdue open job counts as late", () => {
  const rows = derive([
    req({ id: "in-time", status: "completed", submitted_at: "2026-09-20T02:00:00Z", completed_at: "2026-10-02T09:00:00Z", work_expected_date: "2026-10-02" }),
    req({ id: "late-done", status: "completed", submitted_at: "2026-09-20T02:00:00Z", completed_at: "2026-10-04T09:00:00Z", work_expected_date: "2026-10-02" }),
    req({ id: "late-open", status: "in_progress", work_expected_date: "2026-10-03" }),
    req({ id: "fine-open", status: "in_progress", work_expected_date: "2026-10-20" }),
    req({ id: "no-date", status: "completed", completed_at: "2026-10-02T09:00:00Z", work_expected_date: null }),
  ]);
  const sums = model.summarize(rows);
  assert.equal(sums.onTime, 1); assert.equal(sums.onTimeBase, 3); assert.equal(sums.onTimeRate, 1 / 3);
  assert.equal(sums.overdue, 1);
});

test("dates follow Bangkok time, not UTC", () => {
  const [row] = derive([req({ submitted_at: "2026-09-30T18:00:00Z" })]);   // 01:00 on 1 Oct in Bangkok
  assert.equal(row.submittedOn, "2026-10-01"); assert.equal(row.year, "2026"); assert.equal(row.month, 10);
  const completed = derive([req({ status: "completed", completed_at: "2026-10-05T17:30:00Z" })])[0];
  assert.equal(completed.completedOn, "2026-10-06");
});

test("backlog ignores the period; period figures do not; a backlog filter switches the list to backlog basis", () => {
  const rows = derive([
    req({ id: "old-open", status: "assigned", submitted_at: "2025-12-20T02:00:00Z", work_expected_date: "2026-01-10" }),
    req({ id: "new-open", status: "pending_assign", submitted_at: "2026-10-02T02:00:00Z" }),
    req({ id: "new-done", status: "completed", submitted_at: "2026-10-01T02:00:00Z", completed_at: "2026-10-03T02:00:00Z" }),
  ]);
  const october = filters({ from: 10, to: 10 });
  assert.deepEqual(model.backlog(rows, october).map((row) => row.id).sort(), ["new-open", "old-open"]);
  const period = model.listFor(rows, october);
  assert.equal(period.basis, "period");
  assert.deepEqual(period.list.map((row) => row.id).sort(), ["new-done", "new-open"]);
  const overdue = model.listFor(rows, filters({ ...october, scope: "overdue" }));
  assert.equal(overdue.basis, "backlog");
  assert.deepEqual(overdue.list.map((row) => row.id), ["old-open"]);
  const stage = model.listFor(rows, filters({ ...october, stage: "assign" }));
  assert.deepEqual(stage.list.map((row) => row.id), ["new-open"]);
  // dept and doc filters narrow both bases
  assert.equal(model.backlog(rows, filters({ dept: "QA" })).length, 0);
  assert.equal(model.select(rows, filters({ doc: "request" })).length, 0);
});

test("urgent filter only keeps open urgent requests", () => {
  const rows = derive([
    req({ id: "u-open", is_urgent: true, status: "assigned" }),
    req({ id: "u-done", is_urgent: true, status: "completed", completed_at: "2026-10-02T02:00:00Z" }),
    req({ id: "n-open", status: "assigned" }),
  ]);
  assert.deepEqual(model.listFor(rows, filters({ scope: "urgent" })).list.map((row) => row.id), ["u-open"]);
  assert.equal(model.summarize(rows).urgentOpen, 1);
});

test("phase durations come from status history and only count once the phase has been left", () => {
  const history = [at("pending_approval", "2026-10-01T00:00:00Z"), at("pending_assign", "2026-10-03T00:00:00Z"), at("assigned", "2026-10-04T12:00:00Z"), at("in_progress", "2026-10-05T00:00:00Z"), at("pending_verify", "2026-10-08T12:00:00Z"), at("completed", "2026-10-09T12:00:00Z")];
  const [done] = derive([req({ id: "done", status: "completed", submitted_at: "2026-10-01T00:00:00Z", completed_at: "2026-10-09T12:00:00Z", history })]);
  assert.deepEqual(done.phases, { approval: 2, assign: 1.5, repair: 4, verify: 1 });
  assert.equal(done.cycleDays, 8.5);

  const [running] = derive([req({ id: "running", status: "in_progress", submitted_at: "2026-10-01T00:00:00Z", history: history.slice(0, 4) })]);
  assert.deepEqual(running.phases, { approval: 2, assign: 1.5, repair: null, verify: null });
  assert.equal(running.cycleDays, null);
});

test("a failed inspection counts as repair time, not inspection time", () => {
  const history = [at("pending_assign", "2026-10-03T00:00:00Z"), at("assigned", "2026-10-04T12:00:00Z"), at("pending_verify", "2026-10-06T12:00:00Z"), at("assigned", "2026-10-07T00:00:00Z"), at("pending_verify", "2026-10-08T12:00:00Z"), at("completed", "2026-10-09T12:00:00Z")];
  const [done] = derive([req({ status: "completed", submitted_at: "2026-10-01T00:00:00Z", completed_at: "2026-10-09T12:00:00Z", history, verifications: [{ result: "fail" }, { result: "pass" }] })]);
  assert.equal(done.phases.repair, 4); assert.equal(done.phases.verify, 1);
  // sent back and being reworked right now: the repair phase has not finished again
  const [rework] = derive([req({ status: "assigned", submitted_at: "2026-10-01T00:00:00Z", history: history.slice(0, 4), verifications: [{ result: "fail" }] })]);
  assert.equal(rework.phases.repair, null);
});

test("phase summary averages only requests that finished the phase and reports how many", () => {
  const finished = (id, assignedAt) => req({ id, status: "assigned", submitted_at: "2026-10-01T00:00:00Z", history: [at("pending_assign", "2026-10-02T00:00:00Z"), at("assigned", assignedAt)] });
  const rows = derive([finished("a", "2026-10-03T00:00:00Z"), finished("b", "2026-10-05T00:00:00Z"), req({ id: "c", status: "pending_assign", history: [at("pending_assign", "2026-10-04T00:00:00Z")] })]);
  const assign = model.phaseSummary(rows).find((phase) => phase.key === "assign");
  assert.equal(assign.n, 2); assert.equal(assign.avgDays, 2); assert.equal(assign.medianDays, 2);
  const repair = model.phaseSummary(rows).find((phase) => phase.key === "repair");
  assert.equal(repair.n, 0); assert.equal(repair.avgDays, null);
});

test("cycle time is average and median over completed requests only", () => {
  const done = (id, days) => req({ id, status: "completed", submitted_at: "2026-09-01T00:00:00Z", completed_at: new Date(Date.parse("2026-09-01T00:00:00Z") + days * 86400000).toISOString() });
  const sums = model.summarize(derive([done("a", 1), done("b", 2), done("c", 9), req({ id: "open" })]));
  assert.equal(sums.cycleCount, 3); assert.equal(sums.avgCycle, 4); assert.equal(sums.medianCycle, 2);
  assert.equal(model.summarize([]).avgCycle, null);
});

test("quality: failed inspections are measured against inspected requests, more-info against all requests", () => {
  const rows = derive([
    req({ id: "pass", status: "completed", completed_at: "2026-10-02T02:00:00Z", verifications: [{ result: "pass" }] }),
    req({ id: "failed-then-pass", status: "completed", completed_at: "2026-10-03T02:00:00Z", verifications: [{ result: "fail" }, { result: "pass" }], history: [at("more_info", "2026-10-01T05:00:00Z")] }),
    req({ id: "not-inspected", status: "in_progress" }),
    req({ id: "also-not", status: "in_progress" }),
  ]);
  const sums = model.summarize(rows);
  assert.equal(sums.verified, 2); assert.equal(sums.verifyFailed, 1); assert.equal(sums.verifyFailRate, 0.5);
  assert.equal(sums.moreInfo, 1); assert.equal(sums.moreInfoRate, 0.25);
  assert.equal(model.summarize([]).verifyFailRate, null);
});

test("stage summary reports age, oldest, overdue and urgent counts per stage in workflow order", () => {
  const rows = derive([
    req({ id: "a", status: "assigned", history: [at("assigned", "2026-10-01T05:00:00Z")], work_expected_date: "2026-10-02", is_urgent: true }),
    req({ id: "b", status: "assigned", history: [at("assigned", "2026-10-05T05:00:00Z")] }),
    req({ id: "c", status: "pending_assign", history: [at("pending_assign", "2026-10-06T01:00:00Z")] }),
  ]);
  const stages = model.stageSummary(rows.filter((row) => row.isOpen));
  assert.deepEqual(stages.map((stage) => stage.key), model.STAGES.map((stage) => stage.key));
  const start = stages.find((stage) => stage.key === "start");
  assert.equal(start.count, 2); assert.equal(start.maxDays, 5); assert.equal(start.avgDays, 3);
  assert.equal(start.overdue, 1); assert.equal(start.urgent, 1);
  assert.equal(stages.find((stage) => stage.key === "assign").maxDays, 0);
  assert.equal(stages.find((stage) => stage.key === "verify").avgDays, null);
});

test("act-now list puts overdue first, then urgent, then the longest wait", () => {
  const rows = derive([
    req({ id: "old", status: "pending_assign", history: [at("pending_assign", "2026-09-01T05:00:00Z")] }),
    req({ id: "urgent", status: "pending_assign", is_urgent: true, history: [at("pending_assign", "2026-10-05T05:00:00Z")] }),
    req({ id: "overdue", status: "in_progress", work_expected_date: "2026-10-05", history: [at("in_progress", "2026-10-05T05:00:00Z")] }),
    req({ id: "done", status: "completed", completed_at: "2026-10-02T02:00:00Z" }),
  ]);
  const top = model.priority(model.backlog(rows, filters()), 10);
  assert.deepEqual(top.map((row) => row.id), ["overdue", "urgent", "old"]);
  assert.equal(model.priority(model.backlog(rows, filters()), 2).length, 2);
});
