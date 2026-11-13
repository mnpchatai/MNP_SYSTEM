// BOM รายแผนก (โหมดทดสอบ) — หน้าโครงใหม่ 4 เมนู: สินค้า (find) · ใบสั่งผลิต (แถบขั้นตอนของหน้า orders) · งานของฉัน (work) · ข้อมูลตั้งต้น (setup)
// โหลดต่อจาก modules/bom-pages.js และลงทะเบียนใน window.MNP_BOM_PAGES / _DIALOGS ชุดเดียวกัน · กติกา ข้อมูล และคำสั่ง (actions) เป็นของเดิมทั้งหมด ไฟล์นี้เปลี่ยนเฉพาะการจัดหน้า
// หน้าสินค้าวางหน้าเดิม (งานทุกแผนก โครงสร้าง/ต้นทุน) เป็นแท็บด้วย ctx.embed · ลิงก์ในแท็บเหล่านั้นถูกพากลับมาที่หน้าสินค้า (hubCtx)
(function (root) {
  const pages = (root.MNP_BOM_PAGES ??= {});
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const includes = (haystack, q) => !q || String(haystack).toLowerCase().includes(q.toLowerCase());
  const itemOf = (ctx, code) => ctx.helpers.itemOf(ctx.data, code);
  const approvedBomOf = (ctx, code) => ctx.helpers.approvedBomOf(ctx.data, code);
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);
  const deptName = (ctx, dept) => String(ctx.rules.DEPT_LABEL[dept] ?? dept).replace(/^\w+ · /, "");
  // ป้ายแผนก: ตัวย่อ + สีประจำแผนก (สีเป็นตัวช่วย ตัวย่อเป็นตัวบอก) ชื่อเต็มอยู่ใน title
  const deptChip = (ctx, dept) => `<span class="bom-dept" data-dept="${attr(dept)}" title="${attr(ctx.rules.DEPT_LABEL[dept] ?? dept)}">${esc(dept)}</span>`;
  const pageHead = (ctx, title, sub = "", actionsHtml = "") => `<header class="rf-pagehead"><div class="rf-pagehead-main"><span class="rf-mod-ico" aria-hidden="true">${pages.icon(ctx.page)}</span><div><h1>${esc(title)}</h1>${sub ? `<p class="bom-hero-sub">${sub}</p>` : ""}</div></div>${actionsHtml ? `<div class="rf-row">${actionsHtml}</div>` : ""}</header>`;

  // ลิงก์ของหน้าเดิมที่ถูกวางเป็นแท็บ: ชิ้นงาน/สินค้า/โครงสร้าง กลับมาที่หน้าสินค้า (แท็บที่ตรงกัน) หน้าอื่นไปตามเดิม
  const hubUrl = (ctx) => (page, extra = {}) => {
    if (page === "items") return extra.sel ? ctx.url("find", { code: extra.sel }) : ctx.url("find", { q: extra.q });
    if (page === "product" && extra.code) return ctx.url("find", { code: extra.code, tab: "depts", qty: extra.qty });
    if (page === "structure" && extra.code) return ctx.url("find", { code: extra.code, tab: "cost", qty: extra.qty, view: extra.view });
    return ctx.url(page, extra);
  };
  const hubCtx = (ctx, page, params) => ({ ...ctx, embed: true, page, params: new URLSearchParams(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== "")), url: hubUrl(ctx) });

  // "0.0323 เส้น ต่อ 1 ชิ้น" อ่านยาก: ถ้าเป็นส่วนกลับของจำนวนเต็ม บอกเป็น "1 เส้น ได้ 31 ชิ้น" · อย่างอื่นแสดงปริมาณตรงๆ
  function ratioText(ctx, qty, uom, parentUom) {
    const n = Number(qty);
    if (n > 0 && n < 1) {
      const per = 1 / n;
      const whole = Math.round(per);
      if (whole >= 2 && Math.abs(per - whole) <= 0.005 * whole) return `1 ${uomText(ctx, uom)} ได้ ${ctx.rules.fmtQty(whole)} ${uomText(ctx, parentUom)}`;
    }
    return `${ctx.rules.fmtQty(n)} ${uomText(ctx, uom)}`;
  }

  // ---------- สินค้า: ค้นหา → หน้าเดียวต่อสินค้า/ชิ้นงาน ----------
  const KIND_TABS = Object.freeze([["fg", "สินค้า"], ["wip", "ชิ้นงานผลิตเอง"], ["raw", "ของซื้อ / วัตถุดิบ"], ["all", "ทั้งหมด"]]);
  const kindGroup = (ctx, kind) => (kind === "FG" ? "fg" : ctx.helpers.NO_BOM_KINDS.includes(kind) ? "raw" : "wip");
  const LIST_LIMIT = 200;
  const ADD_LIST_LIMIT = 3000; // ตัวเลือกในช่องรหัสของหน้าต่างเพิ่มส่วนประกอบ (รหัสที่เกินนี้ยังพิมพ์เองได้)
  function findList(ctx) {
    const { data, ui, rules, params } = ctx;
    const canEdit = ctx.helpers.canPlan(ctx.user);
    const kind = KIND_TABS.some(([id]) => id === params.get("kind")) ? params.get("kind") : ctx.q ? "all" : "fg";
    const matched = data.items.filter((item) => includes(`${item.code} ${item.name} ${(item.legacyCodes ?? []).join(" ")}`, ctx.q));
    const list = matched.filter((item) => kind === "all" || kindGroup(ctx, item.kind) === kind).sort((a, b) => a.code.localeCompare(b.code));
    const tabs = ui.tabs(KIND_TABS.map(([id, label]) => ({ id, label: `${label} ${matched.filter((item) => id === "all" || kindGroup(ctx, item.kind) === id).length}` })), kind, (id) => ctx.url("find", { kind: id, q: ctx.q || null }));
    const rows = list.slice(0, LIST_LIMIT).map((item) => {
      const bom = approvedBomOf(ctx, item.code);
      const bomCell = bom ? `Rev.${esc(String(bom.revision))} · ${esc(String(bom.lines.length))} บรรทัด` : ["FG", "SE", "PT", "BG"].includes(item.kind) ? ui.badge("warn", "ยังไม่มี BOM") : '<span class="muted">—</span>';
      return `<tr><td><a class="bom-find-link" href="${attr(ctx.url("find", { code: item.code }))}"><strong>${esc(item.name)}</strong><span class="rf-mono small">${esc(item.code)}</span></a>${item.active === false ? ' <span class="small muted">เลิกใช้</span>' : ""}</td><td>${deptChip(ctx, item.ownerDept)}</td><td class="nowrap">${bomCell}</td></tr>`;
    });
    const search = `<form novalidate class="rf-search" data-rf-search role="search"><label class="sr-only" for="bom-q">ค้นหาสินค้าหรือชิ้นงาน</label>${ui.input("q", { id: "bom-q", type: "search", value: ctx.q, placeholder: "ค้นหาด้วยชื่อหรือรหัส…" })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>`;
    const more = list.length > LIST_LIMIT ? `<p class="small muted">แสดง ${LIST_LIMIT} จาก ${list.length} รายการ พิมพ์คำค้นเพื่อกรอง</p>` : "";
    const actions = canEdit ? ui.openButton("สร้างสินค้าใหม่", "productNew", {}, { className: "" }) : "";
    const html = `${pageHead(ctx, "สินค้า", "", actions)}${ui.card(`${search}${tabs}${ui.table(["ชื่อ / รหัส", "แผนกที่ทำ", "BOM"], rows, { emptyText: ctx.q ? "ไม่พบสินค้าหรือชิ้นงานที่ค้นหา" : "ยังไม่มีรายการในหมวดนี้" })}${more}`)}`;
    return { html };
  }

  // แท็บโครงสร้าง: ต้นไม้ย่อ-ขยายได้ อ่านจากบนลงล่าง · คลิกบรรทัดดูรายละเอียดในแผงข้าง
  const TREE_OPEN_LIMIT = 40; // เกินนี้เปิดแค่ชั้นแรก ให้ผู้ใช้ขยายเองทีละกิ่ง
  function treeTab(ctx, item, qty) {
    const { ui, rules } = ctx;
    const canEdit = ctx.helpers.canPlan(ctx.user);
    const { lines, missing } = rules.explode(item.code, qty, { itemOf: (c) => itemOf(ctx, c), approvedBomOf: (c) => approvedBomOf(ctx, c) });
    const rows = lines.slice(1);
    const hasChild = (index) => rows[index + 1] && rows[index + 1].level > rows[index].level;
    const openAll = rows.length <= TREE_OPEN_LIMIT;
    const uomOf = (code) => itemOf(ctx, code)?.uom ?? "";
    const body = rows.map((line, index) => {
      const parent = hasChild(index);
      const key = line.path.join(">");
      const hidden = !openAll && line.level > 1;
      const toggle = parent ? `<button class="bom-tree-toggle" type="button" data-tree-toggle aria-expanded="${openAll}" aria-label="${attr(`ย่อหรือขยาย ${line.name}`)}"><span aria-hidden="true">${openAll ? "−" : "+"}</span></button>` : '<span class="bom-tree-toggle is-leaf" aria-hidden="true"></span>';
      return `<tr data-tree-row data-key="${attr(key)}" data-index="${index}" data-level="${line.level}"${hidden ? " hidden" : ""}>
        <td><div class="bom-tree-cell" style="--lv:${Math.min(line.level - 1, 8)}">${toggle}${deptChip(ctx, line.producerDept)}<button class="bom-tree-name${parent ? " is-parent" : ""}" type="button" data-tree-pick><span>${esc(line.name)}</span><span class="rf-mono small">${esc(line.itemCode)}</span></button>${line.noBom ? ui.badge("warn", "ยังไม่มี BOM") : ""}</div></td>
        <td class="right">${esc(ratioText(ctx, line.qtyPerParent, line.uom, uomOf(line.parentCode)))}</td>
        <td class="right"><strong>${esc(`${rules.fmtQty(line.required)} ${uomText(ctx, line.uom)}`)}</strong></td></tr>`;
    });
    const qtyForm = `<form novalidate class="bom-tree-qty" data-hub-qty><label for="bom-hub-qty">คำนวณสำหรับ</label>${ui.input("qty", { id: "bom-hub-qty", type: "number", step: "any", min: "0.0001", value: String(qty) })}<span>${esc(uomText(ctx, item.uom))}</span><button class="btn rf-btn secondary small" type="submit">คำนวณ</button></form>`;
    const canAdd = canEdit && !ctx.helpers.NO_BOM_KINDS.includes(item.kind);
    const addRoot = canAdd ? ui.openButton("+ เพิ่มส่วนประกอบ", "lineAdd", { parentCode: item.code }, { className: "small" }) : "";
    const folds = `<div class="rf-row">${rows.some((_, index) => hasChild(index)) ? `<button class="btn rf-btn secondary small" type="button" data-tree-all="open">ขยายทั้งหมด</button><button class="btn rf-btn secondary small" type="button" data-tree-all="close">ย่อทั้งหมด</button>` : ""}${addRoot}</div>`;
    const emptyText = ctx.helpers.NO_BOM_KINDS.includes(item.kind) ? "รายการนี้เป็นของซื้อหรือสูตรยาง ไม่มีส่วนประกอบ" : "ยังไม่มี BOM";
    const table = ui.table([{ label: "ส่วนประกอบ" }, { label: "ใช้ต่อชิ้นแม่ 1 หน่วย", className: "right", title: "ปริมาณที่ใช้ทำชิ้นที่อยู่เหนือบรรทัดนี้ 1 หน่วย รวมเผื่อเสียแล้ว" }, { label: `สำหรับ ${rules.fmtQty(qty)} ${uomText(ctx, item.uom)}`, className: "right" }], body, { emptyText, className: "bom-tree" });
    const warn = missing.length ? ui.callout("warn", `ไม่พบชิ้นงานในทะเบียน: ${esc(missing.join(", "))}`) : "";
    const aside = `<aside class="card rf-card bom-tree-side" data-tree-side aria-live="polite"><p class="muted">เลือกบรรทัดเพื่อดูรายละเอียด</p></aside>`;
    const html = `${warn}<div class="bom-tree-layout"><section class="card rf-card"><div class="bom-tree-bar">${qtyForm}${folds}</div>${table}</section>${rows.length ? aside : ""}</div>`;
    // รายละเอียดของบรรทัดที่เลือก (สร้างตอนคลิก ไม่วาดล่วงหน้าทุกบรรทัด)
    const detailHtml = (line) => {
      const child = itemOf(ctx, line.itemCode);
      const bomLine = approvedBomOf(ctx, line.parentCode)?.lines.find((entry) => entry.childCode === line.itemCode);
      const children = approvedBomOf(ctx, line.itemCode)?.lines ?? [];
      const steps = (ctx.helpers.routingOf(ctx.data, line.itemCode)?.steps ?? []).map((step) => ctx.helpers.processOf(ctx.data, step.processCode)?.name ?? step.processCode);
      const usedIn = ctx.data.boms.filter((bom) => bom.status === "approved" && bom.itemCode !== line.parentCode && bom.lines.some((entry) => entry.childCode === line.itemCode)).map((bom) => bom.itemCode);
      const rubber = child?.kind === "RB" ? child.rubber : null;
      const facts = ui.kv([
        ["แผนกที่ทำ", esc(rules.DEPT_LABEL[line.producerDept] ?? line.producerDept)],
        bomLine ? [`ใช้ต่อ 1 ${uomText(ctx, uomOf(line.parentCode))}`, esc(`${rules.fmtQty(bomLine.qty)} ${uomText(ctx, line.uom)}`)] : null,
        bomLine?.scrapPct ? ["เผื่อเสีย", esc(`${rules.fmtNum(bomLine.scrapPct)} %`)] : null,
        bomLine?.note ? ["หมายเหตุ", esc(bomLine.note)] : null,
        rubber?.compound ? ["สูตรยาง", esc(rubber.compound)] : null,
        rubber?.cutLengthCm || rubber?.pcsPerRoll ? ["การตัด", esc(`ตัด ${rubber.cutLengthCm || "-"} ซม. · ${rubber.pcsPerRoll || "-"} ชิ้นต่อเส้น`)] : null,
        children.length ? ["ทำจาก", children.map((entry) => esc(itemOf(ctx, entry.childCode)?.name ?? entry.childCode)).join("<br>")] : null,
        steps.length ? ["ขั้นตอน", esc(steps.join(" → "))] : null,
        ["ใช้ในรายการอื่น", usedIn.length ? `${usedIn.slice(0, 5).map((code) => ui.link(code, ctx.url("find", { code }), "rf-mono")).join(", ")}${usedIn.length > 5 ? ` และอีก ${usedIn.length - 5}` : ""}` : '<span class="muted">ไม่มี</span>'],
      ]);
      // ลบบรรทัด = บันทึก BOM ของชิ้นแม่ใหม่โดยไม่มีบรรทัดนี้ (saveBom เดิม ได้ฉบับแก้ไขใหม่) · BOM ต้องเหลืออย่างน้อย 1 บรรทัด จึงไม่มีปุ่มลบที่บรรทัดสุดท้าย
      const siblings = approvedBomOf(ctx, line.parentCode)?.lines ?? [];
      const rest = siblings.filter((entry) => entry.childCode !== line.itemCode).map((entry) => ({ childCode: entry.childCode, qty: entry.qty, scrapPct: entry.scrapPct ?? 0, note: entry.note ?? "", step: entry.step ?? "" }));
      const buttons = [
        canEdit && bomLine ? ui.openButton("แก้บรรทัดนี้", "lineEdit", { parentCode: line.parentCode, childCode: line.itemCode }, { className: "" }) : "",
        canEdit && child && !ctx.helpers.NO_BOM_KINDS.includes(child.kind) ? ui.openButton("+ ส่วนประกอบข้างใน", "lineAdd", { parentCode: line.itemCode }, { className: "secondary" }) : "",
        ui.link("เปิดหน้าของรายการนี้", ctx.url("find", { code: line.itemCode }), "btn rf-btn secondary"),
        canEdit && bomLine && rest.length ? ui.button("ลบบรรทัดนี้", { action: "saveBom", args: { itemCode: line.parentCode, lines: rest, note: `ลบ ${line.itemCode}` }, className: "secondary", confirmText: `ลบ ${line.name} ออกจาก ${itemOf(ctx, line.parentCode)?.name ?? line.parentCode}?`, success: `ลบ ${line.itemCode} ออกจาก BOM ของ ${line.parentCode} แล้ว` }) : "",
      ].join("");
      return `<h2 class="bom-side-title">${esc(line.name)}</h2><p class="rf-mono small muted">${esc(line.itemCode)}</p>${facts}<div class="rf-row">${buttons}</div>`;
    };
    const bind = (rootNode) => {
      rootNode.querySelector("[data-hub-qty]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = Number(new FormData(event.currentTarget).get("qty"));
        location.hash = ctx.url("find", { code: item.code, qty: value > 0 ? String(value) : null });
      });
      const table = rootNode.querySelector("table.bom-tree");
      if (!table) return;
      const all = () => [...table.querySelectorAll("[data-tree-row]")];
      const setOpen = (tr, open) => {
        const button = tr.querySelector("[data-tree-toggle]");
        if (!button) return;
        button.setAttribute("aria-expanded", String(open));
        button.firstElementChild.textContent = open ? "−" : "+";
      };
      // แสดงลูกตรงของกิ่งที่เปิด และซ่อนทุกชั้นใต้กิ่งที่ปิด
      const refresh = () => {
        const closed = [];
        for (const tr of all()) {
          const key = tr.dataset.key;
          tr.hidden = closed.some((prefix) => key.startsWith(`${prefix}>`));
          if (tr.querySelector('[data-tree-toggle][aria-expanded="false"]')) closed.push(key);
        }
      };
      table.addEventListener("click", (event) => {
        const toggle = event.target.closest?.("[data-tree-toggle]");
        const tr = event.target.closest?.("[data-tree-row]");
        if (!tr) return;
        if (toggle) { setOpen(tr, toggle.getAttribute("aria-expanded") !== "true"); refresh(); return; }
        if (!event.target.closest("[data-tree-pick]")) return;
        all().forEach((row) => row.classList.toggle("is-selected", row === tr));
        const side = rootNode.querySelector("[data-tree-side]");
        if (!side) return;
        side.innerHTML = detailHtml(rows[Number(tr.dataset.index)]);
        side.querySelectorAll("[data-rf-open]").forEach((button) => button.addEventListener("click", () => { try { ctx.openDialog(button.dataset.rfOpen, JSON.parse(button.dataset.rfArgs || "{}")); } catch { /* args ไม่ถูกต้อง: ไม่เปิด */ } }));
        // ปุ่มคำสั่งในแผง (ลบบรรทัด): แผงถูกวาดหลังหน้าผูก event แล้ว จึงผูกเองด้วยกติกาเดียวกับ data-rf-action ของหน้า (ยืนยัน → สั่ง → วาดหน้าใหม่)
        side.querySelectorAll("[data-rf-action]").forEach((button) => button.addEventListener("click", async () => {
          let args = {};
          try { args = JSON.parse(button.dataset.rfArgs || "{}"); } catch { return; }
          if (button.dataset.rfConfirm && !(await root.confirmDialog(ui.confirmOptions(button)))) return;
          if (!ctx.runAction(button.dataset.rfAction, args, button.dataset.rfSuccess)) return;
          button.disabled = true;
          root.renderRoute();
        }));
      });
      rootNode.querySelectorAll("[data-tree-all]").forEach((button) => button.addEventListener("click", () => {
        all().forEach((tr) => setOpen(tr, button.dataset.treeAll === "open"));
        refresh();
      }));
    };
    return { html, bind };
  }

  // แท็บประวัติ: ข้อมูลของรายการ + ฉบับแก้ไขของ BOM
  function historyTab(ctx, item) {
    const { ui, rules, data } = ctx;
    const rubber = item.rubber;
    const usedIn = data.boms.filter((bom) => bom.status === "approved" && bom.lines.some((line) => line.childCode === item.code)).map((bom) => bom.itemCode);
    const facts = ui.kv([
      ["ชนิด", esc([rules.categoryOf(item.kind)?.label, rules.KINDS[item.kind]?.label ?? item.kind].filter(Boolean).join(" · "))],
      ["แผนกที่ทำ", esc(rules.DEPT_LABEL[item.ownerDept] ?? item.ownerDept)],
      item.weightG ? ["น้ำหนัก", esc(`${rules.fmtQty(item.weightG)} กรัม`)] : null,
      rubber?.compound ? ["สูตรยาง", esc(rubber.compound)] : null,
      ["ใช้ใน", usedIn.length ? usedIn.slice(0, 20).map((code) => ui.link(code, ctx.url("find", { code }), "rf-mono")).join(", ") + (usedIn.length > 20 ? ` และอีก ${usedIn.length - 20}` : "") : '<span class="muted">ไม่มี</span>'],
      (item.legacyCodes ?? []).length ? ["รหัสเดิมในชีต", esc(item.legacyCodes.join(", "))] : null,
      item.clonedFrom ? ["สร้างจาก", esc(item.clonedFrom)] : null,
    ]);
    const revisions = data.boms.filter((bom) => bom.itemCode === item.code).sort((a, b) => b.revision - a.revision);
    const revRows = revisions.map((bom) => `<tr><td class="nowrap">Rev.${esc(String(bom.revision))}</td><td>${ui.badge(bom.status === "approved" ? "good" : "", bom.status === "approved" ? "ใช้งาน" : "ถูกแทนแล้ว")}</td><td>${esc(String(bom.lines.length))} บรรทัด</td><td class="small">${(bom.changeLog ?? []).map((entry) => `<div>${esc(`${rules.fmtDateTime(entry.at)} ${entry.by}: ${entry.text}`)}</div>`).join("")}</td></tr>`);
    return { html: `${ui.card(facts, { title: "ข้อมูลของรายการ" })}${ui.card(ui.table(["ฉบับ", "สถานะ", "เนื้อหา", "การเปลี่ยนแปลง"], revRows, { emptyText: "ยังไม่มีฉบับแก้ไข" }), { title: "ฉบับแก้ไขของ BOM", flush: true })}` };
  }

  pages.find = (ctx) => {
    const { ui, rules, params } = ctx;
    const code = params.get("code") ? rules.canonicalCode(params.get("code")) : "";
    if (!code) return findList(ctx);
    const item = itemOf(ctx, code);
    const back = `<p class="bom-back">${ui.link("← สินค้าทั้งหมด", ctx.url("find"))}</p>`;
    if (!item) return { html: `${back}${ui.callout("warn", `ไม่พบ <strong>${esc(code)}</strong> ในทะเบียนชิ้นงาน`)}` };
    const canEdit = ctx.helpers.canPlan(ctx.user);
    const bom = approvedBomOf(ctx, item.code);
    const leaf = ctx.helpers.NO_BOM_KINDS.includes(item.kind);
    const qty = Math.max(Number(params.get("qty")) || 0, 0) || 1;
    const tabIds = [["tree", "โครงสร้าง"], ...(bom ? [["depts", "งานรายแผนก"], ["cost", "ต้นทุน / เวลา"]] : []), ["history", "ประวัติ"]];
    const tab = tabIds.some(([id]) => id === params.get("tab")) ? params.get("tab") : leaf ? "history" : "tree";
    const tabs = ui.tabs(tabIds.map(([id, label]) => ({ id, label })), tab, (id) => ctx.url("find", { code: item.code, tab: id === "tree" ? null : id, qty: qty === 1 ? null : String(qty) }));
    const sub = [esc(rules.KINDS[item.kind]?.label ?? item.kind), bom ? esc(`BOM Rev.${bom.revision} บันทึก ${rules.fmtDate(bom.approvedAt)}`) : leaf ? "" : "ยังไม่มี BOM", item.active === false ? "เลิกใช้" : ""].filter(Boolean).join(" · ");
    const actions = [
      canEdit && !leaf ? `<a class="btn rf-btn secondary" href="${attr(ctx.url("build", { code: item.code }))}" title="ตารางแก้ทั้งโครงสร้างในครั้งเดียว วางจาก Excel หรือคัดลอกโครงสร้างจากสินค้าอื่น">แก้หลายบรรทัด</a>` : "",
      canEdit ? ui.openButton("แก้ข้อมูล", "itemEdit", { code: item.code }, { className: "secondary" }) : "",
      canEdit && bom && item.kind === "FG" ? ui.openButton("ใส่ในใบสั่งผลิต", "useInOrder", { code: item.code }, { className: "" }) : "",
    ].join("");
    const hero = `<header class="rf-pagehead bom-hero"><div class="rf-pagehead-main"><span class="rf-mod-ico" aria-hidden="true">${pages.icon("find")}</span><div><p class="bom-hero-code rf-mono">${esc(item.code)}</p><h1>${esc(item.name)}</h1><p class="bom-hero-sub">${sub}</p></div></div>${actions ? `<div class="rf-row">${actions}</div>` : ""}</header>`;
    let built;
    if (tab === "depts") built = pages.product(hubCtx(ctx, "product", { code: item.code, qty: String(qty) }));
    else if (tab === "cost") built = pages.structure(hubCtx(ctx, "structure", { code: item.code, qty: String(qty), view: ["flow", "steps"].includes(params.get("view")) ? params.get("view") : "table" }));
    else if (tab === "history") built = historyTab(ctx, item);
    else built = treeTab(ctx, item, qty);
    return { html: `${back}${hero}${tabs}<div class="bom-hub-body">${built.html}</div>`, bind: built.bind };
  };

  // dialog: แก้บรรทัดเดียวของ BOM (ปริมาณ เผื่อเสีย หมายเหตุ) จากหน้าสินค้า · บันทึกเป็นฉบับแก้ไขใหม่ของ BOM ตัวแม่ด้วยคำสั่ง saveBom เดิม
  // บรรทัดอื่นของ BOM ส่งไปกับฟอร์มตามเดิม (ช่องซ่อน) เพราะ saveBom รับ BOM ทั้งใบ
  dialogs.lineEdit = (ctx, { parentCode, childCode }) => {
    const { ui, rules } = ctx;
    const parent = itemOf(ctx, parentCode);
    const bom = approvedBomOf(ctx, parentCode);
    const line = bom?.lines.find((entry) => entry.childCode === childCode);
    const child = itemOf(ctx, childCode);
    if (!parent || !line || !child) return null;
    const hiddenOf = (entry) => ["childCode", "qty", "scrapPct", "lineNote", "lineStep"].map((name, at) => `<input type="hidden" name="${name}[]" value="${attr(String([entry.childCode, entry.qty, entry.scrapPct ?? 0, entry.note ?? "", entry.step ?? ""][at]))}">`).join("");
    const rows = bom.lines.map((entry) => (entry.childCode === childCode
      ? `<input type="hidden" name="childCode[]" value="${attr(entry.childCode)}"><input type="hidden" name="lineStep[]" value="${attr(String(entry.step ?? ""))}"><input type="hidden" name="origQty" value="${attr(String(entry.qty))}">
        <div class="rf-grid rf-g2">${ui.field(`ใช้ต่อ 1 ${uomText(ctx, parent.uom)} (${uomText(ctx, child.uom)})`, ui.input("qty[]", { type: "number", step: "any", min: "0.000001", required: true, value: String(Math.round(entry.qty * 1e6) / 1e6) }), { required: true })}${ui.field("เผื่อเสีย (%)", ui.input("scrapPct[]", { type: "number", step: "any", min: 0, value: String(entry.scrapPct ?? 0) }))}</div>
        ${ui.field("หมายเหตุของบรรทัด", ui.input("lineNote[]", { value: entry.note ?? "", extra: 'maxlength="200"' }))}`
      : hiddenOf(entry))).join("");
    const body = `<form novalidate id="bom-line-form" data-rf-form="saveBom" data-rf-args="${attr(JSON.stringify({ itemCode: parent.code, editCode: childCode }))}" data-rf-success="${attr(`บันทึก BOM ของ ${parent.code} แล้ว`)}">
      <p class="muted small">${esc(`${child.name} ใน ${parent.name}`)}</p>${rows}
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { placeholder: "เช่น ปรับตามผลผลิตจริง", extra: 'maxlength="300"' }))}</form>`;
    return { html: ui.dialog("lineEdit", `แก้บรรทัด ${rules.canonicalCode(childCode)}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-line-form">บันทึก</button>` }) };
  };

  // dialog: เพิ่มส่วนประกอบหนึ่งบรรทัดใต้ชิ้นแม่ · เลือกรหัสจากทะเบียน หรือพิมพ์รหัสใหม่แล้วกรอกชื่อ ชนิด หน่วย เพื่อสร้างชิ้นใหม่ในคราวเดียว
  // ส่งด้วยคำสั่ง saveBomTree เดิม (module-bom.js ประกอบบรรทัดเดิมของ BOM จากข้อมูลล่าสุดตอนกดบันทึก แล้วต่อบรรทัดใหม่) BOM ของชิ้นลูกเดิมไม่ถูกแตะ
  dialogs.lineAdd = (ctx, { parentCode }) => {
    const { ui, rules, data } = ctx;
    const parent = itemOf(ctx, parentCode);
    if (!parent || ctx.helpers.NO_BOM_KINDS.includes(parent.kind)) return null;
    const used = new Set((approvedBomOf(ctx, parent.code)?.lines ?? []).map((line) => line.childCode));
    const choices = data.items.filter((entry) => entry.active !== false && entry.code !== parent.code && !used.has(entry.code) && !rules.childKindError(parent.kind, entry.kind));
    const kinds = Object.entries(rules.KINDS).filter(([kind]) => kind !== "FG" && !rules.childKindError(parent.kind, kind)).map(([value, meta]) => ({ value, label: meta.label }));
    const uoms = Object.entries(rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
    const body = `<form novalidate id="bom-add-form" data-rf-form="saveBomTree" data-rf-args="${attr(JSON.stringify({ lineAdd: true, code: parent.code }))}" data-rf-success="{result}">
      <p class="muted small">${esc(`เพิ่มใน ${parent.name}`)}</p>
      ${ui.field("รหัสส่วนประกอบ", ui.input("addCode", { list: "bom-add-list", required: true, placeholder: "พิมพ์รหัสหรือชื่อเพื่อค้นหา", extra: 'autocapitalize="characters" autocomplete="off" data-add-code' }), { required: true })}
      <datalist id="bom-add-list">${choices.slice(0, ADD_LIST_LIMIT).map((entry) => `<option value="${attr(entry.code)}">${esc(entry.name.slice(0, 60))}</option>`).join("")}</datalist>
      <div class="rf-grid rf-g2">${ui.field(`ใช้ต่อ 1 ${uomText(ctx, parent.uom)}`, ui.input("addQty", { type: "number", step: "any", min: "0.000001", required: true }), { required: true })}${ui.field("เผื่อเสีย (%)", ui.input("addScrap", { type: "number", step: "any", min: 0, value: "0" }))}</div>
      <fieldset class="bom-add-new" data-add-new hidden><legend>รหัสนี้ยังไม่มีในทะเบียน กรอกเพื่อสร้างชิ้นใหม่</legend>
        ${ui.field("ชื่อ", ui.input("newName", { extra: 'maxlength="200"' }), { required: true })}
        <div class="rf-grid rf-g2">${ui.field("ชนิด", ui.select("newKind", kinds, { value: kinds[0]?.value ?? "" }))}${ui.field("หน่วย", ui.select("newUom", uoms, { value: "pcs" }))}</div>
      </fieldset>
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' }))}</form>`;
    const bind = (dialog) => {
      const codeInput = dialog.querySelector("[data-add-code]");
      const fresh = dialog.querySelector("[data-add-new]");
      if (!codeInput || !fresh) return;
      const sync = () => { const code = rules.canonicalCode(codeInput.value); fresh.hidden = !code || Boolean(ctx.helpers.itemOf(ctx.store.data(), code)); };
      codeInput.addEventListener("input", sync);
      codeInput.addEventListener("change", sync);
    };
    return { html: ui.dialog("lineAdd", "เพิ่มส่วนประกอบ", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-add-form">เพิ่ม</button>` }), bind };
  };

  // dialog: สร้างสินค้า/ชิ้นงานใหม่ (รหัส ชื่อ ชนิด หน่วย) ด้วยคำสั่ง saveItem เดิม แล้วเปิดหน้าของรายการนั้นเพื่อเพิ่มส่วนประกอบต่อ
  dialogs.productNew = (ctx) => {
    const { ui, rules } = ctx;
    const kinds = Object.entries(rules.KINDS).filter(([kind]) => !ctx.helpers.NO_BOM_KINDS.includes(kind)).map(([value, meta]) => ({ value, label: meta.label }));
    const uoms = Object.entries(rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
    const body = `<form novalidate id="bom-new-form" data-rf-form="saveItem" data-rf-args="${attr(JSON.stringify({ create: true }))}" data-rf-success="สร้างรายการแล้ว เพิ่มส่วนประกอบได้เลย">
      ${ui.field("รหัส", ui.input("code", { required: true, placeholder: "เช่น MEGA-ST-01(P)-Y", extra: 'autocapitalize="characters" autocomplete="off" maxlength="60" data-new-code' }), { required: true })}
      ${ui.field("ชื่อ", ui.input("name", { required: true, extra: 'maxlength="200"' }), { required: true })}
      <div class="rf-grid rf-g2">${ui.field("ชนิด", ui.select("kind", kinds, { value: "FG" }))}${ui.field("หน่วย", ui.select("uom", uoms, { value: "set" }))}</div></form>
      <p class="small muted">มีข้อมูลหลายบรรทัดอยู่ใน Excel แล้ว ใช้ ${ui.link("ตารางสร้างหลายบรรทัด", ctx.url("build"))} หรือ ${ui.link("นำเข้าจาก Excel", ctx.url("import"))}</p>`;
    const bind = (dialog) => {
      // บันทึกสำเร็จ (รายการอยู่ในข้อมูลแล้ว) ไปหน้าของรายการนั้น · ไม่สำเร็จอยู่ที่ dialog เดิมพร้อมข้อความแจ้ง
      dialog.querySelector("#bom-new-form")?.addEventListener("submit", () => {
        const code = rules.canonicalCode(dialog.querySelector("[data-new-code]")?.value ?? "");
        if (code && ctx.helpers.itemOf(ctx.store.data(), code)) location.hash = ctx.url("find", { code });
      });
    };
    return { html: ui.dialog("productNew", "สร้างสินค้าใหม่", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-new-form">สร้าง</button>` }), bind };
  };

  // ---------- ใบสั่งผลิต: แถบ 5 ขั้นและแผงของขั้นที่กำลังดู (หน้า orders เรียกใช้) ----------
  const STEPS = Object.freeze([
    { no: 1, label: "รายการสินค้า", who: "ฝ่ายวางแผน" },
    { no: 2, label: "ตรวจของ", who: "ฝ่ายวางแผน และคลังวัตถุดิบ" },
    { no: 3, label: "ปล่อยผลิต", who: "ฝ่ายวางแผน" },
    { no: 4, label: "ผลิตตามแผนก", who: "ทุกแผนก" },
    { no: 5, label: "ปิดใบ", who: "ฝ่ายวางแผน" },
  ]);
  // ขั้นปัจจุบันคำนวณจากสถานะของใบ (ไม่มีช่องเก็บแยก): ร่างไม่มีสินค้า = 1 · ร่างมีสินค้า = 2 · ปล่อยแล้ว = 4 · งานเสร็จครบ/ปิดแล้ว = 5
  function orderStepOf(ctx, order) {
    if (order.status === "cancelled") return 0;
    if (order.status === "completed") return 6;
    if (order.status === "draft") return order.items.length ? 2 : 1;
    const jobs = ctx.data.jobs.filter((job) => job.orderId === order.id);
    return jobs.length && jobs.every((job) => job.status === "done") ? 5 : 4;
  }
  // ของซื้อของใบร่าง: กติกาเดียวกับหน้าต่างสั่งซื้อ (rules.partNeeds: ต้องใช้ เทียบ คงเหลือ − ใบอื่นจอง + สั่งค้างรับ ปัดขึ้น 3 ตำแหน่ง) จึงได้ตัวเลขเดียวกันทั้งสองที่
  // ใบสั่งซื้ออยู่ที่ RubberFlow: ยังโหลดไม่เสร็จ = ยังไม่นับของสั่งค้างรับ (หน้าวาดใหม่เองเมื่อโหลดเสร็จ)
  function draftPartRows(ctx, order) {
    const purchaseOrders = pages.tools?.purchaseOrdersOf?.(ctx) ?? [];
    return ctx.rules.partNeeds({ jobs: ctx.data.jobs, orders: ctx.data.orders, stock: ctx.data.stock ?? [], purchaseOrders }, order.id).rows
      .map((row) => ({ itemCode: row.itemCode, name: row.name, uom: row.uom, required: row.needQty, onHand: row.onHandQty, held: row.reservedQty, onOrder: row.onOrderQty, short: row.shortage }))
      .sort((a, b) => (b.short > 0) - (a.short > 0) || a.itemCode.localeCompare(b.itemCode));
  }
  // สั่งซื้อของที่ขาดของใบร่างได้เมื่อข้อมูลอยู่ในฐานข้อมูล (ใบสั่งซื้อเป็นของ RubberFlow) และผู้ใช้เป็นฝ่ายวางแผนหรือแผนก RB (เงื่อนไขเดียวกับปุ่มตรวจวัตถุดิบของใบที่ปล่อยแล้ว)
  const canBuyParts = (ctx) => Boolean(ctx.store?.isRemote?.() && ctx.rubberflow() && ctx.helpers.canLinkRubberflow(ctx.user, { dept: "RB" }));
  pages.orderSteps = (ctx, order, { net, buttons }) => {
    const { ui, rules, data, params } = ctx;
    const current = orderStepOf(ctx, order);
    const canPlan = ctx.helpers.canPlan(ctx.user);
    // ใบร่างที่มีสินค้าแล้ว: ดูขั้น 2 หรือ 3 ได้ (step=3 จากปุ่ม "ไปขั้นปล่อยผลิต") · สถานะอื่นดูขั้นปัจจุบันเท่านั้น
    const view = current === 2 && params.get("step") === "3" ? 3 : current;
    const stepUrl = (no) => ctx.url("orders", { sel: order.id, step: no === 3 ? "3" : null });
    const bar = `<ol class="bom-steps" aria-label="ขั้นตอนของใบสั่งผลิต">${STEPS.map((step) => {
      const state = current === 0 ? "off" : step.no < Math.max(current, view) ? "done" : step.no === view ? "now" : "todo";
      const inner = `<span class="bom-step-no">${state === "done" ? "เสร็จ" : `ขั้น ${step.no}`}</span><strong>${esc(step.label)}</strong><span class="small">${esc(step.who)}</span>`;
      const link = current === 2 && [2, 3].includes(step.no) && step.no !== view;
      return `<li class="bom-step is-${state}"${state === "now" ? ' aria-current="step"' : ""}>${link ? `<a href="${attr(stepUrl(step.no))}">${inner}</a>` : `<div>${inner}</div>`}</li>`;
    }).join("")}</ol>`;
    let panel = "";
    if (current === 0) panel = ui.callout("warn", `ใบนี้ถูกยกเลิก${order.cancelReason ? `: ${esc(order.cancelReason)}` : ""}`);
    else if (view === 1) panel = ui.card(`<p>เพิ่มสินค้าที่ลูกค้าสั่งลงในใบ แล้วระบบจะพาไปขั้นตรวจของ</p><div class="rf-row">${buttons.add ?? ""}</div>`, { title: "ขั้น 1 · รายการสินค้า" });
    else if (view === 2) {
      if (!order.explosion?.length) panel = ui.card(`<p>ยังไม่ได้คำนวณว่าใบนี้ต้องใช้อะไรเท่าไร</p><div class="rf-row">${buttons.explode ?? ""}</div>`, { title: "ขั้น 2 · ตรวจของ" });
      else {
        const parts = draftPartRows(ctx, order);
        const short = parts.filter((row) => row.short > 0);
        const anyHeld = parts.some((row) => row.held > 0);
        const anyOnOrder = parts.some((row) => row.onOrder > 0);
        const rowHtml = (row) => `<tr${row.short > 0 ? ' class="bom-short"' : ""}><td><strong>${esc(row.name)}</strong><div class="rf-mono small muted">${esc(row.itemCode)}</div></td><td class="right">${esc(`${rules.fmtQty(row.required)} ${uomText(ctx, row.uom)}`)}</td><td class="right">${esc(rules.fmtQty(row.onHand))}</td>${anyHeld ? `<td class="right">${esc(rules.fmtQty(row.held))}</td>` : ""}${anyOnOrder ? `<td class="right">${esc(rules.fmtQty(row.onOrder))}</td>` : ""}<td class="right">${row.short > 0 ? `<strong class="bom-short-text">ขาด ${esc(`${rules.fmtQty(row.short)} ${uomText(ctx, row.uom)}`)}</strong>` : '<span class="bom-ok-text">พอ</span>'}</td></tr>`;
        const headCells = ["ของซื้อ", { label: "ต้องใช้", className: "right" }, { label: "มีในคลัง", className: "right" }, ...(anyHeld ? [{ label: "ใบอื่นจองไว้", className: "right" }] : []), ...(anyOnOrder ? [{ label: "สั่งแล้วรอรับ", className: "right" }] : []), { label: "ผล", className: "right" }];
        const enough = parts.filter((row) => row.short <= 0);
        const table = parts.length ? `${short.length || enough.length <= 5 ? ui.table(headCells, (short.length ? short : enough).map(rowHtml)) : ""}${short.length && enough.length ? `<details class="bom-more"><summary>ดูอีก ${enough.length} รายการที่พอ</summary>${ui.table(headCells, enough.map(rowHtml))}</details>` : !short.length && enough.length > 5 ? `<details class="bom-more"><summary>ดูทั้ง ${enough.length} รายการ</summary>${ui.table(headCells, enough.map(rowHtml))}</details>` : ""}` : ui.empty("ใบนี้ไม่มีของซื้อ");
        const counted = Object.keys(order.stockCounts ?? {}).length;
        const wip = `<div class="bom-step-line"><div><strong>ชิ้นงานค้างในไลน์ที่ใช้แทนได้</strong><div class="small muted">${counted ? esc(`กรอกยอดแล้ว ${counted} รายการ ระบบหักออกจากยอดที่ต้องผลิต`) : "ยังไม่ได้กรอก ถ้าไม่กรอก ระบบสั่งผลิตเต็มจำนวน"}</div></div>${ctx.helpers.canCount(ctx.user) ? ui.link(counted ? "แก้ยอดที่กรอก" : "กรอกยอดที่มีอยู่", ctx.url("count", { order: order.id }), "btn rf-btn secondary") : ""}</div>`;
        // สั่งซื้อส่วนที่ขาดได้ตั้งแต่ใบยังเป็นร่าง (หน้าต่างสั่งซื้อเดียวกับหลังปล่อยผลิต ผู้ที่สั่งซื้อได้ = ฝ่ายวางแผนหรือแผนก RB) · ใช้ได้เมื่อข้อมูลอยู่ในฐานข้อมูล (ใบสั่งซื้อเป็นของ RubberFlow)
        const canBuy = short.length && canBuyParts(ctx);
        const buy = canBuy ? `<div class="rf-row bom-step-next"><button class="btn rf-btn" type="button" data-bom-rf-check data-bom-order="${attr(order.id)}" data-bom-wos="[]">สั่งซื้อส่วนที่ขาด</button></div>` : "";
        panel = ui.card(`${table}${buy}${wip}<div class="rf-row bom-step-next">${buttons.explode ? buttons.explode.replace("ระเบิด BOM", "คำนวณใหม่") : ""}${canPlan ? ui.link("ไปขั้น 3 ปล่อยผลิต", stepUrl(3), "btn rf-btn") : ""}</div>`,
          { title: `ขั้น 2 · ตรวจของ <span class="muted">${parts.length ? (short.length ? `ของซื้อขาด ${short.length} จาก ${parts.length} รายการ` : `ของซื้อพอทั้ง ${parts.length} รายการ`) : ""}</span>` });
      }
    } else if (view === 3) {
      const entries = [...net.values()].filter((entry) => (entry.toMake ?? entry.required) > 0);
      const made = entries.filter((entry) => entry.kind !== "PURCHASED" && entry.kind !== "CP");
      const partCount = entries.filter((entry) => entry.kind === "PURCHASED").length;
      const byDept = rules.FLOW_DEPTS.filter((dept) => dept !== "ST").map((dept) => [dept, made.filter((entry) => entry.dept === dept).length]).filter(([, count]) => count);
      const short = order.explosion?.length ? draftPartRows(ctx, order).filter((row) => row.short > 0) : [];
      const noBom = [...new Set((order.explosion ?? []).filter((line) => line.noBom).map((line) => line.itemCode))];
      const list = `<dl class="bom-release-list">${partCount ? `<dt>${deptChip(ctx, "ST")} ${esc(deptName(ctx, "ST"))}</dt><dd>เบิกของ ${partCount} รายการ</dd>` : ""}${byDept.map(([dept, count]) => `<dt>${deptChip(ctx, dept)} ${esc(deptName(ctx, dept))}</dt><dd>${count} งาน</dd>`).join("")}</dl>`;
      const warns = [
        !order.explosion?.length ? ui.callout("warn", "ยังไม่ได้คำนวณของที่ต้องใช้ กลับไปขั้น 2 ก่อน") : "",
        noBom.length ? ui.callout("bad", `ปล่อยผลิตไม่ได้ ชิ้นงานที่ยังไม่มี BOM: ${noBom.map((code) => ui.link(code, ctx.url("find", { code }), "rf-mono")).join(", ")}`) : "",
        short.length ? ui.callout("warn", `ของซื้อยังขาด ${short.length} รายการและยังไม่ได้สั่ง ปล่อยผลิตได้ แต่แผนกที่ใช้ของนั้นจะติดจนกว่าของจะเข้า${canBuyParts(ctx) ? ` · ${ui.link("กลับไปสั่งซื้อที่ขั้น 2", stepUrl(2))}` : ""}`) : "",
      ].join("");
      panel = ui.card(`${warns}${order.explosion?.length ? `<p>ปล่อยผลิตแล้วระบบสร้างงานให้แต่ละแผนกตามนี้ และล็อกฉบับ BOM ที่ใช้</p>${list}` : ""}<div class="rf-row bom-step-next">${ui.link("กลับไปขั้น 2", stepUrl(2), "btn rf-btn secondary")}${noBom.length || !order.explosion?.length ? "" : buttons.release ?? ""}</div>`, { title: "ขั้น 3 · ปล่อยผลิต" });
    } else if (view === 4 || view === 5) {
      const jobs = data.jobs.filter((job) => job.orderId === order.id);
      const rows = rules.FLOW_DEPTS.map((dept) => {
        const mine = jobs.filter((job) => job.dept === dept);
        if (!mine.length) return "";
        const done = mine.filter((job) => job.status === "done").length;
        const late = mine.filter((job) => job.status !== "done" && job.dueAt < ctx.now).length;
        const text = dept === "ST" && mine.every((job) => ctx.helpers.isPartJob(job)) ? (done === mine.length ? `เบิกของครบ ${mine.length} รายการ` : `รอเบิกของ ${mine.length - done} จาก ${mine.length} รายการ`) : `เสร็จ ${done} จาก ${mine.length} งาน`;
        return `<tr><td>${deptChip(ctx, dept)} ${esc(deptName(ctx, dept))}</td><td class="rf-progress-cell">${ui.progress(done, mine.length)}<div class="small muted">${esc(text)}</div></td><td>${late ? ui.badge("bad", `เลยกำหนด ${late} งาน`) : ""}</td><td class="right">${ctx.canSee("work") && (canPlan || ctx.user?.dept === dept) ? ui.link("ดูงาน", ctx.url("work", { dept, order: order.id }), "btn rf-btn secondary small") : ""}</td></tr>`;
      }).filter(Boolean);
      const main = view === 5 ? `<p>ทุกแผนกทำงานเสร็จแล้ว ตรวจว่าสินค้าเข้าคลังครบ แล้วปิดใบ</p><div class="rf-row bom-step-next">${buttons.complete ?? ""}</div>` : `<div class="rf-row bom-step-next">${buttons.issue ?? ""}${buttons.check ?? ""}</div>`;
      panel = ui.card(`${ui.table(["แผนก", "ความคืบหน้า", "", ""], rows, { emptyText: "ยังไม่มีงาน" })}${main}`, { title: view === 5 ? "ขั้น 5 · ปิดใบ" : "ขั้น 4 · ผลิตตามแผนก", flush: false });
    } else if (current === 6) panel = ui.callout("info", "ใบนี้ปิดแล้ว");
    // used = ปุ่มที่แผงของขั้นนี้แสดงแล้ว (หรือเป็นของขั้นอื่นของใบร่าง) หน้า orders จะไม่วางซ้ำใน "คำสั่งอื่น" · ปิดใบก่อนงานเสร็จครบยังทำได้จาก "คำสั่งอื่น"
    const used = ["add", "explode", "release", ...(view === 4 ? ["issue", "check"] : view === 5 ? ["complete"] : [])];
    return { html: `${bar}${panel}`, used };
  };

  // ---------- งานของฉัน: การ์ดงานของแผนกตัวเอง ปุ่มหลักปุ่มเดียวต่องาน ----------
  const JOB_TONE = Object.freeze({ in_progress: ["now", "กำลังทำ"], queued: ["", "รอคิว"], hold: ["hold", "พักงาน"], done: ["done", "เสร็จ"] });
  pages.work = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const planner = ctx.helpers.canPlan(user);
    const own = rules.DEPTS.includes(user?.dept) ? user.dept : null;
    const depts = rules.FLOW_DEPTS.filter((dept) => rules.DEPTS.includes(dept));
    // ฝ่ายวางแผน/ผู้จัดการเลือกดูทุกแผนกได้ · แผนกอื่นเห็นเฉพาะงานของแผนกตัวเอง
    const dept = planner ? ([...depts, "ALL"].includes(params.get("dept")) ? params.get("dept") : "ALL") : own;
    const show = params.get("st") === "done" ? "done" : "open";
    const orderId = String(params.get("order") ?? "").toUpperCase();
    const orderOf = (id) => data.orders.find((entry) => entry.id === id);
    const live = (job) => ["released", "in_progress", "completed"].includes(orderOf(job.orderId)?.status);
    const mine = data.jobs.filter((job) => (dept === "ALL" || job.dept === dept) && live(job) && (!orderId || job.orderId === orderId));
    const open = mine.filter((job) => job.status !== "done");
    const done = mine.filter((job) => job.status === "done");
    // จำนวนบนแท็บนับเป็นการ์ด: ของซื้อของใบเดียวกันเป็นการ์ดเดียว
    const cardCount = (jobs) => jobs.filter((job) => !ctx.helpers.isPartJob(job)).length + new Set(jobs.filter((job) => ctx.helpers.isPartJob(job)).map((job) => job.orderId)).size;
    const keep = (extra) => ctx.url("work", { dept: planner && dept !== "ALL" ? dept : null, order: orderId || null, ...extra });
    const deptTabs = planner ? ui.tabs([{ id: "ALL", label: "ทุกแผนก" }, ...depts.map((code) => ({ id: code, label: `${code} ${cardCount(data.jobs.filter((job) => job.dept === code && job.status !== "done" && live(job)))}` }))], dept, (id) => ctx.url("work", { dept: id === "ALL" ? null : id, st: show === "done" ? "done" : null, order: orderId || null })) : "";
    const showTabs = ui.tabs([{ id: "open", label: `ต้องทำ ${cardCount(open)}` }, { id: "done", label: `เสร็จแล้ว ${cardCount(done)}` }], show, (id) => keep({ st: id === "done" ? "done" : null }));
    const rank = (job) => (job.status === "in_progress" ? 0 : job.status === "hold" ? 2 : 1);
    const list = (show === "done" ? done : open).slice().sort((a, b) => rank(a) - rank(b) || a.dueAt - b.dueAt || a.id.localeCompare(b.id));
    // ของซื้อ (งานของคลังวัตถุดิบ): รวมเป็นการ์ดเดียวต่อใบ เพราะเบิกจ่ายครั้งเดียวทั้งใบที่หน้าใบสั่งผลิต
    const partGroups = new Map();
    const cards = [];
    for (const job of list) {
      if (ctx.helpers.isPartJob(job)) {
        if (!partGroups.has(job.orderId)) { partGroups.set(job.orderId, []); cards.push({ parts: job.orderId, dueAt: job.dueAt }); }
        partGroups.get(job.orderId).push(job);
      } else cards.push({ job });
    }
    const dueText = (dueAt, finished) => (finished ? "" : dueAt < ctx.now ? `<span class="bom-job-late">เลยกำหนด ${esc(rules.fmtDate(dueAt))}</span>` : `<span class="muted">ส่งภายใน ${esc(rules.fmtDate(dueAt))}</span>`);
    const cardHtml = (entry) => {
      if (entry.parts) {
        const jobs = partGroups.get(entry.parts);
        const order = orderOf(entry.parts);
        const finished = show === "done";
        const button = !finished && ctx.helpers.canIssueParts(user) ? ui.link("เบิกจ่ายที่ใบสั่งผลิต", ctx.url("orders", { sel: entry.parts }), "btn rf-btn bom-job-main") : ui.link("เปิดใบสั่งผลิต", ctx.url("orders", { sel: entry.parts }), "btn rf-btn secondary bom-job-main");
        return `<article class="card rf-card bom-job"><div class="bom-job-top"><span class="bom-job-state">${finished ? "เบิกแล้ว" : "รอเบิก"}</span>${dueText(Math.min(...jobs.map((job) => job.dueAt)), finished)}</div>
          <h2>${esc(`เบิกของตามใบ ${entry.parts}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${esc(order?.customer ?? "")}</p>
          <ul class="bom-job-parts">${jobs.slice(0, 6).map((job) => `<li><span>${esc(job.name)}</span><span class="nowrap">${esc(`${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`)}</span></li>`).join("")}</ul>${jobs.length > 6 ? `<p class="small muted">และอีก ${jobs.length - 6} รายการ</p>` : ""}${button}</article>`;
      }
      const job = entry.job;
      const order = orderOf(job.orderId);
      const [tone, label] = JOB_TONE[job.status] ?? ["", job.status];
      const canWork = ctx.helpers.canWorkJob(user, job) && ["released", "in_progress"].includes(order?.status) && job.status !== "done";
      const left = Math.max(0, job.qtyPlanned - job.qtyDone);
      const started = job.qtyDone > 0 || job.status === "in_progress";
      const main = canWork ? ui.openButton("รายงานผล", "jobReport", { jobId: job.id }, { className: "bom-job-main" }) : "";
      const more = [];
      if (canWork) more.push(job.status === "hold" ? ui.button("คืนคิว", { action: "setJobStatus", args: { jobId: job.id, status: "queued" }, className: "secondary small" }) : ui.button("พักงาน", { action: "setJobStatus", args: { jobId: job.id, status: "hold" }, className: "secondary small" }));
      if (job.status !== "done" && ctx.helpers.canLinkRubberflow(user, job) && ["released", "in_progress"].includes(order?.status) && !job.externalRef) more.push(ui.openButton("สร้าง WO ใน RubberFlow", "jobRubberflow", { jobId: job.id }, { className: "secondary small" }));
      if (job.externalRef) more.push(ui.link(`WO ${job.externalRef.woId}`, `#/rubberflow?p=orders&q=${encodeURIComponent(job.externalRef.woId)}`, "btn rf-btn secondary small"));
      const amount = started ? `ได้แล้ว ${rules.fmtQty(job.qtyDone)} จาก ${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}` : `ต้องได้ ${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`;
      return `<article class="card rf-card bom-job${tone ? ` is-${tone}` : ""}"><div class="bom-job-top"><span class="bom-job-state">${esc(label)}</span>${dueText(job.dueAt, job.status === "done")}</div>
        <h2>${esc(job.name)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, job.dept)} ` : ""}<span class="rf-mono">${esc(job.itemCode)}</span> · ใบ ${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId }))}</p>
        <div class="bom-job-amount"><span>${esc(amount)}</span>${started && job.status !== "done" ? `<span class="muted">เหลือ ${esc(rules.fmtQty(left))}</span>` : ""}</div>${started ? ui.progress(job.qtyDone, job.qtyPlanned, job.status === "hold" ? "bad" : "") : ""}${job.qtyReject ? `<p class="small muted">เสีย ${esc(rules.fmtQty(job.qtyReject))}</p>` : ""}
        ${main}${more.length ? `<div class="rf-row bom-job-more">${more.join("")}</div>` : ""}</article>`;
    };
    const sub = dept && dept !== "ALL" ? esc(rules.DEPT_LABEL[dept] ?? dept) : "";
    const filterNote = orderId ? `<p class="bom-back">เฉพาะใบ ${esc(orderId)} · ${ui.link("ดูทุกใบ", ctx.url("work", { dept: planner && dept !== "ALL" ? dept : null }))}</p>` : "";
    const body = !dept ? ui.card(ui.empty("บัญชีนี้ไม่ได้อยู่ในแผนกผลิต จึงไม่มีงานของตัวเอง")) : cards.length ? `<div class="bom-job-grid">${cards.map(cardHtml).join("")}</div>` : ui.card(ui.empty(show === "done" ? "ยังไม่มีงานที่เสร็จ" : "ไม่มีงานค้าง"));
    const tableLink = planner && ctx.canSee("jobs") ? ui.link("ดูเป็นตาราง", ctx.url("jobs"), "btn rf-btn secondary") : "";
    return { html: `${pageHead(ctx, "งานของฉัน", sub, tableLink)}${deptTabs}${filterNote}${dept ? showTabs : ""}${body}` };
  };

  // ---------- ข้อมูลตั้งต้น: ทางเข้าหน้าข้อมูลหลักที่ไม่ได้ใช้ทุกวัน ----------
  const SETUP_NOTE = Object.freeze({
    import: "นำเข้า BOM จากไฟล์ Excel", variants: "ชุดสีและแพ็กเกจของแต่ละสินค้า", compounds: "ผูกสูตรยางกับสูตรใน RubberFlow", customers: "รายชื่อลูกค้าของใบสั่งผลิต",
    stock: "ยอดคงเหลือและสต็อกขั้นต่ำของของซื้อ", count: "กรอกยอดชิ้นงานที่มีอยู่ของใบที่ยังเป็นร่าง", check: "รายการข้อมูลที่ยังไม่ครบ", audit: "ใครทำอะไร เมื่อไร",
  });
  pages.setup = (ctx) => {
    const store = root.MNP_BOM_STORE;
    const ids = (store?.SETUP_PAGES ?? Object.keys(SETUP_NOTE)).filter((id) => ctx.canSee(id));
    const label = (id) => store?.MODULES?.find((entry) => entry.id === id)?.label ?? id;
    const cards = ids.map((id) => `<a class="card rf-card bom-setup-card" href="${attr(ctx.url(id))}"><span class="rf-mod-ico" aria-hidden="true">${pages.icon(id)}</span><span><strong>${esc(label(id))}</strong><span class="small muted">${esc(SETUP_NOTE[id] ?? "")}</span></span></a>`).join("");
    return { html: `${pageHead(ctx, "ข้อมูลตั้งต้น")}${ids.length ? `<div class="bom-setup-grid">${cards}</div>` : ctx.ui.card(ctx.ui.empty("บัญชีนี้ไม่มีหน้าข้อมูลตั้งต้นที่เปิดได้"))}` };
  };

  pages.hub = { ratioText, orderStepOf, hubUrl };
})(typeof window !== "undefined" ? window : globalThis);
