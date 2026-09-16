"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const LOGIN_ERROR = "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง";

function redirectToLoginError(): never {
  redirect(`/login?error=${encodeURIComponent(LOGIN_ERROR)}`);
}

export async function signInAction(formData: FormData) {
  const employeeNo = String(formData.get("employee_no") ?? "").trim().toUpperCase();
  const password = String(formData.get("password") ?? "");

  if (!/^[A-Z0-9][A-Z0-9.-]{2,31}$/.test(employeeNo) || password.length < 6) {
    redirectToLoginError();
  }

  const admin = createAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("auth_user_id, is_active")
    .eq("employee_no", employeeNo)
    .maybeSingle();

  if (employeeError || !employee?.is_active || !employee.auth_user_id) {
    redirectToLoginError();
  }

  const { data: authUser, error: authUserError } =
    await admin.auth.admin.getUserById(employee.auth_user_id);
  const email = authUser.user?.email;

  if (authUserError || !email) {
    redirectToLoginError();
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) redirectToLoginError();
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
