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
