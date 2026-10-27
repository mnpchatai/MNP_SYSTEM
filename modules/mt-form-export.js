// ดาวน์โหลดใบแจ้งซ่อม/ใบคำร้อง MT เป็นไฟล์ Excel ตามแบบฟอร์ม MT01-FM05 (ชีต "เอกสาร" ในสเปรดชีตระบบแจ้งซ่อม)
// และใบคำร้องถึงฝ่ายบริหารตามแบบฟอร์ม PP01-FM08 (buildManagementFormRecord ท้ายไฟล์)
//
// ไฟล์นี้แปลงข้อมูลที่หน้ารายละเอียดโหลดมาแล้ว (ตามสิทธิ์ RLS ของผู้ดู) เป็นรายการ "เซลล์ → ค่า" ของฟอร์ม
// แล้ว Apps Script (apps-script/mt-form-export/Code.gs) เติมค่าลงสำเนาของฟอร์มและส่งไฟล์ .xlsx กลับมา
// Apps Script ไม่อ่านข้อมูลใบใดจากชีตเลย คนที่ได้ URL ไปจึงดึงข้อมูลใบของคนอื่นไม่ได้
// ส่วนคำนวณนี้ไม่แตะ DOM/Supabase เพื่อให้ Node ทดสอบได้ (scripts/tests/mt-form-export.test.mjs)
//
// ตำแหน่งเซลล์ผูกกับเลย์เอาต์ปัจจุบันของฟอร์ม ถ้าย้าย/แทรกแถวในชีต "เอกสาร" ต้องแก้ CELLS ที่นี่ด้วย
// ค่า boolean = ช่องติ๊ก (Apps Script แปลงเป็น ☑/☐) ค่าข้อความว่าง = ล้างค่าตัวอย่างที่ค้างในแบบฟอร์ม
(function registerMtFormExport(root) {
  // URL ของ Web App (Deploy > Web app) ตั้งหลังติดตั้งตาม apps-script/mt-form-export/README.md
  // ค่าว่าง = ยังไม่ได้ติดตั้ง ปุ่มดาวน์โหลดจะถูกซ่อน
  // ต้องเป็นโปรเจกต์แยก ห้ามซ้ำกับ URL ซิงก์ของ module-mt.js (เทสต์ตรวจไว้)
  const EXPORT_URL = "https://script.google.com/macros/s/AKfycbxC8IXpco1pqnV14UseH5uaM9xJKtnyZQOjhe_aNF10KDtNr8GNvtcQttsIKCRTTy8H_A/exec";
  // ใบคำร้องถึงฝ่ายบริหาร (PP01-FM08) แยกจาก MT: ใช้ Web App ของโปรเจกต์สเปรดชีตบริหารเอง (URL เดียวกับซิงก์
  // ใน module-mg.js) doPost ของ apps-script/management-backup/Code.gs ส่ง form "mg" ไป Export.gs
  // ค่าว่าง = ปุ่มของใบบริหารถูกซ่อน
  const MG_EXPORT_URL = "https://script.google.com/macros/s/AKfycbw_FQUWk6tM8l-CvOdPu7zHxJdKj6Dcq7hBZRIiEotNRGs5sstLj7GnHMK5xixjuS5m/exec";

  const PART_ROWS = [31, 32, 33, 34];
  const BLANK_DATE = "วันที่ _______ / _______ / ______";

  const text = (value) => String(value ?? "").trim();

  // วันที่แบบฟอร์มกระดาษเดิม: dd/MM/yy ปี พ.ศ. 2 หลัก (เช่น 17/10/69) เวลาไทย
  // ค่า date ล้วน (YYYY-MM-DD) ไม่แปลงเขตเวลา กันวันที่เลื่อน
  function thaiDateParts(value) {
    if (!value) return null;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (dateOnly) return { year: Number(dateOnly[1]), month: dateOnly[2], day: dateOnly[3], time: "" };
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
    return { year: Number(parts.year), month: parts.month, day: parts.day, time: `${parts.hour}:${parts.minute}` };
  }

  function formDate(value) {
    const parts = thaiDateParts(value);
    if (!parts) return "";
    return `${parts.day}/${parts.month}/${String((parts.year + 543) % 100).padStart(2, "0")}`;
  }

  function formTime(value) {
    return thaiDateParts(value)?.time ?? "";
  }

  function formDateTime(value) {
    const date = formDate(value);
    const time = formTime(value);
    return time ? `${date} ${time}` : date;
  }

  // ระยะเวลาเริ่ม → เสร็จ เป็นวันกับชั่วโมงเต็ม (ช่อง "รวม ... วัน ... ชม.")
  function duration(startAt, endAt) {
    const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const hours = Math.floor(ms / 3600000);
    return { days: Math.floor(hours / 24), hours: hours % 24 };
  }

  // ครั้งแรกที่เข้าสถานะ "กำลังซ่อม" และครั้งล่าสุดที่ส่งให้ผู้แจ้งตรวจรับ (ซ่อมซ้ำหลังตรวจไม่ผ่านนับรวมทั้งหมด)
  function workTimes(history) {
    const items = (Array.isArray(history) ? history : [])
      .filter((item) => item && item.created_at)
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const started = items.find((item) => item.to_status === "in_progress")?.created_at ?? null;
    const finished = [...items].reverse().find((item) => item.to_status === "pending_verify")?.created_at ?? null;
    const inOrder = started && finished && new Date(finished).getTime() >= new Date(started).getTime();
    return { startedAt: started, finishedAt: inOrder ? finished : null };
  }

  function partsOf(request) {
    if (Array.isArray(request.parts_used_items) && request.parts_used_items.length) return request.parts_used_items;
    return text(request.parts_used) ? [{ name: request.parts_used }] : [];
  }

  function partCells(parts) {
    const cells = {};
    const shown = parts.length > PART_ROWS.length ? parts.slice(0, PART_ROWS.length - 1) : parts;
    PART_ROWS.forEach((row, index) => {
      const part = shown[index];
      cells[`B${row}`] = part ? String(index + 1) : "";
      cells[`D${row}`] = part ? text(part.name) : "";
      cells[`T${row}`] = part ? text(part.qty) : "";
      cells[`X${row}`] = part ? text(part.unit) : "";
      cells[`Z${row}`] = part ? text(part.price) : "";
      cells[`AC${row}`] = part ? text(part.shop) : "";
      cells[`AG${row}`] = part ? text(part.note) : "";
    });
    if (shown.length < parts.length) {
      cells[`D${PART_ROWS[PART_ROWS.length - 1]}`] = `และอีก ${parts.length - shown.length} รายการ (ดูในระบบ)`;
    }
    return cells;
  }

  // ข้อมูลเข้า: request (แถว requests พร้อม department), steps (approval_steps), verifications (ใหม่ → เก่า),
  // history (request_status_history), technicianNames (ชื่อช่างตามลำดับ), nameOf(id) คืนชื่อพนักงาน
  function buildMtFormCells({ request, steps = [], verifications = [], history = [], technicianNames = [], nameOf = () => "" }) {
    // จับคู่ด้วยชื่อขั้น ไม่ใช่ step_order: ขั้นที่ไม่มีผู้ถือบทบาทถูกข้ามตอนสร้างใบ (20260921080000)
    // ใบที่ไม่มีผู้จัดการโรงงานจึงมีผู้จัดการทั่วไปเป็นขั้นที่ 1
    const stepNamed = (name) => steps.find((step) => step.step_name === name) ?? null;
    const fm = stepNamed("ผู้จัดการโรงงาน");
    const gm = stepNamed("ผู้จัดการทั่วไป");
    const decided = (step) => step && ["approved", "rejected", "acknowledged"].includes(step.status);
    const signer = (step) => (decided(step) && step.acted_by ? text(nameOf(step.acted_by)) : "");
    const signLine = (step, role) => {
      const name = signer(step);
      return name ? `ลงชื่อ  ${name}  ${role}` : `ลงชื่อ ________________________ ${role}`;
    };
    const anyRejected = steps.some((step) => step.status === "rejected");
    const activeSteps = steps.filter((step) => step.status !== "skipped");
    const allApproved = activeSteps.length > 0 && activeSteps.every((step) => step.status === "approved");
    const technicians = technicianNames.map(text).filter(Boolean).join(", ");
    const { startedAt, finishedAt } = workTimes(history);
    const total = startedAt && finishedAt ? duration(startedAt, finishedAt) : null;
    const latest = verifications[0] ?? null;
    const passedAt = latest?.result === "pass" ? latest.created_at : null;
    const dateLine = (value) => (value ? `วันที่  ${formDate(value)}` : BLANK_DATE);
    const department = Array.isArray(request.department) ? request.department[0] : request.department;

    const cells = {
      // หัวฟอร์มและส่วนที่ 1
      AG4: text(request.request_no),
      B6: request.doc_type === "request",
      G6: request.doc_type === "repair",
      AB6: text(request.machine_name),
      AB7: text(request.machine_code),
      F7: formDateTime(request.submitted_at),
      P7: formDate(request.needed_date),
      L8: text(request.requester_name),
      X8: text(department?.code),
      B10: text(request.description),
      // ส่วนที่ 2 ฝ่ายบริหารพิจารณา
      K15: allApproved,
      U15: anyRejected,
      B19: signLine(fm, "ฝ่ายบริหารโรงงาน"),
      T19: signLine(gm, "ผู้จัดการทั่วไป"),
      B20: decided(fm) ? formDate(fm.acted_at) : "",
      T20: decided(gm) ? formDate(gm.acted_at) : "",
      // ส่วนที่ 3 แผนกวิศวกรรม/ซ่อมบำรุง
      B23: text(request.received_by_name) ? `ลงชื่อ  ${text(request.received_by_name)}` : "ลงชื่อ ______________________",
      B24: dateLine(request.assigned_at),
      K23: technicians ? `ช่างชื่อ  ${technicians}` : "ช่างชื่อ _____________________",
      K25: dateLine(request.assigned_at),
      U23: request.execution_plan === "immediate",
      U24: request.execution_plan === "need_purchase",
      U25: request.execution_plan === "use_existing",
      AB24: request.work_expected_date ? `วันที่  ${formDate(request.work_expected_date)}` : "วันที่ _______ / _______ / _______",
      B27: text(request.cause_analysis)
        ? `วิเคราะห์สาเหตุ / อาการที่ชำรุด พบว่า  ${text(request.cause_analysis)}`
        : "วิเคราะห์สาเหตุ / อาการที่ชำรุด พบว่า",
      L28: request.inspector_opinion === "send_repair",
      Q28: request.inspector_opinion === "external",
      Y28: request.inspector_opinion === "self_repair",
      AC28: request.inspector_opinion === "buy_parts",
      ...partCells(partsOf(request)),
      B36: startedAt ? `วันที่  ${formDate(startedAt)}` : "วันที่",
      B37: startedAt ? `เวลา  ${formTime(startedAt)}` : "เวลา",
      K36: finishedAt ? `วันที่  ${formDate(finishedAt)}` : "วันที่ ",
      K37: finishedAt ? `เวลา  ${formTime(finishedAt)}` : "เวลา ",
      V36: total ? String(total.days) : "",
      Y36: total ? String(total.hours) : "",
      AB36: finishedAt && technicians ? `ลงชื่อ  ${technicians}` : "ลงชื่อ ",
      AB37: finishedAt ? `วันที่  ${formDate(finishedAt)}` : "วันที่ ",
      // ส่วนที่ 4 สรุป/ส่งมอบงาน
      C39: latest?.result === "pass",
      C40: latest?.result === "fail",
      K40: finishedAt ? `วันที่  ${formDate(finishedAt)}` : "วันที่ ",
      T40: passedAt ? `วันที่  ${formDate(passedAt)}` : "วันที่ ",
      AB40: "วันที่ ",
    };
    return { form: "mt", fileName: safeFileName(request.request_no, "MT01-FM05"), cells };
  }

  const safeFileName = (docNumber, fallback) => `${text(docNumber).replace(/[^\p{L}\p{N}_-]+/gu, "-") || fallback}.xlsx`;

  // ใบคำร้องถึงฝ่ายบริหาร: ส่ง "แถว" รูปแบบเดียวกับชีต "ใบคำร้องถึงฝ่ายบริหาร" (upsertStructuredRow_ ใน
  // apps-script/management-backup/Code.gs) ให้ Export.gs ในโปรเจกต์เดียวกันเติมฟอร์มด้วย
  // FormFill.gs ตัวเดียวกับที่ใช้บนชีต
  // หน้าตาไฟล์จึงตรงกับฟอร์มที่เติมบนชีตทุกอย่าง (ตัดบรรทัด ย่อตัวอักษร ติ๊กสำเนาถึงแผนก)
  // order = ผลของ buildAppsScriptManagementOrder ใน modules/module-mg.js
  const MANAGEMENT_RECORD_HEADERS = [
    "เลขที่เอกสาร", "แผนก", "เรื่อง", "รายละเอียด", "สิ่งที่แนบมาด้วย", "ผู้ยื่นคำร้อง", "ตำแหน่ง", "ยื่นเมื่อ", "สถานะ",
    "มติ", "ความเห็น", "ผจก.โรงงาน อนุมัติโดย", "ผจก.โรงงาน เมื่อ", "ผจก.ทั่วไป อนุมัติโดย", "ผจก.ทั่วไป เมื่อ",
    "สำเนาถึงแผนก", "สำเนาอื่นๆ",
  ];

  function buildManagementFormRecord(order) {
    const fm = order.approvals?.fm ?? {};
    const gm = order.approvals?.gm ?? {};
    const values = [
      order.docNumber, order.department, order.subject, order.description, order.attachmentNote, order.requestedBy,
      order.position, order.submittedAt, order.status, order.decision, order.comment, fm.by, fm.at, gm.by, gm.at,
      (Array.isArray(order.ccDepartments) ? order.ccDepartments : []).join(", "), order.ccOther,
    ];
    const record = Object.fromEntries(MANAGEMENT_RECORD_HEADERS.map((header, index) => [header, String(values[index] ?? "")]));
    return { form: "mg", fileName: safeFileName(order.docNumber, "PP01-FM08"), record };
  }

  // ปุ่มดาวน์โหลดในหน้ารายละเอียด (ใช้ร่วมกันทั้ง MT และ MG) — helpers = { showToast, friendlyError } ของ app.js
  async function downloadXlsx(button, payload, helpers) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "กำลังสร้างไฟล์…";
    try {
      const blob = await requestXlsx(payload);
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: payload.fileName });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) {
      helpers.showToast(helpers.friendlyError(exportError), "error");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  const downloadButtonHtml = (formCode) =>
    `<button type="button" class="btn secondary small" id="form-export" title="ดาวน์โหลดเป็นแบบฟอร์ม ${formCode}">ดาวน์โหลด Excel</button>`;

  // ไฟล์ base64 จาก Apps Script → Blob
  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  // ส่งแบบ text/plain (simple request ไม่มี preflight) Apps Script redirect ไป googleusercontent ที่เปิด CORS ให้อ่านผลได้
  const exportUrlFor = (payload) => (payload?.form === "mg" ? MG_EXPORT_URL : EXPORT_URL);

  async function requestXlsx(payload, fetchImpl = root.fetch?.bind(root), url = exportUrlFor(payload)) {
    if (!url) throw new Error("ยังไม่ได้ตั้งค่าการดาวน์โหลดเอกสาร");
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error("เชื่อมต่อระบบสร้างเอกสารไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok || typeof result.base64 !== "string") {
      // แนบรหัสจาก Apps Script (NOT_CONFIGURED, FORM_SHEET_NOT_FOUND, EXPORT_FAILED ...) ไว้ไล่สาเหตุตาม README
      const code = typeof result?.error === "string" && /^[A-Z0-9_]{1,40}$/.test(result.error) ? result.error : `HTTP_${response.status}`;
      throw new Error(`สร้างไฟล์ Excel ไม่สำเร็จ (${code}) กรุณาลองใหม่อีกครั้ง`);
    }
    return new Blob([base64ToBytes(result.base64)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const api = {
    EXPORT_URL, MG_EXPORT_URL, PART_ROWS, MANAGEMENT_RECORD_HEADERS, buildMtFormCells, buildManagementFormRecord, requestXlsx, downloadXlsx,
    downloadButtonHtml, formDate, formTime, workTimes, duration,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MNP_MT_FORM_EXPORT = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
