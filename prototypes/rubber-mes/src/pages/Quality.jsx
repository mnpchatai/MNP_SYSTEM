import { useState } from 'react';
import { ClipboardCheck, FileCheck2, FileWarning, Plus, ShieldCheck } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { can } from '../data/rbac.js';
import { SPECS, STAGES, STAGE_LABEL, specText } from '../lib/rules.js';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format.js';
import { Badge, Button, Callout, Card, Field, Input, Modal, PageHead, Select, SpecInput, Stat, Status, Tabs, useForm } from '../components/ui.jsx';

export default function Quality() {
  const { data, user } = useStore();
  const nav = useNav();
  const [tab, setTab] = useState('hold');
  const [recordFor, setRecordFor] = useState(null);
  const [ncrOpen, setNcrOpen] = useState(false);
  const decide = can(user, 'qcDecision');
  const held = data.lots.filter((l) => l.qc === 'hold').sort((a, b) => b.createdAt - a.createdAt);
  const records = data.qcRecords;
  const fpy = records.length ? (records.filter((r) => r.result === 'pass').length / records.length) * 100 : 100;
  const openNcr = data.ncrs.filter((n) => n.status === 'open');
  const finLots = data.lots.filter((l) => l.stage === 'finishing').sort((a, b) => b.createdAt - a.createdAt);

  return (
    <>
      <PageHead title="ควบคุมคุณภาพ · NCR · CoA" desc="ตัดสินล็อตที่ถูกกักกัน บันทึกผลทดสอบในแล็บ ติดตามปัญหาด้วย NCR / 5-Why และออกใบรับรองผล (CoA)">
        {decide && <Button icon={FileWarning} onClick={() => setNcrOpen(true)}>เปิด NCR</Button>}
        {decide && <Button variant="primary" icon={Plus} onClick={() => setRecordFor('')}>บันทึกผลตรวจ</Button>}
      </PageHead>
      <div className="grid g4">
        <Stat icon={ShieldCheck} label="First Pass Yield (ผลตรวจ)" value={`${fpy.toFixed(1)}%`} sub={`${records.length} ครั้งที่บันทึก`} />
        <Stat icon={ClipboardCheck} label="ล็อตรอตัดสิน (Hold)" value={held.length} tone={held.length ? 'warn' : undefined} />
        <Stat icon={FileWarning} label="NCR ที่เปิดอยู่" value={openNcr.length} tone={openNcr.length ? 'bad' : undefined} />
        <Stat icon={FileCheck2} label="ล็อตพร้อมออก CoA" value={finLots.filter((l) => l.qc === 'pass').length} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'hold', label: `รอตัดสิน (${held.length})` }, { id: 'records', label: 'ผลตรวจทั้งหมด' },
        { id: 'ncr', label: `NCR / CAPA (${data.ncrs.length})` }, { id: 'coa', label: 'ใบรับรอง CoA' },
      ]} />

      {tab === 'hold' && (
        <Card flush>
          {held.length === 0 ? <div className="empty">ไม่มีล็อตที่ถูกกักกัน</div> : (
            <table>
              <thead><tr><th>ล็อต</th><th>ขั้นตอน</th><th>สาเหตุที่กักกัน</th><th className="right">ปริมาณ</th><th className="right" /></tr></thead>
              <tbody>{held.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.id}<div className="small muted">{l.orderId}</div></td>
                  <td>{STAGE_LABEL[l.stage]}</td>
                  <td className="small">{(l.holdReasons || []).join(', ') || '-'}</td>
                  <td className="right">{fmtNum(l.goodQty, 2)} {l.uom}</td>
                  <td className="right">{decide ? <Button size="sm" variant="primary" onClick={() => setRecordFor(l.id)}>ตรวจซ้ำ / ตัดสิน</Button> : <span className="small muted">เฉพาะ QC</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'records' && (
        <Card flush>
          <div className="table-wrap">
            <table>
              <thead><tr><th>เลขที่</th><th>ล็อต</th><th>ผลทดสอบ</th><th>ผล</th><th>ผู้ตรวจ</th></tr></thead>
              <tbody>{records.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}<div className="small muted">{fmtDateTime(r.at)}</div></td>
                  <td className="mono small">{r.lotId}<div className="muted">{STAGE_LABEL[r.stage]}</div></td>
                  <td className="small">{r.tests.map((t) => <span key={t.key} className={`badge ${t.pass ? '' : 'bad'}`} style={{ marginRight: 4 }}>{SPECS.lab[t.key].label} {t.value}</span>)}{r.note && <div className="muted">{r.note}</div>}</td>
                  <td><Status value={r.result} /></td>
                  <td className="small">{r.inspector}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'ncr' && (
        <div className="stack">
          {data.ncrs.map((n) => <NcrCard key={n.id} n={n} canClose={decide} />)}
          {data.ncrs.length === 0 && <Card><div className="empty">ยังไม่มี NCR</div></Card>}
        </div>
      )}

      {tab === 'coa' && (
        <Card flush>
          <table>
            <thead><tr><th>ล็อตสินค้าสำเร็จรูป</th><th>ลูกค้า / สินค้า</th><th className="right">จำนวน</th><th>QC</th><th className="right" /></tr></thead>
            <tbody>{finLots.map((l) => {
              const o = data.orders.find((x) => x.id === l.orderId);
              return (
                <tr key={l.id}>
                  <td className="mono">{l.id}<div className="small muted">{fmtDate(l.createdAt)}</div></td>
                  <td>{o?.customer}<div className="small muted">{o?.productName}</div></td>
                  <td className="right">{fmtNum(l.goodQty)} {l.uom}<div className="small muted">{l.boxes} กล่อง</div></td>
                  <td><Status value={l.qc} /></td>
                  <td className="right"><Button size="sm" icon={FileCheck2} onClick={() => nav.printCoa(l.id)}>เปิด CoA</Button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </Card>
      )}

      {recordFor !== null && <QcRecordModal lotId={recordFor} onClose={() => setRecordFor(null)} />}
      {ncrOpen && <NcrModal onClose={() => setNcrOpen(false)} />}
    </>
  );
}

function NcrCard({ n, canClose }) {
  const { run } = useStore();
  const [verify, setVerify] = useState('');
  return (
    <Card title={<span className="row"><span className="mono">{n.id}</span> {n.title}</span>} actions={<><Status value={n.severity} /><Status value={n.status} /></>}>
      <div className="grid g2">
        <div className="stack">
          <dl className="kv">
            <dt>ขั้นตอนที่พบ</dt><dd>{STAGE_LABEL[n.stage]}</dd>
            <dt>ล็อต</dt><dd className="mono">{n.lotId}</dd>
            <dt>ชิ้นงานเสีย</dt><dd>{fmtNum(n.defectQty)}</dd>
            <dt>ผู้รับผิดชอบ</dt><dd>{n.owner}</dd>
            <dt>เปิดเมื่อ</dt><dd>{fmtDateTime(n.createdAt)}</dd>
            {n.closedAt && <><dt>ปิดเมื่อ</dt><dd>{fmtDateTime(n.closedAt)} · {n.closedBy}</dd></>}
          </dl>
          <div><b className="small">วิเคราะห์ 5-Why</b>
            <ol className="small" style={{ margin: '4px 0 0', paddingLeft: 20 }}>{n.whys.map((w, i) => <li key={i}>{w}</li>)}</ol>
          </div>
        </div>
        <div className="stack small">
          <div><b>ควบคุมทันที (Containment)</b><div>{n.containment || '-'}</div></div>
          <div><b>แก้ไข (Corrective)</b><div>{n.corrective || '-'}</div></div>
          <div><b>ป้องกันซ้ำ (Preventive)</b><div>{n.preventive || '-'}</div></div>
          {n.verification && <div><b>ผลการทวนสอบ</b><div>{n.verification}</div></div>}
          {n.status === 'open' && canClose && (
            <div className="row">
              <div style={{ flex: 1 }}><Input value={verify} onChange={(e) => setVerify(e.target.value)} placeholder="ผลการทวนสอบประสิทธิผล…" /></div>
              <Button variant="primary" onClick={() => run('closeNcr', { id: n.id, verification: verify }, 'ปิด NCR แล้ว')}>ปิดเคส</Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function QcRecordModal({ lotId, onClose }) {
  const { data, run } = useStore();
  const [lot, setLot] = useState(lotId);
  const [values, setValues] = useState({});
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const target = data.lots.find((l) => l.id === lot);
  const submit = () => { if (run('addQcRecord', { lotId: lot, values, result: result || undefined, note }, (id) => `บันทึกผลตรวจ ${id} แล้ว`)) onClose(); };
  const options = [...data.lots].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map((l) => ({ value: l.id, label: `${l.id} · ${STAGE_LABEL[l.stage]} · ${l.qc}` }));
  return (
    <Modal wide title="บันทึกผลตรวจคุณภาพ" onClose={onClose} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" onClick={submit} disabled={!lot}>บันทึกผล</Button></>}>
      <div className="stack">
        <div className="grid g2">
          <Field label="ล็อตที่ตรวจ *"><Select value={lot} onChange={(e) => setLot(e.target.value)} placeholder="เลือก…" options={options} /></Field>
          <Field label="ผลตัดสิน" hint="เว้นว่างให้ระบบตัดสินจากค่าที่วัด">
            <Select value={result} onChange={(e) => setResult(e.target.value)} options={[{ value: '', label: 'อัตโนมัติจากผลวัด' }, { value: 'pass', label: 'ผ่าน — ปลดกักกัน' }, { value: 'hold', label: 'กักกันต่อ' }, { value: 'fail', label: 'ไม่ผ่าน — ทิ้ง/Rework' }]} />
          </Field>
        </div>
        {target?.holdReasons?.length > 0 && <Callout tone="warn">สาเหตุที่กักกัน: {target.holdReasons.join(', ')}</Callout>}
        <div className="grid g3">
          {Object.entries(SPECS.lab).map(([k, spec]) => (
            <SpecInput key={k} label={`${spec.label} · ${spec.method}`} spec={spec} value={values[k] ?? ''} onChange={(v) => setValues((x) => ({ ...x, [k]: v }))} />
          ))}
        </div>
        <Field label="หมายเหตุ"><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="small muted">สเปกอ้างอิง: {Object.values(SPECS.lab).map((s) => `${s.label} ${specText(s)}`).join(' · ')}</div>
      </div>
    </Modal>
  );
}

function NcrModal({ onClose }) {
  const { data, run } = useStore();
  const [f, set] = useForm({ title: '', stage: 'curing', lotId: '', severity: 'major', defectQty: '', containment: '', corrective: '', preventive: '' });
  const [whys, setWhys] = useState(['', '', '', '', '']);
  const submit = () => { if (run('createNcr', { ...f, whys }, (id) => `เปิด ${id} แล้ว`)) onClose(); };
  return (
    <Modal wide title="เปิดรายงานข้อบกพร่อง (NCR)" onClose={onClose} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" onClick={submit}>เปิด NCR</Button></>}>
      <div className="stack">
        <div className="grid g2">
          <Field label="หัวข้อปัญหา *"><Input value={f.title} onChange={set('title')} /></Field>
          <Field label="ล็อตที่พบ *" hint="ล็อตที่ผ่านแล้วจะถูกกักกันอัตโนมัติ">
            <Input list="ncr-lots" value={f.lotId} onChange={set('lotId')} placeholder="เช่น CU-…" />
            <datalist id="ncr-lots">{data.lots.slice(0, 80).map((l) => <option key={l.id} value={l.id} />)}</datalist>
          </Field>
          <Field label="ขั้นตอนที่พบ"><Select value={f.stage} onChange={set('stage')} options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} /></Field>
          <div className="grid g2">
            <Field label="ความรุนแรง"><Select value={f.severity} onChange={set('severity')} options={[{ value: 'critical', label: 'Critical — หยุดไลน์' }, { value: 'major', label: 'Major' }, { value: 'minor', label: 'Minor' }]} /></Field>
            <Field label="จำนวนชิ้นงานเสีย"><Input type="number" value={f.defectQty} onChange={set('defectQty')} /></Field>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">วิเคราะห์ 5-Why</b>
          {whys.map((w, i) => <Input key={i} value={w} onChange={(e) => setWhys((a) => a.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`ทำไม ครั้งที่ ${i + 1}`} />)}
        </div>
        <div className="grid g3">
          <Field label="ควบคุมทันที"><textarea className="input" value={f.containment} onChange={set('containment')} /></Field>
          <Field label="การแก้ไข"><textarea className="input" value={f.corrective} onChange={set('corrective')} /></Field>
          <Field label="การป้องกันซ้ำ"><textarea className="input" value={f.preventive} onChange={set('preventive')} /></Field>
        </div>
        <Badge tone="info">ต้องกรอก “การแก้ไข” ก่อนจึงจะปิดเคสได้</Badge>
      </div>
    </Modal>
  );
}
