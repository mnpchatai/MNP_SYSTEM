// โมเดลข้อมูลยางเส้นของโมดูล MNP LAB (ออเดอร์ที่ใช้ ขนาดวงนอก/รูใน และสเปก ต่อ ID ของผลทดสอบ Mooney) — ข้อมูลล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-strand-model.test.mjs
//
// ข้อมูลมาจาก RPC app_lab_strand_specs และเขียนผ่าน app_lab_strand_spec_save / app_lab_strand_spec_delete (ฐานข้อมูลเป็นผู้ตรวจจริง)
// ที่นี่ตรวจซ้ำก่อนส่งเพื่อให้ผู้ใช้เห็นข้อความทันที รหัสข้อผิดพลาดใช้ชุดเดียวกับฐานข้อมูล จึงใช้ตารางข้อความชุดเดียวกัน (ERROR_MESSAGES)
// หน่วยของขนาดทุกช่องคือมิลลิเมตร ทศนิยมไม่เกิน 2 ตำแหน่ง (ตรงกับคอลัมน์ numeric(7,2))
(function (root) {
  const MAX_ORDER_LENGTH = 60;
  const MAX_SIZE = 99999.99;
  const EMPTY = "—";

  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const number = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const text = (value) => String(value ?? "");

  // ข้อความของรหัสข้อผิดพลาดที่ RPC ยกขึ้น (ส่งให้ errorMessages ของโมดูลใน module-lab.js)
  const ERROR_MESSAGES = Object.freeze({
    LAB_INVALID_SAMPLE: "กรุณาเลือก ID ที่มีในผลทดสอบของวัสดุนี้",
    LAB_SAMPLE_NOT_FOUND: "ไม่พบ ID นี้ในผลทดสอบของวัสดุนี้ กรุณารีเฟรชแล้วเลือกใหม่",
    LAB_INVALID_ORDER: `เลขที่ออเดอร์ต้องไม่เกิน ${MAX_ORDER_LENGTH} ตัวอักษร`,
    LAB_INVALID_SIZE: "ขนาดต้องเป็นตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง (หน่วย มม.)",
    LAB_INVALID_SPEC_RANGE: "สเปกต่ำสุดต้องไม่มากกว่าสเปกสูงสุด",
    LAB_SPEC_EMPTY: "กรุณากรอกข้อมูลอย่างน้อยหนึ่งช่อง",
    LAB_SPEC_CONFLICT: "ข้อมูลของ ID นี้ถูกเพิ่ม แก้ไข หรือลบโดยผู้อื่นไปแล้ว กรุณาตรวจค่าล่าสุดในตารางแล้วทำรายการอีกครั้ง",
  });

  // แถวจาก RPC → รูปแบบที่หน้าเว็บใช้ (ตัวเลขเป็น number|null) แถวที่ไม่มี ID ถูกทิ้ง
  // ID ใช้ตามที่ฐานข้อมูลส่งมาทุกตัวอักษร (ไม่ trim ซ้ำ) เพื่อให้ตรงกับ ID ของผลทดสอบที่ใช้เทียบและส่งกลับเสมอ
  function normalizeSpec(row) {
    const sampleId = text(row?.sample_id);
    if (!sampleId.trim()) return null;
    const version = Number(row?.version);
    return {
      sampleId,
      orderNo: row?.order_no === null || row?.order_no === undefined ? null : text(row.order_no),
      outer: number(row?.outer_mm),
      inner: number(row?.inner_mm),
      outerMin: number(row?.outer_min_mm),
      outerMax: number(row?.outer_max_mm),
      innerMin: number(row?.inner_min_mm),
      innerMax: number(row?.inner_max_mm),
      version: Number.isInteger(version) && version >= 1 ? version : 1,
      updatedAt: row?.updated_at ?? null,
    };
  }

  const byId = (a, b) => a.sampleId.localeCompare(b.sampleId, "en", { numeric: true });

  // รายการจาก RPC (อาร์เรย์) เรียงตาม ID แบบเลขก่อน ไม่ใช่อาร์เรย์ = null (ผู้เรียกถือว่าอ่านไม่ได้)
  function normalizeList(data) {
    if (!Array.isArray(data)) return null;
    return data.map(normalizeSpec).filter(Boolean).sort(byId);
  }

  // เพิ่มหรือแทนที่ข้อมูลของ ID หนึ่ง คืนรายการใหม่ (ไม่แก้ของเดิม)
  const upsert = (list, record) => [...list.filter((item) => item.sampleId !== record.sampleId), record].sort(byId);
  const remove = (list, sampleId) => list.filter((item) => item.sampleId !== sampleId);
  const find = (list, sampleId) => list.find((item) => item.sampleId === sampleId) ?? null;

  // ลายนิ้วมือของรายการ ใช้ข้ามการวาดตารางใหม่เมื่อรีเฟรชแล้วข้อมูลไม่เปลี่ยน (version เพิ่มทุกครั้งที่แก้ และ updatedAt กัน ID ที่ถูกลบแล้วเพิ่มใหม่จน version กลับมาเท่าเดิม)
  const signature = (list) => list.map((item) => `${item.sampleId}:${item.version}:${item.updatedAt ?? ""}`).join("|");

  // ID ที่ยังไม่มีข้อมูล (ตัวเลือกของการเพิ่มใหม่) ids = [{ id, count }] จาก lab-mooney-model.idsFor
  const idsWithoutData = (ids, list) => ids.filter((entry) => !find(list, entry.id));

  // ผลเทียบค่าที่วัดได้กับช่วงสเปก: "ok" | "low" | "high" | null (ไม่มีค่าที่วัด หรือไม่มีขอบเขตสเปกเลย → ไม่ตัดสิน)
  // เทียบที่ทศนิยม 2 ตำแหน่งเหมือนที่เก็บ กันเศษทศนิยมของ floating point ทำให้ค่าที่ติดขอบถูกตัดสินผิด
  const hundredths = (value) => Math.round(value * 100);
  function specStatus(actual, min, max) {
    if (!isNumber(actual) || (!isNumber(min) && !isNumber(max))) return null;
    if (isNumber(min) && hundredths(actual) < hundredths(min)) return "low";
    if (isNumber(max) && hundredths(actual) > hundredths(max)) return "high";
    return "ok";
  }

  const STATUS_LABELS = Object.freeze({ ok: "ในสเปก", low: "ต่ำกว่าสเปก", high: "เกินสเปก" });

  // ขนาดแสดง 2 ตำแหน่งเสมอ (เหมือนค่าที่เครื่องวัดอ่าน) ไม่มีค่า = —
  const formatSize = (value) => (isNumber(value) ? value.toFixed(2) : EMPTY);

  // ช่วงสเปก: "19.50 – 20.50" ด้านเดียวเป็น "≥ 19.50" / "≤ 20.50" ไม่มีเลย = —
  function formatLimits(min, max) {
    if (isNumber(min) && isNumber(max)) return `${formatSize(min)} – ${formatSize(max)}`;
    if (isNumber(min)) return `≥ ${formatSize(min)}`;
    if (isNumber(max)) return `≤ ${formatSize(max)}`;
    return EMPTY;
  }

  // ข้อความจากช่องกรอก → { value } (ว่าง = null) หรือ { error: true } ถ้าไม่ใช่ขนาดที่ใช้ได้
  // รับจุดหรือจุลภาคเป็นทศนิยม (แป้นพิมพ์ไทย/ยุโรป) ไม่ปัดค่าให้เงียบๆ: ทศนิยมเกิน 2 ตำแหน่งถือว่าผิด
  function parseSize(input) {
    const raw = text(input).trim().replace(",", ".");
    if (!raw) return { value: null };
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: true };
    const value = Number(raw);
    return value > 0 && value <= MAX_SIZE ? { value } : { error: true };
  }

  // ค่าจากฟอร์ม (ข้อความ) → พารามิเตอร์ของ app_lab_strand_spec_save หรือ { error: <รหัสข้อผิดพลาด> }
  // expectedVersion: null = เพิ่มใหม่ ตัวเลข = แก้ไขข้อมูลที่เห็น version นั้น
  function buildSaveParams({ material, sampleId, orderNo, outer, inner, outerMin, outerMax, innerMin, innerMax, expectedVersion = null }) {
    // ID มาจากตัวเลือกที่สร้างจากผลทดสอบ ส่งไปตามที่เป็น (ไม่ trim: JS กับ btrim ของ PostgreSQL ตัดช่องว่างไม่เหมือนกัน) ว่างเปล่าเท่านั้นที่ปฏิเสธ
    const id = text(sampleId);
    if (!id.trim()) return { error: "LAB_INVALID_SAMPLE" };
    const order = text(orderNo).trim();
    if (order.length > MAX_ORDER_LENGTH) return { error: "LAB_INVALID_ORDER" };
    const sizes = [outer, inner, outerMin, outerMax, innerMin, innerMax].map(parseSize);
    if (sizes.some((size) => size.error)) return { error: "LAB_INVALID_SIZE" };
    const [vOuter, vInner, vOuterMin, vOuterMax, vInnerMin, vInnerMax] = sizes.map((size) => size.value);
    if ((vOuterMin !== null && vOuterMax !== null && vOuterMin > vOuterMax) || (vInnerMin !== null && vInnerMax !== null && vInnerMin > vInnerMax)) {
      return { error: "LAB_INVALID_SPEC_RANGE" };
    }
    if (!order && [vOuter, vInner, vOuterMin, vOuterMax, vInnerMin, vInnerMax].every((value) => value === null)) return { error: "LAB_SPEC_EMPTY" };
    return {
      params: {
        p_material: material,
        p_sample_id: id,
        p_order_no: order || null,
        p_outer_mm: vOuter,
        p_inner_mm: vInner,
        p_outer_min_mm: vOuterMin,
        p_outer_max_mm: vOuterMax,
        p_inner_min_mm: vInnerMin,
        p_inner_max_mm: vInnerMax,
        p_expected_version: expectedVersion,
      },
    };
  }

  // RPC ตอบว่าไม่มีฟังก์ชัน = ฐานข้อมูลยังไม่ได้ apply migration ของส่วนนี้ (PostgREST: PGRST202) หน้าเว็บซ่อนส่วนนี้แทนการขึ้นข้อผิดพลาด
  const isMissingFunction = (error) => error?.code === "PGRST202" || /Could not find the function/i.test(String(error?.message ?? ""));

  const api = {
    MAX_ORDER_LENGTH, MAX_SIZE, ERROR_MESSAGES, STATUS_LABELS,
    normalizeSpec, normalizeList, upsert, remove, find, signature, idsWithoutData,
    specStatus, formatSize, formatLimits, parseSize, buildSaveParams, isMissingFunction,
  };
  root.MNP_LAB_STRAND = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
