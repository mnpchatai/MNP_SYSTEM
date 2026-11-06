// RubberFlow MES (แผนก RB โหมดทดสอบ) — สิทธิ์ของบทบาทสาธิต (rbac.js ของต้นแบบ) และที่เก็บ state ในเบราว์เซอร์ (store.jsx ของต้นแบบ)
// ไม่มี DOM/Supabase: storage ส่งเข้ามาได้ (localStorage ในเบราว์เซอร์ / Map ในเทสต์) เทสต์ด้วย node --test (scripts/tests/rubberflow-store.test.mjs)
//
// สองโหมด: (1) ไม่ส่ง remote = ข้อมูลทั้งชุดอยู่ใน localStorage ของเบราว์เซอร์นี้ (ข้อมูลสมมติ + บทบาทสาธิต 9 คน ใช้ใน Node เทสต์) เหมือนต้นแบบ
// (2) ส่ง remote = ข้อมูลหลัก 3 ชุด (วัตถุดิบ สูตรยางทุก revision ใบสั่งผลิต WO) อยู่ใน Supabase ผ่าน app_rf_master (โหลดครั้งแรก) app_rf_save (บันทึก คืนส่วนต่างตั้งแต่เวอร์ชันฐาน)
// และ app_rf_master_since (ตามทัน) ชนกันรายระเบียน · บันทึกการใช้งานอ่านจาก app_rf_audit · ส่วนที่เหลือ (ล็อตวัตถุดิบ ใบเบิก ล็อตผลิต ส่งมอบ กล่อง QC NCR แม่พิมพ์)
// ยังอยู่ใน localStorage (คีย์ mnp-rubberflow-local-v1) จนกว่าจะย้ายขึ้นฐานข้อมูลในขั้นถัดไป · ผู้ใช้คือบัญชีทดสอบ (persona) ของ admin (personaUser)
// บทบาทเป็นแค่ตัวซ่อน/แสดงเมนูและปุ่ม สิทธิ์จริงของข้อมูลหลักตัดสินที่ฐานข้อมูล (ดูข้อจำกัดในหัวข้อ "RubberFlow MES" ของ README)
// ทุก action เดินผ่าน run() ที่ clone state ก่อน แล้วบันทึกเฉพาะเมื่อกฎผ่าน · โครงโหมดฐานข้อมูลเดียวกับ modules/bom-store.js
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const STATE_KEY = "mnp-rubberflow-v1";
  const USER_KEY = "mnp-rubberflow-user";
  const LOCAL_KEY = "mnp-rubberflow-local-v1"; // โหมดฐานข้อมูล: ส่วนที่ยังไม่ขึ้นฐานข้อมูล
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
    // บัญชีทดสอบของโหมดฐานข้อมูล (personaUser): พนักงานแผนก RB ทำงานสายผลิตทั้งสาย · แผนก SR รับมอบ WIP · แผนกอื่นดูได้อย่างเดียว
    rb: { label: "พนักงานแผนก RB", modules: Object.freeze(["dashboard", "orders", "recipes", "requisition", "mixing", "extrusion", "curing", "finishing", "wip", "trace", "warehouse", "molds"]) },
    gatekeeper: { label: "ผู้รับมอบ WIP (SR)", modules: Object.freeze(["dashboard", "wip", "trace", "warehouse"]) },
    viewer: { label: "ดูข้อมูลอย่างเดียว", modules: Object.freeze(["dashboard", "orders", "recipes", "wip", "trace", "warehouse"]) },
  });

  // สิทธิ์ย่อยของปุ่มในหน้า (ซ่อน/แสดงเท่านั้น) · โหมดสาธิตตามบทบาท · ผู้ใช้โหมดฐานข้อมูล (db) ตามตัวกำกับ planner / rb / rbHead ที่ตรงกับกฎของฐานข้อมูล
  const PLAN_ROLES = Object.freeze(["admin", "manager", "planner"]);
  const CAN = Object.freeze({
    approveRecipe: Object.freeze(["admin", "manager", "qc"]),
    releaseOrder: PLAN_ROLES,
    createOrder: PLAN_ROLES, // เปิดใบสั่งผลิต
    workOrder: PLAN_ROLES, // พัก/ผลิตต่อ/ปิดงาน/ยกเลิกใบสั่งผลิต
    editMaster: Object.freeze(["admin", "manager", "planner", "qc"]), // วัตถุดิบ / ร่างสูตร
    qcDecision: Object.freeze(["admin", "manager", "qc"]),
    demoSkip: Object.freeze(["admin", "manager", "mixer", "qc"]),
  });
  const DB_CAN = Object.freeze({
    approveRecipe: (user) => Boolean(user.rbHead),
    releaseOrder: (user) => Boolean(user.planner || user.rbHead),
    createOrder: (user) => Boolean(user.planner || user.rb),
    workOrder: (user) => Boolean(user.planner || user.rb),
    editMaster: (user) => Boolean(user.planner || user.rb),
    demoSkip: () => false, // ข้ามเวลาบ่มใช้ได้เฉพาะข้อมูลสาธิตในเครื่อง
  });

  const can = (user, permission) => {
    if (!user) return false;
    if (user.db && DB_CAN[permission]) return Boolean(DB_CAN[permission](user));
    return (CAN[permission] ?? []).includes(user.role);
  };
  // โหมดฐานข้อมูล: บันทึกการใช้งานอ่านได้ทุกบัญชีทดสอบ (ข้อมูลหลักอยู่ในฐานข้อมูลที่ทุกคนเห็นร่วมกัน เหมือนหน้าบันทึกการใช้งานของ BOM)
  const canSee = (user, moduleId) => Boolean(user) && Boolean(ROLES[user.role]) && (ROLES[user.role].modules.includes(moduleId) || (Boolean(user.db) && moduleId === "audit"));
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

  // ---------- โหมดฐานข้อมูล (remote): ข้อมูลหลัก 3 ชุดอยู่ใน Supabase ----------
  // ชุดที่ขึ้นฐานข้อมูล: วัตถุดิบ (materials) · สูตรยางทุก revision (recipes) · ใบสั่งผลิต WO (orders) · ชุดที่เหลือยังอยู่ในเครื่อง (LOCAL_LISTS) แม้ remote ล้มก็ไม่หาย
  // ชนกันรายระเบียน ไม่ใช่ทั้งชุด · ตัวนับเลข REQ/MX/TR/QC/NCR ของส่วนในเครื่องอยู่ใน counters ของไฟล์ local · เลข WO ออกจากข้อมูลที่มีในฐานข้อมูล (action ส่ง ctx.remote)
  const REMOTE_LISTS = Object.freeze(["materials", "recipes", "orders"]);
  const LOCAL_LISTS = Object.freeze(["materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds"]);
  const compareKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // กุญแจของระเบียน: วัตถุดิบ = code · สูตร = รหัส + revision · ใบสั่งผลิต = เลข WO
  const MASTER_KEY = Object.freeze({
    materials: (record) => record.code,
    recipes: (record) => `${record.id}\u0000${String(Number(record.revision) || 0).padStart(6, "0")}`,
    orders: (record) => record.id,
  });
  const deleteKey = (list, target) => (list === "recipes" ? MASTER_KEY.recipes(target ?? {}) : String(target?.code ?? target?.id ?? ""));
  // คำสั่งของส่วนในเครื่องที่แก้ใบสั่งผลิตด้วย (เริ่มผลิต ยอดผลิตเข้าใบ ปิดใบเมื่อครบ) ส่งไปฐานข้อมูลเป็นการเปลี่ยนสถานะ/ยอดของใบ
  const REMOTE_ACTION = Object.freeze({ recordMixing: "setOrderStatus", recordFinishing: "setOrderStatus", addQcRecord: "setOrderStatus" });

  function sameValue(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === otherKeys.length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  // ส่วนต่างของข้อมูลหลักก่อน/หลังรัน action → p_changes ของ app_rf_save (ระเบียนที่เพิ่ม/เปลี่ยน ส่งทั้งระเบียน · ขั้นนี้ไม่มีการลบ)
  function diffMaster(before, after) {
    const changes = {};
    for (const list of REMOTE_LISTS) {
      const key = MASTER_KEY[list];
      const old = new Map((before[list] ?? []).map((record) => [key(record), record]));
      const upsert = [];
      for (const record of after[list] ?? []) if (!old.has(key(record)) || !sameValue(old.get(key(record)), record)) upsert.push(clone(record));
      if (upsert.length) changes[list] = { upsert };
    }
    return changes;
  }
  const hasChanges = (changes) => Object.keys(changes).length > 0;

  function normalizeDelta(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(Number(value.version)) || !value.changes || typeof value.changes !== "object") {
      throw new Error("ข้อมูลส่วนต่าง RubberFlow จากฐานข้อมูลอยู่ในรูปแบบที่ไม่รู้จัก");
    }
    const changes = {};
    for (const list of REMOTE_LISTS) {
      const entry = value.changes[list];
      changes[list] = { upsert: Array.isArray(entry?.upsert) ? entry.upsert : [], delete: Array.isArray(entry?.delete) ? entry.delete : [] };
    }
    return { version: Number(value.version), epoch: typeof value.epoch === "string" ? value.epoch : null, changes };
  }
  // รวมส่วนต่างของชุดเดียวเข้ากับระเบียนปัจจุบันตามกุญแจ (ลบก่อน แล้วระเบียนใหม่ทับ) · changed = เนื้อหาต่างจากที่มีอยู่จริง · ชุดที่ไม่มีส่วนต่าง = คืนอาร์เรย์เดิม
  function applyEntry(list, current, entry, copy) {
    if (!entry.upsert.length && !entry.delete.length) return { records: current, changed: false };
    const key = MASTER_KEY[list];
    const byKey = new Map(current.map((record) => [key(record), record]));
    let changed = false;
    for (const target of entry.delete) if (byKey.delete(deleteKey(list, target))) changed = true;
    for (const record of entry.upsert) {
      const id = key(record);
      if (!byKey.has(id) || !sameValue(byKey.get(id), record)) changed = true;
      byKey.set(id, copy ? clone(record) : record);
    }
    return { records: [...byKey.entries()].sort((a, b) => compareKey(a[0], b[0])).map(([, record]) => record), changed };
  }

  // ข้อผิดพลาดของ RPC RubberFlow → ข้อความไทยสั้นๆ (ไม่แสดงข้อความดิบของฐานข้อมูล) · code ของ Error คือรหัสที่ฐานข้อมูลส่งมา
  function mapRemoteError(error, fallback = "บันทึกข้อมูล RubberFlow ไม่สำเร็จ ลองใหม่อีกครั้ง") {
    const haystack = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""} ${typeof error === "string" ? error : ""}`;
    const code = /RF_[A-Z0-9_]+/.exec(haystack)?.[0] ?? (/BOM_[A-Z0-9_]+/.exec(haystack)?.[0]) ?? (/PGRST202|42883/.test(haystack) ? "RF_NOT_DEPLOYED" : "RF_REMOTE_FAILED");
    const message = {
      RF_TEST_MODE_ONLY: "ข้อมูล RubberFlow ใช้ได้เฉพาะผู้ดูแลระบบในโหมดทดสอบ",
      RF_FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ใน RubberFlow (วัตถุดิบ สูตร และใบสั่งผลิต: ฝ่ายวางแผน ผู้จัดการ ผู้ดูแลระบบ หรือพนักงานแผนก RB · อนุมัติสูตรและปล่อยผลิต: หัวหน้าแผนก RB ขึ้นไป)",
      RF_STALE: "มีผู้อื่นบันทึกข้อมูล RubberFlow ไปก่อน (หรือเลขที่ซ้ำ) ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาลองทำรายการอีกครั้ง",
      RF_CONFLICT: "รายการนี้ซ้ำกับที่มีอยู่แล้ว ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาลองทำรายการอีกครั้ง",
      RF_INVALID_TRANSITION: "รายการอยู่ในสถานะที่ทำรายการนี้ไม่ได้ (อาจมีผู้อื่นเปลี่ยนสถานะไปก่อน) ระบบโหลดข้อมูลล่าสุดให้แล้ว",
      RF_RESET: "ข้อมูล RubberFlow ทดสอบถูกล้างและเริ่มใหม่แล้ว ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาลองทำรายการอีกครั้ง",
      RF_NOT_DEPLOYED: "ฐานข้อมูลยังไม่มีระบบ RubberFlow (ยังไม่ได้ติดตั้ง migration) ติดต่อผู้ดูแลระบบ",
      RF_REVISION_IMMUTABLE: "สูตร revision ที่อนุมัติแล้วแก้ไม่ได้ ให้ออก revision ใหม่",
      RF_INVALID_SOURCE_JOB: "งาน BOM ที่ใช้สร้างใบสั่งผลิตนี้ใช้ไม่ได้แล้ว (อาจผูกกับ WO อื่นไปแล้ว หรือใบ PI ไม่อยู่ในสถานะผลิต) ระบบโหลดข้อมูลล่าสุดให้แล้ว",
      RF_INVALID_PRODUCED: "ใบสั่งผลิตที่มาจากงาน BOM ต้องระบุปริมาณผลิตจริงมากกว่า 0 ก่อนปิดใบ",
    }[code] ?? (code.startsWith("RF_INVALID") || code.startsWith("BOM_") ? `ข้อมูลไม่ผ่านการตรวจของฐานข้อมูล (${code})` : fallback);
    return Object.assign(new Error(message), { code });
  }
  // การชน: ระเบียนที่แตะถูกผู้อื่นแก้ไปก่อน · เวอร์ชันฐานไม่ตรงฐานข้อมูล · เลขซ้ำ · สถานะเปลี่ยนไปแล้ว · งาน BOM ที่ผูกเปลี่ยนไป → ตามทันฐานข้อมูลก่อนให้ผู้ใช้ทำรายการใหม่
  const CONFLICT_CODES = Object.freeze(["RF_STALE", "RF_INVALID_PAYLOAD", "RF_CONFLICT", "RF_INVALID_TRANSITION", "RF_INVALID_SOURCE_JOB", "RF_RESET"]);

  // บัญชีทดสอบ (state.employee ของ app.js ในโหมดทดสอบ) → ผู้ใช้ของ RubberFlow
  // planner = กลุ่มวางแผน (admin · ผู้จัดการแผนกขึ้นไป · แผนก PP) ทำได้ทุกอย่างของข้อมูลหลัก · rb = สมาชิกแผนก RB ทุกตำแหน่ง · rbHead = หัวหน้า RB ขึ้นไป (อนุมัติสูตร ปล่อยผลิต)
  // role ใช้เลือกเมนูเท่านั้น: admin → admin · ผู้จัดการขึ้นไป → manager · PP → planner · RB → rb · ST → store · QA → qc · SR → gatekeeper · อื่นๆ → ดูอย่างเดียว
  const PLANNER_ROLE_CODES = Object.freeze(["department_manager", "assistant_factory_manager", "factory_manager", "general_manager"]);
  const RB_HEAD_DEPT_ROLE_CODES = Object.freeze(["department_manager", "assistant_department_manager"]);
  const RB_HEAD_ANY_ROLE_CODES = Object.freeze(["assistant_factory_manager", "factory_manager", "general_manager", "admin"]);
  const DEPT_ROLES = Object.freeze({ PP: "planner", RB: "rb", ST: "store", QA: "qc", SR: "gatekeeper" });
  function personaUser(employee) {
    if (!employee) return null;
    const roleCode = String(employee.role?.code ?? employee.role_code ?? "");
    const dept = String(employee.department?.code ?? employee.department_code ?? "").toUpperCase();
    const planner = roleCode === "admin" || PLANNER_ROLE_CODES.includes(roleCode) || dept === "PP";
    const rb = dept === "RB";
    const rbHead = (rb && RB_HEAD_DEPT_ROLE_CODES.includes(roleCode)) || RB_HEAD_ANY_ROLE_CODES.includes(roleCode);
    const role = roleCode === "admin" ? "admin" : PLANNER_ROLE_CODES.includes(roleCode) ? "manager" : DEPT_ROLES[dept] ?? "viewer";
    const name = `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim() || employee.display_name || employee.employee_no || "ผู้ใช้ทดสอบ";
    return { id: String(employee.id ?? employee.employee_no ?? name), role, dept, name, planner, rb, rbHead, db: true };
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ข้อมูล RubberFlow จากฐานข้อมูลอยู่ในรูปแบบที่ไม่รู้จัก");
    const snapshot = { version: value.version ?? 0, epoch: typeof value.epoch === "string" ? value.epoch : null };
    for (const list of REMOTE_LISTS) snapshot[list] = Array.isArray(value[list]) ? value[list] : [];
    return snapshot;
  }
  // บันทึกการใช้งานจาก app_rf_audit: [{at, user, action, detail, entries}] ใหม่สุดก่อน · at เป็นเวลา ISO หรือมิลลิวินาที
  function normalizeAudit(rows) {
    if (!Array.isArray(rows)) throw new Error("บันทึกการใช้งานจากฐานข้อมูลอยู่ในรูปแบบที่ไม่รู้จัก");
    return rows.map((row) => {
      const at = typeof row?.at === "number" ? row.at : Date.parse(String(row?.at ?? ""));
      const entries = (Array.isArray(row?.entries) ? row.entries : []).map((entry) => ({ action: String(entry?.action ?? ""), detail: String(entry?.detail ?? "") }));
      return { at: Number.isFinite(at) ? at : 0, user: String(row?.user ?? ""), action: String(row?.action ?? ""), detail: String(row?.detail ?? ""), entries };
    });
  }
  // รายการบันทึกการใช้งานของคำสั่งหนึ่ง (เก่าสุดก่อน): ฐานข้อมูลรับไม่เกิน 20 รายการ ชื่อการกระทำไม่เกิน 80 ตัวอักษร รายละเอียดไม่เกิน 300
  const AUDIT_MAX = 20;
  function auditPayload(entries) {
    const list = [...entries].reverse().map((entry) => ({ action: String(entry.action ?? "").slice(0, 80), detail: String(entry.detail ?? "").slice(0, 300) }));
    if (list.length <= AUDIT_MAX) return list;
    return [...list.slice(0, AUDIT_MAX - 1), { action: "รายการเพิ่มเติม", detail: `อีก ${list.length - (AUDIT_MAX - 1)} รายการในคำสั่งเดียวกัน` }];
  }
  const AUDIT_FRESH_MS = 3000;

  const isValidLocal = (value) => Boolean(value) && typeof value === "object" && typeof value.counters === "object" && value.counters !== null && LOCAL_LISTS.every((key) => Array.isArray(value[key]));
  const emptyLocal = () => ({ counters: {}, ...Object.fromEntries(LOCAL_LISTS.map((key) => [key, []])) });

  // shouldHold() = หน้ามีฟอร์มที่แก้ค้าง/เปิด dialog อยู่ (หน้าส่งมา): ระหว่างนั้นข้อมูลของผู้อื่นที่มากับ catchUp หรือคำตอบของการบันทึกห้ามรวมเข้า data และห้ามขยับเวอร์ชันฐาน
  function createRemoteStore({ storage, localSeed, actions, now, remote, persona, idSuffix, shouldHold: pageHolds = () => false }) {
    const shouldHold = () => { try { return Boolean(pageHolds()); } catch { return false; } };
    let snapshot = null; // ข้อมูลหลักชุดล่าสุดจากฐานข้อมูล (null = ยังไม่โหลด)
    let local = null; // ส่วนในเครื่อง: LOCAL_LISTS + counters
    let data = null; // ข้อมูลที่หน้าใช้: ตามฐานข้อมูล + ที่เพิ่งแก้และรอบันทึก + ส่วนในเครื่อง · users / audit ว่างเสมอ
    let persisted = true;
    let status = "idle"; // idle · loading · ready · error
    let loadError = null;
    let busy = false;
    let loading = null;
    let catching = null;
    let newerPending = false; // ฐานข้อมูลมีข้อมูลใหม่ของผู้อื่นที่ยังไม่รวม เพราะผู้ใช้มีฟอร์มที่แก้ค้างอยู่ (เวอร์ชันฐานของฟอร์มต้องไม่ขยับ)
    let auditView = { status: "idle", entries: [], error: null };
    let auditAt = 0;
    let auditStale = true;
    let auditLoading = null;
    const listeners = new Set();
    const emit = (event) => { for (const listener of [...listeners]) { try { listener(event); } catch { /* ผู้ฟังพังไม่ทำให้ store พัง */ } } };

    function loadLocal() {
      const saved = readJson(storage, LOCAL_KEY);
      local = isValidLocal(saved) ? saved : { ...emptyLocal(), ...(typeof localSeed === "function" ? localSeed() : {}) };
      if (!isValidLocal(saved)) persistLocal();
    }
    function persistLocal() {
      persisted = writeJson(storage, LOCAL_KEY, local);
    }
    function assemble() {
      const lists = Object.fromEntries(REMOTE_LISTS.map((list) => [list, clone(snapshot?.[list] ?? [])]));
      data = { version: STATE_VERSION, users: [], audit: [], ...clone(local), ...lists };
    }
    function init() {
      if (!local) loadLocal();
      if (!data) assemble();
    }
    function fetchSnapshot() {
      return Promise.resolve().then(() => remote.load());
    }
    function snapshotWith(base, delta) {
      const next = { ...base, version: Math.max(base.version ?? 0, delta.version), epoch: base.epoch ?? delta.epoch ?? null };
      for (const list of REMOTE_LISTS) next[list] = applyEntry(list, base[list], delta.changes[list], false).records;
      return next;
    }
    function mergeDelta(delta, intoData) {
      const nextSnapshot = snapshotWith(snapshot, delta);
      const nextData = intoData ? { ...data } : null;
      let changed = false;
      if (nextData) {
        for (const list of REMOTE_LISTS) {
          const result = applyEntry(list, data[list], delta.changes[list], true);
          nextData[list] = result.records;
          if (result.changed) changed = true;
        }
      }
      snapshot = nextSnapshot;
      if (nextData) data = nextData;
      if (changed) auditStale = true;
      return changed;
    }
    // ฐานข้อมูลเริ่มรอบข้อมูลใหม่ (ล้างข้อมูลทดสอบ) ตั้งแต่ที่เราโหลดมา: ส่วนต่างบอกไม่ได้ว่าระเบียนไหนถูกลบ ต้องโหลดทั้งชุด
    const epochChanged = (delta) => Boolean(snapshot?.epoch) && Boolean(delta.epoch) && delta.epoch !== snapshot.epoch;
    async function fetchSnapshotAfterConflict() {
      try {
        const delta = normalizeDelta(await remote.since(snapshot.version));
        if (epochChanged(delta)) throw new Error("epoch changed");
        return snapshotWith(snapshot, delta);
      } catch {
        try { return normalizeSnapshot(await fetchSnapshot()); } catch { return null; }
      }
    }
    const deltaHasRecords = (delta) => REMOTE_LISTS.some((list) => delta.changes[list].upsert.length || delta.changes[list].delete.length);
    // ส่วนต่างมีระเบียนที่ไม่ได้อยู่ในสิ่งที่เราเพิ่งส่ง (ของผู้อื่น หรือที่ฐานข้อมูลแก้เอง) · ระเบียนของเราที่ฐานข้อมูลประทับเวลา/ผู้บันทึกใหม่ไม่นับ
    function hasForeignRecords(delta, sent) {
      return REMOTE_LISTS.some((list) => {
        const key = MASTER_KEY[list];
        const mine = new Set((sent[list]?.upsert ?? []).map(key));
        return delta.changes[list].upsert.some((record) => !mine.has(key(record))) || delta.changes[list].delete.length > 0;
      });
    }
    // ส่วนของคำตอบที่เป็นระเบียนที่เราส่งเอง (กุญแจตรงกับที่ส่ง) · version = เวอร์ชันฐานเดิม (ไม่ขยับ)
    function ownRecordsOf(delta, sent, version) {
      const changes = {};
      for (const list of REMOTE_LISTS) {
        const key = MASTER_KEY[list];
        const mine = new Set((sent[list]?.upsert ?? []).map(key));
        changes[list] = { upsert: delta.changes[list].upsert.filter((record) => mine.has(key(record))), delete: [] };
      }
      return { version, changes };
    }
    // หน้ากลับมาโฟกัส: ดึงส่วนต่างของผู้อื่นเข้ามาเงียบๆ วาดหน้าใหม่ (event synced) เฉพาะเมื่อเนื้อหาที่แสดงเปลี่ยนจริง
    // มีฟอร์มค้าง (shouldHold) = ห้ามรวมเข้า data และห้ามขยับเวอร์ชันฐาน ไม่งั้นการบันทึกถัดไปจากฟอร์มเก่าจะส่งพร้อมเวอร์ชันใหม่แล้วฐานข้อมูลมองไม่เห็นว่าชน (ทับงานของผู้อื่นเงียบๆ)
    // ไม่ทำขณะบันทึกอยู่ และทิ้งผลถ้ามี action เริ่มระหว่างรอ · ผิดพลาด = เงียบ รอบโฟกัสถัดไปลองใหม่ · เวอร์ชันล้ำหน้าฐานข้อมูล (RF_INVALID_PAYLOAD) = โหลดทั้งชุด
    function catchUp(extraHold = () => false) {
      const holding = () => shouldHold() || Boolean(extraHold());
      if (status !== "ready" || busy) return Promise.resolve(false);
      if (catching) return catching;
      const base = snapshot.version;
      const fullReload = async () => {
        let full;
        try { full = normalizeSnapshot(await fetchSnapshot()); } catch { return false; }
        if (busy || snapshot.version !== base || holding()) return false;
        snapshot = full;
        newerPending = false;
        auditStale = true;
        assemble();
        emit({ type: "synced", changed: true });
        return true;
      };
      catching = Promise.resolve().then(() => remote.since(base)).then(normalizeDelta).then(
        (delta) => {
          if (busy || snapshot.version !== base) return false;
          if (holding()) {
            if ((deltaHasRecords(delta) || epochChanged(delta)) && !newerPending) { newerPending = true; emit({ type: "pending" }); }
            return false;
          }
          if (epochChanged(delta)) return fullReload();
          newerPending = false;
          const changed = mergeDelta(delta, true);
          if (changed) emit({ type: "synced", changed });
          return changed;
        },
        async (error) => {
          if (busy || snapshot.version !== base || holding() || mapRemoteError(error).code !== "RF_INVALID_PAYLOAD") return false;
          return fullReload();
        },
      ).finally(() => { catching = null; });
      return catching;
    }
    function reload() {
      init();
      status = "loading";
      loadError = null;
      emit({ type: "status" });
      loading = fetchSnapshot().then(normalizeSnapshot).then(
        (value) => { snapshot = value; newerPending = false; auditStale = true; assemble(); status = "ready"; emit({ type: "loaded" }); },
        (error) => { loadError = mapRemoteError(error, "โหลดข้อมูล RubberFlow ไม่สำเร็จ"); status = "error"; emit({ type: "load-failed", error: loadError }); },
      );
      return loading;
    }
    // โหลดครั้งแรกเท่านั้น: หลังโหลดไม่สำเร็จไม่โหลดซ้ำเองทุกครั้งที่วาดหน้า (วนไม่จบ) ผู้ใช้กดลองอีกครั้ง = reload()
    function ensureLoaded() {
      init();
      if (status === "idle") return reload();
      return status === "loading" ? loading : Promise.resolve();
    }

    const blocked = (text, extra = {}) => ({ ok: false, error: new Error(text), ...extra });
    function run(name, payload) {
      init();
      const action = actions[name];
      if (typeof action !== "function") return { ok: false, error: new Error(`ไม่รู้จักคำสั่ง ${name}`) };
      // ทีละรายการ: ระหว่างบันทึกรายการก่อนหน้า (รอผลจากฐานข้อมูลเพื่อรู้เลขรุ่นใหม่) รายการถัดไปถูกปฏิเสธ ไม่เข้าคิว
      if (status !== "ready") return blocked(status === "loading" ? "กำลังโหลดข้อมูล RubberFlow รอสักครู่แล้วลองอีกครั้ง" : "ยังโหลดข้อมูล RubberFlow ไม่ได้ โหลดหน้าใหม่แล้วลองอีกครั้ง");
      if (busy) return blocked("กำลังบันทึกรายการก่อนหน้า รอสักครู่แล้วลองอีกครั้ง", { busy: true });
      const before = data;
      const localBefore = local;
      const user = persona();
      const draft = clone(data);
      draft.audit = []; // action เขียนบันทึกการใช้งานลงร่างนี้ แล้วส่งไปกับการบันทึก (ฐานข้อมูลเก็บ)
      let result;
      try {
        result = action(draft, payload ?? {}, { now: now(), user, idSuffix, remote: true });
      } catch (error) {
        return { ok: false, error };
      }
      const changes = diffMaster(before, draft);
      const auditEntries = auditPayload(draft.audit);
      draft.audit = [];
      data = draft;
      local = Object.fromEntries(["counters", ...LOCAL_LISTS].map((key) => [key, draft[key]]));
      if (!sameValue(local, localBefore)) persistLocal();
      if (!hasChanges(changes)) return { ok: true, result: result ?? true, saving: Promise.resolve({ ok: true }) };
      busy = true;
      emit({ type: "saving" });
      const baseVersion = snapshot.version;
      const baseEpoch = snapshot.epoch ?? null; // รอบข้อมูลที่ถือ: ฐานข้อมูลปฏิเสธ (RF_RESET) ถ้าถูกล้างข้อมูลทดสอบไปแล้ว
      // ชน หรือเวอร์ชันฐานไม่ตรงฐานข้อมูล: ตามทันด้วยส่วนต่าง (ไม่ได้ก็โหลดทั้งชุด) ก่อนแสดงข้อมูลล่าสุดให้ผู้ใช้ทำรายการใหม่ · ย้อนกลับทั้งคำสั่ง (รวมส่วนในเครื่อง)
      // ถ้าผู้ใช้มีฟอร์มค้างอยู่ (ก่อนหรือระหว่างรอตามทัน) ไม่ดึงข้อมูลผู้อื่นเข้ามา แค่จำว่ามีใหม่
      const onSaveFailed = async (error) => {
        const mapped = mapRemoteError(error);
        const conflict = CONFLICT_CODES.includes(mapped.code);
        let held = shouldHold();
        if (conflict && !held) {
          const fresh = await fetchSnapshotAfterConflict();
          held = shouldHold();
          if (fresh && !held) { snapshot = fresh; newerPending = false; auditStale = true; }
        }
        if (conflict && held && !newerPending) { newerPending = true; emit({ type: "pending" }); }
        local = localBefore;
        persistLocal();
        assemble();
        busy = false;
        emit({ type: "reverted", error: mapped, held });
        return { ok: false, error: mapped };
      };
      const saving = Promise.resolve().then(() => remote.save(changes, baseVersion, REMOTE_ACTION[name] ?? name, auditEntries, baseEpoch)).then(normalizeDelta).then(
        (delta) => {
          // ฐานข้อมูลตอบรอบข้อมูลใหม่ (ปกติถูกปฏิเสธ RF_RESET ก่อนแล้ว): ถือว่าการบันทึกไม่ผ่าน ตามทันด้วยการโหลดทั้งชุด
          if (epochChanged(delta)) return onSaveFailed(Object.assign(new Error("RF_RESET"), { code: "RF_RESET" }));
          // changed = เนื้อหาต่างจากที่แสดง (รวมที่ฐานข้อมูลประทับเวลา/ผู้บันทึกให้ระเบียนของเราเอง) · others = มีระเบียนที่เราไม่ได้ส่ง (ผู้อื่นบันทึกระหว่างนั้น) ใช้แจ้งผู้ใช้
          const others = hasForeignRecords(delta, changes);
          auditStale = true;
          if (others && shouldHold()) {
            // ระหว่างรอคำตอบ ผู้ใช้เริ่มแก้ฟอร์มอื่น/เปิด dialog: ห้ามรวมระเบียนของผู้อื่นเข้า data และห้ามขยับเวอร์ชันฐานของการบันทึกถัดไป
            // รวมเฉพาะระเบียนของเราเองเข้า snapshot (data มีอยู่แล้วแบบ optimistic) แต่ไม่ขยับเวอร์ชัน · ที่เหลือมากับ catchUp/การวาดหน้าครั้งถัดไป
            snapshot = snapshotWith(snapshot, ownRecordsOf(delta, changes, snapshot.version));
            busy = false;
            emit({ type: "saved", changed: false, others: true, held: true });
            if (!newerPending) { newerPending = true; emit({ type: "pending" }); }
            return { ok: true };
          }
          const changed = mergeDelta(delta, true);
          newerPending = false;
          busy = false;
          emit({ type: "saved", changed, others });
          return { ok: true };
        },
        onSaveFailed,
      );
      return { ok: true, result: result ?? true, saving };
    }

    // บันทึกการใช้งาน: อ่านจาก app_rf_audit (ใหม่สุดก่อน) ทุกครั้งที่หน้านี้วาดและข้อมูลเก่ากว่าที่บันทึกล่าสุดหรือเกิน AUDIT_FRESH_MS · force = โหลดใหม่ทันที
    // โหลดไม่สำเร็จ = ไม่ลองใหม่เอง (event audit วาดหน้าใหม่ซึ่งเรียกฟังก์ชันนี้อีก): ค้างที่สถานะ error ให้ผู้ใช้กด "โหลดใหม่" (force) หรือรอจนมีการบันทึก
    function loadAudit(force = false) {
      init();
      if (auditLoading) return auditLoading;
      if (!force && !auditStale && (auditView.status === "error" || now() - auditAt < AUDIT_FRESH_MS)) return Promise.resolve();
      if (typeof remote.audit !== "function") {
        auditView = { status: "error", entries: [], error: mapRemoteError({ code: "PGRST202" }) };
        return Promise.resolve();
      }
      auditView = { ...auditView, status: auditView.entries.length ? "ready" : "loading" };
      auditLoading = Promise.resolve().then(() => remote.audit(200)).then(normalizeAudit).then(
        (entries) => { auditView = { status: "ready", entries, error: null }; auditStale = false; },
        (error) => { auditView = { status: "error", entries: auditView.entries, error: mapRemoteError(error, "โหลดบันทึกการใช้งานไม่สำเร็จ") }; auditStale = false; },
      ).then(() => { auditAt = now(); auditLoading = null; emit({ type: "audit" }); });
      return auditLoading;
    }
    // ล้างข้อมูล RubberFlow ทดสอบในฐานข้อมูล (เฉพาะผู้ดูแลระบบในโหมดทดสอบ ฐานข้อมูลตรวจเอง) แล้วโหลดใหม่จากศูนย์ · ส่วนในเครื่องที่อ้างใบสั่งผลิต/สูตรที่หายไปถูกล้างด้วย (ไม่ทำขณะบันทึกอยู่)
    async function purge() {
      init();
      if (busy) return blocked("กำลังบันทึกรายการก่อนหน้า รอสักครู่แล้วลองอีกครั้ง", { busy: true });
      if (typeof remote.purge !== "function") return blocked("เบราว์เซอร์นี้ล้างข้อมูล RubberFlow ทดสอบไม่ได้");
      busy = true;
      emit({ type: "saving" });
      let reply;
      try {
        reply = await remote.purge();
      } catch (error) {
        busy = false;
        const mapped = mapRemoteError(error, "ล้างข้อมูล RubberFlow ทดสอบไม่สำเร็จ");
        emit({ type: "purge-failed", error: mapped });
        return { ok: false, error: ["RF_FORBIDDEN", "BOM_FORBIDDEN"].includes(mapped.code) ? Object.assign(new Error("ล้างข้อมูล RubberFlow ทดสอบได้เฉพาะผู้ดูแลระบบในโหมดทดสอบ"), { code: mapped.code }) : mapped };
      }
      busy = false;
      local = { ...emptyLocal(), ...(typeof localSeed === "function" ? localSeed() : {}) };
      persistLocal();
      auditView = { status: "idle", entries: [], error: null };
      auditStale = true;
      snapshot = null;
      status = "idle";
      await reload();
      return { ok: status === "ready", deleted: Number(reply?.deleted) || 0, error: status === "ready" ? null : loadError };
    }

    const reset = () => { init(); return data; }; // โหมดฐานข้อมูลไม่มีการรีเซ็ตในเครื่อง (ล้างข้อมูลทดสอบ = purge)
    return {
      load: () => { init(); return data; }, data: () => { init(); return data; }, user: () => persona(), setUser: () => persona(), run, reset, isPersisted: () => persisted, now,
      isRemote: () => true, status: () => status, error: () => loadError, isSaving: () => busy, hasNewer: () => newerPending, version: () => snapshot?.version ?? null,
      ensureLoaded, reload, catchUp, idSuffix, audit: () => auditView, loadAudit, purge, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
  }

  // remote = { load(): Promise<snapshot>, save(changes, baseVersion, action, audit, epoch): Promise<delta>, since(version): Promise<delta>, audit(limit): Promise<[{at, user, action, detail}]>, purge(): Promise<{deleted}> }
  // snapshot = { version, epoch, materials, recipes, orders } · delta = { version, epoch, changes: { <ชุด>: { upsert: [...], delete: [...] } } }
  // ไม่ส่ง remote = ทั้งชุดอยู่ใน localStorage เหมือนเดิม (ชุดสาธิต + บทบาทสาธิต) · persona() = ผู้ใช้ปัจจุบันของโหมดฐานข้อมูล · localSeed() = ข้อมูลตั้งต้นของส่วนในเครื่อง (แม่พิมพ์)
  // storage: { getItem, setItem, removeItem } · seed: buildSeed() · actions: ตาราง action · now: () => ms
  function createStore({ storage = null, seed, actions, now = () => Date.now(), remote = null, persona = () => null, localSeed, idSuffix, shouldHold } = {}) {
    if (remote) return createRemoteStore({ storage, localSeed, actions, now, remote, persona, idSuffix, shouldHold });
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

    // ส่วนเดียวกับ store โหมดฐานข้อมูล เพื่อให้ module-rubberflow ใช้โค้ดชุดเดียว: ไม่มีการโหลด/บันทึกระยะไกล
    return { load, data: getData, user: getUser, setUser, run, reset, isPersisted: () => persisted, now, isRemote: () => false, status: () => "ready", error: () => null, isSaving: () => false, hasNewer: () => false, version: () => null, ensureLoaded: () => Promise.resolve(), reload: () => Promise.resolve(), catchUp: () => Promise.resolve(false), audit: () => ({ status: "ready", entries: getData().audit, error: null }), loadAudit: () => Promise.resolve(), purge: () => Promise.resolve({ ok: false, error: new Error("ล้างข้อมูล RubberFlow ทดสอบได้เฉพาะโหมดฐานข้อมูล") }), subscribe: () => () => {} };
  }

  const api = { STATE_KEY, USER_KEY, LOCAL_KEY, STATE_VERSION, MODULES, MODULE_IDS, GROUPS, ROLES, CAN, findModule, can, canSee, homeOf, isValidState, createStore, REMOTE_LISTS, LOCAL_LISTS, diffMaster, mapRemoteError, personaUser };
  if (isNode) module.exports = api;
  else root.MNP_RUBBERFLOW_STORE = api;
})(typeof window !== "undefined" ? window : globalThis);
