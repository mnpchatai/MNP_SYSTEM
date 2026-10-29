// RubberFlow MES (แผนก RB โหมดทดสอบ) — ค่าคงที่ สเปกกระบวนการ สูตรคำนวณ และการจัดรูปแบบ ยกมาจากต้นแบบ
// prototypes/rubber-mes/src/lib/rules.js + lib/format.js ทั้งไฟล์ (เปลี่ยนเฉพาะรูปแบบโมดูล: script ธรรมดา + CommonJS)
// ไม่มี DOM/Supabase เทสต์ด้วย node --test (scripts/tests/rubberflow-rules.test.mjs)
//
// สายผลิต 4 สถานี: ผสม (mixing) → ฉีด (extrusion) → อบ (curing) → ตกแต่ง/บรรจุ (finishing)
// SPECS คือช่วงที่ยอมรับของแต่ละค่า ค่าที่หลุดช่วงทำให้ล็อตถูก QC Hold อัตโนมัติใน modules/rubberflow-actions.js
(function (root) {
  const DAY = 86400000;
  const HOUR = 3600000;

  const STAGES = Object.freeze(["mixing", "extrusion", "curing", "finishing"]);
  const STAGE_LABEL = Object.freeze({
    warehouse: "คลังวัตถุดิบ",
    mixing: "ผสมยาง",
    extrusion: "ฉีดขึ้นรูป",
    curing: "อบ HCM",
    finishing: "ตกแต่งและบรรจุ",
    fg: "คลังสินค้าสำเร็จรูป",
  });
  const NEXT_STAGE = Object.freeze({ mixing: "extrusion", extrusion: "curing", curing: "finishing" });
  const PREV_STAGE = Object.freeze({ extrusion: "mixing", curing: "extrusion", finishing: "curing" });

  const SHIFTS = Object.freeze([
    { id: "D", label: "กะ D (07:00–15:00)" },
    { id: "E", label: "กะ E (15:00–23:00)" },
    { id: "N", label: "กะ N (23:00–07:00)" },
  ].map((shift) => Object.freeze(shift)));

  const MACHINES = Object.freeze({
    mixing: Object.freeze(["KN-01 Kneader 75L", "BM-02 Banbury 110L"]),
    extrusion: Object.freeze(["EX-11 Extruder Ø90", "EX-12 Extruder Ø60"]),
  });

  // ช่วงกระบวนการที่ใช้ตัดสิน QC Hold อัตโนมัติ (target ± tol หรือ min/max)
  const SPECS = Object.freeze({
    extrusion: Object.freeze({
      thickness: Object.freeze({ label: "ความหนา", unit: "mm", target: 2.5, tol: 0.12 }),
      width: Object.freeze({ label: "ความกว้าง", unit: "mm", target: 18, tol: 0.25 }),
      weightPerM: Object.freeze({ label: "น้ำหนักต่อเมตร", unit: "g/m", target: 160, tol: 6 }),
      reworkMaxPct: 10,
    }),
    curing: Object.freeze({
      temp: Object.freeze({ label: "อุณหภูมิอบ", unit: "°C", target: 200, tol: 6 }),
      time: Object.freeze({ label: "เวลาอบ", unit: "s", target: 150, tol: 10 }),
      pressure: Object.freeze({ label: "ความดัน", unit: "bar", target: 150, tol: 15 }),
    }),
    lab: Object.freeze({
      hardness: Object.freeze({ label: "ความแข็ง", unit: "Shore A", target: 65, tol: 5, method: "ASTM D2240" }),
      tensile: Object.freeze({ label: "ความต้านแรงดึง", unit: "MPa", min: 10, method: "ASTM D412" }),
      elongation: Object.freeze({ label: "การยืดตัว ณ จุดขาด", unit: "%", min: 300, method: "ASTM D412" }),
      sg: Object.freeze({ label: "ความถ่วงจำเพาะ", unit: "-", target: 1.18, tol: 0.03, method: "ASTM D297" }),
      t90: Object.freeze({ label: "เวลาสุก MDR t90", unit: "min", target: 3.2, tol: 0.5, method: "ASTM D5289" }),
    }),
  });

  const WEIGH_TOL_PCT = 1.5; // ค่าเบี่ยงเบนที่ยอมรับต่อวัตถุดิบหนึ่งรายการ
  const WEIGH_TOL_MIN_KG = 0.02;

  const isBlank = (value) => value === "" || value === null || value === undefined || Number.isNaN(Number(value));

  function inSpec(value, spec) {
    if (isBlank(value)) return false;
    const v = Number(value);
    if (spec.min !== undefined && v < spec.min) return false;
    if (spec.max !== undefined && v > spec.max) return false;
    if (spec.target !== undefined && Math.abs(v - spec.target) > spec.tol + 1e-9) return false;
    return true;
  }

  function specText(spec) {
    if (spec.target !== undefined) return `${spec.target} ± ${spec.tol} ${spec.unit}`;
    if (spec.min !== undefined) return `≥ ${spec.min} ${spec.unit}`;
    return `≤ ${spec.max} ${spec.unit}`;
  }

  function specLimits(spec) {
    if (spec.target !== undefined) return { lsl: spec.target - spec.tol, usl: spec.target + spec.tol };
    return { lsl: spec.min, usl: spec.max };
  }

  const weighTolerance = (targetKg) => Math.max(WEIGH_TOL_MIN_KG, (targetKg * WEIGH_TOL_PCT) / 100);

  // น้ำหนักวัตถุดิบต่อ batch จาก PHR (ส่วนต่อยาง 100 ส่วน)
  function recipeLines(recipe) {
    const total = recipe.items.reduce((sum, item) => sum + Number(item.phr), 0);
    return recipe.items.map((item) => ({ ...item, kgPerBatch: total ? (Number(item.phr) / total) * recipe.batchKg : 0 }));
  }

  const totalPhr = (recipe) => recipe.items.reduce((sum, item) => sum + Number(item.phr), 0);

  function lotState(lot, now) {
    if (lot.status === "hold") return "hold";
    if (lot.qtyKg <= 0.0001) return "empty";
    if (lot.expiry <= now) return "expired";
    return "available";
  }

  // จัดสรรล็อตแบบหมดอายุก่อนจ่ายก่อน (FEFO) จากล็อตที่ใช้ได้ หักที่จองไว้แล้ว (reserved[lotNo] = kg)
  function allocateFefo(materialLots, materialCode, kgNeeded, now, reserved = {}) {
    const candidates = materialLots
      .filter((lot) => lot.materialCode === materialCode && lotState(lot, now) === "available")
      .map((lot) => ({ lot, free: lot.qtyKg - (reserved[lot.lotNo] || 0) }))
      .filter((candidate) => candidate.free > 0.0001)
      .sort((a, b) => a.lot.expiry - b.lot.expiry || a.lot.receivedAt - b.lot.receivedAt);
    const picks = [];
    let remaining = kgNeeded;
    for (const candidate of candidates) {
      if (remaining <= 0.0001) break;
      const take = Math.min(candidate.free, remaining);
      picks.push({ lotNo: candidate.lot.lotNo, kg: take });
      remaining -= take;
    }
    return { picks, shortage: Math.max(0, remaining) };
  }

  // สถิติ I-MR: เส้นควบคุมและ Cp/Cpk ใช้ σ ภายในกลุ่ม (MR̄ / d2, d2 = 1.128) Ppk ใช้ SD รวม
  function stats(values, lsl, usl) {
    const n = values.length;
    if (n < 2) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / n;
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
    const mrBar = values.slice(1).reduce((sum, value, index) => sum + Math.abs(value - values[index]), 0) / (n - 1);
    const sdWithin = mrBar / 1.128;
    const out = { n, mean, sd, sdWithin, min: Math.min(...values), max: Math.max(...values), ucl: mean + 3 * sdWithin, lcl: mean - 3 * sdWithin };
    const index = (sigma) => {
      if (!(sigma > 0)) return {};
      if (lsl !== undefined && usl !== undefined) return { p: (usl - lsl) / (6 * sigma), pk: Math.min(usl - mean, mean - lsl) / (3 * sigma) };
      if (lsl !== undefined) return { pk: (mean - lsl) / (3 * sigma) };
      if (usl !== undefined) return { pk: (usl - mean) / (3 * sigma) };
      return {};
    };
    const within = index(sdWithin);
    out.cp = within.p;
    out.cpk = within.pk;
    out.ppk = index(sd).pk;
    return out;
  }

  function cpkVerdict(cpk) {
    if (cpk === undefined || cpk === null) return { tone: "muted", text: "ข้อมูลไม่พอ" };
    if (cpk >= 1.67) return { tone: "good", text: "ดีมาก (≥ 1.67)" };
    if (cpk >= 1.33) return { tone: "good", text: "ผ่านเกณฑ์ (≥ 1.33)" };
    if (cpk >= 1.0) return { tone: "warn", text: "ควรเฝ้าระวัง (1.00–1.33)" };
    return { tone: "bad", text: "ไม่ผ่าน (< 1.00)" };
  }

  // ---------- การจัดรูปแบบ (lib/format.js ของต้นแบบ) ----------
  const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  function fmtDate(ms) {
    if (!ms) return "-";
    const d = new Date(ms);
    return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${String(d.getFullYear() + 543).slice(2)}`;
  }

  function fmtDateTime(ms) {
    if (!ms) return "-";
    const d = new Date(ms);
    return `${fmtDate(ms)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function fmtNum(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
    return Number(n).toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtDuration(ms) {
    if (ms <= 0) return "ครบแล้ว";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h} ชม. ${m} นาที` : `${m} นาที`;
  }

  function ymd(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function toInputDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function fromInputDate(text) {
    const [y, m, d] = String(text ?? "").split("-").map(Number);
    if (!y || !m || !d) return NaN;
    return new Date(y, m - 1, d).getTime();
  }

  // แกนกราฟแบบตัวเลขกลม ๆ (ใช้กับกราฟ SVG ของหน้าภาพรวมและ SPC)
  function niceScale(min, max, tickCount = 4) {
    let low = Number.isFinite(min) ? min : 0;
    let high = Number.isFinite(max) ? max : low + 1;
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

  const api = {
    DAY, HOUR, STAGES, STAGE_LABEL, NEXT_STAGE, PREV_STAGE, SHIFTS, MACHINES, SPECS, WEIGH_TOL_PCT, WEIGH_TOL_MIN_KG,
    inSpec, specText, specLimits, weighTolerance, recipeLines, totalPhr, lotState, allocateFefo, stats, cpkVerdict,
    fmtDate, fmtDateTime, fmtNum, fmtDuration, ymd, toInputDate, fromInputDate, niceScale,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_RUBBERFLOW_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
