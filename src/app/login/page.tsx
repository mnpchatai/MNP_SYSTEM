import { redirect } from "next/navigation";
import { CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";
import { signInAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-aside">
        <div className="auth-brand">
          <div className="brand-mark">M</div>
          <div><strong>MNP Workspace</strong><span>INTERNAL OPERATIONS</span></div>
        </div>
        <div className="auth-intro">
          <div className="eyebrow">Employee workspace</div>
          <h1>ระบบคำร้องและ<br />การอนุมัติภายใน</h1>
          <p>พื้นที่ทำงานกลางสำหรับสร้างคำร้อง ติดตามสถานะ และดำเนินการอนุมัติอย่างเป็นขั้นตอน</p>
        </div>
        <div className="auth-points">
          <span><FileCheck2 size={15} /> คำร้องดิจิทัล</span>
          <span><CheckCircle2 size={15} /> ตรวจสอบสถานะได้</span>
          <span><ShieldCheck size={15} /> สิทธิ์ตามบทบาท</span>
        </div>
      </section>

      <section className="auth-form-wrap">
        <div className="auth-theme"><ThemeToggle /></div>
        <form className="auth-form" action={signInAction}>
          <h2>เข้าสู่ระบบพนักงาน</h2>
          <p>ใช้รหัสพนักงานและรหัสผ่านที่ผู้ดูแลระบบออกให้</p>
          {error && <div className="form-message error">{error}</div>}
          <div className="field">
            <label htmlFor="employee_no">รหัสพนักงาน</label>
            <input
              className="input"
              id="employee_no"
              name="employee_no"
              type="text"
              autoComplete="username"
              autoCapitalize="characters"
              maxLength={32}
              placeholder="เช่น ADMIN001"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">รหัสผ่าน</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <SubmitButton pendingLabel="กำลังเข้าสู่ระบบ...">เข้าสู่ระบบ</SubmitButton>
        </form>
      </section>
    </main>
  );
}
