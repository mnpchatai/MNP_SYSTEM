import { Bell } from "lucide-react";
import Link from "next/link";
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
        <header className="topbar">
          <h1>MNP Internal System</h1>
          <div className="topbar-actions">
            <Link className="btn secondary small" href="/notifications" aria-label="การแจ้งเตือน">
              <Bell size={15} /> {count ? `${count} ใหม่` : "การแจ้งเตือน"}
            </Link>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

