import { useState } from 'react';
import { Lock, Printer, Timer, Truck } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { can } from '../data/rbac.js';
import { transferableQty } from '../data/actions.js';
import { NEXT_STAGE, STAGE_LABEL } from '../lib/rules.js';
import { fmtDateTime, fmtDuration, fmtNum } from '../lib/format.js';
import { Button, Callout, Card, Field, Input, Modal, Status } from './ui.jsx';

export function stageYield(lots) {
  const good = lots.reduce((s, l) => s + l.goodQty, 0);
  const scrap = lots.reduce((s, l) => s + l.scrapQty, 0);
  return good + scrap ? (good / (good + scrap)) * 100 : 100;
}

// Received WIP waiting at a station, which the gatekeeper allows to be consumed.
export function useInbound(stage) {
  const { data } = useStore();
  const ready = data.transfers.filter((t) => t.to === stage && t.status === 'received' && t.remaining > 0.0001);
  const waiting = data.transfers.filter((t) => t.to === stage && t.status === 'in_transit');
  return { ready, waiting };
}

export function GateNotice({ stage }) {
  const { ready, waiting } = useInbound(stage);
  const nav = useNav();
  if (ready.length) return null;
  return (
    <Callout tone="warn" icon={Lock}>
      <b>Gatekeeper:</b> ยังไม่มีงานที่รับมอบเข้าสถานี{STAGE_LABEL[stage]} จึงยังเริ่มบันทึกการผลิตไม่ได้
      {waiting.length > 0 && <> · มี {waiting.length} ใบส่งมอบรอรับ <button type="button" className="btn sm" onClick={() => nav.go('wip')}>ไปหน้ารับมอบ</button></>}
    </Callout>
  );
}

export function StageLots({ stage, columns }) {
  const { data, now, user, run } = useStore();
  const nav = useNav();
  const [transfer, setTransfer] = useState(null);
  const lots = data.lots.filter((l) => l.stage === stage).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Card title={`ล็อตที่บันทึกแล้ว (${lots.length})`} flush>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ล็อต</th><th>ใบสั่งผลิต</th>{columns.map((c) => <th key={c.label}>{c.label}</th>)}<th className="right">งานดี / เสีย</th><th>QC</th><th className="right">จัดการ</th></tr></thead>
          <tbody>
            {lots.map((l) => {
              const avail = transferableQty(l, now);
              const resting = stage === 'mixing' && l.readyAt > now;
              return (
                <tr key={l.id}>
                  <td><span className="mono">{l.id}</span><div className="small muted">{fmtDateTime(l.createdAt)} · {l.operator}</div></td>
                  <td className="mono small">{l.orderId}</td>
                  {columns.map((c) => <td key={c.label} className="small">{c.render(l)}</td>)}
                  <td className="right nowrap">{fmtNum(l.goodQty, 2)} / <span className="muted">{fmtNum(l.scrapQty, 2)}</span> {l.uom}</td>
                  <td>
                    <Status value={l.qc} />
                    {l.holdReasons?.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{l.holdReasons.join(', ')}</div>}
                    {resting && <div className="small muted row"><Timer size={12} /> บ่มอีก {fmtDuration(l.readyAt - now)}</div>}
                  </td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" icon={Printer} onClick={() => nav.printTag('lot', l.id)} aria-label="พิมพ์ป้าย" />
                      {resting && can(user, 'demoSkip') && <Button size="sm" onClick={() => run('endRest', { lotId: l.id }, 'ข้ามเวลาบ่มแล้ว')}>ข้ามเวลาบ่ม</Button>}
                      {NEXT_STAGE[stage] && avail > 0 && <Button size="sm" variant="primary" icon={Truck} onClick={() => setTransfer(l)}>ส่งต่อ</Button>}
                      {NEXT_STAGE[stage] && avail === 0 && l.transferredQty >= l.goodQty - 1e-6 && <span className="small muted">ส่งต่อครบแล้ว</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {transfer && <TransferModal lot={transfer} onClose={() => setTransfer(null)} />}
    </Card>
  );
}

export function TransferModal({ lot, onClose }) {
  const { run, now } = useStore();
  const avail = transferableQty(lot, now);
  const [qty, setQty] = useState(String(avail));
  const [note, setNote] = useState('');
  const submit = () => { if (run('createTransfer', { lotId: lot.id, qty, note }, (id) => `สร้างใบส่งมอบ ${id} แล้ว`)) onClose(); };
  return (
    <Modal title={`ส่งมอบ WIP · ${lot.id}`} onClose={onClose} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" onClick={submit}>สร้างใบส่งมอบ</Button></>}>
      <div className="stack">
        <Callout tone="info">{STAGE_LABEL[lot.stage]} → {STAGE_LABEL[NEXT_STAGE[lot.stage]]} · สถานีปลายทางต้องกดรับมอบและยืนยันจำนวนจริงก่อนจึงจะเริ่มผลิตได้</Callout>
        <div className="grid g2">
          <Field label={`จำนวนส่งมอบ (${lot.uom})`} hint={`ส่งได้สูงสุด ${avail}`}><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="หมายเหตุ / Pallet ID"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

export function InboundSelect({ stage, value, onChange }) {
  const { ready } = useInbound(stage);
  return (
    <Field label="งานที่รับมอบแล้ว (ต้นทาง) *">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">เลือกใบส่งมอบ…</option>
        {ready.map((t) => <option key={t.id} value={t.id}>{t.lotId} · คงเหลือ {t.remaining} {t.uom} ({t.orderId})</option>)}
      </select>
    </Field>
  );
}
