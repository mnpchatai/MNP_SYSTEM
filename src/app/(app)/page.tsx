import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardList, Clock3, Plus, Settings2 } from "lucide-react";
import { RequestTable } from "@/components/request-table";
import { getCurrentEmployee } from "@/lib/auth";
import { getPendingApprovals } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  const supabase = await createClient();
  const [requestsResult, typesResult, pending] = await Promise.all([
    supabase
      .from("requests")
      .select("id,request_no,title,status,priority,created_at,request_type:request_types(name_th)")
      .eq("requester_id", employee.id)
      .order("created_at", { ascending: false }),
    supabase.from("request_types").select("id,code,name_th,description").order("sort_order").limit(4),
    getPendingApprovals(employee),
  ]);
  const requests = requestsResult.data ?? [];
  const metrics = [
    { label: "คำร้องของฉัน", value: requests.length, note: "ทั้งหมด", icon: ClipboardList, color: "#176b87" },
    { label: "รอฉันอนุมัติ", value: pending.length, note: "ต้องดำเนินการ", icon: Clock3, color: "#c67b20" },
    { label: "กำลังดำเนินการ", value: requests.filter((r) => ["approved", "in_progress"].includes(r.status)).length, note: "อยู่ระหว่างทำงาน", icon: Settings2, color: "#7655a6" },
    { label: "เสร็จแล้ว", value: requests.filter((r) => r.status === "completed").length, note: "ปิดงานเรียบร้อย", icon: CheckCircle2, color: "#147a55" },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Overview</div>
          <h2>สวัสดี, {employee.first_name}</h2>
          <p>ติดตามคำร้องและงานที่ต้องดำเนินการจากจุดเดียว</p>
        </div>
        <Link className="btn" href="/requests/new"><Plus size={16} /> สร้างคำร้อง</Link>
      </div>

      <section className="metrics">
        {metrics.map(({ label, value, note, icon: Icon, color }) => (
          <article className="metric" key={label} style={{ "--metric-color": color } as React.CSSProperties}>
            <div className="metric-head"><span>{label}</span><span className="metric-icon"><Icon size={16} /></span></div>
            <div className="metric-value">{value}</div><div className="metric-note">{note}</div>
          </article>
        ))}
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-title"><h3>คำร้องล่าสุด</h3><Link href="/requests">ดูทั้งหมด <ArrowRight size={12} /></Link></div>
          <RequestTable requests={requests.slice(0, 6)} />
        </section>
        <section className="card">
          <div className="card-title"><h3>สร้างคำร้องด่วน</h3><Link href="/requests/new">ทุกประเภท</Link></div>
          <div className="quick-grid">
            {(typesResult.data ?? []).map((type) => (
              <Link className="quick-item" href={`/requests/new?type=${type.id}`} key={type.id}>
                <ClipboardList className="quick-icon" size={18} />
                <strong>{type.name_th}</strong><span>{type.description}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

