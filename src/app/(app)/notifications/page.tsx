import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { markAllNotificationsReadAction } from "@/app/actions/requests";
import { getCurrentEmployee } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const employee = await getCurrentEmployee();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("*").eq("recipient_id", employee.id).order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow">Inbox</div><h2>การแจ้งเตือน</h2><p>เหตุการณ์สำคัญจากคำร้องและลำดับอนุมัติ</p></div>
        <form action={markAllNotificationsReadAction}><button className="btn secondary"><CheckCheck size={15} /> อ่านทั้งหมดแล้ว</button></form>
      </div>
      <section className="card stack">
        {!data?.length ? <div className="empty">ยังไม่มีการแจ้งเตือน</div> : data.map((item) => (
          <Link href={item.action_url ?? "#"} key={item.id} style={{ padding: "14px", borderRadius: 11, background: item.read_at ? "transparent" : "#edf8f8", border: "1px solid var(--line)" }}>
            <strong style={{ display: "block", fontSize: 13 }}>{item.title}</strong>
            <span className="muted small">{item.body} · {formatDate(item.created_at, true)}</span>
          </Link>
        ))}
      </section>
    </>
  );
}

