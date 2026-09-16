import Link from "next/link";
import { Plus } from "lucide-react";
import { RequestTable } from "@/components/request-table";
import { getCurrentEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const filters = [
  ["all", "ทั้งหมด"], ["pending_approval", "รออนุมัติ"], ["in_progress", "กำลังดำเนินการ"],
  ["completed", "เสร็จแล้ว"], ["rejected", "ไม่อนุมัติ"],
];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const employee = await getCurrentEmployee();
  const { status = "all" } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("requests")
    .select("id,request_no,title,status,priority,created_at,request_type:request_types(name_th)")
    .eq("requester_id", employee.id)
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow">Request Center</div><h2>คำร้องของฉัน</h2><p>ค้นหาและติดตามสถานะคำร้องที่คุณสร้าง</p></div>
        <Link className="btn" href="/requests/new"><Plus size={16} /> สร้างคำร้อง</Link>
      </div>
      <div className="filters">
        {filters.map(([value, label]) => <Link className={status === value ? "active" : ""} href={value === "all" ? "/requests" : `/requests?status=${value}`} key={value}>{label}</Link>)}
      </div>
      <section className="card"><RequestTable requests={data ?? []} /></section>
    </>
  );
}

