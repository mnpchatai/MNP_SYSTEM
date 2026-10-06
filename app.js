/* global supabase */

const SUPABASE_URL = "https://iqlydmkylqyowmvpsete.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uWsULpN8jWF8XCp73B8K_A_YkbKJNUD";
const PILOT_AUTH_URL = `${SUPABASE_URL}/functions/v1/pilot-auth`;
// ส่งอีเมลแจ้งเตือนจริงตาม employees.email — ดู triggerNotificationEmails ท้ายไฟล์นี้
const NOTIFY_EMAIL_URL = `${SUPABASE_URL}/functions/v1/notify-email`;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const app = document.querySelector("#app");

// ช่องรหัสผ่านทุกช่องกดแสดง/ซ่อนได้ — หน้าถูก render ใหม่ด้วย innerHTML ตลอด จึงเสริมปุ่มให้ทีหลังด้วย observer
const PASSWORD_ICON_SHOW = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const PASSWORD_ICON_HIDE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 4.06-5.06M9.9 4.24A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>`;

function enhancePasswordInputs(root) {
  root.querySelectorAll('input[type="password"]:not([data-password-toggle])').forEach((input) => {
    input.dataset.passwordToggle = "1";
    const wrap = document.createElement("span");
    wrap.className = "password-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-toggle";
    const sync = () => {
      const visible = input.type === "text";
      button.innerHTML = visible ? PASSWORD_ICON_HIDE : PASSWORD_ICON_SHOW;
      button.setAttribute("aria-label", visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
      button.setAttribute("aria-pressed", String(visible));
    };
    button.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      sync();
    });
    sync();
    wrap.appendChild(button);
  });
}

new MutationObserver(() => enhancePasswordInputs(document.body)).observe(document.body, { childList: true, subtree: true });
enhancePasswordInputs(document.body);

// รายการเลือกแบบเด้ง (dropdown/popup) ทุกตัวในระบบ: ใส่ data-popup แล้ววางไว้ในกรอบเดียวกับช่องที่เปิดมัน
// กฎชุดเดียวนี้จะปิดให้เองเมื่อแตะ/คลิก หรือย้าย focus ไปนอกกรอบ — ห้ามปิดด้วย blur/focusout เด็ดขาด
// เพราะ iPhone (Safari/WebKit) ไม่ย้าย focus ไปที่ปุ่มที่ถูกแตะ รายการจะถูกซ่อนก่อน click ทำงาน จึงเลือกไม่ได้
function closePopup(popup) {
  popup.hidden = true;
  const owner = popup.parentElement.querySelector("[aria-expanded]");
  owner?.setAttribute("aria-expanded", "false");
  owner?.removeAttribute("aria-activedescendant");
}
function closePopupsOutside(event) {
  document.querySelectorAll("[data-popup]:not([hidden])").forEach((popup) => {
    if (!popup.parentElement.contains(event.target)) closePopup(popup);
  });
}
document.addEventListener("pointerdown", closePopupsOutside);
document.addEventListener("focusin", closePopupsOutside);

// แท็บที่เปิดค้างไว้ก่อน deploy จะรันโค้ดเก่าไปเรื่อยๆ จนกว่าจะรีเฟรช — ทุกครั้งที่กลับมาที่แท็บหรือเปลี่ยนหน้า
// (เว้นช่วงอย่างน้อย 1 นาที) อ่าน ?v= ของ app.js จาก index.html ล่าสุดแบบไม่ใช้ cache ถ้าไม่ตรงกับที่รันอยู่
// ให้ขึ้นปุ่มให้ผู้ใช้กดโหลดเอง ไม่รีโหลดอัตโนมัติ เพื่อไม่ให้ข้อมูลที่กรอกค้างไว้หาย
const APP_VERSION = new URL(document.querySelector('script[src*="app.js"]').src).searchParams.get("v");
let lastVersionCheck = Date.now();
async function checkForNewVersion() {
  if (document.hidden || Date.now() - lastVersionCheck < 60 * 1000 || document.querySelector(".update-banner")) return;
  lastVersionCheck = Date.now();
  try {
    const html = await (await fetch("./index.html", { cache: "no-store" })).text();
    const latest = html.match(/app\.js\?v=([\w-]+)/)?.[1];
    if (!latest || !APP_VERSION || latest === APP_VERSION) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "update-banner";
    button.textContent = "มีระบบเวอร์ชันใหม่ · แตะเพื่อโหลด";
    button.addEventListener("click", () => location.reload());
    document.body.append(button);
  } catch {
    // ออฟไลน์/เครือข่ายสะดุด — รอเช็กรอบถัดไป
  }
}
document.addEventListener("visibilitychange", checkForNewVersion);
window.addEventListener("hashchange", checkForNewVersion);

const toastNode = document.querySelector("#toast");
const state = { session: null, employee: null, unread: 0, authMode: "login", directory: null, adminTab: "requests", sandbox: null };

// "ตำแหน่ง" คือ role_id โดยตรงแล้ว (ไม่มี position_level แยกต่างหากอีกต่อไป) ค่าตำแหน่ง
// ที่มีอยู่จริงตอนนี้มี 6 อย่าง: ผู้จัดการทั่วไป/ผู้จัดการโรงงาน/ผู้ช่วยผู้จัดการโรงงาน/
// ผู้จัดการแผนก/พนักงานทั่วไป/ผู้ดูแลระบบ — รายชื่อ/ป้ายกำกับดึงจากตาราง roles เสมอ ที่นี่
// เก็บแค่ code ที่ใช้เทียบสิทธิ์ฝั่ง UI (สิทธิ์จริงบังคับที่ฐานข้อมูลอยู่แล้วผ่าน RLS/RPC)
const VIEW_ALL_ROLE_CODES = ["factory_manager", "general_manager"]; // มี requests.view_all เหมือน admin
const DEPT_MANAGER_ROLE_CODES = ["department_manager", "assistant_department_manager"]; // ผู้ช่วยทำแทนผู้จัดการแผนกได้ (ตรงกับ RPC)

// บทบาทที่ใช้รับงานอนุมัติ/แจ้งเตือน: admin เลือกทำหน้าที่บทบาทอื่นได้ (employees.acting_role_id)
// ต้องตรงกับ coalesce(acting_role_id, role_id) ใน 20261003010000_admin_acting_role.sql
function actingRoleId(employee) {
  return employee?.acting_role_id || employee?.role_id;
}
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
// โมดูลที่แยกไฟล์ไว้ใน modules/*.js (โหลดก่อน app.js) ลงทะเบียนตัวเองไว้ที่ window.MNP_REQUEST_MODULES
// โมดูลจะโผล่ในหน้าสร้างคำร้องเมื่อ enabled และ request_types ในฐานข้อมูลเป็น is_active ด้วย
const REQUEST_MODULES = window.MNP_REQUEST_MODULES ?? {};
function requestModule(code) {
  return REQUEST_MODULES[code] ?? null;
}
// หน้าเฉพาะของโมดูลแยกไฟล์ (เช่น #/ncr ของ module-ncr.js) — โมดูลประกาศ pages: { <path>: async (params) => … }
// และ nav: [{ path, label, icon }] เพื่อให้มีลิงก์ในเมนูหลัก
function requestModulePage(path) {
  for (const entry of Object.values(REQUEST_MODULES)) {
    if (entry.enabled && typeof entry.pages?.[path] === "function") return entry.pages[path];
  }
  return null;
}
// โมดูลที่รองรับโหมดทดสอบแล้วประกาศ sandbox: true — NCR (ฐานข้อมูลแยกข้อมูลทดสอบแล้ว) และฝ่ายโรงงาน (หน้าทดลอง ไม่อ่าน/เขียนฐานข้อมูล)
// โมดูลอื่นถูกซ่อน และฐานข้อมูลปฏิเสธการเขียนของโมดูลที่ยังไม่รองรับ (SANDBOX_MODULE_UNSUPPORTED)
const isSandboxMode = () => Boolean(state.employee?.isSandbox);
const sandboxSupports = (entry) => !isSandboxMode() || entry.sandbox === true;
function sandboxRouteAllowed(path, params) {
  if (path === "new" || path === "repair/new") return false;
  if (path === "requests") return params.get("mode") === "create";
  const entry = Object.values(REQUEST_MODULES).find((item) => item.enabled && typeof item.pages?.[path] === "function");
  return Boolean(entry?.sandbox);
}
// เมนูข้างของโมดูลแยกไฟล์: รายการที่ประกาศ sandboxOnly โผล่เฉพาะในโหมดทดสอบ เพราะโหมดทดสอบซ่อนหน้าคำร้อง
// ซึ่งเป็นทางเข้าปกติของโมดูล (เช่น หน้า NCR) ผู้ใช้ปกติเข้าหน้าของโมดูลจากหน้าคำร้อง ไม่มีเมนูข้างแยก
// รายการเมนูประกาศ subnav(active) เพื่อวางเมนูย่อยใต้ลิงก์ของตัวเองได้ (คืน HTML หรือสตริงว่างถ้าไม่แสดง)
// เมนูย่อยต้องใช้ลิงก์ (<a href="#/…">) ที่อยู่ใน .nav-sub เพื่อให้ปิดลิ้นชักบนมือถือและโหลดหน้าใหม่ตามกติกาของ bindShell
function requestModuleNavLinks(active) {
  return Object.values(REQUEST_MODULES)
    .filter((entry) => entry.enabled && sandboxSupports(entry))
    .flatMap((entry) => entry.nav ?? [])
    .filter((item) => !item.sandboxOnly || isSandboxMode())
    .map((item) => {
      const link = navLink(item.path, item.label, item.icon, active);
      const sub = item.subnav?.(active) ?? "";
      return sub ? `<div class="nav-group">${link}${sub}</div>` : link;
    })
    .join("");
}
// หน้าของโมดูลแยกไฟล์ (#/ncr, #/ncr-dashboard) ที่เข้าผ่านหน้าคำร้อง ไฮไลต์เมนู "คำร้อง" นอกโหมดทดสอบ
function activeNavFor(active) {
  if (isSandboxMode()) return active;
  const isModulePage = Object.values(REQUEST_MODULES).some((entry) => entry.enabled && typeof entry.pages?.[active] === "function");
  return isModulePage ? "requests" : active;
}
function activeRequestModuleCodes() {
  const separateModuleCodes = Object.values(REQUEST_MODULES).filter((entry) => entry.enabled).map((entry) => entry.code);
  return [...new Set([...REQUEST_MODULE_CODES, ...separateModuleCodes])];
}
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
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
  // ข้อความของโมดูลแยกไฟล์มาก่อน เพราะรหัสของโมดูลอาจยาวกว่าและมีรหัสกลางซ้อนอยู่ข้างใน
  const moduleMessages = Object.assign({}, ...Object.values(REQUEST_MODULES).map((entry) => entry.errorMessages ?? {}));
  const map = {
    ...moduleMessages,
    AUTH_REQUIRED: "กรุณาเข้าสู่ระบบอีกครั้ง",
    NOT_AUTHORIZED: "คุณไม่มีสิทธิ์ดำเนินการนี้",
    SANDBOX_SCOPE_MISMATCH: "รายการนี้อยู่คนละโหมดกับที่คุณใช้อยู่ (ข้อมูลทดสอบกับข้อมูลจริงแยกจากกัน)",
    SANDBOX_MODULE_UNSUPPORTED: "โหมดทดสอบรองรับเฉพาะ NCR ตอนนี้ กรุณาออกจากโหมดทดสอบก่อนทำรายการนี้",
    SANDBOX_ATTACHMENT_UNSUPPORTED: "โหมดทดสอบยังไม่รองรับการแนบไฟล์",
    SANDBOX_NOT_ACTIVE: "ต้องเข้าโหมดทดสอบก่อนจึงจะล้างข้อมูลทดสอบได้",
    PERSONA_NOT_FOUND: "ไม่พบบัญชีทดสอบที่เลือก",
    EMPLOYEE_NOT_FOUND: "บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ",
    INVALID_ROLE: "บทบาทที่เลือกไม่ถูกต้อง กรุณาเลือกใหม่",
    TARGET_NOT_ADMIN: "บทบาทหลักในการทำงานตั้งได้เฉพาะบัญชีที่มีตำแหน่งผู้ดูแลระบบ",
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
    INVALID_MACHINE_CODE: "รหัสเครื่องจักรต้องมี 2–40 ตัวอักษร ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข ภาษาไทย และ - . _ / ( ) + โดยต้องขึ้นต้นด้วยตัวอักษรหรือตัวเลข",
    INVALID_MACHINE_NAME: "ชื่อเครื่องจักรต้องมี 2–120 ตัวอักษร",
    MACHINE_CODE_RESERVED: "ใช้คำว่า \"สร้างใหม่\" หรือ \"ไม่มี\" เป็นรหัสเครื่องจักรไม่ได้",
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
    EXPECTED_DATE_IN_PAST: "วันที่คาดว่าจะเสร็จใหม่ต้องเป็นวันนี้หรือหลังจากนี้",
    EXPECTED_DATE_UNCHANGED: "วันที่ที่เลือกตรงกับกำหนดเสร็จเดิม",
    REQUEST_NOT_RESCHEDULABLE: "แก้วันที่คาดว่าจะเสร็จได้เฉพาะใบแจ้งซ่อมที่รอช่างเริ่มงานหรือกำลังซ่อม",
    NOTE_TOO_LONG: "หมายเหตุต้องไม่เกิน 500 ตัวอักษร",
    HOLIDAY_DATE_REQUIRED: "กรุณาเลือกวันที่หยุด",
    HOLIDAY_NAME_REQUIRED: "กรุณาระบุชื่อวันหยุด 1–100 ตัวอักษร",
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
  // เพดานต่อไฟล์อยู่ที่ modules/attachment-image.js ที่เดียว (ฐานข้อมูลและ bucket ตรวจซ้ำอีกชั้น)
  const maxBytes = window.MNP_ATTACHMENT_IMAGE?.MAX_FILE_BYTES;
  if (maxBytes && value.size > maxBytes) throw new Error(`ไฟล์ต้องมีขนาดไม่เกิน ${maxBytes / 1048576} MB`);
  if (!ALLOWED_ATTACHMENT_TYPES.has(value.type)) {
    // บอกชนิดที่ตรวจเจอด้วย ผู้ใช้จะได้รู้ว่าไฟล์ไหนไม่ผ่านและต้องแปลงเป็นอะไร
    const detected = (/\.([A-Za-z0-9]+)$/.exec(value.name)?.[1] ?? value.type) || "ไม่ทราบชนิด";
    throw new Error(`ชนิดไฟล์ไม่รองรับ (${detected.toUpperCase()}) · แนบได้เฉพาะรูปภาพ, PDF, TXT, DOCX, XLSX`);
  }
  return value;
}

// แนบได้หลายไฟล์พร้อมกัน: ตรวจทีละไฟล์ด้วย optionalAttachment แล้วตรวจจำนวนและขนาดรวมของทั้งชุด (รวมไม่เกิน 20 MB)
// รับ FileList หรืออาร์เรย์ของไฟล์ คืนอาร์เรย์ไฟล์ที่เลือกจริง (ไม่มี = อาร์เรย์ว่าง) โยน Error ข้อความไทยถ้าไม่ผ่าน
function optionalAttachments(fileList) {
  const list = Array.from(fileList ?? []);
  const files = list.map((file) => {
    try {
      return optionalAttachment(file);
    } catch (error) {
      // เลือกหลายไฟล์ต้องบอกว่าไฟล์ไหนไม่ผ่าน
      throw list.length > 1 ? new Error(`${file.name}: ${error.message}`) : error;
    }
  }).filter(Boolean);
  const batchError = window.MNP_ATTACHMENT_IMAGE?.checkBatch(files);
  if (batchError) throw new Error(batchError);
  return files;
}

// ข้อความใต้ช่องแนบไฟล์ทุกหน้า ใช้ชุดเดียวกับฝั่ง Next.js (modules/attachment-image.js)
const ATTACHMENT_HINT = window.MNP_ATTACHMENT_IMAGE?.HINT ?? "";

// รูปจากโทรศัพท์ (HEIC ของ iPhone, ไฟล์ที่ไม่ระบุชนิด, รูปใหญ่เกิน 4 MB) ถูกแปลงเป็น JPEG ในเบราว์เซอร์
// ทันทีที่เลือกไฟล์ ก่อนถึงโค้ดตรวจ/อัปโหลดข้างบน — ดู modules/attachment-image.js
// onSelection แสดงตัวอย่างไฟล์ที่เลือกก่อนอัปโหลด (modules/attachment-preview.js ใช้ loadPdfjs ของไฟล์นี้ร่วมกับแกลเลอรี)
window.MNP_ATTACHMENT_IMAGE?.bindFileInputs({
  notify: showToast,
  onSelection: (input, files) => window.MNP_ATTACHMENT_PREVIEW?.renderSelection(input, files, { loadPdfjs }),
});

// อัปโหลดทีละไฟล์ ไฟล์ไหนไม่ผ่านไม่ทำให้ไฟล์ที่เหลือหยุด (แต่ละไฟล์ล้างของตัวเองเมื่อพลาด) คืนรายชื่อไฟล์ที่ไม่สำเร็จให้ผู้เรียกแจ้งผู้ใช้
async function uploadAttachmentBatch(files, uploadOne) {
  const failed = [];
  for (const file of files) {
    try {
      await uploadOne(file);
    } catch (error) {
      failed.push({ name: file.name, error });
    }
  }
  return { total: files.length, failed };
}

function attachmentBatchFailureText({ total, failed }) {
  const names = failed.map((item) => item.name).join(", ");
  return `แนบไฟล์ไม่สำเร็จ ${failed.length} จาก ${total} ไฟล์ (${names}) · ${friendlyError(failed[0].error)}`;
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

// bucket: ไฟล์แนบคำร้องใช้ request-attachments ส่วน NCR ใช้ ncr-attachments (modules/module-ncr.js)
async function hydrateAttachmentGallery(files, bucket = "request-attachments") {
  if (!files.length || !document.querySelector("#attachment-gallery")) return;
  attachmentPreviews.clear();
  const { data, error } = await sb.storage
    .from(bucket)
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

// กรอบแสดงเลขที่เอกสารถัดไปบนฟอร์มสร้างคำร้องทุกโมดูล (เลขจริงถูกจองตอนส่งใบ จึงเป็นค่าโดยประมาณ)
function docNumberBoxHtml(id) {
  return `<div class="doc-number-box" id="${id}"><span class="doc-number-label">เลขที่เอกสาร</span><strong class="doc-number-value">—</strong></div>`;
}

function setDocNumberBox(id, value) {
  const box = document.querySelector(`#${id}`);
  if (box) box.querySelector(".doc-number-value").textContent = value || "—";
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
              <strong class="request-card-code" style="background:${requestTypeGradient(type?.code)}">${escapeHtml(requestCode(request.request_no))}</strong>
              <span class="request-card-type" style="background:${requestTypeGradient(type?.code)}">${escapeHtml(type?.name_th ?? "คำร้อง")}</span>
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
              <strong class="request-card-code" style="background:${requestTypeGradient(row.type_code)}">${escapeHtml(requestCode(row.request_no))}</strong>
              <span class="request-card-type" style="background:${requestTypeGradient(row.type_code)}">${escapeHtml(row.type_name_th ?? "คำร้อง")}</span>
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
  INVALID_EMAIL: "กรุณากรอกอีเมลให้ถูกต้อง",
  INVALID_PHONE: "กรุณากรอกเบอร์ติดต่อให้ถูกต้อง (อย่างน้อย 9 หลัก)",
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
  EMAIL_TAKEN: "อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว",
  CANNOT_DELETE_SELF: "ลบบัญชีของตัวเองไม่ได้",
  INVALID_SETUP_TOKEN: "ลิงก์ตั้งรหัสผ่านไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อขอตั้งรหัสผ่านใหม่",
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

  // ดอกจันแดงบอกช่องที่ต้องกรอก แสดงเฉพาะฟอร์มขอเปิดบัญชี (ฟอร์มเข้าสู่ระบบมีแค่ 2 ช่องซึ่งต้องกรอกทั้งคู่อยู่แล้ว)
  const req = isRequest ? ` <span class="required-mark" aria-hidden="true">*</span>` : "";
  const requestFields = `
    <div class="field-row">
      <div class="field"><label for="first-name">ชื่อ${req}</label><input class="input" id="first-name" name="first_name" maxlength="100" required></div>
      <div class="field"><label for="last-name">นามสกุล${req}</label><input class="input" id="last-name" name="last_name" maxlength="100" required></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="department">แผนก${req}</label><select class="input" id="department" name="department_id" required><option value="">เลือกแผนก</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
      <div class="field"><label for="desired-role">ตำแหน่ง${req}</label><select class="input" id="desired-role" name="role_id" required><option value="">เลือกตำแหน่ง</option>${roles.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="job-title">ชื่อตำแหน่งงาน (ถ้ามี)</label><input class="input" id="job-title" name="job_title" maxlength="120"></div>
    <div class="field-row">
      <div class="field"><label for="email">อีเมล${req}</label><input class="input" id="email" name="email" type="email" maxlength="200" required autocomplete="email"></div>
      <div class="field"><label for="phone">เบอร์ติดต่อ${req}</label><input class="input" id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" pattern="[0-9+\\- ]{9,40}" title="กรอกเบอร์โทรอย่างน้อย 9 หลัก (ตัวเลข, +, - หรือเว้นวรรค)" placeholder="เช่น 0812345678" required></div>
    </div>`;

  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-aside">
        <div class="brand"><div class="brand-mark">M</div><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></div>
        <div class="auth-copy">
          <div class="eyebrow">Employee workspace</div>
          <h1>ระบบจัดการเอกสาร<br>ภายในองค์กร</h1>
          <p>สร้าง ส่ง อนุมัติ และติดตามเอกสารงานทุกประเภทในระบบเดียว ตั้งแต่คำร้อง ใบขออนุมัติ จนถึงเอกสารการผลิต ไม่ต้องใช้กระดาษ ไม่ต้องถามว่าถึงไหนแล้ว</p>
        </div>
        <div class="auth-points"><span>✓ เอกสารดิจิทัล</span><span>✓ อนุมัติตามสายงาน</span><span>✓ ติดตามสถานะได้</span><span>✓ ค้นย้อนหลังได้</span></div>
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
            <div class="field"><label for="employee-no">UserID${req}</label><input class="input" id="employee-no" name="employee_no" autocomplete="username" maxlength="32" placeholder="เช่น MNP0102" required></div>
            ${isRequest ? requestFields : ""}
            <div class="field"><label for="password">รหัสผ่าน${req}</label><input class="input" id="password" name="password" type="password" autocomplete="${isRequest ? "new-password" : "current-password"}" minlength="8" maxlength="72" required><small>อย่างน้อย 8 ตัวอักษร</small></div>
            ${isRequest ? `<div class="field"><label for="confirm-password">ยืนยันรหัสผ่าน${req}</label><input class="input" id="confirm-password" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
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
  state.session = null;
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

// ล็อกอินครั้งเดียวแล้วอยู่ในระบบตลอด: ออกจากระบบให้เองเฉพาะเมื่อบัญชีใช้ต่อไม่ได้จริง
// (ถูกลบ/ปิดใช้งาน หรือ session ถูกยกเลิกฝั่งเซิร์ฟเวอร์) — เน็ตหลุด/เซิร์ฟเวอร์ตอบช้าตอนเปิดแอป
// ต้องไม่ทำให้หลุดจากระบบ เพราะ signOut() จะลบ refresh token ทิ้งและบังคับให้ล็อกอินใหม่
function isAccountGoneError(error) {
  const code = String(error?.code ?? "");
  if (["EMPLOYEE_NOT_LINKED", "AUTH_REQUIRED", "PGRST301", "PGRST303", "refresh_token_not_found", "session_not_found", "user_not_found"].includes(code)) return true;
  if (error?.status === 401) return true;
  return /JWT|refresh token not found|session_not_found|user_not_found/i.test(String(error?.message ?? ""));
}

// access token หมดอายุ/ถูกปฏิเสธ (มือถือพักเครื่องนาน นาฬิกาเครื่องคลาด) ยังไม่ได้แปลว่าบัญชีใช้ไม่ได้
// ต้องลองต่ออายุด้วย refresh token ก่อน แล้วออกจากระบบเฉพาะเมื่อ Supabase ปฏิเสธ refresh token จริง
function isRejectedTokenError(error) {
  const code = String(error?.code ?? "");
  if (["PGRST301", "PGRST303"].includes(code) || error?.status === 401) return true;
  return /JWT/i.test(String(error?.message ?? ""));
}

async function loadEmployeeKeepingSession() {
  try {
    return await loadEmployee();
  } catch (error) {
    if (!isRejectedTokenError(error)) throw error;
    const { data, error: refreshError } = await sb.auth.refreshSession();
    // เน็ตหลุดระหว่างต่ออายุ: session ยังอยู่ในเครื่อง ให้ขึ้นหน้าเชื่อมต่อไม่ได้แทนการออกจากระบบ
    if (refreshError?.name === "AuthRetryableFetchError") throw refreshError;
    if (refreshError || !data.session) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
    state.session = data.session;
    return await loadEmployee();
  }
}

async function signOutLocally(message) {
  state.session = null;
  try {
    await sb.auth.signOut({ scope: "local" });
  } catch (error) {
    console.error(error);
  }
  state.employee = null;
  state.unread = 0;
  if (message) showToast(message, "error");
}

function renderConnectionError(error) {
  console.error(error);
  app.innerHTML = `<main class="boot-screen"><div class="brand-mark">M</div><h2>เชื่อมต่อระบบไม่ได้</h2><p>ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง คุณยังอยู่ในระบบ ไม่ต้องเข้าสู่ระบบใหม่</p><button class="btn" id="reconnect-button" type="button">ลองอีกครั้ง</button></main>`;
  document.querySelector("#reconnect-button")?.addEventListener("click", startApp);
}

async function loadEmployee() {
  if (!state.session?.user) return null;
  const { data, error } = await sb
    .from("employees")
    .select("id,employee_no,first_name,last_name,email,phone,job_title,department_id,role_id,acting_role_id,manager_id,role:roles(code,name_th),department:departments(code,name_th)")
    .eq("auth_user_id", state.session.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน"), { code: "EMPLOYEE_NOT_LINKED" });
  const { data: modulesData, error: modulesError } = await sb.rpc("app_my_approval_modules");
  if (modulesError) throw modulesError;
  state.employee = {
    ...data,
    role: relation(data.role),
    department: relation(data.department),
    approvalModules: new Set((modulesData ?? []).map((item) => item.code)),
  };
  await applySandboxOverlay();
  return state.employee;
}

// โหมดทดสอบของ admin: ฐานข้อมูลให้ NCR ทำงานตามบัญชีทดสอบ (persona) ที่ admin เลือก
// หน้าเว็บจึงต้องใช้ persona เป็น "ผู้ใช้ปัจจุบัน" ด้วย ปุ่มและสิทธิ์ที่แสดงจะตรงกับที่ฐานข้อมูลยอมรับ
// ผู้ใช้ทั่วไปไม่ถูกเรียก RPC นี้ และถ้าฐานข้อมูลยังไม่มีฟังก์ชัน (ยังไม่ได้ db push) admin ยังใช้งานตามปกติ
async function applySandboxOverlay() {
  state.sandbox = null;
  if (state.employee?.role?.code !== "admin") return;
  const { data, error } = await sb.rpc("app_sandbox_status");
  if (error) {
    console.warn("sandbox status unavailable", error);
    return;
  }
  state.sandbox = data;
  if (!data?.active || !data.persona) return;
  state.employee = {
    ...data.persona,
    phone: null,
    acting_role_id: null,
    manager_id: null,
    approvalModules: new Set(),
    isSandbox: true,
  };
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
  signout: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>`,
};

