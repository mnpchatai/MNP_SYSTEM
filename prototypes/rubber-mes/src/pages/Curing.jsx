import { AlertTriangle, Flame, Gauge, Thermometer } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { SHIFTS, SPECS, inSpec } from '../lib/rules.js';
import { fmtNum } from '../lib/format.js';
import { Button, Callout, Card, Field, Input, PageHead, Select, SpecInput, Stat, useForm } from '../components/ui.jsx';
import { GateNotice, InboundSelect, StageLots, stageYield, useInbound } from '../components/StageCommon.jsx';

export default function Curing() {
  const { data, run } = useStore();
  const lots = data.lots.filter((l) => l.stage === 'curing');
  const { ready } = useInbound('curing');
  const tools = data.molds.filter((m) => m.kind !== 'die');
  const blank = { transferId: '', useQty: '', moldId: tools[0]?.id, shift: 'D', temp: '', time: '', pressure: '', goodQty: '', scrapQty: '', scrapReason: '' };
  const [f, set, setF] = useForm(blank);
  const t = data.transfers.find((x) => x.id === f.transferId);
  const s = SPECS.curing;
  const out = ['temp', 'time', 'pressure'].filter((k) => f[k] !== '' && !inSpec(f[k], s[k]));
  const avgTemp = lots.length ? lots.reduce((a, l) => a + l.params.temp, 0) / lots.length : 0;

  const pick = (id) => {
    const tr = data.transfers.find((x) => x.id === id);
    setF((x) => ({ ...x, transferId: id, useQty: tr ? String(tr.remaining) : '' }));
  };
  const submit = () => { if (run('recordCuring', f, (r) => `บันทึก ${r} แล้ว`)) setF(blank); };

  return (
    <>
      <PageHead title="สถานีที่ 3 · อบวัลคาไนซ์" desc="คุมอุณหภูมิ เวลา และความดันตามสเปก ถ้าค่าหลุดช่วง ระบบจะกักกันล็อตอัตโนมัติ และนับรอบการใช้แม่พิมพ์ให้" />
      <div className="grid g4">
        <Stat icon={Gauge} label="Yield การอบ" value={`${stageYield(lots).toFixed(2)}%`} sub="เป้าหมาย ≥ 98.0%" />
        <Stat icon={Flame} label="ผ่านการอบสะสม" value={fmtNum(lots.reduce((a, l) => a + l.goodQty, 0))} sub="m / pcs" />
        <Stat icon={Thermometer} label="อุณหภูมิเฉลี่ย" value={`${avgTemp.toFixed(1)}°C`} sub={`มาตรฐาน ${s.temp.target} ± ${s.temp.tol}`} />
        <Stat icon={AlertTriangle} label="ล็อตถูกกักกัน" value={lots.filter((l) => l.qc === 'hold').length} tone="warn" />
      </div>
      <GateNotice stage="curing" />
      {ready.length > 0 && (
        <Card title="บันทึกการอบ">
          <div className="stack">
            <div className="grid g4">
              <InboundSelect stage="curing" value={f.transferId} onChange={pick} />
              <Field label="ปริมาณที่นำเข้าอบ *" hint={t ? `คงเหลือ ${t.remaining} ${t.uom}` : undefined}><Input type="number" value={f.useQty} onChange={set('useQty')} /></Field>
              <Field label="แม่พิมพ์ / สายอบ *"><Select value={f.moldId} onChange={set('moldId')} options={tools.map((m) => ({ value: m.id, label: `${m.id} · ${m.name}` }))} /></Field>
              <Field label="กะ"><Select value={f.shift} onChange={set('shift')} options={SHIFTS.map((x) => ({ value: x.id, label: x.label }))} /></Field>
              <SpecInput label={s.temp.label} spec={s.temp} value={f.temp} onChange={set('temp')} />
              <SpecInput label={s.time.label} spec={s.time} value={f.time} onChange={set('time')} />
              <SpecInput label={s.pressure.label} spec={s.pressure} value={f.pressure} onChange={set('pressure')} />
              <div />
              <Field label="งานดี *"><Input type="number" value={f.goodQty} onChange={set('goodQty')} /></Field>
              <Field label="ของเสีย"><Input type="number" value={f.scrapQty} onChange={set('scrapQty')} /></Field>
              <Field label="สาเหตุของเสีย"><Input value={f.scrapReason} onChange={set('scrapReason')} placeholder="เช่น ฟองอากาศ, ยางไม่เต็มแบบ" /></Field>
            </div>
            {out.length > 0 && <Callout tone="warn" icon={AlertTriangle}>{out.map((k) => s[k].label).join(', ')} อยู่นอกสเปก ล็อตนี้จะถูกกักกัน (QC Hold) อัตโนมัติ</Callout>}
            <div><Button variant="primary" onClick={submit}>บันทึกการอบ</Button></div>
          </div>
        </Card>
      )}
      <StageLots stage="curing" columns={[
        { label: 'แม่พิมพ์ / สายอบ', render: (l) => <span className="mono">{l.moldId}</span> },
        { label: 'อุณหภูมิ · เวลา · ความดัน', render: (l) => `${l.params.temp}°C · ${l.params.time}s · ${l.params.pressure} bar` },
      ]} />
    </>
  );
}
