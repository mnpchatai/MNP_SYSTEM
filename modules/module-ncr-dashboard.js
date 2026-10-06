// แดชบอร์ด NCR ของ Pilot Web (#/ncr-dashboard) — วิเคราะห์ปริมาณของเสีย ประเภท มูลค่าความสูญเสีย
// และอัตราการแก้ไขปัญหา จากตาราง ncr_* (20261002020000_ncr_phase1.sql)
//
// - อ่านผ่าน RLS เดียวกับทะเบียน NCR ทุกคนจึงเห็นตัวเลขเฉพาะ NCR ที่ตัวเองมีสิทธิ์เห็น (QA และผู้บริหารเห็นทั้งหมด)
// - ไม่นับ NCR ที่ยกเลิก และไม่นับรายการความสูญเสียที่ถูกยกเลิก
// - กรองแผนก = นับเฉพาะ NCR ที่แผนกนั้นรับผิดชอบ และถ่วงจำนวน/มูลค่าตามสัดส่วนที่แบ่งเท่ากันระหว่างแผนก (แทนการนับ 0.5 ในชีตเดิม)
// - ตัวกรองอยู่ใน URL (#/ncr-dashboard?year=…) แชร์ลิงก์มุมมองเดียวกันได้ กดแท่งกราฟเพื่อกรองต่อ
//
// โหลดหลัง modules/module-ncr.js (ใช้ป้ายกำกับจาก NCR_CAR.shared) และก่อน app.js — helper ของ app.js
// (sb, state, shell, bindShell, loadingShell, escapeHtml) ถูกเรียกตอนเปิดหน้าเท่านั้น
(function registerNcrLiveDashboard() {
  const ncrModule = window.MNP_REQUEST_MODULES?.NCR_CAR;
  if (!ncrModule?.shared) return;
  const { STATUS_LABELS, OPEN_STATUSES, SOURCES, CAUSES, LOSS_TYPES, todayBangkok, isOverdue, formatQty } = ncrModule.shared;

  const PATH = "ncr-dashboard";
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const STATUS_ORDER = [...OPEN_STATUSES, "closed"];
  const LOSS_ORDER = Object.keys(LOSS_TYPES);
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
      <div class="page-heading"><div><div class="eyebrow">NCR · QA02-FM02</div><h1>แดชบอร์ด NCR</h1><p>${escapeHtml(period)}${scope ? ` · ${escapeHtml(scope)}` : ""} · ไม่นับใบที่ยกเลิก${filters.dept ? " · ใบที่มีหลายแผนกนับแบ่งเท่ากัน" : ""}</p></div>
        <div class="ncr-heading-status"><a class="btn secondary" href="${hrefWith(filters, {})}&refresh=1" title="ดึงข้อมูลล่าสุด">รีเฟรช</a><a class="btn secondary" href="#/ncr">ทะเบียน NCR</a></div></div>
      ${filterBar(filters, reports)}
      <div class="ncr-dash-kpis">
        ${kpi("มูลค่าความสูญเสีย", fmtBaht(data.value), data.total ? `เฉลี่ย ${fmtBaht(data.value / data.total)} ต่อใบ` : "—")}
        ${kpi("จำนวน NCR", fmtNumber(data.total, 2), "ใบ ในช่วงที่เลือก")}
        ${kpi("ปริมาณของเสีย", unitText ? `<span class="ncr-dash-kpi-compact">${unitText}</span>` : "—", `%NG จากการสุ่มตรวจ ${fmtPercent(data.ngRate)}`)}
        ${kpi("แก้ไขปัญหาแล้ว", fmtPercent(resolution), `ปิดแล้ว ${fmtNumber(data.closed, 2)} จาก ${fmtNumber(data.total, 2)} ใบ`,
          `<span class="ncr-dash-meter" role="img" aria-label="แก้ไขแล้ว ${fmtPercent(resolution)}"><span style="width:${(resolution ?? 0) * 100}%"></span></span>`)}
        ${kpi("ตอบทันกำหนด 5 วัน", fmtPercent(onTimeRate), `${data.onTime} จาก ${data.responded} ใบที่ตอบแล้ว`)}
        ${kpi("เกินกำหนดตอบ", `<span class="${data.overdue ? "ncr-dash-alert" : ""}">${data.overdue}</span>`, data.medianDays === null ? "ยังไม่มีใบที่ปิด" : `ใช้เวลาปิดกลาง ${data.medianDays} วัน`)}
      </div>
      <div class="ncr-dash-grid">
        ${card("ncr-dash-t-month", filters.metric === "value" ? "มูลค่าความสูญเสียรายเดือน" : "จำนวน NCR รายเดือน", "แยกใบที่ปิดแล้วกับที่ยังแก้ไขอยู่ ชี้หรือแตะแท่งเพื่อดู % แก้ไขแล้วของเดือนนั้น", monthChart(data, filters, fmt), true)}
        ${card("ncr-dash-t-defect", "Pareto ประเภทข้อบกพร่อง", "กดแท่งเพื่อกรองทั้งหน้าตามประเภทนั้น", barList({ id: "ncr-dash-t-defect", rows: data.byDefect, fmt, filters, filterKey: "defect", pareto: true, showClosed: true }))}
        ${card("ncr-dash-t-dept", "แผนกที่รับผิดชอบ", "ใบที่มีหลายแผนกแบ่งเท่ากัน (2 แผนก = แผนกละ 0.5 ใบ) · ตัวเลขเล็ก = % ที่แก้ไขแล้ว", barList({ id: "ncr-dash-t-dept", rows: data.byDept, fmt, filters, filterKey: "dept", showClosed: true }))}
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

  ncrModule.shared.renderLiveDashboard = renderDashboard;
  ncrModule.shared.invalidateLiveDashboard = () => { cache = null; };
  ncrModule.pages = { ...(ncrModule.pages ?? {}), [PATH]: renderDashboard };
})();

