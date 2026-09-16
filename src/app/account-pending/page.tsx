import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";

export default async function AccountPendingPage() {
  if (!(await getCurrentUser())) redirect("/login");
  return (
    <main className="auth-form-wrap" style={{ minHeight: "100vh" }}>
      <section className="card" style={{ maxWidth: 520, textAlign: "center" }}>
        <div className="brand-mark" style={{ margin: "0 auto 18px", color: "white" }}>M</div>
        <h1>บัญชียังไม่ผูกกับข้อมูลพนักงาน</h1>
        <p className="muted">กรุณาแจ้งผู้ดูแลระบบให้นำ User UUID ของบัญชีนี้ไปผูกกับ Employee Master</p>
        <form action={signOutAction} style={{ marginTop: 20 }}><button className="btn secondary">ออกจากระบบ</button></form>
      </section>
    </main>
  );
}

