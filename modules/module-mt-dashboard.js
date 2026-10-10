// แดชบอร์ด MT ของ Pilot Web (#/mt-dashboard) — เวอร์ชันทดสอบ: งานค้าง/คอขวด/เวลาที่ใช้/คุณภาพ
// + เครื่องจักรที่เสียบ่อย/แผนกที่แจ้งซ่อมบ่อย/ชั่วโมงงานของช่าง
// ตัวเลขทุกตัวคำนวณจากรายการใบแจ้งซ่อมชุดเดียวผ่าน modules/mt-dashboard-model.js (นิยามและเทสต์อยู่ที่นั่น)
// ไฟล์นี้ทำหน้าที่โหลดข้อมูลและวาดหน้าจอเท่านั้น
//
// - อ่านผ่าน RLS เดียวกับหน้าคำร้อง (requests, request_status_history, request_verifications, request_technicians,
//   machines, employees) และ RPC อ่านชื่อผู้รับงานตามบทบาทเฉพาะใบที่บัญชีมีสิทธิ์เห็น
// - สองฐานที่ไม่ปนกัน: งานค้างนับทุกใบที่ยังไม่จบ (ไม่ขึ้นกับช่วงเวลา) ส่วนตัวเลขอื่นนับตามวันที่แจ้งในช่วงที่เลือก
// - ตัวกรองอยู่ใน URL แชร์ลิงก์ได้ แตะแถบเพื่อดูตัวเลขในหน้า (ไม่ใช้ป๊อปอัพ) แล้วกดกรองรายการด้านล่างได้
//   รายการใบที่กรองแล้วไม่อยู่ท้ายหน้า: แสดงต่อท้ายส่วนที่กดกรองทันทีและเลื่อนไปที่รายการ (placeDrill)
// - ทางเข้าคือปุ่ม "แดชบอร์ด MT" ข้างปุ่ม "สร้างคำร้อง / แจ้งซ่อม MT" (headerLinks) ไม่มีเมนูข้างแยก
//
// โหลดหลัง modules/module-mt.js และ modules/mt-dashboard-model.js — helper ของ app.js
// (sb, state, shell, bindShell, loadingShell, escapeHtml, relation, bangkokToday, formatDate, statusBadge)
// ถูกเรียกตอนเปิดหน้าเท่านั้น
(function registerMtDashboard() {
  const mtModule = window.MNP_REQUEST_MODULES?.MT_REPAIR;
  const model = window.MNP_MT_DASHBOARD;
  if (!mtModule || !model) return;

  const PATH = "mt-dashboard";
  const TITLE = "แดชบอร์ด MT";
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const ICON = `<span aria-hidden="true">📊</span>`;
  const CACHE_MS = 60 * 1000;
  const DOC_LABELS = { repair: "ใบแจ้งซ่อม", request: "ใบคำร้อง" };
  const SCOPE_LABELS = { open: "งานค้างทั้งหมด", overdue: "เลยกำหนดเสร็จ", urgent: "ด่วนที่ยังไม่จบ" };
  const FILTER_KEYS = ["year", "from", "to", "dept", "doc", "scope", "stage", "machine", "tech"];
  let cache = null;
  let selection = null; // { card, key } ของรายการที่แตะดูตัวเลข (อยู่ในหน้า ไม่ใช่ป๊อปอัพ)
  let lastParams = new URLSearchParams();
  let lastFilters = null;
  let drillLimit = 10;
  let filtersOpen = false;
  let drillAnchor = null; // การ์ดที่ผู้ใช้กดกรองมา — รายการใบแสดงต่อท้ายการ์ดนั้น (ว่าง = ท้ายหน้า)
  let pendingDrill = null; // { params, card } ของลิงก์กรองที่เพิ่งกด รอ hashchange พาเข้า renderDashboard
  let scrollToDrill = false;
  let drillOrigin = null; // { card, sel } จุดที่กดกรองมา — ยกเลิกการกรองแล้วเลื่อนกลับมาตรงนี้
  let anchorFix = null; // { selector, top } ตำแหน่งบนจอของจุดต้นทางก่อนวาดหน้าใหม่ — วาดแล้วชดเชยให้อยู่ที่เดิม (การ์ดด้านบนสูง/ต่ำลงตามตัวกรอง)
  let restoreScrollY = null; // ตำแหน่งเลื่อนก่อนกดกรอง — วาดหน้าใหม่แล้วคืนตำแหน่งเดิมก่อน แล้วค่อยเลื่อนนุ่มๆ ไปที่รายการ

  const fmtNumber = (value, digits = 0) => Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: digits });
  const fmtCount = (value) => `${fmtNumber(value)} ใบ`;
  const fmtHours = (value) => (value === null || value === undefined ? "—" : `${fmtNumber(value, 1)} ชม.`);
  const fmtDays = (value) => (value === null || value === undefined ? "—" : `${fmtNumber(value, 1)} วัน`);
  const fmtPercent = (value) => (value === null || value === undefined ? "—" : `${fmtNumber(value * 100, 1)}%`);
  const esc = (value) => escapeHtml(String(value));
  const monthName = (month, year) => `${MONTHS[month - 1]} ${Number(year) + 543}`;
  const techName = (id) => {
    const person = cache?.directory?.get(id);
    return person ? `${person.first_name} ${person.last_name}`.trim() : "ช่าง (ไม่พบชื่อ)";
  };
  function actionOwner(row) {
    const role = model.STAGE_BY_KEY[row.stage]?.owner ?? "—";
    let names = "";
    if (row.stage === "start" || row.stage === "repair") {
      names = row.technicianIds.map(techName).join(", ");
    } else if (row.stage === "more_info" || row.stage === "verify") {
      const person = cache.directory.get(row.requester_id);
      names = person ? [person.first_name, person.last_name].filter(Boolean).join(" ") : row.requester_name;
    } else {
      names = (cache.roleOwners.get(row.id) ?? []).filter((owner) => owner.status === row.status && owner.current_step === row.current_step)
        .map((owner) => `${owner.full_name}${owner.is_fallback ? " (รับแทน)" : ""}`).join(", ");
    }
    return `${role}: ${names || "ไม่พบชื่อผู้รับผิดชอบ"}`;
  }
  const machineTitle = (rows, key) => {
    const row = rows.find((item) => item.machineKey === key);
    return row ? `${String(row.machine_code).trim()} (${row.dept || "—"})` : key;
  };

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
    const typeResult = await sb.from("request_types").select("id").eq("code", "MT_REPAIR").eq("is_active", true).maybeSingle();
    if (typeResult.error) throw typeResult.error;
    const typeId = typeResult.data?.id ?? null;
    // โหลดรายชื่อไม่ได้ก็ยังดูแดชบอร์ดได้ พร้อมข้อความว่าไม่พบชื่อ
    const [requests, directory] = await Promise.all([
      typeId
        ? allRows(() => sb.from("requests")
          .select("id,request_no,status,current_step,is_urgent,doc_type,machine_code,machine_name,requester_id,requester_name,submitted_at,completed_at,work_expected_date,department:departments(code),machine:machines(is_placeholder),request_technicians(technician_id),request_status_history(to_status,created_at),request_verifications(result)")
          .eq("request_type_id", typeId).order("id"))
        : [],
      loadEmployeeDirectory().catch((error) => { console.warn("โหลดรายชื่อพนักงานสำหรับแดชบอร์ด MT ไม่สำเร็จ", error); return new Map(); }),
    ]);
    const today = bangkokToday();
    const rows = model.deriveRows(requests.map((row) => ({
      ...row,
      dept: relation(row.department)?.code ?? "",
      machine_is_placeholder: Boolean(relation(row.machine)?.is_placeholder),
      technician_ids: (row.request_technicians ?? []).map((item) => item.technician_id),
      history: row.request_status_history ?? [],
      verifications: row.request_verifications ?? [],
    })), today);
    const roleOwners = new Map();
    const roleRequestIds = rows.filter((row) => row.stage === "assign" || row.stage === "approve_fm" || row.stage === "approve_gm").map((row) => row.id);
    try {
      for (let offset = 0; offset < roleRequestIds.length; offset += 500) {
        const owners = await allRows(() => sb.rpc("app_mt_dashboard_role_owners", { p_request_ids: roleRequestIds.slice(offset, offset + 500) }));
        for (const owner of owners) {
          if (!roleOwners.has(owner.request_id)) roleOwners.set(owner.request_id, []);
          roleOwners.get(owner.request_id).push(owner);
        }
      }
    } catch (error) {
      console.warn("โหลดชื่อผู้รับผิดชอบตามบทบาทสำหรับแดชบอร์ด MT ไม่สำเร็จ", error);
    }
    cache = { employeeId, loadedAt: Date.now(), today, typeId, rows, directory, roleOwners };
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
    const machineParam = params.get("machine") ?? "";
    const techParam = params.get("tech") ?? "";
    return {
      years, year, from, to,
      dept: params.get("dept") ?? "",
      doc: DOC_LABELS[params.get("doc")] ? params.get("doc") : "",
      scope: SCOPE_LABELS[params.get("scope")] ? params.get("scope") : "",
      stage: model.STAGE_BY_KEY[params.get("stage")] ? params.get("stage") : "",
      machine: machineParam && rows.some((row) => row.machineKey === machineParam) ? machineParam : "",
      tech: techParam && rows.some((row) => row.technicianIds.includes(techParam)) ? techParam : "",
    };
  }

  function hrefWith(filters, changes) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      if (next[key] !== "" && next[key] !== undefined && next[key] !== null) params.set(key, next[key]);
    }
    return `#/${PATH}?${params.toString()}`;
  }

  // ---- รายละเอียดของรายการที่แตะ (อยู่ในหน้า ไม่ใช่ป๊อปอัพ จึงไม่ต้องมีกติกาปิดเมื่อ blur) ----
  function selectButton(card, key, inner, extraClass = "") {
    const on = selection?.card === card && selection.key === String(key);
    return `<button type="button" class="${extraClass}${on ? " selected" : ""}" data-sel="${esc(card)}:${esc(key)}" aria-pressed="${on}">${inner}</button>`;
  }
  const detailHint = (noun) => `<p class="nd-hint">แตะ${noun}เพื่อดูตัวเลขของรายการนั้น แล้วกดกรองรายการด้านล่างได้</p>`;
  const detailHtml = (item) => `<div class="nd-detail" role="status"><strong>${esc(item.title)}</strong><ul>${item.lines.map(([label, value]) => `<li><span>${esc(label)}</span><span>${esc(value)}</span></li>`).join("")}</ul>${item.href ? `<a class="btn secondary small" href="${item.href}">${esc(item.linkLabel ?? "กรองรายการด้านล่างตามนี้")}</a>` : ""}</div>`;
  // รายการที่เลือกแสดงรายละเอียดต่อท้ายตัวรายการนั้นเอง ไม่ไปรวมที่ท้ายการ์ด — resolve(key) คืน { title, lines, href, linkLabel } หรือ null
  const detailUnder = (card, key, resolve) => {
    const item = selection?.card === card && selection.key === String(key) ? resolve(selection.key) : null;
    return item ? detailHtml(item) : "";
  };
  // คำใบ้ท้ายการ์ด แสดงเฉพาะตอนยังไม่ได้เลือกรายการ
  const detailHintIfIdle = (card, noun, resolve) => (selection?.card === card && resolve(selection.key) ? "" : detailHint(noun));

  // ---- ชิ้นส่วนของหน้า ----
  function controlsHtml(filters, rows, today, periodSums, backSums) {
    const presets = presetsFor(today).map((preset) => {
      const active = filters.year === preset.year && filters.from === preset.from && filters.to === preset.to;
      return `<a class="nd-chip" href="${hrefWith(filters, { year: preset.year, from: preset.from, to: preset.to })}" aria-current="${active}">${preset.label}</a>`;
    }).join("");
    const depts = [...new Set(rows.map((row) => row.dept).filter(Boolean))].sort();
    const option = (value, label, selected) => `<option value="${esc(value)}"${String(value) === String(selected) ? " selected" : ""}>${esc(label)}</option>`;
    const monthOptions = (selected) => MONTHS.map((label, index) => option(index + 1, label, selected)).join("");
    const removable = [];
    const chip = (label, key, ariaLabel) => removable.push(`<a class="nd-chip removable" href="${hrefWith(filters, { [key]: "" })}" aria-label="${esc(ariaLabel)}">${esc(label)} <span aria-hidden="true">✕</span></a>`);
    if (filters.dept) chip(`แผนก ${filters.dept}`, "dept", "ยกเลิกตัวกรองแผนก");
    if (filters.doc) chip(DOC_LABELS[filters.doc], "doc", "ยกเลิกตัวกรองประเภทเอกสาร");
    if (filters.machine) chip(`เครื่อง ${machineTitle(rows, filters.machine)}`, "machine", "ยกเลิกตัวกรองเครื่องจักร");
    if (filters.tech) chip(`ช่าง ${techName(filters.tech)}`, "tech", "ยกเลิกตัวกรองช่าง");
    if (filters.scope) chip(SCOPE_LABELS[filters.scope], "scope", "ยกเลิกตัวกรองงานค้าง");
    if (filters.stage) chip(model.STAGE_BY_KEY[filters.stage].label, "stage", "ยกเลิกตัวกรองขั้นตอน");
    if (removable.length) removable.push(`<a class="nd-chip" href="${hrefWith(filters, { dept: "", doc: "", scope: "", stage: "", machine: "", tech: "" })}">ล้างทั้งหมด</a>`);
    return `<div class="nd-chips" role="group" aria-label="ช่วงเวลา (ตามวันที่แจ้ง)">${presets}</div>
      <details class="nd-filterbox" id="nd-filterbox"${filtersOpen ? " open" : ""}><summary>ช่วงเวลาและตัวกรองเพิ่มเติม</summary>
        <form class="nd-filters" id="nd-filters">
          <div class="field"><label for="nd-year">ปี</label><select class="select" id="nd-year" name="year">${filters.years.map((year) => option(year, String(Number(year) + 543), filters.year)).join("")}</select></div>
          <div class="field"><label for="nd-from">ตั้งแต่</label><select class="select" id="nd-from" name="from">${monthOptions(filters.from)}</select></div>
          <div class="field"><label for="nd-to">ถึง</label><select class="select" id="nd-to" name="to">${monthOptions(filters.to)}</select></div>
          <div class="field"><label for="nd-dept">แผนกที่แจ้ง</label><select class="select" id="nd-dept" name="dept">${option("", "ทุกแผนก", filters.dept)}${depts.map((code) => option(code, code, filters.dept)).join("")}</select></div>
          <div class="field"><label for="nd-doc">ประเภทเอกสาร</label><select class="select" id="nd-doc" name="doc">${option("", "ทุกประเภท", filters.doc)}${Object.entries(DOC_LABELS).map(([code, label]) => option(code, label, filters.doc)).join("")}</select></div>
        </form></details>
      ${removable.length ? `<div class="nd-chips" aria-label="ตัวกรองที่ใช้อยู่">${removable.join("")}</div>` : ""}
      <p class="nd-scope">กำลังดู <strong>${esc(filters.from === filters.to ? monthName(filters.from, filters.year) : `${MONTHS[filters.from - 1]}–${monthName(filters.to, filters.year)}`)}</strong> ตามวันที่แจ้ง → <strong>${fmtCount(periodSums.total)}</strong> · งานค้างทุกช่วงเวลา <strong>${fmtCount(backSums.open)}</strong></p>`;
  }

  function summaryHtml(backSums, stages) {
    if (!backSums.open) return "ไม่มีงานค้างในตอนนี้";
    const parts = [];
    if (backSums.overdue) parts.push(`<b>${fmtCount(backSums.overdue)}เลยกำหนดเสร็จ</b> ควรตามก่อน`);
    if (backSums.urgentOpen) parts.push(`ด่วน ${fmtCount(backSums.urgentOpen)}`);
    parts.push(`ค้างอยู่ทั้งหมด ${fmtCount(backSums.open)}`);
    const busiest = [...stages].sort((a, b) => b.count - a.count)[0];
    if (busiest?.count) parts.push(`ค้างมากสุดที่ขั้น "${esc(busiest.label)}" ${fmtCount(busiest.count)}`);
    const oldest = [...stages].filter((stage) => stage.count).sort((a, b) => b.maxDays - a.maxDays)[0];
    if (oldest?.maxDays > 0) parts.push(`ใบที่ค้างนานสุดอยู่ขั้น "${esc(oldest.label)}" ${fmtNumber(oldest.maxDays)} วัน`);
    return parts.join(" · ");
  }

  function tilesHtml(filters, period, back) {
    const list = (lines) => `<ul class="nd-lines">${lines.map(([label, value]) => `<li><span>${esc(label)}</span><span>${esc(value)}</span></li>`).join("")}</ul>`;
    const quality = [["ใบที่ถูกตรวจรับแล้ว", fmtCount(period.verified)], ["เคยตรวจรับไม่ผ่าน", fmtCount(period.verifyFailed)], ["ขอข้อมูลเพิ่ม (เคยถูกส่งกลับให้ผู้แจ้ง)", `${fmtCount(period.moreInfo)} (${fmtPercent(period.moreInfoRate)})`], ["ไม่อนุมัติ", fmtCount(period.rejected)]];
    return `<div class="nd-tile"><a class="nd-tap" href="${hrefWith(filters, { scope: "", stage: "" })}"><span class="nd-label">ใบที่แจ้งในช่วงนี้</span><span class="nd-value">${fmtNumber(period.total)}<small>ใบ</small></span></a>
        <span class="nd-note">ปิดงานแล้ว ${fmtCount(period.completed)} (${fmtPercent(period.completedRate)})${period.rejected ? ` · ไม่อนุมัติ ${fmtCount(period.rejected)}` : ""}</span><span class="nd-meter" role="img" aria-label="ปิดงานแล้ว ${fmtPercent(period.completedRate)}"><span style="width:${(period.completedRate ?? 0) * 100}%"></span></span></div>
      <div class="nd-tile"><a class="nd-tap" href="${hrefWith(filters, { scope: "open", stage: "" })}"><span class="nd-label">งานค้างตอนนี้</span><span class="nd-value">${fmtNumber(back.open)}<small>ใบ</small></span></a>
        ${back.overdue ? `<a class="nd-pill crit" href="${hrefWith(filters, { scope: "overdue", stage: "" })}"><span class="nd-ico" aria-hidden="true">▲</span>เลยกำหนดเสร็จ ${fmtCount(back.overdue)}</a>` : `<span class="nd-pill">ไม่มีใบเลยกำหนดเสร็จ</span>`}
        ${back.urgentOpen ? `<a class="nd-pill crit" href="${hrefWith(filters, { scope: "urgent", stage: "" })}"><span class="nd-ico" aria-hidden="true">▲</span>ด่วน ${fmtCount(back.urgentOpen)}</a>` : ""}
        <span class="nd-note">นับทุกใบที่ยังไม่จบ ไม่จำกัดช่วงเวลา</span></div>
      <div class="nd-tile"><span class="nd-label">เวลาเฉลี่ย แจ้ง → ปิดงาน</span><span class="nd-value">${period.avgCycle === null ? "—" : fmtNumber(period.avgCycle, 1)}<small>วัน</small></span>
        <span class="nd-note">${period.cycleCount ? `กลาง ${fmtDays(period.medianCycle)} · จาก ${fmtCount(period.cycleCount)} ที่ปิดแล้ว` : "ยังไม่มีใบที่ปิดงานในช่วงนี้"}</span></div>
      <div class="nd-tile"><span class="nd-label">ปิดงานทันกำหนด</span><span class="nd-value">${fmtPercent(period.onTimeRate)}</span>
        <span class="nd-meter" role="img" aria-label="ทันกำหนด ${fmtPercent(period.onTimeRate)}"><span style="width:${(period.onTimeRate ?? 0) * 100}%"></span></span>
        <span class="nd-note">${period.onTimeBase ? `ทัน ${fmtNumber(period.onTime)} จาก ${fmtNumber(period.onTimeBase)} ใบ (ใบที่ยังเลยกำหนดนับว่าไม่ทัน)` : "ยังไม่มีใบที่มีกำหนดเสร็จให้เทียบ"}</span></div>
      <div class="nd-tile"><span class="nd-label">ตรวจรับไม่ผ่าน</span><span class="nd-value">${fmtPercent(period.verifyFailRate)}</span>
        <span class="nd-note">${period.verified ? `${fmtNumber(period.verifyFailed)} จาก ${fmtNumber(period.verified)} ใบที่ถูกตรวจรับ` : "ยังไม่มีใบที่ถูกตรวจรับ"}</span>
        <details class="nd-more"><summary>ดูรายละเอียด</summary>${list(quality)}</details></div>`;
  }

  function stageHtml(stages, filters) {
    const shown = stages.filter((stage) => stage.key !== "approved" || stage.count > 0);
    const max = Math.max(...shown.map((stage) => stage.count), 0);
    const total = shown.reduce((sum, stage) => sum + stage.count, 0);
    const resolve = (key) => {
        const stage = stages.find((entry) => entry.key === key);
        return stage && { title: stage.label, lines: [["ใบที่ค้างในขั้นนี้", fmtCount(stage.count)], ["ต้องรอใครดำเนินการ", stage.owner], ["ค้างเฉลี่ย", fmtDays(stage.avgDays)], ["ค้างนานสุด", stage.maxDays === null ? "—" : `${fmtNumber(stage.maxDays)} วัน`], ["เลยกำหนดเสร็จ", fmtCount(stage.overdue)], ["ด่วน", fmtCount(stage.urgent)]], href: filters.stage === key ? null : hrefWith(filters, { scope: "", stage: key }) };
    };
    const rows = shown.map((stage) => {
      const width = stage.count ? Math.max((stage.count / max) * 100, 0.8) : 0;
      const inner = `<span class="nd-lab">${esc(stage.label)}<br><span class="nd-muted">${esc(stage.owner)}</span></span><span class="nd-trk"><span class="nd-bar${stage.count === max ? "" : " rest"}" style="width:${width}%"></span></span><span class="nd-val">${esc(fmtCount(stage.count))}<small>${stage.count ? `เฉลี่ย ${esc(fmtDays(stage.avgDays))}` : "—"}</small></span>`;
      return selectButton("stage", stage.key, inner, `nd-brow${filters.stage === stage.key ? " active" : ""}`) + detailUnder("stage", stage.key, resolve);
    }).join("");
    return `<div class="nd-head"><h2>งานค้างอยู่ที่ใคร</h2><p>นับทุกใบที่ยังไม่จบ ไม่ขึ้นกับช่วงเวลา เรียงตามลำดับ workflow แถบเข้มคือขั้นที่ค้างมากสุด ตัวเลขเฉลี่ยคือจำนวนวันที่ใบอยู่ในขั้นนั้นมาแล้ว</p></div>
      ${total ? `<div class="nd-bars">${rows}</div>
      <div class="nd-legend"><span><i class="strong"></i>ขั้นที่ค้างมากสุด</span><span><i class="soft"></i>ขั้นอื่น</span></div>` : `<p class="nd-empty">ไม่มีงานค้างในตัวกรองนี้</p>`}
      ${detailHintIfIdle("stage", "แถบขั้นตอน", resolve)}`;
  }

  function actHtml(open, today) {
    const top = model.priority(open, 10);
    const dueCell = (row) => {
      if (!row.work_expected_date) return `<span class="nd-muted">ยังไม่กำหนด</span>`;
      if (row.overdue) return `${esc(formatDate(row.work_expected_date))}<br><span class="nd-muted">เลยมา ${fmtNumber(row.daysOverdue)} วัน</span>`;
      const left = model.daysBetween(today, row.work_expected_date);
      return `${esc(formatDate(row.work_expected_date))}<br><span class="nd-muted">${left > 0 ? `อีก ${fmtNumber(left)} วัน` : left === 0 ? "ครบกำหนดวันนี้" : ""}</span>`;
    };
    return `<div class="nd-head"><h2>ต้องลงมือตอนนี้</h2><p>ใบที่ยังไม่จบ เรียงจากเลยกำหนดเสร็จก่อน แล้วด่วน แล้วตามจำนวนวันที่ค้างในขั้นปัจจุบัน</p></div>
      ${top.length ? `<div class="table-wrap"><table><thead><tr><th>ใบ / เครื่องจักร</th><th>รอใคร</th><th class="nd-num">ค้างมา</th><th>กำหนดเสร็จ</th></tr></thead><tbody>${top.map((row) => {
        const stage = model.STAGE_BY_KEY[row.stage];
        return `<tr><td><a class="request-no" href="#/request?id=${encodeURIComponent(row.id)}">${esc(row.request_no)}</a>${row.isUrgent ? ` <span class="badge urgent-flag">ด่วน</span>` : ""}${row.overdue ? ` <span class="nd-pill crit"><span class="nd-ico" aria-hidden="true">▲</span>เลย ${fmtNumber(row.daysOverdue)} วัน</span>` : ""}<br><span class="nd-muted">${esc(machineText(row))} · ${esc(row.dept || "—")}</span></td><td>${esc(actionOwner(row))}<br><span class="nd-muted">${esc(stage?.short ?? "")}</span></td><td class="nd-num">${fmtNumber(row.daysInStatus)} วัน</td><td>${dueCell(row)}</td></tr>`;
      }).join("")}</tbody></table></div>
      ${open.length > top.length ? `<div><a class="btn secondary" href="${hrefWith(lastFilters, { scope: "open", stage: "" })}">ดูงานค้างทั้งหมด ${fmtCount(open.length)}</a></div>` : ""}` : `<p class="nd-empty">ไม่มีงานค้างในตัวกรองนี้</p>`}`;
  }

  function phaseHtml(phases) {
    const known = phases.filter((phase) => phase.n > 0);
    const max = known.length ? Math.max(...known.map((phase) => phase.avgDays)) : 0;
    const rows = phases.map((phase) => {
      const width = phase.n && max ? Math.max((phase.avgDays / max) * 100, 0.8) : 0;
      return `<div class="nd-brow static"><span class="nd-lab">${esc(phase.label)}<br><span class="nd-muted">${esc(phase.owner)}</span></span><span class="nd-trk"><span class="nd-bar${phase.n && phase.avgDays === max ? "" : " rest"}" style="width:${width}%"></span></span><span class="nd-val">${phase.n ? esc(fmtDays(phase.avgDays)) : "—"}<small>${phase.n ? `กลาง ${esc(fmtDays(phase.medianDays))} · ${esc(fmtCount(phase.n))}` : "ยังไม่มีข้อมูล"}</small></span></div>`;
    }).join("");
    return `<div class="nd-head"><h2>เวลาที่ใช้แต่ละช่วง</h2><p>เวลาเฉลี่ยจากประวัติสถานะของใบที่แจ้งในช่วงที่เลือก นับเฉพาะช่วงที่เดินครบแล้ว แถบเข้มคือช่วงที่ใช้เวลานานสุด</p></div>
      <div class="nd-bars">${rows}</div>
      <p class="nd-hint">ตรวจรับไม่ผ่านแล้วซ่อมใหม่ นับเป็นเวลาซ่อม ส่วนช่วง "อนุมัติ" รวมเวลาที่รอผู้แจ้งตอบข้อมูลเพิ่มด้วย</p>`;
  }

  function machineHtml(ranking, filters) {
    const { items } = ranking;
    const max = items.length ? Math.max(...items.map((item) => item.count)) : 0;
    const resolve = (key) => {
        const item = items.find((entry) => entry.key === key);
        return item && { title: `${item.code}${item.name ? ` — ${item.name}` : ""}`, lines: [["แผนกที่แจ้ง", item.dept || "—"], ["แจ้งซ่อมในช่วงนี้", `${fmtNumber(item.count)} ครั้ง`], ["สัดส่วนของใบที่ระบุเครื่อง", fmtPercent(item.share)], ["ยังไม่จบ", fmtCount(item.open)], ["เลยกำหนดเสร็จ", fmtCount(item.overdue)], ["แจ้งล่าสุด", formatDate(item.lastOn)], ["ปิดงานเฉลี่ย (เฉพาะที่ปิดแล้ว)", fmtDays(item.avgCycle)]], href: filters.machine === key ? null : hrefWith(filters, { scope: "", stage: "", machine: key }), linkLabel: "ดูเฉพาะใบของเครื่องนี้" };
    };
    const rows = items.map((item) => {
      const inner = `<span class="nd-lab">${esc(item.code)}${item.name ? ` — ${esc(item.name)}` : ""}<br><span class="nd-muted">แผนก ${esc(item.dept || "—")}</span></span><span class="nd-trk"><span class="nd-bar${item.count === max ? "" : " rest"}" style="width:${Math.max((item.count / max) * 100, 0.8)}%"></span></span><span class="nd-val">${esc(fmtNumber(item.count))} ครั้ง<small>ยังไม่จบ ${esc(fmtNumber(item.open))} · ล่าสุด ${esc(formatDate(item.lastOn))}</small></span>`;
      return selectButton("machine", item.key, inner, `nd-brow${filters.machine === item.key ? " active" : ""}`) + detailUnder("machine", item.key, resolve);
    }).join("");
    const notes = [
      ranking.requestDocs ? `ไม่นับใบคำร้อง ${fmtCount(ranking.requestDocs)}` : "",
      ranking.unspecified ? `ไม่นับใบที่ไม่ระบุเครื่อง (เลือก "ไม่มี"/"สร้างใหม่") ${fmtCount(ranking.unspecified)}` : "",
    ].filter(Boolean).join(" · ");
    return `<div class="nd-head"><h2>เครื่องจักรที่เสียบ่อย</h2><p>จำนวนครั้งที่แจ้งซ่อมต่อเครื่องในช่วงที่เลือก (ใบแจ้งซ่อมที่ไม่ถูกปฏิเสธ) เครื่องเดียวกันนับรวมกันแม้พิมพ์รหัสต่างกันเล็กน้อย แตะแถบเพื่อดูตัวเลขและกรองรายการด้านล่าง</p></div>
      ${items.length ? `<div class="nd-bars">${rows}</div>
      <div class="nd-legend"><span><i class="strong"></i>เครื่องที่แจ้งบ่อยสุด</span><span><i class="soft"></i>เครื่องอื่น</span></div>
      <p class="nd-hint">แสดง ${fmtNumber(items.length)} จาก ${fmtNumber(ranking.machines)} เครื่อง รวม ${fmtCount(ranking.total)}${notes ? ` · ${esc(notes)}` : ""}</p>` : `<p class="nd-empty">ไม่มีใบแจ้งซ่อมที่ระบุเครื่องจักรในช่วงและตัวกรองนี้${notes ? ` (${esc(notes)})` : ""}</p>`}
      ${detailHintIfIdle("machine", "แถบเครื่องจักร", resolve)}`;
  }

  function deptRankHtml(ranking, filters) {
    const { items, total } = ranking;
    const resolve = (key) => {
        const item = items.find((entry) => entry.dept === key);
        return item && { title: item.dept ? `แผนก ${item.dept}` : "ไม่ระบุแผนก", lines: [["แจ้งซ่อมในช่วงนี้", fmtCount(item.count)], ["สัดส่วนของใบแจ้งซ่อมทั้งหมด", fmtPercent(item.share)], ["ยังไม่จบ", fmtCount(item.open)], ["ด่วน", fmtCount(item.urgent)], ["ปิดงานเฉลี่ย (เฉพาะที่ปิดแล้ว)", fmtDays(item.avgCycle)]], href: item.dept && filters.dept !== key ? hrefWith(filters, { scope: "", stage: "", dept: key }) : null, linkLabel: "ดูเฉพาะแผนกนี้" };
    };
    const detailRow = (key) => { const detail = detailUnder("deptrank", key, resolve); return detail ? `<tr class="nd-detail-row"><td colspan="6">${detail}</td></tr>` : ""; };
    return `<div class="nd-head"><h2>แผนกที่แจ้งซ่อมบ่อย</h2><p>จำนวนใบแจ้งซ่อมต่อแผนกที่แจ้งในช่วงที่เลือก (ไม่นับใบคำร้องและใบที่ไม่อนุมัติ) ตารางนี้ไม่ถูกย่อด้วยตัวกรองแผนก แผนกที่เลือกอยู่จะถูกเน้น</p></div>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>แผนก</th><th class="nd-num">ใบแจ้งซ่อม</th><th class="nd-num">สัดส่วน</th><th class="nd-num">ยังไม่จบ</th><th class="nd-num">ด่วน</th><th class="nd-num">ปิดงานเฉลี่ย</th></tr></thead><tbody>
      ${items.map((item) => `<tr><td>${selectButton("deptrank", item.dept, esc(item.dept || "ไม่ระบุแผนก"), "nd-rowbtn")}${filters.dept === item.dept ? ` <span class="nd-muted">(กรองอยู่)</span>` : ""}</td><td class="nd-num">${esc(fmtNumber(item.count))}</td><td class="nd-num">${esc(fmtPercent(item.share))}</td><td class="nd-num">${esc(fmtNumber(item.open))}</td><td class="nd-num">${esc(fmtNumber(item.urgent))}</td><td class="nd-num">${esc(fmtDays(item.avgCycle))}</td></tr>${detailRow(item.dept)}`).join("")}
      <tr class="nd-total"><td>รวม</td><td class="nd-num">${esc(fmtNumber(total))}</td><td class="nd-num">100%</td><td class="nd-num">${esc(fmtNumber(items.reduce((sum, item) => sum + item.open, 0)))}</td><td class="nd-num">${esc(fmtNumber(items.reduce((sum, item) => sum + item.urgent, 0)))}</td><td class="nd-num"></td></tr></tbody></table></div>` : `<p class="nd-empty">ไม่มีใบแจ้งซ่อมในช่วงที่เลือก</p>`}
      ${detailHintIfIdle("deptrank", "ชื่อแผนก", resolve)}`;
  }

  function techHtml(ranking, filters) {
    const { items } = ranking;
    const max = items.length ? Math.max(...items.map((item) => item.hours)) : 0;
    const resolve = (key) => {
        const item = items.find((entry) => entry.id === key);
        return item && { title: techName(item.id), lines: [["ใบที่ได้รับมอบหมายในช่วงนี้", fmtCount(item.jobs)], ["เวลากำลังซ่อมรวม", `${fmtHours(item.hours)} (${fmtDays(item.hours / 24)})`], ["เฉลี่ยต่อใบ (เฉพาะใบที่เริ่มซ่อมแล้ว)", fmtHours(item.avgHours)], ["กำลังซ่อมอยู่ (ในช่วงนี้)", fmtCount(item.running)], ["ถืออยู่ตอนนี้ (ทุกช่วงเวลา)", fmtCount(item.holding)], ["ในนั้นเลยกำหนดเสร็จ", fmtCount(item.overdue)]], href: filters.tech === key ? null : hrefWith(filters, { scope: "", stage: "", tech: key }), linkLabel: "ดูเฉพาะใบของช่างคนนี้" };
    };
    const rows = items.map((item) => {
      const width = item.hours && max ? Math.max((item.hours / max) * 100, 0.8) : 0;
      const inner = `<span class="nd-lab">${esc(techName(item.id))}<br><span class="nd-muted">${esc(fmtCount(item.jobs))}ในช่วงนี้${item.holding ? ` · ถืออยู่ ${esc(fmtCount(item.holding))}` : ""}</span></span><span class="nd-trk"><span class="nd-bar${item.hours && item.hours === max ? "" : " rest"}" style="width:${width}%"></span></span><span class="nd-val">${esc(fmtHours(item.hours))}<small>เฉลี่ย ${esc(fmtHours(item.avgHours))}/ใบ</small></span>`;
      return selectButton("tech", item.id, inner, `nd-brow${filters.tech === item.id ? " active" : ""}`) + detailUnder("tech", item.id, resolve);
    }).join("");
    return `<div class="nd-head"><h2>ช่างที่ใช้เวลาซ่อมมากสุด</h2><p>เรียงตามเวลาที่ใบของช่างอยู่ในสถานะ "กำลังซ่อม" รวมทุกรอบของใบที่แจ้งในช่วงที่เลือก แตะแถบเพื่อดูตัวเลขและกรองรายการด้านล่าง</p></div>
      <p class="nd-warn">ตัวเลขนี้ <b>ไม่ใช่ชั่วโมงทำงานจริง</b> เพราะระบบยังไม่มีช่องบันทึกชั่วโมงทำงาน แต่เป็นเวลาตามนาฬิกา (รวมกลางคืนและวันหยุด) ตั้งแต่ช่างกดเริ่มงานจนส่งตรวจรับ ใบที่มีช่างหลายคนนับเต็มเวลาให้ทุกคน และรู้เฉพาะรายชื่อช่างปัจจุบันของใบ ใช้เทียบภาระงานคร่าวๆ ไม่ใช้คิดค่าแรง</p>
      ${items.length ? `<div class="nd-bars">${rows}</div>
      <div class="nd-legend"><span><i class="strong"></i>ช่างที่เวลารวมมากสุด</span><span><i class="soft"></i>ช่างอื่น</span></div>
      <p class="nd-hint">"ถืออยู่" = ใบที่ช่างต้องทำตอนนี้ (รอเริ่มงานหรือกำลังซ่อม) นับทุกใบไม่ขึ้นกับช่วงเวลา ส่วนเวลาและจำนวนใบนับตามวันที่แจ้ง ไม่นับใบที่ไม่อนุมัติ</p>` : `<p class="nd-empty">ยังไม่มีใบที่มอบหมายช่างในช่วงและตัวกรองนี้</p>`}
      ${detailHintIfIdle("tech", "แถบชื่อช่าง", resolve)}`;
  }

  function machineText(row) {
    return [row.machine_code, row.machine_name].filter(Boolean).join(" — ") || "ไม่ระบุเครื่องจักร";
  }

  function drillHtml(list, basis, filters) {
    const sorted = [...list].sort((a, b) => (a.submittedOn < b.submittedOn ? 1 : a.submittedOn > b.submittedOn ? -1 : b.request_no.localeCompare(a.request_no)));
    const shown = sorted.slice(0, drillLimit);
    const heading = basis === "backlog"
      ? { title: "รายการงานค้างตามตัวกรอง", note: `ทั้งหมด <b>${fmtNumber(list.length)}</b> ใบ นับทุกใบที่ยังไม่จบ ไม่จำกัดช่วงเวลา แตะเลขที่เพื่อเปิดใบ` }
      : { title: "รายการใบที่ประกอบเป็นตัวเลขด้านบน", note: `ทั้งหมด <b>${fmtNumber(list.length)}</b> ใบ ตรงกับจำนวนใน "ใบที่แจ้งในช่วงนี้" แตะเลขที่เพื่อเปิดใบ` };
    const statusCell = (row) => {
      const badge = row.isOpen ? `<span class="badge ${esc(row.status)}">${esc(model.STAGE_BY_KEY[row.stage]?.short ?? row.status)}</span>` : statusBadge(row.status);
      const status = row.overdue ? `${badge} <span class="nd-pill crit"><span class="nd-ico" aria-hidden="true">▲</span>เลยกำหนด</span>` : badge;
      if (row.stage !== "start" && row.stage !== "repair") return status;
      const names = row.technicianIds.map(techName).join(", ") || "ไม่พบข้อมูลช่างที่รับผิดชอบ";
      return `${status}<br><span class="nd-muted">ช่างผู้รับผิดชอบ: ${esc(names)}</span>`;
    };
    const timeCell = (row) => (row.isCompleted ? fmtDays(row.cycleDays) : row.isOpen ? `ค้าง ${fmtNumber(row.daysInStatus)} วัน` : "—");
    // ปุ่มยกเลิกการกรองอยู่มุมขวาบนของรายการที่กรองแล้ว (ล้างตัวกรองที่กำหนดรายการนี้ทั้งหมด) กดแล้ววนกลับไปจุดที่กดกรองมา
    const cancel = hasDrillFilter(filters)
      ? `<a class="btn secondary small nd-cancel" data-cancel href="${hrefWith(filters, { scope: "", stage: "", machine: "", tech: "", dept: "" })}">ยกเลิกการกรอง</a>`
      : "";
    return `<div class="nd-head nd-head-row"><div><h2>${heading.title}</h2><p>${heading.note}</p></div>${cancel}</div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>วันที่แจ้ง</th><th>เครื่องจักร / แผนก</th><th>สถานะ</th><th class="nd-num">เวลา</th></tr></thead><tbody>
      ${shown.map((row) => `<tr><td><a class="request-no" href="#/request?id=${encodeURIComponent(row.id)}">${esc(row.request_no)}</a>${row.isUrgent ? ` <span class="badge urgent-flag">ด่วน</span>` : ""}</td><td class="nd-nowrap">${esc(row.submittedOn)}</td><td>${esc(machineText(row))}<br><span class="nd-muted">${esc(row.dept || "—")} · ${esc(DOC_LABELS[row.doc_type] ?? "—")}${row.requester_name ? ` · ${esc(row.requester_name)}` : ""}</span></td><td>${statusCell(row)}</td><td class="nd-num">${timeCell(row)}</td></tr>`).join("")}</tbody></table></div>
      ${list.length > drillLimit ? `<div><button type="button" class="btn secondary" data-more>แสดงเพิ่ม (เหลือ ${fmtNumber(list.length - drillLimit)} ใบ)</button></div>` : ""}` : `<p class="nd-empty">ไม่มีใบตรงกับตัวกรองนี้</p>`}`;
  }

  const definitionsHtml = `<details class="nd-defs"><summary>นิยามที่ใช้ในหน้านี้</summary><div><ol>
    <li><b>สองฐานข้อมูล:</b> งานค้าง เลยกำหนด ด่วน และตาราง "งานค้างอยู่ที่ใคร" นับทุกใบที่ยังไม่จบ ไม่ขึ้นกับช่วงเวลา ส่วนใบที่แจ้ง ปิดงาน เวลาเฉลี่ย ปิดทันกำหนด และตรวจรับ นับจากใบที่แจ้งในช่วงที่เลือก</li>
    <li><b>ยังไม่จบ:</b> ตรงกับ "ยังไม่จบ N รายการ" ที่หัวโมดูล ได้แก่ รออนุมัติ ขอข้อมูลเพิ่ม รอมอบหมายช่าง รอช่างเริ่มงาน กำลังซ่อม และรอตรวจรับ ไม่นับฉบับร่างและใบที่ยกเลิก</li>
    <li><b>เลยกำหนดเสร็จ:</b> เฉพาะใบที่อยู่ในมือช่าง (รอเริ่มงาน/กำลังซ่อม) และเลยวันที่คาดว่าจะเสร็จล่าสุด ใบที่รอผู้อนุมัติหรือผู้แจ้งไม่นับ เพราะช่างทำอะไรไม่ได้</li>
    <li><b>ปิดทันกำหนด:</b> ปิดงานภายในวันที่คาดว่าจะเสร็จล่าสุด (ถ้าช่างเลื่อนวัน ใช้วันที่หลังเลื่อน) ใบที่ยังเลยกำหนดอยู่นับว่าไม่ทัน ทัน % = ทัน ÷ (ปิดแล้วที่มีกำหนดเสร็จ + ใบที่ยังเลยกำหนด)</li>
    <li><b>เวลาแจ้ง → ปิดงาน และเวลาแต่ละช่วง:</b> นับเฉพาะใบที่ปิดงานแล้ว (เวลาแต่ละช่วงนับเมื่อช่วงนั้นเดินครบ) จากประวัติสถานะ ใบที่ไม่อนุมัติไม่นับเวลา</li>
    <li><b>ตรวจรับไม่ผ่าน:</b> ใบที่เคยถูกตรวจรับไม่ผ่านอย่างน้อยหนึ่งครั้ง ÷ ใบที่ถูกตรวจรับแล้วทั้งหมด</li>
    <li><b>เครื่องจักรที่เสียบ่อย / แผนกที่แจ้งซ่อมบ่อย:</b> นับเฉพาะใบแจ้งซ่อมในช่วงที่เลือก ไม่นับใบคำร้อง ใบที่ไม่อนุมัติ และฉบับร่าง เครื่องจักรแยกด้วย แผนกที่แจ้ง + รหัสเครื่อง (รหัสเดียวกันต่างแผนกถือเป็นคนละเครื่อง) ใบที่เลือก "ไม่มี" หรือ "สร้างใหม่" ไม่นับเป็นเครื่อง</li>
    <li><b>เวลาซ่อมของช่าง:</b> ไม่ใช่ชั่วโมงทำงานจริง แต่คือเวลาตามนาฬิกาที่ใบอยู่ในสถานะ "กำลังซ่อม" รวมทุกรอบ (ตรวจรับไม่ผ่านแล้วซ่อมใหม่ก็นับ) ใบที่ยังซ่อมอยู่นับถึงเวลาที่เปิดหน้านี้ ช่างหลายคนในใบเดียวนับเต็มทุกคน และรู้เฉพาะรายชื่อช่างปัจจุบันของใบ ส่วน "ถืออยู่" นับทุกใบที่ช่างต้องทำตอนนี้ ไม่ขึ้นกับช่วงเวลา</li></ol></div></details>`;

  function pageBody() {
    const { rows, today, loadedAt, typeId } = cache;
    const filters = readFilters(lastParams, rows, today);
    lastFilters = filters;
    const periodList = model.select(rows, filters);
    const period = model.summarize(periodList);
    const open = model.backlog(rows, filters);
    const back = model.summarize(open);
    const stages = model.stageSummary(open);
    const phases = model.phaseSummary(periodList);
    const machines = model.machineRanking(rows, filters);
    const depts = model.deptRanking(rows, filters);
    const techs = model.technicianRanking(rows, filters);
    const { list, basis } = model.listFor(rows, filters);
    const backHref = typeId ? window.MNP_REQUEST_CENTER.url(new URLSearchParams(), { type: typeId }) : "#/requests";
    return `<div class="page-heading"><div><div class="eyebrow">MT · ใบคำร้อง/แจ้งซ่อม</div><h1>${TITLE} <span class="badge">เวอร์ชันทดสอบ</span></h1><p>ไม่นับฉบับร่างและใบที่ยกเลิก</p></div>
        <div class="ncr-heading-status"><a class="btn secondary" href="${hrefWith(filters, {})}&refresh=1" title="ดึงข้อมูลล่าสุด">รีเฟรช</a><a class="btn secondary" href="${esc(backHref)}">‹ กลับหน้า MT</a></div></div>
      <div class="nd">
        <p class="nd-warn">กำลังทดลองใช้ มีงานค้าง คอขวด เวลาที่ใช้ คุณภาพการซ่อม เครื่องจักรที่เสียบ่อย แผนกที่แจ้งซ่อมบ่อย และเวลาซ่อมของช่าง หากตัวเลขไม่ตรงกับที่เห็นหน้างาน แจ้งเลขที่ใบที่ไม่ตรงได้เลย</p>
        <div class="nd-controls">${controlsHtml(filters, rows, today, period, back)}</div>
        <div class="nd-summary" role="status">${summaryHtml(back, stages)}</div>
        <div class="nd-tiles five" data-card="tiles">${tilesHtml(filters, period, back)}</div>
        <section class="card nd-card" data-card="stage">${stageHtml(stages, filters)}</section>
        <section class="card nd-card" data-card="act">${actHtml(open, today)}</section>
        <section class="card nd-card" data-card="phase">${phaseHtml(phases)}</section>
        <section class="card nd-card" data-card="machine">${machineHtml(machines, filters)}</section>
        <section class="card nd-card" data-card="deptrank">${deptRankHtml(depts, filters)}</section>
        <section class="card nd-card" data-card="tech">${techHtml(techs, filters)}</section>
        <section class="card nd-card" id="nd-drill">${drillHtml(list, basis, filters)}</section>
        ${definitionsHtml}
        <p class="nd-muted">ข้อมูล ณ ${esc(new Date(loadedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }))} · ตัวเลขนับเฉพาะใบที่บัญชีนี้มีสิทธิ์เห็น</p>
      </div>`;
  }

  // เลื่อนแบบนุ่ม เว้นแต่ผู้ใช้ตั้งลดการเคลื่อนไหว
  const scrollBehavior = () => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

  const anchorSelector = (origin) => (origin.sel ? `[data-sel="${CSS.escape(origin.sel)}"]` : `[data-card="${CSS.escape(origin.card)}"]`);

  function paint() {
    const root = document.getElementById("nd-root");
    if (!root || !cache) return;
    const focusKey = document.activeElement?.dataset?.sel ?? (document.activeElement?.hasAttribute?.("data-more") ? "__more" : null);
    const keepY = restoreScrollY ?? window.scrollY;
    restoreScrollY = null;
    root.innerHTML = pageBody();
    bindPage(root);
    placeDrill(root);
    // วาดใหม่ทั้งก้อน: คืนตำแหน่งเลื่อนเดิมเสมอ หน้าจะได้ไม่กระโดด (ก่อน focus เพราะ focus บังคับ layout)
    window.scrollTo(0, keepY);
    if (anchorFix) {
      const el = root.querySelector(anchorFix.selector);
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - anchorFix.top);
      anchorFix = null;
    }
    if (focusKey) (focusKey === "__more" ? root.querySelector("[data-more]") : root.querySelector(`[data-sel="${CSS.escape(focusKey)}"]`))?.focus({ preventScroll: true });
    if (scrollToDrill) {
      scrollToDrill = false;
      // เลื่อนเฉพาะตอนกรองจริงหรือกดจากการ์ด (เปลี่ยนแค่ช่วงเวลาไม่ต้องกระโดดไปที่รายการ) เลื่อนแบบนุ่ม เว้นแต่ผู้ใช้ตั้งลดการเคลื่อนไหว
      if (drillAnchor || hasDrillFilter(lastFilters)) {
        root.querySelector("#nd-drill")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
      }
    }
  }

  // รายการใบที่กรองแล้วไม่อยู่ท้ายหน้า: วางต่อท้ายส่วนที่ผู้ใช้กดกรองมาทันที — การ์ด (data-card) ที่กดลิงก์ หรือใต้แถบตัวกรองถ้ากดจากช่วงเวลา/ชิป/ฟอร์ม
  // ถ้าเปิดจากลิงก์ที่แชร์ (ไม่รู้ว่ากดจากไหน) วางใต้แถบตัวกรองเมื่อมีตัวกรอง ถ้ายังไม่ได้กรองอะไรอยู่ท้ายหน้าเหมือนเดิม
  function placeDrill(root) {
    const drill = root.querySelector("#nd-drill");
    if (!drill) return;
    const key = drillAnchor ?? (hasDrillFilter(lastFilters) ? "controls" : null);
    if (!key) return; // ยังไม่ได้กรอง: เป็นรายการประกอบตัวเลขทั้งหมด คงไว้ท้ายหน้า ไม่ดันการ์ดอื่นลงไป
    const host = key === "controls" ? root.querySelector(".nd-summary") : root.querySelector(`[data-card="${CSS.escape(key)}"]`);
    (host?.closest(".nd > *") ?? root.querySelector(".nd-summary"))?.after(drill);
  }
  const hasDrillFilter = (filters) => Boolean(filters && (filters.scope || filters.stage || filters.machine || filters.tech || filters.dept));

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
      // ลิงก์กรอง: จำการ์ดต้นทางไว้ แล้วให้ renderDashboard วางรายการใบต่อท้ายการ์ดนั้น (ลิงก์นอกการ์ดวางใต้แถบตัวกรอง)
      const link = event.target.closest("a[href^='#/" + PATH + "?']");
      if (!link) return;
      const params = new URLSearchParams(link.getAttribute("href").split("?")[1]);
      if (link.hasAttribute("data-cancel")) {
        rememberFilterClick(params, null, { cancel: true });
        pullBackThen(root, link.getAttribute("href"), event);
        return;
      }
      const card = link.closest("[data-card]")?.dataset.card ?? null;
      const sel = card && selection ? `${selection.card}:${selection.key}` : null;
      const selector = card ? anchorSelector({ card, sel }) : null;
      const anchorEl = selector ? root.querySelector(selector) : null;
      rememberFilterClick(params, card, { sel, anchor: anchorEl ? { selector, top: anchorEl.getBoundingClientRect().top } : null });
    });
  }

  // ยกเลิกการกรอง: เลื่อนนุ่มๆ กลับไปจุดที่กดกรองมาก่อน (ตารางยังอยู่ ภาพต่อเนื่อง) แล้วค่อยล้างตัวกรองตอนเลื่อนเสร็จ
  // ถ้าไม่รู้จุดเดิม (กรองจากชิป/ฟอร์ม/ลิงก์) หรือผู้ใช้ตั้งลดการเคลื่อนไหว ก็ล้างทันที
  function pullBackThen(root, href, event) {
    const origin = drillOrigin;
    const back = origin && ((origin.sel && root.querySelector(`[data-sel="${CSS.escape(origin.sel)}"]`)) || root.querySelector(`[data-card="${CSS.escape(origin.card)}"]`));
    if (!back || scrollBehavior() !== "smooth") return;
    event.preventDefault();
    back.scrollIntoView({ block: origin.sel ? "center" : "start", behavior: "smooth" });
    let lastY = -1;
    let stable = 0;
    const startedAt = performance.now();
    const wait = () => {
      stable = Math.round(window.scrollY) === lastY ? stable + 1 : 0;
      lastY = Math.round(window.scrollY);
      if (stable >= 6 || performance.now() - startedAt > 1500) {
        if (pendingDrill) Object.assign(pendingDrill, { scrollY: window.scrollY, anchor: { selector: anchorSelector(origin), top: back.getBoundingClientRect().top } }); // วาดหน้าใหม่แล้วจุดต้นทางต้องอยู่ที่เดิมบนจอ
        location.hash = href.slice(1);
        return;
      }
      requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  }

  function rememberFilterClick(params, card, extra = {}) {
    pendingDrill = params.get("refresh") ? null : { params, card, scrollY: window.scrollY, ...extra };
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
    drillOrigin = fromClick?.card ? { card: fromClick.card, sel: fromClick.sel ?? null } : null;
    scrollToDrill = Boolean(fromClick) && !fromClick.cancel;
    restoreScrollY = fromClick ? fromClick.scrollY : null;
    anchorFix = fromClick?.anchor ?? null;
    const refresh = Boolean(params.get("refresh"));
    const fresh = !cache || cache.employeeId !== state.employee?.id || Date.now() - cache.loadedAt >= CACHE_MS || refresh;
    if (fresh) loadingShell(PATH, TITLE);
    await loadData(refresh);
    app.innerHTML = shell(`<div id="nd-root"></div>`, PATH, TITLE);
    bindShell();
    bindRoot(document.getElementById("nd-root"));
    paint();
  }

  mtModule.headerLinks = [...(mtModule.headerLinks ?? []), { href: `#/${PATH}`, label: "แดชบอร์ด MT", icon: ICON }];
  mtModule.pages = { ...(mtModule.pages ?? {}), [PATH]: renderDashboard };
})();
