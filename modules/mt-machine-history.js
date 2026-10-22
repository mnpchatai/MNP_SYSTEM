// ประวัติการซ่อมของเครื่องจักรในหน้ารายละเอียดใบแจ้งซ่อม: กดการ์ด "เครื่องจักร" แล้วเปิด popup รายการใบทั้งหมดที่ผูกกับเครื่องนั้น
//
// ข้อมูลมาจาก RPC app_get_machine_repair_history(p_request_id) ซึ่งตรวจสิทธิ์ที่ฐานข้อมูล (ดู migration
// 20261022010000_machine_repair_history.sql) ไฟล์นี้เป็นแค่ส่วนคำนวณ/สร้าง HTML ที่ไม่แตะ DOM และ Supabase
// เพื่อให้ Node ทดสอบได้ — ฟังก์ชัน helper ของ app.js (escapeHtml, formatDate, statusBadge) ถูกส่งเข้ามาเป็นพารามิเตอร์
// ส่วนการเปิด popup และเรียก RPC อยู่ใน modules/module-mt.js
(function registerMtMachineHistory(root) {
  // UMD: ไฟล์ Pilot นี้ถูกทดสอบตรงๆ ใน Node ด้วย ไม่ผ่าน bundler
  // ตัวเลือกพิเศษตอนแจ้งซ่อมที่ไม่ใช่เครื่องจริง (ตรงกับ machines.is_placeholder) ไม่มีประวัติให้ดู
  const PLACEHOLDER_CODES = ["สร้างใหม่", "ไม่มี"];
  // ต้องตรงกับ limit ใน app_get_machine_repair_history
  const HISTORY_LIMIT = 50;

  const text = (value) => String(value ?? "").trim();

  // กลุ่มที่เรียกได้ต้องตรงกับ app_get_machine_repair_history: บทบาทระดับบริหาร, ผู้แจ้ง, พนักงานแผนกของใบ/แผนกเจ้าของงานซ่อม
  // ใช้แค่ตัดสินว่าจะให้กดการ์ดไหม — ฐานข้อมูลตรวจซ้ำทุกครั้ง จึงถึงจะคลาดเคลื่อนก็ไม่เปิดข้อมูลเพิ่ม
  const ALLOWED_ROLE_CODES = ["admin", "general_manager", "factory_manager", "assistant_factory_manager"];

  function canViewMachineHistory(request, viewer) {
    const employee = viewer?.employee;
    if (!employee) return false;
    if (ALLOWED_ROLE_CODES.includes(employee.role?.code)) return true;
    if (request.requester_id && request.requester_id === employee.id) return true;
    return Boolean(employee.department_id) && [request.department_id, viewer.owningDepartmentId].includes(employee.department_id);
  }

  // ใบเก่าที่ไม่มี machine_id ยังเปิดดูได้ถ้ามีรหัสเครื่อง (ฐานข้อมูลจับคู่ด้วยแผนก + รหัส)
  // viewer = { employee, owningDepartmentId } ถ้าไม่ส่งมา ตรวจเฉพาะข้อมูลของใบ
  function hasMachineHistory(request, viewer) {
    if (!request) return false;
    const code = text(request.machine_code).replace(/\s+/g, "");
    if (PLACEHOLDER_CODES.includes(code)) return false;
    if (!request.machine_id && code === "") return false;
    return viewer === undefined || canViewMachineHistory(request, viewer);
  }

  function normalizeRows(data) {
    if (!Array.isArray(data)) return [];
    return data
      .map((row) => ({
        id: text(row?.request_id),
        requestNo: text(row?.request_no),
        docType: text(row?.doc_type),
        status: text(row?.status),
        createdAt: row?.created_at ?? null,
        completedAt: row?.completed_at ?? null,
        description: text(row?.description),
        cause: text(row?.cause_analysis),
        parts: text(row?.parts_used),
        technicians: text(row?.technician_names),
        canOpen: row?.can_open === true,
      }))
      .filter((row) => row.id);
  }

  // ฐานข้อมูลที่ยังไม่ได้ apply migration จะไม่มีฟังก์ชันนี้ (PGRST202) — แจ้งตรงๆ แทนข้อความ error ดิบ
  function errorMessage(error, friendlyError) {
    const message = text(error?.message ?? error);
    if (error?.code === "PGRST202" || /could not find the function/i.test(message)) {
      return "ยังไม่เปิดใช้ประวัติเครื่องจักร กรุณาลองใหม่ภายหลัง";
    }
    if (message.includes("NOT_AUTHORIZED")) return "คุณไม่มีสิทธิ์ดูประวัติของเครื่องนี้";
    return friendlyError(error);
  }

  function rowHtml(row, { escapeHtml, formatDate, statusBadge, docTypeLabels }) {
    // ลิงก์เฉพาะใบที่ผู้ดูเปิดได้ตามสิทธิ์เดิม ไม่งั้นกดแล้วเจอ "ไม่มีสิทธิ์เข้าถึง"
    const number = row.canOpen
      ? `<a class="machine-history-no" href="#/request?id=${encodeURIComponent(row.id)}">${escapeHtml(row.requestNo)}</a>`
      : `<span class="machine-history-no">${escapeHtml(row.requestNo)}</span>`;
    const docType = docTypeLabels[row.docType];
    const details = [
      ["ช่าง", row.technicians],
      ["สาเหตุ", row.cause],
      ["อะไหล่", row.parts],
      ["เสร็จเมื่อ", row.completedAt ? formatDate(row.completedAt) : ""],
    ].filter(([, value]) => value);
    return `<li class="machine-history-item">
      <div class="machine-history-head">${number}${docType ? `<span class="machine-history-type">${escapeHtml(docType)}</span>` : ""}${statusBadge(row.status)}<time class="machine-history-date" datetime="${escapeHtml(row.createdAt ?? "")}">${formatDate(row.createdAt)}</time></div>
      ${row.description ? `<p class="machine-history-text">${escapeHtml(row.description)}</p>` : ""}
      ${details.length ? `<dl class="machine-history-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
    </li>`;
  }

  function listHtml(rows, helpers) {
    if (!rows.length) return `<p class="machine-history-state" role="status">ยังไม่มีประวัติการซ่อมอื่นของเครื่องนี้</p>`;
    return `<ol class="machine-history-list">${rows.map((row) => rowHtml(row, helpers)).join("")}</ol>${
      rows.length >= HISTORY_LIMIT ? `<p class="machine-history-state">แสดง ${HISTORY_LIMIT} รายการล่าสุด</p>` : ""
    }`;
  }

  const api = { PLACEHOLDER_CODES, HISTORY_LIMIT, hasMachineHistory, canViewMachineHistory, normalizeRows, errorMessage, listHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_MT_MACHINE_HISTORY = api;
})(typeof window !== "undefined" ? window : globalThis);
