import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const { roleMatches, eligibleRoleIds } = createRequire(import.meta.url)("../../modules/request-approval.js");
const factory = "20000000-0000-0000-0000-000000000005";
const assistant = "20000000-0000-0000-0000-000000000003";
const general = "20000000-0000-0000-0000-000000000006";
const step = { step_order: 1, approver_role_id: factory };
const employee = { role_id: assistant, department_id: "MT" };

test("either factory manager can take the first MT step, including an acting admin", () => {
  assert.deepEqual(eligibleRoleIds(step, "MT_REPAIR"), [factory, assistant]);
  assert.equal(roleMatches(step, "MT_REPAIR", employee), true);
  assert.equal(roleMatches(step, "MT_REPAIR", { ...employee, role_id: factory }), true);
  assert.equal(roleMatches(step, "MT_REPAIR", { ...employee, role_id: "admin", acting_role_id: assistant }), true);
});
test("the assistant cannot take the general step, another module, or a personal assignment", () => {
  assert.equal(roleMatches({ ...step, step_order: 2, approver_role_id: general }, "MT_REPAIR", employee), false);
  assert.equal(roleMatches(step, "MANAGEMENT", employee), false);
  assert.equal(roleMatches(step, "IT_REPAIR", employee), false);
  assert.equal(roleMatches({ ...step, step_order: 2 }, "MT_REPAIR", employee), false);
  assert.equal(roleMatches({ ...step, approver_employee_id: "specific-manager" }, "MT_REPAIR", employee), false);
});
test("department and null-role boundaries remain enforced", () => {
  assert.equal(roleMatches({ ...step, approver_department_id: "OTHER" }, "MT_REPAIR", employee), false);
  assert.equal(roleMatches({ ...step, approver_department_id: "MT" }, "MT_REPAIR", employee), true);
  assert.equal(roleMatches({ ...step, approver_role_id: null }, "MT_REPAIR", employee), false);
});
