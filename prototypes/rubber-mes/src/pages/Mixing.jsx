import { Gauge, Timer, Trash2, Waves } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { MACHINES, SHIFTS } from '../lib/rules.js';
import { fmtDuration, fmtNum } from '../lib/format.js';
import { Button, Callout, Card, Field, Input, PageHead, Select, Stat, useForm } from '../components/ui.jsx';
import { StageLots, stageYield } from '../components/StageCommon.jsx';

export default function Mixing() {
  const { data, now, run } = useStore();
  const lots = data.lots.filter((l) => l.stage === 'mixing');
  const issued = data.requisitions.filter((r) => r.status === 'issued');
  const [f, set, setF] = useForm({ reqId: issued[0]?.id || '', machine: MACHINES.mixing[0], shift: 'D', dumpTemp: '', mixSec: '', outputKg: '', scrapKg: '', scrapReason: '' });
  const req = data.requisitions.find((r) => r.id === f.reqId);
  const recipe = req && data.recipes.find((r) => r.id === req.recipeId);
  const issuedKg = req ? req.lines.reduce((s, l) => s + l.actualKg, 0) : 0;
  const dumpOut = recipe && f.dumpTemp !== '' && Math.abs(Number(f.dumpTemp) - recipe.dumpTemp) > recipe.dumpTol;
  const resting = lots.filter((l) => l.readyAt > now);

  const submit = () => {
    const id = run('recordMixing', f, (r) => `บันทึก ${r} แล้ว`);
    if (id) setF((x) => ({ ...x, reqId: '', dumpTemp: '', mixSec: '', outputKg: '', scrapKg: '', scrapReason: '' }));
  };

  return (
    <>
      <PageHead title="สถานีที่ 1 · ผสมยาง" desc="รับวัตถุดิบที่ชั่งครบแล้วมาผสม บันทึก Dump temp และเวลา ยางทุก batch ต้องบ่มครบเวลาก่อนส่งไปฉีด" />
      <div className="grid g4">
        <Stat icon={Gauge} label="Yield ห้องผสม" value={`${stageYield(lots).toFixed(2)}%`} sub="เป้าหมาย ≥ 99.0%" />
        <Stat icon={Waves} label="ผลิตแล้วสะสม" value={`${fmtNum(lots.reduce((s, l) => s + l.goodQty, 0), 0)} kg`} sub={`${lots.length} batch`} />
        <Stat icon={Timer} label="กำลังบ่ม" value={resting.length} sub={resting[0] ? `ใกล้ครบ: ${fmtDuration(Math.min(...resting.map((l) => l.readyAt)) - now)}` : 'ไม่มี'} />
        <Stat icon={Trash2} label="ของเสียสะสม" value={`${fmtNum(lots.reduce((s, l) => s + l.scrapQty, 0), 1)} kg`} />
      </div>
      <Card title="บันทึกการผสม">
        {issued.length === 0 ? <Callout tone="warn">ยังไม่มีใบเบิกที่ชั่งครบ ต้องให้คลังจ่ายวัตถุดิบครบทุกรายการก่อน</Callout> : (
          <div className="stack">
            <div className="grid g4">
              <Field label="ใบเบิกที่จ่ายครบ *">
                <Select value={f.reqId} onChange={set('reqId')} placeholder="เลือก…" options={issued.map((r) => ({ value: r.id, label: `${r.id} · ${r.orderId}` }))} />
              </Field>
              <Field label="เครื่องผสม"><Select value={f.machine} onChange={set('machine')} options={MACHINES.mixing} /></Field>
              <Field label="กะ"><Select value={f.shift} onChange={set('shift')} options={SHIFTS.map((s) => ({ value: s.id, label: s.label }))} /></Field>
              <Field label="เวลาผสม (s) *" hint={recipe ? `มาตรฐาน ${recipe.mixSec} s` : undefined}><Input type="number" value={f.mixSec} onChange={set('mixSec')} /></Field>
              <Field label="Dump temp (°C) *" hint={recipe ? `มาตรฐาน ${recipe.dumpTemp} ± ${recipe.dumpTol} °C` : undefined}>
                <input type="number" className={`input ${f.dumpTemp === '' ? '' : dumpOut ? 'out' : 'ok'}`} value={f.dumpTemp} onChange={set('dumpTemp')} />
              </Field>
              <Field label="น้ำหนักยางที่ได้ (kg) *" hint={req ? `วัตถุดิบที่จ่าย ${fmtNum(issuedKg, 2)} kg` : undefined}><Input type="number" value={f.outputKg} onChange={set('outputKg')} /></Field>
              <Field label="ของเสีย (kg)"><Input type="number" value={f.scrapKg} onChange={set('scrapKg')} /></Field>
              <Field label="สาเหตุของเสีย"><Input value={f.scrapReason} onChange={set('scrapReason')} placeholder="เช่น เศษติดใบโรเตอร์" /></Field>
            </div>
            {dumpOut && <Callout tone="warn">Dump temp อยู่นอกช่วง ระบบจะตั้งสถานะ QC Hold ให้ล็อตนี้อัตโนมัติ</Callout>}
            <div className="row"><Button variant="primary" onClick={submit}>บันทึกการผสม</Button>{recipe && <span className="small muted">บันทึกแล้วต้องบ่มขั้นต่ำ {recipe.restHours} ชม. ก่อนส่งต่อ</span>}</div>
          </div>
        )}
      </Card>
      <StageLots stage="mixing" columns={[
        { label: 'เครื่อง / กะ', render: (l) => <>{l.machine}<br />กะ {l.shift}</> },
        { label: 'Dump temp / เวลา', render: (l) => `${l.params.dumpTemp}°C · ${l.params.mixSec}s` },
      ]} />
    </>
  );
}
