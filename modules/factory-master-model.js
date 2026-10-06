// ตรรกะของหน้า Item master ฝ่ายโรงงาน (โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-master-model.test.mjs)
//
// ข้อมูลมาจาก RPC app_factory_master_data (supabase/migrations/20261006050000_factory_item_master.sql)
// ป้ายกำกับและกติกาที่นี่ต้องตรงกับ check constraint ของตาราง factory_items:
// item_type RM/WIP/FG/PKG, brand MNP/SAFSOF, procurement buy/make/both, status active/inactive
// การกรอง/เรียง/แบ่งหน้าทำฝั่งหน้าเว็บกับข้อมูลชุดเดียว (ตัวอย่างหลักสิบรายการ) ถ้าข้อมูลจริงหลักหมื่นขึ้นไป
// ต้องย้ายไปค้นหาและแบ่งหน้าที่ฐานข้อมูล
(function (root) {
  const ITEM_TYPES = Object.freeze({ RM: "วัตถุดิบ", WIP: "งานระหว่างผลิต", FG: "สินค้าสำเร็จรูป", PKG: "บรรจุภัณฑ์" });
  const PROCUREMENT = Object.freeze({ buy: "จัดซื้อ", make: "ผลิตเอง", both: "ซื้อ / ผลิต" });
  const BRANDS = Object.freeze(["MNP", "SAFSOF"]);
  const STATUSES = Object.freeze({ active: "ใช้งาน", inactive: "หยุดใช้งาน" });
  const SORTS = Object.freeze({ code: "เรียงตามรหัส", name: "เรียงตามชื่อ" });
  const PRODUCTION_STATUSES = Object.freeze({ planned: "วางแผน", released: "ปล่อยงาน", in_progress: "กำลังผลิต", completed: "เสร็จแล้ว", cancelled: "ยกเลิก" });
  const DOCUMENT_STATUSES = Object.freeze({ draft: "ฉบับร่าง", approved: "อนุมัติแล้ว", obsolete: "เลิกใช้" });
  const PAGE_SIZE = 10;
  const ITEM_CODE_PATTERN = "[A-Za-z0-9_\\-]{2,40}";

  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

  // ตัวกรองจาก URL — ค่าที่ไม่รู้จักกลับเป็นค่าเริ่มต้น ไม่ส่งต่อค่าที่ไม่ได้ตรวจ
  function listParams(params) {
    const get = (key) => (params && typeof params.get === "function" ? params.get(key) : null);
    const page = Number.parseInt(get("page") ?? "", 10);
    return {
      q: String(get("q") ?? "").trim().slice(0, 100),
      type: pick(get("type"), ["all", ...Object.keys(ITEM_TYPES)], "all"),
      brand: pick(get("brand"), ["all", ...BRANDS], "all"),
      status: pick(get("status"), ["all", ...Object.keys(STATUSES)], "all"),
      sort: pick(get("sort"), Object.keys(SORTS), "code"),
      page: Number.isFinite(page) && page > 0 ? page : 1,
    };
  }

  // ค้นหาในรหัส ชื่อไทย ชื่ออังกฤษ และรายละเอียด (ไม่สนตัวพิมพ์) แล้วเรียงแบบภาษาไทย
  function filterItems(items, filters) {
    const query = String(filters.q ?? "").trim().toLowerCase();
    const sortKey = filters.sort === "name" ? "name" : "code";
    return (items ?? [])
      .filter((item) => filters.type === "all" || item.item_type === filters.type)
      .filter((item) => filters.brand === "all" || item.brand === filters.brand)
      .filter((item) => filters.status === "all" || item.status === filters.status)
      .filter((item) => !query || [item.code, item.name, item.name_en, item.specification].join(" ").toLowerCase().includes(query))
      .slice()
      .sort((a, b) => String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), "th") || String(a.code).localeCompare(String(b.code)));
  }

  // หน้าที่ขอเกินจำนวนหน้ากลับเป็นหน้าสุดท้าย from/to นับจาก 1 (0 เมื่อไม่มีรายการ)
  function paginate(rows, page, size = PAGE_SIZE) {
    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(1, page | 0), pageCount);
    const start = (current - 1) * size;
    return { rows: rows.slice(start, start + size), page: current, pageCount, total, from: total ? start + 1 : 0, to: Math.min(start + size, total) };
  }

  function countByType(items) {
    const counts = { all: (items ?? []).length };
    for (const type of Object.keys(ITEM_TYPES)) counts[type] = (items ?? []).filter((item) => item.item_type === type).length;
    return counts;
  }

  // ต่ำกว่าขั้นต่ำ: เฉพาะ Item ที่ใช้งาน เทียบยอดรวมทุกคลังกับขั้นต่ำ (ขั้นต่ำ 0 ไม่นับว่าต่ำ)
  function lowStockItems(items) {
    return (items ?? []).filter((item) => item.status === "active" && Number(item.stock) < Number(item.min_stock));
  }

  // ปริมาณที่ต้องใช้ = ปริมาณต่อสูตร × (จำนวนผลิต ÷ ผลผลิตต่อสูตร) × (1 + %เผื่อสูญเสีย) — เผื่อแบบบวกเพิ่ม
  // คืน null เมื่อจำนวนผลิตหรือผลผลิตต่อสูตรไม่ใช่จำนวนบวก (ไม่แสดงตัวเลขที่ไม่มีความหมาย)
  function bomRequirement(lineQty, scrapPercent, produceQty, outputQty) {
    const quantity = Number(lineQty);
    const scrap = Number(scrapPercent);
    const produce = Number(produceQty);
    const output = Number(outputQty);
    if (![quantity, scrap, produce, output].every(Number.isFinite) || produce <= 0 || output <= 0 || quantity < 0 || scrap < 0) return null;
    return (quantity * produce / output) * (1 + scrap / 100);
  }

  // ค่าจากฟอร์ม -> พารามิเตอร์ของ app_factory_save_item (ฐานข้อมูลตรวจซ้ำทุกช่องอีกชั้น)
  function itemPayload(values, existing) {
    const text = (key) => String(values[key] ?? "").trim();
    const minStock = text("min_stock");
    return {
      p_id: existing?.id ?? null,
      p_version: existing?.version ?? null,
      p_code: text("code").toUpperCase(),
      p_name: text("name"),
      p_name_en: text("name_en"),
      // ช่องที่ล็อกหลังสร้างส่งค่าเดิมเสมอ (ฟอร์มปิดช่องไว้ ค่า disabled ไม่ถูกส่งมากับฟอร์ม)
      p_item_type: existing ? existing.item_type : text("item_type"),
      p_category_code: text("category_code"),
      p_brand: text("brand"),
      p_unit_code: existing ? existing.unit_code : text("unit_code"),
      p_procurement: text("procurement"),
      p_status: text("status") || "active",
      p_lot_tracking: existing ? Boolean(existing.lot_tracking) : values.lot_tracking === true || values.lot_tracking === "on",
      p_min_stock: minStock === "" ? null : Number(minStock),
      p_specification: text("specification"),
    };
  }

  // ช่องที่ผู้ใช้แก้ได้ (ตรงกับ app_factory_save_item) พร้อมป้ายภาษาไทย ใช้สรุปประวัติการแก้ไข
  const EDITABLE_FIELDS = Object.freeze({
    code: "รหัส", name: "ชื่อภาษาไทย", name_en: "ชื่อภาษาอังกฤษ", category_code: "หมวดหมู่", brand: "แบรนด์",
    procurement: "วิธีจัดหา", status: "สถานะ", min_stock: "สต็อกขั้นต่ำ", specification: "ข้อกำหนด",
  });

  // ช่องที่เปลี่ยนระหว่าง snapshot ก่อน/หลัง (ตัวเลขเทียบเป็นค่า ไม่สนรูปแบบ "10" กับ 10.000)
  function changedFields(before, after) {
    if (!before || !after) return [];
    return Object.keys(EDITABLE_FIELDS).filter((key) => {
      const a = before[key];
      const b = after[key];
      if (key === "min_stock") return Number(a) !== Number(b);
      return String(a ?? "") !== String(b ?? "");
    });
  }

  const api = {
    EDITABLE_FIELDS, changedFields,
    ITEM_TYPES, PROCUREMENT, BRANDS, STATUSES, SORTS, PRODUCTION_STATUSES, DOCUMENT_STATUSES, PAGE_SIZE, ITEM_CODE_PATTERN,
    listParams, filterItems, paginate, countByType, lowStockItems, bomRequirement, itemPayload,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_MASTER_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
