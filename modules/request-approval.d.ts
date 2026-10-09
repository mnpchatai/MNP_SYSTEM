export type ApprovalRoleStep = {
  step_order: number;
  approver_role_id: string | null;
  approver_employee_id?: string | null;
  approver_department_id?: string | null;
};
export function eligibleRoleIds(step: ApprovalRoleStep, requestTypeCode?: string | null): string[];
export function roleMatches(step: ApprovalRoleStep, requestTypeCode: string | null | undefined, employee: {
  role_id: string;
  acting_role_id?: string | null;
  department_id: string;
}): boolean;
