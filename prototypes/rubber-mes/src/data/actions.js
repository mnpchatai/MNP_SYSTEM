// State transitions. Each action mutates a draft copy of the state:
//   action(draft, payload, ctx)  where ctx = { now, user }
// Actions throw an Error with a Thai message when a business rule blocks them.

import {
  HOUR, NEXT_STAGE, SPECS, inSpec, recipeLines, allocateFefo, weighTolerance, lotState,
} from '../lib/rules.js';
import { ymd } from '../lib/format.js';

function nextId(d, prefix, now) {
  const key = `${prefix}-${ymd(now)}`;
  d.counters[key] = (d.counters[key] || 0) + 1;
  return `${key}-${String(d.counters[key]).padStart(2, '0')}`;
}

function audit(d, ctx, action, detail) {
  d.audit.unshift({ at: ctx.now, user: ctx.user?.name || 'ระบบ', action, detail });
  if (d.audit.length > 400) d.audit.length = 400;
}

function fail(msg) {
  throw new Error(msg);
}

function num(v, label) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || Number.isNaN(n)) fail(`กรุณาระบุ${label}`);
  return n;
}

const find = (arr, id, label) => arr.find((x) => x.id === id) || fail(`ไม่พบ${label} ${id}`);

function startOrderIfReleased(d, orderId, ctx) {
  const o = d.orders.find((x) => x.id === orderId);
  if (o && o.status === 'released') {
    o.status = 'in_progress';
    audit(d, ctx, 'เริ่มผลิต', o.id);
  }
}

// ---------- Production orders ----------

export function createOrder(d, p, ctx) {
  const recipe = find(d.recipes, p.recipeId, 'สูตร');
  if (recipe.status !== 'approved') fail('สูตรนี้ยังไม่ได้รับอนุมัติ ใช้เปิดใบสั่งผลิตไม่ได้');
  if (!p.customer?.trim()) fail('กรุณาระบุชื่อลูกค้า');
  const targetQty = num(p.targetQty, 'จำนวนเป้าหมาย');
  if (targetQty <= 0) fail('จำนวนเป้าหมายต้องมากกว่า 0');
  if (p.dueDate < p.startDate) fail('วันส่งมอบต้องไม่ก่อนวันเริ่มผลิต');
  const id = nextId(d, 'WO', ctx.now);
  d.orders.unshift({
    id,
    customer: p.customer.trim(),
    customerPo: p.customerPo?.trim() || '',
    recipeId: recipe.id,
    productCode: recipe.productCode,
    productName: recipe.productName,
    uom: recipe.uom,
    color: p.color || 'ดำ',
    targetQty,
    producedQty: 0,
    startDate: p.startDate,
    dueDate: p.dueDate,
    priority: p.priority || 'normal',
    note: p.note || '',
    status: 'planned',
    createdAt: ctx.now,
    createdBy: ctx.user?.name,
  });
  audit(d, ctx, 'เปิดใบสั่งผลิต', `${id} ${recipe.productName} ${targetQty} ${recipe.uom}`);
  return id;
}

const ORDER_FLOW = {
  planned: ['released', 'cancelled'],
  released: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['on_hold', 'completed'],
  on_hold: ['in_progress'],
};

export function setOrderStatus(d, { id, status }, ctx) {
  const o = find(d.orders, id, 'ใบสั่งผลิต');
  if (!(ORDER_FLOW[o.status] || []).includes(status)) fail(`เปลี่ยนสถานะจาก ${o.status} เป็น ${status} ไม่ได้`);
  o.status = status;
  audit(d, ctx, 'เปลี่ยนสถานะใบสั่งผลิต', `${id} → ${status}`);
}

// ---------- Recipes ----------

