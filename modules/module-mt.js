// โมดูลใบคำร้อง/แจ้งซ่อม MT (MT_REPAIR) ของ Pilot Web
//
// แยกจาก app.js เฉพาะส่วนที่เป็นของ MT: ฟอร์มแจ้งซ่อม (แผนก/เครื่องจักร/ประเภทเอกสาร), ข้อมูลและ
// ส่วนงานช่างในหน้ารายละเอียด (มอบหมายช่าง, หมุดความคืบหน้า, เริ่มงาน, บันทึกผล/อะไหล่, ตรวจรับ)
// และการซิงก์สำเนาสำรองไปชีต Maintenance-MT ส่วน workflow/สิทธิ์ทั้งหมดอยู่ที่ฐานข้อมูล
// (app_create_repair_request, app_assign_repair_technician, app_start_repair_work, ...)
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — ฟังก์ชันข้างในเรียก helper/ค่าคงที่ของ app.js
// (sb, escapeHtml, showToast, friendlyError, setFormBusy, closePopup, statusLabel,
// renderRequestDetail ฯลฯ) ได้เพราะ hook ทุกตัวถูก
// เรียกหลัง app.js โหลดเสร็จแล้วเท่านั้น ห้ามเรียกของ app.js ตอนโหลดไฟล์นี้
//
// การคำนวณสิทธิ์ในไฟล์นี้ใช้แค่ตัดสินว่าจะแสดงปุ่มไหน ฐานข้อมูลเป็นตัวบังคับสิทธิ์จริง
(function registerMtRepairModule() {
  // สำรองข้อมูลใบแจ้งซ่อมไปชีต Maintenance-MT เดิม (แค่บันทึก/รายงาน — Supabase ยังเป็นฐานข้อมูลหลัก
  // และเป็นตัวบังคับสิทธิ์/workflow ทั้งหมด) ดู syncRepairOrderToAppsScript ท้ายไฟล์นี้
  const APPS_SCRIPT_SYNC_URL = "https://script.google.com/macros/s/AKfycbwfHj4_rNUfU9ZB4xjOpyJPxQSHucoT1baeJ0AFGaz46olWJ8UXU_pBLnKpCwG6KHprqA/exec";

  const docTypeLabels = { request: "ใบคำร้อง", repair: "ใบแจ้งซ่อม" };
  // ชื่อของผลการซ่อมชุดเดียว ใช้ทั้งฟอร์มมอบหมายและข้อมูลเพิ่มเติม (ประวัติไม่ทวนผลการซ่อม)
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
  // ช่องที่ต้องกรอกบอกแบบเดียวทั้งระบบ (เหมือน REQUIRED_MARK ของ app.js)
  const REQUIRED = ' <span class="field-required">(จำเป็น)</span>';
  // หลังขั้นซ่อมสำเร็จและวาดหน้าใหม่ โฟกัสไปที่หัวใบ (ไม่หลุดไปที่ตัวหน้า) โปรแกรมอ่านหน้าจออ่านต่อจากตรงนั้น
  const focusDetailHeading = () => { const heading = document.querySelector(".request-detail-head h1"); if (!heading) return; heading.tabIndex = -1; heading.focus({ preventScroll: true }); };

  // ข้อมูลฟอร์ม MT01-FM05 ของใบที่เปิดอยู่ ตั้งใน detailView และใช้ตอนกดปุ่มดาวน์โหลด Excel ใน bindDetail
  let formExportPayload = null;
  // เลขที่ใบที่หน้ารายละเอียดวาดล่าสุด ใช้ในบรรทัดยืนยันของเริ่มงาน เสร็จสิ้นงาน และตรวจรับ
  let currentRequestNo = "";
  // แถว "ใบนี้" ใน popup ประวัติการซ่อมของเครื่อง ตั้งใน detailView และใช้ตอนกดการ์ดเครื่องจักรใน bindDetail
  let machineHistoryCurrent = null;

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
    { sourceCode: "ID", displayCode: "ID", name: "Indesign" },
  ];

  // ระบบเดิมแยกสถานะรออนุมัติ/ขอข้อมูลเพิ่มเป็นของ ผจก.โรงงาน กับ ผจก.ทั่วไป คนละตัว ส่วนที่นี่เก็บเป็น
  // pending_approval/more_info ตัวเดียวแล้วดูขั้นประกอบ — เติมชื่อขั้นต่อท้ายให้อ่านได้เหมือนกัน
  const approverShortNames = { "ผู้จัดการโรงงาน": "ผจก.โรงงาน", "ผู้จัดการทั่วไป": "ผจก.ทั่วไป" };

  function repairStatusBadge(request, steps) {
    const stepName = request.status === "pending_approval"
      ? steps.find((step) => step.status === "pending" && step.step_order === request.current_step)?.step_name
      : request.status === "more_info"
        ? steps.find((step) => step.status === "more_info")?.step_name
        : null;
    if (!stepName) return statusBadge(request.status, true);
    const short = approverShortNames[stepName] ?? stepName;
    // ขั้นอนุมัติใช้คำของขั้นนั้น (รอรับทราบ/รออนุมัติ) เหมือนแจ้งเตือน
    const stateLabel = request.status === "pending_approval" && window.MNP_STEP_VERB ? window.MNP_STEP_VERB.pendingLabel(stepName) : statusLabel(request.status, true);
    // ชื่อขั้นอยู่ใน .badge-step: หน้ารายละเอียดที่มีแถบตัดสินใจ (บรรทัด "ขั้นตอน: …") ซ่อนไว้ ไม่ให้พูดชื่อขั้นสองครั้ง (styles.css .has-step-line)
    return `<span class="badge ${escapeHtml(request.status)}">${escapeHtml(stateLabel)}<span class="badge-step"> (${escapeHtml(short)})</span></span>`;
  }

  // แถวกรอกอะไหล่/วัสดุหนึ่งรายการในฟอร์มบันทึกผลการซ่อม — โครงเดียวกับ maintRecord.parts[] ของ
  // ระบบ Maintanance-MT เดิม (name/qty/unit/price/shop/note) ใช้ซ้ำทั้งตอนสร้างแถวแรกและกด "➕ เพิ่มรายการ"
  // เรนเดอร์เป็นแถวตาราง (ลำดับ/รายการ/จำนวน/หน่วย/ราคา/ชื่อร้าน/หมายเหตุ) ให้หน้าตาตรงกับฟอร์มกระดาษเดิม
  // ฟอร์มมอบหมายช่าง / บันทึกผลการซ่อม: กฎของช่อง (MNP_FORM_STEPS.validate) เรียงตามลำดับบนจอ
  const ASSIGN_RULES = Object.freeze([
    { name: "technician_ids", required: true, message: "ยังไม่ได้เลือกช่าง (อย่างน้อย 1 คน)" },
    { name: "execution_plan", required: true, message: "ยังไม่ได้เลือกการดำเนินงาน" },
    { name: "inspector_opinion", required: true, message: "ยังไม่ได้เลือกความคิดเห็นของช่างผู้ตรวจสอบ" },
    { name: "work_started_date", required: true, message: "เลือกวันเริ่มงาน" },
    { name: "work_expected_date", required: true, message: "เลือกกำหนดเสร็จ", check: (value, values) => !values.work_started_date || value >= values.work_started_date, checkMessage: "กำหนดเสร็จต้องไม่ก่อนวันเริ่มงาน" },
  ]);
  const FINISH_RULES = Object.freeze([{ name: "cause_analysis", required: true, minLength: 3, message: "เขียนวิเคราะห์สาเหตุอย่างน้อย 3 ตัวอักษร" }]);
  // ข้อความใต้ช่องแล้วพาไปช่องแรกที่ผิด · ช่องวันที่ใช้ปฏิทินไทย จึงโฟกัสปุ่มของปฏิทินแทนช่องที่ซ่อน
  // ผลการซ่อมในการ์ดตรวจรับ: ผู้แจ้งเห็นสิ่งที่ช่างทำก่อนกดผ่าน/ไม่ผ่าน (ตัดสินจากหลักฐาน ไม่ต้องเลื่อนหา)
  function verifySummaryHtml(request) {
    const rows = [["วิเคราะห์สาเหตุ", request.cause_analysis], ["อะไหล่ที่ใช้", request.parts_used]].filter(([, value]) => String(value ?? "").trim());
    return rows.length ? `<dl class="verify-summary">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : "";
  }
  function showRepairFieldErrors(form, errors) {
    const target = window.MNP_FORM_STEPS.showFieldErrors(form, errors);
    const first = form.querySelector(`[data-field="${errors[0].name}"]`);
    const focusable = first?.querySelector('button[id$="-button"]') ?? target;
    focusable?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: "center" });
  }
  function clearRepairFieldErrorOnEdit(form) {
    if (!form || !window.MNP_FORM_STEPS) return;
    const clear = (event) => { const name = event.target.closest?.("[data-field]")?.dataset.field; if (name) window.MNP_FORM_STEPS.clearFieldError(form, name); };
    form.addEventListener("input", clear);
    form.addEventListener("change", clear);
  }

  function partsRowHtml(item = {}) {
    return `<tr class="parts-row">
      <td class="parts-row-no"></td>
      <td data-label="รายการ"><input class="input" type="text" maxlength="200" aria-label="รายการ" data-part-field="name" value="${escapeHtml(item.name ?? "")}"></td>
      <td data-label="จำนวน"><input class="input" type="text" inputmode="decimal" maxlength="50" aria-label="จำนวน" data-part-field="qty" value="${escapeHtml(item.qty ?? "")}"></td>
      <td data-label="หน่วย"><input class="input" type="text" maxlength="50" aria-label="หน่วย" data-part-field="unit" value="${escapeHtml(item.unit ?? "")}"></td>
      <td data-label="ราคา (บาท)"><input class="input" type="text" inputmode="decimal" maxlength="50" aria-label="ราคา" data-part-field="price" value="${escapeHtml(item.price ?? "")}"></td>
      <td data-label="ชื่อร้าน"><input class="input" type="text" maxlength="200" aria-label="ชื่อร้าน" data-part-field="shop" value="${escapeHtml(item.shop ?? "")}"></td>
      <td data-label="หมายเหตุ"><input class="input" type="text" maxlength="500" aria-label="หมายเหตุ" data-part-field="note" value="${escapeHtml(item.note ?? "")}"></td>
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
          <form class="progress-order-form" id="progress-order-${escapeHtml(step.id)}" data-step="${escapeHtml(step.id)}" novalidate>
            <div class="progress-choice">
              <label class="progress-choice-option"><input type="radio" name="receipt_mode" value="now" checked> รับของทันที (ได้ของพร้อมสั่งซื้อ)</label>
              <label class="progress-choice-option"><input type="radio" name="receipt_mode" value="later"> ระบุวันที่คาดว่าของจะมาส่ง</label>
            </div>
            <div class="field" data-field="expected_on"><input class="input progress-expected-input" type="date" name="expected_on" aria-label="วันที่คาดว่าของจะมาส่ง" disabled></div>
            ${extraFilesFieldHtml(`progress-order-files-${escapeHtml(step.id)}`, "แนบหลักฐานการสั่งซื้อ (ถ้ามี)")}
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
          <button type="button" class="btn secondary small progress-reschedule-toggle" data-step="${escapeHtml(step.id)}" aria-expanded="false">ของยังไม่มา เลื่อนวันที่คาดว่าจะมาส่ง</button>
          <form class="progress-reschedule-form hidden" id="progress-reschedule-${escapeHtml(step.id)}" data-step="${escapeHtml(step.id)}" novalidate>
            <div class="field" data-field="expected_on"><label class="field-label" for="progress-reschedule-date-${escapeHtml(step.id)}">วันที่คาดว่าของจะมาส่งใหม่${REQUIRED}</label>
            <input class="input" id="progress-reschedule-date-${escapeHtml(step.id)}" type="date" name="expected_on" required></div>
            ${extraFilesFieldHtml(`progress-reschedule-files-${escapeHtml(step.id)}`)}
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

  const machineLabel = (machine) => machine.is_placeholder ? machine.code : machineLabelOf(machine.code, machine.name);

  // สิทธิ์ที่ใช้ตัดสินว่าจะแสดงส่วนงานช่างไหน — ต้องตรงกับเงื่อนไขใน RPC ของฐานข้อมูล
  function detailPermissions({ request, type, directory, assignedTechIds, employee }) {
    const technicians = [...directory.entries()].filter(([, person]) => person.is_active && person.department_id === type.owning_department_id);
    // สเปก: ผจก.ซ่อมบำรุงแก้รายชื่อช่างได้ทุกสถานะ ยกเว้นใบที่ถูกปฏิเสธ และต้องอนุมัติครบก่อน
    const isOwningDeptManager = DEPT_MANAGER_ROLE_CODES.includes(employee.role?.code)
      && employee.department_id === type?.owning_department_id;
    // การแจกจ่ายงานเป็นหน้าที่ ผจก.แผนกซ่อมบำรุงคนเดียว — ห้ามใช้ isAdmin ตรงนี้เพราะมันรวม
    // factory_manager/general_manager ซึ่งไม่ควรเข้ามายุ่งในขั้นตอนของช่าง (ตรงกับ
    // app_assign_repair_technician ที่ตัด requests.view_all ออกแล้วใน 20260921100000)
    const canAssign = ["pending_assign", "assigned", "in_progress", "pending_verify", "completed"].includes(request.status)
      && (employee.role?.code === "admin" || isOwningDeptManager);
    const isMyRepairJob = assignedTechIds.includes(employee.id);
    // เจตนา: จำกัดเฉพาะช่างที่ถูกมอบหมาย + ผู้จัดการแผนกเจ้าของประเภทเอกสาร + admin เท่านั้น
    // ไม่ใช้ isAdmin (ซึ่งรวม factory_manager/general_manager) เพราะสองบทบาทนั้นไม่ได้เกี่ยวข้อง
    // กับงานซ่อมนี้โดยตรง — ป้องกันคนที่ไม่เกี่ยวข้องกดเริ่มงานแทนช่าง
    const canStartWork = request.status === "assigned" && assignedTechIds.length > 0 && (
      employee.role?.code === "admin" || isMyRepairJob || isOwningDeptManager
    );
    // จบงาน: ผจก.โรงงาน/ผจก.ทั่วไป กดแทนไม่ได้ (ตัด requests.view_all ออกแล้ว) แต่หัวหน้าแผนก
    // ซ่อมบำรุงเจ้าของงาน (isOwningDeptManager) กดแทนช่างในชุดได้เหมือนปุ่มเริ่มงาน/หมุดความคืบหน้า
    // ต้องตรงกับเงื่อนไขฝั่ง app_finish_repair_work — ส่วนตรวจรับยังเหลือแค่ผู้แจ้งเท่านั้น
    const canFinishWork = request.status === "in_progress"
      && (employee.role?.code === "admin" || isMyRepairJob || isOwningDeptManager);
    const canVerify = request.status === "pending_verify"
      && (employee.role?.code === "admin" || request.requester_id === employee.id);
    // หมุดความคืบหน้า: ช่างในชุด กับ ผจก.ซ่อมบำรุง เท่านั้นที่กดได้ คนอื่นดูได้อย่างเดียว
    const canRecordProgress = employee.role?.code === "admin" || isMyRepairJob || isOwningDeptManager;
    return { technicians, isOwningDeptManager, canAssign, isMyRepairJob, canStartWork, canFinishWork, canVerify, canRecordProgress };
  }

  // กดการ์ด "เครื่องจักร" → popup ประวัติการซ่อมของเครื่องนั้น โหลดตอนกดเท่านั้น (RPC ตรวจสิทธิ์ที่ฐานข้อมูล)
  // ปิดได้ด้วยปุ่ม ปิด, Esc, กดนอกกรอบ หรือเมื่อ hash เปลี่ยน (กดลิงก์ไปใบอื่น) และคืน focus ให้การ์ดที่กด
  async function openMachineHistory(requestId, trigger, current) {
    if (document.querySelector(".machine-history")) return;
    const history = window.MNP_MT_MACHINE_HISTORY;
    const label = trigger.querySelector(".request-fact-value")?.textContent.trim() ?? "";
    const overlay = document.createElement("div");
    overlay.className = "attachment-lightbox machine-history";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "machine-history-title");
    overlay.innerHTML = `<div class="attachment-lightbox-panel machine-history-panel">
      <header class="attachment-lightbox-bar">
        <span class="attachment-lightbox-title" id="machine-history-title">ประวัติการซ่อม · ${escapeHtml(label)}</span>
        <span class="attachment-lightbox-actions"><button class="btn secondary small" type="button" data-history-close>ปิด</button></span>
      </header>
      <div class="machine-history-body"><p class="machine-history-state" role="status">กำลังโหลด…</p></div>
    </div>`;
    const body = overlay.querySelector(".machine-history-body");

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("hashchange", close);
      document.body.classList.remove("no-scroll");
      if (trigger.isConnected) trigger.focus();
    }
    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }
    // กดลิงก์ไปใบอื่นเปลี่ยน hash อยู่แล้ว popup จึงปิดผ่าน hashchange ไม่ต้องปิดในตัวจัดการคลิกที่นี่
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-history-close]")) close();
    });
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("hashchange", close);
    document.body.classList.add("no-scroll");
    document.body.append(overlay);
    overlay.querySelector("[data-history-close]").focus();

    try {
      const { data, error } = await sb.rpc("app_get_machine_repair_history", { p_request_id: requestId });
      if (error) throw error;
      if (!overlay.isConnected) return;
      body.innerHTML = history.listHtml(history.withCurrentRow(history.normalizeRows(data), current), { escapeHtml, formatDate, statusBadge, docTypeLabels });
    } catch (error) {
      if (!overlay.isConnected) return;
      body.innerHTML = `<p class="machine-history-state error" role="status">${escapeHtml(history.errorMessage(error, friendlyError))}</p>`;
    }
  }

  // กำหนดเสร็จ: ช่างในชุด/ผจก.เจ้าของงานแก้กำหนดเสร็จได้ระหว่างรอเริ่มงานหรือกำลังซ่อม
  // เลยกำหนดแล้ว (หลังวันกำหนดเสร็จ) ระบบเตือนช่างทุกรอบ 08:30/13:30 จนกว่าจะจบงานหรือแก้วันที่ใหม่
  // ทุกการแก้วันที่ถูกบันทึกเป็นประวัติ "แก้ไขจากกำหนดเสร็จเดิม ... เป็นวันที่ ..." ในลำดับเหตุการณ์
  function expectedDateSectionHtml(request, canReschedule) {
    if (!canReschedule || !["assigned", "in_progress"].includes(request.status)) return "";
    const today = bangkokToday();
    const overdue = Boolean(request.work_expected_date) && request.work_expected_date < today;
    const current = request.work_expected_date ? formatDate(request.work_expected_date) : "ยังไม่ได้กำหนด";
    const form = `<form id="expected-date-form"${overdue ? "" : ' class="hidden"'}>
        <div class="field" data-field="expected_date"><label for="expected-date-input">กำหนดเสร็จใหม่${REQUIRED}</label><input class="input" id="expected-date-input" name="expected_date" type="date" min="${escapeHtml(today)}" required></div>
        <div class="field"><label for="expected-date-note">เหตุผล (ถ้ามี)</label><input class="input" id="expected-date-note" name="note" maxlength="500" placeholder="เช่น รออะไหล่"></div>
        <p class="muted small">ระบบแจ้งผู้แจ้งให้ทราบ</p>
        <div class="form-actions">${overdue ? "" : '<button class="btn secondary" type="button" id="expected-date-cancel">ยกเลิก</button>'}<button class="btn" type="submit">บันทึกกำหนดเสร็จใหม่</button></div>
      </form>`;
    if (overdue) {
      return `<section class="card expected-date-overdue"><h2>เลยกำหนดเสร็จแล้ว</h2>
        <p class="muted small">กำหนดเสร็จเดิม ${escapeHtml(current)} · ${request.status === "in_progress" ? "เสร็จสิ้นงาน" : "เริ่มงาน"} หรือแก้กำหนดเสร็จ ระบบจะเตือนทางอีเมลทุก 08:30 และ 13:30 น. จนกว่าจะดำเนินการ</p>
        ${form}</section>`;
    }
    return `<section class="card"><h2>กำหนดเสร็จ ${escapeHtml(current)}</h2>
      <button type="button" class="btn secondary small" id="expected-date-toggle" aria-expanded="false" aria-controls="expected-date-form">แก้กำหนดเสร็จ</button>
      ${form}</section>`;
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.MT_REPAIR = {
    code: "MT_REPAIR",
    enabled: true,
    label: "ใบคำร้อง/แจ้งซ่อม MT",
    palette: "mt",

    // แผนกที่แจ้งซ่อมได้ (เรียงตามลำดับที่ใช้ในฟอร์ม) — ใช้ทั้งฟอร์มสร้างคำร้องและตัวกรองแผนกในหน้ารายการ
    async loadRepairDepartments(sb) {
      const { data, error } = await sb.from("departments").select("id,code,name_th").eq("is_active", true).eq("is_repair_site", true).order("code");
      if (error) throw error;
      const availableDepartments = new Map((data ?? []).map((item) => [item.code, item]));
      return REPAIR_DEPARTMENT_OPTIONS
        .map((option) => ({ ...availableDepartments.get(option.sourceCode), ...option }))
        .filter((item) => item.id);
    },

    // แผนกที่แจ้งซ่อมได้ + เครื่องจักร — โหลดครั้งเดียวต่อการเปิดหน้าสร้างคำร้อง
    async prepareForm({ sb }) {
      const [departments, machinesResult] = await Promise.all([
        this.loadRepairDepartments(sb),
        sb.from("machines").select("id,code,name,department_id,is_placeholder").eq("is_active", true).order("sort_order"),
      ]);
      if (machinesResult.error) throw machinesResult.error;
      return { departments, machines: machinesResult.data ?? [] };
    },

    // ฟอร์มแจ้งซ่อม 3 ขั้นบนจอแคบ (หน้าเดียวบนจอกว้าง) — brief .impeccable/surfaces/src-components-request-form-tsx.md
    // ขั้น 1 ที่ไหน/อะไร · ขั้น 2 รูปและความเร่งด่วน · ขั้น 3 ทบทวนก่อนส่ง; ส่งไป app_create_repair_request ด้วยช่องเดิมทุกช่อง
    renderCreateForm({ departments }, { employee }) {
      return `
        <section class="card form-card" id="repair-form-card"><div id="request-message" role="status"></div>
        <div class="draft-banner" id="repair-draft" role="region" aria-label="ร่างที่ค้างอยู่" hidden></div>
        <form id="repair-form" class="stepped-form" novalidate>
          ${window.MNP_FORM_STEPS.headHtml()}
          <fieldset class="form-step" data-step="1">
            <legend class="form-step-title">ที่ไหน และเป็นอะไร</legend>
            <div class="field full">${docNumberBoxHtml("repair-doc-number")}</div>
            <div class="field full" data-field="department_id">
              <span class="field-label" id="repair-department-label">แผนกที่แจ้ง <span class="field-required">(จำเป็น)</span></span>
              <input type="hidden" id="repair-department" name="department_id">
              <div class="repair-department-grid" id="repair-department-picker" role="group" aria-labelledby="repair-department-label" data-invalid-target>${departments.map((item, index) => `<button type="button" class="repair-department-card" data-dept="${escapeHtml(item.id)}" data-dept-code="${escapeHtml(item.sourceCode)}" aria-pressed="false"${index === 0 ? " data-focus" : ""}><span class="repair-department-check">${uiIcon("check")}</span><strong>${escapeHtml(item.displayCode)}</strong><span>${escapeHtml(item.name)}</span></button>`).join("")}</div>
            </div>
            <div class="field full" data-field="machine_id">
              <label for="repair-machine-search">เครื่องจักร <span class="field-required">(จำเป็น)</span></label>
              <input type="hidden" id="repair-machine" name="machine_id">
              <div class="machine-combobox" id="repair-machine-combobox">
                <input class="input machine-search-input" id="repair-machine-search" type="search" placeholder="เลือกแผนกก่อน" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="repair-machine-list" aria-expanded="false" data-focus disabled>
                <span class="machine-search-icon" aria-hidden="true">${uiIcon("search")}</span>
                <div class="machine-listbox" id="repair-machine-list" role="listbox" data-popup hidden></div>
              </div>
              <small>ค้นหาด้วยรหัสหรือชื่อเครื่อง ไม่พบให้กด "เพิ่มรหัสเครื่องจักรใหม่" ท้ายรายการ</small>
              <div class="machine-new" id="repair-machine-new" hidden>
                <div class="form-grid">
                  <div class="field"><label for="repair-machine-new-code">รหัสเครื่องจักรใหม่</label><input class="input" id="repair-machine-new-code" maxlength="40" autocomplete="off" placeholder="เช่น H-HL1-1"></div>
                  <div class="field"><label for="repair-machine-new-name">ชื่อเครื่องจักร</label><input class="input" id="repair-machine-new-name" maxlength="120" autocomplete="off" placeholder="เช่น รถยกลากพาเลส"></div>
                </div>
                <small>บันทึกเข้าทะเบียนเครื่องจักรของแผนกที่เลือก ครั้งต่อไปค้นหารหัสนี้เจอในรายการ</small>
                <div id="repair-machine-new-message" role="alert"></div>
                <div class="form-actions"><button type="button" class="btn secondary" id="repair-machine-new-cancel">ยกเลิก</button><button type="button" class="btn" id="repair-machine-new-save">บันทึกเครื่องจักร</button></div>
              </div>
            </div>
            <div class="field full">
              <span class="field-label" id="repair-doctype-label">ประเภทเอกสาร</span>
              <input type="hidden" id="repair-doc-type" name="doc_type" value="repair">
              <div class="filters" id="repair-doctype-picker" role="group" aria-labelledby="repair-doctype-label">
                <button type="button" class="filter active" data-doctype="repair" aria-pressed="true">${escapeHtml(docTypeLabels.repair)}</button>
                <button type="button" class="filter" data-doctype="request" aria-pressed="false">${escapeHtml(docTypeLabels.request)}</button>
              </div>
            </div>
            <div class="field full" data-field="description"><label for="repair-description">อาการ / รายละเอียด <span class="field-required">(จำเป็น)</span></label><textarea class="textarea" id="repair-description" name="description" maxlength="5000" rows="4"></textarea></div>
          </fieldset>
          <fieldset class="form-step" data-step="2">
            <legend class="form-step-title">รูปและความเร่งด่วน</legend>
            <div class="field full">
              <span class="field-label">รูปหรือไฟล์ประกอบ (ถ้ามี)</span>
              <label class="btn secondary file-pick" for="repair-attachment" title="${escapeHtml(ATTACHMENT_HINT)}">${uiIcon("camera")} ถ่ายรูป / เลือกไฟล์</label>
              <input class="file-pick-input" id="repair-attachment" name="attachment" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx">
              <small>${ATTACHMENT_HINT_SHORT}</small>
            </div>
            <div class="field full"><label class="switch-label" for="repair-urgent"><input type="checkbox" id="repair-urgent" name="is_urgent"> แจ้งด่วน</label></div>
            <div class="field" data-field="needed_date"><label for="repair-needed-date">วันที่ต้องการใช้งาน (ถ้ามี)</label><input class="input" id="repair-needed-date" name="needed_date" type="date"></div>
            <div class="field"><label for="repair-requester-name">ชื่อผู้แจ้ง</label><input class="input" id="repair-requester-name" name="requester_name" maxlength="120" value="${escapeHtml(`${employee.first_name} ${employee.last_name}`)}"></div>
          </fieldset>
          <fieldset class="form-step form-step-review" data-step="3">
            <legend class="form-step-title">ทบทวนก่อนส่ง</legend>
            <div id="repair-review"></div>
          </fieldset>
          ${window.MNP_FORM_STEPS.actionsHtml({ cancelHref: "#/requests", submitLabel: "ส่งใบแจ้งซ่อม" })}
        </form></section>`;
    },

    bindCreateForm({ departments, machines }, { employee }) {
      const form = document.querySelector("#repair-form");
      const card = document.querySelector("#repair-form-card");
      const departmentInput = document.querySelector("#repair-department");
      const machineInput = document.querySelector("#repair-machine");
      const machineSearch = document.querySelector("#repair-machine-search");
      const machineList = document.querySelector("#repair-machine-list");
      const docTypeInput = document.querySelector("#repair-doc-type");
      const description = document.querySelector("#repair-description");
      const neededDate = document.querySelector("#repair-needed-date");
      const requesterName = document.querySelector("#repair-requester-name");
      const urgent = document.querySelector("#repair-urgent");
      const attachmentInput = document.querySelector("#repair-attachment");
      const newMachineBox = document.querySelector("#repair-machine-new");
      const newMachineCode = document.querySelector("#repair-machine-new-code");
      const newMachineName = document.querySelector("#repair-machine-new-name");
      const newMachineMessage = document.querySelector("#repair-machine-new-message");
      const newMachineSave = document.querySelector("#repair-machine-new-save");
      const stepsApi = window.MNP_FORM_STEPS;
      const draftApi = window.MNP_FORM_DRAFT;
      const defaultRequester = `${employee.first_name} ${employee.last_name}`;
      // แผนกถูกเลือกให้เองตั้งแต่เปิดฟอร์ม และชื่อเครื่องตามเครื่องที่เลือก จึงไม่นับเป็นการกรอก ร่างที่มีแค่สองอย่างนี้ = ว่าง
      const drafts = draftApi.createDraftStore({ key: draftApi.draftKey("MT_REPAIR", employee.id), ignoreForEmpty: ["requester_name", "doc_type", "department_id", "machine_label"] });
      let selectedDepartmentId = "";
      let visibleMachines = [];
      let activeMachineIndex = -1;
      let submitted = false;
      // ตั้งค่าท้ายฟังก์ชัน (หลัง renderReview) — handler ทุกตัวเรียกใช้ตอนผู้ใช้กด จึงมีค่าแล้วเสมอ
      let stepper = null;

      // วันที่ต้องการใช้งานย้อนหลังไม่มีความหมาย: ตัวเลือกวันที่เริ่มที่วันนี้ (เวลาไทย) และตรวจซ้ำตอนส่ง (ร่างเก่าอาจมีวันที่ผ่านไปแล้ว)
      const todayIso = window.MNP_DATE_PICKER?.todayIso() ?? "";
      if (todayIso) neededDate.min = todayIso;
      window.MNP_DATE_PICKER?.enhance(neededDate);

      // ---- ช่องตรวจ: ช่องซ่อน (แผนก/เครื่อง) ตรวจเท่ากับช่องที่มองเห็น ข้อความไทยใต้ช่อง ----
      const RULES = [
        { name: "department_id", step: 1, required: true, message: "กรุณาเลือกแผนกของเครื่องที่เสีย" },
        { name: "machine_id", step: 1, required: true, message: "กรุณาเลือกเครื่องจักรจากรายการ หรือเพิ่มรหัสใหม่" },
        { name: "description", step: 1, required: true, minLength: 3, message: "กรุณาอธิบายอาการ อย่างน้อย 3 ตัวอักษร" },
        // อ่าน "วันนี้" ใหม่ทุกครั้งที่ตรวจ: ฟอร์มที่เปิดค้างข้ามเที่ยงคืนต้องไม่ปล่อยวันที่เมื่อวาน
        { name: "needed_date", step: 2, check: (value) => value >= (window.MNP_DATE_PICKER?.todayIso() ?? value), checkMessage: "วันที่ต้องการใช้งานต้องเป็นวันนี้หรือหลังจากนี้" },
      ];
      const currentValues = () => ({
        department_id: departmentInput.value,
        machine_id: machineInput.value,
        machine_label: machineInput.value ? machineSearch.value : "",
        doc_type: docTypeInput.value,
        description: description.value.trim() ? description.value : "",
        needed_date: neededDate.value,
        requester_name: requesterName.value.trim() === defaultRequester ? "" : requesterName.value,
        is_urgent: urgent.checked,
      });

      const renderReview = () => {
        const machine = machines.find((item) => item.id === machineInput.value);
        const department = departments.find((item) => item.id === departmentInput.value);
        const files = [...(attachmentInput.files ?? [])];
        const row = (label, value) => `<div class="definition"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
        form.querySelector("#repair-review").innerHTML =`<dl class="definition-grid review-grid">
          ${row("แผนก", escapeHtml(department ? `${department.displayCode} ${department.name}` : "—"))}
          ${row("เครื่องจักร", escapeHtml(machine ? machineLabel(machine) : "—"))}
          ${row("ประเภทเอกสาร", escapeHtml(docTypeLabels[docTypeInput.value] ?? docTypeInput.value))}
          ${row("ความเร่งด่วน", urgent.checked ? '<span class="badge urgent-flag">ด่วน</span>' : "ปกติ")}
          ${row("วันที่ต้องการใช้งาน", escapeHtml(neededDate.value ? window.MNP_DATE_PICKER.label(neededDate.value) : "ไม่ระบุ"))}
          ${row("ผู้แจ้ง", escapeHtml(requesterName.value.trim() || defaultRequester))}
          <div class="definition wide"><dt>อาการ / รายละเอียด</dt><dd class="review-text">${escapeHtml(description.value.trim())}</dd></div>
          ${row("ไฟล์แนบ", escapeHtml(files.length ? `${files.length} ไฟล์` : "ไม่มี"))}
        </dl>
        <p class="muted small">ตรวจแล้วกดส่ง หรือย้อนกลับไปแก้</p>`;
      };

      // ---- แผนกและเครื่องจักร ----
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
        closePopup(machineList);
        stepsApi.clearFieldError(form, "machine_id");
        saveDraft();
      };
      const renderMachineList = (query = "") => {
        const normalizedQuery = query.trim().toLocaleLowerCase("th-TH");
        visibleMachines = machines.filter((machine) => machine.department_id === selectedDepartmentId && (
          !normalizedQuery || `${machine.code} ${machine.name}`.toLocaleLowerCase("th-TH").includes(normalizedQuery)
        ));
        activeMachineIndex = -1;
        machineList.innerHTML = visibleMachines.length
          ? visibleMachines.map((machine, index) => `<button type="button" class="machine-option" id="repair-machine-option-${index}" role="option" aria-selected="false" data-machine-index="${index}"><strong>${escapeHtml(machine.code)}</strong>${machine.is_placeholder ? "" : `<span>${escapeHtml(machine.name)}</span>`}</button>`).join("")
          : `<div class="machine-empty">${normalizedQuery ? "ไม่พบเครื่องจักรที่ค้นหา" : "แผนกนี้ยังไม่มีเครื่องจักรในทะเบียน"}</div>`;
        const typedCode = query.trim();
        machineList.insertAdjacentHTML("beforeend", `<button type="button" class="machine-add" data-add-machine><span class="plus-icon" aria-hidden="true"></span> เพิ่มรหัสเครื่องจักรใหม่${typedCode ? ` "${escapeHtml(typedCode)}"` : ""}</button>`);
        machineList.hidden = false;
        machineSearch.setAttribute("aria-expanded", "true");
      };
      // แตะ/คลิกช่องเปิดรายการเสมอ (รวมตอนมีข้อความผิด และตอนช่องโฟกัสอยู่แล้ว) — iPhone ไม่มีลูกศรให้เปิดรายการ
      // ส่วนโฟกัสที่ไม่ได้มาจากการแตะ (เช่น ตรวจช่องไม่ผ่านแล้วระบบพามา) ไม่เปิดรายการทับข้อความผิด
      const openMachineList = () => {
        if (selectedDepartmentId) renderMachineList(machineInput.value ? "" : machineSearch.value);
      };
      // แตะช่องที่โฟกัสอยู่แล้วไม่เกิด focus ใหม่ จึงเปิดรายการจาก pointerdown เอง
      machineSearch.addEventListener("pointerdown", () => {
        if (document.activeElement === machineSearch && machineList.hidden) openMachineList();
      });
      // โฟกัสทุกแบบเปิดรายการ (แตะ แตะป้ายชื่อ Tab) ยกเว้นตอนตัวตรวจช่องพาโฟกัสมาเพราะไม่ผ่าน (bindStepper ทำเครื่องหมาย focusFromCheck)
      machineSearch.addEventListener("focus", () => {
        if (machineSearch.dataset.focusFromCheck === "1") return;
        openMachineList();
      });
      machineSearch.addEventListener("input", () => {
        machineInput.value = "";
        renderMachineList(machineSearch.value);
      });
      machineSearch.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { closePopup(machineList); return; }
        if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
        event.preventDefault();
        if (machineList.hidden) renderMachineList(machineInput.value ? "" : machineSearch.value);
        if (event.key === "ArrowDown") setActiveMachine(activeMachineIndex + 1);
        if (event.key === "ArrowUp") setActiveMachine(activeMachineIndex - 1);
        if (event.key === "Enter" && activeMachineIndex >= 0) chooseMachine(visibleMachines[activeMachineIndex]);
      });
      // กดค้างบนรายการไม่ให้ช่องค้นหาเสีย focus — คีย์บอร์ดมือถือไม่หุบแล้วเด้งกลับตอนเลือก
      machineList.addEventListener("mousedown", (event) => event.preventDefault());
      machineList.addEventListener("click", (event) => {
        if (event.target.closest("[data-add-machine]")) { openNewMachineForm(machineInput.value ? "" : machineSearch.value); return; }
        const option = event.target.closest("[data-machine-index]");
        if (!option) return;
        machineSearch.focus();
        chooseMachine(visibleMachines[Number(option.dataset.machineIndex)]);
      });

      // กำหนดรหัสเครื่องจักรเอง: บันทึกเข้า master ผ่าน app_create_machine (ตรวจสิทธิ์/รูปแบบ/รหัสซ้ำที่ฐานข้อมูล)
      // ฟอร์มนี้อยู่นอกกรอบ data-popup ของรายการเครื่อง จึงไม่ถูกกฎ closePopup ปิดตอนพิมพ์
      const closeNewMachineForm = () => {
        newMachineBox.hidden = true;
        newMachineMessage.innerHTML = "";
        newMachineCode.value = "";
        newMachineName.value = "";
      };
      const openNewMachineForm = (prefillCode = "") => {
        closePopup(machineList);
        machineInput.value = "";
        newMachineMessage.innerHTML = "";
        newMachineCode.value = prefillCode.trim();
        newMachineName.value = "";
        newMachineBox.hidden = false;
        (newMachineCode.value ? newMachineName : newMachineCode).focus();
      };
      const saveNewMachine = async () => {
        newMachineMessage.innerHTML = "";
        const code = newMachineCode.value.trim();
        const name = newMachineName.value.trim();
        if (!code) { newMachineMessage.innerHTML = `<div class="form-message error">กรุณาระบุรหัสเครื่องจักร</div>`; newMachineCode.focus(); return; }
        if (!name) { newMachineMessage.innerHTML = `<div class="form-message error">กรุณาระบุชื่อเครื่องจักร</div>`; newMachineName.focus(); return; }
        setButtonBusy(newMachineSave, true);
        try {
          const { data, error: createError } = await sb.rpc("app_create_machine", {
            p_department_id: selectedDepartmentId,
            p_code: code,
            p_name: name,
          });
          if (createError) throw createError;
          const saved = Array.isArray(data) ? data[0] : data;
          if (!saved?.id) throw new Error("MACHINE_NOT_FOUND");
          const machine = { id: saved.id, code: saved.code, name: saved.name, department_id: saved.department_id, is_placeholder: false };
          if (!machines.some((item) => item.id === machine.id)) machines.push(machine);
          chooseMachine(machine);
          closeNewMachineForm();
          showToast(saved.existed
            ? `รหัส ${machine.code} มีในทะเบียนแล้ว เลือกเครื่องเดิมให้ (${machine.name})`
            : `บันทึกเครื่องจักร ${machine.code} เข้าทะเบียนแล้ว ครั้งหน้าค้นหาเจอได้เลย`);
        } catch (saveError) {
          newMachineMessage.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(saveError))}</div>`;
        } finally {
          setButtonBusy(newMachineSave, false);
        }
      };
      newMachineSave.addEventListener("click", saveNewMachine);
      document.querySelector("#repair-machine-new-cancel").addEventListener("click", closeNewMachineForm);
      [newMachineCode, newMachineName].forEach((input) => input.addEventListener("keydown", (event) => {
        // Enter ในช่องนี้ต้องบันทึกเครื่อง ไม่ใช่ส่งทั้งใบแจ้งซ่อม
        if (event.key !== "Enter") return;
        event.preventDefault();
        saveNewMachine();
      }));

      const selectDepartment = async (departmentId, { focusMachine = true, keepMachine = false, fromUser = false } = {}) => {
        const button = document.querySelector(`#repair-department-picker [data-dept="${CSS.escape(departmentId)}"]`);
        if (!button) return;
        document.querySelectorAll("#repair-department-picker [data-dept]").forEach((node) => {
          node.classList.toggle("active", node === button);
          node.setAttribute("aria-pressed", String(node === button));
        });
        departmentInput.value = departmentId;
        selectedDepartmentId = departmentId;
        stepsApi.clearFieldError(form, "department_id");
        if (!keepMachine) {
          machineInput.value = "";
          machineSearch.value = "";
        }
        closeNewMachineForm();
        machineSearch.disabled = false;
        machineSearch.placeholder = "ค้นหารหัสหรือชื่อเครื่องจักร";
        if (focusMachine) {
          machineSearch.focus();
          renderMachineList();
        }
        // เลือกเองเท่านั้นที่นับเป็นการกรอก (แผนกเริ่มต้นหรือการคืนร่างไม่สร้างร่างใหม่)
        if (fromUser) saveDraft();
        setDocNumberBox("repair-doc-number", "…");
        try {
          const { data, error: peekError } = await sb.rpc("app_peek_repair_doc_number", { p_department_id: departmentId });
          if (peekError) throw peekError;
          setDocNumberBox("repair-doc-number", data);
        } catch {
          setDocNumberBox("repair-doc-number", "—");
        }
      };
      document.querySelectorAll("#repair-department-picker [data-dept]").forEach((button) => button.addEventListener("click", () => selectDepartment(button.dataset.dept, { fromUser: true })));

      const selectDocType = (value) => {
        docTypeInput.value = value;
        document.querySelectorAll("#repair-doctype-picker [data-doctype]").forEach((node) => {
          const active = node.dataset.doctype === value;
          node.classList.toggle("active", active);
          node.setAttribute("aria-pressed", String(active));
        });
      };
      document.querySelectorAll("#repair-doctype-picker [data-doctype]").forEach((button) => button.addEventListener("click", () => { selectDocType(button.dataset.doctype); saveDraft(); }));

      // ---- ร่างบนเครื่อง ----
      // หยุดไว้จนกว่าผู้ใช้จะตัดสินเรื่องร่างเดิม (ถ้ามี) และหลังส่งสำเร็จ
      const autosave = draftApi.createAutosave({ store: drafts, values: currentValues });
      function saveDraft() {
        autosave.schedule();
      }
      form.addEventListener("input", saveDraft);
      form.addEventListener("change", saveDraft);
      // ใส่ค่าทันที ไม่รอเลขที่เอกสาร (peek) ที่ตามมาทีหลัง ไม่งั้นค่าที่ผู้ใช้เริ่มพิมพ์ระหว่างรอจะถูกทับ
      const restoreDraft = (values) => {
        if (values.department_id) selectDepartment(values.department_id, { focusMachine: false });
        const machine = selectedDepartmentId && selectedDepartmentId === values.department_id
          ? machines.find((item) => item.id === values.machine_id && item.department_id === selectedDepartmentId)
          : null;
        if (machine) { machineInput.value = machine.id; machineSearch.value = machineLabel(machine); }
        if (Object.hasOwn(docTypeLabels, values.doc_type)) selectDocType(values.doc_type);
        description.value = values.description ?? "";
        neededDate.value = values.needed_date ?? "";
        neededDate.dispatchEvent(new Event("datepicker:refresh"));
        if (values.requester_name) requesterName.value = values.requester_name;
        urgent.checked = Boolean(values.is_urgent);
      };
      // แผนกเริ่มต้น = แผนกของผู้แจ้ง (ถ้าแจ้งซ่อมได้) โดยไม่เปิดแป้นพิมพ์บนมือถือ
      function selectDefaultDepartment() {
        if (departments.some((item) => item.id === employee.department_id)) selectDepartment(employee.department_id, { focusMachine: false });
      }
      const draft = drafts.load();
      // ระหว่างแถบถามเรื่องร่างยังเปิดอยู่ ฟอร์มยังไม่มีอะไรของผู้ใช้ ยกเลิกได้โดยไม่ถาม
      let draftPending = Boolean(draft);
      if (draft) {
        autosave.stop();
        draftApi.offerDraft({
          banner: document.querySelector("#repair-draft"),
          message: `มีร่างใบแจ้งซ่อมค้างจาก ${formatDate(new Date(draft.savedAt).toISOString(), true)}`,
          // ใช้ร่าง = ร่างเดิมยังอยู่จนกว่าจะแก้; เริ่มใหม่ = ลบร่าง และไม่สร้างใหม่จนกว่าจะกรอก
          onUse: () => { draftPending = false; autosave.start(); restoreDraft(draft.values); description.focus(); },
          onDiscard: () => { draftPending = false; autosave.start(); drafts.clear(); selectDefaultDepartment(); focusFirstStep(form); },
          // กรอกเองโดยไม่ตอบแถบ = เริ่มใบใหม่ (ไม่ย้ายโฟกัสหรือเปลี่ยนแผนกที่ผู้ใช้กำลังเลือก) ร่างเดิมถูกแทนด้วยสิ่งที่กรอก
          form,
          onEdit: () => { draftPending = false; autosave.start(); autosave.schedule(); },
          hasInput: () => Boolean(description.value.trim() || machineInput.value || neededDate.value || urgent.checked),
        });
      } else {
        selectDefaultDepartment();
      }

      // ยกเลิกเมื่อกรอกไว้แล้ว: ถามก่อนทิ้ง (ทิ้ง = ล้างร่างด้วย) — ส่งแล้ว (กำลังแนบไฟล์) ไม่มีอะไรให้ทิ้ง
      bindFormCancel(form, {
        title: "ทิ้งใบแจ้งซ่อมที่กรอกไว้?",
        isDirty: () => !submitted && !draftPending && Boolean(description.value.trim() || machineInput.value || neededDate.value || urgent.checked || attachmentInput.files?.length),
        onDiscard: () => { autosave.stop(); drafts.clear(); },
      });

      // ---- ส่ง ----
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const message = document.querySelector("#request-message");
        message.innerHTML = "";
        if (!stepper.check("all")) return;
        let attachments;
        try {
          attachments = optionalAttachments(attachmentInput.files);
        } catch (attachmentError) {
          stepper.goTo(2, { focus: false });
          stepsApi.clearFieldErrors(form);
          message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(attachmentError))}</div>`;
          attachmentInput.focus();
          return;
        }
        setFormBusy(form, true);
        let requestId;
        try {
          const { data, error: createError } = await sb.rpc("app_create_repair_request", {
            p_department_id: departmentInput.value,
            p_machine_id: machineInput.value,
            p_doc_type: docTypeInput.value,
            p_description: description.value.trim(),
            p_is_urgent: urgent.checked,
            p_needed_date: neededDate.value || null,
            p_requester_name: requesterName.value.trim() || null,
          });
          if (createError) throw createError;
          if (!data) throw new Error("REQUEST_NOT_CREATED");
          requestId = data;
        } catch (submitError) {
          // ส่งไม่ผ่าน: ทุกช่องยังอยู่ บอกในขั้นที่กำลังอยู่
          showFormSubmitError(form, message, submitError);
          return;
        }
        submitted = true;
        autosave.stop();
        drafts.clear();
        triggerNotificationEmails(requestId);
        const uploadWarning = await uploadAfterCreate(attachments, (file) => uploadRequestAttachment(requestId, file, employee.id), "แนบใหม่ได้ในหน้าใบแจ้งซ่อม");
        // ใบเสร็จหลังส่ง: เลขที่และขั้นที่รอ แทนการเด้งไปหน้าอื่นทันที
        const { requestNo, waitingOn } = await requestReceiptFacts(requestId);
        if (!card.isConnected) {
          showToast(requestNo ? `ส่งใบแจ้งซ่อม ${requestNo} แล้ว` : "ส่งใบแจ้งซ่อมแล้ว");
          return;
        }
        stepsApi.showReceipt(card, {
          title: "ส่งใบแจ้งซ่อมแล้ว", number: requestNo, waitingOn, warning: uploadWarning,
          viewHref: `#/request?id=${encodeURIComponent(requestId)}`, viewLabel: "ดูใบแจ้งซ่อม",
          againLabel: "แจ้งอีกใบ", onAgain: () => renderRoute(),
        });
      });

      stepper = stepsApi.bindStepper({ form, count: 3, rules: RULES, values: currentValues, onReview: renderReview, scrollTarget: card });
    },

    detailView({ request, type, steps, verifications, history, directory, progressSteps, assignedTechIds, employee }) {
      // ไฟล์ Excel ใช้ข้อมูลชุดเดียวกับที่ผู้ดูเห็นในหน้านี้ ทุกคนที่เปิดใบได้จึงดาวน์โหลดได้ (ดู modules/mt-form-export.js)
      // ช่องฟอร์มชุดเดียวกันส่งไปกับการซิงก์ด้วย ให้ชีต "เอกสาร" เติมฟอร์มจากเลขที่เอกสารได้ตรงกับไฟล์ที่ดาวน์โหลด
      // (apps-script/maintenance-backup/Code.gs)
      const formExport = window.MNP_MT_FORM_EXPORT;
      const nameOf = (personId) => (directory.has(personId) ? personName(directory, personId) : "");
      const formCells = formExport
        ? formExport.buildMtFormCells({ request, steps, verifications, history, technicianNames: assignedTechIds.map(nameOf), nameOf })
        : null;
      formExportPayload = formExport?.EXPORT_URL ? formCells : null;
      currentRequestNo = request.request_no ?? "";
      syncRepairOrderToAppsScript({
        ...buildAppsScriptOrder(request, steps, verifications, directory, assignedTechIds),
        formCells: formCells?.cells ?? null,
      });
      machineHistoryCurrent = window.MNP_MT_MACHINE_HISTORY.currentRow(request, assignedTechIds.map(nameOf));
      const { technicians, canAssign, canStartWork, canFinishWork, canVerify, canRecordProgress } = detailPermissions({ request, type, directory, assignedTechIds, employee });
      // ผู้แจ้งในใบ (ช่องที่กรอก) ขึ้นการ์ดเฉพาะเมื่อไม่ใช่บัญชีที่ส่งใบ ซึ่งบรรทัดใต้หัวใบบอกแล้ว ("โดย …")
      const requesterName = String(request.requester_name ?? "").trim();
      const showRequester = requesterName && requesterName !== personName(directory, request.requester_id);
      // มอบหมายช่าง: ขั้นรอมอบหมายเป็นงานหลักของหน้า (section) · หลังมอบหมายแล้วเป็นการแก้ไขที่พับไว้ท้ายหน้า ไม่บังงานที่ต้องทำจริง
      const assignOpen = request.status === "pending_assign"
        ? '<div class="detail-action" id="repair-assign"><h3>มอบหมายช่าง</h3>'
        : '<details class="card detail-section repair-assign-edit" id="repair-assign"><summary><h2>แก้ไขการมอบหมายช่าง</h2></summary>';
      const assignClose = request.status === "pending_assign" ? "</div>" : "</details>";
      const reassign = request.status !== "pending_assign";
      const dueCardShown = canRecordProgress && ["assigned", "in_progress"].includes(request.status);
      const assignSection = canAssign ? `${assignOpen}${request.status === "pending_assign" ? "" : '<p class="muted small">เปลี่ยนรายชื่อช่างหรือแก้ข้อมูลการซ่อมบำรุงได้จนกว่าใบจะปิด</p>'}<form id="assign-form" novalidate${reassign ? " data-reassign" : ""}${dueCardShown && request.work_expected_date ? ` data-expected="${escapeHtml(request.work_expected_date)}"` : ""}>
          <fieldset class="field" data-field="technician_ids"><legend>ช่างผู้รับผิดชอบ${REQUIRED}</legend><small>ติ๊กได้หลายคน อย่างน้อย 1 คน</small><div class="tech-picker">${technicians.map(([techId, person]) => `<label class="tech-option"><input type="checkbox" name="technician_ids" value="${escapeHtml(techId)}"${assignedTechIds.includes(techId) ? " checked" : ""}><span>${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}${person.job_title ? ` · ${escapeHtml(person.job_title)}` : ""}</span></label>`).join("") || `<p class="muted small">ยังไม่มีพนักงานในแผนกซ่อมบำรุง</p>`}</div></fieldset>
          <div class="field" data-field="execution_plan"><label for="assign-execution-plan">การดำเนินงาน${REQUIRED}</label><select class="select" id="assign-execution-plan" name="execution_plan" required><option value="">เลือกการดำเนินงาน</option>${Object.entries(executionPlanLabels).map(([value,label]) => `<option value="${value}"${request.execution_plan === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
          <div class="field" data-field="inspector_opinion"><label for="assign-opinion">ความคิดเห็นของช่างผู้ตรวจสอบ${REQUIRED}</label><select class="select" id="assign-opinion" name="inspector_opinion" required><option value="">เลือกความคิดเห็นของช่างผู้ตรวจสอบ</option>${Object.entries(inspectorOpinionLabels).map(([value,label]) => `<option value="${value}"${request.inspector_opinion === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
          <div class="field" data-field="work_started_date"><label for="assign-start-date">วันเริ่มงาน${reassign ? " (ถ้ามี)" : REQUIRED}</label><input class="input" id="assign-start-date" name="work_started_date" type="date" value="${escapeHtml(request.work_started_date ?? "")}"${reassign ? ' title="เว้นว่างไว้ ระบบคงวันเริ่มงานเดิม"' : " required"}></div>
          ${dueCardShown ? "" : `<div class="field" data-field="work_expected_date"><label for="assign-expected-date">กำหนดเสร็จ${reassign ? " (ถ้ามี)" : REQUIRED}</label><input class="input" id="assign-expected-date" name="work_expected_date" type="date" value="${escapeHtml(request.work_expected_date ?? "")}"${reassign ? "" : " required"}></div>`}
          ${reassign ? "" : extraFilesFieldHtml("assign-files")}
          <div class="form-actions"><button class="btn" type="submit">${request.status === "pending_assign" ? "มอบหมายงาน" : "บันทึกการเปลี่ยนแปลง"}</button></div>
        </form>${assignClose}` : "";
      return {
        // ประเภทเอกสาร (ใบแจ้งซ่อม/ใบคำร้อง) แทนชื่อโมดูลในบรรทัดใต้หัวใบ จึงไม่มีการ์ดประเภทเอกสารซ้ำ
        typeLabel: docTypeLabels[request.doc_type] ?? null,
        statusBadgeHtml: repairStatusBadge(request, steps),
        headerActionsHtml: formExportPayload ? window.MNP_MT_FORM_EXPORT.downloadButtonHtml("MT01-FM05") : "",
        facts: [
          requestFact("ช่างผู้รับผิดชอบ",
            assignedTechIds.map((techId) => personName(directory, techId)).join(", ") || "—",
            { icon: "user", tone: "success", wide: assignedTechIds.length > 1 }),
          ...(request.received_by_name ? [requestFact("ผู้จัดการที่รับใบ", request.received_by_name, { icon: "approve", tone: "cyan" })] : []),
          requestFact("เครื่องจักร", machineLabelOf(request.machine_code, request.machine_name) || "—", {
            icon: "machine",
            tone: "slate",
            ...(window.MNP_MT_MACHINE_HISTORY.hasMachineHistory(request, { employee, owningDepartmentId: type?.owning_department_id }) ? { action: "machine-history", actionLabel: "ดูประวัติการซ่อมของเครื่องนี้" } : {}),
          }),
          ...(showRequester ? [requestFact("ผู้แจ้ง", requesterName, { icon: "user", tone: "cyan" })] : []),
          // ใบด่วน (ความสำคัญสูงหรือติ๊กแจ้งด่วน) มีป้าย "ด่วน" ในบรรทัดหัวใบแล้ว ไม่บอกซ้ำในข้อมูลใบในการ์ด
          ...(request.needed_date ? [requestFact("วันที่ต้องการใช้งาน", formatDate(request.needed_date), { icon: "calendar", tone: "violet" })] : []),
          ...(request.assigned_at ? [requestFact("มอบหมายเมื่อ", `${formatDate(request.assigned_at, true)} โดย ${personName(directory, request.assigned_by)}`, { icon: "clock", tone: "cyan", wide: true })] : []),
          ...(request.work_expected_date && !(canRecordProgress && ["assigned", "in_progress"].includes(request.status)) ? [requestFact("กำหนดเสร็จ", formatDate(request.work_expected_date), { icon: "calendar", tone: "warning" })] : []),
          ...(request.work_started_date ? [requestFact("วันที่เริ่มงาน", formatDate(request.work_started_date), { icon: "calendar", tone: "primary" })] : []),
          ...(request.execution_plan ? [requestFact("การดำเนินงาน", executionPlanLabels[request.execution_plan] ?? request.execution_plan, { icon: "clipboard", tone: "success" })] : []),
          ...(request.inspector_opinion ? [requestFact("ความคิดเห็นของช่างผู้ตรวจสอบ", inspectorOpinionLabels[request.inspector_opinion] ?? request.inspector_opinion, { icon: "wrench", tone: "cyan" })] : []),
          // ผู้ตรวจรับเห็นผลการซ่อมในการ์ดตรวจรับเอง (ก่อนปุ่มผ่าน/ไม่ผ่าน) จึงไม่ซ้ำในการ์ดข้อมูลเพิ่มเติม
          ...(request.cause_analysis && !canVerify ? [requestFact("วิเคราะห์สาเหตุ", request.cause_analysis, { icon: "search", tone: "warning", wide: true })] : []),
          ...(request.parts_used && !canVerify ? [requestFact("อะไหล่ที่ใช้", request.parts_used, { icon: "box", tone: "slate", wide: true })] : []),
        ],
        sectionsHtml: `
        ${progressSteps.length ? `<section class="card"><h2>ความคืบหน้าระหว่างทาง</h2><p class="muted small">${canRecordProgress ? "กดบันทึกเมื่อแต่ละขั้นเสร็จจริง ระบบแจ้งผู้แจ้งและผู้จัดการแผนกให้อัตโนมัติ" : "ช่างผู้รับผิดชอบและผู้จัดการแผนกซ่อมบำรุงเท่านั้นที่บันทึกได้"}</p><div class="progress-steps">${progressSteps.map((step) => progressStepHtml(step, directory, canRecordProgress)).join("")}</div></section>` : ""}
        ${expectedDateSectionHtml(request, canRecordProgress)}
        ${canAssign && request.status !== "pending_assign" ? assignSection : ""}
`,
        // งานที่ต้องกรอกฟอร์ม (มอบหมาย จบงาน ตรวจรับพร้อมหมายเหตุ) อยู่ในการ์ด "สิ่งที่คุณต้องดำเนินการ" บนสุดของคอลัมน์ซ้าย (app.js)
        actionHtml: `${canAssign && request.status === "pending_assign" ? assignSection : ""}
        ${canFinishWork ? `<div class="detail-action" id="repair-finish"><h3>บันทึกผลและเสร็จสิ้นงาน</h3><form id="finish-form" novalidate>
          <div class="field" data-field="cause_analysis"><label for="finish-cause">วิเคราะห์สาเหตุ${REQUIRED}</label><textarea class="textarea" id="finish-cause" name="cause_analysis" minlength="3" maxlength="5000" required>${escapeHtml(request.cause_analysis ?? "")}</textarea></div>
          <div class="field parts-field"><label>รายการอะไหล่ / วัสดุที่ใช้ (ถ้ามี)</label><div class="table-wrap parts-table-wrap"><table class="parts-table"><thead><tr><th>ลำดับ</th><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคา (บาท)</th><th>ชื่อร้าน</th><th>หมายเหตุ</th><th></th></tr></thead><tbody id="finish-parts-rows">${(Array.isArray(request.parts_used_items) && request.parts_used_items.length ? request.parts_used_items : [{}]).map((item) => partsRowHtml(item)).join("")}</tbody></table></div><button type="button" class="btn secondary small" id="finish-parts-add"><span class="plus-icon" aria-hidden="true"></span> เพิ่มรายการ</button><p class="parts-attachment muted small">หรือแนบรูปใบเสร็จในช่องไฟล์ด้านล่างแทนการกรอกทีละแถว</p></div>
          ${extraFilesFieldHtml("finish-files", "รูปใบเสร็จ / ไฟล์เพิ่มเติม (ถ้ามี)")}
          <div class="form-actions"><button class="btn secondary" type="button" id="finish-save-button">บันทึกไว้ทำต่อ</button><button class="btn success" type="submit">เสร็จสิ้นงาน</button></div>
        </form></div>` : ""}
        ${canVerify ? `<div class="detail-action" id="repair-verify"><h3>ตรวจรับงาน</h3>${verifySummaryHtml(request)}<div class="field" data-field="verify_note"><label for="verify-note">หมายเหตุ <span class="field-required">(จำเป็นเมื่อไม่ผ่าน)</span></label><textarea class="textarea" id="verify-note" maxlength="1000"></textarea></div>${extraFilesFieldHtml("verify-files")}<div class="approval-actions"><button class="btn danger verify-button" data-result="fail">${uiIcon("close")} ไม่ผ่าน</button><button class="btn success verify-button" data-result="pass">${uiIcon("check")} ผ่าน</button></div></div>` : ""}`,
        // ปุ่มของขั้นที่ผู้ใช้ต้องทำอยู่ที่เดียวกับปุ่มอนุมัติ (app.js วางใน action-panel ของคอลัมน์ขวา มือถือเป็นแถบล่าง)
        asideHtml: `${canStartWork ? `<section class="card action-panel step-panel" id="repair-start-panel" aria-labelledby="repair-start-title"><div class="action-panel-head"><h2 id="repair-start-title">สิ่งที่คุณต้องดำเนินการ</h2></div><div class="approval-actions action-panel-buttons"><button class="btn is-primary start-work-button" title="กดเมื่อเริ่มลงมือซ่อมจริง">เริ่มงาน</button></div></section>` : ""}`,
      };
    },

    bindDetail({ id, params, employee }) {
      document.querySelector("#form-export")?.addEventListener("click", (event) => {
        if (formExportPayload) window.MNP_MT_FORM_EXPORT.downloadXlsx(event.currentTarget, formExportPayload, { showToast, friendlyError });
      });
      document.querySelector('[data-fact-action="machine-history"]')?.addEventListener("click", (event) => openMachineHistory(id, event.currentTarget, machineHistoryCurrent));
      // วันที่มอบหมายใช้ตัวเลือกวันที่แบบไทยเหมือนฟอร์มแจ้งซ่อม (พ.ศ.) — ช่องเดิมถูกซ่อนจึงตรวจ "จำเป็น" เองตอนส่ง (required ของเบราว์เซอร์ตรวจช่องที่ซ่อนไม่ได้)
      const assignForm = document.querySelector("#assign-form");
      if (assignForm && window.MNP_DATE_PICKER) {
        assignForm.querySelectorAll('input[type="date"]').forEach((input) => {
          input.required = false;
          window.MNP_DATE_PICKER.enhance(input);
        });
      }
      // ฟอร์มเลื่อนกำหนดเสร็จและเลื่อนวันของมาส่งใช้ปฏิทินเดียวกัน ทั้งสองฟอร์มตรวจค่าว่างเองตอนส่ง
      document.querySelectorAll('#expected-date-form input[type="date"], .progress-reschedule-form input[type="date"]').forEach((input) => {
        input.required = false;
        window.MNP_DATE_PICKER?.enhance(input);
      });
      clearRepairFieldErrorOnEdit(assignForm);
      clearRepairFieldErrorOnEdit(document.querySelector("#finish-form"));
      clearRepairFieldErrorOnEdit(document.querySelector("#verify-note")?.closest("section"));
      assignForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const technicianIds = values.getAll("technician_ids").map(String).filter(Boolean);
        const startDate = String(values.get("work_started_date") ?? "");
        const expectedDate = String(values.get("work_expected_date") ?? "");
        // แก้การมอบหมาย: วันที่ไม่บังคับ (ค่าว่างคงวันเดิม) แต่ถ้ากรอกทั้งสองช่องยังตรวจลำดับวันที่
        const rules = form.hasAttribute("data-reassign")
          ? ASSIGN_RULES.map((rule) => (["work_started_date", "work_expected_date"].includes(rule.name) ? { ...rule, required: false } : rule))
          : ASSIGN_RULES;
        const errors = window.MNP_FORM_STEPS.validate(rules, {
          technician_ids: technicianIds.length ? "selected" : "",
          execution_plan: String(values.get("execution_plan") ?? ""),
          inspector_opinion: String(values.get("inspector_opinion") ?? ""),
          work_started_date: startDate,
          work_expected_date: expectedDate,
        });
        // กำหนดเสร็จไม่อยู่ในฟอร์มนี้ (แก้ที่การ์ดกำหนดเสร็จ) แต่วันเริ่มงานต้องไม่หลังกำหนดเสร็จปัจจุบัน
        if (!errors.length && form.dataset.expected && startDate && startDate > form.dataset.expected) {
          errors.push({ name: "work_started_date", message: `วันเริ่มงานต้องไม่หลังกำหนดเสร็จ ${formatDate(form.dataset.expected)} · เลื่อนกำหนดเสร็จที่การ์ดกำหนดเสร็จก่อน` });
        }
        if (errors.length) return showRepairFieldErrors(form, errors);
        window.MNP_FORM_STEPS.clearFieldErrors(form);
        let files;
        try { files = readExtraFiles(form.elements.extra_files); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
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
          const warning = await uploadExtraFiles(id, files, employee.id);
          triggerNotificationEmails(id);
          showToast(warning || "บันทึกการมอบหมายเรียบร้อย", warning ? "error" : "success");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      });
      document.querySelectorAll(".progress-button").forEach((button) => button.addEventListener("click", async () => {
        setButtonBusy(button, true);
        try {
          const { error } = await sb.rpc("app_record_progress_step", { p_step_id: button.dataset.step, p_done_on: null });
          if (error) throw error;
          triggerNotificationEmails(id);
          showToast("บันทึกความคืบหน้าแล้ว");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setButtonBusy(button, false); }
      }));
      // หมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องเลือกก่อนว่ารับของทันที หรือระบุวันที่คาดว่าจะมาส่ง — สลับ
      // required/disabled ของช่องวันที่ตามตัวเลือกที่ติ๊กไว้ กันส่งฟอร์มไปครึ่งๆ กลางๆ
      document.querySelectorAll(".progress-order-form").forEach((form) => {
        const expectedInput = form.querySelector(".progress-expected-input");
        form.querySelectorAll('input[name="receipt_mode"]').forEach((radio) => radio.addEventListener("change", () => {
          const later = form.querySelector('input[name="receipt_mode"]:checked')?.value === "later";
          expectedInput.disabled = !later;
          if (!later) window.MNP_FORM_STEPS.clearFieldError(form, "expected_on");
          expectedInput.required = later;
          if (!later) expectedInput.value = "";
        }));
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const receivedNow = form.querySelector('input[name="receipt_mode"]:checked')?.value !== "later";
          const expectedOn = expectedInput.value || null;
          if (!receivedNow && !expectedOn) return showRepairFieldErrors(form, [{ name: "expected_on", message: "เลือกวันที่คาดว่าของจะมาส่ง" }]);
          let files;
          try { files = readExtraFiles(form.elements.extra_files); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
          setFormBusy(form, true);
          try {
            const { error } = await sb.rpc("app_record_progress_step", {
              p_step_id: form.dataset.step,
              p_done_on: null,
              p_received_now: receivedNow,
              p_expected_on: receivedNow ? null : expectedOn,
            });
            if (error) throw error;
            const warning = await uploadExtraFiles(id, files, employee.id);
            triggerNotificationEmails(id);
            showToast(warning || (receivedNow ? "บันทึกความคืบหน้าแล้ว — รับของครบพร้อมกัน" : "บันทึกความคืบหน้าแล้ว — ตั้งวันที่คาดว่าจะมาส่งไว้แล้ว"), warning ? "error" : "success");
            await renderRequestDetail(params);
          } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
        });
      });
      // "ของยังไม่มา" — เปิดฟอร์มเลื่อนวันที่คาดว่าจะมาส่งของหมุด "ของมาส่งเรียบร้อย"
      document.querySelectorAll(".progress-reschedule-toggle").forEach((button) => button.addEventListener("click", () => {
        const form = document.querySelector(`.progress-reschedule-form[data-step="${button.dataset.step}"]`);
        const open = Boolean(form?.classList.toggle("hidden") === false);
        button.setAttribute("aria-expanded", String(open));
      }));
      document.querySelectorAll(".progress-order-form, .progress-reschedule-form").forEach((form) => clearRepairFieldErrorOnEdit(form));
      document.querySelectorAll(".progress-reschedule-form").forEach((form) => form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const expectedOn = String(new FormData(form).get("expected_on") ?? "");
        if (!expectedOn) return showRepairFieldErrors(form, [{ name: "expected_on", message: "เลือกวันที่คาดว่าของจะมาส่งใหม่" }]);
        let files;
        try { files = readExtraFiles(form.elements.extra_files); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
        setFormBusy(form, true);
        try {
          const { error } = await sb.rpc("app_reschedule_progress_step", { p_step_id: form.dataset.step, p_expected_on: expectedOn });
          if (error) throw error;
          const warning = await uploadExtraFiles(id, files, employee.id);
          triggerNotificationEmails(id);
          showToast(warning || "เลื่อนวันที่คาดว่าจะมาส่งแล้ว", warning ? "error" : "success");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      }));
      // เปิดฟอร์มแล้วปุ่ม "แก้กำหนดเสร็จ" ซ่อน (ไม่ค้างป้ายเดิม) ปิดด้วย "ยกเลิก" แล้วโฟกัสกลับที่ปุ่ม
      const expectedToggle = document.querySelector("#expected-date-toggle");
      const expectedForm = document.querySelector("#expected-date-form");
      const setExpectedOpen = (open) => {
        if (!expectedToggle || !expectedForm) return;
        expectedForm.classList.toggle("hidden", !open);
        expectedToggle.classList.toggle("hidden", open);
        expectedToggle.setAttribute("aria-expanded", String(open));
        // ปฏิทินไทยซ่อนช่อง date จริงไว้ โฟกัสปุ่มของปฏิทินก่อน (ไม่มีปฏิทินจึงโฟกัสช่องเอง)
        if (open) (expectedForm.querySelector('[data-field="expected_date"] button') ?? expectedForm.querySelector("#expected-date-input"))?.focus();
        else {
          // reset ล้างแค่ค่าในช่องที่ซ่อน ปุ่มปฏิทินไทยต้องวาดข้อความใหม่ด้วย
          expectedForm.reset();
          expectedForm.elements.expected_date?.dispatchEvent(new Event("datepicker:refresh"));
          window.MNP_FORM_STEPS?.clearFieldErrors(expectedForm);
          expectedToggle.focus();
        }
      };
      expectedToggle?.addEventListener("click", () => setExpectedOpen(true));
      document.querySelector("#expected-date-cancel")?.addEventListener("click", () => setExpectedOpen(false));
      clearRepairFieldErrorOnEdit(expectedForm);
      document.querySelector("#expected-date-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const expectedDate = String(values.get("expected_date") ?? "");
        if (!expectedDate) return showRepairFieldErrors(form, [{ name: "expected_date", message: "เลือกกำหนดเสร็จใหม่" }]);
        const note = String(values.get("note") ?? "").trim();
        let files;
        try { files = readExtraFiles(form.elements.extra_files); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
        setFormBusy(form, true);
        try {
          const { error } = await sb.rpc("app_reschedule_repair_expected_date", {
            p_request_id: id,
            p_expected_date: expectedDate,
            p_note: note || null,
          });
          if (error) throw error;
          const warning = await uploadExtraFiles(id, files, employee.id);
          triggerNotificationEmails(id);
          showToast(warning || "แก้กำหนดเสร็จแล้ว", warning ? "error" : "success");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      });
      // เริ่มงาน เสร็จสิ้นงาน และตรวจรับ: กดแล้วขึ้นยืนยัน/ยกเลิก (confirmStepAction ใน app.js) ยืนยันแล้วส่งทันที ไม่มีนับถอยหลัง
      // ผู้ใช้ย้ายหน้าไประหว่างนับแล้ว: ส่งต่อ ไม่วาดใบเดิมทับหน้าที่เปิดอยู่ และข้อความบอกเลขที่ใบ (อยู่หน้าอื่นแล้ว)
      const stepToast = (stillHere, requestNo, text) => (stillHere() ? text : `${requestNo}: ${text}`);
      document.querySelector(".start-work-button")?.addEventListener("click", (event) => {
        const requestNo = currentRequestNo;
        confirmStepAction(event.currentTarget.closest(".approval-actions"), {
          label: "เริ่มงาน", requestNo, consequence: "สถานะเป็นกำลังซ่อม", trigger: event.currentTarget,
          send: async ({ stillHere }) => {
            try {
              const { error } = await sb.rpc("app_start_repair_work", { p_request_id: id });
              if (error) throw error;
              triggerNotificationEmails(id);
              showToast(stepToast(stillHere, requestNo, "เริ่มงานแล้ว"));
              if (stillHere()) { await renderRequestDetail(params); focusDetailHeading(); }
              return true;
            } catch (error) { showToast(stepToast(stillHere, requestNo, friendlyError(error)), "error"); return false; }
          },
        });
      });
      renumberPartsRows(document.querySelector("#finish-parts-rows"));
      document.querySelector("#finish-parts-add")?.addEventListener("click", () => {
        const container = document.querySelector("#finish-parts-rows");
        container?.insertAdjacentHTML("beforeend", partsRowHtml());
        renumberPartsRows(container);
      });
      document.querySelector("#finish-parts-rows")?.addEventListener("click", (event) => {
        const container = document.querySelector("#finish-parts-rows");
        const restoreButton = event.target.closest(".parts-row-restore");
        if (restoreButton) {
          const note = restoreButton.closest(".parts-row-undo");
          const row = note.previousElementSibling;
          row.hidden = false;
          row.classList.replace("parts-row-removed", "parts-row");
          note.remove();
          renumberPartsRows(container);
          row.querySelector("input")?.focus();
          return;
        }
        const removeButton = event.target.closest(".parts-row-remove");
        if (!removeButton) return;
        const row = removeButton.closest(".parts-row");
        const name = row.querySelector('[data-part-field="name"]').value.trim();
        // แถวที่กรอกแล้ว: ซ่อนไว้พร้อมปุ่มเลิกทำ (ไม่ใช่ .parts-row จึงไม่ส่งไปกับฟอร์ม) · แถวว่างลบทิ้งเลย
        if ([...row.querySelectorAll("input")].some((input) => input.value.trim())) {
          row.hidden = true;
          row.classList.replace("parts-row", "parts-row-removed");
          row.insertAdjacentHTML("afterend", `<tr class="parts-row-undo"><td colspan="8"><span role="status">ลบ${name ? ` "${escapeHtml(name)}" ` : "รายการ"}แล้ว</span> <button type="button" class="btn secondary small parts-row-restore">เลิกทำ</button></td></tr>`);
          row.nextElementSibling.querySelector(".parts-row-restore").focus();
        } else {
          row.remove();
        }
        // ฟอร์มมีแถวกรอกอย่างน้อยหนึ่งแถวเสมอ
        if (!container.querySelector(".parts-row")) container.insertAdjacentHTML("beforeend", partsRowHtml());
        renumberPartsRows(container);
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
        let files;
        try { files = readExtraFiles(form.elements.extra_files); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
        setFormBusy(form, true);
        try {
          const { error } = await sb.rpc("app_save_repair_work_progress", {
            p_request_id: id,
            p_cause_analysis: document.querySelector("#finish-cause").value.trim(),
            p_parts_used_items: collectFinishPartsUsedItems(),
          });
          if (error) throw error;
          const warning = await uploadExtraFiles(id, files, employee.id);
          showToast(warning || "บันทึกข้อมูลแล้ว", warning ? "error" : "success");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      });
      // เสร็จสิ้นงาน: ตรวจช่องก่อน แล้วยืนยัน · ช่องในฟอร์มล็อกระหว่างยืนยัน ค่าที่ส่งจึงเป็นค่าบนจอตอนกดยืนยัน
      document.querySelector("#finish-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const finishErrors = window.MNP_FORM_STEPS.validate(FINISH_RULES, { cause_analysis: String(values.get("cause_analysis") ?? "") });
        if (finishErrors.length) return showRepairFieldErrors(form, finishErrors);
        window.MNP_FORM_STEPS.clearFieldErrors(form);
        try { readExtraFiles(form.elements.extra_files); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
        const requestNo = currentRequestNo;
        confirmStepAction(form.querySelector(".form-actions"), {
          label: "เสร็จสิ้นงาน", requestNo, consequence: "ส่งให้ผู้แจ้งตรวจรับ",
          lock: [...form.elements].filter((node) => !node.closest(".form-actions")), trigger: form.querySelector('button[type="submit"]'),
          send: async ({ stillHere }) => {
            try {
              const files = readExtraFiles(form.elements.extra_files);
              setFormBusy(form, true);
              const { error } = await sb.rpc("app_finish_repair_work", {
                p_request_id: id,
                p_cause_analysis: document.querySelector("#finish-cause").value.trim(),
                p_parts_used_items: collectFinishPartsUsedItems(),
              });
              if (error) throw error;
              const warning = await uploadExtraFiles(id, files, employee.id);
              triggerNotificationEmails(id);
              showToast(stepToast(stillHere, requestNo, warning || "บันทึกผลการซ่อมแล้ว ส่งให้ผู้แจ้งตรวจรับ"), warning ? "error" : "success");
              if (stillHere()) { await renderRequestDetail(params); focusDetailHeading(); }
              return true;
            } catch (error) { showToast(stepToast(stillHere, requestNo, friendlyError(error)), "error"); setFormBusy(form, false); return false; }
          },
        });
      });
      // ตรวจรับ: ตรวจหมายเหตุก่อน แล้วยืนยัน (บรรทัดยืนยันทวนหมายเหตุ) · ผ่าน = ปิดงาน ไม่ผ่าน = ส่งกลับให้ช่าง
      document.querySelectorAll(".verify-button").forEach((button) => button.addEventListener("click", () => {
        const result = button.dataset.result;
        const pass = result === "pass";
        const note = document.querySelector("#verify-note")?.value.trim() ?? "";
        // ปุ่มอยู่ในแถบตัดสินใจ ช่องหมายเหตุและไฟล์อยู่ในการ์ดตรวจรับ
        const section = document.querySelector("#repair-verify");
        window.MNP_FORM_STEPS?.clearFieldErrors(section);
        if (!pass && note.length < 3) return showRepairFieldErrors(section, [{ name: "verify_note", message: "ระบุสาเหตุที่ไม่ผ่านการตรวจรับอย่างน้อย 3 ตัวอักษร" }]);
        let files;
        try { files = readExtraFiles(document.querySelector("#verify-files")); } catch (fileError) { return showToast(friendlyError(fileError), "error"); }
        const requestNo = currentRequestNo;
        confirmStepAction(button.closest(".approval-actions"), {
          label: pass ? "ผ่านการตรวจรับ" : "ไม่ผ่านการตรวจรับ", requestNo,
          consequence: pass ? "ปิดงาน" : "ส่งกลับให้ช่างซ่อมเพิ่มเติม", tone: pass ? "success" : "danger", echo: note,
          // ปุ่ม × ของตัวอย่างไฟล์ก็ล็อก ไฟล์ที่ส่งจึงตรงกับที่เห็น
          lock: [document.querySelector("#verify-note"), document.querySelector("#verify-files"), ...section.querySelectorAll(".attachment-remove")], trigger: button,
          send: async ({ stillHere }) => {
            try {
              const { error } = await sb.rpc("app_verify_repair", { p_request_id: id, p_result: result, p_note: note || null });
              if (error) throw error;
              const warning = await uploadExtraFiles(id, files, employee.id);
              triggerNotificationEmails(id);
              showToast(stepToast(stillHere, requestNo, warning || (pass ? "ยืนยันผ่านการตรวจรับแล้ว" : "ส่งกลับให้ซ่อมเพิ่มเติมแล้ว")), warning ? "error" : "success");
              if (stillHere()) { await renderRequestDetail(params); focusDetailHeading(); }
              return true;
            } catch (error) { showToast(stepToast(stillHere, requestNo, friendlyError(error)), "error"); return false; }
          },
        });
      }));
    },
  };
})();
