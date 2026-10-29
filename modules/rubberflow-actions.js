// RubberFlow MES (แผนก RB โหมดทดสอบ) — กฎธุรกิจทั้งหมดของสายผลิตยาง 4 สถานี ยกมาจาก prototypes/rubber-mes/src/data/actions.js ทั้งไฟล์
// ไม่มี DOM/Supabase เทสต์ด้วย node --test (scripts/tests/rubberflow-actions.test.mjs)
//
// ทุก action แก้ไข "ร่าง" ของ state ที่ clone มาแล้ว: action(draft, payload, ctx) โดย ctx = { now, user }
// ถ้ากฎใดไม่ผ่านจะ throw Error ข้อความภาษาไทย (modules/rubberflow-store.js จับไปแสดง toast และไม่บันทึกร่างนั้น)
// ข้อมูลอยู่ใน localStorage ของเบราว์เซอร์ (ข้อมูลสมมติ) กฎในไฟล์นี้จึงเป็นกฎของเดโม ไม่ใช่การควบคุมสิทธิ์ของระบบจริง
// (การย้ายไปฐานข้อมูลต้องมี migration/RPC/เทสต์ของตัวเองตาม AGENTS.md — ดูหัวข้อ "RubberFlow MES" ใน README)
// โหลดหลัง modules/rubberflow-rules.js (ใน Node เทสต์ตั้ง globalThis.MNP_RUBBERFLOW_RULES ก่อน require ไฟล์นี้)
(function (root) {
  const rules = () => root.MNP_RUBBERFLOW_RULES;

  function nextId(d, prefix, now) {
    const key = `${prefix}-${rules().ymd(now)}`;
    d.counters[key] = (d.counters[key] || 0) + 1;
    return `${key}-${String(d.counters[key]).padStart(2, "0")}`;
  }

  function audit(d, ctx, action, detail) {
    d.audit.unshift({ at: ctx.now, user: ctx.user?.name || "ระบบ", action, detail });
    if (d.audit.length > 400) d.audit.length = 400;
  }

  function fail(message) {
    throw new Error(message);
  }

  function num(value, label) {
    const n = Number(value);
    if (value === "" || value === null || value === undefined || Number.isNaN(n)) fail(`กรุณาระบุ${label}`);
    return n;
  }

  const find = (rows, id, label) => rows.find((row) => row.id === id) || fail(`ไม่พบ${label} ${id}`);

  function startOrderIfReleased(d, orderId, ctx) {
    const order = d.orders.find((row) => row.id === orderId);
    if (order && order.status === "released") {
      order.status = "in_progress";
      audit(d, ctx, "เริ่มผลิต", order.id);
    }
  }

  // ---------- ใบสั่งผลิต ----------

  function createOrder(d, p, ctx) {
    const recipe = find(d.recipes, p.recipeId, "สูตร");
    if (recipe.status !== "approved") fail("สูตรนี้ยังไม่ได้รับอนุมัติ ใช้เปิดใบสั่งผลิตไม่ได้");
    if (!p.customer?.trim()) fail("กรุณาระบุชื่อลูกค้า");
    const targetQty = num(p.targetQty, "จำนวนเป้าหมาย");
    if (targetQty <= 0) fail("จำนวนเป้าหมายต้องมากกว่า 0");
    if (!Number.isFinite(p.startDate) || !Number.isFinite(p.dueDate)) fail("กรุณาระบุวันเริ่มผลิตและวันกำหนดส่ง");
    if (p.dueDate < p.startDate) fail("วันส่งมอบต้องไม่ก่อนวันเริ่มผลิต");
    const id = nextId(d, "WO", ctx.now);
    d.orders.unshift({
      id,
      customer: p.customer.trim(),
      customerPo: p.customerPo?.trim() || "",
      recipeId: recipe.id,
      productCode: recipe.productCode,
      productName: recipe.productName,
      uom: recipe.uom,
      color: p.color || "ดำ",
      targetQty,
      producedQty: 0,
      startDate: p.startDate,
      dueDate: p.dueDate,
      priority: p.priority || "normal",
      note: p.note || "",
      status: "planned",
      createdAt: ctx.now,
      createdBy: ctx.user?.name,
    });
    audit(d, ctx, "เปิดใบสั่งผลิต", `${id} ${recipe.productName} ${targetQty} ${recipe.uom}`);
    return id;
  }

  const ORDER_FLOW = Object.freeze({
    planned: ["released", "cancelled"],
    released: ["in_progress", "on_hold", "cancelled"],
    in_progress: ["on_hold", "completed"],
    on_hold: ["in_progress"],
  });

  function setOrderStatus(d, { id, status }, ctx) {
    const order = find(d.orders, id, "ใบสั่งผลิต");
    if (!(ORDER_FLOW[order.status] || []).includes(status)) fail(`เปลี่ยนสถานะจาก ${order.status} เป็น ${status} ไม่ได้`);
    order.status = status;
    audit(d, ctx, "เปลี่ยนสถานะใบสั่งผลิต", `${id} → ${status}`);
  }

  // ---------- สูตรยาง ----------

  function createRecipe(d, p, ctx) {
    if (!p.id?.trim() || !p.name?.trim() || !p.productName?.trim()) fail("กรุณากรอกรหัสสูตร ชื่อสูตร และชื่อสินค้า");
    if (d.recipes.some((recipe) => recipe.id === p.id.trim())) fail("รหัสสูตรนี้มีอยู่แล้ว");
    const items = (p.items ?? []).filter((item) => item.materialCode && Number(item.phr) > 0);
    if (!items.length) fail("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
    d.recipes.push({
      id: p.id.trim(),
      name: p.name.trim(),
      productCode: p.productCode?.trim() || p.id.trim(),
      productName: p.productName.trim(),
      uom: p.uom || "m",
      batchKg: num(p.batchKg, "น้ำหนักต่อ batch"),
      dumpTemp: num(p.dumpTemp, "อุณหภูมิปล่อยยาง"),
      dumpTol: Number(p.dumpTol) || 5,
      mixSec: num(p.mixSec, "เวลาผสม"),
      restHours: Number(p.restHours) || 4,
      yieldPerKg: num(p.yieldPerKg, "ผลผลิตต่อกิโลกรัม"),
      items: items.map((item) => ({ materialCode: item.materialCode, phr: Number(item.phr) })),
      revision: 1,
      status: "draft",
      createdAt: ctx.now,
      createdBy: ctx.user?.name,
    });
    audit(d, ctx, "สร้างสูตรใหม่", p.id);
  }

  function approveRecipe(d, { id }, ctx) {
    const recipe = find(d.recipes, id, "สูตร");
    if (recipe.status === "approved") fail("สูตรนี้อนุมัติแล้ว");
    recipe.status = "approved";
    recipe.approvedBy = ctx.user?.name;
    recipe.approvedAt = ctx.now;
    audit(d, ctx, "อนุมัติสูตร", id);
  }

  // ---------- เบิกและชั่งวัตถุดิบ ----------

  function createRequisition(d, { orderId, batches, note }, ctx) {
    const { recipeLines, allocateFefo } = rules();
    const order = find(d.orders, orderId, "ใบสั่งผลิต");
    if (!["released", "in_progress"].includes(order.status)) fail('ใบสั่งผลิตต้องอยู่ในสถานะ "ปล่อยผลิต" หรือ "กำลังผลิต"');
    const n = num(batches, "จำนวน batch");
    if (n < 1 || n > 10) fail("จำนวน batch ต้องอยู่ระหว่าง 1–10");
    const recipe = find(d.recipes, order.recipeId, "สูตร");
    // จองสต็อกที่ใบเบิกเปิดอยู่สัญญาไว้แล้ว ใบเบิกสองใบจึงไม่หยิบกิโลเดียวกัน
    const reserved = {};
    d.requisitions.filter((requisition) => requisition.status !== "issued" && requisition.status !== "consumed").forEach((requisition) =>
      requisition.lines.forEach((line) => { reserved[line.lotNo] = (reserved[line.lotNo] || 0) + line.targetKg; }));
    const lines = [];
    const shortages = [];
    for (const item of recipeLines(recipe)) {
      const need = item.kgPerBatch * n;
      const { picks, shortage } = allocateFefo(d.materialLots, item.materialCode, need, ctx.now, reserved);
      if (shortage > 0.0001) shortages.push(`${item.materialCode} ขาด ${shortage.toFixed(2)} kg`);
      picks.forEach((pick) => {
        reserved[pick.lotNo] = (reserved[pick.lotNo] || 0) + pick.kg;
        lines.push({ materialCode: item.materialCode, lotNo: pick.lotNo, targetKg: pick.kg, actualKg: null, weighedAt: null });
      });
    }
    if (shortages.length) fail(`สต็อกไม่พอตามหลัก FEFO: ${shortages.join(", ")}`);
    const id = nextId(d, "REQ", ctx.now);
    d.requisitions.unshift({
      id, orderId, recipeId: recipe.id, batches: n, totalKg: recipe.batchKg * n, lines,
      status: "weighing", note: note || "", requestedBy: ctx.user?.name, createdAt: ctx.now,
    });
    audit(d, ctx, "ระเบิดสูตรและสร้างใบเบิก", `${id} (${order.id}, ${n} batch)`);
    return id;
  }

  function weighLine(d, { reqId, index, actualKg }, ctx) {
    const { weighTolerance, lotState } = rules();
    const requisition = find(d.requisitions, reqId, "ใบเบิก");
    if (requisition.status !== "weighing") fail("ใบเบิกนี้ชั่งครบแล้ว");
    const line = requisition.lines[index] || fail("ไม่พบรายการชั่ง");
    const kg = num(actualKg, "น้ำหนักที่ชั่งได้");
    const tol = weighTolerance(line.targetKg);
    if (Math.abs(kg - line.targetKg) > tol + 1e-9) fail(`น้ำหนักอยู่นอกเกณฑ์ ±${tol.toFixed(3)} kg ระบบไม่ให้บันทึก`);
    const lot = d.materialLots.find((row) => row.lotNo === line.lotNo);
    if (!lot || lotState(lot, ctx.now) !== "available") fail(`ล็อต ${line.lotNo} ใช้ไม่ได้แล้ว (หมดอายุ/กักกัน/หมด)`);
    if (lot.qtyKg < kg) fail(`ล็อต ${line.lotNo} คงเหลือไม่พอ`);
    line.actualKg = kg;
    line.weighedAt = ctx.now;
    line.weighedBy = ctx.user?.name;
    if (requisition.lines.every((row) => row.actualKg !== null)) {
      requisition.lines.forEach((row) => {
        const materialLot = d.materialLots.find((item) => item.lotNo === row.lotNo);
        materialLot.qtyKg = Math.max(0, materialLot.qtyKg - row.actualKg);
      });
      requisition.status = "issued";
      requisition.issuedAt = ctx.now;
      requisition.issuedBy = ctx.user?.name;
      audit(d, ctx, "จ่ายวัตถุดิบครบ", requisition.id);
    }
  }

  function receiveMaterial(d, p, ctx) {
    const material = d.materials.find((row) => row.code === p.materialCode) || fail("กรุณาเลือกวัตถุดิบ");
    const qty = num(p.qtyKg, "ปริมาณรับเข้า");
    if (qty <= 0) fail("ปริมาณต้องมากกว่า 0");
    if (!p.expiry || p.expiry <= ctx.now) fail("วันหมดอายุต้องเป็นวันในอนาคต");
    const lotNo = nextId(d, `RM-${material.code}`, ctx.now);
    d.materialLots.push({
      lotNo, materialCode: material.code, qtyKg: qty, initialKg: qty, expiry: p.expiry, receivedAt: ctx.now,
      supplier: p.supplier || "-", location: p.location || material.storage, status: "available", coa: Boolean(p.coa),
    });
    audit(d, ctx, "รับวัตถุดิบเข้าคลัง", `${lotNo} ${qty} kg`);
    return lotNo;
  }

  function setMaterialLotStatus(d, { lotNo, status }, ctx) {
    if (!["hold", "available"].includes(status)) fail("สถานะล็อตไม่ถูกต้อง");
    const lot = d.materialLots.find((row) => row.lotNo === lotNo) || fail("ไม่พบล็อต");
    lot.status = status;
    audit(d, ctx, status === "hold" ? "กักกันล็อตวัตถุดิบ" : "ปลดกักกันล็อตวัตถุดิบ", lotNo);
  }

  // ---------- บันทึกของแต่ละสถานี ----------

  function newLot(d, stage, prefix, base, ctx) {
    const id = nextId(d, prefix, ctx.now);
    const lot = { id, stage, transferredQty: 0, createdAt: ctx.now, operator: ctx.user?.name, ...base };
    d.lots.unshift(lot);
    return lot;
  }

  function takeFromTransfer(d, transferId, stage, qty) {
    const transfer = find(d.transfers, transferId, "ใบส่งมอบ");
    if (transfer.to !== stage) fail("ใบส่งมอบนี้ไม่ได้ส่งมาที่สถานีนี้");
    if (transfer.status !== "received") fail("Gatekeeper: ต้องกดรับมอบงานก่อนจึงจะเริ่มผลิตได้");
    if (qty <= 0) fail("ปริมาณที่ใช้ต้องมากกว่า 0");
    if (qty > transfer.remaining + 1e-9) fail(`ปริมาณเกินที่รับมา (คงเหลือ ${transfer.remaining})`);
    transfer.remaining = +(transfer.remaining - qty).toFixed(3);
    return transfer;
  }

  function recordMixing(d, p, ctx) {
    const { HOUR } = rules();
    const requisition = find(d.requisitions, p.reqId, "ใบเบิก");
    if (requisition.status !== "issued") fail("ใบเบิกยังจ่ายวัตถุดิบไม่ครบ หรือถูกใช้ไปแล้ว");
    const recipe = find(d.recipes, requisition.recipeId, "สูตร");
    const dumpTemp = num(p.dumpTemp, "อุณหภูมิปล่อยยาง");
    const mixSec = num(p.mixSec, "เวลาผสม");
    const outputKg = num(p.outputKg, "น้ำหนักยางที่ได้");
    const scrapKg = Number(p.scrapKg) || 0;
    const issued = requisition.lines.reduce((sum, line) => sum + line.actualKg, 0);
    if (outputKg + scrapKg > issued + 0.5) fail(`น้ำหนักยางรวมเกินวัตถุดิบที่จ่าย (${issued.toFixed(2)} kg)`);
    const reasons = [];
    if (Math.abs(dumpTemp - recipe.dumpTemp) > recipe.dumpTol) reasons.push(`Dump temp ${dumpTemp}°C นอกช่วง ${recipe.dumpTemp}±${recipe.dumpTol}`);
    const lot = newLot(d, "mixing", "MX", {
      orderId: requisition.orderId, recipeId: recipe.id, uom: "kg", machine: p.machine, shift: p.shift,
      sources: [{ type: "requisition", id: requisition.id }],
      params: { dumpTemp, mixSec, batches: requisition.batches },
      goodQty: outputKg, scrapQty: scrapKg, scrapReason: p.scrapReason || "",
      qc: reasons.length ? "hold" : "pass", holdReasons: reasons,
      readyAt: ctx.now + recipe.restHours * HOUR,
    }, ctx);
    requisition.status = "consumed";
    requisition.consumedBy = lot.id;
    startOrderIfReleased(d, requisition.orderId, ctx);
    audit(d, ctx, "บันทึกการผสม", `${lot.id} ${outputKg} kg${reasons.length ? " (QC Hold อัตโนมัติ)" : ""}`);
    return lot.id;
  }

  function endRest(d, { lotId }, ctx) {
    const lot = find(d.lots, lotId, "ล็อต");
    lot.readyAt = ctx.now;
    audit(d, ctx, "ข้ามเวลาบ่ม (โหมดสาธิต)", lotId);
  }

  function recordExtrusion(d, p, ctx) {
    const { SPECS, inSpec } = rules();
    const useKg = num(p.useKg, "น้ำหนักยางที่ใช้");
    const reworkKg = Number(p.reworkKg) || 0;
    const pct = (reworkKg / (useKg + reworkKg)) * 100;
    if (pct > SPECS.extrusion.reworkMaxPct) fail(`สัดส่วนยางหมุนเวียน ${pct.toFixed(1)}% เกิน ${SPECS.extrusion.reworkMaxPct}%`);
    const transfer = takeFromTransfer(d, p.transferId, "extrusion", useKg);
    const die = find(d.molds, p.dieId, "หัวดาย");
    const params = {
      thickness: num(p.thickness, "ความหนา"),
      width: num(p.width, "ความกว้าง"),
      weightPerM: num(p.weightPerM, "น้ำหนักต่อเมตร"),
      reworkKg, reworkPct: +pct.toFixed(2), useKg,
    };
    const good = num(p.goodQty, "ปริมาณงานดี");
    const reasons = ["thickness", "width", "weightPerM"]
      .filter((key) => !inSpec(params[key], SPECS.extrusion[key]))
      .map((key) => `${SPECS.extrusion[key].label} ${params[key]} ${SPECS.extrusion[key].unit} นอกสเปก`);
    const order = d.orders.find((row) => row.id === transfer.orderId);
    const lot = newLot(d, "extrusion", "EX", {
      orderId: transfer.orderId, uom: order?.uom || "m", machine: p.machine, shift: p.shift, dieId: die.id,
      sources: [{ type: "transfer", id: transfer.id, lotId: transfer.lotId, qty: useKg }],
      params, goodQty: good, scrapQty: Number(p.scrapQty) || 0, scrapReason: p.scrapReason || "",
      qc: reasons.length ? "hold" : "pass", holdReasons: reasons,
    }, ctx);
    die.usageSinceClean += good;
    die.totalUsage += good;
    audit(d, ctx, "บันทึกการรีด", `${lot.id} ${good} ${lot.uom}${reasons.length ? " (QC Hold อัตโนมัติ)" : ""}`);
    return lot.id;
  }

  function recordCuring(d, p, ctx) {
    const { SPECS, inSpec } = rules();
    const useQty = num(p.useQty, "ปริมาณที่นำเข้าอบ");
    const transfer = takeFromTransfer(d, p.transferId, "curing", useQty);
    const mold = find(d.molds, p.moldId, "แม่พิมพ์/สายอบ");
    const params = { temp: num(p.temp, "อุณหภูมิ"), time: num(p.time, "เวลาอบ"), pressure: num(p.pressure, "ความดัน") };
    const good = num(p.goodQty, "ปริมาณงานดี");
    const scrap = Number(p.scrapQty) || 0;
    if (good + scrap > useQty + 1e-9) fail("งานดี + ของเสีย ต้องไม่เกินปริมาณที่นำเข้าอบ");
    const reasons = ["temp", "time", "pressure"]
      .filter((key) => !inSpec(params[key], SPECS.curing[key]))
      .map((key) => `${SPECS.curing[key].label} ${params[key]} ${SPECS.curing[key].unit} นอกสเปก`);
    const order = d.orders.find((row) => row.id === transfer.orderId);
    const lot = newLot(d, "curing", "CU", {
      orderId: transfer.orderId, uom: order?.uom || "m", shift: p.shift, moldId: mold.id, machine: mold.name,
      sources: [{ type: "transfer", id: transfer.id, lotId: transfer.lotId, qty: useQty }],
      params, goodQty: good, scrapQty: scrap, scrapReason: p.scrapReason || "",
      qc: reasons.length ? "hold" : "pass", holdReasons: reasons,
    }, ctx);
    const shots = Math.ceil((good + scrap) / (mold.perCycle || 1));
    mold.usageSinceClean += shots;
    mold.totalUsage += shots;
    audit(d, ctx, "บันทึกการอบ", `${lot.id} ${good} ${lot.uom}${reasons.length ? " (QC Hold อัตโนมัติ)" : ""}`);
    return lot.id;
  }

  function recordFinishing(d, p, ctx) {
    const useQty = num(p.useQty, "ปริมาณที่รับเข้าตกแต่ง");
    const transfer = takeFromTransfer(d, p.transferId, "finishing", useQty);
    const passed = num(p.passedQty, "จำนวนผ่าน QC");
    const scrap = Number(p.scrapQty) || 0;
    const perBox = num(p.perBox, "จำนวนต่อกล่อง");
    if (perBox <= 0) fail("จำนวนต่อกล่องต้องมากกว่า 0");
    if (passed + scrap > useQty + 1e-9) fail("งานผ่าน + ของเสีย ต้องไม่เกินปริมาณที่รับเข้า");
    const order = find(d.orders, transfer.orderId, "ใบสั่งผลิต");
    const result = p.qcResult || "pass";
    const lot = newLot(d, "finishing", "FN", {
      orderId: transfer.orderId, uom: order.uom, shift: p.shift, grade: p.grade || "A",
      sources: [{ type: "transfer", id: transfer.id, lotId: transfer.lotId, qty: useQty }],
      params: { perBox }, goodQty: passed, scrapQty: scrap, scrapReason: p.scrapReason || "",
      qc: result, holdReasons: result === "pass" ? [] : ["ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน"],
    }, ctx);
    let left = passed;
    let i = 0;
    while (left > 1e-9) {
      const qty = Math.min(perBox, left);
      i += 1;
      d.fgBoxes.unshift({
        id: `${lot.id.replace("FN", "BOX")}-${String(i).padStart(3, "0")}`, lotId: lot.id, orderId: order.id,
        productName: order.productName, qty: +qty.toFixed(3), uom: order.uom, grade: lot.grade,
        status: result === "pass" ? "in_stock" : "hold", createdAt: ctx.now,
      });
      left -= qty;
    }
    lot.boxes = i;
    lot.countedToOrder = result === "pass";
    if (result === "pass") addProduced(d, order.id, passed, ctx);
    audit(d, ctx, "บันทึกการตกแต่ง/บรรจุ", `${lot.id} ${passed} ${order.uom} → ${i} กล่อง`);
    return lot.id;
  }

  function addProduced(d, orderId, qty, ctx) {
    const order = d.orders.find((row) => row.id === orderId);
    if (!order) return;
    order.producedQty = +(order.producedQty + qty).toFixed(3);
    if (order.producedQty >= order.targetQty && order.status === "in_progress") {
      order.status = "completed";
      audit(d, ctx, "ปิดใบสั่งผลิต (ครบจำนวน)", order.id);
    }
  }

  function shipBoxes(d, { ids }, ctx) {
    if (!Array.isArray(ids) || !ids.length) fail("กรุณาเลือกกล่องที่จะส่งมอบ");
    ids.forEach((id) => {
      const box = find(d.fgBoxes, id, "กล่อง");
      if (box.status !== "in_stock") fail(`กล่อง ${id} ไม่พร้อมส่ง`);
      box.status = "shipped";
      box.shippedAt = ctx.now;
    });
    audit(d, ctx, "ส่งมอบสินค้า", `${ids.length} กล่อง`);
  }

  // ---------- ส่งมอบ WIP (Gatekeeper) ----------

  function transferableQty(lot, now) {
    const { NEXT_STAGE } = rules();
    if (lot.qc !== "pass") return 0;
    if (lot.stage === "mixing" && lot.readyAt > now) return 0;
    if (!NEXT_STAGE[lot.stage]) return 0;
    return Math.max(0, +(lot.goodQty - lot.transferredQty).toFixed(3));
  }

  function createTransfer(d, { lotId, qty, note }, ctx) {
    const { NEXT_STAGE } = rules();
    const lot = find(d.lots, lotId, "ล็อต");
    if (!NEXT_STAGE[lot.stage]) fail("ล็อตนี้เป็นขั้นตอนสุดท้ายแล้ว");
    if (lot.qc !== "pass") fail("Gatekeeper: ล็อตยังไม่ผ่าน QC ส่งต่อไม่ได้");
    if (lot.stage === "mixing" && lot.readyAt > ctx.now) fail("Gatekeeper: ยางยังบ่มไม่ครบเวลา");
    const q = num(qty, "ปริมาณส่งมอบ");
    const available = transferableQty(lot, ctx.now);
    if (q <= 0 || q > available + 1e-9) fail(`ปริมาณส่งมอบต้องอยู่ระหว่าง 0–${available}`);
    lot.transferredQty = +(lot.transferredQty + q).toFixed(3);
    const id = nextId(d, "TR", ctx.now);
    d.transfers.unshift({
      id, lotId, orderId: lot.orderId, from: lot.stage, to: NEXT_STAGE[lot.stage], uom: lot.uom,
      qtySent: q, qtyReceived: null, remaining: 0, condition: null, note: note || "",
      status: "in_transit", createdAt: ctx.now, createdBy: ctx.user?.name,
    });
    audit(d, ctx, "ส่งมอบ WIP", `${id} ${lotId} ${q} ${lot.uom}`);
    return id;
  }

  function receiveTransfer(d, { id, qtyReceived, condition }, ctx) {
    const transfer = find(d.transfers, id, "ใบส่งมอบ");
    if (transfer.status !== "in_transit") fail("ใบส่งมอบนี้รับไปแล้ว");
    const q = num(qtyReceived, "จำนวนที่รับจริง");
    if (q < 0 || q > transfer.qtySent * 1.02) fail("จำนวนรับจริงต้องไม่เกินจำนวนที่ส่ง (+2%)");
    transfer.qtyReceived = q;
    transfer.remaining = q;
    transfer.condition = condition || "ok";
    transfer.status = "received";
    transfer.receivedAt = ctx.now;
    transfer.receivedBy = ctx.user?.name;
    audit(d, ctx, "รับมอบ WIP", `${id} รับ ${q}/${transfer.qtySent} ${transfer.uom}`);
  }

  // ---------- คุณภาพ ----------

  function addQcRecord(d, p, ctx) {
    const { SPECS, inSpec } = rules();
    const lot = find(d.lots, p.lotId, "ล็อต");
    const values = p.values ?? {};
    const tests = Object.entries(SPECS.lab)
      .filter(([key]) => values[key] !== "" && values[key] !== undefined && values[key] !== null)
      .map(([key, spec]) => ({ key, value: Number(values[key]), pass: inSpec(values[key], spec) }));
    if (!tests.length) fail("กรุณากรอกผลทดสอบอย่างน้อย 1 รายการ");
    const allPass = tests.every((test) => test.pass);
    const result = p.result || (allPass ? "pass" : "hold");
    if (!["pass", "hold", "fail"].includes(result)) fail("ผลตัดสินไม่ถูกต้อง");
    if (result === "pass" && !allPass) fail('มีค่าทดสอบนอกสเปก ตัดสินเป็น "ผ่าน" ไม่ได้');
    const id = nextId(d, "QC", ctx.now);
    d.qcRecords.unshift({ id, lotId: lot.id, orderId: lot.orderId, stage: lot.stage, tests, result, note: p.note || "", inspector: ctx.user?.name, at: ctx.now });
    lot.qc = result;
    if (result === "pass") lot.holdReasons = [];
    d.fgBoxes.filter((box) => box.lotId === lot.id && box.status !== "shipped").forEach((box) => {
      box.status = result === "pass" ? "in_stock" : "hold";
    });
    if (lot.stage === "finishing" && result === "pass" && !lot.countedToOrder) {
      // ล็อตตกแต่งที่เคยถูกกักกันนับเข้าใบสั่งผลิตเมื่อผ่านเท่านั้น
      lot.countedToOrder = true;
      addProduced(d, lot.orderId, lot.goodQty, ctx);
    }
    audit(d, ctx, "บันทึกผล QC", `${id} ${lot.id} → ${result}`);
    return id;
  }

  function createNcr(d, p, ctx) {
    if (!p.title?.trim()) fail("กรุณาระบุหัวข้อปัญหา");
    if (!p.lotId?.trim()) fail("กรุณาระบุล็อตที่พบปัญหา");
    const id = nextId(d, "NCR", ctx.now);
    const lot = d.lots.find((row) => row.id === p.lotId.trim());
    if (lot && lot.qc === "pass") {
      lot.qc = "hold";
      lot.holdReasons = [...(lot.holdReasons || []), `เปิด ${id}`];
    }
    d.ncrs.unshift({
      id, title: p.title.trim(), stage: p.stage, lotId: p.lotId.trim(), severity: p.severity || "major",
      defectQty: Number(p.defectQty) || 0, whys: (p.whys || []).filter(Boolean), containment: p.containment || "",
      corrective: p.corrective || "", preventive: p.preventive || "", owner: p.owner || ctx.user?.name,
      status: "open", createdAt: ctx.now, createdBy: ctx.user?.name,
    });
    audit(d, ctx, "เปิด NCR", `${id} ${p.title}`);
    return id;
  }

  function closeNcr(d, { id, verification }, ctx) {
    const ncr = find(d.ncrs, id, "NCR");
    if (ncr.status === "closed") fail("NCR นี้ปิดแล้ว");
    if (!ncr.corrective?.trim()) fail("ต้องมีการแก้ไข (Corrective action) ก่อนปิดเคส");
    ncr.status = "closed";
    ncr.closedAt = ctx.now;
    ncr.closedBy = ctx.user?.name;
    ncr.verification = verification || "";
    audit(d, ctx, "ปิด NCR", id);
  }

  // ---------- แม่พิมพ์และหัวดาย ----------

  function cleanMold(d, { id }, ctx) {
    const mold = find(d.molds, id, "แม่พิมพ์");
    mold.usageSinceClean = 0;
    mold.lastCleanAt = ctx.now;
    audit(d, ctx, "บันทึกทำความสะอาดแม่พิมพ์/หัวดาย", id);
  }

  const api = {
    ORDER_FLOW, createOrder, setOrderStatus, createRecipe, approveRecipe, createRequisition, weighLine, receiveMaterial, setMaterialLotStatus,
    recordMixing, endRest, recordExtrusion, recordCuring, recordFinishing, shipBoxes, transferableQty, createTransfer, receiveTransfer,
    addQcRecord, createNcr, closeNcr, cleanMold,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_RUBBERFLOW_ACTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
