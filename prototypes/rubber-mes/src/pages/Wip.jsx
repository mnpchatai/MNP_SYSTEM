import { useState } from 'react';
import { ArrowRight, PackageOpen, Printer, Truck } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { transferableQty } from '../data/actions.js';
import { NEXT_STAGE, STAGE_LABEL } from '../lib/rules.js';
import { fmtDateTime, fmtNum } from '../lib/format.js';
import { Button, Callout, Card, Field, Input, Modal, PageHead, Select, Status, Tabs } from '../components/ui.jsx';
import { TransferModal } from '../components/StageCommon.jsx';

export default function Wip() {
  const { data, now } = useStore();
  const nav = useNav();
  const [tab, setTab] = useState('in_transit');
  const [q, setQ] = useState(nav.param || '');
  const [receiving, setReceiving] = useState(null);
  const [sending, setSending] = useState(null);

  const rows = [...data.transfers]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((t) => tab === 'all' || t.status === tab)
    .filter((t) => !q || `${t.id} ${t.lotId} ${t.orderId}`.toLowerCase().includes(q.toLowerCase()));
  const sendable = data.lots.filter((l) => transferableQty(l, now) > 0).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <>
      <PageHead title="ส่งมอบงานระหว่างผลิต (WIP)" desc="กฎ Gatekeeper: สถานีถัดไปเริ่มผลิตได้ก็ต่อเมื่อสแกนรับมอบและยืนยันจำนวนจริงแล้ว" />
      <div className="flow">
        {['mixing', 'extrusion', 'curing', 'finishing'].map((s) => {
          const inT = data.transfers.filter((t) => t.to === s && t.status === 'in_transit');
          const avail = data.transfers.filter((t) => t.to === s && t.status === 'received' && t.remaining > 0);
          return (
            <div className="step" key={s}>
              <b>{STAGE_LABEL[s]}</b>
              <dl className="kv small" style={{ marginTop: 6 }}>
                <dt>รอรับมอบ</dt><dd>{s === 'mixing' ? '-' : inT.length}</dd>
                <dt>รับแล้วรอใช้</dt><dd>{s === 'mixing' ? `${data.requisitions.filter((r) => r.status === 'issued').length} ใบเบิก` : avail.length}</dd>
                <dt>พร้อมส่งต่อ</dt><dd>{sendable.filter((l) => l.stage === s).length} ล็อต</dd>
              </dl>
            </div>
          );
        })}
      </div>

      {sendable.length > 0 && (
        <Card title={`ล็อตที่พร้อมส่งต่อ (${sendable.length})`} flush>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ล็อต</th><th>เส้นทาง</th><th className="right">ส่งได้</th><th className="right" /></tr></thead>
              <tbody>
                {sendable.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.id}<div className="small muted">{l.orderId}</div></td>
                    <td>{STAGE_LABEL[l.stage]} <ArrowRight size={12} /> {STAGE_LABEL[NEXT_STAGE[l.stage]]}</td>
                    <td className="right">{fmtNum(transferableQty(l, now), 2)} {l.uom}</td>
                    <td className="right"><Button size="sm" variant="primary" icon={Truck} onClick={() => setSending(l)}>สร้างใบส่งมอบ</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card flush>
        <div className="row between" style={{ padding: '10px 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'in_transit', label: `รอรับมอบ (${data.transfers.filter((t) => t.status === 'in_transit').length})` }, { id: 'received', label: 'รับมอบแล้ว' }, { id: 'all', label: 'ทั้งหมด' }]} />
          <div style={{ width: 260 }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาใบส่งมอบ ล็อต ใบสั่งผลิต…" /></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ใบส่งมอบ</th><th>ล็อตต้นทาง</th><th>เส้นทาง</th><th className="right">ส่ง</th><th className="right">รับจริง</th><th className="right">ผลต่าง</th><th>สถานะ</th><th className="right" /></tr></thead>
            <tbody>
              {rows.map((t) => {
                const diff = t.qtyReceived === null ? null : t.qtyReceived - t.qtySent;
                return (
                  <tr key={t.id}>
                    <td className="mono">{t.id}<div className="small muted">{fmtDateTime(t.createdAt)} · {t.createdBy}</div></td>
                    <td className="mono small">{t.lotId}<div className="muted">{t.orderId}</div></td>
                    <td className="small">{STAGE_LABEL[t.from]} → {STAGE_LABEL[t.to]}</td>
                    <td className="right nowrap">{fmtNum(t.qtySent, 2)} {t.uom}</td>
                    <td className="right">{t.qtyReceived === null ? '-' : fmtNum(t.qtyReceived, 2)}</td>
                    <td className="right" style={{ color: diff < 0 ? 'var(--bad)' : undefined }}>{diff === null ? '-' : fmtNum(diff, 2)}</td>
                    <td><Status value={t.status} />{t.condition && t.condition !== 'ok' && <div className="small" style={{ color: 'var(--warn)' }}>{t.condition}</div>}</td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" icon={Printer} onClick={() => nav.printTag('transfer', t.id)} aria-label="พิมพ์ป้าย" />
                        {t.status === 'in_transit' && <Button size="sm" variant="primary" icon={PackageOpen} onClick={() => setReceiving(t)}>รับมอบ</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="empty">ไม่มีใบส่งมอบ</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {receiving && <ReceiveModal t={receiving} onClose={() => setReceiving(null)} />}
      {sending && <TransferModal lot={sending} onClose={() => setSending(null)} />}
    </>
  );
}

function ReceiveModal({ t, onClose }) {
  const { run } = useStore();
  const [qty, setQty] = useState(String(t.qtySent));
  const [condition, setCondition] = useState('ok');
  const diff = Number(qty) - t.qtySent;
  const submit = () => { if (run('receiveTransfer', { id: t.id, qtyReceived: qty, condition }, 'รับมอบงานแล้ว สถานีเริ่มผลิตได้')) onClose(); };
  return (
    <Modal title={`รับมอบงาน · ${t.id}`} onClose={onClose} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" onClick={submit}>ยืนยันรับเข้า</Button></>}>
      <div className="stack">
        <dl className="kv"><dt>ล็อต</dt><dd className="mono">{t.lotId}</dd><dt>เส้นทาง</dt><dd>{STAGE_LABEL[t.from]} → {STAGE_LABEL[t.to]}</dd><dt>จำนวนที่ส่ง</dt><dd>{t.qtySent} {t.uom}</dd></dl>
        <div className="grid g2">
          <Field label={`จำนวนที่ตรวจนับ/ชั่งได้จริง (${t.uom}) *`}><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="สภาพชิ้นงาน / ภาชนะ">
            <Select value={condition} onChange={(e) => setCondition(e.target.value)} options={[{ value: 'ok', label: 'สมบูรณ์' }, { value: 'ภาชนะชำรุด', label: 'ภาชนะชำรุด / ป้ายเลือน' }, { value: 'ปริมาณขาด', label: 'ปริมาณขาดเกินเกณฑ์' }]} />
          </Field>
        </div>
        {Math.abs(diff) > 1e-9 && <Callout tone={diff < 0 ? 'warn' : 'info'}>ผลต่าง {fmtNum(diff, 2)} {t.uom} จะถูกบันทึกในประวัติการส่งมอบ</Callout>}
      </div>
    </Modal>
  );
}
