import { useState } from 'react';
import { useStore } from '../data/store.jsx';
import { fmtDateTime } from '../lib/format.js';
import { Card, Input, PageHead } from '../components/ui.jsx';

export default function Audit() {
  const { data } = useStore();
  const [q, setQ] = useState('');
  const rows = data.audit.filter((a) => !q || `${a.user} ${a.action} ${a.detail}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead title="บันทึกการใช้งาน (Audit Trail)" desc="ทุกการเข้าสู่ระบบและทุกธุรกรรมถูกบันทึกพร้อมชื่อผู้ทำและเวลา">
        <div style={{ width: 280 }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาผู้ใช้ การกระทำ หรือรหัส…" /></div>
      </PageHead>
      <Card flush>
        <div className="table-wrap">
          <table>
            <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead>
            <tbody>
              {rows.slice(0, 300).map((a, i) => (
                <tr key={i}><td className="nowrap small">{fmtDateTime(a.at)}</td><td>{a.user}</td><td>{a.action}</td><td className="mono small">{a.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
