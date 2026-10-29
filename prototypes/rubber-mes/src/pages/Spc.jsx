import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../data/store.jsx';
import { SPECS, cpkVerdict, specLimits, specText, stats } from '../lib/rules.js';
import { fmtDate } from '../lib/format.js';
import { Badge, Card, Field, PageHead, Select } from '../components/ui.jsx';

// Each characteristic: where the value comes from and which spec applies.
const CHARS = [
  ...['thickness', 'width', 'weightPerM'].map((k) => ({ id: `ex.${k}`, label: `ฉีด · ${SPECS.extrusion[k].label}`, spec: SPECS.extrusion[k], source: (d) => d.lots.filter((l) => l.stage === 'extrusion').map((l) => ({ id: l.id, at: l.createdAt, v: l.params[k] })) })),
  ...['temp', 'time', 'pressure'].map((k) => ({ id: `cu.${k}`, label: `อบ · ${SPECS.curing[k].label}`, spec: SPECS.curing[k], source: (d) => d.lots.filter((l) => l.stage === 'curing').map((l) => ({ id: l.id, at: l.createdAt, v: l.params[k] })) })),
  ...Object.entries(SPECS.lab).map(([k, spec]) => ({ id: `lab.${k}`, label: `แล็บ · ${spec.label}`, spec, source: (d) => d.qcRecords.flatMap((r) => r.tests.filter((t) => t.key === k).map((t) => ({ id: r.lotId, at: r.at, v: t.value }))) })),
  { id: 'mx.dump', label: 'ผสม · Dump temp (สูตร EPDM)', spec: { label: 'Dump temp', unit: '°C', target: 140, tol: 6 }, source: (d) => d.lots.filter((l) => l.stage === 'mixing' && l.recipeId === 'RC-EPDM-DS01').map((l) => ({ id: l.id, at: l.createdAt, v: l.params.dumpTemp })) },
];

