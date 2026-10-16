// โมเดลข้อมูลผลทดสอบ Mooney ของโมดูล MNP LAB — ข้อมูลล้วน ไม่มี DOM/Supabase เทสต์ที่ scripts/tests/lab-mooney-model.test.mjs
//
// ผลลัพธ์ของ RPC (app_lab_mooney_overview / app_lab_mooney_results ใน 20261016020000_mnp_lab_mooney.sql) ถูกแปลงผ่าน
// normalize* ที่นี่ที่เดียว หน้าเว็บ (modules/module-lab.js) จึงรับเฉพาะรูปแบบที่ตรวจแล้ว: ตัวเลขเป็น number|null
// วันที่เป็นสตริง YYYY-MM-DD (ไม่ผ่าน Date เพื่อไม่ให้เขตเวลาทำให้วันเลื่อน)
(function (root) {
  const MAX_MATERIAL_LENGTH = 60;

  const number = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // วัสดุจาก query string (#/lab?material=…) — ตัดช่องว่าง จำกัดความยาวเท่าฐานข้อมูล ว่าง = ไม่เลือก
  function readMaterial(value) {
    const text = String(value ?? "").trim();
    return text && text.length <= MAX_MATERIAL_LENGTH ? text : null;
  }

  function materialUrl(material) {
    const name = readMaterial(material);
    return name ? `#/lab?material=${encodeURIComponent(name)}` : "#/lab";
  }

  function normalizeOverview(data) {
    const list = Array.isArray(data?.materials) ? data.materials : [];
    return {
      syncedAt: data?.synced_at ?? null,
      materials: list
        .map((item) => ({
          material: String(item?.material ?? ""),
          resultCount: number(item?.result_count) ?? 0,
          testDays: number(item?.test_days) ?? 0,
          firstTested: item?.first_tested ?? null,
          lastTested: item?.last_tested ?? null,
        }))
        .filter((item) => item.material),
    };
  }

  function normalizeResults(data) {
    return (Array.isArray(data) ? data : []).map((row) => ({
      id: String(row?.id ?? ""),
      sampleId: String(row?.sample_id ?? ""),
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
    }));
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

  const syncedFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // เวลาที่ซิงก์ล่าสุด เป็นเวลาไทย "DD/MM/YYYY HH:MM" ไม่มีค่า/อ่านไม่ได้ = —
  function formatSyncedAt(value) {
    if (!value) return EMPTY;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? EMPTY : syncedFormat.format(date).replace(", ", " ");
  }

  const api = {
    MAX_MATERIAL_LENGTH, SORT_OPTIONS,
    readMaterial, materialUrl, normalizeOverview, normalizeResults,
    filterMaterials, sortMaterials, summarize,
    formatDate, formatTime, formatReading, formatPlain, formatSyncedAt,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_MOONEY = api;
})(typeof window !== "undefined" ? window : globalThis);
