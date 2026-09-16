import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export const getCurrentEmployee = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: employee, error } = await supabase
    .from("employees")
    .select("*, department:departments(*), role:roles(*)")
    .eq("auth_user_id", user.id)
    .single();

  if (error || !employee) redirect("/account-pending");
  return employee;
});

