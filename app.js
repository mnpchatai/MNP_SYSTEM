/* global supabase */

const SUPABASE_URL = "https://iqlydmkylqyowmvpsete.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uWsULpN8jWF8XCp73B8K_A_YkbKJNUD";
const PILOT_AUTH_URL = `${SUPABASE_URL}/functions/v1/pilot-auth`;
// ส่งอีเมลแจ้งเตือนจริงตาม employees.email — ดู triggerNotificationEmails ท้ายไฟล์นี้
const NOTIFY_EMAIL_URL = `${SUPABASE_URL}/functions/v1/notify-email`;
// กุญแจสาธารณะ VAPID สำหรับแจ้งเตือนบนเครื่อง (Web Push, base64url) คู่กับ VAPID_PRIVATE_KEY ที่เก็บเป็น secret ของ Edge Function notify-push
// ใส่ได้เฉพาะกุญแจสาธารณะ — ห้ามใส่กุญแจส่วนตัวที่นี่ เว้นว่างไว้ = ซ่อนส่วนแจ้งเตือนบนเครื่องทั้งหมด
// เปลี่ยนกุญแจ: เครื่องที่เปิดไว้แล้วจะสมัครใหม่เองเมื่อเปิดแอป (ดู ensurePushSubscription)
const PUSH_PUBLIC_KEY = "BDTZCvimJouHlMRtOtUfsBAoScH75w60WnUw4Uy1HQprE1NQLqZDHUiIi3Hl1-WrlbF91QUGPsZSNp7CXzAqaCs";
// ทุกคำตอบของ Supabase: อ่าน header Date ส่งให้นาฬิกาเซิร์ฟเวอร์ (modules/server-clock.js) ไม่แก้คำขอหรือคำตอบ
// คำตอบจาก cache ของเบราว์เซอร์ (มี header Age) มี Date ของครั้งก่อน จึงไม่นับ
const serverClockFetch = async (input, init) => {
  const sentAt = Date.now();
  const response = await fetch(input, init);
  try {
    const date = response.headers.get("date");
    if (date && !response.headers.has("age")) window.MNP_SERVER_CLOCK?.sample(date, sentAt, Date.now());
  } catch {
    // นาฬิกาเป็นตัวช่วย: อ่านไม่ได้ = ใช้เวลาเครื่องต่อไป
  }
  return response;
};
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: serverClockFetch },
});

const app = document.querySelector("#app");

// ไอคอนเส้นชุดเดียวของ Pilot อยู่ที่ modules/ui-icons.js (โหลดก่อน app.js) แทนอีโมจิและอักขระพิเศษ
const UI_ICON_PATHS = window.MNP_UI_ICONS.PATHS;
const uiIcon = window.MNP_UI_ICONS.icon;
// ไอคอนประจำประเภทคำร้อง (ประแจ = MT, ป้ายล็อต = NCR, จอ = IT, ตราประทับ = ฝ่ายบริหาร ฯลฯ)
const requestTypeIcon = window.MNP_UI_ICONS.typeIcon;

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
// ปิดแล้วส่ง event "popup-close" ให้ตัว popup เก็บกวาดเอง (เช่น dropdown ค้นหาได้ใน modules/searchable-select.js คืนข้อความตัวที่เลือก)
function closePopup(popup) {
  popup.hidden = true;
  const owner = popup.parentElement.querySelector("[aria-expanded]");
  owner?.setAttribute("aria-expanded", "false");
  owner?.removeAttribute("aria-activedescendant");
  popup.dispatchEvent(new CustomEvent("popup-close"));
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
// ยกเว้นตอนเปิดหน้าครั้งแรก: มือถือมักเปิดจาก index.html ที่ cache ไว้ (หน้าเก่า) ขณะที่ยังไม่มีข้อมูลที่กรอก
// จึงเช็กทันทีและรีโหลดให้เองหนึ่งครั้งต่อเวอร์ชัน (จำใน sessionStorage กันวนซ้ำ) ถ้ายังไม่ตรงค่อยขึ้นปุ่ม
const APP_VERSION = new URL(document.querySelector('script[src*="app.js"]').src).searchParams.get("v");
const VERSION_RELOAD_KEY = "mnp-version-reload";
let lastVersionCheck = 0;
async function checkForNewVersion({ autoReload } = {}) {
  if (document.hidden || Date.now() - lastVersionCheck < 60 * 1000 || document.querySelector(".update-banner")) return;
  lastVersionCheck = Date.now();
  try {
    const html = await (await fetch("./index.html", { cache: "no-store" })).text();
    const latest = html.match(/app\.js\?v=([\w-]+)/)?.[1];
    if (!latest || !APP_VERSION || latest === APP_VERSION) return;
    if (autoReload) {
      let alreadyTried = false;
      try {
        alreadyTried = sessionStorage.getItem(VERSION_RELOAD_KEY) === latest;
        sessionStorage.setItem(VERSION_RELOAD_KEY, latest);
      } catch {
        alreadyTried = true; // อ่าน/เขียน sessionStorage ไม่ได้ (โหมดส่วนตัว) — ไม่เสี่ยงรีโหลดวน ให้ขึ้นปุ่มแทน
      }
      if (!alreadyTried) return location.reload();
    }
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
document.addEventListener("visibilitychange", () => checkForNewVersion());
window.addEventListener("hashchange", () => checkForNewVersion());
// มือถือกลับมาที่หน้าจาก back/forward cache โดยไม่โหลดใหม่ (event นี้ไม่ใช่ visibilitychange เสมอไป)
window.addEventListener("pageshow", (event) => {
  if (event.persisted) checkForNewVersion();
});
checkForNewVersion({ autoReload: true });

const toastNode = document.querySelector("#toast");
const state = { session: null, employee: null, unread: 0, authMode: "login", directory: null, adminTab: "requests", sandbox: null };

// "ตำแหน่ง" คือ role_id โดยตรงแล้ว (ไม่มี position_level แยกต่างหากอีกต่อไป) ค่าตำแหน่ง
// ที่มีอยู่จริงตอนนี้มี 6 อย่าง: ผู้จัดการทั่วไป/ผู้จัดการโรงงาน/ผู้ช่วยผู้จัดการโรงงาน/
// ผู้จัดการแผนก/พนักงานทั่วไป/ผู้ดูแลระบบ — รายชื่อ/ป้ายกำกับดึงจากตาราง roles เสมอ ที่นี่
// เก็บแค่ code ที่ใช้เทียบสิทธิ์ฝั่ง UI (สิทธิ์จริงบังคับที่ฐานข้อมูลอยู่แล้วผ่าน RLS/RPC)
const VIEW_ALL_ROLE_CODES = ["factory_manager", "general_manager"]; // มี requests.view_all เหมือน admin
const DEPT_MANAGER_ROLE_CODES = ["department_manager", "assistant_department_manager"]; // ผู้ช่วยทำแทนผู้จัดการแผนกได้ (ตรงกับ RPC)

const OPERATE_ROLE_CODES = ["assistant_factory_manager", "factory_manager", "general_manager"]; // มี requests.operate
const accountRequestKindLabels = {
  new_account: "ขอเปิดบัญชี",
  credential_change: "ขอแก้ไขรหัสพนักงาน/รหัสผ่าน",
};
const accountRequestStatusLabels = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
};

// ชื่อสถานะชุดเดียวทั้งระบบ: ป้าย ตัวกรอง แถบ "ไปถึงไหนแล้ว" และไทม์ไลน์อ่านจากที่นี่ผ่าน statusLabel() เท่านั้น
// (ชุดคำเดียวกับแดชบอร์ด MT ใน modules/mt-dashboard-model.js) สถานะหนึ่งมีชื่อเดียว ตรวจย้อนหลังแล้วไม่ต้องเดาว่าคือขั้นเดียวกันไหม
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
  assigned: "รอช่างเริ่มงาน",
  pending_verify: "รอผู้แจ้งตรวจรับ",
  acknowledged: "รับทราบข้อมูล",
};
// ใบแจ้งซ่อม (workflow ซ่อม) เรียกขั้นดำเนินการว่า "กำลังซ่อม"; ความสำคัญของใบแจ้งซ่อมมาจากสวิตช์ "แจ้งด่วน" อย่างเดียว
const repairStatusLabels = { in_progress: "กำลังซ่อม" };
const priorityLabels = { low: "ต่ำ", normal: "ปกติ", high: "สูง", urgent: "เร่งด่วน" };

// type = แถวของ request_types (หรือ { code }) — ใบแจ้งซ่อมคือประเภทที่ใช้ workflow ซ่อม
function isRepairType(type) {
  return Boolean(type?.uses_repair_workflow) || type?.code === "MT_REPAIR";
}

function statusLabel(status, repair = false) {
  return (repair ? repairStatusLabels[status] : null) ?? statusLabels[status] ?? status;
}

// ใบแจ้งซ่อม: ความสำคัญสูง/เร่งด่วน = "ด่วน" คำเดียวกับสวิตช์ในฟอร์มและแดชบอร์ด MT
function priorityLabel(priority, repair = false) {
  if (repair && (priority === "high" || priority === "urgent")) return "ด่วน";
  return priorityLabels[priority] ?? priority;
}
// สถานะของแต่ละขั้นอนุมัติ (enum approval_status) — ห้ามแสดงค่าดิบภาษาอังกฤษในหน้า
// คำกริยาของมติแต่ละแบบ ใช้ในแถบตัดสินใจและใบเสร็จหลังกด
const decisionVerbs = { approved: "อนุมัติ", rejected: "ไม่อนุมัติ", more_info: "ขอข้อมูลเพิ่ม", acknowledged: "รับทราบข้อมูล" };
// เลขแบบฟอร์มกระดาษเดิมของแต่ละโมดูล แสดงคู่กับเลขที่คำร้อง
const REQUEST_FORM_CODES = { MT_REPAIR: "MT01-FM05", MANAGEMENT: "PP01-FM08", NCR_CAR: "QA02-FM01" };

// ลำดับขั้นของงานสำหรับแถบ "ไปถึงไหนแล้ว" — ใบแจ้งซ่อมเดินตาม workflow ของ MT ส่วนคำร้องทั่วไป
// ใช้ลำดับสั้นกว่าเพราะไม่มีขั้นมอบหมายช่าง/ตรวจรับ (ดู statusLabels ด้านบนสำหรับป้ายเต็ม)
const REPAIR_STAGES = ["pending_approval", "pending_assign", "assigned", "in_progress", "pending_verify", "completed"]
  .map((status) => ({ status, label: statusLabel(status, true) }));
const GENERAL_STAGES = ["pending_approval", "approved", "in_progress", "completed"]
  .map((status) => ({ status, label: statusLabel(status) }));
// สถานะที่ออกนอกเส้นทางปกติ — ค้างอยู่ที่ขั้นอนุมัติและยังเดินต่อไม่ได้จนกว่าจะแก้
const OFF_TRACK_STATUSES = { more_info: "warning", rejected: "danger", cancelled: "danger", draft: "muted" };

/* คำนวณว่าใบนี้เดินมาถึงขั้นไหนจาก "สถานะปัจจุบัน" อย่างเดียว ไม่ได้อ่านจาก
   request_status_history เพราะสถานะใน requests คือความจริง ณ ปัจจุบันอยู่แล้ว และการตรวจรับ
   ไม่ผ่านจะย้อนใบกลับไป assigned — แถบจึงต้องถอยตามด้วย ไม่ใช่ค้างที่ขั้นที่เคยผ่านสูงสุด */
function requestProgress(status, usesRepairWorkflow, typeCode = null, customStages = null) {
  // โมดูลที่ลำดับขั้นสั้นกว่าคำร้องทั่วไปประกาศ progressStages เอง (เช่น ใบคำร้องถึงฝ่ายบริหารจบที่มติ)
  // ขั้นหนึ่งรวมได้หลายสถานะผ่าน statuses และขั้นสุดท้ายนับว่าจบงานแล้ว
  // customStages: ใบที่ไม่ใช่ requests (เช่น NCR ในตาราง ncr_reports) ส่งลำดับขั้นของตัวเองมา
  const stages = customStages ?? requestModule(typeCode)?.progressStages ?? (usesRepairWorkflow ? REPAIR_STAGES : GENERAL_STAGES);
  const offTrack = OFF_TRACK_STATUSES[status] ?? null;
  // ขอข้อมูลเพิ่ม/ไม่อนุมัติ/ยกเลิก ล้วนเกิดตอนพิจารณา จึงปักไว้ที่ขั้นอนุมัติ
  const index = offTrack ? 0 : stages.findIndex((stage) => (stage.statuses ?? [stage.status]).includes(status));
  return {
    stages,
    index,
    offTrack,
    // ใบที่จบแล้วนับเป็นผ่านครบทุกขั้น ใบที่ยังเดินอยู่นับเฉพาะขั้นก่อนหน้าว่าผ่านแล้ว
    done: !offTrack && index === stages.length - 1 ? stages.length : Math.max(index, 0),
    label: offTrack ? statusLabel(status, usesRepairWorkflow) : stages[index]?.label ?? statusLabel(status, usesRepairWorkflow),
  };
}

// stages/label: ใบที่ไม่ใช่ requests ส่งลำดับขั้นและป้ายสถานะของตัวเอง (ดู requestProgress)
function progressTracker(status, usesRepairWorkflow, { waitingOn = null, typeCode = null, stages: customStages = null, label: customLabel = null } = {}) {
  const progress = requestProgress(status, usesRepairWorkflow, typeCode, customStages);
  const { stages, index, offTrack, done } = progress;
  const label = customLabel ?? progress.label;
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
// โมดูลที่รองรับโหมดทดสอบแล้วประกาศ sandbox: true — NCR และใบตรวจ QC ฐานข้อมูลแยกข้อมูลทดสอบแล้วทั้งคู่
// โมดูลอื่นถูกซ่อน และฐานข้อมูลปฏิเสธการเขียนของโมดูลที่ยังไม่รองรับ (SANDBOX_MODULE_UNSUPPORTED)
const isSandboxMode = () => Boolean(state.employee?.isSandbox);
const sandboxSupports = (entry) => !isSandboxMode() || entry.sandbox === true;
// บัญชีที่เห็นเฉพาะ MNP LAB (MNPLAB001/002): หน้าเว็บเหลือเมนูและหน้า LAB กับข้อมูลส่วนตัว (modules/lab-only-access.js)
// เป็น UX ล้วน — ฐานข้อมูลปฏิเสธบัญชีนี้ในทุก RPC/ตารางของโมดูลอื่นเอง (migration 20261019005000_lab_only_accounts.sql)
const isLabOnly = () => window.MNP_LAB_ONLY.isLabOnly(state.employee);
const homePath = () => (isLabOnly() ? window.MNP_LAB_ONLY.HOME : "dashboard");
// แผนกที่เห็นเฉพาะบางโมดูล (แผนก ID เห็นแค่แจ้งซ่อม MT/IT): เมนู การ์ดโมดูล รายการใบ และหน้าของโมดูลอื่นถูกซ่อน
// กติกาและรายชื่อแผนกอยู่ที่ modules/department-access.js — เป็น UX ล้วน สิทธิ์จริงยังตัดสินที่ฐานข้อมูล
// โหมดทดสอบ (เหลือ NCR/QC) และบัญชี lab-only (เหลือ LAB) มีกติกาหน้าของตัวเองที่แคบกว่า จึงไม่ใช้กติกาแผนกซ้อน
// ไม่งั้นสองด่านพากันวนไป-กลับ (เช่น lab-only ส่ง dashboard ไป lab แล้วด่านแผนกส่ง lab กลับ dashboard)
const deptAccessSubject = () => (isSandboxMode() || isLabOnly() ? null : state.employee);
const deptModuleAllowed = (code) => window.MNP_DEPARTMENT_ACCESS.moduleAllowed(deptAccessSubject(), code);
const isDeptRestricted = () => window.MNP_DEPARTMENT_ACCESS.isRestricted(deptAccessSubject());
function moduleCodeForPage(path) {
  return Object.values(REQUEST_MODULES).find((entry) => entry.enabled && typeof entry.pages?.[path] === "function")?.code ?? null;
}
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
// โมดูลที่จำกัดสิทธิ์ (เช่น MNP LAB) ประกาศ navAllowed(employee) — ซ่อนเมนูเมื่อคืน false
// การซ่อนเมนูเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูล (RPC ของโมดูลปฏิเสธเองด้วย NOT_AUTHORIZED)
// รายการที่ประกาศ group (เช่น "ทดสอบ" ของ RubberFlow/BOM) ได้หัวกลุ่มก่อนรายการแรกของกลุ่มนั้น
function requestModuleNavLinks(active) {
  let previousGroup = null;
  return Object.values(REQUEST_MODULES)
    .filter((entry) => entry.enabled && sandboxSupports(entry) && (entry.navAllowed?.(state.employee) ?? true))
    .filter((entry) => !isLabOnly() || window.MNP_LAB_ONLY.moduleAllowed(entry.code))
    .filter((entry) => deptModuleAllowed(entry.code))
    .flatMap((entry) => entry.nav ?? [])
    .filter((item) => !item.sandboxOnly || isSandboxMode())
    .map((item) => {
      const groupLabel = item.group && item.group !== previousGroup ? `<div class="nav-label nav-group-label">${escapeHtml(item.group)}</div>` : "";
      previousGroup = item.group ?? null;
      const link = navLink(item.path, item.label, item.icon, active);
      const sub = item.subnav?.(active) ?? "";
      return `${groupLabel}${sub ? `<div class="nav-group">${link}${sub}</div>` : link}`;
    })
    .join("");
}
// หน้าของโมดูลแยกไฟล์ (#/ncr, #/ncr-dashboard) ที่เข้าผ่านหน้าคำร้อง ไฮไลต์เมนู "คำร้อง" นอกโหมดทดสอบ
// โมดูลที่ประกาศ standalone: true (เช่น MNP LAB) ไม่ใช่โมดูลคำร้อง มีเมนูของตัวเอง จึงไฮไลต์เมนูของตัวเอง
function activeNavFor(active) {
  if (isSandboxMode()) return active;
  const isModulePage = Object.values(REQUEST_MODULES).some((entry) => entry.enabled && !entry.standalone && typeof entry.pages?.[active] === "function");
  return isModulePage ? "requests" : active;
}
function activeRequestModuleCodes() {
  const separateModuleCodes = Object.values(REQUEST_MODULES).filter((entry) => entry.enabled && !entry.standalone).map((entry) => entry.code);
  return [...new Set([...REQUEST_MODULE_CODES, ...separateModuleCodes])].filter(deptModuleAllowed);
}
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
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

function routeFromHash(hash) {
  const raw = hash.replace(/^#\/?/, "") || "dashboard";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

function currentRoute() {
  return routeFromHash(location.hash);
}

function go(path) {
  location.hash = `#/${path}`;
}

function showToast(message, type = "success") {
  const isError = type === "error";
  window.clearTimeout(showToast.timer);
  // ข้อผิดพลาดค้างไว้จนกว่าผู้ใช้จะกดปิด และให้โปรแกรมอ่านหน้าจออ่านทันที ส่วนแจ้งสำเร็จหายเองใน 3.5 วินาที
  toastNode.setAttribute("role", isError ? "alert" : "status");
  toastNode.setAttribute("aria-live", isError ? "assertive" : "polite");
  toastNode.innerHTML = `${uiIcon(isError ? "alert" : "check")}<span>${escapeHtml(message)}</span>${isError ? `<button type="button" class="toast-close" aria-label="ปิดข้อความ">${uiIcon("close")}</button>` : ""}`;
  toastNode.className = `toast show ${isError ? "error" : "success"}`;
  showToast.shownAt = Date.now();
  if (isError) toastNode.querySelector(".toast-close").addEventListener("click", hideToast);
  else showToast.timer = window.setTimeout(hideToast, 3500);
}

function hideToast() {
  window.clearTimeout(showToast.timer);
  toastNode.className = "toast";
  toastNode.replaceChildren();
}
// Esc ปิดข้อผิดพลาดเฉพาะตอนที่ไม่มีอย่างอื่นให้ Esc ปิด (ฟังแบบ capture จึงเห็น popup ก่อนตัวจัดการของมันจะปิด)
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented || !toastNode.classList.contains("error")) return;
  if (document.querySelector("dialog[open], .attachment-lightbox, [data-popup]:not([hidden])")) return;
  hideToast();
}, true);
// ผู้ใช้ไปหน้าอื่น: ข้อผิดพลาดของหน้าเดิมไม่ตามไป แต่ไม่ล้างข้อผิดพลาดที่เพิ่งแสดงก่อนโค้ดพาไปหน้าใหม่ (เช่น showToast แล้ว go())
window.addEventListener("hashchange", () => {
  if (toastNode.classList.contains("error") && Date.now() - (showToast.shownAt ?? 0) > 1000) hideToast();
});

// กล่องยืนยันในแอป แทน confirm() ของเบราว์เซอร์: ปุ่มยืนยันบอกผลของการกด (เช่น "ลบบัญชี") กด Esc หรือยกเลิก = ไม่ทำ
// cancelLabel: ปุ่มไม่ทำ ตั้งให้ไม่ชนกับปุ่มยืนยันที่ขึ้นต้นด้วย "ยกเลิก" (เช่น "ไม่ยกเลิก" คู่กับ "ยกเลิก NCR")
function confirmDialog({ title, message = "", confirmLabel, cancelLabel = "ยกเลิก", danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("aria-labelledby", "confirm-dialog-title");
    dialog.innerHTML = `<form method="dialog">
      <h2 id="confirm-dialog-title">${escapeHtml(title)}</h2>
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      <div class="confirm-dialog-actions"><button class="btn secondary" value="cancel">${escapeHtml(cancelLabel)}</button><button class="btn${danger ? " danger-solid" : ""}" value="confirm">${escapeHtml(confirmLabel)}</button></div>
    </form>`;
    if (typeof dialog.showModal !== "function") return resolve(window.confirm(message ? `${title}\n\n${message}` : title));
    document.body.append(dialog);
    // เปลี่ยนหน้าระหว่างที่กล่องเปิด (ปุ่มย้อนกลับของมือถือ) = ยกเลิก ไม่ทำกับรายการของหน้าเดิม
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("hashchange", cancelOnLeave);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(confirmed);
    };
    // ปิดเองจากปุ่ม/Esc/การเปลี่ยนหน้า ไม่รอ event close (Chromium เลื่อน close ออกไปเมื่อหน้าไม่ได้วาด เช่นแท็บอยู่เบื้องหลัง)
    const cancelOnLeave = () => finish(false);
    window.addEventListener("hashchange", cancelOnLeave, { once: true });
    dialog.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); finish(event.submitter?.value === "confirm"); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener("close", () => finish(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
    dialog.querySelector('button[value="cancel"]').focus();
  });
}

function friendlyError(error) {
  const message = String(error?.message ?? error ?? "เกิดข้อผิดพลาด");
  // ข้อผิดพลาดที่แสดงให้ผู้ใช้ผ่านจุดนี้ทุกครั้ง จึงส่งให้บัญชี master ดูที่ #/master (modules/client-error-log.js กรองซ้ำ/โควตาเอง)
  window.MNP_ERROR_LOG?.report(error);
  // ข้อความของโมดูลแยกไฟล์มาก่อน เพราะรหัสของโมดูลอาจยาวกว่าและมีรหัสกลางซ้อนอยู่ข้างใน
  const moduleMessages = Object.assign({}, ...Object.values(REQUEST_MODULES).map((entry) => entry.errorMessages ?? {}));
  const map = {
    ...moduleMessages,
    AUTH_REQUIRED: "กรุณาเข้าสู่ระบบอีกครั้ง",
    NOT_AUTHORIZED: "คุณไม่มีสิทธิ์ดำเนินการนี้",
    MASTER_PROTECTED: "บัญชี master แก้ไข เปลี่ยนรหัสผ่าน หรือลบได้โดยเจ้าของบัญชีเท่านั้น",
    MASTER_MUST_BE_ACTIVE_ADMIN: "บัญชี master ต้องเป็นผู้ดูแลระบบที่ยังใช้งานอยู่",
    INVALID_PUSH_SUBSCRIPTION: "ข้อมูลการแจ้งเตือนของเครื่องนี้ไม่ถูกต้อง ลองเปิดใหม่อีกครั้ง",
    PUSH_ENDPOINT_NOT_ALLOWED: "เบราว์เซอร์นี้ใช้บริการแจ้งเตือนที่ระบบยังไม่รองรับ (รองรับ Chrome, Edge, Firefox และ Safari)",
    LAB_ONLY_ACCOUNT: "บัญชีนี้ใช้ได้เฉพาะ MNP LAB",
    REQUEST_NOT_CREATED: "ระบบไม่ได้สร้างใบให้ กรุณาลองส่งอีกครั้ง",
    NCR_NOT_ISSUED: "ระบบไม่ได้ออกเลขที่ NCR ให้ กรุณาลองอีกครั้ง",
    SANDBOX_SCOPE_MISMATCH: "รายการนี้อยู่คนละโหมดกับที่คุณใช้อยู่ (ข้อมูลทดสอบกับข้อมูลจริงแยกจากกัน)",
    SANDBOX_MODULE_UNSUPPORTED: "โหมดทดสอบรองรับเฉพาะ NCR และใบตรวจ QC ตอนนี้ กรุณาออกจากโหมดทดสอบก่อนทำรายการนี้",
    NCR_FILES_REMAIN: "ลบไฟล์แนบทดสอบไม่หมด กรุณาลองล้างข้อมูลทดสอบอีกครั้ง",
    NCR_FILES_CLEANUP_ACTIVE: "กำลังล้างไฟล์แนบทดสอบ กรุณารอให้เสร็จแล้วลองใหม่",
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
    REQUEST_NOT_ASSIGNED: "ใบนี้ไม่ได้อยู่ในขั้นรอช่างเริ่มงานแล้ว",
    NOT_ASSIGNED_TECHNICIAN: "คุณไม่ใช่ช่างที่ถูกมอบหมายหรือหัวหน้าแผนกซ่อมบำรุงของใบนี้",
    REQUEST_NOT_IN_PROGRESS: "ใบนี้ไม่ได้อยู่ระหว่างดำเนินการซ่อมแล้ว",
    INVALID_EXECUTION_PLAN: "กรุณาเลือกการดำเนินงาน",
    INVALID_INSPECTOR_OPINION: "กรุณาเลือกความคิดเห็นของช่างผู้ตรวจสอบ",
    INVALID_CAUSE_ANALYSIS: "กรุณาระบุผลวิเคราะห์สาเหตุ 3–5,000 ตัวอักษร",
    REQUEST_NOT_PENDING_VERIFY: "ใบนี้ไม่ได้อยู่ในขั้นรอผู้แจ้งตรวจรับแล้ว",
    INVALID_RESULT: "กรุณาเลือกผลการตรวจรับ",
    NOTE_REQUIRED: "กรุณาระบุสาเหตุที่ไม่ผ่านการตรวจรับ",
    COMMENT_REQUIRED: "กรุณาระบุเหตุผล (จำเป็นสำหรับ \"ไม่อนุมัติ\" และ \"ขอข้อมูลเพิ่ม\")",
    REQUEST_NOT_ASSIGNABLE: "ใบนี้ยังไม่ผ่านการอนุมัติ หรือถูกปฏิเสธไปแล้ว จึงมอบหมายช่างไม่ได้",
    RECEIVED_BY_REQUIRED: "กรุณาระบุชื่อผู้จัดการที่รับใบ",
    EXECUTION_PLAN_REQUIRED: "กรุณาเลือกการดำเนินงาน",
    INSPECTOR_OPINION_REQUIRED: "กรุณาเลือกความคิดเห็นของช่างผู้ตรวจสอบ",
    WORK_START_DATE_REQUIRED: "กรุณาระบุวันเริ่มงาน",
    WORK_EXPECTED_DATE_REQUIRED: "กรุณาระบุกำหนดเสร็จ",
    WORK_DATE_RANGE_INVALID: "กำหนดเสร็จต้องไม่ก่อนวันเริ่มงาน",
    REPAIR_USES_OWN_WORKFLOW: "ใบแจ้งซ่อมต้องเดินตามขั้นตอนของช่าง เปลี่ยนสถานะตรงๆ ไม่ได้",
    DECISION_NOT_ALLOWED: "มติ \"รับทราบข้อมูล\" ใช้ได้เฉพาะใบคำร้องถึงฝ่ายบริหาร",
    REQUEST_ENDS_AT_DECISION: "ใบคำร้องถึงฝ่ายบริหารจบที่มติของฝ่ายบริหาร ไม่มีขั้นรับงาน",
    STEP_HAS_NO_COMMENT: "ขั้นนี้ยังไม่มีความเห็นจากผู้อนุมัติให้ตอบกลับ",
    REPLY_NOT_SUPPORTED: "คำร้องประเภทนี้ยังไม่รองรับการตอบกลับความเห็น",
    INVALID_MESSAGE: "กรุณาพิมพ์ข้อความตอบกลับ",
    EXPECTED_DATE_REQUIRED: "กรุณาระบุวันที่คาดว่าของจะมาส่ง",
    STEP_ALREADY_DONE: "หมุดนี้บันทึกว่าเสร็จแล้ว เลื่อนวันที่ไม่ได้",
    EXPECTED_DATE_IN_PAST: "กำหนดเสร็จใหม่ต้องเป็นวันนี้หรือหลังจากนี้",
    EXPECTED_DATE_UNCHANGED: "วันที่ที่เลือกตรงกับกำหนดเสร็จเดิม",
    REQUEST_NOT_RESCHEDULABLE: "แก้กำหนดเสร็จได้เฉพาะใบแจ้งซ่อมที่รอช่างเริ่มงานหรือกำลังซ่อม",
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
  form.toggleAttribute("aria-busy", busy);
  const button = form.querySelector('button[type="submit"]');
  if (button) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = busy ? "กำลังดำเนินการ…" : button.dataset.label;
    setButtonBusy(button, busy);
  }
}

// ปุ่มนอกฟอร์มที่เรียกงาน async (เริ่มงาน ตรวจรับ ส่งขออนุมัติ …): ปิดปุ่มและแสดงวงหมุน (.btn[aria-busy]) ระหว่างรอ
function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true"); else button.removeAttribute("aria-busy");
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
const ATTACHMENT_HINT_SHORT = window.MNP_ATTACHMENT_IMAGE?.HINT_SHORT ?? "";
// ช่องที่ต้องกรอกบอกแบบเดียวทั้งระบบ: ต่อท้ายป้ายด้วย (จำเป็น) (ฟอร์ม NCR/MT/RubberFlow/BOM ใช้ span เดียวกัน)
const REQUIRED_MARK = ' <span class="field-required">(จำเป็น)</span>';
// ข้อความสั้นที่ต้องเห็น + คำอธิบายเต็มหลังปุ่ม ⓘ ตัวเดียวทั้งระบบ (modules/dashboard-notes.js) · shortText/fullHtml เป็น HTML ที่ escape แล้ว
function noteLine(shortText, fullHtml, label) {
  const note = window.MNP_NOTES?.toggle(label, fullHtml);
  return note ? `<div class="note-row muted small"><span>${shortText}</span>${note.button}</div>${note.body}` : `<p class="muted small">${shortText}</p>`;
}

// รูปจากโทรศัพท์ (HEIC ของ iPhone, ไฟล์ที่ไม่ระบุชนิด, รูปใหญ่เกิน 1 MB) ถูกแปลง/บีบเป็น JPEG ในเบราว์เซอร์
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
  await uploadAttachmentThumbnail("request-attachments", storagePath, file);
}

// อัปโหลดภาพย่อคู่กับไฟล์แนบที่บันทึกแล้ว (ดู THUMBNAIL_SUFFIX ใน modules/attachment-image.js) ใช้กับไฟล์แนบคำร้องและ NCR
// เป็นของเสริม: สร้างหรืออัปโหลดไม่สำเร็จก็ไม่แจ้งผู้ใช้ แกลเลอรีจะใช้ไฟล์จริงแทน
async function uploadAttachmentThumbnail(bucket, storagePath, file) {
  const attachmentImage = window.MNP_ATTACHMENT_IMAGE;
  if (!attachmentImage) return;
  try {
    const thumbnail = await attachmentImage.createUploadThumbnail(file, {
      renderPdf: async (pdf) => (await window.MNP_ATTACHMENT_PREVIEW.renderPdfFirstPage(pdf, loadPdfjs)).dataUrl,
    });
    if (!thumbnail) return;
    await sb.storage.from(bucket).upload(attachmentImage.thumbnailPath(storagePath), thumbnail, { contentType: "image/jpeg", upsert: false });
  } catch {
    // ไม่มีภาพย่อ = แกลเลอรีโหลดไฟล์จริงเหมือนไฟล์เก่า
  }
}

// ช่อง "แนบไฟล์เพิ่มเติม" ของฟอร์มตอบกลับ/ความเห็น/กรอกข้อมูลในหน้ารายละเอียดคำร้อง (ใช้ได้ทุกโมดูลที่แสดงผ่านหน้านี้)
// ลำดับที่ต้องทำเสมอ: readExtraFiles ก่อนยิง RPC (ไฟล์ผิดต้องไม่ทำให้การกระทำสำเร็จไปครึ่งเดียว)
// แล้ว uploadExtraFiles หลัง RPC สำเร็จ — ไฟล์พลาดไม่ย้อนการกระทำ แต่ต้องบอกผู้ใช้ให้แนบใหม่
// ไฟล์เข้า request_attachments ของคำร้องเดิม และขึ้นในลำดับเหตุการณ์ (attachmentTimelineEvents)
// hint: false เมื่อหน้าเดียวกันแสดงคำแนะนำไฟล์แนบไว้แล้ว (แสดงข้อความเดียวกันครั้งเดียวต่อหน้า)
function extraFilesFieldHtml(id, label = "แนบไฟล์เพิ่มเติม (ถ้ามี)", { hint = true } = {}) {
  // ปุ่มภาษาไทยแบบเดียวกับฟอร์ม แทนช่อง "Choose Files" ของเบราว์เซอร์; แบบไม่มีคำแนะนำอยู่ใต้หัวข้อที่พับได้ ("แนบไฟล์ประกอบ") จึงไม่ซ้ำหัวข้อ
  return `<div class="field">${hint ? `<span class="field-label">${label}</span>` : ""}<label class="btn secondary file-pick" for="${id}" title="${escapeHtml(ATTACHMENT_HINT)}">${uiIcon("camera")} ถ่ายรูป / เลือกไฟล์</label><input class="file-pick-input" id="${id}" name="extra_files" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx">${hint ? `<small>${ATTACHMENT_HINT_SHORT}</small>` : ""}</div>`;
}

// หน้าที่ฟอร์มขั้นของผู้ดูมีช่องไฟล์ของตัวเอง (ฟอร์มจบงานของช่าง ฟอร์มใน "สิ่งที่คุณต้องดำเนินการ" ของ NCR):
// ซ่อนช่องอัปโหลดแยกในการ์ดไฟล์ ให้เหลือทางแนบทางเดียว ไฟล์ที่เลือกในการ์ดไฟล์จึงไม่หายเงียบเมื่อกดส่งฟอร์มของขั้น
// แทนด้วยปุ่มลิงก์ที่พาไปช่องไฟล์ของฟอร์มนั้น · ผู้ที่ไม่มีฟอร์มของขั้น (เช่น ผู้อนุมัติ ผู้ดู) ยังแนบผ่านการ์ดไฟล์ได้เหมือนเดิม
function pointToStepFiles(standalone, stepInput, text) {
  if (!standalone || !stepInput) return false;
  standalone.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-button step-files-link";
  button.textContent = text;
  button.addEventListener("click", () => {
    stepInput.closest("details")?.setAttribute("open", "");
    const field = stepInput.closest(".field") ?? stepInput;
    field.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    stepInput.focus({ preventScroll: true });
  });
  standalone.after(button);
  return true;
}

// ระหว่างเตรียมรูป (เช่น แปลง HEIC) attachment-image.js ตั้ง setCustomValidity ไว้ที่ช่อง ฟอร์มที่ novalidate ไม่ถูกเบราว์เซอร์กันส่ง
// จึงตรวจที่นี่: ทุกการกระทำที่อ่านไฟล์ผ่านตัวนี้รอจนรูปพร้อมก่อน ไม่ส่งไฟล์ต้นฉบับที่ยังแปลงไม่เสร็จ
function readExtraFiles(input) {
  if (!input) return [];
  if (input.validity?.customError) throw new Error(input.validationMessage);
  return optionalAttachments(input.files);
}

// คืนข้อความเตือนเมื่อมีไฟล์ที่แนบไม่สำเร็จ ("" = ไม่มีไฟล์หรือแนบครบ)
async function uploadExtraFiles(requestId, files, uploaderId) {
  if (!files.length) return "";
  const uploaded = await uploadAttachmentBatch(files, (file) => uploadRequestAttachment(requestId, file, uploaderId));
  return uploaded.failed.length
    ? `${attachmentBatchFailureText(uploaded)} · บันทึกการดำเนินการแล้ว กรุณาแนบไฟล์ที่ไม่สำเร็จใหม่ที่ส่วน "ไฟล์แนบ"`
    : "";
}

