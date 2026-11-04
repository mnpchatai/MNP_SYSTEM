// Supabase จำลองของ /pilot-shell.html (scripts/pilot-harness.mjs): ข้อมูลตัวอย่างอยู่ในหน่วยความจำของหน้า เขียนแล้วอ่านกลับได้ทันที
// (อนุมัติ/ไม่อนุมัติ/ขอข้อมูลเพิ่ม ส่งข้อมูลกลับ เปลี่ยนสถานะ สร้างคำร้อง/ใบแจ้งซ่อม ขั้นตอนงานซ่อม) และหายเมื่อโหลดหน้าใหม่ ไม่เก็บลง localStorage
//
// createMockSupabase และ installMockSupabase ต้องไม่อ้างตัวแปรนอกฟังก์ชันของตัวเอง เพราะ mockSupabaseScript() ส่งซอร์สของทั้งสอง
// (Function#toString) ให้เบราว์เซอร์เป็น /harness-mock-supabase.js ส่วน scripts/tests/pilot-harness-mock.test.mjs import ไปทดสอบตรงๆ
// สิทธิ์ที่ตรวจในนี้เป็นแค่ส่วนที่หน้าจอต้องเห็น (ขั้นของฉัน ขั้นปัจจุบัน ความเห็นบังคับ ลำดับสถานะ) ใช้รหัส error เดียวกับ RPC จริงเพื่อให้ข้อความตรงกัน
// แต่หลวมกว่า RPC จริง เช่น การมอบหมายช่างครั้งแรกไม่บังคับแผนดำเนินงาน/วันที่ และลิงก์ "ดาวน์โหลด" ไฟล์แนบใช้ไม่ได้ (data:/blob: URL)

// sandbox = admin อยู่ในโหมดทดสอบ (?sandbox=1): ผู้ใช้จำลองเป็น admin และทำหน้าที่เป็นบัญชีทดสอบ จึงเห็นโมดูลทดสอบ (RubberFlow, BOM)
export function createMockSupabase({ empty = false, sandbox = false, now = () => Date.now(), warn = () => {}, objectUrl = null } = {}) {
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
    ["role-admin", "admin", "ผู้ดูแลระบบ"],
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

  const RPC = {
    app_my_approval_modules: () => request_types.map(({ code }) => ({ code })),
    app_lab_access: () => false,
    app_lab_only: () => false,
    // โหมดทดสอบ: ทำหน้าที่เป็นบัญชีทดสอบ (ใช้แถวของผู้ใช้จำลองเอง) — หน้าเว็บตั้ง state.employee เป็น persona นี้
    app_sandbox_status: () => {
      if (!sandbox) return null;
      const persona = { ...expand("employees", ME), id: "persona-1", job_title: "บัญชีทดสอบ ผู้จัดการแผนก" };
      return { active: true, persona, personas: [persona] };
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
export function installMockSupabase(win, create) {
  Object.defineProperty(win.navigator, "serviceWorker", { value: { register: () => Promise.resolve(), getRegistration: () => Promise.resolve(undefined), ready: new Promise(() => {}) } });
  const realFetch = win.fetch.bind(win);
  win.fetch = (input, init) => {
    let sameOrigin = false;
    try { sameOrigin = new win.URL(String((input && input.url) || input), win.location.href).origin === win.location.origin; } catch { sameOrigin = false; }
    return sameOrigin ? realFetch(input, init) : Promise.resolve(new win.Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  };
  const { client } = create({
    empty: new win.URLSearchParams(win.location.search).has("empty"),
    sandbox: new win.URLSearchParams(win.location.search).has("sandbox"),
    warn: (message) => win.console.warn(message),
    objectUrl: (file) => win.URL.createObjectURL(file),
  });
  win.supabase = { createClient: () => client };
}

export function mockSupabaseScript() {
  return `(() => {\n${createMockSupabase.toString()}\n(${installMockSupabase.toString()})(window, createMockSupabase);\n})();\n`;
}
