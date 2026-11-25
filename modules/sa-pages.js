// หน้าของโมดูลฝ่ายขาย (SA) #/sa — โรงงานขั้น 8 (20261225010000_bom_sales_orders.sql) โหมดทดสอบเท่านั้น · โหลดก่อน modules/module-sa.js (ดู index.html)
// ฝ่ายขายออกใบสั่งผลิตเอง (ที่มา SA) แล้วส่งให้ฝ่ายวางแผนคำนวณวัตถุดิบและปล่อยผลิต · ติดตามความคืบหน้ารายแผนกและยอดส่งมอบ · ขอยกเลิก / ขอแก้ใบหลังปล่อยผลิต · ทะเบียนลูกค้า
// หน้า: งานของฉัน (ค่าตั้งต้น) · ออกใบสั่งผลิต ?tab=new · ใบของฝ่ายขาย ?tab=orders · ทะเบียนลูกค้า ?tab=customers · หน้าใบ ?order=<เลขใบ>
// คำสั่งใช้ action ของ BOM ชุดเดียวกัน (createOrder updateOrderHeader addOrderItem updateOrderItem removeOrderItem sendOrderToPlanning cancelOrder requestOrderCancel requestOrderChange) — สิทธิ์จริงตัดสินที่ action และฐานข้อมูล ปุ่มที่ซ่อนเป็นแค่ UX
// ไฟล์นี้ยังมี planningCards: การ์ด "ใบใหม่จากฝ่ายขาย" และ "คำขอจากฝ่ายขาย" ที่ฝ่ายวางแผนเห็นบนหน้าแรกและหน้าใบสั่งผลิตของ #/pp (ตัดสินคำขอด้วย decideOrderRequest)
(function registerSaPages(root) {
  const F = root.MNP_FACTORY;
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const ROUTE = "sa";
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const saUrl = (query = {}) => F.routeUrl(ROUTE, query);
  const shared = () => root.MNP_BOM_PAGES?.sales ?? {};
  const DAY = 86400000;
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);
  const backLink = (href, text) => `<a class="request-back-link" href="${attr(href)}">${esc(text)}</a>`;

  // ---------- ข้อมูล ----------
  const salesOrders = (ctx) => ctx.data.orders.filter((order) => ctx.helpers.orderSource(order) === "SA");
  const isUnsent = (ctx, order) => order.status === "draft" && !ctx.helpers.isSentOrder(order);
  const itemsText = (ctx, order) => (order.items.length ? order.items.map((item) => `${item.fgCode} × ${ctx.rules.fmtQty(item.qty)}`).join(", ") : "ยังไม่มีสินค้า");
  const newestFirst = (a, b) => (Number(b.orderedAt) || 0) - (Number(a.orderedAt) || 0) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const requestsOf = (ctx, orderId) => ctx.helpers.orderRequestsOf(ctx.data, orderId).slice().sort((a, b) => (Number(b.requestedAt) || 0) - (Number(a.requestedAt) || 0));
  const KIND_TEXT = Object.freeze({ cancel: "ขอยกเลิกใบ", change: "ขอแก้ใบ" });
  const workCount = (ctx) => salesOrders(ctx).filter((order) => isUnsent(ctx, order)).length;

  // สถานะที่ฝ่ายขายเห็น: ใบร่างที่ส่งแล้วรอฝ่ายวางแผนปล่อยผลิต (ฐานข้อมูลไม่มีสถานะแยก) แยกจากใบร่างที่ยังไม่ส่ง
  const statusKey = (ctx, order) => (order.status === "draft" ? (ctx.helpers.isSentOrder(order) ? "waiting" : "unsent") : order.status);
  const statusBadge = (ctx, order) => {
    const key = statusKey(ctx, order);
    if (key === "unsent") return ctx.ui.badge("", "ร่าง ยังไม่ส่ง");
    if (key === "waiting") return ctx.ui.badge("warn", "รอฝ่ายวางแผนปล่อยผลิต");
    return shared().orderStatus(ctx, order);
  };
  const STATUS_FILTERS = Object.freeze([["", "ทุกสถานะ"], ["unsent", "ร่าง ยังไม่ส่ง"], ["waiting", "รอฝ่ายวางแผนปล่อยผลิต"], ["released", "ปล่อยผลิต"], ["in_progress", "กำลังผลิต"], ["completed", "เสร็จสิ้น"], ["cancelled", "ยกเลิก"]]);

  const dueLate = (ctx, order) => !["completed", "cancelled"].includes(order.status) && Number(order.whDue) < ctx.now;

  // ---------- ตารางใบ ----------
  function orderRows(ctx, orders, { send = false } = {}) {
    const { ui, rules } = ctx;
    return orders.map((order) => {
      const href = saUrl({ order: order.id });
      const action = send && ctx.helpers.canSell(ctx.user) ? ui.button("ส่งให้ฝ่ายวางแผน", { action: "sendOrderToPlanning", args: { orderId: order.id }, className: "small", confirmText: sendConfirm(ctx, order), ariaLabel: `ส่งใบ ${order.id} ให้ฝ่ายวางแผน` }) : "";
      return `<tr class="row-link"><td>${ui.link(order.id, href, "rf-mono row-link-main")}<div class="small muted">${esc(order.customer)}</div></td><td class="small">${esc(itemsText(ctx, order).slice(0, 80))}</td><td class="nowrap${dueLate(ctx, order) ? " bom-job-late" : ""}">${esc(rules.fmtDate(order.whDue))}</td><td>${statusBadge(ctx, order)}</td><td class="small muted">${esc(order.createdBy ?? "")}</td>${send !== null ? `<td class="nowrap">${action}</td>` : ""}</tr>`;
    });
  }
  const HEAD = ["เลข PI / ลูกค้า", "สินค้า", "กำหนดส่งคลัง", "สถานะ", "ผู้ออกใบ"];
  const sendConfirm = (_ctx, order) => `ส่งใบ ${order.id} ให้ฝ่ายวางแผน? ฝ่ายวางแผนจะคำนวณวัตถุดิบและปล่อยผลิต · หลังส่งแล้วยังแก้ใบได้ (ถ้ายังไม่มีแผนกไหนเริ่มงาน ใบจะกลับไปให้ฝ่ายวางแผนปล่อยผลิตใหม่)`;

  // ---------- งานของฉัน ----------
  function workView(ctx) {
    const { ui } = ctx;
    const mine = salesOrders(ctx).sort(newestFirst);
    const drafts = mine.filter((order) => isUnsent(ctx, order));
    const requests = (ctx.data.orderRequests ?? []).filter((row) => mine.some((order) => order.id === row.orderId))
      .filter((row) => row.status === "open" || ctx.now - (Number(row.decidedAt) || 0) < 14 * DAY).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (Number(b.requestedAt) || 0) - (Number(a.requestedAt) || 0));
    const soon = mine.filter((order) => !["completed", "cancelled"].includes(order.status) && !isUnsent(ctx, order) && Number(order.whDue) < ctx.now + 7 * DAY).sort((a, b) => a.whDue - b.whDue);
    const sections = [];
    if (drafts.length) sections.push(ui.card(ui.table([...HEAD, ""], orderRows(ctx, drafts, { send: true })), { title: esc(`ใบร่างที่ยังไม่ส่งให้ฝ่ายวางแผน (${drafts.length})`), flush: true }));
    if (requests.length) sections.push(ui.card(ui.table(["ใบ", "คำขอ", "เหตุผล", "ผลจากฝ่ายวางแผน"], requests.map((row) => requestRow(ctx, row)), { emptyText: "" }), { title: esc("คำขอของฝ่ายขายและผลจากฝ่ายวางแผน"), flush: true }));
    if (soon.length) sections.push(ui.card(ui.table(HEAD, orderRows(ctx, soon, { send: null })), { title: esc(`ใบใกล้ถึงกำหนดส่งคลัง (ภายใน 7 วัน หรือเลยกำหนด · ${soon.length})`), flush: true }));
    const body = sections.length ? sections.join("") : ui.card(ui.empty("ไม่มีงานค้าง ออกใบสั่งผลิตใหม่ได้ที่เมนู ออกใบสั่งผลิต", ui.link("ออกใบสั่งผลิต", saUrl({ tab: "new" }), "btn rf-btn")));
    return `${F.viewHead(ctx, ctx.helpers.canOrder(ctx.user) ? ui.link("ออกใบสั่งผลิต", saUrl({ tab: "new" }), "btn rf-btn") : "")}${body}`;
  }
  // แถวคำขอ: ผลของฝ่ายวางแผนอยู่ท้ายแถว (รอตัดสิน / ยืนยัน / ไม่ทำ + หมายเหตุ)
  function requestRow(ctx, row) {
    const { ui, rules } = ctx;
    const outcome = row.status === "open" ? ui.badge("warn", "รอฝ่ายวางแผนตัดสิน")
      : row.status === "declined" ? `${ui.badge("bad", row.kind === "cancel" ? "ไม่ยกเลิก" : "ไม่แก้ใบ")}<div class="small muted">${esc(`${row.decidedBy ?? ""} ${rules.fmtDate(row.decidedAt)}${row.decisionNote ? ` — ${row.decisionNote}` : ""}`)}</div>`
        : `${ui.badge("good", row.kind === "cancel" ? "ยกเลิกแล้ว" : "แก้ใบแล้ว")}<div class="small muted">${esc(`${row.decidedBy ?? ""} ${rules.fmtDate(row.decidedAt)}${row.decisionNote ? ` — ${row.decisionNote}` : ""}`)}</div>`;
    return `<tr><td>${ui.link(row.orderId, saUrl({ order: row.orderId }), "rf-mono")}</td><td>${esc(KIND_TEXT[row.kind] ?? row.kind)}<div class="small muted">${esc(`${row.requestedBy ?? ""} ${rules.fmtDate(row.requestedAt)}`)}</div></td><td class="small">${esc(row.reason)}</td><td>${outcome}</td></tr>`;
  }

  // ---------- ออกใบสั่งผลิต ----------
  // สินค้าที่เลือกได้ = สินค้าสำเร็จรูปที่มีรหัสแล้วและมี BOM (ฝ่ายขายสร้างรุ่นสินค้าใหม่ไม่ได้) · ค้นหาในช่องเลือก (searchable select) ได้เป็นร้อยรหัส
  function fgOptions(ctx) {
    const { data, helpers } = ctx;
    return data.items.filter((item) => item.kind === "FG" && item.active !== false && helpers.approvedBomOf(data, item.code))
      .sort((a, b) => a.code.localeCompare(b.code)).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  }
  const customerDatalist = (ctx) => `<datalist id="sa-customer-list">${shared().customersOf(ctx).map((customer) => `<option value="${attr(customer.name)}">${esc(customer.country)}</option>`).join("")}</datalist>`;
  function lineRow(ctx, options, index) {
    const { ui } = ctx;
    return `<div class="sa-line rf-grid" data-sa-line><div class="sa-line-product">${ui.field(index === 0 ? "สินค้า" : "", ui.select("fgCode", options, { placeholder: "เลือกสินค้า…", extra: 'data-sa-fg aria-label="สินค้า"' }), { required: index === 0 })}</div><div>${ui.field(index === 0 ? "จำนวน" : "", ui.input("qty", { type: "number", step: "any", min: 1, placeholder: "จำนวน", extra: 'data-sa-qty aria-label="จำนวน"' }), { required: index === 0 })}</div><div>${ui.field(index === 0 ? "หมายเหตุสินค้า" : "", ui.input("lineNote", { placeholder: "ไม่บังคับ", extra: 'maxlength="120" data-sa-line-note aria-label="หมายเหตุสินค้า"' }))}</div><div class="sa-line-remove">${index === 0 ? "" : `<button class="btn rf-btn secondary small" type="button" data-sa-line-remove aria-label="ลบสินค้าบรรทัดนี้">ลบ</button>`}</div></div>`;
  }
  function newView(ctx) {
    const { ui, rules } = ctx;
    if (!ctx.helpers.canOrder(ctx.user)) return `${F.viewHead(ctx)}${ui.card(ui.empty("บัญชีนี้ออกใบสั่งผลิตไม่ได้"))}`;
    const options = fgOptions(ctx);
    const today = rules.toInputDate(ctx.now);
    const empty = options.length ? "" : ui.callout("warn", "ยังไม่มีสินค้าสำเร็จรูปที่มี BOM ในทะเบียน ให้ฝ่ายวางแผนสร้างหรือนำเข้า BOM ก่อน");
    const form = `<form novalidate id="sa-order-form" data-sa-form>
      ${empty}
      <div class="rf-grid rf-g2">
        ${ui.field("ชื่อลูกค้า", `${ui.input("customer", { required: true, list: "sa-customer-list", extra: 'data-sa-customer maxlength="120" title="เลือกจากทะเบียนลูกค้า หรือพิมพ์ชื่อใหม่ ระบบเพิ่มเข้าทะเบียนให้"' })}${customerDatalist(ctx)}`, { required: true })}
        ${ui.field("ประเทศ", ui.input("country", { required: true, value: "Thailand", extra: "data-sa-country" }), { required: true })}
        ${ui.field("ประเภทออร์เดอร์", ui.select("orderType", [{ value: "SA", label: "ในประเทศ (SA)" }, { value: "EX", label: "ต่างประเทศ (EX)" }], { value: "SA", extra: "data-sa-ordertype" }), { required: true })}
        ${ui.field("เลขที่ PI", ui.input("pi", { placeholder: `ว่าง = ออกเลขอัตโนมัติ เช่น ${rules.piNumber(ctx.now, 1)}`, extra: 'maxlength="40"' }))}
        ${ui.field("วันที่สั่งผลิต", ui.input("orderedAt", { type: "date", required: true, value: today }), { required: true })}
        ${ui.field("กำหนดส่งคลัง (WH)", ui.input("whDue", { type: "date", required: true }), { required: true })}
      </div>
      <fieldset class="bom-fieldset"><legend>สินค้าที่สั่ง</legend>
        <div data-sa-lines>${lineRow(ctx, options, 0)}</div>
        <template data-sa-line-template>${lineRow(ctx, options, 1)}</template>
        <div class="rf-row"><button class="btn rf-btn secondary" type="button" data-sa-line-add>เพิ่มสินค้า</button></div>
      </fieldset>
      ${ui.field("หมายเหตุ", ui.input("note", { extra: 'maxlength="300"' }))}
      <div class="rf-row"><button class="btn rf-btn secondary" type="submit" data-sa-send="0">บันทึกร่าง</button><button class="btn rf-btn" type="submit" data-sa-send="1">ส่งให้ฝ่ายวางแผน</button></div>
    </form>`;
    return `${F.viewHead(ctx)}${ui.card(form)}`;
  }
  // ผูกฟอร์มออกใบ: ประเภทเดาจากประเทศ · เลือกลูกค้าเดิมเติมประเทศและประเภท · เพิ่ม/ลบบรรทัดสินค้า · ส่งผ่าน createOrder (บันทึกร่างหรือส่งให้ฝ่ายวางแผนในคำสั่งเดียว)
  function bindNew(node, ctx) {
    const form = node.querySelector("[data-sa-form]");
    if (!form) return;
    const { ui, rules } = ctx;
    const countryInput = form.querySelector("[data-sa-country]");
    const typeSelect = form.querySelector("[data-sa-ordertype]");
    let typeChosen = false;
    typeSelect?.addEventListener("change", () => { typeChosen = true; });
    countryInput?.addEventListener("input", () => { if (typeSelect && !typeChosen) typeSelect.value = rules.orderTypeOf(countryInput.value); });
    form.querySelector("[data-sa-customer]")?.addEventListener("change", (event) => {
      const known = shared().customersOf(ctx).find((customer) => ctx.helpers.customerKey(customer.name) === ctx.helpers.customerKey(event.target.value));
      if (!known) return;
      if (countryInput) countryInput.value = known.country;
      if (typeSelect) { typeSelect.value = known.orderType; typeChosen = true; }
    });
    const lines = form.querySelector("[data-sa-lines]");
    form.querySelector("[data-sa-line-add]")?.addEventListener("click", () => {
      const template = form.querySelector("[data-sa-line-template]");
      if (!template || !lines) return;
      lines.insertAdjacentHTML("beforeend", template.innerHTML);
      lines.lastElementChild?.querySelector("input, select")?.focus?.();
    });
    form.addEventListener("click", (event) => { event.target.closest?.("[data-sa-line-remove]")?.closest("[data-sa-line]")?.remove(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ui.validateForm(form)) return;
      const send = event.submitter?.dataset?.saSend === "1";
      const picked = [...form.querySelectorAll("[data-sa-line]")].map((row) => ({ fgCode: row.querySelector("[data-sa-fg]")?.value ?? "", qty: row.querySelector("[data-sa-qty]")?.value ?? "", note: row.querySelector("[data-sa-line-note]")?.value ?? "" })).filter((line) => line.fgCode || String(line.qty).trim());
      if (!picked.length || picked.some((line) => !line.fgCode || !(Number(line.qty) > 0))) { showToast("เลือกสินค้าและระบุจำนวนให้ครบทุกบรรทัด (อย่างน้อย 1 รายการ)", "error"); return; }
      if (new Set(picked.map((line) => line.fgCode)).size !== picked.length) { showToast("มีสินค้ารหัสเดียวกันซ้ำในใบ รวมเป็นบรรทัดเดียว", "error"); return; }
      const value = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
      if (send && !(await confirmDialog({ title: "ส่งใบให้ฝ่ายวางแผน?", message: "ฝ่ายวางแผนจะคำนวณวัตถุดิบและปล่อยผลิต หลังส่งแล้วยังแก้ใบได้", confirmLabel: "ส่งให้ฝ่ายวางแผน" }))) return;
      const payload = { pi: value("pi"), customer: value("customer"), country: value("country"), orderType: value("orderType"), orderedAt: rules.fromInputDate(value("orderedAt")), whDue: rules.fromInputDate(value("whDue")), note: value("note"), lines: picked, send };
      const ok = ctx.runAction("createOrder", payload, send ? "ส่งใบ {result} ให้ฝ่ายวางแผนแล้ว" : "บันทึกร่างใบ {result} แล้ว", (id) => { if (id) location.hash = saUrl({ order: id }); });
      if (ok) form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    });
  }

  // ---------- รายการใบของฝ่ายขาย ----------
  function ordersView(ctx) {
    const { ui } = ctx;
    const st = STATUS_FILTERS.some(([id]) => id === ctx.params.get("st")) ? ctx.params.get("st") ?? "" : "";
    const list = salesOrders(ctx).filter((order) => (!st || statusKey(ctx, order) === st) && F.includesText(`${order.id} ${order.customer} ${order.createdBy ?? ""} ${(order.items ?? []).map((item) => item.fgCode).join(" ")}`, ctx.q)).sort(newestFirst);
    const { shown, more } = F.limited(ctx, list);
    const filter = `<label class="sr-only" for="sa-status">สถานะ</label>${ui.select("st", STATUS_FILTERS.map(([value, label]) => ({ value, label })), { value: st, id: "sa-status", extra: "data-sa-filter" })}`;
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหาเลข PI ลูกค้า ผู้ออกใบ หรือรหัสสินค้า")}${filter}</div>`;
    return `${F.viewHead(ctx, ctx.helpers.canOrder(ctx.user) ? ui.link("ออกใบสั่งผลิต", saUrl({ tab: "new" }), "btn rf-btn") : "")}${toolbar}${ui.card(ui.table(HEAD, orderRows(ctx, shown, { send: null }), { emptyText: ctx.q || st ? "ไม่พบใบสั่งผลิต" : "ยังไม่มีใบสั่งผลิตของฝ่ายขาย" }), { flush: true })}${more}`;
  }

  // ---------- หน้าใบ (ติดตามความคืบหน้า + คำสั่งตามกติกา) ----------
  function orderMissing(ctx, text) {
    return { html: `${backLink(saUrl({ tab: "orders" }), "‹ ใบของฝ่ายขาย")}${F.pageHead(ctx, "ไม่พบใบ")}${ctx.ui.card(ctx.ui.empty(text))}`, actions: true };
  }
  const requestLines = (ctx, order) => requestsOf(ctx, order.id).map((row) => {
    const { ui, rules } = ctx;
    const tone = row.status === "open" ? "warn" : row.status === "declined" ? "bad" : "good";
    const result = row.status === "open" ? "รอฝ่ายวางแผนตัดสิน" : `${row.status === "declined" ? (row.kind === "cancel" ? "ฝ่ายวางแผนไม่ยกเลิก" : "ฝ่ายวางแผนไม่แก้ใบ") : (row.kind === "cancel" ? "ฝ่ายวางแผนยืนยันยกเลิกแล้ว" : "ฝ่ายวางแผนแก้ใบตามคำขอแล้ว")} · ${row.decidedBy ?? ""} ${rules.fmtDate(row.decidedAt)}${row.decisionNote ? ` — ${row.decisionNote}` : ""}`;
    return ui.callout(tone, `<strong>${esc(KIND_TEXT[row.kind] ?? row.kind)}</strong> · ${esc(`${row.requestedBy ?? ""} ${rules.fmtDate(row.requestedAt)}`)}<br>${esc(row.reason)}<br><span class="small muted">${esc(result)}</span>`);
  }).join("");
  function trackingCards(ctx, order) {
    const { ui, rules, data, helpers } = ctx;
    if (order.status === "draft") return ui.card(ui.empty(ctx.helpers.isSentOrder(order) ? "ส่งให้ฝ่ายวางแผนแล้ว รอปล่อยผลิต ยังไม่มีงานรายแผนก" : "ใบร่าง ยังไม่ส่งให้ฝ่ายวางแผน"), { title: esc("ความคืบหน้ารายแผนก") });
    if (order.status === "cancelled") return "";
    const flow = (dept) => { const at = rules.FLOW_DEPTS.indexOf(dept); return at === -1 ? 99 : at; };
    const jobs = data.jobs.filter((job) => job.orderId === order.id && !helpers.isPartJob(job)).sort((a, b) => flow(a.dept) - flow(b.dept) || a.id.localeCompare(b.id));
    const rows = jobs.map((job) => {
      const [tone, label] = { done: ["good", "เสร็จ"], in_progress: ["info", "กำลังทำ"], hold: ["warn", "พักงาน"], queued: ["", "รอคิว"] }[job.status] ?? ["", job.status];
      return `<tr><td>${F.deptChip(job.dept, rules.DEPT_LABEL)}</td><td>${ui.mono(job.itemCode)}<div class="small muted">${esc(job.name)}</div></td><td class="right rf-mono nowrap">${esc(`${rules.fmtQty(job.qtyDone)} / ${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`)}</td><td class="rf-progress-cell">${ui.progress(job.qtyDone, job.qtyPlanned)}</td><td>${ui.badge(tone, label)}</td></tr>`;
    });
    const tracking = ui.card(ui.table(["แผนก", "งาน", { label: "ทำแล้ว / แผน", className: "right" }, "ความคืบหน้า", "สถานะ"], rows, { emptyText: "ใบนี้ไม่มีงานผลิต (ใช้สต็อกสินค้าสำเร็จรูป)" }), { title: esc("ความคืบหน้ารายแผนก"), flush: true });
    const position = rules.fgPosition(data, order);
    const wh = ui.card(ui.table(["สินค้า", { label: "สั่ง", className: "right" }, { label: "WH รับแล้ว", className: "right" }, { label: "ส่งมอบแล้ว", className: "right" }], position.products.map((product) => `<tr><td>${ui.mono(product.fgCode)}</td><td class="right rf-mono">${esc(rules.fmtQty(product.ordered))}</td><td class="right rf-mono">${esc(rules.fmtQty(product.have))}</td><td class="right rf-mono">${esc(rules.fmtQty(product.delivered))}</td></tr>`)), { title: esc("คลังสินค้า (WH): รับเข้าและส่งมอบ"), flush: true });
    return `${tracking}${wh}`;
  }
  function orderView(ctx, orderId) {
    const { ui, rules, helpers, user } = ctx;
    const order = ctx.data.orders.find((row) => row.id === orderId);
    if (!order) return orderMissing(ctx, "ไม่พบใบสั่งผลิตนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)");
    if (helpers.orderSource(order) !== "SA") return orderMissing(ctx, "ใบนี้เป็นของฝ่ายวางแผน ดูได้ที่โมดูลฝ่ายวางแผน (PP)");
    const state = shared().orderEditState(ctx, order);
    const open = ["released", "in_progress"].includes(order.status);
    const mayEdit = helpers.canOrder(user) && state.canEdit;
    const seller = helpers.canSell(user);
    const buttons = [];
    if (seller && isUnsent(ctx, order)) buttons.push(ui.button("ส่งให้ฝ่ายวางแผน", { action: "sendOrderToPlanning", args: { orderId: order.id }, className: "", confirmText: sendConfirm(ctx, order), ariaLabel: "ส่งให้ฝ่ายวางแผน" }));
    if (mayEdit) buttons.push(ui.openButton("แก้หัวใบ", "saOrderHeader", { orderId: order.id }), ui.openButton("เพิ่มสินค้า", "saItemAdd", { orderId: order.id }));
    if (helpers.canOrder(user) && order.status === "draft" && !state.fgLock.blocked) buttons.push(ui.openButton("ยกเลิกใบ", "orderCancel", { orderId: order.id }));
    if (seller && open && !helpers.openOrderRequest(ctx.data, order.id, "cancel")) buttons.push(ui.openButton("ขอยกเลิก", "saRequest", { orderId: order.id, kind: "cancel" }));
    if (seller && open && !helpers.openOrderRequest(ctx.data, order.id, "change")) buttons.push(ui.openButton("ขอแก้ใบ", "saRequest", { orderId: order.id, kind: "change" }));
    const facts = ui.kv([
      ["ลูกค้า", esc(order.customer)], ["ประเทศ / ประเภท", `${esc(order.country)} ${shared().status(ctx, order.orderType)}`], ["ผู้ออกใบ", esc(order.createdBy ?? "")],
      ["วันที่สั่งผลิต", esc(rules.fmtDate(order.orderedAt))], ["กำหนดส่งคลัง (WH)", `<span${dueLate(ctx, order) ? ' class="bom-job-late"' : ""}>${esc(rules.fmtDate(order.whDue))}</span>`],
      ["ส่งให้ฝ่ายวางแผน", helpers.isSentOrder(order) ? esc(`${rules.fmtDateTime(order.sentAt)}${order.sentBy ? ` โดย ${order.sentBy}` : ""}`) : "ยังไม่ส่ง"],
      order.note ? ["หมายเหตุ", esc(order.note)] : null, order.cancelReason ? ["เหตุผลยกเลิก", esc(order.cancelReason)] : null,
    ]);
    // ข้อมูล RubberFlow ยังโหลดอยู่ (หน้าวาดใหม่เมื่อโหลดเสร็จ) หรือโหลดไม่สำเร็จ: ยังรู้ไม่ได้ว่างานยาง (RB) เริ่มแล้วหรือยัง จึงไม่บอกว่าแผนกเริ่มงานแล้ว
    const pendingText = { loading: "กำลังโหลดข้อมูล RubberFlow เพื่อตรวจว่างานยาง (RB) เริ่มแล้วหรือยัง ปุ่มแก้ใบจะแสดงเมื่อโหลดเสร็จ", failed: "โหลดข้อมูล RubberFlow ไม่สำเร็จ จึงยังตรวจไม่ได้ว่างานยาง (RB) เริ่มแล้วหรือยัง โหลดหน้าใหม่อีกครั้ง หรือส่ง “ขอแก้ใบ” ให้ฝ่ายวางแผน" }[state.rfPending] ?? "";
    const hint = state.reopen ? `<p class="small muted">${esc("ใบนี้ปล่อยผลิตแล้ว ยังไม่มีแผนกไหนเริ่มงาน แก้ได้ แต่ใบจะกลับไปให้ฝ่ายวางแผนปล่อยผลิตใหม่")}</p>`
      : pendingText ? `<p class="small muted" role="status">${esc(pendingText)}</p>`
        : open && !state.canEdit ? `<p class="small muted">${esc("แผนกเริ่มงานแล้ว แก้ใบโดยตรงไม่ได้ ส่ง “ขอแก้ใบ” ให้ฝ่ายวางแผนแทน")}</p>` : "";
    const itemRows = order.items.map((item) => `<tr><td>${ui.mono(item.fgCode)}<div class="small muted">${esc(helpers.itemOf(ctx.data, item.fgCode)?.name ?? "")}${item.note ? ` · ${esc(item.note)}` : ""}</div></td><td class="right rf-mono">${esc(rules.fmtQty(item.qty))}</td><td class="nowrap">${mayEdit ? `${ui.openButton("แก้จำนวน", "orderItemEdit", { orderId: order.id, fgCode: item.fgCode }, { className: "secondary small", ariaLabel: `แก้จำนวน ${item.fgCode}` })} ${ui.button("ลบ", { action: "removeOrderItem", args: { orderId: order.id, fgCode: item.fgCode }, className: "secondary small", ariaLabel: `ลบ ${item.fgCode} ออกจากใบ`, confirmText: `ลบ ${item.fgCode} ออกจากใบ ${order.id}?${state.reopenNote}` })}` : ""}</td></tr>`);
    const items = ui.card(ui.table(["สินค้า", { label: "จำนวน", className: "right" }, ""], itemRows, { emptyText: "ยังไม่มีสินค้า เพิ่มสินค้าก่อนส่งให้ฝ่ายวางแผน" }), { title: esc("สินค้าที่สั่ง"), flush: true });
    const head = F.pageHead(ctx, `ใบ ${order.id}`, `${statusBadge(ctx, order)}<span class="small muted" role="status" data-bom-sync>${esc(root.MNP_BOM?.syncText?.() ?? "")}</span>`);
    return { html: `${backLink(saUrl({ tab: "orders" }), "‹ ใบของฝ่ายขาย")}${head}${ui.card(`${facts}${buttons.length ? `<div class="rf-row">${buttons.join("")}</div>` : ""}${hint}`)}${requestLines(ctx, order)}${items}${trackingCards(ctx, order)}`, actions: true };
  }

  // ---------- dialog ----------
  const orderOf = (ctx, orderId) => ctx.data.orders.find((row) => row.id === orderId && ctx.helpers.orderSource(row) === "SA");
  const reopenCallout = (ctx, state) => (state.reopen ? ctx.ui.callout("warn", esc(state.reopenNote.trim())) : "");
  dialogs.saOrderHeader = (ctx, { orderId }) => {
    const { ui, rules } = ctx;
    const order = orderOf(ctx, orderId);
    if (!order) return null;
    const state = shared().orderEditState(ctx, order);
    if (!state.canEdit || !ctx.helpers.canOrder(ctx.user)) return null;
    const body = `<form novalidate id="sa-header-form" data-rf-form="updateOrderHeader" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="แก้หัวใบ ${attr(orderId)} แล้ว">
      ${reopenCallout(ctx, state)}
      <div class="rf-grid rf-g2">
        ${ui.field("ชื่อลูกค้า", `${ui.input("customer", { required: true, value: order.customer, list: "sa-customer-list", extra: 'maxlength="120"' })}${customerDatalist(ctx)}`, { required: true })}
        ${ui.field("ประเทศ", ui.input("country", { required: true, value: order.country }), { required: true })}
        ${ui.field("ประเภทออร์เดอร์", ui.select("orderType", [{ value: "SA", label: "ในประเทศ (SA)" }, { value: "EX", label: "ต่างประเทศ (EX)" }], { value: order.orderType }), { required: true })}
        ${ui.field("กำหนดส่งคลัง (WH)", ui.input("whDue", { type: "date", required: true, value: rules.toInputDate(order.whDue) }), { required: true })}
      </div>
      ${ui.field("หมายเหตุ", ui.input("note", { value: order.note ?? "", extra: 'maxlength="300"' }))}
    </form>`;
    return { html: ui.dialog("saOrderHeader", `แก้หัวใบ ${order.id}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="sa-header-form">บันทึก</button>` }) };
  };
  dialogs.saItemAdd = (ctx, { orderId }) => {
    const { ui } = ctx;
    const order = orderOf(ctx, orderId);
    if (!order) return null;
    const state = shared().orderEditState(ctx, order);
    if (!state.canEdit || !ctx.helpers.canOrder(ctx.user)) return null;
    const taken = new Set(order.items.map((item) => item.fgCode));
    const body = `<form novalidate id="sa-item-form" data-rf-form="addOrderItem" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="เพิ่มสินค้าในใบ ${attr(orderId)} แล้ว">
      ${reopenCallout(ctx, state)}
      <div class="rf-grid rf-g2">
        ${ui.field("สินค้า", ui.select("fgCode", fgOptions(ctx).filter((option) => !taken.has(option.value)), { placeholder: "เลือกสินค้า…" }), { required: true })}
        ${ui.field("จำนวน", ui.input("qty", { type: "number", step: "any", min: 1, required: true }), { required: true })}
      </div>
      ${ui.field("หมายเหตุสินค้า", ui.input("note", { extra: 'maxlength="120"' }))}
    </form>`;
    return { html: ui.dialog("saItemAdd", `เพิ่มสินค้าในใบ ${order.id}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="sa-item-form">เพิ่มสินค้า</button>` }) };
  };
  // ขอยกเลิก / ขอแก้ใบหลังปล่อยผลิต: เหตุผลอย่างน้อย 3 ตัวอักษร (ฝ่ายวางแผนตัดสิน)
  dialogs.saRequest = (ctx, { orderId, kind }) => {
    const { ui, helpers } = ctx;
    const order = orderOf(ctx, orderId);
    if (!order || !["cancel", "change"].includes(kind) || !helpers.canSell(ctx.user) || !["released", "in_progress"].includes(order.status) || helpers.openOrderRequest(ctx.data, order.id, kind)) return null;
    const cancel = kind === "cancel";
    const max = helpers.ORDER_REQUEST_REASON_MAX?.[kind] ?? 200;
    const body = `<form novalidate id="sa-request-form" data-rf-form="${cancel ? "requestOrderCancel" : "requestOrderChange"}" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="ส่ง${cancel ? "คำขอยกเลิก" : "คำขอแก้ใบ"} ${attr(orderId)} ให้ฝ่ายวางแผนแล้ว">
      ${ui.callout("info", esc(cancel ? "ใบปล่อยผลิตแล้ว ฝ่ายวางแผนเป็นผู้ยกเลิกให้เมื่อยืนยันคำขอนี้ งานทุกแผนกหยุดเมื่อยกเลิก" : "ใบปล่อยผลิตแล้วและมีแผนกเริ่มงานแล้ว ฝ่ายวางแผนแก้ใบให้ตามที่ขอ"))}
      ${ui.field(cancel ? "เหตุผลที่ขอยกเลิก" : "สิ่งที่ต้องการแก้", `<textarea class="textarea rf-textarea" name="reason" rows="3" required minlength="3" maxlength="${max}" placeholder="${attr(cancel ? "เช่น ลูกค้ายกเลิกคำสั่งซื้อ" : "เช่น เพิ่มจำนวน PK-1001 เป็น 500 ชิ้น")}"></textarea>`, { required: true })}
    </form>`;
    return { html: ui.dialog("saRequest", `${cancel ? "ขอยกเลิกใบ" : "ขอแก้ใบ"} ${order.id}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="sa-request-form">ส่งคำขอ</button>` }) };
  };
  // ฝ่ายวางแผนไม่ยกเลิก / ไม่แก้ตามคำขอ: ต้องมีหมายเหตุ (ฝ่ายขายเห็นในหน้าใบและงานของฉัน)
  dialogs.saRequestDecline = (ctx, { requestId }) => {
    const { ui, helpers } = ctx;
    const row = (ctx.data.orderRequests ?? []).find((entry) => entry.id === requestId && entry.status === "open");
    if (!row || !helpers.canPlanOrders(ctx.user)) return null;
    const cancel = row.kind === "cancel";
    const body = `<form novalidate id="sa-decline-form" data-rf-form="decideOrderRequest" data-rf-args="${attr(JSON.stringify({ requestId, decision: "decline" }))}" data-rf-success="${cancel ? "ไม่ยกเลิกใบตามคำขอ" : "ไม่แก้ใบตามคำขอ"}แล้ว">
      <p class="small muted">${esc(`${KIND_TEXT[row.kind]} ${row.orderId}: ${row.reason}`)}</p>
      ${ui.field(cancel ? "เหตุผลที่ไม่ยกเลิก" : "เหตุผลที่ไม่แก้ใบ", `<textarea class="textarea rf-textarea" name="note" rows="3" required minlength="3" maxlength="${helpers.DECISION_NOTE_MAX ?? 200}"></textarea>`, { required: true })}
    </form>`;
    return { html: ui.dialog("saRequestDecline", cancel ? `ไม่ยกเลิกใบ ${row.orderId}` : `ไม่แก้ใบ ${row.orderId}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="sa-decline-form">${cancel ? "ไม่ยกเลิก" : "ไม่แก้ใบ"}</button>` }) };
  };

  // ---------- การ์ดของฝ่ายวางแผน (วางที่หน้าแรกและหน้าใบสั่งผลิตของ #/pp) ----------
  // options.orderId = เฉพาะคำขอของใบนั้น (หน้าใบ) · ไม่ให้ = ใบใหม่จากฝ่ายขาย + คำขอทั้งหมดที่ยังไม่ตัดสิน · ไม่มีอะไร = ว่าง
  function planningCards(ctx, { orderId = "" } = {}) {
    const { ui, rules, helpers } = ctx;
    const cards = [];
    if (!orderId) {
      const fresh = ctx.data.orders.filter((order) => helpers.orderSource(order) === "SA" && order.status === "draft" && helpers.isSentOrder(order)).sort((a, b) => (Number(b.sentAt) || 0) - (Number(a.sentAt) || 0));
      if (fresh.length) {
        const rows = fresh.map((order) => `<tr><td>${ui.link(order.id, ctx.url("orders", { sel: order.id }), "rf-mono")}<div class="small muted">${esc(order.customer)}</div></td><td class="small">${esc(itemsText(ctx, order).slice(0, 80))}</td><td class="nowrap">${esc(rules.fmtDate(order.whDue))}</td><td class="small muted">${esc(`${order.createdBy ?? ""} · ส่ง ${rules.fmtDateTime(order.sentAt)}`)}</td></tr>`);
        cards.push(ui.card(ui.table(["เลข PI / ลูกค้า", "สินค้า", "กำหนดส่งคลัง", "ฝ่ายขาย"], rows), { title: esc(`ใบใหม่จากฝ่ายขาย (${fresh.length})`), flush: true }));
      }
    }
    // ใบที่ยกเลิกแล้วไม่มีอะไรให้ตัดสิน (ฐานข้อมูลปิดคำขอของใบที่ยกเลิกเอง · กันข้อมูลค้างจากก่อนกติกานี้หรือคำตอบที่ยังไม่มาถึง)
    const cancelled = new Set(ctx.data.orders.filter((order) => order.status === "cancelled").map((order) => order.id));
    const open = (ctx.data.orderRequests ?? []).filter((row) => row.status === "open" && !cancelled.has(row.orderId) && (!orderId || row.orderId === orderId));
    if (open.length) {
      const items = open.sort((a, b) => (Number(a.requestedAt) || 0) - (Number(b.requestedAt) || 0)).map((row) => {
        const cancel = row.kind === "cancel";
        const orderLink = orderId ? "" : `${ui.link(row.orderId, ctx.url("orders", { sel: row.orderId }), "rf-mono")} · `;
        const decide = cancel
          ? `${ui.button("ยืนยันยกเลิก", { action: "decideOrderRequest", args: { requestId: row.id, decision: "confirm" }, className: "small", confirmText: `ยืนยันยกเลิกใบ ${row.orderId} ตามคำขอของฝ่ายขาย? ใบจะถูกยกเลิกด้วยเหตุผลที่ฝ่ายขายระบุ งานทุกแผนกหยุด`, ariaLabel: "ยกเลิกใบตามคำขอ" })}${ui.openButton("ไม่ยกเลิก", "saRequestDecline", { requestId: row.id }, { className: "secondary small" })}`
          : `${ui.button("แก้ใบตามคำขอแล้ว", { action: "decideOrderRequest", args: { requestId: row.id, decision: "done" }, className: "small", confirmText: `ปิดคำขอแก้ใบ ${row.orderId}? ยืนยันว่าแก้ใบตามที่ฝ่ายขายขอครบแล้ว`, ariaLabel: "ปิดคำขอแก้ใบ" })}${ui.openButton("ไม่แก้ใบ", "saRequestDecline", { requestId: row.id }, { className: "secondary small" })}`;
        return `<li class="bom-request"><div>${ui.badge(cancel ? "bad" : "warn", KIND_TEXT[row.kind])} ${orderLink}<span class="small muted">${esc(`${row.requestedBy ?? ""} ${rules.fmtDateTime(row.requestedAt)}`)}</span><p>${esc(row.reason)}</p></div><div class="rf-row">${decide}</div></li>`;
      }).join("");
      cards.push(ui.card(`<ul class="bom-request-list">${items}</ul>`, { title: esc(`คำขอจากฝ่ายขาย (${open.length})`) }));
    }
    return cards.join("");
  }

  // ---------- หน้าแรกของโมดูล ----------
  function bindPage(node, ctx) {
    node.querySelectorAll("[data-sa-filter]").forEach((select) => select.addEventListener("change", () => { location.hash = ctx.pageUrl({ [select.name]: select.value || null, n: null }); }));
    bindNew(node, ctx);
  }
  function landing(ctx) {
    const orderId = ctx.params.get("order");
    if (orderId) return { ...orderView(ctx, orderId), bind: bindPage };
    const id = ctx.view?.id;
    if (id === "new") return { html: newView(ctx), bind: bindPage, actions: true };
    if (id === "orders") return { html: ordersView(ctx), bind: bindPage, actions: true };
    if (id === "customers") {
      const view = shared().customersView(ctx);
      return { html: `${F.viewHead(ctx, `${F.searchForm(ctx, "ค้นหาชื่อลูกค้าหรือประเทศ…")}${view.add}`)}${view.body}`, bind: bindPage, actions: true };
    }
    return { html: workView(ctx), bind: bindPage, actions: true };
  }

  const MENU = Object.freeze([
    F.workItem(workCount),
    { id: "new", label: "ออกใบสั่งผลิต", icon: "document", params: { tab: "new" } },
    { id: "orders", label: "ใบของฝ่ายขาย", icon: "clipboard", params: { tab: "orders" }, owns: ["order"] },
    { id: "customers", label: "ทะเบียนลูกค้า", icon: "building", params: { tab: "customers" } },
  ]);

  root.MNP_SA_PAGES = Object.freeze({ landing, MENU, workCount, planningCards, statusKey, KEEP: Object.freeze(["st"]) });
})(window);
