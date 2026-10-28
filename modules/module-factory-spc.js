// SPC / Cpk ของค่าพารามิเตอร์ที่บันทึกตอนปิดขั้นใบงาน (ฝ่ายโรงงาน โหมดทดสอบ) — อ่านอย่างเดียว
//
// view "spc" ของรายการ คุณภาพ › SPC / Cpk ในเมนูโรงงาน (modules/factory-item-master.js) เลือกค่าที่ติดตามด้วย ?ch=<routing>:<ขั้น>:<รหัส>
// (ค่าไม่รู้จัก = ชุดแรก) หน้าแสดง Cpk · Cp/Ppk · ค่าเฉลี่ย/σ · จำนวนค่า, I-chart (USL/LSL, UCL/LCL, X̄),
// ฮิสโตแกรมเทียบสเปก และตารางค่าที่หลุดสเปกพร้อมลิงก์ไปใบงาน ค่าของแต่ละจุดอยู่ใน <title> (tooltip เมื่อชี้)
// ข้อมูลมาจาก app_factory_master_data ชุดเดียวกับหน้าอื่น ตรรกะ/สถิติอยู่ที่ modules/factory-spc-model.js (มีเทสต์)
// ไม่มีการเขียนข้อมูลและไม่ใช่การควบคุมสิทธิ์ · dropdown เป็น <select> ของเบราว์เซอร์ (แตะบน iPhone ได้ ไม่มี popup ลอย)
//
// โหลดหลัง modules/lab-mooney-model.js, modules/factory-spc-model.js และ modules/module-factory-master.js ก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (escapeHtml, formatDate) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactorySpcView() {
  const model = window.MNP_FACTORY_SPC_MODEL;
  const lab = window.MNP_LAB_MOONEY;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { loadData, notice, options } = window.MNP_FACTORY_UI;

  const ENTRY = "quality-spc";
  const value = (number) => (number === null || number === undefined ? "—" : Number(number).toLocaleString("en-US", { maximumFractionDigits: 4 }));
  const index = (number) => (number === null || number === undefined ? "—" : Number(number).toFixed(2));
  const n2 = (number) => String(Math.round(number * 100) / 100);
  const jobUrl = (id) => menu.url("job-view", { jb: id });

  // I-chart: ค่าตามลำดับเวลา จุดนอกสเปก = ข้าวหลามตัด จุดนอกเส้นควบคุม (แต่ในสเปก) = สี่เหลี่ยม นอกนั้นวงกลม จึงแยกได้แม้ไม่เห็นสี
  function controlChart(group, stats) {
    const W = 720;
    const box = { left: 52, right: 74, top: 12, height: 190, bottom: 26 };
    const plotWidth = W - box.left - box.right;
    const values = group.points.map((point) => point.value);
    const marks = [stats.ucl, stats.lcl, group.spec.min, group.spec.max].filter((mark) => mark !== null);
    const scale = lab.niceScale(Math.min(stats.min, ...marks), Math.max(stats.max, ...marks), 5);
    const x = (position) => box.left + (values.length === 1 ? plotWidth / 2 : (position / (values.length - 1)) * plotWidth);
    const y = (number) => box.top + (1 - (number - scale.min) / (scale.max - scale.min)) * box.height;
    const right = box.left + plotWidth;
    // เส้นอ้างอิงด้านขวา: ป้ายที่ค่าใกล้กัน (เช่น USL กับ UCL) ถูกดันห่างกันอย่างน้อย LABEL_GAP เพื่อไม่ให้ทับกัน
    const LABEL_GAP = 13;
    const refs = [[group.spec.max, `USL ${value(group.spec.max)}`, "spec"], [stats.ucl, `UCL ${value(stats.ucl)}`, "limit"],
      [stats.n > 1 ? stats.mean : null, "X̄", "center"], [stats.lcl, `LCL ${value(stats.lcl)}`, "limit"], [group.spec.min, `LSL ${value(group.spec.min)}`, "spec"]]
      .filter(([number]) => number !== null).map(([number, name, cls]) => ({ at: y(number), name, cls })).sort((a, b) => a.at - b.at);
    refs.forEach((ref, position) => { ref.labelAt = position ? Math.max(ref.at, refs[position - 1].labelAt + LABEL_GAP) : ref.at; });
    const lines = refs.map((ref) => `<line class="spc-${ref.cls}" x1="${box.left}" x2="${n2(right)}" y1="${n2(ref.at)}" y2="${n2(ref.at)}"/>`
      + `<text class="spc-label spc-${ref.cls}-label" x="${n2(right + 6)}" y="${n2(ref.labelAt + 4)}">${escapeHtml(ref.name)}</text>`).join("");
    const grid = scale.ticks.map((tick) => `<line class="spc-grid" x1="${box.left}" x2="${n2(right)}" y1="${n2(y(tick))}" y2="${n2(y(tick))}"/>`
      + `<text class="spc-tick" x="${box.left - 6}" y="${n2(y(tick) + 4)}" text-anchor="end">${escapeHtml(value(tick))}</text>`).join("");
    const outOfSpec = new Set(stats.outOfSpec);
    const outOfControl = new Set(stats.outOfControl);
    const points = group.points.map((point, position) => {
      const cx = n2(x(position));
      const cy = n2(y(point.value));
      const zone = outOfSpec.has(position) ? "oos" : outOfControl.has(position) ? "ooc" : "ok";
      const mark = zone === "ok" ? `<circle cx="${cx}" cy="${cy}" r="3.5"/>`
        : zone === "ooc" ? `<rect x="${n2(x(position) - 4)}" y="${n2(y(point.value) - 4)}" width="8" height="8"/>`
        : `<rect x="${n2(x(position) - 4.5)}" y="${n2(y(point.value) - 4.5)}" width="9" height="9" transform="rotate(45 ${cx} ${cy})"/>`;
      const tip = `${point.job_code} · ${formatDate(point.recorded_at, true)} · ${value(point.value)}${group.unit ? ` ${group.unit}` : ""}`;
      return `<g class="spc-pt is-${zone}"><title>${escapeHtml(tip)}</title>${mark}</g>`;
    }).join("");
    const height = box.top + box.height + box.bottom;
    const axisY = box.top + box.height + 18;
    const first = group.points[0];
    const last = group.points.at(-1);
    const summary = `I-chart ${group.label} ${values.length} ค่า ค่าล่าสุด ${value(last.value)}${stats.ucl === null ? "" : ` UCL ${value(stats.ucl)} LCL ${value(stats.lcl)}`}`;
    return `<svg class="spc-chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escapeHtml(summary)}">`
      + grid
      + lines
      + `<polyline class="spc-line" points="${group.points.map((point, position) => `${n2(x(position))},${n2(y(point.value))}`).join(" ")}"/>`
      + points
      + `<text class="spc-tick" x="${box.left}" y="${axisY}">${escapeHtml(formatDate(first.recorded_at))}</text>`
      + (values.length > 1 ? `<text class="spc-tick" x="${n2(right)}" y="${axisY}" text-anchor="end">${escapeHtml(formatDate(last.recorded_at))}</text>` : "")
      + `</svg>`;
  }

  // ฮิสโตแกรม: แท่งที่กลางช่องอยู่นอกสเปกเป็นสีแดง เส้นประ = LSL/USL จำนวนในแต่ละช่องอยู่ใน <title>
  function histogramChart(group) {
    const bins = model.histogram(group.points.map((point) => point.value), group.spec);
    const W = 360;
    const box = { left: 30, right: 12, top: 18, height: 140, bottom: 22 };
    const plotWidth = W - box.left - box.right;
    const low = bins[0].from;
    const high = bins.at(-1).to;
    const top = Math.max(...bins.map((bin) => bin.count));
    const x = (number) => box.left + ((number - low) / (high - low)) * plotWidth;
    const y = (count) => box.top + (1 - count / top) * box.height;
    const base = box.top + box.height;
    const outside = (number) => (group.spec.min !== null && number < group.spec.min) || (group.spec.max !== null && number > group.spec.max);
    const bars = bins.map((bin) => `<rect class="spc-bar${outside((bin.from + bin.to) / 2) ? " is-oos" : ""}" x="${n2(x(bin.from) + 1)}" y="${n2(y(bin.count))}" width="${n2(Math.max(1, x(bin.to) - x(bin.from) - 2))}" height="${n2(base - y(bin.count))}">`
      + `<title>${escapeHtml(`${value(bin.from)}–${value(bin.to)}: ${bin.count} ค่า`)}</title></rect>`).join("");
    const spec = (number, name) => (number === null ? "" : `<line class="spc-spec" x1="${n2(x(number))}" x2="${n2(x(number))}" y1="${box.top - 4}" y2="${base}"/>`
      + `<text class="spc-label spc-spec-label" x="${n2(x(number))}" y="${box.top - 7}" text-anchor="middle">${name}</text>`);
    const height = base + box.bottom;
    return `<svg class="spc-chart spc-hist" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escapeHtml(`ฮิสโตแกรม ${group.label} ${bins.length} ช่อง`)}">`
      + `<line class="spc-grid" x1="${box.left}" x2="${n2(box.left + plotWidth)}" y1="${base}" y2="${base}"/>`
      + `<text class="spc-tick" x="${box.left - 6}" y="${box.top + 4}" text-anchor="end">${top}</text>`
      + bars + spec(group.spec.min, "LSL") + spec(group.spec.max, "USL")
      + `<text class="spc-tick" x="${box.left}" y="${base + 16}">${escapeHtml(value(low))}</text>`
      + `<text class="spc-tick" x="${n2(box.left + plotWidth)}" y="${base + 16}" text-anchor="end">${escapeHtml(value(high))}</text>`
      + `</svg>`;
  }

  const tile = (title, strong, small, hint = "") => `<div class="summary"${hint ? ` title="${escapeHtml(hint)}"` : ""}><span>${escapeHtml(title)}</span><strong>${escapeHtml(strong)}</strong><small>${escapeHtml(small)}</small></div>`;

  function spcHtml(groups, group) {
    const stats = model.capability(group.points.map((point) => point.value), group.spec);
    const verdict = model.verdict(stats);
    const unit = group.unit ? ` ${group.unit}` : "";
    const picker = `<form class="fm-listbar" data-spc-pick>
        <label class="sr-only" for="spc-ch">ค่าที่ติดตาม</label>
        <select class="select spc-pick" id="spc-ch" name="ch">${options(model.choiceLabels(groups), group.key)}</select>
      </form>`;
    const warnings = [
      group.specFromRouting ? "" : notice("พารามิเตอร์นี้ถูกลบออกจาก Routing แล้ว — เส้นสเปกใช้ค่าที่บันทึกไว้กับค่าล่าสุด"),
      group.specChanged ? notice(`สเปกถูกแก้หลังบันทึกไปแล้ว ${group.specChanged} ค่า — ทุกค่าเทียบกับสเปกปัจจุบัน`) : "",
    ].join("");
    const oosRows = stats.outOfSpec.map((position) => group.points[position]).reverse().map((point) => `<tr>
        <td><a href="${escapeHtml(jobUrl(point.job_id))}"><strong>${escapeHtml(point.job_code)}</strong></a></td>
        <td data-label="บันทึกเมื่อ">${escapeHtml(formatDate(point.recorded_at, true))}</td>
        <td class="right" data-label="ค่า"><span class="badge rejected">${escapeHtml(value(point.value))}${escapeHtml(unit)}</span></td>
        <td data-label="ผู้บันทึก">${escapeHtml(point.recorded_by_name ?? "—")}</td></tr>`).join("");
    return `<section class="card">${picker}</section>
      ${warnings}
      <div class="summary-grid fm-summary spc-summary">
        ${tile("Cpk", index(stats.cpk), `${verdict.text}${verdict.provisional ? ` · น้อยกว่า ${model.MIN_SAMPLE} ค่า ใช้ดูแนวโน้ม` : ""}`, "σ ภายในจากช่วงเคลื่อนที่ (MR̄ / 1.128) เทียบสเปกด้านที่ใกล้กว่า")}
        ${tile("Cp / Ppk", `${index(stats.cp)} / ${index(stats.ppk)}`, "", "Cp ต้องมีสเปกทั้งสองด้าน · Ppk ใช้ SD รวมของทุกค่า")}
        ${tile("ค่าเฉลี่ย / σ", `${value(stats.mean)} / ${value(stats.sigma)}`, group.unit)}
        ${tile("จำนวนค่า", String(stats.n), `นอกเส้นควบคุม ${stats.outOfControl.length}`)}
      </div>
      <section class="card"><h2>I-chart</h2><div class="spc-scroll">${controlChart(group, stats)}</div></section>
      <div class="fm-split">
        <section class="card"><h2>ฮิสโตแกรม</h2>${histogramChart(group)}</section>
        <section class="card"><h2>ค่าที่หลุดสเปก</h2>
          ${oosRows ? `<div class="table-wrap"><table class="fm-table"><thead><tr><th>ใบงาน</th><th>บันทึกเมื่อ</th><th class="right">ค่า</th><th>ผู้บันทึก</th></tr></thead><tbody>${oosRows}</tbody></table></div>`
            : '<p class="muted small">ไม่มีค่าที่หลุดสเปก</p>'}</section>
      </div>`;
  }

  function emptyHtml() {
    return `<section class="card">${notice("ยังไม่มีค่าพารามิเตอร์ที่บันทึก — ฝ่ายวางแผนกำหนดพารามิเตอร์ที่ขั้นของ Routing แล้วแผนกที่ทำขั้นนั้นบันทึกค่าตอนปิดขั้นของใบงาน")}
      <a class="btn secondary" href="${escapeHtml(menu.url("routing-view"))}">ไปหน้าขั้นตอนการผลิต</a></section>`;
  }

  const VIEWS = {
    async spc({ params, frame }) {
      frame.loading();
      const groups = model.characteristics(await loadData());
      const group = groups.find((entry) => entry.key === params.get("ch")) ?? groups[0];
      const root = frame.paint({ body: group ? spcHtml(groups, group) : emptyHtml() });
      root?.querySelector?.("form[data-spc-pick] select")?.addEventListener("change", (event) => {
        location.hash = menu.url(ENTRY, { ch: event.target.value }).slice(1);
      });
      return root;
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
