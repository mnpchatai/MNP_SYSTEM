import Link from "next/link";
import { Plus } from "lucide-react";
import { RequestTable } from "@/components/request-table";
import { getCurrentEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const filters = [
  ["all", "ทั้งหมด"], ["pending_approval", "รออนุมัติ"], ["in_progress", "กำลังดำเนินการ"],
  ["completed", "เสร็จแล้ว"], ["rejected", "ไม่อนุมัติ"],
];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const employee = await getCurrentEmployee();
  const { status = "all", q = "" } = await searchParams;
  const normalizedQuery = q.trim().replace(/[,%()]/g, " ").slice(0, 80);
  const supabase = await createClient();
  let query = supabase
    .from("requests")
    .select("id,request_no,title,description,status,priority,created_at,updated_at,needed_date,machine_code,machine_name,assignee:employees!requests_assignee_id_fkey(first_name,last_name),request_type:request_types(name_th)")
    .eq("requester_id", employee.id)
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  if (normalizedQuery) query = query.or(`request_no.ilike.%${normalizedQuery}%,title.ilike.%${normalizedQuery}%`);
  const { data } = await query;

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow">Request Center</div><h2>{normalizedQuery ? `ผลการค้นหา “${normalizedQuery}”` : "คำร้องของฉัน"}</h2><p>ค้นหาและติดตามสถานะคำร้องที่คุณสร้าง</p></div>
        <Link className="btn" href="/requests/new"><Plus size={16} /> สร้างคำร้อง</Link>
      </div>
      <div className="filters">
        {filters.map(([value, label]) => {
          const params = new URLSearchParams();
          if (value !== "all") params.set("status", value);
          if (normalizedQuery) params.set("q", normalizedQuery);
          const href = params.size ? `/requests?${params.toString()}` : "/requests";
          return <Link className={status === value ? "active" : ""} href={href} key={value}>{label}</Link>;
        })}
      </div>
      <section className="request-list-panel"><RequestTable requests={data ?? []} /></section>
    </>
  );
}
