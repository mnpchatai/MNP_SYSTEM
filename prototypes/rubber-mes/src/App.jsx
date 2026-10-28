import { useMemo, useState } from 'react';
import {
  Bell, Boxes, ClipboardList, Factory, FlaskConical, Flame, GitBranch, History, LayoutDashboard, LineChart,
  LogOut, Menu, PackageCheck, Repeat, RotateCcw, ScanLine, ShieldCheck, Scale, Truck, Waves, Wrench,
} from 'lucide-react';
import { useStore } from './data/store.jsx';
import { MODULES, ROLES, canSee } from './data/rbac.js';
import { NavContext } from './nav.js';
import { buildAlerts } from './lib/derive.js';
import { Badge, Button, Modal } from './components/ui.jsx';
import { ScanModal, TagModal, CoaModal } from './components/Documents.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Orders from './pages/Orders.jsx';
import Recipes from './pages/Recipes.jsx';
import Requisition from './pages/Requisition.jsx';
import Mixing from './pages/Mixing.jsx';
import Extrusion from './pages/Extrusion.jsx';
import Curing from './pages/Curing.jsx';
import Finishing from './pages/Finishing.jsx';
import Wip from './pages/Wip.jsx';
import Quality from './pages/Quality.jsx';
import Spc from './pages/Spc.jsx';
import Trace from './pages/Trace.jsx';
import Warehouse from './pages/Warehouse.jsx';
import Molds from './pages/Molds.jsx';
import Audit from './pages/Audit.jsx';

const PAGES = {
  dashboard: [Dashboard, LayoutDashboard], orders: [Orders, ClipboardList], recipes: [Recipes, FlaskConical],
  requisition: [Requisition, Scale], mixing: [Mixing, Waves], extrusion: [Extrusion, Repeat], curing: [Curing, Flame],
  finishing: [Finishing, PackageCheck], wip: [Wip, Truck], quality: [Quality, ShieldCheck], spc: [Spc, LineChart],
  trace: [Trace, GitBranch], warehouse: [Warehouse, Boxes], molds: [Molds, Wrench], audit: [Audit, History],
};