function navLink(path, label, icon, active, { featured = false, badge = 0, href = `#/${path}` } = {}) {
  const isActive = active === path;
  const badgeText = badge > 99 ? "99+" : badge;
  return `<a class="nav-link${isActive ? " active" : ""}${featured ? " nav-create" : ""}" href="${escapeHtml(href)}" aria-label="${escapeHtml(label)}"${isActive ? ` aria-current="page"` : ""}>
    <span class="nav-icon-wrap"><span class="nav-icon">${icon}</span>${badge ? `<span class="nav-count" aria-label="${badgeText} รายการใหม่">${badgeText}</span>` : ""}</span>
    <span class="nav-text">${escapeHtml(label)}</span>
  </a>`;
}

function shell(content, active, title) {
  const employee = state.employee;
  active = activeNavFor(active);
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
          ${isSandboxMode() ? "" : `${navLink("dashboard", "หน้าหลัก", NAV_ICONS.dashboard, active)}
          ${navLink("requests", "คำร้อง", NAV_ICONS.requests, active, { href: window.MNP_REQUEST_CENTER.overviewUrl() })}
          ${navLink("approvals", "รออนุมัติ", NAV_ICONS.approvals, active)}`}
          ${requestModuleNavLinks(active)}
          ${isSandboxMode() ? "" : navLink("notifications", "การแจ้งเตือน", NAV_ICONS.notifications, active, { badge: state.unread })}
          <div class="nav-divider"></div>
          ${employee.role?.code === "admin" ? navLink("admin", "ผู้ดูแลระบบ", NAV_ICONS.admin, active) : ""}
          ${navLink("profile", "ข้อมูลส่วนตัว", NAV_ICONS.profile, active)}
          <button class="nav-link nav-signout signout-button" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <span class="nav-icon-wrap"><span class="nav-icon">${NAV_ICONS.signout}</span></span>
            <span class="nav-text">ออกจากระบบ</span>
          </button>
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
            ${isSandboxMode() ? "" : `<a class="icon-button notification-link" href="#/notifications" aria-label="การแจ้งเตือน">♧${state.unread ? `<span class="notification-count">${state.unread}</span>` : ""}</a>`}
          </div>
        </header>
        <div class="content">${sandboxBannerHtml()}${content}</div>
      </main>
    </div>`;
}

// แถบโหมดทดสอบ: แสดงทุกหน้าเมื่อ admin อยู่ในโหมดทดสอบ สลับบัญชีทดสอบ/ล้างข้อมูล/ออกได้จากที่นี่
function sandboxBannerHtml() {
  if (!isSandboxMode()) return "";
  const personas = state.sandbox?.personas ?? [];
  const current = state.employee.id;
  return `<div class="sandbox-banner" role="status">
    <div class="sandbox-banner-copy"><strong>โหมดทดสอบ</strong><span>ข้อมูลแยกจากระบบจริง ไม่ส่งแจ้งเตือนหรืออีเมลถึงใคร · บันทึกข้อมูลได้เฉพาะ NCR (ฝ่ายโรงงานเป็นหน้าทดลอง ยังไม่บันทึกข้อมูล) · ไม่รองรับการแนบไฟล์</span></div>
    <div class="sandbox-banner-actions">
      <label for="sandbox-persona">ทำหน้าที่เป็น</label>
      <select class="input" id="sandbox-persona">${personas.map((persona) => `<option value="${escapeHtml(persona.id)}"${persona.id === current ? " selected" : ""}>${escapeHtml(persona.job_title ?? `${persona.first_name} ${persona.last_name}`)} · ${escapeHtml(persona.department?.code ?? "")}</option>`).join("")}</select>
      <button class="btn secondary small" type="button" id="sandbox-purge">ล้างข้อมูลทดสอบ</button>
      <button class="btn small" type="button" id="sandbox-exit">ออกจากโหมดทดสอบ</button>
    </div>
  </div>`;
}

async function afterSandboxChange(route) {
  await loadEmployee();
  state.directory = null;
  if (route && location.hash !== `#/${route}`) {
    go(route);
    return;
  }
  await renderRoute();
}

