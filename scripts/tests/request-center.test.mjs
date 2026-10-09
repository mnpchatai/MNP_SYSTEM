import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { url, hasParams, statusList, pendingStatuses, createUrl, overviewUrl } = createRequire(import.meta.url)("../../modules/request-center.js");
const params = (value) => new URLSearchParams(value);

test("changing status preserves selected type, ownership, search and board scope", () => {
  const result = url(params("type=it&scope=mine&status=approved&view=board&q=คอมพิวเตอร์"), { status: "in_progress" });
  const query = params(result.split("?")[1]);
  assert.equal(query.get("type"), "it");
  assert.equal(query.get("scope"), "mine");
  assert.equal(query.get("q"), "คอมพิวเตอร์");
  assert.equal(query.get("view"), "board");
  assert.equal(query.get("status"), "in_progress");
});
test("department filter and request-number search survive status changes but not a module switch", () => {
  const result = url(params("type=mt&dept=RB&q=2609&status=approved"), { status: "completed" });
  const query = params(result.split("?")[1]);
  assert.equal(query.get("dept"), "RB");
  assert.equal(query.get("q"), "2609");
  assert.equal(url(params("type=mt&dept=RB&q=2609"), { type: "mg", status: null }), "#/requests?type=mg&q=2609");
  assert.equal(url(params("type=mt&dept=RB"), { type: "mt" }), "#/requests?type=mt&dept=RB");
  assert.equal(url(params("type=mt&dept=RB"), { dept: null }), "#/requests?type=mt");
});
test("cancel returns to the same list without keeping creation mode or unknown params", () => {
  assert.equal(url(params("type=mt&scope=mine&mode=create&unexpected=secret")), "#/requests?type=mt&scope=mine");
});
test("explicit all-types selection survives navigation and NCR all filter stays distinct from open", () => {
  assert.equal(url(params("type=it&scope=mine"), { type: "all", status: null }), "#/requests?type=all&scope=mine");
  assert.equal(url(params("type=ncr"), { ncrStatus: "all" }), "#/requests?type=ncr&ncrStatus=all");
});
test("switching type clears incompatible status filters and preserves ownership", () => {
  assert.equal(url(params("type=ncr&ncrStatus=closed&scope=mine&status=completed"), { type: "mt", ncrStatus: null, status: null }), "#/requests?type=mt&scope=mine");
});
test("the module overview has no creation link before a module is chosen", () => {
  assert.equal(createUrl(params("")), null);
  assert.equal(createUrl(params("type=all")), null);
});
test("module creation always opens that module's form, preserving the return filters", () => {
  for (const type of ["mt", "mg", "ncr", "it"]) {
    const form = createUrl(params(`type=${type}&scope=mine&status=in_progress&createType=other`));
    assert.equal(form, `#/requests?type=${type}&scope=mine&status=in_progress&mode=create&createType=${type}`);
    assert.equal(url(params(form.split("?")[1])), `#/requests?type=${type}&scope=mine&status=in_progress`);
  }
});
test("pending counters respect management terminal decisions and NCR's separate workflow", () => {
  assert.ok(!pendingStatuses("MANAGEMENT").includes("approved"));
  assert.ok(!pendingStatuses("MANAGEMENT").includes("acknowledged"));
  assert.ok(pendingStatuses("IT_REPAIR").includes("approved"));
  assert.ok(pendingStatuses("MT_REPAIR").includes("pending_verify"));
  assert.ok(pendingStatuses("NCR_CAR").includes("awaiting_signoff"));
  assert.ok(pendingStatuses("NCR_CAR").includes("awaiting_info"));
  assert.ok(!pendingStatuses("NCR_CAR").includes("closed"));
});
test("links keep their filters on browsers without URLSearchParams.size", () => {
  const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
  Object.defineProperty(URLSearchParams.prototype, "size", { configurable: true, get: () => undefined });
  try {
    assert.equal(url(params("type=all"), { type: "it" }), "#/requests?type=it");
    assert.equal(createUrl(params("type=mt")), "#/requests?type=mt&mode=create&createType=mt");
    assert.equal(hasParams(params("status=completed")), true);
    assert.equal(hasParams(params("")), false);
  } finally {
    if (descriptor) Object.defineProperty(URLSearchParams.prototype, "size", descriptor);
  }
});
test("dashboard status links keep only known statuses", () => {
  const known = ["all", "approved", "in_progress", "completed"];
  assert.deepEqual(statusList(params("status=approved,in_progress"), known), ["approved", "in_progress"]);
  assert.deepEqual(statusList(params("status=completed,bogus"), known), ["completed"]);
  assert.deepEqual(statusList(params("status=all"), known), []);
  assert.deepEqual(statusList(params(""), known), []);
});
test("a stale my-requests list flag is dropped from request center links", () => {
  assert.equal(url(params("scope=mine&list=1")), "#/requests?scope=mine");
  assert.equal(url(params("type=all&scope=mine&list=1"), { type: "mt", status: null, ncrStatus: null }), "#/requests?type=mt&scope=mine");
});
test("the main menu opens the module overview instead of the remembered module", () => {
  assert.equal(overviewUrl(), "#/requests?type=all");
  // The page rewrites its URL with url(); the menu link must still match so a repeat click re-renders it.
  assert.equal(url(params(overviewUrl().split("?")[1])), overviewUrl());
});