export default function App() {
  const { data, user, now, logout, resetDemo, login } = useStore();
  const [page, setPage] = useState('dashboard');
  const [param, setParam] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scan, setScan] = useState(null);
  const [doc, setDoc] = useState(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);

  const alerts = useMemo(() => buildAlerts(data, now), [data, now]);
  const counts = useMemo(() => ({
    wip: data.transfers.filter((t) => t.status === 'in_transit').length,
    requisition: data.requisitions.filter((r) => r.status === 'weighing').length,
    quality: data.lots.filter((l) => l.qc === 'hold').length,
  }), [data]);

  const nav = useMemo(() => ({
    page,
    param,
    go: (p, prm = null) => { setPage(p); setParam(prm); setMenuOpen(false); window.scrollTo(0, 0); },
    openScan: (code = '') => setScan({ code }),
    printTag: (kind, id) => setDoc({ type: 'tag', kind, id }),
    printCoa: (lotId) => setDoc({ type: 'coa', lotId }),
  }), [page, param]);

  if (!user) return <Login />;

  const allowed = canSee(user, page);
  const [PageComp] = PAGES[page];
  const visible = MODULES.filter((m) => canSee(user, m.id));
  const groups = [...new Set(visible.map((m) => m.group))];

  return (
    <NavContext.Provider value={nav}>
      <div className="shell">
        <aside className={`side ${menuOpen ? 'open' : ''}`}>
          <div className="brand">
            <div className="brand-mark"><Factory size={19} color="#fff" /></div>
            <div><b>RubberFlow MES</b><span>ระบบควบคุมการผลิตยาง</span></div>
          </div>
          {groups.map((g) => (
            <div className="nav-group" key={g}>
              <div>{g}</div>
              {visible.filter((m) => m.group === g).map((m) => {
                const Icon = PAGES[m.id][1];
                return (
                  <button key={m.id} type="button" className={`nav-item ${page === m.id ? 'active' : ''}`} onClick={() => nav.go(m.id)}>
                    <Icon size={16} /> {m.label}
                    {counts[m.id] > 0 && <span className="count">{counts[m.id]}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="side-foot stack">
            <div>บทบาท: <b style={{ color: '#fff' }}>{ROLES[user.role].label}</b><br />เข้าถึงได้ {ROLES[user.role].modules.length} โมดูล</div>
            <button type="button" className="nav-item" onClick={() => { if (confirm('ล้างข้อมูลที่บันทึกทั้งหมดแล้วสร้างข้อมูลสาธิตใหม่?')) resetDemo(); }}>
              <RotateCcw size={15} /> รีเซ็ตข้อมูลสาธิต
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <Button variant="ghost" className="menu-btn" icon={Menu} onClick={() => setMenuOpen((v) => !v)} aria-label="เมนู" />
            <form className="search" onSubmit={(e) => { e.preventDefault(); nav.openScan(e.currentTarget.code.value); e.currentTarget.reset(); }}>
              <ScanLine size={16} />
              <input name="code" placeholder="สแกนหรือพิมพ์รหัส: ล็อต, กล่อง, ใบสั่งผลิต, ล็อตวัตถุดิบ…" aria-label="สแกนรหัส" />
            </form>
            <div className="row" style={{ marginLeft: 'auto' }}>
              <Button variant="ghost" icon={Bell} onClick={() => setShowAlerts(true)} aria-label="การแจ้งเตือน">
                {alerts.length > 0 && <Badge tone={alerts.some((a) => a.tone === 'bad') ? 'bad' : 'warn'}>{alerts.length}</Badge>}
              </Button>
              <button type="button" className="user-chip" onClick={() => setShowSwitch(true)} title="สลับผู้ใช้ (โหมดสาธิต)" style={{ cursor: 'pointer' }}>
                <span className="avatar">{user.name.slice(0, 1)}</span>
                <span className="small"><b>{user.name}</b><br /><span className="muted">{ROLES[user.role].label}</span></span>
              </button>
              <Button variant="ghost" icon={LogOut} onClick={logout} aria-label="ออกจากระบบ" />
            </div>
          </header>

          <main className="content">
            {allowed ? <PageComp /> : (
              <div className="card card-body stack" style={{ maxWidth: 560 }}>
                <h2>ไม่มีสิทธิ์เข้าถึงโมดูลนี้</h2>
                <p className="muted">บทบาท “{ROLES[user.role].label}” เข้าถึงได้เฉพาะโมดูลที่แสดงในเมนูด้านซ้าย</p>
                <div><Button variant="primary" onClick={() => nav.go(ROLES[user.role].modules[0])}>กลับหน้าหลัก</Button></div>
              </div>
            )}
          </main>
        </div>
      </div>

      {showAlerts && (
        <Modal title={`การแจ้งเตือน (${alerts.length})`} onClose={() => setShowAlerts(false)}>
          {alerts.length === 0 ? <p className="muted">ไม่มีการแจ้งเตือน</p> : (
            <div className="stack">
              {alerts.map((a, i) => (
                <div key={i} className={`callout ${a.tone}`} style={{ justifyContent: 'space-between' }}>
                  <div><b>{a.title}</b><br />{a.text}</div>
                  {canSee(user, a.module) && <Button size="sm" onClick={() => { setShowAlerts(false); nav.go(a.module); }}>ไปที่หน้า</Button>}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {showSwitch && (
        <Modal title="สลับผู้ใช้งาน (โหมดสาธิต)" onClose={() => setShowSwitch(false)}>
          <div className="stack">
            {data.users.map((u) => (
              <button key={u.id} type="button" className="list-item row between" style={{ border: '1px solid var(--line)', borderRadius: 8, background: u.id === user.id ? 'var(--accent-soft)' : 'var(--surface)' }}
                onClick={() => { login(u); setShowSwitch(false); if (!canSee(u, page)) nav.go('dashboard'); }}>
                <span><b>{u.name}</b> <span className="muted">· {ROLES[u.role].label}</span></span>
                <span className="small muted">{ROLES[u.role].modules.length} โมดูล</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {scan && <ScanModal initial={scan.code} onClose={() => setScan(null)} />}
      {doc?.type === 'tag' && <TagModal kind={doc.kind} id={doc.id} onClose={() => setDoc(null)} />}
      {doc?.type === 'coa' && <CoaModal lotId={doc.lotId} onClose={() => setDoc(null)} />}
      <Toasts />
    </NavContext.Provider>
  );
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
    </div>
  );
}