async function enterSandbox(personaId, route) {
  const { error } = await sb.rpc("app_sandbox_enter", { p_persona_id: personaId });
  if (error) throw error;
  await afterSandboxChange(route);
}

async function exitSandbox() {
  const { error } = await sb.rpc("app_sandbox_exit");
  if (error) throw error;
  await afterSandboxChange("admin?tab=sandbox");
}

function bindSandboxBanner() {
  document.querySelector("#sandbox-persona")?.addEventListener("change", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await enterSandbox(event.currentTarget.value);
    } catch (error) {
      showToast(friendlyError(error), "error");
      await renderRoute();
    }
  });
  document.querySelector("#sandbox-exit")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await exitSandbox();
    } catch (error) {
      event.currentTarget.disabled = false;
      showToast(friendlyError(error), "error");
    }
  });
  document.querySelector("#sandbox-purge")?.addEventListener("click", async (event) => {
    if (!confirm("ล้างใบ NCR ทดสอบทั้งหมดและเริ่มนับเลข TEST- ใหม่ ?\n\nล้างเฉพาะข้อมูลทดสอบ ข้อมูลจริงไม่ถูกแตะ")) return;
    event.currentTarget.disabled = true;
    try {
      const { data, error } = await sb.rpc("app_sandbox_purge_ncr");
      if (error) throw error;
      showToast(`ล้างข้อมูลทดสอบแล้ว ${data?.deleted ?? 0} ใบ`);
      if (location.hash === "#/ncr") await renderRoute();
      else go("ncr");
    } catch (error) {
      event.currentTarget.disabled = false;
      showToast(friendlyError(error), "error");
    }
  });
}

function bindShell() {
  bindSandboxBanner();
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
  document.querySelectorAll(".nav-link, .nav-sub a").forEach((link) => link.addEventListener("click", () => setMobileNav(false)));
  // เมนูด้านข้างพาไปหน้าหลักของเมนูนั้นเสมอ — กดเมนูของหน้าที่เปิดอยู่ (ลิงก์เดิมจึงไม่เกิด hashchange)
  // ให้วาดหน้าใหม่เอง เพื่อปิดแผง/ตารางที่เปิดค้างไว้ และเริ่มจากบนสุดของหน้า
  document.querySelectorAll('.sidebar a[href^="#/"]').forEach((link) => link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    window.scrollTo(0, 0);
    if (link.hash === location.hash) renderRoute();
  }));
  document.onkeydown = (event) => {
    if (event.key === "Escape") setMobileNav(false);
  };
  document.querySelector(".theme-toggle")?.addEventListener("click", toggleTheme);
  // ปุ่มออกจากระบบมี 2 จุด: ท้ายแถบข้าง (จอกว้าง) และในเมนูหลัก (จอแคบ/มือถือ ซึ่งซ่อนแถบผู้ใช้)
  document.querySelectorAll(".signout-button").forEach((button) => button.addEventListener("click", async () => {
    setMobileNav(false);
    state.session = null;
    try {
      await sb.auth.signOut();
    } catch (error) {
      console.error(error);
    }
    state.employee = null;
    state.unread = 0;
    location.hash = "";
    await renderAuth();
  }));
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
    // admin ที่เลือก "บทบาทที่ทำหน้าที่" ไว้ เห็นเฉพาะขั้นของบทบาทนั้น (ยังเปิดใบอื่นอนุมัติได้ตามสิทธิ์ admin)
    if (employee.role?.code === "admin" && !employee.acting_role_id) return true;
    if (step.approver_employee_id && step.approver_employee_id === employee.id) return true;
    const roleMatches = Boolean(step.approver_role_id) && step.approver_role_id === actingRoleId(employee) &&
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
        return DEPT_MANAGER_ROLE_CODES.includes(employee.role?.code) && employee.department_id === request.request_type?.owning_department_id;
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
    .select("id,request_no,title,description,status,priority,created_at,updated_at,needed_date,machine_code,machine_name,requester_id,assignee_id,request_type:request_types(name_th,code,uses_repair_workflow),request_technicians(technician_id)")
    .order("created_at", { ascending: false })
    .limit(20);
  // เดิมกรอง requester_id ทิ้งเหมือนหน้าคำร้อง ทำให้การ์ดสรุปและ "ความเคลื่อนไหวล่าสุด"
  // ของหัวหน้าแผนก/ช่างเป็นศูนย์ทั้งหน้า — ปล่อยให้ RLS เป็นตัวตัดสินเหมือนกัน
  const [requestsResult, typesResult, pending, repairTasks, directory, myRequestsResult, inProgressResult, completedResult] = await Promise.all([
    requestsQuery,
    sb.from("request_types").select("id,code,name_th,description").eq("is_active", true).in("code", activeRequestModuleCodes()).order("sort_order").limit(5),
    getPendingApprovals(),
    getMyRepairActionItems(),
    loadEmployeeDirectory(),
    sb.from("requests").select("id", { count: "exact", head: true }).eq("requester_id", employee.id),
    // นับจริงจากฐานข้อมูล (ตาม RLS) ไม่ใช่จาก 20 ใบล่าสุด เพื่อให้ตัวเลขตรงกับรายการที่เปิดดูจากการ์ด
    sb.from("requests").select("id", { count: "exact", head: true }).in("status", ["approved", "in_progress"]),
    sb.from("requests").select("id", { count: "exact", head: true }).eq("status", "completed"),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (typesResult.error) throw typesResult.error;
  if (myRequestsResult.error) throw myRequestsResult.error;
  if (inProgressResult.error) throw inProgressResult.error;
  if (completedResult.error) throw completedResult.error;
  const requests = requestsResult.data ?? [];
  const myRequestCount = myRequestsResult.count ?? 0;
  const inProgress = inProgressResult.count ?? 0;
  const completed = completedResult.count ?? 0;
  const actionableCount = pending.length + repairTasks.length;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Pilot workspace</div><h1>สวัสดี, ${escapeHtml(employee.first_name)}</h1><p>ภาพรวมรายการที่เกี่ยวข้องกับคุณและงานที่ต้องดำเนินการ</p></div><span class="muted small">${formatDate(new Date(), false)}</span></div>
    <section class="summary-grid">
      ${dashboardListToggle("actions", actionableCount, actionableCount ? "มีรายการที่ต้องดำเนินการ" : "ไม่มีงานค้าง")}
      ${dashboardListToggle("mine", myRequestCount, "เฉพาะที่คุณเป็นผู้แจ้ง")}
      ${dashboardListToggle("in_progress", inProgress, "อนุมัติแล้วหรือกำลังทำ")}
      ${dashboardListToggle("completed", completed, "ปิดงานเรียบร้อย")}
    </section>
    <section class="card flush dashboard-list-panel" id="dashboard-list-panel" aria-labelledby="dashboard-list-heading" hidden>
      <div class="card-heading"><h2 id="dashboard-list-heading"></h2><span class="muted small" id="dashboard-list-note"></span></div>
      <div id="dashboard-list-body"></div>
    </section>
    <div class="dashboard-grid">
      <section class="card flush"><div class="card-heading"><h2>ความเคลื่อนไหวล่าสุด</h2><a href="#/requests">ดูทั้งหมด →</a></div>${requestRows(requests.slice(0, 7), { directory })}</section>
      <section class="card flush"><div class="card-heading"><h2>คำร้องแยกตามประเภท</h2><a href="#/requests?type=all">ทุกประเภท →</a></div><div class="quick-list">${(typesResult.data ?? []).map((type) => `<a class="quick-link" href="#/requests?type=${encodeURIComponent(type.id)}"><span class="quick-icon">▤</span><span><strong>${escapeHtml(type.name_th)}</strong><small>${escapeHtml(type.description ?? "")}</small></span><span>›</span></a>`).join("")}</div></section>
    </div>`;
  app.innerHTML = shell(content, "dashboard", "หน้าหลัก");
  bindShell();
  bindDashboardLists({ pending, repairTasks });
}

// Each dashboard summary card opens its list in one panel under the cards instead of leaving
// the dashboard. Request lists reuse requestListPanel (RLS decides rows); filters match the counts.
const DASHBOARD_LISTS = {
  actions: { label: "งานที่ต้องจัดการ", note: "รออนุมัติและงานซ่อมที่ต้องดำเนินการ" },
  mine: { label: "รายการคำร้องของฉัน", note: "ทุกประเภทและทุกสถานะที่คุณเป็นผู้แจ้ง", filter: { scope: "mine" } },
  in_progress: { label: "กำลังดำเนินการ", note: "อนุมัติแล้วหรือกำลังทำ ตามสิทธิ์ของคุณ", filter: { status: "approved,in_progress" } },
  completed: { label: "เสร็จแล้ว", note: "ปิดงานเรียบร้อย ตามสิทธิ์ของคุณ", filter: { status: "completed" } },
};

function dashboardListToggle(key, count, hint) {
  return `<button class="summary summary-toggle" type="button" data-list="${key}" aria-expanded="false" aria-controls="dashboard-list-panel"><span>${DASHBOARD_LISTS[key].label}</span><strong>${count}</strong><small>${hint}</small></button>`;
}

function dashboardActionItems(pending, repairTasks) {
  if (!pending.length && !repairTasks.length) return `<div class="empty">ไม่มีงานค้าง</div>`;
  const group = (title, items) => items.length ? `<h3 class="dashboard-list-group">${title} <span class="badge">${items.length}</span></h3>${items.join("")}` : "";
  return group("รออนุมัติ", pending.map((step) => approvalStepItemHtml(step, `#/request?id=${encodeURIComponent(step.request.id)}`)))
    + group("งานซ่อมที่ต้องดำเนินการ", repairTasks.map(repairTaskItemHtml));
}

function bindDashboardLists({ pending, repairTasks }) {
  const panel = document.querySelector("#dashboard-list-panel");
  const heading = document.querySelector("#dashboard-list-heading");
  const note = document.querySelector("#dashboard-list-note");
  const body = document.querySelector("#dashboard-list-body");
  const toggles = [...document.querySelectorAll(".summary-toggle[data-list]")];
  if (!panel || !heading || !note || !body) return;
  // One load per list for this render; a failed load is dropped so the next open retries.
  const loads = new Map();
  let active = null;
  const load = (key) => {
    const { filter } = DASHBOARD_LISTS[key];
    return filter ? requestListPanel(new URLSearchParams(filter), null) : Promise.resolve(dashboardActionItems(pending, repairTasks));
  };
  toggles.forEach((toggle) => toggle.addEventListener("click", async () => {
    const key = toggle.dataset.list;
    active = active === key ? null : key;
    toggles.forEach((item) => item.setAttribute("aria-expanded", String(item.dataset.list === active)));
    panel.hidden = !active;
    if (!active) return;
    heading.textContent = DASHBOARD_LISTS[key].label;
    note.textContent = DASHBOARD_LISTS[key].note;
    body.innerHTML = `<div class="empty">กำลังโหลดข้อมูล…</div>`;
    if (!loads.has(key)) loads.set(key, load(key));
    try {
      const html = await loads.get(key);
      if (active === key) body.innerHTML = html;
    } catch (error) {
      loads.delete(key);
      console.error(error);
      if (active === key) body.innerHTML = `<div class="empty">${escapeHtml(friendlyError(error))}</div>`;
    }
  }));
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

const requestCenterUrl = window.MNP_REQUEST_CENTER.url;

let pendingModuleZoom = null;
function moduleZoomKey(params) {
  return params.get("mode") === "create" ? `create:${params.get("createType")}` : `list:${params.get("type")}`;
}

function queueModuleZoom(hash) {
  pendingModuleZoom = moduleZoomKey(new URLSearchParams(hash.split("?")[1]));
}

function playModuleZoom(params) {
  if (pendingModuleZoom !== moduleZoomKey(params)) return;
  pendingModuleZoom = null;
  const content = document.querySelector(".content");
  const createEntry = content?.querySelector(".request-create-entry");
  const revealCreate = () => createEntry?.classList.remove("module-create-pending");
  if (!content?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealCreate();
    return;
  }
  // Animate only the workspace content; navigation stays still and remains usable.
  content.getAnimations().forEach((animation) => animation.cancel());
  const animation = content.animate([
    { opacity: 0.45, transform: "translateY(8px) scale(0.96)", transformOrigin: "50% 0" },
    { opacity: 1, transform: "translateY(0) scale(1)", transformOrigin: "50% 0" },
  ], { duration: 320, easing: "cubic-bezier(0.2, 0.75, 0.25, 1)" });
  // Reveal the module's create action after entering, including cancelled animations.
  animation.finished.then(revealCreate, revealCreate);
}

function bindModuleZoom(params) {
  document.querySelectorAll(".request-type-card").forEach((card) => card.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    queueModuleZoom(card.hash);
    // Clicking the active module does not trigger hashchange; replay the zoom directly.
    if (card.hash === location.hash) playModuleZoom(params);
  }));
  playModuleZoom(params);
}

