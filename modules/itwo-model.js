// ใบสั่งงาน IT (IT01-FM06) — ส่วนข้อมูลล้วนของหน้าเว็บ ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itwo-model.test.mjs)
// ที่มา: ย้ายป้ายข้อความ ลำดับช่อง และกติกาตรวจฟอร์มจากระบบ Work-Order เดิม (src/lib/workOrderHelpers.ts, workflowHelpers.ts)
// ฐานข้อมูลเป็นผู้ตัดสินทุกอย่าง (เลขที่เอกสาร สิทธิ์ ลำดับขั้น): ไฟล์นี้แค่ตั้งชื่อ จัดกลุ่ม ซ่อน/แสดงปุ่มตาม my_role / allowed_actions
// และตรวจฟอร์มให้ผู้ใช้เห็นข้อความไทยก่อนส่ง (ฐานข้อมูลตรวจซ้ำเสมอ)
// วันที่แสดงเป็น วว/ดด/ปปปป (พ.ศ.) เวลา Asia/Bangkok — เปลี่ยนปีเป็น ค.ศ. ได้ที่ YEAR_OFFSET จุดเดียว
(function (root) {
  "use strict";

  const YEAR_OFFSET = 543;
  const MAX_DETAILS = 2000;
  const MAX_ORDER_REF = 100;
  const MAX_ATTACHMENT_NOTE = 200;
  const MAX_REASON = 500;
  const MAX_ACCESS_ROWS = 20;
  const MAX_ACCESS_USERNAME = 100;
  const MAX_ACCESS_NOTE = 500;
  const DURATION_NOTE = "งานออกแบบและงานสิทธิ์ 3–7 วันนับจากวันที่ได้ข้อมูลครบ งานเบ็ดเตล็ดตามตกลง";

  const REQUEST_TYPES = Object.freeze([
    { value: "design", label: "งานออกแบบ" },
    { value: "system_access", label: "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" },
    { value: "misc", label: "เบ็ดเตล็ดอื่นๆ" },
  ]);
  const ATTACHMENT_FLAGS = Object.freeze([
    { value: "yes", label: "มี" },
    { value: "no", label: "ไม่มี" },
    { value: "other", label: "อื่นๆ" },
  ]);
  const ACCESS_SYSTEMS = Object.freeze([
    { value: "i_prime", label: "I-Prime System" },
    { value: "express", label: "Express System" },
    { value: "email", label: "E-Mail Address" },
    { value: "other", label: "อื่นๆ ระบุ" },
  ]);
  const ACCESS_ACTIONS = Object.freeze([
    { value: "add", label: "เพิ่ม" },
    { value: "change", label: "เปลี่ยน" },
    { value: "cancel", label: "ยกเลิก" },
  ]);

  const labelOf = (list, value) => list.find((item) => item.value === value)?.label ?? value ?? "";
  const requestTypeLabel = (value) => labelOf(REQUEST_TYPES, value);
  const attachmentFlagLabel = (value) => labelOf(ATTACHMENT_FLAGS, value);
  const accessSystemLabel = (value) => labelOf(ACCESS_SYSTEMS, value);
  const accessActionLabel = (value) => labelOf(ACCESS_ACTIONS, value);

  /* ---------- สถานะ ---------- */
  const STATUS_LABELS = Object.freeze({
    pending_dept: "รอผู้จัดการแผนก",
    pending_it_mgr: "รอผู้อนุมัติขั้น IT",
    approved: "อนุมัติครบ",
    in_progress: "กำลังดำเนินการ",
    it_closed: "IT ปิดงาน (รอผู้แจ้งยืนยัน)",
    received: "ได้รับงานแล้ว",
    rejected: "ไม่อนุมัติ",
    cancelled: "ยกเลิก",
  });
  // ป้ายสถานะใช้ class .badge ของระบบ (styles.css) จึงแปลงสถานะของใบสั่งงานเป็นชื่อ class ที่ระบบมีสีให้แล้ว
  const STATUS_BADGE_CLASS = Object.freeze({
    pending_dept: "pending_approval",
    pending_it_mgr: "pending_approval",
    approved: "approved",
    in_progress: "in_progress",
    it_closed: "pending_verify",
    received: "completed",
    rejected: "rejected",
    cancelled: "cancelled",
  });
  const statusLabel = (status) => STATUS_LABELS[status] ?? status ?? "";
  const statusBadgeClass = (status) => STATUS_BADGE_CLASS[status] ?? "";
  // ผู้แจ้งเห็นคำที่บอกว่าถึงคิวของตัวเอง (หน้า "ใบของฉัน")
  const myStatusLabel = (status) => (status === "it_closed" ? "IT ปิดงานแล้ว รอคุณยืนยัน" : statusLabel(status));
  const isTestDoc = (docNo) => String(docNo ?? "").startsWith("TEST-");

  /* ---------- วันที่ / เวลา ---------- */
  const pad = (value) => String(value).padStart(2, "0");
  const BANGKOK = { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  function bangkokParts(date) {
    const parts = {};
    for (const part of new Intl.DateTimeFormat("en-GB", BANGKOK).formatToParts(date)) parts[part.type] = part.value;
    return parts;
  }
  // วันนี้ตามเวลาไทย YYYY-MM-DD (ค.ศ.) ใช้เป็นค่าต่ำสุดของวันที่ต้องการงาน
  function todayBangkok(now = new Date()) {
    const { year, month, day } = bangkokParts(now);
    return `${year}-${month}-${day}`;
  }
  // วันที่ล้วน (คอลัมน์ date) ไม่ผ่านเขตเวลา วันจึงไม่เลื่อน
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
  const isRealDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  const charCount = (value) => Array.from(String(value ?? "").trim()).length;
  const clip = (text, max) => {
    const chars = Array.from(String(text ?? "").replace(/\s+/g, " ").trim());
    return chars.length <= max ? chars.join("") : `${chars.slice(0, max).join("")}…`;
  };
  // ชื่อแผนกจากฐานข้อมูลเป็นชื่อไทยเต็มอยู่แล้ว (เช่น "เทคโนโลยีสารสนเทศ") ไม่เติมคำนำหน้า

  /* ---------- สิทธิ์ → แท็บ ---------- */
  // role = ผลของ app_itwo_my_role · แท็บเป็น UX ล้วน ฐานข้อมูลตรวจสิทธิ์ซ้ำทุก RPC
  function visibleTabs(role) {
    const tabs = [{ key: "mine", label: "ใบของฉัน" }];
    if (role?.is_dept_approver || role?.is_it_approver) tabs.push({ key: "approvals", label: "รออนุมัติ" });
    if (role?.is_it_admin || role?.is_it_approver) tabs.push({ key: "it", label: "งาน IT" });
    if (role?.is_it_admin) tabs.push({ key: "settings", label: "ตั้งค่า" });
    return tabs;
  }
  const VIEWS = Object.freeze(["mine", "approvals", "it", "settings", "new", "order", "print"]);
  const TAB_VIEWS = Object.freeze(["mine", "approvals", "it", "settings"]);
  function readView(params) {
    const view = params?.get?.("view") ?? "";
    if (view === "") return "mine";
    return VIEWS.includes(view) ? view : null;
  }
  // หน้าแท็บที่ผู้ใช้ไม่มีสิทธิ์เห็น (พิมพ์ URL เอง) ให้กลับ "ใบของฉัน" · หน้าอื่นไม่ใช่แท็บ
  const viewAllowed = (view, role) => !TAB_VIEWS.includes(view) || visibleTabs(role).some((tab) => tab.key === view);
  function workOrderUrl(view = "mine", extra = {}) {
    const query = new URLSearchParams({ module: "work-order" });
    if (view && view !== "mine") query.set("view", view);
    for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
    return `#/office?${query.toString()}`;
  }
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));

  /* ---------- ปุ่มตาม allowed_actions ---------- */
  // ลำดับปุ่ม: ตัดสินใจก่อน แล้วขั้นตอนของ IT แล้วของผู้แจ้ง · reason = ต้องกรอกเหตุผล (ไม่อนุมัติ/ยกเลิก) · tone ใช้เลือกสีปุ่ม
  const ACTION_BUTTONS = Object.freeze({
    approve: { label: "อนุมัติ", tone: "success", rpc: "app_itwo_approve", done: "อนุมัติแล้ว", confirmTitle: "อนุมัติใบสั่งงานนี้?", confirmMessage: "การกดอนุมัติบันทึกชื่อ วันที่ และเวลาของคุณเป็นลายเซ็นอิเล็กทรอนิกส์ แก้ไขย้อนหลังไม่ได้" },
    reject: { label: "ไม่อนุมัติ", tone: "danger", rpc: "app_itwo_reject", done: "บันทึกการไม่อนุมัติแล้ว", reason: { title: "ไม่อนุมัติใบสั่งงานนี้?", label: "เหตุผลที่ไม่อนุมัติ", hint: "ใบนี้จะจบทันทีและเปิดใหม่ไม่ได้ ผู้แจ้งต้องแจ้งเป็นใบใหม่", confirmLabel: "ไม่อนุมัติ" } },
    start: { label: "เริ่มดำเนินการ", tone: "primary", rpc: "app_itwo_start", done: "เริ่มดำเนินการแล้ว", confirmTitle: "เริ่มดำเนินการใบสั่งงานนี้?", confirmMessage: "ระบบบันทึกว่าคุณเป็นผู้รับงานนี้ พร้อมวันและเวลา" },
    complete: { label: "ปิดงาน", tone: "success", rpc: "app_itwo_complete", done: "ปิดงานแล้ว รอผู้แจ้งยืนยันรับงาน", confirmTitle: "ปิดงานใบสั่งงานนี้?", confirmMessage: "เมื่อปิดงานแล้วแก้ส่วนสำหรับแผนก IT ไม่ได้ และผู้แจ้งยกเลิกใบไม่ได้" },
    receive: { label: "ได้รับงานเรียบร้อยแล้ว", tone: "success", rpc: "app_itwo_receive", done: "ยืนยันรับงานแล้ว", confirmTitle: "ยืนยันว่าได้รับงานเรียบร้อยแล้ว?", confirmMessage: "ใบสั่งงานจะจบทันที ทำซ้ำหรือแก้ไขไม่ได้" },
    cancel: { label: "ยกเลิกใบสั่งงาน", tone: "danger", rpc: "app_itwo_cancel", done: "ยกเลิกใบสั่งงานแล้ว", reason: { title: "ยกเลิกใบสั่งงานนี้?", label: "เหตุผลที่ยกเลิก", hint: "ใบที่ยกเลิกแล้วเปิดใหม่ไม่ได้ ต้องแจ้งเป็นใบใหม่และได้เลขใหม่", confirmLabel: "ยกเลิกใบสั่งงาน" } },
  });
  const ACTION_ORDER = Object.freeze(["approve", "reject", "start", "complete", "receive", "cancel"]);
  // allowed = allowed_actions จาก app_itwo_get_detail · action ที่ไม่รู้จัก (และ edit_access ซึ่งเป็นส่วนฟอร์ม ไม่ใช่ปุ่ม) ไม่ขึ้นเป็นปุ่ม
  function actionButtons(allowed) {
    const set = new Set(Array.isArray(allowed) ? allowed : []);
    return ACTION_ORDER.filter((action) => set.has(action)).map((action) => ({ action, ...ACTION_BUTTONS[action] }));
  }
  const canEditAccess = (allowed) => Array.isArray(allowed) && allowed.includes("edit_access");

  const PENDING_STEP_LABELS = Object.freeze({ dept: "รอคุณอนุมัติขั้นผู้จัดการแผนก", it_mgr: "รอคุณอนุมัติขั้น IT" });
  const pendingStepLabel = (step) => PENDING_STEP_LABELS[step] ?? step ?? "";

  /* ---------- ประวัติ / ลายเซ็น ---------- */
  const EVENT_LABELS = Object.freeze({
    created: "แจ้งงาน",
    dept_approved: "ผู้จัดการแผนกอนุมัติ",
    dept_rejected: "ผู้จัดการแผนกไม่อนุมัติ",
    it_mgr_approved: "ผู้อนุมัติขั้น IT อนุมัติ",
    it_mgr_rejected: "ผู้อนุมัติขั้น IT ไม่อนุมัติ",
    cancelled: "ผู้แจ้งยกเลิก",
    started: "IT เริ่มดำเนินการ",
    completed: "IT ปิดงาน",
    received: "ผู้แจ้งยืนยันรับงาน",
  });
  const eventLabel = (action) => EVENT_LABELS[action] ?? action ?? "";

  // ช่องลายเซ็นบนฟอร์ม (ตามลำดับบนกระดาษ) ใช้ event แรกของแต่ละการกระทำ ยังไม่มี = เว้นช่อง
  const SIGNATURE_SLOTS = Object.freeze([
    { key: "requester", label: "ผู้แจ้ง", action: "created" },
    { key: "dept_manager", label: "ผู้จัดการแผนก", action: "dept_approved" },
    { key: "it_approver", label: "ผู้อนุมัติขั้น IT", action: "it_mgr_approved" },
    { key: "it_operator", label: "IT ผู้ดำเนินการ (ปิดงาน)", action: "completed", startedAction: "started" },
    { key: "receiver", label: "ผู้รับงาน", action: "received" },
  ]);
  const SINGLE_CLICK_REMARK = "อนุมัติครั้งเดียว นับเป็นทั้งสองขั้น";
  const SELF_APPROVED_REMARK = "อนุมัติในตัวเมื่อแจ้งงาน";
  const sameActor = (a, b) => Boolean(a && b) && (a.actor_employee_no && b.actor_employee_no ? a.actor_employee_no === b.actor_employee_no : a.actor_full_name === b.actor_full_name);
  // หมายเหตุใต้ช่องลายเซ็นอนุมัติ: คนเดียวกดอนุมัติทั้งสองขั้น (แผนก IT / แผนกไม่มีผู้จัดการ / ผู้อนุมัติขั้น IT แจ้งเอง) ให้ชื่อเดียวกันขึ้นทั้งสองช่องพร้อมบอกเหตุ
  // ผู้จัดการแผนกที่แจ้งเอง (อนุมัติขั้นแผนกในตัว) บอกว่าเป็นการอนุมัติในตัว ไม่ใช่การเซ็นของคนอื่น
  function approvalRemark(slotKey, events) {
    const dept = events.find((item) => item.action === "dept_approved");
    const itMgr = events.find((item) => item.action === "it_mgr_approved");
    if (!dept) return null;
    if (itMgr && sameActor(dept, itMgr)) return SINGLE_CLICK_REMARK;
    const created = events.find((item) => item.action === "created");
    if (slotKey === "dept_manager" && sameActor(dept, created)) return SELF_APPROVED_REMARK;
    return null;
  }
  function signatureSlots(events) {
    const list = Array.isArray(events) ? events : [];
    return SIGNATURE_SLOTS.map((slot) => {
      const event = list.find((item) => item.action === slot.action);
      const started = slot.startedAction ? list.find((item) => item.action === slot.startedAction) : null;
      const isApprovalSlot = slot.key === "dept_manager" || slot.key === "it_approver";
      return {
        key: slot.key,
        label: slot.label,
        name: event?.actor_full_name ?? null,
        at: event?.created_at ?? null,
        // ช่อง IT แสดงผู้รับงาน (เริ่มดำเนินการ) ไว้ด้วย เพราะฟอร์มกระดาษมีช่อง "IT รับงาน"
        note: started ? { label: "รับงาน", name: started.actor_full_name, at: started.created_at } : null,
        remark: event && isApprovalSlot ? approvalRemark(slot.key, list) : null,
      };
    });
  }

  // สรุปอนุมัติ 2 ขั้นในหน้ารายละเอียด: อนุมัติแล้ว · ไม่อนุมัติ (ดูจาก events) · รอ · ไม่มี (ใบจบไปก่อนถึงขั้นนี้)
  function approvalSummary(detail) {
    const events = Array.isArray(detail?.events) ? detail.events : [];
    const closedWithoutDecision = detail?.status === "cancelled" || detail?.status === "rejected";
    return [
      { key: "dept", label: "ผู้จัดการแผนก", rejectedAction: "dept_rejected" },
      { key: "it_mgr", label: "ผู้อนุมัติขั้น IT", rejectedAction: "it_mgr_rejected" },
    ].map((step) => {
      const approved = detail?.approvals?.[step.key];
      if (approved) return { key: step.key, label: step.label, state: "approved", by: approved.by, at: approved.at };
      const rejection = events.find((event) => event.action === step.rejectedAction);
      if (rejection) return { key: step.key, label: step.label, state: "rejected", by: rejection.actor_full_name, at: rejection.created_at };
      return { key: step.key, label: step.label, state: closedWithoutDecision ? "none" : "waiting", by: null, at: null };
    });
  }
  const APPROVAL_STATE_LABELS = Object.freeze({ approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ", waiting: "รอ", none: "—" });

  /* ---------- งาน IT: จัดกลุ่ม ---------- */
  const IT_GROUPS = Object.freeze([
    { key: "to_start", label: "รอเริ่มงาน" },
    { key: "in_progress", label: "กำลังดำเนินการ" },
    { key: "awaiting_receive", label: "รอผู้แจ้งยืนยัน" },
    { key: "awaiting_approval", label: "รออนุมัติ" },
    { key: "closed", label: "จบแล้ว / ไม่อนุมัติ / ยกเลิก" },
  ]);
  // รอเริ่มงาน = อนุมัติครบแล้ว หรืองานด่วนที่ยังรออนุมัติ (IT เริ่มทำก่อนได้) · รออนุมัติ = งานปกติที่ยังอนุมัติไม่ครบ
  function itGroupOf(row) {
    switch (row?.status) {
      case "approved": return "to_start";
      case "pending_dept":
      case "pending_it_mgr": return row.is_urgent ? "to_start" : "awaiting_approval";
      case "in_progress": return "in_progress";
      case "it_closed": return "awaiting_receive";
      default: return "closed";
    }
  }
  const byText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  // งานที่ยังไม่จบ: งานด่วนก่อน แล้ววันที่ต้องการงาน แล้วเวลาที่แจ้ง แล้วเลขที่เอกสาร
  const compareActive = (a, b) => (a.is_urgent === b.is_urgent ? 0 : a.is_urgent ? -1 : 1)
    || byText(a.needed_date, b.needed_date) || byText(a.created_at, b.created_at) || byText(a.doc_no, b.doc_no);
  // งานที่จบแล้ว ใบใหม่สุดก่อน
  const compareClosed = (a, b) => byText(b.created_at, a.created_at) || byText(b.doc_no, a.doc_no);
  function groupItOrders(rows) {
    const groups = Object.fromEntries(IT_GROUPS.map((group) => [group.key, []]));
    for (const row of Array.isArray(rows) ? rows : []) groups[itGroupOf(row)].push(row);
    for (const key of Object.keys(groups)) groups[key].sort(key === "closed" ? compareClosed : compareActive);
    return groups;
  }
  // งาน IT ที่ต้องลงมือ (ตัวเลขบนแท็บ/การ์ด): รอเริ่มงาน + กำลังดำเนินการ
  const itActionableCount = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => ["to_start", "in_progress"].includes(itGroupOf(row))).length;
  // รายการที่รอผู้แจ้งยืนยัน (ตัวเลขบนการ์ดของผู้แจ้ง)
  const awaitingMyReceiveCount = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row.status === "it_closed").length;
  const itApprovalProgress = (row) => [
    { label: "ผู้จัดการแผนก", done: Boolean(row?.has_dept_approved) },
    { label: "ผู้อนุมัติขั้น IT", done: Boolean(row?.has_it_mgr_approved) },
  ];

  /* ---------- ตัวเลขบนการ์ด ---------- */
  // รวมงานที่รอ "คุณ": อนุมัติ + งาน IT ที่ต้องลงมือ + ใบที่รอคุณยืนยันรับ · ค่าที่นับไม่ได้ (null) ข้ามไป ไม่ทำให้ทั้งการ์ดล้ม
  function cardSummary({ approvals = null, itWork = null, toConfirm = null } = {}) {
    const parts = [
      { key: "approvals", label: "รออนุมัติ", count: approvals },
      { key: "it", label: "งาน IT ค้าง", count: itWork },
      { key: "confirm", label: "รอคุณยืนยันรับงาน", count: toConfirm },
    ].filter((part) => Number.isFinite(part.count) && part.count > 0);
    const total = parts.reduce((sum, part) => sum + part.count, 0);
    return {
      total,
      parts,
      badge: total > 0 ? `${total} รอคุณ` : "",
      title: parts.map((part) => `${part.label} ${part.count}`).join(" · "),
    };
  }

  /* ---------- ฟอร์มแจ้งงาน ---------- */
  const EMPTY_ORDER_FORM = Object.freeze({ request_type: "", order_ref: "", attachment_flag: "no", attachment_note: "", details: "", needed_date: "", is_urgent: false });
  // กติกาตามรูปแบบของ MNP_FORM_STEPS (modules/form-steps.js): step 1 = งานอะไร · step 2 = ต้องการเมื่อไร
  // required ของหมายเหตุเอกสารแนบเป็น getter เพราะขึ้นกับค่าที่เลือก ณ ตอนตรวจ · today() อ่านใหม่ทุกครั้ง ฟอร์มที่เปิดค้างข้ามเที่ยงคืนต้องไม่ปล่อยวันที่เมื่อวาน
  function orderRules({ today = () => todayBangkok(), attachmentFlag = () => "no" } = {}) {
    return [
      { name: "request_type", step: 1, required: true, message: "กรุณาเลือกประเภทคำขอ" },
      { name: "order_ref", step: 1, check: (value) => charCount(value) <= MAX_ORDER_REF, checkMessage: `ออเดอร์ต้องไม่เกิน ${MAX_ORDER_REF} ตัวอักษร` },
      {
        name: "attachment_note", step: 1, message: "กรุณาระบุเอกสารแนบ (เมื่อเลือก \"อื่นๆ\")",
        get required() { return attachmentFlag() === "other"; },
        check: (value) => charCount(value) <= MAX_ATTACHMENT_NOTE, checkMessage: `เอกสารแนบต้องไม่เกิน ${MAX_ATTACHMENT_NOTE} ตัวอักษร`,
      },
      { name: "details", step: 1, required: true, message: "กรุณากรอกรายละเอียดงาน", check: (value) => charCount(value) <= MAX_DETAILS, checkMessage: `รายละเอียดต้องไม่เกิน ${MAX_DETAILS.toLocaleString("en-US")} ตัวอักษร` },
      {
        name: "needed_date", step: 2, required: true, message: "กรุณาเลือกวันที่ต้องการงาน",
        check: (value) => isRealDate(value) && value >= today(),
        checkMessage: "วันที่ต้องการงานต้องเป็นวันนี้หรือหลังจากนี้",
      },
    ];
  }
  // พารามิเตอร์ของ app_itwo_create (ตัดช่องว่าง ไม่ส่งหมายเหตุเอกสารแนบเมื่อไม่ได้เลือก "อื่นๆ") · เลขที่เอกสาร ผู้แจ้ง แผนก วันเวลา ฐานข้อมูลเติมเอง
  function createParams(values) {
    const text = (value) => String(value ?? "").trim();
    return {
      p_request_type: text(values.request_type),
      p_order_ref: text(values.order_ref) || null,
      p_attachment_flag: text(values.attachment_flag),
      p_attachment_note: values.attachment_flag === "other" ? text(values.attachment_note) : null,
      p_details: text(values.details),
      p_needed_date: text(values.needed_date),
      p_is_urgent: Boolean(values.is_urgent),
    };
  }

  /* ---------- เหตุผลไม่อนุมัติ / ยกเลิก ---------- */
  function validateReason(reason, kind = "ไม่อนุมัติ") {
    const text = String(reason ?? "").trim();
    if (!text) return `กรุณาระบุเหตุผลที่${kind}`;
    if (charCount(text) > MAX_REASON) return `เหตุผลต้องไม่เกิน ${MAX_REASON} ตัวอักษร`;
    return null;
  }

  /* ---------- ส่วน "สำหรับแผนก IT" (สิทธิ์ในระบบ) ---------- */
  const blankAccessDraft = (key) => ({ key, system: "", action: "", newUsername: "", oldUsername: "", note: "" });
  const draftsFromAccessChanges = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
    key: row.id,
    system: ACCESS_SYSTEMS.some((item) => item.value === row.system) ? row.system : "",
    action: ACCESS_ACTIONS.some((item) => item.value === row.action) ? row.action : "",
    newUsername: row.new_username ?? "",
    oldUsername: row.old_username ?? "",
    note: row.note ?? "",
  }));
  const isBlankAccessDraft = (draft) => !draft.system && !draft.action && !String(draft.newUsername).trim() && !String(draft.oldUsername).trim() && !String(draft.note).trim();
  // คืนข้อความผิดของแต่ละแถวที่ไม่ว่าง (key = ลำดับแถวใน drafts) และข้อความภาพรวม
  function validateAccessChanges(drafts) {
    const rows = {};
    let filled = 0;
    (Array.isArray(drafts) ? drafts : []).forEach((draft, index) => {
      if (isBlankAccessDraft(draft)) return;
      filled += 1;
      if (!draft.system) rows[index] = "กรุณาเลือกระบบ";
      else if (!draft.action) rows[index] = "กรุณาเลือกการดำเนินการ (เพิ่ม / เปลี่ยน / ยกเลิก)";
      else if (charCount(draft.newUsername) > MAX_ACCESS_USERNAME || charCount(draft.oldUsername) > MAX_ACCESS_USERNAME) rows[index] = `ชื่อผู้ใช้ต้องไม่เกิน ${MAX_ACCESS_USERNAME} ตัวอักษร`;
      else if (charCount(draft.note) > MAX_ACCESS_NOTE) rows[index] = `หมายเหตุต้องไม่เกิน ${MAX_ACCESS_NOTE} ตัวอักษร`;
    });
    return { rows, general: filled > MAX_ACCESS_ROWS ? `บันทึกได้ไม่เกิน ${MAX_ACCESS_ROWS} รายการต่อใบ` : null };
  }
  const hasAccessErrors = (validation) => validation.general !== null || Object.keys(validation.rows).length > 0;
  // p_changes ของ app_itwo_save_access_changes: ตัดแถวว่าง ตัดช่องว่าง ช่องว่างส่งเป็น null
  const accessPayload = (drafts) => (Array.isArray(drafts) ? drafts : []).filter((draft) => !isBlankAccessDraft(draft)).map((draft) => ({
    system: draft.system,
    action: draft.action,
    new_username: String(draft.newUsername).trim() || null,
    old_username: String(draft.oldUsername).trim() || null,
    note: String(draft.note).trim() || null,
  }));
  // ตารางสิทธิ์บนฟอร์มพิมพ์: มี 4 ระบบเสมอ (ระบบที่ไม่มีรายการเป็นแถวว่าง) ระบบที่มีหลายรายการมีหลายแถว แสดงชื่อระบบเฉพาะแถวแรก
  function accessPrintRows(changes) {
    const list = Array.isArray(changes) ? changes : [];
    const rows = [];
    for (const system of ACCESS_SYSTEMS) {
      const items = list.filter((change) => change.system === system.value);
      if (!items.length) {
        rows.push({ key: `${system.value}-empty`, systemLabel: system.label, showSystemLabel: true, action: null, newUsername: "", oldUsername: "", note: "" });
        continue;
      }
      items.forEach((item, index) => rows.push({
        key: item.id ?? `${system.value}-${index}`, systemLabel: system.label, showSystemLabel: index === 0,
        action: item.action, newUsername: item.new_username ?? "", oldUsername: item.old_username ?? "", note: item.note ?? "",
      }));
    }
    return rows;
  }

  /* ---------- ตั้งค่า (it_admin) ---------- */
  // เลขที่เอกสารตัวอย่างสำหรับให้เห็นก่อนกดบันทึก (รูปแบบเดียวกับ private.itwo_format_doc_no) · ฐานข้อมูลออกเลขจริงเองเสมอ
  function formatDocNo(isTest, year, seq) {
    const seqText = seq < 1000 ? String(seq).padStart(3, "0") : String(seq);
    return `${isTest ? "TEST-" : ""}IT06-${pad(year % 100)}/${seqText}`;
  }
  // เลขถัดไปตั้งได้เฉพาะเดินหน้า (ฐานข้อมูลตรวจซ้ำ) · nextSeq = เลขถัดไปปัจจุบัน
  function validateNextSeq(value, nextSeq) {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) return "กรุณากรอกเลขถัดไปเป็นจำนวนเต็ม";
    const number = Number(text);
    if (number < 1 || number > 9999) return "เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999";
    if (number <= nextSeq) return `ตั้งได้เฉพาะเลขที่มากกว่าเลขถัดไปปัจจุบัน (${nextSeq}) เท่านั้น ถอยหลังหรือซ้ำไม่ได้`;
    return null;
  }
  // แถวของตัวเองแก้ไม่ได้ทุกกรณี (ฐานข้อมูลบังคับ: แยกหน้าที่ กันยกตัวเองเป็นผู้อนุมัติขั้น IT) · ในโหมดทดสอบแก้ทีมไม่ได้
  function staffEditBlock({ row, myEmployeeId, isTest }) {
    if (isTest) return "ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้";
    if (row?.employee_id && row.employee_id === myEmployeeId) return "แก้สิทธิ์ของตัวเองไม่ได้ ให้ผู้ดูแลงาน IT คนอื่นตั้งให้";
    return "";
  }
  // ตัวเลือกพนักงานสำหรับกล่องค้นหา (searchable-select ทำงานกับ <select>): "รหัส ชื่อ · แผนก" เรียงตามรหัส · ตัดคนที่ปิดใช้งานและคนที่ไม่มีรหัส
  function staffCandidateOptions(employees) {
    return (Array.isArray(employees) ? employees : [])
      .filter((person) => person?.employee_no && person.is_active !== false)
      .map((person) => ({
        value: person.employee_no,
        label: `${person.employee_no} ${[person.first_name, person.last_name].filter(Boolean).join(" ")}${person.department?.name_th ? ` · ${person.department.name_th}` : ""}`,
      }))
      .sort((a, b) => (a.value === b.value ? 0 : a.value < b.value ? -1 : 1));
  }
  // myEmployeeNo = รหัสของผู้ใช้เอง: ฐานข้อมูลห้ามแก้สิทธิ์ตัวเองทุกกรณี หน้าเว็บบอกก่อนส่ง (เทียบไม่สนตัวพิมพ์)
  function validateStaffForm({ employeeNo, isAdmin, isApprover, myEmployeeNo = "" }) {
    if (!String(employeeNo ?? "").trim()) return "กรุณาเลือกหรือกรอกรหัสพนักงาน";
    if (myEmployeeNo && String(employeeNo).trim().toUpperCase() === String(myEmployeeNo).trim().toUpperCase()) return "แก้สิทธิ์ของตัวเองไม่ได้ ให้ผู้ดูแลงาน IT คนอื่นตั้งให้";
    if (!isAdmin && !isApprover) return "เลือกสิทธิ์อย่างน้อย 1 อย่าง (ถ้าต้องการถอนสิทธิ์ใช้ปุ่ม \"ถอนสิทธิ์\" ในรายชื่อ)";
    return null;
  }
  const staffRoleText = (row) => [row?.is_it_admin ? "ผู้ดูแลงาน IT" : "", row?.is_it_approver ? "ผู้อนุมัติขั้น IT" : ""].filter(Boolean).join(" · ");

  /* ---------- error จาก RPC ---------- */
  // kind: "session" เซสชันหมดอายุ · "unknown" ไม่ได้คำตอบจากเซิร์ฟเวอร์ (ผลไม่แน่ชัด) · "missing" ฐานข้อมูลยังไม่มีฟังก์ชัน · "rejected" เซิร์ฟเวอร์ตอบปฏิเสธ
  // ข้อความไทยของฐานข้อมูล (errcode 42501 / 23514) ส่งต่อให้ผู้ใช้ตรงๆ ส่วนข้อความเทคนิคภาษาอังกฤษไม่แสดง
  const THAI = /[\u0E00-\u0E7F]/;
  const NETWORK = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|internet connection appears to be offline|failed to send a request|err_internet|err_network|econnreset|the request timed out/i;
  const SESSION_CODES = ["PGRST301", "PGRST303", "AUTH_REQUIRED"];
  const SESSION_MESSAGE = "หมดเวลาการเข้าสู่ระบบ กรุณาโหลดหน้านี้ใหม่แล้วเข้าสู่ระบบอีกครั้ง (สิ่งที่กรอกไว้ยังอยู่ในหน้า)";
  const UNKNOWN_WRITE_MESSAGE = "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ (ระบบอาจบันทึกไปแล้ว)";
  const UNKNOWN_READ_MESSAGE = "โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
  const MISSING_MESSAGE = "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับใบสั่งงาน IT กรุณาแจ้งผู้ดูแลระบบ";
  const GENERIC_MESSAGE = "ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ";
  function describeError(error, { write = false } = {}) {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "");
    if (error?.status === 401 || SESSION_CODES.includes(code) || /JWT expired|AUTH_REQUIRED/i.test(message)) return { kind: "session", message: SESSION_MESSAGE };
    if (code === "PGRST202" || code === "42883") return { kind: "missing", message: MISSING_MESSAGE };
    // ไม่มีรหัส = คำขอไปไม่ถึงหรือคำตอบไม่กลับมา (supabase-js ใส่ code ว่าง) · มีรหัสแต่ข้อความบอกว่าเน็ตหลุดก็นับเหมือนกัน
    // ข้อความไทยที่โค้ดของเราโยนเอง (throw new Error("…")) ไม่ใช่เรื่องเครือข่าย แสดงตามนั้น
    if (!code && THAI.test(message) && !NETWORK.test(message)) return { kind: "rejected", message, forwarded: true };
    if (!code || NETWORK.test(message)) return { kind: "unknown", message: write ? UNKNOWN_WRITE_MESSAGE : UNKNOWN_READ_MESSAGE };
    if (["42501", "23514"].includes(code) && THAI.test(message)) return { kind: "rejected", message, forwarded: true };
    return { kind: "rejected", message: GENERIC_MESSAGE };
  }

  const api = {
    YEAR_OFFSET, MAX_DETAILS, MAX_ORDER_REF, MAX_ATTACHMENT_NOTE, MAX_REASON, MAX_ACCESS_ROWS, DURATION_NOTE,
    REQUEST_TYPES, ATTACHMENT_FLAGS, ACCESS_SYSTEMS, ACCESS_ACTIONS, STATUS_LABELS, EVENT_LABELS, ACTION_BUTTONS, ACTION_ORDER, IT_GROUPS, EMPTY_ORDER_FORM, SIGNATURE_SLOTS, APPROVAL_STATE_LABELS,
    requestTypeLabel, attachmentFlagLabel, accessSystemLabel, accessActionLabel, statusLabel, statusBadgeClass, myStatusLabel, isTestDoc,
    todayBangkok, formatDate, formatDateTime, isRealDate, charCount, clip,
    visibleTabs, readView, viewAllowed, workOrderUrl, isUuid,
    actionButtons, canEditAccess, pendingStepLabel, eventLabel, signatureSlots, approvalSummary,
    itGroupOf, groupItOrders, itActionableCount, awaitingMyReceiveCount, itApprovalProgress, cardSummary,
    orderRules, createParams, validateReason,
    blankAccessDraft, draftsFromAccessChanges, isBlankAccessDraft, validateAccessChanges, hasAccessErrors, accessPayload, accessPrintRows,
    formatDocNo, validateNextSeq, staffEditBlock, staffCandidateOptions, validateStaffForm, staffRoleText,
    describeError,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITWO_MODEL = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
