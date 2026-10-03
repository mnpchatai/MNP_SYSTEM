import { CheckCircle2, Link2, Unlink } from "lucide-react";
import { unlinkLineAction } from "@/app/actions/line";
import { setActingRoleAction, updateOwnPhotoAction } from "@/app/actions/profile";
import { SubmitButton } from "@/components/submit-button";
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

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string; photo?: string; role?: string; error?: string }>;
}) {
  const employee = await getCurrentEmployee();
  const { line, photo, role, error } = await searchParams;
  const supabase = await createClient();
  const { data: lineAccount } = await supabase.from("line_accounts").select("*").eq("employee_id", employee.id).maybeSingle();
  const isAdmin = employee.role?.code === "admin";
  const { data: roles } = isAdmin
    ? await supabase.from("roles").select("id, code, name_th").neq("code", "admin").order("sort_order")
    : { data: [] as { id: string; code: string; name_th: string | null }[] };
  const initials = `${employee.first_name.at(0) ?? ""}${employee.last_name.at(0) ?? ""}`;

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">My Profile</div><h2>ข้อมูลส่วนตัว</h2><p>ข้อมูลพนักงาน สิทธิ์ และช่องทางแจ้งเตือน</p></div></div>
      {line && lineMessages[line] && <div className={`form-message ${line === "linked" || line === "unlinked" ? "success" : "error"}`}>{lineMessages[line]}</div>}
      {photo === "updated" && <div className="form-message success">อัปเดตรูปโปรไฟล์แล้ว</div>}
      {role === "updated" && <div className="form-message success">บันทึกบทบาทหลักแล้ว แจ้งเตือนใหม่จะส่งตามบทบาทนี้</div>}
      {error && <div className="form-message error">{error}</div>}
      <div className="grid-2">
        <section className="card">
          <div className="card-title"><h3>Employee Master</h3></div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <div className="sidebar-avatar" style={{ width: 56, height: 56, fontSize: 18 }}>
              {employee.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Supabase storage URL, not a static asset
                <img src={employee.photo_url} alt="" />
              ) : (
                initials
              )}
            </div>
            <form action={updateOwnPhotoAction} className="stack" encType="multipart/form-data">
              <input className="input" type="file" name="photo" accept="image/jpeg,image/png,image/webp" required />
              <SubmitButton className="btn secondary small" pendingLabel="กำลังอัปโหลด...">อัปโหลดรูปโปรไฟล์</SubmitButton>
              <span className="muted" style={{ fontSize: 10 }}>สูงสุด 3 MB · JPG, PNG, WebP</span>
            </form>
          </div>
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
        {isAdmin && (
          <section className="card">
            <div className="card-title"><h3>บทบาทหลักในการทำงาน</h3></div>
            <form action={setActingRoleAction} className="stack">
              <p className="muted small">เลือกบทบาทที่คุณทำงานจริง ระบบจะส่งแจ้งเตือนและแสดงรายการรออนุมัติเฉพาะของบทบาทนั้น และนับคุณเป็นผู้อนุมัติในสายอนุมัติของบทบาทนั้น สิทธิ์ผู้ดูแลระบบยังใช้ได้ครบ แต่จะไม่ได้รับแจ้งเตือนคำร้องเปิดบัญชี/แก้ไข ID</p>
              <div className="field">
                <label htmlFor="acting_role_id">ทำงานในฐานะ</label>
                <select className="select" id="acting_role_id" name="acting_role_id" defaultValue={employee.acting_role_id ?? ""}>
                  <option value="">ผู้ดูแลระบบ (รับแจ้งเตือนทั้งหมดของผู้ดูแลระบบ)</option>
                  {(roles ?? []).map((item) => <option key={item.id} value={item.id}>{item.name_th ?? item.code}</option>)}
                </select>
              </div>
              <SubmitButton className="btn" pendingLabel="กำลังบันทึก...">บันทึกบทบาทหลัก</SubmitButton>
            </form>
          </section>
        )}
      </div>
    </>
  );
}

