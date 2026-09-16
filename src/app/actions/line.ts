"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { unlinkPerUserRichMenu } from "@/lib/line";
import { createAdminClient } from "@/lib/supabase/admin";

export async function unlinkLineAction() {
  const employee = await getCurrentEmployee();
  const admin = createAdminClient();
  const { data } = await admin.from("line_accounts").select("line_user_id").eq("employee_id", employee.id).maybeSingle();
  if (data?.line_user_id) await unlinkPerUserRichMenu(data.line_user_id);
  await admin.from("line_accounts").delete().eq("employee_id", employee.id);
  revalidatePath("/profile");
  redirect("/profile?line=unlinked");
}

