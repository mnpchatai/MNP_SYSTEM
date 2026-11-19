// ชุดชิ้นส่วนกลางของโมดูลโรงงาน (window.MNP_FACTORY) — ยกจาก BOM มาให้ทุกแผนกเรียกใช้ร่วมกัน ไม่มีสำเนาที่สองใน BOM
// มี: ตัวผูก event ตามกติกา data-rf-* (bindRoot) · formPayload / parseArgs · การ์ดงานผลิต (jobCard) · dialog รายงานผล (jobReportDialog) · ป้ายแผนก (deptChip)
// และกลุ่มเมนู "โรงงาน": registerDeptModule (โมดูลรายแผนกหนึ่งไฟล์ต่อแผนก) · canSeeDept (ใครเห็นโมดูลไหน) · orderNavItems (เรียงเมนูตามผังงาน) · ส่วนประกอบหน้าแรกของแผนก
// ไฟล์นี้ไม่แตะ helper ของ app.js ตอนโหลด (เรียกเฉพาะตอนใช้งาน) โหลดก่อน modules/bom-pages.js (ดู index.html)
// การซ่อน/แสดงปุ่มเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูลและ action ของแต่ละโมดูล
(function registerFactoryKit(root) {
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);

  // name → ค่า · name[] → อาร์เรย์ · a.b → ออบเจ็กต์ซ้อน (ค่าเป็นสตริง action แปลงเลขเอง)
  function formPayload(form) {
    const payload = {};
    for (const [rawKey, value] of new FormData(form).entries()) {
      const isList = rawKey.endsWith("[]");
      const key = isList ? rawKey.slice(0, -2) : rawKey;
      const path = key.split(".");
      let target = payload;
      for (const part of path.slice(0, -1)) target = (target[part] ??= {});
      const last = path.at(-1);
      if (isList) (target[last] ??= []).push(value);
      else target[last] = value;
    }
    return payload;
  }
  function parseArgs(node) {
    try { return node.dataset.rfArgs ? JSON.parse(node.dataset.rfArgs) : {}; } catch { return {}; }
  }

  // ตัวผูก event ตามกติกา data-rf-form / data-rf-action / data-rf-open / data-rf-go / data-rf-search ของ root ที่เพิ่งวาด
  // opts.run(name, payload, successText, after) → true/false หรือ Promise (ผู้เรียกส่งคำสั่งเข้า store ของตัวเอง แจ้งผลเอง)
  // opts.transforms = { ชื่อคำสั่ง: (raw) => payload } · opts.beforeSubmit(name, raw, payload, form) → { payload?, after? } | false (ตะขอเฉพาะโมดูล false = ไม่ส่ง)
  // opts.openDialog(name, args, ctx) · opts.rerender() (ค่าตั้งต้น renderRoute) · ui / confirmDialog / showToast / friendlyError มาจาก global ของแอป
  function bindRoot(scope, ctx, opts = {}) {
    const ui = opts.ui ?? root.MNP_RUBBERFLOW_UI;
    const rerender = opts.rerender ?? (() => renderRoute());
    scope.querySelectorAll("form[data-rf-form]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      // ตรวจช่องเป็นภาษาไทยใต้ช่องก่อน (ฟอร์มเป็น novalidate) · action ยังตรวจกติกาของตัวเองซ้ำ
      if (!ui.validateForm(form)) return;
      // ปุ่มส่งที่มี data-rf-confirm (รับเข้าคลัง / ส่งมอบ): ถามยืนยันครั้งเดียวแล้วส่งทันที (ไม่มีนับถอยหลัง)
      const confirmer = event.submitter?.dataset?.rfConfirm ? event.submitter : null;
      if (confirmer && !(await confirmDialog(ui.confirmOptions(confirmer)))) return;
      const name = form.dataset.rfForm;
      const transform = opts.transforms?.[name] ?? ((payload) => payload);
      let payload;
      let raw;
      try {
        raw = { ...formPayload(form), ...parseArgs(form) };
        payload = transform(raw);
      } catch (error) {
        showToast(friendlyError(error), "error");
        return;
      }
      const hook = opts.beforeSubmit ? opts.beforeSubmit(name, raw, payload, form) : null;
      if (hook === false) return;
      let ok = opts.run(name, hook?.payload ?? payload, form.dataset.rfSuccess, hook?.after ?? null);
      if (ok && typeof ok.then === "function") ok = await ok;
      if (!ok) return;
      form.closest?.("dialog")?.close?.();
      form.querySelectorAll("button").forEach((node) => { node.disabled = true; });
      rerender();
    }));
    scope.querySelectorAll("[data-rf-action]").forEach((button) => button.addEventListener("click", async () => {
      if (button.dataset.rfConfirm && !(await confirmDialog(ui.confirmOptions(button)))) return;
      let ok = opts.run(button.dataset.rfAction, parseArgs(button), button.dataset.rfSuccess, null);
      if (ok && typeof ok.then === "function") ok = await ok;
      if (!ok) return;
      button.disabled = true;
      rerender();
    }));
    scope.querySelectorAll("[data-rf-open]").forEach((button) => button.addEventListener("click", () => opts.openDialog?.(button.dataset.rfOpen, parseArgs(button), ctx)));
    scope.querySelectorAll("[data-rf-go]").forEach((button) => button.addEventListener("click", () => { location.hash = button.dataset.rfGo; }));
    scope.querySelectorAll("form[data-rf-search]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = String(new FormData(form).get("q") ?? "").trim().slice(0, 100);
      location.hash = ctx.pageUrl({ q: q || null });
    }));
  }

  // ป้ายแผนก: ตัวย่อ + สีประจำแผนก (สีเป็นตัวช่วย ตัวย่อเป็นตัวบอก) ชื่อเต็มอยู่ใน title (labels = ตารางชื่อเต็ม เช่น rules.DEPT_LABEL)
  const deptChip = (dept, labels) => `<span class="bom-dept" data-dept="${attr(dept)}" title="${attr(labels?.[dept] ?? dept)}">${esc(dept)}</span>`;

  // กำหนดส่ง: งานที่เสร็จแล้วไม่แสดง · เลยกำหนดเป็นสีเตือน
  const dueText = (ctx, dueAt, finished) => (finished ? "" : dueAt < ctx.now ? `<span class="bom-job-late">เลยกำหนด ${esc(ctx.rules.fmtDate(dueAt))}</span>` : `<span class="muted">ส่งภายใน ${esc(ctx.rules.fmtDate(dueAt))}</span>`);

  const JOB_TONE = Object.freeze({ in_progress: ["now", "กำลังทำ"], queued: ["", "รอคิว"], hold: ["hold", "พักงาน"], done: ["done", "เสร็จ"] });

  // การ์ดงานผลิต (หนึ่งงานต่อแผนก × ชิ้นงาน) · opts = { planner, dept, show, orderOf, actions = true }
  // planner && dept === "ALL" = แสดงป้ายแผนกหน้ารหัสชิ้นงาน · actions: false = การ์ดเดียวกันแบบอ่านอย่างเดียว (ไม่มีปุ่ม)
  function jobCard(ctx, job, opts = {}) {
    const { rules, ui, data, user } = ctx;
    const { planner = false, dept = null, actions = true } = opts;
    const orderOf = opts.orderOf ?? ((id) => data.orders.find((entry) => entry.id === id));
    const order = orderOf(job.orderId);
    const [tone, label] = JOB_TONE[job.status] ?? ["", job.status];
    const canWork = actions && ctx.helpers.canWorkJob(user, job) && ["released", "in_progress"].includes(order?.status) && job.status !== "done";
    const left = Math.max(0, job.qtyPlanned - job.qtyDone);
    const started = job.qtyDone > 0 || job.status === "in_progress";
    const linkedJob = Boolean(ctx.helpers.isLinkedJob?.(job));
    // งานที่พักอยู่รายงานผลไม่ได้ ต้องกด "ทำต่อ" / "คืนคิว" ก่อน
    const main = canWork && !linkedJob && job.status !== "hold" ? ui.openButton("รายงานผล", "jobReport", { jobId: job.id }, { className: "bom-job-main" }) : "";
    const more = [];
    const resume = (Number(job.qtyDone) || 0) > 0;
    if (canWork) more.push(job.status === "hold" ? ui.button(resume ? "ทำต่อ" : "คืนคิว", { action: "setJobStatus", args: { jobId: job.id, status: resume ? "in_progress" : "queued" }, className: "secondary small" }) : ui.openButton("พักงาน", "jobHold", { jobId: job.id }, { className: "secondary small" }));
    // งานที่จะไม่มีใครรายงานแล้ว: ฝ่ายวางแผนปิดงานพร้อมเหตุผล (ไม่เพิ่มยอด) ใบจึงปิดได้
    if (canWork && ctx.helpers.canPlan(user)) more.push(ui.openButton("ปิดงานนี้", "jobClose", { jobId: job.id }, { className: "secondary small" }));
    const closedBy = ctx.helpers.jobCloseNote(job);
    const heldBy = closedBy ? null : ctx.helpers.jobHoldNote?.(job);
    if (actions && job.status !== "done" && ctx.helpers.canLinkRubberflow(user, job) && ["released", "in_progress"].includes(order?.status) && !job.externalRef) more.push(ui.openButton("สร้าง WO ใน RubberFlow", "jobRubberflow", { jobId: job.id }, { className: "secondary small" }));
    if (actions && job.externalRef) more.push(ui.link(`WO ${job.externalRef.woId}`, `#/rubberflow?p=orders&q=${encodeURIComponent(job.externalRef.woId)}`, "btn rf-btn secondary small"));
    const amount = started ? `ได้แล้ว ${rules.fmtQty(job.qtyDone)} จาก ${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}` : `ต้องได้ ${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)}`;
    // งาน GR: ยางเส้นยาวที่คลังยางเส้นยาว (SR) จ่ายให้ใบนี้แล้ว ต่อเส้นยางที่ชิ้นงานนี้ใช้ (rules.rodIssueNeeds)
    const rodLine = job.dept === "GR" && job.status !== "done" ? rules.rodIssueNeeds(data, job.orderId).filter((need) => need.grJobs.some((entry) => entry.id === job.id))
      .map((need) => `<p class="small muted" title="${attr(`${need.itemCode} · GR ต้องใช้ ${rules.fmtQty(need.need)} ${uomText(ctx, need.uom)}`)}">${esc(`ยางเส้นยาวจาก SR ${rules.fmtQty(need.issued)}/${rules.fmtQty(need.need)} ${uomText(ctx, need.uom)}`)}</p>`).join("") : "";
    return `<article class="card rf-card bom-job${tone ? ` is-${tone}` : ""}"><div class="bom-job-top"><span class="bom-job-state">${esc(label)}</span>${dueText(ctx, job.dueAt, job.status === "done")}</div>
        <h2>${esc(job.name)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(job.dept, rules.DEPT_LABEL)} ` : ""}<span class="rf-mono">${esc(job.itemCode)}</span> · ใบ ${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId }))}</p>
        <div class="bom-job-amount"><span>${esc(amount)}</span>${started && job.status !== "done" ? `<span class="muted">เหลือ ${esc(rules.fmtQty(left))}</span>` : ""}</div>${started ? ui.progress(job.qtyDone, job.qtyPlanned, job.status === "hold" ? "bad" : "") : ""}${job.qtyReject ? `<p class="small muted">เสีย ${esc(rules.fmtQty(job.qtyReject))}</p>` : ""}${closedBy ? `<p class="small muted">${esc(`ปิดงานโดย ${closedBy.by}: ${closedBy.reason}`)}</p>` : ""}${heldBy ? `<p class="small muted">${esc(`พักโดย ${heldBy.by}: ${heldBy.reason}`)}</p>` : ""}${rodLine}${canWork && linkedJob ? '<p class="small muted" title="ยอดของงานนี้เพิ่มเองเมื่อคลังแท่งยาว (SR) รับแท่งจากล็อตตกแต่งของ WO เข้าคลังและผ่านตรวจขนาด">ยอดมาจากการรับเข้าคลัง SR</p>' : ""}
        ${main}${more.length ? `<div class="rf-row bom-job-more">${more.join("")}</div>` : ""}</article>`;
  }

  // dialog รายงานผลของงานผลิต (ฟอร์ม data-rf-form="reportJob" ส่งผ่าน bindRoot) · null = รายงานไม่ได้ (ไม่พบงาน พักอยู่ หรือยอดมาจากการรับเข้าคลัง)
  function jobReportDialog(ctx, { jobId }) {
    const { ui, rules } = ctx;
    const job = ctx.data.jobs.find((entry) => entry.id === jobId);
    if (!job || job.status === "hold" || ctx.helpers.isLinkedJob?.(job)) return null;
    const remaining = Math.max(0, job.qtyPlanned - job.qtyDone);
    // ช่องจำนวนดีว่างไว้ (บอกยอดที่เหลือเป็น placeholder): กดบันทึกครั้งเดียวต้องไม่รายงานว่าเสร็จทั้งแผน
    // แผนกก่อนหน้าส่งมาพอสำหรับกี่หน่วย (null = ไม่รู้) · เตือนเมื่อยอดรวมที่รายงานเกิน ไม่ห้ามบันทึก
    const supply = rules.jobSupplyLimit(ctx.data, job);
    const body = `<form novalidate id="bom-job-form" data-rf-form="reportJob" data-rf-args="${attr(JSON.stringify({ jobId }))}" data-rf-success="บันทึกผลผลิต {result}">
      <p class="muted small">${esc(`${job.itemCode} · ${job.name} · แผน ${rules.fmtQty(job.qtyPlanned)} ${uomText(ctx, job.uom)} · ทำแล้ว ${rules.fmtQty(job.qtyDone)} · เหลือ ${rules.fmtQty(remaining)}`)}</p>
      <div class="rf-grid rf-g2">${ui.field(`จำนวนดี (${uomText(ctx, job.uom)})`, ui.input("qtyDone", { type: "number", step: "any", min: 0, value: "", placeholder: remaining ? `เหลือ ${rules.fmtQty(remaining)}` : "0", extra: "data-job-qty" }))}${ui.field("จำนวนเสีย", ui.input("qtyReject", { type: "number", step: "any", min: 0, value: "0" }))}</div>
      ${supply === null ? "" : '<div class="rf-callout is-warn" role="note" data-job-supply hidden><div class="rf-callout-body"></div></div>'}
      ${ui.field("หมายเหตุ", ui.input("note", { placeholder: "เช่น รอบรีดที่ 2" }))}
    </form>`;
    const bind = (dialog) => {
      const qtyInput = dialog.querySelector("[data-job-qty]");
      const box = dialog.querySelector("[data-job-supply]");
      if (!qtyInput || !box || supply === null) return;
      const paint = () => {
        const entered = Number(qtyInput.value) || 0;
        const total = Number(job.qtyDone) + entered;
        const over = entered > 0 && total > supply + 1e-6;
        box.hidden = !over;
        const bodyNode = box.querySelector(".rf-callout-body");
        if (bodyNode) bodyNode.textContent = over ? `แผนกก่อนหน้าส่งมาพอสำหรับ ${rules.fmtQty(supply)} ${uomText(ctx, job.uom)} แต่ยอดรวมที่รายงานจะเป็น ${rules.fmtQty(total)}` : "";
      };
      qtyInput.addEventListener("input", paint);
      paint();
    };
    return { html: ui.dialog("jobReport", `รายงานผล ${job.id}`, body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="bom-job-form">บันทึก</button>` }), bind };
  }

  // ---------- กลุ่มเมนู "โรงงาน" และตัวลงทะเบียนโมดูลรายแผนก ----------
  // โมดูลแผนกใหม่ = ไฟล์ modules/module-<แผนก>.js หนึ่งไฟล์ที่เรียก registerDeptModule หนึ่งครั้ง (ดู module-sr.js)
  // ทุกโมดูลอยู่ในโหมดทดสอบเท่านั้น: เมนูและหน้าใช้ประตูเดียวกับ BOM (usesBom) จึงมองไม่เห็นในที่ที่ BOM มองไม่เห็นวันนี้ (รวม admin และฝ่ายวางแผน นอกโหมดทดสอบ)
  // ใครเห็นโมดูลไหน (เจ้าของสั่ง 2026-11-19): พนักงานและหัวหน้าแผนกเห็นเฉพาะโมดูลของแผนกตัวเอง · แผนก PP และผู้จัดการ (admin, ผู้จัดการทั่วไป, ผู้จัดการโรงงาน, ผู้ช่วยผู้จัดการโรงงาน) เห็นทุกโมดูล
  // เป็นการซ่อนเมนู/หน้าเท่านั้น (UX) สิทธิ์จริงของแต่ละ action ยังตัดสินที่ฐานข้อมูลเหมือนเดิม
  const FACTORY_GROUP = "โรงงาน";
  const SEE_ALL_ROLES = Object.freeze(["admin", "general_manager", "factory_manager", "assistant_factory_manager"]);
  const SEE_ALL_DEPTS = Object.freeze(["PP"]);
  const roleCodeOf = (employee) => String(employee?.role?.code ?? employee?.role_code ?? "");
  const deptCodeOf = (employee) => String(employee?.department?.code ?? employee?.department_code ?? "").toUpperCase();

  // employee = ผู้ใช้ที่มีผลตอนนี้ (state.employee: ในโหมดทดสอบคือบัญชีทดสอบ persona ที่ admin เลือกอยู่) · moduleCode = รหัสโมดูลสำหรับกติกาแผนกที่เห็นเฉพาะบางโมดูล (ID)
  function canSeeDept(employee, dept, moduleCode = null) {
    if (!employee) return false;
    const access = root.MNP_DEPARTMENT_ACCESS;
    // แผนกที่เห็นเฉพาะบางโมดูล (ID) ไม่เห็นโมดูลโรงงานเลย แม้ในโหมดทดสอบที่ app.js ข้ามกติกานั้น
    if (access?.isRestricted?.(employee) && !(moduleCode && access.moduleAllowed(employee, moduleCode))) return false;
    if (SEE_ALL_ROLES.includes(roleCodeOf(employee)) || SEE_ALL_DEPTS.includes(deptCodeOf(employee))) return true;
    return deptCodeOf(employee) === String(dept ?? "").toUpperCase();
  }
  // เปิดโมดูลแผนกได้หรือไม่: ประตูเดียวกับ BOM (ไม่มี store = ปิด) แล้วจึงตามกติกาแผนก
  const bomGate = (employee) => Boolean(root.MNP_BOM_STORE?.usesBom?.(employee));
  const canOpenDeptModule = (employee, dept, moduleCode = null) => bomGate(employee) && canSeeDept(employee, dept, moduleCode);

  // เรียงรายการเมนูของกลุ่มเดียวกันตาม flowNo (ลำดับในผังงาน rules.PROCESS_FLOW) ให้อยู่ใต้หัวกลุ่มเดียว ไม่ว่าลำดับโหลดสคริปต์เป็นอย่างไร
  // กลุ่มที่ไม่มีรายการใดมี flowNo คงลำดับเดิม · รายการไม่มี group คงตำแหน่งเดิม · กลุ่มอยู่ที่ตำแหน่งของรายการแรกของกลุ่ม
  function orderNavItems(items) {
    const out = [];
    const placed = new Set();
    for (const item of items) {
      if (!item.group) { out.push(item); continue; }
      if (placed.has(item.group)) continue;
      placed.add(item.group);
      const members = items.filter((entry) => entry.group === item.group);
      if (!members.some((entry) => entry.flowNo !== undefined)) { out.push(...members); continue; }
      out.push(...members.map((entry, index) => ({ entry, index })).sort((a, b) => (a.entry.flowNo ?? Infinity) - (b.entry.flowNo ?? Infinity) || a.index - b.index).map(({ entry }) => entry));
    }
    return out;
  }

  // ---- ส่วนประกอบของหน้าแรกรายแผนก (อ่านอย่างเดียว) ----
  const routeUrl = (route, query = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
    const text = params.toString();
    return `#/${route}${text ? `?${text}` : ""}`;
  };
  const iconHtml = (name) => (typeof name === "string" && name.startsWith("<") ? name : root.MNP_UI_ICONS?.icon?.(name) ?? "");
  const factoryOf = (ctx) => ctx.factory ?? {};
  // หัวหน้า: ก้อนสีโมดูล + ไอคอน + ชื่อหน้า + ลิงก์ไปที่ทำงานจริง (actionsHtml)
  const pageHead = (ctx, title, actionsHtml = "") => `<header class="rf-pagehead"><div class="rf-pagehead-main">${factoryOf(ctx).icon ? `<span class="rf-mod-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">${iconHtml(factoryOf(ctx).icon)}</span></span>` : ""}<div><h1>${esc(title)}</h1></div></div>${actionsHtml ? `<div class="rf-row">${actionsHtml}</div>` : ""}</header>`;
  // ช่องค้นหา: ฟอร์ม data-rf-search ผูกโดย bindRoot ส่งไป ctx.pageUrl({ q }) ของหน้านั้น
  const searchForm = (ctx, placeholder) => `<form novalidate class="rf-search" data-rf-search role="search"><label class="sr-only" for="factory-q">ค้นหา</label>${ctx.ui.input("q", { id: "factory-q", type: "search", value: ctx.q, placeholder })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>`;
  const includesText = (haystack, q) => !q || String(haystack).toLowerCase().includes(String(q).toLowerCase());
  // ตารางที่ยาวแสดงทีละ 100 แถว: คืน { shown, more } (more = ลิงก์แสดงเพิ่ม หรือ "")
  const PAGE_ROWS = 100;
  function limited(ctx, list) {
    const limit = Math.max(PAGE_ROWS, Math.min(5000, Number(ctx.params.get("n")) || PAGE_ROWS));
    const shown = list.slice(0, limit);
    const more = list.length > shown.length ? `<div class="rf-row">${ctx.ui.link(`แสดงเพิ่ม (อีก ${list.length - shown.length})`, ctx.pageUrl({ n: limit + PAGE_ROWS }), "btn rf-btn secondary small")}</div>` : "";
    return { shown, more };
  }
  const TASK_FG_LINES = 3;
  // งานที่รอของแผนก (ผลของ MNP_BOM_PAGES.hub: storeTasks / rodTasks / fgTasks) เป็นตารางสั้น: สถานะ · รายการ · จำนวน — ปุ่มลงมือทำอยู่ที่หน้า BOM (ลิงก์ที่หัวหน้า)
  function taskInfo(ctx, task) {
    const { ui, rules } = ctx;
    const orderLink = (id) => ui.link(id, ctx.url("orders", { sel: id }), "rf-mono");
    const qty = (value, uom) => `${rules.fmtQty(value)} ${rules.uomLabel(uom)}`;
    const fgLines = (lines) => `${lines.slice(0, TASK_FG_LINES).map((line) => `${esc(line.fgCode)} × ${esc(rules.fmtQty(line.qty))}`).join(" · ")}${lines.length > TASK_FG_LINES ? ` · อีก ${lines.length - TASK_FG_LINES}` : ""}`;
    switch (task.kind) {
      case "rodReceive": return ["รอรับเข้าคลัง", `${ui.mono(task.lot.lotNo)} <span class="small muted">${esc(task.lot.itemCode)} · ใบ ${esc(task.lot.orderId)}</span>`, esc(`ส่งมา ${qty(task.lot.qtySent, task.lot.uom)}`)];
      case "rodDecide": return ["กักรอ QA ตัดสิน", `${ui.mono(task.lot.lotNo)} <span class="small muted">${esc(task.lot.itemCode)} · ใบ ${esc(task.lot.orderId)}</span>`, esc(`รับไว้ ${qty(task.lot.qtyReceived ?? task.lot.qtySent, task.lot.uom)}`)];
      case "rodIssue": return ["รอจ่ายให้ GR", `${orderLink(task.need.order.id)} <span class="small muted">${esc(task.need.itemCode)}</span>`, esc(`ต้องจ่าย ${qty(task.need.remaining, task.need.uom)}`)];
      case "receive": return [task.cancelled ? "ตัดสินใบสั่งซื้อ" : "รอรับเข้าตามใบสั่งซื้อ", ui.mono(task.po.id), esc(`${task.lines.length} รายการ`)];
      case "partReturn": return ["รอรับของคืน", orderLink(task.order.id), esc(`${task.lines.length} รายการ`)];
      case "chemReturn": return ["รอรับเคมีคืน", ui.mono(task.req.id ?? task.req.orderId ?? ""), ""];
      case "chem": return ["เคมีขาด ยังไม่ได้สั่ง", "สำหรับใบสั่งผลิตของแผนก RB", esc(`${task.short.length} รายการ`)];
      case "buy": return ["ของขาด ยังไม่ได้สั่ง", `${ui.mono(task.itemCode)}${task.name ? ` <span class="small muted">${esc(task.name)}</span>` : ""}`, esc(`ขาดรวม ${qty(task.total, task.uom)}`)];
      case "fgReceive": return [task.surplus ? "รอรับส่วนเกินเข้าคลัง" : "รอรับเข้าคลัง", orderLink(task.order.id), fgLines(task.lines)];
      case "fgDeliver": return ["รอส่งมอบลูกค้า", orderLink(task.order.id), fgLines(task.lines)];
      case "fgClose": return ["รอปิดใบ", orderLink(task.order.id), ""];
      case "fgCloseShort": return ["รอปิดใบ (รับไม่ครบ)", orderLink(task.order.id), fgLines(task.lines)];
      default: return [String(task.kind ?? ""), "", ""];
    }
  }
  const TASK_ROWS = 10;
  function taskTable(ctx, tasks, title = "งานที่รอ") {
    const { ui } = ctx;
    if (!tasks.length) return ui.card(ui.empty("ไม่มีงานค้าง"), { title: esc(title) });
    const rows = tasks.slice(0, TASK_ROWS).map((task) => { const [status, what, amount] = taskInfo(ctx, task); return `<tr><td class="nowrap">${esc(status)}</td><td>${what}</td><td>${amount}</td></tr>`; });
    const rest = tasks.length > TASK_ROWS ? `<p class="small muted">และอีก ${tasks.length - TASK_ROWS} รายการ</p>` : "";
    return ui.card(`${ui.table(["สถานะ", "รายการ", "จำนวน"], rows)}${rest}`, { title: esc(title), flush: !rest });
  }
  // ปุ่มลิงก์ไปที่ทำงานจริง (ที่เดียวต่อแหล่ง)
  const actionLink = (ctx, text, href) => ctx.ui.link(text, href, "btn rf-btn secondary");

  // ---- ข้อมูลที่ยังโหลดไม่เสร็จ: ขอโหลดครั้งเดียวแล้ววาดหน้าใหม่เมื่อเสร็จ ----
  const ROUTES = new Set();
  const waking = new WeakSet();
  const onFactoryRoute = () => { try { return ROUTES.has(currentRoute().path); } catch { return false; } };
  const repaint = () => { try { if (onFactoryRoute() && !root.MNP_BOM?.isEditing?.()) renderRoute(); } catch { /* ออกจากหน้าแล้ว */ } };
  // คืน true = ยังไม่พร้อม (ผู้เรียกบอกว่ากำลังโหลดแทนการเงียบ)
  function wake(store) {
    if (!store?.isRemote?.() || !["idle", "loading"].includes(store.status())) return false;
    if (!waking.has(store)) {
      waking.add(store);
      const done = () => { waking.delete(store); repaint(); };
      store.ensureLoaded().then(done, done);
    }
    return true;
  }
  let watching = false;
  function watch(store) {
    if (watching) return;
    watching = true;
    // ผู้อื่นบันทึกข้อมูล BOM: วาดหน้าแผนกใหม่ (หน้า BOM จัดการของตัวเองใน module-bom.js)
    store.subscribe((event) => { if (["loaded", "load-failed", "synced", "saved"].includes(event.type)) repaint(); });
  }

  // หน้าแรกรายแผนก: ประตูเมนู → โหลด store ของ BOM → landing(ctx) คืน { html, bind? } → วางใน shell ของระบบหลัก
  async function renderLanding(def, params, landing) {
    const employee = state.employee;
    // นอกโหมดทดสอบ หรือแผนกนี้ไม่ใช่ของผู้ใช้: ไม่เจอหน้า (พิมพ์ URL เองก็เข้าไม่ได้) · เมนูซ่อนด้วยประตูเดียวกัน
    if (employee?.isSandbox !== true || !canOpenDeptModule(employee, def.dept, def.code)) return renderNotFound();
    const bom = root.MNP_BOM;
    if (!bom?.store) return renderNotFound();
    const { store } = bom;
    watch(store);
    store.ensureLoaded();
    const ui = root.MNP_RUBBERFLOW_UI;
    ui.module = "";
    const base = bom.context(params);
    const ctx = { ...base, factory: def, pageUrl: (extra = {}) => routeUrl(def.route, { q: base.q || null, ...extra }) };
    let body;
    let bind = null;
    if (store.status() === "error") body = `<section class="card rf-card" role="alert"><h1>โหลดข้อมูล BOM ไม่สำเร็จ</h1><p class="muted">${esc(store.error()?.message ?? "")}</p><div class="rf-row"><button class="btn rf-btn" type="button" data-factory-retry>ลองอีกครั้ง</button></div></section>`;
    else if (store.status() !== "ready") body = ui.card(ui.empty("กำลังโหลดข้อมูล…"));
    else {
      const built = landing(ctx);
      body = built.html;
      bind = built.bind ?? null;
    }
    app.innerHTML = shell(`<div class="rf-page bom-page" data-module="${attr(def.palette)}" data-rf-mod="">${body}</div>`, def.route, def.label);
    bindShell();
    const node = document.querySelector(".content");
    node.querySelector("[data-factory-retry]")?.addEventListener("click", () => { store.reload(); renderRoute(); });
    // หน้าแรกอ่านอย่างเดียว: ไม่มีฟอร์มหรือปุ่มสั่งงาน (run ปฏิเสธเสมอ) มีแค่ค้นหาและลิงก์
    bindRoot(node, ctx, { run: () => false });
    ui.labelTables(node);
    bind?.(node, ctx);
    return undefined;
  }

  // def = { code, dept, route, label, icon, palette, landing(ctx), pages? }
  // code เช่น "FACTORY_SR" (ไม่ชนโมดูลอื่น) · dept = รหัสแผนกใน rules.PROCESS_FLOW · route = path ของหน้าแรก (#/sr) · icon = ชื่อไอคอนใน MNP_UI_ICONS
  // landing(ctx): ctx = ctx ของ BOM (data, rules, ui, helpers, url, user, q, params) + pageUrl ของหน้านี้ + factory (def) · pages = หน้าเพิ่มเติมของแผนก { path: (params) => … } ผ่านประตูเดียวกัน
  function registerDeptModule(def) {
    const { code, dept, route, label, icon, palette, landing, pages = {}, flowNo } = def;
    if (!code || !dept || !route || !label || typeof landing !== "function") throw new Error("registerDeptModule: code, dept, route, label และ landing จำเป็น");
    const modules = (root.MNP_REQUEST_MODULES ??= {});
    if (modules[code]) throw new Error(`registerDeptModule: โมดูล ${code} ลงทะเบียนแล้ว`);
    const flow = flowNo ?? root.MNP_BOM_RULES?.PROCESS_FLOW?.find((entry) => entry.dept === dept)?.no;
    const factory = Object.freeze({ code, dept, route, label, icon, palette });
    const guarded = (page) => (params) => (state.employee?.isSandbox !== true || !canOpenDeptModule(state.employee, dept, code) ? renderNotFound() : page(params));
    ROUTES.add(route);
    const extra = Object.fromEntries(Object.entries(pages).map(([path, page]) => { ROUTES.add(path); return [path, guarded(page)]; }));
    modules[code] = {
      code, enabled: true, standalone: true, sandbox: true, label, palette, dept,
      navAllowed: (employee) => canOpenDeptModule(employee, dept, code),
      nav: [{ path: route, label, icon: iconHtml(icon), sandboxOnly: true, group: FACTORY_GROUP, ...(flow === undefined ? {} : { flowNo: flow }) }],
      pages: { [route]: (params) => renderLanding(factory, params, landing), ...extra },
    };
    return modules[code];
  }

  root.MNP_FACTORY = Object.freeze({
    esc, attr, formPayload, parseArgs, bindRoot, deptChip, dueText, jobCard, jobReportDialog,
    FACTORY_GROUP, canSeeDept, canOpenDeptModule, orderNavItems, registerDeptModule,
    pageHead, searchForm, includesText, limited, taskTable, actionLink, wake, routeUrl,
  });
})(window);
