// โมดูล "ฝ่ายโรงงาน" ของ Pilot Web — เปิดเฉพาะโหมดทดสอบของผู้ดูแลระบบ
//
// แผนกในฝ่าย (modules/factory-departments.js): PP วางแผนการผลิต · RB ขึ้นรูปยาง · GR แปรรูปยาง ·
// PT ขึ้นรูปพลาสติก · BG เย็บจักร · PK ประกอบบรรจุภัณฑ์
//
// ขอบเขตตอนนี้: โครงโมดูลและหน้าของแต่ละแผนกเท่านั้น (#/factory, #/factory?dept=<รหัส>)
// ยังไม่มีฟอร์ม/ขั้นตอนงานของแผนกใด และ **ไม่อ่าน/เขียนฐานข้อมูลเลย** จึงไม่มี migration/RPC/RLS ใหม่
// และไม่กระทบข้อมูลจริง เมื่อกำหนด workflow ของแผนกแล้วให้เพิ่มตารางพร้อมการแยกข้อมูลทดสอบ
// (ดู private.sandbox_guard_table ใน 20261005030000_admin_sandbox_mode.sql) และเทสต์ใน
// supabase/tests/database/ ก่อนเปิดการบันทึกข้อมูล
//
// เมนูข้างโผล่เฉพาะโหมดทดสอบ (nav.sandboxOnly) และหน้านี้ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
// (การซ่อนเมนูอย่างเดียวไม่ใช่การควบคุมสิทธิ์) ไม่มีฝั่ง Next.js เพราะโหมดทดสอบมีเฉพาะ Pilot Web
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, app, shell, bindShell,
// renderNotFound, escapeHtml) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactoryModule() {
  const PATH = "factory";
  const TITLE = "ฝ่ายโรงงาน";
  const THEME = ["#475569", "#1e293b"];
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V10l6 4v-4l6 4V5h4v16H3Z"/><path d="M8 21v-3h2v3M14 21v-3h2v3"/></svg>`;

  const factory = window.MNP_FACTORY;
  const gradient = ([from, to]) => `linear-gradient(135deg, ${from}, ${to})`;

  function overviewHtml() {
    const cards = factory.DEPARTMENTS.map((department) => `<a class="type-card" href="${escapeHtml(factory.url(department.code))}" style="background:${gradient(department.theme)}">
        <span class="request-type-top"><span class="type-card-badge">${escapeHtml(department.code)}</span></span>
        <span class="type-card-body"><strong>${escapeHtml(department.name)}</strong><small>เปิดแผนก →</small></span>
      </a>`).join("");
    return `<div class="page-heading request-module-header" style="background:${gradient(THEME)}">
        <div class="request-module-title"><span class="type-card-badge">${NAV_ICON}</span><div><div class="eyebrow">โหมดทดสอบ</div><h1>${TITLE}</h1><p>${factory.DEPARTMENTS.length} แผนก · โครงโมดูลสำหรับทดลอง ยังไม่บันทึกข้อมูล</p></div></div>
      </div>
      <div class="request-type-heading"><h2>เลือกแผนก</h2></div>
      <nav class="type-grid factory-dept-grid" aria-label="แผนกฝ่ายโรงงาน">${cards}</nav>`;
  }

  function departmentHtml(department) {
    const tabs = factory.DEPARTMENTS.map((item) => `<a class="filter${item.code === department.code ? " active" : ""}" href="${escapeHtml(factory.url(item.code))}"${item.code === department.code ? ` aria-current="page"` : ""}>${escapeHtml(item.code)} ${escapeHtml(item.name)}</a>`).join("");
    return `<a class="request-back-link" href="${escapeHtml(factory.url())}" aria-label="ย้อนกลับไปเลือกแผนก">‹ ย้อนกลับ</a>
      <div class="page-heading request-module-header" style="background:${gradient(department.theme)}">
        <div class="request-module-title"><span class="type-card-badge">${escapeHtml(department.code)}</span><div><div class="eyebrow">${TITLE} · โหมดทดสอบ</div><h1>${escapeHtml(department.name)}</h1><p>แผนก ${escapeHtml(department.code)}</p></div></div>
      </div>
      <nav class="filters" aria-label="สลับแผนกฝ่ายโรงงาน">${tabs}</nav>
      <section class="card">
        <h2>แผนก ${escapeHtml(department.code)} ${escapeHtml(department.name)}</h2>
        <div class="empty">ยังไม่มีแบบฟอร์มหรือขั้นตอนงานของแผนกนี้<br><small>โมดูลอยู่ในโหมดทดสอบ รอกำหนดขั้นตอนงานของแผนกก่อนเปิดให้บันทึกข้อมูล</small></div>
      </section>`;
  }

  async function renderFactory(params) {
    // เมนูข้างโผล่เฉพาะโหมดทดสอบ แต่ URL พิมพ์เข้ามาเองได้ — ผู้ใช้นอกโหมดทดสอบต้องไม่เห็นหน้านี้
    if (!state.employee?.isSandbox) return renderNotFound();
    // dept ที่ไม่รู้จักพากลับหน้ารวม ไม่แสดงหน้าว่างของแผนกที่ไม่มีอยู่
    const department = factory.find(params.get("dept"));
    app.innerHTML = shell(
      department ? departmentHtml(department) : overviewHtml(),
      PATH,
      department ? `${TITLE} / ${department.code} ${department.name}` : TITLE,
    );
    bindShell();
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.FACTORY = {
    code: "FACTORY",
    enabled: true,
    // หน้านี้ไม่แตะฐานข้อมูล จึงปลอดภัยที่จะเปิดในโหมดทดสอบ (โมดูลที่เขียนข้อมูลต้องมี guard ที่ฐานข้อมูลก่อน)
    sandbox: true,
    label: TITLE,
    theme: THEME,
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON, sandboxOnly: true }],
    pages: { [PATH]: renderFactory },
  };
})();
