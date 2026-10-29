// BOM รายแผนก (โหมดทดสอบ) — หน้าและ dialog ทั้งหมด: ภาพรวม · BOM ของแผนก (item master + ต้นไม้ + revision) · สูตรยาง ↔ RubberFlow ·
// นำเข้าจาก Excel · ใบสั่งผลิต (PI) · งานของแผนก · บันทึกการใช้งาน ทุกหน้าคืน { html, bind?(root, ctx) } ลงทะเบียนใน window.MNP_BOM_PAGES / _DIALOGS
// ใช้ชิ้นส่วน HTML ของ RubberFlow (ctx.ui) และกติกา event data-rf-* ที่ modules/module-bom.js ผูกให้ — โหลดหลัง rubberflow-ui.js และ bom-rules.js
(function (root) {
  const pages = (root.MNP_BOM_PAGES ??= {});
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const includes = (haystack, q) => !q || String(haystack).toLowerCase().includes(q.toLowerCase());

  const ICONS = Object.freeze({ dashboard: "🧭", items: "🧱", compounds: "🧪", import: "📥", orders: "📋", jobs: "🛠️", audit: "🕘" });
  pages.icon = (id) => (ICONS[id] ? `<span class="rf-ico" aria-hidden="true">${ICONS[id]}</span>` : "");
  const head = (ctx, title, desc = "", actionsHtml = "") => `<header class="rf-pagehead"><div class="rf-pagehead-main">${ICONS[ctx.page] ? `<span class="rf-mod-ico" aria-hidden="true">${pages.icon(ctx.page)}</span>` : ""}<div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ""}</div></div>${actionsHtml ? `<div class="rf-row">${actionsHtml}</div>` : ""}</header>`;

  const STATUS = Object.freeze({
    draft: ["", "ร่าง"], pending: ["warn", "รออนุมัติ"], approved: ["good", "อนุมัติแล้ว"], superseded: ["", "ถูกแทนแล้ว"],
    released: ["info", "ปล่อยผลิต"], in_progress: ["accent", "กำลังผลิต"], completed: ["good", "เสร็จสิ้น"], cancelled: ["bad", "ยกเลิก"],
    queued: ["", "รอคิว"], done: ["good", "เสร็จ"], hold: ["warn", "พักงาน"],
    EX: ["info", "ต่างประเทศ"], SA: ["", "ในประเทศ"],
  });
  const status = (ctx, value) => { const [tone, label] = STATUS[value] ?? ["", String(value ?? "")]; return ctx.ui.badge(tone, label); };
  const statusLabel = (value) => STATUS[value]?.[1] ?? String(value ?? "");
  const deptBadge = (ctx, dept) => ctx.ui.badge("", dept);
  const kindLabel = (ctx, kind) => ctx.rules.KINDS[kind]?.label ?? kind;
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);
  const searchForm = (ctx, placeholder) => `<form class="rf-search" data-rf-search role="search"><label class="sr-only" for="bom-q">ค้นหา</label>${ctx.ui.input("q", { id: "bom-q", type: "search", value: ctx.q, placeholder })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>`;
  const itemOf = (ctx, code) => ctx.helpers.itemOf(ctx.data, code);
  const approvedBomOf = (ctx, code) => ctx.helpers.approvedBomOf(ctx.data, code);
  const openBomOf = (ctx, code) => ctx.helpers.openBomOf(ctx.data, code);
  const whereUsed = (ctx, code) => ctx.data.boms.filter((bom) => bom.status === "approved" && bom.lines.some((line) => line.childCode === code)).map((bom) => bom.itemCode);
  const myDept = (ctx) => (ctx.rules.DEPTS.includes(ctx.user?.dept) ? ctx.user.dept : "PK");
  const jobProgress = (ctx, job) => `${ctx.ui.progress(job.qtyDone, job.qtyPlanned, job.status === "hold" ? "bad" : "")}<div class="small muted">${esc(`${ctx.rules.fmtQty(job.qtyDone)} / ${ctx.rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}${job.qtyReject ? ` · เสีย ${ctx.rules.fmtQty(job.qtyReject)}` : ""}`)}</div>`;
  const late = (ctx, job) => job.status !== "done" && job.dueAt < ctx.now;
  // ต้นไม้ของชิ้นงาน 1 หน่วย (ระเบิดด้วย BOM อนุมัติ) เป็นแถวตารางเยื้องตามชั้น
  const treeRows = (ctx, code, qty = 1) => {
    const { lines } = ctx.rules.explode(code, qty, { itemOf: (c) => itemOf(ctx, c), approvedBomOf: (c) => approvedBomOf(ctx, c) });
    return lines;
  };
  const levelCell = (level, text) => `<span class="bom-lv bom-lv-${Math.min(level, 6)}">${text}</span>`;

  // ---------- ภาพรวม ----------
  pages.dashboard = (ctx) => {
    const { data, ui, rules, user } = ctx;
    const pending = data.boms.filter((bom) => bom.status === "pending");
    const mine = pending.filter((bom) => ctx.helpers.canApprove(user, bom));
    const openOrders = data.orders.filter((order) => ["draft", "released", "in_progress"].includes(order.status));
    const openJobs = data.jobs.filter((job) => job.status !== "done");
    const lateJobs = openJobs.filter((job) => late(ctx, job));
    const myJobs = openJobs.filter((job) => job.dept === user.dept || (job.dept === "PK" && user.role === "planner"));
    const byKind = Object.keys(rules.KINDS).map((kind) => [kind, data.items.filter((item) => item.kind === kind).length]).filter(([, n]) => n);
    const statsHtml = ui.stats([
      { label: "ชิ้นงานใน item master", value: rules.fmtQty(data.items.length), sub: byKind.map(([kind, n]) => `${kind} ${n}`).join(" · ") },
      { label: "BOM รออนุมัติ", value: String(pending.length), sub: mine.length ? `${mine.length} รายการรอคุณอนุมัติ` : "ไม่มีที่รอคุณ", tone: mine.length ? "warn" : "" },
      { label: "ใบสั่งผลิตที่เปิดอยู่", value: String(openOrders.length), sub: `${data.orders.filter((order) => order.status === "draft").length} ร่าง · ${openOrders.length - data.orders.filter((order) => order.status === "draft").length} กำลังผลิต` },
      { label: "งานค้าง", value: String(openJobs.length), sub: lateJobs.length ? `เลยกำหนด ${lateJobs.length}` : "ไม่มีงานเลยกำหนด", tone: lateJobs.length ? "bad" : "" },
    ]);
    const jobRows = [...openJobs].sort((a, b) => a.dueAt - b.dueAt).slice(0, 10).map((job) => `<tr${late(ctx, job) ? ' class="is-late"' : ""}><td class="nowrap">${esc(rules.fmtDate(job.dueAt))}</td><td>${deptBadge(ctx, job.dept)}</td><td>${ui.mono(job.itemCode)}<div class="small muted">${esc(job.name)}</div></td><td>${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId }))}</td><td class="rf-progress-cell">${jobProgress(ctx, job)}</td><td>${status(ctx, job.status)}</td></tr>`);
    const pendingRows = pending.map((bom) => `<tr><td>${ui.link(bom.itemCode, ctx.url("items", { dept: bom.ownerDept, sel: bom.itemCode }))}<div class="small muted">${esc(itemOf(ctx, bom.itemCode)?.name ?? "")}</div></td><td>${deptBadge(ctx, bom.ownerDept)}</td><td class="nowrap">Rev.${esc(String(bom.revision))}</td><td>${esc(bom.submittedBy ?? "")}<div class="small muted">${esc(rules.fmtDateTime(bom.submittedAt))}</div></td><td class="nowrap">${ctx.helpers.canApprove(user, bom) ? `${ui.button("อนุมัติ", { action: "approveBom", args: { bomId: bom.id }, className: "small" })} ${ui.button("ตีกลับ", { action: "rejectBom", args: { bomId: bom.id }, className: "secondary small" })}` : ""}</td></tr>`);
    const html = `${head(ctx, "ภาพรวม BOM", `สวัสดี ${user.name} (${ctx.roleLabel(user.role)}) · งานของแผนกคุณที่ยังค้าง ${myJobs.length} รายการ`)}
      ${statsHtml}
      <div class="rf-grid rf-g2">
        ${ui.card(ui.table(["กำหนด", "แผนก", "ชิ้นงาน", "ใบ PI", "ความคืบหน้า", "สถานะ"], jobRows, { emptyText: "ไม่มีงานค้าง" }), { title: "งานใกล้กำหนด", flush: true, actions: ui.link("ดูทั้งหมด", ctx.url("jobs"), "btn rf-btn secondary small") })}
        ${ui.card(ui.table(["ชิ้นงาน", "แผนก", "Rev", "ผู้ส่ง", ""], pendingRows, { emptyText: "ไม่มี BOM รออนุมัติ" }), { title: "BOM รออนุมัติ", flush: true })}
      </div>`;
    return { html };
  };

  // ---------- BOM ของแผนก ----------
  pages.items = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const dept = rules.DEPTS.includes(params.get("dept")) ? params.get("dept") : myDept(ctx);
    const sel = params.get("sel") ? rules.canonicalCode(params.get("sel")) : "";
    const canEdit = ctx.helpers.canEditDept(user, dept);
    const list = data.items.filter((item) => item.ownerDept === dept && includes(`${item.code} ${item.name} ${item.legacyCodes.join(" ")}`, ctx.q)).sort((a, b) => a.code.localeCompare(b.code));
    const tabs = ui.tabs(rules.DEPTS.map((code) => ({ id: code, label: `${code} (${data.items.filter((item) => item.ownerDept === code).length})` })), dept, (id) => ctx.url("items", { dept: id }));
    const rows = list.slice(0, 300).map((item) => {
      const approved = approvedBomOf(ctx, item.code);
      const open = openBomOf(ctx, item.code);
      return `<tr${item.code === sel ? ' class="is-selected"' : ""}><td>${ui.link(item.code, ctx.url("items", { dept, sel: item.code, q: ctx.q || null }), "rf-mono")}${item.legacyCodes.length ? `<div class="small muted" title="รหัสสะกดเดิมในชีต">เดิม: ${esc(item.legacyCodes.join(", "))}</div>` : ""}</td><td>${esc(item.name)}<div class="small muted">${esc(kindLabel(ctx, item.kind))}</div></td><td class="nowrap">${esc(uomText(ctx, item.uom))}</td><td class="nowrap">${approved ? `Rev.${approved.revision}` : rules.MANUFACTURED.includes(item.kind) && !["RB", "SUBPART"].includes(item.kind) ? ui.badge("warn", "ไม่มี BOM") : '<span class="muted">—</span>'}${open ? ` ${status(ctx, open.status)}` : ""}</td><td class="right">${esc(String(whereUsed(ctx, item.code).length))}</td></tr>`;
    });
    const listCard = ui.card(`${searchForm(ctx, "ค้นหารหัส ชื่อ หรือรหัสเดิม…")}${ui.table(["รหัส", "ชื่อ", "หน่วย", "BOM", { label: "ใช้ใน", className: "right" }], rows, { emptyText: ctx.q ? "ไม่พบชิ้นงาน" : "แผนกนี้ยังไม่มีชิ้นงาน" })}${list.length > 300 ? `<p class="small muted">แสดง 300 จาก ${list.length} รายการ ใช้ช่องค้นหาเพื่อกรอง</p>` : ""}`,
      { title: `ชิ้นงานของแผนก ${esc(dept)} <span class="muted">${esc(rules.DEPT_LABEL[dept])}</span>`, actions: canEdit ? ui.openButton("เพิ่มชิ้นงาน", "itemEdit", { dept }, { className: "" }) : "" });

    const selected = sel ? itemOf(ctx, sel) : null;
    let detail = "";
    if (selected) {
      const approved = approvedBomOf(ctx, selected.code);
      const revisions = data.boms.filter((bom) => bom.itemCode === selected.code).sort((a, b) => b.revision - a.revision);
      const ownerCanEdit = ctx.helpers.canEditDept(user, selected.ownerDept);
      const tree = treeRows(ctx, selected.code, 1).slice(1);
      const treeHtml = ui.table(["ชั้น / ชิ้นงาน", "ชื่อ", "แผนกผลิต", { label: `ต่อ 1 ${uomText(ctx, selected.uom)}`, className: "right" }, "หน่วย", "Rev"],
        tree.map((line) => `<tr><td>${levelCell(line.level, ui.link(line.itemCode, ctx.url("items", { dept: line.producerDept, sel: line.itemCode }), "rf-mono"))}</td><td>${esc(line.name)}${line.noBom ? ` ${ui.badge("warn", "ไม่มี BOM")}` : ""}</td><td>${deptBadge(ctx, line.producerDept)}</td><td class="right rf-mono">${esc(rules.fmtQty(line.qtyPerFg))}</td><td>${esc(uomText(ctx, line.uom))}</td><td class="small muted">${line.revision ? `Rev.${line.revision}` : ""}</td></tr>`),
        { emptyText: ["RB", "PURCHASED"].includes(selected.kind) ? (selected.kind === "RB" ? "เส้นยางเป็นชิ้นปลายทางของ BOM นี้ สูตรคอมปาวด์อยู่ที่ RubberFlow" : "ของซื้อไม่มีส่วนประกอบ") : "ยังไม่มี BOM ที่อนุมัติ" });
      const rubber = selected.rubber;
      const facts = ui.kv([
        ["ชนิด", esc(kindLabel(ctx, selected.kind))], ["แผนกเจ้าของ", esc(`${selected.ownerDept} · ${rules.DEPT_LABEL[selected.ownerDept] ?? ""}`)], ["หน่วย", esc(uomText(ctx, selected.uom))],
        selected.weightG ? ["น้ำหนัก", esc(`${rules.fmtQty(selected.weightG)} กรัม`)] : null,
        rubber?.compound ? ["สูตรยาง", `${ui.link(rubber.compound, ctx.url("compounds", { q: rubber.compound }), "rf-mono")} ${data.compounds.find((c) => c.code === rubber.compound)?.recipeId ? ui.badge("good", "ผูก RubberFlow แล้ว") : ui.badge("warn", "ยังไม่ผูกสูตร RubberFlow")}`] : null,
        rubber && selected.kind === "RB" ? ["ขนาด", esc(`ประเภท ${rubber.type ?? "-"} สี ${rubber.color || "-"} · ยาว ${rubber.lengthMm ?? "-"} รู/หนา ${rubber.holeMm ?? "-"} วงนอก ${rubber.odMm ?? "-"} มม.`)] : null,
        rubber && selected.kind === "RB" ? ["การตัด (GR)", esc(`ตัด ${rubber.cutLengthCm || "-"} ซม. · ${rubber.pcsPerRoll || "-"} ชิ้น/เส้น · ${rubber.sePerGr || 1} SE ต่อ 1 GR · ${rubber.kgPerRoll || "-"} กก./เส้น → ${rules.fmtQty(rules.rbPerSe({ pcsPerRoll: rubber.pcsPerRoll, sePerGr: rubber.sePerGr, uom: selected.uom, weightG: selected.weightG }))} เส้นต่อ 1 SE`)] : null,
        rubber && selected.kind === "SE" ? ["ขนาด", esc(`สี ${rubber.color || "-"} · ยาว ${rubber.lengthMm ?? "-"} รู/หนา ${rubber.holeMm ?? "-"} วงนอก ${rubber.odMm ?? "-"} มม.`)] : null,
        ["ใช้ใน", whereUsed(ctx, selected.code).length ? whereUsed(ctx, selected.code).map((code) => ui.link(code, ctx.url("items", { dept: itemOf(ctx, code)?.ownerDept ?? dept, sel: code }), "rf-mono")).join(", ") : '<span class="muted">ไม่มีพ่อ</span>'],
        selected.legacyCodes.length ? ["รหัสเดิมในชีต", esc(selected.legacyCodes.join(", "))] : null,
      ]);
      const revRows = revisions.map((bom) => {
        const buttons = [];
        if (bom.status === "draft" && ownerCanEdit) buttons.push(ui.openButton("แก้", "bomEdit", { itemCode: selected.code }, { className: "secondary small" }), ui.button("ส่งอนุมัติ", { action: "submitBom", args: { bomId: bom.id }, className: "small" }), ui.button("ลบร่าง", { action: "discardBom", args: { bomId: bom.id }, className: "secondary small", confirmText: "ลบร่างนี้?" }));
        if (bom.status === "pending") {
          if (ctx.helpers.canApprove(user, bom)) buttons.push(ui.button("อนุมัติ", { action: "approveBom", args: { bomId: bom.id }, className: "small" }));
          if (ctx.helpers.canApprove(user, bom) || ownerCanEdit) buttons.push(ui.button("ตีกลับ", { action: "rejectBom", args: { bomId: bom.id }, className: "secondary small" }));
        }
        return `<tr><td class="nowrap">Rev.${esc(String(bom.revision))}</td><td>${status(ctx, bom.status)}</td><td>${esc(String(bom.lines.length))} บรรทัด${bom.note ? `<div class="small muted">${esc(bom.note)}</div>` : ""}</td><td class="small">${bom.changeLog.slice(-2).map((entry) => `<div>${esc(`${rules.fmtDate(entry.at)} ${entry.by}: ${entry.text}`)}</div>`).join("")}</td><td class="nowrap">${buttons.join(" ")}</td></tr>`;
      });
      const canStartDraft = ownerCanEdit && !openBomOf(ctx, selected.code) && !["RB", "PURCHASED"].includes(selected.kind);
      detail = ui.card(`${facts}
        <h3 class="bom-h3">ส่วนประกอบ (BOM อนุมัติ${approved ? ` Rev.${approved.revision} โดย ${esc(approved.approvedBy)} ${esc(rules.fmtDate(approved.approvedAt))}` : ""})</h3>${treeHtml}
        <h3 class="bom-h3">Revision</h3>${ui.table(["Rev", "สถานะ", "เนื้อหา", "ประวัติ", ""], revRows, { emptyText: "ยังไม่มี revision" })}`,
        { title: `${esc(selected.code)} <span class="muted">${esc(selected.name)}</span>`, actions: `${ownerCanEdit ? ui.openButton("แก้ข้อมูลชิ้นงาน", "itemEdit", { code: selected.code, dept: selected.ownerDept }, { className: "secondary" }) : ""}${canStartDraft ? ui.openButton(approved ? "แก้ BOM (ร่าง Rev ใหม่)" : "สร้าง BOM", "bomEdit", { itemCode: selected.code }, { className: "" }) : ""}` });
    }
    const html = `${head(ctx, "BOM ของแผนก", "แต่ละแผนกเป็นเจ้าของและแก้ได้เฉพาะชั้นที่ตนผลิต · ชั้นสินค้าสำเร็จรูป (PK) อนุมัติโดยผู้จัดการ ชั้นอื่นหัวหน้าแผนกอนุมัติ")}${tabs}
      <div class="bom-split">${listCard}${detail}</div>`;
    return { html };
  };

  // dialog: เพิ่ม/แก้ชิ้นงาน
  dialogs.itemEdit = (ctx, { code = "", dept = "PK" }) => {
    const { ui, rules, data } = ctx;
    const item = code ? itemOf(ctx, code) : null;
    const kind = item?.kind ?? ({ PK: "FG", GR: "SE", RB: "RB", PT: "PT", BG: "BG", ST: "PURCHASED" })[dept] ?? "FG";
    const rubber = item?.rubber ?? {};
    const kindOptions = Object.entries(rules.KINDS).map(([value, meta]) => ({ value, label: `${value} · ${meta.label}` }));
    const uomOptions = Object.entries(rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
    const deptOptions = rules.DEPTS.map((value) => ({ value, label: rules.DEPT_LABEL[value] }));
    const compoundOptions = data.compounds.map((entry) => entry.code);
    const body = `<form id="bom-item-form" data-rf-form="saveItem" data-rf-success="บันทึกชิ้นงาน {result}"${item ? "" : ' data-rf-args=\'{"create":true}\''}>
      <div class="rf-grid rf-g2">
        ${ui.field("รหัสชิ้นงาน *", item ? `<input class="input rf-input" name="code" value="${attr(item.code)}" readonly>` : ui.input("code", { required: true, placeholder: "เช่น RB-DM01-02-OR01-202-18-70" }))}
        ${ui.field("ชนิด *", ui.select("kind", kindOptions, { value: kind, extra: "data-bom-kind" }))}
      </div>
      ${ui.field("ชื่อชิ้นงาน *", ui.input("name", { value: item?.name ?? "", required: true }))}
      <div class="rf-grid rf-g3">
        ${ui.field("แผนกเจ้าของ", ui.select("ownerDept", deptOptions, { value: item?.ownerDept ?? dept }))}
        ${ui.field("หน่วยนับ *", ui.select("uom", uomOptions, { value: item?.uom ?? "pcs" }))}
        ${ui.field("น้ำหนัก (กรัม/หน่วย)", ui.input("weightG", { type: "number", step: "any", min: 0, value: item?.weightG ?? "" }))}
      </div>
      <fieldset class="bom-fieldset" data-bom-rubber><legend>ข้อมูลยาง (เฉพาะ RB / SE)</legend>
        <div class="rf-grid rf-g3">
          ${ui.field("รหัสสูตรยาง (RB)", ui.input("rubber.compound", { value: rubber.compound ?? "", list: "bom-compound-list", placeholder: "เช่น DM01" }))}<datalist id="bom-compound-list">${compoundOptions.map((option) => `<option value="${attr(option)}"></option>`).join("")}</datalist>
          ${ui.field("ประเภท (01 ตัน / 02 มีรู / 03 แผ่น)", ui.input("rubber.type", { value: rubber.type ?? "" }))}
          ${ui.field("สี (แม่สี+เฉด)", ui.input("rubber.color", { value: rubber.color ?? "", placeholder: "OR01" }))}
          ${ui.field("ความยาว (มม.)", ui.input("rubber.lengthMm", { type: "number", step: "any", value: rubber.lengthMm ?? "" }))}
          ${ui.field("รู/ความหนา (มม.)", ui.input("rubber.holeMm", { type: "number", step: "any", value: rubber.holeMm ?? "" }))}
          ${ui.field("วงนอก (มม.)", ui.input("rubber.odMm", { type: "number", step: "any", value: rubber.odMm ?? "" }))}
          ${ui.field("กก. ต่อเส้น/ม้วน (RB)", ui.input("rubber.kgPerRoll", { type: "number", step: "any", value: rubber.kgPerRoll ?? "" }))}
          ${ui.field("ความยาวตัด (ซม.) (RB)", ui.input("rubber.cutLengthCm", { type: "number", step: "any", value: rubber.cutLengthCm ?? "" }))}
          ${ui.field("ชิ้นที่ตัดได้ต่อเส้น (RB)", ui.input("rubber.pcsPerRoll", { type: "number", step: "any", value: rubber.pcsPerRoll ?? "" }))}
          ${ui.field("SE ที่ได้ต่อ 1 GR (RB)", ui.input("rubber.sePerGr", { type: "number", step: "any", value: rubber.sePerGr ?? "" }))}
        </div>
      </fieldset>
    </form>`;
    return { html: ui.dialog("itemEdit", item ? `แก้ข้อมูล ${item.code}` : `เพิ่มชิ้นงานของแผนก ${dept}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-item-form">บันทึก</button>` }) };
  };

  // dialog: แก้ BOM (ร่าง revision ใหม่หรือแก้ร่างเดิม)
  dialogs.bomEdit = (ctx, { itemCode }) => {
    const { ui, rules, data } = ctx;
    const parent = itemOf(ctx, itemCode);
    if (!parent) return null;
    const base = openBomOf(ctx, parent.code) ?? approvedBomOf(ctx, parent.code);
    const candidates = data.items.filter((item) => item.code !== parent.code && item.active !== false).sort((a, b) => a.code.localeCompare(b.code));
    const options = candidates.map((item) => ({ value: item.code, label: `${item.code} · ${item.name.slice(0, 50)}` }));
    const row = (line = {}) => {
      const child = line.childCode ? itemOf(ctx, line.childCode) : null;
      const hint = child?.kind === "RB" && parent.kind === "SE" ? `แนะนำ ${rules.fmtQty(rules.rbPerSe({ pcsPerRoll: child.rubber?.pcsPerRoll, sePerGr: child.rubber?.sePerGr, uom: child.uom, weightG: child.weightG }))} เส้น/ชิ้น จากข้อมูลการตัด` : child ? `หน่วย ${uomText(ctx, child.uom)}` : "";
      return `<tr class="bom-line"><td>${ui.select("childCode[]", options, { value: line.childCode ?? "", placeholder: "เลือกชิ้นงานลูก…", extra: "data-bom-child" })}</td><td>${ui.input("qty[]", { type: "number", step: "any", min: 0, value: line.qty ?? "" })}<small class="rf-hint" data-bom-hint>${esc(hint)}</small></td><td>${ui.input("scrapPct[]", { type: "number", step: "any", min: 0, value: line.scrapPct ?? 0 })}</td><td>${ui.input("lineNote[]", { value: line.note ?? "" })}</td><td><button class="btn rf-btn secondary small" type="button" data-bom-remove aria-label="ลบบรรทัด">ลบ</button></td></tr>`;
    };
    const lines = base?.lines?.length ? base.lines : [{}];
    const body = `<form id="bom-edit-form" data-rf-form="saveBomDraft" data-rf-args="${attr(JSON.stringify({ itemCode: parent.code }))}" data-rf-success="บันทึกร่าง {result}">
      <p class="muted small">${esc(base ? `ตั้งต้นจาก Rev.${base.revision} (${statusLabel(base.status)})` : "ยังไม่มี BOM เดิม")} · ปริมาณ = จำนวนลูกต่อ 1 ${esc(uomText(ctx, parent.uom))} ของ ${esc(parent.code)} · บันทึกแล้วต้องส่งอนุมัติก่อนใช้ในใบสั่งผลิต</p>
      <div class="table-wrap"><table class="rf-table"><thead><tr><th>ชิ้นงานลูก</th><th>ปริมาณต่อหน่วยพ่อ</th><th>% เผื่อเสีย</th><th>หมายเหตุ</th><th></th></tr></thead><tbody data-bom-lines>${lines.map(row).join("")}</tbody></table></div>
      <template data-bom-row>${row()}</template>
      <div class="rf-row"><button class="btn rf-btn secondary small" type="button" data-bom-add>+ เพิ่มบรรทัด</button></div>
      ${ui.field("หมายเหตุของ revision", ui.input("note", { placeholder: "เหตุผลที่แก้ เช่น เปลี่ยนความยาวตัด" }))}
    </form>`;
    const bind = (dialog) => {
      const tbody = dialog.querySelector("[data-bom-lines]");
      const template = dialog.querySelector("template[data-bom-row]");
      const wire = (tr) => {
        tr.querySelector("[data-bom-remove]")?.addEventListener("click", () => { if (tbody.querySelectorAll("tr").length > 1) tr.remove(); });
        tr.querySelector("[data-bom-child]")?.addEventListener("change", (event) => {
          const child = itemOf(ctx, event.target.value);
          const hint = tr.querySelector("[data-bom-hint]");
          const qty = tr.querySelector('input[name="qty[]"]');
          if (!child || !hint) return;
          if (child.kind === "RB" && parent.kind === "SE") {
            const suggested = rules.rbPerSe({ pcsPerRoll: child.rubber?.pcsPerRoll, sePerGr: child.rubber?.sePerGr, uom: child.uom, weightG: child.weightG });
            hint.textContent = `แนะนำ ${rules.fmtQty(suggested)} เส้น/ชิ้น จากข้อมูลการตัด`;
            if (qty && !qty.value && suggested) qty.value = String(Math.round(suggested * 1e6) / 1e6);
          } else hint.textContent = `หน่วย ${uomText(ctx, child.uom)}`;
        });
      };
      tbody?.querySelectorAll("tr").forEach(wire);
      dialog.querySelector("[data-bom-add]")?.addEventListener("click", () => {
        if (!template || !tbody) return;
        tbody.insertAdjacentHTML("beforeend", template.innerHTML);
        const tr = tbody.lastElementChild;
        if (tr) { wire(tr); tr.querySelector("select")?.focus?.(); }
      });
    };
    return { html: ui.dialog("bomEdit", `BOM ของ ${parent.code}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-edit-form">บันทึกร่าง</button>` }), bind };
  };

  // ---------- สูตรยาง ↔ RubberFlow ----------
  const rfRecipes = (ctx) => {
    try { return ctx.rubberflow()?.store.data().recipes ?? []; } catch { return []; }
  };
  pages.compounds = (ctx) => {
    const { data, ui, user } = ctx;
    const recipes = rfRecipes(ctx);
    const canLink = ctx.helpers.isBoss(user) || ["rb", "planner"].includes(user.role);
    const rows = data.compounds.filter((entry) => includes(`${entry.code} ${entry.name} ${entry.recipeId ?? ""}`, ctx.q)).sort((a, b) => a.code.localeCompare(b.code)).map((entry) => {
      const uses = data.items.filter((item) => item.kind === "RB" && item.rubber?.compound === entry.code);
      const recipe = recipes.find((row) => row.id === entry.recipeId);
      return `<tr><td>${ui.mono(entry.code)}<div class="small muted">${esc(entry.name)}</div></td><td>${entry.recipeId ? `${ui.mono(entry.recipeId)}<div class="small muted">${esc(recipe?.name ?? entry.recipeName ?? "")}</div>${recipe ? (recipe.status === "approved" ? ui.badge("good", "สูตรอนุมัติแล้ว") : ui.badge("warn", "สูตรยังไม่อนุมัติ")) : ui.badge("warn", "ไม่พบสูตรนี้ใน RubberFlow ของเบราว์เซอร์นี้")}` : ui.badge("warn", "ยังไม่ผูก")}</td><td class="right">${esc(String(uses.length))}</td><td class="nowrap">${canLink ? ui.openButton("ผูกสูตร", "compoundLink", { code: entry.code }, { className: "secondary small" }) : ""}</td></tr>`;
    });
    const html = `${head(ctx, "สูตรยาง ↔ RubberFlow", "รหัสคอมปาวด์ในรหัส RB (คอลัมน์ “สินค้า/สูตรยาง” ของชีต) ผูกกับสูตร PHR ที่อนุมัติใน RubberFlow เพื่อสร้างใบสั่งผลิตเส้นยางจากงานของแผนก RB", canLink ? ui.openButton("เพิ่มสูตรยาง", "compoundLink", {}, { className: "" }) : "")}
      ${recipes.length ? "" : ui.callout("warn", "ยังไม่พบข้อมูล RubberFlow ในเบราว์เซอร์นี้ (เปิดเมนู RubberFlow ครั้งหนึ่งเพื่อสร้างข้อมูลสาธิต) ผูกสูตรด้วยการพิมพ์รหัสสูตรได้")}
      ${ui.card(`${searchForm(ctx, "ค้นหารหัสสูตรยาง…")}${ui.table(["สูตรยาง", "สูตร PHR ใน RubberFlow", { label: "ใช้ใน RB", className: "right" }, ""], rows, { emptyText: "ไม่มีสูตรยาง" })}`, { flush: false })}`;
    return { html };
  };
  dialogs.compoundLink = (ctx, { code = "" }) => {
    const { ui, data } = ctx;
    const compound = data.compounds.find((entry) => entry.code === code);
    const recipes = rfRecipes(ctx).filter((recipe) => recipe.status === "approved");
    const recipeControl = recipes.length
      ? ui.select("recipeId", recipes.map((recipe) => ({ value: recipe.id, label: `${recipe.id} · ${recipe.name} (${recipe.productName})` })), { value: compound?.recipeId ?? "", placeholder: "ไม่ผูก" })
      : ui.input("recipeId", { value: compound?.recipeId ?? "", placeholder: "รหัสสูตรใน RubberFlow เช่น RC-EPDM-DS01" });
    const body = `<form id="bom-compound-form" data-rf-form="linkCompound" data-rf-success="บันทึกสูตรยาง {result}">
      ${ui.field("รหัสสูตรยาง *", compound ? `<input class="input rf-input" name="code" value="${attr(compound.code)}" readonly>` : ui.input("code", { required: true, placeholder: "เช่น B0006" }))}
      ${ui.field("ชื่อ/คำอธิบาย", ui.input("name", { value: compound?.name ?? "" }))}
      ${ui.field("สูตร PHR ใน RubberFlow", recipeControl, { hint: esc(recipes.length ? "แสดงเฉพาะสูตรที่อนุมัติแล้วใน RubberFlow ของเบราว์เซอร์นี้" : "RubberFlow ยังไม่มีข้อมูลในเบราว์เซอร์นี้ พิมพ์รหัสสูตรเอง") })}
    </form>`;
    const bind = (dialog) => {
      const select = dialog.querySelector('select[name="recipeId"]');
      const form = dialog.querySelector("form");
      form?.addEventListener("submit", () => {
        if (!select) return;
        const name = select.options?.[select.selectedIndex]?.textContent ?? "";
        let hidden = form.querySelector('input[name="recipeName"]');
        if (!hidden) { hidden = document.createElement("input"); hidden.type = "hidden"; hidden.name = "recipeName"; form.appendChild(hidden); }
        hidden.value = name;
      }, true);
    };
    return { html: ui.dialog("compoundLink", compound ? `ผูกสูตร ${compound.code}` : "เพิ่มสูตรยาง", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-compound-form">บันทึก</button>` }), bind };
  };

  // ---------- นำเข้าจาก Excel ----------
  pages.import = (ctx) => {
    const { ui, rules, user, store } = ctx;
    const canImport = ctx.helpers.canPlan(user);
    const size = store.size();
    const html = `${head(ctx, "นำเข้า BOM จาก Excel", "เปิดชีต DATA ของ DATA BOM.xlsx หรือไฟล์ Material_*.xlsm เลือกแถวหัวตารางพร้อมบรรทัดของสินค้าที่ต้องการ (Ctrl+C) แล้ววางที่นี่ ระบบประกอบเป็น BOM หลายชั้นและรายงานปัญหาก่อนบันทึก")}
      ${canImport ? "" : ui.callout("warn", "บทบาทนี้ดูได้อย่างเดียว การนำเข้าทำโดยฝ่ายวางแผนหรือผู้จัดการ")}
      ${ui.card(`<div class="rf-grid rf-g2">
          ${ui.field("วางข้อมูลจาก Excel (TSV) หรือ CSV", `<textarea class="textarea rf-textarea bom-paste" name="paste" rows="10" placeholder="ITEM\tน.น RB/g\tCODE\tรหัสแผนก\t… (วางทั้งแถวหัวตารางมาด้วย)" data-bom-paste></textarea>`)}
          <div>
            ${ui.field("หรือเลือกไฟล์ .tsv / .csv / .txt", `<input class="input rf-input" type="file" accept=".tsv,.csv,.txt,text/plain,text/csv,text/tab-separated-values" data-bom-file>`, { hint: "ไฟล์ .xlsx/.xlsm ต้องบันทึกชีต DATA เป็น CSV UTF-8 หรือคัดลอกมาวางก่อน (Pilot Web ไม่มีไลบรารีอ่าน Excel)" })}
            ${ui.field("กลุ่มสินค้า", ui.select("group", [{ value: "TOY", label: "ของเล่น (DATA BOM.xlsx)" }, { value: "IND", label: "ยางอุตสาหกรรม" }], { value: "TOY", extra: "data-bom-group" }))}
            ${ui.field("ชื่อแหล่งข้อมูล", ui.input("source", { value: "DATA BOM.xlsx", extra: "data-bom-source" }))}
            <div class="rf-row"><button class="btn rf-btn" type="button" data-bom-check>ตรวจสอบ</button><span class="small muted">ข้อมูลในเบราว์เซอร์ตอนนี้ ${esc(rules.fmtQty(Math.round(size / 1000)))} KB (เพดาน localStorage ราว 5,000 KB)</span></div>
          </div>
        </div>
        <div data-bom-report></div>`)}`;
    const bind = (rootNode) => {
      const paste = rootNode.querySelector("[data-bom-paste]");
      const report = rootNode.querySelector("[data-bom-report]");
      const file = rootNode.querySelector("[data-bom-file]");
      let built = null;
      file?.addEventListener("change", () => {
        const picked = file.files?.[0];
        if (!picked || typeof FileReader === "undefined") return;
        const reader = new FileReader();
        reader.onload = () => { if (paste) paste.value = String(reader.result ?? ""); };
        reader.readAsText(picked);
      });
      rootNode.querySelector("[data-bom-check]")?.addEventListener("click", () => {
        if (!paste || !report) return;
        try {
          const flat = rules.readFlatRows(paste.value);
          if (!flat.length) throw new Error("ไม่พบบรรทัดข้อมูลใต้หัวตาราง");
          const group = rootNode.querySelector("[data-bom-group]")?.value || "TOY";
          const source = String(rootNode.querySelector("[data-bom-source]")?.value || "Excel").slice(0, 80);
          const result = rules.buildFromFlat(flat, { group, subpartStart: ctx.data.items.filter((item) => item.kind === "SUBPART").length + 1 });
          built = { items: [...result.items.values()], boms: [...result.boms.entries()].map(([parentCode, lines]) => ({ parentCode, lines })), group, source };
          const r = result.report;
          const existing = built.items.filter((item) => itemOf(ctx, item.code)).length;
          const payloadSize = JSON.stringify(built).length;
          const tooBig = size + payloadSize > 4_500_000;
          const unlinked = r.compounds.filter((code) => !ctx.data.compounds.find((entry) => entry.code === code)?.recipeId);
          report.innerHTML = `${ui.callout(r.conflicts.length ? "warn" : "good", `<strong>อ่านได้ ${esc(rules.fmtQty(flat.length))} บรรทัด</strong> · สินค้า ${esc(String(r.fgCount))} · ชิ้นงาน ${esc(String(r.itemCount))} (มีอยู่แล้ว ${esc(String(existing))}) · BOM ${esc(String(r.bomCount))} พ่อ · รวมบรรทัดซ้ำ ${esc(String(r.merged))} · ชิ้นไม่มีรหัส → XP- ${esc(String(r.subparts))} · รหัสสะกดต่าง ${esc(String(r.variants))}`)}
            ${tooBig ? ui.callout("bad", `ข้อมูลชุดนี้ (${esc(rules.fmtQty(Math.round(payloadSize / 1000)))} KB) จะเกินเพดานของ localStorage นำเข้าเฉพาะสินค้าที่ต้องใช้ทดสอบ (วางทีละกลุ่ม) หรือรีเซ็ตข้อมูลก่อน`) : ""}
            ${unlinked.length ? ui.callout("warn", `สูตรยางที่ยังไม่ผูกกับ RubberFlow: ${esc(unlinked.join(", "))} (ผูกได้ภายหลังที่เมนูสูตรยาง)`) : ""}
            ${r.unknownUom.length ? ui.callout("warn", `หน่วยที่แปลงไม่ได้ (บันทึกเป็น “หน่วยอื่น”): ${esc(r.unknownUom.slice(0, 20).join(", "))}${r.unknownUom.length > 20 ? " …" : ""}`) : ""}
            ${r.conflicts.length ? `<details class="bom-details"><summary>ข้อขัดแย้ง ${esc(String(r.conflicts.length))} รายการ (ใช้ค่าชุดแรก)</summary><ul class="small">${r.conflicts.slice(0, 50).map((text) => `<li>${esc(text)}</li>`).join("")}</ul></details>` : ""}
            ${ui.table(["สินค้า (FG)", "ส่วนประกอบชั้นแรก", "ชั้นลึกสุด"], built.boms.filter((entry) => result.items.get(entry.parentCode)?.kind === "FG").slice(0, 30).map((entry) => `<tr><td>${esc(entry.parentCode)}<div class="small muted">${esc(result.items.get(entry.parentCode)?.name ?? "")}</div></td><td>${esc(String(entry.lines.length))} บรรทัด</td><td>${esc(String(Math.max(...rules.explode(entry.parentCode, 1, { itemOf: (code) => result.items.get(rules.canonicalCode(code)) ?? null, approvedBomOf: (code) => (result.boms.has(code) ? { id: code, revision: 1, lines: result.boms.get(code) } : null) }).lines.map((line) => line.level))))}</td></tr>`), { emptyText: "ไม่พบสินค้า" })}
            <div class="rf-row">${canImport && !tooBig ? `<button class="btn rf-btn" type="button" data-bom-import>นำเข้า ${esc(String(r.itemCount))} ชิ้นงาน / ${esc(String(r.bomCount))} BOM</button>` : ""}<span class="small muted">พ่อที่มี BOM อนุมัติอยู่แล้วจะไม่ถูกทับ (ข้าม) · BOM ที่นำเข้าถือว่าอนุมัติย้อนหลังตามข้อมูลเดิม</span></div>`;
          report.querySelector("[data-bom-import]")?.addEventListener("click", (event) => {
            event.currentTarget.disabled = true;
            if (ctx.runAction("importFlat", built, "นำเข้าแล้ว {result}")) location.hash = ctx.url("items", { dept: "PK" });
          });
        } catch (error) {
          report.innerHTML = ui.callout("bad", esc(error?.message ?? String(error)));
        }
      });
    };
    return { html, bind };
  };

  // ---------- ใบสั่งผลิต (PI) ----------
  const orderProgress = (ctx, order) => {
    const jobs = ctx.data.jobs.filter((job) => job.orderId === order.id);
    return jobs.length ? `${ctx.ui.progress(jobs.filter((job) => job.status === "done").length, jobs.length)}<div class="small muted">${esc(`งานเสร็จ ${jobs.filter((job) => job.status === "done").length}/${jobs.length}`)}</div>` : '<span class="muted small">ยังไม่ปล่อยผลิต</span>';
  };
  pages.orders = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const sel = String(params.get("sel") ?? "").toUpperCase();
    const canPlan = ctx.helpers.canPlan(user);
    const list = data.orders.filter((order) => includes(`${order.id} ${order.customer} ${order.country} ${order.items.map((item) => item.fgCode).join(" ")}`, ctx.q));
    const rows = list.map((order) => `<tr${order.id === sel ? ' class="is-selected"' : ""}><td>${ui.link(order.id, ctx.url("orders", { sel: order.id, q: ctx.q || null }), "rf-mono")}<div class="small muted">${esc(order.customer)}</div></td><td>${status(ctx, order.orderType)}<div class="small muted">${esc(order.country)}</div></td><td>${esc(String(order.items.length))} สินค้า<div class="small muted">${esc(order.items.map((item) => `${item.fgCode} × ${rules.fmtQty(item.qty)}`).join(", ").slice(0, 60))}</div></td><td class="nowrap">${esc(rules.fmtDate(order.whDue))}</td><td class="rf-progress-cell">${orderProgress(ctx, order)}</td><td>${status(ctx, order.status)}</td></tr>`);
    const listCard = ui.card(`${searchForm(ctx, "ค้นหาเลข PI ลูกค้า หรือรหัสสินค้า…")}${ui.table(["เลข PI", "ประเภท", "สินค้า", "ส่งมอบคลัง", "ความคืบหน้า", "สถานะ"], rows, { emptyText: "ไม่มีใบสั่งผลิต" })}`,
      { title: "ใบสั่งผลิต", actions: canPlan ? ui.openButton("เปิดใบใหม่", "orderNew", {}, { className: "" }) : "" });

    const order = sel ? data.orders.find((entry) => entry.id === sel) : null;
    let detail = "";
    if (order) {
      const tab = ["bom", "req", "jobs"].includes(params.get("tab")) ? params.get("tab") : "bom";
      const draft = order.status === "draft";
      const canCount = ctx.helpers.canCount(user) && !["completed", "cancelled"].includes(order.status);
      const headerKv = ui.kv([
        ["ลูกค้า", esc(order.customer)], ["ประเทศ / ประเภท", `${esc(order.country)} ${status(ctx, order.orderType)}`], ["วันที่สั่งผลิต", esc(rules.fmtDate(order.orderedAt))], ["ส่งมอบคลัง (WH)", esc(rules.fmtDate(order.whDue))],
        ["กำหนดเสร็จรายแผนก", rules.DUE_DEPTS.map((dept) => `<span class="bom-due"><b>${esc(dept)}</b> ${esc(order.due[dept] ? rules.fmtDate(order.due[dept]) : "—")}</span>`).join(" ")],
        order.explodedAt ? ["ระเบิด BOM ล่าสุด", esc(`${rules.fmtDateTime(order.explodedAt)} · ${order.explosion?.length ?? 0} บรรทัด${order.releasedAt ? ` · ล็อก revision เมื่อปล่อยผลิต ${rules.fmtDateTime(order.releasedAt)} โดย ${order.releasedBy}` : ""}`)] : null,
        order.stockCountedAt ? ["นับคงคลังล่าสุด", esc(`${rules.fmtDateTime(order.stockCountedAt)} โดย ${order.stockCountedBy}`)] : null,
        order.note ? ["หมายเหตุ", esc(order.note)] : null,
        order.cancelReason ? ["เหตุผลยกเลิก", esc(order.cancelReason)] : null,
      ]);
      const itemRows = order.items.map((item) => `<tr><td>${ui.link(item.fgCode, ctx.url("items", { dept: "PK", sel: item.fgCode }), "rf-mono")}<div class="small muted">${esc(itemOf(ctx, item.fgCode)?.name ?? "")}</div></td><td class="right rf-mono">${esc(rules.fmtQty(item.qty))}</td><td>${esc(item.colorSet || "-")}</td><td class="nowrap">${draft && canPlan ? ui.button("ลบ", { action: "removeOrderItem", args: { orderId: order.id, fgCode: item.fgCode }, className: "secondary small" }) : ""}</td></tr>`);
      const buttons = [];
      if (draft && canPlan) {
        buttons.push(ui.openButton("เพิ่มสินค้า", "orderItemAdd", { orderId: order.id }, { className: "secondary" }));
        buttons.push(ui.button("ระเบิด BOM", { action: "explodeOrder", args: { orderId: order.id }, className: "secondary", }));
        buttons.push(ui.button("ปล่อยผลิต", { action: "releaseOrder", args: { orderId: order.id }, className: "", confirmText: `ปล่อยผลิต ${order.id}? ระบบจะล็อก revision ของ BOM และสร้างงานรายแผนก` }));
      }
      if (["released", "in_progress"].includes(order.status) && canPlan) buttons.push(ui.button("ปิดใบ", { action: "completeOrder", args: { orderId: order.id }, className: "secondary", confirmText: "ปิดใบสั่งผลิตนี้?" }));
      if (!["completed", "cancelled"].includes(order.status) && canPlan) buttons.push(ui.button("ยกเลิกใบ", { action: "cancelOrder", args: { orderId: order.id }, className: "secondary", confirmText: "ยกเลิกใบสั่งผลิตนี้?" }));
      if (order.explosion?.length) buttons.push(`<button class="btn rf-btn secondary" type="button" data-bom-csv="bomsheet" data-bom-order="${attr(order.id)}" title="ใบคำนวณวัตถุดิบรูปแบบเดียวกับ BOMSHEET เปิดใน Excel ได้">ส่งออก CSV ใบคำนวณ</button>`, `<button class="btn rf-btn secondary" type="button" data-bom-csv="req" data-bom-order="${attr(order.id)}" title="รายการที่ต้องเบิก/สั่งซื้อรวมทุกสินค้าในใบ">ส่งออก CSV รายการเบิก</button>`);
      const tabsHtml = ui.tabs([{ id: "bom", label: "ใบคำนวณวัตถุดิบ" }, { id: "req", label: "เบิก / สั่งซื้อ / ผลิต (รวม)" }, { id: "jobs", label: "งานรายแผนก" }], tab, (id) => ctx.url("orders", { sel: order.id, tab: id }));
      let tabBody = "";
      if (!order.explosion?.length) tabBody = ui.empty(draft ? "ยังไม่ได้ระเบิด BOM — เพิ่มสินค้าแล้วกด “ระเบิด BOM”" : "ไม่มีข้อมูลการระเบิด");
      else if (tab === "bom") {
        const bomRows = order.explosion.map((line) => {
          const stock = order.stockCounts[line.itemCode];
          const make = rules.toMake(line.required, stock);
          return `<tr${line.level === 0 ? ' class="bom-fg-row"' : ""}><td>${levelCell(line.level, ui.link(line.itemCode, ctx.url("items", { dept: line.producerDept, sel: line.itemCode }), "rf-mono"))}</td><td>${esc(line.name)}${line.noBom ? ` ${ui.badge("warn", "ไม่มี BOM")}` : ""}</td><td>${deptBadge(ctx, line.producerDept)}</td><td class="right rf-mono">${line.level ? esc(rules.fmtQty(line.qtyPerFg)) : ""}</td><td class="right rf-mono">${esc(rules.fmtQty(line.required))}</td><td>${esc(uomText(ctx, line.uom))}</td><td class="right rf-mono">${line.level ? `${stock === undefined ? '<span class="muted">—</span>' : esc(rules.fmtQty(stock))}${canCount ? ` ${ui.openButton("นับ", "stockCount", { orderId: order.id, itemCode: line.itemCode }, { className: "secondary small", ariaLabel: `นับคงคลัง ${line.itemCode}` })}` : ""}` : ""}</td><td class="right rf-mono${line.level && stock !== undefined && make < 0 ? " bom-surplus" : ""}">${line.level ? esc(stock === undefined ? rules.fmtQty(line.required) : rules.fmtQty(make)) : ""}</td><td class="small muted">${line.revision ? `Rev.${line.revision}` : ""}</td></tr>`;
        });
        tabBody = ui.table(["ชั้น / รหัส", "ชื่อวัตถุดิบ", "แผนกผลิต", { label: "ใช้ : 1 FG", className: "right" }, { label: "ต้องเบิก", className: "right" }, "หน่วย", { label: "คงคลัง", className: "right" }, { label: "ต้องผลิต/สั่งซื้อ", className: "right" }, "BOM"], bomRows);
      } else if (tab === "req") {
        const reqs = rules.aggregateRequirements(order.explosion).sort((a, b) => a.dept.localeCompare(b.dept) || a.itemCode.localeCompare(b.itemCode));
        tabBody = ui.table(["แผนก", "รหัส", "ชื่อ", { label: "ต้องการรวม", className: "right" }, "หน่วย", { label: "คงคลัง", className: "right" }, { label: "ต้องผลิต/สั่งซื้อ", className: "right" }, "ใช้ในสินค้า"],
          reqs.map((entry) => { const stock = order.stockCounts[entry.itemCode]; return `<tr><td>${deptBadge(ctx, entry.dept)}</td><td>${ui.mono(entry.itemCode)}</td><td>${esc(entry.name)}</td><td class="right rf-mono">${esc(rules.fmtQty(entry.required))}</td><td>${esc(uomText(ctx, entry.uom))}</td><td class="right rf-mono">${stock === undefined ? '<span class="muted">—</span>' : esc(rules.fmtQty(stock))}</td><td class="right rf-mono">${esc(rules.fmtQty(rules.toMake(entry.required, stock)))}</td><td class="small muted">${esc(entry.fgCodes.join(", "))}</td></tr>`; }));
      } else {
        const jobs = data.jobs.filter((job) => job.orderId === order.id).sort((a, b) => a.dueAt - b.dueAt);
        tabBody = ui.table(["แผนก", "งาน", "ชิ้นงาน", { label: "แผน", className: "right" }, "ความคืบหน้า", "กำหนด", "สถานะ"], jobs.map((job) => `<tr${late(ctx, job) ? ' class="is-late"' : ""}><td>${deptBadge(ctx, job.dept)}</td><td>${ui.link(job.id, ctx.url("jobs", { dept: job.dept, q: job.id }), "rf-mono")}</td><td>${ui.mono(job.itemCode)}<div class="small muted">${esc(job.name)}</div></td><td class="right rf-mono">${esc(`${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`)}</td><td class="rf-progress-cell">${jobProgress(ctx, job)}</td><td class="nowrap">${esc(rules.fmtDate(job.dueAt))}</td><td>${status(ctx, job.status)}${job.externalRef ? `<div class="small">${ui.link(job.externalRef.woId, `#/rubberflow?p=orders&q=${encodeURIComponent(job.externalRef.woId)}`)}</div>` : ""}</td></tr>`), { emptyText: "ยังไม่มีงาน (ปล่อยผลิตก่อน)" });
      }
      detail = ui.card(`${headerKv}<h3 class="bom-h3">สินค้าที่สั่ง</h3>${ui.table(["สินค้า (FG)", { label: "จำนวน", className: "right" }, "ชุดสี", ""], itemRows, { emptyText: "ยังไม่มีสินค้า" })}${tabsHtml}${tabBody}`,
        { title: `${esc(order.id)} ${status(ctx, order.status)}`, actions: buttons.join("") });
    }
    const html = `${head(ctx, "ใบสั่งผลิต (PI)", "เปิดใบ → เพิ่มสินค้า → ระเบิด BOM (ร่างระเบิดซ้ำได้) → นับคงคลัง → ปล่อยผลิต (ล็อก revision แล้วแตกเป็นงานรายแผนก)")}
      <div class="bom-split bom-split-wide">${listCard}${detail}</div>`;
    const bind = (rootNode) => {
      rootNode.querySelectorAll("[data-bom-csv]").forEach((button) => button.addEventListener("click", () => {
        const target = data.orders.find((entry) => entry.id === button.dataset.bomOrder);
        if (!target?.explosion) return;
        const csv = button.dataset.bomCsv === "req" ? requirementsCsv(ctx, target) : bomsheetCsv(ctx, target);
        downloadCsv(`${target.id}-${button.dataset.bomCsv}.csv`, csv);
      }));
    };
    return { html, bind };
  };
  function bomsheetCsv(ctx, order) {
    const { rules } = ctx;
    const rows = [["ชื่อลูกค้า", order.customer, "เลขที่ PI", order.id, "ประเทศ", order.country, "วันที่สั่งผลิต", rules.fmtDate(order.orderedAt), "ส่งมอบคลัง", rules.fmtDate(order.whDue)],
      ["ITEM สินค้า", "จำนวนสั่ง FG", "ชั้น", "รหัส", "ชื่อวัตถุดิบในการผลิต", "แผนกผู้ผลิต", "จำนวนใช้ : 1 FG", "จำนวนที่ต้องเบิก", "หน่วย", "จำนวนที่มีในคลัง", "จำนวนที่ต้องผลิตหรือสั่งซื้อ", "BOM Rev"]];
    for (const line of order.explosion) {
      const stock = order.stockCounts[line.itemCode];
      rows.push([line.fgCode, line.fgQty, line.level, line.itemCode, line.name, line.producerDept, line.level ? line.qtyPerFg : "", line.required, rules.uomLabel(line.uom), stock ?? "", line.level ? rules.toMake(line.required, stock) : "", line.revision ?? ""]);
    }
    return rules.toCsv(rows);
  }
  function requirementsCsv(ctx, order) {
    const { rules } = ctx;
    const rows = [["เลขที่ PI", order.id, "ลูกค้า", order.customer], ["แผนกผู้ผลิต", "รหัส", "ชื่อ", "ต้องการรวม", "หน่วย", "คงคลัง", "ต้องผลิต/สั่งซื้อ", "ใช้ในสินค้า"]];
    for (const entry of rules.aggregateRequirements(order.explosion)) rows.push([entry.dept, entry.itemCode, entry.name, entry.required, rules.uomLabel(entry.uom), order.stockCounts[entry.itemCode] ?? "", rules.toMake(entry.required, order.stockCounts[entry.itemCode]), entry.fgCodes.join(" ")]);
    return rules.toCsv(rows);
  }
  function downloadCsv(name, csv) {
    if (typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function" || typeof document?.createElement !== "function") return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  dialogs.orderNew = (ctx) => {
    const { ui, rules } = ctx;
    const today = rules.toInputDate(ctx.now);
    const body = `<form id="bom-order-form" data-rf-form="createOrder" data-rf-success="เปิดใบสั่งผลิต {result}">
      <div class="rf-grid rf-g2">
        ${ui.field("เลขที่ PI *", ui.input("pi", { required: true, placeholder: "เช่น 260404-26017" }))}
        ${ui.field("ชื่อลูกค้า *", ui.input("customer", { required: true }))}
        ${ui.field("ประเทศ *", ui.input("country", { required: true, value: "Thailand" }), { hint: "Thailand = ในประเทศ (SA) อื่น = ต่างประเทศ (EX)" })}
        ${ui.field("วันที่สั่งผลิต *", ui.input("orderedAt", { type: "date", required: true, value: today }))}
        ${ui.field("วันส่งมอบคลัง (WH) *", ui.input("whDue", { type: "date", required: true }))}
      </div>
      <fieldset class="bom-fieldset"><legend>กำหนดเสร็จรายแผนก (ไม่บังคับ ว่าง = ใช้วันส่งมอบคลัง)</legend><div class="rf-grid rf-g3">${rules.DUE_DEPTS.map((dept) => ui.field(dept, ui.input(`due.${dept}`, { type: "date" }))).join("")}</div></fieldset>
      ${ui.field("หมายเหตุ", ui.input("note"))}
    </form>`;
    return { html: ui.dialog("orderNew", "เปิดใบสั่งผลิตใหม่", body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-order-form">เปิดใบ</button>` }) };
  };
  // เลือกสินค้าแบบ 3 ช่องเหมือนชีต ;}o ของไฟล์ MRP: ฐานรหัส + แพ็กเกจ + ชุดสี → รหัสเต็ม ถ้ารหัสเต็มยังไม่มีแต่ฐานรหัสมี ระบบสร้างจาก BOM ของตัวนั้น
  dialogs.orderItemAdd = (ctx, { orderId }) => {
    const { ui, data, rules } = ctx;
    const fgs = data.items.filter((item) => item.kind === "FG" && approvedBomOf(ctx, item.code));
    const parsed = fgs.map((item) => ({ item, ...rules.parseFgCode(item.code) }));
    const bases = [...new Set(parsed.map((entry) => entry.base))].sort();
    const baseOptions = bases.map((base) => ({ value: base, label: `${base} · ${parsed.find((entry) => entry.base === base).item.name.slice(0, 40)}` }));
    const pkgOptions = [...new Set([...rules.PACKAGES, ...parsed.map((entry) => entry.pkg).filter(Boolean)])].map((pkg) => ({ value: pkg, label: `(${pkg})` }));
    const colorOptions = [...new Set([...rules.COLOR_SETS, ...parsed.map((entry) => entry.colorSet).filter(Boolean)])].map((set) => ({ value: set, label: set }));
    const body = `<form id="bom-order-item-form" data-rf-form="addOrderItem" data-rf-args="${attr(JSON.stringify({ orderId }))}" data-rf-success="เพิ่มสินค้าแล้ว">
      <div class="rf-grid rf-g3">
        ${ui.field("ฐานรหัสสินค้า *", ui.select("base", baseOptions, { placeholder: "เลือกฐานรหัส…", extra: "data-bom-part" }))}
        ${ui.field("แพ็กเกจ", ui.select("pkg", pkgOptions, { placeholder: "ไม่ระบุ", extra: "data-bom-part" }))}
        ${ui.field("ชุดสี", ui.select("colorSet", colorOptions, { placeholder: "ไม่ระบุ", extra: "data-bom-part" }))}
      </div>
      <div class="rf-callout is-info" role="note" data-bom-preview><span class="rf-callout-ico" aria-hidden="true">${pages.icon("orders")}</span><div class="rf-callout-body">เลือกฐานรหัสเพื่อดูรหัสเต็ม</div></div>
      ${ui.field("จำนวนสั่ง *", ui.input("qty", { type: "number", step: "any", min: 1, required: true }))}
    </form>`;
    const bind = (dialog) => {
      const preview = dialog.querySelector("[data-bom-preview]");
      const parts = [...dialog.querySelectorAll("[data-bom-part]")];
      const paint = () => {
        const [base, pkg, colorSet] = parts.map((node) => String(node.value ?? "").trim());
        const bodyNode = preview?.querySelector?.(".rf-callout-body");
        if (!preview || !bodyNode) return;
        if (!base) { bodyNode.textContent = "เลือกฐานรหัสเพื่อดูรหัสเต็ม"; preview.className = "rf-callout is-info"; return; }
        const code = rules.buildFgCode(base, pkg, colorSet);
        const item = itemOf(ctx, code);
        if (item) {
          const bom = approvedBomOf(ctx, item.code);
          bodyNode.textContent = `${code} · ${item.name} · ${bom ? `BOM Rev.${bom.revision} ${bom.lines.length} บรรทัด` : "ยังไม่มี BOM อนุมัติ"}`;
          preview.className = `rf-callout ${bom ? "is-good" : "is-warn"}`;
          return;
        }
        const siblings = ctx.helpers.siblingsOf(ctx.data, base);
        const source = ctx.helpers.pickSibling(siblings, pkg.toUpperCase(), colorSet.toUpperCase());
        bodyNode.textContent = source ? `${code} ยังไม่มีใน item master — จะสร้างจาก BOM ของ ${source.code} (Rev.${approvedBomOf(ctx, source.code)?.revision ?? "-"}) เมื่อกดเพิ่ม` : `ไม่มีฐานรหัส ${base} ที่มี BOM อนุมัติ`;
        preview.className = `rf-callout ${source ? "is-warn" : "is-bad"}`;
      };
      parts.forEach((node) => node.addEventListener("change", paint));
      paint();
    };
    return { html: ui.dialog("orderItemAdd", `เพิ่มสินค้าใน ${orderId}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-order-item-form">เพิ่ม</button>` }), bind };
  };
  dialogs.stockCount = (ctx, { orderId, itemCode }) => {
    const { ui } = ctx;
    const order = ctx.data.orders.find((entry) => entry.id === orderId);
    const item = itemOf(ctx, itemCode);
    if (!order || !item) return null;
    const body = `<form id="bom-stock-form" data-rf-form="setStockCount" data-rf-args="${attr(JSON.stringify({ orderId, itemCode: item.code }))}" data-rf-success="บันทึกยอดคงคลัง {result}">
      <p class="muted small">${esc(item.name)}</p>
      ${ui.field(`ยอดที่นับได้ (${uomText(ctx, item.uom)}) *`, ui.input("qty", { type: "number", step: "any", min: 0, required: true, value: order.stockCounts[item.code] ?? "" }))}
    </form>`;
    return { html: ui.dialog("stockCount", `นับคงคลัง ${item.code}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-stock-form">บันทึก</button>` }) };
  };

  // ---------- งานของแผนก ----------
  pages.jobs = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const dept = [...rules.DEPTS, "ALL"].includes(params.get("dept")) ? params.get("dept") : (ctx.helpers.isBoss(user) ? "ALL" : myDept(ctx));
    const show = ["open", "done", "all"].includes(params.get("st")) ? params.get("st") : "open";
    const jobs = data.jobs.filter((job) => (dept === "ALL" || job.dept === dept) && (show === "all" || (show === "done" ? job.status === "done" : job.status !== "done")) && includes(`${job.id} ${job.orderId} ${job.itemCode} ${job.name}`, ctx.q)).sort((a, b) => (a.status === "done") - (b.status === "done") || a.dueAt - b.dueAt);
    const tabs = ui.tabs([...rules.DEPTS, "ALL"].map((code) => ({ id: code, label: code === "ALL" ? "ทุกแผนก" : `${code} (${data.jobs.filter((job) => job.dept === code && job.status !== "done").length})` })), dept, (id) => ctx.url("jobs", { dept: id, st: show }));
    const filters = `<nav class="rf-tabs bom-subtabs">${[["open", "ค้างอยู่"], ["done", "เสร็จแล้ว"], ["all", "ทั้งหมด"]].map(([id, label]) => `<a class="rf-tab${id === show ? " is-active" : ""}" href="${attr(ctx.url("jobs", { dept, st: id }))}">${esc(label)}</a>`).join("")}</nav>`;
    const rows = jobs.map((job) => {
      const order = data.orders.find((entry) => entry.id === job.orderId);
      const item = itemOf(ctx, job.itemCode);
      const canWork = ctx.helpers.canWorkJob(user, job) && ["released", "in_progress"].includes(order?.status);
      const buttons = [];
      if (canWork && job.status !== "done") buttons.push(ui.openButton("รายงานผล", "jobReport", { jobId: job.id }, { className: "small" }));
      if (canWork && job.status !== "done") buttons.push(job.status === "hold" ? ui.button("คืนคิว", { action: "setJobStatus", args: { jobId: job.id, status: "queued" }, className: "secondary small" }) : ui.button("พักงาน", { action: "setJobStatus", args: { jobId: job.id, status: "hold" }, className: "secondary small" }));
      if (job.dept === "RB" && job.status !== "done" && (canWork || user.role === "planner") && !job.externalRef) buttons.push(ui.openButton("สร้าง WO ใน RubberFlow", "jobRubberflow", { jobId: job.id }, { className: "secondary small" }));
      return `<tr${late(ctx, job) ? ' class="is-late"' : ""}><td>${ui.mono(job.id)}<div class="small muted">${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId, tab: "jobs" }))} · ${esc(order?.customer ?? "")}</div></td>${dept === "ALL" ? `<td>${deptBadge(ctx, job.dept)}</td>` : ""}<td>${ui.link(job.itemCode, ctx.url("items", { dept: job.dept, sel: job.itemCode }), "rf-mono")}<div class="small muted">${esc(job.name)}${item?.rubber?.compound ? ` · สูตร ${esc(item.rubber.compound)}` : ""}</div></td><td class="right rf-mono">${esc(`${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`)}</td><td class="rf-progress-cell">${jobProgress(ctx, job)}</td><td class="nowrap">${esc(rules.fmtDate(job.dueAt))}${late(ctx, job) ? `<div class="small">${ui.badge("bad", "เลยกำหนด")}</div>` : ""}</td><td>${status(ctx, job.status)}${job.externalRef ? `<div class="small">${ui.link(`WO ${job.externalRef.woId}`, `#/rubberflow?p=orders&q=${encodeURIComponent(job.externalRef.woId)}`)}${job.externalRef.kg ? `<span class="muted"> · ${esc(rules.fmtQty(job.externalRef.kg, 2))} kg</span>` : ""}</div>` : ""}</td><td class="nowrap">${buttons.join(" ")}</td></tr>`;
    });
    const headCells = ["งาน / ใบ PI", ...(dept === "ALL" ? ["แผนก"] : []), "ชิ้นงาน", { label: "แผน", className: "right" }, "ความคืบหน้า", "กำหนด", "สถานะ", ""];
    const html = `${head(ctx, "งานของแผนก", "งานเกิดจากการปล่อยใบสั่งผลิต: หนึ่งงานต่อ แผนก × ชิ้นงาน รวมทุกสินค้าในใบ · งาน RB ส่งต่อเป็นใบสั่งผลิต (WO) ใน RubberFlow ได้")}${tabs}${filters}
      ${ui.card(`${searchForm(ctx, "ค้นหาเลขงาน เลข PI หรือรหัสชิ้นงาน…")}${ui.table(headCells, rows, { emptyText: show === "open" ? "ไม่มีงานค้าง" : "ไม่มีงาน" })}`)}`;
    return { html };
  };
  dialogs.jobReport = (ctx, { jobId }) => {
    const { ui, rules } = ctx;
    const job = ctx.data.jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    const remaining = Math.max(0, job.qtyPlanned - job.qtyDone);
    const body = `<form id="bom-job-form" data-rf-form="reportJob" data-rf-args="${attr(JSON.stringify({ jobId }))}" data-rf-success="บันทึกผลผลิต {result}">
      <p class="muted small">${esc(`${job.itemCode} · ${job.name} · แผน ${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)} · ทำแล้ว ${rules.fmtQty(job.qtyDone)} · เหลือ ${rules.fmtQty(remaining)}`)}</p>
      <div class="rf-grid rf-g2">${ui.field(`จำนวนดี (${uomText(ctx, job.uom)})`, ui.input("qtyDone", { type: "number", step: "any", min: 0, value: remaining ? String(Math.round(remaining * 1e4) / 1e4) : "" }))}${ui.field("จำนวนเสีย", ui.input("qtyReject", { type: "number", step: "any", min: 0, value: "0" }))}</div>
      ${ui.field("หมายเหตุ", ui.input("note", { placeholder: "เช่น รอบรีดที่ 2" }))}
    </form>`;
    return { html: ui.dialog("jobReport", `รายงานผล ${job.id}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-job-form">บันทึก</button>` }) };
  };
  // งาน RB → WO ใน RubberFlow: สูตร = คอมปาวด์ที่ผูกไว้ · กิโลกรัมคอมปาวด์จากน้ำหนักต่อเส้น · targetQty ในหน่วยของสูตร (kg × ผลผลิตต่อ kg)
  dialogs.jobRubberflow = (ctx, { jobId }) => {
    const { ui, rules, data } = ctx;
    const job = data.jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    const item = itemOf(ctx, job.itemCode);
    const order = data.orders.find((entry) => entry.id === job.orderId);
    const compound = data.compounds.find((entry) => entry.code === item?.rubber?.compound);
    const rf = ctx.rubberflow();
    const recipe = compound?.recipeId ? rfRecipes(ctx).find((row) => row.id === compound.recipeId) : null;
    const kg = ctx.helpers.rbJobKg(job, item, { scrapPct: 5 });
    const targetQty = recipe ? Math.max(1, Math.ceil(kg * Number(recipe.yieldPerKg || 1))) : 0;
    const problems = [];
    if (job.externalRef?.woId) problems.push(`งานนี้สร้าง WO ${job.externalRef.woId} ไว้แล้ว`);
    if (!["released", "in_progress"].includes(order?.status)) problems.push("ใบสั่งผลิตไม่อยู่ในสถานะผลิต");
    if (!rf) problems.push("RubberFlow ยังไม่โหลดในเบราว์เซอร์นี้");
    if (!item?.rubber?.compound) problems.push("เส้นยางนี้ไม่มีรหัสสูตรยาง");
    else if (!compound?.recipeId) problems.push(`สูตรยาง ${item.rubber.compound} ยังไม่ผูกกับสูตร PHR ของ RubberFlow (เมนู “สูตรยาง ↔ RubberFlow”)`);
    else if (!recipe) problems.push(`ไม่พบสูตร ${compound.recipeId} ใน RubberFlow ของเบราว์เซอร์นี้ (เปิด RubberFlow หรือรีเซ็ตข้อมูลสาธิตของ RubberFlow)`);
    else if (recipe.status !== "approved") problems.push(`สูตร ${recipe.id} ยังไม่ได้รับอนุมัติใน RubberFlow`);
    if (!kg) problems.push("คำนวณกิโลกรัมไม่ได้: เส้นยางไม่มี กก./เส้น หรือน้ำหนักต่อชิ้น");
    const body = `${ui.kv([
      ["งาน", esc(`${job.id} · ${job.orderId} · ${order?.customer ?? ""}`)], ["เส้นยาง", esc(`${job.itemCode} · ${item?.name ?? ""}`)],
      ["ต้องผลิตอีก", esc(`${rules.fmtQty(Math.max(0, job.qtyPlanned - job.qtyDone))} ${uomText(ctx, job.uom)}`)],
      ["สูตรยาง → สูตร PHR", esc(`${item?.rubber?.compound ?? "-"} → ${compound?.recipeId ?? "ยังไม่ผูก"}${recipe ? ` (${recipe.name}, ${recipe.batchKg} kg/batch)` : ""}`)],
      ["คอมปาวด์ที่ต้องใช้ (เผื่อ 5%)", esc(`${rules.fmtQty(kg, 2)} kg${recipe ? ` ≈ ${Math.ceil(kg / Number(recipe.batchKg || 1))} batch` : ""}`)],
      recipe ? ["จำนวนเป้าหมายใน WO", esc(`${rules.fmtQty(targetQty)} ${recipe.uom} (RubberFlow นับผลผลิตในหน่วยของสูตร)`)] : null,
      ["กำหนดส่ง", esc(rules.fmtDate(job.dueAt))],
    ])}${problems.length ? ui.callout("warn", problems.map((text) => `<div>${esc(text)}</div>`).join("")) : ui.callout("info", "สร้างแล้วเลข WO จะถูกบันทึกที่งานนี้ และใบสั่งผลิตใน RubberFlow ระบุเลข PI เป็น PO ลูกค้า")}`;
    const bind = (dialog) => {
      dialog.querySelector("[data-bom-rf-create]")?.addEventListener("click", (event) => {
        event.currentTarget.disabled = true;
        const result = rf.store.run("createOrder", {
          recipeId: recipe.id, customer: order?.customer ?? job.orderId, customerPo: job.orderId, targetQty, color: item.rubber?.color || "ดำ",
          startDate: new Date(ctx.now).setHours(0, 0, 0, 0), dueDate: Math.max(job.dueAt, new Date(ctx.now).setHours(0, 0, 0, 0)), priority: late(ctx, job) ? "urgent" : "normal",
          note: `จาก BOM งาน ${job.id} · PI ${job.orderId} · ${job.itemCode} ${rules.fmtQty(job.qtyPlanned - job.qtyDone)} ${uomText(ctx, job.uom)} ≈ ${rules.fmtQty(kg, 2)} kg`,
        });
        const button = event.currentTarget;
        if (!result.ok) { showToast(friendlyError(result.error), "error"); button.disabled = false; return; }
        // WO ถูกสร้างแล้ว: ถ้าบันทึกเลขที่งานไม่ได้ ให้ผู้ใช้เห็นเลข WO เพื่อไม่สร้างซ้ำ
        if (ctx.runAction("linkJobToRubberFlow", { jobId: job.id, woId: result.result, kg }, `สร้าง WO ${result.result} ใน RubberFlow แล้ว`)) { dialog.close?.(); renderRoute(); return; }
        showToast(`สร้าง WO ${result.result} ใน RubberFlow แล้ว แต่บันทึกเลขที่งานไม่ได้ อย่ากดสร้างซ้ำ`, "error");
        dialog.close?.();
        renderRoute();
      });
    };
    return { html: ui.dialog("jobRubberflow", `สร้างใบสั่งผลิตใน RubberFlow จาก ${job.id}`, body, { footer: `${ui.closeButton("ปิด")}${problems.length ? "" : '<button class="btn rf-btn" type="button" data-bom-rf-create>สร้าง WO</button>'}` }), bind };
  };

  // ---------- บันทึกการใช้งาน ----------
  pages.audit = (ctx) => {
    const { data, ui, rules } = ctx;
    const rows = data.audit.filter((entry) => includes(`${entry.user} ${entry.action} ${entry.detail}`, ctx.q)).slice(0, 300)
      .map((entry) => `<tr><td class="nowrap small">${esc(rules.fmtDateTime(entry.at))}</td><td>${esc(entry.user)}</td><td>${esc(entry.action)}</td><td class="rf-mono small">${esc(entry.detail)}</td></tr>`);
    const html = `${head(ctx, "บันทึกการใช้งาน", "ทุกการแก้ item master, BOM, การอนุมัติ, ใบสั่งผลิต และงานรายแผนก พร้อมผู้ทำและเวลา", searchForm(ctx, "ค้นหาผู้ใช้ การกระทำ หรือรหัส…"))}
      ${ui.card(ui.table(["เวลา", "ผู้ใช้", "การกระทำ", "รายละเอียด"], rows, { emptyText: "ไม่พบรายการ" }), { flush: true })}`;
    return { html };
  };
})(typeof window !== "undefined" ? window : globalThis);
