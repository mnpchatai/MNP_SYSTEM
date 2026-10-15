// สำเนา NCR ไปสเปรดชีต "NCR/CAR" ผ่าน Apps Script (apps-script/ncr-backup/Code.gs)
//
// Apps Script เขียนลงชีต "รายงานNCR" (NCR LOG หนึ่งแถวต่อใบ) และเก็บข้อมูลเต็มไว้ในชีตซ่อน "NCR_DATA"
// เพื่อให้ชีต "เอกสารNCR" ดึงข้อมูลลงฟอร์ม QA02-FM01 เมื่อพิมพ์เลขที่เอกสารในช่อง X2
// เป็นแค่สำเนาสำรอง/รายงาน — Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/ขั้นตอนทั้งหมด
// ใบในโหมดทดสอบ (is_test) ไม่ถูกส่ง เพื่อไม่ให้ข้อมูลทดสอบปนกับทะเบียนจริง
(function registerNcrSheetSync(root) {
  // URL ของ Web App ที่ได้จากการ deploy apps-script/ncr-backup/Code.gs — ปล่อยว่างไว้ = ยังไม่ sync
  const SYNC_URL = "https://script.google.com/macros/s/AKfycbyotEU60f76DOozsGcWOznQt1CdaxUqSQEE8dl1qXUMdkcMUIIrD82RLM0Ul3xHrZu0/exec";

  const one = (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null);
  const text = (value) => (value === null || value === undefined ? "" : String(value));
  const quantity = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
  const bangkokDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" });
  // วันที่แบบ YYYY-MM-DD ตามเวลาไทย: คอลัมน์ date ใช้ตามเดิม ส่วน timestamptz แปลงเป็นวันที่ไทย (ไม่ตัดจากสตริง UTC)
  function bangkokDate(value) {
    if (!value) return "";
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? "" : bangkokDay.format(date);
  }

  // ncr = แถว ncr_reports ที่ select พร้อม defect_type, reporter_department, ncr_responsibilities(department)
  // directory = Map ของ loadEmployeeDirectory() (id -> first_name,last_name,job_title,department_id)
  // statusLabel = ป้ายสถานะภาษาไทยที่หน้า NCR แสดงอยู่ (คำนวณใน module-ncr.js ที่เดียว)
  function buildRecord(ncr, { directory = new Map(), statusLabel = "" } = {}) {
    const responsibilities = (ncr.ncr_responsibilities ?? []).map((item) => ({ id: item.department_id, code: text(one(item.department)?.code) }));
    const reporterDepartment = text(one(ncr.reporter_department)?.code);
    const departmentCodes = new Map(responsibilities.map((item) => [item.id, item.code]));
    if (ncr.reporter_department_id) departmentCodes.set(ncr.reporter_department_id, reporterDepartment);
    const person = (id) => {
      const employee = id ? directory.get(id) : null;
      if (!employee) return { name: "", position: "", department: "" };
      return {
        name: `${text(employee.first_name)} ${text(employee.last_name)}`.trim(),
        position: text(employee.job_title),
        department: text(departmentCodes.get(employee.department_id)),
      };
    };
    const signoff = (by, at) => ({ name: person(by).name, date: bangkokDate(at) });
    const reporter = person(ncr.reporter_id);
    return {
      id: ncr.id,
      ncrNo: text(ncr.ncr_no),
      formCode: text(ncr.form_code),
      isTest: ncr.is_test === true,
      status: text(ncr.status),
      statusLabel: text(statusLabel),
      issueDate: bangkokDate(ncr.issue_date),
      // ใช้แผนกที่บันทึกไว้ตอนออกใบ ไม่ใช่แผนกปัจจุบันของผู้รายงาน
      reporter: { ...reporter, department: reporterDepartment },
      productCode: text(ncr.product_code),
      productName: text(ncr.product_name),
      customerName: text(ncr.customer_name),
      customerCode: text(ncr.customer_code),
      poNo: text(ncr.po_no),
      lotNo: text(ncr.lot_no),
      qtyTotal: quantity(ncr.qty_total),
      qtySampled: quantity(ncr.qty_sampled),
      qtyDefect: quantity(ncr.qty_defect),
      qtyReturned: quantity(ncr.qty_returned),
      unit: text(ncr.unit),
      source: text(ncr.source),
      defectType: text(one(ncr.defect_type)?.name_th),
      description: text(ncr.description),
      dispositions: [...(ncr.dispositions ?? [])],
      dispositionNote: text(ncr.disposition_note),
      disposer: { ...person(ncr.disposed_by), date: bangkokDate(ncr.disposed_at) },
      responseDue: bangkokDate(ncr.response_due),
      responsibilities: responsibilities.map((item) => item.code).filter(Boolean),
      causes: [...(ncr.causes ?? [])],
      rootCause: text(ncr.root_cause),
      correction: text(ncr.correction),
      correctionDue: bangkokDate(ncr.correction_due),
      prevention: text(ncr.prevention),
      preventionDue: bangkokDate(ncr.prevention_due),
      responder: { ...person(ncr.responded_by), date: bangkokDate(ncr.responded_at) },
      followup: {
        ...signoff(ncr.followed_up_by, ncr.followed_up_at),
        note: text(ncr.followup_note),
        // QA เลือก "ปิดประเด็น" แล้วใบเดินต่อไปขั้นลงนาม (ผลส่งกลับจะย้อนไปรอแผนกตอบ จึงไม่นับ)
        closed: Boolean(ncr.followed_up_at) && ["awaiting_signoff", "awaiting_info", "closed"].includes(ncr.status),
      },
      signoffs: {
        qa: signoff(ncr.signoff_qa_by, ncr.signoff_qa_at),
        factory: signoff(ncr.signoff_factory_by, ncr.signoff_factory_at),
        gm: signoff(ncr.signoff_gm_by, ncr.signoff_gm_at),
      },
      closedAt: bangkokDate(ncr.closed_at),
      cancelledAt: bangkokDate(ncr.cancelled_at),
      cancelReason: text(ncr.cancel_reason),
    };
  }

  const shouldSync = (record, url = SYNC_URL) => Boolean(url) && Boolean(record?.id) && Boolean(record.ncrNo) && !record.isTest;

  // fire-and-forget แบบเดียวกับ syncManagementOrderToAppsScript: no-cors อ่านผลกลับไม่ได้และแนบ token ไม่ได้
  // ยิงไม่สำเร็จก็แค่ log ไว้ ไม่กระทบผู้ใช้ — คืน true เมื่อส่งคำขอออกไป
  function sync(record, { url = SYNC_URL, fetchImpl = (...args) => root.fetch(...args) } = {}) {
    if (!shouldSync(record, url)) return false;
    fetchImpl(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ batch: [{ key: `ncr:${record.id}`, value: JSON.stringify(record) }] }),
    }).catch((error) => console.warn("ซิงก์ NCR ไปสเปรดชีตไม่สำเร็จ", error));
    return true;
  }

  const api = { buildRecord, bangkokDate, shouldSync, sync };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_NCR_SHEET_SYNC = api;
})(typeof window !== "undefined" ? window : globalThis);