export function createRecipe(d, p, ctx) {
  if (!p.id?.trim() || !p.name?.trim() || !p.productName?.trim()) fail('กรุณากรอกรหัสสูตร ชื่อสูตร และชื่อสินค้า');
  if (d.recipes.some((r) => r.id === p.id.trim())) fail('รหัสสูตรนี้มีอยู่แล้ว');
  const items = p.items.filter((i) => i.materialCode && Number(i.phr) > 0);
  if (!items.length) fail('สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ');
  d.recipes.push({
    id: p.id.trim(),
    name: p.name.trim(),
    productCode: p.productCode?.trim() || p.id.trim(),
    productName: p.productName.trim(),
    uom: p.uom || 'm',
    batchKg: num(p.batchKg, 'น้ำหนักต่อ batch'),
    dumpTemp: num(p.dumpTemp, 'อุณหภูมิปล่อยยาง'),
    dumpTol: Number(p.dumpTol) || 5,
    mixSec: num(p.mixSec, 'เวลาผสม'),
    restHours: Number(p.restHours) || 4,
    yieldPerKg: num(p.yieldPerKg, 'ผลผลิตต่อกิโลกรัม'),
    items: items.map((i) => ({ materialCode: i.materialCode, phr: Number(i.phr) })),
    revision: 1,
    status: 'draft',
    createdAt: ctx.now,
    createdBy: ctx.user?.name,
  });
  audit(d, ctx, 'สร้างสูตรใหม่', p.id);
}

export function approveRecipe(d, { id }, ctx) {
  const r = find(d.recipes, id, 'สูตร');
  if (r.status === 'approved') fail('สูตรนี้อนุมัติแล้ว');
  r.status = 'approved';
  r.approvedBy = ctx.user?.name;
  r.approvedAt = ctx.now;
  audit(d, ctx, 'อนุมัติสูตร', id);
}

// ---------- Material requisition & weighing ----------

export function createRequisition(d, { orderId, batches, note }, ctx) {
  const o = find(d.orders, orderId, 'ใบสั่งผลิต');
  if (!['released', 'in_progress'].includes(o.status)) fail('ใบสั่งผลิตต้องอยู่ในสถานะ "ปล่อยผลิต" หรือ "กำลังผลิต"');
  const n = num(batches, 'จำนวน batch');
  if (n < 1 || n > 10) fail('จำนวน batch ต้องอยู่ระหว่าง 1–10');
  const recipe = find(d.recipes, o.recipeId, 'สูตร');
  // Reserve stock already promised to open requisitions so two requests cannot take the same kilos.
  const reserved = {};
  d.requisitions.filter((r) => r.status !== 'issued' && r.status !== 'consumed').forEach((r) =>
    r.lines.forEach((l) => { reserved[l.lotNo] = (reserved[l.lotNo] || 0) + l.targetKg; }));
  const lines = [];
  const shortages = [];
  for (const item of recipeLines(recipe)) {
    const need = item.kgPerBatch * n;
    const { picks, shortage } = allocateFefo(d.materialLots, item.materialCode, need, ctx.now, reserved);
    if (shortage > 0.0001) shortages.push(`${item.materialCode} ขาด ${shortage.toFixed(2)} kg`);
    picks.forEach((pk) => {
      reserved[pk.lotNo] = (reserved[pk.lotNo] || 0) + pk.kg;
      lines.push({ materialCode: item.materialCode, lotNo: pk.lotNo, targetKg: pk.kg, actualKg: null, weighedAt: null });
    });
  }
  if (shortages.length) fail(`สต็อกไม่พอตามหลัก FEFO: ${shortages.join(', ')}`);
  const id = nextId(d, 'REQ', ctx.now);
  d.requisitions.unshift({
    id, orderId, recipeId: recipe.id, batches: n, totalKg: recipe.batchKg * n, lines,
    status: 'weighing', note: note || '', requestedBy: ctx.user?.name, createdAt: ctx.now,
  });
  audit(d, ctx, 'ระเบิดสูตรและสร้างใบเบิก', `${id} (${o.id}, ${n} batch)`);
  return id;
}

