// RubberFlow MES (แผนก RB โหมดทดสอบ) — สิทธิ์ของบทบาทสาธิต (rbac.js ของต้นแบบ) และที่เก็บ state ในเบราว์เซอร์ (store.jsx ของต้นแบบ)
// ไม่มี DOM/Supabase: storage ส่งเข้ามาได้ (localStorage ในเบราว์เซอร์ / Map ในเทสต์) เทสต์ด้วย node --test (scripts/tests/rubberflow-store.test.mjs)
//
// ข้อมูลทั้งชุดของ RubberFlow อยู่ใน localStorage ของเบราว์เซอร์นี้ (ข้อมูลสมมติ ไม่ขึ้นฐานข้อมูล) เหมือนต้นแบบ ผู้ใช้สองเครื่องจึงไม่เห็น
// ข้อมูลเดียวกัน และ "ทำหน้าที่เป็น" (บทบาทสาธิต 9 คน) เป็นแค่การซ่อน/แสดงเมนู ไม่ใช่การควบคุมสิทธิ์ของระบบจริง
// (ดูข้อจำกัดในหัวข้อ "RubberFlow MES" ของ README) ทุก action เดินผ่าน run() ที่ clone state ก่อน แล้วบันทึกเฉพาะเมื่อกฎผ่าน
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const STATE_KEY = "mnp-rubberflow-v1";
  const USER_KEY = "mnp-rubberflow-user";
  const STATE_VERSION = 1;

  // เมนูของโมดูล (id = ค่า p= ใน URL) เรียงตามกลุ่มที่แสดงในแถบข้าง
  const MODULES = Object.freeze([
    { id: "dashboard", label: "ภาพรวมโรงงาน", group: "ภาพรวม" },
    { id: "orders", label: "ใบสั่งผลิต", group: "วางแผน" },
    { id: "recipes", label: "สูตรยาง (BOM/PHR)", group: "วางแผน" },
    { id: "requisition", label: "เบิกและชั่งเคมี", group: "สายการผลิต" },
    { id: "mixing", label: "1 · ผสมยาง", group: "สายการผลิต" },
    { id: "extrusion", label: "2 · ฉีดขึ้นรูป", group: "สายการผลิต" },
    { id: "curing", label: "3 · อบ HCM", group: "สายการผลิต" },
    { id: "finishing", label: "4 · ตกแต่งและบรรจุ", group: "สายการผลิต" },
    { id: "wip", label: "ส่งมอบ WIP", group: "สายการผลิต" },
    { id: "quality", label: "QC · NCR · CoA", group: "คุณภาพ" },
    { id: "spc", label: "SPC / Cpk", group: "คุณภาพ" },
    { id: "trace", label: "สืบย้อนกลับ", group: "คุณภาพ" },
    { id: "warehouse", label: "คลังวัตถุดิบและสินค้า", group: "คลังและเครื่องมือ" },
    { id: "molds", label: "แม่พิมพ์และหัวดาย", group: "คลังและเครื่องมือ" },
    { id: "audit", label: "บันทึกการใช้งาน", group: "คลังและเครื่องมือ" },
  ].map((entry) => Object.freeze(entry)));
  const MODULE_IDS = Object.freeze(MODULES.map((entry) => entry.id));
  const GROUPS = Object.freeze([...new Set(MODULES.map((entry) => entry.group))]);
  const findModule = (id) => MODULES.find((entry) => entry.id === String(id ?? "")) ?? null;

  const ROLES = Object.freeze({
    admin: { label: "ผู้ดูแลระบบ", modules: MODULE_IDS },
    manager: { label: "ผู้จัดการโรงงาน", modules: Object.freeze(MODULE_IDS.filter((id) => id !== "audit")) },
    planner: { label: "ฝ่ายวางแผนการผลิต", modules: Object.freeze(["dashboard", "orders", "recipes", "wip", "trace", "warehouse"]) },
    store: { label: "เจ้าหน้าที่คลัง", modules: Object.freeze(["dashboard", "requisition", "warehouse", "wip", "trace"]) },
    mixer: { label: "พนักงานผสมยาง", modules: Object.freeze(["dashboard", "requisition", "mixing", "wip"]) },
    extruder: { label: "พนักงานฉีดยาง", modules: Object.freeze(["dashboard", "extrusion", "wip", "molds"]) },
    curer: { label: "พนักงานอบยาง", modules: Object.freeze(["dashboard", "curing", "wip", "molds"]) },
    finisher: { label: "พนักงานตกแต่ง/บรรจุ", modules: Object.freeze(["dashboard", "finishing", "wip", "warehouse"]) },
    qc: { label: "วิศวกรควบคุมคุณภาพ", modules: Object.freeze(["dashboard", "recipes", "quality", "spc", "trace", "warehouse", "molds", "wip"]) },
  });

  // สิทธิ์ย่อยของปุ่มในหน้า (ซ่อน/แสดงเท่านั้น)
  const CAN = Object.freeze({
    approveRecipe: Object.freeze(["admin", "manager", "qc"]),
    releaseOrder: Object.freeze(["admin", "manager", "planner"]),
    qcDecision: Object.freeze(["admin", "manager", "qc"]),
    demoSkip: Object.freeze(["admin", "manager", "mixer", "qc"]),
  });

  const can = (user, permission) => Boolean(user) && (CAN[permission] ?? []).includes(user.role);
  const canSee = (user, moduleId) => Boolean(user) && Boolean(ROLES[user.role]) && ROLES[user.role].modules.includes(moduleId);
  const homeOf = (user) => (user && ROLES[user.role] ? ROLES[user.role].modules[0] : "dashboard");

  // state ที่อ่านจาก storage ต้องมีโครงครบ ไม่เช่นนั้นถือว่าเสีย (สร้างชุดสาธิตใหม่)
  const LISTS = ["users", "materials", "materialLots", "recipes", "orders", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "audit"];
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
      return false; // storage เต็ม/ปิดอยู่: หน้ายังทำงานต่อได้ในหน่วยความจำ
    }
  }

  const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

  // storage: { getItem, setItem, removeItem } · seed: buildSeed() · actions: ตาราง action · now: () => ms
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
        data.audit.unshift({ at: now(), user: user.name, action: "เข้าสู่ระบบ", detail: user.username });
        if (data.audit.length > 400) data.audit.length = 400;
        persisted = writeJson(storage, STATE_KEY, data);
      }
      return user;
    }

    // เรียก action บนร่างที่ clone ไว้ คืน { ok, result } เมื่อกฎผ่าน (บันทึกร่างแทน state เดิม) หรือ { ok: false, error } เมื่อกฎไม่ผ่าน
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

    return { load, data: getData, user: getUser, setUser, run, reset, isPersisted: () => persisted, now };
  }

  const api = { STATE_KEY, USER_KEY, STATE_VERSION, MODULES, MODULE_IDS, GROUPS, ROLES, CAN, findModule, can, canSee, homeOf, isValidState, createStore };
  if (isNode) module.exports = api;
  else root.MNP_RUBBERFLOW_STORE = api;
})(typeof window !== "undefined" ? window : globalThis);
