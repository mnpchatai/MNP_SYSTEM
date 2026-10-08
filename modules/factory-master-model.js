// ตรรกะของหน้า Item master ฝ่ายโรงงาน (โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-master-model.test.mjs)
//
// ข้อมูลมาจาก RPC app_factory_master_data (supabase/migrations/20261006050000_factory_item_master.sql)
// ส่วนของ BOM (สร้างฉบับร่าง/ส่งขออนุมัติ/อนุมัติ) ตรงกับ 20261007010000_factory_bom_draft_approval.sql
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
  const DOCUMENT_STATUSES = Object.freeze({ draft: "ฉบับร่าง", pending_approval: "รออนุมัติ", approved: "อนุมัติแล้ว", obsolete: "เลิกใช้" });
  // เหตุการณ์ในประวัติของ BOM (factory_bom_history.action)
  const BOM_HISTORY_ACTIONS = Object.freeze({
    create: "สร้างฉบับร่าง", update: "แก้ไขฉบับร่าง", submit: "ส่งขออนุมัติ", withdraw: "ถอนกลับมาแก้ไข",
    approve: "อนุมัติ", reject: "ไม่อนุมัติ (ส่งกลับ)", obsolete: "เลิกใช้",
  });
  const BOM_MAX_LINES = 100;
  const BOM_MAX_QUANTITY = 1000000000;
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

  // ค้นหาในรหัส Item รหัสอะไหล่ ชื่อไทย ชื่ออังกฤษ และรายละเอียด (ไม่สนตัวพิมพ์) แล้วเรียงแบบภาษาไทย
  function filterItems(items, filters) {
    const query = String(filters.q ?? "").trim().toLowerCase();
    const sortKey = filters.sort === "name" ? "name" : "code";
    return (items ?? [])
      .filter((item) => filters.type === "all" || item.item_type === filters.type)
      .filter((item) => filters.brand === "all" || item.brand === filters.brand)
      .filter((item) => filters.status === "all" || item.status === filters.status)
      .filter((item) => !query || [item.code, item.part_code, item.name, item.name_en, item.specification].join(" ").toLowerCase().includes(query))
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
      // รหัสอะไหล่ (ไม่บังคับ): ส่งค่าว่างเมื่อผู้ใช้ล้างช่อง ฐานข้อมูลถือว่า "ล้างรหัสอะไหล่" (null = ไม่แตะค่าเดิม ใช้เฉพาะผู้เรียกรุ่นเก่า)
      p_part_code: text("part_code"),
    };
  }

  // ช่องที่ผู้ใช้แก้ได้ (ตรงกับ app_factory_save_item) พร้อมป้ายภาษาไทย ใช้สรุปประวัติการแก้ไข
  const EDITABLE_FIELDS = Object.freeze({
    code: "รหัส Item", part_code: "รหัสอะไหล่", name: "ชื่อภาษาไทย", name_en: "ชื่อภาษาอังกฤษ", category_code: "หมวดหมู่", brand: "แบรนด์",
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


  // ---------- โครงสร้างสินค้า (BOM): สร้างฉบับร่าง → ส่งขออนุมัติ → อนุมัติ ----------
  // กติกาตรงกับ app_factory_save_bom_draft / app_factory_submit_bom / app_factory_decide_bom
  // (supabase/migrations/20261007010000_factory_bom_draft_approval.sql) ฐานข้อมูลตรวจซ้ำทุกข้อและเป็นผู้ตัดสิน
  // ที่นี่ตรวจเพื่อให้แก้ฟอร์มได้ก่อนส่ง ยกเว้นสูตรวนซ้ำที่ตรวจที่ฐานข้อมูลอย่างเดียว (ต้องไล่ทุกสูตรในระบบ)

  // สถานะที่ยัง "เปิด" อยู่ (Item หนึ่งมีได้ฉบับเดียว) และสถานะที่แก้เนื้อหาได้
  const OPEN_BOM_STATUSES = Object.freeze(["draft", "pending_approval"]);

  // สินค้าหลักของ BOM ได้: Item ที่ใช้งานอยู่ ประเภท WIP/FG และผลิตเองได้ (ตรงกับ private.factory_assert_bom_parent)
  const canOwnBom = (item) => item?.status === "active" && ["WIP", "FG"].includes(item.item_type) && ["make", "both"].includes(item.procurement);

  // ตัวเลือกสินค้าหลักของฟอร์มสร้างใหม่: available = ยังไม่มีฉบับที่เปิดอยู่ blocked = มีฉบับร่าง/รออนุมัติอยู่แล้ว (แก้ฉบับนั้นแทน)
  function bomParentChoices(items, boms) {
    const open = new Map();
    for (const bom of boms ?? []) if (OPEN_BOM_STATUSES.includes(bom.status)) open.set(bom.item_id, bom);
    const byCode = (a, b) => String(a.code).localeCompare(String(b.code));
    const makeable = (items ?? []).filter(canOwnBom).slice().sort(byCode);
    return {
      available: makeable.filter((item) => !open.has(item.id)),
      blocked: makeable.filter((item) => open.has(item.id)).map((item) => ({ item, bom: open.get(item.id) })),
    };
  }

  // ส่วนประกอบเลือกได้: Item ที่ใช้งานอยู่ทุกประเภท ยกเว้นสินค้าหลักเอง เรียงตามรหัส
  function componentChoices(items, parentId) {
    return (items ?? [])
      .filter((item) => item.status === "active" && item.id !== parentId)
      .slice()
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  const toNumber = (value) => {
    const text = String(value ?? "").trim();
    return text === "" ? null : Number(text);
  };

  // ค่าจากฟอร์ม -> พารามิเตอร์ของ app_factory_save_bom_draft
  // existing = BOM ฉบับร่างที่กำลังแก้ (ใช้ id/version/สินค้าหลักเดิม) บรรทัดที่ว่างทั้งแถวถูกทิ้ง
  function bomPayload(values, existing) {
    const lines = (values.lines ?? [])
      .filter((line) => String(line.component_id ?? "").trim() !== "" || String(line.quantity ?? "").trim() !== "")
      .map((line) => ({
        component_id: String(line.component_id ?? "").trim(),
        quantity: toNumber(line.quantity),
        scrap_percent: toNumber(line.scrap_percent) ?? 0,
      }));
    return {
      p_id: existing?.id ?? null,
      p_version: existing?.version ?? null,
      p_item_id: existing ? existing.item_id : String(values.item_id ?? "").trim() || null,
      p_output_qty: toNumber(values.output_qty),
      p_effective_date: String(values.effective_date ?? "").trim() || null,
      p_note: String(values.note ?? "").trim(),
      p_lines: lines,
    };
  }

  // ข้อความแก้ฟอร์มก่อนส่ง (ภาษาไทย) คืน [] เมื่อผ่าน requireLines = ส่งขออนุมัติต้องมีอย่างน้อย 1 บรรทัด
  function validateBomPayload(payload, items, { requireLines = false } = {}) {
    const problems = [];
    const itemById = new Map((items ?? []).map((item) => [item.id, item]));
    const parent = itemById.get(payload.p_item_id);
    if (!payload.p_item_id) problems.push("กรุณาเลือกสินค้าหลัก");
    else if (!parent || !canOwnBom(parent)) problems.push("สินค้าหลักต้องเป็น Item ที่ใช้งานอยู่ ประเภทงานระหว่างผลิตหรือสินค้าสำเร็จรูป และผลิตเองได้");
    const output = payload.p_output_qty;
    if (output === null || !Number.isFinite(output) || Math.round(output * 10000) / 10000 <= 0 || output > BOM_MAX_QUANTITY) {
      problems.push(`ผลผลิตต่อสูตรต้องมากกว่า 0 และไม่เกิน ${BOM_MAX_QUANTITY.toLocaleString("en-US")}`);
    }
    if (!payload.p_effective_date) problems.push("กรุณาระบุวันที่เริ่มมีผล");
    if (payload.p_note.length > 1000) problems.push("หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร");
    const lines = payload.p_lines ?? [];
    if (lines.length > BOM_MAX_LINES) problems.push(`ส่วนประกอบมีได้ไม่เกิน ${BOM_MAX_LINES} บรรทัด`);
    if (requireLines && lines.length === 0) problems.push("ต้องมีส่วนประกอบอย่างน้อย 1 บรรทัดก่อนส่งขออนุมัติ");
    const seen = new Set();
    lines.forEach((line, index) => {
      const no = index + 1;
      const component = itemById.get(line.component_id);
      if (!line.component_id) problems.push(`บรรทัด ${no}: กรุณาเลือกส่วนประกอบ`);
      else if (!component || component.status !== "active") problems.push(`บรรทัด ${no}: ส่วนประกอบต้องเป็น Item ที่ใช้งานอยู่`);
      else if (line.component_id === payload.p_item_id) problems.push(`บรรทัด ${no}: ส่วนประกอบเป็นสินค้าหลักเองไม่ได้`);
      else if (seen.has(line.component_id)) problems.push(`บรรทัด ${no}: ส่วนประกอบ ${component.code} ซ้ำกับบรรทัดก่อนหน้า`);
      if (line.component_id) seen.add(line.component_id);
      const quantity = line.quantity;
      if (quantity === null || !Number.isFinite(quantity) || Math.round(quantity * 10000) / 10000 <= 0 || quantity > BOM_MAX_QUANTITY) {
        problems.push(`บรรทัด ${no}: ปริมาณต้องมากกว่า 0 และไม่เกิน ${BOM_MAX_QUANTITY.toLocaleString("en-US")}`);
      }
      const scrap = line.scrap_percent;
      if (!Number.isFinite(scrap) || scrap < 0 || Math.round(scrap * 100) / 100 >= 100) problems.push(`บรรทัด ${no}: เผื่อสูญเสียต้องตั้งแต่ 0 ถึงต่ำกว่า 100`);
    });
    return problems;
  }

  // ปุ่มที่ทำได้ตามสถานะ: ร่าง = แก้/ส่งขออนุมัติ · รออนุมัติ = ถอนกลับ/อนุมัติ/ไม่อนุมัติ · อนุมัติแล้ว = สร้าง Revision ใหม่จากฉบับนี้
  // ผู้ที่ตัดสินได้จริงคือผู้ดูแลระบบ ฐานข้อมูลตรวจเอง (หน้าเว็บเข้าถึงโหมดทดสอบได้เฉพาะ admin อยู่แล้ว)
  function bomActions(bom) {
    switch (bom?.status) {
      case "draft": return ["edit", "submit"];
      case "pending_approval": return ["withdraw", "approve", "reject"];
      case "approved": return ["revise"];
      default: return [];
    }
  }

  // รออนุมัติเรียงจากส่งมานานสุดก่อน (ตัดสินตามลำดับที่ส่งมา)
  function pendingBoms(boms) {
    return (boms ?? [])
      .filter((bom) => bom.status === "pending_approval")
      .slice()
      .sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")) || String(a.code).localeCompare(String(b.code)));
  }

  // ฉบับร่างที่แก้ได้ เรียงฉบับที่ถูกส่งกลับ (มีเหตุผลจากผู้อนุมัติ) ขึ้นก่อน แล้วแก้ล่าสุดก่อน
  function draftBoms(boms) {
    return (boms ?? [])
      .filter((bom) => bom.status === "draft")
      .slice()
      .sort((a, b) => Number(Boolean(b.decision_note)) - Number(Boolean(a.decision_note))
        || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) || String(a.code).localeCompare(String(b.code)));
  }

  // นับตามสถานะ (ทุกสถานะมีคีย์เสมอ)
  function countBomsByStatus(boms) {
    const counts = Object.fromEntries(Object.keys(DOCUMENT_STATUSES).map((status) => [status, 0]));
    for (const bom of boms ?? []) if (bom.status in counts) counts[bom.status] += 1;
    return counts;
  }

  // ประวัติของ BOM ใบเดียว เก่าสุดก่อน (อ่านเป็นลำดับเวลา) — ข้อมูลเข้ามาใหม่สุดก่อน
  function bomTimeline(history, bomId) {
    return (history ?? []).filter((entry) => entry.bom_id === bomId).slice().reverse();
  }

  // ---------- ต้นไม้โครงสร้างสินค้า (แตกสูตรทุกชั้น อ่านอย่างเดียว) ----------
  // เริ่มจาก BOM ฉบับที่เลือก แล้วแตกส่วนประกอบที่มีสูตรของตัวเองลงไปทุกชั้น (ใช้ฉบับที่อนุมัติแล้วก่อน ถ้าไม่มีใช้ฉบับรออนุมัติ/ร่างและติดป้ายบอก
  // ฉบับที่เลิกใช้ไม่นับ) ส่วนประกอบที่ไม่มีสูตร (เช่น วัตถุดิบ) เป็นปลายกิ่ง ทุกชิ้นงานที่มี Routing แสดงขั้นตอนของ Routing ที่ใช้อยู่ (ไม่เลิกใช้ Revision สูงสุด)
  // per = ปริมาณที่ต้องใช้ต่อสินค้าหลัก 1 หน่วยของ BOM ที่เลือก (รวมเผื่อสูญเสียแบบบวกเพิ่มทุกชั้น เหมือนที่ใบงาน/ผลสำรวจคงคลังคำนวณ) หน้าจอคูณด้วยจำนวนที่ต้องการผลิต
  // กันสูตรวน (ฐานข้อมูลกันอยู่แล้ว) และชั้นลึกเกิน TREE_MAX_DEPTH ไม่ให้แตกต่อ
  const TREE_MAX_DEPTH = 12;
  const TREE_BOM_RANK = Object.freeze({ approved: 0, pending_approval: 1, draft: 2 });
  const round8 = (value) => Math.round(value * 1e8) / 1e8;

  function bomTree(data, bomId) {
    const root = (data.boms ?? []).find((row) => row.id === bomId);
    if (!root) return null;
    const items = new Map((data.items ?? []).map((item) => [item.id, item]));
    const linesByBom = new Map();
    for (const line of data.bom_lines ?? []) {
      if (!linesByBom.has(line.bom_id)) linesByBom.set(line.bom_id, []);
      linesByBom.get(line.bom_id).push(line);
    }
    for (const lines of linesByBom.values()) lines.sort((a, b) => a.line_no - b.line_no);
    const stepsByRouting = new Map();
    for (const step of data.steps ?? []) {
      if (!stepsByRouting.has(step.routing_id)) stepsByRouting.set(step.routing_id, []);
      stepsByRouting.get(step.routing_id).push(step);
    }
    const pickBom = (itemId) => (data.boms ?? [])
      .filter((bom) => bom.item_id === itemId && bom.id !== root.id && bom.status in TREE_BOM_RANK)
      .sort((a, b) => TREE_BOM_RANK[a.status] - TREE_BOM_RANK[b.status] || String(b.revision).localeCompare(String(a.revision)))[0] ?? null;
    const stepsOf = (itemId) => {
      const routing = (data.routings ?? []).filter((row) => row.item_id === itemId && row.status !== "obsolete")
        .sort((a, b) => String(b.revision).localeCompare(String(a.revision)))[0];
      return routing ? (stepsByRouting.get(routing.id) ?? []).slice().sort((a, b) => a.sequence - b.sequence)
        .map((step) => ({ sequence: step.sequence, name: step.name, work_center: step.work_center ?? "", setup_minutes: Number(step.setup_minutes ?? 0), run_minutes: Number(step.run_minutes ?? 0) })) : [];
    };
    const stats = { nodes: 0, depth: 0, unapproved: false };

    function build(info, bom, per, scrap, path, level) {
      stats.nodes += 1;
      stats.depth = Math.max(stats.depth, level);
      const node = {
        item_id: info.item_id, code: info.code, name: info.name, item_type: info.item_type ?? null, unit_code: info.unit_code ?? "",
        per, scrap_percent: scrap,
        bom: bom ? { id: bom.id, revision: bom.revision, status: bom.status, output_qty: Number(bom.output_qty) } : null,
        steps: bom ? stepsOf(info.item_id) : [], children: [], cycle: false, too_deep: false,
      };
      if (bom && bom.status !== "approved") stats.unapproved = true;
      if (!bom) return node;
      for (const line of linesByBom.get(bom.id) ?? []) {
        const component = items.get(line.component_id);
        const childInfo = { item_id: line.component_id, code: line.code ?? component?.code ?? "?", name: line.name ?? component?.name ?? "", item_type: component?.item_type, unit_code: line.unit_code ?? component?.unit_code };
        const childPer = round8(per * Number(line.quantity) / Number(bom.output_qty) * (1 + Number(line.scrap_percent) / 100));
        const childBom = pickBom(line.component_id);
        if (path.has(line.component_id)) {
          const loop = build(childInfo, null, childPer, Number(line.scrap_percent), path, level + 1);
          loop.cycle = true;
          node.children.push(loop);
        } else if (childBom && level + 1 >= TREE_MAX_DEPTH) {
          const deep = build(childInfo, null, childPer, Number(line.scrap_percent), path, level + 1);
          deep.too_deep = true;
          node.children.push(deep);
        } else {
          node.children.push(build(childInfo, childBom, childPer, Number(line.scrap_percent), new Set([...path, line.component_id]), level + 1));
        }
      }
      return node;
    }

    const parent = items.get(root.item_id);
    const tree = build({ item_id: root.item_id, code: root.code ?? parent?.code ?? "?", name: root.name ?? parent?.name ?? "", item_type: parent?.item_type, unit_code: root.unit_code ?? parent?.unit_code }, root, 1, null, new Set([root.item_id]), 0);
    return { root: tree, nodes: stats.nodes, depth: stats.depth, unapproved: stats.unapproved };
  }

  const api = {
    EDITABLE_FIELDS, changedFields, bomTree, TREE_MAX_DEPTH,
    ITEM_TYPES, PROCUREMENT, BRANDS, STATUSES, SORTS, PRODUCTION_STATUSES, DOCUMENT_STATUSES, PAGE_SIZE, ITEM_CODE_PATTERN,
    listParams, filterItems, paginate, countByType, lowStockItems, bomRequirement, itemPayload,
    BOM_HISTORY_ACTIONS, BOM_MAX_LINES, BOM_MAX_QUANTITY, OPEN_BOM_STATUSES,
    canOwnBom, bomParentChoices, componentChoices, bomPayload, validateBomPayload, bomActions, pendingBoms, draftBoms,
    countBomsByStatus, bomTimeline,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_MASTER_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
