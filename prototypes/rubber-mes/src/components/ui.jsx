import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X } from 'lucide-react';
import { inSpec, specText } from '../lib/rules.js';

export function PageHead({ title, desc, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children, flush, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{title}</h3>
          <div className="row">{actions}</div>
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card stat">
      <div className="label">{Icon && <Icon size={14} />} {label}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Badge({ tone, children }) {
  return <span className={`badge ${tone || ''}`}>{children}</span>;
}

const STATUS = {
  planned: ['', 'วางแผน'], released: ['info', 'ปล่อยผลิต'], in_progress: ['accent', 'กำลังผลิต'], on_hold: ['warn', 'พักงาน'],
  completed: ['good', 'เสร็จสิ้น'], cancelled: ['bad', 'ยกเลิก'],
  pass: ['good', 'ผ่าน'], hold: ['warn', 'กักกัน (Hold)'], fail: ['bad', 'ไม่ผ่าน'],
  weighing: ['warn', 'กำลังชั่ง'], issued: ['info', 'จ่ายครบ รอผสม'], consumed: ['good', 'ใช้ผสมแล้ว'],
  in_transit: ['warn', 'รอรับมอบ'], received: ['good', 'รับมอบแล้ว'],
  open: ['bad', 'เปิดอยู่'], closed: ['good', 'ปิดแล้ว'],
  available: ['good', 'พร้อมใช้'], expired: ['bad', 'หมดอายุ (บล็อก)'], empty: ['', 'หมด'],
  in_stock: ['good', 'ในคลัง'], shipped: ['info', 'ส่งมอบแล้ว'],
  draft: ['warn', 'รออนุมัติ'], approved: ['good', 'อนุมัติแล้ว'],
  critical: ['bad', 'Critical'], major: ['warn', 'Major'], minor: ['', 'Minor'],
};

export function Status({ value }) {
  const [tone, label] = STATUS[value] || ['', value];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Button({ variant, size, icon: Icon, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${variant || ''} ${size || ''} ${className}`} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="ปิด"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Input(props) {
  return <input className="input" {...props} />;
}

export function Select({ options, placeholder, ...rest }) {
  return (
    <select className="input" {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
    </select>
  );
}

// Numeric input that turns green/red against a spec as the operator types.
export function SpecInput({ label, spec, value, onChange, step = 'any' }) {
  const filled = value !== '' && value !== undefined;
  const ok = filled && inSpec(value, spec);
  return (
    <Field label={`${label} (${spec.unit})`} hint={`มาตรฐาน ${specText(spec)}`}>
      <input type="number" step={step} className={`input ${filled ? (ok ? 'ok' : 'out') : ''}`} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function Progress({ value, max, tone }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return <div className={`bar ${tone || ''}`}><div style={{ width: `${pct}%` }} /></div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Callout({ tone = 'info', icon: Icon, children }) {
  return <div className={`callout ${tone}`}>{Icon && <Icon size={16} style={{ flexShrink: 0, marginTop: 2 }} />}<div>{children}</div></div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Qr({ text, size = 120 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc(''));
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt={`QR ${text}`} /> : <div style={{ width: size, height: size }} />;
}

export function useForm(initial) {
  const [form, setForm] = useState(initial);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v && v.target ? v.target.value : v }));
  return [form, set, setForm];
}
