import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { url, pendingStatuses, createUrl } = createRequire(import.meta.url)("../../modules/request-center.js");
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
  assert.ok(!pendingStatuses("NCR_CAR").includes("closed"));
});
