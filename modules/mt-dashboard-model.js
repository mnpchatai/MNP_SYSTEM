// Dashboard model for the MT repair dashboard (#/mt-dashboard). One derived row per MT request; every figure on the
// page is computed from the same rows, so any number can be traced back to the requests behind it (drill-through).
//
// Rules this module enforces (agreed definitions):
// - Two bases, never mixed in one number. Backlog figures (open, overdue, urgent, stage board, "act now") cover EVERY
//   open request the account can see, whatever its submit date, so an old request never drops out of view when the
//   period changes. Period figures (total, completed, cycle time, on-time, quality) belong to the period of the submit date.
// - "Open" is exactly the request center's pending list for MT_REPAIR (MNP_REQUEST_CENTER.pendingStatuses), so the
//   dashboard's open count matches "ยังไม่จบ N รายการ" in the module header for the same visibility scope.
// - Cancelled requests and drafts are never counted. Rejected requests count in the total but not in time figures.
// - Overdue = the technician owns the job (assigned / in_progress) and the latest expected finish date has passed.
//   Waiting on approvers or on the requester is never "overdue" because the technician cannot act on it.
// - On-time = completed on or before the latest expected finish date; an open overdue job counts as late.
// - Stage durations come from request_status_history and only count a stage once it has actually been left.
//
// No DOM and no Supabase here: the loader passes plain rows and today's Bangkok date, so Node tests cover it.
(function registerMtDashboardModel(root) {
  // UMD: this static Pilot helper is also tested directly in Node without a bundler.
  const pendingStatuses = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const center = typeof module !== "undefined" && module.exports ? require("./request-center.js") : root.MNP_REQUEST_CENTER;
    return center.pendingStatuses("MT_REPAIR");
  };

  const DAY_MS = 86400000;
  const EXCLUDED_STATUSES = ["draft", "cancelled"];
  const TECHNICIAN_STATUSES = ["assigned", "in_progress"];

  // Where an open request is waiting, in workflow order. `short` is the badge text, `owner` who must act.
  const STAGES = [
    { key: "approve_fm", label: "รอ ผจก.โรงงาน อนุมัติ", short: "รออนุมัติ (ผจก.โรงงาน)", owner: "ผจก.โรงงาน" },
    { key: "approve_gm", label: "รอ ผจก.ทั่วไป อนุมัติ", short: "รออนุมัติ (ผจก.ทั่วไป)", owner: "ผจก.ทั่วไป" },
    { key: "more_info", label: "รอผู้แจ้งตอบข้อมูลเพิ่ม", short: "ขอข้อมูลเพิ่ม", owner: "ผู้แจ้ง" },
    { key: "assign", label: "รอมอบหมายช่าง", short: "รอมอบหมายช่าง", owner: "ผจก.ซ่อมบำรุง" },
    { key: "start", label: "รอช่างเริ่มงาน", short: "รอช่างเริ่มงาน", owner: "ช่าง" },
    { key: "repair", label: "กำลังซ่อม", short: "กำลังซ่อม", owner: "ช่าง" },
    { key: "verify", label: "รอผู้แจ้งตรวจรับ", short: "รอตรวจรับ", owner: "ผู้แจ้ง" },
    // Not part of the repair workflow; kept so stage counts always add up to the open count.
    { key: "approved", label: "อนุมัติแล้ว รอดำเนินการ", short: "อนุมัติแล้ว", owner: "—" },
  ];
  const STAGE_BY_KEY = Object.fromEntries(STAGES.map((stage) => [stage.key, stage]));

  // Time spent between workflow events. Each phase only exists once both ends happened.
  const PHASES = [
    { key: "approval", label: "อนุมัติ (แจ้ง → ผ่านผู้อนุมัติครบ)", owner: "ผจก.โรงงาน และ ผจก.ทั่วไป" },
    { key: "assign", label: "รอมอบหมายช่าง", owner: "ผจก.ซ่อมบำรุง" },
    { key: "repair", label: "ซ่อม (มอบหมายแล้ว → ส่งตรวจรับ)", owner: "ช่าง" },
    { key: "verify", label: "รอผู้แจ้งตรวจรับ → ปิดงาน", owner: "ผู้แจ้ง" },
  ];

  const bangkokDate = (timestamp) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(timestamp));
  const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
  const daysBetween = (from, to) => Math.round(dayNumber(to) - dayNumber(from));
  // Fractional days between two timestamps, or null while either end is missing.
  const gapDays = (from, to) => (from && to ? Math.max(0, (Date.parse(to) - Date.parse(from)) / DAY_MS) : null);
  const rate = (part, whole) => (whole ? part / whole : null);
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  function stageOf(row) {
    switch (row.status) {
      case "pending_approval": return Number(row.current_step) >= 2 ? "approve_gm" : "approve_fm";
      case "more_info": return "more_info";
      case "pending_assign": return "assign";
      case "assigned": return "start";
      case "in_progress": return "repair";
      case "pending_verify": return "verify";
      case "approved": return "approved";
      default: return null;
    }
  }

  // requests: rows as loaded by the dashboard (see module-mt-dashboard.js):
  //   { id, request_no, status, current_step, is_urgent, doc_type, machine_code, machine_name, requester_name,
  //     dept (department code), submitted_at, completed_at, work_expected_date,
  //     history: [{ to_status, created_at }], verifications: [{ result }] }
  function deriveRows(requests, today) {
    const open = pendingStatuses();
    return requests.filter((request) => !EXCLUDED_STATUSES.includes(request.status)).map((request) => {
      const history = [...(request.history ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      const firstTo = (status) => history.find((item) => item.to_status === status)?.created_at ?? null;
      const lastTo = (status) => [...history].reverse().find((item) => item.to_status === status)?.created_at ?? null;
      const status = request.status;
      const isOpen = open.includes(status);
      const isCompleted = status === "completed";
      const submittedOn = bangkokDate(request.submitted_at);
      const completedOn = isCompleted && request.completed_at ? bangkokDate(request.completed_at) : null;
      const sinceOn = history.length ? bangkokDate(history[history.length - 1].created_at) : submittedOn;
      const expected = request.work_expected_date ?? null;
      const overdue = TECHNICIAN_STATUSES.includes(status) && Boolean(expected) && today > expected;
      const pastRepair = status === "pending_verify" || isCompleted;
      const verifications = request.verifications ?? [];
      return {
        ...request,
        history,
        verifications,
        year: submittedOn.slice(0, 4),
        month: Number(submittedOn.slice(5, 7)),
        submittedOn,
        completedOn,
        isOpen,
        isCompleted,
        isRejected: status === "rejected",
        isUrgent: Boolean(request.is_urgent),
        stage: isOpen ? stageOf(request) : null,
        daysInStatus: isOpen ? Math.max(0, daysBetween(sinceOn, today)) : 0,
        overdue,
        daysOverdue: overdue ? daysBetween(expected, today) : 0,
        cycleDays: isCompleted ? gapDays(request.submitted_at, request.completed_at) : null,
        onTime: isCompleted && expected && completedOn ? completedOn <= expected : null,
        phases: status === "rejected" ? {} : {
          approval: gapDays(request.submitted_at, firstTo("pending_assign")),
          assign: gapDays(firstTo("pending_assign"), firstTo("assigned")),
          // A failed inspection sends the job back to the technician, so its rework counts as repair time.
          repair: pastRepair ? gapDays(firstTo("assigned"), lastTo("pending_verify")) : null,
          verify: isCompleted ? gapDays(lastTo("pending_verify"), request.completed_at) : null,
        },
        verifyCount: verifications.length,
        verifyFailed: verifications.some((item) => item.result === "fail"),
        hadMoreInfo: history.some((item) => item.to_status === "more_info"),
      };
    });
  }

  // filters: { year, from, to, dept, doc } select by submit-date period and the shared dimensions.
  function select(rows, filters, options = {}) {
    return rows.filter((row) => {
      if (!options.ignorePeriod && !(row.year === filters.year && row.month >= filters.from && row.month <= filters.to)) return false;
      if (filters.dept && row.dept !== filters.dept) return false;
      if (filters.doc && row.doc_type !== filters.doc) return false;
      return true;
    });
  }

  // Every open request regardless of period (dept / doc filters still apply).
  const backlog = (rows, filters) => select(rows, filters, { ignorePeriod: true }).filter((row) => row.isOpen);

  // The rows behind the drill-through list. A backlog filter (scope / stage) switches to the backlog basis so the list
  // matches the backlog tiles; otherwise the list is the selected period.
  function listFor(rows, filters) {
    if (!filters.scope && !filters.stage) return { list: select(rows, filters), basis: "period" };
    const list = backlog(rows, filters).filter((row) => {
      if (filters.scope === "overdue" && !row.overdue) return false;
      if (filters.scope === "urgent" && !row.isUrgent) return false;
      if (filters.stage && row.stage !== filters.stage) return false;
      return true;
    });
    return { list, basis: "backlog" };
  }

  function summarize(list) {
    const result = {
      total: list.length, open: 0, completed: 0, rejected: 0, urgentOpen: 0, overdue: 0,
      onTime: 0, onTimeBase: 0, verified: 0, verifyFailed: 0, moreInfo: 0,
    };
    const cycles = [];
    for (const row of list) {
      if (row.isOpen) result.open += 1;
      if (row.isCompleted) result.completed += 1;
      if (row.isRejected) result.rejected += 1;
      if (row.isOpen && row.isUrgent) result.urgentOpen += 1;
      if (row.overdue) result.overdue += 1;
      if (row.cycleDays !== null) cycles.push(row.cycleDays);
      // A job still overdue counts as late, so on-time cannot be flattered by leaving late jobs open.
      if (row.onTime !== null) { result.onTimeBase += 1; if (row.onTime) result.onTime += 1; }
      else if (row.overdue) result.onTimeBase += 1;
      if (row.verifyCount > 0) { result.verified += 1; if (row.verifyFailed) result.verifyFailed += 1; }
      if (row.hadMoreInfo) result.moreInfo += 1;
    }
    result.cycleCount = cycles.length;
    result.avgCycle = mean(cycles);
    result.medianCycle = median(cycles);
    result.completedRate = rate(result.completed, result.total);
    result.onTimeRate = rate(result.onTime, result.onTimeBase);
    result.verifyFailRate = rate(result.verifyFailed, result.verified);
    result.moreInfoRate = rate(result.moreInfo, result.total);
    return result;
  }

  // One entry per stage (workflow order) over the open rows given. Counts add up to the number of open rows.
  function stageSummary(openRows) {
    return STAGES.map((stage) => {
      const rows = openRows.filter((row) => row.stage === stage.key);
      const ages = rows.map((row) => row.daysInStatus);
      return {
        ...stage,
        count: rows.length,
        avgDays: mean(ages),
        maxDays: ages.length ? Math.max(...ages) : null,
        overdue: rows.filter((row) => row.overdue).length,
        urgent: rows.filter((row) => row.isUrgent).length,
      };
    });
  }

  function phaseSummary(list) {
    return PHASES.map((phase) => {
      const values = list.map((row) => row.phases?.[phase.key]).filter((value) => value !== null && value !== undefined);
      return { ...phase, n: values.length, avgDays: mean(values), medianDays: median(values) };
    });
  }

  // Open requests that need action: overdue first, then urgent, then the longest in their current stage.
  function priority(openRows, limit = 10) {
    return [...openRows]
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.isUrgent) - Number(a.isUrgent) || b.daysInStatus - a.daysInStatus)
      .slice(0, limit);
  }

  const api = { STAGES, STAGE_BY_KEY, PHASES, EXCLUDED_STATUSES, bangkokDate, daysBetween, deriveRows, select, backlog, listFor, summarize, stageSummary, phaseSummary, priority };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_MT_DASHBOARD = api;
})(typeof window !== "undefined" ? window : globalThis);
