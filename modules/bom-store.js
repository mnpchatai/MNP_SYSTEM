// BOM รายแผนก (โหมดทดสอบ) — เมนู บทบาท และที่เก็บ state (แบบเดียวกับ modules/rubberflow-store.js)
// สองโหมด: (1) ไม่ส่ง remote = ทั้งชุดอยู่ใน localStorage ของเบราว์เซอร์นี้ (ข้อมูลสาธิต + บทบาทสาธิต 8 คน ใช้ใน Node เทสต์)
// (2) ส่ง remote = ข้อมูลทั้งหมด (ชิ้นงาน BOM สี ชุดสี แพ็กเกจ สูตรยาง ขั้นตอนผลิต routing ลูกค้า ใบสั่งผลิต PI และงานรายแผนก) อยู่ใน Supabase ผ่าน app_bom_master (โหลดครั้งแรก)
// app_bom_save_master (บันทึก คืนส่วนต่างที่เปลี่ยนตั้งแต่เวอร์ชันฐาน) และ app_bom_master_since (ตามทัน) · ชนกันรายระเบียน ไม่ใช่ทั้งชุด
// บันทึกการใช้งานอ่านจาก app_bom_audit (store ส่งรายการของแต่ละคำสั่งไปกับการบันทึก) · ไม่มีอะไรของ BOM เก็บใน localStorage อีก ผู้ใช้คือบัญชีทดสอบ (persona) ของ admin (personaUser)
// บทบาทเป็นแค่ตัวซ่อน/แสดงเมนูและปุ่ม สิทธิ์จริงตัดสินที่ฐานข้อมูล · ทุก action เดินผ่าน run() ที่ clone state ก่อน แล้วบันทึกเฉพาะเมื่อกฎผ่าน
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const STATE_KEY = "mnp-bom-v1";
  const USER_KEY = "mnp-bom-user";
  // v1 = รุ่นที่มีขั้นอนุมัติ (PR #246) · v2 = จุดสร้างจุดเดียว ไม่มีอนุมัติ: ร่าง/รออนุมัติค้างถูกตัดทิ้งตอน migrate
  // v3 = สี ชุดสี และแพ็กเกจเป็นข้อมูล (colors / colorSets / packages)
  // v4 = โครงสร้างสินค้า (จำลอง): ขั้นตอนผลิตมาตรฐาน (processes) และขั้นตอนผลิตต่อชิ้นงาน (routings)
  // v5 = บรรทัด BOM ทุก revision เรียงตามผังงานบริษัท (rules.sortLinesByFlow) ข้อมูลที่นำเข้าจาก Excel ก่อนหน้านี้จึงไม่ค้างลำดับของชีต
  // v6 = ขั้นตอน GR ตาม Grinding-GR 9 ขั้น: รหัส GR เดิม (GR-01..04, GR-CUT ฯลฯ) ย้ายเลขใน processes และ routings
  const STATE_VERSION = 6;
  // รหัส GR เดิม → รุ่น 6 (ทั้งชุด #268 GR-01..04 และชุดก่อนนั้น GR-CUT ฯลฯ ที่ยังค้างในเบราว์เซอร์)
  // คัดแยกไม่อยู่ในลำดับของ Grinding-GR จึงเป็นขั้นของผู้ใช้ GR-10 ต่อท้ายเจาะ
  const GR_V6_CODES = Object.freeze({ "GR-01": "GR-04", "GR-02": "GR-05", "GR-03": "GR-06", "GR-04": "GR-10", "GR-CUT": "GR-04", "GR-GLUE": "GR-05", "GR-GRIND": "GR-06", "GR-DRL": "GR-09", "GR-SORT": "GR-10" });
  const GR_V5_NAMES = Object.freeze({ "GR-01": "ตัดยาง", "GR-02": "ทากาว", "GR-03": "เจียร์แปรรูป", "GR-CUT": "ตัดชิ้นยาง", "GR-GLUE": "ทากาว", "GR-GRIND": "เจียร", "GR-DRL": "เจาะรู" });

  const MODULES = Object.freeze([
    { id: "dashboard", label: "ภาพรวม BOM", group: "ภาพรวม" },
    { id: "build", label: "สร้าง BOM", group: "BOM" },
    { id: "items", label: "ค้นหาชิ้นงาน / ประวัติ BOM", group: "BOM" },
    { id: "product", label: "สินค้า 1 ตัว → งานทุกแผนก", group: "BOM" },
    { id: "structure", label: "โครงสร้างสินค้า (ต้นทุน/เวลา)", group: "BOM" },
    { id: "variants", label: "ชุดสี / แพ็กเกจ", group: "BOM" },
    { id: "compounds", label: "สูตรยาง ↔ RubberFlow", group: "BOM" },
    { id: "import", label: "นำเข้าจาก Excel", group: "BOM" },
    { id: "orders", label: "ใบสั่งผลิต (PI)", group: "ผลิต" },
    { id: "customers", label: "ลูกค้า", group: "ผลิต" },
    { id: "count", label: "นับคงคลังตามใบ", group: "ผลิต" },
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
    planner: { label: "ฝ่ายวางแผน (PP)", modules: Object.freeze(["dashboard", "build", "items", "product", "structure", "variants", "compounds", "import", "orders", "customers", "count", "jobs"]) },
    rb: { label: "หัวหน้าแผนก RB (รีดเส้นยาง)", modules: Object.freeze(["dashboard", "items", "product", "structure", "variants", "compounds", "jobs", "orders"]) },
    gr: { label: "หัวหน้าแผนก GR (ตัด/เจาะ)", modules: Object.freeze(["dashboard", "items", "product", "structure", "variants", "jobs", "orders"]) },
    pt: { label: "หัวหน้าแผนก PT (ฉีดพลาสติก)", modules: Object.freeze(["dashboard", "items", "product", "structure", "variants", "jobs", "orders"]) },
    bg: { label: "หัวหน้าแผนก BG (กระเป๋า/เย็บ)", modules: Object.freeze(["dashboard", "items", "product", "structure", "variants", "jobs", "orders"]) },
    st: { label: "หัวหน้าคลังวัตถุดิบ (ST)", modules: Object.freeze(["count", "dashboard", "items", "product", "structure", "variants", "orders", "jobs"]) },
    wh: { label: "คลังสินค้า (WH)", modules: Object.freeze(["count", "dashboard", "items", "product", "structure", "variants", "orders", "jobs"]) },
    // บัญชีทดสอบที่ไม่ใช่แผนกด้านบน (โหมดฐานข้อมูล): ดูข้อมูลได้อย่างเดียว
    viewer: { label: "ดูข้อมูลอย่างเดียว", modules: Object.freeze(["dashboard", "items", "product", "structure", "variants", "orders", "jobs"]) },
  });
  const canSee = (user, moduleId) => Boolean(user) && Boolean(ROLES[user.role]) && ROLES[user.role].modules.includes(moduleId);
  const homeOf = (user) => (user && ROLES[user.role] ? ROLES[user.role].modules[0] : "dashboard");

  const BASE_LISTS = ["users", "compounds", "items", "boms", "orders", "jobs", "audit"];
  const V3_LISTS = ["colors", "colorSets", "packages"];
  const V4_LISTS = ["processes", "routings"];
  const LISTS = [...BASE_LISTS, ...V3_LISTS, ...V4_LISTS];
  const hasShape = (value, lists = LISTS) => Boolean(value) && typeof value === "object" && typeof value.counters === "object" && value.counters !== null && lists.every((key) => Array.isArray(value[key]));
  const isValidState = (value) => hasShape(value) && value.version === STATE_VERSION;
  // state รุ่นเก่าในเบราว์เซอร์ → รุ่นปัจจุบัน (คืน null ถ้าแปลงไม่ได้ จะสร้างชุดสาธิตใหม่)
  function migrate(value) {
    if (!hasShape(value, BASE_LISTS)) return null;
    if (value.version === STATE_VERSION && hasShape(value)) return value;
    // processes ที่เพิ่งเติมจากค่าเริ่มต้นปัจจุบันตอนอัปเกรดรุ่น 3 → 4 ใช้รหัสรุ่นล่าสุดอยู่แล้ว ไม่ต้องย้ายรหัสตอนรุ่น 5 → 6
    let currentProcesses = false;
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
    if (value.version === 3) {
      // รุ่น 4 เพิ่มขั้นตอนผลิตมาตรฐาน (ชุดเริ่มต้นจาก bom-rules.js) และขั้นตอนผลิตต่อชิ้นงาน (ว่างไว้)
      if (!Array.isArray(value.processes)) {
        value.processes = (root.MNP_BOM_RULES?.DEFAULT_PROCESSES ?? []).map((entry) => ({ ...entry }));
        currentProcesses = true;
      }
      if (!Array.isArray(value.routings)) value.routings = [];
      value.version = 4;
      value.audit.unshift({ at: Date.now(), user: "ระบบ", action: "อัปเกรดข้อมูล", detail: "รุ่น 3 → 4: เพิ่มขั้นตอนผลิตและโครงสร้างสินค้า (จำลอง)" });
    }
    if (value.version === 4) {
      // รุ่น 5 เรียงบรรทัด BOM ของทุกสินค้า/ชิ้นย่อย (ทุก revision) ตามผังงาน ST → RB → GR → PT → BG → PK · ไม่มีกฎ = คงเดิม
      const sort = root.MNP_BOM_RULES?.sortLinesByFlow;
      const byCode = new Map(value.items.map((item) => [item.code, item]));
      const itemOf = (code) => byCode.get(code) ?? null;
      let changed = 0;
      for (const bom of value.boms) {
        if (!sort || !Array.isArray(bom.lines)) continue;
        const sorted = sort(bom.lines, itemOf);
        if (sorted.some((line, index) => line !== bom.lines[index])) changed += 1;
        bom.lines = sorted;
      }
      value.version = 5;
      value.audit.unshift({ at: Date.now(), user: "ระบบ", action: "อัปเกรดข้อมูล", detail: `รุ่น 4 → 5: เรียงบรรทัด BOM ตามผังงาน ST → RB → GR → PT → BG → PK (${changed} BOM เปลี่ยนลำดับ)` });
    }
    if (value.version === 5 && Array.isArray(value.processes) && Array.isArray(value.routings)) {
      // รุ่น 6 ย้ายรหัสขั้นตอน GR เดิมไปเลขใหม่ (ทุก revision ของ routing) แล้ววางขั้นตอน GR ทั้งชุดเรียงตาม Grinding-GR ที่ตำแหน่งของ GR เดิม
      // ชื่อเริ่มต้นเดิมเปลี่ยนเป็นชื่อเริ่มต้นใหม่ (เจียร์แปรรูป → เจียร์) ชื่อที่ผู้ใช้แก้เองคงไว้
      const defaults = (root.MNP_BOM_RULES?.DEFAULT_PROCESSES ?? []).filter((entry) => entry.dept === "GR");
      const processes = value.processes.map((process) => {
        const code = GR_V6_CODES[process.code];
        if (!code) return process;
        const name = process.name === GR_V5_NAMES[process.code] ? defaults.find((entry) => entry.code === code)?.name ?? process.name : process.name;
        return { ...process, code, name };
      });
      const first = currentProcesses ? -1 : value.processes.findIndex((process) => GR_V6_CODES[process.code]);
      if (first !== -1) {
        const stored = new Map(processes.map((process) => [process.code, process]));
        const group = [...defaults.map((entry) => stored.get(entry.code) ?? { ...entry }), ...(stored.has("GR-10") ? [stored.get("GR-10")] : [])];
        const codes = new Set(group.map((process) => process.code));
        const rest = processes.filter((process) => !codes.has(process.code));
        const at = processes.slice(0, first).filter((process) => !codes.has(process.code)).length;
        value.processes = [...rest.slice(0, at), ...group, ...rest.slice(at)];
      }
      let moved = 0;
      for (const routing of value.routings) {
        for (const step of Array.isArray(routing.steps) ? routing.steps : []) {
          const code = GR_V6_CODES[step.processCode];
          if (code) { step.processCode = code; moved += 1; }
        }
      }
      // คัดแยกที่ routing อ้างแต่ไม่เคยเก็บใน processes (เลือกจากค่าเริ่มต้นรุ่นก่อน) ไม่มีค่าเริ่มต้นให้แล้ว ต้องเก็บไว้ ไม่งั้นขั้นนั้นหายตอนแก้ routing
      const usesSort = value.routings.some((routing) => (Array.isArray(routing.steps) ? routing.steps : []).some((step) => step.processCode === "GR-10"));
      if (usesSort && !value.processes.some((process) => process.code === "GR-10")) {
        const lastGr = value.processes.findLastIndex((process) => process.dept === "GR");
        const sort = { code: "GR-10", name: "คัดแยก", dept: "GR" };
        value.processes = lastGr === -1 ? [...value.processes, sort] : [...value.processes.slice(0, lastGr + 1), sort, ...value.processes.slice(lastGr + 1)];
      }
      value.version = 6;
      value.audit.unshift({ at: Date.now(), user: "ระบบ", action: "อัปเกรดข้อมูล", detail: `รุ่น 5 → 6: ขั้นตอน GR ตาม Grinding-GR (รีด → ปั๊ม → เปเปอร์ → ตัดยาง → ทากาว → เจียร์ → เจาะ) · ตัดยาง GR-04 ทากาว GR-05 เจียร์ GR-06 คัดแยก GR-10 (${moved} ขั้นใน routing เปลี่ยนรหัส)` });
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

  function readRaw(storage, key) {
    try {
      return storage?.getItem?.(key) ?? null;
    } catch {
      return null;
    }
  }

  // ---------- โหมดฐานข้อมูล (remote): ข้อมูลทั้งหมดอยู่ใน Supabase ----------
  // ข้อมูลหลัก (master): ชิ้นงาน สูตรยาง สี ชุดสี แพ็กเกจ BOM ขั้นตอนผลิต และ routing · ข้อมูลที่ใช้ทำงาน: ลูกค้า ใบสั่งผลิต (PI) และงานรายแผนก
  // ทั้งหมดอยู่ในฐานข้อมูลผ่าน RPC ชุดเดียวกัน (ชนกันรายระเบียน คืนส่วนต่าง) · บันทึกการใช้งานอ่านจาก app_bom_audit · ตัวนับเลข BOM/RT/JOB อยู่ในหน่วยความจำของหน้าและตั้งต้นจากเลขสูงสุดที่ฐานข้อมูลมี
  const MASTER_LISTS = Object.freeze(["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings"]);
  const WORK_LISTS = Object.freeze(["customers", "orders", "jobs"]);
  const REMOTE_LISTS = Object.freeze([...MASTER_LISTS, ...WORK_LISTS]);
  const LOCAL_KEY = "mnp-bom-local-v1"; // รุ่นก่อนหน้าเก็บใบสั่งผลิต/งาน/บันทึกการใช้งานไว้ที่นี่ · ตอนนี้ไม่อ่านไม่เขียน (ข้อมูลทดสอบเก่าไม่ย้ายเข้าฐานข้อมูล)
  const compareKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // กุญแจของระเบียนในแต่ละชุด: code · id · base+code (ชุดสี/แพ็กเกจรหัสซ้ำข้ามฐานรหัสได้) · ชื่อลูกค้าตัดช่องว่างและไม่สนตัวพิมพ์
  const MASTER_KEY = Object.freeze({
    items: (record) => record.code, compounds: (record) => record.code, colors: (record) => record.code, processes: (record) => record.code,
    boms: (record) => record.id, routings: (record) => record.id,
    colorSets: (record) => `${record.base}\u0000${record.code}`, packages: (record) => `${record.base}\u0000${record.code}`,
    customers: (record) => String(record.name ?? "").trim().toLowerCase(), orders: (record) => record.id, jobs: (record) => record.id,
  });
  const MASTER_DELETABLE = Object.freeze(["colorSets", "packages", "jobs"]);
  // ลำดับของชุดตามฐานข้อมูล: ใบสั่งผลิตใหม่สุดก่อน (วันที่สั่งผลิต แล้วเลขที่) · งานเรียงตามใบ แผนก ชิ้นงาน เลขงาน · ชุดอื่นเรียงตามกุญแจ
  const LIST_ORDER = Object.freeze({
    orders: (a, b) => (Number(b.orderedAt) || 0) - (Number(a.orderedAt) || 0) || compareKey(a.id, b.id),
    jobs: (a, b) => compareKey(a.orderId, b.orderId) || compareKey(a.dept, b.dept) || compareKey(a.itemCode, b.itemCode) || compareKey(a.id, b.id),
  });
  // เป้าหมายการลบ: ชุดสี/แพ็กเกจ = {base, code} · งาน = {id}
  const deleteTarget = (list, record) => (list === "jobs" ? { id: record.id } : { base: record.base, code: record.code });
  const deleteKey = (list, target) => (list === "jobs" ? String(target?.id ?? target?.code ?? "") : `${target?.base}\u0000${target?.code}`);

  // เทียบค่าทั้งก้อน: ออบเจ็กต์ไม่สนลำดับกุญแจ (jsonb ของฐานข้อมูลเรียงกุญแจใหม่) อาร์เรย์สนลำดับ
  function sameValue(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === otherKeys.length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  // ชุดข้อมูลหลักสองชุดเหมือนกันไหม (ไม่สนลำดับระเบียนในชุด)
  function sameMaster(a, b) {
    return MASTER_LISTS.every((list) => {
      const left = a[list] ?? [];
      const right = b[list] ?? [];
      if (left.length !== right.length) return false;
      const key = MASTER_KEY[list];
      const byKey = new Map(right.map((record) => [key(record), record]));
      return left.every((record) => byKey.has(key(record)) && sameValue(record, byKey.get(key(record))));
    });
  }
  // ส่วนต่างของข้อมูลก่อน/หลังรัน action → p_changes ของ app_bom_save_master (ระเบียนที่เพิ่ม/เปลี่ยน ส่งทั้งระเบียน · ชุดสี/แพ็กเกจ/งานลบได้)
  function diffMaster(before, after) {
    const changes = {};
    for (const list of REMOTE_LISTS) {
      const key = MASTER_KEY[list];
      const old = new Map((before[list] ?? []).map((record) => [key(record), record]));
      const upsert = [];
      const kept = new Set();
      for (const record of after[list] ?? []) {
        kept.add(key(record));
        if (!old.has(key(record)) || !sameValue(old.get(key(record)), record)) upsert.push(clone(record));
      }
      const entry = {};
      if (upsert.length) entry.upsert = upsert;
      if (MASTER_DELETABLE.includes(list)) {
        const removed = (before[list] ?? []).filter((record) => !kept.has(key(record))).map((record) => deleteTarget(list, record));
        if (removed.length) entry.delete = removed;
      }
      if (Object.keys(entry).length) changes[list] = entry;
    }
    return changes;
  }
  const hasChanges = (changes) => Object.keys(changes).length > 0;
  const withoutKeys = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
  // ผู้ใช้ที่ไม่ใช่ฝ่ายวางแผน/ผู้จัดการ/admin: ฐานข้อมูลรับเฉพาะส่วนที่แผนกของตนแก้ได้ (รายงาน/สถานะงานของแผนกตน, ยอดนับคงคลังของใบร่างสำหรับ ST/WH)
  // ใบที่เปลี่ยน released → in_progress เพราะงานเริ่ม = ฐานข้อมูลทำเองในคำสั่งเดียวกัน จึงไม่ส่งเป็นการแก้ใบ · เวลา/ชื่อผู้นับคงคลังฐานข้อมูลประทับเอง จึงไม่ส่งค่าที่เพิ่งเปลี่ยน
  // changes ที่ใช้เทียบผลตอบกลับ (ว่าระเบียนไหนเป็นของเรา) ยังเป็นชุดเต็ม ส่วนที่ส่งจริงคือชุดนี้
  function shapeForActor(changes, before) {
    const upserts = changes.orders?.upsert;
    if (!upserts) return changes;
    const old = new Map((before.orders ?? []).map((record) => [record.id, record]));
    const kept = [];
    for (const record of upserts) {
      const prev = old.get(record.id);
      if (prev && prev.status === "released" && record.status === "in_progress" && sameValue(withoutKeys(prev, ["status"]), withoutKeys(record, ["status"]))) continue;
      const counted = ["stockCounts", "stockCountedAt", "stockCountedBy"];
      if (prev && prev.status === "draft" && record.status === "draft" && sameValue(withoutKeys(prev, counted), withoutKeys(record, counted))) {
        const copy = withoutKeys(clone(record), ["stockCountedAt", "stockCountedBy"]);
        if (prev.stockCountedAt !== undefined) copy.stockCountedAt = prev.stockCountedAt;
        if (prev.stockCountedBy !== undefined) copy.stockCountedBy = prev.stockCountedBy;
        kept.push(copy);
        continue;
      }
      kept.push(record);
    }
    const next = { ...changes };
    const entry = { ...changes.orders, upsert: kept };
    if (!kept.length) delete entry.upsert;
    if (Object.keys(entry).length) next.orders = entry;
    else delete next.orders;
    return next;
  }

  // ส่วนต่าง (delta) จากฐานข้อมูล { version, changes: { <ชุด>: { upsert: [เรคอร์ดเต็ม], delete: [{base, code}] | [{id}] } } } → รูปที่ครบทุกชุด (ชุดที่ฐานข้อมูลรุ่นเก่าไม่ส่งมา = ว่าง)
  function normalizeDelta(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(Number(value.version)) || !value.changes || typeof value.changes !== "object") {
      throw new Error("ข้อมูลส่วนต่าง BOM จากฐานข้อมูลอยู่ในรูปแบบที่ไม่รู้จัก");
    }
    const changes = {};
    for (const list of REMOTE_LISTS) {
      const entry = value.changes[list];
      changes[list] = { upsert: Array.isArray(entry?.upsert) ? entry.upsert : [], delete: Array.isArray(entry?.delete) ? entry.delete : [] };
    }
    return { version: Number(value.version), changes };
  }
  // รวมส่วนต่างของชุดเดียวเข้ากับระเบียนปัจจุบันตามกุญแจ (ลบก่อน แล้วระเบียนใหม่ทับ) · changed = เนื้อหาต่างจากที่มีอยู่จริง ไม่นับแค่ลำดับกุญแจในระเบียน
  // ชุดที่ไม่มีส่วนต่าง = คืนอาร์เรย์เดิม · ที่มี = อาร์เรย์ใหม่เรียงเหมือนฐานข้อมูล (กุญแจ collate "C" · ใบสั่งผลิต/งานตาม LIST_ORDER) · copy = ทำสำเนาระเบียนที่รับเข้ามา
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
    // ลำดับตามฐานข้อมูลเสมอเมื่อชุดนี้มีส่วนต่าง (แม้เนื้อหาเท่ากับที่แสดงอยู่ · changed บอกแค่ว่าต้องวาดหน้าใหม่หรือไม่)
    const order = LIST_ORDER[list];
    const records = order ? [...byKey.values()].sort(order) : [...byKey.entries()].sort((a, b) => compareKey(a[0], b[0])).map(([, record]) => record);
    return { records, changed };
  }

  // เลขที่ BOM-yy-nnnn / RT-yy-nnnn / JOB-yy-nnnn ออกจากตัวนับในเครื่อง: ตั้งตัวนับให้ไม่ต่ำกว่าเลขสูงสุดที่ฐานข้อมูลมี เครื่องอื่นจึงไม่ออกเลขชนกัน
  // ส่วน nnnn เท่ากันได้ระหว่างผู้ใช้สองคนที่เริ่มจากเวอร์ชันเดียวกัน จึงต่อรหัสสุ่ม base36 6 ตัวท้ายรหัส (ซ้ำ = ฐานข้อมูลตอบ BOM_STALE) · ยาวไม่เกิน 40 ตามที่ฐานข้อมูลรับ
  function randomSuffix() {
    let n;
    try {
      const bytes = root.crypto?.getRandomValues?.(new Uint32Array(1));
      n = bytes ? bytes[0] : Math.floor(Math.random() * 4294967296);
    } catch {
      n = Math.floor(Math.random() * 4294967296);
    }
    return (n % 2176782336).toString(36).padStart(6, "0"); // 36^6
  }
  function seedCounters(d) {
    for (const record of [...(d.boms ?? []), ...(d.routings ?? []), ...(d.jobs ?? [])]) {
      const match = /^(BOM|RT|JOB)-(\d{2})-(\d+)(?:-[0-9a-z]{6})?$/.exec(String(record.id ?? ""));
      if (!match) continue;
      const key = `${match[1]}-${match[2]}`;
      d.counters[key] = Math.max(d.counters[key] ?? 0, Number(match[3]));
    }
  }
  // routing ที่อ้างขั้นตอนมาตรฐานซึ่งยังไม่มีในฐานข้อมูล (ค่าเริ่มต้นใน bom-rules ที่ action เลือกได้แต่ไม่ได้เก็บ): เก็บลง processes พร้อมกัน ฐานข้อมูลจึงมีขั้นตอนที่ routing อ้างครบ
  function materializeProcesses(d, before) {
    const defaults = root.MNP_BOM_RULES?.DEFAULT_PROCESSES ?? [];
    const known = new Set(d.processes.map((process) => process.code));
    const sent = new Map((before.routings ?? []).map((routing) => [routing.id, routing]));
    for (const routing of d.routings) {
      if (sent.has(routing.id) && sameValue(sent.get(routing.id), routing)) continue;
      for (const step of Array.isArray(routing.steps) ? routing.steps : []) {
        const entry = !known.has(step.processCode) ? defaults.find((process) => process.code === step.processCode) : null;
        if (entry) { d.processes.push({ ...entry }); known.add(entry.code); }
      }
    }
  }

  // ข้อผิดพลาดของ RPC ข้อมูล BOM → ข้อความไทยสั้นๆ (ไม่แสดงข้อความดิบของฐานข้อมูล) · code ของ Error คือรหัสที่ฐานข้อมูลส่งมา
  function mapRemoteError(error, fallback = "บันทึกข้อมูล BOM ไม่สำเร็จ ลองใหม่อีกครั้ง") {
    const haystack = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""} ${typeof error === "string" ? error : ""}`;
    const code = /BOM_[A-Z0-9_]+/.exec(haystack)?.[0] ?? (/PGRST202|42883/.test(haystack) ? "BOM_NOT_DEPLOYED" : "BOM_REMOTE_FAILED");
    const message = {
      BOM_TEST_MODE_ONLY: "ข้อมูล BOM ใช้ได้เฉพาะผู้ดูแลระบบในโหมดทดสอบ",
      BOM_FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์แก้ข้อมูล BOM รายการนี้ (ฝ่ายวางแผน ผู้จัดการ และผู้ดูแลระบบทำได้ทุกรายการ แผนกอื่นรายงานได้เฉพาะงานของแผนกตน)",
      BOM_STALE: "มีผู้อื่นบันทึกข้อมูล BOM ไปก่อน ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาลองทำรายการอีกครั้ง",
      BOM_CONFLICT: "รายการนี้ซ้ำกับที่มีอยู่แล้ว (เช่น เลขที่ PI) ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาลองทำรายการอีกครั้ง",
      BOM_INVALID_TRANSITION: "ใบสั่งผลิตอยู่ในสถานะที่ทำรายการนี้ไม่ได้ (อาจมีผู้อื่นเปลี่ยนสถานะไปก่อน หรือมีงานที่เริ่มแล้ว) ระบบโหลดข้อมูลล่าสุดให้แล้ว",
      BOM_NOT_DEPLOYED: "ฐานข้อมูลยังไม่มีระบบ BOM (ยังไม่ได้ติดตั้ง migration) ติดต่อผู้ดูแลระบบ",
      BOM_TOO_MANY: "ข้อมูลชุดนี้มากเกินกว่าจะบันทึกในครั้งเดียว (เกิน 5,000 รายการต่อประเภท) แบ่งนำเข้าทีละส่วน",
      BOM_TOO_LARGE: "รูปชิ้นงานรวมกันใหญ่เกินกว่าจะบันทึกในครั้งเดียว",
      BOM_TOO_DEEP: "BOM ซ้อนกันลึกเกิน 30 ชั้น ตรวจว่ามีชิ้นงานใช้ตัวเองเป็นส่วนประกอบหรือไม่",
      BOM_CHILD_NOT_FOUND: "มีส่วนประกอบที่ยังไม่มีในรายการชิ้นงาน",
      BOM_ITEM_NOT_FOUND: "ไม่พบชิ้นงานนี้ในฐานข้อมูล ระบบโหลดข้อมูลล่าสุดให้แล้ว",
      BOM_NOT_FOUND: "ไม่พบรายการนี้ในฐานข้อมูล (อาจถูกลบไปแล้ว)",
      BOM_RB_ONE_COMPOUND: "เส้นยาง (RB) มีสูตรยางได้สูตรเดียว",
      BOM_RB_COMPOUND_MISMATCH: "สูตรยางใน BOM ของเส้นยางต้องตรงกับสูตรในข้อมูลเส้นยาง",
      BOM_REVISION_IMMUTABLE: "BOM revision ที่บันทึกแล้วแก้ไม่ได้ ให้บันทึกเป็น revision ใหม่",
      BOM_REVISION_ORDER: "มี BOM revision ใหม่กว่าในฐานข้อมูลแล้ว โหลดหน้าใหม่แล้วลองอีกครั้ง",
      BOM_ITEM_KIND_LOCKED: "เปลี่ยนชนิดของชิ้นงานที่มี BOM แล้วไม่ได้",
      BOM_CYCLE: "BOM วนกลับมาใช้ชิ้นงานตัวเองเป็นส่วนประกอบ",
    }[code] ?? (code.startsWith("BOM_INVALID") ? `ข้อมูลไม่ผ่านการตรวจของฐานข้อมูล (${code})` : fallback);
    return Object.assign(new Error(message), { code });
  }
  // การชน: ระเบียนที่แตะถูกผู้อื่นแก้ไปก่อน · เวอร์ชันฐานไม่ตรงฐานข้อมูล · เลขซ้ำ · สถานะใบเปลี่ยนไปแล้ว → ตามทันฐานข้อมูลก่อนให้ผู้ใช้ทำรายการใหม่
  const CONFLICT_CODES = Object.freeze(["BOM_STALE", "BOM_INVALID_PAYLOAD", "BOM_CONFLICT", "BOM_INVALID_TRANSITION"]);

  // บัญชีทดสอบ (state.employee ของ app.js ในโหมดทดสอบ) → ผู้ใช้ของ BOM
  // admin → admin · ผู้จัดการแผนกขึ้นไป → manager · แผนกวางแผน PP → planner · RB/GR/PT/BG/ST/WH → บทบาทของแผนกนั้น · อื่นๆ → ดูอย่างเดียว
  // สิทธิ์จริงตัดสินที่ฐานข้อมูล (app_bom_save_master) ตรงนี้ใช้ซ่อน/แสดงเมนูและปุ่มเท่านั้น
  const MANAGER_ROLE_CODES = Object.freeze(["department_manager", "assistant_factory_manager", "factory_manager", "general_manager"]);
  const DEPT_ROLES = Object.freeze({ PP: "planner", RB: "rb", GR: "gr", PT: "pt", BG: "bg", ST: "st", WH: "wh" });
  function roleOfEmployee(employee) {
    if (!employee) return "viewer";
    const roleCode = employee.role?.code ?? employee.role_code ?? "";
    if (roleCode === "admin") return "admin";
    if (MANAGER_ROLE_CODES.includes(roleCode)) return "manager";
    return DEPT_ROLES[String(employee.department?.code ?? employee.department_code ?? "").toUpperCase()] ?? "viewer";
  }
  function personaUser(employee) {
    if (!employee) return null;
    const role = roleOfEmployee(employee);
    const deptCode = String(employee.department?.code ?? employee.department_code ?? "").toUpperCase();
    const depts = root.MNP_BOM_RULES?.DEPTS ?? [];
    // dept ใช้แยกงานรายแผนก (DEPTS ของ bom-rules): ฝ่ายวางแผนทำงานบรรจุแทนในงาน PK · แผนกอื่นที่ไม่อยู่ในรายการเก็บรหัสจริงไว้ (ไม่ตรงกับงานใดๆ)
    const dept = depts.includes(deptCode) ? deptCode : role === "planner" ? "PK" : role === "admin" ? "AD" : deptCode;
    const name = `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim() || employee.display_name || employee.employee_no || "ผู้ใช้ทดสอบ";
    return { id: String(employee.id ?? employee.employee_no ?? name), role, dept, name };
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ข้อมูล BOM จากฐานข้อมูลอยู่ในรูปแบบที่ไม่รู้จัก");
    const snapshot = { version: value.version ?? 0 };
    for (const list of REMOTE_LISTS) snapshot[list] = Array.isArray(value[list]) ? value[list] : [];
    return snapshot;
  }
  // บันทึกการใช้งานจาก app_bom_audit: [{at, user, action, detail}] ใหม่สุดก่อน · at เป็นเวลา ISO หรือมิลลิวินาที
  function normalizeAudit(rows) {
    if (!Array.isArray(rows)) throw new Error("บันทึกการใช้งานจากฐานข้อมูลอยู่ในรูปแบบที่ไม่รู้จัก");
    return rows.map((row) => {
      const at = typeof row?.at === "number" ? row.at : Date.parse(String(row?.at ?? ""));
      return { at: Number.isFinite(at) ? at : 0, user: String(row?.user ?? ""), action: String(row?.action ?? ""), detail: String(row?.detail ?? "") };
    });
  }
  // รายการบันทึกการใช้งานของคำสั่งหนึ่ง (เก่าสุดก่อน): ฐานข้อมูลรับไม่เกิน 20 รายการ ชื่อการกระทำไม่เกิน 80 ตัวอักษร รายละเอียดไม่เกิน 300 · เกินกว่านั้นรวมท้ายเป็นรายการเดียว
  const AUDIT_MAX = 20;
  function auditPayload(entries) {
    const list = [...entries].reverse().map((entry) => ({ action: String(entry.action ?? "").slice(0, 80), detail: String(entry.detail ?? "").slice(0, 300) }));
    if (list.length <= AUDIT_MAX) return list;
    return [...list.slice(0, AUDIT_MAX - 1), { action: "รายการเพิ่มเติม", detail: `อีก ${list.length - (AUDIT_MAX - 1)} รายการในคำสั่งเดียวกัน` }];
  }
  const AUDIT_FRESH_MS = 3000; // หน้าบันทึกการใช้งานวาดซ้ำภายในช่วงนี้ไม่ดึงใหม่ (ดึงใหม่เมื่อมีการบันทึกหรือกดโหลดใหม่)

  // shouldHold() = หน้ามีฟอร์มที่แก้ค้าง/เปิด dialog อยู่ (หน้าส่งมา): ระหว่างนั้นข้อมูลของผู้อื่นที่มากับ catchUp หรือคำตอบของการบันทึกห้ามรวมเข้า data และห้ามขยับเวอร์ชันฐาน
  function createRemoteStore({ actions, now, remote, persona, idSuffix = randomSuffix, shouldHold: pageHolds = () => false }) {
    const shouldHold = () => { try { return Boolean(pageHolds()); } catch { return false; } };
    const canPlan = (user) => (typeof actions.helpers?.canPlan === "function" ? actions.helpers.canPlan(user) : true);
    let snapshot = null; // ข้อมูลชุดล่าสุดจากฐานข้อมูล (null = ยังไม่โหลด)
    let data = null; // ข้อมูลที่หน้าใช้: ตามฐานข้อมูล + ที่เพิ่งแก้และรอบันทึก · audit ว่างเสมอ (ดูจาก audit())
    let counters = {}; // ตัวนับเลข BOM/RT/JOB ในหน่วยความจำ (ตั้งต้นจากเลขสูงสุดที่มี ทุกครั้งที่รันคำสั่ง)
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

    function assemble() {
      const lists = Object.fromEntries(REMOTE_LISTS.map((list) => [list, clone(snapshot?.[list] ?? [])]));
      data = { version: STATE_VERSION, users: [], counters, audit: [], ...lists };
    }
    function init() {
      if (!data) assemble();
    }
    function fetchSnapshot() {
      return Promise.resolve().then(() => remote.load());
    }
    // รวมส่วนต่างเข้าชุดข้อมูลของฐานข้อมูล (snapshot) และเข้า data ที่หน้าใช้ถ้า intoData · คืน true ถ้าเนื้อหาใน data ต่างไปจากเดิม (ต้องวาดหน้าใหม่)
    function snapshotWith(base, delta) {
      const next = { ...base, version: Math.max(base.version ?? 0, delta.version) };
      for (const list of REMOTE_LISTS) next[list] = applyEntry(list, base[list], delta.changes[list], false).records;
      return next;
    }
    function mergeDelta(delta, intoData) {
      const nextSnapshot = snapshotWith(snapshot, delta);
      const nextData = intoData ? { ...data } : null;
      let changed = false;
      for (const list of REMOTE_LISTS) {
        if (nextData) {
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
    // ตามทันฐานข้อมูลหลังชน: ส่วนต่างตั้งแต่เวอร์ชันที่มี · ไม่ได้ (เครือข่าย หรือเวอร์ชันไม่ตรงฐานข้อมูล) ก็โหลดทั้งชุด · ไม่ได้อีกก็ใช้ชุดเดิม ลองใหม่ได้ภายหลัง
    // คืนชุดข้อมูลใหม่โดยยังไม่ตั้งเป็น snapshot (ผู้เรียกตรวจว่าผู้ใช้ไม่ได้เริ่มแก้ฟอร์มระหว่างรอก่อน) · null = ใช้ชุดเดิม
    async function fetchSnapshotAfterConflict() {
      try {
        return snapshotWith(snapshot, normalizeDelta(await remote.since(snapshot.version)));
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
        const removed = new Set((sent[list]?.delete ?? []).map((target) => deleteKey(list, target)));
        return delta.changes[list].upsert.some((record) => !mine.has(key(record))) || delta.changes[list].delete.some((target) => !removed.has(deleteKey(list, target)));
      });
    }
    // ส่วนของคำตอบที่เป็นระเบียนที่เราส่งเอง (กุญแจตรงกับที่ส่ง) · version = เวอร์ชันฐานเดิม (ไม่ขยับ)
    function ownRecordsOf(delta, sent, version) {
      const changes = {};
      for (const list of REMOTE_LISTS) {
        const key = MASTER_KEY[list];
        const mine = new Set((sent[list]?.upsert ?? []).map(key));
        const removed = new Set((sent[list]?.delete ?? []).map((target) => deleteKey(list, target)));
        changes[list] = { upsert: delta.changes[list].upsert.filter((record) => mine.has(key(record))), delete: delta.changes[list].delete.filter((target) => removed.has(deleteKey(list, target))) };
      }
      return { version, changes };
    }
    // หน้ากลับมาโฟกัส: ดึงส่วนต่างของผู้อื่นเข้ามาเงียบๆ วาดหน้าใหม่ (event synced) เฉพาะเมื่อเนื้อหาที่แสดงเปลี่ยนจริง
    // shouldHold ของ store (หรือที่ส่งมาตรงนี้ · เรียกตอนส่วนต่างมาถึง) เป็นจริง = ผู้ใช้มีฟอร์มที่แก้ค้าง: ห้ามรวมเข้า data และห้ามขยับเวอร์ชันฐาน ไม่งั้นการบันทึกถัดไปที่คำนวณจากฟอร์มเก่าจะส่งไปพร้อมเวอร์ชันใหม่
    // แล้วฐานข้อมูลมองไม่เห็นว่าชน (ทับงานของผู้อื่นเงียบๆ) · จำแค่ว่ามีข้อมูลใหม่ (event pending ครั้งเดียว) ตอนบันทึกฐานข้อมูลตรวจชนจากเวอร์ชันฐานเดิมและตอบส่วนต่างทั้งหมดตั้งแต่นั้นกลับมา
    // ไม่ทำขณะบันทึกอยู่ และทิ้งผลถ้ามี action เริ่มระหว่างรอ (ข้อมูลที่แสดงมีส่วนที่ผู้ใช้เพิ่งแก้) · ผิดพลาด = เงียบ รอบโฟกัสถัดไปลองใหม่
    // เวอร์ชันของเราล้ำหน้าฐานข้อมูล (BOM_INVALID_PAYLOAD เช่น ล้างข้อมูลทดสอบ) = โหลดทั้งชุดแทนส่วนต่าง (เงียบ ไม่เปลี่ยนสถานะเป็นกำลังโหลด · ไม่ทำถ้ามีฟอร์มค้าง)
    function catchUp(extraHold = () => false) {
      const holding = () => shouldHold() || Boolean(extraHold());
      if (status !== "ready" || busy) return Promise.resolve(false);
      if (catching) return catching;
      const base = snapshot.version;
      catching = Promise.resolve().then(() => remote.since(base)).then(normalizeDelta).then(
        (delta) => {
          if (busy || snapshot.version !== base) return false;
          if (holding()) {
            if (deltaHasRecords(delta) && !newerPending) { newerPending = true; emit({ type: "pending" }); }
            return false;
          }
          newerPending = false;
          const changed = mergeDelta(delta, true);
          if (changed) emit({ type: "synced", changed });
          return changed;
        },
        async (error) => {
          if (busy || snapshot.version !== base || holding() || mapRemoteError(error).code !== "BOM_INVALID_PAYLOAD") return false;
          let full;
          try { full = normalizeSnapshot(await fetchSnapshot()); } catch { return false; }
          // ระหว่างรอโหลดทั้งชุด ผู้ใช้อาจเริ่มบันทึก/แก้ฟอร์ม หรือมีคนขยับเวอร์ชันฐาน: ทิ้งผล (รอบโฟกัสถัดไปลองใหม่)
          if (busy || snapshot.version !== base || holding()) return false;
          snapshot = full;
          newerPending = false;
          auditStale = true;
          assemble();
          emit({ type: "synced", changed: true });
          return true;
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
        (error) => { loadError = mapRemoteError(error, "โหลดข้อมูล BOM ไม่สำเร็จ"); status = "error"; emit({ type: "load-failed", error: loadError }); },
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
      if (status !== "ready") return blocked(status === "loading" ? "กำลังโหลดข้อมูล BOM รอสักครู่แล้วลองอีกครั้ง" : "ยังโหลดข้อมูล BOM ไม่ได้ โหลดหน้าใหม่แล้วลองอีกครั้ง");
      if (busy) return blocked("กำลังบันทึกรายการก่อนหน้า รอสักครู่แล้วลองอีกครั้ง", { busy: true });
      const before = data;
      const user = persona();
      const draft = clone(data);
      draft.audit = []; // action เขียนบันทึกการใช้งานลงร่างนี้ แล้วส่งไปกับการบันทึก (ฐานข้อมูลเก็บ ไม่เก็บในเครื่อง)
      seedCounters(draft);
      let result;
      try {
        result = action(draft, payload ?? {}, { now: now(), user, idSuffix, remote: true });
        materializeProcesses(draft, before);
      } catch (error) {
        return { ok: false, error };
      }
      const changes = diffMaster(before, draft);
      const auditEntries = auditPayload(draft.audit);
      draft.audit = [];
      data = draft;
      const previousCounters = counters; // คำสั่งที่ฐานข้อมูลไม่รับ: เลขที่นับไปแล้วย้อนกลับด้วย
      counters = draft.counters;
      const sent = canPlan(user) ? changes : shapeForActor(changes, before);
      if (!hasChanges(sent)) return { ok: true, result: result ?? true, saving: Promise.resolve({ ok: true }) };
      busy = true;
      emit({ type: "saving" });
      const baseVersion = snapshot.version;
      const saving = Promise.resolve().then(() => remote.save(sent, baseVersion, name, auditEntries)).then(normalizeDelta).then(
        (delta) => {
          // ฐานข้อมูลตอบส่วนต่างตั้งแต่เวอร์ชันฐาน: ของเราที่ตรวจแล้ว + ที่ผู้อื่นบันทึกระหว่างนั้น · รวมเข้าชุดข้อมูลตามกุญแจ ลำดับและรูปแบบตามฐานข้อมูลเป็นหลัก
          // เนื้อหาเท่ากับที่แสดงอยู่แล้ว (เช่น มีแต่ของเรา) ไม่ต้องวาดหน้าใหม่
          // changed = เนื้อหาต่างจากที่แสดง (รวมที่ฐานข้อมูลประทับเวลา/ผู้บันทึกให้ระเบียนของเราเอง) · others = มีระเบียนที่เราไม่ได้ส่ง (ผู้อื่นบันทึกระหว่างนั้น) ใช้แจ้งผู้ใช้
          const others = hasForeignRecords(delta, changes);
          auditStale = true;
          if (others && shouldHold()) {
            // ระหว่างรอคำตอบ ผู้ใช้เริ่มแก้ฟอร์มอื่น/เปิด dialog (สร้างจากข้อมูลก่อนที่ผู้อื่นบันทึก): ห้ามรวมระเบียนของผู้อื่นเข้า data และห้ามขยับเวอร์ชันฐานของการบันทึกถัดไป
            // ไม่งั้นการบันทึกถัดไปจากฟอร์มนั้นจะส่งพร้อมเวอร์ชันใหม่แล้วฐานข้อมูลมองไม่เห็นว่าชน (ทับงานของผู้อื่นเงียบๆ)
            // รวมเฉพาะระเบียนของเราเองเข้า snapshot (data มีอยู่แล้วแบบ optimistic) แต่ไม่ขยับเวอร์ชัน · ฐานย้อนกลับ (ถ้าบันทึกถัดไปล้ม) = snapshot นี้ · การบันทึกถัดไปที่แตะระเบียนเดิมของเราอาจได้ BOM_STALE เทียม (ปลอดภัย)
            // ที่เหลือ (ของผู้อื่น + ตัวที่ฐานข้อมูลประทับใหม่) มากับ catchUp/การวาดหน้าครั้งถัดไป ซึ่งดึงส่วนต่างตั้งแต่เวอร์ชันฐานเดิม
            snapshot = snapshotWith(snapshot, ownRecordsOf(delta, changes, snapshot.version));
            busy = false;
            emit({ type: "saved", changed: false, others: true, held: true });
            if (!newerPending) { newerPending = true; emit({ type: "pending" }); }
            return { ok: true };
          }
          const changed = mergeDelta(delta, true);
          newerPending = false; // ส่วนต่างตั้งแต่เวอร์ชันฐานรวมทุกอย่างของผู้อื่นแล้ว
          busy = false;
          emit({ type: "saved", changed, others });
          return { ok: true };
        },
        async (error) => {
          const mapped = mapRemoteError(error);
          // ชน หรือเวอร์ชันฐานไม่ตรงฐานข้อมูล: ตามทันด้วยส่วนต่าง (ไม่ได้ก็โหลดทั้งชุด) ก่อนแสดงข้อมูลล่าสุดให้ผู้ใช้ทำรายการใหม่
          // ย้อนกลับทั้งคำสั่ง: ฐานย้อนกลับ = snapshot ปัจจุบัน (เวอร์ชันฐานเดิม + ระเบียนของเราที่บันทึกสำเร็จไปแล้วแต่ยังถูกกันไว้) · ถ้าผู้ใช้มีฟอร์มค้างอยู่ (ก่อนหรือระหว่างรอตามทัน) ไม่ดึงข้อมูลผู้อื่นเข้ามา แค่จำว่ามีใหม่
          const conflict = CONFLICT_CODES.includes(mapped.code);
          let held = shouldHold();
          if (conflict && !held) {
            const fresh = await fetchSnapshotAfterConflict();
            held = shouldHold();
            if (fresh && !held) { snapshot = fresh; newerPending = false; auditStale = true; }
          }
          if (conflict && held && !newerPending) { newerPending = true; emit({ type: "pending" }); }
          counters = previousCounters;
          assemble();
          busy = false;
          emit({ type: "reverted", error: mapped, held });
          return { ok: false, error: mapped };
        },
      );
      return { ok: true, result: result ?? true, saving };
    }

    // บันทึกการใช้งาน: อ่านจาก app_bom_audit (ใหม่สุดก่อน) ทุกครั้งที่หน้านี้วาดและข้อมูลเก่ากว่าที่บันทึกล่าสุดหรือเกิน AUDIT_FRESH_MS · force = โหลดใหม่ทันที
    function loadAudit(force = false) {
      init();
      if (auditLoading) return auditLoading;
      if (!force && !auditStale && now() - auditAt < AUDIT_FRESH_MS) return Promise.resolve();
      if (typeof remote.audit !== "function") {
        auditView = { status: "error", entries: [], error: mapRemoteError({ code: "PGRST202" }) };
        return Promise.resolve();
      }
      auditView = { ...auditView, status: auditView.entries.length ? "ready" : "loading" };
      auditLoading = Promise.resolve().then(() => remote.audit(200)).then(normalizeAudit).then(
        (entries) => { auditView = { status: "ready", entries, error: null }; auditStale = false; },
        (error) => { auditView = { status: "error", entries: auditView.entries, error: mapRemoteError(error, "โหลดบันทึกการใช้งานไม่สำเร็จ") }; },
      ).then(() => { auditAt = now(); auditLoading = null; emit({ type: "audit" }); });
      return auditLoading;
    }
    // ล้างข้อมูล BOM ทดสอบทั้งหมดในฐานข้อมูล (เฉพาะผู้ดูแลระบบในโหมดทดสอบ ฐานข้อมูลตรวจเอง) แล้วโหลดใหม่จากศูนย์ · ไม่ทำขณะบันทึกอยู่
    async function purge() {
      init();
      if (busy) return blocked("กำลังบันทึกรายการก่อนหน้า รอสักครู่แล้วลองอีกครั้ง", { busy: true });
      if (typeof remote.purge !== "function") return blocked("เบราว์เซอร์นี้ล้างข้อมูล BOM ทดสอบไม่ได้");
      busy = true;
      emit({ type: "saving" });
      let reply;
      try {
        reply = await remote.purge();
      } catch (error) {
        busy = false;
        const mapped = mapRemoteError(error, "ล้างข้อมูล BOM ทดสอบไม่สำเร็จ");
        emit({ type: "purge-failed", error: mapped });
        return { ok: false, error: mapped.code === "BOM_FORBIDDEN" ? Object.assign(new Error("ล้างข้อมูล BOM ทดสอบได้เฉพาะผู้ดูแลระบบในโหมดทดสอบ"), { code: mapped.code }) : mapped };
      }
      busy = false;
      counters = {};
      auditView = { status: "idle", entries: [], error: null };
      auditStale = true;
      snapshot = null;
      status = "idle";
      await reload();
      return { ok: status === "ready", deleted: Number(reply?.deleted) || 0, error: status === "ready" ? null : loadError };
    }

    const reset = () => { init(); return data; }; // โหมดฐานข้อมูลไม่มีการรีเซ็ตในเครื่อง (ล้างข้อมูลทดสอบ = purge)
    return {
      load: () => { init(); return data; }, data: () => { init(); return data; }, user: () => persona(), setUser: () => persona(), run, reset, isPersisted: () => true, size: () => 0, now,
      isRemote: () => true, status: () => status, error: () => loadError, isSaving: () => busy, hasNewer: () => newerPending, version: () => snapshot?.version ?? null,
      ensureLoaded, reload, catchUp, idSuffix, audit: () => auditView, loadAudit, purge, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
  }

  // remote = { load(): Promise<snapshot>, save(changes, baseVersion, action, audit): Promise<delta>, since(version): Promise<delta>, audit(limit): Promise<[{at, user, action, detail}]>, purge(): Promise<{deleted}> } → ข้อมูลทั้งหมดอยู่ในฐานข้อมูล (createRemoteStore)
  // snapshot = { version, <ชุดข้อมูล>: [...] } · delta = { version, changes: { <ชุด>: { upsert: [...], delete: [{base, code}] | [{id}] } } }
  // ไม่ส่ง remote = ทั้งชุดอยู่ใน localStorage เหมือนเดิม (ชุดสาธิต + บทบาทสาธิต) · persona() = ผู้ใช้ปัจจุบันของโหมดฐานข้อมูล
  function createStore({ storage = null, seed, actions, now = () => Date.now(), remote = null, persona = () => null, idSuffix, shouldHold } = {}) {
    if (remote) return createRemoteStore({ actions, now, remote, persona, idSuffix, shouldHold });
    let data = null;
    let userId = null;
    let loaded = false;
    let persisted = true;
    // ข้อความ state ที่อ่าน/เขียนล่าสุด: ถ้าแท็บอื่นของเบราว์เซอร์เดียวกันบันทึกทับ (ค่าใน storage ไม่ตรง) อ่านใหม่ก่อนใช้
    // เพื่อไม่ให้แท็บที่เปิดค้างไว้เขียนข้อมูลเก่าในหน่วยความจำทับของใหม่ตอนเปลี่ยนบทบาทหรือกดบันทึก
    let lastRaw = null;
    let newer = false;
    function save() {
      if (newer) return;
      const text = JSON.stringify(data);
      try {
        storage?.setItem?.(STATE_KEY, text);
        if (storage?.setItem) lastRaw = text;
        persisted = true;
      } catch {
        persisted = false; // storage เต็มหรือปิดอยู่: หน้ายังทำงานต่อได้ในหน่วยความจำ
      }
    }

    function load() {
      const raw = readRaw(storage, STATE_KEY);
      if (loaded && raw === lastRaw) return data;
      lastRaw = raw;
      const saved = readJson(storage, STATE_KEY);
      const valid = isValidState(saved);
      // state รุ่นใหม่กว่าโค้ดนี้ (แท็บเก่าที่เปิดค้างไว้ตอนมีรุ่นใหม่ หรือย้อน deploy): ห้ามเขียนทับด้วยชุดสาธิต
      // ใช้ชุดสาธิตในหน่วยความจำเท่านั้นและไม่บันทึก จนกว่าจะโหลดหน้าใหม่ด้วยโค้ดรุ่นที่อ่านได้
      newer = Boolean(saved) && Number(saved.version) > STATE_VERSION;
      if (newer) { data = seed(); persisted = false; }
      else data = valid ? saved : migrate(saved) ?? seed();
      if (!valid && !newer) save(); // เขียน state ที่อัปเกรดหรือชุดสาธิตใหม่กลับทันที
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
        save();
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
        save();
        return { ok: true, result: result ?? true };
      } catch (error) {
        return { ok: false, error };
      }
    }
    function reset() {
      data = seed();
      loaded = true;
      save();
      return data;
    }
    // ขนาดข้อมูลที่เก็บ (ตัวอักษร JSON) ให้หน้า "นำเข้า" เตือนเมื่อใกล้เพดานของ localStorage (~5 ล้านตัวอักษร)
    const size = () => { load(); return JSON.stringify(data).length; };
    // ส่วนเดียวกับ store โหมดฐานข้อมูล เพื่อให้ module-bom ใช้โค้ดชุดเดียว: ไม่มีการโหลด/บันทึกระยะไกล
    return { load, data: getData, user: getUser, setUser, run, reset, isPersisted: () => persisted, size, now, isRemote: () => false, status: () => "ready", error: () => null, isSaving: () => false, hasNewer: () => false, version: () => null, ensureLoaded: () => Promise.resolve(), reload: () => Promise.resolve(), catchUp: () => Promise.resolve(false), audit: () => ({ status: "ready", entries: getData().audit, error: null }), loadAudit: () => Promise.resolve(), purge: () => Promise.resolve({ ok: false, error: new Error("ล้างข้อมูล BOM ทดสอบได้เฉพาะโหมดฐานข้อมูล") }), subscribe: () => () => {} };
  }

  const api = { STATE_KEY, USER_KEY, LOCAL_KEY, STATE_VERSION, MODULES, MODULE_IDS, GROUPS, ROLES, findModule, canSee, homeOf, isValidState, migrate, createStore, MASTER_LISTS, WORK_LISTS, REMOTE_LISTS, diffMaster, sameMaster, mapRemoteError, roleOfEmployee, personaUser };
  if (isNode) module.exports = api;
  else root.MNP_BOM_STORE = api;
})(typeof window !== "undefined" ? window : globalThis);
