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
  const MAX_MISC_DETAIL = 200;
  const MAX_FILES = 10; // ต่อหนึ่งครั้งที่ส่ง (ตอนแจ้ง หรือแต่ละรอบแก้ไข) ตรงกับ app_itwo_add_attachment
  const MAX_FILE_BYTES = 20 * 1024 * 1024; // ต่อไฟล์ ตรงกับ bucket และตาราง itwo_attachments
  const DURATION_NOTE = "งานออกแบบ 3–7 วันนับจากวันที่ได้ข้อมูลครบ · งานเบ็ดเตล็ดตามตกลง";

  // ตัวเลือกบนฟอร์มแจ้งงาน: ไม่มี "สิทธิ์ในระบบ" แล้ว (เจ้าของสั่ง 19/11/2026 จะแยกเป็นโมดูลขอสิทธิ์) · ใบเก่าที่เป็น system_access ยังแสดงชื่อได้ที่ LEGACY_REQUEST_TYPES
  const REQUEST_TYPES = Object.freeze([
    { value: "design", label: "งานออกแบบ" },
    { value: "misc", label: "เบ็ดเตล็ดอื่นๆ" },
  ]);
  const LEGACY_REQUEST_TYPES = Object.freeze([{ value: "system_access", label: "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" }]);
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
  const requestTypeLabel = (value) => labelOf([...REQUEST_TYPES, ...LEGACY_REQUEST_TYPES], value);
  // ช่องประเภทคำขอบนหน้าพิมพ์: สองตัวเลือกปัจจุบัน + ตัวเลือกเก่าเฉพาะใบที่เป็นประเภทนั้นจริง (ไม่งั้นใบเก่าจะไม่ติ๊กอะไรเลย)
  const printRequestTypes = (requestType) => [...REQUEST_TYPES, ...LEGACY_REQUEST_TYPES.filter((type) => type.value === requestType)];
  // ประเภทคำขอบนหน้าจอ: "เบ็ดเตล็ดอื่นๆ" ตามด้วยงานที่ผู้แจ้งระบุ
  const requestTypeText = (requestType, miscDetail) => (requestType === "misc" && String(miscDetail ?? "").trim()
    ? `${requestTypeLabel(requestType)} · ${String(miscDetail).trim()}`
    : requestTypeLabel(requestType));
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
  // ป้ายงานแก้ไข "แก้ไขครั้งที่ N · กำหนด วว/ดด/ปปปป" (rework_round 0 = ไม่เคยขอแก้ไข ไม่มีป้าย) · ใช้ในใบของฉัน / งาน IT / หน้ารายละเอียด
  const reworkTag = (roundNo, dueDate) => (Number(roundNo) > 0 ? `แก้ไขครั้งที่ ${Number(roundNo)}${dueDate ? ` · กำหนด ${formatDate(dueDate)}` : ""}` : "");

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
    complete: { label: "ปิดงาน", tone: "success", rpc: "app_itwo_complete", done: "ปิดงานแล้ว รอผู้แจ้งยืนยันรับงาน", confirmTitle: "ปิดงานใบสั่งงานนี้?", confirmMessage: "เมื่อปิดงานแล้วใบจะส่งกลับให้ผู้แจ้งตรวจ ผู้แจ้งจะยืนยันรับงานหรือขอแก้ไขงานได้ และยกเลิกใบไม่ได้" },
    receive: { label: "ได้รับงานเรียบร้อยแล้ว", tone: "success", rpc: "app_itwo_receive", done: "ยืนยันรับงานแล้ว", confirmTitle: "ยืนยันว่าได้รับงานเรียบร้อยแล้ว?", confirmMessage: "ใบสั่งงานจะจบทันที ทำซ้ำหรือขอแก้ไขอีกไม่ได้" },
    // "แก้ไขงาน" ไม่ยิง RPC ทันที: เปิดฟอร์ม (รายละเอียด + วันที่กำหนดเสร็จ + ไฟล์) ที่ module-itwo.js · opens = ชื่อฟอร์มที่เปิด
    request_rework: { label: "แก้ไขงาน", tone: "secondary", opens: "rework" },
    cancel: { label: "ยกเลิกใบสั่งงาน", tone: "danger", rpc: "app_itwo_cancel", done: "ยกเลิกใบสั่งงานแล้ว", reason: { title: "ยกเลิกใบสั่งงานนี้?", label: "เหตุผลที่ยกเลิก", hint: "ใบที่ยกเลิกแล้วเปิดใหม่ไม่ได้ ต้องแจ้งเป็นใบใหม่และได้เลขใหม่", confirmLabel: "ยกเลิกใบสั่งงาน" } },
  });
  const ACTION_ORDER = Object.freeze(["approve", "reject", "start", "complete", "receive", "request_rework", "cancel"]);
  // allowed = allowed_actions จาก app_itwo_get_detail · action ที่ไม่รู้จัก (เช่น edit_access ของรุ่นเก่า ซึ่งถอดออกแล้ว) ไม่ขึ้นเป็นปุ่ม
  function actionButtons(allowed) {
    const set = new Set(Array.isArray(allowed) ? allowed : []);
    return ACTION_ORDER.filter((action) => set.has(action)).map((action) => ({ action, ...ACTION_BUTTONS[action] }));
  }
  // ข้อความในกล่องยืนยันของปุ่ม · "อนุมัติ" ของผู้อนุมัติขั้น IT ที่ขั้นแผนกยังไม่ผ่าน (แผนก IT / แผนกไม่มีผู้จัดการ / ผู้จัดการแผนกที่เป็นผู้อนุมัติขั้น IT ด้วย)
  // ฐานข้อมูลบันทึกทั้งสองขั้นในชื่อเขาในครั้งเดียว จึงบอกก่อนกด · role = ผลของ app_itwo_my_role, detail = app_itwo_get_detail (approvals.dept ว่าง = ขั้นแผนกยังไม่ผ่าน)
  // หน้าเว็บตัดสินได้แค่นี้ (ข้อมูลไม่ครบก็ใช้ข้อความมาตรฐาน) ตัวตัดสินจริงคือฐานข้อมูล
  const BOTH_STEPS_NOTE = "ใบนี้จะนับเป็นการอนุมัติทั้งขั้นแผนกและขั้น IT";
  function countsAsBothSteps(detail, role) {
    return Boolean(role?.is_it_approver) && Boolean(detail?.approvals) && !detail.approvals.dept && !detail.approvals.it_mgr;
  }
  function confirmMessageFor(action, detail, role) {
    const base = ACTION_BUTTONS[action]?.confirmMessage ?? "";
    return action === "approve" && countsAsBothSteps(detail, role) ? `${BOTH_STEPS_NOTE} · ${base}` : base;
  }
  // ข้อความแจ้งหลัง IT กดปิดงาน: บอกว่างานกลับไปหาผู้แจ้งแล้ว · โหมดทดสอบ (ผู้แจ้งเป็นบัญชีทดสอบอีกคน) บอกให้สลับบัญชีไปยืนยัน/ขอแก้ไข
  function completeToast(detail, isTest) {
    const name = detail?.requester?.full_name ?? "ผู้แจ้ง";
    const base = `ส่งกลับให้ ${name} ตรวจและยืนยันแล้ว`;
    return isTest ? `${base} · สลับเป็นบัญชีผู้แจ้งเพื่อยืนยันหรือขอแก้ไข` : base;
  }

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
    rework_requested: "ผู้แจ้งขอแก้ไขงาน",
  });
  const eventLabel = (action) => EVENT_LABELS[action] ?? action ?? "";

  // ช่องลายเซ็นบนฟอร์ม (ตามลำดับบนกระดาษ) ใช้ event แรกของแต่ละการกระทำ ยังไม่มี = เว้นช่อง
  const SIGNATURE_SLOTS = Object.freeze([
    { key: "requester", label: "ผู้แจ้ง", action: "created" },
    { key: "dept_manager", label: "ผู้จัดการแผนก", action: "dept_approved" },
    { key: "it_approver", label: "ผู้อนุมัติขั้น IT", action: "it_mgr_approved" },
    // ใบที่ถูกขอแก้ไขงานมี completed หลายครั้ง: ช่องนี้ใช้การปิดงานครั้งล่าสุด (ครั้งที่ผู้แจ้งยืนยันรับ) ส่วนรอบก่อนหน้าอยู่ในตาราง "ประวัติการแก้ไขงาน" ของฟอร์ม
    { key: "it_operator", label: "IT ผู้ดำเนินการ (ปิดงาน)", action: "completed", startedAction: "started", pick: "last" },
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
      const event = slot.pick === "last" ? list.findLast((item) => item.action === slot.action) : list.find((item) => item.action === slot.action);
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
  // ใบที่ขอแก้ไขงานใช้กำหนดเสร็จของรอบล่าสุดแทนวันที่ต้องการเดิม (ตรงกับลำดับของ app_itwo_list_it)
  const dueOf = (row) => (Number(row?.rework_round) > 0 && row.rework_due_date ? row.rework_due_date : row?.needed_date);
  const compareActive = (a, b) => (a.is_urgent === b.is_urgent ? 0 : a.is_urgent ? -1 : 1)
    || byText(dueOf(a), dueOf(b)) || byText(a.created_at, b.created_at) || byText(a.doc_no, b.doc_no);
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
  const EMPTY_ORDER_FORM = Object.freeze({ request_type: "", misc_detail: "", order_ref: "", attachment_flag: "no", attachment_note: "", details: "", needed_date: "", is_urgent: false });
  // กติกาตามรูปแบบของ MNP_FORM_STEPS (modules/form-steps.js): step 1 = งานอะไร · step 2 = ต้องการเมื่อไร
  // required ของหมายเหตุเอกสารแนบ/งานเบ็ดเตล็ดเป็น getter เพราะขึ้นกับค่าที่เลือก ณ ตอนตรวจ · today() อ่านใหม่ทุกครั้ง ฟอร์มที่เปิดค้างข้ามเที่ยงคืนต้องไม่ปล่อยวันที่เมื่อวาน
  function orderRules({ today = () => todayBangkok(), attachmentFlag = () => "no", requestType = () => "" } = {}) {
    return [
      { name: "request_type", step: 1, required: true, message: "กรุณาเลือกประเภทคำขอ" },
      {
        name: "misc_detail", step: 1, message: "กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร",
        get required() { return requestType() === "misc"; },
        check: (value) => charCount(value) <= MAX_MISC_DETAIL, checkMessage: `งานเบ็ดเตล็ดต้องไม่เกิน ${MAX_MISC_DETAIL} ตัวอักษร`,
      },
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
      p_misc_detail: values.request_type === "misc" ? text(values.misc_detail) : null,
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

  /* ---------- ข้อมูลสิทธิ์ในระบบของใบเก่า (อ่านอย่างเดียว) ---------- */
  // ส่วน "สำหรับแผนก IT : สิทธิ์ในระบบ" ถูกถอดออกจากใบสั่งงานแล้ว (เจ้าของสั่ง 19/11/2026) แต่ใบเก่าที่ IT เคยบันทึกไว้ยังมีข้อมูล (ISO ห้ามลบ)
  // จึงแสดงให้อ่านได้เฉพาะใบที่มีข้อมูล ไม่มีปุ่มแก้ · ใบที่ไม่มีข้อมูลไม่แสดงหัวข้อนี้เลย
  const legacyAccessChanges = (detail) => (Array.isArray(detail?.access_changes) ? detail.access_changes : []);
  // ตารางสิทธิ์บนฟอร์มพิมพ์ของใบเก่า: เฉพาะระบบที่มีรายการ (ไม่มีแถวว่างของระบบที่ไม่เคยบันทึกแล้ว) ระบบที่มีหลายรายการมีหลายแถว แสดงชื่อระบบเฉพาะแถวแรก
  function accessPrintRows(changes) {
    const list = Array.isArray(changes) ? changes : [];
    const rows = [];
    for (const system of ACCESS_SYSTEMS) {
      list.filter((change) => change.system === system.value).forEach((item, index) => rows.push({
        key: item.id ?? `${system.value}-${index}`, systemLabel: system.label, showSystemLabel: index === 0,
        action: item.action, newUsername: item.new_username ?? "", oldUsername: item.old_username ?? "", note: item.note ?? "",
      }));
    }
    return rows;
  }

  /* ---------- ไฟล์แนบ ---------- */
  // ชนิดไฟล์ที่ฐานข้อมูล/Storage รับ (ตรงกับ private.itwo_allowed_mime_types และ private.itwo_file_path_order_id ใน migration 20261204010000)
  // นามสกุล (พิมพ์เล็ก) → MIME · ใช้นามสกุลตัดสินเสมอ เพราะ file.type จากเบราว์เซอร์มักว่างหรือเป็น octet-stream กับไฟล์ Office/CSV
  const FILE_MIME_BY_EXTENSION = Object.freeze({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword", xls: "application/vnd.ms-excel", txt: "text/plain", csv: "text/csv",
  });
  const FILE_ACCEPT = ["image/*", ...Object.keys(FILE_MIME_BY_EXTENSION).map((extension) => `.${extension}`)].join(",");
  const FILE_HINT = `แนบได้ไม่เกิน ${MAX_FILES} ไฟล์ ไฟล์ละไม่เกิน ${MAX_FILE_BYTES / 1048576} MB · รูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV`;
  const UNSUPPORTED_FILE_MESSAGE = "ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)";
  const fileExtension = (name) => (/\.([A-Za-z0-9]+)$/.exec(String(name ?? ""))?.[1] ?? "").toLowerCase();
  const fileMime = (file) => FILE_MIME_BY_EXTENSION[fileExtension(file?.name)] ?? null;
  const fileBucket = (isTest) => (isTest ? "itwo-test-files" : "itwo-files");
  // path ที่ฐานข้อมูลบังคับ: <id ใบ>/<uuid พิมพ์เล็ก>.<นามสกุลพิมพ์เล็ก> (ชื่อเดิมของไฟล์เก็บในตาราง ไม่อยู่ใน path)
  const filePath = (orderId, uuid, file) => `${String(orderId).toLowerCase()}/${String(uuid).toLowerCase()}.${fileExtension(file?.name)}`;
  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }
  // ตรวจชุดไฟล์ก่อนส่ง (ฐานข้อมูลและ Storage ตรวจซ้ำ) คืนข้อความไทยข้อแรกที่ผิด หรือ null · ชื่อไฟล์ระบุเสมอเมื่อผิดที่ไฟล์ใดไฟล์หนึ่ง
  function validateFiles(files) {
    const list = Array.from(files ?? []);
    if (list.length > MAX_FILES) return `แนบได้ไม่เกิน ${MAX_FILES} ไฟล์ต่อครั้ง`;
    for (const file of list) {
      if (!fileMime(file)) return `${file?.name || "ไฟล์"}: ${UNSUPPORTED_FILE_MESSAGE}`;
      if (!file.size) return `${file.name}: ไฟล์ว่างเปล่า`;
      if (file.size > MAX_FILE_BYTES) return `${file.name}: ไฟล์ต้องมีขนาดไม่เกิน ${MAX_FILE_BYTES / 1048576} MB`;
    }
    return null;
  }
  // รายการที่ต้องอัปโหลด: แต่ละไฟล์ได้ path ของตัวเองครั้งเดียว (ลองซ้ำใช้ path เดิม ไม่เกิดไฟล์กำพร้าซ้ำ) · uploaded/registered = ทำถึงขั้นไหนแล้ว
  const makeUploadEntries = (orderId, files, uuid) => Array.from(files ?? []).map((file) => ({ file, path: filePath(orderId, uuid(), file), uploaded: false, registered: false, error: null }));
  // Storage ตอบว่าไฟล์ path นี้มีอยู่แล้ว (ครั้งก่อนอัปโหลดสำเร็จแต่คำตอบไม่กลับมา) = ถือว่าอัปโหลดแล้ว ฐานข้อมูลจะตรวจว่าไฟล์อยู่จริงและเป็นของผู้เรียกตอนลงทะเบียน
  const isAlreadyUploaded = (error) => String(error?.statusCode ?? error?.status ?? "") === "409" || /already exists|duplicate/i.test(String(error?.message ?? ""));
  // อัปโหลด + ลงทะเบียนทีละไฟล์ตามลำดับ แสดงความคืบหน้าผ่าน onStart(entry) (ก่อนเริ่มไฟล์) และ onProgress(done, total, entry) (หลังจบไฟล์) · ไฟล์ที่ล้มไม่หยุดไฟล์ที่เหลือ
  // upload(entry) / register(entry) เป็นตัวต่อจริงของ Storage / RPC (โยน error เมื่อพลาด) · เรียกซ้ำกับรายการเดิมได้: ข้ามขั้นที่ทำสำเร็จแล้ว
  // คืนรายการที่ยังไม่สำเร็จ (error เก็บไว้ที่ entry.error ให้ผู้เรียกแปลเป็นข้อความ)
  async function runUploads(entries, { upload, register, onStart = () => {}, onProgress = () => {} }) {
    const pending = entries.filter((entry) => !entry.registered);
    let done = 0;
    onProgress(done, pending.length, null);
    for (const entry of pending) {
      entry.error = null;
      onStart(entry);
      try {
        if (!entry.uploaded) {
          try {
            await upload(entry);
          } catch (error) {
            if (!isAlreadyUploaded(error)) throw error;
          }
          entry.uploaded = true;
        }
        await register(entry);
        entry.registered = true;
      } catch (error) {
        entry.error = error;
      }
      done += 1;
      onProgress(done, pending.length, entry);
    }
    return entries.filter((entry) => !entry.registered);
  }
  // จัดไฟล์ของใบเป็นกลุ่มตามรอบ: 0 = ตอนแจ้ง, N = แก้ไขครั้งที่ N · เฉพาะกลุ่มที่มีไฟล์ เรียงตามรอบ
  const roundLabel = (roundNo) => (Number(roundNo) > 0 ? `แก้ไขครั้งที่ ${Number(roundNo)}` : "ตอนแจ้ง");
  function attachmentGroups(detail) {
    const groups = new Map();
    for (const file of Array.isArray(detail?.attachments) ? detail.attachments : []) {
      const roundNo = Number(file.round_no) || 0;
      if (!groups.has(roundNo)) groups.set(roundNo, { roundNo, label: roundLabel(roundNo), files: [] });
      groups.get(roundNo).files.push(file);
    }
    return [...groups.values()].sort((a, b) => a.roundNo - b.roundNo);
  }
  // ไฟล์ของ gallery ใน app.js (attachmentGalleryHtml / hydrateAttachmentGallery) ใช้ชื่อฟิลด์ content_type
  const galleryFile = (file) => ({ id: file.id, file_name: file.file_name, content_type: file.mime_type, size_bytes: file.size_bytes, storage_path: file.storage_path });
  // ไฟล์ของรอบนั้น (สำหรับหน้าที่แสดงรอบแก้ไข: รายละเอียด + กำหนด + ไฟล์ของรอบ)
  function reworkRounds(detail) {
    const files = Array.isArray(detail?.attachments) ? detail.attachments : [];
    return (Array.isArray(detail?.reworks) ? detail.reworks : []).slice().sort((a, b) => a.round_no - b.round_no).map((round) => ({
      id: round.id,
      roundNo: round.round_no,
      label: roundLabel(round.round_no),
      details: round.details,
      dueDate: round.due_date,
      createdAt: round.created_at,
      requestedBy: round.requested_by_full_name,
      files: files.filter((file) => file.rework_id === round.id),
    }));
  }

  // ผลล้างข้อมูลทดสอบ: ฐานข้อมูลลบแถวแล้ว (deleted) ส่วนไฟล์ใน Storage หน้าเว็บลบตามรายการที่ได้ (total) ได้จริง removed ไฟล์
  // ลบไม่ครบ = complete false ให้บอกกดล้างซ้ำ (ครั้งถัดไปฐานข้อมูลคืนรายการไฟล์ที่เหลือมาให้)
  function purgeSummary({ deleted, total, removed }) {
    const base = `ล้างข้อมูลทดสอบแล้ว ${deleted} แถว`;
    if (!total) return { complete: true, message: base };
    if (removed >= total) return { complete: true, message: `${base} · ลบไฟล์ ${total} ไฟล์` };
    return { complete: false, message: `${base} · ลบไฟล์ได้ ${removed} จาก ${total} ไฟล์ ยังเหลือ ${total - removed} ไฟล์ กดล้างข้อมูลอีกครั้งเพื่อลบไฟล์ที่เหลือ` };
  }

  /* ---------- ฟอร์มขอแก้ไขงาน ---------- */
  // ผู้แจ้งกด "แก้ไขงาน" ตอน IT ปิดงานแล้ว: รายละเอียดที่ต้องแก้ (บังคับ) + วันที่กำหนดแก้เสร็จ (บังคับ ไม่ย้อนหลังตามเวลาไทย) + ไฟล์ (ไม่บังคับ)
  const EMPTY_REWORK_FORM = Object.freeze({ details: "", due_date: "" });
  function reworkRules({ today = () => todayBangkok() } = {}) {
    return [
      { name: "details", required: true, message: "กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข", check: (value) => charCount(value) <= MAX_DETAILS, checkMessage: `รายละเอียดต้องไม่เกิน ${MAX_DETAILS.toLocaleString("en-US")} ตัวอักษร` },
      {
        name: "due_date", required: true, message: "กรุณาเลือกวันที่ต้องการให้แก้ไขเสร็จ",
        check: (value) => isRealDate(value) && value >= today(), checkMessage: "วันที่ต้องการให้แก้ไขเสร็จต้องเป็นวันนี้หรือหลังจากนี้",
      },
    ];
  }
  // พารามิเตอร์ของ app_itwo_request_rework
  const reworkParams = (workOrderId, values) => ({ p_work_order_id: workOrderId, p_details: String(values.details ?? "").trim(), p_due_date: String(values.due_date ?? "").trim() });


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

  // error ของการอัปโหลดไฟล์ขึ้น Storage (ข้อความอังกฤษของ Storage ไม่แสดงตรง ๆ) · ส่วน error ของ RPC ลงทะเบียนไฟล์ใช้ describeError ตามปกติ
  // 403 = policy ปฏิเสธ (หมดหน้าต่างแนบ 30 นาที / ไม่ใช่ผู้แจ้ง / มีผู้อนุมัติแล้ว) · 413 = ไฟล์ใหญ่เกิน · 415 = ชนิดไฟล์ไม่รับ
  function describeUploadError(error) {
    const status = String(error?.statusCode ?? error?.status ?? "");
    const message = String(error?.message ?? "");
    if (status === "403" || /row-level security|not authorized|unauthorized/i.test(message)) return { kind: "rejected", message: "อัปโหลดไฟล์ไม่ได้ อาจหมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาที) หรือมีผู้อนุมัติใบนี้แล้ว" };
    if (status === "413" || /too large|exceeded the maximum/i.test(message)) return { kind: "rejected", message: `ไฟล์ต้องมีขนาดไม่เกิน ${MAX_FILE_BYTES / 1048576} MB` };
    if (status === "415" || /mime type/i.test(message)) return { kind: "rejected", message: UNSUPPORTED_FILE_MESSAGE };
    const info = describeError(error, { write: true });
    // อัปโหลดและลงทะเบียนไฟล์ลองซ้ำได้ปลอดภัย (path เดิม คืนทะเบียนเดิม) จึงไม่ต้องให้ "ตรวจก่อนกดซ้ำ"
    return info.kind === "unknown" ? { kind: "unknown", message: "เชื่อมต่อระบบไม่ได้ สัญญาณอาจขาด กดลองอีกครั้งได้เลย" } : info;
  }

  const api = {
    YEAR_OFFSET, MAX_DETAILS, MAX_ORDER_REF, MAX_ATTACHMENT_NOTE, MAX_REASON, MAX_MISC_DETAIL, MAX_FILES, MAX_FILE_BYTES, DURATION_NOTE,
    REQUEST_TYPES, LEGACY_REQUEST_TYPES, ATTACHMENT_FLAGS, ACCESS_SYSTEMS, ACCESS_ACTIONS, FILE_MIME_BY_EXTENSION, FILE_ACCEPT, FILE_HINT, EMPTY_REWORK_FORM, STATUS_LABELS, EVENT_LABELS, ACTION_BUTTONS, ACTION_ORDER, IT_GROUPS, EMPTY_ORDER_FORM, SIGNATURE_SLOTS, APPROVAL_STATE_LABELS,
    requestTypeLabel, printRequestTypes, requestTypeText, reworkTag, attachmentFlagLabel, accessSystemLabel, accessActionLabel, statusLabel, statusBadgeClass, myStatusLabel, isTestDoc,
    todayBangkok, formatDate, formatDateTime, isRealDate, charCount, clip,
    visibleTabs, readView, viewAllowed, workOrderUrl, isUuid,
    actionButtons, countsAsBothSteps, confirmMessageFor, BOTH_STEPS_NOTE, completeToast, pendingStepLabel, eventLabel, signatureSlots, approvalSummary,
    itGroupOf, groupItOrders, itActionableCount, awaitingMyReceiveCount, itApprovalProgress, cardSummary,
    orderRules, createParams, validateReason,
    legacyAccessChanges, accessPrintRows,
    fileExtension, fileMime, fileBucket, filePath, formatFileSize, validateFiles, makeUploadEntries, isAlreadyUploaded, runUploads, roundLabel, attachmentGroups, galleryFile, reworkRounds, reworkRules, reworkParams,
    formatDocNo, validateNextSeq, staffEditBlock, staffCandidateOptions, validateStaffForm, staffRoleText,
    describeError, describeUploadError, purgeSummary,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITWO_MODEL = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