// ---------------------------------------------------------------------------
// ตัวอย่างไฟล์แนบ: แสดงรูปทันทีในหน้า (รวมถึงหน้าแรกของ PDF ที่มีภาพย่อ) โดยไม่ต้องกดเปิด
// ---------------------------------------------------------------------------
const ATTACHMENT_URL_TTL = 3600;
// signed URL ที่สร้างแล้วถูกใช้ซ้ำจนเหลืออายุไม่ถึง 10 นาที: URL ใหม่ (token ใหม่) ทุกครั้งที่เปิดหน้าทำให้เบราว์เซอร์
// ใช้ cache ไม่ได้และโหลดรูปเต็มซ้ำทุกรอบ ซึ่งเป็นต้นเหตุหลักของ Egress ใน Supabase ล้างเมื่อออกจากระบบ (onAuthStateChange)
const ATTACHMENT_URL_REUSE_MS = 10 * 60 * 1000;
// เก็บ signed URL ไว้ใน sessionStorage ด้วย รีเฟรชหน้าแล้วได้ URL เดิม เบราว์เซอร์จึงใช้ไฟล์จาก cache (max-age 1 ชม.)
// แทนการโหลดใหม่ ใช้ sessionStorage ไม่ใช่ localStorage: URL เป็นสิทธิ์อ่านไฟล์ชั่วคราว ให้หายเมื่อปิดแท็บ
// ผูกกับผู้ใช้ (owner): session เปลี่ยนคนโดยแท็บนี้ไม่ได้รับ SIGNED_OUT ก็ไม่ใช้ URL ของคนก่อน (ดู onAuthStateChange)
const SIGNED_URL_STORAGE_KEY = "mnp-signed-attachment-urls";
let signedUrlOwner = null;
const signedAttachmentUrls = loadSignedAttachmentUrls();

function loadSignedAttachmentUrls() {
  const urls = new Map();
  try {
    const saved = JSON.parse(sessionStorage.getItem(SIGNED_URL_STORAGE_KEY) ?? "{}");
    const now = Date.now();
    signedUrlOwner = typeof saved?.owner === "string" ? saved.owner : null;
    for (const [key, entry] of Array.isArray(saved?.entries) ? saved.entries : []) {
      if (typeof key === "string" && typeof entry?.url === "string" && Number(entry.expiresAt) > now) urls.set(key, entry);
    }
  } catch {
    // อ่านไม่ได้ (โหมดส่วนตัว/ข้อมูลเสีย) เริ่มใหม่ว่างๆ
  }
  return urls;
}

function saveSignedAttachmentUrls() {
  try {
    const now = Date.now();
    for (const [key, entry] of signedAttachmentUrls) if (entry.expiresAt <= now) signedAttachmentUrls.delete(key);
    if (signedAttachmentUrls.size && signedUrlOwner) {
      sessionStorage.setItem(SIGNED_URL_STORAGE_KEY, JSON.stringify({ owner: signedUrlOwner, entries: [...signedAttachmentUrls] }));
    } else sessionStorage.removeItem(SIGNED_URL_STORAGE_KEY);
  } catch {
    // เขียนไม่ได้ (เต็ม/โหมดส่วนตัว) ยังใช้ cache ในหน่วยความจำได้ตามเดิม
  }
}

// เรียกทุกครั้งที่สถานะ auth เปลี่ยน: ออกจากระบบหรือเปลี่ยนผู้ใช้ ล้าง URL ที่จำไว้ทั้งหมด
function syncSignedUrlOwner(userId) {
  if (userId && userId === signedUrlOwner) return;
  signedAttachmentUrls.clear();
  signedUrlOwner = userId ?? null;
  saveSignedAttachmentUrls();
}
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
  let state = preview.querySelector(".attachment-preview-state");
  if (!state) {
    // ภาพย่อโหลดไม่ขึ้นหลังแสดงไปแล้ว: เอารูปเสียออก แล้วใส่ข้อความแทน
    preview.querySelector(".attachment-preview-media, .attachment-preview-text")?.remove();
    state = document.createElement("span");
    state.className = "attachment-preview-state";
    preview.prepend(state);
  }
  state.textContent = message;
}

function previewImageNode(src, alt) {
  const image = new Image();
  image.className = "attachment-preview-media";
  image.alt = alt;
  image.loading = "lazy";
  image.src = src;
  return image;
}

