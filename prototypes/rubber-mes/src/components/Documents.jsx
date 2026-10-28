import { useEffect, useRef, useState } from 'react';
import { Camera, Printer, Search } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { canSee } from '../data/rbac.js';
import { lookupCode, parentLotIds } from '../lib/derive.js';
import { SPECS, STAGE_LABEL, lotState, specText } from '../lib/rules.js';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format.js';
import { Badge, Button, Input, Modal, Qr, Status } from './ui.jsx';

export const COMPANY = {
  name: 'บริษัท รับเบอร์โฟลว์ อินดัสทรี จำกัด (ข้อมูลสาธิต)',
  address: '99/9 หมู่ 4 นิคมอุตสาหกรรมตัวอย่าง จ.ชลบุรี 20000',
};

const KIND_LABEL = {
  order: 'ใบสั่งผลิต', lot: 'ล็อตงานระหว่างผลิต', box: 'กล่องสินค้าสำเร็จรูป', material: 'ล็อตวัตถุดิบ',
  requisition: 'ใบเบิกวัตถุดิบ', transfer: 'ใบส่งมอบ WIP', mold: 'แม่พิมพ์/หัวดาย',
};

const KIND_PAGE = { order: 'orders', lot: 'trace', box: 'trace', material: 'warehouse', requisition: 'requisition', transfer: 'wip', mold: 'molds' };

// ---------- Scan ----------

