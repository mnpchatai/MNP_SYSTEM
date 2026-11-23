// รายงานทดสอบ MDR ของ MNP LAB — HTML ของหน้า ตาราง ผลการอัปโหลด และกราฟแรงบิด (SVG) ข้อความล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-mdr-views.test.mjs · ข้อมูล/สถิติอยู่ที่ lab-mdr-model.js · การเชื่อมต่อ/เหตุการณ์อยู่ที่ lab-mdr-page.js
//
// หน้าเดียวต่อชุดทดสอบ (#/lab?module=mdr&part=F1|F2): หัวโมดูลสี + ปุ่มอัปโหลด → แท็บชุดทดสอบ → รายการสูตร หรือหน้าสูตร
// หน้าสูตร: กราฟแรงบิดซ้อนกันทุกครั้งของช่วงวันที่เลือก (F1 เท่านั้น เริ่มที่วันล่าสุดวันเดียวเหมือนหน้าจอเครื่อง) พร้อมแถบช่วงวันของตัวเอง
// → กราฟแนวโน้มรายวัน (ทั้ง F1 และ F2) พร้อมแถบช่วงวันอีกอัน
// → ตารางผลทุกครั้งของวันในช่วงนั้น แบ่งตามวันและเงื่อนไข (เวลาทดสอบ · อุณหภูมิ) มีแถว AVG และ SD ใต้แต่ละกลุ่ม
// ค่า AVG/SD อยู่ในตารางที่เดียว (ไม่ซ้ำในหัวกราฟหรือสรุปแยก) กราฟไม่แสดงอุณหภูมิแม่พิมพ์ (T1/T2)
(function (root) {
  // โหลดหลัง lab-range.js, lab-mdr-model.js และ lab-sections.js (index.html) · เทสต์ใน Node ตั้งสองตัวหลังบน globalThis ก่อน require ไฟล์นี้
  const model = root.MNP_LAB_MDR;
  const sections = root.MNP_LAB_SECTIONS;
  const rangeKit = root.MNP_LAB_RANGE;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // สีเส้นของแต่ละครั้งในวันเดียวกัน (ข้อมูลจริงมีถึง 15 ครั้งต่อวัน) สว่างพอบนพื้นกราฟสีเข้ม และเรียงให้สีติดกันต่างกันชัด
  const LINE_COLORS = Object.freeze(["#4ea8ff", "#ff8a3d", "#3ddc97", "#ff5c8a", "#ffd23f", "#b48cff", "#2ee6e6", "#ff6b4a", "#9be15d", "#f78fe0", "#7aa2ff", "#e6b35c", "#c9d4e3", "#00c2a8", "#ff9fb3", "#a3e635"]);
  // เกิน 16 (ช่วงหลายวันที่ยาว) ไม่วนกลับมาสีเดิม: หมุนเฉดสีทีละมุมทองคำ (~137.5°) สว่างพอบนพื้นเข้มเหมือนชุดแรก
  const lineColor = (index) => (index < LINE_COLORS.length ? LINE_COLORS[index] : `hsl(${Math.round((index * 137.508) % 360)} 85% 66%)`);

  /* ---------- โครงหน้า ---------- */

  const UPLOAD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`;

  // data-attachment-skip: ไม่ใช่ไฟล์แนบ — ตัวจัดการไฟล์แนบของ app.js (attachment-image.js) ต้องไม่ตรวจ "ไม่เกิน 10 ไฟล์" หรือล้างช่องนี้
  // (โฟลเดอร์ของวันมีไฟล์ .ini หลายสิบไฟล์)
  // ปุ่มอัปโหลด: เมนูสองทาง (เลือกไฟล์ / เลือกทั้งโฟลเดอร์ของวัน) เป็น popup ใต้ปุ่ม (data-popup ในกรอบเดียวกับปุ่ม ปิดด้วย closePopup ของ app.js)
  function uploadControl() {
    return `<div class="lab-mdr-upload">
      <button class="btn lab-mdr-upload-btn" type="button" id="mdr-upload" aria-haspopup="menu" aria-expanded="false" aria-controls="mdr-upload-menu">${UPLOAD_ICON}<span>อัปโหลดไฟล์ MDR (.ini)</span></button>
      <div class="lab-mdr-menu" id="mdr-upload-menu" role="menu" data-popup hidden>
        <button type="button" role="menuitem" data-pick="files"><strong>เลือกไฟล์</strong><small>เลือกได้หลายไฟล์</small></button>
        <button type="button" role="menuitem" data-pick="folder"><strong>เลือกทั้งโฟลเดอร์</strong><small>เช่น โฟลเดอร์ของวัน 2026-11-02</small></button>
      </div>
      <input type="file" id="mdr-pick-files" accept=".ini" multiple hidden data-attachment-skip />
      <input type="file" id="mdr-pick-folder" webkitdirectory multiple hidden data-attachment-skip />
    </div>`;
  }

  function partTabs(active, formula) {
    return `<nav class="lab-mdr-parts" aria-label="ชุดทดสอบ">${model.PARTS.map((part) => {
      const current = part.key === active;
      // แท็บที่เปิดอยู่ในหน้าสูตร = กลับไปรายการสูตรของชุดนี้ · แท็บอีกชุด = สูตรเดียวกันในชุดนั้น
      const href = model.routeUrl({ part: part.key, formula: current ? "" : formula });
      return `<a class="lab-mdr-part" href="${esc(href)}" data-part="${part.key}"${current ? ' aria-current="page"' : ""}><span>${esc(part.label)}</span><small>${part.key}</small></a>`;
    }).join("")}</nav>`;
  }

  // route = { part, formula, date } · body ถูกวาดทีหลังเมื่ออ่านข้อมูลแล้ว
  function page(route) {
    return `<div class="lab-page lab-mdr">
      ${sections.moduleHead("mdr", { extra: uploadControl() })}
      ${partTabs(route.part, route.formula)}
      <section class="card lab-mdr-result" id="mdr-result" role="status" aria-live="polite" hidden></section>
      <div id="mdr-body" aria-busy="true"><div class="card lab-mdr-loading">กำลังโหลด…</div></div>
    </div>`;
  }

  /* ---------- รายการสูตร ---------- */

  function overview(partKey, formulas) {
    const part = model.findPart(partKey);
    if (!formulas.length) {
      return `<section class="card">${sections.emptyBlock(`ยังไม่มีผล${part.label}`, { hint: "กด “อัปโหลดไฟล์ MDR (.ini)” แล้วเลือกไฟล์หรือโฟลเดอร์ของวันจากเครื่อง MDR" })}</section>`;
    }
    const rows = formulas.map((item) => `<tr>
        <th scope="row" class="lab-name"><a href="${esc(model.routeUrl({ part: partKey, formula: item.formula }))}">${esc(item.formula)}</a></th>
        <td class="num">${esc(item.tests)}</td>
        <td class="num">${esc(item.days)}</td>
        <td>${esc(model.formatDate(item.last_date))}</td>
      </tr>`).join("");
    return `<section class="card flush lab-mdr-formulas">
      <div class="table-wrap"><table class="lab-table lab-mdr-overview"><caption class="sr-only">สูตรที่มีผล${esc(part.label)}</caption>
        <thead><tr><th scope="col">สูตร (Formula)</th><th scope="col" class="num">จำนวนครั้ง</th><th scope="col" class="num">จำนวนวัน</th><th scope="col">ทดสอบล่าสุด</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }

  /* ---------- หน้าสูตร ---------- */

  function formulaSelect(formulas, selected) {
    const names = formulas.map((item) => item.formula);
    if (selected && !names.includes(selected)) names.push(selected);
    return names.map((name) => `<option value="${esc(name)}"${name === selected ? " selected" : ""}>${esc(name)}</option>`).join("");
  }

  // หัวหน้าสูตร: ตัวเลือกสูตร (ชื่อสูตรแสดงที่นี่ที่เดียว) · ช่วงวันของกราฟอยู่ในการ์ดของกราฟแต่ละอัน
  function formulaHead(route, formulas) {
    return `<div class="lab-head lab-mdr-head">
      <h2 class="lab-title"><label class="sr-only" for="mdr-formula">สูตร</label><select class="lab-title-select" id="mdr-formula">${formulaSelect(formulas, route.formula)}</select></h2>
    </div>`;
  }

  // zoom = ช่วงที่เลือกของกราฟแนวโน้ม (ดู trendRange) ตารางแสดงเฉพาะวันในช่วงนั้น
  // curveZoom = ช่วงวันของกราฟแรงบิด F1 (ดู curveRange) วันในช่วงนั้นมีป้าย "ในกราฟแรงบิด" ในตาราง (หน้าเว็บแก้ป้ายตามวันที่วาดได้จริงหลังอ่านกราฟ)
  // condition = เงื่อนไขของกราฟแนวโน้ม (model.conditionKey) ไม่ระบุ/ไม่พบ = เงื่อนไขที่มีผลมากที่สุด
  function formulaBody(route, data, zoom, curveZoom, condition = null) {
    const part = model.findPart(route.part);
    const days = model.groupByDate(data.tests);
    if (!days.length) {
      return `${formulaHead(route, data.formulas)}<section class="card">${sections.emptyBlock(`ไม่พบผล${part.label}ของสูตร “${route.formula}”`)}</section>`;
    }
    const curveDates = part.hasCurve ? curveRangeDates(days, curveRange(curveZoom, days)) : [];
    const shownDays = rangeDays(days, trendRange(zoom, days));
    return `${formulaHead(route, data.formulas)}
      ${part.hasCurve ? curveCard(days, curveDates, data) : ""}${trendCard(route, days, trendCondition(data.tests, condition))}
      <section class="card flush lab-results-card" aria-labelledby="mdr-table-title">
        <div class="card-heading"><div class="lab-table-head"><h2 id="mdr-table-title">ผลทดสอบรายครั้ง<span class="lab-mdr-table-scope">ช่วงวันเดียวกับกราฟแนวโน้ม</span></h2></div></div>
        <div class="lab-table-scroll lab-mdr-scroll" id="mdr-table-scroll" tabindex="0" role="region" aria-labelledby="mdr-table-title">${resultsTable(route.part, shownDays, curveDates)}</div>
      </section>`;
  }

  // เงื่อนไขของกราฟแนวโน้มที่ใช้จริง: ที่เลือกไว้ถ้ายังมีในผล ไม่อย่างนั้นเงื่อนไขของครั้งล่าสุด (ช่วงตั้งต้น = วันล่าสุด จึงไม่เปิดมาเจอกราฟว่าง)
  function trendCondition(tests, wanted) {
    const conditions = model.conditionsOf(tests);
    if (conditions.some((item) => item.key === wanted)) return wanted;
    const latest = tests.reduce((best, test) => (!best || `${test.test_date} ${test.test_time}` > `${best.test_date} ${best.test_time}` ? test : best), null);
    return latest ? model.conditionKey(latest) : null;
  }

  /* ---------- กราฟแรงบิด (F1) และช่วงวันของกราฟ ---------- */
  // หน่วยของช่วง = วันที่มีผลทดสอบ เหมือนกราฟแนวโน้ม · เริ่มที่วันล่าสุดวันเดียว (หน้าจอเครื่องของวันนี้) แคบสุด 1 วัน
  // หนึ่งวัน = หนึ่งเส้นต่อครั้ง สีต่อครั้ง ปุ่มเส้นต่อครั้ง (ID + เวลา) · หลายวัน = สีต่อวัน ปุ่มเส้นต่อวัน (วันที่ + จำนวนครั้ง) ป้าย = t90 เฉลี่ยของแต่ละวัน
  const CURVE_DEFAULT_DAYS = 1;
  const CURVE_MIN_DAYS = 1;
  const curveRange = (zoom, days) => resolveRange(zoom, days, { latest: CURVE_DEFAULT_DAYS, min: CURVE_MIN_DAYS });
  // วันในช่วง เรียงเก่า → ใหม่ (ลำดับสีและปุ่มเส้นของหลายวัน)
  const curveRangeDates = (days, range) => oldestFirst(days).slice(range.start, range.end).map((day) => day.date);
  // ลิงก์ ?date= และปุ่ม "ดูกราฟ" ในตาราง = วันนั้นวันเดียว (วันล่าสุด = "วันล่าสุด" ซึ่งตามวันใหม่ที่อัปโหลดเข้ามา) ไม่พบวันนั้น = วันล่าสุด
  function curveZoomFor(days, date) {
    const index = oldestFirst(days).findIndex((day) => day.date === date);
    if (index < 0 || index === days.length - 1) return { kind: "latest" };
    return { kind: "dates", from: date, to: date };
  }

  /* ---------- ช่วงที่ผู้ใช้ซูม/เลื่อนเอง เก็บเป็นวันที่ ---------- */
  // lab-range.js เก็บช่วง custom เป็นตำแหน่งในรายการวัน อัปโหลดวันที่เก่ากว่าเข้ามาแล้วตำแหน่งเลื่อน (เปิด 10 พ.ย. อยู่ กลายเป็น 2 พ.ย.)
  // หน้านี้จึงเก็บช่วงที่ไม่ติดวันล่าสุดเป็น { kind: "dates", from, to } (วันที่ ISO) และแปลงเป็นตำแหน่งตอนวาดทุกครั้ง
  // ช่วงที่ติดวันล่าสุด (follow) คงเป็น custom ตามขนาด เพื่อเลื่อนตามวันใหม่ที่เข้ามาเหมือนเดิม
  const monthsOf = (days) => oldestFirst(days).map((day) => rangeKit.monthOf(day.date));
  function toDayZoom(zoom, days) {
    if (zoom?.kind !== "custom" || zoom.follow) return zoom;
    const list = oldestFirst(days);
    const from = list[zoom.start]?.date;
    const to = list[zoom.end - 1]?.date;
    return from && to ? { kind: "dates", from, to } : zoom;
  }
  // ช่วงวันที่ที่เก็บไว้ใช้ตามนั้นพอดี (เดือนที่มี 2 วันแล้วกดเลื่อน ‹ › ยังกว้าง 2 วัน ไม่ขยายถึง min) ตัวเลือกอื่นผ่าน lab-range.js
  function resolveRange(zoom, days, { latest, min }) {
    const exact = fromDayZoom(zoom, days);
    if (zoom?.kind === "dates" && exact.kind === "custom") return { start: exact.start, end: exact.end };
    return rangeKit.resolve(exact, monthsOf(days), { latest, min, exactMonths: true });
  }
  function fromDayZoom(zoom, days) {
    if (zoom?.kind !== "dates") return zoom;
    const dates = oldestFirst(days).map((day) => day.date);
    const start = dates.findIndex((date) => date >= zoom.from);
    const end = dates.findLastIndex((date) => date <= zoom.to) + 1;
    return start >= 0 && end > start ? { kind: "custom", start, end, follow: false } : { kind: "latest" };
  }

  // การ์ดกราฟแรงบิด: หัวการ์ด (ชื่อกราฟ + วันที่เมื่อแสดงวันเดียว) + แถบช่วงวันของกราฟนี้ → ปุ่มเส้น → กราฟ
  // ปุ่มเส้นและกราฟวาดที่ lab-mdr-page.js (กราฟหลายวันอ่านจาก app_lab_mdr_curves) · วันเดียวของ feed วาดปุ่มเส้นไว้เลย
  function curveCard(days, dates, data) {
    const bar = rangeKit.toolbar({
      ids: { bar: "mdr-curve-zoom", from: "mdr-curve-month-from", to: "mdr-curve-month-to" },
      titles: { latest: "วันล่าสุดที่มีผลทดสอบ", all: "ทุกวันที่มีผลทดสอบ" },
      latestLabel: "วันล่าสุด",
      label: "ช่วงวันของกราฟแรงบิด",
    });
    const ready = dates.length === 1 && dates[0] === data.curveDate ? curveView(days, dates, data.curves) : null;
    return `<section class="card lab-chart-card lab-mdr-chart" aria-labelledby="mdr-curve-title">
        <div class="lab-mdr-chart-head">
          <h2 class="lab-mdr-chart-title" id="mdr-curve-title">กราฟแรงบิด<span class="lab-mdr-chart-when" id="mdr-curve-when">${esc(curveWhen(dates))}</span></h2>
          ${bar}
          <div class="lab-mdr-legend" id="mdr-legend" role="group" aria-label="${esc(legendLabel(dates))}">${ready?.legend ?? ""}</div>
        </div>
        <div class="lab-plot-wrap">
          <div class="lab-plot lab-mdr-plot" id="mdr-plot" tabindex="0" role="img" aria-label="${esc(plotLabel(dates))}"></div>
          <div class="lab-tip lab-mdr-tip" id="mdr-tip" hidden></div>
        </div>
        <p class="lab-mdr-trend-note" id="mdr-curve-note" aria-live="polite"></p>
        <p class="sr-only" id="mdr-curve-announce" aria-live="polite"></p>
      </section>`;
  }

  // วันที่ในหัวการ์ดเฉพาะตอนแสดงวันเดียว (หลายวัน: วันที่อยู่บนปุ่มเส้นของแต่ละวันแล้ว ไม่ซ้ำ)
  const curveWhen = (dates) => (dates.length === 1 ? ` · ${model.formatDate(dates[0])}` : "");
  const legendLabel = (dates) => (dates.length > 1 ? "แสดงหรือซ่อนเส้นของแต่ละวัน" : "แสดงหรือซ่อนเส้นของแต่ละครั้ง");
  function plotLabel(dates) {
    if (dates.length > 1) return `กราฟแรงบิด (dNm) ตามเวลา (นาที) ทุกครั้งของ ${dates.length} วัน ตั้งแต่ ${model.formatDate(dates[0])} ถึง ${model.formatDate(dates.at(-1))} สีตามวัน ชี้ที่กราฟหรือกดปุ่มลูกศรเพื่อดู t90 เฉลี่ยของแต่ละวัน`;
    return `กราฟแรงบิด (dNm) ตามเวลา (นาที) ทุกครั้งของวันที่ ${model.formatDate(dates[0] ?? "")} ชี้ที่กราฟหรือกดปุ่มลูกศรเพื่อดู t90 ของแต่ละครั้ง`;
  }

  // เส้นของกราฟแรงบิดในช่วงวัน dates (เก่า → ใหม่) · curves = [{ id, curve }] จาก feed (ทุกวินาที) หรือ app_lab_mdr_curves (step วินาทีต่อจุด)
  // วันของแต่ละเส้นมาจากผลทดสอบ (days) ไม่ใช่จากกราฟ เส้นที่ไม่มีผลทดสอบคู่ หรืออยู่นอกช่วง ไม่วาด
  // คืน { multi, series: [{ id, day, color, curve, step, t90, machineId }], legend } ลำดับเส้น = ลำดับตาราง (วันเก่าก่อนเมื่อหลายวัน)
  function curveView(days, dates, curves, step = 1) {
    const byId = new Map(curves.filter((item) => Array.isArray(item?.curve)).map((item) => [String(item.id), item.curve]));
    const multi = dates.length > 1;
    const series = [];
    const groups = [];
    dates.forEach((date, dayIndex) => {
      const tests = (days.find((day) => day.date === date)?.tests ?? []).filter((test) => byId.has(String(test.id)));
      if (!tests.length) return;
      const dayColor = lineColor(dayIndex);
      groups.push({ date, color: dayColor, count: tests.length });
      tests.forEach((test) => series.push({
        id: String(test.id), day: date, color: multi ? dayColor : lineColor(series.length), curve: byId.get(String(test.id)), step,
        t90: test.t90_s ?? null, machineId: test.machine_id ?? "", time: test.test_time ?? "",
      }));
    });
    const keys = multi
      ? groups.map((group) => `<button type="button" class="lab-mdr-key" data-day="${esc(group.date)}" aria-pressed="true" style="--line-color:${group.color}">
        <span class="lab-mdr-swatch" aria-hidden="true"></span><span>${esc(model.formatDate(group.date))}</span><small>${group.count} ครั้ง</small>
      </button>`).join("")
      : series.map((item) => `<button type="button" class="lab-mdr-key" data-test="${esc(item.id)}" aria-pressed="true" style="--line-color:${item.color}">
        <span class="lab-mdr-swatch" aria-hidden="true"></span><span>ID ${esc(item.machineId)}</span><small>${esc(item.time)}</small>
      </button>`).join("");
    return { multi, series, legend: legendHtml(keys, multi ? groups.length : series.length, multi) };
  }

  // ปุ่มเส้นเกิน 8 ปุ่ม (วันละ 15 ครั้งเป็นปกติ) กินความสูงสามแถวเหนือกราฟ: พับไว้หลังปุ่มเดียว กดแล้วกางออก (ปุ่มเปิด/ปิดของเบราว์เซอร์ ไม่ใช่ popup)
  // สีของแต่ละเส้นยังอ่านได้จากป้าย t90 ตอนชี้/แตะกราฟ
  const KEYS_OPEN_MAX = 8;
  function legendHtml(keys, count, multi) {
    if (count <= KEYS_OPEN_MAX) return keys;
    const label = multi ? "เลือกวันที่แสดงในกราฟ" : "เลือกเส้นที่แสดงในกราฟ";
    return `<button type="button" class="lab-mdr-keys-toggle" id="mdr-keys-toggle" aria-expanded="false" aria-controls="mdr-legend-keys"><span>${label}</span><small id="mdr-keys-hidden"></small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="lab-mdr-keys" id="mdr-legend-keys" hidden>${keys}</div>`;
  }

  // แถวป้ายของกราฟหลายวัน: t90 เฉลี่ยของเส้นที่แสดงอยู่ของแต่ละวัน (ครั้งที่ไม่ถึง 90% ไม่นับ) ลำดับวันเก่า → ใหม่
  function dayTipRows(series) {
    const byDay = new Map();
    series.forEach((item) => {
      if (!byDay.has(item.day)) byDay.set(item.day, { color: item.color, date: item.day, values: [] });
      if (Number.isFinite(item.t90)) byDay.get(item.day).values.push(item.t90);
    });
    return [...byDay.values()].map((row) => ({ color: row.color, date: row.date, t90: row.values.length ? Math.round(model.mean(row.values)) : null }));
  }

  // ป้ายไม่สูงเกินกราฟ (สูง 220–340px): แสดง 8 วันล่าสุดที่แสดงอยู่ ที่เหลือบอกเป็นจำนวน (ซ่อนวันด้วยปุ่มเส้นเพื่อดูวันที่เก่ากว่า)
  const TIP_DAYS = 8;
  function dayTipHtml(rows) {
    const more = Math.max(0, rows.length - TIP_DAYS);
    const items = rows.slice(more).map((row) => `<span class="lab-mdr-tip-row" style="--line-color:${row.color}"><span class="lab-mdr-swatch" aria-hidden="true"></span>${esc(model.formatDate(row.date))}<b>${esc(model.formatClock(row.t90))}</b></span>`).join("");
    return `<span class="lab-tip-when">t90 เฉลี่ย (นาที:วินาที)</span>${more ? `<span class="lab-mdr-tip-more">วันก่อนหน้าอีก ${more} วัน</span>` : ""}${items}`;
  }

  // กราฟแนวโน้มรายวัน (ทีละค่า สลับด้วยปุ่ม) + แถบช่วงวัน (lab-range.js) วาดและผูกที่ lab-mdr-page.js ด้วย trendSvg
  // การ์ดนี้เป็นมุมมองข้ามวันของทั้งสองชุด แถบของการ์ดนี้แยกจากแถบของกราฟแรงบิด (คนละการ์ด คนละช่วง)
  // condition = เงื่อนไขที่กราฟแสดง (trendCondition) · สูตรที่มีหลายเงื่อนไขมีช่องเลือกเงื่อนไข (<select> ของเบราว์เซอร์) เงื่อนไขเดียวไม่มีช่อง (บอกในตารางแล้ว)
  function trendCard(route, days, condition = null) {
    const modes = trendModes(days);
    const conditions = model.conditionsOf(days.flatMap((day) => day.tests));
    const picker = conditions.length > 1
      ? `<select class="select lab-month lab-mdr-cond" id="mdr-cond" data-native-select aria-label="เงื่อนไขการทดสอบของกราฟแนวโน้ม (เวลาทดสอบ · อุณหภูมิ)">${conditions.map((item) => `<option value="${esc(item.key)}"${item.key === condition ? " selected" : ""}>${esc(model.formatCondition(item))} (${item.n} ครั้ง)</option>`).join("")}</select>`
      : "";
    const bar = rangeKit.toolbar({
      ids: { bar: "mdr-zoom", from: "mdr-month-from", to: "mdr-month-to" },
      titles: { latest: `${TREND_DEFAULT_DAYS} วันล่าสุดที่มีผลทดสอบ`, all: "ทุกวันที่มีผลทดสอบ" },
      latestLabel: `ล่าสุด ${TREND_DEFAULT_DAYS} วัน`,
      label: "ช่วงวันของกราฟแนวโน้มและตาราง",
    });
    return `<section class="card lab-chart-card lab-mdr-trend" aria-labelledby="mdr-trend-title">
        <div class="lab-mdr-trend-head">
          <h2 class="sr-only" id="mdr-trend-title">กราฟแนวโน้มรายวัน</h2>
          <div class="lab-seg" role="group" aria-label="ค่าที่แสดงในกราฟ">${modes.map((mode, index) => `<button type="button" class="lab-seg-btn" data-trend="${mode.key}" aria-pressed="${index === 0}">${esc(mode.label)}</button>`).join("")}</div>
          ${picker}
          ${bar}
        </div>
        <div class="lab-plot lab-mdr-trend-plot" id="mdr-trend" role="img" aria-label="กราฟแนวโน้มรายวันของสูตร ${esc(route.formula)}"></div>
        <div class="lab-mdr-trend-foot">
          <p class="lab-mdr-trend-key"><span class="lab-mdr-k lab-mdr-k-dot"></span>แต่ละครั้ง<span class="lab-mdr-k lab-mdr-k-avg"></span>AVG รายวัน<span class="lab-mdr-key-band" id="mdr-band-key" hidden><span class="lab-mdr-k lab-mdr-k-band"></span><span title="AVG ± 2SD ของทุกครั้งในเงื่อนไขนี้ ไม่เปลี่ยนตามช่วงวันที่เลือก">ช่วงปกติ</span><span class="lab-mdr-k lab-mdr-k-out"></span>นอกช่วง</span></p>
          <p class="lab-mdr-trend-note" id="mdr-trend-note" aria-live="polite"></p>
        </div>
        <p class="sr-only" id="mdr-range-announce" aria-live="polite"></p>
      </section>`;
  }

  // คอลัมน์ของตาราง: ID เวลา แล้วค่าที่สรุป (และผลของเครื่องเมื่อมีครั้งที่ไม่ใช่ OK) · ts2 ของ F2 ไม่มีในไฟล์ จึงไม่แสดงคอลัมน์ที่ว่างทั้งคอลัมน์
  // curveDates = วันที่อยู่ในกราฟแรงบิดตอนนี้ (รายการ หรือวันเดียว) วันนั้นมีป้าย "ในกราฟแรงบิด" วันอื่นมีปุ่ม "ดูกราฟ"
  // เงื่อนไข (เวลาทดสอบ · อุณหภูมิ) บอกครั้งเดียวในที่ที่กว้างที่สุดที่ยังเหมือนกัน: ทั้งตาราง > ทั้งวัน (หัววัน) > กลุ่มในวัน (หัวกลุ่ม)
  // AVG/SD ต่อกลุ่มเงื่อนไขในวัน: วันที่มีสองเงื่อนไขมี AVG/SD สองชุด แต่ละชุดอยู่ใต้หัวกลุ่มของตัวเอง
  function resultsTable(partKey, days, curveDates) {
    const charted = new Set(Array.isArray(curveDates) ? curveDates : curveDates ? [curveDates] : []);
    const part = model.findPart(partKey);
    // ครั้งที่ยางไม่พองตัว: คอลัมน์ t90 คงไว้แม้ทุกครั้งไม่นับ (เห็น "–" พร้อมเหตุผล ไม่ใช่คอลัมน์หายไปเฉย ๆ)
    const noSwell = days.some((day) => day.tests.some((test) => test.no_swell));
    const metrics = model.METRICS.filter((metric) => model.hasMetric(days, metric.key) || (noSwell && metric.key === "t90_s"));
    const unit = part.unit ? ` (${part.unit})` : "";
    const conditions = model.conditionsOf(days.flatMap((day) => day.tests));
    const oneCondition = conditions.length === 1;
    const showResult = days.some((day) => day.tests.some((test) => notOk(test.result)));
    const head = `<tr><th scope="col" class="sticky">ID</th><th scope="col">เวลา</th>${metrics.map((metric) => `<th scope="col" class="num">${esc(metric.label)}${metric.kind === "time" ? " (นาที:วินาที)" : esc(unit)}</th>`).join("")}${showResult ? `<th scope="col">ผลของเครื่อง (Result)</th>` : ""}</tr>`;
    const span = 2 + metrics.length + (showResult ? 1 : 0);
    const cell = (metric, test) => {
      const value = model.metricValue(test, metric.key);
      if (test.no_swell && metric.key === "t90_s") return `<td class="num lab-mdr-unmeasured" title="${esc(NO_SWELL_NOTE)}">–<span class="sr-only"> ${esc(NO_SWELL_NOTE)}</span></td>`;
      return `<td class="num">${esc(model.formatMetric(metric, value, partKey))}</td>`;
    };
    const result = (test) => (showResult ? (notOk(test.result) ? `<td class="lab-mdr-result-bad">${esc(test.result)}</td>` : `<td class="lab-mdr-result-ok">${esc(test.result ?? "–")}</td>`) : "");
    const body = days.map((day) => {
      const shown = charted.has(day.date);
      const mixed = day.groups.length > 1;
      const dayCondition = !oneCondition && !mixed ? `<span class="lab-mdr-day-cond">${esc(model.formatCondition(day.groups[0]))}</span>` : "";
      const dayHead = `<tr class="lab-mdr-day-row${shown ? " is-shown" : ""}"><th scope="rowgroup" colspan="${span}">
          <span class="lab-mdr-day-name">${esc(model.formatDate(day.date))}</span><span class="lab-mdr-day-count">${day.tests.length} ครั้ง</span>${dayCondition}
          ${part.hasCurve ? (shown ? `<span class="lab-mdr-day-flag">ในกราฟแรงบิด</span>` : `<button type="button" class="btn secondary small" data-show-date="${esc(day.date)}">ดูกราฟ</button>`) : ""}
        </th></tr>`;
      const blocks = day.groups.map((group) => {
        const name = model.formatCondition(group);
        const sub = mixed ? `<tr class="lab-mdr-cond-row"><th colspan="${span}">${esc(name)}<span class="lab-mdr-day-count">${group.tests.length} ครั้ง</span></th></tr>` : "";
        const label = mixed ? `<span class="sr-only"> ${esc(name)}</span>` : "";
        const rows = group.tests.map((test) => `<tr><th scope="row" class="sticky">${esc(test.machine_id)}</th><td>${esc(test.test_time)}</td>${metrics.map((metric) => cell(metric, test)).join("")}${result(test)}</tr>`).join("");
        const tail = showResult ? "<td></td>" : "";
        const avg = `<tr class="lab-mdr-stat"><th scope="row" class="sticky">AVG${label}</th><td></td>${metrics.map((metric) => `<td class="num">${esc(model.formatMetric(metric, group.stats[metric.key].avg, partKey))}</td>`).join("")}${tail}</tr>`;
        const sd = `<tr class="lab-mdr-stat lab-mdr-sd"><th scope="row" class="sticky">SD${label}</th><td></td>${metrics.map((metric) => `<td class="num">${esc(model.formatSd(metric, group.stats[metric.key].sd, partKey))}</td>`).join("")}${tail}</tr>`;
        return `${sub}${rows}${avg}${sd}`;
      }).join("");
      return `<tbody>${dayHead}${blocks}</tbody>`;
    }).join("");
    const all = oneCondition ? `<p class="lab-mdr-cond-all">ทุกครั้งทดสอบ ${esc(model.formatCondition(conditions[0]))}</p>` : "";
    const swellNote = noSwell ? `<p class="lab-mdr-cond-all lab-mdr-swell-note">t90 “–” = ${esc(NO_SWELL_NOTE)} (ไม่นับใน AVG/SD กราฟ และช่วงปกติ)</p>` : "";
    return `${all}${swellNote}<table class="lab-table lab-mdr-table"><caption class="sr-only">ผล${esc(part.label)}รายครั้ง แบ่งตามวันและเงื่อนไขการทดสอบ พร้อมค่าเฉลี่ย (AVG) และส่วนเบี่ยงเบนมาตรฐาน (SD) ของแต่ละกลุ่ม</caption><thead>${head}</thead>${body}</table>`;
  }
  // ผลของเครื่องที่ควรเห็น: มีค่าและไม่ใช่ OK
  const notOk = (value) => value !== null && value !== undefined && String(value).trim() !== "" && String(value).trim().toUpperCase() !== "OK";
  const NO_SWELL_NOTE = "ยางไม่พองตัว: MH−ML น้อยกว่า 1% ของ ML หรือ t90 ถึงเวลาจบการทดสอบ";

  /* ---------- ผลการอัปโหลด ---------- */

  // summary = { added: {F1, F2}, duplicates, skipped: [{ reason, files }], failed: string|null }
  function uploadResult(summary) {
    const addedTotal = summary.added.F1 + summary.added.F2;
    const parts = model.PARTS.filter((part) => summary.added[part.key] > 0).map((part) => `${part.label} ${summary.added[part.key]}`).join(" · ");
    const skippedTotal = summary.skipped.reduce((sum, group) => sum + group.files.length, 0);
    const lines = [
      `<p class="lab-mdr-result-main"><strong>เพิ่มผลใหม่ ${addedTotal} ครั้ง</strong>${parts ? ` <span>(${esc(parts)})</span>` : ""}</p>`,
      summary.duplicates > 0 ? `<p>มีอยู่แล้ว ${summary.duplicates} ครั้ง — ไม่ได้บันทึกซ้ำ</p>` : "",
      summary.failed ? `<p class="lab-mdr-result-error">${esc(summary.failed)}</p>` : "",
    ].join("");
    const skipped = skippedTotal > 0 ? `<details class="lab-mdr-skipped"><summary>ข้าม ${skippedTotal} ไฟล์</summary><ul>${summary.skipped.map((group) => `<li><strong>${esc(group.reason)}</strong> · ${group.files.length} ไฟล์<small>${group.files.slice(0, 30).map(esc).join(", ")}${group.files.length > 30 ? ` และอีก ${group.files.length - 30} ไฟล์` : ""}</small></li>`).join("")}</ul></details>` : "";
    return `<div class="lab-mdr-result-body">${lines}${skipped}</div><button type="button" class="btn secondary small lab-mdr-result-close" id="mdr-result-close" aria-label="ปิดผลการอัปโหลด">ปิด</button>`;
  }

  function uploadProgress(done, total) {
    return `<div class="lab-mdr-result-body"><p class="lab-mdr-result-main"><strong>กำลังอัปโหลด ${done}/${total} ครั้ง…</strong></p><progress max="${total}" value="${done}"></progress></div>`;
  }

  /* ---------- กราฟแนวโน้มรายวัน (F1 และ F2) ---------- */

  // โหมดของกราฟแนวโน้ม: ทีละค่า เพราะ MH−ML (หลักหมื่น) กับ t90 (นาที) ใช้แกนเดียวกันไม่ได้ · แสดงเฉพาะค่าที่สูตรนั้นมี (F2 ไม่มี ts2)
  const TREND_MODES = Object.freeze([
    Object.freeze({ key: "delta", label: "MH−ML" }),
    Object.freeze({ key: "ts2_s", label: "ts2" }),
    Object.freeze({ key: "t90_s", label: "t90" }),
  ]);
  const trendModes = (days) => {
    const present = TREND_MODES.filter((mode) => model.hasMetric(days, mode.key));
    return present.length ? present : TREND_MODES.slice(0, 1);
  };

  /* ---------- ช่วงวันของกราฟแนวโน้ม ---------- */
  // หน่วยของช่วง = วันที่มีผลทดสอบ (ไม่ใช่วันปฏิทิน) เรียงเก่า → ใหม่ · เริ่มที่ 30 วันล่าสุด (สูตรที่ทดสอบบ่อยมีราว 16 วันต่อเดือน) ซูมเข้าได้ถึง 3 วัน
  // zoom = { kind: "latest" | "all" } | { kind: "months", from, to } | { kind: "custom", start, end, follow } (ความหมายเดียวกับกราฟ Mooney)
  const TREND_DEFAULT_DAYS = 30;
  const TREND_MIN_DAYS = 3;
  const oldestFirst = (days) => [...days].reverse();
  // เลือกเดือน = เฉพาะวันของเดือนนั้นจริง แม้น้อยกว่า 3 วัน (exactMonths) · 3 วันจำกัดแค่การซูมเข้าด้วยปุ่ม +
  const trendRange = (zoom, days) => resolveRange(zoom, days, { latest: TREND_DEFAULT_DAYS, min: TREND_MIN_DAYS });
  // วันในช่วง เรียงแบบเดียวกับ days (ล่าสุดก่อน) สำหรับตาราง
  const rangeDays = (days, range) => oldestFirst(oldestFirst(days).slice(range.start, range.end));
  const formatMonth = (month) => model.formatDate(`${month}-01`).replace(/^\d+ /, "");
  // ข้อความสำหรับโปรแกรมอ่านหน้าจอเมื่อช่วงเปลี่ยน (ข้อความล้วน)
  function rangeAnnouncement(days, range) {
    const shown = oldestFirst(days).slice(range.start, range.end);
    if (!shown.length) return "";
    return `แสดง ${model.formatDate(shown[0].date)} ถึง ${model.formatDate(shown.at(-1).date)} ${shown.length} จาก ${days.length} วันที่ทดสอบ`;
  }

  // days = model.groupByDate (ล่าสุดก่อน) → กราฟเรียงเก่าไปใหม่ซ้ายไปขวา หนึ่งจุดต่อครั้ง เส้น AVG ต่อวัน · range = ช่วงวันที่วาด (ไม่ระบุ = ทุกวัน)
  // condition = model.conditionKey ของครั้งที่นำมาวาด (ไม่ระบุ = ทุกครั้ง) · ผลต่างเวลาทดสอบ/อุณหภูมิไม่เฉลี่ยรวมกัน
  // แถบ = AVG ± 2SD ของทุกครั้งของสูตรในเงื่อนไขนั้น ไม่ขึ้นกับช่วงที่วาด (สถิติจากประวัติ ไม่ใช่สเปก) ต้องมีอย่างน้อย model.MIN_BAND_TESTS ครั้ง
  // จุดนอกแถบเป็นสามเหลี่ยมสีแดง · คืน { svg, note, height, hasBand }
  function trendSvg(days, metricKey, width, partKey, range = null, condition = null) {
    const metric = model.METRICS.find((item) => item.key === metricKey);
    const kept = (test) => !condition || model.conditionKey(test) === condition;
    const withValues = (list) => list.map((day) => ({ date: day.date, points: day.tests.filter(kept).map((test) => ({ test, value: model.metricValue(test, metricKey) })).filter((point) => point.value !== null) }))
      .filter((day) => day.points.length);
    const ordered = oldestFirst(days);
    const all = withValues(ordered);
    const series = range ? withValues(ordered.slice(range.start, range.end)) : all;
    // เตี้ยกว่ากราฟแรงบิด: ตารางผลรายครั้งใต้กราฟนี้ต้องเลื่อนถึงได้ไม่ไกล
    const height = Math.round(Math.min(280, Math.max(180, width * 0.28)));
    // note = ข้อความใต้กราฟ (ช่วงปกติ หรือเหตุที่ไม่มี) อยู่นอก role="img" ของกราฟ โปรแกรมอ่านหน้าจอจึงอ่านได้
    if (!all.length) return { svg: "", note: `ไม่มีค่า ${metric.label} ในผล${condition ? "ของเงื่อนไขนี้" : "ของสูตรนี้"}`, height, hasBand: false };
    if (!series.length) return { svg: "", note: `ไม่มีค่า ${metric.label} ในช่วงวันที่เลือก`, height, hasBand: false };
    const bandValues = all.flatMap((day) => day.points.map((point) => point.value));
    const values = series.flatMap((day) => day.points.map((point) => point.value));
    const average = model.mean(bandValues);
    const spread = model.sampleSd(bandValues) ?? 0;
    // ช่วงปกติต้องมีผลพอ (3 ครั้งของวันเดียวให้ช่วงแคบจนดูเหมือนสเปก) และค่าต่างกัน · ทุกค่าที่แสดง (MH−ML, ts2, t90) ติดลบไม่ได้ ขอบล่างจึงไม่ต่ำกว่า 0
    const enough = bandValues.length >= model.MIN_BAND_TESTS;
    const hasBand = enough && spread > 0;
    const low = hasBand ? Math.max(0, average - 2 * spread) : average;
    const high = hasBand ? average + 2 * spread : average;
    const isOut = (value) => hasBand && (value < low || value > high);
    const pad = { left: 62, right: 16, top: 16, bottom: 34 };
    const plotW = Math.max(120, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;
    const min = Math.min(low, ...values);
    const max = Math.max(high, ...values);
    // เวลา: ขั้นแกนเป็นวินาทีที่อ่านง่าย (15 วิ, 30 วิ, 1 นาที, …) แทนตัวเลขกลม ๆ ของฐานสิบ
    const step = metric.kind === "time"
      ? [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].find((candidate) => (max - min) / candidate <= 6) ?? 3600
      : niceStep(max - min || 1, 5);
    const yMin = Math.max(0, Math.floor(min / step) * step);
    const yMax = Math.ceil(max / step) * step;
    const slot = plotW / series.length;
    const x = (index) => pad.left + slot * (index + 0.5);
    const y = (value) => pad.top + plotH - ((value - yMin) / (yMax - yMin || 1)) * plotH;
    const label = (value) => model.formatMetric(metric, value, partKey);
    const parts = [];
    for (let value = yMin; value <= yMax + step / 1000; value += step) {
      parts.push(`<line class="lab-grid" x1="${pad.left}" x2="${pad.left + plotW}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/><text class="lab-tick" x="${pad.left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${esc(label(value))}</text>`);
    }
    if (hasBand) parts.push(`<rect class="lab-mdr-band" x="${pad.left}" width="${plotW}" y="${y(high).toFixed(1)}" height="${Math.max(0, y(low) - y(high)).toFixed(1)}"/>`);
    // ป้ายวันที่: จอแคบหรือหลายวัน แสดงทุก n วัน นับถอยจากวันล่าสุด (วันล่าสุดมีป้ายเสมอ และไม่มีป้ายสองอันชิดกัน)
    const every = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(plotW / 70))));
    series.forEach((day, index) => {
      if ((series.length - 1 - index) % every === 0) parts.push(`<text class="lab-tick" x="${x(index).toFixed(1)}" y="${pad.top + plotH + 20}" text-anchor="middle">${esc(model.formatDate(day.date).replace(/ \d{4}$/, ""))}</text>`);
    });
    const avgPoints = series.map((day, index) => ({ cx: x(index), cy: y(model.mean(day.points.map((point) => point.value))), day }));
    parts.push(`<path class="lab-mdr-avg" d="${avgPoints.map((point, index) => `${index ? "L" : "M"}${point.cx.toFixed(1)} ${point.cy.toFixed(1)}`).join("")}"/>`);
    const spreadX = Math.min(slot * 0.32, 18);
    series.forEach((day, index) => {
      day.points.forEach((point, at) => {
        const offset = day.points.length > 1 ? (at / (day.points.length - 1) - 0.5) * 2 * spreadX : 0;
        const cx = x(index) + offset;
        const cy = y(point.value);
        const out = isOut(point.value);
        const tip = `${model.formatDate(day.date)} · ID ${point.test.machine_id} ${point.test.test_time} · ${metric.label} ${label(point.value)}${out ? " (นอกช่วงปกติ)" : ""}`;
        parts.push(out
          ? `<path class="lab-mdr-dot is-out" d="M${cx.toFixed(1)} ${(cy - 5).toFixed(1)}l5 9h-10z"><title>${esc(tip)}</title></path>`
          : `<circle class="lab-mdr-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4"><title>${esc(tip)}</title></circle>`);
      });
    });
    avgPoints.forEach((point) => parts.push(`<circle class="lab-mdr-avg-pt" cx="${point.cx.toFixed(1)}" cy="${point.cy.toFixed(1)}" r="5"><title>${esc(`${model.formatDate(point.day.date)} · AVG ${metric.label} ${label(model.mean(point.day.points.map((item) => item.value)))} (${point.day.points.length} ครั้ง)`)}</title></circle>`));
    const svg = `<svg class="lab-svg lab-mdr-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join("")}</svg>`;
    const n = bandValues.length;
    const note = hasBand ? `ช่วงปกติ ${metric.label} ${label(low)} – ${label(high)} (AVG ± 2SD จาก ${n} ครั้ง)`
      : enough ? `ยังคำนวณช่วงปกติไม่ได้: ทั้ง ${n} ครั้งได้ ${metric.label} เท่ากัน`
        : `ยังไม่มีช่วงปกติ: มีผล ${metric.label} ${n} ครั้ง ต้องมีอย่างน้อย ${model.MIN_BAND_TESTS} ครั้ง`;
    return { svg, note, height, hasBand };
  }

  /* ---------- กราฟแรงบิด ---------- */

  function niceStep(span, ticks) {
    const raw = span / Math.max(1, ticks);
    const power = 10 ** Math.floor(Math.log10(raw));
    const scaled = raw / power;
    return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
  }

  // series = [{ id, day?, color, curve, step?, t90 }] · step = วินาทีต่อจุดของ curve (ไม่ระบุ = 1; กราฟหลายวันจากฐานข้อมูล = 5)
  // width = ความกว้างพื้นที่กราฟ (px) · คืน { svg, geometry } ให้ตัวชี้ค่าใช้ตำแหน่งเดียวกัน
  function chartSvg(series, width) {
    const height = Math.round(Math.min(340, Math.max(240, width * 0.38)));
    const pad = { left: 46, right: 14, top: 22, bottom: 34 };
    const plotW = Math.max(120, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;
    const every = (item) => (Number(item.step) >= 1 ? Number(item.step) : 1);
    const seconds = Math.max(60, ...series.map((item) => (item.curve.length - 1) * every(item)));
    const peak = Math.max(1, ...series.map((item) => Math.max(...item.curve)));
    const yStep = niceStep(peak, 5);
    const yMax = Math.ceil((peak * 1.04) / yStep) * yStep;
    const minutes = seconds / 60;
    const xStep = niceStep(minutes, Math.max(3, Math.floor(plotW / 90)));
    const x = (second) => pad.left + (second / seconds) * plotW;
    const y = (torque) => pad.top + plotH - (Math.max(0, torque) / yMax) * plotH;
    const grid = [];
    for (let value = 0; value <= yMax + 1e-9; value += yStep) {
      grid.push(`<line class="lab-grid" x1="${pad.left}" x2="${pad.left + plotW}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/><text class="lab-tick" x="${pad.left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${+value.toFixed(2)}</text>`);
    }
    for (let value = 0; value <= minutes + 1e-9; value += xStep) {
      grid.push(`<line class="lab-grid" y1="${pad.top}" y2="${pad.top + plotH}" x1="${x(value * 60).toFixed(1)}" x2="${x(value * 60).toFixed(1)}"/><text class="lab-tick" y="${pad.top + plotH + 18}" x="${x(value * 60).toFixed(1)}" text-anchor="middle">${+value.toFixed(2)}</text>`);
    }
    // จุดต่อพิกเซลไม่เกิน ~2 จุด: กราฟ 120 นาทียังวาดเร็ว ส่วนกราฟ 30 นาทีวันเดียวใช้ทุกวินาที
    const lines = series.map((item) => {
      const gap = every(item);
      const stride = Math.max(1, Math.floor(seconds / gap / (plotW * 2)));
      let path = "";
      for (let index = 0; index < item.curve.length; index += stride) path += `${index ? "L" : "M"}${x(index * gap).toFixed(1)} ${y(item.curve[index]).toFixed(1)}`;
      const last = item.curve.length - 1;
      if (last % stride) path += `L${x(last * gap).toFixed(1)} ${y(item.curve[last]).toFixed(1)}`;
      // t90 บนกราฟที่สุ่มทุก step วินาที: จุดที่ใกล้ t90 ที่สุด
      const at = Number.isInteger(item.t90) ? Math.round(item.t90 / gap) : -1;
      const mark = at >= 0 && at < item.curve.length
        ? `<circle class="lab-mdr-t90" cx="${x(at * gap).toFixed(1)}" cy="${y(item.curve[at]).toFixed(1)}" r="3.5"/>` : "";
      return `<g class="lab-mdr-line" data-test="${esc(item.id)}"${item.day ? ` data-day="${esc(item.day)}"` : ""} style="--line-color:${item.color}"><path d="${path}"/>${mark}</g>`;
    }).join("");
    const svg = `<svg class="lab-svg lab-mdr-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      ${grid.join("")}
      <line class="lab-axis" x1="${pad.left}" x2="${pad.left + plotW}" y1="${pad.top + plotH}" y2="${pad.top + plotH}"/>
      <text class="lab-tick lab-mdr-axis-name" x="${pad.left + plotW}" y="${height - 2}" text-anchor="end">นาที</text>
      <text class="lab-tick lab-mdr-axis-name" x="${pad.left - 8}" y="${pad.top - 10}" text-anchor="end">dNm</text>
      ${lines}
    </svg>`;
    return { svg, geometry: { width, height, left: pad.left, plotW, seconds } };
  }

  // ป้ายตอนชี้กราฟ: t90 ของแต่ละครั้งที่แสดงอยู่ (ผู้ใช้ขอ 2026-11-23) ไม่ขึ้นกับตำแหน่งที่ชี้ จึงไม่มีเส้นตั้งและเวลาที่ชี้
  // rows = [{ color, machineId, t90 }] · t90 = วินาที หรือ null (ไม่ถึง 90% ภายในเวลาทดสอบ)
  // ป้ายไม่สูงเกินกราฟ (สูงอย่างน้อย 240px): เกิน TIP_ROWS แถว (วันละ 15 ครั้ง) เรียงเป็นหลายคอลัมน์ เรียงลงก่อนแล้วขึ้นคอลัมน์ใหม่
  const TIP_ROWS = 8;
  function tipHtml(rows) {
    const items = rows.map((row) => `<span class="lab-mdr-tip-row" style="--line-color:${row.color}"><span class="lab-mdr-swatch" aria-hidden="true"></span>ID ${esc(row.machineId)}<b>${esc(model.formatClock(row.t90))}</b></span>`).join("");
    const perColumn = Math.ceil(rows.length / Math.max(1, Math.ceil(rows.length / TIP_ROWS)));
    return `<span class="lab-tip-when">t90 (นาที:วินาที)</span><span class="lab-mdr-tip-rows" style="--tip-rows:${perColumn}">${items}</span>`;
  }

  const api = {
    LINE_COLORS, TREND_MODES, TREND_DEFAULT_DAYS, TREND_MIN_DAYS, trendModes, trendRange, trendCondition, rangeDays, formatMonth, rangeAnnouncement, trendCard, trendSvg, lineColor,
    CURVE_DEFAULT_DAYS, CURVE_MIN_DAYS, KEYS_OPEN_MAX, TIP_ROWS, curveRange, curveRangeDates, curveZoomFor, toDayZoom, fromDayZoom, curveView, legendHtml, curveWhen, legendLabel, plotLabel, dayTipRows, dayTipHtml,
    page, partTabs, overview, formulaBody, resultsTable, uploadResult, uploadProgress, chartSvg, tipHtml, niceStep,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_MDR_VIEWS = api;
})(typeof window !== "undefined" ? window : globalThis);
