/* global supabase */

const SUPABASE_URL = "https://iqlydmkylqyowmvpsete.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uWsULpN8jWF8XCp73B8K_A_YkbKJNUD";
const PILOT_AUTH_URL = `${SUPABASE_URL}/functions/v1/pilot-auth`;
// สำรองข้อมูลใบแจ้งซ่อมไปชีต Maintenance-MT เดิม (แค่บันทึก/รายงาน — Supabase ยังเป็นฐานข้อมูลหลัก
// และเป็นตัวบังคับสิทธิ์/workflow ทั้งหมด) ดู syncRepairOrderToAppsScript ท้ายไฟล์นี้
const APPS_SCRIPT_SYNC_URL = "https://script.google.com/macros/s/AKfycbwfHj4_rNUfU9ZB4xjOpyJPxQSHucoT1baeJ0AFGaz46olWJ8UXU_pBLnKpCwG6KHprqA/exec";
// สำรองข้อมูลใบคำร้องถึงฝ่ายบริหาร (PP01-FM08) ไปชีต "ใบคำร้องถึงฝ่ายบริหาร" แยกจากชีตแจ้งซ่อม
// ด้านบน (คนละสเปรดชีต) — deploy Apps Script ตาม apps-script/management-backup/Code.gs แล้วใส่ URL
// ของ Web App ที่ได้ตรงนี้ ปล่อยว่างไว้ = ยังไม่ sync (ดู syncManagementOrderToAppsScript ท้ายไฟล์นี้)
const APPS_SCRIPT_MANAGEMENT_SYNC_URL = "https://script.google.com/macros/s/AKfycbw_FQUWk6tM8l-CvOdPu7zHxJdKj6Dcq7hBZRIiEotNRGs5sstLj7GnHMK5xixjuS5m/exec";
// ส่งอีเมลแจ้งเตือนจริงตาม employees.email — ดู triggerNotificationEmails ท้ายไฟล์นี้
const NOTIFY_EMAIL_URL = `${SUPABASE_URL}/functions/v1/notify-email`;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
const state = { session: null, employee: null, unread: 0, authMode: "login", directory: null, adminTab: "requests" };

// "ตำแหน่ง" คือ role_id โดยตรงแล้ว (ไม่มี position_level แยกต่างหากอีกต่อไป) ค่าตำแหน่ง
// ที่มีอยู่จริงตอนนี้มี 6 อย่าง: ผู้จัดการทั่วไป/ผู้จัดการโรงงาน/ผู้ช่วยผู้จัดการโรงงาน/
// ผู้จัดการแผนก/พนักงานทั่วไป/ผู้ดูแลระบบ — รายชื่อ/ป้ายกำกับดึงจากตาราง roles เสมอ ที่นี่
// เก็บแค่ code ที่ใช้เทียบสิทธิ์ฝั่ง UI (สิทธิ์จริงบังคับที่ฐานข้อมูลอยู่แล้วผ่าน RLS/RPC)
const VIEW_ALL_ROLE_CODES = ["factory_manager", "general_manager"]; // มี requests.view_all เหมือน admin
const OPERATE_ROLE_CODES = ["assistant_factory_manager", "factory_manager", "general_manager"]; // มี requests.operate
const accountRequestKindLabels = {
  new_account: "ขอเปิดบัญชี",
  credential_change: "ขอแก้ไข ID/รหัสผ่าน",
};
const accountRequestStatusLabels = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
};

const statusLabels = {
  draft: "ฉบับร่าง",
  pending_approval: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  in_progress: "กำลังดำเนินการ",
  more_info: "ขอข้อมูลเพิ่ม",
  completed: "เสร็จแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
  pending_assign: "รอมอบหมายช่าง",
  assigned: "รอดำเนินการ",
  pending_verify: "รอผู้แจ้งตรวจสอบ",
  acknowledged: "รับทราบข้อมูล",
};
const priorityLabels = { low: "ต่ำ", normal: "ปกติ", high: "สูง", urgent: "เร่งด่วน" };

// ลำดับขั้นของงานสำหรับแถบ "ไปถึงไหนแล้ว" — ใบแจ้งซ่อมเดินตาม workflow ของ MT ส่วนคำร้องทั่วไป
// ใช้ลำดับสั้นกว่าเพราะไม่มีขั้นมอบหมายช่าง/ตรวจรับ (ดู statusLabels ด้านบนสำหรับป้ายเต็ม)
const REPAIR_STAGES = [
  { status: "pending_approval", label: "รออนุมัติ" },
  { status: "pending_assign", label: "รอมอบหมายช่าง" },
  { status: "assigned", label: "รอช่างเริ่มงาน" },
  { status: "in_progress", label: "กำลังซ่อม" },
  { status: "pending_verify", label: "รอตรวจรับ" },
  { status: "completed", label: "เสร็จแล้ว" },
];
const GENERAL_STAGES = [
  { status: "pending_approval", label: "รออนุมัติ" },
  { status: "approved", label: "อนุมัติแล้ว" },
  { status: "in_progress", label: "กำลังดำเนินการ" },
  { status: "completed", label: "เสร็จแล้ว" },
];
// สถานะที่ออกนอกเส้นทางปกติ — ค้างอยู่ที่ขั้นอนุมัติและยังเดินต่อไม่ได้จนกว่าจะแก้
const OFF_TRACK_STATUSES = { more_info: "warning", rejected: "danger", cancelled: "danger", draft: "muted" };

/* คำนวณว่าใบนี้เดินมาถึงขั้นไหนจาก "สถานะปัจจุบัน" อย่างเดียว ไม่ได้อ่านจาก
   request_status_history เพราะสถานะใน requests คือความจริง ณ ปัจจุบันอยู่แล้ว และการตรวจรับ
   ไม่ผ่านจะย้อนใบกลับไป assigned — แถบจึงต้องถอยตามด้วย ไม่ใช่ค้างที่ขั้นที่เคยผ่านสูงสุด */
function requestProgress(status, usesRepairWorkflow) {
  const stages = usesRepairWorkflow ? REPAIR_STAGES : GENERAL_STAGES;
  const offTrack = OFF_TRACK_STATUSES[status] ?? null;
  // ขอข้อมูลเพิ่ม/ไม่อนุมัติ/ยกเลิก ล้วนเกิดตอนพิจารณา จึงปักไว้ที่ขั้นอนุมัติ
  const index = offTrack ? 0 : stages.findIndex((stage) => stage.status === status);
  return {
    stages,
    index,
    offTrack,
    // ใบที่จบแล้วนับเป็นผ่านครบทุกขั้น ใบที่ยังเดินอยู่นับเฉพาะขั้นก่อนหน้าว่าผ่านแล้ว
    done: status === "completed" ? stages.length : Math.max(index, 0),
    label: offTrack ? statusLabels[status] ?? status : stages[index]?.label ?? statusLabels[status] ?? status,
  };
}

function progressTracker(status, usesRepairWorkflow, { waitingOn = null } = {}) {
  const { stages, index, offTrack, done, label } = requestProgress(status, usesRepairWorkflow);
  // index < 0 แปลว่าสถานะนี้ไม่อยู่ในลำดับขั้นของงานประเภทนี้ (เช่นใบเก่าที่สร้างก่อนติดธง
  // uses_repair_workflow) — บอกแค่สถานะไป ไม่เดาเลขขั้นให้ผิด
  const caption = offTrack || index < 0
    ? label
    : `ขั้นที่ ${index + 1} จาก ${stages.length} · ${label}`;
  const dots = stages.map((stage, position) => {
    const state = offTrack && position === index ? "blocked"
      : position < done ? "done"
      : position === index ? "current"
      : "todo";
    return `<span class="progress-dot ${state}" title="${escapeHtml(stage.label)}"></span>`;
  }).join("");
  return `<div class="progress-cell">
    <div class="progress-track" role="img" aria-label="${escapeHtml(caption)}">${dots}</div>
    <span class="progress-caption${offTrack ? ` ${escapeHtml(offTrack)}` : ""}">${escapeHtml(caption)}</span>
    ${waitingOn ? `<span class="progress-waiting">รอ: ${escapeHtml(waitingOn)}</span>` : ""}
  </div>`;
}
const REQUEST_MODULE_CODES = ["MT_REPAIR", "MANAGEMENT", "NCR_CAR"];
const REPAIR_DEPARTMENT_OPTIONS = [
  { sourceCode: "RB", displayCode: "RB", name: "ขึ้นรูปราง" },
  { sourceCode: "GR", displayCode: "GR", name: "แปรรูปราง" },
  { sourceCode: "BG", displayCode: "BG", name: "เย็บจักร" },
  { sourceCode: "PT", displayCode: "PT", name: "ขึ้นรูปพลาสติก" },
  { sourceCode: "PK", displayCode: "PK", name: "ประกอบบรรจุภัณฑ์" },
  { sourceCode: "QA", displayCode: "QA", name: "ประกันคุณภาพ" },
  { sourceCode: "ST", displayCode: "ST-WH", name: "คลังสินค้า" },
  { sourceCode: "SR", displayCode: "SR", name: "คลังยางเส้นยาว" },
  { sourceCode: "FT", displayCode: "FT", name: "บริหารโรงงาน" },
  { sourceCode: "MT", displayCode: "MT", name: "ซ่อมบำรุง" },
  { sourceCode: "AD", displayCode: "AD", name: "ธุรการสำนักงาน" },
];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const docTypeLabels = { request: "ใบคำร้อง", repair: "ใบแจ้งซ่อม" };
const executionPlanLabels = {
  immediate: "ดำเนินการได้ทันที",
  need_purchase: "ต้องการสั่งซื้ออุปกรณ์",
  use_existing: "ใช้อุปกรณ์ที่มีอยู่",
};
const inspectorOpinionLabels = {
  send_repair: "ส่งซ่อม",
  external: "เรียกช่างภายนอกมาซ่อม",
  self_repair: "ซ่อมเอง",
  buy_parts: "ซื้ออุปกรณ์มาทำเอง",
};
const verifyResultLabels = { pass: "ผ่าน — ใช้งานได้ปกติ", fail: "ไม่ผ่าน — ต้องซ่อมเพิ่มเติม" };
const detailFieldLabels = {
  asset_code: "รหัสทรัพย์สิน/เครื่องจักร",
  location: "สถานที่",
  preferred_date: "วันที่สะดวก",
  impact: "ผลกระทบ",
  vehicle_no: "ทะเบียนรถ",
  odometer: "เลขไมล์",
  estimated_cost: "งบประมาณโดยประมาณ",
  required_date: "วันที่ต้องการ",
  vendor: "ผู้จำหน่าย",
  business_reason: "เหตุผลทางธุรกิจ",
  system_name: "ชื่อระบบ",
  access_level: "ระดับสิทธิ์",
  leave_type: "ประเภทการลา",
  start_date: "วันที่เริ่ม",
  end_date: "วันที่สิ้นสุด",
  course_name: "ชื่อหลักสูตร",
  provider: "ผู้จัดอบรม",
  attachment_note: "สิ่งที่แนบมาด้วย",
  cc_other_note: "อื่นๆ (ระบุ)",
};

// ส่วนที่ 3 ของฟอร์ม PP01-FM08 "สำเนาถึงแผนก" — ตาราง 6 คอลัมน์ 4 แถว เรียงตามฟอร์มต้นฉบับ
// ช่องสุดท้าย (null) คือ "อื่นๆ" ซึ่งเป็นช่องข้อความอิสระ ไม่ใช่แผนกในระบบ (ดู request-form.tsx)
const CC_DEPARTMENT_GRID = [
  ["PP", "BD", "QA", "RB", "GR", "PK"],
  ["PT", "BG", "SR", "SE", "ST", "WH"],
  ["MS", "MT", "FT", "IT", "EX", "SA"],
  ["PC", "HR", "AD", "AC", "SP", null],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function relation(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function initials(employee) {
  return `${employee?.first_name?.[0] ?? ""}${employee?.last_name?.[0] ?? ""}`;
}

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

function go(path) {
  location.hash = `#/${path}`;
}

function showToast(message, type = "success") {
  toastNode.textContent = message;
  toastNode.className = `toast show${type === "error" ? " error" : ""}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toastNode.className = "toast"; }, 3500);
}

function friendlyError(error) {
  const message = String(error?.message ?? error ?? "เกิดข้อผิดพลาด");
  const map = {
    AUTH_REQUIRED: "กรุณาเข้าสู่ระบบอีกครั้ง",
    NOT_AUTHORIZED: "คุณไม่มีสิทธิ์ดำเนินการนี้",
    EMPLOYEE_NOT_FOUND: "บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ",
    INVALID_TITLE: "หัวข้อต้องมี 3–200 ตัวอักษร",
    INVALID_DESCRIPTION: "รายละเอียดต้องมี 3–5,000 ตัวอักษร",
    STEP_NOT_PENDING: "รายการนี้ถูกดำเนินการแล้ว",
    STEP_NOT_CURRENT: "ขั้นตอนนี้ไม่ใช่ขั้นตอนปัจจุบัน",
    REQUEST_NOT_AWAITING_INFO: "คำร้องนี้ไม่ได้อยู่ในสถานะรอข้อมูลเพิ่มเติมแล้ว",
    STEP_NOT_FOUND: "ไม่พบขั้นตอนที่ขอข้อมูลเพิ่มเติมไว้",
    INVALID_TRANSITION: "ไม่สามารถเปลี่ยนเป็นสถานะนี้ได้",
    ASSIGNED_TO_ANOTHER_OPERATOR: "รายการนี้มีผู้รับผิดชอบอื่นแล้ว",
    DEPARTMENT_NOT_REPAIR_SITE: "แผนกนี้ไม่ได้เปิดใช้งานแจ้งซ่อม",
    MACHINE_NOT_FOUND: "ไม่พบเครื่องจักรนี้ในแผนกที่เลือก",
    INVALID_DOC_TYPE: "กรุณาเลือกประเภทเอกสาร",
    REQUEST_NOT_PENDING_ASSIGN: "ใบนี้ไม่ได้อยู่ในขั้นรอมอบหมายช่างแล้ว",
    TECHNICIAN_NOT_FOUND: "ไม่พบช่างที่เลือกในแผนกซ่อมบำรุง",
    REQUEST_NOT_ASSIGNED: "ใบนี้ไม่ได้อยู่ในขั้นรอเริ่มงานแล้ว",
    NOT_ASSIGNED_TECHNICIAN: "คุณไม่ใช่ช่างที่ถูกมอบหมายหรือหัวหน้าแผนกซ่อมบำรุงของใบนี้",
    REQUEST_NOT_IN_PROGRESS: "ใบนี้ไม่ได้อยู่ระหว่างดำเนินการซ่อมแล้ว",
    INVALID_EXECUTION_PLAN: "กรุณาเลือกการดำเนินงาน",
    INVALID_INSPECTOR_OPINION: "กรุณาเลือกแนวทางการซ่อม",
    INVALID_CAUSE_ANALYSIS: "กรุณาระบุผลวิเคราะห์สาเหตุ 3–5,000 ตัวอักษร",
    REQUEST_NOT_PENDING_VERIFY: "ใบนี้ไม่ได้อยู่ในขั้นรอตรวจรับแล้ว",
    INVALID_RESULT: "กรุณาเลือกผลการตรวจรับ",
    NOTE_REQUIRED: "กรุณาระบุสาเหตุที่ไม่ผ่านการตรวจรับ",
    COMMENT_REQUIRED: "กรุณาระบุเหตุผล (จำเป็นสำหรับ \"ไม่อนุมัติ\" และ \"ขอข้อมูลเพิ่ม\")",
    REQUEST_NOT_ASSIGNABLE: "ใบนี้ยังไม่ผ่านการอนุมัติ หรือถูกปฏิเสธไปแล้ว จึงมอบหมายช่างไม่ได้",
    RECEIVED_BY_REQUIRED: "กรุณาระบุชื่อผู้จัดการที่รับใบ",
    EXECUTION_PLAN_REQUIRED: "กรุณาเลือกการดำเนินงาน",
    INSPECTOR_OPINION_REQUIRED: "กรุณาเลือกความคิดเห็นของช่างผู้ตรวจสอบ",
    WORK_START_DATE_REQUIRED: "กรุณาระบุวันเริ่มงาน",
    WORK_EXPECTED_DATE_REQUIRED: "กรุณาระบุวันที่คาดว่าจะเสร็จ",
    WORK_DATE_RANGE_INVALID: "วันที่คาดว่าจะเสร็จต้องไม่ก่อนวันเริ่มงาน",
    REPAIR_USES_OWN_WORKFLOW: "ใบแจ้งซ่อมต้องเดินตามขั้นตอนของช่าง เปลี่ยนสถานะตรงๆ ไม่ได้",
    EXPECTED_DATE_REQUIRED: "กรุณาระบุวันที่คาดว่าของจะมาส่ง",
    STEP_ALREADY_DONE: "หมุดนี้บันทึกว่าเสร็จแล้ว เลื่อนวันที่ไม่ได้",
    INVALID_CC_DEPARTMENTS: "แผนกที่เลือกสำเนาถึงไม่ถูกต้อง",
  };
  const key = Object.keys(map).find((item) => message.includes(item));
  return key ? map[key] : message;
}

function setFormBusy(form, busy) {
  form.querySelectorAll("button, input, textarea, select").forEach((node) => { node.disabled = busy; });
  const button = form.querySelector('button[type="submit"]');
  if (button) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = busy ? "กำลังดำเนินการ…" : button.dataset.label;
  }
}

function optionalAttachment(value) {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_ATTACHMENT_SIZE) throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 10 MB");
  if (!ALLOWED_ATTACHMENT_TYPES.has(value.type)) throw new Error("ชนิดไฟล์ไม่รองรับ");
  return value;
}

async function uploadRequestAttachment(requestId, file, uploaderId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const storagePath = `${requestId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await sb.storage
    .from("request-attachments")
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error: metadataError } = await sb.from("request_attachments").insert({
    request_id: requestId,
    uploader_id: uploaderId,
    storage_path: storagePath,
    file_name: file.name.slice(0, 255),
    content_type: file.type,
    size_bytes: file.size,
  });
  if (metadataError) {
    await sb.storage.from("request-attachments").remove([storagePath]);
    throw metadataError;
  }
}

// ---------------------------------------------------------------------------
// ตัวอย่างไฟล์แนบ: แสดงรูปทันทีในหน้า (รวมถึงหน้าแรกของ PDF) โดยไม่ต้องกดเปิด
// ---------------------------------------------------------------------------
const ATTACHMENT_URL_TTL = 3600;
const TEXT_PREVIEW_LIMIT = 512 * 1024;
const attachmentKindLabels = { image: "รูปภาพ", pdf: "PDF", text: "ข้อความ", sheet: "Excel", doc: "Word", other: "ไฟล์แนบ" };
const attachmentPreviews = new Map();
const pdfDocuments = new Map();
let pdfjsPromise = null;

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

function attachmentKind(file) {
  const type = String(file.content_type ?? "").toLowerCase();
  const name = String(file.file_name ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("text/") || name.endsWith(".txt")) return "text";
  if (type.includes("spreadsheet") || name.endsWith(".xlsx")) return "sheet";
  if (type.includes("wordprocessing") || name.endsWith(".docx")) return "doc";
  return "other";
}

// pdf.js อยู่ใน vendor/ เพราะ CSP เป็น default-src 'self' — worker จาก CDN จะถูกบล็อก
// อ้างอิงตำแหน่งจาก URL ของ app.js เอง เพื่อให้ถูกต้องไม่ว่า host ไว้ที่ path ไหน
const APP_SCRIPT_URL = document.currentScript?.src || document.baseURI;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(new URL("./vendor/pdfjs/pdf.min.mjs", APP_SCRIPT_URL).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", APP_SCRIPT_URL).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function renderPdfPageImage(url, pageNumber, targetWidth) {
  const pdfjs = await loadPdfjs();
  let documentPromise = pdfDocuments.get(url);
  if (!documentPromise) {
    documentPromise = pdfjs.getDocument({ url, isEvalSupported: false }).promise;
    pdfDocuments.set(url, documentPromise);
    documentPromise.catch(() => pdfDocuments.delete(url));
  }
  const pdf = await documentPromise;
  const page = await pdf.getPage(Math.min(Math.max(pageNumber, 1), pdf.numPages));
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(targetWidth / unscaled.width, 4) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  try {
    await page.render({ canvas, viewport }).promise;
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.9), pageCount: pdf.numPages };
  } finally {
    page.cleanup();
  }
}

function attachmentGalleryHtml(files) {
  if (!files.length) return `<p class="muted small">ยังไม่มีไฟล์แนบ</p>`;
  return `<div class="attachment-grid" id="attachment-gallery">${files.map((file) => {
    const kind = attachmentKind(file);
    return `<figure class="attachment-tile" data-attachment="${escapeHtml(file.id)}">
      <button class="attachment-preview" type="button" data-attachment-open="${escapeHtml(file.id)}" aria-label="ดูขนาดใหญ่: ${escapeHtml(file.file_name)}">
        <span class="attachment-preview-state">กำลังสร้างตัวอย่าง…</span>
        <span class="attachment-kind">${escapeHtml(attachmentKindLabels[kind])}</span>
      </button>
      <figcaption class="attachment-caption">
        <span class="attachment-name" title="${escapeHtml(file.file_name)}">${escapeHtml(file.file_name)}</span>
        <span class="attachment-meta"><span>${escapeHtml(formatFileSize(file.size_bytes))}</span><a class="attachment-download" data-attachment-download="${escapeHtml(file.id)}" hidden download>ดาวน์โหลด</a></span>
      </figcaption>
    </figure>`;
  }).join("")}</div>`;
}

function setTilePreview(tile, node, badgeSuffix = "") {
  const preview = tile.querySelector(".attachment-preview");
  preview.querySelector(".attachment-preview-state")?.remove();
  preview.querySelector(".attachment-preview-media, .attachment-preview-text")?.remove();
  preview.prepend(node);
  if (badgeSuffix) {
    const badge = preview.querySelector(".attachment-kind");
    if (badge) badge.textContent = `${badge.textContent}${badgeSuffix}`;
  }
}

function setTileMessage(tile, message) {
  const preview = tile.querySelector(".attachment-preview");
  const state = preview.querySelector(".attachment-preview-state");
  if (state) state.textContent = message;
}

function previewImageNode(src, alt) {
  const image = new Image();
  image.className = "attachment-preview-media";
  image.alt = alt;
  image.loading = "lazy";
  image.src = src;
  return image;
}

async function fillAttachmentTile(file, url) {
  const tile = document.querySelector(`.attachment-tile[data-attachment="${file.id}"]`);
  if (!tile) return;
  const kind = attachmentKind(file);
  const downloadLink = tile.querySelector("[data-attachment-download]");
  if (downloadLink) {
    downloadLink.href = `${url}&download=${encodeURIComponent(file.file_name)}`;
    downloadLink.hidden = false;
  }
  try {
    if (kind === "image") {
      setTilePreview(tile, previewImageNode(url, file.file_name));
      return;
    }
    if (kind === "pdf") {
      const rendered = await renderPdfPageImage(url, 1, 640);
      setTilePreview(tile, previewImageNode(rendered.dataUrl, `ตัวอย่างหน้าแรกของ ${file.file_name}`), ` · ${rendered.pageCount} หน้า`);
      attachmentPreviews.get(file.id).pageCount = rendered.pageCount;
      return;
    }
    if (kind === "text" && (file.size_bytes ?? 0) <= TEXT_PREVIEW_LIMIT) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("preview failed");
      const text = await response.text();
      const block = document.createElement("pre");
      block.className = "attachment-preview-text";
      block.textContent = text.slice(0, 600) || "(ไฟล์ว่าง)";
      setTilePreview(tile, block);
      return;
    }
    setTileMessage(tile, attachmentKindLabels[kind]);
  } catch {
    setTileMessage(tile, "แสดงตัวอย่างไม่ได้ · กดเพื่อเปิดไฟล์");
  }
}

