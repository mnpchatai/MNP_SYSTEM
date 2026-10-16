// กราฟผลทดสอบ Mooney ของโมดูล MNP LAB — สร้างเป็นข้อความ SVG/HTML ล้วน ไม่มี DOM เทสต์ที่ scripts/tests/lab-mooney-views.test.mjs
//
// หน้าวัสดุแสดง MH และ MV รวมในกราฟเดียว (พื้นดำ) แกนเวลาและแกนค่าเดียวกัน — หน่วยเดียวกันจึงใช้สเกลเดียว ไม่ใช่กราฟสองแกน
// สีและรูปทรงต่างกัน (MH = วงกลมสีน้ำเงิน, MV = สี่เหลี่ยมขนมเปียกปูนสีส้ม) จึงแยกได้แม้ไม่เห็นสี; หัวกราฟเป็นทั้งคำอธิบายสัญลักษณ์และค่าเฉลี่ย/SD
//   - โหมด "sequence": ทุกครั้งที่ทดสอบของวัสดุตามลำดับในชีต แถบพื้นหลังสลับ = วันที่ทดสอบ เส้นสั้น = ค่า AVG ของชุด (ทุกครั้งที่ทดสอบมีขีดเสมอ: ชุดที่ชีตยังไม่มี AVG ใช้ค่าเฉลี่ยของแถวในชุด วาดเป็นขีดประ)
//   - โหมด "id": ติดตาม ID เดียวข้ามหลายครั้งที่ทดสอบ ลากเส้นต่อจุด เส้นประ = ค่าเฉลี่ย ติดป้ายค่าเฉพาะครั้งล่าสุด ค่าสูงสุดและต่ำสุด
// สี/ตัวอักษร/เส้นกริดมาจาก CSS (ดู .lab-* ใน styles.css) กราฟใช้ชุดสีพื้นดำของตัวเองเสมอทั้งธีมสว่างและมืด
// จุดทุกจุดมี data-i = ตำแหน่งในรายการที่ส่งเข้ามา ให้ module-lab.js ผูกการชี้/แตะ/คีย์บอร์ดโดยคำนวณจากตำแหน่งแกน X (indexAt)
(function (root) {
  const model = root.MNP_LAB_MOONEY;
  if (!model) return;

  const SERIES = Object.freeze([
    { key: "mh", label: "MH", shape: "circle", avgKey: "avgMh", labelBelow: false },
    { key: "mv", label: "MV", shape: "diamond", avgKey: "avgMv", labelBelow: true },
  ]);
  const MIN_LABEL_GAP = 6;
  const DATE_LABEL_WIDTH = 34;
  // ขนาดชุดเริ่มต้นเมื่อวัสดุยังไม่มีชุดที่ชีตมี AVG ให้อ้างอิงเลย (ห้องแล็บทดสอบชุดละ 3 ครั้ง)
  const DEFAULT_SET_SIZE = 3;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  // พิกัดในข้อความ SVG ปัดเป็นทศนิยม 2 ตำแหน่ง ไม่ให้ไฟล์บวมและไม่มี NaN/Infinity หลุดเข้าไป
  const n2 = (value) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0");
  const tick = (value) => String(Number(value.toFixed(2)));

  function layoutFor(width) {
    const total = Math.max(280, Math.floor(Number(width) || 0));
    const compact = total < 560;
    return { width: total, compact, left: compact ? 38 : 46, right: compact ? 10 : 16, top: 10, plotHeight: compact ? 190 : 250, inset: 10, axisHeight: 26 };
  }

  // ป้ายวันที่บนแกน: วันล่าสุดและวันแรกมีป้ายเสมอ ที่เหลือเลือกวันที่มีแถวมากก่อน (กว้างกว่า อ่านง่ายกว่า) แล้วข้ามป้ายที่ทับกัน
  function pickDateLabels(candidates, layout) {
    const right = layout.width - layout.right;
    const placed = candidates.map((candidate, order) => {
      let start = candidate.x;
      let anchor = "start";
      if (start + DATE_LABEL_WIDTH > right + 4) {
        start = right - DATE_LABEL_WIDTH;
        anchor = "end";
      }
      return { order, start, anchor, x: anchor === "end" ? right : candidate.x, text: candidate.text, weight: candidate.weight };
    });
    const lastOrder = placed.length - 1;
    const rank = (item) => (item.order === lastOrder ? 2 : item.order === 0 ? 1 : 0);
    const priority = [...placed].sort((a, b) => rank(b) - rank(a) || b.weight - a.weight || b.order - a.order);
    const kept = [];
    for (const item of priority) {
      if (kept.every((other) => item.start + DATE_LABEL_WIDTH + MIN_LABEL_GAP <= other.start || other.start + DATE_LABEL_WIDTH + MIN_LABEL_GAP <= item.start)) kept.push(item);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  // หัวกราฟ: ชื่อซีรีส์ (สัญลักษณ์ + ชื่อ = คำอธิบายสี/รูปทรง) + ค่าเฉลี่ย/SD ของทุกครั้งที่ทดสอบ (ช่วงค่าดูได้จากแกน จึงไม่ซ้ำเป็นตัวเลข)
  function chartHead(entries) {
    return `<header class="lab-panel-head">${entries.map(({ series, stats }) => `<span class="lab-series"><span class="lab-panel-name"><i class="lab-key lab-key-${series.key}" aria-hidden="true"></i>${esc(series.label)}</span>`
      + `<span class="lab-panel-stats">เฉลี่ย <b>${esc(model.formatReading(stats.mean))}</b> · SD <b>${esc(model.formatReading(stats.sd))}</b></span></span>`).join("")}</header>`;
  }

  function dotMarkup(series, radius) {
    const halo = `<circle class="lab-halo" r="${n2(radius + 4)}"/>`;
    const dot = series.shape === "diamond"
      ? `<rect class="lab-dot" x="${n2(-radius * 0.92)}" y="${n2(-radius * 0.92)}" width="${n2(radius * 1.84)}" height="${n2(radius * 1.84)}" transform="rotate(45)"/>`
      : `<circle class="lab-dot" r="${n2(radius)}"/>`;
    return halo + dot;
  }

  // ขนาดชุดที่พบบ่อยที่สุดของชุดที่ชีตมี AVG/SD (เท่ากัน = ชุดใหญ่กว่า); ยังไม่มีชุดให้อ้างอิง = DEFAULT_SET_SIZE
  function usualSetSize(groups) {
    const tally = new Map();
    for (const group of groups) if (group.hasStats) tally.set(group.count, (tally.get(group.count) ?? 0) + 1);
    let size = DEFAULT_SET_SIZE;
    let best = 0;
    for (const [candidate, times] of tally) {
      if (times > best || (times === best && candidate > size)) {
        size = candidate;
        best = times;
      }
    }
    return size;
  }

  // ขีด AVG ของกราฟ: ทุกครั้งที่ทดสอบต้องมีขีดใต้จุดเสมอ (ไม่ว่าชีตจะกรอก AVG แล้วหรือไม่)
  //   - ชุดที่ชีตมี AVG ใช้ค่าตามชีต (computed = false) ซีรีส์ไหนที่ชีตไม่มีค่า ใช้ค่าเฉลี่ยของแถวในชุดแทน
  //   - แถวที่ชีตยังไม่มี AVG (เช่นเพิ่งเพิ่มสูตรใหม่) รวมเป็นชุดชั่วคราวขนาดเท่าชุดที่พบบ่อยของวัสดุนั้น แถวติดกัน แท็บและวันที่เดียวกัน
  //     แล้วใช้ค่าเฉลี่ยของแถวในชุดนั้น (computed = true) เมื่อชีตมี AVG ในภายหลัง ขีดจากชีตจะเข้ามาแทนเอง
  // คืน [{ start, count, mh: { value, computed } | null, mv: { value, computed } | null }] — start คือตำแหน่งแรกของชุดในรายการที่ส่งเข้ามา
  function averageMarks(groups = []) {
    const setSize = usualSetSize(groups);
    const marks = [];
    const build = (start, items, sheetValues) => {
      const mark = { start, count: items.length };
      for (const series of SERIES) {
        const sheet = sheetValues?.[series.avgKey];
        if (isNumber(sheet)) {
          mark[series.key] = { value: sheet, computed: false };
          continue;
        }
        const { mean } = model.describe(items.map((item) => item[series.key]));
        mark[series.key] = isNumber(mean) ? { value: mean, computed: true } : null;
      }
      marks.push(mark);
    };

    let pending = null;
    const flush = () => {
      if (pending) build(pending.start, pending.items, null);
      pending = null;
    };
    for (const group of groups) {
      if (group.hasStats) {
        flush();
        build(group.start, group.items, group);
        continue;
      }
      for (const item of group.items) {
        const fits = pending && pending.items.length < setSize && pending.sheet === item.sheet && pending.date === item.testDate;
        if (!fits) {
          flush();
          pending = { start: group.start + group.items.indexOf(item), items: [], sheet: item.sheet, date: item.testDate };
        }
        pending.items.push(item);
      }
    }
    flush();
    return marks;
  }

  // กราฟแนวโน้ม MH + MV แผงเดียว คืน { html, count, xAt(i), indexAt(px) } — px คือตำแหน่งแนวนอนจากขอบซ้ายของ SVG
  function trendChart({ mode = "sequence", items = [], groups = [], width = 800, label = "" } = {}) {
    const layout = layoutFor(width);
    const count = items.length;
    const plotWidth = layout.width - layout.left - layout.right;
    const sequence = mode === "sequence";
    const slot = count ? plotWidth / count : plotWidth;
    const idPad = Math.min(16, plotWidth / 4);
    const idSpacing = count > 1 ? (plotWidth - idPad * 2) / (count - 1) : 0;
    const xAt = (index) => {
      if (sequence) return layout.left + (index + 0.5) * slot;
      return count === 1 ? layout.left + plotWidth / 2 : layout.left + idPad + index * idSpacing;
    };
    const indexAt = (px) => {
      if (!count) return -1;
      const raw = sequence ? Math.floor((px - layout.left) / slot) : Math.round((px - layout.left - idPad) / (idSpacing || 1));
      return clamp(raw, 0, count - 1);
    };
    if (!count) return { html: "", count, xAt, indexAt };

    const radius = sequence ? clamp(slot * 0.33, 2.2, 4.5) : 5;
    const marks = sequence ? model.dateMarks(items) : null;
    const averages = sequence ? averageMarks(groups) : [];

    // ป้ายวันที่ใต้แกน: โหมดลำดับ = ต้นของแต่ละวัน โหมด ID = วันที่ของแต่ละครั้ง (ข้ามวันที่ซ้ำติดกัน)
    const candidates = sequence
      ? marks.map((mark, index) => ({ x: xAt(mark.index) - slot / 2 + 3, text: model.formatShortDate(mark.date), weight: (marks[index + 1]?.index ?? count) - mark.index }))
      : items.map((item, index) => ({ x: xAt(index) - DATE_LABEL_WIDTH / 2, text: model.formatShortDate(item.testDate), date: item.testDate, weight: 1 }))
        .filter((candidate, index, list) => index === 0 || candidate.date !== list[index - 1].date)
        .map((candidate) => ({ ...candidate, x: clamp(candidate.x, layout.left, layout.width - layout.right - DATE_LABEL_WIDTH) }));
    const dateLabels = pickDateLabels(candidates, layout);

    const entries = SERIES.map((series) => {
      const values = items.map((item) => (isNumber(item[series.key]) ? item[series.key] : null));
      return { series, values, stats: model.describe(values) };
    });
    // แกนค่าเดียวร่วมกันทั้งสองซีรีส์ (หน่วยเดียวกัน) ครอบช่วงต่ำสุด–สูงสุดของทั้งคู่
    const overall = model.describe(entries.flatMap((entry) => entry.values));
    const scale = model.niceScale(overall.min, overall.max, layout.compact ? 4 : 5);
    const top = layout.top + layout.inset;
    const bottom = layout.top + layout.plotHeight - layout.inset;
    const plotBottom = layout.top + layout.plotHeight;
    const yOf = (value) => bottom - ((value - scale.min) / (scale.max - scale.min)) * (bottom - top);
    let svg = "";

    if (sequence) {
      // แถบพื้นหลังสลับตามวันที่ทดสอบ (วันเว้นวัน) ขอบแถบคือจุดที่เปลี่ยนวัน
      marks.forEach((mark, index) => {
        if (index % 2 !== 0) return;
        const end = marks[index + 1]?.index ?? count;
        svg += `<rect class="lab-band" x="${n2(xAt(mark.index) - slot / 2)}" y="${layout.top}" width="${n2((end - mark.index) * slot)}" height="${layout.plotHeight}"/>`;
      });
    }
    for (const value of scale.ticks) {
      svg += `<line class="lab-grid" x1="${layout.left}" x2="${layout.width - layout.right}" y1="${n2(yOf(value))}" y2="${n2(yOf(value))}"/>`
        + `<text class="lab-tick" x="${layout.left - 8}" y="${n2(yOf(value) + 4)}" text-anchor="end">${esc(tick(value))}</text>`;
    }
    svg += `<line class="lab-axis" x1="${layout.left}" x2="${layout.width - layout.right}" y1="${plotBottom}" y2="${plotBottom}"/>`;
    svg += `<line class="lab-cross" x1="0" x2="0" y1="${layout.top}" y2="${plotBottom}" visibility="hidden"/>`;

    for (const { series, values, stats } of entries) {
      if (sequence) {
        for (const mark of averages) {
          const average = mark[series.key];
          if (!average) continue;
          const x1 = Math.max(layout.left, xAt(mark.start) - slot * 0.45);
          const x2 = Math.min(layout.width - layout.right, xAt(mark.start + mark.count - 1) + slot * 0.45);
          svg += `<line class="lab-avg lab-avg-${series.key}${average.computed ? " is-calc" : ""}" x1="${n2(x1)}" x2="${n2(x2)}" y1="${n2(yOf(average.value))}" y2="${n2(yOf(average.value))}"/>`;
        }
      } else {
        // เส้นต่อจุดขาดเมื่อมีครั้งที่ไม่มีค่า และเส้นประแสดงค่าเฉลี่ยของ ID นี้
        let run = [];
        const flush = () => {
          if (run.length > 1) svg += `<polyline class="lab-line lab-line-${series.key}" points="${run.join(" ")}"/>`;
          run = [];
        };
        values.forEach((value, index) => {
          if (value === null) flush();
          else run.push(`${n2(xAt(index))},${n2(yOf(value))}`);
        });
        flush();
        if (isNumber(stats.mean)) svg += `<line class="lab-mean lab-mean-${series.key}" x1="${layout.left}" x2="${layout.width - layout.right}" y1="${n2(yOf(stats.mean))}" y2="${n2(yOf(stats.mean))}"/>`;
      }
    }

    for (const { series, values } of entries) {
      values.forEach((value, index) => {
        if (value === null) return;
        svg += `<g class="lab-pt lab-pt-${series.key}" data-i="${index}" transform="translate(${n2(xAt(index))} ${n2(yOf(value))})">${dotMarkup(series, radius)}</g>`;
      });
    }

    if (!sequence) {
      // ติดป้ายค่าเฉพาะจุดสำคัญ: ครั้งล่าสุด ค่าสูงสุด ค่าต่ำสุด (ไม่ติดทุกจุด)
      // MH ติดป้ายเหนือจุด และ MV ใต้จุด (MV ต่ำกว่า MH) ป้ายของสองซีรีส์ที่อยู่บนแกนเดียวกันจึงไม่ทับกัน ถ้าชนขอบกราฟจะกลับด้าน
      for (const { series, values, stats } of entries) {
        const picks = new Set();
        values.forEach((value, index) => {
          if (value === null) return;
          if (value === stats.max || value === stats.min) picks.add(index);
        });
        for (let index = values.length - 1; index >= 0; index -= 1) {
          if (values[index] !== null) {
            picks.add(index);
            break;
          }
        }
        for (const index of picks) {
          const y = yOf(values[index]);
          let below = series.labelBelow;
          if (below && y + 17 > plotBottom - 2) below = false;
          if (!below && y - 10 < layout.top + 8) below = true;
          const x = clamp(xAt(index), layout.left + 14, layout.width - layout.right - 14);
          svg += `<text class="lab-val" x="${n2(x)}" y="${n2(below ? y + 17 : y - 9)}" text-anchor="middle">${esc(model.formatReading(values[index]))}</text>`;
        }
      }
    }

    for (const item of dateLabels) {
      svg += `<text class="lab-tick" x="${n2(item.x)}" y="${plotBottom + 17}" text-anchor="${item.anchor}">${esc(item.text)}</text>`;
    }

    const summary = entries
      .map(({ series, stats }) => (stats.count
        ? `${series.label} ของ ${label || "วัสดุ"} ${stats.count} ครั้ง เฉลี่ย ${model.formatReading(stats.mean)} ช่วง ${model.formatReading(stats.min)} ถึง ${model.formatReading(stats.max)}`
        : `${series.label} ไม่มีข้อมูล`))
      .join(" · ");
    const heightTotal = plotBottom + layout.axisHeight;
    const html = `<section class="lab-panel">${chartHead(entries)}`
      + `<svg class="lab-svg" width="${layout.width}" height="${heightTotal}" viewBox="0 0 ${layout.width} ${heightTotal}" role="img" aria-label="${esc(summary)}" focusable="false">${svg}</svg></section>`;

    return { html, count, xAt, indexAt };
  }

  // กราฟเส้นเล็กในแถวของหน้ารวม: แนวโน้มค่าเฉลี่ยรายชุด ปลายเส้นเป็นจุด (ค่าล่าสุด) ไม่มีแกน ตัวเลขอยู่ข้างๆ เสมอ
  function sparkline(values, { width = 72, height = 26, key = "mh" } = {}) {
    const list = values.filter(isNumber);
    if (list.length < 2) return "";
    const low = Math.min(...list);
    const high = Math.max(...list);
    const pad = 3;
    const x = (index) => pad + (index / (list.length - 1)) * (width - pad * 2);
    const y = (value) => (high === low ? height / 2 : pad + (1 - (value - low) / (high - low)) * (height - pad * 2));
    const points = list.map((value, index) => `${n2(x(index))},${n2(y(value))}`).join(" ");
    const lastValue = list[list.length - 1];
    return `<svg class="lab-spark lab-spark-${esc(key)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">`
      + `<polyline points="${points}"/><circle cx="${n2(x(list.length - 1))}" cy="${n2(y(lastValue))}" r="2.6"/></svg>`;
  }

  const api = { SERIES, layoutFor, averageMarks, trendChart, sparkline };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_CHART = api;
})(typeof window !== "undefined" ? window : globalThis);
