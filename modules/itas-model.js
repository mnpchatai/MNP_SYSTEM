// ทะเบียนอุปกรณ์ IT (itas) — ส่วนข้อมูลล้วนของหน้าเว็บ ไม่มี DOM/Supabase/Web Crypto (เทสต์ที่ scripts/tests/itas-model.test.mjs)
// สัญญา RPC: docs/itas-contract.md · สเปกเจ้าของ: Work-Order/docs/it-asset-register-spec.md · ตู้เซฟ (เข้ารหัส) อยู่ที่ modules/itas-vault.js
// ฐานข้อมูลเป็นผู้ตัดสินทุกอย่าง (สิทธิ์ ความซ้ำของเลขทะเบียน กติกาช่อง): ไฟล์นี้ตั้งชื่อ จัดตาราง ตรวจฟอร์มให้ผู้ใช้เห็นข้อความไทยก่อนส่ง และประกอบพารามิเตอร์ของ app_itas_save_asset
// วันที่แสดงเป็น วว/ดด/ปปปป (พ.ศ. เหมือนใบสั่งงาน/ใบแจ้งซ่อม) เวลา Asia/Bangkok · วันที่ที่ส่งฐานข้อมูลเป็น ค.ศ. YYYY-MM-DD
// ห้ามมีค่าลับ/รหัส/กุญแจในไฟล์นี้: ช่องลับผ่านเข้ามาเป็น "ซองเข้ารหัสแล้ว" (envelope) เท่านั้น
(function (root) {
  "use strict";

  const YEAR_OFFSET = 543;
  // เลขเวอร์ชันของโมดูล (ป้ายบนการ์ด + มุมขวาล่างทุกหน้า) รูปแบบ <ใหญ่>.<ย่อย 2 หลัก> · กติกาเดียวกับใบสั่งงาน/ใบแจ้งซ่อม (ถามเจ้าของก่อนเปลี่ยนทุกครั้ง)
  const MODULE_VERSION = "1.00";
  const VERSION_DATE = "2026-11-24";
  // ธง "กำลังพัฒนา" (จุดเดียว): true = การ์ดมีป้าย "กำลังพัฒนา" และทุกหน้าของโมดูลมีแถบข้อความว่ายังไม่เปิดใช้งานจริง · ถอดเมื่อเจ้าของสั่ง
  const IN_DEVELOPMENT = true;
  const ASSET_CODE = "IT_ASSET_REGISTER"; // รหัสโมดูลสำหรับสิทธิ์แผนกของการ์ด
  const MIN_DATE = "1990-01-01";
  const MAX_DATE = "2100-01-01";
  const MAX_PLAIN_BYTES = 4080; // ช่องลับยาวสุด (UTF-8) ตรงกับสัญญา
  const MAX_LISTED = 2000; // list_assets ขอครั้งเดียวสูงสุดเท่านี้ (เกินให้แจ้งผู้ใช้)

  /* ---------- เส้นทาง ---------- */
  const assetsUrl = () => "#/office?module=assets";
  // โมดูลนี้ยังมีหน้าเดียว (ทะเบียน) · ค่า view อื่นที่ไม่รู้จัก = ไม่พบหน้า
  function readView(params) {
    const view = params?.get?.("view");
    return view === null || view === undefined || view === "" ? "main" : null;
  }
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));

  /* ---------- สถานะอุปกรณ์ ---------- */
  const STATUSES = Object.freeze([
    { value: "in_use", label: "ใช้งาน" },
    { value: "spare", label: "สำรอง" },
    { value: "broken", label: "ชำรุด" },
    { value: "retired", label: "ยกเลิกใช้งาน" },
  ]);
  const statusLabel = (status) => STATUSES.find((item) => item.value === status)?.label ?? status ?? "";
  // ป้ายสถานะใช้ class .badge ของระบบ (styles.css) ที่มีสีให้แล้ว
  const STATUS_BADGE_CLASS = Object.freeze({ in_use: "approved", spare: "in_progress", broken: "rejected", retired: "cancelled" });
  const statusBadgeClass = (status) => STATUS_BADGE_CLASS[status] ?? "";

  /* ---------- วันที่ / เวลา ---------- */
  const pad = (value) => String(value).padStart(2, "0");
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
  // (ตรรกะเดียวกับ parseDateInput ใน itrp-model.js คัดมาไว้ที่นี่ ไม่ import ข้ามโมดูล) · คืน YYYY-MM-DD (ค.ศ.) เมื่อเป็นวันที่จริง ไม่งั้น null
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

  /* ---------- ช่องกลางของอุปกรณ์ ---------- */
  // type: text | longtext | number | date | status · max = ความยาวสูงสุดตามสัญญา · code = ฐานข้อมูลตัดช่องว่างหัวท้ายและแปลงเป็นตัวพิมพ์ใหญ่ให้
  // group: identity (ระบุตัว) · place (ที่ตั้ง/การใช้งาน) · purchase (จัดซื้อ/ประกัน/บัญชี) · note
  const CORE_FIELDS = Object.freeze([
    { key: "reg_no", label: "เลขทะเบียน", type: "text", max: 50, code: true, group: "identity" },
    { key: "device_code", label: "รหัสอุปกรณ์", type: "text", max: 50, code: true, group: "identity", needsDeviceCode: true },
    { key: "name", label: "ชื่อ", type: "text", max: 200, group: "identity" },
    { key: "model", label: "ยี่ห้อ / รุ่น", type: "text", max: 200, group: "identity" },
    { key: "serial", label: "Serial", type: "text", max: 200, group: "identity" },
    { key: "status", label: "สถานะ", type: "status", group: "identity" },
    { key: "host_code", label: "ติดตั้งที่ (Used by)", type: "text", max: 50, code: true, group: "place", hint: "รหัสเครื่องที่อุปกรณ์นี้ติดตั้งอยู่ เช่น COM12" },
    { key: "slot", label: "ช่อง/ตำแหน่ง", type: "text", max: 50, group: "place" },
    { key: "place", label: "สถานที่", type: "text", max: 200, group: "place" },
    { key: "install_date", label: "วันที่ติดตั้ง", type: "date", group: "place" },
    { key: "record_date", label: "วันที่บันทึก", type: "date", group: "purchase" },
    { key: "purchase_date", label: "วันที่ซื้อ", type: "date", group: "purchase" },
    { key: "vendor", label: "ผู้ขาย/ร้านค้า", type: "text", max: 200, group: "purchase" },
    { key: "price", label: "ราคา (บาท)", type: "number", group: "purchase", min: 0, decimals: 2 },
    { key: "tax_rate", label: "ภาษี (%)", type: "number", group: "purchase", min: 0, max: 100 },
    { key: "warranty_text", label: "ประกัน", type: "text", max: 200, group: "purchase" },
    { key: "warranty_end", label: "ประกันหมดวันที่", type: "date", group: "purchase" },
    { key: "express_code", label: "รหัสใน Express", type: "text", max: 100, group: "purchase" },
    { key: "account_no", label: "เลขทะเบียนทรัพย์สินทางบัญชี", type: "text", max: 100, group: "purchase" },
    { key: "note", label: "หมายเหตุ", type: "longtext", max: 2000, group: "note" },
  ]);
  const CORE_BY_KEY = Object.freeze(Object.fromEntries(CORE_FIELDS.map((field) => [field.key, field])));
  const GROUP_LABELS = Object.freeze({ identity: "ระบุตัวอุปกรณ์", place: "ที่ตั้งและการใช้งาน", purchase: "จัดซื้อ ประกัน และบัญชี", note: "หมายเหตุ" });
  const GROUP_ORDER = Object.freeze(["identity", "place", "purchase", "note"]);
  // ต้องมีอย่างน้อยหนึ่งอย่างในช่องเหล่านี้ (ตรงกับฐานข้อมูล)
  const IDENTITY_KEYS = Object.freeze(["reg_no", "device_code", "name", "model", "serial", "note"]);
  const normalizeCode = (text) => String(text ?? "").trim().toUpperCase();
  const textOf = (value) => String(value ?? "").trim();
  const charCount = (value) => Array.from(String(value ?? "")).length;

  // ช่องของชนิด (จากนิยาม fields ที่ฐานข้อมูลส่งมา) · ซ่อน (hidden) ไม่แสดง · เรียงตาม order
  const typeFields = (type) => (Array.isArray(type?.fields) ? type.fields : []).filter((field) => field && !field.hidden).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const plainFields = (type) => typeFields(type).filter((field) => !field.secret);
  const secretFields = (type) => typeFields(type).filter((field) => field.secret);
  const coreFieldsOf = (type) => CORE_FIELDS.filter((field) => !field.needsDeviceCode || type?.has_device_code);

  /* ---------- ค่าในฟอร์ม ---------- */
  // ค่าทุกช่องในฟอร์มเป็นข้อความ (ตามที่พิมพ์) · ไม่มีช่องลับที่นี่: ค่าลับจัดการแยกที่ module (ผ่านตู้เซฟ)
  const fieldText = (field, value) => {
    if (value === null || value === undefined) return "";
    if (field.type === "date") return dateInputText(value);
    return String(value);
  };
  function emptyFormValues(type) {
    const core = {};
    for (const field of coreFieldsOf(type)) core[field.key] = field.key === "status" ? "in_use" : "";
    const attrs = {};
    for (const field of plainFields(type)) attrs[field.key] = "";
    return { core, attrs };
  }
  function formValuesFromAsset(asset, type) {
    const values = emptyFormValues(type);
    for (const field of coreFieldsOf(type)) if (field.key === "status") values.core.status = asset?.status ?? "in_use"; else values.core[field.key] = fieldText(field, asset?.[field.key]);
    for (const field of plainFields(type)) values.attrs[field.key] = fieldText(field, asset?.attrs?.[field.key]);
    return values;
  }

  /* ---------- ช่องหลักของฟอร์ม (เห็นเสมอ) กับช่องที่พับไว้ใต้ "รายละเอียดเพิ่มเติม" ---------- */
  // เจ้าของกำหนด: รหัส ชื่อ ยี่ห้อ/รุ่น ผู้ใช้ (+ ชนิด และสถานะ) · "รหัส" = เลขทะเบียน + รหัสอุปกรณ์ (ถ้าชนิดนั้นมี) · "ยี่ห้อ/รุ่น" = ช่องรุ่น (ฐานข้อมูลไม่มีช่องยี่ห้อแยก)
  // "ผู้ใช้" = ช่อง user_name ของชนิด (เครื่องคอมพิวเตอร์) ถ้ามี ไม่มีก็ใช้ "ติดตั้งที่" (host_code) · ชื่อช่องแบบเดียวกับ validateAsset: คีย์ช่องกลาง หรือ "attrs.<key>"
  const userFieldName = (type) => (plainFields(type).some((field) => field.key === USER_ATTR_KEY) ? `attrs.${USER_ATTR_KEY}` : "host_code");
  function primaryFieldNames(type) {
    return ["reg_no", ...(type?.has_device_code ? ["device_code"] : []), "name", "model", userFieldName(type), "status"];
  }
  const isPrimaryField = (type, name) => primaryFieldNames(type).includes(name);
  // ป้ายชื่อของช่องหลักที่เปลี่ยนจากป้ายปกติ (เฉพาะในฟอร์ม): "ติดตั้งที่" ที่ทำหน้าที่เป็น "ผู้ใช้"
  const PRIMARY_LABEL_OVERRIDES = Object.freeze({ host_code: "ผู้ใช้ / ติดตั้งที่ (Used by)" });
  // ช่องที่ไม่ใช่ช่องหลักมีค่าอยู่หรือไม่ (ใช้ตัดสินว่าจะเปิด "รายละเอียดเพิ่มเติม" ให้เองตอนแก้/คัดลอก) · values = { core, attrs } (บางส่วนก็ได้)
  function extraFieldsHaveValues(type, values) {
    const filled = (value) => textOf(value) !== "";
    for (const field of coreFieldsOf(type)) if (!isPrimaryField(type, field.key) && filled(values?.core?.[field.key])) return true;
    for (const field of plainFields(type)) if (!isPrimaryField(type, `attrs.${field.key}`) && filled(values?.attrs?.[field.key])) return true;
    return false;
  }
  // มีข้อผิดพลาดตรวจค่าในช่องที่พับอยู่หรือไม่ (ต้องเปิดให้เห็นก่อนแสดงกรอบแดง)
  const errorsInExtraFields = (type, errors) => (Array.isArray(errors) ? errors : []).some((error) => !isPrimaryField(type, error.field));

  /* ---------- คัดลอกเป็นเครื่องใหม่ ---------- */
  // ช่องที่ต้องไม่ซ้ำกันระหว่างอุปกรณ์ (เว้นว่างไว้ให้กรอกใหม่): เลขทะเบียน รหัสอุปกรณ์ Serial เลขทะเบียนทรัพย์สินบัญชี + ช่องเฉพาะชนิดที่เป็นเลขเฉพาะตัว
  // ช่องลับไม่เคยอยู่ใน values (ฟอร์มกรอกช่องลับแยกผ่านตู้เซฟ) จึงไม่ถูกคัดลอกแน่นอน
  const COPY_SKIP_CORE = Object.freeze(["reg_no", "device_code", "serial", "account_no"]);
  const COPY_SKIP_ATTR_KEYS = Object.freeze(["doc_code"]);
  const isUniqueAttrKey = (key) => COPY_SKIP_ATTR_KEYS.includes(key) || /serial|reg_no/i.test(key);
  // คืน { values, skipped } · values = ค่าฟอร์มของอุปกรณ์ใหม่ (สถานะ ใช้งาน) · skipped = ป้ายชื่อช่องที่เว้นว่างไว้ (เฉพาะช่องที่ต้นฉบับมีค่า) ไว้บอกผู้ใช้
  function copyValuesFromAsset(asset, type) {
    const values = formValuesFromAsset(asset, type);
    const skipped = [];
    for (const field of coreFieldsOf(type)) {
      if (!COPY_SKIP_CORE.includes(field.key)) continue;
      if (textOf(values.core[field.key]) !== "") skipped.push(field.label);
      values.core[field.key] = "";
    }
    for (const field of plainFields(type)) {
      if (!isUniqueAttrKey(field.key)) continue;
      if (textOf(values.attrs[field.key]) !== "") skipped.push(field.label);
      values.attrs[field.key] = "";
    }
    values.core.status = "in_use";
    return { values, skipped };
  }

  // เปลี่ยนชนิดในฟอร์มเพิ่ม: ยกค่าที่พิมพ์ไว้ (ไม่ว่าง) ไปให้ช่องที่มีชื่อเดียวกันในชนิดใหม่ · คืน { core, attrs } เฉพาะช่องที่จะตั้ง (ไม่ยกช่องลับ ช่องลับไม่เคยอยู่ใน values)
  function carryOver(type, carried) {
    const core = {};
    const attrs = {};
    const coreKeys = new Set(coreFieldsOf(type).map((field) => field.key));
    for (const [key, value] of Object.entries(carried?.core ?? {})) if (coreKeys.has(key) && textOf(value) !== "") core[key] = value;
    const attrKeys = new Set(plainFields(type).map((field) => field.key));
    for (const [key, value] of Object.entries(carried?.attrs ?? {})) if (attrKeys.has(key) && textOf(value) !== "") attrs[key] = value;
    return { core, attrs };
  }

  /* ---------- ตรวจค่าก่อนส่ง (ฐานข้อมูลตรวจซ้ำเสมอ) ---------- */
  // คืนค่าที่ส่งฐานข้อมูลของช่องหนึ่ง: { ok, value } (value = null เมื่อว่าง) หรือ { ok:false, message }
  function parseField(field, rawText) {
    const text = field.type === "longtext" ? String(rawText ?? "").replace(/\r\n/g, "\n").trim() : textOf(rawText);
    if (!text) return { ok: true, value: null };
    if (field.type === "date") {
      const iso = parseDateInput(text);
      if (!iso || !dateInRange(iso)) return { ok: false, message: `${field.label}: วันที่ไม่ถูกต้อง (${DATE_INPUT_HINT})` };
      return { ok: true, value: iso };
    }
    if (field.type === "number") {
      const number = Number(text.replaceAll(",", ""));
      if (!Number.isFinite(number)) return { ok: false, message: `${field.label}: ต้องเป็นตัวเลข` };
      if (field.min !== undefined && number < field.min) return { ok: false, message: `${field.label}: ต้องไม่ต่ำกว่า ${field.min}` };
      if (field.max !== undefined && number > field.max) return { ok: false, message: `${field.label}: ต้องไม่เกิน ${field.max}` };
      if (field.decimals !== undefined && Math.round(number * 10 ** field.decimals) / 10 ** field.decimals !== number) return { ok: false, message: `${field.label}: ทศนิยมไม่เกิน ${field.decimals} ตำแหน่ง` };
      return { ok: true, value: number };
    }
    if (field.type === "choice") {
      if (!Array.isArray(field.choices) || !field.choices.includes(text)) return { ok: false, message: `${field.label}: เลือกจากตัวเลือกที่มีเท่านั้น` };
      return { ok: true, value: text };
    }
    if (field.code ? charCount(normalizeCode(text)) > field.max : field.max && charCount(text) > field.max) return { ok: false, message: `${field.label}: ยาวเกิน ${field.max} ตัวอักษร` };
    return { ok: true, value: field.code ? normalizeCode(text) : text };
  }
  // ช่องของนิยามชนิดที่ฐานข้อมูลส่งมา (text มี max ค่าเริ่มต้น 200) → รูปเดียวกับช่องกลางเพื่อใช้ parseField
  const attrField = (field) => ({ ...field, max: field.type === "text" ? (field.max ?? 200) : field.max });

  // values = { core, attrs } (ข้อความจากฟอร์ม) · คืนรายการ [{ field, message }] (ว่าง = ผ่าน) · field = คีย์ช่องกลาง หรือ "attrs.<key>"
  function validateAsset({ type, values }) {
    const errors = [];
    const parsed = {};
    for (const field of coreFieldsOf(type)) {
      if (field.type === "status") {
        if (!STATUSES.some((item) => item.value === values.core.status)) errors.push({ field: "status", message: "กรุณาเลือกสถานะ" });
        continue;
      }
      const result = parseField(field, values.core[field.key]);
      if (!result.ok) errors.push({ field: field.key, message: result.message }); else parsed[field.key] = result.value;
    }
    for (const field of plainFields(type)) {
      const result = parseField(attrField(field), values.attrs[field.key]);
      if (!result.ok) errors.push({ field: `attrs.${field.key}`, message: result.message });
    }
    if (!errors.length && !IDENTITY_KEYS.some((key) => parsed[key] !== null && parsed[key] !== undefined)) {
      errors.push({ field: "reg_no", message: "กรุณากรอกอย่างน้อยหนึ่งอย่างใน เลขทะเบียน / รหัสอุปกรณ์ / ชื่อ / รุ่น / Serial / หมายเหตุ" });
    }
    if (parsed.host_code && parsed.device_code && parsed.host_code === parsed.device_code) errors.push({ field: "host_code", message: "ติดตั้งที่ ต้องไม่เป็นรหัสอุปกรณ์ของตัวเอง" });
    return errors;
  }

  /* ---------- ประกอบพารามิเตอร์ของ app_itas_save_asset ---------- */
  const sameValue = (left, right) => {
    if ((left === null || left === undefined) && (right === null || right === undefined)) return true;
    if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right);
    return left === right;
  };
  // ค่าของช่องจากแถวที่โหลดมา (รูปเดียวกับที่ parseField คืน)
  const storedCore = (asset, field) => {
    const value = asset?.[field.key];
    return value === undefined || value === "" ? null : value;
  };
  // อุปกรณ์เดิมของแถวที่แก้ = original (ข้อมูลจากเซิร์ฟเวอร์ มี updated_at) · สร้างใหม่ = original เป็น null
  // secretEnvelopes = { <key ช่องลับ>: ซองเข้ารหัส | null (= ลบค่า) } เฉพาะช่องที่ผู้ใช้แก้จริงเท่านั้น (ตู้เซฟล็อก = ไม่ส่งช่องลับเลย)
  // updated_at ส่งกลับเป็นสตริงเดิมทุกตัวอักษร ห้ามผ่าน Date (ไมโครวินาทีหายแล้วแก้ชนกันไม่ได้เลย)
  function buildSavePayload({ type, original = null, values, secretEnvelopes = {}, assetId = null }) {
    const creating = !original;
    const data = {};
    for (const field of coreFieldsOf(type)) {
      if (field.type === "status") {
        if (creating || values.core.status !== original.status) data.status = values.core.status;
        continue;
      }
      const next = parseField(field, values.core[field.key]).value ?? null;
      if (creating) { if (next !== null) data[field.key] = next; } else if (!sameValue(next, storedCore(original, field))) data[field.key] = next;
    }
    const attrs = {};
    for (const raw of plainFields(type)) {
      const field = attrField(raw);
      const next = parseField(field, values.attrs[field.key]).value ?? null;
      const before = original?.attrs?.[field.key] ?? null;
      if (creating) { if (next !== null) attrs[field.key] = next; } else if (!sameValue(next, before)) attrs[field.key] = next;
    }
    const secrets = {};
    const allowed = new Set(secretFields(type).map((field) => field.key));
    for (const [key, envelope] of Object.entries(secretEnvelopes)) {
      if (!allowed.has(key)) continue;
      if (envelope === null && creating) continue; // สร้างใหม่ไม่มีอะไรให้ลบ
      secrets[key] = envelope;
    }
    return {
      p_id: assetId ?? original?.id ?? null,
      ...(creating ? { p_type_code: type.code } : {}),
      p_data: data,
      p_attrs: attrs,
      p_secrets: secrets,
      p_expected_updated_at: creating ? null : original.updated_at,
    };
  }
  const payloadIsEmpty = (payload) => !Object.keys(payload.p_data).length && !Object.keys(payload.p_attrs).length && !Object.keys(payload.p_secrets).length;

  /* ---------- ตารางรายการ ---------- */
  const NUMBER_FORMAT = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
  const formatCell = (field, value) => {
    if (value === null || value === undefined || value === "") return "";
    if (field.type === "date") return formatDate(value);
    if (field.type === "number") return NUMBER_FORMAT.format(Number(value));
    if (field.type === "status") return statusLabel(value);
    return String(value);
  };
  const MAX_TYPE_COLUMNS = 3; // ช่องเฉพาะชนิดที่แสดงในตาราง (ที่เหลือดูในฟอร์ม)
  // คอลัมน์ของตารางชนิดนั้น: ช่องหลัก + ช่องเฉพาะชนิดที่ไม่ลับ 3 ช่องแรก · key ใช้เรียง/เซลล์
  function tableColumns(type) {
    const columns = [{ key: "reg_no", label: "เลขทะเบียน", field: CORE_BY_KEY.reg_no, role: "no" }];
    if (type?.has_device_code) columns.push({ key: "device_code", label: "รหัสอุปกรณ์", field: CORE_BY_KEY.device_code });
    columns.push(
      { key: "name", label: "ชื่อ / รุ่น", field: CORE_BY_KEY.name, role: "subject", composite: true },
      { key: "serial", label: "Serial", field: CORE_BY_KEY.serial },
      { key: "status", label: "สถานะ", field: CORE_BY_KEY.status, role: "status" },
      { key: "host_code", label: "ติดตั้งที่", field: CORE_BY_KEY.host_code },
      { key: "install_date", label: "วันที่ติดตั้ง", field: CORE_BY_KEY.install_date },
    );
    for (const field of plainFields(type).slice(0, MAX_TYPE_COLUMNS)) columns.push({ key: `attrs.${field.key}`, label: field.label, field: attrField(field) });
    return columns;
  }
  // ช่อง "ผู้ใช้" ที่แสดงในตาราง/ฟอร์มหลัก: ชนิดที่มีช่อง user_name (เครื่องคอมพิวเตอร์) ใช้ช่องนั้น · ชนิดอื่นใช้ "ติดตั้งที่" (host_code = รหัสเครื่องที่ใช้อุปกรณ์นี้)
  const USER_ATTR_KEY = "user_name";
  const userValueOf = (row) => textOf(row?.attrs?.[USER_ATTR_KEY]) || textOf(row?.host_code);

  // ชิปกรองชนิด: ชนิดที่มีของอยู่ขึ้นก่อน (คงลำดับ sort ของฐานข้อมูล) ชนิดว่างแยกไว้ใต้ "ชนิดอื่นๆ"
  function typeChipGroups(types) {
    const list = (Array.isArray(types) ? types : []).filter(Boolean);
    const hasAssets = (type) => Number(type.asset_count) > 0;
    return { used: list.filter(hasAssets), empty: list.filter((type) => !hasAssets(type)) };
  }
  const TYPE_ALL_LABEL = "ทั้งหมด";

  // ตารางมุมมอง "ทั้งหมด" (รวมทุกชนิด): คอลัมน์กลางที่ทุกชนิดมีเหมือนกัน · valueFn = ค่าที่แสดง · sortFn = ค่าที่ใช้เรียง (ชนิดเรียงตามลำดับของฐานข้อมูล ไม่ใช่ตัวอักษร)
  function allColumns(types) {
    const list = Array.isArray(types) ? types : [];
    const names = new Map(list.map((type) => [type.code, type.name]));
    const order = new Map(list.map((type, index) => [type.code, index]));
    const text = { type: "text" };
    return [
      { key: "reg_no", label: "เลขทะเบียน", field: CORE_BY_KEY.reg_no, role: "no" },
      { key: "device_code", label: "รหัสอุปกรณ์", field: CORE_BY_KEY.device_code },
      { key: "type", label: "ชนิด", field: text, valueFn: (row) => names.get(row?.type_code) ?? row?.type_code ?? "", sortFn: (row) => `${String(order.get(row?.type_code) ?? 999).padStart(3, "0")} ${names.get(row?.type_code) ?? ""}` },
      { key: "name", label: "ชื่อ / ยี่ห้อ · รุ่น", field: CORE_BY_KEY.name, role: "subject", composite: true },
      { key: "user", label: "ผู้ใช้ / ติดตั้งที่", field: text, valueFn: userValueOf },
      { key: "place", label: "สถานที่", field: CORE_BY_KEY.place },
      { key: "status", label: "สถานะ", field: CORE_BY_KEY.status, role: "status" },
    ];
  }
  const cellValue = (row, column) => {
    if (column.valueFn) return column.valueFn(row);
    if (column.key.startsWith("attrs.")) return row?.attrs?.[column.key.slice(6)];
    if (column.key === "name") return [textOf(row?.name), textOf(row?.model)].filter(Boolean).join(" · ");
    return row?.[column.key];
  };
  const cellText = (row, column) => (column.key === "name" ? cellValue(row, column) : formatCell(column.field, cellValue(row, column)));

  // ค้นหา + กรองฝั่งหน้าเว็บ (โหลดครบ ≤ 2,000 แถว): คำค้นหลายคำคั่นด้วยช่องว่าง ทุกคำต้องเจอใน ช่องกลางที่เป็นข้อความ + ช่องเฉพาะชนิดที่ไม่ลับ + ชื่อชนิด (ไม่สนตัวพิมพ์)
  // ค้นช่องลับไม่ได้จากตรงนี้ (ค่าลับเป็น ciphertext และไม่ถูกนำมารวมในข้อความค้นหา) · status = "" หรือ "all" = ทุกสถานะ · typeCode = "" = ทุกชนิด · typeNames = { รหัสชนิด: ชื่อชนิด }
  function filterAssets(rows, { query = "", status = "", typeCode = "", typeNames = null } = {}) {
    const terms = textOf(query).toLowerCase().split(/\s+/).filter(Boolean);
    const wanted = status && status !== "all" ? status : "";
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      if (wanted && row.status !== wanted) return false;
      if (typeCode && row.type_code !== typeCode) return false;
      if (!terms.length) return true;
      const haystack = [
        row.reg_no, row.device_code, row.name, row.model, row.serial, row.host_code, row.slot, row.place, row.vendor, row.note, row.express_code, row.account_no, row.warranty_text,
        typeNames?.[row.type_code],
        ...Object.values(row.attrs ?? {}).map((value) => (value === null ? "" : String(value))),
      ].map((part) => String(part ?? "").toLowerCase()).join("\n");
      return terms.every((term) => haystack.includes(term));
    });
  }
  const collator = new Intl.Collator("th", { numeric: true, sensitivity: "base" });
  // เรียงตามคอลัมน์ (ค่าว่างไปท้ายเสมอ) · ตัวเลขเรียงตามค่า วันที่ตามลำดับเวลา ที่เหลือตามตัวอักษรไทย/อังกฤษแบบ natural (COM2 ก่อน COM10)
  function sortAssets(rows, column, direction = "ascending") {
    const sign = direction === "descending" ? -1 : 1;
    const valueOf = (row) => (column.sortFn ? column.sortFn(row) : cellValue(row, column));
    const empty = (value) => value === null || value === undefined || value === "";
    return rows.slice().sort((a, b) => {
      const left = valueOf(a); const right = valueOf(b);
      if (empty(left) && empty(right)) return 0;
      if (empty(left)) return 1;
      if (empty(right)) return -1;
      if (column.field?.type === "number") return sign * (Number(left) - Number(right));
      if (column.field?.type === "date") return sign * (String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0);
      return sign * collator.compare(String(left), String(right));
    });
  }
  const countText = (shown, total, loaded = total) => {
    const base = shown === total ? `${total} รายการ` : `พบ ${shown} จาก ${total} รายการ`;
    return loaded < total ? `${base} (โหลดมาแสดง ${loaded} รายการแรก)` : base;
  };

  /* ---------- ประวัติของอุปกรณ์ ---------- */
  const ACTION_LABELS = Object.freeze({ created: "เพิ่มอุปกรณ์", updated: "แก้ไข" });
  // ชื่อช่องของแถวประวัติ (ช่องกลาง + ช่องเฉพาะชนิด) · ช่องลับแสดงเป็น "(ลับ)" เสมอ ไม่ถอดรหัสในประวัติ
  function labelOfKey(type, key) {
    if (CORE_BY_KEY[key]) return CORE_BY_KEY[key].label;
    const field = (Array.isArray(type?.fields) ? type.fields : []).find((item) => item.key === key);
    return field?.label ?? key;
  }
  const SKIP_LOG_KEYS = new Set(["id", "is_test", "type_code", "created_at", "created_by", "updated_at", "updated_by"]);
  const shownValue = (key, value) => {
    const field = CORE_BY_KEY[key];
    if (value === null || value === undefined || value === "") return "—";
    if (key === "status") return statusLabel(value);
    return field ? formatCell(field, value) : String(value);
  };
  // รายการที่เปลี่ยนจากแถวประวัติ 1 แถว (old_values/new_values = ทั้งแถว) · ช่องลับเทียบ ciphertext แต่แสดงแค่ว่า "เปลี่ยนค่า (ลับ)"
  function logChanges(entry, type) {
    const before = entry?.old_values ?? {};
    const after = entry?.new_values ?? {};
    const changes = [];
    for (const key of Object.keys(after)) {
      if (SKIP_LOG_KEYS.has(key) || key === "attrs" || key === "secrets") continue;
      if (!sameValue(before[key], after[key]) && !(before[key] === undefined && after[key] === null)) changes.push({ label: labelOfKey(type, key), from: entry.action === "created" ? "" : shownValue(key, before[key]), to: shownValue(key, after[key]), secret: false });
    }
    const attrKeys = new Set([...Object.keys(before.attrs ?? {}), ...Object.keys(after.attrs ?? {})]);
    for (const key of attrKeys) {
      const field = (type?.fields ?? []).find((item) => item.key === key);
      const old = before.attrs?.[key] ?? null; const next = after.attrs?.[key] ?? null;
      if (!sameValue(old, next)) changes.push({ label: labelOfKey(type, key), from: entry.action === "created" ? "" : formatCell(field ?? { type: "text" }, old) || "—", to: formatCell(field ?? { type: "text" }, next) || "—", secret: false });
    }
    const secretKeys = new Set([...Object.keys(before.secrets ?? {}), ...Object.keys(after.secrets ?? {})]);
    for (const key of secretKeys) {
      const old = before.secrets?.[key] ?? null; const next = after.secrets?.[key] ?? null;
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      const note = !old ? "ตั้งค่า (ลับ)" : !next ? "ลบค่า (ลับ)" : "เปลี่ยนค่า (ลับ)";
      changes.push({ label: labelOfKey(type, key), from: "", to: note, secret: true });
    }
    return changes;
  }
  function historyView(data, type) {
    const log = (Array.isArray(data?.log) ? data.log : []).map((entry) => ({
      id: entry.id, actionLabel: ACTION_LABELS[entry.action] ?? entry.action, by: [entry.actor_employee_no, entry.actor_full_name].filter(Boolean).join(" "),
      at: formatDateTime(entry.created_at), changes: logChanges(entry, type), created: entry.action === "created",
    }));
    const moves = (Array.isArray(data?.moves) ? data.moves : []).map((move) => ({
      id: move.id, by: [move.actor_employee_no, move.actor_full_name].filter(Boolean).join(" "), at: formatDateTime(move.created_at),
      parts: [
        move.from_host !== move.to_host ? `ติดตั้งที่: ${move.from_host || "—"} → ${move.to_host || "—"}` : "",
        move.from_slot !== move.to_slot ? `ช่อง/ตำแหน่ง: ${move.from_slot || "—"} → ${move.to_slot || "—"}` : "",
        move.from_status !== move.to_status ? `สถานะ: ${move.from_status ? statusLabel(move.from_status) : "—"} → ${move.to_status ? statusLabel(move.to_status) : "—"}` : "",
      ].filter(Boolean),
    }));
    return { log, moves };
  }

  /* ---------- รหัสตู้เซฟ: ตัววัดความแข็งแรงคร่าว ๆ ---------- */
  // ฐานข้อมูลกันเดารหัสไม่ได้ ความแข็งแรงของรหัสจึงสำคัญ · ตัววัดนี้แค่ช่วยผู้ใช้ (กฎที่บล็อกจริงอยู่ที่ passwordProblem ใน itas-vault.js: ยาว ≥ 14 · ตัวอักษรไม่ซ้ำ ≥ 6 · ไม่เรียง/ซ้ำชัดเจน · ไม่เท่ากับรหัสพนักงาน)
  // level: 0 สั้นเกินไป · 1 พอใช้ · 2 ดี · 3 ดีมาก (วลีหลายคำยาว ๆ)
  const MIN_PASSWORD_LENGTH = 14;
  function passwordStrength(text) {
    const value = String(text ?? "");
    const length = charCount(value);
    if (length < MIN_PASSWORD_LENGTH) return { level: 0, label: length ? `สั้นเกินไป (อีก ${MIN_PASSWORD_LENGTH - length} ตัวอักษร)` : "", ok: false };
    const words = value.trim().split(/\s+/).filter((word) => word.length >= 2).length;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^\p{L}\p{N}]/u, /[ก-๙]/].filter((pattern) => pattern.test(value)).length;
    const distinct = new Set(Array.from(value.toLowerCase())).size;
    if (distinct < 6) return { level: 0, label: "ตัวอักษรซ้ำกันมากเกินไป (ต้องมีตัวอักษรไม่ซ้ำอย่างน้อย 6 แบบ)", ok: false };
    if (words >= 4 && length >= 20) return { level: 3, label: "ดีมาก", ok: true };
    if (words >= 3 || length >= 18 || classes >= 3) return { level: 2, label: "ดี", ok: true };
    return { level: 1, label: "พอใช้ แนะนำให้ใช้วลียาว ๆ หลายคำ", ok: true };
  }
  const PASSWORD_ADVICE = "แนะนำให้ใช้วลีหลายคำที่จำง่ายแต่เดายาก (เช่น 4 คำขึ้นไป) ห้ามใช้รหัสเดียวกับรหัสเข้าสู่ระบบ · ลืมรหัสตู้เซฟและรหัสกู้คืนทั้งสองอย่าง = กู้ข้อมูลลับไม่ได้";

  /* ---------- error จาก RPC ---------- */
  // kind: "session" · "unknown" ไม่ได้คำตอบ (ผลไม่แน่ชัด) · "missing" ฐานข้อมูลยังไม่มีฟังก์ชัน · "conflict" แก้ชนกัน (40001) · "access" ไม่มีสิทธิ์ (42501) · "rejected" เซิร์ฟเวอร์ปฏิเสธ
  const THAI = /[฀-๿]/;
  const NETWORK = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|internet connection appears to be offline|failed to send a request|err_internet|err_network|econnreset|the request timed out/i;
  const SESSION_CODES = ["PGRST301", "PGRST303", "AUTH_REQUIRED"];
  const SESSION_MESSAGE = "หมดเวลาการเข้าสู่ระบบ กรุณาโหลดหน้านี้ใหม่แล้วเข้าสู่ระบบอีกครั้ง (สิ่งที่กรอกไว้ยังอยู่ในหน้า)";
  const UNKNOWN_WRITE_MESSAGE = "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ (ระบบอาจบันทึกไปแล้ว)";
  const UNKNOWN_READ_MESSAGE = "โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
  const MISSING_MESSAGE = "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับทะเบียนอุปกรณ์ กรุณาแจ้งผู้ดูแลระบบ";
  const GENERIC_MESSAGE = "ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ";
  const CONFLICT_MESSAGE = "มีการแก้ไขจากที่อื่นไปแล้ว กรุณาโหลดข้อมูลล่าสุด (สิ่งที่คุณพิมพ์ไว้ยังอยู่ในฟอร์ม ตรวจแล้วบันทึกอีกครั้ง)";
  // ข้อความจากตู้เซฟ (VaultError) เป็นข้อความคงที่ภาษาไทยอยู่แล้ว ส่งต่อตรง ๆ (ไม่ผ่านตัวตรวจ code ของ PostgREST)
  function describeError(error, { write = false } = {}) {
    if (error?.name === "VaultError") return { kind: "vault", message: String(error.message), reason: error.reason };
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
  // บันทึกซ้ำด้วย id เดิมหลังเน็ตหลุด: ครั้งแรกสำเร็จไปแล้ว → "อุปกรณ์นี้มีอยู่แล้ว…" ให้หน้าเว็บโหลดแถวมาต่อด้วยการแก้ (สัญญาข้อ retry)
  const isAlreadyExists = (error) => String(error?.code ?? "") === "23514" && /มีอยู่แล้ว/.test(String(error?.message ?? ""));

  function purgeSummary({ deleted = 0 } = {}) {
    return { message: `ล้างข้อมูลทะเบียนอุปกรณ์ทดสอบแล้ว ${deleted} รายการ`, complete: true };
  }

  const api = {
    MODULE_VERSION, VERSION_DATE, IN_DEVELOPMENT, ASSET_CODE, YEAR_OFFSET, MIN_DATE, MAX_DATE, MAX_PLAIN_BYTES, MAX_LISTED, MIN_PASSWORD_LENGTH, DATE_INPUT_HINT, PASSWORD_ADVICE,
    STATUSES, CORE_FIELDS, GROUP_LABELS, GROUP_ORDER, IDENTITY_KEYS,
    assetsUrl, readView, isUuid, statusLabel, statusBadgeClass,
    formatDate, formatDateTime, parseDateInput, dateInputText, isRealDate,
    typeFields, plainFields, secretFields, coreFieldsOf, normalizeCode, emptyFormValues, formValuesFromAsset, carryOver, copyValuesFromAsset, userFieldName, primaryFieldNames, isPrimaryField, PRIMARY_LABEL_OVERRIDES, extraFieldsHaveValues, errorsInExtraFields, parseField, validateAsset, buildSavePayload, payloadIsEmpty,
    tableColumns, allColumns, typeChipGroups, TYPE_ALL_LABEL, USER_ATTR_KEY, userValueOf, cellValue, cellText, formatCell, filterAssets, sortAssets, countText,
    labelOfKey, logChanges, historyView, passwordStrength,
    describeError, isAlreadyExists, purgeSummary,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITAS_MODEL = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
