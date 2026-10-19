import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { HOME, isLabOnly, routeAllowed, moduleAllowed } = createRequire(import.meta.url)("../../modules/lab-only-access.js");

test("only an explicit true flag from the database marks a lab-only account", () => {
  assert.equal(isLabOnly({ labOnly: true }), true);
  for (const value of [undefined, null, false, "true", 1, {}]) assert.equal(isLabOnly({ labOnly: value }), false);
  assert.equal(isLabOnly(null), false);
  assert.equal(isLabOnly(undefined), false);
});

test("a lab-only account lands on MNP LAB", () => {
  assert.equal(HOME, "lab");
  assert.equal(routeAllowed(HOME), true);
});

test("a lab-only account may open only MNP LAB and its own profile", () => {
  assert.equal(routeAllowed("profile"), true);
  for (const path of ["dashboard", "requests", "request", "new", "repair/new", "approvals", "notifications", "admin",
    "ncr", "ncr-dashboard", "mt-dashboard", "factory", "factory-bom", "it", "mg", "", "lab/extra", "LAB", "unknown"]) {
    assert.equal(routeAllowed(path), false, `${path} must be redirected`);
  }
});

test("the sidebar keeps only the MNP LAB module", () => {
  assert.equal(moduleAllowed("MNP_LAB"), true);
  for (const code of ["MT_REPAIR", "NCR_CAR", "IT_REPAIR", "MANAGEMENT", "FACTORY", undefined, null, ""]) {
    assert.equal(moduleAllowed(code), false, `${code} must be hidden`);
  }
});