function requestsViewTabs(params) {
  const board = params.get("view") === "board";
  return `<nav class="view-tabs" aria-label="ขอบเขตการดูคำร้อง">
    <a class="view-tab${board ? "" : " active"}" ${board ? "" : 'aria-current="page"'} href="${escapeHtml(requestCenterUrl(params, { view: null }))}">รายการตามสิทธิ์</a>
    <a class="view-tab${board ? " active" : ""}" ${board ? 'aria-current="page"' : ""} href="${escapeHtml(requestCenterUrl(params, { view: "board" }))}">ติดตามสถานะทุกใบ</a>
  </nav>`;
}

function statusFilterBar(params) {
  const status = params.get("status") ?? "all";
  return `<nav class="filters" aria-label="สถานะคำร้อง">${REQUEST_STATUS_FILTERS
    .map(([value, label]) => `<a class="filter${status === value ? " active" : ""}" href="${escapeHtml(requestCenterUrl(params, { status: value }))}">${label}</a>`).join("")}</nav>`;
}

async function requestTypeCounts(types, mineOnly) {
  return new Map(await Promise.all(types.map(async (type) => {
    const ncr = type.code === "NCR_CAR";
    let query = sb.from(ncr ? "ncr_reports" : "requests").select("id", { count: "exact", head: true })
      .in("status", window.MNP_REQUEST_CENTER.pendingStatuses(type.code));
    if (!ncr) query = query.eq("request_type_id", type.id);
    if (mineOnly) query = query.eq(ncr ? "reporter_id" : "requester_id", state.employee.id);
    const { count, error } = await query;
    if (error) throw error;
    return [type.id, count ?? 0];
  })));
}

function requestCenterHeader(types, params, counts) {
  const selected = types.find((type) => type.id === params.get("type"));
  if (selected) {
    const createLabel = { MT_REPAIR: "สร้างคำร้อง / แจ้งซ่อม MT", MANAGEMENT: "สร้างคำร้องถึงฝ่ายบริหาร", NCR_CAR: "ออก NCR", IT_REPAIR: "สร้างใบแจ้งซ่อม IT" }[selected.code] ?? `สร้าง${requestTypeLabel(selected)}`;
    // ลิงก์เสริมของโมดูล (เช่น แดชบอร์ด NCR) วางข้างปุ่มสร้าง — โมดูลประกาศ headerLinks: [{ href, label, icon }]
    const headerLinks = (requestModule(selected.code)?.headerLinks ?? [])
      .map((link) => `<a class="btn" href="${escapeHtml(link.href)}">${link.icon ?? ""}${escapeHtml(link.label)}</a>`).join("");
    return `<a class="request-back-link" id="back-to-modules" href="${escapeHtml(requestCenterUrl(params, { type: "all", status: null, ncrStatus: null, view: null, q: null }))}" aria-label="ย้อนกลับไปเลือกโมดูล">‹ ย้อนกลับ</a>
      <div class="page-heading request-module-header" style="background:${requestTypeGradient(selected.code)}">
        <div class="request-module-title"><span class="type-card-badge">${escapeHtml(selected.prefix ?? "")}</span><div><div class="eyebrow">คำร้อง</div><h1>${escapeHtml(requestTypeLabel(selected))}</h1><p>${counts ? `ยังไม่จบ ${counts.get(selected.id) ?? 0} รายการตามขอบเขตที่เลือก` : "ติดตามสถานะคำร้องของโมดูลนี้"}</p></div></div>
        <div class="request-create-entry${pendingModuleZoom === moduleZoomKey(params) ? " module-create-pending" : ""}">${headerLinks}<a class="btn" id="create-request-button" href="${escapeHtml(window.MNP_REQUEST_CENTER.createUrl(params))}">＋ ${escapeHtml(createLabel)}</a></div>
      </div>`;
  }
  return `<div class="page-heading"><div><div class="eyebrow">Request Center</div><h1>คำร้อง</h1><p>เลือกโมดูลเพื่อดูสถานะและสร้างคำร้อง</p></div></div>
    <div class="request-type-heading"><h2>เลือกโมดูล</h2></div>
    <nav class="type-grid request-type-grid" aria-label="ประเภทคำร้อง">${types.map((type) => `<a class="type-card request-type-card${selected?.id === type.id ? " selected" : ""}" ${selected?.id === type.id ? 'aria-current="page"' : ""} href="${escapeHtml(requestCenterUrl(params, { type: type.id, status: null, ncrStatus: null }))}" style="background:${requestTypeGradient(type.code)}">
      <span class="request-type-top"><span class="type-card-badge">${escapeHtml(type.prefix ?? "")}</span><span class="request-type-count">${counts ? `${counts.get(type.id) ?? 0} รอดำเนินการ` : "ดูสถานะ"}</span></span>
      <span class="type-card-body"><strong>${escapeHtml(requestTypeLabel(type))}</strong><small>${selected?.id === type.id ? "กำลังแสดงประเภทนี้" : "ดูรายการและสถานะ →"}</small></span>
    </a>`).join("")}</nav>`;
}

async function renderRequestsBoard(params, types) {
  const status = params.get("status") ?? "all";
  const search = (params.get("q") ?? "").trim();
  const selected = types.find((type) => type.id === params.get("type"));
  const { data, error } = await sb.rpc("app_request_status_board", {
    p_status: status === "all" || status.includes(",") ? null : status,
    p_search: search || null,
    p_limit: 500,
  });
  if (error) throw error;
  const rows = (data ?? []).filter((row) => (!selected || row.type_code === selected.code)
    && (status === "all" || status.split(",").includes(row.status)));
  const openable = rows.filter((row) => row.can_open).length;
  const content = `${requestCenterHeader(types, params, null)}${requestsViewTabs(params)}
    ${statusFilterBar(params)}
    <form class="board-search" id="board-search-form" role="search">
      <input class="input" id="board-search-input" aria-label="ค้นหาคำร้อง" name="q" type="search" maxlength="80" placeholder="ค้นหาเลขที่ใบ ชื่อ/รหัสเครื่องจักร ผู้แจ้ง หรือแผนก" value="${escapeHtml(search)}">
      <button class="btn secondary small" type="submit">ค้นหา</button>
      ${search ? `<a class="btn secondary small" href="${escapeHtml(requestCenterUrl(params, { q: null }))}">ล้าง</a>` : ""}
    </form>
    <p class="muted small board-note">แสดง ${rows.length} รายการจากคำร้องล่าสุดไม่เกิน 500 ใบที่ตรงกับสถานะและคำค้น · เปิดรายละเอียดได้ ${openable} รายการตามสิทธิ์${selected ? "" : " · NCR แสดงในรายการตามสิทธิ์"}</p>
    <section class="request-list-panel">${statusBoardRows(rows)}</section>`;
  app.innerHTML = shell(content, "requests", "คำร้อง");
  bindShell();
  bindModuleZoom(params);
  document.querySelector("#board-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    location.hash = requestCenterUrl(params, { q: document.querySelector("#board-search-input")?.value.trim() ?? "" });
  });
}

function knownRequestStatuses(params) {
  return window.MNP_REQUEST_CENTER.statusList(params, REQUEST_STATUS_FILTERS.map(([value]) => value));
}

// RLS decides which rows this account can read; the filters only narrow the list.
async function requestListPanel(params, typeId) {
  const mineOnly = params.get("scope") === "mine";
  let query = sb.from("requests")
    .select("id,request_no,title,description,status,priority,created_at,updated_at,needed_date,machine_code,machine_name,requester_id,assignee_id,requester_name,request_type:request_types(name_th,code,uses_repair_workflow),request_technicians(technician_id)")
    .order("created_at", { ascending: false });
  if (mineOnly) query = query.eq("requester_id", state.employee.id);
  if (typeId) query = query.eq("request_type_id", typeId);
  const statuses = knownRequestStatuses(params);
  if (statuses.length) query = query.in("status", statuses);
  const [{ data, error }, directory] = await Promise.all([query, loadEmployeeDirectory()]);
  if (error) throw error;
  return `<section class="request-list-panel">${requestRows(data ?? [], { showProgress: true, showRequester: !mineOnly, directory })}</section>`;
}

async function renderRequests(params) {
  if (params.get("mode") === "create") return await renderNewRequest(params);
  loadingShell("requests", "คำร้อง");
  params = new URLSearchParams(params);
  const { data: typesData, error: typesError } = await sb.from("request_types")
    .select("id,code,prefix,name_th,description").eq("is_active", true).in("code", activeRequestModuleCodes()).order("sort_order");
  if (typesError) throw typesError;
  const types = typesData ?? [];
  const storageKey = `mnp-request-type:${state.employee.id}`;
  try {
    // URLSearchParams.size is missing before Safari 17 / Chrome 113.
    if (!window.MNP_REQUEST_CENTER.hasParams(params)) params.set("type", localStorage.getItem(storageKey) || "all");
    if (params.has("type") && params.get("type") !== "all" && !types.some((type) => type.id === params.get("type"))) params.set("type", "all");
    if (params.has("type")) localStorage.setItem(storageKey, params.get("type"));
  } catch { /* Storage may be disabled; URL filters still work. */ }
  const selected = types.find((type) => type.id === params.get("type"));
  // NCR has its own workflow and RLS-protected register, not status-board rows.
  if (selected?.code === "NCR_CAR") params.delete("view");
  history.replaceState(null, "", requestCenterUrl(params));
  const mineOnly = params.get("scope") === "mine";
  // The overview is a module chooser; fetch rows only after entering a module.
  if (!selected) {
    const counts = await requestTypeCounts(types, mineOnly);
    // Dashboard status cards count every type, so list the matching rows here instead of
    // dropping their filter.
    const statuses = knownRequestStatuses(params);
    const filterLabels = [
      ...statuses.map((value) => REQUEST_STATUS_FILTERS.find(([known]) => known === value)[1]),
      ...(mineOnly ? ["เฉพาะที่ฉันแจ้ง"] : []),
    ];
    const statusList = statuses.length
      ? `<div class="request-type-heading"><h2>คำร้องทุกประเภท · ${escapeHtml(filterLabels.join(", "))}</h2><a href="${escapeHtml(requestCenterUrl(params, { status: null }))}">ล้างตัวกรอง</a></div>${await requestListPanel(params, null)}`
      : "";
    app.innerHTML = shell(`${requestCenterHeader(types, params, counts)}<p class="muted small">จำนวนบนการ์ดคือรายการที่ยังไม่จบ${mineOnly ? "เฉพาะที่คุณแจ้ง" : "ที่คุณมีสิทธิ์ดู"} · เลือกโมดูลเพื่อแสดงรายการคำร้อง</p>${statusList}`, "requests", "คำร้อง");
    bindShell();
    bindModuleZoom(params);
    return;
  }
  if (params.get("view") === "board") return await renderRequestsBoard(params, types);
  const counts = await requestTypeCounts([selected], mineOnly);
  const scope = `<nav class="scope-switch" aria-label="ผู้เกี่ยวข้องกับคำร้อง">
    <a class="filter${mineOnly ? "" : " active"}" href="${escapeHtml(requestCenterUrl(params, { scope: null }))}">ทุกใบที่ฉันมีสิทธิ์ดู</a>
    <a class="filter${mineOnly ? " active" : ""}" href="${escapeHtml(requestCenterUrl(params, { scope: "mine" }))}">เฉพาะที่ฉันแจ้ง</a></nav>`;
  let list = "";
  if (selected.code !== "NCR_CAR") {
    list = `${statusFilterBar(params)}${await requestListPanel(params, selected.id)}`;
  }
  const ncrModule = requestModule("NCR_CAR");
  if (selected.code === "NCR_CAR" && ncrModule?.enabled) {
    list += await ncrModule.renderCenterList(params);
  }
  const content = `${requestCenterHeader(types, params, counts)}${selected.code === "NCR_CAR" ? "" : requestsViewTabs(params)}${scope}
    <p class="muted small">สิทธิ์ดูรายละเอียดและดำเนินการเป็นไปตามบัญชีของคุณ</p>${list}`;
  app.innerHTML = shell(content, "requests", "คำร้อง");
  bindShell();
  bindModuleZoom(params);
}

function dynamicDetailFields(schema, values = {}) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  return fields.map((name) => {
    const dateField = name.includes("date");
    const numeric = name === "estimated_cost" || name === "odometer";
    return `<div class="field"><label for="detail-${escapeHtml(name)}">${escapeHtml(detailFieldLabels[name] ?? name)}</label><input class="input detail-field" id="detail-${escapeHtml(name)}" name="${escapeHtml(name)}" type="${dateField ? "date" : numeric ? "number" : "text"}" value="${escapeHtml(values[name] ?? "")}" maxlength="500"></div>`;
  }).join("");
}

const requestTypeThemes = {
  IT_REPAIR: ["#60a5fa", "#1d4ed8"],
  VEHICLE_REPAIR: ["#fb923c", "#c2410c"],
  PURCHASE: ["#34d399", "#047857"],
  IT_ACCESS: ["#22d3ee", "#0e7490"],
  HR_LEAVE: ["#f472b6", "#be185d"],
  HR_TRAINING: ["#fbbf24", "#b45309"],
};
const requestTypeLabelOverrides = {
};

function requestTypeLabel(type) {
  return requestModule(type.code)?.label ?? requestTypeLabelOverrides[type.code] ?? type.name_th;
}

