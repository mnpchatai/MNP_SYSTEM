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
  // เพิ่มส่วนประกอบจากฟอร์มเล็ก (ทีละบรรทัด วางจาก Excel คัดลอกโครงสร้าง) ได้กับชิ้นที่มี BOM ได้ ยกเว้นเส้นยาง (RB): บรรทัดเดียวของมันคือสูตรยาง ซึ่งผูกกับช่องสูตรของเส้นยางและ RubberFlow
  // จึงแก้ที่หน้าต่าง "ข้อมูลเส้นยาง" (dialogs.rubberEdit) ที่แสดงสูตรเดิม สูตรใหม่ และให้ยืนยันก่อนบันทึก
  const canAddLineTo = (ctx, item) => Boolean(item) && !ctx.helpers.NO_BOM_KINDS.includes(item.kind) && item.kind !== "RB";

  // ช่องค้นหารายการจากทะเบียน (หลักพันรายการ): พิมพ์รหัสหรือชื่อ แสดงเฉพาะ PICK_LIMIT รายการแรกที่ตรง แตะเพื่อเลือก พิมพ์รหัสที่ไม่มีในรายการก็ได้ (ค่าในช่องคือค่าที่ส่ง)
  // รายการเป็น data-popup ในกรอบเดียวกับช่อง ปิดด้วยกฎกลาง closePopup ของ app.js (แตะหรือย้ายโฟกัสออกนอกกรอบ) ไม่ปิดจาก blur จึงแตะเลือกบน iPhone ได้ · อยู่ในแนวเอกสาร (ไม่ลอยทับ) คีย์บอร์ดมือถือจึงไม่บัง
  const PICK_LIMIT = 30;
  const pickerHtml = (ctx, name, { id, value = "", placeholder = "", required = false, extra = "" }) => `<div class="bom-pick-box">${ctx.ui.input(name, { id, value, placeholder, required, extra: `role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${attr(id)}-list" autocapitalize="characters" spellcheck="false" data-pick-input${extra ? ` ${extra}` : ""}` })}<div class="bom-pick-list" id="${attr(id)}-list" role="listbox" data-popup hidden></div></div>`;
  // options = [{ value, label, meta? }] · onChange เรียกทุกครั้งที่ค่าในช่องเปลี่ยน (พิมพ์หรือเลือก)
  function bindPicker(box, options, { onChange = () => {}, emptyText = "ไม่พบในทะเบียน" } = {}) {
    const input = box?.querySelector?.("[data-pick-input]");
    const list = box?.querySelector?.("[data-popup]");
    if (!input || !list) return;
    const index = options.map((option) => ({ ...option, text: `${option.value} ${option.label ?? ""}`.toLowerCase() }));
    let active = -1;
    const optionNodes = () => [...list.querySelectorAll("[data-pick-value]")];
    const close = () => { if (!list.hidden) root.closePopup(list); active = -1; };
    const mark = () => {
      optionNodes().forEach((node, at) => node.setAttribute("aria-selected", String(at === active)));
      const node = optionNodes()[active];
      if (node) { input.setAttribute("aria-activedescendant", node.id); node.scrollIntoView?.({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant");
    };
    const paint = () => {
      const words = String(input.value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const found = [];
      let more = false;
      for (const option of index) {
        if (!words.every((word) => option.text.includes(word))) continue;
        if (found.length >= PICK_LIMIT) { more = true; break; }
        found.push(option);
      }
      active = -1;
      list.innerHTML = found.length
        ? `${found.map((option, at) => `<button class="bom-pick-option" type="button" role="option" tabindex="-1" id="${attr(list.id)}-${at}" aria-selected="false" data-pick-value="${attr(option.value)}"><span class="rf-mono">${esc(option.value)}</span><span>${esc(option.label ?? "")}</span>${option.meta ? `<span class="small muted">${esc(option.meta)}</span>` : ""}</button>`).join("")}${more ? `<p class="small muted bom-pick-note">แสดง ${PICK_LIMIT} รายการแรก พิมพ์เพิ่มเพื่อกรอง</p>` : ""}`
        : `<p class="small muted bom-pick-note">${esc(emptyText)}</p>`;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    };
    const pick = (value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); close(); };
    input.addEventListener("input", () => { paint(); onChange(); });
    input.addEventListener("click", () => { if (list.hidden) paint(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (list.hidden) paint();
        const count = optionNodes().length;
        if (count) { active = (active + (event.key === "ArrowDown" ? 1 : -1) + count) % count; mark(); }
      } else if (event.key === "Enter" && !list.hidden && active >= 0) {
        event.preventDefault();
        pick(optionNodes()[active].dataset.pickValue);
      } else if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        close();
      } else if (event.key === "Tab" || event.key === "Enter") close();
    });
    list.addEventListener("click", (event) => {
      const option = event.target.closest?.("[data-pick-value]");
      if (option) pick(option.dataset.pickValue);
    });
  }
  const itemOptions = (ctx, items) => items.map((entry) => ({ value: entry.code, label: entry.name, meta: ctx.rules.KINDS[entry.kind]?.label ?? entry.kind }));
  const compoundOptions = (ctx) => ctx.data.compounds.map((entry) => ({ value: entry.code, label: entry.name === entry.code ? "" : entry.name, meta: entry.recipeId ? `ผูกสูตร RubberFlow ${entry.recipeId}` : "ยังไม่ผูกสูตร RubberFlow" })).sort((a, b) => a.value.localeCompare(b.value));

  // ข้อมูลเส้นยางเป็นแถวของ ui.kv: สูตรยาง การตัด น้ำหนัก · ใช้ทั้งแผงข้างของต้นไม้และการ์ดในหน้าของเส้นยางเอง
  function rubberFacts(ctx, item) {
    const { rules, ui } = ctx;
    const r = item?.rubber ?? {};
    const compound = r.compound ? ctx.data.compounds.find((entry) => entry.code === r.compound) : null;
    const cut = [r.cutLengthCm ? `ตัดยาว ${rules.fmtQty(r.cutLengthCm)} ซม.` : "", r.pcsPerRoll ? `ได้ ${rules.fmtQty(r.pcsPerRoll)} ชิ้นต่อเส้น` : "", r.sePerGr ? `SE ${rules.fmtQty(r.sePerGr)} ชิ้นต่อ 1 GR` : ""].filter(Boolean).join(" · ");
    const weight = [r.kgPerRoll ? `${rules.fmtQty(r.kgPerRoll)} กก. ต่อเส้น` : "", item?.weightG ? `${rules.fmtQty(item.weightG)} กรัมต่อหน่วย` : ""].filter(Boolean).join(" · ");
    return [
      ["สูตรยาง", r.compound ? `<span class="rf-mono">${esc(r.compound)}</span>${compound && compound.name !== compound.code ? ` <span class="muted">${esc(compound.name)}</span>` : ""}` : ui.badge("warn", "ยังไม่ระบุ")],
      ["การตัด", cut ? esc(cut) : '<span class="muted">ยังไม่ระบุ</span>'],
      ["น้ำหนัก", weight ? esc(weight) : '<span class="muted">ยังไม่ระบุ</span>'],
    ];
  }
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
    const canAdd = canEdit && canAddLineTo(ctx, item);
    // เพิ่มทีละบรรทัดเป็นปุ่มหลัก · หลายบรรทัดในครั้งเดียวมีสองทาง: วางจาก Excel และคัดลอกโครงสร้างจากรายการอื่น (แทนตารางกว้างของหน้า "แก้หลายบรรทัด")
    const addRoot = canAdd ? `${ui.openButton("+ เพิ่มส่วนประกอบ", "lineAdd", { parentCode: item.code }, { className: "small" })}${ui.openButton("วางจาก Excel", "linesPaste", { parentCode: item.code }, { className: "secondary small" })}${ui.openButton("คัดลอกจากรายการอื่น", "treeCopy", { code: item.code }, { className: "secondary small" })}` : "";
    const stepsButton = canEdit && !ctx.helpers.NO_BOM_KINDS.includes(item.kind) ? ui.openButton("ขั้นตอนผลิต", "routingEdit", { code: item.code }, { className: "secondary small" }) : "";
    const folds = `<div class="rf-row">${rows.some((_, index) => hasChild(index)) ? `<button class="btn rf-btn secondary small" type="button" data-tree-all="open">ขยายทั้งหมด</button><button class="btn rf-btn secondary small" type="button" data-tree-all="close">ย่อทั้งหมด</button>` : ""}${addRoot}${stepsButton}</div>`;
    const isRod = item.kind === "RB";
    const emptyText = ctx.helpers.NO_BOM_KINDS.includes(item.kind) ? "รายการนี้เป็นของซื้อหรือสูตรยาง ไม่มีส่วนประกอบ" : isRod ? "เส้นยางนี้ยังไม่มีบรรทัดสูตรยางใน BOM" : "ยังไม่มี BOM";
    // จำนวนที่คำนวณอยู่ในช่อง "คำนวณสำหรับ" ที่เดียว หัวคอลัมน์จึงไม่บอกซ้ำ
    const table = ui.table([{ label: "ส่วนประกอบ" }, { label: "ใช้ต่อชิ้นแม่ 1 หน่วย", className: "right", title: "ปริมาณที่ใช้ทำชิ้นที่อยู่เหนือบรรทัดนี้ 1 หน่วย รวมเผื่อเสียแล้ว" }, { label: "ต้องใช้รวม", className: "right", title: "ปริมาณรวมสำหรับจำนวนในช่อง “คำนวณสำหรับ”" }], body, { emptyText, className: "bom-tree" });
    const warn = missing.length ? ui.callout("warn", `ไม่พบชิ้นงานในทะเบียน: ${esc(missing.join(", "))}`) : "";
    // เส้นยางเปิดหน้าของตัวเอง: สูตรและข้อมูลการตัดอยู่ในการ์ดนี้ (แก้ได้ที่ปุ่มเดียว) ต้นไม้ข้างล่างมีแค่บรรทัดสูตรยาง
    const rodCard = isRod ? ui.card(ui.kv(rubberFacts(ctx, item)), { title: "ข้อมูลเส้นยาง", actions: canEdit ? ui.openButton("แก้ข้อมูลเส้นยาง", "rubberEdit", { code: item.code }, { className: "" }) : "" }) : "";
    // แผงข้างไม่เป็น aria-live (อ่านซ้ำทั้งแผงทุกครั้งที่คลิก): โปรแกรมอ่านจอได้ยินแค่ชื่อบรรทัดที่เลือกจาก [data-tree-status] และบรรทัดที่เลือกมี aria-current
    const aside = `<aside class="card rf-card bom-tree-side" data-tree-side aria-label="รายละเอียดของบรรทัดที่เลือก"><p class="muted">เลือกบรรทัดเพื่อดูรายละเอียด</p></aside>`;
    // แถบลากระหว่างต้นไม้กับแผงรายละเอียด (จอกว้าง): ลาก หรือลูกศรซ้าย/ขวา ปรับความกว้างของแผง ดับเบิลคลิกคืนค่าเดิม · จำค่าไว้ในเบราว์เซอร์นี้
    const split = rows.length ? '<div class="bom-tree-split" role="separator" aria-orientation="vertical" tabindex="0" aria-label="ปรับความกว้างของแผงรายละเอียด" title="ลากหรือกดลูกศรซ้าย/ขวาเพื่อปรับความกว้าง ดับเบิลคลิกเพื่อคืนค่าเดิม" data-tree-split></div>' : "";
    const html = `${warn}${rodCard}<div class="bom-tree-layout" data-tree-layout><section class="card rf-card"><div class="bom-tree-bar">${qtyForm}${folds}</div>${table}<p class="sr-only" role="status" data-tree-status></p></section>${split}${rows.length ? aside : ""}</div>`;
    // รายละเอียดของบรรทัดที่เลือก (สร้างตอนคลิก ไม่วาดล่วงหน้าทุกบรรทัด)
    const detailHtml = (line) => {
      const child = itemOf(ctx, line.itemCode);
      const bomLine = approvedBomOf(ctx, line.parentCode)?.lines.find((entry) => entry.childCode === line.itemCode);
      const children = approvedBomOf(ctx, line.itemCode)?.lines ?? [];
      const steps = (ctx.helpers.routingOf(ctx.data, line.itemCode)?.steps ?? []).map((step) => ctx.helpers.processOf(ctx.data, step.processCode)?.name ?? step.processCode);
      const usedIn = ctx.data.boms.filter((bom) => bom.status === "approved" && bom.itemCode !== line.parentCode && bom.lines.some((entry) => entry.childCode === line.itemCode)).map((bom) => bom.itemCode);
      const rod = child?.kind === "RB";
      const facts = ui.kv([
        ["แผนกที่ทำ", esc(rules.DEPT_LABEL[line.producerDept] ?? line.producerDept)],
        bomLine ? [`ใช้ต่อ 1 ${uomText(ctx, uomOf(line.parentCode))}`, esc(`${rules.fmtQty(bomLine.qty)} ${uomText(ctx, line.uom)}`)] : null,
        bomLine?.scrapPct ? ["เผื่อเสีย", esc(`${rules.fmtNum(bomLine.scrapPct)} %`)] : null,
        bomLine?.step ? ["เข้าที่ขั้นผลิตที่", esc(String(bomLine.step))] : null,
        bomLine?.note ? ["หมายเหตุ", esc(bomLine.note)] : null,
        ...(rod ? rubberFacts(ctx, child) : []),
        // เส้นยาง: ลูกเดียวคือสูตรยางซึ่งอยู่ในแถว "สูตรยาง" แล้ว
        children.length && !rod ? ["ทำจาก", children.map((entry) => esc(itemOf(ctx, entry.childCode)?.name ?? entry.childCode)).join("<br>")] : null,
        steps.length ? ["ขั้นตอน", esc(steps.join(" → "))] : null,
        ["ใช้ในรายการอื่น", usedIn.length ? `${usedIn.slice(0, 5).map((code) => ui.link(code, ctx.url("find", { code }), "rf-mono")).join(", ")}${usedIn.length > 5 ? ` และอีก ${usedIn.length - 5}` : ""}` : '<span class="muted">ไม่มี</span>'],
      ]);
      // ลบบรรทัด = บันทึก BOM ของชิ้นแม่ใหม่โดยไม่มีบรรทัดนี้ (saveBom เดิม ได้ฉบับแก้ไขใหม่) · BOM ต้องเหลืออย่างน้อย 1 บรรทัด จึงไม่มีปุ่มลบที่บรรทัดสุดท้าย
      const siblings = approvedBomOf(ctx, line.parentCode)?.lines ?? [];
      const rest = siblings.filter((entry) => entry.childCode !== line.itemCode).map((entry) => ({ childCode: entry.childCode, qty: entry.qty, scrapPct: entry.scrapPct ?? 0, note: entry.note ?? "", step: entry.step ?? "", flags: entry.flags ?? [] }));
      // เลื่อนลำดับ: บรรทัดของ BOM เรียงตามผังงานของแผนกผู้ทำ (rules.sortLinesByFlow) จึงสลับได้กับบรรทัดติดกันของแผนกเดียวกันเท่านั้น · บันทึกด้วย saveBom (ฉบับแก้ไขใหม่ "เรียงลำดับส่วนประกอบใหม่")
      const flowOf = (entry) => rules.flowStepOf(itemOf(ctx, entry.childCode)?.ownerDept ?? entry.producerDept);
      const at = siblings.findIndex((entry) => entry.childCode === line.itemCode);
      const full = (list) => list.map((entry) => ({ childCode: entry.childCode, qty: entry.qty, scrapPct: entry.scrapPct ?? 0, note: entry.note ?? "", step: entry.step ?? "", flags: entry.flags ?? [] }));
      const swapped = (other) => { const list = siblings.slice(); [list[at], list[other]] = [list[other], list[at]]; return full(list); };
      const moveButton = (label, other) => (canEdit && bomLine && other >= 0 && other < siblings.length && flowOf(siblings[other]) === flowOf(siblings[at])
        ? ui.button(label, { action: "saveBom", args: { itemCode: line.parentCode, lines: swapped(other), note: `เรียงลำดับ ${line.itemCode}` }, className: "secondary", success: `เรียงลำดับ ${line.itemCode} แล้ว` }) : "");
      // บรรทัดสูตรยางใต้เส้นยางแก้ที่ "แก้ข้อมูลเส้นยาง" ของเส้นยางนั้น (ช่องสูตรและบรรทัดต้องตรงกัน) จึงไม่มีปุ่มแก้/ลบบรรทัดที่นี่
      const underRod = itemOf(ctx, line.parentCode)?.kind === "RB";
      const buttons = [
        canEdit && bomLine && !underRod ? ui.openButton("แก้บรรทัดนี้", "lineEdit", { parentCode: line.parentCode, childCode: line.itemCode }, { className: "" }) : "",
        canEdit && rod ? ui.openButton("แก้ข้อมูลเส้นยาง", "rubberEdit", { code: line.itemCode }, { className: "secondary" }) : "",
        canEdit && underRod ? ui.openButton("แก้ข้อมูลเส้นยาง", "rubberEdit", { code: line.parentCode }, { className: "" }) : "",
        canEdit && canAddLineTo(ctx, child) ? ui.openButton("+ ส่วนประกอบข้างใน", "lineAdd", { parentCode: line.itemCode }, { className: "secondary" }) : "",
        // แทรกชิ้นงานระหว่างทาง (WIP) คั่นระหว่างชิ้นแม่กับบรรทัดนี้ · ใต้เส้นยางแทรกไม่ได้ (ลูกของเส้นยางเป็นสูตรยางเท่านั้น)
        canEdit && bomLine && canAddLineTo(ctx, itemOf(ctx, line.parentCode)) ? ui.openButton("แทรก WIP คั่น", "wipInsert", { parentCode: line.parentCode, childCode: line.itemCode }, { className: "secondary" }) : "",
        canEdit && child && !ctx.helpers.NO_BOM_KINDS.includes(child.kind) ? ui.openButton(steps.length ? "แก้ขั้นตอน" : "+ ขั้นตอน", "routingEdit", { code: line.itemCode }, { className: "secondary" }) : "",
        moveButton("เลื่อนขึ้น", at - 1),
        moveButton("เลื่อนลง", at + 1),
        // ย้ายบรรทัดนี้ (พร้อมส่วนประกอบข้างใน) ไปอยู่ใต้ชิ้นอื่นของโครงสร้างนี้ · ชิ้นแม่เดิมต้องเหลืออย่างน้อย 1 บรรทัด
        canEdit && bomLine && !underRod && siblings.length > 1 ? ui.openButton("ย้ายไปใต้ชิ้นอื่น", "lineMove", { rootCode: item.code, parentCode: line.parentCode, childCode: line.itemCode }, { className: "secondary" }) : "",
        canEdit && child ? ui.openButton("แก้ชื่อ / หน่วย", "itemEdit", { code: line.itemCode }, { className: "secondary" }) : "",
        ui.link("เปิดหน้าของรายการนี้", ctx.url("find", { code: line.itemCode }), "btn rf-btn secondary"),
        canEdit && bomLine && rest.length && !underRod ? ui.button("ลบบรรทัดนี้", { action: "saveBom", args: { itemCode: line.parentCode, lines: rest, note: `ลบ ${line.itemCode}` }, className: "secondary", confirmText: `ลบ ${line.name} ออกจาก ${itemOf(ctx, line.parentCode)?.name ?? line.parentCode}?`, success: `ลบ ${line.itemCode} ออกจาก BOM ของ ${line.parentCode} แล้ว` }) : "",
      ].join("");
      return `<h2 class="bom-side-title">${esc(line.name)}</h2><p class="rf-mono small muted">${esc(line.itemCode)}</p>${facts}<div class="rf-row">${buttons}</div>`;
    };
    const bind = (rootNode) => {
      rootNode.querySelector("[data-hub-qty]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = Number(new FormData(event.currentTarget).get("qty"));
        location.hash = ctx.url("find", { code: item.code, qty: value > 0 ? String(value) : null });
      });
      bindSplit(rootNode);
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
        all().forEach((row) => {
          row.classList.toggle("is-selected", row === tr);
          const pick = row.querySelector("[data-tree-pick]");
          if (row === tr) pick?.setAttribute("aria-current", "true"); else pick?.removeAttribute("aria-current");
        });
        const side = rootNode.querySelector("[data-tree-side]");
        if (!side) return;
        const line = rows[Number(tr.dataset.index)];
        side.innerHTML = detailHtml(line);
        const status = rootNode.querySelector("[data-tree-status]");
        if (status) status.textContent = `แสดงรายละเอียดของ ${line.name}`;
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
    return { html, bind, detailHtml: (index) => detailHtml(rows[index]) };
  }

  // แท็บประวัติ: ข้อมูลของรายการ + ฉบับแก้ไขของ BOM
  function historyTab(ctx, item) {
    const { ui, rules, data } = ctx;
    const rubber = item.rubber;
    const usedIn = data.boms.filter((bom) => bom.status === "approved" && bom.lines.some((line) => line.childCode === item.code)).map((bom) => bom.itemCode);
    const facts = ui.kv([
      ["ชนิด", esc([rules.categoryOf(item.kind)?.label, rules.KINDS[item.kind]?.label ?? item.kind].filter(Boolean).join(" · "))],
      ["แผนกที่ทำ", esc(rules.DEPT_LABEL[item.ownerDept] ?? item.ownerDept)],
      item.weightG && item.kind !== "RB" ? ["น้ำหนัก", esc(`${rules.fmtQty(item.weightG)} กรัม`)] : null,
      rubber?.compound && item.kind !== "RB" ? ["สูตรยาง", esc(rubber.compound)] : null,
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
      canEdit && !leaf && item.kind !== "RB" ? `<a class="btn rf-btn secondary" href="${attr(ctx.url("build", { code: item.code }))}" title="ตารางเดิมสำหรับแก้ทุกชั้นในครั้งเดียว ลากเรียงบรรทัด หรือย้ายบรรทัดไปอยู่ใต้ชิ้นอื่น">แก้หลายบรรทัด</a>` : "",
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

  // dialog: แก้บรรทัดเดียวของ BOM (ปริมาณ เผื่อเสีย ขั้นที่ หมายเหตุ) จากหน้าสินค้า · บันทึกเป็นฉบับแก้ไขใหม่ของ BOM ตัวแม่ด้วยคำสั่ง saveBom เดิม
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
      ? `<input type="hidden" name="childCode[]" value="${attr(entry.childCode)}"><input type="hidden" name="origQty" value="${attr(String(entry.qty))}">
        <div class="rf-grid rf-g3">${ui.field(`ใช้ต่อ 1 ${uomText(ctx, parent.uom)} (${uomText(ctx, child.uom)})`, ui.input("qty[]", { type: "number", step: "any", min: "0.000001", required: true, value: String(Math.round(entry.qty * 1e6) / 1e6) }), { required: true })}${ui.field("เผื่อเสีย (%)", ui.input("scrapPct[]", { type: "number", step: "any", min: 0, value: String(entry.scrapPct ?? 0) }))}${ui.field("เข้าที่ขั้นผลิตที่", ui.input("lineStep[]", { type: "number", step: "1", min: 1, max: 20, value: String(entry.step ?? ""), placeholder: "1", extra: `title="ขั้นผลิตของ ${attr(parent.name)} ที่ชิ้นนี้เข้า 1–20 เว้นว่าง = ขั้นแรก"` }))}</div>
        ${ui.field("หมายเหตุของบรรทัด", ui.input("lineNote[]", { value: entry.note ?? "", extra: 'maxlength="200"' }))}`
      : hiddenOf(entry))).join("");
    const body = `<form novalidate id="bom-line-form" data-rf-form="saveBom" data-rf-args="${attr(JSON.stringify({ itemCode: parent.code, editCode: childCode }))}" data-rf-success="${attr(`บันทึก BOM ของ ${parent.code} แล้ว`)}">
      <p class="muted small">${esc(`${child.name} ใน ${parent.name}`)}</p>${rows}
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { placeholder: "เช่น ปรับตามผลผลิตจริง", extra: 'maxlength="300"' }))}</form>`;
    return { html: ui.dialog("lineEdit", `แก้บรรทัด ${rules.canonicalCode(childCode)}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-line-form">บันทึก</button>` }) };
  };

  // ช่องข้อมูลการตัดและน้ำหนักของเส้นยาง (ชุดเดียวกับคอลัมน์ "ข้อมูลยาง (RB)" ของตารางเดิม) · prefix = คำนำหน้าชื่อช่องของฟอร์มนั้น
  const rubberCutFields = (ctx, values = {}, { prefix = "", weightName = "weightG", weightG = "" } = {}) => {
    const { ui } = ctx;
    const number = (name, value) => ui.input(name, { type: "number", step: "any", min: 0, value: value === undefined || value === null ? "" : String(value) });
    return `<div class="rf-grid rf-g3">${ui.field("ตัดยาว (ซม.)", number(`${prefix}cutLengthCm`, values.cutLengthCm))}${ui.field("ชิ้นที่ตัดได้ต่อเส้น", number(`${prefix}pcsPerRoll`, values.pcsPerRoll))}${ui.field("SE ที่ได้ต่อ 1 GR", number(`${prefix}sePerGr`, values.sePerGr))}${ui.field("น้ำหนักเส้นยาง (กก. ต่อเส้น)", number(`${prefix}kgPerRoll`, values.kgPerRoll))}${ui.field("น้ำหนัก (กรัมต่อหน่วย)", number(weightName, weightG))}</div>`;
  };

  // dialog: เพิ่มส่วนประกอบหนึ่งบรรทัดใต้ชิ้นแม่ · ค้นหารหัสจากทะเบียน หรือพิมพ์รหัสใหม่แล้วกรอกชื่อ ชนิด หน่วย เพื่อสร้างชิ้นใหม่ในคราวเดียว (เส้นยางใหม่: สูตรยางและข้อมูลการตัดด้วย)
  // ส่งด้วยคำสั่ง saveBomTree เดิม (module-bom.js ประกอบบรรทัดเดิมของ BOM จากข้อมูลล่าสุดตอนกดบันทึก แล้วต่อบรรทัดใหม่) BOM ของชิ้นลูกเดิมไม่ถูกแตะ
  dialogs.lineAdd = (ctx, { parentCode }) => {
    const { ui, rules, data } = ctx;
    const parent = itemOf(ctx, parentCode);
    if (!canAddLineTo(ctx, parent)) return null;
    const used = new Set((approvedBomOf(ctx, parent.code)?.lines ?? []).map((line) => line.childCode));
    const choices = data.items.filter((entry) => entry.active !== false && entry.code !== parent.code && !used.has(entry.code) && !rules.childKindError(parent.kind, entry.kind));
    // ชนิดของชิ้นใหม่: ทุกชนิดที่อยู่ใต้ชิ้นแม่นี้ได้ ยกเว้นสินค้า (FG)
    const kinds = Object.entries(rules.KINDS).filter(([kind]) => kind !== "FG" && !rules.childKindError(parent.kind, kind)).map(([value, meta]) => ({ value, label: meta.label }));
    const uoms = Object.entries(rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
    const body = `<form novalidate id="bom-add-form" data-rf-form="saveBomTree" data-rf-args="${attr(JSON.stringify({ lineAdd: true, code: parent.code }))}" data-rf-success="{result}">
      <p class="muted small">${esc(`เพิ่มใน ${parent.name}`)}</p>
      ${ui.field("รหัสส่วนประกอบ", pickerHtml(ctx, "addCode", { id: "bom-add-code", required: true, placeholder: "พิมพ์รหัสหรือชื่อเพื่อค้นหา", extra: "data-add-code" }), { required: true, id: "bom-add-code" })}
      <div class="rf-grid rf-g2">${ui.field(`ใช้ต่อ 1 ${uomText(ctx, parent.uom)}`, ui.input("addQty", { type: "number", step: "any", min: "0.000001", required: true }), { required: true })}${ui.field("เผื่อเสีย (%)", ui.input("addScrap", { type: "number", step: "any", min: 0, value: "0" }))}</div>
      <fieldset class="bom-add-new" data-add-new hidden><legend>รหัสนี้ยังไม่มีในทะเบียน กรอกเพื่อสร้างชิ้นใหม่</legend>
        ${ui.field("ชื่อ", ui.input("newName", { extra: 'maxlength="160" data-add-name' }), { required: true })}
        <div class="rf-grid rf-g2">${ui.field("ชนิด", ui.select("newKind", kinds, { value: kinds[0]?.value ?? "", extra: "data-native-select data-add-kind" }))}${ui.field("หน่วย", ui.select("newUom", uoms, { value: "pcs", extra: "data-native-select data-add-uom" }))}</div>
        <div class="bom-add-rubber" data-add-rubber hidden>
          ${ui.field("สูตรยาง", pickerHtml(ctx, "rbCompound", { id: "bom-add-compound", placeholder: "พิมพ์รหัสสูตรยางเพื่อค้นหา", extra: 'maxlength="20" data-add-compound' }), { required: true, id: "bom-add-compound" })}
          ${rubberCutFields(ctx, {}, { prefix: "rb_", weightName: "rbWeightG" })}
        </div>
      </fieldset>
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' }))}</form>`;
    const bind = (dialog) => {
      const codeInput = dialog.querySelector("[data-add-code]");
      const fresh = dialog.querySelector("[data-add-new]");
      if (!codeInput || !fresh) return;
      const nameInput = dialog.querySelector("[data-add-name]");
      const kindSelect = dialog.querySelector("[data-add-kind]");
      const uomSelect = dialog.querySelector("[data-add-uom]");
      const rubberBox = dialog.querySelector("[data-add-rubber]");
      const compoundInput = dialog.querySelector("[data-add-compound]");
      let uomTouched = false;
      // ช่องของชิ้นใหม่ต้องกรอกเฉพาะตอนที่แสดง (ฟอร์มตรวจช่อง required ที่มองเห็น แล้วแจ้งเป็นภาษาไทยใต้ช่องเหมือนช่องอื่น)
      const sync = () => {
        const code = rules.canonicalCode(codeInput.value);
        fresh.hidden = !code || Boolean(ctx.helpers.itemOf(ctx.store.data(), code));
        if (nameInput) nameInput.required = !fresh.hidden;
        const rod = !fresh.hidden && kindSelect?.value === "RB";
        if (rubberBox) rubberBox.hidden = !rod;
        if (compoundInput) compoundInput.required = rod;
      };
      bindPicker(codeInput.closest(".bom-pick-box"), itemOptions(ctx, choices), { onChange: sync, emptyText: "ไม่พบในทะเบียน บันทึกเป็นรหัสใหม่ได้โดยกรอกชื่อ ชนิด และหน่วยด้านล่าง" });
      bindPicker(compoundInput?.closest(".bom-pick-box"), compoundOptions(ctx), { emptyText: "ยังไม่มีสูตรยางรหัสนี้ บันทึกแล้วระบบเพิ่มในรายการสูตรยางให้" });
      codeInput.addEventListener("change", sync);
      uomSelect?.addEventListener("change", () => { uomTouched = true; });
      // เส้นยางนับเป็นเส้น สูตรยางเป็นกิโลกรัม: ตั้งหน่วยให้ตามชนิดจนกว่าผู้ใช้จะเลือกหน่วยเอง
      kindSelect?.addEventListener("change", () => {
        const preset = { RB: "rod", CP: "kg" }[kindSelect.value];
        if (preset && uomSelect && !uomTouched) uomSelect.value = preset;
        sync();
      });
    };
    return { html: ui.dialog("lineAdd", "เพิ่มส่วนประกอบ", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-add-form">เพิ่ม</button>` }), bind };
  };

  // แถบลากปรับความกว้างของแผงรายละเอียด: ตั้ง --side-w ที่กรอบ (CSS ใช้เฉพาะจอกว้าง) · 260 px ถึง 60% ของกรอบ · ค่าที่เลือกเก็บใน localStorage ของเบราว์เซอร์นี้ (ความสะดวกของผู้ใช้ ไม่ใช่ข้อมูลงาน)
  const SIDE_KEY = "mnp-bom-side-w";
  const SIDE_MIN = 260;
  function bindSplit(rootNode) {
    const layout = rootNode.querySelector("[data-tree-layout]");
    const handle = rootNode.querySelector("[data-tree-split]");
    if (!layout || !handle) return;
    const limit = () => Math.max(SIDE_MIN, Math.round(layout.getBoundingClientRect().width * 0.6));
    const describe = (value) => { handle.setAttribute("aria-valuenow", String(value)); handle.setAttribute("aria-valuemax", String(limit())); handle.setAttribute("aria-valuetext", `แผงรายละเอียดกว้าง ${value} พิกเซล`); };
    const store = (value) => { try { root.localStorage?.setItem(SIDE_KEY, String(value)); } catch { /* เก็บไม่ได้: ใช้ได้เฉพาะรอบนี้ */ } };
    const apply = (width, save = true) => {
      const value = Math.min(limit(), Math.max(SIDE_MIN, Math.round(width)));
      layout.style.setProperty("--side-w", `${value}px`);
      describe(value);
      if (save) store(value);
      return value;
    };
    const current = () => rootNode.querySelector("[data-tree-side]")?.getBoundingClientRect().width ?? 340;
    handle.setAttribute("aria-valuemin", String(SIDE_MIN));
    const side = rootNode.querySelector("[data-tree-side]");
    if (side) { side.id ||= "bom-tree-side"; handle.setAttribute("aria-controls", side.id); }
    let stored = 0;
    try { stored = Number(root.localStorage?.getItem(SIDE_KEY)) || 0; } catch { stored = 0; }
    if (stored >= SIDE_MIN) apply(stored, false); else describe(Math.round(current()));
    handle.addEventListener("pointerdown", (event) => {
      if (event.button > 0) return;
      event.preventDefault();
      const right = layout.getBoundingClientRect().right;
      handle.setPointerCapture?.(event.pointerId);
      handle.classList.add("is-dragging");
      let last = 0;
      const move = (moveEvent) => { last = apply(right - moveEvent.clientX, false); };
      const stop = () => { if (last) store(last); handle.classList.remove("is-dragging"); handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", stop); handle.removeEventListener("pointercancel", stop); };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      apply(event.key === "Home" ? SIDE_MIN : event.key === "End" ? limit() : current() + (event.key === "ArrowLeft" ? 24 : -24));
    });
    handle.addEventListener("dblclick", () => { layout.style.removeProperty("--side-w"); describe(Math.round(current())); try { root.localStorage?.removeItem(SIDE_KEY); } catch { /* ไม่มีอะไรต้องลบ */ } });
  }

  // dialog: ย้ายบรรทัดไปอยู่ใต้ชิ้นอื่นของโครงสร้างเดียวกัน (แทนการลากย้ายชั้นในตารางกว้าง) · ตัวเลือก = ชิ้นในต้นไม้ของรายการที่เปิดอยู่ที่รับชิ้นนี้ได้
  // บันทึกด้วย saveBomTree คำสั่งเดียว (ตัวแปลง lineMove ใน module-bom.js): BOM ของชิ้นแม่เดิมและชิ้นแม่ใหม่ได้ฉบับแก้ไขใหม่พร้อมกัน ส่วนประกอบข้างในของบรรทัดที่ย้ายไม่ถูกแตะ
  dialogs.lineMove = (ctx, { rootCode, parentCode, childCode }) => {
    const { ui, rules } = ctx;
    const rootItem = itemOf(ctx, rootCode);
    const child = itemOf(ctx, childCode);
    const fromLines = approvedBomOf(ctx, parentCode)?.lines ?? [];
    if (!rootItem || !child || !ctx.helpers.canPlan(ctx.user) || fromLines.length < 2 || !fromLines.some((entry) => entry.childCode === childCode)) return null;
    const explodeOf = (code) => rules.explode(code, 1, { itemOf: (c) => itemOf(ctx, c), approvedBomOf: (c) => approvedBomOf(ctx, c) }).lines;
    const inside = new Set(explodeOf(child.code).map((entry) => entry.itemCode)); // ชิ้นนี้และทุกอย่างข้างใต้: ย้ายเข้าไปใต้ตัวเองไม่ได้
    const targets = [...new Map(explodeOf(rootItem.code).map((entry) => [entry.itemCode, itemOf(ctx, entry.itemCode)])).values()]
      .filter((entry) => canAddLineTo(ctx, entry) && entry.code !== parentCode && !inside.has(entry.code) && !rules.childKindError(entry.kind, child.kind)
        && !(approvedBomOf(ctx, entry.code)?.lines ?? []).some((line) => line.childCode === child.code));
    const options = targets.map((entry) => ({ value: entry.code, label: `${entry.name} · ${entry.code}` }));
    const body = `<form novalidate id="bom-move-form" data-rf-form="saveBomTree" data-rf-args="${attr(JSON.stringify({ lineMove: true, code: rootItem.code, fromCode: parentCode, childCode: child.code }))}" data-rf-success="{result}">
      <p class="muted small">${esc(`ย้าย ${child.name} ออกจาก ${itemOf(ctx, parentCode)?.name ?? parentCode}`)}</p>
      ${options.length ? ui.field("ย้ายไปอยู่ใต้", ui.select("toCode", options, { placeholder: "เลือกชิ้นในโครงสร้างนี้…", extra: "required" }), { required: true }) : ui.callout("warn", "ไม่มีชิ้นอื่นในโครงสร้างนี้ที่รับบรรทัดนี้ได้")}
      <p class="small muted">ปริมาณ เผื่อเสีย หมายเหตุ และส่วนประกอบข้างในของบรรทัดนี้ตามไปด้วย ปรับปริมาณต่อชิ้นแม่ใหม่ได้ที่ “แก้บรรทัดนี้” หลังย้าย</p>
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' }))}</form>`;
    return { html: ui.dialog("lineMove", `ย้าย ${child.code}`, body, { footer: `${ui.closeButton()}${options.length ? '<button class="btn rf-btn" type="submit" form="bom-move-form">ย้าย</button>' : ""}` }) };
  };

  // dialog: แทรกชิ้นงานระหว่างทาง (WIP) คั่นระหว่างชิ้นแม่กับบรรทัดที่เลือก · ชิ้นแม่ → [WIP ใหม่] → บรรทัดเดิม
  // บรรทัดเดิมย้ายไปอยู่ใต้ WIP ใหม่พร้อมปริมาณ เผื่อเสีย และหมายเหตุของมัน · บันทึกด้วย saveBomTree ในคำสั่งเดียว (ตัวแปลง wipInsert ใน module-bom.js): สร้างชิ้นใหม่ BOM ของชิ้นใหม่ และ BOM ฉบับใหม่ของชิ้นแม่
  dialogs.wipInsert = (ctx, { parentCode, childCode }) => {
    const { ui, rules } = ctx;
    const parent = itemOf(ctx, parentCode);
    const child = itemOf(ctx, childCode);
    const line = approvedBomOf(ctx, parentCode)?.lines.find((entry) => entry.childCode === childCode);
    if (!canAddLineTo(ctx, parent) || !child || !line || !ctx.helpers.canPlan(ctx.user)) return null;
    // ชนิดของ WIP: อยู่ใต้ชิ้นแม่ได้ และมีบรรทัดเดิมเป็นลูกได้ (ไม่รวมสินค้า เส้นยาง และชนิดที่ไม่มีส่วนประกอบ)
    const kinds = Object.entries(rules.KINDS).filter(([kind]) => kind !== "FG" && kind !== "RB" && !ctx.helpers.NO_BOM_KINDS.includes(kind) && !rules.childKindError(parent.kind, kind) && !rules.childKindError(kind, child.kind)).map(([value, meta]) => ({ value, label: meta.label }));
    if (!kinds.length) return null;
    const uoms = Object.entries(rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
    const body = `<form novalidate id="bom-wip-form" data-rf-form="saveBomTree" data-rf-args="${attr(JSON.stringify({ wipInsert: true, code: parent.code, childCode: child.code }))}" data-rf-success="{result}">
      <p class="muted small">${esc(`${parent.name} → ชิ้นใหม่ → ${child.name}`)}</p>
      ${ui.field("รหัสของชิ้นใหม่", ui.input("wipCode", { required: true, placeholder: "เช่น WIP-TP01-01", extra: 'autocapitalize="characters" maxlength="60"' }), { required: true })}
      ${ui.field("ชื่อ", ui.input("wipName", { required: true, extra: 'maxlength="160"' }), { required: true })}
      <div class="rf-grid rf-g3">${ui.field("ชนิด", ui.select("wipKind", kinds, { value: kinds.find((entry) => entry.value === "SUBPART")?.value ?? kinds[0].value, extra: "data-native-select" }))}${ui.field("แผนกที่ทำ", ui.select("wipDept", rules.DEPTS.map((value) => ({ value, label: rules.DEPT_LABEL[value] ?? value })), { value: parent.ownerDept, extra: "data-native-select" }))}${ui.field("หน่วย", ui.select("wipUom", uoms, { value: "pcs", extra: "data-native-select" }))}</div>
      <div class="rf-grid rf-g2">${ui.field(`ใช้ชิ้นใหม่ต่อ 1 ${uomText(ctx, parent.uom)}`, ui.input("wipQty", { type: "number", step: "any", min: "0.000001", required: true, value: "1" }), { required: true })}${ui.field(`ใช้ ${child.code} ต่อ 1 ชิ้นใหม่ (${uomText(ctx, child.uom)})`, ui.input("childQty", { type: "number", step: "any", min: "0.000001", required: true, value: String(Math.round(line.qty * 1e6) / 1e6) }), { required: true })}</div>
      <p class="small muted">ค่าตั้งต้น: ชิ้นใหม่ 1 หน่วยต่อชิ้นแม่ และใช้บรรทัดเดิมเท่าเดิม ยอดรวมจึงไม่เปลี่ยน · เพิ่มส่วนประกอบอื่นใต้ชิ้นใหม่ได้หลังบันทึก</p>
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' }))}</form>`;
    return { html: ui.dialog("wipInsert", "แทรก WIP คั่น", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-wip-form">แทรก</button>` }) };
  };

  // dialog: ข้อมูลเส้นยาง (สูตรยาง ข้อมูลการตัด น้ำหนัก) · การเปลี่ยนสูตรยางแสดงเป็นข้อความ "จาก → เป็น" พร้อมผลกระทบ และต้องติ๊กยืนยันก่อนปุ่มบันทึกจะกดได้
  // เส้นยางที่มีบรรทัดสูตรยางใน BOM ส่งด้วย saveBomTree (ช่องสูตรและบรรทัดเปลี่ยนพร้อมกัน) · ที่ยังไม่มีบรรทัด ส่งด้วย saveItem (สูตรเก็บที่ช่องสูตรอย่างเดียว) · ตัวแปลงฟอร์มใน module-bom.js ตรวจการยืนยันซ้ำ
  dialogs.rubberEdit = (ctx, { code }) => {
    const { ui, rules, data } = ctx;
    const item = itemOf(ctx, code);
    if (!item || item.kind !== "RB" || !ctx.helpers.canPlan(ctx.user)) return null;
    const r = item.rubber ?? {};
    const line = approvedBomOf(ctx, item.code)?.lines[0] ?? null;
    // สูตรเดิม = ช่องสูตรของเส้นยาง ถ้าว่าง (ข้อมูลนำเข้า) ใช้รหัสของบรรทัดสูตรยาง
    const before = rules.canonicalCode(r.compound ?? "") || (line?.childCode ?? "");
    const usedIn = data.boms.filter((bom) => bom.status === "approved" && bom.lines.some((entry) => entry.childCode === item.code)).length;
    const lineQty = line ? ui.field(`สูตรยางที่ใช้ต่อ 1 ${uomText(ctx, item.uom)} (${uomText(ctx, line.uom)})`, ui.input("compoundQty", { type: "number", step: "any", min: "0.000001", required: true, value: String(Math.round(line.qty * 1e6) / 1e6) }), { required: true }) : "";
    const body = `<form novalidate id="bom-rubber-form" data-rf-form="${line ? "saveBomTree" : "saveItem"}" data-rf-args="${attr(JSON.stringify({ rubberEdit: true, code: item.code }))}" data-rf-success="${attr(`บันทึกข้อมูลเส้นยาง ${item.code} แล้ว`)}">
      <p class="muted small">${esc(item.name)}${usedIn ? esc(` · ใช้ใน ${usedIn} รายการ แก้แล้วมีผลกับทุกรายการ`) : ""}</p>
      <div class="rf-grid rf-g2">${ui.field("สูตรยาง", pickerHtml(ctx, "compound", { id: "bom-rubber-compound", value: r.compound ?? "", required: true, placeholder: "พิมพ์รหัสสูตรยางเพื่อค้นหา", extra: 'maxlength="20" data-rubber-compound' }), { required: true, id: "bom-rubber-compound" })}${lineQty}</div>
      <p class="small muted">${usedIn ? "แก้ชิ้นที่ตัดได้ต่อเส้นแล้ว ปริมาณเส้นยางในบรรทัดของชิ้นที่ใช้เส้นนี้ไม่เปลี่ยนตาม แก้ที่บรรทัดนั้นเอง · " : ""}ช่องน้ำหนัก (กรัมต่อหน่วย) เว้นว่าง = คงค่าเดิม</p>
      <div class="rf-callout is-warn bom-compound-change" role="note" data-compound-change hidden><div class="rf-callout-body"><p data-compound-text></p><label class="bom-confirm-line"><input type="checkbox" name="confirmCompound" value="1" data-compound-confirm> <span>ยืนยันเปลี่ยนสูตรยาง</span></label></div></div>
      ${rubberCutFields(ctx, r, { weightG: item.weightG || "" })}
      ${line ? ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' })) : ""}</form>`;
    const bind = (dialog) => {
      const input = dialog.querySelector("[data-rubber-compound]");
      const box = dialog.querySelector("[data-compound-change]");
      const text = dialog.querySelector("[data-compound-text]");
      const confirm = dialog.querySelector("[data-compound-confirm]");
      const submit = dialog.querySelector("[data-rubber-submit]");
      if (!input || !box || !submit) return;
      let confirmedFor = "";
      const sync = () => {
        const next = rules.canonicalCode(input.value);
        const changed = Boolean(before) && Boolean(next) && next !== before;
        box.hidden = !changed;
        // การยืนยันเป็นของสูตรปลายทางที่แสดงตอนติ๊ก: เปลี่ยนสูตรปลายทางอีกครั้งต้องติ๊กใหม่
        if (confirm && (!changed || (confirm.checked && confirmedFor && confirmedFor !== next))) confirm.checked = false;
        confirmedFor = confirm?.checked ? next : "";
        if (changed && text) {
          const linked = data.compounds.find((entry) => entry.code === next)?.recipeId;
          text.textContent = [`เปลี่ยนสูตรยางของ ${item.code} จาก ${before} เป็น ${next}`, line ? "บรรทัดสูตรยางใน BOM ของเส้นยางนี้เปลี่ยนตาม" : "", usedIn ? `มีผลกับ ${usedIn} รายการที่ใช้เส้นยางนี้` : "", "ใบสั่งผลิตที่ปล่อยไปแล้วไม่เปลี่ยน", linked ? "" : `สูตร ${next} ยังไม่ผูกสูตร RubberFlow จึงยังเปิด WO อัตโนมัติไม่ได้`].filter(Boolean).join(" · ");
        }
        submit.disabled = changed && !confirm?.checked;
        submit.textContent = changed ? "บันทึกและเปลี่ยนสูตรยาง" : "บันทึก";
      };
      bindPicker(input.closest(".bom-pick-box"), compoundOptions(ctx), { onChange: sync, emptyText: "ยังไม่มีสูตรยางรหัสนี้ บันทึกแล้วระบบเพิ่มในรายการสูตรยางให้" });
      input.addEventListener("change", sync);
      confirm?.addEventListener("change", sync);
      sync();
    };
    return { html: ui.dialog("rubberEdit", `ข้อมูลเส้นยาง ${item.code}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-rubber-form" data-rubber-submit>บันทึก</button>` }), bind };
  };

  // dialog: วางหลายบรรทัดจาก Excel ใต้ชิ้นแม่ · ตัวอย่างบอกทีละบรรทัดว่าเป็นชิ้นเดิม ชิ้นใหม่ (กรอกชื่อ เลือกชนิดในตัวอย่างได้เลย) หรือถูกข้ามเพราะอะไร ก่อนกดเพิ่ม
  // อ่านและตรวจด้วย pages.tools.pastePlan (rules.parseBomPaste) ชุดเดียวกับตารางเดิม · บันทึกด้วย saveBomTree (ตัวแปลง linesPaste ใน module-bom.js ตรวจซ้ำกับข้อมูลล่าสุด)
  const PASTE_WORDING = Object.freeze({ "มีในตารางแล้วใต้พ่อเดียวกัน": "มีใน BOM นี้แล้ว", "เป็นพ่อของแถวที่เพิ่มใต้ จะเป็นวงจร": "เป็นรายการนี้เอง ใส่ซ้อนตัวเองไม่ได้" });
  function pastePreview(ctx, parent, text) {
    const { ui, rules } = ctx;
    const siblings = (approvedBomOf(ctx, parent.code)?.lines ?? []).map((line) => line.childCode);
    const plan = pages.tools.pastePlan(ctx, text, { parentKind: parent.kind, ancestors: [parent.code], siblings });
    // เส้นยางใหม่ต้องมีสูตรยาง ซึ่งฟอร์มวางหลายบรรทัดไม่มีช่องให้: ข้ามพร้อมบอกทางไป
    const rows = plan.rows.map((row) => (row.status === "new" && row.kind === "RB" ? { ...row, status: "error", error: "เส้นยางใหม่ เพิ่มทีละชิ้นที่ “+ เพิ่มส่วนประกอบ” (ต้องระบุสูตรยาง)" } : row.status === "error" ? { ...row, error: PASTE_WORDING[row.error] ?? row.error } : row));
    const addable = rows.filter((row) => row.status !== "error");
    const fresh = addable.filter((row) => row.status === "new").length;
    const kinds = Object.entries(rules.KINDS).filter(([kind]) => kind !== "FG" && kind !== "RB" && !rules.childKindError(parent.kind, kind)).map(([value, meta]) => ({ value, label: meta.label }));
    const hidden = (name, value) => `<input type="hidden" name="${name}[]" value="${attr(String(value ?? ""))}">`;
    const body = rows.map((row) => {
      if (row.status === "error") return `<tr class="bom-paste-skip"><td>${ui.mono(row.code || "—")}<div class="small muted">บรรทัดที่ ${esc(String(row.line))}</div></td><td></td><td>${ui.badge("bad", "ข้าม")} <span class="small">${esc(row.error)}</span></td></tr>`;
      const sent = `${hidden("pCode", row.code)}${hidden("pQty", row.qty)}${hidden("pScrap", row.scrapPct)}${hidden("pNote", row.note)}${hidden("pUom", row.uom)}`;
      const qty = `${rules.fmtQty(row.qty)} ${uomText(ctx, row.uom)}${row.scrapPct ? ` · เผื่อเสีย ${rules.fmtNum(row.scrapPct)} %` : ""}`;
      if (row.status === "known") return `<tr><td><strong>${esc(row.name)}</strong><div class="rf-mono small muted">${esc(row.code)}</div>${sent}${hidden("pName", "")}${hidden("pKind", "")}</td><td class="right">${esc(qty)}</td><td>${ui.badge("good", "ชิ้นเดิม")}${row.warn ? ` <span class="small muted">${esc(row.warn)}</span>` : ""}${row.note ? `<div class="small muted">${esc(row.note)}</div>` : ""}</td></tr>`;
      return `<tr class="bom-paste-new"><td>${ui.input("pName[]", { value: row.name, required: true, placeholder: "ชื่อของชิ้นใหม่", extra: `maxlength="160" aria-label="${attr(`ชื่อของ ${row.code}`)}" data-paste-name="${attr(row.code)}"` })}<div class="rf-mono small muted">${esc(row.code)}</div>${sent}</td><td class="right">${esc(qty)}</td><td>${ui.badge("warn", "ชิ้นใหม่")} ${ui.select("pKind[]", kinds, { value: row.kind, extra: `data-native-select aria-label="${attr(`ชนิดของ ${row.code}`)}" data-paste-kind="${attr(row.code)}"` })}</td></tr>`;
    });
    const summary = rows.length ? `<p class="bom-preview-sum"><strong>เพิ่มได้ ${addable.length} บรรทัด</strong>${fresh ? ` · เป็นชิ้นใหม่ ${fresh} (กรอกชื่อในตาราง)` : ""}${rows.length - addable.length ? ` · ข้าม ${rows.length - addable.length}` : ""}${plan.header ? " · บรรทัดแรกเป็นหัวตาราง" : ""}${plan.truncated ? " · อ่านเฉพาะ 500 บรรทัดแรก" : ""}</p>` : "";
    return { addable: addable.length, html: rows.length ? `${summary}${ui.table(["ส่วนประกอบ", { label: `ใช้ต่อ 1 ${uomText(ctx, parent.uom)}`, className: "right" }, "ผลการตรวจ"], body)}` : '<p class="small muted">ยังอ่านไม่ได้สักบรรทัด ตรวจว่าคอลัมน์แรกเป็นรหัสและคอลัมน์ที่สองเป็นปริมาณ</p>' };
  }
  dialogs.linesPaste = (ctx, { parentCode }) => {
    const { ui } = ctx;
    const parent = itemOf(ctx, parentCode);
    if (!canAddLineTo(ctx, parent) || !ctx.helpers.canPlan(ctx.user)) return null;
    const body = `<form novalidate id="bom-paste-form" data-rf-form="saveBomTree" data-rf-args="${attr(JSON.stringify({ linesPaste: true, code: parent.code }))}" data-rf-success="{result}">
      <p class="muted small">${esc(`เพิ่มหลายบรรทัดใน ${parent.name}`)}</p>
      ${ui.field("ข้อมูลที่คัดลอกจาก Excel", `<textarea class="textarea rf-textarea bom-paste-text" id="bom-paste-text" rows="5" data-paste-text placeholder="รหัส | ปริมาณ | หน่วย | % เผื่อเสีย | หมายเหตุ"></textarea>`, { id: "bom-paste-text", hint: "เลือกเซลล์ใน Excel คัดลอก แล้ววางที่นี่ · สองคอลัมน์แรกคือรหัสและปริมาณ ที่เหลือเว้นได้ · มีแถวหัวตารางหรือไม่ก็ได้" })}
      <div class="bom-preview" data-paste-preview></div>
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' }))}</form>`;
    const bind = (dialog) => {
      const area = dialog.querySelector("[data-paste-text]");
      const preview = dialog.querySelector("[data-paste-preview]");
      const submit = dialog.querySelector("[data-paste-submit]");
      if (!area || !preview || !submit) return;
      const paint = () => {
        // ชื่อและชนิดที่กรอกไว้ในตัวอย่างคงอยู่เมื่อแก้ข้อความที่วาง (จับคู่ด้วยรหัส)
        const typed = new Map([...preview.querySelectorAll("[data-paste-name]")].map((node) => [node.dataset.pasteName, { name: node.value, kind: preview.querySelector(`[data-paste-kind="${CSS.escape(node.dataset.pasteName)}"]`)?.value }]));
        const text = String(area.value ?? "");
        const built = text.trim() ? pastePreview(ctx, parent, text) : { addable: 0, html: "" };
        preview.innerHTML = built.html;
        preview.querySelectorAll("[data-paste-name]").forEach((node) => {
          const kept = typed.get(node.dataset.pasteName);
          if (!kept) return;
          if (kept.name) node.value = kept.name;
          const kind = preview.querySelector(`[data-paste-kind="${CSS.escape(node.dataset.pasteName)}"]`);
          if (kind && kept.kind) kind.value = kept.kind;
        });
        ui.labelTables?.(preview);
        submit.disabled = !built.addable;
        submit.textContent = built.addable ? `เพิ่ม ${built.addable} บรรทัด` : "เพิ่ม";
      };
      area.addEventListener("input", paint);
      paint();
    };
    return { html: ui.dialog("linesPaste", "วางจาก Excel", body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-paste-form" data-paste-submit disabled>เพิ่ม</button>` }), bind };
  };

  // dialog: คัดลอกโครงสร้างจากสินค้า/ชิ้นงานอื่นมาเป็นบรรทัดของรายการนี้ · ตัวอย่างแสดงต้นไม้ของต้นแบบ บรรทัดชั้นแรกคือสิ่งที่จะถูกเพิ่ม ชั้นข้างในตามมาเพราะเป็น BOM ของชิ้นนั้นเอง (ไม่ถูกแก้)
  // กฎของต้นแบบใช้ pages.tools.copyPlan ชุดเดียวกับ "ตั้งต้นจาก" ของตารางเดิม · บันทึกด้วย saveBomTree (ตัวแปลง treeCopy ใน module-bom.js)
  const COPY_PREVIEW_LIMIT = 120;
  function copyPreview(ctx, target, srcCode, mode) {
    const { ui, rules } = ctx;
    const code = rules.canonicalCode(srcCode);
    if (!code) return { ok: false, html: "" };
    if (!itemOf(ctx, code)) return { ok: false, html: '<p class="small muted">เลือกรายการจากผลค้นหา</p>' };
    const plan = pages.tools.copyPlan(ctx, code, target.code, target.kind);
    if (plan.error) return { ok: false, html: ui.callout("warn", esc(plan.error)) };
    const current = approvedBomOf(ctx, target.code)?.lines ?? [];
    const kept = new Set(mode === "replace" ? [] : current.map((line) => line.childCode));
    const top = plan.rows.filter((row) => row.level === 1);
    const added = top.filter((row) => !kept.has(row.code));
    const skippedIds = new Set(top.filter((row) => kept.has(row.code)).map((row) => row.id));
    const retired = added.filter((row) => plan.retired.includes(row.code)).map((row) => row.code);
    // แถวใต้บรรทัดที่ถูกข้ามไม่แสดง (ไม่มีอะไรเปลี่ยนกับมัน)
    const hiddenUnder = new Set(skippedIds);
    const shown = plan.rows.filter((row) => { if (hiddenUnder.has(row.parentId)) { hiddenUnder.add(row.id); return false; } return true; });
    const list = shown.slice(0, COPY_PREVIEW_LIMIT).map((row) => {
      const skipped = skippedIds.has(row.id);
      return `<li class="${row.level === 1 ? "is-top" : "is-inner"}${skipped ? " is-skip" : ""}" style="--lv:${Math.min(row.level - 1, 6)}"><span><span class="bom-copy-name">${esc(row.name)}</span> <span class="rf-mono small muted">${esc(row.code)}</span></span><span class="nowrap">${skipped ? ui.badge("", "มีอยู่แล้ว ข้าม") : esc(`${rules.fmtQty(row.qty)} ${uomText(ctx, row.uom)}`)}${row.inactive ? ` ${ui.badge("bad", "เลิกใช้")}` : ""}</span></li>`;
    }).join("");
    const removed = mode === "replace" ? current.length : 0;
    const summary = `<p class="bom-preview-sum"><strong>${added.length ? `เพิ่ม ${added.length} บรรทัด` : "ไม่มีบรรทัดให้เพิ่ม"}</strong>${skippedIds.size ? ` · ข้าม ${skippedIds.size} บรรทัดที่มีอยู่แล้ว` : ""}${removed ? ` · ลบบรรทัดเดิม ${removed} บรรทัด` : ""}${shown.some((row) => row.level > 1) ? " · บรรทัดที่เยื้องเข้าไปเป็นของชิ้นนั้นเอง ตามมาโดยไม่ถูกแก้" : ""}</p>`;
    const warn = retired.length ? ui.callout("bad", `${esc(retired.join(", "))} เลิกใช้แล้ว เพิ่มเป็นบรรทัดใหม่ไม่ได้ เลือกต้นแบบอื่น หรือเปิดใช้ชิ้นนั้นก่อน`) : "";
    return { ok: added.length > 0 && !retired.length, added: added.length, html: `${summary}${warn}<ul class="bom-copy-tree">${list}</ul>${shown.length > COPY_PREVIEW_LIMIT ? `<p class="small muted">และอีก ${shown.length - COPY_PREVIEW_LIMIT} บรรทัด</p>` : ""}` };
  }
  dialogs.treeCopy = (ctx, { code }) => {
    const { ui, data } = ctx;
    const target = itemOf(ctx, code);
    if (!canAddLineTo(ctx, target) || !ctx.helpers.canPlan(ctx.user)) return null;
    const current = approvedBomOf(ctx, target.code)?.lines ?? [];
    const withBom = new Set(data.boms.filter((entry) => entry.status === "approved").map((entry) => entry.itemCode));
    const sources = data.items.filter((entry) => entry.code !== target.code && entry.active !== false && canAddLineTo(ctx, entry) && withBom.has(entry.code)).sort((a, b) => a.code.localeCompare(b.code));
    const modes = [{ value: "add", label: "เก็บไว้ แล้วเพิ่มเฉพาะบรรทัดที่ยังไม่มี" }, { value: "replace", label: "ลบออก แล้วใช้ของต้นแบบแทนทั้งหมด" }];
    const body = `<form novalidate id="bom-copy-form" data-rf-form="saveBomTree" data-rf-args="${attr(JSON.stringify({ treeCopy: true, code: target.code }))}" data-rf-success="{result}">
      <p class="muted small">${esc(`คัดลอกมาใส่ใน ${target.name}`)}</p>
      ${ui.field("คัดลอกจาก", pickerHtml(ctx, "copyFrom", { id: "bom-copy-from", required: true, placeholder: "พิมพ์รหัสหรือชื่อของรายการที่มี BOM", extra: "data-copy-from" }), { required: true, id: "bom-copy-from" })}
      ${current.length ? ui.field(`ส่วนประกอบเดิม ${current.length} บรรทัดของรายการนี้`, ui.select("mode", modes, { value: "add", extra: "data-native-select data-copy-mode" })) : '<input type="hidden" name="mode" value="add">'}
      <div class="bom-preview" data-copy-preview></div>
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' }))}</form>`;
    const bind = (dialog) => {
      const input = dialog.querySelector("[data-copy-from]");
      const mode = dialog.querySelector("[data-copy-mode]");
      const preview = dialog.querySelector("[data-copy-preview]");
      const submit = dialog.querySelector("[data-copy-submit]");
      if (!input || !preview || !submit) return;
      const paint = () => {
        const built = copyPreview(ctx, target, input.value, mode?.value ?? "add");
        preview.innerHTML = built.html;
        submit.disabled = !built.ok;
        submit.textContent = built.ok ? `คัดลอก ${built.added} บรรทัด` : "คัดลอก";
      };
      bindPicker(input.closest(".bom-pick-box"), itemOptions(ctx, sources), { onChange: paint, emptyText: "ไม่พบรายการที่มี BOM ตามคำค้น" });
      input.addEventListener("change", paint);
      mode?.addEventListener("change", paint);
      paint();
    };
    return { html: ui.dialog("treeCopy", "คัดลอกโครงสร้างจากรายการอื่น", body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-copy-form" data-copy-submit disabled>คัดลอก</button>` }), bind };
  };

  // dialog: สร้างสินค้า/ชิ้นงานใหม่ (รหัส ชื่อ ชนิด หน่วย) ด้วยคำสั่ง saveItem เดิม แล้วเปิดหน้าของรายการนั้นเพื่อเพิ่มส่วนประกอบต่อ
  dialogs.productNew = (ctx) => {
    const { ui, rules } = ctx;
    const kinds = Object.entries(rules.KINDS).filter(([kind]) => !ctx.helpers.NO_BOM_KINDS.includes(kind) && kind !== "RB").map(([value, meta]) => ({ value, label: meta.label }));
    // รหัสที่มีอยู่ก่อนเปิดหน้าต่าง: ถ้าผู้ใช้พิมพ์รหัสเหล่านี้ การสร้างถูกปฏิเสธ จึงไม่พาไปหน้าของรายการเดิม (ข้อความแจ้งอยู่กับฟอร์มที่ยังเปิด)
    const existed = new Set(ctx.data.items.map((entry) => entry.code));
    const uoms = Object.entries(rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
    const body = `<form novalidate id="bom-new-form" data-rf-form="saveItem" data-rf-args="${attr(JSON.stringify({ create: true }))}" data-rf-success="สร้างรายการแล้ว เพิ่มส่วนประกอบได้เลย">
      ${ui.field("รหัส", ui.input("code", { required: true, placeholder: "เช่น MEGA-ST-01(P)-Y", extra: 'autocapitalize="characters" autocomplete="off" maxlength="60" data-new-code' }), { required: true })}
      ${ui.field("ชื่อ", ui.input("name", { required: true, extra: 'maxlength="160"' }), { required: true })}
      <div class="rf-grid rf-g2">${ui.field("ชนิด", ui.select("kind", kinds, { value: "FG" }))}${ui.field("หน่วย", ui.select("uom", uoms, { value: "set" }))}</div></form>
      <p class="small muted">สร้างแล้วเพิ่มส่วนประกอบในหน้าของรายการได้ทีละบรรทัด วางจาก Excel หรือคัดลอกโครงสร้างจากรายการอื่น · ทั้งไฟล์ใช้ ${ui.link("นำเข้าจาก Excel", ctx.url("import"))}</p>`;
    const bind = (dialog) => {
      // บันทึกสำเร็จ (รายการใหม่อยู่ในข้อมูลแล้ว) ไปหน้าของรายการนั้น · ไม่สำเร็จอยู่ที่ dialog เดิมพร้อมข้อความแจ้ง
      dialog.querySelector("#bom-new-form")?.addEventListener("submit", () => {
        const code = rules.canonicalCode(dialog.querySelector("[data-new-code]")?.value ?? "");
        if (code && !existed.has(code) && ctx.helpers.itemOf(ctx.store.data(), code)) location.hash = ctx.url("find", { code });
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
  // other = ที่ใบร่างอื่นต้องใช้ของเดียวกัน (rules.draftPartDemand) เป็นข้อมูลให้ดู ไม่เข้าสูตรขาด/พอ เพราะใบร่างไม่จองของ (จองเมื่อปล่อยผลิต)
  function draftPartRows(ctx, order) {
    const purchaseOrders = pages.tools?.purchaseOrdersOf?.(ctx) ?? [];
    // ใบร่างที่คำนวณก่อนใบนี้อยู่ในยอดจองแล้ว (rules.partNeeds) คอลัมน์นี้จึงเหลือเฉพาะใบร่างที่คำนวณทีหลัง
    const others = ctx.rules.draftPartDemand(ctx.data.orders, order.id, { relativeTo: order, side: "later" });
    return ctx.rules.partNeeds({ jobs: ctx.data.jobs, orders: ctx.data.orders, stock: ctx.data.stock ?? [], purchaseOrders }, order.id).rows
      .map((row) => ({ itemCode: row.itemCode, name: row.name, uom: row.uom, required: row.needQty, onHand: row.onHandQty, held: row.reservedQty, onOrder: row.onOrderQty, short: row.shortage, other: Math.round((others.get(row.itemCode)?.qty ?? 0) * 1e3) / 1e3, otherOrders: others.get(row.itemCode)?.orders ?? [] }))
      .sort((a, b) => (b.short > 0) - (a.short > 0) || a.itemCode.localeCompare(b.itemCode));
  }
  // เคมีของใบร่าง: งาน RB ที่ใบจะได้ตอนปล่อยผลิต (rules.draftRubberJobs) แปลงเป็น WO ชั่วคราวด้วยกฎเดียวกับที่ฐานข้อมูลเปิด WO ให้ตอนปล่อย (private.bom_open_rf_orders:
  // สูตร = สูตร RubberFlow ที่อนุมัติแล้วของสูตรยางบนเส้นยาง · กิโลกรัม = helpers.rbJobKg เผื่อ 5% เมื่อไม่มีบรรทัดสูตรยาง) แล้วคิดด้วย rules.chemicalNeeds ของ RubberFlow ตัวเดียวกับหน้าต่างสั่งซื้อหลังปล่อย
  // ตัวเลขจึงตรงกับการตรวจหลังปล่อย ตราบใดที่ BOM ยอดนับ สูตร และสต็อกไม่เปลี่ยนระหว่างนั้น · เส้นยางที่ยังเปิด WO ไม่ได้ (ไม่ผูกสูตร/สูตรยังไม่อนุมัติ) ไม่ถูกนับ และบอกเหตุผลไว้ใน skipped เหมือนหลังปล่อย
  function draftChemicals(ctx, order) {
    const jobs = ctx.rules.draftRubberJobs(order);
    const rf = ctx.rubberflow();
    const none = { jobs: jobs.length, ready: true, rows: [], skipped: [], orders: [] };
    if (!jobs.length || !rf?.draftChemicalNeeds || !pages.tools?.rfRecipes) return none;
    const recipes = pages.tools.rfRecipes(ctx); // RubberFlow ยังไม่ได้โหลด: สั่งโหลดให้ แล้วหน้าวาดใหม่เองเมื่อเสร็จ
    if (!pages.tools.rfReady(ctx)) return { ...none, ready: false };
    const orders = [];
    const skipped = [];
    for (const job of jobs) {
      const item = itemOf(ctx, job.itemCode);
      const code = item?.rubber?.compound;
      const compound = code ? ctx.data.compounds.find((entry) => entry.code === code) : null;
      const recipe = compound?.recipeId ? recipes.find((row) => row.id === compound.recipeId) : null;
      const kg = item ? ctx.helpers.rbJobKg(job, item, { scrapPct: 5, bom: approvedBomOf(ctx, item.code) }) : 0;
      const reason = !code ? "ไม่มีรหัสสูตรยาง" : !compound?.recipeId ? "ยังไม่ผูกสูตร RubberFlow" : recipe?.status !== "approved" ? `สูตร ${compound.recipeId} ยังไม่อนุมัติ` : !(kg > 0) ? "คำนวณกิโลกรัมไม่ได้" : "";
      if (reason) skipped.push({ itemCode: job.itemCode, reason });
      else orders.push({ id: `DRAFT:${order.id}:${job.itemCode}`, status: "planned", recipeId: recipe.id, recipeRevision: recipe.revision, targetQty: job.qtyPlanned, targetKg: kg, uom: job.uom });
    }
    const needs = orders.length ? rf.draftChemicalNeeds(orders) : null;
    const rows = (needs?.rows ?? []).map((row) => ({ itemCode: row.materialCode, name: row.name, uom: "kg", required: row.needKg, onHand: row.onHandKg, held: row.reservedKg, onOrder: row.onOrderKg, short: row.shortageKg, other: 0, otherOrders: [] }))
      .sort((a, b) => (b.short > 0) - (a.short > 0) || a.itemCode.localeCompare(b.itemCode));
    return { jobs: jobs.length, ready: true, rows, skipped, orders };
  }
  // ตาราง ต้องใช้ เทียบ ของที่มี ของขั้น 2 (ใช้ทั้งของซื้อและเคมี): คอลัมน์ที่เป็นศูนย์ทุกแถวไม่แสดง · รายการที่พอพับไว้เมื่อมีรายการขาด
  function needTable(ctx, rows, firstHead, heldTitle, noun = firstHead) {
    const { ui, rules } = ctx;
    const short = rows.filter((row) => row.short > 0);
    const enough = rows.filter((row) => row.short <= 0);
    const anyHeld = rows.some((row) => row.held > 0);
    const anyOnOrder = rows.some((row) => row.onOrder > 0);
    const anyOther = rows.some((row) => row.other > 0);
    const result = (row) => {
      if (row.short > 0) return `<strong class="bom-short-text">ขาด ${esc(`${rules.fmtQty(row.short)} ${uomText(ctx, row.uom)}`)}</strong>`;
      // พอสำหรับใบนี้ แต่ถ้ารวมที่ใบร่างอื่นต้องใช้แล้วไม่พอ บอกไว้ (ใบที่ปล่อยผลิตก่อนได้ของก่อน)
      const left = row.onHand - row.held + row.onOrder - row.required;
      return `<span class="bom-ok-text">พอ</span>${row.other > 0 && left < row.other - 1e-9 ? '<div class="small muted">ไม่พอถ้ารวมใบร่างอื่น</div>' : ""}`;
    };
    const rowHtml = (row) => `<tr${row.short > 0 ? ' class="bom-short"' : ""}><td><strong>${esc(row.name || row.itemCode)}</strong>${row.name ? `<div class="rf-mono small muted">${esc(row.itemCode)}</div>` : ""}</td><td class="right">${esc(`${rules.fmtQty(row.required)} ${uomText(ctx, row.uom)}`)}</td><td class="right">${esc(rules.fmtQty(row.onHand))}</td>${anyHeld ? `<td class="right">${esc(rules.fmtQty(row.held))}</td>` : ""}${anyOnOrder ? `<td class="right">${esc(rules.fmtQty(row.onOrder))}</td>` : ""}${anyOther ? `<td class="right"${row.otherOrders.length ? ` title="${attr(`ใบ ${row.otherOrders.join(", ")}`)}"` : ""}>${row.other > 0 ? esc(rules.fmtQty(row.other)) : '<span class="muted">—</span>'}</td>` : ""}<td class="right">${result(row)}</td></tr>`;
    const headCells = [firstHead, { label: "ต้องใช้", className: "right" }, { label: "มีในคลัง", className: "right" }, ...(anyHeld ? [{ label: "ใบอื่นจองไว้", className: "right", title: heldTitle }] : []), ...(anyOnOrder ? [{ label: "สั่งแล้วรอรับ", className: "right" }] : []), ...(anyOther ? [{ label: "ใบร่างอื่นต้องใช้", className: "right", title: "ใบร่างที่คำนวณของหลังใบนี้และต้องใช้ของเดียวกัน (ใบนี้จองก่อน)" }] : []), { label: "ผล", className: "right" }];
    return `${short.length || enough.length <= 5 ? ui.table(headCells, (short.length ? short : enough).map(rowHtml)) : ""}${short.length && enough.length ? `<details class="bom-more"><summary>ดู${esc(noun)}อีก ${enough.length} รายการที่พอ</summary>${ui.table(headCells, enough.map(rowHtml))}</details>` : !short.length && enough.length > 5 ? `<details class="bom-more"><summary>ดู${esc(noun)}ทั้ง ${enough.length} รายการ</summary>${ui.table(headCells, enough.map(rowHtml))}</details>` : ""}`;
  }
  // สั่งซื้อของที่ขาดของใบร่างได้เมื่อข้อมูลอยู่ในฐานข้อมูล (ใบสั่งซื้อเป็นของ RubberFlow) และผู้ใช้เป็นฝ่ายวางแผนหรือแผนก RB (เงื่อนไขเดียวกับปุ่มตรวจวัตถุดิบของใบที่ปล่อยแล้ว)
  // สิทธิ์ของหน้าต่างสั่งซื้อ (RubberFlow เป็นเจ้าของ): สั่งซื้อ = แผนก ST · กลุ่มวางแผนและ RB เปิดดูได้อย่างเดียว
  const rfCan = (ctx, permission) => { try { return Boolean(ctx.store?.isRemote?.() && ctx.rubberflow()?.can?.(permission)); } catch { return false; } };
  const canBuyParts = (ctx) => rfCan(ctx, "purchase");
  const canViewBuy = (ctx) => rfCan(ctx, "purchase") || rfCan(ctx, "viewPurchase");
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
    let draftOrders = [];
    if (current === 0) panel = ui.callout("warn", `ใบนี้ถูกยกเลิก${order.cancelReason ? `: ${esc(order.cancelReason)}` : ""}`);
    else if (view === 1) panel = ui.card(`<p>เพิ่มสินค้าที่ลูกค้าสั่งลงในใบ แล้วระบบจะพาไปขั้นตรวจของ</p><div class="rf-row">${buttons.add ?? ""}</div>`, { title: "ขั้น 1 · รายการสินค้า" });
    else if (view === 2) {
      if (!order.explosion?.length) panel = ui.card(`<p>ยังไม่ได้คำนวณว่าใบนี้ต้องใช้อะไรเท่าไร</p><div class="rf-row">${buttons.explode ?? ""}</div>`, { title: "ขั้น 2 · ตรวจของ" });
      else {
        const parts = draftPartRows(ctx, order);
        const short = parts.filter((row) => row.short > 0);
        const chem = draftChemicals(ctx, order);
        const chemShort = chem.rows.filter((row) => row.short > 0);
        draftOrders = chem.orders;
        const table = parts.length ? needTable(ctx, parts, "ของซื้อ", "ใบสั่งผลิตอื่นที่ปล่อยผลิตแล้วและยังไม่ได้เบิกจ่าย และใบร่างที่คำนวณของก่อนใบนี้") : ui.empty("ใบนี้ไม่มีของซื้อ");
        // เคมีของเส้นยาง: มีเมื่อใบนี้ต้องรีดเส้นยาง · เส้นยางที่ยังไม่ผูกสูตร RubberFlow ประเมินไม่ได้ (และจะไม่ได้ WO ตอนปล่อยผลิต) บอกเหตุผลให้ไปแก้ก่อน
        const skippedNote = chem.skipped.length ? ui.callout("warn", `เส้นยาง ${chem.skipped.length} จาก ${chem.jobs} รายการยังประเมินเคมีไม่ได้${ctx.store?.isRemote?.() ? " และจะยังไม่ได้ WO ตอนปล่อยผลิต" : ""}: ${chem.skipped.slice(0, 5).map((entry) => `<span class="rf-mono">${esc(entry.itemCode)}</span> ${esc(entry.reason)}`).join(" · ")}${chem.skipped.length > 5 ? ` และอีก ${chem.skipped.length - 5}` : ""}${ctx.canSee("compounds") ? ` · ${ui.link("ไปผูกสูตรยาง", ctx.url("compounds"))}` : ""}`) : "";
        const chemHtml = !chem.jobs ? "" : !chem.ready ? '<p class="small muted">กำลังโหลดข้อมูลเคมีจาก RubberFlow…</p>' : `${chem.rows.length ? needTable(ctx, chem.rows, "เคมีของเส้นยาง", "ใบเบิกที่ค้างจ่าย และ WO อื่นที่ยังเปิดอยู่", "เคมี") : ""}${skippedNote}`;
        const counted = Object.keys(order.stockCounts ?? {}).length;
        const wip = `<div class="bom-step-line"><div><strong>ชิ้นงานค้างในไลน์ที่ใช้แทนได้</strong><div class="small muted">${counted ? esc(`กรอกยอดแล้ว ${counted} รายการ ระบบหักออกจากยอดที่ต้องผลิต`) : "ยังไม่ได้กรอก ถ้าไม่กรอก ระบบสั่งผลิตเต็มจำนวน"}</div></div>${ctx.helpers.canCount(ctx.user) ? ui.link(counted ? "แก้ยอดที่กรอก" : "กรอกยอดที่มีอยู่", ctx.url("count", { order: order.id }), "btn rf-btn secondary") : ""}</div>`;
        // สั่งซื้อส่วนที่ขาด (ของซื้อและเคมี) ได้ตั้งแต่ใบยังเป็นร่าง ด้วยหน้าต่างสั่งซื้อเดียวกับหลังปล่อยผลิต (ผู้ที่สั่งซื้อได้ = ฝ่ายวางแผนหรือแผนก RB) · ใช้ได้เมื่อข้อมูลอยู่ในฐานข้อมูล (ใบสั่งซื้อเป็นของ RubberFlow)
        const lacks = short.length || chemShort.length;
        const buy = lacks && canBuyParts(ctx) ? `<div class="rf-row bom-step-next"><button class="btn rf-btn" type="button" data-bom-draft-buy>สั่งซื้อส่วนที่ขาด</button></div>`
          : lacks && canViewBuy(ctx) ? `<div class="rf-row bom-step-next"><span class="small muted">คลังวัตถุดิบ (ST) เป็นผู้สั่งซื้อ</span><button class="btn rf-btn secondary" type="button" data-bom-draft-buy>ดูรายการที่ต้องสั่ง</button></div>` : "";
        const sum = [parts.length ? (short.length ? `ของซื้อขาด ${short.length} จาก ${parts.length} รายการ` : `ของซื้อพอทั้ง ${parts.length} รายการ`) : "", chem.rows.length ? (chemShort.length ? `เคมีขาด ${chemShort.length} จาก ${chem.rows.length} รายการ` : `เคมีพอทั้ง ${chem.rows.length} รายการ`) : ""].filter(Boolean).join(" · ");
        panel = ui.card(`${table}${chemHtml}${buy}${wip}<div class="rf-row bom-step-next">${buttons.explode ? buttons.explode.replace("ระเบิด BOM", "คำนวณใหม่") : ""}${canPlan ? ui.link("ไปขั้น 3 ปล่อยผลิต", stepUrl(3), "btn rf-btn") : ""}</div>`,
          { title: `ขั้น 2 · ตรวจของ <span class="muted">${sum}</span>` });
      }
    } else if (view === 3) {
      const entries = [...net.values()].filter((entry) => (entry.toMake ?? entry.required) > 0);
      const made = entries.filter((entry) => entry.kind !== "PURCHASED" && entry.kind !== "CP");
      const partCount = entries.filter((entry) => entry.kind === "PURCHASED").length;
      const byDept = rules.FLOW_DEPTS.filter((dept) => dept !== "ST").map((dept) => [dept, made.filter((entry) => entry.dept === dept).length]).filter(([, count]) => count);
      const short = order.explosion?.length ? draftPartRows(ctx, order).filter((row) => row.short > 0) : [];
      const chemShort = order.explosion?.length ? draftChemicals(ctx, order).rows.filter((row) => row.short > 0) : [];
      const noBom = [...new Set((order.explosion ?? []).filter((line) => line.noBom).map((line) => line.itemCode))];
      const list = `<dl class="bom-release-list">${partCount ? `<dt>${deptChip(ctx, "ST")} ${esc(deptName(ctx, "ST"))}</dt><dd>เบิกของ ${partCount} รายการ</dd>` : ""}${byDept.map(([dept, count]) => `<dt>${deptChip(ctx, dept)} ${esc(deptName(ctx, dept))}</dt><dd>${count} งาน</dd>`).join("")}</dl>`;
      const lacking = [short.length ? `ของซื้อ ${short.length} รายการ` : "", chemShort.length ? `เคมี ${chemShort.length} รายการ` : ""].filter(Boolean).join(" และ");
      const warns = [
        !order.explosion?.length ? ui.callout("warn", "ยังไม่ได้คำนวณของที่ต้องใช้ กลับไปขั้น 2 ก่อน") : "",
        noBom.length ? ui.callout("bad", `ปล่อยผลิตไม่ได้ ชิ้นงานที่ยังไม่มี BOM: ${noBom.map((code) => ui.link(code, ctx.url("find", { code }), "rf-mono")).join(", ")}`) : "",
        lacking ? ui.callout("warn", `ยังขาด${lacking} และยังไม่ได้สั่ง ปล่อยผลิตได้ แต่แผนกที่ใช้ของนั้นจะติดจนกว่าของจะเข้า${canBuyParts(ctx) ? ` · ${ui.link("กลับไปสั่งซื้อที่ขั้น 2", stepUrl(2))}` : " · คลังวัตถุดิบ (ST) เป็นผู้สั่งซื้อ"}`) : "",
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
    // ปุ่มสั่งซื้อของใบร่าง: หน้าต่างสั่งซื้อของ RubberFlow คิดของซื้อจากใบร่าง (sourcePi) และเคมีจาก WO ชั่วคราวชุดเดียวกับที่ตารางของขั้นนี้แสดง
    const bind = (rootNode) => rootNode.querySelectorAll("[data-bom-draft-buy]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await ctx.rubberflow()?.checkMaterials?.({ woIds: [], sourcePi: order.id, draftOrders, auto: false }); } finally { button.disabled = false; }
    }));
    return { html: `${bar}${panel}`, used, bind };
  };

  // งานของคลังวัตถุดิบที่ไม่ใช่งานของใบ (โหมดฐานข้อมูล): รับเข้าตามใบสั่งซื้อที่ยังรอรับ และสั่งซื้อของซื้อที่ใบยังขาด · แสดงเฉพาะผู้ที่ทำได้จริง (สิทธิ์ของ RubberFlow: แผนก ST)
  // ใช้ทั้งการ์ดในหน้างานของฉันและตัวเลขที่เมนู · ของที่ขาดคิดด้วย rules.partNeeds ตัวเดียวกับหน้าต่างสั่งซื้อ (เคมีดูที่หน้าใบ)
  function storeTasks(ctx) {
    const tasks = [];
    const purchaseOrders = pages.tools?.purchaseOrdersOf?.(ctx) ?? [];
    if (rfCan(ctx, "receiveMaterial")) {
      for (const po of purchaseOrders) {
        if (po.status !== "ordered") continue;
        const lines = (po.lines ?? []).filter((line) => line.receivedKg === null || line.receivedKg === undefined);
        // ใบสั่งผลิตที่ใบสั่งซื้อนี้สั่งให้ถูกยกเลิกแล้ว: ST ตัดสินเองว่าจะยกเลิกใบสั่งซื้อ หรือรับเข้าเป็นสต็อก
        const cancelled = Boolean(po.sourcePi) && ctx.data.orders.find((order) => order.id === po.sourcePi)?.status === "cancelled";
        if (lines.length) tasks.push({ kind: "receive", po, lines, cancelled, partly: (po.lines ?? []).some((line) => line.receivedKg != null) });
      }
    }
    if (rfCan(ctx, "purchase")) {
      // เคมีที่ใบสั่งผลิตของ RubberFlow ที่เปิดอยู่ยังขาด (รวมใบที่ไม่ได้มาจากใบ PI): สั่งที่แท็บใบสั่งซื้อของหน้าคลัง
      const chem = (() => { try { return ctx.rubberflow()?.openChemicalNeeds?.()?.rows.filter((row) => row.shortageKg > 0) ?? []; } catch { return []; } })();
      if (chem.length) tasks.push({ kind: "chem", short: chem });
      for (const order of ctx.data.orders) {
        if (!["released", "in_progress"].includes(order.status) && !(order.status === "draft" && order.explosion?.length)) continue;
        const short = ctx.rules.partNeeds({ jobs: ctx.data.jobs, orders: ctx.data.orders, stock: ctx.data.stock ?? [], purchaseOrders }, order.id).rows.filter((row) => row.shortage > 0);
        if (short.length) tasks.push({ kind: "buy", order, short });
      }
    }
    return tasks;
  }

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
    // งานของคลังวัตถุดิบ (รับเข้า / สั่งซื้อ) อยู่ในรายการต้องทำของแผนก ST · ไม่กรองตามใบที่เลือกดู
    const tasks = (dept === "ST" || dept === "ALL") && !orderId ? storeTasks(ctx) : [];
    const showTabs = ui.tabs([{ id: "open", label: `ต้องทำ ${cardCount(open) + tasks.length}` }, { id: "done", label: `เสร็จแล้ว ${cardCount(done)}` }], show, (id) => keep({ st: id === "done" ? "done" : null }));
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
    const taskHtml = (task) => {
      if (task.kind === "receive") {
        const unit = (line) => (line.source === "bom" ? uomText(ctx, line.uom) : "กก.");
        return `<article class="card rf-card bom-job ${task.cancelled ? "is-hold" : "is-now"}"><div class="bom-job-top"><span class="bom-job-state">${task.cancelled ? "ใบสั่งผลิตถูกยกเลิกแล้ว" : "รอรับเข้า"}</span><span class="muted">สั่งเมื่อ ${esc(rules.fmtDate(task.po.createdAt))}</span></div>
          <h2>${esc(`${task.cancelled ? "ตัดสินใบสั่งซื้อ" : "รับเข้าตามใบสั่งซื้อ"} ${task.po.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${task.po.sourcePi ? esc(`สั่งจากใบ ${task.po.sourcePi}`) : ""}${task.cancelled ? (task.partly ? " · รับเข้าไปแล้วบางรายการ ใบนี้ยกเลิกไม่ได้ รับส่วนที่เหลือเข้าเป็นสต็อกไว้ใช้กับใบอื่น" : " · ยกเลิกใบสั่งซื้อ หรือรับเข้าเป็นสต็อกไว้ใช้กับใบอื่น") : ""}</p>
          <ul class="bom-job-parts">${task.lines.slice(0, 6).map((line) => `<li><span class="rf-mono">${esc(line.materialCode)}</span><span class="nowrap">${esc(`${rules.fmtQty(line.qtyKg)} ${unit(line)}`)}</span></li>`).join("")}</ul>${task.lines.length > 6 ? `<p class="small muted">และอีก ${task.lines.length - 6} รายการ</p>` : ""}
          ${ui.link(task.cancelled ? "เปิดใบสั่งซื้อ" : "ตรวจสอบรับเข้า", `#/rubberflow?p=warehouse&tab=po&q=${encodeURIComponent(task.po.id)}`, "btn rf-btn bom-job-main")}</article>`;
      }
      if (task.kind === "chem") {
        return `<article class="card rf-card bom-job is-hold"><div class="bom-job-top"><span class="bom-job-state">เคมีขาด ยังไม่ได้สั่ง</span></div>
          <h2>${esc(`สั่งซื้อเคมีที่ขาด ${task.short.length} รายการ`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}สำหรับใบสั่งผลิตของแผนก RB ที่เปิดอยู่</p>
          <ul class="bom-job-parts">${task.short.slice(0, 6).map((row) => `<li><span>${esc(row.name || row.materialCode)}</span><span class="nowrap">${esc(`ขาด ${rules.fmtQty(row.shortageKg)} กก.`)}</span></li>`).join("")}</ul>${task.short.length > 6 ? `<p class="small muted">และอีก ${task.short.length - 6} รายการ</p>` : ""}
          ${ui.link("เปิดหน้าใบสั่งซื้อ", "#/rubberflow?p=warehouse&tab=po", "btn rf-btn bom-job-main")}</article>`;
      }
      return `<article class="card rf-card bom-job is-hold"><div class="bom-job-top"><span class="bom-job-state">ของขาด ยังไม่ได้สั่ง</span></div>
        <h2>${esc(`สั่งซื้อของที่ขาดของใบ ${task.order.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${esc(task.order.customer ?? "")}</p>
        <ul class="bom-job-parts">${task.short.slice(0, 6).map((row) => `<li><span>${esc(row.name || row.itemCode)}</span><span class="nowrap">${esc(`ขาด ${rules.fmtQty(row.shortage)} ${uomText(ctx, row.uom)}`)}</span></li>`).join("")}</ul>${task.short.length > 6 ? `<p class="small muted">และอีก ${task.short.length - 6} รายการ</p>` : ""}
        ${ui.link("เปิดใบเพื่อสั่งซื้อ", ctx.url("orders", { sel: task.order.id }), "btn rf-btn bom-job-main")}</article>`;
    };
    const taskCards = show === "open" ? tasks.map(taskHtml) : [];
    const body = !dept ? ui.card(ui.empty("บัญชีนี้ไม่ได้อยู่ในแผนกผลิต จึงไม่มีงานของตัวเอง")) : cards.length || taskCards.length ? `<div class="bom-job-grid">${taskCards.join("")}${cards.map(cardHtml).join("")}</div>` : ui.card(ui.empty(show === "done" ? "ยังไม่มีงานที่เสร็จ" : "ไม่มีงานค้าง"));
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

  pages.hub = { ratioText, orderStepOf, hubUrl, treeTab, pastePreview, copyPreview, draftChemicals, rfCan, storeTasks };
})(typeof window !== "undefined" ? window : globalThis);
