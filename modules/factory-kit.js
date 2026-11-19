// ชุดชิ้นส่วนกลางของโมดูลโรงงาน (window.MNP_FACTORY) — ยกจาก BOM มาให้ทุกแผนกเรียกใช้ร่วมกัน ไม่มีสำเนาที่สองใน BOM
// มี: ตัวผูก event ตามกติกา data-rf-* (bindRoot) · formPayload / parseArgs · การ์ดงานผลิต (jobCard) · dialog รายงานผล (jobReportDialog) · ป้ายแผนก (deptChip)
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
    // งาน GR: แท่งที่คลังแท่งยาว (SR) จ่ายให้ใบนี้แล้ว ต่อเส้นยางที่ชิ้นงานนี้ใช้ (rules.rodIssueNeeds)
    const rodLine = job.dept === "GR" && job.status !== "done" ? rules.rodIssueNeeds(data, job.orderId).filter((need) => need.grJobs.some((entry) => entry.id === job.id))
      .map((need) => `<p class="small muted" title="${attr(`${need.itemCode} · GR ต้องใช้ ${rules.fmtQty(need.need)} ${uomText(ctx, need.uom)}`)}">${esc(`แท่งจาก SR ${rules.fmtQty(need.issued)}/${rules.fmtQty(need.need)} ${uomText(ctx, need.uom)}`)}</p>`).join("") : "";
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

  root.MNP_FACTORY = Object.freeze({ esc, attr, formPayload, parseArgs, bindRoot, deptChip, dueText, jobCard, jobReportDialog });
})(window);
