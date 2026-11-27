// ต้นทุนการผลิต (โหมดทดสอบ) — กฎล้วน ไม่มี DOM/Supabase: ใครเห็นราคา/ต้นทุน · ราคาเคมีต่อ kg ที่มีผลในวันหนึ่ง · ต้นทุนสูตรผสม (ต่อ batch / ต่อ kg) · ต้นทุนจริงของล็อตผสมเทียบสูตร
// โหลดก่อน modules/cost-data.js และ modules/st-pages.js (ดู index.html) · เทสต์ด้วย node --test (scripts/tests/cost-rules.test.mjs)
// ราคา: ทุกแถวที่เคยบันทึก { id, kind: "chem"|"part", materialCode, unitPrice, effectiveFrom: "YYYY-MM-DD", note, createdAt: ms, createdBy } ไม่มีการแก้/ลบ — แก้ราคา = เพิ่มแถวใหม่
//   chem = เคมี RubberFlow ราคาต่อ kg · part = ของซื้อ (ชิ้นงาน BOM ชนิด PURCHASED) ราคาต่อหน่วยของชิ้นนั้น · รหัสของซื้ออาจซ้ำรหัสเคมีได้ จึงแยกตาม kind เสมอ (ต้นทุนสูตรใช้เฉพาะ chem)
//   ราคาที่ใช้ในวัน D = แถวที่ effectiveFrom ล่าสุดที่ไม่เกิน D · วันเดียวกันหลายแถว = แถวที่ createdAt ใหม่สุด (ราคาที่ตั้งล่วงหน้ายังไม่ถูกใช้จนถึงวันนั้น)
// สูตร: โหมดน้ำหนัก { materialCode, stage 0|1|2|3, kg (ต่อ batch), unit "kg"|"g" (หน่วยที่กรอก ไม่เปลี่ยนค่า kg), phr } · โหมดเดิม { materialCode, phr, stage 1|2 } (kg ต่อ batch = phr ÷ Σphr × batchKg)
// ตัวเลขเก็บเต็มความละเอียด ปัดเฉพาะตอนแสดง (fmtBaht / fmtKg) · การซ่อนเมนู/หน้าเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูล (RF_FORBIDDEN)
(function (root) {
  const COST_ROLES = Object.freeze(["general_manager", "factory_manager", "admin"]);
  const COST_DEPTS = Object.freeze(["PP"]);
  const PRICE_DEPTS = Object.freeze(["ST"]);
  const WRITE_ROLES = Object.freeze(["admin"]);
  const roleCodeOf = (employee) => String(employee?.role?.code ?? employee?.role_code ?? "");
  const deptCodeOf = (employee) => String(employee?.department?.code ?? employee?.department_code ?? "").toUpperCase();

  // ใครเห็นอะไร (เจ้าของสั่ง): ต้นทุน + ราคา = ผู้จัดการทั่วไป ผู้จัดการโรงงาน admin และแผนก PP · ราคาอย่างเดียว = แผนก ST เพิ่มจากกลุ่มข้างบน · บันทึกราคา = แผนก ST และ admin
  const canSeeCost = (employee) => Boolean(employee) && (COST_ROLES.includes(roleCodeOf(employee)) || COST_DEPTS.includes(deptCodeOf(employee)));
  const canSeePrices = (employee) => canSeeCost(employee) || (Boolean(employee) && PRICE_DEPTS.includes(deptCodeOf(employee)));
  const canEditPrices = (employee) => Boolean(employee) && (PRICE_DEPTS.includes(deptCodeOf(employee)) || WRITE_ROLES.includes(roleCodeOf(employee)));

  // ---------- วันที่ (ตามเวลาไทย UTC+7 ไม่มีเวลาออมแสง) ----------
  const BANGKOK_MS = 7 * 3600000;
  const pad = (value) => String(value).padStart(2, "0");
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const bangkokDay = (ms) => {
    const date = new Date(Number(ms) + BANGKOK_MS);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  };
  // ms (เวลา epoch) หรือ "YYYY-MM-DD" (ข้อความที่ยาวกว่านั้นเอาแค่ส่วนวัน) → "YYYY-MM-DD" · ไม่ใช่วันที่ = ""
  function dayKey(value) {
    if (typeof value === "number") return Number.isFinite(value) ? bangkokDay(value) : "";
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? bangkokDay(value.getTime()) : "";
    const text = String(value ?? "").slice(0, 10);
    return ISO_DAY.test(text) ? text : "";
  }
  const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  // "2026-11-27" → "27 พ.ย. 2569" (พ.ศ. เหมือนวันที่อื่นในระบบ)
  function fmtDay(value) {
    const key = dayKey(value);
    if (!key) return "-";
    const [year, month, day] = key.split("-").map(Number);
    return `${day} ${TH_MONTHS[month - 1]} ${year + 543}`;
  }

  // ---------- ตัวเลข ----------
  const finite = (value) => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
  const round = (value, digits) => { const f = 10 ** digits; return Math.round((Number(value) + Number.EPSILON) * f) / f; };
  const fmt = (value, digits) => {
    const number = finite(value);
    return number === null ? "-" : number.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const fmtBaht = (value, digits = 2) => fmt(value, digits);
  // ราคาต่อ kg: อย่างน้อย 2 ทศนิยม สูงสุด 4 (ตรงกับที่ฐานข้อมูลรับ)
  const fmtPrice = (value) => { const number = finite(value); return number === null ? "-" : number.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 }); };
  // น้ำหนักตามหน่วยที่กรอก: g = kg × 1000 · ตัดเลข 0 ท้ายเมื่อหน่วยเป็น kg (13 / 0.5)
  function fmtWeight(kg, unit = "kg") {
    const number = finite(kg);
    if (number === null) return "-";
    if (unit === "g") return `${(number * 1000).toLocaleString("th-TH", { maximumFractionDigits: 3 })} g`;
    return `${number.toLocaleString("th-TH", { maximumFractionDigits: 4 })} kg`;
  }

  // ---------- ราคา ----------
  const PRICE_KINDS = Object.freeze(["chem", "part"]);
  const kindOf = (row) => (row?.kind === "part" ? "part" : "chem");
  const validPrice = (row) => row && finite(row.unitPrice) !== null && Number(row.unitPrice) > 0 && dayKey(row.effectiveFrom) !== "";
  // ราคาที่มีผลของเคมี (kind "chem") หรือของซื้อ (kind "part") ในวัน date (ms หรือ "YYYY-MM-DD") · คืนแถวราคา หรือ null (ไม่มีราคา / ราคาแรกยังไม่ถึงวันมีผล)
  function priceAt(prices, materialCode, date, kind = "chem") {
    const day = dayKey(date);
    if (!day) return null;
    let best = null;
    for (const row of prices ?? []) {
      if (row.materialCode !== materialCode || kindOf(row) !== kind || !validPrice(row)) continue;
      const from = dayKey(row.effectiveFrom);
      if (from > day) continue;
      const bestFrom = best ? dayKey(best.effectiveFrom) : "";
      if (!best || from > bestFrom || (from === bestFrom && (Number(row.createdAt) || 0) >= (Number(best.createdAt) || 0))) best = row;
    }
    return best;
  }
  // ราคาที่มีผลของทุกรหัสของ kind นั้นในวัน date: Map รหัส → แถวราคา (ไม่มีราคา = ไม่มีใน Map)
  function pricesAt(prices, date, kind = "chem") {
    const out = new Map();
    for (const code of new Set((prices ?? []).filter((row) => kindOf(row) === kind).map((row) => row.materialCode))) {
      const row = priceAt(prices, code, date, kind);
      if (row) out.set(code, row);
    }
    return out;
  }
  // ประวัติราคาของรหัสหนึ่งตัว (kind) ใหม่ก่อน (วันมีผลใหม่สุดก่อน แล้วตามเวลาที่บันทึก)
  const priceHistory = (prices, materialCode, kind = "chem") => (prices ?? []).filter((row) => row.materialCode === materialCode && kindOf(row) === kind)
    .sort((a, b) => (dayKey(b.effectiveFrom) < dayKey(a.effectiveFrom) ? -1 : dayKey(b.effectiveFrom) > dayKey(a.effectiveFrom) ? 1 : (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)));

  // ---------- น้ำหนักตามสูตร ----------
  const PREP_LABEL = "ขั้นเตรียมวัตถุดิบ";
  const stageLabel = (stage) => (Number(stage) === 0 ? PREP_LABEL : `ขั้น ${Number(stage)}`);
  const isWeightMode = (recipe) => (recipe?.items ?? []).length > 0 && recipe.items.every((item) => finite(item?.kg) !== null);
  // น้ำหนักต่อ batch ของทุกบรรทัด (ทั้งสองรูปแบบ) · คืน [{ materialCode, stage, kg, unit }] ตามลำดับในสูตร
  function recipeWeights(recipe) {
    const items = (recipe?.items ?? []).filter((item) => item && typeof item === "object");
    if (isWeightMode(recipe)) {
      return items.map((item) => ({ materialCode: item.materialCode, stage: finite(item.stage) ?? 1, kg: Math.max(0, finite(item.kg) ?? 0), unit: item.unit === "g" ? "g" : "kg" }));
    }
    const total = items.reduce((sum, item) => sum + (finite(item.phr) ?? 0), 0);
    const batchKg = finite(recipe?.batchKg) ?? 0;
    return items.map((item) => ({ materialCode: item.materialCode, stage: Number(item.stage) === 2 ? 2 : 1, kg: total > 0 ? ((finite(item.phr) ?? 0) / total) * batchKg : 0, unit: "kg" }));
  }

  // ---------- ต้นทุนสูตร ----------
  // คืน { batchKg, cost, costPerKg, complete, missing, parts, lines } · ทุกบรรทัดคิดราคาที่มีผลในวัน date · บรรทัดน้ำหนัก 0 = ต้นทุน 0 ไม่นับเป็น "ไม่มีราคา"
  // ราคาขาด (มีน้ำหนักแต่ไม่มีราคา) → ยอดรวมเป็นยอดบางส่วน complete = false · lines เรียงต้นทุนมากไปน้อย (ไม่มีราคาไว้ท้าย) · share = สัดส่วน 0–1 ของต้นทุนรวม (null = ไม่มีราคา)
  function formulaCost(recipe, prices, date) {
    const priced = pricesAt(prices, date, "chem");
    const weights = recipeWeights(recipe);
    const lines = weights.map((line) => {
      const row = priced.get(line.materialCode) ?? null;
      const pricePerKg = row ? Number(row.unitPrice) : null;
      const cost = line.kg > 0 ? (pricePerKg === null ? null : line.kg * pricePerKg) : 0;
      return { ...line, pricePerKg, cost, share: null };
    });
    const missing = [...new Set(lines.filter((line) => line.kg > 0 && line.cost === null).map((line) => line.materialCode))];
    const cost = lines.reduce((sum, line) => sum + (line.cost ?? 0), 0);
    const batchKg = round(isWeightMode(recipe) ? lines.reduce((sum, line) => sum + line.kg, 0) : finite(recipe?.batchKg) ?? 0, 9);
    for (const line of lines) line.share = line.cost !== null && cost > 0 ? line.cost / cost : null;
    const byCost = (a, b) => (a.cost === null) - (b.cost === null) || (b.cost ?? 0) - (a.cost ?? 0) || String(a.materialCode).localeCompare(String(b.materialCode));
    lines.sort(byCost);
    const stages = [...new Set(lines.map((line) => line.stage))].sort((a, b) => a - b);
    const parts = stages.map((stage) => {
      const own = lines.filter((line) => line.stage === stage);
      return { stage, label: stageLabel(stage), kg: round(own.reduce((sum, line) => sum + line.kg, 0), 9), cost: own.reduce((sum, line) => sum + (line.cost ?? 0), 0), lines: own };
    });
    return { batchKg, cost, costPerKg: batchKg > 0 ? cost / batchKg : null, complete: missing.length === 0, missing, parts, lines };
  }

  // ---------- ต้นทุนจริงของล็อตผสม ----------
  // lot = { lotNo, orderId, recipeId, recipeRevision, batches, createdAt, requisitions: [{ id, issuedAt, lines: [{ materialCode, stage, targetKg, actualKg, weighedAt }] }] }
  // จริง = Σ actualKg × ราคาที่มีผลในวันที่ชั่งของบรรทัด (ไม่มีวันชั่ง = วันที่จ่ายของใบเบิก แล้วเป็นวันที่สร้างล็อต) · บรรทัดที่ actualKg ไม่เป็นตัวเลขข้าม
  // สูตร = ต้นทุนสูตรในวันอ้างอิงของล็อต (วันที่ชั่งบรรทัดแรกสุด) × จำนวน batch · recipe = null (หาสูตรไม่เจอ) → formula / diff / diffPct เป็น null
  function lotCost(lot, recipe, prices) {
    let actual = 0;
    let actualKg = 0;
    const missing = new Set();
    let first = null;
    for (const requisition of lot?.requisitions ?? []) {
      for (const line of requisition?.lines ?? []) {
        const kg = finite(line?.actualKg);
        if (kg === null) continue;
        const at = finite(line.weighedAt) ?? finite(requisition.issuedAt) ?? finite(lot.createdAt);
        if (at !== null && (first === null || at < first)) first = at;
        actualKg += kg;
        if (!(kg > 0)) continue;
        const row = at === null ? null : priceAt(prices, line.materialCode, at);
        if (row) actual += kg * Number(row.unitPrice);
        else missing.add(line.materialCode);
      }
    }
    const batches = finite(lot?.batches) ?? 0;
    let formula = null;
    let formulaKg = null;
    let formulaMissing = [];
    if (recipe) {
      const refAt = first ?? finite(lot?.createdAt);
      const planned = formulaCost(recipe, prices, refAt === null ? "" : refAt);
      formula = planned.cost * batches;
      formulaKg = planned.batchKg * batches;
      formulaMissing = planned.missing;
    }
    const all = [...new Set([...missing, ...formulaMissing])];
    const diff = formula === null ? null : actual - formula;
    return { actual, formula, diff, diffPct: diff !== null && formula > 0 ? (diff / formula) * 100 : null, actualKg, formulaKg, complete: all.length === 0, missing: all };
  }

  // revision ที่ใช้งานของสูตรหนึ่งรหัส: อนุมัติแล้ว ไม่มีก็ร่างล่าสุด ไม่มีก็ revision ล่าสุด (กติกาเดียวกับ RubberFlow ไม่ต้องพึ่ง export ของมัน)
  const revisionsOf = (recipes, id) => (recipes ?? []).filter((recipe) => recipe.id === id).sort((a, b) => Number(b.revision) - Number(a.revision));
  const currentRevision = (recipes, id) => { const rows = revisionsOf(recipes, id); return rows.find((r) => r.status === "approved") ?? rows.find((r) => r.status === "draft") ?? rows[0] ?? null; };
  const recipeOfLot = (recipes, lot) => {
    const rows = revisionsOf(recipes, lot?.recipeId);
    return rows.find((recipe) => Number(recipe.revision) === Number(lot?.recipeRevision)) ?? currentRevision(recipes, lot?.recipeId);
  };

  const api = {
    canSeeCost, canSeePrices, canEditPrices, roleCodeOf, deptCodeOf,
    PRICE_KINDS, bangkokDay, dayKey, fmtDay, fmtBaht, fmtPrice, fmtWeight, round,
    priceAt, pricesAt, priceHistory, recipeWeights, formulaCost, lotCost, PREP_LABEL, stageLabel, isWeightMode, revisionsOf, currentRevision, recipeOfLot,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_COST_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
