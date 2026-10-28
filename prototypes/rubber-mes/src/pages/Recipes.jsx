import { useState } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { can } from '../data/rbac.js';
import { recipeLines, totalPhr } from '../lib/rules.js';
import { fmtDate, fmtNum } from '../lib/format.js';
import { Button, Card, Empty, Field, Input, Modal, PageHead, Select, Status, useForm } from '../components/ui.jsx';

export default function Recipes() {
  const { data, user, run } = useStore();
  const [selId, setSelId] = useState(data.recipes[0]?.id);
  const [creating, setCreating] = useState(false);
  const sel = data.recipes.find((r) => r.id === selId);

  return (
    <>
      <PageHead title="สูตรยาง (BOM / PHR)" desc="สูตรคิดเป็น PHR (ส่วนต่อยาง 100 ส่วน) ระบบคำนวณน้ำหนักต่อ batch ให้อัตโนมัติ สูตรต้องได้รับอนุมัติก่อนใช้เปิดใบสั่งผลิต">
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>สร้างสูตรใหม่</Button>
      </PageHead>
      <div className="split">
        <Card title={`สูตรทั้งหมด (${data.recipes.length})`} flush>
          {data.recipes.map((r) => (
            <div key={r.id} className={`list-item ${r.id === selId ? 'sel' : ''}`} onClick={() => setSelId(r.id)}>
              <div className="row between"><b className="mono">{r.id}</b><Status value={r.status} /></div>
              <div>{r.name}</div>
              <div className="small muted">{r.productName} · {r.batchKg} kg/batch</div>
            </div>
          ))}
        </Card>
        {sel ? (
          <Card title={`${sel.name}`} actions={sel.status === 'draft' && can(user, 'approveRecipe') && <Button variant="primary" icon={CheckCircle2} onClick={() => run('approveRecipe', { id: sel.id }, 'อนุมัติสูตรแล้ว')}>อนุมัติสูตร</Button>}>
            <div className="stack">
              <div className="grid g4">
                <div><div className="small muted">Total PHR</div><b>{fmtNum(totalPhr(sel), 1)}</b></div>
                <div><div className="small muted">น้ำหนักต่อ batch</div><b>{sel.batchKg} kg</b></div>
                <div><div className="small muted">Dump temp</div><b>{sel.dumpTemp} ± {sel.dumpTol} °C</b></div>
                <div><div className="small muted">เวลาผสม / บ่ม</div><b>{sel.mixSec} s / {sel.restHours} ชม.</b></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>รหัส</th><th>วัตถุดิบ</th><th>หมวด</th><th className="right">PHR</th><th className="right">kg / batch</th><th>การจัดเก็บ</th></tr></thead>
                  <tbody>
                    {recipeLines(sel).map((l) => {
                      const m = data.materials.find((x) => x.code === l.materialCode);
                      return (
                        <tr key={l.materialCode}>
                          <td className="mono">{l.materialCode}</td><td>{m?.name}</td><td className="small">{m?.category}</td>
                          <td className="right">{l.phr}</td><td className="right mono">{fmtNum(l.kgPerBatch, 3)}</td><td className="small muted">{m?.storage}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <dl className="kv">
                <dt>สินค้า</dt><dd>{sel.productCode} · {sel.productName} (หน่วย {sel.uom})</dd>
                <dt>ผลผลิตโดยประมาณ</dt><dd>{sel.yieldPerKg} {sel.uom} ต่อคอมปาวด์ 1 kg</dd>
                <dt>Revision</dt><dd>Rev.{sel.revision}</dd>
                <dt>ผู้สร้าง</dt><dd>{sel.createdBy} · {fmtDate(sel.createdAt)}</dd>
                <dt>ผู้อนุมัติ</dt><dd>{sel.approvedBy ? `${sel.approvedBy} · ${fmtDate(sel.approvedAt)}` : 'รออนุมัติ'}</dd>
              </dl>
            </div>
          </Card>
        ) : <Card><Empty>เลือกสูตรจากรายการด้านซ้าย</Empty></Card>}
      </div>
      {creating && <CreateRecipe onClose={(id) => { setCreating(false); if (id) setSelId(id); }} />}
    </>
  );
}

function CreateRecipe({ onClose }) {
  const { data, run } = useStore();
  const [f, set] = useForm({ id: '', name: '', productCode: '', productName: '', uom: 'm', batchKg: 50, dumpTemp: 130, dumpTol: 5, mixSec: 270, restHours: 4, yieldPerKg: 6 });
  const [items, setItems] = useState([
    { materialCode: 'EPDM-55', phr: 100 }, { materialCode: 'CB-N550', phr: 70 }, { materialCode: 'ZNO', phr: 5 },
    { materialCode: 'STA', phr: 1 }, { materialCode: 'S-80', phr: 1.5 },
  ]);
  const setItem = (i, k, v) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const draft = { ...f, batchKg: Number(f.batchKg), items: items.map((i) => ({ ...i, phr: Number(i.phr) || 0 })) };
  const lines = recipeLines(draft);
  const save = () => { if (run('createRecipe', { ...f, items }, 'บันทึกสูตรแล้ว (รออนุมัติ)')) onClose(f.id.trim()); };
  return (
    <Modal wide title="สร้างสูตรการผลิตใหม่" onClose={() => onClose()} footer={<><Button onClick={() => onClose()}>ยกเลิก</Button><Button variant="primary" onClick={save}>บันทึกสูตร</Button></>}>
      <div className="stack">
        <div className="grid g3">
          <Field label="รหัสสูตร *"><Input value={f.id} onChange={set('id')} placeholder="RC-EPDM-XX01" /></Field>
          <Field label="ชื่อสูตร *"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="หน่วยสินค้า"><Select value={f.uom} onChange={set('uom')} options={[{ value: 'm', label: 'เมตร (m)' }, { value: 'pcs', label: 'ชิ้น (pcs)' }]} /></Field>
          <Field label="รหัสสินค้า"><Input value={f.productCode} onChange={set('productCode')} /></Field>
          <Field label="ชื่อสินค้า *"><Input value={f.productName} onChange={set('productName')} /></Field>
          <Field label="น้ำหนักต่อ batch (kg)"><Input type="number" value={f.batchKg} onChange={set('batchKg')} /></Field>
          <Field label="Dump temp (°C)"><Input type="number" value={f.dumpTemp} onChange={set('dumpTemp')} /></Field>
          <Field label="ค่าเผื่อ Dump temp (±°C)"><Input type="number" value={f.dumpTol} onChange={set('dumpTol')} /></Field>
          <Field label="เวลาผสม (s)"><Input type="number" value={f.mixSec} onChange={set('mixSec')} /></Field>
          <Field label="เวลาบ่มขั้นต่ำ (ชม.)"><Input type="number" value={f.restHours} onChange={set('restHours')} /></Field>
          <Field label={`ผลผลิตต่อ kg (${f.uom})`}><Input type="number" value={f.yieldPerKg} onChange={set('yieldPerKg')} /></Field>
        </div>
        <table>
          <thead><tr><th>วัตถุดิบ</th><th style={{ width: 120 }}>PHR</th><th className="right">kg / batch</th><th /></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td><Select value={it.materialCode} onChange={(e) => setItem(i, 'materialCode', e.target.value)} options={data.materials.map((m) => ({ value: m.code, label: `${m.code} · ${m.name}` }))} /></td>
                <td><Input type="number" value={it.phr} onChange={(e) => setItem(i, 'phr', e.target.value)} /></td>
                <td className="right mono">{fmtNum(lines[i]?.kgPerBatch, 3)}</td>
                <td><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))} aria-label="ลบ" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row between">
          <Button size="sm" icon={Plus} onClick={() => setItems((a) => [...a, { materialCode: data.materials[0].code, phr: 1 }])}>เพิ่มวัตถุดิบ</Button>
          <span className="muted">รวม PHR {fmtNum(totalPhr(draft), 1)} · น้ำหนักรวม {fmtNum(lines.reduce((s, l) => s + l.kgPerBatch, 0), 2)} kg</span>
        </div>
      </div>
    </Modal>
  );
}
