// โมเดลข้อมูลผลทดสอบ Mooney ของโมดูล MNP LAB — ข้อมูลล้วน ไม่มี DOM/Supabase เทสต์ที่ scripts/tests/lab-mooney-model.test.mjs
//
// ข้อมูลมาจาก Google Sheets ผ่านตัวซิงก์และ RPC ของ Supabase (ฟีด Apps Script เดิมยังแปลงได้เพื่อ rollback)
// ผลถูกแปลงผ่าน normalizeFeed ที่นี่ที่เดียว หน้าเว็บ (modules/module-lab.js) จึงรับเฉพาะรูปแบบที่ตรวจแล้ว: ตัวเลขเป็น number|null
// วันที่เป็นสตริง YYYY-MM-DD (ไม่ผ่าน Date เพื่อไม่ให้เขตเวลาทำให้วันเลื่อน) ตัวซิงก์ใช้โมเดลนี้คำนวณสรุปจากแถวชุดเดียวกัน
(function (root) {
  const MAX_MATERIAL_LENGTH = 60;

  const number = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // วัสดุจาก query string (#/lab?material=…) — ตัดช่องว่าง จำกัดความยาว 60 ตัวอักษร ว่าง = ไม่เลือก
  function readMaterial(value) {
    const text = String(value ?? "").trim();
    return text && text.length <= MAX_MATERIAL_LENGTH ? text : null;
  }

  function materialUrl(material) {
    const name = readMaterial(material);
    return name ? `#/lab?material=${encodeURIComponent(name)}` : "#/lab";
  }

  const text = (value) => String(value ?? "");

  function normalizeRow(row) {
    return {
      // ไม่มีรหัสแถวในชีต: ใช้กุญแจเดียวกับที่ระบุแถวในชีต (แท็บ + ID + วันที่ + เวลา)
      id: [row?.source_sheet, row?.sample_id, row?.test_date, row?.test_time].map(text).join("|"),
      // แท็บในชีต: ชุดทดสอบ (แถวที่ merge AVG/SD ร่วมกัน) ไม่ข้ามแท็บ
      sheet: text(row?.source_sheet),
      material: text(row?.material).trim(),
      sampleId: text(row?.sample_id),
      testDate: row?.test_date ?? null,
      testTime: row?.test_time ?? null,
      temperature: number(row?.temperature_c),
      testMinutes: number(row?.test_minutes),
      mh: number(row?.mh),
      mv: number(row?.mv),
      avgMh: number(row?.avg_mh),
      sdMh: number(row?.sd_mh),
      avgMv: number(row?.avg_mv),
      sdMv: number(row?.sd_mv),
    };
  }

  // ฟีดจาก Apps Script: { ok, generated_at, rows, skipped, … } — แถวที่ไม่มีวัสดุหรือวันที่ถูกทิ้ง (แถวที่ชีตอ่านไม่ได้ Apps Script ไม่ส่งมาในรายการ rows)
  function normalizeFeed(body) {
    const strings = (value) => (Array.isArray(value) ? value.map(text) : []);
    return {
      generatedAt: body?.generated_at ?? null,
      rows: (Array.isArray(body?.rows) ? body.rows : []).map(normalizeRow).filter((row) => row.material && row.testDate),
      skipped: strings(body?.skipped),
    };
  }

  // สรุปรายวัสดุจากแถวทั้งหมด (วันที่เป็น ISO เทียบเป็นสตริงได้)
  function buildOverview(rows) {
    const byMaterial = new Map();
    for (const row of rows) {
      const entry = byMaterial.get(row.material) ?? { material: row.material, resultCount: 0, days: new Set(), firstTested: null, lastTested: null };
      entry.resultCount += 1;
      entry.days.add(row.testDate);
      if (entry.firstTested === null || row.testDate < entry.firstTested) entry.firstTested = row.testDate;
      if (entry.lastTested === null || row.testDate > entry.lastTested) entry.lastTested = row.testDate;
      byMaterial.set(row.material, entry);
    }
    return [...byMaterial.values()].map(({ days, ...rest }) => ({ ...rest, testDays: days.size }));
  }

  // ผลทดสอบของวัสดุหนึ่งรายการ ใหม่สุดก่อน (วันที่ แล้วเวลา) เท่ากันเรียงตาม ID
  function resultsFor(rows, material) {
    const name = readMaterial(material);
    if (!name) return [];
    return rows
      .filter((row) => row.material === name)
      .sort((a, b) => String(b.testDate).localeCompare(String(a.testDate))
        || String(b.testTime ?? "").localeCompare(String(a.testTime ?? ""))
        || a.sampleId.localeCompare(b.sampleId, "en", { numeric: true }));
  }

  // ค้นหาวัสดุแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย ค่าว่าง = ทั้งหมด
  function filterMaterials(materials, query) {
    const needle = String(query ?? "").trim().toLowerCase();
    return needle ? materials.filter((item) => item.material.toLowerCase().includes(needle)) : materials;
  }

  const byName = (a, b) => a.material.localeCompare(b.material, "en", { numeric: true, sensitivity: "base" });
  const SORTERS = {
    // ทดสอบล่าสุดก่อน (วันที่เป็น ISO เทียบเป็นสตริงได้) เท่ากันเรียงตามชื่อ
    recent: (a, b) => String(b.lastTested ?? "").localeCompare(String(a.lastTested ?? "")) || byName(a, b),
    name: byName,
    count: (a, b) => b.resultCount - a.resultCount || byName(a, b),
  };
  const SORT_OPTIONS = Object.freeze([
    { key: "recent", label: "ทดสอบล่าสุดก่อน" },
    { key: "name", label: "ชื่อ A → Z" },
    { key: "count", label: "จำนวนผลมากสุด" },
  ]);

  // คีย์ที่ไม่รู้จักใช้ "ทดสอบล่าสุดก่อน" ไม่โยน error
  function sortMaterials(materials, key) {
    return [...materials].sort(SORTERS[key] ?? SORTERS.recent);
  }

  // รายการวัสดุที่เด้งใต้ช่องค้นหา: ตรงคำค้นเหมือนตาราง แต่ชื่อที่ขึ้นต้นด้วยคำค้นมาก่อน แล้วเรียงตามชื่อ
  // (ใช้หาชื่อที่รู้อยู่แล้ว จึงไม่เรียงตามผลล่าสุดแบบตาราง) ไม่แก้ array ที่ส่งเข้ามา
  function suggestMaterials(materials, query) {
    const needle = String(query ?? "").trim().toLowerCase();
    const rank = (item) => (needle && item.material.toLowerCase().startsWith(needle) ? 0 : 1);
    return [...filterMaterials(materials, needle)].sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }

  const EMPTY = "—";

  // YYYY-MM-DD → DD/MM/YYYY (ค.ศ. เหมือนที่เห็นในสเปรดชีตต้นทาง) รูปแบบอื่นคืนเป็น —
  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : EMPTY;
  }

  // HH:MM:SS (จากชนิด time ของ Postgres) — ตัดเศษวินาทีย่อยถ้ามี
  function formatTime(value) {
    const match = /^(\d{2}:\d{2}:\d{2})/.exec(String(value ?? ""));
    return match ? match[1] : EMPTY;
  }

  // ค่าอ่านจากเครื่อง (MH, MV, AVG, SD) แสดง 2 ตำแหน่งตามชีต
  function formatReading(value) {
    return value === null || value === undefined ? EMPTY : Number(value).toFixed(2);
  }

  // อุณหภูมิ/เวลาทดสอบ ไม่ใส่ศูนย์ท้าย (100 ไม่ใช่ 100.0)
  function formatPlain(value) {
    return value === null || value === undefined ? EMPTY : String(Number(value));
  }

  const updatedFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // เวลาที่อ่านชีตล่าสุด เป็นเวลาไทย "DD/MM/YYYY HH:MM:SS" ไม่มีค่า/อ่านไม่ได้ = —
  function formatUpdatedAt(value) {
    if (!value) return EMPTY;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? EMPTY : updatedFormat.format(date).replace(", ", " ");
  }

  /* ---------- ลำดับการทดสอบ ชุดทดสอบ และสถิติ (ใช้วาดกราฟและตารางของหน้าวัสดุ) ---------- */

  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const statsOf = (row) => [row.avgMh, row.sdMh, row.avgMv, row.sdMv];
  const hasStats = (row) => statsOf(row).some((value) => value !== null);

  // ชุดทดสอบ = แถวที่ติดกันในแท็บเดียวกันที่ชีต merge AVG/SD เป็นเซลล์เดียว (Apps Script ขยายค่านั้นไปทุกแถวของชุดก่อนส่ง)
  // ฟีดไม่มีรหัสชุด จึงถือว่าแถวติดกันที่มีค่า AVG/SD ครบชุดเดียวกันทุกตัวคือชุดเดียวกัน ส่วนแถวที่ไม่มี AVG/SD เลยเป็นชุดละหนึ่งแถว
  function groupItems(items) {
    const groups = [];
    for (const item of items) {
      const last = groups[groups.length - 1];
      const key = statsOf(item).join("|");
      if (last && last.hasStats && hasStats(item) && last.sheet === item.sheet && last.key === key) {
        last.items.push(item);
        item.groupIndex = last.index;
        continue;
      }
      item.groupIndex = groups.length;
      groups.push({ index: groups.length, sheet: item.sheet, key, hasStats: hasStats(item), items: [item] });
    }
    return groups.map((group) => {
      const [first] = group.items;
      const dates = group.items.map((item) => item.testDate).sort();
      return {
        index: group.index,
        sheet: group.sheet,
        hasStats: group.hasStats,
        items: group.items,
        count: group.items.length,
        start: first.seq - 1,
        // ค่าตามชีต ไม่คำนวณใหม่
        avgMh: first.avgMh,
        sdMh: first.sdMh,
        avgMv: first.avgMv,
        sdMv: first.sdMv,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
      };
    });
  }

  function seriesOf(rows, material) {
    const items = rows.map((row, index) => ({ ...row, seq: index + 1, groupIndex: 0 }));
    return { material, items, groups: groupItems(items) };
  }

  // ผลทดสอบของวัสดุหนึ่งรายการ "ตามลำดับในชีต" (ลำดับการทดสอบ เก่า → ใหม่) พร้อมลำดับที่ (seq เริ่ม 1) และชุดทดสอบ
  // ต่างจาก resultsFor ตรงที่ไม่เรียงใหม่ตามวันที่ เพราะแถวของชุดเดียวกันต้องอยู่ติดกัน และชีตคือบันทึกลำดับจริงของห้องแล็บ
  function buildSeries(rows, material) {
    const name = readMaterial(material);
    return seriesOf(name ? rows.filter((row) => row.material === name) : [], name);
  }

  // สถิติของค่าที่เป็นตัวเลข: SD ใช้ n−1 เหมือน STDEV ใน Excel (มีค่าน้อยกว่า 2 ตัว = null)
  function describe(values) {
    let count = 0;
    let sum = 0;
    let min = null;
    let max = null;
    for (const value of values) {
      if (!isNumber(value)) continue;
      count += 1;
      sum += value;
      if (min === null || value < min) min = value;
      if (max === null || value > max) max = value;
    }
    if (!count) return { count: 0, mean: null, sd: null, min: null, max: null };
    const mean = sum / count;
    let squares = 0;
    for (const value of values) if (isNumber(value)) squares += (value - mean) ** 2;
    return { count, mean, sd: count > 1 ? Math.sqrt(squares / (count - 1)) : null, min, max };
  }

  // แกนตัวเลขที่ลงตัว (ขั้น 1/2/5 × 10^n) ครอบช่วง min–max; ช่วงที่เป็นจุดเดียวถูกขยายออกเล็กน้อยให้วาดได้
  function niceScale(min, max, tickCount = 4) {
    let low = isNumber(min) ? min : 0;
    let high = isNumber(max) ? max : low + 1;
    if (high < low) [low, high] = [high, low];
    if (high === low) {
      const pad = Math.abs(low) * 0.05 || 1;
      low -= pad;
      high += pad;
    }
    const rough = (high - low) / Math.max(1, tickCount);
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const residual = rough / magnitude;
    const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;
    const start = Math.floor(low / step + 1e-9);
    const end = Math.ceil(high / step - 1e-9);
    const clean = (value) => Number(value.toPrecision(12));
    const ticks = [];
    for (let index = start; index <= end; index += 1) ticks.push(clean(index * step));
    return { min: ticks[0], max: ticks[ticks.length - 1], step: clean(step), ticks };
  }

  // ตำแหน่งที่วันที่เปลี่ยนจากแถวก่อนหน้า (แถวแรกของแต่ละวัน) ใช้ขีดคั่นวันบนแกนเวลา
  function dateMarks(items) {
    const marks = [];
    let previous = null;
    items.forEach((item, index) => {
      if (item.testDate !== previous) marks.push({ index, date: item.testDate });
      previous = item.testDate;
    });
    return marks;
  }

  // ตำแหน่งของครั้งแรกที่อยู่ใน `days` วันล่าสุด นับถึงวันที่ทดสอบล่าสุดของรายการ (รวมวันนั้น) ใช้เลือกช่วง "30 วัน/90 วัน" ของกราฟ
  // รายการไม่มีวันที่เลย = 0 (ทั้งรายการ)
  function startOfLastDays(items, days) {
    let latest = null;
    for (const item of items) if (item.testDate && (latest === null || item.testDate > latest)) latest = item.testDate;
    if (latest === null) return 0;
    const cutoff = new Date(`${latest}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - (Math.max(1, days) - 1));
    const first = cutoff.toISOString().slice(0, 10);
    const index = items.findIndex((item) => item.testDate && item.testDate >= first);
    return index < 0 ? 0 : index;
  }

  // ID ที่มีในรายการ (เรียงแบบเลขก่อน) พร้อมจำนวนครั้งที่ทดสอบ
  function idsFor(items) {
    const counts = new Map();
    for (const item of items) counts.set(item.sampleId, (counts.get(item.sampleId) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))
      .map(([id, count]) => ({ id, count }));
  }

  const difference = (value, previous) => (isNumber(value) && isNumber(previous) ? Number((value - previous).toFixed(6)) : null);

  // ผลทดสอบของ ID เดียวตามลำดับในชีต พร้อมผลต่างจากครั้งก่อนหน้าของ ID เดียวกัน
  function idSeries(items, id) {
    const list = items.filter((item) => item.sampleId === id);
    return list.map((item, index) => ({
      ...item,
      order: index + 1,
      deltaMh: difference(item.mh, list[index - 1]?.mh),
      deltaMv: difference(item.mv, list[index - 1]?.mv),
    }));
  }

  const lastWithValue = (groups, before, key) => {
    for (let index = before - 1; index >= 0; index -= 1) if (groups[index].hasStats && isNumber(groups[index][key])) return groups[index];
    return null;
  };

  // ผลล่าสุดของวัสดุ: ชุดสุดท้ายในชีต (ค่า AVG ± SD ตามชีต) พร้อมผลต่างจากชุดก่อนหน้า
  // ถ้าชุดสุดท้ายยังไม่มี AVG (เพิ่งกรอก) ใช้ค่าอ่านของแถวสุดท้ายแทน และบอกว่า basis = "reading" ให้หน้าจอระบุว่าเป็นค่าเดี่ยว
  function latestOf(series) {
    const item = series.items[series.items.length - 1];
    if (!item) return null;
    const group = series.groups[item.groupIndex];
    const measure = (groupKey, sdKey, readingKey) => {
      if (group.hasStats && isNumber(group[groupKey])) {
        const previous = lastWithValue(series.groups, group.index, groupKey);
        return { basis: "group", value: group[groupKey], sd: group[sdKey], delta: previous ? difference(group[groupKey], previous[groupKey]) : null };
      }
      const previous = series.items[series.items.length - 2];
      return { basis: "reading", value: item[readingKey], sd: null, delta: previous ? difference(item[readingKey], previous[readingKey]) : null };
    };
    return { item, group, mh: measure("avgMh", "sdMh", "mh"), mv: measure("avgMv", "sdMv", "mv") };
  }

  // แนวโน้มค่าเฉลี่ยรายชุด (เก่า → ใหม่) ล่าสุด limit ชุด; วัสดุที่ไม่มี AVG เลยใช้ค่าอ่านรายแถวแทน
  function trendOf(series, key, limit = 14) {
    const groupKey = key === "mh" ? "avgMh" : "avgMv";
    const averages = series.groups.filter((group) => group.hasStats && isNumber(group[groupKey])).map((group) => group[groupKey]);
    const values = averages.length ? averages : series.items.map((item) => item[key]).filter(isNumber);
    return values.slice(-limit);
  }

  // สรุปรายวัสดุสำหรับหน้ารวม: ข้อมูลเดิมของ buildOverview + ผลล่าสุด + แนวโน้ม + จำนวนชุด
  function buildMaterialSummaries(rows) {
    const byMaterial = new Map();
    for (const row of rows) {
      const list = byMaterial.get(row.material);
      if (list) list.push(row);
      else byMaterial.set(row.material, [row]);
    }
    return buildOverview(rows).map((entry) => {
      const series = seriesOf(byMaterial.get(entry.material) ?? [], entry.material);
      return { ...entry, groupCount: series.groups.length, latest: latestOf(series), trendMh: trendOf(series, "mh"), trendMv: trendOf(series, "mv") };
    });
  }

  const distinct = (values) => [...new Set(values.filter(isNumber))].sort((a, b) => a - b);

  // เงื่อนไขทดสอบที่ใช้จริง: ถ้าทุกแถวใช้อุณหภูมิและเวลาเดียวกัน หน้าจอแสดงครั้งเดียวแทนคอลัมน์ซ้ำทุกแถว
  function testConditions(items) {
    const temperatures = distinct(items.map((item) => item.temperature));
    const minutes = distinct(items.map((item) => item.testMinutes));
    return { temperatures, minutes, uniform: temperatures.length <= 1 && minutes.length <= 1 };
  }

  // ลายนิ้วมือของข้อมูลที่แสดง ใช้ข้ามการวาดใหม่เมื่อรีเฟรชแล้วชีตไม่เปลี่ยน (FNV-1a 32 บิต พอสำหรับเทียบรอบต่อรอบ)
  function feedSignature(rows) {
    let hash = 0x811c9dc5;
    const feed = (value) => {
      const part = String(value ?? "");
      for (let index = 0; index < part.length; index += 1) {
        hash ^= part.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      hash ^= 0x1f;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    };
    for (const row of rows) [row.id, row.material, row.mh, row.mv, row.temperature, row.testMinutes, ...statsOf(row)].forEach(feed);
    return `${rows.length}:${hash.toString(16)}`;
  }

  // ตารางข้อความคั่นด้วยแท็บ (วางลง Excel ได้) — ช่องที่มีแท็บหรือขึ้นบรรทัดใหม่ถูกแทนด้วยช่องว่าง
  function toTsv(rows) {
    return rows.map((cells) => cells.map((cell) => String(cell ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
  }

  const MINUS = "−";

  // ผลต่างมีเครื่องหมาย +/− (ติดศูนย์ = 0.00 ไม่ใส่เครื่องหมาย) ไม่มีค่า = —
  function formatSigned(value) {
    if (!isNumber(value)) return EMPTY;
    const fixed = Math.abs(value).toFixed(2);
    if (Number(fixed) === 0) return "0.00";
    return `${value < 0 ? MINUS : "+"}${fixed}`;
  }

  // YYYY-MM-DD → DD/MM (ป้ายบนแกนกราฟ) รูปแบบอื่นคืนเป็น —
  function formatShortDate(value) {
    const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    return match ? `${match[2]}/${match[1]}` : EMPTY;
  }

  // เวลาที่อ่านชีตล่าสุด เฉพาะเวลา HH:MM:SS (เวลาไทย) — วันที่คือวันนี้เสมอเพราะเป็นการอ่านเมื่อครู่ ไม่ต้องแสดงซ้ำ
  function formatUpdatedTime(value) {
    const full = formatUpdatedAt(value);
    return full === EMPTY ? EMPTY : full.slice(11);
  }

  const api = {
    MAX_MATERIAL_LENGTH, SORT_OPTIONS,
    readMaterial, materialUrl, normalizeFeed, buildOverview, resultsFor,
    filterMaterials, sortMaterials, suggestMaterials,
    formatDate, formatTime, formatReading, formatPlain, formatUpdatedAt, formatUpdatedTime,
    buildSeries, describe, niceScale, dateMarks, startOfLastDays, idsFor, idSeries, latestOf, trendOf, buildMaterialSummaries,
    testConditions, feedSignature, toTsv, formatSigned, formatShortDate,
  };
  // Shared by the browser and the sync worker; one implementation of grouping/statistics.
  root.MNP_LAB_MOONEY = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