function requestTypeGradient(code) {
  const [from, to] = requestModule(code)?.theme ?? requestTypeThemes[code] ?? ["#60a5fa", "#1d4ed8"];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function typeCardHtml(type) {
  return `
    <button type="button" class="type-card" data-type-id="${escapeHtml(type.id)}" style="background:${requestTypeGradient(type.code)}">
      <span class="type-card-badge">${escapeHtml(type.prefix ?? "")}</span>
      <span class="type-card-body"><strong>${escapeHtml(requestTypeLabel(type))}</strong><small>${escapeHtml(type.description ?? "")}</small><span class="type-card-action">สร้างคำร้องประเภทนี้ →</span></span>
    </button>`;
}

async function renderNewRequest(params) {
  loadingShell("requests", "คำร้อง / สร้างคำร้อง");
  const { data: allTypes, error } = await sb
    .from("request_types")
    .select("id,code,prefix,name_th,description,form_schema,uses_repair_workflow")
    .eq("is_active", true)
    .in("code", activeRequestModuleCodes())
    .order("sort_order");
  if (error) throw error;
  const types = isSandboxMode() ? (allTypes ?? []).filter((type) => requestModule(type.code)?.sandbox === true) : allTypes;
  const employee = state.employee;

  // ข้อมูลที่โมดูลแยกไฟล์โหลดไว้ใช้วาดฟอร์ม (prepareForm) — โหลดครั้งเดียวต่อการเปิดหน้านี้
  const moduleFormContexts = new Map();
  async function loadModuleFormContext(separateModule) {
    if (!separateModule?.prepareForm) return null;
    if (!moduleFormContexts.has(separateModule.code)) moduleFormContexts.set(separateModule.code, await separateModule.prepareForm({ sb }));
    return moduleFormContexts.get(separateModule.code);
  }
  const requestedType = params.get("createType");
  const selectedId = requestedType && (types ?? []).some((type) => type.id === requestedType) ? requestedType : "";

  async function paint() {
    const selected = (types ?? []).find((type) => type.id === selectedId) ?? null;
    const heading = selected
      ? `<div class="page-heading"><div><div class="eyebrow">สร้างคำร้อง · กรอกรายละเอียด</div><h1>${escapeHtml(requestTypeLabel(selected))}</h1><p>${escapeHtml(selected.description || "กรอกรายละเอียดให้ครบถ้วน ระบบจะส่งเข้าสายอนุมัติให้อัตโนมัติ")}</p></div></div>`
      : `<div class="page-heading"><div><div class="eyebrow">ขั้นตอนที่ 1 · สร้างคำร้อง</div><h1>เลือกประเภทคำร้องที่จะสร้าง</h1><p>เลือกประเภทด้านล่างเพื่อเปิดแบบฟอร์ม แล้วกรอกรายละเอียดก่อนส่งคำร้อง</p></div></div>`;

    let body;
    if (!selected) {
      body = `<div class="type-grid">${(types ?? []).map((type) => typeCardHtml(type)).join("")}</div>`;
    } else if (requestModule(selected.code)?.renderCreateForm) {
      // โมดูลที่มีฟอร์มสร้างคำร้องของตัวเอง (เช่น ใบแจ้งซ่อม MT) วาดเองทั้งฟอร์ม
      const separateModule = requestModule(selected.code);
      body = separateModule.renderCreateForm(await loadModuleFormContext(separateModule), { employee });
    } else {
      const separateModule = requestModule(selected.code);
      const formContext = await loadModuleFormContext(separateModule);
      const detailFieldsHtml = separateModule?.renderFields ? separateModule.renderFields({ escapeHtml }) : dynamicDetailFields(selected.form_schema);
      body = `
        <section class="card" style="max-width:900px;margin:auto"><div id="request-message"></div><form id="request-form">
          <div class="form-grid">
            <div class="field full">${docNumberBoxHtml("request-doc-number")}</div>
            <div class="field full"><label for="title">หัวข้อ</label><input class="input" id="title" name="title" minlength="3" maxlength="200" required></div>
            <div class="field full"><label for="description">รายละเอียด</label><textarea class="textarea" id="description" name="description" minlength="3" maxlength="5000" required></textarea></div>
            <div class="field full"><label for="attachment">ไฟล์แนบ (ถ้ามี)</label><input class="input" id="attachment" name="attachment" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx"><small>${ATTACHMENT_HINT}</small></div>
            ${separateModule?.hidePriority ? "" : `<div class="field"><label for="priority">ความสำคัญ</label><select class="select" id="priority" name="priority"><option value="low">ต่ำ</option><option value="normal" selected>ปกติ</option><option value="high">สูง</option><option value="urgent">เร่งด่วน</option></select></div>
            <div></div>`}<div class="field full"><div class="form-grid">${detailFieldsHtml}</div></div>
          </div>
          ${separateModule?.renderFormSections ? separateModule.renderFormSections(formContext, { escapeHtml }) : ""}
          <div class="form-actions"><a class="btn secondary" href="#/requests">ยกเลิก</a><button class="btn" type="submit">ส่งคำร้อง</button></div>
        </form></section>`;
    }

    app.innerHTML = shell(`<a class="request-back-link" href="${escapeHtml(requestCenterUrl(params))}">‹ กลับรายการคำร้อง</a>${heading}${body}`, "requests", "คำร้อง / สร้างคำร้อง");
    document.querySelectorAll('.form-actions a[href="#/requests"], .form-actions a[href="#/ncr"]').forEach((link) => { link.href = requestCenterUrl(params); });
    bindShell();
    bindStep(selected);
    playModuleZoom(params);
  }

  function bindStep(selected) {
    document.querySelectorAll(".type-card").forEach((card) => card.addEventListener("click", () => {
      const target = requestCenterUrl(params, { mode: "create", type: card.dataset.typeId, createType: card.dataset.typeId, status: null, ncrStatus: null });
      queueModuleZoom(target);
      location.hash = target;
    }));
    if (!selected) return;

    const createFormModule = requestModule(selected.code);
    if (createFormModule?.bindCreateForm) {
      createFormModule.bindCreateForm(moduleFormContexts.get(createFormModule.code), { employee });
      return;
    }

    // ทุกโมดูล: โชว์เลขที่เอกสารถัดไปทันทีที่เลือกประเภท จะได้รู้ว่าออกถึงเลขที่เท่าไหร่แล้ว
    sb.rpc("app_peek_request_number", { p_request_type_id: selected.id }).then(({ data, error: peekError }) => {
      if (peekError || !data) throw peekError ?? new Error("EMPTY");
      setDocNumberBox("request-doc-number", data);
    }).catch(() => {
      setDocNumberBox("request-doc-number", "—");
    });

    document.querySelector("#request-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      let attachments;
      try {
        attachments = optionalAttachments(values.getAll("attachment"));
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
          p_priority: values.get("priority") ?? "normal", // ใบคำร้องถึงฝ่ายบริหารไม่มีช่องนี้ ใช้ค่าปกติ
          p_details: details,
          p_cc_department_ids: ccDepartmentIds,
        });
        if (createError) throw createError;
        triggerNotificationEmails(data);
        if (attachments.length) {
          const uploaded = await uploadAttachmentBatch(attachments, (file) => uploadRequestAttachment(data, file, employee.id));
          if (uploaded.failed.length) {
            showToast(`สร้างคำร้องแล้ว แต่${attachmentBatchFailureText(uploaded)} · กรุณาแนบใหม่ในหน้ารายละเอียด`, "error");
            go(`request?id=${encodeURIComponent(data)}`);
            return;
          }
        }
        // โมดูลแยกไฟล์เติมข้อความต่อท้ายได้ (เช่น ใบคำร้องถึงฝ่ายบริหารแสดงเลขที่เอกสาร)
        const separateModule = requestModule(selected.code);
        const docNoSuffix = separateModule?.afterCreate ? await separateModule.afterCreate({ sb, requestId: data }) : "";
        const attachedNote = attachments.length > 1 ? ` ${attachments.length} ไฟล์` : "";
        showToast(`${attachments.length ? `สร้างคำร้องและแนบไฟล์${attachedNote}สำเร็จ` : "สร้างคำร้องสำเร็จ"}${docNoSuffix}`);
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
  const directory = new Map((data ?? []).map((employee) => [employee.id, employee]));
  // บัญชีทดสอบ inactive จึงถูก RLS ซ่อน: เติมจากรายการที่ฐานข้อมูลส่งให้ admin เพื่อให้ชื่อผู้ดำเนินการในใบทดสอบแสดงครบ
  for (const persona of state.sandbox?.personas ?? []) {
    if (!directory.has(persona.id)) directory.set(persona.id, { ...persona, is_active: false });
  }
  return directory;
}

function personName(directory, id) {
  const person = directory.get(id);
  return person ? `${person.first_name} ${person.last_name}` : "—";
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

function buildRequestTimeline(request, history, steps, verifications, directory, isRepair, dateChanges = []) {
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
      if (item.to_status === "acknowledged") return step.status === "acknowledged";
      if (["approved", "pending_assign"].includes(item.to_status)) return step.status === "approved";
      return false;
    });
    const matchingVerification = closestTimelineRecord(verifications, item.created_at, (verification) => (
      (item.to_status === "completed" && verification.result === "pass")
      || (item.from_status === "pending_verify" && item.to_status === "assigned" && verification.result === "fail")
    ));

    let stage = matchingDecision?.step_name ?? "";
    if (item.to_status === "pending_approval") {
      // กลับมารออนุมัติภายหลัง (ส่งข้อมูลเพิ่ม หรือถูกย้อนกลับเพราะขาดขั้น) ใช้ขั้นที่สร้างใกล้เวลานั้น
      if (item.from_status) {
        stage = closestCreatedTimelineRecord(orderedSteps, item.created_at)?.step_name ?? "";
      } else {
        stage = orderedSteps[0]?.step_name ?? "";
      }
    }

    // note ของแถวประวัติ = ข้อความที่ผู้ตัดสินใจ/ผู้ตอบกลับพิมพ์ไว้ในรอบนั้น (บันทึกตอนเปลี่ยนสถานะ
    // จึงไม่หายเมื่อ approval_steps.comment ถูกเขียนทับในรอบถัดไป) แถวเก่าที่ไม่มี note ใช้ comment
    // ของขั้นที่ตัดสินใจใกล้เวลานั้นแทน — ตรรกะเดียวกับ src/lib/request-timeline.ts
    const note = String(item.note ?? "").trim();
    let detail = "";
    let message = "";
    if (!item.from_status) {
      detail = `${item.note || (isRepair ? "สร้างใบแจ้งซ่อม" : "สร้างและส่งคำร้อง")}${actor ? ` โดย ${actor}` : ""}`;
    } else if (item.to_status === "more_info") {
      detail = `${actor || "ผู้อนุมัติ"} ขอข้อมูลเพิ่มเติม`;
      message = note || matchingDecision?.comment || "";
    } else if (item.to_status === "rejected") {
      detail = `${actor || "ผู้อนุมัติ"} ไม่อนุมัติ${stage ? ` ในขั้น ${stage}` : ""}`;
      message = note || matchingDecision?.comment || "";
    } else if (item.to_status === "acknowledged") {
      detail = `${actor || "ผู้อนุมัติ"} รับทราบข้อมูล${stage ? ` ในขั้น ${stage}` : ""}`;
      message = note || matchingDecision?.comment || "";
    } else if (item.to_status === "pending_approval" && item.from_status === "more_info") {
      detail = `${actor || "ผู้แจ้ง"} ส่งข้อมูลเพิ่มเติมเพื่อพิจารณาอีกครั้ง`;
      message = note;
    } else if (item.to_status === "pending_approval" && item.from_status === "pending_assign") {
      detail = `${actor || "ระบบ"} ย้อนกลับไปรออนุมัติ${stage ? `ขั้น ${stage}` : ""}`;
    } else if (["approved", "pending_assign"].includes(item.to_status)) {
      detail = `${actor || "ผู้อนุมัติ"} อนุมัติ${stage ? `ขั้น ${stage}` : "คำร้อง"} แล้ว`;
      message = note || matchingDecision?.comment || "";
    } else if (item.to_status === "assigned" && item.from_status === "pending_verify") {
      detail = `${actor || "ผู้แจ้ง"} ตรวจรับไม่ผ่าน ส่งกลับให้ ${personName(directory, request.assignee_id)} ซ่อมเพิ่มเติม`;
      message = String(matchingVerification?.note ?? "").trim();
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
      message = String(matchingVerification?.note ?? "").trim();
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
      detail: message && message === note ? detail : appendTimelineNote(detail, note),
      message,
    };
  });

  // การอนุมัติขั้นกลางไม่เปลี่ยน requests.status จึงไม่มีแถวใน status history
  // เติมจาก approval_steps เพื่อให้ลำดับเหตุการณ์ไม่ขาดช่วงก่อนถึงผู้อนุมัติขั้นถัดไป
  const approvalEvents = orderedSteps.flatMap((step, index) => {
    const nextStep = orderedSteps[index + 1];
    if (step.status !== "approved" || !step.acted_at || !nextStep) return [];
    const actorName = personName(directory, step.acted_by);
    return [{
      id: `approval-${step.id}`,
      at: step.acted_at,
      title: `รออนุมัติ (${nextStep.step_name})`,
      detail: `${actorName === "—" ? "ผู้อนุมัติ" : actorName} อนุมัติขั้น ${step.step_name} แล้ว`,
      message: String(step.comment ?? "").trim(),
    }];
  });

  // การแก้วันที่คาดว่าจะเสร็จ (ปุ่มแก้วันที่ หรือแก้ไขการมอบหมาย) ไม่ใช่การเปลี่ยนสถานะ เก็บแยกไว้
  const dateChangeEvents = dateChanges.map((change) => {
    const actorName = personName(directory, change.changed_by);
    const detail = `${actorName === "—" ? "ผู้รับผิดชอบ" : actorName} แก้ไขจากกำหนดเสร็จเดิม ${change.old_date ? formatDate(change.old_date) : "(ยังไม่ได้กำหนด)"} เป็นวันที่ ${change.new_date ? formatDate(change.new_date) : "—"}`;
    return {
      id: `expected-date-${change.id}`,
      at: change.created_at,
      title: "แก้ไขกำหนดเสร็จ",
      detail: appendTimelineNote(detail, change.note),
    };
  });

  return [...statusEvents, ...approvalEvents, ...dateChangeEvents].sort((left, right) => left.at.localeCompare(right.at));
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

