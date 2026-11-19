// โมดูลแผนก QA — ตรวจคุณภาพ (ลำดับ 06 ของผังงาน) #/qa · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานรอตัดสินของ QA จากสองแหล่ง: ยางเส้นยาวที่ถูกกักตอนรับเข้าคลัง SR (store ของ BOM) และล็อตที่ถูกกักในสายผลิตของ RubberFlow (store ของ RubberFlow)
// ยางเส้นยาวที่กักเป็นการ์ดสั่งงานชุดเดียวกับ BOM "งานของฉัน" (ตัดสินที่นี่ได้ MNP_FACTORY.deptWorkSection) · ล็อตของ RubberFlow ยังเป็นตารางพร้อมลิงก์ไปตัดสินที่หน้า RubberFlow
(function registerQaModule() {
  const F = window.MNP_FACTORY;

  const rodSection = (ctx) => F.deptWorkSection(ctx, { title: "ยางเส้นยาวที่กักรอตัดสิน", emptyText: "ไม่มียางเส้นยาวที่กักรอตัดสิน" });

  function rubberflowSection(ctx) {
    const { ui } = ctx;
    const store = ctx.rubberflow()?.store;
    if (!store) return "";
    const link = F.actionLink(ctx, "ไปตัดสินที่ RubberFlow", "#/rubberflow?p=quality");
    if (F.failed(store)) return F.rubberflowFailed(ctx, "ล็อตในสายผลิตที่กักรอตัดสิน", link);
    if (F.wake(store)) return ui.card('<p class="small muted" role="status">กำลังโหลดข้อมูล RubberFlow…</p>', { title: "ล็อตในสายผลิตที่กักรอตัดสิน", actions: link });
    const rf = window.MNP_RUBBERFLOW_RULES;
    const lots = (store.data().lots ?? []).filter((lot) => lot.qc === "hold").sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    const rows = lots.map((lot) => `<tr><td>${ui.mono(lot.id)}<div class="small muted">${F.esc(lot.orderId ?? "")}</div></td><td>${F.esc(rf?.STAGE_LABEL?.[lot.stage] ?? lot.stage ?? "")}</td><td class="small">${F.esc((lot.holdReasons ?? []).join(", "))}</td><td class="right rf-mono">${F.esc(`${rf?.fmtNum ? rf.fmtNum(lot.goodQty, 2) : lot.goodQty} ${rf?.unitText?.(lot.uom) ?? lot.uom ?? ""}`)}</td></tr>`);
    return ui.card(ui.table(["ล็อต", "ขั้นตอน", "สาเหตุที่กัก", { label: "ปริมาณ", className: "right" }], rows, { emptyText: "ไม่มีล็อตที่กักรอตัดสิน" }), { title: "ล็อตในสายผลิตที่กักรอตัดสิน", actions: link, flush: true });
  }

  function landing(ctx) {
    return { html: `${F.viewHead(ctx)}${rodSection(ctx)}${rubberflowSection(ctx)}`, actions: true };
  }

  F.registerDeptModule({ code: "FACTORY_QA", dept: "QA", route: "qa", label: "ตรวจคุณภาพ (QA)", icon: "clipboard-check", palette: "qa", landing });
})();
