// Supabase จำลองของ /pilot-shell.html (scripts/pilot-harness.mjs): ข้อมูลตัวอย่างอยู่ในหน่วยความจำของหน้า เขียนแล้วอ่านกลับได้ทันที
// (อนุมัติ/ไม่อนุมัติ/ขอข้อมูลเพิ่ม ส่งข้อมูลกลับ เปลี่ยนสถานะ สร้างคำร้อง/ใบแจ้งซ่อม ขั้นตอนงานซ่อม) และหายเมื่อโหลดหน้าใหม่ ไม่เก็บลง localStorage
//
// createMockSupabase และ installMockSupabase ต้องไม่อ้างตัวแปรนอกฟังก์ชันของตัวเอง เพราะ mockSupabaseScript() ส่งซอร์สของทั้งสอง
// (Function#toString) ให้เบราว์เซอร์เป็น /harness-mock-supabase.js ส่วน scripts/tests/pilot-harness-mock.test.mjs import ไปทดสอบตรงๆ
// สิทธิ์ที่ตรวจในนี้เป็นแค่ส่วนที่หน้าจอต้องเห็น (ขั้นของฉัน ขั้นปัจจุบัน ความเห็นบังคับ ลำดับสถานะ) ใช้รหัส error เดียวกับ RPC จริงเพื่อให้ข้อความตรงกัน
// แต่หลวมกว่า RPC จริง เช่น การมอบหมายช่างครั้งแรกไม่บังคับแผนดำเนินงาน/วันที่ และลิงก์ "ดาวน์โหลด" ไฟล์แนบใช้ไม่ได้ (data:/blob: URL)