// thumbnailUrl: ภาพย่อที่อัปโหลดคู่กับไฟล์ (ถ้ามี) ใช้แทนไฟล์เต็มในกระเบื้อง ไฟล์เต็มโหลดเฉพาะตอนเปิด lightbox/ดาวน์โหลด
async function fillAttachmentTile(file, url, thumbnailUrl = null) {
  const tile = document.querySelector(`.attachment-tile[data-attachment="${file.id}"]`);
  if (!tile) return;
  const kind = attachmentKind(file);
  const downloadLink = tile.querySelector("[data-attachment-download]");
  if (downloadLink) {
    downloadLink.href = `${url}&download=${encodeURIComponent(file.file_name)}`;
    downloadLink.hidden = false;
  }
  try {
    if (thumbnailUrl && (kind === "image" || kind === "pdf")) {
      const thumbnail = previewImageNode(thumbnailUrl, kind === "pdf" ? `ตัวอย่างหน้าแรกของ ${file.file_name}` : file.file_name);
      // ภาพย่อเสีย/โหลดไม่ได้ กลับไปใช้ไฟล์จริงแบบไฟล์เก่า
      thumbnail.addEventListener("error", () => fillAttachmentTile(file, url), { once: true });
      setTilePreview(tile, thumbnail);
      return;
    }
    if (kind === "image") {
      setTilePreview(tile, previewImageNode(url, file.file_name));
      return;
    }
    // PDF ที่ไม่มีภาพย่อ (ไฟล์เก่า) ไม่โหลดทั้งไฟล์มาวาดหน้าแรก — โหลดเฉพาะตอนกดเปิดใน lightbox
    if (kind === "pdf") {
      setTileMessage(tile, "กดเพื่อดูไฟล์");
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

// คืน Map path → signed URL โดยขอ URL ใหม่เฉพาะไฟล์ที่ยังไม่มีใน cache หรือใกล้หมดอายุ
async function signAttachmentPaths(bucket, paths) {
  const now = Date.now();
  const signedByPath = new Map();
  const missing = [];
  for (const path of paths) {
    const cached = signedAttachmentUrls.get(`${bucket}/${path}`);
    if (cached && cached.expiresAt - now > ATTACHMENT_URL_REUSE_MS) signedByPath.set(path, cached.url);
    else missing.push(path);
  }
  if (!missing.length) return { signedByPath, error: null };
  const { data, error } = await sb.storage.from(bucket).createSignedUrls(missing, ATTACHMENT_URL_TTL);
  if (error) return { signedByPath, error };
  const expiresAt = now + ATTACHMENT_URL_TTL * 1000;
  for (const item of data ?? []) {
    if (!item.signedUrl) continue;
    signedAttachmentUrls.set(`${bucket}/${item.path}`, { url: item.signedUrl, expiresAt });
    signedByPath.set(item.path, item.signedUrl);
  }
  saveSignedAttachmentUrls();
  return { signedByPath, error: null };
}

// bucket: ไฟล์แนบคำร้องใช้ request-attachments ส่วน NCR ใช้ ncr-attachments (modules/module-ncr.js)
async function hydrateAttachmentGallery(files, bucket = "request-attachments") {
  if (!files.length || !document.querySelector("#attachment-gallery")) return;
  attachmentPreviews.clear();
  // ขอ URL ของภาพย่อพร้อมไฟล์จริงในคำขอเดียว ไฟล์เก่าที่ไม่มีภาพย่อจะไม่ได้ URL กลับมา (ใช้ไฟล์จริงแทน)
  const thumbnailPathOf = (file) => window.MNP_ATTACHMENT_IMAGE?.thumbnailPath(file.storage_path);
  const thumbnailPaths = files.filter((file) => ["image", "pdf"].includes(attachmentKind(file))).map(thumbnailPathOf).filter(Boolean);
  const { signedByPath, error } = await signAttachmentPaths(bucket, [...files.map((file) => file.storage_path), ...thumbnailPaths]);
  if (error) {
    document.querySelectorAll(".attachment-tile").forEach((tile) => setTileMessage(tile, "เปิดไฟล์แนบไม่ได้"));
    return;
  }
  for (const file of files) {
    const url = signedByPath.get(file.storage_path);
    if (!url) {
      const tile = document.querySelector(`.attachment-tile[data-attachment="${file.id}"]`);
      if (tile) setTileMessage(tile, "เปิดไฟล์แนบไม่ได้");
      continue;
    }
    attachmentPreviews.set(file.id, { file, url, pageCount: null, thumbnailUrl: signedByPath.get(thumbnailPathOf(file)) ?? null });
  }
  // กระเบื้องไม่เรนเดอร์ PDF แล้ว (ใช้ภาพย่อ) จึงเติมทุกช่องพร้อมกันได้
  for (const file of files) {
    const entry = attachmentPreviews.get(file.id);
    if (entry) fillAttachmentTile(file, entry.url, entry.thumbnailUrl);
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

// repair = ใบแจ้งซ่อม (isRepairType) — ชื่อสถานะบางขั้นของใบแจ้งซ่อมเรียกต่างจากคำร้องทั่วไป (ดู repairStatusLabels)
// final = "อนุมัติแล้ว" ที่เป็นปลายทางของใบ (isFinalDecision) ใช้สีและสัญลักษณ์ของ "เสร็จ" ไม่ใช่ "กำลังทำ"
function statusBadge(status, repair = false, final = false) {
  return `<span class="badge ${escapeHtml(status)}${final ? " is-final" : ""}">${escapeHtml(statusLabel(status, repair))}</span>`;
}

// โมดูลที่จบที่มติ (endsAtDecision เช่น ใบคำร้องถึงฝ่ายบริหาร): อนุมัติแล้วคือจบ ไม่มีขั้นดำเนินงานต่อ
function isFinalDecision(type, status) {
  return status === "approved" && Boolean(requestModule(type?.code)?.endsAtDecision);
}

// ใบที่รอขั้นอนุมัติ: ป้ายใช้คำของขั้นนั้น ("รอรับทราบ" หรือ "รออนุมัติ" ตามชื่อขั้น · ไม่มี "รอรับงาน": งานซ่อม MT หัวหน้าซ่อมบำรุงมอบหมายช่างหลังผู้จัดการทั่วไปอนุมัติ)
function pendingStepBadge(request, currentStep, repair = false, final = false) {
  if (request.status !== "pending_approval" || !currentStep) return statusBadge(request.status, repair, final);
  return `<span class="badge ${escapeHtml(request.status)}">${escapeHtml(window.MNP_STEP_VERB.pendingLabel(currentStep.step_name))}</span>`;
}

// หัวเรื่องของใบ: รหัสแบบ "HCM-03" ไม่ขึ้นบรรทัดใหม่ตรงขีด (จอแคบเคยตัดเป็น "HCM-" / "03")
function headingTextHtml(text) {
  return escapeHtml(text).replace(/[A-Za-z]{1,8}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g, (code) => `<span class="nowrap">${code}</span>`);
}

// ไฟล์แนบที่เลือกแล้วแต่ยังไม่ได้กด "อัปโหลด" (หน้ารายละเอียดคำร้อง): ถามก่อนออกจากหน้า รูปที่ถ่ายจึงไม่หายเงียบ ๆ
// คงปุ่มยืนยันไว้เพราะไฟล์ที่อัปโหลดแล้วลบไม่ได้ (ผู้ใช้เลือก 2026-11-12)
function pendingAttachmentCount() {
  const form = document.querySelector("#attachment-form");
  if (!form || form.hasAttribute("aria-busy")) return 0;
  return form.querySelector("#attachment-file")?.files?.length ?? 0;
}
function confirmLeaveWithPendingFiles(count) {
  return confirmDialog({ title: `ยังไม่ได้อัปโหลด ${count} ไฟล์`, message: "ออกจากหน้านี้แล้วไฟล์ที่เลือกไว้จะไม่ถูกแนบ", confirmLabel: "ออกโดยไม่อัปโหลด", cancelLabel: "อยู่ต่อเพื่ออัปโหลด", danger: true });
}
// ปุ่มย้อนกลับ/ปัดย้อนกลับ: hashchange ยกเลิกไม่ได้ ใช้ Navigation API ที่ยกเลิกการย้อนกลับได้ (เบราว์เซอร์ที่ไม่มีจะออกเหมือนเดิม)
window.navigation?.addEventListener("navigate", (event) => {
  if (event.navigationType !== "traverse" || !event.cancelable) return;
  const count = pendingAttachmentCount();
  if (!count) return;
  event.preventDefault();
  const key = event.destination.key;
  confirmLeaveWithPendingFiles(count).then((leave) => {
    if (!leave) return;
    const input = document.querySelector("#attachment-form #attachment-file");
    if (input) input.value = "";
    window.navigation.traverseTo(key);
  });
});
window.addEventListener("beforeunload", (event) => {
  if (!pendingAttachmentCount()) return;
  event.preventDefault();
  event.returnValue = "";
});
document.addEventListener("click", async (event) => {
  const link = event.target.closest?.('a[href^="#/"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const count = pendingAttachmentCount();
  if (!count || link.closest("#attachment-form")) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  if (await confirmLeaveWithPendingFiles(count)) location.hash = href;
}, true);

// ชื่อเครื่องจักรที่แสดง (รายการ หน้ารายละเอียด ฟอร์ม MT และแดชบอร์ด MT ใช้ตัวนี้ตัวเดียว)
// ชื่อที่มีรหัสอยู่แล้ว (เช่น "เครื่องฉีดยาง HCM-03") ไม่นำหน้าด้วยรหัสซ้ำ — เดิมขึ้น "HCM-03 — เครื่องฉีดยาง HCM-03"
function machineLabelOf(code, name, separator = " — ") {
  const machineCode = String(code ?? "").trim();
  const machineName = String(name ?? "").trim();
  if (!machineName || machineName === machineCode) return machineCode;
  if (!machineCode) return machineName;
  // รหัสต้องอยู่ในชื่อเป็นคำทั้งคำ (ไม่ใช่ส่วนหนึ่งของรหัสอื่น เช่น "CV-0" ใน "CV-02") ไม่สนตัวพิมพ์เล็ก/ใหญ่
  const escaped = machineCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(^|[^\\p{L}\\p{N}-])${escaped}($|[^\\p{L}\\p{N}-])`, "iu").test(machineName);
  return named ? machineName : `${machineCode}${separator}${machineName}`;
}

// action: การ์ดที่กดได้ (เช่น เครื่องจักร → ประวัติการซ่อม) วาดเป็นปุ่ม ให้โมดูลผูก click ด้วย data-fact-action
// คำอธิบายปุ่มอยู่ใน title/aria-label ตามกติกา "ไม่ใส่ข้อความอธิบายถาวรบนจอ"
// icon = ชื่อไอคอนใน UI_ICON_PATHS (เช่น "flag", "user", "machine", "calendar") ค่าที่ไม่ใช่ชื่อไอคอนยังแสดงเป็นตัวอักษรเหมือนเดิม
function requestFact(label, value, { icon = "info", tone = "primary", wide = false, valueClass = "", action = "", actionLabel = "" } = {}) {
  // ช่องที่ไม่มีค่า ("—" หรือว่าง) ไม่ต้องแสดงในหน้ารายละเอียด ยกเว้นช่องที่กดเพื่อกรอกได้ (action)
  if (!action && ["", "—"].includes(String(value ?? "").trim())) return "";
  const classes = ["request-fact", `request-fact-${tone}`, wide ? "wide" : ""].filter(Boolean).join(" ");
  const valueClasses = ["request-fact-value", valueClass].filter(Boolean).join(" ");
  // <button> ใส่ได้แค่ phrasing content จึงใช้ span แทน div (สไตล์อยู่ที่ class .request-fact-copy ทั้งคู่)
  const copyTag = action ? "span" : "div";
  const iconHtml = Object.hasOwn(UI_ICON_PATHS, icon) ? uiIcon(icon) : escapeHtml(icon);
  const body = `<span class="request-fact-icon" aria-hidden="true">${iconHtml}</span>
    <${copyTag} class="request-fact-copy">
      <span class="request-fact-label">${escapeHtml(label)}</span>
      <strong class="${escapeHtml(valueClasses)}">${escapeHtml(value ?? "—")}</strong>
    </${copyTag}>`;
  if (action) {
    return `<button type="button" class="${escapeHtml(`${classes} is-action`)}" data-fact-action="${escapeHtml(action)}" aria-haspopup="dialog" title="${escapeHtml(actionLabel)}" aria-label="${escapeHtml(`${label}: ${value ?? "—"} — ${actionLabel}`)}">
    ${body}
    <span class="request-fact-chevron" aria-hidden="true">›</span>
  </button>`;
  }
  return `<div class="${escapeHtml(classes)}">
    ${body}
  </div>`;
}

function requesterLabel(request, directory) {
  const fromDirectory = directory ? personName(directory, request.requester_id) : "—";
  if (fromDirectory && fromDirectory !== "—") return fromDirectory;
  return (request.requester_name ?? "").trim() || "—";
}


// กรอบแสดงเลขที่เอกสารถัดไปบนฟอร์มสร้างคำร้องทุกโมดูล (เลขจริงถูกจองตอนส่งใบ จึงเป็นค่าโดยประมาณ)
function docNumberBoxHtml(id) {
  return `<div class="doc-number-box" id="${id}"><span class="doc-number-label">เลขที่เอกสาร</span><strong class="doc-number-value">—</strong></div>`;
}

function setDocNumberBox(id, value) {
  const box = document.querySelector(`#${id}`);
  if (box) box.querySelector(".doc-number-value").textContent = value || "—";
}

// ---- ส่วนที่ฟอร์มสร้างทุกโมดูลใช้ร่วมกัน (ใบแจ้งซ่อม MT, คำร้องทั่วไป IT/MG, ออก NCR) ----
// โฟกัสหัวขั้นแรกโดยไม่เปิดแป้นพิมพ์ (เช่น หลังแถบร่างหายไป)
function focusFirstStep(form) {
  const legend = form.querySelector('[data-step="1"] legend');
  if (!legend) return;
  legend.tabIndex = -1;
  legend.focus();
}

// ยกเลิกเมื่อกรอกไว้แล้ว: ถามก่อนทิ้ง (ทิ้ง = ล้างร่างด้วย) ไม่ได้กรอกอะไร = ออกทันที
function bindFormCancel(form, { title, isDirty, onDiscard }) {
  form.querySelector("[data-form-cancel]")?.addEventListener("click", async (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    if (!(await confirmDialog({ title, message: "ข้อมูลที่กรอกและร่างบนเครื่องนี้จะหายไป", confirmLabel: "ทิ้งใบนี้", cancelLabel: "กลับไปกรอกต่อ", danger: true }))) return;
    onDiscard();
    location.hash = href;
  });
}

// ส่งไม่ผ่าน: ทุกช่องยังอยู่ บอกเหนือฟอร์ม แล้วคืนโฟกัสที่ปุ่มส่ง (ถูกปิดระหว่างรอ โฟกัสจึงหลุด) กดซ้ำได้ทันที
function showFormSubmitError(form, messageBox, error) {
  messageBox.innerHTML = `<div class="form-message error" role="alert">${escapeHtml(friendlyError(error))}</div>`;
  setFormBusy(form, false);
  messageBox.scrollIntoView({ block: "nearest" });
  form.querySelector("[data-step-submit]")?.focus({ preventScroll: true });
}

// แนบไฟล์หลังสร้างใบแล้ว: คืนข้อความเตือนถ้าบางไฟล์ไม่ผ่าน (ใบถูกสร้างแล้ว แนบใหม่ได้ภายหลัง)
async function uploadAfterCreate(files, upload, retryHint) {
  if (!files.length) return "";
  try {
    const uploaded = await uploadAttachmentBatch(files, upload);
    return uploaded.failed.length ? `${attachmentBatchFailureText(uploaded)} ${retryHint}` : "";
  } catch (uploadError) {
    return `แนบไฟล์ไม่สำเร็จ: ${friendlyError(uploadError)} ${retryHint}`;
  }
}

// เลขที่และขั้นแรกที่รอ ของคำร้องที่เพิ่งส่ง — สำหรับใบเสร็จหลังส่ง อ่านไม่ได้ก็แสดงใบเสร็จแบบไม่มีเลขที่
async function requestReceiptFacts(requestId) {
  try {
    const [requestResult, stepResult] = await Promise.all([
      sb.from("requests").select("request_no").eq("id", requestId).maybeSingle(),
      sb.from("approval_steps").select("step_name,step_order").eq("request_id", requestId).order("step_order").limit(1),
    ]);
    return { requestNo: requestResult.data?.request_no ?? "", waitingOn: (stepResult.data ?? [])[0]?.step_name ?? "" };
  } catch {
    return { requestNo: "", waitingOn: "" };
  }
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

// ---- ทะเบียน: รายการคำร้องของโมดูล กระดานติดตามสถานะทุกใบ และทะเบียน NCR ใช้ตารางชุดเดียว ----
// จอกว้างเป็นตารางเรียงคอลัมน์แบบทะเบียนกระดาษ จอแคบ (≤760px) แต่ละแถวเป็นการ์ดเตี้ย: เลขที่ + สถานะบรรทัดแรก เรื่องบรรทัดที่สอง
// ช่องที่เหลือเป็นบรรทัดเล็กที่มีชื่อคอลัมน์นำ (data-label) — columns: [{ key, label, role }] role: "no" | "subject" | "status"
// ค่าใน cells เป็น HTML ที่ผู้เรียก escape แล้ว (ใช้ registerNoHtml / registerSubjectHtml สร้างช่องเลขที่และเรื่อง)
// role ประกาศซ้ำทุกชั้น: บนจอแคบ CSS เปลี่ยน table/tr เป็น block/flex ซึ่ง Safari ทิ้งความหมายตารางให้โปรแกรมอ่านจอ
function registerTableHtml({ label, columns, rows }) {
  const head = columns.map((column) => `<th scope="col" role="columnheader">${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => `<tr role="row"${row.className ? ` class="${escapeHtml(row.className)}"` : ""}>${columns
    .map((column) => `<td role="cell" class="register-${column.role ?? "meta"}" data-label="${escapeHtml(column.label)}">${row.cells[column.key] || '<span class="register-none">—</span>'}</td>`).join("")}</tr>`).join("");
  return `<div class="register-wrap"><table class="register-table" role="table" aria-label="${escapeHtml(label)}"><thead role="rowgroup"><tr role="row">${head}</tr></thead><tbody role="rowgroup">${body}</tbody></table></div>`;
}

// เลขที่ใบ: ลิงก์ไปหน้ารายละเอียด หรือข้อความเทาพร้อมกุญแจเมื่อบัญชีนี้เปิดดูรายละเอียดไม่ได้ (เหตุผลอยู่ใน title และข้อความสำหรับโปรแกรมอ่านจอ)
function registerNoHtml(number, href, lockedTitle = "") {
  return href
    ? `<a class="request-no register-no-link" href="${href}">${escapeHtml(number)}</a>`
    : `<span class="request-no locked" title="${escapeHtml(lockedTitle)}">${uiIcon("lock")} ${escapeHtml(number)}${lockedTitle ? `<span class="sr-only"> (${escapeHtml(lockedTitle)})</span>` : ""}</span>`;
}

// บรรทัดเล็กใต้ช่อง: จอกว้างตัดเหลือบรรทัดเดียว จึงมีค่าเต็มใน title
function registerSubHtml(text, iconHtml = "", title = text) {
  return `<span class="register-sub" title="${escapeHtml(title)}">${iconHtml}${escapeHtml(text)}</span>`;
}


// เรื่อง: บรรทัดหลักเป็นลิงก์ (ถ้าเปิดได้) บรรทัดรองตัดให้เหลือบรรทัดเดียว
function registerSubjectHtml(main, href, secondary = "") {
  const title = href ? `<a class="register-title" href="${href}">${escapeHtml(main)}</a>` : `<strong class="register-title">${escapeHtml(main)}</strong>`;
  return `${title}${secondary ? registerSubHtml(secondary) : ""}`;
}

// ประเภทคำร้องในรายการที่รวมหลายประเภท (ในโมดูลเดียวไม่แสดง เพราะหัวโมดูลบอกแล้ว)
function registerTypeHtml(code, name) {
  return `<span class="request-card-type" data-module="${requestPalette(code)}">${escapeHtml(name ?? "คำร้อง")}</span>`;
}

// รายการคำร้องตามสิทธิ์ (หน้ารายการของโมดูล และรายการทุกประเภทที่กรองสถานะจากแดชบอร์ด)
function requestRows(requests, { showRequester = false, showType = false, directory = null, empty = EMPTY_REQUESTS, params = null, filtered = false } = {}) {
  if (!requests.length) {
    const blank = filtered ? listEmptyOf(params, true) : { text: "ยังไม่มีรายการในขณะนี้", ...empty };
    return emptyState(blank.text, blank);
  }
  const columns = [
    { key: "no", label: "เลขที่", role: "no" },
    { key: "subject", label: "เรื่อง", role: "subject" },
    ...(showType ? [{ key: "type", label: "ประเภท" }] : []),
    ...(showRequester ? [{ key: "requester", label: "ผู้แจ้ง" }] : []),
    { key: "created", label: "แจ้งเมื่อ" },
    { key: "status", label: "สถานะ", role: "status" },
  ];
  const rows = requests.map((request) => {
    const type = relation(request.request_type);
    const href = `#/request?id=${encodeURIComponent(request.id)}`;
    const machine = machineLabelOf(request.machine_code, request.machine_name, " · ");
    const description = (request.description ?? "").trim();
    // หัวของแถวคือชื่อเรื่องของใบ (ชื่อเดียวกับคิวหน้าหลักและหน้ารายละเอียด) เครื่องจักรอยู่บรรทัดรองเมื่อชื่อเรื่องยังไม่บอก
    const main = request.title;
    // บรรทัดรอง: ชื่อเรื่องเมื่อหัวเป็นเครื่องจักร ไม่งั้นรายละเอียด (ไม่ซ้ำกับหัว) + วันที่ต้องการใช้งานถ้ามี
    const machineInTitle = [request.machine_code, request.machine_name].some((value) => value && request.title.includes(value));
    const detail = machine ? (machineInTitle ? "" : machine) : description;
    const secondary = [detail && detail !== main ? detail : "", request.needed_date ? `ต้องการใช้ ${formatDate(request.needed_date)}` : ""].filter(Boolean).join(" · ");
    const owners = requestOwnerNames(request, directory);
    return {
      className: `status-${request.status}`,
      cells: {
        no: registerNoHtml(request.request_no, href),
        subject: registerSubjectHtml(main, href, secondary),
        type: registerTypeHtml(type?.code, type?.name_th),
        requester: escapeHtml(requesterLabel(request, directory)),
        created: formatDate(request.created_at, true),
        // ความสำคัญปกติไม่ต้องมีป้าย ป้ายจึงหมายถึง "ไม่ปกติ" เสมอ
        status: `<span class="register-badges">${pendingStepBadge(request, (request.approval_steps ?? []).find((step) => step.status === "pending" && step.step_order === request.current_step), isRepairType(type), isFinalDecision(type, request.status))}${["assigned", "in_progress"].includes(request.status) && request.work_expected_date && request.work_expected_date < bangkokToday() ? `<span class="badge urgent-flag" title="กำหนดเสร็จ ${escapeHtml(formatDate(request.work_expected_date))}">เลยกำหนดเสร็จ</span>` : ""}${["high", "urgent"].includes(request.priority) ? `<span class="badge urgent-flag">${escapeHtml(priorityLabel(request.priority, isRepairType(type)))}</span>` : request.priority && request.priority !== "normal" ? `<span class="request-priority-chip priority-${escapeHtml(request.priority)}">${escapeHtml(priorityLabel(request.priority, isRepairType(type)))}</span>` : ""}</span>${owners.length ? registerSubHtml(owners.join(", "), `${uiIcon("user")} `, `ผู้รับผิดชอบ: ${owners.join(", ")}`) : ""}`,
      },
    };
  });
  return registerTableHtml({ label: "รายการคำร้อง", columns, rows });
}

/* กระดานติดตามสถานะที่ "ทุกคน" เห็นได้ — ข้อมูลมาจาก RPC app_request_status_board ซึ่งคืนเฉพาะ
   ฟิลด์ระดับติดตามสถานะ ไม่มีรายละเอียดอาการ/ไฟล์แนบ/ความเห็นผู้อนุมัติ ใบที่ผู้ใช้ไม่มีสิทธิ์
   เปิดดูเต็ม (can_open = false) จึงแสดงเป็นข้อความเฉย ๆ ไม่ทำเป็นลิงก์ */
function statusBoardRows(rows, { showType = false, params = null, filtered = false } = {}) {
  if (!rows.length) {
    const blank = filtered ? listEmptyOf(params, true) : { text: "ยังไม่มีรายการในขณะนี้", ...EMPTY_REQUESTS };
    return emptyState(blank.text, blank);
  }
  const columns = [
    { key: "no", label: "เลขที่", role: "no" },
    { key: "subject", label: "เรื่อง", role: "subject" },
    ...(showType ? [{ key: "type", label: "ประเภท" }] : []),
    { key: "department", label: "แผนก" },
    { key: "requester", label: "ผู้แจ้ง" },
    { key: "updated", label: "อัปเดตล่าสุด" },
    { key: "status", label: "สถานะ", role: "status" },
  ];
  return registerTableHtml({
    label: "สถานะคำร้องทุกใบ",
    columns,
    rows: rows.map((row) => {
      const href = row.can_open ? `#/request?id=${encodeURIComponent(row.id)}` : "";
      return {
        className: `status-${row.status}`,
        cells: {
          no: registerNoHtml(row.request_no, href, "บัญชีนี้ดูได้เฉพาะสถานะและความคืบหน้าของใบนี้"),
          subject: registerSubjectHtml(row.subject ?? "—", href),
          type: registerTypeHtml(row.type_code, row.type_name_th),
          department: escapeHtml(row.department_name ?? row.department_code ?? ""),
          requester: escapeHtml(row.requester_name ?? ""),
          updated: formatDate(row.last_changed_at ?? row.submitted_at, true),
          status: `<span class="register-badges">${statusBadge(row.status, Boolean(row.uses_repair_workflow), isFinalDecision({ code: row.type_code }, row.status))}${row.is_urgent ? `<span class="badge urgent-flag">ด่วน</span>` : ""}</span>${row.waiting_on ? registerSubHtml(`รอ${row.waiting_on}`) : ""}`,
        },
      };
    }),
  });
}

// ตัวเลือกแบบเลื่อนหน้า: แต่ละ option พาไปที่ data-href ของตัวเอง (สถานะของคำร้อง หมวดของทะเบียน NCR)
// ใช้ dropdown ของเบราว์เซอร์ (data-native-select) เพราะตัวเลือกน้อยและไม่ต้องค้นหา บน iPhone เป็นวงล้อเลือกที่แตะง่าย
function hrefSelectHtml({ id, label, options, value }) {
  return `<label class="list-filter" for="${escapeHtml(id)}"><span class="list-filter-label">${escapeHtml(label)}</span><select class="select" id="${escapeHtml(id)}" data-native-select data-href-select>${options
    .map((option) => `<option value="${escapeHtml(option.value)}" data-href="${escapeHtml(option.href)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
}
// เมาส์/แตะ: เลือกแล้วไปทันที · คีย์บอร์ด: Chrome ยิง change ทุกครั้งที่กดลูกศรบน select ที่ปิดอยู่
// จึงรอให้กด Enter หรือออกจากช่องก่อนค่อยไป (เลื่อนดูตัวเลือกได้โดยหน้าไม่เปลี่ยนใต้มือ) แล้วคืนโฟกัสที่ช่องเดิมหลังวาดหน้าใหม่
function followHrefSelect(select) {
  const href = select.selectedOptions[0]?.dataset.href;
  delete select.dataset.keyed;
  if (!href || `#${location.hash.slice(1)}` === href) return;
  const id = select.id;
  const refocus = (tries = 0) => {
    const next = document.getElementById(id);
    if (next && next !== select) next.focus();
    else if (tries < 40) setTimeout(() => refocus(tries + 1), 50);
  };
  if (select.dataset.refocus === "1" && id) window.addEventListener("hashchange", () => refocus(), { once: true });
  location.hash = href;
}
document.addEventListener("keydown", (event) => {
  const select = event.target.closest?.("select[data-href-select]");
  if (!select) return;
  if (event.key === "Enter") {
    event.preventDefault();
    select.dataset.refocus = "1";
    followHrefSelect(select);
  } else if (event.key !== "Tab" && event.key !== "Shift") {
    select.dataset.keyed = "1";
  }
});
document.addEventListener("change", (event) => {
  const select = event.target.closest?.("select[data-href-select]");
  if (!select || select.dataset.keyed === "1") return;
  followHrefSelect(select);
});
document.addEventListener("focusout", (event) => {
  const select = event.target.closest?.("select[data-href-select]");
  if (select?.dataset.keyed === "1") followHrefSelect(select);
});

// ปุ่มช่วยเหลือ: แสดงทุกอุปกรณ์ เปิดกล่องวิธีใช้หน้านี้ + ความหมายของป้าย + คีย์ลัด (ส่วนคีย์ลัดซ่อนบนจอสัมผัสล้วน)
function helpButton() {
  return `<button class="icon-button help-toggle" type="button" aria-label="ช่วยเหลือ" title="ช่วยเหลือ (กด ?)" aria-haspopup="dialog" aria-keyshortcuts="?"><span aria-hidden="true">?</span></button>`;
}

function themeButton() {
  return `<button class="icon-button theme-toggle" type="button" aria-label="สลับธีม" title="สลับธีม">${uiIcon("theme")}</button>`;
}

// แอปที่ติดตั้งแบบ standalone บน Desktop/Android ไม่มีปุ่มย้อนกลับ/ถัดไปของเบราว์เซอร์
// เช็ก standalone ตรงๆ ไม่ใช้ isStandaloneApp() เพราะ minimal-ui มีปุ่มของเบราว์เซอร์อยู่แล้ว (styles.css ก็แสดงเฉพาะ standalone)
// ปุ่มย้อนกลับปิดไว้ที่หน้าหลัก (ไม่ซ่อน ปุ่มถัดไปจะได้ไม่เลื่อนตำแหน่ง): ย้อนจากหน้าหลักได้แค่ URL ตอนเปิดแอปซึ่งก็คือหน้าหลักเดิม
// ปุ่มถัดไปปิดไว้เมื่อไม่มีหน้าถัดไป (Navigation API ของ Chrome/Edge; เบราว์เซอร์ที่ไม่มี API เปิดไว้เสมอ)
// shell() สร้าง topbar ใหม่ทุกครั้งที่เปลี่ยนหน้า สถานะปุ่มจึงตรงกับหน้าปัจจุบันเสมอ
function appNavButtons() {
  const ios = window.MNP_INSTALL_APP.isIos({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  if (!window.MNP_INSTALL_APP.showAppBack({ standalone, ios })) return "";
  const atHome = currentRoute().path === homePath();
  const back = `<button class="icon-button app-back" type="button" aria-label="ย้อนกลับ" title="ย้อนกลับ"${atHome ? " disabled" : ""}>‹</button>`;
  const canForward = window.navigation?.canGoForward ?? true;
  const forward = `<button class="icon-button app-forward" type="button" aria-label="ถัดไป" title="ถัดไป"${canForward ? "" : " disabled"}>›</button>`;
  return `<div class="app-nav">${back}${forward}</div>`;
}

// ยังไม่เคยกดสลับธีม (ไม่มี "mnp-theme") → ตามธีมของระบบปฏิบัติการ และเปลี่ยนตามเมื่อผู้ใช้เปลี่ยนธีมเครื่อง
const darkSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;

function applyTheme() {
  const saved = localStorage.getItem("mnp-theme");
  const dark = saved ? saved === "dark" : Boolean(darkSchemeQuery?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
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

/* ---------- ติดตั้งแอปลงหน้าจอ (แถบชวนติดตั้ง) ---------- */

// แถบด้านล่างจอที่ขึ้นเองในหน้าเข้าสู่ระบบและหน้าแรก (modules/install-app.js ตัดสินว่าเครื่องนี้ติดตั้งแบบไหน)
//   Chrome/Edge: มีปุ่ม "ติดตั้งแอป" เรียก beforeinstallprompt ที่เก็บไว้ (ต้องมี manifest + sw.js)
//   Safari บน iPhone/iPad: Apple ไม่ให้เว็บสั่งติดตั้ง แถบจึงบอกปุ่มที่ต้องแตะ
//     iPhone มีลูกศรชี้ลงหาแถบเครื่องมือของ Safari ซึ่งอยู่ด้านล่าง (iPad แถบอยู่ด้านบน จึงไม่มีลูกศร)
// กด "ปิด" แล้วจำไว้ในเครื่อง ไม่ขึ้นอีก (ล้างข้อมูลเว็บไซต์แล้วจะกลับมา) เก็บไม่ได้ก็ซ่อนไว้จนปิดหน้า
const INSTALL_DISMISSED_KEY = "mnp-install-dismissed";
let deferredInstallPrompt = null;
let installDismissedThisPage = false;

function installDismissed() {
  if (installDismissedThisPage) return true;
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function hideInstallBanner() {
  document.querySelector("#install-banner")?.remove();
  document.body.classList.remove("has-install-banner");
}

// ความสูงจริงของแถบ (ข้อความบน iPhone ตัดหลายบรรทัด) ใช้เว้นท้ายหน้าและยกปุ่มอัปเดต/toast ขึ้นเหนือแถบ
function syncInstallBannerHeight() {
  const banner = document.querySelector("#install-banner");
  if (banner) document.body.style.setProperty("--install-banner-h", `${banner.offsetHeight}px`);
}
window.addEventListener("resize", syncInstallBannerHeight);

// เปิดจากแอปที่ติดตั้งแล้ว (ไอคอนบนหน้าจอ) ไม่ใช่แท็บเบราว์เซอร์
// Chrome/Edge บน Desktop เปิดแอปแบบ minimal-ui (display_override ใน manifest) เพื่อให้มีปุ่มย้อนกลับ/โหลดใหม่ จึงนับเป็นแอปด้วย
function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone), (display-mode: minimal-ui)").matches || navigator.standalone === true;
}

function currentInstallMode() {
  return window.MNP_INSTALL_APP.installMode({
    standalone: isStandaloneApp(),
    hasPrompt: Boolean(deferredInstallPrompt),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

// แสดงเฉพาะหน้าเข้าสู่ระบบและหน้าแรกของผู้ใช้ หน้างานอื่นไม่มีแถบมาบังเนื้อหา
function installBannerAllowedHere() {
  const { path } = currentRoute();
  if (path === "set-password") return false;
  return !state.session || path === homePath();
}

const SHARE_ICON = `<svg class="install-share-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// hideOnly: ใช้ก่อนรู้ว่าหน้าจะถูกพาไปที่อื่นหรือไม่ (ซ่อนได้ แต่ยังไม่แสดง)
function refreshInstallBanner({ hideOnly = false } = {}) {
  const mode = installBannerAllowedHere() && !installDismissed() ? currentInstallMode() : null;
  let banner = document.querySelector("#install-banner");
  if (!mode) return hideInstallBanner();
  if (hideOnly) return;
  if (banner?.dataset.mode === mode) return;
  banner?.remove();
  banner = document.createElement("aside");
  banner.id = "install-banner";
  const iphone = /iPhone|iPod/.test(navigator.userAgent) || /iPhone|iPod/.test(navigator.platform);
  banner.className = `install-banner ${mode}`;
  banner.dataset.mode = mode;
  banner.setAttribute("aria-label", "ติดตั้งแอป MNP");
  banner.innerHTML = `
    <img class="install-banner-icon" src="./icons/apple-touch-icon.png" alt="">
    <div class="install-banner-text">${mode === "prompt"
      ? "<strong>ติดตั้ง MNP บนเครื่องนี้</strong><span>เปิดใช้จากหน้าจอได้ทันทีเหมือนแอป</span>"
      : `<strong>ติดตั้ง MNP บนหน้าจอโฮม</strong><span>แตะ ${SHARE_ICON} ของ Safari แล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b></span><small>ไม่เห็นปุ่มนี้ ให้แตะ ⋯ ก่อน</small>`}</div>
    ${mode === "prompt" ? `<button class="btn small" type="button" data-install-now>ติดตั้งแอป</button>` : ""}
    <button class="install-banner-close" type="button" data-install-dismiss aria-label="ปิด ไม่ต้องแนะนำการติดตั้งอีก">×</button>
    ${mode === "ios" && iphone ? `<span class="install-banner-arrow" aria-hidden="true"></span>` : ""}`;
  banner.addEventListener("click", (event) => {
    if (event.target.closest("[data-install-now]")) installNow();
    if (event.target.closest("[data-install-dismiss]")) {
      installDismissedThisPage = true;
      try {
        localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
      } catch {
        // เก็บไม่ได้ (โหมดส่วนตัว) ก็ซ่อนไว้จนกว่าจะเปิดหน้าใหม่
      }
      hideInstallBanner();
    }
  });
  document.body.append(banner);
  document.body.classList.add("has-install-banner");
  syncInstallBannerHeight();
}

async function installNow() {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  // prompt() เรียกได้ครั้งเดียวต่อ event ผู้ใช้ปิดหน้าต่างไปแล้วต้องรอ beforeinstallprompt รอบใหม่
  deferredInstallPrompt = null;
  try {
    await promptEvent.prompt();
  } catch (error) {
    console.warn("เปิดหน้าต่างติดตั้งแอปไม่สำเร็จ", error);
  } finally {
    refreshInstallBanner();
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  refreshInstallBanner();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  refreshInstallBanner();
});

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

  // ป้าย (จำเป็น) แสดงเฉพาะฟอร์มขอเปิดบัญชี (ฟอร์มเข้าสู่ระบบมีแค่ 2 ช่องซึ่งต้องกรอกทั้งคู่อยู่แล้ว)
  const req = isRequest ? REQUIRED_MARK : "";
  const requestFields = `
    <div class="field-row">
      <div class="field"><label for="first-name">ชื่อ${req}</label><input class="input" id="first-name" name="first_name" maxlength="100" required></div>
      <div class="field"><label for="last-name">นามสกุล${req}</label><input class="input" id="last-name" name="last_name" maxlength="100" required></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="department">แผนก${req}</label><select class="input" id="department" name="department_id" required><option value="">เลือกแผนก</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
      <div class="field"><label for="desired-role">ตำแหน่ง${req}</label><select class="input" id="desired-role" name="role_id" required><option value="">เลือกตำแหน่ง</option>${roles.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="job-title">ตำแหน่งที่แสดงใต้ชื่อ (ถ้ามี)</label><input class="input" id="job-title" name="job_title" maxlength="120"></div>
    <div class="field-row">
      <div class="field"><label for="email">อีเมล${req}</label><input class="input" id="email" name="email" type="email" maxlength="200" required autocomplete="email"></div>
      <div class="field"><label for="phone">เบอร์ติดต่อ${req}</label><input class="input" id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" pattern="[0-9+\\- ]{9,40}" title="กรอกเบอร์โทรอย่างน้อย 9 หลัก (ตัวเลข, +, - หรือเว้นวรรค)" placeholder="เช่น 0812345678" required></div>
    </div>`;

  document.title = "เข้าสู่ระบบ · MNP Workspace";
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-aside">
        <div class="brand brand-lg"><img class="brand-mark" src="./icons/icon-512.png" alt=""><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></div>
        <div class="auth-copy">
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
          <div id="auth-message" role="status">${message}${directoryError ? `<div class="form-message error">${escapeHtml(directoryError)}</div>` : ""}</div>
          <form id="auth-form">
            <div class="field"><label for="employee-no">รหัสพนักงาน${req}</label><input class="input" id="employee-no" name="employee_no" autocomplete="username" maxlength="32" placeholder="เช่น MNP0102" required></div>
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
  refreshInstallBanner();
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
    go(homePath());
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
  // session ถูกเพิกถอนแล้ว ลบแถวฝั่งฐานข้อมูลไม่ได้ ยกเลิกเฉพาะการสมัครในเครื่อง
  await releasePushOnThisDevice({ server: false });
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
  await releasePushOnThisDevice({ server: false });
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
  hideInstallBanner();
  console.error(error);
  document.title = "เชื่อมต่อระบบไม่ได้ · MNP Workspace";
  app.innerHTML = `<main class="boot-screen" role="alert"><img class="brand-mark" src="./icons/icon-192.png" alt=""><h2>เชื่อมต่อระบบไม่ได้</h2><p>ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง คุณยังอยู่ในระบบ ไม่ต้องเข้าสู่ระบบใหม่</p><button class="btn" id="reconnect-button" type="button">ลองอีกครั้ง</button></main>`;
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
  const [{ data: modulesData, error: modulesError }, labAccess, labOnly, actingRole, isMaster] = await Promise.all([sb.rpc("app_my_approval_modules"), loadLabAccess(), loadLabOnly(), loadActingRole(data.acting_role_id), loadMasterAccess()]);
  if (modulesError) throw modulesError;
  state.employee = {
    ...data,
    role: relation(data.role),
    department: relation(data.department),
    actingRole,
    approvalModules: new Set((modulesData ?? []).map((item) => item.code)),
    labAccess,
    labOnly,
    isMaster,
  };
  await applySandboxOverlay();
  return state.employee;
}

// บัญชี master (บัญชีเดียวเหนือผู้ดูแลระบบ, migration 20261113010000): ใช้แค่แสดงเมนู #/master และซ่อนปุ่มแก้บัญชี master
// ในหน้า Admin สิทธิ์จริงตรวจในฐานข้อมูลทุก RPC (private.is_master) เรียกไม่ได้ (ยังไม่ได้ apply migration) = ไม่ใช่ master
// ค่านี้อยู่ใน state.employee จึงหายไปเองเมื่อสลับเป็นบัญชีทดสอบ (persona) ในโหมดทดสอบ
async function loadMasterAccess() {
  const { data, error } = await sb.rpc("app_am_i_master");
  if (error) {
    console.warn("master access unavailable", error);
    return false;
  }
  return data === true;
}

// สิทธิ์เข้าโมดูล MNP LAB: ฐานข้อมูลเป็นผู้ตัดสิน (app_lab_access → private.can_access_lab) หน้าเว็บใช้แค่เลือกว่าจะแสดงเมนูหรือไม่
// ไม่ทำให้การล็อกอินล้มเมื่อเรียกไม่ได้ (เช่น ฐานข้อมูลยังไม่ได้ apply migration ของ MNP LAB) — ถือว่าไม่มีสิทธิ์ เมนูก็ไม่โผล่
// ค่านี้อยู่ใน state.employee จึงหายไปเองเมื่อสลับเป็นบัญชีทดสอบ (persona) ในโหมดทดสอบ
async function loadLabAccess() {
  const { data, error } = await sb.rpc("app_lab_access");
  if (error) {
    console.warn("lab access unavailable", error);
    return false;
  }
  return data === true;
}

// บทบาทหลักในการทำงานของบัญชี admin (employees.acting_role_id) — embed จาก employees ไม่ได้เพราะตั้งใจไม่มี foreign key ไป roles
// (ดู migration 20261003010000) ใช้แค่เลือกว่าจะแสดงฟอร์มหรือไม่ ฐานข้อมูลตัดสินสิทธิ์จริง เรียกไม่ได้ = ถือว่าไม่มี ไม่ทำให้การล็อกอินล้ม
// ค่านี้อยู่ใน state.employee จึงหายไปเองเมื่อสลับเป็นบัญชีทดสอบ (persona) ในโหมดทดสอบ
async function loadActingRole(roleId) {
  if (!roleId) return null;
  const { data, error } = await sb.from("roles").select("code,name_th").eq("id", roleId).maybeSingle();
  if (error) {
    console.warn("acting role unavailable", error);
    return null;
  }
  return data;
}

// บัญชีที่เห็นเฉพาะ MNP LAB: ฐานข้อมูลเป็นผู้ตัดสิน (app_lab_only) หน้าเว็บใช้แค่เลือกว่าจะแสดงอะไร
// ต่างจาก loadLabAccess ตรงที่ผิดพลาดแล้วล้มการโหลดบัญชี (ปล่อยหน้าเมนูเต็มให้บัญชีนี้ไม่ได้) ยกเว้นฐานข้อมูลที่ยังไม่มีฟังก์ชันนี้
// (ยังไม่ได้ apply migration) ซึ่งยังไม่มีบัญชีไหนถูกจำกัด จึงถือว่าไม่ใช่ lab-only
async function loadLabOnly() {
  const { data, error } = await sb.rpc("app_lab_only");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return false;
    throw error;
  }
  return data === true;
}

// โหมดทดสอบของ admin: ฐานข้อมูลให้ NCR ทำงานตามบัญชีทดสอบ (persona) ที่ admin เลือก
// หน้าเว็บจึงต้องใช้ persona เป็น "ผู้ใช้ปัจจุบัน" ด้วย ปุ่มและสิทธิ์ที่แสดงจะตรงกับที่ฐานข้อมูลยอมรับ
// ผู้ใช้ทั่วไปไม่ถูกเรียก RPC นี้ และถ้าฐานข้อมูลยังไม่มีฟังก์ชัน (ยังไม่ได้ db push) admin ยังใช้งานตามปกติ
async function applySandboxOverlay() {
  state.sandbox = null;
  if (state.employee?.role?.code !== "admin" || state.employee.labOnly) return;
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

// แผนกที่เห็นเฉพาะบางโมดูล: ตัดการแจ้งเตือนของโมดูลอื่นออก (กติกาใน modules/department-access.js)
// ต้องรู้ประเภทของใบที่การแจ้งเตือนอ้างถึง จึงอ่านใบเหล่านั้นก่อน ใบที่อ่านไม่ได้ถือว่าไม่อนุญาต
async function departmentVisibleNotifications(rows) {
  if (!isDeptRestricted() || !rows.length) return rows;
  const access = window.MNP_DEPARTMENT_ACCESS;
  const ids = access.notificationRequestIds(rows);
  const typeById = new Map();
  if (ids.length) {
    const { data, error } = await sb.from("requests").select("id,request_type:request_types(code)").in("id", ids);
    if (error) throw error;
    for (const row of data ?? []) typeById.set(row.id, relation(row.request_type)?.code ?? null);
  }
  return rows.filter((row) => access.notificationAllowed(deptAccessSubject(), row, (id) => typeById.get(id) ?? null));
}

async function loadUnread() {
  if (!state.employee || isLabOnly()) return 0;
  if (isDeptRestricted()) {
    // นับหลังกรอง ตัวเลขบนเมนูจึงตรงกับรายการที่หน้าการแจ้งเตือนแสดง
    try {
      const { data, error } = await sb.from("notifications").select("id,request_id,action_url,digest")
        .eq("recipient_id", state.employee.id).is("read_at", null).limit(200);
      if (error) throw error;
      state.unread = (await departmentVisibleNotifications(data ?? [])).length;
    } catch {
      state.unread = 0;
    }
    return state.unread;
  }
  const { count } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", state.employee.id)
    .is("read_at", null);
  state.unread = count ?? 0;
  return state.unread;
}

const NAV_ICONS = {
  dashboard: uiIcon("home"),
  requests: uiIcon("document"),
  new: `<span class="plus-icon" aria-hidden="true"></span>`,
  approvals: uiIcon("approve"),
  notifications: uiIcon("bell"),
  admin: uiIcon("settings"),
  profile: uiIcon("user"),
  signout: uiIcon("signout"),
};

function navLink(path, label, icon, active, { featured = false, badge = 0, href = `#/${path}` } = {}) {
  const isActive = active === path;
  const badgeText = badge > 99 ? "99+" : badge;
  return `<a class="nav-link${isActive ? " active" : ""}${featured ? " nav-create" : ""}" href="${escapeHtml(href)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${isActive ? ` aria-current="page"` : ""}>
    <span class="nav-icon-wrap${badge ? " has-unread" : ""}"><span class="nav-icon">${icon}</span>${badge ? `<span class="nav-count" aria-label="${badgeText} รายการใหม่">${badgeText}</span>` : ""}</span>
    <span class="nav-text">${escapeHtml(label)}</span>
  </a>`;
}

function shell(content, active, title, tabTitle = title) {
  const employee = state.employee;
  active = activeNavFor(active);
  // แถบบนเป็นลิงก์กลับรายการเมื่อหน้ามีลิงก์กลับ (แทนป้ายกลับเหนือหัวเรื่อง) หน้าอื่นไม่ทวนชื่อหน้าที่หัวเรื่องบอกแล้ว (ผู้ใช้เลือก 2026-11-12)
  // ลิงก์กลับตัวแรกที่อยู่ก่อนหัวเรื่อง (h1) ของหน้า แม้อยู่ในกรอบของหน้า เช่น แดชบอร์ดและรายการของโมดูล
  content = String(content);
  const backMatch = content.match(/<a class="request-back-link"[^>]*>[^<]*<\/a>/);
  const headingAt = content.search(/<h1[\s>]/);
  const lift = backMatch && (headingAt < 0 || backMatch.index < headingAt);
  const topbarBack = lift ? backMatch[0] : "";
  if (lift) content = content.slice(0, backMatch.index) + content.slice(backMatch.index + backMatch[0].length);
  // ชื่อแท็บบอกหน้าที่เปิดอยู่ (โปรแกรมอ่านจอและรายการแท็บ/ประวัติของเบราว์เซอร์ใช้ชื่อนี้)
  document.title = `${tabTitle} · MNP Workspace`;
  return `
    <div class="app-shell">
      <button class="skip-link" type="button" data-skip-link>ข้ามไปเนื้อหาหลัก</button>
      <button class="mobile-nav-toggle" type="button" aria-label="เปิดเมนูหลัก" aria-controls="mobile-nav" aria-expanded="false">
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        <svg class="close-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        ${state.unread && !isSandboxMode() && !isLabOnly() ? `<span class="nav-toggle-dot" aria-hidden="true"></span>` : ""}
      </button>
      <aside class="sidebar" id="mobile-nav">
        <a class="brand" href="#/${homePath()}"><img class="brand-mark" src="./icons/icon-192.png" alt=""><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></a>
        <nav class="nav" aria-label="เมนูหลัก">
          <div class="nav-label">เมนูหลัก</div>
          ${isSandboxMode() || isLabOnly() ? "" : `${navLink("dashboard", "หน้าหลัก", NAV_ICONS.dashboard, active)}
          ${navLink("requests", "คำร้อง", NAV_ICONS.requests, active, { href: window.MNP_REQUEST_CENTER.overviewUrl() })}`}
          ${requestModuleNavLinks(active)}
          ${isSandboxMode() || isLabOnly() ? "" : navLink("notifications", "การแจ้งเตือน", NAV_ICONS.notifications, active, { badge: state.unread })}
          <div class="nav-divider"></div>
          ${employee.role?.code === "admin" && !isLabOnly() && !isDeptRestricted() ? navLink("admin", "ผู้ดูแลระบบ", NAV_ICONS.admin, active) : ""}
          ${navLink("profile", "ข้อมูลส่วนตัว", NAV_ICONS.profile, active)}
          <button class="nav-link nav-signout signout-button" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <span class="nav-icon-wrap"><span class="nav-icon">${NAV_ICONS.signout}</span></span>
            <span class="nav-text">ออกจากระบบ</span>
          </button>
        </nav>
        <div class="nav-spacer"></div>
        <div class="sidebar-user">
          <div class="avatar">${escapeHtml(initials(employee))}</div>
          <div class="user-copy"><strong title="${escapeHtml(`${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim())}">${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</strong><span title="${escapeHtml(employee.job_title ?? employee.role?.name_th ?? "พนักงานทั่วไป")}">${escapeHtml(employee.job_title ?? employee.role?.name_th ?? "พนักงานทั่วไป")}</span></div>
          <button class="icon-button signout-button" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ">${uiIcon("signout")}</button>
        </div>
      </aside>
      <button class="nav-backdrop" type="button" tabindex="-1" aria-label="ปิดเมนูหลัก"></button>
      <main class="main">
        <header class="topbar">
          <div class="topbar-start">
            ${appNavButtons()}${topbarBack}
          </div>
          <div class="top-actions">
            ${isSandboxMode() ? `<span class="sandbox-pill" title="อยู่ในโหมดทดสอบ ข้อมูลแยกจากระบบจริง">TEST</span>` : ""}
            ${helpButton()}${themeButton()}
          </div>
        </header>
        <div class="content" id="main-content" tabindex="-1">${sandboxBannerHtml()}${content}</div>
      </main>
    </div>`;
}

// แถบโหมดทดสอบ: แสดงทุกหน้าเมื่อ admin อยู่ในโหมดทดสอบ สลับบัญชีทดสอบ/ล้างข้อมูล/ออกได้จากที่นี่
function sandboxBannerHtml() {
  if (!isSandboxMode()) return "";
  const personas = state.sandbox?.personas ?? [];
  const current = state.employee.id;
  // RubberFlow/BOM รีเซ็ตข้อมูลด้วยเครื่องมือของตัวเอง ปุ่มล้างข้อมูล NCR ทดสอบจึงไม่ขึ้นที่นั่น (มือถือเหลือแถบสั้น)
  const showPurge = !["rubberflow", "bom"].includes(currentRoute().path);
  return `<div class="sandbox-banner" role="status">
    <div class="sandbox-banner-copy"><strong>โหมดทดสอบ</strong><span>ข้อมูลแยกจากระบบจริง ไม่ส่งแจ้งเตือนหรืออีเมลถึงใคร · ทดลอง NCR (แนบไฟล์ได้) และใบตรวจ QC ได้</span></div>
    <div class="sandbox-banner-actions">
      <label for="sandbox-persona">ทำหน้าที่เป็น</label>
      <select class="input" id="sandbox-persona">${personas.map((persona) => `<option value="${escapeHtml(persona.id)}"${persona.id === current ? " selected" : ""}>${escapeHtml(persona.job_title ?? `${persona.first_name} ${persona.last_name}`)} · ${escapeHtml(persona.department?.code ?? "")}</option>`).join("")}</select>
      ${showPurge ? '<button class="btn danger small" type="button" id="sandbox-purge">ล้างข้อมูล NCR ทดสอบ</button>' : ""}
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
    const exitButton = event.currentTarget;
    exitButton.disabled = true;
    try {
      await exitSandbox();
    } catch (error) {
      exitButton.disabled = false;
      showToast(friendlyError(error), "error");
    }
  });
  document.querySelector("#sandbox-purge")?.addEventListener("click", async (event) => {
    const purgeButton = event.currentTarget;
    if (!(await confirmDialog({ title: "ล้างใบ NCR ทดสอบและไฟล์แนบทั้งหมด และเริ่มนับเลข TEST- ใหม่?", message: "ล้างเฉพาะข้อมูลทดสอบ ข้อมูลจริงไม่ถูกแตะ", confirmLabel: "ล้างข้อมูลทดสอบ", danger: true }))) return;
    purgeButton.disabled = true;
    try {
      const data = await window.MNP_NCR_ATTACHMENTS.purge();
      showToast(`ล้างข้อมูลทดสอบแล้ว ${data?.deleted ?? 0} ใบ`);
      if (location.hash === "#/ncr") await renderRoute();
      else go("ncr");
    } catch (error) {
      purgeButton.disabled = false;
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
  document.querySelector(".help-toggle")?.addEventListener("click", openShortcutHelp);
  document.querySelector(".app-back")?.addEventListener("click", () => window.MNP_INSTALL_APP.backOrHome({ win: window, goHome: () => go(homePath()) }));
  document.querySelector(".app-forward")?.addEventListener("click", () => history.forward());
  // ปุ่มออกจากระบบมี 2 จุด: ท้ายแถบข้าง (จอกว้าง) และในเมนูหลัก (จอแคบ/มือถือ ซึ่งซ่อนแถบผู้ใช้)
  document.querySelectorAll(".signout-button").forEach((button) => button.addEventListener("click", async () => {
    setMobileNav(false);
    await releasePushBeforeSignOut();
    window.MNP_FORM_DRAFT?.clearAll();
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

// แถวโครงร่างระหว่างโหลด ผู้ใช้โปรแกรมอ่านหน้าจอยังได้ยิน "กำลังโหลดข้อมูล" ผ่าน role=status ของตัวเอง
const loadingSkeleton = (rows = 4) => `<div class="skeleton" role="status">${'<span class="skeleton-row" aria-hidden="true"></span>'.repeat(rows)}<span class="sr-only">กำลังโหลดข้อมูล…</span></div>`;

// หน้าว่าง: ไอคอน + ข้อความ + คำแนะนำสั้นๆ และปุ่มทำต่อ (ถ้ามี)
const emptyState = (text, { hint = "", action = null } = {}) => `<div class="empty empty-state">${uiIcon("inbox")}<p>${escapeHtml(text)}</p>${hint ? `<small>${escapeHtml(hint)}</small>` : ""}${action ? `<a class="btn secondary small" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>` : ""}</div>`;
const EMPTY_REQUESTS = { hint: "คำร้องที่ตรงกับตัวกรองนี้จะแสดงที่นี่", action: { href: "#/new", label: "สร้างคำร้อง" } };
// รายการว่างเพราะคำค้นหรือตัวกรอง: บอก "ไม่พบ" พร้อมล้างตัวกรอง ไม่ชวนสร้างคำร้อง (ผู้ใช้จะเข้าใจว่ายังไม่มีแล้วสร้างซ้ำ)
// เหมือน RubberFlow ที่แยก "ยังไม่มี" กับ "ไม่พบ" · ไม่มีตัวกรองก็เป็นหน้าว่างเดิม
function listEmptyOf(params, filtered) {
  return filtered && params
    ? { text: "ไม่พบคำร้องที่ตรงกับคำค้นหรือตัวกรองนี้", hint: "ลองคำค้นอื่น หรือล้างตัวกรองเพื่อดูทุกใบ", action: { href: requestCenterUrl(params, { q: null, status: null, dept: null }), label: "ล้างตัวกรอง" } }
    : { text: "ยังไม่มีรายการในขณะนี้", ...EMPTY_REQUESTS };
}

function loadingShell(active, title) {
  app.innerHTML = shell(loadingSkeleton(), active, title);
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
    if (!deptModuleAllowed(request.request_type?.code)) return false;
    // เฉพาะ admin จริงเท่านั้นที่ข้ามได้ ต้องตรงกับ app_approval_decision เป๊ะ — เดิมรวม
    // factory_manager/general_manager ด้วย ทำให้เห็นปุ่มอนุมัติของขั้นที่ไม่ใช่ของตัวเอง
    // admin ที่เลือก "บทบาทที่ทำหน้าที่" ไว้ เห็นเฉพาะขั้นของบทบาทนั้น (ยังเปิดใบอื่นอนุมัติได้ตามสิทธิ์ admin)
    // ยกเว้นบัญชี master (เป็น admin เสมอ): เห็นขั้นอนุมัติทั้งบริษัทแม้เลือกบทบาทไว้ — ผู้ใช้เลือกเอง 2026-11-09
    // งานช่างและ NCR ยังเป็นของผู้รับผิดชอบตามเดิม การอนุมัติแทนทำทีละใบ (isOwnApprovalStep กันการเลือกทั้งหมด)
    if (employee.role?.code === "admin" && (!employee.acting_role_id || employee.isMaster === true)) return true;
    if (step.approver_employee_id && step.approver_employee_id === employee.id) return true;
    const roleMatches = window.MNP_REQUEST_APPROVAL.roleMatches(step, request.request_type?.code, employee);
    return roleMatches && Boolean(request.request_type?.code) && employee.approvalModules.has(request.request_type.code);
  });
}

const MY_REPAIR_ACTION_STATUSES = ["pending_assign", "assigned", "in_progress", "pending_verify"];
// สิ่งที่ "ฉัน" ต้องทำกับใบนั้น (คำกริยา) — คนละเรื่องกับชื่อสถานะของใบ (statusLabels) จึงไม่ใช้คำ "รอ…" ซ้ำกับสถานะ
const myRepairActionLabels = {
  pending_assign: "มอบหมายช่าง",
  // คำเดียวกับปุ่มในหน้าใบ (เริ่มงาน / เสร็จสิ้นงาน / ตรวจรับงาน)
  assigned: "เริ่มงาน",
  in_progress: "เสร็จสิ้นงาน",
  pending_verify: "ตรวจรับงาน",
};

// งานซ่อมที่ต้องลงมือทำเอง (มอบหมายช่าง/เริ่มงาน/เสร็จสิ้นงาน/ตรวจรับงาน) ไม่มี approval_steps รองรับ
// เพราะผ่านขั้นอนุมัติไปแล้ว — getPendingApprovals เดิมนับแต่ approval_steps จึงมองไม่เห็นงานกลุ่มนี้เลย
// ทำให้ช่างที่ถูกมอบหมายงานแล้ว หรือหัวหน้าแผนกที่ต้องมอบหมายช่าง ไม่เห็นงานของตัวเองใน "งานที่ต้องจัดการ"
async function getMyRepairActionItems() {
  const employee = state.employee;
  const { data, error } = await sb
    .from("requests")
    .select("id,request_no,title,status,priority,created_at,requester_id,assignee_id,request_type:request_types(name_th,code,uses_repair_workflow,owning_department_id),request_technicians(technician_id)")
    .in("status", MY_REPAIR_ACTION_STATUSES)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((item) => ({ ...item, request_type: relation(item.request_type) }))
    .filter((request) => {
      if (!deptModuleAllowed(request.request_type?.code)) return false;
      if (request.status === "pending_assign") {
        return DEPT_MANAGER_ROLE_CODES.includes(employee.role?.code) && employee.department_id === request.request_type?.owning_department_id;
      }
      if (request.status === "pending_verify") return request.requester_id === employee.id;
      // assigned, in_progress — ช่างทุกคนในชุดต้องเห็นงานของตัวเอง ไม่ใช่เฉพาะคนแรก
      return request.assignee_id === employee.id
        || (request.request_technicians ?? []).some((row) => row.technician_id === employee.id);
    });
}

// ---- หน้าหลัก = คิวเดียว ตัดสินได้ในที่ (brief .impeccable/surfaces/src-app-app-page-tsx.md) ----
// ใบที่รอผู้ใช้อนุมัติ + งานซ่อมที่ต้องลงมือ อยู่ในรายการเดียว เรียงด่วนก่อนและรอนานก่อน
// แตะใบอนุมัติ = ขยายพร้อมแถบตัดสินใจชุดเดียวกับหน้ารายละเอียด (จอกว้าง: แสดงทางขวา)
const homeQueueState = { selectedId: null, collapsed: false, ctx: null };
const HOME_QUEUE_PAGE = 20;
const HOME_OPEN_STATUSES = ["pending_approval", "more_info", "approved", "in_progress", "pending_assign", "assigned", "pending_verify"];
const isWideLayout = () => window.matchMedia("(min-width: 1041px)").matches;

function hasApprovalDuty(employee) {
  return employee.role?.code === "admin" || DEPT_MANAGER_ROLE_CODES.includes(employee.role?.code) || (employee.approvalModules?.size ?? 0) > 0;
}

// คิว "ต้องจัดการ" ของหน้าหลัก: อนุมัติ + งานซ่อม + งาน NCR เรียงด้วยกติกาเดียว
// แผงงานถัดไปหลังตัดสิน (fillNextItemPanel) นับจากชุดเดียวกัน ตัวเลขสองที่จึงตรงกัน
function ncrHref(ncr) {
  return `#/ncr?id=${encodeURIComponent(ncr.id)}`;
}
function homeQueueItems(pending, repairTasks, ncrTasks) {
  return window.MNP_HOME_QUEUE.sortQueue([
    ...pending.map((step) => ({ kind: "approval", id: step.request.id, step, request: step.request, priority: step.request.priority, createdAt: step.request.submitted_at ?? step.request.created_at })),
    ...repairTasks.map((task) => ({ kind: "repair", id: task.id, request: task, priority: task.priority, createdAt: task.created_at })),
    // เลยกำหนดตอบนับเป็นงานด่วนสูง · ค้างกี่วันนับจากรายการล่าสุดในประวัติของใบ (step_since จาก module-ncr.js loadHomeItems) เหมือนแดชบอร์ด NCR
    ...ncrTasks.map(({ ncr, task, overdue }) => ({
      kind: "ncr", id: ncr.id, href: ncrHref(ncr), task, flag: overdue ? "เลยกำหนดตอบ" : null,
      // ชื่อเดียวกับ request_types.name_th ของ NCR_CAR และเมนูของโมดูล
      request: { request_no: ncr.ncr_no, title: ncr.product_name, request_type: { code: "NCR_CAR", name_th: "NCR/CAR" } },
      priority: overdue ? "high" : null, createdAt: ncr.step_since ?? ncr.updated_at ?? ncr.created_at,
    })),
  ]);
}
// งานของคิวที่ลงมือในหน้าของใบเอง (งานซ่อม ขั้นของ NCR) ใช้คำของงาน เช่น "มอบหมายช่าง"
// แถวอนุมัติใช้คำกริยาของขั้น (อนุมัติ / รับทราบ) คำเดียวกับปุ่มในแถบตัดสินใจ
function queueTaskLabel(item) {
  if (item.kind === "approval") {
    const extra = requestModule(relation(item.request.request_type)?.code)?.extraDecisions ?? [];
    return window.MNP_STEP_VERB.verbOf(item.step?.step_name, extra.map((decision) => decision.label));
  }
  return item.task ?? myRepairActionLabels[item.request.status] ?? statusLabels[item.request.status] ?? item.request.status;
}
// รหัสในชื่อเรื่อง (HS-08, DR-15/2) ไม่ตัดกลางรหัสเมื่อขึ้นบรรทัดใหม่ · รับข้อความที่ escape แล้ว (entity ไม่มีขีด/ทับ จึงไม่ถูกจับ)
// รหัสยาวเกิน 16 ตัวอักษรตัดบรรทัดได้ตามปกติ (ไม่ให้ยาวเกินคอลัมน์แล้วหายใต้ overflow ของชื่อเรื่อง)
function keepCodesTogether(escaped) {
  return String(escaped).replace(/[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+/g, (code) => (code.length <= 16 ? `<span class="nowrap">${code}</span>` : code));
}
// งาน NCR บนหน้าหลัก: เฉพาะเมื่อโมดูลเปิดและแผนกของผู้ใช้เห็นโมดูลนี้ (แผนก ID ไม่เห็น)
function ncrHomeModule() {
  const entry = requestModule("NCR_CAR");
  return entry?.enabled && deptModuleAllowed(entry.code) ? entry.home ?? null : null;
}
async function loadHomeQueueItems() {
  const ncrHome = ncrHomeModule();
  const [pending, repairTasks, ncrItems] = await Promise.all([
    getPendingApprovals(),
    getMyRepairActionItems(),
    ncrHome ? ncrHome.load(state.employee).catch(() => ({ tasks: [] })) : { tasks: [] },
  ]);
  return homeQueueItems(pending, repairTasks, ncrItems.tasks);
}

async function renderDashboard(params = new URLSearchParams()) {
  activeDecisionCountdown?.flush();
  activeBulkCountdown?.flush();
  loadingShell("dashboard", "หน้าหลัก");
  const employee = state.employee;
  const rules = window.MNP_HOME_QUEUE;
  // NCR อยู่ในตาราง ncr_reports แยกจากคำร้อง โมดูลจึงดึงงานของตัวเอง (modules/module-ncr.js home)
  const ncrHome = ncrHomeModule();
  const [pending, repairTasks, directory, mineResult, ncrItems] = await Promise.all([
    getPendingApprovals(),
    getMyRepairActionItems(),
    loadEmployeeDirectory(),
    sb.from("requests")
      .select("id,request_no,title,status,created_at,request_type:request_types(name_th,code,uses_repair_workflow)")
      .eq("requester_id", employee.id)
      .in("status", HOME_OPEN_STATUSES)
      .order("created_at", { ascending: false })
      .limit(HOME_QUEUE_PAGE),
    // ดึง NCR ไม่ได้ก็ยังแสดงคิวส่วนอื่น (อนุมัติ งานซ่อม ใบของฉัน) และบอกผู้ใช้ว่างาน NCR ขาดไป
    ncrHome ? ncrHome.load(employee).catch(() => { showToast("โหลดงาน NCR ไม่สำเร็จ งาน NCR ไม่ได้แสดงในหน้านี้ ลองโหลดหน้าใหม่", "error"); return { tasks: [], mine: [] }; }) : { tasks: [], mine: [] },
  ]);
  if (mineResult.error) throw mineResult.error;
  const items = homeQueueItems(pending, repairTasks, ncrItems.tasks);
  const approvalIds = items.filter((item) => item.kind === "approval").map((item) => item.id);
  // ใบที่เปิด: ใบที่ลิงก์ขอมา > ใบที่เปิดค้างไว้ > ใบแรก (หลังตัดสินใบหนึ่ง ใบถัดไปจึงเปิดเอง)
  // จอแคบที่ผู้ใช้ยุบเองไว้ไม่เปิดใหม่จนกว่าจะแตะ
  const requested = params.get("request");
  const selectedId = requested
    ? rules.pickSelection(approvalIds, { requested })
    : homeQueueState.collapsed && !isWideLayout() ? null : rules.pickSelection(approvalIds, { current: homeQueueState.selectedId });
  // ใบเสร็จของมติที่เพิ่งกดในแท็บนี้ (ใบนั้นหลุดจากคิวแล้ว)
  const recent = [...recentDecisions.keys()]
    .map((id) => ({ id, entry: recentDecisionFor(id) }))
    .filter(({ id, entry }) => entry && !approvalIds.includes(id))
    .sort((a, b) => b.entry.at - a.entry.at);
  // ใบถึงฝ่ายบริหารจบที่มติ: อนุมัติแล้วถือว่าจบ ไม่ใช่ "ยังไม่จบ"
  // ใบที่อยู่ในคิว "ต้องจัดการ" แล้ว (เช่นรอผู้แจ้งตรวจรับ) ไม่แสดงซ้ำ
  const queuedIds = new Set(items.map((item) => item.id));
  const mine = (mineResult.data ?? [])
    .map((row) => ({ ...row, request_type: relation(row.request_type) }))
    .filter((row) => deptModuleAllowed(row.request_type?.code) && !queuedIds.has(row.id) && !(requestModule(row.request_type?.code)?.endsAtDecision && row.status === "approved"))
    .map((row) => ({ at: row.created_at, html: `<li><a class="home-mine-row" href="#/request?id=${encodeURIComponent(row.id)}"><span class="home-mine-head"><span class="queue-item-icon" data-module="${requestPalette(row.request_type?.code)}" aria-hidden="true">${requestTypeIcon(row.request_type?.code)}</span><span class="request-no">${escapeHtml(row.request_no)}</span></span><strong>${escapeHtml(row.title)}</strong>${progressTracker(row.status, Boolean(row.request_type?.uses_repair_workflow), { typeCode: row.request_type?.code })}</a></li>` }))
    // NCR ที่ฉันออกและยังไม่ปิด (ใบที่ถึงขั้นของฉันอยู่ในคิว "ต้องจัดการ" แล้ว) เรียงรวมกับคำร้อง ใบใหม่ก่อน
    .concat(ncrItems.mine.map((ncr) => ({ at: ncr.created_at, html: `<li><a class="home-mine-row" href="${escapeHtml(ncrHref(ncr))}"><span class="home-mine-head"><span class="queue-item-icon" data-module="ncr" aria-hidden="true">${requestTypeIcon("NCR_CAR")}</span><span class="request-no">${escapeHtml(ncr.ncr_no)}</span></span><strong>${escapeHtml(ncr.product_name)}</strong>${progressTracker(ncr.status, false, { stages: ncrHome.PROGRESS_STAGES, label: ncrHome.statusLabel(ncr) })}</a></li>` })))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, HOME_QUEUE_PAGE);
  const showQueue = items.length > 0 || recent.length > 0 || hasApprovalDuty(employee);
  // ใบที่เปิดอยู่ต้องมองเห็นเสมอ แม้อยู่เกินหน้าแรก (เช่นเปิดจากลิงก์ในอีเมล)
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const visibleCount = Math.max(HOME_QUEUE_PAGE, selectedIndex + 1);
  const ownSelectable = items.filter((item) => item.kind === "approval" && isOwnApprovalStep(item.step));
  const queueSection = showQueue ? `
    <section class="home-queue" id="home-queue" aria-labelledby="home-queue-title">
      <div class="home-section-head">
        <h2 id="home-queue-title">ต้องจัดการ${items.length ? ` <span class="detail-section-count">${items.length}</span>` : ""}</h2>
        ${ownSelectable.length > 1 ? `<label class="queue-select-all"><input type="checkbox" id="queue-select-all"> เลือกใบที่อนุมัติได้ทั้งหมด (${ownSelectable.length})</label>` : ""}
      </div>
      ${recent.length ? `<ul class="queue-done" aria-label="เพิ่งตัดสิน">${recent.map(({ id, entry }) => `<li><a href="#/request?id=${encodeURIComponent(id)}"><span class="queue-done-mark decision-${escapeHtml(entry.decision)}" aria-hidden="true">${uiIcon(entry.decision === "rejected" ? "close" : "check")}</span><span>${escapeHtml(entry.label ?? decisionVerbs[entry.decision] ?? "บันทึกผล")}แล้ว · <span class="request-no">${escapeHtml(entry.requestNo ?? "")}</span> ${escapeHtml(entry.title ?? "")}</span><time datetime="${new Date(entry.at).toISOString()}">${formatTimeOnly(entry.at)}</time></a></li>`).join("")}</ul>` : ""}
      ${items.length ? `<div class="queue-layout${approvalIds.length ? "" : " is-tasks-only"}">
        <ul class="queue-list" role="list"${approvalIds.length ? ` title="คีย์ลัด: J/K เลื่อนรายการ · A อนุมัติ · R ไม่อนุมัติ · ? ดูทั้งหมด" aria-keyshortcuts="J K A R ?"` : ` title="คีย์ลัด: J/K เลื่อนรายการ · ? ดูทั้งหมด" aria-keyshortcuts="J K ?"`}>${items.map((item, index) => homeQueueItemHtml(item, { selected: item.id === selectedId, directory, hidden: index >= visibleCount })).join("")}</ul>
        <div class="queue-detail-pane" id="queue-detail-pane"></div>
      </div>
      ${items.length > visibleCount ? `<button type="button" class="link-button queue-more" id="queue-more">แสดงอีก ${items.length - visibleCount} รายการ</button>` : ""}
      <section class="card action-panel queue-bulk" id="queue-bulk" aria-label="อนุมัติหลายรายการ" hidden>
        <p class="queue-bulk-text" id="queue-bulk-text" role="status" hidden></p>
        <div class="action-panel-buttons" id="queue-bulk-buttons">${QUEUE_BULK_IDLE_BUTTONS}</div>
      </section>` : `<p class="queue-empty">ไม่มีงานค้าง งานที่ส่งมาถึงคุณจะแสดงที่นี่</p>`}
    </section>` : "";
  const mineSection = `
    <section class="home-mine" aria-labelledby="home-mine-title">
      <div class="home-section-head"><h2 id="home-mine-title">ใบของฉันที่ยังไม่จบ${mine.length ? ` <span class="detail-section-count">${mine.length}</span>` : ""}</h2><a class="link-button" href="${escapeHtml(window.MNP_REQUEST_CENTER.overviewUrl())}">ดูคำร้องทั้งหมด</a></div>
      ${mine.length ? `<ul class="home-mine-list" role="list">${mine.map((row) => row.html).join("")}</ul>` : `<p class="muted">ไม่มีใบที่คุณแจ้งค้างอยู่</p>`}
    </section>`;
  const nothingAtAll = !showQueue && !mine.length;
  const content = `
    <div class="page-heading home-heading"><div><h1>งานของคุณวันนี้</h1><p>${formatDate(new Date(), false)}</p></div><a class="btn home-create${items.length ? "" : " is-wide"}" href="#/new"><span class="plus-icon" aria-hidden="true"></span> สร้างคำร้อง</a></div>
    ${nothingAtAll ? emptyState("ยังไม่มีคำร้อง", { hint: "แจ้งซ่อม แจ้ง NCR หรือส่งคำร้องถึงฝ่ายบริหารได้จากปุ่มสร้างคำร้อง", action: { href: "#/new", label: "สร้างคำร้องแรก" } }) : items.length ? `${queueSection}${mineSection}` : `${mineSection}${queueSection}`}`;
  app.innerHTML = shell(content, "dashboard", "หน้าหลัก");
  bindShell();
  homeQueueState.ctx = { items, directory, employee };
  homeQueueState.selectedId = selectedId;
  if (selectedId) homeQueueState.collapsed = false;
  bindHomeQueue();
  if (selectedId) await selectQueueItem(selectedId);
}

function formatTimeOnly(value) {
  return new Intl.DateTimeFormat("th-TH", { timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

function homeQueueItemHtml(item, { selected, directory, hidden }) {
  const request = item.request;
  const type = relation(request.request_type);
  const rules = window.MNP_HOME_QUEUE;
  // NCR ไม่มีระดับความเร่งด่วน ส่งป้ายของตัวเองมา (เลยกำหนดตอบ)
  const flag = item.flag ?? (["high", "urgent"].includes(request.priority) ? priorityLabel(request.priority, isRepairType(type)) : null);
  // ประเภทบอกด้วยสีและไอคอนของแถวกับคำนำหน้าเลขที่แล้ว ชื่อเต็มอยู่ใน title ของไอคอนและข้อความสำหรับผู้อ่านหน้าจอ · อายุงานอยู่ข้างชิปงาน
  const meta = item.kind === "approval" ? `โดย ${personName(directory, request.requester_id)}` : "";
  const age = rules.waitingLabel(rules.waitingDays(item.createdAt));
  // ทุกแถวบอกว่าต้องทำอะไร: ชิปสีโมดูลของใบท้ายบรรทัดเลขที่ (ไม่เบียดชื่อเรื่อง) · งานที่ลงมือในหน้าของใบเองมีลูกศร (พาไปหน้านั้น)
  // แถวอนุมัติเปิดในคิวจึงไม่มีลูกศร
  const chip = `<span class="queue-item-task${item.kind === "approval" ? " is-decide" : ""}" data-module="${requestPalette(type?.code)}">${escapeHtml(queueTaskLabel(item))}</span>`;
  const head = `<span class="queue-item-icon" data-module="${requestPalette(type?.code)}" title="${escapeHtml(type?.name_th ?? "")}" aria-hidden="true">${requestTypeIcon(type?.code)}</span>
    <span class="queue-item-copy">
      <span class="queue-item-top"><span class="request-no">${escapeHtml(request.request_no)}</span>${type?.name_th ? `<span class="sr-only">${escapeHtml(type.name_th)}</span>` : ""}${flag ? `<span class="badge urgent-flag">${escapeHtml(flag)}</span>` : ""}<span class="queue-item-due">${chip}<span class="queue-item-age">${escapeHtml(age)}</span></span></span>
      <strong class="queue-item-title">${keepCodesTogether(escapeHtml(request.title))}</strong>
      ${meta ? `<span class="queue-item-meta">${escapeHtml(meta)}</span>` : ""}
    </span>`;
  const hiddenAttr = hidden ? " hidden" : "";
  // งานที่ต้องลงมือในหน้าของใบเอง (งานซ่อม, ขั้นของ NCR): แถวเป็นลิงก์ไปหน้านั้น ไม่มีแถบตัดสินใจในคิว
  if (item.kind === "repair" || item.kind === "ncr") {
    return `<li class="queue-item is-task"${hiddenAttr}><a class="queue-item-main" href="${escapeHtml(item.href ?? `#/request?id=${encodeURIComponent(item.id)}`)}">${head}</a></li>`;
  }
  const check = isOwnApprovalStep(item.step)
    ? `<label class="queue-item-check"><input type="checkbox" class="queue-select" value="${escapeHtml(item.step.id)}" aria-label="เลือก ${escapeHtml(request.request_no)} เพื่ออนุมัติหลายรายการ"></label>`
    : "";
  return `<li class="queue-item${selected ? " is-selected" : ""}" data-request-id="${escapeHtml(item.id)}"${hiddenAttr}>${check}<button type="button" class="queue-item-main" aria-expanded="${selected}">${head}</button><div class="queue-item-slot"></div></li>`;
}

// แถวในรายการแสดงเลขที่ ประเภท ผู้แจ้ง และค้างกี่วันอยู่แล้ว จึงไม่ซ้ำในส่วนที่เปิด
// compact (ขยายใต้แถวบนจอแคบ): ไม่มีหัวเรื่องซ้ำกับแถว; จอกว้าง: หัวเรื่องเป็นหัวของแผงขวา (เลขแบบฟอร์มมีเฉพาะที่นี่)
function homeQueueDetailHtml(item, nextStep, { compact = false, nextStepKnown = true } = {}) {
  const request = item.request;
  const type = relation(request.request_type);
  const formCode = REQUEST_FORM_CODES[type?.code] ?? "";
  const description = (request.description ?? "").trim();
  return `<article class="queue-detail${compact ? " is-compact" : ""}" id="queue-detail" aria-label="${escapeHtml(`${request.request_no} ${request.title}`)}">
    ${compact ? "" : `${formCode ? `<span class="eyebrow">${escapeHtml(formCode)}</span>` : ""}
    <h3 class="queue-detail-title" id="queue-detail-title" tabindex="-1">${escapeHtml(request.title)}</h3>`}
    ${description ? `<p class="request-summary-text queue-detail-text">${escapeHtml(description)}</p>` : `<p class="request-summary-text is-empty">ไม่ได้ระบุรายละเอียด</p>`}
    <a class="link-button" href="#/request?id=${encodeURIComponent(item.id)}">เปิดใบเต็ม: ไฟล์แนบ และประวัติเอกสาร</a>
    ${decisionPanelHtml({ request, currentStep: item.step, nextStep, nextStepKnown, extraDecisions: requestModule(type?.code)?.extraDecisions ?? [] })}
  </article>`;
}

// เปิดใบในคิว: จอกว้างแสดงทางขวา จอแคบขยายใต้ใบนั้น; ใบเดียวที่มีแถบตัดสินใจในเวลาหนึ่ง
async function selectQueueItem(id, { focus = false } = {}) {
  const ctx = homeQueueState.ctx;
  const item = ctx?.items.find((entry) => entry.kind === "approval" && entry.id === id);
  if (!item) return;
  homeQueueState.selectedId = id;
  homeQueueState.collapsed = false;
  // มติที่นับถอยหลังอยู่ของใบเดิม (หรือของอนุมัติหลายรายการ) ส่งก่อน แล้วค่อยเปิดใบใหม่
  activeDecisionCountdown?.flush();
  activeBulkCountdown?.flush();
  document.querySelectorAll(".queue-item").forEach((node) => {
    const isSelected = node.dataset.requestId === id;
    node.classList.toggle("is-selected", isSelected);
    node.querySelector(".queue-item-main[aria-expanded]")?.setAttribute("aria-expanded", String(isSelected));
    node.querySelector(".queue-item-slot")?.replaceChildren();
  });
  const pane = document.querySelector("#queue-detail-pane");
  pane?.replaceChildren();
  const li = document.querySelector(`.queue-item[data-request-id="${CSS.escape(id)}"]`);
  const host = isWideLayout() ? pane : li?.querySelector(".queue-item-slot");
  if (!host) return;
  host.innerHTML = loadingSkeleton(2);
  let nextStep = null;
  const { data: steps, error } = await sb.from("approval_steps").select("id,step_order,step_name,status").eq("request_id", id).order("step_order");
  if (homeQueueState.selectedId !== id || !host.isConnected) return;
  if (!error) nextStep = (steps ?? []).find((step) => step.step_order === item.step.step_order + 1) ?? null;
  host.innerHTML = homeQueueDetailHtml(item, nextStep, { compact: host !== pane, nextStepKnown: !error });
  bindDecisionPanel({
    id,
    params: new URLSearchParams({ id }),
    request: item.request,
    currentStep: item.step,
    nextStep,
    employee: ctx.employee,
    extraDecisions: requestModule(relation(item.request.request_type)?.code)?.extraDecisions ?? [],
    requesterName: personName(ctx.directory, item.request.requester_id),
    onDecided: ({ decision, label }) => afterQueueDecision(id, decision, label),
  });
  watchDecisionPanelBusy();
  syncQueueBulk();
  trackActionBarHeight();
  if (host !== pane) watchQueuePanelPlacement(li);
  // จอกว้างย้าย focus ไปหัวเรื่องทางขวา; จอแคบ focus อยู่ที่แถวที่แตะ (แถวคือหัวเรื่องของส่วนที่ขยาย)
  if (focus && host === pane) host.querySelector(".queue-detail-title")?.focus();
}

// จอแคบ: แถบตัดสินใจลอยติดล่างจอ แต่ใบที่ขยายอาจเลื่อนพ้นจอไปแล้ว (เลื่อนดูใบอื่นอยู่)
// ตอนว่าง (idle) ซ่อนแถบเมื่อใบนั้นไม่อยู่ในจอ ผู้อนุมัติจะได้ไม่กดมติให้ใบที่มองไม่เห็นโดยคิดว่าเป็นใบตรงหน้า
// ระหว่างพิมพ์เหตุผล/นับถอยหลัง/ส่ง แถบอยู่ตลอด (ต้องกดเลิกทำได้เสมอ)
let queuePanelObserver = null;
function watchQueuePanelPlacement(li) {
  queuePanelObserver?.disconnect();
  queuePanelObserver = null;
  const panel = li?.querySelector("#decision-panel");
  if (!panel || typeof IntersectionObserver !== "function") return;
  let inView = true;
  const sync = () => panel.classList.toggle("is-away", !inView && panel.dataset.state === "idle");
  const io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
  io.observe(li);
  const states = new MutationObserver(sync);
  states.observe(panel, { attributes: true, attributeFilter: ["data-state"] });
  queuePanelObserver = { disconnect: () => { io.disconnect(); states.disconnect(); } };
}

// ระหว่างที่แถบตัดสินใจกำลังยืนยัน/นับถอยหลัง/ส่ง ห้ามติ๊กอนุมัติหลายรายการ
// (แถบหลายรายการจะซ่อนแถบนี้ ปุ่มเลิกทำจะหายทั้งที่มติยังจะถูกส่ง)
function watchDecisionPanelBusy() {
  const panel = document.querySelector("#decision-panel");
  if (!panel) return;
  const sync = () => {
    // อนุมัติหลายรายการกำลังยืนยัน/นับถอยหลัง/ส่ง: bindQueueBulk ล็อกช่องติ๊กไว้ ห้ามปลดล็อกจากที่นี่ (ชุดที่ส่งต้องตรงกับที่ยืนยัน)
    const bulkState = document.querySelector("#queue-bulk")?.dataset.state;
    if (bulkState && bulkState !== "idle") return;
    const busy = panel.dataset.state !== "idle";
    document.querySelectorAll(".queue-select, #queue-select-all").forEach((box) => { box.disabled = busy; });
  };
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ["data-state"] });
  sync();
}

// หลังตัดสินใบหนึ่ง: ถ้าผู้ใช้กำลังยืนยันหรือนับถอยหลังใบอื่นอยู่ (เปิดใบใหม่ระหว่างที่ใบเดิมกำลังส่ง)
// ห้ามวาดใหม่ทั้งหน้า เพราะจะส่งมติของใบนั้นทันทีและทิ้งข้อความที่พิมพ์ค้าง — แค่เอาแถวที่ตัดสินแล้วออก
async function afterQueueDecision(id, decision, label = null) {
  const item = homeQueueState.ctx?.items.find((entry) => entry.id === id);
  announce(`${label ?? decisionVerbs[decision] ?? "บันทึกผล"} ${item?.request.request_no ?? ""} แล้ว`);
  const panel = document.querySelector("#decision-panel");
  const otherBusy = homeQueueState.selectedId !== id && panel && panel.dataset.state !== "idle";
  if (otherBusy) {
    document.querySelector(`.queue-item[data-request-id="${CSS.escape(id)}"]`)?.remove();
    return;
  }
  await renderDashboard();
  document.querySelector(".queue-item.is-selected .queue-item-main")?.focus();
}

// ประกาศให้โปรแกรมอ่านหน้าจอ (live region อยู่นอก #app จึงไม่ถูกแทนที่ตอนวาดหน้าใหม่)
function announce(text) {
  let region = document.querySelector("#sr-announcer");
  if (!region) {
    region = document.createElement("div");
    region.id = "sr-announcer";
    region.className = "sr-only";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  region.textContent = "";
  window.setTimeout(() => { region.textContent = text; }, 50);
}

function collapseQueueItem() {
  activeDecisionCountdown?.flush();
  homeQueueState.selectedId = null;
  homeQueueState.collapsed = true;
  document.querySelectorAll(".queue-item").forEach((node) => {
    node.classList.remove("is-selected");
    node.querySelector(".queue-item-main[aria-expanded]")?.setAttribute("aria-expanded", "false");
    node.querySelector(".queue-item-slot")?.replaceChildren();
  });
  document.querySelector("#queue-detail-pane")?.replaceChildren();
  syncQueueBulk();
}

function bindHomeQueue() {
  const list = document.querySelector(".queue-list");
  if (!list) return;
  list.addEventListener("click", (event) => {
    const main = event.target.closest("button.queue-item-main");
    if (!main) return;
    const id = main.closest(".queue-item")?.dataset.requestId;
    if (!id) return;
    // แตะใบที่เปิดอยู่: จอแคบ = ยุบ; จอกว้าง = ไม่ทำอะไร (ไม่ส่งมติที่นับถอยหลังหรือทิ้งข้อความที่พิมพ์ค้าง)
    if (id === homeQueueState.selectedId) return isWideLayout() ? undefined : collapseQueueItem();
    selectQueueItem(id, { focus: true });
  });
  list.addEventListener("change", (event) => { if (event.target.matches(".queue-select")) syncQueueBulk(); });
  document.querySelector("#queue-select-all")?.addEventListener("change", (event) => {
    document.querySelectorAll(".queue-select").forEach((box) => { box.checked = event.target.checked; });
    syncQueueBulk();
  });
  document.querySelector("#queue-more")?.addEventListener("click", (event) => {
    document.querySelectorAll(".queue-item[hidden]").forEach((node) => { node.hidden = false; });
    event.currentTarget.remove();
  });
  bindQueueBulk();
}

// คำของขั้น (อนุมัติ รับทราบ …) ตามชื่อขั้น ใช้ทั้งปุ่มใบเดียวและแถบหลายรายการ
const queueStepVerb = (step) => window.MNP_STEP_VERB.verbOf(step.step_name, (requestModule(relation(step.request.request_type)?.code)?.extraDecisions ?? []).map((item) => item.label));
// ข้อความของรายการที่เลือก: คำเดียวกันทั้งหมด = "รับทราบ 3 รายการ" · ปนกัน = "อนุมัติ 2 · รับทราบ 1"
function bulkVerbText(steps) {
  const counts = new Map();
  steps.forEach((step) => { const verb = queueStepVerb(step); counts.set(verb, (counts.get(verb) ?? 0) + 1); });
  const only = counts.size === 1 ? [...counts.keys()][0] : "";
  return { only, summary: only ? `${only} ${steps.length} รายการ` : [...counts].map(([verb, n]) => `${verb} ${n}`).join(" · ") };
}
const QUEUE_BULK_IDLE_BUTTONS = `<button type="button" class="btn secondary" id="queue-bulk-clear">ล้างที่เลือก</button><button type="button" class="btn success is-primary" id="queue-bulk-approve">ตัดสินที่เลือก</button>`;
let activeBulkCountdown = null;

// อนุมัติหลายรายการ: ขั้นเดียวกับอนุมัติใบเดียวในแถบล่าง — "อนุมัติที่เลือก" → ยืนยันพร้อมเลขที่ใบ → เลิกทำได้ภายใน DECISION_UNDO_SECONDS วินาที → ส่ง
// (เดิมเป็นกล่องยืนยันกลางจอแล้วส่งทันที ไม่มีเลิกทำ) ระหว่างยืนยัน/นับถอยหลัง/ส่ง ล็อกช่องติ๊กไว้ รายการที่จะส่งจึงตรงกับที่ยืนยัน
function bindQueueBulk() {
  const bulk = document.querySelector("#queue-bulk");
  const rules = window.MNP_REQUEST_DECISION;
  if (!bulk || !rules) return;
  const text = bulk.querySelector("#queue-bulk-text");
  const buttons = bulk.querySelector("#queue-bulk-buttons");
  let chosen = [];
  const lockBoxes = (locked) => document.querySelectorAll(".queue-select, #queue-select-all").forEach((box) => { box.disabled = locked; });
  const button = (label, className, action, attrs = "") => `<button type="button" class="btn ${className}" data-bulk-action="${action}"${attrs}>${escapeHtml(label)}</button>`;
  const numbers = () => chosen.map((step) => step.request.request_no).join(", ");
  const countdown = rules.createCountdown({
    seconds: DECISION_UNDO_SECONDS,
    // ตัวเลขบนปุ่มเท่านั้น (ไม่อยู่ใน live region) เหมือนแถบของใบเดียว
    onTick: (secondsLeft) => { const undo = buttons.querySelector('[data-bulk-action="undo"]'); if (undo) undo.textContent = `เลิกทำ (${secondsLeft})`; },
    onSend: () => send(),
  });
  activeBulkCountdown = countdown;
  const setText = (value) => { text.hidden = !value; text.textContent = value; };
  function render(name) {
    bulk.dataset.state = name;
    if (name === "idle") {
      buttons.innerHTML = QUEUE_BULK_IDLE_BUTTONS;
      lockBoxes(false);
      syncQueueBulk();
      return;
    }
    lockBoxes(true);
    if (name === "confirm") {
      const verbs = bulkVerbText(chosen);
      setText(`${verbs.summary}: ${numbers()}`);
      buttons.innerHTML = `${button("ยกเลิก", "secondary", "cancel")}${button(verbs.only ? `ยืนยัน${verbs.only} ${chosen.length} รายการ` : `ยืนยัน ${chosen.length} รายการ`, "success is-primary", "confirm")}`;
    } else if (name === "pending") {
      setText(`กำลังจะ${bulkVerbText(chosen).summary}`);
      buttons.innerHTML = `${button(`เลิกทำ (${DECISION_UNDO_SECONDS})`, "secondary", "undo")}${button("ส่งเลย", "success is-primary", "send-now")}`;
    } else if (name === "sending") {
      setText(`กำลังส่ง: ${bulkVerbText(chosen).summary}…`);
      buttons.innerHTML = button("กำลังส่ง…", "success is-primary", "none", ' disabled aria-busy="true"');
    }
    trackActionBarHeight();
  }
  const toIdle = () => {
    countdown.undo();
    detachLeaveGuards();
    chosen = [];
    render("idle");
    document.querySelector("#queue-bulk-approve")?.focus();
  };

  buttons.addEventListener("click", (event) => {
    if (event.target.closest("#queue-bulk-clear")) {
      document.querySelectorAll(".queue-select").forEach((box) => { box.checked = false; });
      const all = document.querySelector("#queue-select-all");
      if (all) all.checked = false;
      return syncQueueBulk();
    }
    if (event.target.closest("#queue-bulk-approve")) {
      chosen = pickedQueueSteps();
      if (!chosen.length || chosen.length > BULK_APPROVE_LIMIT) return;
      render("confirm");
      return buttons.querySelector('[data-bulk-action="confirm"]')?.focus();
    }
    const action = event.target.closest("[data-bulk-action]")?.dataset.bulkAction;
    if (action === "cancel" || action === "undo") return toIdle();
    if (action === "confirm") {
      render("pending");
      buttons.querySelector('[data-bulk-action="undo"]')?.focus();
      countdown.start({});
      return attachLeaveGuards();
    }
    if (action === "send-now") return countdown.flush();
  });
  bulk.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (bulk.dataset.state === "confirm" || bulk.dataset.state === "pending") { event.preventDefault(); toIdle(); }
  });

  // ไปหน้าอื่นหรือสลับแอประหว่างนับถอยหลัง = ตั้งใจส่ง (เหมือนใบเดียว) ปิดแท็บ/รีเฟรชถามก่อน
  function sendOnLeave() { countdown.flush(); }
  function sendWhenHidden() { if (document.visibilityState === "hidden") countdown.flush(); }
  function warnBeforeUnload(event) {
    if (!countdown.pending && bulk.dataset.state !== "sending") return;
    event.preventDefault();
    event.returnValue = "";
  }
  function attachLeaveGuards() {
    window.addEventListener("hashchange", sendOnLeave);
    document.addEventListener("visibilitychange", sendWhenHidden);
    window.addEventListener("beforeunload", warnBeforeUnload);
  }
  function detachLeaveGuards() {
    window.removeEventListener("hashchange", sendOnLeave);
    document.removeEventListener("visibilitychange", sendWhenHidden);
    window.removeEventListener("beforeunload", warnBeforeUnload);
  }

  async function send() {
    if (bulk.isConnected) render("sending");
    let summary = null;
    try {
      summary = await runBulkApprove(chosen);
    } catch (error) {
      // ผลของแต่ละใบอยู่ในฐานข้อมูลแล้ว (ฐานข้อมูลตรวจขั้นปัจจุบันทุกครั้ง) วาดคิวใหม่จะเห็นว่าใบไหนผ่าน
      summary = [`อนุมัติหลายรายการไม่ครบ: ${friendlyError(error)} · ดูรายการที่ยังค้างในคิว`, "error"];
    } finally {
      detachLeaveGuards();
      if (activeBulkCountdown === countdown) activeBulkCountdown = null;
    }
    if (location.hash === "" || /^#\/(dashboard|approvals)?(\?|$)/.test(location.hash)) {
      try {
        await renderDashboard();
        // แบบเดียวกับใบเดียว: โฟกัสกลับมาที่คิว ไม่หลุดไปที่ body — ถ้าผู้ใช้ไปทำอย่างอื่นระหว่างรอส่ง (ชุดใหญ่) ไม่แย่งโฟกัส
        if (!document.activeElement || document.activeElement === document.body) document.querySelector(".queue-item.is-selected .queue-item-main, .queue-item-main")?.focus();
      } catch (renderError) {
        console.error(renderError);
        if (bulk.isConnected) { chosen = []; render("idle"); }
      }
    }
    if (summary) showToast(...summary);
  }
}

function pickedQueueSteps() {
  const ids = [...document.querySelectorAll(".queue-select:checked")].map((box) => box.value);
  return (homeQueueState.ctx?.items ?? []).filter((item) => item.kind === "approval" && ids.includes(item.step.id)).map((item) => item.step);
}

// เลือกหลายใบแล้ว: แถบอนุมัติหลายรายการแทนที่แถบตัดสินใจของใบที่เปิดอยู่ (บนจอแคบอยู่ตำแหน่งเดียวกันล่างจอ)
function syncQueueBulk() {
  const bulk = document.querySelector("#queue-bulk");
  if (!bulk) return;
  // กำลังยืนยัน/นับถอยหลัง/ส่ง (bindQueueBulk): แถบนี้คุมข้อความและปุ่มเอง ช่องติ๊กถูกล็อก จำนวนจึงไม่เปลี่ยน
  if (bulk.dataset.state && bulk.dataset.state !== "idle") {
    const panel = document.querySelector("#decision-panel");
    if (panel && panel.dataset.state === "idle") panel.hidden = true;
    return trackActionBarHeight();
  }
  const count = pickedQueueSteps().length;
  const total = document.querySelectorAll(".queue-select").length;
  bulk.hidden = count === 0;
  const all = document.querySelector("#queue-select-all");
  if (all) { all.checked = count > 0 && count === total; all.indeterminate = count > 0 && count < total; }
  const tooMany = count > BULK_APPROVE_LIMIT;
  // จำนวนที่เลือกอยู่บนปุ่มแล้ว บรรทัดนี้ขึ้นเฉพาะเมื่อเลือกเลยกำหนด
  const text = document.querySelector("#queue-bulk-text");
  text.hidden = !tooMany;
  text.textContent = tooMany ? `เลือกได้ครั้งละไม่เกิน ${BULK_APPROVE_LIMIT} รายการ` : "";
  const approve = document.querySelector("#queue-bulk-approve");
  approve.disabled = count === 0 || tooMany;
  // ปุ่มใช้คำของขั้นเมื่อทุกใบที่เลือกเป็นคำเดียวกัน (ส่วนใหญ่ "อนุมัติ") ปนกันใช้ "ตัดสิน"
  const picked = pickedQueueSteps();
  const only = picked.length ? bulkVerbText(picked).only : "อนุมัติ";
  approve.textContent = `${only || "ตัดสิน"}ที่เลือก (${count})`;
  const panel = document.querySelector("#decision-panel");
  if (panel) panel.hidden = count > 0 && panel.dataset.state === "idle";
  trackActionBarHeight();
}

// คีย์ลัดของคิว (จอที่มีคีย์บอร์ด): J/K เลื่อน, A อนุมัติ, R ไม่อนุมัติ — A/R เปิดขั้นยืนยันในแถบ ไม่ส่งทันที
// A/R ใช้ได้ทั้งในคิวหน้าหลักและหน้ารายละเอียดคำร้อง (#/request) ที่มีแถบตัดสินใจ; J/K เฉพาะคิว
document.addEventListener("keydown", (event) => {
  const inQueue = Boolean(document.querySelector("#home-queue .queue-list"));
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || !(inQueue || document.querySelector("#decision-panel"))) return;
  // คีย์บอร์ดที่ค้างภาษาไทยส่ง "่", "า", "ฟ", "พ" แทน j/k/a/r: ใช้ตำแหน่งปุ่ม (event.code) เฉพาะเมื่อไม่ได้ตัวอักษรละติน
  // แป้นละตินแบบอื่น (AZERTY, Dvorak) ยังใช้ตัวอักษรที่พิมพ์ได้จริง
  const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : ({ KeyJ: "j", KeyK: "k", KeyA: "a", KeyR: "r" }[event.code] ?? event.key.toLowerCase());
  if (!["j", "k", "a", "r"].includes(key)) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
  if (document.querySelector("dialog[open], .attachment-lightbox, [data-popup]:not([hidden])")) return;
  if (key === "j" || key === "k") {
    if (!inQueue) return;
    // ทุกแถวที่มองเห็น: แถวอนุมัติใช้เลขใบเป็นกุญแจ แถวงาน (ลิงก์ไปหน้าใบ) ใช้ตำแหน่ง · เริ่มจากแถวที่โฟกัสอยู่ ไม่มีก็จากใบที่เลือก
    const rows = [...document.querySelectorAll("#home-queue .queue-item:not([hidden])")];
    const keys = rows.map((row, index) => row.dataset.requestId ?? `task:${index}`);
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest(".queue-item") : null;
    const current = focused && rows.includes(focused) ? keys[rows.indexOf(focused)] : homeQueueState.selectedId;
    const next = window.MNP_HOME_QUEUE.stepSelection(keys, current, key === "j" ? 1 : -1);
    if (!next) return;
    event.preventDefault();
    const row = rows[keys.indexOf(next)];
    if (row.dataset.requestId && next !== homeQueueState.selectedId) selectQueueItem(next);
    row.querySelector(".queue-item-main")?.focus();
    return;
  }
  if (target instanceof HTMLElement && target.closest(".queue-item.is-task")) return;
  const panel = document.querySelector("#decision-panel");
  if (!panel || panel.hidden || panel.dataset.state !== "idle") return;
  const button = panel.querySelector(`[data-decision="${key === "a" ? "approved" : "rejected"}"]`);
  if (!button) return;
  event.preventDefault();
  button.click();
});

// ตารางคีย์ลัด (กด ? หรือปุ่มช่วยเหลือที่แถบบน): รายการอยู่ใน modules/shortcut-help.js ไม่เป็นข้อความถาวรบนหน้า
// ฟอร์มสร้างเปิดใต้ #/requests?mode=create จึงใช้คำแนะนำของหน้าสร้าง (new)
// คำแนะนำของ NCR เขียนสำหรับหน้าใบ (#/ncr?id=…) หน้าอื่นใต้ #/ncr (ฟอร์มออก NCR) จึงไม่มีส่วน "หน้านี้"
function helpPageKey(route) {
  if (route.path === "requests" && route.params.get("mode") === "create") return "new";
  if (route.path === "ncr") return route.params.get("id") ? "ncr" : "";
  return route.path;
}

function openShortcutHelp() {
  if (typeof HTMLDialogElement !== "function") return;
  const opener = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "confirm-dialog shortcut-dialog";
  dialog.setAttribute("aria-labelledby", "shortcut-dialog-title");
  dialog.innerHTML = `<form method="dialog">
    <h2 id="shortcut-dialog-title">ช่วยเหลือ</h2>
    ${window.MNP_SHORTCUT_HELP.helpHtml(escapeHtml, helpPageKey(currentRoute()))}
    <div class="confirm-dialog-actions"><button class="btn" value="close">ปิด</button></div>
  </form>`;
  document.body.append(dialog);
  const closeOnNavigate = () => { if (dialog.open) dialog.close(); };
  window.addEventListener("hashchange", closeOnNavigate, { once: true });
  // ปิดด้วย Esc หรือปุ่มปิด แล้วคืนโฟกัสให้ที่เดิม
  dialog.addEventListener("close", () => {
    window.removeEventListener("hashchange", closeOnNavigate);
    dialog.remove();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, { once: true });
  dialog.showModal();
}

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || !window.MNP_SHORTCUT_HELP.isHelpKey(event) || !document.querySelector(".app-shell")) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
  if (document.querySelector("dialog[open], .attachment-lightbox, [data-popup]:not([hidden])")) return;
  event.preventDefault();
  openShortcutHelp();
});

// หมุนจอหรือย่อขยายหน้าต่างข้ามขนาด: ย้ายใบที่เปิดไปอยู่ตำแหน่งของขนาดจอใหม่
// (Safari เก่าไม่มี addEventListener บน MediaQueryList: ข้ามไป ไม่ให้แอปทั้งแอปพังตอนโหลด)
window.matchMedia("(min-width: 1041px)").addEventListener?.("change", () => {
  if (homeQueueState.selectedId && document.querySelector("#home-queue .queue-list")) selectQueueItem(homeQueueState.selectedId);
});

// ตัวกรองสถานะ: ชื่อมาจาก statusLabels ชุดเดียวกับป้าย (ในโมดูลแจ้งซ่อม requestListFilters ใช้ชื่อแบบใบแจ้งซ่อม)
const REQUEST_STATUS_FILTERS = [
  ["all", "ทั้งหมด"],
  ...["pending_approval", "approved", "pending_assign", "assigned", "in_progress", "pending_verify", "completed", "acknowledged", "rejected"]
    .map((status) => [status, statusLabels[status]]),
];

const requestCenterUrl = window.MNP_REQUEST_CENTER.url;

let pendingModuleZoom = null;
function moduleZoomKey(params) {
  return params.get("mode") === "create" ? `create:${params.get("createType")}` : `list:${params.get("type")}`;
}

function queueModuleZoom(hash) {
  pendingModuleZoom = moduleZoomKey(new URLSearchParams(hash.split("?")[1]));
}

// เอฟเฟกต์ "เข้าโมดูล" หลังกดการ์ดโมดูล ใช้ร่วมกันระหว่างหน้าคำร้องกับ MNP LAB (modules/module-lab.js)
// onDone ทำงานเมื่อเล่นจบ ถูกยกเลิก หรือไม่ได้เล่น (เบราว์เซอร์ไม่รองรับ / ผู้ใช้ตั้งลดการเคลื่อนไหว)
function zoomIntoContent(onDone = () => {}) {
  const content = document.querySelector(".content");
  if (!content?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onDone();
    return;
  }
  // Animate only the workspace content; navigation stays still and remains usable.
  content.getAnimations().forEach((animation) => animation.cancel());
  const animation = content.animate([
    { opacity: 0.45, transform: "translateY(8px) scale(0.96)", transformOrigin: "50% 0" },
    { opacity: 1, transform: "translateY(0) scale(1)", transformOrigin: "50% 0" },
  ], { duration: 320, easing: "cubic-bezier(0.2, 0.75, 0.25, 1)" });
  animation.finished.then(onDone, onDone);
}

function playModuleZoom(params) {
  if (pendingModuleZoom !== moduleZoomKey(params)) return;
  pendingModuleZoom = null;
  const createEntry = document.querySelector(".content .request-create-entry");
  // Reveal the module's create action after entering, including cancelled animations.
  zoomIntoContent(() => createEntry?.classList.remove("module-create-pending"));
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

// หน้ารายการของโมดูล: ขอบเขตชุดเดียว ที่ฉันมีสิทธิ์ดู · ที่ฉันแจ้ง · ติดตามสถานะทุกใบ (กระดาน) แทนแท็บมุมมองกับปุ่มขอบเขตสองชุดที่ทับกัน
// ทะเบียน NCR ไม่มีกระดาน จึงเรียกด้วย board: false (แท็บตำแหน่งเดียวกับโมดูลอื่น)
function requestsViewTabs(params, { board: withBoard = true } = {}) {
  const board = params.get("view") === "board";
  const mine = !board && params.get("scope") === "mine";
  const tab = (active, changes, label, hint) => `<a class="view-tab${active ? " active" : ""}"${active ? ' aria-current="page"' : ""} href="${escapeHtml(requestCenterUrl(params, changes))}" title="${hint}">${label}</a>`;
  return `<nav class="view-tabs" aria-label="ใบที่แสดง" title="สิทธิ์ดูรายละเอียดและดำเนินการเป็นไปตามบัญชีของคุณ">
    ${tab(!board && !mine, { view: null, scope: null }, "ที่ฉันมีสิทธิ์ดู", "ใบที่บัญชีของคุณเปิดดูรายละเอียดได้")}${tab(mine, { view: null, scope: "mine" }, "ที่ฉันแจ้ง", "เฉพาะใบที่คุณเป็นผู้แจ้ง")}${withBoard || board ? tab(board, { view: "board", scope: null }, "ติดตามสถานะทุกใบ", "ทุกใบของโมดูล เห็นสถานะได้ทุกใบ เปิดรายละเอียดได้เฉพาะใบที่มีสิทธิ์") : ""}
  </nav>`;
}


// แถวตัวกรองเดียวของหน้ารายการ: ขอบเขต · สถานะ (ตัวเลือกเดียวแทนชิป 10 อัน) · แผนก · ค้นหาเลขที่ — รายการจึงขึ้นในจอแรกบนมือถือ
// module: หน้าเป็นของโมดูลเดียว ตัวเลือกสถานะจึงตามขั้นตอนของโมดูลนั้น (กระดานทุกโมดูลแสดงทุกสถานะ)
function requestListFilters(params, { departments = null, placeholder, search = true, repair = false, module = false, statusSelect: ownStatusSelect = null, statusApplied = null } = {}) {
  // ค่าที่ช่องแสดงต้องตรงกับที่รายการกรองจริง (knownRequestStatuses): ไม่รู้จักเลย = ทุกสถานะ, รู้จักค่าเดียว = ค่านั้น
  const known = knownRequestStatuses(params);
  const value = known.length === 0 ? "all" : known.length === 1 ? known[0] : known.join(",");
  // โมดูลเดียว: งานซ่อมไม่มี "รับทราบข้อมูล" โมดูลอื่นไม่มีขั้นของช่าง (ค่าที่กรองอยู่แสดงเสมอ)
  const offWorkflow = !module ? [] : repair ? ["acknowledged"] : ["pending_assign", "assigned", "pending_verify"];
  const options = REQUEST_STATUS_FILTERS.filter(([option]) => !offWorkflow.includes(option) || known.includes(option)).map(([option, label]) => ({ value: option, label: option === "all" ? "ทุกสถานะ" : statusLabel(option, repair), href: requestCenterUrl(params, { status: option }) }));
  // ลิงก์จากแดชบอร์ดส่งหลายสถานะคั่นจุลภาค: เป็นตัวเลือกของตัวเอง ช่องจึงบอกค่าที่ใช้กรองอยู่จริง
  if (known.length > 1) {
    const labels = known.map((status) => statusLabel(status, repair));
    options.splice(1, 0, { value, label: labels.join(", "), href: requestCenterUrl(params, { status: value }) });
  }
  const statusSelect = ownStatusSelect ?? hrefSelectHtml({ id: "request-filter-status", label: "สถานะ", options, value });
  // จอแคบ: ตัวกรองทั้งแถวพับอยู่หลังปุ่ม "ตัวกรอง (n)" (n = ตัวกรองที่ใช้อยู่) รายการจึงขึ้นในจอแรก จอกว้างเห็นทั้งแถวเสมอ
  // นับเฉพาะตัวกรองที่หน้านี้ใช้กรองจริง (คำค้นที่ค้างจากโมดูลอื่นซึ่งไม่มีช่องค้นหา หรือแผนกที่ไม่มีในรายการ ไม่นับ)
  // พับอยู่: ค่าที่กรองอยู่บอกใน title ของปุ่ม ไม่ต้องเปิดดู
  const department = departments ? selectedFilterDepartment(params, departments) : null;
  const query = search ? (params.get("q") ?? "").trim() : "";
  const applied = [
    ownStatusSelect ? statusApplied ?? "" : known.length ? `สถานะ ${known.map((status) => statusLabel(status, repair)).join(", ")}` : "",
    department ? `แผนก ${department.displayCode}` : "",
    query ? `ค้นหา "${query}"` : "",
  ].filter(Boolean);
  const active = applied.length;
  const open = listFiltersOpen;
  return `<div class="list-filters${open ? " is-open" : ""}">
    <button type="button" class="btn secondary list-filters-toggle" aria-expanded="${open}" aria-controls="list-filters-body" data-list-filters-toggle${active ? ` title="${escapeHtml(`กรองอยู่: ${applied.join(" · ")}`)}"` : ""}>${uiIcon("search")} ตัวกรอง${active ? ` (${active})` : ""}</button>
    <div class="list-filters-body" id="list-filters-body">${search ? requestSearchForm(params, { departments, placeholder, leading: statusSelect }) : statusSelect}</div>
  </div>`;
}

// เปิดตัวกรองแล้วเปลี่ยนค่า หน้าวาดใหม่: ตัวกรองยังเปิดอยู่ ไม่ต้องกดเปิดซ้ำทุกครั้ง
let listFiltersOpen = false;
document.addEventListener("click", (event) => {
  const toggle = event.target.closest?.("[data-list-filters-toggle]");
  if (!toggle) return;
  listFiltersOpen = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", String(listFiltersOpen));
  toggle.closest(".list-filters")?.classList.toggle("is-open", listFiltersOpen);
});

// โมดูลที่ประกาศ loadRepairDepartments (MT) มีตัวกรองแผนกในหน้ารายการ — ค่า dept ใน URL คือรหัสแผนกต้นทาง (เช่น RB, ST)
// ตัวกรองแค่ย่อรายการ ไม่ให้สิทธิ์เพิ่ม (RLS ยังเป็นตัวตัดสินว่าอ่านใบไหนได้)
async function loadRequestDepartmentFilter(selected) {
  const filterModule = selected ? requestModule(selected.code) : null;
  if (!filterModule?.enabled || typeof filterModule.loadRepairDepartments !== "function") return null;
  return await filterModule.loadRepairDepartments(sb);
}

function selectedFilterDepartment(params, departments) {
  return departments?.find((item) => item.sourceCode === params.get("dept")) ?? null;
}

// leading: ตัวควบคุมที่วางหน้าแผนกในแถวเดียวกัน (ตัวเลือกสถานะ) — ไม่ส่งไปกับฟอร์ม เพราะเปลี่ยนหน้าเองเมื่อเลือก
function requestSearchForm(params, { departments, placeholder, leading = "" }) {
  const search = (params.get("q") ?? "").trim();
  const department = selectedFilterDepartment(params, departments);
  return `<form class="board-search" id="request-filter-form" role="search">
      ${leading}${departments ? `<select class="select" id="request-filter-department" name="dept" aria-label="กรองตามแผนก">
        <option value="">ทุกแผนก</option>
        ${departments.map((item) => `<option value="${escapeHtml(item.sourceCode)}"${department?.sourceCode === item.sourceCode ? " selected" : ""}>${escapeHtml(item.displayCode)} · ${escapeHtml(item.name)}</option>`).join("")}
      </select>` : ""}
      <input class="input" id="request-filter-search" aria-label="ค้นหาคำร้อง" aria-keyshortcuts="/" name="q" type="search" maxlength="80" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(search)}">
      <button class="btn secondary small" type="submit">ค้นหา</button>
      ${search || department ? `<a class="btn secondary small" href="${escapeHtml(requestCenterUrl(params, { q: null, dept: null }))}">ล้าง</a>` : ""}
    </form>`;
}

function bindRequestSearchForm(params) {
  const form = document.querySelector("#request-filter-form");
  const submit = () => {
    location.hash = requestCenterUrl(params, {
      q: form.querySelector("#request-filter-search").value.trim(),
      dept: form.querySelector("#request-filter-department")?.value ?? null,
    });
  };
  form?.addEventListener("submit", (event) => { event.preventDefault(); submit(); });
  form?.querySelector("#request-filter-department")?.addEventListener("change", submit);
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

// counts: ใช้เฉพาะการ์ดบนหน้าเลือกโมดูล (ในโมดูลตารางข้างล่างบอกจำนวนอยู่แล้ว หัวไม่นับซ้ำ)
function requestCenterHeader(types, params, counts, { countScope = "" } = {}) {
  const selected = types.find((type) => type.id === params.get("type"));
  if (selected) {
    // หัวโมดูลบอกชื่อโมดูลแล้ว ปุ่มในหัวจึงไม่ต่อท้ายด้วยรหัสโมดูลซ้ำ (เดิมหัว MT มีคำว่า MT สี่ครั้ง)
    const createLabel = { MT_REPAIR: "สร้างคำร้อง / แจ้งซ่อม", MANAGEMENT: "สร้างคำร้องถึงฝ่ายบริหาร", NCR_CAR: "ออก NCR", IT_REPAIR: "สร้างใบแจ้งซ่อม IT" }[selected.code] ?? `สร้าง${requestTypeLabel(selected)}`;
    // ลิงก์เสริมของโมดูล (เช่น แดชบอร์ด NCR) วางข้างปุ่มสร้าง — โมดูลประกาศ headerLinks: [{ href, label, icon }]
    const headerLinks = (requestModule(selected.code)?.headerLinks ?? [])
      .map((link) => `<a class="btn" href="${escapeHtml(link.href)}">${link.icon ?? ""}${escapeHtml(link.label)}</a>`).join("");
    return `<a class="request-back-link" id="back-to-modules" href="${escapeHtml(requestCenterUrl(params, { type: "all", status: null, ncrStatus: null, view: null, q: null }))}" aria-label="ย้อนกลับไปเลือกโมดูล">‹ เลือกโมดูล</a>
      <div class="page-heading request-module-header" data-module="${requestPalette(selected.code)}">
        <div class="request-module-title">${typeCardMarkHtml(selected, { prefix: !selected.prefix || !requestTypeLabel(selected).includes(selected.prefix) })}<div><h1>${escapeHtml(requestTypeLabel(selected))}</h1></div></div>${typeCardWatermarkHtml(selected.code)}
        <div class="request-create-entry${pendingModuleZoom === moduleZoomKey(params) ? " module-create-pending" : ""}">${headerLinks}<a class="btn" id="create-request-button" href="${escapeHtml(window.MNP_REQUEST_CENTER.createUrl(params))}"><span class="plus-icon" aria-hidden="true"></span> ${escapeHtml(createLabel)}</a></div>
      </div>`;
  }
  return `<div class="page-heading"><div><h1>คำร้อง</h1><p>เลือกโมดูลเพื่อดูสถานะและสร้างคำร้อง</p></div></div>
    <nav class="type-grid request-type-grid" aria-label="ประเภทคำร้อง">${types.map((type) => `<a class="type-card request-type-card${selected?.id === type.id ? " selected" : ""}" ${selected?.id === type.id ? 'aria-current="page"' : ""} href="${escapeHtml(requestCenterUrl(params, { type: type.id, status: null, ncrStatus: null }))}" data-module="${requestPalette(type.code)}">
      <span class="request-type-top">${typeCardMarkHtml(type)}<span class="request-type-count"${counts && countScope ? ` title="${escapeHtml(`นับเฉพาะรายการที่ยังไม่จบ${countScope}`)}"` : ""}>${counts ? `${counts.get(type.id) ?? 0} ยังไม่จบ` : "ดูสถานะ"}</span></span>
      <span class="type-card-body"><strong>${escapeHtml(requestTypeLabel(type))}</strong>${selected?.id === type.id ? "<small>กำลังแสดงประเภทนี้</small>" : ""}</span>
      ${typeCardWatermarkHtml(type.code)}
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
  const departments = await loadRequestDepartmentFilter(selected);
  const department = selectedFilterDepartment(params, departments);
  const rows = (data ?? []).filter((row) => deptModuleAllowed(row.type_code) && (!selected || row.type_code === selected.code)
    && (status === "all" || status.split(",").includes(row.status))
    && (!department || row.department_code === department.sourceCode));
  const boardContent = `${requestCenterHeader(types, params, null)}${requestsViewTabs(params)}
    ${requestListFilters(params, { departments, placeholder: "ค้นหาเลขที่ใบ ชื่อ/รหัสเครื่องจักร ผู้แจ้ง หรือแผนก", repair: isRepairType(selected), module: Boolean(selected) })}
    ${(data ?? []).length >= 500 ? `<p class="muted small board-note">แสดง 500 ใบล่าสุด ค้นด้วยเลขที่ใบเพื่อหาใบที่เก่ากว่า</p>` : ""}
    <section class="request-list-panel">${statusBoardRows(rows, { showType: !selected, params, filtered: status !== "all" || Boolean(search) || Boolean(department) })}</section>`;
  const content = selected ? `<div data-module="${requestPalette(selected.code)}">${boardContent}</div>` : boardContent;
  app.innerHTML = shell(content, "requests", "คำร้อง", selected ? `ติดตามสถานะ · ${requestTypeLabel(selected)}` : "ติดตามสถานะทุกใบ");
  bindShell();
  bindModuleZoom(params);
  bindRequestSearchForm(params);
}

function knownRequestStatuses(params) {
  return window.MNP_REQUEST_CENTER.statusList(params, REQUEST_STATUS_FILTERS.map(([value]) => value));
}

// RLS decides which rows this account can read; the filters only narrow the list.
async function requestListPanel(params, typeId, { departmentId = null, search = "" } = {}) {
  const mineOnly = params.get("scope") === "mine";
  let query = sb.from("requests")
    .select("id,request_no,title,description,status,priority,created_at,updated_at,needed_date,work_expected_date,machine_code,machine_name,requester_id,assignee_id,requester_name,request_type:request_types(name_th,code,uses_repair_workflow),request_technicians(technician_id),current_step,approval_steps(step_order,step_name,status)")
    .order("created_at", { ascending: false });
  if (mineOnly) query = query.eq("requester_id", state.employee.id);
  if (typeId) query = query.eq("request_type_id", typeId);
  if (departmentId) query = query.eq("department_id", departmentId);
  const statuses = knownRequestStatuses(params);
  if (statuses.length) query = query.in("status", statuses);
  const [{ data, error }, directory] = await Promise.all([query, loadEmployeeDirectory()]);
  if (error) throw error;
  // ค้นในเลขที่ ชื่อเรื่อง เครื่องจักร และผู้แจ้ง (ไม่สนตัวพิมพ์) แบบเดียวกับทะเบียน NCR · RLS โหลดทั้งโมดูลอยู่แล้ว จึงกรองบนเครื่อง
  const needle = String(search ?? "").trim().toLocaleLowerCase("th-TH");
  const matchesSearch = (row) => !needle || [row.request_no, row.title, row.machine_code, row.machine_name, row.requester_name, personName(directory, row.requester_id)]
    .some((value) => String(value ?? "").toLocaleLowerCase("th-TH").includes(needle));
  const rows = (data ?? []).filter((row) => deptModuleAllowed(relation(row.request_type)?.code) && matchesSearch(row));
  const capped = (data ?? []).length >= 1000
    ? `<p class="muted small board-note">แสดง 1,000 ใบล่าสุด${typeId ? ` หาใบที่เก่ากว่าได้ที่ <a href="${escapeHtml(requestCenterUrl(params, { view: "board", scope: null }))}">ติดตามสถานะทุกใบ</a>` : ""}</p>`
    : "";
  return `<section class="request-list-panel">${capped}${requestRows(rows, { showRequester: !mineOnly, showType: !typeId, directory, params, filtered: Boolean(typeId) && (Boolean(search) || Boolean(departmentId) || statuses.length > 0) })}</section>`;
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
    app.innerHTML = shell(`${requestCenterHeader(types, params, counts, { countScope: mineOnly ? "ที่คุณแจ้ง" : "ที่คุณมีสิทธิ์ดู" })}${statusList}`, "requests", "คำร้อง");
    bindShell();
    bindModuleZoom(params);
    return;
  }
  if (params.get("view") === "board") return await renderRequestsBoard(params, types);
  let list = "";
  if (selected.code !== "NCR_CAR") {
    const departments = await loadRequestDepartmentFilter(selected);
    const department = selectedFilterDepartment(params, departments);
    // ทุกโมดูลมีช่องค้นหา (ช่องแสดงคำค้นที่ใช้อยู่เสมอ จึงไม่มีรายการที่ถูกย่อโดยมองไม่เห็นตัวกรอง) · ตัวกรองแผนกมีเฉพาะโมดูลที่ประกาศ
    const search = (params.get("q") ?? "").trim();
    list = `${requestListFilters(params, { departments, placeholder: isRepairType(selected) ? "ค้นหาเลขที่ใบ ชื่อเรื่อง เครื่องจักร หรือผู้แจ้ง" : "ค้นหาเลขที่ใบ ชื่อเรื่อง หรือผู้แจ้ง", search: true, repair: isRepairType(selected), module: true })}${await requestListPanel(params, selected.id, { departmentId: department?.id ?? null, search })}`;
  }
  const ncrModule = requestModule("NCR_CAR");
  if (selected.code === "NCR_CAR" && ncrModule?.enabled) {
    // หัวรายการแบบเดียวกับโมดูลอื่น: แท็บขอบเขตด้านบน แล้วแถวตัวกรอง (ค้นหา + หมวดสถานะของ NCR) ที่พับบนมือถือ
    const ncrStatus = ncrModule.centerStatusFilter(params);
    list += `${requestListFilters(params, { placeholder: "ค้นหาเลขที่ NCR สินค้า ลูกค้า หรือข้อบกพร่อง", statusSelect: ncrStatus.html, statusApplied: ncrStatus.applied })}${await ncrModule.renderCenterList(params)}`;
  }
  // data-module ครอบทั้งหน้าของโมดูล: หัวตาราง แท็บ และเลขที่ใบใช้จานสีของโมดูลนั้น
  const content = `<div data-module="${requestPalette(selected.code)}">${requestCenterHeader(types, params, null)}${requestsViewTabs(params, { board: selected.code !== "NCR_CAR" })}${list}</div>`;
  app.innerHTML = shell(content, "requests", "คำร้อง", requestTypeLabel(selected));
  bindShell();
  bindModuleZoom(params);
  bindRequestSearchForm(params);
}

function dynamicDetailFields(schema, values = {}) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  return fields.map((name) => {
    const dateField = name.includes("date");
    const numeric = name === "estimated_cost" || name === "odometer";
    return `<div class="field"><label for="detail-${escapeHtml(name)}">${escapeHtml(detailFieldLabels[name] ?? name)}</label><input class="input detail-field" id="detail-${escapeHtml(name)}" name="${escapeHtml(name)}" type="${dateField ? "date" : numeric ? "number" : "text"}" value="${escapeHtml(values[name] ?? "")}" maxlength="500"></div>`;
  }).join("");
}

// จานสีของประเภทที่ยังไม่มีโมดูลของตัวเอง (โมดูลที่เปิดใช้ประกาศ palette ใน modules/module-*.js) ค่าคือชื่อ data-module ใน styles.css
const requestTypePalettes = {
  IT_REPAIR: "it",
  VEHICLE_REPAIR: "pt",
  PURCHASE: "gr",
  IT_ACCESS: "qa",
  HR_LEAVE: "pk",
  HR_TRAINING: "ncr",
};
const requestTypeLabelOverrides = {
};

function requestTypeLabel(type) {
  return requestModule(type.code)?.label ?? requestTypeLabelOverrides[type.code] ?? type.name_th;
}

// ชื่อจานสี (ค่าของ data-module) ของประเภทนี้ — สี ตัวอักษร และพื้นผิวมาจาก styles.css ตามธีม ไม่มี style inline
function requestPalette(code) {
  return requestModule(code)?.palette ?? requestTypePalettes[code] ?? "it";
}

// ลายน้ำไอคอนประจำประเภทมุมล่างขวาของการ์ดและหัวโมดูล
function typeCardWatermarkHtml(code) {
  return `<span class="type-card-wm" aria-hidden="true">${requestTypeIcon(code)}</span>`;
}

// ไอคอนประเภทในป้ายของการ์ด + อักษรนำหน้าเลขที่ใบ (MT, NC …) ข้างไอคอนให้จำได้จากเลขที่เอกสาร
// prefix: false ในหัวโมดูลเมื่อชื่อโมดูลมีตัวย่ออยู่แล้ว ("ใบคำร้อง/แจ้งซ่อม MT") ไม่ขึ้น "MT" ซ้ำข้างกัน
function typeCardMarkHtml(type, { prefix = true } = {}) {
  return `<span class="type-card-mark"><span class="type-card-badge">${requestTypeIcon(type.code)}</span>${prefix && type.prefix ? `<span class="type-card-prefix">${escapeHtml(type.prefix)}</span>` : ""}</span>`;
}

function typeCardHtml(type) {
  return `
    <button type="button" class="type-card" data-type-id="${escapeHtml(type.id)}" data-module="${requestPalette(type.code)}">
      ${typeCardMarkHtml(type)}
      <span class="type-card-body"><strong>${escapeHtml(requestTypeLabel(type))}</strong><small>${escapeHtml(type.description ?? "")}</small><span class="type-card-action" aria-hidden="true">→</span></span>
      ${typeCardWatermarkHtml(type.code)}
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
    // ใบแจ้งซ่อม IT ใช้ฟอร์มของทีม IT เอง (ORIGINAL_FORM_TYPES) หัวจึงคงแบบเดิม ไม่ใช่ก้อนสีโมดูล
    const heading = selected && ORIGINAL_FORM_TYPES.has(selected.code)
      ? `<div class="page-heading"><div><h1>${escapeHtml(requestTypeLabel(selected))}</h1><p>${escapeHtml(selected.description || "กรอกรายละเอียดให้ครบถ้วน ระบบจะส่งเข้าสายอนุมัติให้อัตโนมัติ")}</p></div></div>`
      : selected
      ? `<div class="page-heading request-module-header" data-module="${requestPalette(selected.code)}"><div class="request-module-title">${typeCardMarkHtml(selected, { prefix: !selected.prefix || !requestTypeLabel(selected).includes(selected.prefix) })}<div><h1>${escapeHtml(requestTypeLabel(selected))}</h1><p>${escapeHtml(selected.description || "กรอกรายละเอียดให้ครบถ้วน ระบบจะส่งเข้าสายอนุมัติให้อัตโนมัติ")}</p></div></div></div>`
      : `<div class="page-heading"><div><h1>เลือกประเภทคำร้องที่จะสร้าง</h1></div></div>`;

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
      body = ORIGINAL_FORM_TYPES.has(selected.code)
        ? originalRequestFormHtml(selected, separateModule, formContext)
        : genericRequestFormHtml(selected, separateModule, formContext);
    }

    app.innerHTML = shell(`<a class="request-back-link" href="${escapeHtml(requestCenterUrl(params))}">‹ ${escapeHtml(selected ? requestTypeLabel(selected) : "คำร้อง")}</a>${heading}${body}`, "requests", "คำร้อง / สร้างคำร้อง");
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

    if (ORIGINAL_FORM_TYPES.has(selected.code)) bindOriginalRequestForm(selected, employee);
    else bindGenericRequestForm(selected, employee);
  }

  await paint();
}

// ประเภทที่ยังใช้ฟอร์มหน้าเดียวแบบเดิม (ไม่ใช่ฟอร์มทีละขั้น): ใบแจ้งซ่อม IT — ทีม IT ออกแบบ flow ของตัวเอง
// ใน repo work-order แล้วจะนำมา commit ใน MNP_SYSTEM ภายหลัง จึงไม่ปรับฟอร์มนี้จากฝั่งนี้
const ORIGINAL_FORM_TYPES = new Set(["IT_REPAIR"]);

function originalRequestFormHtml(selected, separateModule, formContext) {
  const detailFieldsHtml = separateModule?.renderFields ? separateModule.renderFields({ escapeHtml }) : dynamicDetailFields(selected.form_schema);
  return `
    <section class="card" style="max-width:900px;margin:auto"><div id="request-message" role="status"></div><form id="request-form">
      <div class="form-grid">
        <div class="field full">${docNumberBoxHtml("request-doc-number")}</div>
        <div class="field full"><label for="title">หัวข้อ${REQUIRED_MARK}</label><input class="input" id="title" name="title" minlength="3" maxlength="200" required></div>
        <div class="field full"><label for="description">รายละเอียด${REQUIRED_MARK}</label><textarea class="textarea" id="description" name="description" minlength="3" maxlength="5000" required></textarea></div>
        <div class="field full"><span class="field-label">ไฟล์แนบ (ถ้ามี)</span><label class="btn secondary file-pick" for="attachment" title="${escapeHtml(ATTACHMENT_HINT)}">${uiIcon("camera")} ถ่ายรูป / เลือกไฟล์</label><input class="file-pick-input" id="attachment" name="attachment" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx"><small>${ATTACHMENT_HINT_SHORT}</small></div>
        ${separateModule?.hidePriority ? "" : `<div class="field"><label for="priority">ความสำคัญ</label><select class="select" id="priority" name="priority"><option value="low">ต่ำ</option><option value="normal" selected>ปกติ</option><option value="high">สูง</option><option value="urgent">เร่งด่วน</option></select></div>
        <div></div>`}<div class="field full"><div class="form-grid">${detailFieldsHtml}</div></div>
      </div>
      ${separateModule?.renderFormSections ? separateModule.renderFormSections(formContext, { escapeHtml }) : ""}
      <div class="form-actions"><a class="btn secondary" href="#/requests">ยกเลิก</a><button class="btn" type="submit">ส่งคำร้อง</button></div>
    </form></section>`;
}

function bindOriginalRequestForm(selected, employee) {
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
        p_priority: values.get("priority") ?? "normal",
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
      const attachedNote = attachments.length > 1 ? ` ${attachments.length} ไฟล์` : "";
      showToast(attachments.length ? `สร้างคำร้องและแนบไฟล์${attachedNote}สำเร็จ` : "สร้างคำร้องสำเร็จ");
      go(`request?id=${encodeURIComponent(data)}`);
    } catch (submitError) {
      document.querySelector("#request-message").innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(submitError))}</div>`;
      setFormBusy(form, false);
    }
  });
}

// ฟอร์มคำร้องทั่วไปแบบทีละขั้น (ใบคำร้องถึงฝ่ายบริหาร และประเภทที่ใช้ form_schema) 3 ขั้นบนจอแคบ หน้าเดียวบนจอกว้าง
// ขั้น 1 เรื่องอะไร · ขั้น 2 ไฟล์แนบ ความสำคัญ และส่วนเพิ่มของโมดูล (เช่น สำเนาถึงแผนก) · ขั้น 3 ทบทวนก่อนส่ง
// ส่งไป app_create_request ด้วยช่องเดิมทุกช่อง — โครงเดียวกับฟอร์มแจ้งซ่อม MT (modules/form-steps.js)
function genericRequestFormHtml(selected, separateModule, formContext) {
  const detailFieldsHtml = separateModule?.renderFields ? separateModule.renderFields({ escapeHtml }) : dynamicDetailFields(selected.form_schema);
  const hidePriority = Boolean(separateModule?.hidePriority);
  const step2Title = separateModule?.stepTitles?.[2] ?? (hidePriority ? "ไฟล์แนบ" : "ไฟล์แนบและความสำคัญ");
  const priorityPicker = hidePriority ? "" : `<div class="field full">
      <span class="field-label" id="request-priority-label">ความสำคัญ</span>
      <input type="hidden" id="priority" name="priority" value="normal">
      <div class="filters" id="request-priority-picker" role="group" aria-labelledby="request-priority-label">${Object.entries(priorityLabels).map(([value, label]) => `<button type="button" class="filter${value === "normal" ? " active" : ""}" data-priority="${value}" aria-pressed="${value === "normal"}">${escapeHtml(label)}</button>`).join("")}</div>
    </div>`;
  return `
    <section class="card form-card" id="request-form-card"><div id="request-message" role="status"></div>
    <div class="draft-banner" id="request-draft" role="region" aria-label="ร่างที่ค้างอยู่" hidden></div>
    <form id="request-form" class="stepped-form" novalidate>
      ${window.MNP_FORM_STEPS.headHtml()}
      <fieldset class="form-step" data-step="1">
        <legend class="form-step-title">เรื่องอะไร</legend>
        <div class="field full">${docNumberBoxHtml("request-doc-number")}</div>
        <div class="field full" data-field="title"><label for="title">หัวข้อ <span class="field-required">(จำเป็น)</span></label><input class="input" id="title" name="title" maxlength="200" autocomplete="off"></div>
        <div class="field full" data-field="description"><label for="description">รายละเอียด <span class="field-required">(จำเป็น)</span></label><textarea class="textarea" id="description" name="description" maxlength="5000" rows="4"></textarea></div>
        ${detailFieldsHtml ? `<div class="form-grid">${detailFieldsHtml}</div>` : ""}
      </fieldset>
      <fieldset class="form-step" data-step="2">
        <legend class="form-step-title">${escapeHtml(step2Title)}</legend>
        <div class="field full">
          <span class="field-label">ไฟล์แนบ (ถ้ามี)</span>
          <label class="btn secondary file-pick" for="attachment" title="${escapeHtml(ATTACHMENT_HINT)}">${uiIcon("camera")} ถ่ายรูป / เลือกไฟล์</label>
          <input class="file-pick-input" id="attachment" name="attachment" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx">
          <small>${ATTACHMENT_HINT_SHORT}</small>
        </div>
        ${priorityPicker}
        ${separateModule?.renderFormSections ? separateModule.renderFormSections(formContext, { escapeHtml }) : ""}
      </fieldset>
      <fieldset class="form-step form-step-review" data-step="3">
        <legend class="form-step-title">ทบทวนก่อนส่ง</legend>
        <div id="request-review"></div>
      </fieldset>
      ${window.MNP_FORM_STEPS.actionsHtml({ cancelHref: "#/requests", submitLabel: "ส่งคำร้อง" })}
    </form></section>`;
}

function bindGenericRequestForm(selected, employee) {
  const form = document.querySelector("#request-form");
  const card = document.querySelector("#request-form-card");
  const stepsApi = window.MNP_FORM_STEPS;
  const draftApi = window.MNP_FORM_DRAFT;
  const titleInput = form.querySelector("#title");
  const descriptionInput = form.querySelector("#description");
  const priorityInput = form.querySelector("#priority");
  const attachmentInput = form.querySelector("#attachment");
  const detailInputs = () => [...form.querySelectorAll(".detail-field")];
  const ccBoxes = () => [...form.querySelectorAll(".cc-department-checkbox")];
  let submitted = false;
  // ชื่อช่องเฉพาะของโมดูลสำหรับขั้นทบทวน — อ่านก่อน enhance เพราะตัวเลือกวันที่ย้าย label ไปที่ปุ่มของมัน
  const detailLabels = new Map(detailInputs().map((input) => [input, input.labels?.[0]?.textContent.trim() || input.name]));
  form.querySelectorAll('input[type="date"]').forEach((input) => window.MNP_DATE_PICKER?.enhance(input));

  const RULES = [
    { name: "title", step: 1, required: true, minLength: 3, message: "กรุณาใส่หัวข้อ อย่างน้อย 3 ตัวอักษร" },
    { name: "description", step: 1, required: true, minLength: 3, message: "กรุณาอธิบายรายละเอียด อย่างน้อย 3 ตัวอักษร" },
  ];
  // ค่าในฟอร์ม (ใช้ทั้งตรวจช่องและเก็บร่าง) — ช่องเฉพาะของโมดูลเก็บเป็น detail.<ชื่อช่อง>
  const currentValues = () => ({
    title: titleInput.value,
    description: descriptionInput.value,
    priority: priorityInput?.value ?? "",
    cc_department_ids: ccBoxes().filter((box) => box.checked).map((box) => box.value),
    ...Object.fromEntries(detailInputs().map((input) => [`detail.${input.name}`, input.value])),
  });

  const selectPriority = (value) => {
    if (!priorityInput || !Object.hasOwn(priorityLabels, value)) return;
    priorityInput.value = value;
    form.querySelectorAll("#request-priority-picker [data-priority]").forEach((node) => {
      const active = node.dataset.priority === value;
      node.classList.toggle("active", active);
      node.setAttribute("aria-pressed", String(active));
    });
  };
  form.querySelectorAll("#request-priority-picker [data-priority]").forEach((button) => button.addEventListener("click", () => {
    selectPriority(button.dataset.priority);
    autosave.schedule();
  }));

  const renderReview = () => {
    // ช่องที่ไม่ได้กรอกไม่ขึ้นในหน้าทบทวน (ช่องจำเป็นผ่านการตรวจมาแล้วจึงมีค่าเสมอ)
    const row = (label, value, wide = false) => (value ? `<div class="definition${wide ? " wide" : ""}"><dt>${escapeHtml(label)}</dt><dd${wide ? ' class="review-text"' : ""}>${escapeHtml(value)}</dd></div>` : "");
    // ช่องเฉพาะของโมดูล: ชื่อจาก label ของช่องนั้น (ช่อง "อื่นๆ" ของสำเนาถึงแผนกรวมไว้ในแถวสำเนา)
    const detailRows = detailInputs().filter((input) => !input.closest(".cc-department-field"))
      .map((input) => row(detailLabels.get(input) ?? input.name, input.type === "date" && input.value ? window.MNP_DATE_PICKER.label(input.value) : input.value.trim()));
    const ccField = form.querySelector(".cc-department-field");
    const ccNames = ccField ? [
      ...ccBoxes().filter((box) => box.checked).map((box) => box.closest("label")?.textContent.trim() ?? ""),
      ccField.querySelector('[name="cc_other_note"]')?.value.trim() ?? "",
    ].filter(Boolean) : [];
    const files = [...(attachmentInput.files ?? [])];
    form.querySelector("#request-review").innerHTML = `<dl class="definition-grid review-grid">
        ${row("หัวข้อ", titleInput.value.trim(), true)}
        ${priorityInput ? row("ความสำคัญ", priorityLabels[priorityInput.value] ?? priorityInput.value) : ""}
        ${detailRows.join("")}
        ${ccField ? row("สำเนาถึงแผนก", ccNames.join(", ") || "ไม่มี") : ""}
        ${row("ไฟล์แนบ", files.length ? `${files.length} ไฟล์` : "ไม่มี")}
        ${row("รายละเอียด", descriptionInput.value.trim(), true)}
      </dl>
      <p class="muted small">ตรวจแล้วกดส่ง หรือย้อนกลับไปแก้</p>`;
  };

  // ---- ร่างบนเครื่อง (ต่อประเภท ต่อผู้ใช้) ----
  const drafts = draftApi.createDraftStore({ key: draftApi.draftKey(selected.code, employee.id), ignoreForEmpty: ["priority"] });
  const autosave = draftApi.createAutosave({ store: drafts, values: currentValues });
  form.addEventListener("input", () => autosave.schedule());
  form.addEventListener("change", () => autosave.schedule());
  const restoreDraft = (values) => {
    titleInput.value = values.title ?? "";
    descriptionInput.value = values.description ?? "";
    selectPriority(values.priority);
    const ccIds = new Set(Array.isArray(values.cc_department_ids) ? values.cc_department_ids : []);
    ccBoxes().forEach((box) => { box.checked = ccIds.has(box.value); });
    detailInputs().forEach((input) => {
      const value = values[`detail.${input.name}`];
      if (typeof value === "string") input.value = value;
      if (input.type === "date") input.dispatchEvent(new Event("datepicker:refresh"));
    });
  };
  const draft = drafts.load();
  let draftPending = Boolean(draft);
  if (draft) {
    autosave.stop();
    draftApi.offerDraft({
      banner: document.querySelector("#request-draft"),
      message: `มีร่าง${requestTypeLabel(selected)}ค้างจาก ${formatDate(new Date(draft.savedAt).toISOString(), true)}`,
      onUse: () => { draftPending = false; autosave.start(); restoreDraft(draft.values); titleInput.focus(); },
      onDiscard: () => { draftPending = false; autosave.start(); drafts.clear(); focusFirstStep(form); },
      // กรอกเองโดยไม่ตอบแถบ = เริ่มใบใหม่ ร่างเดิมถูกแทนด้วยสิ่งที่กรอก
      form,
      onEdit: () => { draftPending = false; autosave.start(); autosave.schedule(); },
      hasInput: () => !draftApi.isEmptyDraft(currentValues(), ["priority"]),
    });
  }

  bindFormCancel(form, {
    title: "ทิ้งคำร้องที่กรอกไว้?",
    isDirty: () => !submitted && !draftPending && (!draftApi.isEmptyDraft(currentValues(), ["priority"]) || Boolean(attachmentInput.files?.length)),
    onDiscard: () => { autosave.stop(); drafts.clear(); },
  });

  // ---- ส่ง ----
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#request-message");
    message.innerHTML = "";
    if (!stepper.check("all")) return;
    // อ่านค่าก่อน setFormBusy เสมอ — ช่องที่ถูก disable จะไม่อยู่ใน FormData
    const values = new FormData(form);
    let attachments;
    try {
      attachments = optionalAttachments(values.getAll("attachment"));
    } catch (attachmentError) {
      stepper.goTo(2, { focus: false });
      message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(attachmentError))}</div>`;
      attachmentInput.focus();
      return;
    }
    const details = {};
    detailInputs().forEach((input) => { if (input.value.trim()) details[input.name] = input.value.trim(); });
    const ccDepartmentIds = ccBoxes().filter((box) => box.checked).map((box) => box.value);
    setFormBusy(form, true);
    let requestId;
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
      if (!data) throw new Error("REQUEST_NOT_CREATED");
      requestId = data;
    } catch (submitError) {
      showFormSubmitError(form, message, submitError);
      return;
    }
    submitted = true;
    autosave.stop();
    drafts.clear();
    triggerNotificationEmails(requestId);
    const uploadWarning = await uploadAfterCreate(attachments, (file) => uploadRequestAttachment(requestId, file, employee.id), "แนบใหม่ได้ในหน้ารายละเอียด");
    // ใบเสร็จหลังส่ง: เลขที่และขั้นที่รอ แทนการเด้งไปหน้ารายละเอียดทันที
    const { requestNo, waitingOn } = await requestReceiptFacts(requestId);
    if (!card.isConnected) {
      showToast(requestNo ? `ส่งคำร้อง ${requestNo} แล้ว` : "ส่งคำร้องแล้ว");
      return;
    }
    window.MNP_FORM_STEPS.showReceipt(card, {
      title: "ส่งคำร้องแล้ว", number: requestNo, waitingOn, warning: uploadWarning,
      viewHref: `#/request?id=${encodeURIComponent(requestId)}`, viewLabel: "ดูคำร้อง",
      againLabel: "สร้างอีกใบ", onAgain: () => renderRoute(),
    });
  });

  const stepper = stepsApi.bindStepper({ form, count: 3, rules: RULES, values: currentValues, onReview: renderReview, scrollTarget: card });
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

// ไฟล์ที่คนเดียวกันแนบต่อเนื่องกัน (ห่างกันไม่เกิน 2 นาที เช่น เลือกหลายไฟล์ หรือแนบหลังกดพิจารณา) รวมเป็นเหตุการณ์เดียว
// ตรรกะเดียวกับ attachmentTimelineEvents ใน src/lib/request-timeline.ts
const ATTACHMENT_GROUP_GAP_MS = 120000;
function attachmentTimelineEvents(attachments, directory) {
  const ordered = [...attachments].sort((left, right) => left.created_at.localeCompare(right.created_at));
  const groups = [];
  for (const attachment of ordered) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (last && last.uploader_id === attachment.uploader_id && Date.parse(attachment.created_at) - Date.parse(last.created_at) <= ATTACHMENT_GROUP_GAP_MS) group.push(attachment);
    else groups.push([attachment]);
  }
  return groups.map((group) => {
    const uploader = personName(directory, group[0].uploader_id);
    return {
      id: `attachment-${group[0].id}`,
      at: group[0].created_at,
      title: "แนบไฟล์",
      detail: `${uploader === "—" ? "ผู้ใช้งาน" : uploader} แนบไฟล์ ${group.length} ไฟล์: ${group.map((attachment) => attachment.file_name).join(", ")}`,
      message: "",
    };
  });
}

function buildRequestTimeline(request, history, steps, verifications, directory, isRepair, dateChanges = [], attachments = [], replies = []) {
  const orderedSteps = [...steps].sort((left, right) => left.step_order - right.step_order);
  const labelOf = (status) => statusLabel(status, isRepair);

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
      // ผลการซ่อมอยู่บนหน้าแล้ว (ข้อมูลเพิ่มเติม หรือการ์ดตรวจรับ) ประวัติจึงบอกเฉพาะว่าใครส่งตรวจรับ ไม่ทวนซ้ำด้วยชื่อหัวข้ออีกชุด
      detail = `${actor || "ผู้รับผิดชอบ"} ซ่อมเสร็จสิ้น ส่งให้ผู้แจ้งตรวจรับ`;
    } else if (item.to_status === "completed" && item.from_status === "pending_verify") {
      detail = `${actor || "ผู้แจ้ง"} ตรวจรับผลการซ่อมแล้ว: ${verifyResultLabels[matchingVerification?.result] ?? "ผ่าน — ใช้งานได้ปกติ"}`;
      message = String(matchingVerification?.note ?? "").trim();
    } else if (item.to_status === "completed") {
      detail = `${actor || "ผู้รับผิดชอบ"} ปิดงานว่าเสร็จแล้ว`;
    } else {
      const fromLabel = labelOf(item.from_status);
      const toLabel = labelOf(item.to_status);
      detail = `${actor || "ผู้ใช้งาน"} เปลี่ยนสถานะจาก ${fromLabel} เป็น ${toLabel}`;
    }

    return {
      id: `status-${item.id}`,
      at: item.created_at,
      title: `${labelOf(item.to_status)}${stage && ["pending_approval", "more_info", "rejected"].includes(item.to_status) ? ` (${stage})` : ""}`,
      detail: message && message === note ? detail : appendTimelineNote(detail, note),
      message,
    };
  });

  // การอนุมัติขั้นกลางไม่เปลี่ยน requests.status จึงไม่มีแถวใน status history
  // เติมจาก approval_steps เพื่อให้ลำดับเหตุการณ์ไม่ขาดช่วงก่อนถึงผู้อนุมัติขั้นถัดไป (ทั้งอนุมัติและรับทราบข้อมูลที่ส่งต่อ)
  const approvalEvents = orderedSteps.flatMap((step, index) => {
    const nextStep = orderedSteps[index + 1];
    if (!["approved", "acknowledged"].includes(step.status) || !step.acted_at || !nextStep) return [];
    const actorName = personName(directory, step.acted_by);
    const verb = step.status === "acknowledged" ? "รับทราบข้อมูลขั้น" : "อนุมัติขั้น";
    return [{
      id: `approval-${step.id}`,
      at: step.acted_at,
      title: `รออนุมัติ (${nextStep.step_name})`,
      detail: `${actorName === "—" ? "ผู้อนุมัติ" : actorName} ${verb} ${step.step_name} แล้ว`,
      message: String(step.comment ?? "").trim(),
    }];
  });

  // คำตอบของผู้ยื่นต่อความเห็นของผู้อนุมัติ (request_comments.approval_step_id) ไม่เปลี่ยนสถานะ
  const replyEvents = replies.map((reply) => {
    const step = orderedSteps.find((item) => item.id === reply.approval_step_id);
    const authorName = personName(directory, reply.author_id);
    return {
      id: `reply-${reply.id}`,
      at: reply.created_at,
      title: `ตอบกลับความเห็น${step ? ` (${step.step_name})` : ""}`,
      detail: `${authorName === "—" ? "ผู้ยื่นคำร้อง" : authorName} ตอบกลับความเห็นของ ${step?.acted_by ? personName(directory, step.acted_by) : "ผู้อนุมัติ"}`,
      message: String(reply.body ?? "").trim(),
    };
  });

  // การแก้กำหนดเสร็จ (ปุ่มแก้วันที่ หรือแก้ไขการมอบหมาย) ไม่ใช่การเปลี่ยนสถานะ เก็บแยกไว้
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

  return [...statusEvents, ...approvalEvents, ...replyEvents, ...dateChangeEvents, ...attachmentTimelineEvents(attachments, directory)].sort((left, right) => left.at.localeCompare(right.at));
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

// มติที่ผู้ยื่นตอบกลับความเห็นได้ ("ขอข้อมูลเพิ่ม" ใช้การส่งข้อมูลกลับแทน)
const STEP_REPLY_STATUSES = ["approved", "acknowledged", "rejected"];

// การ์ดประวัติเอกสารชิ้นเดียวของทุกหน้ารายละเอียด (คำร้อง/MT และ NCR เรียกตัวนี้) เปิดไว้เสมอ: การตรวจย้อนว่าใครทำอะไรเมื่อไรคือเป้าหมายหลักของระบบ
// itemsHtml = แถว .timeline-item ที่เรียงเวลาแล้ว · footHtml = บรรทัดท้ายการ์ด (เช่น ขั้นอนุมัติที่ยังไม่ถึง)
function historyCardHtml(itemsHtml, footHtml = "") {
  return `<section class="card detail-history" aria-labelledby="detail-history-title"><h2 id="detail-history-title">ประวัติเอกสาร</h2><div class="timeline">${itemsHtml || '<div class="muted small">ยังไม่มีประวัติ</div>'}</div>${footHtml}</section>`;
}

// ฟอร์มตอบกลับความเห็นของขั้นที่ตัดสินแล้ว (ผู้ยื่น โมดูลที่เปิด requesterReplies) — ความเห็นและคำตอบเดิมอยู่ในประวัติเอกสาร
// heading: false ในส่วนที่พับ (หัวที่พับบอกชื่อขั้นแล้ว) · optional: การ์ดมีงานบังคับอื่นด้วย จึงบอกว่าฟอร์มนี้ไม่บังคับ
function stepReplyFormHtml(step, directory, { heading = true, optional = false, short = false } = {}) {
  const by = step.acted_by ? personName(directory, step.acted_by) : "";
  return `<div class="detail-action">${heading ? `<h3>${short ? "ขั้น" : "ตอบกลับความเห็นขั้น"} ${escapeHtml(step.step_name)}${optional ? " (ถ้าต้องการ)" : ""}</h3>` : ""}<blockquote class="detail-action-quote">${escapeHtml(String(step.comment ?? "").trim())}${by ? `<cite>${escapeHtml(by)}</cite>` : ""}</blockquote><form class="step-reply-form" id="step-reply-form-${escapeHtml(step.id)}" data-step-id="${escapeHtml(step.id)}" novalidate>
      <div class="field" data-field="message"><label for="step-reply-${escapeHtml(step.id)}">ข้อความตอบกลับ</label><textarea class="textarea" id="step-reply-${escapeHtml(step.id)}" name="message" maxlength="1000" required></textarea></div>
      <div class="form-actions"><button class="btn" type="submit">ส่งคำตอบ</button></div>
    </form></div>`;
}

async function renderRequestDetail(params) {
  activeDecisionCountdown?.flush();
  activeBulkCountdown?.flush();
  const id = params.get("id");
  if (!id) return renderNotFound("ไม่พบรหัสคำร้อง");
  loadingShell("requests", "รายละเอียดคำร้อง");
  const [requestResult, stepsResult, attachmentsResult, historyResult, verificationsResult, techniciansResult, progressResult, dateChangesResult, repliesResult, directory] = await Promise.all([
    sb.from("requests").select("*,request_type:request_types(name_th,code,uses_repair_workflow,owning_department_id),department:departments(code)").eq("id", id).maybeSingle(),
    sb.from("approval_steps").select("*").eq("request_id", id).order("step_order"),
    sb.from("request_attachments").select("*").eq("request_id", id).order("created_at"),
    sb.from("request_status_history").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("request_verifications").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("request_technicians").select("technician_id").eq("request_id", id),
    sb.from("request_progress_steps").select("*").eq("request_id", id).order("sort_order"),
    sb.from("request_expected_date_changes").select("*").eq("request_id", id).order("created_at"),
    // คำตอบของผู้ยื่นต่อความเห็นผู้อนุมัติ (ความเห็นทั่วไปที่ไม่ผูกขั้นไม่มีหน้าไหนแสดง)
    sb.from("request_comments").select("id,approval_step_id,author_id,body,created_at").eq("request_id", id).not("approval_step_id", "is", null).order("created_at"),
    loadEmployeeDirectory(),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (!requestResult.data || !deptModuleAllowed(relation(requestResult.data.request_type)?.code)) return renderNotFound("ไม่พบคำร้อง หรือคุณไม่มีสิทธิ์เข้าถึง");
  for (const result of [stepsResult, attachmentsResult, historyResult, verificationsResult, techniciansResult, progressResult, dateChangesResult]) if (result.error) throw result.error;
  // คำตอบเป็นส่วนเสริม: โหลดไม่ได้ (เช่น ฐานข้อมูลยังไม่ได้ deploy 20261014100000) ต้องไม่ทำให้หน้าคำร้องพัง
  // และซ่อนฟอร์มตอบกลับไว้จนกว่าจะโหลดได้
  const repliesAvailable = !repliesResult.error;
  if (repliesResult.error) console.warn("โหลดคำตอบของผู้ยื่นไม่สำเร็จ", repliesResult.error);
  const request = requestResult.data;
  const type = relation(request.request_type);
  const isRepair = isRepairType(type);
  const steps = stepsResult.data ?? [];
  const attachments = attachmentsResult.data ?? [];
  const history = historyResult.data ?? [];
  const verifications = verificationsResult.data ?? [];
  const replies = repliesResult.data ?? [];
  const timeline = buildRequestTimeline(request, history, steps, verifications, directory, isRepair, dateChangesResult.data ?? [], attachments, replies);
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
    ? separateModule.detailView({ request, type, steps, verifications, history, directory, progressSteps, assignedTechIds, employee })
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
      window.MNP_REQUEST_APPROVAL.roleMatches(currentStep, type?.code, employee)
      && Boolean(type?.code) && employee.approvalModules.has(type.code)
    ));
  // โมดูลที่จบที่มติ (endsAtDecision เช่น ใบคำร้องถึงฝ่ายบริหาร) ไม่มีขั้นรับงาน ต้องตรงกับ app_update_request_status
  // ใบเก่าที่เคยถูกรับงานไปแล้ว (in_progress) ยังปิดงานได้ ไม่ค้าง
  const canOperate = !isRepair && (isAdmin || OPERATE_ROLE_CODES.includes(employee.role?.code)) && ["approved", "in_progress"].includes(request.status)
    && !(separateModule?.endsAtDecision && request.status === "approved");
  const isRequester = request.requester_id === employee.id;
  // ผู้ยื่นตอบกลับความเห็นของขั้นที่ตัดสินแล้วได้ทุกมติ (โมดูลที่เปิด requesterReplies) — ตรงกับ app_reply_to_step_comment
  const canReplyToStep = (step) => repliesAvailable && isRequester && Boolean(separateModule?.requesterReplies)
    && STEP_REPLY_STATUSES.includes(step.status) && Boolean(String(step.comment ?? "").trim());
  // การ์ด "สิ่งที่คุณต้องดำเนินการ": งานของโมดูล (detailView.actionHtml) และฟอร์มตอบกลับความเห็นของขั้นที่ตัดสินแล้ว
  // ฟอร์มตอบกลับความเห็นเป็นทางเลือก (ใบอาจจบแล้ว): การ์ดที่มีแค่ฟอร์มนี้ใช้หัว "ตอบกลับความเห็น (ถ้าต้องการ)" ไม่ใช่ "สิ่งที่คุณต้องดำเนินการ"
  // ขั้นที่ผู้ยื่นตอบไปแล้ว (คำตอบอยู่ในประวัติเอกสาร) พับฟอร์มไว้เป็น "ตอบเพิ่มเติม" ยังตอบได้อีกเหมือนเดิม
  const moduleWorkHtml = (detailView?.actionHtml ?? "").trim();
  const replyWorkHtml = [...steps].sort((a, b) => a.step_order - b.step_order).filter(canReplyToStep).map((step) => (replies.some((reply) => reply.approval_step_id === step.id)
    ? `<details class="detail-reply-more"><summary>ตอบเพิ่มเติมถึงขั้น ${escapeHtml(step.step_name)}${moduleWorkHtml ? " (ถ้าต้องการ)" : ""}</summary>${stepReplyFormHtml(step, directory, { heading: false })}</details>`
    : stepReplyFormHtml(step, directory, { optional: Boolean(moduleWorkHtml), short: !moduleWorkHtml }))).join("");
  const actionWorkHtml = `${moduleWorkHtml}${replyWorkHtml}`.trim();
  const actionWorkTitle = moduleWorkHtml ? "สิ่งที่คุณต้องดำเนินการ" : "ตอบกลับความเห็น (ถ้าต้องการ)";
  const detailEntries = Object.entries(request.details ?? {});
  // ความสำคัญสูง/ด่วนขึ้นเป็นจุดในบรรทัดข้อมูลใต้หัวเรื่องแล้ว จึงไม่ซ้ำในช่องข้อมูล
  // ป้าย "ด่วน" ในบรรทัดหัวใบ: ความสำคัญสูง/เร่งด่วน หรือใบแจ้งซ่อมที่ติ๊กแจ้งด่วน (ที่เดียวในหน้า)
  const priorityIsFlagged = ["high", "urgent"].includes(request.priority) || Boolean(request.is_urgent);
  const requestFacts = [
    priorityIsFlagged || !request.priority || request.priority === "normal" ? "" : requestFact("ความสำคัญ", priorityLabel(request.priority, isRepair), {
      icon: "flag",
      tone: "primary",
      valueClass: `priority-${request.priority}`,
    }),
    ...(detailView?.facts ?? [
      requestFact("ผู้รับผิดชอบ", personName(directory, request.assignee_id), { icon: "user", tone: "success", wide: false }),
    ]),
    ...detailEntries.map(([key, value]) => requestFact(detailFieldLabels[key] ?? key, value, {
      icon: "info",
      tone: "primary",
      wide: String(value ?? "").length > 36,
    })),
    ...(moduleDetail?.facts ?? []).map((fact) => requestFact(fact.label, fact.value, fact.options)),
  ].join("");
  const formCode = REQUEST_FORM_CODES[type?.code] ?? "";
  const headerActionsHtml = detailView?.headerActionsHtml || moduleDetail?.headerActionsHtml || "";
  const nextStep = currentStep ? steps.find((step) => step.step_order === currentStep.step_order + 1) : null;
  // ไฟล์แนบและข้อมูลเพิ่มเติมเปิดไว้ทุกขนาดจอ (แถบตัดสินใจบนจอแคบติดล่างจออยู่แล้ว ไม่ถูกดันลง)
  // ขั้นอนุมัติที่ยังไม่ถึง (ท้ายการ์ดประวัติเอกสาร) — ขั้นปัจจุบันอยู่ที่ป้ายสถานะ/แถบตัดสินใจแล้ว
  const upcomingSteps = ["pending_approval", "more_info"].includes(request.status)
    ? [...steps].filter((step) => step.status === "pending" && step.step_order > request.current_step).sort((a, b) => a.step_order - b.step_order)
    : [];
  const receipt = recentDecisionFor(id);
  const description = (request.description ?? "").trim();
  // หัวใบเป็นก้อนสีโมดูล ยกเว้นใบแจ้งซ่อม IT ที่ใช้ฟอร์มของทีม IT เอง (ORIGINAL_FORM_TYPES)
  const moduleHead = !ORIGINAL_FORM_TYPES.has(type?.code);
  // ใบที่จบแล้ว (เสร็จ ไม่อนุมัติ ยกเลิก รับทราบ หรืออนุมัติที่เป็นปลายทางของโมดูล) ยังแนบไฟล์ได้ แต่บอกว่าเพิ่มหลังปิดใบ (ผู้ใช้เลือก 2026-11-12)
  const requestClosed = ["completed", "rejected", "cancelled", "acknowledged"].includes(request.status) || isFinalDecision(type, request.status);
  // รายละเอียดที่ผู้ขอแจ้ง: ผู้ที่ต้องกรอกงานของขั้น (มอบหมายช่าง บันทึกผล ตรวจรับ) อ่านได้ในการ์ดงานทันที
  const briefInAction = Boolean(moduleWorkHtml) && Boolean(description);
  const briefHeading = briefInAction ? "h3" : "h2";
  const briefBodyHtml = `<${briefHeading} class="request-brief-label" id="request-brief-title">รายละเอียดที่ผู้ขอแจ้ง</${briefHeading}>
          ${description
            ? `<p class="request-summary-text is-clamped" id="request-description">${escapeHtml(description)}</p><button type="button" class="link-button request-more" id="request-description-more" aria-controls="request-description" aria-expanded="false" hidden>อ่านต่อ</button>`
            : `<p class="request-summary-text is-empty">ไม่ได้ระบุรายละเอียด</p>`}`;
  const content = `
    <a class="request-back-link" href="#/requests${type?.id ? `?type=${encodeURIComponent(type.id)}` : ""}">‹ ${escapeHtml(type ? requestTypeLabel(type) : "คำร้อง")}</a>
    <header class="request-detail-head${moduleHead ? " request-module-header" : ""}${canApprove ? " has-step-line" : ""}"${moduleHead ? ` data-module="${requestPalette(type?.code)}"` : ""}>
      <div class="request-detail-kicker">
        <span class="eyebrow">${formCode ? `<span class="nowrap">${escapeHtml(formCode)}</span><span class="eyebrow-sep"> · </span>` : ""}<span class="nowrap">${escapeHtml(request.request_no)}</span></span>
        <div class="request-detail-kicker-end">${detailView?.statusBadgeHtml ?? pendingStepBadge(request, currentStep, isRepair, isFinalDecision(type, request.status))}${priorityIsFlagged ? `<span class="badge urgent-flag">${["high", "urgent"].includes(request.priority) ? `${isRepair ? "" : "ความสำคัญ"}${escapeHtml(priorityLabel(request.priority, isRepair))}` : "ด่วน"}</span>` : ""}${headerActionsHtml ? requestDetailMenuHtml(headerActionsHtml) : ""}</div>
      </div>
      <h1>${headingTextHtml(request.title)}</h1>
      <p class="request-detail-meta">${detailView?.typeLabel ? `${escapeHtml(detailView.typeLabel)} · ` : ""}โดย ${escapeHtml(personName(directory, request.requester_id))} · ${formatDate(request.submitted_at, true)}</p>
    </header>
    <div class="detail-grid">
      <div class="stack">
        ${receipt ? decisionReceiptHtml(receipt, directory) : ""}
        ${!moduleWorkHtml && !briefInAction ? `<section class="card request-brief" aria-labelledby="request-brief-title">${briefBodyHtml}</section>` : ""}
        ${actionWorkHtml ? `<section class="card detail-actions" aria-labelledby="detail-actions-title"><h2 id="detail-actions-title">${actionWorkTitle}</h2>${briefInAction ? `<div class="detail-actions-brief">${briefBodyHtml}</div>` : ""}${actionWorkHtml}</section>` : ""}
        ${briefInAction || !moduleWorkHtml ? "" : `<section class="card request-brief" aria-labelledby="request-brief-title">${briefBodyHtml}</section>`}
        ${request.status === "more_info" ? (() => {
          const moreInfoStep = steps.find((step) => step.status === "more_info");
          const requesterLabel = personName(directory, request.requester_id);
          const askedByLabel = moreInfoStep?.acted_by ? personName(directory, moreInfoStep.acted_by) : "—";
          return `<section class="card more-info-card">
            <h2>รอข้อมูลเพิ่มเติมจาก ${escapeHtml(requesterLabel)}</h2>
            <p class="muted small">${escapeHtml(askedByLabel)} ขอข้อมูลเพิ่มเติมในขั้นตอน "${escapeHtml(moreInfoStep?.step_name ?? "—")}"${moreInfoStep?.comment ? ` · ${escapeHtml(moreInfoStep.comment)}` : ""}</p>
            ${isRequester ? `<form id="resubmit-form">
              <div class="field"><label for="resubmit-comment">ข้อมูลเพิ่มเติม</label><textarea class="textarea" id="resubmit-comment" name="comment" maxlength="1000" placeholder="ระบุข้อมูลที่ขอเพิ่มเติม"></textarea></div>
              ${extraFilesFieldHtml("resubmit-files")}
              <div class="form-actions"><button class="btn" type="submit">ส่งข้อมูลกลับให้พิจารณาอีกครั้ง</button></div>
            </form>` : `<p class="muted small">มีเพียง ${escapeHtml(requesterLabel)} ผู้ยื่นคำร้องนี้เท่านั้นที่ตอบกลับได้</p>`}
          </section>`;
        })() : ""}
        ${detailView?.sectionsHtml ?? ""}
        <details class="card detail-section" id="request-attachments" open><summary><h2>ไฟล์แนบ${attachments.length ? ` <span class="detail-section-count">${attachments.length}</span>` : ""}</h2></summary>${attachmentGalleryHtml(attachments)}<form id="attachment-form"><div class="field"><span class="field-label">${requestClosed ? (attachments.length ? "แนบไฟล์เพิ่มหลังปิดใบ" : "แนบไฟล์หลังปิดใบ") : attachments.length ? "แนบไฟล์เพิ่ม" : "แนบไฟล์"}</span><label class="btn secondary file-pick" for="attachment-file" title="${escapeHtml(ATTACHMENT_HINT)}">${uiIcon("camera")} ถ่ายรูป / เลือกไฟล์</label><input class="file-pick-input" id="attachment-file" name="file" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx" title="${escapeHtml(ATTACHMENT_HINT)}"></div><button class="btn secondary attachment-upload" type="submit" disabled>อัปโหลด</button><p class="attachment-pending" role="status" hidden></p></form></details>
        ${requestFacts ? `<details class="card detail-section" open><summary><h2>ข้อมูลเพิ่มเติม</h2></summary><div class="request-facts">${requestFacts}</div></details>` : ""}
      </div>
      <aside class="stack">
        ${canApprove ? decisionPanelHtml({ request, currentStep, nextStep, extraDecisions: separateModule?.extraDecisions ?? [] }) : ""}
        ${canApprove ? "" : detailView?.asideHtml ?? ""}
        ${canOperate ? `<section class="card action-panel" id="operate-panel" aria-labelledby="operate-panel-title"><div class="action-panel-head"><h2 id="operate-panel-title">ดำเนินงาน</h2></div><details class="action-panel-files"><summary>แนบไฟล์ประกอบ (ถ้ามี)</summary>${extraFilesFieldHtml("status-files", "เลือกไฟล์", { hint: false })}</details><div class="action-panel-buttons">${request.status === "approved" ? `<button class="btn status-button" data-status="in_progress">รับงานและเริ่มดำเนินการ</button>` : `<button class="btn success status-button" data-status="completed">บันทึกว่าเสร็จแล้ว</button>`}</div></section>` : ""}
        ${receipt && !canApprove && !canOperate && !detailView?.asideHtml ? nextItemPanelHtml() : ""}
        ${historyCardHtml(timeline.map((item) => `<div class="timeline-item"><strong>${escapeHtml(item.title)}</strong><p class="timeline-item-detail">${escapeHtml(item.detail)}</p>${item.message ? `<p class="timeline-item-message">${escapeHtml(item.message)}</p>` : ""}<time class="timeline-item-time" datetime="${escapeHtml(item.at)}">${formatDate(item.at, true)}</time></div>`).join(""), upcomingSteps.length ? `<p class="detail-history-next">ขั้นอนุมัติที่ยังไม่ถึง: ${upcomingSteps.map((step) => escapeHtml(step.step_name)).join(" → ")}</p>` : "")}
      </aside>
    </div>`;
  // แถบบนบอกโมดูล (เลขที่ใบอยู่ที่หัวใบแล้ว ไม่ซ้ำบนจอเดียวกัน) ชื่อแท็บยังเป็นเลขที่ใบ
  app.innerHTML = shell(content, "requests", type ? requestTypeLabel(type) : "คำร้อง", request.request_no);
  bindShell();

  bindRequestDetailChrome();
  if (canApprove) bindDecisionPanel({ id, params, request, currentStep, nextStep, employee, extraDecisions: separateModule?.extraDecisions ?? [], requesterName: personName(directory, request.requester_id) });
  if (receipt && !canApprove && !canOperate) fillNextItemPanel(id);
  trackActionBarHeight();
  document.querySelector(".status-button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    let files;
    try { files = readExtraFiles(document.querySelector("#status-files")); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const { error } = await sb.rpc("app_update_request_status", { p_request_id: id, p_status: button.dataset.status });
      if (error) throw error;
      const warning = await uploadExtraFiles(id, files, employee.id);
      triggerNotificationEmails(id);
      showToast(warning || "อัปเดตสถานะแล้ว", warning ? "error" : "success");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); button.removeAttribute("aria-busy"); button.disabled = false; }
  });
  separateModule?.bindDetail?.({ id, params, employee, helpers: { showToast, friendlyError } });
  document.querySelector("#resubmit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    let files;
    try { files = readExtraFiles(form.elements.extra_files); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
    setFormBusy(form, true);
    const comment = form.elements.comment.value.trim();
    try {
      const { error } = await sb.rpc("app_resubmit_request", { p_request_id: id, p_comment: comment || null });
      if (error) throw error;
      const warning = await uploadExtraFiles(id, files, employee.id);
      triggerNotificationEmails(id);
      showToast(warning || "ส่งข้อมูลกลับให้พิจารณาอีกครั้งแล้ว", warning ? "error" : "success");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelectorAll(".step-reply-form").forEach((form) => form.elements.message?.addEventListener("input", () => window.MNP_FORM_STEPS.clearFieldError(form, "message")));
  document.querySelectorAll(".step-reply-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.elements.message.value.trim();
    if (!message) {
      window.MNP_FORM_STEPS.showFieldErrors(form, [{ name: "message", message: "พิมพ์ข้อความตอบกลับ" }]);
      return form.elements.message.focus();
    }
    setFormBusy(form, true);
    try {
      const { error } = await sb.rpc("app_reply_to_step_comment", { p_step_id: form.dataset.stepId, p_message: message });
      if (error) throw error;
      triggerNotificationEmails(id);
      showToast("ส่งคำตอบถึงผู้อนุมัติแล้ว", "success");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  }));
  // ช่างที่กำลังซ่อม: รูปใบเสร็จและไฟล์ส่งพร้อมฟอร์มจบงาน ("บันทึกข้อมูล" หรือ "เสร็จสิ้นงาน") ทางเดียว
  // ผู้แจ้งที่ตรวจรับ: ไฟล์ส่งพร้อมผลตรวจรับ ทางเดียว · ผู้มอบหมายช่าง: ไฟล์ส่งพร้อมการมอบหมาย ทางเดียว
  const stepFiles = document.querySelector("#finish-files") ?? document.querySelector("#verify-files") ?? document.querySelector("#assign-files");
  const stepFilesLabel = { "verify-files": "แนบไฟล์ในการ์ดตรวจรับงาน", "assign-files": "แนบไฟล์ในฟอร์มมอบหมายช่าง" }[stepFiles?.id] ?? "แนบรูปใบเสร็จและไฟล์ในฟอร์มเสร็จสิ้นงาน";
  pointToStepFiles(document.querySelector("#attachment-form"), stepFiles, stepFilesLabel);
  // ปุ่มอัปโหลดกดได้เมื่อเลือกไฟล์แล้ว (เดิมกดได้ทั้งที่ยังไม่เลือก แล้วขึ้นข้อความไกลจากปุ่ม)
  // รวมถึงตอนกด × ลบไฟล์ในตัวอย่าง หรือแปลงรูปไม่สำเร็จ (attachment-image.js ยิง mnp:files-changed)
  const attachmentFile = document.querySelector("#attachment-file");
  const syncUploadButton = () => {
    const count = attachmentFile?.files?.length ?? 0;
    const button = attachmentFile?.form?.querySelector(".attachment-upload");
    if (button) { button.disabled = !count; button.classList.toggle("secondary", !count); }
    const pending = attachmentFile?.form?.querySelector(".attachment-pending");
    if (pending) { pending.hidden = !count; pending.textContent = count ? `ยังไม่ได้อัปโหลด ${count} ไฟล์ · กดอัปโหลดก่อนออกจากหน้านี้` : ""; }
  };
  ["change", "mnp:files-changed"].forEach((type) => attachmentFile?.addEventListener(type, syncUploadButton));
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

// ---- หน้ารายละเอียดคำร้อง: ตัดสินใจก่อน (brief .impeccable/surfaces/src-app-app-requests-id-page-tsx.md) ----

// มติที่เพิ่งกดในแท็บนี้ เก็บไว้ทำใบเสร็จหลังวาดหน้าใหม่ (อยู่ในหน่วยความจำเท่านั้น รีเฟรชแล้วหาย ไทม์ไลน์ยังเป็นหลักฐานจริง)
const recentDecisions = new Map();
const RECEIPT_TTL_MS = 10 * 60 * 1000;
const DECISION_UNDO_SECONDS = 5;
// มติที่กำลังนับถอยหลังอยู่ (ถ้ามี) — วาดหน้าใหม่เมื่อไหร่ต้องส่งก่อน ไม่ให้ตัวนับของแถบเก่าค้างอยู่เบื้องหลัง
let activeDecisionCountdown = null;

function recentDecisionFor(requestId) {
  const entry = recentDecisions.get(requestId);
  // ใบเสร็จเป็นของคนที่กดเท่านั้น สลับผู้ใช้ในแท็บเดียวกันแล้วไม่เห็น
  if (!entry || entry.actorId !== state.employee?.id) return null;
  if (Date.now() - entry.at > RECEIPT_TTL_MS) {
    recentDecisions.delete(requestId);
    return null;
  }
  return entry;
}

function decisionReceiptHtml(receipt, directory) {
  const verb = receipt.label ?? decisionVerbs[receipt.decision] ?? "บันทึกผล";
  const tone = receipt.decision === "rejected" ? "danger" : receipt.decision === "more_info" ? "warning" : "success";
  return `<section class="card decision-receipt decision-receipt-${tone}" aria-labelledby="decision-receipt-title">
    <span class="decision-receipt-icon" aria-hidden="true">${uiIcon(receipt.decision === "rejected" ? "close" : "check")}</span>
    <div>
      <h2 id="decision-receipt-title">${escapeHtml(verb)}แล้ว</h2>
      <p>โดย ${escapeHtml(personName(directory, receipt.actorId))} · ${formatDate(new Date(receipt.at).toISOString(), true)}${receipt.nextStepName ? ` · ส่งต่อให้ ${escapeHtml(receipt.nextStepName)}` : ""}</p>
      ${receipt.comment ? `<p class="decision-receipt-comment">${escapeHtml(receipt.comment)}</p>` : ""}
    </div>
  </section>`;
}

function requestDetailMenuHtml(actionsHtml) {
  return `<div class="request-detail-menu">
    <button type="button" class="icon-button" id="request-detail-menu-button" aria-haspopup="true" aria-expanded="false" aria-controls="request-detail-menu-list" aria-label="ตัวเลือกเพิ่มเติม" title="ตัวเลือกเพิ่มเติม"><span aria-hidden="true">⋯</span></button>
    <div class="request-detail-menu-list" id="request-detail-menu-list" data-popup hidden>${actionsHtml}</div>
  </div>`;
}

// ปุ่มตัดสินใจ: ไม่อนุมัติ · ขอข้อมูลเพิ่ม · (มติเฉพาะโมดูล) · ปุ่มหลักขวาสุด ใต้นิ้วโป้ง
// ปุ่มหลักใช้คำของขั้นนั้น (รับทราบ/อนุมัติ ตามชื่อขั้น ดู modules/step-verb.js) แสดงบนหน้าจอเท่านั้น: มติที่ส่งยังเป็น "approved"
function decisionButtonsOf(extraDecisions, stepName = "") {
  const verb = window.MNP_STEP_VERB.verbOf(stepName, extraDecisions.map((item) => item.label));
  return [
    { decision: "rejected", label: "ไม่อนุมัติ", tone: "danger" },
    { decision: "more_info", label: "ขอข้อมูลเพิ่ม", tone: "warning" },
    ...extraDecisions.map((item) => ({ decision: item.decision, label: item.label, tone: "secondary" })),
    { decision: "approved", label: verb, tone: "success" },
  ];
}

// nextStepKnown: false เมื่อโหลดลำดับขั้นไม่ได้ ไม่บอกว่า "ขั้นสุดท้าย" ผิดความจริง
// ไม่มีขั้นอนุมัติถัดไปแต่งานยังเดินต่อ (ใบแจ้งซ่อม → มอบหมายช่าง, ใบทั่วไป → ดำเนินงาน) บอกขั้นนั้น "ขั้นสุดท้าย" ใช้เฉพาะใบที่จบที่มติ
// request: ใบที่แถบนี้ตัดสิน — ปุ่มมติอ้างถึงเลขที่และหัวข้อผ่าน aria-describedby ทุกหน้า
// และบนหน้าหลักจอแคบ (แถบลอยติดล่างจอ ห่างจากใบที่ขยาย) แสดงบรรทัดนี้ให้เห็นด้วย
function decisionPanelHtml({ request, currentStep, nextStep, extraDecisions, nextStepKnown = true }) {
  const type = relation(request.request_type);
  const afterLast = window.MNP_STEP_VERB.afterLastStep({ repair: isRepairType(type), endsAtDecision: Boolean(requestModule(type?.code)?.endsAtDecision) });
  const stepLine = window.MNP_STEP_VERB.stepLineText({ currentStepName: currentStep.step_name, nextStepName: nextStep?.step_name ?? null, nextStepKnown, afterLast });
  return `<section class="card action-panel decision-panel" id="decision-panel" data-state="idle" aria-labelledby="decision-panel-title">
    <div class="action-panel-head">
      <h2 id="decision-panel-title">พิจารณาคำร้อง</h2>
      <p class="muted small">${escapeHtml(stepLine)}</p>
    </div>
    <p class="decision-target" id="decision-target">${escapeHtml(`${request.request_no} · ${request.title}`)}</p>
    <p class="decision-line" id="decision-line" hidden></p>
    <div class="decision-reason" id="decision-reason" hidden>
      <div class="field">
        <label for="decision-comment" id="decision-comment-label">ความเห็น</label>
        <textarea class="textarea" id="decision-comment" maxlength="1000" rows="3" aria-describedby="decision-comment-error"></textarea>
        <p class="field-error" id="decision-comment-error" hidden></p>
      </div>
      <details class="action-panel-files"><summary>แนบไฟล์ประกอบ (ถ้ามี)</summary>${extraFilesFieldHtml("decision-files", "เลือกไฟล์", { hint: false })}</details>
    </div>
    <div class="action-panel-buttons" id="decision-buttons">${idleDecisionButtonsHtml(decisionButtonsOf(extraDecisions, currentStep.step_name))}</div>
  </section>`;
}

function idleDecisionButtonsHtml(options) {
  return options.map((item) => `<button type="button" class="btn ${item.tone} decision-button${item.decision === "approved" ? " is-primary" : ""}" data-decision="${escapeHtml(item.decision)}" aria-describedby="decision-target">${escapeHtml(item.label)}</button>`).join("");
}

function nextItemPanelHtml() {
  return `<section class="card action-panel next-item-panel" id="next-item-panel" aria-live="polite">
    <div class="action-panel-head"><h2>งานถัดไป</h2><p class="muted small" id="next-item-text">กำลังหางานที่รอคุณ…</p></div>
    <div class="action-panel-buttons"><a class="btn secondary" href="#/">กลับหน้าหลัก</a></div>
  </section>`;
}

// หลังตัดสิน: นับงานจากคิวเดียวกับ "ต้องจัดการ" ของหน้าหลัก
// ถ้าขั้นต่อไปของใบนี้เป็นของคนเดิม (เช่น ผู้อนุมัติขั้นนี้ถือขั้นถัดไปด้วย) แผงบอกขั้นนั้นและพาไปที่ฟอร์ม (ปุ่มรอง ปุ่มหลักคือปุ่มส่งของฟอร์มเอง)
async function fillNextItemPanel(currentId) {
  const panel = document.querySelector("#next-item-panel");
  if (!panel) return;
  try {
    const queue = await loadHomeQueueItems();
    if (!panel.isConnected) return;
    const text = panel.querySelector("#next-item-text");
    const heading = panel.querySelector("h2");
    const buttons = panel.querySelector(".action-panel-buttons");
    const followUp = queue.find((item) => item.id === currentId && item.kind !== "approval");
    const others = queue.filter((item) => item.id !== currentId);
    const next = others[0];
    const nextHref = next ? next.href ?? `#/request?id=${encodeURIComponent(next.id)}` : "";
    if (followUp) {
      const label = queueTaskLabel(followUp);
      heading.textContent = "ขั้นต่อไปเป็นของคุณ";
      text.textContent = others.length ? `${label} ในใบนี้ · ต้องจัดการอีก ${others.length} รายการ` : `${label} ในใบนี้`;
      buttons.innerHTML = `${next ? `<a class="btn secondary" href="${escapeHtml(nextHref)}">ใบถัดไป</a>` : ""}<button type="button" class="btn secondary" id="next-item-follow-up">${escapeHtml(label)} ↓</button>`;
      buttons.querySelector("#next-item-follow-up").addEventListener("click", () => {
        const task = { pending_assign: "#repair-assign", assigned: ".start-work-button", in_progress: "#finish-form", pending_verify: "#verify-note" }[followUp.request?.status];
        const target = (task ? document.querySelector(task)?.closest("section, details") : null) ?? document.querySelector(".detail-grid > .stack form")?.closest("section, details") ?? null;
        if (!target) return;
        if (target instanceof HTMLDetailsElement) target.open = true;
        target.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        target.querySelector("select, input:not([type=hidden]), textarea")?.focus({ preventScroll: true });
      });
      return;
    }
    if (!others.length) {
      text.textContent = "ไม่มีงานรอคุณแล้ว";
      buttons.innerHTML = `<a class="btn" href="#/">กลับหน้าหลัก</a>`;
      return;
    }
    text.textContent = `ต้องจัดการอีก ${others.length} รายการ · ถัดไป ${next.request.request_no} ${next.request.title}`;
    buttons.innerHTML = `<a class="btn secondary" href="#/">กลับหน้าหลัก</a><a class="btn is-primary" href="${escapeHtml(nextHref)}">ใบถัดไป</a>`;
  } catch {
    if (panel.isConnected) panel.querySelector("#next-item-text").textContent = "โหลดงานถัดไปไม่ได้";
  }
}

function bindRequestDetailChrome() {
  const description = document.querySelector("#request-description");
  const more = document.querySelector("#request-description-more");
  if (description && more) {
    // แสดง "อ่านต่อ" เฉพาะเมื่อข้อความยาวเกิน 6 บรรทัดจริง
    more.hidden = description.scrollHeight <= description.clientHeight + 2;
    more.addEventListener("click", () => {
      const expanded = description.classList.toggle("is-clamped") === false;
      more.setAttribute("aria-expanded", String(expanded));
      more.textContent = expanded ? "ย่อ" : "อ่านต่อ";
    });
  }
  const menuButton = document.querySelector("#request-detail-menu-button");
  const menuList = document.querySelector("#request-detail-menu-list");
  if (menuButton && menuList) {
    menuButton.addEventListener("click", () => {
      if (!menuList.hidden) return closePopup(menuList);
      menuList.hidden = false;
      menuButton.setAttribute("aria-expanded", "true");
      menuList.querySelector("button, a")?.focus();
    });
    menuList.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePopup(menuList);
      menuButton.focus();
    });
  }
}