async function hydrateAttachmentGallery(files) {
  if (!files.length || !document.querySelector("#attachment-gallery")) return;
  attachmentPreviews.clear();
  const { data, error } = await sb.storage
    .from("request-attachments")
    .createSignedUrls(files.map((file) => file.storage_path), ATTACHMENT_URL_TTL);
  if (error) {
    document.querySelectorAll(".attachment-tile").forEach((tile) => setTileMessage(tile, "เปิดไฟล์แนบไม่ได้"));
    return;
  }
  const signedByPath = new Map((data ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
  for (const file of files) {
    const url = signedByPath.get(file.storage_path);
    if (!url) {
      const tile = document.querySelector(`.attachment-tile[data-attachment="${file.id}"]`);
      if (tile) setTileMessage(tile, "เปิดไฟล์แนบไม่ได้");
      continue;
    }
    attachmentPreviews.set(file.id, { file, url, pageCount: null });
  }
  // รูปโหลดขนานกันเองอยู่แล้ว ส่วน PDF เรนเดอร์ทีละไฟล์เพื่อไม่ให้เปิด worker พร้อมกันหลายตัว
  for (const file of files) {
    const entry = attachmentPreviews.get(file.id);
    if (!entry) continue;
    if (attachmentKind(file) === "image") fillAttachmentTile(file, entry.url);
  }
  for (const file of files) {
    const entry = attachmentPreviews.get(file.id);
    if (!entry || attachmentKind(file) === "image") continue;
    await fillAttachmentTile(file, entry.url);
  }
}

function openAttachmentLightbox(id) {
  const entry = attachmentPreviews.get(id);
  if (!entry) return;
  const { file, url } = entry;
  const kind = attachmentKind(file);
  let page = 1;

  const overlay = document.createElement("div");
  overlay.className = "attachment-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", file.file_name);
  overlay.innerHTML = `<div class="attachment-lightbox-panel">
    <header class="attachment-lightbox-bar">
      <span class="attachment-lightbox-title" title="${escapeHtml(file.file_name)}">${escapeHtml(file.file_name)}</span>
      <span class="attachment-lightbox-actions">
        <a class="btn secondary small" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">เปิดแท็บใหม่</a>
        <a class="btn secondary small" href="${escapeHtml(`${url}&download=${encodeURIComponent(file.file_name)}`)}" download>ดาวน์โหลด</a>
        <button class="btn secondary small" type="button" data-lightbox-close>ปิด</button>
      </span>
    </header>
    <div class="attachment-lightbox-body"><span class="attachment-preview-state">กำลังเปิด…</span></div>
    ${kind === "pdf" ? `<footer class="attachment-lightbox-nav">
      <button class="btn secondary small" type="button" data-lightbox-prev disabled>← ก่อนหน้า</button>
      <span class="muted small" data-lightbox-page>หน้า 1</span>
      <button class="btn secondary small" type="button" data-lightbox-next disabled>ถัดไป →</button>
    </footer>` : ""}
  </div>`;

  const body = overlay.querySelector(".attachment-lightbox-body");
  const pageLabel = overlay.querySelector("[data-lightbox-page]");
  const previousButton = overlay.querySelector("[data-lightbox-prev]");
  const nextButton = overlay.querySelector("[data-lightbox-next]");

  function showNode(node) {
    body.replaceChildren(node);
  }

  function showMessage(message, withDownload = false) {
    const wrap = document.createElement("div");
    wrap.className = "attachment-lightbox-fallback";
    const text = document.createElement("p");
    text.textContent = message;
    wrap.append(text);
    if (withDownload) {
      const link = document.createElement("a");
      link.className = "btn small";
      link.href = `${url}&download=${encodeURIComponent(file.file_name)}`;
      link.download = file.file_name;
      link.textContent = "ดาวน์โหลดไฟล์";
      wrap.append(link);
    }
    showNode(wrap);
  }

  async function showPdfPage() {
    if (pageLabel) pageLabel.textContent = `หน้า ${page}${entry.pageCount ? ` / ${entry.pageCount}` : ""}`;
    try {
      const rendered = await renderPdfPageImage(url, page, Math.min(1600, Math.round(window.innerWidth * 1.5)));
      entry.pageCount = rendered.pageCount;
      const image = previewImageNode(rendered.dataUrl, `หน้า ${page} ของ ${file.file_name}`);
      image.className = "attachment-lightbox-media";
      showNode(image);
      if (pageLabel) pageLabel.textContent = `หน้า ${page} / ${rendered.pageCount}`;
      if (previousButton) previousButton.disabled = page <= 1;
      if (nextButton) nextButton.disabled = page >= rendered.pageCount;
    } catch {
      showMessage("เปิดตัวอย่าง PDF ไม่ได้ กรุณาดาวน์โหลดเพื่อเปิดดู", true);
    }
  }

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
    document.body.classList.remove("no-scroll");
  }

  function onKeyDown(event) {
    if (event.key === "Escape") close();
    if (kind !== "pdf") return;
    if (event.key === "ArrowRight" && nextButton && !nextButton.disabled) { page += 1; showPdfPage(); }
    if (event.key === "ArrowLeft" && previousButton && !previousButton.disabled) { page -= 1; showPdfPage(); }
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-lightbox-close]")) close();
    if (event.target.closest("[data-lightbox-prev]")) { page = Math.max(1, page - 1); showPdfPage(); }
    if (event.target.closest("[data-lightbox-next]")) { page += 1; showPdfPage(); }
  });
  document.addEventListener("keydown", onKeyDown);
  document.body.classList.add("no-scroll");
  document.body.append(overlay);

  if (kind === "image") {
    const image = previewImageNode(url, file.file_name);
    image.className = "attachment-lightbox-media";
    showNode(image);
  } else if (kind === "pdf") {
    showPdfPage();
  } else if (kind === "text" && (file.size_bytes ?? 0) <= TEXT_PREVIEW_LIMIT) {
    fetch(url)
      .then((response) => { if (!response.ok) throw new Error("preview failed"); return response.text(); })
      .then((text) => {
        const block = document.createElement("pre");
        block.className = "attachment-preview-text";
        block.textContent = text || "(ไฟล์ว่าง)";
        showNode(block);
      })
      .catch(() => showMessage("เปิดตัวอย่างไฟล์ไม่ได้ กรุณาดาวน์โหลดเพื่อเปิดดู", true));
  } else {
    showMessage(`ไฟล์ ${attachmentKindLabels[kind]} แสดงตัวอย่างในหน้าเว็บไม่ได้ กรุณาดาวน์โหลดเพื่อเปิดดู`, true);
  }
}

function statusBadge(status) {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(statusLabels[status] ?? status)}</span>`;
}

// ระบบเดิมแยกสถานะรออนุมัติ/ขอข้อมูลเพิ่มเป็นของ ผจก.โรงงาน กับ ผจก.ทั่วไป คนละตัว ส่วนที่นี่เก็บเป็น
// pending_approval/more_info ตัวเดียวแล้วดูขั้นประกอบ — เติมชื่อขั้นต่อท้ายให้อ่านได้เหมือนกัน
const approverShortNames = { "ผู้จัดการโรงงาน": "ผจก.โรงงาน", "ผู้จัดการทั่วไป": "ผจก.ทั่วไป" };

function repairStatusBadge(request, steps) {
  const stepName = request.status === "pending_approval"
    ? steps.find((step) => step.status === "pending" && step.step_order === request.current_step)?.step_name
    : request.status === "more_info"
      ? steps.find((step) => step.status === "more_info")?.step_name
      : null;
  if (!stepName) return statusBadge(request.status);
  const short = approverShortNames[stepName] ?? stepName;
  const label = `${statusLabels[request.status] ?? request.status} (${short})`;
  return `<span class="badge ${escapeHtml(request.status)}">${escapeHtml(label)}</span>`;
}

// แถวกรอกอะไหล่/วัสดุหนึ่งรายการในฟอร์มบันทึกผลการซ่อม — โครงเดียวกับ maintRecord.parts[] ของ
// ระบบ Maintanance-MT เดิม (name/qty/unit/price/shop/note) ใช้ซ้ำทั้งตอนสร้างแถวแรกและกด "+ เพิ่มรายการ"
// เรนเดอร์เป็นแถวตาราง (ลำดับ/รายการ/จำนวน/หน่วย/ราคา/ชื่อร้าน/หมายเหตุ) ให้หน้าตาตรงกับฟอร์มกระดาษเดิม
function partsRowHtml(item = {}) {
  return `<tr class="parts-row">
    <td class="parts-row-no"></td>
    <td><input class="input" type="text" maxlength="200" placeholder="รายการอะไหล่/วัสดุที่ใช้" aria-label="รายการ" data-part-field="name" value="${escapeHtml(item.name ?? "")}"></td>
    <td><input class="input" type="text" maxlength="50" placeholder="จำนวน" aria-label="จำนวน" data-part-field="qty" value="${escapeHtml(item.qty ?? "")}"></td>
    <td><input class="input" type="text" maxlength="50" placeholder="หน่วย" aria-label="หน่วย" data-part-field="unit" value="${escapeHtml(item.unit ?? "")}"></td>
    <td><input class="input" type="text" maxlength="50" placeholder="ราคา" aria-label="ราคา" data-part-field="price" value="${escapeHtml(item.price ?? "")}"></td>
    <td><input class="input" type="text" maxlength="200" placeholder="ชื่อร้าน" aria-label="ชื่อร้าน" data-part-field="shop" value="${escapeHtml(item.shop ?? "")}"></td>
    <td><input class="input" type="text" maxlength="500" placeholder="หมายเหตุ" aria-label="หมายเหตุ" data-part-field="note" value="${escapeHtml(item.note ?? "")}"></td>
    <td class="parts-row-actions"><button type="button" class="btn danger small parts-row-remove" aria-label="ลบรายการนี้">ลบ</button></td>
  </tr>`;
}

// อัปเดตเลขลำดับหน้าแต่ละแถวใหม่หลังเพิ่ม/ลบแถว ให้ "ลำดับ" เรียงต่อเนื่องเสมอ
function renumberPartsRows(container) {
  container?.querySelectorAll(".parts-row").forEach((row, index) => {
    const cell = row.querySelector(".parts-row-no");
    if (cell) cell.textContent = String(index + 1);
  });
}

function requestFact(label, value, { icon = "•", tone = "primary", wide = false, valueClass = "" } = {}) {
  const classes = ["request-fact", `request-fact-${tone}`, wide ? "wide" : ""].filter(Boolean).join(" ");
  const valueClasses = ["request-fact-value", valueClass].filter(Boolean).join(" ");
  return `<div class="${escapeHtml(classes)}">
    <span class="request-fact-icon" aria-hidden="true">${escapeHtml(icon)}</span>
    <div class="request-fact-copy">
      <span class="request-fact-label">${escapeHtml(label)}</span>
      <strong class="${escapeHtml(valueClasses)}">${escapeHtml(value ?? "—")}</strong>
    </div>
  </div>`;
}

function requesterLabel(request, directory) {
  const fromDirectory = directory ? personName(directory, request.requester_id) : "—";
  if (fromDirectory && fromDirectory !== "—") return fromDirectory;
  return (request.requester_name ?? "").trim() || "—";
}

function requestCode(requestNo) {
  return String(requestNo ?? "REQ").match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "REQ";
}

function requestOwnerNames(request, directory) {
  if (!directory) return [];
  const ids = [
    ...(request.request_technicians ?? []).map((row) => row.technician_id),
    request.assignee_id,
  ].filter(Boolean);
  return [...new Set(ids)]
    .map((id) => personName(directory, id))
    .filter((name) => name && name !== "—");
}

function requestRows(requests, { showProgress = false, showRequester = false, directory = null } = {}) {
  if (!requests.length) return `<div class="empty">ยังไม่มีรายการในขณะนี้</div>`;
  return `
    <div class="request-timeline">${requests.map((request) => {
        const type = relation(request.request_type);
        const ownerNames = requestOwnerNames(request, directory);
        const machine = [request.machine_code, request.machine_name].filter(Boolean).join(" · ");
        const description = (request.description ?? "").trim();
        const href = `#/request?id=${encodeURIComponent(request.id)}`;
        return `<article class="request-timeline-card status-${escapeHtml(request.status)}">
          <header class="request-card-head">
            <div class="request-card-identity">
              <a class="request-card-no" href="${href}">${escapeHtml(request.request_no)}</a>
              <strong class="request-card-code">${escapeHtml(requestCode(request.request_no))}</strong>
              <span class="request-card-type">${escapeHtml(type?.name_th ?? "คำร้อง")}</span>
            </div>
            <div class="request-card-tags">
              ${ownerNames.length ? `<span class="request-owner-chip" title="ผู้รับผิดชอบ">🧰 ${escapeHtml(ownerNames.join(", "))}</span>` : ""}
              <span class="request-priority-chip priority-${escapeHtml(request.priority)}">${escapeHtml(priorityLabels[request.priority] ?? request.priority)}</span>
              ${statusBadge(request.status)}
            </div>
          </header>
          <div class="request-card-body">
            <a class="request-card-title" href="${href}">${escapeHtml(machine || request.title)}</a>
            ${machine && request.title !== machine ? `<p class="request-card-subtitle">${escapeHtml(request.title)}</p>` : ""}
            ${description && description !== request.title ? `<p class="request-card-description">${escapeHtml(description)}</p>` : ""}
            <div class="request-card-meta">
              ${showRequester ? `<span><b>ผู้แจ้ง:</b> ${escapeHtml(requesterLabel(request, directory))}</span>` : ""}
              ${request.needed_date ? `<span><b>ต้องการใช้งาน:</b> ${formatDate(request.needed_date)}</span>` : ""}
              <span><b>แจ้งเมื่อ:</b> ${formatDate(request.created_at, true)}</span>
              ${request.updated_at && request.updated_at !== request.created_at ? `<span><b>อัปเดต:</b> ${formatDate(request.updated_at, true)}</span>` : ""}
            </div>
          </div>
          <footer class="request-card-footer">
            ${showProgress ? progressTracker(request.status, Boolean(type?.uses_repair_workflow)) : `<span class="muted small">ติดตามรายละเอียดและประวัติงาน</span>`}
            <a class="request-detail-link" href="${href}">ดูรายละเอียด <span aria-hidden="true">→</span></a>
          </footer>
        </article>`;
      }).join("")}</div>`;
}

/* กระดานติดตามสถานะที่ "ทุกคน" เห็นได้ — ข้อมูลมาจาก RPC app_request_status_board ซึ่งคืนเฉพาะ
   ฟิลด์ระดับติดตามสถานะ ไม่มีรายละเอียดอาการ/ไฟล์แนบ/ความเห็นผู้อนุมัติ ใบที่ผู้ใช้ไม่มีสิทธิ์
   เปิดดูเต็ม (can_open = false) จึงแสดงเป็นข้อความเฉย ๆ ไม่ทำเป็นลิงก์ */
function statusBoardRows(rows) {
  if (!rows.length) return `<div class="empty">ยังไม่มีรายการในขณะนี้</div>`;
  return `
    <div class="request-timeline status-board-timeline">${rows.map((row) => {
        const href = `#/request?id=${encodeURIComponent(row.id)}`;
        const subject = row.subject ?? "—";
        const department = row.department_name ?? row.department_code ?? "—";
        return `<article class="request-timeline-card status-${escapeHtml(row.status)}">
          <header class="request-card-head">
            <div class="request-card-identity">
              ${row.can_open
                ? `<a class="request-card-no" href="${href}">${escapeHtml(row.request_no)}</a>`
                : `<span class="request-card-no locked" title="คุณไม่มีสิทธิ์เปิดดูรายละเอียดของใบนี้">${escapeHtml(row.request_no)}</span>`}
              <strong class="request-card-code">${escapeHtml(requestCode(row.request_no))}</strong>
              <span class="request-card-type">${escapeHtml(row.type_name_th ?? "คำร้อง")}</span>
            </div>
            <div class="request-card-tags">
              <span class="request-department-chip" title="แผนกที่แจ้ง">🏢 ${escapeHtml(department)}</span>
              ${row.is_urgent ? `<span class="request-priority-chip priority-urgent">เร่งด่วน</span>` : ""}
              ${statusBadge(row.status)}
            </div>
          </header>
          <div class="request-card-body">
            ${row.can_open
              ? `<a class="request-card-title" href="${href}">${escapeHtml(subject)}</a>`
              : `<strong class="request-card-title">${escapeHtml(subject)}</strong>`}
            <div class="request-card-meta">
              <span><b>ผู้แจ้ง:</b> ${escapeHtml(row.requester_name ?? "—")}</span>
              <span><b>แผนก:</b> ${escapeHtml(department)}</span>
              <span><b>อัปเดตล่าสุด:</b> ${formatDate(row.last_changed_at ?? row.submitted_at, true)}</span>
            </div>
          </div>
          <footer class="request-card-footer">
            ${progressTracker(row.status, Boolean(row.uses_repair_workflow), { waitingOn: row.waiting_on })}
            ${row.can_open
              ? `<a class="request-detail-link" href="${href}">ดูรายละเอียด <span aria-hidden="true">→</span></a>`
              : `<span class="request-locked-note" title="สิทธิ์ของบัญชีนี้ดูได้เฉพาะสถานะและความคืบหน้า">🔒 ดูได้เฉพาะความคืบหน้า</span>`}
          </footer>
        </article>`;
      }).join("")}</div>`;
}

function themeButton() {
  return `<button class="icon-button theme-toggle" type="button" aria-label="สลับธีม" title="สลับธีม">◐</button>`;
}

function applyTheme() {
  const saved = localStorage.getItem("mnp-theme");
  document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("mnp-theme", next);
}

const pilotAuthMessages = {
  INVALID_CREDENTIALS: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง",
  INVALID_INVITE: "Invite code ไม่ถูกต้องหรือไม่ตรงกับรหัสพนักงาน",
  EMPLOYEE_NOT_FOUND: "ไม่พบรหัสพนักงานนี้ในระบบ",
  ACCOUNT_ALREADY_REGISTERED: "บัญชีนี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบ",
  ACCOUNT_CREATE_FAILED: "สร้างบัญชีไม่สำเร็จ โปรดลองรหัสผ่านอื่น",
  ACCOUNT_LINK_FAILED: "ไม่สามารถผูกบัญชีกับพนักงานได้",
  INVALID_EMPLOYEE_NO: "รหัสพนักงานต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 3–32 ตัว",
  INVALID_PASSWORD: "รหัสผ่านต้องมี 8–72 ตัวอักษร",
  INVALID_NAME: "กรุณากรอกชื่อและนามสกุล",
  INVALID_POSITION: "กรุณาเลือกตำแหน่งในแผนก",
  DEPARTMENT_NOT_FOUND: "ไม่พบแผนกที่เลือก",
  EMPLOYEE_NO_TAKEN: "รหัสพนักงานนี้ถูกใช้แล้ว",
  REQUEST_ALREADY_PENDING: "มีคำร้องของรหัสพนักงานนี้รออนุมัติอยู่แล้ว",
  REQUEST_CREATE_FAILED: "ส่งคำร้องไม่สำเร็จ กรุณาลองใหม่",
  REQUEST_NOT_PENDING: "คำร้องนี้ถูกดำเนินการไปแล้ว",
  PASSWORD_MISSING: "คำร้องนี้ไม่มีรหัสผ่านให้ตั้งค่า กรุณาให้ผู้ใช้ส่งคำร้องใหม่",
  PASSWORD_UPDATE_FAILED: "เปลี่ยนรหัสผ่านไม่สำเร็จ",
  NOT_AUTHORIZED: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ",
  AUTH_REQUIRED: "กรุณาเข้าสู่ระบบใหม่",
  DIRECTORY_UNAVAILABLE: "โหลดข้อมูลแผนกไม่สำเร็จ",
  session_not_found: "เซสชันนี้ถูกยกเลิกเพราะรหัสผ่านถูกเปลี่ยน กรุณาเข้าสู่ระบบใหม่",
};

async function callPilotAuth(payload, accessToken) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(PILOT_AUTH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(result.error ?? "");
    const known = Object.keys(pilotAuthMessages).find((key) => code.includes(key));
    throw new Error(known ? pilotAuthMessages[known] : "เชื่อมต่อระบบยืนยันตัวตนไม่สำเร็จ");
  }
  return result;
}

async function loadDirectory() {
  if (state.directory) return state.directory;
  state.directory = await callPilotAuth({ action: "directory" });
  return state.directory;
}

async function renderAuth(message = "") {
  const isRequest = state.authMode === "request";
  let directoryError = "";
  if (isRequest && !state.directory) {
    try {
      await loadDirectory();
    } catch (error) {
      directoryError = friendlyError(error);
    }
  }
  const departments = state.directory?.departments ?? [];
  const roles = state.directory?.roles ?? [];

  const requestFields = `
    <div class="field-row">
      <div class="field"><label for="first-name">ชื่อ</label><input class="input" id="first-name" name="first_name" maxlength="100" required></div>
      <div class="field"><label for="last-name">นามสกุล</label><input class="input" id="last-name" name="last_name" maxlength="100" required></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="department">แผนก</label><select class="input" id="department" name="department_id" required><option value="">เลือกแผนก</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
      <div class="field"><label for="desired-role">ตำแหน่ง</label><select class="input" id="desired-role" name="role_id" required><option value="">เลือกตำแหน่ง</option>${roles.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="job-title">ชื่อตำแหน่งงาน (ถ้ามี)</label><input class="input" id="job-title" name="job_title" maxlength="120"></div>
    <div class="field-row">
      <div class="field"><label for="email">อีเมล (ถ้ามี)</label><input class="input" id="email" name="email" type="email" maxlength="200"></div>
      <div class="field"><label for="phone">เบอร์ติดต่อ (ถ้ามี)</label><input class="input" id="phone" name="phone" maxlength="40"></div>
    </div>`;

  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-aside">
        <div class="brand"><div class="brand-mark">M</div><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></div>
        <div class="auth-copy">
          <div class="eyebrow">Employee workspace</div>
          <h1>ระบบคำร้องและ<br>การอนุมัติภายใน</h1>
          <p>ทดลองกระบวนการสร้างคำร้อง อนุมัติ และดำเนินงานร่วมกันผ่านเว็บ โดยแยกสิทธิ์ตามบทบาทของผู้ใช้</p>
        </div>
        <div class="auth-points"><span>✓ คำร้องดิจิทัล</span><span>✓ หลายบทบาท</span><span>✓ บันทึกประวัติ</span></div>
      </section>
      <section class="auth-panel">
        <div class="theme-button">${themeButton()}</div>
        <div class="auth-card">
          <div class="auth-tabs">
            <button type="button" data-auth-mode="login" class="${isRequest ? "" : "active"}">เข้าสู่ระบบ</button>
            <button type="button" data-auth-mode="request" class="${isRequest ? "active" : ""}">ขอเปิดบัญชี</button>
          </div>
          <h2>${isRequest ? "ขอเปิดบัญชีเข้าใช้งาน" : "เข้าสู่ระบบพนักงาน"}</h2>
          <p>${isRequest ? "กำหนด ID และรหัสผ่านที่ต้องการ ผู้ดูแลระบบจะเป็นผู้อนุมัติสิทธิ์ก่อนใช้งานได้" : "ใช้รหัสพนักงานและรหัสผ่านของคุณ"}</p>
          <div id="auth-message">${message}${directoryError ? `<div class="form-message error">${escapeHtml(directoryError)}</div>` : ""}</div>
          <form id="auth-form">
            <div class="field"><label for="employee-no">รหัสพนักงาน (ID เข้าใช้งาน)</label><input class="input" id="employee-no" name="employee_no" autocomplete="username" maxlength="32" placeholder="เช่น MNP0102" required></div>
            ${isRequest ? requestFields : ""}
            <div class="field"><label for="password">รหัสผ่าน</label><input class="input" id="password" name="password" type="password" autocomplete="${isRequest ? "new-password" : "current-password"}" minlength="8" maxlength="72" required><small>อย่างน้อย 8 ตัวอักษร</small></div>
            ${isRequest ? `<div class="field"><label for="confirm-password">ยืนยันรหัสผ่าน</label><input class="input" id="confirm-password" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
            <div class="field"><label for="reason">เหตุผล/หมายเหตุถึงผู้ดูแล (ถ้ามี)</label><textarea class="textarea" id="reason" name="reason" maxlength="1000"></textarea></div>` : ""}
            <button class="btn block" type="submit">${isRequest ? "ส่งคำร้องขอเปิดบัญชี" : "เข้าสู่ระบบ"}</button>
          </form>
          <div class="pilot-note"><strong>ระบบ Pilot</strong><br>ข้อมูลที่กรอกจะถูกบันทึกในฐานข้อมูลทดสอบจริง กรุณาอย่าใช้ข้อมูลลับหรือข้อมูลส่วนบุคคลที่ละเอียดอ่อน</div>
        </div>
      </section>
    </main>`;

  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
    state.authMode = button.dataset.authMode;
    renderAuth();
  }));
  document.querySelector(".theme-toggle").addEventListener("click", toggleTheme);
  document.querySelector("#auth-form").addEventListener("submit", isRequest ? handleAccountRequestSubmit : handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#auth-message");
  const values = new FormData(form);
  const employeeNo = String(values.get("employee_no") ?? "").trim().toUpperCase();
  const password = String(values.get("password") ?? "");
  setFormBusy(form, true);
  message.innerHTML = "";
  try {
    const tokens = await callPilotAuth({ action: "login", employeeNo, password });
    const { data, error } = await sb.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
    if (error) throw error;
    state.session = data.session;
    await loadEmployee();
    go("dashboard");
    await renderRoute();
  } catch (error) {
    message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(error))}</div>`;
  } finally {
    setFormBusy(form, false);
  }
}

async function handleAccountRequestSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#auth-message");
  const values = new FormData(form);
  const password = String(values.get("password") ?? "");
  if (password !== String(values.get("confirm_password") ?? "")) {
    message.innerHTML = `<div class="form-message error">รหัสผ่านทั้งสองช่องไม่ตรงกัน</div>`;
    return;
  }
  setFormBusy(form, true);
  message.innerHTML = "";
  try {
    await callPilotAuth({
      action: "account_request",
      employeeNo: String(values.get("employee_no") ?? "").trim().toUpperCase(),
      password,
      firstName: String(values.get("first_name") ?? ""),
      lastName: String(values.get("last_name") ?? ""),
      departmentId: String(values.get("department_id") ?? ""),
      roleId: String(values.get("role_id") ?? ""),
      jobTitle: String(values.get("job_title") ?? ""),
      email: String(values.get("email") ?? ""),
      phone: String(values.get("phone") ?? ""),
      reason: String(values.get("reason") ?? ""),
    });
    state.authMode = "login";
    await renderAuth(`<div class="form-message success">ส่งคำร้องเรียบร้อยแล้ว ผู้ดูแลระบบจะตรวจสอบและอนุมัติสิทธิ์ เมื่ออนุมัติแล้วจึงเข้าสู่ระบบด้วย ID และรหัสผ่านที่กรอกไว้ได้</div>`);
  } catch (error) {
    message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(error))}</div>`;
    setFormBusy(form, false);
  }
}

