// หน้าเฉพาะของโมดูล PT (ขึ้นรูปพลาสติก) BG (เย็บจักร) PK (ประกอบและบรรจุ) — โรงงาน ขั้น 7 (20261224010000_bom_dept_steps.sql) โหมดทดสอบเท่านั้น
// โหลดหลัง modules/gr-pages.js และก่อน module-pt / module-bg / module-pk (ดู index.html) · หน้าส่วนใหญ่ใช้ชุดเดียวกับ GR ใน gr-pages.js (งานของฉัน บันทึกผลรายวัน ส่งต่อ สรุปผล ตั้งค่า หน้างาน)
// ที่นี่มีเฉพาะส่วนที่ต่างกัน: PT / BG = วัตถุดิบจาก ST (?tab=materials · อ่านอย่างเดียว) · PK = ความพร้อมของที่ต้องรับ (การ์ดงาน หน้างาน) รอรับของ (?tab=incoming) ส่งให้ WH (?tab=wh) · dialog ส่ง / ยกเลิกการส่งให้ WH
// เมนูข้าง PT / BG: งานของฉัน · บันทึกผลรายวัน ?tab=log · วัตถุดิบจาก ST ?tab=materials · ส่งให้ PK ?tab=pk · สรุปผล ?tab=summary · ตั้งค่า ?tab=settings (หัวหน้าแผนกและฝ่ายวางแผน)
// เมนูข้าง PK: งานของฉัน · บันทึกผลรายวัน ?tab=log · รอรับของ ?tab=incoming · ส่งให้ WH ?tab=wh · สรุปผล ?tab=summary · ตั้งค่า ?tab=settings · "เสร็จแล้ว" = ลิงก์ที่หัวหน้า "งานของฉัน" (?st=done)
// การซ่อน/แสดงปุ่มเป็นแค่ UX สิทธิ์จริงตัดสินที่ action และฐานข้อมูล
(function registerDeptPages(root) {
  const F = root.MNP_FACTORY;
  const G = root.MNP_GR_PAGES;
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const kit = G.kit;
  const { num, dash } = kit;

  const SOURCE_DEPTS = Object.freeze(["GR", "PT", "BG"]);
  const STEP_MENU = Object.freeze({
    PT: Object.freeze({ id: "materials", label: "วัตถุดิบจาก ST", icon: "warehouse", params: Object.freeze({ tab: "materials" }) }),
    BG: Object.freeze({ id: "materials", label: "วัตถุดิบจาก ST", icon: "warehouse", params: Object.freeze({ tab: "materials" }) }),
    PK: Object.freeze({ id: "incoming", label: "รอรับของ", icon: "inbox", params: Object.freeze({ tab: "incoming" }) }),
  });
  // เมนูข้างของแผนก (PT / BG / PK): ใช้ MENU ของ GR เป็นต้นแบบ แล้วเปลี่ยนรายการเฉพาะแผนก
  function menuFor(dept) {
    const send = dept === "PK"
      ? { id: "wh", label: "ส่งให้ WH", icon: "box", params: { tab: "wh" } }
      : { id: "pk", label: "ส่งให้ PK", icon: "box", params: { tab: "pk" } };
    return Object.freeze([
      Object.freeze({ ...F.workItem(G.workCount), owns: ["job"] }),
      Object.freeze({ id: "log", label: "บันทึกผลรายวัน", icon: "clipboard", params: { tab: "log" } }),
      Object.freeze({ ...STEP_MENU[dept] }),
      Object.freeze(send),
      Object.freeze({ id: "summary", label: "สรุปผล", icon: "chart", params: { tab: "summary" } }),
      Object.freeze({ id: "settings", label: "ตั้งค่าขั้นตอนและเป้า", icon: "settings", params: { tab: "settings" }, when: (user) => Boolean(root.MNP_BOM_ACTIONS?.helpers?.canDeptLead?.(user, dept)) }),
    ]);
  }

  // ---------- PK: ความพร้อมของที่ต้องรับ (rules.pkReadiness · PK บันทึกผลได้เสมอแม้ยังไม่พร้อม) ----------
  const orderOfJob = (ctx, job) => ctx.data.orders.find((entry) => entry.id === job.orderId) ?? null;
  const sourceStatus = (ctx, source) => (source.ready ? ctx.ui.badge("good", "รับครบ") : source.sent > source.received ? ctx.ui.badge("warn", "รอ PK รับ") : ctx.ui.badge("", "ยังไม่ส่งมา"));
  // การ์ดงาน PK: บรรทัดสั้นต่อแผนกต้นทาง (ต้องรับ / รับแล้ว) + ของซื้อจาก ST (รายการที่ ST จ่ายครบ / ทั้งหมด) · พร้อมประกอบ = ทุกแหล่งรับครบ
  function cardExtra(ctx, job) {
    if (job.dept !== "PK" || job.status === "done") return "";
    const order = orderOfJob(ctx, job);
    if (!order) return "";
    const { rules, ui } = ctx;
    const ready = rules.pkReadiness(ctx.data, order);
    if (!ready.total) return "";
    const lines = [];
    for (const dept of SOURCE_DEPTS) {
      const list = ready.sources.filter((source) => source.dept === dept);
      if (!list.length) continue;
      const needed = list.reduce((sum, source) => sum + source.needed, 0);
      const received = list.reduce((sum, source) => sum + source.received, 0);
      const title = list.map((source) => `${source.itemCode}: รับ ${rules.fmtQty(source.received)}/${rules.fmtQty(source.needed)} (ส่งมาแล้ว ${rules.fmtQty(source.sent)})`).join(" · ");
      lines.push(`<li class="${list.every((source) => source.ready) ? "is-done" : ""}" title="${attr(title)}"><span>${esc(`จาก ${dept}`)}</span><span class="nowrap rf-mono">${esc(`${rules.fmtQty(received)}/${rules.fmtQty(needed)}`)}</span></li>`);
    }
    if (ready.parts.length) {
      const done = ready.parts.filter((part) => part.ready).length;
      const title = ready.parts.map((part) => `${part.itemCode}: จ่ายแล้ว ${rules.fmtQty(part.issued)}/${rules.fmtQty(part.needed)}`).join(" · ");
      lines.push(`<li class="${done === ready.parts.length ? "is-done" : ""}" title="${attr(title)}"><span>${esc("ของซื้อจาก ST (รายการ)")}</span><span class="nowrap rf-mono">${esc(`${done}/${ready.parts.length}`)}</span></li>`);
    }
    return `${ready.ready ? `<p class="small">${ui.badge("good", "พร้อมประกอบ")}</p>` : ""}<ul class="bom-job-parts gr-steps" aria-label="${attr("ความพร้อมของที่ต้องรับ")}">${lines.join("")}</ul>`;
  }

  // ---------- วัตถุดิบที่ ST จ่ายให้ใบ (PT / BG · rules.deptMaterials) ----------
  // การเบิกจ่ายเป็นรายใบ (หนึ่งงานของซื้อต่อรหัสต่อใบ) ไม่แยกตามแผนกหรืองาน จึงเป็นยอดของทั้งใบ · รหัสที่หลายแผนกใช้บอกใน title
  function materialRows(ctx, job) {
    const { rules, ui } = ctx;
    return rules.deptMaterials(ctx.data, job).map((row) => {
      const when = row.lastAt ? `${rules.fmtDate(row.lastAt)}${row.lastBy ? ` · ${row.lastBy}` : ""}` : "";
      const shared = row.shared ? ` title="${attr("รหัสนี้หลายแผนกใช้ ยอดเป็นของทั้งใบ")}"` : "";
      return { row, html: `<td>${ui.mono(row.itemCode)}${row.name ? `<div class="small muted">${esc(row.name)}</div>` : ""}</td><td class="right rf-mono"${shared}>${esc(`${rules.fmtQty(row.planned)} ${rules.uomLabel(row.uom)}`)}</td><td class="right rf-mono">${esc(rules.fmtQty(row.issued))}${row.returned > 0 ? `<div class="small muted">${esc(`คืนแล้ว ${rules.fmtQty(row.returned)}`)}</div>` : ""}</td><td class="small">${when ? esc(when) : dash}</td>` };
    });
  }
  const MATERIAL_HEAD = [ "วัตถุดิบ", { label: "ต้องใช้", className: "right", title: "ของซื้อที่ BOM ของใบให้แผนกนี้ใช้ · ยอดของทั้งใบ" }, { label: "ST จ่ายแล้ว", className: "right" }, { label: "จ่ายล่าสุด", title: "วันที่และผู้จ่ายของ ST" } ];
  function materialsView(ctx) {
    const { ui } = ctx;
    const jobs = kit.grJobs(ctx).open;
    const seen = new Set();
    const rows = [];
    for (const job of jobs) {
      if (seen.has(job.orderId)) continue;
      seen.add(job.orderId);
      const order = orderOfJob(ctx, job);
      const items = jobs.filter((entry) => entry.orderId === job.orderId).map((entry) => entry.itemCode);
      for (const { row, html } of materialRows(ctx, job)) {
        if (!F.includesText(`${job.orderId} ${order?.customer ?? ""} ${items.join(" ")} ${row.itemCode} ${row.name ?? ""}`, ctx.q)) continue;
        rows.push(`<tr${kit.rowAttr(kit.jobHref(ctx, job.id))}><td>${kit.mainLink(ctx, job.orderId, kit.jobHref(ctx, job.id), "rf-mono")}<div class="small muted">${esc(order?.customer ?? "")}</div><div class="small muted">${esc(items.join(", "))}</div></td>${html}</tr>`);
      }
    }
    const { shown, more } = F.limited(ctx, rows);
    const head = ["ใบสั่งผลิต", ...MATERIAL_HEAD];
    return `<div class="rf-row">${F.searchForm(ctx, "ค้นหาใบ ชิ้นงาน หรือวัตถุดิบ")}</div>${ui.card(`${ui.table(head, shown, { emptyText: ctx.q ? "ไม่พบวัตถุดิบที่ค้นหา" : "ยังไม่มีวัตถุดิบจาก ST ของงานที่เปิดอยู่" })}${more}`, { flush: true })}`;
  }
  function jobMaterialsCard(ctx, job) {
    const list = materialRows(ctx, job);
    if (!list.length) return "";
    return ctx.ui.card(ctx.ui.table(MATERIAL_HEAD, list.map((entry) => `<tr>${entry.html}</tr>`)), { title: esc("วัตถุดิบจาก ST"), flush: true });
  }

  // ---------- PK: ของที่ต้องรับของใบ (หน้างาน) ----------
  function jobReadinessCard(ctx, job) {
    if (job.dept !== "PK") return "";
    const order = orderOfJob(ctx, job);
    if (!order) return "";
    const { rules, ui } = ctx;
    const ready = rules.pkReadiness(ctx.data, order);
    if (!ready.total) return "";
    const sources = ready.sources.map((source) => `<tr><td>${esc(`จาก ${source.dept}`)}</td><td>${ui.mono(source.itemCode)}${source.job.name ? `<div class="small muted">${esc(source.job.name)}</div>` : ""}</td><td class="right rf-mono">${esc(rules.fmtQty(source.needed))}</td><td class="right rf-mono">${esc(rules.fmtQty(source.sent))}</td><td class="right rf-mono">${esc(rules.fmtQty(source.received))}</td><td>${sourceStatus(ctx, source)}</td></tr>`);
    const parts = ready.parts.map((part) => `<tr><td>${esc("ของซื้อจาก ST")}</td><td>${ui.mono(part.itemCode)}${part.name ? `<div class="small muted">${esc(part.name)}</div>` : ""}</td><td class="right rf-mono">${esc(rules.fmtQty(part.needed))}</td><td class="right rf-mono">${dash}</td><td class="right rf-mono">${esc(rules.fmtQty(part.issued))}</td><td>${part.ready ? ui.badge("good", "จ่ายครบ") : ui.badge("", "รอ ST จ่าย")}</td></tr>`);
    const head = ["แหล่ง", "ชิ้นงาน", { label: "ต้องรับ", className: "right" }, { label: "ส่งมาแล้ว", className: "right" }, { label: "PK รับ / ST จ่ายแล้ว", className: "right" }, "สถานะ"];
    const badge = ready.ready ? ui.badge("good", "พร้อมประกอบ") : "";
    return ui.card(`${badge ? `<div class="rf-card-pad">${badge}</div>` : ""}${ui.table(head, [...sources, ...parts])}`, { title: esc("ของที่ต้องรับ"), flush: true });
  }
  const jobCards = (ctx, job) => (job.dept === "PK" ? jobReadinessCard(ctx, job) : job.dept === "PT" || job.dept === "BG" ? jobMaterialsCard(ctx, job) : "");

  // ---------- PK: รอรับของ ----------
  // การ์ดบน = รายการที่ส่งมาแล้วรอ PK รับ (เก่าก่อน · ปุ่มรับ = รับทั้งรายการ) · ตารางล่าง = ของที่ใบของ PK ยังรอจาก GR / PT / BG (ส่งมาแล้วยังไม่รับก่อน)
  function incomingView(ctx) {
    const { ui, rules, data } = ctx;
    const can = Boolean(ctx.helpers.canReceiveAtPk?.(ctx.user));
    const jobs = new Map(data.jobs.map((job) => [job.id, job]));
    const pending = kit.sendRowsOf(data, rules).filter((row) => row.status === "sent" && kit.ACTIVE.includes(kit.orderOf(ctx, row.orderId)?.status))
      .sort((a, b) => num(a.sentAt) - num(b.sentAt) || String(a.id).localeCompare(String(b.id)));
    const pendingRows = pending.map((row) => {
      const job = jobs.get(row.jobId);
      const from = rules.handoverFrom(row);
      const qty = `${rules.fmtQty(row.qty)} ${kit.uomText(ctx, job?.uom ?? "pcs")}`;
      const button = can ? ui.button("รับ", { action: from === "GR" ? "receiveGrAtPk" : "receiveAtPk", args: { handoverId: row.id }, className: "small", confirmText: `รับงานจาก ${from} ${row.itemCode} ทั้ง ${qty}? รับทั้งรายการในครั้งเดียว ถ้ารับผิด หัวหน้าแผนก PK หรือฝ่ายวางแผนย้อนได้`, success: `รับงานจาก ${from} {result} แล้ว`, ariaLabel: `รับจาก ${from} ${row.itemCode} ${qty}` }) : "";
      return `<tr><td class="nowrap small">${esc(rules.fmtDateTime(row.sentAt))}</td><td>${esc(from)}</td><td>${ui.mono(row.itemCode)}<div class="small muted">${esc(`${job?.name ?? ""} · ใบ ${row.orderId}`)}</div></td><td class="right rf-mono">${esc(qty)}</td><td class="small">${esc(row.sentBy ?? "")}${row.note ? `<div class="muted">${esc(row.note)}</div>` : ""}</td><td class="right">${button}</td></tr>`;
    });
    const { shown: shownPending, more: morePending } = F.limited(ctx, pendingRows);
    const pendingCard = ui.card(`${ui.table(["เวลาส่ง", "จาก", "ชิ้นงาน", { label: "จำนวน", className: "right" }, "ผู้ส่ง", { label: "", className: "right" }], shownPending, { emptyText: "ไม่มีรายการที่รอรับ" })}${morePending}${can || !pending.length ? "" : kit.READ_ONLY}`, { title: esc("ส่งมาแล้ว รอ PK รับ"), flush: true });
    // ของที่ยังไม่ครบต่อใบ: เฉพาะใบที่ PK ยังมีงานเปิดอยู่
    const orderIds = [...new Set(kit.grJobs(ctx).open.map((job) => job.orderId))];
    const waiting = [];
    for (const orderId of orderIds) {
      const order = kit.orderOf(ctx, orderId);
      if (!order) continue;
      for (const source of rules.pkReadiness(data, order).sources) {
        if (source.ready) continue;
        if (!F.includesText(`${orderId} ${source.itemCode} ${source.dept} ${source.job.name ?? ""}`, ctx.q)) continue;
        waiting.push({ order, source });
      }
    }
    waiting.sort((a, b) => Number(b.source.sent > b.source.received) - Number(a.source.sent > a.source.received) || num(a.order.due) - num(b.order.due) || String(a.order.id).localeCompare(String(b.order.id)) || String(a.source.itemCode).localeCompare(String(b.source.itemCode)));
    const waitingRows = waiting.map(({ order, source }) => `<tr><td class="rf-mono">${esc(order.id)}<div class="small muted">${esc(order.customer ?? "")}</div></td><td>${esc(source.dept)}</td><td>${ui.mono(source.itemCode)}${source.job.name ? `<div class="small muted">${esc(source.job.name)}</div>` : ""}</td><td class="right rf-mono">${esc(rules.fmtQty(source.needed))}</td><td class="right rf-mono">${esc(rules.fmtQty(source.sent))}</td><td class="right rf-mono">${esc(rules.fmtQty(source.received))}</td><td>${sourceStatus(ctx, source)}</td></tr>`);
    const { shown: shownWaiting, more: moreWaiting } = F.limited(ctx, waitingRows);
    const waitingCard = ui.card(`<div class="rf-row">${F.searchForm(ctx, "ค้นหาใบ ชิ้นงาน หรือแผนก")}</div>${ui.table(["ใบสั่งผลิต", "จาก", "ชิ้นงาน", { label: "ต้องรับ", className: "right" }, { label: "ส่งมาแล้ว", className: "right" }, { label: "PK รับแล้ว", className: "right" }, "สถานะ"], shownWaiting, { emptyText: ctx.q ? "ไม่พบรายการที่ค้นหา" : "ของจาก GR PT BG ของใบที่เปิดอยู่มาครบแล้ว" })}${moreWaiting}`, { title: esc("ของที่ยังไม่ครบต่อใบ"), flush: true });
    return `${pendingCard}${waitingCard}`;
  }

  // ---------- PK: dialog ส่งให้ WH / ยกเลิกการส่ง ----------
  const jobLabel = (job) => `${job.name} · ${job.itemCode} · ใบ ${job.orderId}`;
  dialogs.pkSendWh = (ctx, { jobId }) => {
    const { ui, rules } = ctx;
    const job = ctx.data.jobs.find((entry) => entry.id === jobId && entry.dept === "PK" && entry.kind === "FG");
    if (!job || !kit.leadFor(ctx, "PK") || !kit.canSendOrder(ctx, job)) return null;
    const waiting = kit.waitingOf(ctx, job);
    if (!(waiting > 0)) return null;
    const unit = kit.uomText(ctx, job.uom);
    const body = `<form novalidate id="pk-send-wh-form" data-rf-form="sendPkToWh" data-rf-args="${attr(JSON.stringify({ jobId: job.id }))}" data-rf-success="ส่งให้ WH {result} แล้ว">
      <p class="small muted">${esc(jobLabel(job))}</p>
      ${ui.field(`จำนวนที่ส่ง (${unit})`, ui.input("qty", { type: "number", value: waiting, step: "any", min: 0.0001, max: waiting, required: true, id: "pk-send-wh-qty", extra: `title="${attr(`ไม่เกินของดีที่ยังไม่ได้ส่ง ${rules.fmtQty(waiting)} ${unit}`)}"` }), { id: "pk-send-wh-qty", required: true })}
      ${ui.field("หมายเหตุ", ui.input("note", { id: "pk-send-wh-note", placeholder: "ถ้ามี", extra: `maxlength="${rules.GR_LIMITS.note}"` }), { id: "pk-send-wh-note" })}</form>`;
    const confirm = "ส่งสินค้าให้ WH ตามจำนวนที่กรอก? WH รับเข้าคลังได้ไม่เกินจำนวนที่ส่ง ถ้าส่งผิด หัวหน้าแผนก PK หรือฝ่ายวางแผนยกเลิกส่วนที่ WH ยังไม่รับได้";
    return { html: ui.dialog("pkSendWh", "ส่งให้ WH", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="pk-send-wh-form" data-rf-confirm="${attr(confirm)}">ส่งให้ WH</button>` }) };
  };
  dialogs.pkWhCancel = (ctx, { handoverId }) => {
    const { ui, rules, data } = ctx;
    const row = (data.grHandovers ?? []).find((entry) => entry.id === handoverId);
    if (!row || rules.handoverTo(row) !== "WH" || row.status !== "sent" || !kit.LIVE.includes(kit.orderOf(ctx, row.orderId)?.status) || !kit.leadFor(ctx, "PK") || !kit.whCancelable(ctx, row)) return null;
    const body = `<form novalidate id="pk-wh-cancel-form" data-rf-form="cancelPkToWh" data-rf-args="${attr(JSON.stringify({ handoverId }))}" data-rf-success="ยกเลิกการส่งให้ WH แล้ว">
      ${ui.kv([["รายการ", esc(`${row.itemCode} × ${rules.fmtQty(row.qty)} · ใบ ${row.orderId}`)], ["ส่งโดย", esc(`${row.sentBy ?? ""} · ${rules.fmtDateTime(row.sentAt)}`)]])}
      ${ui.callout("warn", esc("ของจำนวนนี้กลับเป็นของที่ยังไม่ได้ส่ง (รอที่ PK) แล้วส่งใหม่ได้ · รายการเดิมยังอยู่ในประวัติ"))}
      ${ui.field("เหตุผลที่ยกเลิก", ui.input("reason", { required: true, placeholder: "เช่น ส่งจำนวนผิด", id: "pk-wh-cancel-why", extra: `minlength="${rules.GR_LIMITS.reasonMin}" maxlength="${rules.GR_LIMITS.reasonMax}"` }), { id: "pk-wh-cancel-why", required: true })}</form>`;
    return { html: ui.dialog("pkWhCancel", "ยกเลิกการส่งให้ WH", body, { footer: `${ui.closeButton("ไม่ยกเลิก")}<button class="btn rf-btn" type="submit" form="pk-wh-cancel-form">ยกเลิกการส่ง</button>` }) };
  };

  // หน้าของ ?tab=<id> ที่เป็นของแผนกนี้โดยเฉพาะ · null = ไม่ใช่ (gr-pages.js จัดการต่อ)
  function view(ctx, id) {
    const dept = kit.deptOf(ctx);
    if (id === "materials" && (dept === "PT" || dept === "BG")) return materialsView(ctx);
    if (id === "incoming" && dept === "PK") return incomingView(ctx);
    return null;
  }

  root.MNP_DEPT_PAGES = Object.freeze({ menuFor, view, cardExtra, jobCards, materialsView, incomingView });
})(window);
