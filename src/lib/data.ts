import { createAdminClient } from "@/lib/supabase/admin";

export async function getPendingApprovals(employee: {
  id: string;
  role_id: string;
  department_id: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("approval_steps")
    .select(`
      *,
      request:requests!inner(
        id, request_no, title, description, details, priority, status, current_step, created_at, submitted_at,
        request_type:request_types(name_th,code),
        requester:employees!requests_requester_id_fkey(first_name,last_name)
      )
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) return [];

  return (data ?? []).filter((step) =>
    step.step_order === step.request.current_step && (
      step.approver_employee_id === employee.id ||
      (step.approver_role_id === employee.role_id &&
        (!step.approver_department_id || step.approver_department_id === employee.department_id))
    ),
  );
}

export async function hasPermission(roleId: string, permissionCode: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("role_permissions")
    .select("permission:permissions!inner(code)")
    .eq("role_id", roleId)
    .eq("permissions.code", permissionCode)
    .limit(1);
  return Boolean(data?.length);
}

/**
 * Pick an approver target that actually has at least one active employee behind it.
 *
 * Request types aim their final step at (final_approver_role_id, owning_department_id).
 * When nobody holds that role inside that department the step would be created with
 * zero eligible approvers: no account ever sees the approve buttons and the request
 * is stuck. The department scope is therefore only relaxed when keeping it would
 * strand the step.
 *
 * Mirrors private.resolve_approval_target() used by the app_create_request RPC —
 * keep both in sync.
 */
export async function resolveApprovalTarget(roleId: string, departmentId: string | null) {
  const admin = createAdminClient();

  if (departmentId) {
    const { data } = await admin
      .from("employees")
      .select("id")
      .eq("role_id", roleId)
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .limit(1);
    if (data?.length) return { roleId, departmentId };
  }

  const { data: anyDepartment } = await admin
    .from("employees")
    .select("id")
    .eq("role_id", roleId)
    .eq("is_active", true)
    .limit(1);
  if (anyDepartment?.length) return { roleId, departmentId: null };

  const { data: roles } = await admin.from("roles").select("id, code").order("code");
  for (const role of roles ?? []) {
    const [canAct, canViewAll, hasMember] = await Promise.all([
      hasPermission(role.id, "approvals.act"),
      hasPermission(role.id, "requests.view_all"),
      admin.from("employees").select("id").eq("role_id", role.id).eq("is_active", true).limit(1),
    ]);
    if (canAct && canViewAll && hasMember.data?.length) {
      return { roleId: role.id, departmentId: null };
    }
  }

  // Nothing better exists: keep the configured target so the workflow stays auditable.
  return { roleId, departmentId };
}
