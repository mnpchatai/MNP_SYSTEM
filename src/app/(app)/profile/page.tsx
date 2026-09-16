import { CheckCircle2, Link2, Unlink } from "lucide-react";
import { unlinkLineAction } from "@/app/actions/line";
import { getCurrentEmployee } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const lineMessages: Record<string, string> = {
  linked: "เชื่อมต่อ LINE และตั้งเมนูพนักงานแล้ว",
  "linked-no-menu": "เชื่อมต่อ LINE แล้ว แต่ยังตั้ง Rich Menu ไม่สำเร็จ กรุณาเพิ่ม OA เป็นเพื่อนและลองใหม่",
  unlinked: "ยกเลิกการเชื่อมต่อ LINE แล้ว",
  "not-configured": "ยังไม่ได้ตั้งค่า LINE Login ใน environment",
  conflict: "บัญชี LINE นี้เชื่อมกับพนักงานรายอื่นอยู่แล้ว",
  "invalid-state": "การเชื่อมต่อหมดอายุ กรุณาลองใหม่",
  "token-error": "LINE ไม่สามารถออก access token ได้",
  "profile-error": "ไม่สามารถอ่านโปรไฟล์ LINE ได้",
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ line?: string }> }) {
  const employee = await getCurrentEmployee();
  const { line } = await searchParams;
  const supabase = await createClient();
  const { data: lineAccount } = await supabase.from("line_accounts").select("*").eq("employee_id", employee.id).maybeSingle();

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">My Profile</div><h2>ข้อมูลส่วนตัว</h2><p>ข้อมูลพนักงาน สิทธิ์ และช่องทางแจ้งเตือน</p></div></div>
      {line && lineMessages[line] && <div className={`form-message ${line === "linked" || line === "unlinked" ? "success" : "error"}`}>{lineMessages[line]}</div>}
      <div className="grid-2">
        <section className="card">
          <div className="card-title"><h3>Employee Master</h3></div>
          <dl className="definition-grid">
            <div className="definition"><dt>ชื่อ-นามสกุล</dt><dd>{employee.first_name} {employee.last_name}</dd></div>
            <div className="definition"><dt>รหัสพนักงาน</dt><dd>{employee.employee_no}</dd></div>
            <div className="definition"><dt>อีเมล</dt><dd>{employee.email}</dd></div>
            <div className="definition"><dt>ตำแหน่ง</dt><dd>{employee.job_title ?? "—"}</dd></div>
            <div className="definition"><dt>แผนก</dt><dd>{employee.department?.name_th}</dd></div>
            <div className="definition"><dt>บทบาท</dt><dd>{employee.role?.name_th}</dd></div>
          </dl>
        </section>
        <section className="card">
          <div className="card-title"><h3>LINE OA</h3></div>
          {lineAccount ? (
            <div className="stack">
              <div><span className="badge completed"><CheckCircle2 size={12} /> เชื่อมต่อแล้ว</span></div>
              <div><strong>{lineAccount.display_name ?? "LINE user"}</strong><div className="muted small">เชื่อมเมื่อ {formatDate(lineAccount.linked_at, true)}</div></div>
              <p className="muted small">บัญชีนี้รับการแจ้งเตือนและใช้เมนูพนักงานแบบรายบุคคลได้</p>
              <form action={unlinkLineAction}><button className="btn secondary" type="submit"><Unlink size={15} /> ยกเลิกการเชื่อมต่อ</button></form>
            </div>
          ) : (
            <div className="stack">
              <p className="muted small">เชื่อม LINE เพื่อรับการแจ้งเตือนและเปิดเมนู “ระบบพนักงาน” เฉพาะบัญชีที่ยืนยันแล้ว</p>
              <a className="btn" href="/api/line/link"><Link2 size={15} /> เชื่อมต่อ LINE</a>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