export function weighLine(d, { reqId, index, actualKg }, ctx) {
  const r = find(d.requisitions, reqId, 'ใบเบิก');
  if (r.status !== 'weighing') fail('ใบเบิกนี้ชั่งครบแล้ว');
  const line = r.lines[index] || fail('ไม่พบรายการชั่ง');
  const kg = num(actualKg, 'น้ำหนักที่ชั่งได้');
  const tol = weighTolerance(line.targetKg);
  if (Math.abs(kg - line.targetKg) > tol + 1e-9) fail(`น้ำหนักอยู่นอกเกณฑ์ ±${tol.toFixed(3)} kg ระบบไม่ให้บันทึก`);
  const lot = d.materialLots.find((l) => l.lotNo === line.lotNo);
  if (!lot || lotState(lot, ctx.now) !== 'available') fail(`ล็อต ${line.lotNo} ใช้ไม่ได้แล้ว (หมดอายุ/กักกัน/หมด)`);
  if (lot.qtyKg < kg) fail(`ล็อต ${line.lotNo} คงเหลือไม่พอ`);
  line.actualKg = kg;
  line.weighedAt = ctx.now;
  line.weighedBy = ctx.user?.name;
  if (r.lines.every((l) => l.actualKg !== null)) {
    r.lines.forEach((l) => {
      const ml = d.materialLots.find((x) => x.lotNo === l.lotNo);
      ml.qtyKg = Math.max(0, ml.qtyKg - l.actualKg);
    });
    r.status = 'issued';
    r.issuedAt = ctx.now;
    r.issuedBy = ctx.user?.name;
    audit(d, ctx, 'จ่ายวัตถุดิบครบ', r.id);
  }
}

export function receiveMaterial(d, p, ctx) {
  const m = d.materials.find((x) => x.code === p.materialCode) || fail('กรุณาเลือกวัตถุดิบ');
  const qty = num(p.qtyKg, 'ปริมาณรับเข้า');
  if (qty <= 0) fail('ปริมาณต้องมากกว่า 0');
  if (!p.expiry || p.expiry <= ctx.now) fail('วันหมดอายุต้องเป็นวันในอนาคต');
  const lotNo = nextId(d, `RM-${m.code}`, ctx.now);
  d.materialLots.push({
    lotNo, materialCode: m.code, qtyKg: qty, initialKg: qty, expiry: p.expiry, receivedAt: ctx.now,
    supplier: p.supplier || '-', location: p.location || m.storage, status: 'available', coa: !!p.coa,
  });
  audit(d, ctx, 'รับวัตถุดิบเข้าคลัง', `${lotNo} ${qty} kg`);
  return lotNo;
}

export function setMaterialLotStatus(d, { lotNo, status }, ctx) {
  const l = d.materialLots.find((x) => x.lotNo === lotNo) || fail('ไม่พบล็อต');
  l.status = status;
  audit(d, ctx, status === 'hold' ? 'กักกันล็อตวัตถุดิบ' : 'ปลดกักกันล็อตวัตถุดิบ', lotNo);
}

// ---------- Stage records ----------

function newLot(d, stage, prefix, base, ctx) {
  const id = nextId(d, prefix, ctx.now);
  const lot = {
    id, stage, transferredQty: 0, createdAt: ctx.now, operator: ctx.user?.name, ...base,
  };
  d.lots.unshift(lot);
  return lot;
}

function takeFromTransfer(d, transferId, stage, qty) {
  const t = find(d.transfers, transferId, 'ใบส่งมอบ');
  if (t.to !== stage) fail('ใบส่งมอบนี้ไม่ได้ส่งมาที่สถานีนี้');
  if (t.status !== 'received') fail('Gatekeeper: ต้องกดรับมอบงานก่อนจึงจะเริ่มผลิตได้');
  if (qty <= 0) fail('ปริมาณที่ใช้ต้องมากกว่า 0');
  if (qty > t.remaining + 1e-9) fail(`ปริมาณเกินที่รับมา (คงเหลือ ${t.remaining})`);
  t.remaining = +(t.remaining - qty).toFixed(3);
  return t;
}

