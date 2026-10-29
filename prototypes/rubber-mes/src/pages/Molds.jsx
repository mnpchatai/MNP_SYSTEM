import { Sparkles } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { fmtDate, fmtNum } from '../lib/format.js';
import { Badge, Button, Card, PageHead, Progress } from '../components/ui.jsx';

const KIND = { die: 'หัวดายฉีด', mold: 'แม่พิมพ์อัด', line: 'สายอบต่อเนื่อง' };
const UNIT = { m: 'เมตร', pcs: 'ชิ้น', shot: 'รอบ' };

export default function Molds() {
  const { data, run } = useStore();
  return (
    <>
      <PageHead title="แม่พิมพ์และหัวดาย" desc="ระบบนับรอบการใช้งานจากการบันทึกผลิตจริง แจ้งเตือนเมื่อใกล้ถึงรอบทำความสะอาด และติดตามอายุสะสมเทียบรอบซ่อมบำรุงใหญ่ (PM)" />
      <div className="grid g3">
        {data.molds.map((m) => {
          const pct = m.usageSinceClean / m.cleanEvery;
          const pmPct = m.totalUsage / m.pmLimit;
          const tone = pct >= 1 ? 'bad' : pct >= 0.85 ? 'warn' : '';
          return (
            <Card key={m.id} title={<span className="mono">{m.id}</span>} actions={<Badge tone={tone || 'good'}>{tone === 'bad' ? 'เกินรอบล้าง' : tone === 'warn' ? 'ใกล้ถึงรอบล้าง' : 'ปกติ'}</Badge>}>
              <div className="stack">
                <div><b>{m.name}</b><div className="small muted">{KIND[m.kind]}{m.perCycle > 1 ? ` · ${m.perCycle} cavity` : ''}</div></div>
                <div>
                  <div className="row between small"><span>ตั้งแต่ทำความสะอาดล่าสุด</span><span>{fmtNum(m.usageSinceClean)} / {fmtNum(m.cleanEvery)} {UNIT[m.unit]}</span></div>
                  <Progress value={m.usageSinceClean} max={m.cleanEvery} tone={tone} />
                </div>
                <div>
                  <div className="row between small"><span>อายุสะสม (PM ใหญ่)</span><span>{Math.round(pmPct * 100)}%</span></div>
                  <Progress value={m.totalUsage} max={m.pmLimit} tone={pmPct > 0.9 ? 'warn' : ''} />
                  <div className="small muted">{fmtNum(m.totalUsage)} / {fmtNum(m.pmLimit)} {UNIT[m.unit]}</div>
                </div>
                <div className="row between">
                  <span className="small muted">ล้างล่าสุด {fmtDate(m.lastCleanAt)}</span>
                  <Button size="sm" icon={Sparkles} onClick={() => confirm(`ยืนยันว่าได้ทำความสะอาด ${m.id} แล้ว?`) && run('cleanMold', { id: m.id }, 'บันทึกการทำความสะอาดแล้ว')}>บันทึกล้างแล้ว</Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
