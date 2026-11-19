// โมดูลแผนก WH — คลังสินค้าสำเร็จรูป (ลำดับ 11 ของผังงาน) #/wh · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = แท็บ "งานที่รอ" (รับเข้า ปิดใบ ส่งมอบ) กับ "ในคลัง" (MNP_FACTORY.storeLanding) · ในคลัง = สินค้าสำเร็จรูปคงเหลือต่อรหัส (อยู่ในคลัง · สต็อกกลาง · ใบที่ถือของอยู่) ค้นหาได้
// การ์ดงานใช้ชุดเดียวกับ BOM "งานของฉัน" (MNP_FACTORY.deptWorkSection): ปิดใบ (รับไม่ครบ) สั่งที่นี่ได้ ส่วนรับเข้า ปิดใบ และส่งมอบเป็นลิงก์ไปขั้น 5 / 6 ของหน้าใบสั่งผลิตเหมือนใน BOM
(function registerWhModule() {
  const F = window.MNP_FACTORY;

  function landing(ctx) {
    const { ui, rules, data, q } = ctx;
    const nameOf = (code) => ctx.helpers.itemOf(data, code)?.name ?? "";
    const unitOf = (code) => F.esc(rules.uomLabel(ctx.helpers.itemOf(data, code)?.uom ?? "set"));
    const onHand = rules.fgOnHand(data).filter((row) => row.onHand > 0 || row.free > 0);
    const list = onHand.filter((row) => F.includesText(`${row.fgCode} ${nameOf(row.fgCode)}`, q));
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map((row) => {
      const freeOf = new Map(row.freeOrders.map((entry) => [entry.orderId, entry.qty]));
      const holders = row.orders.filter((entry) => entry.qty > 0).map((entry) => `${ui.link(entry.orderId, ctx.url("orders", { sel: entry.orderId, step: "6" }), "rf-mono")} <span class="small muted">× ${F.esc(rules.fmtQty(entry.qty))}${freeOf.has(entry.orderId) ? ` (ว่าง ${F.esc(rules.fmtQty(freeOf.get(entry.orderId)))})` : ""}</span>`);
      return `<tr><td>${ui.mono(row.fgCode)}<div class="small muted">${F.esc(nameOf(row.fgCode))}</div></td><td class="right rf-mono">${F.esc(rules.fmtQty(row.onHand))} <span class="small muted">${unitOf(row.fgCode)}</span></td><td class="right rf-mono">${row.free > 0 ? `${F.esc(rules.fmtQty(row.free))} <span class="small muted">${unitOf(row.fgCode)}</span>` : '<span class="muted">—</span>'}</td><td>${holders.length ? holders.join("<br>") : '<span class="muted">สต็อกกลาง</span>'}</td></tr>`;
    });
    const stock = ui.card(`${ui.table(["สินค้า", { label: "อยู่ในคลัง", className: "right" }, { label: "สต็อกกลาง", className: "right", title: "ส่วนที่เกินจากที่ใบนั้นสั่ง ใบสั่งผลิตอื่นที่ยังเป็นร่างนำไปใช้ลดงานผลิตได้" }, "ของใบ"], rows, { emptyText: q ? "ไม่พบสินค้าสำเร็จรูปที่ค้นหา" : "ยังไม่มีสินค้าสำเร็จรูปในคลัง" })}${more}`, { flush: true });
    return { html: F.storeLanding(ctx, { dept: "WH", stock: { count: onHand.length, html: `${F.searchForm(ctx, "ค้นหารหัสหรือชื่อสินค้า")}${stock}` } }), actions: true };
  }

  F.registerDeptModule({ code: "FACTORY_WH", dept: "WH", route: "wh", label: "คลังสินค้าสำเร็จรูป (WH)", icon: "warehouse", palette: "wh", landing });
})();
