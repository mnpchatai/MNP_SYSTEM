// RubberFlow MES (แผนก RB โหมดทดสอบ) — มุมมองอ่านอย่างเดียวที่คำนวณจาก state: การแจ้งเตือน การค้นหารหัส และต้นไม้สืบย้อนกลับ
// ยกมาจาก prototypes/rubber-mes/src/lib/derive.js ทั้งไฟล์ ไม่มี DOM/Supabase เทสต์ด้วย node --test (scripts/tests/rubberflow-rules.test.mjs)
// โหลดหลัง modules/rubberflow-rules.js (ใน Node เทสต์ตั้ง globalThis.MNP_RUBBERFLOW_RULES ก่อน require ไฟล์นี้)
(function (root) {
  const rules = () => root.MNP_RUBBERFLOW_RULES;

  function buildAlerts(d, now) {
    const { DAY, lotState, STAGE_LABEL, fmtDate, fmtDuration } = rules();
    const alerts = [];
    d.materialLots.forEach((lot) => {
      const state = lotState(lot, now);
      const material = d.materials.find((item) => item.code === lot.materialCode);
      if (state === "expired" && lot.qtyKg > 0) alerts.push({ tone: "bad", module: "warehouse", title: `ล็อตหมดอายุ ${lot.lotNo}`, text: `${material?.name} คงเหลือ ${lot.qtyKg.toFixed(1)} kg ถูกบล็อกการเบิกแล้ว` });
      else if (state === "available" && lot.expiry - now < 30 * DAY) alerts.push({ tone: "warn", module: "warehouse", title: `ใกล้หมดอายุ ${lot.lotNo}`, text: `${material?.name} หมดอายุ ${fmtDate(lot.expiry)} ระบบจะจ่ายล็อตนี้ก่อน (FEFO)` });
    });
    d.molds.forEach((mold) => {
      const pct = mold.usageSinceClean / mold.cleanEvery;
      if (pct >= 0.85) alerts.push({ tone: pct >= 1 ? "bad" : "warn", module: "molds", title: `ถึงรอบล้าง ${mold.id}`, text: `${mold.name} ใช้ไป ${Math.round(pct * 100)}% ของรอบทำความสะอาด` });
    });
    d.lots.filter((lot) => lot.qc === "hold").forEach((lot) => alerts.push({ tone: "warn", module: "quality", title: `QC Hold ${lot.id}`, text: (lot.holdReasons || []).join(", ") || "รอผลตัดสินจาก QC" }));
    d.lots.filter((lot) => lot.stage === "mixing" && lot.readyAt > now).forEach((lot) => alerts.push({ tone: "info", module: "mixing", title: `กำลังบ่มยาง ${lot.id}`, text: `เหลืออีก ${fmtDuration(lot.readyAt - now)} จึงส่งต่อไปรีดได้` }));
    d.transfers.filter((transfer) => transfer.status === "in_transit").forEach((transfer) => alerts.push({ tone: "info", module: "wip", title: `รอรับมอบ ${transfer.id}`, text: `${STAGE_LABEL[transfer.from]} → ${STAGE_LABEL[transfer.to]} ${transfer.qtySent} ${transfer.uom}` }));
    d.orders.filter((order) => ["released", "in_progress", "on_hold"].includes(order.status) && order.dueDate - now < 3 * DAY).forEach((order) => alerts.push({ tone: order.dueDate < now ? "bad" : "warn", module: "orders", title: `ใกล้กำหนดส่ง ${order.id}`, text: `${order.customer} ส่ง ${fmtDate(order.dueDate)} ผลิตแล้ว ${Math.round((order.producedQty / order.targetQty) * 100)}%` }));
    d.ncrs.filter((ncr) => ncr.status === "open").forEach((ncr) => alerts.push({ tone: ncr.severity === "critical" ? "bad" : "warn", module: "quality", title: `NCR เปิดอยู่ ${ncr.id}`, text: ncr.title }));
    const rank = { bad: 0, warn: 1, info: 2 };
    return alerts.sort((a, b) => rank[a.tone] - rank[b.tone]);
  }

  // รหัสที่สแกน/พิมพ์หมายถึงอะไร: ใบสั่งผลิต ล็อต กล่อง ล็อตวัตถุดิบ ใบเบิก ใบส่งมอบ หรือแม่พิมพ์
  function lookupCode(d, raw) {
    const code = String(raw ?? "").trim().toUpperCase();
    if (!code) return null;
    const order = d.orders.find((item) => item.id === code);
    if (order) return { kind: "order", item: order };
    const lot = d.lots.find((item) => item.id === code);
    if (lot) return { kind: "lot", item: lot };
    const box = d.fgBoxes.find((item) => item.id === code);
    if (box) return { kind: "box", item: box };
    const materialLot = d.materialLots.find((item) => item.lotNo.toUpperCase() === code);
    if (materialLot) return { kind: "material", item: materialLot };
    const requisition = d.requisitions.find((item) => item.id === code);
    if (requisition) return { kind: "requisition", item: requisition };
    const transfer = d.transfers.find((item) => item.id === code);
    if (transfer) return { kind: "transfer", item: transfer };
    const mold = d.molds.find((item) => item.id === code);
    if (mold) return { kind: "mold", item: mold };
    return null;
  }

  // ล็อตต้นทางหนึ่งขั้นก่อนหน้าของล็อต WIP
  const parentLotIds = (d, lot) => (lot.sources || []).filter((source) => source.lotId).map((source) => source.lotId);
  const childLots = (d, lotId) => d.lots.filter((lot) => (lot.sources || []).some((source) => source.lotId === lotId));

  // ต้นไม้ย้อนกลับ: จากล็อตลงไปถึงล็อตวัตถุดิบที่ใช้
  function backwardTree(d, lotId, depth = 0) {
    const lot = d.lots.find((item) => item.id === lotId);
    if (!lot || depth > 6) return null;
    const children = parentLotIds(d, lot).map((id) => backwardTree(d, id, depth + 1)).filter(Boolean);
    if (lot.stage === "mixing") {
      const reqId = lot.sources.find((source) => source.type === "requisition")?.id;
      const requisition = d.requisitions.find((item) => item.id === reqId);
      if (requisition) {
        children.push({
          kind: "requisition", id: requisition.id, item: requisition,
          children: requisition.lines.map((line) => ({ kind: "material", id: line.lotNo, item: d.materialLots.find((item) => item.lotNo === line.lotNo), kg: line.actualKg, children: [] })),
        });
      }
    }
    return { kind: "lot", id: lot.id, item: lot, children };
  }

  // ต้นไม้ไปข้างหน้า: ทุกล็อตและกล่องปลายทางที่ใช้ล็อตนี้หรือล็อตวัตถุดิบนี้
  function forwardTree(d, start) {
    const fromLot = (lot, depth) => {
      if (depth > 6) return null;
      const children = childLots(d, lot.id).map((child) => fromLot(child, depth + 1)).filter(Boolean);
      d.fgBoxes.filter((box) => box.lotId === lot.id).forEach((box) => children.push({ kind: "box", id: box.id, item: box, children: [] }));
      return { kind: "lot", id: lot.id, item: lot, children };
    };
    if (start.kind === "material") {
      const requisitions = d.requisitions.filter((requisition) => requisition.lines.some((line) => line.lotNo === start.item.lotNo));
      return {
        kind: "material", id: start.item.lotNo, item: start.item,
        children: requisitions.map((requisition) => {
          const mixing = d.lots.find((lot) => lot.stage === "mixing" && lot.sources.some((source) => source.id === requisition.id));
          return { kind: "requisition", id: requisition.id, item: requisition, children: mixing ? [fromLot(mixing, 0)] : [] };
        }),
      };
    }
    return fromLot(start.item, 0);
  }

  const api = { buildAlerts, lookupCode, parentLotIds, childLots, backwardTree, forwardTree };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_RUBBERFLOW_DERIVE = api;
})(typeof window !== "undefined" ? window : globalThis);