async function renderRequestDetail(params) {
  const id = params.get("id");
  if (!id) return renderNotFound("ไม่พบรหัสคำร้อง");
  loadingShell("requests", "รายละเอียดคำร้อง");
  const [requestResult, stepsResult, attachmentsResult, historyResult, verificationsResult, techniciansResult, progressResult, dateChangesResult, directory] = await Promise.all([
    sb.from("requests").select("*,request_type:request_types(name_th,code,uses_repair_workflow,owning_department_id),department:departments(code)").eq("id", id).maybeSingle(),
    sb.from("approval_steps").select("*").eq("request_id", id).order("step_order"),
    sb.from("request_attachments").select("*").eq("request_id", id).order("created_at"),
    sb.from("request_status_history").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("request_verifications").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("request_technicians").select("technician_id").eq("request_id", id),
    sb.from("request_progress_steps").select("*").eq("request_id", id).order("sort_order"),
    sb.from("request_expected_date_changes").select("*").eq("request_id", id).order("created_at"),
    loadEmployeeDirectory(),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (!requestResult.data) return renderNotFound("ไม่พบคำร้อง หรือคุณไม่มีสิทธิ์เข้าถึง");
  for (const result of [stepsResult, attachmentsResult, historyResult, verificationsResult, techniciansResult, progressResult, dateChangesResult]) if (result.error) throw result.error;
  const request = requestResult.data;
  const type = relation(request.request_type);
  const isRepair = Boolean(type?.uses_repair_workflow);
  const steps = stepsResult.data ?? [];
  const attachments = attachmentsResult.data ?? [];
  const history = historyResult.data ?? [];
  const verifications = verificationsResult.data ?? [];
  const timeline = buildRequestTimeline(request, history, steps, verifications, directory, isRepair, dateChangesResult.data ?? []);
  const progressSteps = progressResult.data ?? [];
  // ช่างของใบนี้ = รายชื่อในตารางช่าง (ใบเก่าก่อนรองรับหลายคนมีแต่ assignee_id จึงรวมเข้าไปด้วย)
  const assignedTechIds = [...new Set([
    ...(techniciansResult.data ?? []).map((row) => row.technician_id),
    ...(request.assignee_id ? [request.assignee_id] : []),
  ])];
  const employee = state.employee;
  // โมดูลที่มีส่วนเฉพาะในหน้ารายละเอียด (เช่น ใบแจ้งซ่อม MT) คืนข้อมูล/ส่วนที่ต้องวาดเพิ่ม
  const separateModule = requestModule(type?.code);
  const detailView = separateModule?.detailView
    ? separateModule.detailView({ request, type, steps, verifications, directory, progressSteps, assignedTechIds, employee })
    : null;
  const moduleDetail = separateModule?.loadDetail
    ? await separateModule.loadDetail({ sb, request, steps, directory, helpers: { relation, personName, appsScriptApprovalStage } })
    : null;
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
  const isRequester = request.requester_id === employee.id;
  const detailEntries = Object.entries(request.details ?? {});
  const requestFacts = [
    requestFact("ความสำคัญ", priorityLabels[request.priority], {
      icon: "!",
      tone: ["high", "urgent"].includes(request.priority) ? "danger" : "primary",
      valueClass: `priority-${request.priority}`,
    }),
    ...(detailView?.facts ?? [
      requestFact("ผู้รับผิดชอบ", personName(directory, request.assignee_id), { icon: "◎", tone: "success", wide: false }),
    ]),
    ...detailEntries.map(([key, value]) => requestFact(detailFieldLabels[key] ?? key, value, {
      icon: "•",
      tone: "primary",
      wide: String(value ?? "").length > 36,
    })),
    ...(moduleDetail?.facts ?? []).map((fact) => requestFact(fact.label, fact.value, fact.options)),
  ].join("");
  const content = `
    <header class="request-detail-head"><div class="eyebrow">${escapeHtml(request.request_no)}</div><h1>${escapeHtml(request.title)}</h1><p>${escapeHtml(type?.name_th ?? "คำร้อง")} · โดย ${escapeHtml(personName(directory, request.requester_id))} · ${formatDate(request.submitted_at, true)}</p></header>
    <div class="detail-grid">
      <div class="stack">
        <section class="card request-overview-card">
          <div class="request-overview-head"><div class="request-overview-title"><span>รายละเอียดหลัก</span><h2>ข้อมูลคำร้อง</h2></div>${detailView?.statusBadgeHtml ?? statusBadge(request.status)}</div>
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
        ${canApprove ? `<section class="card"><h2>พิจารณาคำร้อง</h2><p class="muted small">ขั้นตอน: ${escapeHtml(currentStep.step_name)}</p><div class="field"><label for="decision-comment">ความเห็น</label><textarea class="textarea" id="decision-comment" maxlength="1000"></textarea></div><div class="approval-actions"><button class="btn success decision-button" data-decision="approved">อนุมัติ</button><button class="btn warning decision-button" data-decision="more_info">ขอข้อมูลเพิ่ม</button>${(separateModule?.extraDecisions ?? []).map((item) => `<button class="btn secondary decision-button" data-decision="${escapeHtml(item.decision)}">${escapeHtml(item.label)}</button>`).join("")}<button class="btn danger decision-button" data-decision="rejected">ไม่อนุมัติ</button></div></section>` : ""}
        ${canOperate ? `<section class="card"><h2>ดำเนินงาน</h2><p class="muted small">ผู้ปฏิบัติงานสามารถรับงานและเปลี่ยนสถานะตามลำดับ</p><div class="approval-actions">${request.status === "approved" ? `<button class="btn status-button" data-status="in_progress">รับงานและเริ่มดำเนินการ</button>` : `<button class="btn success status-button" data-status="completed">บันทึกว่าเสร็จแล้ว</button>`}</div></section>` : ""}
        ${detailView?.sectionsHtml ?? ""}
      </div>
      <aside class="stack">
        <section class="card"><h2>ลำดับอนุมัติ</h2><div class="timeline">${steps.map((step) => `<div class="timeline-item"><strong>${escapeHtml(step.step_name)} · ${escapeHtml(step.status)}</strong><p>${step.acted_by ? `ดำเนินการโดย ${escapeHtml(personName(directory, step.acted_by))}` : "รอดำเนินการ"}${step.comment ? ` · ${escapeHtml(step.comment)}` : ""}</p></div>`).join("") || `<div class="muted small">ไม่มีขั้นตอนอนุมัติ</div>`}</div></section>
        <section class="card"><h2>ไฟล์แนบ</h2>${attachmentGalleryHtml(attachments)}<form id="attachment-form"><div class="field"><label for="attachment-file">แนบไฟล์</label><input class="input" id="attachment-file" name="file" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx" required><small>${ATTACHMENT_HINT}</small></div><button class="btn secondary small" type="submit">อัปโหลด</button></form></section>
        <section class="card"><h2>ลำดับเหตุการณ์</h2><div class="timeline">${timeline.map((item) => `<div class="timeline-item"><strong>${escapeHtml(item.title)}</strong><p class="timeline-item-detail">${escapeHtml(item.detail)}</p>${item.message ? `<p class="timeline-item-message">${escapeHtml(item.message)}</p>` : ""}<time class="timeline-item-time" datetime="${escapeHtml(item.at)}">${formatDate(item.at, true)}</time></div>`).join("") || `<div class="muted small">ยังไม่มีประวัติ</div>`}</div></section>
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
  separateModule?.bindDetail?.({ id, params, employee });
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
    let files;
    try {
      files = optionalAttachments(form.elements.file.files);
      if (!files.length) throw new Error("กรุณาเลือกไฟล์");
    } catch (error) {
      return showToast(friendlyError(error), "error");
    }
    setFormBusy(form, true);
    try {
      const uploaded = await uploadAttachmentBatch(files, (file) => uploadRequestAttachment(id, file, employee.id));
      if (uploaded.failed.length === files.length) {
        // ไม่มีไฟล์ไหนขึ้นเลย อยู่หน้าเดิมให้เลือกไฟล์ใหม่ได้ทันที
        showToast(attachmentBatchFailureText(uploaded), "error");
        setFormBusy(form, false);
        return;
      }
      showToast(uploaded.failed.length ? attachmentBatchFailureText(uploaded) : `อัปโหลดไฟล์แล้ว${files.length > 1 ? ` ${files.length} ไฟล์` : ""}`, uploaded.failed.length ? "error" : "success");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelector("#attachment-gallery")?.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-attachment-open]");
    if (trigger) openAttachmentLightbox(trigger.dataset.attachmentOpen);
  });
  hydrateAttachmentGallery(attachments).catch((error) => showToast(friendlyError(error), "error"));
}

function approvalItemHtml({ href, requestNo, date, title, detail, active = false }) {
  return `<a class="approval-item${active ? " active" : ""}" href="${href}"><div class="row"><span class="request-no">${escapeHtml(requestNo)}</span><time>${formatDate(date)}</time></div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></a>`;
}

function approvalStepItemHtml(step, href, active = false) {
  return approvalItemHtml({ href, requestNo: step.request.request_no, date: step.request.created_at, title: step.request.title, detail: `${relation(step.request.request_type)?.name_th ?? ""} · ${step.step_name}`, active });
}

function repairTaskItemHtml(item) {
  return approvalItemHtml({ href: `#/request?id=${encodeURIComponent(item.id)}`, requestNo: item.request_no, date: item.created_at, title: item.title, detail: `${item.request_type?.name_th ?? ""} · ${myRepairActionLabels[item.status] ?? statusLabels[item.status] ?? item.status}` });
}

async function renderApprovals(params) {
  loadingShell("approvals", "รออนุมัติ");
  const [steps, repairTasks] = await Promise.all([getPendingApprovals(), getMyRepairActionItems()]);
  const repairTasksSection = repairTasks.length ? `
    <section class="card flush repair-task-list">
      <div class="card-heading"><h2>งานซ่อมที่ต้องดำเนินการ <span class="badge">${repairTasks.length}</span></h2></div>
      ${repairTasks.map(repairTaskItemHtml).join("")}
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
      <section class="approval-list"><div class="approval-list-head"><h2>ทั้งหมด <span class="badge">${steps.length}</span></h2><p>เรียงจากรายการที่รอนานที่สุด</p></div>${steps.map((step) => approvalStepItemHtml(step, `#/approvals?request=${encodeURIComponent(step.request.id)}`, step.id === selected.id)).join("")}</section>
      <article class="approval-preview"><div class="eyebrow">${escapeHtml(request.request_no)}</div><h2>${escapeHtml(request.title)}</h2><p class="description">${escapeHtml(request.description)}</p><dl class="definition-grid"><div class="definition"><dt>ประเภท</dt><dd>${escapeHtml(relation(request.request_type)?.name_th ?? "—")}</dd></div><div class="definition"><dt>ความสำคัญ</dt><dd class="priority-${escapeHtml(request.priority)}">${escapeHtml(priorityLabels[request.priority])}</dd></div><div class="definition"><dt>ขั้นตอน</dt><dd>${escapeHtml(selected.step_name)}</dd></div><div class="definition"><dt>วันที่ส่ง</dt><dd>${formatDate(request.submitted_at, true)}</dd></div></dl><div class="approval-actions"><a class="btn" href="#/request?id=${encodeURIComponent(request.id)}">เปิดคำร้องและพิจารณา →</a></div></article>
    </div>`;
  app.innerHTML = shell(content, "approvals", "รออนุมัติ");
  bindShell();
}

// คืน null เมื่อแจ้งเตือนนี้ไม่มีหน้าปลายทาง (เช่นประกาศ/คำเชิญที่ไม่มี request_id และ action_url)
// เพื่อไม่ให้แสดงเป็นลิงก์ที่กดแล้วไม่เกิดอะไรขึ้น
function notificationHref(item) {
  if (item.request_id) return `#/request?id=${encodeURIComponent(item.request_id)}`;
  if (item.action_url === "/admin") return "#/admin";
  if (item.action_url === "/profile") return "#/profile";
  if (item.action_url?.startsWith("/ncr/")) return `#/ncr?id=${encodeURIComponent(item.action_url.slice(5))}`;
  // อีเมลสรุปงานค้าง (kind reminder/escalation): มีงานเดียวพาไปที่งานนั้นเลย (เฉพาะ reminder ซึ่งผู้รับคือผู้ถือลูก
  // และเปิดงานได้แน่นอน — สำเนาถึงหัวหน้าอาจไม่มีสิทธิ์อ่านเอกสาร) ถ้าหลายงานพาไปหน้าหลักที่มีการ์ด "งานที่ต้องจัดการ"
  if (item.action_url === "/") {
    const [only, ...rest] = Array.isArray(item.digest) ? item.digest : [];
    if (item.kind === "reminder" && only && !rest.length && typeof only.item_id === "string") {
      if (only.item_type === "ncr") return `#/ncr?id=${encodeURIComponent(only.item_id)}`;
      if (only.item_type === "request") return `#/request?id=${encodeURIComponent(only.item_id)}`;
    }
    return "#/dashboard";
  }
  return null;
}

function notificationItemHtml(item) {
  const href = notificationHref(item);
  const tag = href ? "a" : "div";
  return `<${tag} class="notification-item${item.read_at ? "" : " unread"}"${href ? ` href="${href}"` : ""}><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body ?? "")} · ${formatDate(item.created_at, true)}</span></${tag}>`;
}

async function renderNotifications() {
  loadingShell("notifications", "การแจ้งเตือน");
  const { data, error } = await sb.from("notifications").select("*").eq("recipient_id", state.employee.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Notifications</div><h1>การแจ้งเตือน</h1><p>ความเคลื่อนไหวที่เกี่ยวข้องกับบัญชีนี้</p></div>${(data ?? []).some((item) => !item.read_at) ? `<button class="btn secondary" id="mark-read">อ่านทั้งหมดแล้ว</button>` : ""}</div>
    <div class="stack">${(data ?? []).map(notificationItemHtml).join("") || `<div class="empty">ยังไม่มีการแจ้งเตือน</div>`}</div>`;
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
        <div class="field"><label for="profile-employee-no">UserID</label><input class="input" id="profile-employee-no" value="${escapeHtml(employee.employee_no)}" disabled><small>แก้ไขได้ที่การ์ด ID / รหัสผ่านด้านล่าง เพื่อให้เปลี่ยนพร้อมบัญชีเข้าใช้งานในขั้นตอนเดียว</small></div>
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
        <div class="field"><label for="new-employee-no">UserID</label><input class="input" id="new-employee-no" name="employee_no" maxlength="32" value="${escapeHtml(employee.employee_no)}" required><small>คงเดิมไว้ได้หากต้องการเปลี่ยนเฉพาะรหัสผ่าน</small></div>
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

  // บทบาทหลักในการทำงาน: ส่งเฉพาะเมื่อยังเป็นตำแหน่งผู้ดูแลระบบและค่าเปลี่ยนจริง กัน audit log รก
  const actingRoleId = String(values.get("acting_role_id") ?? "");
  const isAdminRole = String(values.get("role_id") ?? "") === form.dataset.adminRoleId;
  if (isAdminRole && actingRoleId !== String(form.dataset.actingRoleId ?? "")) {
    const { error: actingError } = await sb.rpc("app_admin_set_acting_role", {
      p_employee_id: employeeId,
      p_role_id: actingRoleId || null,
    });
    if (actingError) {
      setFormBusy(form, false);
      message.innerHTML = `<div class="form-message error">บันทึกข้อมูลแล้วแต่ยังตั้งบทบาทหลักไม่สำเร็จ: ${escapeHtml(friendlyError(actingError))} · กดบันทึกซ้ำได้</div>`;
      return;
    }
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

async function handleEmployeeAddSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#employee-add-message");
  const values = new FormData(form);
  const password = String(values.get("password") ?? "");
  if (password !== String(values.get("confirm_password") ?? "")) {
    message.innerHTML = `<div class="form-message error">รหัสผ่านทั้งสองช่องไม่ตรงกัน</div>`;
    return;
  }
  setFormBusy(form, true);
  message.innerHTML = "";
  const employeeNo = String(values.get("employee_no") ?? "").trim().toUpperCase();
  try {
    const { data: sessionData } = await sb.auth.getSession();
    await callPilotAuth({
      action: "admin_create_account",
      employeeNo,
      password,
      firstName: String(values.get("first_name") ?? ""),
      lastName: String(values.get("last_name") ?? ""),
      email: String(values.get("email") ?? ""),
      phone: String(values.get("phone") ?? ""),
      jobTitle: String(values.get("job_title") ?? ""),
      departmentId: String(values.get("department_id") ?? ""),
      roleId: String(values.get("role_id") ?? ""),
    }, sessionData.session?.access_token);
  } catch (error) {
    setFormBusy(form, false);
    message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(error))}</div>`;
    return;
  }
  showToast(`สร้างบัญชี ${employeeNo} เรียบร้อย`);
  go("admin?tab=credentials");
  await renderRoute();
}

function bangkokToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

// แท็บ "ทดสอบระบบ" (เฉพาะ admin): เลือกบัญชีทดสอบแล้วเข้าโหมดทดสอบเพื่อใช้ NCR ด้วยข้อมูลที่แยกจากของจริง
function sandboxSectionHtml() {
  const status = state.sandbox;
  if (!status) {
    return `<section class="card"><h2>ทดสอบระบบ</h2><p class="muted small">ยังใช้โหมดทดสอบไม่ได้ เพราะฐานข้อมูลยังไม่ได้อัปเดตเป็นรุ่นที่รองรับ (ต้อง <code>supabase db push</code> migration <code>20261005030000_admin_sandbox_mode</code> ก่อน)</p></section>`;
  }
  const rows = (status.personas ?? []).map((persona) => `<tr>
      <td><span class="request-no">${escapeHtml(persona.employee_no)}</span></td>
      <td>${escapeHtml(persona.job_title ?? `${persona.first_name} ${persona.last_name}`)}</td>
      <td>${escapeHtml(persona.department?.code ?? "—")}</td>
      <td>${escapeHtml(persona.role?.name_th ?? persona.role?.code ?? "—")}</td>
      <td class="center"><button class="btn small" type="button" data-sandbox-enter="${escapeHtml(persona.id)}">เข้าโหมดทดสอบ</button></td>
    </tr>`).join("") || `<tr><td colspan="5" class="muted small">ยังไม่มีบัญชีทดสอบ</td></tr>`;
  return `<section class="card">
    <h2>ทดสอบระบบ (เฉพาะผู้ดูแลระบบ)</h2>
    <p class="muted small">เลือกบัญชีทดสอบแล้วใช้งาน NCR ตามบทบาทนั้นได้ทุกขั้น (ออกใบ → พิจารณา → ตอบ → ติดตาม → ลงนาม → ยกเลิก → ความสูญเสีย) สลับบทบาทได้จากแถบสีเหลืองด้านบนของทุกหน้า</p>
    <ul class="muted small">
      <li>ข้อมูลทดสอบแยกจากของจริงที่ฐานข้อมูล: เลขที่ขึ้นต้น <code>TEST-QA…</code> ไม่กินเลข QAxxx/yy จริง ผู้ใช้จริงมองไม่เห็นใบทดสอบ และไม่มีแจ้งเตือนหรืออีเมลถึงใครเลย</li>
      <li>ระหว่างอยู่ในโหมดทดสอบ โมดูลอื่นเขียนข้อมูลไม่ได้ ต้องออกจากโหมดทดสอบก่อนทำงานจริง</li>
      <li>ยังไม่รองรับการแนบไฟล์ในโหมดทดสอบ · บันทึกการเข้า/ออก/ล้างข้อมูลอยู่ใน audit log</li>
    </ul>
    <div class="table-wrap"><table>
      <thead><tr><th>รหัส</th><th>บัญชีทดสอบ</th><th>แผนก</th><th>ตำแหน่ง</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function bindSandboxPanel() {
  document.querySelectorAll("[data-sandbox-enter]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await enterSandbox(button.dataset.sandboxEnter, "ncr");
    } catch (error) {
      button.disabled = false;
      showToast(friendlyError(error), "error");
    }
  }));
}

function holidaysSectionHtml(holidays) {
  const today = bangkokToday();
  const rows = holidays.map((holiday) => `<tr${holiday.holiday_date < today ? ' class="muted"' : ""}>
      <td>${formatDate(holiday.holiday_date)}</td>
      <td>${escapeHtml(holiday.name_th)}</td>
      <td class="center"><button class="btn secondary small" type="button" data-holiday-delete="${escapeHtml(holiday.holiday_date)}">ลบ</button></td>
    </tr>`).join("") || `<tr><td colspan="3" class="muted small">ยังไม่มีวันหยุดที่บันทึกไว้ในปีนี้</td></tr>`;
  return `<section class="card">
    <h2>วันหยุดบริษัท</h2>
    <p class="muted small">ระบบไม่ส่งอีเมลเตือนงานค้าง (08:30 และ 13:30 น.) และสำเนาถึงหัวหน้า (10:30 และ 15:30 น.) ในวันที่บันทึกไว้ที่นี่ วันอาทิตย์ข้ามให้อยู่แล้ว ไม่ต้องบันทึก บันทึกวันเดิมซ้ำจะเป็นการแก้ชื่อวันหยุด</p>
    <form id="holiday-form" class="field-row">
      <div class="field"><label for="holiday-date">วันที่</label><input class="input" id="holiday-date" name="holiday_date" type="date" required></div>
      <div class="field"><label for="holiday-name">ชื่อวันหยุด</label><input class="input" id="holiday-name" name="name_th" maxlength="100" placeholder="เช่น วันปิยมหาราช" required></div>
      <div class="form-actions"><button class="btn" type="submit">บันทึกวันหยุด</button></div>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>วันที่</th><th>ชื่อวันหยุด</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function bindHolidayForms(params) {
  document.querySelector("#holiday-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setFormBusy(form, true);
    const { error } = await sb.rpc("app_admin_set_holiday", {
      p_date: String(values.get("holiday_date") ?? "") || null,
      p_name: String(values.get("name_th") ?? "").trim(),
    });
    if (error) {
      setFormBusy(form, false);
      return showToast(friendlyError(error), "error");
    }
    showToast("บันทึกวันหยุดแล้ว");
    await renderAdmin(params);
  });
  document.querySelectorAll("[data-holiday-delete]").forEach((button) => button.addEventListener("click", async () => {
    const date = button.dataset.holidayDelete;
    if (!confirm(`ลบวันหยุด ${formatDate(date)} ?\n\nวันนั้นระบบจะกลับมาส่งอีเมลเตือนงานค้างตามปกติ`)) return;
    button.disabled = true;
    const { error } = await sb.rpc("app_admin_delete_holiday", { p_date: date });
    if (error) {
      button.disabled = false;
      return showToast(friendlyError(error), "error");
    }
    showToast("ลบวันหยุดแล้ว");
    await renderAdmin(params);
  }));
}

async function renderAdmin(params) {
  if (state.employee.role?.code !== "admin") return renderNotFound("หน้านี้สำหรับผู้ดูแลระบบเท่านั้น");
  const tab = ["accounts", "credentials", "modules", "holidays", "sandbox"].includes(params.get("tab")) ? params.get("tab") : "requests";
  state.adminTab = tab;
  loadingShell("admin", "ผู้ดูแลระบบ");

  const [requestsResult, credentialsResult, rolesResult, departmentsResult, modulePermissionsResult, actingRolesResult] = await Promise.all([
    sb.rpc("app_list_account_requests", { p_status: null }),
    sb.rpc("app_list_credentials"),
    sb.from("roles").select("id,code,name_th").order("sort_order"),
    sb.from("departments").select("id,code,name_th").eq("is_active", true).order("code"),
    sb.rpc("app_list_module_permissions"),
    sb.from("employees").select("id,acting_role_id").not("acting_role_id", "is", null),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (credentialsResult.error) throw credentialsResult.error;
  if (rolesResult.error) throw rolesResult.error;
  if (departmentsResult.error) throw departmentsResult.error;
  if (modulePermissionsResult.error) throw modulePermissionsResult.error;
  if (actingRolesResult.error) throw actingRolesResult.error;
  // วันหยุดบริษัท (ไม่ส่งอีเมลเตือนงานค้างในวันเหล่านี้) โหลดเฉพาะตอนเปิดแท็บนี้
  let holidays = [];
  if (tab === "holidays") {
    const { data, error } = await sb.from("company_holidays").select("holiday_date,name_th")
      .gte("holiday_date", `${bangkokToday().slice(0, 4)}-01-01`).order("holiday_date");
    if (error) throw error;
    holidays = data ?? [];
  }
  // โหมดทดสอบ: อ่านสถานะล่าสุดเฉพาะตอนเปิดแท็บนี้ (ใช้ผลที่โหลดตอนเข้าสู่ระบบไม่ได้เพราะอาจเปลี่ยนไปแล้ว)
  if (tab === "sandbox") {
    const { data, error } = await sb.rpc("app_sandbox_status");
    state.sandbox = error ? null : data;
  }
  const requests = requestsResult.data ?? [];
  const credentials = credentialsResult.data ?? [];
  const roles = rolesResult.data ?? [];
  const departments = departmentsResult.data ?? [];
  const modulePermissionRows = modulePermissionsResult.data ?? [];
  // บทบาทหลักในการทำงานของบัญชี admin (employees.acting_role_id) ตั้งได้ในฟอร์มแก้ไขบัญชีด้านล่าง
  const actingRoleByEmployee = new Map((actingRolesResult.data ?? []).map((row) => [row.id, row.acting_role_id]));
  const roleNameById = new Map(roles.map((role) => [role.id, role.name_th ?? role.code]));
  const adminRoleId = roles.find((role) => role.code === "admin")?.id ?? "";
  const editing = credentials.find((item) => item.employee_id === params.get("edit")) ?? null;
  const adding = !editing && params.get("add") === "1";
  const req = ` <span class="required-mark" aria-hidden="true">*</span>`;
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
      <td>${escapeHtml(item.role_code ?? "—")}${actingRoleByEmployee.has(item.employee_id) ? `<br><small class="muted">ทำงานในฐานะ ${escapeHtml(roleNameById.get(actingRoleByEmployee.get(item.employee_id)) ?? "—")}</small>` : ""}</td>
      <td><code data-password-cell="${escapeHtml(item.employee_id)}">${item.has_password ? "••••••••" : "ยังไม่มีบันทึกไว้"}</code></td>
      <td>${item.updated_at ? formatDate(item.updated_at, true) : "—"}</td>
      <td>${[
        item.has_password ? `<button class="btn secondary small" data-reveal="${escapeHtml(item.employee_id)}">แสดง</button>` : "",
        `<a class="btn secondary small" href="#/admin?tab=credentials&edit=${encodeURIComponent(item.employee_id)}">แก้ไข</a>`,
        isSelf ? "" : `<button class="btn danger small" type="button" data-delete-employee="${escapeHtml(item.employee_id)}" data-employee-label="${escapeHtml(`${item.employee_no} · ${item.full_name}`)}">ลบ</button>`,
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
      <a class="filter${tab === "holidays" ? " active" : ""}" href="#/admin?tab=holidays">วันหยุดบริษัท</a>
      <a class="filter${tab === "sandbox" ? " active" : ""}" href="#/admin?tab=sandbox">ทดสอบระบบ</a>
    </div>
    ${tab === "requests" ? `<div class="stack">${requestCards}</div>` : ""}
    ${tab === "holidays" ? holidaysSectionHtml(holidays) : ""}
    ${tab === "sandbox" ? sandboxSectionHtml() : ""}
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
      ${adding ? `
      <section class="card">
        <div class="card-head"><div><h2>เพิ่มบัญชีใหม่</h2><p class="muted small">บัญชีใช้งานได้ทันทีโดยไม่ต้องผ่านคำร้อง ระบบส่งอีเมลแจ้ง ID พร้อมลิงก์ตั้งรหัสผ่านใหม่ให้เจ้าของบัญชี</p></div><a class="btn secondary small" href="#/admin?tab=credentials">ปิด</a></div>
        <div id="employee-add-message"></div>
        <form id="employee-add-form">
          <div class="field"><label for="add-employee-no">UserID${req}</label><input class="input" id="add-employee-no" name="employee_no" maxlength="32" placeholder="เช่น MNP0102" autocomplete="off" required></div>
          <div class="field-row">
            <div class="field"><label for="add-first-name">ชื่อ${req}</label><input class="input" id="add-first-name" name="first_name" maxlength="100" required></div>
            <div class="field"><label for="add-last-name">นามสกุล${req}</label><input class="input" id="add-last-name" name="last_name" maxlength="100" required></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="add-email">อีเมล${req}</label><input class="input" id="add-email" name="email" type="email" maxlength="200" autocomplete="off" required></div>
            <div class="field"><label for="add-phone">เบอร์ติดต่อ${req}</label><input class="input" id="add-phone" name="phone" type="tel" inputmode="tel" maxlength="40" pattern="[0-9+\\- ]{9,40}" title="กรอกเบอร์โทรอย่างน้อย 9 หลัก (ตัวเลข, +, - หรือเว้นวรรค)" placeholder="เช่น 0812345678" required></div>
          </div>
          <div class="field"><label for="add-job-title">ชื่อตำแหน่งงาน (ถ้ามี)</label><input class="input" id="add-job-title" name="job_title" maxlength="120"></div>
          <div class="field-row">
            <div class="field"><label for="add-department">แผนก${req}</label><select class="input" id="add-department" name="department_id" required><option value="">เลือกแผนก</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
            <div class="field"><label for="add-role">ตำแหน่ง${req}</label><select class="input" id="add-role" name="role_id" required><option value="">เลือกตำแหน่ง</option>${roles.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="add-password">รหัสผ่าน${req}</label><input class="input" id="add-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><small>อย่างน้อย 8 ตัวอักษร</small></div>
            <div class="field"><label for="add-confirm-password">ยืนยันรหัสผ่าน${req}</label><input class="input" id="add-confirm-password" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
          </div>
          <div class="form-actions"><button class="btn" type="submit">สร้างบัญชี</button></div>
        </form>
      </section>` : ""}
      ${editing ? `
      <section class="card">
        <div class="card-head"><div><h2>แก้ไขบัญชี ${escapeHtml(editing.employee_no)}</h2><p class="muted small">แก้ไขได้ทุกช่องรวมถึง ID ตำแหน่ง และรหัสผ่าน การเปลี่ยนแปลงมีผลทันที</p></div><a class="btn secondary small" href="#/admin?tab=credentials">ปิด</a></div>
        <div id="employee-edit-message"></div>
        <form id="employee-edit-form" data-employee-id="${escapeHtml(editing.employee_id)}" data-employee-no="${escapeHtml(editing.employee_no)}" data-acting-role-id="${escapeHtml(actingRoleByEmployee.get(editing.employee_id) ?? "")}" data-admin-role-id="${escapeHtml(adminRoleId)}">
          <div class="field-row">
            <div class="field"><label for="edit-employee-no">UserID</label><input class="input" id="edit-employee-no" name="employee_no" maxlength="32" value="${escapeHtml(editing.employee_no)}" required></div>
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
          <div class="field"><label for="edit-acting-role">บทบาทหลักในการทำงาน (เฉพาะตำแหน่งผู้ดูแลระบบ)</label><select class="input" id="edit-acting-role" name="acting_role_id"${editing.role_id === adminRoleId ? "" : " disabled"}><option value="">ผู้ดูแลระบบ (รับแจ้งเตือนและเห็นรายการรออนุมัติทั้งหมด)</option>${roles.filter((item) => item.code !== "admin").map((item) => `<option value="${escapeHtml(item.id)}"${item.id === actingRoleByEmployee.get(editing.employee_id) ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select><small>สำหรับผู้ดูแลระบบที่ทำงานจริงในตำแหน่งอื่นด้วย (เช่น ผู้จัดการทั่วไป) ระบบจะส่งแจ้งเตือนและแสดงรายการรออนุมัติเฉพาะของบทบาทนั้น และนับบัญชีนี้เป็นผู้อนุมัติในสายอนุมัติของบทบาทนั้น สิทธิ์ผู้ดูแลระบบอื่นยังใช้ได้ครบ แต่จะไม่ได้รับแจ้งเตือนคำร้องเปิดบัญชี/แก้ไข ID</small></div>
          <div class="field"><label for="edit-password">ตั้งรหัสผ่านใหม่ (เว้นว่างไว้หากไม่เปลี่ยน)</label><input class="input" id="edit-password" name="password" type="password" autocomplete="new-password" maxlength="72"><small>ตั้งให้ผู้ใช้ได้ทันทีเมื่อผู้ใช้ลืมรหัสผ่าน และรหัสผ่านใหม่จะถูกบันทึกลงคลังให้อัตโนมัติ</small></div>
          <div class="form-actions"><button class="btn" type="submit">บันทึกการแก้ไข</button></div>
        </form>
      </section>` : ""}
      <section class="card">
        <div class="card-head"><div><h2>บัญชีทั้งหมด</h2></div>${adding ? "" : `<a class="btn small" href="#/admin?tab=credentials&add=1">＋ เพิ่มบัญชี</a>`}</div>
        <p class="muted small">ตารางนี้แสดงพนักงานทุกบัญชีรวมถึงบัญชีผู้ดูแลระบบและบัญชีของคุณเอง รหัสผ่านถูกปิดไว้เป็นค่าเริ่มต้น การกดแสดงถูกบันทึกลง audit log ทุกครั้งพร้อมชื่อผู้กดและเวลา บัญชีที่สร้างก่อนระบบนี้จะยังไม่มีรหัสผ่านบันทึกไว้ ให้เจ้าของบัญชีแก้ไขรหัสผ่านหนึ่งครั้งก่อน</p>
        <div class="table-wrap"><table>
          <thead><tr><th>รหัสพนักงาน</th><th>ชื่อ</th><th>แผนก</th><th>ตำแหน่ง</th><th>รหัสผ่าน</th><th>อัปเดตล่าสุด</th><th></th></tr></thead>
          <tbody>${credentialRows}</tbody>
        </table></div>
      </section>` : ""}`;

  app.innerHTML = shell(content, "admin", "ผู้ดูแลระบบ");
  bindShell();
  renderEmailDispatchStatus();
  bindHolidayForms(params);
  bindSandboxPanel();

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
  // บทบาทหลักมีความหมายเฉพาะตำแหน่งผู้ดูแลระบบ (ฐานข้อมูลล้างค่าทิ้งเมื่อไม่ใช่ admin)
  document.querySelector("#edit-role")?.addEventListener("change", (event) => {
    const actingRole = document.querySelector("#edit-acting-role");
    const adminRole = document.querySelector("#employee-edit-form")?.dataset.adminRoleId;
    if (!actingRole) return;
    actingRole.disabled = event.currentTarget.value !== adminRole;
    if (actingRole.disabled) actingRole.value = "";
  });
  document.querySelector("#employee-add-form")?.addEventListener("submit", handleEmployeeAddSubmit);

  document.querySelectorAll("[data-delete-employee]").forEach((button) => button.addEventListener("click", async () => {
    const employeeId = button.dataset.deleteEmployee;
    const label = button.dataset.employeeLabel ?? "";
    if (!confirm(`ลบบัญชี ${label} ?\n\nถ้าบัญชีนี้ยังไม่เคยมีเอกสารหรือประวัติในระบบ จะถูกลบถาวร\nถ้ามีประวัติแล้ว ระบบจะปิดใช้งานและซ่อนบัญชีแทน เพื่อให้เอกสารเก่ายังแสดงชื่อได้\nทั้งสองกรณีเจ้าของบัญชีจะเข้าสู่ระบบไม่ได้อีก`)) return;
    button.disabled = true;
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const result = await callPilotAuth({ action: "admin_delete_account", employeeId }, sessionData.session?.access_token);
      const done = result.mode === "archived"
        ? `ปิดใช้งานและซ่อนบัญชี ${label} แล้ว (มีประวัติในระบบ จึงเก็บข้อมูลไว้ให้เอกสารเก่า)`
        : `ลบบัญชี ${label} ถาวรแล้ว`;
      showToast(result.authDeleted === false ? `${done} · แต่ลบบัญชีล็อกอินไม่สำเร็จ (เข้าระบบไม่ได้อยู่แล้ว)` : done);
      await renderAdmin(params);
    } catch (error) {
      button.disabled = false;
      showToast(friendlyError(error), "error");
    }
  }));

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

/* หน้าตั้งรหัสผ่านใหม่จากลิงก์ในอีเมลยืนยันการอนุมัติสิทธิ์ (#/set-password?token=...)
   เปิดได้โดยไม่ต้องล็อกอิน โทเค็นเป็นหลักฐานตัวตน ตรวจและใช้ที่ฝั่ง pilot-auth (ใช้ได้ครั้งเดียว/หมดอายุ)
   สำเร็จแล้วล้างโทเค็นออกจาก URL แล้วพาไปหน้าเข้าสู่ระบบ */
async function renderSetPassword(params) {
  const token = String(params.get("token") ?? "").trim();
  let employeeNo = "";
  let errorMessage = "";
  try {
    if (!token) throw new Error(pilotAuthMessages.INVALID_SETUP_TOKEN);
    employeeNo = String((await callPilotAuth({ action: "password_setup_info", token })).employeeNo ?? "");
  } catch (error) {
    errorMessage = friendlyError(error);
  }

  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-aside">
        <div class="brand"><div class="brand-mark">M</div><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></div>
        <div class="auth-copy">
          <div class="eyebrow">Account setup</div>
          <h1>ตั้งรหัสผ่านใหม่<br>สำหรับเข้าใช้งาน</h1>
          <p>ผู้ดูแลระบบอนุมัติสิทธิ์เข้าใช้งานของคุณแล้ว ตั้งรหัสผ่านใหม่ได้ที่หน้านี้ ลิงก์ใช้ได้ครั้งเดียว</p>
        </div>
      </section>
      <section class="auth-panel">
        <div class="theme-button">${themeButton()}</div>
        <div class="auth-card">
          <h2>ตั้งรหัสผ่านใหม่</h2>
          <div id="auth-message">${errorMessage ? `<div class="form-message error">${escapeHtml(errorMessage)}</div>` : ""}</div>
          ${errorMessage ? `<a class="btn secondary block" href="#/dashboard" id="setup-back">กลับไปหน้าเข้าสู่ระบบ</a>` : `
          <form id="setup-form">
            <div class="field"><label for="setup-employee-no">UserID</label><input class="input" id="setup-employee-no" value="${escapeHtml(employeeNo)}" autocomplete="username" readonly></div>
            <div class="field"><label for="setup-password">รหัสผ่านใหม่</label><input class="input" id="setup-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><small>อย่างน้อย 8 ตัวอักษร</small></div>
            <div class="field"><label for="setup-confirm">ยืนยันรหัสผ่านใหม่</label><input class="input" id="setup-confirm" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
            <button class="btn block" type="submit">ตั้งรหัสผ่านและไปหน้าเข้าสู่ระบบ</button>
          </form>`}
        </div>
      </section>
    </main>`;

  document.querySelector(".theme-toggle")?.addEventListener("click", toggleTheme);
  document.querySelector("#setup-back")?.addEventListener("click", async (event) => {
    event.preventDefault();
    history.replaceState(null, "", location.pathname + location.search);
    await renderRoute();
  });
  document.querySelector("#setup-form")?.addEventListener("submit", async (event) => {
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
      const result = await callPilotAuth({ action: "password_setup_complete", token, password });
      history.replaceState(null, "", location.pathname + location.search);
      await forceReLogin(`ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว เข้าสู่ระบบด้วย ID ${result.employeeNo ?? employeeNo} และรหัสผ่านใหม่ได้ทันที`);
    } catch (error) {
      message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(error))}</div>`;
      setFormBusy(form, false);
    }
  });
}

async function ncrRequestTypeId() {
  const { data, error } = await sb.from("request_types").select("id").eq("code", "NCR_CAR").eq("is_active", true).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function renderRoute() {
  const { path, params } = currentRoute();
  if (path !== "requests" || pendingModuleZoom !== moduleZoomKey(params)) pendingModuleZoom = null;
  if (path === "set-password") return await renderSetPassword(params);
  if (!state.session) {
    await renderAuth();
    return;
  }
  if (!state.employee) {
    try {
      await loadEmployeeKeepingSession();
    } catch (error) {
      if (!isAccountGoneError(error)) return renderConnectionError(error);
      await signOutLocally(friendlyError(error));
      return await renderAuth();
    }
  }
  if (isSandboxMode() && !sandboxRouteAllowed(path, params)) {
    go("ncr");
    return;
  }
  await loadUnread();
  try {
    if (path === "dashboard") return await renderDashboard();
    if (path === "requests") return await renderRequests(params);
    // ทะเบียน NCR อยู่ในหน้า NCR ของศูนย์คำร้อง (เลือกโมดูล NCR/CAR) ลิงก์ #/ncr เดิมและปุ่มย้อนกลับจึงพาไปที่นั่น
    // โหมดทดสอบไม่มีหน้าคำร้อง จึงใช้หน้าทะเบียนของโมดูลเอง (modules/module-ncr.js)
    if (path === "ncr" && !params.get("id") && !params.get("new") && !isSandboxMode()) {
      const typeId = await ncrRequestTypeId();
      if (typeId) {
        history.replaceState(null, "", requestCenterUrl(new URLSearchParams(), { type: typeId, ncrStatus: params.get("status") }));
        return await renderRequests(new URLSearchParams(location.hash.split("?")[1]));
      }
    }
    if (path === "new" || path === "repair/new" || (path === "ncr" && params.get("new"))) {
      if (path === "ncr") {
        const typeId = await ncrRequestTypeId();
        if (typeId) params.set("type", typeId);
      }
      history.replaceState(null, "", requestCenterUrl(params, { mode: "create", createType: params.get("type") }));
      return await renderNewRequest(new URLSearchParams(location.hash.split("?")[1]));
    }
    if (path === "request") return await renderRequestDetail(params);
    if (path === "approvals") return await renderApprovals(params);
    if (path === "notifications") return await renderNotifications();
    if (path === "admin") return await renderAdmin(params);
    if (path === "profile") return await renderProfile();
    const modulePage = requestModulePage(path);
    if (modulePage) return await modulePage(params);
    return renderNotFound();
  } catch (error) {
    console.error(error);
    const message = friendlyError(error);
    app.innerHTML = shell(`<div class="empty"><h2>โหลดข้อมูลไม่สำเร็จ</h2><p>${escapeHtml(message)}</p><button class="btn secondary" id="retry-button">ลองอีกครั้ง</button></div>`, path, "เกิดข้อผิดพลาด");
    bindShell();
    document.querySelector("#retry-button")?.addEventListener("click", renderRoute);
  }
}

async function startApp() {
  const { data, error } = await sb.auth.getSession();
  // ต่ออายุ session ไม่สำเร็จเพราะเน็ต: session ยังเก็บอยู่ในเครื่อง อย่าพาไปหน้าล็อกอิน
  // (refresh token ใช้ไม่ได้จริง Supabase ลบ session ให้เองและคืน session = null → ไปหน้าล็อกอินตามปกติ)
  if (error?.name === "AuthRetryableFetchError") return renderConnectionError(error);
  if (error) console.error(error);
  state.session = data.session;
  if (state.session) {
    try {
      await loadEmployeeKeepingSession();
      // กันกรณีแจ้งเตือนตกค้าง (ปิดเบราว์เซอร์ก่อนยิงสำเร็จ / ตอนนั้นยังไม่ได้ตั้งค่า secret /
      // แจ้งเตือนที่เกิดตอนผู้รับยังไม่ได้ล็อกอิน) — เปิดแอปครั้งถัดไปคิวจะถูกไล่ส่งให้เอง
      triggerNotificationEmails();
      if (!location.hash) go("dashboard");
    } catch (employeeError) {
      if (!isAccountGoneError(employeeError)) return renderConnectionError(employeeError);
      await signOutLocally(friendlyError(employeeError));
    }
  }
  await renderRoute();
}

async function init() {
  applyTheme();
  window.addEventListener("hashchange", renderRoute);
  // บัญชีถูกลบ/รหัสผ่านถูกเปลี่ยนระหว่างเปิดแอปค้างไว้ ต่ออายุ token ไม่ได้ → Supabase ส่ง SIGNED_OUT
  sb.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT" || !state.session) return;
    state.session = null;
    state.employee = null;
    state.unread = 0;
    setTimeout(() => renderAuth(), 0);
  });
  await startApp();
}

init();
