// แดชบอร์ด NCR ของ Pilot Web (#/ncr-dashboard) — ตัวเลขทุกตัวคำนวณจากรายการ NCR ชุดเดียว
// ผ่าน modules/ncr-dashboard-model.js (นิยามและเทสต์อยู่ที่นั่น) ไฟล์นี้ทำหน้าที่โหลดข้อมูลและวาดหน้าจอเท่านั้น
//
// - อ่านผ่าน RLS เดียวกับทะเบียน NCR (ncr_reports, ncr_losses, ncr_outcomes, ncr_status_history)
// - ฐานเวลาเดียว: วันที่ออก NCR นับจำนวนใบเต็มใบ ส่วนบาทแบ่งตามสัดส่วนแผนก
// - ตัวกรองอยู่ใน URL แชร์ลิงก์ได้ แตะรายการในการ์ดเพื่อดูตัวเลขในหน้า (ไม่ใช้ป๊อปอัพ) แล้วกดกรองทั้งหน้า
// - ทางเข้าคือปุ่ม "แดชบอร์ด NCR" ข้างปุ่ม "ออก NCR" ในหน้า NCR (headerLinks) ไม่มีเมนูข้างแยก
//
// โหลดหลัง modules/module-ncr.js และ modules/ncr-dashboard-model.js — helper ของ app.js
// (sb, state, shell, bindShell, loadingShell, escapeHtml, relation) ถูกเรียกตอนเปิดหน้าเท่านั้น
(function registerNcrDashboard() {
  const ncrModule = window.MNP_REQUEST_MODULES?.NCR_CAR;
  const model = window.MNP_NCR_DASHBOARD;
  if (!ncrModule?.shared || !model) return;
  const { STATUS_LABELS, SOURCES, CAUSES, LOSS_TYPES, todayBangkok, formatQty } = ncrModule.shared;

  const PATH = "ncr-dashboard";
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const ICON = `<span aria-hidden="true">📊</span>`;
  const CACHE_MS = 60 * 1000;
  const CAUSE_LABELS = { ...CAUSES, [model.NO_CAUSE]: "ยังไม่ได้วิเคราะห์" };
  const CHART_HEIGHT = 140;
  let cache = null;
  let selection = null; // { card, key } ของรายการที่แตะดูตัวเลข (อยู่ในหน้า ไม่ใช่ป๊อปอัพ)
  let lastParams = new URLSearchParams();
  let drillLimit = 10;
  let filtersOpen = false;
  let drillAnchor = null; // การ์ดที่ผู้ใช้กดกรองมา — รายการ NCR แสดงต่อท้ายการ์ดนั้น (ว่าง = ใต้แถบตัวกรอง/ตัวเลขสรุป)
  let pendingDrill = null; // { params, card } ของลิงก์/ฟอร์มกรองที่เพิ่งกด รอ hashchange พาเข้า renderDashboard
  let scrollToDrill = false;

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
      loss: LOSS_TYPES[params.get("loss")] ? params.get("loss") : "",
      scope: ["open", "overdue"].includes(params.get("scope")) ? params.get("scope") : "",
      sort: params.get("sort") === "count" ? "count" : "net",
    };
  }

  function hrefWith(filters, changes) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    for (const key of ["year", "from", "to", "dept", "defect", "source", "cause", "loss", "scope", "sort"]) {
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
  const detailHint = (noun) => `<p class="nd-hint">แตะ${noun}เพื่อดูตัวเลขของรายการนั้น แล้วกดกรองทั้งหน้าได้</p>`;
  const detailHtml = (item) => `<div class="nd-detail" role="status"><strong>${esc(item.title)}</strong><ul>${item.lines.map(([label, value]) => `<li><span>${esc(label)}</span><span>${esc(value)}</span></li>`).join("")}</ul>${item.href ? `<a class="btn secondary small" href="${item.href}">${esc(item.linkLabel ?? "กรองทั้งหน้าตามนี้")}</a>` : ""}</div>`;
  // รายละเอียดของรายการที่เลือก (ถ้ามี) — resolve(key) คืน { title, lines, href, linkLabel } หรือ null
  const selectedItem = (card, resolve) => (selection?.card === card ? resolve(selection.key) : null);
  // รายการที่เลือกแสดงรายละเอียดต่อท้ายตัวรายการนั้นเอง ไม่ไปรวมที่ท้ายการ์ด
  const detailUnder = (card, key, resolve) => {
    const item = selection?.card === card && selection.key === String(key) ? resolve(selection.key) : null;
    return item ? detailHtml(item) : "";
  };
  // คำใบ้ท้ายการ์ด แสดงเฉพาะตอนยังไม่ได้เลือกรายการ
  const detailHintIfIdle = (card, noun, resolve) => (selectedItem(card, resolve) ? "" : detailHint(noun));
  // กราฟเดือนเป็นแท่งตั้งเรียงข้างกัน ไม่มีที่ใต้แท่งเดียว จึงแสดงรายละเอียดใต้กราฟ
  function detailBox(card, noun, resolve) {
    const item = selectedItem(card, resolve);
    return item ? detailHtml(item) : detailHint(noun);
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
    const labelFor = { dept: () => filters.dept, defect: () => rows.find((row) => row.defect?.code === filters.defect)?.defect?.name_th ?? filters.defect, source: () => SOURCES[filters.source], cause: () => CAUSE_LABELS[filters.cause], loss: () => LOSS_TYPES[filters.loss] };
    const titles = { dept: "แผนก", defect: "ข้อบกพร่อง", source: "แหล่งที่พบ", cause: "สาเหตุ", loss: "ต้นทุน" };
    const removable = ["dept", "defect", "source", "cause", "loss"].filter((key) => filters[key]).map((key) => `<a class="nd-chip removable" href="${hrefWith(filters, { [key]: "" })}" aria-label="ยกเลิกตัวกรอง ${titles[key]} ${esc(labelFor[key]())}">${titles[key]}: ${esc(labelFor[key]())} <span aria-hidden="true">✕</span></a>`);
    if (filters.scope) removable.push(`<a class="nd-chip removable" href="${hrefWith(filters, { scope: "" })}" aria-label="ยกเลิกตัวกรองสถานะ">${filters.scope === "open" ? "ใบที่ค้างอยู่" : "ใบเกินกำหนดตอบ"} <span aria-hidden="true">✕</span></a>`);
    if (removable.length) removable.push(`<a class="nd-chip" href="${hrefWith(filters, { dept: "", defect: "", source: "", cause: "", loss: "", scope: "" })}">ล้างทั้งหมด</a>`);
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

  function barRows({ card, items, valueOf, subOf, filters, filterKey, resolve }) {
    const max = items.length ? Math.max(...items.map((item) => valueOf(item).amount)) : 0;
    return `<div class="nd-bars">${items.map((item) => {
      const { amount, text } = valueOf(item);
      const inner = `<span class="nd-lab">${esc(item.label)}</span><span class="nd-trk"><span class="nd-bar${item.vital === false ? " rest" : ""}" style="width:${max ? Math.max((amount / max) * 100, 0.8) : 0}%"></span></span><span class="nd-val">${esc(text)}${subOf?.(item) ? `<small>${esc(subOf(item))}</small>` : ""}</span>`;
      return selectButton(card, item.key, inner, `nd-brow${filterKey && filters[filterKey] === item.key ? " active" : ""}`) + detailUnder(card, item.key, resolve);
    }).join("")}</div>`;
  }

  function paretoHtml(list, filters, sums) {
    const items = model.pareto(list, filters, filters.sort);
    const byNet = filters.sort === "net";
    const warn = byNet && sums.assessedRate !== null && sums.assessedRate < 1 ? `<div class="nd-warn">บาทในรายการนี้เป็นค่าขั้นต่ำ ประเมินต้นทุนครบ ${fmtPercent(sums.assessedRate)} ของใบที่ต้องประเมิน ใบที่มีแต่ประมาณการไม่ปรากฏในแท่ง</div>` : "";
    const resolve = (key) => {
      const item = items.find((entry) => entry.key === key);
      return item && { title: item.label, lines: [["จำนวนใบ", fmtCount(item.count)], ["สูญเสียสุทธิยืนยัน", fmtBaht(item.net)], ["สัดส่วนในกราฟนี้", fmtPercent(item.share)], ["สะสม", fmtPercent(item.cumulative)]], href: hrefWith(filters, { defect: filters.defect === key ? "" : key }), linkLabel: filters.defect === key ? "ยกเลิกการกรอง" : undefined };
    };
    return `<div class="nd-head"><h2>ปัญหาอะไรเยอะ / แพง</h2><p>Pareto ประเภทข้อบกพร่อง แตะแท่งเพื่อดูตัวเลข</p></div>
      <div class="nd-chips" role="group" aria-label="เรียงตาม"><a class="nd-chip" href="${hrefWith(filters, { sort: "net" })}" aria-current="${byNet}">เรียงตามบาท</a><a class="nd-chip" href="${hrefWith(filters, { sort: "count" })}" aria-current="${!byNet}">เรียงตามจำนวนใบ</a></div>${warn}
      ${items.length ? `${barRows({ card: "pareto", items, filters, filterKey: "defect", resolve, valueOf: (item) => (byNet ? { amount: item.net, text: fmtBaht(item.net) } : { amount: item.count, text: fmtCount(item.count) }), subOf: (item) => (byNet ? fmtCount(item.count) : item.net ? fmtBaht(item.net) : "") })}
      <div class="nd-legend"><span><i class="strong"></i>กลุ่มที่รวมกันได้ 80% แรก ควรแก้ก่อน</span><span><i class="soft"></i>ที่เหลือ</span></div>` : `<p class="nd-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`}
      ${detailHintIfIdle("pareto", "แท่ง", resolve)}`;
  }

  // ความสูญเสียแยกตามประเภทต้นทุน: ยืนยัน (ทึบ) + ประมาณการ (จาง) ชดเชยและรายการเดิมแสดงแยก ไม่รวมในแท่ง
  function lossTypeHtml(list, filters, sums) {
    const items = model.lossesByType(list, filters).map((item) => ({ ...item, label: LOSS_TYPES[item.key] ?? item.key }));
    const max = items.length ? Math.max(...items.map((item) => item.confirmed + item.estimated)) : 0;
    const widthOf = (value) => (max ? Math.max((value / max) * 100, 0.8) : 0);
    const resolve = (key) => {
      const item = items.find((entry) => entry.key === key);
      return item && { title: item.label, lines: [["ยืนยันแล้ว (ก่อนหักชดเชย)", fmtBaht(item.confirmed)], ["ประมาณการรอยืนยัน", fmtBaht(item.estimated)], ["จำนวนใบที่มีรายการประเภทนี้", fmtCount(item.count)], ["สัดส่วนของยอดยืนยัน", fmtPercent(item.share)]], href: hrefWith(filters, { loss: filters.loss === key ? "" : key }), linkLabel: filters.loss === key ? "ยกเลิกการกรอง" : "ดูเฉพาะใบที่มีต้นทุนประเภทนี้" };
    };
    const rows = items.map((item) => {
      const inner = `<span class="nd-lab">${esc(item.label)}</span><span class="nd-trk stack">${item.confirmed > 0 ? `<span class="nd-bar" style="width:${widthOf(item.confirmed)}%"></span>` : ""}${item.estimated > 0 ? `<span class="nd-bar rest" style="width:${widthOf(item.estimated)}%"></span>` : ""}</span><span class="nd-val">${esc(fmtBaht(item.confirmed))}${item.estimated ? `<small>+ ประมาณการ ${esc(fmtBaht(item.estimated))}</small>` : ""}</span>`;
      return selectButton("loss", item.key, inner, `nd-brow${filters.loss === item.key ? " active" : ""}`) + detailUnder("loss", item.key, resolve);
    }).join("");
    const notes = [sums.recovery ? `ชดเชยยืนยัน −${fmtBaht(sums.recovery)} แสดงแยก ไม่หักในแท่ง` : "", sums.legacy ? `รายการเดิมรอตรวจสอบ ${fmtBaht(sums.legacy)} ไม่รวมในแท่ง` : ""].filter(Boolean).join(" · ");
    return `<div class="nd-head"><h2>ความสูญเสียแยกประเภท</h2><p>ค่าซ่อม (Repair) กับ Rework แยกคนละแท่ง ยอดยืนยันรวม ${esc(fmtBaht(sums.gross))} ตรงกับ "สูญเสียยืนยัน (ก่อนชดเชย)" ในรายละเอียดของการ์ดสูญเสียสุทธิ แตะแท่งเพื่อดูตัวเลข</p></div>
      ${items.length ? `<div class="nd-bars">${rows}</div>
      <div class="nd-legend"><span><i class="strong"></i>ยืนยันแล้ว (ก่อนหักชดเชย)</span><span><i class="soft"></i>ประมาณการรอยืนยัน</span></div>${notes ? `<p class="nd-hint">${esc(notes)}</p>` : ""}` : `<p class="nd-empty">ยังไม่มีการบันทึกความสูญเสียที่ยืนยันหรือประมาณการในช่วงนี้</p>`}
      ${detailHintIfIdle("loss", "แท่ง", resolve)}`;
  }

  function deptHtml(list, filters) {
    const { rows: deptRows, total } = model.deptTable(list, filters);
    const resolve = (key) => {
      const row = deptRows.find((entry) => entry.dept === key);
      return row && { title: key ? `แผนก ${key}` : "ยังไม่กำหนดแผนก", lines: [["ใบที่เกี่ยวข้อง", fmtCount(row.count)], ["ค้างอยู่", fmtCount(row.open)], ["เกินกำหนดตอบ", fmtCount(row.overdue)], ["ตอบทันกำหนด", fmtPercent(row.onTimeRate)], ["สูญเสียสุทธิที่แบ่งตามสัดส่วนแผนก", fmtBaht(row.net)]], href: key ? hrefWith(filters, { dept: filters.dept === key ? "" : key }) : null, linkLabel: filters.dept === key ? "ยกเลิกการกรอง" : undefined };
    };
    const detailRow = (key) => { const detail = detailUnder("dept", key, resolve); return detail ? `<tr class="nd-detail-row"><td colspan="6">${detail}</td></tr>` : ""; };
    return `<div class="nd-head"><h2>ใคร / แผนกไหน</h2><p>จำนวนใบนับเต็มใบ ใบที่มีหลายแผนกจึงอยู่ในหลายแถวและห้ามบวกข้ามแถว ส่วนบาทแบ่งตามสัดส่วน แถวรวมตรงกับตัวเลขด้านบน</p></div>
      ${deptRows.length ? `<div class="table-wrap"><table><thead><tr><th>แผนก</th><th class="nd-num">ใบที่เกี่ยวข้อง</th><th class="nd-num">ค้าง</th><th class="nd-num">เกินกำหนด</th><th class="nd-num">ตอบทัน</th><th class="nd-num">สุทธิ (บาท)</th></tr></thead><tbody>
      ${deptRows.map((row) => `<tr><td>${selectButton("dept", row.dept, esc(row.dept || "ยังไม่กำหนดแผนก"), "nd-rowbtn")}</td><td class="nd-num">${fmtNumber(row.count)}</td><td class="nd-num">${fmtNumber(row.open)}</td><td class="nd-num">${row.overdue ? `<span class="nd-pill crit"><span class="nd-ico" aria-hidden="true">▲</span>${row.overdue}</span>` : "0"}</td><td class="nd-num">${fmtPercent(row.onTimeRate)}</td><td class="nd-num">${fmtNumber(row.net)}</td></tr>${detailRow(row.dept)}`).join("")}
      <tr class="nd-total"><td>รวม (ไม่ซ้ำ)</td><td class="nd-num">${fmtNumber(total.total)}</td><td class="nd-num">${fmtNumber(total.open)}</td><td class="nd-num">${fmtNumber(total.overdue)}</td><td class="nd-num">${fmtPercent(total.onTimeRate)}</td><td class="nd-num">${fmtNumber(total.net)}</td></tr></tbody></table></div>` : `<p class="nd-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`}
      ${detailHintIfIdle("dept", "ชื่อแผนก", resolve)}`;
  }

  function breakdownHtml(card, title, subtitle, items, labels, filters, filterKey, total) {
    const rows = items.map((item) => ({ ...item, label: labels[item.key] ?? item.key }));
    const resolve = (key) => {
      const item = rows.find((entry) => entry.key === key);
      return item && { title: item.label, lines: [["จำนวนใบ", fmtCount(item.count)], ["สัดส่วนของใบในช่วงนี้", fmtPercent(total ? item.count / total : null)]], href: hrefWith(filters, { [filterKey]: filters[filterKey] === key ? "" : key }), linkLabel: filters[filterKey] === key ? "ยกเลิกการกรอง" : undefined };
    };
    return `<div class="nd-head"><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
      ${rows.length ? barRows({ card, items: rows, filters, filterKey, resolve, valueOf: (item) => ({ amount: item.count, text: fmtCount(item.count) }) }) : `<p class="nd-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`}
      ${detailHintIfIdle(card, "แท่ง", resolve)}`;
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
    return `<div class="page-heading"><div><div class="eyebrow">NCR · QA02-FM02</div><h1>แดชบอร์ด NCR</h1><p>ไม่นับใบที่ยกเลิก</p></div>
        <div class="ncr-heading-status"><a class="btn secondary" href="${hrefWith(filters, {})}&refresh=1" title="ดึงข้อมูลล่าสุด">รีเฟรช</a><a class="btn secondary" href="#/ncr">‹ กลับหน้า NCR</a></div></div>
      <div class="nd">
        <div class="nd-controls">${controlsHtml(filters, rows, today, sums)}</div>
        <div class="nd-summary" role="status">${summaryHtml(sums)}</div>
        <div class="nd-tiles" data-card="tiles">${tilesHtml(filters, sums)}</div>
        <section class="card nd-card" data-card="act">${actHtml(list, today)}</section>
        <section class="card nd-card" data-card="trend">${trendHtml(rows, filters, today)}</section>
        <section class="card nd-card" data-card="pareto">${paretoHtml(list, filters, sums)}</section>
        <section class="card nd-card" data-card="losstype">${lossTypeHtml(list, filters, sums)}</section>
        <section class="card nd-card" data-card="dept">${deptHtml(list, filters)}</section>
        <div class="nd-two">
          <section class="card nd-card" data-card="source">${breakdownHtml("source", "แหล่งที่พบ", "นับใบเต็มใบ แตะแท่งเพื่อดูตัวเลข", model.countBy(list, (row) => [row.source]), SOURCES, filters, "source", list.length)}</section>
          <section class="card nd-card" data-card="cause">${breakdownHtml("cause", "สาเหตุ 4M+E", "ใบที่มีหลายสาเหตุนับในทุกสาเหตุ (ซ้อนกันได้) จึงไม่รวมกันเป็น 100%", model.countBy(list, model.causeKeys), CAUSE_LABELS, filters, "cause", list.length)}</section>
        </div>
        <section class="card nd-card" data-card="outcomes">${outcomesHtml(list)}</section>
        <section class="card nd-card" id="nd-drill">${drillHtml(list)}</section>
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
    placeDrill(root);
    if (scrollToDrill) {
      scrollToDrill = false;
      // เลื่อนเฉพาะตอนกรองจริงหรือกดจากการ์ด (เปลี่ยนแค่ช่วงเวลาไม่ต้องกระโดดไปที่รายการ)
      if (drillAnchor || hasDrillFilter(lastFilters)) root.querySelector("#nd-drill")?.scrollIntoView({ block: "start" });
    }
  }

  // รายการ NCR ที่กรองแล้วไม่อยู่ท้ายหน้า: วางต่อท้ายส่วนที่ผู้ใช้กดกรองมาทันที — การ์ด (data-card) ที่กดลิงก์ หรือใต้แถบตัวกรองถ้ากดจากช่วงเวลา/ชิป/ฟอร์ม
  // ถ้าเปิดจากลิงก์ที่แชร์ (ไม่รู้ว่ากดจากไหน) วางใต้แถบตัวกรองเมื่อมีตัวกรอง ไม่มีตัวกรองก็ใต้ตัวเลขสรุป
  function placeDrill(root) {
    const drill = root.querySelector("#nd-drill");
    if (!drill) return;
    const key = drillAnchor ?? (hasDrillFilter(lastFilters) ? "controls" : "tiles");
    const host = key === "controls" ? root.querySelector(".nd-summary") : root.querySelector(`[data-card="${CSS.escape(key)}"]`);
    (host?.closest(".nd > *") ?? root.querySelector(".nd-summary"))?.after(drill);
  }
  const hasDrillFilter = (filters) => Boolean(filters && (filters.scope || filters.dept || filters.defect || filters.source || filters.cause || filters.loss));

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
      if (event.target.closest("[data-more]")) { drillLimit += 10; paint(); return; }
      // ลิงก์กรอง: จำการ์ดต้นทางไว้ แล้วให้ renderDashboard วางรายการ NCR ต่อท้ายการ์ดนั้น (ลิงก์นอกการ์ดวางใต้แถบตัวกรอง)
      const link = event.target.closest("a[href^='#/" + PATH + "?']");
      if (link) rememberFilterClick(new URLSearchParams(link.getAttribute("href").split("?")[1]), link.closest("[data-card]")?.dataset.card ?? null);
    });
  }

  function rememberFilterClick(params, card) {
    pendingDrill = params.get("refresh") ? null : { params, card };
  }

  function bindPage(root) {
    root.querySelector("#nd-filters")?.addEventListener("change", (event) => {
      const field = event.target.name;
      if (!field) return;
      filtersOpen = true;
      const hash = hrefWith(lastFilters, { [field]: event.target.value }).slice(1);
      rememberFilterClick(new URLSearchParams(hash.split("?")[1]), null);
      location.hash = hash;
    });
    root.querySelector("#nd-filterbox")?.addEventListener("toggle", (event) => { filtersOpen = event.target.open; });
  }

  async function renderDashboard(params) {
    lastParams = params;
    selection = null;
    drillLimit = 10;
    // ใช้ตำแหน่งที่จำไว้เมื่อ hashchange นี้มาจากลิงก์/ฟอร์มกรองที่เพิ่งกดเท่านั้น (ลิงก์ที่ hash ไม่เปลี่ยนจะไม่ทำให้เหลือค่าค้างไปหน้าอื่น)
    const fromClick = pendingDrill && pendingDrill.params.toString() === params.toString() ? pendingDrill : null;
    pendingDrill = null;
    drillAnchor = fromClick?.card ?? null;
    scrollToDrill = Boolean(fromClick);
    const refresh = Boolean(params.get("refresh"));
    const fresh = !cache || cache.employeeId !== state.employee?.id || Date.now() - cache.loadedAt >= CACHE_MS || refresh;
    if (fresh) loadingShell("ncr", "แดชบอร์ด NCR");
    await loadData(refresh);
    app.innerHTML = shell(`<div id="nd-root"></div>`, "ncr", "แดชบอร์ด NCR");
    bindShell();
    bindRoot(document.getElementById("nd-root"));
    paint();
  }

  ncrModule.shared.invalidateDashboard = () => { cache = null; };
  ncrModule.headerLinks = [...(ncrModule.headerLinks ?? []), { href: `#/${PATH}`, label: "แดชบอร์ด NCR", icon: ICON }];
  ncrModule.pages = { ...(ncrModule.pages ?? {}), [PATH]: renderDashboard };
})();
