import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Search } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { backwardTree, forwardTree, lookupCode } from '../lib/derive.js';
import { STAGE_LABEL } from '../lib/rules.js';
import { fmtDateTime, fmtNum } from '../lib/format.js';
import { Button, Callout, Card, Input, PageHead, Status } from '../components/ui.jsx';

export default function Trace() {
  const { data } = useStore();
  const nav = useNav();
  const [code, setCode] = useState(nav.param || '');
  const [query, setQuery] = useState(nav.param || '');
  const hit = query ? lookupCode(data, query) : null;
  const samples = [data.fgBoxes.find((b) => b.status === 'in_stock')?.id, data.lots.find((l) => l.stage === 'curing')?.id, data.requisitions.find((r) => r.status === 'consumed')?.lines[0]?.lotNo].filter(Boolean);

  let backward = null;
  let forward = null;
  let note = '';
  if (hit?.kind === 'box') {
    const lotTree = backwardTree(data, hit.item.lotId);
    backward = { kind: 'box', id: hit.item.id, item: hit.item, children: lotTree ? [lotTree] : [] };
  } else if (hit?.kind === 'lot') {
    backward = backwardTree(data, hit.item.id);
    forward = forwardTree(data, hit);
  } else if (hit?.kind === 'material') {
    forward = forwardTree(data, hit);
  } else if (hit) {
    note = 'การสืบย้อนกลับรองรับรหัสกล่อง ล็อตงานระหว่างผลิต และล็อตวัตถุดิบ';
  }

  return (
    <>
      <PageHead title="สืบย้อนกลับ (Traceability)" desc="ย้อนจากกล่องสินค้าไปถึงล็อตวัตถุดิบ หรือไล่ไปข้างหน้าจากล็อตวัตถุดิบว่าถูกใช้ในกล่องใดบ้าง (สำหรับกรณีเรียกคืนสินค้า)" />
      <Card>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(code); }}>
          <div style={{ flex: 1, minWidth: 240 }}><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="สแกนหรือพิมพ์รหัสกล่อง ล็อต หรือล็อตวัตถุดิบ" /></div>
          <Button variant="primary" icon={Search} type="submit">ค้นหา</Button>
        </form>
        <div className="row small muted" style={{ marginTop: 8 }}>ตัวอย่าง: {samples.map((s) => <button key={s} type="button" className="badge" style={{ cursor: 'pointer' }} onClick={() => { setCode(s); setQuery(s); }}>{s}</button>)}</div>
      </Card>
      {query && !hit && <Callout tone="bad">ไม่พบรหัส “{query}”</Callout>}
      {note && <Callout tone="info">{note}</Callout>}
      <div className="grid g2">
        {backward && (
          <Card title={<span className="row"><ArrowDownToLine size={16} /> ย้อนกลับไปต้นทาง</span>}>
            <ul className="tree" style={{ borderLeft: 0, paddingLeft: 0 }}><TreeNode node={backward} hitId={hit.item.id} /></ul>
          </Card>
        )}
        {forward && (
          <Card title={<span className="row"><ArrowUpFromLine size={16} /> ไปข้างหน้า (ใช้ที่ไหนบ้าง)</span>}>
            <ul className="tree" style={{ borderLeft: 0, paddingLeft: 0 }}><TreeNode node={forward} hitId={hit.item.id || hit.item.lotNo} /></ul>
            <ForwardSummary node={forward} />
          </Card>
        )}
      </div>
    </>
  );
}

function ForwardSummary({ node }) {
  const boxes = [];
  const walk = (n) => { if (n.kind === 'box') boxes.push(n.item); (n.children || []).forEach(walk); };
  walk(node);
  if (!boxes.length) return <div className="small muted" style={{ marginTop: 10 }}>ยังไม่ถูกบรรจุเป็นสินค้าสำเร็จรูป</div>;
  const shipped = boxes.filter((b) => b.status === 'shipped').length;
  return <Callout tone="warn">ขอบเขตที่ได้รับผลกระทบ: {boxes.length} กล่อง ({shipped} กล่องส่งมอบลูกค้าแล้ว)</Callout>;
}

function TreeNode({ node, hitId }) {
  const { data } = useStore();
  const it = node.item;
  let title = node.id;
  let sub = '';
  let status = null;
  if (node.kind === 'lot') { sub = `${STAGE_LABEL[it.stage]} · ${fmtNum(it.goodQty, 2)} ${it.uom} · ${fmtDateTime(it.createdAt)}`; status = it.qc; }
  if (node.kind === 'box') { sub = `กล่อง · ${it.productName} · ${fmtNum(it.qty)} ${it.uom}`; status = it.status; }
  if (node.kind === 'requisition') sub = `ใบเบิก · ${it.batches} batch · ${fmtNum(it.totalKg, 1)} kg`;
  if (node.kind === 'material') {
    const m = data.materials.find((x) => x.code === it?.materialCode);
    title = node.id;
    sub = `วัตถุดิบ · ${m?.name}${node.kg ? ` · ใช้ ${fmtNum(node.kg, 3)} kg` : ''} · ${it?.supplier}`;
  }
  return (
    <li>
      <div className={`node ${node.id === hitId ? 'hit' : ''}`}>
        <div className="row"><b className="mono">{title}</b>{status && <Status value={status} />}</div>
        <div className="small muted">{sub}</div>
      </div>
      {node.children?.length > 0 && <ul className="tree">{node.children.map((c) => <TreeNode key={`${c.kind}-${c.id}`} node={c} hitId={hitId} />)}</ul>}
    </li>
  );
}