// Supabase เพิกถอน session ทั้งหมดของผู้ใช้เมื่อรหัสผ่านถูกเปลี่ยนผ่าน Admin API
// ถ้าเป็นบัญชีของตัวเอง ต้องออกจากระบบแล้วเข้าใหม่ ไม่เช่นนั้น token เดิมจะใช้กับ
// บาง API ไม่ได้อีกจนกว่าจะหมดอายุ
async function forceReLogin(message) {
  try {
    await sb.auth.signOut();
  } catch (error) {
    console.error(error);
  }
  state.session = null;
  state.employee = null;
  state.unread = 0;
  state.authMode = "login";
  await renderAuth(`<div class="form-message success">${escapeHtml(message)}</div>`);
}

async function loadEmployee() {
  if (!state.session?.user) return null;
  const { data, error } = await sb
    .from("employees")
    .select("id,employee_no,first_name,last_name,email,phone,job_title,department_id,role_id,manager_id,role:roles(code,name_th),department:departments(code,name_th)")
    .eq("auth_user_id", state.session.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน");
  const { data: modulesData, error: modulesError } = await sb.rpc("app_my_approval_modules");
  if (modulesError) throw modulesError;
  state.employee = {
    ...data,
    role: relation(data.role),
    department: relation(data.department),
    approvalModules: new Set((modulesData ?? []).map((item) => item.code)),
  };
  return state.employee;
}

async function loadUnread() {
  if (!state.employee) return 0;
  const { count } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", state.employee.id)
    .is("read_at", null);
  state.unread = count ?? 0;
  return state.unread;
}

const NAV_ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/></svg>`,
  requests: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>`,
  new: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  approvals: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>`,
  notifications: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.7.6 1 .27.25.62.4 1 .4h.1v4H21a1.7 1.7 0 0 0-1.6.6Z"/></svg>`,
  profile: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
};

function navLink(path, label, icon, active, { featured = false, badge = 0 } = {}) {
  const isActive = active === path;
  const badgeText = badge > 99 ? "99+" : badge;
  return `<a class="nav-link${isActive ? " active" : ""}${featured ? " nav-create" : ""}" href="#/${path}" aria-label="${escapeHtml(label)}"${isActive ? ` aria-current="page"` : ""}>
    <span class="nav-icon-wrap"><span class="nav-icon">${icon}</span>${badge ? `<span class="nav-count" aria-label="${badgeText} รายการใหม่">${badgeText}</span>` : ""}</span>
    <span class="nav-text">${escapeHtml(label)}</span>
  </a>`;
}

function shell(content, active, title) {
  const employee = state.employee;
  return `
    <div class="app-shell">
      <button class="mobile-nav-toggle" type="button" aria-label="เปิดเมนูหลัก" aria-controls="mobile-nav" aria-expanded="false">
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        <svg class="close-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
      <aside class="sidebar" id="mobile-nav">
        <a class="brand" href="#/dashboard"><div class="brand-mark">M</div><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></a>
        <nav class="nav" aria-label="เมนูหลัก">
          <div class="nav-label">Workspace</div>
          ${navLink("dashboard", "หน้าหลัก", NAV_ICONS.dashboard, active)}
          ${navLink("requests", OPERATE_ROLE_CODES.includes(employee.role?.code) ? "งานดำเนินการ" : "คำร้อง", NAV_ICONS.requests, active)}
          ${navLink("new", "สร้างคำร้อง", NAV_ICONS.new, active, { featured: true })}
          ${navLink("approvals", "รออนุมัติ", NAV_ICONS.approvals, active)}
          ${navLink("notifications", "การแจ้งเตือน", NAV_ICONS.notifications, active, { badge: state.unread })}
          <div class="nav-divider"></div>
          ${employee.role?.code === "admin" ? navLink("admin", "ผู้ดูแลระบบ", NAV_ICONS.admin, active) : ""}
          ${navLink("profile", "ข้อมูลส่วนตัว", NAV_ICONS.profile, active)}
        </nav>
        <div class="nav-spacer"></div>
        <div class="sidebar-user">
          <div class="avatar">${escapeHtml(initials(employee))}</div>
          <div class="user-copy"><strong>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</strong><span>${escapeHtml(employee.job_title ?? employee.role?.name_th ?? "พนักงานทั่วไป")}</span></div>
          <button class="icon-button signout-button" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ">↪</button>
        </div>
      </aside>
      <button class="nav-backdrop" type="button" tabindex="-1" aria-label="ปิดเมนูหลัก"></button>
      <main class="main">
        <header class="topbar">
          <div class="breadcrumbs">MNP Workspace &nbsp;/&nbsp; <strong>${escapeHtml(title)}</strong></div>
          <div class="top-actions">
            ${themeButton()}
            <a class="icon-button notification-link" href="#/notifications" aria-label="การแจ้งเตือน">♧${state.unread ? `<span class="notification-count">${state.unread}</span>` : ""}</a>
            <a class="btn small" href="#/new">＋ สร้างคำร้อง</a>
          </div>
        </header>
        <div class="content">${content}</div>
      </main>
    </div>`;
}

function bindShell() {
  const shellNode = document.querySelector(".app-shell");
  const navToggle = document.querySelector(".mobile-nav-toggle");
  const navBackdrop = document.querySelector(".nav-backdrop");
  const setMobileNav = (open) => {
    shellNode?.classList.toggle("nav-open", open);
    navToggle?.setAttribute("aria-expanded", String(open));
    navToggle?.setAttribute("aria-label", open ? "ปิดเมนูหลัก" : "เปิดเมนูหลัก");
  };
  navToggle?.addEventListener("click", () => setMobileNav(!shellNode?.classList.contains("nav-open")));
  navBackdrop?.addEventListener("click", () => setMobileNav(false));
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => setMobileNav(false)));
  document.onkeydown = (event) => {
    if (event.key === "Escape") setMobileNav(false);
  };
  document.querySelector(".theme-toggle")?.addEventListener("click", toggleTheme);
  document.querySelector(".signout-button")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    state.session = null;
    state.employee = null;
    location.hash = "";
    await renderAuth();
  });
}

function loadingShell(active, title) {
  app.innerHTML = shell(`<div class="empty">กำลังโหลดข้อมูล…</div>`, active, title);
  bindShell();
}

async function getPendingApprovals() {
  const { data, error } = await sb
    .from("approval_steps")
    .select("id,request_id,step_order,step_name,approver_employee_id,approver_role_id,approver_department_id,status,created_at,request:requests!inner(id,request_no,title,description,priority,status,current_step,created_at,submitted_at,requester_id,request_type:request_types(name_th,code))")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const employee = state.employee;
  return (data ?? []).map((item) => ({ ...item, request: { ...relation(item.request), request_type: relation(relation(item.request)?.request_type) } })).filter((step) => {
    const request = step.request;
    if (!request?.id || step.step_order !== request.current_step) return false;
    // เฉพาะ admin จริงเท่านั้นที่ข้ามได้ ต้องตรงกับ app_approval_decision เป๊ะ — เดิมรวม
    // factory_manager/general_manager ด้วย ทำให้เห็นปุ่มอนุมัติของขั้นที่ไม่ใช่ของตัวเอง
    if (employee.role?.code === "admin") return true;
    if (step.approver_employee_id && step.approver_employee_id === employee.id) return true;
    const roleMatches = Boolean(step.approver_role_id) && step.approver_role_id === employee.role_id &&
      (!step.approver_department_id || step.approver_department_id === employee.department_id);
    return roleMatches && Boolean(request.request_type?.code) && employee.approvalModules.has(request.request_type.code);
  });
}

const MY_REPAIR_ACTION_STATUSES = ["pending_assign", "assigned", "in_progress", "pending_verify"];
const myRepairActionLabels = {
  pending_assign: "รอมอบหมายช่าง",
  assigned: "รอเริ่มงาน",
  in_progress: "รอบันทึกผลซ่อม",
  pending_verify: "รอตรวจรับ",
};

// งานซ่อมที่ต้องลงมือทำเอง (มอบหมายช่าง/เริ่มงาน/บันทึกผลซ่อม/ตรวจรับ) ไม่มี approval_steps รองรับ
// เพราะผ่านขั้นอนุมัติไปแล้ว — getPendingApprovals เดิมนับแต่ approval_steps จึงมองไม่เห็นงานกลุ่มนี้เลย
// ทำให้ช่างที่ถูกมอบหมายงานแล้ว หรือหัวหน้าแผนกที่ต้องมอบหมายช่าง ไม่เห็นงานของตัวเองใน "งานที่ต้องจัดการ"
async function getMyRepairActionItems() {
  const employee = state.employee;
  const { data, error } = await sb
    .from("requests")
    .select("id,request_no,title,status,priority,created_at,requester_id,assignee_id,request_type:request_types(name_th,owning_department_id),request_technicians(technician_id)")
    .in("status", MY_REPAIR_ACTION_STATUSES)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((item) => ({ ...item, request_type: relation(item.request_type) }))
    .filter((request) => {
      if (request.status === "pending_assign") {
        return employee.role?.code === "department_manager" && employee.department_id === request.request_type?.owning_department_id;
      }
      if (request.status === "pending_verify") return request.requester_id === employee.id;
      // assigned, in_progress — ช่างทุกคนในชุดต้องเห็นงานของตัวเอง ไม่ใช่เฉพาะคนแรก
      return request.assignee_id === employee.id
        || (request.request_technicians ?? []).some((row) => row.technician_id === employee.id);
    });
}

