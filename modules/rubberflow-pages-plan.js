// RubberFlow MES (แผนก RB โหมดทดสอบ) — หน้า ภาพรวมโรงงาน · ใบสั่งผลิต · สูตรยาง · คลังวัตถุดิบและสินค้า · แม่พิมพ์ · บันทึกการใช้งาน
// ยกมาจาก pages/Dashboard.jsx, Orders.jsx, Recipes.jsx, Warehouse.jsx, Molds.jsx, Audit.jsx ของต้นแบบ (React → HTML สตริง + bind)
// ทุกหน้าคืน { html, bind?(root, ctx) } และ dialog คืน { html, bind? } ลงทะเบียนใน window.MNP_RUBBERFLOW_PAGES / _DIALOGS
// กติกา event (data-rf-form / data-rf-action / data-rf-open) อยู่ที่ modules/module-rubberflow.js — โหลดหลัง modules/rubberflow-ui.js
(function (root) {
  const pages = (root.MNP_RUBBERFLOW_PAGES ??= {});
  const dialogs = (root.MNP_RUBBERFLOW_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);

  const yieldOf = (lots) => {
    const good = lots.reduce((sum, lot) => sum + lot.goodQty, 0);
    const scrap = lots.reduce((sum, lot) => sum + lot.scrapQty, 0);
    return good + scrap ? (good / (good + scrap)) * 100 : 100;
  };
  const includes = (haystack, q) => !q || String(haystack).toLowerCase().includes(q.toLowerCase());
  const searchForm = (ctx, placeholder, { tab = null } = {}) => `<form class="rf-search" data-rf-search${tab ? ` data-rf-keep="tab"` : ""} role="search"><label class="sr-only" for="rf-q">ค้นหา</label>${ctx.ui.input("q", { id: "rf-q", type: "search", value: ctx.q, placeholder })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>`;

  // ---------- ภาพรวมโรงงาน ----------
  pages.dashboard = (ctx) => {
    const { data, now, ui, rules, derive } = ctx;
    const { STAGES, STAGE_LABEL, DAY, fmtDate, fmtNum } = rules;
    const byStage = Object.fromEntries(STAGES.map((stage) => [stage, data.lots.filter((lot) => lot.stage === stage)]));
    const stageYield = Object.fromEntries(STAGES.map((stage) => [stage, yieldOf(byStage[stage])]));
    const overall = STAGES.reduce((product, stage) => product * (stageYield[stage] / 100), 1) * 100;
    const days = [...Array(10)].map((_, i) => {
      const start = new Date(now - (9 - i) * DAY).setHours(0, 0, 0, 0);
      const dayLots = data.lots.filter((lot) => lot.createdAt >= start && lot.createdAt < start + DAY);
      return {
        day: fmtDate(start).split(" ").slice(0, 2).join(" "),
        output: Math.round(dayLots.filter((lot) => lot.stage === "finishing" && lot.uom === "m").reduce((sum, lot) => sum + lot.goodQty, 0)),
        yield: dayLots.length ? +yieldOf(dayLots).toFixed(1) : null,
      };
    });
    const mixingScrapKg = byStage.mixing.reduce((sum, lot) => sum + lot.scrapQty, 0);
    const wipAt = (stage) => data.transfers.filter((transfer) => transfer.to === stage && (transfer.status === "in_transit" || transfer.remaining > 0));
    const active = data.orders.filter((order) => ["released", "in_progress", "on_hold"].includes(order.status));
    const alerts = derive.buildAlerts(data, now);
    const fgBoxes = data.fgBoxes.filter((box) => box.status === "in_stock");

    const flow = STAGES.map((stage, i) => {
      const lots = byStage[stage];
      const held = lots.filter((lot) => lot.qc === "hold").length;
      const inner = `<div class="rf-row rf-between"><span class="rf-step-no">STAGE ${i + 1}</span>${held ? ui.badge("warn", `Hold ${held}`) : ""}</div><h3>${esc(STAGE_LABEL[stage])}</h3>
        ${ui.kv([["ล็อตทั้งหมด", esc(String(lots.length))], ["Yield", esc(`${stageYield[stage].toFixed(2)}%`)],
          stage !== "mixing" ? ["งานรอเข้า", esc(`${wipAt(stage).length} ใบส่งมอบ`)] : ["กำลังบ่ม", esc(`${lots.filter((lot) => lot.readyAt > now).length} batch`)]])}`;
      return ctx.canSee(stage) ? `<a class="rf-step" href="${esc(ctx.url(stage))}">${inner}</a>` : `<div class="rf-step">${inner}</div>`;
    }).join("");

    const orderRows = active.map((order) => `<tr>
        <td>${ui.link(order.id, ctx.url("orders", { q: order.id }), "rf-mono")}${order.priority === "urgent" ? ` ${ui.badge("bad", "ด่วน")}` : ""}</td>
        <td>${esc(order.customer)}<div class="small muted">${esc(order.productName)}</div></td>
        <td class="rf-progress-cell">${ui.progress(order.producedQty, order.targetQty)}<div class="small muted">${esc(`${fmtNum(order.producedQty)} / ${fmtNum(order.targetQty)} ${order.uom}`)}</div></td>
        <td class="nowrap">${esc(fmtDate(order.dueDate))}</td><td>${ui.status(order.status)}</td></tr>`);
    const alertList = alerts.length ? alerts.slice(0, 8).map((alert) => ui.callout(alert.tone, `<strong>${esc(alert.title)}</strong><br>${esc(alert.text)}`)).join("") : ui.empty("ไม่มีการแจ้งเตือน");

    const html = `${ui.pageHead("ภาพรวมโรงงาน", `ข้อมูล ณ ${new Date(now).toLocaleString("th-TH")}`)}
      ${ui.stats([
        { label: "Yield รวม 4 ขั้นตอน", value: `${overall.toFixed(1)}%`, sub: "เป้าหมาย ≥ 95.0%", tone: overall >= 95 ? "good" : "warn" },
        { label: "ใบสั่งผลิตที่เปิดอยู่", value: String(active.length), sub: `ด่วน ${active.filter((order) => order.priority === "urgent").length} รายการ` },
        { label: "ของเสียห้องผสม (สะสม)", value: `${fmtNum(mixingScrapKg, 1)} kg`, sub: `Yield ห้องผสม ${stageYield.mixing.toFixed(2)}%` },
        { label: "สินค้าพร้อมส่งในคลัง", value: `${fgBoxes.length} กล่อง`, sub: `${data.fgBoxes.filter((box) => box.status === "hold").length} กล่องถูกกักกัน` },
      ])}
      <div class="rf-flow">${flow}</div>
      <div class="rf-grid rf-g2">
        ${ui.card(ui.dualChart({ labels: days.map((day) => day.day), area: days.map((day) => day.output), line: days.map((day) => day.yield), leftName: "ผลผลิต (m)", rightName: "Yield %", rightDomain: [90, 100], unitLeft: "m", unitRight: "%" }), { title: "ผลผลิตสำเร็จรูป (เมตร) และ Yield รายวัน" })}
        ${ui.card(ui.dualChart({ labels: STAGES.map((stage) => STAGE_LABEL[stage]), bars: STAGES.map((stage) => +(100 - stageYield[stage]).toFixed(2)), leftName: "ของเสีย (%)", unitLeft: "%" }), { title: "สัดส่วนของเสียแยกตามขั้นตอน (%)" })}
      </div>
      <div class="rf-grid rf-g2-wide">
        ${ui.card(ui.table(["เลขที่", "ลูกค้า / สินค้า", "ความคืบหน้า", "กำหนดส่ง", "สถานะ"], orderRows, { emptyText: "ไม่มีใบสั่งผลิตที่กำลังดำเนินการ" }), { title: "ใบสั่งผลิตที่กำลังดำเนินการ", actions: ctx.canSee("orders") ? ui.link("ดูทั้งหมด", ctx.url("orders"), "btn rf-btn secondary small") : "", flush: true })}
        ${ui.card(`<div class="rf-stack rf-alert-list">${alertList}</div>`, { title: `การแจ้งเตือน (${alerts.length})` })}
      </div>`;
    return { html };
  };

  // ---------- ใบสั่งผลิต ----------
  const ORDER_FILTERS = [
    { id: "all", label: "ทั้งหมด" }, { id: "planned", label: "วางแผน" }, { id: "released", label: "ปล่อยผลิต" },
    { id: "in_progress", label: "กำลังผลิต" }, { id: "on_hold", label: "พักงาน" }, { id: "completed", label: "เสร็จสิ้น" },
  ];
  pages.orders = (ctx) => {
    const { data, now, ui, rules, params } = ctx;
    const { fmtDate, fmtNum } = rules;
    const filter = ORDER_FILTERS.some((row) => row.id === params.get("tab")) ? params.get("tab") : "all";
    const mayRelease = ctx.can("releaseOrder");
    const rows = [...data.orders]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((order) => filter === "all" || order.status === filter)
      .filter((order) => includes(`${order.id} ${order.customer} ${order.customerPo} ${order.productCode} ${order.productName}`, ctx.q));
    const tabs = ui.tabs(ORDER_FILTERS.map((row) => ({ ...row, label: `${row.label} (${row.id === "all" ? data.orders.length : data.orders.filter((order) => order.status === row.id).length})` })), filter, (id) => ctx.pageUrl({ tab: id === "all" ? null : id }));
    const setStatus = (order, status, text, label, { className = "secondary small", confirmText = "" } = {}) => ui.button(label, { action: "setOrderStatus", args: { id: order.id, status }, className, confirmText, ariaLabel: `${label} ${order.id}` });
    const body = rows.map((order) => {
      const late = order.dueDate < now && order.status !== "completed";
      const buttons = [
        ui.openButton("ป้าย", "tag", { kind: "order", id: order.id }, { className: "secondary small", ariaLabel: `พิมพ์ป้าย ${order.id}` }),
        mayRelease && order.status === "planned" ? setStatus(order, "released", "", "ปล่อยผลิต", { className: "small" }) : "",
        mayRelease && order.status === "planned" ? setStatus(order, "cancelled", "", "ยกเลิก", { className: "danger small", confirmText: `ยกเลิก ${order.id}?` }) : "",
        mayRelease && ["released", "in_progress"].includes(order.status) ? setStatus(order, "on_hold", "", "พัก") : "",
        mayRelease && order.status === "on_hold" ? setStatus(order, "in_progress", "", "ผลิตต่อ") : "",
        mayRelease && order.status === "in_progress" && order.producedQty > 0 ? setStatus(order, "completed", "", "ปิดงาน", { confirmText: "ปิดใบสั่งผลิตแม้ยังไม่ครบจำนวน?" }) : "",
      ].filter(Boolean).join(" ");
      return `<tr>
        <td>${ui.mono(order.id)}${order.priority === "urgent" ? ` ${ui.badge("bad", "ด่วน")}` : ""}<div class="small muted">${esc(order.customerPo || "-")}</div></td>
        <td>${esc(order.customer)}</td>
        <td>${esc(order.productName)}<div class="small muted rf-mono">${esc(`${order.productCode} · ${order.recipeId}`)}</div></td>
        <td class="nowrap">${esc(`${fmtNum(order.targetQty)} ${order.uom}`)}<div class="small muted">สี${esc(order.color)}</div></td>
        <td class="rf-progress-cell">${ui.progress(order.producedQty, order.targetQty, late ? "bad" : "")}<div class="small muted">${esc(`${fmtNum(order.producedQty)} (${Math.round((order.producedQty / order.targetQty) * 100)}%)`)}</div></td>
        <td class="nowrap small">${esc(fmtDate(order.startDate))}<br><span${late ? ' class="rf-late"' : ""}>${esc(fmtDate(order.dueDate))}</span></td>
        <td>${ui.status(order.status)}</td>
        <td class="right"><div class="rf-row rf-end">${buttons}</div></td></tr>`;
    });
    const html = `${ui.pageHead("ใบสั่งผลิต", "วางแผน ปล่อยผลิต พักงาน และติดตามความคืบหน้าของแต่ละใบสั่งผลิต", mayRelease ? ui.openButton("เปิดใบสั่งผลิต", "createOrder", {}, { className: "" }) : "")}
      ${ui.card(`<div class="rf-listbar">${tabs}${searchForm(ctx, "ค้นหาเลขที่ ลูกค้า สินค้า…", { tab: true })}</div>${ui.table(["เลขที่ / PO ลูกค้า", "ลูกค้า", "สินค้า / สูตร", "จำนวน", "ความคืบหน้า", "เริ่ม – ส่ง", "สถานะ", { label: "จัดการ", className: "right" }], body, { emptyText: "ไม่พบใบสั่งผลิต" })}`, { flush: true })}`;
    return { html };
  };

  dialogs.createOrder = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const { DAY, fmtNum, toInputDate } = rules;
    const approved = data.recipes.filter((recipe) => recipe.status === "approved");
    const body = `<div class="rf-grid rf-g2">
        ${ui.field("ลูกค้า *", ui.input("customer", { required: true }))}
        ${ui.field("เลขที่ PO ลูกค้า", ui.input("customerPo"))}
        ${ui.field("สินค้า / สูตร (เฉพาะสูตรที่อนุมัติแล้ว) *", ui.select("recipeId", approved.map((recipe) => ({ value: recipe.id, label: `${recipe.productName} (${recipe.id})` })), { value: approved[0]?.id ?? "", extra: 'data-rf-recipe' }))}
        ${ui.field("จำนวนเป้าหมาย *", ui.input("targetQty", { type: "number", required: true, min: 1, extra: 'data-rf-target' }), { hint: '<span data-rf-need></span>' })}
        ${ui.field("สี", ui.select("color", ["ดำ", "เทา", "น้ำตาล"]))}
        ${ui.field("ความเร่งด่วน", ui.select("priority", [{ value: "normal", label: "ปกติ" }, { value: "urgent", label: "ด่วน" }]))}
        ${ui.field("วันเริ่มผลิต *", ui.input("startDate", { type: "date", value: toInputDate(now + DAY), required: true }))}
        ${ui.field("วันกำหนดส่ง *", ui.input("dueDate", { type: "date", value: toInputDate(now + 10 * DAY), required: true }))}
      </div>${ui.field("หมายเหตุ / ข้อกำหนดพิเศษของลูกค้า", ui.textarea("note"))}`;
    const html = ui.dialog("createOrder", "เปิดใบสั่งผลิตใหม่", `<form data-rf-form="createOrder" data-rf-success="เปิดใบสั่งผลิต {result} แล้ว" id="rf-create-order">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-create-order">บันทึกใบสั่งผลิต</button>` });
    const bind = (dialog) => {
      const recipeSelect = dialog.querySelector("[data-rf-recipe]");
      const target = dialog.querySelector("[data-rf-target]");
      const need = dialog.querySelector("[data-rf-need]");
      const paint = () => {
        const recipe = data.recipes.find((row) => row.id === recipeSelect.value);
        const kg = recipe && Number(target.value) > 0 ? Number(target.value) / recipe.yieldPerKg : 0;
        need.textContent = kg ? `ต้องใช้คอมปาวด์ประมาณ ${fmtNum(kg, 1)} kg ≈ ${Math.ceil(kg / recipe.batchKg)} batch (หน่วย ${recipe.uom})` : recipe ? `หน่วย ${recipe.uom}` : "";
      };
      recipeSelect?.addEventListener("change", paint);
      target?.addEventListener("input", paint);
      paint();
    };
    return { html, bind };
  };

  // ---------- สูตรยาง ----------
  pages.recipes = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const { recipeLines, totalPhr, fmtDate, fmtNum } = rules;
    const selected = data.recipes.find((recipe) => recipe.id === params.get("sel")) ?? data.recipes[0] ?? null;
    const list = data.recipes.map((recipe) => `<a class="rf-list-item${recipe.id === selected?.id ? " is-selected" : ""}" href="${esc(ctx.pageUrl({ sel: recipe.id }))}"${recipe.id === selected?.id ? ' aria-current="true"' : ""}>
        <div class="rf-row rf-between"><strong class="rf-mono">${esc(recipe.id)}</strong>${ui.status(recipe.status)}</div><div>${esc(recipe.name)}</div><div class="small muted">${esc(`${recipe.productName} · ${recipe.batchKg} kg/batch`)}</div></a>`).join("");
    let detail = ui.card(ui.empty("เลือกสูตรจากรายการด้านซ้าย"));
    if (selected) {
      const lines = recipeLines(selected).map((line) => {
        const material = data.materials.find((row) => row.code === line.materialCode);
        return `<tr><td class="rf-mono">${esc(line.materialCode)}</td><td>${esc(material?.name ?? "")}</td><td class="small">${esc(material?.category ?? "")}</td><td class="right">${esc(String(line.phr))}</td><td class="right rf-mono">${esc(fmtNum(line.kgPerBatch, 3))}</td><td class="small muted">${esc(material?.storage ?? "")}</td></tr>`;
      });
      const approve = selected.status === "draft" && ctx.can("approveRecipe") ? ui.button("อนุมัติสูตร", { action: "approveRecipe", args: { id: selected.id }, className: "small", confirmText: "" }) : "";
      detail = ui.card(`<div class="rf-grid rf-g4 rf-facts">
          <div><span class="small muted">Total PHR</span><strong>${esc(fmtNum(totalPhr(selected), 1))}</strong></div>
          <div><span class="small muted">น้ำหนักต่อ batch</span><strong>${esc(`${selected.batchKg} kg`)}</strong></div>
          <div><span class="small muted">Dump temp</span><strong>${esc(`${selected.dumpTemp} ± ${selected.dumpTol} °C`)}</strong></div>
          <div><span class="small muted">เวลาผสม / บ่ม</span><strong>${esc(`${selected.mixSec} s / ${selected.restHours} ชม.`)}</strong></div></div>
        ${ui.table(["รหัส", "วัตถุดิบ", "หมวด", { label: "PHR", className: "right" }, { label: "kg / batch", className: "right" }, "การจัดเก็บ"], lines)}
        ${ui.kv([["สินค้า", esc(`${selected.productCode} · ${selected.productName} (หน่วย ${selected.uom})`)], ["ผลผลิตโดยประมาณ", esc(`${selected.yieldPerKg} ${selected.uom} ต่อคอมปาวด์ 1 kg`)], ["Revision", esc(`Rev.${selected.revision}`)],
          ["ผู้สร้าง", esc(`${selected.createdBy ?? "-"} · ${fmtDate(selected.createdAt)}`)], ["ผู้อนุมัติ", esc(selected.approvedBy ? `${selected.approvedBy} · ${fmtDate(selected.approvedAt)}` : "รออนุมัติ")]])}`,
      { title: esc(selected.name), actions: approve });
    }
    const html = `${ui.pageHead("สูตรยาง (BOM / PHR)", "สูตรคิดเป็น PHR (ส่วนต่อยาง 100 ส่วน) ระบบคำนวณน้ำหนักต่อ batch ให้อัตโนมัติ สูตรต้องได้รับอนุมัติก่อนใช้เปิดใบสั่งผลิต", ui.openButton("สร้างสูตรใหม่", "createRecipe", {}, { className: "" }))}
      <div class="rf-split">${ui.card(`<div class="rf-list">${list || ui.empty("ยังไม่มีสูตร")}</div>`, { title: `สูตรทั้งหมด (${data.recipes.length})`, flush: true })}${detail}</div>`;
    return { html };
  };

  dialogs.createRecipe = (ctx) => {
    const { data, ui, rules } = ctx;
    const { fmtNum } = rules;
    const materialOptions = data.materials.map((material) => ({ value: material.code, label: `${material.code} · ${material.name}` }));
    const starting = [["EPDM-55", 100], ["CB-N550", 70], ["ZNO", 5], ["STA", 1], ["S-80", 1.5]];
    const row = (code, phr) => `<tr class="rf-recipe-row"><td>${ui.select("materialCode[]", materialOptions, { value: code })}</td><td>${ui.input("phr[]", { type: "number", value: String(phr), step: "any", min: 0 })}</td><td class="right rf-mono" data-rf-kg>-</td><td><button class="btn rf-btn secondary small" type="button" data-rf-remove aria-label="ลบรายการ">ลบ</button></td></tr>`;
    const body = `<div class="rf-grid rf-g3">
        ${ui.field("รหัสสูตร *", ui.input("id", { placeholder: "RC-EPDM-XX01", required: true }))}
        ${ui.field("ชื่อสูตร *", ui.input("name", { required: true }))}
        ${ui.field("หน่วยสินค้า", ui.select("uom", [{ value: "m", label: "เมตร (m)" }, { value: "pcs", label: "ชิ้น (pcs)" }]))}
        ${ui.field("รหัสสินค้า", ui.input("productCode"))}
        ${ui.field("ชื่อสินค้า *", ui.input("productName", { required: true }))}
        ${ui.field("น้ำหนักต่อ batch (kg)", ui.input("batchKg", { type: "number", value: "50", step: "any", extra: "data-rf-batch" }))}
        ${ui.field("Dump temp (°C)", ui.input("dumpTemp", { type: "number", value: "130", step: "any" }))}
        ${ui.field("ค่าเผื่อ Dump temp (±°C)", ui.input("dumpTol", { type: "number", value: "5", step: "any" }))}
        ${ui.field("เวลาผสม (s)", ui.input("mixSec", { type: "number", value: "270" }))}
        ${ui.field("เวลาบ่มขั้นต่ำ (ชม.)", ui.input("restHours", { type: "number", value: "4", step: "any" }))}
        ${ui.field("ผลผลิตต่อ kg", ui.input("yieldPerKg", { type: "number", value: "6", step: "any" }))}
      </div>
      <div class="table-wrap"><table class="rf-table"><thead><tr><th>วัตถุดิบ</th><th class="rf-col-phr">PHR</th><th class="right">kg / batch</th><th></th></tr></thead><tbody data-rf-items>${starting.map(([code, phr]) => row(code, phr)).join("")}</tbody></table></div>
      <div class="rf-row rf-between"><button class="btn rf-btn secondary small" type="button" data-rf-add>เพิ่มวัตถุดิบ</button><span class="muted small" data-rf-total></span></div>`;
    const html = ui.dialog("createRecipe", "สร้างสูตรการผลิตใหม่", `<form data-rf-form="createRecipe" data-rf-success="บันทึกสูตรแล้ว (รออนุมัติ)" id="rf-create-recipe">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-create-recipe">บันทึกสูตร</button>`, wide: true });
    const bind = (dialog) => {
      const tbody = dialog.querySelector("[data-rf-items]");
      const total = dialog.querySelector("[data-rf-total]");
      const batch = dialog.querySelector("[data-rf-batch]");
      const paint = () => {
        const rows = [...tbody.querySelectorAll(".rf-recipe-row")];
        const phrs = rows.map((tr) => Number(tr.querySelector('input[name="phr[]"]').value) || 0);
        const sum = phrs.reduce((a, b) => a + b, 0);
        const batchKg = Number(batch.value) || 0;
        rows.forEach((tr, index) => { tr.querySelector("[data-rf-kg]").textContent = fmtNum(sum ? (phrs[index] / sum) * batchKg : 0, 3); });
        total.textContent = `รวม PHR ${fmtNum(sum, 1)} · น้ำหนักรวม ${fmtNum(batchKg, 2)} kg`;
      };
      const wire = (tr) => {
        tr.querySelector("[data-rf-remove]").addEventListener("click", () => { tr.remove(); paint(); });
        tr.querySelector('input[name="phr[]"]').addEventListener("input", paint);
      };
      tbody.querySelectorAll(".rf-recipe-row").forEach(wire);
      dialog.querySelector("[data-rf-add]").addEventListener("click", () => {
        tbody.insertAdjacentHTML("beforeend", row(data.materials[0]?.code ?? "", 1));
        wire(tbody.lastElementChild);
        paint();
      });
      batch.addEventListener("input", paint);
      paint();
    };
    return { html, bind };
  };

  // ---------- คลังวัตถุดิบและสินค้าสำเร็จรูป ----------
  pages.warehouse = (ctx) => {
    const { data, now, ui, rules, params } = ctx;
    const { DAY, lotState, fmtDate, fmtNum } = rules;
    const tab = params.get("tab") === "fg" ? "fg" : "raw";
    const lots = [...data.materialLots]
      .filter((lot) => lot.qtyKg > 0.0001 || lotState(lot, now) === "expired")
      .filter((lot) => includes(`${lot.lotNo} ${lot.materialCode}`, ctx.q))
      .sort((a, b) => a.materialCode.localeCompare(b.materialCode) || a.expiry - b.expiry);
    const available = data.materialLots.filter((lot) => lotState(lot, now) === "available");
    const soon = available.filter((lot) => lot.expiry - now < 30 * DAY);
    const expired = data.materialLots.filter((lot) => lotState(lot, now) === "expired" && lot.qtyKg > 0);
    const boxes = [...data.fgBoxes].sort((a, b) => b.createdAt - a.createdAt).filter((box) => includes(`${box.id} ${box.orderId}`, ctx.q));
    // ล็อตแรกที่ใช้ได้ของแต่ละวัตถุดิบ = ล็อตที่ FEFO จะจ่ายถัดไป
    const nextFefo = new Set(data.materials.map((material) => available.filter((lot) => lot.materialCode === material.code).sort((a, b) => a.expiry - b.expiry)[0]?.lotNo).filter(Boolean));
    const decide = ctx.can("qcDecision");

    const rawRows = lots.map((lot) => {
      const material = data.materials.find((row) => row.code === lot.materialCode);
      const state = lotState(lot, now);
      const days = Math.ceil((lot.expiry - now) / DAY);
      const buttons = [
        ui.openButton("ป้าย", "tag", { kind: "material", id: lot.lotNo }, { className: "secondary small", ariaLabel: `พิมพ์ป้าย ${lot.lotNo}` }),
        decide && state === "available" ? ui.button("กักกัน", { action: "setMaterialLotStatus", args: { lotNo: lot.lotNo, status: "hold" }, className: "secondary small" }) : "",
        decide && lot.status === "hold" ? ui.button("ปลดกักกัน", { action: "setMaterialLotStatus", args: { lotNo: lot.lotNo, status: "available" }, className: "secondary small" }) : "",
      ].filter(Boolean).join(" ");
      return `<tr><td class="rf-mono small">${esc(lot.lotNo)}${nextFefo.has(lot.lotNo) ? `<div>${ui.badge("accent", "จ่ายลำดับถัดไป (FEFO)")}</div>` : ""}</td>
        <td>${esc(material?.name ?? "")}<div class="small muted">${esc(material?.category ?? "")}</div></td>
        <td class="small">${esc(lot.location)}<div class="muted">${esc(`${lot.supplier}${lot.coa ? " · มี CoA" : ""}`)}</div></td>
        <td class="nowrap">${esc(fmtDate(lot.expiry))}<div class="small ${days < 0 ? "rf-late" : days < 30 ? "rf-warn-text" : "muted"}">${esc(days < 0 ? `เลยมา ${-days} วัน` : `อีก ${days} วัน`)}</div></td>
        <td class="right">${esc(`${fmtNum(lot.qtyKg, 2)} kg`)}<div class="small muted">${esc(`จาก ${fmtNum(lot.initialKg, 0)}`)}</div></td>
        <td>${ui.status(state)}</td><td class="right"><div class="rf-row rf-end">${buttons}</div></td></tr>`;
    });
    const fgRows = boxes.map((box) => `<tr><td><input type="checkbox" name="ids[]" value="${esc(box.id)}"${box.status !== "in_stock" ? " disabled" : ""} aria-label="เลือก ${esc(box.id)}"></td>
        <td class="rf-mono small">${esc(box.id)}<div class="muted">${esc(fmtDate(box.createdAt))}</div></td><td>${esc(box.productName)}</td><td class="rf-mono small">${esc(box.orderId)}</td>
        <td class="right">${esc(`${fmtNum(box.qty)} ${box.uom}`)}</td><td>${esc(box.grade)}</td><td>${ui.status(box.status)}</td>
        <td class="right">${ui.openButton("ป้าย", "tag", { kind: "box", id: box.id }, { className: "secondary small", ariaLabel: `พิมพ์ป้าย ${box.id}` })}</td></tr>`);
    const tabs = ui.tabs([{ id: "raw", label: "วัตถุดิบ" }, { id: "fg", label: "สินค้าสำเร็จรูป" }], tab, (id) => ctx.pageUrl({ tab: id === "raw" ? null : id, q: null }));
    const listbar = `<div class="rf-listbar">${tabs}<div class="rf-row">${tab === "fg" ? `<button class="btn rf-btn small" type="submit" form="rf-ship" data-rf-ship disabled>ส่งมอบกล่องที่เลือก</button>` : ""}${searchForm(ctx, "ค้นหารหัส…", { tab: true })}</div></div>`;
    const tableHtml = tab === "raw"
      ? ui.table(["ล็อต", "วัตถุดิบ", "ที่เก็บ / ผู้ขาย", "หมดอายุ", { label: "คงเหลือ", className: "right" }, "สถานะ", { label: "", className: "right" }], rawRows, { emptyText: "ไม่พบล็อตวัตถุดิบ" })
      : `<form id="rf-ship" data-rf-form="shipBoxes" data-rf-success="ส่งมอบกล่องแล้ว">${ui.table(["", "กล่อง", "สินค้า", "ใบสั่งผลิต", { label: "จำนวน", className: "right" }, "เกรด", "สถานะ", { label: "", className: "right" }], fgRows, { emptyText: "ไม่พบกล่องสินค้า" })}</form>`;
    const html = `${ui.pageHead("คลังวัตถุดิบและสินค้าสำเร็จรูป", "ควบคุมสต็อกตามหลัก FEFO บล็อกล็อตหมดอายุหรือถูกกักกัน และจัดการกล่องสินค้าพร้อมส่ง", ui.openButton("รับวัตถุดิบเข้าคลัง", "receiveMaterial", {}, { className: "" }))}
      ${ui.stats([
        { label: "สต็อกวัตถุดิบพร้อมใช้", value: `${fmtNum(available.reduce((sum, lot) => sum + lot.qtyKg, 0))} kg`, sub: `${available.length} ล็อต` },
        { label: "ใกล้หมดอายุ (30 วัน)", value: String(soon.length), sub: "จะถูกจ่ายก่อนตาม FEFO", tone: soon.length ? "warn" : "" },
        { label: "หมดอายุ / ถูกบล็อก", value: String(expired.length + data.materialLots.filter((lot) => lot.status === "hold").length), tone: "bad" },
        { label: "สินค้าพร้อมส่ง", value: `${data.fgBoxes.filter((box) => box.status === "in_stock").length} กล่อง` },
      ])}
      ${ui.card(`${listbar}${tableHtml}`, { flush: true })}`;
    const bind = (rootNode) => {
      const form = rootNode.querySelector("#rf-ship");
      const button = rootNode.querySelector("[data-rf-ship]");
      if (!form || !button) return;
      const paint = () => {
        const count = form.querySelectorAll('input[name="ids[]"]:checked').length;
        button.disabled = !count;
        button.textContent = count ? `ส่งมอบ ${count} กล่อง` : "ส่งมอบกล่องที่เลือก";
      };
      form.addEventListener("change", paint);
      paint();
    };
    return { html, bind };
  };

  dialogs.receiveMaterial = (ctx) => {
    const { data, now, ui, rules } = ctx;
    const { DAY, toInputDate } = rules;
    const first = data.materials[0];
    const body = `<div class="rf-grid rf-g2">
        ${ui.field("วัตถุดิบ *", ui.select("materialCode", data.materials.map((material) => ({ value: material.code, label: `${material.code} · ${material.name}` })), { value: first?.code ?? "", extra: "data-rf-material" }))}
        ${ui.field("ปริมาณ (kg) *", ui.input("qtyKg", { type: "number", step: "any", min: 0, required: true }))}
        ${ui.field("วันหมดอายุ *", ui.input("expiry", { type: "date", value: toInputDate(now + 180 * DAY), required: true }))}
        ${ui.field("ผู้ขาย", ui.input("supplier"))}
        ${ui.field("ตำแหน่งจัดเก็บ", ui.input("location"), { hint: `ค่าเริ่มต้น: <span data-rf-storage>${esc(first?.storage ?? "")}</span>` })}
        ${ui.field("เอกสาร CoA จากผู้ขาย", ui.select("coa", [{ value: "yes", label: "มี" }, { value: "no", label: "ไม่มี" }]))}
      </div>`;
    const html = ui.dialog("receiveMaterial", "รับวัตถุดิบเข้าคลัง", `<form data-rf-form="receiveMaterial" data-rf-success="รับเข้าล็อต {result} แล้ว" id="rf-receive-material">${body}</form>`, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="rf-receive-material">รับเข้าและสร้างล็อต</button>` });
    const bind = (dialog) => {
      const select = dialog.querySelector("[data-rf-material]");
      select?.addEventListener("change", () => { dialog.querySelector("[data-rf-storage]").textContent = data.materials.find((material) => material.code === select.value)?.storage ?? ""; });
    };
    return { html, bind };
  };

  // ---------- แม่พิมพ์และหัวดาย ----------
  const MOLD_KIND = { die: "หัวดายรีด", mold: "แม่พิมพ์อัด", line: "สายอบต่อเนื่อง" };
  const MOLD_UNIT = { m: "เมตร", pcs: "ชิ้น", shot: "รอบ" };
  pages.molds = (ctx) => {
    const { data, ui, rules } = ctx;
    const { fmtDate, fmtNum } = rules;
    const cards = data.molds.map((mold) => {
      const pct = mold.usageSinceClean / mold.cleanEvery;
      const pmPct = mold.totalUsage / mold.pmLimit;
      const tone = pct >= 1 ? "bad" : pct >= 0.85 ? "warn" : "";
      return ui.card(`<div class="rf-stack">
          <div><strong>${esc(mold.name)}</strong><div class="small muted">${esc(`${MOLD_KIND[mold.kind] ?? mold.kind}${mold.perCycle > 1 ? ` · ${mold.perCycle} cavity` : ""}`)}</div></div>
          <div><div class="rf-row rf-between small"><span>ตั้งแต่ทำความสะอาดล่าสุด</span><span>${esc(`${fmtNum(mold.usageSinceClean)} / ${fmtNum(mold.cleanEvery)} ${MOLD_UNIT[mold.unit] ?? mold.unit}`)}</span></div>${ui.progress(mold.usageSinceClean, mold.cleanEvery, tone)}</div>
          <div><div class="rf-row rf-between small"><span>อายุสะสม (PM ใหญ่)</span><span>${esc(`${Math.round(pmPct * 100)}%`)}</span></div>${ui.progress(mold.totalUsage, mold.pmLimit, pmPct > 0.9 ? "warn" : "")}<div class="small muted">${esc(`${fmtNum(mold.totalUsage)} / ${fmtNum(mold.pmLimit)} ${MOLD_UNIT[mold.unit] ?? mold.unit}`)}</div></div>
          <div class="rf-row rf-between"><span class="small muted">${esc(`ล้างล่าสุด ${fmtDate(mold.lastCleanAt)}`)}</span>${ui.button("บันทึกล้างแล้ว", { action: "cleanMold", args: { id: mold.id }, className: "secondary small", confirmText: `ยืนยันว่าได้ทำความสะอาด ${mold.id} แล้ว?` })}</div>
        </div>`, { title: ui.mono(mold.id), actions: ui.badge(tone || "good", tone === "bad" ? "เกินรอบล้าง" : tone === "warn" ? "ใกล้ถึงรอบล้าง" : "ปกติ") });
    }).join("");
    const html = `${ui.pageHead("แม่พิมพ์และหัวดาย", "ระบบนับรอบการใช้งานจากการบันทึกผลิตจริง แจ้งเตือนเมื่อใกล้ถึงรอบทำความสะอาด และติดตามอายุสะสมเทียบรอบซ่อมบำรุงใหญ่ (PM)")}<div class="rf-grid rf-g3">${cards}</div>`;
    return { html };
  };

  // ---------- บันทึกการใช้งาน ----------
  pages.audit = (ctx) => {
    const { data, ui, rules } = ctx;
    const rows = data.audit.filter((entry) => includes(`${entry.user} ${entry.action} ${entry.detail}`, ctx.q)).slice(0, 300)
      .map((entry) => `<tr><td class="nowrap small">${esc(rules.fmtDateTime(entry.at))}</td><td>${esc(entry.user)}</td><td>${esc(entry.action)}</td><td class="rf-mono small">${esc(entry.detail)}</td></tr>`);
    const html = `${ui.pageHead("บันทึกการใช้งาน (Audit Trail)", "ทุกการเข้าสู่ระบบและทุกธุรกรรมถูกบันทึกพร้อมชื่อผู้ทำและเวลา", searchForm(ctx, "ค้นหาผู้ใช้ การกระทำ หรือรหัส…"))}
      ${ui.card(ui.table(["เวลา", "ผู้ใช้", "การกระทำ", "รายละเอียด"], rows, { emptyText: "ไม่พบรายการ" }), { flush: true })}`;
    return { html };
  };
})(typeof window !== "undefined" ? window : globalThis);
