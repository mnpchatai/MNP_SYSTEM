// ใบขอสิทธิ์ IT (itar · ฟอร์ม IT01-FM08) — ส่วนข้อมูลล้วนของหน้าเว็บ ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itar-model.test.mjs)
// คัดโครงจากใบแจ้งซ่อม IT (itrp-model.js) แล้วปรับเป็นใบขอสิทธิ์: ผู้ยื่น (requester) กับผู้รับสิทธิ์ (subject) แยกกัน · รายการสิทธิ์ที่ขอเป็นตาราง "ก่อน → หลัง"
// สเปก: Work-Order/docs/it-user-access-spec.md · สัญญา RPC: docs/itar-contract.md (ฐานข้อมูลเป็นผู้ตัดสินทุกอย่าง: เลขที่เอกสาร สิทธิ์ ลำดับขั้น)
// ไฟล์นี้แค่ตั้งชื่อ จัดกลุ่ม ซ่อน/แสดงปุ่มตาม my_role / allowed_actions สร้าง p_items จากสิ่งที่ผู้ใช้ติ๊ก และตรวจฟอร์มให้เห็นข้อความไทยก่อนส่ง (ฐานข้อมูลตรวจซ้ำเสมอ)
// ไม่มีงานด่วน (เจ้าของตัดสิน 26/11/2026: ขอสิทธิ์ต้องอนุมัติครบก่อนเสมอ) · ไม่มีรหัสผ่านใด ๆ ในข้อมูลของโมดูลนี้
// วันที่แสดงเป็น วว/ดด/ปปปป (พ.ศ. แบบเดียวกับใบสั่งงาน/ใบแจ้งซ่อม) เวลา Asia/Bangkok — เปลี่ยนปีเป็น ค.ศ. ได้ที่ YEAR_OFFSET จุดเดียว
(function (root) {
  "use strict";

  const YEAR_OFFSET = 543;
  const MAX_REQUEST_REASON = 2000; // เหตุผลรวมของใบ · ตรงกับ app_itar_create
  const MAX_REASON = 500; // เหตุผลไม่อนุมัติ / ยกเลิก · ตรงกับ app_itar_reject / app_itar_cancel
  const MAX_INFO_BODY = 2000; // ข้อความถาม/ตอบ ตรงกับ app_itar_request_info / app_itar_provide_info
  const MAX_NOTE = 500; // หมายเหตุรายการ (เหตุผลขออินเทอร์เน็ต / ชื่อโปรแกรม "อื่นๆ")
  const MAX_ITEMS = 80; // รายการสิทธิ์ที่ขอต่อใบ · ตรงกับ app_itar_create
  const MAX_NAME = 200; // ชื่อไทย/อังกฤษของผู้รับสิทธิ์ที่ไม่มีบัญชี
  const MAX_EMAIL = 200;
  const MAX_FILES = 10; // ต่อหนึ่งครั้งที่ส่ง (ตอนยื่น หรือแต่ละข้อความถาม/ตอบ)
  const MAX_FILE_BYTES = 20 * 1024 * 1024; // ต่อไฟล์ ตรงกับ bucket
  // เลขเวอร์ชันของโมดูล (แสดงที่การ์ดและท้ายทุกหน้า) กติกาเดียวกับใบสั่งงาน/ใบแจ้งซ่อม: ย่อย +0.01 · ใหญ่ ขึ้นหลักหน่วย
  const MODULE_VERSION = "1.00";
  const VERSION_DATE = "2026-11-28";
  // ธง "กำลังพัฒนา" (จุดเดียว): true = การ์ดใบขอสิทธิ์ IT มีป้าย "กำลังพัฒนา" และทุกหน้ามีแถบข้อความว่ายังไม่เปิดใช้งานจริง · ถอดเมื่อเจ้าของสั่งเปิดใช้: เปลี่ยนเป็น false ที่นี่ที่เดียว
  const IN_DEVELOPMENT = true;

  const textOf = (value) => String(value ?? "").trim();
  const listOf = (value) => (Array.isArray(value) ? value : []);

  /* ---------- ประเภทคำขอ / ฝ่าย / ระดับสิทธิ์ ---------- */
  const REQUEST_TYPES = Object.freeze([
    { value: "new", label: "ขอใหม่", hint: "ผู้ใช้ที่ยังไม่มีในทะเบียนสิทธิ์ (เช่น พนักงานใหม่) เลือกสิทธิ์ที่ต้องการได้อย่างเดียว" },
    { value: "change", label: "เปลี่ยนแปลง", hint: "เพิ่ม ลด หรือเปลี่ยนสิทธิ์ของผู้ใช้ที่มีในทะเบียนอยู่แล้ว" },
    { value: "revoke_all", label: "ยกเลิกทั้งหมด (ลาออก/ย้าย)", hint: "ถอดสิทธิ์โฟลเดอร์ อินเทอร์เน็ต โปรแกรม และปิดอีเมลทั้งหมด · ไม่ต้องเลือกรายการ" },
  ]);
  const labelOf = (list, value) => list.find((item) => item.value === value)?.label ?? value ?? "";
  const requestTypeLabel = (value) => labelOf(REQUEST_TYPES, value);
  // ฝ่ายของผู้ใช้ (ใช้ตอนขอใหม่) · ค่าตรงกับ itua_users.division
  const DIVISIONS = Object.freeze([
    { value: "office", label: "สำนักงาน" },
    { value: "factory", label: "โรงงาน" },
    { value: "manager", label: "ผู้จัดการ" },
    { value: "office_indesign", label: "สำนักงาน (InDesign)" },
  ]);
  const divisionLabel = (value) => labelOf(DIVISIONS, value);
  // ระดับสิทธิ์โฟลเดอร์ที่ใช้อยู่แล้วบนกระดาษ: R = อ่านอย่างเดียว · F = ทำได้ทุกอย่าง (อ่าน เขียน แก้ไข ลบ)
  const LEVELS = Object.freeze([
    { value: "R", label: "อ่านอย่างเดียว (R)" },
    { value: "F", label: "อ่าน-เขียน-แก้ไข-ลบ (F)" },
  ]);
  const LEVEL_HELP = "R = เปิดดูได้อย่างเดียว · F = เปิดดู เพิ่ม แก้ไข และลบไฟล์ได้ทั้งหมด (เสี่ยงกว่า ขอเฉพาะที่จำเป็น)";
  const levelLabel = (value) => (value ? labelOf(LEVELS, value) : "ไม่มีสิทธิ์");
  const EMAIL_KINDS = Object.freeze([
    { value: "internal", label: "อีเมลภายในบริษัท (มีได้ 1 ที่อยู่ต่อคน)" },
    { value: "extra", label: "อีเมลอื่น" },
  ]);
  const emailKindLabel = (value) => labelOf(EMAIL_KINDS, value).replace(/ \(.*\)$/, "");

  /* ---------- สถานะ ---------- */
  const STATUS_LABELS = Object.freeze({
    pending_dept: "รอผู้จัดการแผนก",
    pending_it_mgr: "รอผู้อนุมัติขั้น IT",
    approved: "อนุมัติครบ รอ IT รับงาน",
    in_progress: "IT กำลังดำเนินการ",
    awaiting_ack: "รอผู้ใช้รับทราบ",
    need_info: "รอผู้ยื่นตอบ",
    done: "จบแล้ว",
    rejected: "ไม่อนุมัติ",
    cancelled: "ยกเลิก",
  });
  // ป้ายสถานะใช้ class .badge ของระบบ (styles.css) จึงแปลงเป็นชื่อ class ที่ระบบมีสีให้แล้ว
  const STATUS_BADGE_CLASS = Object.freeze({
    pending_dept: "pending_approval",
    pending_it_mgr: "pending_approval",
    approved: "approved",
    in_progress: "in_progress",
    awaiting_ack: "pending_verify",
    need_info: "more_info",
    done: "completed",
    rejected: "rejected",
    cancelled: "cancelled",
  });
  const statusLabel = (status) => STATUS_LABELS[status] ?? status ?? "";
  const statusBadgeClass = (status) => STATUS_BADGE_CLASS[status] ?? "";
  // ผู้ใช้ที่ต้องลงมือเห็นคำที่บอกว่าถึงคิวของตัวเอง (หน้า "ใบของฉัน") · row = แถวของ app_itar_list_mine (ไม่ส่ง = มุมมองทั่วไป)
  function myStatusLabel(status, row = null) {
    if (status === "need_info") return row && row.is_requester === false ? "รอผู้ยื่นตอบ" : "รอคุณตอบ";
    if (status === "awaiting_ack") return row?.needs_my_ack ? "รอคุณรับทราบสิทธิ์" : "รอผู้ใช้รับทราบ";
    return statusLabel(status);
  }
  const isTestDoc = (docNo) => String(docNo ?? "").startsWith("TEST-");

  /* ---------- ถาม-ตอบ ---------- */
  // ขั้นของผู้ถาม (itar_comments.stage): dept = ผู้จัดการแผนก · it_mgr = ผู้อนุมัติขั้น IT · it = ทีม IT (หลังอนุมัติ / ระหว่างทำงาน)
  const INFO_STAGE_LABELS = Object.freeze({ dept: "ผู้จัดการแผนก", it_mgr: "ผู้อนุมัติขั้น IT", it: "ทีม IT" });
  const infoStageLabel = (stage) => INFO_STAGE_LABELS[stage] ?? stage ?? "";
  const COMMENT_KIND_LABELS = Object.freeze({ question: "ถาม", answer: "ตอบ" });
  const commentKindLabel = (kind) => COMMENT_KIND_LABELS[kind] ?? kind ?? "";
  // ข้อความถาม/ตอบทุกข้อความเรียงตามลำดับจริง (id) พร้อมไฟล์ของข้อความนั้น · ไม่มี = []
  function commentRows(detail) {
    return listOf(detail?.comments).slice().sort((a, b) => Number(a.id) - Number(b.id)).map((comment, index) => ({
      id: comment.id,
      no: index + 1,
      kind: comment.kind,
      kindLabel: commentKindLabel(comment.kind),
      stage: comment.stage,
      stageLabel: infoStageLabel(comment.stage),
      body: comment.body,
      by: comment.author_full_name,
      at: comment.created_at,
      files: listOf(comment.attachments),
    }));
  }
  // ไฟล์ทุกไฟล์ของใบ: ตอนยื่น + ข้อความถาม/ตอบ + รูปใบรับทราบกระดาษ (เข้า gallery ตัวเดียวของหน้ารายละเอียด)
  const allFiles = (detail) => [...listOf(detail?.attachments), ...commentRows(detail).flatMap((comment) => comment.files), ...listOf(detail?.paper_attachments)];
  // คำถามที่ค้างอยู่ + ไฟล์ของคำถามนั้น (ผู้ยื่นเห็นเด่น ๆ พร้อมฟอร์มตอบ) · ไม่มี = null
  function pendingQuestion(detail) {
    const pending = detail?.info_pending;
    if (!pending) return null;
    const comment = commentRows(detail).find((row) => String(row.id) === String(pending.comment_id));
    return {
      commentId: pending.comment_id,
      stage: pending.stage,
      stageLabel: infoStageLabel(pending.stage),
      body: pending.body,
      askedAt: pending.asked_at,
      askedBy: pending.asked_by_full_name,
      files: comment?.files ?? [],
      returnLabel: statusLabel(detail.info_return_status),
    };
  }
  // คำอธิบายป้าย "รอผู้ยื่นตอบ" ในรายการ (title ของป้าย): ใครถาม และตอบแล้วใบกลับไปที่ไหน · mine = มุมมองผู้ยื่น
  function infoBadgeTitle(row, mine = false) {
    if (row?.status !== "need_info") return "";
    const asker = row.info_stage ? (mine ? `${infoStageLabel(row.info_stage)} ถามคุณ` : `ถามโดย ${infoStageLabel(row.info_stage)}`) : "";
    const back = row.info_return_status ? `ตอบแล้วใบกลับไปที่ ${statusLabel(row.info_return_status)}` : "";
    return [asker, back].filter(Boolean).join(" · ");
  }

  /* ---------- วันที่ / เวลา ---------- */
  const pad = (value) => String(value).padStart(2, "0");
  const BANGKOK = { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  function bangkokParts(date) {
    const parts = {};
    for (const part of new Intl.DateTimeFormat("en-GB", BANGKOK).formatToParts(date)) parts[part.type] = part.value;
    return parts;
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
  const charCount = (value) => Array.from(String(value ?? "").trim()).length;
  const clip = (text, max) => {
    const chars = Array.from(String(text ?? "").replace(/\s+/g, " ").trim());
    return chars.length <= max ? chars.join("") : `${chars.slice(0, max).join("")}…`;
  };

  /* ---------- สิทธิ์ → แท็บ ---------- */
  // role = ผลของ app_itar_my_role · แท็บเป็น UX ล้วน ฐานข้อมูลตรวจสิทธิ์ซ้ำทุก RPC
  const VIEWER_LABEL = "หัวหน้า IT (ดูอย่างเดียว)";
  const isItViewer = (role) => role?.is_it_viewer === true;
  // เห็นรายการใบทั้งหมด/แท็บ "งาน IT" ได้: ทีมใน itwo_staff (ผู้ดูแลงาน IT + ผู้อนุมัติขั้น IT + หัวหน้า IT)
  const canSeeAllOrders = (role) => Boolean(role?.is_it_admin || role?.is_it_approver || isItViewer(role));
  // เห็นแท็บ "รออนุมัติ" ได้: ผู้อนุมัติขั้นแผนก/ขั้น IT + หัวหน้า IT (อนุมัติแทนในใบที่ผู้อนุมัติขั้น IT เกี่ยวข้อง · ฐานข้อมูลคืนรายการเฉพาะที่กดได้จริง)
  const canApprove = (role) => Boolean(role?.is_dept_approver || role?.is_it_approver || isItViewer(role));
  function visibleTabs(role) {
    const tabs = [{ key: "mine", label: "ใบของฉัน" }];
    if (canApprove(role)) tabs.push({ key: "approvals", label: "รออนุมัติ" });
    if (canSeeAllOrders(role)) tabs.push({ key: "it", label: "งาน IT" });
    if (role?.is_it_admin) tabs.push({ key: "settings", label: "ตั้งค่า" });
    return tabs;
  }
  // ส่วน B จะเพิ่ม view ของใบพิมพ์ (print) และหน้าบันทึกลงทะเบียน (apply) ต่อท้ายรายการนี้
  const VIEWS = Object.freeze(["mine", "approvals", "it", "settings", "new", "order"]);
  const TAB_VIEWS = Object.freeze(["mine", "approvals", "it", "settings"]);
  function readView(params) {
    const view = params?.get?.("view") ?? "";
    if (view === "") return "mine";
    return VIEWS.includes(view) ? view : null;
  }
  // หน้าแท็บที่ผู้ใช้ไม่มีสิทธิ์เห็น (พิมพ์ URL เอง) ให้กลับ "ใบของฉัน"
  const viewAllowed = (view, role) => !TAB_VIEWS.includes(view) || visibleTabs(role).some((tab) => tab.key === view);
  function accessUrl(view = "mine", extra = {}) {
    const query = new URLSearchParams({ module: "access-request" });
    if (view && view !== "mine") query.set("view", view);
    for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
    return `#/office?${query.toString()}`;
  }
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));

  /* ---------- ปุ่มตาม allowed_actions ---------- */
  // ลำดับปุ่ม: ตัดสินใจก่อน แล้วขั้นตอนของ IT แล้วของผู้ยื่น · reason = ต้องกรอกเหตุผล · tone ใช้เลือกสีปุ่ม
  // opens = ไม่ยิง RPC ทันที แต่เปิดฟอร์มของตัวเองที่ module-itar.js: ask (ถามผู้ยื่น) · answer = ฟอร์มตอบวาดเปิดไว้ในหน้าอยู่แล้ว (inline ไม่มีปุ่มในแผงปุ่ม)
  const ACTION_BUTTONS = Object.freeze({
    approve: { label: "อนุมัติ", tone: "success", rpc: "app_itar_approve", done: "อนุมัติแล้ว", confirmTitle: "อนุมัติใบขอสิทธิ์นี้?", confirmMessage: "การกดอนุมัติบันทึกชื่อ วันที่ และเวลาของคุณเป็นลายเซ็นอิเล็กทรอนิกส์ แก้ไขย้อนหลังไม่ได้" },
    reject: { label: "ไม่อนุมัติ", tone: "danger", rpc: "app_itar_reject", done: "บันทึกการไม่อนุมัติแล้ว", reason: { title: "ไม่อนุมัติใบขอสิทธิ์นี้?", label: "เหตุผลที่ไม่อนุมัติ", hint: "ใบนี้จะจบทันทีและเปิดใหม่ไม่ได้ ผู้ยื่นต้องยื่นเป็นใบใหม่", confirmLabel: "ไม่อนุมัติ" } },
    start: { label: "รับงาน", tone: "primary", rpc: "app_itar_start", done: "รับงานแล้ว", confirmTitle: "รับงานใบขอสิทธิ์นี้?", confirmMessage: "ระบบบันทึกว่าคุณเป็นผู้รับงานนี้ พร้อมวันและเวลา · หลังรับงานแล้วจึงบันทึกสิทธิ์ลงทะเบียนได้" },
    request_info: { label: "ถามผู้ยื่น", tone: "secondary", opens: "ask", rpc: "app_itar_request_info", confirmTitle: "ส่งคำถามถึงผู้ยื่น?", confirmMessage: "ใบจะเปลี่ยนเป็น รอผู้ยื่นตอบ และกลับมาดำเนินการต่อได้เมื่อผู้ยื่นตอบ ระหว่างนี้อนุมัติหรือไม่อนุมัติไม่ได้ ต้องรอคำตอบก่อน · ระบบบันทึกชื่อ วันที่ และเวลาของคุณไว้ในประวัติเอกสาร", confirmLabel: "ส่งคำถาม", done: "ส่งคำถามถึงผู้ยื่นแล้ว" },
    provide_info: { label: "ตอบคำถาม", tone: "primary", opens: "answer", inline: true, rpc: "app_itar_provide_info", confirmTitle: "ส่งคำตอบ?", confirmMessage: "ใบจะกลับไปดำเนินการต่อทันที · ระบบบันทึกชื่อ วันที่ และเวลาของคุณไว้ในประวัติเอกสาร แก้ไขย้อนหลังไม่ได้", confirmLabel: "ส่งคำตอบ", done: "ส่งคำตอบแล้ว" },
    cancel: { label: "ยกเลิกใบขอสิทธิ์", tone: "danger", rpc: "app_itar_cancel", done: "ยกเลิกใบขอสิทธิ์แล้ว", reason: { title: "ยกเลิกใบขอสิทธิ์นี้?", label: "เหตุผลที่ยกเลิก", hint: "ใบที่ยกเลิกแล้วเปิดใหม่ไม่ได้ ต้องยื่นเป็นใบใหม่และได้เลขใหม่", confirmLabel: "ยกเลิกใบขอสิทธิ์" } },
  });
  // IT (ผู้ดูแลงาน) ยกเลิก "แทนผู้ยื่น": ใช้ปุ่ม cancel เดิม RPC เดิม แต่ข้อความกล่องเหตุผลบอกว่าเป็นการยกเลิกแทน
  // ฐานข้อมูลใส่คำนำหน้า "IT ยกเลิกแทนผู้ยื่น: " (21 ตัวอักษร) ลงในเหตุผลของประวัติ จึงจำกัดเหตุผลฝั่งนี้ที่ 470 ตัว (ฐานข้อมูลรับได้ถึง 479)
  const MAX_REASON_ON_BEHALF = 470;
  const CANCEL_ON_BEHALF = Object.freeze({ title: "ยกเลิกใบขอสิทธิ์แทนผู้ยื่น?", label: "เหตุผลที่ยกเลิกแทนผู้ยื่น", hint: "ระบบบันทึกชื่อคุณว่าเป็นผู้ยกเลิกแทนผู้ยื่นพร้อมเหตุผลนี้ ใบที่ยกเลิกแล้วเปิดใหม่ไม่ได้ ต้องยื่นเป็นใบใหม่", confirmLabel: "ยกเลิกแทนผู้ยื่น", maxLength: MAX_REASON_ON_BEHALF });
  // ผู้ที่ไม่ใช่ผู้ยื่นแต่ได้ปุ่ม cancel = IT ยกเลิกแทน (ฐานข้อมูลเป็นตัวตัดสินสิทธิ์จริง) · role = app_itar_my_role, detail = app_itar_get_detail
  const isCancelOnBehalf = (detail, role) => Boolean(role?.employee_no) && Boolean(detail?.requester?.employee_no) && role.employee_no !== detail.requester.employee_no;
  function cancelReasonSpec(detail, role) {
    return isCancelOnBehalf(detail, role) ? CANCEL_ON_BEHALF : { ...ACTION_BUTTONS.cancel.reason, maxLength: MAX_REASON };
  }
  const ACTION_ORDER = Object.freeze(["approve", "reject", "request_info", "start", "provide_info", "cancel"]);
  // allowed = allowed_actions จาก app_itar_get_detail · action ที่ไม่รู้จักไม่ขึ้นเป็นปุ่ม
  function actionButtons(allowed) {
    const set = new Set(Array.isArray(allowed) ? allowed : []);
    return ACTION_ORDER.filter((action) => set.has(action)).map((action) => ({ action, ...ACTION_BUTTONS[action] }));
  }
  // การกระทำที่ฐานข้อมูลอนุญาตแต่หน้าเว็บส่วนนี้ยังไม่มีปุ่ม (ส่วน B: บันทึกลงทะเบียน · รับทราบสิทธิ์ · รับทราบด้วยกระดาษ · แนบรูปใบรับทราบ)
  // ใช้แสดงข้อความ "กำลังพัฒนา" แทนปุ่ม เพื่อไม่ให้ผู้ใช้งงว่าทำไมใบค้าง · ส่วน B ลบรายการที่ทำปุ่มแล้วออกจากที่นี่
  const DEFERRED_ACTIONS = Object.freeze({
    apply: "บันทึกลงทะเบียนสิทธิ์",
    acknowledge: "รับทราบสิทธิ์",
    acknowledge_paper: "รับทราบแทนผู้ใช้ด้วยกระดาษ",
    add_paper_attachment: "แนบรูปใบรับทราบที่เซ็นแล้ว",
  });
  function deferredActions(allowed) {
    const set = new Set(Array.isArray(allowed) ? allowed : []);
    return Object.keys(DEFERRED_ACTIONS).filter((action) => set.has(action)).map((action) => ({ action, label: DEFERRED_ACTIONS[action] }));
  }
  // ข้อความในกล่องยืนยันของปุ่ม · "อนุมัติ" ของผู้อนุมัติขั้น IT ที่ขั้นแผนกยังไม่ผ่าน ฐานข้อมูลบันทึกทั้งสองขั้นในชื่อเขาครั้งเดียว จึงบอกก่อนกด
  const BOTH_STEPS_NOTE = "ใบนี้จะนับเป็นการอนุมัติทั้งขั้นแผนกและขั้น IT";
  function countsAsBothSteps(detail, role) {
    return Boolean(role?.is_it_approver || role?.is_it_viewer) && Boolean(detail?.approvals) && !detail.approvals.dept && !detail.approvals.it_mgr;
  }
  function confirmMessageFor(action, detail, role) {
    const base = ACTION_BUTTONS[action]?.confirmMessage ?? "";
    return action === "approve" && countsAsBothSteps(detail, role) ? `${BOTH_STEPS_NOTE} · ${base}` : base;
  }
  const answerToast = (stage) => `ส่งคำตอบแล้ว ใบกลับไปที่${infoStageLabel(stage) || "ผู้ถาม"}`;
  const PENDING_STEP_LABELS = Object.freeze({ dept: "รอคุณอนุมัติขั้นผู้จัดการแผนก", it_mgr: "รอคุณอนุมัติขั้น IT" });
  const pendingStepLabel = (step) => PENDING_STEP_LABELS[step] ?? step ?? "";

  /* ---------- ประวัติ ---------- */
  const EVENT_LABELS = Object.freeze({
    created: "ยื่นใบขอสิทธิ์",
    dept_approved: "ผู้จัดการแผนกอนุมัติ",
    dept_rejected: "ผู้จัดการแผนกไม่อนุมัติ",
    it_mgr_approved: "ผู้อนุมัติขั้น IT อนุมัติ",
    it_mgr_rejected: "ผู้อนุมัติขั้น IT ไม่อนุมัติ",
    cancelled: "ผู้ยื่นยกเลิก",
    started: "IT รับงาน",
    applied: "IT บันทึกสิทธิ์ลงทะเบียน",
    acknowledged: "ผู้ใช้รับทราบสิทธิ์",
    info_requested: "ถามผู้ยื่น",
    info_provided: "ผู้ยื่นตอบคำถาม",
  });
  const eventLabel = (action) => EVENT_LABELS[action] ?? action ?? "";
  // ป้ายในไทม์ไลน์: ยกเลิกโดยคนที่ไม่ใช่ผู้ยื่น = IT ยกเลิกแทน
  const CANCELLED_ON_BEHALF_LABEL = "IT ยกเลิกแทนผู้ยื่น";
  function eventLabelFor(event, requester) {
    if (event?.action === "cancelled" && requester?.employee_no && event.actor_employee_no && event.actor_employee_no !== requester.employee_no) return CANCELLED_ON_BEHALF_LABEL;
    return eventLabel(event?.action);
  }
  // สรุปอนุมัติ 2 ขั้นในหน้ารายละเอียด: อนุมัติแล้ว · ไม่อนุมัติ (ดูจาก events) · รอ · ไม่มี (ใบจบไปก่อนถึงขั้นนี้)
  function approvalSummary(detail) {
    const events = listOf(detail?.events);
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

  /* ---------- ผู้รับสิทธิ์ / ผู้ยื่น ---------- */
  // ชื่อผู้รับสิทธิ์ในรายการ/หัวใบ: ชื่อไทย (ชื่ออังกฤษต่อท้ายถ้ามี) · ผู้ยื่นเป็นคนอื่น = บอกในหน้ารายละเอียด
  function subjectName(subject) {
    const thai = textOf(subject?.name_th);
    const english = textOf(subject?.name_en);
    return [thai, english && english !== thai ? `(${english})` : ""].filter(Boolean).join(" ") || "—";
  }
  // ผู้ยื่นกับผู้รับสิทธิ์เป็นคนละคนหรือไม่ (ใช้บอกในหัวใบ) · เทียบรหัสพนักงาน ถ้าผู้รับสิทธิ์ไม่มีบัญชี = ต่างคนเสมอ
  const filedForOther = (detail) => !detail?.subject?.employee_no || detail.subject.employee_no !== detail.requester?.employee_no;

  /* ---------- งาน IT: จัดกลุ่ม ---------- */
  const IT_GROUPS = Object.freeze([
    { key: "to_start", label: "รอ IT รับงาน" },
    { key: "in_progress", label: "IT กำลังดำเนินการ" },
    { key: "awaiting_ack", label: "รอผู้ใช้รับทราบ" },
    { key: "awaiting_info", label: "รอผู้ยื่นตอบ" },
    { key: "awaiting_approval", label: "รออนุมัติ" },
    { key: "closed", label: "จบแล้ว / ไม่อนุมัติ / ยกเลิก" },
  ]);
  function itGroupOf(row) {
    switch (row?.status) {
      case "approved": return "to_start";
      case "in_progress": return "in_progress";
      case "awaiting_ack": return "awaiting_ack";
      case "need_info": return "awaiting_info"; // รอผู้ยื่นตอบ: ไม่ใช่งานที่ IT ต้องลงมือ
      case "pending_dept":
      case "pending_it_mgr": return "awaiting_approval";
      default: return "closed";
    }
  }
  const byText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  // งานที่ยังไม่จบ: เวลาที่ยื่นก่อน (เก่าสุดขึ้นก่อน) แล้วเลขที่เอกสาร · ไม่มีงานด่วน
  const compareActive = (a, b) => byText(a.created_at, b.created_at) || byText(a.doc_no, b.doc_no);
  const compareClosed = (a, b) => byText(b.created_at, a.created_at) || byText(b.doc_no, a.doc_no);
  function groupItOrders(rows) {
    const groups = Object.fromEntries(IT_GROUPS.map((group) => [group.key, []]));
    for (const row of listOf(rows)) groups[itGroupOf(row)].push(row);
    for (const key of Object.keys(groups)) groups[key].sort(key === "closed" ? compareClosed : compareActive);
    return groups;
  }
  // งาน IT ที่ต้องลงมือ (ตัวเลขบนแท็บ/การ์ด): รอรับงาน + กำลังดำเนินการ
  const itActionableCount = (rows) => listOf(rows).filter((row) => ["to_start", "in_progress"].includes(itGroupOf(row))).length;
  // ใบของฉันที่รอ "ฉัน": รอรับทราบสิทธิ์ (ฉันเป็นผู้รับสิทธิ์) / รอตอบคำถาม (ฉันเป็นผู้ยื่น)
  const awaitingMyAckCount = (rows) => listOf(rows).filter((row) => row.status === "awaiting_ack" && row.needs_my_ack).length;
  const awaitingMyAnswerCount = (rows) => listOf(rows).filter((row) => row.status === "need_info" && row.is_requester).length;
  function mineWaiting(rows) {
    const ack = awaitingMyAckCount(rows);
    const answer = awaitingMyAnswerCount(rows);
    return { ack, answer, total: ack + answer };
  }
  // คำอธิบายตัวเลขบนแท็บ "ใบของฉัน" (aria/title): บอกว่ารออะไร
  function mineWaitingNote(parts) {
    const ack = Number(parts?.ack) || 0;
    const answer = Number(parts?.answer) || 0;
    if (ack && answer) return ` (รอคุณรับทราบ ${ack} · รอคุณตอบ ${answer})`;
    return answer ? " ที่รอคุณตอบ" : " ที่รอคุณรับทราบ";
  }
  // รออนุมัติที่ "รอฉัน" จริง: ตัดใบที่รอผู้ยื่นตอบ (need_info) ออก
  const waitingForMeCount = (rows) => listOf(rows).filter((row) => row.status !== "need_info").length;
  const itApprovalProgress = (row) => [
    { label: "ผู้จัดการแผนก", done: Boolean(row?.has_dept_approved) },
    { label: "ผู้อนุมัติขั้น IT", done: Boolean(row?.has_it_mgr_approved) },
  ];

  /* ---------- ตัวเลขบนการ์ด ---------- */
  const CLOSED_STATUSES = Object.freeze(["done", "rejected", "cancelled"]);
  // จำนวนใบที่ "ยังไม่จบ" ที่ผู้ใช้มองเห็น (รวมใบของฉัน · รออนุมัติ · งาน IT แบบไม่นับซ้ำด้วย id) · แหล่งที่อ่านไม่ได้ผู้เรียกต้องไม่เรียกฟังก์ชันนี้ (ใช้ null)
  function openOrderCount(...sources) {
    const ids = new Set();
    for (const rows of sources) {
      for (const row of listOf(rows)) {
        if (row?.id === null || row?.id === undefined || CLOSED_STATUSES.includes(row.status)) continue;
        ids.add(String(row.id));
      }
    }
    return ids.size;
  }
  function cardSummary({ approvals = null, itWork = null, toAck = null, toAnswer = null, openCount = null } = {}) {
    const parts = [
      { key: "approvals", label: "รออนุมัติ", count: approvals },
      { key: "it", label: "งาน IT ค้าง", count: itWork },
      { key: "ack", label: "รอคุณรับทราบสิทธิ์", count: toAck },
      { key: "answer", label: "รอคุณตอบ", count: toAnswer },
    ].filter((part) => Number.isFinite(part.count) && part.count > 0);
    const total = parts.reduce((sum, part) => sum + part.count, 0);
    return {
      total,
      parts,
      openCount: Number.isFinite(openCount) ? openCount : null,
      badge: total > 0 ? `${total} รอคุณ` : "",
      title: parts.map((part) => `${part.label} ${part.count}`).join(" · "),
    };
  }

  /* ---------- ผู้รับสิทธิ์ของใบที่กำลังยื่น ---------- */
  // โหมดเลือกผู้รับสิทธิ์: self = ตัวเอง · other = ค้นจากรายชื่อ · manual = คนที่ไม่มีบัญชีและไม่มีในทะเบียน (กรอกเอง · เฉพาะผู้ดูแลงาน IT)
  // ผู้ดูแลงาน IT ยื่นแทนใครก็ได้ทุกประเภท · ผู้จัดการ/ผู้ช่วยแผนกยื่นแทนลูกน้องได้เฉพาะ "ยกเลิกทั้งหมด" (ตามสัญญา) · ฐานข้อมูลตรวจสิทธิ์จริงอีกครั้ง
  function subjectModes(role, type) {
    const modes = [{ value: "self", label: "ตัวฉันเอง" }];
    if (role?.is_it_admin) {
      modes.push({ value: "other", label: "คนอื่น (ค้นจากรายชื่อ)" });
      if (type !== "revoke_all") modes.push({ value: "manual", label: "คนที่ไม่มีบัญชีในระบบ (กรอกเอง)" });
    } else if (role?.is_dept_approver && type === "revoke_all") {
      modes.push({ value: "other", label: "ลูกน้องในแผนกของฉัน (ค้นจากรายชื่อ)" });
    }
    return modes;
  }
  const subjectModeAllowed = (role, type, mode) => subjectModes(role, type).some((item) => item.value === mode);
  // ผลค้นหา (app_itar_search_subjects) → รายการให้เลือก: พนักงาน (มีบัญชี) และผู้ใช้ในทะเบียนที่ไม่ผูกพนักงาน (ไม่มีบัญชี)
  // ผู้ใช้ทะเบียนที่ผูกพนักงานอยู่แล้วไม่แสดงซ้ำ (เลือกผ่านพนักงานแล้วฐานข้อมูลผูกให้เอง)
  function searchChoices(data) {
    const employees = listOf(data?.employees).map((row) => ({
      key: `e:${row.id}`, kind: "employee", id: row.id, name: textOf(row.full_name), meta: [row.employee_no, row.department_name, row.user_id ? "มีในทะเบียนสิทธิ์" : "ยังไม่มีในทะเบียนสิทธิ์"].filter(Boolean).join(" · "),
    }));
    const users = listOf(data?.users).filter((row) => !row.employee_id).map((row) => ({
      key: `u:${row.id}`, kind: "user", id: row.id, name: subjectName({ name_th: row.name_th, name_en: row.name_en }), meta: [row.auth_id, row.department_code, row.status === "resigned" ? "ลาออกแล้ว" : "ไม่มีบัญชีพนักงาน"].filter(Boolean).join(" · "),
    }));
    return [...employees, ...users];
  }
  // ตรวจส่วนเลือกผู้รับสิทธิ์ก่อนโหลดฟอร์ม · values = { type, mode, pick, name_th, name_en, department_id, division } → ข้อความผิดข้อแรก หรือ ""
  function subjectProblem(values, role) {
    const type = values?.type;
    if (!REQUEST_TYPES.some((item) => item.value === type)) return "กรุณาเลือกประเภทคำขอ";
    const mode = values?.mode || "self";
    if (!subjectModeAllowed(role, type, mode)) return "คุณยื่นใบขอสิทธิ์ให้ผู้รับสิทธิ์แบบนี้ไม่ได้ (ยื่นแทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT)";
    if (mode === "other" && !values?.pick) return "กรุณาค้นหาและเลือกผู้รับสิทธิ์";
    if (mode === "manual") {
      if (!textOf(values?.name_th) && !textOf(values?.name_en)) return "กรุณาระบุชื่อผู้รับสิทธิ์ (ไทยหรืออังกฤษอย่างน้อยหนึ่ง)";
      if (charCount(values?.name_th) > MAX_NAME || charCount(values?.name_en) > MAX_NAME) return `ชื่อต้องไม่เกิน ${MAX_NAME} ตัวอักษร`;
      if (!values?.department_id) return "กรุณาเลือกแผนกของผู้รับสิทธิ์";
    }
    if (type === "new" && !DIVISIONS.some((item) => item.value === values?.division)) return "กรุณาเลือกฝ่ายของผู้ใช้ใหม่";
    if (charCount(values?.name_en) > MAX_NAME) return `ชื่ออังกฤษต้องไม่เกิน ${MAX_NAME} ตัวอักษร`;
    return "";
  }
  // p_subject ของ app_itar_form_context / app_itar_create · ไม่ส่ง employee_id/user_id/ชื่อ = ฐานข้อมูลถือว่าเป็นตัวผู้ยื่นเอง
  // ตัวเอง: ส่ง employee_id ชัด ๆ (ถ้าส่งแค่ name_en ฐานข้อมูลจะตีความว่าเป็นคนไม่มีบัญชี) · ขอใหม่ต้องส่ง division (และชื่ออังกฤษถ้ากรอก)
  function subjectParams(values, role) {
    const type = values?.type;
    const mode = values?.mode || "self";
    const subject = {};
    if (mode === "self") subject.employee_id = role?.employee_id;
    else if (mode === "other") {
      if (values.pick?.kind === "user") subject.user_id = values.pick.id;
      else subject.employee_id = values.pick?.id;
    } else {
      if (textOf(values.name_th)) subject.name_th = textOf(values.name_th);
      subject.department_id = values.department_id;
    }
    if (textOf(values.name_en) && (type === "new" || mode === "manual")) subject.name_en = textOf(values.name_en);
    if (type === "new" || (mode === "manual" && values.division)) subject.division = values.division;
    return subject;
  }

  /* ---------- บริบทของฟอร์ม (app_itar_form_context) ---------- */
  // normalizeContext: จัดรูปให้หน้าเว็บใช้ง่าย · linked = ผู้รับสิทธิ์ผูกทะเบียนแล้ว (รู้สิทธิ์ปัจจุบัน → ต้องส่ง from กลับตามที่เห็น)
  function normalizeContext(data) {
    const rights = data?.rights ?? null;
    const type = data?.request_type;
    return {
      type,
      subject: data?.subject ?? {},
      // ใบ "ขอใหม่" ไม่มีสิทธิ์เดิม (ผู้ใช้ยังไม่อยู่ในทะเบียน) · ใบอื่นที่ไม่ผูกทะเบียน = ไม่รู้สิทธิ์ปัจจุบัน ส่งเฉพาะ to
      linked: Boolean(data?.linked) && Boolean(rights),
      rights,
      folders: listOf(data?.catalog?.folders),
      programs: listOf(data?.catalog?.programs),
      departments: listOf(data?.departments),
      policy: data?.policy ?? null,
    };
  }
  // สิทธิ์ปัจจุบันของผู้รับสิทธิ์ในรูปที่ค้นง่าย
  function rightsIndex(rights) {
    return {
      folders: new Map(listOf(rights?.folders).map((row) => [String(row.code), { level: row.level ?? null, name: row.name, active: row.is_active !== false }])),
      internet: Boolean(rights?.internet),
      programs: new Map(listOf(rights?.programs).map((row) => [String(row.code), { name: row.name, note: row.note ?? null, active: row.is_active !== false }])),
      emails: listOf(rights?.emails).map((row) => ({ address: String(row.address), kind: row.kind })),
    };
  }

  /* ---------- ตัวเลือกในฟอร์มสิทธิ์ ---------- */
  // ค่าของแต่ละแถว (select): "keep" = ไม่ขอเปลี่ยน/ไม่ขอ · "none" = ไม่มีสิทธิ์ (โฟลเดอร์) · "R"/"F" · "yes"/"no" (อินเทอร์เน็ต/โปรแกรม)
  // ผูกทะเบียนแล้ว (linked + เปลี่ยนแปลง) ค่าเริ่มต้นคือสิทธิ์ปัจจุบัน แล้วเทียบกับสิ่งที่ผู้ใช้เลือก (ต่างจากเดิม = รายการที่ขอ) · นอกนั้นเริ่มที่ "keep"
  const KEEP = "keep";
  const isChangeLinked = (ctx) => ctx.type === "change" && ctx.linked;
  const folderCurrentValue = (level) => level ?? "none";
  const boolCurrentValue = (flag) => (flag ? "yes" : "no");
  const withCurrent = (options, current, linked) => options.map((option) => ({ ...option, label: linked && option.value === current ? `${option.label} · ปัจจุบัน` : option.label }));
  function folderRows(ctx) {
    const index = rightsIndex(ctx.rights);
    const linked = isChangeLinked(ctx);
    const rows = ctx.folders.map((folder) => ({ code: String(folder.code), name: folder.name, description: folder.description ?? "", active: true }));
    // โฟลเดอร์ที่ปิดใช้งานแล้วแต่ผู้ใช้ยังมีสิทธิ์อยู่: แสดงให้ถอดได้อย่างเดียว (ขอเพิ่มไม่ได้)
    if (linked) {
      const known = new Set(rows.map((row) => row.code));
      for (const [code, info] of index.folders) if (!known.has(code)) rows.push({ code, name: info.name, description: "", active: false });
    }
    return rows.map((row) => {
      const current = linked ? folderCurrentValue(index.folders.get(row.code)?.level) : null;
      let options;
      if (linked) {
        options = [{ value: "none", label: "ไม่มีสิทธิ์" }, ...LEVELS];
        if (!row.active) options = options.filter((option) => option.value === "none" || option.value === current);
      } else if (ctx.type === "new") {
        options = [{ value: KEEP, label: "— ไม่ขอ —" }, ...LEVELS];
      } else {
        options = [{ value: KEEP, label: "— ไม่เปลี่ยน —" }, ...LEVELS, { value: "none", label: "ถอดสิทธิ์ (ไม่มีสิทธิ์)" }];
      }
      return { ...row, current, options: withCurrent(options, current, linked), initial: linked ? current : KEEP };
    });
  }
  function boolOptions(ctx, current) {
    const linked = isChangeLinked(ctx);
    if (linked) return withCurrent([{ value: "no", label: "ไม่มี" }, { value: "yes", label: "มี" }], current, true);
    if (ctx.type === "new") return [{ value: KEEP, label: "— ไม่ขอ —" }, { value: "yes", label: "ขอใช้" }];
    return [{ value: KEEP, label: "— ไม่เปลี่ยน —" }, { value: "yes", label: "ขอใช้" }, { value: "no", label: "ถอดสิทธิ์" }];
  }
  function internetRow(ctx) {
    const linked = isChangeLinked(ctx);
    const current = linked ? boolCurrentValue(rightsIndex(ctx.rights).internet) : null;
    return { current, options: boolOptions(ctx, current), initial: linked ? current : KEEP };
  }
  function programRows(ctx) {
    const index = rightsIndex(ctx.rights);
    const linked = isChangeLinked(ctx);
    return ctx.programs.map((program) => {
      const code = String(program.code);
      const current = linked ? boolCurrentValue(index.programs.has(code)) : null;
      return { code, name: program.name, isOther: code === "OTHER", current, options: boolOptions(ctx, current), initial: linked ? current : KEEP, currentNote: index.programs.get(code)?.note ?? "" };
    });
  }
  // ตัวเลือกชนิดอีเมลที่ขอเพิ่มได้: อีเมลภายในมีได้ 1 ที่อยู่ต่อคน (ผู้ใช้ที่มีอยู่แล้วขอซ้ำไม่ได้) · ขอใหม่เลือกได้ทั้งสอง
  function emailKindOptions(ctx) {
    const hasInternal = ctx.linked && rightsIndex(ctx.rights).emails.some((email) => email.kind === "internal");
    return hasInternal ? EMAIL_KINDS.filter((kind) => kind.value !== "internal") : EMAIL_KINDS.slice();
  }
  // อีเมลที่ใช้งานอยู่ของผู้รับสิทธิ์ (ติ๊กขอปิดได้) · เฉพาะ "เปลี่ยนแปลง" ที่ผูกทะเบียนแล้ว
  const currentEmails = (ctx) => (isChangeLinked(ctx) ? rightsIndex(ctx.rights).emails : []);

  // ค่าเริ่มต้นของฟอร์ม: choices = ค่าที่ผู้ใช้ปรับ (เก็บเป็นข้อมูลล้วนเพื่อทำร่าง/ทดสอบได้)
  function initialChoices(ctx) {
    return {
      folders: Object.fromEntries(folderRows(ctx).map((row) => [row.code, row.initial])),
      internet: internetRow(ctx).initial,
      internetNote: "",
      programs: Object.fromEntries(programRows(ctx).map((row) => [row.code, row.initial])),
      programNotes: {},
      emailAdds: [],
      emailCloses: [],
    };
  }
  // โหลดบริบทใหม่หลังสิทธิ์ถูกแก้ระหว่างกรอก (40001): เก็บสิ่งที่ผู้ใช้ "ตั้งใจเปลี่ยน" ไว้ (ค่าที่ต่างจากค่าเริ่มต้นเดิม และยังเลือกได้ในบริบทใหม่) ส่วนที่ไม่ได้แตะใช้ค่าเริ่มต้นของบริบทใหม่
  // ผลคือรายการที่ส่งใหม่ใช้ from จากทะเบียนล่าสุด · อีเมลที่ติ๊กปิดเก็บเฉพาะที่ยังใช้งานอยู่
  function carryChoices(oldCtx, oldChoices, newCtx) {
    const fresh = initialChoices(newCtx);
    const oldFolders = new Map(folderRows(oldCtx).map((row) => [row.code, row]));
    for (const row of folderRows(newCtx)) {
      const before = oldFolders.get(row.code);
      const value = oldChoices.folders?.[row.code];
      if (before && value !== undefined && value !== before.initial && row.options.some((option) => option.value === value)) fresh.folders[row.code] = value;
    }
    const oldInternet = internetRow(oldCtx);
    if (oldChoices.internet !== undefined && oldChoices.internet !== oldInternet.initial && internetRow(newCtx).options.some((option) => option.value === oldChoices.internet)) {
      fresh.internet = oldChoices.internet;
      fresh.internetNote = oldChoices.internetNote ?? "";
    }
    const oldPrograms = new Map(programRows(oldCtx).map((row) => [row.code, row]));
    for (const row of programRows(newCtx)) {
      const before = oldPrograms.get(row.code);
      const value = oldChoices.programs?.[row.code];
      if (before && value !== undefined && value !== before.initial && row.options.some((option) => option.value === value)) {
        fresh.programs[row.code] = value;
        if (oldChoices.programNotes?.[row.code]) fresh.programNotes[row.code] = oldChoices.programNotes[row.code];
      }
    }
    fresh.emailAdds = listOf(oldChoices.emailAdds).map((email) => ({ ...email }));
    const active = new Set(currentEmails(newCtx).map((email) => email.address));
    fresh.emailCloses = listOf(oldChoices.emailCloses).filter((address) => active.has(address));
    return fresh;
  }
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // ตรงกับ app_itar_create
  const normalizeEmail = (value) => textOf(value).toLowerCase();

  // สร้าง p_items จากสิ่งที่ผู้ใช้เลือก (ฐานข้อมูลตรวจซ้ำทุกข้อและเป็นผู้ตัดสิน)
  //   ผูกทะเบียนแล้ว: ส่ง from = สิทธิ์ปัจจุบันที่ผู้ใช้เห็น (ไม่ตรงกับทะเบียนตอนยื่น = 40001 ให้โหลดใหม่) เฉพาะรายการที่ต่างจากเดิม
  //   ไม่ผูกทะเบียน/ขอใหม่: ส่งเฉพาะ to (ไม่รู้ค่าเดิม ให้ IT เลือกผู้ใช้ตอนบันทึก)
  // revoke_all ไม่มีรายการ (ระบบถอดสิทธิ์ทั้งหมดให้) · คืน { items, problems:[{ name, message }] } (problems ว่าง = ส่งได้)
  function buildItems(ctx, choices) {
    if (ctx.type === "revoke_all") return { items: [], problems: [] };
    const items = [];
    const problems = [];
    const linked = isChangeLinked(ctx);
    for (const row of folderRows(ctx)) {
      const value = choices.folders?.[row.code] ?? row.initial;
      if (value === row.initial) continue;
      const to = value === "none" ? null : value;
      if (linked) items.push({ kind: "folder", target: row.code, from: row.current === "none" ? null : row.current, to });
      else items.push({ kind: "folder", target: row.code, to });
    }
    const internet = internetRow(ctx);
    const internetValue = choices.internet ?? internet.initial;
    if (internetValue !== internet.initial) {
      const to = internetValue === "yes";
      const note = textOf(choices.internetNote);
      if (to && !note) problems.push({ name: "internet_note", message: "กรุณาระบุเหตุผลที่ขอใช้อินเทอร์เน็ต" });
      if (note && charCount(note) > MAX_NOTE) problems.push({ name: "internet_note", message: `เหตุผลต้องไม่เกิน ${MAX_NOTE} ตัวอักษร` });
      const item = linked ? { kind: "internet", from: internet.current === "yes", to } : { kind: "internet", to };
      if (to && note) item.note = note;
      items.push(item);
    }
    for (const row of programRows(ctx)) {
      const value = choices.programs?.[row.code] ?? row.initial;
      if (value === row.initial) continue;
      const to = value === "yes";
      const note = textOf(choices.programNotes?.[row.code]);
      if (to && row.isOther && !note) problems.push({ name: "program_note", message: "กรุณาระบุว่าเป็นโปรแกรมอะไร (เมื่อเลือกโปรแกรม \"อื่นๆ\")" });
      if (note && charCount(note) > MAX_NOTE) problems.push({ name: "program_note", message: `ชื่อโปรแกรมต้องไม่เกิน ${MAX_NOTE} ตัวอักษร` });
      const item = linked ? { kind: "program", target: row.code, from: row.current === "yes", to } : { kind: "program", target: row.code, to };
      if (to && row.isOther && note) item.note = note;
      items.push(item);
    }
    // อีเมล: ปิดของเดิม (ติ๊ก) + ขอที่อยู่ใหม่ (พิมพ์เอง) · ที่อยู่ซ้ำในใบเดียวกันไม่ได้
    const seen = new Set();
    for (const address of listOf(choices.emailCloses)) {
      const target = normalizeEmail(address);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      items.push({ kind: "email", target, to: "close" });
    }
    const internalAdds = listOf(choices.emailAdds).filter((email) => textOf(email.address) && email.kind === "internal");
    if (internalAdds.length > 1) problems.push({ name: "email_add", message: "อีเมลภายในมีได้ 1 ที่อยู่ต่อคน" });
    for (const email of listOf(choices.emailAdds)) {
      const target = normalizeEmail(email.address);
      if (!target) continue; // แถวว่างไม่นับ
      if (!EMAIL_PATTERN.test(target) || charCount(target) > MAX_EMAIL) { problems.push({ name: "email_add", message: `รูปแบบอีเมลไม่ถูกต้อง: ${textOf(email.address)}` }); continue; }
      if (seen.has(target)) { problems.push({ name: "email_add", message: `อีเมล ${target} ซ้ำกันในใบเดียวกัน` }); continue; }
      seen.add(target);
      items.push({ kind: "email", target, to: "add", email_kind: email.kind === "internal" ? "internal" : "extra" });
    }
    if (!items.length && !problems.length) {
      problems.push({ name: "items", message: linked ? "ยังไม่ได้เปลี่ยนสิทธิ์อะไรเลย กรุณาเลือกสิทธิ์ที่ต้องการเพิ่ม ลด หรือเปลี่ยน อย่างน้อยหนึ่งรายการ" : "กรุณาเลือกสิทธิ์ที่ต้องการอย่างน้อยหนึ่งรายการ" });
    }
    if (items.length > MAX_ITEMS) problems.push({ name: "items", message: `ขอสิทธิ์ได้ครั้งละไม่เกิน ${MAX_ITEMS} รายการ` });
    return { items, problems };
  }
  // เหตุผลรวมของใบ (บังคับ) + กติกาช่องเดียวสำหรับ MNP_FORM_STEPS.validate
  const requestRules = () => [{
    name: "reason", required: true, message: "กรุณาระบุเหตุผลที่ขอ",
    check: (value) => charCount(value) <= MAX_REQUEST_REASON, checkMessage: `เหตุผลต้องไม่เกิน ${MAX_REQUEST_REASON.toLocaleString("en-US")} ตัวอักษร`,
  }];
  // พารามิเตอร์ของ app_itar_create
  const createParams = ({ type, reason, items, subject }) => ({
    p_request_type: type, p_reason: textOf(reason), p_items: items, p_subject: subject ?? null,
  });

  /* ---------- ตาราง "ก่อน → หลัง" ---------- */
  const TRUE_FALSE = Object.freeze({ true: "มี", false: "ไม่มี" });
  // item = รายการแบบที่ app_itar_get_detail คืน (from_value/to_value เป็นข้อความ) · ดูข้างล่าง previewItems สำหรับรายการที่ยังไม่ได้ส่ง
  function itemLabel(item) {
    if (item.kind === "folder") return ["โฟลเดอร์", item.target, item.target_name].filter(Boolean).join(" ");
    if (item.kind === "internet") return "อินเทอร์เน็ต";
    if (item.kind === "program") return item.target === "OTHER" && item.note ? `โปรแกรม ${item.target_name ?? item.target}: ${item.note}` : `โปรแกรม ${item.target_name ?? item.target}`;
    return `อีเมล ${item.target}${item.email_kind && item.to_value === "add" ? ` (${emailKindLabel(item.email_kind)})` : ""}`;
  }
  const valueText = (item, which) => {
    const value = which === "from" ? item.from_value : item.to_value;
    if (item.kind === "folder") return levelLabel(value || null);
    if (item.kind === "email") return which === "from" ? (item.to_value === "close" ? "ใช้งานอยู่" : "—") : (item.to_value === "add" ? "ขอเปิดอีเมลใหม่" : "ปิดอีเมล");
    return TRUE_FALSE[value] ?? "—";
  };
  const UNKNOWN_BEFORE = "ไม่ทราบ (ยังไม่ผูกทะเบียน)";
  // แถวของตารางก่อน → หลัง · result = ผลที่ IT ตัดสินหลังบันทึกลงทะเบียน (ยังไม่ตัดสิน = null)
  function itemRows(detail) {
    return listOf(detail?.items).slice().sort((a, b) => Number(a.line_no) - Number(b.line_no)).map((item) => {
      const result = item.result ?? null;
      return {
        no: item.line_no,
        label: itemLabel(item),
        before: item.from_known === false ? UNKNOWN_BEFORE : valueText(item, "from"),
        after: valueText(item, "to"),
        note: item.kind === "internet" || (item.kind === "program" && item.target !== "OTHER") ? textOf(item.note) : "",
        result: result ? { decision: result.decision, label: result.decision === "applied" ? "บันทึกแล้ว" : "ไม่บันทึก", reason: textOf(result.reason), at: result.at } : null,
      };
    });
  }
  // รายการที่กำลังจะส่ง → แถวแบบเดียวกัน (ขั้นทบทวนก่อนส่ง) · แปลง p_items ให้อยู่ในรูปของ detail ก่อนใช้ตัวเดียวกัน
  function previewRows(ctx, items) {
    const folderNames = new Map(folderRows(ctx).map((row) => [row.code, row.name]));
    const programNames = new Map(programRows(ctx).map((row) => [row.code, row.name]));
    const detailItems = items.map((item, index) => {
      const known = ctx.linked || ctx.type === "new";
      const base = { line_no: index + 1, kind: item.kind, target: item.target ?? null, from_known: known, note: item.note ?? null, email_kind: item.email_kind ?? null };
      if (item.kind === "folder") return { ...base, target_name: folderNames.get(item.target) ?? null, from_value: item.from ?? null, to_value: item.to ?? null };
      if (item.kind === "internet") return { ...base, from_value: ctx.type === "new" ? "false" : item.from === undefined ? null : String(item.from), to_value: String(item.to) };
      if (item.kind === "program") return { ...base, target_name: programNames.get(item.target) ?? null, from_value: ctx.type === "new" ? "false" : item.from === undefined ? null : String(item.from), to_value: String(item.to) };
      return { ...base, from_value: null, to_value: item.to };
    });
    return itemRows({ items: detailItems });
  }
  // สรุปสิทธิ์ที่ผู้ใช้มี (หน้าฟอร์ม "สิทธิ์ปัจจุบัน" · ใบยกเลิกทั้งหมด · สิทธิ์หลังเปลี่ยนในหน้ารายละเอียด) · rights = ผลของ private.itar_subject_rights · ไม่มี = null
  function rightsSummary(rights) {
    if (!rights) return null;
    const folders = listOf(rights.folders).map((row) => ({ code: row.code, name: row.name, level: row.level, text: levelLabel(row.level) }));
    const programs = listOf(rights.programs).map((row) => ({ code: row.code, name: row.name, note: row.note ?? "" }));
    const emails = listOf(rights.emails).map((row) => ({ address: row.address, kindLabel: emailKindLabel(row.kind) }));
    return {
      folders, programs, emails, internet: Boolean(rights.internet),
      counts: { folders: folders.length, programs: programs.length, emails: emails.length, internet: rights.internet ? 1 : 0 },
      status: rights.status ?? null,
    };
  }
  // ข้อความจำนวนสิทธิ์ที่จะถูกถอดเมื่อ "ยกเลิกทั้งหมด" เช่น "โฟลเดอร์ 3 · โปรแกรม 1 · อีเมล 1 · อินเทอร์เน็ต"
  function revokeText(summary) {
    if (!summary) return "จะถอดสิทธิ์โฟลเดอร์ อินเทอร์เน็ต โปรแกรม และปิดอีเมลทั้งหมดของผู้ใช้นี้ (IT ตรวจกับทะเบียนตอนบันทึก)";
    const parts = [
      summary.counts.folders ? `โฟลเดอร์ ${summary.counts.folders}` : "",
      summary.counts.programs ? `โปรแกรม ${summary.counts.programs}` : "",
      summary.counts.emails ? `อีเมล ${summary.counts.emails}` : "",
      summary.internet ? "อินเทอร์เน็ต" : "",
    ].filter(Boolean);
    return parts.length ? `จะถอดสิทธิ์ทั้งหมด: ${parts.join(" · ")}` : "จะถอดสิทธิ์ทั้งหมด (ปัจจุบันไม่มีสิทธิ์ใดในทะเบียน) และเปลี่ยนสถานะผู้ใช้เป็นลาออก";
  }

  /* ---------- ไฟล์แนบ ---------- */
  // ชนิดไฟล์ที่ฐานข้อมูล/Storage รับ (ตรงกับ private.itar_allowed_mime_types และ private.itar_file_path_request_id ใน migration 20270107010000)
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
  const FILES_PREPARING_MESSAGE = "กำลังเตรียมไฟล์ รอสักครู่ แล้วกดส่งอีกครั้ง";
  const UNSUPPORTED_FILE_MESSAGE = "ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)";
  const fileExtension = (name) => (/\.([A-Za-z0-9]+)$/.exec(String(name ?? ""))?.[1] ?? "").toLowerCase();
  const fileMime = (file) => FILE_MIME_BY_EXTENSION[fileExtension(file?.name)] ?? null;
  const fileBucket = (isTest) => (isTest ? "itar-test-files" : "itar-files");
  // path ที่ฐานข้อมูลบังคับ: <id ใบ>/<uuid พิมพ์เล็ก>.<นามสกุลพิมพ์เล็ก>
  const filePath = (requestId, uuid, file) => `${String(requestId).toLowerCase()}/${String(uuid).toLowerCase()}.${fileExtension(file?.name)}`;
  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }
  // ตรวจชุดไฟล์ก่อนส่ง (ฐานข้อมูลและ Storage ตรวจซ้ำ) คืนข้อความไทยข้อแรกที่ผิด หรือ null
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
  // รายการที่ต้องอัปโหลด: แต่ละไฟล์ได้ path ของตัวเองครั้งเดียว (ลองซ้ำใช้ path เดิม ไม่เกิดไฟล์กำพร้าซ้ำ)
  const makeUploadEntries = (requestId, files, uuid) => Array.from(files ?? []).map((file) => ({
    file, path: filePath(requestId, uuid(), file), nextPath: () => filePath(requestId, uuid(), file), uploaded: false, registered: false, error: null,
  }));
  const isAlreadyUploaded = (error) => String(error?.statusCode ?? error?.status ?? "") === "409" || /already exists|duplicate/i.test(String(error?.message ?? ""));
  // ฐานข้อมูลปฏิเสธการลงทะเบียนเพราะ "ตัวไฟล์ที่อยู่ใน Storage" (ไม่พบไฟล์ / ตรวจชนิดหรือขนาดไม่ได้ / นามสกุลไม่ตรง / ไม่รองรับ / ใหญ่เกิน) → ครั้งถัดไปต้องอัปโหลดใหม่ด้วย path ใหม่
  const isFileRejection = (error) => /กรุณาอัปโหลดไฟล์ใหม่|^ชนิดไฟล์นี้ไม่รองรับ|^ไฟล์ต้องมีขนาดไม่เกิน/.test(String(error?.message ?? ""));
  // อัปโหลด + ลงทะเบียนทีละไฟล์ตามลำดับ · ไฟล์ที่ล้มไม่หยุดไฟล์ที่เหลือ · เรียกซ้ำกับรายการเดิมได้: ข้ามขั้นที่ทำสำเร็จแล้ว · คืนรายการที่ยังไม่สำเร็จ
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
        if (entry.uploaded && !entry.registered && isFileRejection(error) && typeof entry.nextPath === "function") {
          entry.uploaded = false;
          entry.path = entry.nextPath();
        }
      }
      done += 1;
      onProgress(done, pending.length, entry);
    }
    return entries.filter((entry) => !entry.registered);
  }
  // ไฟล์ของ gallery ใน app.js (attachmentGalleryHtml / hydrateAttachmentGallery) ใช้ชื่อฟิลด์ content_type
  const galleryFile = (file) => ({ id: file.id, file_name: file.file_name, content_type: file.mime_type, size_bytes: file.size_bytes, storage_path: file.storage_path });
  // ผลล้างข้อมูลทดสอบ: ฐานข้อมูลลบแถวแล้ว (deleted) ส่วนไฟล์ใน Storage หน้าเว็บลบตามรายการที่ได้ (total) ได้จริง removed ไฟล์
  function purgeSummary({ deleted, total, removed }) {
    const base = `ล้างข้อมูลทดสอบแล้ว ${deleted} แถว`;
    if (!total) return { complete: true, message: base };
    if (removed >= total) return { complete: true, message: `${base} · ลบไฟล์ ${total} ไฟล์` };
    return { complete: false, message: `${base} · ลบไฟล์ได้ ${removed} จาก ${total} ไฟล์ ยังเหลือ ${total - removed} ไฟล์ กดล้างข้อมูลอีกครั้งเพื่อลบไฟล์ที่เหลือ` };
  }

  /* ---------- เหตุผลไม่อนุมัติ / ยกเลิก · ถาม-ตอบ ---------- */
  function validateReason(reason, kind = "ไม่อนุมัติ") {
    const text = textOf(reason);
    if (!text) return `กรุณาระบุเหตุผลที่${kind}`;
    if (charCount(text) > MAX_REASON) return `เหตุผลต้องไม่เกิน ${MAX_REASON} ตัวอักษร`;
    return null;
  }
  const infoRules = (kind) => [{
    name: "body", required: true,
    message: kind === "answer" ? "กรุณาพิมพ์คำตอบ" : "กรุณาพิมพ์ข้อความที่ต้องการถามผู้ยื่น",
    check: (value) => charCount(value) <= MAX_INFO_BODY, checkMessage: `ข้อความต้องไม่เกิน ${MAX_INFO_BODY.toLocaleString("en-US")} ตัวอักษร`,
  }];
  const infoParams = (requestId, values) => ({ p_request_id: requestId, p_body: textOf(values.body) });

  /* ---------- ตั้งค่า (it_admin) ---------- */
  function formatDocNo(isTest, year, seq) {
    const seqText = seq < 1000 ? String(seq).padStart(3, "0") : String(seq);
    return `${isTest ? "TEST-" : ""}IT08-01-${pad(year % 100)}/${seqText}`;
  }
  // เลขถัดไปตั้งได้เฉพาะเดินหน้า (ฐานข้อมูลตรวจซ้ำ) · nextSeq = เลขถัดไปปัจจุบัน
  function validateNextSeq(value, nextSeq) {
    const text = textOf(value);
    if (!/^\d+$/.test(text)) return "กรุณากรอกเลขถัดไปเป็นจำนวนเต็ม";
    const number = Number(text);
    if (number < 1 || number > 9999) return "เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999";
    if (number <= nextSeq) return `ตั้งได้เฉพาะเลขที่มากกว่าเลขถัดไปปัจจุบัน (${nextSeq}) เท่านั้น ถอยหลังหรือซ้ำไม่ได้`;
    return null;
  }
  const staffRoleText = (row) => [row?.is_it_admin ? "ผู้ดูแลงาน IT" : "", row?.is_it_approver ? "ผู้อนุมัติขั้น IT" : "", row?.is_it_viewer ? VIEWER_LABEL : "", row?.is_itas_admin ? "บันทึกลงทะเบียนสิทธิ์ได้" : ""].filter(Boolean).join(" · ");

  /* ---------- ข้อผิดพลาด ---------- */
  // error จาก PostgREST/Postgres ที่แปลว่า "ไม่มีฟังก์ชันนี้ในฐานข้อมูล" (เจ้าของ merge หน้าเว็บก่อน apply migration) ไม่ใช่ข้อผิดพลาดของข้อมูล
  function isMissingFunction(error) {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "");
    return code === "PGRST202" || code === "42883" || /could not find the function|schema cache|function [^\n]* does not exist/i.test(message);
  }
  // 40001 = สิทธิ์ปัจจุบันถูกแก้ไปแล้วระหว่างกรอก → โหลดข้อมูลล่าสุดแล้วให้ลองใหม่ (ข้อความของฐานข้อมูลบอกอยู่แล้ว)
  const isStaleRights = (error) => String(error?.code ?? "") === "40001";
  // kind: "session" เซสชันหมดอายุ · "unknown" ไม่ได้คำตอบจากเซิร์ฟเวอร์ (ผลไม่แน่ชัด) · "missing" ฐานข้อมูลยังไม่มีฟังก์ชัน · "stale" ข้อมูลสิทธิ์เก่า · "rejected" เซิร์ฟเวอร์ตอบปฏิเสธ
  // ข้อความไทยของฐานข้อมูล (errcode 42501 / 23514 / 40001) ส่งต่อให้ผู้ใช้ตรง ๆ ส่วนข้อความเทคนิคภาษาอังกฤษไม่แสดง
  const THAI = /[฀-๿]/;
  const NETWORK = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|internet connection appears to be offline|failed to send a request|err_internet|err_network|econnreset|the request timed out/i;
  const SESSION_CODES = ["PGRST301", "PGRST303", "AUTH_REQUIRED"];
  const SESSION_MESSAGE = "หมดเวลาการเข้าสู่ระบบ กรุณาโหลดหน้านี้ใหม่แล้วเข้าสู่ระบบอีกครั้ง (สิ่งที่กรอกไว้ยังอยู่ในหน้า)";
  const UNKNOWN_WRITE_MESSAGE = "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ (ระบบอาจบันทึกไปแล้ว)";
  const UNKNOWN_READ_MESSAGE = "โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
  const MISSING_MESSAGE = "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับใบขอสิทธิ์ IT กรุณาแจ้งผู้ดูแลระบบ";
  const GENERIC_MESSAGE = "ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ";
  const STALE_HINT = " (โหลดสิทธิ์ปัจจุบันใหม่ให้แล้ว กรุณาตรวจรายการแล้วกดส่งอีกครั้ง)";
  function describeError(error, { write = false } = {}) {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "");
    if (error?.status === 401 || SESSION_CODES.includes(code) || /JWT expired|AUTH_REQUIRED/i.test(message)) return { kind: "session", message: SESSION_MESSAGE };
    if (code === "PGRST202" || code === "42883") return { kind: "missing", message: MISSING_MESSAGE };
    if (code === "40001" && THAI.test(message)) return { kind: "stale", message: message.includes("โหลดข้อมูลล่าสุด") ? message : `${message}${STALE_HINT}`, forwarded: true };
    // ไม่มีรหัส = คำขอไปไม่ถึงหรือคำตอบไม่กลับมา · ข้อความไทยที่โค้ดของเราโยนเอง (throw new Error("…")) ไม่ใช่เรื่องเครือข่าย แสดงตามนั้น
    if (!code && THAI.test(message) && !NETWORK.test(message)) return { kind: "rejected", message, forwarded: true };
    if (!code || NETWORK.test(message)) return { kind: "unknown", message: write ? UNKNOWN_WRITE_MESSAGE : UNKNOWN_READ_MESSAGE };
    if (["42501", "23514"].includes(code) && THAI.test(message)) return { kind: "rejected", message, forwarded: true };
    return { kind: "rejected", message: GENERIC_MESSAGE };
  }
  // error ของการอัปโหลดไฟล์ขึ้น Storage (ข้อความอังกฤษของ Storage ไม่แสดงตรง ๆ) · ส่วน error ของ RPC ลงทะเบียนไฟล์ใช้ describeError ตามปกติ
  // comment = ไฟล์ของข้อความถาม/ตอบ (หน้าต่าง 30 นาทีนับจากส่งข้อความ ไม่เกี่ยวกับการอนุมัติ)
  function describeUploadError(error, { comment = false } = {}) {
    const status = String(error?.statusCode ?? error?.status ?? "");
    const message = String(error?.message ?? "");
    if (status === "403" || /row-level security|not authorized|unauthorized/i.test(message)) {
      return { kind: "rejected", message: comment ? "อัปโหลดไฟล์ไม่ได้ อาจหมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังส่งข้อความ) หรือใบนี้สิ้นสุดแล้ว" : "อัปโหลดไฟล์ไม่ได้ อาจหมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาที) หรือมีผู้อนุมัติใบนี้แล้ว" };
    }
    if (status === "413" || /too large|exceeded the maximum/i.test(message)) return { kind: "rejected", message: `ไฟล์ต้องมีขนาดไม่เกิน ${MAX_FILE_BYTES / 1048576} MB` };
    if (status === "415" || /mime type/i.test(message)) return { kind: "rejected", message: UNSUPPORTED_FILE_MESSAGE };
    const info = describeError(error, { write: true });
    return info.kind === "unknown" ? { kind: "unknown", message: "เชื่อมต่อระบบไม่ได้ สัญญาณอาจขาด กดลองอีกครั้งได้เลย" } : info;
  }

  const api = {
    MODULE_VERSION, VERSION_DATE, IN_DEVELOPMENT, YEAR_OFFSET,
    MAX_REQUEST_REASON, MAX_REASON, MAX_REASON_ON_BEHALF, MAX_INFO_BODY, MAX_NOTE, MAX_ITEMS, MAX_NAME, MAX_EMAIL, MAX_FILES, MAX_FILE_BYTES,
    REQUEST_TYPES, DIVISIONS, LEVELS, LEVEL_HELP, EMAIL_KINDS, STATUS_LABELS, EVENT_LABELS, ACTION_BUTTONS, ACTION_ORDER, DEFERRED_ACTIONS, IT_GROUPS, INFO_STAGE_LABELS, CANCEL_ON_BEHALF,
    requestTypeLabel, divisionLabel, levelLabel, emailKindLabel, statusLabel, statusBadgeClass, myStatusLabel, isTestDoc,
    infoStageLabel, commentKindLabel, commentRows, allFiles, pendingQuestion, infoBadgeTitle,
    formatDate, formatDateTime, charCount, clip,
    VIEWER_LABEL, isItViewer, canSeeAllOrders, canApprove, visibleTabs, readView, viewAllowed, accessUrl, isUuid,
    actionButtons, deferredActions, isCancelOnBehalf, cancelReasonSpec, countsAsBothSteps, confirmMessageFor, BOTH_STEPS_NOTE, answerToast, pendingStepLabel,
    eventLabel, eventLabelFor, CANCELLED_ON_BEHALF_LABEL, approvalSummary,
    subjectName, filedForOther, itGroupOf, groupItOrders, itActionableCount, awaitingMyAckCount, awaitingMyAnswerCount, mineWaiting, mineWaitingNote, waitingForMeCount, itApprovalProgress,
    CLOSED_STATUSES, openOrderCount, cardSummary,
    subjectModes, subjectModeAllowed, searchChoices, subjectProblem, subjectParams,
    normalizeContext, rightsIndex, KEEP, folderRows, internetRow, programRows, emailKindOptions, currentEmails, initialChoices, carryChoices, buildItems, requestRules, createParams,
    UNKNOWN_BEFORE, itemLabel, itemRows, previewRows, rightsSummary, revokeText,
    FILE_MIME_BY_EXTENSION, FILE_ACCEPT, FILE_HINT, FILES_PREPARING_MESSAGE, fileExtension, fileMime, fileBucket, filePath, formatFileSize, validateFiles,
    makeUploadEntries, isAlreadyUploaded, isFileRejection, runUploads, galleryFile, purgeSummary,
    validateReason, infoRules, infoParams, formatDocNo, validateNextSeq, staffRoleText,
    isMissingFunction, isStaleRights, describeError, describeUploadError,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITAR_MODEL = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
