// โมเดลข้อมูลผลทดสอบ Mooney ของโมดูล MNP LAB — ข้อมูลล้วน ไม่มี DOM/Supabase เทสต์ที่ scripts/tests/lab-mooney-model.test.mjs
//
// ข้อมูลมาจากฟีดสดของ Apps Script (apps-script/lab-mooney/Code.gs → doPost) ซึ่งอ่านชีต Mooney_Test_Report ทุกครั้งที่ถูกเรียก
// ผลถูกแปลงผ่าน normalizeFeed ที่นี่ที่เดียว หน้าเว็บ (modules/module-lab.js) จึงรับเฉพาะรูปแบบที่ตรวจแล้ว: ตัวเลขเป็น number|null
// วันที่เป็นสตริง YYYY-MM-DD (ไม่ผ่าน Date เพื่อไม่ให้เขตเวลาทำให้วันเลื่อน) สรุปรายวัสดุคำนวณจากแถวชุดเดียวกัน ไม่มีสำเนาที่ไหน
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

  // ฟีดจาก Apps Script: { ok, generated_at, rows, problem_count, problems, skipped } — แถวที่ไม่มีวัสดุหรือวันที่ถูกทิ้ง
  function normalizeFeed(body) {
    const strings = (value) => (Array.isArray(value) ? value.map(text) : []);
    return {
      generatedAt: body?.generated_at ?? null,
      rows: (Array.isArray(body?.rows) ? body.rows : []).map(normalizeRow).filter((row) => row.material && row.testDate),
      problemCount: number(body?.problem_count) ?? 0,
      problems: strings(body?.problems),
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

  function summarize(materials) {
    return {
      materialCount: materials.length,
      resultCount: materials.reduce((sum, item) => sum + item.resultCount, 0),
      lastTested: materials.reduce((latest, item) => (item.lastTested && item.lastTested > (latest ?? "") ? item.lastTested : latest), null),
    };
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

  const api = {
    MAX_MATERIAL_LENGTH, SORT_OPTIONS,
    readMaterial, materialUrl, normalizeFeed, buildOverview, resultsFor,
    filterMaterials, sortMaterials, summarize,
    formatDate, formatTime, formatReading, formatPlain, formatUpdatedAt,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_MOONEY = api;
})(typeof window !== "undefined" ? window : globalThis);
