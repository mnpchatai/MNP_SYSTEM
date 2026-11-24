// Supabase จำลองของ /pilot-shell.html (scripts/pilot-harness.mjs): ข้อมูลตัวอย่างอยู่ในหน่วยความจำของหน้า เขียนแล้วอ่านกลับได้ทันที
// (อนุมัติ/ไม่อนุมัติ/ขอข้อมูลเพิ่ม ส่งข้อมูลกลับ เปลี่ยนสถานะ สร้างคำร้อง/ใบแจ้งซ่อม ขั้นตอนงานซ่อม) และหายเมื่อโหลดหน้าใหม่ ไม่เก็บลง localStorage
//
// createMockSupabase และ installMockSupabase ต้องไม่อ้างตัวแปรนอกฟังก์ชันของตัวเอง เพราะ mockSupabaseScript() ส่งซอร์สของทั้งสอง
// (Function#toString) ให้เบราว์เซอร์เป็น /harness-mock-supabase.js ส่วน scripts/tests/pilot-harness-mock.test.mjs import ไปทดสอบตรงๆ
// สิทธิ์ที่ตรวจในนี้เป็นแค่ส่วนที่หน้าจอต้องเห็น (ขั้นของฉัน ขั้นปัจจุบัน ความเห็นบังคับ ลำดับสถานะ) ใช้รหัส error เดียวกับ RPC จริงเพื่อให้ข้อความตรงกัน
// แต่หลวมกว่า RPC จริง เช่น การมอบหมายช่างครั้งแรกไม่บังคับแผนดำเนินงาน/วันที่ และลิงก์ "ดาวน์โหลด" ไฟล์แนบใช้ไม่ได้ (data:/blob: URL)

// sandbox = admin อยู่ในโหมดทดสอบ (?sandbox=1): ผู้ใช้จำลองเป็น admin และทำหน้าที่เป็นบัญชีทดสอบ จึงเห็นโมดูลทดสอบ (RubberFlow, BOM)
// storage = ที่เก็บข้อมูลหลัก BOM ของหน้า (localStorage) ไม่ส่ง = อยู่ในหน่วยความจำอย่างเดียว
// ncr = สถานการณ์ NCR อย่างเดียว (?ncr=1): ไม่มีคำร้องอื่น มี NCR ครบทุกขั้น และกดขั้นของ NCR ได้จริงในฐานข้อมูลจำลอง (เก็บลง storage
// ใบจึงเดินต่อเมื่อสลับผู้ใช้) · as = รหัสพนักงานจำลองที่ใช้เข้าระบบ (?as=e5) ใช้ได้เฉพาะสถานการณ์ NCR
// itwo = (ร่วมกับ sandbox) เพิ่ม persona SBX-IT-STAFF / ADMIN / APPROVER และฐานข้อมูลจำลองของใบสั่งงาน IT (scripts/pilot-harness-itwo-mock.mjs) → ?sandbox=1&itwo=1
// real = นอกโหมดทดสอบ ให้ผู้ใช้จำลองเป็นพนักงานจริงของแผนก/ตำแหน่งเดียวกับบัญชีทดสอบชื่อนั้น (?real=rb · pp rbh gr st sr wh whh qa pk pt bg) เพื่อลองเส้นทางใช้งานจริงของ BOM / RubberFlow
import { createItwoMock } from "./pilot-harness-itwo-mock.mjs";

export function createMockSupabase({ empty = false, sandbox = false, itwo = false, ncr = false, master = false, as = null, real = null, now = () => Date.now(), warn = () => {}, objectUrl = null, storage = null } = {}) {
  const YEAR = "2569";
  const DAY = 86400000;
  const startedAt = now();
  const iso = (ms) => new Date(ms).toISOString();
  const ago = (days) => iso(startedAt - days * DAY);
  let lastStamp = 0;
  // เวลาของการเขียนเพิ่มขึ้นเสมอ ลำดับเหตุการณ์ที่เรียงตามเวลาจึงไม่สลับกันเมื่อกดติดกันในมิลลิวินาทีเดียว
  const stamp = () => { lastStamp = Math.max(now(), lastStamp + 1); return iso(lastStamp); };
  let seq = 0;
  const newId = (table) => `${table}-${++seq}`;
  const clone = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const warned = new Set();
  const warnOnce = (key, message) => { if (!warned.has(key)) { warned.add(key); warn(message); } };

  const ME_ID = ncr && /^e([1-9]|1[01])$/.test(String(as ?? "")) ? as : "e1";
  const roles = [
    ["role-dm", "department_manager", "ผู้จัดการแผนก"], ["role-sup", "supervisor", "หัวหน้างาน"], ["role-tech", "technician", "ช่าง"],
    ["role-staff", "staff", "พนักงาน"], ["role-fm", "factory_manager", "ผู้จัดการโรงงาน"], ["role-gm", "general_manager", "ผู้จัดการทั่วไป"],
    // admin มีเฉพาะโหมดทดสอบ (?sandbox=1) โหมดปกติรายการบทบาทเหมือนเดิม
    ...(sandbox || master ? [["role-admin", "admin", "ผู้ดูแลระบบ"]] : []),
  ].map(([id, code, name_th], index) => ({ id, code, name_th, sort_order: index + 1 }));
  // แผนกที่เป็นจุดแจ้งซ่อมได้ต้องมีรหัสตรงกับ REPAIR_DEPARTMENT_OPTIONS ของ modules/module-mt.js ปุ่มเลือกแผนกจึงขึ้น
  const departments = [
    ["dep-rb", "RB", "ฝ่ายผลิต RB", true], ["dep-mt", "MT", "ซ่อมบำรุง", true], ["dep-qa", "QA", "ประกันคุณภาพ", true], ["dep-it", "IT", "เทคโนโลยีสารสนเทศ", false],
  ].map(([id, code, name_th, is_repair_site]) => ({ id, code, name_th, is_active: true, is_repair_site }));
  const machines = [
    ["m-hcm03", "HCM-03", "เครื่องฉีดยาง HCM-03", "dep-rb"], ["m-cv02", "CV-02", "สายพานลำเลียง CV-02", "dep-rb"], ["m-mx01", "MX-01", "เครื่องผสมยาง Banbury MX-01", "dep-rb"],
    ["m-cmp01", "CMP-01", "ปั๊มลมห้องซ่อมบำรุง", "dep-mt"], ["m-ltb2", "LT-B2", "ระบบไฟส่องสว่างอาคาร 2", "dep-mt"],
    ["m-mdr01", "MDR-01", "เครื่องทดสอบ MDR", "dep-qa"], ["m-rht01", "RHT-01", "เครื่องวัดความแข็งยาง", "dep-qa"],
  ].map(([id, code, name, department_id], index) => ({ id, code, name, department_id, is_placeholder: false, is_active: true, sort_order: index + 1 }));
  // ผู้ใช้จำลอง (e1) เป็นผู้จัดการแผนกซ่อมบำรุง = แผนกเจ้าของประเภทแจ้งซ่อม จึงเห็นงาน "รอมอบหมายช่าง" ในคิว
  const employees = [
    ["e1", "E001", "ปกรณ์", "ศรีวัฒนา", "ผู้จัดการแผนกซ่อมบำรุง", "dep-mt", "role-dm"],
    ["e2", "E014", "สมชาย", "ช่างซ่อม", "ช่างซ่อมบำรุง", "dep-mt", "role-tech"],
    ["e3", "E022", "วิภา", "ใจดี", "เจ้าหน้าที่ QC", "dep-qa", "role-staff"],
    ["e4", "E031", "อนันต์", "ทองดี", "หัวหน้าแผนกขึ้นรูปยาง", "dep-rb", "role-sup"],
    ["e5", "E002", "ศิริพร", "วงศ์ใหญ่", "ผู้จัดการโรงงาน", "dep-rb", "role-fm"],
    ["e6", "E041", "ธนพล", "มีสุข", "ผู้จัดการแผนก IT", "dep-it", "role-dm"],
    ["e7", "E003", "กมล", "รัตนชัย", "ผู้จัดการทั่วไป", "dep-rb", "role-gm"],
    ["e8", "E017", "ประเสริฐ", "แสงทอง", "ช่างไฟฟ้า", "dep-mt", "role-tech"],
    // สถานการณ์ NCR: ผู้ตอบของแผนก RB (พนักงาน + ผจก.แผนก) และ ผจก.แผนก QA ผู้ลงนามลำดับแรก
    ...(ncr ? [
      ["e9", "E052", "มานพ", "ขึ้นรูปดี", "พนักงานแผนกขึ้นรูปยาง", "dep-rb", "role-staff"],
      ["e10", "E030", "สุภาพร", "ผลิตผล", "ผู้จัดการแผนกขึ้นรูปยาง", "dep-rb", "role-dm"],
      ["e11", "E020", "อรทัย", "มาตรฐาน", "ผู้จัดการแผนก QA", "dep-qa", "role-dm"],
    ] : []),
  ].map(([id, employee_no, first_name, last_name, job_title, department_id, role_id], index) => ({
    id, employee_no, first_name, last_name, job_title, department_id, role_id, acting_role_id: null, manager_id: null,
    email: `${id}@example.test`, phone: "", is_active: true, is_master: false, auth_user_id: `u${index + 1}`,
  }));
  const ME = employees.find((row) => row.id === ME_ID) ?? employees[0];
  if (sandbox) ME.role_id = "role-admin";
  // ?master=1 = ผู้ใช้จำลองเป็นบัญชี master (admin ที่เห็นหน้า #/master) — migration 20261113010000_master_account.sql
  if (master) Object.assign(ME, { role_id: "role-admin", is_master: true });
  const personName = (id) => { const person = employees.find((row) => row.id === id); return person ? `${person.first_name} ${person.last_name}` : null; };
  // ชื่อเดียวกับ request_types.name_th บนฐานข้อมูลจริง (ตรวจ 2026-11-10) หน้าจอใน harness จึงเห็นชื่อเดียวกับผู้ใช้จริง
  const request_types = [
    ["t-mt", "MT_REPAIR", "MT", "ใบคำร้อง/แจ้งซ่อม MT", "งานซ่อมเครื่องจักรและอาคาร", true, "dep-mt"],
    ["t-mg", "MANAGEMENT", "MG", "ใบคำร้องถึงฝ่ายบริหาร", "หนังสือภายในถึงผู้บริหาร", false, null],
    ["t-ncr", "NCR_CAR", "NCR", "NCR/CAR", "รายงานสินค้าไม่เป็นไปตามข้อกำหนด", false, "dep-qa"],
    ["t-it", "IT_REPAIR", "IT", "ใบแจ้งซ่อม IT", "อุปกรณ์และสิทธิ์ระบบ", false, "dep-it"],
  ].map(([id, code, prefix, name_th, description, uses_repair_workflow, owning_department_id], index) => ({
    id, code, prefix, name_th, description, uses_repair_workflow, owning_department_id, form_schema: null, is_active: true, sort_order: index + 1,
  }));
  // ขั้นอนุมัติของคำร้องที่สร้างใหม่: ขั้นแรกเป็นของผู้ใช้จำลองเสมอ ใบใหม่จึงเข้าคิวให้ลองกดต่อได้ทันที
  const NEW_REQUEST_STEPS = {
    // ใบแจ้งซ่อมใหม่ย่อเหลือขั้นสุดท้ายของระบบจริง (ผู้จัดการทั่วไป) อนุมัติแล้วเข้า "รอมอบหมายช่าง" ทันที ไม่มีขั้นรับงาน
    MT_REPAIR: [["ผู้จัดการทั่วไป", ME_ID]],
    MANAGEMENT: [["หัวหน้าแผนกต้นสังกัดพิจารณา", ME_ID], ["ผู้จัดการโรงงานพิจารณา", "e5"]],
    IT_REPAIR: [["หัวหน้าแผนกผู้แจ้งอนุมัติ", ME_ID], ["ผู้จัดการแผนก IT อนุมัติ", "e6"]],
  };

  const db = {
    roles, departments, machines, employees, request_types,
    requests: [], approval_steps: [], request_status_history: [], request_attachments: [], request_technicians: [],
    request_verifications: [], request_comments: [], request_progress_steps: [], request_expected_date_changes: [], notifications: [],
    company_holidays: [], ncr_reports: [], ncr_defect_types: [], ncr_losses: [], ncr_outcomes: [],
  };
  // รูปแนบตัวอย่างเป็น SVG ใน data: URL (CSP ของ index.html อนุญาต img-src data:) ไฟล์ที่อัปโหลดจริงในหน้าได้ blob: URL ของไฟล์นั้น
  const files = new Map();
  const svgImage = (label, color) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><text x="320" y="250" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#fff">${label}</text></svg>`)}`;

  function seedRequest(spec) {
    const type = request_types.find((row) => row.code === spec.type);
    const machine = machines.find((row) => row.id === spec.machine);
    const createdAt = ago(spec.created);
    const request = {
      id: spec.id, request_no: spec.no, request_type_id: type.id, title: spec.title, description: spec.description, status: spec.status,
      priority: spec.priority ?? "normal", created_at: createdAt, submitted_at: createdAt, updated_at: createdAt, needed_date: null,
      requester_id: spec.requester, requester_name: personName(spec.requester), assignee_id: spec.assignee ?? null,
      department_id: spec.department ?? employees.find((row) => row.id === spec.requester).department_id,
      current_step: spec.currentStep ?? 1, approved_at: spec.currentStep === 0 ? createdAt : null, details: spec.details ?? {}, cc_department_ids: spec.cc ?? [],
      machine_id: machine?.id ?? null, machine_code: machine?.code ?? null, machine_name: machine?.name ?? null,
      doc_type: type.uses_repair_workflow ? "repair" : null, is_urgent: Boolean(spec.urgent), ...(spec.extra ?? {}),
    };
    db.requests.push(request);
    spec.steps.forEach(([step_name, approver, status, actedDays, comment], index) => db.approval_steps.push({
      id: `${spec.id}-s${index + 1}`, request_id: spec.id, step_order: index + 1, step_name, approver_employee_id: approver,
      approver_role_id: null, approver_department_id: null, status, acted_by: status === "pending" ? null : approver,
      acted_at: actedDays === undefined ? null : ago(actedDays), comment: comment ?? null, created_at: createdAt,
    }));
    [[null, "pending_approval", spec.requester, spec.created], ...(spec.history ?? [])].forEach(([from_status, to_status, changed_by, days, note], index) => {
      db.request_status_history.push({ id: `${spec.id}-h${index + 1}`, request_id: spec.id, from_status, to_status, changed_by, note: note ?? null, created_at: ago(days) });
    });
    (spec.files ?? []).forEach(([file_name, color], index) => {
      const storage_path = `${spec.id}/${index + 1}-mock.svg`;
      files.set(storage_path, svgImage(file_name, color));
      db.request_attachments.push({ id: `${spec.id}-a${index + 1}`, request_id: spec.id, file_name: `${file_name}.svg`, storage_path, content_type: "image/svg+xml", size_bytes: 48213 + index * 1024, uploader_id: spec.requester, created_at: ago(spec.created - 0.01) });
    });
    (spec.techs ?? []).forEach((technician_id) => db.request_technicians.push({ id: newId("request_technicians"), request_id: spec.id, technician_id }));
  }

  if (!empty && !ncr) {
    seedRequest({
      id: "req-mt-0412", no: "MT-2569-0412", type: "MT_REPAIR", title: "แจ้งซ่อมเครื่องฉีดยาง HCM-03 น้ำมันไฮดรอลิกรั่ว", priority: "high", urgent: true,
      description: "น้ำมันไฮดรอลิกรั่วบริเวณกระบอกสูบด้านซ้าย หยดลงพื้นตลอดกะ ต้องหยุดเครื่องเติมน้ำมันทุก 2 ชั่วโมง",
      status: "pending_approval", requester: "e4", machine: "m-hcm03", created: 1, currentStep: 2,
      // ลำดับเดียวกับฐานข้อมูลจริง: ผู้จัดการโรงงาน → ผู้จัดการทั่วไป แล้วหัวหน้าซ่อมบำรุงมอบหมายช่าง (ไม่มีขั้นรับงาน)
      // ผู้ใช้จำลองถือขั้นผู้จัดการทั่วไปไว้ทดลองแถบตัดสินใจ (ในระบบจริงขั้นนี้เป็นของผู้จัดการทั่วไป)
      steps: [["ผู้จัดการโรงงาน", "e5", "approved", 0.8, "อนุมัติ ให้ซ่อมด่วนก่อนกะดึก"], ["ผู้จัดการทั่วไป", ME_ID, "pending"]],
      files: [["น้ำมันรั่วใต้กระบอกสูบ", "#9a3412"], ["ป้ายเครื่อง HCM-03", "#1e3a8a"]],
    });
    seedRequest({
      id: "req-ncr-0088", no: "NCR-2569-0088", type: "NCR_CAR", title: "NCR ยางขอบไม่เต็ม ล็อต RB-1103",
      description: "ตรวจพบชิ้นงานขอบไม่เต็ม 120 ชิ้นจาก 2,400 ชิ้น ในล็อต RB-1103 กะเช้า แม่พิมพ์เบอร์ 4",
      status: "pending_approval", requester: "e3", created: 2, currentStep: 2,
      steps: [["ผู้จัดการโรงงานตรวจสอบ", "e5", "approved", 1.5, "ส่งให้แผนกที่เกี่ยวข้องรับทราบและหาสาเหตุ"], ["ผู้จัดการแผนกที่รับผิดชอบรับทราบ", ME_ID, "pending"], ["ผู้จัดการทั่วไปปิด NCR", "e7", "pending"]],
      files: [["ชิ้นงานขอบไม่เต็ม", "#0f766e"]],
    });
    seedRequest({
      id: "req-it-0057", no: "IT-2569-0057", type: "IT_REPAIR", title: "คอมพิวเตอร์ห้องซ่อมบำรุงเปิดไม่ติด",
      description: "กดปุ่มเปิดแล้วไฟไม่ขึ้น ใช้บันทึกใบงานซ่อมไม่ได้", status: "pending_approval", requester: ME_ID, created: 3, currentStep: 2,
      details: { asset_code: "PC-MT-04", location: "อาคาร 1 ห้องซ่อมบำรุง", impact: "ช่าง 3 คนบันทึกใบงานไม่ได้" },
      steps: [["หัวหน้าแผนกผู้แจ้งอนุมัติ", ME_ID, "approved", 2.9], ["ผู้จัดการแผนก IT อนุมัติ", "e6", "pending"]],
    });
    seedRequest({
      id: "req-mg-0019", no: "MG-2569-0019", type: "MANAGEMENT", title: "ขออนุมัติปรับกะทำงานช่วงปีใหม่ 2570",
      description: "ขอปรับกะทำงานวันที่ 29–31 ธันวาคม เป็นกะเดียว 08:00–17:00 เพื่อให้พนักงานเดินทางกลับภูมิลำเนา",
      status: "approved", requester: ME_ID, created: 6, currentStep: 0, cc: ["dep-rb", "dep-qa"],
      steps: [["ผู้จัดการโรงงานพิจารณา", "e5", "approved", 5, "เห็นควรอนุมัติ"], ["ผู้จัดการทั่วไปพิจารณา", "e7", "approved", 4]],
      history: [["pending_approval", "approved", "e7", 4]],
      files: [["ตารางกะใหม่", "#6d28d9"]],
    });
    seedRequest({
      id: "req-mt-0405", no: "MT-2569-0405", type: "MT_REPAIR", title: "สายพานลำเลียง CV-02 ขาด",
      description: "สายพานขาดตรงรอยต่อ ต้องขนชิ้นงานด้วยมือ", status: "pending_assign", requester: "e4", machine: "m-cv02", created: 4, currentStep: 0,
      steps: [["ผู้จัดการโรงงาน", "e5", "approved", 3.8], ["ผู้จัดการทั่วไป", "e7", "approved", 3.5]],
      history: [["pending_approval", "pending_assign", "e7", 3.5]],
    });
    seedRequest({
      id: "req-mt-0401", no: "MT-2569-0401", type: "MT_REPAIR", title: "เครื่องผสมยาง MX-01 มอเตอร์ร้อนผิดปกติ",
      description: "อุณหภูมิมอเตอร์ขึ้นถึง 95 องศาหลังเดินเครื่อง 1 ชั่วโมง", status: "assigned", requester: "e4", machine: "m-mx01", created: 5, currentStep: 0,
      assignee: ME_ID, techs: [ME_ID, "e2"], extra: { work_expected_date: ago(-2).slice(0, 10), execution_plan: "use_existing", inspector_opinion: "self_repair" },
      steps: [["ผู้จัดการโรงงาน", "e5", "approved", 4.8], ["ผู้จัดการทั่วไป", "e7", "approved", 4.5]],
      history: [["pending_approval", "pending_assign", "e7", 4.5], ["pending_assign", "assigned", ME_ID, 4.4]],
    });
    seedRequest({
      id: "req-mt-0398", no: "MT-2569-0398", type: "MT_REPAIR", title: "ปั๊มลมห้องซ่อม CMP-01 แรงดันตก",
      description: "แรงดันลมตกเหลือ 4 บาร์ เครื่องมือลมใช้งานไม่ได้", status: "in_progress", requester: "e2", machine: "m-cmp01", created: 7, currentStep: 0,
      assignee: "e2", techs: ["e2", ME_ID], extra: { work_expected_date: ago(-1).slice(0, 10), execution_plan: "need_purchase", inspector_opinion: "buy_parts" },
      steps: [["ผู้จัดการโรงงาน", "e5", "approved", 6.8], ["ผู้จัดการทั่วไป", "e7", "approved", 6.5]],
      history: [["pending_approval", "pending_assign", "e7", 6.5], ["pending_assign", "assigned", ME_ID, 6.4], ["assigned", "in_progress", "e2", 6]],
    });
    seedRequest({
      id: "req-mt-0390", no: "MT-2569-0390", type: "MT_REPAIR", title: "ไฟส่องสว่างอาคาร 2 ดับครึ่งแถว",
      description: "โคมไฟแถว B ดับ 6 โคม", status: "pending_verify", requester: ME_ID, machine: "m-ltb2", created: 9, currentStep: 0,
      assignee: "e8", techs: ["e8"], extra: { execution_plan: "immediate", inspector_opinion: "self_repair", cause_analysis: "บัลลาสต์เสื่อมสภาพ", parts_used: "บัลลาสต์ 36W 6 ตัว" },
      steps: [["ผู้จัดการโรงงาน", "e5", "approved", 9.1], ["ผู้จัดการทั่วไป", "e7", "approved", 8.8]],
      history: [["pending_approval", "pending_assign", "e7", 8.8], ["pending_assign", "assigned", ME_ID, 8.7], ["assigned", "in_progress", "e8", 8], ["in_progress", "pending_verify", "e8", 0.5]],
    });
    // NCR อยู่ตาราง ncr_reports แยกจากคำร้อง (modules/module-ncr.js) — หน้าหลักดึงใบที่ถึงขั้นของผู้ใช้และใบที่ผู้ใช้ออก
    // แถวเก็บ ncr_responsibilities ที่หน้าเว็บ embed ไว้ในตัว (expand ไม่ต้องต่อให้)
    const dateOnly = (days) => ago(days).slice(0, 10);
    // ช่องที่หน้ารายละเอียด NCR แสดงในส่วนที่ 1–2 (หน้าหลักใช้แค่เลขที่ ชื่อสินค้า สถานะ และผู้รับผิดชอบ)
    const ncrPart1 = (description, qtyTotal, qtyDefect) => ({ unit: "ชิ้น", source: "in_process", qty_total: qtyTotal, qty_defect: qtyDefect, description, dispositions: ["sort"], causes: [], defect_type: { name_th: "ขนาดผิด" }, reporter_department: { code: "QA" } });
    db.ncr_reports.push(
      // แผนก MT ของผู้ใช้จำลองต้องตอบ และเลยกำหนดตอบแล้ว → คิว "ต้องจัดการ"
      { id: "ncr-mock-1", ncr_no: "QA052/26", status: "awaiting_response", product_name: "ซีลยางปั๊มลม CMP-01", reporter_id: "e3", issue_date: dateOnly(7), response_due: dateOnly(2),
        ...ncrPart1("ซีลยางรั่วซึมหลังประกอบเข้าปั๊มลม วัดความหนาได้ 2.6 มม. สเปค 3.0±0.2 มม.", 200, 14),
        prevention: null, signoff_qa_at: null, signoff_factory_at: null, created_at: ago(7), updated_at: ago(3), ncr_responsibilities: [{ share: 1, department_id: "dep-mt", responder_id: null, department: { code: "MT" } }] },
      // ผู้ใช้จำลองออกเอง รอ QA ติดตามผล → "ใบของฉันที่ยังไม่จบ"
      { id: "ncr-mock-2", ncr_no: "QA049/26", status: "awaiting_followup", product_name: "ยางรองแท่นเครื่อง ล็อต RB-1098", reporter_id: ME_ID, issue_date: dateOnly(10), response_due: dateOnly(5),
        ...ncrPart1("ยางรองแท่นเครื่องมีฟองอากาศที่ผิว พบระหว่างประกอบแท่นเครื่องปั๊มลม", 120, 9),
        root_cause: "แม่พิมพ์ระบายอากาศอุดตัน", correction: "ล้างช่องระบายอากาศและคัดแยกชิ้นงาน", causes: ["machine"],
        prevention: "ตรวจแม่พิมพ์ทุกต้นกะ", signoff_qa_at: null, signoff_factory_at: null, created_at: ago(10), updated_at: ago(1), ncr_responsibilities: [{ share: 1, department_id: "dep-rb", responder_id: null, department: { code: "RB" } }] },
    );
    db.notifications.push(
      { id: "n1", recipient_id: ME_ID, request_id: "req-mt-0412", title: "MT-2569-0412 รอคุณอนุมัติ", body: "แจ้งซ่อมเครื่องฉีดยาง HCM-03 น้ำมันไฮดรอลิกรั่ว", kind: "approval", action_url: null, read_at: null, created_at: ago(0.8) },
      { id: "n2", recipient_id: ME_ID, request_id: "req-ncr-0088", title: "NCR-2569-0088 รอคุณรับทราบ", body: "NCR ยางขอบไม่เต็ม ล็อต RB-1103", kind: "approval", action_url: null, read_at: null, created_at: ago(1.5) },
    );
  }

  // ---- สถานการณ์ NCR (?ncr=1): NCR ครบทุกขั้นของ workflow และทุกบทบาท เก็บลง storage (คีย์ mnp-harness-ncr) ----
  // แถว ncr_reports เก็บความสัมพันธ์ที่หน้าเว็บ embed (ncr_responsibilities, defect_type, reporter_department) ไว้ในตัว
  const NCR_KEY = "mnp-harness-ncr";
  const NCR_TABLES = ["ncr_reports", "ncr_status_history", "ncr_info_requests"];
  const bangkokDate = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
  const addDays = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
  const deptCode = (id) => departments.find((row) => row.id === id)?.code ?? null;
  const responsibility = (departmentId, responderId = null, share = 1) => ({ share, department_id: departmentId, responder_id: responderId, department: { code: deptCode(departmentId), name_th: departments.find((row) => row.id === departmentId)?.name_th ?? "" } });
  const NCR_DEFECT_TYPES = [["dimension", "ขนาดผิด"], ["bubble", "ฟองอากาศ/ผิวไม่เรียบ"], ["short_fill", "ขอบไม่เต็ม"], ["other", "อื่นๆ"]]
    .map(([code, name_th], index) => ({ id: `dt-${code}`, code, name_th, is_active: true, sort_order: index + 1 }));
  let ncrSeq = 100;
  function ncrSeed() {
    const today = bangkokDate(startedAt);
    const report = (no, status, product, reporter, issuedDaysAgo, extra = {}) => {
      const issue_date = addDays(today, -issuedDaysAgo);
      const reporterRow = employees.find((row) => row.id === reporter);
      return {
        id: `ncr-${no.replace("/", "-")}`, ncr_no: no, form_code: "QA02-FM01", status, is_test: false, product_name: product, product_code: null, customer_name: null, po_no: null, lot_no: null,
        reporter_id: reporter, reporter_department_id: reporterRow.department_id, reporter_department: { code: deptCode(reporterRow.department_id) },
        issue_date, response_due: addDays(issue_date, 5), unit: "ชิ้น", source: "in_process", qty_total: 200, qty_sampled: 50, qty_defect: 12, qty_returned: 0,
        defect_type_id: "dt-dimension", defect_type: { name_th: "ขนาดผิด" }, description: `${product} ไม่ได้ตามสเปค พบระหว่างตรวจในกระบวนการ`,
        dispositions: [], disposition_note: null, disposed_by: null, disposed_at: null, causes: [], root_cause: null, correction: null, correction_due: null,
        prevention: null, prevention_due: null, responded_by: null, responded_at: null, followup_note: null, followed_up_by: null, followed_up_at: null,
        signoff_qa_by: null, signoff_qa_at: null, signoff_factory_by: null, signoff_factory_at: null, signoff_gm_by: null, signoff_gm_at: null, closed_at: null,
        cancelled_by: null, cancelled_at: null, cancel_reason: null, created_at: ago(issuedDaysAgo), updated_at: ago(Math.max(0, issuedDaysAgo - 1)), ncr_responsibilities: [],
        ...extra,
      };
    };
    const disposed = (departments_, days) => ({ dispositions: ["sort"], disposed_by: "e5", disposed_at: ago(days), ncr_responsibilities: departments_ });
    const answered = (days, prevention) => ({ causes: ["machine"], root_cause: "แม่พิมพ์สึก ระยะเปิดปิดคลาดเคลื่อน", correction: "ปรับตั้งแม่พิมพ์และคัดแยกชิ้นงาน", responded_by: "e10", responded_at: ago(days), prevention });
    const rows = [
      report("QA060/26", "awaiting_disposition", "ปะเก็นยางฝาถัง TK-200", "e9", 1),
      report("QA058/26", "awaiting_response", "ซีลยางปั๊มลม CMP-01", "e3", 8, { ...disposed([responsibility("dep-rb")], 7) }),
      report("QA057/26", "awaiting_response", "ยางกันกระแทกประตู DR-15", "e3", 3, { ...disposed([responsibility("dep-rb", "e9", 0.5), responsibility("dep-mt", null, 0.5)], 2) }),
      report("QA055/26", "awaiting_followup", "ท่อยางน้ำมัน HS-08", "e1", 9, { ...disposed([responsibility("dep-rb")], 8), ...answered(5, null) }),
      report("QA053/26", "awaiting_followup", "โอริงยาง OR-32", "e9", 10, { ...disposed([responsibility("dep-rb")], 9), ...answered(6, "ตรวจแม่พิมพ์ทุกต้นกะ บันทึกในใบตรวจเครื่อง") }),
      report("QA050/26", "awaiting_signoff", "ยางรองแท่นเครื่อง ล็อต RB-1098", "e1", 14, { ...disposed([responsibility("dep-rb")], 13), ...answered(10, "เปลี่ยนรอบล้างช่องระบายอากาศเป็นทุกวัน"), followed_up_by: "e3", followed_up_at: ago(2) }),
      report("QA048/26", "awaiting_signoff", "บูชยางช่วงล่าง BS-21", "e3", 16, { ...disposed([responsibility("dep-rb")], 15), ...answered(12, "เพิ่มจุดตรวจขนาดหลังอบ"), followed_up_by: "e3", followed_up_at: ago(4), signoff_qa_by: "e11", signoff_qa_at: ago(3) }),
      report("QA046/26", "awaiting_signoff", "แผ่นยางรองพื้น MT-90", "e9", 18, { ...disposed([responsibility("dep-rb")], 17), ...answered(14, "อบรมพนักงานเรื่องการวางชิ้นงาน"), followed_up_by: "e3", followed_up_at: ago(6), signoff_qa_by: "e11", signoff_qa_at: ago(5), signoff_factory_by: "e5", signoff_factory_at: ago(4) }),
      report("QA045/26", "awaiting_info", "ยางขอบกระจก WS-40", "e3", 20, { ...disposed([responsibility("dep-rb")], 19), ...answered(15, "ตรวจความหนืดยางทุกล็อต"), followed_up_by: "e3", followed_up_at: ago(8), signoff_qa_by: "e11", signoff_qa_at: ago(7) }),
      report("QA040/26", "closed", "จุกยางขวด CP-05", "e9", 30, { ...disposed([responsibility("dep-rb")], 29), ...answered(25, "เปลี่ยนสูตรยาง"), followed_up_by: "e3", followed_up_at: ago(20), signoff_qa_by: "e11", signoff_qa_at: ago(19), signoff_factory_by: "e5", signoff_factory_at: ago(18), signoff_gm_by: "e7", signoff_gm_at: ago(17), closed_at: ago(17) }),
    ];
    for (const row of rows) if (row.responded_at) Object.assign(row, { correction_due: row.response_due, prevention_due: addDays(row.response_due, 7) });
    // แก้ล่าสุด = การกระทำล่าสุดของใบ (หน้าหลักนับ "ค้างกี่วัน" จาก updated_at) · QA045/26 ถูกขอข้อมูลเพิ่ม 2 วันก่อน
    for (const row of rows) row.updated_at = [row.created_at, row.disposed_at, row.responded_at, row.followed_up_at, row.signoff_qa_at, row.signoff_factory_at, row.closed_at].filter(Boolean).sort().pop();
    rows.find((row) => row.ncr_no === "QA045/26").updated_at = ago(2);
    return {
      ncr_reports: rows,
      ncr_status_history: rows.map((row, index) => ({ id: index + 1, ncr_id: row.id, from_status: null, to_status: "awaiting_disposition", action: "issue", note: null, changed_by: row.reporter_id, changed_at: row.created_at })),
      ncr_info_requests: [{ id: "info-1", ncr_id: "ncr-QA045-26", step: "factory", request_note: "ขอผลวัดความหนืดของล็อตที่ผลิตหลังปรับแก้", requested_by: "e5", requested_at: ago(2), answer_note: null, answered_by: null, answered_at: null }],
    };
  }
  function ncrPersist() {
    try { storage?.setItem?.(NCR_KEY, JSON.stringify({ seq: ncrSeq, ...Object.fromEntries(NCR_TABLES.map((table) => [table, db[table]])) })); } catch { warnOnce("ncr-storage", "[pilot harness] เก็บข้อมูล NCR ลง storage ไม่ได้ ข้อมูลอยู่ในหน่วยความจำของหน้านี้เท่านั้น"); }
  }
  if (ncr) {
    let saved = null;
    try { saved = JSON.parse(storage?.getItem?.(NCR_KEY) ?? "null"); } catch { saved = null; }
    const data = saved && NCR_TABLES.every((table) => Array.isArray(saved[table])) ? saved : ncrSeed();
    for (const table of NCR_TABLES) db[table] = data[table];
    ncrSeq = Number(data.seq) || ncrSeq;
    db.ncr_defect_types = NCR_DEFECT_TYPES;
    if (!saved) ncrPersist();
  }

  // ---- อ่าน: แถวที่ส่งกลับมีความสัมพันธ์ที่หน้าเว็บ embed ไว้ใน select ติดมาเสมอ (คอลัมน์เกินไม่มีผลกับหน้าเว็บ)
  const pick = (row, keys) => (row ? Object.fromEntries(keys.map((key) => [key, row[key]])) : null);
  function expand(table, row) {
    if (table === "employees") {
      return { ...row, role: pick(roles.find((item) => item.id === row.role_id), ["code", "name_th"]), department: pick(departments.find((item) => item.id === row.department_id), ["code", "name_th"]) };
    }
    if (table === "requests") {
      return {
        ...row,
        request_type: request_types.find((item) => item.id === row.request_type_id) ?? null,
        department: pick(departments.find((item) => item.id === row.department_id), ["code", "name_th"]),
        request_technicians: db.request_technicians.filter((item) => item.request_id === row.id).map((item) => ({ technician_id: item.technician_id })),
        approval_steps: db.approval_steps.filter((item) => item.request_id === row.id).map(({ step_order, step_name, status, acted_at }) => ({ step_order, step_name, status, acted_at: acted_at ?? null })),
        // ฐานข้อมูลจริงคืนประวัติสถานะซ้อนในแถวคำร้องได้ (แดชบอร์ด MT ใช้นับค้างในขั้น)
        request_status_history: db.request_status_history.filter((item) => item.request_id === row.id).map(({ to_status, created_at }) => ({ to_status, created_at })),
      };
    }
    if (table === "approval_steps") {
      const request = db.requests.find((item) => item.id === row.request_id);
      return { ...row, request: request ? expand("requests", request) : null };
    }
    return row;
  }

  const matchesIs = (value, expected) => (expected === null ? value === null || value === undefined : value === expected);
  const likeRegex = (pattern) => new RegExp(`^${String(pattern).replace(/\\([\\%_])|[.*+?^${}()|[\]\\]|%|_/g, (token, escaped) => (escaped ? `\\${escaped}` : token === "%" ? ".*" : token === "_" ? "." : `\\${token}`))}$`, "i");
  const FILTERS = {
    eq: (column, value) => (row) => row[column] === value,
    neq: (column, value) => (row) => row[column] !== value,
    gt: (column, value) => (row) => row[column] > value,
    gte: (column, value) => (row) => row[column] >= value,
    lt: (column, value) => (row) => row[column] < value,
    lte: (column, value) => (row) => row[column] <= value,
    in: (column, values) => (row) => (values ?? []).includes(row[column]),
    is: (column, value) => (row) => matchesIs(row[column], value),
    ilike: (column, pattern) => { const regex = likeRegex(pattern); return (row) => regex.test(String(row[column] ?? "")); },
    not: (column, operator, value) => { const inner = FILTERS[operator]?.(column, value); return inner ? (row) => !inner(row) : () => true; },
  };
  const ok = (data, count = null) => Promise.resolve({ data, error: null, count });
  const failed = (error) => Promise.resolve({ data: null, error: { message: error.code ?? error.message, code: error.code ?? "MOCK_ERROR", details: error.details ?? null }, count: null });

  function compare(left, right, ascending) {
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    return (left < right ? -1 : 1) * (ascending ? 1 : -1);
  }

  function rowsOf(table) {
    if (!db[table]) {
      warnOnce(`table:${table}`, `[pilot harness] Supabase จำลองไม่มีตาราง "${table}" — คืนรายการว่าง`);
      db[table] = [];
    }
    return db[table];
  }

  function run(q) {
    const all = rowsOf(q.table);
    const matches = (row) => q.filters.every((test) => test(row));
    if (q.write === "insert") {
      const inserted = q.payload.map((row) => ({ id: newId(q.table), created_at: stamp(), ...row }));
      all.push(...inserted);
      return ok(q.returning ? clone(q.single ? inserted[0] : inserted) : null);
    }
    if (q.write === "update") {
      const updated = all.filter(matches);
      updated.forEach((row) => Object.assign(row, q.payload));
      return ok(q.returning ? clone(updated) : null);
    }
    if (q.write === "delete") {
      const removed = all.filter(matches);
      db[q.table] = all.filter((row) => !matches(row));
      return ok(q.returning ? clone(removed) : null);
    }
    let rows = all.filter(matches);
    for (const [column, ascending] of [...q.orders].reverse()) rows = [...rows].sort((left, right) => compare(left[column], right[column], ascending));
    const count = rows.length;
    if (q.limit !== null) rows = rows.slice(0, q.limit);
    if (q.head) return ok(null, count);
    const data = rows.map((row) => clone(expand(q.table, row)));
    if (q.single === "maybe") return ok(data[0] ?? null, q.count ? count : null);
    if (q.single === "one") return data.length === 1 ? ok(data[0]) : failed({ code: "PGRST116" });
    return ok(data, q.count ? count : null);
  }

  function query(table) {
    const q = { table, filters: [], orders: [], limit: null, head: false, count: false, single: null, write: null, payload: null, returning: false };
    const builder = {
      select(_columns, options = {}) {
        if (q.write) q.returning = true;
        if (options.head) q.head = true;
        if (options.count) q.count = true;
        return proxy;
      },
      order(column, { ascending = true } = {}) { q.orders.push([column, ascending]); return proxy; },
      limit(count) { q.limit = count; return proxy; },
      maybeSingle() { q.single = "maybe"; return proxy; },
      single() { q.single = "one"; return proxy; },
      insert(rows) { q.write = "insert"; q.payload = Array.isArray(rows) ? rows : [rows]; return proxy; },
      update(patch) { q.write = "update"; q.payload = patch; return proxy; },
      delete() { q.write = "delete"; return proxy; },
      then(resolve, reject) { return run(q).then(resolve, reject); },
    };
    const proxy = new Proxy(builder, {
      get(target, key) {
        if (key in target) return target[key];
        if (typeof key === "string" && FILTERS[key]) return (...args) => { q.filters.push(FILTERS[key](...args)); return proxy; };
        if (typeof key !== "string") return undefined;
        return () => { warnOnce(`method:${key}`, `[pilot harness] Supabase จำลองไม่รองรับ .${key}() — ไม่กรองตามเงื่อนไขนี้`); return proxy; };
      },
    });
    return proxy;
  }

  // ---- เขียน: RPC ที่หน้าเว็บใช้ในเส้นทางอนุมัติ สร้างคำร้อง และงานซ่อม
  const findRow = (table, id, code) => db[table].find((row) => row.id === id) ?? fail(code);
  const typeOf = (request) => request_types.find((row) => row.id === request.request_type_id);
  const stepsOf = (requestId) => db.approval_steps.filter((row) => row.request_id === requestId).sort((left, right) => left.step_order - right.step_order);
  function setStatus(request, to_status, note, at = stamp()) {
    db.request_status_history.push({ id: newId("request_status_history"), request_id: request.id, from_status: request.status, to_status, changed_by: ME_ID, note: note || null, created_at: at });
    Object.assign(request, { status: to_status, updated_at: at });
  }
  function nextRequestNo(prefix) {
    const head = `${prefix}-${YEAR}-`;
    const last = Math.max(0, ...db.requests.filter((row) => row.request_no.startsWith(head)).map((row) => Number(row.request_no.slice(head.length)) || 0));
    return `${head}${String(last + 1).padStart(4, "0")}`;
  }
  function textInRange(value, min, max, code) {
    const text = String(value ?? "").trim();
    if (text.length < min || text.length > max) fail(code);
    return text;
  }
  function createRequest(type, fields) {
    const at = stamp();
    const request = {
      id: newId("requests"), request_no: nextRequestNo(type.prefix), request_type_id: type.id, status: "pending_approval", priority: "normal",
      created_at: at, submitted_at: at, updated_at: at, needed_date: null, requester_id: ME_ID, requester_name: personName(ME_ID), assignee_id: null,
      department_id: ME.department_id, current_step: 1, details: {}, cc_department_ids: [], machine_id: null, machine_code: null, machine_name: null,
      doc_type: null, is_urgent: false, ...fields,
    };
    db.requests.push(request);
    NEW_REQUEST_STEPS[type.code].forEach(([step_name, approver], index) => db.approval_steps.push({
      id: newId("approval_steps"), request_id: request.id, step_order: index + 1, step_name, approver_employee_id: approver, approver_role_id: null,
      approver_department_id: null, status: "pending", acted_by: null, acted_at: null, comment: null, created_at: at,
    }));
    db.request_status_history.push({ id: newId("request_status_history"), request_id: request.id, from_status: null, to_status: "pending_approval", changed_by: ME_ID, note: null, created_at: at });
    return request.id;
  }
  const requireStatus = (request, statuses, code = "INVALID_TRANSITION") => { if (!statuses.includes(request.status)) fail(code); };

  // ---- ข้อมูลของ BOM (โมดูลทดสอบ #/bom): app_bom_master / app_bom_master_since / app_bom_save_master / app_bom_audit และ app_sandbox_purge_bom ----
  // อยู่ในหน่วยความจำและเก็บลง storage ของเครื่องที่เปิดหน้า (คีย์ mnp-harness-bom-master) รีเฟรชแล้วข้อมูลยังอยู่ · ไม่ได้เป็นฐานข้อมูลจริง
  // บังคับสัญญาเดียวกับ RPC จริง: ผู้ทำรายการ = บัญชีทดสอบที่เลือก (โหมดทดสอบ) หรือผู้ใช้จำลองเอง (นอกโหมดทดสอบ 20261130010000) · สิทธิ์ตามหมวดและตามช่องของผู้ทำรายการ:
  //   ฝ่ายวางแผน = admin ผู้จัดการแผนกขึ้นไป หรือแผนก PP ทำได้ทุกอย่าง · ST/WH นับคงคลังของใบร่าง · พนักงานแผนกของงานรายงานผล/เปลี่ยนสถานะงานของแผนกตน (RB ผูก WO) · ที่เหลืออ่านอย่างเดียว
  // ชนรายระเบียน: ทุกระเบียนจำเลขรุ่นที่แก้ล่าสุด (versions) · บันทึกชนเมื่อระเบียนที่แตะถูกผู้อื่นแก้/ลบหลัง p_base_version (BOM_STALE) ระเบียนอื่นไม่ขวาง
  // บันทึกคืนส่วนต่าง { version, changes: { <ชุด>: { upsert, delete } } } ตั้งแต่ p_base_version · ชุดสี/แพ็กเกจ/งานที่ลบจดเป็นหลุมฝังศพ (tombstones)
  // กฎของ BOM ใช้ bom-rules.js ที่หน้าโหลดไว้ (window.MNP_BOM_RULES) ถ้ามี
  // ข้อมูลจริงกับข้อมูลทดสอบแยกกันเหมือน is_test ของฐานข้อมูล: นอกโหมดทดสอบใช้คีย์ -real (โหมดทดสอบไม่เห็นข้อมูลจริง และกลับกัน)
  const BOM_KEY = sandbox ? "mnp-harness-bom-master" : "mnp-harness-bom-master-real";
  const PERSONA_KEY = "mnp-harness-persona";
  const BOM_LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves", "rodLots", "rodMoves",
    "grConfig", "grPlans", "grRecords", "rodRequests", "grHandovers"];
  const BOM_ID = {
    items: (record) => record.code, compounds: (record) => record.code, colors: (record) => record.code, processes: (record) => record.code,
    boms: (record) => record.id, routings: (record) => record.id,
    colorSets: (record) => `${record.base}|${record.code}`, packages: (record) => `${record.base}|${record.code}`,
    customers: (record) => String(record.name ?? "").trim().toLowerCase(), orders: (record) => record.id, jobs: (record) => record.id,
    stock: (record) => record.itemCode, stockMoves: (record) => record.id, fgMoves: (record) => record.id, rodLots: (record) => record.id, rodMoves: (record) => record.id,
    grConfig: (record) => record.key ?? "gr", grPlans: (record) => record.jobId, grRecords: (record) => record.id, rodRequests: (record) => record.id, grHandovers: (record) => record.id,
  };
  // ลำดับของชุดที่หน้าเห็น (ตรงกับ app_bom_master): ใบสั่งผลิตใหม่สุดก่อน · งานเรียงตามใบ แผนก ชิ้นงาน เลขงาน · ชุดอื่นตามกุญแจ
  const bomCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const BOM_ORDER = {
    orders: (a, b) => (Number(b.orderedAt) || 0) - (Number(a.orderedAt) || 0) || bomCmp(a.id, b.id),
    jobs: (a, b) => bomCmp(a.orderId, b.orderId) || bomCmp(a.dept, b.dept) || bomCmp(a.itemCode, b.itemCode) || bomCmp(a.id, b.id),
    stockMoves: (a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || bomCmp(a.id, b.id),
    fgMoves: (a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || bomCmp(a.id, b.id),
    rodLots: (a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || bomCmp(a.id, b.id),
    rodMoves: (a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || bomCmp(a.id, b.id),
    grRecords: (a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || bomCmp(a.id, b.id),
    rodRequests: (a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || bomCmp(a.id, b.id),
    grHandovers: (a, b) => (Number(a.sentAt) || 0) - (Number(b.sentAt) || 0) || bomCmp(a.id, b.id),
  };
  const bomSorter = (list) => BOM_ORDER[list] ?? ((a, b) => bomCmp(BOM_ID[list](a), BOM_ID[list](b)));
  const BOM_DELETABLE = ["colorSets", "packages", "jobs"];
  // หลุมฝังศพจำเป็นข้อมูล { list, base, code, version } · งานใช้ code เป็นเลขงาน (ส่งกลับเป็น { id })
  const graveKey = (row) => (row.list === "jobs" ? row.code : `${row.base}|${row.code}`);
  const targetKey = (list, target) => (list === "jobs" ? String(target?.id ?? "") : `${target?.base}|${target?.code}`);
  // กลุ่มวางแผน (private.bom_can_edit ของ 20261130010000): ผู้ช่วยผู้จัดการโรงงานขึ้นไปทุกแผนก · ผู้จัดการแผนกเฉพาะแผนกในสายผลิต
  const BOM_MANAGER_ROLES = ["assistant_factory_manager", "factory_manager", "general_manager"];
  const BOM_PRODUCTION_DEPTS = ["RB", "GR", "PT", "BG", "PK", "ST", "WH", "QA", "SR"];
  const ORDER_STATUSES = ["draft", "released", "in_progress", "completed", "cancelled"];
  const JOB_STATUSES = ["queued", "in_progress", "done", "hold"];
  const JOB_DEPTS = ["PK", "GR", "RB", "PT", "BG", "ST"];
  let bomMaster = null;
  // รหัสรอบข้อมูล (bom_master_state.epoch): เปลี่ยนเฉพาะตอนล้างข้อมูลทดสอบ · ตัวนับ version ไม่ถูกตั้งกลับ
  const newEpoch = () => globalThis.crypto?.randomUUID?.() ?? `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const freshBom = () => ({ version: 0, epoch: newEpoch(), ...Object.fromEntries(BOM_LISTS.map((list) => [list, []])), versions: Object.fromEntries(BOM_LISTS.map((list) => [list, {}])), tombstones: [], audit: [] });
  function bomLoad() {
    if (!bomMaster) {
      try { bomMaster = JSON.parse(storage?.getItem?.(BOM_KEY) ?? "null"); } catch { bomMaster = null; }
      if (!bomMaster || typeof bomMaster.version !== "number") bomMaster = freshBom();
      if (typeof bomMaster.epoch !== "string") bomMaster.epoch = newEpoch();
      for (const list of BOM_LISTS) if (!Array.isArray(bomMaster[list])) bomMaster[list] = [];
      bomMaster.versions = Object.fromEntries(BOM_LISTS.map((list) => [list, bomMaster.versions?.[list] ?? {}]));
      if (!Array.isArray(bomMaster.tombstones)) bomMaster.tombstones = [];
      if (!Array.isArray(bomMaster.audit)) bomMaster.audit = [];
    }
    return bomMaster;
  }
  function bomPersist() {
    try { storage?.setItem?.(BOM_KEY, JSON.stringify(bomMaster)); } catch { warnOnce("bom-storage", "[pilot harness] เก็บข้อมูล BOM ลง storage ไม่ได้ ข้อมูลอยู่ในหน่วยความจำของหน้านี้เท่านั้น"); }
  }
  // ที่หน้าเห็น (ตรงกับ app_bom_master): ไม่มีข้อมูลภายใน (versions / tombstones / audit)
  // grWorkers (แปรรูปยาง GR · 20261216010000): พนักงาน active ของแผนก GR ในโหมดนั้น มากับ snapshot เท่านั้น ส่วนต่างเป็นชุดว่างเสมอ
  const bomView = (current) => ({ version: current.version, epoch: current.epoch, ...Object.fromEntries(BOM_LISTS.map((list) => [list, clone(current[list]).sort(bomSorter(list))])), grWorkers: bomGrWorkers() });
  // ส่วนต่างตั้งแต่เวอร์ชัน since (ตรงกับ private.bom_delta): ครบทุกชุด delete มีเฉพาะชุดสี/แพ็กเกจ/งาน
  function bomDelta(current, since) {
    const changes = {};
    for (const list of BOM_LISTS) {
      const upsert = current[list].filter((row) => (current.versions[list][BOM_ID[list](row)] ?? 0) > since).sort(bomSorter(list));
      const deleted = current.tombstones.filter((row) => row.list === list && row.version > since).map((row) => (list === "jobs" ? { id: row.code } : { base: row.base, code: row.code }));
      changes[list] = { upsert: clone(upsert), delete: deleted };
    }
    changes.grWorkers = { upsert: [], delete: [] };
    return { version: current.version, epoch: current.epoch, changes };
  }

  // ---- บัญชีทดสอบ (persona) ของโหมดทดสอบ: เลือกที่แถบ "ทำหน้าที่เป็น" (app_sandbox_enter) แล้วสิทธิ์ของ BOM ตามแผนกของบัญชีนั้น ----
  // บัญชีแรกคือผู้ใช้จำลองเอง (admin) เหมือนเดิม · ที่เหลือเป็นพนักงานธรรมดา (role staff) ของแต่ละแผนก เพื่อลองสิทธิ์ว่าใครทำอะไรได้
  const PERSONA_SPECS = [
    ["persona-pp", "สมศรี", "วางแผน", "เจ้าหน้าที่วางแผน (PP)", "PP", "ฝ่ายวางแผน"],
    ["persona-rb", "ประยุทธ", "รีดยาง", "พนักงานแผนก RB", "RB", "ฝ่ายผลิต RB"],
    // หัวหน้าแผนก RB (ผู้จัดการแผนก): อนุมัติสูตร/ปล่อยผลิตของ RubberFlow ได้ · ตำแหน่งที่ 7 = รหัสบทบาท (ไม่ระบุ = พนักงาน staff)
    ["persona-rbh", "สุรีย์", "หัวหน้ารีด", "หัวหน้าแผนก RB", "RB", "ฝ่ายผลิต RB", "department_manager"],
    ["persona-gr", "มานี", "ตัดยาง", "พนักงานแผนก GR", "GR", "ฝ่ายผลิต GR"],
    // หัวหน้าแผนก GR (ผู้ช่วยผู้จัดการแผนก: ไม่อยู่ในกลุ่มวางแผน เหมือนบัญชีทดสอบ SBX-GR-AMGR): ตั้งค่าขั้นตอน / ตั้งขั้นตอนของงาน / บันทึกและแก้ผลของทุกคน / ส่งงานให้ PK (20261216010000)
    ["persona-grh", "วิไล", "หัวหน้าแปรรูป", "หัวหน้าแผนก GR (ผู้ช่วยผู้จัดการแผนก)", "GR", "ฝ่ายผลิต GR", "assistant_department_manager"],
    ["persona-st", "วิชัย", "คลังวัตถุดิบ", "พนักงานคลังวัตถุดิบ (ST)", "ST", "คลังวัตถุดิบ"],
    // หัวหน้าแผนก ST (ผู้จัดการแผนก): ปล่อยวัตถุดิบที่กักได้เหมือนหัวหน้า QA (private.material_release_ok · 20261221010000 · คำสั่งเจ้าของ 2026-11-24)
    //   แต่ไม่ได้ตัดสินล็อตที่กักของสายผลิตหรือยางเส้นยาวที่ SR กัก (หัวหน้า QA เท่านั้น)
    ["persona-sth", "ประสิทธิ์", "หัวหน้าคลังวัตถุดิบ", "หัวหน้าแผนกคลังวัตถุดิบ (ST)", "ST", "คลังวัตถุดิบ", "department_manager"],
    // SR = คลังยางเส้นยาวของ BOM (รับเข้าคลัง ตรวจขนาด รับนอกใบสั่ง ย้ายตำแหน่ง ปรับยอด จ่ายให้ GR · 20261202010000 / 20261204010000)
    // ใบส่งมอบ WIP ของ RubberFlow รับมอบโดยแผนก RB แล้ว (SR ดู RubberFlow ได้อย่างเดียว)
    ["persona-sr", "ศิริ", "รับมอบ", "พนักงานแผนก SR (คลังยางเส้นยาว)", "SR", "คลังยางเส้นยาว"],
    ["persona-wh", "สุดา", "คลังสินค้า", "พนักงานคลังสินค้า (WH)", "WH", "คลังสินค้า"],
    // หัวหน้าแผนก WH (ผู้จัดการแผนก): BOM นับเป็นบทบาท manager แต่แผนกคือ WH จึงรับเข้าคลัง/ส่งมอบสินค้าสำเร็จรูปได้เหมือนพนักงาน WH และย้อนรายการที่บันทึกผิดได้ (reverseFg · 20261128020000) ซึ่งพนักงาน WH ทำไม่ได้
    ["persona-whh", "ชัย", "หัวหน้าคลัง", "หัวหน้าแผนกคลังสินค้า (WH)", "WH", "คลังสินค้า", "department_manager"],
    // พนักงาน QA: บันทึกผลตรวจ กักล็อต / วัตถุดิบ · การตัดสินล็อตที่กักเป็นของหัวหน้า QA ตั้งแต่ 20261221010000 (persona-qah)
    ["persona-qa", "ธนา", "ตรวจสอบ", "เจ้าหน้าที่ QA (ตรวจคุณภาพ)", "QA", "ประกันคุณภาพ"],
    // หัวหน้าแผนก QA (ผู้จัดการแผนก เหมือน SBX-QA-MGR): ปล่อย / ตัดสินล็อตที่กักของสายผลิต ตัดสินยางเส้นยาวที่ SR กัก และปล่อยวัตถุดิบที่กัก (private.qa_head · 20261221010000)
    //   พนักงาน QA (persona-qa) ยังบันทึกผลตรวจ กัก และบันทึกผลบนล็อตที่ไม่ได้กักได้
    ["persona-qah", "อรุณี", "หัวหน้าตรวจสอบ", "หัวหน้าแผนก QA (ตรวจคุณภาพ)", "QA", "ประกันคุณภาพ", "department_manager"],
    // พนักงานแผนกผลิตที่เหลือ (PK บรรจุ · PT ฉีดพลาสติก · BG เย็บกระเป๋า): ลองรายงานผล / พักงานของแผนกตัวเอง และดูว่าแผนกอื่นทำแทนไม่ได้
    ["persona-pk", "ปรีชา", "บรรจุ", "พนักงานแผนก PK (บรรจุ)", "PK", "ฝ่ายผลิต PK"],
    ["persona-pt", "พิมพ์ใจ", "ฉีดพลาสติก", "พนักงานแผนก PT (ฉีดพลาสติก)", "PT", "ฝ่ายผลิต PT"],
    ["persona-bg", "บุญมา", "เย็บกระเป๋า", "พนักงานแผนก BG (เย็บกระเป๋า)", "BG", "ฝ่ายผลิต BG"],
  ];
  // ใบสั่งงาน IT (?itwo=1): ฐานข้อมูลจำลองเก็บในหน่วยความจำ ผู้ทำรายการ = persona ที่เลือกอยู่ (currentPersona) · createItwoMock ถูกฉีดมากับสคริปต์ของเบราว์เซอร์ (mockSupabaseScript)
  // objectKeys = ไฟล์ที่ "อัปโหลดแล้ว" ใน Storage จำลอง (คีย์ "<bucket>/<path>") ให้ app_itwo_add_attachment ตรวจว่าไฟล์อยู่จริง และ app_sandbox_purge_itwo คืนรายการไฟล์ทดสอบให้ลบ
  const objectKeys = new Set();
  const objectMimes = new Map(); // คีย์เดียวกับ objectKeys → mimetype ที่ Storage จดไว้ตอนอัปโหลด (ฐานข้อมูลจริงอ่านชนิดไฟล์จากค่านี้)
  const itwoMock = sandbox && itwo
    ? createItwoMock({
      stamp: () => stamp(), now: () => now(), persona: () => currentPersona(), personas: () => personaRows(),
      hasObject: (bucket, path) => objectKeys.has(`${bucket}/${path}`),
      objectMime: (bucket, path) => objectMimes.get(`${bucket}/${path}`) ?? null,
      listObjects: (bucket) => [...objectKeys].filter((key) => key.startsWith(`${bucket}/`)).map((key) => key.slice(bucket.length + 1)).sort(),
    })
    : null;
  const personaRows = () => [
    { ...expand("employees", ME), id: "persona-1", job_title: "บัญชีทดสอบ ผู้จัดการแผนก" },
    ...(itwoMock ? itwoMock.personaRows(expand("employees", ME)) : []),
    ...PERSONA_SPECS.map(([id, first_name, last_name, job_title, dept, deptName, roleCode]) => ({
      ...expand("employees", ME), id, employee_no: `T-${dept}${roleCode ? "H" : ""}`, first_name, last_name, job_title,
      role: roleCode ? { code: roleCode, name_th: "ผู้จัดการแผนก" } : { code: "staff", name_th: "พนักงาน" }, department: { code: dept, name_th: deptName },
    })),
  ];
  let personaId = null;
  function currentPersona() {
    if (personaId === null) { try { personaId = storage?.getItem?.(PERSONA_KEY) ?? "persona-1"; } catch { personaId = "persona-1"; } }
    const rows = personaRows();
    return rows.find((row) => row.id === personaId) ?? rows[0];
  }
  // ---- พนักงานจริง (นอกโหมดทดสอบ ?real=<รหัส>): ผู้ใช้จำลองได้แผนก / ตำแหน่งของบัญชีทดสอบชื่อนั้น (ชื่อเดียวกัน) แผนกที่ยังไม่มีในรายการถูกเพิ่ม ----
  const REAL_SPEC = !sandbox && real ? PERSONA_SPECS.find(([id]) => id === `persona-${String(real).toLowerCase()}`) ?? null : null;
  if (REAL_SPEC) {
    const [, first_name, last_name, job_title, dept, deptName, roleCode] = REAL_SPEC;
    let department = departments.find((row) => row.code === dept);
    if (!department) {
      department = { id: `dep-${dept.toLowerCase()}`, code: dept, name_th: deptName, is_active: true, is_repair_site: false };
      departments.push(department);
    }
    Object.assign(ME, { first_name, last_name, job_title, department_id: department.id, role_id: roles.find((row) => row.code === (roleCode ?? "staff"))?.id ?? "role-staff" });
  }
  // ผู้ทำรายการของ BOM / RubberFlow (private.bom_actor / rf_actor): โหมดทดสอบ = บัญชีทดสอบที่เลือก · นอกโหมดทดสอบ = ผู้ใช้จำลองเอง
  // นอกโหมดทดสอบผู้ใช้จำลองต้อง active และอยู่ในกลุ่มที่ใช้ข้อมูลของโมดูลนั้นได้ ไม่เช่นนั้น code (BOM_FORBIDDEN / RF_FORBIDDEN) เหมือน private.bom_reader / rf_reader
  const requireActor = (code) => {
    if (!sandbox && ME.is_active === false) fail(code);
    const actor = bomActor();
    if (!sandbox && !(code === "RF_FORBIDDEN" ? rfCanRead(actor) : bomCanRead(actor))) fail(code);
    return actor;
  };
  const bomActor = () => {
    const persona = sandbox ? currentPersona() : expand("employees", ME);
    // id = รหัสพนักงานของผู้ทำรายการ (ผลรายวันของ GR: ผู้ทำ / ผู้ขอเบิก เทียบกับ id นี้)
    return { id: persona.id, name: `${persona.first_name ?? ""} ${persona.last_name ?? ""}`.trim(), role: persona.role?.code ?? "", dept: String(persona.department?.code ?? "").toUpperCase() };
  };
  const bomIsPlanner = (actor) => actor.role === "admin" || BOM_MANAGER_ROLES.includes(actor.role) || actor.dept === "PP"
    || (actor.role === "department_manager" && BOM_PRODUCTION_DEPTS.includes(actor.dept));
  // หัวหน้า QA (private.qa_head ของ 20261221010000): แผนก QA บทบาท department_manager / assistant_department_manager หรือ factory_manager / general_manager / admin
  //   (ไม่รวม assistant_factory_manager) · ผู้ตัดสินล็อตที่กักของสายผลิต (ผล pass / fail = RF_QA_HEAD_ONLY) ยางเส้นยาวที่กัก (decideRods = BOM_QA_HEAD_ONLY) และปล่อยวัตถุดิบที่กัก
  const qaHead = (actor) => (actor.dept === "QA" && ["department_manager", "assistant_department_manager"].includes(actor.role))
    || ["factory_manager", "general_manager", "admin"].includes(actor.role);
  // ผู้ปล่อยวัตถุดิบที่กัก (private.material_release_ok ของ 20261221010000): หัวหน้า QA หรือหัวหน้า ST (แผนก ST บทบาท department_manager / assistant_department_manager)
  //   ปฏิเสธ = RF_MATERIAL_RELEASE_HEAD_ONLY
  const materialReleaseOk = (actor) => qaHead(actor)
    || (actor.dept === "ST" && ["department_manager", "assistant_department_manager"].includes(actor.role));
  // ใครใช้ข้อมูลจริงได้ (private.bom_can_read / rf_can_read): กลุ่มวางแผน หรือพนักงานแผนกของโมดูล · โหมดทดสอบทุก persona อ่านได้เหมือนเดิม
  // SR และ QA อ่าน BOM ได้ตั้งแต่ 20261202010000 (คลังแท่งยาว: SR รับเข้า / จ่ายให้ GR · QA ตัดสินล็อตที่กัก)
  const bomCanRead = (actor) => bomIsPlanner(actor) || ["RB", "GR", "PT", "BG", "PK", "ST", "WH", "SR", "QA"].includes(actor.dept);
  const rfCanRead = (actor) => bomIsPlanner(actor) || ["RB", "ST", "QA", "SR", "WH"].includes(actor.dept);
  const bomCanon = (value) => (Array.isArray(value) ? `[${value.map(bomCanon).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${bomCanon(value[key])}`).join(",")}}` : JSON.stringify(value) ?? "null");
  const bomWithout = (record, keys) => Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => !keys.includes(key)));
  // ฟิลด์ที่ฐานข้อมูลจริงเป็นเจ้าของ (เวลาที่สร้าง/แก้/อนุมัติ/ถูกแทนที่ และชื่อผู้บันทึก): ประทับใหม่ทับค่าที่ client ส่งมา ไม่เก็บระเบียนของ client ตรงๆ
  // ระเบียนที่บันทึกจึงต่างจากที่ client เห็นก่อนบันทึกเหมือน RPC จริง (client ต้องไม่ถือว่า "เนื้อหาเปลี่ยน" คือมีผู้อื่นบันทึก)
  function bomStamp(list, record, old, actor, at) {
    const who = actor.name;
    const out = clone(record);
    if (list === "items") { out.createdAt = old?.createdAt ?? at; out.updatedAt = at; }
    else if (list === "compounds" || list === "colors") out.createdAt = old?.createdAt ?? at;
    else if (list === "colorSets" || list === "packages") {
      out.createdAt = old?.createdAt ?? at; out.createdBy = old?.createdBy ?? who;
      out.updatedAt = at; out.updatedBy = who;
    } else if (list === "boms" || list === "routings") {
      out.createdAt = old?.createdAt ?? at; out.createdBy = old?.createdBy ?? who;
      if (list === "boms") { out.approvedAt = old?.approvedAt ?? at; out.approvedBy = old?.approvedBy ?? who; }
      if (out.status === "superseded") out.supersededAt = old?.status === "superseded" ? old.supersededAt : at;
      else delete out.supersededAt;
    } else if (list === "orders") {
      out.createdAt = old?.createdAt ?? at; out.createdBy = old?.createdBy ?? who;
      // เวลา/ชื่อผู้นับคงคลังฐานข้อมูลประทับเอง เมื่อยอดนับเปลี่ยน
      if (bomCanon(old?.stockCounts ?? {}) !== bomCanon(record.stockCounts ?? {})) { out.stockCountedAt = at; out.stockCountedBy = who; }
      else if (old) { out.stockCountedAt = old.stockCountedAt; out.stockCountedBy = old.stockCountedBy; if (out.stockCountedAt === undefined) delete out.stockCountedAt; if (out.stockCountedBy === undefined) delete out.stockCountedBy; }
      // เหตุผลที่ยกเลิกเก็บแบบตัดช่องว่างหัวท้าย (ตรงกับ bom_text ของ bom_save_orders)
      if (old && old.status !== "cancelled" && record.status === "cancelled") out.cancelReason = String(record.cancelReason ?? "").trim();
    } else if (list === "jobs") {
      out.createdAt = old?.createdAt ?? at;
      // รายงานผลเป็นแบบเพิ่มต่อท้ายเท่านั้น: รายการใหม่ฐานข้อมูลใส่ชื่อผู้รายงานและเวลาเอง · doneAt ตั้งเมื่องานเปลี่ยนเป็นเสร็จ
      const kept = Array.isArray(old?.reports) ? old.reports.length : 0;
      out.reports = (Array.isArray(record.reports) ? record.reports : []).map((entry, index) => (index < kept ? old.reports[index] : { ...entry, by: who, at }));
      // เหตุผลของการพักงาน (bomJobClosing ตรวจแล้ว): เซิร์ฟเวอร์เขียนรายการเองพร้อมเครื่องหมาย kind = hold (ตรงกับ bom_save_jobs ของ 20261128010000)
      const added = out.reports.length - kept;
      if (old && added === 1 && record.status === "hold" && old.status !== "hold" && bomZeroReport(out.reports.at(-1))) {
        out.reports[out.reports.length - 1] = { at, by: who, good: 0, reject: 0, note: String(out.reports.at(-1).note ?? "").trim(), kind: "hold" };
      }
      if (record.status === "done" && old?.status !== "done") out.doneAt = at;
      else if (old?.doneAt !== undefined) out.doneAt = old.doneAt;
    }
    return out;
  }
  // สิทธิ์ตามหมวดและตามช่อง (เทียบระเบียนเดิมกับระเบียนใหม่) · prev = null เมื่อเป็นระเบียนใหม่
  // งานของซื้อของ ST (PURCHASED / ST): ช่องผลงานเปลี่ยนได้ทางเดียวคือ issueOrderParts (ตรงกับด่านใน bom_save_jobs) · คืน "part" = ให้ bomApply ข้ามการเขียนแถวนี้ (bom_issue_parts เขียนเอง)
  const bomIsPartJob = (job) => job?.dept === "ST" && job?.kind === "PURCHASED";
  // ฝ่ายวางแผนปิดงานพร้อมเหตุผล (ตรงกับ bom_save_jobs ของ 20261125010000): setJobStatus งานที่ยังไม่ done → done พร้อมรายการรายงานใหม่หนึ่งรายการท้ายสุดที่ยอดดีและเสียเป็น 0
  // รายการยอด 0 แบบอื่น (พนักงานแผนก action อื่น ไม่ได้ปิดงาน) รับไม่ได้เหมือน private.bom_parse_reports · ตรวจก่อนสิทธิ์และสาขาของซื้อ (ลำดับเดียวกับ SQL)
  const bomZeroReport = (entry) => !(Number(entry?.good) || 0) && !(Number(entry?.reject) || 0);
  // พักงานพร้อมเหตุผล (ตรงกับ bom_save_jobs ของ 20261128010000): setJobStatus งานที่ยังไม่ hold → hold พร้อมรายการใหม่หนึ่งรายการยอด 0 ที่มีเหตุผล 3-200 (ทุกบทบาทที่เปลี่ยนสถานะงานได้)
  // คืน "close" (ปิดงานโดยฝ่ายวางแผน) · "hold" (เหตุผลของการพัก) · "" (ไม่ใช่ทั้งสอง)
  function bomJobClosing(prev, record, actor, action) {
    const kept = Array.isArray(prev.reports) ? prev.reports.length : 0;
    const added = (Array.isArray(record.reports) ? record.reports : []).slice(kept);
    const closing = bomIsPlanner(actor) && action === "setJobStatus" && record.status === "done" && prev.status !== "done" && added.length === 1 && bomZeroReport(added[0]);
    const holding = !closing && action === "setJobStatus" && record.status === "hold" && prev.status !== "hold" && added.length === 1 && bomZeroReport(added[0]);
    if (closing || holding) {
      const note = typeof added[0]?.note === "string" ? added[0].note.trim() : "";
      if (note.length < 3 || note.length > 200) fail("BOM_INVALID_JOB");
    } else if (added.some(bomZeroReport)) fail("BOM_INVALID_JOB");
    return closing ? "close" : holding ? "hold" : "";
  }
  function bomCheckRecord(list, prev, record, actor, action = "") {
    const planner = bomIsPlanner(actor);
    if (list === "jobs" && prev) bomJobClosing(prev, record, actor, action);
    if (list === "jobs" && prev && ["status", "qtyDone", "qtyReject", "reports"].some((key) => bomCanon(prev[key] ?? null) !== bomCanon(record[key] ?? null)) && (bomIsPartJob(prev) || bomIsPartJob(record))) {
      if (action !== "issueOrderParts") fail("BOM_INVALID_TRANSITION");
      return "part";
    }
    if (list === "orders" && prev && !planner) {
      // ผู้ที่ไม่ใช่ฝ่ายวางแผนแก้ใบได้เฉพาะยอดนับคงคลังของใบร่าง (ST/WH)
      const counted = ["stockCounts", "stockCountedAt", "stockCountedBy"];
      const ok = ["ST", "WH"].includes(actor.dept) && prev.status === "draft" && record.status === "draft" && bomCanon(bomWithout(prev, counted)) === bomCanon(bomWithout(record, counted));
      if (!ok) fail("BOM_FORBIDDEN");
      // ST / WH นับได้เฉพาะชิ้นในผลระเบิดของใบ (ตรงกับ bom_save_orders ของ 20261202010000): ทุกคีย์ที่เพิ่ม / แก้ / ลบ ต้องเป็นรหัสของบรรทัดผลระเบิดที่ไม่ใช่ RB และไม่ใช่สินค้าของใบ
      // (คีย์สินค้า = ใช้จากสต็อกสินค้าสำเร็จรูป · คีย์ RB = ใช้จากคลัง SR ตั้งได้เฉพาะกลุ่มวางแผน) · ใบที่ยังไม่มีผลระเบิด หรือรหัสนอกผลระเบิด = BOM_FORBIDDEN · คีย์จัดรูปแบบ private.bom_code
      const countsOf = (row) => Object.fromEntries(Object.entries(row.stockCounts && typeof row.stockCounts === "object" ? row.stockCounts : {}).map(([key, value]) => [bomCode(key), value]));
      const before = countsOf(prev);
      const after = countsOf(record);
      const products = new Set((prev.items ?? []).map((item) => item.fgCode));
      const countable = new Set((Array.isArray(prev.explosion) ? prev.explosion : []).filter((line) => line?.kind !== "RB" && !products.has(line?.itemCode)).map((line) => line.itemCode));
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (bomCanon(before[key] ?? null) !== bomCanon(after[key] ?? null) && !countable.has(key)) fail("BOM_FORBIDDEN");
      }
      return;
    }
    if (list === "jobs" && prev && !planner) {
      const own = ["status", "qtyDone", "qtyReject", "reports", "doneAt", ...(actor.dept === "RB" ? ["externalRef"] : [])];
      const workChanged = ["status", "qtyDone", "qtyReject", "reports"].some((key) => bomCanon(prev[key] ?? null) !== bomCanon(record[key] ?? null));
      // แผนกอื่นแก้ชื่อ จำนวนแผน วันครบกำหนด ฯลฯ ไม่ได้ · รายงาน/สถานะ/ยอดแก้ได้เฉพาะพนักงานแผนกเดียวกับงาน (ตรงกับ bom_save_jobs)
      if (bomCanon(bomWithout(prev, own)) !== bomCanon(bomWithout(record, own))) fail("BOM_FORBIDDEN");
      if (workChanged && actor.dept !== prev.dept) fail("BOM_FORBIDDEN");
      // ผูก WO: แผนก RB เฉพาะงานที่ยังไม่ผูก และห้ามถอด
      const extOf = (ref) => (ref ? bomCanon(bomWithout(ref, ["linkedAt", "by"])) : "null");
      if (extOf(prev.externalRef) !== extOf(record.externalRef) && (actor.dept !== "RB" || prev.externalRef || !record.externalRef)) fail("BOM_FORBIDDEN");
      return;
    }
    if (!planner) fail("BOM_FORBIDDEN");
  }
  // สถานะของใบ (ตรงกับ bom_save_orders): ใบใหม่ต้องเป็น draft · draft→released (ต้องมีสินค้า ระเบิดแล้ว และมีงานในคำสั่งเดียวกัน) · released→in_progress (มากับงาน) ·
  // → completed ทุกกรณี = BOM_FORBIDDEN สำหรับทุกคน (ใบปิดเองเมื่อคลังสินค้า WH รับเข้าครบ หรือปิดรับไม่ครบ: bomFgMoves · หรือตอนปล่อยผลิตที่ได้ครบทุกสินค้าจากสต็อกสินค้าสำเร็จรูป: bomReleaseFgStock) · ที่ยังไม่จบ→cancelled (ต้องมีเหตุผล 3-200 · งานของใบคงอยู่ · WO ที่ผูกถูกยกเลิก / หยุด ยกเว้น completed: 20261128010000) ·
  // released/in_progress→draft เฉพาะเปิดใบกลับมาแก้ (ห้ามถ้ามีงานเริ่ม; งานของใบถูกลบ) · ยกเลิก / เปิดกลับมาแก้ ห้ามถ้าส่งมอบแล้วหรือให้สินค้าใบอื่นไปแล้ว ไม่งั้นคืนสต็อกที่ได้มา (returnFgStock) · เนื้อหา/ยอดนับแก้ได้เฉพาะใบ draft
  const BOM_ORDER_CONTENT = ["customer", "country", "orderType", "orderedAt", "whDue", "due", "dueDefaults", "items", "explosion", "note"];
  const bomOrderContent = (row) => bomCanon(Object.fromEntries(BOM_ORDER_CONTENT.map((key) => [key, row[key] ?? null])));
  function bomOrderPassThrough(prev, record, jobRows) {
    if (!ORDER_STATUSES.includes(record.status) || !Array.isArray(record.items)) return false;
    if (bomOrderContent(prev) !== bomOrderContent(record)) return false;
    if (bomCanon(prev.stockCounts ?? {}) !== bomCanon(record.stockCounts ?? {})) return false;
    if (prev.status === record.status) return true;
    if (prev.status === "released" && record.status === "in_progress") {
      if (!jobRows.some((job) => String(job?.orderId ?? "").toUpperCase() === String(record.id).toUpperCase())) fail("BOM_INVALID_TRANSITION");
      return true;
    }
    return false;
  }
  function bomOrderTransition(prev, record, ctx) {
    if (!ORDER_STATUSES.includes(record.status) || !Array.isArray(record.items)) fail("BOM_INVALID_ORDER");
    // เหตุผลที่ยกเลิก: ข้อความไม่เกิน 200 ตัวอักษรหลังตัดช่องว่าง (bom_text ของ bom_save_orders)
    if (record.cancelReason !== undefined && record.cancelReason !== null && (typeof record.cancelReason !== "string" || record.cancelReason.trim().length > 200)) fail("BOM_INVALID_ORDER");
    if (!prev) {
      if (record.status !== "draft") fail("BOM_INVALID_TRANSITION");
      return;
    }
    const from = prev.status;
    const to = record.status;
    if (to === "completed" && from !== "completed") fail("BOM_FORBIDDEN");
    const content = bomOrderContent(prev) !== bomOrderContent(record);
    const counts = bomCanon(prev.stockCounts ?? {}) !== bomCanon(record.stockCounts ?? {});
    const statusChanged = from !== to;
    if (!content && !counts && !statusChanged) return;
    // released → in_progress ที่มากับงานของใบนี้ (ฐานข้อมูลตั้งเองตอนงานเริ่ม) ไม่ถือเป็นการแก้ใบ
    if (statusChanged && from === "released" && to === "in_progress" && !content && !counts) {
      if (!ctx.jobRows.some((job) => String(job?.orderId ?? "").toUpperCase() === String(record.id).toUpperCase())) fail("BOM_INVALID_TRANSITION");
      return;
    }
    if (counts && from !== "draft") fail("BOM_INVALID_TRANSITION");
    if (content && from !== "draft" && to !== "draft") fail("BOM_INVALID_TRANSITION");
    if (!statusChanged) return;
    const jobs = ctx.jobsOf(prev.id);
    // ยกเลิกต้องมีเหตุผล 3-200 ตัวอักษรหลังตัดช่องว่าง (ตรงกับ bom_save_orders ของ 20261128010000: BOM_INVALID_ORDER)
    const reasonOk = () => { const reason = String(record.cancelReason ?? "").trim(); if (reason.length < 3) fail("BOM_INVALID_ORDER"); };
    if (from === "draft" && to === "released") {
      if (!record.items.length || !record.explosion) fail("BOM_INVALID_TRANSITION");
      ctx.released.push(prev.id);
    } else if (from === "draft" && to === "cancelled") {
      reasonOk();
    } else if ((from === "released" || from === "in_progress") && to === "cancelled") {
      // งานที่มียอดไม่กันการยกเลิกแล้ว · งานของใบคงอยู่ (ไม่ลบ) · WO ที่ผูก: planned / released ยกเลิก in_progress / on_hold หยุด completed คงเดิม
      reasonOk();
      ctx.returnFgStock(prev.id);
      ctx.rfCancel.push(bomRfCancelOp("cancelOrder", jobs));
    } else if ((from === "released" || from === "in_progress") && to === "draft") {
      if (jobs.some(bomJobStarted)) fail("BOM_INVALID_TRANSITION");
      // คลังแท่งยาว: SR จ่ายแท่งให้ GR ตามใบนี้แล้ว (จ่ายสุทธิหลังย้อนจ่าย > 0) = งานเริ่มแล้ว เปิดกลับไม่ได้ (ตรงกับ bom_save_orders ของ 20261202010000)
      if ((ctx.rodIssued?.(prev.id) ?? 0) > 1e-9) fail("BOM_INVALID_TRANSITION");
      if (Number(record.revision) !== Number(prev.revision) + 1) fail("BOM_INVALID_TRANSITION");
      ctx.rfCancel.push(bomRfCancelOp("reopenOrder", jobs));
      ctx.returnFgStock(prev.id);
      // แท่งที่ใบหยิบจากคลังแท่งยาวตอนปล่อยผลิตกลับเข้าสต็อกกลาง (ยกเลิกใบไม่ต้อง: ถังของใบที่ยกเลิกเป็นสต็อกกลางเอง)
      ctx.returnRodStock?.(prev.id);
      ctx.dropJobs(prev.id);
    } else fail("BOM_INVALID_TRANSITION");
  }
  // WO ของ RubberFlow ที่เลย "ปล่อยผลิต" ไปแล้ว (กำลังผลิต พัก เสร็จ) = เริ่มแล้ว · WO ที่ยังเป็นแผนก/ปล่อยผลิต (รวมที่เปิดอัตโนมัติตอนปล่อยใบ) ยังไม่นับ
  const RF_WO_STARTED = ["in_progress", "on_hold", "completed"];
  // WO ที่ผูกงานต้องชี้กลับมาที่งานนี้ด้วย (sourceJobId) ไม่งั้นถือว่าไม่พบ (ตรงกับ bom_started_jobs / bom_cancel_rf_orders)
  const bomRfWoOf = (job) => (job.externalRef?.woId ? rfLoad().orders.find((row) => row.id === job.externalRef.woId && row.sourceJobId === job.id) : undefined);
  // งานที่เริ่มแล้ว (ตรงกับกฎ startedJobs ของหน้า): สถานะไม่ใช่รอคิว มีรายงาน ยอดดี/เสีย หรือผูก WO ของ RubberFlow ที่เริ่มแล้ว (หรือหา WO ไม่พบ)
  const bomJobStarted = (job) => job.status !== "queued" || Number(job.qtyDone) > 0 || Number(job.qtyReject) > 0 || (Array.isArray(job.reports) && job.reports.length > 0)
    || (Boolean(job.externalRef) && (!bomRfWoOf(job) || RF_WO_STARTED.includes(bomRfWoOf(job).status)));
  // ยกเลิกใบ / เปิดใบกลับมาแก้: WO ที่ผูกงานของใบ planned / released = ยกเลิก · in_progress / on_hold = หยุด (cancelled เหมือนกัน ยอดและล็อตคงอยู่) · completed / cancelled คงเดิม
  // ไม่ปฏิเสธด้วย BOM_RF_ORDER_STARTED อีก (ตรงกับ private.bom_cancel_rf_orders ของ 20261128010000) · เปิดใบกลับมาแก้ยังห้ามเมื่อ WO เลย released (bomJobStarted ด้านบน)
  const RF_WO_STOPPABLE = ["planned", "released", "in_progress", "on_hold"];
  function bomRfCancelOp(action, jobs) {
    const woIds = [];
    for (const job of [...jobs].sort((a, b) => bomCmp(a.id, b.id))) {
      const wo = bomRfWoOf(job);
      if (wo && RF_WO_STOPPABLE.includes(wo.status)) woIds.push(wo.id);
    }
    return { action, woIds };
  }
  // ช่องโครงสร้างของงาน (v_struct ของ bom_save_jobs) และ WO (ไม่นับเวลา/ผู้ผูก) ต่างจากแถวเดิมหรือไม่
  const BOM_JOB_SHAPE = ["dept", "itemCode", "name", "kind", "uom", "qtyPlanned", "qtyRequired", "stockCounted", "dueAt", "fgCodes"];
  const bomJobExt = (ref) => (ref ? bomCanon(bomWithout(ref, ["linkedAt", "by", "auto"])) : "null");
  const bomJobShapeChanged = (prev, record) => BOM_JOB_SHAPE.some((key) => bomCanon(prev[key] ?? null) !== bomCanon(record[key] ?? null)) || bomJobExt(prev.externalRef) !== bomJobExt(record.externalRef);
  // แก้บรรทัด / หมายเหตุของ BOM ในฉบับเดิม (ตรงกับ private.bom_save_boms ของ 20261129010000): ฉบับเดิมและที่ส่งมา approved และเป็น revision สูงสุดของชิ้น ·
  // ผู้อนุมัติฉบับนั้นคือผู้บันทึก · อนุมัติวันเดียวกัน (Asia/Bangkok = UTC+7 ไม่มีเวลาออมแสง) · ไม่มีใบที่ไม่ใช่ร่าง (รวม cancelled) ที่ explosion อ้าง id ของฉบับนี้
  // ผู้เรียกตรวจเพิ่มว่า changeLog ต่อท้ายอย่างน้อยหนึ่งรายการ
  const bomBangkokDay = (ms) => Math.floor((Number(ms) + 7 * 3600000) / 86400000);
  const bomEditInPlace = (next, old, record, actor, at) => old.status === "approved" && record.status === "approved" && old.approvedBy === actor.name
    && bomBangkokDay(old.approvedAt) === bomBangkokDay(at)
    && !next.boms.some((row) => row.itemCode === old.itemCode && Number(row.revision) > Number(old.revision))
    && !next.orders.some((order) => order.status !== "draft" && Array.isArray(order.explosion) && order.explosion.some((line) => line?.bomId === old.id));
  // กฎของงาน (ตรงกับ bom_save_jobs): งานใหม่เกิดตอนปล่อยผลิตเท่านั้น (queued ว่าง) · แก้งานได้เฉพาะใบที่ released / in_progress ·
  // รายงานต่อท้ายเท่านั้น (ทุกบทบาท) · ยอดดี / เสียที่เปลี่ยนเท่าผลรวมรายงานใหม่ทุกผู้เรียก · พนักงานแผนก: งาน done แล้วแก้ไม่ได้ ยอดลดไม่ได้ · ผูก WO ได้เฉพาะงานแผนก RB
  // rfCancel =คิว WO ที่ต้องยกเลิก / หยุดหลังบันทึกสำเร็จ (bomRfFollow): ฝ่ายวางแผนปิดงานที่ผูก WO ใส่ op "closeJob" (ตรงกับ private.bom_cancel_rf_job ของ 20261129010000)
  function bomJobRules(prev, record, actor, next, released, action = "", rfCancel = null) {
    if (!JOB_STATUSES.includes(record.status) || !JOB_DEPTS.includes(record.dept)) fail("BOM_INVALID_JOB");
    const order = next.orders.find((row) => row.id === record.orderId);
    const reports = Array.isArray(record.reports) ? record.reports : [];
    if (!prev) {
      if (!order) fail("BOM_INVALID_JOB");
      if (!released.includes(order.id)) fail("BOM_INVALID_TRANSITION");
      if (record.status !== "queued" || Number(record.qtyDone) > 0 || Number(record.qtyReject) > 0 || record.externalRef || reports.length) fail("BOM_INVALID_JOB");
      return;
    }
    const oldReports = Array.isArray(prev.reports) ? prev.reports : [];
    if (reports.length < oldReports.length || oldReports.some((entry, index) => bomCanon(entry) !== bomCanon(reports[index]))) fail("BOM_FORBIDDEN");
    if (!order || !["released", "in_progress"].includes(order.status)) fail("BOM_INVALID_TRANSITION");
    const mode = bomJobClosing(prev, record, actor, action);
    const sameOutput = (Number(record.qtyDone) || 0) === (Number(prev.qtyDone) || 0) && (Number(record.qtyReject) || 0) === (Number(prev.qtyReject) || 0);
    // พักงานต้องมีเหตุผล ทุกผู้เรียกทุก action · การพักไม่เปลี่ยนยอด (ตรงกับ bom_save_jobs ของ 20261128010000)
    if (record.status === "hold" && prev.status !== "hold" && mode !== "hold") fail("BOM_INVALID_JOB");
    if (mode === "hold" && !sameOutput) fail("BOM_INVALID_JOB");
    // งานที่ผูก WO (แถวเดิมหรือแถวที่ส่งมา): ยอดและรายงานมาจาก RubberFlow เท่านั้น · รายการใหม่ได้เฉพาะเหตุผลของการปิด / การพัก หนึ่งรายการ
    if ((prev.externalRef?.woId || record.externalRef?.woId) && (!sameOutput || reports.length - oldReports.length > (mode ? 1 : 0))) fail("BOM_INVALID_JOB");
    if (record.externalRef && prev.dept !== "RB") fail("BOM_INVALID_JOB");
    // ปิดงานโดยฝ่ายวางแผน: ยอดดี / เสียต้องเท่าเดิม (ปิดงานไม่เพิ่มหรือลดยอด)
    const closing = mode === "close";
    if (closing && (Number(record.qtyDone) !== Number(prev.qtyDone) || Number(record.qtyReject) !== Number(prev.qtyReject))) fail("BOM_INVALID_JOB");
    // งานที่เปลี่ยนเป็น done โดยไม่มีรายการเหตุผลของการปิดงาน ต้องถึงยอดแผนแล้ว ทุกผู้เรียกทุก action (ตรงกับ bom_save_jobs ของ 20261126010000: qtyDone + 1e-9 >= qtyPlanned)
    if (record.status === "done" && prev.status !== "done" && !closing && (Number(record.qtyDone) || 0) + 1e-9 < Math.max(Number(record.qtyPlanned) || 0, Number(prev.qtyPlanned) || 0)) fail("BOM_INVALID_JOB");
    // ลดยอดแผนของงานที่เริ่มแล้วไม่ได้ ทุกผู้เรียกทุก action รวมกลุ่มวางแผน (ตรงกับ bom_save_jobs ของ 20261127010000): แถวเดิมเริ่มแล้ว (bomJobStarted)
    // หรือแถวที่ส่งมาเริ่มงานในคำสั่งเดียวกัน (สถานะไม่ใช่รอคิว มียอดดี / เสีย หรือมีรายงาน) · เพิ่มยอดแผน และแก้ยอดแผนของงานที่ยังไม่เริ่มทำได้
    const startsNow = record.status !== "queued" || Number(record.qtyDone) > 0 || Number(record.qtyReject) > 0 || reports.length > 0;
    if (Number(record.qtyPlanned) < Number(prev.qtyPlanned) && (bomJobStarted(prev) || startsNow)) fail("BOM_INVALID_JOB");
    // งานของซื้อที่เบิกไปแล้ว (qtyDone > 0 หรือ done): แก้ช่องโครงสร้าง / WO ไม่ได้ ทุก action ทุกผู้เรียก (ตรงกับ bom_save_jobs ของ 20261124010000)
    // การแก้ช่องผลงานไปทาง bomCheckRecord ("part") ก่อนถึงตรงนี้ · แถวที่เท่าเดิมไม่ถูกปฏิเสธ (SQL ข้ามแถวที่ไม่เปลี่ยน)
    if (bomIsPartJob(prev) && (Number(prev.qtyDone) > 0 || prev.status === "done") && bomJobShapeChanged(prev, record)) fail("BOM_INVALID_JOB");
    // งาน PK / FG (ตัวตนจากแถวเดิม): ยอด PK รวมของสินค้านั้นในใบหลังแก้ต้องไม่ต่ำกว่ายอดที่ WH รับเข้าคลังแล้ว ไม่งั้นใบค้างปิดไม่ได้ (ตรงกับ bom_save_jobs ของ 20261122010000) · ลดยอดหรือย้ายไปสินค้า/ชนิด/แผนกอื่นเหมือนกัน
    if (prev.dept === "PK" && prev.kind === "FG") {
      const contrib = record.dept === "PK" && record.kind === "FG" && record.itemCode === prev.itemCode ? Number(record.qtyDone) || 0 : 0;
      const before = Number(prev.qtyDone) || 0;
      if (contrib < before) {
        const made = next.jobs.filter((job) => job.orderId === prev.orderId && job.dept === "PK" && job.kind === "FG" && job.itemCode === prev.itemCode).reduce((total, job) => total + (Number(job.qtyDone) || 0), 0);
        // รับเข้าสุทธิ (receive − unreceive · 20261128020000 private.bom_fg_total หักแถวย้อน)
        const received = bomFgFigures(next.fgMoves, prev.orderId, prev.itemCode).own;
        if (bomFgRound(made - before + contrib) + 1e-9 < bomFgRound(received)) fail("BOM_INVALID_JOB");
      }
    }
    const workChanged = ["status", "qtyDone", "qtyReject", "reports"].some((key) => bomCanon(prev[key] ?? null) !== bomCanon(record[key] ?? null));
    if (workChanged) {
      // พนักงานแผนก: งาน done แก้ไม่ได้ ยอดลดไม่ได้
      if (!bomIsPlanner(actor)) {
        if (prev.status === "done") fail("BOM_INVALID_TRANSITION");
        if (Number(record.qtyDone) < Number(prev.qtyDone) || Number(record.qtyReject) < Number(prev.qtyReject)) fail("BOM_INVALID_JOB");
      }
      // ทุกผู้เรียกรวมกลุ่มวางแผน (20261129010000): ยอดที่เปลี่ยนต้องเท่าผลรวมของรายการรายงานใหม่ในคำสั่งเดียวกัน (ยอดจึงลดไม่ได้)
      const sum = (key) => reports.slice(oldReports.length).reduce((total, entry) => total + (Number(entry?.[key]) || 0), 0);
      if (Math.abs(((Number(record.qtyDone) || 0) - (Number(prev.qtyDone) || 0)) - sum("good")) > 0.001 || Math.abs(((Number(record.qtyReject) || 0) - (Number(prev.qtyReject) || 0)) - sum("reject")) > 0.001) fail("BOM_INVALID_JOB");
    }
    // ฝ่ายวางแผนปิดงานที่ผูก WO พร้อมเหตุผล: WO planned / released ยกเลิก · in_progress / on_hold หยุด · completed / cancelled คงเดิม (bomRfCancelOp กรองสถานะเอง)
    // งาน GR ที่ตั้งขั้นตอนแล้ว: ยอดดี / เสียมาจากผลรายวันเท่านั้น (trigger bom_jobs_gr_guard ของ 20261216010000 · ทุกผู้เรียกทุก action)
    if ((next.grPlans ?? []).some((plan) => plan.jobId === prev.id) && !sameOutput) fail("BOM_INVALID_JOB");
    // งาน GR ที่มีผลรายวันแล้ว (ทุกสถานะของผล) คืนกลับเป็นรอคิวไม่ได้ (trigger bom_jobs_gr_guard ของ 20261216010000)
    if (record.status === "queued" && prev.status !== "queued" && (next.grRecords ?? []).some((entry) => entry.jobId === prev.id)) fail("BOM_INVALID_TRANSITION");
    if (closing && rfCancel && (record.externalRef?.woId ?? prev.externalRef?.woId)) rfCancel.push(bomRfCancelOp("closeJob", [{ ...prev, externalRef: record.externalRef ?? prev.externalRef }]));
  }
  // ---- สต็อกของซื้อ (ตรงกับ private.bom_save_stock / bom_issue_parts) ----
  // ตรงกับ private.bom_code: ตัดช่องว่างทุกตัว ยุบ "-" ที่ติดกันเหลือตัวเดียว แล้วเป็นตัวใหญ่
  const bomCode = (value) => String(value ?? "").replace(/\s+/g, "").replace(/-{2,}/g, "-").toUpperCase();
  const bomStockNum = (value) => { if (value === undefined || value === null) return null; if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e9) fail("BOM_INVALID_STOCK"); return value; };
  // id ขึ้นต้นด้วยลำดับการเขียน: ประวัติที่เกิดในมิลลิวินาทีเดียวกันเรียงตามลำดับที่เขียนจริง (ฐานข้อมูลเรียงตาม created_at ระดับไมโครวินาที)
  const bomMoveId = (stockMoves) => `${String(stockMoves.length + 1).padStart(8, "0")}-${newEpoch()}`;
  const bomMove = (next, nextVersion, at, itemCode, kind, qty, balance, ref, who, note = null) => {
    const id = bomMoveId(next.stockMoves);
    next.stockMoves.push({ id, itemCode, kind, qty, balance, ref: ref ?? null, at, by: who, note });
    next.versions.stockMoves[id] = nextVersion;
  };
  // แถว { itemCode, qty?, safetyQty? }: รหัสต้องเป็นของซื้อ · ชนก่อนสิทธิ์ · เปลี่ยนยอดต้องเป็นกลุ่มวางแผนหรือ ST/WH · เปลี่ยนสต็อกขั้นต่ำต้องเป็นกลุ่มวางแผน · ยอดเปลี่ยน = ประวัติ count
  function bomSaveStock(next, rows, base, cur, nextVersion, actor, at) {
    const mayCount = bomIsPlanner(actor) || ["ST", "WH"].includes(actor.dept);
    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail("BOM_INVALID_STOCK");
      const code = bomCode(row.itemCode);
      if (!code || code.length > 60 || seen.has(code)) fail("BOM_INVALID_STOCK");
      seen.add(code);
      const qty = bomStockNum(row.qty);
      const safety = bomStockNum(row.safetyQty);
      if (!next.items.some((item) => item.code === code && item.kind === "PURCHASED")) fail("BOM_INVALID_STOCK");
      const old = next.stock.find((entry) => entry.itemCode === code);
      const newQty = qty ?? old?.qty ?? 0;
      const newSafety = safety ?? old?.safetyQty ?? 0;
      if (newQty === (old?.qty ?? 0) && newSafety === (old?.safetyQty ?? 0)) continue;
      if (old && (next.versions.stock[code] ?? 0) > base && (next.versions.stock[code] ?? 0) <= cur) fail("BOM_STALE");
      if (newQty !== (old?.qty ?? 0) && !mayCount) fail("BOM_FORBIDDEN");
      if (newSafety !== (old?.safetyQty ?? 0) && !(bomIsPlanner(actor) || actor.dept === "ST")) fail("BOM_FORBIDDEN"); // สต็อกขั้นต่ำ: กลุ่มวางแผนหรือแผนก ST (20261120010000)
      const countedNow = newQty !== (old?.qty ?? 0);
      const out = { itemCode: code, qty: newQty, safetyQty: newSafety, countedAt: countedNow ? at : old?.countedAt ?? null, countedBy: countedNow ? actor.name : old?.countedBy ?? "", updatedAt: at };
      if (old) next.stock[next.stock.indexOf(old)] = out; else next.stock.push(out);
      next.versions.stock[code] = nextVersion;
      if (countedNow) bomMove(next, nextVersion, at, code, "count", Math.round((newQty - (old?.qty ?? 0)) * 1e9) / 1e9, newQty, null, actor.name);
    }
  }
  // เบิกจ่ายของซื้อรายใบ (ตรงกับ private.bom_issue_parts ของ 20261123020000): ผู้เรียกกลุ่มวางแผน/ST · แถวเป็นงานของซื้อที่ยังไม่ done ของใบเดียว อย่างน้อยหนึ่งแถว (ไม่ต้องครบทุกงาน)
  // แต่ละแถว qtyDone = ยอดเบิกสะสมใหม่ (ตัวเลข 0..1e9 มากกว่าที่เก็บ ทศนิยมไม่เกิน 4 ตำแหน่งหรือเท่าแผน) · qtyPlanned = ที่เก็บ · status = done เมื่อยอดสะสมใหม่ >= แผน ไม่เช่นนั้น in_progress (ผิดข้อใด = BOM_INVALID_JOB)
  // ยอดครั้งนี้ (ใหม่ - ที่เก็บ) เกินสต็อกแถวใด = ไม่จ่ายเลย (BOM_STALE ถ้าแถวสต็อกเหล่านั้นเปลี่ยนหลัง base ไม่เช่นนั้น BOM_INSUFFICIENT_STOCK) · ผ่าน = หักสต็อก เขียน issue ตั้งยอด/สถานะของงาน
  const bomIssueNum = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : null);
  function bomIssueParts(next, rows, base, cur, nextVersion, actor, at) {
    if (!(bomIsPlanner(actor) || actor.dept === "ST")) fail("BOM_FORBIDDEN");
    if (!rows.length) fail("BOM_INVALID_JOB");
    const picks = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail("BOM_INVALID_JOB");
      const job = next.jobs.find((entry) => entry.id === row.id);
      if (!job || !bomIsPartJob(job) || job.status === "done" || (picks.length && job.orderId !== picks[0].job.orderId) || picks.some((pick) => pick.job === job)) fail("BOM_INVALID_JOB");
      const total = bomIssueNum(row.qtyDone);
      const stored = Number(job.qtyDone) || 0;
      // ทศนิยมเกิน 4 ตำแหน่ง = ปฏิเสธ เว้นแต่เท่าแผนพอดี (ตรงกับ round(v_total, 4) ของฐานข้อมูล)
      if (total === null || total <= stored || (total !== Math.round(total * 1e4) / 1e4 && total !== Number(job.qtyPlanned))
          || bomIssueNum(row.qtyPlanned) !== Number(job.qtyPlanned)
          || row.status !== (total >= Number(job.qtyPlanned) ? "done" : "in_progress")) fail("BOM_INVALID_JOB");
      picks.push({ job, total, amount: Math.round((total - stored) * 1e9) / 1e9 });
    }
    const order = next.orders.find((entry) => entry.id === picks[0].job.orderId);
    if (!["released", "in_progress"].includes(order?.status)) fail("BOM_INVALID_TRANSITION");
    const lines = picks.slice().sort((a, b) => bomCmp(a.job.itemCode, b.job.itemCode)).map((pick) => ({ ...pick, row: next.stock.find((entry) => entry.itemCode === pick.job.itemCode) }));
    if (lines.some((line) => line.amount > (line.row?.qty ?? 0))) {
      if (lines.some((line) => line.row && (next.versions.stock[line.row.itemCode] ?? 0) > base && (next.versions.stock[line.row.itemCode] ?? 0) <= cur)) fail("BOM_STALE");
      fail("BOM_INSUFFICIENT_STOCK");
    }
    for (const { job, total, amount, row } of lines) {
      const balance = Math.round((row.qty - amount) * 1e9) / 1e9;
      next.stock[next.stock.indexOf(row)] = { ...row, qty: balance, updatedAt: at };
      next.versions.stock[row.itemCode] = nextVersion;
      bomMove(next, nextVersion, at, job.itemCode, "issue", -amount, balance, order.id, actor.name);
      const done = total >= Number(job.qtyPlanned);
      job.status = done ? "done" : "in_progress";
      job.qtyDone = total;
      if (done) job.doneAt = job.doneAt ?? at;
      else delete job.doneAt;
      next.versions.jobs[job.id] = nextVersion;
    }
    // งานเริ่มแล้ว: ใบ released -> in_progress (กติกางานเริ่มเดิม)
    if (order.status === "released") { order.status = "in_progress"; next.versions.orders[order.id] = nextVersion; }
    return picks.length;
  }
  // คืนของซื้อรายใบ PI (ตรงกับ private.bom_return_parts / bom_part_returned): แถวเดียว { orderId, mode, reason, lines? } ลำดับตรวจ: รูปแถว → ชน → สิทธิ์ → สถานะใบ → ยอด
  // ยอดที่คืนไปแล้ว = ผลรวม 'return' ของ (เลข PI, รายการ) ตั้งแต่ 'issue' ล่าสุดของคู่นั้น (ตามลำดับเขียนใน next.stockMoves) · คืนจำนวนประวัติที่เขียน
  const bomPartReturned = (next, piNo, code) => {
    let total = 0;
    for (const move of next.stockMoves) {
      if (move.ref !== piNo || move.itemCode !== code) continue;
      if (move.kind === "issue") total = 0; else if (move.kind === "return") total += move.qty;
    }
    return Math.round(total * 1e9) / 1e9;
  };
  function bomReturnParts(next, rows, base, cur, nextVersion, actor, at) {
    const bad = () => fail("BOM_INVALID_RETURN");
    const text = (value, max, min) => { if (value === undefined || value === null) value = ""; if (typeof value !== "string") bad(); const t = value.trim(); if (t.length < min || t.length > max) bad(); return t; };
    if (!Array.isArray(rows) || rows.length !== 1) bad();
    const row = rows[0];
    if (!row || typeof row !== "object" || Array.isArray(row)) bad();
    const mode = text(row.mode, 10, 1);
    if (mode !== "undo" && mode !== "leftover") bad();
    const reason = text(row.reason, 200, 1);
    const wanted = new Map();
    if (mode === "undo") {
      if (row.lines !== undefined && row.lines !== null && !(Array.isArray(row.lines) && row.lines.length === 0)) bad();
    } else {
      if (!Array.isArray(row.lines) || row.lines.length < 1 || row.lines.length > 100) bad();
      for (const entry of row.lines) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) bad();
        const code = bomCode(text(entry.itemCode, 60, 1));
        if (wanted.has(code) || typeof entry.qty !== "number" || !Number.isFinite(entry.qty) || entry.qty <= 0 || entry.qty > 1e9) bad();
        wanted.set(code, entry.qty);
      }
    }
    const order = next.orders.find((entry) => entry.id === text(row.orderId, 40, 1).toUpperCase()) ?? bad();
    const partJobs = next.jobs.filter((job) => job.orderId === order.id && bomIsPartJob(job));
    const items = new Set(partJobs.map((job) => job.itemCode));
    const newer = (version) => (version ?? 0) > base && (version ?? 0) <= cur;
    if (partJobs.some((job) => newer(next.versions.jobs[job.id])) || next.stock.some((entry) => items.has(entry.itemCode) && newer(next.versions.stock[entry.itemCode]))) fail("BOM_STALE");
    if (!(bomIsPlanner(actor) || actor.dept === "ST")) fail("BOM_FORBIDDEN");
    // งานที่นับว่าเบิกแล้ว (ตรงกับ private.bom_return_parts ของ 20261123020000): ยกเลิกการเบิกจ่าย = done หรือเบิกไปบางส่วน (qtyDone > 0)
    // คืนของเหลือ = done · หรือเบิกไปบางส่วนเมื่อใบปิดแล้ว (completed: เบิกส่วนที่เหลือ / ยกเลิกการเบิกจ่ายไม่ได้แล้ว)
    const issuedJob = (job) => job.status === "done" || Number(job.qtyDone) > 0;
    const issuedOf = (code, withPartial = false) => {
      const done = partJobs.filter((job) => (withPartial ? issuedJob(job) : job.status === "done") && job.itemCode === code);
      return done.length ? done.reduce((sum, job) => sum + Number(job.qtyDone), 0) : null;
    };
    const add = (code, qty) => {
      const old = next.stock.find((entry) => entry.itemCode === code);
      const balance = Math.round(((old?.qty ?? 0) + qty) * 1e9) / 1e9;
      const out = { itemCode: code, qty: balance, safetyQty: old?.safetyQty ?? 0, countedAt: old?.countedAt ?? null, countedBy: old?.countedBy ?? "", updatedAt: at };
      if (old) next.stock[next.stock.indexOf(old)] = out; else next.stock.push(out);
      next.versions.stock[code] = nextVersion;
      bomMove(next, nextVersion, at, code, "return", qty, balance, order.id, actor.name, reason);
    };
    let moves = 0;
    if (mode === "undo") {
      if (!["released", "in_progress"].includes(order.status)) fail("BOM_INVALID_TRANSITION");
      const codes = [...new Set(partJobs.filter(issuedJob).map((job) => job.itemCode))].sort(bomCmp);
      if (!codes.length) bad();
      for (const code of codes) {
        const left = Math.round((issuedOf(code, true) - bomPartReturned(next, order.id, code)) * 1e9) / 1e9;
        if (left > 0) { add(code, left); moves += 1; }
      }
      for (const job of partJobs.filter(issuedJob)) {
        job.status = "queued";
        job.qtyDone = 0;
        delete job.doneAt;
        next.versions.jobs[job.id] = nextVersion;
      }
    } else {
      // ใบที่ยกเลิกแล้วคืนของเหลือได้เหมือนใบที่ปิดแล้ว (ตรงกับ bom_return_parts ของ 20261128010000)
      if (!["released", "in_progress", "completed", "cancelled"].includes(order.status)) fail("BOM_INVALID_TRANSITION");
      for (const code of [...wanted.keys()].sort(bomCmp)) {
        const issued = issuedOf(code, ["completed", "cancelled"].includes(order.status));
        if (issued === null || wanted.get(code) > Math.round((issued - bomPartReturned(next, order.id, code)) * 1e9) / 1e9) bad();
        add(code, wanted.get(code));
        moves += 1;
      }
    }
    return moves;
  }
  const BOM_RETURN_ACTIONS = ["undoOrderParts", "returnOrderParts"];
  // รายการ action ที่ฐานข้อมูลรับ (ตรงกับ private.bom_client_actions() และ private.bom_staff_actions() ของ 20261125010000) · completeOrder ไม่อยู่ในรายการแล้ว
  const BOM_CLIENT_ACTIONS = ["saveItem", "saveBom", "saveBomTree", "linkCompound", "importFlat",
    "saveColor", "saveColorSet", "removeColorSet", "learnColorSet", "savePackage", "removePackage", "createVariant",
    "saveRouting", "saveProcess", "setItemCost", "setItemImage",
    "createOrder", "addOrderItem", "removeOrderItem", "updateOrderItem", "explodeOrder", "releaseOrder",
    "setStockCount", "setStockCounts", "cancelOrder",
    "reportJob", "setJobStatus", "linkJobToRubberFlow", "saveCustomer",
    "countPartStock", "issueOrderParts", "undoOrderParts", "returnOrderParts",
    "receiveFg", "deliverFg", "closeOrderShort", "closeOrder", "reverseFg",
    "receiveRods", "decideRods", "issueRods", "reverseRodIssue", "adjustRods", "receiveRodsOpening", "setRodLocation",
    "saveGrConfig", "setGrJobSteps", "addGrRecord", "editGrRecord", "voidGrRecord", "requestRods", "cancelRodRequest", "sendGrToPk", "receiveGrAtPk", "cancelGrHandover"];
  // reverseFg (20261128020000) ไม่อยู่ในรายการของพนักงาน: พนักงาน WH ได้ BOM_FORBIDDEN ที่ด่านหยาบ · ผู้จัดการแผนก WH อยู่ในกลุ่มวางแผนอยู่แล้ว
  // คลังยางเส้นยาว (20261202010000 · 20261204010000): adjustRods อยู่ในรายการของพนักงานแล้ว (SR ปรับยอดเองได้ สิทธิ์จริงตรวจในตัวเขียน) · receiveRodsOpening / setRodLocation ของ SR
  const BOM_STAFF_ACTIONS = ["setStockCount", "setStockCounts", "reportJob", "setJobStatus", "linkJobToRubberFlow", "countPartStock", "issueOrderParts", "undoOrderParts", "returnOrderParts",
    "receiveFg", "deliverFg", "closeOrderShort", "closeOrder", "receiveRods", "decideRods", "issueRods", "reverseRodIssue", "adjustRods", "receiveRodsOpening", "setRodLocation",
    "saveGrConfig", "setGrJobSteps", "addGrRecord", "editGrRecord", "voidGrRecord", "requestRods", "cancelRodRequest", "sendGrToPk", "receiveGrAtPk", "cancelGrHandover"];
  // สินค้าสำเร็จรูป (ตรงกับสัญญา bom-wh-fg และ bom-fg-stock): แถวเดียว { orderId, kind, lines?, note? } ลำดับตรวจ: รูปคำขอ (รวมใบที่ไม่รู้จัก/สินค้านอกใบ) → สิทธิ์ (แผนก WH หรือ admin) → สถานะใบ → ยอด
  // ต่อใบ O รหัส X: own = Σ receive · in = Σ transfer − Σ untransfer ของใบนี้ · out = Σ transfer − Σ untransfer ที่ fromOrderId = O · delivered = Σ deliver · have = own + in
  // งานผลิต = ทุกงานของใบยกเว้นการเบิกของซื้อ (ST / PURCHASED) · ปิดใบทุกทางต้องให้ทุกงานผลิตเสร็จก่อน (20261125010000)
  // receive: ใบ released/in_progress/completed · own + qty ≤ ยอดที่งาน PK (FG) รายงาน · หลังรับ ใบที่ยังไม่ปิด ทุกงานผลิตเสร็จ และมีของครบ (have ≥ สั่ง) ทุกสินค้า → completed
  // deliver: ใบ released/in_progress/completed · ส่งมอบรวม + qty ≤ have − out
  // close (closeOrderShort): ใบ released/in_progress · งาน PK ทุกงานเสร็จ · ทุกงานผลิตเสร็จ · ทุกสินค้า own = ที่ PK ทำ · มีสินค้าที่ have < สั่ง (ไม่ผ่าน = BOM_INVALID_TRANSITION) · ปิดแล้วใบเป็น completed
  // close (closeOrder): ไม่มี lines ไม่มี note · ใบ released/in_progress · ทุกงานผลิตเสร็จ · ทุกสินค้า have ≥ สั่ง · แถว close ใช้ข้อความคงที่ของเซิร์ฟเวอร์
  // reverse (reverseFg · 20261128020000): ย้อนรับเข้า / ย้อนส่งมอบหนึ่งแถว { orderId, kind: "reverse", moveId, note } ตัวเขียน bomFgReverse (ตรงกับ private.bom_fg_reverse)
  const BOM_FG_ACTIONS = { receiveFg: "receive", deliverFg: "deliver", closeOrderShort: "close", closeOrder: "close", reverseFg: "reverse" };
  const BOM_FULL_CLOSE_NOTE = "รับครบ ปิดใบโดยคลังสินค้า";
  const bomFgKind = (action) => (Object.hasOwn(BOM_FG_ACTIONS, action) ? BOM_FG_ACTIONS[action] : null);
  const bomFgRound = (n) => Math.round(n * 1e9) / 1e9;
  const BOM_FG_STOCK_STATUS = ["released", "in_progress", "completed"];
  const bomFgOrdered = (order, code) => bomFgRound((order.items ?? []).filter((item) => item.fgCode === code).reduce((total, item) => total + (Number(item.qty) || 0), 0));
  // own / in / out / delivered ของ (ใบ, รหัส) จากประวัติทั้งหมด · own และ delivered หักแถวย้อน (unreceive / undeliver) ตรงกับ private.bom_fg_total ของ 20261128020000
  function bomFgFigures(moves, orderId, code) {
    const f = { own: 0, inn: 0, out: 0, delivered: 0 };
    for (const move of moves) {
      if (move.fgCode !== code) continue;
      const sign = move.kind === "untransfer" ? -1 : 1;
      if (move.orderId === orderId) {
        if (move.kind === "receive") f.own += move.qty;
        else if (move.kind === "unreceive") f.own -= move.qty;
        else if (move.kind === "deliver") f.delivered += move.qty;
        else if (move.kind === "undeliver") f.delivered -= move.qty;
        else if (move.kind === "transfer" || move.kind === "untransfer") f.inn += sign * move.qty;
      }
      if (move.fromOrderId === orderId && (move.kind === "transfer" || move.kind === "untransfer")) f.out += sign * move.qty;
    }
    return { own: bomFgRound(f.own), inn: bomFgRound(f.inn), out: bomFgRound(f.out), delivered: bomFgRound(f.delivered) };
  }
  // สต็อกสินค้าสำเร็จรูปของใบ O รหัส X = max(0, have − out − max(สั่ง, ส่งมอบ)) เฉพาะใบ released / in_progress / completed
  // และใบที่ยกเลิกแล้ว (จำนวนสั่ง = 0: ของที่ใบนั้นรับเข้าเองอยู่ในคลังต่อเป็นสต็อก · ตรงกับ bom_fg_free ของ 20261128010000) · ใบที่ยกเลิกรับเข้า / ส่งมอบเองไม่ได้ (BOM_FG_STOCK_STATUS)
  const bomFgFree = (moves, order, code) => {
    if (!BOM_FG_STOCK_STATUS.includes(order.status) && order.status !== "cancelled") return 0;
    const f = bomFgFigures(moves, order.id, code);
    return Math.max(0, bomFgRound(f.own + f.inn - f.out - Math.max(order.status === "cancelled" ? 0 : bomFgOrdered(order, code), f.delivered)));
  };
  function bomFgMoves(next, rows, nextVersion, actor, at, action) {
    const bad = () => fail("BOM_INVALID_FG");
    const kind = bomFgKind(action) ?? bad();
    if (!Array.isArray(rows) || rows.length !== 1) bad();
    const row = rows[0];
    if (!row || typeof row !== "object" || Array.isArray(row) || row.kind !== kind) bad();
    if (typeof row.orderId !== "string" || !row.orderId.trim() || row.orderId.length > 40) bad();
    let note = row.note === undefined || row.note === null ? "" : typeof row.note === "string" ? row.note.trim() : bad();
    if (note.length > 300) bad();
    const wanted = [];
    const full = action === "closeOrder";
    if (kind === "close") {
      if (row.lines !== undefined && row.lines !== null && !(Array.isArray(row.lines) && row.lines.length === 0)) bad();
      // ปิดใบเมื่อรับครบ: client ไม่ส่งเหตุผล (ว่างหรือไม่ส่ง) แถว close ใช้ข้อความของเซิร์ฟเวอร์ · ปิดรับไม่ครบต้องมีเหตุผล 3-300
      if (full) { if (note.length) bad(); note = BOM_FULL_CLOSE_NOTE; } else if (note.length < 3) bad();
    } else {
      if (!Array.isArray(row.lines) || row.lines.length < 1 || row.lines.length > 500) bad();
      for (const line of row.lines) {
        if (!line || typeof line !== "object" || Array.isArray(line) || typeof line.fgCode !== "string") bad();
        const code = bomCode(line.fgCode);
        if (!code || wanted.some((entry) => entry.fgCode === code)) bad();
        if (typeof line.qty !== "number" || !Number.isFinite(line.qty) || line.qty <= 0 || line.qty > 1e9) bad();
        wanted.push({ fgCode: code, qty: line.qty });
      }
    }
    if (!(actor.role === "admin" || actor.dept === "WH")) fail("BOM_FORBIDDEN");
    // ใบที่ไม่รู้จักและสินค้านอกใบตรวจหลังสิทธิ์ (ต้องมีแถวใบก่อน) ตรงกับ private.bom_fg_move
    const order = next.orders.find((entry) => entry.id === row.orderId.trim().toUpperCase()) ?? bad();
    if (wanted.some((line) => !(order.items ?? []).some((item) => item.fgCode === line.fgCode))) bad();
    const pkJobs = next.jobs.filter((job) => job.orderId === order.id && job.dept === "PK");
    // ทุกงานผลิต (ไม่นับการเบิกของซื้อ ST / PURCHASED) เสร็จแล้ว · ใบที่ไม่มีงานผลิตถือว่าครบ (ตรงกับ v_prod_done ของ 20261125010000)
    const prodDone = next.jobs.every((job) => job.orderId !== order.id || bomIsPartJob(job) || job.status === "done");
    const made = (code) => bomFgRound(pkJobs.filter((job) => job.kind === "FG" && job.itemCode === code).reduce((total, job) => total + (Number(job.qtyDone) || 0), 0));
    const products = [...new Set(order.items.map((item) => item.fgCode))].map((code) => {
      const f = bomFgFigures(next.fgMoves, order.id, code);
      return { fgCode: code, ordered: bomFgOrdered(order, code), made: made(code), ...f, have: bomFgRound(f.own + f.inn) };
    });
    const productOf = (code) => products.find((product) => product.fgCode === code);
    const push = (fgCode, qty) => {
      const id = bomMoveId(next.fgMoves);
      next.fgMoves.push({ id, orderId: order.id, fgCode, kind, qty, note, at, by: actor.name });
      next.versions.fgMoves[id] = nextVersion;
    };
    let closed = false;
    const closeNow = () => { order.status = "completed"; order.completedAt = at; next.versions.orders[order.id] = nextVersion; closed = true; };
    if (kind === "receive") {
      if (!BOM_FG_STOCK_STATUS.includes(order.status)) fail("BOM_INVALID_TRANSITION");
      for (const line of wanted) if (productOf(line.fgCode).own + line.qty > productOf(line.fgCode).made + 1e-9) fail("BOM_FG_EXCEEDS");
      for (const line of wanted) push(line.fgCode, line.qty);
      if (order.status !== "completed" && prodDone && products.every((product) => product.have + (wanted.find((line) => line.fgCode === product.fgCode)?.qty ?? 0) + 1e-9 >= product.ordered)) closeNow();
    } else if (kind === "deliver") {
      if (!BOM_FG_STOCK_STATUS.includes(order.status)) fail("BOM_INVALID_TRANSITION");
      for (const line of wanted) if (productOf(line.fgCode).delivered + line.qty > productOf(line.fgCode).have - productOf(line.fgCode).out + 1e-9) fail("BOM_FG_EXCEEDS");
      for (const line of wanted) push(line.fgCode, line.qty);
    } else if (full) {
      if (!["released", "in_progress"].includes(order.status)) fail("BOM_INVALID_TRANSITION");
      if (!prodDone || !products.length || products.some((product) => product.have + 1e-9 < product.ordered)) fail("BOM_INVALID_TRANSITION");
      push("", 0);
      closeNow();
    } else {
      if (!["released", "in_progress"].includes(order.status)) fail("BOM_INVALID_TRANSITION");
      if (!pkJobs.every((job) => job.status === "done") || !prodDone || !products.every((product) => Math.abs(product.own - product.made) <= 1e-9) || !products.some((product) => product.have + 1e-9 < product.ordered)) fail("BOM_INVALID_TRANSITION");
      push("", 0);
      closeNow();
    }
    // ตรงกับ private.bom_fg_move: จำนวนแถวประวัติที่เขียน (รับ/ส่งมอบ = จำนวนสินค้า ปิดใบ = 1) และใบถูกปิดหรือไม่ (audit นับ orders +1)
    return { moves: kind === "close" ? 1 : wanted.length, closed };
  }
  // ย้อนรับเข้า / ย้อนส่งมอบ (reverseFg · ตรงกับ private.bom_fg_reverse ของ 20261128020000) ลำดับตรวจ: รูปคำขอและเหตุผล 3-300 (BOM_INVALID_FG)
  // → สิทธิ์ admin หรือผู้จัดการแผนก WH (BOM_FORBIDDEN) → ใบ (ไม่พบ = BOM_INVALID_FG) → แถวเดิมของใบนี้ชนิด receive / deliver (ไม่ใช่ = BOM_INVALID_FG) → ย้อนแล้ว (BOM_INVALID_TRANSITION)
  // → ใบ released / in_progress / completed (BOM_INVALID_TRANSITION) → ย้อนรับเข้า: have หลังย้อน − out ≥ ส่งมอบสุทธิ และ (out > 0) ≥ จำนวนสั่ง (BOM_FG_EXCEEDS)
  // เขียนแถวย้อน qty = ของแถวเดิม reversesId = id แถวเดิม · ใบที่ปิดแล้วซึ่งมีสินค้าของไม่ครบหลังย้อนรับเข้า = เปิดกลับเป็น in_progress (completedAt หาย)
  function bomFgReverse(next, rows, nextVersion, actor, at) {
    const bad = () => fail("BOM_INVALID_FG");
    if (!Array.isArray(rows) || rows.length !== 1) bad();
    const row = rows[0];
    if (!row || typeof row !== "object" || Array.isArray(row) || row.kind !== "reverse") bad();
    if (typeof row.orderId !== "string" || !row.orderId.trim() || row.orderId.trim().length > 40) bad();
    if (typeof row.moveId !== "string" || !row.moveId.trim()) bad();
    if (row.lines !== undefined && row.lines !== null && !(Array.isArray(row.lines) && row.lines.length === 0)) bad();
    const note = typeof row.note === "string" ? row.note.trim() : bad();
    if (note.length < 3 || note.length > 300) bad();
    if (!(actor.role === "admin" || (actor.dept === "WH" && actor.role === "department_manager"))) fail("BOM_FORBIDDEN");
    const order = next.orders.find((entry) => entry.id === row.orderId.trim().toUpperCase()) ?? bad();
    const move = next.fgMoves.find((entry) => entry.id === row.moveId.trim());
    if (!move || move.orderId !== order.id || !["receive", "deliver"].includes(move.kind)) bad();
    if (next.fgMoves.some((entry) => entry.reversesId === move.id)) fail("BOM_INVALID_TRANSITION");
    if (!BOM_FG_STOCK_STATUS.includes(order.status)) fail("BOM_INVALID_TRANSITION");
    if (move.kind === "receive") {
      const f = bomFgFigures(next.fgMoves, order.id, move.fgCode);
      const left = bomFgRound(f.own + f.inn - move.qty - f.out);
      if (left + 1e-9 < f.delivered) fail("BOM_FG_EXCEEDS");
      if (f.out > 1e-9 && left + 1e-9 < bomFgOrdered(order, move.fgCode)) fail("BOM_FG_EXCEEDS");
    }
    const id = bomMoveId(next.fgMoves);
    next.fgMoves.push({ id, orderId: order.id, fgCode: move.fgCode, kind: move.kind === "receive" ? "unreceive" : "undeliver", qty: move.qty, note, at, by: actor.name, reversesId: move.id });
    next.versions.fgMoves[id] = nextVersion;
    let reopened = false;
    // เทียบรายบรรทัดของใบ (have ของรหัสนั้นกับจำนวนสั่งของบรรทัด) เหมือนเงื่อนไขปิดใบเองของ SQL
    if (move.kind === "receive" && order.status === "completed" && (order.items ?? []).some((item) => {
      const f = bomFgFigures(next.fgMoves, order.id, item.fgCode);
      return bomFgRound(f.own + f.inn) + 1e-9 < (Number(item.qty) || 0);
    })) {
      order.status = "in_progress";
      delete order.completedAt;
      next.versions.orders[order.id] = nextVersion;
      reopened = true;
    }
    return { moves: 1, closed: false, reopened };
  }
  // ปล่อยผลิต (draft → released): สินค้าของใบที่มี stockCounts[รหัส] = n > 0 ต้อง n ≤ จำนวนสั่ง (BOM_INVALID_ORDER) และสต็อกสินค้าสำเร็จรูปของรหัสนั้น ≥ n (BOM_FG_EXCEEDS) แล้วรับ n จากใบต้นทางเรียงใบที่ปล่อยผลิตก่อน
  // (released_at แล้วเลข PI) แถว transfer ต่อใบต้นทาง · ถ้าทุกสินค้ามี have ≥ สั่ง (ได้ครบจากสต็อก) ใบเป็น completed ในคำสั่งเดียวกัน (ตั้ง released_at / completed_at) และใบนี้ต้องไม่มีงาน (แทนกฎ "ต้องมีงานอย่างน้อยหนึ่งงาน")
  // เรียกทันทีหลังเขียนแถวใบที่ปล่อยผลิต ก่อนตรวจงาน (ลำดับเดียวกับ SQL: bom_save_orders ก่อน bom_save_jobs)
  function bomReleaseFgStock(next, order, nextVersion, actor, at) {
    const counts = order.stockCounts && typeof order.stockCounts === "object" && !Array.isArray(order.stockCounts) ? order.stockCounts : {};
    let moves = 0;
    for (const code of [...new Set((order.items ?? []).map((item) => item.fgCode))]) {
      const n = Number(counts[code]);
      if (!(n > 0)) continue;
      if (n > bomFgOrdered(order, code) + 1e-9) fail("BOM_INVALID_ORDER");
      const sources = next.orders.filter((other) => other.id !== order.id).map((other) => ({ order: other, free: bomFgFree(next.fgMoves, other, code) })).filter((entry) => entry.free > 1e-9)
        .sort((a, b) => (Number(a.order.releasedAt) || 0) - (Number(b.order.releasedAt) || 0) || bomCmp(a.order.id, b.order.id));
      if (sources.reduce((total, entry) => total + entry.free, 0) + 1e-9 < n) fail("BOM_FG_EXCEEDS");
      let left = n;
      for (const source of sources) {
        if (left <= 1e-9) break;
        const qty = bomFgRound(Math.min(source.free, left));
        const id = bomMoveId(next.fgMoves);
        next.fgMoves.push({ id, orderId: order.id, fgCode: code, kind: "transfer", qty, note: "", at, by: actor.name, fromOrderId: source.order.id });
        next.versions.fgMoves[id] = nextVersion;
        moves += 1;
        left = bomFgRound(left - qty);
      }
    }
    const products = [...new Set((order.items ?? []).map((item) => item.fgCode))];
    const completed = products.length > 0 && products.every((code) => {
      const f = bomFgFigures(next.fgMoves, order.id, code);
      return f.own + f.inn + 1e-9 >= bomFgOrdered(order, code);
    });
    if (completed) {
      order.status = "completed";
      order.completedAt = at;
      if (!order.releasedAt) order.releasedAt = at;
      next.versions.orders[order.id] = nextVersion;
    }
    return { moves, completed };
  }
  // ยกเลิก / เปิดใบกลับมาแก้ (released / in_progress): ห้ามถ้าใบมีแถว deliver หรือ out > 0 (BOM_INVALID_TRANSITION) ไม่งั้นทุกต้นทางที่ได้สุทธิ > 0 เขียนแถว untransfer (ใบเดียวกัน ต้นทางเดียวกัน ยอด = ที่ได้สุทธิ)
  function bomReturnFgStock(next, orderId, nextVersion, actor, at) {
    const moves = next.fgMoves;
    // ส่งมอบสุทธิ (deliver − undeliver) > 0 ของรหัสใดก็ตาม (20261128020000: การส่งมอบที่ย้อนแล้วไม่นับ)
    if ([...new Set(moves.filter((move) => move.orderId === orderId && move.kind === "deliver").map((move) => move.fgCode))].some((code) => bomFgFigures(moves, orderId, code).delivered > 1e-9)) fail("BOM_INVALID_TRANSITION");
    for (const code of new Set(moves.filter((move) => move.fromOrderId === orderId).map((move) => move.fgCode))) if (bomFgFigures(moves, orderId, code).out > 1e-9) fail("BOM_INVALID_TRANSITION");
    const nets = new Map();
    for (const move of moves) {
      if (move.orderId !== orderId || (move.kind !== "transfer" && move.kind !== "untransfer")) continue;
      const key = `${move.fromOrderId}\u0000${move.fgCode}`;
      nets.set(key, bomFgRound((nets.get(key) ?? 0) + (move.kind === "transfer" ? 1 : -1) * move.qty));
    }
    let written = 0;
    for (const [key, qty] of [...nets].sort((a, b) => bomCmp(a[0], b[0]))) {
      if (!(qty > 1e-9)) continue;
      const [fromOrderId, fgCode] = key.split("\u0000");
      const id = bomMoveId(next.fgMoves);
      next.fgMoves.push({ id, orderId, fgCode, kind: "untransfer", qty, note: "", at, by: actor.name, fromOrderId });
      next.versions.fgMoves[id] = nextVersion;
      written += 1;
    }
    return written;
  }
  // ---- แปรรูปยาง GR (ตรงกับ 20261216010000_bom_gr_module.sql) ----
  // ห้าชุดที่เซิร์ฟเวอร์เขียน (grConfig / grPlans / grRecords / rodRequests / grHandovers) · แถวคำขอเดียวต่อคำสั่ง ส่วนกับ action ต้องคู่กัน (ผิด / ว่าง = BOM_INVALID_GR)
  // ลำดับตรวจเหมือนตัวเขียน private.bom_gr_save_*: รูปแถว (BOM_INVALID_GR) → สิทธิ์ (BOM_FORBIDDEN) → แถวที่อ้าง (BOM_INVALID_GR) → ชนรุ่น (BOM_STALE) → สถานะ (BOM_INVALID_TRANSITION) → กติกา
  // ยอดของงาน GR ที่มีขั้นตอน = ดีของขั้นสุดท้าย / เสียของทุกขั้น (bomGrRecompute = private.bom_gr_recompute) · reportJob ของงานนั้น = BOM_INVALID_JOB (bomJobRules = trigger bom_jobs_gr_guard)
  const BOM_GR_SECTIONS = { saveGrConfig: "grConfig", setGrJobSteps: "grPlans", addGrRecord: "grRecords", editGrRecord: "grRecords", voidGrRecord: "grRecords",
    requestRods: "rodRequests", cancelRodRequest: "rodRequests", sendGrToPk: "grHandovers", receiveGrAtPk: "grHandovers", cancelGrHandover: "grHandovers" };
  const BOM_GR_LISTS = ["grConfig", "grPlans", "grRecords", "rodRequests", "grHandovers"];
  const BOM_GR_DEFAULT = {
    steps: [["GR-01", "รีด", "main"], ["GR-02", "ปั๊ม", "main"], ["GR-03", "เปเปอร์", "main"], ["GR-04", "ตัดยาง", "main"], ["GR-05", "ทากาว", "main"], ["GR-06", "เจียร์", "main"],
      ["GR-07", "เจียร์(หยาบ)", "main"], ["GR-08", "เจียร์(ละเอียด)", "main"], ["GR-09", "เจาะ", "main"], ["GR-11", "ใส่ท่อ", "side"], ["GR-10", "คัดแยก", "side"], ["GR-12", "ตัดยาง(เข้ามุม)", "side"]]
      .map(([code, name, kind], index) => ({ code, name, kind, seq: index + 1, active: true })),
    reasons: ["ขนาดไม่ได้", "ผิวไม่สวย/มีรอย", "กาวไม่ติด", "เจียร์เกิน", "เจาะผิดตำแหน่ง", "ยางมีตำหนิจากต้นทาง", "อื่นๆ"],
    targets: [],
  };
  const bomGrSection = (action) => (Object.hasOwn(BOM_GR_SECTIONS, action) ? BOM_GR_SECTIONS[action] : null);
  const bomGrBad = () => fail("BOM_INVALID_GR");
  const bomGrText = (value, min, max) => { const text = typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : bomGrBad(); if (text.length < min || text.length > max) bomGrBad(); return text; };
  const bomGrNum = (value, min, max) => (value === undefined || value === null ? null : typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : bomGrBad());
  const bomGrInt = (value, min, max) => { const n = bomGrNum(value, min, max); if (n === null || !Number.isInteger(n)) bomGrBad(); return n; };
  const bomGrUuid = (value) => { const text = bomGrText(value, 1, 40).toLowerCase(); if (!BOM_ROD_UUID.test(text)) bomGrBad(); return text; };
  const bomGrJobNo = (value) => { const no = bomGrText(value, 1, 40); if (!/^[A-Za-z0-9._-]{1,40}$/.test(no)) bomGrBad(); return no; };
  const bomGrReason = (value) => bomGrText(value, 3, 200);
  // หัวหน้าแผนก (private.bom_gr_is_head): ผู้จัดการแผนก / ผู้ช่วยผู้จัดการแผนกของแผนกนั้น
  const bomGrHead = (actor, dept) => actor.dept === dept && ["department_manager", "assistant_department_manager"].includes(actor.role);
  // วันที่ตามเวลาไทย YYYY-MM-DD (private.bom_gr_today)
  const bomGrDay = (ms, offset = 0) => {
    const day = new Date((Math.floor((Number(ms) + 7 * 3600000) / 86400000) + offset) * 86400000);
    return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
  };
  const bomGrConfigNow = (next) => next.grConfig[0] ?? BOM_GR_DEFAULT;
  const bomGrOrderOpen = (next, orderId) => ["released", "in_progress"].includes(next.orders.find((order) => order.id === orderId)?.status);
  const bomGrStale = (next, list, id, base, cur) => { const version = next.versions[list][id] ?? 0; if (version > base && version <= cur) fail("BOM_STALE"); };
  // พนักงาน active ของแผนก GR ในโหมดเดียวกัน (ชุด grWorkers ของ snapshot)
  const bomGrWorkers = () => (sandbox ? personaRows().filter((row) => String(row.department?.code ?? "").toUpperCase() === "GR" && row.id !== "persona-1")
    : [expand("employees", ME)].filter((row) => String(row.department?.code ?? "").toUpperCase() === "GR"))
    .map((row) => ({ id: row.id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() }));
  // ยอดของงานจากผลรายวัน (private.bom_gr_recompute) · คืน { jobs, orders }
  function bomGrRecompute(next, job, nextVersion, actor, at, label) {
    const plan = next.grPlans.find((row) => row.jobId === job.id) ?? bomGrBad();
    const codes = new Set(plan.steps.map((step) => step.code));
    const last = plan.steps.at(-1).code;
    const active = next.grRecords.filter((record) => record.jobId === job.id && record.status === "active" && codes.has(record.stepCode));
    const good = active.filter((record) => record.stepCode === last).reduce((sum, record) => sum + record.good, 0);
    const reject = active.reduce((sum, record) => sum + record.reject, 0);
    const any = next.grRecords.some((record) => record.jobId === job.id);
    // ยอดดีต้องไม่ต่ำกว่าที่ส่งให้ PK แล้ว (ไม่นับยกเลิก) = BOM_GR_EXCEEDS
    const sent = next.grHandovers.filter((entry) => entry.jobId === job.id && entry.status !== "cancelled").reduce((sum, entry) => sum + entry.qty, 0);
    if (good + 1e-9 < sent) fail("BOM_GR_EXCEEDS");
    const planned = Number(job.qtyPlanned) || 0;
    const oldDone = Number(job.qtyDone) || 0;
    const oldReject = Number(job.qtyReject) || 0;
    const status = job.status === "hold" ? "hold" : job.status === "done" && oldDone + 1e-9 < planned ? "done"
      : any && good + 1e-9 >= planned ? "done" : any || job.status !== "queued" ? "in_progress" : "queued";
    const dGood = good - oldDone;
    const dReject = reject - oldReject;
    if (dGood === 0 && dReject === 0 && status === job.status) return { jobs: 0, orders: 0 };
    const reports = Array.isArray(job.reports) ? job.reports : [];
    if ((dGood !== 0 || dReject !== 0) && reports.length < 1000) {
      job.reports = [...reports, { at, by: actor.name, good: Math.max(dGood, 0), reject: Math.max(dReject, 0),
        note: `${label} · ยอดดี ${oldDone} → ${good} เสีย ${oldReject} → ${reject}`.slice(0, 200), kind: "gr" }];
    }
    Object.assign(job, { qtyDone: good, qtyReject: reject, status });
    if (status === "done") job.doneAt = job.doneAt ?? at; else delete job.doneAt;
    next.versions.jobs[job.id] = nextVersion;
    const order = next.orders.find((row) => row.id === job.orderId);
    if (order?.status === "released" && (status !== "queued" || good > 0 || reject > 0)) {
      order.status = "in_progress";
      next.versions.orders[order.id] = nextVersion;
      return { jobs: 1, orders: 1 };
    }
    return { jobs: 1, orders: 0 };
  }
  // ตัวเขียนเดียวของห้าส่วน (private.bom_gr_save) · คืน { jobs, orders }
  function bomGrSave(next, rows, base, cur, nextVersion, actor, at, action) {
    const none = { jobs: 0, orders: 0 };
    const planner = bomIsPlanner(actor);
    const lead = planner || bomGrHead(actor, "GR");
    if (!Array.isArray(rows) || rows.length !== 1) bomGrBad();
    const row = rows[0];
    if (!row || typeof row !== "object" || Array.isArray(row)) bomGrBad();
    const jobOf = (no) => { const job = next.jobs.find((entry) => entry.id === no); if (!job || job.dept !== "GR") bomGrBad(); return job; };
    const stamp = (list, id) => { next.versions[list][id] = nextVersion; };
    if (action === "saveGrConfig") {
      const rawSteps = row.steps;
      if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > 40) bomGrBad();
      const codes = [];
      const steps = rawSteps.map((step) => {
        if (!step || typeof step !== "object" || Array.isArray(step)) bomGrBad();
        const code = bomGrText(step.code, 1, 20).toUpperCase();
        if (!/^GR-[A-Z0-9]{1,10}$/.test(code) || codes.includes(code)) bomGrBad();
        codes.push(code);
        const name = bomGrText(step.name, 1, 60);
        const kind = bomGrText(step.kind, 1, 10);
        if (!["main", "side"].includes(kind)) bomGrBad();
        const seq = bomGrInt(step.seq, 1, 1000);
        if (typeof step.active !== "boolean") bomGrBad();
        return { code, name, kind, seq, active: step.active };
      });
      if (!Array.isArray(row.reasons) || row.reasons.length < 1 || row.reasons.length > 30) bomGrBad();
      const reasons = [];
      for (const value of row.reasons) {
        if (typeof value !== "string") bomGrBad();
        const reason = value.trim();
        if (reason.length < 1 || reason.length > 60 || reasons.includes(reason)) bomGrBad();
        reasons.push(reason);
      }
      const rawTargets = row.targets === undefined || row.targets === null ? [] : row.targets;
      if (!Array.isArray(rawTargets) || rawTargets.length > 2000) bomGrBad();
      const pairs = new Set();
      const targets = rawTargets.map((target) => {
        if (!target || typeof target !== "object" || Array.isArray(target)) bomGrBad();
        const itemCode = bomCode(bomGrText(target.itemCode, 1, 60));
        const stepCode = bomGrText(target.stepCode, 1, 20).toUpperCase();
        if (!itemCode || !codes.includes(stepCode) || pairs.has(`${itemCode}|${stepCode}`)) bomGrBad();
        pairs.add(`${itemCode}|${stepCode}`);
        const perHour = bomGrNum(target.perHour, 0, 100000);
        if (perHour === null || perHour <= 0) bomGrBad();
        return { itemCode, stepCode, perHour };
      });
      if (targets.some((target) => !next.items.some((item) => item.code === target.itemCode))) bomGrBad();
      if (!lead) fail("BOM_FORBIDDEN");
      if (next.grConfig[0]) bomGrStale(next, "grConfig", "gr", base, cur);
      // ขั้นที่มีผลบันทึกแล้ว (ทุกสถานะ) หรืออยู่ในขั้นตอนของงานใด ลบไม่ได้
      if (next.grRecords.some((record) => !codes.includes(record.stepCode)) || next.grPlans.some((plan) => plan.steps.some((step) => !codes.includes(step.code)))) bomGrBad();
      next.grConfig = [{ key: "gr", steps, reasons, targets, updatedBy: actor.name, updatedAt: at }];
      stamp("grConfig", "gr");
      return none;
    }
    if (action === "setGrJobSteps") {
      const no = bomGrJobNo(row.jobId);
      if (!Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 40) bomGrBad();
      const codes = [];
      const steps = row.steps.map((step) => {
        if (!step || typeof step !== "object" || Array.isArray(step)) bomGrBad();
        const code = bomGrText(step.code, 1, 20).toUpperCase();
        if (codes.includes(code)) bomGrBad();
        codes.push(code);
        return { code, qtyTarget: bomGrInt(step.qtyTarget, 1, 10000000) };
      });
      if (!lead) fail("BOM_FORBIDDEN");
      const job = jobOf(no);
      const old = next.grPlans.find((plan) => plan.jobId === job.id) ?? null;
      if (old) bomGrStale(next, "grPlans", job.id, base, cur);
      if (!bomGrOrderOpen(next, job.orderId) || job.status === "done") fail("BOM_INVALID_TRANSITION");
      if (!old && (Number(job.qtyDone) > 0 || Number(job.qtyReject) > 0)) fail("BOM_INVALID_TRANSITION");
      const oldCodes = (old?.steps ?? []).map((step) => step.code);
      const config = bomGrConfigNow(next);
      for (const code of codes) {
        const found = config.steps.find((step) => step.code === code) ?? bomGrBad();
        if (!found.active && !oldCodes.includes(code)) bomGrBad();
      }
      if (next.grRecords.some((record) => record.jobId === job.id && record.status === "active" && !codes.includes(record.stepCode))) bomGrBad();
      const plan = { jobId: job.id, orderId: job.orderId, steps, createdBy: old?.createdBy ?? actor.name, createdAt: old?.createdAt ?? at, updatedBy: actor.name, updatedAt: at };
      next.grPlans = [...next.grPlans.filter((entry) => entry.jobId !== job.id), plan];
      stamp("grPlans", job.id);
      return bomGrRecompute(next, job, nextVersion, actor, at, "GR ตั้งขั้นตอนของงาน");
    }
    if (["addGrRecord", "editGrRecord", "voidGrRecord"].includes(action)) {
      const id = bomGrUuid(row.id);
      let no = null;
      let why = null;
      let fields = null;
      if (action === "voidGrRecord") why = bomGrReason(row.reason);
      else {
        if (action === "addGrRecord") no = bomGrJobNo(row.jobId);
        else why = bomGrReason(row.editReason);
        const stepCode = bomGrText(row.stepCode, 1, 20).toUpperCase();
        const workDate = bomGrText(row.workDate, 10, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || bomGrDay(Date.parse(`${workDate}T12:00:00+07:00`)) !== workDate) bomGrBad();
        const workerId = bomGrText(row.workerId, 1, 40);
        const hours = bomGrNum(row.hours, 0, 24);
        if (hours === null || hours <= 0 || Math.round(hours * 100) / 100 !== hours) bomGrBad();
        const people = bomGrInt(row.people, 1, 50);
        const good = bomGrNum(row.good, 0, 10000000) ?? 0;
        const reject = bomGrNum(row.reject, 0, 10000000) ?? 0;
        if (!Number.isInteger(good) || !Number.isInteger(reject) || good + reject <= 0) bomGrBad();
        let reason = bomGrText(row.reason, 0, 60) || null;
        if (reject === 0) reason = null; else if (reason === null) bomGrBad();
        const note = bomGrText(row.note, 0, 200);
        fields = { stepCode, workDate, workerId, hours, people, good, reject, reason, note };
      }
      if (!(planner || actor.dept === "GR")) fail("BOM_FORBIDDEN");
      let record = null;
      let job;
      if (action === "addGrRecord") {
        if (next.grRecords.some((entry) => String(entry.id).toLowerCase() === id)) bomGrBad();
        job = jobOf(no);
      } else {
        record = next.grRecords.find((entry) => String(entry.id).toLowerCase() === id) ?? bomGrBad();
        bomGrStale(next, "grRecords", record.id, base, cur);
        job = next.jobs.find((entry) => entry.id === record.jobId) ?? bomGrBad();
      }
      const today = bomGrDay(at);
      if (!lead) {
        if (record && (record.workerId !== actor.id || bomGrDay(record.createdAt) !== today)) fail("BOM_FORBIDDEN");
        if (fields && (fields.workerId !== actor.id || ![today, bomGrDay(at, -1)].includes(fields.workDate))) fail("BOM_FORBIDDEN");
      }
      if (!bomGrOrderOpen(next, job.orderId)) fail("BOM_INVALID_TRANSITION");
      // งานที่ฝ่ายวางแผนปิดพร้อมเหตุผล (done ยอดต่ำกว่าแผน) = กลุ่มวางแผนเท่านั้น · done เพราะยอดถึงแผน = กติกาปกติ
      if (job.status === "done" && (Number(job.qtyDone) || 0) + 1e-9 < (Number(job.qtyPlanned) || 0) && !planner) fail("BOM_INVALID_TRANSITION");
      if (action === "addGrRecord" && job.status === "hold") fail("BOM_INVALID_TRANSITION");
      if (record && record.status !== "active") fail("BOM_INVALID_TRANSITION");
      if (fields) {
        const plan = next.grPlans.find((entry) => entry.jobId === job.id);
        if (!plan || !plan.steps.some((step) => step.code === fields.stepCode)) bomGrBad();
        if ((action === "addGrRecord" || fields.workerId !== record.workerId) && !bomGrWorkers().some((worker) => worker.id === fields.workerId)) bomGrBad();
        if (fields.workDate > today || fields.workDate < "2000-01-01") bomGrBad();
        if (fields.reason !== null && !bomGrConfigNow(next).reasons.includes(fields.reason)) bomGrBad();
      }
      if (record && (record.edits ?? []).length >= 100) bomGrBad();
      const workerName = (workerId) => bomGrWorkers().find((worker) => worker.id === workerId)?.name ?? (workerId === actor.id ? actor.name : record?.workerName ?? "");
      let label;
      if (action === "addGrRecord") {
        next.grRecords.push({ id, jobId: job.id, orderId: job.orderId, itemCode: job.itemCode, ...fields, workerName: workerName(fields.workerId), status: "active", voidReason: null, edits: [],
          createdBy: actor.name, createdById: actor.id, createdAt: at, updatedBy: null, updatedAt: null });
        stamp("grRecords", id);
        label = `GR บันทึกผล ${fields.stepCode} ${fields.workDate}`;
      } else {
        const before = { stepCode: record.stepCode, workDate: record.workDate, workerId: record.workerId, hours: record.hours, people: record.people, good: record.good, reject: record.reject, reason: record.reason, note: record.note };
        const edits = [...(record.edits ?? []), { at, by: actor.name, kind: action === "voidGrRecord" ? "void" : "edit", reason: why, before }];
        if (action === "voidGrRecord") Object.assign(record, { status: "void", voidReason: why, edits, updatedBy: actor.name, updatedAt: at });
        else Object.assign(record, fields, { workerName: workerName(fields.workerId), edits, updatedBy: actor.name, updatedAt: at });
        stamp("grRecords", record.id);
        label = `${action === "voidGrRecord" ? "GR ยกเลิกผล" : "GR แก้ไขผล"} ${before.stepCode} ${before.workDate}`;
      }
      return bomGrRecompute(next, job, nextVersion, actor, at, label);
    }
    if (action === "requestRods") {
      const id = bomGrUuid(row.id);
      const no = bomGrJobNo(row.jobId);
      const itemCode = bomCode(bomGrText(row.itemCode, 1, 60));
      if (!itemCode) bomGrBad();
      const qty = bomGrInt(row.qty, 1, 100000);
      const note = bomGrText(row.note, 0, 200);
      if (!(planner || actor.dept === "GR")) fail("BOM_FORBIDDEN");
      if (next.rodRequests.some((entry) => String(entry.id).toLowerCase() === id)) bomGrBad();
      const job = jobOf(no);
      const order = next.orders.find((entry) => entry.id === job.orderId);
      if (!bomGrOrderOpen(next, job.orderId) || job.status === "done") fail("BOM_INVALID_TRANSITION");
      if (!(order.explosion ?? []).some((line) => line.itemCode === itemCode && line.kind === "RB" && line.parentCode === job.itemCode)) bomGrBad();
      next.rodRequests.push({ id, orderId: order.id, jobId: job.id, itemCode, qty, note, status: "open", createdBy: actor.name, createdById: actor.id, createdAt: at, cancelledBy: null, cancelledAt: null, cancelReason: null });
      stamp("rodRequests", id);
      return none;
    }
    if (action === "cancelRodRequest") {
      const id = bomGrUuid(row.id);
      const why = bomGrReason(row.reason);
      const request = next.rodRequests.find((entry) => String(entry.id).toLowerCase() === id) ?? bomGrBad();
      if (!(lead || request.createdById === actor.id)) fail("BOM_FORBIDDEN");
      bomGrStale(next, "rodRequests", request.id, base, cur);
      if (request.status !== "open") fail("BOM_INVALID_TRANSITION");
      Object.assign(request, { status: "cancelled", cancelledBy: actor.name, cancelledAt: at, cancelReason: why });
      stamp("rodRequests", request.id);
      return none;
    }
    const id = bomGrUuid(row.id);
    if (action === "sendGrToPk") {
      const no = bomGrJobNo(row.jobId);
      const qty = bomGrInt(row.qty, 1, 10000000);
      const note = bomGrText(row.note, 0, 200);
      if (!lead) fail("BOM_FORBIDDEN");
      if (next.grHandovers.some((entry) => String(entry.id).toLowerCase() === id)) bomGrBad();
      const job = jobOf(no);
      if (!bomGrOrderOpen(next, job.orderId)) fail("BOM_INVALID_TRANSITION");
      const sent = next.grHandovers.filter((entry) => entry.jobId === job.id && entry.status !== "cancelled").reduce((sum, entry) => sum + entry.qty, 0);
      if (sent + qty > (Number(job.qtyDone) || 0) + 1e-9) fail("BOM_GR_EXCEEDS");
      next.grHandovers.push({ id, jobId: job.id, orderId: job.orderId, itemCode: job.itemCode, qty, status: "sent", note, sentBy: actor.name, sentAt: at, receivedBy: null, receivedAt: null,
        cancelledBy: null, cancelledAt: null, cancelReason: null, moves: [{ kind: "send", at, by: actor.name, note }] });
      stamp("grHandovers", id);
      return none;
    }
    const why = action === "cancelGrHandover" ? bomGrReason(row.reason) : null;
    const handover = next.grHandovers.find((entry) => String(entry.id).toLowerCase() === id) ?? bomGrBad();
    if (action === "receiveGrAtPk" && !(planner || actor.dept === "PK")) fail("BOM_FORBIDDEN");
    if (action === "cancelGrHandover" && !(planner || bomGrHead(actor, handover.status === "received" ? "PK" : "GR"))) fail("BOM_FORBIDDEN");
    bomGrStale(next, "grHandovers", handover.id, base, cur);
    if (!bomGrOrderOpen(next, handover.orderId)) fail("BOM_INVALID_TRANSITION");
    if (action === "receiveGrAtPk") {
      if (handover.status !== "sent") fail("BOM_INVALID_TRANSITION");
      Object.assign(handover, { status: "received", receivedBy: actor.name, receivedAt: at, moves: [...handover.moves, { kind: "receive", at, by: actor.name, note: "" }] });
    } else if (handover.status === "sent") {
      Object.assign(handover, { status: "cancelled", cancelledBy: actor.name, cancelledAt: at, cancelReason: why, moves: [...handover.moves, { kind: "cancel", at, by: actor.name, note: why }] });
    } else if (handover.status === "received") {
      Object.assign(handover, { status: "sent", receivedBy: null, receivedAt: null, moves: [...handover.moves, { kind: "unreceive", at, by: actor.name, note: why }] });
    } else fail("BOM_INVALID_TRANSITION");
    stamp("grHandovers", handover.id);
    return none;
  }
  // ---- คลังแท่งยาว SR (ตรงกับ 20261202010000_bom_sr_rod_store.sql) ----
  // rodLots: หนึ่งแถวต่อล็อตตกแต่งของ WO ที่ผูกงาน RB (RubberFlow สร้างเป็น pending: rfApplyBomOps) · rodMoves: ประวัติของแท่งที่ใช้ได้ เพิ่มต่อท้าย เซิร์ฟเวอร์เขียน
  // ยอดของถัง (ล็อต, ใบเจ้าของ) = Σ qty ของแถวที่ lotId และ ownerOrderId ตรงกัน (null = สต็อกกลาง) ต้องไม่ติดลบ · ถังของใบ completed / cancelled = สต็อกกลาง
  // คำสั่ง (ส่วนเดียวต่อคำสั่ง): receiveRods / decideRods / receiveRodsOpening / setRodLocation ↔ rodLots · issueRods / reverseRodIssue / adjustRods ↔ rodMoves · ลำดับตรวจ: รูปคำขอ (BOM_INVALID_ROD) → สิทธิ์ (BOM_FORBIDDEN)
  // → ล็อต / แถวที่อ้าง (ไม่พบ = BOM_INVALID_ROD) → สถานะ (BOM_INVALID_TRANSITION) → ยอด (BOM_INVALID_ROD / BOM_ROD_EXCEEDS)
  const BOM_ROD_ACTIONS = { receiveRods: "rodLots", decideRods: "rodLots", receiveRodsOpening: "rodLots", setRodLocation: "rodLots", issueRods: "rodMoves", reverseRodIssue: "rodMoves", adjustRods: "rodMoves" };
  const BOM_ROD_SPEC_KEYS = ["thickness", "width", "weightPerM"];
  const BOM_ROD_FREE = ["completed", "cancelled"];
  const bomRodAction = (action) => (Object.hasOwn(BOM_ROD_ACTIONS, action) ? BOM_ROD_ACTIONS[action] : null);
  const bomRodRound = (n) => Math.round(Number(n) * 1e9) / 1e9;
  const bomRodOwner = (value) => (value === undefined || value === null || value === "" ? null : String(value));
  const bomRodBalance = (next, lotId, owner) => bomRodRound(next.rodMoves.reduce((sum, move) => (move.lotId === lotId && bomRodOwner(move.ownerOrderId) === bomRodOwner(owner) ? sum + Number(move.qty) : sum), 0));
  const bomRodFreeOwner = (next, owner) => owner === null || BOM_ROD_FREE.includes(next.orders.find((order) => order.id === owner)?.status);
  const bomRodText = (value, min, max) => { const text = typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : fail("BOM_INVALID_ROD"); if (text.length < min || text.length > max) fail("BOM_INVALID_ROD"); return text; };
  // ตัวเลขของคำขอ (private.bom_num): ไม่มี / null = null · ไม่ใช่ตัวเลข หรือนอกช่วง [min, max] = BOM_INVALID_ROD
  const bomRodNum = (value, min, max) => (value === undefined || value === null ? null : typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fail("BOM_INVALID_ROD"));
  // uuid ของคำขอ (bom_text 1-40 ตัวหลังตัดช่องว่าง แปลงเป็นตัวเล็ก ต้องเป็นรูป uuid) ผิด = BOM_INVALID_ROD
  const BOM_ROD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const bomRodUuid = (value) => { const text = bomRodText(value, 1, 40).toLowerCase(); if (!BOM_ROD_UUID.test(text)) fail("BOM_INVALID_ROD"); return text; };
  const bomRodLotOf = (next, id) => next.rodLots.find((entry) => String(entry.id).toLowerCase() === id) ?? fail("BOM_INVALID_ROD");
  // แท่งที่ SR จ่ายให้ GR ตามใบนี้สุทธิ (issue + unissue ที่ forOrderId = ใบนี้ กลับเครื่องหมาย) · > 0 = เปิดใบกลับเป็นร่างไม่ได้
  const bomRodIssued = (next, orderId) => bomRodRound(-next.rodMoves.reduce((sum, move) => ((move.kind === "issue" || move.kind === "unissue") && move.forOrderId === orderId ? sum + Number(move.qty) : sum), 0));
  const bomRodRights = (actor, dept) => { if (!(bomIsPlanner(actor) || actor.dept === dept)) fail("BOM_FORBIDDEN"); };
  const bomRodPush = (next, nextVersion, at, actor, row) => {
    const id = row.id ?? newEpoch();
    next.rodMoves.push({ id, lotId: row.lotId, itemCode: row.itemCode, kind: row.kind, qty: bomRodRound(row.qty), ownerOrderId: bomRodOwner(row.ownerOrderId), forOrderId: bomRodOwner(row.forOrderId), reversesId: row.reversesId ?? null, note: row.note ?? "", at, by: actor.name });
    next.versions.rodMoves[id] = nextVersion;
    return 1;
  };
  // รับแท่งที่ผ่านเข้าคลัง (private CREDIT): ใบ released / in_progress และงาน RB ยังไม่เสร็จ = ส่วนที่งานยังขาดเป็นของใบ ที่เกินเป็นสต็อกกลาง · งานนับยอดทั้งหมดที่รับ (เหมือน rf_apply_feedback)
  // ใบปิด / ยกเลิก / ร่าง หรืองานเสร็จแล้ว = สต็อกกลางทั้งหมด งานไม่เปลี่ยน · คืน { moves, job }
  function bomRodCredit(next, lot, qty, nextVersion, actor, at) {
    const order = next.orders.find((row) => row.id === lot.orderId);
    const job = next.jobs.find((row) => row.id === lot.jobNo && row.orderId === lot.orderId);
    const q = bomRodRound(qty);
    let moves = 0;
    if (order && ["released", "in_progress"].includes(order.status) && job && job.status !== "done") {
      const need = Math.max(bomRodRound(Number(job.qtyPlanned) - Number(job.qtyDone || 0)), 0);
      const owned = bomRodRound(Math.min(q, need));
      const extra = bomRodRound(q - owned);
      if (owned > 0) moves += bomRodPush(next, nextVersion, at, actor, { lotId: lot.id, itemCode: lot.itemCode, kind: "receive", qty: owned, ownerOrderId: order.id });
      if (extra > 0) moves += bomRodPush(next, nextVersion, at, actor, { lotId: lot.id, itemCode: lot.itemCode, kind: "receive", qty: extra, ownerOrderId: null });
      job.reports = [...(job.reports ?? []), { at, by: actor.name, good: q, reject: 0, note: `รับเข้าคลัง SR ผ่านตรวจ ล็อต ${lot.lotNo}${extra > 0 ? ` · เกิน ${extra} เข้าสต็อกกลาง` : ""}` }];
      job.qtyDone = Math.round((Number(job.qtyDone) + q) * 1e4) / 1e4;
      job.status = job.qtyDone + 1e-9 >= Number(job.qtyPlanned) ? "done" : "in_progress";
      if (job.status === "done") job.doneAt = job.doneAt ?? at; else delete job.doneAt;
      next.versions.jobs[job.id] = nextVersion;
      if (order.status === "released") { order.status = "in_progress"; next.versions.orders[order.id] = nextVersion; }
      return { moves, job: true };
    }
    moves += bomRodPush(next, nextVersion, at, actor, { lotId: lot.id, itemCode: lot.itemCode, kind: "receive", qty: q, ownerOrderId: null });
    return { moves, job: false };
  }
  // receiveRods: แถวเดียว { id, qtyReceived, location, qc: { values, result, note } } · decideRods: แถวเดียว { id, decision, decisionNote }
  // receiveRodsOpening: แถวเดียว { id (ใหม่), lotNo, itemCode, qty, location, note } · setRodLocation: แถวเดียว { id, location } (ตรงกับ bom_rod_save_lots ของ 20261204010000)
  function bomRodLots(next, rows, nextVersion, actor, at, action) {
    if (!Array.isArray(rows) || rows.length !== 1) fail("BOM_INVALID_ROD");
    const row = rows[0];
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("BOM_INVALID_ROD");
    const id = bomRodUuid(row.id);
    if (action === "receiveRodsOpening") {
      // รูปคำขอก่อนสิทธิ์: เลขล็อต 1-40 (ตัวพิมพ์ใหญ่ ห้ามขึ้นต้น FN- ของล็อตตกแต่ง RubberFlow) · รหัสตามกฎรหัส · 0 < qty <= 1e9 · ตำแหน่ง 1-40 · ที่มา 3-300
      const lotNo = bomRodText(row.lotNo, 1, 40).toUpperCase();
      if (lotNo.startsWith("FN-")) fail("BOM_INVALID_ROD");
      const code = bomCode(bomRodText(row.itemCode, 1, 60));
      if (!code) fail("BOM_INVALID_ROD");
      const qty = bomRodNum(row.qty, 0, 1e9);
      if (qty === null || qty <= 0) fail("BOM_INVALID_ROD");
      const location = bomRodText(row.location, 1, 40);
      const note = bomRodText(row.note, 3, 300);
      bomRodRights(actor, "SR");
      // ชิ้นต้องเป็นเส้นยาง (RB) ในทะเบียน · id และเลขล็อตต้องใหม่ (ผิด = BOM_INVALID_ROD)
      const item = next.items.find((entry) => entry.code === code);
      if (!item || item.kind !== "RB") fail("BOM_INVALID_ROD");
      if (next.rodLots.some((lot) => String(lot.id).toLowerCase() === id) || next.rodLots.some((lot) => lot.lotNo === lotNo)) fail("BOM_INVALID_ROD");
      const q = bomRodRound(qty);
      next.rodLots.push({
        id, lotNo, itemCode: item.code, orderId: null, jobNo: null, woNo: null, recipeCode: null, uom: item.uom, qtySent: q, spec: null,
        status: "stored", qtyReceived: q, qc: null, receivedBy: actor.name, receivedAt: at, decision: null, decisionNote: null, decidedBy: null, decidedAt: null, createdAt: at,
        location, source: "opening", sourceNote: note,
      });
      next.versions.rodLots[id] = nextVersion;
      const moves = bomRodPush(next, nextVersion, at, actor, { lotId: id, itemCode: item.code, kind: "receive", qty: q, ownerOrderId: null, note });
      return { lots: 1, moves, job: false };
    }
    if (action === "setRodLocation") {
      const location = bomRodText(row.location, 1, 40);
      bomRodRights(actor, "SR");
      const lot = bomRodLotOf(next, id);
      // ล็อตที่อยู่ในคลัง (stored) หรือกักรอ QA (held) เท่านั้น
      if (!["held", "stored"].includes(lot.status)) fail("BOM_INVALID_TRANSITION");
      lot.location = location;
      next.versions.rodLots[lot.id] = nextVersion;
      return { lots: 1, moves: 0, job: false };
    }
    if (action === "receiveRods") {
      // รูปคำขอทั้งหมดก่อนสิทธิ์ (ลำดับเดียวกับ bom_rod_save_lots): จำนวน 0 < q <= 1e9 · qc เป็นวัตถุ · ค่าที่วัดเฉพาะสามมิติ 0 < ค่า <= 1e6 (null = ไม่ได้วัด ข้าม)
      // ผล pass | fail บังคับเสมอ (ไม่มีสเปก = SR ตัดสินด้วยตา) · หมายเหตุ <= 300 ตัวอักษร ไม่ผ่านต้อง >= 3
      const qty = bomRodNum(row.qtyReceived, 0, 1e9);
      if (qty === null || qty <= 0) fail("BOM_INVALID_ROD");
      const qc = row.qc;
      if (!qc || typeof qc !== "object" || Array.isArray(qc)) fail("BOM_INVALID_ROD");
      const raw = qc.values === undefined || qc.values === null ? {} : qc.values;
      if (typeof raw !== "object" || Array.isArray(raw)) fail("BOM_INVALID_ROD");
      const values = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!BOM_ROD_SPEC_KEYS.includes(key)) fail("BOM_INVALID_ROD");
        const measured = bomRodNum(value, 0, 1e6);
        if (measured === null) continue;
        if (measured <= 0) fail("BOM_INVALID_ROD");
        values[key] = measured;
      }
      const result = bomRodText(qc.result, 0, 10);
      if (!["pass", "fail"].includes(result)) fail("BOM_INVALID_ROD");
      const note = bomRodText(qc.note, 0, 300);
      if (result === "fail" && note.length < 3) fail("BOM_INVALID_ROD");
      // ตำแหน่งจัดเก็บ (จำเป็น 1-40 หลังตัดช่องว่าง · 20261204010000)
      const location = bomRodText(row.location, 1, 40);
      bomRodRights(actor, "SR");
      const lot = bomRodLotOf(next, id);
      if (lot.status !== "pending") fail("BOM_INVALID_TRANSITION");
      if (qty > Number(lot.qtySent)) fail("BOM_INVALID_ROD");
      // มีสเปก: ทุกคีย์ของสเปกต้องมีค่า และผลที่ส่งมาต้องเท่ากับผลคำนวณ (private.rf_in_spec: |ค่า - target| <= tol เผื่อ 1e-9 · ไม่มี target = ผ่าน)
      if (lot.spec && typeof lot.spec === "object") {
        const keys = Object.keys(lot.spec);
        if (keys.some((key) => values[key] === undefined)) fail("BOM_INVALID_ROD");
        const inSpec = (key) => { const target = lot.spec[key]?.target; return target === undefined || target === null || Math.abs(values[key] - Number(target)) <= Number(lot.spec[key]?.tol) + 1e-9; };
        if (result !== (keys.every(inSpec) ? "pass" : "fail")) fail("BOM_INVALID_ROD");
      }
      Object.assign(lot, { qtyReceived: qty, qc: { values, result, note }, receivedBy: actor.name, receivedAt: at, location, status: result === "pass" ? "stored" : "held" });
      next.versions.rodLots[lot.id] = nextVersion;
      const credit = result === "pass" ? bomRodCredit(next, lot, qty, nextVersion, actor, at) : { moves: 0, job: false };
      return { lots: 1, ...credit };
    }
    const decision = bomRodText(row.decision, 1, 10);
    if (!["accept", "return", "scrap"].includes(decision)) fail("BOM_INVALID_ROD");
    const note = bomRodText(row.decisionNote, 3, 300);
    // ตัดสินล็อตที่กัก = หัวหน้า QA เท่านั้น (20261221010000) · พนักงาน QA กลุ่มวางแผน และแผนกอื่น = BOM_QA_HEAD_ONLY
    if (!qaHead(actor)) fail("BOM_QA_HEAD_ONLY");
    const lot = bomRodLotOf(next, id);
    if (lot.status !== "held") fail("BOM_INVALID_TRANSITION");
    Object.assign(lot, { decision, decisionNote: note, decidedBy: actor.name, decidedAt: at, status: decision === "accept" ? "stored" : decision === "return" ? "returned" : "scrapped" });
    next.versions.rodLots[lot.id] = nextVersion;
    const credit = decision === "accept" ? bomRodCredit(next, lot, lot.qtyReceived, nextVersion, actor, at) : { moves: 0, job: false };
    return { lots: 1, ...credit };
  }
  // issueRods: 1-50 แถว { id, kind: "issue", lotId, ownerOrderId, forOrderId, itemCode, qty < 0 } ทั้งชุดผ่านหรือไม่ผ่าน · reverseRodIssue: แถวเดียว { id, kind: "unissue", reversesId, note }
  // adjustRods: แถวเดียว { id, kind: "adjust", lotId, qty ≠ 0, note } สต็อกกลางของล็อตเท่านั้น
  function bomRodMoves(next, rows, nextVersion, actor, at, action) {
    const bad = () => fail("BOM_INVALID_ROD");
    const kind = { issueRods: "issue", reverseRodIssue: "unissue", adjustRods: "adjust" }[action];
    if (!kind || !Array.isArray(rows) || rows.length < 1 || rows.length > (kind === "issue" ? 50 : 1)) bad();
    // รูปทุกแถวก่อนสิทธิ์ (ลำดับเดียวกับ bom_rod_save_moves): id เป็น uuid ไม่ซ้ำในคำสั่งและไม่มีอยู่แล้ว · kind ตรงกับ action · หมายเหตุ จ่าย <= 300 / ย้อนจ่าย ปรับยอด 3-300
    // ownerOrderId / forOrderId = เลข PI (ตัวใหญ่) · itemCode ตามกฎรหัส · จ่ายต้องมี forOrderId และ itemCode · ปรับยอดห้ามมี ownerOrderId / forOrderId (สต็อกกลางเท่านั้น)
    const seen = new Set();
    const parsed = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) bad();
      const id = bomRodUuid(row.id);
      if (seen.has(id) || next.rodMoves.some((move) => String(move.id).toLowerCase() === id)) bad();
      seen.add(id);
      if (bomRodText(row.kind, 1, 10) !== kind) bad();
      const note = bomRodText(row.note, kind === "issue" ? 0 : 3, 300);
      if (kind === "unissue") return { id, reversesId: bomRodUuid(row.reversesId), note };
      const lotId = bomRodUuid(row.lotId);
      const qty = bomRodNum(row.qty, -1e9, 1e9);
      if (qty === null || qty === 0 || (kind === "issue" && qty > 0)) bad();
      const ownerPi = bomRodText(row.ownerOrderId, 0, 40).toUpperCase() || null;
      const code = bomCode(bomRodText(row.itemCode, 0, 60)) || null;
      let forPi = null;
      if (kind === "issue") {
        forPi = bomRodText(row.forOrderId, 1, 40).toUpperCase();
        if (code === null) bad();
      } else if (ownerPi !== null || bomRodText(row.forOrderId, 0, 40)) bad();
      return { id, lotId, qty, ownerPi, forPi, code, note };
    });
    // สิทธิ์: จ่าย / ย้อนจ่าย / ปรับยอด = แผนก SR หรือกลุ่มวางแผน (ปรับยอดของ SR ตั้งแต่ 20261204010000)
    bomRodRights(actor, "SR");
    let moves = 0;
    for (const row of parsed) {
      if (kind === "unissue") {
        // ย้อนได้เฉพาะแถว issue (อื่น = BOM_INVALID_ROD) ที่ยังไม่ถูกย้อน (ย้อนซ้ำ = BOM_INVALID_TRANSITION)
        const original = next.rodMoves.find((move) => String(move.id).toLowerCase() === row.reversesId) ?? bad();
        if (original.kind !== "issue") bad();
        if (next.rodMoves.some((move) => move.reversesId === original.id)) fail("BOM_INVALID_TRANSITION");
        moves += bomRodPush(next, nextVersion, at, actor, { id: row.id, lotId: original.lotId, itemCode: original.itemCode, kind, qty: -Number(original.qty), ownerOrderId: original.ownerOrderId, forOrderId: original.forOrderId, reversesId: original.id, note: row.note });
        continue;
      }
      // รายแถว: ล็อต (ไม่พบ = BOM_INVALID_ROD) → สถานะ stored (BOM_INVALID_TRANSITION) → รหัสตรงกับล็อต → ใบที่จ่ายให้ released / in_progress → ถังต้นทาง → ยอดถัง (BOM_ROD_EXCEEDS)
      const lot = next.rodLots.find((entry) => String(entry.id).toLowerCase() === row.lotId) ?? bad();
      if (lot.status !== "stored") fail("BOM_INVALID_TRANSITION");
      if (row.code !== null && row.code !== lot.itemCode) bad();
      let owner = null;
      let forId = null;
      if (kind === "issue") {
        const forOrder = next.orders.find((order) => order.id === row.forPi) ?? bad();
        if (!["released", "in_progress"].includes(forOrder.status)) fail("BOM_INVALID_TRANSITION");
        forId = forOrder.id;
        if (row.ownerPi !== null) {
          const ownerOrder = next.orders.find((order) => order.id === row.ownerPi) ?? bad();
          if (ownerOrder.id !== forOrder.id && !BOM_ROD_FREE.includes(ownerOrder.status)) bad();
          owner = ownerOrder.id;
        }
      }
      if (bomRodBalance(next, lot.id, owner) + row.qty < -1e-9) fail("BOM_ROD_EXCEEDS");
      moves += bomRodPush(next, nextVersion, at, actor, { id: row.id, lotId: lot.id, itemCode: lot.itemCode, kind, qty: row.qty, ownerOrderId: owner, forOrderId: forId, note: row.note });
    }
    return { moves };
  }
  // ถังสต็อกกลางของรหัสเส้นยาง เรียง FIFO: ล็อตที่รับเข้าคลังก่อน (receivedAt แล้วเลขล็อต) · ในล็อตเดียวกัน ถังไม่มีเจ้าของก่อน แล้วใบที่ปิด / ยกเลิกเรียงตาม releasedAt (เลข PI)
  function bomRodFreeBuckets(next, itemCode) {
    const sums = new Map();
    for (const move of next.rodMoves) {
      if (move.itemCode !== itemCode) continue;
      const key = `${move.lotId}\u0000${bomRodOwner(move.ownerOrderId) ?? ""}`;
      sums.set(key, bomRodRound((sums.get(key) ?? 0) + Number(move.qty)));
    }
    const releasedAt = (owner) => Number(next.orders.find((order) => order.id === owner)?.releasedAt) || 0;
    return [...sums].map(([key, qty]) => { const [lotId, ownerText] = key.split("\u0000"); return { lot: next.rodLots.find((lot) => lot.id === lotId), owner: ownerText || null, qty }; })
      .filter((bucket) => bucket.lot && bucket.lot.status === "stored" && bucket.qty > 1e-9 && bomRodFreeOwner(next, bucket.owner))
      .sort((a, b) => (Number(a.lot.receivedAt) || 0) - (Number(b.lot.receivedAt) || 0) || bomCmp(a.lot.lotNo, b.lot.lotNo) || (a.owner === null ? 0 : 1) - (b.owner === null ? 0 : 1) || releasedAt(a.owner) - releasedAt(b.owner) || bomCmp(a.owner ?? "", b.owner ?? ""));
  }
  // ปล่อยผลิต (draft → released): ทุกรหัสเส้นยางของผลระเบิด BOM ที่ stockCounts = n > 0 หยิบ n จากสต็อกกลาง FIFO แถว transfer คู่ (−k ถังต้นทาง +k ถังของใบ for = ใบนี้) · ไม่พอ = BOM_ROD_EXCEEDS
  function bomReleaseRodStock(next, order, nextVersion, actor, at) {
    const counts = order.stockCounts && typeof order.stockCounts === "object" && !Array.isArray(order.stockCounts) ? order.stockCounts : {};
    const codes = [...new Set((Array.isArray(order.explosion) ? order.explosion : []).filter((line) => line?.kind === "RB").map((line) => line.itemCode))].sort(bomCmp);
    let moves = 0;
    for (const code of codes) {
      const n = Number(counts[code]);
      if (!(n > 0)) continue;
      const buckets = bomRodFreeBuckets(next, code);
      if (buckets.reduce((sum, bucket) => sum + bucket.qty, 0) + 1e-9 < n) fail("BOM_ROD_EXCEEDS");
      let left = bomRodRound(n);
      for (const bucket of buckets) {
        if (left <= 1e-9) break;
        const k = bomRodRound(Math.min(bucket.qty, left));
        moves += bomRodPush(next, nextVersion, at, actor, { lotId: bucket.lot.id, itemCode: code, kind: "transfer", qty: -k, ownerOrderId: bucket.owner, forOrderId: order.id });
        moves += bomRodPush(next, nextVersion, at, actor, { lotId: bucket.lot.id, itemCode: code, kind: "transfer", qty: k, ownerOrderId: order.id, forOrderId: order.id });
        left = bomRodRound(left - k);
      }
    }
    return moves;
  }
  // เปิดใบกลับมาแก้ (released / in_progress → draft): คืนแท่งที่ใบนี้หยิบตอนปล่อยผลิตต่อล็อต t = min(Σ transfer ที่เจ้าของ = ใบนี้ และ for = ใบนี้, ยอดที่ใบถืออยู่) แถว transfer คู่กลับเข้าสต็อกกลาง
  function bomReturnRodStock(next, orderId, nextVersion, actor, at) {
    const nets = new Map();
    for (const move of next.rodMoves) if (move.kind === "transfer" && move.forOrderId === orderId && bomRodOwner(move.ownerOrderId) === orderId) nets.set(move.lotId, { itemCode: move.itemCode, qty: bomRodRound((nets.get(move.lotId)?.qty ?? 0) + Number(move.qty)) });
    let moves = 0;
    for (const [lotId, entry] of [...nets].sort((a, b) => bomCmp(a[0], b[0]))) {
      const t = bomRodRound(Math.min(entry.qty, bomRodBalance(next, lotId, orderId)));
      if (!(t > 1e-9)) continue;
      moves += bomRodPush(next, nextVersion, at, actor, { lotId, itemCode: entry.itemCode, kind: "transfer", qty: -t, ownerOrderId: orderId, forOrderId: orderId });
      moves += bomRodPush(next, nextVersion, at, actor, { lotId, itemCode: entry.itemCode, kind: "transfer", qty: t, ownerOrderId: null, forOrderId: orderId });
    }
    return moves;
  }
  // รูปของ payload (ตรงกับวงตรวจรูปของ app_bom_save_master): ส่วนที่รู้จัก (stockMoves ส่งเองไม่ได้) · upsert / delete ต้องเป็นอาร์เรย์ (ไม่ใช่ = BOM_INVALID_PAYLOAD) · delete เฉพาะ colorSets / packages / jobs ·
  // ส่วนที่ส่งได้ต่อ action: fgMoves ↔ receiveFg / deliverFg / closeOrderShort (ผิด = BOM_INVALID_FG ตรวจก่อนกฎของส่วนอื่น) · partReturns ↔ undoOrderParts / returnOrderParts · stock ↔ countPartStock · issueOrderParts ส่งได้เฉพาะ jobs upsert (ผิด = BOM_INVALID_PAYLOAD)
  // สามการกระทำของสำเร็จรูปต้องมีคำขอใน fgMoves เสมอ (ไม่มีส่วนนี้ หรือ upsert ว่าง = BOM_INVALID_FG) · ทั้งหมดตรวจก่อนรอบข้อมูล (BOM_RESET) และเวอร์ชันฐานที่สูงเกิน (BOM_INVALID_PAYLOAD) เหมือนฐานข้อมูล (20261122010000)
  function bomCheckShape(changes, action) {
    for (const [list, entry] of Object.entries(changes)) {
      if ((list !== "partReturns" && !BOM_LISTS.includes(list)) || list === "stockMoves") fail("BOM_INVALID_PAYLOAD");
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        for (const sub of ["upsert", "delete"]) if (Object.hasOwn(entry, sub) && !Array.isArray(entry[sub])) fail("BOM_INVALID_PAYLOAD");
      }
      const count = (entry?.upsert?.length ?? 0) + (entry?.delete?.length ?? 0);
      if (entry && typeof entry === "object" && Object.hasOwn(entry, "delete") && !BOM_DELETABLE.includes(list)) fail("BOM_INVALID_PAYLOAD");
      if (count > 0 && ((list === "fgMoves" && !bomFgKind(action)) || (bomFgKind(action) && list !== "fgMoves"))) fail("BOM_INVALID_FG");
      // คลังแท่งยาว: rodLots ↔ receiveRods / decideRods · rodMoves ↔ issueRods / reverseRodIssue / adjustRods (ผิด = BOM_INVALID_ROD เหมือนส่วนของสำเร็จรูป)
      if (count > 0 && (((list === "rodLots" || list === "rodMoves") && bomRodAction(action) !== list) || (bomRodAction(action) && list !== bomRodAction(action)))) fail("BOM_INVALID_ROD");
      // แปรรูปยาง GR: ห้าส่วน ↔ action ของส่วนนั้นเท่านั้น (ผิด = BOM_INVALID_GR)
      if (count > 0 && ((BOM_GR_LISTS.includes(list) && bomGrSection(action) !== list) || (bomGrSection(action) && list !== bomGrSection(action)))) fail("BOM_INVALID_GR");
      if (count > 0 && ((list === "partReturns" && !BOM_RETURN_ACTIONS.includes(action)) || (BOM_RETURN_ACTIONS.includes(action) && list !== "partReturns"))) fail("BOM_INVALID_PAYLOAD");
      if (count > 0 && ((list === "stock" && action !== "countPartStock") || (action === "countPartStock" && list !== "stock") || (action === "issueOrderParts" && !(list === "jobs" && !entry?.delete?.length)))) fail("BOM_INVALID_PAYLOAD");
    }
    if (bomFgKind(action) && !(Array.isArray(changes.fgMoves?.upsert) && changes.fgMoves.upsert.length > 0)) fail("BOM_INVALID_FG");
    if (bomRodAction(action) && !(Array.isArray(changes[bomRodAction(action)]?.upsert) && changes[bomRodAction(action)].upsert.length > 0)) fail("BOM_INVALID_ROD");
    if (bomGrSection(action) && !(Array.isArray(changes[bomGrSection(action)]?.upsert) && changes[bomGrSection(action)].upsert.length > 0)) fail("BOM_INVALID_GR");
  }
  function bomApply(current, changes, base, actor, at, rfOps = { release: [], cancel: [] }, action = "", meta = {}) {
    const next = clone(current);
    const nextVersion = current.version + 1;
    // แถวงานของซื้อที่ issueOrderParts ส่งมาตรวจโดย bomIssueParts ด้านล่าง
    // ระเบียนที่คำสั่งนี้แก้เอง (เวอร์ชัน nextVersion) ไม่นับว่าเป็นของผู้อื่น
    const mine = new Set();
    const changedByOthers = (list, id) => (next.versions[list][id] ?? 0) > base && !mine.has(`${list}|${id}`);
    const stamp = (list, id) => { next.versions[list][id] = nextVersion; mine.add(`${list}|${id}`); };
    const released = []; // ใบที่ปล่อยผลิตในคำสั่งนี้ (งานใหม่เกิดได้เฉพาะใบเหล่านี้ และต้องมีงานอย่างน้อยหนึ่งงาน)
    const startedJobs = [];
    const jobsOf = (orderId) => next.jobs.filter((job) => job.orderId === orderId);
    // ลบงานทั้งหมดของใบ (ยกเลิก / เปิดกลับมาแก้) พร้อมหลุมฝังศพ เหมือนที่ฐานข้อมูลทำเอง
    const dropJobs = (orderId) => {
      for (const job of jobsOf(orderId)) {
        next.jobs = next.jobs.filter((row) => row !== job);
        delete next.versions.jobs[job.id];
        next.tombstones = next.tombstones.filter((row) => !(row.list === "jobs" && row.code === job.id));
        next.tombstones.push({ list: "jobs", base: null, code: job.id, version: nextVersion });
      }
    };
    for (const list of BOM_LISTS) {
      const entry = changes[list];
      if (entry === undefined || list === "stock" || list === "stockMoves" || list === "fgMoves" || list === "rodLots" || list === "rodMoves" || BOM_GR_LISTS.includes(list)) continue; // สต็อกของซื้อ สำเร็จรูป คลังยางเส้นยาว และ GR เขียนโดยตัวเขียนเฉพาะด้านล่าง
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("BOM_INVALID_CHANGES");
      const idOf = BOM_ID[list];
      for (const record of entry.upsert ?? []) {
        const keyField = list === "boms" || list === "routings" || list === "orders" || list === "jobs" ? "id" : list === "customers" ? "name" : "code";
        const hasKey = list === "colorSets" || list === "packages" ? record?.base && record?.code : record?.[keyField] && String(record[keyField]).trim();
        if (!record || typeof record !== "object" || !hasKey) fail("BOM_INVALID_RECORD");
        const id = idOf(record);
        const index = next[list].findIndex((row) => idOf(row) === id);
        const prev = index === -1 ? null : next[list][index];
        // ใบที่ตรงกับแถวล่าสุด หรือมีแค่ released → in_progress ที่มากับงานของใบนี้: ไม่เขียนและไม่ตรวจชน (ตรงกับ bom_save_orders)
        if (list === "orders" && prev && bomOrderPassThrough(prev, record, changes.jobs?.upsert ?? [])) continue;
        // ชนก่อนสิทธิ์เสมอ (ใบสั่งผลิต/งาน): ระเบียนถูกผู้อื่นแก้ หรืองานถูกลบหลัง base = ฝั่ง client ถือสำเนาเก่า ต้องได้ BOM_STALE ไม่ใช่ BOM_FORBIDDEN
        if ((list === "orders" || list === "jobs") && (prev
          ? changedByOthers(list, id)
          : next.tombstones.some((row) => row.list === list && graveKey(row) === id && row.version > base && row.version <= current.version))) fail("BOM_STALE");
        if (bomCheckRecord(list, prev, record, actor, action) === "part") {
          // issueOrderParts: ช่องอื่นของงานต้องไม่เปลี่ยน และใบต้องอยู่ในสถานะผลิต แล้วข้ามไป (bom_issue_parts ตั้งยอดเบิกสะสม/สถานะของงาน หักสต็อก เขียนประวัติเอง)
          const workKeys = ["status", "qtyDone", "qtyReject", "reports", "doneAt"];
          if (bomCanon(bomWithout(prev, workKeys)) !== bomCanon(bomWithout(record, workKeys))) fail("BOM_INVALID_JOB");
          const owner = next.orders.find((row) => row.id === prev.orderId);
          if (!owner || !["released", "in_progress"].includes(owner.status)) fail("BOM_INVALID_TRANSITION");
          continue;
        }
        // สูตรยางผูกกับสูตร PHR ของ RubberFlow ได้เฉพาะรหัสสูตรที่มีอยู่ในฐานข้อมูล RubberFlow (revision ใดก็ได้ · ตรงกับ bom_save_compounds)
        if (list === "compounds" && record.recipeId !== undefined && record.recipeId !== null && !rfLoad().recipes.some((row) => row.id === record.recipeId)) fail("BOM_INVALID_COMPOUND");
        const releasedBefore = released.length;
        if (list === "orders") bomOrderTransition(prev, record, { jobRows: changes.jobs?.upsert ?? [], jobsOf, dropJobs, released, rfCancel: rfOps.cancel, returnFgStock: (orderId) => { meta.fgStockMoves = (meta.fgStockMoves ?? 0) + bomReturnFgStock(next, orderId, nextVersion, actor, at); }, returnRodStock: (orderId) => { meta.rodMoves = (meta.rodMoves ?? 0) + bomReturnRodStock(next, orderId, nextVersion, actor, at); }, rodIssued: (orderId) => bomRodIssued(next, orderId) });
        if (list === "jobs") bomJobRules(prev, record, actor, next, released, action, rfOps.cancel);
        if (index === -1) {
          if (list === "colorSets" || list === "packages" || list === "jobs") {
            // ผู้อื่นลบหลัง base = ชน · สร้างกุญแจเดิมใหม่ = ลบหลุมฝังศพ
            const grave = next.tombstones.findIndex((row) => row.list === list && graveKey(row) === id);
            if (grave !== -1) {
              if (next.tombstones[grave].version > base) fail("BOM_STALE");
              next.tombstones.splice(grave, 1);
            }
          }
          // BOM และ routing ใหม่ของชิ้นที่ผู้อื่นเพิ่ง/แก้ revision ไว้หลัง base = ชน (ผู้บันทึกคนที่สองของ revision เดียวกัน)
          if ((list === "boms" || list === "routings") && next[list].some((row) => row.itemCode === record.itemCode && changedByOthers(list, idOf(row)))) fail("BOM_STALE");
          next[list].push(bomStamp(list, record, undefined, actor, at));
        } else {
          if (changedByOthers(list, id)) fail("BOM_STALE");
          // BOM และ routing ที่บันทึกแล้วแก้ไม่ได้ (BOM_REVISION_IMMUTABLE) นอกจากถูกแทนที่ (approved → superseded) · BOM แก้แผนกเจ้าของได้และต่อท้าย changeLog ได้ (ตรงกับ app_bom_save_master)
          if (list === "boms" || list === "routings") {
            const old = next[list][index];
            const owned = { status: 0, supersededAt: 0, createdAt: 0, createdBy: 0, approvedAt: 0, approvedBy: 0, ...(list === "boms" ? { ownerDept: 0, changeLog: 0 } : {}) }; // ฟิลด์ที่ฐานข้อมูลเป็นเจ้าของหรือเปลี่ยนได้ ไม่นับเป็นการแก้เนื้อหา
            // บรรทัด / หมายเหตุของ BOM แก้ในฉบับเดิมได้ตามกติกาของ bomEditInPlace (20261129010000) จึงแยกตรวจข้างล่าง
            const content = list === "boms" ? { lines: 0, note: 0 } : {};
            const same = bomCanon({ ...old, ...owned, ...content }) === bomCanon({ ...record, ...owned, ...content });
            const logOf = (row) => (Array.isArray(row.changeLog) ? row.changeLog : []);
            const logKept = list !== "boms" || (logOf(record).length >= logOf(old).length && logOf(old).every((item, position) => bomCanon(item) === bomCanon(logOf(record)[position])));
            if (!same || !logKept || (old.status !== record.status && !(old.status === "approved" && record.status === "superseded"))) fail("BOM_REVISION_IMMUTABLE");
            const contentChanged = list === "boms" && (bomCanon(old.lines ?? null) !== bomCanon(record.lines ?? null) || String(old.note ?? "") !== String(record.note ?? ""));
            if (contentChanged && !(bomEditInPlace(next, old, record, actor, at) && logOf(record).length > logOf(old).length)) fail("BOM_REVISION_IMMUTABLE");
          }
          next[list][index] = bomStamp(list, record, next[list][index], actor, at);
        }
        if (list === "jobs" && record.status !== "queued") startedJobs.push(record);
        stamp(list, id);
        // ปล่อยผลิต: หักสต็อกสินค้าสำเร็จรูปของใบนี้ทันทีตามลำดับแถว ก่อนตรวจงานทุกแถว (ตรงกับ bom_save_orders ที่รันก่อน bom_save_jobs)
        // ใบที่ปล่อยก่อนในคำสั่งเดียวกันหยิบก่อน · ใบที่ได้ครบทุกสินค้าเป็น completed ในคำสั่งนี้
        if (list === "orders" && released.length > releasedBefore) {
          const stock = bomReleaseFgStock(next, next.orders.find((row) => idOf(row) === id), nextVersion, actor, at);
          if (stock.moves) meta.fgStockMoves = (meta.fgStockMoves ?? 0) + stock.moves;
          // เส้นยางที่ตั้งใช้จากคลังแท่งยาว (SR): หักจากสต็อกกลางในคำสั่งเดียวกัน ต่อจากสต็อกสินค้าสำเร็จรูป (20261202010000)
          const rods = bomReleaseRodStock(next, next.orders.find((row) => idOf(row) === id), nextVersion, actor, at);
          if (rods) meta.rodMoves = (meta.rodMoves ?? 0) + rods;
        }
      }
      for (const target of entry.delete ?? []) {
        if (!BOM_DELETABLE.includes(list)) fail("BOM_INVALID_CHANGES");
        if (!bomIsPlanner(actor)) fail("BOM_FORBIDDEN");
        const id = targetKey(list, target);
        const index = next[list].findIndex((row) => idOf(row) === id);
        if (index === -1) {
          const grave = next.tombstones.find((row) => row.list === list && graveKey(row) === id);
          if (list === "jobs" && grave?.version === nextVersion) continue; // ถูกลบในคำสั่งเดียวกัน (ยกเลิก / เปิดใบกลับมาแก้) ข้าม
          fail(grave && grave.version > base ? "BOM_STALE" : "BOM_NOT_FOUND");
        }
        if (changedByOthers(list, id)) fail("BOM_STALE");
        if (list === "jobs" && bomJobStarted(next[list][index])) fail("BOM_INVALID_TRANSITION"); // งานที่เริ่มแล้วลบตรงๆ ไม่ได้
        next[list].splice(index, 1);
        delete next.versions[list][id];
        next.tombstones = next.tombstones.filter((row) => !(row.list === list && graveKey(row) === id));
        next.tombstones.push(list === "jobs" ? { list, base: null, code: id, version: nextVersion } : { list, base: target.base, code: target.code, version: nextVersion });
      }
    }
    // สต็อกของซื้อ: นับ (countPartStock) และเบิกจ่ายรายใบ (issueOrderParts) ในธุรกรรมเดียวกับงาน
    bomSaveStock(next, changes.stock?.upsert ?? [], base, current.version, nextVersion, actor, at);
    // ส่งทุกแถวของ jobs.upsert (เหมือน SQL): แถวที่ไม่ใช่งานของซื้อของใบเดียวกัน = BOM_INVALID_JOB
    if (action === "issueOrderParts") meta.issued = bomIssueParts(next, changes.jobs?.upsert ?? [], base, current.version, nextVersion, actor, at);
    if (bomFgKind(action)) meta.fg = action === "reverseFg" ? bomFgReverse(next, changes.fgMoves?.upsert ?? [], nextVersion, actor, at) : bomFgMoves(next, changes.fgMoves?.upsert ?? [], nextVersion, actor, at, action);
    if (BOM_RETURN_ACTIONS.includes(action)) meta.returned = bomReturnParts(next, changes.partReturns?.upsert ?? [], base, current.version, nextVersion, actor, at);
    if (bomRodAction(action) === "rodLots") meta.rod = bomRodLots(next, changes.rodLots?.upsert ?? [], nextVersion, actor, at, action);
    if (bomRodAction(action) === "rodMoves") meta.rod = bomRodMoves(next, changes.rodMoves?.upsert ?? [], nextVersion, actor, at, action);
    // แปรรูปยาง GR (private.bom_gr_save): ยอดของงาน / สถานะใบที่เปลี่ยนนับเป็น jobs / orders ของบันทึกการใช้งาน
    if (bomGrSection(action)) meta.gr = bomGrSave(next, changes[bomGrSection(action)]?.upsert ?? [], base, current.version, nextVersion, actor, at, action);
    // ใบที่ปล่อยผลิตในคำสั่งนี้ (ตรงกับ app_bom_save_master ของ 20261124010000): ยังไม่ completed ต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้)
    // completed (ได้ครบทุกสินค้าจากสต็อกตอนปล่อย ด้านบน) ต้องไม่มีงาน เพราะงานของใบที่ปิดแล้วทำต่อไม่ได้
    for (const orderId of released) {
      const completed = next.orders.find((row) => row.id === orderId)?.status === "completed";
      if (completed === next.jobs.some((job) => job.orderId === orderId)) fail("BOM_INVALID_TRANSITION");
    }
    rfOps.release = [...released];
    // งานเริ่ม (ออกจากรอคิว) ทำให้ใบที่ปล่อยผลิตแล้วเปลี่ยนเป็นกำลังผลิตเองในคำสั่งเดียวกัน (ผู้รายงานไม่ใช่ฝ่ายวางแผนก็ไม่ต้องส่งการแก้ใบ)
    for (const job of startedJobs) {
      const order = next.orders.find((row) => row.id === job.orderId);
      if (order && order.status === "released") { order.status = "in_progress"; stamp("orders", order.id); }
    }
    const R = globalThis.MNP_BOM_RULES;
    const itemOf = (code) => next.items.find((row) => row.code === code);
    for (const item of next.items) if (R && !Object.hasOwn(R.KINDS, item.kind)) fail("BOM_INVALID_ITEM_KIND");
    for (const bom of next.boms) {
      const parent = itemOf(bom.itemCode) ?? fail("BOM_INVALID_BOM_ITEM");
      if (!["approved", "superseded"].includes(bom.status)) fail("BOM_INVALID_BOM_STATUS");
      if (bom.status === "approved" && next.boms.some((row) => row !== bom && row.itemCode === bom.itemCode && row.status === "approved")) fail("BOM_INVALID_BOM_STATUS");
      if (!Array.isArray(bom.lines) || !bom.lines.length) fail("BOM_INVALID_BOM_LINE");
      for (const line of bom.lines) {
        const child = itemOf(line.childCode) ?? fail("BOM_INVALID_BOM_LINE");
        if (!(Number(line.qty) > 0)) fail("BOM_INVALID_BOM_LINE");
        if (R && R.childKindError(parent.kind, child.kind)) fail("BOM_INVALID_BOM_LINE");
      }
    }
    // วงจร: เดินจาก BOM ที่อนุมัติลงไปตามลูก ห้ามเจอพ่อเดิมในเส้นทาง (ตรงกับการตรวจ BOM_CYCLE ของฐานข้อมูล)
    const kids = new Map(next.boms.filter((bom) => bom.status === "approved").map((bom) => [bom.itemCode, bom.lines.map((line) => line.childCode)]));
    const state = new Map();
    const walk = (code) => {
      state.set(code, 1);
      for (const child of kids.get(code) ?? []) {
        if (state.get(child) === 1) fail("BOM_CYCLE");
        if (!state.has(child)) walk(child);
      }
      state.set(code, 2);
    };
    for (const code of kids.keys()) if (!state.has(code)) walk(code);
    for (const routing of next.routings) {
      if (!itemOf(routing.itemCode)) fail("BOM_INVALID_ROUTING");
      if (routing.status === "approved" && next.routings.some((row) => row !== routing && row.itemCode === routing.itemCode && row.status === "approved")) fail("BOM_INVALID_ROUTING");
    }
    for (const job of next.jobs) if (!next.orders.some((order) => order.id === job.orderId)) fail("BOM_INVALID_JOB");
    return next;
  }
  // ---- ข้อมูลของ RubberFlow (โมดูลทดสอบ #/rubberflow): app_rf_master / app_rf_master_since / app_rf_save / app_rf_audit และ app_sandbox_purge_rf ----
  // โครงเดียวกับข้อมูลหลักของ BOM ด้านบน (ทุกระเบียนจำเลขรุ่นที่แก้ล่าสุด ชนรายระเบียน RF_STALE ก่อนตรวจสิทธิ์ ส่วนต่าง {version, epoch, changes} รอบข้อมูล epoch) เก็บที่ storage คีย์ mnp-harness-rf-master
  // 11 ชุด: materials (code) · recipes (รหัสสูตร + revision ทุก revision) · orders (WO) · materialLots (lotNo) · requisitions · lots (MX/EX/CU/FN) · transfers · fgBoxes · qcRecords · ncrs · molds · ไม่มีการลบ
  // สิทธิ์: กลุ่มวางแผน (admin ผู้จัดการแผนกขึ้นไป แผนก PP) ทำได้ทุกอย่าง · สมาชิก RB แก้วัตถุดิบ/ร่างสูตร/เปิด WO เบิก-ชั่ง บันทึกผสม ฉีด อบ ตกแต่ง ส่งมอบ WIP แม่พิมพ์ และกรอกการแก้ไข/ป้องกันของ NCR
  // อนุมัติสูตรและปล่อยผลิต = หัวหน้า RB (ผู้จัดการ/ผู้ช่วยผู้จัดการแผนก RB หรือผู้ช่วยผู้จัดการโรงงานขึ้นไป) หรือกลุ่มวางแผน (ปล่อยผลิต) · ST รับวัตถุดิบเข้าคลัง · ST/QA กักกันล็อตวัตถุดิบ
  // สมาชิก RB รับมอบ WIP ด้วย (20261204010000 · เดิม SR) · WH ส่งมอบกล่อง · QA บันทึกผลตรวจและเปิด/ปิด NCR · ฐานข้อมูลคำนวณเอง: สต็อกล็อตหลังชั่ง คงเหลือ/ยอดส่งต่อของใบส่งมอบ ยอดผลิตของ WO สถานะกล่องตามผล QC การใช้แม่พิมพ์ (ไม่เชื่อค่าที่ client ส่ง)
  // WO ที่มี sourceJobId ผูกงาน RB ของ BOM ในคำสั่งเดียวกัน (externalRef) · ล็อตตกแต่งของ WO ที่ผูกงานผ่าน QC และนับเข้า WO (ตอนบันทึก หรือ QA ตัดสินเป็น pass) → ไม่สร้างกล่อง แต่สร้างล็อตแท่ง pending ในคลังแท่งยาวของ BOM (20261202010000 · งาน RB นับยอดเมื่อ SR รับเข้าผ่าน) (การรับมอบใบส่งมอบไม่เขียน BOM) ผ่านตัวนับเวอร์ชันของ BOM ด้วย
  const RF_KEY = sandbox ? "mnp-harness-rf-master" : "mnp-harness-rf-master-real";
  // chemDocs (20261220010000): เอกสารคลังเคมี ST / RB ใบขอเบิก CR ใบคืน CT ใบนับคลัง RB CC (ตรงกับ public.rf_chem_docs)
  const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "purchaseOrders", "chemDocs"];
  const RF_ID = { materials: (record) => record.code, recipes: (record) => `${record.id}|${record.revision}`, orders: (record) => record.id, materialLots: (record) => record.lotNo };
  for (const list of RF_LISTS) RF_ID[list] ??= (record) => record.id;
  const rfSorter = (list) => (list === "recipes" ? (a, b) => bomCmp(a.id, b.id) || a.revision - b.revision : (a, b) => bomCmp(RF_ID[list](a), RF_ID[list](b)));
  const RF_ACTIONS = ["saveMaterial", "createRecipe", "saveRecipe", "approveRecipe", "createOrder", "setOrderStatus", "receiveMaterial", "setMaterialLotStatus", "createRequisition", "weighLine", "recordMixing", "endRest", "recordExtrusion", "recordCuring", "recordFinishing", "createTransfer", "receiveTransfer", "shipBoxes", "addQcRecord", "createNcr", "updateNcr", "closeNcr", "cleanMold", "saveMold", "createPurchaseOrder", "receivePurchaseLine", "cancelPurchaseOrder", "issueRequisition", "returnRequisition", "closePurchaseLine",
    // กล่องสินค้าของคลังสินค้าสำเร็จรูป (20261207010000)
    "receiveBoxes", "reverseBoxReceipt", "reverseBoxShip",
    // คลังเคมี ST / RB (20261220010000)
    "requestChemicals", "cancelChemicalRequest", "issueChemicals", "closeChemicalRequest", "countRbStock", "returnChemicals", "receiveChemicalReturn", "rejectChemicalReturn"];
  // คำสั่งของคลังเคมี: ส่งได้เฉพาะชุด chemDocs กับสำเนาล็อตวัตถุดิบ · ชุด chemDocs ส่งได้เฉพาะคำสั่งเหล่านี้ (ผิด = RF_INVALID_CHEM ตรงกับ app_rf_save)
  const RF_CHEM_ACTIONS = ["requestChemicals", "cancelChemicalRequest", "issueChemicals", "closeChemicalRequest", "countRbStock", "returnChemicals", "receiveChemicalReturn", "rejectChemicalReturn"];
  // คำสั่งของกล่อง: ทาง [จาก, ไป, ชนิดประวัติ] (ตรงกับ private.rf_save_boxes ของ 20261207010000) · ส่งได้เฉพาะชุด fgBoxes
  const RF_BOX_STEPS = { receiveBoxes: ["pending_wh", "in_stock", "receive"], shipBoxes: ["in_stock", "shipped", "ship"], reverseBoxReceipt: ["in_stock", "pending_wh", "unreceive"], reverseBoxShip: ["shipped", "in_stock", "unship"] };
  const RF_FLOW = { planned: ["released", "cancelled"], released: ["in_progress", "on_hold", "cancelled"], in_progress: ["on_hold", "completed"], on_hold: ["in_progress"] };
  const RF_ORDER_STATUSES = ["planned", "released", "in_progress", "on_hold", "completed", "cancelled"];
  // ฟิลด์ที่เซิร์ฟเวอร์เป็นเจ้าของ (ตราผู้บันทึก/เวลา): ไม่นับเป็นการแก้เนื้อหา · RECIPE_OWNED / ORDER_OWNED รวมสถานะ (และยอดผลิต) ที่เปลี่ยนตามกฎของตัวเอง
  const RF_RECIPE_STAMPS = ["createdAt", "createdBy", "approvedAt", "approvedBy", "supersededAt"];
  const RF_RECIPE_OWNED = ["status", ...RF_RECIPE_STAMPS];
  const RF_ORDER_STAMPS = ["createdAt", "createdBy", "releasedAt", "releasedBy", "completedAt", "cancelledAt"];
  const RF_ORDER_OWNED = ["status", "producedQty", ...RF_ORDER_STAMPS];
  const RF_MATERIAL_STAMPS = ["createdAt", "createdBy", "updatedAt", "updatedBy"];
  // รหัสต้องตรงกับ check ของตาราง rf_* (rf_materials.code · rf_recipes.recipe_code · rf_orders.wo_no) ผิด = รหัสข้อผิดพลาดของชุดนั้น
  const RF_CODE = { materials: /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, recipes: /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/, orders: /^[A-Za-z0-9._-]{1,40}$/ };
  const RF_BAD = { materials: "RF_INVALID_MATERIAL", recipes: "RF_INVALID_RECIPE", orders: "RF_INVALID_ORDER", materialLots: "RF_INVALID_MATERIAL_LOT", requisitions: "RF_INVALID_REQUISITION", lots: "RF_INVALID_LOT", transfers: "RF_INVALID_TRANSFER", fgBoxes: "RF_INVALID_BOX", qcRecords: "RF_INVALID_QC", ncrs: "RF_INVALID_NCR", molds: "RF_INVALID_MOLD", purchaseOrders: "RF_INVALID_PURCHASE", chemDocs: "RF_INVALID_CHEM" };
  // ชุดหน้างาน: เลขที่/รหัสของเอกสาร (lotNo ของล็อตวัตถุดิบ, id ของที่เหลือ) · ใบสั่งซื้อ = PO-yyyymmdd-nn (po_no)
  for (const list of RF_LISTS.slice(3)) RF_CODE[list] = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  RF_CODE.purchaseOrders = /^PO-[0-9]{8}-[0-9]{2,6}$/;
  RF_CODE.chemDocs = /^C[RTC]-[0-9]{8}-[0-9]{2,6}$/;
  // ช่องที่ฐานข้อมูลประทับ/คำนวณเอง ต่อชุด: ระเบียนที่ต่างจากของเดิมเฉพาะช่องเหล่านี้ถือว่าไม่มีอะไรเปลี่ยน (ไม่ตรวจชน ไม่ตรวจสิทธิ์ ไม่เพิ่มเวอร์ชัน)
  const RF_NOOP = {
    materials: RF_MATERIAL_STAMPS, recipes: RF_RECIPE_STAMPS, orders: [...RF_ORDER_STAMPS, "producedQty"],
    materialLots: ["qtyKg", "rbKg", "receivedAt", "receivedBy"], requisitions: ["requestedBy", "createdAt", "issuedAt", "issuedBy", "store"],
    lots: ["operator", "createdAt", "transferredQty", "countedToOrder", "destination", "whCredit"], transfers: ["remaining", "createdAt", "createdBy", "receivedAt", "receivedBy"],
    fgBoxes: ["createdAt", "shippedAt", "shippedBy", "receivedAt", "receivedBy", "moves", "customer", "customerPo"], qcRecords: ["inspector", "at"], ncrs: ["createdAt", "createdBy", "closedAt", "closedBy"], molds: ["totalUsage"],
    purchaseOrders: ["createdAt", "createdBy", "cancelledAt"],
  };
  // ใบเบิก: เวลา/ผู้ชั่งของแต่ละรายการเป็นตราของฐานข้อมูล · ใบสั่งซื้อ: เวลา/ผู้รับของแต่ละบรรทัดเป็นตราของฐานข้อมูล · วัตถุดิบที่ไม่ส่งสต็อกขั้นต่ำ/อายุการเก็บ = ค่าตั้งต้น (0 และ 180)
  const rfNorm = (list, record) => {
    // รับเคมีคืน (20261128010000): เวลา/ผู้รับคืน/เหตุผลของแต่ละบรรทัดเป็นตราของฐานข้อมูล · ยอด returnedKg เท่านั้นที่ client บอกได้
    if (list === "requisitions" && Array.isArray(record?.lines)) return { ...bomWithout(record, ["returnNote"]), lines: record.lines.map((line) => bomWithout(line, ["weighedAt", "weighedBy", "returnedAt", "returnedBy", "returnNote"])) };
    // บรรทัดของซื้อ (source bom) มี uom ที่เซิร์ฟเวอร์ตั้งจาก item master ของ BOM (ค่าของ client เมิน) · ไม่มี source = เคมี (ใบ/Pilot รุ่นเก่า)
    // รับหลายครั้ง (20261128020000): receipts เป็นของเซิร์ฟเวอร์ (ค่าของ client เมิน) · closedRemainder ของ client มีความหมายแค่ reason (คำขอปิด)
    if (list === "purchaseOrders" && Array.isArray(record?.lines)) {
      return { ...record, lines: record.lines.map((line) => ({ ...bomWithout(line, ["receivedAt", "receivedBy", "uom", "receipts", "closedRemainder"]), source: line?.source ?? "rf",
        ...(line?.closedRemainder && typeof line.closedRemainder === "object" ? { closedRemainder: { reason: typeof line.closedRemainder.reason === "string" ? line.closedRemainder.reason.trim() : line.closedRemainder.reason ?? "" } } : {}) })) };
    }
    if (list === "materials" && record && typeof record === "object") return { safetyKg: 0, shelfLifeDays: 180, ...record };
    return record;
  };
  let rfMaster = null;
  const freshRf = () => ({ version: 0, epoch: newEpoch(), ...Object.fromEntries(RF_LISTS.map((list) => [list, []])), versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [] });
  function rfLoad() {
    if (!rfMaster) {
      try { rfMaster = JSON.parse(storage?.getItem?.(RF_KEY) ?? "null"); } catch { rfMaster = null; }
      if (!rfMaster || typeof rfMaster.version !== "number") rfMaster = freshRf();
      if (typeof rfMaster.epoch !== "string") rfMaster.epoch = newEpoch();
      for (const list of RF_LISTS) if (!Array.isArray(rfMaster[list])) rfMaster[list] = [];
      rfMaster.versions = Object.fromEntries(RF_LISTS.map((list) => [list, rfMaster.versions?.[list] ?? {}]));
      if (!Array.isArray(rfMaster.audit)) rfMaster.audit = [];
      // กล่องรุ่นก่อน 20261207010000 ที่อยู่ในคลัง / ส่งมอบแล้ว: รับเข้าเมื่อสร้าง (ตรงกับการเติม received_at ของ migration) แล้วเลื่อนตัวนับหนึ่งขั้น
      const legacy = rfMaster.fgBoxes.filter((box) => ["in_stock", "shipped"].includes(box?.status) && (box.receivedAt === undefined || box.receivedAt === null));
      if (legacy.length) {
        rfMaster.version += 1;
        for (const box of legacy) { box.receivedAt = box.createdAt; rfMaster.versions.fgBoxes[box.id] = rfMaster.version; }
      }
      // ข้อมูลก่อนแยกคลังเคมี (20261220010000): ล็อตเดิมอยู่คลัง ST ทั้งหมด (rbKg 0) · ใบเบิกเดิมเป็นของคลัง ST (ค่าเริ่มของคอลัมน์ ไม่เลื่อนตัวนับ)
      for (const lot of rfMaster.materialLots) if (lot && typeof lot.rbKg !== "number") lot.rbKg = 0;
      for (const requisition of rfMaster.requisitions) if (requisition && requisition.store !== "RB" && requisition.store !== "ST") requisition.store = "ST";
    }
    return rfMaster;
  }
  function rfPersist() {
    try { storage?.setItem?.(RF_KEY, JSON.stringify(rfMaster)); } catch { warnOnce("rf-storage", "[pilot harness] เก็บข้อมูล RubberFlow ลง storage ไม่ได้ ข้อมูลอยู่ในหน่วยความจำของหน้านี้เท่านั้น"); }
  }
  const rfView = (current) => ({ version: current.version, epoch: current.epoch, ...Object.fromEntries(RF_LISTS.map((list) => [list, clone(current[list]).sort(rfSorter(list))])) });
  function rfDelta(current, since) {
    const changes = {};
    for (const list of RF_LISTS) {
      const upsert = current[list].filter((row) => (current.versions[list][RF_ID[list](row)] ?? 0) > since).sort(rfSorter(list));
      changes[list] = { upsert: clone(upsert), delete: [] };
    }
    return { version: current.version, epoch: current.epoch, changes };
  }
  const rfIsRb = (actor) => actor.dept === "RB";
  const rfIsHead = (actor) => (rfIsRb(actor) && ["department_manager", "assistant_department_manager"].includes(actor.role)) || ["assistant_factory_manager", "factory_manager", "general_manager", "admin"].includes(actor.role);
  const rfText = (value, max, code) => { const text = String(value ?? "").trim(); if (!text || text.length > max) fail(code); return text; };
  // สูตรผสมสองขั้น (ตรงกับ rf_save_recipes): แต่ละบรรทัดวัตถุดิบมี stage 1|2 (ไม่ระบุ = 1) และ stages = [{stage 1}, {stage 2}] (mixerTemp °C, dumpTemp °C, mixMin นาที)
  // rfCanonRecipe ทำให้สำเนาที่ client ส่งเทียบกับที่เก็บได้ (เติม stage ของบรรทัด เรียง stages ตามขั้น รหัสสินค้าว่าง = "")
  const rfCanonRecipe = (record) => {
    const out = clone(record);
    if (Array.isArray(out.items)) out.items = out.items.map((item) => (item && typeof item === "object" && !Array.isArray(item) ? { ...item, stage: item.stage ?? 1 } : item));
    if (Array.isArray(out.stages)) out.stages = out.stages.slice().sort((a, b) => Number(a?.stage) - Number(b?.stage));
    if (out.productCode === undefined || out.productCode === null) out.productCode = "";
    else if (typeof out.productCode === "string") out.productCode = out.productCode.trim();
    // สเปกการฉีด (20261129010000): null / {} = ไม่มีสเปก ไม่เก็บช่องนี้ (ตรงกับ private.rf_parse_extrusion_spec ที่คืน null และ rf_records ที่ไม่ส่งช่องว่าง)
    if (out.extrusionSpec === null || (out.extrusionSpec && typeof out.extrusionSpec === "object" && !Array.isArray(out.extrusionSpec) && !Object.keys(out.extrusionSpec).length)) delete out.extrusionSpec;
    return out;
  };
  // รูปของสเปกการฉีด: object ที่มีเฉพาะ thickness / width / weightPerM แต่ละตัว { target > 0, tol >= 0 } ไม่เกิน 1,000,000 ไม่มีช่องอื่น (ผิด = RF_INVALID_RECIPE)
  const RF_EXTRUSION_KEYS = ["thickness", "width", "weightPerM"];
  const rfPlain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const rfExtrusionSpecValid = (spec) => rfPlain(spec) && Object.entries(spec).every(([key, row]) => RF_EXTRUSION_KEYS.includes(key) && rfPlain(row)
    && Object.keys(row).every((name) => name === "target" || name === "tol")
    && typeof row.target === "number" && Number.isFinite(row.target) && row.target > 0 && row.target <= 1e6
    && typeof row.tol === "number" && Number.isFinite(row.tol) && row.tol >= 0 && row.tol <= 1e6);
  const rfStagesValid = (stages) => Array.isArray(stages) && stages.length === 2
    && stages.every((row, index) => row && typeof row === "object" && row.stage === index + 1
      && [row.mixerTemp, row.dumpTemp].every((value) => typeof value === "number" && value >= 0 && value <= 1000)
      && typeof row.mixMin === "number" && row.mixMin > 0 && row.mixMin <= 1440);
  const rfSame = (a, b, owned) => bomCanon(bomWithout(a, owned)) === bomCanon(bomWithout(b, owned));

  // บันทึกการเปลี่ยนแปลงทั้งชุดในธุรกรรมเดียว (ตรงกับ app_rf_save): คืน { next, ops, wrote } โดย ops = งานของ BOM ที่ต้องเขียนต่อเมื่อบันทึกสำเร็จ (ผูกงาน / ป้อนยอดผลิตกลับ / ล้างการผูกตอนยกเลิก)
  // wrote = จำนวนระเบียนที่เขียนจริง (0 = ทุกเรคอร์ดตรงกับที่เก็บ ไม่ต้องเพิ่มเวอร์ชัน)
  // WO ที่ผูกงาน RB ของ BOM: sourceJobId ตรงกับเลขงานในข้อมูล BOM ของโหมดเดียวกัน (bom_jobs ที่ is_test เดียวกัน · mock แยกคีย์ตามโหมดอยู่แล้ว)
  const rfLinkedJob = (order) => (order?.sourceJobId ? bomLoad().jobs.find((job) => job.id === order.sourceJobId) ?? null : null);
  function rfApply(current, changes, base, actor, at, action) {
    const next = clone(current);
    const nextVersion = current.version + 1;
    const mine = new Set();
    const stale = (list, id) => (next.versions[list][id] ?? 0) > base && !mine.has(`${list}|${id}`);
    const stampVersion = (list, id) => { next.versions[list][id] = nextVersion; mine.add(`${list}|${id}`); };
    const planner = bomIsPlanner(actor);
    const master = planner || rfIsRb(actor);
    const head = rfIsHead(actor);
    // คลังเคมี (ตรงกับ private.rf_chem_planner ของ 20261220010000): ฝ่ายวางแผนคลังเคมี = แผนก PP หรือ admin / ผู้ช่วยผู้จัดการโรงงานขึ้นไป (ไม่ใช่ planner ที่รวมผู้จัดการแผนกทุกแผนกในสายผลิต)
    //   ขอเบิก / ยกเลิก / คืน / คืนใบเบิกคลัง RB = chemSide · นับคลัง RB = chemCount (เพิ่มผู้จัดการแผนก RB)
    const chemPlan = actor.role === "admin" || BOM_MANAGER_ROLES.includes(actor.role) || actor.dept === "PP";
    const chemSide = chemPlan || rfIsRb(actor);
    const chemCount = chemPlan || (rfIsRb(actor) && actor.role === "department_manager");
    const approvedNow = [];
    const supersededSent = [];
    // stock = สต็อกของซื้อฝั่ง BOM ที่ใบสั่งซื้อเขียน (สต็อกขั้นต่ำตอนสร้างใบ / บวกยอดตอนรับบรรทัดของซื้อ) · rods = ล็อตตกแต่งที่ผ่าน QC ของ WO ที่ผูกงาน BOM → ล็อตแท่งรอ SR รับ (20261202010000)
    // credit = นับ / ถอนยอดงาน RB ตอน WH รับ / ย้อนรับล็อตที่ส่งมอบให้ลูกค้าของ WO ที่ผูกงาน (20261207010000)
    const ops = { link: [], rods: [], unlink: [], stock: [], credit: [] };
    // ใบสั่งซื้อ: ส่งชุดข้อมูลได้เฉพาะตามคำสั่ง · createPurchaseOrder = purchaseOrders + materials (ใช้แก้ safetyKg เท่านั้น) · receivePurchaseLine = purchaseOrders + materialLots · cancelPurchaseOrder = purchaseOrders · purchaseOrders ส่งได้เฉพาะสามคำสั่งนี้
    const PO_LISTS = { createPurchaseOrder: ["purchaseOrders", "materials"], receivePurchaseLine: ["purchaseOrders", "materialLots"], cancelPurchaseOrder: ["purchaseOrders"], closePurchaseLine: ["purchaseOrders"] };
    for (const list of Object.keys(changes)) {
      const sent = Array.isArray(changes[list]?.upsert) && changes[list].upsert.length > 0;
      if (sent && (PO_LISTS[action] ? !PO_LISTS[action].includes(list) : list === "purchaseOrders")) fail("RF_INVALID_PURCHASE");
      if (sent && RF_BOX_STEPS[action] && list !== "fgBoxes") fail("RF_INVALID_BOX");
      if (sent && ((list === "chemDocs" && !RF_CHEM_ACTIONS.includes(action)) || (RF_CHEM_ACTIONS.includes(action) && !["chemDocs", "materialLots"].includes(list)))) fail("RF_INVALID_CHEM");
    }
    // รูปของ payload และสิทธิ์ระดับส่วน (ก่อนตรวจรายระเบียน)
    for (const list of Object.keys(changes)) {
      if (!RF_LISTS.includes(list)) fail("RF_INVALID_PAYLOAD");
      const entry = changes[list];
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => key !== "upsert")) fail("RF_INVALID_PAYLOAD");
      if (entry.upsert === undefined) continue;
      if (!Array.isArray(entry.upsert)) fail("RF_INVALID_PAYLOAD");
      if (entry.upsert.length > 5000) fail("RF_TOO_MANY");
      // ผู้ที่ไม่ใช่กลุ่มวางแผน/สมาชิก RB: วัตถุดิบและสูตรแก้ไม่ได้เลย · ใบสั่งผลิตมาได้เฉพาะระเบียนที่ต่างจากของเดิมแค่ยอดผลิต (ฐานข้อมูลคำนวณเอง เช่นสำเนาของ QA/ SR ที่แก้ยอดตามผล) ที่เหลือ = ไม่มีสิทธิ์ ตัดสินก่อนตรวจชน
      if (entry.upsert.length && !master) {
        // ใบส่งมอบ WIP ระหว่างสถานีของ RB: ส่งและรับมอบโดยแผนก RB หรือกลุ่มวางแผน (ตรงกับด่านหยาบของ app_rf_save 20261204010000 · เดิมแผนก SR รับมอบ)
        if (list === "transfers") fail("RF_FORBIDDEN");
        // แผนก ST ส่งชุดวัตถุดิบได้เฉพาะพ่วงมากับใบสั่งซื้อ (แก้ได้ช่อง safetyKg ช่องเดียว ตรวจข้างล่าง) ตรงกับประตูของ app_rf_save ใน 20261120010000
        if (list === "recipes" || (list === "materials" && !(actor.dept === "ST" && action === "createPurchaseOrder"))) fail("RF_FORBIDDEN");
        if (list === "orders" && entry.upsert.some((row) => { const old = current.orders.find((order) => order.id === row?.id); return !old || !rfSame(old, row, RF_NOOP.orders); })) fail("RF_FORBIDDEN");
      }
      // เอกสารคลังเคมี (20261220010000): กลุ่มวางแผน / RB / ST ส่งชุดได้ (สิทธิ์รายคำสั่งตรวจในตัวเขียน) · แผนกอื่น = RF_FORBIDDEN
      if (entry.upsert.length && list === "chemDocs" && !(master || actor.dept === "ST")) fail("RF_FORBIDDEN");
      // รับเคมีคืน (ตรงกับ app_rf_save ของ 20261128010000): ชุดใบเบิกส่งได้โดยกลุ่มวางแผน / RB / ST (สิทธิ์จริงตามคลังของใบ ตรวจรายใบ) · ชุดอื่นนอกจากล็อตวัตถุดิบ = RF_INVALID_REQUISITION
      if (entry.upsert.length && action === "returnRequisition") {
        if (list === "requisitions" && !(master || actor.dept === "ST")) fail("RF_FORBIDDEN");
        if (!["requisitions", "materialLots"].includes(list)) fail("RF_INVALID_REQUISITION");
      }
    }
    // ---- ชุดหน้างาน 8 ชุด (ล็อตวัตถุดิบ ใบเบิก ล็อตผลิต ใบส่งมอบ กล่อง ผลตรวจ NCR แม่พิมพ์) ----
    // สิทธิ์รายชุดและรายช่อง (เทียบระเบียนเดิมกับระเบียนใหม่) · ตัวเลขที่ฐานข้อมูลคำนวณเอง (สต็อกล็อตหลังชั่ง คงเหลือ/ยอดส่งต่อของใบส่งมอบ ยอดผลิตของใบสั่งผลิต การใช้แม่พิมพ์ สถานะกล่องตามผล QC)
    // ไม่เชื่อค่าที่ client ส่ง: ระเบียนที่ต่างจากของเดิมเฉพาะช่องเหล่านี้ถือว่าไม่มีอะไรเปลี่ยน (ข้าม) ค่าจริงมากับส่วนต่างที่ตอบกลับ · ตราผู้บันทึก/เวลาประทับใหม่ทับค่าที่ client ส่ง
    // กฎสเปก/FEFO/ความคลาดเคลื่อนการชั่งใช้ไฟล์ของหน้า (modules/rubberflow-rules.js โหลดก่อน) · เรียกตอนใช้จริงเท่านั้น
    const R = new Proxy({}, { get: (_, key) => (globalThis.MNP_RUBBERFLOW_RULES ?? fail("RF_RULES_MISSING"))[key] });
    const stOrAdmin = actor.dept === "ST" || actor.role === "admin"; // สั่งซื้อ รับเข้า ยกเลิกใบสั่งซื้อ และรับล็อตใหม่: แผนก ST หรือ admin เท่านั้น (20261119010000_rf_purchase_by_st.sql)
    const inDept = (dept) => planner || actor.dept === dept; // สมาชิกแผนกนั้น หรือกลุ่มวางแผน (ทำได้ทุกอย่าง)
    const claims = []; // ใบเบิก issued → consumed ต้องมาพร้อมล็อตผสมที่เพิ่มในคำสั่งเดียวกัน
    const mixingNew = [];
    const newLots = []; // ล็อตวัตถุดิบที่เพิ่มในคำสั่งนี้ · receipts = การตรวจสอบรับเข้าของใบสั่งซื้อ (ต้องมาคู่กับล็อตใหม่ที่ตรงกันล็อตเดียว)
    const receipts = [];
    const partReceipts = []; // รับบรรทัดของซื้อ (ไม่มีล็อต)
    const finishingNew = new Set(); // ล็อตตกแต่งที่เพิ่มในคำสั่งนี้ (ฐานข้อมูลสร้างกล่องให้เอง กล่องที่ client ส่งมาเมิน)
    const boxLots = new Map(); // ล็อตที่กล่องเปลี่ยนสถานะในคำสั่งของกล่องนี้ → เหตุผลของการย้อน (ตรวจทั้งล็อต / นับยอดหลังวนรายกล่อง)
    const qcFor = new Set((changes.qcRecords?.upsert ?? []).map((row) => row?.lotId));
    const ncrFor = new Set((changes.ncrs?.upsert ?? []).map((row) => row?.lotId));
    const qcNew = [];
    const touchedOrders = new Set();
    const round3 = (value) => Math.round(value * 1000) / 1000;
    const round6 = (value) => Math.round(value * 1e6) / 1e6;
    // ยอดที่คืนระหว่างทาง (ใบคืน CT ที่รอ ST รับ) ของล็อต ตรงกับ private.rf_lot_in_transit
    const transitKg = (lotNo) => next.chemDocs.filter((doc) => doc.kind === "return" && doc.status === "pending")
      .reduce((sum, doc) => sum + doc.lines.filter((line) => line.lotNo === lotNo).reduce((kg, line) => kg + line.kg, 0), 0);
    const shop = (list, prev, record, index) => {
      const bad = RF_BAD[list];
      const rows = next[list];
      const put = (row) => { if (prev) rows[index] = row; else rows.push(row); };
      const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : fail(bad));
      const blank = (value) => String(value ?? "").trim() === "";
      if (list === "materialLots") {
        if (!["available", "hold"].includes(record.status)) fail(bad);
        if (!prev) {
          if (!stOrAdmin) fail("RF_FORBIDDEN");
          const material = next.materials.find((row) => row.code === record.materialCode);
          if (!material || material.active === false) fail(bad);
          if (!(num(record.qtyKg) > 0) || record.initialKg !== record.qtyKg || num(record.expiry) <= at) fail(bad);
          if (record.status !== "available") fail("RF_INVALID_TRANSITION");
          put({ ...clone(record), rbKg: 0, receivedAt: at, receivedBy: actor.name });
          newLots.push(record.lotNo);
          return null;
        }
        if (!(inDept("ST") || actor.dept === "QA")) fail("RF_FORBIDDEN");
        if (!rfSame(prev, record, ["status", ...RF_NOOP.materialLots])) fail(bad);
        // ปล่อยล็อตที่กัก (hold -> available) = หัวหน้า QA หรือหัวหน้า ST (20261221010000) · กักยังเป็นของกลุ่มวางแผน / ST / QA
        if (prev.status === "hold" && record.status === "available" && !materialReleaseOk(actor)) fail("RF_MATERIAL_RELEASE_HEAD_ONLY");
        put({ ...prev, status: record.status });
        return null;
      }
      if (list === "requisitions" && action === "returnRequisition") {
        // รับเคมีคืนเข้าล็อตเดิม (ตรงกับ private.rf_return_requisitions ของ 20261128010000): ลำดับตรวจ ไม่พบใบ → ไม่มีบรรทัดที่ returnedKg ต่างจากที่เก็บ = ข้าม →
        // สิทธิ์ ST / admin → ใบ issued / weighing ของ WO ที่ยกเลิกแล้วและยังไม่เคยรับคืน (RF_INVALID_TRANSITION) → ยอดต่อบรรทัด 0..ที่จ่าย (ไม่บังคับทศนิยม) · คืนไม่ครบต้องมีเหตุผล 3-300 → ไม่เกินยอดรับเข้าของล็อต
        if (!prev) fail(bad);
        const lines = Array.isArray(record.lines) ? record.lines : [];
        const kgOf = (value) => (value === undefined || value === null ? null : value);
        if (!prev.lines.some((old, i) => bomCanon(kgOf(lines[i]?.returnedKg)) !== bomCanon(kgOf(old.returnedKg)))) return "skip";
        // ใบของคลัง RB (20261220010000): ฝ่ายวางแผนคลังเคมี / RB คืนเข้า rbKg · ใบเดิมของคลัง ST: ST / admin เข้า qtyKg
        const backStore = prev.store === "RB" ? "RB" : "ST";
        if (backStore === "RB" ? !chemSide : !stOrAdmin) fail("RF_FORBIDDEN");
        const wo = next.orders.find((row) => row.id === prev.orderId);
        if (!["issued", "weighing"].includes(prev.status) || wo?.status !== "cancelled" || prev.lines.some((old) => Object.hasOwn(old, "returnedAt"))) fail("RF_INVALID_TRANSITION");
        if (lines.length !== prev.lines.length) fail(bad);
        const rawNote = record.returnNote;
        const note = rawNote === undefined || rawNote === null ? "" : typeof rawNote === "string" ? rawNote.trim() : fail(bad);
        if (note.length > 300) fail(bad);
        let short = false;
        const kgs = prev.lines.map((old, i) => {
          const line = lines[i];
          if (!line || typeof line !== "object" || Array.isArray(line)) fail(bad);
          const issued = typeof old.actualKg === "number" ? old.actualKg : 0;
          let kg = kgOf(line.returnedKg);
          if (kg === null) { if (issued > 0) fail(bad); kg = 0; }
          if (typeof kg !== "number" || !Number.isFinite(kg) || kg < 0 || kg > 1e9 || kg > issued + 1e-9) fail(bad);
          if (kg < issued - 1e-9) short = true;
          return kg;
        });
        if (short && note.length < 3) fail(bad);
        prev.lines.forEach((old, i) => {
          if (!(kgs[i] > 0)) return;
          const lotIndex = next.materialLots.findIndex((row) => row.lotNo === old.lotNo);
          const lot = next.materialLots[lotIndex] ?? fail(bad);
          // เพดาน: คลัง ST + คลัง RB + ที่คืนระหว่างทาง + ที่คืนครั้งนี้ ไม่เกินยอดรับเข้า
          if (lot.qtyKg + (lot.rbKg ?? 0) + transitKg(lot.lotNo) + kgs[i] > lot.initialKg + 1e-6) fail(bad);
          next.materialLots[lotIndex] = backStore === "RB" ? { ...lot, rbKg: round6((lot.rbKg ?? 0) + kgs[i]) } : { ...lot, qtyKg: round6(lot.qtyKg + kgs[i]) };
          stampVersion("materialLots", lot.lotNo);
        });
        put({ ...prev, lines: prev.lines.map((old, i) => ({ ...old, returnedKg: kgs[i], returnedAt: at, returnedBy: actor.name, returnNote: note })) });
        return null;
      }
      if (list === "requisitions") {
        if (!master) fail("RF_FORBIDDEN");
        if (!prev) {
          // ใบใหม่จ่ายทันที (สถานะที่ client ส่งมาเมิน): ตรงกับ rf_save_requisitions
          const order = next.orders.find((row) => row.id === record.orderId);
          if (!order || !["released", "in_progress"].includes(order.status)) fail(bad);
          if (!Number.isInteger(record.batches) || record.batches < 1 || record.batches > 10) fail(bad);
          const recipe = next.recipes.find((row) => row.id === order.recipeId && row.revision === order.recipeRevision);
          if (!recipe) fail(bad);
          // จำนวน batch ต้องเท่ากับที่ WO ยังไม่ได้เบิก (ไม่เกิน 10 ต่อใบ): เบิกครบแล้ว (0) หรือไม่ตรง = RF_INVALID_REQUISITION · ถ้าใบเบิกของ WO นี้เปลี่ยนหลัง base = client ถือสำเนาเก่า ได้ RF_STALE แทน (ตรงกับ SQL)
          if (record.batches !== R.nextRequisitionBatches(order, recipe, next.requisitions)) {
            if (next.requisitions.some((row) => row.orderId === order.id && stale("requisitions", row.id))) fail("RF_STALE");
            fail(bad);
          }
          // FEFO ในธุรกรรมเดียวกับการสร้างใบ: หักที่ใบเบิกเก่า (ยัง weighing) จองไว้ในรายการที่ยังไม่ชั่ง · ฐานข้อมูลจัดสรรเอง ไม่เชื่อรายการล็อตที่ client ส่ง · แล้วจ่ายทันที: actualKg = targetKg หักสต็อกล็อตตามบรรทัด
          // คลังเคมีของ RB (20261220010000): จัดสรรและตัดยอดคลัง RB (rbKg) · ใบ weighing เดิมเป็นของคลัง ST จึงไม่จองยอดคลัง RB
          const reserved = {};
          for (const open of next.requisitions) for (const line of open.status === "weighing" && open.store === "RB" ? open.lines : []) if (line.actualKg === null) reserved[line.lotNo] = (reserved[line.lotNo] || 0) + line.targetKg;
          const lines = [];
          for (const item of R.recipeLines(recipe)) {
            const { picks, shortage } = R.allocateFefo(next.materialLots, item.materialCode, item.kgPerBatch * record.batches, at, reserved, "RB");
            if (shortage > 0.0001) fail("RF_INSUFFICIENT_STOCK");
            for (const pick of picks) {
              reserved[pick.lotNo] = (reserved[pick.lotNo] || 0) + pick.kg;
              lines.push({ materialCode: item.materialCode, stage: item.stage, lotNo: pick.lotNo, targetKg: pick.kg, actualKg: pick.kg, weighedAt: at, weighedBy: actor.name });
            }
          }
          for (const line of lines) {
            const lotIndex = next.materialLots.findIndex((row) => row.lotNo === line.lotNo);
            // ตรงกับ SQL: หักแล้วติดลบ = หยุด ไม่ปัดเป็น 0 เงียบ ๆ
            const after = Math.round(((next.materialLots[lotIndex].rbKg ?? 0) - line.targetKg) * 1e6) / 1e6;
            if (after < 0) fail("RF_INSUFFICIENT_STOCK");
            next.materialLots[lotIndex] = { ...next.materialLots[lotIndex], rbKg: after };
            stampVersion("materialLots", line.lotNo);
          }
          put({ ...clone(record), recipeId: recipe.id, recipeRevision: recipe.revision, totalKg: recipe.batchKg * record.batches, lines, status: "issued", requestedBy: actor.name, createdAt: at, issuedAt: at, issuedBy: actor.name, store: "RB" });
          return null;
        }
        if (prev.status === "consumed") fail("RF_INVALID_TRANSITION");
        for (const key of ["orderId", "recipeId", "recipeRevision", "batches", "totalKg"]) if (record[key] !== prev[key]) fail(bad);
        if (!Array.isArray(record.lines) || record.lines.length !== prev.lines.length) fail(bad);
        const lines = prev.lines.map((line) => ({ ...line }));
        let weighed = 0;
        record.lines.forEach((line, i) => {
          const old = prev.lines[i];
          if (line.materialCode !== old.materialCode || line.lotNo !== old.lotNo || line.targetKg !== old.targetKg || (line.stage ?? 1) !== (old.stage ?? 1)) fail(bad);
          if (old.actualKg !== null) { if (line.actualKg !== old.actualKg) fail("RF_INVALID_TRANSITION"); return; }
          if (line.actualKg === null || line.actualKg === undefined) return;
          if (prev.status !== "weighing") fail("RF_INVALID_TRANSITION");
          const kg = num(line.actualKg);
          if (!(kg > 0)) fail(bad);
          // จ่ายทั้งใบ (issueRequisition) = ต้องเท่าเป้าหมายพอดี · ชั่งทีละบรรทัด (ใบเก่า) นอกเกณฑ์ไม่รับ · ล็อตต้องใช้ได้และพอ · สต็อกหักทันทีที่จ่ายรายการนั้น
          if (action === "issueRequisition") { if (Math.abs(kg - old.targetKg) > 1e-9) fail(bad); }
          else if (Math.abs(kg - old.targetKg) > R.weighTolerance(old.targetKg) + 1e-9) fail("RF_OUT_OF_TOLERANCE");
          const lotIndex = next.materialLots.findIndex((row) => row.lotNo === old.lotNo);
          const lot = next.materialLots[lotIndex];
          // คลังของใบ (20261220010000): ใบเดิม = คลัง ST (qtyKg) · ใบคลัง RB = rbKg
          const store = prev.store === "RB" ? "RB" : "ST";
          if (!lot || R.lotState(lot, at, store) !== "available" || R.lotKg(lot, store) + 1e-9 < kg) fail("RF_LOT_UNAVAILABLE");
          next.materialLots[lotIndex] = { ...lot, [store === "RB" ? "rbKg" : "qtyKg"]: Math.round((R.lotKg(lot, store) - kg) * 1e6) / 1e6 };
          stampVersion("materialLots", lot.lotNo);
          lines[i] = { ...old, actualKg: kg, weighedAt: at, weighedBy: actor.name };
          weighed += 1;
        });
        const out = { ...prev, lines };
        if (record.status === "consumed") {
          if (prev.status !== "issued" || weighed) fail("RF_INVALID_TRANSITION");
          out.status = "consumed";
          out.consumedBy = String(record.consumedBy ?? "");
          claims.push({ req: prev.id, lot: out.consumedBy });
        } else {
          const expected = lines.every((line) => line.actualKg !== null) ? "issued" : "weighing";
          if (action === "issueRequisition" && expected !== "issued") fail(bad);
          if (record.status !== expected) fail("RF_INVALID_TRANSITION");
          if (prev.status === "weighing" && expected === "issued") { out.issuedAt = at; out.issuedBy = actor.name; }
          out.status = expected;
        }
        put(out);
        return null;
      }
      if (list === "lots") {
        if (!R.STAGES.includes(record.stage)) fail(bad);
        const prefix = { mixing: "MX", extrusion: "EX", curing: "CU", finishing: "FN" }[record.stage];
        if (!record.id.startsWith(`${prefix}-`)) fail(bad);
        if (prev) {
          if (prev.stage !== record.stage) fail(bad);
          // params.skipRest เป็นของเซิร์ฟเวอร์ (client ส่งได้แค่เหตุผลตอน endRest) จึงไม่นับเป็นการแก้เนื้อหา
          const withoutSkip = (row) => ({ ...row, params: bomWithout(row.params, ["skipRest"]) });
          if (!rfSame(withoutSkip(prev), withoutSkip(record), [...RF_NOOP.lots, "qc", "holdReasons", "readyAt"])) fail(bad);
          const out = { ...prev };
          let wrote = false;
          // ข้ามเวลาบ่ม (ตรงกับ rf_save_lots ของ 20261128010000): เฉพาะ action endRest · หัวหน้า RB หรือแผนก QA เท่านั้น (อื่น = RF_FORBIDDEN)
          // เหตุผล params.skipRest.reason 3-300 (ผิด = RF_INVALID_LOT) · ฐานข้อมูลตั้งเวลาครบบ่มเป็นเวลาของเซิร์ฟเวอร์และเก็บ { by, reason, at } ไว้ที่ล็อต · ล็อตที่บ่มครบแล้วไม่เขียนอะไร
          if (action === "endRest" && prev.readyAt !== null && prev.readyAt !== undefined && typeof record.readyAt === "number" && record.readyAt !== prev.readyAt) {
            if (!(rfIsHead(actor) || actor.dept === "QA")) fail("RF_FORBIDDEN");
            const skip = record.params?.skipRest;
            const raw = skip && typeof skip === "object" && !Array.isArray(skip) ? skip.reason : undefined;
            const reason = raw === undefined || raw === null ? "" : typeof raw === "string" ? raw.trim() : fail(bad);
            if (reason.length < 3 || reason.length > 300) fail(bad);
            if (prev.readyAt > at) {
              out.readyAt = at;
              out.params = { ...(prev.params ?? {}), skipRest: { by: actor.name, reason, at } };
              wrote = true;
            }
          }
          const reasonsChanged = bomCanon(record.holdReasons ?? []) !== bomCanon(prev.holdReasons ?? []);
          if (record.qc !== prev.qc || reasonsChanged) {
            if (!inDept("QA")) fail("RF_FORBIDDEN");
            // ผลตัดสิน: ยังไม่มี → pass|hold|fail · hold → pass|fail · pass → hold (เปิด NCR) · ต้องมีผลตรวจหรือ NCR ของล็อตนี้มาในคำสั่งเดียวกัน
            const allowed = { null: ["pass", "hold", "fail"], hold: ["pass", "fail"], pass: ["hold"], fail: [] };
            if (record.qc === prev.qc || !(allowed[String(prev.qc)] ?? []).includes(record.qc)) fail("RF_INVALID_TRANSITION");
            if (!(qcFor.has(prev.id) || ncrFor.has(prev.id))) fail("RF_INVALID_TRANSITION");
            out.qc = record.qc;
            out.holdReasons = record.qc === "pass" ? [] : (Array.isArray(record.holdReasons) ? record.holdReasons.map((reason) => String(reason).slice(0, 200)).slice(0, 20) : []);
            // ล็อตตกแต่งที่ QA ปล่อยเป็นผ่านครั้งแรก (countedToOrder false → true ครั้งเดียว): นับเข้า WO · WO ที่ผูกงาน BOM สร้างล็อตแท่งรอ SR รับ
            if (prev.stage === "finishing" && record.qc === "pass" && !prev.countedToOrder) {
              out.countedToOrder = true;
              touchedOrders.add(prev.orderId);
              const linkedNow = Boolean(rfLinkedJob(next.orders.find((row) => row.id === prev.orderId)));
              // ปลายทางที่ยังว่าง (ล็อตที่กักไว้ · 20261207010000): WO ที่ผูกงานไปคลังยางเส้นยาว SR · ที่ไม่ผูกงานส่งมอบให้ลูกค้าผ่าน WH
              if (!out.destination) out.destination = linkedNow ? "sr" : "customer";
              if (linkedNow && out.destination === "sr") ops.rods.push({ woId: prev.orderId, lotId: prev.id, qty: prev.goodQty });
            }
            wrote = true;
          }
          // เวลาครบบ่มที่ต่างไปภายใต้ action อื่น หรือล็อตที่บ่มครบแล้ว: ฐานข้อมูลเมิน ไม่เขียนอะไร
          if (!wrote) return "skip";
          put(out);
          return null;
        }
        if (!master) fail("RF_FORBIDDEN");
        const order = next.orders.find((row) => row.id === record.orderId);
        if (!order) fail(bad);
        const good = num(record.goodQty);
        const scrap = num(record.scrapQty ?? 0);
        if (good < 0 || scrap < 0 || !Array.isArray(record.sources) || record.sources.length !== 1 || !record.params || typeof record.params !== "object") fail(bad);
        const source = record.sources[0];
        const out = { ...clone(record), operator: actor.name, createdAt: at, transferredQty: 0, countedToOrder: false };
        // ปลายทาง / ยอดที่นับเข้างาน RB เป็นของเซิร์ฟเวอร์ (ล็อตตกแต่งตั้งข้างล่าง · สถานีอื่นไม่มีสองช่องนี้)
        delete out.destination;
        delete out.whCredit;
        const reasons = [];
        if (record.stage === "mixing") {
          if (source?.type !== "requisition") fail(bad);
          const requisition = current.requisitions.find((row) => row.id === source.id);
          if (!requisition || requisition.status !== "issued" || requisition.orderId !== record.orderId) fail("RF_INVALID_TRANSITION");
          const recipe = next.recipes.find((row) => row.id === requisition.recipeId && row.revision === requisition.recipeRevision);
          if (!recipe) fail(bad);
          const stages = record.params.stages;
          if (!Array.isArray(stages) || stages.length !== R.MIX_STAGES.length) fail(bad);
          stages.forEach((row, i) => { if (row?.stage !== R.MIX_STAGES[i] || ![row.mixerTemp, row.dumpTemp, row.mixMin].every((value) => typeof value === "number" && Number.isFinite(value)) || !(row.mixMin > 0)) fail(bad); });
          const issued = requisition.lines.reduce((sum, line) => sum + (line.actualKg ?? 0), 0);
          if (good + scrap > issued + 0.5) fail(bad);
          // Dump temp แต่ละขั้นเทียบกับค่าของสูตรในขั้นนั้น (ค่าเผื่อ dumpTol) · ขั้นไหนหลุด = QC Hold · สูตรที่ไม่มีค่ามาตรฐานของขั้นนั้นไม่รับ
          for (const row of stages) {
            const standard = (recipe.stages ?? []).find((item) => item.stage === row.stage);
            if (!standard) fail(bad);
            if (Math.abs(row.dumpTemp - standard.dumpTemp) > recipe.dumpTol) reasons.push(`Dump temp ขั้น ${row.stage} ${row.dumpTemp}°C นอกช่วง ${standard.dumpTemp}±${recipe.dumpTol}`);
          }
          out.params = { stages: clone(stages), batches: requisition.batches };
          out.recipeId = recipe.id;
          out.readyAt = at + (Number(recipe.restHours) || 4) * R.HOUR;
          mixingNew.push({ lot: record.id, req: requisition.id });
        } else {
          if (source?.type !== "transfer") fail(bad);
          const ti = next.transfers.findIndex((row) => row.id === source.id);
          const transfer = next.transfers[ti];
          if (!transfer || transfer.to !== record.stage || transfer.status !== "received" || transfer.orderId !== record.orderId) fail("RF_INVALID_TRANSITION");
          const use = num(source.qty);
          if (!(use > 0) || use > transfer.remaining + 1e-9) fail(bad);
          next.transfers[ti] = { ...transfer, remaining: round3(transfer.remaining - use) };
          stampVersion("transfers", transfer.id);
          out.uom = order.uom;
          if (record.stage === "extrusion") {
            const params = record.params;
            const rework = num(params.reworkKg ?? 0);
            const useKg = num(params.useKg);
            const pct = (rework / (useKg + rework)) * 100;
            if (rework < 0 || pct > R.SPECS.extrusion.reworkMaxPct) fail(bad);
            const keys = ["thickness", "width", "weightPerM"];
            keys.forEach((key) => num(params[key]));
            // สเปกมิติของสูตร (revision ที่ WO ผูก) กักเฉพาะค่าที่สูตรกำหนด · สูตรไม่มีสเปก = ไม่กักตามมิติ (ตรงกับ rf_save_lots ของ 20261129010000)
            const spec = next.recipes.find((row) => row.id === order.recipeId && row.revision === order.recipeRevision)?.extrusionSpec ?? {};
            for (const key of keys) if (spec[key] && !R.inSpec(params[key], { target: spec[key].target, tol: spec[key].tol })) reasons.push(`${R.SPECS.extrusion[key].label} ${params[key]} ${R.SPECS.extrusion[key].unit} นอกสเปก`);
            out.params = { ...clone(params), reworkKg: rework, reworkPct: +pct.toFixed(2), useKg };
            const mi = next.molds.findIndex((row) => row.id === record.dieId);
            if (mi === -1) fail(bad);
            next.molds[mi] = { ...next.molds[mi], usageSinceClean: round3(next.molds[mi].usageSinceClean + good), totalUsage: round3(next.molds[mi].totalUsage + good) };
            stampVersion("molds", next.molds[mi].id);
          } else if (record.stage === "curing") {
            const params = record.params;
            const keys = ["temp", "time", "pressure"];
            keys.forEach((key) => num(params[key]));
            if (good + scrap > use + 1e-9) fail(bad);
            for (const key of keys) if (!R.inSpec(params[key], R.SPECS.curing[key])) reasons.push(`${R.SPECS.curing[key].label} ${params[key]} ${R.SPECS.curing[key].unit} นอกสเปก`);
            const mi = next.molds.findIndex((row) => row.id === record.moldId);
            if (mi === -1) fail(bad);
            const shots = Math.ceil((good + scrap) / (next.molds[mi].perCycle || 1));
            next.molds[mi] = { ...next.molds[mi], usageSinceClean: round3(next.molds[mi].usageSinceClean + shots), totalUsage: round3(next.molds[mi].totalUsage + shots) };
            stampVersion("molds", next.molds[mi].id);
          } else {
            // WO ที่ผูกงาน RB ของ BOM (sourceJobId ตรงกับงานของ BOM โหมดเดียวกัน · 20261202010000): ไม่มีกล่อง แท่งไปคลังแท่งยาว (SR) เป็นล็อตแท่งรอรับเมื่อผ่าน QC (rfApplyBomOps)
            const linked = rfLinkedJob(order);
            if (!["pass", "hold", "fail"].includes(record.qc)) fail(bad);
            // ปลายทาง (ตรงกับ rf_save_lots ของ 20261207010000): ผ่าน + ไม่ส่ง = WO ที่ผูกงานไป sr · ที่ไม่ผูกงานไป customer · sr ของ WO ที่ไม่ผูกงาน / ปลายทางของผลกัก = ผิด
            const rawDestination = record.destination === undefined || record.destination === null ? "" : typeof record.destination === "string" ? record.destination.trim() : fail(bad);
            let destination = rawDestination || null;
            if (record.qc === "pass") {
              destination = destination ?? (linked ? "sr" : "customer");
              if (!["sr", "customer"].includes(destination) || (destination === "sr" && !linked)) fail(bad);
            } else if (destination) fail(bad);
            // กล่องเกิดเมื่อของไปหาลูกค้า (WO ที่ไม่ผูกงานทุกผล หรือ WO ที่ผูกงานที่เลือก customer) · จำนวนต่อกล่อง: ไม่ส่ง = ได้เฉพาะล็อตที่ไม่มีกล่อง · ส่งมาต้องเป็นตัวเลข 0 < ค่า <= 1e9
            const boxed = !linked || destination === "customer";
            const rawPerBox = record.params.perBox;
            const perBox = rawPerBox === undefined || rawPerBox === null ? null : num(rawPerBox);
            if ((perBox === null ? boxed : !(perBox > 0) || perBox > 1e9) || good + scrap > use + 1e-9) fail(bad);
            out.params = perBox === null ? {} : { perBox };
            out.destination = destination;
            out.whCredit = null;
            if (record.qc !== "pass") reasons.push(...(Array.isArray(record.holdReasons) && record.holdReasons.length ? record.holdReasons.map((reason) => String(reason).slice(0, 200)).slice(0, 20) : ["ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน"]));
            out.qc = record.qc;
            out.countedToOrder = record.qc === "pass";
            // กล่อง: ฐานข้อมูลสร้างเองจากล็อต (ใบละไม่เกิน perBox ชิ้น กล่องสุดท้ายเศษ) id = เลขล็อต (FN → BOX) ต่อด้วยลำดับ 3 หลัก
            const count = good > 0 && boxed ? Math.ceil(good / perBox - 1e-9) : 0;
            if (count > 1000) fail(bad);
            out.grade = String(record.grade ?? "").trim().slice(0, 20) || "A";
            out.boxes = count;
            finishingNew.add(record.id);
            for (let n = 1; n <= count; n += 1) {
              const box = {
                id: `${record.id.replace("FN", "BOX")}-${String(n).padStart(3, "0")}`, lotId: record.id, orderId: order.id, recipeId: order.recipeId, productCode: order.productCode ?? "",
                qty: round3(Math.min(perBox, good - (n - 1) * perBox)), uom: order.uom, grade: out.grade, status: record.qc === "pass" ? "pending_wh" : "hold", createdAt: at,
                customer: order.customer ?? "", customerPo: order.customerPo ?? "", moves: [],
              };
              next.fgBoxes.push(box);
              stampVersion("fgBoxes", box.id);
            }
            // ชิ้นผ่านสถานีสุดท้าย: นับเข้า WO (rf_add_produced เหมือนเดิม) · WO ที่ผูกงาน BOM สร้างล็อตแท่งรอ SR รับ (ไม่ป้อนยอดเข้างาน BOM แล้ว: rf_apply_feedback ไม่ถูกเรียก)
            if (out.countedToOrder) { touchedOrders.add(order.id); if (linked && destination === "sr") ops.rods.push({ woId: order.id, lotId: record.id, qty: good }); }
          }
        }
        // บันทึกล็อตของสถานีไหนก็ได้เฉพาะใบ WO ที่ released / in_progress / on_hold
        // (ข้อยกเว้นเดียว: ล็อตตกแต่งที่ client ปิดใบเป็น completed ในคำสั่งเดียวกัน)
        if (!["released", "in_progress", "on_hold"].includes(order.status) && !(record.stage === "finishing" && order.status === "completed" && mine.has(`orders|${order.id}`))) fail("RF_INVALID_TRANSITION");
        if (record.stage !== "finishing") out.qc = reasons.length ? "hold" : "pass";
        out.holdReasons = reasons;
        put(out);
        // ผสมครั้งแรกของใบที่ปล่อยผลิตแล้ว = เริ่มผลิต (ใบ released → in_progress)
        if (record.stage === "mixing" && order.status === "released") {
          const oi = next.orders.findIndex((row) => row.id === order.id);
          next.orders[oi] = { ...next.orders[oi], status: "in_progress" };
          stampVersion("orders", order.id);
        }
        return null;
      }
      if (list === "transfers") {
        if (!prev) {
          if (!master) fail("RF_FORBIDDEN");
          const lot = next.lots.find((row) => row.id === record.lotId);
          if (!lot || !R.NEXT_STAGE[lot.stage] || lot.qc !== "pass") fail(bad);
          if (record.from !== lot.stage || record.to !== R.NEXT_STAGE[lot.stage] || record.orderId !== lot.orderId) fail(bad);
          if (lot.stage === "mixing" && lot.readyAt > at) fail(bad);
          const sent = next.transfers.filter((row) => row.lotId === lot.id).reduce((sum, row) => sum + row.qtySent, 0);
          const qty = num(record.qtySent);
          if (!(qty > 0) || qty > lot.goodQty - sent + 1e-9) fail(bad);
          if (record.status !== "in_transit") fail("RF_INVALID_TRANSITION");
          put({ ...clone(record), uom: lot.uom, qtyReceived: null, remaining: 0, status: "in_transit", createdAt: at, createdBy: actor.name });
          return null;
        }
        // รับมอบ: แผนก RB หรือกลุ่มวางแผน (20261204010000 · เดิมแผนก SR)
        if (!master) fail("RF_FORBIDDEN");
        if (prev.status !== "in_transit" || record.status !== "received") fail("RF_INVALID_TRANSITION");
        if (!rfSame(prev, record, ["status", "qtyReceived", "condition", ...RF_NOOP.transfers])) fail(bad);
        const received = num(record.qtyReceived);
        if (received < 0 || received > prev.qtySent * 1.02) fail(bad);
        put({ ...prev, status: "received", qtyReceived: received, remaining: received, condition: record.condition || "ok", receivedAt: at, receivedBy: actor.name });
        // รับมอบใบส่งมอบไม่เขียนงาน BOM (ป้อนกลับเฉพาะตอนล็อตตกแต่งที่ QC ผ่านนับเข้า WO)
        return null;
      }
      if (list === "fgBoxes") {
        if (!prev) {
          if (!master) fail("RF_FORBIDDEN");
          // กล่องเกิดจากล็อตตกแต่งที่เพิ่งบันทึกในคำสั่งเดียวกันเท่านั้น (ฐานข้อมูลสร้างให้แล้ว) ไม่ใช่จาก client
          if (finishingNew.has(record.lotId)) return "skip";
          fail(bad);
        }
        // ทางเดียวของคำสั่ง (ตรงกับ rf_save_boxes ของ 20261207010000): สถานะอื่นที่ส่งมา (สำเนาผล QA ที่ client เปลี่ยนเอง) เมิน · ถึงปลายทางแล้ว = ส่งซ้ำ ไม่เขียน
        if (!["pending_wh", "in_stock", "hold", "shipped"].includes(record.status)) fail(bad);
        const step = RF_BOX_STEPS[action];
        if (!step || record.status !== step[1] || prev.status === step[1]) return "skip";
        // สิทธิ์: รับเข้า / ส่งมอบ = แผนก WH ทุกบทบาท หรือ admin · ย้อน = ผู้จัดการแผนก WH หรือ admin (กลุ่มวางแผนดูอย่างเดียว)
        const reversal = step[2] === "unreceive" || step[2] === "unship";
        const may = actor.role === "admin" || (actor.dept === "WH" && (!reversal || actor.role === "department_manager"));
        if (!may) fail("RF_FORBIDDEN");
        if (prev.status !== step[0]) fail("RF_INVALID_TRANSITION");
        // เหตุผลของการย้อน: รายการท้ายของ moves ที่ส่งมา (ชนิดตรงกับคำสั่ง) 3-300 ตัวอักษร
        let note = "";
        if (reversal) {
          const last = Array.isArray(record.moves) ? record.moves[record.moves.length - 1] : null;
          if (!last || typeof last !== "object" || last.kind !== step[2]) fail(bad);
          note = last.note === undefined || last.note === null ? "" : typeof last.note === "string" ? last.note.trim() : fail(bad);
          if (note.length < 3 || note.length > 300) fail(bad);
        }
        const out = { ...prev, status: step[1], moves: [...(prev.moves ?? []), { kind: step[2], at, by: actor.name, note }] };
        if (step[2] === "receive") { out.receivedAt = at; out.receivedBy = actor.name; }
        if (step[2] === "unreceive") { delete out.receivedAt; delete out.receivedBy; }
        if (step[2] === "ship") { out.shippedAt = at; out.shippedBy = actor.name; }
        if (step[2] === "unship") { delete out.shippedAt; delete out.shippedBy; }
        put(out);
        boxLots.set(prev.lotId, note);
        return null;
      }
      if (list === "qcRecords") {
        if (prev) fail("RF_INVALID_TRANSITION"); // ผลตรวจบันทึกแล้วแก้ไม่ได้
        if (!inDept("QA")) fail("RF_FORBIDDEN");
        const lot = next.lots.find((row) => row.id === record.lotId);
        if (!lot || !["pass", "hold", "fail"].includes(record.result) || !Array.isArray(record.tests) || !record.tests.length) fail(bad);
        const keys = new Set();
        const tests = record.tests.map((test) => {
          const spec = R.SPECS.lab[test?.key];
          if (!spec || keys.has(test.key)) fail(bad);
          keys.add(test.key);
          return { key: test.key, value: num(test.value), pass: R.inSpec(test.value, spec) };
        });
        if (record.result === "pass" && !tests.every((test) => test.pass)) fail(bad);
        // ผล pass / fail บนล็อตที่กักอยู่ก่อนคำสั่งนี้ = หัวหน้า QA เท่านั้น (rf_save_qc ของ 20261221010000) · ล็อตเปลี่ยนหลัง base = RF_STALE ก่อน
        //   hold ซ้ำบนล็อตที่กัก และผลใดก็ได้บนล็อตที่ไม่ได้กัก = QA ทุกบทบาท / กลุ่มวางแผนเหมือนเดิม
        const before = current.lots.find((row) => row.id === lot.id);
        if (before?.qc === "hold" && ["pass", "fail"].includes(record.result) && !qaHead(actor)) fail(stale("lots", lot.id) ? "RF_STALE" : "RF_QA_HEAD_ONLY");
        qcNew.push({ id: record.id, lotId: lot.id, result: record.result });
        put({ ...clone(record), orderId: lot.orderId, stage: lot.stage, tests, inspector: actor.name, at });
        return null;
      }
      if (list === "ncrs") {
        if (!prev) {
          if (!inDept("QA")) fail("RF_FORBIDDEN");
          if (record.status !== "open") fail("RF_INVALID_TRANSITION");
          if (blank(record.title) || String(record.title).length > 200 || !next.lots.some((row) => row.id === record.lotId) || !Array.isArray(record.whys)) fail(bad);
          put({ ...clone(record), createdAt: at, createdBy: actor.name });
          return null;
        }
        if (prev.status === "closed") fail("RF_INVALID_TRANSITION");
        const filled = ["corrective", "preventive"].some((key) => String(record[key] ?? "") !== String(prev[key] ?? ""));
        if (filled && !(inDept("QA") || actor.dept === "RB")) fail("RF_FORBIDDEN");
        if (!rfSame(prev, record, ["status", "corrective", "preventive", "verification", ...RF_NOOP.ncrs])) fail(bad);
        const out = { ...prev, corrective: record.corrective ?? prev.corrective, preventive: record.preventive ?? prev.preventive };
        if (record.status === "closed") {
          if (!inDept("QA")) fail("RF_FORBIDDEN");
          if (blank(out.corrective) || blank(out.preventive)) fail(bad);
          Object.assign(out, { status: "closed", closedAt: at, closedBy: actor.name, verification: String(record.verification ?? "") });
        } else if (record.status !== "open" || String(record.verification ?? "") !== String(prev.verification ?? "")) fail(bad);
        put(out);
        return null;
      }
      // ใบสั่งซื้อ: สร้างใหม่ = กลุ่มวางแผนหรือสมาชิก RB (ordered ไม่มีข้อมูลการรับ) · หลังสร้างเปลี่ยนได้สองอย่างเท่านั้น: ตรวจสอบรับเข้า (ST หรือกลุ่มวางแผน: บรรทัดเดียวจากยังไม่รับเป็นรับแล้ว มากับล็อตวัตถุดิบใหม่ที่ตรงกันในคำสั่งเดียวกัน)
      // และยกเลิก (กลุ่มวางแผน: ใบ ordered ที่ไม่มีบรรทัดรับเข้า) · ที่เหลือ = RF_INVALID_TRANSITION · ใบที่ทุกบรรทัดรับครบเป็น received (ฐานข้อมูลตั้งเอง)
      if (list === "purchaseOrders") {
        const money = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e9;
        const received = (line) => line.receivedKg !== null && line.receivedKg !== undefined;
        // รับสะสม / บรรทัดครบ (ตรงกับ private.rf_po_line_received / rf_po_line_done ของ 20261128020000)
        const round9 = (value) => Math.round(value * 1e9) / 1e9;
        const poReceived = (line) => (Array.isArray(line.receipts) && line.receipts.length ? round9(line.receipts.reduce((total, receipt) => total + (Number(receipt?.kg) || 0), 0)) : Number(line.receivedKg) || 0);
        const poClosed = (line) => Boolean(line.closedRemainder && typeof line.closedRemainder === "object") || (received(line) && !Array.isArray(line.receipts));
        const poDone = (line) => poClosed(line) || poReceived(line) >= line.qtyKg;
        const plain = (line) => ({ ...bomWithout(line, ["receivedKg", "lotNo", "expiry", "receivedAt", "receivedBy", "uom", "receipts", "closedRemainder"]), source: line.source ?? "rf" });
        const optText = (value, max) => value === undefined || value === null || (typeof value === "string" && value.length <= max);
        // บรรทัดของซื้อ (source bom): lotNo / expiry เป็น null เสมอ receivedKg เป็น null หรือ > 0 · รหัสยาวได้ 60 · source ที่ไม่รู้จักผิด
        const partShape = (line) => line.source !== "bom" || ((line.lotNo ?? null) === null && (line.expiry ?? null) === null && ((line.receivedKg ?? null) === null || (money(line.receivedKg) && line.receivedKg > 0)));
        // คำขอปิดยอดที่เหลือ: closedRemainder ไม่ส่ง / null หรือ object ที่ reason (ถ้ามี) เป็นข้อความไม่เกิน 300 ตัวอักษรหลังตัดช่องว่าง (ตรงกับ rf_po_parse_lines)
        const closeShape = (value) => value === undefined || value === null || (typeof value === "object" && !Array.isArray(value) && (value.reason === undefined || value.reason === null || (typeof value.reason === "string" && value.reason.trim().length <= 300)));
        // บรรทัดเคมี (ตรงกับ rf_po_parse_lines): receivedKg / lotNo / expiry มีครบทั้งสามหรือ null ทั้งสาม · receivedKg > 0 · เลขล็อตตามรูปแบบ · วันหมดอายุเป็นจำนวนเต็ม
        const chemShape = (line) => line.source === "bom" || ((line.receivedKg ?? null) === null
          ? (line.lotNo ?? null) === null && (line.expiry ?? null) === null
          : money(line.receivedKg) && line.receivedKg > 0 && typeof line.lotNo === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(line.lotNo) && Number.isInteger(line.expiry));
        const shape = (line) => Boolean(line) && typeof line === "object" && !Array.isArray(line) && typeof line.materialCode === "string" && line.materialCode.length >= 1 && line.materialCode.length <= 60 && [undefined, "rf", "bom"].includes(line.source) && partShape(line) && chemShape(line) && closeShape(line.closedRemainder) && [line.needKg, line.shortageKg, line.safetyKg].every(money) && money(line.qtyKg) && typeof line.availableKg === "number" && Number.isFinite(line.availableKg) && Math.abs(line.availableKg) <= 1e9 && line.qtyKg > 0;
        if (!["ordered", "received", "cancelled"].includes(record.status) || !Array.isArray(record.lines) || !record.lines.length || record.lines.length > 100 || !record.lines.every(shape)) fail(bad);
        if (!optText(record.sourcePi, 60) || !optText(record.sourceRequisition, 60) || !optText(record.note, 300)) fail(bad);
        if (!prev) {
          if (!stOrAdmin) fail("RF_FORBIDDEN");
          if (action !== "createPurchaseOrder" || record.status !== "ordered") fail(bad); // ใบใหม่มากับคำสั่งสั่งซื้อและเป็น ordered เท่านั้น
          // รหัสไม่ซ้ำ (ไม่แยกตัวพิมพ์ ข้ามชนิด) · เคมี = วัตถุดิบที่มีอยู่และ active · ของซื้อ = ชิ้น PURCHASED ใน item master ของ BOM (รหัสตามที่เก็บ หน่วยจาก item master) แล้วสต็อกขั้นต่ำถูก upsert ที่ BOM
          const codes = new Set();
          const lines = record.lines.map((line) => {
            if (codes.has(line.materialCode.toUpperCase())) fail(bad);
            codes.add(line.materialCode.toUpperCase());
            if ([line.receivedKg, line.lotNo, line.expiry, line.receivedAt, line.receivedBy].some((value) => value !== null && value !== undefined)) fail(bad);
            if (line.closedRemainder && typeof line.closedRemainder === "object") fail(bad); // ใบใหม่มาพร้อมคำขอปิดยอดไม่ได้
            const common = { needKg: line.needKg, availableKg: line.availableKg, shortageKg: line.shortageKg, safetyKg: line.safetyKg, qtyKg: line.qtyKg, receivedKg: null, lotNo: null, expiry: null, receivedAt: null, receivedBy: null };
            if (line.source === "bom") {
              const item = bomLoad().items.find((row) => row.code === bomCode(line.materialCode) && row.kind === "PURCHASED") ?? fail(bad);
              // สต็อกขั้นต่ำของซื้อเปลี่ยนได้โดยกลุ่มวางแผนหรือแผนก ST (ไม่มีแถวสต็อก = 0) · ตรงกับ rf_save_purchase_orders
              // storedSafetyKg = ค่าที่หน้าต่างแสดงตอนเปิด: ส่งมาเท่ากัน = ผู้สั่งไม่ได้แก้ จึงไม่เขียนทับค่าที่ผู้อื่นเพิ่งตั้ง (ตรงกับ 20261120010000)
              const storedRow = bomLoad().stock.find((entry) => entry.itemCode === item.code);
              if (line.storedSafetyKg !== undefined && line.storedSafetyKg !== null && !money(line.storedSafetyKg)) fail(bad);
              if (storedRow && typeof line.storedSafetyKg === "number" && line.safetyKg === line.storedSafetyKg) return { materialCode: item.code, source: "bom", uom: item.uom, ...common, safetyKg: storedRow.safetyQty ?? 0 };
              // ST ที่ไม่ใช่กลุ่มวางแผนเปลี่ยนได้เฉพาะเมื่อส่ง storedSafetyKg มา (client รุ่นก่อนที่ไม่ส่งอาจถือค่าเก่า) ตรงกับ 20261122010000
              if (line.safetyKg !== (storedRow?.safetyQty ?? 0) && !(planner || (actor.dept === "ST" && typeof line.storedSafetyKg === "number"))) fail("RF_FORBIDDEN");
              ops.stock.push({ kind: "safety", code: item.code, qty: line.safetyKg });
              return { materialCode: item.code, source: "bom", uom: item.uom, ...common };
            }
            const material = next.materials.find((row) => row.code === line.materialCode);
            if (!material || material.active === false) fail(bad);
            return { materialCode: line.materialCode, source: "rf", uom: null, ...common };
          });
          put({
            id: record.id, status: "ordered", sourcePi: record.sourcePi ?? null, sourceRequisition: record.sourceRequisition ?? null, note: record.note ?? "",
            lines, createdAt: at, createdBy: actor.name, cancelledAt: null,
          });
          return null;
        }
        // ส่งมาเป็น "ใบใหม่" ด้วยเลขที่มีอยู่แล้ว (เวลาสร้างต่างจากที่เก็บ) = เลขเอกสารชนกัน (ชนเวอร์ชันถูกตัดสินก่อนหน้านี้เป็น RF_STALE) · สำเนาที่ตรงกับที่เก็บถูกข้ามไปแล้วตั้งแต่ก่อนถึงตรงนี้
        if (typeof record.createdAt === "number" && record.createdAt !== prev.createdAt) fail("RF_CONFLICT");
        // เทียบกับใบที่เก็บ: ช่องของใบ + ทุกบรรทัด (เวลา/ผู้รับ / รายการรับ / การปิดของ client ไม่นับ) · นับบรรทัดที่ client ขอรับเพิ่ม (ยอดสะสมมากกว่าที่เก็บ) และขอปิดยอดที่เหลือ
        // ตรงกับ rf_save_purchase_orders ของ 20261128020000: ยอดสะสมเท่าเดิม = ไม่เปลี่ยน (บรรทัดที่รับแล้ว ล็อต / วันหมดอายุต้องเท่าเดิม) · น้อยกว่าหรือลบออก = แก้ (ไม่ยอม)
        let other = record.lines.length !== prev.lines.length || ["sourcePi", "sourceRequisition", "note"].some((key) => (record[key] ?? "") !== (prev[key] ?? ""));
        const changed = [];
        const closes = [];
        if (!other) {
          record.lines.forEach((line, i) => {
            const old = prev.lines[i];
            if (bomCanon(plain(line)) !== bomCanon(plain(old))) { other = true; return; }
            const oldKg = old.receivedKg ?? null;
            const newKg = line.receivedKg ?? null;
            if (newKg === oldKg) {
              if (oldKg !== null && ((line.lotNo ?? null) !== (old.lotNo ?? null) || (line.expiry ?? null) !== (old.expiry ?? null))) other = true;
            } else if (newKg !== null && newKg > (oldKg ?? 0)) changed.push(i);
            else other = true;
            if (!(old.closedRemainder && typeof old.closedRemainder === "object") && line.closedRemainder && typeof line.closedRemainder === "object") closes.push(i);
          });
        }
        // ตรงกับที่เก็บทุกช่องที่ client บอกได้ = ไม่ทำอะไร (เช่น ส่งรายการรับปลอม หรือเอาการปิดออก: เป็นของเซิร์ฟเวอร์)
        if (!other && !changed.length && !closes.length && record.status === prev.status) return "skip";
        // ยกเลิก: สิทธิ์ก่อน (แผนก ST หรือ admin) แล้วค่อยตรวจสถานะ — เฉพาะใบ ordered ที่ไม่มีบรรทัดรับเข้าหรือปิดยอด
        if (record.status === "cancelled" && prev.status !== "cancelled") {
          if (!stOrAdmin) fail("RF_FORBIDDEN");
          if (action !== "cancelPurchaseOrder") fail(bad);
          if (prev.status !== "ordered" || other || changed.length || closes.length || prev.lines.some((old) => received(old) || Boolean(old.closedRemainder && typeof old.closedRemainder === "object"))) fail("RF_INVALID_TRANSITION");
          put({ ...prev, status: "cancelled", cancelledAt: at });
          return null;
        }
        // ปิดยอดที่เหลือ (closePurchaseLine): แผนก ST หรือ admin หนึ่งบรรทัดที่ยังไม่ครบ เหตุผล 3-300 · ไม่แตะสต็อก/ล็อต · closedRemainder = { kg, reason, at, by }
        if (closes.length) {
          if (!stOrAdmin) fail("RF_FORBIDDEN");
          if (action !== "closePurchaseLine") fail(bad);
          if (prev.status !== "ordered" || other) fail("RF_INVALID_TRANSITION");
          if (closes.length !== 1 || changed.length) fail(bad);
          const at2 = closes[0];
          const old = prev.lines[at2];
          if (poDone(old)) fail("RF_INVALID_TRANSITION");
          const reason = typeof record.lines[at2].closedRemainder.reason === "string" ? record.lines[at2].closedRemainder.reason.trim() : "";
          if (reason.length < 3) fail(bad);
          const closedLines = prev.lines.map((row, i) => (i === at2 ? { ...row, closedRemainder: { kg: Math.max(0, round9(row.qtyKg - poReceived(row))), reason, at, by: actor.name } } : row));
          put({ ...prev, lines: closedLines, status: closedLines.every(poDone) ? "received" : "ordered" });
          return null;
        }
        // ที่เหลือที่ยอมให้มีได้ทางเดียวคือรับเข้าหนึ่งบรรทัด (แผนก ST หรือ admin) ที่มาพร้อมล็อตใหม่ (เคมี) · รับซ้ำบรรทัดเดิมได้จนกว่าจะครบ
        if (!changed.length) fail("RF_INVALID_TRANSITION");
        if (!stOrAdmin) fail("RF_FORBIDDEN");
        if (action !== "receivePurchaseLine") fail(bad);
        if (prev.status !== "ordered" || other) fail("RF_INVALID_TRANSITION");
        if (changed.length !== 1 || receipts.length) fail(bad);
        const index2 = changed[0];
        const line = record.lines[index2];
        const prevLine = prev.lines[index2];
        // บรรทัดที่ครบแล้ว (รับถึงยอดสั่ง / ปิดยอด / บรรทัดรุ่นเก่าที่รับไปแล้ว) รับอีกไม่ได้ · ยอดครั้งนี้ = สะสมใหม่ − สะสมที่เก็บ (ไม่เชื่อส่วนต่างของ client)
        if (poDone(prevLine)) fail("RF_INVALID_TRANSITION");
        const kg = round9(line.receivedKg - (prevLine.receivedKg ?? 0));
        const stacked = (lotNo, expiry) => [...(Array.isArray(prevLine.receipts) ? prevLine.receipts : []), { kg, lotNo, expiry, at, by: actor.name }];
        if ((prevLine.source ?? "rf") === "bom") {
          // ของซื้อ: รับเฉพาะปริมาณ (ไม่มีล็อต/วันหมดอายุ) บวกยอดคงเหลือเฉพาะครั้งนี้และเขียนประวัติ receive ฝั่ง BOM · ห้ามมีล็อตวัตถุดิบมาด้วย (ตรวจท้ายคำสั่ง)
          if (!(money(line.receivedKg) && line.receivedKg > 0)) fail(bad);
          // ชิ้นต้องยังเป็นของซื้อใน item master (ตรงกับตรวจตอนรับใน rf_save_purchase_orders)
          if (!bomLoad().items.some((row) => row.code === prevLine.materialCode && row.kind === "PURCHASED")) fail(bad);
          partReceipts.push({ kind: "receive", code: prevLine.materialCode, qty: kg, ref: record.id });
          ops.stock.push(partReceipts.at(-1));
          const partLines = prev.lines.map((old, i) => (i === index2 ? { ...old, receivedKg: line.receivedKg, lotNo: null, expiry: null, receivedAt: at, receivedBy: actor.name, receipts: stacked(null, null) } : old));
          put({ ...prev, lines: partLines, status: partLines.every(poDone) ? "received" : "ordered" });
          return null;
        }
        if (!(money(line.receivedKg) && line.receivedKg > 0) || typeof line.expiry !== "number" || !(line.expiry > at) || typeof line.lotNo !== "string" || !line.lotNo) fail(bad);
        receipts.push({ materialCode: line.materialCode, kg, expiry: line.expiry, lotNo: line.lotNo });
        const lines = prev.lines.map((old, i) => (i === index2 ? { ...old, receivedKg: line.receivedKg, lotNo: line.lotNo, expiry: line.expiry, receivedAt: at, receivedBy: actor.name, receipts: stacked(line.lotNo, line.expiry) } : old));
        put({ ...prev, lines, status: lines.every(poDone) ? "received" : "ordered" });
        return null;
      }
      if (list === "chemDocs") return chemDoc(prev, record, put, bad);
      // molds: เพิ่ม/แก้นิยามและบันทึกล้าง = กลุ่มวางแผนหรือแผนก RB · ยอดใช้งานสะสมนับจากล็อตฉีด/อบเท่านั้น
      if (!master) fail("RF_FORBIDDEN");
      if (blank(record.name) || String(record.name).length > 120 || !["die", "mold", "line"].includes(record.kind) || !["m", "pcs", "shot"].includes(record.unit)) fail(bad);
      if (!Number.isInteger(record.perCycle) || record.perCycle < 1 || !(num(record.cleanEvery) > 0) || !(num(record.pmLimit) > 0)) fail(bad);
      const definition = { name: record.name, kind: record.kind, unit: record.unit, perCycle: record.perCycle, cleanEvery: record.cleanEvery, pmLimit: record.pmLimit };
      if (!prev) {
        put({ id: record.id, ...definition, usageSinceClean: 0, totalUsage: 0, lastCleanAt: at });
        return null;
      }
      const cleaning = record.usageSinceClean === 0 && prev.usageSinceClean > 0;
      // ต่างจากของเดิมแค่ยอดใช้งาน (ฐานข้อมูลนับเอง) และไม่ใช่การล้าง = ไม่มีอะไรเปลี่ยน
      if (!cleaning && rfSame(prev, record, ["usageSinceClean", "totalUsage", "lastCleanAt"])) return "skip";
      const out = { ...prev, ...definition };
      if (cleaning) { out.usageSinceClean = 0; out.lastCleanAt = at; }
      put(out);
      return null;
    };
    // เอกสารคลังเคมี ST / RB (ตรงกับ private.rf_save_chem_docs ของ 20261220010000) · ลำดับตรวจ: ชน → สิทธิ์ → ทาง → เนื้อหา (RF_INVALID_CHEM)
    // ระเบียนเดิม: client บอกได้แค่สถานะ (ยกเลิก ปิดยอด รับ ปฏิเสธ) และยอดจ่ายสะสม issuedKg ของใบขอเบิก · ใบนับแก้ไม่ได้ · ไม่มีอะไรเปลี่ยนตามความหมาย = ข้าม
    function chemDoc(prev, record, put, bad) {
      const plainText = (value, min, max = 300) => {
        if (value !== undefined && value !== null && typeof value !== "string") fail(bad);
        const out = String(value ?? "").trim();
        if (out.length < min || out.length > max) fail(bad);
        return out;
      };
      const kgIn = (value) => (value === undefined || value === null ? null : typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : fail(bad));
      const status = plainText(record.status, 0, 20);
      const clines = Array.isArray(record.lines) ? record.lines : [];
      const lotAt = (lotNo) => next.materialLots.findIndex((row) => row.lotNo === lotNo);
      const setLot = (index, patch) => { next.materialLots[index] = { ...next.materialLots[index], ...patch }; stampVersion("materialLots", next.materialLots[index].lotNo); };
      const anyLotStale = () => next.materialLots.some((row) => stale("materialLots", row.lotNo));
      if (prev) {
        if (typeof record.createdAt === "number" && record.createdAt !== prev.createdAt) fail(stale("chemDocs", prev.id) ? "RF_STALE" : "RF_CONFLICT");
        let changed = status !== "" && status !== prev.status;
        if (prev.kind === "request" && !changed) prev.lines.forEach((old, i) => { const kg = clines[i]?.issuedKg; if (typeof kg === "number" && Math.abs(kg - old.issuedKg) > 0.0000005) changed = true; });
        if (prev.kind === "count" || !changed) return "skip";
        if (stale("chemDocs", prev.id)) fail("RF_STALE");
        if (action === "issueChemicals") {
          if (prev.kind !== "request") fail(bad);
          if (!stOrAdmin) fail("RF_FORBIDDEN");
          if (!["open", "partial"].includes(prev.status)) fail("RF_INVALID_TRANSITION");
          if (clines.length !== prev.lines.length) fail(bad);
          let any = false;
          const lines = prev.lines.map((old, i) => {
            const line = clines[i];
            if (!rfPlain(line) || line.materialCode !== old.materialCode) fail(bad);
            let kg = round6((kgIn(line.issuedKg) ?? old.issuedKg) - old.issuedKg);
            if (kg < 0) fail(bad);
            if (kg === 0) return old;
            const left = old.qtyKg - old.issuedKg;
            if (kg > left + 0.000001) fail(bad);
            kg = Math.min(kg, left);
            if (kg <= 0) return old;
            any = true;
            // FEFO จากคลัง ST: available ไม่หมดอายุ (ข้ามล็อตกักกัน) หักที่ใบเบิกเดิมของคลัง ST ที่ค้างชั่งจองไว้ · ย้าย qtyKg → rbKg ทันที
            const { picks, shortage } = R.allocateFefo(next.materialLots, old.materialCode, kg, at, R.weighingReservedKg(next.requisitions, "ST"), "ST");
            if (shortage > 1e-9) fail(anyLotStale() ? "RF_STALE" : "RF_INSUFFICIENT_STOCK");
            const issues = [...(Array.isArray(old.issues) ? old.issues : [])];
            for (const pick of picks) {
              const index = lotAt(pick.lotNo);
              const lot = next.materialLots[index];
              const take = round6(pick.kg);
              setLot(index, { qtyKg: round6(lot.qtyKg - take), rbKg: round6((lot.rbKg ?? 0) + take) });
              issues.push({ lotNo: pick.lotNo, kg: take, at, by: actor.name });
            }
            return { ...old, issuedKg: round6(old.issuedKg + kg), issues };
          });
          if (!any) fail(bad);
          const done = lines.every((line) => line.issuedKg >= line.qtyKg);
          put({ ...prev, lines, status: done ? "done" : "partial", ...(done ? { doneAt: at, doneBy: actor.name } : {}) });
          return null;
        }
        if (action === "cancelChemicalRequest") {
          if (prev.kind !== "request" || status !== "cancelled") fail(bad);
          if (!chemSide) fail("RF_FORBIDDEN");
          if (prev.status !== "open" || prev.lines.some((line) => line.issuedKg > 0)) fail("RF_INVALID_TRANSITION");
          put({ ...prev, status: "cancelled", reason: plainText(record.reason, 0), doneAt: at, doneBy: actor.name });
          return null;
        }
        if (action === "closeChemicalRequest") {
          if (prev.kind !== "request" || status !== "closed") fail(bad);
          if (!stOrAdmin) fail("RF_FORBIDDEN");
          if (!["open", "partial"].includes(prev.status)) fail("RF_INVALID_TRANSITION");
          put({ ...prev, status: "closed", reason: plainText(record.reason, 3), doneAt: at, doneBy: actor.name });
          return null;
        }
        if (action === "receiveChemicalReturn" || action === "rejectChemicalReturn") {
          const receive = action === "receiveChemicalReturn";
          if (prev.kind !== "return" || status !== (receive ? "received" : "rejected")) fail(bad);
          if (!stOrAdmin) fail("RF_FORBIDDEN");
          if (prev.status !== "pending") fail("RF_INVALID_TRANSITION");
          const reason = plainText(record.reason, receive ? 0 : 3);
          // รับทั้งใบตามยอดที่ส่ง (เข้าคลัง ST) หรือปฏิเสธ (กลับคลัง RB) ไม่มีรับบางส่วน
          for (const line of prev.lines) {
            const index = lotAt(line.lotNo);
            if (index === -1) fail(bad);
            const lot = next.materialLots[index];
            setLot(index, receive ? { qtyKg: round6(lot.qtyKg + line.kg) } : { rbKg: round6((lot.rbKg ?? 0) + line.kg) });
          }
          put({ ...prev, status: receive ? "received" : "rejected", reason, lines: receive ? prev.lines.map((line) => ({ ...line, receivedKg: line.kg })) : prev.lines, doneAt: at, doneBy: actor.name });
          return null;
        }
        fail(bad);
      }
      if (action === "requestChemicals") {
        if (!chemSide) fail("RF_FORBIDDEN");
        if (!record.id.startsWith("CR-")) fail(bad);
        const note = plainText(record.note, 0);
        if (clines.length < 1 || clines.length > 100) fail(bad);
        const codes = new Set();
        const lines = clines.map((line) => {
          if (!rfPlain(line)) fail(bad);
          const code = plainText(line.materialCode, 1, 40);
          if (codes.has(code)) fail(bad);
          codes.add(code);
          const material = next.materials.find((row) => row.code === code);
          if (!material || material.active === false) fail(bad);
          const kg = kgIn(line.qtyKg);
          if (kg === null || !(round6(kg) > 0)) fail(bad);
          return { materialCode: material.code, qtyKg: round6(kg), issuedKg: 0, issues: [] };
        });
        put({ id: record.id, kind: "request", status: "open", lines, note, reason: "", createdAt: at, createdBy: actor.name });
        return null;
      }
      if (action === "returnChemicals" || action === "countRbStock") {
        const back = action === "returnChemicals";
        // คืน = ฝ่ายวางแผนคลังเคมี / RB · นับคลัง RB = ฝ่ายวางแผนคลังเคมี หรือผู้จัดการแผนก RB (ผู้จัดการแผนกอื่นไม่ได้)
        if (back ? !chemSide : !chemCount) fail("RF_FORBIDDEN");
        if (!record.id.startsWith(back ? "CT-" : "CC-")) fail(bad);
        const note = plainText(record.note, 0);
        const reason = plainText(record.reason, back ? 0 : 3);
        if (clines.length < 1 || clines.length > 100) fail(bad);
        const lots = new Set();
        for (const line of clines) {
          if (!rfPlain(line)) fail(bad);
          const lotNo = plainText(line.lotNo, 1, 60);
          if (lots.has(lotNo)) fail(bad);
          lots.add(lotNo);
        }
        const lines = clines.map((line) => {
          const index = lotAt(String(line.lotNo).trim());
          if (index === -1) fail(bad);
          const lot = next.materialLots[index];
          if (back) {
            const kg = kgIn(line.kg);
            if (kg === null || !(round6(kg) > 0)) fail(bad);
            if (round6(kg) > (lot.rbKg ?? 0)) fail(stale("materialLots", lot.lotNo) ? "RF_STALE" : bad);
            setLot(index, { rbKg: round6((lot.rbKg ?? 0) - round6(kg)) });
            return { lotNo: lot.lotNo, materialCode: lot.materialCode, kg: round6(kg), receivedKg: null };
          }
          const counted = kgIn(line.countedKg);
          if (counted === null) fail(bad);
          // ยอดนับไม่เกินยอดรับเข้า − คลัง ST − ที่คืนระหว่างทาง
          if (round6(counted) > lot.initialKg - lot.qtyKg - transitKg(lot.lotNo) + 0.000001) fail(stale("materialLots", lot.lotNo) ? "RF_STALE" : bad);
          const beforeKg = lot.rbKg ?? 0;
          if (round6(counted) !== beforeKg) setLot(index, { rbKg: round6(counted) });
          return { lotNo: lot.lotNo, materialCode: lot.materialCode, beforeKg, countedKg: round6(counted) };
        });
        put({ id: record.id, kind: back ? "return" : "count", status: back ? "pending" : "done", lines, note, reason, createdAt: at, createdBy: actor.name, ...(back ? {} : { doneAt: at, doneBy: actor.name }) });
        return null;
      }
      fail(bad);
    }
    const seen = new Set();
    for (const list of RF_LISTS) {
      const bad = RF_BAD[list];
      for (const raw of changes[list]?.upsert ?? []) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(bad);
        const record = list === "recipes" ? rfCanonRecipe(raw) : raw;
        const key = list === "materials" ? record.code : list === "materialLots" ? record.lotNo : record.id;
        if (typeof key !== "string" || !RF_CODE[list].test(key)) fail(bad);
        if (list === "recipes" && !(Number.isInteger(record.revision) && record.revision >= 1 && record.revision <= 9999)) fail(bad);
        const id = RF_ID[list](record);
        if (seen.has(`${list}|${id}`)) fail(bad);
        seen.add(`${list}|${id}`);
        const index = next[list].findIndex((row) => RF_ID[list](row) === id);
        const prev = index === -1 ? null : next[list][index];
        // เท่าของล่าสุดทุกช่อง (ไม่นับตราของเซิร์ฟเวอร์) = ไม่ทำอะไร ไม่ตรวจชน ไม่ตรวจสิทธิ์ (เหมือนตัวเขียนของฐานข้อมูล)
        // เอกสารคลังเคมีตัดสินว่า "เปลี่ยน" และ "ชน" ตามความหมายของคำสั่งในตัวเขียนของตัวเอง (chemDoc)
        if (prev && list !== "chemDocs" && !(list === "purchaseOrders" && typeof record.createdAt === "number" && record.createdAt !== prev.createdAt) && rfSame(rfNorm(list, prev), rfNorm(list, record), RF_NOOP[list])) continue;
        // คำสั่งคลังเคมี (ตรงกับ private.rf_check_chem_lot_copies): สำเนาล็อตต้องตรงกับที่เก็บทุกช่องยกเว้นยอด · ล็อตใหม่ / ต่างจากที่เก็บ = RF_INVALID_CHEM (ล็อตเปลี่ยนหลังเวอร์ชันฐาน = RF_STALE)
        if (list === "materialLots" && RF_CHEM_ACTIONS.includes(action)) fail(prev && stale(list, id) ? "RF_STALE" : "RF_INVALID_CHEM");
        // ชนก่อนสิทธิ์/เนื้อหาเสมอ: ระเบียนถูกผู้อื่นแก้/เพิ่มหลัง base (รวมเลข WO ซ้ำ) = ฝั่ง client ถือสำเนาเก่า ต้องได้ RF_STALE ไม่ใช่ RF_FORBIDDEN
        if (prev && list !== "chemDocs" && stale(list, id)) fail("RF_STALE");
        if (list === "materials") {
          // สั่งซื้อ: วัตถุดิบที่มากับใบสั่งซื้อแก้ได้เฉพาะ safetyKg ของวัตถุดิบที่มีอยู่ (ที่เหลือหรือวัตถุดิบใหม่ = RF_INVALID_MATERIAL)
          if (action === "createPurchaseOrder" && (!prev || !rfSame(rfNorm(list, prev), rfNorm(list, record), [...RF_MATERIAL_STAMPS, "safetyKg"]))) fail(bad);
          rfText(record.name, 160, bad);
          if (record.active !== undefined && record.active !== null && typeof record.active !== "boolean") fail(bad);
          // รหัสที่ต่างจากของเดิมแค่ตัวพิมพ์ = ซ้ำ
          if (!prev && next.materials.some((row) => row.code.toUpperCase() === record.code.toUpperCase())) fail("RF_CONFLICT");
          // สต็อกขั้นต่ำ 0–1e9 kg · อายุการเก็บ 1–3650 วัน (จำนวนเต็ม) · ไม่ส่ง = คงค่าเดิม (ใหม่ 0 และ 180)
          const safetyKg = record.safetyKg ?? prev?.safetyKg ?? 0;
          const shelfLifeDays = record.shelfLifeDays ?? prev?.shelfLifeDays ?? 180;
          if (typeof safetyKg !== "number" || !(safetyKg >= 0 && safetyKg <= 1e9) || !Number.isInteger(shelfLifeDays) || shelfLifeDays < 1 || shelfLifeDays > 3650) fail(bad);
          const out = { ...clone(record), safetyKg, shelfLifeDays, createdAt: prev?.createdAt ?? at, createdBy: prev?.createdBy ?? actor.name, updatedAt: at, updatedBy: actor.name };
          if (prev) next.materials[index] = out; else next.materials.push(out);
        } else if (list === "recipes") {
          if (!["draft", "approved", "superseded"].includes(record.status)) fail(bad);
          const siblings = next.recipes.filter((row) => row.id === record.id);
          if (typeof record.productCode !== "string" || record.productCode.length > 60) fail(bad);
          if (!rfStagesValid(record.stages)) fail(bad);
          if (!Array.isArray(record.items) || !record.items.length || record.items.length > 100) fail(bad);
          // วัตถุดิบในสูตรต้องมีอยู่ ไม่ซ้ำ phr > 0 · วัตถุดิบที่เลิกใช้แล้วใส่ได้เฉพาะที่ revision ก่อนหน้า/แถวเดิมใช้อยู่
          const before = prev ?? siblings.slice().sort((a, b) => b.revision - a.revision)[0];
          const codes = new Set();
          for (const item of record.items) {
            const material = next.materials.find((row) => row.code === item?.materialCode);
            if (!material || codes.has(item.materialCode) || !(Number(item?.phr) > 0) || ![1, 2].includes(item.stage)) fail(bad);
            codes.add(item.materialCode);
            if (material.active === false && !(before?.items ?? []).some((row) => row.materialCode === item.materialCode)) fail(bad);
          }
          if (!(Number(record.batchKg) > 0) || !(Number(record.yieldPerKg) > 0)) fail(bad);
          if (record.extrusionSpec !== undefined && !rfExtrusionSpecValid(record.extrusionSpec)) fail(bad);
          if (!prev) {
            // ระเบียนใหม่เริ่มเป็นร่างเสมอ · revision ต้องเป็นล่าสุด + 1 (สูตรใหม่ = 1) มีผู้อื่นแก้สูตรนี้หลัง base = ถือสำเนาเก่า
            if (record.status !== "draft") fail("RF_INVALID_TRANSITION");
            if (!siblings.length) {
              if (next.recipes.some((row) => row.id.toUpperCase() === record.id.toUpperCase())) fail("RF_CONFLICT");
              if (record.revision !== 1) fail("RF_REVISION_ORDER");
            } else {
              if (record.revision !== Math.max(...siblings.map((row) => row.revision)) + 1) {
                if (siblings.some((row) => stale("recipes", RF_ID.recipes(row)))) fail("RF_STALE");
                fail("RF_REVISION_ORDER");
              }
              if (siblings.some((row) => row.status === "draft")) fail("RF_INVALID_TRANSITION");
            }
          } else if (prev.status === "draft") {
            if (record.status === "draft") { /* แก้ร่าง: กลุ่มวางแผนหรือสมาชิก RB (ตรวจที่ส่วนแล้ว) */ }
            else if (record.status === "approved") {
              if (!head) fail("RF_FORBIDDEN");
              if (!rfSame(prev, record, RF_RECIPE_OWNED)) fail("RF_INVALID_TRANSITION");
              approvedNow.push(record);
            } else fail("RF_INVALID_TRANSITION");
          } else if (prev.status === "approved") {
            if (!rfSame(prev, record, RF_RECIPE_OWNED)) fail("RF_REVISION_IMMUTABLE");
            if (record.status !== "superseded") fail("RF_INVALID_TRANSITION");
            supersededSent.push(record);
          } else fail("RF_REVISION_IMMUTABLE");
          const out = clone(record);
          out.createdAt = prev?.createdAt ?? at;
          out.createdBy = prev?.createdBy ?? actor.name;
          if (out.status === "approved") { out.approvedAt = prev?.approvedAt ?? at; out.approvedBy = prev?.approvedBy ?? actor.name; } else { delete out.approvedAt; delete out.approvedBy; }
          if (out.status === "superseded") out.supersededAt = prev?.supersededAt ?? at; else delete out.supersededAt;
          if (prev) next.recipes[index] = out; else next.recipes.push(out);
        } else if (list === "orders") {
          if (!RF_ORDER_STATUSES.includes(record.status)) fail(bad);
          if (!(Number(record.targetQty) > 0) || !String(record.customer ?? "").trim() || !(Number(record.producedQty ?? 0) >= 0)) fail(bad);
          if (!prev) {
            // ใบสั่งผลิตใหม่ = กลุ่มวางแผนเท่านั้น (โรงงานขั้น 6) · แผนก RB และหัวหน้า RB ไม่เปิดเอง
            if (!planner) fail("RF_FORBIDDEN");
            if (record.status !== "planned") fail("RF_INVALID_TRANSITION");
            if (Number(record.producedQty ?? 0) !== 0) fail(bad);
            if (record.sourceJobId !== undefined && record.sourceJobId !== null && !RF_CODE.orders.test(String(record.sourceJobId))) fail(bad);
            const recipe = next.recipes.find((row) => row.id === record.recipeId && (record.recipeRevision === undefined || record.recipeRevision === null ? row.status === "approved" : row.revision === record.recipeRevision));
            if (!recipe || recipe.status !== "approved") {
              if (next.recipes.some((row) => row.id === record.recipeId && stale("recipes", RF_ID.recipes(row)))) fail("RF_STALE");
              fail("RF_INVALID_RECIPE");
            }
            let uom = recipe.uom;
            if (record.sourceJobId) {
              // งานต้องเป็นงาน RB ที่ยังไม่ done ของใบที่ปล่อยผลิตแล้ว และยังไม่ถูกผูก (หรือผูกกับ WO ที่ยกเลิกแล้ว) · ไม่บังคับกิโลกรัม (ผูกด้วย 0)
              const job = bomLoad().jobs.find((row) => row.id === record.sourceJobId);
              const jobOrder = job ? bomLoad().orders.find((row) => row.id === job.orderId) : null;
              const priorCancelled = job?.externalRef && next.orders.some((row) => row.id === job.externalRef.woId && row.status === "cancelled");
              if (!job || job.dept !== "RB" || job.status === "done" || !["released", "in_progress"].includes(jobOrder?.status) || (job.externalRef && !priorCancelled) || ops.link.some((item) => item.job === job.id)) fail("RF_INVALID_SOURCE_JOB");
              ops.link.push({ job: job.id, woId: record.id, kg: Number(record.targetKg) || 0 });
              uom = job.uom;
            }
            // สินค้า/หน่วย/revision ได้จากสูตรหรืองาน BOM ไม่เชื่อ client
            const created = { ...clone(record), productCode: recipe.productCode, uom, recipeRevision: recipe.revision, producedQty: 0, createdAt: at, createdBy: actor.name };
            delete created.productName; // สินค้าอ้างจากรหัสสูตร + รหัสสินค้า ไม่มีชื่อสินค้า
            next.orders.push(created);
          } else {
            const from = prev.status;
            const to = record.status;
            // ยอดผลิตมาจากล็อตตกแต่งที่นับแล้ว ฐานข้อมูลคำนวณเอง (ไม่รับค่าจาก client) · เปลี่ยนสถานะ = กลุ่มวางแผนหรือสมาชิก RB เท่านั้น (QA เพิ่มยอดผ่านผลตรวจ ซึ่งไม่ผ่านระเบียนใบสั่งผลิต)
            if (!master) fail("RF_FORBIDDEN");
            if (!rfSame(prev, record, RF_ORDER_OWNED)) fail("RF_INVALID_ORDER");
            // ปล่อยผลิต (planned → released) = กลุ่มวางแผนเท่านั้น (โรงงานขั้น 6) · RB และหัวหน้า RB เริ่มงาน พัก ผลิตต่อ ปิดงานได้ตามเดิม
            if (to === "released" && from !== to && !planner) fail("RF_FORBIDDEN");
            if (from !== to && !(RF_FLOW[from] ?? []).includes(to)) fail("RF_INVALID_TRANSITION");
            const out = { ...clone(record), createdAt: prev.createdAt, createdBy: prev.createdBy, producedQty: prev.producedQty };
            for (const stampKey of ["releasedAt", "releasedBy", "completedAt", "cancelledAt"]) if (prev[stampKey] !== undefined) out[stampKey] = prev[stampKey];
            if (from !== to) {
              if (to === "released") { out.releasedAt = at; out.releasedBy = actor.name; }
              if (to === "completed") out.completedAt = at;
              if (to === "cancelled") {
                out.cancelledAt = at;
                if (prev.sourceJobId) ops.unlink.push({ job: prev.sourceJobId, woId: prev.id });
              }
            }
            next.orders[index] = out;
          }
        } else if (shop(list, prev, record, index) === "skip") continue;
        stampVersion(list, id);
      }
    }
    // อนุมัติ revision ใหม่ = revision ที่อนุมัติอยู่เดิมของรหัสเดียวกันถูกแทนที่ในคำสั่งเดียวกัน (อนุมัติได้ครั้งละหนึ่ง revision ต่อรหัส)
    for (const recipe of approvedNow) {
      for (const row of next.recipes) {
        if (row.id === recipe.id && row.revision !== recipe.revision && row.status === "approved") {
          row.status = "superseded";
          row.supersededAt = at;
          stampVersion("recipes", RF_ID.recipes(row));
        }
      }
    }
    for (const recipe of supersededSent) if (!approvedNow.some((row) => row.id === recipe.id)) fail("RF_INVALID_TRANSITION"); // แทนที่ได้เฉพาะพร้อมการอนุมัติ revision ใหม่ของรหัสเดียวกัน
    for (const row of next.recipes) if (row.status === "approved" && next.recipes.some((other) => other !== row && other.id === row.id && other.status === "approved")) fail("RF_INVALID_RECIPE");
    // ---- กล่องทั้งล็อต (ตรงกับ rf_save_boxes ของ 20261207010000): รับเข้า = ไม่มีกล่อง pending_wh ของล็อตเหลือ แล้วนับยอดเข้างาน RB ----
    // ย้อนรับเข้า = ไม่มีกล่องที่ส่งมอบแล้ว / กัก (RF_INVALID_TRANSITION) และไม่มีกล่องที่ยังอยู่ในคลัง (RF_INVALID_BOX) แล้วถอนยอด · ใบ completed ถอนไม่ได้
    // ถอนยอดที่ล็อตนับเข้างาน RB ไว้ (ตรงกับ private.rf_box_uncredit): ใบ released / in_progress = ถอนยอดจากงาน
    // kind unreceive (WH ย้อนรับเข้า): ใบ completed = RF_INVALID_TRANSITION · อื่น / ไม่พบงาน = ล้างค่าที่จำไว้อย่างเดียว
    // kind qa_fail (QA ตัดสินไม่ผ่าน · บันทึกได้เสมอ): ใบที่ไม่ใช่ released / in_progress หรือไม่พบงาน = ไม่ถอนและคงค่าที่จำไว้
    const uncredit = (li, kind, note) => {
      const lot = next.lots[li];
      if (!lot.whCredit) return;
      const job = bomLoad().jobs.find((row) => row.id === lot.whCredit.jobNo);
      const bomOrder = job ? bomLoad().orders.find((row) => row.id === job.orderId) : null;
      const open = Boolean(job) && ["released", "in_progress"].includes(bomOrder?.status);
      if (kind === "qa_fail" && !open) return;
      if (kind === "unreceive" && bomOrder?.status === "completed") fail("RF_INVALID_TRANSITION");
      if (open) ops.credit.push({ kind, job: job.id, qty: lot.whCredit.qty, lotId: lot.id, note });
      next.lots[li] = { ...lot, whCredit: null };
      stampVersion("lots", lot.id);
    };
    for (const [lotId, note] of boxLots) {
      if (action !== "receiveBoxes" && action !== "reverseBoxReceipt") continue;
      const boxes = next.fgBoxes.filter((box) => box.lotId === lotId);
      const li = next.lots.findIndex((row) => row.id === lotId);
      if (li === -1) fail("RF_INVALID_BOX");
      const lot = next.lots[li];
      if (action === "receiveBoxes") {
        if (boxes.some((box) => box.status === "pending_wh")) fail("RF_INVALID_BOX");
        const qty = Math.round(Number(lot.goodQty) * 1e9) / 1e9;
        if (lot.destination !== "customer" || lot.whCredit || !(qty > 0)) continue;
        const wo = next.orders.find((row) => row.id === lot.orderId);
        const job = rfLinkedJob(wo);
        const bomOrder = job ? bomLoad().orders.find((row) => row.id === job.orderId) : null;
        if (!job || job.externalRef?.woId !== wo.id || job.status === "done" || !["released", "in_progress"].includes(bomOrder?.status)) continue;
        next.lots[li] = { ...lot, whCredit: { jobNo: job.id, qty } };
        stampVersion("lots", lotId);
        ops.credit.push({ kind: "credit", job: job.id, qty, lotId });
      } else {
        if (boxes.some((box) => box.status === "shipped" || box.status === "hold")) fail("RF_INVALID_TRANSITION");
        if (boxes.some((box) => box.status === "in_stock")) fail("RF_INVALID_BOX");
        uncredit(li, "unreceive", note);
      }
    }
    // ---- ตรวจความครบของคำสั่ง และคำนวณตัวเลขที่ฐานข้อมูลคำนวณเอง ----
    // ใบเบิกที่ถูกใช้ผสม (issued → consumed) กับล็อตผสมที่เพิ่ม ต้องมาคู่กัน
    for (const claim of claims) if (!mixingNew.some((row) => row.lot === claim.lot && row.req === claim.req)) fail("RF_INVALID_TRANSITION");
    for (const row of mixingNew) if (!claims.some((claim) => claim.lot === row.lot && claim.req === row.req)) fail("RF_INVALID_TRANSITION");
    // รับบรรทัดของซื้อมาพร้อมล็อตวัตถุดิบไม่ได้ (ตรงกับตรวจใน app_rf_save)
    if (partReceipts.length && newLots.length) fail("RF_INVALID_PURCHASE");
    // ตรวจสอบรับเข้า: ล็อตวัตถุดิบใหม่ล็อตเดียวของคำสั่งนี้ ต้องตรงกับบรรทัดที่รับ (เลขล็อต วัตถุดิบ ปริมาณ วันหมดอายุ)
    for (const receipt of receipts) {
      const lot = newLots.length === 1 ? next.materialLots.find((row) => row.lotNo === newLots[0]) : null;
      if (!lot || lot.lotNo !== receipt.lotNo || lot.materialCode !== receipt.materialCode || lot.qtyKg !== receipt.kg || lot.initialKg !== receipt.kg || lot.expiry !== receipt.expiry) fail("RF_INVALID_PURCHASE");
    }
    // ผลตรวจ: ผลตัดสินต้องตรงกับสถานะ QC ของล็อตหลังบันทึก · กล่องที่ยังไม่ส่งตามผล QC (ผ่าน = พร้อมส่ง ไม่ผ่าน/รอตัดสิน = hold)
    for (const item of qcNew) {
      const lot = next.lots.find((row) => row.id === item.lotId);
      if (!lot || lot.qc !== item.result) fail("RF_INVALID_QC");
      next.fgBoxes.forEach((box, i) => {
        // ผ่าน = เฉพาะกล่องที่กักไว้กลับที่เดิม (WH รับแล้ว = in_stock · ยังไม่รับ = pending_wh) · อื่น = กล่องที่ยังไม่ส่งมอบและยังไม่กักเป็น hold (ตรงกับ rf_save_qc ของ 20261207010000)
        const moves = lot.qc === "pass" ? box.status === "hold" : box.status !== "shipped" && box.status !== "hold";
        const status = lot.qc !== "pass" ? "hold" : box.receivedAt ? "in_stock" : "pending_wh";
        if (box.lotId === lot.id && moves) { next.fgBoxes[i] = { ...box, status }; stampVersion("fgBoxes", box.id); }
      });
      // fail ของล็อตที่ WH รับเข้าและนับยอดเข้างาน RB แล้ว: ถอนยอดในคำสั่งเดียวกัน (อ้างเลขผลตรวจ) · ใบปิดแล้ว = บันทึก fail ได้ ไม่ถอน
      if (item.result === "fail") uncredit(next.lots.findIndex((row) => row.id === lot.id), "qa_fail", item.id);
    }
    // ยอดส่งต่อของล็อต = ผลรวมที่ส่งมอบไปแล้วทุกใบ
    next.lots.forEach((lot, i) => {
      const sent = round3(next.transfers.filter((row) => row.lotId === lot.id).reduce((sum, row) => sum + row.qtySent, 0));
      if (Math.abs(sent - Number(lot.transferredQty ?? 0)) > 1e-9) { next.lots[i] = { ...lot, transferredQty: sent }; stampVersion("lots", lot.id); }
    });
    // ยอดผลิตของใบ = ผลรวมงานดีของล็อตตกแต่งที่นับแล้ว · ใบที่ยังไม่เริ่ม/ถูกยกเลิกรับยอดไม่ได้ · ครบจำนวนแล้วปิดใบให้เมื่อผู้บันทึกเป็นผู้วางแผนหรือแผนก RB (QA เพิ่มยอดได้แต่ปิดใบไม่ได้)
    for (const orderId of touchedOrders) {
      const oi = next.orders.findIndex((row) => row.id === orderId);
      if (oi === -1) continue;
      const order = next.orders[oi];
      const produced = round3(next.lots.filter((lot) => lot.stage === "finishing" && lot.countedToOrder && lot.orderId === orderId).reduce((sum, lot) => sum + lot.goodQty, 0));
      if (produced <= Number(order.producedQty)) continue;
      if (["planned", "released", "cancelled"].includes(order.status)) fail("RF_INVALID_ORDER");
      const out = { ...order, producedQty: produced };
      if (order.status === "in_progress" && produced >= order.targetQty && master) { out.status = "completed"; out.completedAt = at; }
      next.orders[oi] = out;
      stampVersion("orders", order.id);
    }
    return { next, ops, wrote: mine.size };
  }
  // งานของ BOM ที่ RubberFlow สั่ง (หลังบันทึกของ RubberFlow สำเร็จ ตรงกับ rf_link_job / rf_apply_feedback / rf_unlink_job): ผ่านตัวนับเวอร์ชันของ BOM ครั้งเดียวต่อการบันทึก
  // ให้ client ของ BOM ตามทันด้วยส่วนต่าง และเขียนบรรทัดบันทึกการใช้งานของ BOM (rubberflow:<action>) · ไม่มีอะไรเขียนจริง (ข้ามทุกอย่าง) = ตัวนับ BOM ไม่ขยับ
  function rfApplyBomOps(ops, actor, at, action) {
    if (!ops.link.length && !ops.rods.length && !ops.unlink.length && !ops.stock.length && !(ops.credit ?? []).length) return;
    const bom = bomLoad();
    const version = bom.version + 1;
    const jobs = new Set();
    const orders = new Set();
    const rodLots = new Set();
    const touchJob = (job) => { bom.versions.jobs[job.id] = version; jobs.add(job.id); };
    const startOrder = (job) => {
      const order = bom.orders.find((row) => row.id === job.orderId);
      if (order && order.status === "released") { order.status = "in_progress"; bom.versions.orders[order.id] = version; orders.add(order.id); }
    };
    // ผูกงาน: external_ref, งาน queued → in_progress, ใบ released → in_progress
    for (const item of ops.link) {
      const job = bom.jobs.find((row) => row.id === item.job);
      job.externalRef = { system: "rubberflow", woId: item.woId, kg: item.kg, linkedAt: at, by: actor.name };
      if (job.status === "queued") job.status = "in_progress";
      touchJob(job);
      startOrder(job);
    }
    // ล็อตตกแต่งที่ QC ผ่านและนับเข้า WO ของ WO ที่ผูกงาน RB (ตอนบันทึก หรือตอน QA ตัดสินเป็น pass ครั้งแรก): สร้างล็อตแท่ง pending ในคลังแท่งยาว (20261202010000)
    // qtySent = ยอดดีของล็อต · spec = สเปกมิติของสูตร revision ที่ WO ผูก (ไม่มี = null) · เลขล็อตซ้ำ / ยอด 0 = ข้าม · งาน RB ยังไม่นับยอดจนกว่า SR รับเข้าผ่าน (หรือ QA ให้ใช้)
    for (const item of ops.rods) {
      const wo = rfMaster.orders.find((row) => row.id === item.woId);
      const job = wo?.sourceJobId ? bom.jobs.find((row) => row.id === wo.sourceJobId) : null;
      const good = Math.round(Number(item.qty) * 1e9) / 1e9;
      // งานต้องผูก WO นี้อยู่ (externalRef.woId = เลข WO ตรงกับ bom_rod_lot_create) · งานที่ผูก WO อื่น = ไม่สร้างล็อตแท่ง
      if (!job || job.externalRef?.woId !== wo.id || !(good > 0) || bom.rodLots.some((lot) => lot.lotNo === item.lotId)) continue;
      const recipe = rfMaster.recipes.find((row) => row.id === wo.recipeId && row.revision === wo.recipeRevision);
      const raw = recipe?.extrusionSpec && typeof recipe.extrusionSpec === "object" ? recipe.extrusionSpec : null;
      const spec = raw && Object.keys(raw).length ? clone(raw) : null;
      const id = newEpoch();
      bom.rodLots.push({
        id, lotNo: item.lotId, itemCode: job.itemCode, orderId: job.orderId, jobNo: job.id, woNo: wo.id, recipeCode: wo.recipeId, uom: job.uom, qtySent: good, spec,
        status: "pending", qtyReceived: null, qc: null, receivedBy: null, receivedAt: null, decision: null, decisionNote: null, decidedBy: null, decidedAt: null, createdAt: at,
        location: "", source: "order", sourceNote: null,
      });
      bom.versions.rodLots[id] = version;
      rodLots.add(id);
    }
    // WH รับล็อตที่ส่งมอบให้ลูกค้าของ WO ที่ผูกงาน (ตรงกับ private.rf_box_credit ของ 20261207010000): งานได้ยอดเต็ม + รายงาน · ใบ released → in_progress
    // ย้อนรับเข้า / QA ตัดสินไม่ผ่าน (private.rf_box_uncredit): ถอนยอด (ไม่ต่ำกว่า 0) · done → in_progress เมื่อต่ำกว่าแผน · รายงาน good 0 ตามที่มา
    for (const item of ops.credit ?? []) {
      const job = bom.jobs.find((row) => row.id === item.job);
      if (!job) continue;
      if (item.kind === "credit") {
        job.qtyDone = Math.round((Number(job.qtyDone || 0) + item.qty) * 1e4) / 1e4;
        job.reports = [...(job.reports ?? []), { at, by: actor.name, good: item.qty, reject: 0, note: `คลังสินค้าสำเร็จรูป (WH) รับเข้า ล็อต ${item.lotId} ส่งมอบให้ลูกค้า`.slice(0, 200) }];
        job.status = job.qtyDone >= Number(job.qtyPlanned) ? "done" : "in_progress";
        if (job.status === "done") job.doneAt = job.doneAt ?? at; else delete job.doneAt;
        touchJob(job);
        startOrder(job);
      } else {
        job.qtyDone = Math.max(Math.round((Number(job.qtyDone || 0) - item.qty) * 1e4) / 1e4, 0);
        const note = item.kind === "qa_fail" ? `QA ตัดสินไม่ผ่าน ล็อต ${item.lotId} ถอนยอด ${item.qty} (${item.note ?? ""})`
          : `ย้อนรับเข้าคลังสินค้าสำเร็จรูป (WH) ล็อต ${item.lotId} ถอน ${item.qty} · ${item.note ?? ""}`;
        job.reports = [...(job.reports ?? []), { at, by: actor.name, good: 0, reject: 0, note: note.slice(0, 200) }];
        if (job.status === "done" && job.qtyDone < Number(job.qtyPlanned)) job.status = "in_progress";
        if (job.status !== "done") delete job.doneAt;
        touchJob(job);
      }
    }
    // ยกเลิก WO: ล้างการผูกของงาน (คงยอดและรายงานเดิม) ต่อรายงานหมายเหตุของระบบ good = 0 · ข้ามเมื่อไม่พบงานหรืองานไม่ชี้มา WO นี้
    for (const item of ops.unlink) {
      const job = bom.jobs.find((row) => row.id === item.job);
      const order = job ? bom.orders.find((row) => row.id === job.orderId) : null;
      // ใบ PI ที่ปิด/ยกเลิกแล้ว หรืองานที่ done แล้ว ไม่ถูกแตะ (เงื่อนไขเดียวกับ rf_unlink_job)
      if (!job || job.externalRef?.woId !== item.woId || !["released", "in_progress"].includes(order?.status) || job.status === "done") continue;
      job.externalRef = null;
      job.reports = [...(job.reports ?? []), { at, by: actor.name, good: 0, reject: 0, note: `WO ${item.woId} ถูกยกเลิก` }];
      touchJob(job);
    }
    // สต็อกของซื้อ (ตรงกับ rf_save_purchase_orders): สร้างใบ = upsert สต็อกขั้นต่ำเมื่อต่างจากที่เก็บ (ไม่มีแถว = 0) · รับบรรทัดของซื้อ = บวกยอด + ประวัติ receive (ref = เลขใบ)
    const stocks = new Set();
    for (const item of ops.stock) {
      const row = bom.stock.find((entry) => entry.itemCode === item.code);
      if (item.kind === "safety") {
        if ((row?.safetyQty ?? 0) === item.qty) continue;
        if (row) { row.safetyQty = item.qty; row.updatedAt = at; } else bom.stock.push({ itemCode: item.code, qty: 0, safetyQty: item.qty, countedAt: null, countedBy: "", updatedAt: at });
      } else {
        const balance = Math.round(((row?.qty ?? 0) + item.qty) * 1e9) / 1e9;
        if (row) { row.qty = balance; row.updatedAt = at; } else bom.stock.push({ itemCode: item.code, qty: balance, safetyQty: 0, countedAt: null, countedBy: "", updatedAt: at });
        const id = bomMoveId(bom.stockMoves);
        bom.stockMoves.push({ id, itemCode: item.code, kind: "receive", qty: item.qty, balance, ref: item.ref, at, by: actor.name, note: null });
        bom.versions.stockMoves[id] = version;
      }
      bom.versions.stock[item.code] = version;
      stocks.add(item.code);
    }
    if (!jobs.size && !orders.size && !stocks.size && !rodLots.size) return;
    bom.version = version;
    const detail = [jobs.size ? `jobs +${jobs.size}` : "", orders.size ? `orders +${orders.size}` : "", rodLots.size ? `rodLots +${rodLots.size}` : "", stocks.size ? `stock +${stocks.size}` : ""].filter(Boolean).join(", ");
    bom.audit = [...bom.audit, { at: iso(at), user: actor.name, action: `rubberflow:${action}`, detail, entries: [] }].slice(-2000);
    bomPersist();
  }
  // ใบ PI ที่ปล่อยผลิต: เปิด WO (planned) ใน RubberFlow ให้งาน RB ที่ผูกสูตรอนุมัติแล้ว · ยกเลิก/เปิดใบกลับมาแก้: ยกเลิก WO แผนก/ปล่อยผลิตที่ผูกงานของใบ
  // ตรงกับ private.bom_open_rf_orders / bom_cancel_rf_orders (ธุรกรรมเดียวกับการบันทึก BOM) · เรียกหลังบันทึก BOM สำเร็จ แก้ next (งานได้ externalRef.auto) และข้อมูล RubberFlow (เวอร์ชัน +1 ครั้งเดียว บันทึกการใช้งาน bom:<action>)
  // คืน { opened: [{jobId, woId, kg}], skipped: [{jobId, itemCode, reason}], cancelled: [woId] }
  function bomRfFollow(next, rfOps, actor, at) {
    const rf = rfLoad();
    const version = rf.version + 1;
    const out = { opened: [], skipped: [], cancelled: [] };
    const audits = [];
    for (const op of rfOps.cancel) {
      let count = 0;
      for (const woId of op.woIds) {
        const wo = rf.orders.find((row) => row.id === woId);
        if (!wo || !RF_WO_STOPPABLE.includes(wo.status)) continue;
        wo.status = "cancelled";
        wo.cancelledAt = at;
        rf.versions.orders[wo.id] = version;
        out.cancelled.push(wo.id);
        count += 1;
      }
      // หนึ่งแถวต่อชนิดต่อคำสั่ง (ตรงกับ app_bom_save_master: ยกเลิกใบ / เปิดใบกลับ / ปิดงาน นับรวมต่อชนิด)
      const same = audits.find((row) => row.action === `bom:${op.action}`);
      if (count && same) same.count += count;
      else if (count) audits.push({ action: `bom:${op.action}`, count });
    }
    const day = new Date(at);
    const key = `WO-${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
    const top = () => rf.orders.reduce((max, row) => { const match = /^WO-(\d{8})-(\d+)$/.exec(String(row.id)); return match && `WO-${match[1]}` === key ? Math.max(max, Number(match[2])) : max; }, 0);
    const start = new Date(at).setHours(0, 0, 0, 0);
    let openedCount = 0;
    for (const orderId of rfOps.release) {
      const pi = next.orders.find((row) => row.id === orderId);
      const jobs = next.jobs.filter((row) => row.orderId === orderId && row.dept === "RB" && !row.externalRef).sort((a, b) => bomCmp(a.id, b.id));
      for (const job of jobs) {
        const item = next.items.find((row) => row.code === job.itemCode);
        const compoundCode = item?.rubber?.compound;
        const compound = compoundCode ? next.compounds.find((row) => row.code === compoundCode) : null;
        const recipe = compound?.recipeId ? rf.recipes.find((row) => row.id === compound.recipeId && row.status === "approved") : null;
        const qty = Math.max(0, Number(job.qtyPlanned) - Number(job.qtyDone || 0));
        // kg = rbJobKg ของหน้า: บรรทัดแรกของ BOM ที่อนุมัติแล้วเป็น kg/g ใช้ปริมาณ + % เผื่อเสียของบรรทัดนั้น ไม่เช่นนั้น kg/เส้น หรือน้ำหนักต่อชิ้น เผื่อ 5%
        const line = next.boms.find((row) => row.itemCode === job.itemCode && row.status === "approved")?.lines?.[0];
        const perKg = { kg: 1, g: 0.001 }[line?.uom];
        let kg = 0;
        if (line && perKg && Number(line.qty) > 0) kg = Math.round(qty * Number(line.qty) * perKg * (1 + (Number(line.scrapPct) || 0) / 100) * 100) / 100;
        else {
          if (item?.uom === "kg") kg = qty;
          else if (item?.rubber?.kgPerRoll) kg = qty * Number(item.rubber.kgPerRoll);
          else if (item?.weightG) kg = qty * Number(item.weightG) / 1000;
          kg = Math.round(kg * 1.05 * 100) / 100;
        }
        // เพดานเท่าคอลัมน์ target_kg / kg_per_unit ของฐานข้อมูล: เกินแล้วข้ามเหมือน SQL
        const reason = !compoundCode ? "ไม่มีรหัสสูตรยาง" : !compound?.recipeId ? "ยังไม่ผูกสูตร RubberFlow" : !recipe ? `สูตร ${compound.recipeId} ยังไม่อนุมัติ` : !(qty > 0) ? "ไม่มียอดให้ผลิต" : !(kg > 0) || kg > 1e9 || kg / qty > 1e9 ? "คำนวณกิโลกรัมไม่ได้" : "";
        if (reason) { out.skipped.push({ jobId: job.id, itemCode: job.itemCode, reason }); continue; }
        const woId = `${key}-${String(top() + 1).padStart(2, "0")}`;
        rf.orders.push({
          id: woId, customer: pi.customer, customerPo: pi.id, recipeId: recipe.id, recipeRevision: recipe.revision, productCode: recipe.productCode ?? "", uom: job.uom,
          color: String(item.rubber?.color ?? "").slice(0, 40).trim() || "ดำ", targetQty: qty, producedQty: 0, startDate: start, dueDate: Math.max(job.dueAt, start), priority: job.dueAt < at ? "urgent" : "normal",
          note: `จาก BOM งาน ${job.id} · PI ${pi.id} · ${job.itemCode} ${qty} ${job.uom} ≈ ${kg} kg · เปิดอัตโนมัติตอนปล่อยใบ`.slice(0, 300),
          status: "planned", sourceJobId: job.id, targetKg: kg, kgPerUnit: Number((kg / qty).toPrecision(12)), createdAt: at, createdBy: actor.name,
        });
        rf.versions.orders[woId] = version;
        job.externalRef = { system: "rubberflow", woId, kg, linkedAt: at, by: actor.name, auto: true }; // งานยัง queued และใบยัง released (ผูกมือเท่านั้นที่ขยับสถานะ)
        out.opened.push({ jobId: job.id, woId, kg });
        openedCount += 1;
      }
    }
    if (openedCount) audits.push({ action: "bom:releaseOrder", count: openedCount });
    if (audits.length) {
      rf.version = version;
      for (const row of audits) rf.audit.push({ at: iso(at), user: actor.name, action: row.action, detail: `orders +${row.count}`, entries: [] });
      rf.audit = rf.audit.slice(-2000);
      rfPersist();
    }
    return out;
  }
  // ---- ขั้นของ NCR (สถานการณ์ ?ncr=1): สถานะ กำหนด และสิทธิ์ตาม app_ncr_* ล่าสุดใน supabase/migrations (หลวมกว่าเรื่องการตรวจข้อความ) ----
  const roleOf = (person) => roles.find((row) => row.id === person.role_id)?.code ?? "";
  const ncrIsQa = (person) => deptCode(person.department_id) === "QA";
  const ncrIsManager = (person) => ["department_manager", "assistant_department_manager"].includes(roleOf(person));
  const ncrCanRespond = (row, person) => (roleOf(person) === "staff" || ncrIsManager(person))
    && row.ncr_responsibilities.some((item) => item.department_id === person.department_id && (!item.responder_id || item.responder_id === person.id));
  const ncrSigner = (row) => (!row.signoff_qa_at ? "qa" : !row.signoff_factory_at ? "factory" : "gm");
  const ncrCanSign = (row, person) => ({ qa: ncrIsQa(person) && ncrIsManager(person), factory: roleOf(person) === "factory_manager", gm: roleOf(person) === "general_manager" })[ncrSigner(row)];
  function ncrStep(id, { from, allowed, next, action, note = null, change = () => {} }) {
    if (!ncr) fail("NOT_AUTHORIZED");
    const row = db.ncr_reports.find((item) => item.id === id) ?? fail("NCR_NOT_FOUND");
    if (!from.includes(row.status)) fail("INVALID_TRANSITION");
    if (!allowed(row)) fail("NOT_AUTHORIZED");
    const previous = row.status;
    change(row);
    row.status = next ?? row.status;
    row.updated_at = stamp();
    if (next) db.ncr_status_history.push({ id: db.ncr_status_history.length + 1, ncr_id: row.id, from_status: previous, to_status: row.status, action, note: String(note ?? "").trim() || null, changed_by: ME_ID, changed_at: row.updated_at });
    ncrPersist();
    return row.id;
  }
  const NCR_RPC = {
    app_ncr_issue(args) {
      if (!ncr) fail("NOT_AUTHORIZED");
      const defect = NCR_DEFECT_TYPES.find((row) => row.code === args.p_defect_type_code) ?? fail("INVALID_DEFECT_TYPE");
      const issue_date = bangkokDate(now());
      const id = `ncr-new-${++ncrSeq}`;
      const ncr_no = `QA${String(ncrSeq - 39).padStart(3, "0")}/26`;
      db.ncr_reports.push({
        ...ncrSeed().ncr_reports[0], id, ncr_no, status: "awaiting_disposition", reporter_id: ME_ID, reporter_department_id: ME.department_id, reporter_department: { code: deptCode(ME.department_id) },
        issue_date, response_due: addDays(issue_date, 5), product_name: args.p_product_name, product_code: args.p_product_code ?? null, customer_name: args.p_customer_name ?? null,
        po_no: args.p_po_no ?? null, lot_no: args.p_lot_no ?? null, unit: args.p_unit, source: args.p_source, qty_total: args.p_qty_total, qty_sampled: args.p_qty_sampled ?? null,
        qty_defect: args.p_qty_defect, qty_returned: args.p_qty_returned ?? null, defect_type_id: defect.id, defect_type: { name_th: defect.name_th }, description: args.p_description,
        created_at: stamp(), updated_at: stamp(),
      });
      db.ncr_status_history.push({ id: db.ncr_status_history.length + 1, ncr_id: id, from_status: null, to_status: "awaiting_disposition", action: "issue", note: null, changed_by: ME_ID, changed_at: stamp() });
      ncrPersist();
      return { id, ncr_no };
    },
    app_ncr_dispose: ({ p_ncr_id, p_dispositions, p_department_ids, p_note, p_responder_ids = [] }) => ncrStep(p_ncr_id, {
      from: ["awaiting_disposition"], allowed: () => roleOf(ME) === "factory_manager", next: "awaiting_response", action: "dispose", note: p_note,
      change(row) {
        if (!(p_dispositions ?? []).length) fail("INVALID_DISPOSITION");
        const ids = [...new Set(p_department_ids ?? [])];
        if (!ids.length) fail("INVALID_RESPONSIBILITIES");
        const share = Math.round(10000 / ids.length) / 10000;
        row.ncr_responsibilities = ids.map((departmentId, index) => responsibility(departmentId,
          (p_responder_ids ?? []).find((responderId) => employees.find((person) => person.id === responderId)?.department_id === departmentId) ?? null,
          index === ids.length - 1 ? Math.round((1 - share * (ids.length - 1)) * 10000) / 10000 : share));
        Object.assign(row, { dispositions: p_dispositions, disposition_note: String(p_note ?? "").trim() || null, disposed_by: ME_ID, disposed_at: stamp() });
      },
    }),
    app_ncr_assign_responder: ({ p_ncr_id, p_department_id, p_responder_id }) => ncrStep(p_ncr_id, {
      from: ["awaiting_response", "awaiting_followup", "awaiting_info"], allowed: () => roleOf(ME) === "factory_manager",
      change(row) {
        const item = row.ncr_responsibilities.find((entry) => entry.department_id === p_department_id) ?? fail("INVALID_RESPONDER");
        item.responder_id = p_responder_id || null;
      },
    }),
    app_ncr_respond: ({ p_ncr_id, p_causes, p_root_cause, p_correction, p_prevention }) => ncrStep(p_ncr_id, {
      from: ["awaiting_response"], allowed: (row) => ncrCanRespond(row, ME), next: "awaiting_followup", action: "respond",
      change(row) {
        if (!(p_causes ?? []).length) fail("INVALID_CAUSES");
        if (!String(p_root_cause ?? "").trim()) fail("INVALID_ROOT_CAUSE");
        if (!String(p_correction ?? "").trim()) fail("INVALID_CORRECTION");
        const prevention = String(p_prevention ?? "").trim() || null;
        if (prevention && prevention.length < 5) fail("INVALID_PREVENTION");
        Object.assign(row, { causes: p_causes, root_cause: p_root_cause.trim(), correction: p_correction.trim(), correction_due: row.response_due, prevention: prevention ?? row.prevention,
          prevention_due: addDays(row.response_due, 7), responded_by: ME_ID, responded_at: stamp() });
      },
    }),
    app_ncr_submit_prevention: ({ p_ncr_id, p_prevention }) => ncrStep(p_ncr_id, {
      from: ["awaiting_followup"], allowed: (row) => ncrCanRespond(row, ME),
      change(row) {
        if (row.prevention) fail("NCR_PREVENTION_ALREADY_SUBMITTED");
        if (String(p_prevention ?? "").trim().length < 5) fail("INVALID_PREVENTION");
        row.prevention = p_prevention.trim();
      },
    }),
    app_ncr_followup: ({ p_ncr_id, p_result, p_note }) => ncrStep(p_ncr_id, {
      from: ["awaiting_followup"], allowed: () => ncrIsQa(ME), next: p_result === "close" ? "awaiting_signoff" : "awaiting_response", action: `followup_${p_result}`, note: p_note,
      change(row) {
        if (!["close", "return"].includes(p_result)) fail("INVALID_FOLLOWUP_RESULT");
        if (p_result === "return" && String(p_note ?? "").trim().length < 3) fail("NCR_RETURN_NOTE_REQUIRED");
        if (p_result === "close" && !row.prevention) fail("NCR_PREVENTION_REQUIRED");
        Object.assign(row, { followup_note: String(p_note ?? "").trim() || null, followed_up_by: ME_ID, followed_up_at: stamp() });
        if (p_result === "return") row.response_due = addDays(bangkokDate(now()), 5);
      },
    }),
    app_ncr_signoff: ({ p_ncr_id }) => {
      const row = db.ncr_reports.find((item) => item.id === p_ncr_id);
      const last = row && row.status === "awaiting_signoff" && ncrSigner(row) === "gm";
      return ncrStep(p_ncr_id, {
        from: ["awaiting_signoff"], allowed: (current) => ncrCanSign(current, ME), next: last ? "closed" : "awaiting_signoff", action: `signoff_${row ? ncrSigner(row) : "qa"}`,
        change(current) {
          const step = ncrSigner(current);
          Object.assign(current, { [`signoff_${step}_by`]: ME_ID, [`signoff_${step}_at`]: stamp() });
          if (step === "gm") current.closed_at = stamp();
        },
      });
    },
    app_ncr_request_info: ({ p_ncr_id, p_note }) => ncrStep(p_ncr_id, {
      from: ["awaiting_signoff"], allowed: (row) => ncrCanSign(row, ME), next: "awaiting_info", action: "request_info", note: p_note,
      change(row) {
        if (String(p_note ?? "").trim().length < 5) fail("INVALID_INFO_REQUEST");
        db.ncr_info_requests.push({ id: `info-${db.ncr_info_requests.length + 1}`, ncr_id: row.id, step: ncrSigner(row), request_note: p_note.trim(), requested_by: ME_ID, requested_at: stamp(), answer_note: null, answered_by: null, answered_at: null });
      },
    }),
    app_ncr_answer_info: ({ p_ncr_id, p_note }) => ncrStep(p_ncr_id, {
      from: ["awaiting_info"], allowed: (row) => ncrCanRespond(row, ME), next: "awaiting_signoff", action: "answer_info", note: p_note,
      change(row) {
        if (String(p_note ?? "").trim().length < 5) fail("INVALID_INFO_ANSWER");
        const open = db.ncr_info_requests.find((item) => item.ncr_id === row.id && !item.answered_at);
        if (open) Object.assign(open, { answer_note: p_note.trim(), answered_by: ME_ID, answered_at: stamp() });
      },
    }),
    app_ncr_cancel: ({ p_ncr_id, p_reason }) => ncrStep(p_ncr_id, {
      from: ["awaiting_disposition", "awaiting_response", "awaiting_followup", "awaiting_signoff", "awaiting_info"], allowed: () => ncrIsQa(ME) && ncrIsManager(ME), next: "cancelled", action: "cancel", note: p_reason,
      change(row) {
        if (String(p_reason ?? "").trim().length < 5) fail("INVALID_REASON");
        Object.assign(row, { cancelled_by: ME_ID, cancelled_at: stamp(), cancel_reason: p_reason.trim() });
      },
    }),
  };

  // บัญชี master: บันทึกข้อผิดพลาดที่หน้าเว็บส่งมา (เก็บในหน่วยความจำ) และบันทึกกิจกรรมตัวอย่าง
  // ฐานข้อมูลจริงซ่อนค่ารหัสผ่านก่อนส่ง (private.redact_secrets) ตัวอย่างจึงมีค่า "[ซ่อน]" แทน
  const clientErrors = [
    { kind: "rpc", code: "STEP_NOT_CURRENT", message: "STEP_NOT_CURRENT", page: "request", detail: null, employee: "e5", days: 0.2 },
    { kind: "network", code: "", message: "Failed to fetch", page: "dashboard", detail: null, employee: "e2", days: 0.5 },
    { kind: "js", code: "", message: "Cannot read properties of undefined (reading 'code')", page: "ncr", detail: "TypeError: Cannot read properties of undefined (reading 'code')\n    at renderNcrDetail (module-ncr.js:812:31)", employee: "e3", days: 1.2 },
    { kind: "rpc", code: "STEP_NOT_CURRENT", message: "STEP_NOT_CURRENT", page: "request", detail: null, employee: "e7", days: 2 },
  ].map((item, index) => ({
    id: index + 1, created_at: ago(item.days), employee_id: item.employee, kind: item.kind, code: item.code || null, message: item.message,
    page: item.page, detail: item.detail, app_version: "harness", user_agent: "Mozilla/5.0 (harness)", is_sandbox: false,
  }));
  const auditLogs = [
    { actor: "e5", action: "UPDATE", entity_type: "requests", entity_id: "r-1", label: `MT-${YEAR}-0012`, request: "r-1", days: 0.1, changes: { status: { old: "pending_approval", new: "approved" }, current_step: { old: 1, new: 0 } } },
    { actor: "e1", action: "SANDBOX_ENTER", entity_type: "sandbox_session", entity_id: null, label: "P-QA01", days: 0.3, changes: { persona_employee_no: "P-QA01" } },
    { actor: "e7", action: "REVEAL_CREDENTIAL", entity_type: "account_credentials", entity_id: "e3", label: "E022", days: 0.8, changes: { employee_no: "E022" } },
    { actor: "e7", action: "UPDATE", entity_type: "account_credentials", entity_id: "e3", label: null, days: 0.9, changes: { password: { old: "[ซ่อน]", new: "[ซ่อน]" }, username: { old: "E22", new: "E022" } } },
    { actor: "e3", action: "INSERT", entity_type: "ncr_reports", entity_id: "n-1", label: `NCR-${YEAR}-0003`, days: 1.5, changes: { ncr_no: `NCR-${YEAR}-0003`, status: "awaiting_disposition", part_no: "RB-2201" } },
  ].map((item, index, list) => ({
    id: list.length - index, created_at: ago(item.days), actor_id: item.actor, action: item.action, entity_type: item.entity_type,
    entity_id: item.entity_id, entity_label: item.label, request_id: item.request ?? null, changes: item.changes,
  }));
  const requireMaster = () => { if (!master) fail("NOT_AUTHORIZED"); };
  const personNo = (id) => employees.find((row) => row.id === id)?.employee_no ?? null;
  const inRange = (createdAt, from, to) => (!from || createdAt.slice(0, 10) >= from) && (!to || createdAt.slice(0, 10) <= to);
  const page = (rows, beforeId, limit) => rows
    .filter((row) => beforeId === null || beforeId === undefined || row.id < beforeId)
    .sort((a, b) => b.id - a.id)
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 200));
  const MASTER_RPC = {
    app_am_i_master: () => master,
    app_log_client_error(args) {
      clientErrors.push({
        id: clientErrors.length + 1, created_at: stamp(), employee_id: ME_ID, kind: args.p_kind, code: args.p_code ?? null, message: args.p_message,
        page: args.p_page ?? null, detail: args.p_detail ?? null, app_version: args.p_app_version ?? null, user_agent: args.p_user_agent ?? null, is_sandbox: Boolean(args.p_is_sandbox),
      });
    },
    app_master_client_errors({ p_before_id = null, p_limit = 100, p_kind = null, p_employee_id = null } = {}) {
      requireMaster();
      return page(clientErrors.filter((row) => (!p_kind || row.kind === p_kind) && (!p_employee_id || row.employee_id === p_employee_id)), p_before_id, p_limit)
        .map((row) => ({ ...row, employee_no: personNo(row.employee_id), employee_name: personName(row.employee_id) }));
    },
    app_master_client_error_summary({ p_days = 7 } = {}) {
      requireMaster();
      const since = iso(now() - Number(p_days) * DAY);
      const groups = new Map();
      for (const row of clientErrors.filter((item) => item.created_at > since)) {
        const key = `${row.kind}|${row.code}|${row.message}`;
        const group = groups.get(key) ?? { kind: row.kind, code: row.code, message: row.message, occurrences: 0, people: new Set(), pages: new Set(), first_at: row.created_at, last_at: row.created_at };
        group.occurrences += 1;
        group.people.add(row.employee_id);
        if (row.page) group.pages.add(row.page);
        if (row.created_at < group.first_at) group.first_at = row.created_at;
        if (row.created_at > group.last_at) group.last_at = row.created_at;
        groups.set(key, group);
      }
      return [...groups.values()].sort((a, b) => b.occurrences - a.occurrences || b.last_at.localeCompare(a.last_at))
        .map((group) => ({ ...group, people: group.people.size, pages: [...group.pages].slice(0, 5) }));
    },
    app_master_activity_log({ p_before_id = null, p_limit = 100, p_actor_id = null, p_entity_type = null, p_from = null, p_to = null } = {}) {
      requireMaster();
      return page(auditLogs.filter((row) => (!p_actor_id || row.actor_id === p_actor_id) && (!p_entity_type || row.entity_type === p_entity_type)
        && inRange(row.created_at, p_from, p_to)), p_before_id, p_limit)
        .map((row) => ({ ...row, actor_no: personNo(row.actor_id), actor_name: personName(row.actor_id) }));
    },
    // งานค้างทั้งบริษัท: ประมาณจากคำร้องจำลอง (ผู้ทำตามสถานะ) กติกาจริงอยู่ที่ private.pending_work_items
    // ใบที่ผู้ทำไม่อยู่ในรายชื่อพนักงานจำลองได้ holders ว่าง (หน้าเว็บแสดง "ไม่มีผู้รับผิดชอบ") เหมือนฐานข้อมูลจริง
    app_master_pending_work() {
      requireMaster();
      const ACTIONS = { pending_approval: "พิจารณาอนุมัติ", more_info: "ส่งข้อมูลเพิ่มเติมที่ผู้อนุมัติขอ", pending_assign: "มอบหมายช่าง", assigned: "เริ่มงานซ่อม", pending_verify: "ตรวจรับผลการซ่อม" };
      const today = new Date(now()).toISOString().slice(0, 10);
      return db.requests.filter((request) => Object.hasOwn(ACTIONS, request.status)).map((request) => {
        const step = db.approval_steps.find((item) => item.request_id === request.id && item.step_order === request.current_step && item.status === "pending");
        const holderId = { pending_approval: step?.approver_employee_id, more_info: request.requester_id, pending_assign: "e1", assigned: request.assignee_id, pending_verify: request.requester_id }[request.status];
        const person = employees.find((row) => row.id === holderId && row.is_active);
        const type = request_types.find((row) => row.id === request.request_type_id);
        const since = request.updated_at ?? request.created_at;
        return {
          item_type: "request", item_id: request.id, doc_no: request.request_no, doc_label: type?.name_th ?? null, title: request.title, status: request.status,
          action: ACTIONS[request.status], waiting_since: since,
          days_waiting: Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since.slice(0, 10)}T00:00:00Z`)) / DAY)),
          due_date: request.status === "assigned" ? request.work_expected_date ?? null : null, is_urgent: Boolean(request.is_urgent),
          holders: person ? [{ id: person.id, employee_no: person.employee_no, name: personName(person.id), department: departments.find((row) => row.id === person.department_id)?.code ?? null }] : [],
        };
      }).sort((a, b) => a.waiting_since.localeCompare(b.waiting_since));
    },
    app_master_activity_facets() {
      requireMaster();
      const count = (key) => auditLogs.reduce((map, row) => map.set(row[key], (map.get(row[key]) ?? 0) + 1), new Map());
      return {
        entity_types: [...count("entity_type")].map(([entity_type, total]) => ({ entity_type, count: total })),
        actors: [...count("actor_id")].map(([id, total]) => ({ id, employee_no: personNo(id), name: personName(id), count: total })),
      };
    },
  };

  // MNP LAB · รายงานทดสอบ MDR (20261215010000_lab_mdr_tests.sql) — ผลอยู่ในหน่วยความจำของหน้า หายเมื่อโหลดใหม่
  // ผลตั้งต้น = globalThis.MNP_HARNESS_MDR_SEED ที่ scripts/pilot-harness.mjs อ่านจากโฟลเดอร์ .ini ใน MDR_SAMPLE_DIR (ไม่ตั้ง = ว่าง ลองอัปโหลดเองได้)
  // ตรวจเหมือนฐานข้อมูลเท่าที่หน้าจอต้องเห็น: ชื่อลงท้าย F1/F2, ไม่เกิน 25 รายการต่อครั้ง, ซ้ำ (ชื่อ + วันที่ + เวลา + ID) ไม่เขียนทับ
  let mdrRows = null;
  let mdrSeq = 0;
  const mdrKey = (test) => [String(test.name ?? "").trim(), test.test_date, test.test_time, test.machine_id].join("|");
  function mdrAdd(test) {
    const key = mdrKey(test);
    if (mdrRows.some((row) => row.key === key)) return false;
    const name = String(test.name).trim();
    mdrRows.push({ ...clone(test), key, id: ++mdrSeq, name, formula: name.slice(0, -2), part: name.slice(-2) });
    return true;
  }
  function mdrTests() {
    if (!mdrRows) {
      mdrRows = [];
      for (const test of globalThis.MNP_HARNESS_MDR_SEED ?? []) mdrAdd(test);
    }
    return mdrRows;
  }
  const MDR_RPC = {
    app_lab_mdr_upload({ p_tests }) {
      mdrTests();
      if (!Array.isArray(p_tests) || p_tests.length < 1 || p_tests.length > 25) fail("LAB_MDR_INVALID_PAYLOAD");
      p_tests.forEach((test, index) => {
        const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}F[12]$/.test(String(test?.name ?? "").trim()) && Number.isFinite(test.ml) && Number.isFinite(test.mh) && test.mh >= test.ml
          && (String(test.name).trim().endsWith("F2") || (Array.isArray(test.curve) && test.curve.length >= 10 && test.curve.length <= 7201));
        if (!valid) throw Object.assign(new Error("LAB_MDR_INVALID_TEST"), { code: "LAB_MDR_INVALID_TEST", details: String(index + 1) });
      });
      const inserted = p_tests.filter((test) => mdrAdd(test)).length;
      return { received: p_tests.length, inserted, duplicates: p_tests.length - inserted };
    },
    app_lab_mdr_feed({ p_part, p_formula = null, p_date = null }) {
      if (!["F1", "F2"].includes(p_part)) fail("LAB_MDR_INVALID_PART");
      const rows = mdrTests().filter((row) => row.part === p_part);
      const byFormula = new Map();
      for (const row of rows) {
        if (!byFormula.has(row.formula)) byFormula.set(row.formula, []);
        byFormula.get(row.formula).push(row);
      }
      const formulas = [...byFormula].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([formula, items]) => {
        const dates = items.map((item) => item.test_date).sort();
        return { formula, tests: items.length, days: new Set(dates).size, first_date: dates[0], last_date: dates.at(-1) };
      });
      const mine = p_formula ? (byFormula.get(String(p_formula).trim()) ?? []) : [];
      const dates = mine.map((row) => row.test_date).sort();
      const curveDate = mine.length ? (dates.includes(p_date) ? p_date : dates.at(-1)) : null;
      const order = (a, b) => (a.test_time < b.test_time ? -1 : a.test_time > b.test_time ? 1 : a.machine_id < b.machine_id ? -1 : 1);
      const tests = [...mine].sort((a, b) => (a.test_date !== b.test_date ? (a.test_date < b.test_date ? 1 : -1) : order(a, b)))
        .map(({ id, machine_id, test_date, test_time, temperature_c, set_minutes, ml, mh, ts1_s, ts2_s, t50_s, t90_s, vc1, vc2, result }) => ({ id, machine_id, test_date, test_time, temperature_c, set_minutes, ml, mh, ts1_s, ts2_s, t50_s, t90_s, vc1, vc2, result }));
      const curves = mine.filter((row) => row.test_date === curveDate && Array.isArray(row.curve)).sort(order).map((row) => ({ id: row.id, curve: row.curve }));
      return { formulas, tests, curve_date: curveDate, curves };
    },
    // กราฟหลายวัน (20261217010000_lab_mdr_curves.sql): วันเดียว = ทุกวินาที หลายวัน = ทุก 5 วินาที ไม่เกิน 1,000 กราฟ (ตัดวันเก่าทั้งวัน)
    app_lab_mdr_curves({ p_part, p_formula, p_from, p_to }) {
      if (!["F1", "F2"].includes(p_part)) fail("LAB_MDR_INVALID_PART");
      const formula = String(p_formula ?? "").trim();
      if (!formula || formula.length > 40) fail("LAB_MDR_INVALID_FORMULA");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p_from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(p_to)) || p_from > p_to) fail("LAB_MDR_INVALID_RANGE");
      const step = p_from === p_to ? 1 : 5;
      const rows = mdrTests().filter((row) => row.part === p_part && row.formula === formula && row.test_date >= p_from && row.test_date <= p_to && Array.isArray(row.curve));
      const dates = [...new Set(rows.map((row) => row.test_date))].sort().reverse();
      const kept = [];
      let total = 0;
      for (const date of dates) {
        const n = rows.filter((row) => row.test_date === date).length;
        if (kept.length && total + n > 1000) break;
        kept.unshift(date);
        total += n;
      }
      const order = (a, b) => (a.test_date !== b.test_date ? (a.test_date < b.test_date ? -1 : 1) : a.test_time < b.test_time ? -1 : a.test_time > b.test_time ? 1 : a.machine_id < b.machine_id ? -1 : 1);
      const curves = rows.filter((row) => kept.includes(row.test_date)).sort(order).slice(-1000)
        .map((row) => ({ id: row.id, test_date: row.test_date, curve: step === 1 ? row.curve : row.curve.filter((_, index) => index % step === 0) }));
      return { step, from: kept[0] ?? null, to: kept.at(-1) ?? null, truncated: kept.length < dates.length, curves };
    },
  };

  const RPC = {
    ...(itwoMock ? itwoMock.handlers : {}),
    ...MDR_RPC,
    ...NCR_RPC,
    app_my_approval_modules: () => request_types.map(({ code }) => ({ code })),
    app_lab_access: () => false,
    app_lab_only: () => false,
    ...MASTER_RPC,
    // ใช้ได้ทั้งโหมดทดสอบและใช้งานจริง (20261130010000) ข้อมูลของแต่ละโหมดแยกกัน (BOM_KEY)
    app_bom_master() {
      requireActor("BOM_FORBIDDEN");
      return bomView(bomLoad());
    },
    app_bom_master_since({ p_version }) {
      requireActor("BOM_FORBIDDEN");
      const current = bomLoad();
      if (!Number.isInteger(p_version) || p_version < 0 || p_version > current.version) fail("BOM_INVALID_PAYLOAD");
      return bomDelta(current, p_version);
    },
    app_bom_save_master({ p_changes, p_base_version, p_action, p_audit, p_epoch }) {
      const actor = requireActor("BOM_FORBIDDEN");
      // ด่านหยาบ (ลำดับเดียวกับ app_bom_save_master): คนนอกกลุ่มวางแผน (private.bom_can_edit = bomIsPlanner) กับ action ที่ไม่ใช่ของพนักงาน = BOM_FORBIDDEN
      // แล้ว action ที่ไม่อยู่ในรายการของ client = BOM_INVALID_ACTION (กลุ่มวางแผนส่ง completeOrder จึงได้ BOM_INVALID_ACTION)
      if (!bomIsPlanner(actor) && !BOM_STAFF_ACTIONS.includes(p_action)) fail("BOM_FORBIDDEN");
      if (!BOM_CLIENT_ACTIONS.includes(p_action)) fail("BOM_INVALID_ACTION");
      const current = bomLoad();
      // ลำดับเดียวกับฐานข้อมูล (20261122010000): รูป payload ทั้งหมด (รวมคำขอสำเร็จรูปที่ว่าง) ก่อน แล้วรอบข้อมูล (BOM_RESET) แล้วเวอร์ชันฐานที่สูงเกิน
      // (เดิมตรวจรอบข้อมูลและเวอร์ชันฐานก่อนรูป: คำขอสำเร็จรูปว่างที่รอบเก่าหรือฐานสูงเกินได้ BOM_RESET / BOM_INVALID_PAYLOAD แทน BOM_INVALID_FG, upsert ที่ไม่ใช่อาร์เรย์ได้ BOM_INVALID_FG แทน BOM_INVALID_PAYLOAD)
      if (!p_changes || typeof p_changes !== "object" || Array.isArray(p_changes)) fail("BOM_INVALID_CHANGES");
      if (!Number.isInteger(p_base_version) || p_base_version < 0) fail("BOM_INVALID_PAYLOAD");
      bomCheckShape(p_changes, p_action);
      // client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (null / ไม่ส่ง = ไม่ตรวจ)
      if (p_epoch !== undefined && p_epoch !== null && p_epoch !== current.epoch) fail("BOM_RESET");
      if (p_base_version > current.version) fail("BOM_INVALID_PAYLOAD");
      // บันทึกการใช้งานของคำสั่งนี้ [{action, detail}] ไม่เกิน 20 รายการ ชื่อไม่เกิน 80 รายละเอียดไม่เกิน 300 ตัวอักษร
      const auditIn = p_audit === undefined || p_audit === null ? [] : p_audit;
      if (!Array.isArray(auditIn) || auditIn.length > 20 || auditIn.some((entry) => !entry || typeof entry.action !== "string" || !entry.action || entry.action.length > 80 || typeof entry.detail !== "string" || entry.detail.length > 300)) fail("BOM_INVALID_AUDIT");
      const at = now();
      const rfOps = { release: [], cancel: [] };
      const meta = {};
      const next = bomApply(current, p_changes, p_base_version, actor, at, rfOps, p_action, meta);
      // ไม่มีการเปลี่ยนแปลงเลย = ไม่เพิ่มเวอร์ชัน (เหมือน RPC จริง) คืนส่วนต่างตั้งแต่ base
      const touched = [...BOM_LISTS, "partReturns"].some((list) => (p_changes[list]?.upsert?.length ?? 0) + (p_changes[list]?.delete?.length ?? 0) > 0);
      if (!touched) return bomDelta(current, p_base_version);
      next.version = current.version + 1;
      // บรรทัดหลัก = ชื่อ action และจำนวนระเบียนต่อส่วนที่เซิร์ฟเวอร์บันทึกเอง (เหมือน app_bom_audit) · entries = ข้อความของ client เป็นหมายเหตุรอง
      // issueOrderParts: จำนวนแถวสต็อกที่หักนับรวมใน stock (ตรงกับ v_counts ของ app_bom_save_master)
      // สำเร็จรูป: fgMoves = จำนวนแถวประวัติที่เขียน (รับ/ส่งมอบ = จำนวนสินค้า ปิดใบ = 1) และ orders +1 เมื่อใบถูกปิด (ปิดเองเมื่อรับครบ หรือปิดรับไม่ครบ)
      const counted = { ...Object.fromEntries(Object.keys(p_changes).map((key) => [key, [p_changes[key]?.upsert?.length ?? 0, p_changes[key]?.delete?.length ?? 0]])), ...(meta.issued || meta.returned ? { stock: [meta.issued || meta.returned, 0] } : {}),
        ...(meta.fg ? { fgMoves: [meta.fg.moves, 0], ...(meta.fg.closed || meta.fg.reopened ? { orders: [1, 0] } : {}) } : {}),
        // โอนสต็อกสินค้าสำเร็จรูปตอนปล่อยผลิต / คืนตอนยกเลิกหรือเปิดใบกลับมาแก้: นับเป็น fgMoves upsert (ไม่เพิ่ม orders เพราะใบอยู่ในคำสั่งอยู่แล้ว)
        ...(meta.fgStockMoves ? { fgMoves: [meta.fgStockMoves, 0] } : {}),
        // คลังแท่งยาว: rodMoves = จำนวนแถวประวัติที่เขียน (รับเข้า / จ่าย / ย้อน / ปรับ / ย้ายตอนปล่อยผลิตหรือเปิดใบกลับ) · jobs +1 เมื่อรับเข้านับเข้างาน RB
        ...(meta.rod ? { ...(meta.rod.lots ? { rodLots: [meta.rod.lots, 0] } : { rodLots: [0, 0] }), rodMoves: [meta.rod.moves, 0], ...(meta.rod.job ? { jobs: [1, 0] } : {}) } : {}),
        ...(meta.rodMoves ? { rodMoves: [meta.rodMoves, 0] } : {}),
        ...(meta.gr?.jobs ? { jobs: [meta.gr.jobs, 0] } : {}), ...(meta.gr?.orders ? { orders: [meta.gr.orders, 0] } : {}) };
      const counts = Object.keys(counted).sort().map((key) => {
        const [up, del] = counted[key];
        return up || del ? `${key}${up ? ` +${up}` : ""}${del ? ` -${del}` : ""}` : "";
      }).filter(Boolean).join(", ");
      const rubberflow = bomRfFollow(next, rfOps, actor, at);
      const row = { at: iso(at), user: actor.name, action: p_action, detail: counts, entries: auditIn.map((entry) => ({ action: entry.action, detail: entry.detail })) };
      const tally = { opened: rubberflow.opened.length, skipped: rubberflow.skipped.length, cancelled: rubberflow.cancelled.length };
      const touchedRf = tally.opened + tally.skipped + tally.cancelled > 0;
      if (touchedRf) row.rubberflow = tally;
      next.audit = [...next.audit, row].slice(-2000);
      bomMaster = next;
      bomPersist();
      const delta = bomDelta(bomMaster, p_base_version);
      // เฉพาะเมื่อมีอะไรเกิดขึ้นกับ WO (เปิด / ข้าม / ยกเลิก) · ไม่มี = รูปคำตอบเดิม
      return touchedRf ? { ...delta, rubberflow } : delta;
    },
    // บันทึกการใช้งาน: ใหม่สุดก่อน (ตรงกับ app_bom_audit) ทุกบัญชีทดสอบอ่านได้
    app_bom_audit({ p_limit } = {}) {
      requireActor("BOM_FORBIDDEN");
      const limit = p_limit === undefined || p_limit === null ? 200 : p_limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail("BOM_INVALID_PAYLOAD");
      return [...bomLoad().audit].reverse().slice(0, limit);
    },
    // ล้างข้อมูล BOM ทดสอบทั้งหมด: เฉพาะ admin ตัวจริง (ผู้ใช้จำลอง ไม่ใช่บัญชีทดสอบที่ทำหน้าที่อยู่) ในโหมดทดสอบ · เวอร์ชันกลับเป็น 0 และมีบันทึกการล้างหนึ่งแถว
    // ลำดับเดียวกับ app_sandbox_purge_bom: ไม่ใช่ admin ตัวจริง = NOT_AUTHORIZED · admin ที่ไม่ได้อยู่ในโหมดทดสอบ = SANDBOX_NOT_ACTIVE (ข้อมูลจริงล้างไม่ได้)
    app_sandbox_purge_bom() {
      if (roles.find((row) => row.id === ME.role_id)?.code !== "admin") fail("NOT_AUTHORIZED");
      if (!sandbox) fail("SANDBOX_NOT_ACTIVE");
      const current = bomLoad();
      const deleted = BOM_LISTS.reduce((sum, list) => sum + current[list].length, 0);
      const { version, audit } = current;
      bomMaster = freshBom();
      bomMaster.version = version; // ตัวนับไม่ถูกตั้งกลับ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
      bomMaster.audit = [...audit, { at: iso(now()), user: bomActor().name, action: "ล้างข้อมูล BOM ทดสอบ", detail: `ลบ ${deleted} แถว`, entries: [] }];
      bomPersist();
      return { deleted };
    },
    app_rf_master() {
      requireActor("RF_FORBIDDEN");
      return rfView(rfLoad());
    },
    app_rf_master_since({ p_version }) {
      requireActor("RF_FORBIDDEN");
      const current = rfLoad();
      if (!Number.isInteger(p_version) || p_version < 0 || p_version > current.version) fail("RF_INVALID_PAYLOAD");
      return rfDelta(current, p_version);
    },
    app_rf_save({ p_changes, p_base_version, p_action, p_audit, p_epoch }) {
      const actor = requireActor("RF_FORBIDDEN");
      const current = rfLoad();
      // client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (null / ไม่ส่ง = ไม่ตรวจ)
      if (p_epoch !== undefined && p_epoch !== null && p_epoch !== current.epoch) fail("RF_RESET");
      if (typeof p_action !== "string" || !RF_ACTIONS.includes(p_action)) fail("RF_INVALID_ACTION");
      if (!p_changes || typeof p_changes !== "object" || Array.isArray(p_changes)) fail("RF_INVALID_PAYLOAD");
      if (!Number.isInteger(p_base_version) || p_base_version < 0 || p_base_version > current.version) fail("RF_INVALID_PAYLOAD");
      const auditIn = p_audit === undefined || p_audit === null ? [] : p_audit;
      if (!Array.isArray(auditIn) || auditIn.length > 20 || auditIn.some((entry) => !entry || typeof entry.action !== "string" || !entry.action || entry.action.length > 80 || typeof entry.detail !== "string" || entry.detail.length > 300)) fail("RF_INVALID_PAYLOAD");
      const at = now();
      const { next, ops, wrote } = rfApply(current, p_changes, p_base_version, actor, at, p_action);
      // ไม่มีระเบียนไหนเปลี่ยนจริง (ทุกเรคอร์ดตรงกับที่เก็บ) = ไม่เพิ่มเวอร์ชัน ไม่เขียน audit คืนส่วนต่างตั้งแต่ base (เหมือน RPC จริง)
      if (!wrote) return rfDelta(current, p_base_version);
      next.version = current.version + 1;
      const counts = Object.keys(p_changes).sort().map((key) => { const up = p_changes[key]?.upsert?.length ?? 0; return up ? `${key} +${up}` : ""; }).filter(Boolean).join(", ");
      next.audit = [...next.audit, { at: iso(at), user: actor.name, action: p_action, detail: counts, entries: auditIn.map((entry) => ({ action: entry.action, detail: entry.detail })) }].slice(-2000);
      rfMaster = next;
      rfPersist();
      rfApplyBomOps(ops, actor, at, p_action);
      return rfDelta(rfMaster, p_base_version);
    },
    app_rf_audit({ p_limit } = {}) {
      requireActor("RF_FORBIDDEN");
      const limit = p_limit === undefined || p_limit === null ? 200 : p_limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail("RF_INVALID_PAYLOAD");
      return [...rfLoad().audit].reverse().slice(0, limit);
    },
    // ล้างข้อมูล RubberFlow ทดสอบ: เฉพาะ admin ตัวจริง · เวอร์ชันไม่ถูกตั้งกลับ epoch ใหม่ · งาน BOM ที่ผูก WO เดิมไว้ไม่ถูกแตะ
    app_sandbox_purge_rf() {
      // admin จริงเท่านั้น (NOT_AUTHORIZED) ที่อยู่ในโหมดทดสอบ (SANDBOX_NOT_ACTIVE) ตรงกับ app_sandbox_purge_rf
      if (roles.find((row) => row.id === ME.role_id)?.code !== "admin") fail("NOT_AUTHORIZED");
      if (!sandbox) fail("SANDBOX_NOT_ACTIVE");
      const current = rfLoad();
      const deleted = RF_LISTS.reduce((sum, list) => sum + current[list].length, 0);
      const { version, audit } = current;
      rfMaster = freshRf();
      rfMaster.version = version;
      rfMaster.audit = [...audit, { at: iso(now()), user: bomActor().name, action: "ล้างข้อมูล RubberFlow ทดสอบ", detail: `ลบ ${deleted} แถว`, entries: [] }];
      rfPersist();
      return { deleted };
    },
    // โหมดทดสอบ: ทำหน้าที่เป็นบัญชีทดสอบ — หน้าเว็บตั้ง state.employee เป็น persona ที่เลือก (ตัวแรกใช้แถวของผู้ใช้จำลองเอง ที่เหลือเป็นพนักงานของแต่ละแผนก)
    app_sandbox_status: () => {
      if (!sandbox) return null;
      return { active: true, persona: currentPersona(), personas: personaRows() };
    },
    app_sandbox_enter({ p_persona_id }) {
      if (!sandbox) fail("SANDBOX_NOT_AVAILABLE");
      const row = personaRows().find((item) => item.id === p_persona_id) ?? fail("PERSONA_NOT_FOUND");
      personaId = row.id;
      try { storage?.setItem?.(PERSONA_KEY, personaId); } catch { /* storage ปิดอยู่: เลือกได้ในหน้านี้เท่านั้น */ }
      return null;
    },
    // อนุมัติ/รับทราบขั้นกลางเลื่อน current_step อย่างเดียว ไม่มีแถวประวัติ (เหมือนฐานข้อมูลจริง ดู buildRequestTimeline ใน app.js)
    // ขั้นสุดท้าย ไม่อนุมัติ และขอข้อมูลเพิ่ม เปลี่ยนสถานะคำร้องและเพิ่มแถว request_status_history
    // หน้ารออนุมัติ (อนุมัติหลายรายการ) เรียก RPC นี้ทีละขั้นเช่นกัน
    app_approval_decision({ p_step_id, p_decision, p_comment }) {
      const step = findRow("approval_steps", p_step_id, "STEP_NOT_PENDING");
      const request = findRow("requests", step.request_id, "REQUEST_NOT_FOUND");
      const type = typeOf(request);
      if (step.status !== "pending") fail("STEP_NOT_PENDING");
      if (request.status !== "pending_approval" || step.step_order !== request.current_step) fail("STEP_NOT_CURRENT");
      if (step.approver_employee_id !== ME_ID) fail("NOT_AUTHORIZED");
      if (!["approved", "rejected", "more_info", "acknowledged"].includes(p_decision)) fail("INVALID_DECISION");
      if (p_decision === "acknowledged" && type.code !== "MANAGEMENT") fail("DECISION_NOT_ALLOWED");
      const comment = String(p_comment ?? "").trim();
      if (["rejected", "more_info"].includes(p_decision) && comment.length < 3) fail("COMMENT_REQUIRED");
      const at = stamp();
      Object.assign(step, { status: p_decision, acted_by: ME_ID, acted_at: at, comment: comment || null });
      if (["approved", "acknowledged"].includes(p_decision)) {
        const next = stepsOf(request.id).find((row) => row.step_order > step.step_order);
        if (next) { Object.assign(request, { current_step: next.step_order, updated_at: at }); return null; }
        Object.assign(request, { current_step: 0, approved_at: at });
        setStatus(request, type.uses_repair_workflow ? "pending_assign" : p_decision, comment, at);
        return null;
      }
      setStatus(request, p_decision, comment, at);
      return null;
    },
    app_resubmit_request({ p_request_id, p_comment }) {
      const request = findRow("requests", p_request_id, "REQUEST_NOT_FOUND");
      if (request.status !== "more_info") fail("REQUEST_NOT_AWAITING_INFO");
      if (request.requester_id !== ME_ID) fail("NOT_AUTHORIZED");
      const step = stepsOf(request.id).find((row) => row.status === "more_info") ?? fail("STEP_NOT_FOUND");
      // ความเห็นเดิมของผู้อนุมัติอยู่จนกว่าจะตัดสินรอบใหม่ (ข้อความของรอบก่อนอยู่ใน note ของประวัติแล้ว)
      Object.assign(step, { status: "pending", acted_by: null, acted_at: null });
      request.current_step = step.step_order;
      setStatus(request, "pending_approval", String(p_comment ?? "").trim());
      return null;
    },
    // คำร้องทั่วไป (ไม่ใช่งานซ่อม): รับงาน approved → in_progress แล้วปิด in_progress → completed
    app_update_request_status({ p_request_id, p_status }) {
      const request = findRow("requests", p_request_id, "REQUEST_NOT_FOUND");
      const type = typeOf(request);
      const allowed = { approved: "in_progress", in_progress: "completed" };
      if (type.uses_repair_workflow) fail("REPAIR_USES_OWN_WORKFLOW");
      if (type.code === "MANAGEMENT" && request.status === "approved") fail("REQUEST_ENDS_AT_DECISION");
      if (allowed[request.status] !== p_status) fail("INVALID_TRANSITION");
      if (p_status === "in_progress") request.assignee_id = ME_ID;
      if (p_status === "completed") request.completed_at = stamp();
      setStatus(request, p_status, null);
      return null;
    },
    app_reply_to_step_comment({ p_step_id, p_message }) {
      const step = findRow("approval_steps", p_step_id, "STEP_NOT_FOUND");
      db.request_comments.push({ id: newId("request_comments"), request_id: step.request_id, approval_step_id: step.id, author_id: ME_ID, body: textInRange(p_message, 1, 1000, "INVALID_MESSAGE"), created_at: stamp() });
      return null;
    },
    app_peek_request_number: ({ p_request_type_id }) => nextRequestNo(findRow("request_types", p_request_type_id, "INVALID_REQUEST_TYPE").prefix),
    app_create_request({ p_type_id, p_title, p_description, p_priority, p_details, p_cc_department_ids }) {
      const type = findRow("request_types", p_type_id, "INVALID_REQUEST_TYPE");
      if (!NEW_REQUEST_STEPS[type.code] || type.uses_repair_workflow) fail("INVALID_REQUEST_TYPE");
      return createRequest(type, {
        title: textInRange(p_title, 3, 200, "INVALID_TITLE"), description: textInRange(p_description, 3, 5000, "INVALID_DESCRIPTION"),
        priority: p_priority || "normal", details: p_details ?? {}, cc_department_ids: p_cc_department_ids ?? [],
      });
    },
    app_peek_repair_doc_number: () => nextRequestNo("MT"),
    app_create_repair_request({ p_department_id, p_machine_id, p_doc_type, p_description, p_is_urgent, p_needed_date, p_requester_name }) {
      const department = departments.find((row) => row.id === p_department_id && row.is_repair_site) ?? fail("DEPARTMENT_NOT_REPAIR_SITE");
      const machine = machines.find((row) => row.id === p_machine_id && row.department_id === department.id) ?? fail("MACHINE_NOT_FOUND");
      const description = textInRange(p_description, 3, 5000, "INVALID_DESCRIPTION");
      return createRequest(request_types.find((row) => row.code === "MT_REPAIR"), {
        title: `แจ้งซ่อม ${machine.code} ${description.slice(0, 60)}`, description, department_id: department.id,
        machine_id: machine.id, machine_code: machine.code, machine_name: machine.name, doc_type: p_doc_type || "repair",
        is_urgent: Boolean(p_is_urgent), priority: p_is_urgent ? "high" : "normal", needed_date: p_needed_date || null,
        requester_name: String(p_requester_name ?? "").trim() || personName(ME_ID),
      });
    },
    app_create_machine({ p_department_id, p_code, p_name }) {
      const code = textInRange(p_code, 2, 40, "INVALID_MACHINE_CODE");
      const existing = machines.find((row) => row.department_id === p_department_id && row.code.toLowerCase() === code.toLowerCase());
      if (existing) return { ...existing, existed: true };
      const machine = { id: newId("machines"), code, name: textInRange(p_name, 2, 120, "INVALID_MACHINE_NAME"), department_id: p_department_id, is_placeholder: false, is_active: true, sort_order: machines.length + 1 };
      machines.push(machine);
      return { ...machine, existed: false };
    },
    app_get_machine_repair_history: () => [],
    app_assign_repair_technician({ p_request_id, p_technician_ids, p_execution_plan, p_inspector_opinion, p_work_started_date, p_work_expected_date }) {
      const request = findRow("requests", p_request_id, "REQUEST_NOT_FOUND");
      requireStatus(request, ["pending_assign", "assigned", "in_progress", "pending_verify", "completed"]);
      const ids = [...new Set(p_technician_ids ?? [])];
      if (!ids.length) fail("TECHNICIAN_REQUIRED");
      db.request_technicians = db.request_technicians.filter((row) => row.request_id !== request.id);
      ids.forEach((technician_id) => db.request_technicians.push({ id: newId("request_technicians"), request_id: request.id, technician_id }));
      Object.assign(request, {
        assignee_id: ids[0], execution_plan: p_execution_plan ?? request.execution_plan ?? null, inspector_opinion: p_inspector_opinion ?? request.inspector_opinion ?? null,
        work_started_date: p_work_started_date ?? null, work_expected_date: p_work_expected_date ?? null,
      });
      if (request.status === "pending_assign") setStatus(request, "assigned", null);
      return null;
    },
    app_start_repair_work({ p_request_id }) {
      const request = findRow("requests", p_request_id, "REQUEST_NOT_FOUND");
      requireStatus(request, ["assigned"], "REQUEST_NOT_ASSIGNED");
      setStatus(request, "in_progress", null);
      return null;
    },
    app_save_repair_work_progress({ p_request_id, p_cause_analysis, p_parts_used_items }) {
      const request = findRow("requests", p_request_id, "REQUEST_NOT_FOUND");
      requireStatus(request, ["in_progress"], "REQUEST_NOT_IN_PROGRESS");
      Object.assign(request, { cause_analysis: p_cause_analysis ?? null, parts_used_items: p_parts_used_items ?? [], updated_at: stamp() });
      return null;
    },
    app_finish_repair_work({ p_request_id, p_cause_analysis, p_parts_used_items }) {
      const request = findRow("requests", p_request_id, "REQUEST_NOT_FOUND");
      requireStatus(request, ["in_progress"], "REQUEST_NOT_IN_PROGRESS");
      Object.assign(request, { cause_analysis: p_cause_analysis ?? null, parts_used_items: p_parts_used_items ?? [] });
      setStatus(request, "pending_verify", null);
      return null;
    },
    app_verify_repair({ p_request_id, p_result, p_note }) {
      const request = findRow("requests", p_request_id, "REQUEST_NOT_FOUND");
      requireStatus(request, ["pending_verify"], "REQUEST_NOT_PENDING_VERIFY");
      if (request.requester_id !== ME_ID) fail("NOT_AUTHORIZED");
      if (!["pass", "fail"].includes(p_result)) fail("INVALID_RESULT");
      if (p_result === "fail" && !String(p_note ?? "").trim()) fail("NOTE_REQUIRED");
      const at = stamp();
      if (p_result === "pass") request.completed_at = at;
      db.request_verifications.push({ id: newId("request_verifications"), request_id: request.id, result: p_result, note: p_note || null, verified_by: ME_ID, created_at: at });
      setStatus(request, p_result === "pass" ? "completed" : "assigned", p_note, at);
      return null;
    },
    // กระดานสถานะ (#/requests?view=board): ผู้ใช้จำลองเปิดได้ทุกใบ
    app_request_status_board({ p_status, p_search, p_limit }) {
      const search = String(p_search ?? "").trim().toLowerCase();
      return db.requests
        .filter((row) => !p_status || row.status === p_status)
        .filter((row) => !search || [row.request_no, row.title, row.machine_code, row.machine_name, row.requester_name].some((value) => String(value ?? "").toLowerCase().includes(search)))
        .sort((left, right) => compare(left.created_at, right.created_at, false))
        .slice(0, p_limit ?? 500)
        .map((row) => {
          const type = typeOf(row);
          const department = departments.find((item) => item.id === row.department_id);
          const waiting = row.status === "pending_approval" ? stepsOf(row.id).find((step) => step.step_order === row.current_step) : null;
          return {
            id: row.id, request_no: row.request_no, status: row.status, subject: row.title, type_code: type.code, type_name_th: type.name_th,
            uses_repair_workflow: type.uses_repair_workflow, department_code: department?.code ?? null, department_name: department?.name_th ?? null,
            is_urgent: row.is_urgent, requester_name: row.requester_name, submitted_at: row.submitted_at, last_changed_at: row.updated_at, work_expected_date: row.work_expected_date ?? null,
            waiting_on: waiting ? `${waiting.step_name} (${personName(waiting.approver_employee_id)})` : null, can_open: true,
          };
        });
    },
  };

  function rpc(name, args = {}) {
    const handler = RPC[name];
    if (!handler) {
      warnOnce(`rpc:${name}`, `[pilot harness] Supabase จำลองไม่มี RPC "${name}" — คืน null`);
      return ok(null);
    }
    try { return ok(clone(handler(args ?? {}))); } catch (error) { return failed(error); }
  }

  // ไฟล์แนบ: signed URL ของภาพย่อ (<path>.thumb…) ใช้ภาพเดียวกับไฟล์ต้นทาง
  function fileUrl(bucket, path) {
    const key = `${bucket}/${path}`;
    if (files.has(key)) return files.get(key);
    const seeded = [...files.keys()].find((stored) => path === stored || path.startsWith(stored));
    return seeded ? files.get(seeded) : null;
  }
  const storageBucket = (bucket) => ({
    upload(path, file) {
      // บัคเก็ตของใบสั่งงาน IT เขียนทับไม่ได้ (upsert: false) เหมือน Storage จริง: path ซ้ำ = 409
      if (bucket.startsWith("itwo-") && objectKeys.has(`${bucket}/${path}`)) return Promise.resolve({ data: null, error: Object.assign(new Error("The resource already exists"), { statusCode: "409" }) });
      objectKeys.add(`${bucket}/${path}`);
      objectMimes.set(`${bucket}/${path}`, file?.type || null); // Storage จริงจดชนิดจาก file.type ของไฟล์ที่ส่ง (ไม่ใช้ options.contentType เมื่อส่ง File/Blob)
      if (objectUrl && file) files.set(`${bucket}/${path}`, objectUrl(file));
      return ok({ path });
    },
    createSignedUrl: (path) => ok({ signedUrl: fileUrl(bucket, path) }),
    createSignedUrls: (paths) => ok((paths ?? []).map((path) => ({ path, signedUrl: fileUrl(bucket, path), error: fileUrl(bucket, path) ? null : "Object not found" }))),
    remove(paths) {
      for (const path of paths ?? []) { objectKeys.delete(`${bucket}/${path}`); objectMimes.delete(`${bucket}/${path}`); files.delete(`${bucket}/${path}`); }
      return ok((paths ?? []).map((path) => ({ name: path })));
    },
  });

  const session = { access_token: "mock", user: { id: ME.auth_user_id, email: ME.email } };
  const client = {
    from: query,
    rpc,
    auth: {
      getSession: () => ok({ session }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => ok(null), refreshSession: () => ok({ session }), setSession: () => ok({ session }),
    },
    storage: { from: storageBucket },
    functions: { invoke: () => ok(null) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  };
  // rf.edit: ใช้ในเทสต์เท่านั้น แก้ข้อมูล RubberFlow ของฐานข้อมูลจำลองตรงๆ (ใช้สร้างข้อมูลเก่า เช่นใบเบิกที่ค้าง weighing ซึ่งคำสั่งปัจจุบันสร้างไม่ได้แล้ว) · ผู้แก้ต้องประทับเวอร์ชันเอง
  // bom.edit: แบบเดียวกันกับข้อมูล BOM (เช่นตั้งใบเป็น completed ตรงๆ เหมือน pgTAP)
  return { client, db, rf: { edit: (change) => { change(rfLoad()); rfPersist(); } }, bom: { edit: (change) => { change(bomLoad()); bomPersist(); } } };
}

// ติดตั้งในหน้า: ไม่ลงทะเบียน service worker, fetch ข้าม origin ทุกตัว (Supabase Edge Function, Google Apps Script ที่เขียนชีตสำรอง ฯลฯ)
// ได้คำตอบว่างแทน หน้าจำลองจึงไม่ส่งอะไรออกนอกเครื่อง แล้วแทน window.supabase ด้วย client จำลอง (?empty=1 = ไม่มีคำร้องเลย)
// options.sandbox = เปิดโหมดทดสอบโดยไม่ต้องมี ?sandbox=1 (หน้า /harness/ ที่ไม่มี URL ของ pilot-shell)
export function installMockSupabase(win, create, options = {}) {
  Object.defineProperty(win.navigator, "serviceWorker", { value: { register: () => Promise.resolve(), getRegistration: () => Promise.resolve(undefined), ready: new Promise(() => {}) } });
  const realFetch = win.fetch.bind(win);
  win.fetch = (input, init) => {
    let sameOrigin = false;
    try { sameOrigin = new win.URL(String((input && input.url) || input), win.location.href).origin === win.location.origin; } catch { sameOrigin = false; }
    return sameOrigin ? realFetch(input, init) : Promise.resolve(new win.Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  };
  const params = new win.URLSearchParams(win.location.search);
  const { client } = create({
    empty: params.has("empty"),
    // ?ncr=1 = สถานการณ์ NCR อย่างเดียว · ?as=e5 = เข้าระบบเป็นพนักงานจำลองคนนั้น
    ncr: params.has("ncr"),
    // ?master=1 = ผู้ใช้จำลองเป็นบัญชี master เห็นหน้า #/master
    master: params.has("master"),
    as: params.get("as"),
    // ?real=rb = นอกโหมดทดสอบ ผู้ใช้จำลองเป็นพนักงานจริงของแผนก RB (รหัสเดียวกับบัญชีทดสอบ: pp rbh gr st sr wh whh qa pk pt bg)
    real: params.get("real"),
    sandbox: Boolean(options.sandbox) || new win.URLSearchParams(win.location.search).has("sandbox"),
    // ?itwo=1 (ใช้คู่กับ ?sandbox=1) = ฐานข้อมูลจำลองของใบสั่งงาน IT + persona SBX-IT-*
    itwo: params.has("itwo") || Boolean(options.itwo),
    storage: (() => { try { return win.localStorage; } catch { return null; } })(),
    warn: (message) => win.console.warn(message),
    objectUrl: (file) => win.URL.createObjectURL(file),
  });
  win.supabase = { createClient: () => client };
}

export function mockSupabaseScript({ sandbox = false, itwo = false } = {}) {
  // createItwoMock ฉีดเป็นซอร์สก่อน createMockSupabase (ในเบราว์เซอร์ไม่มี import) · Node ใช้ตัวที่ import ไว้ด้านบน
  return `(() => {\n${createItwoMock.toString()}\n${createMockSupabase.toString()}\n(${installMockSupabase.toString()})(window, createMockSupabase, ${JSON.stringify({ sandbox, itwo })});\n})();\n`;
}