// แถบตัดสินใจติดล่างจอบนมือถือ: บอกความสูงจริงให้ CSS เว้นที่ท้ายหน้า และยก toast ขึ้นเหนือแถบ
// ใช้ observer ตัวเดียวทั้งแอป ย้ายไปดูแถบที่มองเห็นอยู่ทุกครั้งที่เรียก ไม่สะสม observer
let actionBarObserver = null;
function trackActionBarHeight() {
  const bar = document.querySelector(".action-panel:not([hidden])");
  if (typeof ResizeObserver !== "function") return;
  actionBarObserver ??= new ResizeObserver((entries) => {
    const height = entries.at(-1)?.target.getBoundingClientRect().height ?? 0;
    if (height) document.documentElement.style.setProperty("--action-bar-h", `${Math.ceil(height)}px`);
  });
  actionBarObserver.disconnect();
  if (bar) actionBarObserver.observe(bar);
}

// ตัดข้อความยาวตามตัวอักษรที่เห็น (grapheme: พยัญชนะกับสระ/วรรณยุกต์นับเป็นหนึ่ง) ไม่ตัดวรรณยุกต์ทิ้งก่อน "…"
// เบราว์เซอร์ที่ไม่มี Intl.Segmenter ตัดตาม code point · ช่องว่างหลายตัว/ขึ้นบรรทัดรวมเป็นช่องเดียว (ใช้ในบรรทัดเดียว)
function clipText(text, max) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  const chars = typeof Intl.Segmenter === "function" ? Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(value), (part) => part.segment) : Array.from(value);
  if (chars.length <= max) return chars.join("");
  const kept = chars.slice(0, max - 1);
  while (kept.length && /^[เแโใไ]$/.test(kept.at(-1))) kept.pop();
  return `${kept.join("")}…`;
}

