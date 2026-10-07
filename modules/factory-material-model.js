// ตรรกะของใบสั่งวัตถุดิบ แผนก ST (ขั้น 3.1 ของ workflow การผลิต โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-material-model.test.mjs)
//
// ขั้นตอน: ST ออกใบ (draft) → สั่ง (ordered) → ยืนยันรับของ (received: เพิ่มยอดคงคลังจริง) · ยกเลิกได้ขณะ draft/ordered
// ใบสั่งผลิตต้องออกใบสั่งงานแล้ว (released/in_progress) กติกาตรงกับ RPC ใน
// supabase/migrations/20261007040000_factory_material_order_workflow.sql ฐานข้อมูลตรวจสิทธิ์/สถานะ/ค่าทุกช่องเอง
// ที่นี่ใช้เลือกปุ่ม คำนวณรายการที่ควรสั่ง และตรวจฟอร์มเพื่อความสะดวกเท่านั้น (ซ่อนปุ่มไม่ใช่การควบคุมสิทธิ์)
(function (root) {
  // ใช้ตารางสำรวจคงคลังของ modules/factory-production-model.js (โหลดก่อนไฟล์นี้ใน index.html) หาตอนเรียกใช้ ไม่ใช่ตอนโหลดไฟล์
  // เทสต์ใน Node ต้องตั้ง globalThis.MNP_FACTORY_PRODUCTION_MODEL ก่อนเรียก materialNeeds
  const production = () => root.MNP_FACTORY_PRODUCTION_MODEL;

  const STORES_DEPARTMENT = "ST";
  const MAX_QUANTITY = 1000000000;
  const MAX_LINES = 100;
  const EXTRA_ROWS = 3;

  const MATERIAL_STATUSES = Object.freeze({
    draft: "ฉบับร่าง",
    ordered: "สั่งแล้ว รอรับของ",
    received: "รับของเข้าคลังแล้ว",
    cancelled: "ยกเลิก",
  });
  // class ของ .badge ใน styles.css ที่ใกล้เคียงที่สุด (เตือน = รอของ, เขียว = รับแล้ว, แดง = ยกเลิก)
  const BADGE_CLASS = Object.freeze({ draft: "", ordered: "pending_approval", received: "completed", cancelled: "cancelled" });
  const HISTORY_ACTIONS = Object.freeze({
    create: "สร้างฉบับร่าง", update: "แก้ไขฉบับร่าง", place: "สั่งวัตถุดิบ", receive: "รับของเข้าคลัง", cancel: "ยกเลิก",
  });
  const OPEN_STATUSES = Object.freeze(["draft", "ordered"]);

  // ปุ่มที่ทำได้ตามสถานะและแผนก: ST เท่านั้น draft = แก้/สั่ง/ยกเลิก · ordered = รับของ/ยกเลิก
  function materialActions(order, dept) {
    if (dept !== STORES_DEPARTMENT) return [];
    if (order?.status === "draft") return ["edit", "place", "cancel"];
    if (order?.status === "ordered") return ["receive", "cancel"];
    return [];
  }

  const countByStatus = (orders) => {
    const counts = Object.fromEntries(Object.keys(MATERIAL_STATUSES).map((status) => [status, 0]));
    for (const order of orders ?? []) if (order.status in counts) counts[order.status] += 1;
    return counts;
  };

  // ใบสั่งผลิตที่สั่งวัตถุดิบได้: ออกใบสั่งงานแล้ว (ใหม่สุดก่อน)
  const orderableWorkOrders = (orders) => (orders ?? [])
    .filter((order) => ["released", "in_progress"].includes(order.status))
    .slice()
    .sort((a, b) => String(b.code).localeCompare(String(a.code)));

  // Item ที่สั่งซื้อได้: ใช้งานอยู่ จัดซื้อได้ (buy/both)
  const purchasable = (item) => item?.status === "active" && ["buy", "both"].includes(item.procurement);
  const purchasableItems = (items) => (items ?? []).filter(purchasable).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const ordersOf = (materialOrders, productionOrderId) => (materialOrders ?? []).filter((order) => order.production_order_id === productionOrderId);

  // ปริมาณที่สั่งไปแล้วและยังไม่รับ (draft/ordered) ต่อ Item ของใบสั่งผลิตใบเดียว — ใบที่รับแล้วนับในคงคลังแล้ว ใบที่ยกเลิกไม่นับ
  function onOrderByItem(materialOrders, productionOrderId, exceptOrderId = null) {
    const totals = new Map();
    for (const order of ordersOf(materialOrders, productionOrderId)) {
      if (!OPEN_STATUSES.includes(order.status) || order.id === exceptOrderId) continue;
      for (const line of order.lines ?? []) totals.set(line.item_id, (totals.get(line.item_id) ?? 0) + Number(line.quantity));
    }
    return totals;
  }

  const round4 = (value) => Math.round(value * 10000) / 10000;

  // รายการที่ขาดตามผลสำรวจคงคลังของใบสั่งผลิต (สูตรที่อนุมัติทุกชั้น หักคงเหลือ) พร้อมปริมาณที่ยังสั่งไปไม่ครบ
  //   suggest = ขาด − ที่สั่งไปแล้วยังไม่รับ (ไม่ติดลบ) · purchasable = false หมายถึงต้องผลิตเอง (ทำ BOM) สั่งซื้อไม่ได้
  // exceptOrderId = ใบสั่งวัตถุดิบที่กำลังแก้ (ไม่นับปริมาณของใบนั้นซ้ำ) คืน null ถ้าคำนวณไม่ได้ (ไม่มี BOM ที่อนุมัติ)
  function materialNeeds(data, productionOrder, exceptOrderId = null) {
    const survey = production().surveyRequirements(data, productionOrder.item_id, productionOrder.planned_qty);
    if (!survey) return null;
    const items = new Map((data.items ?? []).map((item) => [item.id, item]));
    const onOrder = onOrderByItem(data.material_orders, productionOrder.id, exceptOrderId);
    return survey.shortages.map((row) => {
      const ordered = round4(onOrder.get(row.item_id) ?? 0);
      const canBuy = purchasable(items.get(row.item_id));
      return {
        item_id: row.item_id, code: row.code, name: row.name, unit_code: row.unit_code, item_type: row.item_type,
        net: row.net, onOrder: ordered, suggest: canBuy ? Math.max(0, round4(row.net - ordered)) : 0, purchasable: canBuy,
      };
    });
  }

  const toNumber = (value) => {
    const text = String(value ?? "").trim();
    return text === "" ? null : Number(text);
  };

  // ค่าจากฟอร์ม -> พารามิเตอร์ของ app_factory_save_material_order
  //   ช่องปริมาณของรายการที่เสนอ/เดิมชื่อ "qty:<item_id>" · ช่องเพิ่มเอง "extra_item_<n>" + "extra_qty_<n>" (n = 1..EXTRA_ROWS)
  //   บรรทัดที่เว้นปริมาณว่างหรือ 0 ถูกข้าม (= ไม่สั่งรายการนั้น) existing = ฉบับร่างที่กำลังแก้
  function materialPayload(values, existing) {
    const lines = [];
    for (const [key, raw] of Object.entries(values ?? {})) {
      if (!key.startsWith("qty:")) continue;
      const quantity = toNumber(raw);
      if (quantity === null || quantity === 0) continue;
      lines.push({ item_id: key.slice(4), quantity });
    }
    for (let n = 1; n <= EXTRA_ROWS; n += 1) {
      const itemId = String(values?.[`extra_item_${n}`] ?? "").trim();
      const quantity = toNumber(values?.[`extra_qty_${n}`]);
      if (!itemId && (quantity === null || quantity === 0)) continue;
      lines.push({ item_id: itemId, quantity });
    }
    return {
      p_id: existing?.id ?? null,
      p_version: existing?.version ?? null,
      p_production_order_id: existing ? existing.production_order_id : String(values?.production_order_id ?? "").trim() || null,
      p_supplier: String(values?.supplier ?? "").trim(),
      p_expected_date: String(values?.expected_date ?? "").trim() || null,
      p_note: String(values?.note ?? "").trim(),
      p_lines: lines,
    };
  }

  // ข้อความแก้ฟอร์มก่อนส่ง (ภาษาไทย) คืน [] เมื่อผ่าน today = วันนี้รูปแบบ YYYY-MM-DD (เวลาไทย)
  function validateMaterialPayload(payload, items, workOrders, today) {
    const problems = [];
    const workOrder = (workOrders ?? []).find((order) => order.id === payload.p_production_order_id);
    if (!payload.p_production_order_id) problems.push("กรุณาเลือกใบสั่งผลิต");
    else if (!workOrder || !["released", "in_progress"].includes(workOrder.status)) problems.push("ใบสั่งผลิตต้องออกใบสั่งงานแล้ว");
    if (!payload.p_expected_date) problems.push("กรุณาระบุวันที่คาดว่าจะได้รับของ");
    else if (today && payload.p_expected_date < today) problems.push("วันที่คาดว่าจะได้รับต้องไม่ก่อนวันนี้");
    if (payload.p_supplier.length > 200) problems.push("ชื่อผู้ขายยาวได้ไม่เกิน 200 ตัวอักษร");
    if (payload.p_note.length > 1000) problems.push("หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร");
    const lines = payload.p_lines ?? [];
    if (!lines.length) problems.push("ต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
    if (lines.length > MAX_LINES) problems.push(`วัตถุดิบมีได้ไม่เกิน ${MAX_LINES} รายการ`);
    const byId = new Map((items ?? []).map((item) => [item.id, item]));
    const seen = new Set();
    lines.forEach((line, index) => {
      const no = index + 1;
      const item = byId.get(line.item_id);
      if (!line.item_id) problems.push(`รายการ ${no}: กรุณาเลือกวัตถุดิบ`);
      else if (!item || !purchasable(item)) problems.push(`รายการ ${no}: ต้องเป็น Item ที่ใช้งานอยู่และจัดซื้อได้`);
      else if (seen.has(line.item_id)) problems.push(`รายการ ${no}: ${item.code} ซ้ำกับรายการก่อนหน้า`);
      if (line.item_id) seen.add(line.item_id);
      const quantity = line.quantity;
      if (quantity === null || !Number.isFinite(quantity) || Math.round(quantity * 10000) / 10000 <= 0 || quantity > MAX_QUANTITY) {
        problems.push(`รายการ ${no}: ปริมาณต้องมากกว่า 0 และไม่เกิน ${MAX_QUANTITY.toLocaleString("en-US")}`);
      }
    });
    return problems;
  }

  // ประวัติของใบเดียว เก่าสุดก่อน (ข้อมูลเข้ามาใหม่สุดก่อน)
  const orderTimeline = (history, orderId) => (history ?? []).filter((entry) => entry.order_id === orderId).slice().reverse();

  const api = {
    STORES_DEPARTMENT, MAX_QUANTITY, MAX_LINES, EXTRA_ROWS, MATERIAL_STATUSES, BADGE_CLASS, HISTORY_ACTIONS, OPEN_STATUSES,
    materialActions, countByStatus, orderableWorkOrders, purchasable, purchasableItems, ordersOf, onOrderByItem, materialNeeds,
    materialPayload, validateMaterialPayload, orderTimeline,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_MATERIAL_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
