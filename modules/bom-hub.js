// BOM รายแผนก (โหมดทดสอบ) — หน้าโครงใหม่ 4 เมนู: สินค้า (find) · ใบสั่งผลิต (แถบขั้นตอนของหน้า orders) · งานของฉัน (work) · ข้อมูลตั้งต้น (setup)
// โหลดต่อจาก modules/bom-pages.js และลงทะเบียนใน window.MNP_BOM_PAGES / _DIALOGS ชุดเดียวกัน · กติกา ข้อมูล และคำสั่ง (actions) เป็นของเดิมทั้งหมด ไฟล์นี้เปลี่ยนเฉพาะการจัดหน้า
// หน้าสินค้าวางหน้าเดิม (งานทุกแผนก โครงสร้าง/ต้นทุน) เป็นแท็บด้วย ctx.embed · ลิงก์ในแท็บเหล่านั้นถูกพากลับมาที่หน้าสินค้า (hubCtx)
(function (root) {
  const pages = (root.MNP_BOM_PAGES ??= {});
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  // ลิงก์ไปโมดูลของแผนก (งานของฉันอยู่ที่นั่น) เฉพาะโมดูลที่ผู้ใช้เปิดได้ · ไม่รู้ว่าใครเปิดอยู่ (ไม่มี state) = ใช้เส้นทางของแผนกตรงๆ
  const deptHref = (dept) => {
    const employee = typeof state === "undefined" ? undefined : state?.employee;
    if (employee === undefined || !root.MNP_FACTORY?.deptLink) return root.MNP_BOM_STORE?.deptRoute?.(dept) ?? null;
    return root.MNP_FACTORY.deptLink(employee, dept);
  };
  const attr = (value) => esc(value ?? "");
  const includes = (haystack, q) => !q || String(haystack).toLowerCase().includes(q.toLowerCase());
  const itemOf = (ctx, code) => ctx.helpers.itemOf(ctx.data, code);
  const approvedBomOf = (ctx, code) => ctx.helpers.approvedBomOf(ctx.data, code);
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);
  const deptName = (ctx, dept) => String(ctx.rules.DEPT_LABEL[dept] ?? dept).replace(/^\w+ · /, "");
  // ป้ายแผนก: ตัวย่อ + สีประจำแผนก (สีเป็นตัวช่วย ตัวย่อเป็นตัวบอก) ชื่อเต็มอยู่ใน title
  // (ใช้ชิ้นส่วนกลาง modules/factory-kit.js)
  const deptChip = (ctx, dept) => root.MNP_FACTORY.deptChip(dept, ctx.rules.DEPT_LABEL);
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
  // เส้นยางที่มีข้อมูลการตัด: ปริมาณในบรรทัดต่างจากข้อมูลการตัดเกิน 1% = ข้อความเตือน (ไม่ห้ามบันทึก) · "" = ไม่ต้องเตือน (ไม่ใช่เส้นยาง ไม่มีข้อมูลการตัด หรือตรงกัน)
  function cutNote(ctx, parent, child, qty) {
    const { rules } = ctx;
    if (!child || !rules.rbCutDiffers(qty, child, parent)) return "";
    const expected = rules.rbCutQty(child, parent);
    const plain = `${rules.fmtQty(expected)} ${uomText(ctx, child.uom)}`;
    const ratio = ratioText(ctx, expected, child.uom, parent.uom);
    return `ข้อมูลการตัดของ ${child.code}: ${ratio === plain ? "" : `${ratio} = `}ใช้ ${plain} ต่อ 1 ${uomText(ctx, parent.uom)} ปริมาณที่กรอกต่างจากนี้`;
  }
  const cutCallout = (attrName) => `<div class="rf-callout is-warn" role="note" ${attrName} hidden><div class="rf-callout-body"></div></div>`;
  const paintCutNote = (box, text) => {
    if (!box) return;
    box.hidden = !text;
    const body = box.querySelector?.(".rf-callout-body");
    if (body) body.textContent = text;
  };

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
  // options = [{ value, label, meta? }] · onChange เรียกทุกครั้งที่ค่าในช่องเปลี่ยน (พิมพ์หรือเลือก) · emptyText เป็นข้อความหรือฟังก์ชัน (ค่าในช่อง) → ข้อความ เมื่อไม่มีรายการที่ตรง
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
      const emptyNote = typeof emptyText === "function" ? emptyText(input.value) : emptyText;
      if (!found.length && !emptyNote) { list.innerHTML = ""; if (!list.hidden) close(); return; } // ไม่มีรายการและไม่มีข้อความ (ข้อความอยู่ที่อื่นในฟอร์มแล้ว) = ไม่เปิดกล่องว่าง
      list.innerHTML = found.length
        ? `${found.map((option, at) => `<button class="bom-pick-option" type="button" role="option" tabindex="-1" id="${attr(list.id)}-${at}" aria-selected="false" data-pick-value="${attr(option.value)}"><span class="rf-mono">${esc(option.value)}</span><span>${esc(option.label ?? "")}</span>${option.meta ? `<span class="small muted">${esc(option.meta)}</span>` : ""}</button>`).join("")}${more ? `<p class="small muted bom-pick-note">แสดง ${PICK_LIMIT} รายการแรก พิมพ์เพิ่มเพื่อกรอง</p>` : ""}`
        : `<p class="small muted bom-pick-note">${esc(emptyNote)}</p>`;
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
    const { data, ui, params } = ctx;
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
      // เลื่อนลำดับ: สลับกับบรรทัดติดกันได้ทุกแผนก (BOM เก็บลำดับตามที่ผู้ใช้ให้) · บันทึกด้วย saveBom (ฉบับแก้ไขใหม่ "เรียงลำดับส่วนประกอบใหม่")
      const at = siblings.findIndex((entry) => entry.childCode === line.itemCode);
      const full = (list) => list.map((entry) => ({ childCode: entry.childCode, qty: entry.qty, scrapPct: entry.scrapPct ?? 0, note: entry.note ?? "", step: entry.step ?? "", flags: entry.flags ?? [] }));
      const swapped = (other) => { const list = siblings.slice(); [list[at], list[other]] = [list[other], list[at]]; return full(list); };
      // ปุ่มเลื่อนขึ้นและเลื่อนลงแสดงคู่กัน: ทิศที่เลื่อนไม่ได้ (บนสุด/ล่างสุด) เป็นปุ่มปิด (title บอกเหตุ) · บรรทัดเดียวใต้ชิ้นแม่ไม่มีอะไรให้เรียง จึงไม่แสดงปุ่ม
      const moveOff = (label, why) => `<button class="btn rf-btn secondary" type="button" disabled title="${esc(why)}">${esc(label)}</button>`;
      const moveButton = (label, other) => (!(canEdit && bomLine) || siblings.length < 2 ? "" : !(other >= 0 && other < siblings.length) ? moveOff(label, other < 0 ? "อยู่บนสุดแล้ว" : "อยู่ล่างสุดแล้ว")
        : ui.button(label, { action: "saveBom", args: { itemCode: line.parentCode, lines: swapped(other), note: `เรียงลำดับ ${line.itemCode}` }, className: "secondary", success: `เรียงลำดับ ${line.itemCode} แล้ว` }));
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
    if (!code) {
      const list = findList(ctx);
      const cards = ctx.helpers.canPlanOrders(ctx.user) ? root.MNP_SA_PAGES?.planningCards?.(ctx) ?? "" : "";
      return cards ? { ...list, html: `${cards}${list.html}` } : list;
    }
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
        <div class="rf-grid rf-g3">${ui.field(`ใช้ต่อ 1 ${uomText(ctx, parent.uom)} (${uomText(ctx, child.uom)})`, ui.input("qty[]", { type: "number", step: "any", min: "0.000001", required: true, value: String(Math.round(entry.qty * 1e6) / 1e6), extra: "data-edit-qty" }), { required: true })}${ui.field("เผื่อเสีย (%)", ui.input("scrapPct[]", { type: "number", step: "any", min: 0, value: String(entry.scrapPct ?? 0) }))}${ui.field("เข้าที่ขั้นผลิตที่", ui.input("lineStep[]", { type: "number", step: "1", min: 1, max: 20, value: String(entry.step ?? ""), placeholder: "1", extra: `title="ขั้นผลิตของ ${attr(parent.name)} ที่ชิ้นนี้เข้า 1–20 เว้นว่าง = ขั้นแรก"` }))}</div>
        ${rules.rbCutQty(child, parent) > 0 ? cutCallout("data-edit-cut") : ""}
        ${ui.field("หมายเหตุของบรรทัด", ui.input("lineNote[]", { value: entry.note ?? "", extra: 'maxlength="200"' }))}`
      : hiddenOf(entry))).join("");
    const body = `<form novalidate id="bom-line-form" data-rf-form="saveBom" data-rf-args="${attr(JSON.stringify({ itemCode: parent.code, editCode: childCode }))}" data-rf-success="${attr(`บันทึก BOM ของ ${parent.code} แล้ว`)}">
      <p class="muted small">${esc(`${child.name} ใน ${parent.name}`)}</p>${rows}
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { placeholder: "เช่น ปรับตามผลผลิตจริง", extra: 'maxlength="300"' }))}</form>`;
    // เส้นยางที่ปริมาณต่างจากข้อมูลการตัด: เตือนใต้ช่อง (ตอนเปิดและตอนแก้) ไม่ห้ามบันทึก
    const bind = (dialog) => {
      const qtyInput = dialog.querySelector("[data-edit-qty]");
      const box = dialog.querySelector("[data-edit-cut]");
      if (!qtyInput || !box) return;
      const paint = () => paintCutNote(box, cutNote(ctx, parent, child, qtyInput.value));
      qtyInput.addEventListener("input", paint);
      paint();
    };
    return { html: ui.dialog("lineEdit", `แก้บรรทัด ${rules.canonicalCode(childCode)}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-line-form">บันทึก</button>` }), bind };
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
    // สินค้า (FG) เป็นส่วนประกอบของชิ้นอื่นไม่ได้ จึงไม่อยู่ในรายการเลือก
    const choices = data.items.filter((entry) => entry.active !== false && entry.kind !== "FG" && entry.code !== parent.code && !used.has(entry.code) && !rules.childKindError(parent.kind, entry.kind));
    // ชนิดของชิ้นใหม่: ทุกชนิดที่อยู่ใต้ชิ้นแม่นี้ได้ ยกเว้นสินค้า (FG)
    const kinds = Object.entries(rules.KINDS).filter(([kind]) => kind !== "FG" && !rules.childKindError(parent.kind, kind)).map(([value, meta]) => ({ value, label: meta.label }));
    const uoms = Object.entries(rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
    const body = `<form novalidate id="bom-add-form" data-rf-form="saveBomTree" data-rf-args="${attr(JSON.stringify({ lineAdd: true, code: parent.code }))}" data-rf-success="{result}">
      <p class="muted small">${esc(`เพิ่มใน ${parent.name}`)}</p>
      ${ui.field("รหัสส่วนประกอบ", pickerHtml(ctx, "addCode", { id: "bom-add-code", required: true, placeholder: "พิมพ์รหัสหรือชื่อเพื่อค้นหา", extra: "data-add-code" }), { required: true, id: "bom-add-code" })}
      <p class="small bom-pick-note" data-add-used role="status" hidden></p>
      <div class="rf-grid rf-g2">${ui.field(`ใช้ต่อ 1 ${uomText(ctx, parent.uom)}`, ui.input("addQty", { type: "number", step: "any", min: "0.000001", required: true, id: "bom-add-qty", extra: "data-add-qty" }), { required: true, id: "bom-add-qty", hint: "<span data-add-cut-hint></span>" })}${ui.field("เผื่อเสีย (%)", ui.input("addScrap", { type: "number", step: "any", min: 0, value: "0" }))}</div>
      ${cutCallout("data-add-cut")}
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
      const usedNote = dialog.querySelector("[data-add-used]");
      const nameInput = dialog.querySelector("[data-add-name]");
      const kindSelect = dialog.querySelector("[data-add-kind]");
      const uomSelect = dialog.querySelector("[data-add-uom]");
      const rubberBox = dialog.querySelector("[data-add-rubber]");
      const compoundInput = dialog.querySelector("[data-add-compound]");
      const qtyInput = dialog.querySelector("[data-add-qty]");
      const qtyLabel = dialog.querySelector('label[for="bom-add-qty"]');
      const cutHint = dialog.querySelector("[data-add-cut-hint]");
      const cutBox = dialog.querySelector("[data-add-cut]");
      let uomTouched = false;
      let qtyAuto = ""; // ค่าที่ระบบเติมจากข้อมูลการตัด: ช่องว่างหรือยังเป็นค่านี้ = ผู้ใช้ยังไม่แก้ เติมใหม่ได้ตามชิ้นที่เลือก
      // หน่วยของชิ้นลูกต่อท้ายป้ายช่องจำนวน (ชิ้นที่เลือกจากทะเบียน = หน่วยของมัน · ชิ้นใหม่ = หน่วยที่เลือกในฟอร์ม) · เส้นยางที่มีข้อมูลการตัด: เติมปริมาณให้เหมือนตารางกว้าง และเตือนเมื่อกรอกต่างเกิน 1%
      const syncQty = () => {
        const code = rules.canonicalCode(codeInput.value);
        const found = code ? ctx.helpers.itemOf(ctx.store.data(), code) : null;
        const unit = found ? found.uom : !fresh.hidden ? uomSelect?.value : "";
        if (qtyLabel?.firstChild) qtyLabel.firstChild.nodeValue = `ใช้ต่อ 1 ${uomText(ctx, parent.uom)}${unit ? ` (${uomText(ctx, unit)})` : ""} `; // เว้นวรรคท้าย: ข้อความนี้ติดกับ "(จำเป็น)" ในโหนดเดียว
        const expected = found ? rules.rbCutQty(found, parent) : 0;
        if (qtyInput) {
          if (expected > 0 && (qtyInput.value === "" || qtyInput.value === qtyAuto)) { qtyAuto = String(Math.round(expected * 1e6) / 1e6); qtyInput.value = qtyAuto; }
          else if (!(expected > 0) && qtyAuto && qtyInput.value === qtyAuto) { qtyInput.value = ""; qtyAuto = ""; }
          if (cutHint) cutHint.textContent = expected > 0 && qtyAuto && qtyInput.value === qtyAuto ? `จากการตัด ${rules.fmtQty(expected)}` : "";
        }
        paintCutNote(cutBox, found && qtyInput ? cutNote(ctx, parent, found, qtyInput.value) : "");
      };
      // ช่องของชิ้นใหม่ต้องกรอกเฉพาะตอนที่แสดง (ฟอร์มตรวจช่อง required ที่มองเห็น แล้วแจ้งเป็นภาษาไทยใต้ช่องเหมือนช่องอื่น)
      const sync = () => {
        const code = rules.canonicalCode(codeInput.value);
        fresh.hidden = !code || used.has(code) || Boolean(ctx.helpers.itemOf(ctx.store.data(), code));
        if (usedNote) { usedNote.hidden = !used.has(code); usedNote.textContent = used.has(code) ? `${code} อยู่ใน BOM นี้แล้ว แก้ปริมาณที่บรรทัดนั้นแทน` : ""; }
        if (nameInput) nameInput.required = !fresh.hidden;
        const rod = !fresh.hidden && kindSelect?.value === "RB";
        if (rubberBox) rubberBox.hidden = !rod;
        if (compoundInput) compoundInput.required = rod;
        syncQty();
      };
      bindPicker(codeInput.closest(".bom-pick-box"), itemOptions(ctx, choices), { onChange: sync, emptyText: (typed) => (used.has(rules.canonicalCode(typed)) ? "" : "ไม่พบในทะเบียน บันทึกเป็นรหัสใหม่ได้โดยกรอกชื่อ ชนิด และหน่วยด้านล่าง") });
      bindPicker(compoundInput?.closest(".bom-pick-box"), compoundOptions(ctx), { emptyText: "ยังไม่มีสูตรยางรหัสนี้ บันทึกแล้วระบบเพิ่มในรายการสูตรยางให้" });
      codeInput.addEventListener("change", sync);
      uomSelect?.addEventListener("change", () => { uomTouched = true; syncQty(); });
      qtyInput?.addEventListener("input", syncQty);
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
      <div class="rf-grid rf-g3">${ui.field("ชนิด", ui.select("wipKind", kinds, { value: kinds.find((entry) => entry.value === "SUBPART")?.value ?? kinds[0].value, extra: "data-native-select data-wip-kind" }))}${ui.field("แผนกที่ทำ", ui.select("wipDept", rules.DEPTS.map((value) => ({ value, label: rules.DEPT_LABEL[value] ?? value })), { value: parent.ownerDept, extra: "data-native-select data-wip-dept" }))}${ui.field("หน่วย", ui.select("wipUom", uoms, { value: "pcs", extra: "data-native-select" }))}</div>
      <div class="rf-grid rf-g2">${ui.field(`ใช้ชิ้นใหม่ต่อ 1 ${uomText(ctx, parent.uom)}`, ui.input("wipQty", { type: "number", step: "any", min: "0.000001", required: true, value: "1" }), { required: true })}${ui.field(`ใช้ ${child.code} ต่อ 1 ชิ้นใหม่ (${uomText(ctx, child.uom)})`, ui.input("childQty", { type: "number", step: "any", min: "0.000001", required: true, value: String(Math.round(line.qty * 1e6) / 1e6) }), { required: true })}</div>
      <p class="small muted">ค่าตั้งต้น: ชิ้นใหม่ 1 หน่วยต่อชิ้นแม่ และใช้บรรทัดเดิมเท่าเดิม ยอดรวมจึงไม่เปลี่ยน · เพิ่มส่วนประกอบอื่นใต้ชิ้นใหม่ได้หลังบันทึก</p>
      ${ui.field("เหตุผลของการแก้ครั้งนี้", ui.input("note", { extra: 'maxlength="300"' }))}</form>`;
    // เปลี่ยนชนิด → แผนกที่ทำตามชนิดนั้นเหมือนฟอร์มชิ้นงาน (แผนกเริ่มต้นยังเป็นของชิ้นแม่ จนกว่าจะเปลี่ยนชนิด) · เลือกแผนกเองหลังเปลี่ยนชนิดได้
    const bind = (dialog) => {
      const kindSelect = dialog.querySelector("[data-wip-kind]");
      const deptSelect = dialog.querySelector("[data-wip-dept]");
      if (!kindSelect || !deptSelect) return;
      kindSelect.addEventListener("change", () => { deptSelect.value = rules.ownerDeptOf(kindSelect.value); });
    };
    return { html: ui.dialog("wipInsert", "แทรก WIP คั่น", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-wip-form">แทรก</button>` }), bind };
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

  // ---------- ใบสั่งผลิต: แถบ 6 ขั้นและแผงของขั้นที่กำลังดู (หน้า orders เรียกใช้) ----------
  const STEPS = Object.freeze([
    { no: 1, label: "รายการสินค้า", who: "ฝ่ายวางแผน" },
    { no: 2, label: "ตรวจของ", who: "ฝ่ายวางแผน และคลังวัตถุดิบ" },
    { no: 3, label: "ปล่อยผลิต", who: "ฝ่ายวางแผน" },
    { no: 4, label: "ผลิตตามแผนก", who: "ทุกแผนก" },
    { no: 5, label: "รับเข้า WH", who: "คลังสินค้า (WH)" },
    { no: 6, label: "ส่งมอบลูกค้า", who: "คลังสินค้า (WH)" },
  ]);
  // ขั้นปัจจุบันคำนวณจากสถานะของใบ (ไม่มีช่องเก็บแยก): ร่างไม่มีสินค้า = 1 · ร่างมีสินค้า = 2 · ปล่อยแล้ว = 4 · งานเสร็จครบ (รอคลังสินค้ารับเข้า) = 5
  // ปิดแล้ว (รับครบ หรือปิดรับไม่ครบ) และยังมีของรอส่งมอบ = 6 · ส่งมอบครบแล้ว (หรือไม่มีของให้ส่ง) = 7 คือทุกขั้นเสร็จ
  function orderStepOf(ctx, order) {
    if (order.status === "cancelled") return 0;
    if (order.status === "completed") return ctx.rules.fgPosition(ctx.data, order).waitingDelivery ? 6 : 7;
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
      .map((row) => ({ itemCode: row.itemCode, name: row.name, uom: row.uom, required: row.needQty, onHand: row.onHandQty, held: row.reservedQty, onOrder: row.onOrderQty, short: row.shortage, ownShort: row.ownShort, other: Math.round((others.get(row.itemCode)?.qty ?? 0) * 1e3) / 1e3, otherOrders: others.get(row.itemCode)?.orders ?? [] }))
      .sort((a, b) => (b.short > 0) - (a.short > 0) || a.itemCode.localeCompare(b.itemCode));
  }
  // เคมีของใบร่าง: งาน RB ที่ใบจะได้ตอนปล่อยผลิต (rules.draftRubberJobs) แปลงเป็น WO ชั่วคราวด้วยกฎเดียวกับที่ฐานข้อมูลเปิด WO ให้ตอนปล่อย (private.bom_open_rf_orders:
  // สูตร = สูตร RubberFlow ที่อนุมัติแล้วของสูตรยางบนเส้นยาง · กิโลกรัม = helpers.rbJobKg เผื่อ 5% เมื่อไม่มีบรรทัดสูตรยาง) แล้วคิดด้วย rules.chemicalNeeds ของ RubberFlow ตัวเดียวกับหน้าต่างสั่งซื้อหลังปล่อย
  // ตัวเลขจึงตรงกับการตรวจหลังปล่อย ตราบใดที่ BOM ยอดนับ สูตร และสต็อกไม่เปลี่ยนระหว่างนั้น · เส้นยางที่ยังเปิด WO ไม่ได้ (ไม่ผูกสูตร/สูตรยังไม่อนุมัติ) ไม่ถูกนับ และบอกเหตุผลไว้ใน skipped เหมือนหลังปล่อย
  // WO ชั่วคราวของใบร่างหนึ่งใบ (ใช้กับใบที่ถามและใบร่างอื่น กฎเดียวกัน) · orders = WO ที่เปิดได้ · skipped = เส้นยางที่เปิดไม่ได้พร้อมเหตุผล
  function draftTempOrders(ctx, order, recipes) {
    const orders = [];
    const skipped = [];
    for (const job of ctx.rules.draftRubberJobs(order)) {
      const item = itemOf(ctx, job.itemCode);
      const code = item?.rubber?.compound;
      const compound = code ? ctx.data.compounds.find((entry) => entry.code === code) : null;
      const recipe = compound?.recipeId ? recipes.find((row) => row.id === compound.recipeId) : null;
      const kg = item ? ctx.helpers.rbJobKg(job, item, { scrapPct: 5, bom: approvedBomOf(ctx, item.code) }) : 0;
      const reason = !code ? "ไม่มีรหัสสูตรยาง" : !compound?.recipeId ? "ยังไม่ผูกสูตร RubberFlow" : recipe?.status !== "approved" ? `สูตร ${compound.recipeId} ยังไม่อนุมัติ` : !(kg > 0) ? "คำนวณกิโลกรัมไม่ได้" : "";
      if (reason) skipped.push({ itemCode: job.itemCode, reason });
      else orders.push({ id: `DRAFT:${order.id}:${job.itemCode}`, status: "planned", recipeId: recipe.id, recipeRevision: recipe.revision, targetQty: job.qtyPlanned, targetKg: kg, uom: job.uom });
    }
    return { orders, skipped };
  }
  // เหมือนของซื้อ (draftPartRows): ใบร่างอื่นที่คำนวณของก่อนใบนี้ (rules.draftBefore) จองเคมีไปก่อน = เข้ายอดจอง (reservedOrders = WO ชั่วคราวของใบเหล่านั้น ส่งให้ RubberFlow นับเป็น WO อื่นที่ยังเปิด)
  // ใบที่คำนวณทีหลังเป็นข้อมูลให้ดู (other / otherOrders) ไม่เข้าสูตรขาด/พอ · ใบที่ปล่อยผลิตแล้วมี WO จริงใน RubberFlow อยู่แล้ว ใบร่างไม่ตัดหน้า
  function draftChemicals(ctx, order) {
    const jobs = ctx.rules.draftRubberJobs(order);
    const rf = ctx.rubberflow();
    const none = { jobs: jobs.length, ready: true, rows: [], skipped: [], orders: [], reservedOrders: [] };
    if (!jobs.length || !rf?.draftChemicalNeeds || !pages.tools?.rfRecipes) return none;
    const recipes = pages.tools.rfRecipes(ctx); // RubberFlow ยังไม่ได้โหลด: สั่งโหลดให้ แล้วหน้าวาดใหม่เองเมื่อเสร็จ
    if (!pages.tools.rfReady(ctx)) return { ...none, ready: false };
    const { orders, skipped } = draftTempOrders(ctx, order, recipes);
    if (!orders.length) return { jobs: jobs.length, ready: true, rows: [], skipped, orders, reservedOrders: [] };
    const reservedOrders = [];
    const later = new Map(); // รหัสเคมี → { kg, orders: [เลขใบ] } ของใบร่างที่คำนวณทีหลัง
    for (const other of ctx.data.orders) {
      if (other.status !== "draft" || other.id === order.id || !other.explosion?.length) continue;
      const theirs = draftTempOrders(ctx, other, recipes).orders;
      if (!theirs.length) continue;
      if (ctx.rules.draftBefore(other, order)) { reservedOrders.push(...theirs); continue; }
      for (const row of rf.draftChemicalNeeds(theirs)?.rows ?? []) {
        const entry = later.get(row.materialCode) ?? { kg: 0, orders: [] };
        entry.kg += row.needKg;
        entry.orders.push(other.id);
        later.set(row.materialCode, entry);
      }
    }
    const needs = orders.length ? rf.draftChemicalNeeds(orders, reservedOrders) : null;
    const rows = (needs?.rows ?? []).map((row) => ({ itemCode: row.materialCode, name: row.name, uom: "kg", required: row.needKg, onHand: row.onHandKg, held: row.reservedKg, onOrder: row.onOrderKg, short: row.shortageKg, ownShort: Math.min(row.shortageKg, Math.round(Math.max(0, row.needKg - row.onHandKg - row.onOrderKg) * 1e3) / 1e3), other: Math.round((later.get(row.materialCode)?.kg ?? 0) * 1e3) / 1e3, otherOrders: later.get(row.materialCode)?.orders ?? [] }))
      .sort((a, b) => (b.short > 0) - (a.short > 0) || a.itemCode.localeCompare(b.itemCode));
    return { jobs: jobs.length, ready: true, rows, skipped, orders, reservedOrders };
  }
  // ตาราง ต้องใช้ เทียบ ของที่มี ของขั้น 2 (ใช้ทั้งของซื้อและเคมี): ชุดคอลัมน์เดียวกันทุกใบ (ไม่มีคอลัมน์ที่โผล่เฉพาะบางใบ) · รายการที่พอพับไว้เมื่อมีรายการขาด
  // ใบนี้ขาด = ใบนี้ใบเดียวเทียบของที่มี + สั่งแล้ว · รวมทุกใบขาด = ที่ต้องสั่งซื้อจริง (รวมที่ใบอื่นจองไว้ก่อน) · ใบอื่นต้องใช้ = ที่ใบอื่นจองไว้ + ใบร่างที่คำนวณทีหลังต้องใช้ (แยกรายละเอียดไว้ใน title)
  function needTable(ctx, rows, firstHead, heldTitle, noun = firstHead) {
    const { ui, rules } = ctx;
    const short = rows.filter((row) => row.short > 0);
    const enough = rows.filter((row) => row.short <= 0);
    const fmt = (row, value) => esc(`${rules.fmtQty(value)} ${uomText(ctx, row.uom)}`);
    const dash = '<span class="muted">—</span>';
    const othersCell = (row) => {
      const total = Math.round(((Number(row.held) || 0) + (Number(row.other) || 0)) * 1e3) / 1e3;
      if (!(total > 0)) return `<td class="right">${dash}</td>`;
      const parts = [row.held > 0 ? `จองไว้แล้ว ${rules.fmtQty(row.held)}` : "", row.other > 0 ? `ใบร่างที่คำนวณทีหลังต้องใช้ ${rules.fmtQty(row.other)}${row.otherOrders.length ? ` (ใบ ${row.otherOrders.join(", ")})` : ""}` : ""].filter(Boolean);
      return `<td class="right" title="${attr(parts.join(" · "))}">${esc(rules.fmtQty(total))}</td>`;
    };
    const result = (row) => {
      if (row.short > 0) return `<strong class="bom-short-text">${fmt(row, row.short)}</strong>`;
      // พอสำหรับใบนี้ แต่ถ้ารวมที่ใบร่างอื่นต้องใช้แล้วไม่พอ บอกไว้ (ใบที่ปล่อยผลิตก่อนได้ของก่อน)
      const left = row.onHand - row.held + row.onOrder - row.required;
      return `<span class="bom-ok-text">พอ</span>${row.other > 0 && left < row.other - 1e-9 ? '<div class="small muted">ไม่พอถ้ารวมใบร่างอื่น</div>' : ""}`;
    };
    const rowHtml = (row) => `<tr${row.short > 0 ? ' class="bom-short"' : ""}><td><strong>${esc(row.name || row.itemCode)}</strong>${row.name ? `<div class="rf-mono small muted">${esc(row.itemCode)}</div>` : ""}</td><td class="right">${fmt(row, row.required)}</td><td class="right">${esc(rules.fmtQty(row.onHand))}</td>${othersCell(row)}<td class="right">${row.onOrder > 0 ? esc(rules.fmtQty(row.onOrder)) : dash}</td><td class="right">${row.ownShort > 0 ? `<strong class="bom-short-text">${esc(rules.fmtQty(row.ownShort))}</strong>` : dash}</td><td class="right">${result(row)}</td></tr>`;
    const headCells = [firstHead, { label: "ต้องใช้", className: "right" }, { label: "มีในคลัง", className: "right" }, { label: "ใบอื่นต้องใช้", className: "right", title: `${heldTitle} · และใบร่างที่คำนวณของหลังใบนี้ (ใบนี้จองก่อน) · แยกรายละเอียดดูที่ตัวเลขแต่ละแถว` }, { label: "สั่งแล้วรอรับ", className: "right" }, { label: "ใบนี้ขาด", className: "right", title: "ใบนี้ใบเดียว เทียบของที่มีในคลังและที่สั่งแล้ว" }, { label: "รวมทุกใบขาด", className: "right", title: "ที่ต้องสั่งซื้อจริง รวมที่ใบอื่นจองไว้ก่อนใบนี้ · ตัวเลขนี้ตรงกับหน้าต่างสั่งซื้อ" }];
    return `${short.length || enough.length <= 5 ? ui.table(headCells, (short.length ? short : enough).map(rowHtml)) : ""}${short.length && enough.length ? `<details class="bom-more"><summary>ดู${esc(noun)}อีก ${enough.length} รายการที่พอ</summary>${ui.table(headCells, enough.map(rowHtml))}</details>` : !short.length && enough.length > 5 ? `<details class="bom-more"><summary>ดู${esc(noun)}ทั้ง ${enough.length} รายการ</summary>${ui.table(headCells, enough.map(rowHtml))}</details>` : ""}`;
  }
  // สั่งซื้อของที่ขาดของใบร่างได้เมื่อข้อมูลอยู่ในฐานข้อมูล (ใบสั่งซื้อเป็นของ RubberFlow) และผู้ใช้เป็นฝ่ายวางแผนหรือแผนก RB (เงื่อนไขเดียวกับปุ่มตรวจวัตถุดิบของใบที่ปล่อยแล้ว)
  // สิทธิ์ของหน้าต่างสั่งซื้อ (RubberFlow เป็นเจ้าของ): สั่งซื้อ = แผนก ST · กลุ่มวางแผนและ RB เปิดดูได้อย่างเดียว
  const rfCan = (ctx, permission) => { try { return Boolean(ctx.store?.isRemote?.() && ctx.rubberflow()?.can?.(permission)); } catch { return false; } };
  const canBuyParts = (ctx) => rfCan(ctx, "purchase");
  const canViewBuy = (ctx) => rfCan(ctx, "purchase") || rfCan(ctx, "viewPurchase");
  // ---------- ขั้น 5 รับเข้า WH / ขั้น 6 ส่งมอบลูกค้า: ความคืบหน้าอย่างเดียว (ฝ่ายวางแผนดูว่าของอยู่ไหน) ----------
  // รับเข้า ส่งมอบ ปิดใบ ปิดใบ (รับไม่ครบ) และย้อนรายการทำที่โมดูลคลังสินค้าสำเร็จรูป (WH) #/wh หน้าใบนี้ (modules/wh-pages.js · ที่เดียวต่อแหล่ง) ที่นี่มีตารางดูอย่างเดียวกับลิงก์ไปที่นั่น
  const fgNum = (ctx, value) => `<td class="right rf-mono">${esc(ctx.rules.fmtQty(value))}</td>`;
  const fgProductCell = (ctx, product) => `<td>${ctx.ui.link(product.fgCode, ctx.url("items", { sel: product.fgCode }), "rf-mono")}<div class="small muted">${esc(itemOf(ctx, product.fgCode)?.name ?? "")}</div></td>`;
  // ลิงก์ไปหน้าใบของ WH เฉพาะผู้ที่เปิดโมดูล WH ได้ (ไม่พาไปหน้า "ไม่พบ") · คนอื่นเห็นข้อความบอกว่าใครทำ
  function whLink(ctx, order) {
    return deptHref("WH") ? `<div class="rf-row bom-step-next">${ctx.ui.link("ไปที่คลังสินค้าสำเร็จรูป (WH)", root.MNP_FACTORY.routeUrl("wh", { order: order.id }), "btn rf-btn")}</div>` : '<p class="small muted">คลังสินค้า (WH) เป็นผู้รับเข้า ส่งมอบ และปิดใบ</p>';
  }
  function receiveProgress(ctx, order, pos) {
    const { ui, rules } = ctx;
    const closedOrder = order.status === "completed";
    const head = ["สินค้า", { label: "สั่ง", className: "right" }, { label: "PK ส่งให้ WH แล้ว", className: "right", title: "จำนวนที่แผนก PK กดส่งให้ WH (รับเข้าได้ไม่เกินจำนวนนี้)" }, { label: "รับเข้า WH แล้ว", className: "right" },
      ...(pos.anyFromStock ? [{ label: "ได้จากสต็อก", className: "right", title: "สินค้าสำเร็จรูปที่ใบนี้รับมาจากสต็อกของใบอื่นตอนปล่อยผลิต ไม่ต้องรับเข้า" }] : []),
      { label: closedOrder ? "รอรับ (ส่วนเกิน)" : "รอรับ", className: "right" }];
    const rows = pos.products.map((product) => `<tr>${fgProductCell(ctx, product)}${fgNum(ctx, product.ordered)}${fgNum(ctx, product.pkSent ?? product.pkDone)}${fgNum(ctx, product.own)}${pos.anyFromStock ? fgNum(ctx, product.fromStock) : ""}${fgNum(ctx, product.receivable)}</tr>`);
    const waiting = pos.waitingProduction
      ? ui.callout("info", `ยังปิดใบไม่ได้: งานของแผนก ${esc(pos.openDepts.map((dept) => `${deptName(ctx, dept)} (${dept})`).join(", "))} ยังไม่เสร็จ · แผนกนั้นรายงานผลให้เสร็จ หรือฝ่ายวางแผนปิดงานที่จะไม่ทำต่อ แล้ว WH ปิดใบ`)
      : pos.canClose ? ui.callout("info", "ทุกแผนกปิดงานและรับสินค้าครบแล้ว รอคลังสินค้า (WH) ปิดใบ") : "";
    const closed = pos.shortClose ? ui.callout("info", `ปิดใบโดยรับไม่ครบ: ${esc(pos.shortClose.reason)} (${esc(pos.shortClose.by)} · ${esc(rules.fmtDateTime(pos.shortClose.at))})`) : "";
    const surplus = closedOrder && pos.anyReceivable ? ui.callout("info", "ใบนี้ปิดแล้ว ส่วนที่ PK ผลิตเกินจำนวนสั่งรอ WH รับเข้าเป็นสต็อกสินค้าสำเร็จรูป") : "";
    const covered = pos.coveredByStock ? ui.callout("info", "ใบนี้ได้สินค้าครบจากสต็อกสินค้าสำเร็จรูป ไม่มีงานผลิตและไม่มีของให้รับเข้า ไปที่ขั้นส่งมอบลูกค้า") : "";
    return ui.card(`${covered}${closed}${surplus}${waiting}${ui.table(head, rows, { emptyText: "ใบนี้ไม่มีสินค้า" })}${whLink(ctx, order)}`, { title: "ขั้น 5 · รับเข้า WH" });
  }
  function deliverProgress(ctx, order, pos) {
    const { ui, rules } = ctx;
    const anyGiven = pos.products.some((product) => product.givenAway > 0);
    const head = ["สินค้า", { label: "มีของในใบนี้", className: "right", title: "รับเข้า WH จากงานผลิตของใบนี้ รวมที่ได้จากสต็อกสินค้าสำเร็จรูป" },
      ...(anyGiven ? [{ label: "ให้ใบอื่นแล้ว", className: "right", title: "สินค้าที่ใบสั่งผลิตอื่นนำไปใช้จากสต็อกสินค้าสำเร็จรูปของใบนี้" }] : []),
      { label: "ส่งมอบแล้ว", className: "right" }, { label: "คงเหลือส่งมอบได้", className: "right" }];
    const rows = pos.products.map((product) => `<tr>${fgProductCell(ctx, product)}${fgNum(ctx, product.have)}${anyGiven ? fgNum(ctx, product.givenAway) : ""}${fgNum(ctx, product.delivered)}<td class="right rf-mono">${esc(rules.fmtQty(product.deliverable))}${product.free > 0 ? `<div class="small muted">เกินที่สั่ง ${esc(rules.fmtQty(product.free))}</div>` : ""}</td></tr>`);
    return ui.card(`${ui.table(head, rows, { emptyText: "ใบนี้ไม่มีสินค้า" })}${pos.anyFree ? '<p class="small muted">ส่วนที่เกินที่สั่งเป็นสต็อกสินค้าสำเร็จรูป ใบสั่งผลิตอื่นนำไปใช้ได้</p>' : ""}${whLink(ctx, order)}`, { title: "ขั้น 6 · ส่งมอบลูกค้า" });
  }

  // สต็อกสินค้าสำเร็จรูป (ขั้น 2): สินค้าของใบร่างที่มีสต็อกให้ใช้ (สต็อก = ส่วนที่ใบอื่นผลิตเกินและยังไม่มีใบไหนใช้) · ฝ่ายวางแผนตั้งยอดที่ใช้จากสต็อก (ช่องเสนอยอดสูงสุดที่ใช้ได้ จะบันทึกเมื่อกดบันทึก) คนอื่นเห็นยอดที่บันทึกไว้อย่างเดียว
  // ยอดนี้ลดงานของทุกแผนก (ตารางต้องใช้ด้านล่างและงานที่ปล่อยผลิตคิดจาก rules.netRequirements) · ของถูกหักจริงตอนปล่อยผลิต ใบที่ปล่อยผลิตก่อนได้ของก่อน (rules.fgStockForDraft: available = สต็อก − ที่ใบร่างที่คำนวณก่อนตั้งใช้ไว้)
  function fgStockSection(ctx, order) {
    const { ui, rules } = ctx;
    const rows = rules.fgStockForDraft(ctx.data, order).filter((row) => row.stock > 0 || (row.planned ?? 0) > 0);
    if (!rows.length) return "";
    const canSet = ctx.helpers.canPlanOrders(ctx.user); // ตั้งยอดที่ใช้จากสต็อก = กลุ่มวางแผนของใบสั่งผลิต (20261226010000)
    const unit = (row) => esc(uomText(ctx, itemOf(ctx, row.fgCode)?.uom ?? "set"));
    const editable = (row) => canSet && (row.max > 0 || row.planned !== null);
    const cell = (row) => {
      if (!editable(row)) return row.planned > 0 ? `${esc(rules.fmtQty(row.planned))} <span class="small muted">${unit(row)}</span>` : '<span class="muted">—</span>';
      return `<input type="hidden" name="itemCode[]" value="${attr(row.fgCode)}"><label class="bom-count-input"><span class="sr-only">${esc(`ใช้จากสต็อกสินค้าสำเร็จรูป ${row.fgCode} (ไม่เกิน ${rules.fmtQty(row.max)})`)}</span><input class="input rf-input" name="qty[]" type="number" inputmode="decimal" step="any" min="0" max="${attr(row.max)}" value="${attr(row.planned ?? row.max)}"><span class="small muted">${unit(row)}</span></label>`;
    };
    const body = rows.map((row) => `<tr><td>${ui.link(row.fgCode, ctx.url("items", { sel: row.fgCode }), "rf-mono")}<div class="small muted">${esc(itemOf(ctx, row.fgCode)?.name ?? "")}</div></td><td class="right rf-mono">${esc(rules.fmtQty(row.available))}${row.taken > 0 ? `<div class="small muted">ใบร่างที่คำนวณก่อนตั้งใช้ไว้ ${esc(rules.fmtQty(row.taken))}</div>` : ""}</td><td class="right">${cell(row)}${row.planned !== null && row.planned > row.available + 1e-9 ? '<div class="small bom-short-text">เกินสต็อกที่เหลือ กรอกใหม่</div>' : ""}</td></tr>`);
    const table = ui.table(["สินค้าสำเร็จรูป", { label: "สต็อกที่ใช้ได้", className: "right", title: "สต็อกสินค้าสำเร็จรูปที่ใบอื่นผลิตเกินไว้และยังไม่มีใบไหนใช้ ลบที่ใบร่างที่คำนวณก่อนใบนี้ตั้งใช้ไว้" }, { label: "ใช้จากสต็อก", className: "right", title: "ลดงานผลิตของทุกแผนกลงตามจำนวนนี้ ของถูกหักเมื่อปล่อยผลิต ใบที่ปล่อยผลิตก่อนได้ก่อน" }], body);
    const form = canSet && rows.some(editable)
      ? `<form novalidate data-rf-form="setStockCounts" data-rf-args="${attr(JSON.stringify({ orderId: order.id }))}" data-rf-success="บันทึกยอดที่ใช้จากสต็อกสินค้าสำเร็จรูป {result}">${table}<div class="rf-row bom-step-next"><button class="btn rf-btn secondary" type="submit">บันทึกยอดที่ใช้จากสต็อก</button></div></form>`
      : table;
    return `<h3 class="bom-h3">สต็อกสินค้าสำเร็จรูป</h3>${form}`;
  }

  pages.orderSteps = (ctx, order, { net, buttons }) => {
    const { ui, rules, data, params } = ctx;
    const current = orderStepOf(ctx, order);
    const canPlan = ctx.helpers.canPlan(ctx.user);
    // ใบร่างที่มีสินค้าแล้ว: ดูขั้น 2 หรือ 3 ได้ (step=3 จากปุ่ม "ไปขั้นปล่อยผลิต") · สถานะอื่นดูขั้นปัจจุบันเท่านั้น
    // ขั้น 5/6 ดูได้ตั้งแต่ปล่อยผลิต: คลังสินค้ารับเข้าได้ระหว่างที่ผลิตยังไม่เสร็จ (เมื่อ PK รายงานยอดแล้ว) และส่งมอบได้ตั้งแต่รับเข้าครั้งแรก · ใบที่ปิดแล้วดูได้ทั้งสองขั้น
    const pos = rules.fgPosition(data, order);
    const reach = (no) => current >= 4 && (no === 5 ? current >= 5 || pos.anyReceivable || pos.anyReceived || pos.anyFromStock : no === 6 ? current >= 6 || pos.anyHave : false);
    const want = Number(params.get("step"));
    const view = current === 2 && want === 3 ? 3 : (want === 5 || want === 6) && reach(want) ? want : current >= 7 ? 6 : current;
    const stepUrl = (no) => ctx.url("orders", { sel: order.id, step: [3, 5, 6].includes(no) ? String(no) : null });
    const bar = `<ol class="bom-steps" aria-label="ขั้นตอนของใบสั่งผลิต">${STEPS.map((step) => {
      // ขั้น 1-3 (ใบร่าง): ขั้นก่อนขั้นที่ดูถือว่าเสร็จ · ขั้น 4 ขึ้นไป: เสร็จเฉพาะขั้นก่อนขั้นปัจจุบัน (ดูขั้น 5/6 ล่วงหน้าได้โดยขั้น 4 ยังไม่เสร็จ) · ใบที่ส่งมอบครบ = เสร็จทุกขั้น
      const state = current === 0 ? "off" : current >= 7 ? "done" : current <= 3 ? (step.no < Math.max(current, view) ? "done" : step.no === view ? "now" : "todo") : step.no === view ? "now" : step.no < current ? "done" : "todo";
      // ใบที่ได้สินค้าครบจากสต็อกไม่มีงานผลิตและไม่มีของให้รับเข้า: ขั้น 4-5 ข้าม (ปล่อยผลิตแล้วไปที่ส่งมอบ)
      const skipped = pos.coveredByStock && (step.no === 4 || step.no === 5);
      const inner = `<span class="bom-step-no">${skipped ? "ข้าม" : state === "done" ? "เสร็จ" : `ขั้น ${step.no}`}</span><strong>${esc(step.label)}</strong><span class="small">${esc(skipped ? "ใช้สต็อกสินค้าสำเร็จรูป" : step.who)}</span>`;
      const link = step.no !== view && ((current === 2 && [2, 3].includes(step.no)) || ([5, 6].includes(step.no) && reach(step.no)));
      return `<li class="bom-step is-${state}"${state === "now" ? ' aria-current="step"' : ""}>${link ? `<a href="${attr(stepUrl(step.no))}">${inner}</a>` : `<div>${inner}</div>`}</li>`;
    }).join("")}</ol>`;
    let panel = "";
    let draftOrders = [];
    let reservedDraftOrders = [];
    // ใบที่ยกเลิก: เหตุผล และคืนของซื้อที่เบิกไปแล้ว (ปุ่มคืนของเหลือ เมื่อยังมีของที่คืนได้)
    if (current === 0) panel = `${ui.callout("warn", `ใบนี้ถูกยกเลิก${order.cancelReason ? `: ${esc(order.cancelReason)}` : ""}`)}${buttons.returnParts ? `<div class="rf-row bom-step-next">${buttons.returnParts}</div>` : ""}`;
    else if (view === 1) panel = ui.card(`<p>เพิ่มสินค้าที่ลูกค้าสั่งลงในใบ แล้วระบบจะพาไปขั้นตรวจของ</p><div class="rf-row">${buttons.add ?? ""}</div>`, { title: "ขั้น 1 · รายการสินค้า" });
    else if (view === 2) {
      if (!order.explosion?.length) panel = ui.card(`<p>ยังไม่ได้คำนวณว่าใบนี้ต้องใช้อะไรเท่าไร</p><div class="rf-row">${buttons.explode ?? ""}</div>`, { title: "ขั้น 2 · ตรวจของ" });
      else {
        const parts = draftPartRows(ctx, order);
        const short = parts.filter((row) => row.short > 0);
        const chem = draftChemicals(ctx, order);
        const chemShort = chem.rows.filter((row) => row.short > 0);
        draftOrders = chem.orders;
        reservedDraftOrders = chem.reservedOrders;
        const table = parts.length ? needTable(ctx, parts, "ของซื้อ", "ใบสั่งผลิตอื่นที่ปล่อยผลิตแล้วและยังไม่ได้เบิกจ่าย และใบร่างที่คำนวณของก่อนใบนี้") : ui.empty("ใบนี้ไม่มีของซื้อ");
        // เคมีของเส้นยาง: มีเมื่อใบนี้ต้องรีดเส้นยาง · เส้นยางที่ยังไม่ผูกสูตร RubberFlow ประเมินไม่ได้ (และจะไม่ได้ WO ตอนปล่อยผลิต) บอกเหตุผลให้ไปแก้ก่อน
        const skippedNote = chem.skipped.length ? ui.callout("warn", `เส้นยาง ${chem.skipped.length} จาก ${chem.jobs} รายการยังประเมินเคมีไม่ได้${ctx.store?.isRemote?.() ? " และจะยังไม่ได้ WO ตอนปล่อยผลิต" : ""}: ${chem.skipped.slice(0, 5).map((entry) => `<span class="rf-mono">${esc(entry.itemCode)}</span> ${esc(entry.reason)}`).join(" · ")}${chem.skipped.length > 5 ? ` และอีก ${chem.skipped.length - 5}` : ""}${ctx.canSee("compounds") ? ` · ${ui.link("ไปผูกสูตรยาง", ctx.url("compounds"))}` : ""}`) : "";
        const chemHtml = !chem.jobs ? "" : !chem.ready ? '<p class="small muted">กำลังโหลดข้อมูลเคมีจาก RubberFlow…</p>' : `${chem.rows.length ? needTable(ctx, chem.rows, "เคมีของเส้นยาง", "ใบเบิกที่ค้างจ่าย WO อื่นที่ยังเปิดอยู่ และใบร่างที่คำนวณของก่อนใบนี้", "เคมี") : ""}${skippedNote}`;
        // ชิ้นงานค้างในไลน์ไม่นับเส้นยาง (เส้นยางใช้จากคลังแท่งยาวในส่วนของมันเอง)
        const rodCodes = rules.rodCodesOf(order);
        const counted = rules.countedCodes(order).filter((code) => !rodCodes.has(code)).length;
        const wip = `<div class="bom-step-line"><div><strong>ชิ้นงานค้างในไลน์ที่ใช้แทนได้</strong><div class="small muted">${counted ? esc(`กรอกยอดแล้ว ${counted} รายการ ระบบหักออกจากยอดที่ต้องผลิต`) : "ยังไม่ได้กรอก ถ้าไม่กรอก ระบบสั่งผลิตเต็มจำนวน"}</div></div>${ctx.helpers.canCount(ctx.user) ? ui.link(counted ? "แก้ยอดที่กรอก" : "กรอกยอดที่มีอยู่", ctx.url("count", { order: order.id }), "btn rf-btn secondary") : ""}</div>`;
        // สั่งซื้อส่วนที่ขาด (ของซื้อและเคมี) ได้ตั้งแต่ใบยังเป็นร่าง ด้วยหน้าต่างสั่งซื้อเดียวกับหลังปล่อยผลิต (ผู้ที่สั่งซื้อได้ = ฝ่ายวางแผนหรือแผนก RB) · ใช้ได้เมื่อข้อมูลอยู่ในฐานข้อมูล (ใบสั่งซื้อเป็นของ RubberFlow)
        const lacks = short.length || chemShort.length;
        const buy = lacks && canBuyParts(ctx) ? `<div class="rf-row bom-step-next"><button class="btn rf-btn" type="button" data-bom-draft-buy>สั่งซื้อส่วนที่ขาด</button></div>`
          : lacks && canViewBuy(ctx) ? `<div class="rf-row bom-step-next"><span class="small muted">คลังวัตถุดิบ (ST) เป็นผู้สั่งซื้อ</span><button class="btn rf-btn secondary" type="button" data-bom-draft-buy>ดูรายการที่ต้องสั่ง</button></div>` : "";
        // หัวการ์ดไม่สรุปของซื้อ/เคมี: ตารางในการ์ดเดียวกันแสดงขาด/พอรายแถวอยู่แล้ว (แสดงข้อเท็จจริงครั้งเดียว)
        panel = ui.card(`${fgStockSection(ctx, order)}${rodStockSection(ctx, order)}${table}${chemHtml}${buy}${wip}<div class="rf-row bom-step-next">${buttons.explode ? buttons.explode.replace("คำนวณวัตถุดิบ", "คำนวณใหม่") : ""}${canPlan ? ui.link("ไปขั้น 3 ปล่อยผลิต", stepUrl(3), "btn rf-btn") : ""}</div>`,
          { title: "ขั้น 2 · ตรวจของ" });
      }
    } else if (view === 3) {
      const entries = [...net.values()].filter((entry) => (entry.toMake ?? entry.required) > 0);
      const made = entries.filter((entry) => entry.kind !== "PURCHASED" && entry.kind !== "CP");
      const partCount = entries.filter((entry) => entry.kind === "PURCHASED").length;
      const byDept = rules.FLOW_DEPTS.filter((dept) => dept !== "ST").map((dept) => [dept, made.filter((entry) => entry.dept === dept).length]).filter(([, count]) => count);
      const short = order.explosion?.length ? draftPartRows(ctx, order).filter((row) => row.short > 0) : [];
      const chemShort = order.explosion?.length ? draftChemicals(ctx, order).rows.filter((row) => row.short > 0) : [];
      const noBomRows = rules.noBomInOrder(order);
      const noBom = noBomRows.map((row) => row.code);
      // ผู้แก้ BOM ได้: เปิดตารางสร้าง BOM ของสินค้าตัวแรกในใบที่ใช้ชิ้นนั้น (เห็นทุกชั้น แถวของชิ้นนั้นถูกทำแถบสีไว้ กด "+ ลูก" ที่แถวนั้น) · ไม่มีสินค้าแม่ = ตารางของชิ้นนั้นเอง
      // คนอื่นเปิดหน้าของรายการ
      const noBomUrl = (row) => (!canPlan ? ctx.url("find", { code: row.code }) : row.fgs.length ? ctx.url("build", { code: row.fgs[0].fgCode, focus: row.code, order: order.id }) : ctx.url("build", { code: row.code }));
      const list = `<dl class="bom-release-list">${partCount ? `<dt>${deptChip(ctx, "ST")} ${esc(deptName(ctx, "ST"))}</dt><dd>เบิกของ ${partCount} รายการ</dd>` : ""}${byDept.map(([dept, count]) => `<dt>${deptChip(ctx, dept)} ${esc(deptName(ctx, dept))}</dt><dd>${count} งาน</dd>`).join("")}</dl>`;
      const lacking = [short.length ? `ของซื้อ ${short.length} รายการ` : "", chemShort.length ? `เคมี ${chemShort.length} รายการ` : ""].filter(Boolean).join(" และ");
      // สินค้าสำเร็จรูปที่ใช้จากสต็อก: หักจริงตอนปล่อยผลิต · สต็อกไม่พอแล้ว (ใบอื่นปล่อยไปก่อน) ปล่อยผลิตไม่ได้จนกว่าจะตั้งยอดใหม่ · ได้ครบทุกสินค้า = ไม่มีงานผลิต ใบปิดทันทีแล้วไปส่งมอบลูกค้า
      const fgRows = order.explosion?.length ? rules.fgStockForDraft(data, order).filter((row) => (row.planned ?? 0) > 0) : [];
      const fgLack = fgRows.filter((row) => row.planned > row.stock + 1e-9);
      const fgAll = order.items.length > 0 && order.items.every((item) => (fgRows.find((row) => row.fgCode === item.fgCode)?.planned ?? 0) + 1e-9 >= item.qty);
      // เส้นยางที่ใช้จากคลังแท่งยาว (SR): หักจากสต็อกกลางจริงตอนปล่อยผลิต · สต็อกกลางไม่พอแล้ว (ใบอื่นปล่อยไปก่อน) ปล่อยผลิตไม่ได้จนกว่าจะตั้งยอดใหม่
      const rodRows = order.explosion?.length ? rules.rodStockForDraft(data, order).filter((row) => (row.planned ?? 0) > 0) : [];
      const rodLack = rodRows.filter((row) => row.planned > row.stock + 1e-9);
      const rodLine = rodRows.length ? `<p>ใช้ยางเส้นยาวจากคลังยางเส้นยาว (SR) ${rodRows.map((row) => `<span class="rf-mono">${esc(row.itemCode)}</span> × ${esc(rules.fmtQty(row.planned))}`).join(", ")} หักจากคลังเมื่อปล่อยผลิต ล็อตเก่าก่อน</p>` : "";
      const fgLine = fgRows.length ? `<p>ใช้สต็อกสินค้าสำเร็จรูป ${fgRows.map((row) => `<span class="rf-mono">${esc(row.fgCode)}</span> × ${esc(rules.fmtQty(row.planned))}`).join(", ")} หักจากสต็อกเมื่อปล่อยผลิต (ใบที่ปล่อยผลิตก่อนได้ของก่อน)${fgAll ? " · ได้ครบทุกสินค้า ไม่มีงานผลิต ปล่อยแล้วใบปิดทันทีและไปที่ขั้นส่งมอบลูกค้า" : ""}</p>` : "";
      const warns = [
        !order.explosion?.length ? ui.callout("warn", "ยังไม่ได้คำนวณของที่ต้องใช้ กลับไปขั้น 2 ก่อน") : "",
        fgLack.length ? ui.callout("bad", `ปล่อยผลิตไม่ได้ สต็อกสินค้าสำเร็จรูปไม่พอที่ตั้งใช้: ${fgLack.map((row) => `${esc(row.fgCode)} เหลือ ${esc(rules.fmtQty(row.stock))} ตั้งใช้ ${esc(rules.fmtQty(row.planned))}`).join(", ")} · ${ui.link("กลับไปตั้งยอดใหม่ที่ขั้น 2", stepUrl(2))}`) : "",
        rodLack.length ? ui.callout("bad", `ปล่อยผลิตไม่ได้ คลังยางเส้นยาว (SR) มีสต็อกกลางไม่พอที่ตั้งใช้: ${rodLack.map((row) => `${esc(row.itemCode)} เหลือ ${esc(rules.fmtQty(row.stock))} ตั้งใช้ ${esc(rules.fmtQty(row.planned))}`).join(", ")} · ${ui.link("กลับไปตั้งยอดใหม่ที่ขั้น 2", stepUrl(2))}`) : "",
        noBom.length ? ui.callout("bad", `<div>ปล่อยผลิตไม่ได้ ชิ้นงานที่ยังไม่มี BOM · ${canPlan ? "กดรหัสเพื่อเปิด BOM ของสินค้าที่ใช้ชิ้นนั้น แล้วเพิ่มส่วนประกอบที่แถวของชิ้นนั้น" : "กดรหัสเพื่อดูรายการ"}</div><div class="rf-row bom-nobom-links">${noBomRows.map((row) => ui.link(row.code, noBomUrl(row), "btn rf-btn secondary small rf-mono")).join("")}</div>`) : "",
        lacking ? ui.callout("warn", `ยังขาด${lacking} และยังไม่ได้สั่ง ปล่อยผลิตได้ แต่แผนกที่ใช้ของนั้นจะติดจนกว่าของจะเข้า${canBuyParts(ctx) ? ` · ${ui.link("กลับไปสั่งซื้อที่ขั้น 2", stepUrl(2))}` : " · คลังวัตถุดิบ (ST) เป็นผู้สั่งซื้อ"}`) : "",
      ].join("");
      panel = ui.card(`${warns}${order.explosion?.length ? `${fgAll ? "" : `<p>ปล่อยผลิตแล้วระบบสร้างงานให้แต่ละแผนกตามนี้ และล็อกฉบับ BOM ที่ใช้</p>${list}`}${fgLine}${rodLine}` : ""}<div class="rf-row bom-step-next">${ui.link("กลับไปขั้น 2", stepUrl(2), "btn rf-btn secondary")}${noBom.length || fgLack.length || rodLack.length || !order.explosion?.length ? "" : buttons.release ?? ""}</div>`, { title: "ขั้น 3 · ปล่อยผลิต" });
    } else if (view === 4) {
      const jobs = data.jobs.filter((job) => job.orderId === order.id);
      const rows = rules.FLOW_DEPTS.map((dept) => {
        const mine = jobs.filter((job) => job.dept === dept);
        if (!mine.length) return "";
        const done = mine.filter((job) => job.status === "done").length;
        // เลยกำหนด = งานที่ยังต้องทำ (helpers.isOpenJob): บรรทัดของซื้อของใบที่ปิดแล้วไม่นับ
        const late = mine.filter((job) => ctx.helpers.isOpenJob(data, job) && job.dueAt < ctx.now).length;
        // ของซื้อ: บรรทัดที่เบิกไปบางส่วนยังนับว่ารอเบิก (บอกจำนวนบรรทัดนั้นต่อท้าย) · ใบที่ปิดแล้วเบิกไม่ได้อีก บอกเฉพาะว่าเบิกไปกี่บรรทัด (รวมที่เบิกบางส่วน) ไม่มีคำว่ารอ
        const partly = mine.filter((job) => job.status !== "done" && Number(job.qtyDone) > 0).length;
        const parts = dept === "ST" && mine.every((job) => ctx.helpers.isPartJob(job));
        const closedParts = parts && done < mine.length && !mine.some((job) => ctx.helpers.isOpenJob(data, job));
        const issued = done + partly;
        const text = parts ? (done === mine.length ? `เบิกของครบ ${mine.length} รายการ` : closedParts ? `เบิกไป ${issued} จาก ${mine.length} รายการ` : `รอเบิกของ ${mine.length - done} จาก ${mine.length} รายการ${partly ? ` (เบิกไปบางส่วน ${partly} รายการ)` : ""}`) : `เสร็จ ${done} จาก ${mine.length} งาน`;
        return `<tr><td>${deptChip(ctx, dept)} ${esc(deptName(ctx, dept))}</td><td class="rf-progress-cell">${ui.progress(closedParts ? issued : done, mine.length)}<div class="small muted">${esc(text)}</div></td><td>${late ? ui.badge("bad", `เลยกำหนด ${late} งาน`) : ""}</td><td class="right">${(canPlan || ctx.user?.dept === dept) && deptHref(dept) ? ui.link("ดูงาน", deptHref(dept), "btn rf-btn secondary small") : ""}</td></tr>`;
      }).filter(Boolean);
      // มีสินค้าที่ PK ส่งมอบแล้วรอรับเข้าคลัง: บอกเฉพาะว่ามี (ตัวเลขอยู่ในขั้น 5) · คลังสินค้ารับเข้าได้ก่อนผลิตครบทั้งใบ
      // รับครบแล้วแต่ยังมีแผนกที่งานไม่เสร็จ (แผนกอยู่ในตารางข้างบน): ใบปิดเมื่อทุกแผนกปิดงาน · ทุกแผนกปิดงานแล้ว (เหลือแค่เบิกของซื้อ) = รอคลังสินค้า (WH) ปิดใบที่ขั้น 5
      const fgLine = pos.anyReceivable ? `<div class="bom-step-line"><div><strong>มีสินค้ารอรับเข้า WH</strong></div>${ui.link("ไปขั้นรับเข้า WH", stepUrl(5), "btn rf-btn secondary")}</div>`
        : pos.waitingProduction ? '<div class="bom-step-line"><div><strong>รับสินค้าเข้า WH ครบแล้ว</strong><div class="small muted">ใบปิดได้เมื่อทุกแผนกปิดงาน</div></div></div>'
        : pos.canClose ? `<div class="bom-step-line"><div><strong>ทุกแผนกปิดงานและรับสินค้าครบแล้ว รอคลังสินค้า (WH) ปิดใบ</strong></div>${ui.link("ไปขั้นรับเข้า WH", stepUrl(5), "btn rf-btn secondary")}</div>`
        // PK ทำครบและรับเข้าคลังหมดแล้วแต่ยังน้อยกว่าที่สั่ง: คลังสินค้า (WH) ปิดใบ (รับไม่ครบ) ได้แล้ว
        : pos.canCloseShort ? `<div class="bom-step-line"><div><strong>PK ทำครบและรับเข้า WH แล้ว รอคลังสินค้า (WH) ปิดใบ (รับไม่ครบ)</strong></div>${ui.link("ไปขั้นรับเข้า WH", stepUrl(5), "btn rf-btn secondary")}</div>`
        // รับเข้าครบตามที่ PK ทำแล้วแต่ยังน้อยกว่าที่สั่งและยังมีงานผลิตเปิด (อาจกำลังผลิตอยู่ตามปกติ): บอกทางออกแบบมีเงื่อนไข ไม่ชวนให้ปิดงานที่ยังทำต่อ
        : pos.waitingShort ? `<div class="bom-step-line"><div><strong>รับเข้า WH ครบตามที่ PK ทำแล้ว แต่ยังน้อยกว่าที่สั่ง</strong><div class="small muted">${esc(`ถ้าแผนก ${pos.openDepts.join(", ")} จะไม่ทำต่อ ฝ่ายวางแผนกด “ปิดงานนี้” ที่งานนั้น แล้วคลังสินค้า (WH) ปิดใบ (รับไม่ครบ)`)}</div></div></div>` : "";
      const main = `<div class="rf-row bom-step-next">${buttons.issue ?? ""}${buttons.check ?? ""}</div>${fgLine}`;
      panel = ui.card(`${ui.table(["แผนก", "ความคืบหน้า", "", ""], rows, { emptyText: "ยังไม่มีงาน" })}${main}`, { title: "ขั้น 4 · ผลิตตามแผนก", flush: false });
    } else if (view === 5) panel = receiveProgress(ctx, order, pos);
    else if (view === 6) {
      // ใบปิดแล้วแต่ PK ผลิตเกินและยังไม่ได้รับเข้าคลัง: หน้าเปิดที่ขั้น 6 จึงบอกที่นี่ว่ามีส่วนเกินรอรับ (ตัวเลขอยู่ในขั้น 5)
      const surplusLine = order.status === "completed" && pos.anyReceivable ? `<div class="bom-step-line"><div><strong>มีส่วนที่ PK ผลิตเกินรอรับเข้า WH</strong></div>${ui.link("ไปขั้นรับเข้า WH", stepUrl(5), "btn rf-btn secondary")}</div>` : "";
      panel = `${surplusLine}${deliverProgress(ctx, order, pos)}`;
    }
    // used = ปุ่มที่แผงของขั้นนี้แสดงแล้ว (หรือเป็นของขั้นอื่นของใบร่าง) หน้า orders จะไม่วางซ้ำใน "คำสั่งอื่น"
    const used = ["add", "explode", "release", ...(view === 4 ? ["issue", "check"] : []), ...(current === 0 ? ["returnParts"] : [])];
    // ปุ่มสั่งซื้อของใบร่าง: หน้าต่างสั่งซื้อของ RubberFlow คิดของซื้อจากใบร่าง (sourcePi) และเคมีจาก WO ชั่วคราวชุดเดียวกับที่ตารางของขั้นนี้แสดง
    const bind = (rootNode) => {
      // มือถือ: แถบขั้นตอนเลื่อนข้างได้ ให้ขั้นปัจจุบันอยู่กลางแถบ (ตั้ง scrollLeft ของแถบเอง ไม่ใช้ scrollIntoView เพื่อไม่ให้ทั้งหน้าเลื่อนตาม) · จอกว้างที่แถบไม่เลื่อน ค่านี้ถูกตัดเป็น 0
      const barNode = rootNode.querySelector?.(".bom-steps");
      const now = barNode?.querySelector(".is-now");
      if (barNode && now) {
        const barBox = barNode.getBoundingClientRect();
        const nowBox = now.getBoundingClientRect();
        barNode.scrollLeft = nowBox.left - barBox.left + barNode.scrollLeft - (barBox.width - nowBox.width) / 2;
      }
      rootNode.querySelectorAll("[data-bom-draft-buy]").forEach((button) => button.addEventListener("click", async () => {
        button.disabled = true;
        try { await ctx.rubberflow()?.checkMaterials?.({ woIds: [], sourcePi: order.id, draftOrders, reservedDraftOrders, auto: false }); } finally { button.disabled = false; }
      }));
    };
    // งาน RB ที่ยังไม่มี WO ใน RubberFlow: คำเตือนค้างใต้แถบขั้นตอน เห็นทุกขั้นและทุกแท็บ (ไม่มีซ้ำในแท็บงาน)
    const woNote = pages.tools?.rbNoWoNote?.(ctx, order) ?? "";
    return { html: `${bar}${woNote}${panel}`, used, bind };
  };

  // งานของคลังวัตถุดิบที่ไม่ใช่งานของใบ (โหมดฐานข้อมูล): รับเข้าตามใบสั่งซื้อที่ยังรอรับ และสั่งซื้อของซื้อที่ใบยังขาด · แสดงเฉพาะผู้ที่ทำได้จริง (สิทธิ์ของ RubberFlow: แผนก ST)
  // ใช้ทั้งการ์ดในหน้างานของฉันและตัวเลขที่เมนู · ของที่ขาดคิดด้วย rules.partNeeds ตัวเดียวกับหน้าต่างสั่งซื้อ (เคมีดูที่หน้าใบ)
  // ข้อมูลเคมีและใบสั่งซื้อของ RubberFlow ยังโหลดอยู่ (บัญชีที่มีสิทธิ์ของคลังวัตถุดิบเท่านั้น): สั่งโหลดให้และวาดหน้าใหม่เมื่อเสร็จ (pages.tools.rfWake) · การ์ดของคลังวัตถุดิบจึงยังไม่ครบ
  const storeLoading = (ctx) => (rfCan(ctx, "receiveMaterial") || rfCan(ctx, "purchase")) && Boolean(pages.tools?.rfWake?.(ctx));
  function storeTasks(ctx) {
    const tasks = [];
    // ใบที่ยกเลิกแล้วที่ยังมีของซื้อเบิกจ่ายค้างนอกคลัง (เบิก − คืน > 0): การ์ดค้างจนกว่าจะคืน (ไม่มีขั้น "ไม่มีของคืน" ในฐานข้อมูล) · ผู้ทำ = ผู้ที่เบิกจ่ายได้ (ST / ฝ่ายวางแผน)
    if (ctx.helpers.canIssueParts?.(ctx.user)) {
      for (const order of ctx.data.orders) {
        if (order.status !== "cancelled") continue;
        const lines = ctx.rules.partReturnLines(ctx.data, order.id).filter((line) => line.returnable > 0);
        if (lines.length) tasks.push({ kind: "partReturn", order, lines });
      }
    }
    // เคมีที่เบิกไปแล้วของ WO ที่ถูกยกเลิก (ยกเลิกใบ / เปิดใบกลับมาแก้ / ยกเลิก WO) และยังไม่ได้รับคืน: แผนก ST (หรือ admin) รับคืนเข้าล็อตเดิมที่หน้ารับคืนของโมดูล ST
    // เฉพาะใบเดิมของคลัง ST (20261220010000) · ใบเบิกคลัง RB นั้น RB / ฝ่ายวางแผนคืนเข้าคลัง RB เองที่หน้าเบิกเคมี
    if (rfCan(ctx, "returnRequisition")) {
      const rf = (() => { try { return ctx.rubberflow()?.store?.data?.() ?? null; } catch { return null; } })();
      const rules = (() => { try { return root.MNP_RUBBERFLOW_RULES ?? null; } catch { return null; } })();
      for (const req of rf && rules?.returnableRequisitions ? rules.returnableRequisitions(rf, "ST") : []) tasks.push({ kind: "chemReturn", req, wo: (rf.orders ?? []).find((row) => row.id === req.orderId) ?? null });
    }
    // บัญชีที่ไม่มีสิทธิ์ของคลังวัตถุดิบไม่ต้องรอหรือสั่งโหลด RubberFlow (เมนูนับงานทุกหน้า)
    const purchaseOrders = rfCan(ctx, "receiveMaterial") || rfCan(ctx, "purchase") ? pages.tools?.purchaseOrdersOf?.(ctx) ?? [] : [];
    if (rfCan(ctx, "receiveMaterial")) {
      // บรรทัดที่ยังค้างรับ (รับไม่ครบยังค้างส่วนที่เหลือ จนกว่าจะรับครบหรือปิดยอดที่เหลือ · 20261128020000) · open = ยอดที่ค้าง received = ยอดที่รับแล้ว (กฎของ RubberFlow poLine*)
      const poRules = (() => { try { return root.MNP_RUBBERFLOW_RULES ?? null; } catch { return null; } })();
      for (const po of poRules ? purchaseOrders : []) {
        if (po.status !== "ordered") continue;
        const lines = (po.lines ?? []).filter((line) => poRules.poLineOpen(line) > 0).map((line) => ({ ...line, open: poRules.poLineOpen(line), received: poRules.poLineReceived(line) }));
        // ใบสั่งผลิตที่ใบสั่งซื้อนี้สั่งให้ถูกยกเลิกแล้ว: ST ตัดสินเองว่าจะยกเลิกใบสั่งซื้อ หรือรับเข้าเป็นสต็อก
        const cancelled = Boolean(po.sourcePi) && ctx.data.orders.find((order) => order.id === po.sourcePi)?.status === "cancelled";
        if (lines.length) tasks.push({ kind: "receive", po, lines, cancelled, partly: poRules.poTouched(po) });
      }
    }
    if (rfCan(ctx, "purchase")) {
      // เคมีที่ใบสั่งผลิตของ RubberFlow ที่เปิดอยู่ยังขาด (รวมใบที่ไม่ได้มาจากใบ PI): สั่งที่แท็บใบสั่งซื้อของหน้าคลัง
      const chem = (() => { try { return ctx.rubberflow()?.openChemicalNeeds?.()?.rows.filter((row) => row.shortageKg > 0) ?? []; } catch { return []; } })();
      if (chem.length) tasks.push({ kind: "chem", short: chem });
      // ของซื้อที่ขาด: หนึ่งการ์ดต่อวัตถุดิบ (ไม่ใช่ต่อใบ) บอกใบที่ต้องใช้พร้อมจำนวนของแต่ละใบ
      // ยอดที่ต้องสั่งรวม = ค่ามากสุดของ shortage ต่อใบ ไม่ใช่ผลบวก: rules.partNeeds ของแต่ละใบหักที่ใบอื่นจองไว้อยู่แล้ว (ใบที่ปล่อยผลิตแล้ว และใบร่างที่คำนวณก่อน)
      // ใบที่คำนวณหลังสุดจึงรวมความต้องการของทุกใบไว้แล้ว (เช่น ขาด 75.08 กับ 63.28 = ต้องสั่งรวม 75.08 ไม่ใช่ 138.36) · ใบนั้นคือใบที่การ์ดพาไปสั่งซื้อ (หน้าต่างสั่งซื้อของใบนั้นเติมจำนวนเท่ายอดรวม)
      const byMaterial = new Map();
      for (const order of ctx.data.orders) {
        if (!["released", "in_progress"].includes(order.status) && !(order.status === "draft" && order.explosion?.length)) continue;
        for (const row of ctx.rules.partNeeds({ jobs: ctx.data.jobs, orders: ctx.data.orders, stock: ctx.data.stock ?? [], purchaseOrders }, order.id).rows) {
          if (!(row.shortage > 0)) continue;
          const entry = byMaterial.get(row.itemCode) ?? { kind: "buy", itemCode: row.itemCode, name: row.name, uom: row.uom, total: 0, order, orders: [] };
          entry.orders.push({ orderId: order.id, need: row.needQty, short: row.shortage });
          if (row.shortage > entry.total) { entry.total = row.shortage; entry.order = order; }
          byMaterial.set(row.itemCode, entry);
        }
      }
      tasks.push(...byMaterial.values());
    }
    return tasks;
  }

  // งานของคลังสินค้า (WH): รับสินค้าเข้าคลังตามใบที่ PK ส่งมอบแล้ว · ส่งมอบให้ลูกค้าตามใบที่ปิดแล้วและยังมีของเหลือ · แสดงเฉพาะผู้ที่ทำได้จริง (canHandleFg) ใช้ทั้งการ์ดในหน้างานของฉันและตัวเลขที่เมนู
  function fgTasks(ctx) {
    if (!ctx.helpers.canHandleFg?.(ctx.user)) return [];
    const tasks = [];
    for (const order of ctx.data.orders) {
      if (!["released", "in_progress", "completed"].includes(order.status)) continue;
      const pos = ctx.rules.fgPosition(ctx.data, order);
      // ใบที่ปิดแล้วที่ PK ผลิตเกินจำนวนสั่ง: ส่วนเกินรอ WH รับเข้าเป็นสต็อกสินค้าสำเร็จรูป (surplus) · ส่งมอบ = เฉพาะส่วนที่ลูกค้าของใบรออยู่ (ส่วนเกินที่สั่งไม่ใช่งานค้าง)
      if (pos.anyReceivable) tasks.push({ kind: "fgReceive", order, surplus: order.status === "completed", lines: pos.products.filter((product) => product.receivable > 0).map((product) => ({ fgCode: product.fgCode, qty: product.receivable })) });
      // รับครบและทุกแผนกปิดงานแล้ว แต่ใบยังเปิด (รับครบก่อนงานสุดท้ายเสร็จ): คลังสินค้า (WH) ปิดใบที่ขั้น 5
      if (pos.canClose) tasks.push({ kind: "fgClose", order, lines: [] });
      // รับเข้าครบตามที่ PK ทำแล้วแต่น้อยกว่าที่สั่ง และทุกแผนกปิดงานแล้ว: คลังสินค้า (WH) ปิดใบ (รับไม่ครบ) พร้อมเหตุผล (หน้าต่าง closeShort)
      if (pos.canCloseShort) tasks.push({ kind: "fgCloseShort", order, lines: pos.products.filter((product) => product.have + 1e-9 < product.ordered).map((product) => ({ fgCode: product.fgCode, qty: product.ordered - product.have })) });
      if (order.status === "completed" && pos.anyOwed) tasks.push({ kind: "fgDeliver", order, lines: pos.products.filter((product) => product.owed > 0).map((product) => ({ fgCode: product.fgCode, qty: product.owed })) });
    }
    // รับเข้าก่อน (ของที่ PK ส่งมาแล้วรอ WH) แล้วปิดใบ แล้วส่งมอบ · ในกลุ่มเดียวกันเรียงตามวันส่งมอบคลัง
    const rank = { fgReceive: 0, fgClose: 1, fgCloseShort: 1, fgDeliver: 2 };
    return tasks.sort((a, b) => rank[a.kind] - rank[b.kind] || (Number(a.order.whDue) || 0) - (Number(b.order.whDue) || 0) || (a.order.id < b.order.id ? -1 : 1));
  }

  // ---------- คลังแท่งยาว SR (ขั้น 05–06 ของผังงาน · 20261202010000) ----------
  // งานของคลังแท่งยาว (SR): ล็อตแท่งที่รอรับเข้าคลัง (หนึ่งการ์ดต่อล็อต) และใบที่งาน GR ยังต้องใช้แท่งและคลังมีแท่งให้จ่าย (หนึ่งการ์ดต่อ ใบ × เส้นยาง)
  // งานของตรวจคุณภาพ (QA): ล็อตที่กักรอตัดสิน · แสดงเฉพาะผู้ที่ทำได้จริง (helpers.canStoreRods / canDecideRods) ใช้ทั้งการ์ดในงานของฉันและตัวเลขที่เมนู
  const ROD_DEPTS = Object.freeze(["SR", "QA"]);
  const byTime = (key) => (a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0) || String(a.lotNo ?? "").localeCompare(String(b.lotNo ?? ""));
  function rodTasks(ctx, which = "ALL") {
    const { data, rules, helpers, user } = ctx;
    const lots = data.rodLots ?? [];
    const tasks = [];
    if ((which === "SR" || which === "ALL") && helpers.canStoreRods?.(user)) {
      for (const lot of lots.filter((entry) => entry.status === "pending").sort(byTime("createdAt"))) tasks.push({ kind: "rodReceive", lot });
      // คำขอเบิกของ GR ที่ SR ยังจ่ายไม่ครบ (rules.grOpenRequests · 20261216010000): หนึ่งการ์ดต่อคำขอ เก่าก่อน · ใบ × เส้นยางที่มีคำขออยู่ไม่มีการ์ด "รอจ่ายให้ GR" ซ้ำ
      const requests = rules.grOpenRequests?.(data) ?? [];
      const asked = new Set(requests.map((entry) => `${entry.request.orderId}\u0000${entry.request.itemCode}`));
      const needs = rules.rodIssueNeeds(data);
      for (const entry of requests) tasks.push({ kind: "rodRequest", entry, need: needs.find((need) => need.order.id === entry.request.orderId && need.itemCode === entry.request.itemCode) ?? null });
      // จ่ายได้เมื่อยังต้องจ่ายและคลังมีแท่งให้ (ของใบนี้หรือสต็อกกลาง) · ไม่มีแท่งเลย = ไม่มีการ์ดที่กดอะไรไม่ได้
      for (const need of needs) if (need.remaining > 1e-9 && need.owned + need.free > 1e-9 && !asked.has(`${need.order.id}\u0000${need.itemCode}`)) tasks.push({ kind: "rodIssue", need });
    }
    // เห็นการ์ดตัดสิน = แผนก QA หรือกลุ่มวางแผน · ปุ่ม "ตัดสิน" ของการ์ดเป็นของหัวหน้า QA ขึ้นไป (canDecideRods) · คนอื่นเห็นข้อความบอกผู้ที่ตัดสินได้
    if ((which === "QA" || which === "ALL") && helpers.canSeeRodHolds?.(user)) {
      for (const lot of lots.filter((entry) => entry.status === "held").sort(byTime("receivedAt"))) tasks.push({ kind: "rodDecide", lot });
    }
    return tasks;
  }
  const rodItemName = (ctx, code) => itemOf(ctx, code)?.name ?? "";
  const rodQty = (ctx, qty, uom) => `${ctx.rules.fmtQty(qty)} ${uomText(ctx, uom)}`;
  // ถังของแท่ง → ข้อความ: สต็อกกลาง · ของใบ X · ใบ X (ปิดแล้ว = สต็อกกลาง)
  const bucketText = (ctx, owner) => {
    if (!owner) return "สต็อกกลาง";
    const status = ctx.data.orders.find((order) => order.id === owner)?.status;
    return ctx.rules.ROD_FREE_ORDER.includes(status) ? `สต็อกกลาง (ใบ ${owner} ${status === "cancelled" ? "ยกเลิกแล้ว" : "ปิดแล้ว"})` : `ของใบ ${owner}`;
  };
  // รายการที่ SR ต้องหยิบตามแผน FIFO (ล็อตเก่าก่อน · rules.rodFifo): แถวละล็อตเด่นด้วยสีโมดูล SR มีป้าย "หยิบ" ตำแหน่งจัดเก็บตัวใหญ่ (เดินไปที่ชั้น) เลขล็อต และจำนวนที่ต้องหยิบ
  // ล็อตที่ไม่ต้องหยิบไม่แสดง · ของไม่พอ = แถวของที่มีอยู่ แล้วบรรทัดเตือนว่าขาดเท่าไร · ไม่มีอะไรต้องหยิบ = "" · dialog จ่ายให้ GR (แสดงสดตามจำนวนที่กรอก) และหน้ารายละเอียดการจ่ายของโมดูล SR ใช้ร่วมกัน
  // data-module="sr" ให้สีโมดูลใช้ได้แม้ dialog อยู่นอกหน้าของโมดูล
  function pickPlanHtml(ctx, plan, uom) {
    const { ui, rules, data } = ctx;
    const lots = new Map((data.rodLots ?? []).map((lot) => [lot.id, lot]));
    const rows = plan.rows.map((row) => {
      const where = lots.get(row.lotId)?.location;
      return `<li class="sr-pick-row"><span class="sr-pick-mark">หยิบ</span><span class="sr-pick-loc" title="ตำแหน่งจัดเก็บ">${where ? esc(where) : '<span class="muted">ไม่ระบุตำแหน่ง</span>'}</span><span class="sr-pick-lot"><strong class="rf-mono">${esc(`ล็อต ${row.lotNo}`)}</strong> <span class="small muted">${esc(bucketText(ctx, row.owner))}</span></span><strong class="sr-pick-qty nowrap">${esc(rodQty(ctx, row.qty, uom))}</strong></li>`;
    }).join("");
    const list = rows ? `<p class="small"><strong>หยิบจากล็อตเก่าก่อน</strong></p><ul class="sr-pick" data-module="sr" role="list">${rows}</ul>` : "";
    const short = plan.short > 1e-9 ? ui.callout("bad", esc(`ในคลังมีไม่พอ ขาด ${rules.fmtQty(plan.short)} ${uomText(ctx, uom)}`)) : "";
    return `${list}${short}`;
  }
  const ROD_STATUS_TONE = Object.freeze({ pending: "warn", held: "bad", stored: "good", returned: "", scrapped: "" });
  const rodStatusBadge = (ctx, lot) => ctx.ui.badge(ROD_STATUS_TONE[lot.status] ?? "", ctx.rules.ROD_STATUS_LABEL[lot.status] ?? lot.status);
  // ค่าที่วัดเทียบสเปก (หน้าต่างตัดสินและประวัติล็อต): หนึ่งแถวต่อค่า · ไม่มีสเปก = ค่าที่วัดอย่างเดียว
  function qcRowsHtml(ctx, lot) {
    const { ui, rules } = ctx;
    const values = lot.qc?.values ?? {};
    const verdict = rules.qcVerdict(lot.spec, values);
    const rows = verdict.rows.length
      ? verdict.rows.map((row) => `<tr><td>${esc(`${row.label} (${row.unit})`)}</td><td class="right rf-mono">${row.value === null ? "—" : esc(rules.fmtNum(row.value, 4))}</td><td class="right rf-mono">${esc(`${rules.fmtNum(row.target, 4)} ± ${rules.fmtNum(row.tol, 4)}`)}</td><td>${row.value === null ? "" : ui.badge(row.pass ? "good" : "bad", row.pass ? "ผ่าน" : "นอกสเปก")}</td></tr>`)
      : rules.ROD_SPEC_KEYS.filter((key) => values[key] !== undefined).map((key) => `<tr><td>${esc(`${rules.ROD_SPEC_LABEL[key].label} (${rules.ROD_SPEC_LABEL[key].unit})`)}</td><td class="right rf-mono">${esc(rules.fmtNum(values[key], 4))}</td><td class="muted">ไม่มีสเปก</td><td></td></tr>`);
    return rows.length ? ui.table(["ค่าที่วัด", { label: "วัดได้", className: "right" }, { label: "สเปก", className: "right" }, ""], rows) : "";
  }
  const lotFacts = (ctx, lot, extra = []) => ctx.ui.kv([
    ["เส้นยาง", `${ctx.ui.mono(lot.itemCode)}${rodItemName(ctx, lot.itemCode) ? `<div class="small muted">${esc(rodItemName(ctx, lot.itemCode))}</div>` : ""}`],
    // ล็อตรับนอกใบสั่ง (20261204010000) ไม่มีใบ งาน และ WO: บอกที่มาแทน
    lot.orderId ? ["ใบสั่งผลิต", `${ctx.ui.link(lot.orderId, ctx.url("orders", { sel: lot.orderId }), "rf-mono")} <span class="small muted">${esc(`งาน ${lot.jobNo} · WO ${lot.woNo}`)}</span>`]
      : ["ที่มา", esc(`${ctx.rules.ROD_SOURCE_LABEL.opening}${lot.sourceNote ? ` · ${lot.sourceNote}` : ""}`)],
    ...extra,
  ]);

  // SR รับแท่งเข้าคลัง: จำนวนที่รับ (ไม่เกินที่ส่งมา) + ตำแหน่งจัดเก็บ (จำเป็น 1-40 ตัวอักษร · 20261204010000) + ค่าที่วัด · มีสเปก = ผลคำนวณสด (ผ่าน = เข้าคลังและนับเข้างาน RB · ไม่ผ่าน = กักรอ QA) · ไม่มีสเปก = SR เลือกผ่าน / ไม่ผ่านเอง
  // หมายเหตุจำเป็นเมื่อไม่ผ่าน (3-300) · ส่งทันทีเมื่อกดบันทึก
  dialogs.rodReceive = (ctx, { lotId }) => {
    const { ui, rules, data } = ctx;
    const lot = (data.rodLots ?? []).find((entry) => entry.id === lotId);
    if (!lot || lot.status !== "pending" || !ctx.helpers.canStoreRods?.(ctx.user)) return null;
    const unit = uomText(ctx, lot.uom);
    const specRows = rules.qcVerdict(lot.spec, {}).rows;
    const valueInput = (key, required) => ui.input(`values.${key}`, { type: "number", step: "any", min: 0, required, id: `rod-value-${key}`, extra: `data-rod-value="${attr(key)}"` });
    const values = specRows.length
      ? specRows.map((row) => ui.field(`${row.label} (${row.unit})`, valueInput(row.key, true), { id: `rod-value-${row.key}`, required: true, hint: esc(`สเปก ${rules.fmtNum(row.target, 4)} ± ${rules.fmtNum(row.tol, 4)}`) })).join("")
      : rules.ROD_SPEC_KEYS.map((key) => ui.field(`${rules.ROD_SPEC_LABEL[key].label} (${rules.ROD_SPEC_LABEL[key].unit})`, valueInput(key, false), { id: `rod-value-${key}` })).join("");
    const pick = specRows.length ? "" : ui.field("ผลตรวจ", ui.select("result", [{ value: "pass", label: "ผ่าน · เข้าคลัง" }, { value: "fail", label: "ไม่ผ่าน · กักรอ QA ตัดสิน" }], { placeholder: "เลือกผลตรวจ…", id: "rod-result", extra: 'required data-rod-result title="ล็อตนี้ไม่มีสเปกขนาด ตัดสินจากการตรวจด้วยตา"' }), { id: "rod-result", required: true });
    // แท่งที่ผ่านไปไหน (ตรงกับ private.bom_rod_credit): ใบ released / in_progress และงาน RB ยังไม่เสร็จ = ส่วนที่งานยังขาดเป็นของใบ ส่วนเกินเป็นสต็อกกลาง
    // ไม่เช่นนั้น (งานเสร็จแล้ว ใบไม่ได้กำลังผลิต ไม่พบงาน) = สต็อกกลางทั้งหมด ไม่นับเข้างาน
    const order = data.orders.find((entry) => entry.id === lot.orderId);
    const job = data.jobs.find((entry) => entry.id === lot.jobNo && entry.orderId === lot.orderId);
    const open = Boolean(order && ["released", "in_progress"].includes(order.status) && job && job.status !== "done");
    const need = open ? Math.max(Math.round((Number(job.qtyPlanned) - (Number(job.qtyDone) || 0)) * 1e4) / 1e4, 0) : 0;
    const passText = (qty) => {
      const head = specRows.length ? "ผ่านสเปก" : "ผ่าน";
      if (!open) return `${head} ยางเส้นยาวเข้าคลังเป็นสต็อกกลางทั้งหมด ไม่นับเข้างาน RB (${!job ? "ไม่พบงาน RB ของล็อตนี้" : job.status === "done" ? "งาน RB ของใบนี้เสร็จแล้ว" : "ใบนี้ไม่ได้อยู่ระหว่างผลิต"})`;
      if (need <= 1e-9) return `${head} ยางเส้นยาวเข้าคลังเป็นสต็อกกลางทั้งหมด (งาน RB ของใบนี้ได้ครบแผนแล้ว)`;
      if (!(qty > need + 1e-9)) return `${head} ยางเส้นยาวเข้าคลังและนับเข้างาน RB`;
      return `${head} ยางเส้นยาวเข้าคลัง: ${rules.fmtQty(need)} ${unit} เป็นของงาน RB ของใบนี้ · เกิน ${rules.fmtQty(Math.round((qty - need) * 1e4) / 1e4)} ${unit} เข้าสต็อกกลาง`;
    };
    const body = `<form novalidate id="bom-rod-receive-form" data-rf-form="receiveRods" data-rf-args="${attr(JSON.stringify({ lotId: lot.id }))}" data-rf-success="บันทึกรับ {result} แล้ว">
      ${lotFacts(ctx, lot, [["ส่งมา", esc(`${rules.fmtQty(lot.qtySent)} ${unit}`)]])}
      <div class="rf-grid rf-g2">${ui.field(`จำนวนที่รับ (${unit})`, ui.input("qtyReceived", { type: "number", step: "any", min: 0, max: lot.qtySent, value: lot.qtySent, required: true, id: "rod-qty", extra: "data-rod-qty" }), { id: "rod-qty", required: true })}${ui.field("ตำแหน่งจัดเก็บ", ui.input("location", { id: "rod-location", placeholder: "เช่น A-01", required: true, extra: `maxlength="${rules.ROD_LOCATION_MAX}" title="ชั้นหรือโซนที่วางล็อตนี้ ค้นหาและย้ายภายหลังได้"` }), { id: "rod-location", required: true })}${values}${pick}</div>
      <div data-rod-verdict role="status" aria-live="polite"></div>
      <div class="field rf-field"><label for="rod-note">หมายเหตุ <span class="field-required" data-rod-note-req hidden>(จำเป็น)</span></label>${ui.input("note", { id: "rod-note", placeholder: "เช่น ผิวเป็นคลื่น ความหนาเกิน", extra: 'maxlength="300" data-rod-note' })}</div>
    </form>`;
    const bind = (dialog) => {
      const inputs = [...dialog.querySelectorAll("[data-rod-value]")];
      const result = dialog.querySelector("[data-rod-result]");
      const box = dialog.querySelector("[data-rod-verdict]");
      const note = dialog.querySelector("[data-rod-note]");
      const mark = dialog.querySelector("[data-rod-note-req]");
      const qtyInput = dialog.querySelector("[data-rod-qty]");
      const paint = () => {
        const verdict = rules.qcVerdict(lot.spec, Object.fromEntries(inputs.map((input) => [input.dataset.rodValue, input.value])));
        const outcome = specRows.length ? verdict.result : result?.value || null;
        const out = verdict.rows.filter((row) => row.value !== null && !row.pass).map((row) => `${row.label} ${rules.fmtNum(row.value, 4)} นอก ${rules.fmtNum(row.target, 4)} ± ${rules.fmtNum(row.tol, 4)}`);
        const typed = Number(qtyInput?.value);
        const qty = Number.isFinite(typed) && typed > 0 ? typed : Number(lot.qtySent) || 0;
        if (box) box.innerHTML = outcome === "pass" ? ui.callout("good", esc(passText(qty)))
          : outcome === "fail" ? ui.callout("warn", esc(`${out.length ? `ไม่ผ่าน: ${out.join(", ")} · ` : "ไม่ผ่าน · "}ล็อตจะถูกกักรอตรวจคุณภาพ (QA) ตัดสิน ไม่นับเข้างาน RB`)) : "";
        if (note) note.required = outcome === "fail";
        if (mark) mark.hidden = outcome !== "fail";
      };
      inputs.forEach((input) => input.addEventListener("input", paint));
      qtyInput?.addEventListener("input", paint);
      result?.addEventListener("change", paint);
      paint();
    };
    return { html: ui.dialog("rodReceive", `รับยางเส้นยาวเข้าคลัง · ล็อต ${lot.lotNo}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-rod-receive-form">บันทึกรับเข้า</button>` }), bind };
  };
  // SR (หรือฝ่ายวางแผน) รับยางเส้นยาวที่ไม่ได้มาจากใบสั่งผลิต (ของยกมา ของซื้อเข้า ของคืน) เป็นสต็อกกลาง: รหัสเส้นยาง (RB) เลขล็อต จำนวน ตำแหน่งจัดเก็บ และที่มา/เหตุผล (จำเป็นทุกช่อง · 20261204010000)
  // เข้าคลังทันที ไม่มีผลตรวจขนาด · เลขล็อตห้ามซ้ำและห้ามขึ้นต้น FN- (เลขของล็อตตกแต่งใน RubberFlow) ส่งทันทีเมื่อกดบันทึก
  dialogs.rodOpening = (ctx) => {
    const { ui, rules, data } = ctx;
    if (!ctx.helpers.canStoreRods?.(ctx.user)) return null;
    const options = data.items.filter((item) => item.kind === "RB" && item.active !== false).sort((a, b) => String(a.code).localeCompare(String(b.code))).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
    const body = `<form novalidate id="bom-rod-opening-form" data-rf-form="receiveRodsOpening" data-rf-success="รับยางเส้นยาวเข้าคลัง {result} แล้ว">
      ${options.length ? "" : ui.callout("warn", esc("ยังไม่มีรหัสเส้นยาง (RB) ในทะเบียนชิ้นงาน"))}
      ${ui.field("รหัสเส้นยาง", ui.select("itemCode", options, { placeholder: "เลือกรหัสเส้นยาง…", id: "rod-open-code", extra: "required" }), { id: "rod-open-code", required: true })}
      <div class="rf-grid rf-g2">${ui.field("เลขล็อต", ui.input("lotNo", { id: "rod-open-lot", required: true, placeholder: "เช่น OP-2611-01", extra: `maxlength="${rules.ROD_LOT_NO_MAX}" autocapitalize="characters" spellcheck="false" title="ไม่ซ้ำกับล็อตอื่น และห้ามขึ้นต้นด้วย ${rules.ROD_RESERVED_LOT_PREFIX}"` }), { id: "rod-open-lot", required: true })}${ui.field("จำนวน (เส้น)", ui.input("qty", { type: "number", step: "any", min: 0, required: true, id: "rod-open-qty" }), { id: "rod-open-qty", required: true })}</div>
      ${ui.field("ตำแหน่งจัดเก็บ", ui.input("location", { id: "rod-open-location", required: true, placeholder: "เช่น A-01", extra: `maxlength="${rules.ROD_LOCATION_MAX}"` }), { id: "rod-open-location", required: true })}
      ${ui.field("ที่มา หรือเหตุผลที่รับเข้า", ui.input("note", { id: "rod-open-note", required: true, placeholder: "เช่น ยกยอดมาจากการนับสต็อก รับคืนจากไลน์", extra: 'minlength="3" maxlength="300"' }), { id: "rod-open-note", required: true })}
    </form>`;
    return { html: ui.dialog("rodOpening", "รับยางเส้นยาวนอกใบสั่ง", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-rod-opening-form">บันทึกรับเข้า</button>` }) };
  };
  // ย้ายตำแหน่งจัดเก็บของล็อตที่อยู่ในคลัง (หรือกักรอ QA): แก้เฉพาะตำแหน่ง ไม่มีแถวประวัติสต็อก
  dialogs.rodLocation = (ctx, { lotId }) => {
    const { ui, rules, data } = ctx;
    const lot = (data.rodLots ?? []).find((entry) => entry.id === lotId);
    if (!lot || !["held", "stored"].includes(lot.status) || !ctx.helpers.canStoreRods?.(ctx.user)) return null;
    const body = `<form novalidate id="bom-rod-location-form" data-rf-form="setRodLocation" data-rf-args="${attr(JSON.stringify({ lotId: lot.id }))}" data-rf-success="ย้ายตำแหน่ง {result} แล้ว">
      ${ui.field("ตำแหน่งจัดเก็บใหม่", ui.input("location", { id: "rod-loc-new", value: lot.location ?? "", required: true, placeholder: "เช่น A-01", extra: `maxlength="${rules.ROD_LOCATION_MAX}"` }), { id: "rod-loc-new", required: true, hint: esc(lot.location ? `ตอนนี้ ${lot.location}` : "ล็อตนี้ยังไม่มีตำแหน่งที่บันทึกไว้") })}
    </form>`;
    return { html: ui.dialog("rodLocation", `ย้ายตำแหน่ง · ล็อต ${lot.lotNo}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-rod-location-form">บันทึกตำแหน่ง</button>` }) };
  };
  // QA ตัดสินล็อตที่กัก: ใช้ได้ตามสภาพ (เข้าคลังและนับเข้างาน RB ด้วยยอดที่ SR รับ) · คืน RB แก้ไข · ทิ้ง · เหตุผลจำเป็น 3-300
  dialogs.rodDecide = (ctx, { lotId }) => {
    const { ui, rules, data } = ctx;
    const lot = (data.rodLots ?? []).find((entry) => entry.id === lotId);
    if (!lot || lot.status !== "held" || !ctx.helpers.canDecideRods?.(ctx.user)) return null;
    const unit = uomText(ctx, lot.uom);
    const options = [
      { value: "accept", label: "ใช้ได้ตามสภาพ · เข้าคลังและนับเข้างาน RB" },
      { value: "return", label: "คืน RB แก้ไข" },
      { value: "scrap", label: "ทิ้ง" },
    ];
    const body = `<form novalidate id="bom-rod-decide-form" data-rf-form="decideRods" data-rf-args="${attr(JSON.stringify({ lotId: lot.id }))}" data-rf-success="บันทึกผลตัดสิน {result} แล้ว">
      ${lotFacts(ctx, lot, [["รับเข้า", esc(`${rules.fmtQty(lot.qtyReceived)} ${unit} · ${lot.receivedBy ?? ""} ${rules.fmtDateTime(lot.receivedAt)}`)], ...(lot.qc?.note ? [["หมายเหตุของ SR", esc(lot.qc.note)]] : [])])}
      ${qcRowsHtml(ctx, lot)}
      <div class="rf-grid rf-g2">${ui.field("ผลตัดสิน", ui.select("decision", options, { placeholder: "เลือกผลตัดสิน…", id: "rod-decision", extra: "required" }), { id: "rod-decision", required: true })}
      ${ui.field("เหตุผล", ui.input("note", { id: "rod-decision-note", required: true, placeholder: "เช่น ความหนาเกินเล็กน้อย ใช้ตัดชิ้นได้", extra: 'minlength="3" maxlength="300"' }), { id: "rod-decision-note", required: true })}</div>
    </form>`;
    return { html: ui.dialog("rodDecide", `ตัดสินล็อตที่กัก · ${lot.lotNo}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-rod-decide-form">บันทึกผลตัดสิน</button>` }) };
  };
  // SR จ่ายแท่งให้ GR ตามใบ: จำนวนครั้งนี้ (ค่าเริ่ม = ที่ยังต้องจ่าย ไม่เกินที่มีในคลัง) · ระบบเลือกล็อตเก่าก่อน จากถังของใบนี้ก่อนแล้วสต็อกกลาง (แสดงสดตามจำนวนที่กรอก)
  // qty = ค่าเริ่มของช่อง (การ์ดคำขอเบิกของ GR ส่งส่วนที่คำขอยังขาด) ไม่ส่ง = ที่ยังต้องจ่าย · ไม่เกินที่มีในคลังเสมอ
  dialogs.rodIssue = (ctx, { orderId, itemCode, qty: askQty = null }) => {
    const { ui, rules, data } = ctx;
    const order = data.orders.find((entry) => entry.id === orderId);
    if (!order || !["released", "in_progress"].includes(order.status) || !ctx.helpers.canStoreRods?.(ctx.user)) return null;
    const need = rules.rodIssueNeeds(data, order.id).find((row) => row.itemCode === itemCode);
    if (!need) return null;
    const unit = uomText(ctx, need.uom);
    const stock = Math.round((need.owned + need.free) * 1e4) / 1e4;
    if (!(stock > 0)) return null;
    const wanted = Number(askQty) > 0 ? Number(askQty) : need.remaining > 0 ? need.remaining : stock;
    const start = String(Math.round(Math.min(wanted, stock) * 1e4) / 1e4);
    const body = `<form novalidate id="bom-rod-issue-form" data-rf-form="issueRods" data-rf-args="${attr(JSON.stringify({ orderId: order.id, itemCode }))}" data-rf-success="จ่ายยางเส้นยาว {result} ให้ GR แล้ว">
      ${ui.kv([
        ["เส้นยาง", `${ui.mono(itemCode)}${need.name ? `<div class="small muted">${esc(need.name)}</div>` : ""}`],
        ["ใบสั่งผลิต", `${ui.link(order.id, ctx.url("orders", { sel: order.id }), "rf-mono")} <span class="small muted">${esc(order.customer ?? "")}</span>`],
        ["GR ต้องใช้", esc(`${rules.fmtQty(need.need)} ${unit} · จ่ายแล้ว ${rules.fmtQty(need.issued)}`)],
        ["ในคลัง", esc(`ของใบนี้ ${rules.fmtQty(need.owned)} · สต็อกกลาง ${rules.fmtQty(need.free)}`)],
      ])}
      ${ui.field(`จ่ายครั้งนี้ (${unit})`, ui.input("qty", { type: "number", step: "any", min: 0, max: stock, value: start, required: true, id: "rod-issue-qty", extra: `data-rod-issue title="${attr(`ไม่เกินที่มีในคลังสำหรับใบนี้ ${rules.fmtQty(stock)} ${unit}`)}"` }), { id: "rod-issue-qty", required: true })}
      <div data-rod-plan role="status" aria-live="polite"></div>
    </form>`;
    const bind = (dialog) => {
      const input = dialog.querySelector("[data-rod-issue]");
      const box = dialog.querySelector("[data-rod-plan]");
      const paint = () => {
        if (!box) return;
        const qty = Number(input?.value);
        if (!(qty > 0)) { box.innerHTML = ""; return; }
        const plan = rules.rodFifo(data, itemCode, qty, { own: order.id });
        const over = qty > need.remaining + 1e-9 ? `<p class="small muted">${esc(`เกินที่ GR ยังต้องใช้ ${rules.fmtQty(qty - need.remaining)} ${unit}`)}</p>` : "";
        box.innerHTML = `${pickPlanHtml(ctx, plan, need.uom)}${plan.short > 1e-9 ? "" : over}`;
      };
      input?.addEventListener("input", paint);
      paint();
    };
    return { html: ui.dialog("rodIssue", `จ่ายยางเส้นยาวให้ GR · ${order.id}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-rod-issue-form">จ่ายให้ GR</button>` }), bind };
  };
  // ป้ายชนิดแถวประวัติของยางเส้นยาว (หน้าล็อตและหน้าประวัติเข้าออกของโมดูล SR ใช้)
  const ROD_KIND_LABEL = Object.freeze({ receive: "รับเข้าคลัง", transfer: "ย้ายถัง (ปล่อยผลิต / เปิดใบกลับ)", issue: "จ่ายให้ GR", unissue: "ย้อนการจ่าย", adjust: "ปรับยอด" });
  dialogs.rodReverse = (ctx, { moveId }) => {
    const { ui, rules, data } = ctx;
    const move = (data.rodMoves ?? []).find((entry) => entry.id === moveId && entry.kind === "issue");
    if (!move || rules.rodReversedIds(data.rodMoves).has(move.id) || !ctx.helpers.canStoreRods?.(ctx.user)) return null;
    const lot = (data.rodLots ?? []).find((entry) => entry.id === move.lotId);
    const body = `<form novalidate id="bom-rod-reverse-form" data-rf-form="reverseRodIssue" data-rf-args="${attr(JSON.stringify({ moveId: move.id }))}" data-rf-success="ย้อนการจ่าย {result} แล้ว">
      ${ui.callout("warn", esc(`ยางเส้นยาว ${rules.fmtQty(-Number(move.qty))} ${uomText(ctx, lot?.uom)} ของล็อต ${lot?.lotNo ?? ""} กลับเข้าคลัง (${bucketText(ctx, move.ownerOrderId)}) ใบ ${move.forOrderId} นับว่ายังไม่ได้รับ`))}
      ${ui.field("เหตุผลที่ย้อน", ui.input("note", { id: "rod-reverse-note", required: true, placeholder: "เช่น จ่ายผิดใบ จ่ายเกิน", extra: 'minlength="3" maxlength="300"' }), { id: "rod-reverse-note", required: true })}
    </form>`;
    return { html: ui.dialog("rodReverse", `ย้อนการจ่ายยางเส้นยาว · ${move.forOrderId}`, body, { footer: `${ui.closeButton("ไม่ย้อน")}<button class="btn rf-btn" type="submit" form="bom-rod-reverse-form">ย้อนการจ่าย</button>` }) };
  };
  dialogs.rodAdjust = (ctx, { lotId }) => {
    const { ui, rules, data } = ctx;
    const lot = (data.rodLots ?? []).find((entry) => entry.id === lotId);
    if (!lot || lot.status !== "stored" || !ctx.helpers.canAdjustRods?.(ctx.user)) return null;
    const free = rules.rodBalance(data.rodMoves, lot.id, null);
    const unit = uomText(ctx, lot.uom);
    const body = `<form novalidate id="bom-rod-adjust-form" data-rf-form="adjustRods" data-rf-args="${attr(JSON.stringify({ lotId: lot.id }))}" data-rf-success="ปรับยอด {result} แล้ว">
      <div class="rf-grid rf-g2">${ui.field(`จำนวนที่ปรับ (${unit})`, ui.input("qty", { type: "number", step: "any", min: -free, required: true, id: "rod-adjust-qty", placeholder: "+2 หรือ -1", extra: `title="${attr(`บวก = เพิ่ม ลบ = ลด สต็อกกลางของล็อตนี้มี ${rules.fmtQty(free)} ${unit}`)}"` }), { id: "rod-adjust-qty", required: true })}
      ${ui.field("เหตุผล", ui.input("note", { id: "rod-adjust-note", required: true, placeholder: "เช่น นับจริงได้น้อยกว่า ยางเส้นยาวชำรุด", extra: 'minlength="3" maxlength="300"' }), { id: "rod-adjust-note", required: true })}</div>
    </form>`;
    return { html: ui.dialog("rodAdjust", `ปรับยอดสต็อกกลาง · ล็อต ${lot.lotNo}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-rod-adjust-form">บันทึก</button>` }) };
  };
  // ใช้จากคลังแท่งยาว (ขั้น 2 ของใบร่าง): เส้นยางของใบที่สต็อกกลางมีให้ใช้ · ช่อง "ใช้จากคลัง SR (เส้น)" ไม่เกินที่ใช้ได้ (บอกใน title ของช่อง) · ฝ่ายวางแผนตั้ง บันทึกเมื่อกดบันทึก
  // ยอดนี้ลดงาน RB (rules.netRequirements) และหักจริงตอนปล่อยผลิต ล็อตเก่าก่อน ใบที่ปล่อยก่อนได้ก่อน (rules.rodStockForDraft: available = สต็อกกลาง − ที่ใบร่างที่คำนวณก่อนตั้งใช้ไว้)
  function rodStockSection(ctx, order) {
    const { ui, rules } = ctx;
    const rows = rules.rodStockForDraft(ctx.data, order).filter((row) => row.stock > 0 || (row.planned ?? 0) > 0);
    if (!rows.length) return "";
    const canSet = ctx.helpers.canPlanOrders(ctx.user); // ตั้งยอดที่ใช้จากสต็อก = กลุ่มวางแผนของใบสั่งผลิต (20261226010000)
    const editable = (row) => canSet && (row.max > 0 || row.planned !== null);
    const hint = (row) => `คลัง SR มีสต็อกกลางที่ใช้ได้กับใบนี้ ${rules.fmtQty(row.available)} ${uomText(ctx, row.uom)}${row.taken > 0 ? ` (ใบร่างที่คำนวณก่อนตั้งใช้ไว้ ${rules.fmtQty(row.taken)})` : ""} · ใบนี้ต้องใช้ ${rules.fmtNum(row.required, 2)}`;
    const cell = (row) => {
      if (!editable(row)) return `<span title="${attr(hint(row))}">${row.planned > 0 ? esc(rules.fmtQty(row.planned)) : '<span class="muted">—</span>'}</span>`;
      return `<input type="hidden" name="itemCode[]" value="${attr(row.itemCode)}"><label class="bom-count-input" title="${attr(hint(row))}"><span class="sr-only">${esc(`ใช้จากคลัง SR ${row.itemCode} · ${hint(row)}`)}</span><input class="input rf-input" name="qty[]" type="number" inputmode="decimal" step="any" min="0" max="${attr(row.max)}" value="${attr(row.planned ?? "")}" placeholder="${attr(`ไม่เกิน ${rules.fmtQty(row.max)}`)}"><span class="small muted">${esc(uomText(ctx, row.uom))}</span></label>`;
    };
    const body = rows.map((row) => `<tr><td>${ui.link(row.itemCode, ctx.url("items", { sel: row.itemCode }), "rf-mono")}<div class="small muted">${esc(row.name ?? "")}</div></td><td class="right">${cell(row)}${row.planned !== null && row.planned > row.available + 1e-9 ? '<div class="small bom-short-text">เกินสต็อกที่เหลือ กรอกใหม่</div>' : ""}</td></tr>`);
    const table = ui.table(["เส้นยาง", { label: "ใช้จากคลัง SR (เส้น)", className: "right", title: "ลดงานรีดของแผนก RB ลงตามจำนวนนี้ ยางเส้นยาวถูกหักจากคลังยางเส้นยาวเมื่อปล่อยผลิต ล็อตเก่าก่อน ใบที่ปล่อยผลิตก่อนได้ก่อน" }], body);
    const form = canSet && rows.some(editable)
      ? `<form novalidate data-rf-form="setStockCounts" data-rf-args="${attr(JSON.stringify({ orderId: order.id }))}" data-rf-success="บันทึกยอดที่ใช้จากคลังยางเส้นยาว {result}">${table}<div class="rf-row bom-step-next"><button class="btn rf-btn secondary" type="submit">บันทึกยอดที่ใช้จากคลัง SR</button></div></form>`
      : table;
    return `<h3 class="bom-h3">คลังยางเส้นยาว (SR)</h3>${form}`;
  }

  // ---------- งานของฉัน: การ์ดงานของแผนกตัวเอง ปุ่มหลักปุ่มเดียวต่องาน ----------
  // งานที่ต้องทำของหน้างานของฉันตามพารามิเตอร์ (params ว่าง = ค่าตั้งต้นของหน้า) · ใช้ทั้งหน้าและตัวเลขที่เมนู (workCount) จึงนับชุดเดียวกันเสมอ
  // ฝ่ายวางแผน/ผู้จัดการเลือกดูทุกแผนกได้ · แผนกอื่นเห็นเฉพาะงานของแผนกตัวเอง · คลังสินค้า (WH) ไม่มีงานผลิตของตัวเอง (ไม่อยู่ในแผนกผลิต) แต่มีการ์ดรับเข้า/ส่งมอบ
  function workBoard(ctx, params) {
    const { data, rules, user } = ctx;
    const planner = ctx.helpers.canPlan(user);
    const own = rules.DEPTS.includes(user?.dept) ? user.dept : null;
    const depts = rules.FLOW_DEPTS.filter((dept) => rules.DEPTS.includes(dept));
    const handlesFg = ctx.helpers.canHandleFg(user);
    // คลังแท่งยาว (SR) และตรวจคุณภาพ (QA) ไม่มีงานรายแผนก มีการ์ดของคลังแท่งยาว · ฝ่ายวางแผนเลือกดูกระดานของสองแผนกนี้ได้
    const ownRods = ROD_DEPTS.includes(user?.dept) ? user.dept : null;
    const dept = planner ? ([...depts, ...ROD_DEPTS, "WH", "ALL"].includes(params.get("dept")) ? params.get("dept") : "ALL") : own ?? ownRods ?? (handlesFg ? "WH" : null);
    const show = params.get("st") === "done" ? "done" : "open";
    const orderId = String(params.get("order") ?? "").toUpperCase();
    const orderOf = (id) => data.orders.find((entry) => entry.id === id);
    const live = (job) => ["released", "in_progress", "completed"].includes(orderOf(job.orderId)?.status);
    // งานที่ยังต้องทำ (helpers.isOpenJob กติกาเดียวกับขั้น 4 ของหน้าใบและหน้างานของแผนก): งานของซื้อของใบที่ปิดแล้วไม่มีการ์ดรอเบิกที่กดอะไรไม่ได้
    // ของที่เบิกไปบางส่วนคืนของเหลือได้ที่หน้าใบ ไม่มีการ์ดของตัวเอง
    const toDo = (job) => ctx.helpers.isOpenJob(data, job);
    const mine = data.jobs.filter((job) => (dept === "ALL" || job.dept === dept) && live(job) && (!orderId || job.orderId === orderId));
    const open = mine.filter(toDo);
    const done = mine.filter((job) => job.status === "done");
    // จำนวนบนแท็บนับเป็นการ์ด: ของซื้อของใบเดียวกันเป็นการ์ดเดียว
    const cardCount = (jobs) => jobs.filter((job) => !ctx.helpers.isPartJob(job)).length + new Set(jobs.filter((job) => ctx.helpers.isPartJob(job)).map((job) => job.orderId)).size;
    // งานของคลังวัตถุดิบ (รับเข้า / สั่งซื้อ) อยู่ในรายการต้องทำของแผนก ST · ไม่กรองตามใบที่เลือกดู
    const tasks = dept && !orderId ? [...(dept === "ST" || dept === "ALL" ? storeTasks(ctx) : []), ...(ROD_DEPTS.includes(dept) || dept === "ALL" ? rodTasks(ctx, dept) : []), ...(dept === "WH" || dept === "ALL" ? fgTasks(ctx) : [])] : [];
    return { planner, depts, dept, show, orderId, orderOf, live, toDo, open, done, cardCount, tasks };
  }
  // ตัวเลขที่เมนู "งานของฉัน" = จำนวนการ์ดที่แท็บ "ต้องทำ" แสดงตามค่าตั้งต้นของหน้า (ไม่มีพารามิเตอร์)
  function workCount(ctx) {
    const board = workBoard(ctx, new URLSearchParams());
    return board.dept ? board.cardCount(board.open) + board.tasks.length : 0;
  }
  // การ์ดรับของเข้าคลังจากแผนกก่อนหน้า (WH รับจาก PK · SR รับยางเส้นยาว ซึ่งอยู่หน้าสุดของแผนกนั้นอยู่แล้ว): โมดูลแผนกวางการ์ดรับเข้าของตัวเองต่อจากชุดนี้ (MNP_FACTORY.deptWork afterReceipts)
  // ใบสั่งซื้อของ ST ไม่นับ (การ์ดของ ST คงลำดับเดิม)
  const isReceiptTask = (task) => task?.kind === "fgReceive" || task?.kind === "rodReceive";
  // รายการในการ์ดงาน (ทุกชนิด รวมการ์ดเบิกของซื้อ): ไม่เกิน CARD_LINES บรรทัด ที่เหลือบอกจำนวน · การ์ดพาไปหน้ารายละเอียดที่มีครบทุกบรรทัด (ใบที่มี 40 รหัสไม่ยืดการ์ดจนเต็มจอ)
  const CARD_LINES = 5;
  const cardLines = (list, render, noun = "รายการ") => `<ul class="bom-job-parts">${list.slice(0, CARD_LINES).map(render).join("")}</ul>${list.length > CARD_LINES ? `<p class="small muted">${esc(`อีก ${list.length - CARD_LINES} ${noun}`)}</p>` : ""}`;
  // รายการของซื้อของใบ จัดตามแผนกที่รับของ (rules.partReceiverGroups): หัวข้อ "ให้ <ชื่อเต็มแผนก>" ต่อกลุ่ม แล้วบรรทัดของกลุ่ม · ไม่รู้แผนก = ไม่มีหัวข้อ
  // นับเฉพาะบรรทัดของ (ไม่เกิน CARD_LINES ที่เหลือบอกจำนวน) · ใช้ที่การ์ดเบิกของตามใบและตารางจ่ายออกของโมดูล ST
  const deptNames = (ctx, depts) => depts.map((dept) => ctx.rules.DEPT_LABEL[dept] ?? dept).join(", ");
  function partLinesByDept(ctx, order, lines, render, noun = "รายการ") {
    let left = CARD_LINES;
    const items = [];
    for (const group of ctx.rules.partReceiverGroups(order, lines)) {
      const shown = group.lines.slice(0, Math.max(0, left));
      if (!shown.length) break;
      left -= shown.length;
      if (group.depts.length) items.push(`<li class="bom-job-dept">${esc(`ให้ ${deptNames(ctx, group.depts)}`)}</li>`);
      items.push(...shown.map(render));
    }
    return `<ul class="bom-job-parts">${items.join("")}</ul>${lines.length > CARD_LINES ? `<p class="small muted">${esc(`อีก ${lines.length - CARD_LINES} ${noun}`)}</p>` : ""}`;
  }
  // การ์ดของงานที่ไม่ใช่งานผลิต (คลังยางเส้นยาว SR · ตรวจคุณภาพ QA · คลังวัตถุดิบ ST · คลังสินค้า WH) เป็นชิ้นส่วนกลาง: หน้า "งานของฉัน" และโมดูลแผนกวาดชุดเดียวกัน
  // ctx = ผู้ใช้จริง (ปุ่มลงมือทำเปิดได้เมื่อมีสิทธิ์จริง ไม่เช่นนั้นเป็นข้อความดูอย่างเดียว · หน้างานของฉันได้การ์ดตามสิทธิ์อยู่แล้ว จึงเห็นปุ่มเสมอ) · view = { planner, dept } ของกระดานที่วาด (ป้ายแผนกขึ้นเฉพาะมุมมองทุกแผนกของฝ่ายวางแผน)
  function taskCard(ctx, task, { planner, dept }) {
    const { ui, rules } = ctx;
    const dueText = (dueAt, finished) => root.MNP_FACTORY.dueText(ctx, dueAt, finished);
    const readOnlyNote = '<p class="small muted">ดูอย่างเดียว บัญชีนี้ไม่มีสิทธิ์ดำเนินการ</p>';
    const gated = (helper, html) => (ctx.helpers[helper]?.(ctx.user) ? html : readOnlyNote);
    // หน้ารายละเอียดของการ์ดคลังยางเส้นยาว (โมดูล SR · #/sr): ให้เฉพาะผู้ที่เปิดโมดูลนั้นได้ (ไม่พาไปหน้า "ไม่พบ") · ไม่ให้ = การ์ดไม่เป็นลิงก์
    // หน้าใบของโมดูล WH (#/wh?order=): การ์ดงานของ WH เป็นของโมดูลนั้น จึงลิงก์เข้าได้เสมอ
    const whOrderUrl = (orderId) => root.MNP_FACTORY.routeUrl("wh", { order: orderId });
    const srHref = (query) => (typeof state !== "undefined" && root.MNP_FACTORY.canOpenDeptModule(state.employee, "SR", "FACTORY_SR") ? root.MNP_FACTORY.routeUrl("sr", query) : null);
    const { cardTitle, cardClass } = root.MNP_FACTORY;
    // คลังแท่งยาว (SR): รับแท่งเข้าคลัง · จ่ายแท่งให้ GR · ตรวจคุณภาพ (QA): ตัดสินล็อตที่กัก
    if (task.kind === "rodReceive" || task.kind === "rodDecide") {
      const { lot } = task;
      const receive = task.kind === "rodReceive";
      const chip = planner && dept === "ALL" ? `${deptChip(ctx, receive ? "SR" : "QA")} ` : "";
      // การ์ดรับเข้าเปิดหน้าล็อต (ที่มีปุ่มรับเข้าคลัง) · การ์ดตัดสินของ QA ไม่มีหน้ารายละเอียดของ SR ให้ QA จึงไม่เป็นลิงก์
      const href = receive ? srHref({ lot: lot.id }) : null;
      return `<article class="card rf-card bom-job ${receive ? "is-now" : "is-hold"}${cardClass(href)}"><div class="bom-job-top"><span class="bom-job-state">${receive ? "รอรับเข้าคลัง" : "กักรอ QA ตัดสิน"}</span><span class="muted">${esc(`${receive ? "ส่งมาจาก RB" : "รับเมื่อ"} ${rules.fmtDateTime(receive ? lot.createdAt : lot.receivedAt)}`)}</span></div>
        <h2>${cardTitle(`${receive ? "รับยางเส้นยาวเข้าคลัง" : "ตัดสินล็อตยางเส้นยาว"} ล็อต ${lot.lotNo}`, href)}</h2><p class="small muted">${chip}<span class="rf-mono">${esc(lot.itemCode)}</span> · ใบ ${ui.link(lot.orderId, ctx.url("orders", { sel: lot.orderId }))}</p>
        <div class="bom-job-amount"><span>${esc(`${receive ? "จำนวน" : "รับไว้"} ${rodQty(ctx, receive ? lot.qtySent : lot.qtyReceived, lot.uom)}`)}</span></div>${!receive && lot.qc?.note ? `<p class="small muted">${esc(`SR: ${lot.qc.note}`)}</p>` : ""}
        ${!receive && !ctx.helpers.canDecideRods?.(ctx.user) ? `<button class="btn rf-btn secondary bom-job-main" type="button" disabled title="${attr(`ตัดสินได้${root.MNP_RUBBERFLOW_RULES?.QA_RELEASE_TEXT ?? "เฉพาะหัวหน้า QA"}`)}" aria-label="${attr(`ตัดสินล็อต ${lot.lotNo} ไม่ได้ ตัดสินได้${root.MNP_RUBBERFLOW_RULES?.QA_RELEASE_TEXT ?? "เฉพาะหัวหน้า QA"}`)}">ตัดสิน</button>` : gated(receive ? "canStoreRods" : "canDecideRods", ui.openButton(receive ? "รับเข้าคลัง" : "ตัดสิน", receive ? "rodReceive" : "rodDecide", { lotId: lot.id }, { className: "bom-job-main" }))}</article>`;
    }
    if (task.kind === "rodIssue") {
      const { need } = task;
      const due = Math.min(...need.grJobs.map((job) => Number(job.dueAt) || Infinity));
      const href = srHref({ issue: need.order.id, code: need.itemCode });
      return `<article class="card rf-card bom-job is-now${cardClass(href)}"><div class="bom-job-top"><span class="bom-job-state">รอจ่ายให้ GR</span>${Number.isFinite(due) ? dueText(due, false) : ""}</div>
        <h2>${cardTitle(`จ่ายยางเส้นยาวให้ GR ตามใบ ${need.order.id}`, href)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "SR")} ` : ""}<span class="rf-mono">${esc(need.itemCode)}</span> · ${esc(need.order.customer ?? "")}</p>
        <div class="bom-job-amount"><span title="${attr(`GR ต้องใช้ ${rules.fmtQty(need.need)} จ่ายแล้ว ${rules.fmtQty(need.issued)}`)}">${esc(`ต้องจ่าย ${rodQty(ctx, need.remaining, need.uom)}`)}</span></div>
        ${ctx.helpers.salesCancelPending?.(need.order) ? `<p class="small muted">${esc(ctx.helpers.SALES_PENDING_TEXT)}</p>` : gated("canStoreRods", ui.openButton("จ่ายยางเส้นยาว", "rodIssue", { orderId: need.order.id, itemCode: need.itemCode }, { className: "bom-job-main" }))}</article>`;
    }
    // คำขอเบิกยางเส้นยาวของ GR: การ์ดเปิดหน้ารายละเอียดการจ่ายของใบ × เส้นยาง (#/sr?issue=) · ปุ่มจ่ายเปิด dialog จ่ายตัวเดิม (ค่าเริ่ม = ที่คำขอยังขาด) · คลังไม่มีของ = บอกแทนปุ่ม
    if (task.kind === "rodRequest") {
      const { entry, need } = task;
      const { request, order } = entry;
      const href = srHref({ issue: request.orderId, code: request.itemCode });
      const uom = need?.uom ?? itemOf(ctx, request.itemCode)?.uom ?? "";
      const stock = need ? Math.round((need.owned + need.free) * 1e4) / 1e4 : 0;
      const pendingOrder = order ?? ctx.data.orders.find((row) => row.id === request.orderId);
      const button = ctx.helpers.salesCancelPending?.(pendingOrder) ? `<p class="small muted">${esc(ctx.helpers.SALES_PENDING_TEXT)}</p>` : !need ? '<p class="small muted">ใบนี้ไม่มีงาน GR ที่ใช้เส้นยางนี้ค้างอยู่</p>' : stock > 0
        ? gated("canStoreRods", ui.openButton("จ่ายยางเส้นยาว", "rodIssue", { orderId: request.orderId, itemCode: request.itemCode, qty: entry.remaining }, { className: "bom-job-main" }))
        : '<p class="small muted">ไม่มีในคลัง</p>';
      const amount = entry.issued > 0 ? `ขอ ${rules.fmtQty(request.qty)} · ยังขาด ${rodQty(ctx, entry.remaining, uom)}` : `ขอ ${rodQty(ctx, request.qty, uom)}`;
      return `<article class="card rf-card bom-job is-now${cardClass(href)}"><div class="bom-job-top"><span class="bom-job-state">GR ขอเบิก</span><span class="muted">${esc(`ขอเมื่อ ${rules.fmtDateTime(request.createdAt)}`)}</span></div>
        <h2>${cardTitle(`จ่ายยางเส้นยาวตามคำขอของ GR ใบ ${request.orderId}`, href)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "SR")} ` : ""}<span class="rf-mono">${esc(request.itemCode)}</span>${order?.customer ? ` · ${esc(order.customer)}` : ""}</p>
        <div class="bom-job-amount"><span>${esc(amount)}</span></div><p class="small muted">${esc([request.createdBy, request.note].filter(Boolean).join(" · "))}</p>
        ${button}</article>`;
    }
    if (task.kind === "fgClose") {
      return `<article class="card rf-card bom-job is-now"><div class="bom-job-top"><span class="bom-job-state">รอปิดใบ</span><span class="muted">ส่งมอบคลัง ${esc(rules.fmtDate(task.order.whDue))}</span></div>
        <h2>${esc(`ใบ ${task.order.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "WH")} ` : ""}${esc(task.order.customer ?? "")} · ทุกแผนกปิดงานและรับสินค้าครบแล้ว</p>
        ${ui.link("ไปปิดใบ", whOrderUrl(task.order.id), "btn rf-btn bom-job-main")}</article>`;
    }
    if (task.kind === "fgCloseShort") {
      return `<article class="card rf-card bom-job is-now"><div class="bom-job-top"><span class="bom-job-state">รอปิดใบ</span><span class="muted">ส่งมอบคลัง ${esc(rules.fmtDate(task.order.whDue))}</span></div>
        <h2>${esc(`ใบ ${task.order.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "WH")} ` : ""}${esc(task.order.customer ?? "")} · PK ทำครบและรับเข้า WH แล้ว ยังน้อยกว่าที่สั่ง</p>
        ${cardLines(task.lines, (line) => `<li><span class="rf-mono">${esc(line.fgCode)}</span><span class="nowrap">${esc(`ขาด ${rules.fmtQty(line.qty)}`)}</span></li>`)}
        ${gated("canHandleFg", ui.openButton("ปิดใบ (รับไม่ครบ)", "closeShort", { orderId: task.order.id }, { className: "bom-job-main" }))}</article>`;
    }
    if (task.kind === "fgReceive" || task.kind === "fgDeliver") {
      const receive = task.kind === "fgReceive";
      // ใบที่ปิดแล้วที่ PK ผลิตเกิน: การ์ดรับส่วนเกินเข้าเป็นสต็อกสินค้าสำเร็จรูป (ไม่ใช่ของที่ลูกค้ารอ)
      const surplus = receive && task.surplus;
      return `<article class="card rf-card bom-job is-now"><div class="bom-job-top"><span class="bom-job-state">${receive ? (surplus ? "รอรับส่วนเกินเข้า WH" : "รอรับเข้า WH") : "รอส่งมอบ"}</span><span class="muted">ส่งมอบคลัง ${esc(rules.fmtDate(task.order.whDue))}</span></div>
        <h2>${esc(`${receive ? (surplus ? "รับส่วนเกินเข้า WH ตามใบ" : "รับสินค้าเข้า WH ตามใบ") : "ส่งมอบให้ลูกค้าตามใบ"} ${task.order.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "WH")} ` : ""}${esc(task.order.customer ?? "")}${surplus ? " · ใบปิดแล้ว ส่วนเกินเป็นสต็อกสินค้าสำเร็จรูป" : ""}</p>
        ${cardLines(task.lines, (line) => `<li><span class="rf-mono">${esc(line.fgCode)}</span><span class="nowrap">${esc(rules.fmtQty(line.qty))}</span></li>`)}
        ${ui.link(receive ? "เปิดใบเพื่อรับเข้า WH" : "เปิดใบเพื่อส่งมอบ", whOrderUrl(task.order.id), "btn rf-btn bom-job-main")}</article>`;
    }
    if (task.kind === "receive") {
      const unit = (line) => (line.source === "bom" ? uomText(ctx, line.uom) : "กก.");
      // ใบสั่งซื้อเก็บแต่รหัส: ของซื้อหาชื่อจากทะเบียนชิ้นงานของ BOM ส่วนเคมีจากทะเบียนวัตถุดิบของ RubberFlow · ไม่พบแสดงรหัสอย่างเดียว
      const materials = (() => { try { return ctx.rubberflow()?.store?.data?.().materials ?? []; } catch { return []; } })();
      const nameOf = (line) => (line.source === "bom" ? itemOf(ctx, line.materialCode)?.name : null) || materials.find((row) => row.code === line.materialCode)?.name || "";
      return `<article class="card rf-card bom-job ${task.cancelled ? "is-hold" : "is-now"}"><div class="bom-job-top"><span class="bom-job-state">${task.cancelled ? "ใบสั่งผลิตถูกยกเลิกแล้ว" : "รอรับเข้า"}</span><span class="muted">สั่งเมื่อ ${esc(rules.fmtDate(task.po.createdAt))}</span></div>
        <h2>${esc(`${task.cancelled ? "ตัดสินใบสั่งซื้อ" : "รับเข้าตามใบสั่งซื้อ"} ${task.po.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${task.po.sourcePi ? esc(`สั่งจากใบ ${task.po.sourcePi}`) : ""}${task.cancelled ? (task.partly ? " · รับเข้าไปแล้วบางส่วน ใบนี้ยกเลิกไม่ได้ รับส่วนที่เหลือเข้าเป็นสต็อกไว้ใช้กับใบอื่น หรือปิดยอดที่เหลือ" : " · ยกเลิกใบสั่งซื้อ หรือรับเข้าเป็นสต็อกไว้ใช้กับใบอื่น") : ""}</p>
        ${cardLines(task.lines, (line) => `<li><span><span class="rf-mono">${esc(line.materialCode)}</span>${nameOf(line) ? ` <span class="small muted">${esc(nameOf(line))}</span>` : ""}</span><span class="nowrap"${line.received > 0 ? ` title="${attr(`สั่ง ${rules.fmtQty(line.qtyKg)} รับแล้ว ${rules.fmtQty(line.received)}`)}"` : ""}>${esc(`${line.received > 0 ? "ค้างรับ " : ""}${rules.fmtQty(line.open)} ${unit(line)}`)}</span></li>`)}
        ${ui.link(task.cancelled ? "เปิดใบสั่งซื้อ" : "ตรวจสอบรับเข้า", root.MNP_FACTORY.routeUrl("st", { tab: "po", q: task.po.id }), "btn rf-btn bom-job-main")}</article>`;
    }
    if (task.kind === "partReturn") {
      return `<article class="card rf-card bom-job is-hold"><div class="bom-job-top"><span class="bom-job-state">ใบสั่งผลิตถูกยกเลิกแล้ว</span></div>
        <h2>${esc(`คืนของซื้อที่เบิกไปแล้ว ${task.order.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${esc(task.order.customer ?? "")}</p>
        ${cardLines(task.lines, (line) => `<li><span>${esc(line.name || line.itemCode)}</span><span class="nowrap">${esc(`${rules.fmtQty(line.returnable)} ${uomText(ctx, line.uom)}`)}</span></li>`)}
        ${gated("canIssueParts", ui.openButton("คืนของเหลือ", "returnParts", { orderId: task.order.id }, { className: "bom-job-main" }))}</article>`;
    }
    if (task.kind === "chemReturn") {
      const kg = task.req.lines.reduce((sum, line) => sum + (Number(line.actualKg) || 0), 0);
      return `<article class="card rf-card bom-job is-hold"><div class="bom-job-top"><span class="bom-job-state">WO ถูกยกเลิก · รอ ST รับคืน</span></div>
        <h2>${esc(`รับเคมีคืนตามใบเบิก ${task.req.id}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${esc(`WO ${task.req.orderId}${task.wo?.customerPo ? ` · ใบ ${task.wo.customerPo}` : ""} · จ่ายไป ${rules.fmtQty(kg)} กก.`)}</p>
        ${ui.link("เปิดหน้ารับคืน", root.MNP_FACTORY.routeUrl("st", { tab: "returns" }), "btn rf-btn bom-job-main")}</article>`;
    }
    if (task.kind === "chem") {
      return `<article class="card rf-card bom-job is-hold"><div class="bom-job-top"><span class="bom-job-state">เคมีขาด ยังไม่ได้สั่ง</span></div>
        <h2>${esc(`สั่งซื้อเคมีที่ขาด ${task.short.length} รายการ`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}สำหรับใบสั่งผลิตของแผนก RB ที่เปิดอยู่</p>
        ${cardLines(task.short, (row) => `<li><span>${esc(row.name || row.materialCode)}</span><span class="nowrap">${esc(`ขาด ${rules.fmtQty(row.shortageKg)} กก.`)}</span></li>`)}
        ${ui.link("เปิดหน้าใบสั่งซื้อ", root.MNP_FACTORY.routeUrl("st", { tab: "po" }), "btn rf-btn bom-job-main")}</article>`;
    }
    // การ์ดต่อวัตถุดิบ: หัวบอกยอดที่ต้องสั่งรวมทุกใบ รายการข้างล่างบอกใบที่ต้องใช้พร้อมจำนวนของใบนั้น · ปุ่มพาไปสั่งซื้อที่ใบที่ขาดมากสุด (task.order)
    return `<article class="card rf-card bom-job is-hold"><div class="bom-job-top"><span class="bom-job-state">ของขาด ยังไม่ได้สั่ง</span></div>
      <h2>${esc(`สั่งซื้อ ${task.name || task.itemCode}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${task.name ? `<span class="rf-mono">${esc(task.itemCode)}</span> · ` : ""}${esc(`${task.orders.length} ใบสั่งผลิตต้องใช้`)}</p>
      <div class="bom-job-amount"><span>${esc(`ขาดรวม ${rules.fmtQty(task.total)} ${uomText(ctx, task.uom)}`)}</span></div>
      ${cardLines(task.orders, (row) => `<li><span>${ui.link(row.orderId, ctx.url("orders", { sel: row.orderId }), "rf-mono")}</span><span class="nowrap">${esc(`ต้องใช้ ${rules.fmtQty(row.need)} ${uomText(ctx, task.uom)}`)}</span></li>`, "ใบ")}
      ${ui.link("เปิดใบเพื่อสั่งซื้อ", ctx.url("orders", { sel: task.order.id }), "btn rf-btn bom-job-main")}</article>`;
  }

  // การ์ดทั้งหมดของกระดาน workBoard: การ์ดงานของคลัง/ตรวจคุณภาพ (taskCards) แล้วตามด้วยการ์ดงานผลิตและการ์ดเบิกของซื้อ (cards) · คืนข้อความ HTML ต่อการ์ด
  // ctx = ผู้ใช้จริงที่ใช้วาดปุ่ม · board = workBoard ของ ctx เดียวกัน (หน้างานของฉัน) หรือของแผนก (โมดูลแผนก: workBoard ของ MNP_FACTORY.deptCtx) ให้ฝ่ายวางแผน/ผู้จัดการเห็นงานของแผนกนั้น
  function boardCards(ctx, board) {
    const { planner, dept, show, orderOf, open, done, tasks } = board;
    const { ui, rules, user } = ctx;
    const rank = (job) => (job.status === "in_progress" ? 0 : job.status === "hold" ? 2 : 1);
    const list = (show === "done" ? done : open).slice().sort((a, b) => rank(a) - rank(b) || a.dueAt - b.dueAt || a.id.localeCompare(b.id));
    // ของซื้อ (งานของคลังวัตถุดิบ): รวมเป็นการ์ดเดียวต่อใบ · ปุ่มเปิดหน้าต่างเบิกจ่าย (เลือกบรรทัดและจำนวนได้ หลายครั้งจนครบ · ชุดเดียวกับหน้าจ่ายออกของโมดูล ST)
    // การ์ดรอเบิกแสดงส่วนที่ยังต้องเบิกของแต่ละบรรทัด (แผน − เบิกแล้ว) · การ์ดเบิกแล้วแสดงยอดที่เบิก (รวมที่เบิกเกินแผน)
    const partGroups = new Map();
    const cards = [];
    for (const job of list) {
      if (ctx.helpers.isPartJob(job)) {
        if (!partGroups.has(job.orderId)) { partGroups.set(job.orderId, []); cards.push({ parts: job.orderId, dueAt: job.dueAt }); }
        partGroups.get(job.orderId).push(job);
      } else cards.push({ job });
    }
    const dueText = (dueAt, finished) => root.MNP_FACTORY.dueText(ctx, dueAt, finished);
    const cardHtml = (entry) => {
      if (entry.parts) {
        const jobs = partGroups.get(entry.parts);
        const order = orderOf(entry.parts);
        const finished = show === "done";
        const button = !finished && ctx.helpers.canIssueParts(user) && ctx.helpers.salesCancelPending?.(order) ? `<p class="small muted">${esc(ctx.helpers.SALES_PENDING_TEXT)}</p>` : !finished && ctx.helpers.canIssueParts(user) && ["released", "in_progress"].includes(order?.status) ? ui.openButton("เบิกจ่าย", "issueParts", { orderId: entry.parts }, { className: "bom-job-main", ariaLabel: `เบิกจ่ายของซื้อของใบ ${entry.parts}` }) : ui.link("เปิดใบสั่งผลิต", ctx.url("orders", { sel: entry.parts }), "btn rf-btn secondary bom-job-main");
        return `<article class="card rf-card bom-job"><div class="bom-job-top"><span class="bom-job-state">${finished ? "เบิกแล้ว" : "รอเบิก"}</span>${dueText(Math.min(...jobs.map((job) => job.dueAt)), finished)}</div>
          <h2>${esc(`เบิกของตามใบ ${entry.parts}`)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(ctx, "ST")} ` : ""}${esc(order?.customer ?? "")}</p>
          ${partLinesByDept(ctx, order, jobs, (job) => `<li><span>${esc(job.name)}</span><span class="nowrap">${esc(`${rules.fmtQty(finished ? job.qtyDone : Math.max(0, job.qtyPlanned - (Number(job.qtyDone) || 0)))} ${uomText(ctx, job.uom)}`)}</span></li>`)}${button}</article>`;
      }
      // การ์ดงานผลิตเป็นชิ้นส่วนกลาง (modules/factory-kit.js) ใช้ร่วมกับโมดูลแผนกอื่น
      return root.MNP_FACTORY.jobCard(ctx, entry.job, { planner, dept, show, orderOf });
    };
    return { taskCards: show === "open" ? tasks.map((task) => taskCard(ctx, task, { planner, dept })) : [], cards: cards.map(cardHtml) };
  }

  pages.work = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const board = workBoard(ctx, params);
    const { planner, depts, dept, show, orderId, live, toDo, open, done, cardCount, tasks } = board;
    const keep = (extra) => ctx.url("work", { dept: planner && dept !== "ALL" ? dept : null, order: orderId || null, ...extra });
    // ตัวเลขบนปุ่มแผนก = การ์ดที่แท็บ "ต้องทำ" ของแผนกนั้นแสดง (งานผลิต + งานของคลัง) จึงรวมกันได้เท่ากับ "ทุกแผนก" · คลังสินค้า (WH) ไม่มีงานผลิต มีปุ่มเมื่อมีการ์ดของคลังหรือเลือกอยู่
    const whCount = planner ? fgTasks(ctx).length : 0;
    const stTasks = planner ? storeTasks(ctx).length : 0;
    // ปุ่มแผนกเรียงตามผังงาน (ST → RB → SR → QA → GR → …) · SR / QA นับการ์ดของคลังแท่งยาว
    const tabCodes = rules.FLOW_DEPTS.filter((code) => depts.includes(code) || ROD_DEPTS.includes(code));
    const tabCount = (code) => (ROD_DEPTS.includes(code) ? rodTasks(ctx, code).length : cardCount(data.jobs.filter((job) => job.dept === code && toDo(job) && live(job))) + (code === "ST" ? stTasks : 0));
    const deptTabs = planner ? ui.tabs([{ id: "ALL", label: "ทุกแผนก" }, ...tabCodes.map((code) => ({ id: code, label: `${code} ${tabCount(code)}` })), ...(whCount || dept === "WH" ? [{ id: "WH", label: `WH ${whCount}` }] : [])], dept, (id) => ctx.url("work", { dept: id === "ALL" ? null : id, st: show === "done" ? "done" : null, order: orderId || null })) : "";
    const showTabs = ui.tabs([{ id: "open", label: `ต้องทำ ${cardCount(open) + tasks.length}` }, { id: "done", label: `เสร็จแล้ว ${cardCount(done)}` }], show, (id) => keep({ st: id === "done" ? "done" : null }));
    const { taskCards, cards } = boardCards(ctx, board);
    const sub = dept && dept !== "ALL" ? esc(rules.DEPT_LABEL[dept] ?? dept) : "";
    const filterNote = orderId ? `<p class="bom-back">เฉพาะใบ ${esc(orderId)} · ${ui.link("ดูทุกใบ", ctx.url("work", { dept: planner && dept !== "ALL" ? dept : null }))}</p>` : "";
    // ข้อมูลเคมียังโหลดอยู่: บอกแทนการเงียบ (ไม่แสดงเมื่อโหลดเสร็จแล้ว) · ถ้ายังไม่มีการ์ดเลยก็ไม่บอกว่า "ไม่มีงานค้าง"
    const waiting = show === "open" && (dept === "ST" || dept === "ALL") && !orderId && storeLoading(ctx) ? '<p class="small muted" role="status">กำลังโหลดข้อมูลเคมี…</p>' : "";
    const body = !dept ? ui.card(ui.empty("บัญชีนี้ไม่ได้อยู่ในแผนกผลิต จึงไม่มีงานของตัวเอง")) : cards.length || taskCards.length ? `${waiting}<div class="bom-job-grid">${taskCards.join("")}${cards.join("")}</div>` : waiting ? ui.card(waiting) : ui.card(ui.empty(show === "done" ? "ยังไม่มีงานที่เสร็จ" : "ไม่มีงานค้าง"));
    const tableLink = planner && ctx.canSee("jobs") ? ui.link("ดูเป็นตาราง", ctx.url("jobs"), "btn rf-btn secondary") : "";
    return { html: `${pageHead(ctx, "งานของฉัน", sub, tableLink)}${deptTabs}${filterNote}${dept ? showTabs : ""}${body}` };
  };

  // ---------- ข้อมูลตั้งต้น: ทางเข้าหน้าข้อมูลหลักที่ไม่ได้ใช้ทุกวัน ----------
  const SETUP_NOTE = Object.freeze({
    import: "นำเข้า BOM จากไฟล์ Excel", variants: "ชุดสีและแพ็กเกจของแต่ละสินค้า", compounds: "ผูกสูตรยางกับสูตรใน RubberFlow", customers: "รายชื่อลูกค้าของใบสั่งผลิต (อยู่ที่โมดูลฝ่ายขาย)",
    count: "กรอกยอดชิ้นงานที่มีอยู่ของใบที่ยังเป็นร่าง", check: "รายการข้อมูลที่ยังไม่ครบ", audit: "ใครทำอะไร เมื่อไร",
  });
  pages.setup = (ctx) => {
    const store = root.MNP_BOM_STORE;
    const salesHref = typeof state === "undefined" ? null : root.MNP_FACTORY?.deptLink?.(state.employee, "SA") ?? null;
    const ids = (store?.SETUP_PAGES ?? Object.keys(SETUP_NOTE)).filter((id) => ctx.canSee(id) && (id !== "customers" || salesHref));
    const label = (id) => store?.MODULES?.find((entry) => entry.id === id)?.label ?? id;
    const cards = ids.map((id) => `<a class="card rf-card bom-setup-card" href="${attr(id === "customers" ? `${salesHref}?tab=customers` : ctx.url(id))}"><span class="rf-mod-ico" aria-hidden="true">${pages.icon(id)}</span><span><strong>${esc(label(id))}</strong><span class="small muted">${esc(SETUP_NOTE[id] ?? "")}</span></span></a>`).join("");
    return { html: `${pageHead(ctx, "ข้อมูลตั้งต้น")}${ids.length ? `<div class="bom-setup-grid">${cards}</div>` : ctx.ui.card(ctx.ui.empty("บัญชีนี้ไม่มีหน้าข้อมูลตั้งต้นที่เปิดได้"))}` };
  };

  // ชิ้นส่วนของยางเส้นยาวที่โมดูล SR (modules/module-sr.js) ใช้วาดหน้าล็อตและตาราง ไม่คัดลอก
  const rod = Object.freeze({ bucketText, rodStatusBadge, qcRowsHtml, rodQty, rodItemName, ROD_KIND_LABEL, pickPlanHtml });
  pages.hub = { rod, cardLines, partLinesByDept, ratioText, orderStepOf, hubUrl, treeTab, pastePreview, copyPreview, draftChemicals, rfCan, storeTasks, fgTasks, rodTasks, workBoard, workCount, taskCard, boardCards, isReceiptTask };
})(typeof window !== "undefined" ? window : globalThis);
