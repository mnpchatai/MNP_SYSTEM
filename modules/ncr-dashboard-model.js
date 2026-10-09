// Dashboard model for the NCR dashboard. One derived row per NCR; every figure on the page is computed from
// the same selected list, so any number can be traced back to the NCR rows behind it (drill-through).
//
// Rules this module enforces (agreed definitions):
// - One time basis: an NCR belongs to the period of its issue date, and its money is the lifetime total of that NCR.
// - NCR counts are whole reports. A report with several departments or causes is counted in every group, so
//   groups overlap and must not be summed. Only money is split by the department share.
// - The 5-day response clock starts when the NCR reaches the responsible department (sla_started_on, taken from
//   ncr_status_history by the loader), not at the issue date. Reports still awaiting disposition have no clock.
// - Headline money is confirmed only. Estimated and legacy amounts are reported separately, never as zero.
//
// No DOM and no Supabase here: the loader passes plain rows and today's Bangkok date, so Node tests cover it.
(function registerNcrDashboardModel(root) {
  // UMD: this static Pilot helper is also tested directly in Node without a bundler.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const costs = typeof module !== "undefined" && module.exports ? require("./ncr-costs.js") : root.MNP_NCR_COSTS;

  const SLA_DAYS = 5;
  const NO_CAUSE = "_none";
  const DISPOSITION_STATUS = "awaiting_disposition";
  const RESPONSE_STATUS = "awaiting_response";
  const OPEN_STATUSES = ["awaiting_disposition", "awaiting_response", "awaiting_followup", "awaiting_signoff", "awaiting_info"];
  // Cost assessment is expected once the factory manager has decided the disposition.
  const ASSESSMENT_STATUSES = ["awaiting_response", "awaiting_followup", "awaiting_signoff", "awaiting_info", "closed"];

  const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
  const addDays = (iso, days) => new Date((dayNumber(iso) + days) * 86400000).toISOString().slice(0, 10);
  const daysBetween = (from, to) => Math.round(dayNumber(to) - dayNumber(from));
  const rate = (part, whole) => (whole ? part / whole : null);

  // reports: rows as loaded by the dashboard (see module-ncr-dashboard.js) plus optional
  //   sla_started_on (date the report last entered awaiting_response) and last_change_on (date of last status change).
  function deriveRows(reports, today) {
    return reports.filter((report) => report.status !== "cancelled").map((report) => {
      const losses = (report.losses ?? []).filter((loss) => !loss.voided_at);
      const fin = costs.summarize(losses);
      const status = report.status;
      const isOpen = OPEN_STATUSES.includes(status);
      const awaitingResponse = status === RESPONSE_STATUS;
      const clockRuns = status !== DISPOSITION_STATUS;
      const slaDue = clockRuns ? (report.sla_started_on ? addDays(report.sla_started_on, SLA_DAYS) : report.response_due ?? null) : null;
      const overdue = awaitingResponse && Boolean(slaDue) && today > slaDue;
      // A response only counts while it is current: a report sent back to awaiting_response is not "responded".
      const hasResponse = Boolean(report.respondedDate) && clockRuns && !awaitingResponse;
      const needsAssess = ASSESSMENT_STATUSES.includes(status);
      const sinceDate = report.last_change_on ?? report.sla_started_on ?? report.issue_date;
      return {
        ...report,
        losses,
        fin,
        causes: report.causes ?? [],
        responsibilities: report.responsibilities ?? [],
        year: report.issue_date.slice(0, 4),
        month: Number(report.issue_date.slice(5, 7)),
        isOpen,
        isClosed: status === "closed",
        slaDue,
        overdue,
        hasResponse,
        onTime: hasResponse && slaDue ? report.respondedDate <= slaDue : null,
        needsAssess,
        assessed: needsAssess && report.outcome?.cost_reviewed === true && fin.pending === 0,
        daysInStatus: isOpen ? Math.max(0, daysBetween(sinceDate, today)) : 0,
      };
    });
  }

  // filters: { year, from, to, dept, defect, source, cause, loss, scope } where scope is "", "open" or "overdue" and
  // loss is a cost type key: keeps reports that have at least one confirmed or estimated loss entry of that type.
  function select(rows, filters, options = {}) {
    return rows.filter((row) => {
      if (!options.ignorePeriod && !(row.year === filters.year && row.month >= filters.from && row.month <= filters.to)) return false;
      if (filters.dept && !row.responsibilities.some((item) => item.dept === filters.dept)) return false;
      if (filters.defect && row.defect?.code !== filters.defect) return false;
      if (filters.source && row.source !== filters.source) return false;
      if (filters.cause && !(filters.cause === NO_CAUSE ? row.causes.length === 0 : row.causes.includes(filters.cause))) return false;
      if (filters.loss && !row.losses.some((loss) => loss.loss_type === filters.loss && loss.entry_kind !== "recovery" && (loss.cost_status ?? "legacy") !== "legacy")) return false;
      if (filters.scope === "open" && !row.isOpen) return false;
      if (filters.scope === "overdue" && !row.overdue) return false;
      return true;
    });
  }

  // Share of the NCR's money that belongs to the filtered department (1 when no department filter).
  const weightOf = (row, filters) => (filters.dept ? row.responsibilities.find((item) => item.dept === filters.dept)?.share ?? 0 : 1);

  function summarize(list, filters) {
    const result = {
      total: list.length, closed: 0, open: 0, overdue: 0, responded: 0, onTime: 0,
      gross: 0, recovery: 0, net: 0, estimated: 0, estimatedRecovery: 0, legacy: 0, need: 0, assessed: 0,
    };
    for (const row of list) {
      const weight = weightOf(row, filters);
      if (row.isClosed) result.closed += 1;
      if (row.isOpen) result.open += 1;
      if (row.overdue) result.overdue += 1;
      if (row.hasResponse) { result.responded += 1; if (row.onTime) result.onTime += 1; }
      result.gross += row.fin.confirmed * weight;
      result.recovery += row.fin.recovery * weight;
      result.estimated += row.fin.estimated * weight;
      result.estimatedRecovery += row.fin.estimatedRecovery * weight;
      result.legacy += row.fin.legacy * weight;
      if (row.needsAssess) { result.need += 1; if (row.assessed) result.assessed += 1; }
    }
    for (const key of ["gross", "recovery", "estimated", "estimatedRecovery", "legacy"]) result[key] = costs.round(result[key]);
    result.net = costs.round(result.gross - result.recovery);
    // On-time rate counts a report that is still unanswered past its deadline as late.
    result.slaBase = result.responded + result.overdue;
    result.onTimeRate = rate(result.onTime, result.slaBase);
    result.closedRate = rate(result.closed, result.total);
    result.assessedRate = rate(result.assessed, result.need);
    return result;
  }

  // Month series for the trend charts. Ignores the period filter (shows the whole year) but keeps every other filter.
  function monthly(rows, filters, lastMonth = 12) {
    const base = select(rows, filters, { ignorePeriod: true }).filter((row) => row.year === filters.year);
    const months = [];
    for (let month = 1; month <= lastMonth; month += 1) {
      const list = base.filter((row) => row.month === month);
      const sums = summarize(list, filters);
      months.push({ month, count: list.length, closed: sums.closed, open: list.length - sums.closed, net: sums.net, estimated: sums.estimated });
    }
    return months;
  }

  // Month series split by responsible department, for the stacked count chart. Same period handling as monthly().
  // Counts are whole reports per department (like deptTable): a report owned by two departments appears in both,
  // so the department counts of a month can add up to more than `count`, which is the number of distinct reports.
  // A report with no responsibility rows falls into the "" department. A department filter keeps only that department.
  // Departments inside a month are ordered by code ("" last) so a stack keeps the same order in every month.
  function monthlyByDept(rows, filters, lastMonth = 12) {
    const base = select(rows, filters, { ignorePeriod: true }).filter((row) => row.year === filters.year);
    const order = (a, b) => (a.dept === "" ? 1 : b.dept === "" ? -1 : a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : 0);
    const months = [];
    for (let month = 1; month <= lastMonth; month += 1) {
      const list = base.filter((row) => row.month === month);
      const depts = new Map();
      for (const row of list) {
        const owners = row.responsibilities.length ? row.responsibilities : [{ dept: "" }];
        for (const owner of new Set(owners.map((item) => item.dept))) {
          if (filters.dept && owner !== filters.dept) continue;
          const entry = depts.get(owner) ?? { dept: owner, count: 0, closed: 0, open: 0 };
          entry.count += 1;
          if (row.isClosed) entry.closed += 1; else entry.open += 1;
          depts.set(owner, entry);
        }
      }
      const closed = list.filter((row) => row.isClosed).length;
      months.push({ month, count: list.length, closed, open: list.length - closed, depts: [...depts.values()].sort(order) });
    }
    return months;
  }

  // Month series for the stacked money chart. Same period handling as monthly(). Per month: confirmed loss by cost type
  // (before recovery, from lossesByType so it reconciles with summarize().gross), plus estimated, recovery and net.
  // Recovery has no cost type of its own, so net cannot be split by type: it is reported next to the type breakdown.
  function monthlyByLossType(rows, filters, lastMonth = 12) {
    const base = select(rows, filters, { ignorePeriod: true }).filter((row) => row.year === filters.year);
    const months = [];
    for (let month = 1; month <= lastMonth; month += 1) {
      const list = base.filter((row) => row.month === month);
      const sums = summarize(list, filters);
      const types = lossesByType(list, filters).filter((item) => item.confirmed > 0).map((item) => ({ type: item.key, confirmed: item.confirmed }));
      months.push({ month, count: list.length, types, gross: sums.gross, recovery: sums.recovery, net: sums.net, estimated: sums.estimated });
    }
    return months;
  }

  // Defect-type Pareto. metric is "net" (confirmed net baht) or "count". vital = still inside the first 80%.
  function pareto(list, filters, metric = "net") {
    const groups = new Map();
    for (const row of list) {
      const key = row.defect?.code ?? "";
      const entry = groups.get(key) ?? { key, label: row.defect?.name_th ?? "ไม่ระบุ", count: 0, net: 0 };
      entry.count += 1;
      entry.net += row.fin.net * weightOf(row, filters);
      groups.set(key, entry);
    }
    const items = [...groups.values()].map((entry) => ({ ...entry, net: costs.round(entry.net) })).filter((entry) => entry[metric] > 0).sort((a, b) => b[metric] - a[metric]);
    const sum = items.reduce((total, entry) => total + entry[metric], 0);
    let running = 0;
    return items.map((entry) => {
      const before = running;
      running += entry[metric];
      return { ...entry, share: rate(entry[metric], sum), cumulative: rate(running, sum), vital: sum ? before / sum < 0.8 : true };
    });
  }

  // Loss by cost type. Confirmed and estimated are kept apart; recovery and legacy entries are not part of the bars
  // (recovery is reported as its own total). Money follows the department share, so confirmed adds up to summarize().gross.
  function lossesByType(list, filters) {
    const types = new Map();
    for (const row of list) {
      const weight = weightOf(row, filters);
      const counted = new Set();
      for (const loss of row.losses) {
        const status = loss.cost_status ?? "legacy";
        if (loss.entry_kind === "recovery" || status === "legacy") continue;
        const entry = types.get(loss.loss_type) ?? { key: loss.loss_type, confirmed: 0, estimated: 0, count: 0 };
        entry[status === "confirmed" ? "confirmed" : "estimated"] += Number(loss.amount) * weight;
        if (!counted.has(loss.loss_type)) { counted.add(loss.loss_type); entry.count += 1; }
        types.set(loss.loss_type, entry);
      }
    }
    const items = [...types.values()].map((entry) => ({ ...entry, confirmed: costs.round(entry.confirmed), estimated: costs.round(entry.estimated) }))
      .filter((entry) => entry.confirmed + entry.estimated > 0)
      .sort((a, b) => b.confirmed - a.confirmed || b.estimated - a.estimated);
    const confirmedTotal = items.reduce((sum, entry) => sum + entry.confirmed, 0);
    return items.map((entry) => ({ ...entry, share: rate(entry.confirmed, confirmedTotal) }));
  }

  // Whole-report counts per key. Keys may overlap (a report with two causes appears in both rows).
  function countBy(list, keysOf) {
    const counts = new Map();
    for (const row of list) for (const key of keysOf(row)) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  }
  const causeKeys = (row) => (row.causes.length ? row.causes : [NO_CAUSE]);

  // Department table. Counts are whole reports (overlapping); money is split by share, so net sums to summarize().net.
  function deptTable(list, filters) {
    const depts = new Map();
    for (const row of list) {
      const items = row.responsibilities.length ? row.responsibilities : [{ dept: "", share: 1 }];
      for (const item of items) {
        if (filters.dept && item.dept !== filters.dept) continue;
        const entry = depts.get(item.dept) ?? { dept: item.dept, list: [], net: 0 };
        entry.list.push(row);
        entry.net += row.fin.net * item.share;
        depts.set(item.dept, entry);
      }
    }
    const rows = [...depts.values()].map((entry) => {
      const sums = summarize(entry.list, {});
      return { dept: entry.dept, count: entry.list.length, open: sums.open, overdue: sums.overdue, onTimeRate: sums.onTimeRate, net: costs.round(entry.net) };
    }).sort((a, b) => b.count - a.count);
    return { rows, total: summarize(list, filters) };
  }

  // Actual outcomes per unit. Units never merge; only confirmed outcomes add to scrapped/repaired/returned.
  function outcomesByUnit(list) {
    const units = new Map();
    for (const row of list) {
      const entry = units.get(row.unit) ?? { unit: row.unit, count: 0, defect: 0, verified: 0, scrapped: 0, repaired: 0, returned: 0 };
      entry.count += 1;
      entry.defect += Number(row.qty_defect);
      if (row.outcome?.result_status === "confirmed") {
        entry.verified += 1;
        entry.scrapped += Number(row.outcome.qty_scrapped);
        entry.repaired += Number(row.outcome.qty_repaired);
        entry.returned += Number(row.outcome.qty_returned);
      }
      units.set(row.unit, entry);
    }
    return [...units.values()].sort((a, b) => b.count - a.count);
  }

  // Open reports that need action, overdue first and then the longest in their current status.
  function priority(list, limit = 5) {
    return list.filter((row) => row.isOpen).sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.daysInStatus - a.daysInStatus).slice(0, limit);
  }

  const api = { SLA_DAYS, NO_CAUSE, OPEN_STATUSES, ASSESSMENT_STATUSES, addDays, deriveRows, select, weightOf, summarize, monthly, monthlyByDept, monthlyByLossType, pareto, lossesByType, countBy, causeKeys, deptTable, outcomesByUnit, priority };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_NCR_DASHBOARD = api;
})(typeof window !== "undefined" ? window : globalThis);
