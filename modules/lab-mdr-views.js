// รายงานทดสอบ MDR ของ MNP LAB — HTML ของหน้า ตาราง ผลการอัปโหลด และกราฟแรงบิด (SVG) ข้อความล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-mdr-views.test.mjs · ข้อมูล/สถิติอยู่ที่ lab-mdr-model.js · การเชื่อมต่อ/เหตุการณ์อยู่ที่ lab-mdr-page.js
//
// หน้าเดียวต่อชุดทดสอบ (#/lab?module=mdr&part=F1|F2): หัวโมดูลสี + ปุ่มอัปโหลด → แท็บชุดทดสอบ → รายการสูตร หรือหน้าสูตร
// หน้าสูตร: กราฟแรงบิดของวันที่เลือกซ้อนกันทุกครั้ง (F1 เท่านั้น เหมือนหน้าจอเครื่อง) แล้วตารางผลทุกครั้งแบ่งตามวัน มีแถว AVG และ SD ใต้แต่ละวัน
// ค่า AVG/SD อยู่ในตารางที่เดียว (ไม่ซ้ำในหัวกราฟหรือสรุปแยก) กราฟไม่แสดงอุณหภูมิแม่พิมพ์ (T1/T2)
(function (root) {
  // โหลดหลัง lab-mdr-model.js และ lab-sections.js (index.html) · เทสต์ใน Node ตั้งสองตัวนี้บน globalThis ก่อน require ไฟล์นี้
  const model = root.MNP_LAB_MDR;
  const sections = root.MNP_LAB_SECTIONS;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // สีเส้นของแต่ละครั้งในวันเดียวกัน (ข้อมูลจริงมีถึง 15 ครั้งต่อวัน) สว่างพอบนพื้นกราฟสีเข้ม และเรียงให้สีติดกันต่างกันชัด
  const LINE_COLORS = Object.freeze(["#4ea8ff", "#ff8a3d", "#3ddc97", "#ff5c8a", "#ffd23f", "#b48cff", "#2ee6e6", "#ff6b4a", "#9be15d", "#f78fe0", "#7aa2ff", "#e6b35c", "#c9d4e3", "#00c2a8", "#ff9fb3", "#a3e635"]);
  const lineColor = (index) => LINE_COLORS[index % LINE_COLORS.length];

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

  // หัวหน้าสูตร: ตัวเลือกสูตร (ชื่อสูตรแสดงที่นี่ที่เดียว) · F1 มีตัวเลือกวันของกราฟ
  function formulaHead(route, formulas, days, curveDate) {
    const part = model.findPart(route.part);
    const dateOptions = days.map((day) => `<option value="${esc(day.date)}"${day.date === curveDate ? " selected" : ""}>${esc(model.formatDate(day.date))}</option>`).join("");
    return `<div class="lab-head lab-mdr-head">
      <h2 class="lab-title"><label class="sr-only" for="mdr-formula">สูตร</label><select class="lab-title-select" id="mdr-formula">${formulaSelect(formulas, route.formula)}</select></h2>
      ${part.hasCurve && days.length ? `<label class="lab-mdr-day" for="mdr-date"><span>กราฟวันที่</span><select class="select" id="mdr-date" aria-label="วันที่ของกราฟ">${dateOptions}</select></label>` : ""}
    </div>`;
  }

  function formulaBody(route, data) {
    const part = model.findPart(route.part);
    const days = model.groupByDate(data.tests);
    if (!days.length) {
      return `${formulaHead(route, data.formulas, days, null)}<section class="card">${sections.emptyBlock(`ไม่พบผล${part.label}ของสูตร “${route.formula}”`)}</section>`;
    }
    const curveDay = days.find((day) => day.date === data.curveDate) ?? null;
    const chartCard = part.hasCurve && curveDay ? `<section class="card lab-chart-card lab-mdr-chart" aria-label="กราฟแรงบิดของวันที่ ${esc(model.formatDate(curveDay.date))}">
        <div class="lab-mdr-legend" id="mdr-legend" role="group" aria-label="แสดงหรือซ่อนเส้นของแต่ละครั้ง">${legend(curveDay.tests, data.curves)}</div>
        <div class="lab-plot-wrap">
          <div class="lab-plot lab-mdr-plot" id="mdr-plot" tabindex="0" role="img" aria-label="กราฟแรงบิด (dNm) ตามเวลา (นาที) ทุกครั้งของวันที่ ${esc(model.formatDate(curveDay.date))} ชี้ที่กราฟหรือกดปุ่มลูกศรเพื่อดู t90 ของแต่ละครั้ง"></div>
          <div class="lab-tip lab-mdr-tip" id="mdr-tip" hidden></div>
        </div>
      </section>` : "";
    // F2 ไม่มีกราฟแรงบิด: กราฟแนวโน้มรายวันแทน (ทีละค่า สลับ MH−ML / t90) วาดที่ lab-mdr-page.js ด้วย trendSvg
    const trendCard = part.hasCurve ? "" : `<section class="card lab-chart-card lab-mdr-trend" aria-labelledby="mdr-trend-title">
        <div class="lab-mdr-trend-head">
          <h2 class="sr-only" id="mdr-trend-title">กราฟแนวโน้มรายวัน</h2>
          <div class="lab-seg" role="group" aria-label="ค่าที่แสดงในกราฟ">${TREND_MODES.map((mode, index) => `<button type="button" class="lab-seg-btn" data-trend="${mode.key}" aria-pressed="${index === 0}">${esc(mode.label)}</button>`).join("")}</div>
          <p class="lab-mdr-trend-key"><span class="lab-mdr-k lab-mdr-k-dot"></span>แต่ละครั้ง<span class="lab-mdr-k lab-mdr-k-avg"></span>AVG รายวัน<span class="lab-mdr-k lab-mdr-k-band"></span>ช่วงปกติของสูตร (AVG ± 2SD ทุกครั้ง)<span class="lab-mdr-k lab-mdr-k-out"></span>นอกช่วง</p>
        </div>
        <div class="lab-plot lab-mdr-trend-plot" id="mdr-trend" role="img" aria-label="กราฟแนวโน้มรายวันของสูตร ${esc(route.formula)}"></div>
        <p class="lab-mdr-trend-note" id="mdr-trend-note" aria-live="polite"></p>
      </section>`;
    return `${formulaHead(route, data.formulas, days, curveDay?.date ?? null)}
      ${chartCard}${trendCard}
      <section class="card flush lab-results-card" aria-labelledby="mdr-table-title">
        <div class="card-heading"><div class="lab-table-head"><h2 id="mdr-table-title">ผลทดสอบรายครั้ง</h2></div></div>
        <div class="lab-table-scroll lab-mdr-scroll" tabindex="0" role="region" aria-labelledby="mdr-table-title">${resultsTable(route.part, days, curveDay?.date ?? null)}</div>
      </section>`;
  }

  // ปุ่มเส้นของแต่ละครั้ง: สีเดียวกับเส้น กดเพื่อซ่อน/แสดง ชี้เพื่อเน้นเส้นนั้น
  // สีของแต่ละครั้งตัดสินที่นี่ที่เดียว (ลำดับเดียวกับตาราง) ทั้งปุ่มเส้นและเส้นกราฟใช้ map นี้ สีจึงไม่สลับกันแม้ลำดับจากฐานข้อมูลต่าง
  function colorMap(tests, curves) {
    const withCurve = new Set(curves.map((item) => String(item.id)));
    return new Map(tests.filter((test) => withCurve.has(String(test.id))).map((test, index) => [String(test.id), lineColor(index)]));
  }

  function legend(tests, curves) {
    const colors = colorMap(tests, curves);
    return tests.filter((test) => colors.has(String(test.id))).map((test) => `<button type="button" class="lab-mdr-key" data-test="${esc(test.id)}" aria-pressed="true" style="--line-color:${colors.get(String(test.id))}">
        <span class="lab-mdr-swatch" aria-hidden="true"></span><span>ID ${esc(test.machine_id)}</span><small>${esc(test.test_time)}</small>
      </button>`).join("");
  }

  // คอลัมน์ของตาราง: ID เวลา อุณหภูมิ แล้วค่าที่สรุป · ts2 ของ F2 ไม่มีในไฟล์ จึงไม่แสดงคอลัมน์ที่ว่างทั้งคอลัมน์
  function resultsTable(partKey, days, curveDate) {
    const part = model.findPart(partKey);
    const metrics = model.METRICS.filter((metric) => days.some((day) => day.stats[metric.key].n > 0));
    const unit = part.unit ? ` (${part.unit})` : "";
    const head = `<tr><th scope="col" class="sticky">ID</th><th scope="col">เวลา</th><th scope="col" class="num">อุณหภูมิ (°C)</th>${metrics.map((metric) => `<th scope="col" class="num">${esc(metric.label)}${metric.kind === "time" ? " (นาที:วินาที)" : esc(unit)}</th>`).join("")}</tr>`;
    const span = 3 + metrics.length;
    const body = days.map((day) => {
      const shown = day.date === curveDate;
      const group = `<tr class="lab-mdr-day-row${shown ? " is-shown" : ""}"><th scope="rowgroup" colspan="${span}">
          <span class="lab-mdr-day-name">${esc(model.formatDate(day.date))}</span><span class="lab-mdr-day-count">${day.tests.length} ครั้ง</span>
          ${part.hasCurve ? (shown ? `<span class="lab-mdr-day-flag">กราฟด้านบน</span>` : `<button type="button" class="btn secondary small" data-show-date="${esc(day.date)}">ดูกราฟ</button>`) : ""}
        </th></tr>`;
      const rows = day.tests.map((test) => `<tr><th scope="row" class="sticky">${esc(test.machine_id)}</th><td>${esc(test.test_time)}</td><td class="num">${esc(test.temperature_c ?? "–")}</td>${metrics.map((metric) => `<td class="num">${esc(model.formatMetric(metric, model.metricValue(test, metric.key), partKey))}</td>`).join("")}</tr>`).join("");
      const avg = `<tr class="lab-mdr-stat"><th scope="row" class="sticky">AVG</th><td colspan="2"></td>${metrics.map((metric) => `<td class="num">${esc(model.formatMetric(metric, day.stats[metric.key].avg, partKey))}</td>`).join("")}</tr>`;
      const sd = `<tr class="lab-mdr-stat lab-mdr-sd"><th scope="row" class="sticky">SD</th><td colspan="2"></td>${metrics.map((metric) => `<td class="num">${esc(model.formatSd(metric, day.stats[metric.key].sd, partKey))}</td>`).join("")}</tr>`;
      return `<tbody>${group}${rows}${avg}${sd}</tbody>`;
    }).join("");
    return `<table class="lab-table lab-mdr-table"><caption class="sr-only">ผล${esc(part.label)}รายครั้ง แบ่งตามวัน พร้อมค่าเฉลี่ย (AVG) และส่วนเบี่ยงเบนมาตรฐาน (SD) ของแต่ละวัน</caption><thead>${head}</thead>${body}</table>`;
  }

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

  /* ---------- กราฟแนวโน้มรายวัน (F2) ---------- */

  // โหมดของกราฟแนวโน้ม: ทีละค่า เพราะ MH−ML (หลักหมื่น) กับ t90 (นาที) ใช้แกนเดียวกันไม่ได้
  const TREND_MODES = Object.freeze([
    Object.freeze({ key: "delta", label: "MH−ML" }),
    Object.freeze({ key: "t90_s", label: "t90" }),
  ]);

  // days = model.groupByDate (ล่าสุดก่อน) → กราฟเรียงเก่าไปใหม่ซ้ายไปขวา หนึ่งจุดต่อครั้ง เส้น AVG ต่อวัน
  // แถบ = AVG ± 2SD ของทุกครั้งของสูตร (สถิติจากประวัติ ไม่ใช่สเปก) จุดนอกแถบเป็นสามเหลี่ยมสีแดง
  function trendSvg(days, metricKey, width, partKey) {
    const metric = model.METRICS.find((item) => item.key === metricKey);
    const series = [...days].reverse().map((day) => ({ date: day.date, points: day.tests.map((test) => ({ test, value: model.metricValue(test, metricKey) })).filter((point) => point.value !== null) }))
      .filter((day) => day.points.length);
    const height = Math.round(Math.min(320, Math.max(220, width * 0.34)));
    // note = ข้อความใต้กราฟ (ช่วงปกติ หรือเหตุที่ไม่มี) อยู่นอก role="img" ของกราฟ โปรแกรมอ่านหน้าจอจึงอ่านได้
    if (!series.length) return { svg: "", note: `ไม่มีค่า ${metric.label} ในผลของสูตรนี้`, height };
    const values = series.flatMap((day) => day.points.map((point) => point.value));
    const average = model.mean(values);
    const spread = model.sampleSd(values) ?? 0;
    // ช่วงปกติต้องมีอย่างน้อย 2 ครั้งที่ค่าต่างกัน · ทุกค่าที่แสดง (MH−ML, t90) ติดลบไม่ได้ ขอบล่างจึงไม่ต่ำกว่า 0
    const hasBand = values.length >= 2 && spread > 0;
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
    const note = hasBand ? `ช่วงปกติ ${metric.label} ${label(low)} – ${label(high)}` : "ยังคำนวณช่วงปกติไม่ได้ (ต้องมีอย่างน้อย 2 ครั้งที่ค่าต่างกัน)";
    return { svg, note, height };
  }

  /* ---------- กราฟแรงบิด ---------- */

  function niceStep(span, ticks) {
    const raw = span / Math.max(1, ticks);
    const power = 10 ** Math.floor(Math.log10(raw));
    const scaled = raw / power;
    return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
  }

  // series = [{ id, color, curve, t90 }] · width = ความกว้างพื้นที่กราฟ (px) · คืน { svg, geometry } ให้ตัวชี้ค่าใช้ตำแหน่งเดียวกัน
  function chartSvg(series, width) {
    const height = Math.round(Math.min(340, Math.max(240, width * 0.38)));
    const pad = { left: 46, right: 14, top: 22, bottom: 34 };
    const plotW = Math.max(120, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;
    const seconds = Math.max(60, ...series.map((item) => item.curve.length - 1));
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
    // จุดต่อพิกเซลไม่เกิน ~2 จุด: กราฟ 120 นาทียังวาดเร็ว ส่วนกราฟ 30 นาทีใช้ทุกวินาที
    const step = Math.max(1, Math.floor(seconds / (plotW * 2)));
    const lines = series.map((item) => {
      let path = "";
      for (let second = 0; second < item.curve.length; second += step) path += `${second ? "L" : "M"}${x(second).toFixed(1)} ${y(item.curve[second]).toFixed(1)}`;
      const last = item.curve.length - 1;
      if (last % step) path += `L${x(last).toFixed(1)} ${y(item.curve[last]).toFixed(1)}`;
      const mark = Number.isInteger(item.t90) && item.t90 < item.curve.length
        ? `<circle class="lab-mdr-t90" cx="${x(item.t90).toFixed(1)}" cy="${y(item.curve[item.t90]).toFixed(1)}" r="3.5"/>` : "";
      return `<g class="lab-mdr-line" data-test="${esc(item.id)}" style="--line-color:${item.color}"><path d="${path}"/>${mark}</g>`;
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
  function tipHtml(rows) {
    const items = rows.map((row) => `<span class="lab-mdr-tip-row" style="--line-color:${row.color}"><span class="lab-mdr-swatch" aria-hidden="true"></span>ID ${esc(row.machineId)}<b>${esc(model.formatClock(row.t90))}</b></span>`).join("");
    return `<span class="lab-tip-when">t90 (นาที:วินาที)</span>${items}`;
  }

  const api = { LINE_COLORS, TREND_MODES, trendSvg, lineColor, colorMap, page, partTabs, overview, formulaBody, resultsTable, legend, uploadResult, uploadProgress, chartSvg, tipHtml, niceStep };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_MDR_VIEWS = api;
})(typeof window !== "undefined" ? window : globalThis);
