// โมดูลแผนก GR — แปรรูปยาง (ลำดับ 07 ของผังงาน) #/gr · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานของ GR ที่ยังเปิดอยู่ ใช้การ์ดงานกลาง (MNP_FACTORY.jobCard) แบบอ่านอย่างเดียว · รายงานผลและพักงานยังทำที่หน้า BOM (ลิงก์ที่หัวหน้า)
(function registerGrModule() {
  const F = window.MNP_FACTORY;
  const LIVE_ORDER = Object.freeze(["released", "in_progress", "completed"]);

  function landing(ctx) {
    const { ui, data } = ctx;
    const orderOf = (id) => data.orders.find((entry) => entry.id === id);
    const jobs = data.jobs
      .filter((job) => job.dept === "GR" && LIVE_ORDER.includes(orderOf(job.orderId)?.status) && ctx.helpers.isOpenJob(data, job))
      .sort((a, b) => (Number(a.dueAt) || 0) - (Number(b.dueAt) || 0) || String(a.id).localeCompare(String(b.id)));
    const body = jobs.length ? `<div class="bom-job-grid">${jobs.map((job) => F.jobCard(ctx, job, { planner: false, dept: "GR", orderOf, actions: false })).join("")}</div>` : ui.card(ui.empty("ไม่มีงานของ GR ค้างอยู่"));
    return { html: `${F.pageHead(ctx, "งานของแผนกฉัน", F.actionLink(ctx, "ไปงานของฉัน (BOM)", ctx.url("work", { dept: "GR" })))}${body}` };
  }

  F.registerDeptModule({ code: "FACTORY_GR", dept: "GR", route: "gr", label: "แปรรูปยาง (GR)", icon: "machine", palette: "gr", landing });
})();
