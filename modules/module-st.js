// โมดูลแผนก ST — คลังวัตถุดิบ (ลำดับ 03 ของผังงาน) #/st · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = ของซื้อที่อยู่ในคลังตอนนี้ (ยอดคงเหลือและสต็อกขั้นต่ำ จาก store ของ BOM) ค้นหาได้ แล้วตามด้วยงานของ ST ที่รออยู่ (รับเข้าตามใบสั่งซื้อ สั่งซื้อที่ขาด คืนของ)
// อ่านอย่างเดียว: เบิกจ่าย นับ รับเข้า ยังทำที่หน้า BOM / RubberFlow (ลิงก์ที่หัวหน้า)
(function registerStModule() {
  const F = window.MNP_FACTORY;

  function landing(ctx) {
    const { ui, rules, data, q } = ctx;
    const stockOf = new Map((data.stock ?? []).map((row) => [row.itemCode, row]));
    const list = data.items
      .filter((item) => item.kind === "PURCHASED" && (item.active !== false || stockOf.has(item.code)) && F.includesText(`${item.code} ${item.name}`, q))
      .sort((a, b) => a.code.localeCompare(b.code));
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map((item) => {
      const row = stockOf.get(item.code);
      const qty = Number(row?.qty) || 0;
      const safety = Number(row?.safetyQty) || 0;
      const low = safety > 0 && qty < safety;
      const unit = F.esc(rules.uomLabel(item.uom));
      return `<tr><td>${ui.mono(item.code)}<div class="small muted">${F.esc(item.name)}</div></td><td class="right rf-mono">${F.esc(rules.fmtQty(qty))} <span class="small muted">${unit}</span>${low ? ` ${ui.badge("warn", "ต่ำกว่าขั้นต่ำ")}` : ""}</td><td class="right rf-mono">${safety > 0 ? `${F.esc(rules.fmtQty(safety))} <span class="small muted">${unit}</span>` : '<span class="muted">—</span>'}</td></tr>`;
    });
    const stock = ui.card(`${ui.table(["ของซื้อ", { label: "คงเหลือ", className: "right" }, { label: "สต็อกขั้นต่ำ", className: "right" }], rows, { emptyText: q ? "ไม่พบของซื้อที่ค้นหา" : "ยังไม่มีของซื้อในทะเบียน" })}${more}`, { flush: true });
    // ใบสั่งซื้อและเคมีอยู่ใน RubberFlow: ยังไม่โหลด = สั่งโหลดและวาดหน้าใหม่เมื่อเสร็จ
    const rfStore = ctx.rubberflow()?.store;
    const loading = F.wake(rfStore);
    const tasks = window.MNP_BOM_PAGES?.hub?.storeTasks?.(F.deptCtx(ctx)) ?? [];
    const waiting = loading ? '<p class="small muted" role="status">กำลังโหลดข้อมูลใบสั่งซื้อและเคมี…</p>' : "";
    return { html: `${F.pageHead(ctx, "ของซื้อในคลัง", F.actionLink(ctx, "ไปงานของฉัน (BOM)", ctx.url("work", { dept: "ST" })))}${F.searchForm(ctx, "ค้นหารหัสหรือชื่อของซื้อ")}${stock}${waiting}${F.failed(rfStore) ? F.rubberflowFailed(ctx, "งานที่รอ") : F.taskTable(ctx, tasks)}` };
  }

  F.registerDeptModule({ code: "FACTORY_ST", dept: "ST", route: "st", label: "คลังวัตถุดิบ (ST)", icon: "box", palette: "st", landing });
})();