async function renderDashboard() {
  loadingShell("dashboard", "หน้าหลัก");
  const employee = state.employee;
  let requestsQuery = sb
    .from("requests")
    .select("id,request_no,title,description,status,priority,created_at,updated_at,needed_date,machine_code,machine_name,requester_id,assignee_id,request_type:request_types(name_th,uses_repair_workflow),request_technicians(technician_id)")
    .order("created_at", { ascending: false })
    .limit(20);
  // เดิมกรอง requester_id ทิ้งเหมือนหน้าคำร้อง ทำให้การ์ดสรุปและ "ความเคลื่อนไหวล่าสุด"
  // ของหัวหน้าแผนก/ช่างเป็นศูนย์ทั้งหน้า — ปล่อยให้ RLS เป็นตัวตัดสินเหมือนกัน
  const [requestsResult, typesResult, pending, repairTasks, directory] = await Promise.all([
    requestsQuery,
    sb.from("request_types").select("id,code,name_th,description").eq("is_active", true).in("code", REQUEST_MODULE_CODES).order("sort_order").limit(5),
    getPendingApprovals(),
    getMyRepairActionItems(),
    loadEmployeeDirectory(),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (typesResult.error) throw typesResult.error;
  const requests = requestsResult.data ?? [];
  const inProgress = requests.filter((item) => ["approved", "in_progress"].includes(item.status)).length;
  const completed = requests.filter((item) => item.status === "completed").length;
  const actionableCount = pending.length + repairTasks.length;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Pilot workspace</div><h1>สวัสดี, ${escapeHtml(employee.first_name)}</h1><p>ภาพรวมรายการที่เกี่ยวข้องกับคุณและงานที่ต้องดำเนินการ</p></div><span class="muted small">${formatDate(new Date(), false)}</span></div>
    <section class="summary-grid">
      <a class="summary" href="#/approvals"><span>งานที่ต้องจัดการ</span><strong>${actionableCount}</strong><small>${actionableCount ? "มีรายการที่ต้องดำเนินการ" : "ไม่มีงานค้าง"}</small></a>
      <div class="summary"><span>รายการที่มองเห็น</span><strong>${requests.length}</strong><small>ตามสิทธิ์ของบัญชีนี้</small></div>
      <div class="summary"><span>กำลังดำเนินการ</span><strong>${inProgress}</strong><small>อนุมัติแล้วหรือกำลังทำ</small></div>
      <div class="summary"><span>เสร็จแล้ว</span><strong>${completed}</strong><small>ปิดงานเรียบร้อย</small></div>
    </section>
    <div class="dashboard-grid">
      <section class="card flush"><div class="card-heading"><h2>ความเคลื่อนไหวล่าสุด</h2><a href="#/requests">ดูทั้งหมด →</a></div>${requestRows(requests.slice(0, 7), { directory })}</section>
      <section class="card flush"><div class="card-heading"><h2>สร้างคำร้อง</h2><a href="#/new">ทุกประเภท →</a></div><div class="quick-list">${(typesResult.data ?? []).map((type) => `<a class="quick-link" href="#/new?type=${encodeURIComponent(type.id)}"><span class="quick-icon">＋</span><span><strong>${escapeHtml(type.name_th)}</strong><small>${escapeHtml(type.description ?? "")}</small></span><span>›</span></a>`).join("")}</div></section>
    </div>`;
  app.innerHTML = shell(content, "dashboard", "หน้าหลัก");
  bindShell();
}

const REQUEST_STATUS_FILTERS = [
  ["all", "ทั้งหมด"],
  ["pending_approval", "รออนุมัติ"],
  ["approved", "อนุมัติแล้ว"],
  ["pending_assign", "รอมอบหมายช่าง"],
  ["assigned", "รอดำเนินการ"],
  ["in_progress", "กำลังดำเนินการ"],
  ["pending_verify", "รอตรวจรับ"],
  ["completed", "เสร็จแล้ว"],
  ["rejected", "ไม่อนุมัติ"],
];

function requestsViewTabs(view, status, search) {
  const query = (nextView) => {
    const parts = [];
    if (nextView === "board") parts.push("view=board");
    if (status !== "all") parts.push(`status=${encodeURIComponent(status)}`);
    if (nextView === "board" && search) parts.push(`q=${encodeURIComponent(search)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };
  return `<div class="view-tabs" role="tablist">
    <a class="view-tab${view === "board" ? "" : " active"}" role="tab" aria-selected="${view === "board" ? "false" : "true"}" href="#/requests${query("mine")}">รายการตามสิทธิ์</a>
    <a class="view-tab${view === "board" ? " active" : ""}" role="tab" aria-selected="${view === "board" ? "true" : "false"}" href="#/requests${query("board")}">ติดตามสถานะทุกใบ</a>
  </div>`;
}

function statusFilterBar(view, status, search) {
  const suffix = (value) => {
    const parts = [];
    if (view === "board") parts.push("view=board");
    if (value !== "all") parts.push(`status=${encodeURIComponent(value)}`);
    if (view === "board" && search) parts.push(`q=${encodeURIComponent(search)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };
  return `<div class="filters">${REQUEST_STATUS_FILTERS
    .map(([value, label]) => `<a class="filter${status === value ? " active" : ""}" href="#/requests${suffix(value)}">${label}</a>`)
    .join("")}</div>`;
}

/* กระดานติดตามสถานะ — พนักงานทุกคนเปิดดูได้ว่าแต่ละใบเดินไปถึงขั้นไหนแล้ว สิทธิ์การเปิดดู
   รายละเอียดเต็มยังเป็นของเดิมทุกประการ (RLS ในหน้า #/request) ที่นี่แค่ทำให้ "สถานะ" โปร่งใส */
async function renderRequestsBoard(status, search) {
  const { data, error } = await sb.rpc("app_request_status_board", {
    p_status: status === "all" ? null : status,
    p_search: search || null,
    p_limit: 300,
  });
  if (error) throw error;
  const rows = data ?? [];
  const openable = rows.filter((row) => row.can_open).length;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Request Center</div><h1>ติดตามสถานะทุกใบ</h1><p>ทุกคนในองค์กรเห็นได้ว่าใบแจ้งซ่อมและคำร้องแต่ละใบเดินไปถึงขั้นไหนแล้ว</p></div><a class="btn" href="#/new">＋ สร้างคำร้อง</a></div>
    ${requestsViewTabs("board", status, search)}
    ${statusFilterBar("board", status, search)}
    <form class="board-search" id="board-search-form" role="search">
      <input class="input" id="board-search-input" name="q" type="search" maxlength="80" placeholder="ค้นหาเลขที่ใบ ชื่อ/รหัสเครื่องจักร ผู้แจ้ง หรือแผนก" value="${escapeHtml(search)}">
      <button class="btn secondary small" type="submit">ค้นหา</button>
      ${search ? `<a class="btn secondary small" href="#/requests?view=board${status === "all" ? "" : `&status=${encodeURIComponent(status)}`}">ล้าง</a>` : ""}
    </form>
    <p class="muted small board-note">แสดง ${rows.length} รายการ · เปิดดูรายละเอียดเต็มได้ ${openable} รายการตามสิทธิ์ของบัญชีนี้ ส่วนใบที่เหลือเห็นได้เฉพาะความคืบหน้า</p>
    <section class="request-list-panel">${statusBoardRows(rows)}</section>`;
  app.innerHTML = shell(content, "requests", "ติดตามสถานะทุกใบ");
  bindShell();
  document.querySelector("#board-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = document.querySelector("#board-search-input")?.value.trim() ?? "";
    const parts = ["view=board"];
    if (status !== "all") parts.push(`status=${encodeURIComponent(status)}`);
    if (value) parts.push(`q=${encodeURIComponent(value)}`);
    location.hash = `#/requests?${parts.join("&")}`;
  });
}

async function renderRequests(params) {
  loadingShell("requests", "รายการคำร้อง");
  const status = params.get("status") ?? "all";
  const search = (params.get("q") ?? "").trim();
  if (params.get("view") === "board") return await renderRequestsBoard(status, search);

  const role = state.employee.role?.code;
  const mineOnly = params.get("scope") === "mine";
  // ไม่กรอง requester_id ทิ้งอีกแล้ว — RLS เป็นตัวตัดสินว่าบัญชีนี้เห็นใบไหนได้ การกรองซ้ำ
  // ฝั่ง client ทำให้ "ใบที่รออนุมัติจากเราเอง" และ "ใบที่เราเป็นช่างผู้รับผิดชอบ" หายไปจาก
  // หน้านี้ทั้งหมด (หัวหน้าแผนกซ่อมบำรุงเปิดมาแล้วว่างเปล่าทั้งที่มีใบรออนุมัติค้างอยู่)
  let query = sb
    .from("requests")
    .select("id,request_no,title,description,status,priority,created_at,updated_at,needed_date,machine_code,machine_name,requester_id,assignee_id,requester_name,request_type:request_types(name_th,uses_repair_workflow),request_technicians(technician_id)")
    .order("created_at", { ascending: false });
  if (mineOnly) query = query.eq("requester_id", state.employee.id);
  if (status !== "all") query = query.eq("status", status);
  const [{ data, error }, directory] = await Promise.all([query, loadEmployeeDirectory()]);
  if (error) throw error;
  const title = mineOnly
    ? "คำร้องที่ฉันแจ้ง"
    : OPERATE_ROLE_CODES.includes(role) && !VIEW_ALL_ROLE_CODES.includes(role)
      ? "งานดำเนินการ"
      : (role === "admin" || VIEW_ALL_ROLE_CODES.includes(role)) ? "คำร้องทั้งหมด" : "คำร้องที่เกี่ยวข้องกับฉัน";
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Request Center</div><h1>${title}</h1><p>${mineOnly ? "เฉพาะใบที่คุณเป็นผู้แจ้งเอง" : "ใบที่คุณแจ้งเอง รออนุมัติจากคุณ หรือคุณเป็นผู้รับผิดชอบ"}</p></div><a class="btn" href="#/new">＋ สร้างคำร้อง</a></div>
    ${requestsViewTabs("mine", status, search)}
    <div class="scope-switch">
      <a class="filter${mineOnly ? "" : " active"}" href="#/requests${status === "all" ? "" : `?status=${encodeURIComponent(status)}`}">ทุกใบที่เกี่ยวข้องกับฉัน</a>
      <a class="filter${mineOnly ? " active" : ""}" href="#/requests?scope=mine${status === "all" ? "" : `&status=${encodeURIComponent(status)}`}">เฉพาะที่ฉันแจ้ง</a>
    </div>
    ${statusFilterBar("mine", status, search)}
    <section class="request-list-panel">${requestRows(data ?? [], { showProgress: true, showRequester: !mineOnly, directory })}</section>`;
  app.innerHTML = shell(content, "requests", title);
  bindShell();
}

function dynamicDetailFields(schema, values = {}) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  return fields.map((name) => {
    const dateField = name.includes("date");
    const numeric = name === "estimated_cost" || name === "odometer";
    return `<div class="field"><label for="detail-${escapeHtml(name)}">${escapeHtml(detailFieldLabels[name] ?? name)}</label><input class="input detail-field" id="detail-${escapeHtml(name)}" name="${escapeHtml(name)}" type="${dateField ? "date" : numeric ? "number" : "text"}" value="${escapeHtml(values[name] ?? "")}" maxlength="500"></div>`;
  }).join("");
}

// ส่วนที่ 3 ของฟอร์ม PP01-FM08 "สำเนาถึงแผนก" — ccDepartments คือ Map<code, {id,code}> จาก
// loadCcDepartments เช็คบ็อกซ์ผูก name="cc_department_ids" (เก็บ id ของแผนก) ช่อง "อื่นๆ" ใช้
// class detail-field เดียวกับ dynamicDetailFields จึงถูกเก็บลง details.cc_other_note อัตโนมัติ
function ccDepartmentGridHtml(ccDepartments) {
  const cells = CC_DEPARTMENT_GRID.flat().map((code) => {
    if (code === null) {
      return `<label class="cc-department-other"><span>อื่นๆ</span><input class="input detail-field" name="cc_other_note" placeholder="ระบุ" maxlength="200"></label>`;
    }
    const department = ccDepartments.get(code);
    if (!department) return "<span></span>";
    return `<label class="cc-department-option"><input type="checkbox" class="cc-department-checkbox" name="cc_department_ids" value="${escapeHtml(department.id)}"><span>${escapeHtml(code)}</span></label>`;
  }).join("");
  return `<div class="field full cc-department-field"><label>สำเนาถึงแผนก</label><div class="cc-department-grid">${cells}</div></div>`;
}

const requestTypeThemes = {
  MT_REPAIR: ["#fb7185", "#be123c"],
  IT_REPAIR: ["#60a5fa", "#1d4ed8"],
  VEHICLE_REPAIR: ["#fb923c", "#c2410c"],
  PURCHASE: ["#34d399", "#047857"],
  MANAGEMENT: ["#a78bfa", "#5b21b6"],
  IT_ACCESS: ["#22d3ee", "#0e7490"],
  HR_LEAVE: ["#f472b6", "#be185d"],
  HR_TRAINING: ["#fbbf24", "#b45309"],
  NCR_CAR: ["#facc15", "#a16207"],
};
const requestTypeLabelOverrides = {
  MT_REPAIR: "ใบคำร้อง/แจ้งซ่อม MT",
  MANAGEMENT: "ใบคำร้องถึงห้องบริหาร",
};

function requestTypeLabel(type) {
  return requestTypeLabelOverrides[type.code] ?? type.name_th;
}

function requestTypeGradient(code) {
  const [from, to] = requestTypeThemes[code] ?? ["#60a5fa", "#1d4ed8"];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function typeCardHtml(type) {
  return `
    <button type="button" class="type-card" data-type-id="${escapeHtml(type.id)}" style="background:${requestTypeGradient(type.code)}">
      <span class="type-card-badge">${escapeHtml(type.prefix ?? "")}</span>
      <span class="type-card-body"><strong>${escapeHtml(requestTypeLabel(type))}</strong><small>${escapeHtml(type.description ?? "")}</small></span>
    </button>`;
}

async function renderNewRequest(params) {
  loadingShell("new", "สร้างคำร้อง");
  const { data: types, error } = await sb
    .from("request_types")
    .select("id,code,prefix,name_th,description,form_schema,uses_repair_workflow")
    .eq("is_active", true)
    .in("code", REQUEST_MODULE_CODES)
    .order("sort_order");
  if (error) throw error;
  const employee = state.employee;

  let departments = null;
  let machines = null;
  let ccDepartments = null;
  async function loadCcDepartments() {
    if (ccDepartments) return;
    const { data, error: ccError } = await sb.from("departments").select("id,code").eq("is_active", true);
    if (ccError) throw ccError;
    ccDepartments = new Map((data ?? []).map((item) => [item.code, item]));
  }
  async function loadRepairLookups() {
    if (departments) return;
    const [departmentsResult, machinesResult] = await Promise.all([
      sb.from("departments").select("id,code,name_th").eq("is_active", true).eq("is_repair_site", true).order("code"),
      sb.from("machines").select("id,code,name,department_id,is_placeholder").eq("is_active", true).order("sort_order"),
    ]);
    if (departmentsResult.error) throw departmentsResult.error;
    if (machinesResult.error) throw machinesResult.error;
    const availableDepartments = new Map((departmentsResult.data ?? []).map((item) => [item.code, item]));
    departments = REPAIR_DEPARTMENT_OPTIONS
      .map((option) => ({ ...availableDepartments.get(option.sourceCode), ...option }))
      .filter((item) => item.id);
    machines = machinesResult.data ?? [];
  }
  const machineLabel = (machine) => machine.is_placeholder ? machine.code : `${machine.code} — ${machine.name}`;

  const requestedType = params.get("type");
  let selectedId = requestedType && (types ?? []).some((type) => type.id === requestedType) ? requestedType : "";

  async function paint() {
    const selected = (types ?? []).find((type) => type.id === selectedId) ?? null;
    const heading = selected
      ? `<div class="page-heading"><div><div class="eyebrow">New request</div><h1>${escapeHtml(requestTypeLabel(selected))}</h1><p>${escapeHtml(selected.description || "กรอกรายละเอียดให้ครบถ้วน ระบบจะส่งเข้าสายอนุมัติให้อัตโนมัติ")}</p></div><button type="button" class="btn secondary" id="change-type-button">‹ เปลี่ยนประเภท</button></div>`
      : `<div class="page-heading"><div><div class="eyebrow">New request</div><h1>สร้างคำร้องใหม่</h1><p>เลือกประเภทคำร้องที่ต้องการ ระบบจะสร้างลำดับอนุมัติให้อัตโนมัติ</p></div></div>`;

    let body;
    if (!selected) {
      body = `<div class="type-grid">${(types ?? []).map((type) => typeCardHtml(type)).join("")}</div>`;
    } else if (selected.uses_repair_workflow) {
      await loadRepairLookups();
      body = `
        <section class="card" style="max-width:900px;margin:auto"><div id="request-message"></div><form id="repair-form">
          <div class="field full">
            <label>แผนก</label>
            <input type="hidden" id="repair-department" name="department_id" required>
            <div class="repair-department-grid" id="repair-department-picker">${departments.map((item) => `<button type="button" class="repair-department-card" data-dept="${escapeHtml(item.id)}" data-dept-code="${escapeHtml(item.sourceCode)}" aria-pressed="false"><strong>${escapeHtml(item.displayCode)}</strong><span>${escapeHtml(item.name)}</span></button>`).join("")}</div>
          </div>
          <div class="form-grid">
            <div class="field full">
              <label for="repair-machine-search">เครื่องจักร</label>
              <input type="hidden" id="repair-machine" name="machine_id" required>
              <div class="machine-combobox" id="repair-machine-combobox">
                <input class="input machine-search-input" id="repair-machine-search" type="search" placeholder="เลือกแผนกก่อน" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="repair-machine-list" aria-expanded="false" disabled>
                <span class="machine-search-icon" aria-hidden="true">⌕</span>
                <div class="machine-listbox" id="repair-machine-list" role="listbox" hidden></div>
              </div>
              <small>ค้นหาด้วยรหัสหรือชื่อเครื่องจักร แล้วเลือกจากรายการ</small>
            </div>
            <div class="field full">
              <label>ประเภทเอกสาร</label>
              <input type="hidden" id="repair-doc-type" name="doc_type" value="repair" required>
              <div class="filters" id="repair-doctype-picker">
                <button type="button" class="filter active" data-doctype="repair">${escapeHtml(docTypeLabels.repair)}</button>
                <button type="button" class="filter" data-doctype="request">${escapeHtml(docTypeLabels.request)}</button>
              </div>
            </div>
            <div class="field full"><label for="repair-description">รายละเอียด</label><textarea class="textarea" id="repair-description" name="description" minlength="3" maxlength="5000" required></textarea></div>
            <div class="field full"><label for="repair-attachment">ไฟล์แนบ (ถ้ามี)</label><input class="input" id="repair-attachment" name="attachment" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,.xlsx"><small>สูงสุด 10 MB · JPG, PNG, WebP, PDF, TXT, DOCX, XLSX</small></div>
            <div class="field"><label for="repair-needed-date">วันที่ต้องการใช้งาน (ถ้ามี)</label><input class="input" id="repair-needed-date" name="needed_date" type="date"></div>
            <div class="field"><label for="repair-requester-name">ชื่อผู้แจ้ง</label><input class="input" id="repair-requester-name" name="requester_name" maxlength="120" value="${escapeHtml(`${employee.first_name} ${employee.last_name}`)}"></div>
            <div class="field full"><label class="checkbox-label"><input type="checkbox" id="repair-urgent" name="is_urgent"> แจ้งด่วน</label></div>
            <div class="field full"><div class="muted small" id="repair-doc-number">เลขที่เอกสาร: เลือกแผนกเพื่อดูเลขที่โดยประมาณ</div></div>
          </div>
          <div class="form-actions"><a class="btn secondary" href="#/requests">ยกเลิก</a><button class="btn" type="submit">ส่งใบแจ้งซ่อม</button></div>
        </form></section>`;
    } else {
      const isManagement = selected.code === "MANAGEMENT";
      if (isManagement) await loadCcDepartments();
      body = `
        <section class="card" style="max-width:900px;margin:auto"><div id="request-message"></div><form id="request-form">
          <div class="form-grid">
            <div class="field full"><label for="title">หัวข้อ</label><input class="input" id="title" name="title" minlength="3" maxlength="200" required></div>
            <div class="field full"><label for="description">รายละเอียด</label><textarea class="textarea" id="description" name="description" minlength="3" maxlength="5000" required></textarea></div>
            <div class="field full"><label for="attachment">ไฟล์แนบ (ถ้ามี)</label><input class="input" id="attachment" name="attachment" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,.xlsx"><small>สูงสุด 10 MB · JPG, PNG, WebP, PDF, TXT, DOCX, XLSX</small></div>
            <div class="field"><label for="priority">ความสำคัญ</label><select class="select" id="priority" name="priority"><option value="low">ต่ำ</option><option value="normal" selected>ปกติ</option><option value="high">สูง</option><option value="urgent">เร่งด่วน</option></select></div>
            <div></div><div class="field full"><div class="form-grid">${dynamicDetailFields(selected.form_schema)}</div></div>
          </div>
          ${isManagement ? ccDepartmentGridHtml(ccDepartments) : ""}
          <div class="form-actions"><a class="btn secondary" href="#/requests">ยกเลิก</a><button class="btn" type="submit">ส่งคำร้อง</button></div>
        </form></section>`;
    }

    app.innerHTML = shell(`${heading}${body}`, "new", "สร้างคำร้อง");
    bindShell();
    bindStep(selected);
  }

  function bindStep(selected) {
    document.querySelectorAll(".type-card").forEach((card) => card.addEventListener("click", () => {
      selectedId = card.dataset.typeId;
      paint();
    }));
    document.querySelector("#change-type-button")?.addEventListener("click", () => {
      selectedId = "";
      paint();
    });
    if (!selected) return;

    if (selected.uses_repair_workflow) {
      const departmentInput = document.querySelector("#repair-department");
      const machineInput = document.querySelector("#repair-machine");
      const machineCombobox = document.querySelector("#repair-machine-combobox");
      const machineSearch = document.querySelector("#repair-machine-search");
      const machineList = document.querySelector("#repair-machine-list");
      const docTypeInput = document.querySelector("#repair-doc-type");
      const docNumberNode = document.querySelector("#repair-doc-number");
      let selectedDepartmentId = "";
      let visibleMachines = [];
      let activeMachineIndex = -1;

      const closeMachineList = () => {
        machineList.hidden = true;
        machineSearch.setAttribute("aria-expanded", "false");
        machineSearch.removeAttribute("aria-activedescendant");
        activeMachineIndex = -1;
      };

      const setActiveMachine = (index) => {
        const options = [...machineList.querySelectorAll(".machine-option")];
        if (!options.length) return;
        activeMachineIndex = (index + options.length) % options.length;
        options.forEach((option, optionIndex) => option.setAttribute("aria-selected", String(optionIndex === activeMachineIndex)));
        const activeOption = options[activeMachineIndex];
        machineSearch.setAttribute("aria-activedescendant", activeOption.id);
        activeOption.scrollIntoView({ block: "nearest" });
      };

      const chooseMachine = (machine) => {
        machineInput.value = machine.id;
        machineSearch.value = machineLabel(machine);
        closeMachineList();
      };

      const renderMachineList = (query = "") => {
        const normalizedQuery = query.trim().toLocaleLowerCase("th-TH");
        visibleMachines = machines.filter((machine) => machine.department_id === selectedDepartmentId && (
          !normalizedQuery || `${machine.code} ${machine.name}`.toLocaleLowerCase("th-TH").includes(normalizedQuery)
        ));
        activeMachineIndex = -1;
        machineList.innerHTML = visibleMachines.length
          ? visibleMachines.map((machine, index) => `<button type="button" class="machine-option" id="repair-machine-option-${index}" role="option" aria-selected="false" data-machine-index="${index}"><strong>${escapeHtml(machine.code)}</strong>${machine.is_placeholder ? "" : `<span>${escapeHtml(machine.name)}</span>`}</button>`).join("")
          : `<div class="machine-empty">ไม่พบเครื่องจักรที่ค้นหา</div>`;
        machineList.hidden = false;
        machineSearch.setAttribute("aria-expanded", "true");
      };

      machineSearch.addEventListener("focus", () => {
        if (selectedDepartmentId) renderMachineList(machineInput.value ? "" : machineSearch.value);
      });
      machineSearch.addEventListener("input", () => {
        machineInput.value = "";
        renderMachineList(machineSearch.value);
      });
      machineSearch.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { closeMachineList(); return; }
        if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
        event.preventDefault();
        if (machineList.hidden) renderMachineList(machineInput.value ? "" : machineSearch.value);
        if (event.key === "ArrowDown") setActiveMachine(activeMachineIndex + 1);
        if (event.key === "ArrowUp") setActiveMachine(activeMachineIndex - 1);
        if (event.key === "Enter" && activeMachineIndex >= 0) chooseMachine(visibleMachines[activeMachineIndex]);
      });
      machineList.addEventListener("click", (event) => {
        const option = event.target.closest("[data-machine-index]");
        if (!option) return;
        machineSearch.focus();
        chooseMachine(visibleMachines[Number(option.dataset.machineIndex)]);
      });
      machineCombobox.addEventListener("focusout", (event) => {
        if (!machineCombobox.contains(event.relatedTarget)) closeMachineList();
      });

      document.querySelectorAll("#repair-department-picker [data-dept]").forEach((button) => button.addEventListener("click", async () => {
        document.querySelectorAll("#repair-department-picker [data-dept]").forEach((node) => {
          node.classList.remove("active");
          node.setAttribute("aria-pressed", "false");
        });
        button.classList.add("active");
        button.setAttribute("aria-pressed", "true");
        const departmentId = button.dataset.dept;
        departmentInput.value = departmentId;
        selectedDepartmentId = departmentId;
        machineInput.value = "";
        machineSearch.value = "";
        machineSearch.disabled = false;
        machineSearch.placeholder = "ค้นหารหัสหรือชื่อเครื่องจักร";
        machineSearch.focus();
        renderMachineList();
        docNumberNode.textContent = "เลขที่เอกสาร: กำลังตรวจสอบ…";
        try {
          const { data, error: peekError } = await sb.rpc("app_peek_repair_doc_number", { p_department_id: departmentId });
          if (peekError) throw peekError;
          docNumberNode.textContent = `เลขที่เอกสาร (โดยประมาณ): ${data}`;
        } catch (peekError) {
          docNumberNode.textContent = "เลขที่เอกสาร: ระบบจะออกให้ตอนส่งใบ";
        }
      }));

      document.querySelectorAll("#repair-doctype-picker [data-doctype]").forEach((button) => button.addEventListener("click", () => {
        document.querySelectorAll("#repair-doctype-picker [data-doctype]").forEach((node) => node.classList.remove("active"));
        button.classList.add("active");
        docTypeInput.value = button.dataset.doctype;
      }));

      document.querySelector("#repair-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.querySelector("#request-message");
        message.innerHTML = "";
        if (!departmentInput.value) { message.innerHTML = `<div class="form-message error">กรุณาเลือกแผนก</div>`; return; }
        if (!machineInput.value) { message.innerHTML = `<div class="form-message error">กรุณาเลือกเครื่องจักรจากรายการ</div>`; machineSearch.focus(); return; }
        const values = new FormData(form);
        let attachment;
        try {
          attachment = optionalAttachment(values.get("attachment"));
        } catch (attachmentError) {
          message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(attachmentError))}</div>`;
          return;
        }
        setFormBusy(form, true);
        try {
          const { data, error: createError } = await sb.rpc("app_create_repair_request", {
            p_department_id: departmentInput.value,
            p_machine_id: String(values.get("machine_id") ?? ""),
            p_doc_type: docTypeInput.value,
            p_description: String(values.get("description") ?? "").trim(),
            p_is_urgent: form.querySelector("#repair-urgent").checked,
            p_needed_date: String(values.get("needed_date") ?? "") || null,
            p_requester_name: String(values.get("requester_name") ?? "").trim() || null,
          });
          if (createError) throw createError;
          triggerNotificationEmails(data);
          if (attachment) {
            try {
              await uploadRequestAttachment(data, attachment, employee.id);
            } catch {
              showToast(`สร้างคำร้องแล้ว แต่แนบไฟล์ไม่สำเร็จ · กรุณาแนบใหม่ในหน้ารายละเอียด`, "error");
              go(`request?id=${encodeURIComponent(data)}`);
              return;
            }
          }
          showToast(attachment ? "ส่งใบแจ้งซ่อมและแนบไฟล์สำเร็จ" : "ส่งใบแจ้งซ่อมสำเร็จ");
          go(`request?id=${encodeURIComponent(data)}`);
        } catch (submitError) {
          message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(submitError))}</div>`;
          setFormBusy(form, false);
        }
      });
      return;
    }

    document.querySelector("#request-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      let attachment;
      try {
        attachment = optionalAttachment(values.get("attachment"));
      } catch (attachmentError) {
        document.querySelector("#request-message").innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(attachmentError))}</div>`;
        return;
      }
      const details = {};
      form.querySelectorAll(".detail-field").forEach((input) => { if (input.value.trim()) details[input.name] = input.value.trim(); });
      const ccDepartmentIds = [...form.querySelectorAll(".cc-department-checkbox:checked")].map((input) => input.value);
      setFormBusy(form, true);
      try {
        const { data, error: createError } = await sb.rpc("app_create_request", {
          p_type_id: selected.id,
          p_title: String(values.get("title") ?? "").trim(),
          p_description: String(values.get("description") ?? "").trim(),
          p_priority: values.get("priority"),
          p_details: details,
          p_cc_department_ids: ccDepartmentIds,
        });
        if (createError) throw createError;
        triggerNotificationEmails(data);
        if (attachment) {
          try {
            await uploadRequestAttachment(data, attachment, employee.id);
          } catch {
            showToast("สร้างคำร้องแล้ว แต่แนบไฟล์ไม่สำเร็จ · กรุณาแนบใหม่ในหน้ารายละเอียด", "error");
            go(`request?id=${encodeURIComponent(data)}`);
            return;
          }
        }
        showToast(attachment ? "สร้างคำร้องและแนบไฟล์สำเร็จ" : "สร้างคำร้องสำเร็จ");
        go(`request?id=${encodeURIComponent(data)}`);
      } catch (submitError) {
        document.querySelector("#request-message").innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(submitError))}</div>`;
        setFormBusy(form, false);
      }
    });
  }

  await paint();
}

// เดิมชื่อ loadDirectory() ซ้ำกับฟังก์ชันโหลดแผนกของหน้าขอเปิดบัญชี (บรรทัดข้างบน) —
// function declaration ชื่อซ้ำใน scope เดียวกัน ตัวหลังทับตัวแรกเสมอ ทำให้หน้าขอเปิดบัญชี
// เรียกฟังก์ชันนี้แทนโดยไม่ตั้งใจและ state.directory ไม่เคยถูกตั้งค่า (ดรอปดาวน์แผนกว่างเปล่า)
// เปลี่ยนชื่อให้ไม่ชนกันเพื่อแก้บั๊กนี้
async function loadEmployeeDirectory() {
  // เก็บผู้ใช้ที่ปิดใช้งานแล้วไว้ด้วย เพื่อให้ชื่อผู้ดำเนินการในประวัติเก่ายังแสดงได้ครบ
  const { data, error } = await sb.from("employees").select("id,first_name,last_name,job_title,role_id,department_id,is_active");
  if (error) throw error;
  return new Map((data ?? []).map((employee) => [employee.id, employee]));
}

function personName(directory, id) {
  const person = directory.get(id);
  return person ? `${person.first_name} ${person.last_name}` : "—";
}

// หมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องเลือกก่อนว่ารับของทันที หรือระบุวันที่คาดว่าจะมาส่ง (ไปตั้งไว้ที่
// หมุด "ของมาส่งเรียบร้อย" ที่เป็นคู่กันเสมอ — ดู app_assign_repair_technician) ส่วนหมุด "ของมาส่งเรียบร้อย"
// เอง ถ้ามีวันที่คาดว่าจะมาส่งรออยู่แล้ว ให้ทั้งกดว่าของมาส่งแล้ว หรือเลื่อนวันที่คาดว่าจะมาส่งใหม่ได้
// (pg_cron จะยิงอีเมลเตือนถามทุกวัน 16:00 น. ของวันที่คาดว่าจะมาส่งถ้ายังไม่ได้บันทึกว่าของมาส่งแล้ว)
function progressStepHtml(step, directory, canRecordProgress) {
  const mark = `<span class="progress-mark" aria-hidden="true">${step.done_on ? "✓" : "○"}</span>`;
  const title = `<strong>${escapeHtml(step.step_label)}</strong>`;

  if (step.done_on) {
    return `<div class="progress-step done">${mark}
      <div class="progress-copy">${title}<span class="muted small">${formatDate(step.done_on)}${step.recorded_by ? ` · ${escapeHtml(personName(directory, step.recorded_by))}` : ""}</span></div>
    </div>`;
  }

  const statusText = step.expected_on ? `คาดว่าจะมาส่ง ${formatDate(step.expected_on)}` : "ยังไม่บันทึก";

  if (!canRecordProgress) {
    return `<div class="progress-step">${mark}
      <div class="progress-copy">${title}<span class="muted small">${statusText}</span></div>
    </div>`;
  }

  if (step.step_key === "purchase_ordered") {
    return `<div class="progress-step">${mark}
      <div class="progress-copy">${title}<span class="muted small">ยังไม่บันทึก</span></div>
      <div class="progress-step-extra">
        <form class="progress-order-form" data-step="${escapeHtml(step.id)}">
          <div class="progress-choice">
            <label class="progress-choice-option"><input type="radio" name="receipt_mode" value="now" checked> รับของทันที (ได้ของพร้อมสั่งซื้อ)</label>
            <label class="progress-choice-option"><input type="radio" name="receipt_mode" value="later"> ระบุวันที่คาดว่าของจะมาส่ง</label>
          </div>
          <input class="input progress-expected-input" type="date" name="expected_on" disabled>
          <div class="form-actions"><button class="btn warning small" type="submit">บันทึก</button></div>
        </form>
      </div>
    </div>`;
  }

  if (step.step_key === "purchase_received" && step.expected_on) {
    return `<div class="progress-step">${mark}
      <div class="progress-copy">${title}<span class="muted small">${statusText}</span></div>
      <button type="button" class="btn warning small progress-button" data-step="${escapeHtml(step.id)}">ของมาส่งแล้ว</button>
      <div class="progress-step-extra">
        <button type="button" class="btn secondary small progress-reschedule-toggle" data-step="${escapeHtml(step.id)}">ของยังไม่มา เลื่อนวันที่คาดว่าจะมาส่ง</button>
        <form class="progress-reschedule-form hidden" data-step="${escapeHtml(step.id)}">
          <input class="input" type="date" name="expected_on" required>
          <button class="btn small" type="submit">บันทึกวันที่ใหม่</button>
        </form>
      </div>
    </div>`;
  }

  return `<div class="progress-step">${mark}
    <div class="progress-copy">${title}<span class="muted small">ยังไม่บันทึก</span></div>
    <button type="button" class="btn warning small progress-button" data-step="${escapeHtml(step.id)}">บันทึกวันนี้</button>
  </div>`;
}

const repairTimelineStatusLabels = {
  ...statusLabels,
  pending_approval: "รออนุมัติ",
  more_info: "ต้องการข้อมูลเพิ่มเติม",
  in_progress: "กำลังซ่อม",
  pending_verify: "รอผู้แจ้งตรวจสอบผลการซ่อม",
  completed: "ซ่อมเรียบร้อย",
};

function closestTimelineRecord(records, createdAt, predicate = () => true) {
  const target = Date.parse(createdAt);
  if (!Number.isFinite(target)) return null;
  const [closest] = records
    .filter(predicate)
    .map((record) => ({ record, distance: Math.abs(Date.parse(record.acted_at ?? record.created_at) - target) }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((left, right) => left.distance - right.distance);
  return closest && closest.distance <= 60_000 ? closest.record : null;
}

function closestCreatedTimelineRecord(records, createdAt, predicate = () => true) {
  const target = Date.parse(createdAt);
  if (!Number.isFinite(target)) return null;
  const [closest] = records
    .filter(predicate)
    .map((record) => ({ record, distance: Math.abs(Date.parse(record.created_at) - target) }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((left, right) => left.distance - right.distance);
  return closest && closest.distance <= 60_000 ? closest.record : null;
}

function appendTimelineNote(detail, note) {
  const cleanNote = String(note ?? "").trim();
  if (!cleanNote || detail.includes(cleanNote)) return detail;
  return detail ? `${detail} · ${cleanNote}` : cleanNote;
}

function buildRequestTimeline(request, history, steps, verifications, directory, isRepair) {
  const orderedSteps = [...steps].sort((left, right) => left.step_order - right.step_order);
  const latestRepairResult = [...history]
    .filter((item) => item.to_status === "pending_verify")
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  const labels = isRepair ? repairTimelineStatusLabels : statusLabels;

  const statusEvents = history.map((item) => {
    const actorName = personName(directory, item.changed_by);
    const actor = actorName === "—" ? "" : actorName;
    const matchingDecision = closestTimelineRecord(orderedSteps, item.created_at, (step) => {
      if (item.to_status === "more_info") return step.status === "more_info";
      if (item.to_status === "rejected") return step.status === "rejected";
      if (["approved", "pending_assign"].includes(item.to_status)) return step.status === "approved";
      return false;
    });
    const matchingVerification = closestTimelineRecord(verifications, item.created_at, (verification) => (
      (item.to_status === "completed" && verification.result === "pass")
      || (item.from_status === "pending_verify" && item.to_status === "assigned" && verification.result === "fail")
    ));

    let stage = matchingDecision?.step_name ?? "";
    if (item.to_status === "pending_approval") {
      if (item.from_status === "more_info") {
        stage = closestCreatedTimelineRecord(orderedSteps, item.created_at)?.step_name ?? "";
      } else {
        stage = orderedSteps[0]?.step_name ?? "";
      }
    }

    let detail = "";
    if (!item.from_status) {
      detail = `${item.note || (isRepair ? "สร้างใบแจ้งซ่อม" : "สร้างและส่งคำร้อง")}${actor ? ` โดย ${actor}` : ""}`;
    } else if (item.to_status === "more_info") {
      detail = `${actor || "ผู้อนุมัติ"} ขอข้อมูลเพิ่มเติม${matchingDecision?.comment ? `: ${matchingDecision.comment}` : ""}`;
    } else if (item.to_status === "rejected") {
      detail = `${actor || "ผู้อนุมัติ"} ไม่อนุมัติ${stage ? ` ในขั้น ${stage}` : ""}${matchingDecision?.comment ? `: ${matchingDecision.comment}` : ""}`;
    } else if (item.to_status === "pending_approval" && item.from_status === "more_info") {
      detail = `${actor || "ผู้แจ้ง"} ส่งข้อมูลเพิ่มเติมเพื่อพิจารณาอีกครั้ง`;
    } else if (["approved", "pending_assign"].includes(item.to_status)) {
      detail = `${actor || "ผู้อนุมัติ"} อนุมัติ${stage ? `ขั้น ${stage}` : "คำร้อง"} แล้ว`;
    } else if (item.to_status === "assigned" && item.from_status === "pending_verify") {
      detail = `${actor || "ผู้แจ้ง"} ตรวจรับไม่ผ่าน ส่งกลับให้ ${personName(directory, request.assignee_id)} ซ่อมเพิ่มเติม`;
      if (matchingVerification?.note) detail = appendTimelineNote(detail, matchingVerification.note);
    } else if (item.to_status === "assigned") {
      detail = `${actor || "ผู้มอบหมาย"} มอบหมายงานให้ ${personName(directory, request.assignee_id)}`;
      if (request.work_expected_date) detail += ` (กำหนดเสร็จ ${formatDate(request.work_expected_date)})`;
    } else if (item.to_status === "in_progress") {
      detail = `${actor || "ผู้รับผิดชอบ"} ${isRepair ? "เริ่มดำเนินการซ่อม" : "รับงานและเริ่มดำเนินการ"}`;
    } else if (item.to_status === "pending_verify") {
      detail = `${actor || "ผู้รับผิดชอบ"} ซ่อมเสร็จสิ้น ส่งให้ผู้แจ้งตรวจสอบการใช้งาน`;
      if (latestRepairResult?.id === item.id) {
        if (request.execution_plan) detail += ` · การดำเนินงาน: ${executionPlanLabels[request.execution_plan] ?? request.execution_plan}`;
        if (request.cause_analysis) detail += ` · วิเคราะห์สาเหตุ: ${request.cause_analysis}`;
        if (request.inspector_opinion) detail += ` · ความเห็นผู้ตรวจสอบ: ${inspectorOpinionLabels[request.inspector_opinion] ?? request.inspector_opinion}`;
        if (request.parts_used) detail += ` · อะไหล่/วัสดุ: ${request.parts_used}`;
      }
    } else if (item.to_status === "completed" && item.from_status === "pending_verify") {
      detail = `${actor || "ผู้แจ้ง"} ตรวจรับผลการซ่อมแล้ว: ${verifyResultLabels[matchingVerification?.result] ?? "ผ่าน — ใช้งานได้ปกติ"}`;
      if (matchingVerification?.note) detail = appendTimelineNote(detail, matchingVerification.note);
    } else if (item.to_status === "completed") {
      detail = `${actor || "ผู้รับผิดชอบ"} ปิดงานว่าเสร็จแล้ว`;
    } else {
      const fromLabel = labels[item.from_status] ?? item.from_status;
      const toLabel = labels[item.to_status] ?? item.to_status;
      detail = `${actor || "ผู้ใช้งาน"} เปลี่ยนสถานะจาก ${fromLabel} เป็น ${toLabel}`;
    }

    return {
      id: `status-${item.id}`,
      at: item.created_at,
      title: `${labels[item.to_status] ?? item.to_status}${stage && ["pending_approval", "more_info", "rejected"].includes(item.to_status) ? ` (${stage})` : ""}`,
      detail: appendTimelineNote(detail, item.note),
    };
  });

  // การอนุมัติขั้นกลางไม่เปลี่ยน requests.status จึงไม่มีแถวใน status history
  // เติมจาก approval_steps เพื่อให้ลำดับเหตุการณ์ไม่ขาดช่วงก่อนถึงผู้อนุมัติขั้นถัดไป
  const approvalEvents = orderedSteps.flatMap((step, index) => {
    const nextStep = orderedSteps[index + 1];
    if (step.status !== "approved" || !step.acted_at || !nextStep) return [];
    const actorName = personName(directory, step.acted_by);
    let detail = `${actorName === "—" ? "ผู้อนุมัติ" : actorName} อนุมัติขั้น ${step.step_name} แล้ว`;
    if (step.comment) detail += `: ${step.comment}`;
    return [{
      id: `approval-${step.id}`,
      at: step.acted_at,
      title: `รออนุมัติ (${nextStep.step_name})`,
      detail,
    }];
  });

  return [...statusEvents, ...approvalEvents].sort((left, right) => left.at.localeCompare(right.at));
}

/* ---------- สำรองใบแจ้งซ่อมไปชีต Maintenance-MT เดิม ----------
   Supabase (requests + approval_steps + request_verifications) ยังเป็นแหล่งข้อมูลจริงและเป็น
   ตัวบังคับสิทธิ์/workflow ทั้งหมดเหมือนเดิมทุกประการ — ฟังก์ชันกลุ่มนี้แค่แปลงสถานะปัจจุบันของ
   ใบแจ้งซ่อมให้ตรงกับรูปแบบที่ Apps Script เดิม (mirrorKvWrite_ → syncOneOrderRow_) เข้าใจ แล้ว
   ยิง POST แบบ "ทำสำเร็จก็ดี ไม่สำเร็จก็ไม่บล็อกอะไร" เพื่อให้แท็บ "ใบแจ้งซ่อม" ในชีตเดิมมีข้อมูล
   ไว้ดู/รายงานคู่ขนานไปด้วย ไม่ใช่ทางเดินของข้อมูลจริง

   ตำแหน่งขั้นอนุมัติ step_order 1/2 → fm/gm ตรงกับระบบเดิมพอดีตั้งแต่ไมเกรชัน
   20260921080000 เป็นต้นไป: ขั้น 1 คือผู้จัดการโรงงาน ขั้น 2 คือผู้จัดการทั่วไป
   (ก่อนหน้านั้นเป็นหัวหน้าแผนกผู้แจ้ง → ผจก.แผนกเจ้าของเอกสาร ซึ่งไม่ตรงขั้นตอนจริง) */
function mapRepairAppsScriptStatus(request, steps) {
  if (request.status === "pending_approval") {
    return request.current_step >= 2 ? "PENDING_GM" : "PENDING_FM";
  }
  if (request.status === "more_info") {
    const moreInfoStep = steps.find((step) => step.status === "more_info");
    return moreInfoStep && moreInfoStep.step_order >= 2 ? "NEEDS_INFO_GM" : "NEEDS_INFO_FM";
  }
  const direct = {
    pending_assign: "PENDING_ASSIGN",
    assigned: "ASSIGNED",
    in_progress: "IN_PROGRESS",
    pending_verify: "PENDING_VERIFY",
    completed: "DONE",
    rejected: "REJECTED",
  };
  return direct[request.status] ?? request.status.toUpperCase();
}

function appsScriptApprovalStage(step, directory) {
  if (!step) return null;
  return {
    status: step.status === "approved" || step.status === "rejected" ? step.status : "",
    by: step.acted_by ? personName(directory, step.acted_by) : "",
    at: step.acted_at ?? "",
    note: step.comment ?? "",
  };
}

function buildAppsScriptOrder(request, steps, verifications, directory, technicianIds) {
  const fmStep = steps.find((step) => step.step_order === 1);
  const gmStep = steps.find((step) => step.step_order === 2);
  const [latestVerification, ...olderVerifications] = verifications;
  const verificationHistory = olderVerifications
    .filter((item) => item.result === "fail")
    .map((item) => ({ at: item.created_at, note: item.note ?? "" }));

  return {
    id: request.id,
    docNumber: request.request_no,
    department: relation(request.department)?.code ?? "",
    machineCode: request.machine_code ?? "",
    machineName: request.machine_name ?? "",
    cause: request.description ?? "",
    neededDate: request.needed_date ?? "",
    requestedBy: request.requester_name ?? "",
    createdAt: request.submitted_at,
    status: mapRepairAppsScriptStatus(request, steps),
    docType: request.doc_type ?? "",
    approvals: {
      fm: appsScriptApprovalStage(fmStep, directory),
      gm: appsScriptApprovalStage(gmStep, directory),
    },
    assignment: request.assignee_id ? {
      technicians: (technicianIds && technicianIds.length ? technicianIds : [request.assignee_id])
        .map((techId) => personName(directory, techId)),
      startDate: request.work_started_date ?? "",
      endDate: request.work_expected_date ?? "",
      assignedBy: request.assigned_by ? personName(directory, request.assigned_by) : "",
      assignedAt: request.assigned_at ?? "",
      executionPlan: request.execution_plan ?? "",
      receivedByName: request.received_by_name ?? "",
    } : null,
    maintRecord: (request.cause_analysis || request.inspector_opinion || request.parts_used) ? {
      causeAnalysis: request.cause_analysis ?? "",
      inspectorOpinion: request.inspector_opinion ?? "",
      // ใบเก่าก่อน parts_used_items (มีแค่ parts_used เป็นข้อความ) ยังต้องอ่านได้ จึงถอยไปช่องเดิม
      // เมื่อไม่มีรายการโครงสร้าง — ดู 20260921060000_repair_parts_used_items.sql
      parts: Array.isArray(request.parts_used_items) && request.parts_used_items.length
        ? request.parts_used_items
        : (request.parts_used ? [{ name: request.parts_used }] : []),
    } : null,
    verification: latestVerification ? {
      result: latestVerification.result,
      note: latestVerification.note ?? "",
      at: latestVerification.created_at,
    } : null,
    verificationHistory,
    // ไม่มีรูปในสำเนานี้ — ไฟล์แนบของใบแจ้งซ่อมอยู่ใน Supabase Storage (private bucket) ไม่ใช่ base64
    // ใน KV แบบระบบเดิม จึงไม่ผูกลิงก์ "ดูรูป" ให้ (จะเป็นลิงก์ที่ไม่มีรูปจริงถ้าใส่ค่าไป)
    photoCount: 0,
    photosSplit: false,
  };
}

/* หลัง action ที่ RPC insert แถวแจ้งเตือนสำเร็จ เรียก edge function "notify-email" ให้ไปไล่ส่งอีเมล
   ตามแถวที่ยังค้างคิว — ไม่คำนวณผู้รับซ้ำฝั่งนี้ RPC เลือกผู้รับที่ถูกต้องไว้ให้แล้วตอน insert

   ใส่ requestId = เร่งส่งเฉพาะคำร้องนั้น ไม่ใส่ = ไล่ทั้งคิว ซึ่งครอบคลุมแจ้งเตือนที่ไม่ผูกกับคำร้อง
   (คำร้องเปิดบัญชี/แก้ไข ID ซึ่ง notifications.request_id เป็น NULL) และแถวที่ตกค้างจากรอบก่อน

   fire-and-forget เหมือน syncRepairOrderToAppsScript — ส่งอีเมลไม่สำเร็จต้องไม่ทำให้ action หลักพัง
   แต่ต่างตรงที่ "อ่านผลกลับมา log ไว้" เพราะเดิมทิ้ง response ทั้งหมด เวลาอีเมลไม่เข้าจึงไม่เหลือ
   ร่องรอยให้ไล่เลยว่าไม่ได้ตั้งค่า secret, ไม่มีแถวค้าง หรือผู้ให้บริการปฏิเสธ */
async function triggerNotificationEmails(requestId) {
  try {
    const result = await callNotifyEmail(requestId ? { requestId } : {});
    if (!result) return null;
    if (result.configured === false) {
      console.warn("อีเมลแจ้งเตือนยังไม่ได้ตั้งค่าช่องทางส่ง (RESEND_API_KEY หรือ GMAIL_SMTP_*) มีแถวค้างคิว", result.pending);
    } else if (result.failed || (result.errors ?? []).length) {
      console.error("ส่งอีเมลแจ้งเตือนไม่สำเร็จบางส่วน", result);
    }
    return result;
  } catch (notifyError) {
    console.warn("เรียกตัวส่งอีเมลแจ้งเตือนไม่สำเร็จ", notifyError);
    return null;
  }
}

async function callNotifyEmail(payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) return null;
  const res = await fetch(NOTIFY_EMAIL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(payload),
  });
  return await res.json().catch(() => null);
}

function syncRepairOrderToAppsScript(order) {
  if (!APPS_SCRIPT_SYNC_URL) return;
  // no-cors: อ่านผลลัพธ์กลับไม่ได้ (opaque response) — ยอมรับได้เพราะนี่คือสำเนาสำรอง ไม่ใช่ทางเดิน
  // ข้อมูลจริง ถ้ายิงไม่สำเร็จ (โควตา/เครือข่าย/ฯลฯ) ก็แค่ log ไว้ ไม่กระทบผู้ใช้งานเลย
  fetch(APPS_SCRIPT_SYNC_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ batch: [{ key: `order:${order.id}`, value: JSON.stringify(order) }] }),
  }).catch((syncError) => console.warn("ซิงก์ใบแจ้งซ่อมไปชีตสำรองไม่สำเร็จ", syncError));
}

// สถานะของใบคำร้องถึงฝ่ายบริหารตามฟอร์ม PP01-FM08: มติ 3 ทาง (approved/rejected/acknowledged)
// เป็น terminal เสมอ ไม่มีขั้นดำเนินงานแบบใบแจ้งซ่อม จึงสั้นกว่า mapRepairAppsScriptStatus มาก
function mapManagementAppsScriptStatus(request) {
  if (request.status === "pending_approval") return request.current_step >= 2 ? "PENDING_GM" : "PENDING_FM";
  const direct = {
    more_info: "NEEDS_INFO",
    approved: "APPROVED",
    in_progress: "IN_PROGRESS",
    completed: "DONE",
    rejected: "REJECTED",
    acknowledged: "ACKNOWLEDGED",
  };
  return direct[request.status] ?? request.status.toUpperCase();
}

// โครงสร้างเดียวกับ buildAppsScriptOrder ของใบแจ้งซ่อม (fm/gm ผูกกับ step_order 1/2 เหมือนกัน
// เพราะ MANAGEMENT ใช้สายอนุมัติคงที่ ผู้จัดการโรงงาน -> ผู้จัดการทั่วไป แบบเดียวกันแล้ว — ดู
// 20260922010000_management_request_pp01_fm08.sql) เพื่อให้ผู้ดูแลที่คุ้นชีตใบแจ้งซ่อมอ่านชีตนี้ได้ทันที
function buildAppsScriptManagementOrder(request, steps, directory, ccDepartmentCodes) {
  const fmStep = steps.find((step) => step.step_order === 1);
  const gmStep = steps.find((step) => step.step_order === 2);
  const details = request.details ?? {};
  const decidedStep = [fmStep, gmStep].find((step) => step && step.status !== "pending");
  return {
    id: request.id,
    docNumber: request.request_no,
    department: relation(request.department)?.code ?? "",
    subject: request.title ?? "",
    attachmentNote: details.attachment_note ?? "",
    description: request.description ?? "",
    requestedBy: personName(directory, request.requester_id),
    position: directory.get(request.requester_id)?.job_title ?? "",
    submittedAt: request.submitted_at,
    status: mapManagementAppsScriptStatus(request),
    decision: decidedStep ? decidedStep.status : "",
    comment: decidedStep?.comment ?? "",
    approvals: {
      fm: appsScriptApprovalStage(fmStep, directory),
      gm: appsScriptApprovalStage(gmStep, directory),
    },
    ccDepartments: ccDepartmentCodes ?? [],
    ccOther: details.cc_other_note ?? "",
  };
}

function syncManagementOrderToAppsScript(order) {
  if (!APPS_SCRIPT_MANAGEMENT_SYNC_URL) return;
  // no-cors: อ่านผลลัพธ์กลับไม่ได้ (opaque response) — ยอมรับได้เพราะนี่คือสำเนาสำรอง ไม่ใช่ทางเดิน
  // ข้อมูลจริง ถ้ายิงไม่สำเร็จ (โควตา/เครือข่าย/ฯลฯ) ก็แค่ log ไว้ ไม่กระทบผู้ใช้งานเลย
  fetch(APPS_SCRIPT_MANAGEMENT_SYNC_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ batch: [{ key: `mgmt:${order.id}`, value: JSON.stringify(order) }] }),
  }).catch((syncError) => console.warn("ซิงก์ใบคำร้องถึงฝ่ายบริหารไปชีตสำรองไม่สำเร็จ", syncError));
}

async function renderRequestDetail(params) {
  const id = params.get("id");
  if (!id) return renderNotFound("ไม่พบรหัสคำร้อง");
  loadingShell("requests", "รายละเอียดคำร้อง");
  const [requestResult, stepsResult, attachmentsResult, historyResult, verificationsResult, techniciansResult, progressResult, directory] = await Promise.all([
    sb.from("requests").select("*,request_type:request_types(name_th,code,uses_repair_workflow,owning_department_id),department:departments(code)").eq("id", id).maybeSingle(),
    sb.from("approval_steps").select("*").eq("request_id", id).order("step_order"),
    sb.from("request_attachments").select("*").eq("request_id", id).order("created_at"),
    sb.from("request_status_history").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("request_verifications").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("request_technicians").select("technician_id").eq("request_id", id),
    sb.from("request_progress_steps").select("*").eq("request_id", id).order("sort_order"),
    loadEmployeeDirectory(),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (!requestResult.data) return renderNotFound("ไม่พบคำร้อง หรือคุณไม่มีสิทธิ์เข้าถึง");
  for (const result of [stepsResult, attachmentsResult, historyResult, verificationsResult, techniciansResult, progressResult]) if (result.error) throw result.error;
  const request = requestResult.data;
  const type = relation(request.request_type);
  const isRepair = Boolean(type?.uses_repair_workflow);
  const steps = stepsResult.data ?? [];
  const attachments = attachmentsResult.data ?? [];
  const history = historyResult.data ?? [];
  const verifications = verificationsResult.data ?? [];
  const timeline = buildRequestTimeline(request, history, steps, verifications, directory, isRepair);
  const progressSteps = progressResult.data ?? [];
  // ช่างของใบนี้ = รายชื่อในตารางช่าง (ใบเก่าก่อนรองรับหลายคนมีแต่ assignee_id จึงรวมเข้าไปด้วย)
  const assignedTechIds = [...new Set([
    ...(techniciansResult.data ?? []).map((row) => row.technician_id),
    ...(request.assignee_id ? [request.assignee_id] : []),
  ])];
  if (isRepair) syncRepairOrderToAppsScript(buildAppsScriptOrder(request, steps, verifications, directory, assignedTechIds));
  const isManagement = type?.code === "MANAGEMENT";
  let ccDepartmentCodes = [];
  if (isManagement) {
    // อย่าให้การเตรียมข้อมูลสำรอง (แค่บันทึก/รายงาน) พังหน้ารายละเอียดจริง — ผิดพลาดแค่ log ไว้
    try {
      const ccIds = request.cc_department_ids ?? [];
      if (ccIds.length) {
        const { data: ccData, error: ccError } = await sb.from("departments").select("code").in("id", ccIds);
        if (ccError) throw ccError;
        ccDepartmentCodes = (ccData ?? []).map((row) => row.code);
      }
      syncManagementOrderToAppsScript(buildAppsScriptManagementOrder(request, steps, directory, ccDepartmentCodes));
    } catch (ccError) {
      console.warn("เตรียมข้อมูลสำเนาถึงแผนก/สำรองใบคำร้องถึงฝ่ายบริหารไม่สำเร็จ", ccError);
    }
  }
  const employee = state.employee;
  const currentStep = steps.find((step) => step.status === "pending" && step.step_order === request.current_step);
  const isAdmin = employee.role?.code === "admin" || VIEW_ALL_ROLE_CODES.includes(employee.role?.code);
  // เงื่อนไขต้องตรงกับ app_approval_decision เป๊ะ: ข้ามได้เฉพาะ role 'admin' จริง ไม่ใช่ทุกคนที่มี
  // requests.view_all (factory_manager/general_manager ก็มี) ไม่งั้นจะเห็นปุ่มอนุมัติของขั้นที่ไม่ใช่
  // ของตัวเอง แล้วกดไปโดน NOT_AUTHORIZED จากฐานข้อมูล
  const canApprove = currentStep && (employee.role?.code === "admin"
    || (currentStep.approver_employee_id && currentStep.approver_employee_id === employee.id)
    || (
      Boolean(currentStep.approver_role_id)
      && currentStep.approver_role_id === employee.role_id
      && (!currentStep.approver_department_id || currentStep.approver_department_id === employee.department_id)
      && Boolean(type?.code) && employee.approvalModules.has(type.code)
    ));
  const canOperate = !isRepair && (isAdmin || OPERATE_ROLE_CODES.includes(employee.role?.code)) && ["approved", "in_progress"].includes(request.status);
  const technicians = isRepair ? [...directory.entries()].filter(([, person]) => person.is_active && person.department_id === type.owning_department_id) : [];
  // สเปก: ผจก.ซ่อมบำรุงแก้รายชื่อช่างได้ทุกสถานะ ยกเว้นใบที่ถูกปฏิเสธ และต้องอนุมัติครบก่อน
  const isOwningDeptManager = employee.role?.code === "department_manager"
    && employee.department_id === type?.owning_department_id;
  // การแจกจ่ายงานเป็นหน้าที่ ผจก.แผนกซ่อมบำรุงคนเดียว — ห้ามใช้ isAdmin ตรงนี้เพราะมันรวม
  // factory_manager/general_manager ซึ่งไม่ควรเข้ามายุ่งในขั้นตอนของช่าง (ตรงกับ
  // app_assign_repair_technician ที่ตัด requests.view_all ออกแล้วใน 20260921100000)
  const canAssign = isRepair
    && ["pending_assign", "assigned", "in_progress", "pending_verify", "completed"].includes(request.status)
    && (employee.role?.code === "admin" || isOwningDeptManager);
  const isMyRepairJob = assignedTechIds.includes(employee.id);
  // เจตนา: จำกัดเฉพาะช่างที่ถูกมอบหมาย + ผู้จัดการแผนกเจ้าของประเภทเอกสาร + admin เท่านั้น
  // ไม่ใช้ isAdmin (ซึ่งรวม factory_manager/general_manager) เพราะสองบทบาทนั้นไม่ได้เกี่ยวข้อง
  // กับงานซ่อมนี้โดยตรง — ป้องกันคนที่ไม่เกี่ยวข้องกดเริ่มงานแทนช่าง
  const canStartWork = isRepair && request.status === "assigned" && assignedTechIds.length > 0 && (
    employee.role?.code === "admin" || isMyRepairJob || isOwningDeptManager
  );
  // จบงาน: ผจก.โรงงาน/ผจก.ทั่วไป กดแทนไม่ได้ (ตัด requests.view_all ออกแล้ว) แต่หัวหน้าแผนก
  // ซ่อมบำรุงเจ้าของงาน (isOwningDeptManager) กดแทนช่างในชุดได้เหมือนปุ่มเริ่มงาน/หมุดความคืบหน้า
  // ต้องตรงกับเงื่อนไขฝั่ง app_finish_repair_work — ส่วนตรวจรับยังเหลือแค่ผู้แจ้งเท่านั้น
  const canFinishWork = isRepair && request.status === "in_progress"
    && (employee.role?.code === "admin" || isMyRepairJob || isOwningDeptManager);
  const canVerify = isRepair && request.status === "pending_verify"
    && (employee.role?.code === "admin" || request.requester_id === employee.id);
  // หมุดความคืบหน้า: ช่างในชุด กับ ผจก.ซ่อมบำรุง เท่านั้นที่กดได้ คนอื่นดูได้อย่างเดียว
  const canRecordProgress = employee.role?.code === "admin" || isMyRepairJob || isOwningDeptManager;
  const isRequester = request.requester_id === employee.id;
  const detailEntries = Object.entries(request.details ?? {});
  const requestFacts = [
    requestFact("ความสำคัญ", priorityLabels[request.priority], {
      icon: "!",
      tone: ["high", "urgent"].includes(request.priority) ? "danger" : "primary",
      valueClass: `priority-${request.priority}`,
    }),
    requestFact(isRepair ? "ช่างผู้รับผิดชอบ" : "ผู้รับผิดชอบ",
      isRepair
        ? (assignedTechIds.map((techId) => personName(directory, techId)).join(", ") || "—")
        : personName(directory, request.assignee_id),
      { icon: "◎", tone: "success", wide: isRepair && assignedTechIds.length > 1 }),
    ...(isRepair ? [
      requestFact("ประเภทเอกสาร", docTypeLabels[request.doc_type] ?? request.doc_type ?? "—", { icon: "▤", tone: "violet" }),
      ...(request.received_by_name ? [requestFact("ผู้จัดการที่รับใบ", request.received_by_name, { icon: "✓", tone: "cyan" })] : []),
      requestFact("เครื่องจักร", `${request.machine_code ?? "—"}${request.machine_name && request.machine_name !== request.machine_code ? ` — ${request.machine_name}` : ""}`, { icon: "⚙", tone: "slate" }),
      requestFact("ผู้แจ้ง", request.requester_name ?? "—", { icon: "◉", tone: "cyan" }),
      requestFact("ความเร่งด่วน", request.is_urgent ? "ด่วน" : "ปกติ", { icon: "↗", tone: request.is_urgent ? "danger" : "success" }),
      ...(request.needed_date ? [requestFact("วันที่ต้องการใช้งาน", formatDate(request.needed_date), { icon: "◷", tone: "violet" })] : []),
      ...(request.assigned_at ? [requestFact("มอบหมายเมื่อ", `${formatDate(request.assigned_at, true)} โดย ${personName(directory, request.assigned_by)}`, { icon: "→", tone: "cyan", wide: true })] : []),
      ...(request.work_expected_date ? [requestFact("กำหนดเสร็จ", formatDate(request.work_expected_date), { icon: "◷", tone: "warning" })] : []),
      ...(request.work_started_date ? [requestFact("วันที่เริ่มงาน", formatDate(request.work_started_date), { icon: "▶", tone: "primary" })] : []),
      ...(request.execution_plan ? [requestFact("การดำเนินงาน", executionPlanLabels[request.execution_plan] ?? request.execution_plan, { icon: "✓", tone: "success" })] : []),
      ...(request.inspector_opinion ? [requestFact("แนวทางการซ่อม", inspectorOpinionLabels[request.inspector_opinion] ?? request.inspector_opinion, { icon: "◇", tone: "cyan" })] : []),
      ...(request.cause_analysis ? [requestFact("วิเคราะห์สาเหตุ", request.cause_analysis, { icon: "?", tone: "warning", wide: true })] : []),
      ...(request.parts_used ? [requestFact("อะไหล่ที่ใช้", request.parts_used, { icon: "⌁", tone: "slate", wide: true })] : []),
    ] : []),
    ...detailEntries.map(([key, value]) => requestFact(detailFieldLabels[key] ?? key, value, {
      icon: "•",
      tone: "primary",
      wide: String(value ?? "").length > 36,
    })),
    ...(isManagement && ccDepartmentCodes.length
      ? [requestFact("สำเนาถึงแผนก", ccDepartmentCodes.join(", "), { icon: "▤", tone: "violet", wide: true })]
      : []),
  ].join("");
  const content = `
    <header class="request-detail-head"><div class="eyebrow">${escapeHtml(request.request_no)}</div><h1>${escapeHtml(request.title)}</h1><p>${escapeHtml(type?.name_th ?? "คำร้อง")} · โดย ${escapeHtml(personName(directory, request.requester_id))} · ${formatDate(request.submitted_at, true)}</p></header>
    <div class="detail-grid">
      <div class="stack">
        <section class="card request-overview-card">
          <div class="request-overview-head"><div class="request-overview-title"><span>รายละเอียดหลัก</span><h2>ข้อมูลคำร้อง</h2></div>${isRepair ? repairStatusBadge(request, steps) : statusBadge(request.status)}</div>
          <p class="description request-summary">${escapeHtml(request.description)}</p>
          <div class="request-facts">${requestFacts}</div>
        </section>
        ${request.status === "more_info" ? (() => {
          const moreInfoStep = steps.find((step) => step.status === "more_info");
          const requesterLabel = personName(directory, request.requester_id);
          const askedByLabel = moreInfoStep?.acted_by ? personName(directory, moreInfoStep.acted_by) : "—";
          return `<section class="card more-info-card">
            <h2>รอข้อมูลเพิ่มเติมจาก ${escapeHtml(requesterLabel)}</h2>
            <p class="muted small">${escapeHtml(askedByLabel)} ขอข้อมูลเพิ่มเติมในขั้นตอน "${escapeHtml(moreInfoStep?.step_name ?? "—")}"${moreInfoStep?.comment ? ` · ${escapeHtml(moreInfoStep.comment)}` : ""}</p>
            ${isRequester ? `<form id="resubmit-form">
              <div class="field"><label for="resubmit-comment">ข้อมูลเพิ่มเติม</label><textarea class="textarea" id="resubmit-comment" name="comment" maxlength="1000" placeholder="ระบุข้อมูลที่ขอเพิ่มเติม"></textarea></div>
              <div class="form-actions"><button class="btn" type="submit">ส่งข้อมูลกลับให้พิจารณาอีกครั้ง</button></div>
            </form>` : `<p class="muted small">มีเพียง ${escapeHtml(requesterLabel)} ผู้ยื่นคำร้องนี้เท่านั้นที่ตอบกลับได้</p>`}
          </section>`;
        })() : ""}
        ${canApprove ? `<section class="card"><h2>พิจารณาคำร้อง</h2><p class="muted small">ขั้นตอน: ${escapeHtml(currentStep.step_name)}</p><div class="field"><label for="decision-comment">ความเห็น</label><textarea class="textarea" id="decision-comment" maxlength="1000"></textarea></div><div class="approval-actions"><button class="btn success decision-button" data-decision="approved">อนุมัติ</button><button class="btn warning decision-button" data-decision="more_info">ขอข้อมูลเพิ่ม</button>${type?.code === "MANAGEMENT" ? `<button class="btn secondary decision-button" data-decision="acknowledged">รับทราบข้อมูล</button>` : ""}<button class="btn danger decision-button" data-decision="rejected">ไม่อนุมัติ</button></div></section>` : ""}
        ${canOperate ? `<section class="card"><h2>ดำเนินงาน</h2><p class="muted small">ผู้ปฏิบัติงานสามารถรับงานและเปลี่ยนสถานะตามลำดับ</p><div class="approval-actions">${request.status === "approved" ? `<button class="btn status-button" data-status="in_progress">รับงานและเริ่มดำเนินการ</button>` : `<button class="btn success status-button" data-status="completed">บันทึกว่าเสร็จแล้ว</button>`}</div></section>` : ""}
        ${canAssign ? `<section class="card"><h2>${request.status === "pending_assign" ? "มอบหมายช่าง" : "แก้ไขการมอบหมายช่าง"}</h2><p class="muted small">${request.status === "pending_assign" ? "บันทึกข้อมูลซ่อมบำรุงและเลือกช่าง — ติ๊กได้มากกว่าหนึ่งคน" : "เปลี่ยนรายชื่อช่างหรือแก้ข้อมูลการซ่อมบำรุงได้จนกว่าใบจะปิด"}</p><form id="assign-form">
          <div class="field"><label>ช่างผู้รับผิดชอบ</label><small>ติ๊กช่างที่รับผิดชอบใบนี้ อย่างน้อย 1 คน</small><div class="tech-picker">${technicians.map(([techId, person]) => `<label class="tech-option"><input type="checkbox" name="technician_ids" value="${escapeHtml(techId)}"${assignedTechIds.includes(techId) ? " checked" : ""}><span>${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}${person.job_title ? ` · ${escapeHtml(person.job_title)}` : ""}</span></label>`).join("") || `<p class="muted small">ยังไม่มีพนักงานในแผนกซ่อมบำรุง</p>`}</div></div>
          <div class="field"><label for="assign-execution-plan">การดำเนินงาน</label><select class="select" id="assign-execution-plan" name="execution_plan" required><option value="">เลือกการดำเนินงาน</option>${Object.entries(executionPlanLabels).map(([value,label]) => `<option value="${value}"${request.execution_plan === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
          <div class="field"><label for="assign-opinion">ความคิดเห็นของช่างผู้ตรวจสอบ</label><select class="select" id="assign-opinion" name="inspector_opinion" required><option value="">เลือกแนวทางการซ่อม</option>${Object.entries(inspectorOpinionLabels).map(([value,label]) => `<option value="${value}"${request.inspector_opinion === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
          <div class="field"><label for="assign-start-date">วันเริ่มงาน</label><input class="input" id="assign-start-date" name="work_started_date" type="date" value="${escapeHtml(request.work_started_date ?? "")}" required></div>
          <div class="field"><label for="assign-expected-date">วันที่คาดว่าจะเสร็จ</label><input class="input" id="assign-expected-date" name="work_expected_date" type="date" value="${escapeHtml(request.work_expected_date ?? "")}" required></div>
          <div class="form-actions"><button class="btn" type="submit">${request.status === "pending_assign" ? "มอบหมายงาน" : "บันทึกการเปลี่ยนแปลง"}</button></div>
        </form></section>` : ""}
        ${isRepair && progressSteps.length ? `<section class="card"><h2>ความคืบหน้าระหว่างทาง</h2><p class="muted small">${canRecordProgress ? "กดบันทึกเมื่อแต่ละขั้นเสร็จจริง ระบบแจ้งผู้แจ้งและผู้จัดการแผนกให้อัตโนมัติ" : "ช่างผู้รับผิดชอบและผู้จัดการแผนกซ่อมบำรุงเท่านั้นที่บันทึกได้"}</p><div class="progress-steps">${progressSteps.map((step) => progressStepHtml(step, directory, canRecordProgress)).join("")}</div></section>` : ""}
        ${canStartWork ? `<section class="card"><h2>เริ่มงานซ่อม</h2><p class="muted small">กดเมื่อเริ่มลงมือซ่อมจริง</p><div class="approval-actions"><button class="btn start-work-button">เริ่มงาน</button></div></section>` : ""}
        ${canFinishWork ? `<section class="card"><h2>บันทึกผลการซ่อมและจบงาน</h2><p class="muted small">กรอกผลวิเคราะห์และอะไหล่ที่ใช้ กด "บันทึกข้อมูล" เพื่อบันทึกไว้ทำต่อภายหลังได้โดยยังไม่จบงาน หรือกด "เสร็จสิ้นงาน" เพื่อส่งต่อให้ผู้แจ้งตรวจรับ (การดำเนินงานและความคิดเห็นของช่างผู้ตรวจสอบบันทึกไว้แล้วตอนมอบหมาย)</p><form id="finish-form">
          <div class="field"><label for="finish-cause">วิเคราะห์สาเหตุ</label><textarea class="textarea" id="finish-cause" name="cause_analysis" minlength="3" maxlength="5000" required>${escapeHtml(request.cause_analysis ?? "")}</textarea></div>
          <div class="field"><label>รายการอะไหล่ / วัสดุที่ใช้ (ถ้ามี)</label><small>กรอกเฉพาะรายการที่มี</small><div class="table-wrap parts-table-wrap"><table class="parts-table"><thead><tr><th>ลำดับ</th><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคา</th><th>ชื่อร้าน</th><th>หมายเหตุ</th><th></th></tr></thead><tbody id="finish-parts-rows">${(Array.isArray(request.parts_used_items) && request.parts_used_items.length ? request.parts_used_items : [{}]).map((item) => partsRowHtml(item)).join("")}</tbody></table></div><button type="button" class="btn secondary small" id="finish-parts-add">+ เพิ่มรายการ</button><div class="parts-attachment"><small>หรือแนบรูป/ไฟล์ใบเสร็จรายการอะไหล่แทนการกรอกทีละแถว เพื่อประหยัดเวลา</small><div class="parts-attachment-row"><input class="input" id="finish-parts-file" type="file"><button type="button" class="btn secondary small" id="finish-parts-file-upload">แนบไฟล์</button></div></div></div>
          <div class="form-actions"><button class="btn secondary" type="button" id="finish-save-button">บันทึกข้อมูล</button><button class="btn success" type="submit">เสร็จสิ้นงาน</button></div>
        </form></section>` : ""}
        ${canVerify ? `<section class="card"><h2>ตรวจรับผลการซ่อม</h2><p class="muted small">ยืนยันว่าใช้งานได้ปกติหรือต้องซ่อมเพิ่มเติม (ถ้าไม่ผ่านต้องระบุหมายเหตุ)</p><div class="field"><label for="verify-note">หมายเหตุ</label><textarea class="textarea" id="verify-note" maxlength="1000"></textarea></div><div class="approval-actions"><button class="btn success verify-button" data-result="pass">✓ ผ่าน (ใช้งานได้ปกติ)</button><button class="btn danger verify-button" data-result="fail">✕ ไม่ผ่าน (ต้องซ่อมเพิ่มเติม)</button></div></section>` : ""}
      </div>
      <aside class="stack">
        <section class="card"><h2>ลำดับอนุมัติ</h2><div class="timeline">${steps.map((step) => `<div class="timeline-item"><strong>${escapeHtml(step.step_name)} · ${escapeHtml(step.status)}</strong><p>${step.acted_by ? `ดำเนินการโดย ${escapeHtml(personName(directory, step.acted_by))}` : "รอดำเนินการ"}${step.comment ? ` · ${escapeHtml(step.comment)}` : ""}</p></div>`).join("") || `<div class="muted small">ไม่มีขั้นตอนอนุมัติ</div>`}</div></section>
        <section class="card"><h2>ไฟล์แนบ</h2>${attachmentGalleryHtml(attachments)}<form id="attachment-form"><div class="field"><label for="attachment-file">แนบไฟล์ (สูงสุด 10 MB)</label><input class="input" id="attachment-file" name="file" type="file" required></div><button class="btn secondary small" type="submit">อัปโหลด</button></form></section>
        <section class="card"><h2>ลำดับเหตุการณ์</h2><div class="timeline">${timeline.map((item) => `<div class="timeline-item"><strong>${escapeHtml(item.title)}</strong><p class="timeline-item-detail">${escapeHtml(item.detail)}</p><time class="timeline-item-time" datetime="${escapeHtml(item.at)}">${formatDate(item.at, true)}</time></div>`).join("") || `<div class="muted small">ยังไม่มีประวัติ</div>`}</div></section>
      </aside>
    </div>`;
  app.innerHTML = shell(content, "requests", request.request_no);
  bindShell();

  document.querySelectorAll(".decision-button").forEach((button) => button.addEventListener("click", async () => {
    const decision = button.dataset.decision;
    const comment = document.querySelector("#decision-comment")?.value.trim() ?? "";
    // สเปก: "อนุมัติ" และ "รับทราบข้อมูล" เท่านั้นที่หมายเหตุเป็นทางเลือก (COMMENT_REQUIRED บังคับ
    // แค่ "ไม่อนุมัติ"/"ขอข้อมูลเพิ่ม") — ดักที่นี่ก่อนยิง RPC เพื่อไม่ให้เสียรอบไปกลับ
    if (!["approved", "acknowledged"].includes(decision) && comment.length < 3) {
      return showToast(decision === "rejected"
        ? "กรุณาระบุเหตุผลที่ไม่อนุมัติ"
        : "กรุณาระบุว่าต้องการข้อมูลเพิ่มเติมเรื่องอะไร", "error");
    }
    document.querySelectorAll(".decision-button").forEach((node) => { node.disabled = true; });
    try {
      const { error } = await sb.rpc("app_approval_decision", { p_step_id: currentStep.id, p_decision: decision, p_comment: comment });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("บันทึกผลการพิจารณาแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); document.querySelectorAll(".decision-button").forEach((node) => { node.disabled = false; }); }
  }));
  document.querySelector(".status-button")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      const { error } = await sb.rpc("app_update_request_status", { p_request_id: id, p_status: event.currentTarget.dataset.status });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("อัปเดตสถานะแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); event.currentTarget.disabled = false; }
  });
  document.querySelector("#assign-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const technicianIds = values.getAll("technician_ids").map(String).filter(Boolean);
    if (!technicianIds.length) return showToast("กรุณาเลือกช่างอย่างน้อย 1 คน", "error");
    const startDate = String(values.get("work_started_date") ?? "");
    const expectedDate = String(values.get("work_expected_date") ?? "");
    if (startDate && expectedDate && expectedDate < startDate) {
      return showToast("วันที่คาดว่าจะเสร็จต้องไม่ก่อนวันเริ่มงาน", "error");
    }
    setFormBusy(form, true);
    try {
      const { error } = await sb.rpc("app_assign_repair_technician", {
        p_request_id: id,
        p_technician_ids: technicianIds,
        p_execution_plan: String(values.get("execution_plan") ?? "") || null,
        p_inspector_opinion: String(values.get("inspector_opinion") ?? "") || null,
        p_work_started_date: startDate || null,
        p_work_expected_date: expectedDate || null,
      });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("บันทึกการมอบหมายเรียบร้อย");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelectorAll(".progress-button").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { error } = await sb.rpc("app_record_progress_step", { p_step_id: button.dataset.step, p_done_on: null });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("บันทึกความคืบหน้าแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); button.disabled = false; }
  }));
  // หมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องเลือกก่อนว่ารับของทันที หรือระบุวันที่คาดว่าจะมาส่ง — สลับ
  // required/disabled ของช่องวันที่ตามตัวเลือกที่ติ๊กไว้ กันส่งฟอร์มไปครึ่งๆ กลางๆ
  document.querySelectorAll(".progress-order-form").forEach((form) => {
    const expectedInput = form.querySelector(".progress-expected-input");
    form.querySelectorAll('input[name="receipt_mode"]').forEach((radio) => radio.addEventListener("change", () => {
      const later = form.querySelector('input[name="receipt_mode"]:checked')?.value === "later";
      expectedInput.disabled = !later;
      expectedInput.required = later;
      if (!later) expectedInput.value = "";
    }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const receivedNow = form.querySelector('input[name="receipt_mode"]:checked')?.value !== "later";
      const expectedOn = expectedInput.value || null;
      if (!receivedNow && !expectedOn) return showToast("กรุณาระบุวันที่คาดว่าของจะมาส่ง", "error");
      setFormBusy(form, true);
      try {
        const { error } = await sb.rpc("app_record_progress_step", {
          p_step_id: form.dataset.step,
          p_done_on: null,
          p_received_now: receivedNow,
          p_expected_on: receivedNow ? null : expectedOn,
        });
        if (error) throw error;
        triggerNotificationEmails(id);
        showToast(receivedNow ? "บันทึกความคืบหน้าแล้ว — รับของครบพร้อมกัน" : "บันทึกความคืบหน้าแล้ว — ตั้งวันที่คาดว่าจะมาส่งไว้แล้ว");
        await renderRequestDetail(params);
      } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
    });
  });
  // "ของยังไม่มา" — เปิดฟอร์มเลื่อนวันที่คาดว่าจะมาส่งของหมุด "ของมาส่งเรียบร้อย"
  document.querySelectorAll(".progress-reschedule-toggle").forEach((button) => button.addEventListener("click", () => {
    document.querySelector(`.progress-reschedule-form[data-step="${button.dataset.step}"]`)?.classList.toggle("hidden");
  }));
  document.querySelectorAll(".progress-reschedule-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const expectedOn = String(new FormData(form).get("expected_on") ?? "");
    if (!expectedOn) return showToast("กรุณาระบุวันที่คาดว่าจะมาส่งใหม่", "error");
    setFormBusy(form, true);
    try {
      const { error } = await sb.rpc("app_reschedule_progress_step", { p_step_id: form.dataset.step, p_expected_on: expectedOn });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("เลื่อนวันที่คาดว่าจะมาส่งแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  }));
  document.querySelector(".start-work-button")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      const { error } = await sb.rpc("app_start_repair_work", { p_request_id: id });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("เริ่มงานแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); event.currentTarget.disabled = false; }
  });
  renumberPartsRows(document.querySelector("#finish-parts-rows"));
  document.querySelector("#finish-parts-add")?.addEventListener("click", () => {
    const container = document.querySelector("#finish-parts-rows");
    container?.insertAdjacentHTML("beforeend", partsRowHtml());
    renumberPartsRows(container);
  });
  document.querySelector("#finish-parts-rows")?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".parts-row-remove");
    if (!removeButton) return;
    const container = document.querySelector("#finish-parts-rows");
    const rows = container.querySelectorAll(".parts-row");
    // เหลือแถวเดียวไม่ลบทิ้งไปเลย — เคลียร์ค่าแทน ให้ฟอร์มมีอย่างน้อยหนึ่งแถวเสมอ
    if (rows.length > 1) removeButton.closest(".parts-row").remove();
    else removeButton.closest(".parts-row").querySelectorAll("input").forEach((input) => { input.value = ""; });
    renumberPartsRows(container);
  });
  document.querySelector("#finish-parts-file-upload")?.addEventListener("click", async () => {
    const button = document.querySelector("#finish-parts-file-upload");
    const input = document.querySelector("#finish-parts-file");
    let file;
    try {
      file = optionalAttachment(input?.files[0]);
      if (!file) throw new Error("กรุณาเลือกไฟล์");
    } catch (error) {
      return showToast(friendlyError(error), "error");
    }
    button.disabled = true;
    try {
      await uploadRequestAttachment(id, file, employee.id);
      showToast("แนบไฟล์แล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); button.disabled = false; }
  });
  // แถวที่ไม่ได้กรอกชื่ออะไหล่ถือว่าเป็นแถวว่างที่เผื่อไว้ ไม่ส่งไป — RPC ก็กรองซ้ำอีกชั้นเช่นกัน
  const collectFinishPartsUsedItems = () => [...document.querySelectorAll("#finish-parts-rows .parts-row")]
    .map((row) => ({
      name: row.querySelector('[data-part-field="name"]').value.trim(),
      qty: row.querySelector('[data-part-field="qty"]').value.trim(),
      unit: row.querySelector('[data-part-field="unit"]').value.trim(),
      price: row.querySelector('[data-part-field="price"]').value.trim(),
      shop: row.querySelector('[data-part-field="shop"]').value.trim(),
      note: row.querySelector('[data-part-field="note"]').value.trim(),
    }))
    .filter((item) => item.name);
  document.querySelector("#finish-save-button")?.addEventListener("click", async () => {
    const form = document.querySelector("#finish-form");
    setFormBusy(form, true);
    try {
      const { error } = await sb.rpc("app_save_repair_work_progress", {
        p_request_id: id,
        p_cause_analysis: document.querySelector("#finish-cause").value.trim(),
        p_parts_used_items: collectFinishPartsUsedItems(),
      });
      if (error) throw error;
      showToast("บันทึกข้อมูลแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelector("#finish-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setFormBusy(form, true);
    try {
      const { error } = await sb.rpc("app_finish_repair_work", {
        p_request_id: id,
        p_cause_analysis: String(values.get("cause_analysis") ?? "").trim(),
        p_parts_used_items: collectFinishPartsUsedItems(),
      });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("บันทึกผลการซ่อมแล้ว ส่งให้ผู้แจ้งตรวจรับ");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelectorAll(".verify-button").forEach((button) => button.addEventListener("click", async () => {
    const result = button.dataset.result;
    const note = document.querySelector("#verify-note")?.value.trim() ?? "";
    if (result === "fail" && note.length < 3) return showToast("กรุณาระบุสาเหตุที่ไม่ผ่านการตรวจรับ", "error");
    document.querySelectorAll(".verify-button").forEach((node) => { node.disabled = true; });
    try {
      const { error } = await sb.rpc("app_verify_repair", { p_request_id: id, p_result: result, p_note: note || null });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast(result === "pass" ? "ยืนยันผ่านการตรวจรับแล้ว" : "ส่งกลับให้ซ่อมเพิ่มเติมแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); document.querySelectorAll(".verify-button").forEach((node) => { node.disabled = false; }); }
  }));
  document.querySelector("#resubmit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormBusy(form, true);
    const comment = form.elements.comment.value.trim();
    try {
      const { error } = await sb.rpc("app_resubmit_request", { p_request_id: id, p_comment: comment || null });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("ส่งข้อมูลกลับให้พิจารณาอีกครั้งแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelector("#attachment-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    let file;
    try {
      file = optionalAttachment(form.elements.file.files[0]);
      if (!file) throw new Error("กรุณาเลือกไฟล์");
    } catch (error) {
      return showToast(friendlyError(error), "error");
    }
    setFormBusy(form, true);
    try {
      await uploadRequestAttachment(id, file, employee.id);
      showToast("อัปโหลดไฟล์แล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelector("#attachment-gallery")?.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-attachment-open]");
    if (trigger) openAttachmentLightbox(trigger.dataset.attachmentOpen);
  });
  hydrateAttachmentGallery(attachments).catch((error) => showToast(friendlyError(error), "error"));
}

async function renderApprovals(params) {
  loadingShell("approvals", "รออนุมัติ");
  const [steps, repairTasks] = await Promise.all([getPendingApprovals(), getMyRepairActionItems()]);
  const repairTasksSection = repairTasks.length ? `
    <section class="card flush repair-task-list">
      <div class="card-heading"><h2>งานซ่อมที่ต้องดำเนินการ <span class="badge">${repairTasks.length}</span></h2></div>
      ${repairTasks.map((item) => `<a class="approval-item" href="#/request?id=${encodeURIComponent(item.id)}"><div class="row"><span class="request-no">${escapeHtml(item.request_no)}</span><time>${formatDate(item.created_at)}</time></div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.request_type?.name_th ?? "")} · ${escapeHtml(myRepairActionLabels[item.status] ?? statusLabels[item.status] ?? item.status)}</p></a>`).join("")}
    </section>` : "";
  if (!steps.length) {
    app.innerHTML = shell(`
      <div class="page-heading"><div><div class="eyebrow">Approval Center</div><h1>งานที่ต้องจัดการ</h1><p>รายการที่อยู่ในสิทธิ์ของคุณและรอดำเนินการ</p></div></div>
      ${repairTasksSection || `<div class="empty"><h2>✓ ไม่มีคำร้องรออนุมัติ</h2><p>รายการใหม่ที่อยู่ในสิทธิ์ของคุณจะแสดงที่หน้านี้</p><a class="btn secondary" href="#/dashboard">กลับหน้าหลัก</a></div>`}
    `, "approvals", "รออนุมัติ");
    bindShell();
    return;
  }
  const selectedId = params.get("request") ?? steps[0].request.id;
  const selected = steps.find((step) => step.request.id === selectedId) ?? steps[0];
  const request = selected.request;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Approval Center</div><h1>รอฉันอนุมัติ</h1><p>รายการที่เป็นขั้นตอนปัจจุบันและอยู่ในสิทธิ์ของคุณ</p></div></div>
    ${repairTasksSection}
    <div class="approval-layout">
      <section class="approval-list"><div class="approval-list-head"><h2>ทั้งหมด <span class="badge">${steps.length}</span></h2><p>เรียงจากรายการที่รอนานที่สุด</p></div>${steps.map((step) => `<a class="approval-item${step.id === selected.id ? " active" : ""}" href="#/approvals?request=${encodeURIComponent(step.request.id)}"><div class="row"><span class="request-no">${escapeHtml(step.request.request_no)}</span><time>${formatDate(step.request.created_at)}</time></div><strong>${escapeHtml(step.request.title)}</strong><p>${escapeHtml(relation(step.request.request_type)?.name_th ?? "")} · ${escapeHtml(step.step_name)}</p></a>`).join("")}</section>
      <article class="approval-preview"><div class="eyebrow">${escapeHtml(request.request_no)}</div><h2>${escapeHtml(request.title)}</h2><p class="description">${escapeHtml(request.description)}</p><dl class="definition-grid"><div class="definition"><dt>ประเภท</dt><dd>${escapeHtml(relation(request.request_type)?.name_th ?? "—")}</dd></div><div class="definition"><dt>ความสำคัญ</dt><dd class="priority-${escapeHtml(request.priority)}">${escapeHtml(priorityLabels[request.priority])}</dd></div><div class="definition"><dt>ขั้นตอน</dt><dd>${escapeHtml(selected.step_name)}</dd></div><div class="definition"><dt>วันที่ส่ง</dt><dd>${formatDate(request.submitted_at, true)}</dd></div></dl><div class="approval-actions"><a class="btn" href="#/request?id=${encodeURIComponent(request.id)}">เปิดคำร้องและพิจารณา →</a></div></article>
    </div>`;
  app.innerHTML = shell(content, "approvals", "รออนุมัติ");
  bindShell();
}

function notificationHref(item) {
  if (item.request_id) return `#/request?id=${encodeURIComponent(item.request_id)}`;
  if (item.action_url === "/admin") return "#/admin";
  if (item.action_url === "/profile") return "#/profile";
  return "#/notifications";
}

async function renderNotifications() {
  loadingShell("notifications", "การแจ้งเตือน");
  const { data, error } = await sb.from("notifications").select("*").eq("recipient_id", state.employee.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Notifications</div><h1>การแจ้งเตือน</h1><p>ความเคลื่อนไหวที่เกี่ยวข้องกับบัญชีนี้</p></div>${(data ?? []).some((item) => !item.read_at) ? `<button class="btn secondary" id="mark-read">อ่านทั้งหมดแล้ว</button>` : ""}</div>
    <div class="stack">${(data ?? []).map((item) => `<a class="notification-item${item.read_at ? "" : " unread"}" href="${notificationHref(item)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body ?? "")} · ${formatDate(item.created_at, true)}</span></a>`).join("") || `<div class="empty">ยังไม่มีการแจ้งเตือน</div>`}</div>`;
  app.innerHTML = shell(content, "notifications", "การแจ้งเตือน");
  bindShell();
  document.querySelector("#mark-read")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const { error: updateError } = await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", state.employee.id).is("read_at", null);
    if (updateError) return showToast(friendlyError(updateError), "error");
    state.unread = 0;
    showToast("ทำเครื่องหมายว่าอ่านแล้ว");
    await renderNotifications();
  });
}

async function renderProfile() {
  const employee = state.employee;
  const isAccountManager = employee.role?.code === "admin";
  let departments = [];
  let roles = [];
  if (isAccountManager) {
    const [departmentResult, roleResult] = await Promise.all([
      sb.from("departments").select("id,code,name_th").eq("is_active", true).order("code"),
      sb.from("roles").select("id,code,name_th").order("sort_order"),
    ]);
    departments = departmentResult.data ?? [];
    roles = roleResult.data ?? [];
  }

  const content = `
    <div class="page-heading"><div><div class="eyebrow">My account</div><h1>ข้อมูลส่วนตัว</h1><p>แก้ไขข้อมูลของคุณได้จากหน้านี้</p></div></div>

    <section class="card" style="max-width:780px">
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:20px">
        <div class="avatar" style="width:52px;height:52px;font-size:15px">${escapeHtml(initials(employee))}</div>
        <div><h2>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</h2><span class="badge">${escapeHtml(employee.role?.name_th ?? "พนักงานทั่วไป")}</span></div>
      </div>
      <div id="profile-message"></div>
      <form id="profile-form">
        <div class="field-row">
          <div class="field"><label for="profile-first-name">ชื่อ</label><input class="input" id="profile-first-name" name="first_name" maxlength="100" value="${escapeHtml(employee.first_name)}" required></div>
          <div class="field"><label for="profile-last-name">นามสกุล</label><input class="input" id="profile-last-name" name="last_name" maxlength="100" value="${escapeHtml(employee.last_name)}" required></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="profile-email">อีเมล</label><input class="input" id="profile-email" name="email" type="email" maxlength="200" value="${escapeHtml(employee.email ?? "")}"></div>
          <div class="field"><label for="profile-phone">เบอร์ติดต่อ</label><input class="input" id="profile-phone" name="phone" maxlength="40" value="${escapeHtml(employee.phone ?? "")}"></div>
        </div>
        <div class="field"><label for="profile-job-title">ชื่อตำแหน่งงาน</label><input class="input" id="profile-job-title" name="job_title" maxlength="120" value="${escapeHtml(employee.job_title ?? "")}"></div>
        <div class="field"><label for="profile-employee-no">รหัสพนักงาน (ID เข้าใช้งาน)</label><input class="input" id="profile-employee-no" value="${escapeHtml(employee.employee_no)}" disabled><small>แก้ไขได้ที่การ์ด ID / รหัสผ่านด้านล่าง เพื่อให้เปลี่ยนพร้อมบัญชีเข้าใช้งานในขั้นตอนเดียว</small></div>
        ${isAccountManager ? `
        <div class="field-row">
          <div class="field"><label for="profile-department">หน่วยงาน</label><select class="input" id="profile-department" name="department_id" required>${departments.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === employee.department_id ? " selected" : ""}>${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
          <div class="field"><label for="profile-role">ตำแหน่ง</label><select class="input" id="profile-role" name="role_id" required>${roles.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === employee.role_id ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
        </div>
        <small>ระบบไม่ยอมให้ถอดสิทธิ์ผู้ดูแลระบบของตนเอง เพื่อไม่ให้ไม่มีใครเข้าไปแก้ไขได้อีก</small>
        ` : `
        <div class="field-row">
          <div class="field"><label for="profile-department">หน่วยงาน</label><input class="input" id="profile-department" value="${escapeHtml(employee.department?.name_th ?? "—")}" disabled></div>
          <div class="field"><label for="profile-role">ตำแหน่ง</label><input class="input" id="profile-role" value="${escapeHtml(employee.role?.name_th ?? "—")}" disabled></div>
        </div>
        <small>สองช่องนี้เป็นตัวกำหนดสิทธิ์และเส้นทางอนุมัติ ต้องให้ผู้ดูแลระบบเป็นผู้แก้ให้</small>
        `}
        <div class="form-actions"><button class="btn" type="submit">บันทึกข้อมูล</button></div>
      </form>
    </section>

    <section class="card" style="max-width:780px">
      <h2>${isAccountManager ? "แก้ไข ID / รหัสผ่านของฉัน" : "ขอแก้ไข ID / รหัสผ่าน"}</h2>
      <p class="muted small">${isAccountManager
        ? "บัญชีผู้ดูแลระบบเป็นผู้อนุมัติเอง ระบบจึงบันทึกและอนุมัติให้ทันทีในขั้นตอนเดียว พร้อมเก็บประวัติไว้ในคำร้องและ audit log ตามปกติ"
        : "คำร้องจะถูกส่งให้ผู้ดูแลระบบอนุมัติก่อน ระบบจึงจะเปลี่ยนให้ ระหว่างรออนุมัติยังเข้าสู่ระบบด้วยรหัสผ่านเดิมได้ตามปกติ"}</p>
      <div id="credential-message"></div>
      <form id="credential-form">
        <div class="field"><label for="new-employee-no">รหัสพนักงาน (ID เข้าใช้งาน)</label><input class="input" id="new-employee-no" name="employee_no" maxlength="32" value="${escapeHtml(employee.employee_no)}" required><small>คงเดิมไว้ได้หากต้องการเปลี่ยนเฉพาะรหัสผ่าน</small></div>
        <div class="field-row">
          <div class="field"><label for="new-password">รหัสผ่านใหม่</label><input class="input" id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
          <div class="field"><label for="confirm-new-password">ยืนยันรหัสผ่านใหม่</label><input class="input" id="confirm-new-password" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
        </div>
        <div class="field"><label for="credential-reason">เหตุผล (ถ้ามี)</label><textarea class="textarea" id="credential-reason" name="reason" maxlength="1000"></textarea></div>
        <div class="form-actions"><button class="btn" type="submit">${isAccountManager ? "บันทึกการแก้ไขทันที" : "ส่งคำร้องให้ผู้ดูแลอนุมัติ"}</button></div>
      </form>
    </section>`;
  app.innerHTML = shell(content, "profile", "ข้อมูลส่วนตัว");
  bindShell();
  document.querySelector("#profile-form").addEventListener("submit", handleProfileSubmit);
  document.querySelector("#credential-form").addEventListener("submit", handleCredentialChangeSubmit);
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#profile-message");
  const values = new FormData(form);
  const employee = state.employee;
  const isAccountManager = employee.role?.code === "admin";
  setFormBusy(form, true);
  message.innerHTML = "";

  const { error } = isAccountManager
    ? await sb.rpc("app_admin_update_employee", {
      p_employee_id: employee.id,
      p_employee_no: employee.employee_no,
      p_first_name: String(values.get("first_name") ?? ""),
      p_last_name: String(values.get("last_name") ?? ""),
      p_email: String(values.get("email") ?? ""),
      p_phone: String(values.get("phone") ?? ""),
      p_job_title: String(values.get("job_title") ?? ""),
      p_department_id: String(values.get("department_id") ?? "") || null,
      p_role_id: String(values.get("role_id") ?? "") || null,
      p_is_active: true,
    })
    : await sb.rpc("app_update_own_profile", {
      p_first_name: String(values.get("first_name") ?? ""),
      p_last_name: String(values.get("last_name") ?? ""),
      p_email: String(values.get("email") ?? ""),
      p_phone: String(values.get("phone") ?? ""),
      p_job_title: String(values.get("job_title") ?? ""),
    });

  if (error) {
    setFormBusy(form, false);
    message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(error))}</div>`;
    return;
  }
  await loadEmployee();
  showToast("บันทึกข้อมูลเรียบร้อย");
  await renderProfile();
  document.querySelector("#profile-message").innerHTML = `<div class="form-message success">บันทึกข้อมูลเรียบร้อยแล้ว</div>`;
}

async function handleCredentialChangeSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#credential-message");
  const values = new FormData(form);
  const password = String(values.get("password") ?? "");
  if (password !== String(values.get("confirm_password") ?? "")) {
    message.innerHTML = `<div class="form-message error">รหัสผ่านทั้งสองช่องไม่ตรงกัน</div>`;
    return;
  }
  const isAccountManager = state.employee.role?.code === "admin";
  setFormBusy(form, true);
  message.innerHTML = "";
  const { data: requestId, error } = await sb.rpc("app_request_credential_change", {
    p_employee_no: String(values.get("employee_no") ?? "").trim().toUpperCase(),
    p_password: password,
    p_reason: String(values.get("reason") ?? ""),
  });
  if (error) {
    setFormBusy(form, false);
    message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(error))}</div>`;
    return;
  }

  if (!isAccountManager) {
    // แจ้งเตือนของคำร้องบัญชีไม่มี request_id จึงเรียกแบบไล่ทั้งคิว
    triggerNotificationEmails();
    setFormBusy(form, false);
    form.reset();
    message.innerHTML = `<div class="form-message success">ส่งคำร้องแล้ว รอผู้ดูแลระบบอนุมัติ</div>`;
    showToast("ส่งคำร้องขอแก้ไข ID/รหัสผ่านแล้ว");
    return;
  }

  // ผู้ดูแลระบบเป็นผู้อนุมัติอยู่แล้ว จึงอนุมัติคำร้องของตนเองต่อทันที
  // ใช้เส้นทางเดียวกับการอนุมัติคำร้องของผู้อื่น สิทธิ์จึงถูกตรวจที่ฐานข้อมูลเหมือนกัน
  try {
    const { data: sessionData } = await sb.auth.getSession();
    await callPilotAuth(
      { action: "approve_account_request", requestId, roleId: "" },
      sessionData.session?.access_token,
    );
  } catch (approveError) {
    setFormBusy(form, false);
    message.innerHTML = `<div class="form-message error">บันทึกคำร้องแล้วแต่ยังเปลี่ยนไม่สำเร็จ: ${escapeHtml(friendlyError(approveError))} · คำร้องยังค้างอยู่ที่หน้าผู้ดูแลระบบและกดอนุมัติซ้ำได้</div>`;
    return;
  }

  showToast("แก้ไข ID/รหัสผ่านเรียบร้อย");
  await forceReLogin("แก้ไขเรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้งด้วย ID และรหัสผ่านใหม่");
}

async function handleEmployeeEditSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#employee-edit-message");
  const values = new FormData(form);
  const employeeId = form.dataset.employeeId;
  const previousEmployeeNo = String(form.dataset.employeeNo ?? "").trim().toUpperCase();
  const newEmployeeNo = String(values.get("employee_no") ?? "").trim().toUpperCase();
  const newPassword = String(values.get("password") ?? "");
  if (newPassword && (newPassword.length < 8 || newPassword.length > 72)) {
    message.innerHTML = `<div class="form-message error">รหัสผ่านต้องมี 8–72 ตัวอักษร</div>`;
    return;
  }
  setFormBusy(form, true);
  message.innerHTML = "";

  const { error } = await sb.rpc("app_admin_update_employee", {
    p_employee_id: employeeId,
    p_employee_no: newEmployeeNo,
    p_first_name: String(values.get("first_name") ?? ""),
    p_last_name: String(values.get("last_name") ?? ""),
    p_email: String(values.get("email") ?? ""),
    p_phone: String(values.get("phone") ?? ""),
    p_job_title: String(values.get("job_title") ?? ""),
    p_department_id: String(values.get("department_id") ?? "") || null,
    p_role_id: String(values.get("role_id") ?? "") || null,
    p_is_active: String(values.get("is_active") ?? "true") === "true",
  });
  if (error) {
    setFormBusy(form, false);
    message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(error))}</div>`;
    return;
  }

  // รหัสผ่านต้องเปลี่ยนที่ Supabase Auth จึงไปทาง Edge Function ซึ่งตรวจสิทธิ์ซ้ำในฐานข้อมูล
  if (newPassword) {
    try {
      const { data: sessionData } = await sb.auth.getSession();
      await callPilotAuth(
        { action: "admin_set_password", employeeId, password: newPassword },
        sessionData.session?.access_token,
      );
    } catch (passwordError) {
      setFormBusy(form, false);
      message.innerHTML = `<div class="form-message error">บันทึกข้อมูลแล้วแต่ยังตั้งรหัสผ่านไม่สำเร็จ: ${escapeHtml(friendlyError(passwordError))} · กดบันทึกซ้ำได้</div>`;
      return;
    }
  }

  if (employeeId === state.employee.id) {
    if (newPassword || newEmployeeNo !== previousEmployeeNo) {
      showToast("บันทึกการแก้ไขบัญชีเรียบร้อย");
      await forceReLogin("แก้ไขบัญชีของคุณเรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้งด้วย ID และรหัสผ่านใหม่");
      return;
    }
    await loadEmployee();
  }
  showToast("บันทึกการแก้ไขบัญชีเรียบร้อย");
  go("admin?tab=credentials");
  await renderRoute();
}

