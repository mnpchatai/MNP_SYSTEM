// หน้าของโมดูลต้นทุนการผลิต #/cost (โหมดทดสอบ · เมนูกลุ่ม "โรงงาน") — โหลดก่อน modules/module-cost.js (ดู index.html) · กฎอยู่ที่ modules/cost-rules.js ข้อมูลที่ modules/cost-data.js
// หน้า: ต้นทุนสูตร (ค่าตั้งต้น · ทุกสูตร revision ที่ใช้งาน ต้นทุนต่อชุดผสม / ต่อ kg) · ?recipe=<รหัสสูตร> (&rev=<revision> &asof=<YYYY-MM-DD> &tab=lots) รายละเอียด: แยกตามขั้น รายการเรียงตามต้นทุน เคมีที่ยังไม่มีราคา และเทียบกับจริงรายล็อตผสม
//       · ?tab=lots สูตรเทียบจริง (ล็อตผสมล่าสุดทุกสูตร) · ?q= ค้นหา · ?n= แสดงเพิ่ม
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
  const KEYS = Object.freeze(["recipe", "rev", "asof", "tab", "q"]);

  // เมนูข้าง: ต้นทุนสูตร (หน้าสูตรอยู่ใต้รายการนี้) · สูตรเทียบจริง
  const VIEWS = Object.freeze([
    { id: "recipes", label: "ต้นทุนสูตร", icon: "flask", params: {} },
    { id: "lots", label: "สูตรเทียบจริง", icon: "scale", params: { tab: "lots" } },
  ]);
  const viewOf = (params) => (!params.get("recipe") && params.get("tab") === "lots" ? VIEWS[1] : VIEWS[0]);
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
  const approx = (partial, text) => (partial ? `<span title="ยังไม่รวมเคมีที่ไม่มีราคา">≥ ${esc(text)}</span>` : esc(text));
  const nameOf = (data) => { const map = new Map((data.materials ?? []).map((material) => [material.code, material.name ?? ""])); return (code) => map.get(code) ?? ""; };
  const missingBadge = (ui, missing) => (missing.length ? `<span title="${attr(missing.join(", "))}">${ui.badge("warn", `ขาดราคา ${missing.length}`)}</span>` : "");
  const backLink = (href, text) => `<a class="request-back-link" href="${attr(href)}">${esc(text)}</a>`;

  // ---------- ต้นทุนสูตร (รายการ) ----------
  function recipesView(ctx, data) {
    const C = costRules();
    const { ui, q } = ctx;
    const today = C.bangkokDay(ctx.now);
    const ids = [...new Set(data.recipes.map((recipe) => recipe.id))].sort((a, b) => String(a).localeCompare(String(b)));
    const list = ids.map((id) => C.currentRevision(data.recipes, id)).filter((recipe) => recipe && F.includesText(`${recipe.id} ${recipe.productCode ?? ""}`, q))
      .map((recipe) => ({ recipe, cost: C.formulaCost(recipe, data.prices, today) }));
    const { shown, more } = F.limited(ctx, list);
    const rows = shown.map(({ recipe, cost }) => {
      const href = costUrl({ recipe: recipe.id });
      const sub = [recipe.productCode ? `${recipe.productCode}` : "", `rev ${recipe.revision}`].filter(Boolean).join(" · ");
      const state = recipe.status === "approved" ? "" : ` ${ui.status(recipe.status)}`;
      return `<tr class="row-link"><td>${rowLink(ui, recipe.id, href)}${state}<div class="small muted">${esc(sub)}</div></td><td class="right rf-mono">${esc(C.fmtWeight(cost.batchKg))}</td><td class="right rf-mono">${approx(!cost.complete, C.fmtBaht(cost.cost))}</td><td class="right rf-mono">${cost.costPerKg === null ? dash : approx(!cost.complete, C.fmtBaht(cost.costPerKg))}</td><td>${missingBadge(ui, cost.missing)}</td></tr>`;
    });
    const toolbar = `<div class="rf-row sr-toolbar">${F.searchForm(ctx, "ค้นหารหัสสูตรหรือรหัสสินค้า")}${q ? ui.link("ล้างคำค้น", ctx.pageUrl({ q: null, n: null }), "btn rf-btn secondary small") : ""}</div>`;
    const empty = q ? "ไม่พบสูตรที่ค้นหา" : "ยังไม่มีสูตรในทะเบียน RubberFlow";
    const head = ["สูตร", { label: "น้ำหนักต่อชุดผสม", className: "right" }, { label: "ต้นทุนต่อชุดผสม (บาท)", className: "right" }, { label: "ต้นทุน/kg (บาท)", className: "right" }, ""];
    return `${F.pageHead(ctx, LABEL)}${toolbar}${ui.card(`${ui.table(head, rows, { emptyText: empty })}${more}`, { flush: true })}`;
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
    const nameFor = nameOf(data);
    const partial = !cost.complete;
    const stat = (label, value) => ui.stat({ label, value, tone: partial && label !== "น้ำหนักต่อชุดผสม" ? "warn" : "" });
    const stats = `<div class="rf-grid rf-g3">${stat("ต้นทุนต่อชุดผสม", `${partial ? "≥ " : ""}${C.fmtBaht(cost.cost)} บาท`)}${stat("ต้นทุนต่อ kg", cost.costPerKg === null ? "-" : `${partial ? "≥ " : ""}${C.fmtBaht(cost.costPerKg)} บาท`)}${stat("น้ำหนักต่อชุดผสม", C.fmtWeight(cost.batchKg))}</div>`;
    const revisionPick = revisions.length > 1
      ? `<div class="field rf-field sr-filter"><label class="sr-only" for="cost-rev">ฉบับของสูตร</label>${ui.select("rev", revisions.map((entry) => ({ value: String(entry.revision), label: `rev ${entry.revision} · ${ui.statusLabel(entry.status)}` })), { value: String(recipe.revision), id: "cost-rev", extra: `data-cost-filter title="ฉบับของสูตร"` })}</div>` : "";
    const datePick = ui.field("ราคา ณ วันที่", ui.input("asof", { type: "date", value: asof, id: "cost-asof", extra: 'data-cost-filter title="ใช้ราคาที่มีผลในวันนี้"' }), { id: "cost-asof", className: "sr-filter" });
    const toolbar = `<div class="rf-row sr-toolbar">${revisionPick}${datePick}</div>`;
    const missing = partial
      ? ui.callout("warn", `<strong>${esc(`ยังไม่มีราคา ${cost.missing.length} รายการ`)}</strong> ${esc("ต้นทุนข้างบนเป็นยอดบางส่วน ยังไม่รวมรายการเหล่านี้")}<ul class="cost-missing">${cost.missing.map((code) => `<li>${ui.badge("warn", nameFor(code) ? `${code} · ${nameFor(code)}` : code)}</li>`).join("")}</ul>${priceLink(ctx)}`)
      : "";
    const tab = params.get("tab") === "lots" ? "lots" : "cost";
    const lotCount = data.lots.filter((lot) => lot.recipeId === recipeId).length;
    const tabs = ui.tabs([{ id: "cost", label: "แยกตามขั้น" }, { id: "lots", label: `เทียบกับจริง${lotCount ? ` (${lotCount})` : ""}` }], tab, (id) => ctx.pageUrl({ tab: id === "cost" ? null : id, n: null }));
    let body;
    if (tab === "lots") {
      const lots = data.lots.filter((lot) => lot.recipeId === recipeId).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      body = lotsTable(ctx, data, lots, { emptyText: "ยังไม่มีล็อตผสมของสูตรนี้" });
    } else {
      const head = ["วัตถุดิบ", { label: "น้ำหนักต่อชุดผสม", className: "right" }, { label: "ราคา (บาท/kg)", className: "right" }, { label: "ต้นทุน (บาท)", className: "right" }, { label: "สัดส่วน", className: "right" }];
      body = cost.parts.map((part) => {
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

  // ---------- วาดหน้า ----------
  const repaint = () => { try { if (currentRoute().path === ROUTE) renderRoute(); } catch { /* ออกจากหน้าแล้ว */ } };
  function bindControls(node, ctx) {
    node.querySelectorAll("[data-cost-filter]").forEach((control) => control.addEventListener("change", () => {
      const value = control.name === "asof" && control.value === costRules().bangkokDay(ctx.now) ? "" : control.value;
      location.hash = ctx.pageUrl({ [control.name]: value || null, n: null });
    }));
    node.querySelector("[data-cost-retry]")?.addEventListener("click", (event) => { event.currentTarget.disabled = true; costData().loadCost({ force: true }).then(repaint); });
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
    const cost = D.cost();
    let body;
    if (cost.status === "forbidden") body = `${F.pageHead(ctx, LABEL)}${ui.card(ui.empty("บัญชีนี้ไม่มีสิทธิ์ดูต้นทุนการผลิต"))}`;
    else if (cost.status === "error") body = `${F.pageHead(ctx, LABEL)}${ui.card(ui.empty(D.errorText(cost.error), '<div class="rf-row"><button class="btn rf-btn secondary" type="button" data-cost-retry>ลองอีกครั้ง</button></div>'))}`;
    else if (cost.status !== "ready" || !cost.data) body = `${F.pageHead(ctx, LABEL)}${ui.card(ui.empty("กำลังโหลดข้อมูลต้นทุน…"))}`;
    else if (params.get("recipe")) body = detailView(ctx, cost.data, params.get("recipe"));
    else if (ctx.view.id === "lots") body = lotsView(ctx, cost.data);
    else body = recipesView(ctx, cost.data);
    app.innerHTML = shell(`<div class="rf-page bom-page" data-module="cost" data-rf-mod="">${body}</div>`, ROUTE, LABEL);
    bindShell();
    const node = document.querySelector(".content");
    F.bindRoot(node, ctx, { run: () => false, ui });
    ui.labelTables(node);
    ui.enhanceDates(node);
    bindControls(node, ctx);
    return undefined;
  }

  root.MNP_COST_PAGES = Object.freeze({ ROUTE, LABEL, ICON, render, subnav, viewOf });
})(window);
