// ตรรกะของตารางการผลิต (Gantt) ระดับใบงานของฝ่ายโรงงาน (โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-gantt-model.test.mjs)
//
// อ่านอย่างเดียวจากข้อมูลของ app_factory_schedule_data (supabase/migrations/20261008010000_factory_gantt_schedule.sql):
// ใบสั่งผลิต (ออเดอร์ลูกค้า) เป็นกรอบ ใบงานของใบสั่งผลิตเดียวกันอยู่ในกรอบนั้น ศูนย์งานมีปฏิทินกะและกำลังการผลิต
// ที่นี่จัดกลุ่ม คำนวณช่วงแผนภูมิ ภาระงานต่อศูนย์งานต่อวัน คำเตือน (เกินกำลัง ชนลำดับตาม BOM เกินกำหนดส่ง) และตรวจวันที่ให้ผู้ใช้เห็นก่อนส่ง
// ทั้งหมดเป็นการช่วยตัดสินใจ — ฐานข้อมูลตรวจสิทธิ์ วันที่ สถานะ และ version เองทุกครั้ง การซ่อนปุ่มไม่ใช่การควบคุมสิทธิ์
//
// วันที่ทั้งหมดเป็นข้อความ "YYYY-MM-DD" (วันตามปฏิทิน ไม่มีเขตเวลา) คำนวณด้วย UTC เพื่อไม่ให้เปลี่ยนวันตามเครื่องผู้ใช้
//
// ภาระงานของใบงาน (นาที) ต่อศูนย์งาน = Σ ขั้นที่ยังรอทำ ของ (เตรียมเครื่อง + เวลาเดินต่อชุด × จำนวนชุด)
//   จำนวนชุด = ceil(จำนวนของใบงาน ÷ จำนวนผลผลิตต่อชุดของ BOM) — เวลาเดินใน Routing คือ "เวลาต่อชุดผลิต" (ข้อมูลตัวอย่าง ต้องยืนยันกับหน้างาน)
//   กระจายเท่าๆ กันทุกวันทำงานของศูนย์งานนั้นในช่วงที่วางแผน เทียบกับกำลังการผลิตต่อวัน
//   = (เลิกกะ − เริ่มกะ − พัก) × จำนวนเครื่อง × ประสิทธิภาพ% เกินกำลังเป็นคำเตือน ไม่ปฏิเสธการบันทึก
(function (root) {
  const DAY_MS = 86400000;
  const ACTIVE_STATUSES = Object.freeze(["open", "in_progress"]);
  // วันในสัปดาห์แบบ ISO (จันทร์ = 1 ... อาทิตย์ = 7) ตรงกับ working_days ในฐานข้อมูล
  const WEEKDAYS = Object.freeze([
    Object.freeze({ day: 1, short: "จ", name: "จันทร์" }),
    Object.freeze({ day: 2, short: "อ", name: "อังคาร" }),
    Object.freeze({ day: 3, short: "พ", name: "พุธ" }),
    Object.freeze({ day: 4, short: "พฤ", name: "พฤหัสบดี" }),
    Object.freeze({ day: 5, short: "ศ", name: "ศุกร์" }),
    Object.freeze({ day: 6, short: "ส", name: "เสาร์" }),
    Object.freeze({ day: 7, short: "อา", name: "อาทิตย์" }),
  ]);
  const DEFAULT_WORKING_DAYS = Object.freeze([1, 2, 3, 4, 5]);
  const MAX_WINDOW_DAYS = 365;
  const MIN_DATE = "2020-01-01";
  const MAX_DATE = "2100-12-31";
  // เกณฑ์สีของการใช้กำลังการผลิต: ถึง 80% = ปกติ · เกิน 80% ถึง 100% = ใกล้เต็ม · เกิน 100% = เกินกำลัง
  const WARN_RATIO = 0.8;
  const EPSILON = 1e-6;

  // ---------- วันที่ ----------
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  function parse(text) {
    if (typeof text !== "string" || !DATE_PATTERN.test(text)) return Number.NaN;
    const [year, month, day] = text.split("-").map(Number);
    const ms = Date.UTC(year, month - 1, day);
    const back = new Date(ms);
    // วันที่ที่ไม่มีจริง (เช่น 2026-02-31) ถูกปัดโดย Date จึงต้องเทียบกลับ
    return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? ms : Number.NaN;
  }
  const isDate = (text) => !Number.isNaN(parse(text));
  function format(ms) {
    const date = new Date(ms);
    return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const addDays = (text, days) => format(parse(text) + days * DAY_MS);
  // จำนวนวันจาก a ถึง b (b ก่อน a ได้ผลติดลบ)
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY_MS);
  const weekday = (text) => ((new Date(parse(text)).getUTCDay() + 6) % 7) + 1;
  // วันนี้ตามเวลาประเทศไทย (UTC+7) เหมือนส่วนอื่นของโมดูล
  const today = (now = Date.now()) => format(Math.floor((now + 7 * 3600 * 1000) / DAY_MS) * DAY_MS);

  // ---------- ปฏิทินและกำลังการผลิตของศูนย์งาน ----------
  function minutesOfDay(text) {
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(text ?? ""));
    if (!match) return Number.NaN;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours > 23 || minutes > 59 ? Number.NaN : hours * 60 + minutes;
  }
  const workingDaysOf = (center) => {
    const days = (center?.working_days ?? []).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
    return days.length ? days : DEFAULT_WORKING_DAYS.slice();
  };
  const isWorkingDay = (center, date) => workingDaysOf(center).includes(weekday(date));

  // กำลังการผลิตต่อวันทำงาน (นาที) — ค่าที่อ่านไม่ได้คืน 0 (ถือว่าไม่มีกำลัง ไม่เดาให้)
  function capacityMinutes(center) {
    const shift = minutesOfDay(center?.shift_end) - minutesOfDay(center?.shift_start) - Number(center?.break_minutes ?? 0);
    const units = Number(center?.units ?? 1);
    const efficiency = Number(center?.efficiency_percent ?? 100);
    const value = shift * units * (efficiency / 100);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  }
  // เช่น "จันทร์–ศุกร์" · "จ อ พ ส" (เมื่อวันไม่ติดกัน)
  function workingDaysLabel(center) {
    const days = [...new Set(workingDaysOf(center))].sort((a, b) => a - b);
    if (days.length === 7) return "ทุกวัน";
    const consecutive = days.every((day, index) => index === 0 || day === days[index - 1] + 1);
    const name = (day) => WEEKDAYS[day - 1].name;
    if (consecutive && days.length >= 3) return `${name(days[0])}–${name(days[days.length - 1])}`;
    return days.map((day) => WEEKDAYS[day - 1].short).join(" ");
  }

  // ---------- ภาระงานของใบงาน ----------
  const isActive = (job) => ACTIVE_STATUSES.includes(job?.status);
  const isScheduled = (job) => Boolean(job?.planned_start && job?.planned_end);
  const stepsOf = (job) => (job?.steps ?? []).slice().sort((a, b) => a.sequence - b.sequence);

  function batches(job) {
    const output = Number(job?.bom_output_qty);
    const qty = Number(job?.qty);
    if (!(output > 0) || !(qty > 0)) return 1;
    return Math.max(1, Math.ceil(qty / output - EPSILON));
  }
  const stepMinutes = (job, step) => Number(step?.setup_minutes ?? 0) + Number(step?.run_minutes ?? 0) * batches(job);

  // นาทีที่ยังต้องใช้ของแต่ละศูนย์งาน (ขั้นที่ทำเสร็จแล้วไม่นับ): { RB: 480, GR: 120 }
  function remainingLoad(job) {
    const load = {};
    for (const step of stepsOf(job)) {
      if (step.status === "done") continue;
      const code = String(step.work_center_code ?? "").toUpperCase();
      load[code] = (load[code] ?? 0) + stepMinutes(job, step);
    }
    return load;
  }

  // วันทำงานของศูนย์งานในช่วง [start, end]
  function workingDatesIn(center, start, end) {
    const dates = [];
    for (let date = start; diffDays(date, end) >= 0 && dates.length <= MAX_WINDOW_DAYS; date = addDays(date, 1)) {
      if (isWorkingDay(center, date)) dates.push(date);
    }
    return dates;
  }

  // ภาระต่อศูนย์งานต่อวัน จากใบงานที่ยังไม่จบและกำหนดตารางแล้ว: { load: { RB: { "2026-10-12": 240 } }, unplaced: [{ job, code, minutes }] }
  // unplaced = ช่วงที่วางแผนไม่มีวันทำงานของศูนย์งานนั้นเลย (เช่น ใบงาน 1 วันตกวันเสาร์) จึงไม่มีวันให้ลงภาระ
  function dailyLoad(jobs, centers) {
    const byCode = new Map((centers ?? []).map((center) => [String(center.code).toUpperCase(), center]));
    const load = {};
    const unplaced = [];
    for (const job of jobs ?? []) {
      if (!isActive(job) || !isScheduled(job)) continue;
      for (const [code, minutes] of Object.entries(remainingLoad(job))) {
        const center = byCode.get(code);
        if (!center || minutes <= 0) continue;
        const dates = workingDatesIn(center, job.planned_start, job.planned_end);
        if (!dates.length) { unplaced.push({ job, code, minutes }); continue; }
        load[code] ??= {};
        for (const date of dates) load[code][date] = (load[code][date] ?? 0) + minutes / dates.length;
      }
    }
    return { load, unplaced };
  }

  // วันที่ภาระเกินกำลัง: [{ code, date, load, capacity, percent }] เรียงตามศูนย์งานแล้ววันที่
  function overloads(load, centers) {
    const rows = [];
    for (const center of centers ?? []) {
      const code = String(center.code).toUpperCase();
      const capacity = capacityMinutes(center);
      for (const [date, minutes] of Object.entries(load?.[code] ?? {})) {
        if (minutes > capacity + EPSILON) rows.push({ code, date, load: minutes, capacity, percent: capacity > 0 ? Math.round((minutes / capacity) * 100) : null });
      }
    }
    return rows.sort((a, b) => a.code.localeCompare(b.code) || a.date.localeCompare(b.date));
  }
  // ระดับสีของการใช้กำลัง: "ok" | "warn" | "over"
  function utilizationLevel(minutes, capacity) {
    if (!(capacity > 0) || minutes > capacity + EPSILON) return "over";
    return minutes / capacity > WARN_RATIO ? "warn" : "ok";
  }

  // ---------- จัดกลุ่มตามออเดอร์ ----------
  // ออเดอร์เรียงตามกำหนดส่งแล้วรหัส · ใบงานในกรอบเรียงตามวันเริ่ม (ที่ยังไม่กำหนดตารางอยู่ท้าย) แล้วรหัส
  // start/end = ช่วงรวมของใบงานที่กำหนดตารางแล้ว · late = สิ้นสุดหลังกำหนดส่ง
  function groupByOrder(data) {
    const jobsByOrder = new Map();
    for (const job of data?.jobs ?? []) {
      if (!jobsByOrder.has(job.production_order_id)) jobsByOrder.set(job.production_order_id, []);
      jobsByOrder.get(job.production_order_id).push(job);
    }
    const byStart = (a, b) => (a.planned_start ? 0 : 1) - (b.planned_start ? 0 : 1)
      || String(a.planned_start ?? "").localeCompare(String(b.planned_start ?? "")) || String(a.code).localeCompare(String(b.code));
    return (data?.orders ?? []).slice()
      .sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")) || String(a.code).localeCompare(String(b.code)))
      .map((order) => {
        const jobs = (jobsByOrder.get(order.id) ?? []).slice().sort(byStart);
        const scheduled = jobs.filter(isScheduled);
        const start = scheduled.map((job) => job.planned_start).sort()[0] ?? null;
        const end = scheduled.map((job) => job.planned_end).sort().at(-1) ?? null;
        return { order, jobs, start, end, scheduledCount: scheduled.length, unscheduledCount: jobs.length - scheduled.length, late: Boolean(end && order.due_date && end > order.due_date) };
      })
      .filter((group) => group.jobs.length > 0);
  }

  // ใบงานที่สิ้นสุดหลังกำหนดส่งของใบสั่งผลิต (เฉพาะที่ยังไม่จบ)
  function lateJobs(data) {
    const due = new Map((data?.orders ?? []).map((order) => [order.id, order.due_date]));
    return (data?.jobs ?? []).filter((job) => isActive(job) && isScheduled(job) && due.get(job.production_order_id) && job.planned_end > due.get(job.production_order_id));
  }

  // ใบงานที่เริ่มก่อนใบงานที่ผลิตชิ้นงานที่ตัวเองต้องใช้ (ตาม BOM) จบ: [{ job, needs }] ให้เริ่มวันเดียวกับที่ใบก่อนจบได้
  function conflicts(data) {
    const byId = new Map((data?.jobs ?? []).map((job) => [job.id, job]));
    const rows = [];
    for (const job of data?.jobs ?? []) {
      if (!isActive(job) || !isScheduled(job)) continue;
      for (const id of job.needs ?? []) {
        const needed = byId.get(id);
        if (needed && isScheduled(needed) && job.planned_start < needed.planned_end) rows.push({ job, needs: needed });
      }
    }
    return rows;
  }

  // ---------- ช่วงของแผนภูมิ ----------
  // ครอบทุกแถบ กำหนดส่ง และวันนี้ เผื่อหัวท้ายเล็กน้อย อย่างน้อย 14 วัน
  function range(data, now = today()) {
    const dates = [now];
    for (const job of data?.jobs ?? []) if (isScheduled(job)) dates.push(job.planned_start, job.planned_end);
    for (const order of data?.orders ?? []) if (order.due_date) dates.push(order.due_date);
    const valid = dates.filter(isDate).sort();
    const from = addDays(valid[0], -2);
    let to = addDays(valid.at(-1), 4);
    if (diffDays(from, to) + 1 < 14) to = addDays(from, 13);
    return { from, to, days: diffDays(from, to) + 1 };
  }

  // ---------- ตรวจวันที่ (เหมือนกติกาใน RPC; ฐานข้อมูลตัดสินจริง) ----------
  // คืนรหัสข้อผิดพลาดเดียวกับ RPC หรือ null ถ้าผ่าน
  function validateDates(start, end) {
    if (!isDate(start) || !isDate(end)) return "INVALID_SCHEDULE_DATES";
    if (diffDays(start, end) < 0 || diffDays(start, end) > MAX_WINDOW_DAYS || start < MIN_DATE || end > MAX_DATE) return "INVALID_SCHEDULE_DATES";
    return null;
  }
  const shiftWindow = (job, days) => ({ start: addDays(job.planned_start, days), end: addDays(job.planned_end, days) });

  // ---------- ประมาณวันทำงานของใบงาน (ใช้เติมค่าเริ่มต้น ไม่ได้บังคับ) ----------
  // ขั้นตอนทำตามลำดับ จึงรวม "ภาระ ÷ กำลังต่อวัน" ของทุกขั้นที่ยังรอทำ ปัดขึ้นเป็นวันเต็ม อย่างน้อย 1 วัน ศูนย์งานที่ไม่รู้จักหรือไม่มีกำลังไม่นับ
  function estimateWorkingDays(job, centers) {
    const byCode = new Map((centers ?? []).map((center) => [String(center.code).toUpperCase(), center]));
    let days = 0;
    for (const step of stepsOf(job)) {
      if (step.status === "done") continue;
      const capacity = capacityMinutes(byCode.get(String(step.work_center_code ?? "").toUpperCase()));
      if (capacity > 0) days += stepMinutes(job, step) / capacity;
    }
    return Math.max(1, Math.ceil(days - EPSILON));
  }
  // วันทำงานของใบงาน = วันทำงานของศูนย์งานที่ขั้นที่ยังรอทำใช้ (รวมกัน)
  function jobWorkingDays(job, centers) {
    const byCode = new Map((centers ?? []).map((center) => [String(center.code).toUpperCase(), center]));
    const days = new Set();
    for (const step of stepsOf(job)) {
      if (step.status === "done") continue;
      const center = byCode.get(String(step.work_center_code ?? "").toUpperCase());
      if (center) workingDaysOf(center).forEach((day) => days.add(day));
    }
    return days.size ? days : new Set(DEFAULT_WORKING_DAYS);
  }
  // วันสิ้นสุดที่ครอบจำนวนวันทำงาน n วันนับจาก start (วันเริ่มนับด้วยถ้าเป็นวันทำงาน)
  function endForWorkingDays(start, count, workingDays) {
    let date = start;
    let left = Math.max(1, count);
    for (let guard = 0; guard < 3660; guard += 1) {
      if (workingDays.has(weekday(date))) left -= 1;
      if (left <= 0) return date;
      date = addDays(date, 1);
    }
    return date;
  }
  // ค่าเริ่มต้นสำหรับใบงานที่ยังไม่กำหนดตาราง: เริ่มวันนี้ (หรือหลังใบงานที่ต้องรอจบ) แล้วประมาณวันสิ้นสุด
  function suggestWindow(job, data, now = today()) {
    const byId = new Map((data?.jobs ?? []).map((row) => [row.id, row]));
    const after = (job.needs ?? []).map((id) => byId.get(id)).filter((row) => row && isScheduled(row)).map((row) => row.planned_end);
    const start = [now, ...after].sort().at(-1);
    const centers = data?.work_centers ?? [];
    return { start, end: endForWorkingDays(start, estimateWorkingDays(job, centers), jobWorkingDays(job, centers)) };
  }

  // ---------- ตัวเลขสรุปและเปอร์เซ็นต์ความคืบหน้า ----------
  function progress(job) {
    const steps = stepsOf(job);
    const done = steps.filter((step) => step.status === "done").length;
    return { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 0 };
  }
  function summary(data, now = today()) {
    const jobs = (data?.jobs ?? []).filter(isActive);
    const { load, unplaced } = dailyLoad(data?.jobs, data?.work_centers);
    return {
      orders: groupByOrder(data).length,
      jobsActive: jobs.length,
      unscheduled: jobs.filter((job) => !isScheduled(job)).length,
      late: lateJobs(data).length,
      conflicts: conflicts(data).length,
      overloadDays: overloads(load, data?.work_centers).length,
      unplaced: unplaced.length,
      today: now,
    };
  }

  const api = {
    ACTIVE_STATUSES, WEEKDAYS, DEFAULT_WORKING_DAYS, MAX_WINDOW_DAYS, MIN_DATE, MAX_DATE,
    isDate, addDays, diffDays, weekday, today, minutesOfDay,
    workingDaysOf, isWorkingDay, capacityMinutes, workingDaysLabel,
    isActive, isScheduled, batches, stepMinutes, remainingLoad, workingDatesIn, dailyLoad, overloads, utilizationLevel,
    groupByOrder, lateJobs, conflicts, range, validateDates, shiftWindow,
    estimateWorkingDays, jobWorkingDays, endForWorkingDays, suggestWindow, progress, summary,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_GANTT_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
