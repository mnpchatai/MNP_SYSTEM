import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ClipboardList, Gauge, PackageCheck, Trash2 } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { canSee } from '../data/rbac.js';
import { DAY, STAGES, STAGE_LABEL } from '../lib/rules.js';
import { fmtDate, fmtNum } from '../lib/format.js';
import { buildAlerts } from '../lib/derive.js';
import { Card, PageHead, Progress, Stat, Status } from '../components/ui.jsx';

export default function Dashboard() {
  const { data, now, user } = useStore();
  const nav = useNav();

  const m = useMemo(() => {
    const lots = data.lots;
    const byStage = Object.fromEntries(STAGES.map((s) => [s, lots.filter((l) => l.stage === s)]));
    const yieldOf = (arr) => {
      const good = arr.reduce((s, l) => s + l.goodQty, 0);
      const scrap = arr.reduce((s, l) => s + l.scrapQty, 0);
      return good + scrap ? (good / (good + scrap)) * 100 : 100;
    };
    const stageYield = Object.fromEntries(STAGES.map((s) => [s, yieldOf(byStage[s])]));
    const overall = STAGES.reduce((p, s) => p * (stageYield[s] / 100), 1) * 100;
    const days = [...Array(10)].map((_, i) => {
      const start = new Date(now - (9 - i) * DAY).setHours(0, 0, 0, 0);
      const dayLots = lots.filter((l) => l.createdAt >= start && l.createdAt < start + DAY);
      return {
        day: fmtDate(start).split(' ').slice(0, 2).join(' '),
        output: Math.round(dayLots.filter((l) => l.stage === 'finishing' && l.uom === 'm').reduce((s, l) => s + l.goodQty, 0)),
        yield: dayLots.length ? +yieldOf(dayLots).toFixed(1) : null,
      };
    });
    const mixingScrapKg = byStage.mixing.reduce((s, l) => s + l.scrapQty, 0);
    const scrapBars = STAGES.map((s) => ({ stage: STAGE_LABEL[s], pct: +(100 - stageYield[s]).toFixed(2) }));
    const wipAt = (stage) => data.transfers.filter((t) => t.to === stage && (t.status === 'in_transit' || t.remaining > 0));
    return { byStage, stageYield, overall, days, mixingScrapKg, scrapBars, wipAt };
  }, [data, now]);

  const active = data.orders.filter((o) => ['released', 'in_progress', 'on_hold'].includes(o.status));
  const alerts = buildAlerts(data, now);
  const fgBoxes = data.fgBoxes.filter((b) => b.status === 'in_stock');

  return (
    <>
      <PageHead title="ภาพรวมโรงงาน" desc={`ข้อมูล ณ ${new Date(now).toLocaleString('th-TH')}`} />
      <div className="grid g4">
        <Stat icon={Gauge} label="Yield รวม 4 ขั้นตอน" value={`${m.overall.toFixed(1)}%`} sub="เป้าหมาย ≥ 95.0%" tone={m.overall >= 95 ? 'good' : 'warn'} />
        <Stat icon={ClipboardList} label="ใบสั่งผลิตที่เปิดอยู่" value={active.length} sub={`ด่วน ${active.filter((o) => o.priority === 'urgent').length} รายการ`} />
        <Stat icon={Trash2} label="ของเสียห้องผสม (สะสม)" value={`${fmtNum(m.mixingScrapKg, 1)} kg`} sub={`Yield ห้องผสม ${m.stageYield.mixing.toFixed(2)}%`} />
        <Stat icon={PackageCheck} label="สินค้าพร้อมส่งในคลัง" value={`${fgBoxes.length} กล่อง`} sub={`${data.fgBoxes.filter((b) => b.status === 'hold').length} กล่องถูกกักกัน`} />
      </div>

      <div className="flow">
        {STAGES.map((s, i) => {
          const lots = m.byStage[s];
          const held = lots.filter((l) => l.qc === 'hold').length;
          const waiting = m.wipAt(s);
          return (
            <button key={s} type="button" className="step" style={{ textAlign: 'left', cursor: canSee(user, s) ? 'pointer' : 'default' }} onClick={() => canSee(user, s) && nav.go(s)}>
              <div className="row between"><span className="num">STAGE {i + 1}</span>{held > 0 && <span className="badge warn">Hold {held}</span>}</div>
              <h3 style={{ margin: '4px 0 8px' }}>{STAGE_LABEL[s]}</h3>
              <dl className="kv">
                <dt>ล็อตทั้งหมด</dt><dd>{lots.length}</dd>
                <dt>Yield</dt><dd>{m.stageYield[s].toFixed(2)}%</dd>
                {s !== 'mixing' && <><dt>งานรอเข้า</dt><dd>{waiting.length} ใบส่งมอบ</dd></>}
                {s === 'mixing' && <><dt>กำลังบ่ม</dt><dd>{lots.filter((l) => l.readyAt > now).length} batch</dd></>}
              </dl>
            </button>
          );
        })}
      </div>

      <div className="grid g2">
        <Card title="ผลผลิตสำเร็จรูป (เมตร) และ Yield รายวัน">
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={m.days} margin={{ left: -10, right: 10 }}>
              <CartesianGrid stroke="#e4e0d8" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="a" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="b" orientation="right" domain={[90, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area yAxisId="a" dataKey="output" name="ผลผลิต (m)" stroke="#0f766e" fill="#0f766e" fillOpacity={0.15} />
              <Area yAxisId="b" dataKey="yield" name="Yield %" stroke="#b45309" fill="none" connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="สัดส่วนของเสียแยกตามขั้นตอน (%)">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={m.scrapBars} margin={{ left: -10, right: 10 }}>
              <CartesianGrid stroke="#e4e0d8" vertical={false} />
              <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="pct" name="ของเสีย" fill="#b45309" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <Card title="ใบสั่งผลิตที่กำลังดำเนินการ" flush actions={canSee(user, 'orders') && <button type="button" className="btn sm" onClick={() => nav.go('orders')}>ดูทั้งหมด</button>}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>เลขที่</th><th>ลูกค้า / สินค้า</th><th>ความคืบหน้า</th><th>กำหนดส่ง</th><th>สถานะ</th></tr></thead>
              <tbody>
                {active.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{o.id}{o.priority === 'urgent' && <> <span className="badge bad">ด่วน</span></>}</td>
                    <td>{o.customer}<div className="small muted">{o.productName}</div></td>
                    <td style={{ minWidth: 150 }}><Progress value={o.producedQty} max={o.targetQty} /><div className="small muted">{fmtNum(o.producedQty)} / {fmtNum(o.targetQty)} {o.uom}</div></td>
                    <td className="nowrap">{fmtDate(o.dueDate)}</td>
                    <td><Status value={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`การแจ้งเตือน (${alerts.length})`}>
          <div className="stack" style={{ maxHeight: 330, overflowY: 'auto' }}>
            {alerts.slice(0, 8).map((a, i) => (
              <div key={i} className={`callout ${a.tone}`}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /><div><b>{a.title}</b><br />{a.text}</div></div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