export function recordMixing(d, p, ctx) {
  const r = find(d.requisitions, p.reqId, 'ใบเบิก');
  if (r.status !== 'issued') fail('ใบเบิกยังจ่ายวัตถุดิบไม่ครบ หรือถูกใช้ไปแล้ว');
  const recipe = find(d.recipes, r.recipeId, 'สูตร');
  const dumpTemp = num(p.dumpTemp, 'อุณหภูมิปล่อยยาง');
  const mixSec = num(p.mixSec, 'เวลาผสม');
  const outputKg = num(p.outputKg, 'น้ำหนักยางที่ได้');
  const scrapKg = Number(p.scrapKg) || 0;
  const issued = r.lines.reduce((s, l) => s + l.actualKg, 0);
  if (outputKg + scrapKg > issued + 0.5) fail(`น้ำหนักยางรวมเกินวัตถุดิบที่จ่าย (${issued.toFixed(2)} kg)`);
  const reasons = [];
  if (Math.abs(dumpTemp - recipe.dumpTemp) > recipe.dumpTol) reasons.push(`Dump temp ${dumpTemp}°C นอกช่วง ${recipe.dumpTemp}±${recipe.dumpTol}`);
  const lot = newLot(d, 'mixing', 'MX', {
    orderId: r.orderId, recipeId: recipe.id, uom: 'kg', machine: p.machine, shift: p.shift,
    sources: [{ type: 'requisition', id: r.id }],
    params: { dumpTemp, mixSec, batches: r.batches },
    goodQty: outputKg, scrapQty: scrapKg, scrapReason: p.scrapReason || '',
    qc: reasons.length ? 'hold' : 'pass', holdReasons: reasons,
    readyAt: ctx.now + recipe.restHours * HOUR,
  }, ctx);
  r.status = 'consumed';
  r.consumedBy = lot.id;
  startOrderIfReleased(d, r.orderId, ctx);
  audit(d, ctx, 'บันทึกการผสม', `${lot.id} ${outputKg} kg${reasons.length ? ' (QC Hold อัตโนมัติ)' : ''}`);
  return lot.id;
}

export function endRest(d, { lotId }, ctx) {
  const l = find(d.lots, lotId, 'ล็อต');
  l.readyAt = ctx.now;
  audit(d, ctx, 'ข้ามเวลาบ่ม (โหมดสาธิต)', lotId);
}

export function recordExtrusion(d, p, ctx) {
  const useKg = num(p.useKg, 'น้ำหนักยางที่ใช้');
  const reworkKg = Number(p.reworkKg) || 0;
  const pct = (reworkKg / (useKg + reworkKg)) * 100;
  if (pct > SPECS.extrusion.reworkMaxPct) fail(`สัดส่วนยางหมุนเวียน ${pct.toFixed(1)}% เกิน ${SPECS.extrusion.reworkMaxPct}%`);
  const t = takeFromTransfer(d, p.transferId, 'extrusion', useKg);
  const die = find(d.molds, p.dieId, 'หัวดาย');
  const params = {
    thickness: num(p.thickness, 'ความหนา'),
    width: num(p.width, 'ความกว้าง'),
    weightPerM: num(p.weightPerM, 'น้ำหนักต่อเมตร'),
    reworkKg, reworkPct: +pct.toFixed(2), useKg,
  };
  const good = num(p.goodQty, 'ปริมาณงานดี');
  const reasons = ['thickness', 'width', 'weightPerM']
    .filter((k) => !inSpec(params[k], SPECS.extrusion[k]))
    .map((k) => `${SPECS.extrusion[k].label} ${params[k]} ${SPECS.extrusion[k].unit} นอกสเปก`);
  const order = d.orders.find((o) => o.id === t.orderId);
  const lot = newLot(d, 'extrusion', 'EX', {
    orderId: t.orderId, uom: order?.uom || 'm', machine: p.machine, shift: p.shift, dieId: die.id,
    sources: [{ type: 'transfer', id: t.id, lotId: t.lotId, qty: useKg }],
    params, goodQty: good, scrapQty: Number(p.scrapQty) || 0, scrapReason: p.scrapReason || '',
    qc: reasons.length ? 'hold' : 'pass', holdReasons: reasons,
  }, ctx);
  die.usageSinceClean += good;
  die.totalUsage += good;
  audit(d, ctx, 'บันทึกการฉีด', `${lot.id} ${good} ${lot.uom}${reasons.length ? ' (QC Hold อัตโนมัติ)' : ''}`);
  return lot.id;
}

