import { useState } from 'react';
import { AlertTriangle, Ban, Boxes, PackageCheck, Plus, Printer, Truck } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { can } from '../data/rbac.js';
import { DAY, lotState } from '../lib/rules.js';
import { fmtDate, fmtNum, fromInputDate, toInputDate } from '../lib/format.js';
import { Button, Card, Field, Input, Modal, PageHead, Select, Stat, Status, Tabs, useForm } from '../components/ui.jsx';

export default function Warehouse() {
  const { data, now, user, run } = useStore();
  const nav = useNav();
  const [tab, setTab] = useState('raw');
  const [q, setQ] = useState(nav.param || '');
  const [receiving, setReceiving] = useState(false);
  const [picked, setPicked] = useState([]);

  const lots = [...data.materialLots]
    .filter((l) => l.qtyKg > 0.0001 || lotState(l, now) === 'expired')
    .filter((l) => !q || `${l.lotNo} ${l.materialCode}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.materialCode.localeCompare(b.materialCode) || a.expiry - b.expiry);
  const soon = data.materialLots.filter((l) => lotState(l, now) === 'available' && l.expiry - now < 30 * DAY);
  const expired = data.materialLots.filter((l) => lotState(l, now) === 'expired' && l.qtyKg > 0);
  const boxes = [...data.fgBoxes].sort((a, b) => b.createdAt - a.createdAt).filter((b) => !q || `${b.id} ${b.orderId}`.toLowerCase().includes(q.toLowerCase()));
  // The first available lot per material is what FEFO will issue next.
  const nextFefo = new Set();
  data.materials.forEach((m) => {
    const first = data.materialLots.filter((l) => l.materialCode === m.code && lotState(l, now) === 'available').sort((a, b) => a.expiry - b.expiry)[0];
    if (first) nextFefo.add(first.lotNo);
  });
  const ship = () => { if (run('shipBoxes', { ids: picked }, `ส่งมอบ ${picked.length} กล่องแล้ว`)) setPicked([]); };

  return (
    <>
      <PageHead title="คลังวัตถุดิบและสินค้าสำเร็จรูป" desc="ควบคุมสต็อกตามหลัก FEFO บล็อกล็อตหมดอายุหรือถูกกักกัน และจัดการกล่องสินค้าพร้อมส่ง">
        <Button variant="primary" icon={Plus} onClick={() => setReceiving(true)}>รับวัตถุดิบเข้าคลัง</Button>
      </PageHead>
      <div className="grid g4">
        <Stat icon={Boxes} label="สต็อกวัตถุดิบพร้อมใช้" value={`${fmtNum(data.materialLots.filter((l) => lotState(l, now) === 'available').reduce((s, l) => s + l.qtyKg, 0))} kg`} sub={`${data.materialLots.filter((l) => lotState(l, now) === 'available').length} ล็อต`} />
        <Stat icon={AlertTriangle} label="ใกล้หมดอายุ (30 วัน)" value={soon.length} tone={soon.length ? 'warn' : undefined} sub="จะถูกจ่ายก่อนตาม FEFO" />
        <Stat icon={Ban} label="หมดอายุ / ถูกบล็อก" value={expired.length + data.materialLots.filter((l) => l.status === 'hold').length} tone="bad" />
        <Stat icon={PackageCheck} label="สินค้าพร้อมส่ง" value={`${data.fgBoxes.filter((b) => b.status === 'in_stock').length} กล่อง`} />
      </div>
      <Card flush>
        <div className="row between" style={{ padding: '10px 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'raw', label: 'วัตถุดิบ' }, { id: 'fg', label: 'สินค้าสำเร็จรูป' }]} />
          <div className="row">
            {tab === 'fg' && picked.length > 0 && <Button variant="primary" icon={Truck} onClick={ship}>ส่งมอบ {picked.length} กล่อง</Button>}
            <div style={{ width: 240 }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารหัส…" /></div>
          </div>
        </div>
        <div className="table-wrap">
          {tab === 'raw' ? (
            <table>
              <thead><tr><th>ล็อต</th><th>วัตถุดิบ</th><th>ที่เก็บ / ผู้ขาย</th><th>หมดอายุ</th><th className="right">คงเหลือ</th><th>สถานะ</th><th className="right" /></tr></thead>
              <tbody>{lots.map((l) => {
                const m = data.materials.find((x) => x.code === l.materialCode);
                const st = lotState(l, now);
                const days = Math.ceil((l.expiry - now) / DAY);
                return (
                  <tr key={l.lotNo}>
                    <td className="mono small">{l.lotNo}{nextFefo.has(l.lotNo) && <div><span className="badge accent">จ่ายลำดับถัดไป (FEFO)</span></div>}</td>
                    <td>{m?.name}<div className="small muted">{m?.category}</div></td>
                    <td className="small">{l.location}<div className="muted">{l.supplier}{l.coa ? ' · มี CoA' : ''}</div></td>
                    <td className="nowrap">{fmtDate(l.expiry)}<div className="small" style={{ color: days < 0 ? 'var(--bad)' : days < 30 ? 'var(--warn)' : 'var(--muted)' }}>{days < 0 ? `เลยมา ${-days} วัน` : `อีก ${days} วัน`}</div></td>
                    <td className="right">{fmtNum(l.qtyKg, 2)} kg<div className="small muted">จาก {fmtNum(l.initialKg, 0)}</div></td>
                    <td><Status value={st} /></td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" icon={Printer} onClick={() => nav.printTag('material', l.lotNo)} aria-label="พิมพ์ป้าย" />
                        {can(user, 'qcDecision') && st === 'available' && <Button size="sm" onClick={() => run('setMaterialLotStatus', { lotNo: l.lotNo, status: 'hold' }, 'กักกันล็อตแล้ว')}>กักกัน</Button>}
                        {can(user, 'qcDecision') && l.status === 'hold' && <Button size="sm" onClick={() => run('setMaterialLotStatus', { lotNo: l.lotNo, status: 'available' }, 'ปลดกักกันแล้ว')}>ปลดกักกัน</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th /><th>กล่อง</th><th>สินค้า</th><th>ใบสั่งผลิต</th><th className="right">จำนวน</th><th>เกรด</th><th>สถานะ</th><th className="right" /></tr></thead>
              <tbody>{boxes.map((b) => (
                <tr key={b.id}>
                  <td><input type="checkbox" disabled={b.status !== 'in_stock'} checked={picked.includes(b.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))} aria-label={`เลือก ${b.id}`} /></td>
                  <td className="mono small">{b.id}<div className="muted">{fmtDate(b.createdAt)}</div></td>
                  <td>{b.productName}</td>
                  <td className="mono small">{b.orderId}</td>
                  <td className="right">{fmtNum(b.qty)} {b.uom}</td>
                  <td>{b.grade}</td>
                  <td><Status value={b.status} /></td>
                  <td className="right"><Button size="sm" icon={Printer} onClick={() => nav.printTag('box', b.id)} aria-label="พิมพ์ป้าย" /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </Card>
      {receiving && <ReceiveMaterial onClose={() => setReceiving(false)} />}
    </>
  );
}

function ReceiveMaterial({ onClose }) {
  const { data, run } = useStore();
  const [f, set] = useForm({ materialCode: data.materials[0].code, qtyKg: '', expiry: toInputDate(Date.now() + 180 * DAY), supplier: '', location: '', coa: 'yes' });
  const m = data.materials.find((x) => x.code === f.materialCode);
  const submit = () => {
    if (run('receiveMaterial', { ...f, expiry: fromInputDate(f.expiry), coa: f.coa === 'yes', location: f.location || m.storage }, (id) => `รับเข้าล็อต ${id} แล้ว`)) onClose();
  };
  return (
    <Modal title="รับวัตถุดิบเข้าคลัง" onClose={onClose} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" onClick={submit}>รับเข้าและสร้างล็อต</Button></>}>
      <div className="grid g2">
        <Field label="วัตถุดิบ *"><Select value={f.materialCode} onChange={set('materialCode')} options={data.materials.map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }))} /></Field>
        <Field label="ปริมาณ (kg) *"><Input type="number" value={f.qtyKg} onChange={set('qtyKg')} /></Field>
        <Field label="วันหมดอายุ *"><Input type="date" value={f.expiry} onChange={set('expiry')} /></Field>
        <Field label="ผู้ขาย"><Input value={f.supplier} onChange={set('supplier')} /></Field>
        <Field label="ตำแหน่งจัดเก็บ" hint={`ค่าเริ่มต้น: ${m?.storage}`}><Input value={f.location} onChange={set('location')} /></Field>
        <Field label="เอกสาร CoA จากผู้ขาย"><Select value={f.coa} onChange={set('coa')} options={[{ value: 'yes', label: 'มี' }, { value: 'no', label: 'ไม่มี' }]} /></Field>
      </div>
    </Modal>
  );
}