async function renderAdmin(params) {
  if (state.employee.role?.code !== "admin") return renderNotFound("หน้านี้สำหรับผู้ดูแลระบบเท่านั้น");
  const tab = ["accounts", "credentials", "modules"].includes(params.get("tab")) ? params.get("tab") : "requests";
  state.adminTab = tab;
  loadingShell("admin", "ผู้ดูแลระบบ");

  const [requestsResult, credentialsResult, rolesResult, departmentsResult, modulePermissionsResult] = await Promise.all([
    sb.rpc("app_list_account_requests", { p_status: null }),
    sb.rpc("app_list_credentials"),
    sb.from("roles").select("id,code,name_th").order("sort_order"),
    sb.from("departments").select("id,code,name_th").eq("is_active", true).order("code"),
    sb.rpc("app_list_module_permissions"),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (credentialsResult.error) throw credentialsResult.error;
  if (rolesResult.error) throw rolesResult.error;
  if (departmentsResult.error) throw departmentsResult.error;
  if (modulePermissionsResult.error) throw modulePermissionsResult.error;
  const requests = requestsResult.data ?? [];
  const credentials = credentialsResult.data ?? [];
  const roles = rolesResult.data ?? [];
  const departments = departmentsResult.data ?? [];
  const modulePermissionRows = modulePermissionsResult.data ?? [];
  const editing = credentials.find((item) => item.employee_id === params.get("edit")) ?? null;
  const pendingCount = requests.filter((item) => item.status === "pending").length;

  const statusBadgeClass = { pending: "pending_approval", approved: "approved", rejected: "rejected" };
  const requestCards = requests.map((item) => `
    <article class="card">
      <div class="card-head">
        <div>
          <span class="request-no">${escapeHtml(item.employee_no)}</span>
          <h3>${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</h3>
          <p class="muted small">${escapeHtml(accountRequestKindLabels[item.kind] ?? item.kind)} · ${formatDate(item.created_at, true)}</p>
        </div>
        <span class="badge ${statusBadgeClass[item.status] ?? ""}">${escapeHtml(accountRequestStatusLabels[item.status] ?? item.status)}</span>
      </div>
      <dl class="definition-grid">
        <div class="definition"><dt>แผนก</dt><dd>${escapeHtml(item.department_code ?? "—")}</dd></div>
        <div class="definition"><dt>ตำแหน่งที่ขอ</dt><dd>${escapeHtml(item.desired_role_name ?? "—")}</dd></div>
        <div class="definition"><dt>ชื่อตำแหน่งงาน</dt><dd>${escapeHtml(item.job_title ?? "—")}</dd></div>
        <div class="definition"><dt>ติดต่อ</dt><dd>${escapeHtml(item.phone ?? item.email ?? "—")}</dd></div>
      </dl>
      ${item.reason ? `<p class="description">${escapeHtml(item.reason)}</p>` : ""}
      ${item.status === "pending" ? `
        <div class="field" style="margin-top:14px"><label for="role-${escapeHtml(item.id)}">ตำแหน่งที่ให้</label><select class="input" id="role-${escapeHtml(item.id)}" data-role-select="${escapeHtml(item.id)}"><option value="">ใช้ตำแหน่งที่ขอไว้</option>${roles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name_th ?? role.code)}</option>`).join("")}</select></div>
        <div class="field"><label for="note-${escapeHtml(item.id)}">หมายเหตุเมื่อไม่อนุมัติ</label><input class="input" id="note-${escapeHtml(item.id)}" data-note-input="${escapeHtml(item.id)}" maxlength="1000"></div>
        <div class="approval-actions">
          <button class="btn success" data-approve="${escapeHtml(item.id)}">อนุมัติและสร้างสิทธิ์</button>
          <button class="btn danger" data-reject="${escapeHtml(item.id)}">ไม่อนุมัติ</button>
        </div>` : `<p class="muted small">${escapeHtml(item.reviewed_by_name ? `ดำเนินการโดย ${item.reviewed_by_name}` : "ดำเนินการแล้ว")}${item.reviewed_at ? ` · ${formatDate(item.reviewed_at, true)}` : ""}${item.review_note ? ` · ${escapeHtml(item.review_note)}` : ""}</p>`}
    </article>`).join("") || `<div class="empty">ยังไม่มีคำร้องเกี่ยวกับบัญชี</div>`;

  // ข้อมูลบัญชี: ข้อมูลเดียวกับ credentials (คลัง ID/รหัสผ่าน) แค่โชว์เป็นรายละเอียดโปรไฟล์
  // ต่อคนแทนตาราง — ไม่มีคอลัมน์รหัสผ่าน เพราะช่องนั้นยังอยู่ที่แท็บคลัง ID/รหัสผ่านเท่านั้น
  const accountCards = credentials.map((item) => {
    const isSelf = item.employee_id === state.employee.id;
    return `
    <article class="card">
      <div class="card-head">
        <div>
          <span class="request-no">${escapeHtml(item.employee_no)}</span>
          <h3>${escapeHtml(item.full_name)}${isSelf ? ` <span class="badge">บัญชีของคุณ</span>` : ""}</h3>
          <p class="muted small">${escapeHtml(item.role_code ?? "—")}</p>
        </div>
        ${item.is_active ? "" : `<span class="badge rejected">ปิดใช้งาน</span>`}
      </div>
      <dl class="definition-grid">
        <div class="definition"><dt>แผนก</dt><dd>${escapeHtml(item.department_code ?? "—")}</dd></div>
        <div class="definition"><dt>ชื่อตำแหน่งงาน</dt><dd>${escapeHtml(item.job_title ?? "—")}</dd></div>
        <div class="definition"><dt>ติดต่อ</dt><dd>${escapeHtml(item.phone ?? item.email ?? "—")}</dd></div>
        <div class="definition"><dt>ตำแหน่ง</dt><dd>${escapeHtml(item.role_code ?? "—")}</dd></div>
        <div class="definition"><dt>อัปเดตล่าสุด</dt><dd>${item.updated_at ? formatDate(item.updated_at, true) : "—"}${item.updated_by_name ? ` · โดย ${escapeHtml(item.updated_by_name)}` : ""}</dd></div>
      </dl>
      <div class="approval-actions"><a class="btn secondary small" href="#/admin?tab=credentials&edit=${encodeURIComponent(item.employee_id)}">แก้ไขบัญชี →</a></div>
    </article>`;
  }).join("") || `<div class="empty">ยังไม่มีบัญชีในระบบ</div>`;

  const credentialRows = credentials.map((item) => {
    const isSelf = item.employee_id === state.employee.id;
    return `
    <tr>
      <td><span class="request-no">${escapeHtml(item.employee_no)}</span></td>
      <td>${escapeHtml(item.full_name)}${isSelf ? ` <span class="badge">บัญชีของคุณ</span>` : ""}${item.is_active ? "" : ` <span class="badge rejected">ปิดใช้งาน</span>`}</td>
      <td>${escapeHtml(item.department_code ?? "—")}</td>
      <td>${escapeHtml(item.role_code ?? "—")}</td>
      <td><code data-password-cell="${escapeHtml(item.employee_id)}">${item.has_password ? "••••••••" : "ยังไม่มีบันทึกไว้"}</code></td>
      <td>${item.updated_at ? formatDate(item.updated_at, true) : "—"}</td>
      <td>${[
        item.has_password ? `<button class="btn secondary small" data-reveal="${escapeHtml(item.employee_id)}">แสดง</button>` : "",
        `<a class="btn secondary small" href="#/admin?tab=credentials&edit=${encodeURIComponent(item.employee_id)}">แก้ไข</a>`,
      ].join(" ")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted small">ยังไม่มีข้อมูล</td></tr>`;

  const moduleColumns = [];
  const moduleEmployeeMap = new Map();
  for (const row of modulePermissionRows) {
    if (!moduleColumns.some((col) => col.id === row.request_type_id)) {
      moduleColumns.push({ id: row.request_type_id, code: row.request_type_code, name: row.request_type_name });
    }
    if (!moduleEmployeeMap.has(row.employee_id)) {
      moduleEmployeeMap.set(row.employee_id, {
        employee_id: row.employee_id,
        employee_no: row.employee_no,
        full_name: row.full_name,
        department_code: row.department_code,
        role_code: row.role_code,
        granted: new Map(),
      });
    }
    moduleEmployeeMap.get(row.employee_id).granted.set(row.request_type_id, row.granted);
  }
  const modulePermissionTableRows = [...moduleEmployeeMap.values()].map((person) => `
    <tr>
      <td><span class="request-no">${escapeHtml(person.employee_no)}</span></td>
      <td>${escapeHtml(person.full_name)}</td>
      <td>${escapeHtml(person.department_code ?? "—")}</td>
      <td>${escapeHtml(person.role_code ?? "—")}</td>
      ${moduleColumns.map((col) => `<td class="center"><input type="checkbox" data-module-toggle data-employee="${escapeHtml(person.employee_id)}" data-type="${escapeHtml(col.id)}"${person.granted.get(col.id) ? " checked" : ""}></td>`).join("")}
    </tr>`).join("") || `<tr><td colspan="${4 + moduleColumns.length}" class="muted small">ยังไม่มีผู้อนุมัติในระบบ</td></tr>`;

  const content = `
    <div class="page-heading"><div><div class="eyebrow">Administration</div><h1>ผู้ดูแลระบบ</h1><p>อนุมัติคำร้องเปิดบัญชี กำหนดสิทธิ์ และค้นคืน ID/รหัสผ่านที่ออกให้</p></div></div>
    <div id="email-dispatch-status"></div>
    <div class="filters">
      <a class="filter${tab === "requests" ? " active" : ""}" href="#/admin?tab=requests">คำร้องบัญชี${pendingCount ? ` (${pendingCount})` : ""}</a>
      <a class="filter${tab === "accounts" ? " active" : ""}" href="#/admin?tab=accounts">ข้อมูลบัญชี</a>
      <a class="filter${tab === "credentials" ? " active" : ""}" href="#/admin?tab=credentials">คลัง ID/รหัสผ่าน</a>
      <a class="filter${tab === "modules" ? " active" : ""}" href="#/admin?tab=modules">สิทธิ์อนุมัติตามโมดูล</a>
    </div>
    ${tab === "requests" ? `<div class="stack">${requestCards}</div>` : ""}
    ${tab === "accounts" ? `<div class="stack">${accountCards}</div>` : ""}
    ${tab === "modules" ? `
      <section class="card">
        <p class="muted small">กำหนดว่าผู้อนุมัติแต่ละคนอนุมัติคำร้องโมดูลใดได้บ้าง ผู้ที่ไม่ได้ติ๊กโมดูลใดจะไม่เห็นและอนุมัติคำร้องโมดูลนั้น แม้จะอยู่แผนกและถือบทบาทผู้อนุมัติเดียวกันก็ตาม (ขั้นตอน "หัวหน้าแผนก" ที่อนุมัติในฐานะผู้บังคับบัญชาโดยตรงไม่ถูกจำกัดด้วยตารางนี้)</p>
        <div class="table-wrap"><table>
          <thead><tr><th>รหัสพนักงาน</th><th>ชื่อ</th><th>แผนก</th><th>ตำแหน่ง</th>${moduleColumns.map((col) => `<th>${escapeHtml(col.name)}</th>`).join("")}</tr></thead>
          <tbody>${modulePermissionTableRows}</tbody>
        </table></div>
      </section>` : ""}
    ${tab === "credentials" ? `
      ${editing ? `
      <section class="card">
        <div class="card-head"><div><h2>แก้ไขบัญชี ${escapeHtml(editing.employee_no)}</h2><p class="muted small">แก้ไขได้ทุกช่องรวมถึง ID ตำแหน่ง และรหัสผ่าน การเปลี่ยนแปลงมีผลทันที</p></div><a class="btn secondary small" href="#/admin?tab=credentials">ปิด</a></div>
        <div id="employee-edit-message"></div>
        <form id="employee-edit-form" data-employee-id="${escapeHtml(editing.employee_id)}" data-employee-no="${escapeHtml(editing.employee_no)}">
          <div class="field-row">
            <div class="field"><label for="edit-employee-no">รหัสพนักงาน (ID เข้าใช้งาน)</label><input class="input" id="edit-employee-no" name="employee_no" maxlength="32" value="${escapeHtml(editing.employee_no)}" required></div>
            <div class="field"><label for="edit-active">สถานะบัญชี</label><select class="input" id="edit-active" name="is_active"><option value="true"${editing.is_active ? " selected" : ""}>ใช้งาน</option><option value="false"${editing.is_active ? "" : " selected"}>ปิดใช้งาน</option></select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="edit-first-name">ชื่อ</label><input class="input" id="edit-first-name" name="first_name" maxlength="100" value="${escapeHtml(editing.first_name ?? "")}" required></div>
            <div class="field"><label for="edit-last-name">นามสกุล</label><input class="input" id="edit-last-name" name="last_name" maxlength="100" value="${escapeHtml(editing.last_name ?? "")}" required></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="edit-email">อีเมล</label><input class="input" id="edit-email" name="email" type="email" maxlength="200" value="${escapeHtml(editing.email ?? "")}"></div>
            <div class="field"><label for="edit-phone">เบอร์ติดต่อ</label><input class="input" id="edit-phone" name="phone" maxlength="40" value="${escapeHtml(editing.phone ?? "")}"></div>
          </div>
          <div class="field"><label for="edit-job-title">ชื่อตำแหน่งงาน</label><input class="input" id="edit-job-title" name="job_title" maxlength="120" value="${escapeHtml(editing.job_title ?? "")}"></div>
          <div class="field-row">
            <div class="field"><label for="edit-department">หน่วยงาน</label><select class="input" id="edit-department" name="department_id" required>${departments.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === editing.department_id ? " selected" : ""}>${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
            <div class="field"><label for="edit-role">ตำแหน่ง</label><select class="input" id="edit-role" name="role_id" required>${roles.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === editing.role_id ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
          </div>
          <div class="field"><label for="edit-password">ตั้งรหัสผ่านใหม่ (เว้นว่างไว้หากไม่เปลี่ยน)</label><input class="input" id="edit-password" name="password" type="password" autocomplete="new-password" maxlength="72"><small>ตั้งให้ผู้ใช้ได้ทันทีเมื่อผู้ใช้ลืมรหัสผ่าน และรหัสผ่านใหม่จะถูกบันทึกลงคลังให้อัตโนมัติ</small></div>
          <div class="form-actions"><button class="btn" type="submit">บันทึกการแก้ไข</button></div>
        </form>
      </section>` : ""}
      <section class="card">
        <p class="muted small">ตารางนี้แสดงพนักงานทุกบัญชีรวมถึงบัญชีผู้ดูแลระบบและบัญชีของคุณเอง รหัสผ่านถูกปิดไว้เป็นค่าเริ่มต้น การกดแสดงถูกบันทึกลง audit log ทุกครั้งพร้อมชื่อผู้กดและเวลา บัญชีที่สร้างก่อนระบบนี้จะยังไม่มีรหัสผ่านบันทึกไว้ ให้เจ้าของบัญชีแก้ไขรหัสผ่านหนึ่งครั้งก่อน</p>
        <div class="table-wrap"><table>
          <thead><tr><th>รหัสพนักงาน</th><th>ชื่อ</th><th>แผนก</th><th>ตำแหน่ง</th><th>รหัสผ่าน</th><th>อัปเดตล่าสุด</th><th></th></tr></thead>
          <tbody>${credentialRows}</tbody>
        </table></div>
      </section>` : ""}`;

  app.innerHTML = shell(content, "admin", "ผู้ดูแลระบบ");
  bindShell();
  renderEmailDispatchStatus();

  document.querySelectorAll("[data-module-toggle]").forEach((checkbox) => checkbox.addEventListener("change", async () => {
    const employeeId = checkbox.dataset.employee;
    const requestTypeId = checkbox.dataset.type;
    const granted = checkbox.checked;
    checkbox.disabled = true;
    const { error } = await sb.rpc("app_set_module_permission", {
      p_employee_id: employeeId,
      p_request_type_id: requestTypeId,
      p_granted: granted,
    });
    checkbox.disabled = false;
    if (error) {
      checkbox.checked = !granted;
      return showToast(friendlyError(error), "error");
    }
    showToast(granted ? "ให้สิทธิ์อนุมัติโมดูลนี้แล้ว" : "ถอดสิทธิ์อนุมัติโมดูลนี้แล้ว");
    if (employeeId === state.employee.id) await loadEmployee();
  }));

  document.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", async () => {
    const requestId = button.dataset.approve;
    const roleId = document.querySelector(`[data-role-select="${requestId}"]`)?.value ?? "";
    button.disabled = true;
    try {
      const { data: sessionData } = await sb.auth.getSession();
      await callPilotAuth(
        { action: "approve_account_request", requestId, roleId },
        sessionData.session?.access_token,
      );
      showToast("อนุมัติและสร้างสิทธิ์เรียบร้อย");
      await renderAdmin(params);
    } catch (error) {
      button.disabled = false;
      showToast(friendlyError(error), "error");
    }
  }));

  document.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", async () => {
    const requestId = button.dataset.reject;
    button.disabled = true;
    const { error } = await sb.rpc("app_reject_account_request", {
      p_request_id: requestId,
      p_note: document.querySelector(`[data-note-input="${requestId}"]`)?.value ?? "",
    });
    if (error) {
      button.disabled = false;
      return showToast(friendlyError(error), "error");
    }
    triggerNotificationEmails();
    showToast("บันทึกว่าไม่อนุมัติแล้ว");
    await renderAdmin(params);
  }));

  document.querySelector("#employee-edit-form")?.addEventListener("submit", handleEmployeeEditSubmit);

  document.querySelectorAll("[data-reveal]").forEach((button) => button.addEventListener("click", async () => {
    const employeeId = button.dataset.reveal;
    const cell = document.querySelector(`[data-password-cell="${employeeId}"]`);
    button.disabled = true;
    const { data, error } = await sb.rpc("app_reveal_credential", { p_employee_id: employeeId });
    button.disabled = false;
    if (error) return showToast(friendlyError(error), "error");
    cell.textContent = data;
    button.remove();
  }));
}