export function recordCuring(d, p, ctx) {
  const useQty = num(p.useQty, 'ปริมาณที่นำเข้าอบ');
  const t = takeFromTransfer(d, p.transferId, 'curing', useQty);
  const mold = find(d.molds, p.moldId, 'แม่พิมพ์/สายอบ');
  const params = { temp: num(p.temp, 'อุณหภูมิ'), time: num(p.time, 'เวลาอบ'), pressure: num(p.pressure, 'ความดัน') };
  const good = num(p.goodQty, 'ปริมาณงานดี');
  const scrap = Number(p.scrapQty) || 0;
  if (good + scrap > useQty + 1e-9) fail('งานดี + ของเสีย ต้องไม่เกินปริมาณที่นำเข้าอบ');
  const reasons = ['temp', 'time', 'pressure']
    .filter((k) => !inSpec(params[k], SPECS.curing[k]))
    .map((k) => `${SPECS.curing[k].label} ${params[k]} ${SPECS.curing[k].unit} นอกสเปก`);
  const order = d.orders.find((o) => o.id === t.orderId);
  const lot = newLot(d, 'curing', 'CU', {
    orderId: t.orderId, uom: order?.uom || 'm', shift: p.shift, moldId: mold.id, machine: mold.name,
    sources: [{ type: 'transfer', id: t.id, lotId: t.lotId, qty: useQty }],
    params, goodQty: good, scrapQty: scrap, scrapReason: p.scrapReason || '',
    qc: reasons.length ? 'hold' : 'pass', holdReasons: reasons,
  }, ctx);
  const shots = Math.ceil((good + scrap) / (mold.perCycle || 1));
  mold.usageSinceClean += shots;
  mold.totalUsage += shots;
  audit(d, ctx, 'บันทึกการอบ', `${lot.id} ${good} ${lot.uom}${reasons.length ? ' (QC Hold อัตโนมัติ)' : ''}`);
  return lot.id;
}

export function recordFinishing(d, p, ctx) {
  const useQty = num(p.useQty, 'ปริมาณที่รับเข้าตกแต่ง');
  const t = takeFromTransfer(d, p.transferId, 'finishing', useQty);
  const passed = num(p.passedQty, 'จำนวนผ่าน QC');
  const scrap = Number(p.scrapQty) || 0;
  const perBox = num(p.perBox, 'จำนวนต่อกล่อง');
  if (perBox <= 0) fail('จำนวนต่อกล่องต้องมากกว่า 0');
  if (passed + scrap > useQty + 1e-9) fail('งานผ่าน + ของเสีย ต้องไม่เกินปริมาณที่รับเข้า');
  const order = find(d.orders, t.orderId, 'ใบสั่งผลิต');
  const result = p.qcResult || 'pass';
  const lot = newLot(d, 'finishing', 'FN', {
    orderId: t.orderId, uom: order.uom, shift: p.shift, grade: p.grade || 'A',
    sources: [{ type: 'transfer', id: t.id, lotId: t.lotId, qty: useQty }],
    params: { perBox }, goodQty: passed, scrapQty: scrap, scrapReason: p.scrapReason || '',
    qc: result, holdReasons: result === 'pass' ? [] : ['ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน'],
  }, ctx);
  let left = passed;
  let i = 0;
  while (left > 1e-9) {
    const qty = Math.min(perBox, left);
    i += 1;
    d.fgBoxes.unshift({
      id: `${lot.id.replace('FN', 'BOX')}-${String(i).padStart(3, '0')}`, lotId: lot.id, orderId: order.id,
      productName: order.productName, qty: +qty.toFixed(3), uom: order.uom, grade: lot.grade,
      status: result === 'pass' ? 'in_stock' : 'hold', createdAt: ctx.now,
    });
    left -= qty;
  }
  lot.boxes = i;
  lot.countedToOrder = result === 'pass';
  if (result === 'pass') addProduced(d, order.id, passed, ctx);
  audit(d, ctx, 'บันทึกการตกแต่ง/บรรจุ', `${lot.id} ${passed} ${order.uom} → ${i} กล่อง`);
  return lot.id;
}

