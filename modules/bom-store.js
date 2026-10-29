// BOM รายแผนก (โหมดทดสอบ) — เมนู บทบาทสาธิต และที่เก็บ state ในเบราว์เซอร์ (แบบเดียวกับ modules/rubberflow-store.js)
// ข้อมูลทั้งชุดอยู่ใน localStorage ของเบราว์เซอร์นี้ (ข้อมูลสมมติ ไม่ขึ้นฐานข้อมูล) "ทำหน้าที่เป็น" คือบทบาทสาธิตใช้ซ่อน/แสดงเมนูและปุ่ม
// ไม่ใช่การควบคุมสิทธิ์ของระบบจริง ทุก action เดินผ่าน run() ที่ clone state ก่อน แล้วบันทึกเฉพาะเมื่อกฎผ่าน
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const STATE_KEY = "mnp-bom-v1";
  const USER_KEY = "mnp-bom-user";
  const STATE_VERSION = 1;

  const MODULES = Object.freeze([
    { id: "dashboard", label: "ภาพรวม BOM", group: "ภาพรวม" },
    { id: "items", label: "BOM ของแผนก", group: "ข้อมูลหลัก" },
    { id: "compounds", label: "สูตรยาง ↔ RubberFlow", group: "ข้อมูลหลัก" },
    { id: "import", label: "นำเข้าจาก Excel", group: "ข้อมูลหลัก" },
    { id: "orders", label: "ใบสั่งผลิต (PI)", group: "ผลิต" },
    { id: "jobs", label: "งานของแผนก", group: "ผลิต" },
    { id: "audit", label: "บันทึกการใช้งาน", group: "ผลิต" },
  ].map((entry) => Object.freeze(entry)));
  const MODULE_IDS = Object.freeze(MODULES.map((entry) => entry.id));
  const GROUPS = Object.freeze([...new Set(MODULES.map((entry) => entry.group))]);
  const findModule = (id) => MODULES.find((entry) => entry.id === String(id ?? "")) ?? null;

  // บทบาทสาธิต: dept = แผนกที่ถือสิทธิ์แก้ BOM/รายงานงาน (ดู docs/BOM_SYSTEM_PLAN.md §3.3)
  const ROLES = Object.freeze({
    admin: { label: "ผู้ดูแลระบบ", modules: MODULE_IDS },
    manager: { label: "ผู้จัดการฝ่ายโรงงาน", modules: MODULE_IDS },
    planner: { label: "ฝ่ายวางแผน / PK", modules: Object.freeze(["dashboard", "items", "compounds", "import", "orders", "jobs"]) },
    rb: { label: "หัวหน้าแผนก RB (รีดเส้นยาง)", modules: Object.freeze(["dashboard", "items", "compounds", "jobs", "orders"]) },
    gr: { label: "หัวหน้าแผนก GR (ตัด/เจาะ)", modules: Object.freeze(["dashboard", "items", "jobs", "orders"]) },
    pt: { label: "หัวหน้าแผนก PT (ฉีดพลาสติก)", modules: Object.freeze(["dashboard", "items", "jobs", "orders"]) },
    bg: { label: "หัวหน้าแผนก BG (กระเป๋า/เย็บ)", modules: Object.freeze(["dashboard", "items", "jobs", "orders"]) },
    st: { label: "หัวหน้าคลังวัตถุดิบ (ST)", modules: Object.freeze(["dashboard", "items", "orders", "jobs"]) },
  });
  const canSee = (user, moduleId) => Boolean(user) && Boolean(ROLES[user.role]) && ROLES[user.role].modules.includes(moduleId);
  const homeOf = (user) => (user && ROLES[user.role] ? ROLES[user.role].modules[0] : "dashboard");

  const LISTS = ["users", "compounds", "items", "boms", "orders", "jobs", "audit"];
  const isValidState = (value) => Boolean(value) && typeof value === "object" && value.version === STATE_VERSION
    && typeof value.counters === "object" && value.counters !== null && LISTS.every((key) => Array.isArray(value[key]));

  function readJson(storage, key) {
    try {
      const raw = storage?.getItem?.(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function writeJson(storage, key, value) {
    try {
      if (value === null) storage?.removeItem?.(key);
      else storage?.setItem?.(key, JSON.stringify(value));
      return true;
    } catch {
      return false; // storage เต็ม (เช่น นำเข้า master ทั้งก้อน) หรือปิดอยู่: หน้ายังทำงานต่อได้ในหน่วยความจำ
    }
  }
  const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

  function createStore({ storage = null, seed, actions, now = () => Date.now() } = {}) {
    let data = null;
    let userId = null;
    let loaded = false;
    let persisted = true;

    function load() {
      if (loaded) return data;
      const saved = readJson(storage, STATE_KEY);
      data = isValidState(saved) ? saved : seed();
      if (!isValidState(saved)) persisted = writeJson(storage, STATE_KEY, data);
      const savedUser = readJson(storage, USER_KEY);
      userId = typeof savedUser === "string" && data.users.some((user) => user.id === savedUser) ? savedUser : null;
      loaded = true;
      return data;
    }
    const getData = () => load();
    const getUser = () => {
      load();
      return data.users.find((user) => user.id === userId) ?? null;
    };
    function setUser(id) {
      load();
      const user = data.users.find((row) => row.id === id) ?? null;
      userId = user?.id ?? null;
      writeJson(storage, USER_KEY, userId);
      if (user) {
        data.audit.unshift({ at: now(), user: user.name, action: "เลือกบทบาทสาธิต", detail: user.role });
        if (data.audit.length > 500) data.audit.length = 500;
        persisted = writeJson(storage, STATE_KEY, data);
      }
      return user;
    }
    function run(name, payload) {
      load();
      const action = actions[name];
      if (typeof action !== "function") return { ok: false, error: new Error(`ไม่รู้จักคำสั่ง ${name}`) };
      const draft = clone(data);
      try {
        const result = action(draft, payload ?? {}, { now: now(), user: getUser() });
        data = draft;
        persisted = writeJson(storage, STATE_KEY, data);
        return { ok: true, result: result ?? true };
      } catch (error) {
        return { ok: false, error };
      }
    }
    function reset() {
      data = seed();
      loaded = true;
      persisted = writeJson(storage, STATE_KEY, data);
      return data;
    }
    // ขนาดข้อมูลที่เก็บ (ตัวอักษร JSON) ให้หน้า "นำเข้า" เตือนเมื่อใกล้เพดานของ localStorage (~5 ล้านตัวอักษร)
    const size = () => { load(); return JSON.stringify(data).length; };
    return { load, data: getData, user: getUser, setUser, run, reset, isPersisted: () => persisted, size, now };
  }

  const api = { STATE_KEY, USER_KEY, STATE_VERSION, MODULES, MODULE_IDS, GROUPS, ROLES, findModule, canSee, homeOf, isValidState, createStore };
  if (isNode) module.exports = api;
  else root.MNP_BOM_STORE = api;
})(typeof window !== "undefined" ? window : globalThis);
