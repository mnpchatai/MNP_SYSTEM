import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-form-wrap" style={{ minHeight: "100vh" }}>
      <section className="card" style={{ textAlign: "center", maxWidth: 480 }}>
        <div className="eyebrow">404</div><h1>ไม่พบข้อมูลที่ต้องการ</h1>
        <p className="muted">รายการอาจไม่มีอยู่ หรือคุณไม่มีสิทธิ์เข้าถึง</p>
        <Link className="btn" href="/">กลับหน้าหลัก</Link>
      </section>
    </main>
  );
}

