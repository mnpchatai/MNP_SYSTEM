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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validEmployeeNo(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9][A-Z0-9.-]{2,31}$/.test(value);
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

  let body: { action?: string; employeeNo?: string; password?: string; inviteCode?: string };
  try {
    body = await request.json();
  } catch {
    return response(request, { error: "INVALID_JSON" }, 400);
  }

  const employeeNo = String(body.employeeNo ?? "").trim().toUpperCase();
  const password = String(body.password ?? "");
  if (!validEmployeeNo(employeeNo) || password.length < 8 || password.length > 72) {
    return response(request, { error: "INVALID_CREDENTIALS" }, 400);
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