// การกระทำของขั้นที่เปลี่ยนสถานะใบในหน้าของใบ (เริ่มงาน เสร็จสิ้นงาน ตรวจรับ): ยืนยันหรือยกเลิก แล้วส่งทันที ไม่มีนับถอยหลังเลิกทำ
// (ผู้ใช้กำหนด 2026-11-10: "ไม่ต้องนับ 5 วิ กดยืนยันหรือปฏิเสธพอ" · คำที่ลงประวัติไม่เปลี่ยน RPC เดิม)
// area = กล่องปุ่มของการ์ด ปุ่มเดิมกลับมาเมื่อยกเลิกหรือส่งไม่สำเร็จ · consequence = ผลที่เกิดหลังส่ง · echo = ข้อความที่ผู้ใช้พิมพ์ (ทวนในบรรทัดยืนยัน)
// send({ stillHere }) เรียก RPC จริง คืน true เมื่อสำเร็จ false เมื่อไม่สำเร็จ · stillHere() = ยังอยู่หน้าเดิม (ไม่วาดใบเดิมทับหน้าใหม่)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- เรียกจาก modules/module-mt.js (global ของ classic script)
function confirmStepAction(area, { label, requestNo = "", consequence = "", tone = "success", echo = "", lock = [], trigger = null, send }) {
  const rules = window.MNP_REQUEST_DECISION;
  const original = [...area.childNodes];
  const tapGuard = rules.createTapGuard();
  // หน้าที่เริ่มการกระทำ: ส่งเสร็จหลังผู้ใช้ย้ายหน้าแล้ว ห้ามวาดใบเดิมทับหน้าใหม่ (send ได้ stillHere ไว้ตัดสิน)
  // ดูแค่ hash: ย้ายไปแล้วกลับมาใบเดิมก่อนส่งเสร็จ ก็วาดใบใหม่ให้เห็นสถานะหลังส่ง (วาดหน้าเดิมซ้ำไม่มีโทษ)
  const hash = location.hash;
  const stillHere = () => location.hash === hash;
  // ช่องที่ผู้ใช้กรอก (หมายเหตุ ไฟล์) ล็อกไว้ระหว่างยืนยันและส่ง สิ่งที่ส่งจึงตรงกับที่เห็นตอนกดยืนยัน
  const locked = lock.filter(Boolean).map((node) => [node, node.disabled]);
  const line = document.createElement("p");
  line.className = "decision-line";
  line.setAttribute("role", "status");
  const buttons = document.createElement("div");
  buttons.className = "approval-actions step-confirm";
  const primary = tone === "danger" ? "danger-solid is-primary" : "success is-primary";
  const button = (text, className, action) => `<button type="button" class="btn ${className}" data-step-action="${action}">${escapeHtml(text)}</button>`;
  let sending = false;
  // ปิดแท็บระหว่างกำลังส่ง: เตือนให้อยู่ต่อ (คำขอที่เริ่มตอนหน้ากำลังปิดอาจถูกยกเลิก)
  const warnBeforeUnload = (event) => { if (!sending) return; event.preventDefault(); event.returnValue = ""; };
  const restore = () => {
    window.removeEventListener("beforeunload", warnBeforeUnload);
    locked.forEach(([node, wasDisabled]) => { node.disabled = wasDisabled; });
    area.replaceChildren(...original);
    (trigger?.isConnected ? trigger : area.querySelector("button:not([disabled])"))?.focus();
  };
  const confirm = async () => {
    sending = true;
    window.addEventListener("beforeunload", warnBeforeUnload);
    line.textContent = `กำลังส่ง: ${label} ${requestNo}…`;
    buttons.innerHTML = '<button type="button" class="btn is-primary" disabled aria-busy="true">กำลังส่ง…</button>';
    let ok = false;
    try { ok = await send({ stillHere }); } catch { ok = false; }
    sending = false;
    if (!ok && area.isConnected) restore();
    else window.removeEventListener("beforeunload", warnBeforeUnload);
  };
  buttons.addEventListener("click", (event) => {
    const action = event.target.closest("[data-step-action]")?.dataset.stepAction;
    if (!action || sending) return;
    // ราวกันแตะซ้ำเฉพาะปุ่มยืนยัน (ปุ่มโผล่ตรงที่นิ้วเพิ่งกด) · ยกเลิกตอบทันทีเสมอ
    if (action === "confirm" && tapGuard.blocks(event)) return;
    if (action === "cancel") restore();
    else if (action === "confirm") confirm();
  });
  // Esc = ยกเลิก (ระหว่างกำลังส่งไม่ทำอะไร)
  buttons.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || sending) return;
    event.preventDefault();
    restore();
  });
  locked.forEach(([node]) => { node.disabled = true; });
  area.replaceChildren(line, buttons);
  tapGuard.arm();
  line.textContent = `${label} ${requestNo}${consequence ? ` → ${consequence}` : ""}${echo ? ` · “${clipText(echo, 80)}”` : ""}`;
  buttons.innerHTML = `${button("ยกเลิก", "secondary", "cancel")}${button(`ยืนยัน${label}`, primary, "confirm")}`;
  buttons.querySelector('[data-step-action="confirm"]')?.focus();
}