// แดชบอร์ด NCR เวอร์ชันใหม่ของโหมดทดสอบ (#/ncr-dashboard) — ตัวเลขทุกตัวคำนวณจากรายการ NCR ชุดเดียว
// ผ่าน modules/ncr-dashboard-model.js (นิยามและเทสต์อยู่ที่นั่น) ไฟล์นี้ทำหน้าที่โหลดข้อมูลและวาดหน้าจอเท่านั้น
//
// - อ่านผ่าน RLS เดียวกับทะเบียน NCR (ncr_reports, ncr_losses, ncr_outcomes, ncr_status_history)
// - ฐานเวลาเดียว: วันที่ออก NCR นับจำนวนใบเต็มใบ ส่วนบาทแบ่งตามสัดส่วนแผนก
// - ตัวกรองอยู่ใน URL แชร์ลิงก์ได้ แตะรายการในการ์ดเพื่อดูตัวเลขในหน้า (ไม่ใช้ป๊อปอัพ) แล้วกดกรองทั้งหน้า
// - นอกโหมดทดสอบยังใช้แดชบอร์ดเดิมด้านบนโดยตั้งใจ (ยังไม่มีขั้นตอนยืนยันต้นทุนนอก sandbox)
//
// โหลดหลัง modules/module-ncr.js และ modules/ncr-dashboard-model.js — helper ของ app.js
// (sb, state, shell, bindShell, loadingShell, escapeHtml, relation) ถูกเรียกตอนเปิดหน้าเท่านั้น
(function registerNcrDashboard() {
  const ncrModule = window.MNP_REQUEST_MODULES?.NCR_CAR;
  const model = window.MNP_NCR_DASHBOARD;
  if (!ncrModule?.shared || !model) return;
  const { STATUS_LABELS, SOURCES, CAUSES, todayBangkok, formatQty } = ncrModule.shared;

  const PATH = "ncr-dashboard";
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`;
  const CACHE_MS = 60 * 1000;
  const CAUSE_LABELS = { ...CAUSES, [model.NO_CAUSE]: "ยังไม่ได้วิเคราะห์" };
  const CHART_HEIGHT = 140;
  let cache = null;
  let selection = null; // { card, key } ของรายการที่แตะดูตัวเลข (อยู่ในหน้า ไม่ใช่ป๊อปอัพ)
  let lastParams = new URLSearchParams();
  let drillLimit = 10;
  let filtersOpen = false;

  const bangkokDate = (timestamp) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(timestamp));
  const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  const fmtNumber = (value, digits = 0) => Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: digits });
  const fmtBaht = (value) => `${fmtNumber(Math.round(value))} ฿`;
  const fmtCount = (value) => `${fmtNumber(value)} ใบ`;
  const fmtPercent = (value) => (value === null ? "—" : `${fmtNumber(value * 100, 1)}%`);
  const fmtShort = (value) => (value >= 1e6 ? `${fmtNumber(value / 1e6, 2)}M` : value >= 1000 ? `${fmtNumber(value / 1000, 1)}k` : fmtNumber(value));

  async function allRows(makeQuery) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await makeQuery().range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 500) return rows;
    }
  }

  async function loadData(force) {
    const employeeId = state.employee?.id;
    if (!force && cache && cache.employeeId === employeeId && Date.now() - cache.loadedAt < CACHE_MS) return cache;
    const [reports, losses, outcomes, history] = await Promise.all([
      allRows(() => sb.from("ncr_reports").select("id,ncr_no,status,issue_date,product_name,customer_name,qty_total,qty_defect,unit,source,causes,response_due,responded_at,closed_at,defect_type:ncr_defect_types(code,name_th),ncr_responsibilities(share,department:departments(code))").neq("status", "cancelled").order("id")),
      allRows(() => sb.from("ncr_losses").select("ncr_id,loss_type,amount,cost_status,entry_kind,incurred_on").is("voided_at", null).order("id")),
      allRows(() => sb.from("ncr_outcomes").select("*").order("ncr_id")),
      allRows(() => sb.from("ncr_status_history").select("ncr_id,to_status,changed_at").order("id")),
    ]);
    const lossesByNcr = new Map();
    for (const loss of losses) {
      if (!lossesByNcr.has(loss.ncr_id)) lossesByNcr.set(loss.ncr_id, []);
      lossesByNcr.get(loss.ncr_id).push(loss);
    }
    const outcomesByNcr = new Map(outcomes.map((item) => [item.ncr_id, item]));
    // วันที่ใบเข้าขั้น "รอแผนกตอบ" ล่าสุด (เริ่มนับ SLA 5 วัน รวมกรณีส่งกลับมาตอบใหม่) และวันที่เปลี่ยนสถานะล่าสุด
    const enteredResponse = new Map();
    const lastChange = new Map();
    for (const item of history) {
      if (item.to_status === "awaiting_response" && (!enteredResponse.has(item.ncr_id) || item.changed_at > enteredResponse.get(item.ncr_id))) enteredResponse.set(item.ncr_id, item.changed_at);
      if (!lastChange.has(item.ncr_id) || item.changed_at > lastChange.get(item.ncr_id)) lastChange.set(item.ncr_id, item.changed_at);
    }
    const today = todayBangkok();
    const rows = model.deriveRows(reports.map((row) => ({
      ...row,
      defect: relation(row.defect_type),
      responsibilities: (row.ncr_responsibilities ?? []).map((item) => ({ dept: relation(item.department)?.code ?? "?", share: Number(item.share) })),
      losses: lossesByNcr.get(row.id) ?? [],
      outcome: outcomesByNcr.get(row.id) ?? null,
      respondedDate: row.responded_at ? bangkokDate(row.responded_at) : null,
      closedDate: row.closed_at ? bangkokDate(row.closed_at) : null,
      sla_started_on: enteredResponse.has(row.id) ? bangkokDate(enteredResponse.get(row.id)) : null,
      last_change_on: lastChange.has(row.id) ? bangkokDate(lastChange.get(row.id)) : null,
    })), today);
    cache = { employeeId, loadedAt: Date.now(), today, rows };
    return cache;
  }

  function presetsFor(today) {
    const year = today.slice(0, 4);
    const month = Number(today.slice(5, 7));
    return [
      { label: "เดือนนี้", year, from: month, to: month },
      { label: "3 เดือนล่าสุด", year, from: Math.max(1, month - 2), to: month },
      { label: "ปีนี้", year, from: 1, to: month },
    ];
  }

  function readFilters(params, rows, today) {
    const years = [...new Set([today.slice(0, 4), ...rows.map((row) => row.year)])].sort();
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
      cause: CAUSE_LABELS[params.get("cause")] ? params.get("cause") : "",
      scope: ["open", "overdue"].includes(params.get("scope")) ? params.get("scope") : "",
      sort: params.get("sort") === "count" ? "count" : "net",
    };
  }

  function hrefWith(filters, changes) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    for (const key of ["year", "from", "to", "dept", "defect", "source", "cause", "scope", "sort"]) {
      if (next[key] !== "" && next[key] !== undefined && next[key] !== null) params.set(key, next[key]);
    }
    return `#/${PATH}?${params.toString()}`;
  }

  const esc = (value) => escapeHtml(String(value));
  const monthName = (month, year) => `${MONTHS[month - 1]} ${Number(year) + 543}`;
  const waitingOn = (row) => {
    if (row.status === "awaiting_disposition") return "ผจก.โรงงาน";
    if (row.status === "awaiting_followup") return "QA";
    if (row.status === "awaiting_signoff") return "ผู้ลงนามปิด";
    return `แผนก ${row.responsibilities.map((item) => item.dept).join("+") || "—"}`;
  };

  // ---- รายละเอียดของรายการที่แตะ (อยู่ในหน้า ไม่ใช่ป๊อปอัพ จึงไม่ต้องมีกติกาปิดเมื่อ blur) ----
  function selectButton(card, key, inner, extraClass = "") {
    const on = selection?.card === card && selection.key === String(key);
    return `<button type="button" class="${extraClass}${on ? " selected" : ""}" data-sel="${esc(card)}:${esc(key)}" aria-pressed="${on}">${inner}</button>`;
  }
  function detailBox(card, noun, resolve) {
    const hint = `<p class="nd-hint">แตะ${noun}เพื่อดูตัวเลขของรายการนั้น แล้วกดกรองทั้งหน้าได้</p>`;
    if (selection?.card !== card) return hint;
    const item = resolve(selection.key);
    if (!item) return hint;
    return `<div class="nd-detail" role="status"><strong>${esc(item.title)}</strong><ul>${item.lines.map(([label, value]) => `<li><span>${esc(label)}</span><span>${esc(value)}</span></li>`).join("")}</ul>${item.href ? `<a class="btn secondary small" href="${item.href}">${esc(item.linkLabel ?? "กรองทั้งหน้าตามนี้")}</a>` : ""}</div>`;
  }

  // ---- ชิ้นส่วนของหน้า ----
  function controlsHtml(filters, rows, today, sums) {
    const presets = presetsFor(today).map((preset) => {
      const active = filters.year === preset.year && filters.from === preset.from && filters.to === preset.to;
      return `<a class="nd-chip" href="${hrefWith(filters, { year: preset.year, from: preset.from, to: preset.to })}" aria-current="${active}">${preset.label}</a>`;
    }).join("");
    const depts = [...new Set(rows.flatMap((row) => row.responsibilities.map((item) => item.dept)))].sort();
    const defects = [...new Map(rows.filter((row) => row.defect).map((row) => [row.defect.code, row.defect.name_th])).entries()];
    const option = (value, label, selected) => `<option value="${esc(value)}"${String(value) === String(selected) ? " selected" : ""}>${esc(label)}</option>`;
    const monthOptions = (selected) => MONTHS.map((label, index) => option(index + 1, label, selected)).join("");
    const labelFor = { dept: () => filters.dept, defect: () => rows.find((row) => row.defect?.code === filters.defect)?.defect?.name_th ?? filters.defect, source: () => SOURCES[filters.source], cause: () => CAUSE_LABELS[filters.cause] };
    const titles = { dept: "แผนก", defect: "ข้อบกพร่อง", source: "แหล่งที่พบ", cause: "สาเหตุ" };
    const removable = ["dept", "defect", "source", "cause"].filter((key) => filters[key]).map((key) => `<a class="nd-chip removable" href="${hrefWith(filters, { [key]: "" })}" aria-label="ยกเลิกตัวกรอง ${titles[key]} ${esc(labelFor[key]())}">${titles[key]}: ${esc(labelFor[key]())} <span aria-hidden="true">✕</span></a>`);
    if (filters.scope) removable.push(`<a class="nd-chip removable" href="${hrefWith(filters, { scope: "" })}" aria-label="ยกเลิกตัวกรองสถานะ">${filters.scope === "open" ? "ใบที่ค้างอยู่" : "ใบเกินกำหนดตอบ"} <span aria-hidden="true">✕</span></a>`);
    if (removable.length) removable.push(`<a class="nd-chip" href="${hrefWith(filters, { dept: "", defect: "", source: "", cause: "", scope: "" })}">ล้างทั้งหมด</a>`);
    return `<div class="nd-chips" role="group" aria-label="ช่วงเวลา (ตามวันที่ออก NCR)">${presets}</div>
      <details class="nd-filterbox" id="nd-filterbox"${filtersOpen ? " open" : ""}><summary>ช่วงเวลาและตัวกรองเพิ่มเติม</summary>
        <form class="nd-filters" id="nd-filters">
          <div class="field"><label for="nd-year">ปี</label><select class="select" id="nd-year" name="year">${filters.years.map((year) => option(year, String(Number(year) + 543), filters.year)).join("")}</select></div>
          <div class="field"><label for="nd-from">ตั้งแต่</label><select class="select" id="nd-from" name="from">${monthOptions(filters.from)}</select></div>
          <div class="field"><label for="nd-to">ถึง</label><select class="select" id="nd-to" name="to">${monthOptions(filters.to)}</select></div>
          <div class="field"><label for="nd-dept">แผนกที่รับผิดชอบ</label><select class="select" id="nd-dept" name="dept">${option("", "ทุกแผนก", filters.dept)}${depts.map((code) => option(code, code, filters.dept)).join("")}</select></div>
          <div class="field"><label for="nd-defect">ประเภทข้อบกพร่อง</label><select class="select" id="nd-defect" name="defect">${option("", "ทุกประเภท", filters.defect)}${defects.map(([code, name]) => option(code, name, filters.defect)).join("")}</select></div>
          <div class="field"><label for="nd-source">แหล่งที่พบ</label><select class="select" id="nd-source" name="source">${option("", "ทุกแหล่ง", filters.source)}${Object.entries(SOURCES).map(([code, name]) => option(code, name, filters.source)).join("")}</select></div>
        </form></details>
      ${removable.length ? `<div class="nd-chips" aria-label="ตัวกรองที่ใช้อยู่">${removable.join("")}</div>` : ""}
      <p class="nd-scope">กำลังดู <strong>${esc(filters.from === filters.to ? monthName(filters.from, filters.year) : `${MONTHS[filters.from - 1]}–${monthName(filters.to, filters.year)}`)}</strong> ตามวันที่ออก NCR → <strong>${fmtCount(sums.total)}</strong></p>`;
  }

  function summaryHtml(sums) {
    if (!sums.total) return "ไม่มี NCR ตรงกับตัวกรองนี้";
    const parts = [];
    if (sums.overdue) parts.push(`<b>${fmtCount(sums.overdue)}เกินกำหนดตอบ</b> ควรตามก่อน`);
    if (sums.open) parts.push(`ค้างอยู่ทั้งหมด ${fmtCount(sums.open)}`);
    if (sums.need > sums.assessed) parts.push(`ต้นทุนยังประเมินไม่ครบอีก ${fmtCount(sums.need - sums.assessed)} ยอดบาทจึงเป็นตัวเลขขั้นต่ำ`);
    return parts.length ? parts.join(" · ") : "ไม่มีใบค้างและไม่มีใบเกินกำหนดในช่วงนี้";
  }

  function tilesHtml(filters, sums) {
    const money = [["สูญเสียยืนยัน (ก่อนชดเชย)", fmtBaht(sums.gross)], ["ชดเชยยืนยัน (เครดิต เงินชดเชย ขายซาก)", `− ${fmtBaht(sums.recovery)}`], ["สุทธิ", fmtBaht(sums.net)], ["ประมาณการรอยืนยัน (ไม่รวมในยอดหลัก)", fmtBaht(sums.estimated)], ["รายการเดิมรอตรวจสอบ (ไม่รวมในยอดหลัก)", fmtBaht(sums.legacy)]];
    const assess = [["ใบที่ต้องประเมิน (ตั้งแต่ขั้นรอแผนกตอบ)", fmtCount(sums.need)], ["ประเมินครบแล้ว", fmtCount(sums.assessed)], ["ยังไม่ครบ", fmtCount(sums.need - sums.assessed)]];
    const list = (lines) => `<ul class="nd-lines">${lines.map(([label, value]) => `<li><span>${esc(label)}</span><span>${esc(value)}</span></li>`).join("")}</ul>`;
    return `<div class="nd-tile"><a class="nd-tap" href="${hrefWith(filters, { scope: "" })}"><span class="nd-label">NCR ที่ออกในช่วงนี้</span><span class="nd-value">${fmtNumber(sums.total)}<small>ใบ</small></span></a>
        <span class="nd-note">ปิดแล้ว ${fmtCount(sums.closed)} (${fmtPercent(sums.closedRate)})</span><span class="nd-meter" role="img" aria-label="ปิดแล้ว ${fmtPercent(sums.closedRate)}"><span style="width:${(sums.closedRate ?? 0) * 100}%"></span></span></div>
      <div class="nd-tile"><a class="nd-tap" href="${hrefWith(filters, { scope: "open" })}"><span class="nd-label">ค้างอยู่</span><span class="nd-value">${fmtNumber(sums.open)}<small>ใบ</small></span></a>
        ${sums.overdue ? `<a class="nd-pill crit" href="${hrefWith(filters, { scope: "overdue" })}"><span class="nd-ico" aria-hidden="true">▲</span>เกินกำหนดตอบ ${fmtCount(sums.overdue)}</a>` : `<span class="nd-pill">ไม่มีใบเกินกำหนดตอบ</span>`}
        <span class="nd-note">ตอบทันกำหนด ${fmtPercent(sums.onTimeRate)}${sums.slaBase ? ` (${sums.onTime}/${sums.slaBase})` : ""}</span></div>
      <div class="nd-tile"><span class="nd-label">สูญเสียสุทธิ (ยืนยันแล้ว)</span><span class="nd-value">${fmtShort(sums.net)}<small>฿</small></span>
        <span class="nd-note">+ ประมาณการ ${fmtBaht(sums.estimated)} ยังไม่ยืนยัน${sums.legacy ? ` · รายการเดิม ${fmtBaht(sums.legacy)}` : ""}</span>
        <details class="nd-more"><summary>ดูรายละเอียด</summary>${list(money)}${filters.dept ? `<p class="nd-hint">เมื่อกรองแผนก มูลค่าแบ่งตามสัดส่วนความรับผิดชอบของแผนกนั้น</p>` : ""}</details></div>
      <div class="nd-tile"><span class="nd-label">ประเมินต้นทุนแล้ว</span><span class="nd-value">${fmtNumber(sums.assessed)}<small>/ ${fmtNumber(sums.need)} ใบ</small></span>
        <span class="nd-meter" role="img" aria-label="ประเมินแล้ว ${fmtPercent(sums.assessedRate)}"><span style="width:${(sums.assessedRate ?? 0) * 100}%"></span></span><span class="nd-note">${sums.need > sums.assessed ? `รออีก ${fmtCount(sums.need - sums.assessed)}` : "ครบทุกใบที่ต้องประเมิน"}</span>
        <details class="nd-more"><summary>ดูรายละเอียด</summary>${list(assess)}<p class="nd-hint">ครบ = ติ๊กประเมินครบแล้วและไม่มีรายการประมาณการหรือรายการเดิมค้าง</p></details></div>`;
  }

  function actHtml(list, today) {
    const open = list.filter((row) => row.isOpen);
    const top = model.priority(list, 5);
    const slaCell = (row) => {
      if (row.status === "awaiting_disposition") return `<span class="nd-muted">ยังไม่เริ่มนับ</span>`;
      if (row.status !== "awaiting_response") return `<span class="nd-muted">ตอบแล้ว</span>`;
      if (!row.slaDue) return "—";
      const left = daysBetween(today, row.slaDue);
      return row.overdue ? `<span class="nd-pill crit"><span class="nd-ico" aria-hidden="true">▲</span>เกิน ${Math.abs(left)} วัน</span>` : `<span class="nd-pill">อีก ${left} วัน</span>`;
    };
    return `<div class="nd-head"><h2>ต้องลงมือตอนนี้</h2><p>ใบที่ยังไม่ปิด เรียงจากเกินกำหนดก่อน แล้วตามจำนวนวันที่ค้างในขั้นปัจจุบัน</p></div>
      ${top.length ? `<div class="table-wrap"><table><thead><tr><th>ใบ / สินค้า</th><th>รอใคร</th><th>ค้างมา</th><th>กำหนดตอบ</th></tr></thead><tbody>${top.map((row) => `<tr><td><a class="request-no" href="#/ncr?id=${encodeURIComponent(row.id)}">${esc(row.ncr_no)}</a><br><span class="nd-muted">${esc(row.product_name)} · ${esc(row.defect?.name_th ?? "—")}</span></td><td>${esc(waitingOn(row))}<br><span class="nd-muted">${esc(STATUS_LABELS[row.status] ?? row.status)}</span></td><td class="nd-num">${row.daysInStatus} วัน</td><td>${slaCell(row)}</td></tr>`).join("")}</tbody></table></div>
      ${open.length > top.length ? `<div><a class="btn secondary" href="${hrefWith(lastFilters, { scope: "open" })}">ดูใบค้างทั้งหมด ${fmtCount(open.length)}</a></div>` : ""}` : `<p class="nd-empty">ไม่มีใบค้างในช่วงและตัวกรองนี้</p>`}`;
  }

  function columnChart({ card, title, subtitle, data, legend, pickA, pickB, formatTotal, formatAxis, lastFilters: filters }) {
    const totals = data.map((month) => pickA(month) + pickB(month));
    const maxValue = niceMax(Math.max(...totals, 0));
    const maxIndex = totals.indexOf(Math.max(...totals));
    const columns = data.map((month, index) => {
      const a = pickA(month), b = pickB(month), total = a + b;
      const heightA = a > 0 ? Math.max(2, Math.round((a / maxValue) * CHART_HEIGHT)) : 0;
      const heightB = b > 0 ? Math.max(2, Math.round((b / maxValue) * CHART_HEIGHT)) : 0;
      const labelled = total > 0 && (index === maxIndex || index === data.length - 1);
      const out = month.month < filters.from || month.month > filters.to;
      const inner = `<span class="nd-stack">${heightA ? `<b style="height:${heightA}px"></b>` : ""}${heightB ? `<b class="soft" style="height:${heightB}px"></b>` : ""}${labelled ? `<span class="nd-barval" style="bottom:${heightA + heightB + (heightA && heightB ? 2 : 0) + 3}px">${esc(formatAxis(total))}</span>` : ""}</span><span class="nd-mon">${MONTHS[month.month - 1]}</span>`;
      return selectButton(card, month.month, inner, `nd-col${out ? " out" : ""}`).replace("<button", `<button aria-label="${esc(`${MONTHS[month.month - 1]} ${formatTotal(total)}`)}"`);
    }).join("");
    const ticks = [maxValue, maxValue / 2, 0].map((value) => `<span style="bottom:${(value / maxValue) * CHART_HEIGHT}px">${esc(formatAxis(value))}</span>`).join("");
    const grid = [0, 0.5, 1].map((fraction) => `<i${fraction === 1 ? ' class="base"' : ""} style="top:${(1 - fraction) * CHART_HEIGHT}px"></i>`).join("");
    return `<div class="nd-sub"><h3>${esc(title)}</h3><p>${esc(subtitle)}</p>
      <div class="nd-chart"><div class="nd-yax">${ticks}</div><div class="nd-plot"><div class="nd-grid">${grid}</div><div class="nd-cols">${columns}</div></div></div>
      <div class="nd-legend"><span><i class="strong"></i>${esc(legend[0])}</span><span><i class="soft"></i>${esc(legend[1])}</span></div>
      ${detailBox(card, "แท่งเดือน", (key) => {
        const month = data.find((item) => String(item.month) === key);
        if (!month) return null;
        return { title: monthName(month.month, filters.year), lines: card === "month-count"
          ? [["NCR ที่ออก", fmtCount(month.count)], ["ปิดแล้ว", fmtCount(month.closed)], ["ยังไม่ปิด", fmtCount(month.open)]]
          : [["สูญเสียสุทธิยืนยัน", fmtBaht(month.net)], ["ประมาณการรอยืนยัน", fmtBaht(month.estimated)]],
        href: hrefWith(filters, { from: month.month, to: month.month }), linkLabel: "ดูเฉพาะเดือนนี้" };
      })}</div>`;
  }
  const niceMax = (value) => { if (value <= 0) return 1; const unit = 10 ** Math.floor(Math.log10(value)); const lead = value / unit; return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 2.5 ? 2.5 : lead <= 5 ? 5 : 10) * unit; };

  function trendHtml(rows, filters, today) {
    const lastMonth = filters.year === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12;
    const data = model.monthly(rows, filters, lastMonth);
    return `<div class="nd-head"><h2>แนวโน้มรายเดือน</h2><p>แกนเดือนเดียวกันทั้งสองกราฟ (เดือนที่ออก NCR) เดือนนอกช่วงที่เลือกแสดงจางลง ตัวกรองอื่นยังใช้อยู่</p></div>
      <div class="nd-two">${columnChart({ card: "month-count", title: "จำนวน NCR", subtitle: "ปิดแล้วเทียบกับยังไม่ปิด ณ วันนี้", data, legend: ["ปิดแล้ว", "ยังไม่ปิด"], pickA: (m) => m.closed, pickB: (m) => m.open, formatTotal: fmtCount, formatAxis: (v) => fmtNumber(v), lastFilters: filters })}
      ${columnChart({ card: "month-money", title: "สูญเสียสุทธิ (บาท)", subtitle: "ยืนยันแล้วเทียบกับประมาณการรอยืนยัน", data, legend: ["ยืนยันแล้ว (สุทธิ)", "ประมาณการ"], pickA: (m) => m.net, pickB: (m) => m.estimated, formatTotal: fmtBaht, formatAxis: fmtShort, lastFilters: filters })}</div>`;
  }

  function barRows({ card, items, valueOf, subOf, filters, filterKey }) {
    const max = items.length ? Math.max(...items.map((item) => valueOf(item).amount)) : 0;
    return `<div class="nd-bars">${items.map((item) => {
      const { amount, text } = valueOf(item);
      const inner = `<span class="nd-lab">${esc(item.label)}</span><span class="nd-trk"><span class="nd-bar${item.vital === false ? " rest" : ""}" style="width:${max ? Math.max((amount / max) * 100, 0.8) : 0}%"></span></span><span class="nd-val">${esc(text)}${subOf?.(item) ? `<small>${esc(subOf(item))}</small>` : ""}</span>`;
      return selectButton(card, item.key, inner, `nd-brow${filterKey && filters[filterKey] === item.key ? " active" : ""}`);
    }).join("")}</div>`;
  }

  function paretoHtml(list, filters, sums) {
    const items = model.pareto(list, filters, filters.sort);
    const byNet = filters.sort === "net";
    const warn = byNet && sums.assessedRate !== null && sums.assessedRate < 1 ? `<div class="nd-warn">บาทในรายการนี้เป็นค่าขั้นต่ำ ประเมินต้นทุนครบ ${fmtPercent(sums.assessedRate)} ของใบที่ต้องประเมิน ใบที่มีแต่ประมาณการไม่ปรากฏในแท่ง</div>` : "";
    return `<div class="nd-head"><h2>ปัญหาอะไรเยอะ / แพง</h2><p>Pareto ประเภทข้อบกพร่อง แตะแท่งเพื่อดูตัวเลข</p></div>
      <div class="nd-chips" role="group" aria-label="เรียงตาม"><a class="nd-chip" href="${hrefWith(filters, { sort: "net" })}" aria-current="${byNet}">เรียงตามบาท</a><a class="nd-chip" href="${hrefWith(filters, { sort: "count" })}" aria-current="${!byNet}">เรียงตามจำนวนใบ</a></div>${warn}
      ${items.length ? `${barRows({ card: "pareto", items, filters, filterKey: "defect", valueOf: (item) => (byNet ? { amount: item.net, text: fmtBaht(item.net) } : { amount: item.count, text: fmtCount(item.count) }), subOf: (item) => (byNet ? fmtCount(item.count) : item.net ? fmtBaht(item.net) : "") })}
      <div class="nd-legend"><span><i class="strong"></i>กลุ่มที่รวมกันได้ 80% แรก ควรแก้ก่อน</span><span><i class="soft"></i>ที่เหลือ</span></div>` : `<p class="nd-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`}
      ${detailBox("pareto", "แท่ง", (key) => {
        const item = items.find((entry) => entry.key === key);
        return item && { title: item.label, lines: [["จำนวนใบ", fmtCount(item.count)], ["สูญเสียสุทธิยืนยัน", fmtBaht(item.net)], ["สัดส่วนในกราฟนี้", fmtPercent(item.share)], ["สะสม", fmtPercent(item.cumulative)]], href: hrefWith(filters, { defect: filters.defect === key ? "" : key }), linkLabel: filters.defect === key ? "ยกเลิกการกรอง" : undefined };
      })}`;
  }

  function deptHtml(list, filters) {
    const { rows: deptRows, total } = model.deptTable(list, filters);
    return `<div class="nd-head"><h2>ใคร / แผนกไหน</h2><p>จำนวนใบนับเต็มใบ ใบที่มีหลายแผนกจึงอยู่ในหลายแถวและห้ามบวกข้ามแถว ส่วนบาทแบ่งตามสัดส่วน แถวรวมตรงกับตัวเลขด้านบน</p></div>
      ${deptRows.length ? `<div class="table-wrap"><table><thead><tr><th>แผนก</th><th class="nd-num">ใบที่เกี่ยวข้อง</th><th class="nd-num">ค้าง</th><th class="nd-num">เกินกำหนด</th><th class="nd-num">ตอบทัน</th><th class="nd-num">สุทธิ (บาท)</th></tr></thead><tbody>
      ${deptRows.map((row) => `<tr><td>${selectButton("dept", row.dept, esc(row.dept || "ยังไม่กำหนดแผนก"), "nd-rowbtn")}</td><td class="nd-num">${fmtNumber(row.count)}</td><td class="nd-num">${fmtNumber(row.open)}</td><td class="nd-num">${row.overdue ? `<span class="nd-pill crit"><span class="nd-ico" aria-hidden="true">▲</span>${row.overdue}</span>` : "0"}</td><td class="nd-num">${fmtPercent(row.onTimeRate)}</td><td class="nd-num">${fmtNumber(row.net)}</td></tr>`).join("")}
      <tr class="nd-total"><td>รวม (ไม่ซ้ำ)</td><td class="nd-num">${fmtNumber(total.total)}</td><td class="nd-num">${fmtNumber(total.open)}</td><td class="nd-num">${fmtNumber(total.overdue)}</td><td class="nd-num">${fmtPercent(total.onTimeRate)}</td><td class="nd-num">${fmtNumber(total.net)}</td></tr></tbody></table></div>` : `<p class="nd-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`}
      ${detailBox("dept", "ชื่อแผนก", (key) => {
        const row = deptRows.find((entry) => entry.dept === key);
        return row && { title: key ? `แผนก ${key}` : "ยังไม่กำหนดแผนก", lines: [["ใบที่เกี่ยวข้อง", fmtCount(row.count)], ["ค้างอยู่", fmtCount(row.open)], ["เกินกำหนดตอบ", fmtCount(row.overdue)], ["ตอบทันกำหนด", fmtPercent(row.onTimeRate)], ["สูญเสียสุทธิที่แบ่งตามสัดส่วนแผนก", fmtBaht(row.net)]], href: key ? hrefWith(filters, { dept: filters.dept === key ? "" : key }) : null, linkLabel: filters.dept === key ? "ยกเลิกการกรอง" : undefined };
      })}`;
  }

  function breakdownHtml(card, title, subtitle, items, labels, filters, filterKey, total) {
    const rows = items.map((item) => ({ ...item, label: labels[item.key] ?? item.key }));
    return `<div class="nd-head"><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
      ${rows.length ? barRows({ card, items: rows, filters, filterKey, valueOf: (item) => ({ amount: item.count, text: fmtCount(item.count) }) }) : `<p class="nd-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`}
      ${detailBox(card, "แท่ง", (key) => {
        const item = rows.find((entry) => entry.key === key);
        return item && { title: item.label, lines: [["จำนวนใบ", fmtCount(item.count)], ["สัดส่วนของใบในช่วงนี้", fmtPercent(total ? item.count / total : null)]], href: hrefWith(filters, { [filterKey]: filters[filterKey] === key ? "" : key }), linkLabel: filters[filterKey] === key ? "ยกเลิกการกรอง" : undefined };
      })}`;
  }

  function outcomesHtml(list) {
    const units = model.outcomesByUnit(list);
    const unverified = list.filter((row) => row.outcome?.result_status !== "confirmed").length;
    return `<div class="nd-head"><h2>ผลดำเนินการจริง แยกตามหน่วย</h2><p>ทิ้ง ซ่อมสำเร็จ ส่งคืน นับเฉพาะผลที่ยืนยันแล้ว หน่วยต่างกันไม่รวมกัน ไม่คำนวณอัตราของเสียทั้งโรงงานจากข้อมูล NCR</p></div>
      ${units.length ? `<div class="table-wrap"><table><thead><tr><th>หน่วย</th><th class="nd-num">NCR</th><th class="nd-num">พบปัญหา</th><th class="nd-num">ยืนยันผลแล้ว</th><th class="nd-num">ทิ้งจริง</th><th class="nd-num">ซ่อมสำเร็จ</th><th class="nd-num">ส่งคืน</th></tr></thead><tbody>
      ${units.map((unit) => `<tr><td>${esc(unit.unit)}</td><td class="nd-num">${fmtNumber(unit.count)}</td><td class="nd-num">${formatQty(Math.round(unit.defect * 1000) / 1000)}</td><td class="nd-num">${unit.verified}/${unit.count} ใบ</td><td class="nd-num">${unit.verified ? formatQty(unit.scrapped) : "—"}</td><td class="nd-num">${unit.verified ? formatQty(unit.repaired) : "—"}</td><td class="nd-num">${unit.verified ? formatQty(unit.returned) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="nd-hint">ยังไม่มีผลยืนยัน ${fmtCount(unverified)} ตัวเลขทิ้ง/ซ่อม/ส่งคืนจึงเป็นผลของใบที่ยืนยันแล้วเท่านั้น</p>` : `<p class="nd-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`}`;
  }

  function drillHtml(list) {
    const sorted = [...list].sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : b.ncr_no.localeCompare(a.ncr_no)));
    const shown = sorted.slice(0, drillLimit);
    return `<div class="nd-head"><h2>รายการ NCR ที่ประกอบเป็นตัวเลขด้านบน</h2><p>ทั้งหมด <b>${fmtNumber(list.length)}</b> ใบ ตรงกับจำนวนใน "NCR ที่ออกในช่วงนี้" แตะเลขที่เพื่อเปิดใบ</p></div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>วันที่ออก</th><th>สินค้า / ข้อบกพร่อง</th><th>สถานะ</th><th class="nd-num">สุทธิยืนยัน (฿)</th><th class="nd-num">ประมาณการ (฿)</th></tr></thead><tbody>
      ${shown.map((row) => `<tr><td><a class="request-no" href="#/ncr?id=${encodeURIComponent(row.id)}">${esc(row.ncr_no)}</a></td><td class="nd-nowrap">${esc(row.issue_date)}</td><td>${esc(row.product_name)}<br><span class="nd-muted">${esc(row.defect?.name_th ?? "—")} · ${esc(row.responsibilities.map((item) => item.dept).join("+") || "—")}</span></td><td>${row.overdue ? `<span class="nd-pill crit"><span class="nd-ico" aria-hidden="true">▲</span>เกินกำหนดตอบ</span>` : esc(STATUS_LABELS[row.status] ?? row.status)}</td><td class="nd-num">${row.fin.net ? fmtNumber(row.fin.net) : "—"}</td><td class="nd-num">${row.fin.estimated ? fmtNumber(row.fin.estimated) : "—"}</td></tr>`).join("")}</tbody></table></div>
      ${list.length > drillLimit ? `<div><button type="button" class="btn secondary" data-more>แสดงเพิ่ม (เหลือ ${fmtNumber(list.length - drillLimit)} ใบ)</button></div>` : ""}` : `<p class="nd-empty">ไม่มี NCR ตรงกับตัวกรองนี้</p>`}`;
  }

  const definitionsHtml = `<details class="nd-defs"><summary>นิยามที่ใช้ในหน้านี้</summary><div><ol>
    <li><b>ฐานเวลา:</b> ทุกตัวเลขนับจากใบที่ออกในช่วงที่เลือก มูลค่าคือยอดสะสมของใบนั้น</li>
    <li><b>SLA 5 วัน:</b> เริ่มนับเมื่อใบเข้าขั้น "รอแผนกตอบ" (ส่งกลับมาตอบใหม่ก็เริ่มนับใหม่) ขั้นรอ ผจก.โรงงานพิจารณายังไม่นับ ตอบทัน % = ตอบทัน ÷ (ตอบแล้ว + เกินกำหนดที่ยังไม่ตอบ) จึงต่างจากป้าย "เกินกำหนดตอบ" ในทะเบียน NCR ที่นับจากวันออกใบ</li>
    <li><b>ขั้นที่ต้องประเมินต้นทุน:</b> ตั้งแต่ขั้นรอแผนกตอบเป็นต้นไป ประเมินครบ = ติ๊กประเมินครบแล้วและไม่มีรายการประมาณการหรือรายการเดิมค้าง</li>
    <li><b>ยอดหลัก:</b> นับเฉพาะยืนยันแล้ว สุทธิ = สูญเสียยืนยัน − ชดเชยยืนยัน ประมาณการและรายการเดิมแสดงแยก</li></ol>
    <p>จำนวนใบนับเต็มใบเสมอ ใบที่มีหลายแผนกหรือหลายสาเหตุนับในทุกกลุ่ม จึงห้ามบวกจำนวนข้ามกลุ่ม ส่วนบาทแบ่งตามสัดส่วนแผนก</p></div></details>`;

  let lastFilters = null;
  function pageBody() {
    const { rows, today, loadedAt } = cache;
    const filters = readFilters(lastParams, rows, today);
    lastFilters = filters;
    const list = model.select(rows, filters);
    const sums = model.summarize(list, filters);
    return `<div class="page-heading"><div><div class="eyebrow">NCR · QA02-FM02</div><h1>แดชบอร์ด NCR</h1><p>เวอร์ชันโหมดทดสอบ · ไม่นับใบที่ยกเลิก</p></div>
        <div class="ncr-heading-status"><a class="btn secondary" href="${hrefWith(filters, {})}&refresh=1" title="ดึงข้อมูลล่าสุด">รีเฟรช</a><a class="btn secondary" href="#/ncr">ทะเบียน NCR</a></div></div>
      <div class="nd">
        <div class="nd-controls">${controlsHtml(filters, rows, today, sums)}</div>
        <div class="nd-summary" role="status">${summaryHtml(sums)}</div>
        <div class="nd-tiles">${tilesHtml(filters, sums)}</div>
        <section class="card nd-card">${actHtml(list, today)}</section>
        <section class="card nd-card">${trendHtml(rows, filters, today)}</section>
        <section class="card nd-card">${paretoHtml(list, filters, sums)}</section>
        <section class="card nd-card">${deptHtml(list, filters)}</section>
        <div class="nd-two">
          <section class="card nd-card">${breakdownHtml("source", "แหล่งที่พบ", "นับใบเต็มใบ แตะแท่งเพื่อดูตัวเลข", model.countBy(list, (row) => [row.source]), SOURCES, filters, "source", list.length)}</section>
          <section class="card nd-card">${breakdownHtml("cause", "สาเหตุ 4M+E", "ใบที่มีหลายสาเหตุนับในทุกสาเหตุ (ซ้อนกันได้) จึงไม่รวมกันเป็น 100%", model.countBy(list, model.causeKeys), CAUSE_LABELS, filters, "cause", list.length)}</section>
        </div>
        <section class="card nd-card">${outcomesHtml(list)}</section>
        <section class="card nd-card">${drillHtml(list)}</section>
        ${definitionsHtml}
        <p class="nd-muted">ข้อมูล ณ ${esc(new Date(loadedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }))} · ตัวเลขนับเฉพาะ NCR ที่บัญชีนี้มีสิทธิ์เห็น</p>
      </div>`;
  }

  function paint() {
    const root = document.getElementById("nd-root");
    if (!root || !cache) return;
    const focusKey = document.activeElement?.dataset?.sel ?? (document.activeElement?.hasAttribute?.("data-more") ? "__more" : null);
    root.innerHTML = pageBody();
    bindPage(root);
    if (focusKey) (focusKey === "__more" ? root.querySelector("[data-more]") : root.querySelector(`[data-sel="${CSS.escape(focusKey)}"]`))?.focus({ preventScroll: true });
  }

  // ผูกครั้งเดียวต่อหน้า (root ถูกสร้างใหม่ทุกครั้งที่เปิดหน้า) ส่วนตัวกรองในฟอร์มผูกใหม่ทุกครั้งที่วาด
  function bindRoot(root) {
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sel]");
      if (button) {
        const [card, ...rest] = button.dataset.sel.split(":");
        const key = rest.join(":");
        selection = selection?.card === card && selection.key === key ? null : { card, key };
        paint();
        return;
      }
      if (event.target.closest("[data-more]")) { drillLimit += 10; paint(); }
    });
  }

  function bindPage(root) {
    root.querySelector("#nd-filters")?.addEventListener("change", (event) => {
      const field = event.target.name;
      if (!field) return;
      filtersOpen = true;
      location.hash = hrefWith(lastFilters, { [field]: event.target.value }).slice(1);
    });
    root.querySelector("#nd-filterbox")?.addEventListener("toggle", (event) => { filtersOpen = event.target.open; });
  }

  async function renderDashboard(params) {
    lastParams = params;
    selection = null;
    drillLimit = 10;
    const refresh = Boolean(params.get("refresh"));
    const fresh = !cache || cache.employeeId !== state.employee?.id || Date.now() - cache.loadedAt >= CACHE_MS || refresh;
    if (fresh) loadingShell(PATH, "แดชบอร์ด NCR");
    await loadData(refresh);
    app.innerHTML = shell(`<div id="nd-root"></div>`, PATH, "แดชบอร์ด NCR");
    bindShell();
    bindRoot(document.getElementById("nd-root"));
    paint();
  }

  ncrModule.shared.invalidateDashboard = () => { cache = null; ncrModule.shared.invalidateLiveDashboard?.(); };
  ncrModule.nav = [...(ncrModule.nav ?? []), { path: PATH, label: "แดชบอร์ด NCR", icon: ICON }];
  ncrModule.pages = { ...(ncrModule.pages ?? {}), [PATH]: (params) => (state.employee?.isSandbox ? renderDashboard(params) : ncrModule.shared.renderLiveDashboard(params)) };
})();
