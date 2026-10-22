// กราฟผลทดสอบ Mooney ของโมดูล MNP LAB — สร้างเป็นข้อความ SVG/HTML ล้วน ไม่มี DOM เทสต์ที่ scripts/tests/lab-mooney-views.test.mjs
//
// หน้าวัสดุแสดง MH และ MV รวมในกราฟเดียว (พื้นดำ) แกนเวลาและแกนค่าเดียวกัน — หน่วยเดียวกันจึงใช้สเกลเดียว ไม่ใช่กราฟสองแกน
// สีและรูปทรงต่างกัน (MH = วงกลมสีน้ำเงิน, MV = สี่เหลี่ยมขนมเปียกปูนสีส้ม) จึงแยกได้แม้ไม่เห็นสี; หัวกราฟเป็นทั้งคำอธิบายสัญลักษณ์และค่าเฉลี่ย/SD
//   - โหมด "sequence": ทุกครั้งที่ทดสอบของวัสดุตามลำดับในชีต แถบพื้นหลังสลับทุก 6 จุด (BAND_SIZE) เส้นสั้น = ค่า AVG ของชุด (ทุกครั้งที่ทดสอบมีขีดเสมอ: ชุดที่ชีตยังไม่มี AVG หรือมีค่านอกช่วงค่าที่อ่านได้ ใช้ค่าเฉลี่ยของแถวในชุด วาดเป็นขีดประ)
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
  // แถบพื้นหลังของโหมดลำดับสลับทุกกี่ครั้งที่ทดสอบ (กำหนดตายตัว ไม่ตามขนาดชุด ซึ่งต่างกันได้ตามวัสดุ)
  // ถ้าแถบกว้างน้อยกว่า MIN_BAND_PX พิกเซล (เช่นดูทั้งหมดเมื่อมีเป็นพันครั้ง) ขยายเป็นทวีคูณของ BAND_SIZE จนกว้างพอ ไม่ให้เป็นริ้วถี่
  const BAND_SIZE = 6;
  const MIN_BAND_PX = 18;
  // ช่วงที่กราฟโหมดลำดับแสดง: เริ่มที่ครั้งล่าสุดจำนวนหนึ่งเพื่อให้จุดอ่านออกเมื่อข้อมูลสะสมเป็นร้อยเป็นพัน (จอแคบแสดงน้อยกว่า)
  // MIN_VISIBLE = ซูมเข้าได้ไม่เกินสองแถบ
  const DEFAULT_VISIBLE = 120;
  const DEFAULT_VISIBLE_COMPACT = 60;
  const MIN_VISIBLE = BAND_SIZE * 2;

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

  const defaultCount = (width) => (layoutFor(width).compact ? DEFAULT_VISIBLE_COMPACT : DEFAULT_VISIBLE);

  /* ---------- ช่วงที่แสดง (ซูม/เลื่อน) ---------- */
  // ช่วง = { start, end } ตำแหน่งในรายการทั้งหมด (end ไม่รวม) ทุกฟังก์ชันคืนช่วงใหม่ที่ผ่าน normalizeRange แล้ว ไม่แก้ค่าเดิม

  // กว้างอย่างน้อย MIN_VISIBLE (หรือเท่าที่มี) อย่างมากทั้งรายการ และไม่เลยขอบรายการ
  function normalizeRange(range, total) {
    if (!(total > 0)) return { start: 0, end: 0 };
    const start = Math.floor(Number(range?.start));
    const end = Math.ceil(Number(range?.end));
    const width = clamp((Number.isFinite(end) ? end : total) - (Number.isFinite(start) ? start : 0), Math.min(MIN_VISIBLE, total), total);
    const first = clamp(Number.isFinite(start) ? start : 0, 0, total - width);
    return { start: first, end: first + width };
  }

  const sameRange = (a, b) => Boolean(a && b) && a.start === b.start && a.end === b.end;

  // ครั้งที่ทดสอบทั้งหมดของเดือน from ถึงเดือน to ("YYYY-MM" รวมทั้งสองเดือน) ไม่มีครั้งใดในช่วงนั้น = null
  // ต่ำกว่า MIN_VISIBLE ครั้งถูกขยายเป็นอย่างน้อยสองแถบ (normalizeRange) จึงอาจเห็นเดือนข้างเคียงด้วย
  function rangeForMonths(items, from, to) {
    let start = -1;
    let end = -1;
    items.forEach((item, index) => {
      const month = model.monthOf(item.testDate);
      if (!month) return;
      if (start < 0 && month >= from) start = index;
      if (month <= to) end = index + 1;
    });
    return start >= 0 && end > start ? normalizeRange({ start, end }, items.length) : null;
  }

  // ช่วงจากตัวเลือกของผู้ใช้: "latest" = ล่าสุดตามความกว้างจอ, "all" = ทั้งหมด, "months" = เดือน from ถึงเดือน to (เดือนนั้นไม่มีข้อมูลแล้ว = ล่าสุด),
  // "custom" = ช่วงที่ซูม/เลื่อนมาเอง (follow = ติดขอบขวาอยู่ จึงขยับตามเมื่อมีครั้งใหม่เข้ามา)
  // ตัวเลือกที่ไม่ใช่ custom คำนวณใหม่ทุกครั้งที่วาด จึงตามข้อมูลใหม่และความกว้างจอ (เดือนที่เลือกรับครั้งใหม่ของเดือนนั้นเข้ามาเอง)
  function rangeFor(zoom, items, width) {
    const total = items.length;
    const kind = zoom?.kind ?? "latest";
    if (kind === "all") return normalizeRange({ start: 0, end: total }, total);
    if (kind === "months") {
      const range = rangeForMonths(items, zoom.from, zoom.to);
      if (range) return range;
    }
    if (kind === "custom") {
      const size = Number(zoom.end) - Number(zoom.start);
      return normalizeRange(zoom.follow ? { start: total - size, end: total } : zoom, total);
    }
    return normalizeRange({ start: total - defaultCount(width), end: total }, total);
  }

  // ซูมด้วยตัวคูณ factor (>1 = เข้า, <1 = ออก) โดยตรึงตำแหน่งที่ anchor (0 = ขอบซ้าย … 1 = ขอบขวาของช่วง) ไว้ที่เดิม
  function zoomRange(range, total, factor, anchor = 0.5) {
    const current = normalizeRange(range, total);
    const width = current.end - current.start;
    const next = clamp(Math.round(width / (Number(factor) > 0 ? factor : 1)), Math.min(MIN_VISIBLE, total), total);
    if (next === width) return current;
    const at = clamp(Number.isFinite(anchor) ? anchor : 0.5, 0, 1);
    const start = Math.round(current.start + at * width - at * next);
    return normalizeRange({ start, end: start + next }, total);
  }

  function panRange(range, total, delta) {
    const current = normalizeRange(range, total);
    const shift = Math.round(Number(delta) || 0);
    return normalizeRange({ start: current.start + shift, end: current.end + shift }, total);
  }

  // ทำให้ครั้งที่ index อยู่ในช่วง: เลยขอบไปแค่ครั้งเดียว (กดลูกศรเลื่อนต่อ) ขยับให้พอดีขอบ ไกลกว่านั้น (เช่น คลิกแถวในตาราง) วางไว้กลางช่วง
  function revealRange(range, total, index) {
    const current = normalizeRange(range, total);
    if (!(index >= 0 && index < total) || (index >= current.start && index < current.end)) return current;
    const width = current.end - current.start;
    const first = index === current.start - 1 ? index : index === current.end ? index + 1 - width : Math.round(index - (width - 1) / 2);
    return normalizeRange({ start: first, end: first + width }, total);
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

  // ค่า AVG ที่ชีตให้มาใช้ได้เมื่ออยู่ในช่วงค่าที่อ่านได้ของชุดเดียวกัน (กติกาอยู่ที่ model.sheetAverageFits ที่เดียว แดชบอร์ดใช้ร่วมกัน)
  // ถ้าอยู่นอกช่วง ขีดที่วาดจากค่านั้นจะตกนอกกรอบกราฟ
  const sheetAverageFits = model.sheetAverageFits;

  // ชุดที่ชีตมี AVG ใช้งานได้จริง = มีค่า AVG อย่างน้อยหนึ่งซีรีส์ที่อยู่ในช่วงค่าที่อ่านได้ของชุดนั้น
  // คืน { mh: ค่า|null, mv: ค่า|null } เฉพาะค่าที่ใช้ได้ หรือ null เมื่อทั้งชุดใช้ไม่ได้ (ไม่มี AVG เลย หรือค่าไม่ตรงกับแถวเหล่านี้)
  function usableSheetAverages(group) {
    if (!group.hasStats) return null;
    const usable = {};
    for (const series of SERIES) {
      const average = group[series.avgKey];
      usable[series.key] = sheetAverageFits(average, group.items.map((item) => item[series.key])) ? average : null;
    }
    return SERIES.some((series) => usable[series.key] !== null) ? usable : null;
  }

  // ขนาดชุดที่พบบ่อยที่สุดของชุดที่ชีตมี AVG ใช้งานได้ (เท่ากัน = ชุดใหญ่กว่า); ยังไม่มีชุดให้อ้างอิง = DEFAULT_SET_SIZE
  function usualSetSize(sheetSets) {
    const tally = new Map();
    for (const { group } of sheetSets) tally.set(group.count, (tally.get(group.count) ?? 0) + 1);
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

  // ขีด AVG ของกราฟ: ทุกครั้งที่ทดสอบต้องมีขีดใต้จุดเสมอ (ไม่ว่าชีตจะกรอก AVG แล้วหรือไม่ หรือกรอกมาผิด)
  //   - ชุดที่ชีตมี AVG ใช้งานได้ ใช้ค่าตามชีต (computed = false) ซีรีส์ไหนที่ชีตไม่มีค่าหรือค่าใช้ไม่ได้ ใช้ค่าเฉลี่ยของแถวในชุดแทน
  //   - แถวที่ชีตยังไม่มี AVG (เช่นเพิ่งเพิ่มสูตรใหม่) หรือมีแต่ค่าใช้ไม่ได้ รวมเป็นชุดชั่วคราวขนาดเท่าชุดที่พบบ่อยของวัสดุนั้น
  //     แถวติดกัน แท็บและวันที่เดียวกัน แล้วใช้ค่าเฉลี่ยของแถวในชุดนั้น (computed = true) เมื่อชีตมี AVG ที่ถูกต้อง ขีดจากชีตจะเข้ามาแทนเอง
  // คืน [{ start, count, mh: { value, computed } | null, mv: { value, computed } | null }] — start คือตำแหน่งแรกของชุดในรายการที่ส่งเข้ามา
  function averageMarks(groups = []) {
    const classified = groups.map((group) => ({ group, usable: usableSheetAverages(group) }));
    const setSize = usualSetSize(classified.filter((entry) => entry.usable));
    const marks = [];
    const build = (start, items, usable) => {
      const mark = { start, count: items.length };
      for (const series of SERIES) {
        const sheet = usable?.[series.key];
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
    for (const { group, usable } of classified) {
      if (usable) {
        flush();
        build(group.start, group.items, usable);
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

  // กราฟแนวโน้ม MH + MV แผงเดียว คืน { html, count, total, range, slot, bandSize, xAt(i), indexAt(px), contains(i), fractionAt(px) }
  // px คือตำแหน่งแนวนอนจากขอบซ้ายของ SVG; i คือตำแหน่งในรายการ items ทั้งหมดที่ส่งเข้ามา (ไม่ใช่ตำแหน่งในช่วงที่เห็น) ทั้ง data-i ของจุดด้วย
  // range (เฉพาะโหมดลำดับ) = { start, end } ช่วงที่วาด ไม่ส่ง = ทั้งรายการ; แกนค่า ค่าเฉลี่ย/SD ที่หัวกราฟ และป้ายวันที่คิดจากช่วงที่เห็นเท่านั้น
  // แถบพื้นหลังและขีด AVG นับจากรายการทั้งหมด จึงไม่เลื่อนเฟสเมื่อซูมหรือเลื่อนช่วง
  function trendChart({ mode = "sequence", items: allItems = [], groups = [], width = 800, label = "", range = null } = {}) {
    const layout = layoutFor(width);
    const sequence = mode === "sequence";
    const total = allItems.length;
    const view = sequence ? normalizeRange(range ?? { start: 0, end: total }, total) : { start: 0, end: total };
    const offset = view.start;
    const items = allItems.slice(view.start, view.end);
    const count = items.length;
    const plotWidth = layout.width - layout.left - layout.right;
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
    const bandSize = BAND_SIZE * Math.max(1, Math.ceil(MIN_BAND_PX / (BAND_SIZE * slot)));
    const result = {
      count,
      total,
      range: view,
      slot,
      bandSize,
      xAt: (index) => xAt(index - offset),
      indexAt: (px) => (count ? offset + indexAt(px) : -1),
      contains: (index) => index >= view.start && index < view.end,
      fractionAt: (px) => clamp((px - layout.left) / plotWidth, 0, 1),
    };
    if (!count) return { html: "", ...result };

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
      // แถบพื้นหลังสลับทุก bandSize ครั้ง (เทา/พื้น/เทา…) นับจากครั้งแรกของรายการทั้งหมดต่อเนื่องข้ามวัน ไม่เริ่มใหม่เมื่อเปลี่ยนวัน
      // แถบที่คร่อมขอบช่วงที่เห็นถูกตัดให้พอดีขอบ
      for (let band = Math.floor(view.start / bandSize); band * bandSize < view.end; band += 1) {
        if (band % 2 !== 0) continue;
        const first = Math.max(band * bandSize, view.start) - offset;
        const last = Math.min((band + 1) * bandSize, view.end) - offset;
        svg += `<rect class="lab-band" x="${n2(xAt(first) - slot / 2)}" y="${layout.top}" width="${n2((last - first) * slot)}" height="${layout.plotHeight}"/>`;
      }
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
          // ชุดที่อยู่นอกช่วงที่เห็นไม่วาด ชุดที่คร่อมขอบวาดเฉพาะส่วนที่เห็น
          if (mark.start + mark.count <= view.start || mark.start >= view.end) continue;
          const x1 = Math.max(layout.left, xAt(Math.max(mark.start, view.start) - offset) - slot * 0.45);
          const x2 = Math.min(layout.width - layout.right, xAt(Math.min(mark.start + mark.count, view.end) - 1 - offset) + slot * 0.45);
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
        svg += `<g class="lab-pt lab-pt-${series.key}" data-i="${index + offset}" transform="translate(${n2(xAt(index))} ${n2(yOf(value))})">${dotMarkup(series, radius)}</g>`;
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

    return { html, ...result };
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

  // กราฟเส้นควบคุม (I chart) ของแดชบอร์ด: ค่าเฉลี่ยรายชุดล่าสุดของวัสดุหนึ่งรายการ เส้นกลาง (CL), UCL/LCL = ±3σ (เหลือง)
  // และช่วงใช้งานจริง CL ± band (แดง เฉพาะ MV) พื้นตามธีมของหน้า จุดที่เกิน 2σ/ช่วงใช้งานจริงใช้รูปทรงและสีต่างกัน จึงแยกได้แม้ไม่เห็นสี
  // control = health.mv/mh จาก model.materialHealth (recent, mean, sigma, ucl, lcl, count) · key = "mv" | "mh" (สีของซีรีส์)
  // ป้ายแกน X นับย้อนจากชุดล่าสุด ("n ชุดก่อน" … "ล่าสุด") ไม่ใช่วันที่หรือเลขชุดของหน้าวัสดุ เพราะสรุปเก็บเฉพาะค่าเฉลี่ยของชุดที่ AVG ใช้ได้
  function controlChart({ control, key = "mv", width, label = "" }) {
    const values = (control?.recent ?? []).filter(isNumber);
    if (!values.length || !(control.sigma > 0)) return "";
    // วันที่ของแต่ละชุด (recentDates ยาวเท่า recent) สำหรับ tooltip · สรุปรุ่นเก่าที่ไม่มีวันที่ = นับย้อนจากชุดล่าสุด
    const dates = Array.isArray(control.recentDates) && control.recentDates.length === control.recent.length
      ? control.recentDates.filter((date, index) => isNumber(control.recent[index])) : [];
    // ระยะจากเส้นกลางเป็นจำนวน σ ทศนิยม 1 ตำแหน่ง เครื่องหมายแบบเดียวกับ model.formatSigned
    const sigmas = (value) => {
      const z = Number(((value - control.mean) / control.sigma).toFixed(1));
      return z === 0 ? "0" : `${z < 0 ? "−" : "+"}${Math.abs(z).toFixed(1)}`;
    };
    const total = Math.max(280, Math.floor(Number(width) || 0));
    const compact = total < 560;
    const box = { left: compact ? 40 : 48, right: compact ? 40 : 48, top: 12, height: compact ? 150 : 180, bottom: 22 };
    const plotWidth = total - box.left - box.right;
    const band = isNumber(control.band) ? control.band : null;
    const scale = model.niceScale(Math.min(control.lcl, band === null ? Infinity : control.mean - band, ...values), Math.max(control.ucl, band === null ? -Infinity : control.mean + band, ...values), 4);
    const x = (index) => box.left + (values.length === 1 ? plotWidth / 2 : (index / (values.length - 1)) * plotWidth);
    const y = (value) => box.top + (1 - (value - scale.min) / (scale.max - scale.min)) * box.height;
    const grid = scale.ticks.map((value) => `<line class="lab-grid" x1="${box.left}" x2="${n2(box.left + plotWidth)}" y1="${n2(y(value))}" y2="${n2(y(value))}"/>`
      + `<text class="lab-tick" x="${box.left - 6}" y="${n2(y(value) + 4)}" text-anchor="end">${esc(tick(value))}</text>`).join("");
    const limit = (value, name, cls) => `<line class="lab-cc-${cls}" x1="${box.left}" x2="${n2(box.left + plotWidth)}" y1="${n2(y(value))}" y2="${n2(y(value))}"/>`
      + `<text class="lab-cc-label" x="${n2(box.left + plotWidth + 6)}" y="${n2(y(value) + 4)}">${name}</text>`;
    const points = values.map((value, index) => {
      const zone = model.zoneFor(value, control);
      const last = index === values.length - 1;
      const radius = last ? 5 : 3.4;
      const cx = n2(x(index));
      const cy = n2(y(value));
      const mark = zone === "ok"
        ? `<circle cx="${cx}" cy="${cy}" r="${radius}"/>`
        : `<rect x="${n2(x(index) - radius)}" y="${n2(y(value) - radius)}" width="${n2(radius * 2)}" height="${n2(radius * 2)}" transform="rotate(45 ${cx} ${cy})"/>`;
      const date = dates[index];
      const tip = [
        date ? model.formatDate(date) : `${values.length - 1 - index ? `${values.length - 1 - index} ชุดก่อน` : "ชุดล่าสุด"}`,
        `${key.toUpperCase()} ${tick(value)} (${model.formatSigned(Number((value - control.mean).toFixed(2)))} จาก CL · ${sigmas(value)}σ)`,
      ].join("\n");
      return `<g class="lab-cc-pt is-${zone}${last ? " is-last" : ""}" data-tip="${esc(tip)}">${mark}</g>`;
    }).join("");
    const height = box.top + box.height + box.bottom;
    const axisY = box.top + box.height + 16;
    const summary = `${label ? `${label} ` : ""}${key.toUpperCase()} ${values.length} ชุดล่าสุด เส้นกลาง ${tick(control.mean)} UCL ${tick(control.ucl)} LCL ${tick(control.lcl)} ชุดล่าสุด ${tick(values[values.length - 1])}`;
    return `<svg class="lab-cc lab-cc-${esc(key)}" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" role="img" aria-label="${esc(summary)}">`
      + grid
      + (band === null ? "" : limit(control.mean + band, `+${tick(band)}`, "band") + limit(control.mean - band, `−${tick(band)}`, "band"))
      + limit(control.ucl, "UCL", "limit") + limit(control.mean, "CL", "center") + limit(control.lcl, "LCL", "limit")
      + `<polyline class="lab-cc-line" points="${values.map((value, index) => `${n2(x(index))},${n2(y(value))}`).join(" ")}"/>`
      + points
      + (values.length > 1 ? `<text class="lab-tick" x="${box.left}" y="${axisY}">${values.length - 1} ชุดก่อน</text>` : "")
      + `<text class="lab-tick" x="${n2(box.left + plotWidth)}" y="${axisY}" text-anchor="end">ล่าสุด</text>`
      + `</svg>`;
  }

  // กราฟเล็กต่อสูตรของแดชบอร์ด: ค่าเฉลี่ย MV รายวัน (model.dailyRows) บนแกนวันที่ของช่วงที่เลือก (since → today)
  // ขีดตั้ง = ช่วงระหว่างค่าเฉลี่ยของโม่ในวันนั้น (low–high) · แถบ = CL ± band ของสูตร (เฉพาะสูตรที่มีเส้นควบคุม) · เส้นกลางเป็นเส้นบาง
  // จุดใช้สีสถานะและรูปทรง (ok/none วงกลม · warn ข้าวหลามตัด · out สี่เหลี่ยม) จึงแยกได้แม้ไม่เห็นสี ค่าของจุดอยู่ใน data-tip (module-lab.js แสดงเป็น tooltip เมื่อชี้/แตะ)
  function dailyChart({ daily = [], limits = null, since, today, width = 240, label = "" }) {
    // วันที่ทุกโม่เป็นค่า 0 (status "data") ไม่มีค่าเฉลี่ยให้วาด จึงไม่เป็นจุดบนกราฟ (การ์ดและรายการต้องดูก่อนบอกแทน)
    const points = daily.filter((row) => isNumber(row.mv) && typeof row.date === "string");
    const span = since && today ? model.daysBetween(since, today) : null;
    if (!points.length || !isNumber(span) || span < 0) return "";
    const total = Math.max(160, Math.floor(Number(width) || 0));
    const box = { left: 30, right: 8, top: 10, height: 60, bottom: 18 };
    const plotWidth = total - box.left - box.right;
    const band = limits ? (isNumber(limits.band) ? limits.band : model.PRACTICAL_BAND_MU) : null;
    let low = Math.min(...points.map((row) => (isNumber(row.low) ? row.low : row.mv)));
    let high = Math.max(...points.map((row) => (isNumber(row.high) ? row.high : row.mv)));
    if (limits) {
      low = Math.min(low, limits.mean - band);
      high = Math.max(high, limits.mean + band);
    }
    const pad = (high - low) * 0.15 || 1;
    low -= pad;
    high += pad;
    const x = (date) => box.left + (span ? clamp(model.daysBetween(since, date), 0, span) / span : 0.5) * plotWidth;
    const y = (value) => box.top + (1 - (value - low) / (high - low)) * box.height;
    const axisY = box.top + box.height;
    const last = points[points.length - 1];
    const tick1 = (value) => tick(Number(value.toFixed(1)));
    let body = "";
    if (limits) {
      // ป้าย CL อยู่ฝั่งตรงข้ามกับจุดล่าสุด (จุดอยู่เหนือเส้น = ป้ายใต้เส้น) จะได้ไม่ทับกัน
      body += `<rect class="lab-dc-band" x="${box.left}" y="${n2(y(limits.mean + band))}" width="${n2(plotWidth)}" height="${n2(y(limits.mean - band) - y(limits.mean + band))}" rx="2"/>`
        + `<line class="lab-dc-center" x1="${box.left}" x2="${n2(box.left + plotWidth)}" y1="${n2(y(limits.mean))}" y2="${n2(y(limits.mean))}"/>`
        + `<text class="lab-cc-label" x="${n2(box.left + plotWidth)}" y="${n2(y(limits.mean) + (last.mv >= limits.mean ? 11 : -3))}" text-anchor="end">CL ${esc(tick(limits.mean))}</text>`;
    }
    body += `<text class="lab-tick" x="${box.left - 5}" y="${n2(y(high - pad) + 4)}" text-anchor="end">${esc(tick1(high - pad))}</text>`
      + `<text class="lab-tick" x="${box.left - 5}" y="${n2(y(low + pad) + 4)}" text-anchor="end">${esc(tick1(low + pad))}</text>`
      + `<line class="lab-grid" x1="${box.left}" x2="${n2(box.left + plotWidth)}" y1="${n2(axisY)}" y2="${n2(axisY)}"/>`
      + `<text class="lab-tick" x="${box.left}" y="${n2(axisY + 13)}">${esc(model.formatShortDate(since))}</text>`
      + `<text class="lab-tick" x="${n2(box.left + plotWidth)}" y="${n2(axisY + 13)}" text-anchor="end">${esc(model.formatShortDate(today))}</text>`;
    if (points.length > 1) body += `<polyline class="lab-dc-line" points="${points.map((row) => `${n2(x(row.date))},${n2(y(row.mv))}`).join(" ")}"/>`;
    for (const row of points) {
      const status = ["ok", "warn", "out", "data"].includes(row.status) ? row.status : "none";
      const cx = n2(x(row.date));
      const cy = n2(y(row.mv));
      if (isNumber(row.low) && isNumber(row.high)) body += `<line class="lab-dc-spread is-${status}" x1="${cx}" x2="${cx}" y1="${n2(y(row.high))}" y2="${n2(y(row.low))}"/>`;
      const radius = 4.5;
      const mark = status === "out"
        ? `<rect x="${n2(x(row.date) - radius)}" y="${n2(y(row.mv) - radius)}" width="${n2(radius * 2)}" height="${n2(radius * 2)}"/>`
        : status === "warn"
          ? `<rect x="${n2(x(row.date) - radius)}" y="${n2(y(row.mv) - radius)}" width="${n2(radius * 2)}" height="${n2(radius * 2)}" transform="rotate(45 ${cx} ${cy})"/>`
          : `<circle cx="${cx}" cy="${cy}" r="${radius}"/>`;
      const tip = [
        model.formatDate(row.date),
        `MV ${tick(row.mv)}${isNumber(row.dev) ? ` (${model.formatSigned(row.dev)} จาก CL)` : ""}${isNumber(row.mh) ? ` · MH ${tick(row.mh)}` : ""}`,
        `${row.mills} โม่ ${row.count} ชิ้น${isNumber(row.spread) ? ` · โม่ต่างกัน ${tick(row.spread)}` : ""}${row.suspect ? ` · ค่าอ่าน 0 อีก ${row.suspect} โม่` : ""}`,
      ].join("\n");
      body += `<g class="lab-dc-pt is-${status}" data-date="${esc(row.date)}" data-tip="${esc(tip)}">${mark}</g>`;
    }
    const height = box.top + box.height + box.bottom;
    const summary = `${label ? `${label} ` : ""}MV รายวัน ${points.length} วัน ล่าสุด ${model.formatDate(last.date)} ${tick(last.mv)}${limits ? ` เส้นกลาง ${tick(limits.mean)}` : ""}`;
    return `<svg class="lab-dc" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" role="img" aria-label="${esc(summary)}">${body}</svg>`;
  }

  // กราฟเล็กของสูตรที่ไม่มีแถวรายโม่ (model.trendCards mode "batches" เช่นการทดสอบอื่น): ค่าเฉลี่ย MV รายชุดล่าสุด เก่า → ใหม่
  // ไม่มีวันที่ (trendMv) แกน X นับย้อนจากชุดล่าสุด · ไม่มีเส้นควบคุมหรือแถบ ±5 MU · ค่าของจุดอยู่ใน data-tip
  function batchChart({ values = [], width = 240, label = "" }) {
    const list = values.filter(isNumber);
    if (!list.length) return "";
    const total = Math.max(160, Math.floor(Number(width) || 0));
    const box = { left: 30, right: 8, top: 10, height: 60, bottom: 18 };
    const plotWidth = total - box.left - box.right;
    const low = Math.min(...list);
    const high = Math.max(...list);
    const pad = (high - low) * 0.15 || 1;
    const x = (index) => box.left + (list.length === 1 ? 0.5 : index / (list.length - 1)) * plotWidth;
    const y = (value) => box.top + (1 - (value - (low - pad)) / (high - low + pad * 2)) * box.height;
    const axisY = box.top + box.height;
    const tick1 = (value) => tick(Number(value.toFixed(1)));
    let body = `<text class="lab-tick" x="${box.left - 5}" y="${n2(y(high) + 4)}" text-anchor="end">${esc(tick1(high))}</text>`
      + (high === low ? "" : `<text class="lab-tick" x="${box.left - 5}" y="${n2(y(low) + 4)}" text-anchor="end">${esc(tick1(low))}</text>`)
      + `<line class="lab-grid" x1="${box.left}" x2="${n2(box.left + plotWidth)}" y1="${n2(axisY)}" y2="${n2(axisY)}"/>`
      + (list.length > 1 ? `<text class="lab-tick" x="${box.left}" y="${n2(axisY + 13)}">${list.length - 1} ชุดก่อน</text>` : "")
      + `<text class="lab-tick" x="${n2(box.left + plotWidth)}" y="${n2(axisY + 13)}" text-anchor="end">ล่าสุด</text>`;
    if (list.length > 1) body += `<polyline class="lab-dc-line" points="${list.map((value, index) => `${n2(x(index))},${n2(y(value))}`).join(" ")}"/>`;
    list.forEach((value, index) => {
      const ago = list.length - 1 - index;
      const tip = `${ago ? `${ago} ชุดก่อน` : "ชุดล่าสุด"}\nค่าเฉลี่ย MV ของชุด ${tick(value)}`;
      body += `<g class="lab-dc-pt is-none" data-tip="${esc(tip)}"><circle cx="${n2(x(index))}" cy="${n2(y(value))}" r="4.5"/></g>`;
    });
    const height = box.top + box.height + box.bottom;
    const summary = `${label ? `${label} ` : ""}ค่าเฉลี่ย MV รายชุด ${list.length} ชุดล่าสุด ชุดล่าสุด ${tick(list[list.length - 1])}`;
    return `<svg class="lab-dc" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" role="img" aria-label="${esc(summary)}">${body}</svg>`;
  }

  const api = {
    SERIES, BAND_SIZE, MIN_VISIBLE, layoutFor, defaultCount, averageMarks, trendChart, sparkline, controlChart, dailyChart, batchChart,
    normalizeRange, sameRange, rangeFor, rangeForMonths, zoomRange, panRange, revealRange,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_CHART = api;
})(typeof window !== "undefined" ? window : globalThis);
