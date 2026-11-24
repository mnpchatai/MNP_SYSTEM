// หน้าของโมดูลตรวจคุณภาพ (QA) #/qa — โหลดก่อน modules/module-qa.js (ดู index.html) · ที่เดียวที่ QA ตัดสินล็อตที่กัก บันทึกผลตรวจ เปิด/ปิด NCR พิมพ์ CoA ดู SPC สืบย้อนกลับ และปลดกักกันวัตถุดิบ (โรงงานขั้น 5 · ไม่มีสำเนาที่สองใน RubberFlow / BOM / ST)
// ข้อมูลมาจากสองทาง: ยางเส้นยาวที่ SR กักตอนรับเข้า (store ของ BOM: rodLots · การ์ดตัดสินชุดเดียวกับ BOM) และล็อตในสายผลิต ผลตรวจ NCR ล็อตวัตถุดิบ (store ของ RubberFlow: lots qcRecords ncrs materialLots)
// หน้า: งานของฉัน (ค่าตั้งต้น) · ผลตรวจ ?tab=records · NCR ?tab=ncr · CoA ?tab=coa (&lot=<ล็อตตกแต่ง>) · SPC ?tab=spc (&ch=) · สืบย้อนกลับ ?tab=trace (&q=) · วัตถุดิบที่กัก ?tab=material
// ส่วนวาดของ RubberFlow (ตารางผลตรวจ การ์ด NCR ตาราง CoA SPC สืบย้อนกลับ และ dialog qcRecord / ncr / coa) มาจาก window.MNP_RUBBERFLOW_VIEWS.quality / MNP_RUBBERFLOW_DIALOGS (modules/rubberflow-pages-quality.js ที่เดียว) · ปุ่มของ RubberFlow อยู่ใน [data-rf-scope] ที่ตัวผูกของ RubberFlow ผูกเอง
// สิทธิ์: การซ่อน/แสดงปุ่มเป็นแค่ UX ฐานข้อมูลตัดสินจริง · ปล่อยล็อตที่กัก (ผลตรวจผ่าน/ไม่ผ่านของล็อตที่กัก) ตัดสินยางเส้นยาวที่กัก และปลดกักกันวัตถุดิบ = หัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบเท่านั้น (rules.canQaRelease · RF_QA_HEAD_ONLY / BOM_QA_HEAD_ONLY)
// พนักงาน QA บันทึกผลตรวจของล็อตที่ไม่ได้กัก บันทึก "กักต่อ / ตรวจซ้ำ" ของล็อตที่กัก กักกันวัตถุดิบ และเปิด/ปิด NCR ได้ · ข้ามเวลาบ่ม (endRest) ยังอยู่ที่สถานีของ RubberFlow ตามเดิม
(function registerQaPages(root) {
  const F = root.MNP_FACTORY;
  const ROUTE = "qa";
  const esc = (value) => root.escapeHtml(value);
  const num = (value) => Number(value) || 0;
  const qaUrl = (query = {}) => F.routeUrl(ROUTE, query);
  const rfRules = () => root.MNP_RUBBERFLOW_RULES ?? null;
  const rfViews = () => root.MNP_RUBBERFLOW_VIEWS?.quality ?? null;
  const hub = () => root.MNP_BOM_PAGES?.hub ?? null;
  const rfScope = (html) => (html ? `<div data-rf-scope="rubberflow">${html}</div>` : "");
  const dash = '<span class="muted">—</span>';
  const readOnlyNote = '<p class="small muted">ดูอย่างเดียว บัญชีนี้ไม่มีสิทธิ์ดำเนินการ</p>';
  const headOnlyText = () => rfRules()?.QA_RELEASE_TEXT ?? "เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ";
  // การ์ดของแต่ละแหล่งแสดงสูงสุดเท่านี้ใบ ที่เหลือบอก "อีก N รายการ" และขยายด้วย ?all=1 (เห็นงานทั้งหมดโดยไม่ต้องเลื่อนยาว)
  const CARD_LIMIT = 6;

  // ---------- ข้อมูลของ RubberFlow (ยังไม่โหลด: สั่งโหลดและวาดหน้าใหม่เมื่อเสร็จ) ----------
  // ctx ของ RubberFlow ที่ได้ใช้ pageUrl ของหน้านี้ (ช่องเลือกค่า SPC ช่องค้นหาสืบย้อนกลับ และลิงก์ในหน้า ไปที่ #/qa ไม่ใช่ #/rubberflow) · ผู้ใช้ = บัญชีที่ล็อกอินจริง (ไม่ใช่ persona ของแผนก)
  function rfState(ctx) {
    const rf = ctx.rubberflow?.() ?? null;
    const store = rf?.store ?? null;
    if (!store) return { status: "none", data: null, ctx: null };
    if (F.failed(store)) return { status: "failed", data: null, ctx: null };
    if (F.wake(store)) return { status: "loading", data: null, ctx: null };
    let rfCtx = null;
    try { rfCtx = rf.context(ctx.params ?? new URLSearchParams()); } catch { rfCtx = null; }
    return rfCtx ? { status: "ready", data: rfCtx.data, ctx: { ...rfCtx, pageUrl: ctx.pageUrl } } : { status: "none", data: null, ctx: null };
  }
  const rfNote = (ctx, rf, title = "งานของ QA จาก RubberFlow") => (rf.status === "loading" ? '<p class="small muted" role="status">กำลังโหลดข้อมูลจาก RubberFlow…</p>' : rf.status === "failed" ? F.rubberflowFailed(ctx, title) : "");
  const rfCan = (rf, permission) => rf.status === "ready" && Boolean(rf.ctx?.can?.(permission));

  // ---------- ลิงก์ไปโมดูลอื่นของระบบ (ที่เดียวต่อโมดูล ไม่สำเนาหน้าของเขา) ----------
  const moduleLink = (ctx, code, href, text) => {
    const entry = root.MNP_REQUEST_MODULES?.[code];
    let allowed = false;
    try { allowed = Boolean(entry) && entry.enabled !== false && (typeof entry.navAllowed !== "function" || Boolean(entry.navAllowed(typeof state !== "undefined" ? state.employee : null))); } catch { allowed = false; }
    return allowed ? ctx.ui.link(text, href, "btn rf-btn secondary small") : "";
  };

  // ---------- รายการงาน ----------
  const byNewest = (a, b) => num(b.createdAt) - num(a.createdAt) || String(a.id ?? a.lotNo).localeCompare(String(b.id ?? b.lotNo));
  const heldLots = (data) => (data.lots ?? []).filter((lot) => lot.qc === "hold").sort(byNewest);
  const heldMaterials = (data) => (data.materialLots ?? []).filter((lot) => lot.status === "hold").sort((a, b) => num(a.expiry) - num(b.expiry) || String(a.lotNo).localeCompare(String(b.lotNo)));
  const openNcrs = (data) => (data.ncrs ?? []).filter((ncr) => ncr.status === "open").sort(byNewest);
  const materialName = (data, code) => (data.materials ?? []).find((row) => row.code === code)?.name ?? "";
  const lotKgText = (ctx, R, lot, store) => `${store} ${ctx.rules.fmtQty(R.lotKg(lot, store))} kg`;

  const cardLines = (list, render, noun) => hub()?.cardLines?.(list, render, noun) ?? `<ul class="bom-job-parts">${list.map(render).join("")}</ul>`;
  const card = ({ tone = "is-now", state: label, when = "", title, href = null, sub = "", lines = "", actions = "" }) => `<article class="card rf-card bom-job ${tone}${F.cardClass(href)}"><div class="bom-job-top"><span class="bom-job-state">${esc(label)}</span>${when ? `<span class="muted">${esc(when)}</span>` : ""}</div>
      <h2>${F.cardTitle(title, href)}</h2>${sub ? `<p class="small muted">${sub}</p>` : ""}${lines}${actions}</article>`;

  // ล็อตในสายผลิตที่กัก (รวมล็อตตกแต่งที่ RB เลือก "กักรอ QC" และล็อตที่ไปทางคลังสินค้าสำเร็จรูป WH) · หัวหน้า QA = "ตัดสิน" (ผ่าน/ไม่ผ่าน/กักต่อ) · พนักงาน QA = "ตรวจซ้ำ (กักต่อ)" เท่านั้น
  function lotCard(ctx, rf, lot) {
    const { ui, rules } = ctx;
    const R = rfRules();
    const boxes = (rf.data.fgBoxes ?? []).filter((box) => box.lotId === lot.id);
    const sub = [R.STAGE_LABEL?.[lot.stage] ?? lot.stage, lot.orderId, `${R.fmtNum(lot.goodQty, 2)} ${R.unitText?.(lot.uom) ?? lot.uom ?? ""}`, boxes.length ? `${boxes.length} กล่อง${boxes.some((box) => box.receivedAt) ? " · WH รับเข้าแล้ว" : ""}` : ""].filter(Boolean).join(" · ");
    const reasons = (lot.holdReasons ?? []).filter(Boolean);
    const head = rfCan(rf, "qaRelease");
    const action = !rfCan(rf, "qcDecision") ? readOnlyNote
      : `${ui.openButton(head ? "ตัดสิน" : "ตรวจซ้ำ (กักต่อ)", "qcRecord", { lotId: lot.id }, { className: "bom-job-main", ariaLabel: `${head ? "ตัดสิน" : "ตรวจซ้ำ"}ล็อต ${lot.id}` })}${head ? "" : `<p class="small muted">${esc(`ปล่อยหรือตัดสินผ่าน/ไม่ผ่านได้${headOnlyText()}`)}</p>`}`;
    return card({ tone: "is-hold", state: "กักรอตัดสิน", when: `กักเมื่อ ${rules.fmtDate(lot.createdAt)}`, title: `ตัดสินล็อต ${lot.id}`, sub: esc(sub), lines: reasons.length ? cardLines(reasons, (reason) => `<li><span>${esc(reason)}</span></li>`, "สาเหตุ") : "", actions: action });
  }
  // ล็อตวัตถุดิบที่กัก (ปลดกักกัน = หัวหน้า QA ขึ้นไป · ยอดจ่ายไม่ได้ทั้งคลัง ST และคลัง RB จนกว่าจะปลด)
  const releaseButton = (ui, lot, className = "bom-job-main") => ui.button("ปลดกักกัน", { action: "setMaterialLotStatus", args: { lotNo: lot.lotNo, status: "available" }, className, confirmText: `ปลดกักกันล็อต ${lot.lotNo}? ล็อตจะจ่ายได้ตามปกติอีกครั้ง`, success: "ปลดกักกันล็อต {result} แล้ว", ariaLabel: `ปลดกักกันล็อต ${lot.lotNo}` }).replace("<button ", '<button data-rf-right="qaRelease" ');
  function materialCard(ctx, rf, lot) {
    const { ui, rules } = ctx;
    const R = rfRules();
    const name = materialName(rf.data, lot.materialCode);
    const action = rfCan(rf, "qaRelease") ? releaseButton(ui, lot)
      : rfCan(rf, "holdMaterial") ? `<p class="small muted">${esc(`ปลดกักกันได้${headOnlyText()}`)}</p>` : readOnlyNote;
    return card({ tone: "is-hold", state: "วัตถุดิบถูกกัก", when: `หมดอายุ ${rules.fmtDate(lot.expiry)}`, title: `ปลดกักกันล็อต ${lot.lotNo}`, sub: `<span class="rf-mono">${esc(lot.materialCode)}</span>${name ? ` ${esc(name)}` : ""} · ${esc(`${lotKgText(ctx, R, lot, "ST")} · ${lotKgText(ctx, R, lot, "RB")}`)}`, actions: action });
  }
  // NCR ที่ยังเปิดอยู่ (ของ RubberFlow ไม่ใช่ใบคำร้อง NCR/CAR) · RB กรอกการแก้ไข/ป้องกันที่หน้า "NCR ที่ RB ต้องตอบ" · ปิดเคสที่แท็บ NCR
  function ncrCard(ctx, rf, ncr) {
    const R = rfRules();
    const answered = Boolean(String(ncr.corrective ?? "").trim()) && Boolean(String(ncr.preventive ?? "").trim());
    return card({ tone: ncr.severity === "critical" ? "is-hold" : "is-now", state: "NCR เปิดอยู่", when: `เปิดเมื่อ ${ctx.rules.fmtDate(ncr.createdAt)}`, title: `${ncr.id} ${ncr.title}`, href: qaUrl({ tab: "ncr" }), sub: esc([`ล็อต ${ncr.lotId}`, R.STAGE_LABEL?.[ncr.stage] ?? ncr.stage, answered ? "RB ตอบครบแล้ว รอปิดเคส" : "รอ RB ตอบ"].filter(Boolean).join(" · ")) });
  }

  // งานของฉัน: ยางเส้นยาวที่กัก (การ์ดของ BOM) + ล็อตในสายผลิต + วัตถุดิบที่กัก + NCR ที่เปิดอยู่ · count = จำนวนการ์ดทั้งหมด (ตัวเลขที่เมนู)
  function workData(ctx, rf) {
    const rod = F.deptWork(ctx, { title: "ยางเส้นยาวที่กักรอตัดสิน", quietWhenEmpty: true });
    const ready = rf.status === "ready" && Boolean(rfRules());
    const lots = ready ? heldLots(rf.data).map((lot) => lotCard(ctx, rf, lot)) : [];
    const materials = ready ? heldMaterials(rf.data).map((lot) => materialCard(ctx, rf, lot)) : [];
    const ncrs = ready ? openNcrs(rf.data).map((ncr) => ncrCard(ctx, rf, ncr)) : [];
    return { rod, lots, materials, ncrs, count: rod.count + lots.length + materials.length + ncrs.length };
  }
  function workCount(ctx) {
    try { return workData(ctx, rfState(ctx)).count; } catch { return 0; }
  }
  function section(ctx, title, cards) {
    if (!cards.length) return "";
    const all = ctx.params.get("all") === "1";
    const shown = all ? cards : cards.slice(0, CARD_LIMIT);
    const more = cards.length > shown.length ? `<p class="small muted">${esc(`อีก ${cards.length - shown.length} รายการ`)} ${ctx.ui.link("แสดงทั้งหมด", ctx.pageUrl({ all: 1 }), "btn rf-btn secondary small")}</p>` : "";
    return rfScope(`<h2 class="bom-h3">${esc(title)}</h2><div class="bom-job-grid">${shown.join("")}</div>${more}`);
  }
  function workView(ctx, rf) {
    const work = workData(ctx, rf);
    const parts = [work.rod.html, section(ctx, "ล็อตในสายผลิตที่กักรอตัดสิน", work.lots), section(ctx, "วัตถุดิบที่กักรอปลดกักกัน", work.materials), section(ctx, "NCR ที่ยังเปิดอยู่", work.ncrs), rfNote(ctx, rf)].filter(Boolean);
    return work.count || rf.status !== "ready" ? parts.join("") : ctx.ui.card(ctx.ui.empty("ไม่มีงานค้าง"));
  }
  // ลิงก์ไปโมดูลใบตรวจ QC (#/qc) และใบ NCR/CAR (#/ncr): โมดูลของตัวเอง ไม่ใช่ NCR ของ RubberFlow ที่อยู่ในแท็บ NCR
  const workLinks = (ctx) => `${moduleLink(ctx, "QC", "#/qc", "ใบตรวจ QC")}${moduleLink(ctx, "NCR_CAR", "#/ncr", "NCR/CAR (ใบคำร้อง)")}`;

  // ---------- ผลตรวจ ----------
  function recordsView(ctx, rf) {
    const { ui, q } = ctx;
    if (rf.status !== "ready") return rfNote(ctx, rf) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"));
    const list = (rf.data.qcRecords ?? []).filter((record) => F.includesText(`${record.id} ${record.lotId} ${record.inspector ?? ""} ${record.note ?? ""}`, q));
    const { shown, more } = F.limited(ctx, list);
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหาเลขที่ ล็อต หรือผู้ตรวจ")}${q ? ui.link("ล้างตัวกรอง", ctx.pageUrl({ q: null }), "btn rf-btn secondary small") : ""}</div>`;
    return `${toolbar}${ui.card(`${rfViews().qcRecordsTable(rf.ctx, { records: shown })}${more}`, { flush: true })}`;
  }
  // ---------- NCR ----------
  const ncrView = (ctx, rf) => (rf.status !== "ready" ? rfNote(ctx, rf) || ctx.ui.card(ctx.ui.empty("ไม่มีข้อมูล RubberFlow")) : rfScope(rfViews().ncrList(rf.ctx, { canClose: rfCan(rf, "qcDecision") })));
  // ---------- CoA ----------
  function coaView(ctx, rf) {
    const { ui, q } = ctx;
    if (rf.status !== "ready") return rfNote(ctx, rf) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"));
    const lotId = String(ctx.params.get("lot") ?? "").trim();
    const toolbar = lotId
      ? `<div class="rf-row sr-toolbar">${ui.link("ดูทุกล็อต", ctx.pageUrl({ lot: null }), "btn rf-btn secondary small")}</div>`
      : `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหาล็อต ใบสั่งผลิต หรือลูกค้า")}${q ? ui.link("ล้างตัวกรอง", ctx.pageUrl({ q: null }), "btn rf-btn secondary small") : ""}</div>`;
    return `${toolbar}${rfScope(ui.card(rfViews().coaTable(rf.ctx, { lotId, q }), { flush: true }))}`;
  }
  // ---------- SPC / สืบย้อนกลับ ----------
  const spcOf = (ctx, rf) => (rf.status === "ready" ? rfViews().spc(rf.ctx) : null);
  const traceView = (ctx, rf) => (rf.status !== "ready" ? rfNote(ctx, rf) || ctx.ui.card(ctx.ui.empty("ไม่มีข้อมูล RubberFlow")) : rfViews().trace(rf.ctx).html);

  // ---------- วัตถุดิบที่กัก ----------
  // ที่กักอยู่ (ปลดกักกัน = หัวหน้า QA ขึ้นไป) และค้นหาล็อตที่ใช้ได้เพื่อกักกัน (QA ST ฝ่ายวางแผน) · ไม่ค้นหา = ไม่แสดงรายการยาวๆ ของล็อตที่ใช้ได้
  function materialView(ctx, rf) {
    const { ui, rules, q } = ctx;
    if (rf.status !== "ready" || !rfRules()) return rfNote(ctx, rf) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"));
    const R = rfRules();
    const { data } = rf;
    const holdable = rfCan(rf, "holdMaterial");
    const release = rfCan(rf, "qaRelease");
    const kgOf = (lot) => R.lotKg(lot, "ST") + R.lotKg(lot, "RB");
    const row = (lot, action) => `<tr><td>${ui.mono(lot.lotNo)}</td><td>${ui.mono(lot.materialCode)}<div class="small muted">${esc(materialName(data, lot.materialCode))}</div></td><td class="nowrap small">${lot.expiry ? esc(rules.fmtDate(lot.expiry)) : dash}</td><td class="right rf-mono">${esc(rules.fmtQty(kgOf(lot)))}</td><td class="right">${action}</td></tr>`;
    const head = ["ล็อต", "วัตถุดิบ", "หมดอายุ", { label: "คงเหลือ (kg)", className: "right" }, ""];
    const held = heldMaterials(data);
    const heldRows = held.map((lot) => row(lot, release ? releaseButton(ui, lot, "secondary small") : holdable ? `<span class="small muted">${esc(headOnlyText())}</span>` : ""));
    const heldCard = ui.card(ui.table(head, heldRows, { emptyText: "ไม่มีล็อตวัตถุดิบที่กัก" }), { title: esc("ล็อตที่กักอยู่"), flush: true });
    const found = q ? (data.materialLots ?? []).filter((lot) => lot.status !== "hold" && kgOf(lot) > 0.0001 && F.includesText(`${lot.lotNo} ${lot.materialCode} ${materialName(data, lot.materialCode)}`, q)).sort((a, b) => num(a.expiry) - num(b.expiry)) : [];
    const holdButton = (lot) => ui.button("กักกัน", { action: "setMaterialLotStatus", args: { lotNo: lot.lotNo, status: "hold" }, className: "secondary small", confirmText: `กักกันล็อต ${lot.lotNo}? ล็อตที่กักกันจ่ายไม่ได้ทั้งคลัง ST และคลัง RB จนกว่าหัวหน้า QA จะปลดกักกัน`, success: "กักกันล็อต {result} แล้ว", ariaLabel: `กักกันล็อต ${lot.lotNo}` });
    const shownFound = found.slice(0, 20);
    const searchCard = ui.card(`<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหาล็อตหรือวัตถุดิบที่จะกักกัน")}${q ? ui.link("ล้างคำค้น", ctx.pageUrl({ q: null }), "btn rf-btn secondary small") : ""}</div>${q ? ui.table(head, shownFound.map((lot) => row(lot, holdable ? holdButton(lot) : "")), { emptyText: "ไม่พบล็อตที่ใช้ได้ตามคำค้น" }) : ""}${found.length > shownFound.length ? `<p class="small muted">${esc(`แสดง 20 จาก ${found.length} ล็อต ค้นให้แคบลง`)}</p>` : ""}`, { title: esc("กักกันล็อตวัตถุดิบ") });
    return rfScope(`${heldCard}${searchCard}`);
  }

  // ---------- หน้าแรกของโมดูล ----------
  // ผูกส่วนของ RubberFlow ใน [data-rf-scope] ด้วยตัวผูกของ RubberFlow (ctx ของ RubberFlow ที่ pageUrl ชี้ #/qa: dialog คำสั่ง และการซ่อนปุ่มตามสิทธิ์ชุดเดียวกับหน้า RubberFlow)
  function bindPage(extra = null) {
    return (node, pageCtx) => {
      extra?.(node, pageCtx);
      const slots = [...node.querySelectorAll("[data-rf-scope]")];
      if (!slots.length || typeof root.MNP_RUBBERFLOW_BIND !== "function") return;
      const rfCtx = rfState(pageCtx).ctx;
      if (rfCtx) slots.forEach((slot) => root.MNP_RUBBERFLOW_BIND(slot, rfCtx));
    };
  }
  function landing(ctx) {
    const { ui } = ctx;
    const rf = rfState(ctx);
    const id = ctx.view?.id ?? "work";
    const head = (extra = "") => F.viewHead(ctx, extra);
    const done = (html, bind = null) => ({ html, bind: bindPage(bind), actions: true });
    if (id === "records") return done(`${head(rfCan(rf, "qcDecision") ? rfScope(ui.openButton("บันทึกผลตรวจ", "qcRecord", {}, { className: "" })) : "")}${recordsView(ctx, rf)}`);
    if (id === "ncr") return done(`${head(rfCan(rf, "qcDecision") ? rfScope(ui.openButton("เปิด NCR", "ncr", {}, { className: "" })) : "")}${ncrView(ctx, rf)}`);
    if (id === "coa") return done(`${head()}${coaView(ctx, rf)}`);
    if (id === "spc") {
      const spc = spcOf(ctx, rf);
      return done(`${head(spc?.picker ?? "")}${spc ? spc.html : rfNote(ctx, rf) || ui.card(ui.empty("ไม่มีข้อมูล RubberFlow"))}`, (node) => spc?.bind?.(node));
    }
    if (id === "trace") return done(`${head()}${traceView(ctx, rf)}`);
    if (id === "material") return done(`${head()}${materialView(ctx, rf)}`);
    return done(`${head(workLinks(ctx))}${workView(ctx, rf)}`);
  }

  const MENU = Object.freeze([
    F.workItem(workCount),
    { id: "records", label: "ผลตรวจ", icon: "clipboard", params: { tab: "records" } },
    { id: "ncr", label: "NCR", icon: "flag", params: { tab: "ncr" } },
    { id: "coa", label: "CoA", icon: "stamp", params: { tab: "coa" } },
    { id: "spc", label: "SPC", icon: "chart", params: { tab: "spc" } },
    { id: "trace", label: "สืบย้อนกลับ", icon: "search", params: { tab: "trace" } },
    { id: "material", label: "วัตถุดิบที่กัก", icon: "flask", params: { tab: "material" } },
  ]);

  root.MNP_QA_PAGES = Object.freeze({ landing, MENU, workCount, workData, KEEP: Object.freeze(["lot", "ch"]) });
})(window);
