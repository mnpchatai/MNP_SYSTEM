// ต้นทุนการผลิต (โหมดทดสอบ) — กฎล้วน ไม่มี DOM/Supabase: ใครเห็นราคา/ต้นทุน · ราคาเคมีต่อ kg ที่มีผลในวันหนึ่ง · ต้นทุนสูตรผสม (ต่อ batch / ต่อ kg) · ต้นทุนจริงของล็อตผสมเทียบสูตร
// โหลดก่อน modules/cost-data.js และ modules/st-pages.js (ดู index.html) · เทสต์ด้วย node --test (scripts/tests/cost-rules.test.mjs)
// ราคา: ทุกแถวที่เคยบันทึก { id, kind: "chem"|"part", materialCode, unitPrice, effectiveFrom: "YYYY-MM-DD", note, supplier, createdAt: ms, createdBy } ไม่มีการแก้/ลบ — แก้ราคา = เพิ่มแถวใหม่
//   supplier = ร้าน / ผู้ขายที่ซื้อ (ข้อความอิสระ 0-80 ตัวอักษร · "" = ไม่ได้ระบุ รวมแถวก่อนมีช่องนี้) ไว้เทียบราคาระหว่างร้านเท่านั้น ไม่มีผลกับราคาที่ใช้
//   chem = เคมี RubberFlow ราคาต่อ kg · part = ของซื้อ (ชิ้นงาน BOM ชนิด PURCHASED) ราคาต่อหน่วยของชิ้นนั้น · รหัสของซื้ออาจซ้ำรหัสเคมีได้ จึงแยกตาม kind เสมอ (ต้นทุนสูตรใช้เฉพาะ chem)
//   ราคาที่ใช้ในวัน D = แถวที่ effectiveFrom ล่าสุดที่ไม่เกิน D · วันเดียวกันหลายแถว = แถวที่ createdAt ใหม่สุด (ราคาที่ตั้งล่วงหน้ายังไม่ถูกใช้จนถึงวันนั้น)
// สูตร: โหมดน้ำหนัก { materialCode, stage 0|1|2|3, kg (ต่อ batch), unit "kg"|"g" (หน่วยที่กรอก ไม่เปลี่ยนค่า kg), phr } · โหมดเดิม { materialCode, phr, stage 1|2 } (kg ต่อ batch = phr ÷ Σphr × batchKg)
// ค่าแรง (เฟส 2): อัตราบาท/ชม. ต่อแผนก + เวลามาตรฐานของ RB ต่อรหัสสินค้า (นาทีต่อชุดผสม + จำนวนคน 7 ขั้น) → ค่าแรงต่อชุดผสม / ต่อ kg ของสูตร (labourCost)
// ต้นทุนต่อชิ้น (เฟส 3): itemCost = ค่าแรงแผนก GR / PT / BG / PK จากเป้าชิ้น/ชม. × จำนวนคน + ของซื้อในบรรทัด BOM ของชิ้นนั้น (ชิ้นที่ผลิตเองข้างใต้ยังไม่รวม)
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
  // ร้าน / ผู้ขายของแถวราคา (ตัดช่องว่างหัวท้าย · ไม่มี = "")
  const supplierOf = (row) => String(row?.supplier ?? "").trim();
  // ราคาล่าสุดของแต่ละร้านของรหัสหนึ่งตัว (kind) ไว้เทียบ: แถวที่วันมีผลใหม่สุด (ซ้ำวันใช้ createdAt ใหม่สุด) ของแต่ละร้านที่ระบุชื่อ
  //   แถวที่ไม่ระบุร้านไม่นับ · เรียงถูกสุดก่อน (เท่ากัน = วันมีผลใหม่กว่าก่อน แล้วตามชื่อร้าน) · คืน [{ supplier, row }]
  //   ไม่เกี่ยวกับราคาที่ใช้ (priceAt ไม่ดูร้าน)
  function latestBySupplier(prices, materialCode, kind = "chem") {
    const out = new Map();
    for (const row of priceHistory(prices, materialCode, kind)) {
      const supplier = supplierOf(row);
      if (supplier && validPrice(row) && !out.has(supplier)) out.set(supplier, row);
    }
    return [...out].map(([supplier, row]) => ({ supplier, row })).sort((a, b) => Number(a.row.unitPrice) - Number(b.row.unitPrice)
      || (dayKey(b.row.effectiveFrom) < dayKey(a.row.effectiveFrom) ? -1 : dayKey(b.row.effectiveFrom) > dayKey(a.row.effectiveFrom) ? 1 : 0)
      || a.supplier.localeCompare(b.supplier, "th"));
  }
  // ชื่อร้านที่เคยใช้ในทุกแถวราคา (ทุกชนิด ไม่ซ้ำ เรียงตามชื่อ) ไว้เป็นตัวเลือกของช่องร้าน
  const supplierNames = (prices) => [...new Set((prices ?? []).map(supplierOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));

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

  // ---------- ค่าแรง (เฟส 2): อัตราบาท/ชม. ต่อแผนก + เวลามาตรฐานของ RB ต่อรหัสสินค้า ----------
  // อัตรา: { id, departmentCode, ratePerHour, effectiveFrom, note, createdAt, createdBy } · เวลามาตรฐาน: { id, productCode, effectiveFrom, steps: [{ step, minutes, workers }], note, createdAt, createdBy }
  //   ทั้งสองเพิ่มอย่างเดียว (แก้ = แถวใหม่) · ค่าที่ใช้ในวัน D = แถวที่ effectiveFrom ล่าสุดที่ไม่เกิน D ซ้ำวันใช้ createdAt ใหม่สุด (กติกาเดียวกับราคา)
  //   minutes = นาทีต่อ 1 ชุดผสม (โม่) ของขั้นนั้น · workers = จำนวนคนของขั้นนั้น · ค่าแรงของขั้น = minutes ÷ 60 × workers × อัตราของแผนก RB
  // ใครทำอะไร (ฐานข้อมูลบังคับ RF_FORBIDDEN): อัตราค่าแรง อ่าน + แก้ = ผู้เห็นต้นทุน · เวลามาตรฐาน อ่าน = ผู้เห็นต้นทุน + แผนก RB ทุกบทบาท · แก้ = ผู้เห็นต้นทุน + หัวหน้าแผนก RB
  const RB_DEPT = "RB";
  const LABOUR_DEPTS = Object.freeze(["RB", "GR", "PT", "BG", "PK"]);
  const RB_HEAD_ROLES = Object.freeze(["department_manager", "assistant_department_manager"]);
  const canEditRates = (employee) => canSeeCost(employee);
  const canSeeStandards = (employee) => canSeeCost(employee) || (Boolean(employee) && deptCodeOf(employee) === RB_DEPT);
  const canEditStandards = (employee) => canSeeCost(employee) || (Boolean(employee) && deptCodeOf(employee) === RB_DEPT && RB_HEAD_ROLES.includes(roleCodeOf(employee)));
  // 7 ขั้นตามลำดับงาน (ตรงกับ private.rf_standard_steps): สถานีผสมแยก 4 ส่วน แล้วฉีดขึ้นรูป อบ ตกแต่งและบรรจุ
  const STATIONS = Object.freeze([
    Object.freeze({ id: "mixing", label: "ผสมยาง" }), Object.freeze({ id: "extrusion", label: "ฉีดขึ้นรูป" }),
    Object.freeze({ id: "curing", label: "อบ HCM" }), Object.freeze({ id: "finishing", label: "ตกแต่งและบรรจุ" }),
  ]);
  const STEPS = Object.freeze([
    { id: "prep", label: "ผสม · ขั้นเตรียมวัตถุดิบ", station: "mixing" }, { id: "mix1", label: "ผสม · ขั้น 1", station: "mixing" },
    { id: "mix2", label: "ผสม · ขั้น 2", station: "mixing" }, { id: "mix3", label: "ผสม · ขั้น 3", station: "mixing" },
    { id: "extrusion", label: "ฉีดขึ้นรูป", station: "extrusion" }, { id: "curing", label: "อบ HCM", station: "curing" },
    { id: "finishing", label: "ตกแต่งและบรรจุ", station: "finishing" },
  ].map((step) => Object.freeze(step)));
  const stepLabel = (id) => STEPS.find((step) => step.id === id)?.label ?? String(id);
  // นาที: ตัดเลข 0 ท้าย ไม่เกิน 2 ทศนิยม
  const fmtMinutes = (value) => { const number = finite(value); return number === null ? "-" : number.toLocaleString("th-TH", { maximumFractionDigits: 2 }); };
  // แถวที่มีผลในวัน date จากแถวที่ผ่าน match (กติกา effectiveFrom / createdAt เดียวกับ priceAt)
  function effectiveRow(rows, date, match) {
    const day = dayKey(date);
    if (!day) return null;
    let best = null;
    for (const row of rows ?? []) {
      if (!row || !match(row)) continue;
      const from = dayKey(row.effectiveFrom);
      if (!from || from > day) continue;
      const bestFrom = best ? dayKey(best.effectiveFrom) : "";
      if (!best || from > bestFrom || (from === bestFrom && (Number(row.createdAt) || 0) >= (Number(best.createdAt) || 0))) best = row;
    }
    return best;
  }
  const newestFirst = (a, b) => (dayKey(b.effectiveFrom) < dayKey(a.effectiveFrom) ? -1 : dayKey(b.effectiveFrom) > dayKey(a.effectiveFrom) ? 1 : (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  const validRate = (row) => finite(row.ratePerHour) !== null && Number(row.ratePerHour) > 0;
  const rateAt = (rates, departmentCode, date) => effectiveRow(rates, date, (row) => row.departmentCode === departmentCode && validRate(row));
  const rateHistory = (rates, departmentCode) => (rates ?? []).filter((row) => row.departmentCode === departmentCode).sort(newestFirst);
  const standardAt = (standards, productCode, date) => (productCode ? effectiveRow(standards, date, (row) => row.productCode === productCode && Array.isArray(row.steps)) : null);
  const standardHistory = (standards, productCode) => (standards ?? []).filter((row) => row.productCode === productCode).sort(newestFirst);
  // ค่าของแต่ละขั้นจากแถวเวลามาตรฐาน (ขั้นที่ไม่มีในแถว = 0 นาที 0 คน) ตามลำดับ STEPS
  const standardSteps = (standard) => STEPS.map((step) => {
    const row = (standard?.steps ?? []).find((entry) => entry?.step === step.id);
    return { step: step.id, label: step.label, station: step.station, minutes: Math.max(0, finite(row?.minutes) ?? 0), workers: Math.max(0, finite(row?.workers) ?? 0) };
  });
  const standardMinutes = (standard) => round(standardSteps(standard).reduce((sum, step) => sum + step.minutes, 0), 6);
  // ค่าแรงต่อชุดผสมของสูตรในวัน date · batchKg = น้ำหนักต่อชุดผสม (จาก formulaCost) ใช้หาค่าแรงต่อ kg
  // คืน { productCode, standard, rate, ratePerHour, steps, stations, minutes, manHours, cost, costPerKg, complete, reason }
  //   reason: "" (ครบ) · "noProduct" (สูตรไม่มีรหัสสินค้า) · "noStandard" (สินค้ายังไม่มีเวลามาตรฐานที่มีผลในวันนั้น) · "noRate" (ยังไม่มีอัตราค่าแรงของ RB ที่มีผล)
  //   ไม่ครบ = cost / costPerKg เป็น null (ไม่เดาเป็น 0) · เวลาและชั่วโมงคนยังคำนวณได้เมื่อมีเวลามาตรฐาน (แผนก RB เห็นเวลาโดยไม่มีอัตรา)
  function labourCost(recipe, standards, rates, date, batchKg) {
    const productCode = String(recipe?.productCode ?? "").trim();
    const standard = standardAt(standards, productCode, date);
    const rate = rateAt(rates, RB_DEPT, date);
    const ratePerHour = rate ? Number(rate.ratePerHour) : null;
    const steps = standardSteps(standard).map((step) => {
      const manHours = (step.minutes / 60) * step.workers;
      return { ...step, manHours, cost: standard && ratePerHour !== null ? manHours * ratePerHour : null };
    });
    const stations = STATIONS.map((station) => {
      const own = steps.filter((step) => step.station === station.id);
      return { station: station.id, label: station.label, minutes: round(own.reduce((sum, step) => sum + step.minutes, 0), 6), manHours: own.reduce((sum, step) => sum + step.manHours, 0), cost: standard && ratePerHour !== null ? own.reduce((sum, step) => sum + (step.cost ?? 0), 0) : null };
    });
    const reason = !productCode ? "noProduct" : !standard ? "noStandard" : ratePerHour === null ? "noRate" : "";
    const cost = reason ? null : steps.reduce((sum, step) => sum + (step.cost ?? 0), 0);
    const kg = finite(batchKg);
    return {
      productCode, standard, rate, ratePerHour, steps, stations,
      minutes: round(steps.reduce((sum, step) => sum + step.minutes, 0), 6), manHours: steps.reduce((sum, step) => sum + step.manHours, 0),
      cost, costPerKg: cost !== null && kg !== null && kg > 0 ? cost / kg : null, complete: reason === "", reason,
    };
  }

  // ---------- ต้นทุนต่อชิ้น (เฟส 3): ค่าแรงแผนก GR / PT / BG / PK + ของซื้อในบรรทัด BOM ของชิ้นนั้นเอง (ยังไม่รวมชิ้นที่ผลิตเองข้างใต้และคอมปาวด์ยาง) ----------
  // เวลามาตรฐาน = เป้าชิ้น/ชม. ที่หัวหน้าแผนกตั้งใน "ตั้งค่าขั้นตอนและเป้า" (bom_gr_config.targets { itemCode, stepCode, perHour, people })
  // ค่าแรงของขั้นต่อชิ้น = อัตราของแผนก (บาท/ชม. ที่มีผลในวันนั้น) × จำนวนคน ÷ เป้าชิ้น/ชม. · นาทีต่อชิ้น = 60 ÷ เป้า · ชั่วโมงคนต่อชิ้น = จำนวนคน ÷ เป้า
  // ของซื้อ = ราคา kind "part" ที่มีผลในวันนั้น × ปริมาณต่อชิ้นรวมเผื่อเสีย (qty × (1 + scrapPct ÷ 100) เหมือนโครงสร้างสินค้าของ BOM)
  const STEP_DEPTS = Object.freeze(["GR", "PT", "BG", "PK"]);
  const MADE_SKIP_KINDS = Object.freeze(["PURCHASED", "CP", "RB"]);
  // ชิ้นที่มีหน้าต้นทุนต่อชิ้น: ชิ้นที่ผลิตเองในแผนกที่มีเป้า (ไม่ใช่ของซื้อ สูตรยาง หรือเส้นยางที่คิดค่าแรงต่อชุดผสมที่ต้นทุนสูตร)
  const hasItemCost = (item) => Boolean(item) && !MADE_SKIP_KINDS.includes(item.kind);
  // จำนวนคนของเป้า: จำนวนเต็ม 1–50 · ไม่มี/ผิด = 1 (ตรงกับ bom-rules grPeople และฐานข้อมูล)
  const peopleOf = (value) => { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 1; };
  const configDeptOf = (config) => String(config?.dept ?? "GR").toUpperCase();
  // เป้าของชิ้นหนึ่งจากตั้งค่าของทุกแผนก (configs = [{ dept, steps, targets }] หรือ { GR: config, ... }) เรียงตามแผนก GR → PT → BG → PK แล้วตามลำดับขั้นในตั้งค่า
  // คืน [{ dept, stepCode, stepName, seq, perHour, people }] · เป้าที่ไม่ใช่ตัวเลขบวกข้าม · ขั้นที่ไม่ใช้แล้ว (active false) ยังนับถ้ายังมีเป้า (หัวหน้าลบเป้าเพื่อหยุด)
  function deptTargetsOf(configs, itemCode) {
    const list = Array.isArray(configs) ? configs : Object.entries(configs ?? {}).map(([dept, config]) => ({ ...config, dept: config?.dept ?? dept }));
    const out = [];
    for (const config of list) {
      const dept = configDeptOf(config);
      const steps = Array.isArray(config?.steps) ? config.steps : [];
      for (const target of Array.isArray(config?.targets) ? config.targets : []) {
        if (!target || target.itemCode !== itemCode) continue;
        const perHour = finite(target.perHour);
        if (perHour === null || perHour <= 0) continue;
        const index = steps.findIndex((step) => step?.code === target.stepCode);
        const step = index >= 0 ? steps[index] : null;
        out.push({ dept, stepCode: String(target.stepCode ?? ""), stepName: String(step?.name ?? target.stepCode ?? ""), seq: finite(step?.seq) ?? (index >= 0 ? index + 1 : 1000), perHour, people: peopleOf(target.people) });
      }
    }
    const deptRank = (dept) => (STEP_DEPTS.includes(dept) ? STEP_DEPTS.indexOf(dept) : STEP_DEPTS.length);
    return out.sort((a, b) => deptRank(a.dept) - deptRank(b.dept) || a.seq - b.seq || a.stepCode.localeCompare(b.stepCode));
  }
  // ต้นทุนที่เพิ่มที่ชิ้นนี้ ต่อ 1 หน่วยของชิ้น ณ วัน date (ไม่ roll-up ลูกที่ผลิตเอง: เฟส 4)
  // item = ชิ้นงาน BOM { code, name, kind, ownerDept, uom } · bom = BOM ที่อนุมัติของชิ้นนี้ (หรือ null) · itemOf(code) → ชิ้นงาน | null
  // configs = ตั้งค่าขั้นตอนและเป้าของ GR / PT / BG / PK · prices = แถวราคา (ใช้เฉพาะ kind part) · rates = อัตราค่าแรงต่อแผนก
  // ค่าที่ไม่รู้ = null ไม่เดาเป็น 0 · ยอดรวมนับเฉพาะส่วนที่รู้ partial = มีส่วนที่ยังคิดไม่ได้ (หน้าแสดง "≥")
  function itemCost(item, { bom = null, itemOf = () => null, configs = [], prices = [], rates = [], date } = {}) {
    const itemCode = String(item?.code ?? "");
    const day = dayKey(date);
    const steps = deptTargetsOf(configs, itemCode).map((target) => {
      const rate = rateAt(rates, target.dept, day);
      const ratePerHour = rate ? Number(rate.ratePerHour) : null;
      return {
        dept: target.dept, stepCode: target.stepCode, stepName: target.stepName, perHour: target.perHour, people: target.people,
        minutes: 60 / target.perHour, manHours: target.people / target.perHour, ratePerHour, cost: ratePerHour === null ? null : (ratePerHour * target.people) / target.perHour,
      };
    });
    const deptCodes = [...new Set(steps.map((step) => step.dept))];
    const depts = deptCodes.map((dept) => {
      const own = steps.filter((step) => step.dept === dept);
      const ratePerHour = own[0].ratePerHour;
      return { dept, minutes: own.reduce((sum, step) => sum + step.minutes, 0), manHours: own.reduce((sum, step) => sum + step.manHours, 0), ratePerHour, cost: ratePerHour === null ? null : own.reduce((sum, step) => sum + step.cost, 0) };
    });
    const reasons = [];
    const owner = String(item?.ownerDept ?? "").toUpperCase();
    if (STEP_DEPTS.includes(owner) && !deptCodes.includes(owner)) reasons.push({ dept: owner, reason: "noTarget" });
    for (const row of depts) if (row.ratePerHour === null) reasons.push({ dept: row.dept, reason: "noRate" });
    const labour = {
      steps, depts,
      minutes: steps.reduce((sum, step) => sum + step.minutes, 0), manHours: steps.reduce((sum, step) => sum + step.manHours, 0),
      cost: steps.reduce((sum, step) => sum + (step.cost ?? 0), 0), complete: reasons.length === 0, reasons,
    };
    const priced = pricesAt(prices, day, "part");
    const lines = [];
    const made = [];
    for (const line of Array.isArray(bom?.lines) ? bom.lines : []) {
      const childCode = String(line?.childCode ?? "");
      const child = itemOf(childCode) ?? null;
      const scrapPct = finite(line?.scrapPct) ?? 0;
      const factor = (finite(line?.qty) ?? 0) * (1 + scrapPct / 100);
      if (child?.kind === "PURCHASED") {
        const row = priced.get(childCode) ?? null;
        const unitPrice = row ? Number(row.unitPrice) : null;
        lines.push({ childCode, name: String(child.name ?? ""), uom: String(line?.uom ?? child.uom ?? ""), qty: finite(line?.qty) ?? 0, scrapPct, factor, unitPrice, cost: unitPrice === null ? null : factor * unitPrice });
      } else {
        made.push({ childCode, name: String(child?.name ?? ""), kind: child?.kind ?? null, factor });
      }
    }
    const missing = [...new Set(lines.filter((line) => line.cost === null && line.factor > 0).map((line) => line.childCode))];
    const materials = { lines, cost: lines.reduce((sum, line) => sum + (line.cost ?? 0), 0), complete: missing.length === 0, missing };
    return { itemCode, labour, materials, made, own: labour.cost + materials.cost, partial: !labour.complete || !materials.complete };
  }
  // เป้าชิ้น/ชม. และปริมาณต่อชิ้น: ตัดเลข 0 ท้าย · ปริมาณเล็กมาก (เช่น 0.0036 kg) ต้องเห็นได้ จึงถึง 6 ทศนิยม
  const fmtPerHour = (value) => { const number = finite(value); return number === null ? "-" : number.toLocaleString("th-TH", { maximumFractionDigits: 2 }); };
  const fmtQtyPer = (value) => { const number = finite(value); return number === null ? "-" : number.toLocaleString("th-TH", { maximumFractionDigits: 6 }); };

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
    priceAt, pricesAt, priceHistory, supplierOf, latestBySupplier, supplierNames, recipeWeights, formulaCost, lotCost, PREP_LABEL, stageLabel, isWeightMode, revisionsOf, currentRevision, recipeOfLot,
    canSeeStandards, canEditStandards, canEditRates, LABOUR_DEPTS, RB_DEPT, STEPS, STATIONS, stepLabel, fmtMinutes, rateAt, rateHistory, standardAt, standardHistory, standardSteps, standardMinutes, labourCost,
    STEP_DEPTS, hasItemCost, deptTargetsOf, itemCost, fmtPerHour, fmtQtyPer,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_COST_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