export function ScanModal({ initial, onClose }) {
  const { data, user } = useStore();
  const nav = useNav();
  const [code, setCode] = useState(initial || '');
  const [query, setQuery] = useState(initial || '');
  const [camera, setCamera] = useState(false);
  const hit = query ? lookupCode(data, query) : null;
  const samples = [data.fgBoxes[0]?.id, data.lots.find((l) => l.stage === 'mixing')?.id, data.materialLots[0]?.lotNo, data.orders[0]?.id].filter(Boolean);

  return (
    <Modal title="สแกนบาร์โค้ด / QR" onClose={onClose} wide>
      <div className="stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(code); }}>
          <div style={{ flex: 1 }}><Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="ใช้เครื่องสแกนยิงรหัส หรือพิมพ์แล้วกด Enter" /></div>
          <Button variant="primary" icon={Search} type="submit">ค้นหา</Button>
          {'BarcodeDetector' in window && <Button icon={Camera} onClick={() => setCamera((v) => !v)}>{camera ? 'ปิดกล้อง' : 'เปิดกล้อง'}</Button>}
        </form>
        {camera && <CameraScanner onCode={(c) => { setCode(c); setQuery(c); setCamera(false); }} />}
        <div className="row small muted">ตัวอย่างรหัส: {samples.map((s) => <button key={s} type="button" className="badge" style={{ cursor: 'pointer' }} onClick={() => { setCode(s); setQuery(s); }}>{s}</button>)}</div>
        {query && !hit && <div className="callout bad">ไม่พบรหัส “{query}” ในระบบ ตรวจสอบป้ายบาร์โค้ดอีกครั้ง</div>}
        {hit && (
          <div className="card card-body stack">
            <div className="row between">
              <div><div className="small muted">{KIND_LABEL[hit.kind]}</div><h3 className="mono">{hit.item.id || hit.item.lotNo}</h3></div>
              <div className="row">
                {['lot', 'box', 'material', 'order', 'requisition', 'transfer'].includes(hit.kind) && <Button icon={Printer} onClick={() => { onClose(); nav.printTag(hit.kind, hit.item.id || hit.item.lotNo); }}>พิมพ์ป้าย</Button>}
                {canSee(user, KIND_PAGE[hit.kind]) && <Button variant="primary" onClick={() => { onClose(); nav.go(KIND_PAGE[hit.kind], hit.item.id || hit.item.lotNo); }}>เปิดดูรายละเอียด</Button>}
              </div>
            </div>
            <ScanSummary hit={hit} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function ScanSummary({ hit }) {
  const { data, now } = useStore();
  const it = hit.item;
  if (hit.kind === 'material') {
    const m = data.materials.find((x) => x.code === it.materialCode);
    return <dl className="kv"><dt>วัตถุดิบ</dt><dd>{m?.name}</dd><dt>คงเหลือ</dt><dd>{fmtNum(it.qtyKg, 2)} kg</dd><dt>หมดอายุ</dt><dd>{fmtDate(it.expiry)}</dd><dt>สถานะ</dt><dd><Status value={lotState(it, now)} /></dd><dt>ที่เก็บ</dt><dd>{it.location}</dd></dl>;
  }
  if (hit.kind === 'lot') {
    return <dl className="kv"><dt>ขั้นตอน</dt><dd>{STAGE_LABEL[it.stage]}</dd><dt>ใบสั่งผลิต</dt><dd className="mono">{it.orderId}</dd><dt>งานดี</dt><dd>{fmtNum(it.goodQty, 2)} {it.uom}</dd><dt>QC</dt><dd><Status value={it.qc} /></dd><dt>บันทึกเมื่อ</dt><dd>{fmtDateTime(it.createdAt)} · {it.operator}</dd></dl>;
  }
  if (hit.kind === 'box') {
    return <dl className="kv"><dt>สินค้า</dt><dd>{it.productName}</dd><dt>จำนวน</dt><dd>{fmtNum(it.qty)} {it.uom}</dd><dt>เกรด</dt><dd>{it.grade}</dd><dt>สถานะ</dt><dd><Status value={it.status} /></dd><dt>ล็อตต้นทาง</dt><dd className="mono">{it.lotId}</dd></dl>;
  }
  if (hit.kind === 'order') {
    return <dl className="kv"><dt>ลูกค้า</dt><dd>{it.customer}</dd><dt>สินค้า</dt><dd>{it.productName}</dd><dt>ความคืบหน้า</dt><dd>{fmtNum(it.producedQty)} / {fmtNum(it.targetQty)} {it.uom}</dd><dt>สถานะ</dt><dd><Status value={it.status} /></dd></dl>;
  }
  if (hit.kind === 'transfer') {
    return <dl className="kv"><dt>เส้นทาง</dt><dd>{STAGE_LABEL[it.from]} → {STAGE_LABEL[it.to]}</dd><dt>ล็อต</dt><dd className="mono">{it.lotId}</dd><dt>จำนวน</dt><dd>{it.qtySent} {it.uom}</dd><dt>สถานะ</dt><dd><Status value={it.status} /></dd></dl>;
  }
  if (hit.kind === 'requisition') {
    return <dl className="kv"><dt>ใบสั่งผลิต</dt><dd className="mono">{it.orderId}</dd><dt>จำนวน</dt><dd>{it.batches} batch · {fmtNum(it.totalKg, 2)} kg</dd><dt>สถานะ</dt><dd><Status value={it.status} /></dd></dl>;
  }
  return <dl className="kv"><dt>ชื่อ</dt><dd>{it.name}</dd><dt>รอบตั้งแต่ล้าง</dt><dd>{fmtNum(it.usageSinceClean)} / {fmtNum(it.cleanEvery)}</dd></dl>;
}

function CameraScanner({ onCode }) {
  const video = useRef(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream;
    let stop = false;
    const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      stream = s;
      video.current.srcObject = s;
      video.current.play();
      const tick = async () => {
        if (stop) return;
        try {
          const codes = await detector.detect(video.current);
          if (codes[0]) { handler.current(codes[0].rawValue); return; }
        } catch { /* frame not ready */ }
        requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => setErr('เปิดกล้องไม่ได้ (ไม่ได้รับอนุญาตหรือไม่มีกล้อง)'));
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return err ? <div className="callout warn">{err}</div> : <video ref={video} muted playsInline style={{ width: '100%', maxHeight: 280, background: '#000', borderRadius: 8 }} />;
}

// ---------- Traveler tag ----------

export function TagModal({ kind, id, onClose }) {
  const { data } = useStore();
  const hit = lookupCode(data, id);
  if (!hit) return null;
  const it = hit.item;
  const order = data.orders.find((o) => o.id === (it.orderId || it.id));
  const rows = [];
  if (kind === 'lot') rows.push(['ขั้นตอน', STAGE_LABEL[it.stage]], ['จำนวนงานดี', `${fmtNum(it.goodQty, 2)} ${it.uom}`], ['QC', it.qc.toUpperCase()], ['ล็อตต้นทาง', parentLotIds(data, it).join(', ') || (it.sources?.[0]?.id ?? '-')]);
  if (kind === 'box') rows.push(['สินค้า', it.productName], ['จำนวน', `${fmtNum(it.qty)} ${it.uom}`], ['เกรด', it.grade], ['ล็อตตกแต่ง', it.lotId]);
  if (kind === 'material') {
    const m = data.materials.find((x) => x.code === it.materialCode);
    rows.push(['วัตถุดิบ', m?.name], ['รับเข้า', `${fmtNum(it.initialKg, 2)} kg`], ['หมดอายุ', fmtDate(it.expiry)], ['ผู้ขาย', it.supplier]);
  }
  if (kind === 'requisition') rows.push(['จำนวน', `${it.batches} batch · ${fmtNum(it.totalKg, 2)} kg`], ['รายการ', `${it.lines.length} ล็อตวัตถุดิบ`]);
  if (kind === 'transfer') rows.push(['เส้นทาง', `${STAGE_LABEL[it.from]} → ${STAGE_LABEL[it.to]}`], ['ล็อต', it.lotId], ['จำนวนส่ง', `${it.qtySent} ${it.uom}`]);
  if (kind === 'order') rows.push(['ลูกค้า', it.customer], ['จำนวน', `${fmtNum(it.targetQty)} ${it.uom}`], ['กำหนดส่ง', fmtDate(it.dueDate)]);
  const code = it.id || it.lotNo;
  return (
    <Modal title="ป้ายติดตามงาน (Traveler Tag)" onClose={onClose} footer={<><Button onClick={onClose}>ปิด</Button><Button variant="primary" icon={Printer} onClick={() => window.print()}>พิมพ์</Button></>}>
      <div className="tag printable">
        <div className="stack" style={{ gap: 6 }}>
          <div className="small">{COMPANY.name}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }} className="mono">{code}</div>
          <div><b>{KIND_LABEL[kind]}</b>{order && kind !== 'order' ? ` · ${order.id}` : ''}</div>
          {order && <div className="small">{order.productName} · {order.customer}</div>}
          <table className="small">
            <tbody>{rows.map(([k, v]) => <tr key={k}><td style={{ padding: '2px 8px 2px 0', border: 0 }}>{k}</td><td style={{ padding: 2, border: 0 }}><b>{v}</b></td></tr>)}</tbody>
          </table>
          <div className="small">พิมพ์เมื่อ {fmtDateTime(Date.now())}</div>
        </div>
        <Qr text={code} size={128} />
      </div>
    </Modal>
  );
}

// ---------- Certificate of Analysis ----------

export function CoaModal({ lotId, onClose }) {
  const { data } = useStore();
  const lot = data.lots.find((l) => l.id === lotId);
  if (!lot) return null;
  const order = data.orders.find((o) => o.id === lot.orderId);
  const recipe = data.recipes.find((r) => r.id === order?.recipeId);
  // Collect lab results from this lot and every upstream lot.
  const chain = [];
  const walk = (l) => { chain.push(l); parentLotIds(data, l).forEach((pid) => { const p = data.lots.find((x) => x.id === pid); if (p) walk(p); }); };
  walk(lot);
  const records = data.qcRecords.filter((r) => chain.some((c) => c.id === r.lotId));
  const latest = {};
  records.forEach((r) => r.tests.forEach((t) => { if (!latest[t.key] || latest[t.key].at < r.at) latest[t.key] = { ...t, at: r.at, lotId: r.lotId }; }));
  const curing = chain.find((c) => c.stage === 'curing');
  const allPass = Object.values(latest).every((t) => t.pass) && lot.qc === 'pass';
  const boxes = data.fgBoxes.filter((b) => b.lotId === lot.id);
  return (
    <Modal wide title={`ใบรับรองผลวิเคราะห์ (CoA) · ${lot.id}`} onClose={onClose} footer={<><Button onClick={onClose}>ปิด</Button><Button variant="primary" icon={Printer} onClick={() => window.print()}>พิมพ์ / บันทึก PDF</Button></>}>
      <div className="doc printable stack">
        <div className="row between">
          <div><h2>CERTIFICATE OF ANALYSIS</h2><div className="small">{COMPANY.name}<br />{COMPANY.address}</div></div>
          <Qr text={lot.id} size={84} />
        </div>
        <dl className="kv">
          <dt>ลูกค้า</dt><dd>{order?.customer} (PO {order?.customerPo || '-'})</dd>
          <dt>สินค้า</dt><dd>{order?.productCode} · {order?.productName}</dd>
          <dt>สูตร</dt><dd>{recipe?.id} Rev.{recipe?.revision}</dd>
          <dt>ล็อต</dt><dd className="mono">{lot.id} (ผลิต {fmtDate(lot.createdAt)})</dd>
          <dt>จำนวน</dt><dd>{fmtNum(lot.goodQty)} {lot.uom} · {boxes.length} กล่อง · เกรด {lot.grade || 'A'}</dd>
          {curing && <><dt>สภาวะอบ</dt><dd>{curing.params.temp}°C · {curing.params.time} s · {curing.params.pressure} bar ({curing.id})</dd></>}
        </dl>
        <table className="small">
          <thead><tr><th>รายการทดสอบ</th><th>วิธีทดสอบ</th><th>สเปก</th><th>ผลทดสอบ</th><th>ผล</th></tr></thead>
          <tbody>
            {Object.entries(SPECS.lab).map(([k, spec]) => (
              <tr key={k}>
                <td>{spec.label}</td><td>{spec.method}</td><td>{specText(spec)}</td>
                <td>{latest[k] ? `${latest[k].value} ${spec.unit}` : 'ไม่ได้ทดสอบ'}</td>
                <td>{latest[k] ? (latest[k].pass ? 'PASS' : 'FAIL') : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><b>สรุปผล: {allPass ? 'ผ่านเกณฑ์ (ACCEPTED)' : 'ยังไม่สามารถรับรองได้'}</b></div>
        {!allPass && <Badge tone="bad">มีรายการไม่ผ่านหรือล็อตยังถูกกักกัน</Badge>}
        <div className="row between small" style={{ marginTop: 24 }}>
          <div>ผู้ตรวจสอบ: {records[0]?.inspector || '-'}<br />วันที่ออก: {fmtDate(Date.now())}</div>
          <div>________________________<br />ผู้อนุมัติ (QA)</div>
        </div>
      </div>
    </Modal>
  );
}
