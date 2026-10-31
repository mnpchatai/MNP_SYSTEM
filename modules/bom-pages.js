// BOM รายแผนก (โหมดทดสอบ) — หน้าและ dialog ทั้งหมด: ภาพรวม · สร้าง BOM (จุดเดียว: เลือกสินค้า 3 ช่อง แก้ต้นไม้ทุกชั้นในตารางเดียว บันทึกแล้วใช้ได้ทันที) ·
// ค้นหาชิ้นงาน/ประวัติ BOM (ดูอย่างเดียว) · สูตรยาง ↔ RubberFlow · นำเข้าจาก Excel · ใบสั่งผลิต (PI) · งานของแผนก · บันทึกการใช้งาน
// ทุกหน้าคืน { html, bind?(root, ctx) } ลงทะเบียนใน window.MNP_BOM_PAGES / _DIALOGS ใช้ชิ้นส่วน HTML ของ RubberFlow (ctx.ui) และกติกา event data-rf-* ที่ modules/module-bom.js ผูกให้
(function (root) {
  const pages = (root.MNP_BOM_PAGES ??= {});
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const includes = (haystack, q) => !q || String(haystack).toLowerCase().includes(q.toLowerCase());

  const ICONS = Object.freeze({ dashboard: "🧭", build: "🧰", items: "🔎", product: "🏭", structure: "🌳", variants: "🎨", compounds: "🧪", import: "📥", orders: "📋", count: "🔢", jobs: "🛠️", audit: "🕘" });
  pages.icon = (id) => (ICONS[id] ? `<span class="rf-ico" aria-hidden="true">${ICONS[id]}</span>` : "");
  const head = (ctx, title, desc = "", actionsHtml = "") => `<header class="rf-pagehead"><div class="rf-pagehead-main">${ICONS[ctx.page] ? `<span class="rf-mod-ico" aria-hidden="true">${pages.icon(ctx.page)}</span>` : ""}<div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ""}</div></div>${actionsHtml ? `<div class="rf-row">${actionsHtml}</div>` : ""}</header>`;

  const STATUS = Object.freeze({
    approved: ["good", "ใช้งาน"], superseded: ["", "ถูกแทนแล้ว"],
    draft: ["", "ร่าง"], released: ["info", "ปล่อยผลิต"], in_progress: ["accent", "กำลังผลิต"], completed: ["good", "เสร็จสิ้น"], cancelled: ["bad", "ยกเลิก"],
    queued: ["", "รอคิว"], done: ["good", "เสร็จ"], hold: ["warn", "พักงาน"],
    EX: ["info", "ต่างประเทศ"], SA: ["", "ในประเทศ"],
  });
  const status = (ctx, value) => { const [tone, label] = STATUS[value] ?? ["", String(value ?? "")]; return ctx.ui.badge(tone, label); };
  const deptBadge = (ctx, dept) => ctx.ui.badge("", dept);
  const kindLabel = (ctx, kind) => ctx.rules.KINDS[kind]?.label ?? kind;
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);
  const searchForm = (ctx, placeholder) => `<form class="rf-search" data-rf-search role="search"><label class="sr-only" for="bom-q">ค้นหา</label>${ctx.ui.input("q", { id: "bom-q", type: "search", value: ctx.q, placeholder })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>`;
  const itemOf = (ctx, code) => ctx.helpers.itemOf(ctx.data, code);
  const approvedBomOf = (ctx, code) => ctx.helpers.approvedBomOf(ctx.data, code);
  const whereUsed = (ctx, code) => ctx.data.boms.filter((bom) => bom.status === "approved" && bom.lines.some((line) => line.childCode === code)).map((bom) => bom.itemCode);
  const myDept = (ctx) => (ctx.rules.DEPTS.includes(ctx.user?.dept) ? ctx.user.dept : "PK");
  const jobProgress = (ctx, job) => `${ctx.ui.progress(job.qtyDone, job.qtyPlanned, job.status === "hold" ? "bad" : "")}<div class="small muted">${esc(`${ctx.rules.fmtQty(job.qtyDone)} / ${ctx.rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}${job.qtyReject ? ` · เสีย ${ctx.rules.fmtQty(job.qtyReject)}` : ""}`)}</div>`;
  const late = (ctx, job) => job.status !== "done" && job.dueAt < ctx.now;
  const treeRows = (ctx, code, qty = 1) => ctx.rules.explode(code, qty, { itemOf: (c) => itemOf(ctx, c), approvedBomOf: (c) => approvedBomOf(ctx, c) }).lines;
  const levelCell = (level, text) => `<span class="bom-lv bom-lv-${Math.min(level, 6)}">${text}</span>`;
  const buildUrl = (ctx, code) => ctx.url("build", { code });

  // ลากเพื่อเรียงแถว: กดค้างที่ด้ามจับ ⋮⋮ แล้วลากขึ้น/ลง (เมาส์เริ่มลากได้ทันที นิ้วต้องกดค้างก่อน จึงยังเลื่อนหน้าได้ตามปกติ)
  // หรือโฟกัสด้ามจับแล้วกดลูกศรขึ้น/ลง · ย้ายได้เฉพาะในกลุ่มพี่น้องเดียวกัน แถวลูกหลาน (blockOf) ติดไปด้วย
  // ใช้ pointer events จึงใช้ได้ทั้งเมาส์และนิ้วบน iPhone
  const dragHandle = (label) => `<span class="bom-drag" data-drag-handle role="button" tabindex="0" aria-label="${attr(label)}" title="กดค้างแล้วลากขึ้น/ลง (หรือกดลูกศรขึ้น/ลง)">⋮⋮</span>`;
  // ลากแถวในตารางสร้าง BOM แบบอิสระ (ไม่ติดเป็นก้อน): ใช้ตอนคัดลอกโครงสร้างมาแล้วสลับบางขั้น/บางชิ้น
  // · ลากขึ้น/ลงข้ามกลุ่มได้: วางก่อนแถวไหน = เป็นพี่น้องของแถวนั้น · วางต่อจากแถวที่มีลูก = เป็นลูกตัวแรกของแถวนั้น
  // · ปล่อยมือตอนลากไปทางขวา/ซ้ายเกิน 40 px = ย่อเข้า (เป็นลูกของแถวพี่ข้างบน) / ดึงออก (ขึ้นไปอยู่ชั้นของพ่อ)
  // · ลูกเดิมของแถวที่ย้ายเลื่อนขึ้นไปอยู่กับพ่อเดิม (ไม่ติดไปด้วย) เว้นแต่ติ๊ก "ลากพร้อมส่วนประกอบข้างใต้"
  // · คีย์บอร์ดที่ด้ามจับ: ↑/↓ ย้าย · →/← ย่อเข้า/ดึงออก · ชิ้นที่มี BOM ไม่ได้ (ของซื้อ เส้นยาง) รับลูกไม่ได้
  function treeRowsDrag(tbody, { rows, descendants, withChildren = () => false, canHaveChildren = () => true }) {
    const HOLD_MS = 250;
    const rowById = (id) => rows().find((tr) => tr.dataset.row === id) ?? null;
    const setLevel = (tr, level) => {
      tr.dataset.level = String(level);
      const span = tr.querySelector(".bom-lv");
      if (span) span.className = `bom-lv bom-lv-${Math.min(level, 6)}`;
    };
    const setParent = (tr, parentId, level) => {
      const delta = level - Number(tr.dataset.level);
      const subtree = descendants(tr.dataset.row);
      tr.dataset.parent = parentId;
      const hidden = tr.querySelector('input[name="parentId[]"]');
      if (hidden) hidden.value = parentId;
      setLevel(tr, level);
      if (delta) subtree.forEach((row) => setLevel(row, Number(row.dataset.level) + delta));
    };
    // ปลดลูกตรงของแถวขึ้นไปอยู่กับพ่อเดิม (ตำแหน่งในตารางคงเดิม)
    const releaseChildren = (tr) => rows().filter((row) => row.dataset.parent === tr.dataset.row).forEach((child) => setParent(child, tr.dataset.parent, Number(tr.dataset.level)));
    const blockOf = (tr) => [tr, ...descendants(tr.dataset.row)];
    const move = (tr, target, after) => {
      if (!withChildren()) releaseChildren(tr);
      const block = withChildren() ? blockOf(tr) : [tr];
      if (block.includes(target)) return false;
      const next = target.nextElementSibling;
      if (after && next && next.dataset.parent === target.dataset.row && !block.includes(next)) {
        target.after(...block);
        setParent(tr, target.dataset.row, Number(target.dataset.level) + 1);
      } else if (after) {
        blockOf(target).filter((row) => !block.includes(row)).at(-1).after(...block);
        setParent(tr, target.dataset.parent, Number(target.dataset.level));
      } else {
        target.before(...block);
        setParent(tr, target.dataset.parent, Number(target.dataset.level));
      }
      return true;
    };
    const indent = (tr) => {
      const siblings = rows().filter((row) => row.dataset.parent === tr.dataset.parent);
      const above = siblings[siblings.indexOf(tr) - 1];
      if (!above || !canHaveChildren(above)) return false;
      if (!withChildren()) releaseChildren(tr);
      setParent(tr, above.dataset.row, Number(above.dataset.level) + 1);
      return true;
    };
    const outdent = (tr) => {
      const parent = rowById(tr.dataset.parent);
      if (!parent) return false;
      if (!withChildren()) releaseChildren(tr);
      const block = blockOf(tr);
      const parentEnd = blockOf(parent).filter((row) => !block.includes(row)).at(-1);
      parentEnd.after(...block);
      setParent(tr, parent.dataset.parent, Number(parent.dataset.level));
      return true;
    };
    tbody.addEventListener("contextmenu", (event) => { if (event.target.closest?.("[data-drag-handle]")) event.preventDefault(); });
    tbody.addEventListener("keydown", (event) => {
      const handle = event.target.closest?.("[data-drag-handle]");
      if (!handle || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tr = handle.closest("tr");
      if (event.key === "ArrowRight") indent(tr);
      else if (event.key === "ArrowLeft") outdent(tr);
      else {
        const all = rows();
        const skip = withChildren() ? blockOf(tr) : [tr];
        const index = all.indexOf(tr);
        const target = event.key === "ArrowUp" ? all.slice(0, index).reverse().find((row) => !skip.includes(row)) : all.slice(index + 1).find((row) => !skip.includes(row));
        if (target) move(tr, target, event.key === "ArrowDown");
      }
      handle.focus();
    });
    tbody.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest?.("[data-drag-handle]");
      if (!handle || event.button > 0) return;
      const tr = handle.closest("tr");
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let timer = null;
      const mark = (on) => (withChildren() ? blockOf(tr) : [tr]).forEach((row) => row.classList.toggle("is-dragging", on));
      const start = () => { active = true; mark(true); };
      const onMove = (ev) => {
        if (!active) { if (Math.abs(ev.clientY - startY) > 8) end(); return; }
        const all = rows();
        const skip = withChildren() ? blockOf(tr) : [tr];
        const index = all.indexOf(tr);
        for (const [at, row] of all.entries()) {
          if (skip.includes(row)) continue;
          const rect = row.getBoundingClientRect();
          if (ev.clientY < rect.top || ev.clientY > rect.bottom) continue;
          const mid = (rect.top + rect.bottom) / 2;
          if (at > index && ev.clientY > mid) move(tr, row, true);
          else if (at < index && ev.clientY < mid) move(tr, row, false);
          break;
        }
      };
      const end = (ev) => {
        clearTimeout(timer);
        if (active && ev?.type === "pointerup") {
          const dx = ev.clientX - startX;
          if (dx > 40) indent(tr);
          else if (dx < -40) outdent(tr);
        }
        mark(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      if (event.pointerType === "mouse") { event.preventDefault(); start(); } else timer = setTimeout(start, HOLD_MS);
    });
  }

  function sortableRows(container, { rows, parentOf = () => "", blockOf = (tr) => [tr], onChange = () => {} }) {
    const HOLD_MS = 250;
    const siblingsOf = (tr) => rows().filter((row) => parentOf(row) === parentOf(tr));
    const place = (tr, target, after) => {
      const block = blockOf(tr);
      if (block.includes(target)) return;
      if (after) blockOf(target).at(-1).after(...block);
      else target.before(...block);
      onChange(tr);
    };
    container.addEventListener("contextmenu", (event) => { if (event.target.closest?.("[data-drag-handle]")) event.preventDefault(); });
    container.addEventListener("keydown", (event) => {
      const handle = event.target.closest?.("[data-drag-handle]");
      if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const tr = handle.closest("tr");
      const siblings = siblingsOf(tr);
      const index = siblings.indexOf(tr);
      const target = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (target) { place(tr, target, event.key === "ArrowDown"); handle.focus(); }
    });
    container.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest?.("[data-drag-handle]");
      if (!handle || event.button > 0) return;
      const tr = handle.closest("tr");
      const startY = event.clientY;
      let active = false;
      let timer = null;
      // ฟัง pointermove/up ที่ window จึงไม่ต้อง setPointerCapture (ซึ่ง throw ถ้านิ้วถูกยกเลิกไปก่อนครบเวลากดค้าง)
      const start = () => { active = true; blockOf(tr).forEach((row) => row.classList.add("is-dragging")); };
      const move = (ev) => {
        if (!active) { if (Math.abs(ev.clientY - startY) > 8) end(); return; }
        const siblings = siblingsOf(tr);
        const index = siblings.indexOf(tr);
        for (const [at, sib] of siblings.entries()) {
          if (sib === tr) continue;
          const block = blockOf(sib);
          const top = block[0].getBoundingClientRect().top;
          const bottom = block.at(-1).getBoundingClientRect().bottom;
          if (ev.clientY < top || ev.clientY > bottom) continue;
          const mid = (top + bottom) / 2;
          if (at > index && ev.clientY > mid) place(tr, sib, true);
          else if (at < index && ev.clientY < mid) place(tr, sib, false);
          break;
        }
      };
      const end = () => {
        clearTimeout(timer);
        blockOf(tr).forEach((row) => row.classList.remove("is-dragging"));
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      if (event.pointerType === "mouse") { event.preventDefault(); start(); } else timer = setTimeout(start, HOLD_MS);
    });
  }

  // ---------- ภาพรวม ----------
  pages.dashboard = (ctx) => {
    const { data, ui, rules, user } = ctx;
    const openOrders = data.orders.filter((order) => ["draft", "released", "in_progress"].includes(order.status));
    const openJobs = data.jobs.filter((job) => job.status !== "done");
    const lateJobs = openJobs.filter((job) => late(ctx, job));
    const myJobs = openJobs.filter((job) => job.dept === user.dept || (job.dept === "PK" && user.role === "planner"));
    const byKind = Object.keys(rules.KINDS).map((kind) => [kind, data.items.filter((item) => item.kind === kind).length]).filter(([, n]) => n);
    const recent = data.boms.filter((bom) => bom.status === "approved").sort((a, b) => b.approvedAt - a.approvedAt).slice(0, 8);
    const statsHtml = ui.stats([
      { label: "ชิ้นงานใน item master", value: rules.fmtQty(data.items.length), sub: byKind.map(([kind, n]) => `${kind} ${n}`).join(" · ") },
      { label: "สินค้า (FG) ที่มี BOM", value: String(data.items.filter((item) => item.kind === "FG" && approvedBomOf(ctx, item.code)).length), sub: `จาก ${data.items.filter((item) => item.kind === "FG").length} รายการ` },
      { label: "ใบสั่งผลิตที่เปิดอยู่", value: String(openOrders.length), sub: `${data.orders.filter((order) => order.status === "draft").length} ร่าง · ${openOrders.length - data.orders.filter((order) => order.status === "draft").length} กำลังผลิต` },
      { label: "งานค้าง", value: String(openJobs.length), sub: lateJobs.length ? `เลยกำหนด ${lateJobs.length}` : "ไม่มีงานเลยกำหนด", tone: lateJobs.length ? "bad" : "" },
    ]);
    const jobRows = [...openJobs].sort((a, b) => a.dueAt - b.dueAt).slice(0, 10).map((job) => `<tr${late(ctx, job) ? ' class="is-late"' : ""}><td class="nowrap">${esc(rules.fmtDate(job.dueAt))}</td><td>${deptBadge(ctx, job.dept)}</td><td>${ui.mono(job.itemCode)}<div class="small muted">${esc(job.name)}</div></td><td>${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId }))}</td><td class="rf-progress-cell">${jobProgress(ctx, job)}</td><td>${status(ctx, job.status)}</td></tr>`);
    const recentRows = recent.map((bom) => `<tr><td>${ui.link(bom.itemCode, ctx.url("items", { sel: bom.itemCode }), "rf-mono")}<div class="small muted">${esc(itemOf(ctx, bom.itemCode)?.name ?? "")}</div></td><td class="nowrap">Rev.${esc(String(bom.revision))}</td><td class="small">${esc(bom.changeLog.at(-1)?.text ?? "")}</td><td class="nowrap small">${esc(bom.approvedBy)}<div class="muted">${esc(rules.fmtDateTime(bom.approvedAt))}</div></td></tr>`);
    const html = `${head(ctx, "ภาพรวม BOM", `สวัสดี ${user.name} (${ctx.roleLabel(user.role)}) · งานของแผนกคุณที่ยังค้าง ${myJobs.length} รายการ`, ctx.canSee("build") ? ui.link("สร้าง BOM", ctx.url("build"), "btn rf-btn") : "")}
      ${statsHtml}
      <div class="rf-grid rf-g2">
        ${ui.card(ui.table(["กำหนด", "แผนก", "ชิ้นงาน", "ใบ PI", "ความคืบหน้า", "สถานะ"], jobRows, { emptyText: "ไม่มีงานค้าง" }), { title: "งานใกล้กำหนด", flush: true, actions: ui.link("ดูทั้งหมด", ctx.url("jobs"), "btn rf-btn secondary small") })}
        ${ui.card(ui.table(["ชิ้นงาน", "Rev", "สิ่งที่เปลี่ยน", "โดย"], recentRows, { emptyText: "ยังไม่มี BOM" }), { title: "BOM ที่บันทึกล่าสุด", flush: true })}
      </div>`;
    return { html };
  };

  // ---------- สร้าง BOM (จุดเดียว) ----------
  // แถวของตารางแก้ไข: { id, parentId, level, code, kind, name, uom, qty, step, scrapPct, note, weightG, rubber, existing, usedIn }
  // counter: id ของแถวไม่ซ้ำกันแน่นอน (ถ้าใช้ hash ชนกันได้แล้วลูกจะไปผูกผิดแถว)
  function editorRowsOf(ctx, parentCode, parentId = "", level = 1, seen = new Set(), counter = { n: 0 }) {
    const bom = approvedBomOf(ctx, parentCode);
    if (!bom) return [];
    const rows = [];
    for (const line of bom.lines) {
      const child = itemOf(ctx, line.childCode);
      if (!child) continue;
      counter.n += 1;
      const id = `r${counter.n}`;
      rows.push({ id, parentId, level, code: child.code, kind: child.kind, name: child.name, uom: child.uom, qty: line.qty, step: line.step || "", scrapPct: line.scrapPct || 0, note: line.note || "", weightG: child.weightG || "", rubber: child.rubber ?? {}, existing: true, usedIn: whereUsed(ctx, child.code).length });
      if (!ctx.helpers.NO_BOM_KINDS.includes(child.kind) && !seen.has(child.code) && level < 6) {
        seen.add(child.code);
        rows.push(...editorRowsOf(ctx, child.code, id, level + 1, seen, counter));
      }
    }
    return rows;
  }
  const KIND_OPTIONS = (ctx) => Object.entries(ctx.rules.KINDS).map(([value, meta]) => ({ value, label: `${value} · ${meta.label}` }));
  const UOM_OPTIONS = (ctx) => Object.entries(ctx.rules.UOMS).map(([value, meta]) => ({ value, label: meta.label }));
  // แถวหนึ่งของตารางแก้ไข (ใช้ทั้งแถวจริงและ template ที่ JS clone เมื่อกด "+ ลูก")
  function editorRowHtml(ctx, row) {
    const { ui, rules } = ctx;
    const r = row.rubber ?? {};
    const isRb = row.kind === "RB";
    const noBom = ctx.helpers.NO_BOM_KINDS.includes(row.kind);
    const suggestion = isRb ? rules.rbPerSe({ pcsPerRoll: r.pcsPerRoll, sePerGr: r.sePerGr, uom: row.uom, weightG: row.weightG }) : 0;
    return `<tr class="bom-row${row.existing ? "" : " is-new"}" data-row="${attr(row.id)}" data-parent="${attr(row.parentId)}" data-level="${attr(String(row.level))}">
      <td class="bom-cell-code">${levelCell(row.level, `${dragHandle("ย้ายแถวนี้และส่วนประกอบข้างใต้")}<input type="hidden" name="rowId[]" value="${attr(row.id)}"><input type="hidden" name="parentId[]" value="${attr(row.parentId)}">${ui.input("childCode[]", { value: row.code, list: "bom-item-list", placeholder: "รหัสชิ้นงาน", className: "bom-code", extra: 'data-bom-code autocapitalize="characters"' })}`)}<div class="small muted" data-bom-flag>${row.existing ? (row.usedIn > 1 ? esc(`ใช้ร่วมกับสินค้าอื่น ${row.usedIn - 1} รายการ (แก้แล้วมีผลทุกสินค้า)`) : "") : "ชิ้นใหม่"}</div></td>
      <td>${ui.input("name[]", { value: row.name, placeholder: "ชื่อชิ้นงาน", className: "bom-name" })}</td>
      <td>${ui.select("kind[]", KIND_OPTIONS(ctx), { value: row.kind || "PURCHASED", className: "bom-kind", extra: 'data-bom-kind data-native-select aria-label="ชนิดชิ้นงาน"' })}</td>
      <td>${ui.select("uom[]", UOM_OPTIONS(ctx), { value: row.uom || "pcs", className: "bom-uom", extra: 'data-native-select aria-label="หน่วยนับ"' })}</td>
      <td>${ui.input("qty[]", { type: "number", step: "any", min: 0, value: row.qty === "" || row.qty === undefined ? "" : String(Number(Number(row.qty).toPrecision(10))), className: "bom-qty", extra: 'data-bom-qty aria-label="ปริมาณต่อ 1 พ่อ"' })}<small class="rf-hint" data-bom-hint>${esc(isRb && suggestion ? `จากการตัด ${rules.fmtQty(suggestion)}` : "")}</small></td>
      <td>${ui.input("lineStep[]", { type: "number", step: "1", min: 1, max: 20, value: row.step ?? "", placeholder: "1", className: "bom-step", extra: 'aria-label="ขั้นที่ของพ่อที่ชิ้นนี้เข้า (ว่าง = ขั้นแรก)"' })}</td>
      <td>${ui.input("scrapPct[]", { type: "number", step: "any", min: 0, value: row.scrapPct ?? 0, className: "bom-scrap", extra: 'aria-label="% เผื่อเสีย"' })}</td>
      <td>${ui.input("lineNote[]", { value: row.note ?? "", className: "bom-note", extra: 'aria-label="หมายเหตุของบรรทัด"' })}</td>
      <td class="bom-cell-rubber${isRb ? "" : " is-hidden"}" data-bom-rubber>
        <div class="bom-rubber-grid">
          <label>สูตร${ui.input("compound[]", { value: r.compound ?? "", list: "bom-compound-list", className: "bom-mini" })}</label>
          <label>ตัด ซม.${ui.input("cutLengthCm[]", { type: "number", step: "any", value: r.cutLengthCm ?? "", className: "bom-mini", extra: "data-bom-cut" })}</label>
          <label>ชิ้น/เส้น${ui.input("pcsPerRoll[]", { type: "number", step: "any", value: r.pcsPerRoll ?? "", className: "bom-mini", extra: "data-bom-cut" })}</label>
          <label>SE/GR${ui.input("sePerGr[]", { type: "number", step: "any", value: r.sePerGr ?? "", className: "bom-mini", extra: "data-bom-cut" })}</label>
          <label>กก./เส้น${ui.input("kgPerRoll[]", { type: "number", step: "any", value: r.kgPerRoll ?? "", className: "bom-mini" })}</label>
          <label>กรัม/หน่วย${ui.input("weightG[]", { type: "number", step: "any", value: row.weightG ?? "", className: "bom-mini", extra: "data-bom-cut" })}</label>
        </div>
      </td>
      <td class="nowrap"><button class="btn rf-btn secondary small${noBom ? " is-hidden" : ""}" type="button" data-bom-add-child title="เพิ่มส่วนประกอบใต้ชิ้นนี้">+ ลูก</button> <button class="btn rf-btn secondary small" type="button" data-bom-remove aria-label="ลบบรรทัด">ลบ</button></td>
    </tr>`;
  }

  pages.build = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const canEdit = ctx.helpers.canPlan(user);
    const fgs = data.items.filter((item) => item.kind === "FG");
    const parsed = fgs.map((item) => ({ item, ...rules.parseFgCode(item.code) }));
    const bases = [...new Set(parsed.map((entry) => entry.base))].sort();
    const base = String(params.get("base") ?? "").trim();
    const pkg = String(params.get("pkg") ?? "").trim().toUpperCase();
    const cs = String(params.get("cs") ?? "").trim().toUpperCase();
    const code = params.get("code") ? rules.canonicalCode(params.get("code")) : base ? rules.buildFgCode(base, pkg, cs) : "";
    const pkgOptions = [...new Set([...rules.PACKAGES, ...parsed.map((entry) => entry.pkg).filter(Boolean)])].map((value) => ({ value, label: `(${value})` }));
    const colorOptions = [...new Set([...rules.COLOR_SETS, ...parsed.map((entry) => entry.colorSet).filter(Boolean)])].map((value) => ({ value, label: value }));
    const current = code ? rules.parseFgCode(code) : { base, pkg, colorSet: cs };
    const picker = ui.card(`<form class="bom-pick" data-bom-pick>
        <div class="rf-grid rf-g3">
          ${ui.field("ฐานรหัสสินค้า *", ui.input("base", { value: current.base, list: "bom-base-list", required: true, placeholder: "เลือกหรือพิมพ์รหัสใหม่ เช่น MEGA-ST-01", extra: 'autocapitalize="characters"' }), { hint: esc(`มีอยู่ ${bases.length} ฐานรหัส พิมพ์รหัสใหม่เพื่อสร้างสินค้าใหม่`) })}
          ${ui.field("แพ็กเกจ", ui.select("pkg", pkgOptions, { value: current.pkg, placeholder: "ไม่ระบุ" }))}
          ${ui.field("ชุดสี", ui.select("cs", colorOptions, { value: current.colorSet, placeholder: "ไม่ระบุ" }))}
        </div>
        <datalist id="bom-base-list">${bases.map((value) => `<option value="${attr(value)}">${esc(parsed.find((entry) => entry.base === value).item.name.slice(0, 50))}</option>`).join("")}</datalist>
        <div class="rf-row"><button class="btn rf-btn" type="submit">เปิด BOM</button></div>
      </form>`, { title: "1. เลือกสินค้า (ฐานรหัส + แพ็กเกจ + ชุดสี เหมือนชีต ;}o)" });
    const bindPick = (rootNode) => {
      rootNode.querySelector("[data-bom-pick]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        location.hash = ctx.url("build", { base: String(form.get("base") ?? "").trim(), pkg: String(form.get("pkg") ?? ""), cs: String(form.get("cs") ?? "") });
      });
    };
    if (!code) {
      const recent = data.boms.filter((bom) => bom.status === "approved" && itemOf(ctx, bom.itemCode)?.kind === "FG").sort((a, b) => b.approvedAt - a.approvedAt).slice(0, 8);
      const html = `${head(ctx, "สร้าง BOM", "เลือกสินค้าแล้วแก้ส่วนประกอบทุกชั้นในตารางเดียว (SE → RB, PT → เม็ดพลาสติก, BG → ผ้า/ซิป, ของซื้อ) กด “บันทึก BOM” แล้วใช้ในใบสั่งผลิตได้ทันที ไม่ต้องอนุมัติ")}${picker}
        ${ui.card(ui.table(["สินค้า", "Rev", "บันทึกล่าสุด", ""], recent.map((bom) => `<tr><td>${ui.mono(bom.itemCode)}<div class="small muted">${esc(itemOf(ctx, bom.itemCode)?.name ?? "")}</div></td><td>Rev.${esc(String(bom.revision))}</td><td class="small">${esc(rules.fmtDateTime(bom.approvedAt))} ${esc(bom.approvedBy)}</td><td>${ui.link("เปิด", buildUrl(ctx, bom.itemCode), "btn rf-btn secondary small")}</td></tr>`), { emptyText: "ยังไม่มีสินค้าที่มี BOM" }), { title: "สินค้าที่แก้ล่าสุด", flush: true })}`;
      return { html, bind: bindPick };
    }
    const item = itemOf(ctx, code);
    let rows = [];
    let sourceNote = "";
    if (item) rows = editorRowsOf(ctx, item.code);
    else {
      const siblings = ctx.helpers.siblingsOf(data, current.base);
      const source = ctx.helpers.pickSibling(siblings, current.pkg, current.colorSet);
      if (source) { rows = editorRowsOf(ctx, source.code); sourceNote = `ตั้งต้นจาก ${source.code} (${source.name}) แก้แล้วบันทึกเป็น ${code} โดยไม่กระทบตัวต้นแบบ`; }
    }
    if (!rows.length) rows = [{ id: "r1", parentId: "", level: 1, code: "", kind: "PURCHASED", name: "", uom: "pcs", qty: "", scrapPct: 0, note: "", weightG: "", rubber: {}, existing: false, usedIn: 0 }];
    const bom = item ? approvedBomOf(ctx, item.code) : null;
    const itemCard = ui.card(`<div class="rf-grid rf-g3">
        ${ui.field("รหัสสินค้า", `<input class="input rf-input rf-mono" value="${attr(code)}" readonly>`)}
        ${ui.field("ชื่อสินค้า *", ui.input("itemName", { value: item?.name ?? "", required: true, placeholder: "เช่น ตอปิโดยาง TP-01 แพ็กถุง ชุดสี Y" }))}
        ${ui.field("หน่วยขาย", ui.select("itemUom", UOM_OPTIONS(ctx), { value: item?.uom ?? "set", extra: "data-native-select" }))}
      </div>
      ${item ? `<div class="small muted">${esc(`ชนิด ${kindLabel(ctx, item.kind)} · แผนกเจ้าของ ${item.ownerDept}${bom ? ` · BOM ปัจจุบัน Rev.${bom.revision} บันทึก ${rules.fmtDateTime(bom.approvedAt)} โดย ${bom.approvedBy}` : " · ยังไม่มี BOM"}`)} · ${ui.link("ประวัติ revision", ctx.url("items", { sel: item.code }))}</div>` : ui.callout("info", `<strong>${esc(code)}</strong> ยังไม่มีใน item master กดบันทึกแล้วระบบจะสร้างสินค้าใหม่ให้พร้อม BOM${sourceNote ? `<div>${esc(sourceNote)}</div>` : ""}`)}`, { title: "2. สินค้า", className: "bom-item-card" });
    const tableHead = `<thead><tr><th>ชั้น / รหัส</th><th>ชื่อ</th><th>ชนิด</th><th>หน่วย</th><th>ปริมาณต่อ 1 พ่อ</th><th title="ขั้นผลิตของพ่อที่ชิ้นนี้เข้า 1–20 (ว่าง = ขั้นแรก) · มุมมองลำดับผลิตของหน้าโครงสร้างสินค้าเรียงวัตถุดิบตามเลขนี้">ขั้นที่</th><th>% เผื่อเสีย</th><th>หมายเหตุ</th><th>ข้อมูลยาง (RB)</th><th></th></tr></thead>`;
    const templateRow = editorRowHtml(ctx, { id: "__ID__", parentId: "__PARENT__", level: 1, code: "", kind: "PURCHASED", name: "", uom: "pcs", qty: "", scrapPct: 0, note: "", weightG: "", rubber: {}, existing: false, usedIn: 0 });
    const editor = `<form id="bom-tree-form" class="bom-editor" data-rf-form="saveBomTree" data-rf-success="{result}">
      <input type="hidden" name="code" value="${attr(code)}">
      <datalist id="bom-item-list">${data.items.filter((entry) => entry.code !== code).map((entry) => `<option value="${attr(entry.code)}">${esc(`${entry.kind} · ${entry.name.slice(0, 50)}`)}</option>`).join("")}</datalist>
      <datalist id="bom-compound-list">${data.compounds.map((entry) => `<option value="${attr(entry.code)}">${esc(entry.name)}</option>`).join("")}</datalist>
      ${itemCard}
      ${ui.card(`<p class="small muted">ปริมาณ = จำนวนลูกต่อ 1 หน่วยของพ่อ (ชั้นแรกต่อ 1 ${esc(uomText(ctx, item?.uom ?? "set"))} ของสินค้า) · RB ใต้ SE: ใส่ข้อมูลการตัดแล้วระบบแนะนำอัตราส่วน 1/(ชิ้นต่อเส้น × SE ต่อ GR) · พิมพ์รหัสที่ยังไม่มี = สร้างชิ้นใหม่ (ระบุชนิด ชื่อ หน่วย)</p>
        <div class="table-wrap"><table class="rf-table bom-tree-table">${tableHead}<tbody data-bom-rows>${rows.map((row) => editorRowHtml(ctx, row)).join("")}</tbody></table></div>
        <template data-bom-row>${templateRow}</template>
        <div class="rf-row"><button class="btn rf-btn secondary small" type="button" data-bom-add-root>+ เพิ่มส่วนประกอบชั้นแรก</button><label class="small bom-drag-option" title="ปิดไว้ = ย้ายเฉพาะแถวนั้น ลูกเดิมขึ้นไปอยู่กับพ่อเดิม · ลาก ⋮⋮ ไปทางขวา/ซ้ายแล้วปล่อย = ย่อเข้าเป็นลูกของแถวบน / ดึงออกหนึ่งชั้น"><input type="checkbox" data-drag-with-children> ลากพร้อมส่วนประกอบข้างใต้</label></div>
        ${ui.field("หมายเหตุของการแก้ครั้งนี้", ui.input("note", { placeholder: "เช่น เปลี่ยนความยาวตัดลูกตอปิโด" }))}`, { title: "3. ส่วนประกอบทุกชั้น" })}
      <div class="rf-row bom-actions">${canEdit ? '<button class="btn rf-btn" type="submit" form="bom-tree-form">บันทึก BOM</button>' : ui.callout("warn", "บทบาทนี้ดูได้อย่างเดียว การสร้าง/แก้ BOM ทำโดยฝ่ายวางแผนหรือผู้จัดการ")}${item && bom && canEdit ? ui.openButton("ใช้ในใบสั่งผลิต", "useInOrder", { code: item.code }) : ""}${item ? ui.link("ดูต้นไม้ที่ระเบิดแล้ว", ctx.url("items", { sel: item.code }), "btn rf-btn secondary") : ""}</div>
    </form>`;
    const html = `${head(ctx, "สร้าง BOM", "เลือกสินค้า → แก้ส่วนประกอบทุกชั้นในตารางเดียว → บันทึก ใช้ได้ทันที (เก็บเป็น revision ย้อนดูได้)")}${picker}${editor}`;
    const bind = (rootNode) => {
      bindPick(rootNode);
      const tbody = rootNode.querySelector("[data-bom-rows]");
      const template = rootNode.querySelector("template[data-bom-row]");
      if (!tbody) return;
      let seq = 0;
      const rowsOf = () => [...tbody.querySelectorAll("tr[data-row]")];
      const descendants = (id) => {
        const all = rowsOf();
        const parentOf = Object.fromEntries(all.map((tr) => [tr.dataset.row, tr.dataset.parent]));
        return all.filter((tr) => { let p = tr.dataset.parent; while (p) { if (p === id) return true; p = parentOf[p] ?? ""; } return false; });
      };
      const paintRow = (tr) => {
        const kind = tr.querySelector("[data-bom-kind]")?.value;
        tr.querySelector("[data-bom-rubber]")?.classList.toggle("is-hidden", kind !== "RB");
        tr.querySelector("[data-bom-add-child]")?.classList.toggle("is-hidden", ctx.helpers.NO_BOM_KINDS.includes(kind));
        if (kind === "RB") {
          const num = (selector) => Number(tr.querySelector(selector)?.value) || 0;
          const suggested = rules.rbPerSe({ pcsPerRoll: num('input[name="pcsPerRoll[]"]'), sePerGr: num('input[name="sePerGr[]"]') || 1, uom: tr.querySelector('select[name="uom[]"]')?.value, weightG: num('input[name="weightG[]"]') });
          const hint = tr.querySelector("[data-bom-hint]");
          const qty = tr.querySelector("[data-bom-qty]");
          if (hint) hint.textContent = suggested ? `จากการตัด ${rules.fmtQty(suggested)}` : "";
          if (qty && !qty.value && suggested) qty.value = String(Math.round(suggested * 1e6) / 1e6);
        }
      };
      const wire = (tr) => {
        tr.querySelector("[data-bom-code]")?.addEventListener("change", (event) => {
          const found = itemOf(ctx, event.target.value);
          const flag = tr.querySelector("[data-bom-flag]");
          if (found) {
            event.target.value = found.code;
            tr.querySelector('input[name="name[]"]').value = found.name;
            tr.querySelector('select[name="kind[]"]').value = found.kind;
            tr.querySelector('select[name="uom[]"]').value = found.uom;
            tr.querySelector('input[name="weightG[]"]').value = found.weightG || "";
            const r = found.rubber ?? {};
            for (const key of ["compound", "cutLengthCm", "pcsPerRoll", "sePerGr", "kgPerRoll"]) { const input = tr.querySelector(`input[name="${key}[]"]`); if (input) input.value = r[key] ?? ""; }
            tr.classList.remove("is-new");
            const used = whereUsed(ctx, found.code).length;
            if (flag) flag.textContent = used ? `ใช้ร่วมกับสินค้าอื่น ${used} รายการ (แก้แล้วมีผลทุกสินค้า)` : "";
          } else if (event.target.value.trim()) {
            tr.classList.add("is-new");
            const guess = rules.kindOf({ code: event.target.value, deptKind: "", pair: "" });
            tr.querySelector('select[name="kind[]"]').value = guess === "FG" ? "PURCHASED" : guess;
            if (flag) flag.textContent = "ชิ้นใหม่";
          }
          // เปลี่ยนรหัสของแถว = เปลี่ยนชิ้น: ลูกเดิมเป็นของชิ้นเก่า จึงแทนด้วยส่วนประกอบของชิ้นใหม่ (ถ้ามี) ไม่ปล่อยให้ลูกเก่าไปเขียนทับ BOM ของชิ้นใหม่
          replaceChildren(tr, found);
          paintRow(tr);
        });
        tr.querySelector("[data-bom-kind]")?.addEventListener("change", () => paintRow(tr));
        tr.querySelectorAll("[data-bom-cut], select[name=\"uom[]\"]").forEach((input) => input.addEventListener("input", () => paintRow(tr)));
        tr.querySelector("[data-bom-remove]")?.addEventListener("click", () => { descendants(tr.dataset.row).forEach((row) => row.remove()); tr.remove(); if (!rowsOf().length) addRow("", 1); });
        tr.querySelector("[data-bom-add-child]")?.addEventListener("click", () => addRow(tr.dataset.row, Number(tr.dataset.level) + 1, tr));
      };
      const replaceChildren = (tr, item) => {
        descendants(tr.dataset.row).forEach((row) => row.remove());
        if (!item || ctx.helpers.NO_BOM_KINDS.includes(item.kind) || !approvedBomOf(ctx, item.code)) return;
        seq += 1;
        const rows = editorRowsOf(ctx, item.code, tr.dataset.row, Number(tr.dataset.level) + 1, new Set([item.code]), { n: seq * 1000 });
        if (!rows.length) return;
        tr.insertAdjacentHTML("afterend", rows.map((row) => editorRowHtml(ctx, { ...row, id: `c${row.id}`, parentId: row.parentId === tr.dataset.row ? row.parentId : `c${row.parentId}` })).join(""));
        let node = tr.nextElementSibling;
        for (let i = 0; i < rows.length && node; i += 1, node = node.nextElementSibling) wire(node);
      };
      const addRow = (parentId, level, afterRow = null) => {
        if (!template) return;
        seq += 1;
        const id = `n${Date.now().toString(36)}${seq}`;
        const html = template.innerHTML.replaceAll("__ID__", id).replaceAll("__PARENT__", parentId).replace('data-level="1"', `data-level="${level}"`).replace("bom-lv bom-lv-1", `bom-lv bom-lv-${Math.min(level, 6)}`);
        const anchor = afterRow ? (descendants(afterRow.dataset.row).at(-1) ?? afterRow) : null;
        if (anchor) anchor.insertAdjacentHTML("afterend", html); else tbody.insertAdjacentHTML("beforeend", html);
        const tr = anchor ? anchor.nextElementSibling : tbody.lastElementChild;
        if (tr) { wire(tr); tr.querySelector("[data-bom-code]")?.focus?.(); }
      };
      rowsOf().forEach(wire);
      const withChildren = rootNode.querySelector("[data-drag-with-children]");
      treeRowsDrag(tbody, { rows: rowsOf, descendants, withChildren: () => Boolean(withChildren?.checked), canHaveChildren: (tr) => !ctx.helpers.NO_BOM_KINDS.includes(tr.querySelector("[data-bom-kind]")?.value) });
      rootNode.querySelector("[data-bom-add-root]")?.addEventListener("click", () => addRow("", 1));
    };
    return { html, bind };
  };

  // dialog: ใส่สินค้าที่เพิ่งบันทึกลงใบสั่งผลิตที่ยังเป็นร่าง
  dialogs.useInOrder = (ctx, { code }) => {
    const { ui, data } = ctx;
    const item = itemOf(ctx, code);
    if (!item) return null;
    const drafts = data.orders.filter((order) => order.status === "draft");
    const body = drafts.length ? `<form id="bom-use-form" data-rf-form="addOrderItem" data-rf-args="${attr(JSON.stringify({ fgCode: item.code }))}" data-rf-success="${attr(`เพิ่ม ${item.code} ในใบแล้ว`)}">
      ${ui.field("ใบสั่งผลิต (ร่าง) *", ui.select("orderId", drafts.map((order) => ({ value: order.id, label: `${order.id} · ${order.customer} (${order.items.length} สินค้า)` })), {}))}
      ${ui.field("จำนวนสั่ง *", ui.input("qty", { type: "number", step: "any", min: 1, required: true }))}
    </form>` : ui.callout("warn", `ยังไม่มีใบสั่งผลิตที่เป็นร่าง ${ui.link("เปิดใบใหม่ที่เมนูใบสั่งผลิต", ctx.url("orders"))}`);
    return { html: ui.dialog("useInOrder", `ใช้ ${item.code} ในใบสั่งผลิต`, body, { footer: `${ui.closeButton()}${drafts.length ? '<button class="btn rf-btn" type="submit" form="bom-use-form">เพิ่มในใบ</button>' : ""}` }) };
  };

  // ---------- ค้นหาชิ้นงาน / ประวัติ BOM (ดูอย่างเดียว) ----------
  pages.items = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const sel = params.get("sel") ? rules.canonicalCode(params.get("sel")) : "";
    const dept = [...rules.DEPTS, "ALL"].includes(params.get("dept")) ? params.get("dept") : "ALL";
    const canEdit = ctx.helpers.canPlan(user);
    const list = data.items.filter((item) => (dept === "ALL" || item.ownerDept === dept) && includes(`${item.code} ${item.name} ${item.legacyCodes.join(" ")}`, ctx.q)).sort((a, b) => a.code.localeCompare(b.code));
    const tabs = ui.tabs([{ id: "ALL", label: `ทั้งหมด (${data.items.length})` }, ...rules.DEPTS.map((code) => ({ id: code, label: `${code} (${data.items.filter((item) => item.ownerDept === code).length})` }))], dept, (id) => ctx.url("items", { dept: id, q: ctx.q || null }));
    const rows = list.slice(0, 300).map((item) => {
      const approved = approvedBomOf(ctx, item.code);
      return `<tr${item.code === sel ? ' class="is-selected"' : ""}><td>${ui.link(item.code, ctx.url("items", { dept, sel: item.code, q: ctx.q || null }), "rf-mono")}${item.legacyCodes.length ? `<div class="small muted" title="รหัสสะกดเดิมในชีต">เดิม: ${esc(item.legacyCodes.join(", "))}</div>` : ""}</td><td>${esc(item.name)}<div class="small muted">${esc(kindLabel(ctx, item.kind))} · ${esc(item.ownerDept)}</div></td><td class="nowrap">${esc(uomText(ctx, item.uom))}</td><td class="nowrap">${approved ? `Rev.${approved.revision}` : rules.MANUFACTURED.includes(item.kind) && !["RB", "SUBPART"].includes(item.kind) ? ui.badge("warn", "ไม่มี BOM") : '<span class="muted">—</span>'}</td><td class="right">${esc(String(whereUsed(ctx, item.code).length))}</td></tr>`;
    });
    const listCard = ui.card(`${searchForm(ctx, "ค้นหารหัส ชื่อ หรือรหัสเดิม…")}${ui.table(["รหัส", "ชื่อ", "หน่วย", "BOM", { label: "ใช้ใน", className: "right" }], rows, { emptyText: ctx.q ? "ไม่พบชิ้นงาน" : "ยังไม่มีชิ้นงาน" })}${list.length > 300 ? `<p class="small muted">แสดง 300 จาก ${list.length} รายการ ใช้ช่องค้นหาเพื่อกรอง</p>` : ""}`,
      { title: dept === "ALL" ? "ชิ้นงานทั้งหมด" : `ชิ้นงานของแผนก ${esc(dept)} <span class="muted">${esc(rules.DEPT_LABEL[dept])}</span>`, actions: canEdit ? ui.openButton("เพิ่มชิ้นงานเดี่ยว", "itemEdit", {}, { className: "secondary" }) : "" });
    const selected = sel ? itemOf(ctx, sel) : null;
    let detail = "";
    if (selected) {
      const approved = approvedBomOf(ctx, selected.code);
      const revisions = data.boms.filter((bom) => bom.itemCode === selected.code).sort((a, b) => b.revision - a.revision);
      const tree = treeRows(ctx, selected.code, 1).slice(1);
      const treeHtml = ui.table(["ชั้น / ชิ้นงาน", "ชื่อ", "แผนกผลิต", { label: `ต่อ 1 ${uomText(ctx, selected.uom)}`, className: "right" }, "หน่วย", "Rev"],
        tree.map((line) => `<tr><td>${levelCell(line.level, ui.link(line.itemCode, ctx.url("items", { sel: line.itemCode }), "rf-mono"))}</td><td>${esc(line.name)}${line.noBom ? ` ${ui.badge("warn", "ไม่มี BOM")}` : ""}</td><td>${deptBadge(ctx, line.producerDept)}</td><td class="right rf-mono">${esc(rules.fmtQty(line.qtyPerFg))}</td><td>${esc(uomText(ctx, line.uom))}</td><td class="small muted">${line.revision ? `Rev.${line.revision}` : ""}</td></tr>`),
        { emptyText: selected.kind === "RB" ? "เส้นยางเป็นชิ้นปลายทางของ BOM นี้ สูตรคอมปาวด์อยู่ที่ RubberFlow" : selected.kind === "PURCHASED" ? "ของซื้อไม่มีส่วนประกอบ" : "ยังไม่มี BOM" });
      const rubber = selected.rubber;
      const facts = ui.kv([
        ["ชนิด", esc(kindLabel(ctx, selected.kind))], ["แผนกเจ้าของ (ใช้แยกงาน)", esc(`${selected.ownerDept} · ${rules.DEPT_LABEL[selected.ownerDept] ?? ""}`)], ["หน่วย", esc(uomText(ctx, selected.uom))],
        selected.weightG ? ["น้ำหนัก", esc(`${rules.fmtQty(selected.weightG)} กรัม`)] : null,
        rubber?.compound ? ["สูตรยาง", `${ui.link(rubber.compound, ctx.url("compounds", { q: rubber.compound }), "rf-mono")} ${data.compounds.find((c) => c.code === rubber.compound)?.recipeId ? ui.badge("good", "ผูก RubberFlow แล้ว") : ui.badge("warn", "ยังไม่ผูกสูตร RubberFlow")}`] : null,
        rubber && selected.kind === "RB" ? ["การตัด (GR)", esc(`ตัด ${rubber.cutLengthCm || "-"} ซม. · ${rubber.pcsPerRoll || "-"} ชิ้น/เส้น · ${rubber.sePerGr || 1} SE ต่อ 1 GR · ${rubber.kgPerRoll || "-"} กก./เส้น → ${rules.fmtQty(rules.rbPerSe({ pcsPerRoll: rubber.pcsPerRoll, sePerGr: rubber.sePerGr, uom: selected.uom, weightG: selected.weightG }))} เส้นต่อ 1 SE`)] : null,
        ["ใช้ใน", whereUsed(ctx, selected.code).length ? whereUsed(ctx, selected.code).map((code) => ui.link(code, ctx.url("items", { sel: code }), "rf-mono")).join(", ") : '<span class="muted">ไม่มีพ่อ</span>'],
        selected.legacyCodes.length ? ["รหัสเดิมในชีต", esc(selected.legacyCodes.join(", "))] : null,
        selected.clonedFrom ? ["สร้างจาก", esc(selected.clonedFrom)] : null,
      ]);
      const revRows = revisions.map((bom) => `<tr><td class="nowrap">Rev.${esc(String(bom.revision))}</td><td>${status(ctx, bom.status)}</td><td>${esc(String(bom.lines.length))} บรรทัด${bom.note ? `<div class="small muted">${esc(bom.note)}</div>` : ""}</td><td class="small">${bom.changeLog.map((entry) => `<div>${esc(`${rules.fmtDateTime(entry.at)} ${entry.by}: ${entry.text}`)}</div>`).join("")}</td></tr>`);
      const editable = canEdit && !ctx.helpers.NO_BOM_KINDS.includes(selected.kind);
      detail = ui.card(`${facts}
        <h3 class="bom-h3">ส่วนประกอบ${approved ? ` (Rev.${approved.revision} บันทึก ${esc(rules.fmtDate(approved.approvedAt))} โดย ${esc(approved.approvedBy)})` : ""}</h3>${treeHtml}
        <h3 class="bom-h3">ประวัติ revision</h3>${ui.table(["Rev", "สถานะ", "เนื้อหา", "การเปลี่ยนแปลง"], revRows, { emptyText: "ยังไม่มี revision" })}`,
        { title: `${esc(selected.code)} <span class="muted">${esc(selected.name)}</span>`, actions: `${selected.kind === "FG" && approved ? ui.link("งานทุกแผนก", ctx.url("product", { code: selected.code }), "btn rf-btn secondary") : ""}${canEdit ? ui.openButton("แก้ข้อมูลชิ้นงาน", "itemEdit", { code: selected.code }, { className: "secondary" }) : ""}${editable ? ui.link(approved ? "แก้ BOM" : "สร้าง BOM", buildUrl(ctx, selected.code), "btn rf-btn") : ""}` });
    }
    const html = `${head(ctx, "ค้นหาชิ้นงาน / ประวัติ BOM", "ดูต้นไม้ที่ระเบิดแล้ว ใช้ที่ไหนบ้าง และประวัติ revision · การแก้ทำที่เมนู “สร้าง BOM”")}${tabs}
      <div class="bom-split">${listCard}${detail}</div>`;
    return { html };
  };

  // ---------- สินค้า 1 ตัว → งานทุกแผนก (ดูอย่างเดียว) ----------
  // เลือก FG หนึ่งตัว + จำนวน → ระเบิด BOM แล้วจัดเป็นการ์ดต่อแผนกเรียงต้นน้ำ → ปลายน้ำ (RB → GR → PT → BG → ST → PK)
  // แต่ละการ์ดบอกว่าแผนกนั้นต้องทำอะไร เท่าไร จากอะไร และส่งต่อให้ใคร แทนการอ่าน BOMSHEET แล้วกรองธง P/O ทีละสถานีในไฟล์ Excel
  const DEPT_WORK = Object.freeze({ RB: "ต้องรีด", GR: "ต้องตัด/เจาะ", PT: "ต้องฉีด", BG: "ต้องเย็บ", ST: "ต้องเบิก/สั่งซื้อ", PK: "ต้องประกอบ/บรรจุ" });
  const rubberSize = (rubber) => (rubber && (rubber.lengthMm || rubber.odMm) ? `${rubber.type ? `แบบ ${rubber.type} · ` : ""}สี ${rubber.color || "-"} · ยาว ${rubber.lengthMm || "-"} × รู ${rubber.holeMm ?? "-"} × วงนอก ${rubber.odMm || "-"} มม.` : "");
  const cutText = (rubber) => (rubber && (rubber.cutLengthCm || rubber.pcsPerRoll) ? `ตัด ${rubber.cutLengthCm || "-"} ซม. · ${rubber.pcsPerRoll || "-"} ชิ้น/เส้น · ${rubber.sePerGr || 1} SE ต่อ GR` : "");
  const rbKg = (item, qty) => (!item ? 0 : item.uom === "kg" ? qty : item.rubber?.kgPerRoll ? qty * Number(item.rubber.kgPerRoll) : item.weightG ? qty * Number(item.weightG) / 1000 : 0);
  pages.product = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const canEdit = ctx.helpers.canPlan(user);
    const parsed = data.items.filter((item) => item.kind === "FG").map((item) => ({ item, ...rules.parseFgCode(item.code) }));
    const bases = [...new Set(parsed.map((entry) => entry.base))].sort();
    const base = String(params.get("base") ?? "").trim();
    const pkg = String(params.get("pkg") ?? "").trim().toUpperCase();
    const cs = String(params.get("cs") ?? "").trim().toUpperCase();
    const code = params.get("code") ? rules.canonicalCode(params.get("code")) : base ? rules.buildFgCode(base, pkg, cs) : "";
    const qty = Math.max(Number(params.get("qty")) || 0, 0) || 1;
    const current = code ? rules.parseFgCode(code) : { base, pkg, colorSet: cs };
    const pkgOptions = [...new Set([...rules.PACKAGES, ...parsed.map((entry) => entry.pkg).filter(Boolean)])].map((value) => ({ value, label: `(${value})` }));
    const colorOptions = [...new Set([...rules.COLOR_SETS, ...parsed.map((entry) => entry.colorSet).filter(Boolean)])].map((value) => ({ value, label: value }));
    const picker = ui.card(`<form class="bom-pick" data-bom-pick>
        <div class="rf-grid rf-g4">
          ${ui.field("ฐานรหัสสินค้า *", ui.input("base", { value: current.base, list: "bom-product-base-list", required: true, placeholder: "เช่น MEGA-ST-01", extra: 'autocapitalize="characters"' }))}
          ${ui.field("แพ็กเกจ", ui.select("pkg", pkgOptions, { value: current.pkg, placeholder: "ไม่ระบุ" }))}
          ${ui.field("ชุดสี", ui.select("cs", colorOptions, { value: current.colorSet, placeholder: "ไม่ระบุ" }))}
          ${ui.field("จำนวนสั่ง", ui.input("qty", { type: "number", step: "any", min: "0.0001", value: String(qty) }))}
        </div>
        <datalist id="bom-product-base-list">${bases.map((value) => `<option value="${attr(value)}">${esc(parsed.find((entry) => entry.base === value).item.name.slice(0, 50))}</option>`).join("")}</datalist>
        <div class="rf-row"><button class="btn rf-btn" type="submit">แสดงงานทุกแผนก</button></div>
      </form>`, { title: "เลือกสินค้า (ฐานรหัส + แพ็กเกจ + ชุดสี) และจำนวน" });
    const bindPick = (rootNode) => {
      rootNode.querySelector("[data-bom-pick]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        location.hash = ctx.url("product", { base: String(form.get("base") ?? "").trim(), pkg: String(form.get("pkg") ?? ""), cs: String(form.get("cs") ?? ""), qty: String(form.get("qty") ?? "") });
      });
    };
    const pageHead = head(ctx, "สินค้า 1 ตัว → งานทุกแผนก", "แต่ละแผนกต้องทำอะไร เท่าไร จากอะไร ตาม BOM ปัจจุบัน (ยังไม่หักคงคลัง)");
    if (!code) {
      const withBom = parsed.filter((entry) => approvedBomOf(ctx, entry.item.code)).sort((a, b) => a.item.code.localeCompare(b.item.code));
      const html = `${pageHead}${picker}
        ${ui.card(`${ui.table(["สินค้า", "BOM", ""], withBom.slice(0, 100).map((entry) => `<tr><td>${ui.mono(entry.item.code)}<div class="small muted">${esc(entry.item.name)}</div></td><td class="nowrap">Rev.${esc(String(approvedBomOf(ctx, entry.item.code).revision))}</td><td>${ui.link("ดูงานทุกแผนก", ctx.url("product", { code: entry.item.code }), "btn rf-btn secondary small")}</td></tr>`), { emptyText: "ยังไม่มีสินค้าที่มี BOM" })}${withBom.length > 100 ? `<p class="small muted">แสดง 100 จาก ${withBom.length} รายการ ใช้ช่องเลือกข้างบน</p>` : ""}`, { title: "สินค้าที่มี BOM", flush: true })}`;
      return { html, bind: bindPick };
    }
    const item = itemOf(ctx, code);
    if (!item) {
      const html = `${pageHead}${picker}${ui.callout("warn", `ไม่พบสินค้า <strong>${esc(code)}</strong> ใน item master${canEdit ? ` · ${ui.link("สร้าง BOM ของสินค้านี้", buildUrl(ctx, code))}` : ""}`)}`;
      return { html, bind: bindPick };
    }
    const { lines, missing } = rules.explode(item.code, qty, { itemOf: (c) => itemOf(ctx, c), approvedBomOf: (c) => approvedBomOf(ctx, c) });
    const net = rules.netRequirements(lines);
    const byCode = new Map(net.map((entry) => [entry.itemCode, entry]));
    const perFg = new Map();
    for (const line of lines) perFg.set(line.itemCode, (perFg.get(line.itemCode) ?? 0) + line.qtyPerFg);
    const approved = approvedBomOf(ctx, item.code);
    const noBom = [...new Set(lines.filter((line) => line.noBom).map((line) => line.itemCode))];
    const maxLevel = Math.max(...lines.map((line) => line.level));
    const facts = ui.kv([
      ["BOM", approved ? esc(`Rev.${approved.revision} บันทึก ${rules.fmtDate(approved.approvedAt)} โดย ${approved.approvedBy} · ลึกสุด ${maxLevel} ชั้น`) : ui.badge("warn", "ยังไม่มี BOM")],
    ]);
    const warnings = [
      missing.length ? ui.callout("warn", `ระเบิดไม่ครบ ไม่พบชิ้นงาน: ${esc(missing.join(", "))}`) : "",
      noBom.length ? ui.callout("warn", `ชิ้นที่ต้องผลิตแต่ยังไม่มี BOM (แผนกนั้นยังไม่รู้ว่าทำจากอะไร): ${noBom.map((c) => ui.link(c, canEdit ? buildUrl(ctx, c) : ctx.url("items", { sel: c }), "rf-mono")).join(", ")}`) : "",
    ].join("");
    const codeCell = (entry) => `${ui.link(entry.itemCode, ctx.url("items", { sel: entry.itemCode }), "rf-mono")}<div class="small muted">${esc(entry.name)}</div>`;
    const refList = (refs, detail = () => "") => (refs.length ? refs.map((ref) => `<div>${ui.link(ref.code, ctx.url("items", { sel: ref.code }), "rf-mono")}${detail(ref)}</div>`).join("") : '<span class="muted">—</span>');
    const usedBy = (entry) => refList(entry.parents, (ref) => (byCode.get(ref.code) ? ` ${deptBadge(ctx, byCode.get(ref.code).dept)}` : ""));
    const madeFrom = (entry) => refList(entry.children, (ref) => `<span class="small muted"> × ${esc(rules.fmtQty(ref.qtyPerParent))} ${esc(uomText(ctx, byCode.get(ref.code)?.uom))}</span>`);
    const qtyCells = (entry) => `<td class="right rf-mono">${esc(rules.fmtQty(perFg.get(entry.itemCode) ?? 0))}</td><td class="right rf-mono"><strong>${esc(rules.fmtQty(entry.required))}</strong></td><td class="nowrap">${esc(uomText(ctx, entry.uom))}</td>`;
    const QTY_HEAD = (work) => [{ label: "ใช้ : 1 FG", className: "right" }, { label: work, className: "right" }, "หน่วย"];
    const TABLES = {
      RB: { head: ["เส้นยาง", "สูตรยาง", "ขนาด", "ตัดเป็น (GR)", ...QTY_HEAD(DEPT_WORK.RB), { label: "กก. โดยประมาณ", className: "right" }], row: (entry) => {
        const rb = itemOf(ctx, entry.itemCode);
        const compound = rb?.rubber?.compound ? data.compounds.find((c) => c.code === rb.rubber.compound) : null;
        const kg = rbKg(rb, entry.required);
        return `<td>${codeCell(entry)}</td><td>${rb?.rubber?.compound ? `${ui.link(rb.rubber.compound, ctx.url("compounds", { q: rb.rubber.compound }), "rf-mono")}<div class="small">${compound?.recipeId ? ui.badge("good", "ผูก RubberFlow แล้ว") : ui.badge("warn", "ยังไม่ผูกสูตร")}</div>` : '<span class="muted">—</span>'}</td><td class="small bom-size">${esc(rubberSize(rb?.rubber)) || '<span class="muted">—</span>'}</td><td>${refList(entry.parents)}<div class="small muted">${esc(cutText(rb?.rubber))}</div></td>${qtyCells(entry)}<td class="right rf-mono">${kg ? esc(rules.fmtQty(kg, 2)) : '<span class="muted">—</span>'}</td>`;
      } },
      GR: { head: ["ชิ้นยาง (SE)", "ตัดจากเส้นยาง", "การตัด", "ใช้ใน", ...QTY_HEAD(DEPT_WORK.GR)], row: (entry) => {
        const cuts = entry.children.map((ref) => cutText(itemOf(ctx, ref.code)?.rubber)).filter(Boolean);
        return `<td>${codeCell(entry)}</td><td>${madeFrom(entry)}</td><td class="small bom-size">${cuts.length ? cuts.map((text) => `<div>${esc(text)}</div>`).join("") : '<span class="muted">—</span>'}</td><td>${usedBy(entry)}</td>${qtyCells(entry)}`;
      } },
      PT: { head: ["ชิ้นพลาสติก", "วัสดุ (ต่อ 1 ชิ้น)", "ใช้ใน", ...QTY_HEAD(DEPT_WORK.PT), { label: "น้ำหนัก/ชิ้น (ก.)", className: "right" }], row: (entry) => `<td>${codeCell(entry)}</td><td>${madeFrom(entry)}</td><td>${usedBy(entry)}</td>${qtyCells(entry)}<td class="right rf-mono">${itemOf(ctx, entry.itemCode)?.weightG ? esc(rules.fmtQty(itemOf(ctx, entry.itemCode).weightG)) : '<span class="muted">—</span>'}</td>` },
      BG: { head: ["ชิ้นงานเย็บ", "วัสดุ (ต่อ 1 ชิ้น)", "ใช้ใน", ...QTY_HEAD(DEPT_WORK.BG)], row: (entry) => `<td>${codeCell(entry)}</td><td>${madeFrom(entry)}</td><td>${usedBy(entry)}</td>${qtyCells(entry)}` },
      ST: { head: ["ของซื้อ / วัตถุดิบ", "เบิกให้", ...QTY_HEAD(DEPT_WORK.ST)], row: (entry) => `<td>${codeCell(entry)}</td><td>${usedBy(entry)}</td>${qtyCells(entry)}` },
      PK: { head: ["ชิ้นงาน", "ประกอบจาก (ชั้นแรก) / ใช้ใน", ...QTY_HEAD(DEPT_WORK.PK)], row: (entry) => `<td>${codeCell(entry)}${entry.kind === "FG" ? ` ${ui.badge("info", "สินค้าสำเร็จรูป")}` : ""}</td><td>${entry.children.length ? madeFrom(entry) : usedBy(entry)}</td>${qtyCells(entry)}` },
    };
    const generic = { head: ["ชิ้นงาน", "ใช้ใน", ...QTY_HEAD("ต้องการ")], row: (entry) => `<td>${codeCell(entry)}</td><td>${usedBy(entry)}</td>${qtyCells(entry)}` };
    const cards = approved ? rules.groupByDept(net).map((group) => {
      const spec = TABLES[group.dept] ?? generic;
      const rows = group.entries.sort((a, b) => a.itemCode.localeCompare(b.itemCode)).map((entry) => `<tr>${spec.row(entry)}</tr>`);
      return ui.card(ui.table(spec.head, rows), { title: `${esc(group.dept)} <span class="muted">${esc(rules.DEPT_LABEL[group.dept]?.replace(/^\w+ · /, "") ?? "")}</span>`, flush: true, className: "bom-dept-card" });
    }).join("") : ui.callout("info", `สินค้านี้ยังไม่มี BOM จึงยังไม่มีงานของแผนกใด${canEdit ? ` · ${ui.link("สร้าง BOM", buildUrl(ctx, item.code))}` : ""}`);
    const actions = [
      canEdit ? ui.link(approved ? "แก้ BOM" : "สร้าง BOM", buildUrl(ctx, item.code), "btn rf-btn secondary") : "",
      canEdit && approved ? ui.openButton("ใช้ในใบสั่งผลิต", "useInOrder", { code: item.code }, { className: "" }) : "",
      ui.link("ประวัติ revision", ctx.url("items", { sel: item.code }), "btn rf-btn secondary"),
    ].join("");
    const html = `${pageHead}${picker}${ui.card(`${facts}${warnings}`, { title: `${esc(item.code)} <span class="muted">${esc(item.name)}</span> × ${esc(rules.fmtQty(qty))} ${esc(uomText(ctx, item.uom))}`, actions })}<div class="bom-dept-grid">${cards}</div>`;
    return { html, bind: bindPick };
  };

  // ---------- โครงสร้างสินค้า (จำลอง): ลำดับผลิต (ขั้นแรกอยู่บน) และตารางต้นทุน (FG อยู่บน) ----------
  // แนวคิดจากเมนู "โครงสร้าง" ของ ERP เดิม: ส่วนประกอบ (BOM) กับขั้นตอนผลิต (routing นาที/ชิ้น และวัตถุดิบที่เข้าแต่ละขั้น) คำนวณโดย rules.structureTree
  // ต่างจากของเดิมโดยตั้งใจ: ชิ้นย่อยอ้างอิง BOM/routing ของตัวเอง (ไม่คัดลอกทั้งกิ่ง) และ WIP ไม่ต้องตั้งรหัสเป็นชิ้นงาน — มุมมองลำดับผลิตสร้างจากข้อมูลชุดเดียวกัน
  const structureDeps = (ctx) => ({ itemOf: (c) => itemOf(ctx, c), approvedBomOf: (c) => approvedBomOf(ctx, c), routingOf: (c) => ctx.helpers.routingOf(ctx.data, c), processOf: (c) => ctx.helpers.processOf(ctx.data, c) });
  const baht = (ctx, n) => ctx.rules.fmtNum(n, 2);
  const picture = (node, size = "") => (node.image
    ? `<img class="bom-pic${size}" src="${attr(node.image)}" alt="${attr(node.itemCode)}">`
    : `<span class="bom-pic${size} is-empty" aria-hidden="true">${esc({ PURCHASED: "ซื้อ", SUBPART: "ชิ้นทำ" }[node.kind] ?? node.kind)}</span>`);
  const qtyText = (ctx, node) => `× ${esc(ctx.rules.fmtQty(node.qtyPerParent))} ${esc(uomText(ctx, node.uom))}${node.scrapPct ? ` +${esc(ctx.rules.fmtNum(node.scrapPct))}%` : ""}`;
  const flowArrow = '<div class="bom-flow-arrow" aria-hidden="true">▼</div>';
  function flowHtml(ctx, node, canEdit) {
    const { ui, rules } = ctx;
    const { feeds, stages } = rules.flowOf(node);
    const fed = new Set(feeds.map((feed) => feed.itemCode));
    const lanes = feeds.length ? `<div class="bom-flow-feeds">${feeds.map((feed) => `<details class="bom-flow-lane" open><summary>${ui.mono(feed.itemCode)} <span class="small muted">${qtyText(ctx, feed)}</span></summary>${flowHtml(ctx, feed, canEdit)}</details>`).join("")}</div>${flowArrow}` : "";
    const compound = node.kind === "RB" ? itemOf(ctx, node.itemCode)?.rubber?.compound : null;
    const parts = stages.map((stage, index) => {
      // วัตถุดิบแสดงรหัส + ชื่อ + ปริมาณ · ชิ้นที่มาจากสายด้านบนแสดงแค่รหัส เพราะชื่ออยู่ในการ์ดของสายนั้นแล้ว
      const inputs = stage.inputs.map((child) => {
        const isFed = fed.has(child.itemCode);
        const name = !isFed && child.name && child.name !== child.itemCode ? ` <span class="bom-flow-input-name">${esc(child.name)}</span>` : "";
        const note = isFed ? ' <span class="muted">(จากสายด้านบน)</span>' : child.ownCost === null && !child.children.length ? ` ${ui.badge("warn", "ไม่มีราคา")}` : "";
        return `<li class="bom-flow-input${isFed ? " is-fed" : ""}" data-bom-menu="${attr(child.itemCode)}" data-bom-menu-parent="${attr(node.itemCode)}">${picture(child, " is-mini")}<span>${ui.mono(child.itemCode)}${name} <span class="muted nowrap">${qtyText(ctx, child)}</span>${note}</span></li>`;
      });
      // คอมปาวด์ของเส้นยาง: ถ้ามีชิ้นงานรหัสเดียวกันที่มี BOM (เช่น สูตรเคมีที่นำเข้ามา) ลิงก์ไปดูโครงสร้างของมัน ไม่กางซ้อนในต้นไม้นี้
      const recipe = compound && approvedBomOf(ctx, rules.canonicalCode(compound)) ? ui.link("ดูสูตร", ctx.url("structure", { code: compound }), "small") : '<span class="muted">(สูตรอยู่ที่ RubberFlow)</span>';
      if (compound && index === 0) inputs.unshift(`<li class="bom-flow-input"><span class="bom-pic is-mini is-empty" aria-hidden="true">RF</span><span>คอมปาวด์ ${ui.mono(compound)} ${recipe}</span></li>`);
      const list = inputs.length ? `<ul class="bom-flow-inputs">${inputs.join("")}</ul>` : "";
      // หลายขั้น: ใส่เลขขั้นให้ตรงกับช่อง "ขั้นที่" ของหน้าสร้าง BOM · มีขั้นตอนผลิต = เลขอยู่ในกล่องขั้นตอนที่ตามหลังวัตถุดิบ
      // ไม่มีขั้นตอนผลิต = เลขเป็นหัวข้อเหนือวัตถุดิบของขั้นนั้น
      const no = stages.length > 1 ? `<span class="bom-flow-step-no">ขั้นที่ ${esc(String(stage.no))}</span>` : "";
      if (!stage.step) return list && no ? `<div class="bom-flow-stage-head">${no}</div>${list}` : list;
      // แผนกของขั้นตอนแสดงเฉพาะเมื่อต่างจากแผนกที่รับผิดชอบชิ้นนี้ (ป้ายบนการ์ด)
      const stepDept = stage.step.dept === node.dept ? "" : `<span class="bom-flow-dept">${esc(stage.step.dept)}</span>`;
      const step = `<div class="bom-flow-step" title="${attr(`${stage.step.name} · ${rules.DEPT_LABEL[stage.step.dept] ?? stage.step.dept} · ค่าแรง ${baht(ctx, stage.step.cost)} บาท/ชิ้น`)}">${no}${stepDept}<span class="bom-flow-step-name">${esc(stage.step.name)} <span class="muted rf-mono">${esc(stage.step.processCode)}</span></span><span class="nowrap">${esc(rules.fmtNum(stage.step.minutesPerPc))} นาที</span></div>`;
      return [list, step].filter(Boolean).join(list ? flowArrow : "");
    }).filter(Boolean);
    const tools = canEdit ? `<div class="rf-row">${node.kind === "PURCHASED" ? "" : ui.openButton(node.steps.length ? "ขั้นตอน" : "+ ขั้นตอน", "routingEdit", { code: node.itemCode }, { className: "secondary small", ariaLabel: `ขั้นตอนผลิตของ ${node.itemCode}` })}${ui.openButton("รูป", "itemImage", { code: node.itemCode }, { className: "secondary small", ariaLabel: `รูปของ ${node.itemCode}` })}</div>` : "";
    // ป้ายบนการ์ด: ลำดับการผลิต (rules.structureTree: เลขน้อยทำก่อน เลขเท่ากันทำพร้อมกันได้) และแผนกที่รับผิดชอบ (ownerDept ของชิ้นงาน)
    const deptName = rules.DEPT_LABEL[node.dept] ?? node.dept;
    const tags = `<div class="bom-flow-tags"><span class="bom-flow-order" title="ลำดับการผลิต: เลขน้อยทำก่อน เลขเดียวกันทำพร้อมกันได้">ลำดับ ${esc(String(node.order))}</span><span class="bom-flow-dept" title="แผนกที่รับผิดชอบ">${esc(deptName)}</span></div>`;
    // การ์ด focus ได้ เพื่อเปิดเมนูคำสั่งด้วยปุ่ม Menu/Shift+F10 (บทบาทที่ดูอย่างเดียวไม่มีปุ่มในการ์ดให้ focus)
    const card = `<div class="bom-flow-item${node.level === 0 ? " is-root" : ""}" data-bom-menu="${attr(node.itemCode)}" tabindex="0" role="group" aria-label="${attr(`ลำดับ ${node.order} · ${deptName} · ${node.itemCode} ${node.name} — คลิกขวา กดค้าง หรือปุ่ม Menu เพื่อดูคำสั่ง`)}">${picture(node)}<div class="bom-flow-item-body">${tags}${ui.mono(node.itemCode)}<div class="small">${esc(node.name)}</div><div class="small muted">${node.ownCost === null && !node.children.length ? ui.badge("warn", "ไม่มีราคา") : `${node.complete ? "" : '<span title="ต้นทุนไม่ครบ: มีชิ้นข้างใต้ที่ไม่มีราคา">⚠ </span>'}${baht(ctx, node.unitCost)} บาท/${esc(uomText(ctx, node.uom))}`}</div>${tools}</div></div>`;
    // เส้นยางที่ป้อนชิ้นอื่น: SR รับเข้าคลัง + QC ตรวจขนาด เป็นลำดับถัดจากรีด ก่อน GR เบิกไปแปรรูป (ตามผังงานของบริษัท)
    const receive = node.kind === "RB" && node.level > 0 ? `<div class="bom-flow-step is-receive"><span class="bom-flow-order">ลำดับ ${esc(String(node.order + 1))}</span><span class="bom-flow-dept">${esc(rules.DEPT_LABEL.SR)}</span><span class="bom-flow-step-name">รับเส้นยางเข้าคลัง · ตรวจขนาด</span></div>` : "";
    return `<div class="bom-flow-node">${lanes}${[...parts, card, receive].filter(Boolean).join(flowArrow)}</div>`;
  }
  // เมนูคลิกขวา (กดค้างบนมือถือ) ของหน้าโครงสร้าง: คำสั่งของชิ้นที่ชี้ เป็นกลุ่ม แก้ไข · ไปที่ · คัดลอก
  // target = { code, parent (พ่อเมื่อชี้แถววัตถุดิบ ว่างเมื่อชี้การ์ด), root (สินค้าที่เปิดอยู่) } · บทบาทที่แก้ไม่ได้เห็นเฉพาะไปที่/คัดลอก
  // คืน [[{ label, open?, args?, go?, copy? }]] ทุกคำสั่งมีทางอื่นในหน้าอยู่แล้ว (ปุ่มในการ์ด ตารางต้นทุน dialog ขั้นตอน) เมนูเป็นทางลัด
  function structureMenu(ctx, { code, parent = "", root = "" }) {
    const item = itemOf(ctx, code);
    if (!item) return [];
    const canEdit = ctx.helpers.canPlan(ctx.user);
    const hasBom = Boolean(approvedBomOf(ctx, item.code));
    const makesBom = !ctx.helpers.NO_BOM_KINDS.includes(item.kind);
    const parentItem = parent ? itemOf(ctx, parent) : null;
    const edit = canEdit ? [
      hasBom ? null : { label: "ตั้งราคา…", open: "itemCost", args: { code: item.code } },
      parentItem ? { label: `เข้าที่ขั้นไหน… (ขั้นตอนของ ${parentItem.code})`, open: "routingEdit", args: { code: parentItem.code } }
        : item.kind === "PURCHASED" ? null : { label: "ขั้นตอนผลิต…", open: "routingEdit", args: { code: item.code } },
      { label: "รูป…", open: "itemImage", args: { code: item.code } },
    ] : [];
    const go = [
      item.code !== root && (hasBom || makesBom) ? { label: `เปิดโครงสร้างของ ${item.code}`, go: ctx.url("structure", { code: item.code }) } : null,
      canEdit && parentItem ? { label: `แก้บรรทัดนี้ใน BOM ของ ${parentItem.code}`, go: buildUrl(ctx, parentItem.code) } : null,
      canEdit && !parentItem && makesBom ? { label: "แก้ส่วนประกอบ (สร้าง BOM)", go: buildUrl(ctx, item.code) } : null,
      { label: "ประวัติ BOM / ใช้ในสินค้าไหน", go: ctx.url("items", { sel: item.code }) },
    ];
    const copy = [{ label: "คัดลอกรหัส", copy: item.code }, { label: "คัดลอกรหัส + ชื่อ (วางใน Excel ได้ 2 ช่อง)", copy: copyCodeAndName(item.code, item.name) }];
    return [edit, go, copy].map((group) => group.filter(Boolean)).filter((group) => group.length);
  }

  // ตัวช่วยล้วนของเมนู (เทสต์ได้โดยไม่มี DOM)
  // Shift+คลิกขวาด้วยเมาส์ (button 2) = เมนูของเบราว์เซอร์ · Shift+F10 จากคีย์บอร์ดส่ง contextmenu ที่ button 0 จึงยังเปิดเมนูของเรา
  const browserMenuWanted = (event) => Boolean(event.shiftKey) && event.button === 2;
  // วางเมนูที่จุดคลิกแต่ไม่ให้ล้นจอ (เว้นขอบ 4px) · เมนูสูงกว่าจอใช้ max-height + เลื่อนในเมนูเอง (CSS)
  const menuPosition = (x, y, width, height, viewWidth, viewHeight) => ({
    left: Math.max(4, Math.min(x, viewWidth - width - 4)),
    top: Math.max(4, Math.min(y, viewHeight - height - 4)),
  });
  // รหัส + ชื่อ คั่นด้วย tab (วางใน Excel ได้ 2 ช่อง) · tab/ขึ้นบรรทัดในชื่อที่นำเข้าจาก Excel กลายเป็นช่องว่าง ไม่ให้แตกช่อง
  const copyCodeAndName = (code, name) => `${code}\t${String(name ?? "").replace(/[\t\r\n]+/g, " ").trim()}`;

  // ผูกเมนูกับมุมมองลำดับผลิต: คลิกขวา / ปุ่ม Menu หรือ Shift+F10 (การ์ด focus ได้) / กดค้าง 0.55 วินาทีบนจอสัมผัส · Shift+คลิกขวา = เมนูของเบราว์เซอร์
  // เมนูเป็น data-popup ลูกคนเดียวของกรอบ .bom-ctx-host (ต่อท้าย .bom-flow) จึงใช้กฎกลาง closePopup ของ app.js:
  // แตะ/คลิกหรือย้าย focus ที่ใดก็ตามนอกเมนู (รวมส่วนอื่นของการ์ดเดิม) = ปิด · ไม่ปิดด้วย blur
  function bindStructureMenu(ctx, flow, rootCode) {
    const host = document.createElement("div");
    host.className = "bom-ctx-host";
    const menu = document.createElement("div");
    menu.className = "bom-ctx-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-popup", "");
    menu.hidden = true;
    host.append(menu);
    flow.append(host);
    let entries = [];
    let openFor = null;
    let returnFocus = null;
    const close = () => { if (!menu.hidden) closePopup(menu); };
    // เมนูติดจอ: เลื่อนหน้าแล้วจะไม่ตรงกับชิ้นที่ชี้ จึงปิด · เลื่อนภายในเมนูเอง (เมนูยาว) ไม่ปิด
    const onScroll = (event) => { if (!menu.contains(event.target)) close(); };
    menu.addEventListener("popup-close", () => { window.removeEventListener("scroll", onScroll, true); openFor = null; });
    const items = () => [...menu.querySelectorAll("[role=menuitem]")];
    const open = (target, x, y) => {
      if (!menu.hidden && openFor === target) return; // Android ส่ง contextmenu ระหว่างกดค้างด้วย ไม่เปิดซ้ำ
      const groups = structureMenu(ctx, { code: target.dataset.bomMenu, parent: target.dataset.bomMenuParent ?? "", root: rootCode });
      entries = groups.flat();
      if (!entries.length) return;
      let index = 0;
      menu.innerHTML = groups.map((group) => group.map((entry) => `<button type="button" role="menuitem" class="bom-ctx-item" tabindex="-1" data-i="${index++}">${esc(entry.label)}</button>`).join("")).join('<div class="bom-ctx-sep" role="separator"></div>');
      menu.setAttribute("aria-label", `คำสั่งของ ${target.dataset.bomMenu}`);
      const active = document.activeElement;
      returnFocus = active && active !== document.body && !menu.contains(active) ? active : null;
      openFor = target;
      menu.style.left = "0px";
      menu.style.top = "0px";
      menu.hidden = false;
      const at = menuPosition(x, y, menu.offsetWidth, menu.offsetHeight, window.innerWidth, window.innerHeight);
      menu.style.left = `${at.left}px`;
      menu.style.top = `${at.top}px`;
      window.addEventListener("scroll", onScroll, true);
      items()[0]?.focus({ preventScroll: true });
    };
    const run = async (entry) => {
      close();
      if (entry.open) ctx.openDialog(entry.open, entry.args);
      else if (entry.go) location.hash = entry.go;
      else if (entry.copy !== undefined) {
        try { await navigator.clipboard.writeText(entry.copy); showToast("คัดลอกแล้ว"); } catch { showToast("คัดลอกไม่ได้ เบราว์เซอร์ไม่อนุญาตให้เขียนคลิปบอร์ด", "error"); }
      }
    };
    menu.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-i]");
      if (button) run(entries[Number(button.dataset.i)]);
    });
    menu.addEventListener("keydown", (event) => {
      const list = items();
      const at = list.indexOf(document.activeElement);
      const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[event.key];
      if (move !== undefined) { event.preventDefault(); list[(move + list.length) % list.length]?.focus(); }
      else if (event.key === "Escape" || event.key === "Tab") {
        // คืน focus ให้สิ่งที่เปิดเมนู: Escape อยู่ที่นั่น · Tab ไปต่อจากตรงนั้น (ไม่หลุดไปท้ายหน้า)
        if (event.key === "Escape") event.preventDefault();
        const back = returnFocus;
        close();
        back?.focus?.();
      }
    });
    let press = null;
    flow.addEventListener("contextmenu", (event) => {
      if (browserMenuWanted(event)) return;
      if (menu.contains(event.target)) { event.preventDefault(); return; }
      const target = event.target.closest?.("[data-bom-menu]");
      if (!target) return;
      event.preventDefault();
      if (press) { clearTimeout(press.timer); press.fired = true; } // Android เปิดจาก contextmenu แล้ว ตัวจับเวลากดค้างไม่ต้องเปิดอีก
      let { clientX: x, clientY: y } = event;
      if (!x && !y) { const rect = event.target.getBoundingClientRect(); x = rect.left; y = rect.bottom; } // จากคีย์บอร์ด: ไม่มีพิกัด เปิดใต้สิ่งที่ focus
      open(target, x, y);
    });
    // กดค้างบนจอสัมผัส (iPhone ไม่ส่ง contextmenu): ขยับนิ้วเกิน 10px หรือยกนิ้วก่อนเวลา = ยกเลิก · นิ้วอื่นที่แตะซ้อนไม่ยุ่งกับการกดค้างที่กำลังนับ
    // กดค้างแล้วไม่ให้ click ที่ตามมาไปกดปุ่มในการ์ด
    flow.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || menu.contains(event.target) || press) return;
      const target = event.target.closest?.("[data-bom-menu]");
      if (!target) return;
      const { clientX: x, clientY: y, pointerId } = event;
      press = { pointerId, x, y, fired: false, timer: setTimeout(() => { press.fired = true; open(target, x, y); }, 550) };
    });
    flow.addEventListener("pointermove", (event) => {
      if (press && event.pointerId === press.pointerId && !press.fired && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
    });
    const release = (event) => {
      if (!press || event.pointerId !== press.pointerId) return;
      clearTimeout(press.timer);
      if (press.fired) {
        // mouse event สังเคราะห์ที่ตามการยกนิ้ว (ถ้ามี) มาทันที: กันทั้ง mousedown (จะ focus การ์ดแล้วกฎกลางปิดเมนู) และ click
        // รวมถึง click ที่ตกบนเมนู (เมนูถูกดันเข้าจอจนอยู่ใต้นิ้ว ไม่ให้สั่งคำสั่งเองตอนยกนิ้ว) · กันแค่ 400ms ไม่ให้กลืนการแตะครั้งถัดไป
        const block = (mouseEvent) => { mouseEvent.preventDefault(); mouseEvent.stopPropagation(); };
        for (const type of ["mousedown", "click"]) {
          flow.addEventListener(type, block, { capture: true, once: true });
          setTimeout(() => flow.removeEventListener(type, block, { capture: true }), 400);
        }
      }
      press = null;
    };
    flow.addEventListener("pointerup", release);
    flow.addEventListener("pointercancel", release);
  }
  Object.assign(structureMenu, { browserMenuWanted, menuPosition, copyCodeAndName });

  pages.structure = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const canEdit = ctx.helpers.canPlan(user);
    const code = params.get("code") ? rules.canonicalCode(params.get("code")) : "";
    const qty = Math.max(Number(params.get("qty")) || 0, 0) || 1;
    const view = ["table", "steps"].includes(params.get("view")) ? params.get("view") : "flow";
    const roots = data.items.filter((item) => item.kind === "FG" || approvedBomOf(ctx, item.code)).sort((a, b) => a.code.localeCompare(b.code));
    const picker = ui.card(`<form class="bom-pick" data-bom-pick>
        <div class="rf-grid rf-g4">
          ${ui.field("รหัสสินค้า/ชิ้นงาน *", ui.input("code", { value: code, list: "bom-structure-list", required: true, placeholder: "เช่น DEMO-TP-01(P)-Y", extra: 'autocapitalize="characters"' }))}
          ${ui.field("จำนวนสั่ง", ui.input("qty", { type: "number", step: "any", min: "0.0001", value: String(qty) }))}
        </div>
        <datalist id="bom-structure-list">${roots.map((item) => `<option value="${attr(item.code)}">${esc(item.name.slice(0, 50))}</option>`).join("")}</datalist>
        <div class="rf-row"><button class="btn rf-btn" type="submit">แสดงโครงสร้าง</button></div>
      </form>`, { title: "เลือกสินค้าและจำนวน" });
    const bind = (rootNode) => {
      rootNode.querySelector("[data-bom-pick]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        location.hash = ctx.url("structure", { code: String(form.get("code") ?? "").trim(), qty: String(form.get("qty") ?? ""), view });
      });
      const flow = rootNode.querySelector(".bom-flow");
      if (flow && code) bindStructureMenu(ctx, flow, code);
    };
    const pageHead = head(ctx, "โครงสร้างสินค้า (จำลอง)", "ลำดับผลิตจากขั้นแรกจนเป็นสินค้า ต้นทุนต่อหน่วย และเวลาที่แต่ละแผนกใช้ — ราคาและอัตราค่าแรงเป็นตัวเลขสาธิต");
    if (!code) {
      const rows = roots.filter((item) => item.kind === "FG").map((item) => {
        const tree = rules.structureTree(item.code, structureDeps(ctx));
        return `<tr><td><div class="bom-flow-pick">${picture(tree.root, " is-mini")}<span>${ui.mono(item.code)}<div class="small muted">${esc(item.name)}</div></span></div></td><td class="num nowrap">${tree.root.complete ? baht(ctx, tree.root.unitCost) : ui.badge("warn", "ไม่ครบ")}</td><td>${ui.link("ดูโครงสร้าง", ctx.url("structure", { code: item.code }), "btn rf-btn secondary small")}</td></tr>`;
      });
      return { html: `${pageHead}${picker}${ui.card(ui.table(["สินค้า", "ต้นทุน/หน่วย (บาท)", ""], rows, { emptyText: "ยังไม่มีสินค้า" }), { title: "สินค้าสำเร็จรูป", flush: true })}`, bind };
    }
    const item = itemOf(ctx, code);
    if (!item) return { html: `${pageHead}${picker}${ui.callout("warn", `ไม่พบ <strong>${esc(code)}</strong> ใน item master`)}`, bind };
    const tree = rules.structureTree(item.code, structureDeps(ctx));
    const views = `<nav class="rf-pagenav" aria-label="มุมมองโครงสร้าง">${[["flow", "ลำดับผลิต (ขั้นแรกอยู่บน)"], ["steps", "ขั้นตอนตามลำดับ (ใช้อะไร ได้อะไร)"], ["table", "ตารางต้นทุน (สินค้าอยู่บน)"]].map(([id, label]) => `<a class="filter${id === view ? " active" : ""}" href="${attr(ctx.url("structure", { code: item.code, qty: String(qty), view: id }))}"${id === view ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>`;
    let body;
    if (view === "flow") {
      body = `<div class="bom-flow">${flowHtml(ctx, tree.root, canEdit)}</div>`;
    } else if (view === "steps") {
      // ขั้นตอนตามลำดับ (ตามผังงาน ST → ผลิต → SR/QC → … → PK → WH): แถวละงาน เรียงจากลำดับแรก
      // ส่วนประกอบที่ต้องผลิตก่อนบอกลำดับที่พร้อมใช้ และไม่ซ้ำชื่อ เพราะชื่ออยู่ในแถวของลำดับนั้นแล้ว · ของซื้อมาจากแถว ST
      const from = (code, order) => `${ui.mono(code)} <span class="bom-flow-order is-quiet">จากลำดับ ${esc(String(order))}</span>`;
      const amount = (n, uom) => `${esc(rules.fmtQty(n * qty))} ${esc(uomText(ctx, uom))}`;
      const rows = rules.productionSteps(tree).map((step) => {
        const badge = step.type === "purchase" ? '<span class="bom-flow-order" title="ก่อนเริ่มผลิต">เริ่ม</span>' : `<span class="bom-flow-order">ลำดับ ${esc(String(step.order))}</span>`;
        const dept = `<td class="nowrap">${esc(rules.DEPT_LABEL[step.dept] ?? step.dept)}</td>`;
        if (step.type === "purchase") {
          const list = `<ul class="bom-step-inputs">${step.inputs.map((input) => `<li>${ui.mono(input.itemCode)} <span class="small">${esc(input.name)}</span> <span class="muted nowrap">รวม ${amount(input.qtyPerRoot, input.uom)}</span></li>`).join("")}</ul>`;
          return `<tr><td>${badge}</td>${dept}<td>สั่ง/เบิกวัตถุดิบที่เกี่ยวข้องกับการผลิต</td><td class="num nowrap">${esc(String(step.inputs.length))} รายการ</td><td>${list}</td></tr>`;
        }
        const what = { receive: "รับเข้าคลัง · QC ตรวจขนาดขณะรับเข้า", store: "รับสินค้าจาก PK เข้าคลัง" }[step.type];
        const work = `${ui.mono(step.itemCode)}<div class="small">${esc(what ?? step.name)}</div>${step.steps.length ? `<div class="small muted">${step.steps.map((s) => esc(s.name)).join(" → ")}</div>` : ""}`;
        let inputs;
        if (step.type !== "make") inputs = from(step.itemCode, step.order - 1);
        else if (step.inputs.length) inputs = `<ul class="bom-step-inputs">${step.inputs.map((input) => `<li>${input.from === null ? `${ui.mono(input.itemCode)} <span class="small">${esc(input.name)}</span> <span class="muted nowrap">${qtyText(ctx, input)}</span>` : `${ui.mono(input.itemCode)} <span class="muted nowrap">${qtyText(ctx, input)}</span> <span class="bom-flow-order is-quiet">จากลำดับ ${esc(String(input.from))}</span>`}</li>`).join("")}</ul>`;
        else inputs = itemOf(ctx, step.itemCode)?.rubber?.compound ? `คอมปาวด์ ${ui.mono(itemOf(ctx, step.itemCode).rubber.compound)} <span class="muted">(สูตรอยู่ที่ RubberFlow)</span>` : '<span class="muted">ยังไม่มี BOM</span>';
        return `<tr><td>${badge}</td>${dept}<td>${work}</td><td class="num nowrap">${amount(step.qtyPerRoot, step.uom)}</td><td>${inputs}</td></tr>`;
      });
      body = ui.table(["ลำดับ", "แผนก", "งาน", `จำนวน (สำหรับ ${rules.fmtNum(qty)} หน่วย)`, "ใช้"], rows);
    } else {
      const rows = tree.rows.map((node) => {
        const noBomLeaf = node.bomRevision === null;
        const stepsHtml = node.steps.map((step) => `<span class="rf-badge" title="${attr(`${step.name} · ${step.dept} · ${baht(ctx, step.cost)} บาท/ชิ้น`)}">${esc(`${step.processCode} ${rules.fmtNum(step.minutesPerPc)}′`)}</span>`).join(" ");
        const stepEdit = canEdit && node.kind !== "PURCHASED" ? ui.openButton(node.steps.length ? "แก้" : "+ ขั้นตอน", "routingEdit", { code: node.itemCode }, { className: "secondary small", ariaLabel: `ขั้นตอนผลิตของ ${node.itemCode}` }) : "";
        const material = noBomLeaf && node.ownCost === null ? ui.badge("warn", "ไม่มีราคา") : baht(ctx, node.material);
        const costEdit = canEdit && noBomLeaf ? ` ${ui.openButton("ราคา", "itemCost", { code: node.itemCode }, { className: "secondary small", ariaLabel: `ตั้งราคาต้นทุนของ ${node.itemCode}` })}` : "";
        const perParent = node.level === 0 ? "" : `${esc(rules.fmtQty(node.qtyPerParent))} ${esc(uomText(ctx, node.uom))}${node.scrapPct ? ` <span class="small muted">+${esc(rules.fmtNum(node.scrapPct))}%</span>` : ""}`;
        const name = `${levelCell(node.level, ui.mono(node.itemCode))}<div class="small muted">${esc(node.name)}${node.bomRevision ? ` · BOM Rev.${node.bomRevision}` : ""}</div>`;
        const unit = `${node.complete ? "" : '<span title="ต้นทุนไม่ครบ: มีชิ้นข้างใต้ที่ไม่มีราคา">⚠ </span>'}${baht(ctx, node.unitCost)}`;
        return `<tr><td>${name}</td><td class="nowrap">${perParent}</td><td>${stepsHtml}${stepEdit ? ` ${stepEdit}` : ""}</td><td class="num nowrap">${material}${costEdit}</td><td class="num nowrap">${baht(ctx, node.labor)}</td><td class="num nowrap">${node.level === 0 ? `<strong>${unit}</strong>` : unit}</td><td class="num nowrap">${node.level === 0 ? "" : baht(ctx, node.costPerRoot)}</td></tr>`;
      });
      body = ui.table(["ชิ้นงาน", "ต่อพ่อ", "ขั้นตอนผลิต (นาที/ชิ้น)", "วัตถุดิบ/หน่วย", "ค่าแรง/หน่วย", "ต้นทุน/หน่วย", "ต่อสินค้า 1 หน่วย"], rows);
    }
    const rates = Object.entries(rules.LABOR_BAHT_PER_MIN).map(([dept, rate]) => `${dept} ${rules.fmtNum(rate)}`).join(" · ");
    const depts = rules.FLOW_DEPTS.filter((dept) => tree.minutesByDept[dept]);
    const minutesRows = depts.map((dept) => `<tr><td>${esc(rules.DEPT_LABEL[dept] ?? dept)}</td><td class="num">${rules.fmtNum(tree.minutesByDept[dept])}</td><td class="num">${rules.fmtNum(tree.minutesByDept[dept] * qty / 60, 1)}</td></tr>`);
    if (depts.length > 1) minutesRows.push(`<tr><td><strong>รวม</strong></td><td class="num"><strong>${rules.fmtNum(tree.totalMinutes)}</strong></td><td class="num"><strong>${rules.fmtNum(tree.totalMinutes * qty / 60, 1)}</strong></td></tr>`);
    const warnings = [
      tree.missingCost.length ? ui.callout("warn", `ต้นทุนยังไม่ครบ: ไม่มีราคาของ ${tree.missingCost.map((entry) => `<strong>${esc(entry)}</strong>`).join(", ")}${canEdit ? ` (ตั้งราคาได้ที่ ${ui.link("ตารางต้นทุน", ctx.url("structure", { code: item.code, qty: String(qty), view: "table" }))})` : ""}`) : "",
      tree.missing.length ? ui.callout("bad", `ไม่พบใน item master หรือเป็นวงจร: ${tree.missing.map((entry) => esc(entry)).join(", ")}`) : "",
    ].join("");
    const html = `${pageHead}${picker}${warnings}${views}
      ${ui.card(body, { title: `${esc(item.code)} — ${esc(item.name)}`, actions: canEdit ? ui.link("แก้ส่วนประกอบ (สร้าง BOM)", buildUrl(ctx, item.code), "btn rf-btn secondary small") : "", flush: view !== "flow" })}
      ${ui.card(ui.table(["แผนก", "นาที ต่อ 1 หน่วย", `ชั่วโมง สำหรับ ${rules.fmtNum(qty)} หน่วย`], minutesRows, { emptyText: "ยังไม่มีขั้นตอนผลิตในโครงสร้างนี้" }), { title: `เวลาผลิตต่อแผนก · ค่าแรงสาธิต (บาท/นาที): ${esc(rates)}`, flush: true })}`;
    return { html, bind };
  };
  pages.structure.menu = structureMenu; // ให้เทสต์ตรวจรายการคำสั่งได้โดยไม่ต้องมี DOM
  // dialog: ขั้นตอนผลิตของชิ้นงาน (เพิ่ม/ลบ/เลื่อนขึ้นลง และเลือกว่าวัตถุดิบแต่ละตัวเข้าที่ขั้นไหน แล้วบันทึกเป็น revision ใหม่)
  dialogs.routingEdit = (ctx, { code = "" }) => {
    const { ui, data, rules } = ctx;
    const item = itemOf(ctx, code);
    if (!item) return null;
    const routing = ctx.helpers.routingOf(data, item.code);
    const options = data.processes.map((process) => ({ value: process.code, label: `${process.code} ${process.name} (${process.dept})` }));
    const stepRow = (step = {}) => `<tr data-step><td><div class="bom-step-cell">${dragHandle("ย้ายขั้นตอนนี้")}${ui.select("processCode[]", options, { value: step.processCode ?? "", placeholder: "เลือกขั้นตอน" })}</div></td><td>${ui.input("minutesPerPc[]", { type: "number", step: "any", min: "0", value: step.minutesPerPc ?? "" })}</td><td class="nowrap"><button class="btn rf-btn secondary small" type="button" data-step-remove aria-label="ลบขั้นตอน">✕</button></td></tr>`;
    const steps = routing?.steps ?? [];
    const lines = approvedBomOf(ctx, item.code)?.lines ?? [];
    const stepOfInput = (childCode) => steps.find((step) => (step.inputs ?? []).includes(childCode))?.processCode ?? "";
    // ไม่เลือกขั้นตอน = ใช้ "ขั้นที่" ของบรรทัด BOM (ถ้ามี) ไม่เช่นนั้นขั้นแรก · เลือกขั้นตอนที่นี่ชนะเลขในบรรทัด BOM
    const stepChoices = (selected, line) => `<option value="">${line.step ? `ตาม BOM: ขั้นที่ ${esc(String(line.step))}` : "ขั้นแรก"}</option>${steps.map((step) => `<option value="${attr(step.processCode)}"${step.processCode === selected ? " selected" : ""}>${esc(step.processCode)}</option>`).join("")}`;
    const inputRows = lines.map((line) => `<tr><td>${ui.mono(line.childCode)}<input type="hidden" name="inputCode[]" value="${attr(line.childCode)}"><div class="small muted">${esc(itemOf(ctx, line.childCode)?.name ?? "")}</div></td><td class="nowrap">${esc(rules.fmtQty(line.qty))} ${esc(uomText(ctx, line.uom))}</td><td><select class="select rf-select" name="inputStep[]" data-input-step aria-label="${attr(`ขั้นที่ ${line.childCode} เข้า`)}">${stepChoices(stepOfInput(line.childCode), line)}</select></td></tr>`);
    const body = `<form id="bom-routing-form" data-rf-form="saveRouting" data-rf-args="${attr(JSON.stringify({ itemCode: item.code }))}" data-rf-success="บันทึกขั้นตอนผลิต {result}">
      <p class="small muted">${esc(item.name)} · ${esc(rules.DEPT_LABEL[item.ownerDept] ?? item.ownerDept)}${routing ? ` · ใช้อยู่ Rev.${routing.revision} โดย ${esc(routing.createdBy)}` : ""}</p>
      ${ui.table(["ขั้นตอน (เรียงจากขั้นแรก)", "นาที/ชิ้น", ""], (steps.length ? steps : [{}]).map(stepRow), { className: "bom-routing-table" })}
      <template data-step-template>${stepRow()}</template>
      <div class="rf-row"><button class="btn rf-btn secondary small" type="button" data-step-add>+ เพิ่มขั้นตอน</button></div>
      ${inputRows.length ? `<h4 class="bom-dialog-sub">วัตถุดิบเข้าที่ขั้นไหน</h4>${ui.table(["ส่วนประกอบใน BOM", "ต่อหน่วย", "เข้าที่ขั้น"], inputRows)}` : ""}
      <p class="small muted">บันทึกแล้วเป็น revision ใหม่ ตัวเดิมเก็บเป็นประวัติ · แถวที่ไม่เลือกขั้นตอนจะถูกข้าม</p>
    </form>`;
    const bind = (dialog) => {
      const tbody = dialog.querySelector(".bom-routing-table tbody");
      const template = dialog.querySelector("[data-step-template]");
      // ตัวเลือก "เข้าที่ขั้น" ตามขั้นตอนที่อยู่ในตารางตอนนี้ (ขั้นที่ถูกลบ/ยังไม่เลือก กลับเป็น ขั้นแรก)
      const refresh = () => {
        const codes = [...tbody.querySelectorAll('select[name="processCode[]"]')].map((select) => select.value).filter(Boolean);
        dialog.querySelectorAll("[data-input-step]").forEach((select) => {
          const keep = codes.includes(select.value) ? select.value : "";
          select.innerHTML = `<option value="">ขั้นแรก</option>${codes.map((value) => `<option value="${attr(value)}">${esc(value)}</option>`).join("")}`;
          select.value = keep;
        });
      };
      dialog.querySelector("[data-step-add]")?.addEventListener("click", () => { tbody.insertAdjacentHTML("beforeend", template.innerHTML); refresh(); });
      tbody.addEventListener("change", refresh);
      tbody.addEventListener("click", (event) => {
        const row = event.target.closest("button[data-step-remove]")?.closest("tr[data-step]");
        if (!row) return;
        row.remove();
        refresh();
      });
      sortableRows(tbody, { rows: () => [...tbody.querySelectorAll("tr[data-step]")], onChange: refresh });
    };
    return { html: ui.dialog("routingEdit", `ขั้นตอนผลิต ${item.code}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-routing-form">บันทึก</button>` }), bind };
  };
  // dialog: ราคาต้นทุนต่อหน่วยของชิ้นที่ไม่มี BOM
  dialogs.itemCost = (ctx, { code = "" }) => {
    const { ui } = ctx;
    const item = itemOf(ctx, code);
    if (!item) return null;
    const body = `<form id="bom-cost-form" data-rf-form="setItemCost" data-rf-args="${attr(JSON.stringify({ code: item.code }))}" data-rf-success="ตั้งราคา {result}">
      <p class="small muted">${esc(item.name)}</p>
      ${ui.field(`ราคาต้นทุน (บาท ต่อ ${uomText(ctx, item.uom)})`, ui.input("unitCost", { type: "number", step: "any", min: "0", value: item.unitCost ?? "", placeholder: "เว้นว่าง = ไม่ระบุ" }))}
      <p class="small muted">ใช้กับของซื้อ เส้นยาง หรือชิ้นที่ยังไม่มี BOM · ชิ้นที่มี BOM คำนวณจากส่วนประกอบและขั้นตอนผลิต</p>
    </form>`;
    return { html: ui.dialog("itemCost", `ราคาต้นทุน ${item.code}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-cost-form">บันทึก</button>` }) };
  };
  // dialog: รูปชิ้นงาน — เบราว์เซอร์ย่อรูปเหลือด้านยาวไม่เกิน 240 px (JPEG) ก่อนเก็บ
  dialogs.itemImage = (ctx, { code = "" }) => {
    const { ui } = ctx;
    const item = itemOf(ctx, code);
    if (!item) return null;
    const body = `<form id="bom-image-form" data-rf-form="setItemImage" data-rf-args="${attr(JSON.stringify({ code: item.code }))}" data-rf-success="บันทึกรูป {result}">
      <p class="small muted">${esc(item.name)}</p>
      <div class="bom-image-edit">${picture({ itemCode: item.code, kind: item.kind, image: item.image ?? null }, " is-large")}
        ${ui.field("เลือกรูป", '<input class="input rf-input" type="file" accept="image/png,image/jpeg,image/webp" data-image-file>')}</div>
      <input type="hidden" name="image" value="${attr(item.image ?? "")}">
      <p class="small muted" data-image-note>รูปถูกย่อในเบราว์เซอร์ก่อนบันทึก (ตัวจำลองเก็บในเบราว์เซอร์นี้ ระบบจริงเก็บใน Storage แบบ private)</p>
    </form>`;
    const bind = (dialog) => {
      const file = dialog.querySelector("[data-image-file]");
      const hidden = dialog.querySelector('input[name="image"]');
      file?.addEventListener("change", () => {
        const chosen = file.files?.[0];
        if (!chosen || typeof FileReader === "undefined") return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(1, 240 / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            hidden.value = canvas.toDataURL("image/jpeg", 0.8);
            const preview = dialog.querySelector(".bom-pic");
            preview?.insertAdjacentHTML("afterend", `<img class="bom-pic is-large" src="${attr(hidden.value)}" alt="${attr(item.code)}">`);
            preview?.remove();
          };
          img.src = String(reader.result);
        };
        reader.readAsDataURL(chosen);
      });
    };
    const remove = item.image ? ui.button("ลบรูป", { action: "setItemImage", args: { code: item.code, image: "" }, confirmText: `ลบรูปของ ${item.code}?` }) : "";
    return { html: ui.dialog("itemImage", `รูปชิ้นงาน ${item.code}`, body, { footer: `${remove}${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-image-form">บันทึก</button>` }), bind };
  };

  // ---------- ชุดสี / แพ็กเกจ (นิยามต่อฐานรหัส ใช้ตอนสร้างรุ่นสินค้าใหม่ แทนการแก้สีมือในชีต Edit DATA) ----------
  // สีที่เลือกได้ = สีที่ลงทะเบียน ∪ สีที่พบในชิ้น SE/RB ∪ แม่สีมาตรฐานเฉด 01
  const colorOptionsOf = (ctx) => {
    const { data, rules } = ctx;
    const codes = new Set([...(data.colors ?? []).map((color) => color.code), ...data.items.map((item) => String(item.rubber?.color ?? "").toUpperCase()).filter((code) => rules.parseColorCode(code)), ...Object.keys(rules.COLOR_MASTERS).filter((master) => master !== "XX").map((master) => `${master}01`)]);
    return [...codes].sort().map((code) => ({ value: code, label: `${code} · ${rules.colorName(code, data.colors ?? [])}` }));
  };
  const swatch = (ctx, code) => (code ? `<span class="bom-swatch rf-mono" data-color="${attr(String(code).slice(0, 2))}" title="${attr(ctx.rules.colorName(code, ctx.data.colors ?? []))}">${esc(code)}</span>` : '<span class="muted">—</span>');
  // ข้อมูลของฐานรหัสหนึ่ง: สินค้าที่มี (พร้อมช่องสีที่เรียนรู้) ชุดสีที่นิยาม แพ็กเกจที่นิยาม และกุญแจช่องสีทั้งหมดเรียงตามต้นแบบ
  function baseFacts(ctx, base) {
    const { data, rules } = ctx;
    const siblings = ctx.helpers.siblingsOf(data, base).map((item) => ({ item, ...rules.parseFgCode(item.code), slots: rules.colorSlotsOf(item.code, { itemOf: (c) => itemOf(ctx, c), approvedBomOf: (c) => approvedBomOf(ctx, c) }) })).sort((a, b) => a.item.code.localeCompare(b.item.code));
    const definedSets = (data.colorSets ?? []).filter((entry) => entry.base === base).sort((a, b) => a.code.localeCompare(b.code));
    const packages = (data.packages ?? []).filter((entry) => entry.base === base).sort((a, b) => a.code.localeCompare(b.code));
    const slotKeys = [];
    for (const key of [...definedSets.flatMap((set) => set.slots.map((slot) => slot.key)), ...siblings.flatMap((entry) => entry.slots.map((slot) => slot.key))]) if (!slotKeys.includes(key)) slotKeys.push(key);
    // ชื่อตัวอย่างของแต่ละช่อง (ชิ้นแรกที่พบในสินค้าที่มี)
    const slotNames = Object.fromEntries(slotKeys.map((key) => [key, siblings.flatMap((entry) => entry.slots).find((slot) => slot.key === key)?.itemCode ?? ""]));
    const setCodes = [...new Set([...definedSets.map((set) => set.code), ...siblings.map((entry) => entry.colorSet).filter(Boolean)])].sort();
    const pkgCodes = [...new Set([...packages.map((entry) => entry.code), ...siblings.map((entry) => entry.pkg)])].sort();
    return { siblings, definedSets, packages, slotKeys, slotNames, setCodes, pkgCodes };
  }
  // สีของช่อง (ตามลำดับที่พบ) จากรายการช่อง: ช่องซ้ำกุญแจเดียวกันใช้ตัวที่ n
  const slotColors = (slots, key) => slots.filter((slot) => slot.key === key).map((slot) => slot.color);
  pages.variants = (ctx) => {
    const { data, ui, rules, user, params } = ctx;
    const canEdit = ctx.helpers.canPlan(user);
    const fgs = data.items.filter((item) => item.kind === "FG" && approvedBomOf(ctx, item.code)).map((item) => ({ item, ...rules.parseFgCode(item.code) }));
    const bases = [...new Set(fgs.map((entry) => entry.base))].sort();
    const base = params.get("base") ? rules.canonicalCode(params.get("base")) : "";
    const picker = ui.card(`<form class="bom-pick" data-bom-pick><div class="rf-grid rf-g2">
        ${ui.field("ฐานรหัสสินค้า", ui.input("base", { value: base, list: "bom-variant-base-list", placeholder: "เช่น MEGA-ST-01", extra: 'autocapitalize="characters"' }))}
        <div class="field rf-field"><label>&nbsp;</label><button class="btn rf-btn" type="submit">เปิด</button></div></div>
        <datalist id="bom-variant-base-list">${bases.map((value) => `<option value="${attr(value)}">${esc(fgs.find((entry) => entry.base === value).item.name.slice(0, 50))}</option>`).join("")}</datalist></form>`, { title: "ฐานรหัสสินค้า" });
    const bindPick = (rootNode) => {
      rootNode.querySelector("[data-bom-pick]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        location.hash = ctx.url("variants", { base: String(new FormData(event.currentTarget).get("base") ?? "").trim() });
      });
    };
    const pageHead = head(ctx, "ชุดสี / แพ็กเกจ", "นิยามต่อฐานรหัส ใช้เมื่อสร้างรุ่นสินค้าใหม่", canEdit ? ui.openButton("เพิ่ม/แก้สี", "colorEdit", {}, { className: "secondary" }) : "");
    if (!base) {
      const rows = bases.map((value) => {
        const facts = baseFacts(ctx, value);
        return `<tr><td>${ui.link(value, ctx.url("variants", { base: value }), "rf-mono")}<div class="small muted">${esc(fgs.find((entry) => entry.base === value).item.name)}</div></td><td class="right">${esc(String(facts.siblings.length))}</td><td>${facts.definedSets.length ? facts.definedSets.map((set) => swatchSet(ctx, set)).join(" ") : '<span class="muted">—</span>'}</td><td>${facts.packages.length ? facts.packages.map((entry) => ui.mono(entry.code)).join(" ") : '<span class="muted">—</span>'}</td></tr>`;
      });
      const colorRows = colorOptionsOf(ctx).map((option) => `<tr><td>${swatch(ctx, option.value)}</td><td>${esc(rules.colorName(option.value, data.colors ?? []))}${(data.colors ?? []).some((color) => color.code === option.value) ? "" : ' <span class="small muted">(ยังไม่ลงทะเบียน)</span>'}</td><td class="right">${esc(String(data.items.filter((item) => String(item.rubber?.color ?? "").toUpperCase() === option.value).length))}</td></tr>`);
      const html = `${pageHead}${picker}
        ${ui.card(ui.table(["ฐานรหัส", { label: "รุ่นที่มี", className: "right" }, "ชุดสีที่นิยาม", "แพ็กเกจที่นิยาม"], rows, { emptyText: "ยังไม่มีสินค้าที่มี BOM" }), { title: "ฐานรหัสที่มี BOM", flush: true })}
        ${ui.card(ui.table(["สี", "ชื่อ", { label: "ใช้ใน SE/RB", className: "right" }], colorRows), { title: "สี (แม่สี + เฉด)", flush: true })}`;
      return { html, bind: bindPick };
    }
    const facts = baseFacts(ctx, base);
    if (!facts.siblings.length) {
      return { html: `${pageHead}${picker}${ui.callout("warn", `ไม่มีฐานรหัส <strong>${esc(base)}</strong> ที่มี BOM${canEdit ? ` · ${ui.link("สร้าง BOM", ctx.url("build", { base }))}` : ""}`)}`, bind: bindPick };
    }
    // การ์ดชุดสี: แถว = ช่องสี คอลัมน์ = ชุดสี (นิยามแล้ว หรือเรียนรู้จากสินค้าที่มี)
    const setColumns = facts.setCodes.map((code) => {
      const defined = facts.definedSets.find((set) => set.code === code) ?? null;
      const sample = facts.siblings.find((entry) => entry.colorSet === code) ?? null;
      return { code, defined, sample, slots: defined ? defined.slots : sample?.slots ?? [] };
    });
    const setHead = ["ช่องสี (รหัสถอดสี)", ...setColumns.map((column) => ({ label: `ชุด ${column.code}${column.defined ? "" : " (จากสินค้า)"}`, className: "center" }))];
    const setRows = facts.slotKeys.map((key) => {
      const maxDup = Math.max(1, ...setColumns.map((column) => slotColors(column.slots, key).length));
      return Array.from({ length: maxDup }, (_, dupIndex) => `<tr><td>${ui.mono(key)}${dupIndex === 0 && facts.slotNames[key] ? `<div class="small muted">${esc(itemOf(ctx, facts.slotNames[key])?.name ?? "")}</div>` : ""}${maxDup > 1 ? `<div class="small muted">ช่องที่ ${dupIndex + 1}</div>` : ""}</td>${setColumns.map((column) => `<td class="center">${swatch(ctx, slotColors(column.slots, key)[dupIndex] ?? "")}</td>`).join("")}</tr>`).join("");
    });
    const setActions = setColumns.map((column) => {
      if (!canEdit) return "";
      if (column.defined) return `<span class="bom-set-actions">${ui.openButton(`แก้ชุด ${column.code}`, "colorSetEdit", { base, code: column.code }, { className: "secondary small" })}${ui.button("ลบ", { action: "removeColorSet", args: { base, code: column.code }, className: "secondary small", confirmText: `ลบนิยามชุดสี ${column.code} ของ ${base}?`, ariaLabel: `ลบชุดสี ${column.code}` })}</span>`;
      return `<span class="bom-set-actions">${ui.button(`บันทึกชุด ${column.code} จากสินค้า`, { action: "learnColorSet", args: { fgCode: column.sample.item.code }, className: "secondary small", confirmText: "" })}</span>`;
    }).filter(Boolean).join(" ");
    const setCard = ui.card(`${ui.table(setHead, setRows, { emptyText: "สินค้านี้ไม่มีชิ้น SE/RB ที่ระบุสีในชั้นแรก" })}${setActions ? `<div class="rf-row bom-set-row">${setActions}</div>` : ""}`,
      { title: "ชุดสี", flush: true, actions: canEdit && facts.slotKeys.length ? ui.openButton("+ ชุดสีใหม่", "colorSetEdit", { base }, { className: "" }) : "" });
    // การ์ดแพ็กเกจ
    const pkgRows = facts.packages.map((entry) => `<tr><td>${ui.mono(entry.code)}<div class="small muted">${esc(entry.name || "")}</div></td><td>${entry.lines.map((line) => `<div>${ui.link(line.childCode, ctx.url("items", { sel: line.childCode }), "rf-mono")} <span class="small muted">× ${esc(rules.fmtQty(line.qty))} ${esc(uomText(ctx, itemOf(ctx, line.childCode)?.uom))}</span></div>`).join("")}</td><td class="nowrap">${canEdit ? `${ui.openButton("แก้", "packageEdit", { base, code: entry.code }, { className: "secondary small" })} ${ui.button("ลบ", { action: "removePackage", args: { base, code: entry.code }, className: "secondary small", confirmText: `ลบนิยามแพ็กเกจ ${entry.code} ของ ${base}?` })}` : ""}</td></tr>`);
    const undefinedPkgs = facts.pkgCodes.filter((code) => code && !facts.packages.some((entry) => entry.code === code));
    const pkgCard = ui.card(`${ui.table(["แพ็กเกจ", "บรรจุภัณฑ์ต่อ 1 FG", ""], pkgRows, { emptyText: "ยังไม่มีนิยามแพ็กเกจ: รุ่นใหม่จะใช้บรรจุภัณฑ์ของต้นแบบ" })}${undefinedPkgs.length && canEdit ? `<div class="rf-row bom-set-row"><span class="small muted">มีสินค้าแพ็กเกจ ${esc(undefinedPkgs.join(", "))} แต่ยังไม่นิยาม:</span> ${undefinedPkgs.map((code) => ui.openButton(`นิยาม ${code} จากสินค้า`, "packageEdit", { base, code, fromFg: facts.siblings.find((entry) => entry.pkg === code)?.item.code ?? "" }, { className: "secondary small" })).join(" ")}</div>` : ""}`,
      { title: "แพ็กเกจ", flush: true, actions: canEdit ? ui.openButton("+ แพ็กเกจใหม่", "packageEdit", { base, fromFg: facts.siblings[0]?.item.code ?? "" }, { className: "" }) : "" });
    // การ์ดรุ่นสินค้า: แพ็กเกจ × ชุดสี
    const matrixHead = ["แพ็กเกจ \\ ชุดสี", ...facts.setCodes.map((code) => ({ label: code, className: "center" }))];
    const matrixRows = facts.pkgCodes.map((pkg) => `<tr><td>${pkg ? ui.mono(pkg) : '<span class="muted">ไม่ระบุ</span>'}${facts.packages.some((entry) => entry.code === pkg) ? "" : pkg ? ' <span class="small muted">(ไม่มีนิยาม)</span>' : ""}</td>${facts.setCodes.map((set) => {
      const code = rules.buildFgCode(base, pkg, set);
      const existing = itemOf(ctx, code);
      if (existing) return `<td class="center">${ui.link(code, ctx.url("product", { code }), "rf-mono")}</td>`;
      return `<td class="center">${canEdit ? ui.button("สร้าง", { action: "createVariant", args: { base, pkg, colorSet: set }, className: "secondary small", confirmText: `สร้าง ${code} จากต้นแบบของฐานนี้ โดยใช้นิยามชุดสี ${set}${pkg ? ` และแพ็กเกจ ${pkg}` : ""}?` }) : '<span class="muted">—</span>'}</td>`;
    }).join("")}</tr>`);
    const matrixCard = ui.card(ui.table(matrixHead, matrixRows, { className: "bom-matrix" }), { title: "รุ่นสินค้า (แพ็กเกจ × ชุดสี)", flush: true });
    const html = `${pageHead}${picker}<div class="bom-dept-grid">${setCard}${pkgCard}${matrixCard}</div>`;
    return { html, bind: bindPick };
  };
  const swatchSet = (ctx, set) => `<span class="bom-setchip" title="${attr(set.slots.map((slot) => `${slot.key}=${slot.color}`).join(" · "))}">${esc(set.code)}: ${set.slots.map((slot) => esc(slot.color)).join(" ")}</span>`;
  // dialog: นิยาม/แก้ชุดสี — select สีต่อช่อง (ค่าเริ่มต้น: นิยามเดิม หรือสีของสินค้าต้นแบบตัวแรก)
  dialogs.colorSetEdit = (ctx, { base = "", code = "" }) => {
    const { ui } = ctx;
    const key = ctx.rules.canonicalCode(base);
    const facts = baseFacts(ctx, key);
    if (!facts.slotKeys.length) return null;
    const defined = code ? facts.definedSets.find((set) => set.code === code) : null;
    const template = defined?.slots ?? facts.siblings[0]?.slots ?? [];
    const options = colorOptionsOf(ctx);
    const rows = facts.slotKeys.flatMap((slotKey) => {
      const count = Math.max(1, slotColors(template, slotKey).length);
      return Array.from({ length: count }, (_, index) => `<tr><td>${ui.mono(slotKey)}${count > 1 ? `<div class="small muted">ช่องที่ ${index + 1}</div>` : ""}<div class="small muted">${esc(itemOf(ctx, facts.slotNames[slotKey])?.name ?? "")}</div><input type="hidden" name="slotKey[]" value="${attr(slotKey)}"></td><td>${ui.select("slotColor[]", options, { value: slotColors(template, slotKey)[index] ?? "", placeholder: "ใช้สีของต้นแบบ" })}</td></tr>`);
    });
    const body = `<form id="bom-colorset-form" data-rf-form="saveColorSet" data-rf-args="${attr(JSON.stringify({ base: key }))}" data-rf-success="บันทึกชุดสี {result}">
      <div class="rf-grid rf-g2">
        ${ui.field("รหัสชุดสี *", defined ? `<input class="input rf-input" name="code" value="${attr(defined.code)}" readonly>` : ui.input("code", { required: true, placeholder: "เช่น A", list: "bom-colorset-codes", extra: 'autocapitalize="characters" maxlength="1" pattern="[A-Za-z]" title="ตัวอักษร A–Z ตัวเดียว ตามท้ายรหัสสินค้า"' }))}
        ${ui.field("ชื่อ/คำอธิบาย", ui.input("name", { value: defined?.name ?? "", placeholder: "เช่น แดง-ดำ" }))}
      </div>
      <datalist id="bom-colorset-codes">${ctx.rules.COLOR_SETS.filter((value) => !facts.definedSets.some((set) => set.code === value)).map((value) => `<option value="${attr(value)}"></option>`).join("")}</datalist>
      ${ui.table(["ช่องสี", "สี"], rows)}
      <p class="small muted">ช่องที่ไม่เลือกสีจะใช้สีของสินค้าต้นแบบ · RB ใต้ SE ที่เปลี่ยนสีจะเปลี่ยนสีตาม SE</p>
    </form>`;
    return { html: ui.dialog("colorSetEdit", defined ? `แก้ชุดสี ${defined.code} ของ ${key}` : `ชุดสีใหม่ของ ${key}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-colorset-form">บันทึก</button>` }) };
  };
  // dialog: นิยาม/แก้แพ็กเกจ — 8 แถว (รหัสชิ้น + ปริมาณต่อ 1 FG) ค่าเริ่มต้นจากนิยามเดิม หรือบรรทัดของซื้อชั้นแรกของสินค้าต้นแบบ
  dialogs.packageEdit = (ctx, { base = "", code = "", fromFg = "" }) => {
    const { ui, data, rules } = ctx;
    const key = rules.canonicalCode(base);
    const defined = code ? ctx.helpers.packageOf(data, key, String(code).toUpperCase()) : null;
    const source = !defined && fromFg ? approvedBomOf(ctx, rules.canonicalCode(fromFg)) : null;
    const prefill = defined?.lines ?? (source ? source.lines.filter((line) => itemOf(ctx, line.childCode)?.kind === "PURCHASED").map((line) => ({ childCode: line.childCode, qty: line.qty })) : []);
    const ROWS = Math.max(8, prefill.length + 2);
    const rows = Array.from({ length: ROWS }, (_, index) => `<tr><td>${ui.input("childCode[]", { value: prefill[index]?.childCode ?? "", list: "bom-pkg-items", placeholder: index === 0 ? "รหัสบรรจุภัณฑ์" : "", className: "rf-mono", extra: 'autocapitalize="characters"' })}</td><td>${ui.input("qty[]", { type: "number", step: "any", min: 0, value: prefill[index]?.qty ?? "" })}</td></tr>`);
    const body = `<form id="bom-package-form" data-rf-form="savePackage" data-rf-args="${attr(JSON.stringify({ base: key }))}" data-rf-success="บันทึกแพ็กเกจ {result}">
      <div class="rf-grid rf-g2">
        ${ui.field("รหัสแพ็กเกจ *", defined ? `<input class="input rf-input" name="code" value="${attr(defined.code)}" readonly>` : ui.input("code", { value: String(code ?? "").toUpperCase(), required: true, placeholder: "เช่น P", list: "bom-package-codes", extra: 'autocapitalize="characters" maxlength="4"' }))}
        ${ui.field("ชื่อ/คำอธิบาย", ui.input("name", { value: defined?.name ?? "", placeholder: "เช่น ถุง + ลังรวม 40 ชุด" }))}
      </div>
      <datalist id="bom-package-codes">${rules.PACKAGES.map((value) => `<option value="${attr(value)}"></option>`).join("")}</datalist>
      <datalist id="bom-pkg-items">${data.items.filter((item) => item.kind === "PURCHASED").map((item) => `<option value="${attr(item.code)}">${esc(item.name.slice(0, 50))}</option>`).join("")}</datalist>
      ${ui.table(["บรรจุภัณฑ์ (ชิ้น)", "ปริมาณต่อ 1 FG"], rows)}
      <p class="small muted">${source ? `ตั้งต้นจากของซื้อชั้นแรกของ ${esc(source.itemCode)} ลบแถวที่ไม่ใช่บรรจุภัณฑ์ (เช่น สติ๊กเกอร์) ออก · ` : ""}ตอนสร้างรุ่นใหม่ ระบบถอดบรรทัดที่อยู่ในแพ็กเกจใดก็ตามของฐานนี้ออกจากต้นแบบ แล้วใส่บรรทัดของแพ็กเกจที่เลือกแทน</p>
    </form>`;
    return { html: ui.dialog("packageEdit", defined ? `แก้แพ็กเกจ ${defined.code} ของ ${key}` : `แพ็กเกจใหม่ของ ${key}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-package-form">บันทึก</button>` }) };
  };
  dialogs.colorEdit = (ctx, { code = "" }) => {
    const { ui, data, rules } = ctx;
    const color = (data.colors ?? []).find((entry) => entry.code === String(code).toUpperCase()) ?? null;
    const body = `<form id="bom-color-form" data-rf-form="saveColor" data-rf-success="บันทึกสี {result}">
      <div class="rf-grid rf-g2">
        ${ui.field("รหัสสี (แม่สี + เฉด) *", ui.input("code", { value: color?.code ?? String(code).toUpperCase(), required: true, placeholder: "เช่น OR01", list: "bom-color-codes", extra: 'autocapitalize="characters" maxlength="4"' }))}
        ${ui.field("ชื่อ", ui.input("name", { value: color?.name ?? "", placeholder: "เช่น ส้ม" }))}
      </div>
      <datalist id="bom-color-codes">${colorOptionsOf(ctx).map((option) => `<option value="${attr(option.value)}">${esc(option.label)}</option>`).join("")}</datalist>
      <p class="small muted">แม่สีที่รู้จัก: ${esc(Object.entries(rules.COLOR_MASTERS).filter(([master]) => master !== "XX").map(([master, name]) => `${master} ${name}`).join(" · "))}</p>
    </form>`;
    return { html: ui.dialog("colorEdit", color ? `แก้สี ${color.code}` : "เพิ่ม/แก้สี", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-color-form">บันทึก</button>` }) };
  };

  // dialog: เพิ่ม/แก้ชิ้นงานเดี่ยว (ชิ้นที่ไม่อยู่ในต้นไม้ไหน เช่น ของซื้อที่เตรียมไว้ก่อน)
  dialogs.itemEdit = (ctx, { code = "" }) => {
    const { ui, rules, data } = ctx;
    const item = code ? itemOf(ctx, code) : null;
    const kind = item?.kind ?? "PURCHASED";
    const rubber = item?.rubber ?? {};
    const deptOptions = rules.DEPTS.map((value) => ({ value, label: rules.DEPT_LABEL[value] }));
    const body = `<form id="bom-item-form" data-rf-form="saveItem" data-rf-success="บันทึกชิ้นงาน {result}"${item ? "" : ' data-rf-args=\'{"create":true}\''}>
      <div class="rf-grid rf-g2">
        ${ui.field("รหัสชิ้นงาน *", item ? `<input class="input rf-input" name="code" value="${attr(item.code)}" readonly>` : ui.input("code", { required: true, placeholder: "เช่น B25-1520" }))}
        ${ui.field("ชนิด *", ui.select("kind", KIND_OPTIONS(ctx), { value: kind }))}
      </div>
      ${ui.field("ชื่อชิ้นงาน *", ui.input("name", { value: item?.name ?? "", required: true }))}
      <div class="rf-grid rf-g3">
        ${ui.field("แผนกเจ้าของ (ใช้แยกงาน)", ui.select("ownerDept", deptOptions, { value: item?.ownerDept ?? "ST" }))}
        ${ui.field("หน่วยนับ *", ui.select("uom", UOM_OPTIONS(ctx), { value: item?.uom ?? "pcs" }))}
        ${ui.field("น้ำหนัก (กรัม/หน่วย)", ui.input("weightG", { type: "number", step: "any", min: 0, value: item?.weightG ?? "" }))}
      </div>
      <fieldset class="bom-fieldset"><legend>ข้อมูลยาง (เฉพาะ RB / SE)</legend>
        <div class="rf-grid rf-g3">
          ${ui.field("รหัสสูตรยาง (RB)", ui.input("rubber.compound", { value: rubber.compound ?? "", list: "bom-compound-list-dialog" }))}<datalist id="bom-compound-list-dialog">${data.compounds.map((entry) => `<option value="${attr(entry.code)}"></option>`).join("")}</datalist>
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
    return { html: ui.dialog("itemEdit", item ? `แก้ข้อมูล ${item.code}` : "เพิ่มชิ้นงานเดี่ยว", body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-item-form">บันทึก</button>` }) };
  };

  // ---------- สูตรยาง ↔ RubberFlow ----------
  const rfRecipes = (ctx) => {
    try { return ctx.rubberflow()?.store.data().recipes ?? []; } catch { return []; }
  };
  pages.compounds = (ctx) => {
    const { data, ui, user } = ctx;
    const recipes = rfRecipes(ctx);
    const canLink = ctx.helpers.canPlan(user) || user.role === "rb";
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
    const html = `${head(ctx, "นำเข้า BOM จาก Excel", "เลือกไฟล์ Material_*.xlsm หรือ DATA BOM.xlsx (ระบบเปิดชีต BOMSHEET หรือ DATA ให้) หรือคัดลอกแถวหัวตารางพร้อมบรรทัดของสินค้าที่ต้องการมาวาง ระบบประกอบเป็น BOM หลายชั้นและรายงานปัญหาก่อนบันทึก")}
      ${canImport ? "" : ui.callout("warn", "บทบาทนี้ดูได้อย่างเดียว การนำเข้าทำโดยฝ่ายวางแผนหรือผู้จัดการ")}
      ${ui.card(`<div class="rf-grid rf-g2">
          ${ui.field("วางข้อมูลจาก Excel (TSV) หรือ CSV", `<textarea class="textarea rf-textarea bom-paste" name="paste" rows="10" placeholder="ITEM\tน.น RB/g\tCODE\tรหัสแผนก\t… (วางทั้งแถวหัวตารางมาด้วย)" data-bom-paste></textarea>`)}
          <div>
            ${ui.field("หรือเลือกไฟล์ .xlsx / .xlsm / .tsv / .csv", `<input class="input rf-input" type="file" accept=".xlsx,.xlsm,.tsv,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12,text/plain,text/csv,text/tab-separated-values" data-bom-file>`, { hint: "อ่านค่าที่ Excel บันทึกไว้ในไฟล์ ไม่รันมาโคร · ไฟล์ .xls แบบเก่าให้บันทึกเป็น .xlsx ก่อน" })}
            <div data-bom-sheet-field hidden>${ui.field("ชีต", ui.select("sheet", [], { extra: 'data-bom-sheet title="ชีตที่อ่านเข้าช่องวางข้อมูล"' }))}</div>
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
      const sheetField = rootNode.querySelector("[data-bom-sheet-field]");
      const sheetSelect = rootNode.querySelector("[data-bom-sheet]");
      const sourceInput = rootNode.querySelector("[data-bom-source]");
      let built = null;
      let workbook = null;
      // ทุกการเลือกไฟล์/ชีตได้ลำดับใหม่ ผลที่เสร็จทีหลังแต่เป็นของการเลือกเก่าถูกทิ้ง (ชีต DATA อ่านช้ากว่า BOMSHEET จึงอาจเสร็จทีหลัง)
      let seq = 0;
      // หมายเหตุของชีตที่อ่านล่าสุด แสดงในรายงานของปุ่มตรวจสอบ (เขียน report ครั้งเดียว ปุ่มนำเข้าจึงยังผูก handler อยู่) ล้างเมื่อเลือกไฟล์ใหม่หรือแก้ช่องวาง
      let sheetNote = "";
      paste?.addEventListener("input", () => { sheetNote = ""; });
      const showError = (error) => { if (report) report.innerHTML = ui.callout("bad", esc(error?.message ?? String(error))); };
      // ไฟล์ .xlsx/.xlsm: เปิดสมุดงาน (modules/bom-xlsx.js) อ่านชีตที่เลือกลงช่องวาง แล้วตรวจสอบเหมือนการวาง
      const loadSheet = async (book, name, mine) => {
        if (!paste) return;
        if (report) report.innerHTML = ui.callout("info", `กำลังอ่านชีต ${esc(name)}…`);
        try {
          const rows = await book.rows(name);
          if (mine !== seq) return;
          paste.value = root.MNP_BOM_XLSX.rowsToTsv(rows);
          sheetNote = rows.skippedCells ? `ข้ามค่า ${rows.skippedCells} ช่องที่อยู่เกินคอลัมน์ที่ ${root.MNP_BOM_XLSX.MAX_COLUMNS}` : "";
          rootNode.querySelector("[data-bom-check]")?.click(); // ตรวจสอบทันที รายงานบอกจำนวนสินค้า/ปัญหาของชีตนี้
        } catch (error) {
          if (mine !== seq) return;
          paste.value = "";
          sheetNote = "";
          showError(error);
        }
      };
      file?.addEventListener("change", async () => {
        const mine = ++seq;
        const picked = file.files?.[0];
        built = null;
        workbook = null;
        sheetNote = "";
        if (sheetField) sheetField.hidden = true;
        if (report) report.innerHTML = "";
        if (!picked) return;
        if (sourceInput) sourceInput.value = picked.name.slice(0, 80);
        if (paste) paste.value = "";
        if (!root.MNP_BOM_XLSX?.isWorkbookName(picked.name)) {
          if (typeof FileReader === "undefined") return;
          const reader = new FileReader();
          reader.onload = () => { if (paste && mine === seq) paste.value = String(reader.result ?? ""); };
          reader.onerror = () => { if (mine === seq) showError(new Error(`อ่านไฟล์ ${picked.name} ไม่ได้`)); };
          reader.readAsText(picked);
          return;
        }
        if (report) report.innerHTML = ui.callout("info", `กำลังเปิด ${esc(picked.name)}…`);
        try {
          const book = await root.MNP_BOM_XLSX.openWorkbook(await picked.arrayBuffer());
          if (mine !== seq) return;
          if (!book.sheets.length) throw new Error("ไม่พบชีตในไฟล์นี้");
          workbook = book;
          if (sheetSelect) sheetSelect.innerHTML = book.sheets.map((sheet) => `<option value="${attr(sheet.name)}"${sheet.name === book.defaultSheet ? " selected" : ""}>${esc(sheet.name)}${sheet.hidden ? " (ซ่อน)" : ""}</option>`).join("");
          if (sheetField) sheetField.hidden = false;
          await loadSheet(book, book.defaultSheet, mine);
        } catch (error) {
          if (mine === seq) showError(error);
        }
      });
      sheetSelect?.addEventListener("change", () => {
        if (!workbook) return undefined;
        built = null;
        return loadSheet(workbook, sheetSelect.value, ++seq);
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
          report.innerHTML = `${ui.callout(r.conflicts.length ? "warn" : "good", `<strong>อ่านได้ ${esc(rules.fmtQty(flat.length))} บรรทัด</strong> · สินค้า ${esc(String(r.fgCount))} · ชิ้นงาน ${esc(String(r.itemCount))} (มีอยู่แล้ว ${esc(String(existing))}) · BOM ${esc(String(r.bomCount))} พ่อ · รวมบรรทัดซ้ำ ${esc(String(r.merged))} · ชิ้นไม่มีรหัส → XP- ${esc(String(r.subparts))} · รหัสสะกดต่าง ${esc(String(r.variants))}${r.colored ? ` · ได้สีจากคอลัมน์ แม่สี/เฉดที่ ${esc(String(r.colored))} บรรทัด` : ""}`)}
            ${sheetNote ? ui.callout("warn", esc(sheetNote)) : ""}
            ${tooBig ? ui.callout("bad", `ข้อมูลชุดนี้ (${esc(rules.fmtQty(Math.round(payloadSize / 1000)))} KB) จะเกินเพดานของ localStorage นำเข้าเฉพาะสินค้าที่ต้องใช้ทดสอบ (วางทีละกลุ่ม) หรือรีเซ็ตข้อมูลก่อน`) : ""}
            ${unlinked.length ? ui.callout("warn", `สูตรยางที่ยังไม่ผูกกับ RubberFlow: ${esc(unlinked.join(", "))} (ผูกได้ภายหลังที่เมนูสูตรยาง)`) : ""}
            ${r.unknownUom.length ? ui.callout("warn", `หน่วยที่แปลงไม่ได้ (บันทึกเป็น “หน่วยอื่น”): ${esc(r.unknownUom.slice(0, 20).join(", "))}${r.unknownUom.length > 20 ? " …" : ""}`) : ""}
            ${r.conflicts.length ? `<details class="bom-details"><summary>ข้อขัดแย้ง ${esc(String(r.conflicts.length))} รายการ (ใช้ค่าชุดแรก)</summary><ul class="small">${r.conflicts.slice(0, 50).map((text) => `<li>${esc(text)}</li>`).join("")}</ul></details>` : ""}
            ${ui.table(["สินค้า (FG)", "ส่วนประกอบชั้นแรก", "ชั้นลึกสุด"], built.boms.filter((entry) => result.items.get(entry.parentCode)?.kind === "FG").slice(0, 30).map((entry) => `<tr><td>${esc(entry.parentCode)}<div class="small muted">${esc(result.items.get(entry.parentCode)?.name ?? "")}</div></td><td>${esc(String(entry.lines.length))} บรรทัด</td><td>${esc(String(Math.max(...rules.explode(entry.parentCode, 1, { itemOf: (code) => result.items.get(rules.canonicalCode(code)) ?? null, approvedBomOf: (code) => (result.boms.has(code) ? { id: code, revision: 1, lines: result.boms.get(code) } : null) }).lines.map((line) => line.level))))}</td></tr>`), { emptyText: "ไม่พบสินค้า" })}
            <div class="rf-row">${canImport && !tooBig ? `<button class="btn rf-btn" type="button" data-bom-import>นำเข้า ${esc(String(r.itemCount))} ชิ้นงาน / ${esc(String(r.bomCount))} BOM</button>` : ""}<span class="small muted">พ่อที่มี BOM อยู่แล้วจะไม่ถูกทับ (ข้าม) แก้ได้ที่เมนู “สร้าง BOM”</span></div>`;
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
      const canCount = ctx.helpers.canCount(user) && draft;
      const headerKv = ui.kv([
        ["ลูกค้า", esc(order.customer)], ["ประเทศ / ประเภท", `${esc(order.country)} ${status(ctx, order.orderType)}`], ["วันที่สั่งผลิต", esc(rules.fmtDate(order.orderedAt))], ["ส่งมอบคลัง (WH)", esc(rules.fmtDate(order.whDue))],
        ["กำหนดเสร็จรายแผนก", rules.DUE_DEPTS.map((dept) => `<span class="bom-due"${(order.dueDefaults ?? []).includes(dept) ? ' title="ค่าเริ่มต้นจาก lead time"' : ""}><b>${esc(dept)}</b> ${esc(order.due[dept] ? rules.fmtDate(order.due[dept]) : "—")}${(order.dueDefaults ?? []).includes(dept) ? "*" : ""}</span>`).join(" ")],
        order.explodedAt ? ["ระเบิด BOM ล่าสุด", esc(`${rules.fmtDateTime(order.explodedAt)} · ${order.explosion?.length ?? 0} บรรทัด${order.releasedAt ? ` · ล็อก revision เมื่อปล่อยผลิต ${rules.fmtDateTime(order.releasedAt)} โดย ${order.releasedBy}` : ""}`)] : null,
        order.stockCountedAt ? ["นับคงคลังล่าสุด", esc(`${rules.fmtDateTime(order.stockCountedAt)} โดย ${order.stockCountedBy}`)] : null,
        order.note ? ["หมายเหตุ", esc(order.note)] : null,
        order.cancelReason ? ["เหตุผลยกเลิก", esc(order.cancelReason)] : null,
      ]);
      const itemRows = order.items.map((item) => `<tr><td>${ui.link(item.fgCode, ctx.url("items", { sel: item.fgCode }), "rf-mono")}<div class="small muted">${esc(itemOf(ctx, item.fgCode)?.name ?? "")}</div></td><td class="right rf-mono">${esc(rules.fmtQty(item.qty))}</td><td>${esc(item.colorSet || "-")}</td><td class="nowrap">${ui.link("งานทุกแผนก", ctx.url("product", { code: item.fgCode, qty: item.qty }), "btn rf-btn secondary small")} ${canPlan ? ui.link("แก้ BOM", buildUrl(ctx, item.fgCode), "btn rf-btn secondary small") : ""} ${draft && canPlan ? ui.button("ลบ", { action: "removeOrderItem", args: { orderId: order.id, fgCode: item.fgCode }, className: "secondary small" }) : ""}</td></tr>`);
      // ความต้องการสุทธิต่อรหัส (กฎ AK ของ BOMSHEET ไล่ชั้น): ใช้ร่วมกันทั้งแท็บใบคำนวณ แท็บรวม และ CSV
      const net = new Map(rules.netRequirements(order.explosion ?? [], order.stockCounts).map((entry) => [entry.itemCode, entry]));
      const buttons = [];
      if (draft && canPlan) {
        buttons.push(ui.openButton("เพิ่มสินค้า", "orderItemAdd", { orderId: order.id }, { className: "secondary" }));
        buttons.push(ui.button("ระเบิด BOM", { action: "explodeOrder", args: { orderId: order.id }, className: "secondary" }));
        buttons.push(ui.button("ปล่อยผลิต", { action: "releaseOrder", args: { orderId: order.id }, className: "", confirmText: `ปล่อยผลิต ${order.id}? ระบบจะล็อก revision ของ BOM และสร้างงานรายแผนก` }));
      }
      if (["released", "in_progress"].includes(order.status) && canPlan) buttons.push(ui.button("ปิดใบ", { action: "completeOrder", args: { orderId: order.id }, className: "secondary", confirmText: "ปิดใบสั่งผลิตนี้?" }));
      if (!["completed", "cancelled"].includes(order.status) && canPlan) buttons.push(ui.button("ยกเลิกใบ", { action: "cancelOrder", args: { orderId: order.id }, className: "secondary", confirmText: "ยกเลิกใบสั่งผลิตนี้?" }));
      if (order.explosion?.length) buttons.push(`<button class="btn rf-btn secondary" type="button" data-bom-csv="bomsheet" data-bom-order="${attr(order.id)}" title="ใบคำนวณวัตถุดิบรูปแบบเดียวกับ BOMSHEET เปิดใน Excel ได้">ส่งออก CSV ใบคำนวณ</button>`, `<button class="btn rf-btn secondary" type="button" data-bom-csv="req" data-bom-order="${attr(order.id)}" title="รายการที่ต้องเบิก/สั่งซื้อรวมทุกสินค้าในใบ">ส่งออก CSV รายการเบิก</button>`,
        `<span class="bom-sheet-pick">${ui.select("sheet", rules.SHEETS.map((sheet) => ({ value: sheet.id, label: `${sheet.title} · ${sheet.name}` })), { value: "RB", extra: 'data-bom-sheet aria-label="เลือกใบพิมพ์"' })}${ui.openButton("เปิดใบพิมพ์", "printSheet", { orderId: order.id, sheet: "RB" }, { className: "secondary", ariaLabel: "เปิดใบพิมพ์รายสถานี" })}</span>`);
      const tabsHtml = ui.tabs([{ id: "bom", label: "ใบคำนวณวัตถุดิบ" }, { id: "req", label: "เบิก / สั่งซื้อ / ผลิต (รวม)" }, { id: "jobs", label: "งานรายแผนก" }], tab, (id) => ctx.url("orders", { sel: order.id, tab: id }));
      let tabBody = "";
      if (!order.explosion?.length) tabBody = ui.empty(draft ? "ยังไม่ได้ระเบิด BOM — เพิ่มสินค้าแล้วกด “ระเบิด BOM”" : "ไม่มีข้อมูลการระเบิด");
      else if (tab === "bom") {
        const bomRows = order.explosion.map((line) => {
          const entry = net.get(line.itemCode);
          const stock = entry?.stock;
          return `<tr${line.level === 0 ? ' class="bom-fg-row"' : ""}><td>${levelCell(line.level, ui.link(line.itemCode, ctx.url("items", { sel: line.itemCode }), "rf-mono"))}</td><td>${esc(line.name)}${line.noBom ? ` ${ui.badge("warn", "ไม่มี BOM")}` : ""}</td><td>${deptBadge(ctx, line.producerDept)}</td><td class="right rf-mono">${line.level ? esc(rules.fmtQty(line.qtyPerFg)) : ""}</td><td class="right rf-mono">${esc(rules.fmtQty(line.required))}</td><td>${esc(uomText(ctx, line.uom))}</td><td class="right rf-mono">${line.level ? `${stock === undefined ? '<span class="muted">—</span>' : esc(rules.fmtQty(stock))}${canCount ? ` ${ui.openButton("นับ", "stockCount", { orderId: order.id, itemCode: line.itemCode }, { className: "secondary small", ariaLabel: `นับคงคลัง ${line.itemCode}` })}` : ""}` : ""}</td><td class="right rf-mono${line.level && entry && entry.net < 0 ? " bom-surplus" : ""}">${line.level && entry ? esc(rules.fmtQty(entry.net)) : ""}</td><td class="small muted">${line.revision ? `Rev.${line.revision}` : ""}</td></tr>`;
        });
        // สองคอลัมน์ท้ายเป็นยอดต่อรหัสรวมทั้งใบ (คอลัมน์ AK ของ BOMSHEET หักคงคลังชั้นบนก่อน) จึงซ้ำกันทุกบรรทัดของรหัสเดียวกัน ส่วน "ต้องเบิก" เป็นต่อบรรทัด
        tabBody = ui.table(["ชั้น / รหัส", "ชื่อวัตถุดิบ", "แผนกผลิต", { label: "ใช้ : 1 FG", className: "right" }, { label: "ต้องเบิก", className: "right" }, "หน่วย", { label: "คงคลัง (รหัสนี้ทั้งใบ)", className: "right" }, { label: "ต้องผลิต/สั่งซื้อ (รหัสนี้ทั้งใบ)", className: "right" }, "BOM"], bomRows);
      } else if (tab === "req") {
        const reqs = [...net.values()].filter((entry) => entry.kind !== "FG").sort((a, b) => a.dept.localeCompare(b.dept) || a.itemCode.localeCompare(b.itemCode));
        tabBody = ui.table(["แผนก", "รหัส", "ชื่อ", { label: "ต้องการรวม", className: "right" }, "หน่วย", { label: "คงคลัง", className: "right" }, { label: "ต้องผลิต/สั่งซื้อ", className: "right" }, "ใช้ในสินค้า"],
          reqs.map((entry) => `<tr><td>${deptBadge(ctx, entry.dept)}</td><td>${ui.mono(entry.itemCode)}</td><td>${esc(entry.name)}</td><td class="right rf-mono">${esc(rules.fmtQty(entry.required))}</td><td>${esc(uomText(ctx, entry.uom))}</td><td class="right rf-mono">${entry.stock === undefined ? '<span class="muted">—</span>' : esc(rules.fmtQty(entry.stock))}</td><td class="right rf-mono">${esc(rules.fmtQty(entry.toMake))}${entry.surplus ? `<div class="small bom-surplus">เกิน ${esc(rules.fmtQty(entry.surplus))}</div>` : ""}</td><td class="small muted">${esc(entry.fgCodes.join(", "))}</td></tr>`));
      } else {
        const jobs = data.jobs.filter((job) => job.orderId === order.id).sort((a, b) => a.dueAt - b.dueAt);
        tabBody = ui.table(["แผนก", "งาน", "ชิ้นงาน", { label: "แผน", className: "right" }, "ความคืบหน้า", "กำหนด", "สถานะ"], jobs.map((job) => `<tr${late(ctx, job) ? ' class="is-late"' : ""}><td>${deptBadge(ctx, job.dept)}</td><td>${ui.link(job.id, ctx.url("jobs", { dept: job.dept, q: job.id }), "rf-mono")}</td><td>${ui.mono(job.itemCode)}<div class="small muted">${esc(job.name)}</div></td><td class="right rf-mono">${esc(`${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`)}</td><td class="rf-progress-cell">${jobProgress(ctx, job)}</td><td class="nowrap">${esc(rules.fmtDate(job.dueAt))}</td><td>${status(ctx, job.status)}${job.externalRef ? `<div class="small">${ui.link(job.externalRef.woId, `#/rubberflow?p=orders&q=${encodeURIComponent(job.externalRef.woId)}`)}</div>` : ""}</td></tr>`), { emptyText: "ยังไม่มีงาน (ปล่อยผลิตก่อน)" });
      }
      detail = ui.card(`${headerKv}<h3 class="bom-h3">สินค้าที่สั่ง</h3>${ui.table(["สินค้า (FG)", { label: "จำนวน", className: "right" }, "ชุดสี", ""], itemRows, { emptyText: "ยังไม่มีสินค้า" })}${tabsHtml}${tabBody}`,
        { title: `${esc(order.id)} ${status(ctx, order.status)}`, actions: buttons.join("") });
    }
    const html = `${head(ctx, "ใบสั่งผลิต (PI)", "เปิดใบ → เพิ่มสินค้า (3 ช่องเหมือนชีต ;}o) → ระเบิด BOM (ร่างระเบิดซ้ำได้) → นับคงคลัง → ปล่อยผลิต (ล็อก revision แล้วแตกเป็นงานรายแผนก)")}
      <div class="bom-split bom-split-wide">${listCard}${detail}</div>`;
    const bind = (rootNode) => {
      rootNode.querySelectorAll("[data-bom-csv]").forEach((button) => button.addEventListener("click", () => {
        const target = data.orders.find((entry) => entry.id === button.dataset.bomOrder);
        if (!target?.explosion) return;
        const csv = button.dataset.bomCsv === "req" ? requirementsCsv(ctx, target) : bomsheetCsv(ctx, target);
        downloadCsv(`${target.id}-${button.dataset.bomCsv}.csv`, csv);
      }));
      // เลือกใบพิมพ์แล้วปุ่ม "เปิดใบพิมพ์" (data-rf-open อ่าน args ตอนคลิก) ชี้ไปใบนั้น
      rootNode.querySelectorAll("[data-bom-sheet]").forEach((select) => select.addEventListener("change", () => {
        const button = select.parentElement?.querySelector?.('[data-rf-open="printSheet"]');
        if (!button) return;
        try { button.dataset.rfArgs = JSON.stringify({ ...JSON.parse(button.dataset.rfArgs || "{}"), sheet: select.value }); } catch { button.dataset.rfArgs = JSON.stringify({ sheet: select.value }); }
      }));
    };
    return { html, bind };
  };
  function bomsheetCsv(ctx, order) {
    const { rules } = ctx;
    const rows = [["ชื่อลูกค้า", order.customer, "เลขที่ PI", order.id, "ประเทศ", order.country, "วันที่สั่งผลิต", rules.fmtDate(order.orderedAt), "ส่งมอบคลัง", rules.fmtDate(order.whDue)],
      ["ITEM สินค้า", "จำนวนสั่ง FG", "ชั้น", "รหัส", "ชื่อวัตถุดิบในการผลิต", "แผนกผู้ผลิต", "จำนวนใช้ : 1 FG", "จำนวนที่ต้องเบิก", "หน่วย", "จำนวนที่มีในคลัง (รหัสนี้ทั้งใบ)", "จำนวนที่ต้องผลิตหรือสั่งซื้อ (รหัสนี้ทั้งใบ หักคงคลังชั้นบนก่อน)", "BOM Rev"]];
    const net = new Map(rules.netRequirements(order.explosion, order.stockCounts).map((entry) => [entry.itemCode, entry]));
    for (const line of order.explosion) {
      const entry = net.get(line.itemCode);
      rows.push([line.fgCode, line.fgQty, line.level, line.itemCode, line.name, line.producerDept, line.level ? line.qtyPerFg : "", line.required, rules.uomLabel(line.uom), entry?.stock ?? "", line.level && entry ? entry.net : "", line.revision ?? ""]);
    }
    return rules.toCsv(rows);
  }
  function requirementsCsv(ctx, order) {
    const { rules } = ctx;
    const rows = [["เลขที่ PI", order.id, "ลูกค้า", order.customer], ["แผนกผู้ผลิต", "รหัส", "ชื่อ", "ต้องการรวม", "หน่วย", "คงคลัง", "ต้องผลิต/สั่งซื้อ", "ของเกิน", "ใช้ในสินค้า"]];
    for (const entry of rules.netRequirements(order.explosion, order.stockCounts)) {
      if (entry.kind === "FG") continue;
      rows.push([entry.dept, entry.itemCode, entry.name, entry.required, rules.uomLabel(entry.uom), entry.stock ?? "", entry.toMake, entry.surplus || "", entry.fgCodes.join(" ")]);
    }
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
        ${ui.field("เลขที่ PI", ui.input("pi", { placeholder: `ว่าง = ออกเลขอัตโนมัติ เช่น ${rules.piNumber(ctx.now, 1)}` }))}
        ${ui.field("ชื่อลูกค้า *", ui.input("customer", { required: true }))}
        ${ui.field("ประเทศ *", ui.input("country", { required: true, value: "Thailand" }), { hint: "Thailand = ในประเทศ (SA) อื่น = ต่างประเทศ (EX)" })}
        ${ui.field("วันที่สั่งผลิต *", ui.input("orderedAt", { type: "date", required: true, value: today }))}
        ${ui.field("วันส่งมอบคลัง (WH) *", ui.input("whDue", { type: "date", required: true, extra: "data-bom-whdue" }))}
      </div>
      <fieldset class="bom-fieldset"><legend>กำหนดเสร็จรายแผนก</legend>
        <label class="bom-check" title="${attr(`PK = ส่งมอบคลัง − ${rules.LEAD_DAYS.PK} วัน · GR/PT/BG/ST = PK − ${rules.LEAD_DAYS.GR} · RB = GR − ${rules.LEAD_DAYS.RB} (ตามใบจริง) ไม่ก่อนวันที่สั่งผลิต`)}"><input type="checkbox" name="autoDue" value="1" checked data-bom-autodue> ช่องที่เว้นว่างใช้ค่าเริ่มต้นจาก lead time</label>
        <div class="rf-grid rf-g3">${rules.DUE_DEPTS.map((dept) => ui.field(dept, ui.input(`due.${dept}`, { type: "date", extra: `data-bom-due="${dept}"` }), { hint: `<span data-bom-due-preview="${attr(dept)}"></span>` })).join("")}</div></fieldset>
      ${ui.field("หมายเหตุ", ui.input("note"))}
    </form>`;
    // แสดงค่าเริ่มต้นเป็นตัวอย่างใต้ช่อง (ไม่เขียนลงช่อง) ช่องที่ว่างจึงถูก action เติมและ clamp ฝั่งเดียว และใบจำได้ว่าช่องไหนเป็นค่าเริ่มต้น
    const bind = (dialog) => {
      const whInput = dialog.querySelector("[data-bom-whdue]");
      const ordered = dialog.querySelector('input[name="orderedAt"]');
      const auto = dialog.querySelector("[data-bom-autodue]");
      const preview = () => {
        const on = Boolean(whInput?.value) && (!auto || auto.checked);
        const defaults = on ? rules.defaultDueDates(rules.fromInputDate(whInput.value)) : {};
        const floor = ordered?.value ? rules.fromInputDate(ordered.value) : 0;
        const typed = new Set([...dialog.querySelectorAll("[data-bom-due]")].filter((input) => input.value).map((input) => input.dataset.bomDue));
        dialog.querySelectorAll("[data-bom-due-preview]").forEach((node) => {
          const ms = defaults[node.dataset.bomDuePreview];
          node.textContent = ms && !typed.has(node.dataset.bomDuePreview) ? `ว่าง = ${rules.fmtDate(Math.max(ms, floor || ms))}` : ""; // ช่องที่กรอกแล้วไม่ต้องมีตัวอย่าง
        });
      };
      whInput?.addEventListener("change", preview);
      ordered?.addEventListener("change", preview);
      auto?.addEventListener("change", preview);
      dialog.querySelectorAll("[data-bom-due]").forEach((input) => input.addEventListener("input", preview));
    };
    return { html: ui.dialog("orderNew", "เปิดใบสั่งผลิตใหม่", body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-order-form">เปิดใบ</button>` }), bind };
  };
  // ใบพิมพ์รายสถานี / ใบนับของ / WIP จากผลระเบิดของใบ (ตารางกฎ rules.SHEETS แทนธง P/O และมาโคร Print_* / Coppy_To_BOM_ASK_SHEET / coppy_to_WIP_*)
  // เปิดเป็น dialog ที่มี .rf-printable: สั่งพิมพ์แล้วเบราว์เซอร์พิมพ์เฉพาะใบ (กติกา @media print เดิมของ RubberFlow)
  dialogs.printSheet = (ctx, { orderId, sheet: sheetId }) => {
    const { ui, rules, data } = ctx;
    const order = data.orders.find((entry) => entry.id === orderId);
    const sheet = rules.sheetOf(sheetId);
    if (!order || !sheet || !order.explosion?.length) return null;
    const net = new Map(rules.netRequirements(order.explosion, order.stockCounts).map((entry) => [entry.itemCode, entry]));
    const lines = rules.sheetLines(sheet, order.explosion);
    const q = (value, digits) => esc(rules.fmtQty(value, digits));
    const stockOf = (line) => (line.level ? net.get(line.itemCode)?.stock : undefined);
    const makeOf = (line) => (line.level ? net.get(line.itemCode)?.net : undefined);
    const cell = (value) => (value === undefined || value === null || value === "" ? "" : esc(String(value)));
    const rowClass = (line) => (line.level === 0 ? "bom-sheet-fg" : line.kind === "SE" ? "bom-sheet-se" : line.kind === "RB" ? "bom-sheet-rb" : "");
    const commonHead = ["ITEM สินค้า", { label: "จำนวนสั่ง", className: "right" }, "รหัส", "ชื่อวัตถุดิบในการผลิต", "คู่ผู้ผลิต"];
    const commonCells = (line) => `<td class="rf-mono">${esc(line.fgCode)}</td><td class="right rf-mono">${q(line.fgQty)}</td><td class="rf-mono">${esc(line.itemCode)}</td><td>${esc(line.name)}</td><td class="rf-mono">${esc(line.pair)}</td>`;
    const qtyHead = [{ label: "ใช้ : 1 FG", className: "right" }, { label: "ต้องเบิก", className: "right" }, "หน่วย", { label: "คงคลัง (รหัสนี้ทั้งใบ)", className: "right" }, { label: "ต้องผลิต/สั่งซื้อ (รหัสนี้ทั้งใบ)", className: "right" }];
    const qtyCells = (line) => `<td class="right rf-mono">${line.level ? q(line.qtyPerFg) : ""}</td><td class="right rf-mono">${q(line.required)}</td><td>${esc(uomText(ctx, line.uom))}</td><td class="right rf-mono">${cell(stockOf(line) === undefined ? "" : rules.fmtQty(stockOf(line)))}</td><td class="right rf-mono${makeOf(line) < 0 ? " bom-surplus" : ""}">${cell(makeOf(line) === undefined ? "" : rules.fmtQty(makeOf(line)))}</td>`;
    const dueOf = (dept) => (order.due[dept] ? rules.fmtDate(order.due[dept]) : "—");
    let head = [];
    let rows = [];
    if (sheet.layout === "ask") {
      head = [...commonHead, { label: "ต้องเบิก", className: "right" }, "หน่วย", "จำนวนที่นับได้", "หมายเหตุ"];
      rows = lines.map((line) => `<tr class="${rowClass(line)}">${commonCells(line)}<td class="right rf-mono">${q(line.required)}</td><td>${esc(uomText(ctx, line.uom))}</td><td class="bom-sheet-blank"></td><td class="bom-sheet-blank"></td></tr>`);
    } else if (sheet.layout === "wip-rbgr") {
      head = [...commonHead, ...qtyHead, "ความยาวตัด (ซม.)", { label: "ชิ้น/เส้น", className: "right" }, { label: "SE ต่อ GR", className: "right" }, "กำหนด"];
      rows = lines.map((line) => { const rubber = itemOf(ctx, line.itemCode)?.rubber ?? {}; return `<tr class="${rowClass(line)}">${commonCells(line)}${qtyCells(line)}<td class="right rf-mono">${cell(rubber.cutLengthCm)}</td><td class="right rf-mono">${cell(rubber.pcsPerRoll)}</td><td class="right rf-mono">${cell(rubber.sePerGr)}</td><td class="nowrap">${esc(line.kind === "RB" ? `RB ${dueOf("RB")}` : `GR ${dueOf("GR")}`)}</td></tr>`; });
    } else if (sheet.layout === "wip-ptbg") {
      head = [...commonHead, ...qtyHead, "กำหนด"];
      rows = lines.map((line) => `<tr class="${rowClass(line)}">${commonCells(line)}${qtyCells(line)}<td class="nowrap">${esc(line.pair.endsWith("-PT") ? `PT ${dueOf("PT")}` : line.kind === "BG" || line.pair.startsWith("BG") ? `BG ${dueOf("BG")}` : line.level === 0 ? `PK ${dueOf("PK")}` : `ST ${dueOf("ST")}`)}</td></tr>`);
    } else {
      head = [...commonHead, ...qtyHead];
      rows = lines.map((line) => `<tr class="${rowClass(line)}">${commonCells(line)}${qtyCells(line)}</tr>`);
    }
    // หัวใบพิมพ์มีชื่อใบและเลข PI ในตัว (dialog ไม่ซ้ำ) เพราะบนกระดาษเห็นเฉพาะ .rf-printable
    const header = `<div class="bom-sheet-head">
        <div><h2>${esc(sheet.title)} <span class="muted">${esc(sheet.name)}</span></h2><div class="small muted">พิมพ์ ${esc(rules.fmtDateTime(ctx.now))}</div></div>
        ${ui.kv([["ชื่อลูกค้า", esc(order.customer)], ["เลขที่ใบสั่งผลิต", esc(order.id)], ["ประเทศ", `${esc(order.country)} · ${esc(order.orderType === "EX" ? "ต่างประเทศ" : "ในประเทศ")}`], ["วันที่สั่งผลิต", esc(rules.fmtDate(order.orderedAt))], ["ส่งมอบคลัง (WH)", esc(rules.fmtDate(order.whDue))], ["REV.", esc(String(order.revision ?? 0))]])}
        <div class="bom-sheet-due">${rules.DUE_DEPTS.map((dept) => `<span class="bom-due"><b>${esc(dept)}</b> ${esc(dueOf(dept))}</span>`).join(" ")}</div>
      </div>`;
    const sign = sheet.layout === "ask" ? `<div class="bom-sheet-sign"><div>คลังชิ้นยาง (SE)<br>ลงชื่อ ..........................<br>...../...../.....</div><div>คลังเส้นยาว (SR)<br>ลงชื่อ ..........................<br>...../...../.....</div><div>ฝ่ายวางแผนการผลิต<br>ลงชื่อ ..........................<br>...../...../.....</div></div>` : "";
    const body = `<div class="rf-printable bom-sheet">${header}${ui.table(head, rows, { emptyText: "ไม่มีบรรทัดของใบนี้", className: "bom-sheet-table" })}${sign}<p class="small muted bom-sheet-foot">**มีการเปลี่ยนแปลงหรือตกหล่น กรุณาแจ้งกลับ**</p></div>`;
    const bind = (dialog) => { dialog.querySelector("[data-bom-print]")?.addEventListener("click", () => { if (typeof window !== "undefined" && typeof window.print === "function") window.print(); }); };
    return { html: ui.dialog("printSheet", "ใบพิมพ์", body, { wide: true, footer: `${ui.closeButton("ปิด")}<button class="btn rf-btn" type="button" data-bom-print>พิมพ์</button>` }), bind };
  };
  // เลือกสินค้าแบบ 3 ช่องเหมือนชีต ;}o: ฐานรหัส + แพ็กเกจ + ชุดสี → รหัสเต็ม ถ้ารหัสเต็มยังไม่มีแต่ฐานรหัสมี ระบบสร้างจาก BOM ของตัวนั้น
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
      <p class="small muted">สินค้าที่ยังไม่มีฐานรหัสในระบบ สร้างได้ที่เมนู “สร้าง BOM” ${ui.link("เปิด", ctx.url("build"))}</p>
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
          bodyNode.textContent = `${code} · ${item.name} · ${bom ? `BOM Rev.${bom.revision} ${bom.lines.length} บรรทัด` : "ยังไม่มี BOM"}`;
          preview.className = `rf-callout ${bom ? "is-good" : "is-warn"}`;
          return;
        }
        const siblings = ctx.helpers.siblingsOf(ctx.data, base);
        const source = ctx.helpers.pickSibling(siblings, pkg.toUpperCase(), colorSet.toUpperCase());
        bodyNode.textContent = source ? `${code} ยังไม่มีใน item master — จะสร้างจาก BOM ของ ${source.code} (Rev.${approvedBomOf(ctx, source.code)?.revision ?? "-"}) เมื่อกดเพิ่ม` : `ไม่มีฐานรหัส ${base} ที่มี BOM`;
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

  // ---------- นับคงคลังตามใบ (มือถือ) ----------
  // แทนใบตรวจสอบชิ้นงานคงคลัง (BOMASKSHEET) ที่พิมพ์ให้คลังนับแล้วฝ่ายวางแผนคีย์กลับ: คลังกรอกบนมือถือครั้งเดียว ยอดเข้าใบทันที
  // รายการตั้งต้นตามกฎใบตรวจสอบ (SE + RB) · all=1 แสดงทุกชิ้นในใบ · นับได้เฉพาะใบร่างที่ระเบิด BOM แล้ว (กติกาเดียวกับ setStockCount)
  pages.count = (ctx) => {
    const { data, ui, rules, params } = ctx;
    const canCount = ctx.helpers.canCount(ctx.user);
    const drafts = data.orders.filter((order) => order.status === "draft");
    const sel = String(params.get("order") ?? "").toUpperCase();
    const order = drafts.find((entry) => entry.id === sel && entry.explosion?.length) ?? null; // ใบที่ถูกแก้จนยังไม่ระเบิดใหม่ กลับไปหน้าเลือกใบ
    const pageHead = head(ctx, "นับคงคลังตามใบ", "กรอกยอดที่นับได้ของชิ้นในใบสั่งผลิตที่ยังเป็นร่าง");
    if (!order) {
      const rows = drafts.map((entry) => entry.explosion?.length
        ? `<a class="bom-count-order" href="${attr(ctx.url("count", { order: entry.id }))}"><strong class="rf-mono">${esc(entry.id)}</strong><span>${esc(entry.customer)}</span><span class="small muted">${esc(`${Object.keys(entry.stockCounts ?? {}).length ? `นับแล้ว ${Object.keys(entry.stockCounts).length} รายการ · ` : ""}ส่งมอบ ${rules.fmtDate(entry.whDue)}`)}</span></a>`
        : `<div class="bom-count-order is-disabled"><strong class="rf-mono">${esc(entry.id)}</strong><span>${esc(entry.customer)}</span><span class="small muted">ยังไม่ระเบิด BOM (ฝ่ายวางแผน)</span></div>`);
      return { html: `${pageHead}${ui.card(rows.length ? `<div class="bom-count-orders">${rows.join("")}</div>` : ui.empty("ไม่มีใบสั่งผลิตที่เป็นร่าง"), { title: "เลือกใบสั่งผลิต" })}` };
    }
    const all = params.get("all") === "1";
    const lines = (all ? order.explosion : rules.sheetLines(rules.sheetOf("ASK"), order.explosion)).filter((line) => line.level > 0);
    const byCode = new Map();
    for (const line of lines) {
      const entry = byCode.get(line.itemCode) ?? { itemCode: line.itemCode, name: line.name, uom: line.uom, dept: line.producerDept, kind: line.kind, required: 0 };
      entry.required += line.required;
      byCode.set(line.itemCode, entry);
    }
    const entries = [...byCode.values()];
    const groups = rules.groupByDept(entries);
    const counted = entries.filter((entry) => order.stockCounts[entry.itemCode] !== undefined).length;
    const toggle = ui.link(all ? "เฉพาะ SE + RB (ตามใบตรวจสอบ)" : "แสดงทุกชิ้นในใบ", ctx.url("count", { order: order.id, all: all ? null : "1" }), "btn rf-btn secondary small").replace("<a ", "<a data-bom-count-nav ");
    const rowHtml = (entry) => `<div class="bom-count-row">
        <div class="bom-count-what"><span class="rf-mono">${esc(entry.itemCode)}</span><span>${esc(entry.name)}</span><span class="small muted">ต้องใช้ ${esc(rules.fmtQty(entry.required))} ${esc(uomText(ctx, entry.uom))}</span></div>
        <input type="hidden" name="itemCode[]" value="${attr(entry.itemCode)}">
        <label class="bom-count-input"><span class="sr-only">${esc(`ยอดที่นับได้ ${entry.itemCode}`)}</span><input class="input rf-input" name="qty[]" type="number" inputmode="decimal" step="any" min="0" value="${attr(order.stockCounts[entry.itemCode] ?? "")}" placeholder="—"${canCount ? "" : " disabled"}><span class="small muted">${esc(uomText(ctx, entry.uom))}</span></label>
      </div>`;
    const body = entries.length
      ? `<form data-rf-form="setStockCounts" data-rf-args="${attr(JSON.stringify({ orderId: order.id }))}" data-rf-success="บันทึกยอดที่นับ {result}" class="bom-count-form">
          ${groups.map((group) => `<h3 class="bom-h3">${esc(group.dept)} <span class="muted">${esc(rules.DEPT_LABEL[group.dept]?.replace(/^\w+ · /, "") ?? "")}</span></h3>${group.entries.sort((a, b) => a.itemCode.localeCompare(b.itemCode)).map(rowHtml).join("")}`).join("")}
          ${canCount ? '<div class="bom-count-save"><button class="btn rf-btn" type="submit">บันทึกยอดที่นับ</button></div>' : ""}
        </form>`
      : ui.empty("ใบนี้ไม่มีชิ้นตามกฎใบตรวจสอบ (SE/RB)");
    const html = `${pageHead}${ui.card(body, { title: `${esc(order.id)} <span class="muted">${esc(order.customer)} · นับแล้ว ${esc(String(counted))}/${esc(String(entries.length))}</span>`, actions: `${toggle}${ui.link("เปลี่ยนใบ", ctx.url("count"), "btn rf-btn secondary small").replace("<a ", "<a data-bom-count-nav ")}` })}`;
    // ลิงก์สลับรายการ/เปลี่ยนใบ: ถ้ามียอดที่พิมพ์แล้วยังไม่บันทึก ถามก่อนออก (ยอดจะหาย)
    const bind = (rootNode) => {
      const form = rootNode.querySelector?.(".bom-count-form");
      if (!form) return;
      let dirty = false;
      form.addEventListener("input", () => { dirty = true; });
      rootNode.querySelectorAll("[data-bom-count-nav]").forEach((link) => link.addEventListener("click", (event) => { if (dirty && !confirm("มียอดที่ยังไม่บันทึก ออกจากหน้านี้?")) event.preventDefault(); }));
    };
    return { html, bind };
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
      return `<tr${late(ctx, job) ? ' class="is-late"' : ""}><td>${ui.mono(job.id)}<div class="small muted">${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId, tab: "jobs" }))} · ${esc(order?.customer ?? "")}</div></td>${dept === "ALL" ? `<td>${deptBadge(ctx, job.dept)}</td>` : ""}<td>${ui.link(job.itemCode, ctx.url("items", { sel: job.itemCode }), "rf-mono")}<div class="small muted">${esc(job.name)}${item?.rubber?.compound ? ` · สูตร ${esc(item.rubber.compound)}` : ""}</div></td><td class="right rf-mono">${esc(`${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`)}${job.qtyRequired && job.qtyRequired !== job.qtyPlanned ? `<div class="small muted" title="ยอดที่ใบต้องการหลังหักคงคลังของชั้นบนแล้ว ก่อนหักคงคลังของชิ้นนี้">${esc(`ต้องการ ${rules.fmtQty(job.qtyRequired)}${job.stockCounted !== null && job.stockCounted !== undefined ? ` · คลัง ${rules.fmtQty(job.stockCounted)}` : ""}`)}</div>` : ""}</td><td class="rf-progress-cell">${jobProgress(ctx, job)}</td><td class="nowrap">${esc(rules.fmtDate(job.dueAt))}${late(ctx, job) ? `<div class="small">${ui.badge("bad", "เลยกำหนด")}</div>` : ""}</td><td>${status(ctx, job.status)}${job.externalRef ? `<div class="small">${ui.link(`WO ${job.externalRef.woId}`, `#/rubberflow?p=orders&q=${encodeURIComponent(job.externalRef.woId)}`)}${job.externalRef.kg ? `<span class="muted"> · ${esc(rules.fmtQty(job.externalRef.kg, 2))} kg</span>` : ""}</div>` : ""}</td><td class="nowrap">${buttons.join(" ")}</td></tr>`;
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
        const button = event.currentTarget;
        button.disabled = true;
        const result = rf.store.run("createOrder", {
          recipeId: recipe.id, customer: order?.customer ?? job.orderId, customerPo: job.orderId, targetQty, color: item.rubber?.color || "ดำ",
          startDate: new Date(ctx.now).setHours(0, 0, 0, 0), dueDate: Math.max(job.dueAt, new Date(ctx.now).setHours(0, 0, 0, 0)), priority: late(ctx, job) ? "urgent" : "normal",
          note: `จาก BOM งาน ${job.id} · PI ${job.orderId} · ${job.itemCode} ${rules.fmtQty(job.qtyPlanned - job.qtyDone)} ${uomText(ctx, job.uom)} ≈ ${rules.fmtQty(kg, 2)} kg`,
        });
        if (!result.ok) { showToast(friendlyError(result.error), "error"); button.disabled = false; return; }
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
    const html = `${head(ctx, "บันทึกการใช้งาน", "ทุกการแก้ item master, BOM, ใบสั่งผลิต และงานรายแผนก พร้อมผู้ทำและเวลา", searchForm(ctx, "ค้นหาผู้ใช้ การกระทำ หรือรหัส…"))}
      ${ui.card(ui.table(["เวลา", "ผู้ใช้", "การกระทำ", "รายละเอียด"], rows, { emptyText: "ไม่พบรายการ" }), { flush: true })}`;
    return { html };
  };
})(typeof window !== "undefined" ? window : globalThis);
