import { redirect } from "next/navigation";
import { CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";
import { signInAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
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
      <section className="auth-hero">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div><strong>MNP INTERNAL</strong><span>Paperless Operations</span></div>
        </div>
        <div className="auth-copy">
          <div className="eyebrow" style={{ color: "#71d3ce" }}>WORK SMARTER · MOVE FASTER</div>
          <h1>งานภายใน<br />ที่เดินหน้า<br />โดยไม่ใช้กระดาษ</h1>
          <p>สร้างคำร้อง อนุมัติ ติดตามงาน และรับการแจ้งเตือนในที่เดียว พร้อมประวัติที่ตรวจสอบย้อนหลังได้</p>
        </div>
        <div className="auth-points">
          <span><FileCheck2 size={15} /> คำร้องดิจิทัล</span>
          <span><CheckCircle2 size={15} /> อนุมัติเป็นขั้นตอน</span>
          <span><ShieldCheck size={15} /> สิทธิ์ตามบทบาท</span>
        </div>
      </section>

      <section className="auth-form-wrap">
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
