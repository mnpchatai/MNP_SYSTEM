// RubberFlow MES (แผนก RB โหมดทดสอบ) — หน้าสายการผลิต: เบิกและชั่งเคมี · 1 ผสมยาง · 2 ฉีดขึ้นรูป · 3 อบ HCM · 4 ตกแต่งและบรรจุ · ส่งมอบ WIP
// ยกมาจาก pages/Requisition.jsx, Mixing.jsx, Extrusion.jsx, Curing.jsx, Finishing.jsx, Wip.jsx และ components/StageCommon.jsx ของต้นแบบ
// ลงทะเบียนใน window.MNP_RUBBERFLOW_PAGES / _DIALOGS กติกา event อยู่ที่ modules/module-rubberflow.js — โหลดหลัง modules/rubberflow-ui.js
(function (root) {
  const pages = (root.MNP_RUBBERFLOW_PAGES ??= {});
  const dialogs = (root.MNP_RUBBERFLOW_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  const includes = (haystack, q) => !q || String(haystack).toLowerCase().includes(q.toLowerCase());
  const searchForm = (ctx, placeholder) => `<form class="rf-search" data-rf-search data-rf-keep="tab" role="search"><label class="sr-only" for="rf-q">ค้นหา</label>${ctx.ui.input("q", { id: "rf-q", type: "search", value: ctx.q, placeholder })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>`;

  // ---------- ส่วนที่สถานีใช้ร่วมกัน (StageCommon) ----------
  const stageYield = (lots) => {
    const good = lots.reduce((sum, lot) => sum + lot.goodQty, 0);
    const scrap = lots.reduce((sum, lot) => sum + lot.scrapQty, 0);
    return good + scrap ? (good / (good + scrap)) * 100 : 100;
  };
  // งานที่รับมอบเข้าสถานีแล้ว (Gatekeeper ยอมให้ใช้) และที่ยังรอรับ
  const inbound = (data, stage) => ({
    ready: data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "received" && transfer.remaining > 0.0001),
    waiting: data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "in_transit"),
  });
  const shiftOptions = (rules) => rules.SHIFTS.map((shift) => ({ value: shift.id, label: shift.label }));

  function gateNotice(ctx, stage) {
    const { ready, waiting } = inbound(ctx.data, stage);
    if (ready.length) return "";
    return ctx.ui.callout("warn", `<strong>Gatekeeper:</strong> ยังไม่มีงานที่รับมอบเข้าสถานี${esc(ctx.rules.STAGE_LABEL[stage])} จึงยังเริ่มบันทึกการผลิตไม่ได้${waiting.length ? ` · มี ${waiting.length} ใบส่งมอบรอรับ ${ctx.ui.link("ไปหน้ารับมอบ", ctx.url("wip"), "btn rf-btn secondary small")}` : ""}`);
  }

  // ตัวเลือกใบส่งมอบที่รับแล้ว — data-rf-inbound ให้ bind เติมปริมาณคงเหลือลงช่องถัดไปอัตโนมัติ
  function inboundSelect(ctx, stage) {
    const { ready } = inbound(ctx.data, stage);
    return ctx.ui.field("งานที่รับมอบแล้ว (ต้นทาง) *", ctx.ui.select("transferId", ready.map((transfer) => ({ value: transfer.id, label: `${transfer.lotId} · คงเหลือ ${transfer.remaining} ${transfer.uom} (${transfer.orderId})` })), { placeholder: "เลือกใบส่งมอบ…", extra: "data-rf-inbound required" }));
  }
  const bindInbound = (rootNode, data, targetName) => {
    const select = rootNode.querySelector("[data-rf-inbound]");
    const target = rootNode.querySelector(`[name="${targetName}"]`);
    const hint = rootNode.querySelector("[data-rf-remaining]");
    if (!select || !target) return () => null;
    const pick = () => {
      const transfer = data.transfers.find((row) => row.id === select.value) ?? null;
      target.value = transfer ? String(transfer.remaining) : "";
      if (hint) hint.textContent = transfer ? `คงเหลือ ${transfer.remaining} ${transfer.uom}` : "";
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
        resting && ctx.can("demoSkip") ? ui.button("ข้ามเวลาบ่ม", { action: "endRest", args: { lotId: lot.id }, className: "secondary small" }) : "",
        NEXT_STAGE[stage] && available > 0 ? ui.openButton("ส่งต่อ", "transfer", { lotId: lot.id }, { className: "small" }) : "",
        NEXT_STAGE[stage] && available === 0 && lot.transferredQty >= lot.goodQty - 1e-6 ? `<span class="small muted">ส่งต่อครบแล้ว</span>` : "",
      ].filter(Boolean).join(" ");
      return `<tr><td>${ui.mono(lot.id)}<div class="small muted">${esc(`${fmtDateTime(lot.createdAt)} · ${lot.operator ?? "-"}`)}</div></td><td class="rf-mono small">${esc(lot.orderId)}</td>
        ${columns.map((column) => `<td class="small">${column.render(lot)}</td>`).join("")}
        <td class="right nowrap">${esc(fmtNum(lot.goodQty, 2))} / <span class="muted">${esc(fmtNum(lot.scrapQty, 2))}</span> ${esc(lot.uom)}</td>
        <td>${ui.status(lot.qc)}${lot.holdReasons?.length ? `<div class="small rf-warn-text">${esc(lot.holdReasons.join(", "))}</div>` : ""}${resting ? `<div class="small muted">⏱ บ่มอีก ${esc(fmtDuration(lot.readyAt - now))}</div>` : ""}</td>
        <td class="right"><div class="rf-row rf-end">${buttons}</div></td></tr>`;
    });
    return ui.card(ui.table(["ล็อต", "ใบสั่งผลิต", ...columns.map((column) => column.label), { label: "งานดี / เสีย", className: "right" }, "QC", { label: "จัดการ", className: "right" }], rows, { emptyText: "ยังไม่มีล็อตที่บันทึก" }), { title: `ล็อตที่บันทึกแล้ว (${lots.length})`, flush: true });
  }

  dialogs.transfer = (ctx, { lotId }) => {
    const { data, now, ui, rules, actions } = ctx;
    const lot = data.lots.find((row) => row.id === lotId);
    if (!lot) return null;
    const available = actions.transferableQty(lot, now);
    const body = `${ui.callout("info", esc(`${rules.STAGE_LABEL[lot.stage]} → ${rules.STAGE_LABEL[rules.NEXT_STAGE[lot.stage]] ?? "-"} · สถานีปลายทางต้องกดรับมอบและยืนยันจำนวนจริงก่อนจึงจะเริ่มผลิตได้`))}
      <div class="rf-grid rf-g2">${ui.field(`จำนวนส่งมอบ (${lot.uom})`, ui.input("qty", { type: "number", step: "any", value: String(available), required: true }), { hint: esc(`ส่งได้สูงสุด ${available}`) })}${ui.field("หมายเหตุ / Pallet ID", ui.input("note"))}</div>`;
    const html = ui.dialog("transfer", `ส่งมอบ WIP · ${lot.id}`, `<form data-rf-form="createTransfer" data-rf-args='${esc(JSON.stringify({ lotId: lot.id }))}' data-rf-success="สร้างใบส่งมอบ {result} แล้ว" id="rf-transfer">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-transfer">สร้างใบส่งมอบ</button>` });
    return { html };
  };

  // ---------- เบิกและชั่งเคมี ----------
  pages.requisition = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const { fmtDate, fmtDateTime, fmtNum, weighTolerance } = rules;
    const list = [...data.requisitions].sort((a, b) => b.createdAt - a.createdAt);
    const selected = data.requisitions.find((row) => row.id === params.get("sel")) ?? list.find((row) => row.status === "weighing") ?? list[0] ?? null;
    const listHtml = list.map((requisition) => {
      const done = requisition.lines.filter((line) => line.actualKg !== null).length;
      return `<a class="rf-list-item${requisition.id === selected?.id ? " is-selected" : ""}" href="${esc(ctx.pageUrl({ sel: requisition.id }))}"${requisition.id === selected?.id ? ' aria-current="true"' : ""}><div class="rf-row rf-between"><strong class="rf-mono">${esc(requisition.id)}</strong>${ui.status(requisition.status)}</div><div class="small muted">${esc(`${requisition.orderId} · ${requisition.batches} batch · ${fmtNum(requisition.totalKg, 1)} kg · ชั่งแล้ว ${done}/${requisition.lines.length}`)}</div></a>`;
    }).join("");

    let detail = ui.card(ui.empty("ยังไม่มีใบเบิก"));
    let bind = null;
    if (selected) {
      const order = data.orders.find((row) => row.id === selected.orderId);
      const recipe = data.recipes.find((row) => row.id === selected.recipeId);
      const nextIdx = selected.lines.findIndex((line) => line.actualKg === null);
      const parts = [];
      if (selected.status === "weighing" && nextIdx >= 0) {
        const line = selected.lines[nextIdx];
        const material = data.materials.find((row) => row.code === line.materialCode);
        const tol = weighTolerance(line.targetKg);
        parts.push(ui.card(`<form data-rf-form="weighLine" data-rf-args='${esc(JSON.stringify({ reqId: selected.id, index: nextIdx }))}' data-rf-success="บันทึกน้ำหนัก ${esc(material?.code ?? "")} แล้ว" data-rf-weigh data-target="${line.targetKg}" data-tol="${tol}"><div class="rf-grid rf-g2">
            <div class="rf-stack"><div><span class="small muted">วัตถุดิบ</span><h2>${esc(material?.name ?? line.materialCode)}</h2><div class="rf-mono small">${esc(`${line.materialCode} · ล็อต ${line.lotNo}`)}</div></div>
              <div class="rf-grid rf-g2"><div><span class="small muted">น้ำหนักเป้าหมาย</span><div class="rf-big rf-mono">${esc(`${line.targetKg.toFixed(3)} kg`)}</div></div><div><span class="small muted">เกณฑ์ยอมรับ</span><div class="rf-big rf-mono">${esc(`± ${tol.toFixed(3)}`)}</div></div></div></div>
            <div class="rf-stack">${ui.field("ค่าที่อ่านได้จากตาชั่ง (kg)", ui.input("actualKg", { type: "number", step: "0.001", className: "rf-scale-input", required: true }))}
              <div class="rf-row small"><span class="muted">จำลองตาชั่ง:</span><button class="btn rf-btn secondary small" type="button" data-rf-sim="low">ขาด</button><button class="btn rf-btn secondary small" type="button" data-rf-sim="ok">พอดี</button><button class="btn rf-btn secondary small" type="button" data-rf-sim="high">เกิน</button></div>
              <div data-rf-weigh-status></div>
              <button class="btn rf-btn" type="submit" disabled>ยืนยันน้ำหนักและไปรายการถัดไป</button></div></div></form>`,
        { title: `สถานีชั่ง · รายการ ${nextIdx + 1}/${selected.lines.length}` }));
        bind = (rootNode) => {
          const form = rootNode.querySelector("[data-rf-weigh]");
          if (!form) return;
          const target = Number(form.dataset.target);
          const tolerance = Number(form.dataset.tol);
          const input = form.querySelector('[name="actualKg"]');
          const statusBox = form.querySelector("[data-rf-weigh-status]");
          const submit = form.querySelector('button[type="submit"]');
          const paint = () => {
            const v = Number(input.value);
            const status = input.value === "" ? "empty" : v < target - tolerance ? "low" : v > target + tolerance ? "high" : "ok";
            input.classList.toggle("rf-ok", status === "ok");
            input.classList.toggle("rf-out", status === "low" || status === "high");
            submit.disabled = status !== "ok";
            statusBox.innerHTML = status === "low" ? ui.callout("bad", esc(`น้อยกว่าเกณฑ์ ขาดอีก ${(target - tolerance - v).toFixed(3)} kg ระบบล็อกปุ่มยืนยัน`))
              : status === "high" ? ui.callout("bad", esc(`เกินเกณฑ์ ${(v - target - tolerance).toFixed(3)} kg ตักออกก่อนจึงยืนยันได้`))
                : status === "ok" ? ui.callout("good", esc(`อยู่ในเกณฑ์ (ต่าง ${(v - target).toFixed(3)} kg)`)) : "";
          };
          input.addEventListener("input", paint);
          form.querySelectorAll("[data-rf-sim]").forEach((button) => button.addEventListener("click", () => {
            const mode = button.dataset.rfSim;
            const delta = mode === "ok" ? (Math.random() - 0.5) * tolerance : mode === "low" ? -tolerance * 2.5 : tolerance * 2.5;
            input.value = (target + delta).toFixed(3);
            paint();
          }));
          paint();
        };
      }
      if (selected.status === "issued") parts.push(ui.callout("good", "จ่ายวัตถุดิบครบแล้ว รอห้องผสมนำไปผสม"));
      const lineRows = selected.lines.map((line, i) => {
        const lot = data.materialLots.find((row) => row.lotNo === line.lotNo);
        const material = data.materials.find((row) => row.code === line.materialCode);
        return `<tr${i === nextIdx && selected.status === "weighing" ? ' class="is-selected"' : ""}><td>${i + 1}</td><td>${esc(material?.name ?? "")}<div class="small muted rf-mono">${esc(line.materialCode)}</div></td><td class="rf-mono small">${esc(line.lotNo)}</td>
          <td class="small nowrap">${esc(fmtDate(lot?.expiry))}<div class="muted">${esc(lot?.location ?? "")}</div></td><td class="right rf-mono">${esc(fmtNum(line.targetKg, 3))}</td><td class="right rf-mono">${line.actualKg === null ? "-" : esc(fmtNum(line.actualKg, 3))}</td>
          <td>${line.actualKg === null ? ui.badge("warn", "รอชั่ง") : ui.badge("good", "ผ่าน")}</td></tr>`;
      });
      parts.push(ui.card(`<div class="rf-card-pad">${ui.kv([["ใบสั่งผลิต", esc(`${order?.id ?? "-"} · ${order?.customer ?? ""}`)], ["สูตร", esc(`${recipe?.name ?? "-"} · ${selected.batches} batch · ${fmtNum(selected.totalKg, 2)} kg`)], ["ผู้ขอเบิก", esc(`${selected.requestedBy ?? "-"} · ${fmtDateTime(selected.createdAt)}`)],
        selected.issuedBy ? ["ผู้จ่าย", esc(`${selected.issuedBy} · ${fmtDateTime(selected.issuedAt)}`)] : null, selected.consumedBy ? ["ใช้ผสมเป็น", ui.mono(selected.consumedBy)] : null])}</div>
        ${ui.table(["#", "วัตถุดิบ", "ล็อตที่จ่าย (FEFO)", "หมดอายุ", { label: "ตามสูตร (kg)", className: "right" }, { label: "ชั่งจริง (kg)", className: "right" }, "สถานะ"], lineRows)}`,
      { title: `ใบเบิก ${esc(selected.id)}`, actions: ui.openButton("พิมพ์ป้าย", "tag", { kind: "requisition", id: selected.id }, { className: "secondary small" }), flush: true }));
      detail = `<div class="rf-stack">${parts.join("")}</div>`;
    }
    const html = `${ui.pageHead("เบิกและชั่งเคมี", "ระเบิดสูตรเป็นรายการเบิก จัดสรรล็อตตามหลัก FEFO บล็อกล็อตหมดอายุ และบังคับชั่งให้อยู่ในเกณฑ์ (Poka-Yoke)", ui.openButton("สร้างใบเบิก", "createRequisition", {}, { className: "" }))}
      <div class="rf-split">${ui.card(`<div class="rf-list rf-list-tall">${listHtml || ui.empty("ยังไม่มีใบเบิก")}</div>`, { title: `ใบเบิก (${list.length})`, flush: true })}${detail}</div>`;
    return { html, bind };
  };

  dialogs.createRequisition = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const { recipeLines, allocateFefo, fmtNum } = rules;
    const orders = data.orders.filter((order) => ["released", "in_progress"].includes(order.status));
    const body = `<div class="rf-grid rf-g3">
        ${ui.field("ใบสั่งผลิต *", ui.select("orderId", orders.map((order) => ({ value: order.id, label: `${order.id} · ${order.productName}` })), { value: orders[0]?.id ?? "", placeholder: orders.length ? null : "ไม่มีใบสั่งผลิตที่ปล่อยผลิต", extra: "data-rf-order required" }))}
        ${ui.field("จำนวน batch *", ui.input("batches", { type: "number", min: 1, max: 10, value: "1", required: true, extra: "data-rf-batches" }))}
        ${ui.field("หมายเหตุ", ui.input("note"))}
      </div><div class="muted small" data-rf-recipe-line></div><div data-rf-shortage></div><div data-rf-preview></div>`;
    const html = ui.dialog("createRequisition", "สร้างใบเบิกวัตถุดิบ (ระเบิดสูตร)", `<form data-rf-form="createRequisition" data-rf-success="สร้างใบเบิก {result} แล้ว" id="rf-create-req">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-create-req" data-rf-submit${orders.length ? "" : " disabled"}>สร้างใบเบิก</button>`, wide: true });
    const bind = (dialog) => {
      const orderSelect = dialog.querySelector("[data-rf-order]");
      const batches = dialog.querySelector("[data-rf-batches]");
      const submit = dialog.querySelector("[data-rf-submit]");
      const paint = () => {
        const order = data.orders.find((row) => row.id === orderSelect.value);
        const recipe = order && data.recipes.find((row) => row.id === order.recipeId);
        const n = Number(batches.value || 0);
        const preview = recipe ? recipeLines(recipe).map((line) => ({ ...line, need: line.kgPerBatch * n, ...allocateFefo(data.materialLots, line.materialCode, line.kgPerBatch * n, now) })) : [];
        const short = preview.some((row) => row.shortage > 0.0001);
        dialog.querySelector("[data-rf-recipe-line]").textContent = recipe ? `สูตร ${recipe.name} · น้ำหนักรวม ${fmtNum(recipe.batchKg * n, 2)} kg` : "";
        dialog.querySelector("[data-rf-shortage]").innerHTML = short ? ui.callout("bad", "สต็อกพร้อมใช้ไม่พอ (ไม่นับล็อตหมดอายุหรือกักกัน)") : "";
        dialog.querySelector("[data-rf-preview]").innerHTML = ui.table(["วัตถุดิบ", { label: "ต้องใช้ (kg)", className: "right" }, "ล็อตที่ระบบจะจ่าย (FEFO)"], preview.map((row) => `<tr><td class="rf-mono">${esc(row.materialCode)}</td><td class="right rf-mono">${esc(fmtNum(row.need, 3))}</td><td class="small">${row.picks.map((pick) => `<div class="rf-mono">${esc(`${pick.lotNo} → ${pick.kg.toFixed(3)} kg`)}</div>`).join("")}${row.shortage > 0.0001 ? ui.badge("bad", `ขาด ${row.shortage.toFixed(2)} kg`) : ""}</td></tr>`), { emptyText: "เลือกใบสั่งผลิตก่อน" });
        if (submit) submit.disabled = !order || short;
      };
      orderSelect.addEventListener("change", paint);
      batches.addEventListener("input", paint);
      paint();
    };
    return { html, bind };
  };

  // ---------- สถานีที่ 1 ผสมยาง ----------
  pages.mixing = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const { MACHINES, fmtDuration, fmtNum } = rules;
    const lots = data.lots.filter((lot) => lot.stage === "mixing");
    const issued = data.requisitions.filter((requisition) => requisition.status === "issued");
    const resting = lots.filter((lot) => lot.readyAt > now);
    const form = issued.length === 0 ? ui.callout("warn", "ยังไม่มีใบเบิกที่ชั่งครบ ต้องให้คลังจ่ายวัตถุดิบครบทุกรายการก่อน")
      : `<form data-rf-form="recordMixing" data-rf-success="บันทึก {result} แล้ว" data-rf-mixing><div class="rf-grid rf-g4">
          ${ui.field("ใบเบิกที่จ่ายครบ *", ui.select("reqId", issued.map((requisition) => ({ value: requisition.id, label: `${requisition.id} · ${requisition.orderId}` })), { value: issued[0]?.id ?? "", extra: "data-rf-req required" }))}
          ${ui.field("เครื่องผสม", ui.select("machine", MACHINES.mixing))}
          ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
          ${ui.field("เวลาผสม (s) *", ui.input("mixSec", { type: "number", required: true }), { hint: '<span data-rf-mix-hint></span>' })}
          ${ui.field("Dump temp (°C) *", ui.input("dumpTemp", { type: "number", step: "any", required: true, extra: "data-rf-dump" }), { hint: '<span data-rf-dump-hint></span>' })}
          ${ui.field("น้ำหนักยางที่ได้ (kg) *", ui.input("outputKg", { type: "number", step: "any", required: true }), { hint: '<span data-rf-issued></span>' })}
          ${ui.field("ของเสีย (kg)", ui.input("scrapKg", { type: "number", step: "any" }))}
          ${ui.field("สาเหตุของเสีย", ui.input("scrapReason", { placeholder: "เช่น เศษติดใบโรเตอร์" }))}
        </div><div data-rf-dump-warn></div><div class="rf-row">${ui.submitButton("บันทึกการผสม")}<span class="small muted" data-rf-rest></span></div></form>`;
    const html = `${ui.pageHead("สถานีที่ 1 · ผสมยาง", "รับวัตถุดิบที่ชั่งครบแล้วมาผสม บันทึก Dump temp และเวลา ยางทุก batch ต้องบ่มครบเวลาก่อนส่งไปรีด")}
      ${ui.stats([
        { label: "Yield ห้องผสม", value: `${stageYield(lots).toFixed(2)}%`, sub: "เป้าหมาย ≥ 99.0%" },
        { label: "ผลิตแล้วสะสม", value: `${fmtNum(lots.reduce((sum, lot) => sum + lot.goodQty, 0), 0)} kg` },
        { label: "กำลังบ่ม", value: String(resting.length), sub: resting[0] ? `ใกล้ครบ: ${fmtDuration(Math.min(...resting.map((lot) => lot.readyAt)) - now)}` : "ไม่มี" },
        { label: "ของเสียสะสม", value: `${fmtNum(lots.reduce((sum, lot) => sum + lot.scrapQty, 0), 1)} kg` },
      ])}
      ${ui.card(form, { title: "บันทึกการผสม" })}
      ${stageLots(ctx, "mixing", [
        { label: "เครื่อง / กะ", render: (lot) => `${esc(lot.machine ?? "-")}<br>กะ ${esc(lot.shift ?? "-")}` },
        { label: "Dump temp / เวลา", render: (lot) => esc(`${lot.params.dumpTemp}°C · ${lot.params.mixSec}s`) },
      ])}`;
    const bind = (rootNode) => {
      const form = rootNode.querySelector("[data-rf-mixing]");
      if (!form) return;
      const reqSelect = form.querySelector("[data-rf-req]");
      const dump = form.querySelector("[data-rf-dump]");
      const paint = () => {
        const requisition = data.requisitions.find((row) => row.id === reqSelect.value);
        const recipe = requisition && data.recipes.find((row) => row.id === requisition.recipeId);
        const issuedKg = requisition ? requisition.lines.reduce((sum, line) => sum + line.actualKg, 0) : 0;
        form.querySelector("[data-rf-mix-hint]").textContent = recipe ? `มาตรฐาน ${recipe.mixSec} s` : "";
        form.querySelector("[data-rf-dump-hint]").textContent = recipe ? `มาตรฐาน ${recipe.dumpTemp} ± ${recipe.dumpTol} °C` : "";
        form.querySelector("[data-rf-issued]").textContent = requisition ? `วัตถุดิบที่จ่าย ${fmtNum(issuedKg, 2)} kg` : "";
        form.querySelector("[data-rf-rest]").textContent = recipe ? `บันทึกแล้วต้องบ่มขั้นต่ำ ${recipe.restHours} ชม. ก่อนส่งต่อ` : "";
        const out = recipe && dump.value !== "" && Math.abs(Number(dump.value) - recipe.dumpTemp) > recipe.dumpTol;
        dump.classList.toggle("rf-ok", Boolean(recipe) && dump.value !== "" && !out);
        dump.classList.toggle("rf-out", Boolean(out));
        form.querySelector("[data-rf-dump-warn]").innerHTML = out ? ui.callout("warn", "Dump temp อยู่นอกช่วง ระบบจะตั้งสถานะ QC Hold ให้ล็อตนี้อัตโนมัติ") : "";
      };
      reqSelect.addEventListener("change", paint);
      dump.addEventListener("input", paint);
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
    const avgRework = lots.length ? lots.reduce((sum, lot) => sum + (lot.params.reworkPct || 0), 0) / lots.length : 0;
    const form = ready.length ? ui.card(`<form data-rf-form="recordExtrusion" data-rf-success="บันทึก {result} แล้ว" data-rf-extrusion><div class="rf-grid rf-g4">
        ${inboundSelect(ctx, "extrusion")}
        ${ui.field("ยางคอมปาวด์ที่ใช้ (kg) *", ui.input("useKg", { type: "number", step: "any", required: true, extra: "data-rf-use" }), { hint: '<span data-rf-remaining></span>' })}
        ${ui.field("ยางหมุนเวียนที่ผสม (kg)", ui.input("reworkKg", { type: "number", step: "any", extra: "data-rf-rework" }), { hint: '<span data-rf-rework-hint></span>' })}
        ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
        ${ui.field("เครื่องรีด", ui.select("machine", MACHINES.extrusion))}
        ${ui.field("หัวดาย *", ui.select("dieId", dies.map((die) => ({ value: die.id, label: `${die.id} · ${die.name}` })), { extra: "required" }))}
        ${ui.specInput("thickness", s.thickness.label, s.thickness)}
        ${ui.specInput("width", s.width.label, s.width)}
        ${ui.specInput("weightPerM", s.weightPerM.label, s.weightPerM)}
        ${ui.field("งานดี (m/pcs) *", ui.input("goodQty", { type: "number", step: "any", required: true }))}
        ${ui.field("ของเสีย (m/pcs)", ui.input("scrapQty", { type: "number", step: "any" }))}
        ${ui.field("สาเหตุของเสีย", ui.input("scrapReason"))}
      </div><div data-rf-rework-warn></div><div class="rf-row">${ui.submitButton("บันทึกการรีด")}</div></form>`, { title: "บันทึกการรีด" }) : "";
    const html = `${ui.pageHead("สถานีที่ 2 · ฉีดขึ้นรูป", "ใช้ได้เฉพาะยางที่รับมอบแล้ว คุมสัดส่วนยางหมุนเวียนไม่เกิน 10% และตรวจมิติชิ้นงานกับสเปก")}
      ${ui.stats([
        { label: "Yield การรีด", value: `${stageYield(lots).toFixed(2)}%`, sub: "เป้าหมาย ≥ 97.0%" },
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
    const form = ready.length ? ui.card(`<form data-rf-form="recordCuring" data-rf-success="บันทึก {result} แล้ว" data-rf-curing><div class="rf-grid rf-g4">
        ${inboundSelect(ctx, "curing")}
        ${ui.field("ปริมาณที่นำเข้าอบ *", ui.input("useQty", { type: "number", step: "any", required: true }), { hint: '<span data-rf-remaining></span>' })}
        ${ui.field("แม่พิมพ์ / สายอบ *", ui.select("moldId", tools.map((mold) => ({ value: mold.id, label: `${mold.id} · ${mold.name}` })), { extra: "required" }))}
        ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
        ${ui.specInput("temp", s.temp.label, s.temp)}
        ${ui.specInput("time", s.time.label, s.time)}
        ${ui.specInput("pressure", s.pressure.label, s.pressure)}
        <div></div>
        ${ui.field("งานดี *", ui.input("goodQty", { type: "number", step: "any", required: true }))}
        ${ui.field("ของเสีย", ui.input("scrapQty", { type: "number", step: "any" }))}
        ${ui.field("สาเหตุของเสีย", ui.input("scrapReason", { placeholder: "เช่น ฟองอากาศ, ยางไม่เต็มแบบ" }))}
      </div><div data-rf-spec-warn></div><div class="rf-row">${ui.submitButton("บันทึกการอบ")}</div></form>`, { title: "บันทึกการอบ" }) : "";
    const html = `${ui.pageHead("สถานีที่ 3 · อบ HCM", "คุมอุณหภูมิ เวลา และความดันตามสเปก ถ้าค่าหลุดช่วง ระบบจะกักกันล็อตอัตโนมัติ และนับรอบการใช้แม่พิมพ์ให้")}
      ${ui.stats([
        { label: "Yield การอบ", value: `${stageYield(lots).toFixed(2)}%`, sub: "เป้าหมาย ≥ 98.0%" },
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
        form.querySelector("[data-rf-spec-warn]").innerHTML = out.length ? ui.callout("warn", esc(`${out.map((key) => s[key].label).join(", ")} อยู่นอกสเปก ล็อตนี้จะถูกกักกัน (QC Hold) อัตโนมัติ`)) : "";
      };
      ["temp", "time", "pressure"].forEach((key) => form.querySelector(`[name="${key}"]`).addEventListener("input", paint));
    };
    return { html, bind };
  };

  // ---------- สถานีที่ 4 ตกแต่งและบรรจุ ----------
  pages.finishing = (ctx) => {
    const { data, ui, rules } = ctx;
    const { fmtNum } = rules;
    const lots = data.lots.filter((lot) => lot.stage === "finishing");
    const { ready } = inbound(data, "finishing");
    const form = ready.length ? ui.card(`<form data-rf-form="recordFinishing" data-rf-success="บันทึก {result} และสร้างป้ายกล่องแล้ว" data-rf-finishing><div class="rf-grid rf-g4">
        ${inboundSelect(ctx, "finishing")}
        ${ui.field("ปริมาณที่รับเข้าตกแต่ง *", ui.input("useQty", { type: "number", step: "any", required: true }), { hint: '<span data-rf-remaining></span>' })}
        ${ui.field("ผ่านการตรวจ 100% *", ui.input("passedQty", { type: "number", step: "any", required: true, extra: "data-rf-passed" }))}
        ${ui.field("ของเสียจากการตกแต่ง", ui.input("scrapQty", { type: "number", step: "any" }))}
        ${ui.field("จำนวนต่อกล่อง *", ui.input("perBox", { type: "number", step: "any", required: true, extra: "data-rf-perbox" }), { hint: '<span data-rf-boxes></span>' })}
        ${ui.field("เกรด", ui.select("grade", ["A", "B"]))}
        ${ui.field("ผลตัดสินของล็อต", ui.select("qcResult", [{ value: "pass", label: "ผ่าน — รับเข้าคลัง" }, { value: "hold", label: "กักกันรอ QC" }]))}
        ${ui.field("กะ", ui.select("shift", shiftOptions(rules)))}
      </div>${ui.callout("info", "เมื่อบันทึกเป็น “ผ่าน” กล่องจะเข้าคลังสินค้าสำเร็จรูปทันที และนับยอดเข้าใบสั่งผลิต")}<div class="rf-row">${ui.submitButton("บันทึกและพิมพ์ป้ายกล่อง")}</div></form>`, { title: "บันทึกการตกแต่งและบรรจุ" }) : "";
    const html = `${ui.pageHead("สถานีที่ 4 · ตกแต่งและบรรจุ", "ตัดแต่งครีบ ตรวจ 100% แล้วบรรจุกล่อง ระบบสร้างเลขกล่องและรับเข้าคลังสินค้าสำเร็จรูปให้อัตโนมัติ")}
      ${ui.stats([
        { label: "Yield ตกแต่ง", value: `${stageYield(lots).toFixed(2)}%`, sub: "เป้าหมาย ≥ 99.0%" },
        { label: "ผ่าน QC สะสม", value: fmtNum(lots.reduce((sum, lot) => sum + lot.goodQty, 0)), sub: "m / pcs" },
        { label: "กล่องในคลัง", value: String(data.fgBoxes.filter((box) => box.status === "in_stock").length) },
        { label: "ล็อตพร้อมออก CoA", value: String(lots.filter((lot) => lot.qc === "pass").length) },
      ])}
      ${gateNotice(ctx, "finishing")}${form}
      ${stageLots(ctx, "finishing", [
        { label: "บรรจุ", render: (lot) => esc(`${lot.boxes} กล่อง × ${fmtNum(lot.params.perBox)} · เกรด ${lot.grade}`) },
        { label: "CoA", render: (lot) => ui.openButton("ดู CoA", "coa", { lotId: lot.id }, { className: "secondary small" }) },
      ])}`;
    const bind = (rootNode) => {
      const form = rootNode.querySelector("[data-rf-finishing]");
      if (!form) return;
      const currentTransfer = bindInbound(form, data, "useQty");
      const passed = form.querySelector("[data-rf-passed]");
      const perBox = form.querySelector("[data-rf-perbox]");
      form.querySelector("[data-rf-inbound]").addEventListener("change", () => { const transfer = currentTransfer(); if (transfer && !perBox.value) perBox.value = transfer.uom === "m" ? "100" : "2000"; paint(); });
      const paint = () => {
        const boxes = Number(perBox.value) > 0 && Number(passed.value) > 0 ? Math.ceil(Number(passed.value) / Number(perBox.value)) : 0;
        form.querySelector("[data-rf-boxes]").textContent = boxes ? `จะได้ ${boxes} กล่อง` : "";
      };
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
    const flow = STAGES.map((stage) => {
      const inTransit = data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "in_transit").length;
      const available = data.transfers.filter((transfer) => transfer.to === stage && transfer.status === "received" && transfer.remaining > 0).length;
      return `<div class="rf-step"><strong>${esc(STAGE_LABEL[stage])}</strong>${ui.kv([["รอรับมอบ", esc(stage === "mixing" ? "-" : String(inTransit))], ["รับแล้วรอใช้", esc(stage === "mixing" ? `${data.requisitions.filter((requisition) => requisition.status === "issued").length} ใบเบิก` : String(available))], ["พร้อมส่งต่อ", esc(`${sendable.filter((lot) => lot.stage === stage).length} ล็อต`)]])}</div>`;
    }).join("");
    const sendRows = sendable.map((lot) => `<tr><td>${ui.mono(lot.id)}<div class="small muted">${esc(lot.orderId)}</div></td><td>${esc(`${STAGE_LABEL[lot.stage]} → ${STAGE_LABEL[NEXT_STAGE[lot.stage]]}`)}</td><td class="right">${esc(`${fmtNum(actions.transferableQty(lot, now), 2)} ${lot.uom}`)}</td><td class="right">${ui.openButton("สร้างใบส่งมอบ", "transfer", { lotId: lot.id }, { className: "small" })}</td></tr>`);
    const transferRows = rows.map((transfer) => {
      const diff = transfer.qtyReceived === null ? null : transfer.qtyReceived - transfer.qtySent;
      return `<tr><td>${ui.mono(transfer.id)}<div class="small muted">${esc(`${fmtDateTime(transfer.createdAt)} · ${transfer.createdBy ?? "-"}`)}</div></td><td class="rf-mono small">${esc(transfer.lotId)}<div class="muted">${esc(transfer.orderId)}</div></td>
        <td class="small">${esc(`${STAGE_LABEL[transfer.from]} → ${STAGE_LABEL[transfer.to]}`)}</td><td class="right nowrap">${esc(`${fmtNum(transfer.qtySent, 2)} ${transfer.uom}`)}</td><td class="right">${transfer.qtyReceived === null ? "-" : esc(fmtNum(transfer.qtyReceived, 2))}</td>
        <td class="right${diff < 0 ? " rf-late" : ""}">${diff === null ? "-" : esc(fmtNum(diff, 2))}</td><td>${ui.status(transfer.status)}${transfer.condition && transfer.condition !== "ok" ? `<div class="small rf-warn-text">${esc(transfer.condition)}</div>` : ""}</td>
        <td class="right"><div class="rf-row rf-end">${ui.openButton("ป้าย", "tag", { kind: "transfer", id: transfer.id }, { className: "secondary small", ariaLabel: `พิมพ์ป้าย ${transfer.id}` })}${transfer.status === "in_transit" ? ui.openButton("รับมอบ", "receive", { id: transfer.id }, { className: "small" }) : ""}</div></td></tr>`;
    });
    const tabs = ui.tabs([{ id: "in_transit", label: `รอรับมอบ (${data.transfers.filter((transfer) => transfer.status === "in_transit").length})` }, { id: "received", label: "รับมอบแล้ว" }, { id: "all", label: "ทั้งหมด" }], tab, (id) => ctx.pageUrl({ tab: id === "in_transit" ? null : id, q: null }));
    const html = `${ui.pageHead("ส่งมอบงานระหว่างผลิต (WIP)", "กฎ Gatekeeper: สถานีถัดไปเริ่มผลิตได้ก็ต่อเมื่อสแกนรับมอบและยืนยันจำนวนจริงแล้ว")}
      <div class="rf-flow">${flow}</div>
      ${sendable.length ? ui.card(ui.table(["ล็อต", "เส้นทาง", { label: "ส่งได้", className: "right" }, { label: "", className: "right" }], sendRows), { title: `ล็อตที่พร้อมส่งต่อ (${sendable.length})`, flush: true }) : ""}
      ${ui.card(`<div class="rf-listbar">${tabs}${searchForm(ctx, "ค้นหาใบส่งมอบ ล็อต ใบสั่งผลิต…")}</div>${ui.table(["ใบส่งมอบ", "ล็อตต้นทาง", "เส้นทาง", { label: "ส่ง", className: "right" }, { label: "รับจริง", className: "right" }, { label: "ผลต่าง", className: "right" }, "สถานะ", { label: "", className: "right" }], transferRows, { emptyText: "ไม่มีใบส่งมอบ" })}`, { flush: true })}`;
    return { html };
  };

  dialogs.receive = (ctx, { id }) => {
    const { data, ui, rules } = ctx;
    const transfer = data.transfers.find((row) => row.id === id);
    if (!transfer) return null;
    const body = `${ui.kv([["ล็อต", ui.mono(transfer.lotId)], ["เส้นทาง", esc(`${rules.STAGE_LABEL[transfer.from]} → ${rules.STAGE_LABEL[transfer.to]}`)], ["จำนวนที่ส่ง", esc(`${transfer.qtySent} ${transfer.uom}`)]])}
      <div class="rf-grid rf-g2">${ui.field(`จำนวนที่ตรวจนับ/ชั่งได้จริง (${transfer.uom}) *`, ui.input("qtyReceived", { type: "number", step: "any", value: String(transfer.qtySent), required: true, extra: "data-rf-received" }))}
      ${ui.field("สภาพชิ้นงาน / ภาชนะ", ui.select("condition", [{ value: "ok", label: "สมบูรณ์" }, { value: "ภาชนะชำรุด", label: "ภาชนะชำรุด / ป้ายเลือน" }, { value: "ปริมาณขาด", label: "ปริมาณขาดเกินเกณฑ์" }]))}</div><div data-rf-diff></div>`;
    const html = ui.dialog("receive", `รับมอบงาน · ${transfer.id}`, `<form data-rf-form="receiveTransfer" data-rf-args='${esc(JSON.stringify({ id: transfer.id }))}' data-rf-success="รับมอบงานแล้ว สถานีเริ่มผลิตได้" id="rf-receive">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-receive">ยืนยันรับเข้า</button>` });
    const bind = (dialog) => {
      const input = dialog.querySelector("[data-rf-received]");
      const paint = () => {
        const diff = Number(input.value) - transfer.qtySent;
        dialog.querySelector("[data-rf-diff]").innerHTML = Math.abs(diff) > 1e-9 && input.value !== "" ? ui.callout(diff < 0 ? "warn" : "info", esc(`ผลต่าง ${rules.fmtNum(diff, 2)} ${transfer.uom} จะถูกบันทึกในประวัติการส่งมอบ`)) : "";
      };
      input.addEventListener("input", paint);
    };
    return { html, bind };
  };

  root.MNP_RUBBERFLOW_LINE = { stageYield, inbound };
})(typeof window !== "undefined" ? window : globalThis);
