// Item master ของฝ่ายโรงงาน (โหมดทดสอบ) — ข้อมูลล้วน ไม่มี DOM/Supabase
//
// *** รายการด้านล่างเป็นตัวอย่างสำหรับทดสอบหน้าจอเท่านั้น ไม่ใช่ข้อมูลจริงของบริษัท ***
// ระบบยังไม่มีตารางหรือแหล่งข้อมูลหลักของ Item master (README กำหนดว่า master data ต้องมีเจ้าของและ
// แหล่งข้อมูลหลักก่อนทำเป็นของจริง) เมื่อได้รายการจริงให้เปลี่ยนที่มาของข้อมูลที่นี่ที่เดียว
// โดยคง api เดิม (ITEMS, CATEGORIES, find, grouped) หน้าจอจะไม่ต้องแก้
// รหัสตัวอย่างขึ้นต้น TEST- เพื่อไม่ให้ปนกับรหัสสินค้าจริงใน NCR (ncr_reports.product_code)
//
// เทสต์ที่ scripts/tests/factory-items.test.mjs
(function (root) {
  const CATEGORIES = Object.freeze([
    { key: "raw", name: "วัตถุดิบ" },
    { key: "semi", name: "กึ่งสำเร็จรูป" },
    { key: "finished", name: "สินค้าสำเร็จรูป" },
    { key: "packaging", name: "บรรจุภัณฑ์" },
  ].map((category) => Object.freeze(category)));

  const ITEMS = Object.freeze([
    { code: "TEST-RM-001", name: "ยางคอมพาวด์ (ตัวอย่าง)", unit: "กก.", category: "raw" },
    { code: "TEST-RM-002", name: "เม็ดพลาสติก (ตัวอย่าง)", unit: "กก.", category: "raw" },
    { code: "TEST-RM-003", name: "ผ้าสำหรับเย็บ (ตัวอย่าง)", unit: "เมตร", category: "raw" },
    { code: "TEST-SF-001", name: "ชิ้นงานยางขึ้นรูป (ตัวอย่าง)", unit: "ชิ้น", category: "semi" },
    { code: "TEST-SF-002", name: "ชิ้นงานพลาสติกขึ้นรูป (ตัวอย่าง)", unit: "ชิ้น", category: "semi" },
    { code: "TEST-FG-001", name: "สินค้าสำเร็จรูป A (ตัวอย่าง)", unit: "ชุด", category: "finished" },
    { code: "TEST-FG-002", name: "สินค้าสำเร็จรูป B (ตัวอย่าง)", unit: "ชุด", category: "finished" },
    { code: "TEST-PK-001", name: "กล่องบรรจุ (ตัวอย่าง)", unit: "ใบ", category: "packaging" },
  ].map((item) => Object.freeze(item)));

  const categoryName = (key) => CATEGORIES.find((category) => category.key === key)?.name ?? "—";

  // หารายการจากรหัส (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) — ไม่พบคืน null ไม่เดาให้
  // รายการที่คืนมีชื่อประเภท (categoryName) ติดมาด้วยเพื่อให้หน้าจอไม่ต้องแปลงเอง
  function find(code) {
    const key = String(code ?? "").trim().toUpperCase();
    const item = ITEMS.find((candidate) => candidate.code === key);
    return item ? Object.freeze({ ...item, categoryName: categoryName(item.category) }) : null;
  }

  // จัดกลุ่มตามประเภทสำหรับ <optgroup> — เรียงตาม CATEGORIES และข้ามประเภทที่ไม่มีรายการ
  function grouped() {
    return CATEGORIES
      .map((category) => ({ category, items: ITEMS.filter((item) => item.category === category.key) }))
      .filter((group) => group.items.length > 0);
  }

  const api = { ITEMS, CATEGORIES, find, grouped };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_ITEMS = api;
})(typeof window !== "undefined" ? window : globalThis);
