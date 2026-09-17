/* global supabase */

const SUPABASE_URL = "https://iqlydmkylqyowmvpsete.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uWsULpN8jWF8XCp73B8K_A_YkbKJNUD";
const PILOT_AUTH_URL = `${SUPABASE_URL}/functions/v1/pilot-auth`;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
const state = { session: null, employee: null, unread: 0, authMode: "login" };

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

async function callPilotAuth(payload) {
  const response = await fetch(PILOT_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      INVALID_CREDENTIALS: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง",
      INVALID_INVITE: "Invite code ไม่ถูกต้องหรือไม่ตรงกับรหัสพนักงาน",
      EMPLOYEE_NOT_FOUND: "ไม่พบรหัสพนักงานสำหรับทดสอบ",
      ACCOUNT_ALREADY_REGISTERED: "บัญชีนี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบ",
      ACCOUNT_CREATE_FAILED: "สร้างบัญชีไม่สำเร็จ โปรดลองรหัสผ่านอื่น",
      ACCOUNT_LINK_FAILED: "ไม่สามารถผูกบัญชีกับพนักงานได้",
    };
    throw new Error(messages[result.error] ?? "เชื่อมต่อระบบยืนยันตัวตนไม่สำเร็จ");
  }
  return result;
}

function renderAuth() {
  const isRegister = state.authMode === "register";
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
            <button type="button" data-auth-mode="login" class="${isRegister ? "" : "active"}">เข้าสู่ระบบ</button>
            <button type="button" data-auth-mode="register" class="${isRegister ? "active" : ""}">เปิดบัญชีทดสอบ</button>
          </div>
          <h2>${isRegister ? "เปิดบัญชีทดสอบ" : "เข้าสู่ระบบพนักงาน"}</h2>
          <p>${isRegister ? "ใช้รหัสพนักงานและ invite code ที่ได้รับจากผู้ดูแล" : "ใช้รหัสพนักงานและรหัสผ่านของคุณ"}</p>
          <div id="auth-message"></div>
          <form id="auth-form">
            <div class="field"><label for="employee-no">รหัสพนักงาน</label><input class="input" id="employee-no" name="employee_no" autocomplete="username" maxlength="32" placeholder="เช่น MNP0102" required></div>
            ${isRegister ? `<div class="field"><label for="invite-code">Invite code</label><input class="input" id="invite-code" name="invite_code" autocomplete="one-time-code" required><small>ใช้ได้เฉพาะรหัสพนักงานทดลองที่กำหนดไว้</small></div>` : ""}
            <div class="field"><label for="password">รหัสผ่าน</label><input class="input" id="password" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" maxlength="72" required><small>อย่างน้อย 8 ตัวอักษร</small></div>
            ${isRegister ? `<div class="field"><label for="confirm-password">ยืนยันรหัสผ่าน</label><input class="input" id="confirm-password" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div>` : ""}
            <button class="btn block" type="submit">${isRegister ? "ลงทะเบียนและเข้าสู่ระบบ" : "เข้าสู่ระบบ"}</button>
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
  document.querySelector("#auth-form").addEventListener("submit", handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#auth-message");
  const values = new FormData(form);
  const employeeNo = String(values.get("employee_no") ?? "").trim().toUpperCase();
  const password = String(values.get("password") ?? "");
  const isRegister = state.authMode === "register";
  if (isRegister && password !== String(values.get("confirm_password") ?? "")) {
    message.innerHTML = `<div class="form-message error">รหัสผ่านทั้งสองช่องไม่ตรงกัน</div>`;
    return;
  }
  setFormBusy(form, true);
  message.innerHTML = "";
  try {
    const tokens = await callPilotAuth({
      action: isRegister ? "register" : "login",
      employeeNo,
      password,
      ...(isRegister ? { inviteCode: String(values.get("invite_code") ?? "").trim() } : {}),
    });
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

async function loadEmployee() {
  if (!state.session?.user) return null;
  const { data, error } = await sb
    .from("employees")
    .select("id,employee_no,first_name,last_name,email,job_title,department_id,role_id,manager_id,role:roles(code,name_th),department:departments(code,name_th)")
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
    renderAuth();
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

async function renderNotifications() {
  loadingShell("notifications", "การแจ้งเตือน");
  const { data, error } = await sb.from("notifications").select("*").eq("recipient_id", state.employee.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">Notifications</div><h1>การแจ้งเตือน</h1><p>ความเคลื่อนไหวที่เกี่ยวข้องกับบัญชีนี้</p></div>${(data ?? []).some((item) => !item.read_at) ? `<button class="btn secondary" id="mark-read">อ่านทั้งหมดแล้ว</button>` : ""}</div>
    <div class="stack">${(data ?? []).map((item) => `<a class="notification-item${item.read_at ? "" : " unread"}" href="${item.request_id ? `#/request?id=${encodeURIComponent(item.request_id)}` : "#/notifications"}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body ?? "")} · ${formatDate(item.created_at, true)}</span></a>`).join("") || `<div class="empty">ยังไม่มีการแจ้งเตือน</div>`}</div>`;
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

function renderProfile() {
  const employee = state.employee;
  const content = `
    <div class="page-heading"><div><div class="eyebrow">My account</div><h1>ข้อมูลส่วนตัว</h1><p>ข้อมูลที่ใช้กำหนดบทบาทและสิทธิ์ในระบบ</p></div></div>
    <section class="card" style="max-width:780px"><div style="display:flex;align-items:center;gap:13px;margin-bottom:20px"><div class="avatar" style="width:52px;height:52px;font-size:15px">${escapeHtml(initials(employee))}</div><div><h2>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</h2><span class="badge">${escapeHtml(employee.role?.name_th ?? "พนักงาน")}</span></div></div><div class="profile-grid"><div class="profile-row"><span>รหัสพนักงาน</span><strong>${escapeHtml(employee.employee_no)}</strong></div><div class="profile-row"><span>ตำแหน่ง</span><strong>${escapeHtml(employee.job_title ?? "—")}</strong></div><div class="profile-row"><span>หน่วยงาน</span><strong>${escapeHtml(employee.department?.name_th ?? "—")}</strong></div><div class="profile-row"><span>บทบาท</span><strong>${escapeHtml(employee.role?.name_th ?? "—")}</strong></div></div><div class="pilot-note">บัญชีนี้อยู่ในระบบ Pilot Web การอนุมัติและการเปลี่ยนสถานะถูกตรวจสอบสิทธิ์ที่ฐานข้อมูลทุกครั้ง</div></section>`;
  app.innerHTML = shell(content, "profile", "ข้อมูลส่วนตัว");
  bindShell();
}

function renderNotFound(message = "ไม่พบหน้าที่ต้องการ") {
  app.innerHTML = state.employee
    ? shell(`<div class="empty"><h2>${escapeHtml(message)}</h2><a class="btn secondary" href="#/dashboard">กลับหน้าหลัก</a></div>`, "", "ไม่พบข้อมูล")
    : `<main class="boot-screen"><h2>${escapeHtml(message)}</h2></main>`;
  if (state.employee) bindShell();
}

async function renderRoute() {
  if (!state.session) {
    renderAuth();
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
    if (path === "profile") return renderProfile();
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
