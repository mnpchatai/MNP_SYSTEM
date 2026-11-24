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
  // มิติการฉีดไม่มีค่ากลาง: target / tol มาจากสูตรยาง (recipe.extrusionSpec · extrusionSpecOf) ที่นี่เก็บเฉพาะชื่อ หน่วย และเพดานยางหมุนเวียน
  const SPECS = Object.freeze({
    extrusion: Object.freeze({
      thickness: Object.freeze({ label: "ความหนา", unit: "mm" }),
      width: Object.freeze({ label: "ความกว้าง", unit: "mm" }),
      weightPerM: Object.freeze({ label: "น้ำหนักต่อเมตร", unit: "g/m" }),
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

  // สเปกมิติการฉีดของสูตร (20261129010000 · ตรงกับ private.rf_save_lots): recipe.extrusionSpec = { thickness?: {target, tol}, width?: ..., weightPerM?: ... }
  // คืนเฉพาะค่าที่สูตรกำหนด พร้อมชื่อและหน่วย { key: { label, unit, target, tol } } · สูตรไม่มีสเปก = {} (ล็อตไม่ถูกกักตามมิติ ไม่มีมาตรฐานให้แสดง ไม่เข้ากราฟ SPC)
  const EXTRUSION_KEYS = Object.freeze(["thickness", "width", "weightPerM"]);
  function extrusionSpecOf(recipe) {
    const raw = recipe?.extrusionSpec;
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const key of EXTRUSION_KEYS) {
      const row = raw[key];
      const target = Number(row?.target);
      const tol = Number(row?.tol);
      if (row && typeof row === "object" && Number.isFinite(target) && target > 0 && Number.isFinite(tol) && tol >= 0) out[key] = { ...SPECS.extrusion[key], target, tol };
    }
    return out;
  }
  // สเปกที่ใช้ตัดสินล็อตฉีดของ WO = สเปกของ revision ที่ WO ผูก (ร่าง revision ใหม่ไม่มีผลกับ WO ที่เปิดไปแล้ว)
  const orderExtrusionSpec = (recipes, order) => (order ? extrusionSpecOf(recipeOf(recipes, order.recipeId, order.recipeRevision)) : {});
  // เหตุผลที่ล็อตฉีดถูกกัก: ค่าที่สูตรกำหนดแต่วัดได้นอกช่วง (ข้อความเดียวกับฐานข้อมูล "ความหนา 2.68 mm นอกสเปก")
  const extrusionHoldReasons = (params, spec) => EXTRUSION_KEYS.filter((key) => spec[key] && !inSpec(params?.[key], spec[key]))
    .map((key) => `${spec[key].label} ${params[key]} ${spec[key].unit} นอกสเปก`);

  const weighTolerance = (targetKg) => Math.max(WEIGH_TOL_MIN_KG, (targetKg * WEIGH_TOL_PCT) / 100);

  // สูตรผสมสองขั้น: แต่ละบรรทัดวัตถุดิบมี stage 1|2 (ไม่ระบุ = 1) · ค่าของแต่ละขั้น { stage, mixerTemp (°C), dumpTemp (°C), mixMin (นาที) }
  const MIX_STAGES = Object.freeze([1, 2]);
  const itemStage = (item) => (Number(item?.stage) === 2 ? 2 : 1);
  const recipeStage = (recipe, stage) => (recipe?.stages ?? []).find((row) => Number(row.stage) === stage) ?? null;

  // น้ำหนักวัตถุดิบต่อ batch จาก PHR (ส่วนต่อยาง 100 ส่วน) · เรียงตามขั้น (ขั้น 1 ก่อน ขั้น 2) ลำดับเดิมในขั้นเดียวกัน
  function recipeLines(recipe) {
    const total = recipe.items.reduce((sum, item) => sum + Number(item.phr), 0);
    return recipe.items
      .map((item) => ({ ...item, stage: itemStage(item), kgPerBatch: total ? (Number(item.phr) / total) * recipe.batchKg : 0 }))
      .sort((a, b) => a.stage - b.stage);
  }

  // สูตร/สินค้าที่แสดงบนจอ: สูตรไม่มีชื่อ ใช้รหัสสูตร (+ รหัสสินค้าถ้ามี) · ใบสั่งผลิตและกล่อง FG เก็บ recipeId + productCode ของสูตร
  const recipeLabel = (recipe) => (recipe ? (recipe.productCode ? `${recipe.id} · ${recipe.productCode}` : String(recipe.id)) : "-");
  // หน่วยของ WO/ล็อต/กล่องที่แสดงให้ผู้ใช้: หน่วยของ RubberFlow เอง (m pcs kg) คงเดิม · รหัสหน่วยของ BOM (rod roll set ...) ใช้ป้ายไทยเดียวกับ BOM (เส้น ม้วน ชุด ...) · ไม่รู้จัก = แสดงรหัสเดิม
  const RF_NATIVE_UOMS = new Set(["m", "pcs", "kg"]);
  const unitText = (code) => {
    const text = String(code ?? "");
    if (!text || RF_NATIVE_UOMS.has(text)) return text;
    try { const label = root.MNP_BOM_RULES?.uomLabel?.(text); return label && label !== "หน่วยอื่น" ? label : text; } catch { return text; }
  };
  const orderLabel = (row) => (row ? (row.productCode ? `${row.recipeId} · ${row.productCode}` : String(row.recipeId ?? "-")) : "-");

  const totalPhr = (recipe) => recipe.items.reduce((sum, item) => sum + Number(item.phr), 0);

  // สูตรหนึ่งรหัสมีได้หลาย revision (ฐานข้อมูลเก็บทุก revision): revision ที่อนุมัติแล้วมีได้ไม่เกินหนึ่ง ร่างมีได้ไม่เกินหนึ่ง ที่เหลือถูกแทนที่แล้ว
  // currentRecipe = revision ที่ใช้งาน (อนุมัติแล้ว ไม่มีก็ร่างล่าสุด ไม่มีก็ revision ล่าสุดที่ถูกแทนที่) · recipeOf ระบุ revision ได้ (ใบสั่งผลิตผูก revision ที่เปิดไว้)
  const sortRevisions = (rows) => [...rows].sort((a, b) => Number(b.revision) - Number(a.revision));
  const revisionsOf = (recipes, id) => sortRevisions((recipes ?? []).filter((recipe) => recipe.id === id));
  const pickCurrent = (rows) => rows.find((recipe) => recipe.status === "approved") ?? rows.find((recipe) => recipe.status === "draft") ?? rows[0] ?? null;
  const currentRecipe = (recipes, id) => pickCurrent(revisionsOf(recipes, id));
  const recipeOf = (recipes, id, revision) => {
    const rows = revisionsOf(recipes, id);
    const exact = revision === undefined || revision === null ? null : rows.find((recipe) => Number(recipe.revision) === Number(revision));
    return exact ?? pickCurrent(rows);
  };
  // หนึ่งรหัสสูตรหนึ่งแถว (revision ที่ใช้งาน) เรียงตามรหัส · approvedRecipes = เฉพาะรหัสที่มี revision อนุมัติแล้ว (ใช้เปิดใบสั่งผลิต / ผูกกับ BOM)
  const currentRecipes = (recipes) => {
    const ids = [...new Set((recipes ?? []).map((recipe) => recipe.id))];
    return ids.map((id) => currentRecipe(recipes, id)).filter(Boolean);
  };
  const approvedRecipes = (recipes) => currentRecipes(recipes).filter((recipe) => recipe.status === "approved");

  // คลังเคมี (20261220010000): ล็อตเดียวมียอดสองคลัง qtyKg = คลังวัตถุดิบกลาง (ST) · rbKg = คลังเคมีของ RB · ไม่ระบุคลัง = ST (ความหมายเดิม)
  // สถานะกักกันมีผลทั้งล็อตทั้งสองคลัง · ล็อตก่อนแยกคลังไม่มี rbKg = 0
  const STORES = Object.freeze(["ST", "RB"]);
  const lotKg = (lot, store = "ST") => Number(store === "RB" ? lot?.rbKg : lot?.qtyKg) || 0;
  function lotState(lot, now, store = "ST") {
    if (lot.status === "hold") return "hold";
    if (lotKg(lot, store) <= 0.0001) return "empty";
    if (lot.expiry <= now) return "expired";
    return "available";
  }

  // จัดสรรล็อตแบบหมดอายุก่อนจ่ายก่อน (FEFO) จากล็อตที่ใช้ได้ของคลังที่ระบุ หักที่จองไว้แล้ว (reserved[lotNo] = kg)
  // store "ST" = จ่ายตามใบขอเบิกของ RB (issueChemicals) และใบเบิกเดิม · "RB" = ใบเบิกผสมของ RB (createRequisition) · ตรงกับ FEFO ของฐานข้อมูล (หมดอายุ → รับเข้า → เลขล็อต)
  function allocateFefo(materialLots, materialCode, kgNeeded, now, reserved = {}, store = "ST") {
    const candidates = materialLots
      .filter((lot) => lot.materialCode === materialCode && lotState(lot, now, store) === "available")
      .map((lot) => ({ lot, free: lotKg(lot, store) - (reserved[lot.lotNo] || 0) }))
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

  // ---------- ความต้องการเคมีของ WO เทียบสต็อก (ใบสั่งซื้อ) ----------
  // ใช้ร่วมกันทุกจุดที่เสนอสั่งซื้อ (หลังปล่อยผลิต PI · ปุ่ม "ตรวจวัตถุดิบ" ของ PI) · ไม่มี DOM/Supabase
  const OPEN_ORDER = Object.freeze(["planned", "released", "in_progress", "on_hold"]);
  const round3 = (value) => Math.round(Number(value) * 1000) / 1000;
  // ยอดที่ต้องซื้อปัดขึ้น ไม่ให้สั่งน้อยกว่าที่ใบเบิกจะจ่ายจริง (ใบเบิกปัดยอดต่อวัตถุดิบที่ 4 ตำแหน่ง)
  // up4: ปัดขึ้นที่ 4 ตำแหน่ง (ยอมเศษทศนิยมของเครื่อง) · up3: ปัดที่ 4 ตำแหน่งก่อน แล้วปัดขึ้นที่ 3 ตำแหน่ง (ยอดแสดง ต้องใช้ / ขาด / จำนวนสั่ง) กฎเดียวกับ partUp3 ใน bom-rules.js
  // up4 ปัดขึ้นทุกใบเบิก (ฐานข้อมูลปัดใกล้สุด) จึงอาจขาดเกินจริงได้ใบละไม่เกิน 0.0001 kg ต่อวัตถุดิบ ตั้งใจ: โหมดสาธิตจ่ายยอดไม่ปัด และสั่งเกินเล็กน้อยดีกว่าขาด
  const up4 = (value) => Math.ceil(Number(value) * 1e4 - 1e-6) / 1e4 || 0;
  const up3 = (value) => Math.ceil(Math.round(Number(value) * 1e4) / 10 - 1e-9) / 1e3 || 0;

  // กิโลกรัมคอมปาวด์ที่ WO ยังต้องใช้ = เป้าหมาย (targetKg ถ้ามี ไม่เช่นนั้น targetQty ÷ ผลผลิตต่อ kg ของสูตร) − ที่ใบเบิกของ WO นี้ครอบคลุมแล้ว (batch × น้ำหนักต่อ batch)
  function orderRemainingKg(order, recipe, requisitions) {
    let total = Number(order.targetKg);
    if (!(total > 0)) total = Number(order.targetQty) / Number(recipe.yieldPerKg);
    if (!Number.isFinite(total) || total <= 0) return 0;
    const covered = (requisitions ?? []).filter((row) => row.orderId === order.id).reduce((sum, row) => {
      const kg = Number.isFinite(Number(row.batches)) && Number(row.batches) > 0 ? Number(row.batches) * Number(recipe.batchKg) : Number(row.totalKg);
      return sum + (Number.isFinite(kg) ? kg : 0);
    }, 0);
    return Math.max(0, total - covered);
  }

  // จำนวน batch ที่ใบเบิกใบหนึ่งเบิกได้สูงสุด (ตรงกับ check ของตาราง rf_requisitions)
  const MAX_REQ_BATCHES = 10;
  // batch ที่ WO ยังไม่ได้เบิก = ปัดขึ้น((กิโลที่ WO ต้องใช้ − กิโลที่ใบเบิกทุกใบของ WO นี้เบิกไปแล้ว (batch × น้ำหนักต่อ batch)) ÷ น้ำหนักต่อ batch) · 0 = เบิกครบแล้ว
  // กฎเดียวกับเซิร์ฟเวอร์ (rf_save_requisitions) และโหมดสาธิต · ใบเบิกไม่มีสถานะยกเลิก จึงนับทุกใบ
  function remainingBatches(order, recipe, requisitions) {
    const batchKg = Number(recipe?.batchKg);
    if (!order || !(batchKg > 0)) return 0;
    const left = orderRemainingKg(order, recipe, requisitions);
    return left > 0 ? Math.max(0, Math.ceil(left / batchKg - 1e-9)) : 0;
  }
  // batch ของใบเบิกใบถัดไป = ที่ยังไม่ได้เบิก แต่ไม่เกิน MAX_REQ_BATCHES ต่อใบ (เหลือมากกว่านั้นเบิกต่อได้อีกใบ)
  const nextRequisitionBatches = (order, recipe, requisitions) => Math.min(MAX_REQ_BATCHES, remainingBatches(order, recipe, requisitions));

  // กิโลคอมปาวด์ที่ WO ยังต้องเบิก ตามที่ใบเบิกจะจ่ายจริง = batch ที่ยังไม่ได้เบิกทั้งหมด (ปัดขึ้น ไม่จำกัด 10 ต่อใบ) × น้ำหนักต่อ batch · สูตรไม่มีน้ำหนักต่อ batch ใช้กิโลตรง ๆ
  const remainingNeedKg = (order, recipe, requisitions) => (Number(recipe?.batchKg) > 0 ? remainingBatches(order, recipe, requisitions) * Number(recipe.batchKg) : orderRemainingKg(order, recipe, requisitions));

  // ค่าตั้งต้นของจำนวนสั่ง: ขาด = ส่วนที่ขาด + สต็อกขั้นต่ำ · ไม่ขาด = 0 (ผู้วางแผนใส่เองได้)
  const suggestOrderKg = (shortageKg, safetyKg) => (Number(shortageKg) > 0 ? round3(Number(shortageKg) + Math.max(0, Number(safetyKg) || 0)) : 0);

  // data = { orders, recipes, requisitions, materialLots, purchaseOrders, materials } · woIds = WO ที่ถามถึง (เช่น ที่เปิดให้ PI นี้)
  // แต่ละวัตถุดิบคืนตัวแยก: onHandKg คงเหลือในคลัง (ล็อต available ไม่หมดอายุ) · reservedKg จองแล้ว = ใบเบิกเก่าที่ค้างจ่ายจองไว้ (requisitionKg) + ความต้องการของ WO อื่นที่ยังเปิดอยู่และยังไม่ได้เบิก (otherNeedKg)
  // · onOrderKg สั่งค้างรับ (บรรทัดของใบสั่งซื้อสถานะ ordered ที่ยังไม่รับ) · availableKg พร้อมใช้ = onHandKg − reservedKg + onOrderKg (เก็บในบรรทัดใบสั่งซื้อ ไม่แสดงเป็นคอลัมน์)
  // พร้อมใช้ติดลบได้ (WO อื่น/ใบเบิกใช้สต็อกไปแล้วเกินที่มี) เก็บตามจริง · ขาด = max(0, ต้องใช้ − พร้อมใช้) · WO ที่ไม่มีสูตรไม่นับ (คืนใน skipped) · WO ที่ปิด/ยกเลิกแล้วไม่ใช่ความต้องการ
  // ใบเบิกใหม่จ่ายทันทีและหักสต็อกแล้ว จึงไม่จองอะไร · options.remote = false (โหมดสาธิต): ใบเก่าหักสต็อกตอนจ่ายครบ จึงจองทุกรายการของใบที่ยังจ่ายไม่ครบ
  // ความต้องการของ WO ที่ยังไม่ได้เบิก (ทั้งที่ถามและ WO อื่น) = batch ที่เหลือ × น้ำหนักต่อ batch (remainingNeedKg) เท่ากับที่ใบเบิกจะจ่ายจริง
  // options.needKg = { [รหัส WO]: kg } ใช้ kg นี้เป็นความต้องการของ WO ที่ถาม แทนส่วนที่ยังไม่ได้เบิก (ใบเบิกที่กำลังสร้างเบิกอยู่แล้ว)
  function chemicalNeeds(data, woIds, now = Date.now(), options = {}) {
    const { orders = [], recipes = [], requisitions = [], materialLots = [], purchaseOrders = [], materials = [] } = data ?? {};
    const remote = options.remote !== false;
    const asked = [...new Set((woIds ?? []).map(String))];
    const askedSet = new Set(asked);
    const need = new Map();
    const other = new Map();
    const add = (map, code, kg) => map.set(code, (map.get(code) || 0) + kg);
    const skipped = [];
    const counted = [];
    const share = (order, recipe, map, ownKg) => {
      const kg = Number.isFinite(ownKg) ? ownKg : remainingNeedKg(order, recipe, requisitions);
      const total = totalPhr(recipe);
      if (!(kg > 0) || !(total > 0)) return;
      // แบ่งเป็นใบเบิกละไม่เกิน MAX_REQ_BATCHES batch เหมือนที่ RB จะเบิกจริง แล้วปัดขึ้นที่ 4 ตำแหน่งต่อใบ (ฐานข้อมูลปัดใกล้สุดต่อใบ) ผลรวมจึงไม่น้อยกว่าที่จะจ่าย
      // ใบเบิกเต็ม (10 batch) ซ้ำกันทุกใบ จึงคิดครั้งเดียวแล้วคูณจำนวนใบ ไม่วนทีละใบ (WO ใหญ่มากไม่ทำให้หน้าค้าง)
      const batchKg = Number(recipe.batchKg);
      const parts = []; // [กิโลคอมปาวด์ต่อใบเบิก, จำนวนใบ]
      if (batchKg > 0 && !Number.isFinite(ownKg)) {
        const batches = Math.round(kg / batchKg);
        const full = Math.floor(batches / MAX_REQ_BATCHES);
        const rest = batches % MAX_REQ_BATCHES;
        if (full) parts.push([MAX_REQ_BATCHES * batchKg, full]);
        if (rest) parts.push([rest * batchKg, 1]);
      }
      if (!parts.length) parts.push([kg, 1]);
      for (const item of recipe.items) for (const [part, count] of parts) add(map, item.materialCode, up4((part * Number(item.phr)) / total) * count);
    };
    for (const id of asked) {
      const order = orders.find((row) => row.id === id);
      if (!order) { skipped.push({ woId: id, reason: "ไม่พบ WO" }); continue; }
      if (!OPEN_ORDER.includes(order.status)) continue;
      const recipe = recipeOf(recipes, order.recipeId, order.recipeRevision);
      if (!recipe || !Array.isArray(recipe.items) || !recipe.items.length) { skipped.push({ woId: id, reason: "ไม่พบสูตร" }); continue; }
      counted.push(id);
      share(order, recipe, need, options.needKg?.[id]);
    }
    for (const order of orders) {
      if (askedSet.has(order.id) || !OPEN_ORDER.includes(order.status)) continue;
      const recipe = recipeOf(recipes, order.recipeId, order.recipeRevision);
      if (recipe && Array.isArray(recipe.items) && recipe.items.length) share(order, recipe, other);
    }
    // คงเหลือสำหรับคิดสั่งซื้อ = คลัง ST + คลัง RB ของล็อตที่ใช้ได้ (ไม่กักกัน ไม่หมดอายุ · 20261220010000 ข้อเสนอที่ระบุใน PR)
    const onHand = new Map();
    for (const lot of materialLots) if (lot.status !== "hold" && lot.expiry > now) add(onHand, lot.materialCode, lotKg(lot, "ST") + lotKg(lot, "RB"));
    const reserved = new Map();
    for (const requisition of requisitions) {
      if (requisition.status !== "weighing") continue;
      for (const line of requisition.lines ?? []) if (!remote || line.actualKg === null || line.actualKg === undefined) add(reserved, line.materialCode, Number(line.targetKg) || 0);
    }
    // สั่งแล้วรอรับ = ยอดที่ยังค้างรับของบรรทัด (poLineOpen: รับไม่ครบยังค้างส่วนที่เหลือ จนกว่าจะรับครบหรือ ST ปิดยอดที่เหลือ · 20261128020000)
    const onOrder = new Map();
    for (const po of purchaseOrders) {
      if (po.status !== "ordered") continue;
      for (const line of po.lines ?? []) { const open = poLineOpen(line); if (open > 0) add(onOrder, line.materialCode, open); }
    }
    const rows = [...need.keys()].filter((code) => up3(need.get(code)) > 0).sort().map((code) => {
      const material = materials.find((row) => row.code === code);
      const exactNeed = need.get(code);
      const needKg = up3(exactNeed);
      const heldKg = (reserved.get(code) || 0) + (other.get(code) || 0);
      const free = (onHand.get(code) || 0) - heldKg + (onOrder.get(code) || 0);
      // ขาดคิดจากยอดจริงแล้วปัดขึ้น (ไม่ใช่ต้องใช้ที่ปัดไว้แสดง) จำนวนสั่งตั้งต้นจึงพอสำหรับใบเบิก
      const shortageKg = up3(Math.max(0, exactNeed - free));
      const safetyKg = Math.max(0, Number(material?.safetyKg) || 0);
      return {
        materialCode: code, name: material?.name ?? "", needKg, onHandKg: round3(onHand.get(code) || 0), reservedKg: round3(heldKg), requisitionKg: round3(reserved.get(code) || 0), otherNeedKg: round3(other.get(code) || 0),
        onOrderKg: round3(onOrder.get(code) || 0), availableKg: round3(free), shortageKg, safetyKg, orderKg: suggestOrderKg(shortageKg, safetyKg),
      };
    });
    return { rows, skipped, counted, anyShort: rows.some((row) => row.shortageKg > 0) };
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

  // วันที่แบบเดียวกับ formatDate ของระบบหลัก: วัน เดือนย่อ ปี พ.ศ. 4 หลัก (เช่น 4 พ.ย. 2569)
  function fmtDate(ms) {
    if (!ms) return "-";
    const d = new Date(ms);
    return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
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

  // ---------- บรรทัดใบสั่งซื้อ (ตรงกับ private.rf_po_line_received / rf_po_line_done ของ 20261128020000 และ mock ของ harness) ----------
  // receivedKg = ยอดรับสะสม · receipts = [{ kg, lotNo, expiry, at, by }] ทีละครั้ง (เซิร์ฟเวอร์สร้าง) · closedRemainder = { kg, reason, at, by } เมื่อ ST ปิดยอดที่เหลือ
  // บรรทัดรุ่นเก่า (รับครั้งเดียวก่อน 20261128020000: มี receivedKg แต่ไม่มี receipts) ถือว่าปิดแล้ว ตัวเลขเดิมไม่กลับมาค้างรับ
  const hasValue = (value) => value !== null && value !== undefined;
  // ปัด 9 ตำแหน่ง (ตัดเศษทศนิยมของเลขทศนิยมฐานสอง) เทียบกับ numeric ของฐานข้อมูลได้ตรง
  const round9 = (value) => Math.round(Number(value) * 1e9) / 1e9;
  const poLineReceived = (line) => (Array.isArray(line?.receipts) && line.receipts.length
    ? round9(line.receipts.reduce((sum, receipt) => sum + (Number(receipt?.kg) || 0), 0))
    : Number(line?.receivedKg) || 0);
  // รายการรับของบรรทัด (บรรทัดรุ่นเก่า = หนึ่งรายการจากช่องของบรรทัด) ใช้แสดงประวัติ
  const poLineReceipts = (line) => (Array.isArray(line?.receipts) ? line.receipts
    : hasValue(line?.receivedKg) ? [{ kg: Number(line.receivedKg) || 0, lotNo: line.lotNo ?? null, expiry: line.expiry ?? null, at: line.receivedAt ?? null, by: line.receivedBy ?? null }] : []);
  const poLineClosed = (line) => Boolean(line?.closedRemainder && typeof line.closedRemainder === "object") || (hasValue(line?.receivedKg) && !Array.isArray(line?.receipts));
  // ค้างรับ (สั่งแล้วรอรับ) ของบรรทัด · รับเกินยอดสั่ง = 0
  const poLineOpen = (line) => (poLineClosed(line) ? 0 : Math.max(0, round9((Number(line?.qtyKg) || 0) - poLineReceived(line))));
  // ครบ (ไม่ค้างรับ): ปิดแล้ว หรือรับสะสมถึงยอดสั่ง · ใบเป็น received เมื่อทุกบรรทัดครบ
  const poLineDone = (line) => poLineClosed(line) || poLineReceived(line) >= (Number(line?.qtyKg) || 0); // เทียบตรงแบบเดียวกับ private.rf_po_line_done และ mock
  // ใบมีการรับหรือปิดยอดแล้วอย่างน้อยหนึ่งบรรทัด (ยกเลิกใบไม่ได้แล้ว)
  const poTouched = (po) => (po?.lines ?? []).some((line) => poLineReceived(line) > 0 || Boolean(line?.closedRemainder));

  // ใบเบิกที่หักสต็อกแล้ว (issued · weighing ที่จ่ายไปบางบรรทัด) ของ WO ที่ถูกยกเลิก = งานรับเคมีคืนของแผนก ST (ตรงกับ private.rf_return_requisitions ของ 20261128010000)
  // "pending" = รอ ST รับคืน · "returned" = รับคืนแล้ว (ครั้งเดียวต่อใบ: ทุกบรรทัดมี returnedAt) · null = ไม่เกี่ยว (WO ยังเปิด ผสมแล้ว หรือยังไม่ได้จ่ายบรรทัดไหน)
  const issuedKgOf = (requisition) => (requisition?.lines ?? []).reduce((sum, line) => sum + (typeof line?.actualKg === "number" ? line.actualKg : 0), 0);
  function requisitionReturnState(data, requisition) {
    const wo = (data?.orders ?? []).find((order) => order.id === requisition?.orderId);
    if (wo?.status !== "cancelled" || !["issued", "weighing"].includes(requisition?.status) || !(issuedKgOf(requisition) > 0)) return null;
    return (requisition.lines ?? []).some((line) => line && Object.hasOwn(line, "returnedAt")) ? "returned" : "pending";
  }
  // คลังของใบเบิก (20261220010000): "RB" = ใบเบิกผสมที่ตัดคลัง RB (รับคืนเข้าคลัง RB โดยกลุ่มวางแผน / RB) · อื่น = ใบเดิมของคลัง ST (รับคืนโดย ST)
  const requisitionStore = (requisition) => (requisition?.store === "RB" ? "RB" : "ST");
  // store (ไม่บังคับ) = เฉพาะใบของคลังนั้น · ไม่ส่ง = ทุกใบ (เหมือนเดิม)
  const returnableRequisitions = (data, store) => (data?.requisitions ?? []).filter((requisition) => requisitionReturnState(data, requisition) === "pending" && (!store || requisitionStore(requisition) === store));
  // ใบเบิกที่หน้าผสมยางเลือกได้: จ่ายครบแล้ว (issued) และ WO ยังไม่ถูกยกเลิก
  const mixableRequisitions = (data) => (data?.requisitions ?? []).filter((requisition) => requisition.status === "issued" && (data?.orders ?? []).find((order) => order.id === requisition.orderId)?.status !== "cancelled");

  // ---------- เอกสารคลังเคมี ST / RB (chemDocs · ตรงกับ private.rf_save_chem_docs ของ 20261220010000 และ mock ของ harness) ----------
  // { id: CR- | CT- | CC- -yyyymmdd-nn, kind: request | return | count, status, lines, note, reason, createdAt, createdBy, doneAt?, doneBy? }
  // request: open → partial → done | closed (ST ปิดยอดพร้อมเหตุผล) | cancelled (RB ยกเลิกก่อนจ่าย) · lines [{ materialCode, qtyKg, issuedKg, issues: [{ lotNo, kg, at, by }] }]
  // return: pending → received (ST รับทั้งใบ) | rejected (กลับคลัง RB) · lines [{ lotNo, materialCode, kg, receivedKg }] · count: done · lines [{ lotNo, materialCode, beforeKg, countedKg }]
  const CHEM_REASON_MIN = 3;
  const CHEM_REASON_MAX = 300;
  const chemDocsOf = (data) => (Array.isArray(data?.chemDocs) ? data.chemDocs : []);
  const chemLineOpenKg = (line) => Math.max(0, round9((Number(line?.qtyKg) || 0) - (Number(line?.issuedKg) || 0)));
  const chemRequestOpen = (doc) => doc?.kind === "request" && ["open", "partial"].includes(doc.status);
  // ใบขอเบิกที่ ST ต้องจ่าย (open / partial) · ใบคืนที่ ST ต้องรับ (pending) เรียงเก่าสุดก่อน
  const byCreated = (a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id));
  const chemRequestsToIssue = (data) => chemDocsOf(data).filter(chemRequestOpen).sort(byCreated);
  // กิโลที่ใบเบิกค้างชั่ง (weighing) ของคลังนั้นจองไว้ต่อล็อต { lotNo: kg } · remote (ฐานข้อมูล) = เฉพาะบรรทัดที่ยังไม่ชั่ง · โหมดสาธิตหักตอนชั่งครบ จึงจองทุกบรรทัด
  // ใบ weighing เดิมเป็นของคลัง ST: ST จ่ายส่วนที่จองให้ RB ไม่ได้ (FEFO ของ issueChemicals หักส่วนนี้ ตรงกับฐานข้อมูล)
  function weighingReservedKg(requisitions, store = "ST", { remote = true } = {}) {
    const reserved = {};
    for (const requisition of requisitions ?? []) {
      if (requisition?.status !== "weighing" || requisitionStore(requisition) !== store) continue;
      for (const line of requisition.lines ?? []) if (!remote || line.actualKg === null || line.actualKg === undefined) reserved[line.lotNo] = (reserved[line.lotNo] || 0) + (Number(line.targetKg) || 0);
    }
    return reserved;
  }
  const chemReturnsPending = (data) => chemDocsOf(data).filter((doc) => doc?.kind === "return" && doc.status === "pending").sort(byCreated);
  // ยอดที่คืนระหว่างทาง (ใบคืนที่รอ ST รับ) ของล็อต
  const lotInTransitKg = (data, lotNo) => round9(chemReturnsPending(data).reduce((sum, doc) => sum + (doc.lines ?? []).filter((line) => line?.lotNo === lotNo).reduce((kg, line) => kg + (Number(line.kg) || 0), 0), 0));
  // ยอดนับสูงสุดของล็อตในคลัง RB = ยอดรับเข้า − คลัง ST − ที่คืนระหว่างทาง
  const rbCountCapKg = (data, lot) => Math.max(0, round9((Number(lot?.initialKg) || 0) - lotKg(lot, "ST") - lotInTransitKg(data, lot?.lotNo)));

  // ST เห็นล็อตก่อนยืนยันการจ่าย: FEFO จากคลัง ST ต่อบรรทัด · kgs = ยอดจ่ายครั้งนี้ตามลำดับบรรทัด (ไม่ส่ง / ว่าง = ยอดคงค้างทั้งหมด · 0 = ไม่จ่ายบรรทัดนี้)
  // คืน [{ materialCode, openKg, kg, picks: [{ lotNo, kg, expiry }], shortageKg }] · ฐานข้อมูลจัดสรรเองอีกครั้งตอนบันทึก (ผลเดียวกันถ้าข้อมูลไม่เปลี่ยน)
  // options.remote = false (โหมดสาธิต): ใบค้างชั่งจองทุกบรรทัด
  function chemIssuePreview(data, doc, kgs, now = Date.now(), options = {}) {
    const lots = data?.materialLots ?? [];
    const reserved = weighingReservedKg(data?.requisitions, "ST", { remote: options.remote !== false });
    return (doc?.lines ?? []).map((line, index) => {
      const openKg = chemLineOpenKg(line);
      const raw = Array.isArray(kgs) ? kgs[index] : undefined;
      const kg = raw === undefined || raw === null || String(raw).trim() === "" ? openKg : Math.max(0, Math.min(openKg, Number(raw) || 0));
      const { picks, shortage } = kg > 0 ? allocateFefo(lots, line.materialCode, kg, now, reserved, "ST") : { picks: [], shortage: 0 };
      return {
        materialCode: line.materialCode, openKg, kg,
        picks: picks.map((pick) => ({ lotNo: pick.lotNo, kg: round9(pick.kg), expiry: lots.find((lot) => lot.lotNo === pick.lotNo)?.expiry ?? null })),
        shortageKg: round9(shortage),
      };
    });
  }

  // ล็อตที่อยู่คลัง RB (rbKg > 0) พร้อมสถานะในคลัง RB (available / hold / expired) เรียงตามวัตถุดิบแล้วหมดอายุก่อน
  const rbStockLots = (data, now = Date.now()) => (data?.materialLots ?? [])
    .filter((lot) => lotKg(lot, "RB") > 0.0001)
    .map((lot) => ({ lot, rbKg: lotKg(lot, "RB"), state: lotState(lot, now, "RB") }))
    .sort((a, b) => String(a.lot.materialCode).localeCompare(String(b.lot.materialCode)) || a.lot.expiry - b.lot.expiry || String(a.lot.lotNo).localeCompare(String(b.lot.lotNo)));

  // ใช้จริงเทียบสูตรของคลัง RB ต่อวัตถุดิบ (มุมมอง RB): ไม่ชั่งเพิ่ม คิดจากเอกสารที่มีอยู่
  //   receivedKg = รับจาก ST (issues ของใบขอเบิก) · recipeKg = ใช้ตามสูตร (targetKg ของใบเบิกคลัง RB − ที่คืนเข้าคลัง RB ของใบนั้น)
  //   returnedKg = คืนให้ ST (ใบคืนที่ไม่ถูกปฏิเสธ) · expectedKg = รับ − ใช้ตามสูตร − คืน (ยอดที่ควรเพิ่มขึ้นในคลัง RB ตามสูตร)
  //   countAdjustKg = ผลรวมการปรับยอดจากการนับ (นับได้ − ยอดก่อนนับ · ติดลบ = ใช้จริงมากกว่าสูตรหรือสูญหาย) · onHandKg = ยอดคลัง RB ตอนนี้ (ไม่ตามช่วงเวลา)
  // options.since / options.until (ms ไม่บังคับ) = นับเฉพาะรายการในช่วงเวลานั้น · คืน { rows (เรียงตามรหัส), totals }
  function rbUsage(data, { since = null, until = null } = {}) {
    const inWindow = (at) => (since === null || Number(at) >= since) && (until === null || Number(at) <= until);
    const rows = new Map();
    const row = (code) => {
      if (!rows.has(code)) rows.set(code, { materialCode: code, receivedKg: 0, recipeKg: 0, returnedKg: 0, expectedKg: 0, countAdjustKg: 0, onHandKg: 0 });
      return rows.get(code);
    };
    for (const doc of chemDocsOf(data)) {
      for (const line of doc.lines ?? []) {
        if (!line?.materialCode) continue;
        if (doc.kind === "request") for (const issue of line.issues ?? []) { if (inWindow(issue?.at)) row(line.materialCode).receivedKg += Number(issue?.kg) || 0; }
        else if (doc.kind === "return" && doc.status !== "rejected" && inWindow(doc.createdAt)) row(line.materialCode).returnedKg += Number(line.kg) || 0;
        else if (doc.kind === "count" && inWindow(doc.createdAt)) row(line.materialCode).countAdjustKg += (Number(line.countedKg) || 0) - (Number(line.beforeKg) || 0);
      }
    }
    for (const requisition of data?.requisitions ?? []) {
      if (requisitionStore(requisition) !== "RB") continue;
      for (const line of requisition.lines ?? []) {
        if (!line?.materialCode) continue;
        if (inWindow(requisition.createdAt)) row(line.materialCode).recipeKg += Number(line.targetKg) || 0;
        if (typeof line.returnedKg === "number" && inWindow(line.returnedAt)) row(line.materialCode).recipeKg -= line.returnedKg;
      }
    }
    for (const lot of data?.materialLots ?? []) if (lotKg(lot, "RB") > 0 || rows.has(lot.materialCode)) row(lot.materialCode).onHandKg += lotKg(lot, "RB");
    const keys = ["receivedKg", "recipeKg", "returnedKg", "expectedKg", "countAdjustKg", "onHandKg"];
    const list = [...rows.values()].map((item) => {
      item.expectedKg = item.receivedKg - item.recipeKg - item.returnedKg;
      for (const key of keys) item[key] = round3(item[key]) || 0;
      return item;
    }).filter((item) => keys.some((key) => item[key] !== 0)).sort((a, b) => String(a.materialCode).localeCompare(String(b.materialCode)));
    const totals = Object.fromEntries(keys.map((key) => [key, round3(list.reduce((sum, item) => sum + item[key], 0)) || 0]));
    return { rows: list, totals };
  }

  // ปล่อยของที่ QA กัก = หัวหน้า QA เท่านั้น (เจ้าของสั่ง 2026-11-24 · ฐานข้อมูล RF_QA_HEAD_ONLY / BOM_QA_HEAD_ONLY): ผู้จัดการแผนกหรือผู้ช่วยผู้จัดการแผนก (department_manager / assistant_department_manager) ของแผนก QA หรือ admin / ผู้จัดการทั่วไป / ผู้จัดการโรงงาน
  // ไม่ใช่ฝ่ายวางแผน (PP) พนักงาน QA หัวหน้า RB หรือผู้ช่วยผู้จัดการโรงงาน · ใช้กับ: ผลตรวจผ่าน/ไม่ผ่านของล็อตที่กัก · ตัดสินยางเส้นยาวที่ SR กัก (ปลดกักกันวัตถุดิบ = canReleaseMaterial ข้างล่าง)
  // นิยามเดียวของฝั่งหน้าจอ (RubberFlow ใช้ผ่าน can("qaRelease") · BOM ผ่าน canDecideRods) · รับผู้ใช้ทั้งรูปของ RubberFlow และของ BOM (role / roleCode / dept) · บัญชีสาธิตในเครื่องไม่มี roleCode: ใช้บทบาท manager แทน (แบบเดียวกับ canReverseFg)
  const QA_RELEASE_ROLE_CODES = Object.freeze(["admin", "general_manager", "factory_manager"]);
  const QA_RELEASE_TEXT = "เฉพาะหัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ";
  function canQaRelease(user) {
    if (!user) return false;
    const roleCode = String(user.roleCode ?? "");
    if (user.role === "admin" || QA_RELEASE_ROLE_CODES.includes(roleCode)) return true;
    if (!roleCode) return user.role === "manager";
    return String(user.dept ?? "").toUpperCase() === "QA" && ["department_manager", "assistant_department_manager"].includes(roleCode);
  }
  // ปลดกักกันวัตถุดิบ (ล็อตเคมี hold → available) = หัวหน้า QA (canQaRelease) หรือหัวหน้า ST (ผู้จัดการ / ผู้ช่วยผู้จัดการแผนก ST) · เจ้าของสั่ง 2026-11-24 "วัตถุดิบที่กักให้มี 2 ที่ คือ QA และ ST และให้หัวหน้า ST ปลดได้ด้วย"
  // ฐานข้อมูล private.material_release_ok · RF_MATERIAL_RELEASE_HEAD_ONLY · นิยามเดียวของฝั่งหน้าจอ (RubberFlow can("releaseMaterial") · หน้าวัตถุดิบที่กักของ #/qa และ #/st) · พนักงาน ST / QA กักกันได้แต่ปลดไม่ได้
  const MATERIAL_RELEASE_TEXT = "ปลดกักกันวัตถุดิบได้เฉพาะหัวหน้า QA หัวหน้า ST หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ";
  function canReleaseMaterial(user) {
    if (canQaRelease(user)) return true;
    const roleCode = String(user?.roleCode ?? "");
    return Boolean(roleCode) && String(user.dept ?? "").toUpperCase() === "ST" && ["department_manager", "assistant_department_manager"].includes(roleCode);
  }

  const api = {
    QA_RELEASE_TEXT, canQaRelease, MATERIAL_RELEASE_TEXT, canReleaseMaterial,
    DAY, HOUR, STAGES, STAGE_LABEL, NEXT_STAGE, PREV_STAGE, SHIFTS, MACHINES, SPECS, WEIGH_TOL_PCT, WEIGH_TOL_MIN_KG,
    MIX_STAGES, itemStage, recipeStage, recipeLabel, orderLabel, unitText, inSpec, specText, specLimits, EXTRUSION_KEYS, extrusionSpecOf, orderExtrusionSpec, extrusionHoldReasons, weighTolerance, recipeLines, totalPhr, revisionsOf, currentRecipe, recipeOf, currentRecipes, approvedRecipes, lotState, allocateFefo, OPEN_ORDER, orderRemainingKg, MAX_REQ_BATCHES, remainingBatches, nextRequisitionBatches, suggestOrderKg, chemicalNeeds, stats, cpkVerdict,
    fmtDate, fmtDateTime, fmtNum, fmtDuration, ymd, toInputDate, fromInputDate, niceScale,
    issuedKgOf, requisitionReturnState, returnableRequisitions, mixableRequisitions, requisitionStore,
    poLineReceived, poLineReceipts, poLineClosed, poLineOpen, poLineDone, poTouched,
    STORES, lotKg, CHEM_REASON_MIN, CHEM_REASON_MAX, chemDocsOf, chemLineOpenKg, chemRequestOpen, chemRequestsToIssue, chemReturnsPending, lotInTransitKg, rbCountCapKg, weighingReservedKg,
    chemIssuePreview, rbStockLots, rbUsage,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_RUBBERFLOW_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
