// หน้าของโมดูลแปรรูปยาง (GR) #/gr — โหลดก่อน modules/module-gr.js (ดู index.html) · โรงงาน ขั้น 2 (20261216010000_bom_gr_module.sql) โหมดทดสอบเท่านั้น
// เมนูข้าง: งานของฉัน (ค่าตั้งต้น · ตัวกรอง ?st=done = เสร็จแล้ว) · บันทึกผลรายวัน ?tab=log · ยางเส้นยาว ?tab=rods · ส่งให้ PK ?tab=pk · สรุปผล ?tab=summary
// · ตั้งค่าขั้นตอนและเป้า ?tab=settings (เฉพาะหัวหน้าแผนก GR และฝ่ายวางแผน) · หน้างาน ?job=<เลขงาน> (อยู่ใต้ "งานของฉัน")
// ข้อมูลและคำสั่งมาจาก store ของ BOM (grConfig grPlans grRecords rodRequests grHandovers grWorkers · คำสั่งใน modules/bom-actions.js) · กฎกลางใน modules/bom-rules.js (gr*)
// การ์ด "รับจาก GR" ของโมดูล PK (pkCards) อยู่ที่นี่ด้วย (ข้อมูลชุดเดียวกัน) · การ์ดคำขอเบิกของ SR อยู่ใน modules/bom-hub.js (rodTasks)
// การซ่อน/แสดงปุ่มเป็นแค่ UX สิทธิ์จริงตัดสินที่ action และฐานข้อมูล · ไม่มีจำนวนเงินในรอบนี้ (คำตอบเจ้าของข้อ 4)
(function registerGrPages(root) {
  const F = root.MNP_FACTORY;
  const dialogs = (root.MNP_BOM_DIALOGS ??= {});
  const ROUTE = "gr";
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const num = (value) => Number(value) || 0;
  const grUrl = (query = {}) => F.routeUrl(ROUTE, query);
  const jobHref = (jobId) => grUrl({ job: jobId });
  const logHref = (jobId) => grUrl({ tab: "log", j: jobId });
  const backLink = (href, text) => `<a class="request-back-link" href="${attr(href)}">${esc(text)}</a>`;
  const rowAttr = (href, extra = "") => { const names = [href ? "row-link" : "", extra].filter(Boolean).join(" "); return names ? ` class="${names}"` : ""; };
  const mainLink = (ctx, text, href, cls = "") => ctx.ui.link(text, href, [cls, "row-link-main"].filter(Boolean).join(" "));
  const dash = '<span class="muted">—</span>';
  const syncLine = () => `<span class="small muted" role="status" data-bom-sync>${esc(root.MNP_BOM?.syncText?.() ?? "")}</span>`;
  const LIVE = Object.freeze(["released", "in_progress", "completed"]);
  const ACTIVE = Object.freeze(["released", "in_progress"]);
  const READ_ONLY = '<p class="small muted">ดูอย่างเดียว บัญชีนี้ไม่มีสิทธิ์ดำเนินการ</p>';
  const uomText = (ctx, code) => ctx.rules.uomLabel(code);
  const orderOf = (ctx, id) => ctx.data.orders.find((order) => order.id === id) ?? null;
  const isActive = (ctx, job) => ACTIVE.includes(orderOf(ctx, job?.orderId)?.status);
  // วันที่ทำงาน YYYY-MM-DD → วันที่ไทย (เที่ยงวันเวลาไทย กันวันเลื่อน)
  const dayText = (ctx, day) => (day ? ctx.rules.fmtDate(Date.parse(`${day}T12:00:00+07:00`)) : "");

  // ---------- สิทธิ์ (UX เท่านั้น · ตัวช่วยเดียวกับ action) ----------
  const canLead = (ctx) => Boolean(ctx.helpers.canGrLead?.(ctx.user));
  const canRecord = (ctx) => Boolean(ctx.helpers.canGrRecord?.(ctx.user));

  // ---------- งานของ GR ----------
  // งานของใบที่ปล่อยผลิตแล้ว · ยังเปิด = งานที่ยังไม่เสร็จ หรือเสร็จแล้วแต่ยังมีของดีที่ยังไม่ได้ส่ง PK (ส่งได้อีก) · เสร็จแล้ว = ที่เหลือที่ปิดงานแล้ว
  function grJobs(ctx) {
    const { data, rules } = ctx;
    const all = data.jobs.filter((job) => job.dept === "GR" && LIVE.includes(orderOf(ctx, job.orderId)?.status));
    const unsent = (job) => isActive(ctx, job) && rules.grHandoverSummary(data, job).waitingAtGr > 0;
    const rank = (job) => (job.status === "in_progress" ? 0 : job.status === "hold" ? 2 : job.status === "done" ? 3 : 1);
    const sort = (list) => list.sort((a, b) => rank(a) - rank(b) || num(a.dueAt) - num(b.dueAt) || String(a.id).localeCompare(String(b.id)));
    return {
      all,
      open: sort(all.filter((job) => ctx.helpers.isOpenJob(data, job) || (job.status === "done" && unsent(job)))),
      done: sort(all.filter((job) => job.status === "done" && !unsent(job))),
    };
  }
  const workCount = (ctx) => grJobs(ctx).open.length;
  // งานที่ผู้ใช้บันทึกผลได้ตอนนี้ (ตั้งขั้นตอนแล้ว และ grJobBlock ไม่มีเหตุห้าม)
  const recordableJobs = (ctx) => grJobs(ctx).all.filter((job) => ctx.helpers.isGrPlanned?.(ctx.data, job) && !ctx.helpers.grJobBlock?.(ctx.data, job, ctx.user));
  // ตั้งขั้นตอนได้: หัวหน้า GR / ฝ่ายวางแผน · ใบกำลังผลิต · งานยังไม่เสร็จ · ไม่เคยรายงานยอดแบบเดิม (ยกเว้นตั้งไว้แล้ว = แก้ได้)
  const canSetSteps = (ctx, job) => canLead(ctx) && isActive(ctx, job) && job.status !== "done"
    && (ctx.helpers.isGrPlanned?.(ctx.data, job) || !(num(job.qtyDone) > 0 || num(job.qtyReject) > 0));
  // ยางเส้นยาวของงาน: [{ code, need (rules.rodIssueNeeds ของใบ × รหัส หรือ null), open: คำขอที่ยังเปิดของงานนี้ }]
  function rodsOfJob(ctx, job) {
    const { data, rules } = ctx;
    const order = orderOf(ctx, job.orderId);
    const needs = ACTIVE.includes(order?.status) ? rules.rodIssueNeeds(data, order.id) : [];
    const open = rules.grOpenRequests(data, { jobId: job.id });
    return rules.grRodCodesOf(order, job).map((code) => ({ code, need: needs.find((need) => need.itemCode === code) ?? null, open: open.filter((entry) => entry.request.itemCode === code) }));
  }
  const canRequestRods = (ctx, job) => canRecord(ctx) && isActive(ctx, job) && job.status !== "done";

  // ---------- การ์ดงาน (การ์ดกลาง MNP_FACTORY.jobCard + ความคืบหน้ารายขั้น) ----------
  // ตั้งขั้นตอนแล้ว: บรรทัดยอดของการ์ดเป็นรายขั้น (ทำแล้ว/ต้องทำ) · ปุ่มหลัก "บันทึกผล" พาไปหน้าบันทึกผลรายวันพร้อมงานนี้
  // ปุ่มรอง: ขอเบิกยางเส้นยาว (ยังต้องใช้และยังไม่มีคำขอที่เปิดอยู่) · ส่งให้ PK (มีของดีที่ยังไม่ได้ส่ง) · ยังไม่ตั้งขั้นตอน = การ์ดกลางให้ปุ่ม "ตั้งขั้นตอน" เอง
  function stepList(ctx, progress) {
    const { rules } = ctx;
    const last = progress.steps.length - 1;
    return `<ul class="bom-job-parts gr-steps">${progress.steps.map((step, index) => `<li class="${step.done ? "is-done" : ""}" title="${attr(`${step.name}: เสีย ${rules.fmtQty(step.reject)} · ${rules.fmtQty(step.hours)} ชม.${index === last ? " · ขั้นสุดท้าย ยอดดีของขั้นนี้เป็นยอดของงาน" : ""}`)}"><span>${esc(step.name)}</span><span class="nowrap rf-mono">${esc(`${rules.fmtQty(step.good)}/${rules.fmtQty(step.qtyTarget)}`)}</span></li>`).join("")}</ul>`;
  }
  function grCard(ctx, job, show) {
    const { data, rules, ui } = ctx;
    const progress = rules.grJobProgress(data, job);
    const href = jobHref(job.id);
    const more = [];
    const rods = rodsOfJob(ctx, job);
    const wantRods = rods.some((row) => !row.open.length && (row.need?.remaining ?? 0) > 1e-9);
    if (canRequestRods(ctx, job) && wantRods) more.push(ui.openButton("ขอเบิกยางเส้นยาว", "grRodRequest", { jobId: job.id }, { className: "secondary small" }));
    if (canLead(ctx) && isActive(ctx, job) && progress.waitingAtGr > 0) more.push(ui.openButton("ส่งให้ PK", "grSendPk", { jobId: job.id }, { className: "secondary small" }));
    const asked = rods.flatMap((row) => row.open).map((entry) => `<p class="small muted">${esc(`ขอเบิก ${entry.request.itemCode} รอ SR จ่าย ${rules.fmtQty(entry.remaining)}`)}</p>`).join("");
    const unsent = progress.waitingAtGr > 0 ? `<p class="small muted" title="ของดีที่ GR ยังไม่ได้ส่งให้ PK">${esc(`ยังไม่ได้ส่ง PK ${rules.fmtQty(progress.waitingAtGr)} ${uomText(ctx, job.uom)}`)}</p>` : "";
    const opts = { planner: false, dept: "GR", show, href, more, extra: `${asked}${unsent}` };
    if (progress.planned) {
      const block = ctx.helpers.grJobBlock?.(data, job, ctx.user);
      opts.body = stepList(ctx, progress);
      opts.main = canRecord(ctx) && !block ? ui.link("บันทึกผล", logHref(job.id), "btn rf-btn bom-job-main") : "";
    }
    return F.jobCard(ctx, job, opts);
  }
  function workView(ctx) {
    const { ui } = ctx;
    const show = ctx.params.get("st") === "done" ? "done" : "open";
    const jobs = grJobs(ctx);
    const list = show === "done" ? jobs.done : jobs.open;
    const body = list.length ? `<div class="bom-job-grid">${list.map((job) => grCard(ctx, job, show)).join("")}</div>` : ui.card(ui.empty(show === "done" ? "ยังไม่มีงานที่เสร็จ" : "ไม่มีงานของ GR ค้างอยู่"));
    // ลิงก์ตัวกรองแทนรายการเมนู "เสร็จแล้ว" (เมนูข้างของ GR มีหกรายการแล้ว) · จำนวนงานที่ค้างอยู่ที่เมนูข้าง "งานของฉัน" แล้ว จึงไม่ซ้ำที่ลิงก์
    const head = show === "done"
      ? F.pageHead(ctx, "เสร็จแล้ว", `${ui.link("งานที่ยังไม่เสร็จ", grUrl({}), "btn rf-btn secondary small")}${syncLine()}`)
      : F.viewHead(ctx, ui.link("เสร็จแล้ว", grUrl({ st: "done" }), "btn rf-btn secondary small"));
    return `${head}${body}`;
  }

  // ---------- ตารางผลรายวัน (หน้าบันทึกผล หน้างาน สรุปผล) ----------
  function recordHead({ showWorker = true, actions = true } = {}) {
    return ["วันที่", ...(showWorker ? ["ผู้ทำ"] : []), "ขั้นตอน", { label: "ชม.", className: "right", title: "ชั่วโมงทำงาน (จำนวนคนบอกใต้ตัวเลขเมื่อมากกว่า 1)" }, { label: "ดี", className: "right" }, { label: "เสีย", className: "right" },
      { label: "% สำเร็จ", className: "right", title: "ดี ÷ ต้องทำ · ต้องทำ = ชั่วโมง × เป้าชิ้นต่อชั่วโมง × 0.95 (เฉพาะชิ้นงานและขั้นที่ตั้งเป้าไว้)" }, ...(actions ? [{ label: "", className: "right" }] : [])];
  }
  const percentCell = (ctx, percent) => (percent === null ? dash : percent >= 100 ? ctx.ui.badge("good", `${ctx.rules.fmtQty(percent)}%`) : esc(`${ctx.rules.fmtQty(percent)}%`));
  function recordRows(ctx, records, { showJob = true, showWorker = true, actions = true } = {}) {
    const { ui, rules, data, user } = ctx;
    const config = rules.grConfig(data);
    return records.map((record) => {
      const voided = record.status !== "active";
      const need = rules.grRequired(record.hours, rules.grTarget(config, record.itemCode, record.stepCode));
      const percent = voided ? null : rules.grPercent(record.good, need);
      const edits = (record.edits ?? []).filter((entry) => entry.kind === "edit");
      const last = edits.at(-1);
      const edited = edits.length ? `<div class="small muted" title="${attr(`แก้ไขล่าสุดโดย ${last.by ?? ""} ${rules.fmtDateTime(last.at)}: ${last.reason ?? ""}`)}">${esc(`แก้ไขแล้ว ${edits.length} ครั้ง`)}</div>` : "";
      const voidNote = voided ? `<div class="small muted">${esc(`ยกเลิก: ${record.voidReason ?? ""}`)}</div>` : "";
      const where = showJob ? `<div class="small muted">${ui.link(`${record.itemCode} · ใบ ${record.orderId}`, jobHref(record.jobId))}</div>` : "";
      const who = `${record.workDate} ${record.workerName ?? ""}`.trim();
      const buttons = actions && !ctx.helpers.grRecordBlock?.(data, user, record, ctx.now)
        ? `${ui.openButton("แก้ไข", "grRecordEdit", { recordId: record.id }, { className: "secondary small", ariaLabel: `แก้ไขผล ${who}` })}${ui.openButton("ยกเลิก", "grRecordVoid", { recordId: record.id }, { className: "secondary small", ariaLabel: `ยกเลิกผล ${who}` })}` : "";
      const qty = (value) => (voided ? `<s>${esc(rules.fmtQty(value))}</s>` : esc(rules.fmtQty(value)));
      return `<tr${voided ? ' class="muted"' : ""}><td class="nowrap small">${esc(dayText(ctx, record.workDate))}</td>${showWorker ? `<td>${esc(record.workerName || record.workerId)}</td>` : ""}<td>${esc(rules.grStepName(config, record.stepCode))}${voided ? ` ${ui.badge("", "ยกเลิกแล้ว")}` : ""}${where}${record.note ? `<div class="small muted">${esc(record.note)}</div>` : ""}${edited}${voidNote}</td>`
        + `<td class="right rf-mono">${esc(rules.fmtQty(record.hours))}${num(record.people) > 1 ? `<div class="small muted">${esc(`${record.people} คน`)}</div>` : ""}</td><td class="right rf-mono">${qty(record.good)}</td><td class="right rf-mono">${qty(record.reject)}${record.reason ? `<div class="small muted">${esc(record.reason)}</div>` : ""}</td><td class="right">${percentCell(ctx, percent)}</td>${actions ? `<td class="right nowrap">${buttons}</td>` : ""}</tr>`;
    });
  }
  const byNewest = (a, b) => String(b.workDate).localeCompare(String(a.workDate)) || num(b.createdAt) - num(a.createdAt) || String(b.id).localeCompare(String(a.id));
  const filterSelect = (ctx, name, label, options, value, placeholder) => `<div class="field rf-field sr-filter"><label class="sr-only" for="gr-${name}">${esc(label)}</label>${ctx.ui.select(name, options, { value, placeholder, id: `gr-${name}`, extra: `data-gr-filter title="${attr(label)}"` })}</div>`;

  // ---------- บันทึกผลรายวัน ----------
  // ฟอร์มใหญ่สำหรับมือถือ: วันที่ (ค่าเริ่ม วันนี้) · ผู้ทำ (พนักงาน = ตัวเอง · หัวหน้า / ฝ่ายวางแผนเลือกจากพนักงาน GR: ค่าเริ่ม = ตัวเองเฉพาะเมื่ออยู่ในรายชื่อ ไม่งั้นว่างและต้องเลือก) · งาน · ขั้นตอน (ของงานนั้น) · ชั่วโมง · คน (ค่าเริ่ม 1) · ดี · เสีย + เหตุผล (เมื่อมีของเสีย) · หมายเหตุ
  // เป้าของชิ้นงาน × ขั้น (ถ้ามี) บอกต้องทำและ % ขณะกรอก (bindRecordForm) · action ตรวจกติกาซ้ำทั้งหมด
  // ตัวเลือกผู้ทำ = พนักงานแผนก GR (grWorkers · ชุดเดียวกับที่ฐานข้อมูลตรวจ) + ผู้ทำเดิมของผลที่แก้ (คงไว้ได้โดยไม่ตรวจซ้ำ) · ผู้ใช้ที่ไม่อยู่ในรายชื่อไม่ถูกเติมเข้าไป
  // ชุด grWorkers / grRecords / grHandovers มีของแผนก PT / BG / PK ด้วยตั้งแต่ 20261224010000: หน้าของ GR อ่านเฉพาะของ GR (rules.stepWorkers / recordDept / handoverFrom)
  const grWorkerRows = (ctx) => (ctx.rules.stepWorkers ? ctx.rules.stepWorkers(ctx.data, "GR") : ctx.data.grWorkers ?? []);
  const grRecordRows = (data, rules) => (data.grRecords ?? []).filter((record) => !rules.recordDept || rules.recordDept(data, record) === "GR");
  const grSendRows = (data, rules) => (data.grHandovers ?? []).filter((row) => !rules.handoverFrom || (rules.handoverFrom(row) === "GR" && rules.handoverTo(row) === "PK"));
  const isGrWorker = (ctx, id) => grWorkerRows(ctx).some((row) => row.id === id);
  function workerOptions(ctx, extra = null) {
    const list = [...grWorkerRows(ctx)];
    if (extra?.id && !list.some((row) => row.id === extra.id)) list.unshift({ id: extra.id, name: extra.name });
    return list.map((row) => ({ value: row.id, label: row.name || row.id }));
  }
  const planSteps = (ctx, job) => (ctx.rules.grPlanOf(ctx.data, job.id)?.steps ?? []).map((step) => [step.code, ctx.rules.grStepName(ctx.rules.grConfig(ctx.data), step.code)]);
  const targetMap = (ctx, jobs) => {
    const config = ctx.rules.grConfig(ctx.data);
    const map = {};
    for (const job of jobs) for (const [code] of planSteps(ctx, job)) { const per = ctx.rules.grTarget(config, job.itemCode, code); if (per) map[`${job.id}|${code}`] = per; }
    return map;
  };
  const jobLabel = (job) => `${job.name} · ${job.itemCode} · ใบ ${job.orderId}`;
  function recordFields(ctx, { jobs, job, record = null }) {
    const { ui, rules } = ctx;
    const config = rules.grConfig(ctx.data);
    const lead = canLead(ctx);
    const today = rules.grDay(ctx.now);
    const steps = job ? planSteps(ctx, job) : [];
    const stepValue = record?.stepCode ?? (steps.length === 1 ? steps[0][0] : "");
    const reject = num(record?.reject);
    const prefix = record ? "gr-edit" : "gr-rec";
    const jobField = record ? "" : ui.field("งาน", ui.select("jobId", jobs.map((row) => ({ value: row.id, label: jobLabel(row) })), { value: job?.id ?? "", placeholder: jobs.length === 1 ? null : "เลือกงาน", id: `${prefix}-job`, extra: "required data-gr-job" }), { id: `${prefix}-job`, required: true });
    const stepField = ui.field("ขั้นตอน", ui.select("stepCode", steps.map(([value, label]) => ({ value, label })), { value: stepValue, placeholder: "เลือกขั้นตอน", id: `${prefix}-step`, extra: "required data-gr-step" }), { id: `${prefix}-step`, required: true });
    const dateField = ui.field("วันที่ทำงาน", ui.input("workDate", { type: "date", value: record?.workDate ?? today, max: today, min: lead ? "" : rules.grDay(ctx.now, -1), id: `${prefix}-date`, required: true, extra: `title="${attr(lead ? "ไม่เกินวันนี้" : "วันนี้หรือเมื่อวาน")}"` }), { id: `${prefix}-date`, required: true });
    const workerValue = record?.workerId ?? (isGrWorker(ctx, ctx.user?.id) ? ctx.user.id : "");
    const workerField = lead ? ui.field("ผู้ทำ", ui.select("workerId", workerOptions(ctx, record ? { id: record.workerId, name: record.workerName } : null), { value: workerValue, placeholder: workerValue ? null : "เลือกผู้ทำ", id: `${prefix}-worker`, extra: "required" }), { id: `${prefix}-worker`, required: true }) : "";
    const number = (name, label, value, opts) => ui.field(label, ui.input(name, { type: "number", value, id: `${prefix}-${name}`, ...opts }), { id: `${prefix}-${name}`, required: Boolean(opts.required) });
    const reasonField = `<div class="field rf-field" data-gr-reason${reject > 0 ? "" : " hidden"}><label for="${prefix}-reason">เหตุผลของเสีย <span class="field-required">(จำเป็น)</span></label>${ui.select("reason", config.reasons, { value: record?.reason ?? "", placeholder: "เลือกเหตุผล", id: `${prefix}-reason`, extra: "required" })}</div>`;
    return `<div class="rf-grid rf-g2 gr-record-grid">${jobField}${stepField}${dateField}${workerField}
      ${number("hours", "ชั่วโมงทำงาน", record?.hours ?? "", { step: "any", min: 0.01, max: rules.GR_LIMITS.hours, required: true, placeholder: "เช่น 8", extra: "data-gr-hours" })}
      ${number("people", "จำนวนคน", record?.people ?? 1, { step: 1, min: 1, max: rules.GR_LIMITS.people, required: true })}
      ${number("good", "จำนวนดี (ชิ้น)", record?.good ?? "", { step: 1, min: 0, max: rules.GR_LIMITS.qty, placeholder: "0", extra: "data-gr-good" })}
      ${number("reject", "จำนวนเสีย (ชิ้น)", record ? reject : 0, { step: 1, min: 0, max: rules.GR_LIMITS.qty, extra: "data-gr-reject" })}
      ${reasonField}
      ${ui.field("หมายเหตุ", ui.input("note", { value: record?.note ?? "", id: `${prefix}-note`, placeholder: "ถ้ามี", extra: `maxlength="${rules.GR_LIMITS.note}"` }), { id: `${prefix}-note` })}</div>
      <p class="small muted gr-target-line" data-gr-target role="status" aria-live="polite"></p>`;
  }
  function recordForm(ctx) {
    const { ui } = ctx;
    if (!canRecord(ctx)) return "";
    const jobs = recordableJobs(ctx);
    if (!jobs.length) return ui.card(ui.empty("ยังไม่มีงานที่บันทึกผลได้ (งานต้องตั้งขั้นตอนก่อน และใบสั่งผลิตต้องอยู่ในสถานะผลิต)"));
    const job = jobs.find((row) => row.id === ctx.params.get("j")) ?? (jobs.length === 1 ? jobs[0] : null);
    const plans = Object.fromEntries(jobs.map((row) => [row.id, planSteps(ctx, row)]));
    return `<form novalidate class="card rf-card gr-record-form" data-rf-form="addGrRecord" data-rf-success="บันทึกผล {result} แล้ว" data-gr-plans="${attr(JSON.stringify(plans))}" data-gr-targets="${attr(JSON.stringify(targetMap(ctx, jobs)))}">
      <div class="rf-card-body">${recordFields(ctx, { jobs, job })}<div class="rf-row bom-step-next"><button class="btn rf-btn" type="submit">บันทึกผล</button></div></div></form>`;
  }
  function logView(ctx) {
    const { ui, data, rules, user } = ctx;
    const lead = canLead(ctx);
    const all = grRecordRows(data, rules).slice().sort(byNewest);
    if (!lead) {
      // พนักงาน: ผลของตัวเองวันนี้และเมื่อวาน (แก้ / ยกเลิกได้เฉพาะที่บันทึกวันนี้)
      const since = rules.grDay(ctx.now, -1);
      const mine = all.filter((record) => record.workerId === user?.id && (String(record.workDate) >= since || rules.grDay(record.createdAt) === rules.grDay(ctx.now)));
      const list = canRecord(ctx) ? ui.card(ui.table(recordHead({ showWorker: false }), recordRows(ctx, mine, { showWorker: false }), { emptyText: "ยังไม่มีผลของวันนี้และเมื่อวาน" }), { title: esc("ผลของฉัน วันนี้และเมื่อวาน"), flush: true }) : "";
      return `${recordForm(ctx)}${list}`;
    }
    // หัวหน้า / ฝ่ายวางแผน: ทุกผล ใหม่ก่อน กรองตามวัน ผู้ทำ ขั้นตอน · ทีละ 100 แถว
    const config = rules.grConfig(data);
    const day = ctx.params.get("day") ?? "";
    const worker = ctx.params.get("w") ?? "";
    const step = ctx.params.get("s") ?? "";
    const list = all.filter((record) => (!day || record.workDate === day) && (!worker || record.workerId === worker) && (!step || record.stepCode === step));
    const { shown, more } = F.limited(ctx, list);
    const days = [...new Set(all.map((record) => record.workDate))].sort().reverse().map((value) => ({ value, label: dayText(ctx, value) }));
    const workers = [...new Map(all.map((record) => [record.workerId, record.workerName || record.workerId])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "th")).map(([value, label]) => ({ value, label }));
    const steps = config.steps.map((row) => ({ value: row.code, label: row.name }));
    const filtered = Boolean(day || worker || step);
    const toolbar = `<div class="rf-row sr-toolbar">${filterSelect(ctx, "day", "วันที่ทำงาน", days, day, "ทุกวัน")}${filterSelect(ctx, "w", "ผู้ทำ", workers, worker, "ทุกคน")}${filterSelect(ctx, "s", "ขั้นตอน", steps, step, "ทุกขั้นตอน")}${filtered ? ui.link("ล้างตัวกรอง", grUrl({ tab: "log" }), "btn rf-btn secondary small") : ""}</div>`;
    const table = ui.card(`${ui.table(recordHead(), recordRows(ctx, shown), { emptyText: filtered ? "ไม่พบผลที่ตรงกับตัวกรอง" : "ยังไม่มีผลรายวัน" })}${more}`, { title: esc("ผลที่บันทึก"), flush: true });
    return `${recordForm(ctx)}${toolbar}${table}`;
  }

  // ---------- ยางเส้นยาว ----------
  // ต่อ ใบ × เส้นยาง ที่งาน GR ยังต้องใช้: ได้จาก SR / ต้องใช้ · ล็อตที่ได้ (rules.grLotsIssued) · ปุ่มขอเบิก (เมื่อยังไม่มีคำขอที่เปิดอยู่)
  // คำขอทั้งหมด (ทีละ 100 แถว) เป็นที่เดียวที่แสดงคำขอ: สถานะ (รอ SR จ่าย / จ่ายครบ / ยกเลิก) + ปุ่มยกเลิกคำขอที่ยังเปิด · ยางเส้นยาวในคลัง SR (ตารางเดียวกับโมดูล SR แบบอ่านอย่างเดียว · window.MNP_SR.stockView)
  const requestState = (ctx, request) => ctx.rules.grRequestState(ctx.data, request);
  const canCancelRequest = (ctx, request) => request.status === "open" && (canLead(ctx) || request.createdById === ctx.user?.id);
  function lotList(ctx, orderId, code, uom) {
    const lots = ctx.rules.grLotsIssued(ctx.data, orderId, code);
    if (!lots.length) return dash;
    return `<ul class="gr-lots">${lots.map((lot) => `<li class="rf-mono" title="${attr(`${ctx.rules.fmtQty(lot.qty)} ${uomText(ctx, uom)} · ${ctx.rules.fmtDateTime(lot.at)} · ${lot.by ?? ""}`)}">${esc(lot.lotNo || lot.lotId)}</li>`).join("")}</ul>`;
  }
  function rodsView(ctx) {
    const { ui, rules, data } = ctx;
    const record = canRecord(ctx);
    const needs = rules.rodIssueNeeds(data).sort((a, b) => num(Math.min(...a.grJobs.map((job) => num(job.dueAt)))) - num(Math.min(...b.grJobs.map((job) => num(job.dueAt)))) || String(a.order.id).localeCompare(String(b.order.id)) || a.itemCode.localeCompare(b.itemCode));
    const open = rules.grOpenRequests(data);
    const rows = needs.map((need) => {
      const unit = uomText(ctx, need.uom);
      const asked = open.some((entry) => entry.request.orderId === need.order.id && entry.request.itemCode === need.itemCode);
      const job = need.grJobs.find((entry) => entry.status !== "done") ?? need.grJobs[0];
      // มีคำขอที่เปิดอยู่แล้ว: สถานะและปุ่มยกเลิกอยู่ในตารางคำขอ (ไม่แสดงซ้ำที่นี่)
      const action = !asked && record && job && canRequestRods(ctx, job) ? ui.openButton("ขอเบิก", "grRodRequest", { jobId: job.id, itemCode: need.itemCode }, { className: "small", ariaLabel: `ขอเบิกยางเส้นยาว ${need.itemCode} ใบ ${need.order.id}` }) : "";
      const href = job ? jobHref(job.id) : null;
      return `<tr${rowAttr(href)}><td>${href ? mainLink(ctx, need.order.id, href, "rf-mono") : ui.mono(need.order.id)}<div class="small muted">${esc(need.order.customer ?? "")}</div></td><td>${ui.mono(need.itemCode)}${need.name ? `<div class="small muted">${esc(need.name)}</div>` : ""}</td>`
        + `<td class="right rf-mono">${esc(`${rules.fmtQty(need.issued)}/${rules.fmtQty(need.need)} ${unit}`)}</td><td>${lotList(ctx, need.order.id, need.itemCode, need.uom)}</td><td class="right">${action}</td></tr>`;
    });
    const needsCard = ui.card(ui.table(["ใบสั่งผลิต", "เส้นยาง", { label: "ได้จาก SR / ต้องใช้", className: "right", title: "ยางเส้นยาวที่คลังยางเส้นยาว (SR) จ่ายให้ใบนี้แล้ว เทียบกับที่งาน GR ของใบต้องใช้" }, { label: "ล็อตที่ได้", title: "ชี้ที่เลขล็อตเพื่อดูจำนวนและเวลาที่ SR จ่าย" }, { label: "", className: "right" }], rows, { emptyText: "ไม่มีใบที่งาน GR ยังต้องใช้ยางเส้นยาว" }), { title: esc("ยางเส้นยาวของงานที่เปิดอยู่"), flush: true });
    const history = (data.rodRequests ?? []).slice().sort((a, b) => num(b.createdAt) - num(a.createdAt) || String(b.id).localeCompare(String(a.id)));
    const { shown, more } = F.limited(ctx, history);
    const LABEL = rules.GR_REQUEST_STATUS_LABEL;
    const historyRows = shown.map((request) => {
      const state = requestState(ctx, request);
      const tone = state.status === "open" ? "warn" : state.status === "covered" ? "good" : "";
      const detail = state.status === "cancelled" ? `${request.cancelledBy ?? ""}: ${request.cancelReason ?? ""}` : state.status === "open" && state.issued > 0 ? `จ่ายแล้ว ${rules.fmtQty(state.issued)}` : "";
      const cancel = state.status === "open" && canCancelRequest(ctx, request) ? ui.openButton("ยกเลิกคำขอ", "grRodCancel", { requestId: request.id }, { className: "secondary small", ariaLabel: `ยกเลิกคำขอ ${request.itemCode} ใบ ${request.orderId}` }) : "";
      return `<tr${state.status === "cancelled" ? ' class="muted"' : ""}><td class="nowrap small">${esc(rules.fmtDateTime(request.createdAt))}</td><td>${ui.link(request.orderId, jobHref(request.jobId), "rf-mono")}</td><td>${ui.mono(request.itemCode)}${request.note ? `<div class="small muted">${esc(request.note)}</div>` : ""}</td><td class="right rf-mono">${esc(rules.fmtQty(request.qty))}</td><td>${ui.badge(tone, LABEL[state.status] ?? state.status)}${detail ? `<div class="small muted">${esc(detail)}</div>` : ""}</td><td class="small">${esc(request.createdBy ?? "")}</td><td class="right">${cancel}</td></tr>`;
    });
    const historyCard = ui.card(`${ui.table(["เวลาขอ", "ใบสั่งผลิต", "เส้นยาง", { label: "ขอ", className: "right" }, "สถานะ", "ผู้ขอ", { label: "", className: "right" }], historyRows, { emptyText: "ยังไม่เคยขอเบิกยางเส้นยาว" })}${more}`, { title: esc("คำขอเบิก"), flush: true });
    const stock = root.MNP_SR?.stockView?.(ctx, { readOnly: true });
    const stockPart = `<h2 class="bom-h3">${esc("ยางเส้นยาวในคลัง SR")}</h2>${stock?.html ?? ui.card(ui.empty("ไม่พบข้อมูลยางเส้นยาวในคลัง"))}`;
    return `${needsCard}${historyCard}${stockPart}`;
  }

  // ---------- ส่งให้ PK ----------
  // ต่องาน: ยอดดี (ขั้นสุดท้าย) · ส่งแล้ว (รอ PK รับ + PK รับแล้ว · รายละเอียดที่ title) · ยังไม่ได้ส่ง (รอที่ GR) · ปุ่มส่ง (หัวหน้า GR / ฝ่ายวางแผน)
  // รายการส่งทั้งหมด ใหม่ก่อน ทีละ 100 แถว: ยกเลิกการส่งที่ PK ยังไม่รับ (หัวหน้า GR / ฝ่ายวางแผน) · ย้อนการรับ (หัวหน้า PK / ฝ่ายวางแผน)
  const HANDOVER_TONE = Object.freeze({ sent: "warn", received: "good", cancelled: "" });
  function handoverRows(ctx, rows, { showJob = true } = {}) {
    const { ui, rules, data, user } = ctx;
    const jobs = new Map(data.jobs.map((job) => [job.id, job]));
    const LABEL = rules.GR_HANDOVER_STATUS_LABEL;
    return rows.map((row) => {
      const job = jobs.get(row.jobId);
      const active = ACTIVE.includes(orderOf(ctx, row.orderId)?.status);
      const unit = uomText(ctx, job?.uom ?? "pcs");
      const detail = row.status === "received" ? `${row.receivedBy ?? ""} · ${rules.fmtDateTime(row.receivedAt)}` : row.status === "cancelled" ? `${row.cancelledBy ?? ""}: ${row.cancelReason ?? ""}` : "";
      const button = !active ? "" : row.status === "sent" && canLead(ctx) ? ui.openButton("ยกเลิกการส่ง", "grHandoverCancel", { handoverId: row.id }, { className: "secondary small", ariaLabel: `ยกเลิกการส่ง ${row.itemCode} ${rules.fmtQty(row.qty)}` })
        : row.status === "received" && ctx.helpers.canReverseGrReceipt?.(user) ? ui.openButton("ย้อนการรับ", "grHandoverCancel", { handoverId: row.id }, { className: "secondary small", ariaLabel: `ย้อนการรับ ${row.itemCode} ${rules.fmtQty(row.qty)}` }) : "";
      const what = showJob ? `<td>${ui.link(job?.name ?? row.itemCode, jobHref(row.jobId))}<div class="small muted">${esc(`${row.itemCode} · ใบ ${row.orderId}`)}</div></td>` : "";
      return `<tr${row.status === "cancelled" ? ' class="muted"' : ""}><td class="nowrap small">${esc(rules.fmtDateTime(row.sentAt))}</td>${what}<td class="right rf-mono">${esc(`${rules.fmtQty(row.qty)} ${unit}`)}</td><td>${ui.badge(HANDOVER_TONE[row.status] ?? "", LABEL[row.status] ?? row.status)}${detail ? `<div class="small muted">${esc(detail)}</div>` : ""}${row.note ? `<div class="small muted">${esc(row.note)}</div>` : ""}</td><td class="small">${esc(row.sentBy ?? "")}</td><td class="right">${button}</td></tr>`;
    });
  }
  const handoverHead = (showJob = true) => ["เวลาส่ง", ...(showJob ? ["งาน"] : []), { label: "จำนวน", className: "right" }, "สถานะ", "ผู้ส่ง", { label: "", className: "right" }];
  function pkView(ctx) {
    const { ui, rules, data } = ctx;
    const jobs = grJobs(ctx).all.filter((job) => num(job.qtyDone) > 0 || (data.grHandovers ?? []).some((row) => row.jobId === job.id));
    const rows = jobs.map((job) => {
      const sum = rules.grHandoverSummary(data, job);
      const unit = uomText(ctx, job.uom);
      const button = canLead(ctx) && isActive(ctx, job) && sum.waitingAtGr > 0 ? ui.openButton("ส่งให้ PK", "grSendPk", { jobId: job.id }, { className: "small", ariaLabel: `ส่งให้ PK ${job.itemCode}` }) : "";
      return `<tr${rowAttr(jobHref(job.id))}><td>${mainLink(ctx, job.name, jobHref(job.id))}<div class="small muted">${esc(`${job.itemCode} · ใบ ${job.orderId}`)}</div></td><td class="right rf-mono">${esc(`${rules.fmtQty(job.qtyDone)} ${unit}`)}</td><td class="right rf-mono" title="${attr(`PK รับแล้ว ${rules.fmtQty(sum.received)} · รอ PK รับ ${rules.fmtQty(sum.pendingAtPk)}`)}">${esc(rules.fmtQty(sum.sent))}</td><td class="right rf-mono">${sum.waitingAtGr > 0 ? `<strong>${esc(rules.fmtQty(sum.waitingAtGr))}</strong>` : esc("0")}</td><td class="right">${button}</td></tr>`;
    });
    const jobsCard = ui.card(ui.table(["งาน", { label: "ยอดดี", className: "right", title: "ยอดดีของขั้นสุดท้ายของงาน" }, { label: "ส่งแล้ว", className: "right", title: "รวมที่ PK รับแล้วและที่รอ PK รับ (ไม่นับที่ยกเลิก)" }, { label: "รอที่ GR", className: "right", title: "ของดีที่ยังไม่ได้ส่งให้ PK" }, ""], rows, { emptyText: "ยังไม่มีงานที่มีของดีให้ส่ง" }), { title: esc("ของดีของแต่ละงาน"), flush: true });
    const sends = grSendRows(data, rules).slice().sort((a, b) => num(b.sentAt) - num(a.sentAt) || String(b.id).localeCompare(String(a.id)));
    const { shown, more } = F.limited(ctx, sends);
    const sendsCard = ui.card(`${ui.table(handoverHead(), handoverRows(ctx, shown), { emptyText: "ยังไม่เคยส่งให้ PK" })}${more}`, { title: esc("รายการส่ง"), flush: true });
    return `${jobsCard}${sendsCard}`;
  }

  // ---------- สรุปผล ----------
  // ตัวกรอง: เดือน (ค่าเริ่ม = เดือนนี้) ผู้ทำ ขั้นตอน ชิ้นงาน ลูกค้า ใบสั่งผลิต · ตารางต่อวัน ต่อขั้นตอน ต่อคน (ผลิตจริงเทียบต้องทำ) ของเสียตามเหตุผล · ตารางผลรายวันค้นหาได้ ทีละ 100 แถว · ไม่มีจำนวนเงิน
  const DAY_ROWS = 62;
  function groupTable(ctx, title, labelHead, groups, emptyText) {
    const { ui, rules } = ctx;
    const cell = (value) => `<td class="right rf-mono">${value === null ? dash : esc(rules.fmtQty(value))}</td>`;
    const rows = groups.map((row) => `<tr><td>${esc(row.label)}</td>${cell(row.hours)}${cell(row.good)}${cell(row.reject)}${cell(row.required)}<td class="right">${percentCell(ctx, row.percent)}</td></tr>`);
    const head = [labelHead, { label: "ชม.", className: "right", title: "ชั่วโมงทำงาน" }, { label: "ดี", className: "right" }, { label: "เสีย", className: "right" }, { label: "ต้องทำ", className: "right", title: "ชั่วโมง × เป้าชิ้นต่อชั่วโมง × 0.95 รวมเฉพาะผลที่ตั้งเป้าไว้" }, { label: "% สำเร็จ", className: "right", title: "ดีของผลที่ตั้งเป้าไว้ ÷ ต้องทำ" }];
    return ui.card(ui.table(head, rows, { emptyText }), { title: esc(title), flush: true });
  }
  function summaryView(ctx) {
    const { ui, rules, data, q } = ctx;
    const config = rules.grConfig(data);
    const thisMonth = rules.grDay(ctx.now).slice(0, 7);
    const monthParam = ctx.params.get("m") ?? thisMonth;
    const month = monthParam === "all" ? "" : monthParam;
    const filters = { month, workerId: ctx.params.get("w") ?? "", stepCode: ctx.params.get("s") ?? "", itemCode: ctx.params.get("item") ?? "", customer: ctx.params.get("cust") ?? "", orderId: ctx.params.get("ord") ?? "" };
    const sum = rules.grSummary(data, filters, config);
    const records = grRecordRows(data, rules).filter((record) => record.status === "active");
    const orders = new Map(data.orders.map((order) => [order.id, order]));
    const distinct = (list) => [...new Set(list.filter(Boolean))];
    const months = distinct([thisMonth, ...records.map((record) => String(record.workDate ?? "").slice(0, 7))]).sort().reverse();
    const monthOptions = [{ value: "all", label: "ทุกเดือน" }, ...months.map((value) => ({ value, label: `${rules.fmtDate(Date.parse(`${value}-15T12:00:00+07:00`)).replace(/^\d+\s/, "")}` }))];
    const workers = [...new Map(records.map((record) => [record.workerId, record.workerName || record.workerId])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "th")).map(([value, label]) => ({ value, label }));
    const toolbar = `<div class="rf-row sr-toolbar">
      ${filterSelect(ctx, "m", "เดือน", monthOptions, monthParam, null)}
      ${filterSelect(ctx, "w", "ผู้ทำ", workers, filters.workerId, "ทุกคน")}
      ${filterSelect(ctx, "s", "ขั้นตอน", config.steps.map((row) => ({ value: row.code, label: row.name })), filters.stepCode, "ทุกขั้นตอน")}
      ${filterSelect(ctx, "item", "ชิ้นงาน", distinct(records.map((record) => record.itemCode)).sort(), filters.itemCode, "ทุกชิ้นงาน")}
      ${filterSelect(ctx, "cust", "ลูกค้า", distinct(records.map((record) => orders.get(record.orderId)?.customer)).sort((a, b) => a.localeCompare(b, "th")), filters.customer, "ทุกลูกค้า")}
      ${filterSelect(ctx, "ord", "ใบสั่งผลิต", distinct(records.map((record) => record.orderId)).sort().reverse(), filters.orderId, "ทุกใบ")}
      ${[...Object.values(filters).slice(1), monthParam === thisMonth ? "" : "x"].some(Boolean) ? ui.link("ล้างตัวกรอง", grUrl({ tab: "summary" }), "btn rf-btn secondary small") : ""}</div>`;
    const days = sum.byDay.slice(0, DAY_ROWS).map((row) => ({ ...row, label: dayText(ctx, row.key) }));
    const dayTitle = sum.byDay.length > DAY_ROWS ? `ต่อวัน (${DAY_ROWS} วันล่าสุด)` : "ต่อวัน";
    const reasons = ui.card(ui.table(["เหตุผล", { label: "เสีย", className: "right" }], sum.byReason.map((row) => `<tr><td>${esc(row.label)}</td><td class="right rf-mono">${esc(rules.fmtQty(row.reject))}</td></tr>`), { emptyText: "ไม่มีของเสีย" }), { title: esc("ของเสียตามเหตุผล"), flush: true });
    const found = sum.records.filter((record) => F.includesText(`${record.workerName ?? ""} ${record.itemCode} ${record.orderId} ${rules.grStepName(config, record.stepCode)} ${record.reason ?? ""} ${record.note ?? ""}`, q));
    const { shown, more } = F.limited(ctx, found);
    const list = ui.card(`<div class="rf-row">${F.searchForm(ctx, "ค้นหาผู้ทำ ชิ้นงาน ใบ ขั้นตอน หรือเหตุผล")}</div>${ui.table(recordHead({ actions: false }), recordRows(ctx, shown, { actions: false }), { emptyText: q ? "ไม่พบผลที่ค้นหา" : "ไม่มีผลรายวันตามตัวกรอง" })}${more}`, { title: esc("ผลรายวัน"), flush: true });
    return `${toolbar}<div class="gr-summary">${groupTable(ctx, dayTitle, "วันที่", days, "ไม่มีผลรายวันตามตัวกรอง")}${groupTable(ctx, "ต่อขั้นตอน", "ขั้นตอน", sum.byStep, "ไม่มีผลรายวันตามตัวกรอง")}${groupTable(ctx, "ต่อคน", "ผู้ทำ", sum.byWorker, "ไม่มีผลรายวันตามตัวกรอง")}${reasons}</div>${list}`;
  }

  // ---------- ตั้งค่าขั้นตอนและเป้า (หัวหน้าแผนก GR และฝ่ายวางแผน) ----------
  // ขั้นตอน: ชื่อ ประเภท (สายหลัก / ขั้นเสริม) สถานะ เลื่อนขึ้นลง ลบ (ขั้นที่มีผลหรืออยู่ในขั้นตอนของงานลบไม่ได้ ตั้งไม่ใช้แทน) · เหตุผลของเสีย (บรรทัดละข้อ)
  // เป้าชิ้นต่อชั่วโมงที่ 100% ต่อชิ้นงาน × ขั้น (ค้นหาในตารางได้ เพิ่ม/แก้/ลบ) · ส่งทั้งชุดครั้งเดียว (saveGrConfig)
  function stepRow(ctx, step, used) {
    const { ui } = ctx;
    const kinds = Object.entries(ctx.rules.GR_STEP_KIND_LABEL).map(([value, label]) => ({ value, label }));
    const name = step?.name ?? "";
    const remove = used ? "" : `<button class="btn rf-btn secondary small" type="button" data-gr-remove aria-label="${attr(`ลบขั้นตอน ${name || "ใหม่"}`)}">ลบ</button>`;
    return `<tr data-gr-row="step"${used ? ` title="${attr("มีผลบันทึกแล้วหรืออยู่ในขั้นตอนของงาน ลบไม่ได้ ตั้งเป็นไม่ใช้แทน")}"` : ""}><td class="nowrap"><span data-gr-seq></span><input type="hidden" name="step.code[]" value="${attr(step?.code ?? "")}">${step?.code ? `<div class="small muted rf-mono">${esc(step.code)}</div>` : ""}</td>`
      + `<td><label class="sr-only">ชื่อขั้นตอน</label>${ui.input("step.name[]", { value: name, required: true, placeholder: "ชื่อขั้นตอน", extra: `maxlength="${ctx.rules.GR_LIMITS.name}" aria-label="ชื่อขั้นตอน"` })}</td>`
      + `<td>${ui.select("step.kind[]", kinds, { value: step?.kind ?? "main", extra: 'aria-label="ประเภทขั้นตอน"' })}</td><td>${ui.select("step.active[]", [{ value: "1", label: "ใช้อยู่" }, { value: "0", label: "ไม่ใช้" }], { value: step?.active === false ? "0" : "1", extra: 'aria-label="สถานะขั้นตอน"' })}</td>`
      + `<td class="right nowrap"><button class="btn rf-btn secondary small" type="button" data-gr-move="up" aria-label="${attr(`เลื่อน ${name || "ขั้นตอนใหม่"} ขึ้น`)}">↑</button><button class="btn rf-btn secondary small" type="button" data-gr-move="down" aria-label="${attr(`เลื่อน ${name || "ขั้นตอนใหม่"} ลง`)}">↓</button>${remove}</td></tr>`;
  }
  function targetRow(ctx, target, steps) {
    const { ui } = ctx;
    return `<tr data-gr-row="target" data-gr-text="${attr(`${target?.itemCode ?? ""} ${steps.find((row) => row.code === target?.stepCode)?.name ?? ""}`.toLowerCase())}"><td>${ui.input("target.itemCode[]", { value: target?.itemCode ?? "", list: "gr-item-codes", required: true, placeholder: "รหัสชิ้นงาน", extra: 'aria-label="รหัสชิ้นงาน"' })}</td>`
      + `<td>${ui.select("target.stepCode[]", steps.map((row) => ({ value: row.code, label: row.name })), { value: target?.stepCode ?? "", placeholder: "เลือกขั้นตอน", extra: 'required aria-label="ขั้นตอน"' })}</td>`
      + `<td>${ui.input("target.perHour[]", { type: "number", value: target?.perHour ?? "", step: "any", min: 0.01, max: ctx.rules.GR_LIMITS.perHour, required: true, placeholder: "ชิ้น/ชม.", extra: 'aria-label="ชิ้นต่อชั่วโมง"' })}</td>`
      + `<td class="right"><button class="btn rf-btn secondary small" type="button" data-gr-remove aria-label="ลบเป้า">ลบ</button></td></tr>`;
  }
  function settingsView(ctx) {
    const { ui, rules, data } = ctx;
    if (!canLead(ctx)) return ui.card(ui.empty("หน้านี้สำหรับหัวหน้าแผนก GR และฝ่ายวางแผน"));
    const config = rules.grConfig(data);
    const used = new Set([...(data.grRecords ?? []).map((record) => record.stepCode), ...(data.grPlans ?? []).flatMap((plan) => (plan.steps ?? []).map((step) => step.code))]);
    const codes = [...new Set([...data.jobs.filter((job) => job.dept === "GR").map((job) => job.itemCode), ...config.targets.map((target) => target.itemCode)])].sort();
    const stepsCard = ui.card(`${ui.table(["ลำดับ", "ชื่อขั้นตอน", "ประเภท", "สถานะ", { label: "", className: "right" }], config.steps.map((step) => stepRow(ctx, step, used.has(step.code))), { className: "gr-settings-table" }).replace("<tbody>", '<tbody data-gr-rows="step">')}
      <template data-gr-template="step">${stepRow(ctx, null, false)}</template><div class="rf-row"><button class="btn rf-btn secondary" type="button" data-gr-add="step">เพิ่มขั้นตอน</button></div>`, { title: esc("ขั้นตอน") });
    const reasonsCard = ui.card(ui.field("เหตุผลของเสีย", `<textarea class="textarea rf-textarea" id="gr-reasons" name="reasons" rows="${Math.min(12, config.reasons.length + 2)}" required title="หนึ่งบรรทัดต่อหนึ่งเหตุผล" placeholder="หนึ่งบรรทัดต่อหนึ่งเหตุผล">${esc(config.reasons.join("\n"))}</textarea>`, { id: "gr-reasons", required: true }), { title: esc("เหตุผลของเสีย") });
    const search = `<div class="rf-row"><label class="sr-only" for="gr-target-search">ค้นหาเป้า</label><input class="input rf-input" id="gr-target-search" type="search" placeholder="ค้นหารหัสชิ้นงานหรือขั้นตอน" autocomplete="off" data-gr-target-search></div>`;
    const targetsCard = ui.card(`${search}${ui.table(["ชิ้นงาน", "ขั้นตอน", { label: "ชิ้น/ชม.", title: "เป้าที่ 100% · ต้องทำ = ชั่วโมง × เป้า × 0.95" }, { label: "", className: "right" }], config.targets.map((target) => targetRow(ctx, target, config.steps)), { emptyText: "ยังไม่ได้ตั้งเป้า", className: "gr-settings-table" }).replace("<tbody>", '<tbody data-gr-rows="target">')}
      <template data-gr-template="target">${targetRow(ctx, null, config.steps)}</template><datalist id="gr-item-codes">${codes.map((code) => `<option value="${attr(code)}"></option>`).join("")}</datalist>
      <div class="rf-row"><button class="btn rf-btn secondary" type="button" data-gr-add="target">เพิ่มเป้า</button></div>`, { title: esc("เป้าชิ้นต่อชั่วโมง (ที่ 100%)"), flush: true });
    const note = config.stored ? "" : '<p class="small muted">ยังใช้ขั้นตอนและเหตุผลตั้งต้น บันทึกครั้งแรกแล้วแก้ได้ตามต้องการ</p>';
    return `<form novalidate class="gr-settings" data-rf-form="saveGrConfig" data-rf-success="บันทึกตั้งค่าแล้ว {result}">${note}${stepsCard}${reasonsCard}${targetsCard}<div class="rf-row bom-step-next"><button class="btn rf-btn" type="submit">บันทึกตั้งค่า</button></div></form>`;
  }

  // ---------- หน้างาน (?job=) ----------
  function jobView(ctx, jobId) {
    const { ui, rules, data } = ctx;
    const back = backLink(grUrl({}), "‹ งานของฉัน");
    const job = data.jobs.find((entry) => entry.id === jobId && entry.dept === "GR");
    if (!job) return { html: `${back}${F.pageHead(ctx, "งานของ GR")}${ui.card(ui.empty("ไม่พบงานนี้ (อาจถูกลบหรือยังโหลดไม่เสร็จ)"))}` };
    const order = orderOf(ctx, job.orderId);
    const progress = rules.grJobProgress(data, job);
    const unit = uomText(ctx, job.uom);
    const active = isActive(ctx, job);
    const tone = { in_progress: ["good", "กำลังทำ"], queued: ["", "รอคิว"], hold: ["bad", "พักงาน"], done: ["", "เสร็จ"] }[job.status] ?? ["", job.status];
    const facts = ui.kv([
      ["ชิ้นงาน", ui.mono(job.itemCode)],
      ["ใบสั่งผลิต", `${ui.link(job.orderId, ctx.url("orders", { sel: job.orderId }), "rf-mono")}${order?.customer ? ` <span class="small muted">${esc(order.customer)}</span>` : ""}`],
      ...(job.status === "done" ? [] : [["กำหนด", F.dueText(ctx, job.dueAt, false)]]),
      ...(progress.planned ? [] : [["แผน", esc(`${rules.fmtQty(job.qtyPlanned)} ${unit}`)]]),
      ["สถานะ", ui.badge(tone[0], tone[1])],
    ]);
    const block = ctx.helpers.grJobBlock?.(data, job, ctx.user);
    const rods = rodsOfJob(ctx, job);
    const buttons = [
      progress.planned && canRecord(ctx) && !block ? ui.link("บันทึกผล", logHref(job.id), "btn rf-btn") : "",
      canSetSteps(ctx, job) ? ui.openButton(progress.planned ? "แก้ขั้นตอน" : "ตั้งขั้นตอน", "grSteps", { jobId: job.id }, { className: progress.planned ? "secondary" : "" }) : "",
      canRequestRods(ctx, job) && rods.length ? ui.openButton("ขอเบิกยางเส้นยาว", "grRodRequest", { jobId: job.id }, { className: "secondary" }) : "",
      canLead(ctx) && active && progress.waitingAtGr > 0 ? ui.openButton("ส่งให้ PK", "grSendPk", { jobId: job.id }, { className: "secondary" }) : "",
    ].join("");
    const steps = progress.planned
      ? ui.card(ui.table(["ขั้นตอน", { label: "ทำแล้ว / ต้องทำ", className: "right" }, { label: "เสีย", className: "right" }, { label: "ชม.", className: "right", title: "ชั่วโมงทำงานรวม" }],
        progress.steps.map((step, index) => `<tr${index === progress.steps.length - 1 ? ` title="${attr("ขั้นสุดท้าย ยอดดีของขั้นนี้เป็นยอดของงาน")}"` : ""}><td>${esc(step.name)}${step.kind === "side" ? ` <span class="small muted">${esc(rules.GR_STEP_KIND_LABEL.side)}</span>` : ""}${ui.progress(step.good, step.qtyTarget, step.done ? "good" : "")}</td><td class="right rf-mono">${esc(`${rules.fmtQty(step.good)} / ${rules.fmtQty(step.qtyTarget)}`)}</td><td class="right rf-mono">${esc(rules.fmtQty(step.reject))}</td><td class="right rf-mono">${esc(rules.fmtQty(step.hours))}</td></tr>`)), { title: esc("ขั้นตอนของงาน"), flush: true })
      : ui.card(ui.callout("info", num(job.qtyDone) > 0 || num(job.qtyReject) > 0
        ? esc(`งานนี้รายงานยอดแบบเดิม ได้แล้ว ${rules.fmtQty(job.qtyDone)} จาก ${rules.fmtQty(job.qtyPlanned)} ${unit}${num(job.qtyReject) ? ` · เสีย ${rules.fmtQty(job.qtyReject)}` : ""} (ตั้งขั้นตอนไม่ได้)`)
        : esc("ยังไม่ได้ตั้งขั้นตอน หัวหน้าแผนก GR หรือฝ่ายวางแผนตั้งขั้นตอนก่อน แล้วจึงบันทึกผลรายวันได้")), { title: esc("ขั้นตอนของงาน") });
    // ยางเส้นยาว: ต่อรหัส ได้จาก SR / ต้องใช้ และล็อตที่ได้ · คำขอของงานนี้ทั้งหมด (ยกเลิกได้ถ้ายังเปิด)
    const rodRows = rods.map((row) => `<tr><td>${ui.mono(row.code)}</td><td class="right rf-mono">${row.need ? esc(`${rules.fmtQty(row.need.issued)}/${rules.fmtQty(row.need.need)} ${uomText(ctx, row.need.uom)}`) : dash}</td><td>${lotList(ctx, job.orderId, row.code, row.need?.uom ?? "")}</td></tr>`);
    const requests = (data.rodRequests ?? []).filter((request) => request.jobId === job.id).sort((a, b) => num(b.createdAt) - num(a.createdAt));
    const requestRows = requests.map((request) => {
      const state = requestState(ctx, request);
      const cancel = canCancelRequest(ctx, request) && state.status === "open" ? ui.openButton("ยกเลิกคำขอ", "grRodCancel", { requestId: request.id }, { className: "secondary small" }) : "";
      return `<tr${state.status === "cancelled" ? ' class="muted"' : ""}><td class="nowrap small">${esc(rules.fmtDateTime(request.createdAt))}</td><td>${ui.mono(request.itemCode)}${request.note ? `<div class="small muted">${esc(request.note)}</div>` : ""}</td><td class="right rf-mono">${esc(rules.fmtQty(request.qty))}</td><td>${ui.badge(state.status === "open" ? "warn" : state.status === "covered" ? "good" : "", rules.GR_REQUEST_STATUS_LABEL[state.status] ?? state.status)}${state.status === "cancelled" && request.cancelReason ? `<div class="small muted">${esc(request.cancelReason)}</div>` : ""}</td><td class="small">${esc(request.createdBy ?? "")}</td><td class="right">${cancel}</td></tr>`;
    });
    const rodsCard = rods.length || requests.length
      ? ui.card(`${ui.table(["เส้นยาง", { label: "ได้จาก SR / ต้องใช้", className: "right" }, { label: "ล็อตที่ได้", title: "ชี้ที่เลขล็อตเพื่อดูจำนวนและเวลาที่ SR จ่าย" }], rodRows, { emptyText: "งานนี้ไม่มียางเส้นยาวใน BOM ของใบ" })}${requests.length ? ui.table(["เวลาขอ", "เส้นยาง", { label: "ขอ", className: "right" }, "สถานะ", "ผู้ขอ", ""], requestRows) : ""}`, { title: esc("ยางเส้นยาว"), flush: true })
      : "";
    const sends = (data.grHandovers ?? []).filter((row) => row.jobId === job.id).sort((a, b) => num(b.sentAt) - num(a.sentAt));
    // ยอดส่งแต่ละครั้งและสถานะอยู่ในตาราง จึงบอกเฉพาะส่วนที่ยังไม่ได้ส่ง (ไม่ซ้ำผลรวมของตาราง)
    const pkFacts = ui.kv([["ยังไม่ได้ส่ง", esc(`${rules.fmtQty(progress.waitingAtGr)} ${unit}`)]]);
    const pkCard = progress.planned || num(job.qtyDone) > 0 || sends.length ? ui.card(`<div class="rf-card-pad">${pkFacts}</div>${sends.length ? ui.table(handoverHead(false), handoverRows(ctx, sends, { showJob: false })) : ""}`, { title: esc("ส่งให้ PK"), flush: true }) : "";
    const records = (data.grRecords ?? []).filter((record) => record.jobId === job.id).sort(byNewest);
    const { shown, more } = F.limited(ctx, records);
    const recordsCard = progress.planned || records.length ? ui.card(`${ui.table(recordHead(), recordRows(ctx, shown, { showJob: false }), { emptyText: "ยังไม่มีผลรายวันของงานนี้" })}${more}`, { title: esc("ผลรายวันของงานนี้"), flush: true }) : "";
    return { html: `${back}${F.pageHead(ctx, job.name, `${buttons}${syncLine()}`)}<div class="sr-lot">${ui.card(facts, { className: "sr-lot-facts" })}${steps}</div>${rodsCard}${pkCard}${recordsCard}` };
  }

  // ---------- dialog ----------
  const jobOf = (ctx, jobId) => ctx.data.jobs.find((entry) => entry.id === jobId && entry.dept === "GR") ?? null;
  const reasonInput = (ctx, label, placeholder, id) => ctx.ui.field(label, ctx.ui.input("reason", { required: true, placeholder, id, extra: `minlength="${ctx.rules.GR_LIMITS.reasonMin}" maxlength="${ctx.rules.GR_LIMITS.reasonMax}"` }), { id, required: true });
  // ตั้งขั้นตอนของงาน: ลำดับในรายการ = ลำดับขั้นที่ส่ง (ขั้นสุดท้ายที่ติ๊ก = ขั้นที่นับเป็นยอดดีของงาน) · ติ๊กขั้นที่งานนี้ทำ + ต้องทำของแต่ละขั้น (ค่าเริ่ม = จำนวนแผนของงาน)
  // ลำดับเริ่มต้น: ขั้นของแผนเดิมตามลำดับแผน · ยังไม่ตั้ง = ขั้นสายหลักทุกขั้นตามลำดับในตั้งค่า (rules.grDefaultSteps) · แล้วขั้นที่เหลือที่ใช้อยู่ (ขั้นแยก) ตามลำดับในตั้งค่า
  // หัวหน้าเลื่อนขั้นขึ้น / ลงได้ (bindStepOrder) · ขั้นที่มีผลแล้วเอาออกไม่ได้ (ช่องติ๊กล็อกไว้ แต่เลื่อนได้)
  function stepOrder(ctx, job, config) {
    const { rules, data } = ctx;
    const plan = rules.grPlanOf(data, job.id);
    const first = plan?.steps ?? rules.grDefaultSteps(data, job, config);
    const chosen = new Map(first.map((step) => [step.code, step.qtyTarget]));
    const known = (code) => rules.grStepOf(config, code) ?? { code, name: code, kind: "main", active: false };
    const rest = config.steps.filter((step) => step.active !== false && !chosen.has(step.code));
    return { plan, chosen, steps: [...first.map((step) => known(step.code)), ...rest] };
  }
  dialogs.grSteps = (ctx, { jobId }) => {
    const { ui, rules, data } = ctx;
    const job = jobOf(ctx, jobId);
    if (!job || !canSetSteps(ctx, job)) return null;
    const config = rules.grConfig(data);
    const { plan, chosen, steps } = stepOrder(ctx, job, config);
    const busy = new Set(rules.grActiveRecords(data, job.id).map((record) => record.stepCode));
    const base = Math.max(1, Math.ceil(num(job.qtyPlanned)));
    const rows = steps.map((step) => {
      const on = chosen.has(step.code);
      const locked = busy.has(step.code);
      const id = `gr-step-${step.code}`;
      const box = locked
        ? `<input type="hidden" name="code[]" value="${attr(step.code)}"><input type="checkbox" id="${attr(id)}" checked disabled title="มีผลบันทึกแล้ว เอาออกไม่ได้">`
        : `<input type="checkbox" id="${attr(id)}" name="code[]" value="${attr(step.code)}"${on ? " checked" : ""}>`;
      const move = (dir, arrow, word) => `<button class="btn rf-btn secondary small" type="button" data-gr-move="${dir}" aria-label="${attr(`เลื่อน ${step.name} ${word}`)}">${arrow}</button>`;
      return `<tr data-gr-row="plan"><td><label class="gr-check" for="${attr(id)}">${box}<span>${esc(step.name)}</span></label></td><td class="small muted">${esc(rules.GR_STEP_KIND_LABEL[step.kind] ?? step.kind)}</td><td>${ui.input(`qty.${step.code}`, { type: "number", value: chosen.get(step.code) ?? base, step: 1, min: 1, max: rules.GR_LIMITS.qty, extra: `aria-label="${attr(`ต้องทำของขั้น ${step.name}`)}"` })}</td><td class="right nowrap">${move("up", "↑", "ขึ้น")}${move("down", "↓", "ลง")}</td></tr>`;
    });
    const body = `<form novalidate id="gr-steps-form" data-rf-form="setGrJobSteps" data-rf-args="${attr(JSON.stringify({ jobId: job.id }))}" data-rf-success="ตั้งขั้นตอน {result} แล้ว">
      <p class="small muted">${esc(`${job.itemCode} · ใบ ${job.orderId}`)}</p>
      ${!plan ? ui.callout("info", esc("ติ๊กไว้ครบทุกขั้นสายหลัก เอาขั้นที่งานนี้ไม่ทำออก")) : ""}
      ${ui.table([{ label: "ขั้นตอน", title: "ลำดับในรายการ = ลำดับขั้นของงาน · ขั้นสุดท้ายที่ติ๊ก = ยอดดีของงาน" }, "ประเภท", { label: "ต้องทำ (ชิ้น)", title: "ขั้นสุดท้ายที่ติ๊ก = ยอดดีของงาน" }, { label: "", className: "right" }], rows)}</form>`;
    return { html: ui.dialog("grSteps", `${plan ? "แก้ขั้นตอน" : "ตั้งขั้นตอน"} · ${job.name}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="gr-steps-form">บันทึกขั้นตอน</button>` }), bind: (dialog) => bindStepOrder(dialog.querySelector?.("form")) };
  };
  // แก้ผลรายวัน: ช่องเดียวกับฟอร์มบันทึก (ค่าเดิมเติมไว้) + เหตุผลที่แก้ (จำเป็น) · ประวัติการแก้เก็บที่ฐานข้อมูล
  dialogs.grRecordEdit = (ctx, { recordId }) => {
    const { ui, rules, data } = ctx;
    const record = (data.grRecords ?? []).find((row) => row.id === recordId);
    if (!record || ctx.helpers.grRecordBlock?.(data, ctx.user, record, ctx.now)) return null;
    const job = jobOf(ctx, record.jobId);
    if (!job) return null;
    const body = `<form novalidate id="gr-edit-form" data-rf-form="editGrRecord" data-rf-args="${attr(JSON.stringify({ recordId }))}" data-rf-success="แก้ไขผลแล้ว {result}" data-gr-targets="${attr(JSON.stringify(targetMap(ctx, [job])))}" data-gr-job-id="${attr(job.id)}">
      <p class="small muted">${esc(jobLabel(job))}</p>
      ${recordFields(ctx, { jobs: [job], job, record })}
      ${ui.field("เหตุผลที่แก้", ui.input("editReason", { required: true, id: "gr-edit-why", placeholder: "เช่น พิมพ์จำนวนผิด", extra: `minlength="${rules.GR_LIMITS.reasonMin}" maxlength="${rules.GR_LIMITS.reasonMax}"` }), { id: "gr-edit-why", required: true })}</form>`;
    return { html: ui.dialog("grRecordEdit", `แก้ไขผล · ${dayText(ctx, record.workDate)} · ${record.workerName ?? ""}`, body, { wide: true, footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="gr-edit-form">บันทึกการแก้ไข</button>` }), bind: (dialog) => bindRecordForm(ctx, dialog.querySelector("form")) };
  };
  dialogs.grRecordVoid = (ctx, { recordId }) => {
    const { ui, rules, data } = ctx;
    const record = (data.grRecords ?? []).find((row) => row.id === recordId);
    if (!record || ctx.helpers.grRecordBlock?.(data, ctx.user, record, ctx.now)) return null;
    const config = rules.grConfig(data);
    const facts = ui.kv([["วันที่", esc(dayText(ctx, record.workDate))], ["ผู้ทำ", esc(record.workerName ?? record.workerId)], ["ขั้นตอน", esc(`${rules.grStepName(config, record.stepCode)} · ${record.itemCode}`)], ["ผล", esc(`ดี ${rules.fmtQty(record.good)} · เสีย ${rules.fmtQty(record.reject)} · ${rules.fmtQty(record.hours)} ชม.`)]]);
    const body = `<form novalidate id="gr-void-form" data-rf-form="voidGrRecord" data-rf-args="${attr(JSON.stringify({ recordId }))}" data-rf-success="ยกเลิกผลแล้ว">
      ${facts}${ui.callout("warn", esc("ยอดของงานคำนวณใหม่ทันที ผลนี้ยังอยู่ในประวัติพร้อมเหตุผล ยกเลิกแล้วเปิดกลับไม่ได้ (บันทึกใหม่แทน)"))}
      ${reasonInput(ctx, "เหตุผลที่ยกเลิก", "เช่น บันทึกซ้ำ", "gr-void-why")}</form>`;
    return { html: ui.dialog("grRecordVoid", "ยกเลิกผลรายวัน", body, { footer: `${ui.closeButton("ไม่ยกเลิก")}<button class="btn rf-btn" type="submit" form="gr-void-form">ยกเลิกผล</button>` }) };
  };
  // ขอเบิกยางเส้นยาวจาก SR: เส้นยางของงานนี้ (rules.grRodCodesOf) · จำนวน (ค่าเริ่ม = ที่ยังต้องใช้ ปัดขึ้น) · หมายเหตุ · SR จ่ายด้วยการจ่ายตามใบเดิม
  dialogs.grRodRequest = (ctx, { jobId, itemCode = "" }) => {
    const { ui, rules } = ctx;
    const job = jobOf(ctx, jobId);
    if (!job || !canRequestRods(ctx, job)) return null;
    const rods = rodsOfJob(ctx, job);
    if (!rods.length) return { html: ui.dialog("grRodRequest", "ขอเบิกยางเส้นยาว", ui.callout("info", esc("งานนี้ไม่มียางเส้นยาวใน BOM ของใบ")), { footer: ui.closeButton("ปิด") }) };
    const pick = rods.find((row) => row.code === itemCode) ?? rods.find((row) => !row.open.length && (row.need?.remaining ?? 0) > 0) ?? rods[0];
    const options = rods.map((row) => ({ value: row.code, label: row.need ? `${row.code} · ได้แล้ว ${rules.fmtQty(row.need.issued)}/${rules.fmtQty(row.need.need)}` : row.code }));
    const start = Math.max(1, Math.ceil(pick.need?.remaining ?? 1));
    const body = `<form novalidate id="gr-rod-form" data-rf-form="requestRods" data-rf-args="${attr(JSON.stringify({ jobId: job.id }))}" data-rf-success="ขอเบิก {result} แล้ว รอ SR จ่าย">
      <p class="small muted">${esc(jobLabel(job))}</p>
      ${ui.field("เส้นยาง", ui.select("itemCode", options, { value: pick.code, id: "gr-rod-code" }), { id: "gr-rod-code", required: true })}
      ${ui.field("จำนวนที่ขอ (เส้น)", ui.input("qty", { type: "number", value: start, step: 1, min: 1, max: rules.GR_LIMITS.requestQty, required: true, id: "gr-rod-qty" }), { id: "gr-rod-qty", required: true })}
      ${ui.field("หมายเหตุ", ui.input("note", { id: "gr-rod-note", placeholder: "ถ้ามี", extra: `maxlength="${rules.GR_LIMITS.note}"` }), { id: "gr-rod-note" })}</form>`;
    return { html: ui.dialog("grRodRequest", "ขอเบิกยางเส้นยาวจาก SR", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="gr-rod-form">ขอเบิก</button>` }) };
  };
  dialogs.grRodCancel = (ctx, { requestId }) => {
    const { ui, rules, data } = ctx;
    const request = (data.rodRequests ?? []).find((row) => row.id === requestId);
    if (!request || !canCancelRequest(ctx, request)) return null;
    const body = `<form novalidate id="gr-rod-cancel-form" data-rf-form="cancelRodRequest" data-rf-args="${attr(JSON.stringify({ requestId }))}" data-rf-success="ยกเลิกคำขอ {result} แล้ว">
      ${ui.kv([["คำขอ", esc(`${request.itemCode} × ${rules.fmtQty(request.qty)} · ใบ ${request.orderId}`)], ["ผู้ขอ", esc(`${request.createdBy ?? ""} · ${rules.fmtDateTime(request.createdAt)}`)]])}
      ${reasonInput(ctx, "เหตุผลที่ยกเลิก", "เช่น ได้ยางเส้นยาวครบแล้ว", "gr-rod-cancel-why")}</form>`;
    return { html: ui.dialog("grRodCancel", "ยกเลิกคำขอเบิกยางเส้นยาว", body, { footer: `${ui.closeButton("ไม่ยกเลิก")}<button class="btn rf-btn" type="submit" form="gr-rod-cancel-form">ยกเลิกคำขอ</button>` }) };
  };
  // ส่งให้ PK: จำนวน (ค่าเริ่ม = ของดีที่ยังไม่ได้ส่งทั้งหมด ไม่เกินนั้น) · ยืนยันแล้วส่งทันที · PK กดรับเองที่โมดูล PK
  dialogs.grSendPk = (ctx, { jobId }) => {
    const { ui, rules, data } = ctx;
    const job = jobOf(ctx, jobId);
    if (!job || !canLead(ctx) || !isActive(ctx, job)) return null;
    const { waitingAtGr } = rules.grHandoverSummary(data, job);
    if (!(waitingAtGr > 0)) return null;
    const unit = uomText(ctx, job.uom);
    const body = `<form novalidate id="gr-send-form" data-rf-form="sendGrToPk" data-rf-args="${attr(JSON.stringify({ jobId: job.id }))}" data-rf-success="ส่งให้ PK {result} แล้ว">
      <p class="small muted">${esc(jobLabel(job))}</p>
      ${ui.field(`จำนวนที่ส่ง (${unit})`, ui.input("qty", { type: "number", value: Math.floor(waitingAtGr), step: 1, min: 1, max: Math.floor(waitingAtGr), required: true, id: "gr-send-qty", extra: `title="${attr(`ไม่เกินของดีที่ยังไม่ได้ส่ง ${rules.fmtQty(waitingAtGr)} ${unit}`)}"` }), { id: "gr-send-qty", required: true })}
      ${ui.field("หมายเหตุ", ui.input("note", { id: "gr-send-note", placeholder: "ถ้ามี", extra: `maxlength="${rules.GR_LIMITS.note}"` }), { id: "gr-send-note" })}</form>`;
    const confirm = "ส่งงานให้ PK ตามจำนวนที่กรอก? PK กดรับเมื่อได้ของ ถ้าส่งผิด หัวหน้าแผนก GR หรือฝ่ายวางแผนยกเลิกได้จนกว่า PK รับ";
    return { html: ui.dialog("grSendPk", "ส่งให้ PK", body, { footer: `${ui.closeButton()}<button class="btn rf-btn" type="submit" form="gr-send-form" data-rf-confirm="${attr(confirm)}">ส่งให้ PK</button>` }) };
  };
  // ยกเลิกการส่ง (PK ยังไม่รับ: หัวหน้า GR / ฝ่ายวางแผน) หรือย้อนการรับ (PK รับแล้ว: หัวหน้า PK / ฝ่ายวางแผน → กลับเป็นรอ PK รับ) · เหตุผลจำเป็น
  dialogs.grHandoverCancel = (ctx, { handoverId }) => {
    const { ui, rules, data, user } = ctx;
    const row = (data.grHandovers ?? []).find((entry) => entry.id === handoverId);
    if (!row || !ACTIVE.includes(orderOf(ctx, row.orderId)?.status)) return null;
    const reversing = row.status === "received";
    if (row.status === "cancelled" || (reversing ? !ctx.helpers.canReverseGrReceipt?.(user) : !canLead(ctx))) return null;
    const label = reversing ? "ย้อนการรับ" : "ยกเลิกการส่ง";
    const effect = reversing ? "รายการกลับเป็นรอ PK รับ แล้ว PK รับใหม่ได้" : "ของจำนวนนี้กลับเป็นของที่ยังไม่ได้ส่ง (รอที่ GR) แล้วส่งใหม่ได้";
    const body = `<form novalidate id="gr-handover-form" data-rf-form="cancelGrHandover" data-rf-args="${attr(JSON.stringify({ handoverId }))}" data-rf-success="${attr(`${label}แล้ว`)}">
      ${ui.kv([["รายการ", esc(`${row.itemCode} × ${rules.fmtQty(row.qty)} · ใบ ${row.orderId}`)], ["ส่งโดย", esc(`${row.sentBy ?? ""} · ${rules.fmtDateTime(row.sentAt)}`)]])}
      ${ui.callout("warn", esc(`${effect} · รายการเดิมยังอยู่ในประวัติ`))}
      ${reasonInput(ctx, "เหตุผล", reversing ? "เช่น รับผิดรายการ" : "เช่น ส่งจำนวนผิด", "gr-handover-why")}</form>`;
    return { html: ui.dialog("grHandoverCancel", label, body, { footer: `${ui.closeButton("ไม่ทำ")}<button class="btn rf-btn" type="submit" form="gr-handover-form">${esc(label)}</button>` }) };
  };

  // ---------- การ์ด "รับจาก GR" ของโมดูล PK (#/pk งานของฉัน) ----------
  // หนึ่งการ์ดต่อรายการส่งที่ PK ยังไม่รับ (ใบที่ยังผลิตอยู่) เก่าก่อน · ปุ่ม "รับ" รับทั้งรายการ ยืนยันแล้วส่งทันที · แผนก PK หรือฝ่ายวางแผน (อื่น ๆ ดูอย่างเดียว)
  function pkCards(ctx) {
    const { ui, rules, data } = ctx;
    const jobs = new Map(data.jobs.map((job) => [job.id, job]));
    const can = Boolean(ctx.helpers.canReceiveGr?.(ctx.user));
    return grSendRows(data, rules).filter((row) => row.status === "sent" && ACTIVE.includes(orderOf(ctx, row.orderId)?.status))
      .sort((a, b) => num(a.sentAt) - num(b.sentAt) || String(a.id).localeCompare(String(b.id)))
      .map((row) => {
        const job = jobs.get(row.jobId);
        const order = orderOf(ctx, row.orderId);
        const qty = `${rules.fmtQty(row.qty)} ${uomText(ctx, job?.uom ?? "pcs")}`;
        const action = can
          ? ui.button("รับ", { action: "receiveGrAtPk", args: { handoverId: row.id }, className: "bom-job-main", confirmText: `รับงานจาก GR ${row.itemCode} ทั้ง ${qty}? รับทั้งรายการในครั้งเดียว ถ้ารับผิด หัวหน้าแผนก PK หรือฝ่ายวางแผนย้อนได้`, success: "รับงานจาก GR {result} แล้ว", ariaLabel: `รับจาก GR ${row.itemCode} ${qty}` })
          : READ_ONLY;
        return `<article class="card rf-card bom-job is-now"><div class="bom-job-top"><span class="bom-job-state">รับจาก GR</span><span class="muted">${esc(`ส่งเมื่อ ${rules.fmtDateTime(row.sentAt)}`)}</span></div>
          <h2>${esc(job?.name ?? row.itemCode)}</h2><p class="small muted"><span class="rf-mono">${esc(row.itemCode)}</span> · ใบ ${ui.link(row.orderId, ctx.url("orders", { sel: row.orderId }))}${order?.customer ? ` · ${esc(order.customer)}` : ""}</p>
          <div class="bom-job-amount"><span>${esc(qty)}</span></div><p class="small muted">${esc([`ส่งโดย ${row.sentBy ?? ""}`, row.note].filter(Boolean).join(" · "))}</p>${action}</article>`;
      });
  }

  // ---------- ตัวผูกของหน้า ----------
  // ฟอร์มบันทึก / แก้ผล: เลือกงานแล้วขั้นตอนเปลี่ยนตามงาน · เหตุผลของเสียแสดงเมื่อเสีย > 0 · ต้องทำและ % เมื่อชิ้นงาน × ขั้นนั้นมีเป้า
  function bindRecordForm(ctx, form) {
    if (!form?.querySelector) return;
    const { rules } = ctx;
    const job = form.querySelector("[data-gr-job]");
    const step = form.querySelector("[data-gr-step]");
    const hours = form.querySelector("[data-gr-hours]");
    const good = form.querySelector("[data-gr-good]");
    const reject = form.querySelector("[data-gr-reject]");
    const reason = form.querySelector("[data-gr-reason]");
    const line = form.querySelector("[data-gr-target]");
    let plans = {};
    let targets = {};
    try { plans = JSON.parse(form.dataset.grPlans || "{}"); targets = JSON.parse(form.dataset.grTargets || "{}"); } catch { /* ข้อมูลเสีย: ไม่มีตัวช่วย action ยังตรวจ */ }
    const jobId = () => job?.value || form.dataset.grJobId || "";
    const paint = () => {
      if (reason) reason.hidden = !(Number(reject?.value) > 0);
      if (!line) return;
      const per = targets[`${jobId()}|${step?.value ?? ""}`];
      if (!per) { line.textContent = ""; return; }
      const need = rules.grRequired(hours?.value, per);
      const percent = need ? rules.grPercent(good?.value, need) : null;
      line.textContent = [`เป้า ${rules.fmtQty(per)} ชิ้น/ชม.`, need ? `ต้องทำ ${rules.fmtQty(need)} ชิ้น` : "", percent !== null && Number(good?.value) > 0 ? `สำเร็จ ${rules.fmtQty(percent)}%` : ""].filter(Boolean).join(" · ");
    };
    job?.addEventListener("change", () => {
      const list = plans[job.value] ?? [];
      if (step) {
        step.innerHTML = `<option value="">เลือกขั้นตอน</option>${list.map(([code, name]) => `<option value="${attr(code)}">${esc(name)}</option>`).join("")}`;
        if (list.length === 1) step.value = list[0][0];
      }
      paint();
    });
    for (const node of [step, hours, good, reject]) node?.addEventListener(node === step ? "change" : "input", paint);
    paint();
  }
  // ตั้งค่า: เลื่อน / ลบแถว (ผูกที่ฟอร์มครั้งเดียว แถวที่เพิ่มทีหลังใช้ได้ด้วย) · เพิ่มแถวจาก template · ค้นหาในตารางเป้า (ซ่อนแถว ค่าในแถวยังส่งตามเดิม)
  function bindSettings(form) {
    if (!form?.querySelector) return;
    const renumber = () => form.querySelectorAll('tr[data-gr-row="step"]').forEach((row, index) => { const seq = row.querySelector("[data-gr-seq]"); if (seq) seq.textContent = String(index + 1); });
    form.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-gr-move], [data-gr-remove], [data-gr-add]");
      if (!button) return;
      if (button.dataset.grAdd) {
        const kind = button.dataset.grAdd;
        const template = form.querySelector(`template[data-gr-template="${kind}"]`);
        const body = form.querySelector(`[data-gr-rows="${kind}"]`);
        if (!template || !body) return;
        body.querySelector("td.empty")?.closest("tr")?.remove();
        body.append(template.content.cloneNode(true));
        body.lastElementChild?.querySelector("input:not([type=hidden]), select")?.focus?.();
      } else {
        const row = button.closest("tr");
        if (!row) return;
        if (button.dataset.grMove === "up" && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
        else if (button.dataset.grMove === "down" && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
        else if (button.dataset.grRemove !== undefined && !button.dataset.grMove) row.remove();
        button.focus?.();
      }
      renumber();
    });
    form.querySelector("[data-gr-target-search]")?.addEventListener("input", (event) => {
      const q = String(event.target.value ?? "").trim().toLowerCase();
      form.querySelectorAll('tr[data-gr-row="target"]').forEach((row) => {
        const text = `${row.dataset.grText ?? ""} ${[...row.querySelectorAll("input")].map((input) => input.value).join(" ")}`.toLowerCase();
        row.hidden = Boolean(q) && !text.includes(q);
      });
    });
    renumber();
  }
  // dialog ตั้งขั้นตอน: เลื่อนแถวขึ้น / ลง (ลำดับแถว = ลำดับ code[] ที่ส่ง) · โฟกัสคงอยู่ที่ปุ่มที่กด
  function bindStepOrder(form) {
    if (!form?.addEventListener) return;
    form.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-gr-move]");
      const row = button?.closest?.("tr");
      if (!row?.parentElement) return;
      if (button.dataset.grMove === "up" && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
      else if (button.dataset.grMove === "down" && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
      button.focus?.();
    });
  }
  function bindPage(node, pageCtx) {
    node.querySelectorAll("[data-gr-filter]").forEach((select) => select.addEventListener("change", () => { location.hash = pageCtx.pageUrl({ [select.name]: select.value || null, n: null }); }));
    node.querySelectorAll('form[data-rf-form="addGrRecord"]').forEach((form) => bindRecordForm(pageCtx, form));
    node.querySelectorAll('form[data-rf-form="saveGrConfig"]').forEach((form) => bindSettings(form));
    pageCtx.ui?.enhanceDates?.(node);
  }

  // ---------- หน้าแรกของโมดูล ----------
  function landing(ctx) {
    const jobId = ctx.params.get("job");
    if (jobId) return { ...jobView(ctx, jobId), bind: bindPage, actions: true };
    const id = ctx.view?.id;
    const head = (extra = "") => F.viewHead(ctx, extra);
    if (id === "log") return { html: `${head()}${logView(ctx)}`, bind: bindPage, actions: true };
    // ยางเส้นยาว: ตารางคลัง SR ใช้ตัวกรองของโมดูล SR (data-sr-filter → ctx.pageUrl ของหน้านี้)
    if (id === "rods") return { html: `${head()}${rodsView(ctx)}`, bind: (node, pageCtx) => { bindPage(node, pageCtx); root.MNP_SR?.bindPage?.(node, pageCtx); }, actions: true };
    if (id === "pk") return { html: `${head()}${pkView(ctx)}`, bind: bindPage, actions: true };
    if (id === "summary") return { html: `${head()}${summaryView(ctx)}`, bind: bindPage, actions: true };
    if (id === "settings") return { html: `${head()}${settingsView(ctx)}`, bind: bindPage, actions: true };
    return { html: workView(ctx), bind: bindPage, actions: true };
  }

  const MENU = Object.freeze([
    Object.freeze({ ...F.workItem(workCount), owns: ["job"] }),
    Object.freeze({ id: "log", label: "บันทึกผลรายวัน", icon: "clipboard", params: { tab: "log" } }),
    // ?tab=rods คงไว้: ลิงก์ "ยางเส้นยาว" ของ BOM (module-bom.js rodsRedirect) ชี้มาที่นี่
    Object.freeze({ id: "rods", label: "ยางเส้นยาว", icon: "ruler", params: { tab: "rods" } }),
    Object.freeze({ id: "pk", label: "ส่งให้ PK", icon: "box", params: { tab: "pk" } }),
    Object.freeze({ id: "summary", label: "สรุปผล", icon: "chart", params: { tab: "summary" } }),
    Object.freeze({ id: "settings", label: "ตั้งค่าขั้นตอนและเป้า", icon: "settings", params: { tab: "settings" }, when: (user) => Boolean(root.MNP_BOM_ACTIONS?.helpers?.canGrLead?.(user)) }),
  ]);
  const KEEP = Object.freeze(["own", "loc", "day", "w", "s", "m", "item", "cust", "ord"]);

  root.MNP_GR_PAGES = Object.freeze({ landing, MENU, KEEP, grJobs, workCount, pkCards, recordRows });
})(window);
