// หน้าของโมดูลฝ่ายขาย (SA) #/sa — โรงงานขั้น 8 (20261226010000_bom_sales_orders.sql) โหมดทดสอบเท่านั้น · โหลดก่อน modules/module-sa.js (ดู index.html)
// ฝ่ายขายออกใบสั่งผลิตเอง (ที่มา SA) แล้วส่งให้ฝ่ายวางแผนคำนวณวัตถุดิบและปล่อยผลิต · ติดตามความคืบหน้ารายแผนกและยอดส่งมอบ · ทะเบียนลูกค้า
// รอบ 2 (เจ้าของ 2026-11-25): ฝ่ายขายแก้ / ยกเลิกใบเองได้ทุกขั้น ฝ่ายวางแผนแค่รับทราบ · เริ่มงานแล้ว = แก้ตรง (แจ้ง "ฝ่ายขายแก้ใบ") / ยกเลิกกลางทาง (ฝ่ายวางแผนเลือกผลิตต่อหรือหยุด)
// หน้า: งานของฉัน (ค่าตั้งต้น) · ออกใบสั่งผลิต ?tab=new · ใบของฝ่ายขาย ?tab=orders · ทะเบียนลูกค้า ?tab=customers · หน้าใบ ?order=<เลขใบ>
// คำสั่งใช้ action ของ BOM ชุดเดียวกัน (createOrder updateOrderHeader addOrderItem updateOrderItem removeOrderItem sendOrderToPlanning cancelOrder) — สิทธิ์จริงตัดสินที่ action และฐานข้อมูล ปุ่มที่ซ่อนเป็นแค่ UX
// ไฟล์นี้ยังมี planningCards: การ์ด "ใบใหม่จากฝ่ายขาย" และ "แจ้งจากฝ่ายขาย" ที่ฝ่ายวางแผนเห็นบนหน้าแรกและหน้าใบสั่งผลิตของ #/pp (ตัดสินด้วย decideOrderRequest)
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
  const noticesOf = (ctx, orderId) => ctx.helpers.orderRequestsOf(ctx.data, orderId).slice().sort((a, b) => (Number(b.requestedAt) || 0) - (Number(a.requestedAt) || 0));
  const orderOfNotice = (ctx, row) => ctx.data.orders.find((order) => order.id === row.orderId);
  // ชื่อการแจ้ง: แก้ใบ · ยกเลิกใบ (ยกเลิกทันที) · ยกเลิกใบกลางทาง (มีงานเริ่มแล้ว ฝ่ายวางแผนเลือกผลิตต่อหรือหยุด)
  const noticeTitle = (ctx, row) => (row.kind === "change" ? "ฝ่ายขายแก้ใบ" : ctx.helpers.noticeMode(ctx.data, row) === "choose" ? "ฝ่ายขายยกเลิกใบกลางทาง" : "ฝ่ายขายยกเลิกใบ");
  // ผลจากฝ่ายวางแผน (ฝ่ายขายเห็น): รอ → รับทราบ / ผลิตต่อจนจบส่ง WH / หยุด
  const DECIDED_TEXT = Object.freeze({ ack: "ฝ่ายวางแผนรับทราบแล้ว", continue: "ฝ่ายวางแผนเลือกผลิตต่อจนจบส่ง WH (ของเป็นสต็อก ไม่ส่งลูกค้า)", stop: "ฝ่ายวางแผนเลือกหยุด เก็บยางเส้นยาวที่ SR" });
  // การแจ้งแก้ใบที่ปิดเองเมื่อใบปิด (ระบบรับทราบ ไม่มีผู้ตัดสิน · 20261227010000) ใช้ข้อความเดียวกับการแจ้งที่ค้างของใบที่ปิดแล้ว ไม่แสดงชื่อผู้ที่ปิดใบ
  const CLOSED_WITH_ORDER = "ใบปิดแล้ว ไม่ต้องรอฝ่ายวางแผนรับทราบ";
  const noticeOutcome = (ctx, row) => (ctx.helpers.staleChangeNotice?.(ctx.data, row)
    ? { tone: "good", text: CLOSED_WITH_ORDER, by: "" }
    : row.status === "done" && row.decision === "ack" && !String(row.decidedBy ?? "").trim()
    ? { tone: "good", text: CLOSED_WITH_ORDER, by: ctx.rules.fmtDate(row.decidedAt) }
    : row.status === "open"
    ? { tone: "warn", text: ctx.helpers.noticeMode(ctx.data, row) === "choose" ? "รอฝ่ายวางแผนตัดสินของที่ทำค้าง" : "รอฝ่ายวางแผนรับทราบ", by: "" }
    : { tone: row.decision === "stop" ? "bad" : "good", text: DECIDED_TEXT[row.decision] ?? "ฝ่ายวางแผนรับทราบแล้ว", by: `${row.decidedBy ?? ""} ${ctx.rules.fmtDate(row.decidedAt)}` });
  const workCount = (ctx) => salesOrders(ctx).filter((order) => isUnsent(ctx, order)).length;

  // สถานะที่ฝ่ายขายเห็น: ใบร่างที่ส่งแล้วรอฝ่ายวางแผนปล่อยผลิต (ฐานข้อมูลไม่มีสถานะแยก) แยกจากใบร่างที่ยังไม่ส่ง
  // ใบที่ฝ่ายขายยกเลิกกลางทาง: รอฝ่ายวางแผนตัดสิน / ผลิตต่อจนจบส่ง WH (สถานะของใบในฐานข้อมูลคงเดิม)
  const statusKey = (ctx, order) => {
    if (order.status === "draft") return ctx.helpers.isSentOrder(order) ? "waiting" : "unsent";
    const cancel = shared().salesCancelKey?.(order) ?? "";
    if (cancel === "pending" || cancel === "continue") return `sales_${cancel}`;
    return order.status;
  };
  const statusBadge = (ctx, order) => {
    const key = statusKey(ctx, order);
    if (key === "unsent") return ctx.ui.badge("", "ร่าง ยังไม่ส่ง");
    if (key === "waiting") return ctx.ui.badge("warn", "รอฝ่ายวางแผนปล่อยผลิต");
    if (key === "sales_pending") return ctx.ui.badge("bad", shared().SALES_CANCEL_STATE?.pending ?? "ยกเลิกแล้ว รอฝ่ายวางแผนตัดสินของที่ทำค้าง");
    if (key === "sales_continue") return ctx.ui.badge("warn", shared().SALES_CANCEL_STATE?.continue ?? "ยกเลิกแล้ว ผลิตต่อจนจบส่ง WH");
    return shared().orderStatus(ctx, order);
  };
  const STATUS_FILTERS = Object.freeze([["", "ทุกสถานะ"], ["unsent", "ร่าง ยังไม่ส่ง"], ["waiting", "รอฝ่ายวางแผนปล่อยผลิต"], ["released", "ปล่อยผลิต"], ["in_progress", "กำลังผลิต"],
    ["sales_pending", "ยกเลิกแล้ว รอฝ่ายวางแผนตัดสิน"], ["sales_continue", "ยกเลิกแล้ว ผลิตต่อจนจบ"], ["completed", "เสร็จสิ้น"], ["cancelled", "ยกเลิก"]]);

  const dueLate = (ctx, order) => !["completed", "cancelled"].includes(order.status) && !ctx.helpers.salesCancelled(order) && Number(order.whDue) < ctx.now;

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
  const sendConfirm = (_ctx, order) => `ส่งใบ ${order.id} ให้ฝ่ายวางแผน? ฝ่ายวางแผนจะคำนวณวัตถุดิบและปล่อยผลิต · หลังส่งแล้วยังแก้และยกเลิกใบได้ (ฝ่ายวางแผนได้รับแจ้ง)`;

  // ---------- งานของฉัน ----------
  function workView(ctx) {
    const { ui } = ctx;
    const mine = salesOrders(ctx).sort(newestFirst);
    const drafts = mine.filter((order) => isUnsent(ctx, order));
    const notices = (ctx.data.orderRequests ?? []).filter((row) => mine.some((order) => order.id === row.orderId))
      .filter((row) => (row.status === "open" && !ctx.helpers.staleChangeNotice?.(ctx.data, row)) || ctx.now - (Number(row.decidedAt) || 0) < 14 * DAY).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (Number(b.requestedAt) || 0) - (Number(a.requestedAt) || 0));
    const soon = mine.filter((order) => !["completed", "cancelled"].includes(order.status) && !ctx.helpers.salesCancelled(order) && !isUnsent(ctx, order) && Number(order.whDue) < ctx.now + 7 * DAY).sort((a, b) => a.whDue - b.whDue);
    const sections = [];
    if (drafts.length) sections.push(ui.card(ui.table([...HEAD, ""], orderRows(ctx, drafts, { send: true })), { title: esc(`ใบร่างที่ยังไม่ส่งให้ฝ่ายวางแผน (${drafts.length})`), flush: true }));
    if (notices.length) sections.push(ui.card(ui.table(["ใบ", "เรื่อง", "รายละเอียด", "ฝ่ายวางแผน"], notices.map((row) => noticeRow(ctx, row)), { emptyText: "" }), { title: esc("แจ้งฝ่ายวางแผนและผลการตัดสิน"), flush: true }));
    if (soon.length) sections.push(ui.card(ui.table(HEAD, orderRows(ctx, soon, { send: null })), { title: esc(`ใบใกล้ถึงกำหนดส่งคลัง (ภายใน 7 วัน หรือเลยกำหนด · ${soon.length})`), flush: true }));
    const body = sections.length ? sections.join("") : ui.card(ui.empty("ไม่มีงานค้าง ออกใบสั่งผลิตใหม่ได้ที่เมนู ออกใบสั่งผลิต", ui.link("ออกใบสั่งผลิต", saUrl({ tab: "new" }), "btn rf-btn")));
    return `${F.viewHead(ctx, ctx.helpers.canOrder(ctx.user) ? ui.link("ออกใบสั่งผลิต", saUrl({ tab: "new" }), "btn rf-btn") : "")}${body}`;
  }
  // แถวการแจ้ง: ผลของฝ่ายวางแผนอยู่ท้ายแถว (รอ / รับทราบ / ผลิตต่อ / หยุด + ผู้ตัดสิน)
  function noticeRow(ctx, row) {
    const { ui, rules } = ctx;
    const outcome = noticeOutcome(ctx, row);
    return `<tr><td>${ui.link(row.orderId, saUrl({ order: row.orderId }), "rf-mono")}</td><td>${esc(noticeTitle(ctx, row))}<div class="small muted">${esc(`${row.requestedBy ?? ""} ${rules.fmtDate(row.requestedAt)}`)}</div></td><td class="small">${esc(row.reason)}</td><td>${ui.badge(outcome.tone, outcome.text)}${outcome.by.trim() ? `<div class="small muted">${esc(outcome.by)}</div>` : ""}</td></tr>`;
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
      // ระหว่างรอฐานข้อมูลตอบกดซ้ำไม่ได้ · บันทึกไม่สำเร็จ = ปุ่มกดได้อีกโดยฟอร์มยังเก็บสิ่งที่กรอกไว้ (F.holdButtons / releasePending)
      if (ok) F.holdButtons(form.querySelectorAll("button"));
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
  // การแจ้งของใบนี้ (ใหม่สุดก่อน): ชื่อเรื่อง · ผู้แจ้ง · รายละเอียด · ผลจากฝ่ายวางแผน
  const noticeLines = (ctx, order) => noticesOf(ctx, order.id).map((row) => {
    const { ui, rules } = ctx;
    const outcome = noticeOutcome(ctx, row);
    return ui.callout(outcome.tone, `<strong>${esc(noticeTitle(ctx, row))}</strong> · ${esc(`${row.requestedBy ?? ""} ${rules.fmtDate(row.requestedAt)}`)}<br>${esc(row.reason)}<br><span class="small muted">${esc(`${outcome.text}${outcome.by.trim() ? ` · ${outcome.by}` : ""}`)}</span>`);
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
    const seller = helpers.canSell(user);
    const salesCancelled = helpers.salesCancelled(order);
    // แก้ใบ: ร่าง · ปล่อยแล้วยังไม่เริ่มงาน (กลับเป็นร่าง) · ฝ่ายขายแก้ใบที่เริ่มงานแล้วได้ตรง (ฝ่ายวางแผนได้รับแจ้ง)
    const inPlace = seller && helpers.salesOnly(user) && state.inPlace;
    const mayEdit = helpers.canOrder(user) && (state.canEdit || inPlace);
    const buttons = [];
    if (seller && isUnsent(ctx, order)) buttons.push(ui.button("ส่งให้ฝ่ายวางแผน", { action: "sendOrderToPlanning", args: { orderId: order.id }, className: "", confirmText: sendConfirm(ctx, order), ariaLabel: "ส่งให้ฝ่ายวางแผน" }));
    if (mayEdit) buttons.push(ui.openButton("แก้หัวใบ", "saOrderHeader", { orderId: order.id }), ui.openButton("เพิ่มสินค้า", "saItemAdd", { orderId: order.id }));
    // ยกเลิก: ฝ่ายขาย = ร่าง / ปล่อยแล้ว / กำลังผลิต (เริ่มงานแล้ว = ยกเลิกกลางทาง) · กลุ่มวางแผนยกเลิกร่างของฝ่ายขายที่หน้านี้ (หลังปล่อยยกเลิกที่หน้าใบของฝ่ายวางแผน)
    if (seller && helpers.salesOnly(user) && ["draft", "released", "in_progress"].includes(order.status) && !salesCancelled && !state.rfPending) buttons.push(ui.openButton("ยกเลิกใบ", "saCancel", { orderId: order.id }));
    else if (!helpers.salesOnly(user) && helpers.canOrder(user) && order.status === "draft" && !state.fgLock.blocked) buttons.push(ui.openButton("ยกเลิกใบ", "orderCancel", { orderId: order.id }));
    const facts = ui.kv([
      ["ลูกค้า", esc(order.customer)], ["ประเทศ / ประเภท", `${esc(order.country)} ${shared().status(ctx, order.orderType)}`], ["ผู้ออกใบ", esc(order.createdBy ?? "")],
      ["วันที่สั่งผลิต", esc(rules.fmtDate(order.orderedAt))], ["กำหนดส่งคลัง (WH)", `<span${dueLate(ctx, order) ? ' class="bom-job-late"' : ""}>${esc(rules.fmtDate(order.whDue))}</span>`],
      ["ส่งให้ฝ่ายวางแผน", helpers.isSentOrder(order) ? esc(`${rules.fmtDateTime(order.sentAt)}${order.sentBy ? ` โดย ${order.sentBy}` : ""}`) : "ยังไม่ส่ง"],
      order.note ? ["หมายเหตุ", esc(order.note)] : null,
      // เหตุผลยกเลิกแสดงครั้งเดียว: ยกเลิกกลางทางมีผู้ยกเลิกและเวลา (ใบที่ฝ่ายวางแผนเลือกหยุดใช้เหตุผลเดียวกัน)
      salesCancelled ? ["ฝ่ายขายยกเลิก", esc(`${order.salesCancelReason ?? ""} · ${order.salesCancelBy ?? ""} ${rules.fmtDateTime(order.salesCancelAt)}`)] : null,
      order.cancelReason && order.cancelReason !== order.salesCancelReason ? ["เหตุผลยกเลิก", esc(order.cancelReason)] : null,
    ]);
    // ข้อมูล RubberFlow ยังโหลดอยู่ (หน้าวาดใหม่เมื่อโหลดเสร็จ) หรือโหลดไม่สำเร็จ: ยังรู้ไม่ได้ว่างานยาง (RB) เริ่มแล้วหรือยัง จึงไม่บอกว่าแผนกเริ่มงานแล้ว
    const pendingText = { loading: "กำลังโหลดข้อมูล RubberFlow เพื่อตรวจว่างานยาง (RB) เริ่มแล้วหรือยัง ระหว่างนี้ยังแก้หรือยกเลิกใบไม่ได้", failed: "โหลดข้อมูล RubberFlow ไม่สำเร็จ จึงยังตรวจไม่ได้ว่างานยาง (RB) เริ่มแล้วหรือยัง โหลดหน้าใหม่อีกครั้ง" }[state.rfPending] ?? "";
    const hint = state.reopen && !salesCancelled ? `<p class="small muted">${esc("ใบนี้ปล่อยผลิตแล้ว ยังไม่มีแผนกไหนเริ่มงาน แก้ได้ แต่ใบจะกลับไปให้ฝ่ายวางแผนปล่อยผลิตใหม่")}</p>`
      : pendingText ? `<p class="small muted" role="status">${esc(pendingText)}</p>`
        : inPlace ? `<p class="small muted">${esc(shared().IN_PLACE_TEXT ?? "")}</p>` : "";
    const inPlaceNote = inPlace ? " ใบเปลี่ยนทันที ฝ่ายวางแผนได้รับแจ้ง" : "";
    const itemRows = order.items.map((item) => `<tr><td>${ui.mono(item.fgCode)}<div class="small muted">${esc(helpers.itemOf(ctx.data, item.fgCode)?.name ?? "")}${item.note ? ` · ${esc(item.note)}` : ""}</div></td><td class="right rf-mono">${esc(rules.fmtQty(item.qty))}</td><td class="nowrap">${mayEdit ? `${ui.openButton("แก้จำนวน", "orderItemEdit", { orderId: order.id, fgCode: item.fgCode }, { className: "secondary small", ariaLabel: `แก้จำนวน ${item.fgCode}` })} ${inPlace && order.items.length < 2 ? "" : ui.button("ลบ", { action: "removeOrderItem", args: { orderId: order.id, fgCode: item.fgCode }, className: "secondary small", ariaLabel: `ลบ ${item.fgCode} ออกจากใบ`, confirmText: `ลบ ${item.fgCode} ออกจากใบ ${order.id}?${state.reopenNote}${inPlaceNote}` })}` : ""}</td></tr>`);
    const items = ui.card(ui.table(["สินค้า", { label: "จำนวน", className: "right" }, ""], itemRows, { emptyText: "ยังไม่มีสินค้า เพิ่มสินค้าก่อนส่งให้ฝ่ายวางแผน" }), { title: esc("สินค้าที่สั่ง"), flush: true });
    const head = F.pageHead(ctx, `ใบ ${order.id}`, `${statusBadge(ctx, order)}<span class="small muted" role="status" data-bom-sync>${esc(root.MNP_BOM?.syncText?.() ?? "")}</span>`);
    return { html: `${backLink(saUrl({ tab: "orders" }), "‹ ใบของฝ่ายขาย")}${head}${ui.card(`${facts}${buttons.length ? `<div class="rf-row">${buttons.join("")}</div>` : ""}${hint}`)}${noticeLines(ctx, order)}${items}${trackingCards(ctx, order)}`, actions: true };
  }

  // ---------- dialog ----------
  const orderOf = (ctx, orderId) => ctx.data.orders.find((row) => row.id === orderId && ctx.helpers.orderSource(row) === "SA");
  // แก้ได้ = ร่าง / ปล่อยแล้วยังไม่เริ่ม (canEdit) หรือฝ่ายขายแก้ใบที่เริ่มงานแล้ว (inPlace)
  const editable = (ctx, state) => ctx.helpers.canOrder(ctx.user) && (state.canEdit || (ctx.helpers.salesOnly(ctx.user) && state.inPlace));
  const editCallout = (ctx, state) => (state.reopen ? ctx.ui.callout("warn", esc(state.reopenNote.trim()))
    : state.inPlace && ctx.helpers.salesOnly(ctx.user) ? ctx.ui.callout("info", esc(shared().IN_PLACE_TEXT ?? "")) : "");
  dialogs.saOrderHeader = (ctx, { orderId }) => {
    const { ui, rules } = ctx;
    const order = orderOf(ctx, orderId);
    if (!order) return null;
    const state = shared().orderEditState(ctx, order);
    if (!editable(ctx, state)) return null;
    const body = `<form novalidate id="sa-header-form" data-rf-form="updateOrderHeader" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="แก้หัวใบ ${attr(orderId)} แล้ว">
      ${editCallout(ctx, state)}
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
    if (!editable(ctx, state)) return null;
    const taken = new Set(order.items.map((item) => item.fgCode));
    const body = `<form novalidate id="sa-item-form" data-rf-form="addOrderItem" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="เพิ่มสินค้าในใบ ${attr(orderId)} แล้ว">
      ${editCallout(ctx, state)}
      <div class="rf-grid rf-g2">
        ${ui.field("สินค้า", ui.select("fgCode", fgOptions(ctx).filter((option) => !taken.has(option.value)), { placeholder: "เลือกสินค้า…" }), { required: true })}
        ${ui.field("จำนวน", ui.input("qty", { type: "number", step: "any", min: 1, required: true }), { required: true })}
      </div>
      ${ui.field("หมายเหตุสินค้า", ui.input("note", { extra: 'maxlength="120"' }))}
    </form>`;
    return { html: ui.dialog("saItemAdd", `เพิ่มสินค้าในใบ ${order.id}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="sa-item-form">เพิ่มสินค้า</button>` }) };
  };
  // ฝ่ายขายยกเลิกใบพร้อมเหตุผล: ยังไม่เริ่มงาน = ยกเลิกทันที · เริ่มงานแล้ว = ใบหยุดรับงานใหม่ ฝ่ายวางแผนเลือกผลิตต่อจนจบส่ง WH หรือหยุด เก็บยางเส้นยาวที่ SR
  dialogs.saCancel = (ctx, { orderId }) => {
    const { ui, helpers } = ctx;
    const order = orderOf(ctx, orderId);
    if (!order || !helpers.salesOnly(ctx.user) || !["draft", "released", "in_progress"].includes(order.status) || helpers.salesCancelled(order)) return null;
    const state = shared().orderEditState(ctx, order);
    if (state.rfPending) return null;
    const midway = order.status !== "draft" && !state.reopen;
    const info = midway
      ? "แผนกเริ่มงานแล้ว: ใบหยุดรับงานใหม่ทันที ฝ่ายวางแผนได้รับแจ้งแล้วเลือกว่าจะผลิตต่อจนจบส่ง WH (ของเป็นสต็อก ไม่ส่งลูกค้า) หรือหยุด เก็บยางเส้นยาวที่ SR"
      : helpers.isSentOrder(order) ? "ยังไม่มีแผนกไหนเริ่มงาน ใบถูกยกเลิกทันที ฝ่ายวางแผนได้รับแจ้ง" : "ใบร่างที่ยังไม่ส่ง ยกเลิกได้ทันที";
    const body = `<form novalidate id="sa-cancel-form" data-rf-form="cancelOrder" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="ยกเลิกใบ ${attr(orderId)} แล้ว">
      ${ui.callout(midway ? "warn" : "info", esc(info))}
      ${ui.field("เหตุผลที่ยกเลิก", `<textarea class="textarea rf-textarea" name="reason" rows="3" required minlength="3" maxlength="200" placeholder="${attr("เช่น ลูกค้ายกเลิกคำสั่งซื้อ")}"></textarea>`, { required: true })}
    </form>`;
    return { html: ui.dialog("saCancel", `ยกเลิกใบ ${order.id}`, body, { footer: `${ui.closeButton("ไม่ยกเลิก")}<button class="btn rf-btn" type="submit" form="sa-cancel-form">ยกเลิกใบ</button>` }) };
  };

  // ---------- การ์ดของฝ่ายวางแผน (วางที่หน้าแรกและหน้าใบสั่งผลิตของ #/pp) ----------
  // options.orderId = เฉพาะการแจ้งของใบนั้น (หน้าใบ) · ไม่ให้ = ใบใหม่จากฝ่ายขาย + การแจ้งทั้งหมดที่ยังเปิด · ไม่มีอะไร = ว่าง
  // การแจ้งแก้ใบ / ใบที่ยกเลิกทันที = ปุ่ม "รับทราบ" · ใบที่ยกเลิกกลางทาง = เลือก "ผลิตต่อจนจบส่ง WH" หรือ "หยุด เก็บยางเส้นยาวที่ SR"
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
    // ใบที่ปิดแล้ว: การแจ้งแก้ใบที่ยังเปิดอยู่ไม่ต้องรับทราบ (เซิร์ฟเวอร์ปิดให้ · helpers.staleChangeNotice)
    const open = (ctx.data.orderRequests ?? []).filter((row) => row.status === "open" && !helpers.staleChangeNotice?.(ctx.data, row) && (!orderId || row.orderId === orderId));
    if (open.length) {
      const items = open.sort((a, b) => (Number(a.requestedAt) || 0) - (Number(b.requestedAt) || 0)).map((row) => {
        const order = orderOfNotice(ctx, row);
        const choose = helpers.noticeMode(ctx.data, row) === "choose";
        const title = noticeTitle(ctx, row);
        const orderLink = orderId ? "" : `${ui.link(row.orderId, ctx.url("orders", { sel: row.orderId }), "rf-mono")} · `;
        let decide;
        if (!choose) {
          decide = ui.button("รับทราบ", { action: "decideOrderRequest", args: { requestId: row.id, decision: "ack" }, className: "small", ariaLabel: `รับทราบ ${title} ${row.orderId}` });
        } else {
          // หยุด = ยกเลิกใบตามทางเดิม: ทำไม่ได้เมื่อใบปิดแล้ว (รับเข้าครบ) หรือส่งมอบ / ให้สต็อกใบอื่นไปแล้ว (fgStockLock) → เหลือทางผลิตต่อ
          const lock = order ? rules.fgStockLock(ctx.data, order) : { blocked: false };
          const stopBlock = order?.status === "completed" ? "ใบนี้คลังสินค้ารับเข้าครบและปิดแล้ว หยุดไม่ได้" : lock.blocked ? "ใบนี้ส่งมอบหรือให้สต็อกใบอื่นไปแล้ว ยกเลิกไม่ได้ หยุดไม่ได้" : "";
          decide = `${ui.button("ผลิตต่อจนจบส่ง WH", { action: "decideOrderRequest", args: { requestId: row.id, decision: "continue" }, className: "small", confirmText: `ผลิตใบ ${row.orderId} ต่อจนจบส่ง WH? งานทุกแผนกเดินต่อ ของที่คลังสินค้ารับเข้าเป็นสต็อกสินค้าสำเร็จรูปให้ใบอื่นใช้ ไม่ส่งลูกค้าของใบนี้`, ariaLabel: `ผลิตใบ ${row.orderId} ต่อจนจบส่ง WH` })}${stopBlock
            ? `<span class="small muted">${esc(stopBlock)}</span>`
            : ui.button("หยุด เก็บยางเส้นยาวที่ SR", { action: "decideOrderRequest", args: { requestId: row.id, decision: "stop" }, className: "secondary small", confirmText: `หยุดใบ ${row.orderId}? ใบถูกยกเลิกด้วยเหตุผลของฝ่ายขาย ยางเส้นยาวของใบในคลัง SR และที่ RB ส่งแล้วรอรับเป็นสต็อกกลาง งานที่ค้างให้หัวหน้าแผนกปิดพร้อมเหตุผล`, ariaLabel: `หยุดใบ ${row.orderId} เก็บยางเส้นยาวที่ SR` })}`;
        }
        // หน้าใบของฝ่ายวางแผนแสดงเหตุผลยกเลิกกลางทางที่แถว "ที่มา" แล้ว: การ์ดบนหน้าใบไม่ซ้ำ
        const detail = orderId && choose ? "" : `<p>${esc(row.reason)}</p>`;
        return `<li class="bom-request"><div>${ui.badge(row.kind === "cancel" ? "bad" : "warn", title)} ${orderLink}<span class="small muted">${esc(`${row.requestedBy ?? ""} ${rules.fmtDateTime(row.requestedAt)}`)}</span>${detail}</div><div class="rf-row">${decide}</div></li>`;
      }).join("");
      cards.push(ui.card(`<ul class="bom-request-list">${items}</ul>`, { title: esc(`แจ้งจากฝ่ายขาย (${open.length})`) }));
    }
    if (orderId) cards.push(extraJobsCard(ctx, ctx.data.orders.find((order) => order.id === orderId)));
    return cards.join("");
  }
  // ฝ่ายขายเพิ่มสินค้า / จำนวนในใบที่เริ่มงานแล้ว (หน้าใบของฝ่ายวางแผน · 20261227010000): นับเฉพาะส่วนที่ฝ่ายขายเพิ่ม (จำนวนสั่ง − จำนวนที่เปิดงานไว้แล้ว)
  // ฝ่ายวางแผนใช้สต็อกกับส่วนที่เพิ่มได้แบบเดียวกับตอนปล่อยผลิต: สต็อกสินค้าสำเร็จรูป (WH) ต่อสินค้าที่เพิ่ม · ยางเส้นยาว (SR) ต่อเส้นยางของส่วนที่เพิ่ม (กรอกเฉพาะรหัสที่มีสต็อกว่าง)
  // ตารางด้านล่างคำนวณใหม่ทุกครั้งที่กรอก (bindExtraJobs) บอกงานที่จะเปิดหลังหักสต็อก (งานใหม่ / เพิ่มจาก A เป็น B) ก่อนกดปุ่มเดียว "เปิดงานเพิ่ม" (ยืนยันแล้วส่งทันที)
  // มีข้อห้าม (ไม่มี BOM งานปิดแล้ว WO เริ่มแล้ว) = แสดงข้อห้ามแทนฟอร์ม · ค่าเดิม → ใหม่ของจำนวนสั่งอยู่ในการแจ้ง "ฝ่ายขายแก้ใบ" แล้ว ที่นี่บอกแค่ส่วนที่เพิ่ม
  const flowOf = (rules, dept) => { const at = rules.FLOW_DEPTS.indexOf(dept); return at === -1 ? 99 : at; };
  function extraPreview(ctx, plan) {
    const { ui, rules } = ctx;
    const rows = plan.jobs.slice().sort((x, y) => flowOf(rules, x.dept) - flowOf(rules, y.dept) || x.itemCode.localeCompare(y.itemCode)).map((entry) => {
      const what = entry.mode === "new" ? `งานใหม่ ${rules.fmtQty(entry.diff)}` : `เพิ่มจาก ${rules.fmtQty(entry.from)} เป็น ${rules.fmtQty(entry.to)}`;
      return `<tr><td>${F.deptChip(entry.dept, rules.DEPT_LABEL)}</td><td>${ui.mono(entry.itemCode)}<div class="small muted">${esc(entry.name)}</div></td><td class="nowrap">${esc(`${what} ${uomText(ctx, entry.uom)}`)}${entry.woId ? `<div class="small muted">${esc(`${entry.woId} เพิ่มยอดตาม`)}</div>` : ""}</td></tr>`;
    });
    return rows.length ? ui.table(["แผนก", "งาน", "ที่จะเปิด"], rows) : `<p class="small muted">${esc("ไม่มีงานที่ต้องเปิด: ส่วนที่เพิ่มใช้จากสต็อกครบ")}</p>`;
  }
  const extraConfirm = (order, plan) => {
    const stock = plan.stock.filter((row) => row.use > 0).length;
    return `เปิดงานเพิ่มของใบ ${order.id}? งานใหม่ ${plan.jobs.filter((entry) => entry.mode === "new").length} งาน และเพิ่มยอดงานเดิม ${plan.jobs.filter((entry) => entry.mode === "raise").length} งาน ตามที่ฝ่ายขายเพิ่ม${stock ? ` ใช้จากสต็อก ${stock} รายการ ระบบหักสต็อกทันที` : ""} งานที่มีอยู่ไม่ลดลง`;
  };
  function extraStockTable(ctx, plan) {
    const { ui, rules } = ctx;
    const rows = plan.stock.filter((row) => row.max > 0 || row.requested > 0);
    if (plan.legacy || !rows.length) return "";
    const kindText = (row) => (row.kind === "FG" ? "สินค้าสำเร็จรูป (WH)" : "ยางเส้นยาว (SR)");
    const body = rows.map((row) => {
      const unit = uomText(ctx, row.uom);
      const hint = row.kind === "FG" ? `ส่วนที่เพิ่ม ${rules.fmtQty(row.added)} · สต็อกสินค้าสำเร็จรูปที่ใบอื่นถืออยู่ ${rules.fmtQty(row.available)}` : `ต้องใช้ ${rules.fmtNum(row.added, 2)} · สต็อกกลางของคลัง SR ${rules.fmtQty(row.available)}`;
      return `<tr><td>${ui.mono(row.itemCode)}<div class="small muted">${esc(row.name)} · ${esc(kindText(row))}</div></td><td class="right rf-mono">${esc(rules.fmtQty(row.available))}</td><td class="right"><input type="hidden" name="itemCode[]" value="${attr(row.itemCode)}"><label class="bom-count-input" title="${attr(hint)}"><span class="sr-only">${esc(`ใช้จากสต็อก ${row.itemCode} (ไม่เกิน ${rules.fmtQty(row.max)}) · ${hint}`)}</span><input class="input rf-input" name="qty[]" type="number" inputmode="decimal" step="any" min="0" max="${attr(row.max)}" value="${attr(row.requested > 0 ? row.requested : "")}" placeholder="${attr(`ไม่เกิน ${rules.fmtQty(row.max)}`)}"><span class="small muted">${esc(unit)}</span></label></td></tr>`;
    });
    return ui.table(["สินค้า / เส้นยาง", { label: "สต็อกที่ใช้ได้", className: "right", title: "สต็อกสินค้าสำเร็จรูปที่ใบอื่นถืออยู่ และสต็อกกลางของคลังยางเส้นยาว (SR) ที่ใช้ได้กับส่วนที่เพิ่ม" }, { label: "ใช้จากสต็อก", className: "right", title: "ลดงานผลิตของส่วนที่เพิ่มลงตามจำนวนนี้ ของถูกหักเมื่อกดเปิดงานเพิ่ม ล็อตเก่าก่อน ใบที่ปล่อยผลิตก่อนได้ก่อน" }], body);
  }
  function extraJobsCard(ctx, order) {
    const { ui, rules, helpers } = ctx;
    if (!order || !["released", "in_progress"].includes(order.status) || helpers.salesCancelled(order) || typeof helpers.extraJobsFor !== "function") return "";
    const plan = helpers.extraJobsFor(ctx.data, order, shared().rfOrdersOf?.(ctx) ?? null);
    if (!plan.lines.length || !(plan.jobs.length || plan.blockers.length || plan.stock.length)) return "";
    const added = plan.lines.map((line) => `${ui.mono(line.fgCode)} ${esc(`+${rules.fmtQty(line.added)}`)}`).join(" · ");
    if (plan.blockers.length) {
      const body = `<p>${esc("สินค้าที่เพิ่ม")} ${added}</p>${extraPreview(ctx, plan)}${ui.callout("warn", `<strong>${esc("ยังเปิดงานเพิ่มไม่ได้")}</strong><ul>${plan.blockers.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>`)}`;
      return ui.card(body, { title: esc("ฝ่ายขายเพิ่มสินค้า/จำนวน — เปิดงานเพิ่ม") });
    }
    const canOpen = plan.jobs.length > 0 || plan.increase;
    const form = `<form novalidate data-extra-jobs data-order-id="${attr(order.id)}" data-rf-form="addJobsForChanges" data-rf-args="${attr(JSON.stringify({ orderId: order.id }))}" data-rf-success="${attr(`เปิดงานเพิ่มของใบ ${order.id} แล้ว ({result})`)}">
      <p>${esc("สินค้าที่เพิ่ม")} ${added}</p>${extraStockTable(ctx, plan)}<div data-extra-preview>${extraPreview(ctx, plan)}</div>
      <div class="rf-row"><button class="btn rf-btn" type="submit" data-extra-submit data-rf-confirm="${attr(extraConfirm(order, plan))}" aria-label="${attr(`เปิดงานเพิ่มของใบ ${order.id}`)}"${canOpen ? "" : " disabled"}>เปิดงานเพิ่ม</button></div>
    </form>`;
    return ui.card(form, { title: esc("ฝ่ายขายเพิ่มสินค้า/จำนวน — เปิดงานเพิ่ม") });
  }
  // กรอกยอดที่ใช้จากสต็อกแล้วคำนวณงานที่จะเปิดใหม่ทันที (ตารางที่จะเปิดและข้อความยืนยัน) · ข้อมูลที่ใช้คำนวณเป็นชุดเดียวกับตอนกด (helpers.extraJobsFor)
  function bindExtraJobs(node, ctx) {
    node.querySelectorAll("form[data-extra-jobs]").forEach((form) => {
      const order = ctx.data.orders.find((row) => row.id === form.dataset.orderId);
      if (!order) return;
      const refresh = () => {
        const codes = [...form.querySelectorAll('input[name="itemCode[]"]')];
        const qtys = [...form.querySelectorAll('input[name="qty[]"]')];
        const use = codes.map((input, index) => ({ itemCode: input.value, qty: qtys[index]?.value ?? "" }));
        let plan;
        try { plan = ctx.helpers.extraJobsFor(ctx.data, order, shared().rfOrdersOf?.(ctx) ?? null, use); } catch { return; }
        const preview = form.querySelector("[data-extra-preview]");
        if (preview) preview.innerHTML = extraPreview(ctx, plan);
        const button = form.querySelector("[data-extra-submit]");
        if (button) { button.disabled = !(plan.jobs.length || plan.increase); button.dataset.rfConfirm = extraConfirm(order, plan); }
      };
      form.addEventListener("input", refresh);
    });
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

  root.MNP_SA_PAGES = Object.freeze({ landing, MENU, workCount, planningCards, bindExtraJobs, statusKey, KEEP: Object.freeze(["st"]) });
})(window);
