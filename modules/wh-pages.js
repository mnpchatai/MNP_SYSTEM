// หน้าของโมดูลคลังสินค้าสำเร็จรูป (WH) #/wh — โหลดก่อน modules/module-wh.js (ดู index.html) · ที่เดียวที่ WH รับเข้า ส่งมอบ ปิดใบ และย้อนรายการ (ไม่มีสำเนาที่สองในหน้า BOM / RubberFlow)
// ของในคลังมาจากสองทาง: สินค้าสำเร็จรูปจาก PK (store ของ BOM: fgMoves ตามใบสั่งผลิต) และกล่องสินค้าจาก RubberFlow (store ของ RubberFlow: fgBoxes ตามล็อต · 20261206010000)
// หน้า: งานของฉัน (ค่าตั้งต้น) · ในคลัง ?tab=stock · รับเข้า ?tab=receive · ส่งมอบ ?tab=deliver · ประวัติ ?tab=history · หน้าใบ ?order=<ใบสั่งผลิต> · หน้าล็อต ?lot=<ล็อตตกแต่งของ RubberFlow>
// คำสั่งของ PK วิ่งไป store ของ BOM (receiveFg deliverFg closeOrder closeOrderShort reverseFg) · คำสั่งของกล่องวิ่งไป store ของ RubberFlow (receiveBoxes shipBoxes reverseBoxReceipt reverseBoxShip: module-bom.js runAction ส่งต่อให้)
// การซ่อน/แสดงปุ่มเป็นแค่ UX สิทธิ์จริงตัดสินที่ action และฐานข้อมูล: รับเข้า/ส่งมอบ = แผนก WH หรือผู้ดูแลระบบ · ย้อน = ผู้จัดการแผนก WH หรือผู้ดูแลระบบ
(function registerWhPages(root) {
  const F = root.MNP_FACTORY;
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const ROUTE = "wh";
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const num = (value) => Number(value) || 0;
  const round = (value) => Math.round(Number(value) * 1e4) / 1e4;
  const whUrl = (query = {}) => F.routeUrl(ROUTE, query);
  const orderHref = (orderId) => whUrl({ order: orderId });
  const lotHref = (lotId) => whUrl({ lot: lotId });
  const itemOf = (ctx, code) => ctx.helpers.itemOf(ctx.data, code);
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);
  const deptName = (ctx, dept) => String(ctx.rules.DEPT_LABEL[dept] ?? dept).replace(/^\w+ · /, "");
  const backLink = (href, text) => `<a class="request-back-link" href="${attr(href)}">${esc(text)}</a>`;
  // แถวตารางคลิกได้ทั้งแถว (stretched link เหมือนหน้า SR): ลิงก์หลักเป็น <a> จริง ขยายพื้นที่คลิกคลุมแถวด้วย CSS (tr.row-link)
  const rowAttr = (href, extra = "") => { const names = [href ? "row-link" : "", extra].filter(Boolean).join(" "); return names ? ` class="${names}"` : ""; };
  const mainLink = (ctx, text, href, cls = "rf-mono") => ctx.ui.link(text, href, [cls, "row-link-main"].filter(Boolean).join(" "));
  const dash = '<span class="muted">—</span>';
  const FG_STATUS = Object.freeze(["released", "in_progress", "completed"]);
  const rfRules = () => root.MNP_RUBBERFLOW_RULES ?? null;
  const rfUnit = (uom) => rfRules()?.unitText?.(uom) ?? uom ?? "";

  // ---------- สิทธิ์ (UX เท่านั้น) ----------
  // กติกาเดียวกันทั้งสินค้าจาก PK และกล่องของ RubberFlow: รับเข้า / ส่งมอบ / ปิดใบ = แผนก WH หรือผู้ดูแลระบบ (canHandleFg = MNP_RUBBERFLOW_STORE.canReceiveBoxes) · ย้อน = ผู้จัดการแผนก WH หรือผู้ดูแลระบบ (canReverseFg = canReverseBoxes)
  // ใช้ตัวช่วยของ BOM กับผู้ใช้ BOM ของหน้านี้ (ผู้ใช้ในเครื่องที่ไม่มี roleCode ตัดสินจากบทบาท manager เหมือนการย้อนของ PK) · ฐานข้อมูลตัดสินสิทธิ์จริงของแต่ละคำสั่งอีกครั้ง
  const canFg = (ctx) => Boolean(ctx.helpers.canHandleFg?.(ctx.user));
  const canReverseFg = (ctx) => Boolean(ctx.helpers.canReverseFg?.(ctx.user));
  const canBox = canFg;
  const canReverseBox = canReverseFg;

  // ---------- ข้อมูลกล่องจาก RubberFlow ----------
  // กล่องของล็อตเดียวกันอยู่ด้วยกัน: ล็อตเดียวมีปลายทางเดียว (ส่งมอบให้ลูกค้าผ่าน WH) · แถวเก่าที่ไม่มีลูกค้า / วันที่รับ ใช้ค่าของใบสั่งผลิต (WO) และวันที่สร้างแทน
  const BOX_STATUS = Object.freeze({ pending_wh: ["warn", "รอ WH รับเข้า"], in_stock: ["good", "อยู่ในคลัง"], shipped: ["", "ส่งมอบแล้ว"], hold: ["bad", "กักรอ QC"] });
  function rbLots(data) {
    const orders = new Map((data.orders ?? []).map((row) => [row.id, row]));
    const lots = new Map((data.lots ?? []).map((row) => [row.id, row]));
    const byLot = new Map();
    for (const box of data.fgBoxes ?? []) {
      if (!byLot.has(box.lotId)) byLot.set(box.lotId, []);
      byLot.get(box.lotId).push(box);
    }
    const sum = (list) => round(list.reduce((total, box) => total + num(box.qty), 0));
    return [...byLot].map(([id, boxes]) => {
      const lot = lots.get(id) ?? null;
      const first = boxes[0];
      const wo = orders.get(lot?.orderId ?? first.orderId) ?? null;
      const by = (status) => boxes.filter((box) => box.status === status);
      const sorted = boxes.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const inStock = by("in_stock");
      return {
        id, lot, wo, boxes: sorted, pending: by("pending_wh"), inStock, shipped: by("shipped"), hold: by("hold"),
        code: first.productCode ?? wo?.productCode ?? "", uom: first.uom ?? wo?.uom ?? "",
        customer: first.customer || wo?.customer || "", po: first.customerPo || wo?.customerPo || "",
        pendingQty: sum(by("pending_wh")), stockQty: sum(inStock),
        createdAt: Math.max(...boxes.map((box) => num(box.createdAt))), receivedAt: Math.max(0, ...inStock.map((box) => num(box.receivedAt ?? box.createdAt))),
      };
    }).sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id)));
  }
  // สถานะการต่อ store ของ RubberFlow (ยังไม่โหลด: สั่งโหลดและวาดหน้าใหม่เมื่อเสร็จ)
  function rbState(ctx) {
    const store = ctx.rubberflow?.()?.store ?? null;
    if (!store) return { status: "none", lots: [], data: null };
    if (F.failed(store)) return { status: "failed", lots: [], data: null };
    if (F.wake(store)) return { status: "loading", lots: [], data: null };
    const data = store.data();
    return { status: "ready", lots: rbLots(data), data };
  }
  const rbNote = (ctx, rb) => (rb.status === "loading" ? '<p class="small muted" role="status">กำลังโหลดข้อมูลกล่องสินค้าจาก RubberFlow…</p>' : rb.status === "failed" ? F.rubberflowFailed(ctx, "กล่องสินค้าจาก RubberFlow") : "");
  const boxCount = (list) => `${list.length} กล่อง`;
  const lotQty = (ctx, group, qty) => `${ctx.rules.fmtQty(qty)} ${rfUnit(group.uom)}`;
  const whoseText = (group) => [group.po ? `ใบ ${group.po}` : "", group.customer].filter(Boolean).join(" · ");

  // ---------- เหตุการณ์ของกล่อง (ประวัติ): การเปลี่ยนสถานะของกล่องในครั้งเดียวกัน (ล็อต ชนิด เวลา ผู้ทำ เหตุผลเดียวกัน) รวมเป็นแถวเดียว ----------
  // ย้อนแล้ว = ทุกกล่องของแถวมีรายการย้อนตามหลัง · ย้อนได้ = ยังไม่ถูกย้อน และกล่องของแถวอยู่ในสถานะที่ย้อนได้ตอนนี้ (รับเข้า → อยู่ในคลัง · ส่งมอบ → ส่งมอบแล้ว)
  const BOX_KIND = Object.freeze({ receive: "รับเข้า WH", ship: "ส่งมอบให้ลูกค้า", unreceive: "ย้อนการรับเข้า WH", unship: "ย้อนการส่งมอบ" });
  function boxEvents(lots) {
    const map = new Map();
    for (const group of lots) {
      for (const box of group.boxes) {
        (box.moves ?? []).forEach((move, index) => {
          const key = [group.id, move.kind, move.at, move.by, move.note].join("\u0000");
          if (!map.has(key)) map.set(key, { key, kind: move.kind, at: num(move.at), by: move.by ?? "", note: move.note ?? "", group, boxes: [] });
          map.get(key).boxes.push({ box, index });
        });
      }
    }
    const inverse = { receive: "unreceive", ship: "unship" };
    const needStatus = { receive: "in_stock", ship: "shipped" };
    return [...map.values()].map((event) => {
      const undo = inverse[event.kind];
      const reversed = Boolean(undo) && event.boxes.every(({ box, index }) => (box.moves ?? []).slice(index + 1).some((move) => move.kind === undo));
      const reversible = Boolean(undo) && !reversed && event.boxes.every(({ box }) => box.status === needStatus[event.kind]);
      return { ...event, qty: round(event.boxes.reduce((total, { box }) => total + num(box.qty), 0)), reversed, reversible };
    });
  }

  // ---------- สินค้าสำเร็จรูปจาก PK: ข้อความและช่องกรอก (ย้ายมาจากขั้น 5 / 6 ของหน้าใบสั่งผลิตใน BOM) ----------
  const FG_MOVE_LABEL = Object.freeze({ receive: "รับเข้า WH", deliver: "ส่งมอบ", close: "ปิดใบ (รับไม่ครบ)", unreceive: "ย้อนรับเข้า", undeliver: "ย้อนส่งมอบ", transfer: "โอนสต็อก", untransfer: "คืนสต็อก" });
  // ข้อความคงที่ของแถว close เมื่อ WH ปิดใบที่รับครบ (เซิร์ฟเวอร์เขียน: private.bom_fg_move ของ 20261125010000)
  const FULL_CLOSE_NOTE = "รับครบ ปิดใบโดยคลังสินค้า";
  const isFullClose = (move, pos) => move.kind === "close" && (move.note === FULL_CLOSE_NOTE || Boolean(pos?.fullClose));
  // แถวโอนสต็อกระหว่างใบ: บอกจากมุมมองของใบที่ถาม พร้อมเลขใบอีกฝั่ง
  function fgMoveLabel(ctx, move, orderId, pos = null) {
    if (isFullClose(move, pos)) return esc("ปิดใบ (รับครบ)");
    if (move.kind !== "transfer" && move.kind !== "untransfer") return esc(FG_MOVE_LABEL[move.kind] ?? move.kind);
    const mine = move.orderId === orderId;
    const other = ctx.ui.link(mine ? move.fromOrderId : move.orderId, orderHref(mine ? move.fromOrderId : move.orderId), "rf-mono");
    if (move.kind === "transfer") return mine ? `ได้จากสต็อกของใบ ${other}` : `ให้ใบ ${other} ใช้จากสต็อก`;
    return mine ? `คืนสต็อกให้ใบ ${other}` : `ใบ ${other} คืนสต็อกกลับมา`;
  }
  const fgProductCell = (ctx, product) => `<td>${ctx.ui.link(product.fgCode, ctx.url("items", { sel: product.fgCode }), "rf-mono")}<div class="small muted">${esc(itemOf(ctx, product.fgCode)?.name ?? "")}</div></td>`;
  // max = ยอดสูงสุดที่กรอกได้ · value = ค่าตั้งต้น (ส่งมอบ: ส่วนที่ลูกค้าของใบนี้รออยู่ ส่วนเกินที่สั่งไม่ถูกเติมให้) · ไม่มีของให้กรอก = ไม่มีช่อง · extra = attribute เพิ่มของช่องจำนวน
  const fgQtyInput = (ctx, product, label, value, max = value, extra = "") => (max > 0
    ? `<label class="bom-count-input"><span class="sr-only">${esc(`${label} ${product.fgCode}`)}</span><input class="input rf-input" name="qty[]" type="number" inputmode="decimal" step="any" min="0" max="${attr(max)}" value="${value > 0 ? attr(value) : ""}" placeholder="0"${extra ? ` ${extra}` : ""}><span class="small muted">${esc(uomText(ctx, itemOf(ctx, product.fgCode)?.uom ?? "set"))}</span></label><input type="hidden" name="fgCode[]" value="${attr(product.fgCode)}">`
    : '<span class="muted">—</span>');
  const fgNum = (ctx, value) => `<td class="right rf-mono">${esc(ctx.rules.fmtQty(value))}</td>`;
  // ส่งมอบเกินจำนวนที่สั่ง: ส่งได้ แต่ฟอร์มขึ้นคำเตือนพร้อมช่องติ๊กยืนยัน ปุ่มส่งมอบกดได้เมื่อติ๊กแล้ว (action deliverFg ตรวจซ้ำด้วย overConfirm) · การยืนยันเป็นของจำนวนที่แสดงตอนติ๊ก: แก้จำนวนจนส่วนเกินเปลี่ยน = ต้องติ๊กใหม่
  function bindDeliverOver(ctx, form) {
    const box = form.querySelector("[data-bom-deliver-over]");
    const text = form.querySelector("[data-bom-deliver-over-text]");
    const confirm = form.querySelector("[data-bom-deliver-over-confirm]");
    const submit = form.querySelector('button[type="submit"]');
    const inputs = [...form.querySelectorAll("input[data-bom-ordered-left]")];
    if (!box || !confirm || !inputs.length) return;
    let confirmedFor = "";
    const sync = () => {
      const over = inputs.map((input) => ({ code: input.dataset.bomCode, unit: input.dataset.bomUnit, qty: (Number(input.value) || 0) - Number(input.dataset.bomOrderedLeft) })).filter((row) => row.qty > 1e-9);
      const summary = over.map((row) => `${over.length > 1 ? `${row.code} ` : ""}${ctx.rules.fmtQty(row.qty)} ${row.unit}`).join(", ");
      box.hidden = !over.length;
      if (!over.length || (confirm.checked && confirmedFor && confirmedFor !== summary)) confirm.checked = false;
      confirmedFor = confirm.checked ? summary : "";
      if (text) text.textContent = over.length ? `ส่งมอบเกินจำนวนที่สั่ง ${summary}` : "";
      if (submit) submit.disabled = over.length > 0 && !confirm.checked;
    };
    inputs.forEach((input) => input.addEventListener("input", sync));
    confirm.addEventListener("change", sync);
    sync();
  }

  // ---------- รับเข้า (PK) ----------
  // ฟอร์มส่งทันทีหลังกดยืนยัน (ไม่มีนับถอยหลัง) · แถวที่ไม่มีของให้รับไม่มีช่องกรอก · ค่าตั้งต้นของช่อง = ยอดที่รับได้ทั้งหมด · ปุ่มเฉพาะแผนก WH และผู้ดูแลระบบ (canHandleFg)
  function receivePanel(ctx, order, pos, { title = "รับเข้า WH" } = {}) {
    const { ui, rules } = ctx;
    const open = ["released", "in_progress"].includes(order.status);
    // ใบที่ปิดแล้วรับเข้าได้เฉพาะส่วนที่ PK ผลิตเกินจำนวนสั่ง: ส่วนนั้นเป็นสต็อกสินค้าสำเร็จรูปของสินค้านั้น
    const closedOrder = order.status === "completed";
    const fg = canFg(ctx);
    const acting = (open || closedOrder) && fg && pos.anyReceivable;
    const head = ["สินค้า", { label: "สั่ง", className: "right" }, { label: "PK ส่งมอบแล้ว", className: "right" }, { label: "รับเข้าแล้ว", className: "right" },
      ...(pos.anyFromStock ? [{ label: "ได้จากสต็อก", className: "right", title: "สินค้าสำเร็จรูปที่ใบนี้รับมาจากสต็อกของใบอื่นตอนปล่อยผลิต ไม่ต้องรับเข้า" }] : []),
      { label: closedOrder ? "รอรับ (ส่วนเกิน)" : "รอรับ", className: "right" }, ...(acting ? [{ label: closedOrder ? "รับเป็นสต็อก" : "รับครั้งนี้", className: "right" }] : [])];
    const rows = pos.products.map((product) => `<tr>${fgProductCell(ctx, product)}${fgNum(ctx, product.ordered)}${fgNum(ctx, product.pkDone)}${fgNum(ctx, product.own)}${pos.anyFromStock ? fgNum(ctx, product.fromStock) : ""}${fgNum(ctx, product.receivable)}${acting ? `<td class="right">${fgQtyInput(ctx, product, closedOrder ? "จำนวนที่รับเป็นสต็อก" : "จำนวนที่รับเข้า WH", product.receivable)}</td>` : ""}</tr>`);
    const table = ui.table(head, rows, { emptyText: "ใบนี้ไม่มีสินค้า" });
    const closeShort = pos.canCloseShort && fg ? ui.openButton("ปิดใบ (รับไม่ครบ)", "closeShort", { orderId: order.id }, { className: "secondary" }) : "";
    // รับครบและทุกแผนกปิดงานแล้วแต่ใบยังเปิด (รับครบก่อนงานสุดท้ายเสร็จ): WH ปิดใบ ยืนยันแล้วส่งทันที ไม่ต้องมีเหตุผล
    const fullClose = pos.canClose && fg ? ui.button("ปิดใบ", { action: "closeOrder", args: { orderId: order.id }, className: "", confirmText: `ปิดใบ ${order.id}? ทุกแผนกปิดงานและรับสินค้าเข้า WH ครบแล้ว ปิดแล้วเปิดกลับไม่ได้ สินค้าที่รับเข้าแล้วยังส่งมอบให้ลูกค้าได้`, success: "ปิดใบ {result} แล้ว" }) : "";
    // บันทึกผิดย้อนได้โดยผู้จัดการแผนกคลังสินค้า (WH) หรือผู้ดูแลระบบเท่านั้น (20261128020000) · ยืนยันแล้วส่งทันที
    const submit = closedOrder
      ? '<button class="btn rf-btn" type="submit" data-rf-confirm="รับส่วนที่ PK ผลิตเกินเข้า WH เป็นสต็อกสินค้าสำเร็จรูปตามจำนวนที่กรอก? ถ้าบันทึกผิด ย้อนได้โดยผู้จัดการแผนกคลังสินค้า (WH) เท่านั้น">รับส่วนเกินเข้า WH</button>'
      : '<button class="btn rf-btn" type="submit" data-rf-confirm="รับสินค้าเข้า WH ตามจำนวนที่กรอก? ถ้าบันทึกผิด ย้อนได้โดยผู้จัดการแผนกคลังสินค้า (WH) เท่านั้น">รับเข้า WH</button>';
    const waiting = pos.waitingProduction
      ? ui.callout("info", `ยังปิดใบไม่ได้: งานของแผนก ${esc(pos.openDepts.map((dept) => `${deptName(ctx, dept)} (${dept})`).join(", "))} ยังไม่เสร็จ · แผนกนั้นรายงานผลให้เสร็จ หรือฝ่ายวางแผนปิดงานที่จะไม่ทำต่อ แล้ว WH ปิดใบ`)
      : "";
    const note = pos.canClose && !fg ? '<p class="small muted">ทุกแผนกปิดงานแล้ว รอคลังสินค้า (WH) ปิดใบ</p>'
      : !fg ? '<p class="small muted">คลังสินค้า (WH) เป็นผู้รับสินค้าเข้าคลัง</p>'
      : open && !pos.anyReceivable && !pos.canCloseShort && !pos.allReceived ? '<p class="small muted">ยังไม่มีสินค้าที่รอรับ เมื่อ PK รายงานผลผลิต รับเข้า WH ได้ทันที ไม่ต้องรอผลิตครบทั้งใบ</p>' : "";
    const closed = pos.shortClose ? ui.callout("info", `ปิดใบโดยรับไม่ครบ: ${esc(pos.shortClose.reason)} (${esc(pos.shortClose.by)} · ${esc(rules.fmtDateTime(pos.shortClose.at))})`) : "";
    const surplus = closedOrder && pos.anyReceivable ? ui.callout("info", "ใบนี้ปิดแล้ว ส่วนที่ PK ผลิตเกินจำนวนสั่งรับเข้า WH ได้ และเป็นสต็อกสินค้าสำเร็จรูปที่ใบสั่งผลิตอื่นนำไปใช้ได้") : "";
    const covered = pos.coveredByStock ? ui.callout("info", "ใบนี้ได้สินค้าครบจากสต็อกสินค้าสำเร็จรูป ไม่มีงานผลิตและไม่มีของให้รับเข้า ส่งมอบให้ลูกค้าได้เลย") : "";
    // ปุ่มปิดใบ (รับครบ) เป็นปุ่ม type="button" ของตัวเอง (data-rf-action) จึงวางในฟอร์มรับเข้าได้โดยไม่ส่งฟอร์ม
    const actions = [acting ? submit : "", fullClose, closeShort].filter(Boolean).join("");
    const body = acting
      ? `<form novalidate data-rf-form="receiveFg" data-rf-args="${attr(JSON.stringify({ orderId: order.id }))}" data-rf-success="${closedOrder ? "รับส่วนเกินเข้า WH" : "รับเข้า WH"} {result} แล้ว">${table}<div class="rf-row bom-step-next">${actions}</div></form>`
      : `${table}${actions ? `<div class="rf-row bom-step-next">${actions}</div>` : ""}`;
    return ui.card(`${covered}${closed}${surplus}${waiting}${body}${note}`, { title });
  }

  // ---------- ส่งมอบ (PK) ----------
  function deliverPanel(ctx, order, pos, { title = "ส่งมอบให้ลูกค้า" } = {}) {
    const { ui, rules } = ctx;
    const fg = canFg(ctx);
    const acting = fg && pos.anyDeliverable;
    const anyGiven = pos.products.some((product) => product.givenAway > 0);
    const head = ["สินค้า", { label: "มีของในใบนี้", className: "right", title: "รับเข้า WH จากงานผลิตของใบนี้ รวมที่ได้จากสต็อกสินค้าสำเร็จรูป" },
      ...(anyGiven ? [{ label: "ให้ใบอื่นแล้ว", className: "right", title: "สินค้าที่ใบสั่งผลิตอื่นนำไปใช้จากสต็อกสินค้าสำเร็จรูปของใบนี้" }] : []),
      { label: "ส่งมอบแล้ว", className: "right" }, { label: "คงเหลือส่งมอบได้", className: "right" }, ...(acting ? [{ label: "ส่งครั้งนี้", className: "right" }] : [])];
    // ส่วนที่เกินจำนวนสั่ง (สต็อกสินค้าสำเร็จรูป) บอกใต้ยอดคงเหลือ · ช่องส่งครั้งนี้เติมเฉพาะส่วนที่ลูกค้าของใบนี้รออยู่ จึงไม่ส่งส่วนเกินโดยไม่ตั้งใจ
    const rows = pos.products.map((product) => `<tr>${fgProductCell(ctx, product)}${fgNum(ctx, product.have)}${anyGiven ? fgNum(ctx, product.givenAway) : ""}${fgNum(ctx, product.delivered)}<td class="right rf-mono">${esc(rules.fmtQty(product.deliverable))}${product.free > 0 ? `<div class="small muted">เกินที่สั่ง ${esc(rules.fmtQty(product.free))}</div>` : ""}</td>${acting ? `<td class="right">${fgQtyInput(ctx, product, "จำนวนที่ส่งมอบ", product.owed, product.deliverable, `data-bom-ordered-left="${attr(Math.max(0, product.ordered - product.delivered))}" data-bom-code="${attr(product.fgCode)}" data-bom-unit="${attr(uomText(ctx, itemOf(ctx, product.fgCode)?.uom ?? "set"))}"`)}</td>` : ""}</tr>`);
    const table = ui.table(head, rows, { emptyText: "ใบนี้ไม่มีสินค้า" });
    const submit = '<button class="btn rf-btn" type="submit" data-rf-confirm="ส่งมอบสินค้าตามจำนวนที่กรอก? ถ้าบันทึกผิด ย้อนได้โดยผู้จัดการแผนกคลังสินค้า (WH) เท่านั้น">ส่งมอบให้ลูกค้า</button>';
    const overBox = '<div class="rf-callout is-warn bom-compound-change" role="note" data-bom-deliver-over hidden><div class="rf-callout-body"><label class="bom-confirm-line"><input type="checkbox" name="overConfirm" value="1" data-bom-deliver-over-confirm> <span data-bom-deliver-over-text></span></label></div></div>';
    const form = acting
      ? `<form novalidate data-rf-form="deliverFg" data-rf-args="${attr(JSON.stringify({ orderId: order.id }))}" data-rf-success="ส่งมอบ {result} แล้ว">${table}${overBox}<div class="rf-row bom-step-next">${submit}</div></form>`
      : table;
    const note = !fg ? '<p class="small muted">คลังสินค้า (WH) เป็นผู้ส่งมอบสินค้าให้ลูกค้า</p>' : !pos.anyHave ? '<p class="small muted">ยังไม่มีสินค้ารับเข้า WH ส่งมอบได้เมื่อรับเข้าแล้ว</p>' : "";
    const surplus = pos.anyFree ? '<p class="small muted">ส่วนที่เกินที่สั่งเป็นสต็อกสินค้าสำเร็จรูป ใบสั่งผลิตอื่นนำไปใช้ได้ ถ้าจะเก็บไว้ให้ใบอื่น ไม่ต้องกรอกในช่องส่งครั้งนี้</p>' : "";
    return ui.card(`${form}${surplus}${note}`, { title });
  }

  // ---------- ประวัติของ PK (แถวเดียวของ fgMoves) ----------
  // ย้อนได้เฉพาะแถวรับเข้า / ส่งมอบของใบที่ปล่อยผลิตแล้วและยังไม่ถูกย้อน · ปุ่มเฉพาะผู้จัดการแผนก WH และผู้ดูแลระบบ
  function fgMoveRow(ctx, move, { orders, reversed, showOrder, perspective = move.orderId, skipCloseNote = false }) {
    const { ui, rules } = ctx;
    const order = orders.get(move.orderId) ?? null;
    const undone = reversed.has(move.id);
    const reversible = canReverseFg(ctx) && order && FG_STATUS.includes(order.status) && (move.kind === "receive" || move.kind === "deliver") && !undone;
    const label = fgMoveLabel(ctx, move, perspective, null);
    // แถวโอนสต็อกมีลิงก์ใบอีกฝั่งอยู่ในข้อความ จึงไม่ทำเป็นแถวคลิกได้ (ไม่ซ้อนลิงก์)
    const transfer = move.kind === "transfer" || move.kind === "untransfer";
    const link = order && !transfer ? orderHref(order.id) : null;
    const labelHtml = link ? `<a class="row-link-main" href="${attr(link)}">${label}</a>` : label;
    const qtyCell = move.kind === "close" ? dash
      : move.kind === "unreceive" || move.kind === "undeliver" ? esc(`−${rules.fmtQty(move.qty)}`)
      : undone ? `<s>${esc(rules.fmtQty(move.qty))}</s>` : esc(rules.fmtQty(move.qty));
    const whose = showOrder && move.orderId ? `<div class="small muted">${esc([`ใบ ${move.orderId}`, order?.customer].filter(Boolean).join(" · "))}</div>` : "";
    const button = reversible ? ui.openButton("ย้อน", "fgReverse", { orderId: move.orderId, moveId: move.id }, { className: "secondary small", ariaLabel: `ย้อน${FG_MOVE_LABEL[move.kind]} ${move.fgCode} ${rules.fmtQty(move.qty)}` }) : "";
    return `<tr${rowAttr(link, undone ? "muted" : "")}><td class="nowrap small">${esc(rules.fmtDateTime(move.at))}</td><td>${labelHtml}${move.fgCode ? ` <span class="rf-mono">${esc(move.fgCode)}</span>` : ""}${undone ? ` ${ui.badge("", "ถูกย้อน")}` : ""}${whose}${move.note && !isFullClose(move, null) && !(skipCloseNote && move.kind === "close") ? `<div class="small muted">${esc(move.note)}</div>` : ""}</td><td class="right rf-mono">${qtyCell}</td><td class="small">${esc(move.by ?? "")}</td><td class="right">${button}</td></tr>`;
  }
  // แถวเหตุการณ์ของกล่อง (ย้อนรับเข้า = ทั้งล็อต · ย้อนส่งมอบ = กล่องของแถวนั้น)
  function boxEventRow(ctx, event, { showLot = true } = {}) {
    const { ui, rules } = ctx;
    const { group } = event;
    const undone = event.reversed;
    const detail = [group.code, group.customer ? whoseText(group) : "", showLot ? `ล็อต ${group.id}` : ""].filter(Boolean).join(" · ");
    const button = event.reversible && canReverseBox(ctx)
      ? ui.openButton("ย้อน", "boxReverse", event.kind === "receive" ? { kind: "receipt", lotId: group.id } : { kind: "ship", lotId: group.id, ids: event.boxes.map(({ box }) => box.id) }, { className: "secondary small", ariaLabel: `ย้อน${BOX_KIND[event.kind]} ล็อต ${group.id}` }) : "";
    const label = `${BOX_KIND[event.kind] ?? event.kind} · ${boxCount(event.boxes)}`;
    const labelHtml = showLot ? mainLink(ctx, label, lotHref(group.id), "") : esc(label);
    const sign = event.kind === "unreceive" || event.kind === "unship" ? "−" : "";
    return `<tr${showLot ? rowAttr(lotHref(group.id), undone ? "muted" : "") : undone ? ' class="muted"' : ""}><td class="nowrap small">${esc(rules.fmtDateTime(event.at))}</td><td>${labelHtml}${undone ? ` ${ui.badge("", "ถูกย้อน")}` : ""}<div class="small muted">${esc(detail)}</div>${event.note ? `<div class="small muted">${esc(event.note)}</div>` : ""}</td><td class="right rf-mono">${esc(`${sign}${rules.fmtQty(event.qty)} ${rfUnit(group.uom)}`)}</td><td class="small">${esc(event.by)}</td><td class="right">${button}</td></tr>`;
  }
  const HISTORY_HEAD = ["เวลา", "รายการ", { label: "จำนวน", className: "right" }, "ผู้ทำ", ""];

  // ---------- ในคลัง ----------
  // ของในคลังตอนนี้ที่ยังมียอด: PK ต่อรหัสต่อใบ + สต็อกกลาง (ส่วนที่เกินที่ใบสั่ง) · RubberFlow ต่อล็อต (กล่องที่ WH รับแล้วและยังไม่ส่งมอบ)
  function stockRows(ctx, rb) {
    const { rules, data } = ctx;
    const orders = new Map(data.orders.map((row) => [row.id, row]));
    const received = new Map();
    for (const move of data.fgMoves ?? []) {
      if (move.kind !== "receive") continue;
      const key = `${move.orderId}\u0000${move.fgCode}`;
      received.set(key, Math.max(received.get(key) ?? 0, num(move.at)));
    }
    const rows = [];
    for (const row of rules.fgOnHand(data)) {
      const freeOf = new Map(row.freeOrders.map((entry) => [entry.orderId, entry.qty]));
      const unit = uomText(ctx, itemOf(ctx, row.fgCode)?.uom ?? "set");
      const name = itemOf(ctx, row.fgCode)?.name ?? "";
      for (const holder of row.orders) {
        const qty = round(holder.qty - (freeOf.get(holder.orderId) ?? 0));
        if (qty <= 0) continue;
        rows.push({ key: `pk:${row.fgCode}:${holder.orderId}`, source: "pk", own: "order", code: row.fgCode, name, qty, unit, orderId: holder.orderId, customer: orders.get(holder.orderId)?.customer ?? "", lotId: "", at: received.get(`${holder.orderId}\u0000${row.fgCode}`) ?? 0, href: orderHref(holder.orderId) });
      }
      if (row.free > 0) {
        const first = row.freeOrders[0]?.orderId ?? "";
        rows.push({ key: `pk:${row.fgCode}:central`, source: "pk", own: "central", code: row.fgCode, name, qty: row.free, unit, orderId: "", customer: "", lotId: "", at: Math.max(0, ...row.freeOrders.map((entry) => received.get(`${entry.orderId}\u0000${row.fgCode}`) ?? 0)), href: first ? orderHref(first) : null });
      }
    }
    for (const group of rb.lots) {
      if (!(group.stockQty > 0)) continue;
      rows.push({ key: `rb:${group.id}`, source: "rb", own: "order", code: group.code, name: itemOf(ctx, group.code)?.name ?? "", qty: group.stockQty, unit: rfUnit(group.uom), orderId: group.po, customer: group.customer, lotId: group.id, boxes: group.inStock.length, at: group.receivedAt, href: lotHref(group.id) });
    }
    return rows.sort((a, b) => String(a.code).localeCompare(String(b.code)) || a.at - b.at || String(a.key).localeCompare(String(b.key)));
  }
  const SOURCE_FILTERS = Object.freeze([{ value: "pk", label: "จาก PK" }, { value: "rb", label: "จาก RubberFlow (RB)" }]);
  const OWNER_FILTERS = Object.freeze([{ value: "central", label: "สต็อกกลาง" }, { value: "order", label: "ของใบสั่งผลิต / ลูกค้า" }]);
  const filterSelect = (ctx, name, label, options, value, placeholder) => `<div class="field rf-field sr-filter"><label class="sr-only" for="wh-${name}">${esc(label)}</label>${ctx.ui.select(name, options, { value, placeholder, id: `wh-${name}`, extra: `data-wh-filter title="${attr(label)}"` })}</div>`;

  function stockView(ctx, rb) {
    const { ui, rules, q } = ctx;
    const src = ctx.params.get("src") ?? "";
    const own = ctx.params.get("own") ?? "";
    const all = stockRows(ctx, rb);
    const matches = (row) => (!src || row.source === src) && (!own || row.own === own)
      && F.includesText(`${row.code} ${row.name} ${row.orderId} ${row.customer} ${row.lotId}`, q);
    const list = all.filter(matches);
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map((row) => {
      const codeCell = `${row.href ? mainLink(ctx, row.code, row.href) : ui.mono(row.code)}${row.name ? `<div class="small muted">${esc(row.name)}</div>` : ""}`;
      const whose = row.own === "central" ? "สต็อกกลาง" : [row.orderId ? `ใบ ${row.orderId}` : "", row.customer].filter(Boolean).join(" · ");
      const from = row.source === "pk" ? "PK" : `RB · ล็อต ${row.lotId}${row.boxes ? ` · ${row.boxes} กล่อง` : ""}`;
      return `<tr${rowAttr(row.href)}><td>${codeCell}</td><td class="right rf-mono">${esc(`${rules.fmtQty(row.qty)} ${row.unit}`)}</td><td>${esc(whose)}</td><td>${esc(from)}</td><td class="nowrap small">${row.at ? esc(rules.fmtDate(row.at)) : dash}</td></tr>`;
    });
    const filtered = Boolean(q || src || own);
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัส ชื่อ ใบ ลูกค้า หรือล็อต")}${filterSelect(ctx, "src", "ที่มาของสินค้า", SOURCE_FILTERS, src, "ทุกที่มา")}${filterSelect(ctx, "own", "ของใคร", OWNER_FILTERS, own, "ทุกที่")}${filtered ? ui.link("ล้างตัวกรอง", F.routeUrl(ROUTE, ctx.view.params), "btn rf-btn secondary small") : ""}</div>`;
    const table = ui.card(`${ui.table(["สินค้า", { label: "จำนวน", className: "right" }, "ของ", "ที่มา", "วันที่รับ"], rows, { emptyText: filtered ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้าสำเร็จรูปในคลัง" })}${more}`, { flush: true });
    return `${rbNote(ctx, rb)}${toolbar}${table}`;
  }

  // ---------- งานของฉัน ----------
  const receiveConfirm = (group) => `รับกล่องของล็อต ${group.id} เข้า WH ทั้ง ${group.pending.length} กล่อง? ถ้าบันทึกผิด ย้อนได้โดยผู้จัดการแผนกคลังสินค้า (WH) เท่านั้น`;
  const receiveButton = (ctx, group, className = "") => ctx.ui.button("รับเข้า WH", { action: "receiveBoxes", args: { lotId: group.id }, className, confirmText: receiveConfirm(group), success: "รับเข้า WH ล็อต {result} แล้ว", ariaLabel: `รับเข้า WH ล็อต ${group.id}` });
  function rbCard(ctx, group) {
    const { rules } = ctx;
    const href = lotHref(group.id);
    const action = canBox(ctx) ? receiveButton(ctx, group, "bom-job-main") : '<p class="small muted">ดูอย่างเดียว บัญชีนี้ไม่มีสิทธิ์ดำเนินการ</p>';
    return `<article class="card rf-card bom-job is-now${F.cardClass(href)}"><div class="bom-job-top"><span class="bom-job-state">รอรับเข้า WH</span><span class="muted">${esc(`ตกแต่งเสร็จ ${rules.fmtDate(group.createdAt)}`)}</span></div>
      <h2>${F.cardTitle(`รับกล่องเข้า WH ล็อต ${group.id}`, href)}</h2><p class="small muted"><span class="rf-mono">${esc(group.code)}</span>${whoseText(group) ? ` · ${esc(whoseText(group))}` : ""} · จาก RubberFlow</p>
      <div class="bom-job-amount"><span>${esc(`${lotQty(ctx, group, group.pendingQty)} · ${boxCount(group.pending)}`)}</span></div>${action}</article>`;
  }
  function pendingLots(rb) { return rb.lots.filter((group) => group.pending.length); }
  // ตัวเลขที่เมนู "งานของฉัน" = การ์ดของ BOM (PK) + ล็อตของ RubberFlow ที่รอรับเข้า
  function workCount(ctx) {
    let rbCount = 0;
    try { rbCount = pendingLots(rbState(ctx)).length; } catch { rbCount = 0; }
    return F.deptWork(ctx).count + rbCount;
  }
  function workView(ctx, rb) {
    const { ui } = ctx;
    const job = F.deptWork(ctx, { title: null });
    const cards = pendingLots(rb).map((group) => rbCard(ctx, group));
    const parts = [job.count ? job.html : "", cards.length ? `<div class="bom-job-grid">${cards.join("")}</div>` : "", rbNote(ctx, rb)].filter(Boolean);
    return parts.length ? parts.join("") : ui.card(ui.empty("ไม่มีงานค้าง"));
  }

  // ---------- รับเข้า ----------
  const byWhDue = (a, b) => num(a.whDue) - num(b.whDue) || String(a.id).localeCompare(String(b.id));
  const orderCardTitle = (ctx, order) => `${ctx.ui.link(order.id, orderHref(order.id), "rf-mono")} <span class="small muted">${esc(order.customer ?? "")}</span>`;
  function receiveView(ctx, rb) {
    const { ui, rules, data } = ctx;
    const orders = data.orders.filter((order) => FG_STATUS.includes(order.status)).sort(byWhDue);
    const pk = orders.map((order) => ({ order, pos: rules.fgPosition(data, order) })).filter(({ pos }) => pos.anyReceivable || pos.canClose || pos.canCloseShort);
    const pkCards = pk.map(({ order, pos }) => receivePanel(ctx, order, pos, { title: orderCardTitle(ctx, order) })).join("");
    const lots = pendingLots(rb);
    const box = canBox(ctx);
    const rows = lots.map((group) => `<tr${rowAttr(lotHref(group.id))}><td>${mainLink(ctx, group.id, lotHref(group.id))}<div class="small muted">${esc(ctx.rules.fmtDate(group.createdAt))}</div></td><td>${ui.mono(group.code)}<div class="small muted">${esc(itemOf(ctx, group.code)?.name ?? "")}</div></td><td class="right rf-mono">${esc(lotQty(ctx, group, group.pendingQty))}<div class="small muted">${esc(boxCount(group.pending))}</div></td><td>${esc(whoseText(group))}</td><td class="right">${box ? receiveButton(ctx, group, "small") : ""}</td></tr>`);
    const rbPart = lots.length || rb.status === "ready" ? ui.card(ui.table(["ล็อต", "สินค้า", { label: "จำนวน", className: "right" }, "ของ", ""], rows, { emptyText: "ไม่มีล็อตที่รอรับเข้า" }), { title: esc("จาก RubberFlow (กล่องรอรับเข้า)"), flush: true }) : "";
    const pkPart = pkCards || ui.card(ui.empty("ไม่มีสินค้าจาก PK ที่รอรับเข้า"));
    return `${rbNote(ctx, rb)}${pkPart}${rbPart}`;
  }

  // ---------- ส่งมอบ ----------
  const shipConfirm = (group) => `ส่งมอบกล่องที่เลือกของล็อต ${group.id} ให้ลูกค้า${group.customer ? ` ${group.customer}` : ""}? ถ้าบันทึกผิด ย้อนได้โดยผู้จัดการแผนกคลังสินค้า (WH) เท่านั้น`;
  // ฟอร์มส่งมอบกล่องของล็อตเดียว: ติ๊กกล่อง (ค่าตั้งต้น = ทุกกล่อง) · ไม่มีสิทธิ์ = รายการกล่องอย่างเดียว
  function shipForm(ctx, group) {
    const boxes = group.inStock.map((box) => `<label class="wh-box"><input type="checkbox" name="ids[]" value="${attr(box.id)}" checked><span class="rf-mono">${esc(String(box.id).split("-").pop())}</span><span class="small muted">${esc(`${ctx.rules.fmtQty(box.qty)} ${rfUnit(box.uom)}`)}</span></label>`).join("");
    if (!canBox(ctx)) return `<div class="wh-boxes">${group.inStock.map((box) => `<span class="rf-badge">${esc(String(box.id).split("-").pop())}</span>`).join("")}</div><p class="small muted">คลังสินค้า (WH) เป็นผู้ส่งมอบสินค้าให้ลูกค้า</p>`;
    return `<form novalidate data-rf-form="shipBoxes" data-rf-success="ส่งมอบกล่องให้ลูกค้าแล้ว"><fieldset class="wh-fieldset"><legend class="sr-only">${esc(`กล่องของล็อต ${group.id}`)}</legend><div class="wh-boxes">${boxes}</div></fieldset><div class="rf-row bom-step-next"><button class="btn rf-btn" type="submit" data-rf-confirm="${attr(shipConfirm(group))}">ส่งมอบให้ลูกค้า</button></div></form>`;
  }
  function lotShipCard(ctx, group) {
    const { ui } = ctx;
    const title = `${ui.link(`ล็อต ${group.id}`, lotHref(group.id), "rf-mono")} <span class="small muted">${esc([group.code, whoseText(group), `${lotQty(ctx, group, group.stockQty)} · ${boxCount(group.inStock)}`].filter(Boolean).join(" · "))}</span>`;
    return ui.card(shipForm(ctx, group), { title });
  }
  function deliverView(ctx, rb) {
    const { ui, rules, data } = ctx;
    const orders = data.orders.filter((order) => FG_STATUS.includes(order.status)).sort(byWhDue);
    const pk = orders.map((order) => ({ order, pos: rules.fgPosition(data, order) })).filter(({ pos }) => pos.anyDeliverable);
    const pkCards = pk.map(({ order, pos }) => deliverPanel(ctx, order, pos, { title: orderCardTitle(ctx, order) })).join("");
    const lots = rb.lots.filter((group) => group.inStock.length);
    const rbCards = lots.map((group) => lotShipCard(ctx, group)).join("");
    const rbPart = rbCards || (rb.status === "ready" ? ui.card(ui.empty("ไม่มีกล่องจาก RubberFlow ที่รอส่งมอบ")) : "");
    return `${rbNote(ctx, rb)}${pkCards || ui.card(ui.empty("ไม่มีสินค้าจาก PK ที่รอส่งมอบ"))}${rbPart}`;
  }

  // ---------- ประวัติ ----------
  const HISTORY_KINDS = Object.freeze([{ value: "receive", label: "รับเข้า" }, { value: "deliver", label: "ส่งมอบ" }, { value: "close", label: "ปิดใบ" }, { value: "reverse", label: "ย้อนรายการ" }, { value: "transfer", label: "โอนสต็อกระหว่างใบ" }]);
  const FG_KIND_GROUP = Object.freeze({ receive: "receive", deliver: "deliver", close: "close", unreceive: "reverse", undeliver: "reverse", transfer: "transfer", untransfer: "transfer" });
  const BOX_KIND_GROUP = Object.freeze({ receive: "receive", ship: "deliver", unreceive: "reverse", unship: "reverse" });
  function historyEntries(ctx, rb) {
    const { data } = ctx;
    const orders = new Map(data.orders.map((row) => [row.id, row]));
    const reversed = new Set((data.fgMoves ?? []).filter((move) => move.reversesId).map((move) => move.reversesId));
    const entries = (data.fgMoves ?? []).map((move) => ({
      at: num(move.at), key: `pk:${move.id}`, group: FG_KIND_GROUP[move.kind] ?? move.kind,
      text: `${move.fgCode ?? ""} ${move.orderId ?? ""} ${orders.get(move.orderId)?.customer ?? ""} ${move.note ?? ""} ${move.by ?? ""}`,
      html: () => fgMoveRow(ctx, move, { orders, reversed, showOrder: true }),
    }));
    for (const event of boxEvents(rb.lots)) {
      entries.push({
        at: event.at, key: `rb:${event.key}`, group: BOX_KIND_GROUP[event.kind] ?? event.kind,
        text: `${event.group.code} ${event.group.id} ${event.group.po} ${event.group.customer} ${event.note} ${event.by}`,
        html: () => boxEventRow(ctx, event),
      });
    }
    return entries.sort((a, b) => b.at - a.at || String(b.key).localeCompare(String(a.key)));
  }
  function historyView(ctx, rb) {
    const { ui, q } = ctx;
    const kind = ctx.params.get("kind") ?? "";
    const list = historyEntries(ctx, rb).filter((entry) => (!kind || entry.group === kind) && F.includesText(entry.text, q));
    const { shown, more } = F.limited(ctx, list);
    const filtered = Boolean(kind || q);
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัส ใบ ลูกค้า ล็อต หรือผู้ทำ")}${filterSelect(ctx, "kind", "ชนิดรายการ", HISTORY_KINDS, kind, "ทุกรายการ")}${filtered ? ui.link("ล้างตัวกรอง", F.routeUrl(ROUTE, ctx.view.params), "btn rf-btn secondary small") : ""}</div>`;
    return `${rbNote(ctx, rb)}${toolbar}${ui.card(`${ui.table(HISTORY_HEAD, shown.map((entry) => entry.html()), { emptyText: filtered ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีประวัติรับเข้าและส่งมอบ" })}${more}`, { flush: true })}`;
  }

  // ---------- หน้าใบสั่งผลิต (?order=) ----------
  function orderMissing(ctx, text) {
    return { html: `${backLink(whUrl({ tab: "stock" }), "‹ ในคลัง")}${F.pageHead(ctx, "ใบสั่งผลิต")}${ctx.ui.card(ctx.ui.empty(text))}` };
  }
  function orderView(ctx, orderId) {
    const { ui, rules, data } = ctx;
    const order = data.orders.find((row) => row.id === orderId);
    if (!order) return orderMissing(ctx, "ไม่พบใบสั่งผลิตนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)");
    if (!FG_STATUS.includes(order.status)) return orderMissing(ctx, "ใบนี้ยังไม่ปล่อยผลิตหรือถูกยกเลิก ยังไม่มีสินค้าให้รับเข้าหรือส่งมอบ");
    const pos = rules.fgPosition(data, order);
    const facts = ui.kv([
      ["ใบสั่งผลิต", `${ui.link(order.id, ctx.url("orders", { sel: order.id }), "rf-mono")}`],
      ...(order.customer ? [["ลูกค้า", esc(order.customer)]] : []),
      ...(order.whDue ? [["ส่งมอบคลัง", esc(rules.fmtDate(order.whDue))]] : []),
    ]);
    const reversed = new Set((data.fgMoves ?? []).filter((move) => move.reversesId).map((move) => move.reversesId));
    const orders = new Map(data.orders.map((row) => [row.id, row]));
    const history = ui.card(ui.table(HISTORY_HEAD, pos.moves.map((move) => fgMoveRow(ctx, move, { orders, reversed, showOrder: false, perspective: order.id, skipCloseNote: Boolean(pos.shortClose) })), { emptyText: "ยังไม่มีรับเข้าหรือส่งมอบของใบนี้" }), { title: esc("ประวัติของใบนี้"), flush: true });
    return { html: `${backLink(whUrl({ tab: "stock" }), "‹ ในคลัง")}${F.pageHead(ctx, `ใบ ${order.id}`, `<span class="small muted" role="status" data-bom-sync>${esc(root.MNP_BOM?.syncText?.() ?? "")}</span>`)}${ui.card(facts, { className: "sr-lot-facts" })}${receivePanel(ctx, order, pos)}${deliverPanel(ctx, order, pos)}${history}` };
  }

  // ---------- หน้าล็อตของ RubberFlow (?lot=) ----------
  function lotView(ctx, lotId, rb) {
    const { ui, rules } = ctx;
    const back = backLink(whUrl({ tab: "stock" }), "‹ ในคลัง");
    if (rb.status !== "ready") return { html: `${back}${F.pageHead(ctx, "ล็อตจาก RubberFlow")}${rbNote(ctx, rb) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"))}` };
    const group = rb.lots.find((row) => row.id === lotId);
    if (!group) return { html: `${back}${F.pageHead(ctx, "ล็อตจาก RubberFlow")}${ui.card(ui.empty("ไม่พบล็อตนี้ (อาจไม่มีกล่องที่ส่งให้ WH หรือยังโหลดไม่เสร็จ)"))}` };
    const counts = Object.entries(BOX_STATUS).map(([status, [tone, label]]) => ({ tone, label, n: group.boxes.filter((box) => box.status === status).length })).filter((row) => row.n).map((row) => ui.badge(row.tone, `${row.label} ${row.n}`)).join(" ");
    const facts = ui.kv([
      ["สินค้า", `${ui.mono(group.code)}${itemOf(ctx, group.code)?.name ? `<div class="small muted">${esc(itemOf(ctx, group.code).name)}</div>` : ""}`],
      ...(whoseText(group) ? [["ของ", esc(whoseText(group))]] : []),
      ["ใบสั่งผลิต (RubberFlow)", ui.link(group.wo?.id ?? group.lot?.orderId ?? "-", `#/rubberflow?p=orders&q=${encodeURIComponent(group.wo?.id ?? "")}`, "rf-mono")],
      ["ปลายทาง", "ส่งมอบให้ลูกค้าผ่าน WH"],
      ["กล่อง", `${counts}`],
      ["ตกแต่งเสร็จ", esc(rules.fmtDateTime(group.createdAt))],
    ]);
    const buttons = [
      group.pending.length && canBox(ctx) ? receiveButton(ctx, group, "") : "",
      group.inStock.length && canReverseBox(ctx) && !group.shipped.length && !group.hold.length ? ui.openButton("ย้อนการรับเข้า", "boxReverse", { kind: "receipt", lotId: group.id }, { className: "secondary" }) : "",
    ].join("");
    const boxRows = group.boxes.map((box) => { const [tone, label] = BOX_STATUS[box.status] ?? ["", box.status]; return `<tr><td>${ui.mono(box.id)}</td><td class="right rf-mono">${esc(`${rules.fmtQty(box.qty)} ${rfUnit(box.uom)}`)}</td><td>${ui.badge(tone, label)}</td><td class="nowrap small">${box.receivedAt ? esc(rules.fmtDate(box.receivedAt)) : dash}</td><td class="nowrap small">${box.shippedAt ? esc(rules.fmtDate(box.shippedAt)) : dash}</td></tr>`; });
    const boxes = ui.card(ui.table(["กล่อง", { label: "จำนวน", className: "right" }, "สถานะ", "รับเข้า", "ส่งมอบ"], boxRows), { title: esc("กล่องในล็อต"), flush: true });
    const ship = group.inStock.length ? lotShipCard(ctx, group) : "";
    const events = boxEvents([group]).sort((a, b) => b.at - a.at || String(b.key).localeCompare(String(a.key)));
    const history = ui.card(ui.table(HISTORY_HEAD, events.map((event) => boxEventRow(ctx, event, { showLot: false })), { emptyText: "ยังไม่มีรับเข้าหรือส่งมอบของล็อตนี้" }), { title: esc("ประวัติของล็อต"), flush: true });
    return { html: `${back}${F.pageHead(ctx, `ล็อต ${group.id}`, `${buttons}<span class="small muted" role="status" data-bom-sync>${esc(root.MNP_BOM?.syncText?.() ?? "")}</span>`)}<div class="sr-lot">${ui.card(facts, { className: "sr-lot-facts" })}${ship}</div>${boxes}${history}` };
  }

  // ---------- dialog: ปิดใบ (รับไม่ครบ) · ย้อนรับเข้า/ส่งมอบของ PK · ย้อนรับเข้า/ส่งมอบของกล่อง ----------
  // ปิดใบที่รับไม่ครบ: ต้องมีเหตุผล (3-300 ตัวอักษร) · เปิดได้เฉพาะเมื่อ PK เสร็จทุกงาน ของที่ PK ทำรับเข้าครบแล้ว และยังมีสินค้าที่รับน้อยกว่าที่สั่ง
  dialogs.closeShort = (ctx, { orderId }) => {
    const { ui, rules, user } = ctx;
    const order = ctx.data.orders.find((entry) => entry.id === orderId);
    if (!order || !ctx.helpers.canHandleFg(user)) return null;
    const pos = rules.fgPosition(ctx.data, order);
    if (!pos.canCloseShort) return null;
    const short = pos.products.filter((product) => product.have + 1e-9 < product.ordered);
    const rows = short.map((product) => `<tr><td>${ui.mono(product.fgCode)}</td>${fgNum(ctx, product.ordered)}${fgNum(ctx, product.have)}${fgNum(ctx, product.ordered - product.have)}</tr>`);
    const body = `<form novalidate id="bom-close-short-form" data-rf-form="closeOrderShort" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="ปิดใบ {result} แล้ว">
      ${ui.callout("warn", "ใบจะปิดโดยรับสินค้าไม่ครบตามที่สั่ง ปิดแล้วเปิดกลับไม่ได้ ส่วนที่รับเข้าแล้วยังส่งมอบให้ลูกค้าได้")}
      ${ui.table(["สินค้า", { label: "สั่ง", className: "right" }, { label: "มีของแล้ว", className: "right", title: "รับเข้า WH แล้ว รวมที่ได้จากสต็อกสินค้าสำเร็จรูป" }, { label: "ขาด", className: "right" }], rows)}
      ${ui.field("เหตุผล", ui.input("note", { required: true, placeholder: "เช่น PK ผลิตได้ไม่ครบ ลูกค้าตกลงรับเท่าที่มี", extra: 'minlength="3" maxlength="300"' }), { required: true })}</form>`;
    return { html: ui.dialog("closeShort", `ปิดใบ (รับไม่ครบ) · ${orderId}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-close-short-form">ปิดใบ</button>` }) };
  };
  // ย้อนรับเข้า / ย้อนส่งมอบหนึ่งรายการทั้งรายการ (20261128020000): ผู้จัดการแผนกคลังสินค้า (WH) หรือผู้ดูแลระบบ · ต้องมีเหตุผล 3-300 ตัวอักษร
  // ย้อนไม่ได้ (ส่งมอบไปแล้วเกินที่จะเหลือ / ใบอื่นใช้สต็อกไปแล้ว / ย้อนแล้ว) = บอกเหตุผลและไม่มีปุ่มยืนยัน · ใบที่ปิดแล้วจะเปิดกลับ = บอกในหน้าต่าง
  dialogs.fgReverse = (ctx, { orderId, moveId }) => {
    const { ui, rules, user } = ctx;
    const order = ctx.data.orders.find((entry) => entry.id === orderId);
    const move = (ctx.data.fgMoves ?? []).find((entry) => entry.id === moveId);
    if (!order || !move || !ctx.helpers.canReverseFg?.(user)) return null;
    const label = FG_MOVE_LABEL[move.kind] ?? move.kind;
    const blocked = rules.fgReverseBlock(ctx.data, order, move);
    const reopens = !blocked && rules.fgReverseReopens(ctx.data, order, move);
    const unit = esc(uomText(ctx, itemOf(ctx, move.fgCode)?.uom ?? "set"));
    const facts = ui.kv([[label, `<span class="rf-mono">${esc(move.fgCode)}</span> ${esc(rules.fmtQty(move.qty))} ${unit}`], ["บันทึกเมื่อ", esc(`${rules.fmtDateTime(move.at)} · ${move.by ?? "-"}`)]]);
    const effect = move.kind === "receive"
      ? `ยอดรับเข้า WH ของ ${move.fgCode} ลดลง ${rules.fmtQty(move.qty)} แล้วรับเข้าใหม่ด้วยจำนวนที่ถูกต้องได้ (ไม่เกินที่ PK ส่งมอบ)${reopens ? ` · ใบ ${order.id} ปิดแล้วและของจะไม่ครบตามที่สั่ง ใบจะเปิดกลับเป็นกำลังผลิต รับเข้าครบแล้วปิดเองอีกครั้ง` : ""}`
      : `ยอดส่งมอบของ ${move.fgCode} ลดลง ${rules.fmtQty(move.qty)} ของกลับมาอยู่ในคลังของใบนี้ แล้วบันทึกส่งมอบใหม่ด้วยจำนวนที่ถูกต้องได้`;
    if (blocked) return { html: ui.dialog("fgReverse", `ย้อน${label} · ${orderId}`, `${facts}${ui.callout("warn", esc(blocked))}`, { footer: ui.closeButton("ปิด") }) };
    const body = `<form novalidate id="bom-fg-reverse-form" data-rf-form="reverseFg" data-rf-args="${attr(JSON.stringify({ orderId, moveId }))}" data-rf-success="ย้อน${esc(label)} {result} แล้ว">
      ${facts}
      ${ui.callout("warn", `${esc(effect)} · รายการเดิมยังอยู่ในประวัติ ย้อนแล้วแก้กลับไม่ได้`)}
      ${ui.field("เหตุผล", ui.input("note", { required: true, placeholder: "เช่น พิมพ์จำนวนผิด ต้องเป็น 5", extra: 'minlength="3" maxlength="300"' }), { required: true })}</form>`;
    return { html: ui.dialog("fgReverse", `ย้อน${label} · ${orderId}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-fg-reverse-form">ย้อน${esc(label)}</button>` }) };
  };
  // ย้อนกล่อง (RubberFlow): kind = receipt (ย้อนการรับเข้าทั้งล็อต: กล่องกลับไปรอ WH รับ) | ship (ย้อนการส่งมอบของกล่องที่เลือก: กล่องกลับเข้าคลัง) · ผู้จัดการแผนก WH หรือผู้ดูแลระบบ · เหตุผล 3-300 ตัวอักษร
  dialogs.boxReverse = (ctx, { kind, lotId, ids }) => {
    const { ui, rules } = ctx;
    if (!canReverseBox(ctx)) return null;
    const rb = rbState(ctx);
    const group = rb.lots.find((row) => row.id === lotId);
    if (!group) return null;
    const receipt = kind === "receipt";
    const label = receipt ? "ย้อนการรับเข้า WH" : "ย้อนการส่งมอบ";
    const targets = receipt ? group.inStock : group.boxes.filter((box) => (ids ?? []).includes(box.id) && box.status === "shipped");
    const blocked = receipt && (group.shipped.length || group.hold.length) ? `ล็อต ${group.id} มีกล่องที่ส่งมอบแล้วหรือถูกกักรอ QC ย้อนการรับเข้าไม่ได้ (ย้อนการส่งมอบกล่องนั้นก่อน)`
      : !targets.length ? (receipt ? `ล็อต ${group.id} ไม่มีกล่องที่รับเข้า WH แล้ว` : "กล่องที่เลือกไม่ได้อยู่ในสถานะส่งมอบแล้ว") : "";
    const facts = ui.kv([["ล็อต", ui.mono(group.id)], ["สินค้า", `${ui.mono(group.code)} <span class="small muted">${esc(whoseText(group))}</span>`], ["กล่อง", esc(`${boxCount(targets)} · ${rules.fmtQty(round(targets.reduce((total, box) => total + num(box.qty), 0)))} ${rfUnit(group.uom)}`)]]);
    const title = `${label} · ${group.id}`;
    if (blocked) return { html: ui.dialog("boxReverse", title, `${facts}${ui.callout("warn", esc(blocked))}`, { footer: ui.closeButton("ปิด") }) };
    const effect = receipt ? `กล่องทั้ง ${targets.length} กล่องของล็อตกลับไปรอ WH รับเข้าใหม่ (ถ้าล็อตนี้นับยอดเข้างาน BOM แล้ว ยอดที่นับถูกถอนคืน)` : `กล่อง ${targets.length} กล่องที่เลือกกลับเข้าคลัง ส่งมอบใหม่ได้`;
    const args = receipt ? { lotId: group.id } : { ids: targets.map((box) => box.id) };
    const action = receipt ? "reverseBoxReceipt" : "reverseBoxShip";
    const body = `<form novalidate id="wh-box-reverse-form" data-rf-form="${action}" data-rf-args="${attr(JSON.stringify(args))}" data-rf-success="${label}แล้ว">
      ${facts}
      ${ui.callout("warn", `${esc(effect)} · รายการเดิมยังอยู่ในประวัติ ย้อนแล้วแก้กลับไม่ได้`)}
      ${ui.field("เหตุผล", ui.input("note", { required: true, placeholder: receipt ? "เช่น รับผิดล็อต" : "เช่น ส่งผิดลูกค้า", extra: 'minlength="3" maxlength="300"' }), { required: true })}</form>`;
    return { html: ui.dialog("boxReverse", title, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="wh-box-reverse-form">${label}</button>` }) };
  };

  // ---------- หน้าแรกของโมดูล ----------
  // ตัวกรอง (select) เปลี่ยนแล้วไปที่หน้าเดิมพร้อมตัวกรองใหม่ · ช่องจำนวนส่งมอบเกินที่สั่ง (ฟอร์มส่งมอบของ PK)
  function bindPage(node, pageCtx) {
    node.querySelectorAll("[data-wh-filter]").forEach((select) => select.addEventListener("change", () => { location.hash = pageCtx.pageUrl({ [select.name]: select.value || null, n: null }); }));
    node.querySelectorAll('form[data-rf-form="deliverFg"]').forEach((form) => bindDeliverOver(pageCtx, form));
  }
  function landing(ctx) {
    const { ui } = ctx;
    const rb = rbState(ctx);
    const orderId = ctx.params.get("order");
    const lotId = ctx.params.get("lot");
    if (orderId) return { ...orderView(ctx, orderId), bind: bindPage, actions: true };
    if (lotId) return { ...lotView(ctx, lotId, rb), bind: bindPage, actions: true };
    const id = ctx.view?.id;
    const head = (extra = "") => F.viewHead(ctx, extra);
    if (id === "stock") {
      const pending = workCount(ctx);
      const work = pending ? ui.link(`งานที่รอ ${pending}`, whUrl({}), "btn rf-btn secondary small") : "";
      return { html: `${head(work)}${stockView(ctx, rb)}`, bind: bindPage, actions: true };
    }
    if (id === "receive") return { html: `${head()}${receiveView(ctx, rb)}`, bind: bindPage, actions: true };
    if (id === "deliver") return { html: `${head()}${deliverView(ctx, rb)}`, bind: bindPage, actions: true };
    if (id === "history") return { html: `${head()}${historyView(ctx, rb)}`, bind: bindPage, actions: true };
    return { html: `${head()}${workView(ctx, rb)}`, bind: bindPage, actions: true };
  }

  const MENU = Object.freeze([
    F.workItem(workCount),
    { id: "stock", label: "ในคลัง", icon: "warehouse", params: { tab: "stock" }, owns: ["order", "lot"] },
    { id: "receive", label: "รับเข้า", icon: "download", params: { tab: "receive" } },
    { id: "deliver", label: "ส่งมอบ", icon: "box", params: { tab: "deliver" } },
    { id: "history", label: "ประวัติ", icon: "history", params: { tab: "history" } },
  ]);

  root.MNP_WH_PAGES = Object.freeze({ landing, MENU, stockRows, rbLots, boxEvents, historyEntries, receivePanel, deliverPanel, workCount, KEEP: Object.freeze(["src", "own", "kind"]) });
})(window);
