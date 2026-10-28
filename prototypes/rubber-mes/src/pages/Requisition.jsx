import { useState } from 'react';
import { CheckCircle2, Plus, Printer, Scale, ShieldAlert } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { allocateFefo, recipeLines, weighTolerance } from '../lib/rules.js';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format.js';
import { Badge, Button, Callout, Card, Empty, Field, Input, Modal, PageHead, Select, Status } from '../components/ui.jsx';

export default function Requisition() {
  const { data } = useStore();
  const nav = useNav();
  const list = [...data.requisitions].sort((a, b) => b.createdAt - a.createdAt);
  const [selId, setSelId] = useState(nav.param || list.find((r) => r.status === 'weighing')?.id || list[0]?.id);
  const [creating, setCreating] = useState(false);
  const sel = data.requisitions.find((r) => r.id === selId);

  return (
    <>
      <PageHead title="เบิกและชั่งวัตถุดิบ" desc="ระเบิดสูตรเป็นรายการเบิก จัดสรรล็อตตามหลัก FEFO บล็อกล็อตหมดอายุ และบังคับชั่งให้อยู่ในเกณฑ์ (Poka-Yoke)">
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>สร้างใบเบิก</Button>
      </PageHead>
      <div className="split">
        <Card title={`ใบเบิก (${list.length})`} flush>
          <div style={{ maxHeight: 640, overflowY: 'auto' }}>
            {list.map((r) => {
              const done = r.lines.filter((l) => l.actualKg !== null).length;
              return (
                <div key={r.id} className={`list-item ${r.id === selId ? 'sel' : ''}`} onClick={() => setSelId(r.id)}>
                  <div className="row between"><b className="mono">{r.id}</b><Status value={r.status} /></div>
                  <div className="small muted">{r.orderId} · {r.batches} batch · {fmtNum(r.totalKg, 1)} kg · ชั่งแล้ว {done}/{r.lines.length}</div>
                </div>
              );
            })}
          </div>
        </Card>
        {sel ? <Detail req={sel} /> : <Card><Empty>ยังไม่มีใบเบิก</Empty></Card>}
      </div>
      {creating && <CreateRequisition onClose={(id) => { setCreating(false); if (id) setSelId(id); }} />}
    </>
  );
}

