// ทะเบียนสิทธิ์ผู้ใช้ (itua) — ส่วนข้อมูลล้วนของหน้าเว็บ ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itua-model.test.mjs)
// สัญญา RPC: docs/itua-contract.md · สเปกเจ้าของ: Work-Order/docs/it-user-access-spec.md (ข้อ 3.1)
// ฐานข้อมูลเป็นผู้ตัดสินทุกอย่าง (สิทธิ์ ความซ้ำ กติกาเหตุผล): ไฟล์นี้ตั้งชื่อ กรอง จัดตาราง ตรวจฟอร์มให้ผู้ใช้เห็นข้อความไทยก่อนส่ง และประกอบพารามิเตอร์ของ RPC
// วันที่แสดงเป็น วว/ดด/ปปปป (พ.ศ. เหมือนโมดูลอื่นของระบบสำนักงาน) เวลา Asia/Bangkok · วันที่ที่ส่งฐานข้อมูลเป็น ค.ศ. YYYY-MM-DD
// โมดูลนี้ไม่มีช่องลับ (รหัสผ่าน/License) เลย: ตารางฝั่งฐานข้อมูลไม่มีคอลัมน์ลับ ใบพิมพ์/CSV จึงไม่มีทางหลุด
(function (root) {
  "use strict";

  const YEAR_OFFSET = 543;
  // เลขเวอร์ชันของโมดูล (ป้ายบนการ์ด + มุมขวาล่างทุกหน้า) รูปแบบ <ใหญ่>.<ย่อย 2 หลัก> · กติกาเดียวกับใบสั่งงาน/ใบแจ้งซ่อม/ทะเบียนอุปกรณ์ (ถามเจ้าของก่อนเปลี่ยนทุกครั้ง)
  const MODULE_VERSION = "1.00";
  const VERSION_DATE = "2026-11-26";
  // ธง "กำลังพัฒนา" (จุดเดียว): true = การ์ดมีป้าย "กำลังพัฒนา" และทุกหน้าของโมดูลมีแถบข้อความว่ายังไม่เปิดใช้งานจริง · ถอดเมื่อเจ้าของสั่ง
  const IN_DEVELOPMENT = true;
  const ACCESS_CODE = "IT_USER_ACCESS"; // รหัสโมดูลสำหรับสิทธิ์แผนกของการ์ด
  const MIN_DATE = "1990-01-01";
  const MAX_DATE = "2100-01-01";
  const MAX_LISTED = 2000; // list_users/matrix ขอครั้งเดียวสูงสุดเท่านี้
  const MAX_CHANGES = 200; // set_grants ต่อครั้ง

  /* ---------- เส้นทาง ---------- */
  // #/office?module=access (ผู้ใช้) · &view=matrix (เมทริกซ์) · &view=catalog (ตั้งค่า) · &user=<uuid> (หน้าต่อคน)
  const BASE_URL = "#/office?module=access";
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));
  const listUrl = () => BASE_URL;
  const matrixUrl = () => `${BASE_URL}&view=matrix`;
  const catalogUrl = () => `${BASE_URL}&view=catalog`;
  const userUrl = (id) => `${BASE_URL}&user=${encodeURIComponent(id)}`;
  // ค่าที่ไม่รู้จัก (view แปลก uuid ผิดรูป ใช้ view กับ user พร้อมกัน) = null (หน้า "ไม่พบ")
  function readRoute(params) {
    const view = params?.get?.("view") ?? "";
    const user = params?.get?.("user") ?? "";
    if (user) return view || !isUuid(user) ? null : { view: "user", id: user.toLowerCase() };
    if (view === "") return { view: "list" };
    return view === "matrix" || view === "catalog" ? { view } : null;
  }
  const TABS = Object.freeze([
    { view: "list", label: "ผู้ใช้", url: listUrl() },
    { view: "matrix", label: "เมทริกซ์สิทธิ์", url: matrixUrl() },
    { view: "catalog", label: "ตั้งค่า", url: catalogUrl() },
  ]);

  /* ---------- ค่าที่ใช้ซ้ำ ---------- */
  const DIVISIONS = Object.freeze([
    { value: "office", label: "สำนักงาน" },
    { value: "factory", label: "โรงงาน" },
    { value: "manager", label: "ผู้จัดการ" },
    { value: "office_indesign", label: "สำนักงาน (InDesign)" },
  ]);
  const divisionLabel = (value) => DIVISIONS.find((item) => item.value === value)?.label ?? (value || "—");
  const USER_STATUSES = Object.freeze([{ value: "active", label: "ใช้งาน" }, { value: "resigned", label: "ลาออก" }]);
  const statusLabel = (value) => USER_STATUSES.find((item) => item.value === value)?.label ?? (value || "—");
  const statusTone = (value) => (value === "active" ? "ok" : "off");
  const LEVELS = Object.freeze([{ value: "R", label: "R อ่านอย่างเดียว" }, { value: "F", label: "F เต็ม" }]);
  const EMAIL_KINDS = Object.freeze([{ value: "internal", label: "อีเมลภายใน" }, { value: "extra", label: "อีเมลอื่น ๆ" }]);
  const emailKindLabel = (value) => EMAIL_KINDS.find((item) => item.value === value)?.label ?? (value || "");
  const OTHER_PROGRAM = "OTHER"; // โปรแกรม "อื่นๆ" ต้องระบุหมายเหตุว่าเป็นโปรแกรมอะไร

  const textOf = (value) => String(value ?? "").trim();
  const charCount = (value) => Array.from(String(value ?? "")).length;
  const pad = (value) => String(value).padStart(2, "0");

  /* ---------- วันที่ / เวลา ---------- */
  const BANGKOK = { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  function bangkokParts(date) {
    const parts = {};
    for (const part of new Intl.DateTimeFormat("en-GB", BANGKOK).formatToParts(date)) parts[part.type] = part.value;
    return parts;
  }
  const isRealDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  function formatDate(dateOnly) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateOnly ?? ""));
    if (!match) return dateOnly ? String(dateOnly) : "—";
    return `${match[3]}/${match[2]}/${Number(match[1]) + YEAR_OFFSET}`;
  }
  function formatDateTime(timestamp) {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return String(timestamp);
    const { year, month, day, hour, minute } = bangkokParts(date);
    return `${day}/${month}/${Number(year) + YEAR_OFFSET} ${hour}:${minute}`;
  }
  // ช่องวันที่แบบพิมพ์เอง: รับ วว/ดด/ปปปป ทั้ง พ.ศ. และ ค.ศ. (ปี ≥ 2400 ถือเป็น พ.ศ.) · คั่นด้วย / - . หรือช่องว่าง · เลขไทยได้ · พิมพ์ติด 8 หลักได้ · YYYY-MM-DD ก็รับ
  // (ตรรกะเดียวกับ parseDateInput ของ itas-model.js คัดมาไว้ที่นี่ ไม่ import ข้ามโมดูล) · คืน YYYY-MM-DD (ค.ศ.) เมื่อเป็นวันที่จริง ไม่งั้น null
  const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
  const DATE_INPUT_HINT = "พิมพ์เป็น วว/ดด/ปปปป เช่น 05/03/2566 (พ.ศ.) หรือ 05/03/2023 (ค.ศ.)";
  function parseDateInput(text) {
    const raw = String(text ?? "").replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit))).trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
    let year; let month; let day;
    if (match) [year, month, day] = match.slice(1).map(Number);
    else if ((match = /^(\d{1,2})[\s/.-]+(\d{1,2})[\s/.-]+(\d{4})$/.exec(raw)) || (match = /^(\d{2})(\d{2})(\d{4})$/.exec(raw))) [day, month, year] = match.slice(1).map(Number);
    else return null;
    if (year >= 2400) year -= YEAR_OFFSET;
    if (year < 1000) return null;
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    return isRealDate(iso) ? iso : null;
  }
  const dateInputText = (value) => (isRealDate(value) ? formatDate(value) : String(value ?? ""));
  const dateInRange = (iso) => isRealDate(iso) && iso >= MIN_DATE && iso <= MAX_DATE;
  const dateTimeText = (now) => formatDateTime(now ?? new Date());

  /* ---------- รายการผู้ใช้: ชื่อ ค้นหา กรอง ---------- */
  const userName = (row) => textOf(row?.name_th) || textOf(row?.name_en) || "—";
  // ชื่ออีกภาษา (ถ้ามีทั้งสองภาษา) ไว้แสดงบรรทัดรอง
  const userSubName = (row) => (textOf(row?.name_th) && textOf(row?.name_en) ? textOf(row.name_en) : "");
  const sortedUnique = (values) => [...new Set(values.map(textOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  const departmentOptions = (rows) => sortedUnique((Array.isArray(rows) ? rows : []).map((row) => row.department_code));
  // กรองฝั่งเบราว์เซอร์จากรายการที่โหลดมาทั้งหมด (ผู้ใช้ไม่กี่สิบคน) · ค้นไม่สนตัวพิมพ์ใหญ่เล็ก ใน Auth. Name / ชื่อ / แผนก / อีเมลภายใน (รายการนี้ไม่มีอีเมลอื่น ๆ)
  function filterUsers(rows, { query = "", department = "", division = "", status = "" } = {}) {
    const needle = textOf(query).toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      if (department && textOf(row.department_code) !== department) return false;
      if (division && row.division !== division) return false;
      if (status && row.status !== status) return false;
      if (!needle) return true;
      return [row.auth_id, row.name_th, row.name_en, row.department_code, row.internal_email].some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }
  const countText = (shown, total) => (shown === total ? `${total} คน` : `แสดง ${shown} จาก ${total} คน`);
  // "R 3 · F 2" · ไม่มีสิทธิ์โฟลเดอร์เลย = ""
  function folderSummaryText(row) {
    const parts = [];
    if (Number(row?.folder_r) > 0) parts.push(`R ${row.folder_r}`);
    if (Number(row?.folder_f) > 0) parts.push(`F ${row.folder_f}`);
    return parts.join(" · ");
  }
  // เมทริกซ์: นับ R/F จาก levels ของแถว (เฉพาะโฟลเดอร์ที่ใช้งานอยู่)
  function levelCounts(levels) {
    const counts = { R: 0, F: 0 };
    for (const level of Object.values(levels ?? {})) if (level === "R" || level === "F") counts[level] += 1;
    return counts;
  }
  const levelOf = (row, code) => (row?.levels?.[code] === "R" || row?.levels?.[code] === "F" ? row.levels[code] : "");

  /* ---------- ฟอร์มผู้ใช้ (เพิ่ม/แก้ข้อมูลหลัก) ---------- */
  // key ตรงกับช่องใน p_data ของ app_itua_save_user · internet/status ไม่อยู่ที่นี่ (เปลี่ยนผ่าน set_grants/set_status)
  const USER_FIELDS = Object.freeze([
    { key: "auth_id", label: "Auth. Name", type: "text", max: 60, required: true, hint: "ตัวอักษรอังกฤษ ตัวเลข . _ - เช่น somchai.k (ระบบแปลงเป็นตัวพิมพ์เล็กให้)" },
    { key: "name_th", label: "ชื่อ (ไทย)", type: "text", max: 200 },
    { key: "name_en", label: "ชื่อ (อังกฤษ)", type: "text", max: 200 },
    { key: "department_code", label: "แผนก", type: "text", max: 50, code: true, hint: "รหัสแผนกตามที่ใช้ในทะเบียน เช่น IT, ACC (พิมพ์ได้อิสระ ระบบแปลงเป็นตัวพิมพ์ใหญ่)" },
    { key: "division", label: "ฝ่าย", type: "division", required: true },
    { key: "granted_doc_no", label: "เลขใบที่ให้สิทธิ์", type: "text", max: 50 },
    { key: "granted_on", label: "วันที่ให้สิทธิ์", type: "date" },
    { key: "note", label: "หมายเหตุ", type: "longtext", max: 2000 },
  ]);
  const USER_FIELD_BY_KEY = Object.freeze(Object.fromEntries(USER_FIELDS.map((field) => [field.key, field])));
  const emptyUserValues = () => Object.fromEntries(USER_FIELDS.map((field) => [field.key, ""]));
  const userValuesFromUser = (user) => Object.fromEntries(USER_FIELDS.map((field) => [field.key, field.type === "date" ? dateInputText(user?.[field.key]) : String(user?.[field.key] ?? "")]));
  // ค่าที่จะส่ง/เทียบ: ตัดช่องว่าง · ว่าง = null · Auth. Name ตัวเล็ก · แผนกตัวใหญ่ · วันที่แปลงเป็น ค.ศ. (อ่านไม่ได้ = คืนข้อความเดิมให้ validate ตีตก)
  function normalizeUserValue(field, text) {
    const value = textOf(text);
    if (!value) return null;
    if (field.key === "auth_id") return value.toLowerCase();
    if (field.key === "department_code") return value.toUpperCase();
    if (field.type === "date") return parseDateInput(value) ?? value;
    return value;
  }
  const AUTH_ID_PATTERN = /^[a-z0-9]([a-z0-9._-]{0,58}[a-z0-9])?$/;
  function validateUser(values) {
    const errors = [];
    const add = (field, message) => errors.push({ field, message });
    const auth = normalizeUserValue(USER_FIELD_BY_KEY.auth_id, values.auth_id);
    if (!auth) add("auth_id", "กรุณาระบุ Auth. Name");
    else if (!AUTH_ID_PATTERN.test(auth)) add("auth_id", "Auth. Name ต้องเป็นตัวอักษรอังกฤษ ตัวเลข . _ - (ขึ้นต้นและลงท้ายด้วยตัวอักษรหรือตัวเลข ไม่เกิน 60 ตัว)");
    if (!textOf(values.name_th) && !textOf(values.name_en)) add("name_th", "กรุณาระบุชื่อ (ไทยหรืออังกฤษอย่างน้อยหนึ่งช่อง)");
    if (!DIVISIONS.some((item) => item.value === textOf(values.division))) add("division", "กรุณาเลือกฝ่าย");
    for (const field of USER_FIELDS) {
      const text = textOf(values[field.key]);
      if ((field.type === "text" || field.type === "longtext") && charCount(text) > field.max && !(field.key === "auth_id" && errors.some((item) => item.field === "auth_id"))) {
        add(field.key, `${field.label} ยาวเกิน ${field.max} ตัวอักษร`);
      }
      if (field.type === "date" && text) {
        const iso = parseDateInput(text);
        if (!iso) add(field.key, `${field.label}: ${DATE_INPUT_HINT}`);
        else if (!dateInRange(iso)) add(field.key, `${field.label} ต้องอยู่ระหว่างปี ค.ศ. 1990–2100`);
      }
    }
    return errors;
  }
  const sameStored = (stored, next) => (stored ?? null) === (next ?? null);
  // แก้: ส่งเฉพาะช่องที่ค่าเปลี่ยนจริง (ตัวเดียวกับที่ฐานข้อมูลเทียบ) + expected_updated_at + เหตุผล · เพิ่ม: ส่งช่องที่มีค่าทั้งหมด (ไม่ส่งเหตุผล ไม่ต้องใช้)
  function buildUserPayload({ original = null, values, reason = "", userId = null }) {
    const data = {};
    for (const field of USER_FIELDS) {
      const next = normalizeUserValue(field, values[field.key]);
      if (original ? !sameStored(normalizeUserValue(field, field.type === "date" ? dateInputText(original[field.key]) : original[field.key]), next) : next !== null) data[field.key] = next;
    }
    if (!original) return { p_id: userId, p_data: data, p_reason: null, p_expected_updated_at: null };
    return { p_id: original.id, p_data: data, p_reason: textOf(reason) || null, p_expected_updated_at: original.updated_at };
  }
  const payloadIsEmpty = (payload) => !Object.keys(payload.p_data).length;
  // บันทึกซ้ำด้วย id เดิมหลังเน็ตหลุด: ครั้งแรกสำเร็จไปแล้ว → "ผู้ใช้นี้มีอยู่แล้ว…" ให้หน้าเว็บโหลดแถวมาต่อ
  const isAlreadyExists = (error) => String(error?.code ?? "") === "23514" && /มีอยู่แล้ว/.test(String(error?.message ?? ""));
  const reasonProblem = (reason, label = "เหตุผล") => (textOf(reason) ? (charCount(reason) > 1000 ? `${label}ยาวเกิน 1,000 ตัวอักษร` : "") : `กรุณาระบุ${label} (บันทึกสำหรับ ISO)`);

  /* ---------- สถานะ (ใช้งาน/ลาออก) ---------- */
  // สิทธิ์ที่ผู้ใช้ยังถืออยู่ (จากข้อมูลที่โหลดมาแล้ว) ไว้เตือนก่อนเปลี่ยนเป็นลาออก · ระบบไม่ถอดสิทธิ์ให้เอง
  function holdingsOf(detail) {
    return {
      folders: Array.isArray(detail?.folders) ? detail.folders.length : 0,
      programs: Array.isArray(detail?.programs) ? detail.programs.length : 0,
      internet: Boolean(detail?.user?.internet),
      emails: (Array.isArray(detail?.emails) ? detail.emails : []).filter((email) => email.status === "active").length,
    };
  }
  const hasHoldings = (remaining) => Boolean(remaining && (remaining.folders > 0 || remaining.programs > 0 || remaining.internet || remaining.emails > 0));
  function holdingsText(remaining) {
    const parts = [];
    if (remaining?.folders > 0) parts.push(`โฟลเดอร์ ${remaining.folders} รายการ`);
    if (remaining?.programs > 0) parts.push(`โปรแกรม ${remaining.programs} รายการ`);
    if (remaining?.internet) parts.push("อินเทอร์เน็ต");
    if (remaining?.emails > 0) parts.push(`อีเมลที่ใช้งานอยู่ ${remaining.emails} รายการ`);
    return parts.join(" · ");
  }

  /* ---------- สิทธิ์ (แก้เป็นชุด) ---------- */
  // โครงของฟอร์มสิทธิ์: โฟลเดอร์/โปรแกรมที่เปิดใช้งาน + ที่ปิดใช้งานแต่ผู้ใช้ยังถืออยู่ (ถอนได้ เพิ่มไม่ได้) · ผู้ใช้ที่ลาออก = ถอนได้อย่างเดียว
  function grantFormModel({ detail, catalog }) {
    const user = detail?.user ?? {};
    const heldFolders = new Map((detail?.folders ?? []).map((item) => [item.code, item.level]));
    const heldPrograms = new Map((detail?.programs ?? []).map((item) => [item.code, item.note ?? ""]));
    const folders = (catalog?.folders ?? []).filter((item) => item.is_active || heldFolders.has(item.code))
      .map((item) => ({ code: item.code, name: item.name, description: item.description ?? "", isActive: item.is_active !== false, current: heldFolders.get(item.code) ?? null }));
    const programs = (catalog?.programs ?? []).filter((item) => item.is_active || heldPrograms.has(item.code))
      .map((item) => ({ code: item.code, name: item.name, isActive: item.is_active !== false, current: heldPrograms.has(item.code), note: heldPrograms.get(item.code) ?? "" }));
    return { userId: user.id ?? "", resigned: user.status !== "active", internet: Boolean(user.internet), folders, programs };
  }
  // ที่เปลี่ยนได้จากค่าปัจจุบัน: เลือกได้เฉพาะค่าปัจจุบัน + ไม่มีสิทธิ์ เมื่อ (ลาออก/ปิดใช้งาน) · ปกติเลือกได้ครบ
  const folderOptions = (model, item) => (model.resigned || !item.isActive
    ? [{ value: "", label: "ไม่มีสิทธิ์" }, ...LEVELS.filter((level) => level.value === item.current)]
    : [{ value: "", label: "ไม่มีสิทธิ์" }, ...LEVELS]);
  const canAddProgram = (model, item) => !model.resigned && item.isActive;
  const canAddInternet = (model) => !model.resigned;
  // next = { folders: { รหัส: ""|"R"|"F" }, internet: boolean, programs: { รหัส: { on: boolean, note: string } } }
  function currentGrantState(model) {
    return {
      folders: Object.fromEntries(model.folders.map((item) => [item.code, item.current ?? ""])),
      internet: model.internet,
      programs: Object.fromEntries(model.programs.map((item) => [item.code, { on: item.current, note: item.note }])),
    };
  }
  const noteValue = (text) => textOf(text) || null;
  // รายการที่เปลี่ยนเทียบกับค่าปัจจุบัน (ส่งทั้ง from และ to ตามสัญญา) · ไม่มีอะไรเปลี่ยน = []
  function buildGrantChanges(model, next) {
    const changes = [];
    for (const item of model.folders) {
      const to = next.folders?.[item.code] || null;
      if ((item.current ?? null) !== to) changes.push({ kind: "folder", code: item.code, from: item.current ?? null, to });
    }
    if (Boolean(next.internet) !== model.internet) changes.push({ kind: "internet", from: model.internet, to: Boolean(next.internet) });
    for (const item of model.programs) {
      const to = Boolean(next.programs?.[item.code]?.on);
      const note = noteValue(next.programs?.[item.code]?.note);
      if (item.current !== to) {
        changes.push({ kind: "program", code: item.code, from: item.current, to, ...(to && note !== null ? { note } : {}) });
      } else if (to && note !== noteValue(item.note)) {
        changes.push({ kind: "program", code: item.code, from: true, to: true, note, from_note: noteValue(item.note) });
      }
    }
    return changes;
  }
  // ข้อผิดพลาดก่อนส่ง (ไม่มีรายการเปลี่ยน / เกินจำนวน / เหตุผล / โปรแกรม "อื่นๆ" ไม่มีหมายเหตุ / หมายเหตุยาวเกิน)
  function validateGrants(model, next, reason) {
    const errors = [];
    const changes = buildGrantChanges(model, next);
    if (!changes.length) errors.push({ field: "reason", message: "ยังไม่ได้เปลี่ยนสิทธิ์ใด ๆ" });
    if (changes.length > MAX_CHANGES) errors.push({ field: "reason", message: `เปลี่ยนสิทธิ์ได้ครั้งละไม่เกิน ${MAX_CHANGES} รายการ` });
    for (const item of model.programs) {
      const on = Boolean(next.programs?.[item.code]?.on);
      const note = textOf(next.programs?.[item.code]?.note);
      if (on && charCount(note) > 500) errors.push({ field: `note:${item.code}`, message: `หมายเหตุของ ${item.name} ยาวเกิน 500 ตัวอักษร` });
      if (on && item.code === OTHER_PROGRAM && !note && !(item.current && !textOf(item.note))) errors.push({ field: `note:${item.code}`, message: `ต้องระบุหมายเหตุว่า "${item.name}" คือโปรแกรมอะไร` });
    }
    const problem = reasonProblem(reason);
    if (problem) errors.push({ field: "reason", message: problem });
    return errors;
  }
  const grantParams = (model, next, reason) => ({ p_user_id: model.userId, p_changes: buildGrantChanges(model, next), p_reason: textOf(reason) });

  /* ---------- อีเมล ---------- */
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function validateEmail({ address, kind }) {
    const errors = [];
    const text = textOf(address);
    if (!text || !EMAIL_PATTERN.test(text) || charCount(text) > 200) errors.push({ field: "address", message: "รูปแบบอีเมลไม่ถูกต้อง" });
    if (!EMAIL_KINDS.some((item) => item.value === kind)) errors.push({ field: "kind", message: "กรุณาเลือกชนิดอีเมล" });
    return errors;
  }

  /* ---------- รายการกลาง (โฟลเดอร์/โปรแกรม) ---------- */
  const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,29}$/;
  const normalizeCode = (text) => textOf(text).toUpperCase();
  function emptyCatalogValues(kind) {
    return kind === "folder" ? { code: "", name: "", description: "", sort: "100", is_active: true } : { code: "", name: "", sort: "100", is_active: true };
  }
  function catalogValuesFromItem(kind, item) {
    const values = { code: item.code, name: item.name ?? "", sort: String(item.sort ?? 100), is_active: item.is_active !== false };
    return kind === "folder" ? { ...values, description: item.description ?? "" } : values;
  }
  // mode = add | edit · existingCodes = รหัสที่มีอยู่แล้ว (เพิ่มรหัสซ้ำจะกลายเป็นการแก้ของเดิมเงียบ ๆ จึงกันก่อน)
  function validateCatalog(kind, mode, values, existingCodes = []) {
    const errors = [];
    const noun = kind === "folder" ? "โฟลเดอร์" : "โปรแกรม";
    const code = normalizeCode(values.code);
    if (!CODE_PATTERN.test(code)) errors.push({ field: "code", message: `รหัส${noun}ต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_/- ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ยาวไม่เกิน 30 ตัว` });
    else if (mode === "add" && existingCodes.map(normalizeCode).includes(code)) errors.push({ field: "code", message: `มีรหัส${noun}นี้อยู่แล้ว (แก้ได้จากรายการ)` });
    if (!textOf(values.name)) errors.push({ field: "name", message: `กรุณาระบุชื่อ${noun}` });
    else if (charCount(values.name) > 200) errors.push({ field: "name", message: `ชื่อ${noun}ยาวเกิน 200 ตัวอักษร` });
    if (kind === "folder" && charCount(values.description) > 1000) errors.push({ field: "description", message: "คำอธิบายยาวเกิน 1,000 ตัวอักษร" });
    const sort = textOf(values.sort);
    if (!/^\d{1,4}$/.test(sort)) errors.push({ field: "sort", message: "ลำดับต้องเป็นจำนวนเต็ม 0–9999" });
    return errors;
  }
  const catalogChanged = (kind, original, values) => {
    if (!original) return true;
    const base = catalogValuesFromItem(kind, original);
    return textOf(values.name) !== textOf(base.name) || (kind === "folder" && textOf(values.description) !== textOf(base.description))
      || Number(textOf(values.sort)) !== Number(base.sort) || Boolean(values.is_active) !== Boolean(base.is_active);
  };
  function folderParams(values, reason) {
    return { p_code: normalizeCode(values.code), p_name: textOf(values.name), p_description: textOf(values.description) || null, p_sort: Number(textOf(values.sort)), p_is_active: Boolean(values.is_active), p_reason: textOf(reason) || null };
  }
  function programParams(values, reason) {
    return { p_code: normalizeCode(values.code), p_name: textOf(values.name), p_sort: Number(textOf(values.sort)), p_is_active: Boolean(values.is_active), p_reason: textOf(reason) || null };
  }

  /* ---------- ประวัติ (itua_log) ---------- */
  const LOG_USER_FIELDS = Object.freeze([
    ["auth_id", "Auth. Name"], ["name_th", "ชื่อ (ไทย)"], ["name_en", "ชื่อ (อังกฤษ)"], ["department_code", "แผนก"], ["division", "ฝ่าย"],
    ["internet", "อินเทอร์เน็ต"], ["status", "สถานะ"], ["granted_doc_no", "เลขใบที่ให้สิทธิ์"], ["granted_on", "วันที่ให้สิทธิ์"], ["note", "หมายเหตุ"], ["employee_id", "พนักงานที่ผูก"],
  ]);
  function logValue(key, value) {
    if (value === null || value === undefined || value === "") return "—";
    if (key === "division") return divisionLabel(value);
    if (key === "status") return statusLabel(value);
    if (key === "internet") return value ? "มี" : "ไม่มี";
    if (key === "granted_on") return formatDate(value);
    return String(value);
  }
  const ACTION_LABELS = Object.freeze({ created: "เพิ่ม", updated: "แก้ไข", deleted: "ถอน" });
  // names = { folders: { รหัส: ชื่อ }, programs: { รหัส: ชื่อ } } ใช้แปลงรหัสในประวัติเป็นชื่อที่อ่านง่าย (ไม่พบ = ใช้รหัส)
  function logLines(entry, names = {}) {
    const oldV = entry?.old_values ?? {};
    const newV = entry?.new_values ?? {};
    const code = textOf(entry?.entity_code);
    switch (entry?.entity) {
      case "user":
        if (entry.action === "created") return ["เพิ่มผู้ใช้เข้าทะเบียน"];
        return LOG_USER_FIELDS.filter(([key]) => (oldV[key] ?? null) !== (newV[key] ?? null))
          .map(([key, label]) => (key === "employee_id" ? `${label}: เปลี่ยนแปลง` : `${label}: ${logValue(key, oldV[key])} → ${logValue(key, newV[key])}`));
      case "folder_grant": {
        const name = names.folders?.[code] || code || "โฟลเดอร์";
        if (entry.action === "created") return [`เพิ่มสิทธิ์โฟลเดอร์ ${name} ระดับ ${newV.level}`];
        if (entry.action === "deleted") return [`ถอนสิทธิ์โฟลเดอร์ ${name} (เดิม ${oldV.level})`];
        return [`โฟลเดอร์ ${name}: ${oldV.level} → ${newV.level}`];
      }
      case "program_grant": {
        const name = names.programs?.[code] || code || "โปรแกรม";
        const noteOf = (values) => (textOf(values.note) ? ` (${textOf(values.note)})` : "");
        if (entry.action === "created") return [`เพิ่มสิทธิ์โปรแกรม ${name}${noteOf(newV)}`];
        if (entry.action === "deleted") return [`ถอนสิทธิ์โปรแกรม ${name}${noteOf(oldV)}`];
        return [`โปรแกรม ${name}: หมายเหตุ ${logValue("note", oldV.note)} → ${logValue("note", newV.note)}`];
      }
      case "email": {
        if (entry.action === "created") return [`เพิ่ม${emailKindLabel(newV.kind)} ${code}`];
        if (oldV.status !== newV.status) return [`อีเมล ${code}: ${oldV.status === "active" ? "ปิดการใช้งาน" : "เปิดการใช้งาน"}`];
        return [`แก้ไขอีเมล ${code}`];
      }
      default:
        return [`${ACTION_LABELS[entry?.action] ?? ""}รายการ ${code}`.trim()];
    }
  }
  function logView(data, names = {}) {
    return (Array.isArray(data?.log) ? data.log : []).map((entry) => ({
      id: entry.id,
      lines: logLines(entry, names),
      reason: textOf(entry.reason),
      by: [entry.actor_employee_no, entry.actor_full_name].map(textOf).filter(Boolean).join(" ") || "—",
      at: formatDateTime(entry.created_at),
      docNo: textOf(entry.source_doc_no),
    }));
  }

  /* ---------- พิมพ์ A4 แนวนอน + ส่งออก CSV ---------- */
  // ไม่มีช่องลับในตารางของโมดูลนี้เลย · ใบพิมพ์/CSV ใช้เฉพาะข้อมูลทะเบียนสิทธิ์ที่แสดงบนหน้าจอ
  function printFilterItems({ query = "", department = "", division = "", status = "" } = {}) {
    const items = [["แผนก", department || "ทุกแผนก"], ["ฝ่าย", division ? divisionLabel(division) : "ทุกฝ่าย"], ["สถานะ", status ? statusLabel(status) : "ทุกสถานะ"]];
    if (textOf(query)) items.push(["ค้นหา", textOf(query)]);
    return items;
  }
  const yesNo = (value) => (value ? "มี" : "—");
  function listPrint(rows) {
    const columns = [
      { key: "no", label: "ลำดับ", cls: "center" },
      { key: "auth", label: "Auth. Name", cls: "mono" },
      { key: "name", label: "ชื่อ", cls: "" },
      { key: "dept", label: "แผนก", cls: "" },
      { key: "division", label: "ฝ่าย", cls: "" },
      { key: "internet", label: "อินเทอร์เน็ต", cls: "center" },
      { key: "folders", label: "โฟลเดอร์", cls: "nowrap" },
      { key: "email", label: "อีเมลภายใน", cls: "" },
      { key: "status", label: "สถานะ", cls: "nowrap" },
    ];
    const lines = rows.map((row, index) => [String(index + 1), textOf(row.auth_id), userName(row), textOf(row.department_code), divisionLabel(row.division), yesNo(row.internet), folderSummaryText(row) || "—", textOf(row.internal_email), statusLabel(row.status)]);
    return { columns, lines };
  }
  // เมทริกซ์: คอลัมน์โฟลเดอร์ใช้ชื่อ (หัวคอลัมน์แนวตั้งตอนพิมพ์) · ช่อง = R/F หรือว่าง
  function matrixPrint({ rows, folders }) {
    const folderColumns = (Array.isArray(folders) ? folders : []).map((folder) => ({ key: `f:${folder.code}`, label: folder.name || folder.code, cls: "level", code: folder.code }));
    const columns = [{ key: "auth", label: "Auth. Name / ชื่อ", cls: "" }, { key: "dept", label: "แผนก", cls: "nowrap" }, { key: "internet", label: "เน็ต", cls: "center" }, ...folderColumns];
    const lines = rows.map((row) => [`${textOf(row.auth_id)} ${userName(row)}`.trim(), textOf(row.department_code), row.internet ? "✓" : "", ...folderColumns.map((column) => levelOf(row, column.code))]);
    return { columns, lines };
  }
  // ส่งออก CSV (UTF-8 + BOM ให้ Excel ภาษาไทยอ่านได้) · ทุกเซลล์ใส่เครื่องหมายคำพูดครอบและ escape " เป็น "" · ค่าที่ขึ้นต้นด้วย = + - @ tab CR ใส่ ' นำหน้า กัน CSV injection
  const CSV_BOM = "﻿";
  const CSV_NEWLINE = "\r\n";
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
  function tableCsv({ headers, lines }) {
    return `${CSV_BOM}${[headers, ...lines].map((line) => line.map(csvCell).join(",")).join(CSV_NEWLINE)}${CSV_NEWLINE}`;
  }
  function listCsv(rows) {
    const headers = ["Auth. Name", "ชื่อ (ไทย)", "ชื่อ (อังกฤษ)", "แผนก", "ฝ่าย", "อินเทอร์เน็ต", "โฟลเดอร์ R", "โฟลเดอร์ F", "โปรแกรม", "อีเมลภายใน", "เลขใบที่ให้สิทธิ์", "วันที่ให้สิทธิ์ (ค.ศ.)", "สถานะ"];
    const lines = rows.map((row) => [row.auth_id, row.name_th, row.name_en, row.department_code, divisionLabel(row.division), row.internet ? "มี" : "ไม่มี", row.folder_r ?? 0, row.folder_f ?? 0, row.program_count ?? 0, row.internal_email, row.granted_doc_no, row.granted_on, statusLabel(row.status)]);
    return tableCsv({ headers, lines });
  }
  function matrixCsv({ rows, folders }) {
    const folderList = Array.isArray(folders) ? folders : [];
    const headers = ["Auth. Name", "ชื่อ (ไทย)", "ชื่อ (อังกฤษ)", "แผนก", "ฝ่าย", "สถานะ", "อินเทอร์เน็ต", ...folderList.map((folder) => folder.name || folder.code)];
    const lines = rows.map((row) => [row.auth_id, row.name_th, row.name_en, row.department_code, divisionLabel(row.division), statusLabel(row.status), row.internet ? "มี" : "ไม่มี", ...folderList.map((folder) => levelOf(row, folder.code))]);
    return tableCsv({ headers, lines });
  }
  // itua-<list|matrix>-<real|test>-YYYYMMDD.csv (วันที่ตามเวลาไทย ค.ศ.)
  function csvFileName({ kind = "list", isTest = false, now = new Date() } = {}) {
    const { year, month, day } = bangkokParts(now);
    return `itua-${kind}-${isTest ? "test" : "real"}-${year}${month}${day}.csv`;
  }

  /* ---------- error จาก RPC ---------- */
  // kind: "session" · "unknown" ไม่ได้คำตอบ (ผลไม่แน่ชัด) · "missing" ฐานข้อมูลยังไม่มีฟังก์ชัน · "conflict" แก้ชนกัน (40001) · "access" ไม่มีสิทธิ์ (42501) · "rejected" เซิร์ฟเวอร์ปฏิเสธ
  const THAI = /[฀-๿]/;
  const NETWORK = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|internet connection appears to be offline|failed to send a request|err_internet|err_network|econnreset|the request timed out/i;
  const SESSION_CODES = ["PGRST301", "PGRST303", "AUTH_REQUIRED"];
  const SESSION_MESSAGE = "หมดเวลาการเข้าสู่ระบบ กรุณาโหลดหน้านี้ใหม่แล้วเข้าสู่ระบบอีกครั้ง (สิ่งที่กรอกไว้ยังอยู่ในหน้า)";
  const UNKNOWN_WRITE_MESSAGE = "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ (ระบบอาจบันทึกไปแล้ว)";
  const UNKNOWN_READ_MESSAGE = "โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
  const MISSING_MESSAGE = "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับทะเบียนสิทธิ์ผู้ใช้ กรุณาแจ้งผู้ดูแลระบบ";
  const GENERIC_MESSAGE = "ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ";
  const CONFLICT_MESSAGE = "ข้อมูลหรือสิทธิ์ถูกแก้ไขจากที่อื่นไปแล้ว กรุณากดโหลดข้อมูลล่าสุดแล้วทำรายการใหม่";
  function describeError(error, { write = false } = {}) {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "");
    if (code === "40001") return { kind: "conflict", message: CONFLICT_MESSAGE };
    if (error?.status === 401 || SESSION_CODES.includes(code) || /JWT expired|AUTH_REQUIRED/i.test(message)) return { kind: "session", message: SESSION_MESSAGE };
    if (code === "PGRST202" || code === "42883") return { kind: "missing", message: MISSING_MESSAGE };
    if (code === "42501" && THAI.test(message)) return { kind: "access", message, forwarded: true };
    if (!code && THAI.test(message) && !NETWORK.test(message)) return { kind: "rejected", message, forwarded: true };
    if (!code || NETWORK.test(message)) return { kind: "unknown", message: write ? UNKNOWN_WRITE_MESSAGE : UNKNOWN_READ_MESSAGE };
    if (code === "23514" && THAI.test(message)) return { kind: "rejected", message, forwarded: true };
    return { kind: "rejected", message: GENERIC_MESSAGE };
  }
  function purgeSummary({ deleted = 0 } = {}) {
    return { message: `ล้างข้อมูลทะเบียนสิทธิ์ผู้ใช้ทดสอบแล้ว ${deleted} รายการ`, complete: true };
  }

  const api = {
    MODULE_VERSION, VERSION_DATE, IN_DEVELOPMENT, ACCESS_CODE, YEAR_OFFSET, MIN_DATE, MAX_DATE, MAX_LISTED, MAX_CHANGES, DATE_INPUT_HINT, OTHER_PROGRAM,
    TABS, DIVISIONS, USER_STATUSES, LEVELS, EMAIL_KINDS, USER_FIELDS,
    isUuid, listUrl, matrixUrl, catalogUrl, userUrl, readRoute,
    divisionLabel, statusLabel, statusTone, emailKindLabel,
    formatDate, formatDateTime, parseDateInput, dateInputText, isRealDate, dateTimeText,
    userName, userSubName, departmentOptions, filterUsers, countText, folderSummaryText, levelCounts, levelOf,
    emptyUserValues, userValuesFromUser, normalizeUserValue, validateUser, buildUserPayload, payloadIsEmpty, isAlreadyExists, reasonProblem,
    holdingsOf, hasHoldings, holdingsText,
    grantFormModel, folderOptions, canAddProgram, canAddInternet, currentGrantState, buildGrantChanges, validateGrants, grantParams,
    validateEmail,
    normalizeCode, emptyCatalogValues, catalogValuesFromItem, validateCatalog, catalogChanged, folderParams, programParams,
    logValue, logLines, logView,
    printFilterItems, listPrint, matrixPrint, csvCell, tableCsv, listCsv, matrixCsv, csvFileName, CSV_BOM,
    describeError, purgeSummary,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITUA_MODEL = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
