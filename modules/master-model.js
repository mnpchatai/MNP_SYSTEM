// ป้ายและการจัดรูปข้อมูลของหน้า #/master (modules/module-master.js) แยกไว้ให้เทสต์ได้โดยไม่ต้องมีหน้าเว็บ
(function () {
  const ENTITY_LABELS = {
    requests: "คำร้อง",
    approval_steps: "ขั้นอนุมัติ",
    employees: "บัญชีพนักงาน",
    account_requests: "คำร้องบัญชี",
    account_credentials: "คลัง ID/รหัสผ่าน",
    approval_module_permissions: "สิทธิ์อนุมัติตามโมดูล",
    line_accounts: "บัญชี LINE",
    machines: "เครื่องจักร",
    company_holidays: "วันหยุดบริษัท",
    notifications: "การแจ้งเตือน",
    request_types: "ประเภทคำร้อง",
    ncr_reports: "NCR",
    ncr_responsibilities: "NCR · ผู้รับผิดชอบ",
    ncr_losses: "NCR · ความสูญเสีย",
    ncr_attachments: "NCR · ไฟล์แนบ",
    ncr_info_requests: "NCR · ขอข้อมูลเพิ่ม",
    ncr_outcomes: "NCR · ผลการแก้ไข",
    lab_mooney_results: "MNP LAB · Mooney",
    bom_master: "BOM",
    rf_master: "RubberFlow",
    qc_templates: "ใบตรวจ QC · แม่แบบ",
    sandbox_session: "โหมดทดสอบ",
    audit_logs: "บันทึกกิจกรรม",
  };

  const ACTION_LABELS = {
    INSERT: "สร้าง",
    UPDATE: "แก้ไข",
    DELETE: "ลบ",
    SANDBOX_ENTER: "เข้าโหมดทดสอบ",
    SANDBOX_EXIT: "ออกจากโหมดทดสอบ",
    REVEAL_CREDENTIAL: "เปิดดูรหัสผ่าน",
    SET_CREDENTIAL: "ตั้งรหัสผ่านให้",
    SET_PASSWORD_VIA_EMAIL_LINK: "ตั้งรหัสผ่านจากลิงก์อีเมล",
    ADMIN_CREATE_ACCOUNT_REQUEST: "ผู้ดูแลเพิ่มบัญชี",
    DELETE_EMPLOYEE: "ลบบัญชี",
    ARCHIVE_EMPLOYEE: "ปิดบัญชี (เก็บประวัติ)",
    BOM_MASTER_SAVE: "บันทึก BOM",
    RF_SAVE: "บันทึก RubberFlow",
    QC_TEMPLATE_SAVE: "บันทึกแม่แบบ QC",
    IMPORT: "นำเข้าข้อมูล",
  };

  const ERROR_KIND_LABELS = {
    js: "โค้ดหน้าเว็บพัง",
    promise: "โค้ดหน้าเว็บพัง (async)",
    rpc: "ฐานข้อมูลปฏิเสธ",
    network: "เชื่อมต่อไม่ได้",
    ui: "ข้อผิดพลาดที่แสดงให้ผู้ใช้",
  };

  const entityLabel = (code) => ENTITY_LABELS[code] ?? code ?? "—";
  const actionLabel = (code) => ACTION_LABELS[code] ?? code ?? "—";
  const errorKindLabel = (code) => ERROR_KIND_LABELS[code] ?? code ?? "—";

  function formatValue(value, max = 160) {
    if (value === null || value === undefined || value === "") return "—";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  // changes จาก app_master_activity_log:
  //   UPDATE → { field: { old, new } }   INSERT/DELETE → แถวทั้งแถว   อื่น ๆ → metadata
  // คืน [{ field, from, to }] สำหรับ UPDATE หรือ [{ field, value }] สำหรับแบบอื่น เรียงตามชื่อฟิลด์
  function changeLines(action, changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
    const fields = Object.keys(changes).sort();
    if (action === "UPDATE") {
      return fields.map((field) => {
        const pair = changes[field];
        const isPair = pair && typeof pair === "object" && !Array.isArray(pair) && ("old" in pair || "new" in pair);
        return isPair
          ? { field, from: formatValue(pair.old), to: formatValue(pair.new) }
          : { field, value: formatValue(pair) };
      });
    }
    return fields.map((field) => ({ field, value: formatValue(changes[field]) }));
  }

  // สรุปหนึ่งบรรทัด: สถานะที่เปลี่ยน (ถ้ามี) หรือจำนวนฟิลด์ที่เปลี่ยน
  function changeSummary(action, changes) {
    const lines = changeLines(action, changes);
    if (action === "UPDATE") {
      const status = lines.find((line) => line.field === "status" && "to" in line);
      if (status) return `สถานะ ${status.from} → ${status.to}`;
      if (!lines.length) return "ไม่มีฟิลด์ที่เปลี่ยน";
      return `เปลี่ยน ${lines.length} ฟิลด์: ${lines.slice(0, 3).map((line) => line.field).join(", ")}${lines.length > 3 ? " …" : ""}`;
    }
    return lines.length ? `${lines.length} ฟิลด์` : "";
  }

  // วันที่ YYYY-MM-DD ที่ใช้กรองได้ หรือ null
  const validDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null);

  // ---- งานค้างทั้งบริษัท (app_master_pending_work) -------------------------------------------
  // ตัวกรองผู้ที่ต้องทำ: "none" = งานที่ไม่มีผู้รับผิดชอบ (holders ว่าง)
  const NO_HOLDER = "none";
  const PENDING_TYPE_LABELS = { request: "คำร้อง", ncr: "NCR" };
  const holdersOf = (row) => (Array.isArray(row?.holders) ? row.holders : []);

  function filterPending(rows, { type = "", holder = "" } = {}) {
    return (rows ?? []).filter((row) => (!type || row.item_type === type)
      && (!holder || (holder === NO_HOLDER ? holdersOf(row).length === 0 : holdersOf(row).some((person) => person.id === holder))));
  }

  // ตัวเลือก "ค้างที่": คนที่มีงานค้าง เรียงจากงานมากไปน้อย (แล้วตามรหัส) + "ไม่มีผู้รับผิดชอบ" ถ้ามี
  function holderOptions(rows) {
    const byId = new Map();
    let orphans = 0;
    for (const row of rows ?? []) {
      const people = holdersOf(row);
      if (!people.length) orphans += 1;
      for (const person of people) {
        const entry = byId.get(person.id) ?? { id: person.id, employee_no: person.employee_no, name: person.name, count: 0 };
        entry.count += 1;
        byId.set(person.id, entry);
      }
    }
    const people = [...byId.values()].sort((a, b) => b.count - a.count || String(a.employee_no).localeCompare(String(b.employee_no)));
    return orphans ? [{ id: NO_HOLDER, employee_no: null, name: "ไม่มีผู้รับผิดชอบ", count: orphans }, ...people] : people;
  }

  const daysLabel = (days) => (Number(days) > 0 ? `${Number(days)} วัน` : "วันนี้");
  // เลยกำหนด: มีวันกำหนดและเลยวันนี้ (today = YYYY-MM-DD ตามเวลาไทย)
  const isOverdue = (dueDate, today) => Boolean(validDate(dueDate) && validDate(today) && dueDate < today);

  const api = {
    ENTITY_LABELS, ACTION_LABELS, ERROR_KIND_LABELS, entityLabel, actionLabel, errorKindLabel, formatValue, changeLines, changeSummary, validDate,
    NO_HOLDER, PENDING_TYPE_LABELS, filterPending, holderOptions, daysLabel, isOverdue,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_MASTER_MODEL = api;
})();
