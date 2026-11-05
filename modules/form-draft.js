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
  // ข้อความที่มีแต่ช่องว่าง และรายการที่ไม่ได้เลือกอะไร (เช่น สำเนาถึงแผนก) นับเป็นว่าง
  function isEmptyValue(value) {
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return value === false || value === null || value === undefined;
  }
  function isEmptyDraft(values, ignore = []) {
    return Object.entries(values ?? {}).every(([name, value]) => ignore.includes(name) || isEmptyValue(value));
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

  // บันทึกร่างแบบหน่วงเวลา (พิมพ์รัว ๆ บันทึกครั้งเดียว) — หยุดไว้ระหว่างรอผู้ใช้ตัดสินเรื่องร่างเดิม และหลังส่งสำเร็จ
  function createAutosave({ store, values, delay = 400, active = true }) {
    let timer = null;
    let running = active;
    return {
      schedule() {
        if (!running) return;
        clearTimeout(timer);
        timer = setTimeout(() => store.save(values()), delay);
      },
      start() { running = true; },
      stop() { running = false; clearTimeout(timer); },
    };
  }

  // แถบ "มีร่างค้าง" เหนือฟอร์ม: ใช้ร่างต่อ / เริ่มใหม่ — ผู้เรียกจัดการค่าเอง (คืนค่า หรือลบร่าง)
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  // form + onEdit: ผู้ใช้เริ่มกรอกเองโดยไม่ตอบแถบ (แตะ/พิมพ์จริง ไม่ใช่ event ที่โค้ดยิง) = เริ่มใบใหม่
  // ปิดแถบแล้วเรียก onEdit (ผู้เรียกเริ่มบันทึกร่างของใบใหม่) — เดิมแถบค้างไว้แล้วสิ่งที่กรอกไม่ถูกเก็บ และยกเลิกได้โดยไม่ถาม
  // hasInput: ฟอร์มมีค่าที่ลงร่างได้จริงหรือยัง (พิมพ์แค่ช่องว่าง พิมพ์แล้วลบ หรือเลือกไฟล์ ยังไม่นับ จึงไม่ทับร่างเดิมด้วยร่างว่าง)
  function offerDraft({ banner, message, onUse, onDiscard, form = null, onEdit = null, hasInput = () => true }) {
    banner.innerHTML = `<p>${escapeHtml(message)}</p><div class="draft-banner-actions"><button type="button" class="btn secondary small" data-draft="discard">เริ่มใหม่</button><button type="button" class="btn small" data-draft="use">ใช้ร่างต่อ</button></div>`;
    banner.hidden = false;
    const close = () => {
      banner.removeEventListener("click", choose);
      form?.removeEventListener("input", editedFirst, true);
      form?.removeEventListener("change", editedFirst, true);
      banner.hidden = true;
    };
    const choose = (event) => {
      const choice = event.target.closest("[data-draft]")?.dataset.draft;
      if (!choice) return;
      close();
      if (choice === "use") onUse();
      else onDiscard();
    };
    const editedFirst = (event) => {
      if (!event.isTrusted || banner.contains(event.target) || !hasInput()) return;
      close();
      onEdit();
    };
    banner.addEventListener("click", choose);
    if (form && onEdit) {
      // capture: ทำงานก่อนตัวฟังของฟอร์มเอง ร่างของใบใหม่จึงเริ่มบันทึกตั้งแต่ตัวอักษรแรก
      form.addEventListener("input", editedFirst, true);
      form.addEventListener("change", editedFirst, true);
    }
  }

  root.MNP_FORM_DRAFT = Object.freeze({ VERSION, createDraftStore, isEmptyDraft, draftKey, clearAll, createAutosave, offerDraft });
})(typeof window !== "undefined" ? window : globalThis);
