// Counts use one report, costs use one active ledger row, outcomes use one verified final result.
(function registerNcrAnalysis(root) {
  // UMD: this static Pilot helper is also tested directly in Node without a bundler.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const costs = typeof module !== "undefined" && module.exports ? require("./ncr-costs.js") : root.MNP_NCR_COSTS;
  const inPeriod = (date, f) => Boolean(date) && date.slice(0, 4) === f.year && Number(date.slice(5, 7)) >= f.from && Number(date.slice(5, 7)) <= f.to;
  function aggregate(reports, filters, labels, overdue) {
    const matching = reports.filter((r) => r.status !== "cancelled" && (!filters.dept || r.responsibilities.some((d) => d.dept === filters.dept)) && (!filters.defect || r.defect?.code === filters.defect) && (!filters.source || r.source === filters.source));
    const weightOf = (r) => filters.dept ? r.responsibilities.find((d) => d.dept === filters.dept)?.share ?? 0 : 1;
    const scopeLosses = (r) => (r.losses ?? []).filter((l) => !l.voided_at && inPeriod(filters.basis === "issue" ? r.issue_date : l.incurred_on, filters));
    const rows = matching.filter((r) => inPeriod(r.issue_date, filters)).map((r) => ({ ...r, weight: weightOf(r) }));
    const financialRows = matching.map((r) => ({ ...r, weight: weightOf(r), losses: scopeLosses(r), financial: costs.summarize(scopeLosses(r)) })).filter((r) => r.losses.length);
    const valueOf = (r) => (r.financial?.confirmed ?? costs.summarize(scopeLosses(r)).confirmed) * weightOf(r);
    const metricRows = filters.metric === "value" ? financialRows : rows;
    const metricOf = (r) => filters.metric === "value" ? valueOf(r) : 1;
    const group = (keysOf) => {
      const map = new Map();
      for (const r of metricRows) for (const [key, label, share] of keysOf(r)) {
        const entry = map.get(key) ?? { key, label, value: 0, total: 0, closed: 0 };
        entry.value += metricOf(r) * share; entry.total++; if (r.status === "closed") entry.closed++;
        map.set(key, entry);
      }
      return [...map.values()].filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
    };
    const byDept = group((r) => (r.responsibilities.length ? r.responsibilities : [{ dept: "", share: 1 }]).filter((d) => !filters.dept || d.dept === filters.dept).map((d) => [d.dept, d.dept || "ยังไม่กำหนดแผนก", filters.metric === "value" ? filters.dept ? 1 : d.share : 1]));
    const totals = { value: 0, recovery: 0, estimated: 0, estimatedRecovery: 0, legacy: 0 };
    for (const r of financialRows) {
      totals.value += r.financial.confirmed * r.weight;
      for (const key of ["recovery", "estimated", "estimatedRecovery", "legacy"]) totals[key] += r.financial[key] * r.weight;
    }
    const units = new Map();
    for (const r of rows) {
      const e = units.get(r.unit) ?? { unit: r.unit, defect: 0, total: 0, count: 0, scrap: 0, repaired: 0, returned: 0, verified: 0 };
      e.defect += Number(r.qty_defect); e.total += Number(r.qty_total); e.count++;
      if (r.outcome?.result_status === "confirmed") { e.verified++; e.scrap += Number(r.outcome.qty_scrapped); e.repaired += Number(r.outcome.qty_repaired); e.returned += Number(r.outcome.qty_returned); }
      units.set(r.unit, e);
    }
    const months = [];
    for (let month = filters.from; month <= filters.to; month++) {
      const list = rows.filter((r) => Number(r.issue_date.slice(5, 7)) === month);
      let open = 0, closed = 0;
      if (filters.metric === "value") for (const r of financialRows) for (const l of r.losses) {
        if (l.cost_status !== "confirmed" || l.entry_kind === "recovery") continue;
        if (Number((filters.basis === "issue" ? r.issue_date : l.incurred_on).slice(5, 7)) === month) {
          if (r.status === "closed") closed += Number(l.amount) * r.weight; else open += Number(l.amount) * r.weight;
        }
      }
      else { closed = list.filter((r) => r.status === "closed").length; open = list.length - closed; }
      months.push({ month, closed, open, count: list.length, closedCount: list.filter((r) => r.status === "closed").length });
    }
    const responded = rows.filter((r) => r.respondedDate && r.response_due);
    const days = rows.filter((r) => r.closedDate).map((r) => Math.round((Date.parse(r.closedDate) - Date.parse(r.issue_date)) / 86400000)).sort((a, b) => a - b);
    return {
      ...totals, net: costs.round(totals.value - totals.recovery), rows, financialRows, total: rows.length, closed: rows.filter((r) => r.status === "closed").length,
      pendingAssessment: rows.filter((r) => !r.outcome?.cost_reviewed || costs.summarize(r.losses ?? []).pending > 0).length,
      unverifiedOutcomes: rows.filter((r) => r.outcome?.result_status !== "confirmed").length,
      responded: responded.length, onTime: responded.filter((r) => r.respondedDate <= r.response_due).length,
      medianDays: days.length ? (days[Math.floor((days.length - 1) / 2)] + days[Math.ceil((days.length - 1) / 2)]) / 2 : null,
      overdue: rows.filter(overdue).length, ngRate: null,
      byDefect: group((r) => [[r.defect?.code ?? "", r.defect?.name_th ?? "ไม่ระบุ", 1]]), byDept,
      byCause: group((r) => r.causes?.length ? r.causes.map((c) => [c, labels.CAUSES[c] ?? c, 1 / r.causes.length]) : [["", "ยังไม่ได้วิเคราะห์สาเหตุ", 1]]),
      bySource: group((r) => [[r.source, labels.SOURCES[r.source] ?? r.source, 1]]),
      byStatus: labels.STATUS_ORDER.map((s) => ({ key: s, label: labels.STATUS_LABELS[s], value: metricRows.filter((r) => r.status === s).reduce((n, r) => n + metricOf(r), 0) })),
      byLossType: Object.entries(costs.TYPES).map(([key, label]) => ({ key, label, value: financialRows.reduce((sum, r) => sum + r.losses.filter((l) => l.loss_type === key && l.cost_status === "confirmed" && l.entry_kind !== "recovery").reduce((n, l) => n + Number(l.amount), 0) * r.weight, 0) })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value),
      units: [...units.values()].sort((a, b) => b.count - a.count), months,
      top: financialRows.filter((r) => valueOf(r) > 0).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 10), valueOf,
    };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { aggregate };
  else root.MNP_NCR_ANALYSIS = { aggregate };
})(typeof window !== "undefined" ? window : globalThis);
