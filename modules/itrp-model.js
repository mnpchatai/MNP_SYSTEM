// ใบแจ้งซ่อมคอมพิวเตอร์ (itrp) — ส่วนข้อมูลล้วนของหน้าเว็บ ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itrp-model.test.mjs)
// คัดโครงจากใบสั่งงาน IT (itwo-model.js) แล้วปรับฟิลด์ตามฟอร์มกระดาษ "ใบแจ้งซ่อมคอมพิวเตอร์" · สเปก: Work-Order/docs/itrp-spec.md · สัญญา RPC: docs/itrp-contract.md
// ฐานข้อมูลเป็นผู้ตัดสินทุกอย่าง (เลขที่เอกสาร สิทธิ์ ลำดับขั้น): ไฟล์นี้แค่ตั้งชื่อ จัดกลุ่ม ซ่อน/แสดงปุ่มตาม my_role / allowed_actions
// และตรวจฟอร์มให้ผู้ใช้เห็นข้อความไทยก่อนส่ง (ฐานข้อมูลตรวจซ้ำเสมอ)
// วันที่แสดงเป็น วว/ดด/ปปปป (พ.ศ. ตามที่ใบสั่งงาน IT ใช้) เวลา Asia/Bangkok — เปลี่ยนปีเป็น ค.ศ. ได้ที่ YEAR_OFFSET จุดเดียว
(function (root) {
  "use strict";

  const YEAR_OFFSET = 543;
  const MAX_SYMPTOM = 2000; // อาการเสีย · ตรงกับ app_itrp_create
  const MAX_LONG_TEXT = 2000; // สาเหตุ / การซ่อม-แก้ไข / รายละเอียดขอแก้ไข · ตรงกับ app_itrp_complete และ app_itrp_request_rework
  const MAX_ASSET_CODE = 50;
  const MAX_DEVICE_NAME = 200;
  const MAX_NOTE = 200; // ข้อความระบุของ "อื่นๆ" / ผู้ซ่อม-สถานที่ส่งซ่อม / ชื่อรายการและหมายเหตุของอะไหล่
  const MAX_PR_PO = 100;
  const MAX_PARTS = 10; // แถวอะไหล่/วัสดุสูงสุดต่อการส่งงานหนึ่งครั้ง
  const MAX_DEVICES = 10; // แถวเครื่อง/อุปกรณ์ที่ซ่อมสูงสุดต่อการส่งงานหนึ่งครั้ง · ตรงกับ app_itrp_complete (p_devices)
  const MAX_DEVICE_CODE = 50; // รหัสเครื่องในประวัติการซ่อม/ทะเบียนเครื่อง (ตรงกับ private.itrp_code_error)
  const MAX_REMARK = 500; // ข้อเสนอแนะต่อเครื่อง / ในประวัติการซ่อม
  const MAX_REASON = 500;
  const MAX_INFO_BODY = 2000; // ข้อความถาม/ตอบ ตรงกับ app_itrp_request_info / app_itrp_provide_info
  const MAX_FILES = 10; // ต่อหนึ่งครั้งที่ส่ง (ตอนแจ้ง แต่ละรอบแก้ไข หรือแต่ละข้อความถาม/ตอบ) ตรงกับ app_itrp_add_attachment / app_itrp_add_comment_attachment
  const MAX_FILE_BYTES = 20 * 1024 * 1024; // ต่อไฟล์ ตรงกับ bucket และตาราง itrp_attachments
  // เลขเวอร์ชันของโมดูล (แสดงมุมขวาล่างทุกหน้า) รูปแบบ <ใหญ่>.<ย่อย 2 หลัก> · กติกาเดียวกับใบสั่งงาน IT (เจ้าของตัดสิน 20/11/2026)
  // อัปเดตย่อย (แก้คำ หน้าตา บั๊ก ช่องเล็ก ๆ) = +0.01 · อัปเดตใหญ่ (เปลี่ยนขั้นตอนงาน/สถานะ/ฟีเจอร์ใหม่ที่ผู้ใช้ต้องเรียนรู้) = ขึ้นหลักหน่วย .00
  // ถามเจ้าของทุกครั้งว่าเป็นอัปเดตย่อยหรือใหญ่ แล้วแก้ทั้งสองค่านี้ใน PR เดียวกับการเปลี่ยนแปลง (VERSION_DATE = วันที่ปล่อย YYYY-MM-DD)
  const MODULE_VERSION = "1.03";
  const VERSION_DATE = "2026-11-25";
  // ธง "กำลังพัฒนา" (จุดเดียว): true = การ์ดใบแจ้งซ่อม IT ในเมนูมีป้าย "กำลังพัฒนา" และทุกหน้าของโมดูลมีแถบข้อความว่ายังไม่เปิดใช้งานจริง
  // ป้ายกับแถบเป็นข้อความอย่างเดียว ไม่ปิดกั้นการกดเข้าหรือการใช้งาน · ถอดป้ายเมื่อเจ้าของสั่งเปิดใช้งานจริง: เปลี่ยนเป็น false ที่นี่ที่เดียว
  const IN_DEVELOPMENT = true;

  /* ---------- ตัวเลือกของฟอร์ม ---------- */
  // ประเภทคำขอ (ผู้แจ้งเลือก 1) · other ต้องระบุ
  const REQUEST_KINDS = Object.freeze([
    { value: "repair", label: "ซ่อม" },
    { value: "replace_part", label: "เปลี่ยนอะไหล่" },
    { value: "inspect", label: "ตรวจเช็ค" },
    { value: "install", label: "ติดตั้ง" },
    { value: "other", label: "อื่นๆ" },
  ]);
  // ประเภทงานซ่อม (ผู้แจ้งเลือก 1) · other ต้องระบุ
  const REPAIR_TARGETS = Object.freeze([
    { value: "computer", label: "เครื่องคอมพิวเตอร์" },
    { value: "device", label: "อุปกรณ์" },
    { value: "other", label: "อื่นๆ" },
  ]);
  // สรุปสาเหตุเกิดจาก (IT เลือก 1 ตอนส่งงาน) · other ต้องระบุ
  const CAUSE_KINDS = Object.freeze([
    { value: "usage", label: "การใช้งาน" },
    { value: "part_expired", label: "อะไหล่หมดอายุ" },
    { value: "other", label: "อื่นๆ" },
  ]);
  // การตรวจซ่อม (IT เลือก 1 ตอนส่งงาน) · sent_out ต้องระบุสถานที่ · external_onsite ระบุชื่อผู้ซ่อมได้ (ไม่บังคับ) · internal ไม่มีผู้ซ่อมภายนอก
  const REPAIR_METHODS = Object.freeze([
    { value: "internal", label: "ซ่อม-แก้ไขภายใน" },
    { value: "external_onsite", label: "เรียกผู้ซ่อมจากภายนอก" },
    { value: "sent_out", label: "ส่งซ่อมที่" },
  ]);

  const labelOf = (list, value) => list.find((item) => item.value === value)?.label ?? value ?? "";
  const requestKindLabel = (value) => labelOf(REQUEST_KINDS, value);
  const repairTargetLabel = (value) => labelOf(REPAIR_TARGETS, value);
  const causeKindLabel = (value) => labelOf(CAUSE_KINDS, value);
  const repairMethodLabel = (value) => labelOf(REPAIR_METHODS, value);
  // "อื่นๆ" ตามด้วยข้อความที่ระบุ: "อื่นๆ · <ข้อความ>" (ตัวเลือกอื่นแสดงชื่อตัวเลือกล้วน)
  const withNote = (label, note, isOther) => (isOther && String(note ?? "").trim() ? `${label} · ${String(note).trim()}` : label);
  const requestKindText = (kind, note) => withNote(requestKindLabel(kind), note, kind === "other");
  const repairTargetText = (target, note) => withNote(repairTargetLabel(target), note, target === "other");
  const causeKindText = (kind, note) => withNote(causeKindLabel(kind), note, kind === "other");
  // การตรวจซ่อม: "ส่งซ่อมที่ <สถานที่>" · "เรียกผู้ซ่อมจากภายนอก <ชื่อผู้ซ่อม>" · ซ่อมภายในไม่มีชื่อต่อท้าย
  const repairMethodText = (method, vendor) => {
    const name = String(vendor ?? "").trim();
    return name && method !== "internal" ? `${repairMethodLabel(method)} ${name}` : repairMethodLabel(method);
  };
  // เครื่องที่แจ้ง: "<รหัสเครื่อง> · <ชื่อเครื่อง>" (ไม่มีรหัสเครื่องแสดงแค่ชื่อ)
  const deviceText = (row) => [String(row?.asset_code ?? "").trim(), String(row?.device_name ?? "").trim()].filter(Boolean).join(" · ");

  /* ---------- สถานะ ---------- */
  const STATUS_LABELS = Object.freeze({
    pending_dept: "รอผู้จัดการแผนก",
    pending_it_mgr: "รอผู้อนุมัติขั้น IT",
    approved: "อนุมัติครบ",
    in_progress: "กำลังดำเนินการ",
    it_closed: "IT ส่งงาน (รอผู้แจ้งยืนยัน)",
    need_info: "รอผู้แจ้งตอบ",
    received: "จบงานแล้ว",
    rejected: "ไม่อนุมัติ",
    cancelled: "ยกเลิก",
  });
  // ป้ายสถานะใช้ class .badge ของระบบ (styles.css) จึงแปลงสถานะของใบแจ้งซ่อมเป็นชื่อ class ที่ระบบมีสีให้แล้ว
  const STATUS_BADGE_CLASS = Object.freeze({
    pending_dept: "pending_approval",
    pending_it_mgr: "pending_approval",
    approved: "approved",
    in_progress: "in_progress",
    it_closed: "pending_verify",
    need_info: "more_info", // ป้ายสีอำพันเครื่องหมาย ? ของระบบ (ขอข้อมูลเพิ่ม)
    received: "completed",
    rejected: "rejected",
    cancelled: "cancelled",
  });
  const statusLabel = (status) => STATUS_LABELS[status] ?? status ?? "";
  const statusBadgeClass = (status) => STATUS_BADGE_CLASS[status] ?? "";
  // ผู้แจ้งเห็นคำที่บอกว่าถึงคิวของตัวเอง (หน้า "ใบของฉัน")
  const MY_STATUS_LABELS = Object.freeze({ it_closed: "IT ส่งงานแล้ว รอคุณยืนยัน", need_info: "รอคุณตอบ" });
  const myStatusLabel = (status) => MY_STATUS_LABELS[status] ?? statusLabel(status);

  /* ---------- ถาม-ตอบ ---------- */
  // ขั้นของผู้ถาม (itrp_comments.stage): dept = ผู้จัดการแผนก · it_mgr = ผู้อนุมัติขั้น IT · it = ทีม IT (หลังอนุมัติ / ระหว่างทำงาน)
  const INFO_STAGE_LABELS = Object.freeze({ dept: "ผู้จัดการแผนก", it_mgr: "ผู้อนุมัติขั้น IT", it: "ทีม IT" });
  const infoStageLabel = (stage) => INFO_STAGE_LABELS[stage] ?? stage ?? "";
  const COMMENT_KIND_LABELS = Object.freeze({ question: "ถาม", answer: "ตอบ" });
  const commentKindLabel = (kind) => COMMENT_KIND_LABELS[kind] ?? kind ?? "";
  // ข้อความถาม/ตอบทุกข้อความเรียงตามลำดับจริง (id) พร้อมไฟล์ของข้อความนั้น · ไม่มี = []
  function commentRows(detail) {
    return (Array.isArray(detail?.comments) ? detail.comments : []).slice().sort((a, b) => Number(a.id) - Number(b.id)).map((comment, index) => ({
      id: comment.id,
      no: index + 1,
      kind: comment.kind,
      kindLabel: commentKindLabel(comment.kind),
      stage: comment.stage,
      stageLabel: infoStageLabel(comment.stage),
      body: comment.body,
      by: comment.author_full_name,
      at: comment.created_at,
      files: Array.isArray(comment.attachments) ? comment.attachments : [],
    }));
  }
  // ไฟล์ทุกไฟล์ของใบ: ตอนแจ้ง + รอบแก้ไข + ข้อความถาม/ตอบ (เข้า gallery ตัวเดียวของหน้ารายละเอียด)
  const allFiles = (detail) => [...(Array.isArray(detail?.attachments) ? detail.attachments : []), ...commentRows(detail).flatMap((comment) => comment.files)];
  // คำถามที่ค้างอยู่ + ไฟล์ของคำถามนั้น (ผู้แจ้งเห็นเด่น ๆ พร้อมฟอร์มตอบ) · ไม่มี = null
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
  // คำอธิบายป้าย "รอผู้แจ้งตอบ" ในรายการ (title ของป้าย): ใครถาม และตอบแล้วใบกลับไปที่ไหน · mine = มุมมองผู้แจ้ง
  function infoBadgeTitle(row, mine = false) {
    if (row?.status !== "need_info") return "";
    const asker = row.info_stage ? (mine ? `${infoStageLabel(row.info_stage)} ถามคุณ` : `ถามโดย ${infoStageLabel(row.info_stage)}`) : "";
    const back = row.info_return_status ? `ตอบแล้วใบกลับไปที่ ${statusLabel(row.info_return_status)}` : "";
    return [asker, back].filter(Boolean).join(" · ");
  }
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
  // วันนี้ตามเวลาไทย YYYY-MM-DD (ค.ศ.) ใช้เป็นค่าต่ำสุดของวันที่กำหนดเสร็จตอนขอแก้ไข
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
  // วันที่และเวลาแยกกัน (ช่อง "วันที่" / "เวลา" บนใบพิมพ์) · ไม่มีค่า = ""
  function formatDateOf(timestamp) {
    const text = formatDateTime(timestamp);
    return text === "—" ? "" : text.split(" ")[0];
  }
  function formatTimeOf(timestamp) {
    const text = formatDateTime(timestamp);
    return text === "—" ? "" : (text.split(" ")[1] ?? "");
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
  // รวมเวลาในการซ่อม: จากเริ่มดำเนินการ (event started) ถึงซ่อมเสร็จ (event completed ล่าสุด) เป็นวัน/ชั่วโมง (ปัดชั่วโมงลง)
  // ข้อมูลไม่ครบหรือเวลาย้อนกลับ = null (ช่องว่าง) · น้อยกว่า 1 ชั่วโมงแสดง "น้อยกว่า 1 ชม."
  function repairDuration(startedAt, completedAt) {
    const start = Date.parse(startedAt ?? "");
    const end = Date.parse(completedAt ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const totalHours = Math.floor((end - start) / 3600000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const text = totalHours < 1 ? "น้อยกว่า 1 ชม." : [days > 0 ? `${days} วัน` : "", hours > 0 ? `${hours} ชม.` : ""].filter(Boolean).join(" ");
    return { days, hours, totalHours, text };
  }
  // จำนวน/ราคาของอะไหล่ที่ฐานข้อมูลคืนเป็นตัวเลขทศนิยม 2 ตำแหน่ง · จำนวนตัดศูนย์ท้าย ราคาแสดงสองตำแหน่งพร้อมจุลภาคหลักพัน · ไม่มีค่า = ""
  const finite = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
  const formatQuantity = (value) => (finite(value) === null ? "" : finite(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
  const formatPrice = (value) => (finite(value) === null ? "" : finite(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  /* ---------- สิทธิ์ → แท็บ ---------- */
  // role = ผลของ app_itrp_my_role · แท็บเป็น UX ล้วน ฐานข้อมูลตรวจสิทธิ์ซ้ำทุก RPC
  // อ่านประวัติการซ่อมเครื่อง (FM02) / ทะเบียนเครื่องได้เฉพาะผู้ดูแลงาน IT กับผู้อนุมัติขั้น IT · แก้ไข/ลงเพิ่มได้เฉพาะผู้ดูแลงาน IT (ฐานข้อมูลตรวจซ้ำทุก RPC)
  const canViewHistory = (role) => Boolean(role?.is_it_admin || role?.is_it_approver);
  const canEditHistory = (role) => Boolean(role?.is_it_admin);
  function visibleTabs(role) {
    const tabs = [{ key: "mine", label: "ใบของฉัน" }];
    if (role?.is_dept_approver || role?.is_it_approver) tabs.push({ key: "approvals", label: "รออนุมัติ" });
    if (role?.is_it_admin || role?.is_it_approver) tabs.push({ key: "it", label: "งาน IT" });
    if (canViewHistory(role)) tabs.push({ key: "history", label: "ประวัติการซ่อม" });
    if (role?.is_it_admin) tabs.push({ key: "settings", label: "ตั้งค่า" });
    return tabs;
  }
  // history-print = ใบพิมพ์ประวัติการซ่อมของเครื่องหนึ่งเครื่อง (?view=history-print&code=<รหัสเครื่อง>) ไม่ใช่แท็บแต่ต้องมีสิทธิ์อ่านประวัติเหมือนแท็บ
  const VIEWS = Object.freeze(["mine", "approvals", "it", "history", "settings", "new", "order", "print", "history-print"]);
  const TAB_VIEWS = Object.freeze(["mine", "approvals", "it", "history", "settings"]);
  function readView(params) {
    const view = params?.get?.("view") ?? "";
    if (view === "") return "mine";
    return VIEWS.includes(view) ? view : null;
  }
  // หน้าแท็บที่ผู้ใช้ไม่มีสิทธิ์เห็น (พิมพ์ URL เอง) ให้กลับ "ใบของฉัน" · หน้าอื่นไม่ใช่แท็บ (ใบพิมพ์ประวัติใช้สิทธิ์เดียวกับแท็บประวัติ)
  const viewAllowed = (view, role) => (view === "history-print" ? canViewHistory(role) : !TAB_VIEWS.includes(view) || visibleTabs(role).some((tab) => tab.key === view));
  function repairUrl(view = "mine", extra = {}) {
    const query = new URLSearchParams({ module: "repair" });
    if (view && view !== "mine") query.set("view", view);
    for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
    return `#/office?${query.toString()}`;
  }
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));

  /* ---------- ปุ่มตาม allowed_actions ---------- */
  // ลำดับปุ่ม: ตัดสินใจก่อน แล้วขั้นตอนของ IT แล้วของผู้แจ้ง · reason = ต้องกรอกเหตุผล (ไม่อนุมัติ/ยกเลิก) · tone ใช้เลือกสีปุ่ม
  // opens = ไม่ยิง RPC ทันที แต่เปิดฟอร์มของตัวเองที่ module-itrp.js: ask (ถามผู้แจ้ง) · complete (ฟอร์มส่งงาน) · rework (แก้ไขงาน) · answer = ฟอร์มตอบวาดเปิดไว้ในหน้าอยู่แล้ว (inline ไม่มีปุ่มในแผงปุ่ม)
  const ACTION_BUTTONS = Object.freeze({
    approve: { label: "อนุมัติ", tone: "success", rpc: "app_itrp_approve", done: "อนุมัติแล้ว", confirmTitle: "อนุมัติใบแจ้งซ่อมนี้?", confirmMessage: "การกดอนุมัติบันทึกชื่อ วันที่ และเวลาของคุณเป็นลายเซ็นอิเล็กทรอนิกส์ แก้ไขย้อนหลังไม่ได้" },
    reject: { label: "ไม่อนุมัติ", tone: "danger", rpc: "app_itrp_reject", done: "บันทึกการไม่อนุมัติแล้ว", reason: { title: "ไม่อนุมัติใบแจ้งซ่อมนี้?", label: "เหตุผลที่ไม่อนุมัติ", hint: "ใบนี้จะจบทันทีและเปิดใหม่ไม่ได้ ผู้แจ้งต้องแจ้งเป็นใบใหม่", confirmLabel: "ไม่อนุมัติ" } },
    start: { label: "เริ่มดำเนินการ", tone: "primary", rpc: "app_itrp_start", done: "เริ่มดำเนินการแล้ว", confirmTitle: "เริ่มดำเนินการใบแจ้งซ่อมนี้?", confirmMessage: "ระบบบันทึกว่าคุณเป็นผู้รับงานนี้ พร้อมวันและเวลา (เวลานี้ใช้เป็น \"เริ่มดำเนินการซ่อม\" บนใบพิมพ์)" },
    request_info: { label: "ถามผู้แจ้ง", tone: "secondary", opens: "ask", rpc: "app_itrp_request_info", confirmTitle: "ส่งคำถามถึงผู้แจ้ง?", confirmMessage: "ใบจะเปลี่ยนเป็น รอผู้แจ้งตอบ และกลับมาดำเนินการต่อได้เมื่อผู้แจ้งตอบ ระหว่างนี้อนุมัติ ไม่อนุมัติ เริ่มงาน หรือส่งงานไม่ได้ ต้องรอคำตอบก่อน · ระบบบันทึกชื่อ วันที่ และเวลาของคุณไว้ในประวัติเอกสาร", confirmLabel: "ส่งคำถาม", done: "ส่งคำถามถึงผู้แจ้งแล้ว" },
    provide_info: { label: "ตอบคำถาม", tone: "primary", opens: "answer", inline: true, rpc: "app_itrp_provide_info", confirmTitle: "ส่งคำตอบ?", confirmMessage: "ใบจะกลับไปดำเนินการต่อทันที · ระบบบันทึกชื่อ วันที่ และเวลาของคุณไว้ในประวัติเอกสาร แก้ไขย้อนหลังไม่ได้", confirmLabel: "ส่งคำตอบ", done: "ส่งคำตอบแล้ว" },
    // "ส่งงาน" เปิดฟอร์มบันทึกการซ่อม (ส่วน "สำหรับแผนก IT") แล้วค่อยยืนยันและเรียก app_itrp_complete พร้อมข้อมูลทั้งชุด
    complete: { label: "ส่งงาน", tone: "success", opens: "complete", rpc: "app_itrp_complete", done: "ส่งงานแล้ว รอผู้แจ้งยืนยันรับงาน", confirmTitle: "ส่งงานใบแจ้งซ่อมนี้?", confirmMessage: "ระบบบันทึกบันทึกการซ่อมที่กรอก และส่งใบกลับให้ผู้แจ้งตรวจ ผู้แจ้งจะยืนยันรับงานหรือขอแก้ไขงานได้ และยกเลิกใบไม่ได้ · บันทึกชื่อ วันที่ และเวลาของคุณเป็นช่างผู้ดำเนินการซ่อม", confirmLabel: "ส่งงาน" },
    receive: { label: "ได้รับงานเรียบร้อยแล้ว", tone: "success", rpc: "app_itrp_receive", done: "ยืนยันรับงานแล้ว", confirmTitle: "ยืนยันว่าได้รับงานเรียบร้อยแล้ว?", confirmMessage: "ใบแจ้งซ่อมจะจบทันที ทำซ้ำหรือขอแก้ไขอีกไม่ได้" },
    request_rework: { label: "แก้ไขงาน", tone: "secondary", opens: "rework" },
    cancel: { label: "ยกเลิกใบแจ้งซ่อม", tone: "danger", rpc: "app_itrp_cancel", done: "ยกเลิกใบแจ้งซ่อมแล้ว", reason: { title: "ยกเลิกใบแจ้งซ่อมนี้?", label: "เหตุผลที่ยกเลิก", hint: "ใบที่ยกเลิกแล้วเปิดใหม่ไม่ได้ ต้องแจ้งเป็นใบใหม่และได้เลขใหม่", confirmLabel: "ยกเลิกใบแจ้งซ่อม" } },
  });
  // IT (ผู้ดูแลงาน) ยกเลิกใบที่รอผู้แจ้งตอบ "แทนผู้แจ้ง": ใช้ปุ่ม cancel เดิม RPC เดิม แต่ข้อความกล่องเหตุผลบอกว่าเป็นการยกเลิกแทน
  // ฐานข้อมูลใส่คำนำหน้า "IT ยกเลิกแทนผู้แจ้ง: " (21 ตัวอักษร) ลงในเหตุผลของประวัติ จึงจำกัดเหตุผลฝั่งนี้ที่ 470 ตัว (ฐานข้อมูลรับได้ถึง 479)
  const MAX_REASON_ON_BEHALF = 470;
  const CANCEL_ON_BEHALF = Object.freeze({ title: "ยกเลิกใบแจ้งซ่อมแทนผู้แจ้ง?", label: "เหตุผลที่ยกเลิกแทนผู้แจ้ง", hint: "ใบนี้กำลังรอผู้แจ้งตอบ ระบบบันทึกชื่อคุณว่าเป็นผู้ยกเลิกแทนผู้แจ้งพร้อมเหตุผลนี้ ใบที่ยกเลิกแล้วเปิดใหม่ไม่ได้ ผู้แจ้งต้องแจ้งเป็นใบใหม่", confirmLabel: "ยกเลิกแทนผู้แจ้ง", maxLength: MAX_REASON_ON_BEHALF });
  // ผู้ที่ไม่ใช่ผู้แจ้งแต่ได้ปุ่ม cancel = IT ยกเลิกแทน (ฐานข้อมูลเป็นตัวตัดสินสิทธิ์จริง) · role = app_itrp_my_role, detail = app_itrp_get_detail
  const isCancelOnBehalf = (detail, role) => Boolean(role?.employee_no) && Boolean(detail?.requester?.employee_no) && role.employee_no !== detail.requester.employee_no;
  // ค่ากล่องเหตุผลของปุ่ม cancel: ผู้แจ้งใช้ของเดิม · IT ยกเลิกแทนใช้ข้อความเฉพาะ
  function cancelReasonSpec(detail, role) {
    return isCancelOnBehalf(detail, role) ? CANCEL_ON_BEHALF : { ...ACTION_BUTTONS.cancel.reason, maxLength: MAX_REASON };
  }
  const ACTION_ORDER = Object.freeze(["approve", "reject", "request_info", "start", "complete", "receive", "request_rework", "provide_info", "cancel"]);
  // allowed = allowed_actions จาก app_itrp_get_detail · action ที่ไม่รู้จักไม่ขึ้นเป็นปุ่ม
  function actionButtons(allowed) {
    const set = new Set(Array.isArray(allowed) ? allowed : []);
    return ACTION_ORDER.filter((action) => set.has(action)).map((action) => ({ action, ...ACTION_BUTTONS[action] }));
  }
  // ข้อความในกล่องยืนยันของปุ่ม · "อนุมัติ" ของผู้อนุมัติขั้น IT ที่ขั้นแผนกยังไม่ผ่าน (แผนก IT / แผนกไม่มีผู้จัดการ / ผู้จัดการแผนกที่เป็นผู้อนุมัติขั้น IT ด้วย)
  // ฐานข้อมูลบันทึกทั้งสองขั้นในชื่อเขาในครั้งเดียว จึงบอกก่อนกด · role = ผลของ app_itrp_my_role, detail = app_itrp_get_detail (approvals.dept ว่าง = ขั้นแผนกยังไม่ผ่าน)
  // หน้าเว็บตัดสินได้แค่นี้ (ข้อมูลไม่ครบก็ใช้ข้อความมาตรฐาน) ตัวตัดสินจริงคือฐานข้อมูล
  const BOTH_STEPS_NOTE = "ใบนี้จะนับเป็นการอนุมัติทั้งขั้นแผนกและขั้น IT";
  function countsAsBothSteps(detail, role) {
    return Boolean(role?.is_it_approver) && Boolean(detail?.approvals) && !detail.approvals.dept && !detail.approvals.it_mgr;
  }
  function confirmMessageFor(action, detail, role) {
    const base = ACTION_BUTTONS[action]?.confirmMessage ?? "";
    return action === "approve" && countsAsBothSteps(detail, role) ? `${BOTH_STEPS_NOTE} · ${base}` : base;
  }
  // ข้อความแจ้งหลังตอบคำถาม: ใบกลับไปที่ขั้นที่ถาม (stage = ขั้นของคำถามที่ตอบ)
  const answerToast = (stage) => `ส่งคำตอบแล้ว ใบกลับไปที่${infoStageLabel(stage) || "ผู้ถาม"}`;
  // ข้อความแจ้งหลัง IT กดส่งงาน: บอกว่างานกลับไปหาผู้แจ้งแล้ว · โหมดทดสอบ (ผู้แจ้งเป็นบัญชีทดสอบอีกคน) บอกให้สลับบัญชีไปยืนยัน/ขอแก้ไข
  function completeToast(detail, isTest) {
    const name = detail?.requester?.full_name ?? "ผู้แจ้ง";
    const base = `ส่งกลับให้ ${name} ตรวจและยืนยันแล้ว`;
    return isTest ? `${base} · สลับเป็นบัญชีผู้แจ้งเพื่อยืนยันหรือขอแก้ไข` : base;
  }

  const PENDING_STEP_LABELS = Object.freeze({ dept: "รอคุณอนุมัติขั้นผู้จัดการแผนก", it_mgr: "รอคุณอนุมัติขั้น IT" });
  const pendingStepLabel = (step) => PENDING_STEP_LABELS[step] ?? step ?? "";

  /* ---------- ประวัติ / ลายเซ็น ---------- */
  const EVENT_LABELS = Object.freeze({
    created: "แจ้งซ่อม",
    dept_approved: "ผู้จัดการแผนกอนุมัติ",
    dept_rejected: "ผู้จัดการแผนกไม่อนุมัติ",
    it_mgr_approved: "ผู้อนุมัติขั้น IT อนุมัติ",
    it_mgr_rejected: "ผู้อนุมัติขั้น IT ไม่อนุมัติ",
    cancelled: "ผู้แจ้งยกเลิก",
    started: "IT เริ่มดำเนินการ",
    completed: "IT ส่งงาน",
    received: "ผู้แจ้งยืนยันรับงาน",
    rework_requested: "ผู้แจ้งขอแก้ไขงาน",
    info_requested: "ถามผู้แจ้ง",
    info_provided: "ผู้แจ้งตอบคำถาม",
  });
  const eventLabel = (action) => EVENT_LABELS[action] ?? action ?? "";
  // ป้ายในไทม์ไลน์: ยกเลิกโดยคนที่ไม่ใช่ผู้แจ้ง = IT ยกเลิกแทน (ชื่อผู้ทำแสดงตามจริงอยู่แล้วที่บรรทัด "โดย")
  const CANCELLED_ON_BEHALF_LABEL = "IT ยกเลิกแทนผู้แจ้ง";
  function eventLabelFor(event, requester) {
    if (event?.action === "cancelled" && requester?.employee_no && event.actor_employee_no && event.actor_employee_no !== requester.employee_no) return CANCELLED_ON_BEHALF_LABEL;
    return eventLabel(event?.action);
  }

  // ลายเซ็นบนใบพิมพ์ (ชื่อ + วันเวลาที่กดในระบบ) ตามการแมปของสเปก: ลงชื่อผู้อนุมัติ = ผู้อนุมัติขั้นแผนก · ส่งมอบงาน (แผนก IT) = ผู้กดส่งงานครั้งล่าสุด
  // รับมอบงาน = ผู้แจ้งที่กดยืนยันรับ · รับทราบ ฝ่ายบริหาร = ผู้อนุมัติขั้น IT · ยังไม่เกิด = ช่องว่าง (name null)
  const SINGLE_CLICK_REMARK = "อนุมัติครั้งเดียว นับเป็นทั้งสองขั้น";
  const SELF_APPROVED_REMARK = "อนุมัติในตัวเมื่อแจ้งซ่อม";
  const signoff = (entry) => ({ name: entry?.by ?? null, at: entry?.at ?? null });
  function printSignoffs(detail) {
    const dept = detail?.approvals?.dept ?? null;
    const itMgr = detail?.approvals?.it_mgr ?? null;
    // คนเดียวกดอนุมัติทั้งสองขั้น (แผนก IT / แผนกไม่มีผู้จัดการ / ผู้อนุมัติขั้น IT แจ้งเอง) ให้ชื่อเดียวกันขึ้นทั้งสองช่องพร้อมบอกเหตุ
    // ผู้จัดการแผนกที่แจ้งเอง (อนุมัติขั้นแผนกในตัว) บอกว่าเป็นการอนุมัติในตัว ไม่ใช่การเซ็นของคนอื่น
    const sameBoth = Boolean(dept && itMgr && dept.by === itMgr.by);
    const selfApproved = Boolean(dept && detail?.requester?.full_name && dept.by === detail.requester.full_name);
    return {
      approver: { ...signoff(dept), remark: dept && sameBoth ? SINGLE_CLICK_REMARK : dept && selfApproved ? SELF_APPROVED_REMARK : null },
      delivered: signoff(detail?.completed),
      received: signoff(detail?.received),
      acknowledged: { ...signoff(itMgr), remark: itMgr && sameBoth ? SINGLE_CLICK_REMARK : null },
    };
  }
  // ช่องสรุปผลการซ่อมบนใบพิมพ์: "ใช้งานได้สมบูรณ์" ติ๊กเมื่อผู้แจ้งยืนยันรับงาน (จบงานแล้ว) · "ส่งแก้ไข" ติ๊กเมื่อมีคำขอแก้ไขค้างอยู่ (ช่อง "เลขที่" เว้นว่าง ระบบใช้ใบเดิม)
  const printOutcome = (detail) => ({ complete: detail?.status === "received", rework: Boolean(detail?.rework_open) });

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
    { key: "awaiting_info", label: "รอผู้แจ้งตอบ" },
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
      case "need_info": return "awaiting_info"; // รอผู้แจ้งตอบ: ไม่ใช่งานที่ IT ต้องลงมือ (ไม่นับบนแท็บ/การ์ด)
      default: return "closed";
    }
  }
  const byText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  // งานที่ยังไม่จบ: งานด่วนก่อน แล้ววันกำหนดเสร็จของรอบแก้ไข (ไม่มีรอบแก้ไขอยู่หลังสุด) แล้วเวลาที่แจ้ง แล้วเลขที่เอกสาร (ตรงกับลำดับของ app_itrp_list_it)
  // ใบแจ้งซ่อมไม่มีวันที่ต้องการงานตอนแจ้ง จึงมีแต่วันกำหนดเสร็จของรอบแก้ไข
  const dueOf = (row) => (Number(row?.rework_round) > 0 && row.rework_due_date ? row.rework_due_date : "9999-12-31");
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
  // รายการที่รอผู้แจ้งยืนยัน (IT ส่งงานแล้ว) / รอผู้แจ้งตอบ (มีคนถามมา) · ตัวเลขบนแท็บ "ใบของฉัน" และการ์ดของผู้แจ้งนับสองอย่างรวมกัน
  const awaitingMyReceiveCount = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row.status === "it_closed").length;
  const awaitingMyAnswerCount = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row.status === "need_info").length;
  const mineWaiting = (rows) => {
    const confirm = awaitingMyReceiveCount(rows);
    const answer = awaitingMyAnswerCount(rows);
    return { confirm, answer, total: confirm + answer };
  };
  // คำอธิบายตัวเลขบนแท็บ "ใบของฉัน" (aria/title): บอกว่ารออะไร · ไม่มีรายละเอียด = รอยืนยันอย่างเดิม
  function mineWaitingNote(parts) {
    const confirm = Number(parts?.confirm) || 0;
    const answer = Number(parts?.answer) || 0;
    if (confirm && answer) return ` (รอคุณยืนยัน ${confirm} · รอคุณตอบ ${answer})`;
    return answer ? " ที่รอคุณตอบ" : " ที่รอคุณยืนยัน";
  }
  // รออนุมัติที่ "รอฉัน" จริง: ตัดใบที่รอผู้แจ้งตอบ (need_info) ออก (list_pending_approvals ส่งมาแสดง แต่ไม่ใช่งานที่ต้องกดอนุมัติ)
  const waitingForMeCount = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row.status !== "need_info").length;
  const itApprovalProgress = (row) => [
    { label: "ผู้จัดการแผนก", done: Boolean(row?.has_dept_approved) },
    { label: "ผู้อนุมัติขั้น IT", done: Boolean(row?.has_it_mgr_approved) },
  ];

  /* ---------- ตัวเลขบนการ์ด ---------- */
  // สถานะที่จบแล้ว (ไม่ใช่งานค้าง): จบงานแล้ว · ไม่อนุมัติ · ยกเลิก
  const CLOSED_STATUSES = Object.freeze(["received", "rejected", "cancelled"]);
  // จำนวนใบที่ "ยังไม่จบ" ที่ผู้ใช้มองเห็น (ตัวเลข "N ยังไม่จบ" บนการ์ด): รวมรายการจากทุกที่ที่ผู้ใช้เห็นใบ (ใบของฉัน · รออนุมัติ · งาน IT)
  // แล้วนับแบบไม่ซ้ำด้วย id (ใบเดียวอาจอยู่ทั้งใบของฉันและงาน IT) ตัดสถานะที่จบแล้วออก · แต่ละแหล่งเป็นอาร์เรย์ ผู้ใช้ที่ไม่มีสิทธิ์ดูแหล่งนั้นส่ง []
  // แหล่งที่ควรอ่านแต่อ่านไม่ได้ ผู้เรียกต้องไม่เรียกฟังก์ชันนี้ (ใช้ null) เพราะนับขาดจะแสดงเลขผิด
  function openOrderCount(...sources) {
    const ids = new Set();
    for (const rows of sources) {
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.id === null || row?.id === undefined || CLOSED_STATUSES.includes(row.status)) continue;
        ids.add(String(row.id));
      }
    }
    return ids.size;
  }
  // รวมงานที่รอ "คุณ": อนุมัติ + งาน IT ที่ต้องลงมือ + ใบที่รอคุณยืนยันรับ + ใบที่รอคุณตอบคำถาม · ค่าที่นับไม่ได้ (null) ข้ามไป ไม่ทำให้ทั้งการ์ดล้ม
  // openCount = จำนวนใบที่ยังไม่จบ (openOrderCount) หรือ null ถ้านับไม่ได้ · การ์ดแสดงเป็นป้ายหลัก "N ยังไม่จบ" ส่วน badge "N รอคุณ" เป็นป้ายรอง
  function cardSummary({ approvals = null, itWork = null, toConfirm = null, toAnswer = null, openCount = null } = {}) {
    const parts = [
      { key: "approvals", label: "รออนุมัติ", count: approvals },
      { key: "it", label: "งาน IT ค้าง", count: itWork },
      { key: "confirm", label: "รอคุณยืนยันรับงาน", count: toConfirm },
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

  /* ---------- ฟอร์มแจ้งซ่อม ---------- */
  const EMPTY_REPAIR_FORM = Object.freeze({ asset_code: "", device_name: "", request_kind: "", request_kind_note: "", repair_target: "", repair_target_note: "", symptom: "", is_urgent: false });
  // กติกาตามรูปแบบของ MNP_FORM_STEPS (modules/form-steps.js): step 1 = เครื่องและประเภทงาน · step 2 = อาการเสีย
  // required ของข้อความระบุ "อื่นๆ" เป็น getter เพราะขึ้นกับค่าที่เลือก ณ ตอนตรวจ · ข้อความผิดพลาดตรงกับของ app_itrp_create
  function repairRules({ requestKind = () => "", repairTarget = () => "" } = {}) {
    return [
      { name: "asset_code", step: 1, check: (value) => charCount(value) <= MAX_ASSET_CODE, checkMessage: `รหัสเครื่องคอมพิวเตอร์ต้องไม่เกิน ${MAX_ASSET_CODE} ตัวอักษร` },
      { name: "device_name", step: 1, required: true, message: "กรุณาระบุชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์", check: (value) => charCount(value) <= MAX_DEVICE_NAME, checkMessage: `ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์ต้องไม่เกิน ${MAX_DEVICE_NAME} ตัวอักษร` },
      { name: "request_kind", step: 1, required: true, message: "กรุณาเลือกประเภทคำขอ" },
      {
        name: "request_kind_note", step: 1, message: "กรุณาระบุประเภทคำขอ (เมื่อเลือก \"อื่นๆ\")",
        get required() { return requestKind() === "other"; },
        check: (value) => charCount(value) <= MAX_NOTE, checkMessage: `ประเภทคำขอ (อื่นๆ) ต้องไม่เกิน ${MAX_NOTE} ตัวอักษร`,
      },
      { name: "repair_target", step: 1, required: true, message: "กรุณาเลือกประเภทงานซ่อม" },
      {
        name: "repair_target_note", step: 1, message: "กรุณาระบุประเภทงานซ่อม (เมื่อเลือก \"อื่นๆ\")",
        get required() { return repairTarget() === "other"; },
        check: (value) => charCount(value) <= MAX_NOTE, checkMessage: `ประเภทงานซ่อม (อื่นๆ) ต้องไม่เกิน ${MAX_NOTE} ตัวอักษร`,
      },
      { name: "symptom", step: 2, required: true, message: "กรุณาระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น", check: (value) => charCount(value) <= MAX_SYMPTOM, checkMessage: `อาการเสียต้องไม่เกิน ${MAX_SYMPTOM.toLocaleString("en-US")} ตัวอักษร` },
    ];
  }
  const textOf = (value) => String(value ?? "").trim();
  // พารามิเตอร์ของ app_itrp_create (ตัดช่องว่าง ไม่ส่งข้อความระบุเมื่อไม่ได้เลือก "อื่นๆ") · เลขที่เอกสาร ผู้แจ้ง แผนก วันเวลา ฐานข้อมูลเติมเอง
  function createParams(values) {
    return {
      p_asset_code: textOf(values.asset_code) || null,
      p_device_name: textOf(values.device_name),
      p_request_kind: textOf(values.request_kind),
      p_request_kind_note: values.request_kind === "other" ? textOf(values.request_kind_note) : null,
      p_repair_target: textOf(values.repair_target),
      p_repair_target_note: values.repair_target === "other" ? textOf(values.repair_target_note) : null,
      p_symptom: textOf(values.symptom),
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

  /* ---------- ฟอร์มถามผู้แจ้ง / ตอบคำถาม ---------- */
  // ข้อความบังคับ ≤ 2,000 ตัวอักษร (ฐานข้อมูลตรวจซ้ำ) · ไฟล์ไม่บังคับ ตรวจที่ validateFiles
  const infoRules = (kind) => [{
    name: "body", required: true,
    message: kind === "answer" ? "กรุณาพิมพ์คำตอบ" : "กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง",
    check: (value) => charCount(value) <= MAX_INFO_BODY, checkMessage: `ข้อความต้องไม่เกิน ${MAX_INFO_BODY.toLocaleString("en-US")} ตัวอักษร`,
  }];
  // พารามิเตอร์ของ app_itrp_request_info / app_itrp_provide_info
  const infoParams = (requestId, values) => ({ p_request_id: requestId, p_body: String(values.body ?? "").trim() });

  /* ---------- ฟอร์มส่งงาน: ส่วน "สำหรับแผนก IT" + ตารางอะไหล่ ---------- */
  const EMPTY_COMPLETE_FORM = Object.freeze({ cause: "", cause_kind: "", cause_kind_note: "", repair_method: "", repair_vendor: "", repair_action: "", pr_po_no: "" });
  const EMPTY_PART_ROW = Object.freeze({ item_name: "", quantity: "", price: "", note: "" });
  // ตัวเลขอะไหล่: เลขจำนวนเต็ม/ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่เกิน 8 หลักก่อนจุด (ตรงกับ app_itrp_complete) · รับจุลภาคคั่นหลักพัน (ตัดออกก่อนส่ง)
  const DECIMAL = /^[0-9]{1,8}(\.[0-9]{1,2})?$/;
  const plainNumber = (value) => String(value ?? "").trim().replaceAll(",", "");
  // ตรวจและเตรียมแถวอะไหล่ที่กรอก: rows = [{ item_name, quantity, price, note }] (ข้อความจากช่องกรอก)
  // แถวที่ว่างทุกช่องข้าม (ไม่ผิด) · ผิด = ข้อความไทย "แถวที่ N: …" ตามลำดับแถวที่เห็นบนจอ (ตรงกับของฐานข้อมูล เพราะส่งทุกแถวตามลำดับ)
  // คืน { rows: แถวที่ส่งให้ฐานข้อมูล (ครบทุกแถว แถวว่างคงไว้ให้เลขแถวตรงกัน), errors: [ข้อความ], filled: จำนวนแถวที่มีข้อมูล,
  //       invalid: [{ row: ลำดับแถวเริ่มที่ 0, field: item_name|quantity|price|note }] = ตำแหน่งช่องที่ผิดจริง (ให้หน้าเว็บทำกรอบแดงถูกช่อง ไม่ใช่ช่องแรกของตาราง) }
  // ข้อผิด "เกิน MAX_PARTS แถว" อยู่ใน errors อย่างเดียว ไม่ผูกช่องใด
  function normalizeParts(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const errors = [];
    const invalid = [];
    let filled = 0;
    if (list.length > MAX_PARTS) errors.push(`รายการอะไหล่/วัสดุที่ใช้ต้องไม่เกิน ${MAX_PARTS} แถว`);
    const sent = list.map((row, index) => {
      const item = textOf(row?.item_name);
      const quantity = plainNumber(row?.quantity);
      const price = plainNumber(row?.price);
      const note = textOf(row?.note);
      if (!item && !quantity && !price && !note) return { item_name: "", quantity: "", price: null, note: "" };
      filled += 1;
      const at = `แถวที่ ${index + 1}`;
      const fail = (field, message) => { errors.push(message); invalid.push({ row: index, field }); };
      if (!item) fail("item_name", `${at}: กรุณาระบุรายการอะไหล่/วัสดุ`);
      else if (charCount(item) > MAX_NOTE) fail("item_name", `${at}: ชื่อรายการต้องไม่เกิน ${MAX_NOTE} ตัวอักษร`);
      if (!quantity) fail("quantity", `${at}: กรุณาระบุจำนวน`);
      else if (!DECIMAL.test(quantity) || Number(quantity) <= 0) fail("quantity", `${at}: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)`);
      if (price && !DECIMAL.test(price)) fail("price", `${at}: ราคาต่อหน่วยต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)`);
      if (note && charCount(note) > MAX_NOTE) fail("note", `${at}: หมายเหตุต้องไม่เกิน ${MAX_NOTE} ตัวอักษร`);
      return { item_name: item, quantity, price: price || null, note };
    });
    return { rows: sent, errors, filled, invalid };
  }
  /* ---------- ฟอร์มส่งงาน: เครื่อง / อุปกรณ์ที่ซ่อม (ประวัติการซ่อมเครื่อง FM02) ---------- */
  // แถวละ 1 เครื่อง: รหัสเครื่อง (ตัวพิมพ์ใหญ่ ไม่บังคับว่าต้องมีในทะเบียน) · ข้อเสนอแนะ (ไม่บังคับ) · อาการ/การแก้ไขเฉพาะเครื่อง (ไม่บังคับ ว่าง = ใช้ของใบ)
  // ต้องมีอย่างน้อย 1 เครื่อง หรือติ๊ก "งานนี้ไม่มีรหัสเครื่อง" (ส่ง p_devices = [])
  const EMPTY_DEVICE_ROW = Object.freeze({ device_code: "", remark: "", symptom_note: "", action_note: "" });
  const NO_DEVICE_LABEL = "งานนี้ไม่มีรหัสเครื่อง (เช่น งานเครือข่าย)";
  const NO_DEVICE_ERROR = `กรุณาระบุรหัสเครื่องอย่างน้อย 1 เครื่อง หรือติ๊ก "${NO_DEVICE_LABEL}"`;
  // รหัสเครื่อง = ตัดช่องว่างหัวท้าย + ตัวพิมพ์ใหญ่ (ฐานข้อมูลทำเหมือนกัน จึงส่งตัวเล็กได้)
  const normalizeDeviceCode = (value) => textOf(value).toUpperCase();
  // ข้อความผิดของรหัสที่ผ่าน normalizeDeviceCode แล้ว (ตรงกับ private.itrp_code_error) · ผ่าน = null
  function deviceCodeError(code) {
    if (!code) return "กรุณาระบุรหัสเครื่อง";
    if (charCount(code) > MAX_DEVICE_CODE) return `รหัสเครื่องต้องไม่เกิน ${MAX_DEVICE_CODE} ตัวอักษร`;
    if (/[\u0000-\u001f\u007f-\u009f]/.test(code)) return "รหัสเครื่องมีอักขระที่ใช้ไม่ได้";
    return null;
  }
  // แถวแรกของฟอร์มส่งงานเติมรหัสที่ผู้แจ้งกรอกไว้ให้ก่อน (แก้ได้) · ไม่มีรหัส = แถวว่าง 1 แถว
  const initialDeviceRows = (assetCode) => [{ ...EMPTY_DEVICE_ROW, device_code: normalizeDeviceCode(assetCode) }];
  // ตรวจและเตรียมแถวเครื่องที่กรอก: rows = [{ device_code, remark, symptom_note, action_note }] (ข้อความจากช่องกรอก) · noDevice = ติ๊ก "งานนี้ไม่มีรหัสเครื่อง"
  // คืน { rows: แถวที่ส่งให้ฐานข้อมูล ([] เมื่อ noDevice) แถวว่างคงไว้ให้เลขแถวตรงกับจอ, errors: [ข้อความ], filled: จำนวนแถวที่มีข้อมูล,
  //       invalid: [{ row: ลำดับแถวเริ่มที่ 0, field: device_code|remark|symptom_note|action_note }] = ช่องที่ผิดจริง (ให้หน้าเว็บทำกรอบแดงถูกช่อง) }
  // ข้อผิดที่ไม่ผูกช่อง ("เกิน MAX_DEVICES แถว") อยู่ใน errors อย่างเดียว · ไม่มีเครื่องเลยและไม่ติ๊ก = ผูกกับรหัสเครื่องของแถวแรก
  function normalizeDevices(rows, { noDevice = false } = {}) {
    if (noDevice) return { rows: [], errors: [], filled: 0, invalid: [] };
    const list = Array.isArray(rows) ? rows : [];
    const errors = [];
    const invalid = [];
    const seen = new Set();
    let filled = 0;
    if (list.length > MAX_DEVICES) errors.push(`เครื่อง/อุปกรณ์ที่ซ่อมต้องไม่เกิน ${MAX_DEVICES} รายการ`);
    const sent = list.map((row, index) => {
      const code = normalizeDeviceCode(row?.device_code);
      const symptom = textOf(row?.symptom_note);
      const action = textOf(row?.action_note);
      const remark = textOf(row?.remark);
      if (!code && !symptom && !action && !remark) return { device_code: "", symptom_note: null, action_note: null, remark: null };
      filled += 1;
      const at = `แถวที่ ${index + 1}`;
      const fail = (field, message) => { errors.push(message); invalid.push({ row: index, field }); };
      const codeProblem = deviceCodeError(code);
      if (codeProblem) fail("device_code", `${at}: ${codeProblem}`);
      else if (seen.has(code)) fail("device_code", `${at}: รหัสเครื่อง ${code} ซ้ำกับแถวก่อนหน้า (ใส่รหัสเดียวกันสองครั้งในการส่งงานเดียวกันไม่ได้)`);
      else seen.add(code);
      if (charCount(symptom) > MAX_LONG_TEXT) fail("symptom_note", `${at}: อาการของเครื่องต้องไม่เกิน ${MAX_LONG_TEXT.toLocaleString("en-US")} ตัวอักษร`);
      if (charCount(action) > MAX_LONG_TEXT) fail("action_note", `${at}: การแก้ไขของเครื่องต้องไม่เกิน ${MAX_LONG_TEXT.toLocaleString("en-US")} ตัวอักษร`);
      if (charCount(remark) > MAX_REMARK) fail("remark", `${at}: ข้อเสนอแนะต้องไม่เกิน ${MAX_REMARK} ตัวอักษร`);
      return { device_code: code, symptom_note: symptom || null, action_note: action || null, remark: remark || null };
    });
    if (!filled && !errors.length) { errors.push(NO_DEVICE_ERROR); invalid.push({ row: 0, field: "device_code" }); }
    return { rows: sent, errors, filled, invalid };
  }
  // รายการรหัสเครื่องให้เลือกใน datalist: "<รหัส> · <ผู้ใช้> · <แผนก>" (เครื่องที่ยกเลิกการใช้งานแล้วบอกไว้) · devices = ผลของ app_itrp_list_devices
  const deviceOptionText = (device) => [device?.code, device?.user_name, device?.division, device?.status === "retired" ? "(ยกเลิกการใช้งานแล้ว)" : ""].filter(Boolean).join(" · ");

  // กติกาของช่องส่วน "สำหรับแผนก IT" (ข้อความผิดพลาดตรงกับ app_itrp_complete) · ลำดับตามบนจอ
  function completeRules({ causeKind = () => "", repairMethod = () => "" } = {}) {
    return [
      { name: "cause", required: true, message: "กรุณาระบุสาเหตุ", check: (value) => charCount(value) <= MAX_LONG_TEXT, checkMessage: `สาเหตุต้องไม่เกิน ${MAX_LONG_TEXT.toLocaleString("en-US")} ตัวอักษร` },
      { name: "cause_kind", required: true, message: "กรุณาเลือกสรุปสาเหตุเกิดจาก" },
      {
        name: "cause_kind_note", message: "กรุณาระบุสรุปสาเหตุ (เมื่อเลือก \"อื่นๆ\")",
        get required() { return causeKind() === "other"; },
        check: (value) => charCount(value) <= MAX_NOTE, checkMessage: `สรุปสาเหตุ (อื่นๆ) ต้องไม่เกิน ${MAX_NOTE} ตัวอักษร`,
      },
      { name: "repair_method", required: true, message: "กรุณาเลือกการตรวจซ่อม" },
      {
        name: "repair_vendor", message: "กรุณาระบุสถานที่ที่ส่งซ่อม",
        get required() { return repairMethod() === "sent_out"; },
        check: (value) => charCount(value) <= MAX_NOTE, checkMessage: `ชื่อผู้ซ่อม/สถานที่ส่งซ่อมต้องไม่เกิน ${MAX_NOTE} ตัวอักษร`,
      },
      { name: "repair_action", required: true, message: "กรุณาระบุการซ่อม-แก้ไขที่เกิดขึ้น", check: (value) => charCount(value) <= MAX_LONG_TEXT, checkMessage: `การซ่อม-แก้ไขที่เกิดขึ้นต้องไม่เกิน ${MAX_LONG_TEXT.toLocaleString("en-US")} ตัวอักษร` },
      { name: "pr_po_no", check: (value) => charCount(value) <= MAX_PR_PO, checkMessage: `เลขที่ PR./PO. ต้องไม่เกิน ${MAX_PR_PO} ตัวอักษร` },
    ];
  }
  // ช่องชื่อผู้ซ่อม/สถานที่ส่งซ่อมตามการตรวจซ่อมที่เลือก: ซ่อมภายในไม่มีช่อง · เรียกผู้ซ่อมภายนอกไม่บังคับ · ส่งซ่อมที่บังคับระบุสถานที่ (ตรงกับ app_itrp_complete)
  function vendorField(method) {
    if (method === "sent_out") return { visible: true, required: true, label: "สถานที่ส่งซ่อม" };
    if (method === "external_onsite") return { visible: true, required: false, label: "ชื่อผู้ซ่อม (ไม่บังคับ)" };
    return { visible: false, required: false, label: "" };
  }
  // พารามิเตอร์ของ app_itrp_complete · parts = ผลของ normalizeParts(...).rows · devices = ผลของ normalizeDevices(...).rows ([] = ไม่มีรหัสเครื่อง)
  // ข้อความระบุที่ไม่เกี่ยวกับตัวเลือกที่เลือกไม่ส่ง (ซ่อมภายในไม่มีผู้ซ่อมภายนอก)
  function completeParams(requestId, values, parts, devices) {
    return {
      p_request_id: requestId,
      p_cause: textOf(values.cause),
      p_cause_kind: textOf(values.cause_kind),
      p_cause_kind_note: values.cause_kind === "other" ? textOf(values.cause_kind_note) : null,
      p_repair_method: textOf(values.repair_method),
      p_repair_vendor: values.repair_method === "internal" ? null : (textOf(values.repair_vendor) || null),
      p_repair_action: textOf(values.repair_action),
      p_pr_po_no: textOf(values.pr_po_no) || null,
      p_parts: Array.isArray(parts) ? parts : [],
      p_devices: Array.isArray(devices) ? devices : [],
    };
  }
  // บันทึกการซ่อมชุดล่าสุดสำหรับแสดงและพิมพ์ + ประวัติชุดก่อนหน้า (เก่า → ใหม่ · ชุดล่าสุดอยู่ท้าย) · ยังไม่เคยส่งงาน = report null
  function repairReports(detail) {
    const all = Array.isArray(detail?.repair_reports) ? detail.repair_reports : [];
    const latest = detail?.repair_report ?? all[all.length - 1] ?? null;
    return { latest, earlier: latest ? all.filter((report) => report.id !== latest.id) : all };
  }
  // ผลการซ่อมบนใบ (อ่านอย่างเดียว): แปลงค่าเลือกเป็นข้อความไทย
  function reportView(report) {
    if (!report) return null;
    return {
      id: report.id,
      completedAt: report.completed_at,
      completedBy: report.completed_by_full_name,
      cause: report.cause,
      causeKind: causeKindText(report.cause_kind, report.cause_kind_note),
      repairMethod: repairMethodText(report.repair_method, report.repair_vendor),
      repairAction: report.repair_action,
      prPoNo: report.pr_po_no ?? "",
      // เครื่อง/อุปกรณ์ที่ซ่อมในรอบนี้ (ไม่มีคีย์ devices = ฐานข้อมูลยังไม่ได้อัปเดต หรือไม่มีรหัสเครื่อง → ว่าง ไม่พัง)
      devices: (Array.isArray(report.devices) ? report.devices : []).slice().sort((a, b) => Number(a.seq) - Number(b.seq)).map((device) => ({
        seq: device.seq, code: device.device_code, symptom: device.symptom_note ?? "", action: device.action_note ?? "", remark: device.remark ?? "",
      })),
      parts: (Array.isArray(report.parts) ? report.parts : []).slice().sort((a, b) => Number(a.line_no) - Number(b.line_no)).map((part) => ({
        no: part.line_no, item: part.item_name, quantity: formatQuantity(part.quantity), price: formatPrice(part.price), note: part.note ?? "",
      })),
    };
  }

  /* ---------- ไฟล์แนบ ---------- */
  // ชนิดไฟล์ที่ฐานข้อมูล/Storage รับ (ตรงกับ private.itrp_allowed_mime_types และ private.itrp_file_path_order_id ใน migration 20261212010000)
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
  const fileBucket = (isTest) => (isTest ? "itrp-test-files" : "itrp-files");
  // path ที่ฐานข้อมูลบังคับ: <id ใบ>/<uuid พิมพ์เล็ก>.<นามสกุลพิมพ์เล็ก> (ชื่อเดิมของไฟล์เก็บในตาราง ไม่อยู่ใน path)
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
  // nextPath() ออก path ใหม่ให้ไฟล์เดิม ใช้เมื่อไฟล์ที่ขึ้น Storage ไปแล้วถูกฐานข้อมูลปฏิเสธเพราะตัวไฟล์ (ดู isFileRejection)
  const makeUploadEntries = (requestId, files, uuid) => Array.from(files ?? []).map((file) => ({
    file, path: filePath(requestId, uuid(), file), nextPath: () => filePath(requestId, uuid(), file), uploaded: false, registered: false, error: null,
  }));
  // Storage ตอบว่าไฟล์ path นี้มีอยู่แล้ว (ครั้งก่อนอัปโหลดสำเร็จแต่คำตอบไม่กลับมา) = ถือว่าอัปโหลดแล้ว ฐานข้อมูลจะตรวจว่าไฟล์อยู่จริงและเป็นของผู้เรียกตอนลงทะเบียน
  const isAlreadyUploaded = (error) => String(error?.statusCode ?? error?.status ?? "") === "409" || /already exists|duplicate/i.test(String(error?.message ?? ""));
  // ฐานข้อมูลปฏิเสธการลงทะเบียนเพราะ "ตัวไฟล์ที่อยู่ใน Storage" (ไม่พบไฟล์ / ตรวจชนิดหรือขนาดไม่ได้ / นามสกุลไม่ตรงชนิด / ชนิดไม่รองรับ / ใหญ่เกิน)
  // ลงทะเบียน path เดิมซ้ำไม่มีวันผ่าน (Storage เขียนทับไม่ได้) → ครั้งถัดไปต้องอัปโหลดใหม่ด้วย path ใหม่ · ข้อความเหล่านี้มาจาก app_itrp_add_attachment (ไทย)
  const isFileRejection = (error) => /กรุณาอัปโหลดไฟล์ใหม่|^ชนิดไฟล์นี้ไม่รองรับ|^ไฟล์ต้องมีขนาดไม่เกิน/.test(String(error?.message ?? ""));
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
        // ไฟล์ถูกปฏิเสธที่ตัวไฟล์: ลองใหม่ = อัปโหลดอีกครั้งด้วย path ใหม่ (ไม่วนลงทะเบียน path เดิม) · ไฟล์เก่าค้างใน Storage โดยไม่มีทะเบียน
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
  // ผู้แจ้งกด "แก้ไขงาน" ตอน IT ส่งงานแล้ว: รายละเอียดที่ต้องแก้ (บังคับ) + วันที่กำหนดแก้เสร็จ (บังคับ ไม่ย้อนหลังตามเวลาไทย) + ไฟล์ (ไม่บังคับ)
  const EMPTY_REWORK_FORM = Object.freeze({ details: "", due_date: "" });
  function reworkRules({ today = () => todayBangkok() } = {}) {
    return [
      { name: "details", required: true, message: "กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข", check: (value) => charCount(value) <= MAX_LONG_TEXT, checkMessage: `รายละเอียดต้องไม่เกิน ${MAX_LONG_TEXT.toLocaleString("en-US")} ตัวอักษร` },
      {
        name: "due_date", required: true, message: "กรุณาเลือกวันที่ต้องการให้แก้ไขเสร็จ",
        check: (value) => isRealDate(value) && value >= today(), checkMessage: "วันที่ต้องการให้แก้ไขเสร็จต้องเป็นวันนี้หรือหลังจากนี้",
      },
    ];
  }
  // พารามิเตอร์ของ app_itrp_request_rework
  const reworkParams = (requestId, values) => ({ p_request_id: requestId, p_details: String(values.details ?? "").trim(), p_due_date: String(values.due_date ?? "").trim() });

  /* ---------- ตั้งค่า (it_admin) ---------- */
  // เลขที่เอกสารตัวอย่างสำหรับให้เห็นก่อนกดบันทึก (รูปแบบเดียวกับ private.itrp_format_doc_no) · ฐานข้อมูลออกเลขจริงเองเสมอ
  function formatDocNo(isTest, year, seq) {
    const seqText = seq < 1000 ? String(seq).padStart(3, "0") : String(seq);
    return `${isTest ? "TEST-" : ""}IT01-${pad(year % 100)}/${seqText}`;
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
  // รายชื่อทีม IT อ่านจากตาราง itwo_staff ชุดเดียวกับใบสั่งงาน IT (อ่านอย่างเดียว แก้ที่ใบสั่งงาน IT)
  const staffRoleText = (row) => [row?.is_it_admin ? "ผู้ดูแลงาน IT" : "", row?.is_it_approver ? "ผู้อนุมัติขั้น IT" : ""].filter(Boolean).join(" · ");

  /* ---------- ประวัติการซ่อมเครื่อง (IT01-FM02) + ทะเบียนเครื่อง ---------- */
  // แท็บ "ประวัติการซ่อม": เลือกรหัสเครื่อง → ตาราง 7 คอลัมน์ตามฟอร์ม FM02 (เลขที่ใบแจ้งซ่อม วันที่ อาการเสีย การแก้ไข ซ่อมเสร็จ ข้อเสนอแนะ ผู้แจ้ง) → พิมพ์ A4
  // ข้อมูลมาจาก app_itrp_device_history / app_itrp_list_devices (สัญญาที่ docs/itrp-contract.md) · วันที่ในฐานข้อมูลเป็น ค.ศ. YYYY-MM-DD แสดงด้วย formatDate (พ.ศ.)
  const DEVICE_KINDS = Object.freeze([
    { value: "computer", label: "คอมพิวเตอร์ตั้งโต๊ะ" },
    { value: "laptop", label: "โน้ตบุ๊ก" },
    { value: "monitor", label: "จอภาพ" },
    { value: "printer", label: "เครื่องพิมพ์" },
    { value: "ups", label: "UPS" },
    { value: "other", label: "อื่นๆ" },
  ]);
  const DEVICE_STATUSES = Object.freeze([{ value: "active", label: "ใช้งาน" }, { value: "retired", label: "ยกเลิกการใช้งาน" }]);
  const deviceKindLabel = (value) => labelOf(DEVICE_KINDS, value);
  const deviceStatusLabel = (value) => labelOf(DEVICE_STATUSES, value);
  // ที่มาของแถวประวัติ: request = ใบในระบบ (เปิดใบได้ แก้ที่นี่ไม่ได้) · import = นำเข้าจาก Excel · manual = IT ลงย้อนหลัง (สองอย่างหลังแก้/ยกเลิกรายการได้ โดยมีรอยแก้)
  const HISTORY_SOURCE_LABELS = Object.freeze({ request: "ใบในระบบ", import: "นำเข้าจาก Excel", manual: "ลงย้อนหลัง" });
  const historySourceLabel = (source) => HISTORY_SOURCE_LABELS[source] ?? source ?? "";
  const historyUrl = (code) => repairUrl("history", { code });
  const historyPrintUrl = (code) => repairUrl("history-print", { code });
  const MIN_HISTORY_DATE = "1990-01-01"; // ตรงกับ app_itrp_history_add
  const MAX_HISTORY_TEXT = 2000;
  const MAX_DOC_NO = 50;
  const MAX_REPORTER = 200;
  const MAX_DEVICE_TEXT = 200; // ผู้ใช้ / แผนก / CPU / รุ่น ในทะเบียนเครื่อง
  const MAX_ASSET_NO = 100;
  const MAX_DEVICE_NOTE = 1000;
  const dateOrDash = (value) => (value ? formatDate(value) : "-");

  /* ----- ช่องวันที่แบบพิมพ์เอง (แท็บประวัติ: วันที่ย้อนหลังหลายปี เลื่อนปฏิทินทีละเดือนไม่ไหว) ----- */
  // รับ วว/ดด/ปปปป ทั้ง พ.ศ. และ ค.ศ. (ปี ≥ 2400 ถือเป็น พ.ศ.) · คั่นด้วย / - . หรือช่องว่าง · เลขไทยได้ · พิมพ์ติด 8 หลัก (05032566) ได้ · YYYY-MM-DD ก็รับ (ค่าเดิมในฟอร์มแก้ไข)
  // คืน YYYY-MM-DD (ค.ศ.) เมื่อเป็นวันที่จริง ไม่งั้นคืน null (เช่น 31/04, 29/02 ของปีที่ไม่ใช่อธิกสุรทิน, ปีไม่ครบ 4 หลัก)
  const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
  const DATE_INPUT_HINT = "พิมพ์เป็น วว/ดด/ปปปป เช่น 05/03/2566 (พ.ศ.) หรือ 05/03/2023 (ค.ศ.)";
  function parseDateInput(text) {
    const raw = String(text ?? "").replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit))).trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
    let year; let month; let day;
    if (match) [year, month, day] = match.slice(1).map(Number);
    else if ((match = /^(\d{1,2})[\s/.-]+(\d{1,2})[\s/.-]+(\d{4})$/.exec(raw)) || (match = /^(\d{2})(\d{2})(\d{4})$/.exec(raw))) [day, month, year] = match.slice(1).map(Number);
    else return null;
    if (year >= 2400) year -= YEAR_OFFSET; // พ.ศ. → ค.ศ.
    if (year < 1000) return null;
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    return isRealDate(iso) ? iso : null;
  }
  // ค่าที่อ่านจากช่องพิมพ์เอง: วันที่จริง = ISO · พิมพ์ไม่ถูก = ส่งข้อความเดิมต่อไปให้กติกา (isRealDate) ปฏิเสธพร้อมข้อความ · ว่าง = ""
  const normalizeDateField = (text) => parseDateInput(text) ?? String(text ?? "").trim();
  // ค่าตั้งต้นของช่องพิมพ์เอง: ISO → วว/ดด/ปปปป (พ.ศ.) · ค่าอื่นแสดงตามที่มี
  const dateInputText = (value) => (isRealDate(value) ? formatDate(value) : String(value ?? ""));

  // ค้นรายการเครื่องฝั่งหน้าเว็บ (รายการโหลดมาครบครั้งเดียว ≤ 2,000 แถว): คำค้นหลายคำคั่นด้วยช่องว่าง ทุกคำต้องเจอใน รหัส/ผู้ใช้/แผนก/เลขทะเบียนทรัพย์สิน/Processor/รุ่น (ไม่สนตัวพิมพ์)
  function filterDevices(devices, query) {
    const terms = textOf(query).toLowerCase().split(/\s+/).filter(Boolean);
    const list = Array.isArray(devices) ? devices : [];
    if (!terms.length) return list;
    return list.filter((device) => {
      const haystack = [device.code, device.user_name, device.division, device.asset_no, device.cpu_name, device.cpu_model].map((part) => String(part ?? "").toLowerCase()).join("\n");
      return terms.every((term) => haystack.includes(term));
    });
  }
  // หัวใบ FM02 จาก app_itrp_device_history().device (null = รหัสนี้ยังไม่อยู่ในทะเบียน ช่องที่เหลือเป็น "-")
  function deviceHeader(data) {
    const device = data?.device ?? null;
    return {
      code: data?.code ?? "",
      inRegistry: Boolean(device),
      startedOn: dateOrDash(device?.started_on),
      user: textOf(device?.user_name) || "-",
      section: textOf(device?.division) || "-",
      processor: [device?.cpu_name, device?.cpu_model].map(textOf).filter(Boolean).join(" ") || "-",
      assetNo: textOf(device?.asset_no) || "-",
    };
  }
  // แถวของตาราง FM02 (เรียงตามที่ RPC คืนมา) · เลขที่ใบ/วันที่ซ่อมเสร็จว่าง = "-" · ใบในระบบที่ผู้แจ้งยังไม่ยืนยันรับงานมีสถานะกำกับ
  function historyRowsView(rows) {
    return (Array.isArray(rows) ? rows : []).map((row, index) => ({
      key: row.entry_id ? `e${row.entry_id}` : `r${row.request_id ?? index}`,
      source: row.source,
      sourceLabel: historySourceLabel(row.source),
      requestId: row.request_id ?? null,
      entryId: row.entry_id ?? null,
      requestStatus: row.source === "request" && row.request_status && row.request_status !== "received" ? statusLabel(row.request_status) : "",
      docNo: textOf(row.doc_no) || "-",
      reportedOn: dateOrDash(row.reported_on),
      symptom: textOf(row.symptom),
      action: textOf(row.action),
      finishedOn: dateOrDash(row.finished_on),
      remark: textOf(row.remark),
      reporter: textOf(row.reporter_name),
      revisionCount: Number(row.revision_count) || 0,
      editable: row.source === "import" || row.source === "manual",
    }));
  }

  /* ----- ฟอร์มลงประวัติย้อนหลัง / แก้ไขรายการ (it_admin) ----- */
  const EMPTY_HISTORY_FORM = Object.freeze({ doc_no: "", device_code: "", reported_on: "", symptom: "", action: "", finished_on: "", remark: "", reporter_name: "" });
  // ลำดับตามบนจอ · ข้อความผิดพลาดตรงกับ app_itrp_history_add/_update · symptom ต้องมีอย่างน้อยหนึ่งอย่างระหว่างอาการกับการแก้ไข (action = ตัวอ่านค่าช่องการแก้ไขตอนตรวจ)
  function historyRules({ today = () => todayBangkok(), action = () => "" } = {}) {
    return [
      { name: "doc_no", check: (value) => charCount(value) <= MAX_DOC_NO, checkMessage: `เลขที่ใบแจ้งซ่อมต้องไม่เกิน ${MAX_DOC_NO} ตัวอักษร` },
      { name: "device_code", required: true, message: "กรุณาระบุรหัสเครื่อง", check: (value) => charCount(value) <= MAX_DEVICE_CODE, checkMessage: `รหัสเครื่องต้องไม่เกิน ${MAX_DEVICE_CODE} ตัวอักษร` },
      { name: "reported_on", required: true, message: "กรุณาระบุวันที่แจ้งซ่อม", check: (value) => isRealDate(value) && value >= MIN_HISTORY_DATE && value <= today(), checkMessage: "วันที่แจ้งซ่อมไม่ถูกต้อง (พิมพ์เป็น วว/ดด/ปปปป และต้องไม่เป็นวันในอนาคต)" },
      {
        name: "symptom", message: "กรุณาระบุอาการเสียหรือการแก้ไขอย่างน้อยหนึ่งอย่าง",
        get required() { return !textOf(action()); },
        check: (value) => charCount(value) <= MAX_HISTORY_TEXT, checkMessage: `อาการเสียต้องไม่เกิน ${MAX_HISTORY_TEXT.toLocaleString("en-US")} ตัวอักษร`,
      },
      { name: "action", check: (value) => charCount(value) <= MAX_HISTORY_TEXT, checkMessage: `การแก้ไขต้องไม่เกิน ${MAX_HISTORY_TEXT.toLocaleString("en-US")} ตัวอักษร` },
      {
        name: "finished_on", message: "วันที่ซ่อมเสร็จไม่ถูกต้อง",
        check: (value, values) => isRealDate(value) && value <= today() && (!isRealDate(values?.reported_on) || value >= values.reported_on),
        checkMessage: "วันที่ซ่อมเสร็จไม่ถูกต้อง (พิมพ์เป็น วว/ดด/ปปปป ต้องไม่ก่อนวันที่แจ้งและไม่เป็นวันในอนาคต)",
      },
      { name: "remark", check: (value) => charCount(value) <= MAX_REMARK, checkMessage: `ข้อเสนอแนะต้องไม่เกิน ${MAX_REMARK} ตัวอักษร` },
      { name: "reporter_name", check: (value) => charCount(value) <= MAX_REPORTER, checkMessage: `ชื่อผู้แจ้งต้องไม่เกิน ${MAX_REPORTER} ตัวอักษร` },
    ];
  }
  const nullable = (value) => textOf(value) || null;
  // พารามิเตอร์ของ app_itrp_history_add (ส่งครบทั้ง 8 ช่อง ช่องว่าง = null) · _update เพิ่ม p_entry_id และใช้ค่าชุดเดียวกัน (null = ล้างช่อง)
  const historyParams = (values) => ({
    p_device_code: normalizeDeviceCode(values.device_code), p_doc_no: nullable(values.doc_no), p_reported_on: textOf(values.reported_on) || null, p_symptom: nullable(values.symptom),
    p_action: nullable(values.action), p_finished_on: nullable(values.finished_on), p_remark: nullable(values.remark), p_reporter_name: nullable(values.reporter_name),
  });
  const historyUpdateParams = (entryId, values) => ({ p_entry_id: entryId, ...historyParams(values) });
  // ค่าตั้งต้นของฟอร์มแก้ไขจากแถวของตาราง (วันที่ ISO ใส่ช่องวันที่ได้ตรง ๆ · เลขที่ใบ "-" ที่ฐานข้อมูลเก็บเป็นว่างอยู่แล้ว)
  const historyFormValues = (row, code) => ({
    doc_no: textOf(row?.doc_no), device_code: code ?? "", reported_on: row?.reported_on ?? "", symptom: row?.symptom ?? "", action: row?.action ?? "",
    finished_on: row?.finished_on ?? "", remark: row?.remark ?? "", reporter_name: row?.reporter_name ?? "",
  });
  // รอยแก้ของรายการ (app_itrp_history_get): ฉบับก่อนแก้แต่ละครั้ง เรียงเก่า → ใหม่ · ฟิลด์ที่แสดงตามลำดับของตาราง FM02
  const HISTORY_FIELDS = Object.freeze([
    ["doc_no", "เลขที่ใบแจ้งซ่อม"], ["device_code", "รหัสเครื่อง"], ["reported_on", "วันที่แจ้ง"], ["symptom", "อาการเสีย"], ["action", "การแก้ไข"],
    ["finished_on", "ซ่อมเสร็จ"], ["remark", "ข้อเสนอแนะ"], ["reporter_name", "ผู้แจ้ง"],
  ]);
  const REVISION_KIND_LABELS = Object.freeze({ update: "แก้ไข", void: "ยกเลิกรายการ" });
  function revisionsView(data) {
    return (Array.isArray(data?.revisions) ? data.revisions : []).map((revision) => ({
      no: revision.revision_no,
      kindLabel: REVISION_KIND_LABELS[revision.change_kind] ?? revision.change_kind ?? "",
      by: revision.changed_by_full_name,
      at: formatDateTime(revision.created_at),
      reason: revision.reason ?? "",
      // ฉบับเดิมก่อนการแก้ครั้งนั้น: ช่องวันที่แสดงเป็น วว/ดด/ปปปป ช่องว่าง = "-"
      fields: HISTORY_FIELDS.map(([key, label]) => ({ label, value: key === "reported_on" || key === "finished_on" ? dateOrDash(revision.snapshot?.[key]) : (textOf(revision.snapshot?.[key]) || "-") })),
    }));
  }

  /* ----- ฟอร์มทะเบียนเครื่อง (it_admin) ----- */
  // app_itrp_save_device ต้องส่ง "ทุกช่อง" เสมอ: ช่องที่ส่ง null = ล้างค่า, status ไม่ส่ง = กลับเป็นใช้งาน → ฟอร์มแก้ต้องโหลดค่าเดิมมาเต็มก่อน (deviceFormValues)
  const EMPTY_DEVICE_FORM = Object.freeze({ code: "", kind: "computer", user_name: "", division: "", cpu_name: "", cpu_model: "", started_on: "", asset_no: "", status: "active", note: "" });
  const deviceFormValues = (device) => ({
    code: device?.code ?? "", kind: device?.kind || "other", user_name: device?.user_name ?? "", division: device?.division ?? "", cpu_name: device?.cpu_name ?? "", cpu_model: device?.cpu_model ?? "",
    started_on: device?.started_on ?? "", asset_no: device?.asset_no ?? "", status: device?.status || "active", note: device?.note ?? "",
  });
  // isNew = เพิ่มเครื่องใหม่ (กรอกรหัสได้) · แก้เครื่องเดิม = รหัสแก้ไม่ได้ จึงไม่ตรวจช่องรหัส
  function deviceRules({ isNew = true } = {}) {
    const limit = (name, max, message) => ({ name, check: (value) => charCount(value) <= max, checkMessage: message });
    return [
      ...(isNew ? [{ name: "code", required: true, message: "กรุณาระบุรหัสเครื่อง", check: (value) => charCount(value) <= MAX_DEVICE_CODE, checkMessage: `รหัสเครื่องต้องไม่เกิน ${MAX_DEVICE_CODE} ตัวอักษร` }] : []),
      { name: "kind", required: true, message: "กรุณาเลือกชนิดอุปกรณ์", check: (value) => DEVICE_KINDS.some((kind) => kind.value === value), checkMessage: "ชนิดอุปกรณ์ไม่ถูกต้อง" },
      limit("user_name", MAX_DEVICE_TEXT, `ชื่อผู้ใช้เครื่องต้องไม่เกิน ${MAX_DEVICE_TEXT} ตัวอักษร`),
      limit("division", MAX_DEVICE_TEXT, `ชื่อแผนก/ส่วนงานต้องไม่เกิน ${MAX_DEVICE_TEXT} ตัวอักษร`),
      limit("cpu_name", MAX_DEVICE_TEXT, `ข้อมูล Processor ต้องไม่เกิน ${MAX_DEVICE_TEXT} ตัวอักษร`),
      limit("cpu_model", MAX_DEVICE_TEXT, `ข้อมูลรุ่น Processor ต้องไม่เกิน ${MAX_DEVICE_TEXT} ตัวอักษร`),
      { name: "started_on", message: "วันที่เริ่มใช้ไม่ถูกต้อง (พิมพ์เป็น วว/ดด/ปปปป)", check: (value) => isRealDate(value) && value >= MIN_HISTORY_DATE && value <= "2100-01-01" },
      limit("asset_no", MAX_ASSET_NO, `เลขทะเบียนทรัพย์สินต้องไม่เกิน ${MAX_ASSET_NO} ตัวอักษร`),
      { name: "status", required: true, message: "กรุณาเลือกสถานะ", check: (value) => DEVICE_STATUSES.some((status) => status.value === value), checkMessage: "สถานะเครื่องต้องเป็น ใช้งาน หรือ ยกเลิกการใช้งาน" },
      limit("note", MAX_DEVICE_NOTE, `หมายเหตุต้องไม่เกิน ${MAX_DEVICE_NOTE.toLocaleString("en-US")} ตัวอักษร`),
    ];
  }
  // พารามิเตอร์ของ app_itrp_save_device: ส่งครบทั้ง 10 ช่องเสมอ (ช่องว่าง = null)
  const deviceParams = (values) => ({
    p_code: normalizeDeviceCode(values.code), p_kind: textOf(values.kind) || "other", p_user_name: nullable(values.user_name), p_division: nullable(values.division),
    p_cpu_name: nullable(values.cpu_name), p_cpu_model: nullable(values.cpu_model), p_started_on: nullable(values.started_on), p_asset_no: nullable(values.asset_no),
    p_status: textOf(values.status) || "active", p_note: nullable(values.note),
  });

  /* ---------- error จาก RPC ---------- */
  // kind: "session" เซสชันหมดอายุ · "unknown" ไม่ได้คำตอบจากเซิร์ฟเวอร์ (ผลไม่แน่ชัด) · "missing" ฐานข้อมูลยังไม่มีฟังก์ชัน · "rejected" เซิร์ฟเวอร์ตอบปฏิเสธ
  // ข้อความไทยของฐานข้อมูล (errcode 42501 / 23514) ส่งต่อให้ผู้ใช้ตรงๆ ส่วนข้อความเทคนิคภาษาอังกฤษไม่แสดง
  const THAI = /[฀-๿]/;
  const NETWORK = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|internet connection appears to be offline|failed to send a request|err_internet|err_network|econnreset|the request timed out/i;
  const SESSION_CODES = ["PGRST301", "PGRST303", "AUTH_REQUIRED"];
  const SESSION_MESSAGE = "หมดเวลาการเข้าสู่ระบบ กรุณาโหลดหน้านี้ใหม่แล้วเข้าสู่ระบบอีกครั้ง (สิ่งที่กรอกไว้ยังอยู่ในหน้า)";
  const UNKNOWN_WRITE_MESSAGE = "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ (ระบบอาจบันทึกไปแล้ว)";
  const UNKNOWN_READ_MESSAGE = "โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
  const MISSING_MESSAGE = "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับใบแจ้งซ่อม กรุณาแจ้งผู้ดูแลระบบ";
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
    // อัปโหลดและลงทะเบียนไฟล์ลองซ้ำได้ปลอดภัย (path เดิม คืนทะเบียนเดิม) จึงไม่ต้องให้ "ตรวจก่อนกดซ้ำ"
    return info.kind === "unknown" ? { kind: "unknown", message: "เชื่อมต่อระบบไม่ได้ สัญญาณอาจขาด กดลองอีกครั้งได้เลย" } : info;
  }

  /* ---------- เปลี่ยน / ถอด / ย้ายชิ้นส่วนจากใบแจ้งซ่อม (สัญญา RPC: docs/itrp-contract.md หัวข้อ "เปลี่ยน/ถอด/ย้ายชิ้นส่วนจากใบแจ้งซ่อม") ---------- */
  // IT เลือกรายการจาก context ของฐานข้อมูล (ไม่พิมพ์ข้อความอิสระ) สะสมเป็นรายการ แล้วส่ง app_itrp_apply_part_changes ครั้งเดียวทั้งก้อน
  // ที่นี่ตรวจซ้ำให้ผู้ใช้เห็นข้อความไทยก่อนส่ง (ชิ้นเดียวกันซ้ำ ชนิดไม่ตรง ฯลฯ) · ฐานข้อมูลตรวจซ้ำทุกข้อเสมอและเป็นผู้ตัดสิน
  const MAX_PART_CHANGES = 20; // ตรงกับ max_changes ของ context / p_changes ของ apply
  const MAX_PART_SLOT = 50; // ช่อง/Slot
  const MAX_PART_NOTE = 200; // หมายเหตุของรายการ
  const PART_ACTIONS = Object.freeze({
    replace: { label: "เปลี่ยน", historyLabel: "เปลี่ยนชิ้นส่วน" },
    remove: { label: "ถอดออก", historyLabel: "ถอดออก" },
    move: { label: "ย้ายไปเครื่องอื่น", historyLabel: "ย้ายไปเครื่องอื่น" },
    install: { label: "ติดตั้งชิ้นสำรองเพิ่ม", historyLabel: "ติดตั้งเพิ่ม" },
  });
  // สถานะของชิ้นเดิมหลังถอดออก (ตรงกับ result_statuses ของ context) · ค่าเริ่มต้นของฟอร์ม = ชำรุด (เหตุที่เปลี่ยนมากที่สุด)
  const PART_RESULT_STATUSES = Object.freeze([
    { value: "broken", label: "ชำรุด" },
    { value: "spare", label: "สำรอง" },
    { value: "retired", label: "ยกเลิกใช้งาน" },
  ]);
  const PART_ASSET_STATUS_LABELS = Object.freeze({ in_use: "ใช้งาน", broken: "ชำรุด", spare: "สำรอง", retired: "ยกเลิกใช้งาน" });
  const PART_HOST_SOURCE_LABELS = Object.freeze({ request: "รหัสที่ผู้แจ้งกรอก", report: "เครื่องที่ IT ระบุตอนส่งงาน" });
  const PARTS_MOVABLE_STATUSES = Object.freeze(["in_use", "broken"]); // ชิ้นที่ถอด/เปลี่ยน/ย้ายได้ (ตรงกับที่ฐานข้อมูลตรวจ)
  const partAssetStatusLabel = (status) => PART_ASSET_STATUS_LABELS[status] ?? "";
  const partResultLabel = (status) => PART_RESULT_STATUSES.find((item) => item.value === status)?.label ?? "";
  const partActionLabel = (action) => PART_ACTIONS[action]?.label ?? "";
  const partHostSourceLabel = (source) => PART_HOST_SOURCE_LABELS[source] ?? "";
  const listOf = (value) => (Array.isArray(value) ? value : []);

  // ชื่อที่ใช้เรียกชิ้นส่วน: เลขทะเบียน (หรือรหัสอุปกรณ์) · ชื่อ/รุ่น
  function partAssetLabel(asset) {
    if (!asset || typeof asset !== "object") return "";
    const code = textOf(asset.reg_no) || textOf(asset.device_code);
    const name = textOf(asset.name) || textOf(asset.model) || textOf(asset.type_name);
    return [code, name].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ") || "ชิ้นส่วนไม่มีชื่อ";
  }
  // ข้อความยาวขึ้นสำหรับรายการเลือก: ชื่อ + รุ่น/ซีเรียล/ที่เก็บ (ช่วยแยกชิ้นสำรองที่หน้าตาคล้ายกัน)
  function partAssetDetail(asset) {
    const bits = [asset?.model, asset?.serial ? `S/N ${asset.serial}` : "", asset?.place].map(textOf).filter(Boolean);
    const label = partAssetLabel(asset);
    const rest = bits.filter((bit) => !label.includes(bit));
    return rest.length ? `${label} (${rest.join(" · ")})` : label;
  }

  // ทำคำตอบของ app_itrp_part_changes_context ให้เป็นรูปที่หน้าเว็บใช้ต่อ (ข้อมูลผิดรูป/ไม่ใช่อ็อบเจ็กต์ = null → ซ่อนส่วนนี้)
  function normalizePartContext(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const hosts = listOf(data.hosts).filter((host) => host && textOf(host.host_code)).map((host) => ({
      code: textOf(host.host_code), source: host.source ?? "", device: host.device && typeof host.device === "object" ? host.device : null,
      parts: listOf(host.parts).filter((part) => part && part.id),
    }));
    const spares = listOf(data.spares).filter((group) => group && textOf(group.type_code)).map((group) => ({
      typeCode: textOf(group.type_code), typeName: textOf(group.type_name) || textOf(group.type_code), items: listOf(group.items).filter((item) => item && item.id),
    })).filter((group) => group.items.length);
    const moveTargets = listOf(data.move_targets).filter((target) => target && textOf(target.device_code)).map((target) => ({
      code: textOf(target.device_code), name: textOf(target.name), typeCode: textOf(target.type_code),
    }));
    return {
      requestId: data.request?.id ?? "", docNo: data.request?.doc_no ?? "", canApply: data.can_apply === true, blockedReason: textOf(data.blocked_reason),
      max: Number.isInteger(data.max_changes) && data.max_changes > 0 ? data.max_changes : MAX_PART_CHANGES, hosts, spares, moveTargets,
    };
  }
  // ชิ้นส่วนของเครื่องจัดกลุ่มตามชนิด (ลำดับตามที่ฐานข้อมูลส่งมา)
  function partGroups(parts) {
    const groups = [];
    for (const part of listOf(parts)) {
      let group = groups.find((item) => item.typeCode === part.type_code);
      if (!group) { group = { typeCode: part.type_code ?? "", typeName: textOf(part.type_name) || textOf(part.type_code) || "อื่นๆ", items: [] }; groups.push(group); }
      group.items.push(part);
    }
    return groups;
  }
  const canChangePart = (part) => PARTS_MOVABLE_STATUSES.includes(part?.status);
  function findPartHost(ctx, hostCode) { return ctx?.hosts.find((host) => host.code === hostCode) ?? null; }
  function findInstalledPart(ctx, hostCode, assetId) { return findPartHost(ctx, hostCode)?.parts.find((part) => part.id === assetId) ?? null; }
  function findSparePart(ctx, assetId) {
    for (const group of ctx?.spares ?? []) { const item = group.items.find((part) => part.id === assetId); if (item) return item; }
    return null;
  }
  // ชิ้นส่วนที่เลือกไว้ในรายการแล้ว (ทั้งชิ้นเดิมและชิ้นใหม่) ห้ามใช้ซ้ำในก้อนเดียว
  function usedPartIds(rows) {
    const ids = new Set();
    for (const row of listOf(rows)) { if (row.asset_id) ids.add(row.asset_id); if (row.new_asset_id) ids.add(row.new_asset_id); }
    return ids;
  }
  // ค้นหาตามเลขทะเบียน/รหัส/ชื่อ/รุ่น/ซีเรียล/ที่เก็บ (ไม่สนตัวพิมพ์ใหญ่เล็ก)
  function partMatches(asset, query) {
    const needle = textOf(query).toLowerCase();
    if (!needle) return true;
    return [asset.reg_no, asset.device_code, asset.name, asset.model, asset.serial, asset.place, asset.type_name].some((value) => String(value ?? "").toLowerCase().includes(needle));
  }
  // ชิ้นสำรองที่เลือกได้ตอนนี้: ตัดชิ้นที่อยู่ในรายการแล้ว · typeCode ระบุ = เฉพาะชนิดนั้น (เปลี่ยนแทนกันได้เฉพาะชนิดเดียวกัน) · คืนเป็นกลุ่มตามชนิด
  function availableSpares(ctx, rows, { typeCode = null, query = "" } = {}) {
    const used = usedPartIds(rows);
    return (ctx?.spares ?? [])
      .filter((group) => !typeCode || group.typeCode === typeCode)
      .map((group) => ({ ...group, items: group.items.filter((item) => !used.has(item.id) && partMatches(item, query)) }))
      .filter((group) => group.items.length);
  }
  // เครื่องปลายทางที่ย้ายไปได้: ไม่ใช่เครื่องเดิม · พิมพ์ค้นหาได้ (รหัส/ชื่อ)
  function availableMoveTargets(ctx, hostCode, query = "") {
    const needle = textOf(query).toLowerCase();
    return (ctx?.moveTargets ?? []).filter((target) => target.code !== hostCode && (!needle || `${target.code} ${target.name}`.toLowerCase().includes(needle)));
  }

  // ตรวจรายการที่จะเพิ่ม · คืนข้อความไทยของข้อผิดพลาดข้อแรก หรือ "" ถ้าใช้ได้ · rows = รายการที่เลือกไว้แล้ว (ไม่รวมรายการนี้)
  function checkPartChange(change, rows, ctx) {
    const action = change?.action;
    if (!PART_ACTIONS[action]) return "กรุณาเลือกประเภทรายการ";
    if (listOf(rows).length >= (ctx?.max ?? MAX_PART_CHANGES)) return `เลือกได้ครั้งละไม่เกิน ${ctx?.max ?? MAX_PART_CHANGES} รายการ กรุณาบันทึกชุดนี้ก่อน`;
    const host = findPartHost(ctx, change.host_code);
    if (!host) return "กรุณาเลือกเครื่อง";
    if (!change.asset_id) return action === "install" ? "กรุณาเลือกชิ้นสำรองที่จะติดตั้ง" : "กรุณาเลือกชิ้นส่วน";
    const used = usedPartIds(rows);
    if (used.has(change.asset_id) || (change.new_asset_id && used.has(change.new_asset_id))) return "ชิ้นส่วนนี้อยู่ในรายการที่เลือกไว้แล้ว ใช้ซ้ำในการบันทึกครั้งเดียวไม่ได้";
    if (textOf(change.slot).length > MAX_PART_SLOT) return `ช่อง/Slot ต้องไม่เกิน ${MAX_PART_SLOT} ตัวอักษร`;
    if (textOf(change.note).length > MAX_PART_NOTE) return `หมายเหตุต้องไม่เกิน ${MAX_PART_NOTE} ตัวอักษร`;
    if (action === "install") {
      return findSparePart(ctx, change.asset_id) ? "" : "ไม่พบชิ้นสำรองนี้ในรายการ (อาจถูกใช้ไปแล้ว) กรุณาเลือกใหม่";
    }
    const part = findInstalledPart(ctx, change.host_code, change.asset_id);
    if (!part) return "ไม่พบชิ้นส่วนนี้ในเครื่อง (อาจถูกถอดหรือย้ายไปแล้ว) กรุณาเลือกใหม่";
    if (!canChangePart(part)) return `ชิ้นส่วนนี้มีสถานะ "${partAssetStatusLabel(part.status)}" เปลี่ยน/ถอด/ย้ายไม่ได้ (ต้องเป็นใช้งานหรือชำรุด)`;
    if ((action === "replace" || action === "remove") && !PART_RESULT_STATUSES.some((item) => item.value === change.result_status)) {
      return "กรุณาเลือกสถานะของชิ้นเดิมที่ถอดออก (ชำรุด สำรอง หรือยกเลิกใช้งาน)";
    }
    if (action === "replace") {
      if (!change.new_asset_id) return "กรุณาเลือกชิ้นสำรองที่จะใส่แทน";
      const spare = findSparePart(ctx, change.new_asset_id);
      if (!spare) return "ไม่พบชิ้นสำรองนี้ในรายการ (อาจถูกใช้ไปแล้ว) กรุณาเลือกใหม่";
      if (spare.type_code !== part.type_code) return `ชนิดไม่ตรงกัน: ชิ้นเดิมเป็น ${part.type_name ?? part.type_code} แต่ชิ้นใหม่เป็น ${spare.type_name ?? spare.type_code} (เปลี่ยนแทนกันได้เฉพาะชนิดเดียวกัน)`;
    }
    if (action === "move") {
      const target = textOf(change.to_host_code);
      if (!target) return "กรุณาเลือกเครื่องปลายทางที่จะย้ายไป";
      if (target === change.host_code) return "เครื่องปลายทางต้องเป็นคนละเครื่องกับเครื่องเดิม";
      if (!ctx.moveTargets.some((item) => item.code === target)) return "ไม่พบเครื่องปลายทางนี้ในทะเบียน (เลือกจากรายการที่แสดง)";
    }
    return "";
  }
  // ต่อรายการใหม่ท้ายรายการ (ไม่แก้ rows เดิม) · ผ่าน = { rows } · ไม่ผ่าน = { error }
  function addPartChange(rows, change, ctx) {
    const error = checkPartChange(change, rows, ctx);
    if (error) return { error };
    return { rows: [...listOf(rows), cleanPartChange(change)] };
  }
  // ทำรายการให้ตรงตามสัญญา: เก็บเฉพาะช่องที่ action นั้นรับ (ช่องที่ไม่เกี่ยวส่งไป = ฐานข้อมูลปฏิเสธ) ช่องว่างไม่ส่ง
  const PART_FIELDS_BY_ACTION = Object.freeze({
    replace: ["new_asset_id", "result_status", "slot", "note"],
    remove: ["result_status", "note"],
    move: ["to_host_code", "slot", "note"],
    install: ["slot", "note"],
  });
  function cleanPartChange(change) {
    const clean = { action: change.action, host_code: textOf(change.host_code), asset_id: change.asset_id };
    for (const field of PART_FIELDS_BY_ACTION[change.action] ?? []) {
      const value = textOf(change[field]);
      if (value) clean[field] = value;
    }
    return clean;
  }
  const partChangePayload = (rows) => listOf(rows).map(cleanPartChange);

  // ประโยคสรุปของรายการที่เลือกไว้ (แสดงก่อนกดบันทึก)
  function partChangeSummary(change, ctx) {
    const hostLabel = `เครื่อง ${change.host_code}`;
    const oldLabel = partAssetLabel(findInstalledPart(ctx, change.host_code, change.asset_id) ?? findSparePart(ctx, change.asset_id));
    const slot = textOf(change.slot) ? ` · ช่อง ${textOf(change.slot)}` : "";
    const note = textOf(change.note) ? ` · หมายเหตุ: ${textOf(change.note)}` : "";
    switch (change.action) {
      case "replace": return `${hostLabel}: เปลี่ยน ${oldLabel} เป็น ${partAssetLabel(findSparePart(ctx, change.new_asset_id))} · ชิ้นเดิมเป็น${partResultLabel(change.result_status)}${slot}${note}`;
      case "remove": return `${hostLabel}: ถอด ${oldLabel} ออก · ชิ้นเดิมเป็น${partResultLabel(change.result_status)}${note}`;
      case "move": return `${hostLabel}: ย้าย ${oldLabel} ไปเครื่อง ${change.to_host_code}${slot}${note}`;
      case "install": return `${hostLabel}: ติดตั้ง ${oldLabel}${slot}${note}`;
      default: return "";
    }
  }
  // context ใหม่หลังฐานข้อมูลปฏิเสธ/ผลไม่แน่ชัด: ตัดรายการที่ใช้ไม่ได้แล้วออก (ชิ้นส่วนถูกถอด/ย้าย/ใช้ไปแล้ว) · คืน { rows, dropped }
  function pruneStalePartChanges(rows, ctx) {
    const kept = [];
    for (const row of listOf(rows)) {
      if (checkPartChange(row, kept, { ...ctx, max: Number.MAX_SAFE_INTEGER })) continue;
      kept.push(row);
    }
    return { rows: kept, dropped: listOf(rows).length - kept.length };
  }
  // ข้อความผิดของฐานข้อมูลขึ้นต้น "แถวที่ N: …" (N เริ่ม 1 ตามลำดับที่ส่ง) → เลขแถว หรือ null
  function partChangeErrorRow(message) {
    const match = /^แถวที่ (\d+):/.exec(String(message ?? "").trim());
    return match ? Number(match[1]) : null;
  }

  // ประวัติที่บันทึกแล้ว (app_itrp_get_part_changes → items[]) · ผู้อ่านทุกคนที่เห็นใบ (ไม่มีรหัสภายในของอุปกรณ์)
  function partChangeText(item) {
    const named = (value) => `${value?.type_name ? `${value.type_name} ` : ""}${partAssetLabel(value)}`;
    const status = partResultLabel(item?.result_status);
    switch (item?.action) {
      case "replace": return `เปลี่ยน ${named(item.asset)} เป็น ${named(item.new_asset)}${status ? ` · ชิ้นเดิมเป็น${status}` : ""}`;
      case "remove": return `ถอด ${named(item.asset)} ออก${status ? ` · เป็น${status}` : ""}`;
      case "move": return `ย้าย ${named(item.asset)} ไปเครื่อง ${item.to_host_code ?? "—"}`;
      case "install": return `ติดตั้ง ${named(item.asset)}`;
      default: return "";
    }
  }
  function partChangeItems(data) {
    return listOf(data?.items).filter((item) => item && PART_ACTIONS[item.action]).map((item, index) => ({
      id: item.id ?? index,
      no: index + 1,
      action: item.action,
      actionLabel: PART_ACTIONS[item.action].historyLabel,
      host: item.host_code ?? "",
      text: partChangeText(item),
      slot: textOf(item.slot),
      note: textOf(item.note),
      by: textOf(item.actor_full_name) || textOf(item.actor_employee_no) || "—",
      at: item.created_at ?? "",
      atText: item.created_at ? formatDateTime(item.created_at) : "—",
    }));
  }

  const api = {
    MAX_PART_CHANGES, MAX_PART_SLOT, MAX_PART_NOTE, PART_ACTIONS, PART_RESULT_STATUSES, partAssetStatusLabel, partResultLabel, partActionLabel, partHostSourceLabel, partAssetLabel, partAssetDetail,
    normalizePartContext, partGroups, canChangePart, findPartHost, findInstalledPart, findSparePart, usedPartIds, partMatches, availableSpares, availableMoveTargets,
    checkPartChange, addPartChange, cleanPartChange, partChangePayload, partChangeSummary, pruneStalePartChanges, partChangeErrorRow, partChangeText, partChangeItems,
    MODULE_VERSION, VERSION_DATE, IN_DEVELOPMENT, YEAR_OFFSET, MAX_SYMPTOM, MAX_LONG_TEXT, MAX_ASSET_CODE, MAX_DEVICE_NAME, MAX_NOTE, MAX_PR_PO, MAX_PARTS, MAX_DEVICES, MAX_DEVICE_CODE, MAX_REMARK, MAX_INFO_BODY, MAX_REASON, MAX_REASON_ON_BEHALF, CANCEL_ON_BEHALF, isCancelOnBehalf, cancelReasonSpec, MAX_FILES, MAX_FILE_BYTES,
    REQUEST_KINDS, REPAIR_TARGETS, CAUSE_KINDS, REPAIR_METHODS, FILE_MIME_BY_EXTENSION, FILE_ACCEPT, FILE_HINT, FILES_PREPARING_MESSAGE, EMPTY_REPAIR_FORM, EMPTY_COMPLETE_FORM, EMPTY_PART_ROW, EMPTY_REWORK_FORM, STATUS_LABELS, EVENT_LABELS, ACTION_BUTTONS, ACTION_ORDER, IT_GROUPS, APPROVAL_STATE_LABELS,
    requestKindLabel, repairTargetLabel, causeKindLabel, repairMethodLabel, requestKindText, repairTargetText, causeKindText, repairMethodText, deviceText,
    reworkTag, statusLabel, statusBadgeClass, myStatusLabel, isTestDoc, INFO_STAGE_LABELS, infoStageLabel, commentKindLabel, commentRows, allFiles, pendingQuestion, infoBadgeTitle,
    todayBangkok, formatDate, formatDateTime, formatDateOf, formatTimeOf, isRealDate, charCount, clip, repairDuration, formatQuantity, formatPrice,
    visibleTabs, canViewHistory, canEditHistory, readView, viewAllowed, repairUrl, isUuid,
    actionButtons, countsAsBothSteps, confirmMessageFor, BOTH_STEPS_NOTE, completeToast, answerToast, pendingStepLabel, eventLabel, eventLabelFor, CANCELLED_ON_BEHALF_LABEL, printSignoffs, printOutcome, approvalSummary,
    itGroupOf, groupItOrders, itActionableCount, awaitingMyReceiveCount, awaitingMyAnswerCount, mineWaiting, mineWaitingNote, waitingForMeCount, itApprovalProgress, CLOSED_STATUSES, openOrderCount, cardSummary,
    repairRules, createParams, validateReason, infoRules, infoParams,
    normalizeParts, EMPTY_DEVICE_ROW, NO_DEVICE_LABEL, NO_DEVICE_ERROR, normalizeDeviceCode, deviceCodeError, initialDeviceRows, normalizeDevices, deviceOptionText,
    completeRules, completeParams, vendorField, repairReports, reportView,
    DEVICE_KINDS, DEVICE_STATUSES, deviceKindLabel, deviceStatusLabel, HISTORY_SOURCE_LABELS, historySourceLabel, historyUrl, historyPrintUrl, MIN_HISTORY_DATE, DATE_INPUT_HINT, parseDateInput, normalizeDateField, dateInputText, MAX_DOC_NO, MAX_REPORTER, filterDevices, deviceHeader, historyRowsView,
    EMPTY_HISTORY_FORM, historyRules, historyParams, historyUpdateParams, historyFormValues, HISTORY_FIELDS, revisionsView, EMPTY_DEVICE_FORM, deviceFormValues, deviceRules, deviceParams,
    fileExtension, fileMime, fileBucket, filePath, formatFileSize, validateFiles, makeUploadEntries, isAlreadyUploaded, isFileRejection, runUploads, roundLabel, attachmentGroups, galleryFile, reworkRounds, reworkRules, reworkParams,
    formatDocNo, validateNextSeq, staffRoleText,
    describeError, describeUploadError, purgeSummary,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITRP_MODEL = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
