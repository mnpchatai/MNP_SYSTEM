// ตรรกะของใบสั่งผลิต ขั้น 1–2 ของฝ่ายโรงงาน (โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-production-model.test.mjs)
//
// ขั้นตอน: ฝ่ายขาย (SA) ออกใบ (draft) → ส่ง (submitted) → ฝ่ายวางแผน (PP) รับ (planning) → สำรวจคงคลัง + เลือก BOM/Routing (planned)
// → ออกใบสั่งงาน (released) · ส่งกลับฝ่ายขายได้ขณะ submitted/planning · ถอนกลับได้เฉพาะ submitted
// กติกาตรงกับ RPC ใน supabase/migrations/20261007030000_factory_production_order_workflow.sql ฐานข้อมูลตรวจสิทธิ์/สถานะ/ค่าทุกช่องเอง
// ที่นี่ใช้เลือกปุ่มและตรวจฟอร์มเพื่อความสะดวกเท่านั้น (ซ่อนปุ่มไม่ใช่การควบคุมสิทธิ์)
//
// ข้อมูลเข้ามาจาก app_factory_master_data (items, boms, bom_lines, routings, production, production_history)
(function (root) {
  const SALES_DEPARTMENT = "SA";
  const PLANNING_DEPARTMENT = "PP";
  const MAX_QUANTITY = 1000000000;

  // สถานะที่ใช้ในใบสั่งผลิต (ตรงกับ check constraint factory_production_orders_status_check)
  const ORDER_STATUSES = Object.freeze({
    draft: "ฉบับร่าง (ฝ่ายขาย)",
    submitted: "ส่งแล้ว รอฝ่ายวางแผนรับ",
    planning: "ฝ่ายวางแผนรับแล้ว กำลังวางแผน",
    planned: "วางแผนแล้ว รอออกใบสั่งงาน",
    released: "ออกใบสั่งงานแล้ว",
    in_progress: "กำลังผลิต",
    completed: "เสร็จแล้ว",
    cancelled: "ยกเลิก",
  });
  // class ของ .badge ใน styles.css ที่ใกล้เคียงที่สุด (สีเตือน = รอคนรับ, ฟ้า = เดินอยู่/วางแผนแล้ว, เขียว = ออกแล้ว/เสร็จ)
  const BADGE_CLASS = Object.freeze({
    draft: "", submitted: "pending_approval", planning: "in_progress", planned: "approved",
    released: "completed", in_progress: "in_progress", completed: "completed", cancelled: "cancelled",
  });
  const HISTORY_ACTIONS = Object.freeze({
    create: "สร้างฉบับร่าง", update: "แก้ไขฉบับร่าง", submit: "ส่งให้ฝ่ายวางแผน", withdraw: "ถอนกลับมาแก้ไข",
    receive: "ฝ่ายวางแผนรับใบ", return: "ส่งกลับฝ่ายขาย", plan: "วางแผน (BOM/Routing)", release: "ออกใบสั่งงาน",
  });

  // ปุ่มที่ทำได้ตามสถานะและแผนกของผู้ใช้ (dept = รหัสแผนกของ persona ที่ทำหน้าที่อยู่)
  //   SA: draft = แก้/ส่ง · submitted = ถอนกลับ    PP: submitted = รับ/ส่งกลับ · planning = วางแผน/ส่งกลับ · planned = วางแผนใหม่/ออกใบสั่งงาน
  function orderActions(order, dept) {
    const status = order?.status;
    if (dept === SALES_DEPARTMENT) {
      if (status === "draft") return ["edit", "submit"];
      if (status === "submitted") return ["withdraw"];
      return [];
    }
    if (dept === PLANNING_DEPARTMENT) {
      if (status === "submitted") return ["receive", "return"];
      if (status === "planning") return ["plan", "return"];
      if (status === "planned") return ["plan", "release"];
    }
    return [];
  }

  // ผู้ใช้แผนกนี้ทำอะไรกับใบได้บ้าง (ใช้บอกว่า "รอคุณ" หรือ "รอแผนกอื่น")
  const waitingFor = (order) => ({ draft: SALES_DEPARTMENT, submitted: PLANNING_DEPARTMENT, planning: PLANNING_DEPARTMENT, planned: PLANNING_DEPARTMENT })[order?.status] ?? null;

  // คิวของฝ่ายวางแผน: รอรับ (ส่งมานานสุดก่อน) · กำลังวางแผน · วางแผนแล้วรอออกใบสั่งงาน
  function planningQueue(orders) {
    const byOldest = (field) => (a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) || String(a.code).localeCompare(String(b.code));
    const pick = (status, field) => (orders ?? []).filter((order) => order.status === status).slice().sort(byOldest(field));
    return { submitted: pick("submitted", "submitted_at"), planning: pick("planning", "received_at"), planned: pick("planned", "planned_at") };
  }

  // ใบของฝ่ายขาย: ร่าง (ที่ถูกส่งกลับขึ้นก่อน) · รอฝ่ายวางแผน · ที่เดินต่อแล้ว
  function salesQueue(orders) {
    const list = (orders ?? []).slice();
    const byCode = (a, b) => String(b.code).localeCompare(String(a.code));
    return {
      drafts: list.filter((order) => order.status === "draft")
        .sort((a, b) => Number(Boolean(b.return_note)) - Number(Boolean(a.return_note)) || byCode(a, b)),
      waiting: list.filter((order) => ["submitted", "planning"].includes(order.status)).sort(byCode),
      done: list.filter((order) => !["draft", "submitted", "planning"].includes(order.status)).sort(byCode),
    };
  }

  const countByStatus = (orders) => {
    const counts = Object.fromEntries(Object.keys(ORDER_STATUSES).map((status) => [status, 0]));
    for (const order of orders ?? []) if (order.status in counts) counts[order.status] += 1;
    return counts;
  };

  // สินค้าที่สั่งผลิตได้: FG ที่ใช้งานอยู่ ผลิตเอง/ซื้อ-ผลิต (ตรงกับ app_factory_save_production_order)
  const canOrder = (item) => item?.status === "active" && item.item_type === "FG" && ["make", "both"].includes(item.procurement);
  const orderableItems = (items) => (items ?? []).filter(canOrder).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const toNumber = (value) => {
    const text = String(value ?? "").trim();
    return text === "" ? null : Number(text);
  };

  // ค่าจากฟอร์ม -> พารามิเตอร์ของ app_factory_save_production_order (existing = ฉบับร่างที่กำลังแก้)
  function orderPayload(values, existing) {
    return {
      p_id: existing?.id ?? null,
      p_version: existing?.version ?? null,
      p_item_id: String(values.item_id ?? "").trim() || null,
      p_planned_qty: toNumber(values.planned_qty),
      p_due_date: String(values.due_date ?? "").trim() || null,
      p_customer: String(values.customer ?? "").trim(),
      p_note: String(values.note ?? "").trim(),
    };
  }

  // ข้อความแก้ฟอร์มก่อนส่ง (ภาษาไทย) คืน [] เมื่อผ่าน today = วันนี้รูปแบบ YYYY-MM-DD (เวลาไทย)
  function validateOrderPayload(payload, items, today) {
    const problems = [];
    const item = (items ?? []).find((row) => row.id === payload.p_item_id);
    if (!payload.p_item_id) problems.push("กรุณาเลือกสินค้า");
    else if (!item || !canOrder(item)) problems.push("สินค้าต้องเป็นสินค้าสำเร็จรูป (FG) ที่ใช้งานอยู่และผลิตเองได้");
    const quantity = payload.p_planned_qty;
    if (quantity === null || !Number.isFinite(quantity) || Math.round(quantity * 10000) / 10000 <= 0 || quantity > MAX_QUANTITY) {
      problems.push(`จำนวนที่สั่งผลิตต้องมากกว่า 0 และไม่เกิน ${MAX_QUANTITY.toLocaleString("en-US")}`);
    }
    if (!payload.p_due_date) problems.push("กรุณาระบุกำหนดเสร็จ");
    else if (today && payload.p_due_date < today) problems.push("กำหนดเสร็จต้องไม่ก่อนวันนี้");
    if (payload.p_customer.length > 200) problems.push("ชื่อลูกค้า/อ้างอิงยาวได้ไม่เกิน 200 ตัวอักษร");
    if (payload.p_note.length > 1000) problems.push("หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร");
    return problems;
  }

  // BOM ที่ใช้วางแผนได้: ฉบับที่อนุมัติของสินค้านั้น (Item หนึ่งมีได้ฉบับเดียว) · Routing: ของสินค้านั้นที่ไม่เลิกใช้
  const approvedBom = (boms, itemId) => (boms ?? []).find((bom) => bom.item_id === itemId && bom.status === "approved") ?? null;
  const routingChoices = (routings, itemId) => (routings ?? []).filter((routing) => routing.item_id === itemId && routing.status !== "obsolete");

  // สำรวจคงคลัง (ขั้น 2.2): กระจายความต้องการตามจำนวนสั่งผลิตลงทุกชั้นของ BOM ที่อนุมัติแล้ว หักยอดคงเหลือทุกคลังของแต่ละ Item
  // ก่อนกระจายต่อ (Item ที่ซ้ำหลายสูตรรวมความต้องการก่อนหักยอดครั้งเดียว) ลำดับประมวลผลจากชั้นบนลงล่าง
  //   ต้องการ = ปริมาณต่อสูตร × (จำนวน ÷ ผลผลิตต่อสูตร) × (1 + %เผื่อสูญเสีย)   (เผื่อแบบบวกเพิ่ม เหมือนหน้าโครงสร้างสินค้า)
  //   ขาด = max(0, ต้องการ − คงเหลือ) ถ้า Item มี BOM ที่อนุมัติแล้ว ส่วนที่ขาดถูกกระจายต่อไปยังส่วนประกอบของมัน
  //   ถ้าไม่มี BOM ที่อนุมัติ ส่วนที่ขาดคือของที่ต้องจัดหา (ซื้อ หรือสั่งทำ/ทำ BOM เพิ่ม)
  // แถวที่ความต้องการเป็น 0 (ชั้นบนมีของพอ ไม่ต้องแตกต่อ) ไม่ถูกรวมในผล
  // คืน { rows, shortages, missingBoms } หรือ null ถ้าไม่มี BOM ตั้งต้น/จำนวนไม่ใช่จำนวนบวก
  //   rows: { item_id, code, name, unit_code, item_type, level, gross, onHand, net, hasBom }  เรียงตามชั้นแล้วรหัส
  //   shortages: rows ที่ขาดและไม่มี BOM ต่อ (ต้องจัดหา)  missingBoms: ส่วนประกอบประเภท WIP/FG ที่ขาดแต่ไม่มี BOM ที่อนุมัติ
  const round4 = (value) => Math.round(value * 10000) / 10000;
  function surveyRequirements(data, itemId, quantity) {
    const items = new Map((data.items ?? []).map((item) => [item.id, item]));
    const root = approvedBom(data.boms, itemId);
    const produce = Number(quantity);
    if (!root || !items.has(itemId) || !Number.isFinite(produce) || produce <= 0) return null;
    const bomByItem = new Map((data.boms ?? []).filter((bom) => bom.status === "approved").map((bom) => [bom.item_id, bom]));
    const linesByBom = new Map();
    for (const line of data.bom_lines ?? []) {
      if (!linesByBom.has(line.bom_id)) linesByBom.set(line.bom_id, []);
      linesByBom.get(line.bom_id).push(line);
    }

    // ระดับของแต่ละ Item = เส้นทางที่ยาวที่สุดจากสินค้าตั้งต้น (กันวนซ้ำด้วยชุดที่กำลังเดิน)
    const level = new Map([[itemId, 0]]);
    const walking = new Set();
    (function visit(id, depth) {
      if (walking.has(id)) return;
      walking.add(id);
      const bom = bomByItem.get(id);
      for (const line of bom ? linesByBom.get(bom.id) ?? [] : []) {
        if (depth + 1 > (level.get(line.component_id) ?? -1)) level.set(line.component_id, depth + 1);
        visit(line.component_id, depth + 1);
      }
      walking.delete(id);
    })(itemId, 0);

    const gross = new Map([[itemId, produce]]);
    const rows = [];
    for (const id of [...level.keys()].sort((a, b) => level.get(a) - level.get(b) || String(items.get(a)?.code).localeCompare(String(items.get(b)?.code)))) {
      const item = items.get(id);
      const demand = gross.get(id) ?? 0;
      // ส่วนประกอบที่ไม่ต้องใช้เพราะชั้นบนมีของพอแล้ว (ความต้องการ 0) ไม่แสดง เพื่อไม่ให้ตารางสำรวจรกด้วยแถวที่ไม่เกี่ยว
      if (id !== itemId && demand <= 0) continue;
      // สินค้าตั้งต้นคือสิ่งที่จะผลิต ไม่หักยอดคงเหลือของตัวเอง
      const onHand = id === itemId ? 0 : Math.max(0, Number(item?.stock ?? 0));
      const net = id === itemId ? demand : Math.max(0, demand - onHand);
      const bom = bomByItem.get(id);
      const hasBom = Boolean(bom);
      rows.push({
        item_id: id, code: item?.code ?? "?", name: item?.name ?? "", unit_code: item?.unit_code ?? "", item_type: item?.item_type ?? "",
        level: level.get(id), gross: round4(demand), onHand: round4(onHand), net: round4(net), hasBom,
      });
      if (bom && net > 0) {
        for (const line of linesByBom.get(bom.id) ?? []) {
          const need = (Number(line.quantity) * net / Number(bom.output_qty)) * (1 + Number(line.scrap_percent) / 100);
          gross.set(line.component_id, (gross.get(line.component_id) ?? 0) + need);
        }
      }
    }
    const body = rows.filter((row) => row.item_id !== itemId);
    return {
      rows: body,
      shortages: body.filter((row) => row.net > 0 && !row.hasBom),
      missingBoms: body.filter((row) => row.net > 0 && !row.hasBom && ["WIP", "FG"].includes(row.item_type)),
    };
  }

  // ข้อความตั้งต้นของ "ผลสำรวจคงคลัง" ให้ฝ่ายวางแผนแก้ต่อ (ฝ่ายวางแผนเป็นผู้ยืนยัน ฐานข้อมูลเก็บเฉพาะข้อความที่บันทึก)
  function surveySummary(survey) {
    if (!survey) return "";
    if (!survey.shortages.length) return "สำรวจคงคลังแล้ว: วัตถุดิบและชิ้นงานตามสูตรมีเพียงพอ";
    const fmt = (value) => Number(value).toLocaleString("th-TH", { maximumFractionDigits: 4 });
    const lines = survey.shortages.map((row) => `${row.code} ขาด ${fmt(row.net)} ${row.unit_code}`);
    return `สำรวจคงคลังแล้ว: ขาด ${survey.shortages.length} รายการ — ${lines.join(", ")}`;
  }

  // ประวัติของใบเดียว เก่าสุดก่อน (ข้อมูลเข้ามาใหม่สุดก่อน)
  const orderTimeline = (history, orderId) => (history ?? []).filter((entry) => entry.order_id === orderId).slice().reverse();

  const api = {
    SALES_DEPARTMENT, PLANNING_DEPARTMENT, MAX_QUANTITY, ORDER_STATUSES, BADGE_CLASS, HISTORY_ACTIONS,
    orderActions, waitingFor, planningQueue, salesQueue, countByStatus, canOrder, orderableItems,
    orderPayload, validateOrderPayload, approvedBom, routingChoices, surveyRequirements, surveySummary, orderTimeline,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_PRODUCTION_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
