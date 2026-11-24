// ชุดชิ้นส่วนกลางของโมดูลโรงงาน (window.MNP_FACTORY) — ยกจาก BOM มาให้ทุกแผนกเรียกใช้ร่วมกัน ไม่มีสำเนาที่สองใน BOM
// มี: ตัวผูก event ตามกติกา data-rf-* (bindRoot) · formPayload / parseArgs · การ์ดงานผลิต (jobCard) · dialog รายงานผล (jobReportDialog) · ป้ายแผนก (deptChip)
// และกลุ่มเมนู "โรงงาน": registerDeptModule (โมดูลรายแผนกหนึ่งไฟล์ต่อแผนก) · canSeeDept (ใครเห็นโมดูลไหน) · orderNavItems (เรียงเมนูตามผังงาน) · ส่วนประกอบหน้าแรกของแผนก
// · productionLanding (หน้าแรกของแผนกที่มีงานผลิต GR PT BG PK: การ์ดงานสั่งงานได้ผ่านคำสั่งของ BOM ชุดเดียวกับหน้า "งานของฉัน")
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
  // ส่วนที่อยู่ใน [data-rf-scope] เป็นของโมดูลอื่น (เช่น ตารางใบสั่งซื้อของ RubberFlow ในหน้า #/st) ตัวผูกของโมดูลนั้นผูกเอง จึงข้ามที่นี่ (ไม่ผูกซ้ำสองทาง)
  function bindRoot(scope, ctx, opts = {}) {
    const ui = opts.ui ?? root.MNP_RUBBERFLOW_UI;
    const rerender = opts.rerender ?? (() => renderRoute());
    const owner = (node) => node.closest?.("[data-rf-scope]")?.dataset?.rfScope ?? "";
    const inside = Boolean(owner(scope));
    const pick = (selector) => [...scope.querySelectorAll(selector)].filter((node) => inside || !owner(node));
    pick("form[data-rf-form]").forEach((form) => form.addEventListener("submit", async (event) => {
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
    pick("[data-rf-action]").forEach((button) => button.addEventListener("click", async () => {
      if (button.dataset.rfConfirm && !(await confirmDialog(ui.confirmOptions(button)))) return;
      let ok = opts.run(button.dataset.rfAction, parseArgs(button), button.dataset.rfSuccess, null);
      if (ok && typeof ok.then === "function") ok = await ok;
      if (!ok) return;
      button.disabled = true;
      rerender();
    }));
    pick("[data-rf-open]").forEach((button) => button.addEventListener("click", () => opts.openDialog?.(button.dataset.rfOpen, parseArgs(button), ctx)));
    pick("[data-rf-go]").forEach((button) => button.addEventListener("click", () => { location.hash = button.dataset.rfGo; }));
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

  // การ์ดคลิกได้ทั้งใบ (stretched link): ชื่อการ์ดเป็นลิงก์จริง (โฟกัสด้วยคีย์บอร์ดได้) ขยายพื้นที่คลิกคลุมการ์ดด้วย CSS (.bom-card-link::after ใน styles.css)
  // ปุ่มและลิงก์อื่นในการ์ดอยู่เหนือชั้นนั้น จึงกดได้ตามปกติโดยไม่เปิดหน้ารายละเอียดซ้อน · ไม่มี href = ข้อความธรรมดา การ์ดเดิมไม่เปลี่ยน
  const cardTitle = (title, href) => (href ? `<a class="bom-card-link" href="${attr(href)}">${esc(title)}</a>` : esc(title));
  const cardClass = (href) => (href ? " has-link" : "");

  // การ์ดงานผลิต (หนึ่งงานต่อแผนก × ชิ้นงาน) · opts = { planner, dept, show, orderOf, actions = true, href, body?, main?, more?, extra? }
  // body = HTML แทนบรรทัดยอดและแถบความคืบหน้า (งาน GR ที่ตั้งขั้นตอน: ความคืบหน้ารายขั้น) · main / more = ปุ่มของโมดูลที่เรียก (ดูข้างล่าง) · extra = บรรทัดสถานะของโมดูล (เช่น คำขอเบิกที่รอ SR) ใต้บรรทัดยางเส้นยาว
  // planner && dept === "ALL" = แสดงป้ายแผนกหน้ารหัสชิ้นงาน · actions: false = การ์ดเดียวกันแบบอ่านอย่างเดียว (ไม่มีปุ่ม)
  // href = หน้ารายละเอียดของงาน (ข้อความ หรือฟังก์ชัน job → ข้อความ): คลิกที่ไหนของการ์ดก็เปิดหน้านั้น · ไม่ให้ = การ์ดไม่เป็นลิงก์
  function jobCard(ctx, job, opts = {}) {
    const { rules, ui, data, user } = ctx;
    const { planner = false, dept = null, actions = true } = opts;
    const href = typeof opts.href === "function" ? opts.href(job) : opts.href ?? null;
    const orderOf = opts.orderOf ?? ((id) => data.orders.find((entry) => entry.id === id));
    const order = orderOf(job.orderId);
    const [tone, label] = JOB_TONE[job.status] ?? ["", job.status];
    const canWork = actions && ctx.helpers.canWorkJob(user, job) && ["released", "in_progress"].includes(order?.status) && job.status !== "done";
    const left = Math.max(0, job.qtyPlanned - job.qtyDone);
    const started = job.qtyDone > 0 || job.status === "in_progress";
    const linkedJob = Boolean(ctx.helpers.isLinkedJob?.(job));
    // งานที่พักอยู่รายงานผลไม่ได้ ต้องกด "ทำต่อ" / "คืนคิว" ก่อน
    // งาน GR (20261216010000): ตั้งขั้นตอนแล้ว = ยอดมาจาก "บันทึกผลรายวัน" ของโมดูล GR ไม่มีปุ่มรายงานผล · ยังไม่ตั้งและยังไม่เคยรายงานแบบเดิม = หัวหน้าแผนก GR / ฝ่ายวางแผนตั้งขั้นตอนก่อน (คำตอบเจ้าของข้อ 7)
    // งาน GR ที่รายงานยอดแบบเดิมไปแล้ว (ตั้งขั้นตอนไม่ได้) รายงานแบบเดิมต่อได้ · opts.main = ปุ่มหลักที่โมดูลส่งมาแทน ("" = ไม่มี)
    const grPlanned = job.dept === "GR" && Boolean(ctx.helpers.isGrPlanned?.(data, job));
    const grFresh = job.dept === "GR" && !grPlanned && typeof ctx.helpers.isGrPlanned === "function" && !(Number(job.qtyDone) > 0 || Number(job.qtyReject) > 0);
    const grSetup = ctx.helpers.canGrLead?.(user) ? ui.openButton("ตั้งขั้นตอน", "grSteps", { jobId: job.id }, { className: "bom-job-main" }) : '<p class="small muted">รอหัวหน้าแผนก GR ตั้งขั้นตอนก่อนบันทึกผล</p>';
    const defaultMain = canWork && !linkedJob && job.status !== "hold" ? (grPlanned ? "" : grFresh ? grSetup : ui.openButton("รายงานผล", "jobReport", { jobId: job.id }, { className: "bom-job-main" })) : "";
    const main = actions && opts.main !== undefined ? opts.main : defaultMain;
    // opts.more = ปุ่มรองของโมดูล (เช่น ขอเบิกยางเส้นยาว ส่งให้ PK ของ GR) วางก่อนปุ่มพัก/ปิดงาน
    const more = actions && Array.isArray(opts.more) ? opts.more.filter(Boolean) : [];
    // งานที่มียอด หรือมีผลรายวันของ GR แล้ว (คืนคิวไม่ได้) = ทำต่อ · ยังไม่มีอะไร = คืนคิว
    const resume = (Number(job.qtyDone) || 0) > 0 || Boolean(ctx.helpers.hasGrRecords?.(data, job));
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
    return `<article class="card rf-card bom-job${tone ? ` is-${tone}` : ""}${cardClass(href)}"><div class="bom-job-top"><span class="bom-job-state">${esc(label)}</span>${dueText(ctx, job.dueAt, job.status === "done")}</div>
        <h2>${cardTitle(job.name, href)}</h2><p class="small muted">${planner && dept === "ALL" ? `${deptChip(job.dept, rules.DEPT_LABEL)} ` : ""}<span class="rf-mono">${esc(job.itemCode)}</span> · ใบ ${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId }))}</p>
        ${opts.body ?? `<div class="bom-job-amount"><span>${esc(amount)}</span>${started && job.status !== "done" ? `<span class="muted">เหลือ ${esc(rules.fmtQty(left))}</span>` : ""}</div>${started ? ui.progress(job.qtyDone, job.qtyPlanned, job.status === "hold" ? "bad" : "") : ""}`}${job.qtyReject ? `<p class="small muted">เสีย ${esc(rules.fmtQty(job.qtyReject))}</p>` : ""}${closedBy ? `<p class="small muted">${esc(`ปิดงานโดย ${closedBy.by}: ${closedBy.reason}`)}</p>` : ""}${heldBy ? `<p class="small muted">${esc(`พักโดย ${heldBy.by}: ${heldBy.reason}`)}</p>` : ""}${rodLine}${actions ? opts.extra ?? "" : ""}${canWork && linkedJob ? '<p class="small muted" title="ยอดของงานนี้เพิ่มเองเมื่อคลังยางเส้นยาว (SR) รับยางเส้นยาวจากล็อตตกแต่งของ WO เข้าคลังและผ่านตรวจขนาด">ยอดมาจากการรับเข้าคลัง SR</p>' : ""}
        ${main}${more.length ? `<div class="rf-row bom-job-more">${more.join("")}</div>` : ""}</article>`;
  }

  // dialog รายงานผลของงานผลิต (ฟอร์ม data-rf-form="reportJob" ส่งผ่าน bindRoot) · null = รายงานไม่ได้ (ไม่พบงาน พักอยู่ ยอดมาจากการรับเข้าคลัง หรืองาน GR ที่ยอดมาจากผลรายวัน)
  function jobReportDialog(ctx, { jobId }) {
    const { ui, rules } = ctx;
    const job = ctx.data.jobs.find((entry) => entry.id === jobId);
    if (!job || job.status === "hold" || ctx.helpers.isLinkedJob?.(job) || (job.dept === "GR" && ctx.helpers.isGrPlanned?.(ctx.data, job))) return null;
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
  // ลิงก์ไปโมดูลของแผนก เฉพาะเมื่อผู้ใช้เปิดโมดูลนั้นได้ (ไม่พาไปหน้า "ไม่พบ") · RB = RubberFlow (เปิดได้ทุกคนที่ใช้ BOM ได้) · คืน null = ไม่มีลิงก์
  const deptLink = (employee, dept) => {
    const route = root.MNP_BOM_STORE?.deptRoute?.(dept) ?? null;
    if (!route) return null;
    if (dept === "RB") return (root.MNP_RUBBERFLOW_STORE?.usesRubberFlow?.(employee) ?? bomGate(employee)) ? route : null;
    return canOpenDeptModule(employee, dept, `FACTORY_${dept}`) ? route : null;
  };

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

  // ---- ส่วนประกอบของหน้าแรกรายแผนก (ส่วนใหญ่อ่านอย่างเดียว · หน้าที่คืน actions: true สั่งงานได้) ----
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
  // งานที่รอของแผนกคลัง/ตรวจคุณภาพ (SR ST WH QA): การ์ดสั่งงานชุดเดียวกับหน้า BOM "งานของฉัน" (MNP_BOM_PAGES.hub.taskCard / boardCards ไม่คัดลอก HTML)
  // รายการงานมาจากกระดานของแผนก (workBoard ของ deptCtx: ฝ่ายวางแผน/ผู้จัดการเปิดโมดูลแล้วเห็นงานของแผนกนั้น) · ปุ่มและ dialog ตัดสินสิทธิ์ด้วยผู้ใช้จริง (ctx.user) ไม่มีสิทธิ์ = การ์ดดูอย่างเดียว
  // ใช้กับ landing ที่คืน actions: true · waiting = ข้อความกำลังโหลดที่ใส่เหนือการ์ด · emptyText = ข้อความเมื่อไม่มีงาน
  // afterReceipts = การ์ด HTML ของโมดูลเอง (เช่นล็อตของ RubberFlow ที่รอ WH รับ) วางต่อจากการ์ดงานรับเข้า (hub.isReceiptTask) ก่อนการ์ดงานอื่น · นับรวมใน count
  // คืน { count, html } · title = null ไม่ใส่หัวข้อ (ใช้ใต้แท็บ "งานที่รอ" ที่บอกอยู่แล้ว)
  function deptWork(ctx, { title = "งานที่รอ", emptyText = "ไม่มีงานค้าง", waiting = "", quietWhenEmpty = false, afterReceipts = [] } = {}) {
    const hub = root.MNP_BOM_PAGES?.hub;
    const board = hub.workBoard(deptCtx(ctx), new URLSearchParams());
    const { taskCards, cards } = hub.boardCards(ctx, board);
    const receipt = (_, i) => hub.isReceiptTask(board.tasks[i]);
    const all = [...taskCards.filter(receipt), ...afterReceipts, ...taskCards.filter((card, i) => !receipt(card, i)), ...cards];
    if (!all.length && quietWhenEmpty && !waiting) return { count: 0, html: "" };
    const head = title ? `<h2 class="bom-h3">${esc(title)}</h2>` : "";
    return { count: all.length, html: `${head}${waiting}${all.length ? `<div class="bom-job-grid">${all.join("")}</div>` : waiting ? "" : ctx.ui.card(ctx.ui.empty(emptyText))}` };
  }
  const deptWorkSection = (ctx, options) => deptWork(ctx, options).html;

  // ---- เมนูข้างของโมดูลแผนก (เหมือนเมนูข้างของ BOM / RubberFlow): "งานของฉัน" เป็นอันแรกเสมอ แล้วจึงหน้าอื่นของแผนก ----
  // รายการ = { id, label, icon, params, owns?, count?(ctx) } · params = พารามิเตอร์ของหน้านั้นใน URL ({} = หน้าแรก) · count = ตัวเลขบนเมนู (0 = ไม่แสดง)
  // owns = ชื่อพารามิเตอร์อื่นที่ทำให้หน้านั้นเป็นของรายการนี้ (เช่น หน้าล็อต ?lot= อยู่ใต้ "ในคลัง": เมนูข้างและหัวหน้าตามรายการนั้น)
  const workItem = (count) => ({ id: "work", label: "งานของฉัน", icon: "inbox", params: {}, count });
  const deptWorkCount = (ctx) => deptWork(ctx).count;
  const STORE_MENU = Object.freeze([workItem(deptWorkCount), { id: "stock", label: "ในคลัง", icon: "warehouse", params: { tab: "stock" } }]);
  const WORK_MENU = Object.freeze([workItem(deptWorkCount)]);
  // หน้าที่เปิดอยู่ = รายการที่พารามิเตอร์ตรงกับ URL มากที่สุด (ไม่ตรงเลย = หน้าแรก)
  function viewOf(menu, params) {
    const owner = menu.find((item) => (item.owns ?? []).some((key) => params.get(key)));
    if (owner) return owner;
    let best = menu[0];
    for (const item of menu) {
      const keys = Object.keys(item.params ?? {});
      if (keys.length > Object.keys(best.params ?? {}).length && keys.every((key) => params.get(key) === String(item.params[key]))) best = item;
    }
    return best;
  }
  const syncLine = () => `<span class="small muted" role="status" data-bom-sync>${esc(root.MNP_BOM?.syncText?.() ?? "")}</span>`;
  // "งานของฉัน" อยู่ในโมดูลของแผนกเท่านั้น (เจ้าของสั่ง 2026-11-19: เอาออกจาก BOM) จึงไม่มีลิงก์กลับไป BOM
  // หัวหน้าหน้า: h1 = ชื่อรายการเมนูที่เปิดอยู่ · actionsHtml = ปุ่มของหน้านั้น (เช่น "รับยางนอกใบสั่ง") ก่อนข้อความสถานะการบันทึก
  const viewHead = (ctx, actionsHtml = "") => pageHead(ctx, ctx.view?.label ?? "งานของฉัน", `${typeof actionsHtml === "string" ? actionsHtml : ""}${syncLine()}`);

  // หน้าของแผนกคลัง (SR ST WH): เมนูข้าง "งานของฉัน" (การ์ดงานที่รอ) กับ "ในคลัง" (ของที่มีอยู่จริง ค้นหาได้)
  // stock = { count, html } ที่โมดูลสร้าง (ช่องค้นหา + ตาราง) · work = ตัวเลือกของ deptWork
  function storeLanding(ctx, { stock, work = {} }) {
    const { ui } = ctx;
    if (ctx.view?.id === "stock") return `${viewHead(ctx)}${stock.html}`;
    const job = deptWork(ctx, { ...work, title: null });
    return `${viewHead(ctx)}${job.html || ui.card(ui.empty(work.emptyText ?? "ไม่มีงานค้าง"))}`;
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
  // RubberFlow โหลดไม่สำเร็จ: หน้าแผนกแสดงบรรทัดเดียวแทนตารางที่ว่างเปล่า (ปุ่มลองใหม่อยู่ที่หน้า RubberFlow)
  const failed = (store) => Boolean(store?.isRemote?.()) && store.status() === "error";
  const rubberflowFailed = (ctx, title, actions = "") => ctx.ui.card('<p class="small muted" role="alert">โหลดข้อมูล RubberFlow ไม่สำเร็จ</p>', { title: esc(title), actions });
  // งานที่รอของแผนก ไม่ใช่ของผู้เปิดหน้า: ฝ่ายวางแผนและผู้จัดการเห็นงานชุดเดียวกับแผนกนั้น (สิทธิ์ลงมือยังตัดสินที่หน้า BOM และฐานข้อมูล · หน้านี้อ่านอย่างเดียว)
  function deptCtx(ctx) {
    const dept = ctx.factory?.dept;
    const employee = { id: `dept-${dept}`, department: { code: dept }, role: { code: "employee" } };
    const user = root.MNP_BOM_STORE?.personaUser?.(employee);
    if (!dept || !user) return ctx;
    const rfStoreApi = root.MNP_RUBBERFLOW_STORE;
    const rfUser = rfStoreApi?.personaUser?.(employee);
    const rubberflow = () => { const live = ctx.rubberflow(); return live && rfUser ? { ...live, can: (permission) => rfStoreApi.can(rfUser, permission) } : live; };
    return { ...ctx, user, rubberflow };
  }
  // การวาดหน้าแผนกใหม่เมื่อ store ของ BOM เปลี่ยน (โหลดเสร็จ/ไม่สำเร็จ ผู้อื่นบันทึก บันทึกของเราสำเร็จหรือย้อนกลับ) ทำที่ตัวรับ event ของ store ใน modules/module-bom.js
// ที่เดียวกับหน้า BOM (ถือว่า #/gr ฯลฯ เป็นหน้าของตัวเอง ผ่าน onDeptRoute) จึงไม่ทับสิ่งที่พิมพ์ค้างใน dialog และไม่วาดซ้ำสองทาง

  // ctx ของหน้าแผนก = ctx ของ BOM + factory (def) + view (หน้าในเมนูข้างที่เปิดอยู่) + pageUrl ของหน้านี้
  // ลิงก์ในหน้า (ค้นหา แสดงเพิ่ม) พาหน้าในเมนูข้างและมุมมองทั้งทะเบียนที่เลือกอยู่ไปด้วย ผู้ใช้จึงไม่หลุดจากที่ที่ดูอยู่
  function deptPageCtx(def, params) {
    const base = root.MNP_BOM.context(params);
    const view = viewOf(def.menu, params);
    // def.keep = พารามิเตอร์ของหน้านั้นที่ลิงก์ในหน้าพาไปด้วย (ตัวกรอง) เหมือน q และ all
    const kept = Object.fromEntries((def.keep ?? []).map((key) => [key, params.get(key) || null]));
    return { ...base, factory: def, view, pageUrl: (extra = {}) => routeUrl(def.route, { ...view.params, q: base.q || null, all: params.get("all") || null, ...kept, ...extra }) };
  }
  // เมนูข้างใต้ลิงก์ของโมดูล (app.js วางเมื่อโมดูลนี้เปิดอยู่) · ตัวเลขนับจากข้อมูลชุดเดียวกับหน้า นับไม่ได้ = ไม่แสดงตัวเลข
  function deptSubnav(def, active) {
    if (active !== def.route) return "";
    let params = new URLSearchParams();
    try { params = currentRoute().params ?? params; } catch { /* ไม่มี route */ }
    const store = root.MNP_BOM?.store;
    let ctx = null;
    try { if (store?.status?.() === "ready" && state.employee?.isSandbox === true) ctx = deptPageCtx(def, params); } catch { ctx = null; }
    const current = viewOf(def.menu, params);
    // รายการที่มี when(ผู้ใช้ BOM) แสดงเฉพาะผู้ที่ทำงานในหน้านั้นได้ (เช่น ตั้งค่าของ GR: หัวหน้าแผนก GR และฝ่ายวางแผน) · ซ่อนเมนูเป็น UX หน้าและ action ตรวจสิทธิ์เอง
    let who = null;
    try { who = store?.user?.() ?? null; } catch { who = null; }
    const items = def.menu.filter((item) => typeof item.when !== "function" || (who && item.when(who))).map((item) => {
      let count = 0;
      try { count = ctx && item.count ? Number(item.count(ctx)) || 0 : 0; } catch { count = 0; }
      const href = routeUrl(def.route, item.params);
      const on = item.id === current.id;
      return `<li><a class="rf-nav-item${on ? " is-active" : ""}" href="${attr(href)}"${on ? ' aria-current="page"' : ""}><span class="rf-nav-ico" aria-hidden="true"><span class="rf-ico" aria-hidden="true">${iconHtml(item.icon)}</span></span><span class="rf-nav-text">${esc(item.label)}</span>${count ? `<span class="rf-nav-count" title="${attr(item.id === "work" ? "งานที่ต้องทำ" : item.label)}">${count}</span>` : ""}</a></li>`;
    }).join("");
    return `<div class="nav-sub rf-nav" data-module="${attr(def.palette)}"><ul class="rf-nav-list">${items}</ul></div>`;
  }

  // หน้าแรกรายแผนก: ประตูเมนู → โหลด store ของ BOM → landing(ctx) คืน { html, bind? } → วางใน shell ของระบบหลัก
  // ผู้เข้าชม (def.guest): แผนกอื่นที่เปิดหน้าของโมดูลนี้ได้บางหน้าทางลิงก์ (ไม่อยู่ในเมนู) เช่น RB ดูเคมีในคลัง ST · คืนชื่อโหมด (ข้อความ) หรือ null = ไม่ให้เข้า
  const guestOf = (def, employee) => (employee?.isSandbox === true && bomGate(employee) && !canOpenDeptModule(employee, def.dept, def.code) && typeof def.guest === "function" ? def.guest(employee) || null : null);
  const mayOpen = (def, employee) => employee?.isSandbox === true && (canOpenDeptModule(employee, def.dept, def.code) || Boolean(guestOf(def, employee)));
  async function renderLanding(def, params, landing) {
    const employee = state.employee;
    // นอกโหมดทดสอบ หรือแผนกนี้ไม่ใช่ของผู้ใช้ (และไม่ใช่ผู้เข้าชมที่โมดูลยอมให้): ไม่เจอหน้า (พิมพ์ URL เองก็เข้าไม่ได้) · เมนูซ่อนด้วยประตูเดียวกัน
    if (!mayOpen(def, employee)) return renderNotFound();
    const bom = root.MNP_BOM;
    if (!bom?.store) return renderNotFound();
    const { store } = bom;
    store.ensureLoaded();
    const ui = root.MNP_RUBBERFLOW_UI;
    ui.module = "";
    const ctx = deptPageCtx(def, params);
    ctx.guest = guestOf(def, employee); // null = ผู้ใช้ของโมดูล · อื่น = โหมดผู้เข้าชมที่ def.guest คืน (หน้าเลือกเองว่าแสดงอะไร)
    // dialog เปิดด้วย ctx ของหน้านี้ (ไม่ใช่ ctx ของ BOM) · ฟอร์มใน dialog ส่งผ่านตัวผูกของ BOM
    if (typeof bom.openDialog === "function") ctx.openDialog = (name, args) => bom.openDialog(name, args, ctx);
    bom.clearEditing?.(); // หน้าใหม่ = ไม่มีฟอร์มที่แก้ค้างจากหน้าก่อน (เหมือน renderBom)
    let body;
    let bind = null;
    let actions = false;
    if (store.status() === "error") body = `<section class="card rf-card" role="alert"><h1>โหลดข้อมูล BOM ไม่สำเร็จ</h1><p class="muted">${esc(store.error()?.message ?? "")}</p><div class="rf-row"><button class="btn rf-btn" type="button" data-factory-retry>ลองอีกครั้ง</button></div></section>`;
    else if (store.status() !== "ready") body = ui.card(ui.empty("กำลังโหลดข้อมูล…"));
    else {
      const built = landing(ctx);
      body = built.html;
      bind = built.bind ?? null;
      actions = built.actions === true;
    }
    app.innerHTML = shell(`<div class="rf-page bom-page" data-module="${attr(def.palette)}" data-rf-mod="">${body}</div>`, def.route, def.label);
    bindShell();
    const node = document.querySelector(".content");
    node.querySelector("[data-factory-retry]")?.addEventListener("click", () => { store.reload(); renderRoute(); });
    // ผูกครั้งเดียวต่อหน้า (ไม่ผูก data-rf-search / data-rf-go ซ้ำ) · หน้าที่ไม่ได้ขอ actions อ่านอย่างเดียว: ไม่มีฟอร์มหรือปุ่มสั่งงาน (run ปฏิเสธเสมอ) มีแค่ค้นหาและลิงก์
    // หน้าที่ขอ actions: คำสั่งและ dialog ของ BOM ด้วยผู้ใช้จริง (ctx.user = บัญชีที่ทำหน้าที่อยู่ ไม่ใช่ deptCtx) สิทธิ์ตัดสินที่ action และฐานข้อมูลเหมือนหน้า BOM
    bindRoot(node, ctx, actions && typeof ctx.runAction === "function" ? { run: ctx.runAction, transforms: bom.transforms?.(), openDialog: (name, args) => ctx.openDialog(name, args), ui } : { run: () => false });
    ui.labelTables(node);
    bind?.(node, ctx);
    // ผู้อื่นบันทึกข้อมูลไปแล้ว: รวมตอนนี้ (เหมือนท้าย renderBom · ยังเปิดฟอร์มค้างอยู่ store ไม่รวมให้)
    if (store.hasNewer?.()) store.catchUp();
    return undefined;
  }

  // หน้าแรกของแผนกที่มีงานผลิต (GR PT BG PK): การ์ดงานของแผนกนั้นที่ยังเปิดอยู่ (แท็บ "เสร็จแล้ว" ดูย้อนหลัง) ใช้การ์ดกลางและ dialog รายงานผล/พัก/ปิดงานชุดเดียวกับ BOM "งานของฉัน"
  // ปุ่มที่เห็นตามสิทธิ์ของผู้ใช้จริง (jobCard ถามตัวช่วยของ BOM) · คืน landing สำหรับ registerDeptModule
  const LIVE_ORDER = Object.freeze(["released", "in_progress", "completed"]);
  function productionJobs(ctx, dept) {
    const { data } = ctx;
    const orderOf = (id) => data.orders.find((entry) => entry.id === id);
    const mine = data.jobs.filter((job) => job.dept === dept && LIVE_ORDER.includes(orderOf(job.orderId)?.status));
    return { orderOf, open: mine.filter((job) => ctx.helpers.isOpenJob(data, job)), done: mine.filter((job) => job.status === "done") };
  }
  // opts.cards(ctx) = การ์ดงานอื่นของแผนก (HTML) ที่วางหน้าการ์ดงานผลิตในหน้า "งานของฉัน" และนับรวมในตัวเลขที่เมนู (เช่น PK: รับงานจาก GR)
  function productionLanding(dept, opts = {}) {
    const extraCards = (ctx) => { try { return typeof opts.cards === "function" ? opts.cards(ctx) ?? [] : []; } catch { return []; } };
    const landing = function landing(ctx) {
      const { ui } = ctx;
      const show = ctx.view?.id === "done" ? "done" : "open";
      const { orderOf, open, done } = productionJobs(ctx, dept);
      // กำลังทำก่อน พักไว้ท้าย แล้วตามกำหนดส่ง (เหมือนหน้า "งานของฉัน")
      const rank = (job) => (job.status === "in_progress" ? 0 : job.status === "hold" ? 2 : 1);
      const list = (show === "done" ? done : open).slice().sort((a, b) => rank(a) - rank(b) || (Number(a.dueAt) || 0) - (Number(b.dueAt) || 0) || String(a.id).localeCompare(String(b.id)));
      const extra = show === "open" ? extraCards(ctx) : [];
      const cards = [...extra, ...list.map((job) => jobCard(ctx, job, { planner: false, dept, show, orderOf }))];
      const body = cards.length ? `<div class="bom-job-grid">${cards.join("")}</div>` : ui.card(ui.empty(show === "done" ? "ยังไม่มีงานที่เสร็จ" : `ไม่มีงานของ ${dept} ค้างอยู่`));
      // หัวหน้า = ชื่อหน้าในเมนูข้าง (งานของฉัน / เสร็จแล้ว) · ข้อความสถานะการบันทึก (module-bom.js เติมให้ระหว่างบันทึก)
      return { html: `${viewHead(ctx)}${body}`, actions: true };
    };
    // เมนูข้าง: งานของฉัน (ตัวเลข = งานที่เปิดอยู่ + การ์ดอื่นของแผนก) · เสร็จแล้ว
    landing.menu = Object.freeze([workItem((ctx) => productionJobs(ctx, dept).open.length + extraCards(ctx).length), { id: "done", label: "เสร็จแล้ว", icon: "check", params: { st: "done" } }]);
    return landing;
  }

  // การ์ดงานผลิตของแผนกวางในหน้าของโมดูลอื่นที่ไม่ได้ลงทะเบียนผ่านตัวนี้ (RubberFlow = แผนก RB): การ์ดชุดเดียวกับ BOM "งานของฉัน" (workBoard + boardCards ไม่คัดลอก HTML)
  // slot = ช่องว่างที่หน้านั้นวางไว้ (ต้องไม่อยู่ในส่วนที่ตัวผูก data-rf-* ของหน้านั้นผูกไปแล้ว: เรียกหลังหน้านั้นผูกเสร็จ ปุ่มของการ์ดจึงผูกครั้งเดียวด้วยคำสั่งและ dialog ของ BOM)
  // รายการและปุ่มตามผู้ใช้ BOM คนเดียวกับหน้า BOM (ฝ่ายวางแผนเห็นงานของแผนกนั้นพร้อมปิดงาน · แผนก dept ลงมือได้ · แผนกอื่นไม่มีการ์ด) · นอกโหมดทดสอบหรือ BOM ไม่พร้อม = ไม่แสดงอะไร
  // คืน true = หน้านั้นแสดงข้อมูลของ BOM (กำลังโหลด หรือมีรายการ หรือว่าง): module-bom.js จึงวาดหน้านั้นใหม่เมื่อ store ของ BOM เปลี่ยน (บันทึกสำเร็จ ย้อนกลับ โหลดเสร็จ) · false = ไม่เกี่ยวกับ BOM
  function mountDeptJobs(slot, dept, { title = "งานจากใบสั่งผลิต (BOM)" } = {}) {
    const employee = state.employee;
    const bom = root.MNP_BOM;
    const hub = root.MNP_BOM_PAGES?.hub;
    if (!slot || employee?.isSandbox !== true || !bomGate(employee) || !bom?.store || !hub?.workBoard || !hub?.boardCards) return false;
    const { store } = bom;
    // ตัดสินจากผู้ใช้ BOM ก่อนโหลด (กติกาเดียวกับ workBoard: ฝ่ายวางแผน/ผู้จัดการ หรือพนักงานแผนก dept): คนอื่นไม่มีการ์ดจึงไม่สั่งโหลด BOM และไม่ให้ module-bom วาดหน้าใหม่ให้
    const who = store.user?.();
    if (!who || !(["admin", "manager", "planner"].includes(who.role) || who.dept === dept)) { slot.remove?.(); return false; }
    store.ensureLoaded();
    const status = store.status();
    if (status !== "ready") {
      if (status === "error") { slot.remove?.(); return false; }
      slot.innerHTML = '<p class="small muted" role="status">กำลังโหลดงานจากใบสั่งผลิต (BOM)…</p>';
      return true;
    }
    const ui = root.MNP_RUBBERFLOW_UI;
    const ctx = bom.context(new URLSearchParams());
    const board = hub.workBoard(ctx, new URLSearchParams({ dept }));
    if (board.dept !== dept) { slot.remove?.(); return false; }
    const { cards } = hub.boardCards(ctx, board);
    if (!cards.length) { slot.remove?.(); return true; }
    bom.clearEditing?.(); // หน้าใหม่ = ไม่มีฟอร์มที่แก้ค้างจากหน้า BOM ก่อนหน้า
    slot.innerHTML = `<div class="rf-row"><h2 class="bom-h3">${esc(title)}</h2><span class="small muted" role="status" data-bom-sync>${esc(bom.syncText?.() ?? "")}</span></div><div class="bom-job-grid">${cards.join("")}</div>`;
    bindRoot(slot, ctx, { run: ctx.runAction, transforms: bom.transforms?.(), openDialog: (name, args) => bom.openDialog(name, args, ctx), ui });
    return true;
  }

  // def = { code, dept, route, label, icon, palette, landing(ctx), pages?, guest? }
  // code เช่น "FACTORY_SR" (ไม่ชนโมดูลอื่น) · dept = รหัสแผนกใน rules.PROCESS_FLOW · route = path ของหน้าแรก (#/sr) · icon = ชื่อไอคอนใน MNP_UI_ICONS
  // keep = ชื่อพารามิเตอร์ตัวกรองของโมดูลที่ ctx.pageUrl พาไปด้วย · menu[].owns = พารามิเตอร์ที่ทำให้หน้าเป็นของรายการเมนูนั้น
  // landing(ctx) คืน { html, bind?, actions? } (actions: true = ผูกคำสั่งและ dialog ของ BOM ให้การ์ดสั่งงานได้) · ctx = ctx ของ BOM (data, rules, ui, helpers, url, user, q, params, runAction, openDialog) + pageUrl ของหน้านี้ + factory (def) · pages = หน้าเพิ่มเติมของแผนก { path: (params) => … } ผ่านประตูเดียวกัน
  function registerDeptModule(def) {
    const { code, dept, route, label, icon, palette, landing, pages = {}, flowNo, keep = [] } = def;
    // เมนูข้างของโมดูล: def.menu หรือของ landing (productionLanding) ไม่มี = "งานของฉัน" อันเดียว
    const menu = Object.freeze([...(def.menu ?? landing?.menu ?? WORK_MENU)]);
    if (!code || !dept || !route || !label || typeof landing !== "function") throw new Error("registerDeptModule: code, dept, route, label และ landing จำเป็น");
    const modules = (root.MNP_REQUEST_MODULES ??= {});
    if (modules[code]) throw new Error(`registerDeptModule: โมดูล ${code} ลงทะเบียนแล้ว`);
    const flow = flowNo ?? root.MNP_BOM_RULES?.PROCESS_FLOW?.find((entry) => entry.dept === dept)?.no;
    // guest(employee) = โหมดผู้เข้าชมของแผนกอื่น (ไม่อยู่ในเมนู เข้าทางลิงก์) · ไม่ให้ = เฉพาะผู้ที่เปิดโมดูลได้
    const factory = Object.freeze({ code, dept, route, label, icon, palette, menu, keep: Object.freeze([...keep]), guest: typeof def.guest === "function" ? def.guest : null });
    const guarded = (page) => (params) => (!mayOpen(factory, state.employee) ? renderNotFound() : page(params));
    ROUTES.add(route);
    const extra = Object.fromEntries(Object.entries(pages).map(([path, page]) => { ROUTES.add(path); return [path, guarded(page)]; }));
    modules[code] = {
      code, enabled: true, standalone: true, sandbox: true, label, palette, dept,
      navAllowed: (employee) => canOpenDeptModule(employee, dept, code),
      nav: [{ path: route, label, icon: iconHtml(icon), sandboxOnly: true, group: FACTORY_GROUP, ...(flow === undefined ? {} : { flowNo: flow }), subnav: (active) => deptSubnav(factory, active) }],
      pages: { [route]: (params) => renderLanding(factory, params, landing), ...extra },
    };
    return modules[code];
  }

  root.MNP_FACTORY = Object.freeze({
    esc, attr, formPayload, parseArgs, bindRoot, deptChip, dueText, jobCard, jobReportDialog, cardTitle, cardClass,
    FACTORY_GROUP, canSeeDept, canOpenDeptModule, deptLink, orderNavItems, registerDeptModule, productionLanding, mountDeptJobs,
    pageHead, searchForm, includesText, limited, deptWork, deptWorkSection, storeLanding, STORE_MENU, workItem, deptWorkCount, viewHead, actionLink, wake, failed, rubberflowFailed, deptCtx, routeUrl, onDeptRoute: onFactoryRoute,
  });
})(window);
