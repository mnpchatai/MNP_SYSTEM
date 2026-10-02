// แดชบอร์ด NCR ของ Pilot Web (#/ncr-dashboard) — วิเคราะห์ปริมาณของเสีย ประเภท มูลค่าความสูญเสีย
// และอัตราการแก้ไขปัญหา จากตาราง ncr_* (20261002020000_ncr_phase1.sql)
//
// - อ่านผ่าน RLS เดียวกับทะเบียน NCR ทุกคนจึงเห็นตัวเลขเฉพาะ NCR ที่ตัวเองมีสิทธิ์เห็น (QA และผู้บริหารเห็นทั้งหมด)
// - ไม่นับ NCR ที่ยกเลิก และไม่นับรายการความสูญเสียที่ถูกยกเลิก
// - กรองแผนก = นับเฉพาะ NCR ที่แผนกนั้นรับผิดชอบ และถ่วงจำนวน/มูลค่าตามสัดส่วนความรับผิดชอบ (แทนการนับ 0.5 ในชีตเดิม)
// - ตัวกรองอยู่ใน URL (#/ncr-dashboard?year=…) แชร์ลิงก์มุมมองเดียวกันได้ กดแท่งกราฟเพื่อกรองต่อ
//
// โหลดหลัง modules/module-ncr.js (ใช้ป้ายกำกับจาก NCR_CAR.shared) และก่อน app.js — helper ของ app.js
// (sb, state, shell, bindShell, loadingShell, escapeHtml) ถูกเรียกตอนเปิดหน้าเท่านั้น
(function registerNcrDashboard() {
  const ncrModule = window.MNP_REQUEST_MODULES?.NCR_CAR;
  if (!ncrModule?.shared) return;
  const { STATUS_LABELS, OPEN_STATUSES, SOURCES, CAUSES, LOSS_TYPES, todayBangkok, isOverdue, formatQty } = ncrModule.shared;

  const PATH = "ncr-dashboard";
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const STATUS_ORDER = [...OPEN_STATUSES, "closed"];
  const LOSS_ORDER = Object.keys(LOSS_TYPES);
  const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`;
  const CACHE_MS = 60 * 1000;
  let cache = null;

  const bangkokDate = (timestamp) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(timestamp));
  const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  const fmtNumber = (value, digits = 0) => Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: digits });
  const fmtBaht = (value) => `${fmtNumber(Math.round(value))} ฿`;
  const fmtCount = (value) => `${fmtNumber(value, 2)} ใบ`;
  const fmtPercent = (value) => (value === null ? "—" : `${fmtNumber(value * 100, 1)}%`);
  const compactBaht = (value) => (value >= 1000 ? `${fmtNumber(value / 1000, 1)}k` : fmtNumber(value));

  async function loadData(force) {
    const employeeId = state.employee?.id;
    if (!force && cache && cache.employeeId === employeeId && Date.now() - cache.loadedAt < CACHE_MS) return cache;
    const [reportResult, lossResult] = await Promise.all([
      sb.from("ncr_reports")
        .select("id,ncr_no,status,issue_date,product_name,customer_name,qty_total,qty_sampled,qty_defect,unit,source,causes,response_due,responded_at,closed_at,defect_type:ncr_defect_types(code,name_th),ncr_responsibilities(share,department:departments(code))")
        .neq("status", "cancelled")
        .order("issue_date", { ascending: true })
        .limit(5000),
      sb.from("ncr_losses").select("ncr_id,loss_type,amount").is("voided_at", null).limit(20000),
    ]);
    if (reportResult.error) throw reportResult.error;
    if (lossResult.error) throw lossResult.error;
    const lossesByNcr = new Map();
    for (const loss of lossResult.data ?? []) {
      if (!lossesByNcr.has(loss.ncr_id)) lossesByNcr.set(loss.ncr_id, []);
      lossesByNcr.get(loss.ncr_id).push({ type: loss.loss_type, amount: Number(loss.amount) });
    }
    const reports = (reportResult.data ?? []).map((row) => ({
      ...row,
      defect: relation(row.defect_type),
      responsibilities: (row.ncr_responsibilities ?? []).map((item) => ({ dept: relation(item.department)?.code ?? "?", share: Number(item.share) })),
      losses: lossesByNcr.get(row.id) ?? [],
      lossTotal: (lossesByNcr.get(row.id) ?? []).reduce((sum, loss) => sum + loss.amount, 0),
      closedDate: row.closed_at ? bangkokDate(row.closed_at) : null,
      respondedDate: row.responded_at ? bangkokDate(row.responded_at) : null,
    }));
    cache = { employeeId, loadedAt: Date.now(), reports };
    return cache;
  }

  function readFilters(params, reports) {
    const today = todayBangkok();
    const years = [...new Set([today.slice(0, 4), ...reports.map((row) => row.issue_date.slice(0, 4))])].sort();
    const year = years.includes(params.get("year")) ? params.get("year") : today.slice(0, 4);
    const month = (key, fallback) => {
      const value = Number(params.get(key));
      return Number.isInteger(value) && value >= 1 && value <= 12 ? value : fallback;
    };
    const from = month("from", 1);
    const to = Math.max(from, month("to", year === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12));
    return {
      years, year, from, to,
      dept: params.get("dept") ?? "",
      defect: params.get("defect") ?? "",
      source: SOURCES[params.get("source")] ? params.get("source") : "",
      metric: params.get("metric") === "count" ? "count" : "value",
    };
  }

  function hrefWith(filters, changes) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    for (const key of ["year", "from", "to", "dept", "defect", "source", "metric"]) {
      if (next[key] !== "" && next[key] !== undefined && next[key] !== null) params.set(key, next[key]);
    }
    return `#/${PATH}?${params.toString()}`;
  }

  function aggregate(reports, filters) {
    const inPeriod = (row) => row.issue_date.slice(0, 4) === filters.year
      && Number(row.issue_date.slice(5, 7)) >= filters.from && Number(row.issue_date.slice(5, 7)) <= filters.to;
    const weightOf = (row) => (filters.dept ? row.responsibilities.find((item) => item.dept === filters.dept)?.share ?? 0 : 1);
    const rows = reports
      .filter((row) => inPeriod(row) && (!filters.defect || row.defect?.code === filters.defect) && (!filters.source || row.source === filters.source))
      .map((row) => ({ ...row, weight: weightOf(row) }))
      .filter((row) => row.weight > 0);
    const valueOf = (row) => row.lossTotal * row.weight;
    const metricOf = (row) => (filters.metric === "value" ? valueOf(row) : row.weight);
    const isClosed = (row) => row.status === "closed";

    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    const closed = rows.filter(isClosed).reduce((sum, row) => sum + row.weight, 0);
    const value = rows.reduce((sum, row) => sum + valueOf(row), 0);
    const responded = rows.filter((row) => row.respondedDate && row.response_due);
    const onTime = responded.filter((row) => row.respondedDate <= row.response_due);
    const closeDays = rows.filter((row) => row.closedDate).map((row) => daysBetween(row.issue_date, row.closedDate)).sort((a, b) => a - b);
    const medianDays = closeDays.length ? closeDays[Math.floor((closeDays.length - 1) / 2)] : null;
    const sampled = rows.filter((row) => row.qty_sampled);
    const sampledQty = sampled.reduce((sum, row) => sum + Number(row.qty_sampled), 0);
    const ngRate = sampledQty ? sampled.reduce((sum, row) => sum + Number(row.qty_defect), 0) / sampledQty : null;

    const group = (keysOf) => {
      const map = new Map();
      for (const row of rows) {
        for (const [key, label, share] of keysOf(row)) {
          const entry = map.get(key) ?? { key, label, value: 0, total: 0, closed: 0 };
          entry.value += metricOf(row) * share;
          entry.total += row.weight * share;
          if (isClosed(row)) entry.closed += row.weight * share;
          map.set(key, entry);
        }
      }
      return [...map.values()].filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);
    };
    const byDefect = group((row) => [[row.defect?.code ?? "", row.defect?.name_th ?? "ไม่ระบุ", 1]]);
    const byDept = (() => {
      const map = new Map();
      for (const row of rows) {
        const items = row.responsibilities.length ? row.responsibilities : [{ dept: "", share: 1 }];
        for (const item of items) {
          if (filters.dept && item.dept !== filters.dept) continue;
          const entry = map.get(item.dept) ?? { key: item.dept, label: item.dept || "ยังไม่กำหนดแผนก", value: 0, total: 0, closed: 0 };
          entry.value += (filters.metric === "value" ? row.lossTotal : 1) * item.share;
          entry.total += item.share;
          if (isClosed(row)) entry.closed += item.share;
          map.set(item.dept, entry);
        }
      }
      return [...map.values()].filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);
    })();
    const byCause = group((row) => (row.causes?.length
      ? row.causes.map((cause) => [cause, CAUSES[cause] ?? cause, 1 / row.causes.length])
      : [["", "ยังไม่ได้วิเคราะห์สาเหตุ", 1]]));
    const bySource = group((row) => [[row.source, SOURCES[row.source] ?? row.source, 1]]);
    const byStatus = STATUS_ORDER.map((status) => ({
      key: status, label: STATUS_LABELS[status],
      value: rows.filter((row) => row.status === status).reduce((sum, row) => sum + metricOf(row), 0),
    }));
    const byLossType = LOSS_ORDER.map((type) => ({
      key: type, label: LOSS_TYPES[type],
      value: rows.reduce((sum, row) => sum + row.losses.filter((loss) => loss.type === type).reduce((s, loss) => s + loss.amount, 0) * row.weight, 0),
    })).filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);
    const units = (() => {
      const map = new Map();
      for (const row of rows) {
        const entry = map.get(row.unit) ?? { unit: row.unit, defect: 0, total: 0, count: 0 };
        entry.defect += Number(row.qty_defect) * row.weight;
        entry.total += Number(row.qty_total) * row.weight;
        entry.count += row.weight;
        map.set(row.unit, entry);
      }
      return [...map.values()].sort((a, b) => b.count - a.count);
    })();
    const months = [];
    for (let month = filters.from; month <= filters.to; month += 1) {
      const list = rows.filter((row) => Number(row.issue_date.slice(5, 7)) === month);
      months.push({
        month,
        closed: list.filter(isClosed).reduce((sum, row) => sum + metricOf(row), 0),
        open: list.filter((row) => !isClosed(row)).reduce((sum, row) => sum + metricOf(row), 0),
        closedCount: list.filter(isClosed).reduce((sum, row) => sum + row.weight, 0),
        count: list.reduce((sum, row) => sum + row.weight, 0),
      });
    }
    const top = [...rows].filter((row) => valueOf(row) > 0).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 10);
    return {
      rows, total, closed, value, responded: responded.length, onTime: onTime.length, medianDays, ngRate,
      overdue: rows.filter(isOverdue).length, byDefect, byDept, byCause, bySource, byStatus, byLossType, units, months, top, valueOf,
    };
  }

  // ---- กราฟ (HTML ล้วน แท่งเป็นปุ่มเพื่อให้กด/โฟกัสด้วยคีย์บอร์ดได้) ----
  function tipAttrs(title, lines) {
    return `data-tip-title="${escapeHtml(title)}" data-tip-lines="${escapeHtml(JSON.stringify(lines))}"`;
  }

  function tableToggle(id) {
    return `<button class="btn secondary small" type="button" data-table-toggle="${id}" aria-expanded="false" aria-controls="${id}">ดูเป็นตาราง</button>`;
  }

  function barList({ id, rows, fmt, filters, filterKey, pareto = false, showClosed = false, emptyText = "ไม่มีข้อมูลในช่วงที่เลือก" }) {
    if (!rows.length) return `<p class="ncr-dash-empty">${escapeHtml(emptyText)}</p>`;
    const max = Math.max(...rows.map((row) => row.value));
    const sum = rows.reduce((total, row) => total + row.value, 0);
    let running = 0;
    const items = rows.map((row) => {
      const before = running;
      running += row.value;
      const cumulative = sum ? running / sum : 0;
      const vital = !pareto || before / (sum || 1) < 0.8;
      const share = sum ? row.value / sum : 0;
      const closedRate = showClosed && row.total ? row.closed / row.total : null;
      const active = filterKey && filters[filterKey] === row.key;
      const lines = [`${fmt(row.value)} · ${fmtPercent(share)} ของทั้งหมด`];
      if (pareto) lines.push(`สะสม ${fmtPercent(cumulative)}`);
      if (closedRate !== null) lines.push(`แก้ไขแล้ว ${fmtPercent(closedRate)}`);
      if (filterKey && row.key) lines.push(active ? "กดเพื่อยกเลิกตัวกรอง" : "กดเพื่อกรองทั้งหน้า");
      const href = filterKey && row.key ? hrefWith(filters, { [filterKey]: active ? "" : row.key }) : null;
      const bar = `<span class="ncr-dash-track"><span class="ncr-dash-bar${vital ? "" : " rest"}" style="width:${max ? Math.max((row.value / max) * 100, 0.8) : 0}%"></span></span>`;
      const inner = `<span class="ncr-dash-label">${escapeHtml(row.label)}</span>${bar}<span class="ncr-dash-value">${escapeHtml(fmt(row.value))}${pareto ? `<small>${fmtPercent(cumulative)}</small>` : ""}${closedRate !== null ? `<small>ปิด ${fmtPercent(closedRate)}</small>` : ""}</span>`;
      return href
        ? `<a class="ncr-dash-row${active ? " active" : ""}" href="${href}" ${tipAttrs(row.label, lines)} aria-label="${escapeHtml(`${row.label} ${lines.join(" ")}`)}">${inner}</a>`
        : `<div class="ncr-dash-row" tabindex="0" ${tipAttrs(row.label, lines)}>${inner}</div>`;
    }).join("");
    const legend = pareto ? `<div class="ncr-dash-legend"><span><i class="swatch vital"></i>กลุ่มที่รวมกันได้ 80% แรก ควรแก้ก่อน</span><span><i class="swatch rest"></i>ที่เหลือ</span><span>ตัวเลขเล็ก = % สะสม</span></div>` : "";
    const table = `<div class="table-wrap ncr-dash-table" id="${id}" hidden><table><thead><tr><th>รายการ</th><th>ค่า</th><th>สัดส่วน</th>${pareto ? "<th>% สะสม</th>" : ""}${showClosed ? "<th>แก้ไขแล้ว</th>" : ""}</tr></thead><tbody>${(() => {
      let acc = 0;
      return rows.map((row) => {
        acc += row.value;
        return `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(fmt(row.value))}</td><td>${fmtPercent(sum ? row.value / sum : 0)}</td>${pareto ? `<td>${fmtPercent(sum ? acc / sum : 0)}</td>` : ""}${showClosed ? `<td>${fmtPercent(row.total ? row.closed / row.total : null)}</td>` : ""}</tr>`;
      }).join("");
    })()}</tbody></table></div>`;
    return `<div class="ncr-dash-bars">${items}</div>${legend}${table}`;
  }

  function monthChart(data, filters, fmt) {
    const max = Math.max(1e-9, ...data.months.map((month) => month.closed + month.open));
    const hasData = data.months.some((month) => month.closed + month.open > 0);
    if (!hasData) return `<p class="ncr-dash-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`;
    const columns = data.months.map((month) => {
      const total = month.closed + month.open;
      const rate = month.count ? month.closedCount / month.count : null;
      const lines = [`รวม ${fmt(total)}`, `ปิดแล้ว ${fmt(month.closed)}`, `ยังไม่ปิด ${fmt(month.open)}`, `แก้ไขแล้ว ${fmtPercent(rate)} ของจำนวนใบ`];
      return `<div class="ncr-dash-col" tabindex="0" ${tipAttrs(`${MONTHS[month.month - 1]} ${Number(filters.year) + 543}`, lines)} aria-label="${escapeHtml(`${MONTHS[month.month - 1]} ${lines.join(" ")}`)}">
        <div class="ncr-dash-stack">
          ${month.open > 0 ? `<span class="seg open" style="height:${(month.open / max) * 100}%"></span>` : ""}
          ${month.closed > 0 ? `<span class="seg closed" style="height:${(month.closed / max) * 100}%"></span>` : ""}
        </div>
        <span class="ncr-dash-col-label">${MONTHS[month.month - 1]}</span>
        <span class="ncr-dash-col-value">${total ? escapeHtml(filters.metric === "value" ? compactBaht(total) : fmtNumber(total, 1)) : ""}</span>
      </div>`;
    }).join("");
    const table = `<div class="table-wrap ncr-dash-table" id="ncr-dash-t-month" hidden><table><thead><tr><th>เดือน</th><th>ปิดแล้ว</th><th>ยังไม่ปิด</th><th>รวม</th><th>% แก้ไขแล้ว (จำนวนใบ)</th></tr></thead><tbody>${data.months.map((month) => `<tr><td>${MONTHS[month.month - 1]}</td><td>${escapeHtml(fmt(month.closed))}</td><td>${escapeHtml(fmt(month.open))}</td><td>${escapeHtml(fmt(month.closed + month.open))}</td><td>${fmtPercent(month.count ? month.closedCount / month.count : null)}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="ncr-dash-cols">${columns}</div>
      <div class="ncr-dash-legend"><span><i class="swatch closed"></i>ปิดแล้ว</span><span><i class="swatch open"></i>ยังไม่ปิด (กำลังแก้ไข)</span></div>${table}`;
  }

  function kpi(label, value, note, extra = "") {
    return `<div class="ncr-dash-kpi"><span class="ncr-dash-kpi-label">${escapeHtml(label)}</span><strong>${value}</strong>${extra}<span class="ncr-dash-kpi-note">${note}</span></div>`;
  }

  function filterBar(filters, reports) {
    const depts = [...new Set(reports.flatMap((row) => row.responsibilities.map((item) => item.dept)))].sort();
    const defects = [...new Map(reports.filter((row) => row.defect).map((row) => [row.defect.code, row.defect.name_th])).entries()];
    const option = (value, label, selected) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
    const monthOptions = (selected) => MONTHS.map((label, index) => option(String(index + 1), label, String(selected))).join("");
    const active = filters.dept || filters.defect || filters.source;
    return `<form class="ncr-dash-filters" id="ncr-dash-filters">
      <div class="field"><label for="ncr-dash-year">ปี</label><select class="select" id="ncr-dash-year" name="year">${filters.years.map((year) => option(year, String(Number(year) + 543), filters.year)).join("")}</select></div>
      <div class="field"><label for="ncr-dash-from">ตั้งแต่</label><select class="select" id="ncr-dash-from" name="from">${monthOptions(filters.from)}</select></div>
      <div class="field"><label for="ncr-dash-to">ถึง</label><select class="select" id="ncr-dash-to" name="to">${monthOptions(filters.to)}</select></div>
      <div class="field"><label for="ncr-dash-dept">แผนกที่รับผิดชอบ</label><select class="select" id="ncr-dash-dept" name="dept">${option("", "ทุกแผนก", filters.dept)}${depts.map((code) => option(code, code, filters.dept)).join("")}</select></div>
      <div class="field"><label for="ncr-dash-defect">ประเภทข้อบกพร่อง</label><select class="select" id="ncr-dash-defect" name="defect">${option("", "ทุกประเภท", filters.defect)}${defects.map(([code, name]) => option(code, name, filters.defect)).join("")}</select></div>
      <div class="field"><label for="ncr-dash-source">แหล่งที่พบ</label><select class="select" id="ncr-dash-source" name="source">${option("", "ทุกแหล่ง", filters.source)}${Object.entries(SOURCES).map(([code, name]) => option(code, name, filters.source)).join("")}</select></div>
      <div class="field ncr-dash-metric"><span class="ncr-dash-metric-label">วัดเป็น</span><div class="ncr-dash-segment" role="group" aria-label="วัดเป็น">
        <a class="filter${filters.metric === "value" ? " active" : ""}" href="${hrefWith(filters, { metric: "value" })}" aria-pressed="${filters.metric === "value"}">มูลค่า (บาท)</a>
        <a class="filter${filters.metric === "count" ? " active" : ""}" href="${hrefWith(filters, { metric: "count" })}" aria-pressed="${filters.metric === "count"}">จำนวนใบ</a>
      </div></div>
      ${active ? `<a class="btn secondary small ncr-dash-clear" href="${hrefWith(filters, { dept: "", defect: "", source: "" })}">ล้างตัวกรอง</a>` : ""}
    </form>`;
  }

  async function renderDashboard(params) {
    const fresh = !cache || cache.employeeId !== state.employee?.id || Date.now() - cache.loadedAt >= CACHE_MS || params.get("refresh");
    if (fresh) loadingShell(PATH, "แดชบอร์ด NCR");
    const { reports, loadedAt } = await loadData(Boolean(params.get("refresh")));
    const filters = readFilters(params, reports);
    const data = aggregate(reports, filters);
    const fmt = filters.metric === "value" ? fmtBaht : fmtCount;
    const resolution = data.total ? data.closed / data.total : null;
    const onTimeRate = data.responded ? data.onTime / data.responded : null;
    const unitText = data.units.slice(0, 3).map((unit) => `${fmtNumber(unit.defect, 1)} ${escapeHtml(unit.unit)}`).join(" · ");
    const scope = [
      filters.dept && `แผนก ${filters.dept}`,
      filters.defect && (reports.find((row) => row.defect?.code === filters.defect)?.defect?.name_th ?? filters.defect),
      filters.source && SOURCES[filters.source],
    ].filter(Boolean).join(" · ");
    const period = `${MONTHS[filters.from - 1]}–${MONTHS[filters.to - 1]} ${Number(filters.year) + 543}`;

    const card = (id, title, sub, body, wide = false) => `<section class="card ncr-dash-card${wide ? " wide" : ""}">
      <div class="ncr-dash-card-head"><div><h2>${escapeHtml(title)}</h2>${sub ? `<p>${escapeHtml(sub)}</p>` : ""}</div>${id ? tableToggle(id) : ""}</div>${body}</section>`;

    const content = `
      <div class="page-heading"><div><div class="eyebrow">NCR · QA02-FM02</div><h1>แดชบอร์ด NCR</h1><p>${escapeHtml(period)}${scope ? ` · ${escapeHtml(scope)}` : ""} · ไม่นับใบที่ยกเลิก${filters.dept ? " · ถ่วงตามสัดส่วนความรับผิดชอบ" : ""}</p></div>
        <div class="ncr-heading-status"><a class="btn secondary" href="${hrefWith(filters, {})}&refresh=1" title="ดึงข้อมูลล่าสุด">รีเฟรช</a><a class="btn secondary" href="#/ncr">ทะเบียน NCR</a></div></div>
      ${filterBar(filters, reports)}
      <div class="ncr-dash-kpis">
        ${kpi("มูลค่าความสูญเสีย", fmtBaht(data.value), data.total ? `เฉลี่ย ${fmtBaht(data.value / data.total)} ต่อใบ` : "—")}
        ${kpi("จำนวน NCR", fmtNumber(data.total, 2), "ใบ ในช่วงที่เลือก")}
        ${kpi("ปริมาณของเสีย", unitText ? `<span class="ncr-dash-kpi-compact">${unitText}</span>` : "—", `%NG จากการสุ่มตรวจ ${fmtPercent(data.ngRate)}`)}
        ${kpi("แก้ไขปัญหาแล้ว", fmtPercent(resolution), `ปิดแล้ว ${fmtNumber(data.closed, 2)} จาก ${fmtNumber(data.total, 2)} ใบ`,
          `<span class="ncr-dash-meter" role="img" aria-label="แก้ไขแล้ว ${fmtPercent(resolution)}"><span style="width:${(resolution ?? 0) * 100}%"></span></span>`)}
        ${kpi("ตอบทันกำหนด 7 วัน", fmtPercent(onTimeRate), `${data.onTime} จาก ${data.responded} ใบที่ตอบแล้ว`)}
        ${kpi("เกินกำหนดตอบ", `<span class="${data.overdue ? "ncr-dash-alert" : ""}">${data.overdue}</span>`, data.medianDays === null ? "ยังไม่มีใบที่ปิด" : `ใช้เวลาปิดกลาง ${data.medianDays} วัน`)}
      </div>
      <div class="ncr-dash-grid">
        ${card("ncr-dash-t-month", filters.metric === "value" ? "มูลค่าความสูญเสียรายเดือน" : "จำนวน NCR รายเดือน", "แยกใบที่ปิดแล้วกับที่ยังแก้ไขอยู่ ชี้หรือแตะแท่งเพื่อดู % แก้ไขแล้วของเดือนนั้น", monthChart(data, filters, fmt), true)}
        ${card("ncr-dash-t-defect", "Pareto ประเภทข้อบกพร่อง", "กดแท่งเพื่อกรองทั้งหน้าตามประเภทนั้น", barList({ id: "ncr-dash-t-defect", rows: data.byDefect, fmt, filters, filterKey: "defect", pareto: true, showClosed: true }))}
        ${card("ncr-dash-t-dept", "แผนกที่รับผิดชอบ", "ถ่วงตามสัดส่วนที่ผู้จัดการโรงงานกำหนด · ตัวเลขเล็ก = % ที่แก้ไขแล้ว", barList({ id: "ncr-dash-t-dept", rows: data.byDept, fmt, filters, filterKey: "dept", showClosed: true }))}
        ${card("ncr-dash-t-loss", "ความสูญเสียแยกประเภท", "มูลค่าจากรายการความสูญเสียที่บันทึก (บาท) ไม่ขึ้นกับตัวเลือก \"วัดเป็น\"", barList({ id: "ncr-dash-t-loss", rows: data.byLossType, fmt: fmtBaht, filters, emptyText: "ยังไม่มีการบันทึกความสูญเสียในช่วงนี้" }))}
        ${card("ncr-dash-t-cause", "สาเหตุ 4M+E", "ใบที่มีหลายสาเหตุแบ่งค่าเท่ากัน · \"ยังไม่ได้วิเคราะห์\" คือใบที่แผนกยังไม่ตอบ", barList({ id: "ncr-dash-t-cause", rows: data.byCause, fmt, filters }))}
        ${card("ncr-dash-t-source", "แหล่งที่พบ", "พบในโรงงาน (In-Coming/Process/FG) เทียบลูกค้าตีคืน · กดเพื่อกรอง", barList({ id: "ncr-dash-t-source", rows: data.bySource, fmt, filters, filterKey: "source", showClosed: true }))}
        ${card("ncr-dash-t-status", "สถานะการแก้ไข", "ใบในช่วงที่เลือกค้างอยู่ขั้นไหน", barList({ id: "ncr-dash-t-status", rows: data.byStatus.filter((row) => row.value > 0), fmt, filters }))}
        ${card("", "ปริมาณของเสียตามหน่วย", "หน่วยต่างกันรวมกันไม่ได้ จึงแยกตามหน่วย · % = ที่พบปัญหาต่อจำนวนทั้งหมดของล็อต", data.units.length ? `<div class="table-wrap"><table><thead><tr><th>หน่วย</th><th>จำนวน NCR</th><th>พบปัญหา</th><th>จำนวนทั้งหมด</th><th>%</th></tr></thead><tbody>${data.units.map((unit) => `<tr><td>${escapeHtml(unit.unit)}</td><td>${fmtNumber(unit.count, 2)}</td><td>${formatQty(Math.round(unit.defect * 1000) / 1000)}</td><td>${formatQty(Math.round(unit.total * 1000) / 1000)}</td><td>${fmtPercent(unit.total ? unit.defect / unit.total : null)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="ncr-dash-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`, true)}
        ${card("", "NCR มูลค่าความสูญเสียสูงสุด", "10 ใบแรกในช่วงที่เลือก กดเลขที่เพื่อเปิดใบ", data.top.length ? `<div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>สินค้า</th><th>ข้อบกพร่อง</th><th>มูลค่า</th><th>สถานะ</th></tr></thead><tbody>${data.top.map((row) => `<tr><td><a class="request-no" href="#/ncr?id=${encodeURIComponent(row.id)}">${escapeHtml(row.ncr_no)}</a></td><td>${escapeHtml(row.product_name)}</td><td>${escapeHtml(row.defect?.name_th ?? "—")}</td><td>${fmtBaht(data.valueOf(row))}</td><td>${escapeHtml(STATUS_LABELS[row.status] ?? row.status)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="ncr-dash-empty">ยังไม่มีการบันทึกความสูญเสียในช่วงนี้</p>`, true)}
      </div>
      <p class="muted small">ข้อมูล ณ ${escapeHtml(new Date(loadedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }))} · ตัวเลขนับเฉพาะ NCR ที่บัญชีนี้มีสิทธิ์เห็น</p>
      <div class="ncr-dash-tip" id="ncr-dash-tip" role="tooltip" hidden></div>`;
    app.innerHTML = shell(content, PATH, "แดชบอร์ด NCR");
    bindShell();
    bindDashboard(filters);
  }

  function bindDashboard(filters) {
    document.querySelector("#ncr-dash-filters")?.addEventListener("change", (event) => {
      const field = event.target.name;
      if (!field) return;
      location.hash = hrefWith(filters, { [field]: event.target.value }).slice(1);
    });
    document.querySelectorAll("[data-table-toggle]").forEach((button) => button.addEventListener("click", () => {
      const table = document.getElementById(button.dataset.tableToggle);
      if (!table) return;
      table.hidden = !table.hidden;
      button.setAttribute("aria-expanded", String(!table.hidden));
      button.textContent = table.hidden ? "ดูเป็นตาราง" : "ซ่อนตาราง";
    }));

    const tip = document.querySelector("#ncr-dash-tip");
    const show = (mark, x, y) => {
      tip.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = mark.dataset.tipTitle;
      tip.append(title);
      for (const line of JSON.parse(mark.dataset.tipLines || "[]")) {
        const row = document.createElement("span");
        row.textContent = line;
        tip.append(row);
      }
      tip.hidden = false;
      const left = Math.min(x + 14, window.innerWidth - tip.offsetWidth - 8);
      const top = Math.min(y + 14, window.innerHeight - tip.offsetHeight - 8);
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${Math.max(8, top)}px`;
    };
    document.querySelectorAll("[data-tip-title]").forEach((mark) => {
      mark.addEventListener("pointermove", (event) => show(mark, event.clientX, event.clientY));
      mark.addEventListener("pointerleave", () => { tip.hidden = true; });
      mark.addEventListener("focus", () => { const box = mark.getBoundingClientRect(); show(mark, box.left, box.bottom); });
    });
  }
  // ซ่อน tooltip เมื่อโฟกัสย้ายไปนอกกราฟ หรือแตะที่อื่น (ไม่ใช้ blur ตามกติกา popup ของ repo)
  const hideTipOutside = (event) => {
    const tip = document.querySelector("#ncr-dash-tip");
    if (tip && !event.target.closest?.("[data-tip-title]")) tip.hidden = true;
  };
  document.addEventListener("focusin", hideTipOutside);
  document.addEventListener("pointerdown", hideTipOutside);

  ncrModule.nav = [...(ncrModule.nav ?? []), { path: PATH, label: "แดชบอร์ด NCR", icon: ICON }];
  ncrModule.pages = { ...(ncrModule.pages ?? {}), [PATH]: renderDashboard };
})();
