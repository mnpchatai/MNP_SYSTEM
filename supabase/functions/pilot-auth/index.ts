import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const allowedOrigins = new Set([
  "https://mnpchatai.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

// SHA-256 hashes only. The one-time pilot invite codes are shared privately
// with the test users and are never committed to this repository.
const inviteHashes: Record<string, string> = {
  MNP0101: "6bfd2195cad642a51e5da1df6c149e031f0dd1cf9c31976da5fa1bca65b40c18",
  MNP0102: "6b966abf5e44e7b4acf8cf85813ac98ba40c61af70a43b0da20410296689acf8",
  MNP0201: "60a394431b859d24415eb7e7089d5e083934508238933ab423f9b78632fdfa9e",
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://mnpchatai.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

// แจ้ง Edge Function "notify-email" ให้ไล่ส่งอีเมลของแถวแจ้งเตือนที่เพิ่งสร้าง
//
// เส้นทางคำร้องเปิดบัญชี/แก้ไข ID เกิดตอนผู้ยื่นยังไม่มี session (หรือกำลังจะถูกบังคับล็อกอินใหม่)
// ไคลเอนต์จึงยิง notify-email เองไม่ได้เสมอไป ฟังก์ชันนี้ถือ service role key อยู่แล้วจึงเรียกแทนให้
// แบบ fire-and-forget — ส่งอีเมลไม่ออกต้องไม่ทำให้การอนุมัติ/รับคำร้องล้มเหลว
async function dispatchNotificationEmails(supabaseUrl: string, serviceRoleKey: string) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/notify-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({}),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result?.configured === false) {
      console.warn("pilot-auth: notify-email did not send", { status: res.status, result });
    }
  } catch (notifyError) {
    console.error("pilot-auth: notify-email call failed", String(notifyError));
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validEmployeeNo(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9][A-Z0-9.-]{2,31}$/.test(value);
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function bearerToken(request: Request) {
  return (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

// เรียก RPC ในนามผู้ใช้โดยส่งต่อ apikey กับ Bearer token ชุดเดียวกับที่เบราว์เซอร์
// ใช้เรียก PostgREST สำเร็จอยู่แล้ว จึงไม่ขึ้นกับว่า SUPABASE_ANON_KEY เป็นคีย์รุ่นใด
// สิทธิ์ทั้งหมดถูกตรวจในฟังก์ชันฐานข้อมูลจาก auth.uid() ของ token นี้
async function rpcAsUser(
  supabaseUrl: string,
  apiKey: string,
  token: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });
  const text = await result.text();
  if (!result.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = String(parsed.message ?? parsed.error ?? text);
    } catch {
      // ใช้ข้อความดิบเมื่อ body ไม่ใช่ JSON
    }
    console.error(`rpc ${fn} -> ${result.status} ${message}`);
    return { data: null, error: message || `RPC_FAILED_${result.status}` };
  }
  return { data: text ? JSON.parse(text) : null, error: null };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return response(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const origin = request.headers.get("origin") ?? "";
  if (origin && !allowedOrigins.has(origin)) {
    return response(request, { error: "ORIGIN_NOT_ALLOWED" }, 403);
  }

  let body: {
    action?: string;
    employeeNo?: string;
    password?: string;
    inviteCode?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    departmentId?: string;
    jobTitle?: string;
    reason?: string;
    requestId?: string;
    roleId?: string;
    employeeId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return response(request, { error: "INVALID_JSON" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return response(request, { error: "SERVER_NOT_CONFIGURED" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // แผนกและบทบาทสำหรับฟอร์มขอเปิดบัญชี ซึ่งเรียกก่อนมี session จึงอ่านผ่าน service role
  if (body.action === "directory") {
    const [departments, roles] = await Promise.all([
      admin.from("departments").select("id,code,name_th").eq("is_active", true).order("code"),
      admin.from("roles").select("id,code,name_th").order("sort_order"),
    ]);
    if (departments.error || roles.error) {
      return response(request, { error: "DIRECTORY_UNAVAILABLE" }, 500);
    }
    return response(request, { departments: departments.data, roles: roles.data });
  }

  // คำร้องขอเปิดบัญชีใหม่ ส่งได้โดยยังไม่มีบัญชี ระบบเพียงรับเรื่องไว้รอ Admin อนุมัติ
  if (body.action === "account_request") {
    const requestedNo = String(body.employeeNo ?? "").trim().toUpperCase();
    const requestedPassword = String(body.password ?? "");
    const firstName = cleanText(body.firstName, 100);
    const lastName = cleanText(body.lastName, 100);
    const departmentId = cleanText(body.departmentId, 64);
    const desiredRoleId = cleanText(body.roleId, 64);

    if (!validEmployeeNo(requestedNo)) {
      return response(request, { error: "INVALID_EMPLOYEE_NO" }, 400);
    }
    if (requestedPassword.length < 8 || requestedPassword.length > 72) {
      return response(request, { error: "INVALID_PASSWORD" }, 400);
    }
    if (!firstName || !lastName) {
      return response(request, { error: "INVALID_NAME" }, 400);
    }
    if (!desiredRoleId) {
      return response(request, { error: "INVALID_POSITION" }, 400);
    }

    const { data: department } = await admin
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("is_active", true)
      .maybeSingle();
    if (!department) {
      return response(request, { error: "DEPARTMENT_NOT_FOUND" }, 400);
    }

    const { data: desiredRole } = await admin
      .from("roles")
      .select("id")
      .eq("id", desiredRoleId)
      .maybeSingle();
    if (!desiredRole) {
      return response(request, { error: "INVALID_POSITION" }, 400);
    }

    const { data: existing } = await admin
      .from("employees")
      .select("id")
      .eq("employee_no", requestedNo)
      .maybeSingle();
    if (existing) {
      return response(request, { error: "EMPLOYEE_NO_TAKEN" }, 409);
    }

    const { data: pending } = await admin
      .from("account_requests")
      .select("id")
      .eq("employee_no", requestedNo)
      .eq("status", "pending")
      .maybeSingle();
    if (pending) {
      return response(request, { error: "REQUEST_ALREADY_PENDING" }, 409);
    }

    const { data: created, error: insertError } = await admin
      .from("account_requests")
      .insert({
        kind: "new_account",
        employee_no: requestedNo,
        first_name: firstName,
        last_name: lastName,
        email: cleanText(body.email, 200) || null,
        phone: cleanText(body.phone, 40) || null,
        department_id: department.id,
        desired_role_id: desiredRoleId,
        job_title: cleanText(body.jobTitle, 120) || null,
        desired_password: requestedPassword,
        reason: cleanText(body.reason, 1000) || null,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return response(request, { error: "REQUEST_CREATE_FAILED" }, 400);
    }

    const { data: permission } = await admin
      .from("permissions")
      .select("id")
      .eq("code", "accounts.manage")
      .maybeSingle();
    const { data: adminRoles } = permission
      ? await admin.from("role_permissions").select("role_id").eq("permission_id", permission.id)
      : { data: [] };
    const roleIds = (adminRoles ?? []).map((row: { role_id: string }) => row.role_id);
    const { data: admins } = roleIds.length
      ? await admin.from("employees").select("id").in("role_id", roleIds).eq("is_active", true)
      : { data: [] };
    const recipients = (admins ?? []).map((row: { id: string }) => row.id);
    if (recipients.length) {
      await admin.from("notifications").insert(recipients.map((recipientId: string) => ({
        recipient_id: recipientId,
        title: "มีคำร้องขอเปิดบัญชีใหม่",
        body: `${requestedNo} · ${firstName} ${lastName}`,
        action_url: "/admin",
      })));
    }

    await dispatchNotificationEmails(supabaseUrl, serviceRoleKey);
    return response(request, { requestId: created.id });
  }

  // Admin ตั้งรหัสผ่านให้พนักงานคนใดก็ได้ สิทธิ์ถูกตรวจในฐานข้อมูลทั้งก่อนและหลัง
  if (body.action === "admin_set_password") {
    const token = bearerToken(request);
    if (!token) {
      return response(request, { error: "AUTH_REQUIRED" }, 401);
    }
    const apiKey = request.headers.get("apikey") ?? anonKey;

    const employeeId = cleanText(body.employeeId, 64);
    const newPassword = String(body.password ?? "");
    if (newPassword.length < 8 || newPassword.length > 72) {
      return response(request, { error: "INVALID_PASSWORD" }, 400);
    }

    // ตรวจสิทธิ์และหาบัญชี auth ของเป้าหมายก่อน จึงค่อยเปลี่ยนรหัสผ่าน
    const target = await rpcAsUser(supabaseUrl, apiKey, token, "app_admin_target_auth_user", {
      p_employee_id: employeeId,
    });
    if (target.error || !target.data) {
      const code = String(target.error ?? "").includes("NOT_AUTHORIZED") ? 403 : 400;
      return response(request, { error: target.error ?? "EMPLOYEE_NOT_FOUND" }, code);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(String(target.data), {
      password: newPassword,
    });
    if (updateError) {
      console.error(`updateUserById failed: ${updateError.message}`);
      return response(request, { error: `PASSWORD_UPDATE_FAILED: ${updateError.message}` }, 400);
    }

    // บันทึกลงคลังเป็นขั้นสุดท้าย ถ้าล้มเหลวให้กดบันทึกซ้ำได้ ผลลัพธ์เหมือนเดิมเสมอ
    const recorded = await rpcAsUser(supabaseUrl, apiKey, token, "app_admin_record_password", {
      p_employee_id: employeeId,
      p_password: newPassword,
    });
    if (recorded.error) {
      return response(request, { error: `RECORD_FAILED: ${recorded.error}` }, 400);
    }

    return response(request, { employeeId });
  }

  // Admin อนุมัติคำร้อง สิทธิ์ถูกตรวจซ้ำในฐานข้อมูลผ่าน app_apply_account_request
  if (body.action === "approve_account_request") {
    const token = bearerToken(request);
    if (!token) {
      return response(request, { error: "AUTH_REQUIRED" }, 401);
    }
    const apiKey = request.headers.get("apikey") ?? anonKey;

    const requestId = cleanText(body.requestId, 64);
    const { data: accountRequest } = await admin
      .from("account_requests")
      .select("id,kind,status,employee_id,employee_no,email,desired_password")
      .eq("id", requestId)
      .maybeSingle();
    if (!accountRequest || accountRequest.status !== "pending") {
      return response(request, { error: "REQUEST_NOT_PENDING" }, 409);
    }
    if (!accountRequest.desired_password) {
      return response(request, { error: "PASSWORD_MISSING" }, 409);
    }

    let createdUserId: string | null = null;
    if (accountRequest.kind === "new_account") {
      const email = String(accountRequest.email ?? "").trim() ||
        `${accountRequest.employee_no.toLowerCase()}@pilot.mnp.local`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: accountRequest.desired_password,
        email_confirm: true,
        user_metadata: { employee_no: accountRequest.employee_no, pilot: true },
      });
      if (createError || !created.user) {
        console.error(`createUser failed: ${createError?.message}`);
        return response(request, { error: `ACCOUNT_CREATE_FAILED: ${createError?.message ?? ""}` }, 400);
      }
      createdUserId = created.user.id;
    } else {
      const { data: employee } = await admin
        .from("employees")
        .select("auth_user_id")
        .eq("id", accountRequest.employee_id)
        .maybeSingle();
      if (!employee?.auth_user_id) {
        return response(request, { error: "EMPLOYEE_NOT_FOUND" }, 404);
      }
      // เปลี่ยนรหัสผ่านก่อน แล้วจึงบันทึกผลลงฐานข้อมูล ถ้าขั้นบันทึกล้มเหลว คำร้องยัง
      // ค้างอยู่และกดอนุมัติซ้ำได้ ผลลัพธ์สุดท้ายจึงตรงกันเสมอ
      const { error: updateError } = await admin.auth.admin.updateUserById(employee.auth_user_id, {
        password: accountRequest.desired_password,
      });
      if (updateError) {
        console.error(`updateUserById failed: ${updateError.message}`);
        return response(request, { error: `PASSWORD_UPDATE_FAILED: ${updateError.message}` }, 400);
      }
    }

    const applied = await rpcAsUser(supabaseUrl, apiKey, token, "app_apply_account_request", {
      p_request_id: accountRequest.id,
      p_auth_user_id: createdUserId,
      p_role_id: cleanText(body.roleId, 64) || null,
    });
    if (applied.error) {
      if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
      const code = applied.error.includes("NOT_AUTHORIZED") ? 403 : 400;
      return response(request, { error: applied.error }, code);
    }

    await dispatchNotificationEmails(supabaseUrl, serviceRoleKey);
    return response(request, { employeeId: applied.data });
  }

  const employeeNo = String(body.employeeNo ?? "").trim().toUpperCase();
  const password = String(body.password ?? "");
  if (!validEmployeeNo(employeeNo) || password.length < 8 || password.length > 72) {
    return response(request, { error: "INVALID_CREDENTIALS" }, 400);
  }

  if (body.action === "register") {
    const expectedHash = inviteHashes[employeeNo];
    const suppliedHash = await sha256(String(body.inviteCode ?? "").trim());
    if (!expectedHash || suppliedHash !== expectedHash) {
      return response(request, { error: "INVALID_INVITE" }, 403);
    }

    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .select("id,email,auth_user_id,is_active")
      .eq("employee_no", employeeNo)
      .maybeSingle();

    if (employeeError || !employee?.is_active) {
      return response(request, { error: "EMPLOYEE_NOT_FOUND" }, 404);
    }
    if (employee.auth_user_id) {
      return response(request, { error: "ACCOUNT_ALREADY_REGISTERED" }, 409);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: employee.email,
      password,
      email_confirm: true,
      user_metadata: { employee_no: employeeNo, pilot: true },
    });
    if (createError || !created.user) {
      return response(request, { error: "ACCOUNT_CREATE_FAILED" }, 400);
    }

    const { error: linkError } = await admin
      .from("employees")
      .update({ auth_user_id: created.user.id })
      .eq("id", employee.id)
      .is("auth_user_id", null);
    if (linkError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return response(request, { error: "ACCOUNT_LINK_FAILED" }, 409);
    }
  } else if (body.action !== "login") {
    return response(request, { error: "INVALID_ACTION" }, 400);
  }

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("auth_user_id,is_active")
    .eq("employee_no", employeeNo)
    .maybeSingle();
  if (employeeError || !employee?.is_active || !employee.auth_user_id) {
    return response(request, { error: "INVALID_CREDENTIALS" }, 401);
  }

  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(employee.auth_user_id);
  if (authUserError || !authUser.user?.email) {
    return response(request, { error: "INVALID_CREDENTIALS" }, 401);
  }

  const { data: sessionData, error: signInError } = await authClient.auth.signInWithPassword({
    email: authUser.user.email,
    password,
  });
  if (signInError || !sessionData.session) {
    return response(request, { error: "INVALID_CREDENTIALS" }, 401);
  }

  return response(request, {
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_at: sessionData.session.expires_at,
  });
});
