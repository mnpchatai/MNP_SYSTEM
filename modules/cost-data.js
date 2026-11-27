// ต้นทุนการผลิต (โหมดทดสอบ) — ตัวโหลดข้อมูลราคาวัตถุดิบ (เคมี + ของซื้อ) / ต้นทุนจากฐานข้อมูล (RPC app_rf_prices · app_rf_price_save · app_rf_cost_data) ไว้ในหน่วยความจำของหน้าเท่านั้น
// ค่าแรง (เฟส 2): อัตราค่าแรงและเวลามาตรฐานของ RB (RPC app_rf_labour · app_rf_labour_rate_save · app_rf_station_standard_save) ใช้โดยหน้าต้นทุนและหน้าสูตรยางของ RubberFlow (modules/cost-labour-ui.js)
// ไม่เก็บลง localStorage/sessionStorage (ราคาเป็นความลับ) · เปลี่ยนผู้ใช้/บัญชีทดสอบ (state.employee.id) = ทิ้งข้อมูลที่ถือไว้
// ใช้ร่วมกันโดยหน้า ST (ราคาในรายการ "ในคลัง" · modules/st-pages.js) และโมดูลต้นทุนการผลิต (modules/cost-pages.js) · โหลดหลัง modules/cost-rules.js ก่อนสองไฟล์นั้น
// sb / state เป็น global ของ app.js (อ้างตอนเรียกเท่านั้น) · สิทธิ์จริงตัดสินที่ฐานข้อมูล: ไม่มีสิทธิ์ = RPC ตอบ RF_FORBIDDEN → สถานะ "forbidden"
(function registerCostData(root) {
  const MAX_AGE_MS = 120000; // เปิดหน้าอีกครั้งหลังเกินนี้ = โหลดใหม่ (ราคาเปลี่ยนโดยคนอื่นได้)
  const blank = () => ({ status: "idle", error: null, at: 0, version: 0 });
  let owner = "";
  let pricesState = { ...blank(), canWrite: false, prices: [] };
  let costState = { ...blank(), data: null };
  const noLabour = () => ({ canSeeRates: false, canWriteRates: false, canWriteStandards: false, rates: [], standards: [] });
  let labourState = { ...blank(), ...noLabour() };
  const inflight = { prices: null, cost: null, labour: null };

  const currentOwner = () => { try { return String(state?.employee?.id ?? ""); } catch { return ""; } };
  function checkOwner() {
    const now = currentOwner();
    if (now === owner) return;
    owner = now;
    pricesState = { ...blank(), canWrite: false, prices: [], version: pricesState.version + 1 };
    costState = { ...blank(), data: null, version: costState.version + 1 };
    labourState = { ...blank(), ...noLabour(), version: labourState.version + 1 };
    inflight.prices = null;
    inflight.cost = null;
    inflight.labour = null;
  }
  // รหัสผิดพลาดของฐานข้อมูลอยู่ใน error.message (หรือ details/hint) · RF_FORBIDDEN = ไม่มีสิทธิ์
  const codeOf = (error) => [error?.message, error?.details, error?.hint, error?.code].map((part) => String(part ?? "")).join(" ");
  const isForbidden = (error) => codeOf(error).includes("RF_FORBIDDEN");
  const errorText = (error) => {
    const text = codeOf(error);
    if (text.includes("RF_FORBIDDEN")) return "บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลนี้";
    if (text.includes("RF_INVALID_PRICE")) return "ข้อมูลราคาไม่ถูกต้อง ตรวจชนิด รหัสวัตถุดิบหรือของซื้อ ราคา (มากกว่า 0 และไม่เกิน 10,000,000 ทศนิยมไม่เกิน 4 ตำแหน่ง) วันที่มีผล (ไม่ล่วงหน้าเกิน 366 วัน) และหมายเหตุ (ไม่เกิน 300 ตัวอักษร)";
    if (text.includes("RF_INVALID_LABOUR")) return "ข้อมูลอัตราค่าแรงไม่ถูกต้อง ตรวจแผนก อัตรา (มากกว่า 0 และไม่เกิน 100,000 ทศนิยมไม่เกิน 2 ตำแหน่ง) วันที่มีผล (ไม่ล่วงหน้าเกิน 366 วัน) และหมายเหตุ (ไม่เกิน 300 ตัวอักษร)";
    if (text.includes("RF_INVALID_STANDARD")) return "ข้อมูลเวลามาตรฐานไม่ถูกต้อง ตรวจรหัสสินค้า (ต้องเป็นรหัสสินค้าของสูตรยาง) เวลา (0 ถึง 100,000 นาที มีอย่างน้อยหนึ่งขั้นที่มากกว่า 0) จำนวนคน (0 ถึง 1,000) ทศนิยมไม่เกิน 2 ตำแหน่ง และวันที่มีผล";
    return "ติดต่อฐานข้อมูลไม่สำเร็จ ลองอีกครั้ง";
  };
  async function call(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  const rowsOf = (list) => (Array.isArray(list) ? list : []).map((row) => ({
    id: row.id, kind: row.kind === "part" ? "part" : "chem", materialCode: String(row.materialCode ?? ""), unitPrice: Number(row.unitPrice), effectiveFrom: String(row.effectiveFrom ?? "").slice(0, 10),
    note: String(row.note ?? ""), createdAt: Number(row.createdAt) || 0, createdBy: String(row.createdBy ?? ""),
  }));

  // ---------- ราคาวัตถุดิบ: เคมี (ต่อ kg) และของซื้อ (ต่อหน่วยของชิ้น) · ผู้ที่เห็นราคา ----------
  const prices = () => { checkOwner(); return pricesState; };
  const stale = (state) => state.status === "idle" || (state.status === "ready" && Date.now() - state.at >= MAX_AGE_MS);
  // ยังไม่เคยโหลด หรือที่โหลดไว้เก่าเกินกำหนด (และไม่มีการโหลดค้างอยู่): ผู้เรียกสั่งโหลดแล้ววาดหน้าใหม่เมื่อเสร็จ · error / forbidden ไม่โหลดซ้ำเอง (ผู้ใช้กดลองอีกครั้ง)
  const needsPrices = () => { checkOwner(); return !inflight.prices && stale(pricesState); };
  function applyPrices(data) {
    pricesState = { ...pricesState, status: "ready", error: null, at: Date.now(), canWrite: Boolean(data?.canWrite), prices: rowsOf(data?.prices) };
  }
  // โหลดราคา (ครั้งเดียวต่อรอบ · ใหม่ถ้าเกิน MAX_AGE_MS หรือสั่ง force) · คืน Promise ที่จบเมื่อโหลดเสร็จ (ผู้เรียกวาดหน้าใหม่เอง)
  function loadPrices({ force = false } = {}) {
    checkOwner();
    if (inflight.prices) return inflight.prices;
    if (!force && pricesState.status === "ready" && Date.now() - pricesState.at < MAX_AGE_MS) return Promise.resolve(pricesState);
    const version = pricesState.version;
    pricesState = { ...pricesState, status: pricesState.status === "ready" ? "ready" : "loading" };
    inflight.prices = call("app_rf_prices", {}).then((data) => {
      if (pricesState.version === version) applyPrices(data);
    }, (error) => {
      if (pricesState.version === version) pricesState = { ...pricesState, status: isForbidden(error) ? "forbidden" : "error", error, prices: [], canWrite: false };
    }).then(() => { inflight.prices = null; return pricesState; });
    return inflight.prices;
  }
  // บันทึกราคาใหม่ของเคมี (kind "chem" ต่อ kg) หรือของซื้อ (kind "part" ต่อหน่วยของชิ้น) (แถวใหม่ ไม่แก้แถวเดิม) · คืน { ok: true } หรือ { ok: false, message }
  async function savePrice({ kind, materialCode, unitPrice, effectiveFrom, note }) {
    checkOwner();
    const version = pricesState.version;
    try {
      const data = await call("app_rf_price_save", { p_kind: kind, p_material_code: materialCode, p_unit_price: unitPrice, p_effective_from: effectiveFrom, p_note: note ?? "" });
      if (pricesState.version === version) applyPrices(data);
      costState = { ...costState, at: 0 }; // ต้นทุนที่โหลดไว้เป็นของราคาเก่า: เปิดหน้าต้นทุนครั้งหน้าโหลดใหม่
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorText(error), forbidden: isForbidden(error) };
    }
  }

  // ---------- ต้นทุน (เฉพาะผู้เห็นต้นทุน) ----------
  const cost = () => { checkOwner(); return costState; };
  const needsCost = () => { checkOwner(); return !inflight.cost && stale(costState); };
  function loadCost({ force = false } = {}) {
    checkOwner();
    if (inflight.cost) return inflight.cost;
    if (!force && costState.status === "ready" && Date.now() - costState.at < MAX_AGE_MS) return Promise.resolve(costState);
    const version = costState.version;
    costState = { ...costState, status: costState.status === "ready" ? "ready" : "loading" };
    inflight.cost = call("app_rf_cost_data", {}).then((data) => {
      if (costState.version !== version) return;
      costState = {
        ...costState, status: "ready", error: null, at: Date.now(),
        data: { prices: rowsOf(data?.prices), materials: Array.isArray(data?.materials) ? data.materials : [], recipes: Array.isArray(data?.recipes) ? data.recipes : [], lots: Array.isArray(data?.lots) ? data.lots : [] },
      };
    }, (error) => {
      if (costState.version === version) costState = { ...costState, status: isForbidden(error) ? "forbidden" : "error", error, data: null };
    }).then(() => { inflight.cost = null; return costState; });
    return inflight.cost;
  }
  // ---------- ค่าแรง: อัตราบาท/ชม. ต่อแผนก (เฉพาะผู้เห็นต้นทุน) + เวลามาตรฐานของ RB ต่อรหัสสินค้า (ผู้เห็นต้นทุน + แผนก RB) · RPC app_rf_labour ----------
  const rateRows = (list) => (Array.isArray(list) ? list : []).map((row) => ({
    id: row.id, departmentCode: String(row.departmentCode ?? ""), ratePerHour: Number(row.ratePerHour), effectiveFrom: String(row.effectiveFrom ?? "").slice(0, 10),
    note: String(row.note ?? ""), createdAt: Number(row.createdAt) || 0, createdBy: String(row.createdBy ?? ""),
  }));
  const standardRows = (list) => (Array.isArray(list) ? list : []).map((row) => ({
    id: row.id, productCode: String(row.productCode ?? ""), effectiveFrom: String(row.effectiveFrom ?? "").slice(0, 10),
    steps: (Array.isArray(row.steps) ? row.steps : []).map((step) => ({ step: String(step?.step ?? ""), minutes: Number(step?.minutes) || 0, workers: Number(step?.workers) || 0 })),
    note: String(row.note ?? ""), createdAt: Number(row.createdAt) || 0, createdBy: String(row.createdBy ?? ""),
  }));
  const labour = () => { checkOwner(); return labourState; };
  const needsLabour = () => { checkOwner(); return !inflight.labour && stale(labourState); };
  function applyLabour(data) {
    labourState = {
      ...labourState, status: "ready", error: null, at: Date.now(),
      canSeeRates: Boolean(data?.canSeeRates), canWriteRates: Boolean(data?.canWriteRates), canWriteStandards: Boolean(data?.canWriteStandards),
      rates: rateRows(data?.rates), standards: standardRows(data?.standards),
    };
  }
  function loadLabour({ force = false } = {}) {
    checkOwner();
    if (inflight.labour) return inflight.labour;
    if (!force && labourState.status === "ready" && Date.now() - labourState.at < MAX_AGE_MS) return Promise.resolve(labourState);
    const version = labourState.version;
    labourState = { ...labourState, status: labourState.status === "ready" ? "ready" : "loading" };
    inflight.labour = call("app_rf_labour", {}).then((data) => {
      if (labourState.version === version) applyLabour(data);
    }, (error) => {
      if (labourState.version === version) labourState = { ...labourState, ...noLabour(), status: isForbidden(error) ? "forbidden" : "error", error };
    }).then(() => { inflight.labour = null; return labourState; });
    return inflight.labour;
  }
  // บันทึกแถวใหม่ (ไม่แก้แถวเดิม) · คืน { ok: true } หรือ { ok: false, message }
  async function saveLabour(name, args) {
    checkOwner();
    const version = labourState.version;
    try {
      const data = await call(name, args);
      if (labourState.version === version) applyLabour(data);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorText(error), forbidden: isForbidden(error) };
    }
  }
  const saveRate = ({ departmentCode, ratePerHour, effectiveFrom, note }) => saveLabour("app_rf_labour_rate_save", { p_department_code: departmentCode, p_rate_per_hour: ratePerHour, p_effective_from: effectiveFrom, p_note: note ?? "" });
  const saveStandard = ({ productCode, effectiveFrom, steps, note }) => saveLabour("app_rf_station_standard_save", { p_product_code: productCode, p_effective_from: effectiveFrom, p_steps: steps, p_note: note ?? "" });

  // ออกจากระบบ / เปลี่ยนบัญชี: ทิ้งข้อมูลทั้งหมด
  function reset() { owner = "\u0000"; checkOwner(); }

  root.MNP_COST_DATA = Object.freeze({ prices, needsPrices, loadPrices, savePrice, cost, needsCost, loadCost, labour, needsLabour, loadLabour, saveRate, saveStandard, reset, errorText, isForbidden });
})(window);
