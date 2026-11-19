// โมดูลแผนก SR — คลังยางเส้นยาว (ลำดับ 05 ของผังงาน) #/sr · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน): งานของฉัน · ในคลัง (?tab=stock) · รับเข้า (?tab=receive) · จ่ายให้ GR (?tab=issue) · ประวัติเข้าออก (?tab=history) · หน้าล็อต ?lot=<id> (อยู่ใต้ "ในคลัง") · ป้ายล็อต ?lot=<id>&print=1
// หน้ารายละเอียดการจ่าย ?issue=<ใบ>&code=<รหัสเส้นยาง> (อยู่ใต้ "จ่ายให้ GR") · การ์ดงานและแถวตารางคลิกได้ทั้งใบ/แถวไปหน้ารายละเอียดของรายการนั้น (stretched link: ลิงก์หลักเป็น <a> จริง)
// ข้อมูลมาจาก store ของ BOM (rodLots / rodMoves · 20261202010000 และ 20261204010000): การ์ดงานและ dialog (รับเข้า จ่ายให้ GR ย้อนการจ่าย ปรับยอด ย้ายตำแหน่ง รับนอกใบสั่ง) เป็นชุดเดียวกับที่ BOM ใช้ (modules/bom-hub.js)
// ปุ่มที่ซ่อนเป็นแค่ UX สิทธิ์จริงตัดสินที่ action และฐานข้อมูล (SR หรือฝ่ายวางแผนทำได้ · QA ตัดสินล็อตที่กัก)
// ตารางยางเส้นยาวในคลังใช้ซ้ำในโมดูล GR แบบอ่านอย่างเดียว (window.MNP_SR.stockView) · ป้ายใช้ QR ของ vendor/qrcode-generator (MIT)
(function registerSrModule() {
  const F = window.MNP_FACTORY;
  const ROUTE = "sr";
  const RECENT_ROWS = 20;
  const OWNER_FILTERS = Object.freeze([{ value: "free", label: "สต็อกกลาง" }, { value: "order", label: "ของใบสั่ง" }]);
  const NO_LOCATION = "-";

  const rod = () => window.MNP_BOM_PAGES.hub.rod;
  const attrsOf = (ctx, code) => ctx.rules.rodAttrs(ctx.data.items, code, ctx.data.colors ?? []);
  const lotOf = (ctx, id) => (ctx.data.rodLots ?? []).find((entry) => entry.id === id) ?? null;
  const lotHref = (lot, extra = {}) => F.routeUrl(ROUTE, { lot: lot.id, ...extra });
  const canStore = (ctx) => Boolean(ctx.helpers.canStoreRods?.(ctx.user));
  const canAdjust = (ctx) => Boolean(ctx.helpers.canAdjustRods?.(ctx.user));
  const when = (ctx, at) => (at ? ctx.rules.fmtDate(at) : "—");
  const num = (value) => Number(value) || 0;
  const byNewest = (a, b) => num(b.at) - num(a.at) || String(b.id ?? "").localeCompare(String(a.id ?? ""));

  // เส้นยาง: รหัส + ชื่อ + สูตร/สี/ขนาด (rodAttrs ชุดเดียวกับหน้าล็อตและป้าย)
  // href = รหัสเป็นลิงก์หลักของแถวคลิกได้ (rowAttr / row-link-main)
  function itemCell(ctx, code, href = null) {
    const attrs = attrsOf(ctx, code);
    return `${href ? ctx.ui.link(code, href, "rf-mono row-link-main") : ctx.ui.mono(code)}${attrs.name ? `<div class="small muted">${F.esc(attrs.name)}</div>` : ""}${attrs.text ? `<div class="small muted">${F.esc(attrs.text)}</div>` : ""}`;
  }
  // แถวตารางคลิกได้ทั้งแถว (stretched link): ลิงก์หลักของแถวเป็น <a> จริง (class row-link-main) ที่โฟกัสด้วยคีย์บอร์ดได้ ขยายพื้นที่คลิกคลุมแถวด้วย CSS (tr.row-link ใน styles.css)
  // ลิงก์และปุ่มอื่นในแถว (ใบสั่งผลิต ปุ่มรับเข้า) ยังกดได้ตามปกติ · ไม่มี href = แถวธรรมดา
  const rowAttr = (href) => (href ? ' class="row-link"' : "");
  const mainLink = (ctx, text, href, cls = "rf-mono") => ctx.ui.link(text, href, [cls, "row-link-main"].filter(Boolean).join(" "));
  const issueHref = (orderId, code) => F.routeUrl(ROUTE, { issue: orderId, code });
  const emptyHint = (text) => `<span class="muted">${F.esc(text)}</span>`;
  const locationText = (lot) => (lot.location ? F.esc(lot.location) : emptyHint("—"));
  // ถังของยาง: สต็อกกลาง · ของใบ X (ลิงก์ไปใบ)
  function ownerCell(ctx, bucket) {
    if (!bucket.owner) return "สต็อกกลาง";
    return bucket.free ? F.esc(`สต็อกกลาง (ใบ ${bucket.owner})`) : ctx.ui.link(`ใบ ${bucket.owner}`, ctx.url("orders", { sel: bucket.owner }), "rf-mono");
  }
  // เจ้าของของล็อตตามที่มา: ใบที่ยังผลิตอยู่ = ของใบนั้น · รับนอกใบสั่ง หรือใบปิดแล้ว = สต็อกกลาง (ข้อความเดียวกับถังในหน้าอื่น)
  const lotOwnerText = (ctx, lot) => rod().bucketText(ctx, lot.orderId);

  // ---------- ในคลัง: ถังของล็อตที่อยู่ในคลังและยังมียอด (ไม่แสดงทั้งทะเบียน) ----------
  function stockBuckets(ctx) {
    const { rules, data } = ctx;
    return rules.rodBuckets(data).filter((bucket) => bucket.lot.status === "stored")
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || num(a.lot.receivedAt) - num(b.lot.receivedAt) || String(a.lot.lotNo).localeCompare(String(b.lot.lotNo)) || (a.owner === null ? 0 : 1) - (b.owner === null ? 0 : 1));
  }
  const filterSelect = (ctx, name, label, options, value, placeholder) => `<div class="field rf-field sr-filter"><label class="sr-only" for="sr-${name}">${F.esc(label)}</label>${ctx.ui.select(name, options, { value, placeholder, id: `sr-${name}`, extra: `data-sr-filter title="${F.attr(label)}"` })}</div>`;

  // readOnly = ตารางเดียวกันแบบอ่านอย่างเดียว (ไม่มีลิงก์ไปหน้าล็อต ไม่มีปุ่มรับนอกใบสั่ง): โมดูล GR ใช้
  function stockView(ctx, { readOnly = false } = {}) {
    const { ui, rules, q } = ctx;
    const owner = ctx.params.get("own") ?? "";
    const loc = ctx.params.get("loc") ?? "";
    const all = stockBuckets(ctx);
    const locations = [...new Set(all.map((bucket) => bucket.lot.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
    const matches = (bucket) => {
      const { lot } = bucket;
      const attrs = attrsOf(ctx, bucket.itemCode);
      if (owner === "free" && !bucket.free) return false;
      if (owner === "order" && bucket.free) return false;
      if (loc && (loc === NO_LOCATION ? Boolean(lot.location) : lot.location !== loc)) return false;
      return F.includesText(`${bucket.itemCode} ${attrs.name} ${lot.lotNo} ${lot.location ?? ""} ${attrs.compound} ${attrs.color} ${attrs.colorName}`, q);
    };
    const list = all.filter(matches);
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map((bucket) => {
      const { lot } = bucket;
      const lotText = readOnly ? ui.mono(lot.lotNo) : mainLink(ctx, lot.lotNo, lotHref(lot));
      return `<tr${readOnly ? "" : rowAttr(true)}><td>${itemCell(ctx, bucket.itemCode)}</td><td class="right rf-mono">${F.esc(`${rules.fmtQty(bucket.qty)} ${rules.uomLabel(lot.uom)}`)}</td><td>${lotText}<div class="small muted">${F.esc(when(ctx, lot.receivedAt))}</div></td><td>${locationText(lot)}</td><td>${ownerCell(ctx, bucket)}</td></tr>`;
    });
    const filtered = Boolean(q || owner || loc);
    const locationOptions = [...locations.map((value) => ({ value, label: value })), ...(all.some((bucket) => !bucket.lot.location) ? [{ value: NO_LOCATION, label: "ยังไม่ระบุตำแหน่ง" }] : [])];
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัส ชื่อ ล็อต ตำแหน่ง สูตร หรือสี")}${filterSelect(ctx, "own", "ของใคร", OWNER_FILTERS, owner, "ทุกที่")}${filterSelect(ctx, "loc", "ตำแหน่งจัดเก็บ", locationOptions, loc, "ทุกตำแหน่ง")}${filtered ? ui.link("ล้างตัวกรอง", F.routeUrl(ctx.factory.route, ctx.view.params), "btn rf-btn secondary small") : ""}</div>`;
    const table = ui.card(`${ui.table(["เส้นยาง", { label: "จำนวน", className: "right" }, "ล็อต", "ตำแหน่ง", "ของ"], rows, { emptyText: filtered ? "ไม่พบเส้นยางที่ค้นหา" : "ยังไม่มียางเส้นยาวในคลัง" })}${more}`, { flush: true });
    return { html: `${toolbar}${table}` };
  }

  // ---------- รับเข้า ----------
  const openingButton = (ctx) => (canStore(ctx) ? ctx.ui.openButton("รับยางนอกใบสั่ง", "rodOpening", {}, { className: "secondary", ariaLabel: "รับยางเส้นยาวนอกใบสั่งเข้าคลัง" }) : "");
  function receiveView(ctx) {
    const { ui, rules, data } = ctx;
    const lots = data.rodLots ?? [];
    const store = canStore(ctx);
    const pending = lots.filter((lot) => lot.status === "pending").sort((a, b) => num(a.createdAt) - num(b.createdAt));
    const held = lots.filter((lot) => lot.status === "held").sort((a, b) => num(a.receivedAt) - num(b.receivedAt));
    const pendingRows = pending.map((lot) => `<tr${rowAttr(true)}><td>${mainLink(ctx, lot.lotNo, lotHref(lot))}<div class="small muted">${F.esc(when(ctx, lot.createdAt))}</div></td><td>${itemCell(ctx, lot.itemCode)}</td><td class="right rf-mono">${F.esc(rod().rodQty(ctx, lot.qtySent, lot.uom))}</td><td>${lot.orderId ? ui.link(`ใบ ${lot.orderId}`, ctx.url("orders", { sel: lot.orderId }), "rf-mono") : ""}</td><td class="right">${store ? ui.openButton("รับเข้าคลัง", "rodReceive", { lotId: lot.id }, { className: "small", ariaLabel: `รับเข้าคลัง ล็อต ${lot.lotNo}` }) : ""}</td></tr>`);
    const heldRows = held.map((lot) => `<tr${rowAttr(true)}><td>${mainLink(ctx, lot.lotNo, lotHref(lot))}<div class="small muted">${F.esc(when(ctx, lot.receivedAt))}</div></td><td>${itemCell(ctx, lot.itemCode)}</td><td class="right rf-mono">${F.esc(rod().rodQty(ctx, lot.qtyReceived, lot.uom))}</td><td>${locationText(lot)}</td><td class="small">${F.esc(lot.qc?.note ?? "")}</td></tr>`);
    const receipts = (data.rodMoves ?? []).filter((move) => move.kind === "receive").sort(byNewest);
    const receiptRows = receipts.slice(0, RECENT_ROWS).map((move) => {
      const lot = lotOf(ctx, move.lotId);
      return `<tr${rowAttr(lot)}><td class="nowrap small">${F.esc(rules.fmtDateTime(move.at))}</td><td>${itemCell(ctx, move.itemCode)}</td><td>${lot ? mainLink(ctx, lot.lotNo, lotHref(lot)) : ""}<div class="small muted">${F.esc(lot ? `${lot.orderId ? `ใบ ${lot.orderId}` : rules.ROD_SOURCE_LABEL.opening}${lot.location ? ` · ${lot.location}` : ""}` : "")}</div></td><td class="right rf-mono">${F.esc(`+${rules.fmtQty(move.qty)}`)}</td><td class="small">${F.esc(move.by ?? "")}</td></tr>`;
    });
    const more = receipts.length > RECENT_ROWS ? `<div class="rf-row">${ui.link("ดูทั้งหมดที่ประวัติเข้าออก", F.routeUrl(ROUTE, { tab: "history", kind: "receive" }), "btn rf-btn secondary small")}</div>` : "";
    return `${ui.card(ui.table(["ล็อต", "เส้นยาง", { label: "ส่งมา", className: "right" }, "ใบสั่งผลิต", ""], pendingRows, { emptyText: "ไม่มีล็อตที่รอรับเข้าคลัง" }), { title: F.esc("รอรับเข้าคลัง (ส่งมาจาก RB)"), flush: true })}`
      + `${ui.card(ui.table(["ล็อต", "เส้นยาง", { label: "รับไว้", className: "right" }, "ตำแหน่ง", "ผลตรวจ"], heldRows, { emptyText: "ไม่มีล็อตที่กักรอ QA ตัดสิน" }), { title: F.esc("กักรอ QA ตัดสิน"), flush: true })}`
      + `${ui.card(`${ui.table(["เวลา", "เส้นยาง", "ล็อต", { label: "จำนวน", className: "right" }, "ผู้รับ"], receiptRows, { emptyText: "ยังไม่มีการรับเข้า" })}${more}`, { title: F.esc("รับเข้าล่าสุด"), flush: true })}`;
  }

  // ---------- จ่ายให้ GR ----------
  // แถวประวัติของยาง (หน้าจ่าย หน้าล็อต หน้าประวัติเข้าออก หน้ารายละเอียดการจ่าย): showLot = มีคอลัมน์ล็อต/เส้นยาง · showItem = false ไม่ซ้ำรหัสเส้นยาง (หน้าที่บอกรหัสอยู่แล้ว)
  // hideFor = ไม่ซ้ำใบที่จ่ายให้ (หน้าของใบนั้น) · rowHref = แถวคลิกได้ทั้งแถวไปหน้านั้น (ข้อความชนิดรายการเป็นลิงก์หลัก)
  function moveRow(ctx, move, { showLot = true, showItem = true, hideFor = false, rowHref = null, reversed, hideNote = false }) {
    const { ui, rules } = ctx;
    const lot = lotOf(ctx, move.lotId);
    const kinds = rod().ROD_KIND_LABEL;
    const isIssue = move.kind === "issue" || move.kind === "unissue";
    const where = isIssue && !hideFor ? `ใบ ${move.forOrderId} · ${rod().bucketText(ctx, move.ownerOrderId)}` : rod().bucketText(ctx, move.ownerOrderId);
    const undone = reversed.has(move.id);
    const undo = move.kind === "issue" && !undone && canStore(ctx) ? ui.openButton("ย้อน", "rodReverse", { moveId: move.id }, { className: "secondary small", ariaLabel: `ย้อนการจ่าย ${rules.fmtQty(-num(move.qty))} ของใบ ${move.forOrderId}` }) : "";
    const lotCell = showLot ? `<td>${showItem ? itemCell(ctx, move.itemCode) : ""}${lot ? `<div>${ui.link(`ล็อต ${lot.lotNo}`, lotHref(lot), "rf-mono small")}</div>` : ""}</td>` : "";
    const kindText = kinds[move.kind] ?? move.kind;
    const rowClasses = [undone ? "muted" : "", rowHref ? "row-link" : ""].filter(Boolean).join(" ");
    return `<tr${rowClasses ? ` class="${rowClasses}"` : ""}><td class="nowrap small">${F.esc(rules.fmtDateTime(move.at))}</td>${lotCell}<td>${rowHref ? mainLink(ctx, kindText, rowHref, "") : F.esc(kindText)}${undone ? ` ${ui.badge("", "ถูกย้อน")}` : ""}<div class="small muted">${F.esc(where)}</div>${move.note && !hideNote ? `<div class="small muted">${F.esc(move.note)}</div>` : ""}</td><td class="right rf-mono">${F.esc(`${num(move.qty) > 0 ? "+" : ""}${rules.fmtQty(move.qty)}`)}</td><td class="small">${F.esc(move.by ?? "")}</td><td class="right">${undo}</td></tr>`;
  }
  const moveHead = (showLot, lotHeading = "เส้นยาง") => ["เวลา", ...(showLot ? [lotHeading] : []), "รายการ", { label: "เปลี่ยน", className: "right" }, "ผู้ทำ", ""];

  function issueView(ctx) {
    const { ui, rules, data } = ctx;
    const store = canStore(ctx);
    const needs = rules.rodIssueNeeds(data).filter((need) => need.remaining > 1e-9).sort((a, b) => String(a.order.id).localeCompare(String(b.order.id)) || a.itemCode.localeCompare(b.itemCode));
    const needRows = needs.map((need) => {
      const stock = Math.round((need.owned + need.free) * 1e4) / 1e4;
      const action = !store ? "" : stock > 0 ? ui.openButton("จ่ายยางเส้นยาว", "rodIssue", { orderId: need.order.id, itemCode: need.itemCode }, { className: "small", ariaLabel: `จ่ายยางเส้นยาว ${need.itemCode} ให้ใบ ${need.order.id}` }) : emptyHint("ไม่มีในคลัง");
      return `<tr${rowAttr(true)}><td>${ui.link(need.order.id, ctx.url("orders", { sel: need.order.id }), "rf-mono")}<div class="small muted">${F.esc(need.order.customer ?? "")}</div></td><td>${itemCell(ctx, need.itemCode, issueHref(need.order.id, need.itemCode))}</td><td class="right rf-mono">${F.esc(rod().rodQty(ctx, need.remaining, need.uom))}</td><td class="right rf-mono" title="${F.attr(`ของใบนี้ ${rules.fmtQty(need.owned)} · สต็อกกลาง ${rules.fmtQty(need.free)}`)}">${F.esc(rules.fmtQty(stock))}</td><td class="right">${action}</td></tr>`;
    });
    const reversed = rules.rodReversedIds(data.rodMoves);
    const issues = (data.rodMoves ?? []).filter((move) => move.kind === "issue").sort(byNewest);
    const issueRows = issues.slice(0, RECENT_ROWS).map((move) => moveRow(ctx, move, { reversed, rowHref: issueHref(move.forOrderId, move.itemCode) }));
    const more = issues.length > RECENT_ROWS ? `<div class="rf-row">${ui.link("ดูทั้งหมดที่ประวัติเข้าออก", F.routeUrl(ROUTE, { tab: "history", kind: "issue" }), "btn rf-btn secondary small")}</div>` : "";
    return `${ui.card(ui.table(["ใบสั่งผลิต", "เส้นยาง", { label: "ต้องจ่าย", className: "right", title: "ที่งาน GR ของใบนี้ยังต้องใช้ หักที่จ่ายแล้ว" }, { label: "ในคลัง", className: "right", title: "ของใบนี้และสต็อกกลางที่จ่ายได้" }, ""], needRows, { emptyText: "ไม่มีใบที่รอยางเส้นยาว" }), { title: F.esc("ใบที่รอให้จ่ายให้ GR"), flush: true })}`
      + `${ui.card(`${ui.table(moveHead(true), issueRows, { emptyText: "ยังไม่เคยจ่ายให้ GR" })}${more}`, { title: F.esc("จ่ายล่าสุด"), flush: true })}`;
  }

  // ---------- หน้ารายละเอียดการจ่าย: ใบ × เส้นยาง (?issue=<ใบ>&code=<รหัสเส้นยาง>) ----------
  // การ์ดงาน "จ่ายยางเส้นยาวให้ GR" และแถวในหน้า จ่ายให้ GR เปิดหน้านี้ · ใบ ลูกค้า กำหนด ยอดที่ GR ต้องใช้ จ่ายแล้ว ที่ยังต้องจ่าย
  // ล็อตที่ต้องหยิบตามแผน FIFO (ล็อตเก่าก่อน พร้อมตำแหน่ง · ชิ้นส่วนเดียวกับ dialog จ่าย) ประวัติการจ่ายของใบนี้ (ย้อนได้) และปุ่มเปิด dialog จ่าย
  function issueDetail(ctx, orderId, code) {
    const { ui, rules, data } = ctx;
    const back = backLink(F.routeUrl(ROUTE, { tab: "issue" }), "‹ จ่ายให้ GR");
    const order = data.orders.find((entry) => entry.id === orderId);
    if (!order || !code) return { html: `${back}${F.pageHead(ctx, "จ่ายยางเส้นยาวให้ GR")}${ui.card(ui.empty("ไม่พบใบสั่งผลิตหรือเส้นยางนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)"))}` };
    const need = rules.rodIssueNeeds(data, order.id).find((row) => row.itemCode === code) ?? null;
    const uom = need?.uom ?? data.items.find((item) => item.code === rules.rodAttrs(data.items, code).code)?.uom ?? "";
    const unit = rules.uomLabel(uom);
    const qty = (value) => F.esc(`${rules.fmtQty(value)} ${unit}`);
    const stock = need ? Math.round((need.owned + need.free) * 1e4) / 1e4 : 0;
    const due = need ? Math.min(...need.grJobs.map((job) => Number(job.dueAt) || Infinity)) : Infinity;
    const open = Boolean(need && need.remaining > 1e-9);
    const facts = ui.kv([
      ["ใบสั่งผลิต", ui.link(order.id, ctx.url("orders", { sel: order.id }), "rf-mono")],
      ...(order.customer ? [["ลูกค้า", F.esc(order.customer)]] : []),
      ...(Number.isFinite(due) ? [["กำหนด", F.dueText(ctx, due, false)]] : []),
      ["เส้นยาง", itemCell(ctx, code)],
      ...(need ? [["GR ต้องใช้", qty(need.need)], ["จ่ายแล้ว", qty(need.issued)], ["ยังต้องจ่าย", `<strong>${qty(need.remaining)}</strong>`]] : []),
    ]);
    // ไม่มีงานจ่ายค้าง: บอกเหตุผลสั้นๆ ประวัติการจ่ายยังดูได้
    const plan = open ? rod().pickPlanHtml(ctx, rules.rodFifo(data, code, need.remaining, { own: order.id }), uom) : "";
    const pick = ui.card(open ? plan : need ? ui.callout("good", F.esc("จ่ายครบตามที่ GR ต้องใช้แล้ว")) : ui.callout("info", F.esc("ใบนี้ไม่มีงานจ่ายยางเส้นยาวค้างอยู่ (ยังไม่ปล่อยผลิต ปิดใบแล้ว หรืองาน GR เสร็จแล้ว)")), { title: F.esc("ที่ต้องหยิบ"), className: "sr-pick-card" });
    const reversed = rules.rodReversedIds(data.rodMoves);
    const issues = (data.rodMoves ?? []).filter((move) => move.kind === "issue" && move.forOrderId === order.id && move.itemCode === code).sort(byNewest);
    const history = ui.card(ui.table(moveHead(true, "ล็อต"), issues.map((move) => moveRow(ctx, move, { showItem: false, hideFor: true, reversed })), { emptyText: "ยังไม่เคยจ่ายให้ใบนี้" }), { title: F.esc("จ่ายไปแล้ว"), flush: true });
    const button = open && canStore(ctx) && stock > 0 ? ui.openButton("จ่ายยางเส้นยาว", "rodIssue", { orderId: order.id, itemCode: code }, { className: "", ariaLabel: `จ่ายยางเส้นยาว ${code} ให้ใบ ${order.id}` }) : "";
    return { html: `${back}${F.pageHead(ctx, "จ่ายยางเส้นยาวให้ GR", `${button}<span class="small muted" role="status" data-bom-sync>${F.esc(window.MNP_BOM?.syncText?.() ?? "")}</span>`)}<div class="sr-lot">${ui.card(facts, { className: "sr-lot-facts" })}${pick}</div>${history}` };
  }

  // ---------- ประวัติเข้าออก ----------
  function historyView(ctx) {
    const { ui, rules, data, q } = ctx;
    const kind = ctx.params.get("kind") ?? "";
    const reversed = rules.rodReversedIds(data.rodMoves);
    const lots = new Map((data.rodLots ?? []).map((lot) => [lot.id, lot]));
    const list = (data.rodMoves ?? []).filter((move) => (!kind || move.kind === kind)
      && F.includesText(`${move.itemCode} ${lots.get(move.lotId)?.lotNo ?? ""} ${move.forOrderId ?? ""} ${move.ownerOrderId ?? ""} ${move.note ?? ""} ${move.by ?? ""}`, q)).sort(byNewest);
    const { shown, more } = F.limited(ctx, list);
    const kinds = Object.entries(rod().ROD_KIND_LABEL).map(([value, label]) => ({ value, label }));
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัส ล็อต หรือใบสั่งผลิต")}${filterSelect(ctx, "kind", "ชนิดรายการ", kinds, kind, "ทุกรายการ")}${kind || q ? ui.link("ล้างตัวกรอง", F.routeUrl(ROUTE, { tab: "history" }), "btn rf-btn secondary small") : ""}</div>`;
    const rows = shown.map((move) => moveRow(ctx, move, { reversed }));
    return `${toolbar}${ui.card(`${ui.table(moveHead(true), rows, { emptyText: kind || q ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีประวัติเข้าออก" })}${more}`, { flush: true })}`;
  }

  // ---------- หน้าล็อต ----------
  const backLink = (href, text) => `<a class="request-back-link" href="${F.attr(href)}">${F.esc(text)}</a>`;
  function lotMissing(ctx, kind) {
    return { html: `${backLink(F.routeUrl(ROUTE, { tab: "stock" }), "‹ ในคลัง")}${F.pageHead(ctx, kind === "print" ? "พิมพ์ป้ายล็อต" : "ล็อตยางเส้นยาว")}${ctx.ui.card(ctx.ui.empty("ไม่พบล็อตนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)"))}` };
  }
  // ป้ายพิมพ์ได้เฉพาะล็อตที่อยู่กับคลัง (รอ QA ตัดสิน หรืออยู่ในคลัง)
  const labelPrintable = (lot) => ["held", "stored"].includes(lot.status);
  function lotView(ctx, lot) {
    const { ui, rules, data } = ctx;
    const attrs = attrsOf(ctx, lot.itemCode);
    const unit = rules.uomLabel(lot.uom);
    const buckets = rules.rodBuckets(data).filter((bucket) => bucket.lotId === lot.id).map((bucket) => `${rod().bucketText(ctx, bucket.owner)} ${rules.fmtQty(bucket.qty)} ${unit}`);
    const colour = [attrs.color, attrs.colorName].filter(Boolean).join(" · ");
    const moves = (data.rodMoves ?? []).filter((move) => move.lotId === lot.id).sort(byNewest);
    // รับเข้า (จำนวน ผู้รับ เวลา) อยู่ในประวัติของล็อตแล้วเมื่อมีแถวรับเข้า · ล็อตที่ยังไม่มีแถวรับเข้า (รอ QA ตัดสิน) แสดงในรายการข้อมูลแทน
    const received = moves.some((move) => move.kind === "receive");
    const facts = ui.kv([
      ["เส้นยาง", `${ui.mono(lot.itemCode)}${attrs.name ? `<div class="small muted">${F.esc(attrs.name)}</div>` : ""}`],
      ...(attrs.compound ? [["สูตรยาง", F.esc(attrs.compound)]] : []),
      ...(colour ? [["สี", F.esc(colour)]] : []),
      ...(attrs.size ? [["ขนาด", F.esc(attrs.size)]] : []),
      ["สถานะ", rod().rodStatusBadge(ctx, lot)],
      ["ที่มา", lot.orderId ? `${ui.link(`ใบ ${lot.orderId}`, ctx.url("orders", { sel: lot.orderId }), "rf-mono")} <span class="small muted">${F.esc(`ส่งมาจาก RB · งาน ${lot.jobNo} · WO ${lot.woNo}`)}</span>` : F.esc(`${rules.ROD_SOURCE_LABEL.opening}${lot.sourceNote ? ` · ${lot.sourceNote}` : ""}`)],
      ["ตำแหน่ง", locationText(lot)],
      ...(lot.orderId ? [["ส่งมา", F.esc(`${rules.fmtQty(lot.qtySent)} ${unit} · ${rules.fmtDateTime(lot.createdAt)}`)]] : []),
      ...(!received && lot.qtyReceived !== null && lot.qtyReceived !== undefined ? [["รับเข้า", F.esc(`${rules.fmtQty(lot.qtyReceived)} ${unit} · ${lot.receivedBy ?? ""} ${rules.fmtDateTime(lot.receivedAt)}`)]] : []),
      ...(lot.decision ? [["ผลตัดสิน QA", F.esc(`${rules.ROD_DECISION_LABEL[lot.decision] ?? lot.decision} · ${lot.decidedBy ?? ""} ${rules.fmtDateTime(lot.decidedAt)} · ${lot.decisionNote ?? ""}`)]] : []),
      ...(buckets.length ? [["คงเหลือ", F.esc(buckets.join(" · "))]] : []),
    ]);
    const qc = lot.qc ? ui.card(`${rod().qcRowsHtml(ctx, lot)}${lot.qc.note ? `<p class="small muted">${F.esc(`หมายเหตุของ SR: ${lot.qc.note}`)}</p>` : ""}`, { title: F.esc("ผลตรวจขนาดตอนรับเข้า") }) : "";
    const reversed = rules.rodReversedIds(data.rodMoves);
    const history = ui.card(ui.table(moveHead(false), moves.map((move) => moveRow(ctx, move, { showLot: false, reversed, hideNote: !lot.orderId && move.kind === "receive" })), { emptyText: "ยังไม่มียางเส้นยาวเข้าคลังจากล็อตนี้" }), { title: F.esc("ประวัติเข้าออกของล็อต"), flush: true });
    const buttons = [
      // ล็อตที่ SR ยังไม่ได้รับ: ปุ่มรับเข้าคลัง (dialog เดียวกับการ์ดงานและตารางรับเข้า)
      lot.status === "pending" && canStore(ctx) ? ui.openButton("รับเข้าคลัง", "rodReceive", { lotId: lot.id }, { className: "", ariaLabel: `รับเข้าคลัง ล็อต ${lot.lotNo}` }) : "",
      labelPrintable(lot) ? ui.link("พิมพ์ป้าย", lotHref(lot, { print: 1 }), "btn rf-btn secondary") : "",
      ["held", "stored"].includes(lot.status) && canStore(ctx) ? ui.openButton("ย้ายตำแหน่ง", "rodLocation", { lotId: lot.id }, { className: "secondary" }) : "",
      lot.status === "stored" && canAdjust(ctx) ? ui.openButton("ปรับยอดสต็อกกลาง", "rodAdjust", { lotId: lot.id }, { className: "secondary" }) : "",
    ].join("");
    // ล็อตที่ยังรอรับเข้ากลับไปที่รายการรับเข้า (ที่การ์ดงานและตารางรับเข้าเปิดมา) ล็อตอื่นกลับไปในคลัง
    const back = lot.status === "pending" ? backLink(F.routeUrl(ROUTE, { tab: "receive" }), "‹ รับเข้า") : backLink(F.routeUrl(ROUTE, { tab: "stock" }), "‹ ในคลัง");
    return { html: `${back}${F.pageHead(ctx, `ล็อต ${lot.lotNo}`, `${buttons}<span class="small muted" role="status" data-bom-sync>${F.esc(window.MNP_BOM?.syncText?.() ?? "")}</span>`)}<div class="sr-lot">${ui.card(facts, { className: "sr-lot-facts" })}${qc}</div>${history}` };
  }

  // ---------- ป้ายล็อต (พิมพ์): ป้ายเดียวต่อล็อต + QR ที่เปิดล็อตนี้ในระบบ ----------
  // ที่อยู่เต็มของหน้าล็อต (QR เปิดได้จากโทรศัพท์): origin + path ของหน้านี้ + #/sr?lot=<id>
  function lotAbsoluteUrl(lot) {
    const where = window.location ?? {};
    return `${where.origin ?? ""}${where.pathname ?? ""}${F.routeUrl(ROUTE, { lot: lot.id })}`;
  }
  function qrSvg(text) {
    try {
      const make = window.qrcode;
      if (typeof make !== "function") return "";
      const qr = make(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, title: "QR เปิดล็อตนี้ในระบบ" });
    } catch { return ""; }
  }
  function labelView(ctx, lot) {
    const { ui, rules } = ctx;
    if (!labelPrintable(lot)) return { html: `${backLink(lotHref(lot), `‹ ล็อต ${lot.lotNo}`)}${F.pageHead(ctx, `ป้ายล็อต ${lot.lotNo}`)}${ui.card(ui.empty("พิมพ์ป้ายได้เฉพาะล็อตที่รอ QA ตัดสินหรืออยู่ในคลัง"))}` };
    const attrs = attrsOf(ctx, lot.itemCode);
    const url = lotAbsoluteUrl(lot);
    const qr = qrSvg(url);
    const line = (label, value) => (value ? `<div class="sr-label-line"><dt>${F.esc(label)}</dt><dd>${F.esc(value)}</dd></div>` : "");
    // ของในคลังตอนนี้ (ถังที่ยังมียอด) · ล็อตที่ยังรอ QA ไม่มีถัง ใช้จำนวนที่รับ
    const unit = rules.uomLabel(lot.uom);
    const buckets = rules.rodBuckets(ctx.data).filter((bucket) => bucket.lotId === lot.id && bucket.qty > 0);
    const owner = buckets.length > 1 ? buckets.map((bucket) => `${rod().bucketText(ctx, bucket.owner)} ${rules.fmtQty(bucket.qty)} ${unit}`).join(" · ") : buckets.length ? rod().bucketText(ctx, buckets[0].owner) : lotOwnerText(ctx, lot);
    const qtyLine = buckets.length ? line("คงเหลือ", `${rules.fmtQty(buckets.reduce((sum, bucket) => sum + bucket.qty, 0))} ${unit}`) : line("จำนวนรับ", `${rules.fmtQty(lot.qtyReceived ?? lot.qtySent)} ${unit}`);
    const colour = [attrs.color, attrs.colorName].filter(Boolean).join(" ");
    const label = `<article class="sr-label" aria-label="${F.attr(`ป้ายล็อต ${lot.lotNo}`)}">
      <div class="sr-label-top"><strong class="sr-label-code rf-mono">${F.esc(lot.itemCode)}</strong>${attrs.name ? `<span class="sr-label-name">${F.esc(attrs.name)}</span>` : ""}</div>
      <div class="sr-label-body"><dl class="sr-label-facts">${line("สูตรยาง", attrs.compound)}${line("สี", colour)}${line("ขนาด", attrs.size)}${line("ล็อต", lot.lotNo)}${qtyLine}${line("วันที่รับ", lot.receivedAt ? rules.fmtDate(lot.receivedAt) : "")}${line("ตำแหน่ง", lot.location)}${line("ของ", owner)}</dl>
      <div class="sr-label-qr">${qr || `<span class="small">${F.esc(url)}</span>`}</div></div></article>`;
    const actions = `<div class="rf-row no-print"><button class="btn rf-btn" type="button" data-sr-print>พิมพ์ป้าย</button>${ui.link("ดูล็อต", lotHref(lot), "btn rf-btn secondary")}</div>`;
    return { html: `${backLink(lotHref(lot), `‹ ล็อต ${lot.lotNo}`)}${F.pageHead(ctx, `ป้ายล็อต ${lot.lotNo}`)}<div class="sr-label-wrap">${actions}${label}</div>` };
  }

  // ---------- หน้าแรกของโมดูล ----------
  // ตัวกรอง (select) เปลี่ยนแล้วไปที่หน้าเดิมพร้อมตัวกรองใหม่ · ปุ่มพิมพ์ป้าย
  function bindPage(node, pageCtx) {
    node.querySelectorAll("[data-sr-filter]").forEach((select) => select.addEventListener("change", () => { location.hash = pageCtx.pageUrl({ [select.name]: select.value || null, n: null }); }));
    node.querySelectorAll("[data-sr-print]").forEach((button) => button.addEventListener("click", () => { window.print?.(); }));
  }
  function landing(ctx) {
    const { ui } = ctx;
    const lotId = ctx.params.get("lot");
    if (lotId) {
      const lot = lotOf(ctx, lotId);
      const printing = ctx.params.get("print") === "1";
      const built = !lot ? lotMissing(ctx, printing ? "print" : "lot") : printing ? labelView(ctx, lot) : lotView(ctx, lot);
      return { ...built, bind: bindPage, actions: true };
    }
    // หน้ารายละเอียดการจ่ายของใบ × เส้นยาง (การ์ดงานและแถวในจ่ายให้ GR เปิดหน้านี้)
    const issueOrder = ctx.params.get("issue");
    if (issueOrder) return { ...issueDetail(ctx, issueOrder, ctx.params.get("code") ?? ""), bind: bindPage, actions: true };
    const id = ctx.view?.id;
    const head = (extra = "") => F.viewHead(ctx, extra);
    if (id === "stock") { const stock = stockView(ctx); return { html: `${head(openingButton(ctx))}${stock.html}`, bind: bindPage, actions: true }; }
    if (id === "receive") return { html: `${head(openingButton(ctx))}${receiveView(ctx)}`, bind: bindPage, actions: true };
    if (id === "issue") return { html: `${head()}${issueView(ctx)}`, bind: bindPage, actions: true };
    if (id === "history") return { html: `${head()}${historyView(ctx)}`, bind: bindPage, actions: true };
    // งานของฉัน (ค่าตั้งต้น): การ์ดงานชุดเดียวกับที่ BOM เคยแสดง
    const job = F.deptWork(ctx, { title: null });
    return { html: `${head()}${job.html || ui.card(ui.empty("ไม่มีงานค้าง"))}`, bind: bindPage, actions: true };
  }

  const MENU = Object.freeze([
    F.workItem(F.deptWorkCount),
    { id: "stock", label: "ในคลัง", icon: "warehouse", params: { tab: "stock" }, owns: ["lot"] },
    { id: "receive", label: "รับเข้า", icon: "download", params: { tab: "receive" } },
    { id: "issue", label: "จ่ายให้ GR", icon: "box", params: { tab: "issue" }, owns: ["issue"] },
    { id: "history", label: "ประวัติเข้าออก", icon: "history", params: { tab: "history" } },
  ]);

  window.MNP_SR = Object.freeze({ stockView, bindPage });
  F.registerDeptModule({ code: "FACTORY_SR", dept: "SR", route: ROUTE, label: "คลังยางเส้นยาว (SR)", icon: "ruler", palette: "sr", menu: MENU, keep: ["own", "loc", "kind"], landing });
})();