/* เดิมเมื่อยังไม่ได้ตั้ง secret ของ notify-email ระบบจะเงียบสนิท: ผู้ใช้เห็นแถบแจ้งเตือนในเว็บครบ
   แต่ไม่มีอีเมลออกเลย และไม่มีอะไรบอก Admin ว่าต้องไปตั้งค่า จึงดึงสถานะมาแสดงบนหน้าผู้ดูแลระบบ
   ไม่ทำให้หน้าโหลดช้าเพราะเรียกหลัง render แล้วค่อยเติมลงไป และพังก็แค่ไม่ขึ้นแถบนี้ */
async function renderEmailDispatchStatus() {
  const node = document.querySelector("#email-dispatch-status");
  if (!node) return;
  let status;
  try {
    status = await callNotifyEmail({ action: "status" });
  } catch {
    return;
  }
  if (!status || status.error) return;
  const pending = Number(status.pending ?? 0);
  if (!status.configured) {
    node.innerHTML = `<div class="form-message error">อีเมลแจ้งเตือนยังส่งออกไม่ได้ · ยังไม่ได้ตั้งค่าช่องทางส่งให้ Edge Function <code>notify-email</code> (ตั้ง <code>RESEND_API_KEY</code> หรือ <code>GMAIL_SMTP_USER</code> + <code>GMAIL_SMTP_APP_PASSWORD</code> ดูวิธีในไฟล์ README) ขณะนี้มีแจ้งเตือนค้างคิวอยู่ ${pending} รายการ ระบบจะส่งย้อนหลังให้เองทันทีที่ตั้งค่าเสร็จ</div>`;
    return;
  }
  node.innerHTML = pending
    ? `<div class="form-message">อีเมลแจ้งเตือนพร้อมส่ง (ช่องทาง: ${escapeHtml(String(status.transport))}) · ค้างคิวอยู่ ${pending} รายการ <button class="btn secondary" id="flush-email-queue" type="button">ส่งคิวที่ค้างเดี๋ยวนี้</button></div>`
    : `<div class="form-message success">อีเมลแจ้งเตือนพร้อมส่ง (ช่องทาง: ${escapeHtml(String(status.transport))}) · ไม่มีรายการค้างคิว</div>`;
  document.querySelector("#flush-email-queue")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const result = await triggerNotificationEmails();
    showToast(result
      ? `ส่งแล้ว ${result.sent ?? 0} · ข้าม ${result.skipped ?? 0} · ไม่สำเร็จ ${result.failed ?? 0}`
      : "เรียกตัวส่งอีเมลไม่สำเร็จ", result && !result.failed ? "success" : "error");
    await renderEmailDispatchStatus();
  });
}

