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

  // วัสดุจาก query string (#/lab?module=mooney&material=…) — ตัดช่องว่าง จำกัดความยาว 60 ตัวอักษร ว่าง = ไม่เลือก
  function readMaterial(value) {
    const text = String(value ?? "").trim();
    return text && text.length <= MAX_MATERIAL_LENGTH ? text : null;
  }

  // หน้าวัสดุอยู่ในโมดูล Mooney test report ของ MNP LAB (ดู lab-sections.js) ไม่มีวัสดุ = รายการวัสดุของโมดูลนี้
  function materialUrl(material) {
    const name = readMaterial(material);
    return name ? `#/lab?module=mooney&material=${encodeURIComponent(name)}` : "#/lab?module=mooney";
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

  // ตัวเลขของแดชบอร์ด MNP LAB จากสรุปรายวัสดุในฟีด (ไม่ต้องใช้แถวผลทดสอบ): จำนวนวัสดุ ผลทดสอบรวม
  // วันที่ทดสอบล่าสุด และจำนวนวัสดุที่ทดสอบในวันนั้น (วันที่เป็น ISO เทียบเป็นสตริงได้)
  function overviewStats(materials) {
    const list = Array.isArray(materials) ? materials : [];
    let resultCount = 0;
    let lastTested = null;
    let latestMaterialCount = 0;
    for (const item of list) {
      const count = Number(item?.resultCount);
      if (Number.isFinite(count) && count > 0) resultCount += count;
      const date = typeof item?.lastTested === "string" && item.lastTested ? item.lastTested : null;
      if (!date) continue;
      if (lastTested === null || date > lastTested) {
        lastTested = date;
        latestMaterialCount = 1;
      } else if (date === lastTested) latestMaterialCount += 1;
    }
    return { materialCount: list.length, resultCount, lastTested, latestMaterialCount };
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

  // เดือนของวันที่ทดสอบ "YYYY-MM" (ไม่มีวันที่ = null) และรายการเดือนที่มีในรายการ เรียงเก่า → ใหม่ ใช้ทำตัวเลือก "เดือน … ถึง …" ของกราฟ
  const monthOf = (testDate) => (typeof testDate === "string" && /^\d{4}-\d{2}/.test(testDate) ? testDate.slice(0, 7) : null);
  function monthsOf(items) {
    return [...new Set(items.map((item) => monthOf(item.testDate)).filter(Boolean))].sort();
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

  // สรุปรายวัสดุสำหรับหน้ารวม: ข้อมูลเดิมของ buildOverview + ผลล่าสุด + แนวโน้ม + จำนวนชุด + สุขภาพของกระบวนการ (แดชบอร์ด)
  function buildMaterialSummaries(rows) {
    const byMaterial = new Map();
    for (const row of rows) {
      const list = byMaterial.get(row.material);
      if (list) list.push(row);
      else byMaterial.set(row.material, [row]);
    }
    // ตารางรายโม่ของแดชบอร์ดเก็บเฉพาะ MILL_DAYS วันล่าสุดนับจากวันทดสอบล่าสุดของทั้งชีต (สรุปถูกส่งทุกหน้าทุกรอบรีเฟรช จึงต้องเล็ก)
    const latestDate = rows.reduce((max, row) => (row.testDate > max ? row.testDate : max), "");
    const since = latestDate ? shiftDate(latestDate, -(MILL_DAYS - 1)) : null;
    return buildOverview(rows).map((entry) => {
      const series = seriesOf(byMaterial.get(entry.material) ?? [], entry.material);
      return {
        ...entry, groupCount: series.groups.length, latest: latestOf(series), trendMh: trendOf(series, "mh"), trendMv: trendOf(series, "mv"),
        health: materialHealth(series, { since }),
      };
    });
  }

  const distinct = (values) => [...new Set(values.filter(isNumber))].sort((a, b) => a - b);

  // เงื่อนไขทดสอบที่ใช้จริง: ถ้าทุกแถวใช้อุณหภูมิและเวลาเดียวกัน หน้าจอแสดงครั้งเดียวแทนคอลัมน์ซ้ำทุกแถว
  function testConditions(items) {
    const temperatures = distinct(items.map((item) => item.temperature));
    const minutes = distinct(items.map((item) => item.testMinutes));
    return { temperatures, minutes, uniform: temperatures.length <= 1 && minutes.length <= 1 };
  }

  /* ---------- สุขภาพของกระบวนการ (แดชบอร์ด MNP LAB) ---------- */
  // คำนวณครั้งเดียวต่อรอบซิงก์ในตัวซิงก์ (supabase/functions/lab-sheet-sync) แล้วเก็บในสรุปรายวัสดุ หน้าเว็บไม่ต้องรับแถวทั้งหมดมาคำนวณ
  // ชีตไม่มีค่าสเปก จึงไม่ตัดสินผ่าน/ไม่ผ่าน ใช้เส้นควบคุมจากประวัติของวัสดุเองแทน (บอกว่า "ต่างจากปกติของวัสดุนี้" ไม่ใช่ "เสีย")

  // ค่า AVG ที่ชีตให้มาใช้ได้เมื่ออยู่ในช่วงต่ำสุด–สูงสุดของค่าที่อ่านได้ของชุดเดียวกัน (ค่าเฉลี่ยของชุดใดๆ ไม่มีทางอยู่นอกช่วงนี้)
  // ถ้าอยู่นอกช่วง (เช่น สูตรในชีตอ้างช่วงผิดจน AVG MH ได้ 2.6 ทั้งที่อ่านได้ 25) แปลว่าไม่ใช่ AVG ของแถวเหล่านี้
  // ค่าที่ชีตแสดง 2 ตำแหน่ง จึงเผื่อคลาดเคลื่อนจากการปัดเศษเล็กน้อย (กราฟของหน้าวัสดุใช้กติกาเดียวกันนี้)
  const AVG_TOLERANCE = 0.005;
  function sheetAverageFits(average, readings) {
    const { count, min, max } = describe(readings);
    return isNumber(average) && count > 0 && average >= min - AVG_TOLERANCE && average <= max + AVG_TOLERANCE;
  }

  // จำนวนชุดขั้นต่ำของเส้นควบคุม: น้อยกว่า PROVISIONAL = ยังไม่ตั้งเส้น, น้อยกว่า READY = เส้นชั่วคราว (ยังเลื่อนได้มากเมื่อมีชุดใหม่)
  // 40 ชุดตามแนวปฏิบัติของห้องแล็บยางที่ค้นพบ (ตั้งเกณฑ์ควบคุมจากราว 40 ชุดการผลิตต่อสูตร) ไม่ใช่ข้อกำหนดของโรงงาน
  const CONTROL_MIN_PROVISIONAL = 10;
  const CONTROL_MIN_READY = 40;
  // ค่าเฉลี่ยรายชุดล่าสุดที่เก็บไว้วาดกราฟเส้นควบคุมบนแดชบอร์ด
  const CONTROL_RECENT = 30;
  // ค่าคงที่ d2 ของช่วงเคลื่อนที่ขนาด 2 (σ ≈ MR̄ / 1.128) ตามแผนภูมิ I-MR
  const D2 = 1.128;

  const round4 = (value) => (isNumber(value) ? Number(value.toFixed(4)) : null);

  // ระยะจากเส้นกลางเป็นจำนวน σ และโซน: เกิน 3σ = "out", เกิน 2σ = "warn", นอกนั้น = "ok"
  const zScore = (value, limits) => (value - limits.mean) / limits.sigma;
  const zoneOf = (z) => (Math.abs(z) > 3 ? "out" : Math.abs(z) > 2 ? "warn" : "ok");

  // ช่วงที่ใช้งานได้จริงของ MV: ค่ากลางของวัสดุ ± 5 MU ตามแนวปฏิบัติทั่วไปในอุตสาหกรรมยาง (ไม่ใช่มาตรฐานบังคับ)
  // ใช้เป็นระดับ "แดง" แทนสเปกจนกว่าชีตจะมีค่าสเปก ส่วน 3σ/กฎ Western Electric เป็นแค่สัญญาณเตือนล่วงหน้า (เหลือง)
  // เพราะวัสดุในโรงงานเลื่อนระดับระหว่างล็อต σ จากช่วงเคลื่อนที่จึงแคบกว่าความแปรปรวนจริงหลายเท่า (เกิน 3σ บ่อยโดยไม่มีผลต่อการผลิต)
  // MH (ค่าสูงสุดช่วงต้นกราฟ) ไม่มีเกณฑ์ใช้งานจริงที่อ้างอิงได้ จึงใช้เฉพาะสัญญาณทางสถิติ
  const PRACTICAL_BAND_MU = 5;
  // โซนของค่าเฉลี่ยรายชุดเทียบเส้นของวัสดุ: "out" = ห่างค่ากลางเกินช่วงใช้งานจริง (เฉพาะค่าที่มี band), "warn" = เกิน 2σ, "ok"
  function zoneFor(value, control) {
    const distance = value - control.mean;
    if (isNumber(control.band) && Math.abs(distance) > control.band) return "out";
    return control.sigma > 0 && Math.abs(distance / control.sigma) > 2 ? "warn" : "ok";
  }

  // เส้นควบคุมแบบ I-MR จากค่าตามลำดับ (เก่า → ใหม่): เส้นกลาง = ค่าเฉลี่ย, σ จากค่าเฉลี่ยช่วงเคลื่อนที่ (ไม่ใช้ SD รวม ซึ่งบวมเมื่อกระบวนการเลื่อน)
  // ค่าน้อยกว่า 2 ตัว หรือทุกค่าเท่ากัน (σ = 0) = ตั้งเส้นไม่ได้ (null)
  function controlLimits(values) {
    const list = values.filter(isNumber);
    if (list.length < 2) return null;
    const { mean } = describe(list);
    let ranges = 0;
    for (let index = 1; index < list.length; index += 1) ranges += Math.abs(list[index] - list[index - 1]);
    const sigma = ranges / (list.length - 1) / D2;
    if (!(sigma > 0)) return null;
    return { mean, sigma, ucl: mean + 3 * sigma, lcl: mean - 3 * sigma };
  }

  // กฎ Western Electric ที่จุดสุดท้ายของ values (จุดนั้นต้องเป็นส่วนหนึ่งของรูปแบบ จึงรายงานรูปแบบหนึ่งครั้งที่จุดที่ทำให้ครบ):
  //   beyond3 = จุดเกิน 3σ · twoOfThree = 2 ใน 3 จุดเกิน 2σ ข้างเดียวกัน
  //   fourOfFive = 4 ใน 5 จุดเกิน 1σ ข้างเดียวกัน · eightSameSide = 8 จุดอยู่ข้างเดียวกันของเส้นกลาง
  const RULES = Object.freeze(["beyond3", "twoOfThree", "fourOfFive", "eightSameSide"]);
  function ruleSignals(values, limits) {
    const list = values.filter(isNumber);
    if (!limits || !list.length) return [];
    const z = list.map((value) => zScore(value, limits));
    const last = z[z.length - 1];
    const side = Math.sign(last);
    const beyond = (count, size, level) => {
      if (z.length < size || Math.abs(last) <= level) return false;
      return z.slice(-size).filter((value) => Math.sign(value) === side && Math.abs(value) > level).length >= count;
    };
    const signals = [];
    if (Math.abs(last) > 3) signals.push("beyond3");
    if (beyond(2, 3, 2)) signals.push("twoOfThree");
    if (beyond(4, 5, 1)) signals.push("fourOfFive");
    if (side !== 0 && z.length >= 8 && z.slice(-8).every((value) => Math.sign(value) === side)) signals.push("eightSameSide");
    return signals;
  }

  // สัญญาณล่าสุดภายใน window ชุดล่าสุด (ชุดเดียวกับที่ตารางสีของแดชบอร์ดแสดง) ไล่จากชุดใหม่ไปเก่า
  // แดชบอร์ดไม่มีการแจ้งเตือนและไม่เก็บประวัติสัญญาณ จึงต้องยังเห็นชุดที่เกินเส้นแม้มีชุดปกติตามมาแล้ว
  // คืน { ago (0 = ชุดล่าสุด), value, rules, beyondBand } หรือ null เมื่อไม่มีชุดใดในช่วงเข้ากฎหรือเกินช่วงใช้งานจริง
  // band = ช่วงใช้งานจริง (MU) ของค่านั้น หรือ null เมื่อไม่มี (MH)
  const SIGNAL_WINDOW = 12;
  function latestSignal(values, limits, window = SIGNAL_WINDOW, band = null) {
    const list = values.filter(isNumber);
    if (!limits) return null;
    for (let ago = 0; ago < Math.min(window, list.length); ago += 1) {
      const upto = list.slice(0, list.length - ago);
      const value = upto[upto.length - 1];
      const rules = ruleSignals(upto, limits);
      const beyondBand = isNumber(band) && Math.abs(value - limits.mean) > band;
      if (rules.length || beyondBand) return { ago, value, rules, beyondBand };
    }
    return null;
  }

  // ระดับความพร้อมของเส้นควบคุมจากจำนวนชุด
  const controlLevel = (count) => (count >= CONTROL_MIN_READY ? "ready" : count >= CONTROL_MIN_PROVISIONAL ? "provisional" : "insufficient");

  // เส้นควบคุมของค่าเฉลี่ยรายชุดหนึ่งค่า (MV หรือ MH) และความแกว่งในเส้น (SD ของหัว-กลาง-ท้ายในชุด) เทียบกับปกติของวัสดุนั้น
  //   batches = [{ average, sd, date }] ของชุดเดียวกันเรียงตามลำดับในชีต (sd ของชุดอาจเป็น null) · band = ช่วงใช้งานจริง (MU) หรือ null
  //   level: "ready" | "provisional" | "insufficient" (ชุดไม่พอ) | "mixed" (สภาวะทดสอบไม่เท่ากัน เทียบกันตรง ๆ ไม่ได้) | "flat" (ทุกชุดเท่ากัน)
  //          | "otherTest" (ไม่มีแถวของการทดสอบความหนืดเลย)
  //   recent / recentDates = ค่าเฉลี่ยรายชุดล่าสุดและวันที่ของชุดนั้น (เก่า → ใหม่) สำหรับกราฟ ตารางสี และการตรวจเครื่อง
  //   signal = latestSignal + SD ของชุดนั้น (sd) · latestSd = SD ของชุดล่าสุดเอง (ไม่มี = null) · sdHigh = SD นั้นเกิน UCL ของ SD ในประวัติ
  // เส้นถูกปัด 4 ตำแหน่งก่อนใช้ตัดสิน เพื่อให้รายการ "ต้องดูก่อน" ตารางสี และกราฟ ตัดสินจากตัวเลขชุดเดียวกัน
  function measureControl(batches, uniform, band = null) {
    const pairs = batches.filter((pair) => isNumber(pair.average));
    const count = pairs.length;
    if (!uniform) return { level: "mixed", count };
    const level = controlLevel(count);
    if (level === "insufficient") return { level, count };
    const raw = controlLimits(pairs.map((pair) => pair.average));
    if (!raw) return { level: "flat", count };
    const limits = { mean: round4(raw.mean), sigma: round4(raw.sigma), ucl: round4(raw.ucl), lcl: round4(raw.lcl) };
    const values = pairs.map((pair) => round4(pair.average));
    const sdLimits = controlLimits(pairs.map((pair) => pair.sd));
    const latestSd = isNumber(pairs[count - 1].sd) ? round4(pairs[count - 1].sd) : null;
    const sdUcl = sdLimits ? round4(sdLimits.ucl) : null;
    const signal = latestSignal(values, limits, SIGNAL_WINDOW, band);
    const signalSd = signal ? pairs[count - 1 - signal.ago].sd : null;
    return {
      level, count, ...limits, band,
      recent: values.slice(-CONTROL_RECENT),
      recentDates: pairs.slice(-CONTROL_RECENT).map((pair) => pair.date),
      signal: signal ? { ...signal, sd: isNumber(signalSd) ? round4(signalSd) : null } : null,
      latestSd, sdUcl,
      sdHigh: isNumber(sdUcl) && isNumber(latestSd) && latestSd > sdUcl,
    };
  }

  // จำนวนวันระหว่างวันที่ ISO สองวัน (b − a) ไม่ผ่านเขตเวลา
  const dayNumber = (iso) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000 : null;
  };
  function daysBetween(a, b) {
    const start = dayNumber(a);
    const end = dayNumber(b);
    return start === null || end === null ? null : end - start;
  }

  function median(values) {
    const list = values.filter(isNumber).sort((a, b) => a - b);
    if (!list.length) return null;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  // การทดสอบความหนืด Mooney ตาม ISO 289-1 อ่านค่าที่ 4 นาที — ML(1+4) (ยาง butyl ที่ 8 นาที) แถวที่ใช้เวลาทดสอบอื่น
  // (เช่น 5–6 นาทีที่ 120–125 °C ของ E00030S B) เป็นการทดสอบอื่น เช่น scorch (ISO 289-2) ค่าที่อ่านไม่ใช่ความหนืด จึงไม่นำมาวิเคราะห์ร่วม
  // แถวที่ไม่ได้บันทึกเวลาทดสอบถือเป็นการทดสอบความหนืด (ไม่ตัดข้อมูลทิ้งเพราะช่องว่าง)
  const VISCOSITY_MINUTES = Object.freeze([4, 8]);
  const isViscosityTest = (item) => item.testMinutes === null || VISCOSITY_MINUTES.includes(item.testMinutes);

  // ID ของชีตเป็นเลข 3 หลัก = โม่ · เส้น · ส่วน (เช่น 412 = โม่ 4 เส้น 1 ส่วน 2) อนุมานจากรูปแบบข้อมูลจริง (ส่วน 1/2/3 น่าจะเป็นหัว/กลาง/ท้าย)
  // ID รูปแบบอื่น = null (ไม่นับเข้าตารางรายโม่)
  function parseSampleId(id) {
    const match = /^(\d)(\d)(\d+)$/.exec(String(id ?? "").trim());
    return match ? { mill: match[1], strand: match[2], part: match[3] } : null;
  }

  // ตารางรายโม่: วันละโม่ละหนึ่งแถว เทียบค่าเฉลี่ยของโม่กับมัธยฐานของสูตรเดียวกันในวันนั้น (ใช้มัธยฐานเพราะไม่ถูกดึงโดยโม่ที่ผิดปกติโม่เดียว)
  // วันที่มีโม่เดียวเทียบระหว่างโม่ไม่ได้ (dMv/dMh = null) · points = จุดที่ห่างมัธยฐานของวัน ≥ MILL_MIN_DIFF ใน MV หรือ MH ([ID, ΔMV, ΔMH])
  // ให้หน้าเว็บกรองตามเกณฑ์ที่ผู้ใช้เลือก (≥ MILL_MIN_DIFF) โดยไม่ต้องรับทุกแถว · suspect = มีค่าอ่านเป็น 0 (น่าจะลืมกรอก)
  const MILL_DAYS = 14;
  const MILL_MIN_DIFF = 2;
  // ปัด 2 ตำแหน่ง และไม่ให้ได้ −0 (ผลต่างที่ปัดแล้วเป็นศูนย์ต้องแสดงเป็น 0)
  const round2 = (value) => (isNumber(value) ? Number(value.toFixed(2)) + 0 : null);
  function millRows(items, since) {
    const byDay = new Map();
    for (const item of items) {
      const id = parseSampleId(item.sampleId);
      if (!id || (since && item.testDate < since)) continue;
      byDay.set(item.testDate, [...(byDay.get(item.testDate) ?? []), { item, id }]);
    }
    const rows = [];
    for (const [date, readings] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const medMv = median(readings.map((entry) => entry.item.mv));
      const medMh = median(readings.map((entry) => entry.item.mh));
      const mills = new Map();
      for (const entry of readings) mills.set(entry.id.mill, [...(mills.get(entry.id.mill) ?? []), entry]);
      const compared = mills.size >= 2;
      for (const [mill, entries] of [...mills.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const avgMv = describe(entries.map((entry) => entry.item.mv)).mean;
        const avgMh = describe(entries.map((entry) => entry.item.mh)).mean;
        const points = compared ? entries
          .map((entry) => [entry.item.sampleId, round2(entry.item.mv - medMv), round2(entry.item.mh - medMh)])
          .filter(([, dMv, dMh]) => Math.abs(dMv) >= MILL_MIN_DIFF || Math.abs(dMh) >= MILL_MIN_DIFF) : [];
        rows.push({
          date, mill, count: entries.length, mv: round2(avgMv), mh: round2(avgMh),
          dMv: compared ? round2(avgMv - medMv) : null, dMh: compared ? round2(avgMh - medMh) : null, points,
          suspect: entries.some((entry) => entry.item.mv === 0 || entry.item.mh === 0),
        });
      }
    }
    return rows;
  }

  // สุขภาพของวัสดุหนึ่งรายการ จากผลทั้งวัสดุตามลำดับในชีต (ใช้เฉพาะชุดของการทดสอบความหนืดที่ชีตมี AVG ใช้งานได้)
  //   mv / mh = measureControl (ช่วงใช้งานจริง ±5 MU เฉพาะ MV), uniform = แถวทดสอบความหนืดใช้อุณหภูมิ/เวลาเดียวกัน
  //   otherTestRows = จำนวนแถวที่เป็นการทดสอบอื่น (ไม่นำมาวิเคราะห์) · mills = ตารางรายโม่ตั้งแต่ since
  //   missingAvg = แถวที่ชีตยังไม่มี AVG/SD (จำนวน + วันที่เก่าสุด)
  //   typicalGapDays = ค่ามัธยฐานของระยะห่างระหว่างวันทดสอบ (มีวันทดสอบน้อยกว่า 3 วัน = null ยังไม่รู้ความถี่ปกติ)
  function materialHealth(series, { since = null } = {}) {
    const viscosityItems = series.items.filter(isViscosityTest);
    const conditions = testConditions(viscosityItems);
    const batches = series.groups.filter((group) => group.hasStats && group.items.every(isViscosityTest));
    const pick = (avgKey, sdKey, readingKey, band) => {
      if (!viscosityItems.length) return { level: "otherTest", count: 0 };
      const usable = batches.filter((group) => sheetAverageFits(group[avgKey], group.items.map((item) => item[readingKey])));
      return measureControl(usable.map((group) => ({ average: group[avgKey], sd: group[sdKey], date: group.lastDate })), conditions.uniform, band);
    };
    const missing = series.items.filter((item) => !hasStats(item)).map((item) => item.testDate).sort();
    const dates = [...new Set(series.items.map((item) => item.testDate))].sort();
    const gaps = dates.slice(1).map((date, index) => daysBetween(dates[index], date));
    return {
      uniform: conditions.uniform,
      otherTestRows: series.items.length - viscosityItems.length,
      mv: pick("avgMv", "sdMv", "mv", PRACTICAL_BAND_MU),
      mh: pick("avgMh", "sdMh", "mh", null),
      mills: conditions.uniform ? millRows(viscosityItems, since) : [],
      missingAvg: { count: missing.length, oldest: missing[0] ?? null },
      typicalGapDays: dates.length >= 3 ? median(gaps) : null,
    };
  }

  /* ---------- แดชบอร์ด: คำนวณในเบราว์เซอร์จากสรุปรายวัสดุ (ส่วนที่ขึ้นกับ "วันนี้") ---------- */

  const bangkokDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  // วันนี้ตามเวลาไทย "YYYY-MM-DD" (วันที่ทดสอบในชีตเป็นเวลาไทย)
  function todayInBangkok(now = new Date()) {
    return bangkokDay.format(now);
  }

  // วันที่ ISO ถอยหลัง n วัน (ไม่ผ่านเขตเวลา)
  function shiftDate(iso, days) {
    const base = dayNumber(iso);
    if (base === null) return null;
    return new Date((base + days) * 86400000).toISOString().slice(0, 10);
  }

  // วัสดุที่ "ไม่ได้ทดสอบนาน": เว้นมานานกว่า 3 เท่าของระยะปกติของวัสดุนั้น และอย่างน้อย 7 วัน (กันแจ้งวัสดุที่ทดสอบทุกวัน)
  // วัสดุที่ยังไม่รู้ระยะปกติ (ทดสอบไม่ถึง 3 วัน) ไม่ถูกแจ้ง เพราะอาจเป็นงานทดลองครั้งเดียว
  const OVERDUE_FACTOR = 3;
  const OVERDUE_MIN_DAYS = 7;

  // ชื่อวัสดุที่ควรตรวจ: ชื่อซ้ำกันเมื่อไม่สนตัวพิมพ์/ช่องว่าง (เช่น "c1301" กับ "C1301") หรือมีตัวพิมพ์เล็ก (รหัสวัสดุในชีตเป็นตัวพิมพ์ใหญ่)
  // ประวัติที่แยกเป็นสองชื่อทำให้เส้นควบคุมและจำนวนชุดผิด แก้ที่ชีต
  const nameKey = (name) => String(name ?? "").toUpperCase().replace(/\s+/g, "");
  function nameIssues(materials) {
    const groups = new Map();
    for (const item of materials) {
      const key = nameKey(item.material);
      groups.set(key, [...(groups.get(key) ?? []), item.material]);
    }
    const issues = new Map();
    for (const names of groups.values()) {
      if (names.length > 1) for (const name of names) issues.set(name, { kind: "duplicate", others: names.filter((other) => other !== name) });
    }
    for (const item of materials) {
      if (!issues.has(item.material) && /[a-z]/.test(item.material)) issues.set(item.material, { kind: "lowercase", others: [] });
    }
    return issues;
  }

  const SEVERITY = Object.freeze({ out: 0, warn: 1, info: 2 });
  const MEASURES = Object.freeze([{ key: "mv", label: "MV" }, { key: "mh", label: "MH" }]);

  // รายการ "ต้องดูก่อน" ของแดชบอร์ด เรียงจากรุนแรงสุด (out → warn → info) แล้วตามชื่อวัสดุ
  // แต่ละรายการ: { material, severity, kind, measure?, value?, limit?, signals?, count?, days?, others? }
  //   out  = ค่าเฉลี่ย MV ของชุดหนึ่งใน 12 ชุดล่าสุดห่างค่ากลางของวัสดุเกิน ±5 MU (ago = กี่ชุดก่อน, high = ด้านสูง)
  //   warn = เข้ากฎ Western Electric (รวมเกิน 3σ) · SD ในเส้นของชุดล่าสุดสูงกว่าปกติ · ตรวจเครื่อง (หลายวัสดุเลื่อนทางเดียวกันวันเดียวกัน)
  //   ทุกรายการสัญญาณมี strandStable (ในเส้นนิ่งหรือไม่) ให้หน้าจอบอกสาเหตุที่ควรตรวจ
  //   info = สภาวะทดสอบไม่เท่ากัน, แถวที่เป็นการทดสอบอื่น, ชุดที่ยังไม่มี AVG (ค้างมาก่อนวันนี้), ชื่อวัสดุที่ควรตรวจ, ไม่ได้ทดสอบนาน
  // วัสดุที่ไม่มี health (สรุปจากตัวซิงก์รุ่นก่อน) ถูกข้าม — ผู้เรียกตรวจ hasHealth ก่อนแสดง
  function attentionItems(materials, today) {
    const list = Array.isArray(materials) ? materials : [];
    const names = nameIssues(list);
    const items = [];
    for (const item of list) {
      const health = item?.health;
      if (!health) continue;
      const base = { material: item.material };
      for (const measure of MEASURES) {
        const control = health[measure.key];
        if (!control || !["ready", "provisional"].includes(control.level)) continue;
        const provisional = control.level === "provisional";
        const signal = control.signal;
        if (signal) {
          const high = signal.value > control.mean;
          // ในเส้นนิ่ง = SD ของชุดนั้นไม่เกิน UCL ของ SD ในประวัติ (ไม่รู้ = null) ใช้บอกสาเหตุที่ควรตรวจตามลำดับของหนังสือ
          const strandStable = isNumber(signal.sd) && isNumber(control.sdUcl) ? signal.sd <= control.sdUcl : null;
          const common = { ...base, measure: measure.label, key: measure.key, value: signal.value, ago: signal.ago, high, center: control.mean, provisional, strandStable, signals: signal.rules };
          if (signal.beyondBand) items.push({ ...common, severity: "out", kind: "outOfBand", band: control.band });
          else items.push({ ...common, severity: "warn", kind: "rule" });
        }
        if (control.sdHigh) items.push({ ...base, severity: "warn", kind: "sdHigh", measure: measure.label, value: control.latestSd, limit: control.sdUcl, provisional });
      }
      if (!health.uniform) items.push({ ...base, severity: "info", kind: "mixed" });
      if (health.otherTestRows) items.push({ ...base, severity: "info", kind: "otherTest", count: health.otherTestRows });
      if (health.missingAvg?.count && health.missingAvg.oldest && health.missingAvg.oldest < today) {
        items.push({ ...base, severity: "info", kind: "missingAvg", count: health.missingAvg.count });
      }
      const issue = names.get(item.material);
      if (issue) items.push({ ...base, severity: "info", kind: issue.kind === "duplicate" ? "duplicateName" : "lowercaseName", others: issue.others });
      const since = daysBetween(item.lastTested, today);
      if (isNumber(health.typicalGapDays) && isNumber(since) && since >= OVERDUE_MIN_DAYS && since > OVERDUE_FACTOR * health.typicalGapDays) {
        items.push({ ...base, severity: "info", kind: "overdue", days: since });
      }
    }
    return [...items, ...machineItems(list, today)].sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || byName(a, b));
  }

  // ตรวจเครื่อง: วันเดียวกัน หลายวัสดุ (อย่างน้อย 3) มีค่าเฉลี่ย MV ของชุดเลื่อนเกิน 2σ ไปทางเดียวกัน = ควรสงสัยเครื่องก่อนกระบวนการ
  // (อุณหภูมิ preheat น้ำหนักชิ้น) และตรวจด้วยยางอ้างอิง ดูเฉพาะชุดในช่วง 14 วันล่าสุดของวัสดุที่มีเส้นควบคุม
  // คืนรายการ { material: "", severity: "warn", kind: "machine", date, high, materials } เรียงวันใหม่ก่อน
  const MACHINE_MIN_MATERIALS = 3;
  const MACHINE_DAYS = 14;
  function machineItems(materials, today) {
    const since = shiftDate(today, -MACHINE_DAYS);
    const byDay = new Map();
    for (const item of materials) {
      const control = item?.health?.mv;
      if (!control || !["ready", "provisional"].includes(control.level) || !(control.sigma > 0) || !Array.isArray(control.recentDates)) continue;
      control.recent.forEach((value, index) => {
        const date = control.recentDates[index];
        const z = (value - control.mean) / control.sigma;
        if (!date || !since || date < since || date > today || Math.abs(z) <= 2) return;
        const key = `${date}|${z > 0 ? "high" : "low"}`;
        byDay.set(key, new Set([...(byDay.get(key) ?? []), item.material]));
      });
    }
    return [...byDay.entries()]
      .filter(([, names]) => names.size >= MACHINE_MIN_MATERIALS)
      .map(([key, names]) => {
        const [date, side] = key.split("|");
        return { material: "", severity: "warn", kind: "machine", date, high: side === "high", materials: [...names].sort() };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  const hasHealth = (materials) => Array.isArray(materials) && materials.some((item) => item?.health);

  /* ---------- ตารางรายโม่ของแดชบอร์ด (หนึ่งตารางพร้อมตัวกรอง) ---------- */
  // สถานะของแถว (ตัดสินในเบราว์เซอร์ตามเกณฑ์ที่ผู้ใช้เลือก):
  //   data = ตรวจข้อมูล (มีค่าอ่าน 0 หรือ MV ห่างมัธยฐานของวัน ≥ 10 MU ซึ่งเกินกว่าความต่างระหว่างโม่ปกติมาก น่าจะกรอกผิด)
  //   out  = ค่าเฉลี่ย MV ของโม่ห่างค่ากลางของสูตร (เส้นกลางจากประวัติ) เกิน ±5 MU
  //   warn = ค่าเฉลี่ย MV หรือ MH ของโม่ต่างจากมัธยฐานของวันเกินเกณฑ์ (±2/3/5 MU)
  //   ok   = ปกติ · single = วันนั้นมีโม่เดียว เทียบระหว่างโม่ไม่ได้
  const MILL_THRESHOLDS = Object.freeze([2, 3, 5]);
  const MILL_STATUS = Object.freeze({ out: 0, data: 1, warn: 2, ok: 3, single: 4 });
  const SUSPECT_DIFF = 10;

  // รูปแบบของจุดที่เกินเกณฑ์ในโม่: ทั้งโม่ (≥ 5 จุดครบสองเส้น) · ทั้งเส้น (≥ 3 จุดในเส้นเดียว) · เฉพาะจุด
  function millPattern(points) {
    if (!points.length) return null;
    const strands = [...new Set(points.map((point) => parseSampleId(point[0])?.strand).filter(Boolean))];
    if (points.length >= 5 && strands.length >= 2) return { kind: "mill" };
    if (points.length >= 3 && strands.length === 1) return { kind: "strand", strand: strands[0] };
    return { kind: "spot" };
  }

  // แถวของตาราง จากสรุปรายวัสดุ: กรองตามคำค้น ช่วงวัน (นับย้อนจากวันนี้) และสถานะ แล้วเรียงสถานะรุนแรงก่อน วันใหม่ก่อน
  // filters = { query, days, threshold, status: "attention" (ไม่ปกติ) | "all" | ชื่อสถานะ }
  function millTableRows(materials, today, { query = "", days = MILL_DAYS, threshold = MILL_MIN_DIFF, status = "attention" } = {}) {
    const since = shiftDate(today, -(days - 1));
    const needle = String(query ?? "").trim().toLowerCase();
    const limit = Math.max(MILL_MIN_DIFF, Number(threshold) || MILL_MIN_DIFF);
    const rows = [];
    for (const item of Array.isArray(materials) ? materials : []) {
      if (needle && !item.material.toLowerCase().includes(needle)) continue;
      const center = ["ready", "provisional"].includes(item.health?.mv?.level) ? item.health.mv.mean : null;
      for (const mill of item.health?.mills ?? []) {
        if (!since || mill.date < since || mill.date > today) continue;
        const points = mill.points.filter(([, dMv, dMh]) => Math.abs(dMv) > limit || Math.abs(dMh) > limit);
        const fromCenter = isNumber(center) && isNumber(mill.mv) ? round2(mill.mv - center) : null;
        let state = "ok";
        if (mill.dMv === null) state = "single";
        if (isNumber(mill.dMv) && (Math.abs(mill.dMv) > limit || Math.abs(mill.dMh) > limit)) state = "warn";
        if (isNumber(fromCenter) && Math.abs(fromCenter) > PRACTICAL_BAND_MU) state = "out";
        if (mill.suspect || mill.points.some(([, dMv]) => Math.abs(dMv) >= SUSPECT_DIFF)) state = "data";
        rows.push({ material: item.material, ...mill, points, fromCenter, status: state, pattern: millPattern(points) });
      }
    }
    const wanted = status === "all" ? null : status === "attention" ? ["out", "data", "warn"] : [status];
    return rows
      .filter((row) => !wanted || wanted.includes(row.status))
      .sort((a, b) => MILL_STATUS[a.status] - MILL_STATUS[b.status] || b.date.localeCompare(a.date) || byName(a, b) || a.mill.localeCompare(b.mill));
  }

  // เรื่องของข้อมูลที่ไม่ใช่ของโม่ใดโม่หนึ่ง (แสดงรวมในกล่องพับ): สภาวะทดสอบต่างกัน การทดสอบอื่น ข้อมูลไม่ครบ ชื่อวัสดุ ไม่ได้ทดสอบนาน
  const NOTICE_KINDS = Object.freeze(["mixed", "otherTest", "missingAvg", "duplicateName", "lowercaseName", "overdue"]);
  function dataNotices(materials, today) {
    return attentionItems(materials, today).filter((item) => NOTICE_KINDS.includes(item.kind));
  }

  // วัสดุที่มีเส้นควบคุม (MV หรือ MH ตั้งเส้นได้) สำหรับตัวเลือกของกราฟเส้นควบคุม: พร้อมก่อน แล้วชั่วคราว แล้วตามจำนวนชุดมากสุด
  function controlMaterials(materials) {
    const rank = { ready: 0, provisional: 1 };
    const usable = (item) => ["mv", "mh"].some((key) => Object.hasOwn(rank, item?.health?.[key]?.level ?? ""));
    return (Array.isArray(materials) ? materials : []).filter(usable).sort((a, b) =>
      (rank[a.health.mv.level] ?? 2) - (rank[b.health.mv.level] ?? 2) || (b.health.mv.count ?? 0) - (a.health.mv.count ?? 0) || byName(a, b));
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

  // เดือนแบบย่อ + ปี ค.ศ. เหมือนวันที่ทุกที่ในหน้านี้ ("2026-09" → "ก.ย. 2026") ค่าที่อ่านไม่ได้ = —
  const MONTH_NAMES = Object.freeze(["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]);
  function formatMonth(month) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month ?? ""));
    return match ? `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}` : EMPTY;
  }

  // เวลาที่อ่านชีตล่าสุด เฉพาะเวลา HH:MM:SS (เวลาไทย) — วันที่คือวันนี้เสมอเพราะเป็นการอ่านเมื่อครู่ ไม่ต้องแสดงซ้ำ
  function formatUpdatedTime(value) {
    const full = formatUpdatedAt(value);
    return full === EMPTY ? EMPTY : full.slice(11);
  }

  const api = {
    MAX_MATERIAL_LENGTH, SORT_OPTIONS,
    readMaterial, materialUrl, normalizeFeed, buildOverview, overviewStats, resultsFor,
    filterMaterials, sortMaterials, suggestMaterials,
    formatDate, formatTime, formatReading, formatPlain, formatUpdatedAt, formatUpdatedTime,
    buildSeries, describe, niceScale, dateMarks, monthOf, monthsOf, idsFor, idSeries, latestOf, trendOf, buildMaterialSummaries,
    testConditions, feedSignature, toTsv, formatSigned, formatShortDate, formatMonth,
    AVG_TOLERANCE, CONTROL_MIN_PROVISIONAL, CONTROL_MIN_READY, CONTROL_RECENT, MILL_DAYS, MILL_MIN_DIFF, MILL_THRESHOLDS, OVERDUE_FACTOR, OVERDUE_MIN_DAYS, RULES, SIGNAL_WINDOW, PRACTICAL_BAND_MU, VISCOSITY_MINUTES, MACHINE_MIN_MATERIALS, MACHINE_DAYS,
    sheetAverageFits, controlLimits, ruleSignals, latestSignal, zoneOf, zoneFor, isViscosityTest, machineItems, parseSampleId, millRows, millPattern, millTableRows, dataNotices, materialHealth, daysBetween, todayInBangkok, shiftDate,
    nameIssues, attentionItems, hasHealth, controlMaterials,
  };
  // Shared by the browser and the sync worker; one implementation of grouping/statistics.
  root.MNP_LAB_MOONEY = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