// ขั้นของแถบตัดสินใจ: idle → compose (เลือกมติ กรอกเหตุผล) → pending (นับถอยหลังเลิกทำ) → sending → (สำเร็จ = วาดหน้าใหม่พร้อมใบเสร็จ | error)
// requesterName: ชื่อผู้แจ้ง ใช้บอกว่า "ขอข้อมูลเพิ่ม" จะส่งกลับให้ใคร
function bindDecisionPanel({ id, params, request, currentStep, nextStep, employee, extraDecisions, requesterName = "", onDecided = null }) {
  const rules = window.MNP_REQUEST_DECISION;
  const panel = document.querySelector("#decision-panel");
  if (!panel || !rules) return;
  const line = panel.querySelector("#decision-line");
  const reason = panel.querySelector("#decision-reason");
  const comment = panel.querySelector("#decision-comment");
  const commentLabel = panel.querySelector("#decision-comment-label");
  const commentError = panel.querySelector("#decision-comment-error");
  const buttons = panel.querySelector("#decision-buttons");
  const options = decisionButtonsOf(extraDecisions, currentStep.step_name);
  // ปุ่มยืนยัน/ส่งเลยโผล่ตรงที่นิ้วเพิ่งกดปุ่มมติ: ไม่รับการแตะซ้ำทันที (modules/request-decision.js createTapGuard)
  const tapGuard = rules.createTapGuard();
  const labelOf = (decision) => options.find((item) => item.decision === decision)?.label ?? decisionVerbs[decision] ?? decision;
  const toneOf = (decision) => options.find((item) => item.decision === decision)?.tone ?? "secondary";
  // มติเพิ่มของโมดูล (เช่น รับทราบ) มีโทนเทาเท่าปุ่มยกเลิก/เลิกทำ ปุ่มหลักของมันจึงใช้สีแบรนด์ให้แยกออกจากปุ่มรอง
  const decisionButtonClass = (decision) => {
    if (decision === "rejected") return "danger-solid is-primary";
    if (decision === "approved") return "success is-primary";
    const tone = toneOf(decision);
    return tone === "secondary" ? "is-primary" : `${tone} is-primary`;
  };
  const hash = location.hash;
  let state = { name: "idle" };
  let lastTrigger = null;

  const countdown = rules.createCountdown({
    seconds: DECISION_UNDO_SECONDS,
    // อัปเดตเฉพาะตัวเลขบนปุ่ม (ไม่อยู่ใน live region) ไม่ให้โปรแกรมอ่านหน้าจออ่านซ้ำทุกวินาที และไม่ทำให้ focus หลุด
    onTick: (secondsLeft) => {
      const undo = buttons.querySelector('[data-action="undo"]');
      if (undo) undo.textContent = `เลิกทำ (${secondsLeft})`;
    },
    onSend: (payload) => send(payload),
  });
  activeDecisionCountdown = countdown;

  const setLine = (text, kind = "") => {
    line.hidden = !text;
    line.textContent = text;
    line.className = `decision-line${kind ? ` is-${kind}` : ""}`;
    line.setAttribute("role", kind === "error" ? "alert" : "status");
  };
  const clearError = () => {
    commentError.hidden = true;
    commentError.textContent = "";
    comment.removeAttribute("aria-invalid");
  };
  const showError = (text) => {
    commentError.textContent = text;
    commentError.hidden = false;
    comment.setAttribute("aria-invalid", "true");
    comment.focus();
  };
  // ความเห็นและไฟล์ของมติหนึ่งต้องไม่ติดไปกับมติอื่น
  const resetInputs = () => {
    comment.value = "";
    const files = panel.querySelector("#decision-files");
    if (files) files.value = "";
    files?.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const button = (label, className, action, attrs = "") => `<button type="button" class="btn ${className}" data-action="${action}"${attrs}>${escapeHtml(label)}</button>`;

  function render() {
    panel.dataset.state = state.name;
    if (state.name === "idle") {
      setLine("");
      reason.hidden = true;
      buttons.innerHTML = idleDecisionButtonsHtml(options);
      return;
    }
    if (state.name === "compose") {
      tapGuard.arm();
      const { decision } = state;
      const needsComment = rules.needsComment(decision);
      setLine(`${labelOf(decision)}${onDecided ? ` ${request.request_no}` : ""}${rules.forwardsToNextStep(decision) && nextStep ? ` → ส่งต่อให้ ${nextStep.step_name}` : decision === "more_info" ? ` → ส่งกลับให้ ${requesterName || "ผู้แจ้ง"}` : ""}`);
      reason.hidden = !needsComment && !state.showComment;
      commentLabel.textContent = decision === "rejected" ? "เหตุผลที่ไม่อนุมัติ (จำเป็น)"
        : decision === "more_info" ? "ต้องการข้อมูลเพิ่มเรื่องอะไร (จำเป็น)"
        : needsComment ? "เหตุผล (จำเป็น)" : "ความเห็น (ถ้ามี)";
      buttons.innerHTML = `${button("ยกเลิก", "secondary", "cancel")}${!needsComment && !state.showComment ? button("เพิ่มความเห็น", "secondary", "add-comment") : ""}${button(`ยืนยัน${labelOf(decision)}`, decisionButtonClass(decision), "confirm")}`;
      return;
    }
    if (state.name === "pending") {
      tapGuard.arm();
      reason.hidden = true;
      setLine(`กำลังจะ${labelOf(state.decision)}${onDecided ? ` ${request.request_no}` : ""}${state.comment ? ` · “${clipText(state.comment, 80)}”` : ""}`);
      // "ส่งเลย" สีเดียวกับมติที่กำลังจะส่ง (ไม่อนุมัติเป็นสีแดง) ไม่ใช่สีน้ำเงินกลาง ๆ
      buttons.innerHTML = `${button(`เลิกทำ (${DECISION_UNDO_SECONDS})`, "secondary", "undo")}${button("ส่งเลย", decisionButtonClass(state.decision), "send-now")}`;
      return;
    }
    if (state.name === "sending") {
      reason.hidden = true;
      setLine(`กำลังส่ง: ${labelOf(state.decision)}${onDecided ? ` ${request.request_no}` : ""}…`);
      buttons.innerHTML = button("กำลังส่ง…", "is-primary", "none", ' disabled aria-busy="true"');
      return;
    }
    if (state.name === "error") {
      reason.hidden = true;
      setLine(`ส่งไม่สำเร็จ: ${state.message}`, "error");
      buttons.innerHTML = `${button("แก้ไข", "secondary", "edit")}${button("ลองอีกครั้ง", "is-primary", "retry")}`;
    }
  }

  function toIdle() {
    countdown.undo();
    detachLeaveGuards();
    clearError();
    resetInputs();
    state = { name: "idle" };
    render();
    buttons.querySelector(`[data-decision="${lastTrigger}"]`)?.focus();
  }

  function startCompose(decision) {
    lastTrigger = decision;
    clearError();
    resetInputs();
    state = { name: "compose", decision, showComment: false };
    render();
    if (rules.needsComment(decision)) comment.focus();
    else buttons.querySelector('[data-action="confirm"]')?.focus();
  }

  function confirm() {
    const { decision } = state;
    const result = rules.payloadFor({ decision, commentVisible: !reason.hidden, commentValue: comment.value });
    if (result.error) return showError(result.error);
    let files = [];
    if (!reason.hidden) {
      try { files = readExtraFiles(panel.querySelector("#decision-files")); } catch (fileError) { return showError(friendlyError(fileError)); }
    }
    clearError();
    hideToast();
    state = { name: "pending", decision, comment: result.comment, files };
    render();
    buttons.querySelector('[data-action="undo"]')?.focus();
    countdown.start({ decision, comment: result.comment, files });
    attachLeaveGuards();
  }

  function attachLeaveGuards() {
    window.addEventListener("hashchange", sendOnLeave);
    document.addEventListener("visibilitychange", sendWhenHidden);
    window.addEventListener("beforeunload", warnBeforeUnload);
  }
  function detachLeaveGuards() {
    window.removeEventListener("hashchange", sendOnLeave);
    document.removeEventListener("visibilitychange", sendWhenHidden);
    window.removeEventListener("beforeunload", warnBeforeUnload);
  }
  // ย้ายไปหน้าอื่นในแอปหรือสลับไปแอปอื่นระหว่างนับถอยหลัง = ตั้งใจส่ง ส่งทันที
  function sendOnLeave() { countdown.flush(); }
  function sendWhenHidden() { if (document.visibilityState === "hidden") countdown.flush(); }
  // ปิดแท็บ/รีเฟรช: คำขอที่เริ่มตอนหน้ากำลังปิดอาจถูกยกเลิก จึงถามให้ผู้ใช้อยู่ต่อแทนการส่งแบบไม่แน่นอน
  function warnBeforeUnload(event) {
    if (!countdown.pending && state.name !== "sending") return;
    event.preventDefault();
    event.returnValue = "";
  }

  async function send({ decision, comment: text, files }) {
    state = { name: "sending", decision, comment: text, files };
    if (panel.isConnected) render();
    try {
      const { error } = await sb.rpc("app_approval_decision", { p_step_id: currentStep.id, p_decision: decision, p_comment: text });
      if (error) throw error;
    } catch (error) {
      detachLeaveGuards();
      if (location.hash !== hash || !panel.isConnected) {
        showToast(`${labelOf(decision)} ${request.request_no} ไม่สำเร็จ: ${friendlyError(error)}`, "error");
        return;
      }
      state = { name: "error", decision, comment: text, files, message: friendlyError(error) };
      render();
      buttons.querySelector('[data-action="retry"]')?.focus();
      return;
    }
    // มติบันทึกแล้ว: จากนี้ข้อผิดพลาดใดๆ ต้องไม่ถูกบอกว่า "ไม่สำเร็จ"
    detachLeaveGuards();
    if (activeDecisionCountdown === countdown) activeDecisionCountdown = null;
    recentDecisions.set(id, { decision, label: labelOf(decision), comment: text, at: Date.now(), actorId: employee.id, requestNo: request.request_no, title: request.title, nextStepName: rules.forwardsToNextStep(decision) ? nextStep?.step_name ?? "" : "" });
    let warning = "";
    try { warning = await uploadExtraFiles(id, files, employee.id); } catch (uploadError) { warning = friendlyError(uploadError); }
    triggerNotificationEmails(id);
    if (warning) showToast(`${labelOf(decision)}แล้ว แต่แนบไฟล์ไม่สำเร็จ: ${warning}`, "error");
    if (location.hash !== hash) {
      if (!warning) showToast(`${labelOf(decision)} ${request.request_no} แล้ว`, "success");
      return;
    }
    try {
      // หน้าที่เรียกใช้แถบนี้ (หน้ารายละเอียด หรือคิวหน้าหลัก) วาดผลหลังตัดสินเอง
      await (onDecided ? onDecided({ decision, label: labelOf(decision) }) : renderRequestDetail(params));
    } catch {
      showToast(`${labelOf(decision)} ${request.request_no} แล้ว แต่โหลดหน้าใหม่ไม่ได้ กรุณารีเฟรช`, "error");
    }
  }

  buttons.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    if (target.dataset.decision) return startCompose(target.dataset.decision);
    const action = target.dataset.action;
    // ยืนยัน/ส่งเลยที่โผล่ใต้นิ้วเดิม: การแตะซ้ำทันทีไม่นับ (คีย์บอร์ดไม่ถูกหน่วง)
    if ((action === "confirm" || action === "send-now") && tapGuard.blocks(event)) return;
    if (action === "cancel") return toIdle();
    if (action === "add-comment") {
      state.showComment = true;
      render();
      return comment.focus();
    }
    if (action === "confirm") return confirm();
    if (action === "undo") {
      countdown.undo();
      detachLeaveGuards();
      state = { name: "compose", decision: state.decision, showComment: Boolean(comment.value.trim()) };
      render();
      return buttons.querySelector('[data-action="confirm"]')?.focus();
    }
    if (action === "send-now") return countdown.flush();
    if (action === "retry") {
      attachLeaveGuards();
      return send(state);
    }
    if (action === "edit") {
      state = { name: "compose", decision: state.decision, showComment: Boolean(comment.value.trim()) };
      render();
      return comment.focus();
    }
  });
  comment.addEventListener("input", () => { if (comment.value.trim().length >= rules.MIN_COMMENT_LENGTH) clearError(); });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (state.name === "compose") { event.preventDefault(); toIdle(); }
    else if (state.name === "pending") { event.preventDefault(); buttons.querySelector('[data-action="undo"]')?.click(); }
  });
}

