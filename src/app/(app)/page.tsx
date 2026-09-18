import Link from "next/link";
import { ArrowRight, ClipboardList, FileText, Wrench } from "lucide-react";
import { RequestTable } from "@/components/request-table";
import { getCurrentEmployee } from "@/lib/auth";
import { getPendingApprovals } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const requestTypeIcons = {
  MT_REPAIR: Wrench,
  MANAGEMENT: FileText,
  NCR_CAR: ClipboardList,
} as const;

const requestModuleCodes = ["MT_REPAIR", "MANAGEMENT", "NCR_CAR"];

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  const supabase = await createClient();
  const [requestsResult, typesResult, pending] = await Promise.all([
    supabase
      .from("requests")
      .select("id,request_no,title,status,priority,created_at,request_type:request_types(name_th)")
      .eq("requester_id", employee.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("request_types")
      .select("id,code,name_th,description")
      .eq("is_active", true)
      .in("code", requestModuleCodes)
      .order("sort_order"),
    getPendingApprovals(employee),
  ]);
  const requests = requestsResult.data ?? [];
  const inProgress = requests.filter((request) => ["approved", "in_progress"].includes(request.status)).length;
  const completed = requests.filter((request) => request.status === "completed").length;
  const today = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "full",
    timeZone: "Asia/Bangkok",
  }).format(new Date());

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <h1>สวัสดีตอนบ่าย, {employee.first_name}</h1>
          <p>รายการสำคัญและความเคลื่อนไหวที่เกี่ยวข้องกับคุณ</p>
        </div>
        <time>{today}</time>
      </div>

      <section className="summary-strip" aria-label="สรุปงาน">
        <Link className="summary-primary" href="/approvals">
          <span>งานที่ต้องจัดการ</span>
          <strong>{pending.length}</strong>
          <small>{pending.length ? "เปิดรายการที่รอการอนุมัติ" : "ไม่มีงานค้างในขณะนี้"}</small>
        </Link>
        <div className="summary-cell"><span>คำร้องของฉัน</span><strong>{requests.length}</strong><small>คำร้องทั้งหมดในระบบ</small></div>
        <div className="summary-cell"><span>กำลังดำเนินการ</span><strong>{inProgress}</strong><small>อยู่ระหว่างรับผิดชอบ</small></div>
        <div className="summary-cell"><span>เสร็จแล้ว</span><strong>{completed}</strong><small>ปิดงานเรียบร้อย</small></div>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>ความเคลื่อนไหวล่าสุด</h2>
            <Link href="/requests">ดูทั้งหมด <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
          <RequestTable requests={requests.slice(0, 6)} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>สร้างคำร้อง</h2>
            <Link href="/requests/new">ทุกประเภท <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
          <div className="quick-list">
            {(typesResult.data ?? []).map((type) => {
              const Icon = requestTypeIcons[type.code as keyof typeof requestTypeIcons] ?? ClipboardList;
              return (
                <Link className="quick-item" href={`/requests/new?type=${type.id}`} key={type.id}>
                  <span className="quick-icon"><Icon size={16} aria-hidden="true" /></span>
                  <span className="quick-copy"><strong>{type.name_th}</strong><small>{type.description}</small></span>
                  <ArrowRight className="quick-arrow" size={14} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
