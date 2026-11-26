// หน้าของโมดูลคลังวัตถุดิบ (ST) #/st — โหลดก่อน modules/module-st.js (ดู index.html) · ที่เดียวที่ ST จ่ายเคมีให้ RB รับคืน รับเข้าตามใบสั่งซื้อ เบิกจ่ายของซื้อ และนับสต็อก (ไม่มีสำเนาที่สองในหน้า BOM / RubberFlow)
// ของในคลังมาจากสองทาง: ของซื้อ (store ของ BOM: stock / stockMoves) และล็อตเคมี (store ของ RubberFlow: materialLots ยอดคลัง ST = qtyKg · คลังเคมีของ RB = rbKg · 20261220010000)
// หน้า: งานของฉัน (ค่าตั้งต้น) · ในคลัง ?tab=stock (หน้าของซื้อ ?part=<รหัส> · หน้าล็อตเคมี ?lot=<ล็อต>) · วัตถุดิบที่กัก ?tab=hold · ใบสั่งซื้อ ?tab=po · จ่ายออก ?tab=issue (&order=<ใบ>) · รับคืน ?tab=returns · นับสต็อก ?tab=count
// คำสั่งของของซื้อวิ่งไป store ของ BOM (dialog issueParts / returnParts / undoParts และฟอร์ม countPartStock ผ่านตัวผูกของหน้าแผนก)
// ส่วนของ RubberFlow (ใบสั่งซื้อ เคมี ใบขอเบิก ใบคืน ป้าย กักกัน) อยู่ใน [data-rf-scope] ที่ตัวผูกของ RubberFlow ผูกเอง (dialog และคำสั่งชุดเดียวกับหน้า RubberFlow · ตัวผูกของหน้าแผนกข้ามส่วนนี้)
// ผู้เข้าชม (ไม่อยู่ในเมนู เข้าทางลิงก์ · access): แผนก RB ดูเคมีในคลัง ST อย่างเดียว · แผนก WH ดูและนับของซื้อ
//   · แผนก QA ไม่ใช่ผู้เข้าชมแล้ว (โรงงานขั้น 5): กักกัน / ปลดกักกันวัตถุดิบของ QA อยู่ที่ #/qa?tab=material · คนอื่นไม่พบหน้า
// วัตถุดิบที่กักแสดงสองที่ (เจ้าของสั่ง 2026-11-24 "วัตถุดิบที่กักให้มี 2 ที่ คือ QA และ ST และให้หัวหน้า ST ปลดได้ด้วย"): หน้า ?tab=hold ที่นี่และ #/qa?tab=material เป็นชุดเดียวกัน (MNP_FACTORY.heldMaterialView)
//   · ST กักกันได้ (หน้าล็อตและหน้าวัตถุดิบที่กัก) · ปลดกักกัน = หัวหน้า ST หรือหัวหน้า QA ขึ้นไป (rules.canReleaseMaterial · ปุ่มแสดงเฉพาะผู้ที่ทำได้ · ฐานข้อมูล RF_MATERIAL_RELEASE_HEAD_ONLY)
// การซ่อน/แสดงปุ่มเป็นแค่ UX สิทธิ์จริงตัดสินที่ action และฐานข้อมูล: จ่ายเคมี ปิดยอด รับคืน ใบสั่งซื้อ = แผนก ST (admin) · เบิกจ่ายของซื้อ = ST / ฝ่ายวางแผน · นับ = ST / WH / ฝ่ายวางแผน · สต็อกขั้นต่ำ = ST / ฝ่ายวางแผน
(function registerStPages(root) {
  const F = root.MNP_FACTORY;
  const rfDialogs = (root.MNP_RUBBERFLOW_DIALOGS ??= {});
  const ROUTE = "st";
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const num = (value) => Number(value) || 0;
  const stUrl = (query = {}) => F.routeUrl(ROUTE, query);
  const backLink = (href, text) => `<a class="request-back-link" href="${attr(href)}">${esc(text)}</a>`;
  // แถวตารางคลิกได้ทั้งแถว (stretched link เหมือนหน้า SR / WH)
  const rowAttr = (href, extra = "") => { const names = [href ? "row-link" : "", extra].filter(Boolean).join(" "); return names ? ` class="${names}"` : ""; };
  const mainLink = (ctx, text, href, cls = "rf-mono") => ctx.ui.link(text, href, [cls, "row-link-main"].filter(Boolean).join(" "));
  const dash = '<span class="muted">—</span>';
  const rfScope = (html) => (html ? `<div data-rf-scope="rubberflow">${html}</div>` : "");
  const rfRules = () => root.MNP_RUBBERFLOW_RULES ?? null;
  const views = () => root.MNP_RUBBERFLOW_VIEWS ?? {};
  const hub = () => root.MNP_BOM_PAGES?.hub ?? null;

  // ---------- ใครเปิดหน้าไหนได้ ----------
  // full = ผู้ใช้โมดูล (แผนก ST · แผนก PP · ผู้จัดการ: canOpenDeptModule) · rb = แผนก RB ดูเคมีในคลัง ST อย่างเดียว · wh = แผนก WH ดูและนับของซื้อ
  // · null = ไม่พบหน้า (แผนก QA ไปที่ #/qa?tab=material แทน)
  const deptOf = (employee) => String(employee?.department?.code ?? employee?.department_code ?? "").toUpperCase();
  const GUEST_DEPTS = Object.freeze({ RB: "rb", WH: "wh" });
  function access(employee) {
    if (!employee || employee.isSandbox !== true) return null;
    if (F.canOpenDeptModule(employee, "ST", "FACTORY_ST")) return "full";
    if (!root.MNP_BOM_STORE?.usesBom?.(employee) || root.MNP_DEPARTMENT_ACCESS?.isRestricted?.(employee)) return null;
    return GUEST_DEPTS[deptOf(employee)] ?? null;
  }
  const guest = (employee) => { const mode = access(employee); return mode && mode !== "full" ? mode : null; };
  // หน้าที่ผู้เข้าชมเปิดได้ (อย่างอื่นกลับไปหน้าในคลัง) · chem = เห็นเฉพาะเคมี (หน้าล็อตเปิดได้) · part = เห็นเฉพาะของซื้อ (หน้าของซื้อเปิดได้)
  const GUEST_VIEWS = Object.freeze({ rb: ["stock"], wh: ["stock", "count"] });
  const GUEST_KIND = Object.freeze({ rb: "chem", wh: "part" });

  // ---------- ข้อมูลของ RubberFlow (ยังไม่โหลด: สั่งโหลดและวาดหน้าใหม่เมื่อเสร็จ) ----------
  function rfState(ctx) {
    const rf = ctx.rubberflow?.() ?? null;
    const store = rf?.store ?? null;
    if (!store) return { status: "none", data: null, ctx: null };
    if (F.failed(store)) return { status: "failed", data: null, ctx: null };
    if (F.wake(store)) return { status: "loading", data: null, ctx: null };
    let rfCtx = null;
    try { rfCtx = rf.context(new URLSearchParams()); } catch { rfCtx = null; }
    return rfCtx ? { status: "ready", data: rfCtx.data, ctx: rfCtx } : { status: "none", data: null, ctx: null };
  }
  const rfNote = (ctx, rf, title = "เคมีและใบสั่งซื้อ") => (rf.status === "loading" ? '<p class="small muted" role="status">กำลังโหลดข้อมูลเคมีและใบสั่งซื้อ…</p>' : rf.status === "failed" ? F.rubberflowFailed(ctx, title) : "");
  // สิทธิ์ของคำสั่ง RubberFlow ตามผู้ใช้ของ RubberFlow (ตารางสิทธิ์ชุดเดียวกับหน้า RubberFlow) · ผู้เข้าชมไม่มีปุ่มของ RubberFlow
  const rfCan = (ctx, rf, permission) => !ctx.guest && rf.status === "ready" && Boolean(rf.ctx?.can?.(permission));
  const materialOf = (rf, code) => rf.data?.materials?.find((row) => row.code === code) ?? null;
  const kg = (ctx, value) => `${ctx.rules.fmtQty(value)} kg`;

  // ---------- ของซื้อ (store ของ BOM) ----------
  const stockMap = (ctx) => new Map((ctx.data.stock ?? []).map((row) => [row.itemCode, row]));
  const partRegister = (ctx, stockOf = stockMap(ctx)) => ctx.data.items.filter((item) => item.kind === "PURCHASED" && (item.active !== false || stockOf.has(item.code)));
  const partQty = (stockOf, code) => num(stockOf.get(code)?.qty);
  const partSafety = (stockOf, code) => num(stockOf.get(code)?.safetyQty);
  const partLow = (stockOf, code) => partSafety(stockOf, code) > 0 && partQty(stockOf, code) < partSafety(stockOf, code);
  const partOnOrder = (ctx) => { const orders = root.MNP_BOM_PAGES?.tools?.purchaseOrdersOf?.(ctx); return orders ? ctx.rules.partOnOrder(orders) : null; };
  const partHref = (code) => stUrl({ part: code });

  // ---------- เคมี (store ของ RubberFlow) ----------
  // ยอดที่ใช้คิดสั่งซื้อ = คลัง ST + คลัง RB ของล็อตที่ใช้ได้ (ไม่กักกัน ไม่หมดอายุ · กฎเดียวกับ rules.chemicalNeeds) · สั่งค้างรับ = บรรทัดเคมีของใบสั่งซื้อที่ยังรอรับ
  function chemPosition(ctx, rf) {
    const R = rfRules();
    const onHand = new Map();
    const onOrder = new Map();
    if (rf.status !== "ready" || !R) return { onHand, onOrder };
    for (const lot of rf.data.materialLots ?? []) if (lot.status !== "hold" && lot.expiry > ctx.now) onHand.set(lot.materialCode, (onHand.get(lot.materialCode) ?? 0) + R.lotKg(lot, "ST") + R.lotKg(lot, "RB"));
    for (const po of rf.data.purchaseOrders ?? []) {
      if (po.status !== "ordered") continue;
      for (const line of po.lines ?? []) if (line.source !== "bom") onOrder.set(line.materialCode, (onOrder.get(line.materialCode) ?? 0) + R.poLineOpen(line));
    }
    return { onHand, onOrder };
  }
  const chemSafety = (rf, code) => num(materialOf(rf, code)?.safetyKg);
  const lotHref = (lotNo) => stUrl({ lot: lotNo });

  // ---------- ในคลัง: รายการเดียวของของซื้อที่มียอด และล็อตเคมีที่คลัง ST มียอด ----------
  const KIND_FILTERS = Object.freeze([{ value: "part", label: "ของซื้อ" }, { value: "chem", label: "เคมี" }]);
  const filterSelect = (ctx, name, label, options, value, placeholder) => `<div class="field rf-field sr-filter"><label class="sr-only" for="st-${name}">${esc(label)}</label>${ctx.ui.select(name, options, { value, placeholder, id: `st-${name}`, extra: `data-st-filter title="${attr(label)}"` })}</div>`;
  function stockRows(ctx, rf) {
    const { rules } = ctx;
    const stockOf = stockMap(ctx);
    const rows = [];
    for (const item of partRegister(ctx, stockOf)) {
      const qty = partQty(stockOf, item.code);
      if (!(qty > 0)) continue;
      rows.push({ key: `part:${item.code}`, kind: "part", code: item.code, name: item.name ?? "", qty, unit: rules.uomLabel(item.uom), lotNo: "", expiry: null, state: "", low: partLow(stockOf, item.code), href: partHref(item.code) });
    }
    const R = rfRules();
    if (rf.status === "ready" && R) {
      const { onHand } = chemPosition(ctx, rf);
      for (const lot of rf.data.materialLots ?? []) {
        const qty = R.lotKg(lot, "ST");
        if (!(qty > 0.0001)) continue;
        const safety = chemSafety(rf, lot.materialCode);
        rows.push({ key: `chem:${lot.lotNo}`, kind: "chem", code: lot.materialCode, name: materialOf(rf, lot.materialCode)?.name ?? "", qty, unit: "kg", lotNo: lot.lotNo, expiry: lot.expiry, state: R.lotState(lot, ctx.now, "ST"), low: safety > 0 && (onHand.get(lot.materialCode) ?? 0) < safety, href: lotHref(lot.lotNo) });
      }
    }
    return rows.sort((a, b) => String(a.code).localeCompare(String(b.code)) || num(a.expiry) - num(b.expiry) || String(a.key).localeCompare(String(b.key)));
  }
  function stockView(ctx, rf) {
    const { ui, rules, q } = ctx;
    // ผู้เข้าชม: RB / QA เห็นเฉพาะเคมี · WH เห็นเฉพาะของซื้อ (ไม่มีตัวกรองชนิด)
    const forced = ctx.guest ? GUEST_KIND[ctx.guest] ?? "" : "";
    const kind = forced || (["part", "chem"].includes(ctx.params.get("kind")) ? ctx.params.get("kind") : "");
    const list = stockRows(ctx, rf).filter((row) => (!kind || row.kind === kind) && F.includesText(`${row.code} ${row.name} ${row.lotNo}`, q));
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map((row) => {
      const main = mainLink(ctx, row.kind === "chem" ? row.lotNo : row.code, row.href);
      const item = row.kind === "chem" ? `${ui.mono(row.code)}<div class="small muted">${esc(row.name)}</div>` : `${main}<div class="small muted">${esc(row.name)}</div>`;
      const lot = row.kind === "chem" ? `${main}<div class="small muted">${esc(`หมดอายุ ${rules.fmtDate(row.expiry)}`)}</div>` : dash;
      const badges = [row.kind === "chem" && row.state !== "available" ? ui.status(row.state) : "", row.low ? ui.badge("warn", "ต่ำกว่าขั้นต่ำ") : ""].filter(Boolean).join(" ");
      return `<tr${rowAttr(row.href)}><td>${item}</td><td class="right rf-mono">${esc(`${rules.fmtQty(row.qty)} ${row.unit}`)}</td><td>${lot}</td><td>${badges}</td></tr>`;
    });
    const filtered = Boolean(q || (kind && !forced));
    const kindFilter = forced ? "" : filterSelect(ctx, "kind", "ชนิด", KIND_FILTERS, kind, "ทั้งหมด");
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, forced === "chem" ? "ค้นหารหัส ชื่อ หรือล็อต" : forced === "part" ? "ค้นหารหัสหรือชื่อของซื้อ" : "ค้นหารหัส ชื่อ หรือล็อต")}${kindFilter}${filtered ? ui.link("ล้างตัวกรอง", stUrl(ctx.view.params), "btn rf-btn secondary small") : ""}</div>`;
    const empty = q ? "ไม่พบรายการที่ค้นหา" : kind === "chem" ? "ยังไม่มีเคมีในคลัง ST" : kind === "part" ? "ยังไม่มีของซื้อในคลัง" : "ยังไม่มีของในคลัง";
    const table = ui.card(`${ui.table(["รายการ", { label: "คงเหลือ", className: "right" }, "ล็อต", "สถานะ"], rows, { emptyText: empty })}${more}`, { flush: true });
    return `${forced === "part" ? "" : rfNote(ctx, rf)}${toolbar}${table}`;
  }

  // ---------- หน้าของซื้อ (?part=) ----------
  function historyRows(ctx, code) {
    const { rules } = ctx;
    const KIND = { count: "นับ", receive: "รับเข้า", issue: "เบิกจ่าย", return: "คืน" };
    return (ctx.data.stockMoves ?? []).map((move, index) => [move, index]).filter(([move]) => move.itemCode === code)
      .sort((a, b) => num(b[0].at) - num(a[0].at) || b[1] - a[1]).slice(0, 100)
      .map(([move]) => `<tr><td class="nowrap small">${esc(rules.fmtDateTime(move.at))}</td><td>${esc(KIND[move.kind] ?? move.kind)}${move.ref ? `<div class="small muted rf-mono">${esc(move.ref)}</div>` : ""}${move.note ? `<div class="small muted">${esc(move.note)}</div>` : ""}</td><td class="right rf-mono">${esc(`${num(move.qty) > 0 ? "+" : ""}${rules.fmtQty(move.qty)}`)}</td><td class="right rf-mono">${esc(rules.fmtQty(move.balance))}</td><td class="small">${esc(move.by ?? "")}</td></tr>`);
  }
  // ช่องนับ / สต็อกขั้นต่ำของแถว (ฟอร์ม countPartStock: itemCode[] qty[] safetyQty[] ตามลำดับแถว) · ไม่มีสิทธิ์ = ตัวเลขอย่างเดียว
  const qtyInput = (name, label, value, placeholder = "") => `<label class="bom-count-input"><span class="sr-only">${esc(label)}</span><input class="input rf-input" name="${attr(name)}" type="number" inputmode="decimal" step="any" min="0" value="${attr(value)}" placeholder="${attr(placeholder)}"></label>`;
  function partView(ctx, code) {
    const { ui, rules, data, user } = ctx;
    const back = backLink(stUrl({ tab: "stock" }), "‹ ในคลัง");
    const item = data.items.find((entry) => entry.code === code && entry.kind === "PURCHASED");
    if (!item) return `${back}${F.pageHead(ctx, "ของซื้อ")}${ui.card(ui.empty("ไม่พบของซื้อนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)"))}`;
    const stockOf = stockMap(ctx);
    const row = stockOf.get(item.code);
    const unit = rules.uomLabel(item.uom);
    const reserved = rules.partReserved(data.jobs, data.orders).get(item.code) || 0;
    const onOrder = partOnOrder(ctx);
    const facts = ui.kv([
      ["ชื่อ", esc(item.name ?? "")],
      ["คงเหลือ", `${esc(`${rules.fmtQty(row?.qty ?? 0)} ${unit}`)}${partLow(stockOf, item.code) ? ` ${ui.badge("warn", "ต่ำกว่าขั้นต่ำ")}` : ""}`],
      ["จองแล้ว", esc(`${rules.fmtQty(reserved)} ${unit}`)],
      ...(onOrder ? [["สั่งค้างรับ", esc(`${rules.fmtQty(onOrder.get(item.code) || 0)} ${unit}`)]] : []),
      ...(row?.countedAt ? [["นับล่าสุด", esc(`${rules.fmtDate(row.countedAt)} · ${row.countedBy ?? ""}`)]] : []),
    ]);
    const canCount = ctx.helpers.canCount(user);
    const canSafety = !ctx.guest && ctx.helpers.canSetSafety(user);
    const countForm = canCount || canSafety
      ? ui.card(`<form novalidate data-rf-form="countPartStock" data-rf-success="บันทึกยอด {result}" class="bom-count-form"><input type="hidden" name="itemCode[]" value="${attr(item.code)}"><div class="rf-grid rf-g2">
          ${canCount ? ui.field(`ยอดที่นับได้ (${unit})`, qtyInput("qty[]", `ยอดที่นับได้ ${item.code}`, "", rules.fmtQty(row?.qty ?? 0))) : ""}
          ${canSafety ? ui.field(`สต็อกขั้นต่ำ (${unit})`, qtyInput("safetyQty[]", `สต็อกขั้นต่ำ ${item.code}`, row?.safetyQty ?? 0)) : `<input type="hidden" name="safetyQty[]" value="">`}
          ${canCount ? "" : `<input type="hidden" name="qty[]" value="">`}</div><div class="rf-row bom-step-next"><button class="btn rf-btn" type="submit">บันทึก</button></div></form>`, { title: esc(canCount ? "นับสต็อก" : "สต็อกขั้นต่ำ") })
      : "";
    const history = ui.card(ui.table(["เวลา", "รายการ", { label: "เปลี่ยน", className: "right" }, { label: "คงเหลือ", className: "right" }, "ผู้ทำ"], historyRows(ctx, item.code), { emptyText: "ยังไม่มีประวัติ" }), { title: esc("ประวัติเข้าออก"), flush: true });
    return `${back}${F.pageHead(ctx, item.code)}<div class="sr-lot">${ui.card(facts, { className: "sr-lot-facts" })}${countForm}</div>${history}`;
  }

  // ---------- หน้าล็อตเคมี (?lot=) ----------
  function lotEvents(ctx, rf, lotNo) {
    const R = rfRules();
    const events = [];
    const lot = rf.data.materialLots.find((row) => row.lotNo === lotNo);
    if (lot) events.push({ at: num(lot.receivedAt), text: "รับเข้าคลังวัตถุดิบ (ST)", detail: [lot.supplier, lot.location].filter((part) => part && part !== "-").join(" · "), kg: num(lot.initialKg), by: "" });
    for (const doc of R.chemDocsOf(rf.data)) {
      for (const line of doc.lines ?? []) {
        if (doc.kind === "request") for (const issue of line.issues ?? []) { if (issue.lotNo === lotNo) events.push({ at: num(issue.at), text: `จ่ายให้ RB ตามใบ ${doc.id}`, detail: "", kg: num(issue.kg), by: issue.by ?? "" }); }
        else if (line.lotNo === lotNo && doc.kind === "return") events.push({ at: num(doc.createdAt), text: `RB คืนตามใบ ${doc.id}`, detail: "", badge: doc, kg: num(line.kg), by: doc.createdBy ?? "" });
        else if (line.lotNo === lotNo && doc.kind === "count") events.push({ at: num(doc.createdAt), text: `RB นับยอดคลัง RB ใบ ${doc.id}`, detail: `${ctx.rules.fmtQty(line.beforeKg)} → ${ctx.rules.fmtQty(line.countedKg)} kg · ${doc.reason ?? ""}`, kg: null, by: doc.createdBy ?? "" });
      }
    }
    for (const requisition of rf.data.requisitions ?? []) {
      const used = (requisition.lines ?? []).filter((line) => line.lotNo === lotNo).reduce((sum, line) => sum + num(line.actualKg ?? line.targetKg), 0);
      if (used > 0) events.push({ at: num(requisition.issuedAt ?? requisition.createdAt), text: `เบิกผสม ${requisition.id} (${R.requisitionStore(requisition) === "RB" ? "คลัง RB" : "คลัง ST"})`, detail: requisition.orderId ?? "", kg: used, by: requisition.issuedBy ?? requisition.requestedBy ?? "" });
    }
    return events.sort((a, b) => b.at - a.at).slice(0, 100);
  }
  function lotView(ctx, rf, lotNo) {
    const { ui, rules } = ctx;
    const back = backLink(stUrl({ tab: "stock", kind: ctx.guest ? null : "chem" }), "‹ ในคลัง");
    if (rf.status !== "ready") return `${back}${F.pageHead(ctx, "ล็อตเคมี")}${rfNote(ctx, rf) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"))}`;
    const R = rfRules();
    const lot = rf.data.materialLots.find((row) => row.lotNo === lotNo);
    if (!lot) return `${back}${F.pageHead(ctx, "ล็อตเคมี")}${ui.card(ui.empty("ไม่พบล็อตนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)"))}`;
    const state = R.lotState(lot, ctx.now, "ST");
    const days = Math.ceil((lot.expiry - ctx.now) / R.DAY);
    const transit = R.lotInTransitKg(rf.data, lot.lotNo);
    const material = materialOf(rf, lot.materialCode);
    const facts = ui.kv([
      ["วัตถุดิบ", `${ui.mono(lot.materialCode)}${material?.name ? `<div class="small muted">${esc(material.name)}</div>` : ""}`],
      ["หมดอายุ", `${esc(rules.fmtDate(lot.expiry))} <span class="small ${days < 0 ? "rf-late" : days < 30 ? "rf-warn-text" : "muted"}">${esc(days < 0 ? `เลยมา ${-days} วัน` : `อีก ${days} วัน`)}</span>`],
      ["สถานะ", lot.status === "hold" ? ui.status("hold") : state === "expired" ? ui.status("expired") : ui.status("available")],
      ["คลัง ST", esc(kg(ctx, R.lotKg(lot, "ST")))],
      ["คลัง RB", esc(kg(ctx, R.lotKg(lot, "RB")))],
      ...(transit > 0 ? [["RB คืนระหว่างทาง", esc(kg(ctx, transit))]] : []),
      ["รับเข้า", esc(`${kg(ctx, lot.initialKg)} · ${rules.fmtDate(lot.receivedAt)}${lot.coa ? " · มี CoA" : ""}`)],
    ]);
    // ป้าย (บาร์โค้ด Code 39 ของ RubberFlow) และกักกัน / ปลดกักกัน: ชุดเดียวกับหน้า RubberFlow เดิม · ปลดกักกัน = หัวหน้า ST หรือหัวหน้า QA ขึ้นไป (ปุ่มชุดเดียวกับหน้าวัตถุดิบที่กัก) · ผู้เข้าชมไม่มีปุ่ม
    const hold = rfCan(ctx, rf, "holdMaterial");
    const holdButtons = [
      hold && lot.status !== "hold" && state !== "empty" ? ui.button("กักกัน", { action: "setMaterialLotStatus", args: { lotNo: lot.lotNo, status: "hold" }, className: "secondary", confirmText: `กักกันล็อต ${lot.lotNo}? ล็อตที่กักกันจ่ายไม่ได้ทั้งคลัง ST และคลัง RB จนกว่าจะปลดกักกัน`, success: "กักกันล็อต {result} แล้ว" }) : "",
      rfCan(ctx, rf, "releaseMaterial") && lot.status === "hold" ? F.materialReleaseButton(ui, lot, "secondary") : "",
    ].join("");
    const buttons = !ctx.guest ? rfScope(`${ui.openButton("พิมพ์ป้าย", "tag", { kind: "material", id: lot.lotNo }, { className: "secondary" })}${holdButtons}`) : "";
    const rows = lotEvents(ctx, rf, lot.lotNo).map((event) => `<tr><td class="nowrap small">${event.at ? esc(rules.fmtDateTime(event.at)) : dash}</td><td>${esc(event.text)}${event.badge && views().chemStatus ? ` ${views().chemStatus(ui, event.badge)}` : ""}${event.detail ? `<div class="small muted">${esc(event.detail)}</div>` : ""}</td><td class="right rf-mono">${event.kg === null ? dash : esc(rules.fmtQty(event.kg))}</td><td class="small">${esc(event.by)}</td></tr>`);
    const history = ui.card(ui.table(["เวลา", "รายการ", { label: "kg", className: "right" }, "ผู้ทำ"], rows, { emptyText: "ยังไม่มีความเคลื่อนไหว" }), { title: esc("ความเคลื่อนไหวของล็อต"), flush: true });
    return `${back}${F.pageHead(ctx, `ล็อต ${lot.lotNo}`, buttons)}${ui.card(facts, { className: "sr-lot-facts" })}${history}`;
  }

  // ---------- การ์ดงาน ----------
  const cardLines = (list, render, noun) => hub()?.cardLines?.(list, render, noun) ?? `<ul class="bom-job-parts">${list.map(render).join("")}</ul>`;
  const readOnlyNote = '<p class="small muted">ดูอย่างเดียว บัญชีนี้ไม่มีสิทธิ์ดำเนินการ</p>';
  const card = ({ tone = "is-now", state, when = "", title, href = null, sub = "", lines = "", actions = "" }) => `<article class="card rf-card bom-job ${tone}${F.cardClass(href)}"><div class="bom-job-top"><span class="bom-job-state">${esc(state)}</span>${when ? `<span class="muted">${esc(when)}</span>` : ""}</div>
      <h2>${F.cardTitle(title, href)}</h2>${sub ? `<p class="small muted">${sub}</p>` : ""}${lines}${actions}</article>`;
  const chemName = (rf, code) => materialOf(rf, code)?.name || code;
  // ปุ่มของเอกสารคลังเคมี (ใช้ทั้งการ์ดและตาราง): จ่ายเคมี · ปิดยอดที่เหลือ · รับคืนทั้งใบ · ไม่รับคืน
  const issueButton = (ctx, doc, className = "bom-job-main") => ctx.ui.openButton("จ่ายเคมีให้ RB", "chemIssue", { id: doc.id }, { className, ariaLabel: `จ่ายเคมีตามใบ ${doc.id}` });
  const closeButton = (ctx, doc) => ctx.ui.openButton("ปิดยอดที่เหลือ", "chemClose", { id: doc.id }, { className: "secondary small", ariaLabel: `ปิดยอดที่เหลือของ ${doc.id}` });
  const receiveReturnButton = (ctx, doc, className = "bom-job-main") => ctx.ui.button("รับคืนเข้าคลังวัตถุดิบ (ST)", { action: "receiveChemicalReturn", args: { id: doc.id }, className, confirmText: `รับเคมีคืนตามใบ ${doc.id} เข้าคลังวัตถุดิบ (ST) ทั้งใบ? ยอดทุกล็อตเข้าคลัง ST ตามที่ RB ส่ง ถ้ายอดไม่ตรงให้กดไม่รับคืนแทน`, success: "รับคืนตามใบ {result} แล้ว", ariaLabel: `รับคืนตามใบ ${doc.id} เข้าคลังวัตถุดิบ (ST)` });
  const rejectButton = (ctx, doc) => ctx.ui.openButton("ไม่รับคืน", "chemReject", { id: doc.id }, { className: "secondary small", ariaLabel: `ไม่รับคืนตามใบ ${doc.id}` });
  const requisitionReturnButton = (ctx, req, className = "bom-job-main") => ctx.ui.openButton("รับคืนเคมี", "returnRequisition", { id: req.id }, { className, ariaLabel: `รับเคมีคืนตามใบเบิก ${req.id}` }).replace("<button ", '<button data-rf-right="returnRequisition" ');

  function chemCards(ctx, rf) {
    const R = rfRules();
    if (rf.status !== "ready" || !R) return [];
    const { rules } = ctx;
    const cards = [];
    const mayIssue = rfCan(ctx, rf, "issueChem");
    for (const doc of R.chemRequestsToIssue(rf.data)) {
      const open = (doc.lines ?? []).filter((line) => R.chemLineOpenKg(line) > 0);
      cards.push(card({ state: doc.status === "partial" ? "ST จ่ายบางส่วน" : "รอ ST จ่าย", when: `ขอเมื่อ ${rules.fmtDateTime(doc.createdAt)}`, title: `จ่ายเคมีตามใบขอเบิก ${doc.id}`, href: stUrl({ tab: "issue" }),
        sub: esc([`RB · ${doc.createdBy ?? ""}`, doc.note].filter(Boolean).join(" · ")),
        lines: cardLines(open, (line) => `<li><span>${esc(chemName(rf, line.materialCode))}</span><span class="nowrap">${esc(kg(ctx, R.chemLineOpenKg(line)))}</span></li>`),
        actions: mayIssue ? rfScope(issueButton(ctx, doc)) : readOnlyNote }));
    }
    for (const doc of R.chemReturnsPending(rf.data)) {
      cards.push(card({ state: "รอ ST รับคืน", when: `ส่งเมื่อ ${rules.fmtDateTime(doc.createdAt)}`, title: `รับเคมีคืนจาก RB ใบ ${doc.id}`, href: stUrl({ tab: "returns" }),
        sub: esc([`RB · ${doc.createdBy ?? ""}`, doc.note].filter(Boolean).join(" · ")),
        lines: cardLines(doc.lines ?? [], (line) => `<li><span><span class="rf-mono">${esc(line.lotNo)}</span> <span class="small muted">${esc(chemName(rf, line.materialCode))}</span></span><span class="nowrap">${esc(kg(ctx, line.kg))}</span></li>`),
        actions: mayIssue ? rfScope(`${receiveReturnButton(ctx, doc)}<div class="rf-row bom-job-more">${rejectButton(ctx, doc)}</div>`) : readOnlyNote }));
    }
    // ใบเบิกเดิมของคลัง ST ของ WO ที่ถูกยกเลิก (ใบคลัง RB = RB คืนเข้าคลัง RB เอง ไม่ใช่งานของ ST)
    const mayReturn = rfCan(ctx, rf, "returnRequisition");
    for (const req of R.returnableRequisitions(rf.data, "ST")) {
      const total = (req.lines ?? []).reduce((sum, line) => sum + num(line.actualKg), 0);
      cards.push(card({ tone: "is-hold", state: "WO ถูกยกเลิก · รอ ST รับคืน", title: `รับเคมีคืนตามใบเบิก ${req.id}`, href: stUrl({ tab: "returns" }), sub: esc(`WO ${req.orderId} · จ่ายไป ${kg(ctx, total)}`),
        actions: mayReturn ? rfScope(requisitionReturnButton(ctx, req)) : readOnlyNote }));
    }
    // ใบสั่งซื้อที่ยังรอรับ: หนึ่งการ์ดต่อใบ ปุ่มพาไปหน้าใบสั่งซื้อ (รับทีละบรรทัด รับไม่ครบได้)
    for (const po of (rf.data.purchaseOrders ?? []).filter((row) => row.status === "ordered").sort((a, b) => num(a.createdAt) - num(b.createdAt))) {
      const lines = (po.lines ?? []).filter((line) => R.poLineOpen(line) > 0);
      if (!lines.length) continue;
      const nameOf = (line) => (line.source === "bom" ? ctx.data.items.find((item) => item.code === line.materialCode)?.name : null) || materialOf(rf, line.materialCode)?.name || "";
      const unit = (line) => (line.source === "bom" ? rules.uomLabel(line.uom) : "kg");
      cards.push(card({ state: R.poTouched(po) ? "รับแล้วบางส่วน" : "รอรับเข้า", when: `สั่งเมื่อ ${rules.fmtDate(po.createdAt)}`, title: `รับเข้าตามใบสั่งซื้อ ${po.id}`, href: stUrl({ tab: "po", q: po.id }),
        sub: po.sourcePi ? esc(`สั่งจากใบ ${po.sourcePi}`) : "",
        lines: cardLines(lines, (line) => `<li><span><span class="rf-mono">${esc(line.materialCode)}</span>${nameOf(line) ? ` <span class="small muted">${esc(nameOf(line))}</span>` : ""}</span><span class="nowrap">${esc(`${rules.fmtQty(R.poLineOpen(line))} ${unit(line)}`)}</span></li>`),
        actions: ctx.ui.link("รับเข้าคลังวัตถุดิบ (ST)", stUrl({ tab: "po", q: po.id }), "btn rf-btn bom-job-main") }));
    }
    return cards;
  }

  // วัตถุดิบที่กัก: การ์ดเดียวรวมทุกล็อต (บรรทัดไม่เกินที่ hub.cardLines กำหนด ที่เหลือบอก "อีก N ล็อต") พาไปหน้าวัตถุดิบที่กัก · เฉพาะผู้ที่ปลดกักกันได้ (หัวหน้า ST ขึ้นไป) เพราะเป็นงานของเขา
  // พนักงาน ST ไม่มีการ์ดนี้ (ปลดไม่ได้) แต่เห็นล็อตที่กักที่หน้าวัตถุดิบที่กักและสถานะในหน้าในคลัง
  function holdCards(ctx, rf) {
    const R = rfRules();
    if (rf.status !== "ready" || !R || !rfCan(ctx, rf, "releaseMaterial")) return [];
    const held = F.heldMaterialWork(rf.data);
    if (!held.length) return [];
    return [card({ tone: "is-hold", state: "วัตถุดิบถูกกัก", title: `วัตถุดิบที่กักรอปลดกักกัน ${held.length} ล็อต`, href: stUrl({ tab: "hold" }),
      lines: cardLines(held, (lot) => `<li><span><span class="rf-mono">${esc(lot.lotNo)}</span> <span class="small muted">${esc(chemName(rf, lot.materialCode))}</span></span><span class="nowrap">${esc(kg(ctx, R.lotKg(lot, "ST") + R.lotKg(lot, "RB")))}</span></li>`, "ล็อต"),
      actions: ctx.ui.link("ไปที่วัตถุดิบที่กัก", stUrl({ tab: "hold" }), "btn rf-btn bom-job-main") })];
  }

  // ต่ำกว่าสต็อกขั้นต่ำ (ยังไม่นับที่สั่งค้างรับ): เคมี = สั่งซื้อได้จากหน้าต่างสั่งซื้อของ RubberFlow (เติมถึงขั้นต่ำ) · ของซื้อ = ไปหน้านับสต็อกที่กรองเฉพาะรายการต่ำกว่าขั้นต่ำ
  function lowParts(ctx) {
    const stockOf = stockMap(ctx);
    const onOrder = partOnOrder(ctx) ?? new Map();
    return partRegister(ctx, stockOf).filter((item) => item.active !== false && partSafety(stockOf, item.code) > 0 && partQty(stockOf, item.code) + (onOrder.get(item.code) || 0) < partSafety(stockOf, item.code))
      .map((item) => ({ code: item.code, name: item.name ?? "", qty: partQty(stockOf, item.code), safety: partSafety(stockOf, item.code), unit: ctx.rules.uomLabel(item.uom) }));
  }
  function lowChems(ctx, rf) {
    if (rf.status !== "ready") return [];
    const { onHand, onOrder } = chemPosition(ctx, rf);
    return (rf.data.materials ?? []).filter((material) => material.active !== false && num(material.safetyKg) > 0 && (onHand.get(material.code) ?? 0) + (onOrder.get(material.code) ?? 0) < num(material.safetyKg))
      .map((material) => ({ code: material.code, name: material.name ?? "", qty: onHand.get(material.code) ?? 0, onOrder: onOrder.get(material.code) ?? 0, safety: num(material.safetyKg) }));
  }
  function lowCards(ctx, rf) {
    const { rules } = ctx;
    const cards = [];
    const chems = lowChems(ctx, rf);
    if (chems.length) {
      // หน้าต่างสั่งซื้อของ RubberFlow (args.rows): ต้องใช้ 0 · คงเหลือ = ST + RB ที่ใช้ได้ · ขาด = จำนวนสั่งตั้งต้น = เติมถึงขั้นต่ำ
      const rows = chems.map((row) => { const short = Math.round((row.safety - row.qty - row.onOrder) * 1000) / 1000; return { materialCode: row.code, name: row.name, needKg: 0, onHandKg: row.qty, reservedKg: 0, onOrderKg: row.onOrder, availableKg: row.qty + row.onOrder, shortageKg: short, safetyKg: row.safety, orderKg: short }; });
      const buy = rfCan(ctx, rf, "purchase") ? rfScope(ctx.ui.openButton("สั่งซื้อเคมีที่ต่ำกว่าขั้นต่ำ", "purchase", { rows, note: "เติมถึงสต็อกขั้นต่ำ" }, { className: "bom-job-main" })) : readOnlyNote;
      cards.push(card({ tone: "is-hold", state: "ต่ำกว่าสต็อกขั้นต่ำ", title: `เคมีต่ำกว่าสต็อกขั้นต่ำ ${chems.length} รายการ`, sub: "รวมคลัง ST และคลัง RB",
        lines: cardLines(chems, (row) => `<li><span>${esc(row.name || row.code)}</span><span class="nowrap">${esc(`${rules.fmtQty(row.qty)} / ${rules.fmtQty(row.safety)} kg`)}</span></li>`), actions: buy }));
    }
    const parts = lowParts(ctx);
    if (parts.length) {
      cards.push(card({ tone: "is-hold", state: "ต่ำกว่าสต็อกขั้นต่ำ", title: `ของซื้อต่ำกว่าสต็อกขั้นต่ำ ${parts.length} รายการ`, href: stUrl({ tab: "count", low: 1 }),
        lines: cardLines(parts, (row) => `<li><span>${esc(row.name || row.code)}</span><span class="nowrap">${esc(`${rules.fmtQty(row.qty)} / ${rules.fmtQty(row.safety)} ${row.unit}`)}</span></li>`),
        actions: ctx.ui.link("ดูของซื้อที่ต่ำกว่าขั้นต่ำ", stUrl({ tab: "count", low: 1 }), "btn rf-btn secondary bom-job-main") }));
    }
    return cards;
  }

  // งานของ BOM ของแผนก ST (การ์ดชุดเดียวกับ BOM · hub.boardCards): เบิกของซื้อต่อใบ · คืนของซื้อของใบที่ยกเลิก · ของซื้อ / เคมีของใบสั่งผลิตที่ขาด
  // การ์ดรับเข้าตามใบสั่งซื้อและรับเคมีคืนของ BOM ไม่ใช้ (หน้านี้วาดของตัวเองจาก RubberFlow ข้างบน ไม่ซ้ำ)
  const BOM_TASKS = Object.freeze(["partReturn", "buy", "chem"]);
  function bomCards(ctx) {
    const board = hub()?.workBoard?.(F.deptCtx(ctx), new URLSearchParams());
    if (!board) return { tasks: [], jobs: [] };
    const { taskCards, cards } = hub().boardCards(ctx, { ...board, tasks: board.tasks.filter(({ kind }) => BOM_TASKS.includes(kind)) });
    return { tasks: taskCards, jobs: cards };
  }
  function workCards(ctx, rf) {
    const bom = bomCards(ctx);
    return [...chemCards(ctx, rf), ...bom.tasks, ...holdCards(ctx, rf), ...lowCards(ctx, rf), ...bom.jobs];
  }
  function workCount(ctx) {
    try { return workCards(ctx, rfState(ctx)).length; } catch { return 0; }
  }
  function workView(ctx, rf) {
    const { ui } = ctx;
    const cards = workCards(ctx, rf);
    const note = rfNote(ctx, rf);
    return `${note}${cards.length ? `<div class="bom-job-grid">${cards.join("")}</div>` : note ? "" : ui.card(ui.empty("ไม่มีงานค้าง"))}`;
  }

  // ---------- วัตถุดิบที่กัก: หน้าชุดเดียวกับ #/qa?tab=material (MNP_FACTORY.heldMaterialView) ----------
  function holdView(ctx, rf) {
    const { ui } = ctx;
    if (rf.status !== "ready" || !rfRules()) return rfNote(ctx, rf) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"));
    return F.heldMaterialView(ctx, rf.data, { release: rfCan(ctx, rf, "releaseMaterial"), holdable: rfCan(ctx, rf, "holdMaterial") });
  }

  // ---------- ใบสั่งซื้อ ----------
  function poView(ctx, rf) {
    const { ui } = ctx;
    if (rf.status !== "ready" || !views().purchaseOrderTable) return rfNote(ctx, rf, "ใบสั่งซื้อ") || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"));
    const table = views().purchaseOrderTable(rf.ctx, { q: ctx.q });
    return `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหาเลขใบสั่งซื้อ ใบสั่งผลิต หรือรหัส")}${ctx.q ? ui.link("ล้างตัวกรอง", stUrl(ctx.view.params), "btn rf-btn secondary small") : ""}</div>${ui.card(rfScope(table), { flush: true })}`;
  }
  // ปุ่มของหน้าใบสั่งซื้อ: รับเข้านอกใบสั่งซื้อ (สร้างล็อตเคมีใหม่) · สั่งซื้อเคมีที่ใบสั่งผลิตที่เปิดอยู่ต้องใช้
  function poActions(ctx, rf) {
    if (rf.status !== "ready" || ctx.guest) return "";
    const receive = rfCan(ctx, rf, "receiveMaterial") ? ctx.ui.openButton("รับเข้าคลังวัตถุดิบ (ST)", "receiveMaterial", {}, { className: "", ariaLabel: "รับเคมีนอกใบสั่งซื้อเข้าคลังวัตถุดิบ (ST)" }) : "";
    return rfScope(`${views().purchaseButton?.(rf.ctx) ?? ""}${receive}`);
  }

  // ---------- จ่ายออก: เคมีตามใบขอเบิกของ RB · ของซื้อตามใบสั่งผลิต ----------
  // ปลายทางของเคมีที่ ST จ่าย: คลังเคมีของแผนก RB (ไม่ใช่ใบเบิกต่อใบสั่งผลิต)
  const RB_STORE_TARGET = "ให้แผนก RB · คลังเคมี RB";
  function chemRequestTable(ctx, rf) {
    const { ui } = ctx;
    const R = rfRules();
    const list = R.chemRequestsToIssue(rf.data);
    const mayIssue = rfCan(ctx, rf, "issueChem");
    const rows = list.map((doc) => `<tr><td><strong class="rf-mono">${esc(doc.id)}</strong><div class="small">${esc(RB_STORE_TARGET)}</div>${views().chemDocMeta?.(rf.ctx, doc) ?? ""}</td><td>${views().chemDocLines?.(rf.ctx, doc) ?? ""}</td><td>${views().chemStatus?.(ui, doc) ?? ""}</td><td class="right">${mayIssue ? rfScope(`<div class="rf-row rf-end">${issueButton(ctx, doc, "small")}${closeButton(ctx, doc)}</div>`) : ""}</td></tr>`);
    return ui.card(ui.table(["ใบขอเบิก", "รายการ", "สถานะ", { label: "", className: "right" }], rows, { emptyText: "ไม่มีใบขอเบิกเคมีที่รอจ่าย" }), { title: esc("เคมีตามใบขอเบิกของ RB"), flush: true });
  }
  function partOrders(ctx) {
    const { data, rules, helpers } = ctx;
    const only = ctx.params.get("order");
    return data.orders.map((order) => {
      const open = ["released", "in_progress"].includes(order.status);
      const plan = open ? helpers.partIssuePlan(data, order.id) : { lines: [] };
      const back = order.status === "draft" ? [] : rules.partReturnLines(data, order.id);
      return { order, open, plan, back, returnable: back.some((line) => !line.partial && line.returnable > 0) };
    }).filter((row) => (only ? row.order.id === only : row.plan.lines.length || (row.open && row.back.length) || (row.order.status === "cancelled" && row.returnable)))
      .sort((a, b) => num(a.order.dueAt) - num(b.order.dueAt) || String(a.order.id).localeCompare(String(b.order.id)));
  }
  // ของซื้อของใบ จัดตามแผนกที่รับ (หัวข้อต่อแผนก · bom-hub partLinesByDept) · ไม่มี hub = รายการเรียบ
  const partLines = (ctx, order, lines, render) => hub()?.partLinesByDept?.(ctx, order, lines, render) ?? cardLines(lines, render);
  function partOrderTable(ctx) {
    const { ui, rules, user } = ctx;
    const may = ctx.helpers.canIssueParts(user) && !ctx.guest;
    const only = ctx.params.get("order");
    const rows = partOrders(ctx).map(({ order, open, plan, back, returnable }) => {
      const lines = plan.lines.length
        ? partLines(ctx, order, plan.lines, (line) => `<li><span>${esc(line.name || line.itemCode)}</span><span class="nowrap">${esc(`${rules.fmtQty(line.remaining)} ${rules.uomLabel(line.uom)}`)}${line.short > 0 ? ` ${ui.badge("bad", `ขาด ${rules.fmtQty(line.short)}`)}` : ""}</span></li>`)
        : `<span class="small muted">${esc(order.status === "cancelled" ? "ใบถูกยกเลิก คืนของที่เบิกไปแล้ว" : back.length ? "เบิกจ่ายครบแล้ว" : "ไม่มีของซื้อที่ต้องเบิก")}</span>`;
      const buttons = may ? [
        open && plan.lines.length && ctx.helpers.salesCancelPending?.(order) ? `<span class="small muted" title="${esc(ctx.helpers.SALES_PENDING_TEXT)}">${esc(ctx.helpers.SALES_PENDING_SHORT)}</span>` : open && plan.lines.length ? ui.openButton("เบิกจ่าย", "issueParts", { orderId: order.id }, { className: "small", ariaLabel: `เบิกจ่ายของซื้อของใบ ${order.id}` }) : "",
        returnable ? ui.openButton("คืนของเหลือ", "returnParts", { orderId: order.id }, { className: "secondary small", ariaLabel: `คืนของเหลือของใบ ${order.id}` }) : "",
        open && back.length ? ui.openButton("ยกเลิกการเบิกจ่าย", "undoParts", { orderId: order.id }, { className: "secondary small", ariaLabel: `ยกเลิกการเบิกจ่ายของใบ ${order.id}` }) : "",
      ].filter(Boolean).join("") : "";
      return `<tr><td>${ui.link(order.id, ctx.url("orders", { sel: order.id }), "rf-mono")}<div class="small muted">${esc([order.customer, order.status === "cancelled" ? "ยกเลิกแล้ว" : ""].filter(Boolean).join(" · "))}</div></td><td>${lines}</td><td class="right"><div class="rf-row rf-end">${buttons}</div></td></tr>`;
    });
    const scope = only ? `<p class="bom-back">เฉพาะใบ ${esc(only)} · ${ui.link("ดูทุกใบ", stUrl({ tab: "issue" }))}</p>` : "";
    return `${scope}${ui.card(ui.table(["ใบสั่งผลิต", "ของซื้อที่ต้องเบิก (ตามแผนกที่รับ)", { label: "", className: "right" }], rows, { emptyText: only ? "ใบนี้ไม่มีของซื้อให้เบิกจ่ายหรือคืน" : "ไม่มีใบที่รอเบิกของซื้อ" }), { title: esc("ของซื้อตามใบสั่งผลิต"), flush: true })}`;
  }
  function issueView(ctx, rf) {
    const chem = ctx.params.get("order") ? "" : rf.status === "ready" ? chemRequestTable(ctx, rf) : rfNote(ctx, rf);
    return `${chem}${partOrderTable(ctx)}`;
  }

  // ---------- รับคืน: ใบคืนเคมีจาก RB · ใบเบิกเดิมของคลัง ST ของ WO ที่ยกเลิก ----------
  const RECENT_DOCS = 20;
  function returnsView(ctx, rf) {
    const { ui, rules } = ctx;
    if (rf.status !== "ready") return rfNote(ctx, rf) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"));
    const R = rfRules();
    const mayIssue = rfCan(ctx, rf, "issueChem");
    const docs = R.chemDocsOf(rf.data).filter((doc) => doc.kind === "return");
    const pending = R.chemReturnsPending(rf.data);
    const done = docs.filter((doc) => doc.status !== "pending").sort((a, b) => num(b.doneAt ?? b.createdAt) - num(a.doneAt ?? a.createdAt)).slice(0, RECENT_DOCS);
    const docRow = (doc) => `<tr><td><strong class="rf-mono">${esc(doc.id)}</strong>${views().chemDocMeta?.(rf.ctx, doc) ?? ""}</td><td>${views().chemDocLines?.(rf.ctx, doc) ?? ""}</td><td>${views().chemStatus?.(ui, doc) ?? ""}${doc.doneBy ? `<div class="small muted">${esc(`${doc.doneBy} · ${rules.fmtDateTime(doc.doneAt)}`)}</div>` : ""}</td><td class="right">${doc.status === "pending" && mayIssue ? rfScope(`<div class="rf-row rf-end">${receiveReturnButton(ctx, doc, "small")}${rejectButton(ctx, doc)}</div>`) : ""}</td></tr>`;
    const head = ["ใบคืน", "รายการ", "สถานะ", { label: "", className: "right" }];
    const reqs = R.returnableRequisitions(rf.data, "ST");
    const mayReturn = rfCan(ctx, rf, "returnRequisition");
    const reqRows = reqs.map((req) => `<tr><td class="rf-mono">${esc(req.id)}</td><td>${esc(`WO ${req.orderId}`)}</td><td class="right rf-mono">${esc(kg(ctx, (req.lines ?? []).reduce((sum, line) => sum + num(line.actualKg), 0)))}</td><td class="right">${mayReturn ? rfScope(requisitionReturnButton(ctx, req, "small")) : ""}</td></tr>`);
    return `${ui.card(ui.table(head, pending.map(docRow), { emptyText: "ไม่มีใบคืนเคมีที่รอรับ" }), { title: esc("ใบคืนเคมีจาก RB"), flush: true })}
      ${reqs.length ? ui.card(ui.table(["ใบเบิก", "ใบสั่งผลิต", { label: "จ่ายไป", className: "right" }, { label: "", className: "right" }], reqRows), { title: esc("ใบเบิกของ WO ที่ถูกยกเลิก (คลัง ST)"), flush: true }) : ""}
      ${done.length ? ui.card(ui.table(head, done.map(docRow)), { title: esc("ใบคืนที่จัดการแล้วล่าสุด"), flush: true }) : ""}`;
  }

  // ---------- นับสต็อก: ทะเบียนของซื้อ (รวมยอด 0) นับยอดและตั้งสต็อกขั้นต่ำในฟอร์มเดียว ----------
  function countView(ctx) {
    const { ui, rules, user, q } = ctx;
    const stockOf = stockMap(ctx);
    const low = ctx.params.get("low") === "1";
    const canCount = ctx.helpers.canCount(user);
    const canSafety = !ctx.guest && ctx.helpers.canSetSafety(user);
    const onOrder = partOnOrder(ctx);
    const list = partRegister(ctx, stockOf).filter((item) => (!low || partLow(stockOf, item.code)) && F.includesText(`${item.code} ${item.name}`, q))
      .sort((a, b) => a.code.localeCompare(b.code));
    const { shown, more } = F.limited(ctx, list);
    const fmt = (value) => esc(rules.fmtQty(value));
    const rows = shown.map((item) => {
      const row = stockOf.get(item.code);
      const unit = esc(rules.uomLabel(item.uom));
      // ยอดนับจริงเริ่มว่าง (ยอดในระบบเป็น placeholder): แถวที่ไม่ได้พิมพ์ไม่ถูกบันทึก (countPartStock ข้ามแถวที่ยอดเท่าเดิม) · หน่วยบอกครั้งเดียวที่ยอดคงเหลือในระบบ
      const counted = canCount ? qtyInput("qty[]", `ยอดนับจริง ${item.code}`, "", rules.fmtQty(row?.qty ?? 0)) : dash;
      const safety = canSafety ? qtyInput("safetyQty[]", `สต็อกขั้นต่ำ ${item.code}`, row?.safetyQty ?? 0) : fmt(row?.safetyQty ?? 0);
      return `<tr><td>${ui.link(item.code, partHref(item.code), "rf-mono")}<input type="hidden" name="itemCode[]" value="${attr(item.code)}"><div class="small muted">${esc(item.name ?? "")}${row?.countedAt ? ` · นับล่าสุด ${esc(rules.fmtDate(row.countedAt))}` : ""}</div></td><td class="right rf-mono">${fmt(row?.qty ?? 0)} <span class="small muted">${unit}</span></td><td class="right">${counted}</td><td class="right">${safety}</td><td class="right rf-mono">${onOrder ? fmt(onOrder.get(item.code) || 0) : dash}</td></tr>`;
    });
    const table = ui.table(["ของซื้อ", { label: "ยอดคงเหลือในระบบ", className: "right" }, { label: "ยอดนับจริง", className: "right", title: "เว้นว่าง = ไม่เปลี่ยนยอด" }, { label: "สต็อกขั้นต่ำ", className: "right" }, { label: "รอรับเข้า", className: "right", title: "สั่งซื้อแล้วและยังไม่ได้รับเข้า" }], rows, { emptyText: q || low ? "ไม่พบของซื้อที่ค้นหา" : "ยังไม่มีของซื้อในทะเบียนชิ้นงาน" });
    const body = (canCount || canSafety) && shown.length
      ? `<form novalidate data-rf-form="countPartStock" data-rf-success="บันทึกยอด {result}" class="bom-count-form">${table}<div class="bom-count-save"><button class="btn rf-btn" type="submit">บันทึกยอดที่นับ</button></div></form>`
      : table;
    const filtered = Boolean(q || low);
    const lowLink = low ? "" : ui.link("เฉพาะที่ต่ำกว่าขั้นต่ำ", ctx.pageUrl({ low: 1, n: null }), "btn rf-btn secondary small");
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัสหรือชื่อของซื้อ (ทั้งทะเบียน)")}${lowLink}${filtered ? ui.link("ล้างตัวกรอง", stUrl(ctx.view.params), "btn rf-btn secondary small") : ""}</div>`;
    return `${toolbar}${ui.card(`${body}${more}`, { flush: true })}`;
  }

  // ---------- dialog ของ ST สำหรับเอกสารคลังเคมี (ลงทะเบียนใน dialog ของ RubberFlow: เปิดและส่งด้วยตัวผูกของ RubberFlow · ctx = ctx ของ RubberFlow) ----------
  // จ่ายเคมีตามใบขอเบิก: ช่องจ่ายครั้งนี้ต่อบรรทัด (ตั้งต้น = ยอดคงค้าง · 0 = ไม่จ่ายบรรทัดนี้) · ล็อตที่ระบบจะจ่าย (FEFO จากคลัง ST · rules.chemIssuePreview) แสดงก่อนยืนยันและเปลี่ยนตามจำนวน
  rfDialogs.chemIssue = (ctx, { id }) => {
    const { data, now, ui, rules } = ctx;
    const doc = rules.chemDocsOf(data).find((row) => row.id === id);
    if (!doc || !rules.chemRequestOpen(doc)) return null;
    const remote = ctx.store.isRemote();
    const picksHtml = (row) => `${row.picks.map((pick) => `<div class="rf-mono small">${esc(`${pick.lotNo} → ${rules.fmtNum(pick.kg, 3)} kg · หมดอายุ ${rules.fmtDate(pick.expiry)}`)}</div>`).join("")}${row.shortageKg > 0.0001 ? ui.badge("bad", `คลัง ST ขาด ${rules.fmtNum(row.shortageKg, 3)} kg`) : ""}`;
    const preview = rules.chemIssuePreview(data, doc, undefined, now, { remote });
    const rows = doc.lines.map((line, index) => {
      const open = rules.chemLineOpenKg(line);
      const control = open > 0
        ? ui.input("issueKg[]", { type: "number", step: "any", min: 0, value: String(+open.toFixed(4)), extra: `max="${esc(String(+open.toFixed(4)))}" data-st-issue="${index}" aria-label="${esc(`จ่ายครั้งนี้ ${line.materialCode} (kg)`)}"` })
        : `<input type="hidden" name="issueKg[]" value="0"><span class="muted">จ่ายครบแล้ว</span>`;
      return `<tr><td>${ui.mono(line.materialCode)}<div class="small muted">${esc(data.materials.find((row) => row.code === line.materialCode)?.name ?? "")}</div></td><td class="right rf-mono">${esc(rules.fmtNum(line.qtyKg, 3))}</td><td class="right rf-mono">${esc(rules.fmtNum(num(line.issuedKg), 3))}</td><td>${control}</td><td data-st-picks="${index}">${open > 0 ? picksHtml(preview[index]) : ""}</td></tr>`;
    });
    const body = `${ui.callout("info", "ระบบจ่ายตามล็อตที่แสดง (หมดอายุก่อนจ่ายก่อน ข้ามล็อตกักกันหรือหมดอายุ) ยอดย้ายจากคลัง ST เข้าคลังเคมี RB ทันที · จ่ายไม่ครบ ส่วนที่เหลือค้างไว้ จ่ายต่อหรือปิดยอดที่เหลือภายหลัง")}
      ${doc.note ? `<p class="small muted">${esc(`หมายเหตุของ RB: ${doc.note}`)}</p>` : ""}
      ${ui.table(["วัตถุดิบ", { label: "ขอ (kg)", className: "right" }, { label: "จ่ายแล้ว (kg)", className: "right" }, "จ่ายครั้งนี้ (kg)", "ล็อตที่ระบบจะจ่าย (FEFO)"], rows)}
      <div data-st-short hidden>${ui.callout("warn", "คลัง ST มีพร้อมจ่ายไม่พอ ลดจำนวนจ่ายครั้งนี้ หรือปิดยอดที่เหลือ")}</div>`;
    const html = ui.dialog("chemIssue", `จ่ายเคมีให้ RB · ${doc.id}`, `<form novalidate data-rf-form="issueChemicals" data-rf-args='${esc(JSON.stringify({ id: doc.id }))}' data-rf-success="จ่ายเคมีตามใบ {result} แล้ว" id="st-chem-issue">${body}</form>`, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="st-chem-issue" data-st-issue-submit>จ่ายจากคลังวัตถุดิบ (ST)</button>` });
    const bind = (dialog) => {
      const inputs = [...dialog.querySelectorAll("[data-st-issue]")];
      const submit = dialog.querySelector("[data-st-issue-submit]");
      const shortBox = dialog.querySelector("[data-st-short]");
      const paint = () => {
        const kgs = doc.lines.map((_, index) => { const input = inputs.find((node) => node.dataset.stIssue === String(index)); return input ? input.value || "0" : "0"; });
        const result = rules.chemIssuePreview(data, doc, kgs, now, { remote });
        let short = false;
        result.forEach((row, index) => {
          const cell = dialog.querySelector(`[data-st-picks="${index}"]`);
          if (cell && rules.chemLineOpenKg(doc.lines[index]) > 0) cell.innerHTML = picksHtml(row);
          if (row.kg > 0 && row.shortageKg > 0.0001) short = true;
        });
        const any = result.some((row) => row.kg > 0);
        if (shortBox) shortBox.hidden = !short;
        if (submit) submit.disabled = short || !any;
      };
      inputs.forEach((input) => input.addEventListener("input", paint));
      paint();
    };
    return { html, bind };
  };
  // ปิดยอดที่เหลือของใบขอเบิก (ไม่ย้ายเคมี) · ต้องมีเหตุผล
  rfDialogs.chemClose = (ctx, { id }) => {
    const { data, ui, rules } = ctx;
    const doc = rules.chemDocsOf(data).find((row) => row.id === id);
    if (!doc || !rules.chemRequestOpen(doc)) return null;
    const rows = doc.lines.filter((line) => rules.chemLineOpenKg(line) > 0).map((line) => `<tr><td>${ui.mono(line.materialCode)}</td><td class="right rf-mono">${esc(rules.fmtNum(line.qtyKg, 3))}</td><td class="right rf-mono">${esc(rules.fmtNum(num(line.issuedKg), 3))}</td><td class="right rf-mono">${esc(rules.fmtNum(rules.chemLineOpenKg(line), 3))}</td></tr>`);
    const body = `${ui.callout("warn", "ส่วนที่ยังไม่ได้จ่ายจะไม่ค้างจ่ายอีก ใบนี้ปิดและแก้กลับไม่ได้ ถ้า RB ยังต้องใช้ให้ขอเบิกใบใหม่")}
      ${ui.table(["วัตถุดิบ", { label: "ขอ (kg)", className: "right" }, { label: "จ่ายแล้ว (kg)", className: "right" }, { label: "ปิดยอด (kg)", className: "right" }], rows)}
      ${ui.field("เหตุผล", ui.input("reason", { required: true, placeholder: "เช่น คลังไม่มีของ RB ตกลงใช้เท่าที่จ่าย", extra: `minlength="${rules.CHEM_REASON_MIN}" maxlength="${rules.CHEM_REASON_MAX}"` }), { required: true })}`;
    return { html: ui.dialog("chemClose", `ปิดยอดที่เหลือ · ${doc.id}`, `<form novalidate data-rf-form="closeChemicalRequest" data-rf-args='${esc(JSON.stringify({ id: doc.id }))}' data-rf-success="ปิดยอดที่เหลือของ {result} แล้ว" id="st-chem-close">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="st-chem-close">ปิดยอดที่เหลือ</button>` }) };
  };
  // ไม่รับคืน (ยอดกลับเข้าคลัง RB ของล็อตเดิม) · ต้องมีเหตุผล
  rfDialogs.chemReject = (ctx, { id }) => {
    const { data, ui, rules } = ctx;
    const doc = rules.chemDocsOf(data).find((row) => row.id === id);
    if (!doc || doc.kind !== "return" || doc.status !== "pending") return null;
    const rows = (doc.lines ?? []).map((line) => `<tr><td>${ui.mono(line.lotNo)}<div class="small muted">${esc(line.materialCode)}</div></td><td class="right rf-mono">${esc(rules.fmtNum(line.kg, 3))}</td></tr>`);
    const body = `${ui.callout("warn", "ยอดทุกล็อตของใบนี้กลับเข้าคลังเคมี RB ตามเดิม RB ส่งใบคืนใหม่ด้วยยอดที่ถูกต้องได้")}
      ${ui.table(["ล็อต", { label: "คืน (kg)", className: "right" }], rows)}
      ${ui.field("เหตุผล", ui.input("reason", { required: true, placeholder: "เช่น ชั่งได้ไม่ตรงกับยอดที่ส่ง", extra: `minlength="${rules.CHEM_REASON_MIN}" maxlength="${rules.CHEM_REASON_MAX}"` }), { required: true })}`;
    return { html: ui.dialog("chemReject", `ไม่รับคืน · ${doc.id}`, `<form novalidate data-rf-form="rejectChemicalReturn" data-rf-args='${esc(JSON.stringify({ id: doc.id }))}' data-rf-success="ไม่รับคืนตามใบ {result} แล้ว ยอดกลับเข้าคลัง RB" id="st-chem-reject">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="st-chem-reject">ไม่รับคืน</button>` }) };
  };

  // ---------- หน้าแรกของโมดูล ----------
  // ตัวกรองชนิด (select) เปลี่ยนแล้วไปหน้าเดิมพร้อมตัวกรองใหม่ · ส่วนของ RubberFlow ผูกด้วยตัวผูกของ RubberFlow (ctx ของ RubberFlow: dialog คำสั่ง และการซ่อนปุ่มตามสิทธิ์ชุดเดียวกับหน้า RubberFlow)
  function bindPage(node, pageCtx) {
    node.querySelectorAll("[data-st-filter]").forEach((select) => select.addEventListener("change", () => { location.hash = pageCtx.pageUrl({ [select.name]: select.value || null, n: null }); }));
    const slots = [...node.querySelectorAll("[data-rf-scope]")];
    if (!slots.length || typeof root.MNP_RUBBERFLOW_BIND !== "function") return;
    let rfCtx = null;
    try { rfCtx = pageCtx.rubberflow?.()?.context?.(new URLSearchParams()) ?? null; } catch { rfCtx = null; }
    if (rfCtx) slots.forEach((slot) => root.MNP_RUBBERFLOW_BIND(slot, rfCtx));
  }
  function landing(ctx) {
    const { ui } = ctx;
    const rf = rfState(ctx);
    const part = ctx.params.get("part");
    const lotNo = ctx.params.get("lot");
    const done = (html, actions = !ctx.guest || ctx.guest === "wh") => ({ html, bind: bindPage, actions });
    if (lotNo && (!ctx.guest || GUEST_KIND[ctx.guest] === "chem")) return done(lotView(ctx, rf, lotNo));
    if (part && (!ctx.guest || GUEST_KIND[ctx.guest] === "part")) return done(partView(ctx, part));
    const allowed = ctx.guest ? GUEST_VIEWS[ctx.guest] : null;
    const id = allowed && !allowed.includes(ctx.view?.id) ? "stock" : ctx.view?.id;
    // ผู้เข้าชมไม่มีเมนูข้าง: แท็บในหน้า (WH: ในคลัง · นับสต็อก) · หัวข้อ = หน้าที่เปิด
    const view = allowed && id !== ctx.view?.id ? (ctx.factory.menu.find((item) => item.id === id) ?? ctx.view) : ctx.view;
    const head = (extra = "") => F.viewHead({ ...ctx, view }, extra);
    const guestTabs = allowed && allowed.length > 1 ? ui.tabs(allowed.map((key) => ({ id: key, label: ctx.factory.menu.find((item) => item.id === key)?.label ?? key })), id, (key) => stUrl({ tab: key })) : "";
    if (id === "stock") {
      // งานที่รอ: ตัวเลขอยู่ที่เมนูข้างแล้ว ลิงก์นี้แสดงเฉพาะจอที่ไม่เห็นเมนูข้าง (styles.css .wh-work-link) · ผู้เข้าชมไม่มีงานที่นี่
      const pending = ctx.guest ? 0 : workCount(ctx);
      const work = pending ? ui.link(`งานของฉัน ${pending}`, stUrl({}), "btn rf-btn secondary small wh-work-link") : "";
      return done(`${head(work)}${guestTabs}${stockView({ ...ctx, view }, rf)}`);
    }
    if (id === "count") return done(`${head()}${guestTabs}${countView({ ...ctx, view })}`);
    if (id === "hold") return done(`${head()}${holdView(ctx, rf)}`);
    if (id === "po") return done(`${head(poActions(ctx, rf))}${poView(ctx, rf)}`);
    if (id === "issue") return done(`${head()}${issueView(ctx, rf)}`);
    if (id === "returns") return done(`${head()}${returnsView(ctx, rf)}`);
    return done(`${head()}${workView(ctx, rf)}`);
  }

  const MENU = Object.freeze([
    F.workItem(workCount),
    { id: "stock", label: "ในคลัง", icon: "warehouse", params: { tab: "stock" }, owns: ["part", "lot"] },
    { id: "hold", label: "วัตถุดิบที่กัก", icon: "flask", params: { tab: "hold" } },
    { id: "po", label: "ใบสั่งซื้อ", icon: "clipboard", params: { tab: "po" } },
    { id: "issue", label: "จ่ายออก", icon: "box", params: { tab: "issue" } },
    { id: "returns", label: "รับคืน", icon: "cycle", params: { tab: "returns" } },
    { id: "count", label: "นับสต็อก", icon: "scale", params: { tab: "count" } },
  ]);

  root.MNP_ST_PAGES = Object.freeze({ landing, MENU, KEEP: Object.freeze(["kind", "low", "order"]), access, guest, stockRows, workCount, workCards, holdCards, lowParts, lowChems });
})(window);
