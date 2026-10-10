import { eligibleRoleIds, roleMatches, type ApprovalRoleStep } from "../../modules/request-approval.js";
import { createAdminClient } from "@/lib/supabase/admin";

type RoleHolder = { role_id: string; acting_role_id?: string | null };

/**
 * The role an employee works as for approvals and notifications. An admin may pick
 * another role (employees.acting_role_id) to receive only that role's work.
 * Mirrors coalesce(acting_role_id, role_id) in 20261003010000_admin_acting_role.sql.
 */
export function actingRoleId(employee: RoleHolder) {
  return employee.acting_role_id ?? employee.role_id;
}

/** Active employees who work as `roleId` (optionally inside one department). */
export async function findActiveRoleHolders(roleId: string, departmentId?: string | null, context?: { step: ApprovalRoleStep; requestTypeCode: string; requestTypeId: string }) {
  const admin = createAdminClient();
  const roleIds = context ? eligibleRoleIds(context.step, context.requestTypeCode) : [roleId];
  let query = admin
    .from("employees")
    .select("id, role_id, acting_role_id")
    .or(roleIds.flatMap((id) => [`role_id.eq.${id}`, `acting_role_id.eq.${id}`]).join(","))
    .eq("is_active", true);
  if (departmentId) query = query.eq("department_id", departmentId);
  const { data } = await query;
  const { data: grants } = context
    ? await admin.from("approval_module_permissions").select("employee_id").eq("request_type_id", context.requestTypeId)
    : { data: null };
  const grantedIds = new Set((grants ?? []).map((row) => row.employee_id));
  return (data ?? [])
    .filter((row: RoleHolder & { id: string }) => {
      // Mirrors private.mt_assistant_admin_receives_notifications. Stable role IDs
      // come from the initial role seed and 20260919000000_unify_position_and_role.sql.
      const assistantAdminForMt = context?.requestTypeCode === "MT_REPAIR" && context.step.step_order === 1 &&
        row.role_id === "20000000-0000-0000-0000-000000000004" &&
        row.acting_role_id === "20000000-0000-0000-0000-000000000003";
      return roleIds.includes(actingRoleId(row)) && (!context || grantedIds.has(row.id) || assistantAdminForMt);
    })
    .map((row: { id: string }) => row.id);
}

/**
 * Active admins. They are notified instead when an approval step has nobody who can act
 * on it, because app_approval_decision lets the admin role approve any step.
 * Mirrors private.notify_approval_step in
 * 20261003030000_never_skip_factory_general_approval_steps.sql — keep both in sync.
 */
export async function findActiveAdmins() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("employees")
    .select("id, roles!inner(code)")
    .eq("is_active", true)
    .eq("roles.code", "admin");
  return (data ?? []).map((row: { id: string }) => row.id);
}

export async function getPendingApprovals(employee: RoleHolder & {
  id: string;
  department_id: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("approval_steps")
    .select(`
      *,
      request:requests!inner(
        id, request_no, title, description, details, priority, status, current_step, created_at, submitted_at, request_type_id,
        request_type:request_types(name_th,code),
        requester:employees!requests_requester_id_fkey(first_name,last_name)
      )
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) return [];

  const { data: grants } = await admin.from("approval_module_permissions").select("request_type_id").eq("employee_id", employee.id);
  const allowedTypes = new Set((grants ?? []).map((row) => row.request_type_id));
  return (data ?? []).filter((step) =>
    step.step_order === step.request.current_step && (
      step.approver_employee_id === employee.id ||
      (roleMatches(step, step.request.request_type?.code, employee) &&
        (step.request.request_type?.code !== "MT_REPAIR" || allowedTypes.has(step.request.request_type_id)))
    ),
  );
}

export async function hasApprovalModule(employeeId: string, requestTypeId: string) {
  const { data } = await createAdminClient().from("approval_module_permissions").select("employee_id")
    .eq("employee_id", employeeId).eq("request_type_id", requestTypeId).limit(1);
  return Boolean(data?.length);
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
