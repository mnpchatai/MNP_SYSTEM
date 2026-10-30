// BOM รายแผนก (โหมดทดสอบ) — เมนู บทบาทสาธิต และที่เก็บ state ในเบราว์เซอร์ (แบบเดียวกับ modules/rubberflow-store.js)
// ข้อมูลทั้งชุดอยู่ใน localStorage ของเบราว์เซอร์นี้ (ข้อมูลสมมติ ไม่ขึ้นฐานข้อมูล) "ทำหน้าที่เป็น" คือบทบาทสาธิตใช้ซ่อน/แสดงเมนูและปุ่ม
// ไม่ใช่การควบคุมสิทธิ์ของระบบจริง ทุก action เดินผ่าน run() ที่ clone state ก่อน แล้วบันทึกเฉพาะเมื่อกฎผ่าน
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const STATE_KEY = "mnp-bom-v1";
  const USER_KEY = "mnp-bom-user";
  // v1 = รุ่นที่มีขั้นอนุมัติ (PR #246) · v2 = จุดสร้างจุดเดียว ไม่มีอนุมัติ: ร่าง/รออนุมัติค้างถูกตัดทิ้งตอน migrate
  // v3 = สี ชุดสี และแพ็กเกจเป็นข้อมูล (colors / colorSets / packages)
  const STATE_VERSION = 3;

  const MODULES = Object.freeze([
    { id: "dashboard", label: "ภาพรวม BOM", group: "ภาพรวม" },
    { id: "build", label: "สร้าง BOM", group: "BOM" },
    { id: "items", label: "ค้นหาชิ้นงาน / ประวัติ BOM", group: "BOM" },
    { id: "product", label: "สินค้า 1 ตัว → งานทุกแผนก", group: "BOM" },
    { id: "variants", label: "ชุดสี / แพ็กเกจ", group: "BOM" },
    { id: "compounds", label: "สูตรยาง ↔ RubberFlow", group: "BOM" },
    { id: "import", label: "นำเข้าจาก Excel", group: "BOM" },
    { id: "orders", label: "ใบสั่งผลิต (PI)", group: "ผลิต" },
    { id: "jobs", label: "งานของแผนก", group: "ผลิต" },
    { id: "audit", label: "บันทึกการใช้งาน", group: "ผลิต" },
  ].map((entry) => Object.freeze(entry)));
  const MODULE_IDS = Object.freeze(MODULES.map((entry) => entry.id));
  const GROUPS = Object.freeze([...new Set(MODULES.map((entry) => entry.group))]);
  const findModule = (id) => MODULES.find((entry) => entry.id === String(id ?? "")) ?? null;

  // บทบาทสาธิต: สร้าง/แก้ BOM (เมนู สร้าง BOM, นำเข้า) = ฝ่ายวางแผนกับผู้จัดการ · dept = แผนกที่รายงานงานของตนได้
  const ROLES = Object.freeze({
    admin: { label: "ผู้ดูแลระบบ", modules: MODULE_IDS },
    manager: { label: "ผู้จัดการฝ่ายโรงงาน", modules: MODULE_IDS },
    planner: { label: "ฝ่ายวางแผน / PK", modules: Object.freeze(["dashboard", "build", "items", "product", "variants", "compounds", "import", "orders", "jobs"]) },
    rb: { label: "หัวหน้าแผนก RB (รีดเส้นยาง)", modules: Object.freeze(["dashboard", "items", "product", "variants", "compounds", "jobs", "orders"]) },
    gr: { label: "หัวหน้าแผนก GR (ตัด/เจาะ)", modules: Object.freeze(["dashboard", "items", "product", "variants", "jobs", "orders"]) },
    pt: { label: "หัวหน้าแผนก PT (ฉีดพลาสติก)", modules: Object.freeze(["dashboard", "items", "product", "variants", "jobs", "orders"]) },
    bg: { label: "หัวหน้าแผนก BG (กระเป๋า/เย็บ)", modules: Object.freeze(["dashboard", "items", "product", "variants", "jobs", "orders"]) },
    st: { label: "หัวหน้าคลังวัตถุดิบ (ST)", modules: Object.freeze(["dashboard", "items", "product", "variants", "orders", "jobs"]) },
  });
  const canSee = (user, moduleId) => Boolean(user) && Boolean(ROLES[user.role]) && ROLES[user.role].modules.includes(moduleId);
  const homeOf = (user) => (user && ROLES[user.role] ? ROLES[user.role].modules[0] : "dashboard");

  const BASE_LISTS = ["users", "compounds", "items", "boms", "orders", "jobs", "audit"];
  const V3_LISTS = ["colors", "colorSets", "packages"];
  const LISTS = [...BASE_LISTS, ...V3_LISTS];
  const hasShape = (value, lists = LISTS) => Boolean(value) && typeof value === "object" && typeof value.counters === "object" && value.counters !== null && lists.every((key) => Array.isArray(value[key]));
  const isValidState = (value) => hasShape(value) && value.version === STATE_VERSION;
  // state รุ่นเก่าในเบราว์เซอร์ → รุ่นปัจจุบัน (คืน null ถ้าแปลงไม่ได้ จะสร้างชุดสาธิตใหม่)
  function migrate(value) {
    if (!hasShape(value, BASE_LISTS)) return null;
    if (value.version === STATE_VERSION && hasShape(value)) return value;
    if (value.version === 1) {
      // รุ่นเก่ามีร่าง/รออนุมัติ ซึ่งรุ่นนี้ไม่มีคำสั่งจัดการแล้ว ตัดทิ้ง เหลือ BOM ที่ใช้งาน/ถูกแทน
      value.boms = value.boms.filter((bom) => bom.status === "approved" || bom.status === "superseded");
      value.version = 2;
      value.audit.unshift({ at: Date.now(), user: "ระบบ", action: "อัปเกรดข้อมูล", detail: "รุ่น 1 → 2: ตัดร่าง/รออนุมัติที่ค้าง (รุ่นนี้บันทึก BOM แล้วใช้ได้ทันที)" });
    }
    if (value.version === 2) {
      // รุ่น 3 เพิ่มตารางสี ชุดสี แพ็กเกจ (ว่างไว้ ผู้ใช้นิยามหรือกด "บันทึกชุดสีจากสินค้า" ได้)
      for (const key of V3_LISTS) if (!Array.isArray(value[key])) value[key] = [];
      value.version = 3;
      value.audit.unshift({ at: Date.now(), user: "ระบบ", action: "อัปเกรดข้อมูล", detail: "รุ่น 2 → 3: เพิ่มสี ชุดสี และแพ็กเกจเป็นข้อมูล" });
    }
    return value.version === STATE_VERSION && hasShape(value) ? value : null;
  }

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
      const valid = isValidState(saved);
      data = valid ? saved : migrate(saved) ?? seed();
      if (!valid) persisted = writeJson(storage, STATE_KEY, data); // เขียน state ที่อัปเกรดหรือชุดสาธิตใหม่กลับทันที
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

  const api = { STATE_KEY, USER_KEY, STATE_VERSION, MODULES, MODULE_IDS, GROUPS, ROLES, findModule, canSee, homeOf, isValidState, migrate, createStore };
  if (isNode) module.exports = api;
  else root.MNP_BOM_STORE = api;
})(typeof window !== "undefined" ? window : globalThis);