// ขั้นที่เป็นของผู้ใช้เอง (ระบุตัว หรือบทบาท/แผนกตรง) ไม่รวมขั้นที่เห็นเพราะเป็น admin: admin อนุมัติแทนได้ทีละใบ
function isOwnApprovalStep(step) {
  const employee = state.employee;
  if (step.approver_employee_id && step.approver_employee_id === employee.id) return true;
  const code = relation(step.request.request_type)?.code;
  return Boolean(code) && employee.approvalModules.has(code) && window.MNP_REQUEST_APPROVAL.roleMatches(step, code, employee);
}

const BULK_APPROVE_LIMIT = 20;

// อนุมัติหลายรายการ: เรียก app_approval_decision ทีละขั้นเหมือนกดอนุมัติในหน้ารายละเอียด (ฐานข้อมูลตรวจสิทธิ์และขั้นปัจจุบันทุกครั้ง)
// ยืนยันและเลิกทำอยู่ในแถบล่าง (bindQueueBulk) ฟังก์ชันนี้ส่งอย่างเดียว ครั้งละไม่เกิน BULK_APPROVE_LIMIT รายการ
// คืนข้อความสรุปสำหรับ showToast (null = ไม่มีอะไรให้ส่ง)
// (ชีตสำรองของ MT/MG ซิงก์ตอนมีคนเปิดหน้ารายละเอียดเหมือนเดิม Supabase เป็นข้อมูลหลัก)
async function runBulkApprove(chosen) {
  if (!chosen.length || chosen.length > BULK_APPROVE_LIMIT) return null;
  const failed = [];
  let done = 0;
  for (const [index, step] of chosen.entries()) {
    const { error } = await sb.rpc("app_approval_decision", { p_step_id: step.id, p_decision: "approved", p_comment: "" });
    if (!error) {
      done += 1;
      recentDecisions.set(step.request.id, { decision: "approved", label: queueStepVerb(step), comment: "", at: Date.now(), actorId: state.employee.id, requestNo: step.request.request_no, title: step.request.title, nextStepName: "" });
      triggerNotificationEmails(step.request.id);
      continue;
    }
    failed.push({ step, error });
    // session หมดอายุ: รายการที่เหลือจะไม่สำเร็จเหมือนกัน หยุดแล้วนับเป็นไม่สำเร็จ
    if (/AUTH_REQUIRED|JWT/i.test(String(error.message ?? error.code ?? ""))) {
      failed.push(...chosen.slice(index + 1).map((rest) => ({ step: rest, error })));
      break;
    }
  }
  return failed.length
    ? [`อนุมัติแล้ว ${done} รายการ ไม่สำเร็จ ${failed.length} รายการ (${failed.map(({ step }) => step.request.request_no).join(", ")}): ${friendlyError(failed[0].error)}`, "error"]
    : [`อนุมัติแล้ว ${done} รายการ`];
}

