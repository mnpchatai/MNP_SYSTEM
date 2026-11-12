import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { isRestricted, moduleAllowed, routeAllowed, notificationAllowed, notificationRequestIds } =createRequire(import.meta.url)("../../modules/department-access.js");

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

test("Indesign keeps only notifications about MT/IT repair requests and its own profile", () => {
  const types = { "r-mt": "MT_REPAIR", "r-it": "IT_REPAIR", "r-mg": "MANAGEMENT" };
  const typeOf = (id) => types[id] ?? null;
  const allowed = (item) => notificationAllowed(indesign, item, typeOf);
  assert.equal(allowed({ request_id: "r-mt" }), true);
  assert.equal(allowed({ request_id: "r-it" }), true);
  assert.equal(allowed({ request_id: "r-mg" }), false);
  assert.equal(allowed({ request_id: "unreadable" }), false, "a request the page cannot read stays hidden");
  assert.equal(allowed({ action_url: "/profile" }), true);
  for (const action_url of ["/admin", "/ncr/abc", null, undefined, "/something-new"]) assert.equal(allowed({ action_url }), false, `${action_url} must be hidden`);
  assert.equal(allowed({ action_url: "/", digest: [{ item_type: "request", item_id: "r-mt" }, { item_type: "request", item_id: "r-it" }] }), true);
  assert.equal(allowed({ action_url: "/", digest: [{ item_type: "request", item_id: "r-mt" }, { item_type: "ncr", item_id: "n1" }] }), false);
  assert.equal(allowed({ action_url: "/", digest: [{ item_type: "request", item_id: "r-mg" }] }), false);
  assert.equal(allowed({ action_url: "/", digest: [] }), false);
  assert.equal(allowed({ action_url: "/" }), false);
});

test("other departments keep every notification", () => {
  for (const item of [{ action_url: "/ncr/abc" }, { action_url: "/admin" }, { request_id: "r-mg" }, {}]) {
    assert.equal(notificationAllowed(mt, item, () => null), true);
  }
});

test("the request ids to look up come from request_id and request items in the digest", () => {
  assert.deepEqual(notificationRequestIds([
    { request_id: "a" },
    { action_url: "/", digest: [{ item_type: "request", item_id: "b" }, { item_type: "ncr", item_id: "n" }, { item_type: "request", item_id: "a" }] },
    { action_url: "/admin" },
    null,
  ]), ["a", "b"]);
  assert.deepEqual(notificationRequestIds(undefined), []);
});
