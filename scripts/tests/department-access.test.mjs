import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { isRestricted, moduleAllowed, routeAllowed } = createRequire(import.meta.url)("../../modules/department-access.js");

const indesign = { department: { code: "ID", name_th: "Indesign" }, role: { code: "employee" } };
const indesignAdmin = { department: { code: "ID" }, role: { code: "admin" } };
const mt = { department: { code: "MT" }, role: { code: "employee" } };

test("only the ID (Indesign) department is restricted, admins included", () => {
  assert.equal(isRestricted(indesign), true);
  assert.equal(isRestricted(indesignAdmin), true);
  for (const employee of [mt, { department: { code: "id" } }, { department: null }, {}, null, undefined, { department: { code: "toString" } }]) {
    assert.equal(isRestricted(employee), false);
  }
});

test("Indesign sees only the MT and IT repair modules, and modules added later stay hidden", () => {
  assert.equal(moduleAllowed(indesign, "MT_REPAIR"), true);
  assert.equal(moduleAllowed(indesign, "IT_REPAIR"), true);
  for (const code of ["MANAGEMENT", "NCR_CAR", "MNP_LAB", "QC", "MASTER", "RUBBERFLOW", "BOM", "SOME_NEW_MODULE", undefined, null, ""]) {
    assert.equal(moduleAllowed(indesign, code), false, `${code} must be hidden`);
  }
});

test("other departments keep every module", () => {
  for (const code of ["MT_REPAIR", "NCR_CAR", "MNP_LAB", "SOME_NEW_MODULE"]) assert.equal(moduleAllowed(mt, code), true);
});

test("Indesign keeps the shared pages and the pages of allowed modules only", () => {
  for (const path of ["dashboard", "approvals", "requests", "new", "repair/new", "request", "notifications", "profile"]) {
    assert.equal(routeAllowed(indesign, path), true, `${path} must stay open`);
  }
  assert.equal(routeAllowed(indesign, "mt-dashboard", "MT_REPAIR"), true);
  assert.equal(routeAllowed(indesign, "ncr", "NCR_CAR"), false);
  assert.equal(routeAllowed(indesign, "lab", "MNP_LAB"), false);
  assert.equal(routeAllowed(indesign, "admin"), false);
  assert.equal(routeAllowed(indesignAdmin, "admin"), false);
  assert.equal(routeAllowed(indesign, "unknown"), false);
  assert.equal(routeAllowed(mt, "admin"), true);
  assert.equal(routeAllowed(mt, "ncr", "NCR_CAR"), true);
});