function Detail({ req }) {
  const { data } = useStore();
  const nav = useNav();
  const order = data.orders.find((o) => o.id === req.orderId);
  const recipe = data.recipes.find((r) => r.id === req.recipeId);
  const nextIdx = req.lines.findIndex((l) => l.actualKg === null);
  return (
    <div className="stack">
      {req.status === 'weighing' && nextIdx >= 0 && <WeighStation req={req} index={nextIdx} />}
      {req.status === 'issued' && <Callout tone="good" icon={CheckCircle2}>จ่ายวัตถุดิบครบแล้ว รอห้องผสมนำไปผสม</Callout>}
      <Card title={`ใบเบิก ${req.id}`} actions={<Button size="sm" icon={Printer} onClick={() => nav.printTag('requisition', req.id)}>พิมพ์ป้าย</Button>} flush>
        <div className="card-body">
          <dl className="kv">
            <dt>ใบสั่งผลิต</dt><dd className="mono">{order?.id} · {order?.customer}</dd>
            <dt>สูตร</dt><dd>{recipe?.name} · {req.batches} batch · {fmtNum(req.totalKg, 2)} kg</dd>
            <dt>ผู้ขอเบิก</dt><dd>{req.requestedBy} · {fmtDateTime(req.createdAt)}</dd>
            {req.issuedBy && <><dt>ผู้จ่าย</dt><dd>{req.issuedBy} · {fmtDateTime(req.issuedAt)}</dd></>}
            {req.consumedBy && <><dt>ใช้ผสมเป็น</dt><dd className="mono">{req.consumedBy}</dd></>}
          </dl>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>วัตถุดิบ</th><th>ล็อตที่จ่าย (FEFO)</th><th>หมดอายุ</th><th className="right">ตามสูตร (kg)</th><th className="right">ชั่งจริง (kg)</th><th>สถานะ</th></tr></thead>
            <tbody>
              {req.lines.map((l, i) => {
                const lot = data.materialLots.find((m) => m.lotNo === l.lotNo);
                const mat = data.materials.find((m) => m.code === l.materialCode);
                return (
                  <tr key={i} className={i === nextIdx && req.status === 'weighing' ? 'sel' : ''}>
                    <td>{i + 1}</td>
                    <td>{mat?.name}<div className="small muted mono">{l.materialCode}</div></td>
                    <td className="mono small">{l.lotNo}</td>
                    <td className="small nowrap">{fmtDate(lot?.expiry)}<div className="muted">{lot?.location}</div></td>
                    <td className="right mono">{fmtNum(l.targetKg, 3)}</td>
                    <td className="right mono">{l.actualKg === null ? '-' : fmtNum(l.actualKg, 3)}</td>
                    <td>{l.actualKg === null ? <Badge tone="warn">รอชั่ง</Badge> : <Badge tone="good">ผ่าน</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function WeighStation({ req, index }) {
  const { data, run } = useStore();
  const line = req.lines[index];
  const mat = data.materials.find((m) => m.code === line.materialCode);
  const tol = weighTolerance(line.targetKg);
  const [kg, setKg] = useState('');
  const v = Number(kg);
  const status = kg === '' ? 'empty' : v < line.targetKg - tol ? 'low' : v > line.targetKg + tol ? 'high' : 'ok';
  const simulate = (mode) => {
    const delta = mode === 'ok' ? (Math.random() - 0.5) * tol : mode === 'low' ? -tol * 2.5 : tol * 2.5;
    setKg((line.targetKg + delta).toFixed(3));
  };
  const confirmWeight = () => { if (run('weighLine', { reqId: req.id, index, actualKg: kg }, `บันทึกน้ำหนัก ${mat?.code} แล้ว`)) setKg(''); };
  return (
    <Card title={<span className="row"><Scale size={16} /> สถานีชั่ง · รายการ {index + 1}/{req.lines.length}</span>}>
      <div className="grid g2">
        <div className="stack">
          <div><div className="small muted">วัตถุดิบ</div><h2>{mat?.name}</h2><div className="mono small">{line.materialCode} · ล็อต {line.lotNo}</div></div>
          <div className="grid g2">
            <div><div className="small muted">น้ำหนักเป้าหมาย</div><div style={{ fontSize: 24, fontWeight: 600 }} className="mono">{line.targetKg.toFixed(3)} kg</div></div>
            <div><div className="small muted">เกณฑ์ยอมรับ</div><div style={{ fontSize: 24, fontWeight: 600 }} className="mono">± {tol.toFixed(3)}</div></div>
          </div>
        </div>
        <div className="stack">
          <Field label="ค่าที่อ่านได้จากตาชั่ง (kg)">
            <input type="number" step="0.001" className={`input ${status === 'ok' ? 'ok' : status === 'empty' ? '' : 'out'}`} style={{ fontSize: 22, fontFamily: 'var(--mono)' }} value={kg} onChange={(e) => setKg(e.target.value)} />
          </Field>
          <div className="row small"><span className="muted">จำลองตาชั่ง:</span>
            <Button size="sm" onClick={() => simulate('low')}>ขาด</Button>
            <Button size="sm" onClick={() => simulate('ok')}>พอดี</Button>
            <Button size="sm" onClick={() => simulate('high')}>เกิน</Button>
          </div>
          {status === 'low' && <Callout tone="bad" icon={ShieldAlert}>น้อยกว่าเกณฑ์ ขาดอีก {(line.targetKg - tol - v).toFixed(3)} kg ระบบล็อกปุ่มยืนยัน</Callout>}
          {status === 'high' && <Callout tone="bad" icon={ShieldAlert}>เกินเกณฑ์ {(v - line.targetKg - tol).toFixed(3)} kg ตักออกก่อนจึงยืนยันได้</Callout>}
          {status === 'ok' && <Callout tone="good" icon={CheckCircle2}>อยู่ในเกณฑ์ (ต่าง {(v - line.targetKg).toFixed(3)} kg)</Callout>}
          <Button variant="primary" disabled={status !== 'ok'} onClick={confirmWeight}>ยืนยันน้ำหนักและไปรายการถัดไป</Button>
        </div>
      </div>
    </Card>
  );
}

function CreateRequisition({ onClose }) {
  const { data, run, now } = useStore();
  const orders = data.orders.filter((o) => ['released', 'in_progress'].includes(o.status));
  const [orderId, setOrderId] = useState(orders[0]?.id || '');
  const [batches, setBatches] = useState(1);
  const [note, setNote] = useState('');
  const order = data.orders.find((o) => o.id === orderId);
  const recipe = order && data.recipes.find((r) => r.id === order.recipeId);
  const preview = recipe ? recipeLines(recipe).map((l) => ({ ...l, need: l.kgPerBatch * Number(batches || 0), ...allocateFefo(data.materialLots, l.materialCode, l.kgPerBatch * Number(batches || 0), now) })) : [];
  const short = preview.some((p) => p.shortage > 0.0001);
  const submit = () => { const id = run('createRequisition', { orderId, batches, note }, (r) => `สร้างใบเบิก ${r} แล้ว`); if (id) onClose(id); };
  return (
    <Modal wide title="สร้างใบเบิกวัตถุดิบ (ระเบิดสูตร)" onClose={() => onClose()} footer={<><Button onClick={() => onClose()}>ยกเลิก</Button><Button variant="primary" disabled={!orderId || short} onClick={submit}>สร้างใบเบิก</Button></>}>
      <div className="stack">
        <div className="grid g3">
          <Field label="ใบสั่งผลิต *"><Select value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="เลือก…" options={orders.map((o) => ({ value: o.id, label: `${o.id} · ${o.productName}` }))} /></Field>
          <Field label="จำนวน batch *"><Input type="number" min={1} max={10} value={batches} onChange={(e) => setBatches(e.target.value)} /></Field>
          <Field label="หมายเหตุ"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {recipe && <div className="muted small">สูตร {recipe.name} · น้ำหนักรวม {fmtNum(recipe.batchKg * Number(batches || 0), 2)} kg</div>}
        {short && <Callout tone="bad" icon={ShieldAlert}>สต็อกพร้อมใช้ไม่พอ (ไม่นับล็อตหมดอายุหรือกักกัน)</Callout>}
        <table>
          <thead><tr><th>วัตถุดิบ</th><th className="right">ต้องใช้ (kg)</th><th>ล็อตที่ระบบจะจ่าย (FEFO)</th></tr></thead>
          <tbody>
            {preview.map((p) => (
              <tr key={p.materialCode}>
                <td className="mono">{p.materialCode}</td>
                <td className="right mono">{fmtNum(p.need, 3)}</td>
                <td className="small">{p.picks.map((pk) => <div key={pk.lotNo} className="mono">{pk.lotNo} → {pk.kg.toFixed(3)} kg</div>)}{p.shortage > 0.0001 && <Badge tone="bad">ขาด {p.shortage.toFixed(2)} kg</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
