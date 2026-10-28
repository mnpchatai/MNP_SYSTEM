// Domain constants, specifications and pure calculation helpers.

export const DAY = 86400000;
export const HOUR = 3600000;

export const STAGES = ['mixing', 'extrusion', 'curing', 'finishing'];
export const STAGE_LABEL = {
  warehouse: 'คลังวัตถุดิบ',
  mixing: 'ผสมยาง',
  extrusion: 'รีดขึ้นรูป',
  curing: 'อบวัลคาไนซ์',
  finishing: 'ตกแต่งและบรรจุ',
  fg: 'คลังสินค้าสำเร็จรูป',
};
export const NEXT_STAGE = { mixing: 'extrusion', extrusion: 'curing', curing: 'finishing' };
export const PREV_STAGE = { extrusion: 'mixing', curing: 'extrusion', finishing: 'curing' };

export const SHIFTS = [
  { id: 'D', label: 'กะ D (07:00–15:00)' },
  { id: 'E', label: 'กะ E (15:00–23:00)' },
  { id: 'N', label: 'กะ N (23:00–07:00)' },
];

export const MACHINES = {
  mixing: ['KN-01 Kneader 75L', 'BM-02 Banbury 110L'],
  extrusion: ['EX-11 Extruder Ø90', 'EX-12 Extruder Ø60'],
};

// Process windows used for automatic QC hold decisions.
export const SPECS = {
  extrusion: {
    thickness: { label: 'ความหนา', unit: 'mm', target: 2.5, tol: 0.12 },
    width: { label: 'ความกว้าง', unit: 'mm', target: 18, tol: 0.25 },
    weightPerM: { label: 'น้ำหนักต่อเมตร', unit: 'g/m', target: 160, tol: 6 },
    reworkMaxPct: 10,
  },
  curing: {
    temp: { label: 'อุณหภูมิอบ', unit: '°C', target: 200, tol: 6 },
    time: { label: 'เวลาอบ', unit: 's', target: 150, tol: 10 },
    pressure: { label: 'ความดัน', unit: 'bar', target: 150, tol: 15 },
  },
  lab: {
    hardness: { label: 'ความแข็ง', unit: 'Shore A', target: 65, tol: 5, method: 'ASTM D2240' },
    tensile: { label: 'ความต้านแรงดึง', unit: 'MPa', min: 10, method: 'ASTM D412' },
    elongation: { label: 'การยืดตัว ณ จุดขาด', unit: '%', min: 300, method: 'ASTM D412' },
    sg: { label: 'ความถ่วงจำเพาะ', unit: '-', target: 1.18, tol: 0.03, method: 'ASTM D297' },
    t90: { label: 'เวลาสุก MDR t90', unit: 'min', target: 3.2, tol: 0.5, method: 'ASTM D5289' },
  },
};

export const WEIGH_TOL_PCT = 1.5; // allowed deviation per ingredient
export const WEIGH_TOL_MIN_KG = 0.02;

export function inSpec(value, spec) {
  if (value === '' || value === null || value === undefined || Number.isNaN(Number(value))) return false;
  const v = Number(value);
  if (spec.min !== undefined && v < spec.min) return false;
  if (spec.max !== undefined && v > spec.max) return false;
  if (spec.target !== undefined && Math.abs(v - spec.target) > spec.tol + 1e-9) return false;
  return true;
}

export function specText(spec) {
  if (spec.target !== undefined) return `${spec.target} ± ${spec.tol} ${spec.unit}`;
  if (spec.min !== undefined) return `≥ ${spec.min} ${spec.unit}`;
  return `≤ ${spec.max} ${spec.unit}`;
}

export function specLimits(spec) {
  if (spec.target !== undefined) return { lsl: spec.target - spec.tol, usl: spec.target + spec.tol };
  return { lsl: spec.min, usl: spec.max };
}

export function weighTolerance(targetKg) {
  return Math.max(WEIGH_TOL_MIN_KG, (targetKg * WEIGH_TOL_PCT) / 100);
}

// Ingredient weights per batch from PHR (parts per hundred rubber).
export function recipeLines(recipe) {
  const total = recipe.items.reduce((s, i) => s + Number(i.phr), 0);
  return recipe.items.map((i) => ({
    ...i,
    kgPerBatch: total ? (Number(i.phr) / total) * recipe.batchKg : 0,
  }));
}

export function totalPhr(recipe) {
  return recipe.items.reduce((s, i) => s + Number(i.phr), 0);
}

export function lotState(lot, now) {
  if (lot.status === 'hold') return 'hold';
  if (lot.qtyKg <= 0.0001) return 'empty';
  if (lot.expiry <= now) return 'expired';
  return 'available';
}

// First-expired-first-out allocation across available lots.
export function allocateFefo(materialLots, materialCode, kgNeeded, now, reserved = {}) {
  const candidates = materialLots
    .filter((l) => l.materialCode === materialCode && lotState(l, now) === 'available')
    .map((l) => ({ lot: l, free: l.qtyKg - (reserved[l.lotNo] || 0) }))
    .filter((c) => c.free > 0.0001)
    .sort((a, b) => a.lot.expiry - b.lot.expiry || a.lot.receivedAt - b.lot.receivedAt);
  const picks = [];
  let remaining = kgNeeded;
  for (const c of candidates) {
    if (remaining <= 0.0001) break;
    const take = Math.min(c.free, remaining);
    picks.push({ lotNo: c.lot.lotNo, kg: take });
    remaining -= take;
  }
  return { picks, shortage: Math.max(0, remaining) };
}

// I-MR statistics: control limits and Cp/Cpk use within-subgroup sigma (MR̄ / d2),
// Ppk uses the overall sample standard deviation.
export function stats(values, lsl, usl) {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const mrBar = values.slice(1).reduce((s, v, i) => s + Math.abs(v - values[i]), 0) / (n - 1);
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

export function cpkVerdict(cpk) {
  if (cpk === undefined || cpk === null) return { tone: 'muted', text: 'ข้อมูลไม่พอ' };
  if (cpk >= 1.67) return { tone: 'good', text: 'ดีมาก (≥ 1.67)' };
  if (cpk >= 1.33) return { tone: 'good', text: 'ผ่านเกณฑ์ (≥ 1.33)' };
  if (cpk >= 1.0) return { tone: 'warn', text: 'ควรเฝ้าระวัง (1.00–1.33)' };
  return { tone: 'bad', text: 'ไม่ผ่าน (< 1.00)' };
}
