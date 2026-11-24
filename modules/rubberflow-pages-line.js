// RubberFlow MES (แผนก RB โหมดทดสอบ) — หน้าสายการผลิต: เบิกเคมี · 1 ผสมยาง · 2 ฉีดขึ้นรูป · 3 อบ HCM · 4 ตกแต่งและบรรจุ · ส่งมอบ WIP
// ยกมาจาก pages/Requisition.jsx (สถานีชั่งรายบรรทัดถูกแทนด้วยการเบิกแบบจ่ายทันที), Mixing.jsx, Extrusion.jsx, Curing.jsx, Finishing.jsx, Wip.jsx และ components/StageCommon.jsx ของต้นแบบ
// ลงทะเบียนใน window.MNP_RUBBERFLOW_PAGES / _DIALOGS กติกา event อยู่ที่ modules/module-rubberflow.js — โหลดหลัง modules/rubberflow-ui.js
(function (root) {
  const pages = (root.MNP_RUBBERFLOW_PAGES ??= {});
  const dialogs = (root.MNP_RUBBERFLOW_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  // หน่วยของ WO/ล็อต/กล่อง: ป้ายไทยของ BOM สำหรับรหัสหน่วยของ BOM (rules.unitText) · ไม่มีกฎ = รหัสเดิม
  const unitText = (code) => root.MNP_RUBBERFLOW_RULES?.unitText?.(code) ?? String(code ?? "");
  const includes = (haystack, q) => !q || String(haystack).toLowerCase().includes(q.toLowerCase());
  const searchForm = (ctx, placeholder) => `<form novalidate class="rf-search" data-rf-search data-rf-keep="tab" role="search"><label class="sr-only" for="rf-q">ค้นหา</label>${ctx.ui.input("q", { id: "rf-q", type: "search", value: ctx.q, placeholder })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>`;

  // ---------- ส่วนที่สถานีใช้ร่วมกัน (StageCommon) ----------
  const stageYield = (lots) => {
    const good = lots.reduce((sum, lot) => sum + lot.goodQty, 0);
    const scrap = lots.reduce((sum, lot) => sum + lot.scrapQty, 0);
    return good + scrap ? (good / (good + scrap)) * 100 : 100;
  };
  // ยังไม่มีล็อตที่ผลิต = ยังไม่มีอัตราให้บอก แสดง "—" (ไม่ใช่ 100%)
  const stageYieldText = (lots) => (lots.some((lot) => lot.goodQty + lot.scrapQty > 0) ? `${stageYield(lots).toFixed(2)}%` : "—");
  // งานที่รับมอบเข้าสถานีแล้ว (Gatekeeper ยอมให้ใช้) และที่ยังรอรับ
  const inbound = (data, stage) => ({
    ready: data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "received" && transfer.remaining > 0.0001),
    waiting: data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "in_transit"),
  });
  const shiftOptions = (rules) => rules.SHIFTS.map((shift) => ({ value: shift.id, label: shift.label }));

  function gateNotice(ctx, stage) {
    const { ready, waiting } = inbound(ctx.data, stage);
    if (ready.length) return "";
    // ไม่มีใบรอรับ = งานยังมาไม่ถึง: พาไปสถานีก่อนหน้าที่ต้องส่งมอบมาให้ (ไม่ทิ้งให้ผู้ใช้หาทางเอง)
    const prev = ctx.rules.PREV_STAGE?.[stage];
    const next = waiting.length
      ? ` · มี ${waiting.length} ใบส่งมอบรอรับ ${ctx.ui.link("ไปหน้ารับมอบ", ctx.url("wip"), "btn rf-btn secondary small")}`
      : prev && ctx.canSee(prev) ? ` ${ctx.ui.link(`ไปสถานี${ctx.rules.STAGE_LABEL[prev]}`, ctx.url(prev), "btn rf-btn secondary small")}` : "";
    return ctx.ui.callout("warn", `<strong>ด่านรับมอบ:</strong> ยังไม่มีงานที่รับมอบเข้าสถานี${esc(ctx.rules.STAGE_LABEL[stage])} จึงยังเริ่มบันทึกการผลิตไม่ได้${next}`);
  }

  // ตัวเลือกใบส่งมอบที่รับแล้ว — data-rf-inbound ให้ bind เติมปริมาณคงเหลือลงช่องถัดไปอัตโนมัติ
  function inboundSelect(ctx, stage) {
    const { ready } = inbound(ctx.data, stage);
    return ctx.ui.field("งานที่รับมอบแล้ว (ต้นทาง)", ctx.ui.select("transferId", ready.map((transfer) => ({ value: transfer.id, label: `${transfer.lotId} · คงเหลือ ${transfer.remaining} ${unitText(transfer.uom)} (${transfer.orderId})` })), { placeholder: "เลือกใบส่งมอบ…", extra: "data-rf-inbound required" }), { required: true });
  }
  const bindInbound = (rootNode, data, targetName) => {
    const select = rootNode.querySelector("[data-rf-inbound]");
    const target = rootNode.querySelector(`[name="${targetName}"]`);
    const hint = rootNode.querySelector("[data-rf-remaining]");
    if (!select || !target) return () => null;
    const pick = () => {
      const transfer = data.transfers.find((row) => row.id === select.value) ?? null;
      target.value = transfer ? String(transfer.remaining) : "";
      if (hint) hint.textContent = transfer ? `คงเหลือ ${transfer.remaining} ${unitText(transfer.uom)}` : "";
      return transfer;
    };
    select.addEventListener("change", () => { pick(); target.dispatchEvent(new Event("input")); });
    return () => data.transfers.find((row) => row.id === select.value) ?? null;
  };

  // ตารางล็อตของสถานี: columns = [{ label, render(lot) → HTML }]
  function stageLots(ctx, stage, columns) {
    const { data, now, ui, rules, actions } = ctx;
    const { NEXT_STAGE, fmtDateTime, fmtDuration, fmtNum } = rules;
    const lots = data.lots.filter((lot) => lot.stage === stage).sort((a, b) => b.createdAt - a.createdAt);
    const rows = lots.map((lot) => {
      const available = actions.transferableQty(lot, now);
      const resting = stage === "mixing" && lot.readyAt > now;
      const buttons = [
        ui.openButton("ป้าย", "tag", { kind: "lot", id: lot.id }, { className: "secondary small", ariaLabel: `พิมพ์ป้าย ${lot.id}` }),
        resting && ctx.can("skipRest") ? ui.openButton("ข้ามเวลาบ่ม", "skipRest", { lotId: lot.id }, { className: "secondary small", ariaLabel: `ข้ามเวลาบ่ม ${lot.id}` }) : "",
        NEXT_STAGE[stage] && available > 0 ? ui.openButton("ส่งต่อ", "transfer", { lotId: lot.id }, { className: "small" }) : "",
        NEXT_STAGE[stage] && available === 0 && lot.transferredQty >= lot.goodQty - 1e-6 ? `<span class="small muted">ส่งต่อครบแล้ว</span>` : "",
      ].filter(Boolean).join(" ");
      return `<tr><td>${ui.mono(lot.id)}<div class="small muted">${esc(`${fmtDateTime(lot.createdAt)} · ${lot.operator ?? "-"}`)}</div></td><td class="rf-mono small">${esc(lot.orderId)}</td>
        ${columns.map((column) => `<td class="small">${column.render(lot)}</td>`).join("")}
        <td class="right nowrap">${esc(fmtNum(lot.goodQty, 2))} / <span class="muted">${esc(fmtNum(lot.scrapQty, 2))}</span> ${esc(unitText(lot.uom))}</td>
        <td>${ui.status(lot.qc)}${lot.holdReasons?.length ? `<div class="small rf-warn-text">${esc(lot.holdReasons.join(", "))}</div>` : ""}${resting ? `<div class="small muted">⏱ บ่มอีก ${esc(fmtDuration(lot.readyAt - now))}</div>` : ""}${lot.params?.skipRest?.reason ? `<div class="small muted">${esc(`ข้ามเวลาบ่มโดย ${lot.params.skipRest.by || "-"}: ${lot.params.skipRest.reason}`)}</div>` : ""}</td>
        <td class="right"><div class="rf-row rf-end">${buttons}</div></td></tr>`;
    });
    return ui.card(ui.table(["ล็อต", "ใบสั่งผลิต", ...columns.map((column) => column.label), { label: "งานดี / เสีย", className: "right" }, "QC", { label: "จัดการ", className: "right" }], rows, { emptyText: "ยังไม่มีล็อตที่บันทึก" }), { title: "ล็อตที่บันทึกแล้ว", flush: true });
  }

  // ข้ามเวลาบ่ม (หัวหน้า RB / QA): ต้องมีเหตุผล เก็บไว้ที่ล็อตและบันทึกการใช้งาน · ส่งทันทีเมื่อกดยืนยัน
  dialogs.skipRest = (ctx, { lotId }) => {
    const { data, now, ui, rules } = ctx;
    const lot = data.lots.find((row) => row.id === lotId);
    if (!lot || !(lot.readyAt > now)) return null;
    const body = `${ui.callout("warn", esc(`${lot.id} ยังต้องบ่มอีก ${rules.fmtDuration(lot.readyAt - now)} ข้ามแล้วส่งต่อไปฉีดได้ทันที`))}
      ${ui.field("เหตุผลที่ข้ามเวลาบ่ม", ui.input("reason", { required: true, placeholder: "เช่น ตรวจความหนืดแล้วผ่าน", extra: 'minlength="3" maxlength="300"' }), { required: true })}`;
    const html = ui.dialog("skipRest", `ข้ามเวลาบ่ม · ${lot.id}`, `<form novalidate data-rf-form="endRest" data-rf-args='${esc(JSON.stringify({ lotId: lot.id }))}' data-rf-success="ข้ามเวลาบ่ม ${esc(lot.id)} แล้ว" id="rf-skip-rest">${body}</form>`, { footer: `${ui.closeButton("ไม่ข้าม")}<button class="btn rf-btn" type="submit" form="rf-skip-rest">ข้ามเวลาบ่ม</button>` });
    return { html };
  };

  dialogs.transfer = (ctx, { lotId }) => {
    const { data, now, ui, rules, actions } = ctx;
    const lot = data.lots.find((row) => row.id === lotId);
    if (!lot) return null;
    const available = actions.transferableQty(lot, now);
    const body = `${ui.callout("info", esc(`${rules.STAGE_LABEL[lot.stage]} → ${rules.STAGE_LABEL[rules.NEXT_STAGE[lot.stage]] ?? "-"} · ปลายทางต้องรับมอบก่อนจึงเริ่มผลิตได้`))}
      <div class="rf-grid rf-g2">${ui.field(`จำนวนส่งมอบ (${unitText(lot.uom)})`, ui.input("qty", { type: "number", step: "any", value: String(available), required: true }), { hint: esc(`ส่งได้สูงสุด ${available}`), required: true })}${ui.field("หมายเหตุ / รหัสพาเลท", ui.input("note"))}</div>`;
    const html = ui.dialog("transfer", `ส่งมอบ WIP · ${lot.id}`, `<form novalidate data-rf-form="createTransfer" data-rf-args='${esc(JSON.stringify({ lotId: lot.id }))}' data-rf-success="สร้างใบส่งมอบ {result} แล้ว" id="rf-transfer">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-transfer">สร้างใบส่งมอบ</button>` });
    return { html };
  };

  // ---------- เบิกเคมี ----------
  // เบิก = สร้างใบเบิกและจ่ายทันที (dialog สร้างใบเบิก) · ใบเก่าที่ค้างสถานะ weighing มีปุ่ม "เบิกทั้งใบ" ปุ่มเดียว ไม่มีสถานีชั่งรายบรรทัดแล้ว
  pages.requisition = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const { fmtDate, fmtDateTime, fmtNum } = rules;
    const list = [...data.requisitions].sort((a, b) => b.createdAt - a.createdAt);
    const selected = data.requisitions.find((row) => row.id === params.get("sel")) ?? list.find((row) => row.status === "weighing") ?? list[0] ?? null;
    const listHtml = list.map((requisition) => {
      const left = requisition.lines.filter((line) => line.actualKg === null).length;
      const returnState = rules.requisitionReturnState?.(data, requisition);
      const stateBadge = returnState === "pending" ? ui.badge("warn", rules.requisitionStore(requisition) === "RB" ? "WO ถูกยกเลิก · รอคืนเข้าคลัง RB" : "WO ถูกยกเลิก · รอ ST รับคืน") : returnState === "returned" ? ui.badge("good", "รับคืนแล้ว") : ui.status(requisition.status);
      return `<a class="rf-list-item${requisition.id === selected?.id ? " is-selected" : ""}" href="${esc(ctx.pageUrl({ sel: requisition.id }))}"${requisition.id === selected?.id ? ' aria-current="true"' : ""}><div class="rf-row rf-between"><strong class="rf-mono">${esc(requisition.id)}</strong>${stateBadge}</div><div class="small muted">${esc(`${requisition.orderId} · ${requisition.batches} ชุดผสม · ${fmtNum(requisition.totalKg, 1)} kg${left ? ` · ค้างจ่าย ${left}/${requisition.lines.length}` : ""}`)}</div></a>`;
    }).join("");

    let detail = ui.card(ui.empty("ยังไม่มีใบเบิก"));
    if (selected) {
      const order = data.orders.find((row) => row.id === selected.orderId);
      const recipe = ctx.rules.recipeOf(data.recipes, selected.recipeId, selected.recipeRevision);
      const parts = [];
      const returnState = rules.requisitionReturnState?.(data, selected);
      if (returnState === "pending") {
        // ใบเบิกคลัง RB (20261220010000): RB / ฝ่ายวางแผนคืนเข้าคลัง RB ล็อตเดิม · ใบเดิมของคลัง ST: ST รับคืน (สิทธิ์ตามคลังของใบ rightForRequisitionReturn)
        const rbStore = rules.requisitionStore(selected) === "RB";
        const right = root.MNP_RUBBERFLOW_STORE?.rightForRequisitionReturn?.(selected) ?? "returnRequisition";
        const button = ctx.can(right) ? ui.openButton(rbStore ? "คืนเข้าคลัง RB" : "รับคืนเคมี", "returnRequisition", { id: selected.id }, { className: "small" }).replace("<button ", `<button data-rf-right="${esc(right)}" `) : "";
        parts.push(ui.callout("warn", `<div class="rf-row rf-between"><span>${esc(rbStore ? `WO ${selected.orderId} ถูกยกเลิก เคมีที่จ่ายไปแล้วยังไม่ได้ผสม คืนเข้าคลังเคมี RB ล็อตเดิม` : `WO ${selected.orderId} ถูกยกเลิก เคมีที่จ่ายไปแล้วยังไม่ได้ผสม รอคลังวัตถุดิบ (ST) รับคืนเข้าล็อตเดิม`)}</span>${button}</div>`));
      }
      const returnedNote = returnState === "returned" ? selected.lines.find((line) => line.returnedAt) : null;
      // ใบเก่าของ WO ที่ยกเลิก (รอรับคืนหรือรับคืนแล้ว) ไม่มีปุ่มเบิกทั้งใบ: เบิกต่อหลังรับคืนจะหักสต็อกที่คืนอีกไม่ได้ (ฝั่งเซิร์ฟเวอร์ยังไม่ปฏิเสธ = งานต่อ)
      if (selected.status === "weighing" && !returnState) {
        parts.push(ui.callout("warn", `<div class="rf-row rf-between"><span>ใบเบิกเก่าที่ยังจ่ายไม่ครบ</span>${ui.button("เบิกทั้งใบ", { action: "issueRequisition", args: { id: selected.id }, className: "small", confirmText: `เบิกทั้งใบ ${selected.id}? ระบบจะหักสต็อกทุกรายการที่ยังไม่จ่ายตามสูตร`, success: `เบิก ${selected.id} แล้ว`, ariaLabel: `เบิกทั้งใบ ${selected.id}` })}</div>`));
      }
      // สถานะรายบรรทัดมีความหมายเฉพาะใบเก่าที่จ่ายไม่ครบ · ใบที่จ่ายแล้วแสดงสถานะที่ป้ายในรายการและแถบสรุปแล้ว
      const lineStatus = selected.status === "weighing";
      const lineRows = selected.lines.map((line, i) => {
        const lot = data.materialLots.find((row) => row.lotNo === line.lotNo);
        const material = data.materials.find((row) => row.code === line.materialCode);
        return `<tr><td>${i + 1}</td><td>${esc(material?.name ?? "")}<div class="small muted rf-mono">${esc(line.materialCode)}</div></td><td class="nowrap">${esc(`ขั้น ${line.stage ?? 1}`)}</td><td class="rf-mono small">${esc(line.lotNo)}</td>
          <td class="small nowrap">${esc(fmtDate(lot?.expiry))}<div class="muted">${esc(lot?.location ?? "")}</div></td><td class="right rf-mono">${esc(fmtNum(line.actualKg ?? line.targetKg, 3))}</td>
          ${lineStatus ? `<td>${line.actualKg === null ? ui.badge("warn", "รอจ่าย") : ui.badge("good", "จ่ายแล้ว")}</td>` : ""}${returnedNote ? `<td class="right rf-mono">${esc(fmtNum(line.returnedKg ?? 0, 3))}</td>` : ""}</tr>`;
      });
      parts.push(ui.card(`<div class="rf-card-pad">${ui.kv([["ใบสั่งผลิต", esc(`${order?.id ?? "-"} · ${order?.customer ?? ""}`)], ["สูตร", esc(`${rules.recipeLabel(recipe)} · ${selected.batches} ชุดผสม · ${fmtNum(selected.totalKg, 2)} kg`)], ["ผู้ขอเบิก", esc(`${selected.requestedBy ?? "-"} · ${fmtDateTime(selected.createdAt)}`)],
        selected.issuedBy ? ["ผู้จ่าย", esc(`${selected.issuedBy} · ${fmtDateTime(selected.issuedAt)}`)] : null, selected.consumedBy ? ["ใช้ผสมเป็น", ui.mono(selected.consumedBy)] : null,
        returnedNote ? ["ผู้รับคืน", esc(`${returnedNote.returnedBy || "-"} · ${fmtDateTime(returnedNote.returnedAt)}${returnedNote.returnNote ? ` · ${returnedNote.returnNote}` : ""}`)] : null])}</div>
        ${ui.table(["#", "วัตถุดิบ", "ขั้น", "ล็อตที่จ่าย (FEFO)", "หมดอายุ", { label: "จ่าย (kg)", className: "right" }, ...(lineStatus ? ["สถานะ"] : []), ...(returnedNote ? [{ label: "รับคืน (kg)", className: "right" }] : [])], lineRows)}`,
      { title: `ใบเบิก ${esc(selected.id)}`, actions: ui.openButton("พิมพ์ป้าย", "tag", { kind: "requisition", id: selected.id }, { className: "secondary small" }), flush: true }));
      detail = `<div class="rf-stack">${parts.join("")}</div>`;
    }
    const html = `${ui.pageHead("เบิกเคมี", "แตกสูตรเป็นรายการเบิก จัดสรรล็อตตามหลัก FEFO บล็อกล็อตหมดอายุ และจ่ายทันทีเมื่อกดเบิก", ui.openButton("สร้างใบเบิก", "createRequisition", {}, { className: "" }))}
      <div class="rf-split">${ui.card(`<div class="rf-list rf-list-tall">${listHtml || ui.empty("ยังไม่มีใบเบิก")}</div>`, { title: "ใบเบิก", flush: true })}${detail}</div>`;
    return { html };
  };

  dialogs.createRequisition = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const { recipeLines, allocateFefo, fmtNum } = rules;
    // ลิสต์เฉพาะ WO ที่ยังมีชุดผสม (batch) ไม่ได้เบิก (เบิกครบแล้วไม่ขึ้นอีก) · จำนวนชุดผสมมาจาก WO ไม่ต้องกรอก
    const batchesOf = (order) => {
      const recipe = rules.recipeOf(data.recipes, order.recipeId, order.recipeRevision);
      return recipe ? rules.nextRequisitionBatches(order, recipe, data.requisitions) : 0;
    };
    const orders = data.orders.filter((order) => ["released", "in_progress"].includes(order.status) && batchesOf(order) > 0);
    const body = !orders.length ? ui.empty("ไม่มีใบสั่งผลิตที่รอเบิกเคมี") : `<div class="rf-grid rf-g3">
        ${ui.field("ใบสั่งผลิต", ui.select("orderId", orders.map((order) => ({ value: order.id, label: `${order.id} · ${rules.orderLabel(order)}` })), { value: orders[0]?.id ?? "", extra: "data-rf-order required" }), { required: true })}
        ${ui.field("จำนวนชุดผสม", ui.input("batches", { type: "number", value: "", extra: "data-rf-batches readonly" }))}
        ${ui.field("หมายเหตุ", ui.input("note"))}
      </div><div class="muted small" data-rf-recipe-line></div><div data-rf-shortage></div><div data-rf-preview></div>`;
    const html = ui.dialog("createRequisition", "เบิกเคมีตามสูตร", `<form novalidate data-rf-form="createRequisition" data-rf-success="เบิก {result} แล้ว" id="rf-create-req">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-create-req" data-rf-submit title="จ่ายทันที หักสต็อกตามล็อตที่แสดง"${orders.length ? "" : " disabled"}>เบิก</button>`, wide: true });
    const bind = (dialog, bindCtx) => {
      const submit = dialog.querySelector("[data-rf-submit]");
      const orderSelect = dialog.querySelector("[data-rf-order]");
      if (!orderSelect) return;
      const batches = dialog.querySelector("[data-rf-batches]");
      // คลังเคมี RB ไม่พอ (20261220010000): ขอเบิกส่วนที่ขาดจาก ST (หน้าต่างขอเบิกเติมจำนวนให้) · ST เป็นผู้สั่งซื้อเมื่อคลัง ST ไม่พอ
      const mayRequest = ctx.can("requestChem") && typeof (bindCtx ?? ctx).openDialog === "function";
      const reserved = rules.weighingReservedKg(data.requisitions, "RB", { remote: ctx.store.isRemote() });
      let shortRows = [];
      const paint = () => {
        const order = data.orders.find((row) => row.id === orderSelect.value);
        const recipe = order && rules.recipeOf(data.recipes, order.recipeId, order.recipeRevision);
        const n = order ? batchesOf(order) : 0;
        batches.value = n ? String(n) : "";
        // เหลือเกิน 10 batch: ใบนี้เบิกได้ 10 ที่เหลือเบิกเป็นใบถัดไป (บอกใน title ไม่เพิ่มข้อความถาวร)
        const left = order && recipe ? rules.remainingBatches(order, recipe, data.requisitions) : 0;
        batches.title = left > n ? `ใบนี้เบิกได้สูงสุด ${n} ชุดผสม · เหลืออีก ${left - n} ชุดผสม ต้องเบิกเป็นใบถัดไป` : "";
        const preview = recipe ? recipeLines(recipe).map((line) => ({ ...line, need: line.kgPerBatch * n, ...allocateFefo(data.materialLots, line.materialCode, line.kgPerBatch * n, now, reserved, "RB") })) : [];
        const short = preview.some((row) => row.shortage > 0.0001);
        // ปุ่ม "ขอเบิกจาก ST" เปิดหน้าต่างขอเบิกพร้อมจำนวนที่คลัง RB ขาดของใบเบิกนี้ (รวมต่อวัตถุดิบ)
        const shortBy = new Map();
        for (const row of preview) if (row.shortage > 0.0001) shortBy.set(row.materialCode, (shortBy.get(row.materialCode) ?? 0) + row.shortage);
        shortRows = [...shortBy].map(([materialCode, qtyKg]) => ({ materialCode, qtyKg }));
        dialog.querySelector("[data-rf-recipe-line]").textContent = recipe ? `สูตร ${rules.recipeLabel(recipe)} · น้ำหนักรวม ${fmtNum(recipe.batchKg * n, 2)} kg` : "";
        dialog.querySelector("[data-rf-shortage]").innerHTML = short ? ui.callout("bad", `<div>คลังเคมี RB มีพร้อมใช้ไม่พอ (ไม่นับล็อตหมดอายุหรือกักกัน)</div>${mayRequest ? '<button class="btn rf-btn secondary small" type="button" data-rf-po-short>ขอเบิกจาก ST</button>' : "<div>ให้แผนก RB ขอเบิกจาก ST ก่อน</div>"}`) : "";
        dialog.querySelector("[data-rf-preview]").innerHTML = ui.table(["วัตถุดิบ", "ขั้น", { label: "ต้องใช้ (kg)", className: "right" }, "ล็อตที่ระบบจะจ่าย (FEFO)"], preview.map((row) => `<tr><td class="rf-mono">${esc(row.materialCode)}</td><td class="nowrap">${esc(`ขั้น ${row.stage}`)}</td><td class="right rf-mono">${esc(fmtNum(row.need, 3))}</td><td class="small">${row.picks.map((pick) => `<div class="rf-mono">${esc(`${pick.lotNo} → ${pick.kg.toFixed(3)} kg`)}</div>`).join("")}${row.shortage > 0.0001 ? ui.badge("bad", `ขาด ${row.shortage.toFixed(2)} kg`) : ""}</td></tr>`), { emptyText: "เลือกใบสั่งผลิตก่อน" });
        if (submit) submit.disabled = !order || short;
      };
      orderSelect.addEventListener("change", paint);
      // ปุ่มอยู่ในกล่องที่วาดซ้ำทุกครั้ง จึงผูกที่กล่อง: เปิดหน้าต่างขอเบิกจาก ST พร้อมส่วนที่ขาดของใบเบิกนี้ (แทน dialog นี้)
      dialog.querySelector("[data-rf-shortage]").addEventListener("click", (event) => {
        if (!event.target?.closest?.("[data-rf-po-short]")) return;
        (bindCtx ?? ctx).openDialog?.("chemRequest", { rows: shortRows });
      });
      paint();
    };
    return { html, bind };
  };

  // รับเคมีคืน (แผนก ST): ใบเบิกที่จ่ายแล้วของ WO ที่ยกเลิก · กรอกยอดที่คืนจริงต่อบรรทัด (ค่าเริ่ม = ที่จ่ายไป) คืนไม่ครบต้องมีเหตุผล · รับคืนได้ครั้งเดียวต่อใบ
  dialogs.returnRequisition = (ctx, { id }) => {
    const { data, now, ui, rules } = ctx;
    const { fmtDate, fmtNum } = rules;
    const requisition = data.requisitions.find((row) => row.id === id);
    if (!requisition || rules.requisitionReturnState?.(data, requisition) !== "pending") return null;
    const rows = requisition.lines.map((line) => {
      const lot = data.materialLots.find((row) => row.lotNo === line.lotNo);
      const issued = typeof line.actualKg === "number" ? line.actualKg : 0;
      const state = lot ? rules.lotState(lot, now) : "";
      const control = issued > 0
        // แสดง 3 ตำแหน่ง (ยอดจ่ายจริงอาจยาวกว่านั้น) · issuedKg[] เก็บยอดเต็ม: ค่าที่ห่างจากยอดจ่ายไม่ถึง 0.0005 ส่งเป็นยอดเต็ม (คืนครบ)
        ? `<input type="hidden" name="issuedKg[]" value="${esc(String(issued))}">${ui.input("returnedKg[]", { type: "number", step: "any", min: 0, value: String(+issued.toFixed(3)), extra: `max="${esc(String(+issued.toFixed(3)))}" aria-label="${esc(`คืน ${line.materialCode} (kg)`)}"` })}`
        : `<input type="hidden" name="issuedKg[]" value="0"><input type="hidden" name="returnedKg[]" value="0"><span class="muted">—</span>`;
      return `<tr><td class="rf-mono">${esc(line.materialCode)}</td><td class="rf-mono small">${esc(line.lotNo)}${state === "expired" || state === "hold" ? ` ${ui.badge("warn", state === "expired" ? "หมดอายุแล้ว" : "กักกัน")}` : ""}<div class="small muted">${esc(lot ? `หมดอายุ ${fmtDate(lot.expiry)}` : "ไม่พบล็อต")}</div></td><td class="right rf-mono">${esc(fmtNum(issued, 3))}</td><td class="right">${control}</td></tr>`;
    });
    const rbStore = rules.requisitionStore(requisition) === "RB";
    const right = root.MNP_RUBBERFLOW_STORE?.rightForRequisitionReturn?.(requisition) ?? "returnRequisition";
    const body = `${ui.callout("info", rbStore ? "ยอดที่คืนบวกเข้าคลังเคมี RB ของล็อตเดิมแต่ละบรรทัด ล็อตคงวันหมดอายุและสถานะเดิม ใบเบิกผสมใบต่อไปจ่ายตาม FEFO จากคลัง RB" : "ยอดที่คืนบวกเข้าล็อตเดิมของแต่ละบรรทัด ล็อตคงวันหมดอายุและสถานะเดิม ล็อตที่หมดอายุแล้วยังใช้เบิกไม่ได้ (ระบบจ่ายตาม FEFO ข้ามล็อตนั้น)")}
      ${ui.table(["วัตถุดิบ", "ล็อตเดิม", { label: "จ่ายไป (kg)", className: "right" }, { label: "คืนจริง (kg)", className: "right", title: "ไม่มีของคืนใส่ 0" }], rows)}
      ${ui.field("เหตุผล (จำเป็นเมื่อคืนไม่ครบ)", ui.input("note", { placeholder: "เช่น หกระหว่างขนย้าย", extra: 'maxlength="300"' }))}`;
    const html = ui.dialog("returnRequisition", `${rbStore ? "คืนเข้าคลัง RB" : "รับเคมีคืน"} · ${requisition.id}`, `<form novalidate data-rf-form="returnRequisition" data-rf-right="${esc(right)}" data-rf-args='${esc(JSON.stringify({ id: requisition.id }))}' data-rf-success="${rbStore ? "คืนเคมีของใบเบิก {result} เข้าคลัง RB แล้ว" : "รับเคมีคืนตามใบเบิก {result} แล้ว"}" id="rf-return-req">${body}</form>`, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-return-req">${rbStore ? "คืนเข้าคลัง RB" : "รับคืนเข้าคลังวัตถุดิบ (ST)"}</button>` });
    return { html };
  };

  // ---------- คลังเคมีของ RB (20261220010000) ----------
  // ยอดเคมีที่ RB รับจาก ST ต่อล็อต (rbKg) · ใบขอเบิกจาก ST และใบคืนให้ ST พร้อมสถานะ · นับ / ปรับยอด (ผู้จัดการแผนก RB / ฝ่ายวางแผน: สิทธิ์ countRb) · ใช้จริงเทียบสูตร (rules.rbUsage)
  // ใบเบิกผสม (หน้าเบิกเคมี) ตัดคลังนี้ตามล็อต FEFO · ST จ่ายและรับคืนที่โมดูลคลังวัตถุดิบ (ST) #/st · RB ดูเคมีในคลัง ST ได้อย่างเดียวที่นั่น
  // สถานะของเอกสารคลังเคมี: ข้อความชุดเดียวกันทั้งหน้านี้และโมดูล ST (MNP_RUBBERFLOW_VIEWS.chemStatus)
  const CHEM_STATUS = Object.freeze({
    request: { open: ["warn", "รอ ST จ่าย"], partial: ["warn", "ST จ่ายบางส่วน"], done: ["good", "จ่ายครบแล้ว"], closed: ["", "ST ปิดยอดที่เหลือแล้ว"], cancelled: ["", "ยกเลิกแล้ว"] },
    return: { pending: ["warn", "รอ ST รับคืน"], received: ["good", "ST รับคืนแล้ว"], rejected: ["bad", "ST ไม่รับคืน (กลับคลัง RB)"] },
    count: { done: ["good", "นับแล้ว"] },
  });
  const chemStatus = (ui, doc) => { const [tone, text] = CHEM_STATUS[doc?.kind]?.[doc?.status] ?? ["", doc?.status ?? ""]; return ui.badge(tone, text); };
  const kgText = (rules, kg) => `${rules.fmtNum(Number(kg) || 0, 3)} kg`;
  const materialName = (data, code) => data.materials.find((row) => row.code === code)?.name ?? "";
  // บรรทัดของใบขอเบิก: ขอ / จ่ายแล้ว · ใบคืน: ล็อต kg · ใบนับ: ก่อน → นับได้ · ไม่เกิน 5 บรรทัด ที่เหลือบอกจำนวน
  const DOC_LINES = 5;
  function chemDocLines(ctx, doc) {
    const { rules } = ctx;
    const list = doc.lines ?? [];
    const line = (row) => (doc.kind === "request"
      ? `<li><span class="rf-mono">${esc(row.materialCode)}</span> <span class="nowrap">${esc(Number(row.issuedKg) > 0 ? `จ่ายแล้ว ${rules.fmtNum(row.issuedKg, 3)} จาก ${kgText(rules, row.qtyKg)}` : kgText(rules, row.qtyKg))}</span></li>`
      : doc.kind === "return" ? `<li><span class="rf-mono">${esc(row.lotNo)}</span> <span class="nowrap">${esc(kgText(rules, row.kg))}</span></li>`
      : `<li><span class="rf-mono">${esc(row.lotNo)}</span> <span class="nowrap">${esc(`${rules.fmtNum(row.beforeKg, 3)} → ${kgText(rules, row.countedKg)}`)}</span></li>`);
    return `<ul class="bom-job-parts">${list.slice(0, DOC_LINES).map(line).join("")}</ul>${list.length > DOC_LINES ? `<p class="small muted">${esc(`อีก ${list.length - DOC_LINES} รายการ`)}</p>` : ""}`;
  }
  // เวลา ผู้ทำ หมายเหตุ และเหตุผลของเอกสาร (บรรทัดเล็กใต้เลขที่)
  const chemDocMeta = (ctx, doc) => `<div class="small muted">${esc([ctx.rules.fmtDateTime(doc.createdAt), doc.createdBy].filter(Boolean).join(" · "))}</div>${doc.note ? `<div class="small muted">${esc(doc.note)}</div>` : ""}${doc.reason ? `<div class="small muted">${esc(`เหตุผล: ${doc.reason}`)}</div>` : ""}`;
  // ยอดพร้อมใช้ของวัตถุดิบในคลังที่ระบุ (ไม่นับล็อตกักกัน / หมดอายุ)
  const readyKg = (rules, lots, code, now, store) => lots.filter((lot) => lot.materialCode === code && rules.lotState(lot, now, store) === "available").reduce((sum, lot) => sum + rules.lotKg(lot, store), 0);

  // แท็บ "คลังเคมี RB" ของหน้า p=warehouse (หน้าคลังเรียกผ่าน MNP_RUBBERFLOW_VIEWS.rbStoreSection) · แท็บย่อยอยู่ใน ?view= (stock ตั้งต้น · requests · returns · usage)
  // คืน { actions: ปุ่มหัวหน้า, html: แถบแท็บย่อยและตาราง, search: ช่องค้นหา }
  const RB_TABS = Object.freeze([{ id: "stock", label: "ในคลัง RB" }, { id: "requests", label: "ใบขอเบิกจาก ST" }, { id: "returns", label: "ใบคืนให้ ST" }, { id: "usage", label: "ใช้จริงเทียบสูตร" }]);
  const USAGE_DAYS = Object.freeze([7, 30, 90]);
  const rbStoreSection = (ctx) => {
    const { data, now, ui, rules, params } = ctx;
    const tab = RB_TABS.some((entry) => entry.id === params.get("view")) ? params.get("view") : "stock";
    const docs = rules.chemDocsOf(data);
    let body = "";
    if (tab === "stock") {
      const stock = rules.rbStockLots(data, now).filter(({ lot }) => includes(`${lot.lotNo} ${lot.materialCode} ${materialName(data, lot.materialCode)}`, ctx.q));
      const rows = stock.map(({ lot, rbKg, state }) => {
        const days = Math.ceil((lot.expiry - now) / rules.DAY);
        return `<tr><td>${esc(materialName(data, lot.materialCode))}<div class="small muted rf-mono">${esc(lot.materialCode)}</div></td><td class="rf-mono small">${esc(lot.lotNo)}</td>
          <td class="nowrap">${esc(rules.fmtDate(lot.expiry))}<div class="small ${days < 0 ? "rf-late" : days < 30 ? "rf-warn-text" : "muted"}">${esc(days < 0 ? `เลยมา ${-days} วัน` : `อีก ${days} วัน`)}</div></td>
          <td class="right rf-mono">${esc(kgText(rules, rbKg))}</td><td>${state === "available" ? "" : ui.status(state)}</td></tr>`;
      });
      body = ui.table(["วัตถุดิบ", "ล็อต", "หมดอายุ", { label: "คงเหลือ", className: "right" }, ""], rows, { emptyText: ctx.q ? "ไม่พบเคมีที่ค้นหา" : "ยังไม่มีเคมีในคลัง RB ขอเบิกจาก ST ก่อน" });
    } else if (tab === "requests" || tab === "returns") {
      const kind = tab === "requests" ? "request" : "return";
      const list = docs.filter((doc) => doc.kind === kind && includes(`${doc.id} ${(doc.lines ?? []).map((line) => `${line.materialCode} ${line.lotNo ?? ""}`).join(" ")} ${doc.note ?? ""}`, ctx.q))
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      const mayCancel = ctx.can("requestChem");
      const rows = list.map((doc) => {
        const cancel = kind === "request" && doc.status === "open" && mayCancel
          ? ui.button("ยกเลิกใบ", { action: "cancelChemicalRequest", args: { id: doc.id }, className: "secondary small", confirmText: `ยกเลิก ${doc.id}? ST ยังไม่ได้จ่ายเคมีของใบนี้ ยกเลิกแล้วแก้กลับไม่ได้`, success: "ยกเลิก {result} แล้ว", ariaLabel: `ยกเลิก ${doc.id}` }) : "";
        return `<tr><td><strong class="rf-mono">${esc(doc.id)}</strong>${chemDocMeta(ctx, doc)}</td><td>${chemDocLines(ctx, doc)}</td><td>${chemStatus(ui, doc)}</td><td class="right">${cancel}</td></tr>`;
      });
      body = ui.table(["ใบ", "รายการ", "สถานะ", { label: "", className: "right" }], rows, { emptyText: ctx.q ? "ไม่พบใบที่ค้นหา" : kind === "request" ? "ยังไม่มีใบขอเบิก" : "ยังไม่มีใบคืน" });
    } else {
      const days = USAGE_DAYS.includes(Number(params.get("days"))) ? Number(params.get("days")) : params.get("days") === "all" ? null : 30;
      const usage = rules.rbUsage(data, days === null ? {} : { since: now - days * rules.DAY });
      const num = (value) => `<td class="right rf-mono">${esc(rules.fmtNum(value, 3))}</td>`;
      const rows = usage.rows.filter((row) => includes(`${row.materialCode} ${materialName(data, row.materialCode)}`, ctx.q))
        .map((row) => `<tr><td>${esc(materialName(data, row.materialCode))}<div class="small muted rf-mono">${esc(row.materialCode)}</div></td>${num(row.receivedKg)}${num(row.recipeKg)}${num(row.returnedKg)}${num(row.expectedKg)}${num(row.countAdjustKg)}${num(row.onHandKg)}</tr>`);
      const total = usage.rows.length && !ctx.q ? [`<tr><td><strong>รวม</strong></td>${num(usage.totals.receivedKg)}${num(usage.totals.recipeKg)}${num(usage.totals.returnedKg)}${num(usage.totals.expectedKg)}${num(usage.totals.countAdjustKg)}${num(usage.totals.onHandKg)}</tr>`] : [];
      const range = ui.tabs([...USAGE_DAYS.map((value) => ({ id: String(value), label: `${value} วัน` })), { id: "all", label: "ทั้งหมด" }], days === null ? "all" : String(days), (id) => ctx.pageUrl({ tab: null, view: "usage", days: id === "30" ? null : id }));
      body = `${range}${ui.table(["วัตถุดิบ", { label: "รับจาก ST (kg)", className: "right" }, { label: "ใช้ตามสูตร (kg)", className: "right", title: "กิโลตามสูตรของใบเบิกผสมที่ตัดคลัง RB หักที่คืนเข้าคลัง RB เมื่อ WO ถูกยกเลิก" }, { label: "คืนให้ ST (kg)", className: "right" },
        { label: "ควรเพิ่มตามสูตร (kg)", className: "right", title: "รับจาก ST − ใช้ตามสูตร − คืนให้ ST" }, { label: "ปรับจากการนับ (kg)", className: "right", title: "ยอดนับได้ − ยอดในระบบก่อนนับ · ติดลบ = ใช้จริงมากกว่าสูตรหรือสูญหาย" }, { label: "คงเหลือตอนนี้ (kg)", className: "right", title: "ยอดคลัง RB ตอนนี้ (ไม่ตามช่วงเวลา)" }], [...rows, ...total], { emptyText: "ยังไม่มีการรับ ใช้ หรือคืนเคมีในช่วงนี้" })}`;
    }
    const tabs = ui.tabs(RB_TABS, tab, (id) => ctx.pageUrl({ tab: null, view: id === "stock" ? null : id, q: null, days: null }));
    const factory = root.MNP_FACTORY;
    // ลิงก์ไปดูเคมีในคลัง ST: เฉพาะผู้ที่เปิดหน้านั้นได้ (โมดูล ST หรือ RB ที่ดูได้อย่างเดียว · MNP_ST_PAGES.access)
    const stAccess = typeof state !== "undefined" ? root.MNP_ST_PAGES?.access?.(state.employee) ?? null : null;
    const stLink = stAccess && factory ? ui.link("ดูเคมีในคลัง ST", factory.routeUrl("st", { tab: "stock", kind: "chem" }), "btn rf-btn secondary") : "";
    const anyStock = rules.rbStockLots(data, now).length > 0;
    const actions = [
      ui.openButton("ขอเบิกจาก ST", "chemRequest", {}, { className: "" }),
      anyStock ? ui.openButton("คืนให้ ST", "chemReturn", {}, { className: "secondary" }) : "",
      anyStock && ctx.can("countRb") ? ui.openButton("นับยอดคลัง RB", "rbCount", {}, { className: "secondary" }) : "",
      stLink,
    ].join("");
    return { actions, tabs, search: searchForm(ctx, "ค้นหารหัส ชื่อ ล็อต หรือเลขใบ…"), body };
  };
  root.MNP_RUBBERFLOW_VIEWS = Object.freeze({ ...(root.MNP_RUBBERFLOW_VIEWS ?? {}), rbStoreSection });

  // RB ขอเบิกเคมีจาก ST (ไม่ผูก WO): ทุกวัตถุดิบที่ใช้งานอยู่ (ช่องว่าง = ไม่ขอ) · args.rows = [{ materialCode, qtyKg }] เติมไว้ก่อนและอยู่บนสุด (ส่วนที่ขาดของใบเบิกผสม)
  dialogs.chemRequest = (ctx, { rows = [] } = {}) => {
    const { data, now, ui, rules } = ctx;
    const preset = new Map((Array.isArray(rows) ? rows : []).filter((row) => Number(row?.qtyKg) > 0).map((row) => [row.materialCode, Math.ceil(Number(row.qtyKg) * 1000) / 1000]));
    const materials = data.materials.filter((material) => material.active !== false)
      .sort((a, b) => Number(preset.has(b.code)) - Number(preset.has(a.code)) || a.code.localeCompare(b.code));
    if (!materials.length) return null;
    const lineRows = materials.map((material) => `<tr${preset.has(material.code) ? ' class="rf-po-need"' : ""}><td>${ui.mono(material.code)}<div class="small muted">${esc(material.name)}</div><input type="hidden" name="materialCode[]" value="${esc(material.code)}"></td>
      <td class="right rf-mono">${esc(rules.fmtNum(readyKg(rules, data.materialLots, material.code, now, "RB"), 3))}</td><td class="right rf-mono">${esc(rules.fmtNum(readyKg(rules, data.materialLots, material.code, now, "ST"), 3))}</td>
      <td>${ui.input("qtyKg[]", { type: "number", step: "any", min: 0, value: preset.has(material.code) ? String(preset.get(material.code)) : "", placeholder: "0", extra: `aria-label="${esc(`ขอเบิก ${material.code} (kg)`)}"` })}</td></tr>`);
    const body = `${preset.size ? ui.callout("warn", esc(`เติมจำนวนที่คลังเคมี RB ขาด ${preset.size} รายการให้แล้ว แก้ได้ก่อนส่ง`)) : ""}
      ${ui.table(["วัตถุดิบ", { label: "พร้อมใช้ในคลัง RB (kg)", className: "right" }, { label: "พร้อมจ่ายในคลัง ST (kg)", className: "right", title: "ไม่นับล็อตกักกันหรือหมดอายุ" }, "ขอเบิก (kg)"], lineRows)}
      ${ui.field("หมายเหตุ", ui.input("note", { placeholder: "เช่น ใช้กับ WO ที่จะปล่อยสัปดาห์หน้า", extra: 'maxlength="300"' }))}`;
    const html = ui.dialog("chemRequest", "ขอเบิกเคมีจาก ST", `<form novalidate data-rf-form="requestChemicals" data-rf-success="ส่งใบขอเบิก {result} ให้ ST แล้ว" id="rf-chem-request">${body}</form>`, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-chem-request">ขอเบิกจาก ST</button>` });
    return { html };
  };

  // RB คืนเคมีที่ไม่ใช้ให้ ST รายล็อต (ช่องว่าง = ไม่คืน) · ยอดออกจากคลัง RB ทันที ST รับคืนทั้งใบ หรือไม่รับคืน (ยอดกลับเข้าคลัง RB)
  dialogs.chemReturn = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const lots = rules.rbStockLots(data, now);
    if (!lots.length) return null;
    const rows = lots.map(({ lot, rbKg, state }) => `<tr><td>${ui.mono(lot.materialCode)}<div class="small muted">${esc(materialName(data, lot.materialCode))}</div></td><td class="rf-mono small">${esc(lot.lotNo)}<input type="hidden" name="lotNo[]" value="${esc(lot.lotNo)}"><div class="small muted">${esc(`หมดอายุ ${rules.fmtDate(lot.expiry)}`)}</div>${state === "available" ? "" : ui.status(state)}</td>
      <td class="right rf-mono">${esc(rules.fmtNum(rbKg, 3))}</td><td>${ui.input("kg[]", { type: "number", step: "any", min: 0, value: "", placeholder: "0", extra: `max="${esc(String(+rbKg.toFixed(4)))}" aria-label="${esc(`คืน ${lot.lotNo} (kg)`)}"` })}</td></tr>`);
    const body = `${ui.callout("info", "ยอดที่คืนออกจากคลัง RB ทันที ST รับคืนทั้งใบตามยอดที่ส่ง หรือไม่รับคืน (ยอดกลับเข้าคลัง RB ล็อตเดิม)")}
      ${ui.table(["วัตถุดิบ", "ล็อต", { label: "ในคลัง RB (kg)", className: "right" }, "คืน (kg)"], rows)}
      ${ui.field("หมายเหตุ", ui.input("note", { placeholder: "เช่น เหลือจากการผสม", extra: 'maxlength="300"' }))}`;
    const html = ui.dialog("chemReturn", "คืนเคมีให้ ST", `<form novalidate data-rf-form="returnChemicals" data-rf-success="ส่งใบคืน {result} ให้ ST แล้ว" id="rf-chem-return">${body}</form>`, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-chem-return">คืนให้ ST</button>` });
    return { html };
  };

  // นับ / ปรับยอดคลัง RB รายล็อต (ผู้จัดการแผนก RB / ฝ่ายวางแผน) · ช่องว่าง = ไม่เปลี่ยน · ยอดนับไม่เกินที่ล็อตอยู่นอกคลัง ST (rules.rbCountCapKg) · ต้องมีเหตุผล
  dialogs.rbCount = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const lots = rules.rbStockLots(data, now);
    if (!lots.length || !ctx.can("countRb")) return null;
    const rows = lots.map(({ lot, rbKg }) => `<tr><td>${ui.mono(lot.materialCode)}<div class="small muted">${esc(materialName(data, lot.materialCode))}</div></td><td class="rf-mono small">${esc(lot.lotNo)}<input type="hidden" name="lotNo[]" value="${esc(lot.lotNo)}"></td>
      <td class="right rf-mono">${esc(rules.fmtNum(rbKg, 3))}</td><td>${ui.input("countedKg[]", { type: "number", step: "any", min: 0, value: "", placeholder: rules.fmtNum(rbKg, 3), extra: `max="${esc(String(+rules.rbCountCapKg(data, lot).toFixed(4)))}" aria-label="${esc(`นับได้ ${lot.lotNo} (kg)`)}"` })}</td></tr>`);
    const body = `${ui.table(["วัตถุดิบ", "ล็อต", { label: "ในระบบ (kg)", className: "right" }, { label: "นับได้ (kg)", className: "right", title: "เว้นว่าง = ไม่เปลี่ยน" }], rows)}
      <div class="rf-grid rf-g2">${ui.field("เหตุผล", ui.input("reason", { required: true, placeholder: "เช่น นับสต็อกสิ้นเดือน", extra: 'minlength="3" maxlength="300"' }), { required: true })}${ui.field("หมายเหตุ", ui.input("note", { extra: 'maxlength="300"' }))}</div>`;
    const html = ui.dialog("rbCount", "นับยอดคลังเคมี RB", `<form novalidate data-rf-form="countRbStock" data-rf-success="บันทึกยอดนับ {result} แล้ว" id="rf-rb-count">${body}</form>`, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-rb-count">บันทึกยอดนับ</button>` });
    return { html };
  };
  root.MNP_RUBBERFLOW_VIEWS = Object.freeze({ ...(root.MNP_RUBBERFLOW_VIEWS ?? {}), chemStatus, chemDocLines, chemDocMeta });

  // ---------- สถานีที่ 1 ผสมยาง ----------
  pages.mixing = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const { MACHINES, fmtDuration, fmtNum } = rules;
    const lots = data.lots.filter((lot) => lot.stage === "mixing");
    // ใบเบิกของ WO ที่ถูกยกเลิกผสมต่อไม่ได้ (เคมีรอ ST รับคืน) จึงไม่อยู่ในตัวเลือก
    const issued = rules.mixableRequisitions ? rules.mixableRequisitions(data) : data.requisitions.filter((requisition) => requisition.status === "issued");
    const resting = lots.filter((lot) => lot.readyAt > now);
    // ผสมสองขั้น: ขั้นละหนึ่งแถว (อุณหภูมิเครื่องผสม Dump temp เวลา เป็นนาที) ใต้ช่องแสดงค่ามาตรฐานของสูตรในขั้นนั้น
    const stageFields = rules.MIX_STAGES.map((stage) => [
      ui.field(`อุณหภูมิเครื่องผสม ขั้น ${stage} (°C)`, ui.input(`mixerTemp${stage}`, { type: "number", step: "any", min: 0, max: 1000, required: true }), { hint: `<span data-rf-hint="mixerTemp${stage}"></span>`, required: true }),
      ui.field(`อุณหภูมิปล่อยยาง ขั้น ${stage} (°C)`, ui.input(`dumpTemp${stage}`, { type: "number", step: "any", min: 0, max: 1000, required: true, extra: `data-rf-dump="${stage}"` }), { hint: `<span data-rf-hint="dumpTemp${stage}"></span>`, required: true }),
      ui.field(`เวลาผสม ขั้น ${stage} (นาที)`, ui.input(`mixMin${stage}`, { type: "number", step: "any", min: 0, required: true }), { hint: `<span data-rf-hint="mixMin${stage}"></span>`, required: true }),
    ].join("")).join("");
    const form = issued.length === 0 ? ui.callout("warn", `ยังไม่มีใบเบิกที่จ่ายแล้ว ต้องเบิกเคมีก่อน${ctx.canSee("requisition") ? ` ${ui.link("ไปหน้าเบิกเคมี", ctx.url("requisition"), "btn rf-btn secondary small")}` : ""}`)
      : `<form novalidate data-rf-form="recordMixing" data-rf-success="บันทึก {result} แล้ว" data-rf-mixing><div class="rf-grid rf-g3">
          ${ui.field("ใบเบิกที่จ่ายครบ", ui.select("reqId", issued.map((requisition) => ({ value: requisition.id, label: `${requisition.id} · ${requisition.orderId}` })), { value: issued[0]?.id ?? "", extra: "data-rf-req required" }), { required: true })}
          ${ui.field("เครื่องผสม", ui.select("machine", MACHINES.mixing))}
          ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
          ${stageFields}
          ${ui.field("น้ำหนักยางที่ได้ (kg)", ui.input("outputKg", { type: "number", step: "any", required: true }), { hint: '<span data-rf-issued></span>', required: true })}
          ${ui.field("ของเสีย (kg)", ui.input("scrapKg", { type: "number", step: "any" }))}
          ${ui.field("สาเหตุของเสีย", ui.input("scrapReason", { placeholder: "เช่น เศษติดใบโรเตอร์" }))}
        </div><div data-rf-dump-warn></div><div class="rf-row">${ui.submitButton("บันทึกการผสม")}<span class="small muted" data-rf-rest></span></div></form>`;
    const html = `${ui.pageHead("สถานีที่ 1 · ผสมยาง", "รับวัตถุดิบที่เบิกแล้วมาผสม บันทึกอุณหภูมิปล่อยยางและเวลา ยางทุกชุดผสมต้องบ่มครบเวลาก่อนส่งไปฉีด")}
      ${ui.stats([
        { label: "อัตราได้ของดี ห้องผสม", value: stageYieldText(lots), sub: "เป้าหมาย ≥ 99.0%" },
        { label: "ผลิตแล้วสะสม", value: `${fmtNum(lots.reduce((sum, lot) => sum + lot.goodQty, 0), 0)} kg` },
        { label: "กำลังบ่ม", value: String(resting.length), sub: resting[0] ? `ใกล้ครบ: ${fmtDuration(Math.min(...resting.map((lot) => lot.readyAt)) - now)}` : "ไม่มี" },
        { label: "ของเสียสะสม", value: `${fmtNum(lots.reduce((sum, lot) => sum + lot.scrapQty, 0), 1)} kg` },
      ])}
      ${ui.card(form, { title: "บันทึกการผสม" })}
      ${stageLots(ctx, "mixing", [
        { label: "เครื่อง / กะ", render: (lot) => `${esc(lot.machine ?? "-")}<br>กะ ${esc(lot.shift ?? "-")}` },
        { label: "อุณหภูมิปล่อยยาง / เวลาผสม", render: (lot) => (lot.params.stages ?? []).map((row) => `<div class="nowrap">${esc(`ขั้น ${row.stage}: ${row.dumpTemp}°C · ${row.mixMin} นาที`)}</div>`).join("") },
      ])}`;
    const bind = (rootNode) => {
      const form = rootNode.querySelector("[data-rf-mixing]");
      if (!form) return;
      const reqSelect = form.querySelector("[data-rf-req]");
      const dumps = [...form.querySelectorAll("[data-rf-dump]")];
      const hint = (key, text) => { form.querySelector(`[data-rf-hint="${key}"]`).textContent = text; };
      const paint = () => {
        const requisition = data.requisitions.find((row) => row.id === reqSelect.value);
        const recipe = requisition && ctx.rules.recipeOf(data.recipes, requisition.recipeId, requisition.recipeRevision);
        const issuedKg = requisition ? requisition.lines.reduce((sum, line) => sum + line.actualKg, 0) : 0;
        for (const stage of ctx.rules.MIX_STAGES) {
          const standard = ctx.rules.recipeStage(recipe, stage);
          hint(`mixerTemp${stage}`, standard ? `มาตรฐาน ${standard.mixerTemp} °C` : "");
          hint(`dumpTemp${stage}`, standard ? `มาตรฐาน ${standard.dumpTemp} ± ${recipe.dumpTol} °C` : "");
          hint(`mixMin${stage}`, standard ? `มาตรฐาน ${standard.mixMin} นาที` : "");
        }
        form.querySelector("[data-rf-issued]").textContent = requisition ? `วัตถุดิบที่จ่าย ${fmtNum(issuedKg, 2)} kg` : "";
        form.querySelector("[data-rf-rest]").textContent = recipe ? `บันทึกแล้วต้องบ่มขั้นต่ำ ${recipe.restHours} ชม. ก่อนส่งต่อ` : "";
        // อุณหภูมิปล่อยยาง (Dump temp) แต่ละขั้นเทียบกับค่าของสูตรในขั้นนั้น (ค่าเผื่อเดียวกัน) · ขั้นไหนหลุด ล็อตถูกกักกัน
        const outStages = [];
        for (const dump of dumps) {
          const stage = Number(dump.dataset.rfDump);
          const standard = ctx.rules.recipeStage(recipe, stage);
          const out = Boolean(standard) && dump.value !== "" && Math.abs(Number(dump.value) - standard.dumpTemp) > recipe.dumpTol;
          dump.classList.toggle("rf-ok", Boolean(standard) && dump.value !== "" && !out);
          dump.classList.toggle("rf-out", out);
          if (out) outStages.push(stage);
        }
        form.querySelector("[data-rf-dump-warn]").innerHTML = outStages.length ? ui.callout("warn", `อุณหภูมิปล่อยยางขั้น ${outStages.join(" และขั้น ")} อยู่นอกช่วง ระบบจะกักกันล็อตนี้อัตโนมัติ`) : "";
      };
      reqSelect.addEventListener("change", paint);
      dumps.forEach((dump) => dump.addEventListener("input", paint));
      paint();
    };
    return { html, bind };
  };

  // ---------- สถานีที่ 2 ฉีดขึ้นรูป ----------
  pages.extrusion = (ctx) => {
    const { data, ui, rules } = ctx;
    const { MACHINES, SPECS, fmtNum } = rules;
    const s = SPECS.extrusion;
    const lots = data.lots.filter((lot) => lot.stage === "extrusion");
    const { ready } = inbound(data, "extrusion");
    const dies = data.molds.filter((mold) => mold.kind === "die");
    // มาตรฐานมิติมาจากสูตรของ WO ของใบส่งมอบที่เลือก (rules.orderExtrusionSpec · 20261129010000) จึงแสดงและลงสีหลังเลือกใบส่งมอบ (bind)
    // ค่าที่สูตรไม่กำหนดไม่มีมาตรฐาน ไม่ลงสี และไม่ทำให้ล็อตถูกกัก · ทุกค่ายังต้องกรอก (ฐานข้อมูลเก็บค่าที่วัดทุกล็อต)
    const dimField = (key) => ui.field(`${s[key].label} (${s[key].unit})`, ui.input(key, { type: "number", step: "any", required: true, extra: `data-rf-dim="${key}"` }), { hint: `<span data-rf-dim-hint="${key}"></span>`, required: true });
    const avgRework = lots.length ? lots.reduce((sum, lot) => sum + (lot.params.reworkPct || 0), 0) / lots.length : 0;
    const form = ready.length ? ui.card(`<form novalidate data-rf-form="recordExtrusion" data-rf-success="บันทึก {result} แล้ว" data-rf-extrusion><div class="rf-grid rf-g4">
        ${inboundSelect(ctx, "extrusion")}
        ${ui.field("ยางคอมปาวด์ที่ใช้ (kg)", ui.input("useKg", { type: "number", step: "any", required: true, extra: "data-rf-use" }), { hint: '<span data-rf-remaining></span>', required: true })}
        ${ui.field("ยางหมุนเวียนที่ผสม (kg)", ui.input("reworkKg", { type: "number", step: "any", extra: "data-rf-rework" }), { hint: '<span data-rf-rework-hint></span>' })}
        ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
        ${ui.field("เครื่องฉีด", ui.select("machine", MACHINES.extrusion))}
        ${ui.field("หัวดาย", ui.select("dieId", dies.map((die) => ({ value: die.id, label: `${die.id} · ${die.name}` })), { extra: "required" }), { required: true })}
        ${rules.EXTRUSION_KEYS.map(dimField).join("")}
        ${ui.field("งานดี (m/pcs)", ui.input("goodQty", { type: "number", step: "any", required: true }), { required: true })}
        ${ui.field("ของเสีย (m/pcs)", ui.input("scrapQty", { type: "number", step: "any" }))}
        ${ui.field("สาเหตุของเสีย", ui.input("scrapReason"))}
      </div><div data-rf-dim-warn></div><div data-rf-rework-warn></div><div class="rf-row">${ui.submitButton("บันทึกการฉีด")}</div></form>`, { title: "บันทึกการฉีด" }) : "";
    const html = `${ui.pageHead("สถานีที่ 2 · ฉีดขึ้นรูป", "ใช้ได้เฉพาะยางที่รับมอบแล้ว คุมสัดส่วนยางหมุนเวียนไม่เกิน 10% และตรวจมิติชิ้นงานกับสเปกของสูตร")}
      ${ui.stats([
        { label: "อัตราได้ของดี การฉีด", value: stageYieldText(lots), sub: "เป้าหมาย ≥ 97.0%" },
        { label: "ผลิตแล้วสะสม", value: fmtNum(lots.reduce((sum, lot) => sum + lot.goodQty, 0)), sub: "m / pcs" },
        { label: "ยางหมุนเวียนเฉลี่ย", value: `${avgRework.toFixed(1)}%`, sub: `เพดาน ${s.reworkMaxPct}%` },
        { label: "งานรอเข้าเครื่อง", value: String(ready.length), sub: "ใบส่งมอบที่รับแล้ว" },
      ])}
      ${gateNotice(ctx, "extrusion")}${form}
      ${stageLots(ctx, "extrusion", [
        { label: "เครื่อง / หัวดาย", render: (lot) => `${esc(lot.machine ?? "-")}<br>${ui.mono(lot.dieId ?? "-")}` },
        { label: "มิติ (หนา × กว้าง · g/m)", render: (lot) => esc(`${lot.params.thickness} × ${lot.params.width} · ${lot.params.weightPerM}`) },
        { label: "หมุนเวียน", render: (lot) => esc(`${lot.params.reworkPct}%`) },
      ])}`;
    const bind = (rootNode) => {
      const form = rootNode.querySelector("[data-rf-extrusion]");
      if (!form) return;
      bindInbound(form, data, "useKg");
      const use = form.querySelector("[data-rf-use]");
      const rework = form.querySelector("[data-rf-rework]");
      const paint = () => {
        const pct = Number(use.value) > 0 ? (Number(rework.value || 0) / (Number(use.value) + Number(rework.value || 0))) * 100 : 0;
        form.querySelector("[data-rf-rework-hint]").textContent = `สัดส่วน ${pct.toFixed(1)}% (ไม่เกิน ${s.reworkMaxPct}%)`;
        rework.classList.toggle("rf-ok", rework.value !== "" && pct <= s.reworkMaxPct);
        rework.classList.toggle("rf-out", rework.value !== "" && pct > s.reworkMaxPct);
        form.querySelector("[data-rf-rework-warn]").innerHTML = pct > s.reworkMaxPct ? ui.callout("bad", "สัดส่วนยางหมุนเวียนเกินเพดาน ระบบจะไม่ให้บันทึก") : "";
      };
      use.addEventListener("input", paint);
      rework.addEventListener("input", paint);
      paint();
      // มิติ: มาตรฐานของสูตรที่ WO ของใบส่งมอบที่เลือกผูก (revision ของ WO) · ยังไม่เลือกใบส่งมอบ = ยังไม่มีมาตรฐาน · สูตรไม่มีสเปก = บอกครั้งเดียวว่าไม่กักตามมิติ
      const source = form.querySelector("[data-rf-inbound]");
      const dims = [...form.querySelectorAll("[data-rf-dim]")];
      const paintDims = () => {
        const transfer = data.transfers.find((row) => row.id === source?.value) ?? null;
        const order = transfer ? data.orders.find((row) => row.id === transfer.orderId) ?? null : null;
        const spec = rules.orderExtrusionSpec(data.recipes, order);
        const out = [];
        for (const input of dims) {
          const key = input.dataset.rfDim;
          const standard = spec[key];
          const hint = form.querySelector(`[data-rf-dim-hint="${key}"]`);
          if (hint) hint.textContent = standard ? `มาตรฐาน ${rules.specText(standard)}` : "";
          const filled = Boolean(standard) && input.value !== "";
          const ok = filled && rules.inSpec(input.value, standard);
          input.classList.toggle("rf-ok", filled && ok);
          input.classList.toggle("rf-out", filled && !ok);
          if (filled && !ok) out.push(standard.label);
        }
        const warn = form.querySelector("[data-rf-dim-warn]");
        if (!warn) return;
        warn.innerHTML = out.length ? ui.callout("warn", esc(`${out.join(" และ")} นอกสเปกของสูตร ระบบจะกักกันล็อตนี้อัตโนมัติ`))
          : order && !Object.keys(spec).length ? `<p class="small muted">${esc(`สูตร ${order.recipeId} ไม่กำหนดสเปกมิติ ล็อตนี้ไม่ถูกกักตามมิติ`)}</p>` : "";
      };
      source?.addEventListener("change", paintDims);
      dims.forEach((input) => input.addEventListener("input", paintDims));
      paintDims();
    };
    return { html, bind };
  };

  // ---------- สถานีที่ 3 อบ HCM ----------
  pages.curing = (ctx) => {
    const { data, ui, rules } = ctx;
    const { SPECS, fmtNum } = rules;
    const s = SPECS.curing;
    const lots = data.lots.filter((lot) => lot.stage === "curing");
    const { ready } = inbound(data, "curing");
    const tools = data.molds.filter((mold) => mold.kind !== "die");
    const avgTemp = lots.length ? lots.reduce((sum, lot) => sum + lot.params.temp, 0) / lots.length : 0;
    const form = ready.length ? ui.card(`<form novalidate data-rf-form="recordCuring" data-rf-success="บันทึก {result} แล้ว" data-rf-curing><div class="rf-grid rf-g4">
        ${inboundSelect(ctx, "curing")}
        ${ui.field("ปริมาณที่นำเข้าอบ", ui.input("useQty", { type: "number", step: "any", required: true }), { hint: '<span data-rf-remaining></span>', required: true })}
        ${ui.field("แม่พิมพ์ / สายอบ", ui.select("moldId", tools.map((mold) => ({ value: mold.id, label: `${mold.id} · ${mold.name}` })), { extra: "required" }), { required: true })}
        ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
        ${ui.specInput("temp", s.temp.label, s.temp, { required: true })}
        ${ui.specInput("time", s.time.label, s.time, { required: true })}
        ${ui.specInput("pressure", s.pressure.label, s.pressure, { required: true })}
        <div></div>
        ${ui.field("งานดี", ui.input("goodQty", { type: "number", step: "any", required: true }), { required: true })}
        ${ui.field("ของเสีย", ui.input("scrapQty", { type: "number", step: "any" }))}
        ${ui.field("สาเหตุของเสีย", ui.input("scrapReason", { placeholder: "เช่น ฟองอากาศ, ยางไม่เต็มแบบ" }))}
      </div><div data-rf-spec-warn></div><div class="rf-row">${ui.submitButton("บันทึกการอบ")}</div></form>`, { title: "บันทึกการอบ" }) : "";
    const html = `${ui.pageHead("สถานีที่ 3 · อบ HCM", "คุมอุณหภูมิ เวลา และความดันตามสเปก ถ้าค่าหลุดช่วง ระบบจะกักกันล็อตอัตโนมัติ และนับรอบการใช้แม่พิมพ์ให้")}
      ${ui.stats([
        { label: "อัตราได้ของดี การอบ", value: stageYieldText(lots), sub: "เป้าหมาย ≥ 98.0%" },
        { label: "ผ่านการอบสะสม", value: fmtNum(lots.reduce((sum, lot) => sum + lot.goodQty, 0)), sub: "m / pcs" },
        { label: "อุณหภูมิเฉลี่ย", value: `${avgTemp.toFixed(1)}°C`, sub: `มาตรฐาน ${s.temp.target} ± ${s.temp.tol}` },
        { label: "ล็อตถูกกักกัน", value: String(lots.filter((lot) => lot.qc === "hold").length), tone: "warn" },
      ])}
      ${gateNotice(ctx, "curing")}${form}
      ${stageLots(ctx, "curing", [
        { label: "แม่พิมพ์ / สายอบ", render: (lot) => ui.mono(lot.moldId ?? "-") },
        { label: "อุณหภูมิ · เวลา · ความดัน", render: (lot) => esc(`${lot.params.temp}°C · ${lot.params.time}s · ${lot.params.pressure} bar`) },
      ])}`;
    const bind = (rootNode) => {
      const form = rootNode.querySelector("[data-rf-curing]");
      if (!form) return;
      bindInbound(form, data, "useQty");
      const paint = () => {
        const out = ["temp", "time", "pressure"].filter((key) => { const input = form.querySelector(`[name="${key}"]`); return input.value !== "" && !rules.inSpec(input.value, s[key]); });
        form.querySelector("[data-rf-spec-warn]").innerHTML = out.length ? ui.callout("warn", esc(`${out.map((key) => s[key].label).join(", ")} อยู่นอกสเปก ล็อตนี้จะถูกกักกันอัตโนมัติ`)) : "";
      };
      ["temp", "time", "pressure"].forEach((key) => form.querySelector(`[name="${key}"]`).addEventListener("input", paint));
    };
    return { html, bind };
  };

  // ---------- สถานีที่ 4 ตกแต่งและบรรจุ ----------
  // ล็อตตกแต่งที่ส่งคลังยางเส้นยาว (SR) อยู่ที่ไหนแล้ว: ป้ายสถานะใต้ข้อความ "ส่งคลังยางเส้นยาว (SR)" จากข้อมูล BOM ที่โหลดอยู่ (ctx.bomRodLot) · ไม่มีข้อมูล = ไม่แสดงอะไร (ข้อความเดิม)
  // ป้ายเป็นลิงก์ไปหน้าล็อตของ SR เมื่อผู้ใช้เปิดโมดูล SR ได้
  const SR_STATE = Object.freeze({ pending: ["warn", () => "รอ SR รับเข้า"], stored: ["good", (sr) => `SR รับแล้ว${sr.location ? ` · ตำแหน่ง ${sr.location}` : ""}`], held: ["bad", () => "กักรอ QA"], returned: ["", () => "QA คืนให้แก้ไข"], scrapped: ["", () => "QA สั่งทิ้ง"] });
  function srStateHtml(ctx, lot) {
    const sr = ctx.bomRodLot?.(lot.id);
    const entry = sr ? SR_STATE[sr.status] : null;
    if (!entry) return "";
    const badge = ctx.ui.badge(entry[0], entry[1](sr));
    return `<div class="small" data-rf-sr-state>${sr.href ? `<a href="${esc(sr.href)}" title="เปิดล็อตนี้ในคลังยางเส้นยาว (SR)">${badge}</a>` : badge}</div>`;
  }

  // ผลตัดสินของล็อตตกแต่ง: ค่า = qcResult หรือ qcResult:ปลายทาง (แยกเป็น qcResult + destination ที่ TRANSFORMS ของ module-rubberflow.js) · ต้องเลือกเอง ไม่มีค่าตั้งต้น (20261207010000)
  // WO ที่มาจากงาน RB ของ BOM (linked): ยางเส้นยาวเข้าคลังยางเส้นยาว (SR) · ส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป (WH) · กักรอ QC · WO ที่ไม่ผูกงาน: ไม่มี SR
  const FINISH_RESULT_PLACEHOLDER = "เลือกผลตัดสิน…";
  const finishResultOptions = (linked) => [
    ...(linked ? [{ value: "pass:sr", label: "ผ่าน — ส่งเข้าคลังยางเส้นยาว (SR)" }] : []),
    { value: "pass:customer", label: "ผ่าน — ส่งมอบให้ลูกค้า ผ่านคลังสินค้าสำเร็จรูป (WH)" },
    { value: "hold", label: "กักรอ QC" },
  ];
  // ข้อความแจ้งผลหลังบันทึก ตามทางที่เลือก
  const finishSuccessText = (linked, choice, base = "บันทึก {result} และสร้างป้ายกล่องแล้ว") => (choice === "pass:sr" ? "บันทึก {result} แล้ว ยางเส้นยาวส่งเข้าคลังยางเส้นยาว (SR)"
    : choice === "pass:customer" ? "บันทึก {result} และสร้างป้ายกล่องแล้ว กล่องรอคลังสินค้าสำเร็จรูป (WH) รับเข้า"
    : linked && choice === "hold" ? "บันทึก {result} แล้ว กักรอ QC" : base);
  // ล็อตที่ส่งมอบให้ลูกค้าผ่าน WH อยู่ที่ไหนแล้ว (จากกล่องของล็อต): รอ WH รับเข้า / WH รับแล้ว / ส่งมอบแล้ว · ป้ายเป็นลิงก์ไปหน้าล็อตของ WH เมื่อผู้ใช้เปิดโมดูล WH ได้
  // CoA อยู่ที่โมดูล QA (#/qa?tab=coa · โรงงานขั้น 5): ลิงก์ไปที่ล็อตนั้นเฉพาะผู้ที่เปิดโมดูล QA ได้ (QA ฝ่ายวางแผน ผู้จัดการ) · แผนก RB ไม่เห็นปุ่ม (เห็นผล QC ของล็อตในคอลัมน์ QC อย่างเดียว)
  function qaCoaLink(ctx, lot) {
    const factory = root.MNP_FACTORY;
    const open = typeof state !== "undefined" && Boolean(factory?.canOpenDeptModule?.(state.employee, "QA", "FACTORY_QA"));
    return open ? ctx.ui.link("ดู CoA", factory.routeUrl("qa", { tab: "coa", lot: lot.id }), "btn rf-btn secondary small") : "";
  }
  function whStateHtml(ctx, lot) {
    const boxes = (ctx.data.fgBoxes ?? []).filter((box) => box.lotId === lot.id);
    if (!boxes.length || lot.qc !== "pass") return "";
    const count = (status) => boxes.filter((box) => box.status === status).length;
    const shipped = count("shipped");
    const [tone, text] = count("pending_wh") ? ["warn", "รอ WH รับเข้า"] : shipped === boxes.length ? ["", "ส่งมอบแล้ว"] : ["good", shipped ? `WH รับแล้ว · ส่งมอบแล้ว ${shipped}/${boxes.length}` : "WH รับแล้ว"];
    const badge = ctx.ui.badge(tone, text);
    const factory = root.MNP_FACTORY;
    const open = typeof state !== "undefined" && Boolean(factory?.canOpenDeptModule?.(state.employee, "WH", "FACTORY_WH"));
    return `<div class="small" data-rf-wh-state>${open ? `<a href="${esc(factory.routeUrl("wh", { lot: lot.id }))}" title="เปิดล็อตนี้ในคลังสินค้าสำเร็จรูป (WH)">${badge}</a>` : badge}</div>`;
  }

  pages.finishing = (ctx) => {
    const { data, ui, rules } = ctx;
    const { fmtNum } = rules;
    const lots = data.lots.filter((lot) => lot.stage === "finishing");
    const { ready } = inbound(data, "finishing");
    const form = ready.length ? ui.card(`<form novalidate data-rf-form="recordFinishing" data-rf-success="บันทึก {result} และสร้างป้ายกล่องแล้ว" data-rf-finishing><div class="rf-grid rf-g4">
        ${inboundSelect(ctx, "finishing")}
        ${ui.field("ปริมาณที่รับเข้าตกแต่ง", ui.input("useQty", { type: "number", step: "any", required: true }), { hint: '<span data-rf-remaining></span>', required: true })}
        ${ui.field("ผ่านการตรวจ 100%", ui.input("passedQty", { type: "number", step: "any", required: true, extra: "data-rf-passed" }), { required: true })}
        ${ui.field("ของเสียจากการตกแต่ง", ui.input("scrapQty", { type: "number", step: "any" }))}
        ${ui.field("จำนวนต่อกล่อง", ui.input("perBox", { type: "number", step: "any", required: true, extra: "data-rf-perbox" }), { hint: '<span data-rf-boxes></span>', required: true, className: "rf-perbox-field" })}
        ${ui.field("เกรด", ui.select("grade", ["A", "B"]))}
        ${ui.field("ผลตัดสินของล็อต", ui.select("qcResult", finishResultOptions(false), { placeholder: FINISH_RESULT_PLACEHOLDER, extra: 'required data-rf-result title="ผ่าน = นับยอดเข้าใบสั่งผลิต · WO ที่มาจากงาน RB ของ BOM เลือกได้ว่าส่งเข้าคลังยางเส้นยาว (SR) หรือส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป (WH) · WO ที่ไม่ผูกงานส่งมอบให้ลูกค้าผ่าน WH · กักรอ QC = รอ QA ตัดสิน"' }), { required: true })}
        ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
      </div><div data-rf-linked-note hidden>${ui.callout("info", "WO นี้มาจากงาน RB ของใบสั่งผลิต (BOM): ถ้าส่งเข้าคลังยางเส้นยาว (SR) ไม่สร้างกล่องสินค้า · SR รับเข้าและตรวจขนาด แล้วงาน RB ของใบจึงนับยอด · ถ้าส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป (WH) สร้างกล่อง · WH รับเข้าแล้วงาน RB ของใบจึงนับยอด")}</div><div class="rf-row">${ui.submitButton("บันทึกและพิมพ์ป้ายกล่อง")}</div></form>`, { title: "บันทึกการตกแต่งและบรรจุ" }) : "";
    const html = `${ui.pageHead("สถานีที่ 4 · ตกแต่งและบรรจุ", "ตัดแต่งครีบ ตรวจ 100% แล้วบรรจุกล่อง ระบบสร้างเลขกล่องให้อัตโนมัติ แล้วคลังสินค้าสำเร็จรูป (WH) รับเข้า")}
      ${ui.stats([
        { label: "อัตราได้ของดี ตกแต่ง", value: stageYieldText(lots), sub: "เป้าหมาย ≥ 99.0%" },
        { label: "ผ่าน QC สะสม", value: fmtNum(lots.reduce((sum, lot) => sum + lot.goodQty, 0)), sub: "m / pcs" },
        { label: "กล่องรอ WH รับเข้า", value: String(data.fgBoxes.filter((box) => box.status === "pending_wh").length) },
        { label: "ล็อตพร้อมออก CoA", value: String(lots.filter((lot) => lot.qc === "pass").length) },
      ])}
      ${gateNotice(ctx, "finishing")}${form}
      ${stageLots(ctx, "finishing", [
        { label: "บรรจุ", render: (lot) => {
          const toSr = data.orders.find((row) => row.id === lot.orderId)?.sourceJobId && !(Number(lot.boxes) > 0);
          if (!toSr) return `${esc(`${lot.boxes} กล่อง × ${fmtNum(lot.params.perBox)} · เกรด ${lot.grade}`)}${whStateHtml(ctx, lot)}`;
          return `${esc(`ส่งคลังยางเส้นยาว (SR) · เกรด ${lot.grade}`)}${srStateHtml(ctx, lot)}`;
        } },
        { label: "CoA", render: (lot) => qaCoaLink(ctx, lot) },
      ])}`;
    const bind = (rootNode) => {
      const form = rootNode.querySelector("[data-rf-finishing]");
      if (!form) return;
      const currentTransfer = bindInbound(form, data, "useQty");
      const passed = form.querySelector("[data-rf-passed]");
      const perBox = form.querySelector("[data-rf-perbox]");
      // ผลตัดสิน: WO ที่มาจากงาน RB ของ BOM มี 3 ทาง (ยางเส้นยาวเข้า SR / ส่งมอบให้ลูกค้าผ่าน WH / กักรอ QC) WO ที่ไม่ผูกงานมี 2 ทาง · ต้องเลือกเอง ไม่มีค่าตั้งต้น
      // กล่องเกิดเมื่อของไปหาลูกค้า (WO ที่ไม่ผูกงานทุกผล หรือ WO ที่ผูกงานที่เลือกส่งมอบให้ลูกค้า): ช่องจำนวนต่อกล่องแสดงและบังคับเฉพาะกรณีนั้น (ไม่ส่งค่า = ฐานข้อมูลไม่บังคับ perBox ของ WO ที่ผูกงานที่ไม่สร้างกล่อง)
      // ผูกงาน = กฎเดียวกับฐานข้อมูล (ctx.bomLinked: sourceJobId และงานนั้นมีอยู่ใน BOM ถ้าโหลดแล้ว)
      const result = form.querySelector("[data-rf-result]");
      const perBoxField = form.querySelector(".rf-perbox-field");
      const linkedNote = form.querySelector("[data-rf-linked-note]");
      const submit = form.querySelector('button[type="submit"]');
      const baseSuccess = form.dataset?.rfSuccess;
      const isLinked = (order) => (typeof ctx.bomLinked === "function" ? ctx.bomLinked(order) : Boolean(order?.sourceJobId));
      const linkedOrder = () => { const transfer = currentTransfer(); const order = transfer ? data.orders.find((row) => row.id === transfer.orderId) : null; return order && isLinked(order) ? order : null; };
      const resultOptions = (linked, keep) => [`<option value="">${esc(FINISH_RESULT_PLACEHOLDER)}</option>`, ...finishResultOptions(linked).map((option) => `<option value="${esc(option.value)}"${option.value === keep ? " selected" : ""}>${esc(option.label)}</option>`)].join("");
      const paint = () => {
        const boxed = !linkedOrder() || result.value === "pass:customer";
        const boxes = boxed && Number(perBox.value) > 0 && Number(passed.value) > 0 ? Math.ceil(Number(passed.value) / Number(perBox.value)) : 0;
        form.querySelector("[data-rf-boxes]").textContent = boxes ? `จะได้ ${boxes} กล่อง` : "";
      };
      const sync = () => {
        const transfer = currentTransfer();
        const linked = linkedOrder();
        const choice = result.value;
        const boxed = !linked || choice === "pass:customer";
        if (perBoxField) perBoxField.hidden = !boxed;
        if (linkedNote) linkedNote.hidden = !linked;
        perBox.required = boxed;
        if (!boxed) perBox.value = "";
        else if (transfer && !perBox.value) perBox.value = transfer.uom === "m" ? "100" : "2000";
        if (form.dataset) form.dataset.rfSuccess = finishSuccessText(linked, choice, baseSuccess);
        if (submit) submit.textContent = boxed ? "บันทึกและพิมพ์ป้ายกล่อง" : "บันทึกการตกแต่ง";
        paint();
      };
      form.querySelector("[data-rf-inbound]").addEventListener("change", () => {
        result.innerHTML = resultOptions(Boolean(linkedOrder()), result.value);
        sync();
      });
      result.addEventListener("change", sync);
      passed.addEventListener("input", paint);
      perBox.addEventListener("input", paint);
    };
    return { html, bind };
  };

  // ---------- ส่งมอบ WIP ----------
  pages.wip = (ctx) => {
    const { data, now, ui, rules, actions, params } = ctx;
    const { STAGES, STAGE_LABEL, NEXT_STAGE, fmtDateTime, fmtNum } = rules;
    const tab = ["in_transit", "received", "all"].includes(params.get("tab")) ? params.get("tab") : "in_transit";
    const rows = [...data.transfers].sort((a, b) => b.createdAt - a.createdAt).filter((transfer) => tab === "all" || transfer.status === tab).filter((transfer) => includes(`${transfer.id} ${transfer.lotId} ${transfer.orderId}`, ctx.q));
    const sendable = data.lots.filter((lot) => actions.transferableQty(lot, now) > 0).sort((a, b) => b.createdAt - a.createdAt);
    // หนึ่งแถวต่อสถานี: ชื่อคอลัมน์อยู่ครั้งเดียวที่หัวตาราง (ไม่พิมพ์ซ้ำทุกการ์ด)
    const flowRows = STAGES.map((stage) => {
      const inTransit = data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "in_transit").length;
      const available = data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "received" && transfer.remaining > 0).length;
      return `<tr><td><strong>${esc(STAGE_LABEL[stage])}</strong></td><td class="right">${esc(stage === "mixing" ? "-" : String(inTransit))}</td><td class="right">${esc(stage === "mixing" ? `${data.requisitions.filter((requisition) => requisition.status === "issued").length} ใบเบิก` : String(available))}</td><td class="right">${esc(`${sendable.filter((lot) => lot.stage === stage).length} ล็อต`)}</td></tr>`;
    });
    const flow = ui.card(ui.table(["สถานี", { label: "รอรับมอบ", className: "right" }, { label: "รับแล้วรอใช้", className: "right" }, { label: "พร้อมส่งต่อ", className: "right" }], flowRows), { flush: true });
    const sendRows = sendable.map((lot) => `<tr><td>${ui.mono(lot.id)}<div class="small muted">${esc(lot.orderId)}</div></td><td>${esc(`${STAGE_LABEL[lot.stage]} → ${STAGE_LABEL[NEXT_STAGE[lot.stage]]}`)}</td><td class="right">${esc(`${fmtNum(actions.transferableQty(lot, now), 2)} ${unitText(lot.uom)}`)}</td><td class="right">${ui.openButton("สร้างใบส่งมอบ", "transfer", { lotId: lot.id }, { className: "small" })}</td></tr>`);
    const transferRows = rows.map((transfer) => {
      const diff = transfer.qtyReceived === null ? null : transfer.qtyReceived - transfer.qtySent;
      return `<tr><td>${ui.mono(transfer.id)}<div class="small muted">${esc(`${fmtDateTime(transfer.createdAt)} · ${transfer.createdBy ?? "-"}`)}</div></td><td class="rf-mono small">${esc(transfer.lotId)}<div class="muted">${esc(transfer.orderId)}</div></td>
        <td class="small">${esc(`${STAGE_LABEL[transfer.from]} → ${STAGE_LABEL[transfer.to]}`)}</td><td class="right nowrap">${esc(`${fmtNum(transfer.qtySent, 2)} ${unitText(transfer.uom)}`)}</td><td class="right">${transfer.qtyReceived === null ? "-" : esc(fmtNum(transfer.qtyReceived, 2))}</td>
        <td class="right${diff < 0 ? " rf-late" : ""}">${diff === null ? "-" : esc(fmtNum(diff, 2))}</td><td>${ui.status(transfer.status)}${transfer.condition && transfer.condition !== "ok" ? `<div class="small rf-warn-text">${esc(transfer.condition)}</div>` : ""}</td>
        <td class="right"><div class="rf-row rf-end">${ui.openButton("ป้าย", "tag", { kind: "transfer", id: transfer.id }, { className: "secondary small", ariaLabel: `พิมพ์ป้าย ${transfer.id}` })}${transfer.status === "in_transit" ? ui.openButton("รับมอบ", "receive", { id: transfer.id }, { className: "small" }) : ""}</div></td></tr>`;
    });
    const tabs = ui.tabs([{ id: "in_transit", label: `รอรับมอบ (${data.transfers.filter((transfer) => transfer.status === "in_transit").length})` }, { id: "received", label: "รับมอบแล้ว" }, { id: "all", label: "ทั้งหมด" }], tab, (id) => ctx.pageUrl({ tab: id === "in_transit" ? null : id, q: null }));
    const html = `${ui.pageHead("ส่งมอบงานระหว่างผลิต (WIP)", "ด่านรับมอบ (Gatekeeper): สถานีถัดไปเริ่มผลิตได้ก็ต่อเมื่อสแกนรับมอบและยืนยันจำนวนจริงแล้ว")}
      ${flow}
      ${sendable.length ? ui.card(ui.table(["ล็อต", "เส้นทาง", { label: "ส่งได้", className: "right" }, { label: "", className: "right" }], sendRows), { title: "ล็อตที่พร้อมส่งต่อ", flush: true }) : ""}
      ${ui.card(`<div class="rf-listbar">${tabs}${searchForm(ctx, "ค้นหาใบส่งมอบ ล็อต ใบสั่งผลิต…")}</div>${ui.table(["ใบส่งมอบ", "ล็อตต้นทาง", "เส้นทาง", { label: "ส่ง", className: "right" }, { label: "รับจริง", className: "right" }, { label: "ผลต่าง", className: "right" }, "สถานะ", { label: "", className: "right" }], transferRows, { emptyText: "ไม่มีใบส่งมอบ" })}`, { flush: true })}`;
    return { html };
  };

  dialogs.receive = (ctx, { id }) => {
    const { data, ui, rules } = ctx;
    const transfer = data.transfers.find((row) => row.id === id);
    if (!transfer) return null;
    const body = `${ui.kv([["ล็อต", ui.mono(transfer.lotId)], ["เส้นทาง", esc(`${rules.STAGE_LABEL[transfer.from]} → ${rules.STAGE_LABEL[transfer.to]}`)], ["จำนวนที่ส่ง", esc(`${transfer.qtySent} ${unitText(transfer.uom)}`)]])}
      <div class="rf-grid rf-g2">${ui.field(`จำนวนที่ตรวจนับ/ชั่งได้จริง (${unitText(transfer.uom)})`, ui.input("qtyReceived", { type: "number", step: "any", value: String(transfer.qtySent), required: true, extra: "data-rf-received" }), { required: true })}
      ${ui.field("สภาพชิ้นงาน / ภาชนะ", ui.select("condition", [{ value: "ok", label: "สมบูรณ์" }, { value: "ภาชนะชำรุด", label: "ภาชนะชำรุด / ป้ายเลือน" }, { value: "ปริมาณขาด", label: "ปริมาณขาดเกินเกณฑ์" }]))}</div><div data-rf-diff></div>`;
    const html = ui.dialog("receive", `รับมอบงาน · ${transfer.id}`, `<form novalidate data-rf-form="receiveTransfer" data-rf-args='${esc(JSON.stringify({ id: transfer.id }))}' data-rf-success="รับมอบงานแล้ว สถานีเริ่มผลิตได้" id="rf-receive">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-receive">ยืนยันรับเข้า</button>` });
    const bind = (dialog) => {
      const input = dialog.querySelector("[data-rf-received]");
      const paint = () => {
        const diff = Number(input.value) - transfer.qtySent;
        dialog.querySelector("[data-rf-diff]").innerHTML = Math.abs(diff) > 1e-9 && input.value !== "" ? ui.callout(diff < 0 ? "warn" : "info", esc(`ผลต่าง ${rules.fmtNum(diff, 2)} ${unitText(transfer.uom)} จะถูกบันทึกในประวัติการส่งมอบ`)) : "";
      };
      input.addEventListener("input", paint);
    };
    return { html, bind };
  };

  root.MNP_RUBBERFLOW_LINE = { stageYield, inbound, finishResultOptions, finishSuccessText };
})(typeof window !== "undefined" ? window : globalThis);