function renderNotFound(message = "ไม่พบหน้าที่ต้องการ") {
  app.innerHTML = state.employee
    ? shell(`<div class="empty"><h2>${escapeHtml(message)}</h2><a class="btn secondary" href="#/dashboard">กลับหน้าหลัก</a></div>`, "", "ไม่พบข้อมูล")
    : `<main class="boot-screen"><h2>${escapeHtml(message)}</h2></main>`;
  if (state.employee) bindShell();
}

async function renderRoute() {
  if (!state.session) {
    await renderAuth();
    return;
  }
  if (!state.employee) await loadEmployee();
  await loadUnread();
  const { path, params } = currentRoute();
  try {
    if (path === "dashboard") return await renderDashboard();
    if (path === "requests") return await renderRequests(params);
    if (path === "new") return await renderNewRequest(params);
    if (path === "repair/new") { go("new"); return; }
    if (path === "request") return await renderRequestDetail(params);
    if (path === "approvals") return await renderApprovals(params);
    if (path === "notifications") return await renderNotifications();
    if (path === "admin") return await renderAdmin(params);
    if (path === "profile") return await renderProfile();
    return renderNotFound();
  } catch (error) {
    console.error(error);
    const message = friendlyError(error);
    app.innerHTML = shell(`<div class="empty"><h2>โหลดข้อมูลไม่สำเร็จ</h2><p>${escapeHtml(message)}</p><button class="btn secondary" id="retry-button">ลองอีกครั้ง</button></div>`, path, "เกิดข้อผิดพลาด");
    bindShell();
    document.querySelector("#retry-button")?.addEventListener("click", renderRoute);
  }
}

async function init() {
  applyTheme();
  window.addEventListener("hashchange", renderRoute);
  const { data, error } = await sb.auth.getSession();
  if (error) console.error(error);
  state.session = data.session;
  if (state.session) {
    try {
      await loadEmployee();
      // กันกรณีแจ้งเตือนตกค้าง (ปิดเบราว์เซอร์ก่อนยิงสำเร็จ / ตอนนั้นยังไม่ได้ตั้งค่า secret /
      // แจ้งเตือนที่เกิดตอนผู้รับยังไม่ได้ล็อกอิน) — เปิดแอปครั้งถัดไปคิวจะถูกไล่ส่งให้เอง
      triggerNotificationEmails();
      if (!location.hash) go("dashboard");
    } catch (employeeError) {
      await sb.auth.signOut();
      state.session = null;
      showToast(friendlyError(employeeError), "error");
    }
  }
  await renderRoute();
}

init();
