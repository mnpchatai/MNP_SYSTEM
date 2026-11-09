// อนุมัติคำร้องบัญชี (เปิดบัญชีใหม่ / แก้ไข ID-รหัสผ่าน) แยกจาก index.ts ให้ทดสอบลำดับการตรวจสิทธิ์ได้
// โดยไม่ต้องมี Deno หรือ Supabase จริง (scripts/tests/pilot-auth-approve.test.mjs)
//
// กติกา: ตรวจสิทธิ์ผู้เรียกด้วย RPC ที่รันในนามผู้ใช้ "ก่อน" เขียนอะไรลง Supabase Auth ด้วย service role
// - ทุกคำร้อง: app_list_account_requests('pending') ต้องเห็นคำร้องนี้ (ฐานข้อมูลตรวจ accounts.manage)
// - คำร้องแก้ไข ID/รหัสผ่าน: app_admin_target_auth_user(employee_id) ตรวจ accounts.manage และ
//   (หลัง migration บัญชี master) ปฏิเสธเป้าหมายที่เป็น master ด้วย MASTER_PROTECTED
// - app_apply_account_request ตรวจซ้ำอีกครั้งในธุรกรรมเดียวกับที่บันทึกผล

export type RpcResult = { data: unknown; error: string | null };

export type AccountRequestRow = {
  id: string;
  kind: string;
  status: string;
  employee_id: string | null;
  employee_no: string;
  email: string | null;
  desired_password: string | null;
};

export type ApproveDeps = {
  // RPC ในนามผู้เรียก (Bearer token ของผู้ใช้) — ที่นี่เท่านั้นที่ตัดสินสิทธิ์
  rpcAsUser: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  // อ่านคำร้องด้วย service role (ต้องใช้ desired_password ซึ่ง RPC รายการไม่คืนให้)
  readRequest: (requestId: string) => Promise<AccountRequestRow | null>;
  createAuthUser: (input: { email: string; password: string; employeeNo: string }) =>
    Promise<{ userId: string | null; error: string | null }>;
  updateAuthPassword: (authUserId: string, password: string) => Promise<string | null>;
  deleteAuthUser: (authUserId: string) => Promise<void>;
};

export type ApproveResult = { status: number; body: Record<string, unknown> };

// รหัส HTTP จากข้อความ error ของ RPC (Pilot แปลข้อความจากรหัสใน body ไม่ได้ใช้ status)
export function authErrorStatus(message: string, fallback = 400): number {
  if (message.includes("AUTH_REQUIRED")) return 401;
  if (message.includes("NOT_AUTHORIZED") || message.includes("MASTER_PROTECTED")) return 403;
  return fallback;
}

function rowId(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

export async function approveAccountRequest(
  deps: ApproveDeps,
  requestId: string,
  roleId: string | null,
): Promise<ApproveResult> {
  // 1) สิทธิ์ก่อนทุกอย่าง: ผู้ไม่มี accounts.manage ได้รายการว่าง (หรือ error) จึงไม่เห็นคำร้องนี้
  const pending = await deps.rpcAsUser("app_list_account_requests", { p_status: "pending" });
  if (pending.error) {
    return { status: authErrorStatus(pending.error), body: { error: pending.error } };
  }
  const visible = Array.isArray(pending.data) && pending.data.some((row) => rowId(row) === requestId);

  const accountRequest = requestId ? await deps.readRequest(requestId) : null;
  const isPending = accountRequest?.status === "pending";
  if (!visible) {
    // คำร้องยังรออยู่แต่ผู้เรียกมองไม่เห็น = ไม่มีสิทธิ์; นอกนั้นคือคำร้องไม่อยู่ในสถานะรออนุมัติ
    return isPending
      ? { status: 403, body: { error: "NOT_AUTHORIZED" } }
      : { status: 409, body: { error: "REQUEST_NOT_PENDING" } };
  }
  if (!accountRequest || !isPending) {
    return { status: 409, body: { error: "REQUEST_NOT_PENDING" } };
  }
  if (!accountRequest.desired_password) {
    return { status: 409, body: { error: "PASSWORD_MISSING" } };
  }

  let createdUserId: string | null = null;
  if (accountRequest.kind === "new_account") {
    const email = String(accountRequest.email ?? "").trim() ||
      `${accountRequest.employee_no.toLowerCase()}@pilot.mnp.local`;
    const created = await deps.createAuthUser({
      email,
      password: accountRequest.desired_password,
      employeeNo: accountRequest.employee_no,
    });
    if (created.error !== null || !created.userId) {
      return { status: 400, body: { error: `ACCOUNT_CREATE_FAILED: ${created.error ?? ""}` } };
    }
    createdUserId = created.userId;
  } else {
    // 2) เป้าหมายรายคน: accounts.manage + กันบัญชี master และคืน auth user ของเป้าหมาย
    const target = await deps.rpcAsUser("app_admin_target_auth_user", {
      p_employee_id: accountRequest.employee_id,
    });
    if (target.error) {
      return { status: authErrorStatus(target.error, 404), body: { error: target.error } };
    }
    if (typeof target.data !== "string" || !target.data) {
      return { status: 404, body: { error: "EMPLOYEE_NOT_FOUND" } };
    }
    // เปลี่ยนรหัสผ่านก่อน แล้วจึงบันทึกผลลงฐานข้อมูล ถ้าขั้นบันทึกล้มเหลว คำร้องยัง
    // ค้างอยู่และกดอนุมัติซ้ำได้ ผลลัพธ์สุดท้ายจึงตรงกันเสมอ
    const updateError = await deps.updateAuthPassword(target.data, accountRequest.desired_password);
    if (updateError !== null) {
      return { status: 400, body: { error: `PASSWORD_UPDATE_FAILED: ${updateError}` } };
    }
  }

  const applied = await deps.rpcAsUser("app_apply_account_request", {
    p_request_id: accountRequest.id,
    p_auth_user_id: createdUserId,
    p_role_id: roleId,
  });
  if (applied.error) {
    if (createdUserId) await deps.deleteAuthUser(createdUserId);
    return { status: authErrorStatus(applied.error), body: { error: applied.error } };
  }
  return { status: 200, body: { employeeId: applied.data } };
}
