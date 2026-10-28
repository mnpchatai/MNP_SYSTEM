import { Gauge, Recycle, Repeat, Ruler } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { MACHINES, SHIFTS, SPECS } from '../lib/rules.js';
import { fmtNum } from '../lib/format.js';
import { Button, Callout, Card, Field, Input, PageHead, Select, SpecInput, Stat, useForm } from '../components/ui.jsx';
import { GateNotice, InboundSelect, StageLots, stageYield, useInbound } from '../components/StageCommon.jsx';

export default function Extrusion() {
  const { data, run } = useStore();
  const lots = data.lots.filter((l) => l.stage === 'extrusion');
  const { ready } = useInbound('extrusion');
  const dies = data.molds.filter((m) => m.kind === 'die');
  const blank = { transferId: '', useKg: '', reworkKg: '', machine: MACHINES.extrusion[0], dieId: dies[0]?.id, shift: 'D', thickness: '', width: '', weightPerM: '', goodQty: '', scrapQty: '', scrapReason: '' };
  const [f, set, setF] = useForm(blank);
  const t = data.transfers.find((x) => x.id === f.transferId);
  const pct = Number(f.useKg) > 0 ? (Number(f.reworkKg || 0) / (Number(f.useKg) + Number(f.reworkKg || 0))) * 100 : 0;
  const avgRework = lots.length ? lots.reduce((s, l) => s + (l.params.reworkPct || 0), 0) / lots.length : 0;

  const pick = (id) => {
    const tr = data.transfers.find((x) => x.id === id);
    setF((x) => ({ ...x, transferId: id, useKg: tr ? String(tr.remaining) : '' }));
  };
  const submit = () => { if (run('recordExtrusion', f, (r) => `บันทึก ${r} แล้ว`)) setF(blank); };
  const s = SPECS.extrusion;

  return (
    <>
      <PageHead title="สถานีที่ 2 · รีดขึ้นรูป" desc="ใช้ได้เฉพาะยางที่รับมอบแล้ว คุมสัดส่วนยางหมุนเวียนไม่เกิน 10% และตรวจมิติชิ้นงานกับสเปก" />
      <div className="grid g4">
        <Stat icon={Gauge} label="Yield การรีด" value={`${stageYield(lots).toFixed(2)}%`} sub="เป้าหมาย ≥ 97.0%" />
        <Stat icon={Ruler} label="ผลิตแล้วสะสม" value={fmtNum(lots.reduce((a, l) => a + l.goodQty, 0))} sub="m / pcs" />
        <Stat icon={Recycle} label="ยางหมุนเวียนเฉลี่ย" value={`${avgRework.toFixed(1)}%`} sub={`เพดาน ${s.reworkMaxPct}%`} />
        <Stat icon={Repeat} label="งานรอเข้าเครื่อง" value={ready.length} sub="ใบส่งมอบที่รับแล้ว" />
      </div>
      <GateNotice stage="extrusion" />
      {ready.length > 0 && (
        <Card title="บันทึกการรีด">
          <div className="stack">
            <div className="grid g4">
              <InboundSelect stage="extrusion" value={f.transferId} onChange={pick} />
              <Field label="ยางคอมปาวด์ที่ใช้ (kg) *" hint={t ? `คงเหลือ ${t.remaining} kg` : undefined}><Input type="number" value={f.useKg} onChange={set('useKg')} /></Field>
              <Field label="ยางหมุนเวียนที่ผสม (kg)" hint={`สัดส่วน ${pct.toFixed(1)}% (ไม่เกิน ${s.reworkMaxPct}%)`}>
                <input type="number" className={`input ${f.reworkKg === '' ? '' : pct > s.reworkMaxPct ? 'out' : 'ok'}`} value={f.reworkKg} onChange={set('reworkKg')} />
              </Field>
              <Field label="กะ"><Select value={f.shift} onChange={set('shift')} options={SHIFTS.map((x) => ({ value: x.id, label: x.label }))} /></Field>
              <Field label="เครื่องรีด"><Select value={f.machine} onChange={set('machine')} options={MACHINES.extrusion} /></Field>
              <Field label="หัวดาย *"><Select value={f.dieId} onChange={set('dieId')} options={dies.map((d) => ({ value: d.id, label: `${d.id} · ${d.name}` }))} /></Field>
              <SpecInput label={s.thickness.label} spec={s.thickness} value={f.thickness} onChange={set('thickness')} />
              <SpecInput label={s.width.label} spec={s.width} value={f.width} onChange={set('width')} />
              <SpecInput label={s.weightPerM.label} spec={s.weightPerM} value={f.weightPerM} onChange={set('weightPerM')} />
              <Field label="งานดี (m/pcs) *"><Input type="number" value={f.goodQty} onChange={set('goodQty')} /></Field>
              <Field label="ของเสีย (m/pcs)"><Input type="number" value={f.scrapQty} onChange={set('scrapQty')} /></Field>
              <Field label="สาเหตุของเสีย"><Input value={f.scrapReason} onChange={set('scrapReason')} /></Field>
            </div>
            {pct > s.reworkMaxPct && <Callout tone="bad">สัดส่วนยางหมุนเวียนเกินเพดาน ระบบจะไม่ให้บันทึก</Callout>}
            <div><Button variant="primary" onClick={submit}>บันทึกการรีด</Button></div>
          </div>
        </Card>
      )}
      <StageLots stage="extrusion" columns={[
        { label: 'เครื่อง / หัวดาย', render: (l) => <>{l.machine}<br /><span className="mono">{l.dieId}</span></> },
        { label: 'มิติ (หนา × กว้าง · g/m)', render: (l) => `${l.params.thickness} × ${l.params.width} · ${l.params.weightPerM}` },
        { label: 'หมุนเวียน', render: (l) => `${l.params.reworkPct}%` },
      ]} />
    </>
  );
}
