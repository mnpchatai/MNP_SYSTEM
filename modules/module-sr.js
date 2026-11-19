// โมดูลแผนก SR — คลังยางเส้นยาว (ลำดับ 05 ของผังงาน) #/sr · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = ยางเส้นยาวที่อยู่ในคลังตอนนี้ (อ่านจาก store ของ BOM: ล็อตที่รับเข้าแล้ว × ถังเจ้าของ) ค้นหาได้ แล้วตามด้วยงานของ SR ที่รออยู่
// อ่านอย่างเดียว: รับเข้าคลัง / จ่ายยางให้ GR ยังทำที่หน้า BOM (ลิงก์ที่หัวหน้า) จนกว่าจะย้ายมาเป็นขั้นต่อไป
(function registerSrModule() {
  const F = window.MNP_FACTORY;

  const ownerText = (ctx, bucket) => {
    if (!bucket.owner) return "สต็อกกลาง";
    return bucket.free ? `สต็อกกลาง (ใบ ${bucket.owner})` : ctx.ui.link(`ใบ ${bucket.owner}`, ctx.url("orders", { sel: bucket.owner }), "rf-mono");
  };

  function landing(ctx) {
    const { ui, rules, data, q } = ctx;
    const nameOf = (code) => ctx.helpers.itemOf(data, code)?.name ?? "";
    const buckets = rules.rodBuckets(data)
      .filter((bucket) => bucket.lot.status === "stored" && F.includesText(`${bucket.itemCode} ${nameOf(bucket.itemCode)} ${bucket.lot.lotNo}`, q))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || (Number(a.lot.receivedAt) || 0) - (Number(b.lot.receivedAt) || 0) || String(a.lot.lotNo).localeCompare(String(b.lot.lotNo)) || (a.owner === null ? 0 : 1) - (b.owner === null ? 0 : 1));
    const { shown, more } = F.limited(ctx, buckets);
    const rows = shown.map((bucket) => `<tr><td>${ui.mono(bucket.itemCode)}<div class="small muted">${F.esc(nameOf(bucket.itemCode))}</div></td><td class="right rf-mono">${F.esc(`${rules.fmtQty(bucket.qty)} ${rules.uomLabel(bucket.lot.uom)}`)}</td><td><span class="rf-mono">${F.esc(bucket.lot.lotNo)}</span><div class="small muted">${F.esc(bucket.lot.receivedAt ? rules.fmtDate(bucket.lot.receivedAt) : "—")}</div></td><td>${ownerText(ctx, bucket)}</td></tr>`);
    const stock = ui.card(`${ui.table(["เส้นยาง", { label: "จำนวน", className: "right" }, "ล็อต", "ของ"], rows, { emptyText: q ? "ไม่พบเส้นยางที่ค้นหา" : "ยังไม่มียางเส้นยาวในคลัง" })}${more}`, { flush: true });
    const tasks = window.MNP_BOM_PAGES?.hub?.rodTasks?.(ctx, "SR") ?? [];
    return { html: `${F.pageHead(ctx, "ยางเส้นยาวในคลัง", F.actionLink(ctx, "ไปงานของฉัน (BOM)", ctx.url("work", { dept: "SR" })))}${F.searchForm(ctx, "ค้นหารหัส ชื่อ หรือเลขล็อต")}${stock}${F.taskTable(ctx, tasks)}` };
  }

  F.registerDeptModule({ code: "FACTORY_SR", dept: "SR", route: "sr", label: "คลังยางเส้นยาว (SR)", icon: "ruler", palette: "sr", landing });
})();
