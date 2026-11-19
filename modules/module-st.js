// โมดูลแผนก ST — คลังวัตถุดิบ (ลำดับ 03 ของผังงาน) #/st · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = แท็บ "งานที่รอ" (การ์ดชุดเดียวกับ BOM "งานของฉัน": คืนของสั่งที่นี่ได้ ส่วนเบิก รับเข้า สั่งซื้อเป็นลิงก์ไปหน้าใบสั่งผลิต / RubberFlow) กับ "ในคลัง" (MNP_FACTORY.storeLanding)
// "ในคลัง" แสดงเฉพาะของซื้อที่มียอดจริง หรือต่ำกว่าสต็อกขั้นต่ำ (ทะเบียนจริงมีหลายร้อยรายการที่ยอด 0) · ค้นหาหาได้ทั้งทะเบียน · ?all=1 ดูทั้งทะเบียน
(function registerStModule() {
  const F = window.MNP_FACTORY;

  function landing(ctx) {
    const { ui, rules, data, q } = ctx;
    const all = ctx.params.get("all") === "1";
    const stockOf = new Map((data.stock ?? []).map((row) => [row.itemCode, row]));
    const qtyOf = (code) => Number(stockOf.get(code)?.qty) || 0;
    const safetyOf = (code) => Number(stockOf.get(code)?.safetyQty) || 0;
    const isLow = (code) => safetyOf(code) > 0 && qtyOf(code) < safetyOf(code);
    const register = data.items.filter((item) => item.kind === "PURCHASED" && (item.active !== false || stockOf.has(item.code)));
    const inStore = register.filter((item) => qtyOf(item.code) > 0 || isLow(item.code));
    // ต่ำกว่าขั้นต่ำขึ้นก่อน แล้วตามรหัส
    const list = (q || all ? register : inStore)
      .filter((item) => F.includesText(`${item.code} ${item.name}`, q))
      .sort((a, b) => Number(isLow(b.code)) - Number(isLow(a.code)) || a.code.localeCompare(b.code));
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map((item) => {
      const qty = qtyOf(item.code);
      const safety = safetyOf(item.code);
      const unit = F.esc(rules.uomLabel(item.uom));
      return `<tr><td>${ui.mono(item.code)}<div class="small muted">${F.esc(item.name)}</div></td><td class="right rf-mono">${F.esc(rules.fmtQty(qty))} <span class="small muted">${unit}</span>${isLow(item.code) ? ` ${ui.badge("warn", "ต่ำกว่าขั้นต่ำ")}` : ""}</td><td class="right rf-mono">${safety > 0 ? `${F.esc(rules.fmtQty(safety))} <span class="small muted">${unit}</span>` : '<span class="muted">—</span>'}</td></tr>`;
    });
    const scope = all || q
      ? ui.link("เฉพาะที่มีของ", ctx.pageUrl({ tab: "stock", q: null, all: null }), "btn rf-btn secondary small")
      : ui.link(`ดูทั้งทะเบียน (${register.length})`, ctx.pageUrl({ tab: "stock", all: 1 }), "btn rf-btn secondary small");
    const empty = q ? "ไม่พบของซื้อที่ค้นหา" : all ? "ยังไม่มีของซื้อในทะเบียน" : "ยังไม่มีของซื้อในคลัง";
    const stockHtml = `<div class="rf-row">${F.searchForm(ctx, "ค้นหารหัสหรือชื่อของซื้อ (ทั้งทะเบียน)")}${scope}</div>${ui.card(`${ui.table(["ของซื้อ", { label: "คงเหลือ", className: "right" }, { label: "สต็อกขั้นต่ำ", className: "right" }], rows, { emptyText: empty })}${more}`, { flush: true })}`;
    // ใบสั่งซื้อและเคมีอยู่ใน RubberFlow: ยังไม่โหลด = สั่งโหลดและวาดหน้าใหม่เมื่อเสร็จ
    const rfStore = ctx.rubberflow()?.store;
    const loading = F.wake(rfStore);
    const failed = F.failed(rfStore);
    const waiting = `${failed ? F.rubberflowFailed(ctx, "เคมีและใบสั่งซื้อ") : ""}${loading ? '<p class="small muted" role="status">กำลังโหลดข้อมูลใบสั่งซื้อและเคมี…</p>' : ""}`;
    return { html: F.storeLanding(ctx, { dept: "ST", stock: { count: inStore.length, html: stockHtml }, work: { waiting } }), actions: true };
  }

  F.registerDeptModule({ code: "FACTORY_ST", dept: "ST", route: "st", label: "คลังวัตถุดิบ (ST)", icon: "box", palette: "st", menu: F.STORE_MENU, landing });
})();
