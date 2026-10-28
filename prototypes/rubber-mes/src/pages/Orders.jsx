import { useState } from 'react';
import { Pause, Play, Plus, Printer, Send, X } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { useNav } from '../nav.js';
import { can } from '../data/rbac.js';
import { DAY } from '../lib/rules.js';
import { fmtDate, fmtNum, fromInputDate, toInputDate } from '../lib/format.js';
import { Button, Card, Field, Input, Modal, PageHead, Progress, Select, Status, Tabs, useForm } from '../components/ui.jsx';

const FILTERS = [
  { id: 'all', label: 'ทั้งหมด' }, { id: 'planned', label: 'วางแผน' }, { id: 'released', label: 'ปล่อยผลิต' },
  { id: 'in_progress', label: 'กำลังผลิต' }, { id: 'on_hold', label: 'พักงาน' }, { id: 'completed', label: 'เสร็จสิ้น' },
];

export default function Orders() {
  const { data, user, run } = useStore();
  const nav = useNav();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState(nav.param || '');
  const [creating, setCreating] = useState(false);
  const mayRelease = can(user, 'releaseOrder');

  const rows = [...data.orders]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((o) => filter === 'all' || o.status === filter)
    .filter((o) => !q || `${o.id} ${o.customer} ${o.customerPo} ${o.productCode} ${o.productName}`.toLowerCase().includes(q.toLowerCase()));

  const setStatus = (id, status, text) => run('setOrderStatus', { id, status }, text);

  return (
    <>
      <PageHead title="ใบสั่งผลิต" desc="วางแผน ปล่อยผลิต พักงาน และติดตามความคืบหน้าของแต่ละใบสั่งผลิต">
        {mayRelease && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>เปิดใบสั่งผลิต</Button>}
      </PageHead>
      <Card flush>
        <div className="row between" style={{ padding: '10px 14px' }}>
          <Tabs tabs={FILTERS.map((f) => ({ ...f, label: `${f.label} (${f.id === 'all' ? data.orders.length : data.orders.filter((o) => o.status === f.id).length})` }))} value={filter} onChange={setFilter} />
          <div style={{ width: 280 }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลขที่ ลูกค้า สินค้า…" /></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>เลขที่ / PO ลูกค้า</th><th>ลูกค้า</th><th>สินค้า / สูตร</th><th>จำนวน</th><th>ความคืบหน้า</th><th>เริ่ม – ส่ง</th><th>สถานะ</th><th className="right">จัดการ</th></tr></thead>
            <tbody>
              {rows.map((o) => {
                const late = o.dueDate < Date.now() && o.status !== 'completed';
                return (
                  <tr key={o.id}>
                    <td><span className="mono">{o.id}</span>{o.priority === 'urgent' && <> <span className="badge bad">ด่วน</span></>}<div className="small muted">{o.customerPo || '-'}</div></td>
                    <td>{o.customer}</td>
                    <td>{o.productName}<div className="small muted mono">{o.productCode} · {o.recipeId}</div></td>
                    <td className="nowrap">{fmtNum(o.targetQty)} {o.uom}<div className="small muted">สี{o.color}</div></td>
                    <td style={{ minWidth: 140 }}><Progress value={o.producedQty} max={o.targetQty} tone={late ? 'bad' : ''} /><div className="small muted">{fmtNum(o.producedQty)} ({Math.round((o.producedQty / o.targetQty) * 100)}%)</div></td>
                    <td className="nowrap small">{fmtDate(o.startDate)}<br /><span style={{ color: late ? 'var(--bad)' : undefined }}>{fmtDate(o.dueDate)}</span></td>
                    <td><Status value={o.status} /></td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" icon={Printer} onClick={() => nav.printTag('order', o.id)} aria-label="พิมพ์ป้าย" />
                        {mayRelease && o.status === 'planned' && <Button size="sm" variant="primary" icon={Send} onClick={() => setStatus(o.id, 'released', 'ปล่อยใบสั่งผลิตเข้าสายการผลิตแล้ว')}>ปล่อยผลิต</Button>}
                        {mayRelease && o.status === 'planned' && <Button size="sm" variant="danger" icon={X} onClick={() => confirm(`ยกเลิก ${o.id}?`) && setStatus(o.id, 'cancelled', 'ยกเลิกใบสั่งผลิตแล้ว')} aria-label="ยกเลิก" />}
                        {mayRelease && ['released', 'in_progress'].includes(o.status) && <Button size="sm" icon={Pause} onClick={() => setStatus(o.id, 'on_hold', 'พักใบสั่งผลิตแล้ว')}>พัก</Button>}
                        {mayRelease && o.status === 'on_hold' && <Button size="sm" icon={Play} onClick={() => setStatus(o.id, 'in_progress', 'ผลิตต่อแล้ว')}>ผลิตต่อ</Button>}
                        {mayRelease && o.status === 'in_progress' && o.producedQty > 0 && <Button size="sm" onClick={() => confirm('ปิดใบสั่งผลิตแม้ยังไม่ครบจำนวน?') && setStatus(o.id, 'completed', 'ปิดใบสั่งผลิตแล้ว')}>ปิดงาน</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="empty">ไม่พบใบสั่งผลิต</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {creating && <CreateOrder onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateOrder({ onClose }) {
  const { data, run } = useStore();
  const approved = data.recipes.filter((r) => r.status === 'approved');
  const [f, set] = useForm({
    customer: '', customerPo: '', recipeId: approved[0]?.id || '', targetQty: '', color: 'ดำ', priority: 'normal',
    startDate: toInputDate(Date.now() + DAY), dueDate: toInputDate(Date.now() + 10 * DAY), note: '',
  });
  const recipe = data.recipes.find((r) => r.id === f.recipeId);
  const kgNeeded = recipe && f.targetQty ? Number(f.targetQty) / recipe.yieldPerKg : 0;
  const submit = () => {
    const id = run('createOrder', { ...f, startDate: fromInputDate(f.startDate), dueDate: fromInputDate(f.dueDate) }, (r) => `เปิดใบสั่งผลิต ${r} แล้ว`);
    if (id) onClose();
  };
  return (
    <Modal title="เปิดใบสั่งผลิตใหม่" onClose={onClose} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" onClick={submit}>บันทึกใบสั่งผลิต</Button></>}>
      <div className="grid g2">
        <Field label="ลูกค้า *"><Input value={f.customer} onChange={set('customer')} /></Field>
        <Field label="เลขที่ PO ลูกค้า"><Input value={f.customerPo} onChange={set('customerPo')} /></Field>
        <Field label="สินค้า / สูตร (เฉพาะสูตรที่อนุมัติแล้ว) *">
          <Select value={f.recipeId} onChange={set('recipeId')} options={approved.map((r) => ({ value: r.id, label: `${r.productName} (${r.id})` }))} />
        </Field>
        <Field label={`จำนวนเป้าหมาย (${recipe?.uom || '-'}) *`} hint={kgNeeded ? `ต้องใช้คอมปาวด์ประมาณ ${fmtNum(kgNeeded, 1)} kg ≈ ${Math.ceil(kgNeeded / recipe.batchKg)} batch` : undefined}>
          <Input type="number" value={f.targetQty} onChange={set('targetQty')} />
        </Field>
        <Field label="สี"><Select value={f.color} onChange={set('color')} options={['ดำ', 'เทา', 'น้ำตาล']} /></Field>
        <Field label="ความเร่งด่วน"><Select value={f.priority} onChange={set('priority')} options={[{ value: 'normal', label: 'ปกติ' }, { value: 'urgent', label: 'ด่วน' }]} /></Field>
        <Field label="วันเริ่มผลิต *"><Input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="วันกำหนดส่ง *"><Input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
      </div>
      <div style={{ marginTop: 12 }}><Field label="หมายเหตุ / ข้อกำหนดพิเศษของลูกค้า"><textarea className="input" value={f.note} onChange={set('note')} /></Field></div>
    </Modal>
  );
}
