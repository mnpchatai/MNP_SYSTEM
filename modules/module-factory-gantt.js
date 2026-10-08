// ตารางการผลิต (Gantt) ระดับใบงานของฝ่ายโรงงาน (โหมดทดสอบ)
//
// view ที่ไฟล์นี้วาดให้รายการในเมนู Item master › ตารางการผลิต (modules/factory-item-master.js):
//   gantt           ตารางการผลิต (Gantt)  แผนภูมิ: ใบสั่งผลิต (ออเดอร์ลูกค้า) เป็นกรอบ ใบงานของออเดอร์เดียวกันอยู่ในกรอบนั้น ·
//                   คำเตือน (เกินกำหนดส่ง ชนลำดับตาม BOM เกินกำลังศูนย์งาน) · ตารางกำหนดวันเริ่ม-สิ้นสุดของแต่ละใบงาน
//   gantt-calendar  ปฏิทินกะศูนย์งาน       กะ วันทำงาน จำนวนเครื่อง ประสิทธิภาพ และกำลังการผลิตต่อวันของแต่ละศูนย์งาน
//
// ทุกแผนกเปิดดูได้ (อ่านอย่างเดียว) ผู้ที่แก้ได้คือแผนก PP และบทบาท ผจก.ทั่วไป / ผจก.โรงงาน / ผู้ช่วย ผจก.โรงงาน — หน้าเว็บแสดงช่องแก้เมื่อ RPC
// ตอบ can_edit แต่การควบคุมสิทธิ์จริงอยู่ที่ RPC ใน supabase/migrations/20261008010000_factory_gantt_schedule.sql ซึ่งตรวจโหมดทดสอบ
// บทบาท สถานะใบงาน วันที่ และ schedule_version เองทุกครั้ง (ซ่อนช่องแก้ไม่ใช่การควบคุมสิทธิ์)
// ยังไม่มีการลากแถบ: ตั้งวันที่ด้วยช่องวันที่หรือปุ่มเลื่อน ±1 วัน (แตะได้บน iPhone ไม่มี popup ลอย จึงไม่ต้องมีโค้ดปิด popup ตามกติกา AGENTS.md)
// ภาระงานและคำเตือนคำนวณที่ modules/factory-gantt-model.js (มีเทสต์) ไม่ปฏิเสธการบันทึกเมื่อเกินกำลัง ผู้วางแผนเห็นคำเตือนแล้วตัดสินใจเอง
//
// โหลดหลัง modules/factory-gantt-model.js, modules/module-factory-master.js และ modules/module-factory-job.js ก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (sb, escapeHtml, formatDate, showToast, friendlyError, renderRoute) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactoryGanttViews() {
  const model = window.MNP_FACTORY_GANTT_MODEL;
  const jobModel = window.MNP_FACTORY_JOB_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { notice } = window.MNP_FACTORY_UI;

  // ลำดับสำคัญ: friendlyError ใช้คีย์แรกที่ปรากฏอยู่ในข้อความ รหัสใหม่ต้องไม่เป็นส่วนหนึ่งของรหัสอื่นที่ลงทะเบียนไว้ก่อนหน้า (มีเทสต์ตรวจ)
  const ERROR_MESSAGES = {
    SCHEDULE_NOT_ALLOWED: "แก้ตารางการผลิตได้เฉพาะแผนก PP, ผู้จัดการทั่วไป, ผู้จัดการโรงงาน และผู้ช่วยผู้จัดการโรงงาน — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองก่อน",
    INVALID_SCHEDULE_DATES: "วันที่ไม่ถูกต้อง: ต้องระบุทั้งวันเริ่มและวันสิ้นสุด วันสิ้นสุดต้องไม่ก่อนวันเริ่ม ช่วงยาวได้ไม่เกิน 365 วัน และอยู่ระหว่างปี 2020–2100",
    INVALID_SCHEDULE_NOTE: "หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร",
    SCHEDULE_TARGET_UNKNOWN: "ไม่พบใบงานนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    SCHEDULE_STALE: "ตารางของใบงานนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจตารางล่าสุดแล้วทำอีกครั้ง",
    SCHEDULE_JOB_FINISHED: "ใบงานนี้จบแล้วหรือถูกยกเลิก แก้ตารางไม่ได้",
    INVALID_WORK_CENTER_CALENDAR: "ปฏิทินศูนย์งานไม่ถูกต้อง: กะต้องเริ่มก่อนเลิกในวันเดียวกัน เวลาพักต้องสั้นกว่ากะ ต้องมีวันทำงานอย่างน้อย 1 วัน จำนวนเครื่อง 1–100 และประสิทธิภาพมากกว่า 0 ถึง 100%",
    CALENDAR_CENTER_UNKNOWN: "ไม่พบศูนย์งานนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    CALENDAR_STALE: "ปฏิทินของศูนย์งานนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจรายการล่าสุดแล้วทำอีกครั้ง",
  };
  Object.assign(window.MNP_FACTORY_ERRORS, ERROR_MESSAGES);

  const STALE_CODES = ["SCHEDULE_STALE", "SCHEDULE_JOB_FINISHED", "SCHEDULE_TARGET_UNKNOWN", "CALENDAR_STALE", "CALENDAR_CENTER_UNKNOWN"];
  const num = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 1 });
  const qty = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 4 });
  const day = (value) => (value ? formatDate(value) : "—");
  const jobUrl = (id) => menu.url("job-view", { jb: id });
  const orderUrl = (id) => menu.url("production-view", { po: id });
  const calendarUrl = () => menu.url("schedule-calendar");
  const ganttUrl = () => menu.url("schedule-gantt");
  const statusLabel = (status) => jobModel.JOB_STATUSES[status] ?? status;
  const statusBadge = (status) => `<span class="badge ${escapeHtml(jobModel.BADGE_CLASS[status] ?? "")}">${escapeHtml(statusLabel(status))}</span>`;

  async function loadSchedule() {
    const { data, error } = await sb.rpc("app_factory_schedule_data");
    if (error) throw error;
    return data;
  }

  // เรียก RPC หนึ่งครั้ง: ปิดปุ่มระหว่างทำ สำเร็จแล้ววาดหน้าใหม่ ผิดพลาดแจ้งเตือนและวาดใหม่เมื่อข้อมูลในหน้าล้าสมัย
  async function runAction(root, rpc, args, successMessage) {
    const controls = root.querySelectorAll("[data-gt-save], [data-gt-nudge], .gt-calendar-form button");
    controls.forEach((control) => { control.disabled = true; });
    try {
      const { error } = await sb.rpc(rpc, args);
      if (error) throw error;
      showToast(successMessage);
      await renderRoute();
    } catch (error) {
      showToast(friendlyError(error), "error");
      if (STALE_CODES.some((code) => String(error?.message ?? "").includes(code))) await renderRoute();
      else controls.forEach((control) => { control.disabled = false; });
    }
  }

  const editNotice = (data) => (data.can_edit ? "" : notice("ดูได้อย่างเดียว — แก้ตารางได้เฉพาะแผนก PP, ผู้จัดการทั่วไป, ผู้จัดการโรงงาน และผู้ช่วยผู้จัดการโรงงาน (สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเพื่อลองบทบาทนั้น)"));

  // ---------- แผนภูมิ ----------
  function monthLabel(date) {
    return new Intl.DateTimeFormat("th-TH", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  }

  function headHtml({ from, days }, today) {
    const months = [];
    const dayCells = [];
    for (let index = 0; index < days; index += 1) {
      const date = model.addDays(from, index);
      const key = date.slice(0, 7);
      if (months.at(-1)?.key === key) months.at(-1).count += 1;
      else months.push({ key, count: 1, label: monthLabel(date) });
      const weekday = model.weekday(date);
      dayCells.push(`<span class="gantt-day${weekday >= 6 ? " is-weekend" : ""}${date === today ? " is-today" : ""}" title="${escapeHtml(formatDate(date))}">${Number(date.slice(8))}</span>`);
    }
    return `<div class="gantt-row gantt-head"><div class="gantt-label"><strong>ออเดอร์ / ใบงาน</strong></div>
      <div class="gantt-track"><div class="gantt-months">${months.map((month) => `<span class="gantt-month" style="--n:${month.count}">${escapeHtml(month.label)}</span>`).join("")}</div>
      <div class="gantt-days">${dayCells.join("")}</div></div></div>`;
  }

  function barTitle(job, order, late, conflict) {
    const parts = [`${job.code} · ${job.item_code} ${qty(job.qty)} ${job.unit_code}`, `${formatDate(job.planned_start)} – ${formatDate(job.planned_end)}`, statusLabel(job.status)];
    if (late) parts.push(`เกินกำหนดส่ง ${formatDate(order.due_date)}`);
    if (conflict) parts.push("เริ่มก่อนใบงานที่ต้องผลิตชิ้นงานให้จบ");
    return parts.join(" · ");
  }

  function jobRowHtml(job, group, view) {
    const label = `<div class="gantt-label gantt-job-label"><a href="${escapeHtml(jobUrl(job.id))}"><strong>${escapeHtml(job.code)}</strong></a>
      <small>${escapeHtml(job.item_code)} · ${escapeHtml(qty(job.qty))} ${escapeHtml(job.unit_code)}</small></div>`;
    if (!model.isScheduled(job)) {
      return `<div class="gantt-row gantt-job">${label}<div class="gantt-track"><span class="gantt-unscheduled">ยังไม่กำหนดตาราง</span></div></div>`;
    }
    const late = model.isActive(job) && Boolean(group.order.due_date) && job.planned_end > group.order.due_date;
    const conflict = view.conflictIds.has(job.id);
    const { percent } = model.progress(job);
    const offset = model.diffDays(view.range.from, job.planned_start);
    const span = model.diffDays(job.planned_start, job.planned_end) + 1;
    const title = barTitle(job, group.order, late, conflict);
    return `<div class="gantt-row gantt-job">${label}<div class="gantt-track">
      <a class="gantt-bar gantt-s-${escapeHtml(job.status)}${late ? " is-late" : ""}${conflict ? " has-conflict" : ""}" style="--o:${offset};--n:${span}"
        href="${escapeHtml(jobUrl(job.id))}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><span class="gantt-fill" style="width:${percent}%"></span>
        <span class="gantt-bar-text">${conflict ? "⚠ " : ""}${escapeHtml(job.item_code)}</span></a></div></div>`;
  }

  function orderRowHtml(group, view) {
    const { order } = group;
    const label = `<div class="gantt-label gantt-order-label"><a href="${escapeHtml(orderUrl(order.id))}"><strong>${escapeHtml(order.code)}</strong></a>
      <small>ส่ง ${escapeHtml(day(order.due_date))}${group.late ? ' <span class="gantt-late-text">เกินกำหนด</span>' : ""} · ${escapeHtml(order.customer || "ไม่ระบุลูกค้า")}</small></div>`;
    const frame = group.start
      ? `<span class="gantt-frame${group.late ? " is-late" : ""}" style="--o:${model.diffDays(view.range.from, group.start)};--n:${model.diffDays(group.start, group.end) + 1}"></span>` : "";
    const dueOffset = order.due_date && model.isDate(order.due_date) ? model.diffDays(view.range.from, order.due_date) : -1;
    const due = dueOffset >= 0 && dueOffset < view.range.days
      ? `<span class="gantt-due" style="--o:${dueOffset}" title="กำหนดส่ง ${escapeHtml(formatDate(order.due_date))}" role="img" aria-label="กำหนดส่ง ${escapeHtml(formatDate(order.due_date))}">◆</span>` : "";
    return `<div class="gantt-row gantt-order">${label}<div class="gantt-track">${frame}${due}</div></div>`;
  }

  function capacityRowsHtml(view, data) {
    const rows = [];
    for (const center of data.work_centers ?? []) {
      const code = String(center.code).toUpperCase();
      const byDate = view.load[code];
      if (!byDate) continue;
      const capacity = model.capacityMinutes(center);
      const cells = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, minutes]) => {
        const level = model.utilizationLevel(minutes, capacity);
        const percent = capacity > 0 ? Math.round((minutes / capacity) * 100) : null;
        const text = `${code} ${formatDate(date)}: ${num(minutes)} / ${num(capacity)} นาที${percent === null ? "" : ` (${percent}%)`}`;
        return `<span class="gantt-cell level-${level}" style="--o:${model.diffDays(view.range.from, date)}" title="${escapeHtml(text)}" role="img" aria-label="${escapeHtml(text)}">${percent === null ? "!" : percent}</span>`;
      }).join("");
      rows.push(`<div class="gantt-row gantt-capacity"><div class="gantt-label gantt-job-label"><strong>${escapeHtml(code)}</strong><small>${escapeHtml(center.name)} · ${escapeHtml(num(capacity))} นาที/วัน</small></div><div class="gantt-track">${cells}</div></div>`);
    }
    if (!rows.length) return "";
    return `<div class="gantt-row gantt-section"><div class="gantt-label"><strong>กำลังการผลิตของศูนย์งาน</strong><small>% ของกำลังต่อวัน</small></div><div class="gantt-track"></div></div>${rows.join("")}`;
  }

  function chartHtml(data, groups, view) {
    if (!groups.length) {
      return `<div class="empty">ยังไม่มีใบงานให้แสดง<br><small>ฝ่ายวางแผนออกใบงานที่เมนู “ใบงานผลิต-ใหม่” ก่อน แล้วกำหนดวันเริ่ม-สิ้นสุดที่ตารางด้านล่าง หรือเติมชุดทดสอบ MEGAFORM ที่ทะเบียนสินค้าเพื่อดูตัวอย่างครบทุกแผนก</small>
        <div class="fm-actions"><a class="btn secondary" href="${escapeHtml(menu.url("job-new"))}">ไปที่ออกใบงาน</a>
          <a class="btn secondary" href="${escapeHtml(menu.url("item-list"))}">ไปที่ทะเบียนสินค้า</a></div></div>`;
    }
    const todayOffset = model.diffDays(view.range.from, view.today);
    const rows = groups.map((group) => orderRowHtml(group, view) + group.jobs.map((job) => jobRowHtml(job, group, view)).join("")).join("");
    const todayLine = todayOffset >= 0 && todayOffset < view.range.days ? `<span class="gantt-today" style="--o:${todayOffset}" aria-hidden="true"></span>` : "";
    return `<div class="gantt" style="--days:${view.range.days}" role="region" aria-label="แผนภูมิ Gantt ตารางการผลิต เลื่อนซ้าย-ขวาเพื่อดูวันอื่น" tabindex="0">
        <div class="gantt-inner">${headHtml(view.range, view.today)}${rows}${capacityRowsHtml(view, data)}${todayLine}</div></div>
      <p class="gantt-legend muted small"><span class="gantt-key gantt-s-open"></span>รอเริ่ม <span class="gantt-key gantt-s-in_progress"></span>กำลังผลิต <span class="gantt-key gantt-s-completed"></span>เสร็จแล้ว
        <span class="gantt-key is-late"></span>เกินกำหนดส่ง · ◆ กำหนดส่ง · เส้นแดง = วันนี้ · แถบทึบด้านในคือสัดส่วนขั้นตอนที่ทำเสร็จ · แตะแถบเพื่อเปิดใบงาน</p>`;
  }

  // ---------- คำเตือน ----------
  function warningsHtml(data, view) {
    const items = [];
    const orderOf = new Map((data.orders ?? []).map((order) => [order.id, order]));
    for (const job of view.late) {
      const order = orderOf.get(job.production_order_id);
      items.push(`<li><a href="${escapeHtml(jobUrl(job.id))}"><strong>${escapeHtml(job.code)}</strong></a> สิ้นสุด ${escapeHtml(day(job.planned_end))} เกินกำหนดส่ง ${escapeHtml(day(order?.due_date))} ของ ${escapeHtml(order?.code ?? "")}</li>`);
    }
    for (const row of view.conflicts) {
      items.push(`<li><a href="${escapeHtml(jobUrl(row.job.id))}"><strong>${escapeHtml(row.job.code)}</strong></a> เริ่ม ${escapeHtml(day(row.job.planned_start))} ก่อน <a href="${escapeHtml(jobUrl(row.needs.id))}"><strong>${escapeHtml(row.needs.code)}</strong></a> (${escapeHtml(row.needs.item_code)}) ที่ต้องผลิตให้จบก่อน สิ้นสุด ${escapeHtml(day(row.needs.planned_end))}</li>`);
    }
    const overByCenter = new Map();
    for (const row of view.overloads) {
      const list = overByCenter.get(row.code) ?? [];
      list.push(row);
      overByCenter.set(row.code, list);
    }
    for (const [code, list] of overByCenter) {
      const worst = list.reduce((best, row) => ((row.percent ?? Infinity) > (best.percent ?? Infinity) ? row : best), list[0]);
      items.push(`<li>ศูนย์งาน <strong>${escapeHtml(code)}</strong> เกินกำลัง ${list.length} วัน (สูงสุด ${worst.percent === null ? "—" : `${worst.percent}%`} ในวันที่ ${escapeHtml(day(worst.date))}) — ขยายช่วงของใบงาน เพิ่มเครื่อง/กะ หรือย้ายงาน</li>`);
    }
    for (const row of view.unplaced) {
      items.push(`<li><a href="${escapeHtml(jobUrl(row.job.id))}"><strong>${escapeHtml(row.job.code)}</strong></a> ช่วงที่วางแผนไม่มีวันทำงานของศูนย์งาน ${escapeHtml(row.code)} จึงยังไม่นับภาระ — ขยายช่วงให้ครอบวันทำงาน</li>`);
    }
    if (view.summary.unscheduled) items.push(`<li>มี ${view.summary.unscheduled} ใบงานที่ยังไม่กำหนดตาราง</li>`);
    if (!items.length) return `<p class="muted small">ไม่มีคำเตือน — ทุกใบงานที่กำหนดตารางแล้วอยู่ในกำหนดส่ง เรียงลำดับตาม BOM และไม่เกินกำลังศูนย์งาน</p>`;
    return `<ul class="gantt-warnings">${items.join("")}</ul>`;
  }

  // ---------- ตารางกำหนดวันของใบงาน ----------
  function editableCells(job, data, today) {
    const scheduled = model.isScheduled(job);
    const suggestion = scheduled ? null : model.suggestWindow(job, data, today);
    const start = scheduled ? job.planned_start : suggestion.start;
    const end = scheduled ? job.planned_end : suggestion.end;
    const days = model.estimateWorkingDays(job, data.work_centers);
    return `<td data-label="เริ่ม"><input class="input" type="date" name="start" value="${escapeHtml(start)}" min="${model.MIN_DATE}" max="${model.MAX_DATE}" aria-label="วันเริ่มของ ${escapeHtml(job.code)}" required></td>
      <td data-label="สิ้นสุด"><input class="input" type="date" name="end" value="${escapeHtml(end)}" min="${model.MIN_DATE}" max="${model.MAX_DATE}" aria-label="วันสิ้นสุดของ ${escapeHtml(job.code)}" required></td>
      <td data-label="ประมาณการ" class="muted small">≈ ${days} วันทำงาน${scheduled ? "" : "<br>(ค่าที่เสนอ ยังไม่บันทึก)"}</td>
      <td class="right" data-label="จัดการ"><span class="gantt-actions">
        ${scheduled ? `<button class="btn secondary small" type="button" data-gt-nudge="-1" aria-label="เลื่อน ${escapeHtml(job.code)} เร็วขึ้น 1 วัน">‹ 1 วัน</button>
        <button class="btn secondary small" type="button" data-gt-nudge="1" aria-label="เลื่อน ${escapeHtml(job.code)} ช้าลง 1 วัน">1 วัน ›</button>` : ""}
        <button class="btn small" type="button" data-gt-save>${scheduled ? "บันทึก" : "กำหนดตาราง"}</button></span></td>`;
  }

  function scheduleTableHtml(data, groups, today) {
    const body = groups.map((group) => {
      const head = `<tr class="gantt-group-row"><th colspan="7" scope="colgroup"><a href="${escapeHtml(orderUrl(group.order.id))}">${escapeHtml(group.order.code)}</a>
        · ${escapeHtml(group.order.customer || "ไม่ระบุลูกค้า")} · ${escapeHtml(group.order.item_code)} ${escapeHtml(qty(group.order.planned_qty))} ${escapeHtml(group.order.unit_code)} · ส่ง ${escapeHtml(day(group.order.due_date))}</th></tr>`;
      const rows = group.jobs.map((job) => {
        const editable = data.can_edit && model.isActive(job);
        const dates = editable ? editableCells(job, data, today)
          : `<td data-label="เริ่ม">${escapeHtml(day(job.planned_start))}</td><td data-label="สิ้นสุด">${escapeHtml(day(job.planned_end))}</td><td data-label="ประมาณการ" class="muted small">${model.isActive(job) ? `≈ ${model.estimateWorkingDays(job, data.work_centers)} วันทำงาน` : "—"}</td><td data-label="จัดการ"></td>`;
        return `<tr data-gt-row data-gt-job="${escapeHtml(job.id)}" data-gt-version="${escapeHtml(job.schedule_version)}">
          <td data-label="ใบงาน"><a href="${escapeHtml(jobUrl(job.id))}"><strong>${escapeHtml(job.code)}</strong></a></td>
          <td data-label="ชิ้นงาน"><strong>${escapeHtml(job.item_code)}</strong><br><span class="muted small">${escapeHtml(job.item_name)} · ${escapeHtml(qty(job.qty))} ${escapeHtml(job.unit_code)}</span></td>
          <td data-label="สถานะ">${statusBadge(job.status)}</td>${dates}</tr>`;
      }).join("");
      return head + rows;
    }).join("");
    return `<div class="table-wrap"><table class="gantt-table"><thead><tr><th>ใบงาน</th><th>ชิ้นงาน</th><th>สถานะ</th><th>เริ่ม</th><th>สิ้นสุด</th><th>ประมาณการ</th><th class="right">จัดการ</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function bindSchedule(root) {
    root.querySelectorAll("[data-gt-row]").forEach((row) => {
      const read = () => ({ start: row.querySelector('input[name="start"]')?.value ?? "", end: row.querySelector('input[name="end"]')?.value ?? "" });
      const submit = (start, end, message) => {
        const invalid = model.validateDates(start, end);
        if (invalid) { showToast(friendlyError({ message: invalid }), "error"); return undefined; }
        return runAction(root, "app_factory_schedule_job",
          { p_id: row.dataset.gtJob, p_schedule_version: Number(row.dataset.gtVersion), p_start: start, p_end: end, p_note: "" }, message);
      };
      row.querySelector("[data-gt-save]")?.addEventListener("click", () => {
        const { start, end } = read();
        return submit(start, end, "บันทึกตารางเวลาแล้ว");
      });
      row.querySelectorAll("[data-gt-nudge]").forEach((button) => button.addEventListener("click", () => {
        const { start, end } = read();
        if (!model.isDate(start) || !model.isDate(end)) return showToast(friendlyError({ message: "INVALID_SCHEDULE_DATES" }), "error");
        const days = Number(button.dataset.gtNudge);
        return submit(model.addDays(start, days), model.addDays(end, days), "เลื่อนตารางเวลาแล้ว");
      }));
    });
  }

  function viewModel(data) {
    const today = model.today();
    const { load, unplaced } = model.dailyLoad(data.jobs, data.work_centers);
    const conflicts = model.conflicts(data);
    return {
      today, range: model.range(data, today), load, unplaced, conflicts,
      conflictIds: new Set(conflicts.map((row) => row.job.id)),
      late: model.lateJobs(data), overloads: model.overloads(load, data.work_centers), summary: model.summary(data, today),
    };
  }

  function summaryHtml(summary) {
    const tile = (title, value, hint, warn) => `<div class="summary"><span>${escapeHtml(title)}</span><strong${warn && value ? ' class="fm-short"' : ""}>${escapeHtml(value)}</strong><small>${hint}</small></div>`;
    return `<div class="summary-grid fm-summary">
        ${tile("ออเดอร์ที่มีใบงาน", summary.orders, `ใบงานที่ยังไม่จบ ${summary.jobsActive} ใบ`)}
        ${tile("ยังไม่กำหนดตาราง", summary.unscheduled, "ใบงานที่ยังไม่มีวันเริ่ม-สิ้นสุด", true)}
        ${tile("เกินกำหนดส่ง", summary.late, "ใบงานที่สิ้นสุดหลังกำหนดส่งของออเดอร์", true)}
        ${tile("วันที่เกินกำลังศูนย์งาน", summary.overloadDays, `<a href="${escapeHtml(calendarUrl())}">ดูปฏิทินศูนย์งาน →</a>`, true)}
      </div>`;
  }

  // ---------- view: ตารางการผลิต ----------
  function ganttBodyHtml(data) {
    const view = viewModel(data);
    const groups = model.groupByOrder(data);
    return `${editNotice(data)}${summaryHtml(view.summary)}
      <section class="card"><h2>ตารางการผลิตตามออเดอร์</h2>
        <p class="muted small">ใบงานของออเดอร์ลูกค้าเดียวกันอยู่ในกรอบของออเดอร์นั้น · ภาระงาน = เตรียมเครื่อง + เวลาเดินต่อชุด × จำนวนชุด (เวลาตัวอย่าง ต้องยืนยันกับหน้างาน) กระจายเท่ากันทุกวันทำงานของศูนย์งาน</p>
        ${chartHtml(data, groups, view)}</section>
      <section class="card"><h2>คำเตือน</h2>${warningsHtml(data, view)}</section>
      <section class="card"><h2>ตารางเวลาของใบงาน</h2>
        <p class="muted small">${data.can_edit ? "กำหนดวันเริ่ม-สิ้นสุด (รวมวันสุดท้าย) แล้วกดบันทึก หรือกดเลื่อน 1 วันทั้งช่วง · ใบงานที่จบแล้วแก้ตารางไม่ได้ · ประวัติการแก้อยู่ในประวัติของใบงาน" : "แสดงวันเริ่ม-สิ้นสุดที่ฝ่ายวางแผนกำหนดไว้"}</p>
        ${groups.length ? scheduleTableHtml(data, groups, view.today) : '<div class="empty">ยังไม่มีใบงาน</div>'}</section>`;
  }

  // ---------- view: ปฏิทินกะศูนย์งาน ----------
  const timeValue = (text) => String(text ?? "").slice(0, 5);

  function calendarFormHtml(center) {
    const days = new Set(model.workingDaysOf(center));
    const checks = model.WEEKDAYS.map((weekday) => `<label class="gantt-day-check"><input type="checkbox" name="day" value="${weekday.day}"${days.has(weekday.day) ? " checked" : ""}> ${escapeHtml(weekday.name)}</label>`).join("");
    return `<details class="gantt-edit"><summary>แก้ไขปฏิทิน</summary>
      <form class="gt-calendar-form" data-gt-calendar="${escapeHtml(center.code)}" data-gt-version="${escapeHtml(center.calendar_version)}">
        <div class="gantt-form-grid">
          <label>เริ่มกะ<input class="input" type="time" name="shift_start" value="${escapeHtml(timeValue(center.shift_start))}" required></label>
          <label>เลิกกะ<input class="input" type="time" name="shift_end" value="${escapeHtml(timeValue(center.shift_end))}" required></label>
          <label>พัก (นาที)<input class="input" type="number" name="break_minutes" min="0" max="600" step="1" inputmode="numeric" value="${escapeHtml(center.break_minutes)}" required></label>
          <label>จำนวนเครื่อง/สาย<input class="input" type="number" name="units" min="1" max="100" step="1" inputmode="numeric" value="${escapeHtml(center.units)}" required></label>
          <label>ประสิทธิภาพ (%)<input class="input" type="number" name="efficiency" min="1" max="100" step="0.5" inputmode="decimal" value="${escapeHtml(center.efficiency_percent)}" required></label>
        </div>
        <fieldset class="gantt-days-field"><legend>วันทำงาน</legend>${checks}</fieldset>
        <p class="muted small">กะต้องเริ่มและเลิกในวันเดียวกัน (ยังไม่รองรับกะข้ามคืน) · ยังไม่รองรับวันหยุดนักขัตฤกษ์ — ไม่ติ๊กวันนั้นออกถ้าต้องการหยุดเป็นประจำ</p>
        <div class="fm-form-error" id="gt-calendar-error-${escapeHtml(center.code)}" role="alert" hidden></div>
        <button class="btn small" type="submit">บันทึกปฏิทิน</button>
      </form></details>`;
  }

  function calendarHtml(data) {
    const view = viewModel(data);
    const cards = (data.work_centers ?? []).map((center) => {
      const capacity = model.capacityMinutes(center);
      const code = String(center.code).toUpperCase();
      const over = view.overloads.filter((row) => row.code === code).length;
      return `<section class="card gantt-center">
        <h2>${escapeHtml(center.code)} <span class="muted small">${escapeHtml(center.name)}${center.department_code && center.department_code !== center.code ? ` · แผนก ${escapeHtml(center.department_code)}` : ""}</span></h2>
        <dl class="gantt-facts">
          <div><dt>กะ</dt><dd>${escapeHtml(timeValue(center.shift_start))}–${escapeHtml(timeValue(center.shift_end))} พัก ${escapeHtml(center.break_minutes)} นาที</dd></div>
          <div><dt>วันทำงาน</dt><dd>${escapeHtml(model.workingDaysLabel(center))}</dd></div>
          <div><dt>เครื่อง/สาย × ประสิทธิภาพ</dt><dd>${escapeHtml(center.units)} × ${escapeHtml(num(center.efficiency_percent))}%</dd></div>
          <div><dt>กำลังการผลิตต่อวัน</dt><dd><strong>${escapeHtml(num(capacity))}</strong> นาที (${escapeHtml(num(capacity / 60))} ชม.)</dd></div>
          <div><dt>วันที่เกินกำลัง</dt><dd>${over ? `<span class="fm-short">${over} วัน</span>` : "ไม่มี"}</dd></div>
        </dl>
        <p class="muted small">${center.updated_at ? `แก้ล่าสุดโดย ${escapeHtml(center.updated_by_name ?? "—")} · ${escapeHtml(formatDate(center.updated_at, true))}` : "ยังเป็นค่าตั้งต้น (ค่าสมมติ ต้องยืนยันกับหน้างาน)"}</p>
        ${data.can_edit ? calendarFormHtml(center) : ""}</section>`;
    }).join("");
    return `${editNotice(data)}
      <section class="card"><p class="muted small">กำลังการผลิตต่อวัน = (เลิกกะ − เริ่มกะ − พัก) × จำนวนเครื่อง × ประสิทธิภาพ · ใช้เทียบกับภาระงานของใบงานในตารางการผลิต (Gantt) · <a href="${escapeHtml(ganttUrl())}">ไปที่ตารางการผลิต →</a></p></section>
      ${cards || '<section class="card"><div class="empty">ยังไม่มีศูนย์งานในโหมดทดสอบ<br><small>เติมข้อมูลตัวอย่างที่ทะเบียนสินค้าก่อน</small></div></section>'}`;
  }

  function bindCalendar(root) {
    root.querySelectorAll("form[data-gt-calendar]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const errorBox = form.querySelector('[role="alert"]');
        if (errorBox) errorBox.hidden = true;
        const values = new FormData(form);
        const days = values.getAll("day").map(Number);
        const start = model.minutesOfDay(values.get("shift_start"));
        const end = model.minutesOfDay(values.get("shift_end"));
        const breakMinutes = Number(values.get("break_minutes"));
        const units = Number(values.get("units"));
        const efficiency = Number(values.get("efficiency"));
        const invalid = !days.length || !(end > start) || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= end - start
          || !Number.isInteger(units) || units < 1 || units > 100 || !(efficiency > 0 && efficiency <= 100);
        if (invalid) {
          if (errorBox) { errorBox.textContent = ERROR_MESSAGES.INVALID_WORK_CENTER_CALENDAR; errorBox.hidden = false; }
          return undefined;
        }
        return runAction(root, "app_factory_save_work_center_calendar", {
          p_code: form.dataset.gtCalendar, p_calendar_version: Number(form.dataset.gtVersion), p_shift_start: String(values.get("shift_start")),
          p_shift_end: String(values.get("shift_end")), p_break_minutes: breakMinutes, p_working_days: days, p_units: units, p_efficiency: efficiency,
        }, `บันทึกปฏิทินศูนย์งาน ${form.dataset.gtCalendar} แล้ว`);
      });
    });
  }

  const VIEWS = {
    async gantt({ frame }) {
      frame.loading();
      const data = await loadSchedule();
      const root = frame.paint({ body: ganttBodyHtml(data) });
      bindSchedule(root);
    },
    async "gantt-calendar"({ frame }) {
      frame.loading();
      const data = await loadSchedule();
      const root = frame.paint({ body: calendarHtml(data) });
      bindCalendar(root);
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
