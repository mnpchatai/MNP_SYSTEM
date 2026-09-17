/* global supabase */

const SUPABASE_URL = "https://iqlydmkylqyowmvpsete.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uWsULpN8jWF8XCp73B8K_A_YkbKJNUD";
const PILOT_AUTH_URL = `${SUPABASE_URL}/functions/v1/pilot-auth`;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
const state = { session: null, employee: null, unread: 0, authMode: "login", directory: null, adminTab: "requests" };

const positionLabels = {
  department_head: "หัวหน้าแผนก",
  assistant_head: "ผู้ช่วยหัวหน้าแผนก",
  staff: "พนักงานทั่วไป",
};
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
};
const priorityLabels = { low: "ต่ำ", normal: "ปกติ", high: "สูง", urgent: "เร่งด่วน" };
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
  const map = {
    AUTH_REQUIRED: "กรุณาเข้าสู่ระบบอีกครั้ง",
    NOT_AUTHORIZED: "คุณไม่มีสิทธิ์ดำเนินการนี้",
    INVALID_TITLE: "หัวข้อต้องมี 3–200 ตัวอักษร",
    INVALID_DESCRIPTION: "รายละเอียดต้องมี 3–5,000 ตัวอักษร",
    STEP_NOT_PENDING: "รายการนี้ถูกดำเนินการแล้ว",
    STEP_NOT_CURRENT: "ขั้นตอนนี้ไม่ใช่ขั้นตอนปัจจุบัน",
    INVALID_TRANSITION: "ไม่สามารถเปลี่ยนเป็นสถานะนี้ได้",
    ASSIGNED_TO_ANOTHER_OPERATOR: "รายการนี้มีผู้รับผิดชอบอื่นแล้ว",
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

function statusBadge(status) {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(statusLabels[status] ?? status)}</span>`;
}

function requestRows(requests) {
  if (!requests.length) return `<div class="empty">ยังไม่มีรายการในขณะนี้</div>`;
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>เลขที่</th><th>เรื่อง</th><th>ประเภท</th><th>ความสำคัญ</th><th>สถานะ</th><th>วันที่</th></tr></thead>
      <tbody>${requests.map((request) => {
        const type = relation(request.request_type);
        return `<tr>
          <td><a class="request-no" href="#/request?id=${encodeURIComponent(request.id)}">${escapeHtml(request.request_no)}</a></td>
          <td><a href="#/request?id=${encodeURIComponent(request.id)}"><strong>${escapeHtml(request.title)}</strong></a></td>
          <td class="muted">${escapeHtml(type?.name_th ?? "—")}</td>
          <td class="priority-${escapeHtml(request.priority)}">${escapeHtml(priorityLabels[request.priority] ?? request.priority)}</td>
          <td>${statusBadge(request.status)}</td>
          <td class="muted">${formatDate(request.created_at)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
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

  const requestFields = `
    <div class="field-row">
      <div class="field"><label for="first-name">ชื่อ</label><input class="input" id="first-name" name="first_name" maxlength="100" required></div>
      <div class="field"><label for="last-name">นามสกุล</label><input class="input" id="last-name" name="last_name" maxlength="100" required></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="department">แผนก</label><select class="input" id="department" name="department_id" required><option value="">เลือกแผนก</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)}${item.name_th && item.name_th !== item.code ? ` · ${escapeHtml(item.name_th)}` : ""}</option>`).join("")}</select></div>
      <div class="field"><label for="position-level">ตำแหน่งในแผนก</label><select class="input" id="position-level" name="position_level" required><option value="">เลือกตำแหน่ง</option>${Object.entries(positionLabels).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select></div>
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
      positionLevel: String(values.get("position_level") ?? ""),
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

async function loadEmployee() {
  if (!state.session?.user) return null;
  const { data, error } = await sb
    .from("employees")
    .select("id,employee_no,first_name,last_name,email,phone,job_title,position_level,department_id,role_id,manager_id,role:roles(code,name_th),department:departments(code,name_th)")
    .eq("auth_user_id", state.session.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน");
  state.employee = { ...data, role: relation(data.role), department: relation(data.department) };
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

function navLink(path, label, icon, active) {
  return `<a class="nav-link${active === path ? " active" : ""}" href="#/${path}"><span class="nav-icon">${icon}</span><span>${label}</span></a>`;
}

function shell(content, active, title) {
  const employee = state.employee;
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#/dashboard"><div class="brand-mark">M</div><div><strong>MNP Workspace</strong><span>PILOT WEB</span></div></a>
        <nav class="nav" aria-label="เมนูหลัก">
          <div class="nav-label">Workspace</div>
          ${navLink("dashboard", "หน้าหลัก", "⌂", active)}
          ${navLink("requests", employee.role?.code === "operator" ? "งานดำเนินการ" : "คำร้อง", "▤", active)}
          ${navLink("new", "สร้างคำร้อง", "+", active)}
          ${navLink("approvals", "รออนุมัติ", "✓", active)}
          ${navLink("notifications", "การแจ้งเตือน", "♧", active)}
          <div class="nav-divider"></div>
          ${employee.role?.code === "admin" ? navLink("admin", "ผู้ดูแลระบบ", "⚙", active) : ""}
          ${navLink("profile", "ข้อมูลส่วนตัว", "○", active)}
        </nav>
        <div class="nav-spacer"></div>
        <div class="sidebar-user">
          <div class="avatar">${escapeHtml(initials(employee))}</div>
          <div class="user-copy"><strong>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</strong><span>${escapeHtml(employee.job_title ?? employee.role?.name_th ?? "พนักงาน")}</span></div>
          <button class="icon-button signout-button" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ">↪</button>
        </div>
      </aside>
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
  return (data ?? []).map((item) => ({ ...item, request: relation(item.request) })).filter((step) => {
    const request = step.request;
    if (!request || step.step_order !== request.current_step) return false;
    if (employee.role?.code === "admin") return true;
    return step.approver_employee_id === employee.id || (
      step.approver_role_id === employee.role_id &&
      (!step.approver_department_id || step.approver_department_id === employee.department_id)
    );
  });
}

async function renderDashboard() {
  loadingShell("dashboard", "หน้าหลัก");
  const employee = state.employee;
  let requestsQuery = sb
    .from("requests")
    .select("id,request_no,title,status,priority,created_at,requester_id,assignee_id,request_type:request_types(name_th)")
    .order("created_at", { ascending: false })
    .limit(20);
  if (!["admin", "operator"].includes(employee.role?.code)) requestsQuery = requestsQuery.eq("requester_id", employee.id);
  const [requestsResult, typesResult, pending] = await Promise.all([
    requestsQuery,
    sb.from("request_types").select("id,code,name_th,description").eq("is_active", true).order("sort_order").limit(5),
    getPendingApprovals(),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (typesResult.error) throw typesResult.error;
  const requests = requestsResult.data ?? [];
  const inProgress = requests.filter((item) => ["approved", "in_progress"].includes(item.status)).length;
  const completed = requests.filter((item) => item.status === "completed").length;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Pilot workspace</div><h1>สวัสดี, ${escapeHtml(employee.first_name)}</h1><p>ภาพรวมรายการที่เกี่ยวข้องกับคุณและงานที่ต้องดำเนินการ</p></div><span class="muted small">${formatDate(new Date(), false)}</span></div>
    <section class="summary-grid">
      <a class="summary" href="#/approvals"><span>งานที่ต้องจัดการ</span><strong>${pending.length}</strong><small>${pending.length ? "เปิดรายการที่รออนุมัติ" : "ไม่มีงานอนุมัติค้าง"}</small></a>
      <div class="summary"><span>รายการที่มองเห็น</span><strong>${requests.length}</strong><small>ตามสิทธิ์ของบัญชีนี้</small></div>
      <div class="summary"><span>กำลังดำเนินการ</span><strong>${inProgress}</strong><small>อนุมัติแล้วหรือกำลังทำ</small></div>
      <div class="summary"><span>เสร็จแล้ว</span><strong>${completed}</strong><small>ปิดงานเรียบร้อย</small></div>
    </section>
    <div class="dashboard-grid">
      <section class="card flush"><div class="card-heading"><h2>ความเคลื่อนไหวล่าสุด</h2><a href="#/requests">ดูทั้งหมด →</a></div>${requestRows(requests.slice(0, 7))}</section>
      <section class="card flush"><div class="card-heading"><h2>สร้างคำร้อง</h2><a href="#/new">ทุกประเภท →</a></div><div class="quick-list">${(typesResult.data ?? []).map((type) => `<a class="quick-link" href="#/new?type=${encodeURIComponent(type.id)}"><span class="quick-icon">＋</span><span><strong>${escapeHtml(type.name_th)}</strong><small>${escapeHtml(type.description ?? "")}</small></span><span>›</span></a>`).join("")}</div></section>
    </div>`;
  app.innerHTML = shell(content, "dashboard", "หน้าหลัก");
  bindShell();
}

async function renderRequests(params) {
  loadingShell("requests", "รายการคำร้อง");
  const role = state.employee.role?.code;
  const status = params.get("status") ?? "all";
  let query = sb
    .from("requests")
    .select("id,request_no,title,status,priority,created_at,requester_id,assignee_id,request_type:request_types(name_th)")
    .order("created_at", { ascending: false });
  if (!["admin", "operator"].includes(role)) query = query.eq("requester_id", state.employee.id);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  const title = role === "operator" ? "งานดำเนินการ" : role === "admin" ? "คำร้องทั้งหมด" : "คำร้องของฉัน";
  const filters = [["all","ทั้งหมด"],["pending_approval","รออนุมัติ"],["approved","อนุมัติแล้ว"],["in_progress","กำลังดำเนินการ"],["completed","เสร็จแล้ว"],["rejected","ไม่อนุมัติ"]];
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Request Center</div><h1>${title}</h1><p>ค้นหา ติดตาม และเปิดดูรายละเอียดตามสิทธิ์ของบัญชี</p></div><a class="btn" href="#/new">＋ สร้างคำร้อง</a></div>
    <div class="filters">${filters.map(([value,label]) => `<a class="filter${status === value ? " active" : ""}" href="#/requests${value === "all" ? "" : `?status=${value}`}">${label}</a>`).join("")}</div>
    <section class="card flush">${requestRows(data ?? [])}</section>`;
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

async function renderNewRequest(params) {
  loadingShell("new", "สร้างคำร้อง");
  const { data: types, error } = await sb
    .from("request_types")
    .select("id,name_th,description,form_schema")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  const initialType = params.get("type") ?? types?.[0]?.id ?? "";
  const selected = types?.find((item) => item.id === initialType) ?? types?.[0];
  const content = `
    <div class="page-heading"><div><div class="eyebrow">New request</div><h1>สร้างคำร้องใหม่</h1><p>กรอกข้อมูลที่จำเป็น ระบบจะสร้างลำดับอนุมัติให้อัตโนมัติ</p></div></div>
    <section class="card" style="max-width:900px;margin:auto"><div id="request-message"></div><form id="request-form">
      <div class="form-grid">
        <div class="field full"><label for="request-type">ประเภทคำร้อง</label><select class="select" id="request-type" name="type_id" required>${(types ?? []).map((type) => `<option value="${escapeHtml(type.id)}"${type.id === selected?.id ? " selected" : ""}>${escapeHtml(type.name_th)}</option>`).join("")}</select><small id="type-description">${escapeHtml(selected?.description ?? "")}</small></div>
        <div class="field full"><label for="title">หัวข้อ</label><input class="input" id="title" name="title" minlength="3" maxlength="200" required></div>
        <div class="field full"><label for="description">รายละเอียด</label><textarea class="textarea" id="description" name="description" minlength="3" maxlength="5000" required></textarea></div>
        <div class="field"><label for="priority">ความสำคัญ</label><select class="select" id="priority" name="priority"><option value="low">ต่ำ</option><option value="normal" selected>ปกติ</option><option value="high">สูง</option><option value="urgent">เร่งด่วน</option></select></div>
        <div></div><div id="detail-fields" class="field full"><div class="form-grid">${dynamicDetailFields(selected?.form_schema)}</div></div>
      </div>
      <div class="form-actions"><a class="btn secondary" href="#/requests">ยกเลิก</a><button class="btn" type="submit">ส่งคำร้อง</button></div>
    </form></section>`;
  app.innerHTML = shell(content, "new", "สร้างคำร้อง");
  bindShell();
  const select = document.querySelector("#request-type");
  select.addEventListener("change", () => {
    const type = types.find((item) => item.id === select.value);
    document.querySelector("#type-description").textContent = type?.description ?? "";
    document.querySelector("#detail-fields").innerHTML = `<div class="form-grid">${dynamicDetailFields(type?.form_schema)}</div>`;
  });
  document.querySelector("#request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const details = {};
    form.querySelectorAll(".detail-field").forEach((input) => { if (input.value.trim()) details[input.name] = input.value.trim(); });
    setFormBusy(form, true);
    try {
      const { data, error: createError } = await sb.rpc("app_create_request", {
        p_type_id: values.get("type_id"),
        p_title: String(values.get("title") ?? "").trim(),
        p_description: String(values.get("description") ?? "").trim(),
        p_priority: values.get("priority"),
        p_details: details,
      });
      if (createError) throw createError;
      showToast("สร้างคำร้องสำเร็จ");
      go(`request?id=${encodeURIComponent(data)}`);
    } catch (submitError) {
      document.querySelector("#request-message").innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(submitError))}</div>`;
      setFormBusy(form, false);
    }
  });
}

async function loadDirectory() {
  const { data, error } = await sb.from("employees").select("id,first_name,last_name,job_title,role_id,department_id").eq("is_active", true);
  if (error) throw error;
  return new Map((data ?? []).map((employee) => [employee.id, employee]));
}

function personName(directory, id) {
  const person = directory.get(id);
  return person ? `${person.first_name} ${person.last_name}` : "—";
}

async function renderRequestDetail(params) {
  const id = params.get("id");
  if (!id) return renderNotFound("ไม่พบรหัสคำร้อง");
  loadingShell("requests", "รายละเอียดคำร้อง");
  const [requestResult, stepsResult, commentsResult, attachmentsResult, historyResult, directory] = await Promise.all([
    sb.from("requests").select("*,request_type:request_types(name_th,code)").eq("id", id).maybeSingle(),
    sb.from("approval_steps").select("*").eq("request_id", id).order("step_order"),
    sb.from("request_comments").select("*").eq("request_id", id).order("created_at"),
    sb.from("request_attachments").select("*").eq("request_id", id).order("created_at"),
    sb.from("request_status_history").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    loadDirectory(),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (!requestResult.data) return renderNotFound("ไม่พบคำร้อง หรือคุณไม่มีสิทธิ์เข้าถึง");
  for (const result of [stepsResult, commentsResult, attachmentsResult, historyResult]) if (result.error) throw result.error;
  const request = requestResult.data;
  const type = relation(request.request_type);
  const steps = stepsResult.data ?? [];
  const comments = commentsResult.data ?? [];
  const attachments = attachmentsResult.data ?? [];
  const history = historyResult.data ?? [];
  const employee = state.employee;
  const currentStep = steps.find((step) => step.status === "pending" && step.step_order === request.current_step);
  const canApprove = currentStep && (employee.role?.code === "admin" || currentStep.approver_employee_id === employee.id || (
    currentStep.approver_role_id === employee.role_id && (!currentStep.approver_department_id || currentStep.approver_department_id === employee.department_id)
  ));
  const canOperate = ["admin", "operator"].includes(employee.role?.code) && ["approved", "in_progress"].includes(request.status);
  const detailEntries = Object.entries(request.details ?? {});
  const content = `
    <header class="request-detail-head"><div class="eyebrow">${escapeHtml(request.request_no)}</div><h1>${escapeHtml(request.title)}</h1><p>${escapeHtml(type?.name_th ?? "คำร้อง")} · โดย ${escapeHtml(personName(directory, request.requester_id))} · ${formatDate(request.submitted_at, true)}</p></header>
    <div class="detail-grid">
      <div class="stack">
        <section class="card"><div class="card-heading" style="padding:0;min-height:36px"><h2>ข้อมูลคำร้อง</h2>${statusBadge(request.status)}</div><p class="description">${escapeHtml(request.description)}</p>
          <dl class="definition-grid"><div class="definition"><dt>ความสำคัญ</dt><dd class="priority-${escapeHtml(request.priority)}">${escapeHtml(priorityLabels[request.priority])}</dd></div><div class="definition"><dt>ผู้รับผิดชอบ</dt><dd>${escapeHtml(personName(directory, request.assignee_id))}</dd></div>${detailEntries.map(([key,value]) => `<div class="definition"><dt>${escapeHtml(detailFieldLabels[key] ?? key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
        </section>
        ${canApprove ? `<section class="card"><h2>พิจารณาคำร้อง</h2><p class="muted small">ขั้นตอน: ${escapeHtml(currentStep.step_name)}</p><div class="field"><label for="decision-comment">ความเห็น</label><textarea class="textarea" id="decision-comment" maxlength="1000"></textarea></div><div class="approval-actions"><button class="btn success decision-button" data-decision="approved">อนุมัติ</button><button class="btn warning decision-button" data-decision="more_info">ขอข้อมูลเพิ่ม</button><button class="btn danger decision-button" data-decision="rejected">ไม่อนุมัติ</button></div></section>` : ""}
        ${canOperate ? `<section class="card"><h2>ดำเนินงาน</h2><p class="muted small">ผู้ปฏิบัติงานสามารถรับงานและเปลี่ยนสถานะตามลำดับ</p><div class="approval-actions">${request.status === "approved" ? `<button class="btn status-button" data-status="in_progress">รับงานและเริ่มดำเนินการ</button>` : `<button class="btn success status-button" data-status="completed">บันทึกว่าเสร็จแล้ว</button>`}</div></section>` : ""}
        <section class="card"><h2>ความคิดเห็น</h2>${comments.map((comment) => `<article class="comment"><div class="comment-head"><strong>${escapeHtml(personName(directory, comment.author_id))}</strong><time>${formatDate(comment.created_at, true)}</time></div><div class="comment-body">${escapeHtml(comment.body)}</div></article>`).join("") || `<div class="empty">ยังไม่มีความคิดเห็น</div>`}<form id="comment-form"><div class="field"><label for="comment-body">เพิ่มความคิดเห็น</label><textarea class="textarea" id="comment-body" name="body" maxlength="3000" required></textarea></div><div class="form-actions"><button class="btn small" type="submit">บันทึกความคิดเห็น</button></div></form></section>
      </div>
      <aside class="stack">
        <section class="card"><h2>ลำดับอนุมัติ</h2><div class="timeline">${steps.map((step) => `<div class="timeline-item"><strong>${escapeHtml(step.step_name)} · ${escapeHtml(step.status)}</strong><p>${step.acted_by ? `ดำเนินการโดย ${escapeHtml(personName(directory, step.acted_by))}` : "รอดำเนินการ"}${step.comment ? ` · ${escapeHtml(step.comment)}` : ""}</p></div>`).join("") || `<div class="muted small">ไม่มีขั้นตอนอนุมัติ</div>`}</div></section>
        <section class="card"><h2>ไฟล์แนบ</h2>${attachments.map((file) => `<div class="attachment"><span>${escapeHtml(file.file_name)}<br><small class="muted">${Math.ceil(file.size_bytes / 1024)} KB</small></span><button class="btn secondary small download-button" data-path="${escapeHtml(file.storage_path)}">เปิด</button></div>`).join("") || `<p class="muted small">ยังไม่มีไฟล์แนบ</p>`}<form id="attachment-form"><div class="field"><label for="attachment-file">แนบไฟล์ (สูงสุด 10 MB)</label><input class="input" id="attachment-file" name="file" type="file" required></div><button class="btn secondary small" type="submit">อัปโหลด</button></form></section>
        <section class="card"><h2>ประวัติสถานะ</h2><div class="timeline">${history.map((item) => `<div class="timeline-item"><strong>${escapeHtml(statusLabels[item.to_status] ?? item.to_status)}</strong><p>${formatDate(item.created_at, true)}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</p></div>`).join("") || `<div class="muted small">ยังไม่มีประวัติ</div>`}</div></section>
      </aside>
    </div>`;
  app.innerHTML = shell(content, "requests", request.request_no);
  bindShell();

  document.querySelectorAll(".decision-button").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll(".decision-button").forEach((node) => { node.disabled = true; });
    try {
      const { error } = await sb.rpc("app_approval_decision", { p_step_id: currentStep.id, p_decision: button.dataset.decision, p_comment: document.querySelector("#decision-comment")?.value ?? "" });
      if (error) throw error;
      showToast("บันทึกผลการพิจารณาแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); document.querySelectorAll(".decision-button").forEach((node) => { node.disabled = false; }); }
  }));
  document.querySelector(".status-button")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      const { error } = await sb.rpc("app_update_request_status", { p_request_id: id, p_status: event.currentTarget.dataset.status });
      if (error) throw error;
      showToast("อัปเดตสถานะแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); event.currentTarget.disabled = false; }
  });
  document.querySelector("#comment-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormBusy(form, true);
    const body = form.elements.body.value.trim();
    try {
      const { error } = await sb.from("request_comments").insert({ request_id: id, author_id: employee.id, body });
      if (error) throw error;
      showToast("เพิ่มความคิดเห็นแล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelector("#attachment-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file.files[0];
    if (!file || file.size > 10 * 1024 * 1024) return showToast("ไฟล์ต้องมีขนาดไม่เกิน 10 MB", "error");
    setFormBusy(form, true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const path = `${id}/${crypto.randomUUID()}-${safeName}`;
    try {
      const { error: uploadError } = await sb.storage.from("request-attachments").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: metadataError } = await sb.from("request_attachments").insert({ request_id: id, uploader_id: employee.id, storage_path: path, file_name: file.name.slice(0,255), content_type: file.type || "application/octet-stream", size_bytes: file.size });
      if (metadataError) { await sb.storage.from("request-attachments").remove([path]); throw metadataError; }
      showToast("อัปโหลดไฟล์แล้ว");
      await renderRequestDetail(params);
    } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
  });
  document.querySelectorAll(".download-button").forEach((button) => button.addEventListener("click", async () => {
    const { data, error } = await sb.storage.from("request-attachments").createSignedUrl(button.dataset.path, 60);
    if (error) return showToast(friendlyError(error), "error");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }));
}

async function renderApprovals(params) {
  loadingShell("approvals", "รออนุมัติ");
  const steps = await getPendingApprovals();
  if (!steps.length) {
    app.innerHTML = shell(`<div class="empty"><h2>✓ ไม่มีคำร้องรออนุมัติ</h2><p>รายการใหม่ที่อยู่ในสิทธิ์ของคุณจะแสดงที่หน้านี้</p><a class="btn secondary" href="#/dashboard">กลับหน้าหลัก</a></div>`, "approvals", "รออนุมัติ");
    bindShell();
    return;
  }
  const selectedId = params.get("request") ?? steps[0].request.id;
  const selected = steps.find((step) => step.request.id === selectedId) ?? steps[0];
  const request = selected.request;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Approval Center</div><h1>รอฉันอนุมัติ</h1><p>รายการที่เป็นขั้นตอนปัจจุบันและอยู่ในสิทธิ์ของคุณ</p></div></div>
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
      sb.from("roles").select("id,code,name_th").order("code"),
    ]);
    departments = departmentResult.data ?? [];
    roles = roleResult.data ?? [];
  }

  const content = `
    <div class="page-heading"><div><div class="eyebrow">My account</div><h1>ข้อมูลส่วนตัว</h1><p>แก้ไขข้อมูลของคุณได้จากหน้านี้</p></div></div>

    <section class="card" style="max-width:780px">
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:20px">
        <div class="avatar" style="width:52px;height:52px;font-size:15px">${escapeHtml(initials(employee))}</div>
        <div><h2>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</h2><span class="badge">${escapeHtml(employee.role?.name_th ?? "พนักงาน")}</span></div>
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
          <div class="field"><label for="profile-position">ตำแหน่งในแผนก</label><select class="input" id="profile-position" name="position_level"><option value="">ไม่ระบุ</option>${Object.entries(positionLabels).map(([value, label]) => `<option value="${value}"${value === employee.position_level ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="profile-role">บทบาท / สิทธิ์</label><select class="input" id="profile-role" name="role_id" required>${roles.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === employee.role_id ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select><small>ระบบไม่ยอมให้ถอดสิทธิ์ผู้ดูแลระบบของตนเอง เพื่อไม่ให้ไม่มีใครเข้าไปแก้ไขได้อีก</small></div>
        ` : `
        <div class="field-row">
          <div class="field"><label for="profile-department">หน่วยงาน</label><input class="input" id="profile-department" value="${escapeHtml(employee.department?.name_th ?? "—")}" disabled></div>
          <div class="field"><label for="profile-position">ตำแหน่งในแผนก</label><input class="input" id="profile-position" value="${escapeHtml(positionLabels[employee.position_level] ?? "—")}" disabled></div>
        </div>
        <div class="field"><label for="profile-role">บทบาท / สิทธิ์</label><input class="input" id="profile-role" value="${escapeHtml(employee.role?.name_th ?? "—")}" disabled><small>สามช่องนี้เป็นตัวกำหนดสิทธิ์และเส้นทางอนุมัติ ต้องให้ผู้ดูแลระบบเป็นผู้แก้ให้</small></div>
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
      p_position_level: String(values.get("position_level") ?? "") || null,
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

  await loadEmployee();
  showToast("แก้ไข ID/รหัสผ่านเรียบร้อย");
  await renderProfile();
  document.querySelector("#credential-message").innerHTML =
    `<div class="form-message success">แก้ไขเรียบร้อยแล้ว ครั้งถัดไปให้เข้าสู่ระบบด้วย ID และรหัสผ่านใหม่</div>`;
}

async function handleEmployeeEditSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#employee-edit-message");
  const values = new FormData(form);
  const employeeId = form.dataset.employeeId;
  const newPassword = String(values.get("password") ?? "");
  if (newPassword && (newPassword.length < 8 || newPassword.length > 72)) {
    message.innerHTML = `<div class="form-message error">รหัสผ่านต้องมี 8–72 ตัวอักษร</div>`;
    return;
  }
  setFormBusy(form, true);
  message.innerHTML = "";

  const { error } = await sb.rpc("app_admin_update_employee", {
    p_employee_id: employeeId,
    p_employee_no: String(values.get("employee_no") ?? "").trim().toUpperCase(),
    p_first_name: String(values.get("first_name") ?? ""),
    p_last_name: String(values.get("last_name") ?? ""),
    p_email: String(values.get("email") ?? ""),
    p_phone: String(values.get("phone") ?? ""),
    p_job_title: String(values.get("job_title") ?? ""),
    p_department_id: String(values.get("department_id") ?? "") || null,
    p_position_level: String(values.get("position_level") ?? "") || null,
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

  if (employeeId === state.employee.id) await loadEmployee();
  showToast("บันทึกการแก้ไขบัญชีเรียบร้อย");
  go("admin?tab=credentials");
  await renderRoute();
}

async function renderAdmin(params) {
  if (state.employee.role?.code !== "admin") return renderNotFound("หน้านี้สำหรับผู้ดูแลระบบเท่านั้น");
  const tab = params.get("tab") === "credentials" ? "credentials" : "requests";
  state.adminTab = tab;
  loadingShell("admin", "ผู้ดูแลระบบ");

  const [requestsResult, credentialsResult, rolesResult, departmentsResult] = await Promise.all([
    sb.rpc("app_list_account_requests", { p_status: null }),
    sb.rpc("app_list_credentials"),
    sb.from("roles").select("id,code,name_th").order("code"),
    sb.from("departments").select("id,code,name_th").eq("is_active", true).order("code"),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (credentialsResult.error) throw credentialsResult.error;
  if (rolesResult.error) throw rolesResult.error;
  if (departmentsResult.error) throw departmentsResult.error;
  const requests = requestsResult.data ?? [];
  const credentials = credentialsResult.data ?? [];
  const roles = rolesResult.data ?? [];
  const departments = departmentsResult.data ?? [];
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
        <div class="definition"><dt>ตำแหน่งในแผนก</dt><dd>${escapeHtml(positionLabels[item.position_level] ?? "—")}</dd></div>
        <div class="definition"><dt>ชื่อตำแหน่งงาน</dt><dd>${escapeHtml(item.job_title ?? "—")}</dd></div>
        <div class="definition"><dt>ติดต่อ</dt><dd>${escapeHtml(item.phone ?? item.email ?? "—")}</dd></div>
      </dl>
      ${item.reason ? `<p class="description">${escapeHtml(item.reason)}</p>` : ""}
      ${item.status === "pending" ? `
        <div class="field" style="margin-top:14px"><label for="role-${escapeHtml(item.id)}">สิทธิ์ที่ให้</label><select class="input" id="role-${escapeHtml(item.id)}" data-role-select="${escapeHtml(item.id)}"><option value="">ใช้ค่าตั้งต้นตามตำแหน่ง</option>${roles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name_th ?? role.code)}</option>`).join("")}</select></div>
        <div class="field"><label for="note-${escapeHtml(item.id)}">หมายเหตุเมื่อไม่อนุมัติ</label><input class="input" id="note-${escapeHtml(item.id)}" data-note-input="${escapeHtml(item.id)}" maxlength="1000"></div>
        <div class="approval-actions">
          <button class="btn success" data-approve="${escapeHtml(item.id)}">อนุมัติและสร้างสิทธิ์</button>
          <button class="btn danger" data-reject="${escapeHtml(item.id)}">ไม่อนุมัติ</button>
        </div>` : `<p class="muted small">${escapeHtml(item.reviewed_by_name ? `ดำเนินการโดย ${item.reviewed_by_name}` : "ดำเนินการแล้ว")}${item.reviewed_at ? ` · ${formatDate(item.reviewed_at, true)}` : ""}${item.review_note ? ` · ${escapeHtml(item.review_note)}` : ""}</p>`}
    </article>`).join("") || `<div class="empty">ยังไม่มีคำร้องเกี่ยวกับบัญชี</div>`;

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

  const content = `
    <div class="page-heading"><div><div class="eyebrow">Administration</div><h1>ผู้ดูแลระบบ</h1><p>อนุมัติคำร้องเปิดบัญชี กำหนดสิทธิ์ และค้นคืน ID/รหัสผ่านที่ออกให้</p></div></div>
    <div class="filters">
      <a class="filter${tab === "requests" ? " active" : ""}" href="#/admin?tab=requests">คำร้องบัญชี${pendingCount ? ` (${pendingCount})` : ""}</a>
      <a class="filter${tab === "credentials" ? " active" : ""}" href="#/admin?tab=credentials">คลัง ID/รหัสผ่าน</a>
    </div>
    ${tab === "requests" ? `<div class="stack">${requestCards}</div>` : `
      ${editing ? `
      <section class="card">
        <div class="card-head"><div><h2>แก้ไขบัญชี ${escapeHtml(editing.employee_no)}</h2><p class="muted small">แก้ไขได้ทุกช่องรวมถึง ID บทบาท และรหัสผ่าน การเปลี่ยนแปลงมีผลทันที</p></div><a class="btn secondary small" href="#/admin?tab=credentials">ปิด</a></div>
        <div id="employee-edit-message"></div>
        <form id="employee-edit-form" data-employee-id="${escapeHtml(editing.employee_id)}">
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
            <div class="field"><label for="edit-position">ตำแหน่งในแผนก</label><select class="input" id="edit-position" name="position_level"><option value="">ไม่ระบุ</option>${Object.entries(positionLabels).map(([value, label]) => `<option value="${value}"${value === editing.position_level ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
          </div>
          <div class="field"><label for="edit-role">บทบาท / สิทธิ์</label><select class="input" id="edit-role" name="role_id" required>${roles.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === editing.role_id ? " selected" : ""}>${escapeHtml(item.name_th ?? item.code)}</option>`).join("")}</select></div>
          <div class="field"><label for="edit-password">ตั้งรหัสผ่านใหม่ (เว้นว่างไว้หากไม่เปลี่ยน)</label><input class="input" id="edit-password" name="password" type="password" autocomplete="new-password" maxlength="72"><small>ตั้งให้ผู้ใช้ได้ทันทีเมื่อผู้ใช้ลืมรหัสผ่าน และรหัสผ่านใหม่จะถูกบันทึกลงคลังให้อัตโนมัติ</small></div>
          <div class="form-actions"><button class="btn" type="submit">บันทึกการแก้ไข</button></div>
        </form>
      </section>` : ""}
      <section class="card">
        <p class="muted small">ตารางนี้แสดงพนักงานทุกบัญชีรวมถึงบัญชีผู้ดูแลระบบและบัญชีของคุณเอง รหัสผ่านถูกปิดไว้เป็นค่าเริ่มต้น การกดแสดงถูกบันทึกลง audit log ทุกครั้งพร้อมชื่อผู้กดและเวลา บัญชีที่สร้างก่อนระบบนี้จะยังไม่มีรหัสผ่านบันทึกไว้ ให้เจ้าของบัญชีแก้ไขรหัสผ่านหนึ่งครั้งก่อน</p>
        <div class="table-wrap"><table>
          <thead><tr><th>รหัสพนักงาน</th><th>ชื่อ</th><th>แผนก</th><th>สิทธิ์</th><th>รหัสผ่าน</th><th>อัปเดตล่าสุด</th><th></th></tr></thead>
          <tbody>${credentialRows}</tbody>
        </table></div>
      </section>`}`;

  app.innerHTML = shell(content, "admin", "ผู้ดูแลระบบ");
  bindShell();

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
