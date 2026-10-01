// โมดูลใบคำร้องถึงฝ่ายบริหาร (MANAGEMENT, ฟอร์ม PP01-FM08) ของ Pilot Web
//
// แยกจาก app.js เฉพาะส่วนที่เป็นของ MG: ชื่อ/สีการ์ด, ไม่มีช่องความสำคัญ, ส่วน "สำเนาถึงแผนก",
// เลขที่เอกสารหลังสร้าง และการซิงก์สำเนาสำรองไป Apps Script ส่วนการสร้างคำร้อง (app_create_request),
// สายอนุมัติ และสิทธิ์ทั้งหมดยังอยู่ที่ฐานข้อมูลเหมือนเดิม (20260922010000_management_request_pp01_fm08.sql)
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) จึงห้ามเรียก helper ของ app.js ตอนโหลดไฟล์ — app.js ส่ง
// helper ที่ต้องใช้มาให้ตอนเรียก hook แต่ละตัว
//
// คู่กับฝั่ง Next.js: src/lib/request-modules/module-mg.ts — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
(function registerManagementModule() {
  // สำรองข้อมูลใบคำร้องถึงฝ่ายบริหารไปชีต "ใบคำร้องถึงฝ่ายบริหาร" แยกจากชีตใบแจ้งซ่อม (คนละสเปรดชีต)
  // — deploy Apps Script ตาม apps-script/management-backup/Code.gs แล้วใส่ URL ของ Web App ที่ได้ตรงนี้
  // ปล่อยว่างไว้ = ยังไม่ sync
  const APPS_SCRIPT_MANAGEMENT_SYNC_URL = "https://script.google.com/macros/s/AKfycbw_FQUWk6tM8l-CvOdPu7zHxJdKj6Dcq7hBZRIiEotNRGs5sstLj7GnHMK5xixjuS5m/exec";

  // ส่วนที่ 3 ของฟอร์ม PP01-FM08 "สำเนาถึงแผนก" — ตาราง 6 คอลัมน์ 4 แถว เรียงตามฟอร์มต้นฉบับ
  // ช่องสุดท้าย (null) คือ "อื่นๆ" ซึ่งเป็นช่องข้อความอิสระ ไม่ใช่แผนกในระบบ (ดู module-mg.ts)
  const CC_DEPARTMENT_GRID = [
    ["PP", "BD", "QA", "RB", "GR", "PK"],
    ["PT", "BG", "SR", "SE", "ST", "WH"],
    ["MS", "MT", "FT", "IT", "EX", "SA"],
    ["PC", "HR", "AD", "AC", "SP", null],
  ];

  // ccDepartments คือ Map<code, {id,code}> จาก prepareForm เช็คบ็อกซ์ผูก name="cc_department_ids"
  // (เก็บ id ของแผนก) ซึ่งฟังก์ชันส่งคำร้องกลางเก็บส่งเป็น p_cc_department_ids ส่วนช่อง "อื่นๆ"
  // ใช้ class detail-field จึงถูกเก็บลง details.cc_other_note อัตโนมัติ
  function ccDepartmentGridHtml(ccDepartments, escapeHtml) {
    const cells = CC_DEPARTMENT_GRID.flat().map((code) => {
      if (code === null) {
        return `<label class="cc-department-other"><span>อื่นๆ</span><input class="input detail-field" name="cc_other_note" placeholder="ระบุ" maxlength="200"></label>`;
      }
      const department = ccDepartments.get(code);
      if (!department) return "<span></span>";
      return `<label class="cc-department-option"><input type="checkbox" class="cc-department-checkbox" name="cc_department_ids" value="${escapeHtml(department.id)}"><span>${escapeHtml(code)}</span></label>`;
    }).join("");
    return `<div class="field full cc-department-field"><label>สำเนาถึงแผนก</label><div class="cc-department-grid">${cells}</div></div>`;
  }

  // สถานะของใบคำร้องถึงฝ่ายบริหารตามฟอร์ม PP01-FM08: มติ 3 ทาง (approved/rejected/acknowledged)
  // เป็น terminal เสมอ ไม่มีขั้นดำเนินงานแบบใบแจ้งซ่อม จึงสั้นกว่า mapRepairAppsScriptStatus มาก
  function mapManagementAppsScriptStatus(request) {
    if (request.status === "pending_approval") return request.current_step >= 2 ? "PENDING_GM" : "PENDING_FM";
    const direct = {
      more_info: "NEEDS_INFO",
      approved: "APPROVED",
      in_progress: "IN_PROGRESS",
      completed: "DONE",
      rejected: "REJECTED",
      acknowledged: "ACKNOWLEDGED",
    };
    return direct[request.status] ?? request.status.toUpperCase();
  }

  // โครงสร้างเดียวกับ buildAppsScriptOrder ของใบแจ้งซ่อม (fm/gm ผูกกับ step_order 1/2 เหมือนกัน
  // เพราะ MANAGEMENT ใช้สายอนุมัติคงที่ ผู้จัดการโรงงาน -> ผู้จัดการทั่วไป แบบเดียวกันแล้ว — ดู
  // 20260922010000_management_request_pp01_fm08.sql) เพื่อให้ผู้ดูแลที่คุ้นชีตใบแจ้งซ่อมอ่านชีตนี้ได้ทันที
  function buildAppsScriptManagementOrder(request, steps, directory, ccDepartmentCodes, { relation, personName, appsScriptApprovalStage }) {
    const fmStep = steps.find((step) => step.step_order === 1);
    const gmStep = steps.find((step) => step.step_order === 2);
    const details = request.details ?? {};
    const decidedStep = [fmStep, gmStep].find((step) => step && step.status !== "pending");
    return {
      id: request.id,
      docNumber: request.request_no,
      department: relation(request.department)?.code ?? "",
      subject: request.title ?? "",
      attachmentNote: details.attachment_note ?? "",
      description: request.description ?? "",
      requestedBy: personName(directory, request.requester_id),
      position: directory.get(request.requester_id)?.job_title ?? "",
      submittedAt: request.submitted_at,
      status: mapManagementAppsScriptStatus(request),
      decision: decidedStep ? decidedStep.status : "",
      comment: decidedStep?.comment ?? "",
      approvals: {
        fm: appsScriptApprovalStage(fmStep, directory),
        gm: appsScriptApprovalStage(gmStep, directory),
      },
      ccDepartments: ccDepartmentCodes ?? [],
      ccOther: details.cc_other_note ?? "",
    };
  }

  function syncManagementOrderToAppsScript(order) {
    if (!APPS_SCRIPT_MANAGEMENT_SYNC_URL) return;
    // no-cors: อ่านผลลัพธ์กลับไม่ได้ (opaque response) — ยอมรับได้เพราะนี่คือสำเนาสำรอง ไม่ใช่ทางเดิน
    // ข้อมูลจริง ถ้ายิงไม่สำเร็จ (โควตา/เครือข่าย/ฯลฯ) ก็แค่ log ไว้ ไม่กระทบผู้ใช้งานเลย
    fetch(APPS_SCRIPT_MANAGEMENT_SYNC_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ batch: [{ key: `mgmt:${order.id}`, value: JSON.stringify(order) }] }),
    }).catch((syncError) => console.warn("ซิงก์ใบคำร้องถึงฝ่ายบริหารไปชีตสำรองไม่สำเร็จ", syncError));
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.MANAGEMENT = {
    code: "MANAGEMENT",
    enabled: true,
    label: "ใบคำร้องถึงฝ่ายบริหาร",
    theme: ["#a78bfa", "#5b21b6"],
    // ฟอร์ม PP01-FM08 ไม่มีช่องความสำคัญ — ฟังก์ชันส่งคำร้องกลางใช้ค่า normal
    hidePriority: true,
    // มติที่ 3 ของฟอร์ม PP01-FM08 นอกจากอนุมัติ/ไม่อนุมัติ (app_approval_decision ใน
    // 20260922010000_management_request_pp01_fm08.sql) — แสดงปุ่มเพิ่มในกล่องพิจารณาคำร้อง
    extraDecisions: [{ decision: "acknowledged", label: "รับทราบข้อมูล" }],

    // โหลดข้อมูลที่ฟอร์มต้องใช้ก่อนวาด ผลลัพธ์ถูกส่งกลับมาที่ renderFormSections
    async prepareForm({ sb }) {
      const { data, error } = await sb.from("departments").select("id,code").eq("is_active", true);
      if (error) throw error;
      return { ccDepartments: new Map((data ?? []).map((item) => [item.code, item])) };
    },

    renderFormSections(formContext, { escapeHtml }) {
      return ccDepartmentGridHtml(formContext.ccDepartments, escapeHtml);
    },

    // ใบคำร้องถึงฝ่ายบริหารให้เห็นเลขที่เอกสารทันทีหลังสร้าง เป็นจุดชี้บ่งใบนั้นๆ — คืนข้อความต่อท้าย toast
    async afterCreate({ sb, requestId }) {
      const { data: created } = await sb.from("requests").select("request_no").eq("id", requestId).maybeSingle();
      return created?.request_no ? ` · เลขที่ ${created.request_no}` : "";
    },

    // หน้ารายละเอียด: เตรียมข้อมูลสำเนาถึงแผนกและซิงก์สำเนาสำรอง คืนรายการข้อมูลที่จะแสดงเพิ่ม
    async loadDetail({ sb, request, steps, directory, helpers }) {
      let ccDepartmentCodes = [];
      // อย่าให้การเตรียมข้อมูลสำรอง (แค่บันทึก/รายงาน) พังหน้ารายละเอียดจริง — ผิดพลาดแค่ log ไว้
      try {
        const ccIds = request.cc_department_ids ?? [];
        if (ccIds.length) {
          const { data: ccData, error: ccError } = await sb.from("departments").select("code").in("id", ccIds);
          if (ccError) throw ccError;
          ccDepartmentCodes = (ccData ?? []).map((row) => row.code);
        }
        syncManagementOrderToAppsScript(buildAppsScriptManagementOrder(request, steps, directory, ccDepartmentCodes, helpers));
      } catch (ccError) {
        console.warn("เตรียมข้อมูลสำเนาถึงแผนก/สำรองใบคำร้องถึงฝ่ายบริหารไม่สำเร็จ", ccError);
      }
      return {
        facts: ccDepartmentCodes.length
          ? [{ label: "สำเนาถึงแผนก", value: ccDepartmentCodes.join(", "), options: { icon: "▤", tone: "violet", wide: true } }]
          : [],
      };
    },
  };
})();
