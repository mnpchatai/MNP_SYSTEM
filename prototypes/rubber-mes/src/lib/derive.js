// Read-only views derived from state: alerts, lookups and traceability graph.

import { DAY, lotState, STAGE_LABEL } from './rules.js';
import { fmtDate, fmtDuration } from './format.js';

export function buildAlerts(d, now) {
  const alerts = [];
  d.materialLots.forEach((l) => {
    const st = lotState(l, now);
    const mat = d.materials.find((m) => m.code === l.materialCode);
    if (st === 'expired' && l.qtyKg > 0) alerts.push({ tone: 'bad', module: 'warehouse', title: `ล็อตหมดอายุ ${l.lotNo}`, text: `${mat?.name} คงเหลือ ${l.qtyKg.toFixed(1)} kg ถูกบล็อกการเบิกแล้ว` });
    else if (st === 'available' && l.expiry - now < 30 * DAY) alerts.push({ tone: 'warn', module: 'warehouse', title: `ใกล้หมดอายุ ${l.lotNo}`, text: `${mat?.name} หมดอายุ ${fmtDate(l.expiry)} ระบบจะจ่ายล็อตนี้ก่อน (FEFO)` });
  });
  d.molds.forEach((m) => {
    const pct = m.usageSinceClean / m.cleanEvery;
    if (pct >= 0.85) alerts.push({ tone: pct >= 1 ? 'bad' : 'warn', module: 'molds', title: `ถึงรอบล้าง ${m.id}`, text: `${m.name} ใช้ไป ${Math.round(pct * 100)}% ของรอบทำความสะอาด` });
  });
  d.lots.filter((l) => l.qc === 'hold').forEach((l) => alerts.push({ tone: 'warn', module: 'quality', title: `QC Hold ${l.id}`, text: (l.holdReasons || []).join(', ') || 'รอผลตัดสินจาก QC' }));
  d.lots.filter((l) => l.stage === 'mixing' && l.readyAt > now).forEach((l) => alerts.push({ tone: 'info', module: 'mixing', title: `กำลังบ่มยาง ${l.id}`, text: `เหลืออีก ${fmtDuration(l.readyAt - now)} จึงส่งต่อไปรีดได้` }));
  d.transfers.filter((t) => t.status === 'in_transit').forEach((t) => alerts.push({ tone: 'info', module: 'wip', title: `รอรับมอบ ${t.id}`, text: `${STAGE_LABEL[t.from]} → ${STAGE_LABEL[t.to]} ${t.qtySent} ${t.uom}` }));
  d.orders.filter((o) => ['released', 'in_progress', 'on_hold'].includes(o.status) && o.dueDate - now < 3 * DAY).forEach((o) => alerts.push({ tone: o.dueDate < now ? 'bad' : 'warn', module: 'orders', title: `ใกล้กำหนดส่ง ${o.id}`, text: `${o.customer} ส่ง ${fmtDate(o.dueDate)} ผลิตแล้ว ${Math.round((o.producedQty / o.targetQty) * 100)}%` }));
  d.ncrs.filter((n) => n.status === 'open').forEach((n) => alerts.push({ tone: n.severity === 'critical' ? 'bad' : 'warn', module: 'quality', title: `NCR เปิดอยู่ ${n.id}`, text: n.title }));
  const rank = { bad: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

// Identify what a scanned / typed code refers to.
export function lookupCode(d, raw) {
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  const o = d.orders.find((x) => x.id === code);
  if (o) return { kind: 'order', item: o };
  const lot = d.lots.find((x) => x.id === code);
  if (lot) return { kind: 'lot', item: lot };
  const box = d.fgBoxes.find((x) => x.id === code);
  if (box) return { kind: 'box', item: box };
  const ml = d.materialLots.find((x) => x.lotNo.toUpperCase() === code);
  if (ml) return { kind: 'material', item: ml };
  const req = d.requisitions.find((x) => x.id === code);
  if (req) return { kind: 'requisition', item: req };
  const tr = d.transfers.find((x) => x.id === code);
  if (tr) return { kind: 'transfer', item: tr };
  const mold = d.molds.find((x) => x.id === code);
  if (mold) return { kind: 'mold', item: mold };
  return null;
}

// Parent lot ids (one step upstream) of a WIP lot.
export function parentLotIds(d, lot) {
  return (lot.sources || []).filter((s) => s.lotId).map((s) => s.lotId);
}

export function childLots(d, lotId) {
  return d.lots.filter((l) => (l.sources || []).some((s) => s.lotId === lotId));
}

// Backward genealogy tree: from a lot down to the raw-material lots it consumed.
export function backwardTree(d, lotId, depth = 0) {
  const lot = d.lots.find((l) => l.id === lotId);
  if (!lot || depth > 6) return null;
  const children = parentLotIds(d, lot).map((id) => backwardTree(d, id, depth + 1)).filter(Boolean);
  if (lot.stage === 'mixing') {
    const reqId = lot.sources.find((s) => s.type === 'requisition')?.id;
    const req = d.requisitions.find((r) => r.id === reqId);
    if (req) {
      children.push({
        kind: 'requisition', id: req.id, item: req,
        children: req.lines.map((l) => ({ kind: 'material', id: l.lotNo, item: d.materialLots.find((m) => m.lotNo === l.lotNo), kg: l.actualKg, children: [] })),
      });
    }
  }
  return { kind: 'lot', id: lot.id, item: lot, children };
}

// Forward genealogy: every downstream lot and box that used this lot or material lot.
export function forwardTree(d, start) {
  const fromLot = (lot, depth) => {
    if (depth > 6) return null;
    const children = childLots(d, lot.id).map((c) => fromLot(c, depth + 1)).filter(Boolean);
    d.fgBoxes.filter((b) => b.lotId === lot.id).forEach((b) => children.push({ kind: 'box', id: b.id, item: b, children: [] }));
    return { kind: 'lot', id: lot.id, item: lot, children };
  };
  if (start.kind === 'material') {
    const reqs = d.requisitions.filter((r) => r.lines.some((l) => l.lotNo === start.item.lotNo));
    return {
      kind: 'material', id: start.item.lotNo, item: start.item,
      children: reqs.map((r) => {
        const mx = d.lots.find((l) => l.stage === 'mixing' && l.sources.some((s) => s.id === r.id));
        return { kind: 'requisition', id: r.id, item: r, children: mx ? [fromLot(mx, 0)] : [] };
      }),
    };
  }
  return fromLot(start.item, 0);
}