function addProduced(d, orderId, qty, ctx) {
  const order = d.orders.find((o) => o.id === orderId);
  if (!order) return;
  order.producedQty = +(order.producedQty + qty).toFixed(3);
  if (order.producedQty >= order.targetQty && order.status === 'in_progress') {
    order.status = 'completed';
    audit(d, ctx, 'ปิดใบสั่งผลิต (ครบจำนวน)', order.id);
  }
}

export function shipBoxes(d, { ids }, ctx) {
  ids.forEach((id) => {
    const b = find(d.fgBoxes, id, 'กล่อง');
    if (b.status !== 'in_stock') fail(`กล่อง ${id} ไม่พร้อมส่ง`);
    b.status = 'shipped';
    b.shippedAt = ctx.now;
  });
  audit(d, ctx, 'ส่งมอบสินค้า', `${ids.length} กล่อง`);
}

// ---------- WIP transfer (gatekeeper) ----------

export function transferableQty(lot, now) {
  if (lot.qc !== 'pass') return 0;
  if (lot.stage === 'mixing' && lot.readyAt > now) return 0;
  if (!NEXT_STAGE[lot.stage]) return 0;
  return Math.max(0, +(lot.goodQty - lot.transferredQty).toFixed(3));
}

export function createTransfer(d, { lotId, qty, note }, ctx) {
  const lot = find(d.lots, lotId, 'ล็อต');
  if (!NEXT_STAGE[lot.stage]) fail('ล็อตนี้เป็นขั้นตอนสุดท้ายแล้ว');
  if (lot.qc !== 'pass') fail('Gatekeeper: ล็อตยังไม่ผ่าน QC ส่งต่อไม่ได้');
  if (lot.stage === 'mixing' && lot.readyAt > ctx.now) fail('Gatekeeper: ยางยังบ่มไม่ครบเวลา');
  const q = num(qty, 'ปริมาณส่งมอบ');
  const avail = transferableQty(lot, ctx.now);
  if (q <= 0 || q > avail + 1e-9) fail(`ปริมาณส่งมอบต้องอยู่ระหว่าง 0–${avail}`);
  lot.transferredQty = +(lot.transferredQty + q).toFixed(3);
  const id = nextId(d, 'TR', ctx.now);
  d.transfers.unshift({
    id, lotId, orderId: lot.orderId, from: lot.stage, to: NEXT_STAGE[lot.stage], uom: lot.uom,
    qtySent: q, qtyReceived: null, remaining: 0, condition: null, note: note || '',
    status: 'in_transit', createdAt: ctx.now, createdBy: ctx.user?.name,
  });
  audit(d, ctx, 'ส่งมอบ WIP', `${id} ${lotId} ${q} ${lot.uom}`);
  return id;
}

export function receiveTransfer(d, { id, qtyReceived, condition }, ctx) {
  const t = find(d.transfers, id, 'ใบส่งมอบ');
  if (t.status !== 'in_transit') fail('ใบส่งมอบนี้รับไปแล้ว');
  const q = num(qtyReceived, 'จำนวนที่รับจริง');
  if (q < 0 || q > t.qtySent * 1.02) fail('จำนวนรับจริงต้องไม่เกินจำนวนที่ส่ง (+2%)');
  t.qtyReceived = q;
  t.remaining = q;
  t.condition = condition || 'ok';
  t.status = 'received';
  t.receivedAt = ctx.now;
  t.receivedBy = ctx.user?.name;
  audit(d, ctx, 'รับมอบ WIP', `${id} รับ ${q}/${t.qtySent} ${t.uom}`);
}

