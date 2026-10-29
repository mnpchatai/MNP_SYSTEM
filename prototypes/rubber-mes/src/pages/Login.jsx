import { useState } from 'react';
import { BadgeCheck, Factory, KeyRound, Nfc } from 'lucide-react';
import { useStore } from '../data/store.jsx';
import { ROLES } from '../data/rbac.js';
import { DEMO_PASSWORD } from '../data/seed.js';
import { Button, Field, Input, Tabs } from '../components/ui.jsx';

export default function Login() {
  const { data, login, toast } = useStore();
  const [tab, setTab] = useState('password');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [badge, setBadge] = useState('');

  const signIn = (e) => {
    e.preventDefault();
    const u = data.users.find((x) => x.username === username.trim().toLowerCase() || x.badge === username.trim().toUpperCase());
    if (!u) return toast('ไม่พบชื่อผู้ใช้นี้', 'bad');
    if (secret !== DEMO_PASSWORD && secret !== u.pin) return toast('รหัสผ่านหรือ PIN ไม่ถูกต้อง', 'bad');
    login(u);
  };

  const badgeIn = (code) => {
    const u = data.users.find((x) => x.badge === code.trim().toUpperCase());
    if (!u) return toast(`ไม่พบบัตรพนักงาน ${code}`, 'bad');
    login(u);
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="row"><div className="brand-mark"><Factory size={19} color="#fff" /></div><b style={{ color: '#fff' }}>RubberFlow MES</b></div>
        <div className="stack" style={{ gap: 16 }}>
          <h1>ควบคุมการผลิตยางตั้งแต่ชั่งสารจนถึงกล่องสินค้า</h1>
          <p style={{ color: '#a9aeb4', maxWidth: 520 }}>
            ผสม → ฉีด → อบ → ตกแต่ง พร้อมกฎ FEFO, การชั่งแบบ Poka-Yoke, QC Hold อัตโนมัติ,
            การส่งมอบงานแบบ Gatekeeper และการสืบย้อนกลับถึงล็อตวัตถุดิบ
          </p>
          <div className="flow" style={{ maxWidth: 560 }}>
            {['ผสมยาง', 'ฉีดขึ้นรูป', 'อบ HCM', 'ตกแต่ง/บรรจุ'].map((s, i) => (
              <div key={s} className="step" style={{ background: '#272c31', borderColor: '#353b42', color: '#e7e9eb' }}>
                <div className="num">0{i + 1}</div>{s}
              </div>
            ))}
          </div>
        </div>
        <div className="small" style={{ color: '#737980' }}>ระบบสาธิต · ข้อมูลทั้งหมดเป็นข้อมูลสมมติ และเก็บไว้ในเบราว์เซอร์นี้เท่านั้น</div>
      </div>

      <div className="login-panel">
        <div className="card">
          <div className="card-body stack">
            <div><h2>เข้าสู่ระบบ</h2><p className="muted" style={{ margin: '4px 0 0' }}>ใช้ชื่อผู้ใช้ + รหัสผ่าน/PIN หรือแตะบัตรพนักงาน</p></div>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'password', label: 'รหัสผ่าน / PIN' }, { id: 'badge', label: 'บัตรพนักงาน' }]} />
            {tab === 'password' ? (
              <form className="stack" onSubmit={signIn}>
                <Field label="ชื่อผู้ใช้ หรือรหัสบัตร"><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="เช่น qc หรือ RF-1009" autoComplete="username" /></Field>
                <Field label="รหัสผ่าน หรือ PIN 4 หลัก" hint={`ข้อมูลสาธิต: รหัสผ่าน ${DEMO_PASSWORD} หรือ PIN ตามบัตร (1001–1009)`}>
                  <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="current-password" />
                </Field>
                <Button variant="primary" type="submit" icon={KeyRound}>เข้าสู่ระบบ</Button>
              </form>
            ) : (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); badgeIn(badge); }}>
                <div className="callout info" style={{ alignItems: 'center' }}><Nfc size={22} /> แตะบัตรที่เครื่องอ่าน หรือพิมพ์รหัสบัตรแล้วกด Enter</div>
                <Field label="รหัสบัตร"><Input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="RF-1005" /></Field>
                <Button variant="primary" type="submit" icon={BadgeCheck}>ยืนยันบัตร</Button>
              </form>
            )}
            <div className="stack" style={{ gap: 6 }}>
              <div className="small muted">เข้าสู่ระบบด่วนตามบทบาท (สาธิต)</div>
              <div className="role-grid">
                {data.users.map((u) => (
                  <button key={u.id} type="button" onClick={() => login(u)}>
                    <b>{ROLES[u.role].label}</b><br /><span className="muted">{u.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
