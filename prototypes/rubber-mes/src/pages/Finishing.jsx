import { FileCheck2, Gauge, Package, PackageCheck } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { SHIFTS } from '../lib/rules.js';
import { fmtNum } from '../lib/format.js';
import { Button, Callout, Card, Field, Input, PageHead, Select, Stat, useForm } from '../components/ui.jsx';
import { GateNotice, InboundSelect, StageLots, stageYield, useInbound } from '../components/StageCommon.jsx';

export default function Finishing() {
  const { data, run } = useStore();
  const nav = useNav();
  const lots = data.lots.filter((l) => l.stage === 'finishing');
  const { ready } = useInbound('finishing');
  const blank = { transferId: '', useQty: '', passedQty: '', scrapQty: '', perBox: '', grade: 'A', qcResult: 'pass', shift: 'D', scrapReason: '' };
  const [f, set, setF] = useForm(blank);
  const t = data.transfers.find((x) => x.id === f.transferId);
  const boxes = Number(f.perBox) > 0 && Number(f.passedQty) > 0 ? Math.ceil(Number(f.passedQty) / Number(f.perBox)) : 0;

  const pick = (id) => {
    const tr = data.transfers.find((x) => x.id === id);
    setF((x) => ({ ...x, transferId: id, useQty: tr ? String(tr.remaining) : '', perBox: tr?.uom === 'm' ? '100' : '2000' }));
  };
  const submit = () => { if (run('recordFinishing', f, (r) => `บันทึก ${r} และสร้างป้ายกล่องแล้ว`)) setF(blank); };

  return (
    <>
      <PageHead title="สถานีที่ 4 · ตกแต่งและบรรจุ" desc="ตัดแต่งครีบ ตรวจ 100% แล้วบรรจุกล่อง ระบบสร้างเลขกล่องและรับเข้าคลังสินค้าสำเร็จรูปให้อัตโนมัติ" />
      <div className="grid g4">
        <Stat icon={Gauge} label="Yield ตกแต่ง" value={`${stageYield(lots).toFixed(2)}%`} sub="เป้าหมาย ≥ 99.0%" />
        <Stat icon={PackageCheck} label="ผ่าน QC สะสม" value={fmtNum(lots.reduce((a, l) => a + l.goodQty, 0))} sub="m / pcs" />
        <Stat icon={Package} label="กล่องในคลัง" value={data.fgBoxes.filter((b) => b.status === 'in_stock').length} />
        <Stat icon={FileCheck2} label="ล็อตพร้อมออก CoA" value={lots.filter((l) => l.qc === 'pass').length} />
      </div>
      <GateNotice stage="finishing" />
      {ready.length > 0 && (
        <Card title="บันทึกการตกแต่งและบรรจุ">
          <div className="stack">
            <div className="grid g4">
              <InboundSelect stage="finishing" value={f.transferId} onChange={pick} />
              <Field label="ปริมาณที่รับเข้าตกแต่ง *" hint={t ? `คงเหลือ ${t.remaining} ${t.uom}` : undefined}><Input type="number" value={f.useQty} onChange={set('useQty')} /></Field>
              <Field label="ผ่านการตรวจ 100% *"><Input type="number" value={f.passedQty} onChange={set('passedQty')} /></Field>
              <Field label="ของเสียจากการตกแต่ง"><Input type="number" value={f.scrapQty} onChange={set('scrapQty')} /></Field>
              <Field label="จำนวนต่อกล่อง *" hint={boxes ? `จะได้ ${boxes} กล่อง` : undefined}><Input type="number" value={f.perBox} onChange={set('perBox')} /></Field>
              <Field label="เกรด"><Select value={f.grade} onChange={set('grade')} options={['A', 'B']} /></Field>
              <Field label="ผลตัดสินของล็อต"><Select value={f.qcResult} onChange={set('qcResult')} options={[{ value: 'pass', label: 'ผ่าน — รับเข้าคลัง' }, { value: 'hold', label: 'กักกันรอ QC' }]} /></Field>
              <Field label="กะ"><Select value={f.shift} onChange={set('shift')} options={SHIFTS.map((x) => ({ value: x.id, label: x.label }))} /></Field>
            </div>
            <Callout tone="info">เมื่อบันทึกเป็น “ผ่าน” กล่องจะเข้าคลังสินค้าสำเร็จรูปทันที และนับยอดเข้าใบสั่งผลิต</Callout>
            <div><Button variant="primary" onClick={submit}>บันทึกและพิมพ์ป้ายกล่อง</Button></div>
          </div>
        </Card>
      )}
      <StageLots stage="finishing" columns={[
        { label: 'บรรจุ', render: (l) => `${l.boxes} กล่อง × ${fmtNum(l.params.perBox)} · เกรด ${l.grade}` },
        { label: 'CoA', render: (l) => <Button size="sm" icon={FileCheck2} onClick={() => nav.printCoa(l.id)}>ดู CoA</Button> },
      ]} />
    </>
  );
}
