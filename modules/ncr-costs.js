// Shared by the Pilot forms, register and dashboard. Old rows need review; missing is never zero.
(function registerNcrCosts(root) {
  const TYPES = { scrap: "ของเสีย/ทิ้ง", material: "ต้นทุนวัตถุดิบสูญเสีย", repair: "ค่าซ่อม (Repair)", rework: "ค่า Rework", sort: "ค่าแรงคัดแยก", reproduce: "ผลิตทดแทน (ค่าใช้จ่ายส่วนเพิ่ม)", logistics: "ขนส่ง/ส่งคืน", claim: "เคลม/ส่วนลดลูกค้า", downtime: "เครื่องหยุด/รอ", other: "อื่น ๆ" };
  const STATUSES = { estimated: "ประมาณการ", confirmed: "ยืนยันแล้ว", legacy: "รายการเดิมรอตรวจสอบ" };
  const COMPONENTS = { quantity: "จำนวน × ต้นทุน", labor: "ค่าแรง", material: "วัสดุซ่อม", external: "ค่าจ้างภายนอก", amount: "ยอดตามเอกสาร" };
  const round = (value, digits = 2) => Math.round((Number(value) + Number.EPSILON) * 10 ** digits) / 10 ** digits;
  const allowedComponents = (type, kind = "loss") => kind === "recovery" ? ["amount"] : ["repair", "rework"].includes(type) ? ["labor", "material", "external"] : type === "sort" ? ["labor", "external"] : ["scrap", "material", "downtime"].includes(type) ? ["quantity"] : ["amount"];
  function fieldSpec(type, component, kind = "loss", unit = "ชิ้น") {
    if (kind === "recovery" || component === "amount" || component === "external") return { quantity: "จำนวนรายการ", rate: "ยอดเงินตามเอกสาร (บาท)", unit: "รายการ", fixedQuantity: true, hint: kind === "recovery" ? "เงินชดเชย/เครดิตผู้ขาย/ขายซาก แยกจากค่าเสียหาย" : type === "reproduce" ? "บันทึกเฉพาะค่าใช้จ่ายส่วนเพิ่มที่ยังไม่ได้ลงในหมวดอื่น" : "บันทึกค่าใช้จ่ายเพิ่มเติมจาก NCR ตามเอกสาร" };
    if (component === "labor") return { quantity: "ชั่วโมงแรงงานรวม (ทุกคน)", rate: "ค่าแรง (บาท/คน/ชั่วโมง)", unit: "คน-ชม.", hint: "เช่น 2 คน × 3 ชั่วโมง = 6 คน-ชม. แยกเวลาซ่อม Rework และคัดแยกเป็นคนละรายการ" };
    if (component === "material") return { quantity: "จำนวนวัสดุที่ใช้ซ่อม", rate: "ต้นทุนวัสดุต่อหน่วย (บาท)", unit, hint: "เก็บค่าวัสดุแยกจากค่าแรงซ่อม" };
    if (type === "downtime") return { quantity: "เวลาเครื่องหยุด (ชั่วโมง)", rate: "ต้นทุนเครื่องหยุด (บาท/ชั่วโมง)", unit: "ชม.", hint: "ใช้เฉพาะอัตราต้นทุนที่องค์กรกำหนด หากยังไม่มีอัตราให้เก็บเวลาในผลดำเนินการ" };
    if (type === "material") return { quantity: "จำนวนวัตถุดิบสูญเสีย", rate: "ต้นทุนวัตถุดิบต่อหน่วย (บาท)", unit: "กก.", hint: "ใช้เฉพาะวัตถุดิบสูญเสียที่ยังไม่รวมในต้นทุนชิ้นงานที่ทิ้ง เพื่อไม่ให้นับซ้ำ" };
    return { quantity: "จำนวนทิ้งจริง", rate: "ต้นทุนต่อหน่วย ณ ขั้นตอนที่ทิ้ง (บาท)", unit, hint: "ใช้จำนวนที่ทิ้งจริง ห้ามนำจำนวนที่พบปัญหามาคิดเป็นของเสียทั้งหมด" };
  }
  function makeEntry(input) {
    if (!TYPES[input.loss_type] || !["loss", "recovery"].includes(input.entry_kind)) throw new Error("INVALID_LOSS_TYPE");
    if (!["estimated", "confirmed"].includes(input.cost_status)) throw new Error("INVALID_LOSS_STATUS");
    if (!allowedComponents(input.loss_type, input.entry_kind).includes(input.component)) throw new Error("INVALID_LOSS_COMPONENT");
    const missing = (v) => v === null || v === undefined || String(v).trim() === "";
    if (missing(input.quantity) || missing(input.unit_cost)) throw new Error("INVALID_LOSS");
    const quantity = round(input.quantity, 3), rate = round(input.unit_cost);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 || !Number.isFinite(rate) || rate < 0 || rate > 1e9 || quantity * rate >= 1e14) throw new Error("INVALID_LOSS");
    if (["amount", "external"].includes(input.component) && quantity !== 1) throw new Error("INVALID_LOSS");
    const unit = String(input.unit ?? "").trim(), note = String(input.note ?? "").trim(), ref = String(input.evidence_ref ?? "").trim();
    if (!unit || unit.length > 20 || note.length > 500 || ref.length > 200) throw new Error("INVALID_LOSS");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.incurred_on ?? "") || !Number.isFinite(Date.parse(`${input.incurred_on}T00:00:00Z`)) || new Date(`${input.incurred_on}T00:00:00Z`).toISOString().slice(0, 10) !== input.incurred_on) throw new Error("INVALID_LOSS_DATE");
    if (input.cost_status === "confirmed" && !ref) throw new Error("LOSS_EVIDENCE_REQUIRED");
    if (input.loss_type === "other" && input.entry_kind === "loss" && note.length < 5) throw new Error("INVALID_LOSS_NOTE");
    return { loss_type: input.loss_type, entry_kind: input.entry_kind, cost_status: input.cost_status, component: input.component, quantity, unit, unit_cost: rate, incurred_on: input.incurred_on, evidence_ref: ref || null, note: note || null };
  }
  function summarize(losses) {
    const result = { confirmed: 0, recovery: 0, estimated: 0, estimatedRecovery: 0, legacy: 0, pending: 0, count: 0 };
    for (const row of losses) {
      if (row.voided_at) continue;
      result.count++;
      const amount = Number(row.amount), status = row.cost_status ?? "legacy";
      if (!Number.isFinite(amount)) throw new Error("INVALID_LOSS");
      const recovery = row.entry_kind === "recovery";
      if (status === "confirmed") result[recovery ? "recovery" : "confirmed"] += amount;
      else { result.pending++; result[status === "estimated" ? recovery ? "estimatedRecovery" : "estimated" : "legacy"] += amount; }
    }
    for (const key of ["confirmed", "recovery", "estimated", "estimatedRecovery", "legacy"]) result[key] = round(result[key]);
    result.net = round(result.confirmed - result.recovery);
    return result;
  }
  const api = { TYPES, STATUSES, COMPONENTS, round, allowedComponents, fieldSpec, makeEntry, summarize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_NCR_COSTS = api;
})(typeof window !== "undefined" ? window : globalThis);
