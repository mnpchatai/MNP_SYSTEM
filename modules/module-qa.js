// โมดูลแผนก QA — ตรวจคุณภาพ (ลำดับ 06 ของผังงาน) #/qa · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานรอตัดสินของ QA จากสองแหล่ง: ยางเส้นยาวที่ถูกกักตอนรับเข้าคลัง SR (store ของ BOM) และล็อตที่ถูกกักในสายผลิตของ RubberFlow (store ของ RubberFlow)
// อ่านอย่างเดียว: ตัดสินและบันทึกผลตรวจยังทำที่หน้า BOM / RubberFlow (ลิงก์ที่หัวตารางของแต่ละแหล่ง)
(function registerQaModule() {
  const F = window.MNP_FACTORY;

  function rodSection(ctx) {
    const { ui, rules, data } = ctx;
    const nameOf = (code) => ctx.helpers.itemOf(data, code)?.name ?? "";
    const lots = (data.rodLots ?? []).filter((lot) => lot.status === "held").sort((a, b) => (Number(a.receivedAt) || 0) - (Number(b.receivedAt) || 0) || String(a.lotNo).localeCompare(String(b.lotNo)));
    const rows = lots.map((lot) => `<tr><td><span class="rf-mono">${F.esc(lot.lotNo)}</span><div class="small muted">${F.esc(`ใบ ${lot.orderId}`)}</div></td><td>${ui.mono(lot.itemCode)}<div class="small muted">${F.esc(nameOf(lot.itemCode))}</div></td><td class="right rf-mono">${F.esc(`${rules.fmtQty(lot.qtyReceived ?? lot.qtySent)} ${rules.uomLabel(lot.uom)}`)}</td><td class="small">${F.esc(lot.qc?.note ?? "")}</td></tr>`);
    return ui.card(ui.table(["ล็อต", "เส้นยาง", { label: "รับไว้", className: "right" }, "หมายเหตุจาก SR"], rows, { emptyText: "ไม่มียางเส้นยาวที่กักรอตัดสิน" }), { title: "ยางเส้นยาวที่กักรอตัดสิน", actions: F.actionLink(ctx, "ไปตัดสินที่ BOM", ctx.url("work", { dept: "QA" })), flush: true });
  }

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
    return { html: `${F.pageHead(ctx, "งานของแผนกฉัน")}${rodSection(ctx)}${rubberflowSection(ctx)}` };
  }

  F.registerDeptModule({ code: "FACTORY_QA", dept: "QA", route: "qa", label: "ตรวจคุณภาพ (QA)", icon: "clipboard-check", palette: "qa", landing });
})();
