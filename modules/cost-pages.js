// หน้าของโมดูลต้นทุนการผลิต #/cost (โหมดทดสอบ · เมนูกลุ่ม "โรงงาน") — โหลดก่อน modules/module-cost.js (ดู index.html) · กฎอยู่ที่ modules/cost-rules.js ข้อมูลที่ modules/cost-data.js
// หน้า: ต้นทุนสูตร (ค่าตั้งต้น · ทุกสูตร revision ที่ใช้งาน ต้นทุนต่อชุดผสม / ต่อ kg) · ?recipe=<รหัสสูตร> (&rev=<revision> &asof=<YYYY-MM-DD> &tab=lots) รายละเอียด: แยกตามขั้น รายการเรียงตามต้นทุน เคมีที่ยังไม่มีราคา และเทียบกับจริงรายล็อตผสม
//       · ?tab=lots สูตรเทียบจริง (ล็อตผสมล่าสุดทุกสูตร) · ?q= ค้นหา · ?n= แสดงเพิ่ม
//       · ?tab=items ต้นทุนต่อชิ้น (เฟส 3: ค่าแรงแผนก GR / PT / BG / PK + ของซื้อในบรรทัด BOM ของชิ้นนั้น) · ?item=<รหัส> (&asof=) รายละเอียดของชิ้น · ยังไม่รวมชิ้นที่ผลิตเองข้างใต้และคอมปาวด์ยาง
// ค่าแรง (เฟส 2): ทุกสูตรมีค่าแรงต่อชุดผสมคู่กับต้นทุนวัตถุดิบ และยอดรวม · หน้าสูตรมีแท็บ "ค่าแรง" (แยกตามขั้นและสถานี) · อัตราค่าแรงแก้ที่ปุ่ม "อัตราค่าแรง" เวลามาตรฐานแก้ที่ปุ่ม "เวลามาตรฐาน" หรือที่หน้าสูตรยางของ RubberFlow (modules/cost-labour-ui.js)
// เห็นเฉพาะผู้ที่เห็นต้นทุน (canSeeCost: ผู้จัดการทั่วไป · ผู้จัดการโรงงาน · admin · แผนก PP) ในโหมดทดสอบ · ราคาต้นทุนทั้งหมดมาจาก app_rf_cost_data (RF_FORBIDDEN = แสดงว่าไม่มีสิทธิ์) ไม่เก็บลงเครื่อง
// อ่านอย่างเดียว: ราคาตั้งในรายการ "ในคลัง" ของ ST (#/st?tab=stock&price=missing ·แผนก ST และ admin) · ซ่อนเมนู/หน้าเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูล
// app / state / shell / bindShell / renderRoute / renderNotFound / currentRoute เป็น global ของ app.js (อ้างตอนวาดเท่านั้น)
(function registerCostPages(root) {
  const F = root.MNP_FACTORY;
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const ROUTE = "cost";
  const LABEL = "ต้นทุนการผลิต";
  const ICON = "chart";
  const costRules = () => root.MNP_COST_RULES;
  const costData = () => root.MNP_COST_DATA;
  const dash = '<span class="muted">—</span>';
  const costUrl = (query = {}) => F.routeUrl(ROUTE, query);
  const KEYS = Object.freeze(["recipe", "rev", "asof", "tab", "q", "item"]);

  // เมนูข้าง: ต้นทุนสูตร (หน้าสูตรอยู่ใต้รายการนี้) · สูตรเทียบจริง · ต้นทุนต่อชิ้น (เฟส 3 · หน้าชิ้น ?item= อยู่ใต้รายการนี้)
  const VIEWS = Object.freeze([
    { id: "recipes", label: "ต้นทุนสูตร", icon: "flask", params: {} },
    { id: "lots", label: "สูตรเทียบจริง", icon: "scale", params: { tab: "lots" } },
    { id: "items", label: "ต้นทุนต่อชิ้น", icon: "box", params: { tab: "items" } },
  ]);
  const viewOf = (params) => (params.get("recipe") ? VIEWS[0] : params.get("item") || params.get("tab") === "items" ? VIEWS[2] : params.get("tab") === "lots" ? VIEWS[1] : VIEWS[0]);
  const iconHtml = (name) => root.MNP_UI_ICONS?.icon?.(name) ?? "";
  function subnav(active) {
    if (active !== ROUTE) return "";
    let params = new URLSearchParams();
    try { params = currentRoute().params ?? params; } catch { /* ไม่มี route */ }
    const current = viewOf(params);
    const items = VIEWS.map((item) => `<li><a class="rf-nav-item${item.id === current.id ? " is-active" : ""}" href="${attr(costUrl(item.params))}"${item.id === current.id ? ' aria-current="page"' : ""}><span class="rf-nav-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">${iconHtml(item.icon)}</span></span><span class="rf-nav-text">${esc(item.label)}</span></a></li>`).join("");
    return `<div class="nav-sub rf-nav" data-module="cost"><ul class="rf-nav-list">${items}</ul></div>`;
  }

  // ctx ของหน้า: ui · q · params · now · view · factory (หัวหน้า: ไอคอน) · pageUrl (ลิงก์ในหน้าพาตัวกรองที่เปิดอยู่ไปด้วย) — ใช้ตัวผูกกลางของโรงงาน (ค้นหา / ลิงก์) ชุดเดียวกับหน้าแผนก
  function pageCtx(params) {
    const kept = Object.fromEntries(KEYS.map((key) => [key, params.get(key) || null]));
    const view = viewOf(params);
    return { ui: root.MNP_RUBBERFLOW_UI, q: (params.get("q") ?? "").trim().slice(0, 100), params, now: Date.now(), view, factory: { icon: ICON, palette: "cost" }, pageUrl: (extra = {}) => costUrl({ ...kept, ...extra }) };
  }

  // ---------- ส่วนประกอบ ----------
  const rowLink = (ui, text, href) => ui.link(text, href, "rf-mono row-link-main");
  const approx = (partial, text, title = "ยังไม่รวมเคมีที่ไม่มีราคา") => (partial ? `<span title="${attr(title)}">≥ ${esc(text)}</span>` : esc(text));
  // ค่าแรง: ข้อมูลที่โหลดแล้ว (ยังไม่พร้อม = ว่าง: ช่องค่าแรงเป็นขีด ไม่มีป้าย "ยังไม่มีค่าแรง" เพราะยังไม่รู้) · เหตุที่คิดค่าแรงไม่ได้ · ยอดรวมวัตถุดิบ + ค่าแรง (ขาดส่วนใด = ยอดบางส่วน)
  const NO_LABOUR = Object.freeze({ status: "idle", rates: [], standards: [], canSeeRates: false, canWriteRates: false, canWriteStandards: false });
  const labourData = () => { const labour = costData().labour(); return labour.status === "ready" ? labour : { ...NO_LABOUR, status: labour.status }; };
  const LABOUR_REASON = Object.freeze({ noProduct: "สูตรยังไม่มีรหัสสินค้า (เวลามาตรฐานผูกกับรหัสสินค้า)", noStandard: "สินค้านี้ยังไม่มีเวลามาตรฐานที่มีผล", noRate: "ยังไม่มีอัตราค่าแรงของแผนก RB ที่มีผล" });
  const PARTIAL_TOTAL = "ยอดบางส่วน: ยังไม่รวมเคมีที่ไม่มีราคา หรือค่าแรงที่ยังคิดไม่ได้";
  const labourBadge = (ui, labour, pay) => (labour.complete || pay.status !== "ready" ? "" : `<span title="${attr(LABOUR_REASON[labour.reason] ?? "")}">${ui.badge("warn", "ยังไม่มีค่าแรง")}</span>`);
  // โหลดค่าแรงไม่สำเร็จ: บรรทัดเดียวเหนือตาราง พร้อมปุ่มลองอีกครั้ง (โหลดใหม่ทันที ไม่รอให้ข้อมูลเก่า) แทนป้ายในทุกแถว
  const labourRetryLine = (pay) => (pay.status === "error"
    ? `<p class="small muted" role="status">${esc("โหลดข้อมูลค่าแรงไม่สำเร็จ")} <button class="btn rf-btn secondary small" type="button" data-cost-retry="labour">ลองอีกครั้ง</button></p>` : "");
  const totalOf = (cost, labour) => { const total = cost.cost + (labour.cost ?? 0); return { total, perKg: cost.batchKg > 0 ? total / cost.batchKg : null, partial: !cost.complete || !labour.complete }; };
  const nameOf = (data) => { const map = new Map((data.materials ?? []).map((material) => [material.code, material.name ?? ""])); return (code) => map.get(code) ?? ""; };
  const missingBadge = (ui, missing) => (missing.length ? `<span title="${attr(missing.join(", "))}">${ui.badge("warn", `ขาดราคา ${missing.length}`)}</span>` : "");
  const backLink = (href, text) => `<a class="request-back-link" href="${attr(href)}">${esc(text)}</a>`;

  // ---------- ต้นทุนสูตร (รายการ) ----------
  function recipesView(ctx, data) {
    const C = costRules();
    const { ui, q } = ctx;
    const pay = labourData();
    const today = C.bangkokDay(ctx.now);
    const ids = [...new Set(data.recipes.map((recipe) => recipe.id))].sort((a, b) => String(a).localeCompare(String(b)));
    const list = ids.map((id) => C.currentRevision(data.recipes, id)).filter((recipe) => recipe && F.includesText(`${recipe.id} ${recipe.productCode ?? ""}`, q))
      .map((recipe) => { const cost = C.formulaCost(recipe, data.prices, today); return { recipe, cost, labour: C.labourCost(recipe, pay.standards, pay.rates, today, cost.batchKg) }; });
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map(({ recipe, cost, labour }) => {
      const sum = totalOf(cost, labour);
      const href = costUrl({ recipe: recipe.id });
      const sub = [recipe.productCode ? `${recipe.productCode}` : "", `rev ${recipe.revision}`].filter(Boolean).join(" · ");
      const state = recipe.status === "approved" ? "" : ` ${ui.status(recipe.status)}`;
      return `<tr class="row-link"><td>${rowLink(ui, recipe.id, href)}${state}<div class="small muted">${esc(sub)}</div></td><td class="right rf-mono">${esc(C.fmtWeight(cost.batchKg))}</td><td class="right rf-mono">${approx(!cost.complete, C.fmtBaht(cost.cost))}</td><td class="right rf-mono">${labour.cost === null ? dash : esc(C.fmtBaht(labour.cost))}</td><td class="right rf-mono">${approx(sum.partial, C.fmtBaht(sum.total), PARTIAL_TOTAL)}</td><td class="right rf-mono">${sum.perKg === null ? dash : approx(sum.partial, C.fmtBaht(sum.perKg), PARTIAL_TOTAL)}</td><td>${missingBadge(ui, cost.missing)} ${labourBadge(ui, labour, pay)}</td></tr>`;
    });
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัสสูตรหรือรหัสสินค้า")}${q ? ui.link("ล้างคำค้น", ctx.pageUrl({ q: null, n: null }), "btn rf-btn secondary small") : ""}${pay.canSeeRates ? ui.openButton("อัตราค่าแรง", "labourRates", {}, { className: "secondary small", title: "อัตราค่าแรง บาท/ชม. ต่อแผนก" }) : ""}</div>`;
    const empty = q ? "ไม่พบสูตรที่ค้นหา" : "ยังไม่มีสูตรในทะเบียน RubberFlow";
    const head = ["สูตร", { label: "น้ำหนักต่อชุดผสม", className: "right" }, { label: "วัตถุดิบ (บาท)", className: "right", title: "ต้นทุนวัตถุดิบต่อชุดผสม" }, { label: "ค่าแรง (บาท)", className: "right", title: "ค่าแรงต่อชุดผสม ตามเวลามาตรฐานของสินค้าและอัตราค่าแรงของแผนก RB" }, { label: "รวมต่อชุดผสม (บาท)", className: "right" }, { label: "รวม/kg (บาท)", className: "right" }, ""];
    return `${F.pageHead(ctx, LABEL)}${toolbar}${labourRetryLine(pay)}${ui.card(`${ui.table(head, rows, { emptyText: empty })}${more}`, { flush: true })}`;
  }

  // ---------- เทียบกับจริง (ตารางล็อตผสม) ----------
  // ผลต่าง = จริง − สูตร: บวก (แพงกว่าสูตร) สีเตือน · ลบ (ถูกกว่า) สีดี · ราคาไม่ครบ = ตัวเลขเป็นยอดบางส่วน (ป้ายเตือน)
  function lotsTable(ctx, data, lots, { showRecipe = false, emptyText }) {
    const C = costRules();
    const { ui } = ctx;
    const { shown, more } = F.limited(ctx, lots);
    const rows = shown.map((lot) => {
      const recipe = C.recipeOfLot(data.recipes, lot);
      const result = C.lotCost(lot, recipe, data.prices);
      const weighed = result.actualKg > 0;
      const sub = [lot.orderId ? `WO ${lot.orderId}` : "", showRecipe && lot.recipeId ? `${lot.recipeId}${lot.recipeRevision !== undefined && lot.recipeRevision !== null ? ` rev ${lot.recipeRevision}` : ""}` : ""].filter(Boolean).join(" · ");
      const partial = !result.complete;
      const diff = result.diff !== null && weighed
        ? `<span class="cost-diff${result.diff > 0.005 ? " is-up" : result.diff < -0.005 ? " is-down" : ""}${partial ? " is-partial" : ""}">${esc(`${result.diff > 0 ? "+" : ""}${C.fmtBaht(result.diff)}`)}</span>${result.diffPct === null ? "" : `<div class="small muted">${esc(`${result.diffPct > 0 ? "+" : ""}${C.fmtBaht(result.diffPct, 1)}%`)}</div>`}`
        : dash;
      const flag = partial ? `<div>${missingBadge(ui, result.missing)}</div>` : "";
      return `<tr><td><span class="rf-mono">${esc(lot.lotNo)}</span><div class="small muted">${esc(sub)}</div></td><td class="nowrap small">${esc(C.fmtDay(lot.createdAt))}</td><td class="right rf-mono">${esc(String(lot.batches ?? ""))}</td><td class="right rf-mono">${result.formula === null ? dash : esc(C.fmtBaht(result.formula))}</td><td class="right rf-mono">${weighed ? approx(partial, C.fmtBaht(result.actual)) : '<span class="muted" title="ยังไม่มียอดที่ชั่งจริง">—</span>'}${flag}</td><td class="right rf-mono">${diff}</td></tr>`;
    });
    const head = ["ล็อตผสม", "วันที่", { label: "ชุดผสม", className: "right" }, { label: "ต้นทุนสูตร (บาท)", className: "right" }, { label: "ต้นทุนจริง (บาท)", className: "right" }, { label: "ผลต่าง (บาท)", className: "right", title: "ต้นทุนจริง − ต้นทุนสูตร · บวก = แพงกว่าสูตร" }];
    return ui.card(`${ui.table(head, rows, { emptyText })}${more}`, { flush: true });
  }
  function lotsView(ctx, data) {
    const { ui, q } = ctx;
    const lots = data.lots.filter((lot) => F.includesText(`${lot.lotNo} ${lot.orderId ?? ""} ${lot.recipeId ?? ""}`, q)).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหาล็อต ใบสั่งผลิต หรือรหัสสูตร")}${q ? ui.link("ล้างคำค้น", ctx.pageUrl({ q: null, n: null }), "btn rf-btn secondary small") : ""}</div>`;
    return `${F.pageHead(ctx, ctx.view.label)}${toolbar}${lotsTable(ctx, data, lots, { showRecipe: true, emptyText: q ? "ไม่พบล็อตที่ค้นหา" : "ยังไม่มีล็อตผสม" })}`;
  }

  // ---------- รายละเอียดสูตร ----------
  // ลิงก์ไปรายการที่ยังไม่มีราคาในหน้า "ในคลัง" ของ ST (ราคาอยู่ในรายการคลัง ไม่มีเมนูแยก): เฉพาะผู้ที่เปิดโมดูล ST ได้ (ไม่พาไปหน้า "ไม่พบ") · เปิดไม่ได้ = ข้อความบอกว่าตั้งราคาที่ไหน ไม่มีลิงก์
  function priceLink(ctx) {
    const C = costRules();
    const employee = state.employee;
    if (!C.canSeePrices(employee)) return "";
    if (!F.canOpenDeptModule(employee, "ST", "FACTORY_ST")) return '<p class="small muted">ราคาตั้งที่รายการ "ในคลัง" ของโมดูลคลังวัตถุดิบ (ST)</p>';
    return `<p>${ctx.ui.link(C.canEditPrices(employee) ? "ไปตั้งราคาที่ในคลัง (ST)" : "ดูรายการที่ยังไม่มีราคาที่ในคลัง (ST)", "#/st?tab=stock&price=missing", "btn rf-btn secondary small")}</p>`;
  }
  // ค่าแรงของสูตร: ตารางเดียวแยกตามขั้น (นาทีต่อชุดผสม × จำนวนคน × อัตราของแผนก RB) มีแถวรวมของสถานีผสม (4 ส่วน) ต่อจากขั้นผสม
  // แถว "รวม" มีแค่นาทีและชั่วโมงคน: ค่าแรงรวมอยู่ที่ตัวเลข "ค่าแรงต่อชุดผสม" ด้านบนแล้ว (ไม่ซ้ำ) · คิดไม่ได้ = บอกเหตุและปุ่มไปตั้งค่า
  function labourView(ctx, pay, labour) {
    const C = costRules();
    const { ui } = ctx;
    if (pay.status === "error") return ui.card(ui.empty("โหลดข้อมูลค่าแรงไม่สำเร็จ", '<div class="rf-row"><button class="btn rf-btn secondary" type="button" data-cost-retry="labour">ลองอีกครั้ง</button></div>'));
    if (pay.status !== "ready") return ui.card(ui.empty(pay.status === "forbidden" ? "บัญชีนี้ไม่มีสิทธิ์ดูค่าแรง" : "กำลังโหลดข้อมูลค่าแรง…"));
    const standardButton = labour.productCode && (pay.canWriteStandards || labour.standard) ? ui.openButton(pay.canWriteStandards ? "เวลามาตรฐาน" : "ประวัติเวลามาตรฐาน", "stationStandard", { productCode: labour.productCode }, { className: "secondary small" }) : "";
    const rateButton = pay.canSeeRates ? ui.openButton("อัตราค่าแรง", "labourRates", {}, { className: "secondary small" }) : "";
    const warn = labour.complete ? "" : ui.callout("warn", `<strong>${esc("ยังคิดค่าแรงไม่ได้")}</strong> ${esc(LABOUR_REASON[labour.reason] ?? "")}${labour.reason === "noProduct" ? `<p class="small muted">${esc('กรอกรหัสสินค้าที่ "ค่ามาตรฐานการผสม" ของร่างสูตรในหน้าสูตรยาง (RubberFlow)')}</p>` : ""}`);
    if (!labour.standard) return `${warn}${ui.card(ui.empty("ยังไม่มีเวลามาตรฐานให้แสดง", `<div class="rf-row">${standardButton}${rateButton}</div>`))}`;
    const money = (value) => (value === null ? dash : esc(C.fmtBaht(value)));
    const stepRow = (step) => `<tr><td>${esc(step.label)}</td><td class="right rf-mono">${esc(C.fmtMinutes(step.minutes))}</td><td class="right rf-mono">${esc(C.fmtMinutes(step.workers))}</td><td class="right rf-mono">${esc(C.fmtBaht(step.manHours))}</td><td class="right rf-mono">${money(step.cost)}</td></tr>`;
    // แถวรวมสถานีผสม: ไม่แสดงเมื่อขั้นนอกสถานีผสมเป็น 0 ทุกขั้น (ตัวเลขเท่าแถว "รวม" ทุกช่อง ไม่บอกอะไรเพิ่ม)
    const mixing = labour.steps.some((step) => step.station !== "mixing" && step.minutes > 0) ? labour.stations.find((station) => station.station === "mixing") : null;
    const mixingRow = mixing ? `<tr class="cost-sum"><td title="${attr("ขั้นเตรียมวัตถุดิบ + ขั้น 1–3")}">${esc(`รวมสถานี${mixing.label}`)}</td><td class="right rf-mono">${esc(C.fmtMinutes(mixing.minutes))}</td><td></td><td class="right rf-mono">${esc(C.fmtBaht(mixing.manHours))}</td><td class="right rf-mono">${money(mixing.cost)}</td></tr>` : "";
    const lastMix = labour.steps.reduce((at, step, index) => (step.station === "mixing" ? index : at), -1);
    const rows = labour.steps.flatMap((step, index) => (index === lastMix ? [stepRow(step), mixingRow] : [stepRow(step)])).filter(Boolean);
    rows.push(`<tr class="cost-sum"><td><strong>รวม</strong></td><td class="right rf-mono">${esc(C.fmtMinutes(labour.minutes))}</td><td></td><td class="right rf-mono">${esc(C.fmtBaht(labour.manHours))}</td><td></td></tr>`);
    const head = ["ขั้น", { label: "นาที / ชุดผสม", className: "right" }, { label: "จำนวนคน", className: "right" }, { label: "ชั่วโมงคน", className: "right", title: "นาที ÷ 60 × จำนวนคน" }, { label: "ค่าแรง (บาท)", className: "right" }];
    const rateText = labour.ratePerHour === null ? "" : `<span class="small muted">${esc(`อัตรา RB ${C.fmtBaht(labour.ratePerHour)} บาท/ชม.`)}</span>`;
    const steps = ui.card(`${ui.table(head, rows)}<p class="small muted cost-note">${esc(`เวลามาตรฐานของสินค้า ${labour.productCode} มีผลตั้งแต่ ${C.fmtDay(labour.standard.effectiveFrom)}`)}</p>`, { title: esc("ค่าแรงแยกตามขั้น"), actions: `${rateText}${standardButton}${rateButton}`, flush: true });
    return `${warn}${steps}`;
  }
  function detailView(ctx, data, recipeId) {
    const C = costRules();
    const { ui, params } = ctx;
    const back = backLink(costUrl(), "‹ ต้นทุนสูตร");
    const revisions = C.revisionsOf(data.recipes, recipeId);
    if (!revisions.length) return `${back}${F.pageHead(ctx, LABEL)}${ui.card(ui.empty("ไม่พบสูตรนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)"))}`;
    const today = C.bangkokDay(ctx.now);
    const recipe = revisions.find((entry) => String(entry.revision) === params.get("rev")) ?? C.currentRevision(data.recipes, recipeId);
    const asof = C.dayKey(params.get("asof")) || today;
    const cost = C.formulaCost(recipe, data.prices, asof);
    const pay = labourData();
    const labour = C.labourCost(recipe, pay.standards, pay.rates, asof, cost.batchKg);
    const sum = totalOf(cost, labour);
    const nameFor = nameOf(data);
    const partial = !cost.complete;
    const money = (value, part) => `${part ? "≥ " : ""}${C.fmtBaht(value)} บาท`;
    const stats = `<div class="rf-grid rf-g4">${ui.stat({ label: "วัตถุดิบต่อชุดผสม", value: money(cost.cost, partial), tone: partial ? "warn" : "" })}${ui.stat({ label: "ค่าแรงต่อชุดผสม", value: labour.cost === null ? "-" : money(labour.cost, false), tone: labour.complete ? "" : "warn" })}${ui.stat({ label: "รวมต่อชุดผสม", value: money(sum.total, sum.partial), sub: `ชุดผสมละ ${C.fmtWeight(cost.batchKg)}`, tone: sum.partial ? "warn" : "" })}${ui.stat({ label: "รวมต่อ kg", value: sum.perKg === null ? "-" : money(sum.perKg, sum.partial), tone: sum.partial ? "warn" : "" })}</div>`;
    const revisionPick = revisions.length > 1
      ? `<div class="field rf-field sr-filter"><label class="sr-only" for="cost-rev">ฉบับของสูตร</label>${ui.select("rev", revisions.map((entry) => ({ value: String(entry.revision), label: `rev ${entry.revision} · ${ui.statusLabel(entry.status)}` })), { value: String(recipe.revision), id: "cost-rev", extra: `data-cost-filter title="ฉบับของสูตร"` })}</div>` : "";
    const datePick = ui.field("ราคา ณ วันที่", ui.input("asof", { type: "date", value: asof, id: "cost-asof", extra: 'data-cost-filter title="ใช้ราคาที่มีผลในวันนี้"' }), { id: "cost-asof", className: "sr-filter" });
    const toolbar = `<div class="rf-row sr-toolbar">${revisionPick}${datePick}</div>`;
    const missing = partial
      ? ui.callout("warn", `<strong>${esc(`ยังไม่มีราคา ${cost.missing.length} รายการ`)}</strong> ${esc("ต้นทุนข้างบนเป็นยอดบางส่วน ยังไม่รวมรายการเหล่านี้")}<ul class="cost-missing">${cost.missing.map((code) => `<li>${ui.badge("warn", nameFor(code) ? `${code} · ${nameFor(code)}` : code)}</li>`).join("")}</ul>${priceLink(ctx)}`)
      : "";
    const tab = ["lots", "labour"].includes(params.get("tab")) ? params.get("tab") : "cost";
    const lotCount = data.lots.filter((lot) => lot.recipeId === recipeId).length;
    const tabs = ui.tabs([{ id: "cost", label: "วัตถุดิบแยกตามขั้น" }, { id: "labour", label: "ค่าแรง" }, { id: "lots", label: `เทียบกับจริง${lotCount ? ` (${lotCount})` : ""}` }], tab, (id) => ctx.pageUrl({ tab: id === "cost" ? null : id, n: null }));
    let body;
    if (tab === "lots") {
      const lots = data.lots.filter((lot) => lot.recipeId === recipeId).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      body = lotsTable(ctx, data, lots, { emptyText: "ยังไม่มีล็อตผสมของสูตรนี้" });
    } else if (tab === "labour") {
      body = labourView(ctx, pay, labour);
    } else {
      // ค่าแรงโหลดไม่สำเร็จ: บรรทัดเดียวพร้อมลองอีกครั้งเหนือตารางวัตถุดิบ (ช่อง "ค่าแรงต่อชุดผสม" ข้างบนเป็นขีด) · แท็บค่าแรงมีปุ่มของตัวเอง
      body = labourRetryLine(pay);
      const head = ["วัตถุดิบ", { label: "น้ำหนักต่อชุดผสม", className: "right" }, { label: "ราคา (บาท/kg)", className: "right" }, { label: "ต้นทุน (บาท)", className: "right" }, { label: "สัดส่วน", className: "right" }];
      body += cost.parts.map((part) => {
        const rows = part.lines.map((line) => {
          const name = nameFor(line.materialCode);
          const used = line.kg > 0;
          const price = line.pricePerKg === null ? (used ? ui.badge("warn", "ยังไม่มีราคา") : dash) : `<span class="rf-mono">${esc(C.fmtPrice(line.pricePerKg))}</span>`;
          const share = line.share === null ? dash : `<div class="cost-share"><span class="rf-mono">${esc(`${C.fmtBaht(line.share * 100, 1)}%`)}</span>${ui.progress(line.share * 100, 100)}</div>`;
          return `<tr><td>${ui.mono(line.materialCode)}${name ? `<div class="small muted">${esc(name)}</div>` : ""}</td><td class="right rf-mono">${used ? esc(C.fmtWeight(line.kg, line.unit)) : '<span class="muted" title="มีในสูตรแต่ไม่ได้ใช้">0</span>'}</td><td class="right">${price}</td><td class="right rf-mono">${used ? (line.cost === null ? dash : esc(C.fmtBaht(line.cost))) : '<span class="muted">0.00</span>'}</td><td class="right">${share}</td></tr>`;
        });
        const sums = `<span class="rf-mono">${esc(C.fmtWeight(part.kg))}</span><span class="rf-mono">${esc(`${C.fmtBaht(part.cost)} บาท`)}</span>`;
        return ui.card(ui.table(head, rows), { title: esc(part.label), actions: sums, flush: true });
      }).join("") || ui.card(ui.empty("สูตรนี้ไม่มีรายการวัตถุดิบ"));
    }
    const title = recipe.productCode ? `${recipe.id} · ${recipe.productCode}` : String(recipe.id);
    return `${back}${F.pageHead(ctx, title)}${toolbar}${stats}${missing}${tabs}${body}`;
  }

  // ---------- ต้นทุนต่อชิ้น (เฟส 3) ----------
  // ข้อมูล BOM มาจาก store ของ BOM ที่หน้าอื่นใช้ (window.MNP_BOM.store · ผู้เห็นต้นทุนอ่าน BOM ได้) · ราคาของซื้อ = แถว kind part ของ app_rf_cost_data · อัตรา = ตัวโหลดค่าแรง
  // ชิ้นที่แสดง = ชิ้นงานที่ใช้อยู่ที่ผลิตเอง (C.hasItemCost: ไม่ใช่ของซื้อ สูตรยาง และเส้นยาง RB ซึ่งคิดค่าแรงต่อชุดผสมที่ต้นทุนสูตร)
  const bomStore = () => root.MNP_BOM?.store ?? null;
  const bomRules = () => root.MNP_BOM_RULES;
  // ชุดข้อมูลของชิ้นงานที่ itemCost ใช้ (ตั้งค่าเป้าของ GR / PT / BG / PK · BOM ที่อนุมัติ · ชิ้นงานตามรหัส)
  function itemInputs(bom) {
    const R = bomRules();
    const byCode = new Map((bom.items ?? []).map((item) => [item.code, item]));
    const approved = new Map((bom.boms ?? []).filter((entry) => entry.status === "approved").map((entry) => [entry.itemCode, entry]));
    const configs = (R?.STEP_DEPTS ?? ["GR", "PT", "BG", "PK"]).map((dept) => R?.grConfig?.(bom, dept) ?? { dept, steps: [], targets: [] });
    return { byCode, approved, configs, itemOf: (code) => byCode.get(code) ?? null };
  }
  const costOfItem = (item, inputs, data, pay, date) => costRules().itemCost(item, { bom: inputs.approved.get(item.code) ?? null, itemOf: inputs.itemOf, configs: inputs.configs, prices: data.prices, rates: pay.rates, date });
  const perPiece = (value) => esc(costRules().fmtPrice(value));
  const ITEM_PARTIAL = "ยอดบางส่วน: ยังไม่รวมค่าแรงที่ยังคิดไม่ได้หรือของซื้อที่ยังไม่มีราคา";
  const deptName = (dept) => bomRules()?.DEPT_LABEL?.[dept] ?? dept;
  // ป้ายเตือนของชิ้น (รายละเอียดใน title): ขาดราคา n · ยังไม่มีเป้า · ยังไม่มีอัตราค่าแรง
  function itemBadges(ui, cost) {
    const reasonsOf = (kind) => cost.labour.reasons.filter((row) => row.reason === kind).map((row) => row.dept);
    const noTarget = reasonsOf("noTarget");
    const noRate = reasonsOf("noRate");
    return [
      missingBadge(ui, cost.materials.missing),
      noTarget.length ? `<span title="${attr(`แผนก ${noTarget.join(", ")} ยังไม่ได้ตั้งเป้าชิ้น/ชม. ของชิ้นนี้`)}">${ui.badge("warn", "ยังไม่มีเป้า")}</span>` : "",
      noRate.length ? `<span title="${attr(`ยังไม่มีอัตราค่าแรงที่มีผลของแผนก ${noRate.join(", ")}`)}">${ui.badge("warn", "ยังไม่มีอัตราค่าแรง")}</span>` : "",
    ].filter(Boolean).join(" ");
  }
  function itemsView(ctx, data, bom, pay) {
    const C = costRules();
    const { ui, q } = ctx;
    const today = C.bangkokDay(ctx.now);
    const inputs = itemInputs(bom);
    const list = (bom.items ?? []).filter((item) => item.active !== false && C.hasItemCost(item) && F.includesText(`${item.code} ${item.name ?? ""}`, q))
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    // คิดต้นทุนเฉพาะแถวที่แสดง (ทะเบียนจริงมีหลายพันรหัส)
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map((item) => {
      const cost = costOfItem(item, inputs, data, pay, today);
      const labour = cost.labour.steps.length ? approx(!cost.labour.complete, C.fmtPrice(cost.labour.cost), ITEM_PARTIAL) : dash;
      const sub = [item.name ?? "", item.ownerDept ? deptName(item.ownerDept) : ""].filter(Boolean).join(" · ");
      return `<tr class="row-link"><td>${rowLink(ui, item.code, costUrl({ item: item.code }))}<div class="small muted">${esc(sub)}</div></td><td class="right rf-mono">${labour}</td><td class="right rf-mono">${approx(!cost.materials.complete, C.fmtPrice(cost.materials.cost), "ยังไม่รวมของซื้อที่ยังไม่มีราคา")}</td><td class="right rf-mono">${approx(cost.partial, C.fmtPrice(cost.own), ITEM_PARTIAL)}</td><td>${itemBadges(ui, cost)}</td></tr>`;
    });
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัสหรือชื่อชิ้นงาน")}${q ? ui.link("ล้างคำค้น", ctx.pageUrl({ q: null, n: null }), "btn rf-btn secondary small") : ""}${pay.canSeeRates ? ui.openButton("อัตราค่าแรง", "labourRates", {}, { className: "secondary small", title: "อัตราค่าแรง บาท/ชม. ต่อแผนก" }) : ""}</div>`;
    const head = ["ชิ้นงาน", { label: "ค่าแรงแผนก (บาท/ชิ้น)", className: "right", title: "อัตราของแผนก × จำนวนคน ÷ เป้าชิ้น/ชม. ทุกขั้นที่ตั้งเป้าไว้" }, { label: "วัตถุดิบ (บาท/ชิ้น)", className: "right", title: "ของซื้อในบรรทัด BOM ของชิ้นนี้ รวมเผื่อเสีย" }, { label: "รวมที่ชิ้นนี้ (บาท/ชิ้น)", className: "right", title: "ยังไม่รวมชิ้นที่ผลิตเองข้างใต้และคอมปาวด์ยาง" }, ""];
    const empty = q ? "ไม่พบชิ้นงานที่ค้นหา" : "ยังไม่มีชิ้นงานที่ผลิตเองในทะเบียน BOM";
    return `${F.pageHead(ctx, ctx.view.label)}${toolbar}${ui.card(`${ui.table(head, rows, { emptyText: empty })}${more}`, { flush: true })}`;
  }
  // ที่แก้สิ่งที่ขาด: เป้า = หน้าตั้งค่าของแผนกนั้น (เปิดได้เฉพาะผู้ที่เปิดโมดูลแผนกได้ ไม่งั้นบอกเป็นข้อความ) · อัตรา = ปุ่ม "อัตราค่าแรง" · ราคา = ลิงก์ในคลังของ ST (priceLink)
  function itemCallouts(ctx, cost, pay) {
    const { ui } = ctx;
    const employee = state.employee;
    const out = [];
    for (const { dept } of cost.labour.reasons.filter((row) => row.reason === "noTarget")) {
      const route = F.deptLink(employee, dept);
      const fix = route ? ui.link(`ไปตั้งเป้าที่ ${dept}`, `${route}?tab=settings`, "btn rf-btn secondary small") : `<span class="small muted">${esc(`ตั้งที่ "ตั้งค่าขั้นตอนและเป้า" ของโมดูลแผนก ${dept} (หัวหน้าแผนก ${dept} หรือฝ่ายวางแผน)`)}</span>`;
      out.push(ui.callout("warn", `<strong>${esc(`แผนก ${dept} ยังไม่มีเป้าของชิ้นนี้`)}</strong> ${esc("ค่าแรงของแผนกนี้ยังไม่รวมในยอด")}<p>${fix}</p>`));
    }
    const noRate = cost.labour.reasons.filter((row) => row.reason === "noRate").map((row) => row.dept);
    if (noRate.length) {
      const fix = pay.canSeeRates ? `<p>${ui.openButton("อัตราค่าแรง", "labourRates", {}, { className: "secondary small" })}</p>` : "";
      out.push(ui.callout("warn", `<strong>${esc(`ยังไม่มีอัตราค่าแรงของแผนก ${noRate.join(", ")} ที่มีผล ณ วันที่เลือก`)}</strong> ${esc("ค่าแรงของขั้นเหล่านี้ยังไม่รวมในยอด")}${fix}`));
    }
    if (cost.materials.missing.length) {
      out.push(ui.callout("warn", `<strong>${esc(`ของซื้อยังไม่มีราคา ${cost.materials.missing.length} รายการ`)}</strong> ${esc("ยังไม่รวมในยอดวัตถุดิบ")}<ul class="cost-missing">${cost.materials.missing.map((code) => `<li>${ui.badge("warn", code)}</li>`).join("")}</ul>${priceLink(ctx)}`));
    }
    return out.join("");
  }
  function itemDetailView(ctx, data, bom, pay, code) {
    const C = costRules();
    const { ui, params } = ctx;
    const back = backLink(costUrl({ tab: "items" }), "‹ ต้นทุนต่อชิ้น");
    const key = bomRules()?.canonicalCode?.(code) ?? code;
    const inputs = itemInputs(bom);
    const item = inputs.itemOf(key);
    if (!item) return `${back}${F.pageHead(ctx, ctx.view.label)}${ui.card(ui.empty("ไม่พบชิ้นงานนี้ในทะเบียน BOM"))}`;
    const title = `${item.code} · ${item.name ?? ""}`;
    if (!C.hasItemCost(item)) {
      const text = item.kind === "RB" ? "เส้นยางคิดค่าแรงต่อชุดผสมที่หน้าต้นทุนสูตร (เวลามาตรฐานของ RB) ยังไม่แยกมาเป็นต่อเส้น" : "ชิ้นนี้เป็นของซื้อหรือสูตรยาง จึงไม่มีต้นทุนต่อชิ้น (ราคาของซื้อตั้งที่ในคลังของ ST)";
      return `${back}${F.pageHead(ctx, title)}${ui.card(ui.empty(text, item.kind === "RB" ? `<div class="rf-row">${ui.link("ไปที่ต้นทุนสูตร", costUrl(), "btn rf-btn secondary")}</div>` : ""))}`;
    }
    const today = C.bangkokDay(ctx.now);
    const asof = C.dayKey(params.get("asof")) || today;
    const cost = costOfItem(item, inputs, data, pay, asof);
    const money = (value, part) => `${part ? "≥ " : ""}${C.fmtPrice(value)} บาท`;
    const stats = `<div class="rf-grid rf-g3">${ui.stat({ label: "ค่าแรงแผนก", value: cost.labour.steps.length ? money(cost.labour.cost, !cost.labour.complete) : "-", tone: cost.labour.complete ? "" : "warn" })}${ui.stat({ label: "วัตถุดิบ", value: money(cost.materials.cost, !cost.materials.complete), tone: cost.materials.complete ? "" : "warn" })}${ui.stat({ label: "รวมที่ชิ้นนี้", value: money(cost.own, cost.partial), sub: `ต่อ 1 ${bomRules()?.uomLabel?.(item.uom) ?? item.uom ?? ""}`, tone: cost.partial ? "warn" : "" })}</div>`;
    const datePick = ui.field("ราคา ณ วันที่", ui.input("asof", { type: "date", value: asof, id: "cost-asof", extra: 'data-cost-filter title="ใช้ราคาและอัตราค่าแรงที่มีผลในวันนี้"' }), { id: "cost-asof", className: "sr-filter" });
    // ค่าแรงแยกตามขั้น: อัตราของแผนกแสดงครั้งเดียวที่หัวการ์ด (ไม่ซ้ำทุกแถว)
    const stepRows = cost.labour.steps.map((step) => `<tr><td>${esc(`${step.dept} · ${step.stepName}`)}</td><td class="right rf-mono">${esc(C.fmtPerHour(step.perHour))}</td><td class="right rf-mono">${esc(String(step.people))}</td><td class="right rf-mono">${esc(C.fmtMinutes(step.minutes))}</td><td class="right rf-mono">${step.cost === null ? dash : perPiece(step.cost)}</td></tr>`);
    const rateText = cost.labour.depts.filter((row) => row.ratePerHour !== null).map((row) => `อัตรา ${row.dept} ${C.fmtBaht(row.ratePerHour)} บาท/ชม.`).join(" · ");
    const labourHead = ["แผนก · ขั้น", { label: "เป้าชิ้น/ชม.", className: "right" }, { label: "จำนวนคน", className: "right" }, { label: "นาที/ชิ้น", className: "right", title: "60 ÷ เป้าชิ้น/ชม." }, { label: "ค่าแรง/ชิ้น (บาท)", className: "right", title: "อัตราของแผนก × จำนวนคน ÷ เป้าชิ้น/ชม." }];
    const labourCard = ui.card(ui.table(labourHead, stepRows, { emptyText: "ยังไม่มีเป้าของชิ้นนี้ในแผนกใด" }), { title: esc("ค่าแรงแยกตามขั้น"), actions: rateText ? `<span class="small muted">${esc(rateText)}</span>` : "", flush: true });
    const lineRows = cost.materials.lines.map((line) => {
      const uom = bomRules()?.uomLabel?.(line.uom) ?? line.uom;
      const scrap = line.scrapPct ? `<div class="small muted">${esc(`${C.fmtQtyPer(line.qty)} + เผื่อเสีย ${C.fmtQtyPer(line.scrapPct)}%`)}</div>` : "";
      const price = line.unitPrice === null ? ui.badge("warn", "ยังไม่มีราคา") : `<span class="rf-mono">${esc(C.fmtPrice(line.unitPrice))}</span>`;
      return `<tr><td>${ui.mono(line.childCode)}${line.name ? `<div class="small muted">${esc(line.name)}</div>` : ""}</td><td class="right rf-mono">${esc(`${C.fmtQtyPer(line.factor)} ${uom}`)}${scrap}</td><td class="right">${price}</td><td class="right rf-mono">${line.cost === null ? dash : perPiece(line.cost)}</td></tr>`;
    });
    const hasBom = inputs.approved.has(item.code);
    const materialsCard = ui.card(ui.table(["ของซื้อ", { label: "จำนวนต่อชิ้น", className: "right", title: "ปริมาณในบรรทัด BOM รวมเผื่อเสีย" }, { label: "ราคา/หน่วย (บาท)", className: "right" }, { label: "ต้นทุน (บาท)", className: "right" }], lineRows, { emptyText: hasBom ? "BOM ของชิ้นนี้ไม่มีของซื้อ" : "ชิ้นนี้ยังไม่มี BOM ที่อนุมัติ" }), { title: esc("วัตถุดิบ (ของซื้อ)"), flush: true });
    // ชิ้นที่ผลิตเองข้างใต้: ยังไม่รวมในยอด (เฟส 4) · ชิ้นที่มีหน้าต้นทุนต่อชิ้นลิงก์ไปหน้านั้น · เส้นยาง / สูตรยางคิดที่ต้นทุนสูตร
    const madeRows = cost.made.map((child) => {
      const known = inputs.itemOf(child.childCode);
      const uom = known ? bomRules()?.uomLabel?.(known.uom) ?? known.uom : "";
      const link = known && C.hasItemCost(known) ? ui.link(child.childCode, costUrl({ item: child.childCode }), "rf-mono") : ui.mono(child.childCode);
      const where = known && !C.hasItemCost(known) ? ` <span class="small muted">(${known.kind === "RB" || known.kind === "CP" ? "คิดที่ต้นทุนสูตร" : "ไม่มีต้นทุนต่อชิ้น"})</span>` : !known ? ` <span class="small muted">(ไม่พบในทะเบียน)</span>` : "";
      return `<li>${link} ${esc(child.name)} <span class="muted nowrap">${esc(`× ${C.fmtQtyPer(child.factor)} ${uom}`.trim())}</span>${where}</li>`;
    });
    const madeCard = madeRows.length ? ui.card(`<p class="small muted">${esc("ยอดข้างบนยังไม่รวมต้นทุนของชิ้นเหล่านี้และคอมปาวด์ยาง (รวมทั้งโครงสร้างในขั้นต่อไป)")}</p><ul class="cost-made">${madeRows.join("")}</ul>`, { title: esc("ชิ้นที่ผลิตเอง (ยังไม่รวมในยอดนี้)") }) : "";
    return `${back}${F.pageHead(ctx, title)}<div class="rf-row sr-toolbar">${datePick}</div>${stats}${itemCallouts(ctx, cost, pay)}${labourCard}${materialsCard}${madeCard}`;
  }
  // หน้าต้นทุนต่อชิ้นต้องมีข้อมูล BOM และค่าแรงครบก่อน (อัตราที่ยังไม่โหลดไม่ใช่ "ไม่มีอัตรา"): คืน HTML ของสถานะ หรือ "" = พร้อม
  function itemsWaiting(ctx, pay) {
    const { ui } = ctx;
    const store = bomStore();
    const head = F.pageHead(ctx, ctx.view.label);
    if (!store) return `${head}${ui.card(ui.empty("ข้อมูล BOM ยังไม่พร้อม"))}`;
    const status = store.status();
    if (status === "error") return `${head}${ui.card(ui.empty("โหลดข้อมูล BOM ไม่สำเร็จ", '<div class="rf-row"><button class="btn rf-btn secondary" type="button" data-cost-retry="bom">ลองอีกครั้ง</button></div>'))}`;
    if (status !== "ready") return `${head}${ui.card(ui.empty("กำลังโหลดข้อมูล BOM…"))}`;
    if (pay.status === "error") return `${head}${ui.card(ui.empty("โหลดข้อมูลค่าแรงไม่สำเร็จ", '<div class="rf-row"><button class="btn rf-btn secondary" type="button" data-cost-retry="labour">ลองอีกครั้ง</button></div>'))}`;
    if (pay.status === "forbidden") return `${head}${ui.card(ui.empty("บัญชีนี้ไม่มีสิทธิ์ดูค่าแรง"))}`;
    if (pay.status !== "ready") return `${head}${ui.card(ui.empty("กำลังโหลดข้อมูลค่าแรง…"))}`;
    return "";
  }
  // ขอโหลด BOM ครั้งเดียวต่อรอบ แล้ววาดหน้าใหม่เมื่อเสร็จ (ตัวรับ event ของ module-bom วาดเฉพาะหน้า BOM / หน้าแผนก)
  let bomWaking = false;
  function wakeBom() {
    const store = bomStore();
    if (!store || bomWaking || !["idle", "loading"].includes(store.status())) return;
    bomWaking = true;
    const done = () => { bomWaking = false; repaint(); };
    Promise.resolve(store.ensureLoaded()).then(done, done);
  }

  // ---------- วาดหน้า ----------
  const repaint = () => { try { if (currentRoute().path === ROUTE) renderRoute(); } catch { /* ออกจากหน้าแล้ว */ } };
  function bindControls(node, ctx) {
    node.querySelectorAll("[data-cost-filter]").forEach((control) => control.addEventListener("change", () => {
      const value = control.name === "asof" && control.value === costRules().bangkokDay(ctx.now) ? "" : control.value;
      location.hash = ctx.pageUrl({ [control.name]: value || null, n: null });
    }));
    // ลองอีกครั้ง: data-cost-retry="labour" = โหลดค่าแรงใหม่ (force ข้ามสถานะผิดพลาดที่ไม่โหลดซ้ำเอง) · "bom" = โหลดข้อมูล BOM ใหม่ · ไม่มีค่า = โหลดข้อมูลต้นทุนใหม่
    node.querySelectorAll("[data-cost-retry]").forEach((button) => button.addEventListener("click", () => {
      button.disabled = true;
      const D = costData();
      const which = button.getAttribute?.("data-cost-retry");
      const job = which === "labour" ? D.loadLabour({ force: true }) : which === "bom" ? Promise.resolve(bomStore()?.reload?.()) : D.loadCost({ force: true });
      job.then(repaint, repaint);
    }));
  }
  async function render(params) {
    const employee = state.employee;
    const C = costRules();
    const D = costData();
    if (!C || !D || !F || employee?.isSandbox !== true || !C.canSeeCost(employee)) return renderNotFound();
    const ui = root.MNP_RUBBERFLOW_UI;
    ui.module = "";
    const ctx = pageCtx(params);
    if (D.needsCost()) D.loadCost().then(repaint);
    if (D.needsLabour()) D.loadLabour().then(repaint);
    const cost = D.cost();
    let body;
    if (cost.status === "forbidden") body = `${F.pageHead(ctx, LABEL)}${ui.card(ui.empty("บัญชีนี้ไม่มีสิทธิ์ดูต้นทุนการผลิต"))}`;
    else if (cost.status === "error") body = `${F.pageHead(ctx, LABEL)}${ui.card(ui.empty(D.errorText(cost.error), '<div class="rf-row"><button class="btn rf-btn secondary" type="button" data-cost-retry>ลองอีกครั้ง</button></div>'))}`;
    else if (cost.status !== "ready" || !cost.data) body = `${F.pageHead(ctx, LABEL)}${ui.card(ui.empty("กำลังโหลดข้อมูลต้นทุน…"))}`;
    else if (params.get("recipe")) body = detailView(ctx, cost.data, params.get("recipe"));
    else if (ctx.view.id === "items") {
      wakeBom();
      const pay = labourData();
      body = itemsWaiting(ctx, pay) || (params.get("item") ? itemDetailView(ctx, cost.data, bomStore().data(), pay, params.get("item")) : itemsView(ctx, cost.data, bomStore().data(), pay));
    } else if (ctx.view.id === "lots") body = lotsView(ctx, cost.data);
    else body = recipesView(ctx, cost.data);
    app.innerHTML = shell(`<div class="rf-page bom-page" data-module="cost" data-rf-mod="">${body}</div>`, ROUTE, LABEL);
    bindShell();
    const node = document.querySelector(".content");
    F.bindRoot(node, ctx, { run: () => false, ui, openDialog: (name, args) => root.MNP_COST_LABOUR?.open(name, args) });
    ui.labelTables(node);
    ui.enhanceDates(node);
    bindControls(node, ctx);
    return undefined;
  }

  root.MNP_COST_PAGES = Object.freeze({ ROUTE, LABEL, ICON, render, subnav, viewOf });
})(window);