// คีย์ลัด: กด / เพื่อไปที่ช่องค้นหาของหน้า (ไม่ทำงานขณะพิมพ์ในช่องกรอกหรือมีกล่องเปิดอยู่)
document.addEventListener("keydown", (event) => {
  // ปุ่ม / ที่ตำแหน่งเดิมเมื่อคีย์บอร์ดเป็นภาษาไทย (ส่ง "ฝ") ยังเปิดช่องค้นหาได้
  const slash = event.key === "/" || (event.code === "Slash" && !event.shiftKey && !/^[\x20-\x7e]$/.test(event.key));
  if (!slash || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
  if (document.querySelector("dialog[open], .attachment-lightbox, [data-popup]:not([hidden])")) return;
  const search = document.querySelector('#app [role="search"] input[type="search"]:not(:disabled)') ?? document.querySelector('#app [role="search"] input:not([type="hidden"]):not([type="checkbox"]):not(:disabled)');
  if (!search) return;
  event.preventDefault();
  // จอแคบ: ช่องค้นหาอยู่ในตัวกรองที่พับไว้ เปิดตัวกรองก่อนจึงโฟกัสได้
  if (!search.getClientRects().length) search.closest(".list-filters")?.querySelector('[data-list-filters-toggle][aria-expanded="false"]')?.click();
  search.focus();
  search.select?.();
});

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

// ---------- แจ้งเตือนบนเครื่อง (Web Push) ----------
// ผู้ใช้เปิดเองต่อเครื่องจากแผงบนหน้าการแจ้งเตือน เครื่องที่เปิดไว้ถูกบันทึกในฐานข้อมูลผ่าน RPC (ตาราง push_subscriptions
// ไม่เปิดให้หน้าเว็บอ่านตรง) แล้ว Edge Function notify-push ส่งทุกแถวที่เข้าระฆังไปยังเครื่องเหล่านั้น
// กติกาตัดสินสถานะของแผงอยู่ใน modules/push-notifications.js (ทดสอบแล้ว) ที่นี่เป็นส่วนที่แตะเบราว์เซอร์/Supabase
function pushEnvironment() {
  return {
    keyConfigured: Boolean(PUSH_PUBLIC_KEY),
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    ios: window.MNP_INSTALL_APP.isIos({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
    standalone: isStandaloneApp(),
    permission: "Notification" in window ? Notification.permission : "default",
  };
}

// รอได้ไม่เกินเวลาที่กำหนด — ใช้กับขั้นที่เบราว์เซอร์อาจค้าง (service worker ยังไม่พร้อม, push service ไม่ตอบ)
// เพื่อให้ปุ่มที่ผู้ใช้กดไม่ค้างตลอดไป (ไม่ใช้กับหน้าต่างขออนุญาต เพราะผู้ใช้อาจใช้เวลาตัดสินใจ)
function withTimeout(promise, milliseconds, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const serviceWorkerReady = () => withTimeout(navigator.serviceWorker.ready, 8000, "SERVICE_WORKER_NOT_READY");

async function currentPushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// สถานะที่แผงต้องแสดง: "on" ต้องมีทั้งการสมัครในเครื่องและแถวในฐานข้อมูลที่เป็นของบัญชีนี้
async function loadPushState() {
  const environment = pushEnvironment();
  // โหมดทดสอบของ admin: ฐานข้อมูลไม่ให้เขียนตารางเครื่องที่รับแจ้งเตือน จึงไม่เสนอปุ่มที่ใช้ไม่ได้
  if (environment.keyConfigured && isSandboxMode()) return "sandbox";
  const basic = window.MNP_PUSH.pushPanelState(environment);
  if (basic !== "off" || environment.permission !== "granted") return basic;
  try {
    const subscription = await currentPushSubscription();
    if (subscription) {
      const { data, error } = await sb.rpc("app_is_push_subscribed", { p_endpoint: subscription.endpoint });
      if (!error && data === true) return window.MNP_PUSH.pushPanelState({ ...environment, subscribed: true });
    }
  } catch (error) {
    console.warn("ตรวจสถานะการแจ้งเตือนบนเครื่องนี้ไม่สำเร็จ", error);
  }
  return basic;
}

// subscription เดิมผูกกับกุญแจ VAPID ตัวที่ใช้ตอนสมัคร ถ้ากุญแจในแอปเปลี่ยน ต้องยกเลิกแล้วสมัครใหม่ (ทำได้เงียบ ๆ เมื่ออนุญาตแล้ว)
async function ensurePushSubscription(registration) {
  const key = window.MNP_PUSH.urlBase64ToUint8Array(PUSH_PUBLIC_KEY);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !window.MNP_PUSH.sameApplicationServerKey(subscription.options?.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  return subscription ?? await withTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 20000, "PUSH_SUBSCRIBE_TIMEOUT");
}

async function savePushSubscription(subscription) {
  const record = window.MNP_PUSH.subscriptionRecord(subscription.toJSON());
  if (!record) throw new Error("PUSH_SUBSCRIPTION_INCOMPLETE");
  const { error } = await sb.rpc("app_save_push_subscription", {
    p_endpoint: record.endpoint, p_p256dh: record.p256dh, p_auth: record.auth, p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
}

// คืน permission ที่ได้ ("granted" = เปิดสำเร็จ) — ต้องเรียกจากการกดปุ่มและขออนุญาตเป็นขั้นแรก เพราะ iOS/Safari
// ให้ขอสิทธิ์ได้เฉพาะในจังหวะที่ผู้ใช้กดเอง (await อื่นมาก่อนแล้วจะถือว่าไม่ใช่การกด)
async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const registration = await serviceWorkerReady();
  await savePushSubscription(await ensurePushSubscription(registration));
  return permission;
}

async function disablePush() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  const { error } = await sb.rpc("app_delete_push_subscription", { p_endpoint: subscription.endpoint });
  if (error) throw error;
  await subscription.unsubscribe();
}

// เปิดแอปทุกครั้ง (หนึ่งครั้งต่อบัญชีต่อการโหลดหน้า): ต่ออายุเครื่องที่ "เป็นของบัญชีนี้อยู่แล้ว" เท่านั้น
// (endpoint ของเบราว์เซอร์เปลี่ยนได้เอง หรือกุญแจ VAPID ในแอปเปลี่ยน) ห้ามย้ายเครื่องมาเป็นของบัญชีนี้โดยผู้ใช้ไม่ได้กดเอง —
// ไม่งั้นคนที่ล็อกอินต่อจากเจ้าของเดิมบนเครื่องเดียวกันจะได้รับแจ้งเตือนของตัวเองโดยไม่รู้ตัว (หรือกลับกัน)
// การย้ายข้ามบัญชีเกิดได้จากปุ่ม "เปิดการแจ้งเตือนบนเครื่องนี้" เท่านั้น เครื่องที่ไม่ใช่ของบัญชีนี้จึงถูกยกเลิกการสมัครในเครื่อง
let pushResyncedFor = null;
async function resyncPushSubscription() {
  const environment = pushEnvironment();
  if (!environment.keyConfigured || !environment.hasServiceWorker || !environment.hasPushManager || environment.permission !== "granted" || isSandboxMode()) return;
  try {
    const registration = await serviceWorkerReady();
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return;
    const { data: ownedByMe, error } = await sb.rpc("app_is_push_subscribed", { p_endpoint: existing.endpoint });
    // ถามไม่สำเร็จ (เน็ต/ระบบ) = ไม่รู้ว่าเป็นของใคร ปล่อยไว้ก่อน ไม่แตะอะไร
    if (error) return;
    if (ownedByMe !== true) {
      await existing.unsubscribe();
      return;
    }
    const refreshed = await ensurePushSubscription(registration);
    await savePushSubscription(refreshed);
    // สมัครใหม่เพราะกุญแจเปลี่ยน: แถวของ endpoint เดิมไม่มีประโยชน์แล้ว
    if (refreshed.endpoint !== existing.endpoint) await sb.rpc("app_delete_push_subscription", { p_endpoint: existing.endpoint });
  } catch (error) {
    console.warn("ต่ออายุการแจ้งเตือนบนเครื่องนี้ไม่สำเร็จ", error);
  }
}

// ออกจากระบบ: เอาเครื่องนี้ออกจากบัญชีเพื่อไม่ให้แจ้งเตือนของผู้ใช้คนเดิมไปโผล่ให้คนถัดไปที่ใช้เครื่องเดียวกัน
// server: true ลบแถวในฐานข้อมูลก่อน (ต้องยังมี session) — ทำไม่ได้ก็ยังยกเลิกการสมัครในเครื่อง ส่วนแถวค้างจะถูกลบเองเมื่อ push service ตอบว่าเครื่องนั้นหายไป
async function releasePushOnThisDevice({ server }) {
  if (!PUSH_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    if (server) await sb.rpc("app_delete_push_subscription", { p_endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  } catch (error) {
    console.warn("ยกเลิกการแจ้งเตือนบนเครื่องนี้ตอนออกจากระบบไม่สำเร็จ", error);
  }
}

// รอไม่เกิน 4 วินาที ไม่ให้เน็ตช้าทำให้ปุ่มออกจากระบบค้าง
function releasePushBeforeSignOut() {
  return Promise.race([releasePushOnThisDevice({ server: true }), new Promise((resolve) => setTimeout(resolve, 4000))]);
}

function pushPanelBodyHtml(pushState, ios) {
  const notice = {
    "ios-install": "บน iPhone/iPad เปิดการแจ้งเตือนได้เมื่อเปิดแอปจากไอคอนบนหน้าจอโฮมเท่านั้น (ต้องใช้ iOS 16.4 ขึ้นไป) — เพิ่ม MNP ลงหน้าจอโฮมจาก Safari ก่อน แล้วเปิดหน้านี้จากไอคอนนั้น",
    "ios-old": "iOS รุ่นนี้ยังไม่รองรับการแจ้งเตือนจากเว็บ (ต้องใช้ iOS 16.4 ขึ้นไป)",
    unsupported: "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนบนเครื่อง",
    sandbox: "ใช้ไม่ได้ขณะอยู่ในโหมดทดสอบ — ออกจากโหมดทดสอบก่อน",
    denied: ios
      ? "การแจ้งเตือนของ MNP ถูกปิดไว้ในเครื่อง — เปิดได้ที่ ตั้งค่า › แจ้งเตือน › MNP แล้วกลับมาโหลดหน้านี้ใหม่"
      : "เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้ — เปิดอนุญาตได้ที่ไอคอนข้างช่องที่อยู่เว็บ (สิทธิ์ของไซต์) แล้วโหลดหน้านี้ใหม่",
  }[pushState];
  // หัวข้อไม่ซ้ำกับข้อความบนปุ่ม ("เปิดการแจ้งเตือนบนเครื่องนี้" / "ปิดบนเครื่องนี้") สถานะบอกด้วยป้าย
  const badge = pushState === "on" ? ` <span class="badge">เปิดอยู่</span>` : pushState === "off" ? ` <span class="badge">ปิดอยู่</span>` : "";
  const text = `<div class="push-panel-text"><strong>แจ้งเตือนบนหน้าจอ${badge}</strong>${notice ? `<span>${notice}</span>` : ""}</div>`;
  if (pushState === "off") return `${text}<button class="btn" type="button" data-push-enable title="รับแจ้งเตือนที่หน้าจอเครื่องนี้ แม้ไม่ได้เปิดแอป">เปิดการแจ้งเตือนบนเครื่องนี้</button>`;
  if (pushState === "on") return `${text}<button class="btn secondary" type="button" data-push-disable>ปิดบนเครื่องนี้</button>`;
  return text;
}

function pushErrorMessage(error) {
  // ข้อผิดพลาดจากฐานข้อมูล (มีรหัสเป็นข้อความ) แปลงด้วยตารางกลาง ส่วนข้อผิดพลาดของเบราว์เซอร์/push service ใช้ข้อความรวม
  if (/SANDBOX_MODULE_UNSUPPORTED/.test(String(error?.message))) return "ตั้งค่าการแจ้งเตือนบนเครื่องไม่ได้ขณะอยู่ในโหมดทดสอบ";
  if (error?.message === "SERVICE_WORKER_NOT_READY") return "ระบบแจ้งเตือนของเครื่องนี้ยังไม่พร้อม กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้ง";
  return typeof error?.code === "string" ? friendlyError(error) : "เปิดการแจ้งเตือนบนเครื่องนี้ไม่สำเร็จ กรุณาลองอีกครั้ง";
}

async function refreshPushPanel() {
  const panel = document.querySelector("#push-panel");
  if (!panel) return;
  const pushState = await loadPushState();
  if (!panel.isConnected || pushState === "hidden") return;
  panel.innerHTML = pushPanelBodyHtml(pushState, pushEnvironment().ios);
  panel.hidden = false;
  const run = async (button, busyLabel, action) => {
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await action();
    } catch (error) {
      console.error(error);
      showToast(pushErrorMessage(error), "error");
    }
    await refreshPushPanel();
  };
  panel.querySelector("[data-push-enable]")?.addEventListener("click", (event) => run(event.currentTarget, "กำลังเปิด…", async () => {
    // กดแล้วไม่อนุญาต/ปิดหน้าต่างขอสิทธิ์ ไม่ใช่ข้อผิดพลาด แผงจะกลับไปสถานะเดิม (หรือ "ถูกบล็อก" ถ้าเลือกไม่อนุญาต)
    if ((await enablePush()) === "default") showToast("ยังไม่ได้อนุญาตการแจ้งเตือน", "error");
  }));
  panel.querySelector("[data-push-disable]")?.addEventListener("click", (event) => run(event.currentTarget, "กำลังปิด…", disablePush));
}

async function renderNotifications() {
  loadingShell("notifications", "การแจ้งเตือน");
  const { data: rows, error } = await sb.from("notifications").select("*").eq("recipient_id", state.employee.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const data = await departmentVisibleNotifications(rows ?? []);
  const content = `
    <div class="page-heading notifications-heading"><div><h1>การแจ้งเตือน</h1></div>${(data ?? []).some((item) => !item.read_at) ? `<button class="btn secondary" id="mark-read">ทำเครื่องหมายว่าอ่านแล้วทั้งหมด</button>` : ""}</div>
    ${PUSH_PUBLIC_KEY ? `<section class="card push-panel" id="push-panel" hidden></section>` : ""}
    <div class="stack">${(data ?? []).map(notificationItemHtml).join("") || emptyState("ยังไม่มีการแจ้งเตือน", { hint: "เมื่อคำร้องของคุณมีความเคลื่อนไหวจะแจ้งที่นี่" })}</div>`;
  app.innerHTML = shell(content, "notifications", "การแจ้งเตือน");
  bindShell();
  refreshPushPanel();
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
    <div class="page-heading"><div><h1>ข้อมูลส่วนตัว</h1></div></div>

    <section class="card" style="max-width:780px">
      <div id="profile-message" role="status"></div>
      <form id="profile-form">
        <div class="field-row">
          <div class="field"><label for="profile-first-name">ชื่อ${REQUIRED_MARK}</label><input class="input" id="profile-first-name" name="first_name" maxlength="100" value="${escapeHtml(employee.first_name)}" required></div>
          <div class="field"><label for="profile-last-name">นามสกุล${REQUIRED_MARK}</label><input class="input" id="profile-last-name" name="last_name" maxlength="100" value="${escapeHtml(employee.last_name)}" required></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="profile-email">อีเมล${REQUIRED_MARK}</label><input class="input" id="profile-email" name="email" type="email" maxlength="200" value="${escapeHtml(employee.email ?? "")}" required></div>
          <div class="field"><label for="profile-phone">เบอร์ติดต่อ (ถ้ามี)</label><input class="input" id="profile-phone" name="phone" maxlength="40" value="${escapeHtml(employee.phone ?? "")}"></div>
        </div>
        <div class="field"><label for="profile-job-title">ตำแหน่งที่แสดงใต้ชื่อ (ถ้ามี)</label><input class="input" id="profile-job-title" name="job_title" maxlength="120" value="${escapeHtml(employee.job_title ?? "")}" title="แสดงใต้ชื่อของคุณ ไม่มีผลกับสิทธิ์"></div>
        ${isAccountManager ? `
        <div class="field-row">
          <div class="field"><label for="profile-department">แผนก${REQUIRED_MARK}</label><select class="input" id="profile-department" name="department_id" required>${departments.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === employee.department_id ? " selected" : ""}>${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
          <div class="field"><label for="profile-role">ตำแหน่ง (กำหนดสิทธิ์)${REQUIRED_MARK}</label><select class="input" id="profile-role" name="role_id" required>${roles.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === employee.role_id ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
        </div>
        <small>ระบบไม่ยอมให้ถอดสิทธิ์ผู้ดูแลระบบของตนเอง เพื่อไม่ให้ไม่มีใครเข้าไปแก้ไขได้อีก</small>
        ` : `
        <div class="field-row">
          <div class="field"><label for="profile-department">แผนก</label><input class="input" id="profile-department" value="${escapeHtml(employee.department?.name_th ?? "—")}" disabled></div>
          <div class="field"><label for="profile-role">ตำแหน่ง (กำหนดสิทธิ์)</label><input class="input" id="profile-role" value="${escapeHtml(employee.role?.name_th ?? "—")}" disabled></div>
        </div>
        <small>สองช่องนี้เป็นตัวกำหนดสิทธิ์และเส้นทางอนุมัติ ต้องให้ผู้ดูแลระบบเป็นผู้แก้ให้</small>
        `}
        <div class="form-actions"><button class="btn" type="submit">บันทึกข้อมูล</button></div>
      </form>
    </section>

    <section class="card" style="max-width:780px">
      <h2>${isAccountManager ? "แก้ไขรหัสพนักงาน / รหัสผ่านของฉัน" : "ขอแก้ไขรหัสพนักงาน / รหัสผ่าน"}</h2>
      <p class="muted small">${isAccountManager
        ? "บันทึกและอนุมัติให้ทันที พร้อมเก็บประวัติ"
        : "ผู้ดูแลระบบอนุมัติก่อนจึงเปลี่ยน ระหว่างรอใช้รหัสผ่านเดิมได้"}</p>
      <div id="credential-message" role="status"></div>
      <form id="credential-form">
        <div class="field"><label for="new-employee-no">รหัสพนักงาน${REQUIRED_MARK}</label><input class="input" id="new-employee-no" name="employee_no" maxlength="32" value="${escapeHtml(employee.employee_no)}" required><small>คงเดิมไว้ได้หากเปลี่ยนเฉพาะรหัสผ่าน · ทุกคำขอต้องตั้งรหัสผ่านใหม่</small></div>
        <div class="field-row">
          <div class="field"><label for="new-password">รหัสผ่านใหม่${REQUIRED_MARK}</label><input class="input" id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
          <div class="field"><label for="confirm-new-password">ยืนยันรหัสผ่านใหม่${REQUIRED_MARK}</label><input class="input" id="confirm-new-password" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>
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
    showToast("ส่งคำร้องขอแก้ไขรหัสพนักงาน/รหัสผ่านแล้ว");
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

  showToast("แก้ไขรหัสพนักงาน/รหัสผ่านเรียบร้อย");
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
const SANDBOX_NCR_STEPS = ["ออกใบ", "พิจารณา", "ตอบ", "ติดตาม", "ลงนาม", "ยกเลิก", "ความสูญเสีย"];

function sandboxSectionHtml() {
  const status = state.sandbox;
  if (!status) {
    return `<section class="card sandbox-panel">
      <div class="sandbox-head"><h2>ทดสอบระบบ</h2></div>
      <div class="form-message error" role="alert">ยังใช้โหมดทดสอบไม่ได้ เพราะฐานข้อมูลยังไม่ได้อัปเดตเป็นรุ่นที่รองรับ (ต้อง <code>supabase db push</code> migration <code>20261005030000_admin_sandbox_mode</code> ก่อน)</div>
    </section>`;
  }
  const rows = (status.personas ?? []).map((persona) => {
    const name = persona.job_title ?? `${persona.first_name} ${persona.last_name}`;
    return `<tr>
      <td class="sandbox-who"><strong>${escapeHtml(name)}</strong><span class="request-no">${escapeHtml(persona.employee_no)}</span></td>
      <td class="sandbox-dept" data-label="แผนก"><span class="badge">${escapeHtml(persona.department?.code ?? "—")}</span></td>
      <td class="sandbox-role" data-label="ตำแหน่ง">${escapeHtml(persona.role?.name_th ?? persona.role?.code ?? "—")}</td>
      <td class="sandbox-act"><button class="btn small" type="button" data-sandbox-enter="${escapeHtml(persona.id)}" aria-label="เข้าโหมดทดสอบในฐานะ ${escapeHtml(name)}">เข้าโหมดทดสอบ</button></td>
    </tr>`;
  }).join("") || `<tr class="sandbox-empty"><td colspan="4">ยังไม่มีบัญชีทดสอบ</td></tr>`;
  return `<section class="card sandbox-panel">
    <div class="sandbox-head">
      <h2>ทดสอบระบบ</h2>
      <span class="badge">เฉพาะผู้ดูแลระบบ</span>
    </div>
    <p class="sandbox-lead">เลือกบัญชีทดสอบแล้วใช้งาน NCR ตามบทบาทนั้นได้ทุกขั้น สลับบทบาทได้จากแถบสีเหลืองด้านบนของทุกหน้า</p>
    <ol class="sandbox-flow" aria-label="ขั้นตอนของ NCR ที่ทดสอบได้">${SANDBOX_NCR_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    <div class="sandbox-notes">
      <section aria-labelledby="sandbox-safe-title">
        <h3 id="sandbox-safe-title">สิ่งที่แยกจากของจริง</h3>
        <ul>
          <li>เลขที่ขึ้นต้น <code>TEST-QA…</code> ไม่กินเลข QAxxx/yy จริง</li>
          <li>ผู้ใช้จริงมองไม่เห็นใบทดสอบ</li>
          <li>ไม่มีแจ้งเตือนหรืออีเมลถึงใครเลย</li>
        </ul>
      </section>
      <section aria-labelledby="sandbox-limit-title">
        <h3 id="sandbox-limit-title">ข้อจำกัดระหว่างทดสอบ</h3>
        <ul>
          <li>โมดูลอื่นเขียนข้อมูลไม่ได้ ต้องออกจากโหมดทดสอบก่อนทำงานจริง</li>
          <li>ยังไม่รองรับการแนบไฟล์</li>
          <li>บันทึกการเข้า/ออก/ล้างข้อมูลอยู่ใน audit log</li>
        </ul>
      </section>
    </div>
    <h3 class="sandbox-list-title">เลือกบัญชีทดสอบ</h3>
    <div class="table-wrap"><table class="sandbox-table">
      <thead><tr><th>บัญชีทดสอบ</th><th>แผนก</th><th>ตำแหน่ง</th><th><span class="sr-only">ดำเนินการ</span></th></tr></thead>
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
    ${noteLine("วันที่บันทึกไว้ ระบบไม่ส่งอีเมลเตือนงานค้าง", "<p>ระบบไม่ส่งอีเมลเตือนงานค้าง (08:30 และ 13:30 น.) และสำเนาถึงหัวหน้า (10:30 และ 15:30 น.) ในวันที่บันทึกไว้ที่นี่ วันอาทิตย์ข้ามให้อยู่แล้ว ไม่ต้องบันทึก บันทึกวันเดิมซ้ำจะเป็นการแก้ชื่อวันหยุด</p>", "วันหยุดกับอีเมลเตือน")}
    <form id="holiday-form" class="field-row">
      <div class="field"><label for="holiday-date">วันที่${REQUIRED_MARK}</label><input class="input" id="holiday-date" name="holiday_date" type="date" required></div>
      <div class="field"><label for="holiday-name">ชื่อวันหยุด${REQUIRED_MARK}</label><input class="input" id="holiday-name" name="name_th" maxlength="100" placeholder="เช่น วันปิยมหาราช" required></div>
      <div class="form-actions"><button class="btn" type="submit">บันทึกวันหยุด</button></div>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>วันที่</th><th>ชื่อวันหยุด</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function bindHolidayForms(params) {
  // วันที่วันหยุดใช้ปฏิทินไทยแบบเดียวกับทุกฟอร์ม · ช่องที่ถูกซ่อนตรวจค่าว่างเองตอนส่ง
  const holidayDate = document.querySelector("#holiday-date");
  if (holidayDate && window.MNP_DATE_PICKER) { holidayDate.required = false; window.MNP_DATE_PICKER.enhance(holidayDate); }
  document.querySelector("#holiday-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (!values.get("holiday_date")) return showToast("กรุณาเลือกวันที่", "error");
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
    if (!(await confirmDialog({ title: `ลบวันหยุด ${formatDate(date)}?`, message: "วันนั้นระบบจะกลับมาส่งอีเมลเตือนงานค้างตามปกติ", confirmLabel: "ลบวันหยุด", danger: true }))) return;
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
  // บัญชี master: ผู้ดูแลคนอื่นแก้/ดูรหัสผ่าน/ลบไม่ได้ (ฐานข้อมูลปฏิเสธด้วย MASTER_PROTECTED) จึงซ่อนปุ่มเหล่านั้น
  // อ่านคอลัมน์ไม่ได้ (ยังไม่ได้ apply migration 20261113010000) = ยังไม่มีบัญชี master
  const masterResult = await sb.from("employees").select("id").eq("is_master", true);
  const masterId = masterResult.error ? null : masterResult.data?.[0]?.id ?? null;
  const isProtectedMaster = (employeeId) => Boolean(masterId) && employeeId === masterId && !state.employee.isMaster;
  const masterBadge = (employeeId) => (masterId && employeeId === masterId ? ` <span class="badge">Master</span>` : "");
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
  const editing = credentials.find((item) => item.employee_id === params.get("edit") && !isProtectedMaster(item.employee_id)) ?? null;
  const adding = !editing && params.get("add") === "1";
  const req = REQUIRED_MARK;
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
        <div class="definition"><dt>ตำแหน่งที่แสดง</dt><dd>${escapeHtml(item.job_title ?? "—")}</dd></div>
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
    </article>`).join("") || emptyState("ยังไม่มีคำร้องเกี่ยวกับบัญชี");

  // ข้อมูลบัญชี: ข้อมูลเดียวกับ credentials (คลัง ID/รหัสผ่าน) แค่โชว์เป็นรายละเอียดโปรไฟล์
  // ต่อคนแทนตาราง — ไม่มีคอลัมน์รหัสผ่าน เพราะช่องนั้นยังอยู่ที่แท็บคลัง ID/รหัสผ่านเท่านั้น
  const accountCards = credentials.map((item) => {
    const isSelf = item.employee_id === state.employee.id;
    return `
    <article class="card">
      <div class="card-head">
        <div>
          <span class="request-no">${escapeHtml(item.employee_no)}</span>
          <h3>${escapeHtml(item.full_name)}${isSelf ? ` <span class="badge">บัญชีของคุณ</span>` : ""}${masterBadge(item.employee_id)}</h3>
          <p class="muted small">${escapeHtml(item.role_code ?? "—")}</p>
        </div>
        ${item.is_active ? "" : `<span class="badge rejected">ปิดใช้งาน</span>`}
      </div>
      <dl class="definition-grid">
        <div class="definition"><dt>แผนก</dt><dd>${escapeHtml(item.department_code ?? "—")}</dd></div>
        <div class="definition"><dt>ตำแหน่งที่แสดง</dt><dd>${escapeHtml(item.job_title ?? "—")}</dd></div>
        <div class="definition"><dt>ติดต่อ</dt><dd>${escapeHtml(item.phone ?? item.email ?? "—")}</dd></div>
        <div class="definition"><dt>ตำแหน่ง</dt><dd>${escapeHtml(item.role_code ?? "—")}</dd></div>
        <div class="definition"><dt>อัปเดตล่าสุด</dt><dd>${item.updated_at ? formatDate(item.updated_at, true) : "—"}${item.updated_by_name ? ` · โดย ${escapeHtml(item.updated_by_name)}` : ""}</dd></div>
      </dl>
      ${isProtectedMaster(item.employee_id) ? "" : `<div class="approval-actions"><a class="btn secondary small" href="#/admin?tab=credentials&edit=${encodeURIComponent(item.employee_id)}">แก้ไขบัญชี →</a></div>`}
    </article>`;
  }).join("") || emptyState("ยังไม่มีบัญชีในระบบ");

  const credentialRows = credentials.map((item) => {
    const isSelf = item.employee_id === state.employee.id;
    return `
    <tr>
      <td><span class="request-no">${escapeHtml(item.employee_no)}</span></td>
      <td>${escapeHtml(item.full_name)}${isSelf ? ` <span class="badge">บัญชีของคุณ</span>` : ""}${masterBadge(item.employee_id)}${item.is_active ? "" : ` <span class="badge rejected">ปิดใช้งาน</span>`}</td>
      <td>${escapeHtml(item.department_code ?? "—")}</td>
      <td>${escapeHtml(item.role_code ?? "—")}${actingRoleByEmployee.has(item.employee_id) ? `<br><small class="muted">ทำงานในฐานะ ${escapeHtml(roleNameById.get(actingRoleByEmployee.get(item.employee_id)) ?? "—")}</small>` : ""}</td>
      <td><code data-password-cell="${escapeHtml(item.employee_id)}">${item.has_password ? "••••••••" : "ยังไม่มีบันทึกไว้"}</code></td>
      <td>${item.updated_at ? formatDate(item.updated_at, true) : "—"}</td>
      <td>${isProtectedMaster(item.employee_id) ? `<span class="muted small" title="บัญชี master จัดการได้โดยเจ้าของบัญชีเท่านั้น">เจ้าของบัญชีจัดการเอง</span>` : [
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
      ${moduleColumns.map((col) => `<td class="center"><input type="checkbox" data-module-toggle data-employee="${escapeHtml(person.employee_id)}" data-type="${escapeHtml(col.id)}"${person.granted.get(col.id) ? " checked" : ""}${isProtectedMaster(person.employee_id) ? ` disabled title="บัญชี master จัดการได้โดยเจ้าของบัญชีเท่านั้น"` : ""}></td>`).join("")}
    </tr>`).join("") || `<tr><td colspan="${4 + moduleColumns.length}" class="muted small">ยังไม่มีผู้อนุมัติในระบบ</td></tr>`;

  const content = `
    <div class="page-heading"><div><h1>ผู้ดูแลระบบ</h1><p>อนุมัติคำร้องเปิดบัญชี กำหนดสิทธิ์ และค้นคืน ID/รหัสผ่านที่ออกให้</p></div></div>
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
        ${noteLine("ติ๊กโมดูลที่ผู้อนุมัติแต่ละคนอนุมัติได้", "<p>กำหนดว่าผู้อนุมัติแต่ละคนอนุมัติคำร้องโมดูลใดได้บ้าง ผู้ที่ไม่ได้ติ๊กโมดูลใดจะไม่เห็นและอนุมัติคำร้องโมดูลนั้น แม้จะอยู่แผนกและถือบทบาทผู้อนุมัติเดียวกันก็ตาม (ขั้นตอน \"หัวหน้าแผนก\" ที่อนุมัติในฐานะผู้บังคับบัญชาโดยตรงไม่ถูกจำกัดด้วยตารางนี้)</p>", "สิทธิ์อนุมัติรายโมดูล")}
        <div class="table-wrap"><table>
          <thead><tr><th>รหัสพนักงาน</th><th>ชื่อ</th><th>แผนก</th><th>ตำแหน่ง</th>${moduleColumns.map((col) => `<th>${escapeHtml(col.name)}</th>`).join("")}</tr></thead>
          <tbody>${modulePermissionTableRows}</tbody>
        </table></div>
      </section>` : ""}
    ${tab === "credentials" ? `
      ${adding ? `
      <section class="card">
        <div class="card-head"><div><h2>เพิ่มบัญชีใหม่</h2><p class="muted small">ใช้งานได้ทันที ระบบส่งอีเมลลิงก์ตั้งรหัสผ่านให้เจ้าของบัญชี</p></div><a class="btn secondary small" href="#/admin?tab=credentials">ปิด</a></div>
        <div id="employee-add-message" role="status"></div>
        <form id="employee-add-form">
          <div class="field"><label for="add-employee-no">รหัสพนักงาน${req}</label><input class="input" id="add-employee-no" name="employee_no" maxlength="32" placeholder="เช่น MNP0102" autocomplete="off" required></div>
          <div class="field-row">
            <div class="field"><label for="add-first-name">ชื่อ${req}</label><input class="input" id="add-first-name" name="first_name" maxlength="100" required></div>
            <div class="field"><label for="add-last-name">นามสกุล${req}</label><input class="input" id="add-last-name" name="last_name" maxlength="100" required></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="add-email">อีเมล${req}</label><input class="input" id="add-email" name="email" type="email" maxlength="200" autocomplete="off" required></div>
            <div class="field"><label for="add-phone">เบอร์ติดต่อ${req}</label><input class="input" id="add-phone" name="phone" type="tel" inputmode="tel" maxlength="40" pattern="[0-9+\\- ]{9,40}" title="กรอกเบอร์โทรอย่างน้อย 9 หลัก (ตัวเลข, +, - หรือเว้นวรรค)" placeholder="เช่น 0812345678" required></div>
          </div>
          <div class="field"><label for="add-job-title">ตำแหน่งที่แสดงใต้ชื่อ (ถ้ามี)</label><input class="input" id="add-job-title" name="job_title" maxlength="120"></div>
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
        <div class="card-head"><div><h2>แก้ไขบัญชี ${escapeHtml(editing.employee_no)}</h2><p class="muted small">การเปลี่ยนแปลงมีผลทันที</p></div><a class="btn secondary small" href="#/admin?tab=credentials">ปิด</a></div>
        <div id="employee-edit-message" role="status"></div>
        <form id="employee-edit-form" data-employee-id="${escapeHtml(editing.employee_id)}" data-employee-no="${escapeHtml(editing.employee_no)}" data-acting-role-id="${escapeHtml(actingRoleByEmployee.get(editing.employee_id) ?? "")}" data-admin-role-id="${escapeHtml(adminRoleId)}">
          <div class="field-row">
            <div class="field"><label for="edit-employee-no">รหัสพนักงาน${REQUIRED_MARK}</label><input class="input" id="edit-employee-no" name="employee_no" maxlength="32" value="${escapeHtml(editing.employee_no)}" required></div>
            <div class="field"><label for="edit-active">สถานะบัญชี</label><select class="input" id="edit-active" name="is_active"><option value="true"${editing.is_active ? " selected" : ""}>ใช้งาน</option><option value="false"${editing.is_active ? "" : " selected"}>ปิดใช้งาน</option></select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="edit-first-name">ชื่อ${REQUIRED_MARK}</label><input class="input" id="edit-first-name" name="first_name" maxlength="100" value="${escapeHtml(editing.first_name ?? "")}" required></div>
            <div class="field"><label for="edit-last-name">นามสกุล${REQUIRED_MARK}</label><input class="input" id="edit-last-name" name="last_name" maxlength="100" value="${escapeHtml(editing.last_name ?? "")}" required></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="edit-email">อีเมล${req}</label><input class="input" id="edit-email" name="email" type="email" maxlength="200" value="${escapeHtml(editing.email ?? "")}" required></div>
            <div class="field"><label for="edit-phone">เบอร์ติดต่อ (ถ้ามี)</label><input class="input" id="edit-phone" name="phone" maxlength="40" value="${escapeHtml(editing.phone ?? "")}"></div>
          </div>
          <div class="field"><label for="edit-job-title">ตำแหน่งที่แสดงใต้ชื่อ (ถ้ามี)</label><input class="input" id="edit-job-title" name="job_title" maxlength="120" value="${escapeHtml(editing.job_title ?? "")}"></div>
          <div class="field-row">
            <div class="field"><label for="edit-department">แผนก${REQUIRED_MARK}</label><select class="input" id="edit-department" name="department_id" required>${departments.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === editing.department_id ? " selected" : ""}>${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
            <div class="field"><label for="edit-role">ตำแหน่ง${REQUIRED_MARK}</label><select class="input" id="edit-role" name="role_id" required>${roles.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === editing.role_id ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
          </div>
          <div class="field"><label for="edit-acting-role">บทบาทหลักในการทำงาน (เฉพาะตำแหน่งผู้ดูแลระบบ)</label><select class="input" id="edit-acting-role" name="acting_role_id"${editing.role_id === adminRoleId ? "" : " disabled"}><option value="">ผู้ดูแลระบบ (รับแจ้งเตือนและเห็นรายการรออนุมัติทั้งหมด)</option>${roles.filter((item) => item.code !== "admin").map((item) => `<option value="${escapeHtml(item.id)}"${item.id === actingRoleByEmployee.get(editing.employee_id) ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select><small>สำหรับผู้ดูแลระบบที่ทำงานจริงในตำแหน่งอื่นด้วย (เช่น ผู้จัดการทั่วไป) ระบบจะส่งแจ้งเตือนและแสดงรายการรออนุมัติเฉพาะของบทบาทนั้น และนับบัญชีนี้เป็นผู้อนุมัติในสายอนุมัติของบทบาทนั้น สิทธิ์ผู้ดูแลระบบอื่นยังใช้ได้ครบ แต่จะไม่ได้รับแจ้งเตือนคำร้องเปิดบัญชี/แก้ไข ID</small></div>
          <div class="field"><label for="edit-password">ตั้งรหัสผ่านใหม่ (เว้นว่างไว้หากไม่เปลี่ยน)</label><input class="input" id="edit-password" name="password" type="password" autocomplete="new-password" maxlength="72"><small>ตั้งให้ผู้ใช้ได้ทันทีเมื่อผู้ใช้ลืมรหัสผ่าน และรหัสผ่านใหม่จะถูกบันทึกลงคลังให้อัตโนมัติ</small></div>
          <div class="form-actions"><button class="btn" type="submit">บันทึกการแก้ไข</button></div>
        </form>
      </section>` : ""}
      <section class="card">
        <div class="card-head"><div><h2>บัญชีทั้งหมด</h2></div>${adding ? "" : `<a class="btn small" href="#/admin?tab=credentials&add=1"><span class="plus-icon" aria-hidden="true"></span> เพิ่มบัญชี</a>`}</div>
        ${noteLine("การกดแสดงรหัสผ่านถูกบันทึกทุกครั้ง", "<p>ตารางนี้แสดงพนักงานทุกบัญชีรวมถึงบัญชีผู้ดูแลระบบและบัญชีของคุณเอง รหัสผ่านถูกปิดไว้เป็นค่าเริ่มต้น การกดแสดงถูกบันทึกลง audit log ทุกครั้งพร้อมชื่อผู้กดและเวลา บัญชีที่สร้างก่อนระบบนี้จะยังไม่มีรหัสผ่านบันทึกไว้ ให้เจ้าของบัญชีแก้ไขรหัสผ่านหนึ่งครั้งก่อน</p>", "ตารางบัญชีและรหัสผ่าน")}
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
    if (!(await confirmDialog({ title: `ลบบัญชี ${label}?`, message: "ถ้าบัญชีนี้ยังไม่เคยมีเอกสารหรือประวัติในระบบ จะถูกลบถาวร\nถ้ามีประวัติแล้ว ระบบจะปิดใช้งานและซ่อนบัญชีแทน เพื่อให้เอกสารเก่ายังแสดงชื่อได้\nทั้งสองกรณีเจ้าของบัญชีจะเข้าสู่ระบบไม่ได้อีก", confirmLabel: "ลบบัญชี", danger: true }))) return;
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

  document.title = "ตั้งรหัสผ่าน · MNP Workspace";
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-aside">
        <div class="brand brand-lg"><img class="brand-mark" src="./icons/icon-512.png" alt=""><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></div>
        <div class="auth-copy">
          <h1>ตั้งรหัสผ่านใหม่<br>สำหรับเข้าใช้งาน</h1>
          <p>ผู้ดูแลระบบอนุมัติสิทธิ์เข้าใช้งานของคุณแล้ว ตั้งรหัสผ่านใหม่ได้ที่หน้านี้ ลิงก์ใช้ได้ครั้งเดียว</p>
        </div>
      </section>
      <section class="auth-panel">
        <div class="theme-button">${themeButton()}</div>
        <div class="auth-card">
          <h2>ตั้งรหัสผ่านใหม่</h2>
          <div id="auth-message" role="status">${errorMessage ? `<div class="form-message error">${escapeHtml(errorMessage)}</div>` : ""}</div>
          ${errorMessage ? `<a class="btn secondary block" href="#/dashboard" id="setup-back">กลับไปหน้าเข้าสู่ระบบ</a>` : `
          <form id="setup-form">
            <div class="field"><label for="setup-employee-no">รหัสพนักงาน</label><input class="input" id="setup-employee-no" value="${escapeHtml(employeeNo)}" autocomplete="username" readonly></div>
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
  refreshInstallBanner({ hideOnly: true });
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
  // บัญชี lab-only เปิดได้เฉพาะ MNP LAB กับข้อมูลส่วนตัว ที่อยู่อื่น (รวมที่พิมพ์เอง/ลิงก์เก่า) พากลับ LAB ก่อนเรียกข้อมูลใด ๆ
  if (isLabOnly() && !window.MNP_LAB_ONLY.routeAllowed(path)) {
    go(window.MNP_LAB_ONLY.HOME);
    return;
  }
  // แผนกที่เห็นเฉพาะบางโมดูล: หน้าของโมดูลอื่นและหน้าผู้ดูแลระบบ (รวมลิงก์เก่า/พิมพ์เอง) พากลับหน้าหลัก
  if (!window.MNP_DEPARTMENT_ACCESS.routeAllowed(deptAccessSubject(), path, moduleCodeForPage(path))) {
    go("dashboard");
    return;
  }
  if (isSandboxMode() && !sandboxRouteAllowed(path, params)) {
    go("ncr");
    return;
  }
  refreshInstallBanner();
  if (pushResyncedFor !== state.employee.id) {
    pushResyncedFor = state.employee.id;
    resyncPushSubscription();
  }
  await loadUnread();
  try {
    if (path === "dashboard") return await renderDashboard(params);
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
    // หน้ารออนุมัติเดิมรวมเข้าหน้าหลักแล้ว ลิงก์เก่าในอีเมล/LINE (#/approvals?request=) เปิดคิวที่ใบนั้น
    if (path === "approvals") return await renderDashboard(params);
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

// เปลี่ยนหน้า (hashchange): วาดหน้าใหม่แล้วย้ายโฟกัสมาที่หน้านั้น โปรแกรมอ่านจอจึงรู้ว่าเปลี่ยนหน้าแล้ว และ Tab ต่อจากหัวเรื่องของหน้าใหม่
// ไม่ใช้กับการวาดซ้ำในหน้าเดิม (ลองอีกครั้ง บันทึกแล้ววาดใหม่) และการเปิดแอปครั้งแรก ซึ่งไม่ได้ย้ายหน้า
let routeSeq = 0;
async function navigateRoute(event) {
  const seq = ++routeSeq;
  // จำเฉพาะช่องกรอก/ตัวกรอง (select, input) ลิงก์หรือปุ่มที่ id ซ้ำกันในหน้าถัดไปต้องไม่ดึงโฟกัสไว้กลางหน้า
  const before = document.activeElement;
  const beforeId = before?.matches?.("select, input") ? before.id : "";
  // หน้าใหม่เริ่มที่บนสุด (เดิมตำแหน่งเลื่อนค้างจากหน้าก่อน หน้ารายละเอียดจึงเปิดกลางใบ)
  // ย้อนกลับ/ไปหน้าที่เคยเปิดใน history: กลับไปตำแหน่งเดิม (history.state จำไว้ตอนเลื่อน)
  // เปลี่ยนแค่ตัวกรองในหน้าเดิม: คงตำแหน่งไว้
  const fromKey = event?.oldURL ? pageKeyOf(routeFromHash(new URL(event.oldURL).hash)) : null;
  const pageChanged = fromKey !== pageKeyOf(currentRoute());
  const savedY = typeof history.state?.pilotScrollY === "number" ? history.state.pilotScrollY : null;
  if (pageChanged && savedY === null) window.scrollTo(0, 0);
  await renderRoute();
  if (seq !== routeSeq) return; // ผู้ใช้กดไปหน้าอื่นต่อระหว่างโหลด หน้าล่าสุดเป็นผู้จัดโฟกัส
  if (pageChanged && savedY !== null) window.scrollTo(0, savedY);
  focusRouteStart({ samePath: !pageChanged, beforeId });
}

// "หน้าเดียวกัน" = path เดียวกันและเป็นใบ/โหมด/โมดูลเดียวกัน: ใบ A ไปใบ B (#/request?id=) หรือรายการไปฟอร์มสร้าง (mode=create)
// นับเป็นหน้าใหม่ ส่วนตัวกรอง (สถานะ แผนก ขอบเขต ค้นหา) เปลี่ยนแล้วยังเป็นหน้าเดิม
function pageKeyOf({ path, params }) {
  return [path, params.get("id"), params.get("type"), params.get("mode"), params.get("createType")].map((value) => value ?? "").join("|");
}

// จำตำแหน่งเลื่อนของหน้าปัจจุบันไว้ใน history entry ของมัน: เขียนเมื่อหยุดเลื่อน และทันทีที่แตะ/คลิก
// (ก่อนลิงก์พาไปหน้าใหม่ ไม่งั้นเลื่อนแล้วแตะเร็วกว่ารอบหน่วงจะเสียตำแหน่งท้าย) — Safari จำกัด replaceState ไม่เกิน 100 ครั้ง/30 วินาที
let scrollMemoTimer = 0;
function saveScrollMemo() {
  clearTimeout(scrollMemoTimer);
  try { history.replaceState({ ...(history.state ?? {}), pilotScrollY: Math.round(window.scrollY) }, ""); } catch { /* เกินเพดานของเบราว์เซอร์: ย้อนกลับแล้วเริ่มบนสุดแทน */ }
}
window.addEventListener("scroll", () => {
  clearTimeout(scrollMemoTimer);
  scrollMemoTimer = setTimeout(saveScrollMemo, 300);
}, { passive: true });
document.addEventListener("click", (event) => { if (event.target.closest?.("a[href^='#']")) saveScrollMemo(); }, true);

function focusRouteStart({ samePath, beforeId }) {
  const active = document.activeElement;
  // หน้าจัดโฟกัสเองแล้ว (เช่น หัวเรื่องของใบในคิว หรือช่องแรกที่ผิด) ไม่แย่ง
  if (active && active !== document.body && active.isConnected) return;
  // เปลี่ยนแค่ตัวกรองในหน้าเดิม: กลับไปที่ช่องเดิมที่วาดใหม่ ไม่ต้องเริ่มจากหัวหน้า
  if (samePath && beforeId) {
    const again = document.getElementById(beforeId);
    if (again && again.getClientRects().length) {
      again.focus({ preventScroll: true });
      return;
    }
  }
  focusPageStart({ preventScroll: true });
}

// โฟกัสหัวเรื่องของหน้า (h1 ตัวแรกในเนื้อหา) หรือทั้งเนื้อหาเมื่อหน้านั้นไม่มี h1
function focusPageStart(options) {
  const content = document.querySelector("#main-content");
  if (!content) return;
  const heading = content.querySelector("h1");
  if (heading && !heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  (heading ?? content).focus(options);
}

// ปุ่มข้ามไปเนื้อหา: ระบบใช้ # เป็นเส้นทางหน้า จึงเป็นปุ่มที่ย้ายโฟกัสเอง ไม่ใช่ลิงก์ #main-content
// (ลิงก์ที่เปิดในแท็บใหม่ด้วยคลิกกลางหรือกดค้างจะกลายเป็นหน้า "ไม่พบข้อมูล")
document.addEventListener("click", (event) => {
  if (!event.target.closest?.("[data-skip-link]")) return;
  focusPageStart();
});

async function startApp() {
  const { data, error } = await sb.auth.getSession();
  // ต่ออายุ session ไม่สำเร็จเพราะเน็ต: session ยังเก็บอยู่ในเครื่อง อย่าพาไปหน้าล็อกอิน
  // (refresh token ใช้ไม่ได้จริง Supabase ลบ session ให้เองและคืน session = null → ไปหน้าล็อกอินตามปกติ)
  if (error?.name === "AuthRetryableFetchError") return renderConnectionError(error);
  if (error) console.error(error);
  state.session = data.session;
  // ยังไม่ได้ล็อกอิน: เครื่องนี้ต้องไม่ค้างการสมัครแจ้งเตือนของบัญชีก่อนหน้า (เช่น session หมดอายุแล้วไม่ได้กดออกจากระบบ) ลองยกเลิกในเครื่อง
  if (!state.session) releasePushOnThisDevice({ server: false });
  if (state.session) {
    try {
      await loadEmployeeKeepingSession();
      // กันกรณีแจ้งเตือนตกค้าง (ปิดเบราว์เซอร์ก่อนยิงสำเร็จ / ตอนนั้นยังไม่ได้ตั้งค่า secret /
      // แจ้งเตือนที่เกิดตอนผู้รับยังไม่ได้ล็อกอิน) — เปิดแอปครั้งถัดไปคิวจะถูกไล่ส่งให้เอง
      if (!isLabOnly()) triggerNotificationEmails();
      if (!location.hash) go(homePath());
    } catch (employeeError) {
      if (!isAccountGoneError(employeeError)) return renderConnectionError(employeeError);
      await signOutLocally(friendlyError(employeeError));
    }
  }
  await renderRoute();
}

async function init() {
  applyTheme();
  // applyTheme อ่าน "mnp-theme" ก่อนเสมอ ผู้ที่เลือกธีมเองแล้วจึงไม่ถูกเปลี่ยนตามเครื่อง
  darkSchemeQuery?.addEventListener?.("change", applyTheme);
  // sw.js ไม่ cache อะไร (ดูหัวไฟล์) ลงทะเบียนพลาดก็ใช้งานเว็บได้ตามปกติ แค่ติดตั้งแบบกดปุ่มไม่ได้
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch((error) => console.warn("ลงทะเบียน service worker ไม่สำเร็จ", error));
  }
  window.addEventListener("hashchange", navigateRoute);
  // บัญชีถูกลบ/รหัสผ่านถูกเปลี่ยนระหว่างเปิดแอปค้างไว้ ต่ออายุ token ไม่ได้ → Supabase ส่ง SIGNED_OUT
  sb.auth.onAuthStateChange((event, session) => {
    syncSignedUrlOwner(event === "SIGNED_OUT" ? null : session?.user?.id);
    if (event !== "SIGNED_OUT" || !state.session) return;
    releasePushOnThisDevice({ server: false });
    state.session = null;
    state.employee = null;
    state.unread = 0;
    setTimeout(() => renderAuth(), 0);
  });
  await startApp();
}

init();
