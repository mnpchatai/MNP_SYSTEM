(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MNP_REQUEST_APPROVAL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Stable role IDs from 20260919000000_unify_position_and_role.sql.
  const FACTORY_MANAGER = "20000000-0000-0000-0000-000000000005";
  const ASSISTANT_FACTORY_MANAGER = "20000000-0000-0000-0000-000000000003";

  function eligibleRoleIds(step, requestTypeCode) {
    if (!step.approver_role_id) return [];
    if (!step.approver_employee_id && requestTypeCode === "MT_REPAIR" &&
        step.step_order === 1 && step.approver_role_id === FACTORY_MANAGER) {
      return [FACTORY_MANAGER, ASSISTANT_FACTORY_MANAGER];
    }
    return [step.approver_role_id];
  }

  function roleMatches(step, requestTypeCode, employee) {
    return eligibleRoleIds(step, requestTypeCode).includes(employee.acting_role_id ?? employee.role_id) &&
      (!step.approver_department_id || step.approver_department_id === employee.department_id);
  }

  return { eligibleRoleIds, roleMatches };
});
