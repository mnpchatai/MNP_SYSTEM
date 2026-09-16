import { AppTopbar } from "@/components/app-topbar";
import { Sidebar } from "@/components/sidebar";
import { getCurrentEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployee();
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", employee.id)
    .is("read_at", null);

  return (
    <div className="app-shell">
      <Sidebar employee={employee} />
      <div className="main">
        <AppTopbar notificationCount={count ?? 0} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
