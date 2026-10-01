// โมดูลใบคำร้อง/แจ้งซ่อม MT (MT_REPAIR) ของ Pilot Web
//
// แยกจาก app.js เฉพาะส่วนที่เป็นของ MT: ฟอร์มแจ้งซ่อม (แผนก/เครื่องจักร/ประเภทเอกสาร), ข้อมูลและ
// ส่วนงานช่างในหน้ารายละเอียด (มอบหมายช่าง, หมุดความคืบหน้า, เริ่มงาน, บันทึกผล/อะไหล่, ตรวจรับ)
// และการซิงก์สำเนาสำรองไปชีต Maintenance-MT ส่วน workflow/สิทธิ์ทั้งหมดอยู่ที่ฐานข้อมูล
// (app_create_repair_request, app_assign_repair_technician, app_start_repair_work, ...)
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — ฟังก์ชันข้างในเรียก helper/ค่าคงที่ของ app.js
// (sb, escapeHtml, showToast, friendlyError, setFormBusy, closePopup, statusLabels,
// executionPlanLabels, inspectorOpinionLabels, renderRequestDetail ฯลฯ) ได้เพราะ hook ทุกตัวถูก
// เรียกหลัง app.js โหลดเสร็จแล้วเท่านั้น ห้ามเรียกของ app.js ตอนโหลดไฟล์นี้
//
// การคำนวณสิทธิ์ในไฟล์นี้ใช้แค่ตัดสินว่าจะแสดงปุ่มไหน ฐานข้อมูลเป็นตัวบังคับสิทธิ์จริง
(function registerMtRepairModule() {
  // สำรองข้อมูลใบแจ้งซ่อมไปชีต Maintenance-MT เดิม (แค่บันทึก/รายงาน — Supabase ยังเป็นฐานข้อมูลหลัก
  // และเป็นตัวบังคับสิทธิ์/workflow ทั้งหมด) ดู syncRepairOrderToAppsScript ท้ายไฟล์นี้
  const APPS_SCRIPT_SYNC_URL = "https://script.google.com/macros/s/AKfycbwfHj4_rNUfU9ZB4xjOpyJPxQSHucoT1baeJ0AFGaz46olWJ8UXU_pBLnKpCwG6KHprqA/exec";

  const docTypeLabels = { request: "ใบคำร้อง", repair: "ใบแจ้งซ่อม" };

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
    if (!stepName) return statusBadge(request.status);
    const short = approverShortNames[stepName] ?? stepName;
    const label = `${statusLabels[request.status] ?? request.status} (${short})`;
    return `<span class="badge ${escapeHtml(request.status)}">${escapeHtml(label)}</span>`;
  }

  // แถวกรอกอะไหล่/วัสดุหนึ่งรายการในฟอร์มบันทึกผลการซ่อม — โครงเดียวกับ maintRecord.parts[] ของ
  // ระบบ Maintanance-MT เดิม (name/qty/unit/price/shop/note) ใช้ซ้ำทั้งตอนสร้างแถวแรกและกด "+ เพิ่มรายการ"
  // เรนเดอร์เป็นแถวตาราง (ลำดับ/รายการ/จำนวน/หน่วย/ราคา/ชื่อร้าน/หมายเหตุ) ให้หน้าตาตรงกับฟอร์มกระดาษเดิม
  function partsRowHtml(item = {}) {
    return `<tr class="parts-row">
      <td class="parts-row-no"></td>
      <td><input class="input" type="text" maxlength="200" placeholder="รายการอะไหล่/วัสดุที่ใช้" aria-label="รายการ" data-part-field="name" value="${escapeHtml(item.name ?? "")}"></td>
      <td><input class="input" type="text" maxlength="50" placeholder="จำนวน" aria-label="จำนวน" data-part-field="qty" value="${escapeHtml(item.qty ?? "")}"></td>
      <td><input class="input" type="text" maxlength="50" placeholder="หน่วย" aria-label="หน่วย" data-part-field="unit" value="${escapeHtml(item.unit ?? "")}"></td>
      <td><input class="input" type="text" maxlength="50" placeholder="ราคา" aria-label="ราคา" data-part-field="price" value="${escapeHtml(item.price ?? "")}"></td>
      <td><input class="input" type="text" maxlength="200" placeholder="ชื่อร้าน" aria-label="ชื่อร้าน" data-part-field="shop" value="${escapeHtml(item.shop ?? "")}"></td>
      <td><input class="input" type="text" maxlength="500" placeholder="หมายเหตุ" aria-label="หมายเหตุ" data-part-field="note" value="${escapeHtml(item.note ?? "")}"></td>
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
          <form class="progress-order-form" data-step="${escapeHtml(step.id)}">
            <div class="progress-choice">
              <label class="progress-choice-option"><input type="radio" name="receipt_mode" value="now" checked> รับของทันที (ได้ของพร้อมสั่งซื้อ)</label>
              <label class="progress-choice-option"><input type="radio" name="receipt_mode" value="later"> ระบุวันที่คาดว่าของจะมาส่ง</label>
            </div>
            <input class="input progress-expected-input" type="date" name="expected_on" disabled>
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
          <button type="button" class="btn secondary small progress-reschedule-toggle" data-step="${escapeHtml(step.id)}">ของยังไม่มา เลื่อนวันที่คาดว่าจะมาส่ง</button>
          <form class="progress-reschedule-form hidden" data-step="${escapeHtml(step.id)}">
            <input class="input" type="date" name="expected_on" required>
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

  const machineLabel = (machine) => machine.is_placeholder ? machine.code : `${machine.code} — ${machine.name}`;

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

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.MT_REPAIR = {
    code: "MT_REPAIR",
    enabled: true,
    label: "ใบคำร้อง/แจ้งซ่อม MT",
    theme: ["#fb7185", "#be123c"],

    // แผนกที่แจ้งซ่อมได้ + เครื่องจักร — โหลดครั้งเดียวต่อการเปิดหน้าสร้างคำร้อง
    async prepareForm({ sb }) {
      const [departmentsResult, machinesResult] = await Promise.all([
        sb.from("departments").select("id,code,name_th").eq("is_active", true).eq("is_repair_site", true).order("code"),
        sb.from("machines").select("id,code,name,department_id,is_placeholder").eq("is_active", true).order("sort_order"),
      ]);
      if (departmentsResult.error) throw departmentsResult.error;
      if (machinesResult.error) throw machinesResult.error;
      const availableDepartments = new Map((departmentsResult.data ?? []).map((item) => [item.code, item]));
      const departments = REPAIR_DEPARTMENT_OPTIONS
        .map((option) => ({ ...availableDepartments.get(option.sourceCode), ...option }))
        .filter((item) => item.id);
      return { departments, machines: machinesResult.data ?? [] };
    },

    renderCreateForm({ departments }, { employee }) {
      return `
        <section class="card" style="max-width:900px;margin:auto"><div id="request-message"></div><form id="repair-form">
          <div class="field full">${docNumberBoxHtml("repair-doc-number")}</div>
          <div class="field full">
            <label>แผนก</label>
            <input type="hidden" id="repair-department" name="department_id" required>
            <div class="repair-department-grid" id="repair-department-picker">${departments.map((item) => `<button type="button" class="repair-department-card" data-dept="${escapeHtml(item.id)}" data-dept-code="${escapeHtml(item.sourceCode)}" aria-pressed="false"><strong>${escapeHtml(item.displayCode)}</strong><span>${escapeHtml(item.name)}</span></button>`).join("")}</div>
          </div>
          <div class="form-grid">
            <div class="field full">
              <label for="repair-machine-search">เครื่องจักร</label>
              <input type="hidden" id="repair-machine" name="machine_id" required>
              <div class="machine-combobox" id="repair-machine-combobox">
                <input class="input machine-search-input" id="repair-machine-search" type="search" placeholder="เลือกแผนกก่อน" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="repair-machine-list" aria-expanded="false" disabled>
                <span class="machine-search-icon" aria-hidden="true">⌕</span>
                <div class="machine-listbox" id="repair-machine-list" role="listbox" data-popup hidden></div>
              </div>
              <small>ค้นหาด้วยรหัสหรือชื่อเครื่องจักร แล้วเลือกจากรายการ</small>
            </div>
            <div class="field full">
              <label>ประเภทเอกสาร</label>
              <input type="hidden" id="repair-doc-type" name="doc_type" value="repair" required>
              <div class="filters" id="repair-doctype-picker">
                <button type="button" class="filter active" data-doctype="repair">${escapeHtml(docTypeLabels.repair)}</button>
                <button type="button" class="filter" data-doctype="request">${escapeHtml(docTypeLabels.request)}</button>
              </div>
            </div>
            <div class="field full"><label for="repair-description">รายละเอียด</label><textarea class="textarea" id="repair-description" name="description" minlength="3" maxlength="5000" required></textarea></div>
            <div class="field full"><label for="repair-attachment">ไฟล์แนบ (ถ้ามี)</label><input class="input" id="repair-attachment" name="attachment" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,.xlsx"><small>สูงสุด 10 MB · JPG, PNG, WebP, PDF, TXT, DOCX, XLSX</small></div>
            <div class="field"><label for="repair-needed-date">วันที่ต้องการใช้งาน (ถ้ามี)</label><input class="input" id="repair-needed-date" name="needed_date" type="date"></div>
            <div class="field"><label for="repair-requester-name">ชื่อผู้แจ้ง</label><input class="input" id="repair-requester-name" name="requester_name" maxlength="120" value="${escapeHtml(`${employee.first_name} ${employee.last_name}`)}"></div>
            <div class="field full"><label class="checkbox-label"><input type="checkbox" id="repair-urgent" name="is_urgent"> แจ้งด่วน</label></div>
          </div>
          <div class="form-actions"><a class="btn secondary" href="#/requests">ยกเลิก</a><button class="btn" type="submit">ส่งใบแจ้งซ่อม</button></div>
        </form></section>`;
    },

    bindCreateForm({ machines }, { employee }) {
      const departmentInput = document.querySelector("#repair-department");
      const machineInput = document.querySelector("#repair-machine");
      const machineSearch = document.querySelector("#repair-machine-search");
      const machineList = document.querySelector("#repair-machine-list");
      const docTypeInput = document.querySelector("#repair-doc-type");
      let selectedDepartmentId = "";
      let visibleMachines = [];
      let activeMachineIndex = -1;

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
      };

      const renderMachineList = (query = "") => {
        const normalizedQuery = query.trim().toLocaleLowerCase("th-TH");
        visibleMachines = machines.filter((machine) => machine.department_id === selectedDepartmentId && (
          !normalizedQuery || `${machine.code} ${machine.name}`.toLocaleLowerCase("th-TH").includes(normalizedQuery)
        ));
        activeMachineIndex = -1;
        machineList.innerHTML = visibleMachines.length
          ? visibleMachines.map((machine, index) => `<button type="button" class="machine-option" id="repair-machine-option-${index}" role="option" aria-selected="false" data-machine-index="${index}"><strong>${escapeHtml(machine.code)}</strong>${machine.is_placeholder ? "" : `<span>${escapeHtml(machine.name)}</span>`}</button>`).join("")
          : `<div class="machine-empty">ไม่พบเครื่องจักรที่ค้นหา</div>`;
        machineList.hidden = false;
        machineSearch.setAttribute("aria-expanded", "true");
      };

      machineSearch.addEventListener("focus", () => {
        if (selectedDepartmentId) renderMachineList(machineInput.value ? "" : machineSearch.value);
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
        const option = event.target.closest("[data-machine-index]");
        if (!option) return;
        machineSearch.focus();
        chooseMachine(visibleMachines[Number(option.dataset.machineIndex)]);
      });

      document.querySelectorAll("#repair-department-picker [data-dept]").forEach((button) => button.addEventListener("click", async () => {
        document.querySelectorAll("#repair-department-picker [data-dept]").forEach((node) => {
          node.classList.remove("active");
          node.setAttribute("aria-pressed", "false");
        });
        button.classList.add("active");
        button.setAttribute("aria-pressed", "true");
        const departmentId = button.dataset.dept;
        departmentInput.value = departmentId;
        selectedDepartmentId = departmentId;
        machineInput.value = "";
        machineSearch.value = "";
        machineSearch.disabled = false;
        machineSearch.placeholder = "ค้นหารหัสหรือชื่อเครื่องจักร";
        machineSearch.focus();
        renderMachineList();
        setDocNumberBox("repair-doc-number", "…");
        try {
          const { data, error: peekError } = await sb.rpc("app_peek_repair_doc_number", { p_department_id: departmentId });
          if (peekError) throw peekError;
          setDocNumberBox("repair-doc-number", data);
        } catch {
          setDocNumberBox("repair-doc-number", "—");
        }
      }));

      document.querySelectorAll("#repair-doctype-picker [data-doctype]").forEach((button) => button.addEventListener("click", () => {
        document.querySelectorAll("#repair-doctype-picker [data-doctype]").forEach((node) => node.classList.remove("active"));
        button.classList.add("active");
        docTypeInput.value = button.dataset.doctype;
      }));

      document.querySelector("#repair-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.querySelector("#request-message");
        message.innerHTML = "";
        if (!departmentInput.value) { message.innerHTML = `<div class="form-message error">กรุณาเลือกแผนก</div>`; return; }
        if (!machineInput.value) { message.innerHTML = `<div class="form-message error">กรุณาเลือกเครื่องจักรจากรายการ</div>`; machineSearch.focus(); return; }
        const values = new FormData(form);
        let attachment;
        try {
          attachment = optionalAttachment(values.get("attachment"));
        } catch (attachmentError) {
          message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(attachmentError))}</div>`;
          return;
        }
        setFormBusy(form, true);
        try {
          const { data, error: createError } = await sb.rpc("app_create_repair_request", {
            p_department_id: departmentInput.value,
            p_machine_id: String(values.get("machine_id") ?? ""),
            p_doc_type: docTypeInput.value,
            p_description: String(values.get("description") ?? "").trim(),
            p_is_urgent: form.querySelector("#repair-urgent").checked,
            p_needed_date: String(values.get("needed_date") ?? "") || null,
            p_requester_name: String(values.get("requester_name") ?? "").trim() || null,
          });
          if (createError) throw createError;
          triggerNotificationEmails(data);
          if (attachment) {
            try {
              await uploadRequestAttachment(data, attachment, employee.id);
            } catch {
              showToast(`สร้างคำร้องแล้ว แต่แนบไฟล์ไม่สำเร็จ · กรุณาแนบใหม่ในหน้ารายละเอียด`, "error");
              go(`request?id=${encodeURIComponent(data)}`);
              return;
            }
          }
          showToast(attachment ? "ส่งใบแจ้งซ่อมและแนบไฟล์สำเร็จ" : "ส่งใบแจ้งซ่อมสำเร็จ");
          go(`request?id=${encodeURIComponent(data)}`);
        } catch (submitError) {
          message.innerHTML = `<div class="form-message error">${escapeHtml(friendlyError(submitError))}</div>`;
          setFormBusy(form, false);
        }
      });
    },

    detailView({ request, type, steps, verifications, directory, progressSteps, assignedTechIds, employee }) {
      syncRepairOrderToAppsScript(buildAppsScriptOrder(request, steps, verifications, directory, assignedTechIds));
      const { technicians, canAssign, canStartWork, canFinishWork, canVerify, canRecordProgress } = detailPermissions({ request, type, directory, assignedTechIds, employee });
      return {
        statusBadgeHtml: repairStatusBadge(request, steps),
        facts: [
          requestFact("ช่างผู้รับผิดชอบ",
            assignedTechIds.map((techId) => personName(directory, techId)).join(", ") || "—",
            { icon: "◎", tone: "success", wide: assignedTechIds.length > 1 }),
          requestFact("ประเภทเอกสาร", docTypeLabels[request.doc_type] ?? request.doc_type ?? "—", { icon: "▤", tone: "violet" }),
          ...(request.received_by_name ? [requestFact("ผู้จัดการที่รับใบ", request.received_by_name, { icon: "✓", tone: "cyan" })] : []),
          requestFact("เครื่องจักร", `${request.machine_code ?? "—"}${request.machine_name && request.machine_name !== request.machine_code ? ` — ${request.machine_name}` : ""}`, { icon: "⚙", tone: "slate" }),
          requestFact("ผู้แจ้ง", request.requester_name ?? "—", { icon: "◉", tone: "cyan" }),
          requestFact("ความเร่งด่วน", request.is_urgent ? "ด่วน" : "ปกติ", { icon: "↗", tone: request.is_urgent ? "danger" : "success" }),
          ...(request.needed_date ? [requestFact("วันที่ต้องการใช้งาน", formatDate(request.needed_date), { icon: "◷", tone: "violet" })] : []),
          ...(request.assigned_at ? [requestFact("มอบหมายเมื่อ", `${formatDate(request.assigned_at, true)} โดย ${personName(directory, request.assigned_by)}`, { icon: "→", tone: "cyan", wide: true })] : []),
          ...(request.work_expected_date ? [requestFact("กำหนดเสร็จ", formatDate(request.work_expected_date), { icon: "◷", tone: "warning" })] : []),
          ...(request.work_started_date ? [requestFact("วันที่เริ่มงาน", formatDate(request.work_started_date), { icon: "▶", tone: "primary" })] : []),
          ...(request.execution_plan ? [requestFact("การดำเนินงาน", executionPlanLabels[request.execution_plan] ?? request.execution_plan, { icon: "✓", tone: "success" })] : []),
          ...(request.inspector_opinion ? [requestFact("แนวทางการซ่อม", inspectorOpinionLabels[request.inspector_opinion] ?? request.inspector_opinion, { icon: "◇", tone: "cyan" })] : []),
          ...(request.cause_analysis ? [requestFact("วิเคราะห์สาเหตุ", request.cause_analysis, { icon: "?", tone: "warning", wide: true })] : []),
          ...(request.parts_used ? [requestFact("อะไหล่ที่ใช้", request.parts_used, { icon: "⌁", tone: "slate", wide: true })] : []),
        ],
        sectionsHtml: `        ${canAssign ? `<section class="card"><h2>${request.status === "pending_assign" ? "มอบหมายช่าง" : "แก้ไขการมอบหมายช่าง"}</h2><p class="muted small">${request.status === "pending_assign" ? "บันทึกข้อมูลซ่อมบำรุงและเลือกช่าง — ติ๊กได้มากกว่าหนึ่งคน" : "เปลี่ยนรายชื่อช่างหรือแก้ข้อมูลการซ่อมบำรุงได้จนกว่าใบจะปิด"}</p><form id="assign-form">
          <div class="field"><label>ช่างผู้รับผิดชอบ</label><small>ติ๊กช่างที่รับผิดชอบใบนี้ อย่างน้อย 1 คน</small><div class="tech-picker">${technicians.map(([techId, person]) => `<label class="tech-option"><input type="checkbox" name="technician_ids" value="${escapeHtml(techId)}"${assignedTechIds.includes(techId) ? " checked" : ""}><span>${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}${person.job_title ? ` · ${escapeHtml(person.job_title)}` : ""}</span></label>`).join("") || `<p class="muted small">ยังไม่มีพนักงานในแผนกซ่อมบำรุง</p>`}</div></div>
          <div class="field"><label for="assign-execution-plan">การดำเนินงาน</label><select class="select" id="assign-execution-plan" name="execution_plan" required><option value="">เลือกการดำเนินงาน</option>${Object.entries(executionPlanLabels).map(([value,label]) => `<option value="${value}"${request.execution_plan === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
          <div class="field"><label for="assign-opinion">ความคิดเห็นของช่างผู้ตรวจสอบ</label><select class="select" id="assign-opinion" name="inspector_opinion" required><option value="">เลือกแนวทางการซ่อม</option>${Object.entries(inspectorOpinionLabels).map(([value,label]) => `<option value="${value}"${request.inspector_opinion === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>
          <div class="field"><label for="assign-start-date">วันเริ่มงาน</label><input class="input" id="assign-start-date" name="work_started_date" type="date" value="${escapeHtml(request.work_started_date ?? "")}" required></div>
          <div class="field"><label for="assign-expected-date">วันที่คาดว่าจะเสร็จ</label><input class="input" id="assign-expected-date" name="work_expected_date" type="date" value="${escapeHtml(request.work_expected_date ?? "")}" required></div>
          <div class="form-actions"><button class="btn" type="submit">${request.status === "pending_assign" ? "มอบหมายงาน" : "บันทึกการเปลี่ยนแปลง"}</button></div>
        </form></section>` : ""}
        ${progressSteps.length ? `<section class="card"><h2>ความคืบหน้าระหว่างทาง</h2><p class="muted small">${canRecordProgress ? "กดบันทึกเมื่อแต่ละขั้นเสร็จจริง ระบบแจ้งผู้แจ้งและผู้จัดการแผนกให้อัตโนมัติ" : "ช่างผู้รับผิดชอบและผู้จัดการแผนกซ่อมบำรุงเท่านั้นที่บันทึกได้"}</p><div class="progress-steps">${progressSteps.map((step) => progressStepHtml(step, directory, canRecordProgress)).join("")}</div></section>` : ""}
        ${canStartWork ? `<section class="card"><h2>เริ่มงานซ่อม</h2><p class="muted small">กดเมื่อเริ่มลงมือซ่อมจริง</p><div class="approval-actions"><button class="btn start-work-button">เริ่มงาน</button></div></section>` : ""}
        ${canFinishWork ? `<section class="card"><h2>บันทึกผลการซ่อมและจบงาน</h2><p class="muted small">กรอกผลวิเคราะห์และอะไหล่ที่ใช้ กด "บันทึกข้อมูล" เพื่อบันทึกไว้ทำต่อภายหลังได้โดยยังไม่จบงาน หรือกด "เสร็จสิ้นงาน" เพื่อส่งต่อให้ผู้แจ้งตรวจรับ (การดำเนินงานและความคิดเห็นของช่างผู้ตรวจสอบบันทึกไว้แล้วตอนมอบหมาย)</p><form id="finish-form">
          <div class="field"><label for="finish-cause">วิเคราะห์สาเหตุ</label><textarea class="textarea" id="finish-cause" name="cause_analysis" minlength="3" maxlength="5000" required>${escapeHtml(request.cause_analysis ?? "")}</textarea></div>
          <div class="field"><label>รายการอะไหล่ / วัสดุที่ใช้ (ถ้ามี)</label><small>กรอกเฉพาะรายการที่มี</small><div class="table-wrap parts-table-wrap"><table class="parts-table"><thead><tr><th>ลำดับ</th><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคา</th><th>ชื่อร้าน</th><th>หมายเหตุ</th><th></th></tr></thead><tbody id="finish-parts-rows">${(Array.isArray(request.parts_used_items) && request.parts_used_items.length ? request.parts_used_items : [{}]).map((item) => partsRowHtml(item)).join("")}</tbody></table></div><button type="button" class="btn secondary small" id="finish-parts-add">+ เพิ่มรายการ</button><div class="parts-attachment"><small>หรือแนบรูป/ไฟล์ใบเสร็จรายการอะไหล่แทนการกรอกทีละแถว เพื่อประหยัดเวลา</small><div class="parts-attachment-row"><input class="input" id="finish-parts-file" type="file"><button type="button" class="btn secondary small" id="finish-parts-file-upload">แนบไฟล์</button></div></div></div>
          <div class="form-actions"><button class="btn secondary" type="button" id="finish-save-button">บันทึกข้อมูล</button><button class="btn success" type="submit">เสร็จสิ้นงาน</button></div>
        </form></section>` : ""}
        ${canVerify ? `<section class="card"><h2>ตรวจรับผลการซ่อม</h2><p class="muted small">ยืนยันว่าใช้งานได้ปกติหรือต้องซ่อมเพิ่มเติม (ถ้าไม่ผ่านต้องระบุหมายเหตุ)</p><div class="field"><label for="verify-note">หมายเหตุ</label><textarea class="textarea" id="verify-note" maxlength="1000"></textarea></div><div class="approval-actions"><button class="btn success verify-button" data-result="pass">✓ ผ่าน (ใช้งานได้ปกติ)</button><button class="btn danger verify-button" data-result="fail">✕ ไม่ผ่าน (ต้องซ่อมเพิ่มเติม)</button></div></section>` : ""}
`,
      };
    },

    bindDetail({ id, params, employee }) {
      document.querySelector("#assign-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const technicianIds = values.getAll("technician_ids").map(String).filter(Boolean);
        if (!technicianIds.length) return showToast("กรุณาเลือกช่างอย่างน้อย 1 คน", "error");
        const startDate = String(values.get("work_started_date") ?? "");
        const expectedDate = String(values.get("work_expected_date") ?? "");
        if (startDate && expectedDate && expectedDate < startDate) {
          return showToast("วันที่คาดว่าจะเสร็จต้องไม่ก่อนวันเริ่มงาน", "error");
        }
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
          triggerNotificationEmails(id);
          showToast("บันทึกการมอบหมายเรียบร้อย");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      });
      document.querySelectorAll(".progress-button").forEach((button) => button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const { error } = await sb.rpc("app_record_progress_step", { p_step_id: button.dataset.step, p_done_on: null });
          if (error) throw error;
          triggerNotificationEmails(id);
          showToast("บันทึกความคืบหน้าแล้ว");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); button.disabled = false; }
      }));
      // หมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องเลือกก่อนว่ารับของทันที หรือระบุวันที่คาดว่าจะมาส่ง — สลับ
      // required/disabled ของช่องวันที่ตามตัวเลือกที่ติ๊กไว้ กันส่งฟอร์มไปครึ่งๆ กลางๆ
      document.querySelectorAll(".progress-order-form").forEach((form) => {
        const expectedInput = form.querySelector(".progress-expected-input");
        form.querySelectorAll('input[name="receipt_mode"]').forEach((radio) => radio.addEventListener("change", () => {
          const later = form.querySelector('input[name="receipt_mode"]:checked')?.value === "later";
          expectedInput.disabled = !later;
          expectedInput.required = later;
          if (!later) expectedInput.value = "";
        }));
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const receivedNow = form.querySelector('input[name="receipt_mode"]:checked')?.value !== "later";
          const expectedOn = expectedInput.value || null;
          if (!receivedNow && !expectedOn) return showToast("กรุณาระบุวันที่คาดว่าของจะมาส่ง", "error");
          setFormBusy(form, true);
          try {
            const { error } = await sb.rpc("app_record_progress_step", {
              p_step_id: form.dataset.step,
              p_done_on: null,
              p_received_now: receivedNow,
              p_expected_on: receivedNow ? null : expectedOn,
            });
            if (error) throw error;
            triggerNotificationEmails(id);
            showToast(receivedNow ? "บันทึกความคืบหน้าแล้ว — รับของครบพร้อมกัน" : "บันทึกความคืบหน้าแล้ว — ตั้งวันที่คาดว่าจะมาส่งไว้แล้ว");
            await renderRequestDetail(params);
          } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
        });
      });
      // "ของยังไม่มา" — เปิดฟอร์มเลื่อนวันที่คาดว่าจะมาส่งของหมุด "ของมาส่งเรียบร้อย"
      document.querySelectorAll(".progress-reschedule-toggle").forEach((button) => button.addEventListener("click", () => {
        document.querySelector(`.progress-reschedule-form[data-step="${button.dataset.step}"]`)?.classList.toggle("hidden");
      }));
      document.querySelectorAll(".progress-reschedule-form").forEach((form) => form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const expectedOn = String(new FormData(form).get("expected_on") ?? "");
        if (!expectedOn) return showToast("กรุณาระบุวันที่คาดว่าจะมาส่งใหม่", "error");
        setFormBusy(form, true);
        try {
          const { error } = await sb.rpc("app_reschedule_progress_step", { p_step_id: form.dataset.step, p_expected_on: expectedOn });
          if (error) throw error;
          triggerNotificationEmails(id);
          showToast("เลื่อนวันที่คาดว่าจะมาส่งแล้ว");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      }));
      document.querySelector(".start-work-button")?.addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        try {
          const { error } = await sb.rpc("app_start_repair_work", { p_request_id: id });
          if (error) throw error;
          triggerNotificationEmails(id);
          showToast("เริ่มงานแล้ว");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); event.currentTarget.disabled = false; }
      });
      renumberPartsRows(document.querySelector("#finish-parts-rows"));
      document.querySelector("#finish-parts-add")?.addEventListener("click", () => {
        const container = document.querySelector("#finish-parts-rows");
        container?.insertAdjacentHTML("beforeend", partsRowHtml());
        renumberPartsRows(container);
      });
      document.querySelector("#finish-parts-rows")?.addEventListener("click", (event) => {
        const removeButton = event.target.closest(".parts-row-remove");
        if (!removeButton) return;
        const container = document.querySelector("#finish-parts-rows");
        const rows = container.querySelectorAll(".parts-row");
        // เหลือแถวเดียวไม่ลบทิ้งไปเลย — เคลียร์ค่าแทน ให้ฟอร์มมีอย่างน้อยหนึ่งแถวเสมอ
        if (rows.length > 1) removeButton.closest(".parts-row").remove();
        else removeButton.closest(".parts-row").querySelectorAll("input").forEach((input) => { input.value = ""; });
        renumberPartsRows(container);
      });
      document.querySelector("#finish-parts-file-upload")?.addEventListener("click", async () => {
        const button = document.querySelector("#finish-parts-file-upload");
        const input = document.querySelector("#finish-parts-file");
        let file;
        try {
          file = optionalAttachment(input?.files[0]);
          if (!file) throw new Error("กรุณาเลือกไฟล์");
        } catch (error) {
          return showToast(friendlyError(error), "error");
        }
        button.disabled = true;
        try {
          await uploadRequestAttachment(id, file, employee.id);
          showToast("แนบไฟล์แล้ว");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); button.disabled = false; }
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
        setFormBusy(form, true);
        try {
          const { error } = await sb.rpc("app_save_repair_work_progress", {
            p_request_id: id,
            p_cause_analysis: document.querySelector("#finish-cause").value.trim(),
            p_parts_used_items: collectFinishPartsUsedItems(),
          });
          if (error) throw error;
          showToast("บันทึกข้อมูลแล้ว");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      });
      document.querySelector("#finish-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        setFormBusy(form, true);
        try {
          const { error } = await sb.rpc("app_finish_repair_work", {
            p_request_id: id,
            p_cause_analysis: String(values.get("cause_analysis") ?? "").trim(),
            p_parts_used_items: collectFinishPartsUsedItems(),
          });
          if (error) throw error;
          triggerNotificationEmails(id);
          showToast("บันทึกผลการซ่อมแล้ว ส่งให้ผู้แจ้งตรวจรับ");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); setFormBusy(form, false); }
      });
      document.querySelectorAll(".verify-button").forEach((button) => button.addEventListener("click", async () => {
        const result = button.dataset.result;
        const note = document.querySelector("#verify-note")?.value.trim() ?? "";
        if (result === "fail" && note.length < 3) return showToast("กรุณาระบุสาเหตุที่ไม่ผ่านการตรวจรับ", "error");
        document.querySelectorAll(".verify-button").forEach((node) => { node.disabled = true; });
        try {
          const { error } = await sb.rpc("app_verify_repair", { p_request_id: id, p_result: result, p_note: note || null });
          if (error) throw error;
          triggerNotificationEmails(id);
          showToast(result === "pass" ? "ยืนยันผ่านการตรวจรับแล้ว" : "ส่งกลับให้ซ่อมเพิ่มเติมแล้ว");
          await renderRequestDetail(params);
        } catch (error) { showToast(friendlyError(error), "error"); document.querySelectorAll(".verify-button").forEach((node) => { node.disabled = false; }); }
      }));
    },
  };
})();