export default function Spc() {
  const { data } = useStore();
  const [charId, setCharId] = useState('ex.thickness');
  const ch = CHARS.find((c) => c.id === charId);
  const { lsl, usl } = specLimits(ch.spec);
  const points = useMemo(() => ch.source(data).sort((a, b) => a.at - b.at).map((p, i) => ({ ...p, n: i + 1, label: fmtDate(p.at) })), [ch, data]);
  const s = stats(points.map((p) => p.v), lsl, usl);
  const verdict = cpkVerdict(s?.cpk);
  const hist = useMemo(() => {
    if (!s) return [];
    const lo = Math.min(s.min, lsl ?? s.min);
    const hi = Math.max(s.max, usl ?? s.max);
    const bins = 10;
    const w = (hi - lo) / bins || 1;
    const arr = [...Array(bins)].map((_, i) => ({ bin: +(lo + w * (i + 0.5)).toPrecision(4), count: 0 }));
    points.forEach((p) => { arr[Math.min(bins - 1, Math.floor((p.v - lo) / w))].count += 1; });
    return arr;
  }, [points, s, lsl, usl]);
  const pad = s ? (Math.max(usl ?? s.ucl, s.ucl) - Math.min(lsl ?? s.lcl, s.lcl)) * 0.15 : 1;
  const domain = s ? [Math.min(lsl ?? s.lcl, s.lcl) - pad, Math.max(usl ?? s.ucl, s.ucl) + pad] : ['auto', 'auto'];
  const ooc = s ? points.filter((p) => p.v > s.ucl || p.v < s.lcl) : [];
  const oos = points.filter((p) => (usl !== undefined && p.v > usl) || (lsl !== undefined && p.v < lsl));
  const r = (x, n = 3) => (x === undefined ? '-' : x.toFixed(n));

  return (
    <>
      <PageHead title="SPC / ความสามารถของกระบวนการ" desc="แผนภูมิควบคุมค่ารายตัว (I-chart), ฮิสโตแกรม และดัชนี Cp / Cpk คำนวณจากข้อมูลการผลิตจริงในระบบ">
        <div style={{ width: 320 }}><Field><Select value={charId} onChange={(e) => setCharId(e.target.value)} options={CHARS.map((c) => ({ value: c.id, label: c.label }))} /></Field></div>
      </PageHead>
      <div className="grid g4">
        <div className="card stat"><div className="label">Cpk</div><div className="value" style={{ color: `var(--${verdict.tone === 'muted' ? 'muted' : verdict.tone})` }}>{r(s?.cpk, 2)}</div><div className="sub">{verdict.text}</div></div>
        <div className="card stat"><div className="label">Cp / Ppk</div><div className="value">{r(s?.cp, 2)} / {r(s?.ppk, 2)}</div><div className="sub">Ppk ใช้ σ รวมทั้งหมด</div></div>
        <div className="card stat"><div className="label">ค่าเฉลี่ย / σ (MR)</div><div className="value" style={{ fontSize: 20 }}>{r(s?.mean)} / {r(s?.sdWithin)}</div><div className="sub">n = {s?.n ?? points.length} · สเปก {specText(ch.spec)}</div></div>
        <div className="card stat"><div className="label">จุดผิดปกติ</div><div className="value" style={{ fontSize: 20 }}>{ooc.length} นอก CL · {oos.length} นอกสเปก</div><div className="sub">UCL {r(s?.ucl)} · LCL {r(s?.lcl)}</div></div>
      </div>
      <Card title={`I-chart · ${ch.label}`}>
        {points.length < 2 ? <div className="empty">ข้อมูลไม่พอสำหรับคำนวณ</div> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={points} margin={{ left: 0, right: 30, top: 10 }}>
              <CartesianGrid stroke="#e4e0d8" vertical={false} />
              <XAxis dataKey="n" tick={{ fontSize: 11 }} />
              <YAxis domain={domain} tick={{ fontSize: 11 }} tickFormatter={(v) => +v.toPrecision(4)} />
              <Tooltip formatter={(v) => [v, ch.spec.unit]} labelFormatter={(n) => `${points[n - 1]?.id} · ${points[n - 1]?.label}`} />
              {usl !== undefined && <ReferenceLine y={usl} stroke="#b91c1c" strokeDasharray="6 3" label={{ value: 'USL', fontSize: 11, position: 'right' }} />}
              {lsl !== undefined && <ReferenceLine y={lsl} stroke="#b91c1c" strokeDasharray="6 3" label={{ value: 'LSL', fontSize: 11, position: 'right' }} />}
              {s && <ReferenceLine y={s.ucl} stroke="#b45309" strokeDasharray="2 3" label={{ value: 'UCL', fontSize: 11, position: 'right' }} />}
              {s && <ReferenceLine y={s.lcl} stroke="#b45309" strokeDasharray="2 3" label={{ value: 'LCL', fontSize: 11, position: 'right' }} />}
              {s && <ReferenceLine y={s.mean} stroke="#0f766e" label={{ value: 'X̄', fontSize: 11, position: 'right' }} />}
              <Line dataKey="v" stroke="#1f2328" strokeWidth={1.5} dot={(p) => {
                const bad = (usl !== undefined && p.payload.v > usl) || (lsl !== undefined && p.payload.v < lsl);
                return <circle key={p.key} cx={p.cx} cy={p.cy} r={bad ? 5 : 3} fill={bad ? '#b91c1c' : '#0f766e'} />;
              }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
      <div className="grid g2">
        <Card title="ฮิสโตแกรม">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hist} margin={{ left: -10, right: 10 }}>
              <CartesianGrid stroke="#e4e0d8" vertical={false} />
              <XAxis dataKey="bin" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="จำนวน" fill="#0f766e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="ค่าที่หลุดสเปก" flush>
          {oos.length === 0 ? <div className="empty">ไม่มีค่าที่หลุดสเปก</div> : (
            <table><thead><tr><th>ล็อต</th><th>วันที่</th><th className="right">ค่า</th></tr></thead>
              <tbody>{oos.map((p) => <tr key={`${p.id}-${p.at}`}><td className="mono">{p.id}</td><td>{p.label}</td><td className="right"><Badge tone="bad">{p.v} {ch.spec.unit}</Badge></td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