// ---------- Quality ----------

export function addQcRecord(d, p, ctx) {
  const lot = find(d.lots, p.lotId, 'ล็อต');
  const tests = Object.entries(SPECS.lab)
    .filter(([k]) => p.values[k] !== '' && p.values[k] !== undefined)
    .map(([k, spec]) => ({ key: k, value: Number(p.values[k]), pass: inSpec(p.values[k], spec) }));
  if (!tests.length) fail('กรุณากรอกผลทดสอบอย่างน้อย 1 รายการ');
  const allPass = tests.every((t) => t.pass);
  const result = p.result || (allPass ? 'pass' : 'hold');
  if (result === 'pass' && !allPass) fail('มีค่าทดสอบนอกสเปก ตัดสินเป็น "ผ่าน" ไม่ได้');
  const id = nextId(d, 'QC', ctx.now);
  d.qcRecords.unshift({ id, lotId: lot.id, orderId: lot.orderId, stage: lot.stage, tests, result, note: p.note || '', inspector: ctx.user?.name, at: ctx.now });
  lot.qc = result;
  if (result === 'pass') lot.holdReasons = [];
  d.fgBoxes.filter((b) => b.lotId === lot.id && b.status !== 'shipped').forEach((b) => {
    b.status = result === 'pass' ? 'in_stock' : 'hold';
  });
  if (lot.stage === 'finishing' && result === 'pass' && !lot.countedToOrder) {
    // A finishing lot that was held only counts toward its order once it passes.
    lot.countedToOrder = true;
    addProduced(d, lot.orderId, lot.goodQty, ctx);
  }
  audit(d, ctx, 'บันทึกผล QC', `${id} ${lot.id} → ${result}`);
  return id;
}

export function createNcr(d, p, ctx) {
  if (!p.title?.trim()) fail('กรุณาระบุหัวข้อปัญหา');
  if (!p.lotId?.trim()) fail('กรุณาระบุล็อตที่พบปัญหา');
  const id = nextId(d, 'NCR', ctx.now);
  const lot = d.lots.find((l) => l.id === p.lotId.trim());
  if (lot && lot.qc === 'pass') {
    lot.qc = 'hold';
    lot.holdReasons = [...(lot.holdReasons || []), `เปิด ${id}`];
  }
  d.ncrs.unshift({
    id, title: p.title.trim(), stage: p.stage, lotId: p.lotId.trim(), severity: p.severity || 'major',
    defectQty: Number(p.defectQty) || 0, whys: (p.whys || []).filter(Boolean), containment: p.containment || '',
    corrective: p.corrective || '', preventive: p.preventive || '', owner: p.owner || ctx.user?.name,
    status: 'open', createdAt: ctx.now, createdBy: ctx.user?.name,
  });
  audit(d, ctx, 'เปิด NCR', `${id} ${p.title}`);
  return id;
}

export function closeNcr(d, { id, verification }, ctx) {
  const n = find(d.ncrs, id, 'NCR');
  if (!n.corrective?.trim()) fail('ต้องมีการแก้ไข (Corrective action) ก่อนปิดเคส');
  n.status = 'closed';
  n.closedAt = ctx.now;
  n.closedBy = ctx.user?.name;
  n.verification = verification || '';
  audit(d, ctx, 'ปิด NCR', id);
}

// ---------- Molds & dies ----------

export function cleanMold(d, { id }, ctx) {
  const m = find(d.molds, id, 'แม่พิมพ์');
  m.usageSinceClean = 0;
  m.lastCleanAt = ctx.now;
  audit(d, ctx, 'บันทึกทำความสะอาดแม่พิมพ์/หัวดาย', id);
}
