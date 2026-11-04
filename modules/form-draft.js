// ร่างฟอร์มบนเครื่อง (localStorage) ต่อประเภทคำร้อง ต่อผู้ใช้ — ปิดแอปหรือเน็ตหลุดกลางทางแล้วกลับมากรอกต่อได้
// เก็บเฉพาะค่าที่พิมพ์/เลือก ไม่เก็บไฟล์แนบ; storage ใช้ไม่ได้ (โหมดส่วนตัว, ปิดไว้) = ทำงานต่อโดยไม่มีร่าง
(function (root) {
  "use strict";

  const VERSION = 1;
  const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  function defaultStorage() {
    try { return root.localStorage ?? null; } catch { return null; }
  }

  // ค่าว่างทั้งหมด (ยกเว้นช่องที่มีค่าเริ่มต้นเอง เช่น ชื่อผู้แจ้ง) = ไม่มีอะไรให้เก็บ
  function isEmptyDraft(values, ignore = []) {
    return Object.entries(values ?? {}).every(([name, value]) => ignore.includes(name) || value === "" || value === false || value === null || value === undefined);
  }

  function createDraftStore({ key, storage = defaultStorage(), now = () => Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, ignoreForEmpty = [] }) {
    const read = () => {
      try { return storage?.getItem(key) ?? null; } catch { return null; }
    };
    const store = {
      load() {
        const raw = read();
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.v !== VERSION || typeof parsed.values !== "object" || parsed.values === null) return null;
          if (!Number.isFinite(parsed.savedAt) || now() - parsed.savedAt > maxAgeMs) { store.clear(); return null; }
          if (isEmptyDraft(parsed.values, ignoreForEmpty)) return null;
          return { values: parsed.values, savedAt: parsed.savedAt };
        } catch {
          store.clear();
          return null;
        }
      },
      save(values) {
        if (isEmptyDraft(values, ignoreForEmpty)) return store.clear();
        try { storage?.setItem(key, JSON.stringify({ v: VERSION, savedAt: now(), values })); } catch { /* เต็มหรือถูกปิด: ข้ามไป */ }
      },
      clear() {
        try { storage?.removeItem(key); } catch { /* ไม่มีอะไรต้องทำ */ }
      },
    };
    return store;
  }

  const PREFIX = "mnp-draft:";
  const draftKey = (typeCode, employeeId) => `${PREFIX}${typeCode}:${employeeId}`;

  // ออกจากระบบเอง (เช่น เครื่องใช้ร่วมกัน): ลบร่างทุกใบบนเครื่อง ไม่ให้ข้อความที่กรอกค้างให้คนถัดไปเห็น
  // session หมดอายุไม่เรียกตัวนี้ เพราะร่างคือสิ่งที่ต้องรอดไปหลังล็อกอินใหม่
  function clearAll(storage = defaultStorage()) {
    try {
      const keys = [];
      for (let index = 0; index < (storage?.length ?? 0); index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(PREFIX)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    } catch { /* storage ใช้ไม่ได้: ไม่มีร่างให้ลบ */ }
  }

  root.MNP_FORM_DRAFT = Object.freeze({ VERSION, createDraftStore, isEmptyDraft, draftKey, clearAll });
})(typeof window !== "undefined" ? window : globalThis);
