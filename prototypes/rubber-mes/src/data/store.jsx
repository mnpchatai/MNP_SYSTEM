import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as actions from './actions.js';
import { buildSeed } from './seed.js';

const KEY = 'rubberflow-mes-v1';
const SESSION_KEY = 'rubberflow-mes-session';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage unavailable: fall back to a fresh seed */ }
  return buildSeed();
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [data, setData] = useState(load);
  const [userId, setUserId] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  });
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { save(KEY, data); }, [data]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const user = data.users.find((u) => u.id === userId) || null;

  const toast = useCallback((text, tone = 'good') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3500);
  }, []);

  // Runs an action on a cloned draft. Returns the action result, or undefined when a rule blocked it.
  const run = useCallback((name, payload, successText) => {
    const draft = structuredClone(data);
    try {
      const result = actions[name](draft, payload, { now: Date.now(), user });
      setData(draft);
      setNow(Date.now());
      if (successText) toast(typeof successText === 'function' ? successText(result) : successText);
      return result ?? true;
    } catch (e) {
      toast(e.message, 'bad');
      return undefined;
    }
  }, [data, user, toast]);

  const login = useCallback((u) => {
    setUserId(u.id);
    save(SESSION_KEY, u.id);
    setData((d) => {
      const draft = structuredClone(d);
      draft.audit.unshift({ at: Date.now(), user: u.name, action: 'เข้าสู่ระบบ', detail: u.username });
      return draft;
    });
  }, []);

  const logout = useCallback(() => {
    setUserId(null);
    save(SESSION_KEY, null);
  }, []);

  const resetDemo = useCallback(() => {
    setData(buildSeed());
    toast('รีเซ็ตข้อมูลสาธิตเรียบร้อย');
  }, [toast]);

  const value = useMemo(() => ({ data, user, now, run, login, logout, resetDemo, toast, toasts }), [data, user, now, run, login, logout, resetDemo, toast, toasts]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
