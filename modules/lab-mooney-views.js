// ส่วนแสดงผลของโมดูล MNP LAB — สร้างเป็นข้อความ HTML ล้วนจากข้อมูลที่ model แปลงแล้ว ไม่มี DOM/Supabase เทสต์ที่ scripts/tests/lab-mooney-views.test.mjs
//
// module-lab.js เรียกที่นี่เพื่อได้ HTML ของหน้ารวมและหน้าวัสดุ แล้วเป็นผู้ผูกเหตุการณ์ รีเฟรช และจัดการสิทธิ์เอง
// ข้อความจากชีต (ชื่อวัสดุ ID) ถูก escape ทุกจุดก่อนใส่ใน HTML และ URL ของวัสดุผ่าน model.materialUrl เท่านั้น
// ค่า AVG/SD ที่ merge ในชีตแสดงตามชีต ไม่คำนวณใหม่ (ค่าสรุปของกราฟ เช่น เฉลี่ยทั้งหมด คำนวณจากทุกครั้งที่ทดสอบและระบุไว้ชัดเจน)
(function (root) {
  const model = root.MNP_LAB_MOONEY;
  const chart = root.MNP_LAB_CHART;
  if (!model || !chart) return;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const int = (value) => Number(value).toLocaleString("th-TH");
  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

  const TAGS = Object.freeze({ latest: "ล่าสุด", preview: "กำลังดู", pinned: "เลือกไว้" });
  const KEY_ICON = (series) => `<i class="lab-key lab-key-${series}" aria-hidden="true"></i>`;

  /* ---------- ส่วนที่ใช้ร่วมกัน ---------- */

  const REFRESH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>`;

  // เวลาอ่านชีตล่าสุด ปุ่มรีเฟรช และข้อความสถานะ — ใช้ร่วมกันทั้งสองหน้า (บนมือถือซ่อนหมายเหตุและชื่อปุ่ม เหลือไอคอน)
  function liveBar(seconds = 30) {
    return `<div class="lab-live">
      <span class="lab-live-text" id="lab-updated">กำลังอ่านชีต…</span>
      <span class="lab-live-note">รีเฟรชอัตโนมัติทุก ${esc(seconds)} วินาที</span>
      <button class="btn secondary small lab-refresh" type="button" id="lab-refresh" aria-label="รีเฟรชตอนนี้">${REFRESH_ICON}<span class="lab-refresh-text">รีเฟรชตอนนี้</span></button>
      <span class="small lab-status" id="lab-status" role="status"></span>
    </div>`;
  }

  const warningBox = () => `<div class="lab-warning" id="lab-problems" hidden></div>`;

  // กล่องเตือนแถวในชีตที่อ่านไม่ได้ (แถวเหล่านั้นไม่ถูกแสดง)
  function problemsHtml(feed) {
    if (!feed.problemCount) return "";
    const extra = feed.problemCount - feed.problems.length;
    return `<strong>พบ ${int(feed.problemCount)} แถวในชีตที่อ่านไม่ได้ (ไม่แสดงในหน้านี้ — แก้ในชีต)</strong>
      <ul>${feed.problems.map((problem) => `<li>${esc(problem)}</li>`).join("")}</ul>
      ${extra > 0 ? `<span class="small">และอีก ${int(extra)} แถว</span>` : ""}`;
  }

  /* ---------- หน้ารวม: รายการวัสดุ ---------- */

  function overviewPage(seconds) {
    const sortOptions = model.SORT_OPTIONS.map((option) => `<option value="${esc(option.key)}">${esc(option.label)}</option>`).join("");
    return `<div class="lab-page">
      <div class="lab-head">
        <div class="lab-title"><h1>ผลทดสอบ Mooney</h1><p class="lab-sub" id="lab-summary">กำลังอ่านชีต Mooney_Test_Report…</p></div>
        ${liveBar(seconds)}
      </div>
      ${warningBox()}
      <section class="card flush lab-overview-card">
        <div class="lab-toolbar">
          <div class="lab-search"><label class="sr-only" for="lab-search">ค้นหาวัสดุ</label><input class="input" id="lab-search" type="search" enterkeyhint="search" autocomplete="off" maxlength="${model.MAX_MATERIAL_LENGTH}" placeholder="ค้นหาวัสดุ เช่น A1802"></div>
          <div class="lab-sort"><label class="sr-only" for="lab-sort">เรียงตาม</label><select class="select" id="lab-sort">${sortOptions}</select></div>
          <span class="muted small lab-count" id="lab-count" aria-live="polite"></span>
        </div>
        <div class="table-wrap"><table class="lab-overview"><caption class="sr-only">วัสดุที่ทดสอบ Mooney พร้อมผลชุดล่าสุด</caption>
          <thead><tr><th scope="col">วัสดุ</th><th scope="col">ทดสอบล่าสุด</th><th scope="col">${KEY_ICON("mh")}MH ชุดล่าสุด</th><th scope="col">${KEY_ICON("mv")}MV ชุดล่าสุด</th></tr></thead>
          <tbody id="lab-materials"></tbody></table></div>
        <div class="empty" id="lab-empty" hidden></div>
        <p class="lab-foot">MH / MV = ค่าเฉลี่ยของชุดทดสอบล่าสุดตามชีต · ± = SD · Δ = เทียบกับชุดก่อนหน้า · เส้นเล็ก = แนวโน้มค่าเฉลี่ยรายชุด</p>
      </section>
    </div>`;
  }

  // ภาพรวมในบรรทัดเดียวใต้หัวเรื่อง (แทนการ์ดตัวเลขใหญ่): จำนวนวัสดุ จำนวนผล และวันที่ทดสอบล่าสุด
  function overviewSummaryText(summary) {
    if (!summary.materialCount) return "ยังไม่มีข้อมูลผลทดสอบในชีต Mooney_Test_Report";
    return `${int(summary.materialCount)} วัสดุ · ${int(summary.resultCount)} ผลทดสอบ · ทดสอบล่าสุด ${model.formatDate(summary.lastTested)}`;
  }

  function metricCell(label, key, measure, trend) {
    if (!measure || !isNumber(measure.value)) return `<td class="lab-metric" data-label="${esc(label)}"><span class="lab-none">—</span></td>`;
    const spread = measure.basis === "reading"
      ? `<span class="lab-sd" title="ชุดล่าสุดยังไม่มีค่า AVG ในชีต จึงแสดงค่าที่อ่านได้ของแถวล่าสุด">ค่าเดี่ยว</span>`
      : isNumber(measure.sd) ? `<span class="lab-sd">± ${esc(model.formatReading(measure.sd))}</span>` : "";
    const delta = isNumber(measure.delta) ? `<span class="lab-delta">Δ ${esc(model.formatSigned(measure.delta))}</span>` : "";
    return `<td class="lab-metric" data-label="${esc(label)}"><div class="lab-metric-main">
        <div class="lab-metric-text"><span class="lab-metric-line"><strong>${esc(model.formatReading(measure.value))}</strong>${spread}</span>${delta}</div>
        ${chart.sparkline(trend, { key })}</div></td>`;
  }

  function materialRows(materials, today) {
    return materials.map((item) => {
      const age = model.formatAge(item.lastTested, today);
      const meta = `${int(item.resultCount)} ผล · ${int(item.groupCount)} ชุด · ${int(item.testDays)} วัน`;
      return `<tr class="lab-material-row" data-href="${esc(model.materialUrl(item.material))}">
        <th scope="row" class="lab-name"><a href="${esc(model.materialUrl(item.material))}">${esc(item.material)}</a><span class="lab-meta">${esc(meta)}</span></th>
        <td class="lab-when" data-label="ทดสอบล่าสุด"><strong>${esc(model.formatDate(item.lastTested))}</strong>${age ? `<span class="lab-age">${esc(age)}</span>` : ""}</td>
        ${metricCell("MH", "mh", item.latest?.mh, item.trendMh)}
        ${metricCell("MV", "mv", item.latest?.mv, item.trendMv)}
      </tr>`;
    }).join("");
  }

  /* ---------- หน้าวัสดุ ---------- */

  const ORDER_OPTIONS = Object.freeze([
    { key: "newest", label: "ใหม่สุดก่อน" },
    { key: "oldest", label: "เก่าสุดก่อน" },
  ]);

  function materialPage(material, seconds) {
    const orders = ORDER_OPTIONS.map((option) => `<option value="${esc(option.key)}">${esc(option.label)}</option>`).join("");
    return `<div class="lab-page">
      <a class="lab-back" href="#/lab">← วัสดุทั้งหมด</a>
      <div class="lab-head">
        <div class="lab-title"><h1>${esc(material)}</h1><p class="lab-sub" id="lab-summary">กำลังอ่านชีต…</p></div>
        ${liveBar(seconds)}
      </div>
      ${warningBox()}
      <section class="card" id="lab-none" hidden><div class="empty">ไม่พบผลทดสอบของวัสดุ “${esc(material)}”</div></section>
      <div id="lab-body">
        <div class="lab-filters" role="group" aria-label="ตัวกรองผลทดสอบ">
          <label class="lab-field"><span>วัสดุ</span><select class="select" id="lab-material-select"></select></label>
          <label class="lab-field"><span>ID</span><select class="select" id="lab-id-select"></select></label>
        </div>
        <section class="card lab-chart-card" aria-labelledby="lab-chart-title">
          <div class="lab-card-head"><h2 id="lab-chart-title">แนวโน้ม MH / MV</h2><span class="lab-hint">ชี้ แตะ หรือกด ← → ที่กราฟเพื่อดูค่า</span></div>
          <div class="lab-readout" id="lab-readout"></div>
          <div class="lab-plot" id="lab-plot" tabindex="0" role="group" aria-label="กราฟ MH และ MV ใช้ปุ่มลูกศรซ้ายขวาเพื่อเลื่อนดูทีละครั้ง"></div>
          <p class="lab-chart-key" id="lab-chart-key"></p>
          <p class="sr-only" id="lab-announce" role="status" aria-live="polite"></p>
        </section>
        <section class="card flush lab-results-card" aria-labelledby="lab-table-title">
          <div class="card-heading"><h2 id="lab-table-title">ผลทดสอบ</h2><div class="lab-card-actions"><label class="lab-order"><span class="sr-only">เรียงตาราง</span><select class="select" id="lab-order-select">${orders}</select></label><button class="btn secondary small" type="button" id="lab-copy">คัดลอกตาราง</button></div></div>
          <p class="lab-table-note" id="lab-table-note"></p>
          <div class="lab-table-scroll" id="lab-table-scroll" tabindex="0" role="region" aria-labelledby="lab-table-title"></div>
        </section>
      </div>
    </div>`;
  }

  const materialOptions = (summaries, selected) => summaries
    .slice()
    .sort((a, b) => a.material.localeCompare(b.material, "en", { numeric: true, sensitivity: "base" }))
    .map((item) => `<option value="${esc(item.material)}"${item.material === selected ? " selected" : ""}>${esc(item.material)} (${int(item.resultCount)})</option>`)
    .join("");

  const idOptions = (ids, selected, total) => `<option value="">ทุก ID (${int(total)})</option>`
    + ids.map((entry) => `<option value="${esc(entry.id)}"${entry.id === selected ? " selected" : ""}>${esc(entry.id)} (${int(entry.count)})</option>`).join("");

  function conditionsText(conditions) {
    if (!conditions.uniform) return "";
    const parts = [];
    if (conditions.temperatures.length) parts.push(`${model.formatPlain(conditions.temperatures[0])} °C`);
    if (conditions.minutes.length) parts.push(`${model.formatPlain(conditions.minutes[0])} นาที`);
    return parts.join(" / ");
  }

  function materialSummaryText(series, conditions) {
    const { items, groups } = series;
    const dates = items.map((item) => item.testDate).sort();
    const days = new Set(dates).size;
    const span = dates[0] === dates[dates.length - 1] ? model.formatDate(dates[0]) : `${model.formatDate(dates[0])} – ${model.formatDate(dates[dates.length - 1])}`;
    const settings = conditionsText(conditions);
    return [`${int(items.length)} ผลทดสอบ`, `${int(groups.length)} ชุด`, `${int(days)} วัน (${span})`, settings ? `ทดสอบที่ ${settings}` : ""].filter(Boolean).join(" · ");
  }

  /* ---------- ตารางผลทดสอบ ---------- */

  const reading = (value) => model.formatReading(value);

  // คอลัมน์ของตารางผล: ใช้ตัวเดียวกันทั้งวาดตารางและสร้างข้อความสำหรับคัดลอก (varying = แสดงเมื่อเงื่อนไขทดสอบไม่เท่ากันทุกแถว)
  const RESULT_COLUMNS = Object.freeze([
    { key: "seq", label: "#", sticky: 1, text: (item) => String(item.seq) },
    { key: "id", label: "ID", sticky: 2, text: (item) => item.sampleId },
    { key: "date", label: "วันที่", text: (item) => model.formatDate(item.testDate) },
    { key: "time", label: "เวลา", text: (item) => model.formatTime(item.testTime) },
    { key: "temp", label: "อุณหภูมิ (°C)", varying: true, num: true, text: (item) => model.formatPlain(item.temperature) },
    { key: "minutes", label: "เวลาทดสอบ (นาที)", varying: true, num: true, text: (item) => model.formatPlain(item.testMinutes) },
    { key: "mh", label: "MH", mark: "mh", num: true, text: (item) => reading(item.mh) },
    { key: "mv", label: "MV", mark: "mv", num: true, text: (item) => reading(item.mv) },
    { key: "avgMh", label: "AVG MH", group: true, tone: "avg", text: (item) => reading(item.avgMh) },
    { key: "sdMh", label: "SD MH", group: true, tone: "sd", text: (item) => reading(item.sdMh) },
    { key: "avgMv", label: "AVG MV", group: true, tone: "avg", text: (item) => reading(item.avgMv) },
    { key: "sdMv", label: "SD MV", group: true, tone: "sd", text: (item) => reading(item.sdMv) },
  ]);

  const ID_COLUMNS = Object.freeze([
    { key: "order", label: "ครั้งที่", sticky: 1, text: (item) => String(item.order) },
    { key: "date", label: "วันที่", text: (item) => model.formatDate(item.testDate) },
    { key: "time", label: "เวลา", text: (item) => model.formatTime(item.testTime) },
    { key: "temp", label: "อุณหภูมิ (°C)", varying: true, num: true, text: (item) => model.formatPlain(item.temperature) },
    { key: "minutes", label: "เวลาทดสอบ (นาที)", varying: true, num: true, text: (item) => model.formatPlain(item.testMinutes) },
    { key: "mh", label: "MH", mark: "mh", num: true, text: (item) => reading(item.mh) },
    { key: "mv", label: "MV", mark: "mv", num: true, text: (item) => reading(item.mv) },
    { key: "deltaMh", label: "Δ MH", tone: "sd", num: true, text: (item) => model.formatSigned(item.deltaMh) },
    { key: "deltaMv", label: "Δ MV", tone: "sd", num: true, text: (item) => model.formatSigned(item.deltaMv) },
  ]);

  const visibleColumns = (columns, uniform) => columns.filter((column) => !column.varying || !uniform);
  const ordered = (items, order) => (order === "oldest" ? items.slice() : items.slice().reverse());

  function headCell(column) {
    const classes = ["lab-th", column.num || column.group ? "num" : "", column.group ? "is-group" : "", column.sticky ? `sticky sticky-${column.sticky}` : "", column.key === "time" ? "lab-col-time" : ""].filter(Boolean).join(" ");
    return `<th scope="col" class="${classes}">${column.mark ? KEY_ICON(column.mark) : ""}${esc(column.label)}</th>`;
  }

  // ตารางผลของวัสดุ: AVG/SD ของชุดทดสอบรวมเซลล์ (rowspan) เหมือนในชีต; ชุดที่ไม่มี AVG/SD แสดง — ต่อแถว
  function resultsTable({ series, order = "newest", uniform = true, activeSeq = null }) {
    const columns = visibleColumns(RESULT_COLUMNS, uniform);
    const rows = ordered(series.items, order);
    let previous = null;
    const body = rows.map((item) => {
      const group = series.groups[item.groupIndex];
      const start = !previous || previous.groupIndex !== item.groupIndex;
      const classes = ["lab-result-row", group.index % 2 === 0 ? "is-band" : "", start ? "is-start" : "", item.seq === activeSeq ? "is-active" : ""].filter(Boolean).join(" ");
      const sameDate = previous && previous.testDate === item.testDate;
      const cells = columns.map((column) => {
        if (column.group) {
          if (!group.hasStats) return `<td class="num stat is-none">—</td>`;
          if (!start) return "";
          return `<td class="num stat stat-${column.tone}" rowspan="${group.count}">${esc(column.text(item))}</td>`;
        }
        const cellClasses = [column.num ? "num" : "", column.mark ? `val val-${column.mark}` : "", column.sticky ? `sticky sticky-${column.sticky}` : "", column.key === "date" && sameDate ? "is-repeat" : "", column.key === "time" ? "lab-col-time" : ""].filter(Boolean).join(" ");
        return column.sticky === 2
          ? `<th scope="row" class="${cellClasses}">${esc(column.text(item))}</th>`
          : `<td class="${cellClasses}">${esc(column.text(item))}</td>`;
      }).join("");
      previous = item;
      return `<tr class="${classes}" data-seq="${item.seq}">${cells}</tr>`;
    }).join("");
    return `<table class="lab-table lab-results"><caption class="sr-only">ผลทดสอบ Mooney ของ ${esc(series.material)}</caption><thead><tr>${columns.map(headCell).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function idTable({ rows, order = "newest", uniform = true, activeSeq = null, id = "" }) {
    const columns = visibleColumns(ID_COLUMNS, uniform);
    const body = ordered(rows, order).map((item) => {
      const cells = columns.map((column) => {
        const cellClasses = [column.num ? "num" : "", column.mark ? `val val-${column.mark}` : "", column.tone ? `stat stat-${column.tone}` : "", column.sticky ? `sticky sticky-${column.sticky}` : "", column.key === "time" ? "lab-col-time" : ""].filter(Boolean).join(" ");
        return column.sticky === 1
          ? `<th scope="row" class="${cellClasses}">${esc(column.text(item))}</th>`
          : `<td class="${cellClasses}">${esc(column.text(item))}</td>`;
      }).join("");
      return `<tr class="lab-result-row${item.seq === activeSeq ? " is-active" : ""}" data-seq="${item.seq}">${cells}</tr>`;
    }).join("");
    return `<table class="lab-table lab-results lab-results-id"><caption class="sr-only">ผลทดสอบ Mooney ของ ID ${esc(id)}</caption><thead><tr>${columns.map(headCell).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  }

  // ข้อความคั่นแท็บสำหรับวางใน Excel: ทุกแถวมี AVG/SD ครบ (ขยายค่าที่ merge ไปทุกแถว เหมือนฟีดจากชีต)
  function resultsTsv({ series, order = "newest", uniform = true }) {
    const columns = visibleColumns(RESULT_COLUMNS, uniform);
    return model.toTsv([columns.map((column) => column.label), ...ordered(series.items, order).map((item) => columns.map((column) => column.text(item)))]);
  }

  function idTsv({ rows, order = "newest", uniform = true }) {
    const columns = visibleColumns(ID_COLUMNS, uniform);
    return model.toTsv([columns.map((column) => column.label), ...ordered(rows, order).map((item) => columns.map((column) => column.text(item)))]);
  }

  /* ---------- แถบแสดงค่าของจุดที่ชี้/เลือก ---------- */

  const valueBlock = (series, label, value, extra) => `<div class="lab-rv lab-rv-${series}"><dt>${KEY_ICON(series)}${esc(label)}</dt><dd><strong>${esc(value)}</strong>${extra ? `<small>${esc(extra)}</small>` : ""}</dd></div>`;
  const statBlock = (label, avg, sd) => `<div class="lab-rv"><dt>${esc(label)}</dt><dd><strong>${esc(reading(avg))}</strong>${isNumber(sd) ? `<small>SD ${esc(reading(sd))}</small>` : ""}</dd></div>`;

  // item มาจากหน้าวัสดุ (มี seq/groupIndex) หรือจากอนุกรมของ ID (มี order กับ deltaMh/deltaMv) kind = latest | preview | pinned
  function readout({ item, group = null, kind = "latest", mode = "sequence" }) {
    if (!item) return "";
    const idMode = mode === "id";
    const position = idMode ? `ครั้งที่ ${item.order} ของ ID ${item.sampleId}` : `#${item.seq} · ID ${item.sampleId}`;
    const when = `${model.formatDate(item.testDate)} ${model.formatTime(item.testTime)}`;
    const values = idMode
      ? valueBlock("mh", "MH", reading(item.mh), isNumber(item.deltaMh) ? `Δ ${model.formatSigned(item.deltaMh)}` : "") + valueBlock("mv", "MV", reading(item.mv), isNumber(item.deltaMv) ? `Δ ${model.formatSigned(item.deltaMv)}` : "")
      : valueBlock("mh", "MH", reading(item.mh), "") + valueBlock("mv", "MV", reading(item.mv), "");
    const stats = !idMode && group?.hasStats
      ? statBlock(`AVG MH ชุดที่ ${group.index + 1}`, group.avgMh, group.sdMh) + statBlock(`AVG MV ชุดที่ ${group.index + 1}`, group.avgMv, group.sdMv)
      : "";
    return `<div class="lab-readout-meta"><span class="lab-tag lab-tag-${esc(kind)}">${esc(TAGS[kind] ?? TAGS.latest)}</span><strong>${esc(position)}</strong><span>${esc(when)}</span></div><dl class="lab-readout-values">${values}${stats}</dl>`;
  }

  function chartKey(mode) {
    if (mode === "id") return `<span class="lab-key-item"><i class="lab-key-mean" aria-hidden="true"></i>ค่าเฉลี่ยของ ID นี้</span><span class="lab-key-item">ป้ายตัวเลข = ครั้งล่าสุด ค่าสูงสุด และค่าต่ำสุด</span>`;
    return `<span class="lab-key-item"><i class="lab-key-band" aria-hidden="true"></i>แถบสลับ = วันที่ทดสอบ</span><span class="lab-key-item"><i class="lab-key-avg" aria-hidden="true"></i>ขีดสั้น = ค่า AVG ของชุดทดสอบตามชีต</span>`;
  }

  const api = {
    TAGS, ORDER_OPTIONS, RESULT_COLUMNS, ID_COLUMNS,
    liveBar, problemsHtml, overviewPage, overviewSummaryText, materialRows,
    materialPage, materialOptions, idOptions, conditionsText, materialSummaryText,
    resultsTable, idTable, resultsTsv, idTsv, readout, chartKey,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_VIEWS = api;
})(typeof window !== "undefined" ? window : globalThis);