// sandbox = admin อยู่ในโหมดทดสอบ (?sandbox=1): ผู้ใช้จำลองเป็น admin และทำหน้าที่เป็นบัญชีทดสอบ จึงเห็นโมดูลทดสอบ (RubberFlow, BOM)
// storage = ที่เก็บข้อมูลหลัก BOM ของหน้า (localStorage) ไม่ส่ง = อยู่ในหน่วยความจำอย่างเดียว
export function createMockSupabase({ empty = false, sandbox = false, now = () => Date.now(), warn = () => {}, objectUrl = null, storage = null } = {}) {
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

  const ME_ID = "e1";
  const roles = [
    ["role-dm", "department_manager", "ผู้จัดการแผนก"], ["role-sup", "supervisor", "หัวหน้างาน"], ["role-tech", "technician", "ช่าง"],
    ["role-staff", "staff", "พนักงาน"], ["role-fm", "factory_manager", "ผู้จัดการโรงงาน"], ["role-gm", "general_manager", "ผู้จัดการทั่วไป"],
    // admin มีเฉพาะโหมดทดสอบ (?sandbox=1) โหมดปกติรายการบทบาทเหมือนเดิม
    ...(sandbox ? [["role-admin", "admin", "ผู้ดูแลระบบ"]] : []),
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
  ].map(([id, employee_no, first_name, last_name, job_title, department_id, role_id], index) => ({
    id, employee_no, first_name, last_name, job_title, department_id, role_id, acting_role_id: null, manager_id: null,
    email: `${id}@example.test`, phone: "", is_active: true, auth_user_id: `u${index + 1}`,
  }));
  const ME = employees[0];
  if (sandbox) ME.role_id = "role-admin";
  const personName = (id) => { const person = employees.find((row) => row.id === id); return person ? `${person.first_name} ${person.last_name}` : null; };
  const request_types = [
    ["t-mt", "MT_REPAIR", "MT", "แจ้งซ่อม", "งานซ่อมเครื่องจักรและอาคาร", true, "dep-mt"],
    ["t-mg", "MANAGEMENT", "MG", "ใบคำร้องถึงฝ่ายบริหาร", "หนังสือภายในถึงผู้บริหาร", false, null],
    ["t-ncr", "NCR_CAR", "NCR", "NCR/CAR", "รายงานสินค้าไม่เป็นไปตามข้อกำหนด", false, "dep-qa"],
    ["t-it", "IT_REPAIR", "IT", "แจ้งงาน IT", "อุปกรณ์และสิทธิ์ระบบ", false, "dep-it"],
  ].map(([id, code, prefix, name_th, description, uses_repair_workflow, owning_department_id], index) => ({
    id, code, prefix, name_th, description, uses_repair_workflow, owning_department_id, form_schema: null, is_active: true, sort_order: index + 1,
  }));
  // ขั้นอนุมัติของคำร้องที่สร้างใหม่: ขั้นแรกเป็นของผู้ใช้จำลองเสมอ ใบใหม่จึงเข้าคิวให้ลองกดต่อได้ทันที
  const NEW_REQUEST_STEPS = {
    MT_REPAIR: [["หัวหน้าแผนกผู้แจ้งอนุมัติ", ME_ID]],
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

  if (!empty) {
    seedRequest({
      id: "req-mt-0412", no: "MT-2569-0412", type: "MT_REPAIR", title: "แจ้งซ่อมเครื่องฉีดยาง HCM-03 น้ำมันไฮดรอลิกรั่ว", priority: "high", urgent: true,
      description: "น้ำมันไฮดรอลิกรั่วบริเวณกระบอกสูบด้านซ้าย หยดลงพื้นตลอดกะ ต้องหยุดเครื่องเติมน้ำมันทุก 2 ชั่วโมง",
      status: "pending_approval", requester: "e4", machine: "m-hcm03", created: 1, currentStep: 2,
      steps: [["ผู้จัดการโรงงานอนุมัติ", "e5", "approved", 0.8, "อนุมัติ ให้ซ่อมด่วนก่อนกะดึก"], ["ผู้จัดการแผนกซ่อมบำรุงรับงาน", ME_ID, "pending"]],
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
      steps: [["ผู้จัดการโรงงานอนุมัติ", "e5", "approved", 3.8], ["ผู้จัดการแผนกซ่อมบำรุงรับงาน", ME_ID, "approved", 3.5]],
      history: [["pending_approval", "pending_assign", ME_ID, 3.5]],
    });
    seedRequest({
      id: "req-mt-0401", no: "MT-2569-0401", type: "MT_REPAIR", title: "เครื่องผสมยาง MX-01 มอเตอร์ร้อนผิดปกติ",
      description: "อุณหภูมิมอเตอร์ขึ้นถึง 95 องศาหลังเดินเครื่อง 1 ชั่วโมง", status: "assigned", requester: "e4", machine: "m-mx01", created: 5, currentStep: 0,
      assignee: ME_ID, techs: [ME_ID, "e2"], extra: { work_expected_date: ago(-2).slice(0, 10), execution_plan: "use_existing", inspector_opinion: "self_repair" },
      steps: [["ผู้จัดการโรงงานอนุมัติ", "e5", "approved", 4.8], ["ผู้จัดการแผนกซ่อมบำรุงรับงาน", ME_ID, "approved", 4.5]],
      history: [["pending_approval", "pending_assign", ME_ID, 4.5], ["pending_assign", "assigned", ME_ID, 4.4]],
    });
    seedRequest({
      id: "req-mt-0398", no: "MT-2569-0398", type: "MT_REPAIR", title: "ปั๊มลมห้องซ่อม CMP-01 แรงดันตก",
      description: "แรงดันลมตกเหลือ 4 บาร์ เครื่องมือลมใช้งานไม่ได้", status: "in_progress", requester: "e2", machine: "m-cmp01", created: 7, currentStep: 0,
      assignee: "e2", techs: ["e2", ME_ID], extra: { work_expected_date: ago(-1).slice(0, 10), execution_plan: "need_purchase", inspector_opinion: "buy_parts" },
      steps: [["ผู้จัดการแผนกซ่อมบำรุงรับงาน", ME_ID, "approved", 6.5]],
      history: [["pending_approval", "pending_assign", ME_ID, 6.5], ["pending_assign", "assigned", ME_ID, 6.4], ["assigned", "in_progress", "e2", 6]],
    });
    seedRequest({
      id: "req-mt-0390", no: "MT-2569-0390", type: "MT_REPAIR", title: "ไฟส่องสว่างอาคาร 2 ดับครึ่งแถว",
      description: "โคมไฟแถว B ดับ 6 โคม", status: "pending_verify", requester: ME_ID, machine: "m-ltb2", created: 9, currentStep: 0,
      assignee: "e8", techs: ["e8"], extra: { execution_plan: "immediate", inspector_opinion: "self_repair", cause_analysis: "บัลลาสต์เสื่อมสภาพ", parts_used: "บัลลาสต์ 36W 6 ตัว" },
      steps: [["ผู้จัดการแผนกซ่อมบำรุงรับงาน", ME_ID, "approved", 8.8]],
      history: [["pending_approval", "pending_assign", ME_ID, 8.8], ["pending_assign", "assigned", ME_ID, 8.7], ["assigned", "in_progress", "e8", 8], ["in_progress", "pending_verify", "e8", 0.5]],
    });
    db.notifications.push(
      { id: "n1", recipient_id: ME_ID, request_id: "req-mt-0412", title: "MT-2569-0412 รอคุณรับงาน", body: "แจ้งซ่อมเครื่องฉีดยาง HCM-03 น้ำมันไฮดรอลิกรั่ว", kind: "approval", action_url: null, read_at: null, created_at: ago(0.8) },
      { id: "n2", recipient_id: ME_ID, request_id: "req-ncr-0088", title: "NCR-2569-0088 รอคุณรับทราบ", body: "NCR ยางขอบไม่เต็ม ล็อต RB-1103", kind: "approval", action_url: null, read_at: null, created_at: ago(1.5) },
    );
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
  const failed = (error) => Promise.resolve({ data: null, error: { message: error.code ?? error.message, code: error.code ?? "MOCK_ERROR" }, count: null });

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
  // บังคับสัญญาเดียวกับ RPC จริง: เฉพาะโหมดทดสอบ · สิทธิ์ตามหมวดและตามช่องของบัญชีทดสอบที่เลือก:
  //   ฝ่ายวางแผน = admin ผู้จัดการแผนกขึ้นไป หรือแผนก PP ทำได้ทุกอย่าง · ST/WH นับคงคลังของใบร่าง · พนักงานแผนกของงานรายงานผล/เปลี่ยนสถานะงานของแผนกตน (RB ผูก WO) · ที่เหลืออ่านอย่างเดียว
  // ชนรายระเบียน: ทุกระเบียนจำเลขรุ่นที่แก้ล่าสุด (versions) · บันทึกชนเมื่อระเบียนที่แตะถูกผู้อื่นแก้/ลบหลัง p_base_version (BOM_STALE) ระเบียนอื่นไม่ขวาง
  // บันทึกคืนส่วนต่าง { version, changes: { <ชุด>: { upsert, delete } } } ตั้งแต่ p_base_version · ชุดสี/แพ็กเกจ/งานที่ลบจดเป็นหลุมฝังศพ (tombstones)
  // กฎของ BOM ใช้ bom-rules.js ที่หน้าโหลดไว้ (window.MNP_BOM_RULES) ถ้ามี
  const BOM_KEY = "mnp-harness-bom-master";
  const PERSONA_KEY = "mnp-harness-persona";
  const BOM_LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs"];
  const BOM_ID = {
    items: (record) => record.code, compounds: (record) => record.code, colors: (record) => record.code, processes: (record) => record.code,
    boms: (record) => record.id, routings: (record) => record.id,
    colorSets: (record) => `${record.base}|${record.code}`, packages: (record) => `${record.base}|${record.code}`,
    customers: (record) => String(record.name ?? "").trim().toLowerCase(), orders: (record) => record.id, jobs: (record) => record.id,
  };
  // ลำดับของชุดที่หน้าเห็น (ตรงกับ app_bom_master): ใบสั่งผลิตใหม่สุดก่อน · งานเรียงตามใบ แผนก ชิ้นงาน เลขงาน · ชุดอื่นตามกุญแจ
  const bomCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const BOM_ORDER = {
    orders: (a, b) => (Number(b.orderedAt) || 0) - (Number(a.orderedAt) || 0) || bomCmp(a.id, b.id),
    jobs: (a, b) => bomCmp(a.orderId, b.orderId) || bomCmp(a.dept, b.dept) || bomCmp(a.itemCode, b.itemCode) || bomCmp(a.id, b.id),
  };
  const bomSorter = (list) => BOM_ORDER[list] ?? ((a, b) => bomCmp(BOM_ID[list](a), BOM_ID[list](b)));
  const BOM_DELETABLE = ["colorSets", "packages", "jobs"];
  // หลุมฝังศพจำเป็นข้อมูล { list, base, code, version } · งานใช้ code เป็นเลขงาน (ส่งกลับเป็น { id })
  const graveKey = (row) => (row.list === "jobs" ? row.code : `${row.base}|${row.code}`);
  const targetKey = (list, target) => (list === "jobs" ? String(target?.id ?? "") : `${target?.base}|${target?.code}`);
  const BOM_MANAGER_ROLES = ["department_manager", "assistant_factory_manager", "factory_manager", "general_manager"];
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
  const bomView = (current) => ({ version: current.version, epoch: current.epoch, ...Object.fromEntries(BOM_LISTS.map((list) => [list, clone(current[list]).sort(bomSorter(list))])) });
  // ส่วนต่างตั้งแต่เวอร์ชัน since (ตรงกับ private.bom_delta): ครบทุกชุด delete มีเฉพาะชุดสี/แพ็กเกจ/งาน
  function bomDelta(current, since) {
    const changes = {};
    for (const list of BOM_LISTS) {
      const upsert = current[list].filter((row) => (current.versions[list][BOM_ID[list](row)] ?? 0) > since).sort(bomSorter(list));
      const deleted = current.tombstones.filter((row) => row.list === list && row.version > since).map((row) => (list === "jobs" ? { id: row.code } : { base: row.base, code: row.code }));
      changes[list] = { upsert: clone(upsert), delete: deleted };
    }
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
    ["persona-st", "วิชัย", "คลังวัตถุดิบ", "พนักงานคลังวัตถุดิบ (ST)", "ST", "คลังวัตถุดิบ"],
    ["persona-sr", "ศิริ", "รับมอบ", "พนักงานแผนก SR (รับมอบ WIP)", "SR", "รับมอบ WIP"],
    ["persona-wh", "สุดา", "คลังสินค้า", "พนักงานคลังสินค้า (WH)", "WH", "คลังสินค้า"],
    ["persona-qa", "ธนา", "ตรวจสอบ", "เจ้าหน้าที่ QA (แผนกที่ไม่ใช่ฝ่ายผลิต)", "QA", "ประกันคุณภาพ"],
  ];
  const personaRows = () => [
    { ...expand("employees", ME), id: "persona-1", job_title: "บัญชีทดสอบ ผู้จัดการแผนก" },
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
  const bomActor = () => {
    const persona = currentPersona();
    return { name: `${persona.first_name ?? ""} ${persona.last_name ?? ""}`.trim(), role: persona.role?.code ?? "", dept: String(persona.department?.code ?? "").toUpperCase() };
  };
  const bomIsPlanner = (actor) => actor.role === "admin" || BOM_MANAGER_ROLES.includes(actor.role) || actor.dept === "PP";
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
    } else if (list === "jobs") {
      out.createdAt = old?.createdAt ?? at;
      // รายงานผลเป็นแบบเพิ่มต่อท้ายเท่านั้น: รายการใหม่ฐานข้อมูลใส่ชื่อผู้รายงานและเวลาเอง · doneAt ตั้งเมื่องานเปลี่ยนเป็นเสร็จ
      const kept = Array.isArray(old?.reports) ? old.reports.length : 0;
      out.reports = (Array.isArray(record.reports) ? record.reports : []).map((entry, index) => (index < kept ? old.reports[index] : { ...entry, by: who, at }));
      if (record.status === "done" && old?.status !== "done") out.doneAt = at;
      else if (old?.doneAt !== undefined) out.doneAt = old.doneAt;
    }
    return out;
  }
  // สิทธิ์ตามหมวดและตามช่อง (เทียบระเบียนเดิมกับระเบียนใหม่) · prev = null เมื่อเป็นระเบียนใหม่
  function bomCheckRecord(list, prev, record, actor) {
    const planner = bomIsPlanner(actor);
    if (list === "orders" && prev && !planner) {
      // ผู้ที่ไม่ใช่ฝ่ายวางแผนแก้ใบได้เฉพาะยอดนับคงคลังของใบร่าง (ST/WH)
      const counted = ["stockCounts", "stockCountedAt", "stockCountedBy"];
      const ok = ["ST", "WH"].includes(actor.dept) && prev.status === "draft" && record.status === "draft" && bomCanon(bomWithout(prev, counted)) === bomCanon(bomWithout(record, counted));
      if (!ok) fail("BOM_FORBIDDEN");
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
  // released/in_progress→completed (งาน PK เสร็จครบ) · ที่ยังไม่จบ→cancelled (ห้ามถ้ามีงานรายงานยอดดีหรือผูก WO; งานของใบถูกลบ) ·
  // released/in_progress→draft เฉพาะเปิดใบกลับมาแก้ (ห้ามถ้ามีงานเริ่ม; งานของใบถูกลบ) · เนื้อหา/ยอดนับแก้ได้เฉพาะใบ draft
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
    if (!prev) {
      if (record.status !== "draft") fail("BOM_INVALID_TRANSITION");
      return;
    }
    const from = prev.status;
    const to = record.status;
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
    if (from === "draft" && to === "released") {
      if (!record.items.length || !record.explosion) fail("BOM_INVALID_TRANSITION");
      ctx.released.push(prev.id);
    } else if (from === "draft" && to === "cancelled") {
      // ไม่มีอะไรเพิ่ม
    } else if ((from === "released" || from === "in_progress") && to === "completed") {
      if (jobs.some((job) => job.dept === "PK" && job.status !== "done")) fail("BOM_INVALID_TRANSITION");
    } else if ((from === "released" || from === "in_progress") && to === "cancelled") {
      if (jobs.some((job) => Number(job.qtyDone) > 0)) fail("BOM_INVALID_TRANSITION");
      ctx.rfCancel.push(bomRfCancelOp("cancelOrder", jobs));
      ctx.dropJobs(prev.id);
    } else if ((from === "released" || from === "in_progress") && to === "draft") {
      if (jobs.some(bomJobStarted)) fail("BOM_INVALID_TRANSITION");
      if (Number(record.revision) !== Number(prev.revision) + 1) fail("BOM_INVALID_TRANSITION");
      ctx.rfCancel.push(bomRfCancelOp("reopenOrder", jobs));
      ctx.dropJobs(prev.id);
    } else fail("BOM_INVALID_TRANSITION");
  }
  // WO ของ RubberFlow ที่เลย "ปล่อยผลิต" ไปแล้ว (กำลังผลิต พัก เสร็จ) = เริ่มแล้ว · WO ที่ยังเป็นแผนก/ปล่อยผลิต (รวมที่เปิดอัตโนมัติตอนปล่อยใบ) ยังไม่นับ
  const RF_WO_STARTED = ["in_progress", "on_hold", "completed"];
  const bomRfWoOf = (job) => (job.externalRef?.woId ? rfLoad().orders.find((row) => row.id === job.externalRef.woId) : undefined);
  // งานที่เริ่มแล้ว (ตรงกับกฎ startedJobs ของหน้า): สถานะไม่ใช่รอคิว มีรายงาน ยอดดี/เสีย หรือผูก WO ของ RubberFlow ที่เริ่มแล้ว (หรือหา WO ไม่พบ)
  const bomJobStarted = (job) => job.status !== "queued" || Number(job.qtyDone) > 0 || Number(job.qtyReject) > 0 || (Array.isArray(job.reports) && job.reports.length > 0)
    || (Boolean(job.externalRef) && (!bomRfWoOf(job) || RF_WO_STARTED.includes(bomRfWoOf(job).status)));
  // ยกเลิกใบ / เปิดใบกลับมาแก้: WO ที่ผูกงานของใบต้องยังเป็นแผนก/ปล่อยผลิต (ฐานข้อมูลยกเลิกให้) ไม่งั้นทั้งคำสั่งล้ม BOM_RF_ORDER_STARTED (ตรงกับ private.bom_cancel_rf_orders)
  function bomRfCancelOp(action, jobs) {
    const woIds = [];
    for (const job of jobs) {
      const wo = bomRfWoOf(job);
      if (!wo) continue;
      if (RF_WO_STARTED.includes(wo.status)) fail("BOM_RF_ORDER_STARTED");
      woIds.push(wo.id);
    }
    return { action, woIds };
  }
  // กฎของงาน (ตรงกับ bom_save_jobs): งานใหม่เกิดตอนปล่อยผลิตเท่านั้น (queued ว่าง) · แก้งานได้เฉพาะใบที่ released / in_progress ·
  // รายงานต่อท้ายเท่านั้น (ทุกบทบาท) · พนักงานแผนก: งาน done แล้วแก้ไม่ได้ ยอดเพิ่มได้อย่างเดียวและเท่าผลรวมรายงานใหม่ · ผูก WO ได้เฉพาะงานแผนก RB
  function bomJobRules(prev, record, actor, next, released) {
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
    if (record.externalRef && prev.dept !== "RB") fail("BOM_INVALID_JOB");
    if (!bomIsPlanner(actor)) {
      const workChanged = ["status", "qtyDone", "qtyReject", "reports"].some((key) => bomCanon(prev[key] ?? null) !== bomCanon(record[key] ?? null));
      if (workChanged) {
        if (prev.status === "done") fail("BOM_INVALID_TRANSITION");
        const sum = (key) => reports.slice(oldReports.length).reduce((total, entry) => total + (Number(entry?.[key]) || 0), 0);
        if (Number(record.qtyDone) < Number(prev.qtyDone) || Number(record.qtyReject) < Number(prev.qtyReject)) fail("BOM_INVALID_JOB");
        if (Math.abs((Number(record.qtyDone) - Number(prev.qtyDone)) - sum("good")) > 0.001 || Math.abs((Number(record.qtyReject) - Number(prev.qtyReject)) - sum("reject")) > 0.001) fail("BOM_INVALID_JOB");
      }
    }
  }
  function bomApply(current, changes, base, actor, at, rfOps = { release: [], cancel: [] }) {
    const next = clone(current);
    const nextVersion = current.version + 1;
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
      if (entry === undefined) continue;
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
        bomCheckRecord(list, prev, record, actor);
        // สูตรยางผูกกับสูตร PHR ของ RubberFlow ได้เฉพาะรหัสสูตรที่มีอยู่ในฐานข้อมูล RubberFlow (revision ใดก็ได้ · ตรงกับ bom_save_compounds)
        if (list === "compounds" && record.recipeId !== undefined && record.recipeId !== null && !rfLoad().recipes.some((row) => row.id === record.recipeId)) fail("BOM_INVALID_COMPOUND");
        if (list === "orders") bomOrderTransition(prev, record, { jobRows: changes.jobs?.upsert ?? [], jobsOf, dropJobs, released, rfCancel: rfOps.cancel });
        if (list === "jobs") bomJobRules(prev, record, actor, next, released);
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
            const same = bomCanon({ ...old, ...owned }) === bomCanon({ ...record, ...owned });
            const logOf = (row) => (Array.isArray(row.changeLog) ? row.changeLog : []);
            const logKept = list !== "boms" || (logOf(record).length >= logOf(old).length && logOf(old).every((item, position) => bomCanon(item) === bomCanon(logOf(record)[position])));
            if (!same || !logKept || (old.status !== record.status && !(old.status === "approved" && record.status === "superseded"))) fail("BOM_REVISION_IMMUTABLE");
          }
          next[list][index] = bomStamp(list, record, next[list][index], actor, at);
        }
        if (list === "jobs" && record.status !== "queued") startedJobs.push(record);
        stamp(list, id);
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
    // ใบที่ปล่อยผลิตต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้)
    for (const orderId of released) if (!next.jobs.some((job) => job.orderId === orderId)) fail("BOM_INVALID_TRANSITION");
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
  // SR รับมอบ WIP · WH ส่งมอบกล่อง · QA บันทึกผลตรวจและเปิด/ปิด NCR · ฐานข้อมูลคำนวณเอง: สต็อกล็อตหลังชั่ง คงเหลือ/ยอดส่งต่อของใบส่งมอบ ยอดผลิตของ WO สถานะกล่องตามผล QC การใช้แม่พิมพ์ (ไม่เชื่อค่าที่ client ส่ง)
  // WO ที่มี sourceJobId ผูกงาน RB ของ BOM ในคำสั่งเดียวกัน (externalRef) · SR รับมอบใบส่งมอบของ WO ที่ผูกงาน → ส่งยอดที่รับเข้างานเป็นรายงานผลทีละใบส่งมอบ (กิโลกรัม→หน่วยของ WO ตาม kgPerUnit) ผ่านตัวนับเวอร์ชันของ BOM ด้วย
  const RF_KEY = "mnp-harness-rf-master";
  const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds"];
  const RF_ID = { materials: (record) => record.code, recipes: (record) => `${record.id}|${record.revision}`, orders: (record) => record.id, materialLots: (record) => record.lotNo };
  for (const list of RF_LISTS) RF_ID[list] ??= (record) => record.id;
  const rfSorter = (list) => (list === "recipes" ? (a, b) => bomCmp(a.id, b.id) || a.revision - b.revision : (a, b) => bomCmp(RF_ID[list](a), RF_ID[list](b)));
  const RF_ACTIONS = ["saveMaterial", "createRecipe", "saveRecipe", "approveRecipe", "createOrder", "setOrderStatus", "receiveMaterial", "setMaterialLotStatus", "createRequisition", "weighLine", "recordMixing", "endRest", "recordExtrusion", "recordCuring", "recordFinishing", "createTransfer", "receiveTransfer", "shipBoxes", "addQcRecord", "createNcr", "updateNcr", "closeNcr", "cleanMold", "saveMold"];
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
  const RF_BAD = { materials: "RF_INVALID_MATERIAL", recipes: "RF_INVALID_RECIPE", orders: "RF_INVALID_ORDER", materialLots: "RF_INVALID_MATERIAL_LOT", requisitions: "RF_INVALID_REQUISITION", lots: "RF_INVALID_LOT", transfers: "RF_INVALID_TRANSFER", fgBoxes: "RF_INVALID_BOX", qcRecords: "RF_INVALID_QC", ncrs: "RF_INVALID_NCR", molds: "RF_INVALID_MOLD" };
  // ชุดหน้างาน: เลขที่/รหัสของเอกสาร (lotNo ของล็อตวัตถุดิบ, id ของที่เหลือ)
  for (const list of RF_LISTS.slice(3)) RF_CODE[list] = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  // ช่องที่ฐานข้อมูลประทับ/คำนวณเอง ต่อชุด: ระเบียนที่ต่างจากของเดิมเฉพาะช่องเหล่านี้ถือว่าไม่มีอะไรเปลี่ยน (ไม่ตรวจชน ไม่ตรวจสิทธิ์ ไม่เพิ่มเวอร์ชัน)
  const RF_NOOP = {
    materials: RF_MATERIAL_STAMPS, recipes: RF_RECIPE_STAMPS, orders: [...RF_ORDER_STAMPS, "producedQty"],
    materialLots: ["qtyKg", "receivedAt", "receivedBy"], requisitions: ["requestedBy", "createdAt", "issuedAt", "issuedBy"],
    lots: ["operator", "createdAt", "transferredQty", "countedToOrder"], transfers: ["remaining", "createdAt", "createdBy", "receivedAt", "receivedBy"],
    fgBoxes: ["createdAt", "shippedAt", "shippedBy"], qcRecords: ["inspector", "at"], ncrs: ["createdAt", "createdBy", "closedAt", "closedBy"], molds: ["totalUsage"],
  };
  // ใบเบิก: เวลา/ผู้ชั่งของแต่ละรายการเป็นตราของฐานข้อมูล
  const rfNorm = (list, record) => (list === "requisitions" && Array.isArray(record?.lines) ? { ...record, lines: record.lines.map((line) => bomWithout(line, ["weighedAt", "weighedBy"])) } : record);
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
    return out;
  };
  const rfStagesValid = (stages) => Array.isArray(stages) && stages.length === 2
    && stages.every((row, index) => row && typeof row === "object" && row.stage === index + 1
      && [row.mixerTemp, row.dumpTemp].every((value) => typeof value === "number" && value >= 0 && value <= 1000)
      && typeof row.mixMin === "number" && row.mixMin > 0 && row.mixMin <= 1440);
  const rfSame = (a, b, owned) => bomCanon(bomWithout(a, owned)) === bomCanon(bomWithout(b, owned));

  // บันทึกการเปลี่ยนแปลงทั้งชุดในธุรกรรมเดียว (ตรงกับ app_rf_save): คืน { next, ops, wrote } โดย ops = งานของ BOM ที่ต้องเขียนต่อเมื่อบันทึกสำเร็จ (ผูกงาน / ป้อนยอดผลิตกลับ / ล้างการผูกตอนยกเลิก)
  // wrote = จำนวนระเบียนที่เขียนจริง (0 = ทุกเรคอร์ดตรงกับที่เก็บ ไม่ต้องเพิ่มเวอร์ชัน)
  function rfApply(current, changes, base, actor, at) {
    const next = clone(current);
    const nextVersion = current.version + 1;
    const mine = new Set();
    const stale = (list, id) => (next.versions[list][id] ?? 0) > base && !mine.has(`${list}|${id}`);
    const stampVersion = (list, id) => { next.versions[list][id] = nextVersion; mine.add(`${list}|${id}`); };
    const planner = bomIsPlanner(actor);
    const master = planner || rfIsRb(actor);
    const head = rfIsHead(actor);
    const approvedNow = [];
    const supersededSent = [];
    const ops = { link: [], receive: [], unlink: [] };
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
        if (list === "materials" || list === "recipes") fail("RF_FORBIDDEN");
        if (list === "orders" && entry.upsert.some((row) => { const old = current.orders.find((order) => order.id === row?.id); return !old || !rfSame(old, row, RF_NOOP.orders); })) fail("RF_FORBIDDEN");
      }
    }
    // ---- ชุดหน้างาน 8 ชุด (ล็อตวัตถุดิบ ใบเบิก ล็อตผลิต ใบส่งมอบ กล่อง ผลตรวจ NCR แม่พิมพ์) ----
    // สิทธิ์รายชุดและรายช่อง (เทียบระเบียนเดิมกับระเบียนใหม่) · ตัวเลขที่ฐานข้อมูลคำนวณเอง (สต็อกล็อตหลังชั่ง คงเหลือ/ยอดส่งต่อของใบส่งมอบ ยอดผลิตของใบสั่งผลิต การใช้แม่พิมพ์ สถานะกล่องตามผล QC)
    // ไม่เชื่อค่าที่ client ส่ง: ระเบียนที่ต่างจากของเดิมเฉพาะช่องเหล่านี้ถือว่าไม่มีอะไรเปลี่ยน (ข้าม) ค่าจริงมากับส่วนต่างที่ตอบกลับ · ตราผู้บันทึก/เวลาประทับใหม่ทับค่าที่ client ส่ง
    // กฎสเปก/FEFO/ความคลาดเคลื่อนการชั่งใช้ไฟล์ของหน้า (modules/rubberflow-rules.js โหลดก่อน) · เรียกตอนใช้จริงเท่านั้น
    const R = new Proxy({}, { get: (_, key) => (globalThis.MNP_RUBBERFLOW_RULES ?? fail("RF_RULES_MISSING"))[key] });
    const inDept = (dept) => planner || actor.dept === dept; // สมาชิกแผนกนั้น หรือกลุ่มวางแผน (ทำได้ทุกอย่าง)
    const claims = []; // ใบเบิก issued → consumed ต้องมาพร้อมล็อตผสมที่เพิ่มในคำสั่งเดียวกัน
    const mixingNew = [];
    const finishingNew = new Set(); // ล็อตตกแต่งที่เพิ่มในคำสั่งนี้ (ฐานข้อมูลสร้างกล่องให้เอง กล่องที่ client ส่งมาเมิน)
    const qcFor = new Set((changes.qcRecords?.upsert ?? []).map((row) => row?.lotId));
    const ncrFor = new Set((changes.ncrs?.upsert ?? []).map((row) => row?.lotId));
    const qcNew = [];
    const touchedOrders = new Set();
    const round3 = (value) => Math.round(value * 1000) / 1000;
    const shop = (list, prev, record, index) => {
      const bad = RF_BAD[list];
      const rows = next[list];
      const put = (row) => { if (prev) rows[index] = row; else rows.push(row); };
      const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : fail(bad));
      const blank = (value) => String(value ?? "").trim() === "";
      if (list === "materialLots") {
        if (!["available", "hold"].includes(record.status)) fail(bad);
        if (!prev) {
          if (!inDept("ST")) fail("RF_FORBIDDEN");
          const material = next.materials.find((row) => row.code === record.materialCode);
          if (!material || material.active === false) fail(bad);
          if (!(num(record.qtyKg) > 0) || record.initialKg !== record.qtyKg || num(record.expiry) <= at) fail(bad);
          if (record.status !== "available") fail("RF_INVALID_TRANSITION");
          put({ ...clone(record), receivedAt: at, receivedBy: actor.name });
          return null;
        }
        if (!(inDept("ST") || actor.dept === "QA")) fail("RF_FORBIDDEN");
        if (!rfSame(prev, record, ["status", ...RF_NOOP.materialLots])) fail(bad);
        put({ ...prev, status: record.status });
        return null;
      }
      if (list === "requisitions") {
        if (!master) fail("RF_FORBIDDEN");
        if (!prev) {
          if (record.status !== "weighing") fail("RF_INVALID_TRANSITION");
          const order = next.orders.find((row) => row.id === record.orderId);
          if (!order || !["released", "in_progress"].includes(order.status)) fail(bad);
          if (!Number.isInteger(record.batches) || record.batches < 1 || record.batches > 10) fail(bad);
          const recipe = next.recipes.find((row) => row.id === order.recipeId && row.revision === order.recipeRevision);
          if (!recipe) fail(bad);
          // FEFO ในธุรกรรมเดียวกับการสร้างใบ: หักที่ใบเบิกอื่นจองไว้ (รายการที่ยังไม่ชั่ง) · ฐานข้อมูลจัดสรรเอง ไม่เชื่อรายการล็อตที่ client ส่ง
          const reserved = {};
          for (const open of next.requisitions) for (const line of open.status === "weighing" ? open.lines : []) if (line.actualKg === null) reserved[line.lotNo] = (reserved[line.lotNo] || 0) + line.targetKg;
          const lines = [];
          for (const item of R.recipeLines(recipe)) {
            const { picks, shortage } = R.allocateFefo(next.materialLots, item.materialCode, item.kgPerBatch * record.batches, at, reserved);
            if (shortage > 0.0001) fail("RF_INSUFFICIENT_STOCK");
            for (const pick of picks) {
              reserved[pick.lotNo] = (reserved[pick.lotNo] || 0) + pick.kg;
              lines.push({ materialCode: item.materialCode, stage: item.stage, lotNo: pick.lotNo, targetKg: pick.kg, actualKg: null, weighedAt: null });
            }
          }
          put({ ...clone(record), recipeId: recipe.id, recipeRevision: recipe.revision, totalKg: recipe.batchKg * record.batches, lines, status: "weighing", requestedBy: actor.name, createdAt: at });
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
          // ชั่งนอกเกณฑ์ไม่รับ · ล็อตต้องใช้ได้และพอ · สต็อกหักทันทีที่ชั่งรายการนั้น
          if (Math.abs(kg - old.targetKg) > R.weighTolerance(old.targetKg) + 1e-9) fail("RF_OUT_OF_TOLERANCE");
          const lotIndex = next.materialLots.findIndex((row) => row.lotNo === old.lotNo);
          const lot = next.materialLots[lotIndex];
          if (!lot || R.lotState(lot, at) !== "available" || lot.qtyKg + 1e-9 < kg) fail("RF_LOT_UNAVAILABLE");
          next.materialLots[lotIndex] = { ...lot, qtyKg: Math.round((lot.qtyKg - kg) * 1e6) / 1e6 };
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
          if (!rfSame(prev, record, [...RF_NOOP.lots, "qc", "holdReasons", "readyAt"])) fail(bad);
          const out = { ...prev };
          // ข้ามเวลาบ่ม: ฐานข้อมูลตั้งเวลาครบบ่มเป็นเวลาของเซิร์ฟเวอร์ (client บอกได้แค่ว่าให้ครบ)
          if (record.readyAt !== prev.readyAt) {
            if (!master) fail("RF_FORBIDDEN");
            if (prev.stage !== "mixing" || !(num(record.readyAt) < prev.readyAt) || !(prev.readyAt > at)) fail(bad);
            out.readyAt = at;
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
            if (prev.stage === "finishing" && record.qc === "pass" && !prev.countedToOrder) { out.countedToOrder = true; touchedOrders.add(prev.orderId); }
          }
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
            for (const key of keys) if (!R.inSpec(params[key], R.SPECS.extrusion[key])) reasons.push(`${R.SPECS.extrusion[key].label} ${params[key]} ${R.SPECS.extrusion[key].unit} นอกสเปก`);
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
            const perBox = num(record.params.perBox);
            if (!(perBox > 0) || good + scrap > use + 1e-9 || !["pass", "hold", "fail"].includes(record.qc)) fail(bad);
            if (record.qc !== "pass") reasons.push(...(Array.isArray(record.holdReasons) && record.holdReasons.length ? record.holdReasons.map((reason) => String(reason).slice(0, 200)).slice(0, 20) : ["ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน"]));
            out.qc = record.qc;
            out.countedToOrder = record.qc === "pass";
            // กล่อง: ฐานข้อมูลสร้างเองจากล็อต (ใบละไม่เกิน perBox ชิ้น กล่องสุดท้ายเศษ) id = เลขล็อต (FN → BOX) ต่อด้วยลำดับ 3 หลัก
            const count = good > 0 ? Math.ceil(good / perBox - 1e-9) : 0;
            if (count > 1000) fail(bad);
            out.grade = String(record.grade ?? "").trim().slice(0, 20) || "A";
            out.boxes = count;
            finishingNew.add(record.id);
            for (let n = 1; n <= count; n += 1) {
              const box = {
                id: `${record.id.replace("FN", "BOX")}-${String(n).padStart(3, "0")}`, lotId: record.id, orderId: order.id, recipeId: order.recipeId, productCode: order.productCode ?? "",
                qty: round3(Math.min(perBox, good - (n - 1) * perBox)), uom: order.uom, grade: out.grade, status: record.qc === "pass" ? "in_stock" : "hold", createdAt: at,
              };
              next.fgBoxes.push(box);
              stampVersion("fgBoxes", box.id);
            }
            if (out.countedToOrder) touchedOrders.add(order.id);
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
        if (!inDept("SR")) fail("RF_FORBIDDEN");
        if (prev.status !== "in_transit" || record.status !== "received") fail("RF_INVALID_TRANSITION");
        if (!rfSame(prev, record, ["status", "qtyReceived", "condition", ...RF_NOOP.transfers])) fail(bad);
        const received = num(record.qtyReceived);
        if (received < 0 || received > prev.qtySent * 1.02) fail(bad);
        put({ ...prev, status: "received", qtyReceived: received, remaining: received, condition: record.condition || "ok", receivedAt: at, receivedBy: actor.name });
        // BOM: ยอดที่รับถูกรายงานเข้างานที่ผูกใบสั่งผลิตนี้ ในธุรกรรมเดียวกัน (ทีละใบส่งมอบ)
        ops.receive.push({ woId: prev.orderId, transferId: prev.id, qty: received, uom: prev.uom });
        return null;
      }
      if (list === "fgBoxes") {
        if (!prev) {
          if (!master) fail("RF_FORBIDDEN");
          // กล่องเกิดจากล็อตตกแต่งที่เพิ่งบันทึกในคำสั่งเดียวกันเท่านั้น (ฐานข้อมูลสร้างให้แล้ว) ไม่ใช่จาก client
          if (finishingNew.has(record.lotId)) return "skip";
          fail(bad);
        }
        // in_stock ↔ hold ตามผล QC ของล็อต ฐานข้อมูลตั้งเอง ไม่รับจาก client
        if (["in_stock", "hold"].includes(prev.status) && ["in_stock", "hold"].includes(record.status)) return "skip"; // ช่องอื่นของกล่องเป็นของฐานข้อมูล client ส่งมาเมิน
        if (prev.status !== "in_stock" || record.status !== "shipped") fail("RF_INVALID_TRANSITION");
        if (!inDept("WH")) fail("RF_FORBIDDEN");
        if (!rfSame(prev, record, ["status", ...RF_NOOP.fgBoxes])) fail(bad);
        put({ ...prev, status: "shipped", shippedAt: at, shippedBy: actor.name });
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
        qcNew.push({ lotId: lot.id, result: record.result });
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
        if (prev && rfSame(rfNorm(list, prev), rfNorm(list, record), RF_NOOP[list])) continue;
        // ชนก่อนสิทธิ์/เนื้อหาเสมอ: ระเบียนถูกผู้อื่นแก้/เพิ่มหลัง base (รวมเลข WO ซ้ำ) = ฝั่ง client ถือสำเนาเก่า ต้องได้ RF_STALE ไม่ใช่ RF_FORBIDDEN
        if (prev && stale(list, id)) fail("RF_STALE");
        if (list === "materials") {
          rfText(record.name, 160, bad);
          if (record.active !== undefined && record.active !== null && typeof record.active !== "boolean") fail(bad);
          // รหัสที่ต่างจากของเดิมแค่ตัวพิมพ์ = ซ้ำ
          if (!prev && next.materials.some((row) => row.code.toUpperCase() === record.code.toUpperCase())) fail("RF_CONFLICT");
          const out = { ...clone(record), createdAt: prev?.createdAt ?? at, createdBy: prev?.createdBy ?? actor.name, updatedAt: at, updatedBy: actor.name };
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
            if (!master) fail("RF_FORBIDDEN");
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
            if (to === "released" && from !== to && !(planner || head)) fail("RF_FORBIDDEN");
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
    // ---- ตรวจความครบของคำสั่ง และคำนวณตัวเลขที่ฐานข้อมูลคำนวณเอง ----
    // ใบเบิกที่ถูกใช้ผสม (issued → consumed) กับล็อตผสมที่เพิ่ม ต้องมาคู่กัน
    for (const claim of claims) if (!mixingNew.some((row) => row.lot === claim.lot && row.req === claim.req)) fail("RF_INVALID_TRANSITION");
    for (const row of mixingNew) if (!claims.some((claim) => claim.lot === row.lot && claim.req === row.req)) fail("RF_INVALID_TRANSITION");
    // ผลตรวจ: ผลตัดสินต้องตรงกับสถานะ QC ของล็อตหลังบันทึก · กล่องที่ยังไม่ส่งตามผล QC (ผ่าน = พร้อมส่ง ไม่ผ่าน/รอตัดสิน = hold)
    for (const item of qcNew) {
      const lot = next.lots.find((row) => row.id === item.lotId);
      if (!lot || lot.qc !== item.result) fail("RF_INVALID_QC");
      next.fgBoxes.forEach((box, i) => {
        const status = lot.qc === "pass" ? "in_stock" : "hold";
        if (box.lotId === lot.id && box.status !== "shipped" && box.status !== status) { next.fgBoxes[i] = { ...box, status }; stampVersion("fgBoxes", box.id); }
      });
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
    if (!ops.link.length && !ops.receive.length && !ops.unlink.length) return;
    const bom = bomLoad();
    const version = bom.version + 1;
    const jobs = new Set();
    const orders = new Set();
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
    // SR รับมอบใบส่งมอบ: รายงาน good = ยอดที่รับ (ล็อตหน่วยกิโลกรัมแต่ WO นับเป็นหน่วยอื่น = หาร kgPerUnit) qtyDone = เดิม + good · ทีละใบส่งมอบ ไม่จำกัดครั้งต่อ WO
    // ข้ามเมื่อ WO ไม่ได้ผูกงาน / ไม่พบงาน / งานไม่ชี้มา WO นี้ / ใบ PI ไม่ใช่ released-in_progress / งาน done แล้ว / ยอดที่รับเป็น 0
    for (const item of ops.receive) {
      const wo = rfMaster.orders.find((row) => row.id === item.woId);
      const job = wo?.sourceJobId ? bom.jobs.find((row) => row.id === wo.sourceJobId) : null;
      const order = job ? bom.orders.find((row) => row.id === job.orderId) : null;
      if (!job || job.externalRef?.woId !== item.woId || !["released", "in_progress"].includes(order?.status) || job.status === "done") continue;
      const perUnit = Number(wo.kgPerUnit);
      const good = Math.round((item.uom === "kg" && wo.uom !== "kg" && perUnit > 0 ? item.qty / perUnit : item.qty) * 1e4) / 1e4;
      if (!(good > 0)) continue;
      job.reports = [...(job.reports ?? []), { at, by: actor.name, good, reject: 0, note: `รับโอน ${item.transferId} จาก WO ${item.woId}` }];
      job.qtyDone = Math.round((Number(job.qtyDone) + good) * 1e4) / 1e4;
      job.status = job.qtyDone + 1e-9 >= Number(job.qtyPlanned) ? "done" : "in_progress";
      if (job.status === "done") job.doneAt = job.doneAt ?? at; else delete job.doneAt;
      touchJob(job);
      startOrder(job);
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
    if (!jobs.size && !orders.size) return;
    bom.version = version;
    const detail = [jobs.size ? `jobs +${jobs.size}` : "", orders.size ? `orders +${orders.size}` : ""].filter(Boolean).join(", ");
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
        if (!wo || !["planned", "released"].includes(wo.status)) continue;
        wo.status = "cancelled";
        wo.cancelledAt = at;
        rf.versions.orders[wo.id] = version;
        out.cancelled.push(wo.id);
        count += 1;
      }
      if (count) audits.push({ action: `bom:${op.action}`, count });
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
        const reason = !compoundCode ? "ไม่มีรหัสสูตรยาง" : !compound?.recipeId ? "ยังไม่ผูกสูตร RubberFlow" : !recipe ? `สูตร ${compound.recipeId} ยังไม่อนุมัติ` : !(qty > 0) ? "ไม่มียอดให้ผลิต" : !(kg > 0) ? "คำนวณกิโลกรัมไม่ได้" : "";
        if (reason) { out.skipped.push({ jobId: job.id, itemCode: job.itemCode, reason }); continue; }
        const woId = `${key}-${String(top() + 1).padStart(2, "0")}`;
        rf.orders.push({
          id: woId, customer: pi.customer, customerPo: pi.id, recipeId: recipe.id, recipeRevision: recipe.revision, productCode: recipe.productCode ?? "", uom: job.uom,
          color: String(item.rubber?.color ?? "").trim() || "ดำ", targetQty: qty, producedQty: 0, startDate: start, dueDate: Math.max(job.dueAt, start), priority: job.dueAt < at ? "urgent" : "normal",
          note: `จาก BOM งาน ${job.id} · PI ${pi.id} · ${job.itemCode} ${qty} ${job.uom} ≈ ${kg} kg · เปิดอัตโนมัติตอนปล่อยใบ`.slice(0, 300),
          status: "planned", sourceJobId: job.id, targetKg: kg, kgPerUnit: kg / qty, createdAt: at, createdBy: actor.name,
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
  const RPC = {
    app_my_approval_modules: () => request_types.map(({ code }) => ({ code })),
    app_lab_access: () => false,
    app_lab_only: () => false,
    app_bom_master() {
      if (!sandbox) fail("BOM_TEST_MODE_ONLY");
      return bomView(bomLoad());
    },
    app_bom_master_since({ p_version }) {
      if (!sandbox) fail("BOM_TEST_MODE_ONLY");
      const current = bomLoad();
      if (!Number.isInteger(p_version) || p_version < 0 || p_version > current.version) fail("BOM_INVALID_PAYLOAD");
      return bomDelta(current, p_version);
    },
    app_bom_save_master({ p_changes, p_base_version, p_action, p_audit, p_epoch }) {
      if (!sandbox) fail("BOM_TEST_MODE_ONLY");
      const actor = bomActor();
      const current = bomLoad();
      // client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (null / ไม่ส่ง = ไม่ตรวจ)
      if (p_epoch !== undefined && p_epoch !== null && p_epoch !== current.epoch) fail("BOM_RESET");
      if (!p_changes || typeof p_changes !== "object" || Array.isArray(p_changes)) fail("BOM_INVALID_CHANGES");
      if (!Number.isInteger(p_base_version) || p_base_version < 0 || p_base_version > current.version) fail("BOM_INVALID_PAYLOAD");
      if (typeof p_action !== "string" || !p_action) fail("BOM_INVALID_ACTION");
      // บันทึกการใช้งานของคำสั่งนี้ [{action, detail}] ไม่เกิน 20 รายการ ชื่อไม่เกิน 80 รายละเอียดไม่เกิน 300 ตัวอักษร
      const auditIn = p_audit === undefined || p_audit === null ? [] : p_audit;
      if (!Array.isArray(auditIn) || auditIn.length > 20 || auditIn.some((entry) => !entry || typeof entry.action !== "string" || !entry.action || entry.action.length > 80 || typeof entry.detail !== "string" || entry.detail.length > 300)) fail("BOM_INVALID_AUDIT");
      const at = now();
      const rfOps = { release: [], cancel: [] };
      const next = bomApply(current, p_changes, p_base_version, actor, at, rfOps);
      // ไม่มีการเปลี่ยนแปลงเลย = ไม่เพิ่มเวอร์ชัน (เหมือน RPC จริง) คืนส่วนต่างตั้งแต่ base
      const touched = BOM_LISTS.some((list) => (p_changes[list]?.upsert?.length ?? 0) + (p_changes[list]?.delete?.length ?? 0) > 0);
      if (!touched) return bomDelta(current, p_base_version);
      next.version = current.version + 1;
      // บรรทัดหลัก = ชื่อ action และจำนวนระเบียนต่อส่วนที่เซิร์ฟเวอร์บันทึกเอง (เหมือน app_bom_audit) · entries = ข้อความของ client เป็นหมายเหตุรอง
      const counts = Object.keys(p_changes).sort().map((key) => {
        const up = p_changes[key]?.upsert?.length ?? 0;
        const del = p_changes[key]?.delete?.length ?? 0;
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
      if (!sandbox) fail("BOM_TEST_MODE_ONLY");
      const limit = p_limit === undefined || p_limit === null ? 200 : p_limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail("BOM_INVALID_PAYLOAD");
      return [...bomLoad().audit].reverse().slice(0, limit);
    },
    // ล้างข้อมูล BOM ทดสอบทั้งหมด: เฉพาะ admin ตัวจริง (ผู้ใช้จำลอง ไม่ใช่บัญชีทดสอบที่ทำหน้าที่อยู่) ในโหมดทดสอบ · เวอร์ชันกลับเป็น 0 และมีบันทึกการล้างหนึ่งแถว
    app_sandbox_purge_bom() {
      if (!sandbox) fail("BOM_TEST_MODE_ONLY");
      if (roles.find((row) => row.id === ME.role_id)?.code !== "admin") fail("BOM_FORBIDDEN");
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
      if (!sandbox) fail("RF_TEST_MODE_ONLY");
      return rfView(rfLoad());
    },
    app_rf_master_since({ p_version }) {
      if (!sandbox) fail("RF_TEST_MODE_ONLY");
      const current = rfLoad();
      if (!Number.isInteger(p_version) || p_version < 0 || p_version > current.version) fail("RF_INVALID_PAYLOAD");
      return rfDelta(current, p_version);
    },
    app_rf_save({ p_changes, p_base_version, p_action, p_audit, p_epoch }) {
      if (!sandbox) fail("RF_TEST_MODE_ONLY");
      const actor = bomActor();
      const current = rfLoad();
      // client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (null / ไม่ส่ง = ไม่ตรวจ)
      if (p_epoch !== undefined && p_epoch !== null && p_epoch !== current.epoch) fail("RF_RESET");
      if (typeof p_action !== "string" || !RF_ACTIONS.includes(p_action)) fail("RF_INVALID_ACTION");
      if (!p_changes || typeof p_changes !== "object" || Array.isArray(p_changes)) fail("RF_INVALID_PAYLOAD");
      if (!Number.isInteger(p_base_version) || p_base_version < 0 || p_base_version > current.version) fail("RF_INVALID_PAYLOAD");
      const auditIn = p_audit === undefined || p_audit === null ? [] : p_audit;
      if (!Array.isArray(auditIn) || auditIn.length > 20 || auditIn.some((entry) => !entry || typeof entry.action !== "string" || !entry.action || entry.action.length > 80 || typeof entry.detail !== "string" || entry.detail.length > 300)) fail("RF_INVALID_PAYLOAD");
      const at = now();
      const { next, ops, wrote } = rfApply(current, p_changes, p_base_version, actor, at);
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
      if (!sandbox) fail("RF_TEST_MODE_ONLY");
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
            is_urgent: row.is_urgent, requester_name: row.requester_name, submitted_at: row.submitted_at, last_changed_at: row.updated_at,
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
      if (objectUrl && file) files.set(`${bucket}/${path}`, objectUrl(file));
      return ok({ path });
    },
    createSignedUrl: (path) => ok({ signedUrl: fileUrl(bucket, path) }),
    createSignedUrls: (paths) => ok((paths ?? []).map((path) => ({ path, signedUrl: fileUrl(bucket, path), error: fileUrl(bucket, path) ? null : "Object not found" }))),
    remove: (paths) => ok((paths ?? []).map((path) => ({ name: path }))),
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
  return { client, db };
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
  const { client } = create({
    empty: new win.URLSearchParams(win.location.search).has("empty"),
    sandbox: Boolean(options.sandbox) || new win.URLSearchParams(win.location.search).has("sandbox"),
    storage: (() => { try { return win.localStorage; } catch { return null; } })(),
    warn: (message) => win.console.warn(message),
    objectUrl: (file) => win.URL.createObjectURL(file),
  });
  win.supabase = { createClient: () => client };
}

export function mockSupabaseScript({ sandbox = false } = {}) {
  return `(() => {\n${createMockSupabase.toString()}\n(${installMockSupabase.toString()})(window, createMockSupabase, ${JSON.stringify({ sandbox })});\n})();\n`;
}
