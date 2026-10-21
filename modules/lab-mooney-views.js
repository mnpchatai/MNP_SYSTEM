// ส่วนแสดงผลของโมดูล MNP LAB — สร้างเป็นข้อความ HTML ล้วนจากข้อมูลที่ model แปลงแล้ว ไม่มี DOM/Supabase เทสต์ที่ scripts/tests/lab-mooney-views.test.mjs
//
// module-lab.js เรียกที่นี่เพื่อได้ HTML ของแดชบอร์ด หน้ารวมและหน้าวัสดุ แล้วเป็นผู้ผูกเหตุการณ์ รีเฟรช และจัดการสิทธิ์เอง
// หัวของแดชบอร์ดและหน้ารวมเป็นแถบเลือกโมดูลของ MNP LAB (lab-sections.js) ซึ่งเป็นชื่อหน้าด้วย
// ข้อความจากชีต (ชื่อวัสดุ ID) ถูก escape ทุกจุดก่อนใส่ใน HTML และ URL ของวัสดุผ่าน model.materialUrl เท่านั้น
// ค่า AVG/SD ที่ merge ในชีตแสดงตามชีต ไม่คำนวณใหม่ (ค่าสรุปของกราฟ เช่น เฉลี่ยทั้งหมด คำนวณจากทุกครั้งที่ทดสอบและระบุไว้ชัดเจน)
// ข้อยกเว้นเดียวคือขีด AVG ในกราฟ: ชุดที่ชีตยังไม่มี AVG หรือมีค่าที่ไม่ใช่ AVG ของแถวนั้น (อยู่นอกช่วงค่าที่อ่านได้ของชุด) กราฟเฉลี่ยค่าที่อ่านได้ให้เป็นขีดประ เพื่อให้ทุกครั้งที่ทดสอบมีขีดเสมอ (ตารางยังแสดงค่าตามชีต)
//
// หลักของหน้านี้: ข้อมูลแต่ละอย่างแสดงที่เดียว — ชื่อวัสดุอยู่ที่ตัวเลือกหัวหน้า (ไม่ซ้ำเป็นหัวข้อ/ตัวเลือก/คำอธิบายอีก), จำนวนครั้งและเงื่อนไขทดสอบอยู่ที่หัวตาราง,
// ค่าของจุดที่ชี้อยู่แสดงเป็นป้ายลอยชั่วคราวและแถวที่ตรงกันในตาราง (ไม่มีแถบค่าถาวรที่ซ้ำกับตาราง), วันที่แสดงเป็นวันที่ ไม่ซ้ำเป็น "เมื่อวาน"
(function (root) {
  const model = root.MNP_LAB_MOONEY;
  const chart = root.MNP_LAB_CHART;
  const sections = root.MNP_LAB_SECTIONS;
  if (!model || !chart || !sections) return;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const int = (value) => Number(value).toLocaleString("th-TH");
  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

  const KEY_ICON = (series) => `<i class="lab-key lab-key-${series}" aria-hidden="true"></i>`;
  const REFRESH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>`;
  const BACK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;

  /* ---------- ส่วนที่ใช้ร่วมกัน ---------- */

  // เวลาอ่านชีตล่าสุดกับปุ่มรีเฟรช (ไอคอนอย่างเดียว: ชื่อปุ่มและความถี่ของการรีเฟรชอัตโนมัติอยู่ที่ title/aria-label ไม่ต้องเป็นข้อความถาวรบนหน้า)
  function liveBar(seconds = 30) {
    const label = `รีเฟรชตอนนี้ (อัตโนมัติทุก ${seconds} วินาที)`;
    return `<div class="lab-live">
      <span class="lab-live-text" id="lab-updated">กำลังโหลดข้อมูล…</span>
      <button class="icon-button lab-refresh" type="button" id="lab-refresh" aria-label="${esc(label)}" title="${esc(label)}">${REFRESH_ICON}</button>
      <span class="small lab-status" id="lab-status" role="status"></span>
    </div>`;
  }

  /* ---------- แดชบอร์ดของ MNP LAB ---------- */

  // ตอนนี้มีข้อมูลเฉพาะ Mooney (โมดูลอื่นยังไม่มีแหล่งข้อมูล จึงไม่มีส่วนบนแดชบอร์ด) เวลาอ่านชีตคือของชีต Mooney_Test_Report
  // module-lab.js เติมตัวเลขลง #lab-dash-mooney ด้วย dashboardMooney ทุกครั้งที่ได้ฟีดใหม่
  function dashboardPage(seconds) {
    return `<div class="lab-page">
      ${sections.headHtml("dashboard", liveBar(seconds))}
      <section class="lab-dash-block" aria-labelledby="lab-dash-mooney-title">
        <h2 class="lab-dash-title" id="lab-dash-mooney-title"><a href="${esc(model.materialUrl(""))}">Mooney</a></h2>
        <div id="lab-dash-mooney"></div>
      </section>
    </div>`;
  }

  const tile = (label, value, note = "") => `<div class="summary"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ""}</div>`;

  // stats จาก model.overviewStats: จำนวนวัสดุ / ผลทดสอบรวม / วันที่ทดสอบล่าสุดกับจำนวนวัสดุที่ทดสอบวันนั้น
  function dashboardMooney(stats) {
    if (!stats?.materialCount) return `<div class="card"><div class="empty">ยังไม่มีข้อมูลผลทดสอบในชีต Mooney_Test_Report</div></div>`;
    return `<div class="summary-grid lab-dash-grid">
        ${tile("วัสดุ", int(stats.materialCount))}
        ${tile("ผลทดสอบ (ครั้ง)", int(stats.resultCount))}
        ${tile("ทดสอบล่าสุด", model.formatDate(stats.lastTested), stats.lastTested ? `${int(stats.latestMaterialCount)} วัสดุ` : "")}
      </div>`;
  }

  /* ---------- หน้ารวม: รายการวัสดุ ---------- */

  function overviewPage(seconds) {
    const sortOptions = model.SORT_OPTIONS.map((option) => `<option value="${esc(option.key)}">${esc(option.label)}</option>`).join("");
    return `<div class="lab-page">
      ${sections.headHtml("mooney", liveBar(seconds))}
      <section class="card flush lab-overview-card">
        <div class="lab-toolbar">
          <div class="lab-search"><label class="sr-only" for="lab-search">ค้นหาวัสดุ</label><input class="input" id="lab-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lab-search-list" enterkeyhint="go" autocomplete="off" maxlength="${model.MAX_MATERIAL_LENGTH}" placeholder="ค้นหาวัสดุ เช่น A1802">
            <div class="ss-list" id="lab-search-list" role="listbox" aria-label="วัสดุที่ตรงกับคำค้น" data-popup hidden></div></div>
          <div class="lab-sort"><label class="sr-only" for="lab-sort">เรียงตาม</label><select class="select" id="lab-sort">${sortOptions}</select></div>
          <span class="muted small lab-count" id="lab-count" aria-live="polite"></span>
          <span class="lab-howto">MH / MV = ค่าเฉลี่ยชุดล่าสุด ± SD · Δ = เทียบชุดก่อนหน้า · เส้น = แนวโน้มรายชุด</span>
        </div>
        <div class="table-wrap"><table class="lab-overview"><caption class="sr-only">วัสดุที่ทดสอบ Mooney พร้อมผลชุดล่าสุด</caption>
          <thead><tr><th scope="col">วัสดุ</th><th scope="col">ทดสอบล่าสุด</th><th scope="col">${KEY_ICON("mh")}MH</th><th scope="col">${KEY_ICON("mv")}MV</th></tr></thead>
          <tbody id="lab-materials"></tbody></table></div>
        <div class="empty" id="lab-empty" hidden></div>
      </section>
    </div>`;
  }

  // รายการที่เด้งใต้ช่องค้นหา (listbox): ชื่อวัสดุอย่างเดียว เพราะจำนวนผลและวันที่อยู่ในตารางแล้ว
  // ไม่มีข้อความ "ไม่พบ" ในรายการ — ตารางและตัวนับ "n จาก m" บอกอยู่แล้ว รายการจึงปิดเองเมื่อไม่มีที่ตรง
  // ตัวเลือกอ้างด้วยลำดับ (data-pos) ให้โค้ดหน้าหยิบวัสดุจากรายการของตัวเอง ไม่อ่านชื่อกลับจาก DOM
  function materialSuggestions(materials) {
    return materials.map((item, position) => `<button type="button" tabindex="-1" class="ss-option" id="lab-search-o${position}" role="option" data-pos="${position}" aria-selected="false">${esc(item.material)}</button>`).join("");
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

  // หนึ่งวัสดุหนึ่งแถว: ชื่อ + จำนวนผล / วันที่ทดสอบล่าสุด / MH / MV ของชุดล่าสุด (วันที่แสดงเป็นวันที่อย่างเดียว ไม่แปลงซ้ำเป็น "เมื่อวาน")
  function materialRows(materials) {
    return materials.map((item) => `<tr class="lab-material-row" data-href="${esc(model.materialUrl(item.material))}">
        <th scope="row" class="lab-name"><a href="${esc(model.materialUrl(item.material))}">${esc(item.material)}</a><span class="lab-meta">${esc(int(item.resultCount))} ผล</span></th>
        <td class="lab-when" data-label="ทดสอบล่าสุด">${esc(model.formatDate(item.lastTested))}</td>
        ${metricCell("MH", "mh", item.latest?.mh, item.trendMh)}
        ${metricCell("MV", "mv", item.latest?.mv, item.trendMv)}
      </tr>`).join("");
  }

  /* ---------- หน้าวัสดุ ---------- */

  const ORDER_OPTIONS = Object.freeze([
    { key: "newest", label: "ใหม่สุดก่อน" },
    { key: "oldest", label: "เก่าสุดก่อน" },
  ]);

  // เครื่องมือช่วงและซูมของกราฟโหมดลำดับ (module-lab.js ผูกปุ่มและซ่อนเมื่อดูประวัติ ID): ล่าสุด/ทั้งหมด + เลือกเดือน … ถึง … + เลื่อนซ้าย/ขวา + ซูมออก/เข้า
  // ปุ่มเป็นปุ่มแบน ส่วนเดือนเป็น <select> ของเบราว์เซอร์ (data-native-select: บน iPhone เป็นตัวเลือกของระบบที่แตะง่าย ไม่ใช่รายการลอยของแอป)
  // ป้ายปุ่ม "ล่าสุด" ใส่จำนวนครั้งตามความกว้างจอตอนวาด (ดู module-lab.js) คำอธิบายท่าทางอยู่ที่ title
  const STEP_ICONS = Object.freeze({
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
    forward: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`,
    out: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>`,
    in: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>`,
  });
  const RANGE_BUTTONS = Object.freeze([
    { key: "latest", label: "ล่าสุด", title: "ล่าสุดตามความกว้างจอ" },
    { key: "all", label: "ทั้งหมด", title: "ทุกครั้งที่ทดสอบ" },
  ]);
  const STEP_BUTTONS = Object.freeze([
    { key: "back", label: "เลื่อนไปช่วงก่อนหน้า" },
    { key: "forward", label: "เลื่อนไปช่วงถัดไป" },
    { key: "out", label: "ซูมออก (−)" },
    { key: "in", label: "ซูมเข้า (+) หรือ Ctrl + ล้อเมาส์ / บีบสองนิ้ว" },
  ]);

  function zoomBar() {
    const ranges = RANGE_BUTTONS.map((button) => `<button type="button" class="lab-range-btn" data-range="${button.key}" aria-pressed="false" title="${esc(button.title)}">${esc(button.label)}</button>`).join("");
    const steps = STEP_BUTTONS.map((button) => `<button type="button" class="lab-step" data-step="${button.key}" aria-label="${esc(button.label)}" title="${esc(button.label)}">${STEP_ICONS[button.key]}</button>`).join("");
    const months = `<div class="lab-months" role="group" aria-label="ช่วงเดือนที่แสดง"><select class="select lab-month" id="lab-month-from" data-native-select aria-label="ตั้งแต่เดือน"></select><span class="lab-month-to" aria-hidden="true">ถึง</span><select class="select lab-month" id="lab-month-to" data-native-select aria-label="ถึงเดือน"></select></div>`;
    return `<div class="lab-zoom" id="lab-zoom" role="toolbar" aria-label="ช่วงที่แสดงและการซูมของกราฟ" hidden><div class="lab-ranges" role="group" aria-label="ช่วงที่แสดง">${ranges}</div>${months}<div class="lab-steps">${steps}</div></div>`;
  }

  // ตัวเลือกเดือนของช่องเดือน (months = "YYYY-MM" เรียงเก่า → ใหม่): ทุกเดือนที่มีผลทดสอบ ไม่ใส่จำนวนครั้ง เพราะแกนกราฟและตารางบอกอยู่แล้ว
  const monthOptions = (months, selected) => months
    .map((month) => `<option value="${esc(month)}"${month === selected ? " selected" : ""}>${esc(model.formatMonth(month))}</option>`)
    .join("");

  // ข้อความสำหรับโปรแกรมอ่านหน้าจอเมื่อช่วงที่แสดงเปลี่ยน (ข้อความล้วน)
  function rangeAnnouncement({ items, range }) {
    const first = items[range.start];
    const last = items[range.end - 1];
    if (!first || !last) return "";
    return `แสดง ${model.formatDate(first.testDate)} ถึง ${model.formatDate(last.testDate)} ${int(range.end - range.start)} จาก ${int(items.length)} ครั้ง`;
  }

  // หัวหน้าบรรทัดเดียว: ปุ่มกลับ · ตัวเลือกวัสดุ (เป็นทั้งชื่อหน้าและตัวสลับวัสดุ) · ตัวเลือก ID · เวลาอ่านชีต/รีเฟรช
  function materialPage(material, seconds) {
    const orders = ORDER_OPTIONS.map((option) => `<option value="${esc(option.key)}">${esc(option.label)}</option>`).join("");
    return `<div class="lab-page">
      <div class="lab-head lab-head-material">
        <a class="icon-button lab-back" href="${esc(model.materialUrl(""))}" aria-label="กลับไปรายการวัสดุ" title="วัสดุทั้งหมด">${BACK_ICON}</a>
        <h1 class="lab-title"><label class="sr-only" for="lab-material-select">วัสดุ</label><select class="lab-title-select" id="lab-material-select"><option>${esc(material)}</option></select></h1>
        <label class="lab-id" id="lab-id-field"><span class="sr-only">ID</span><select class="select" id="lab-id-select"><option value="">ทุก ID</option></select></label>
        ${liveBar(seconds)}
      </div>
      <section class="card" id="lab-none" hidden><div class="empty">ไม่พบผลทดสอบของวัสดุ “${esc(material)}”</div></section>
      <div id="lab-body">
        <section class="card lab-chart-card" aria-label="กราฟ MH และ MV">
          <div class="lab-plot-wrap">
            <div class="lab-plot" id="lab-plot" tabindex="0" role="group" aria-label="กราฟ MH และ MV ใช้ปุ่มลูกศรซ้ายขวาเพื่อเลื่อนดูทีละครั้ง ปุ่มบวกและลบเพื่อซูม"></div>
            <div class="lab-tip" id="lab-tip" hidden></div>
          </div>
          <div class="lab-chart-foot">
            <p class="lab-chart-key" id="lab-chart-key"></p>
            ${zoomBar()}
          </div>
          <p class="sr-only" id="lab-announce" role="status" aria-live="polite"></p>
        </section>
        <section class="card flush lab-results-card" aria-labelledby="lab-table-title">
          <div class="card-heading">
            <div class="lab-table-head"><h2 id="lab-table-title">ผลทดสอบ</h2><span class="muted small" id="lab-table-note"></span></div>
            <div class="lab-card-actions"><label class="lab-order"><span class="sr-only">เรียงตาราง</span><select class="select" id="lab-order-select">${orders}</select></label><button class="btn secondary small" type="button" id="lab-copy">คัดลอกตาราง</button></div>
          </div>
          <div class="lab-table-scroll" id="lab-table-scroll" tabindex="0" role="region" aria-labelledby="lab-table-title"></div>
        </section>
      </div>
    </div>`;
  }

  // วัสดุที่เปิดอยู่ต้องอยู่ในรายการเสมอ (แม้ชีตยังไม่มีผลของมัน) ตัวเลือกไม่ใส่จำนวนผล เพราะหน้ารวมและหัวตารางบอกอยู่แล้ว
  function materialOptions(summaries, selected) {
    const names = summaries.map((item) => item.material);
    if (selected && !names.includes(selected)) names.push(selected);
    return names
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }))
      .map((name) => `<option value="${esc(name)}"${name === selected ? " selected" : ""}>${esc(name)}</option>`)
      .join("");
  }

  // จำนวนครั้งของแต่ละ ID ไว้ให้เลือก (ID ที่ทดสอบครั้งเดียวไม่มีประวัติให้ดู)
  const idOptions = (ids, selected) => `<option value="">ทุก ID</option>`
    + ids.map((entry) => `<option value="${esc(entry.id)}"${entry.id === selected ? " selected" : ""}>${esc(entry.id)} (${int(entry.count)})</option>`).join("");

  function conditionsText(conditions) {
    if (!conditions.uniform) return "";
    const parts = [];
    if (conditions.temperatures.length) parts.push(`${model.formatPlain(conditions.temperatures[0])} °C`);
    if (conditions.minutes.length) parts.push(`${model.formatPlain(conditions.minutes[0])} นาที`);
    return parts.join(" / ");
  }

  // ข้อความข้างชื่อ "ผลทดสอบ": จำนวนครั้ง (และชุด) ของสิ่งที่ตารางแสดงอยู่ + เงื่อนไขทดสอบที่ใช้ร่วมกัน — เป็นที่เดียวที่บอกตัวเลขเหล่านี้
  function tableNote({ count, groupCount = null, conditions }) {
    return [`${int(count)} ครั้ง`, groupCount === null ? "" : `${int(groupCount)} ชุด`, conditionsText(conditions)].filter(Boolean).join(" · ");
  }

  /* ---------- ตารางผลทดสอบ ---------- */

  const reading = (value) => model.formatReading(value);
  const whenText = (item) => `${model.formatDate(item.testDate)} ${model.formatTime(item.testTime)}`;

  // คอลัมน์ของตารางผล: ใช้ตัวเดียวกันทั้งวาดตารางและสร้างข้อความสำหรับคัดลอก
  //   varying = แสดงเมื่อเงื่อนไขทดสอบไม่เท่ากันทุกแถว, tsv = ตอนคัดลอกแยกเป็นหลายคอลัมน์ (วันที่กับเวลาแยกกันเพื่อใช้ต่อใน Excel)
  const WHEN_COPY = [{ label: "วันที่", text: (item) => model.formatDate(item.testDate) }, { label: "เวลา", text: (item) => model.formatTime(item.testTime) }];
  const RESULT_COLUMNS = Object.freeze([
    { key: "id", label: "ID", sticky: true, text: (item) => item.sampleId },
    { key: "when", label: "วันที่ · เวลา", text: whenText, tsv: WHEN_COPY },
    { key: "temp", label: "อุณหภูมิ (°C)", varying: true, num: true, text: (item) => model.formatPlain(item.temperature) },
    { key: "minutes", label: "เวลาทดสอบ (นาที)", varying: true, num: true, text: (item) => model.formatPlain(item.testMinutes) },
    { key: "mh", label: "MH", mark: "mh", num: true, text: (item) => reading(item.mh) },
    { key: "mv", label: "MV", mark: "mv", num: true, text: (item) => reading(item.mv) },
    { key: "avgMh", label: "AVG MH", group: true, tone: "avg", text: (item) => reading(item.avgMh) },
    { key: "sdMh", label: "SD MH", group: true, tone: "sd", text: (item) => reading(item.sdMh) },
    { key: "avgMv", label: "AVG MV", group: true, tone: "avg", text: (item) => reading(item.avgMv) },
    { key: "sdMv", label: "SD MV", group: true, tone: "sd", text: (item) => reading(item.sdMv) },
  ]);

  // ประวัติของ ID เดียว: ไม่มีคอลัมน์ ID (เลือกอยู่ที่ตัวเลือกด้านบน) และไม่มีเลขลำดับ (ลำดับคือตำแหน่งแถว)
  const ID_COLUMNS = Object.freeze([
    { key: "when", label: "วันที่ · เวลา", text: whenText, tsv: WHEN_COPY },
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
    const classes = ["lab-th", column.num || column.group ? "num" : "", column.group ? "is-group" : "", column.sticky ? "sticky" : ""].filter(Boolean).join(" ");
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
      const cells = columns.map((column) => {
        if (column.group) {
          if (!group.hasStats) return `<td class="num stat is-none">—</td>`;
          if (!start) return "";
          return `<td class="num stat stat-${column.tone}" rowspan="${group.count}">${esc(column.text(item))}</td>`;
        }
        const cellClasses = [column.num ? "num" : "", column.mark ? `val val-${column.mark}` : "", column.sticky ? "sticky" : ""].filter(Boolean).join(" ");
        return column.sticky
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
        const cellClasses = [column.num ? "num" : "", column.mark ? `val val-${column.mark}` : "", column.tone ? `stat stat-${column.tone}` : ""].filter(Boolean).join(" ");
        return `<td class="${cellClasses}">${esc(column.text(item))}</td>`;
      }).join("");
      return `<tr class="lab-result-row${item.seq === activeSeq ? " is-active" : ""}" data-seq="${item.seq}">${cells}</tr>`;
    }).join("");
    return `<table class="lab-table lab-results lab-results-id"><caption class="sr-only">ผลทดสอบ Mooney ของ ID ${esc(id)}</caption><thead><tr>${columns.map(headCell).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  }

  // ข้อความคั่นแท็บสำหรับวางใน Excel: ทุกแถวมี AVG/SD ครบ (ขยายค่าที่ merge ไปทุกแถว เหมือนฟีดจากชีต) วันที่กับเวลาแยกคอลัมน์
  function tsvOf(columns, items, uniform, order) {
    const cells = visibleColumns(columns, uniform).flatMap((column) => column.tsv ?? [{ label: column.label, text: column.text }]);
    return model.toTsv([cells.map((cell) => cell.label), ...ordered(items, order).map((item) => cells.map((cell) => cell.text(item)))]);
  }

  const resultsTsv = ({ series, order = "newest", uniform = true }) => tsvOf(RESULT_COLUMNS, series.items, uniform, order);
  const idTsv = ({ rows, order = "newest", uniform = true }) => tsvOf(ID_COLUMNS, rows, uniform, order);

  /* ---------- ป้ายค่าของจุดที่ชี้/เลือก ---------- */

  const tipValue = (series, label, value, delta) => `<span class="lab-tip-v">${KEY_ICON(series)}${esc(label)} <b>${esc(value)}</b>${isNumber(delta) ? `<small>Δ ${esc(model.formatSigned(delta))}</small>` : ""}</span>`;

  // ป้ายลอยข้างเส้นนำสายตา: วันเวลา (+ ID เมื่อดูทั้งวัสดุ) และค่า MH/MV ของจุดนั้นเท่านั้น
  // ค่า AVG/SD ของชุดอยู่ที่แถวในตารางที่สว่างขึ้นพร้อมกัน จึงไม่ซ้ำที่นี่ (โหมด ID ใส่ผลต่างจากครั้งก่อนเพราะตารางอยู่นอกสายตาได้)
  function tooltip({ item, mode = "sequence" }) {
    if (!item) return "";
    const idMode = mode === "id";
    const when = idMode ? whenText(item) : `${whenText(item)} · ID ${item.sampleId}`;
    return `<div class="lab-tip-when">${esc(when)}</div><div class="lab-tip-values">${tipValue("mh", "MH", reading(item.mh), idMode ? item.deltaMh : null)}${tipValue("mv", "MV", reading(item.mv), idMode ? item.deltaMv : null)}</div>`;
  }

  // ข้อความสำหรับโปรแกรมอ่านหน้าจอเมื่อเลือกจุดด้วยคีย์บอร์ดหรือแตะ (ข้อความล้วน ไม่ใช่ HTML)
  function announcement({ item, mode = "sequence" }) {
    if (!item) return "";
    return `${whenText(item)}${mode === "id" ? "" : ` ID ${item.sampleId}`} MH ${reading(item.mh)} MV ${reading(item.mv)}`;
  }

  // ขีดทึบ = ค่าตามชีต, ขีดประ = ชุดที่ชีตยังไม่มี AVG หรือค่าในชีตใช้ไม่ได้ กราฟคำนวณจากค่าที่อ่านได้ของชุดนั้นให้ (อธิบายที่ title ไม่เป็นข้อความถาวร)
  const AVG_KEY_NOTE = "ขีดทึบ = ค่า AVG ตามชีต · ขีดประ = ชุดที่ชีตยังไม่มี AVG หรือค่า AVG ในชีตไม่ตรงกับค่าที่อ่านได้ (อยู่นอกช่วงต่ำสุด–สูงสุดของชุด) กราฟเฉลี่ยค่าที่อ่านได้ของชุดนั้นให้";

  // คำอธิบายสัญลักษณ์ของกราฟบรรทัดเดียวใต้กราฟ (เป็นที่เดียวที่อธิบายแถบและขีด)
  // bandSize = ขนาดแถบที่กราฟใช้อยู่จริง (ขยายเป็นทวีคูณของ chart.BAND_SIZE เมื่อแถบแคบเกินไป)
  function chartKey(mode, bandSize = chart.BAND_SIZE) {
    if (mode === "id") return `<span class="lab-key-item"><i class="lab-key-mean" aria-hidden="true"></i>เส้นประ = ค่าเฉลี่ยของ ID นี้</span><span class="lab-key-item">ป้าย = ล่าสุด สูงสุด ต่ำสุด</span>`;
    return `<span class="lab-key-item"><i class="lab-key-band" aria-hidden="true"></i>แถบสลับ = ทุก ${bandSize} จุด</span><span class="lab-key-item" title="${esc(AVG_KEY_NOTE)}"><i class="lab-key-avg" aria-hidden="true"></i>ขีดสั้น = ค่า AVG ของชุด</span>`;
  }

  const api = {
    ORDER_OPTIONS, RESULT_COLUMNS, ID_COLUMNS,
    liveBar, dashboardPage, dashboardMooney, overviewPage, materialRows, materialSuggestions,
    materialPage, materialOptions, idOptions, conditionsText, tableNote,
    resultsTable, idTable, resultsTsv, idTsv, tooltip, announcement, chartKey, rangeAnnouncement, monthOptions,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_VIEWS = api;
})(typeof window !== "undefined" ? window : globalThis);
