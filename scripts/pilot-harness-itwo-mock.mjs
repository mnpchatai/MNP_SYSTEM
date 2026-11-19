// ฐานข้อมูลจำลองของใบสั่งงาน IT (RPC app_itwo_* ของ supabase/migrations/20261203010000_itwo_work_orders.sql + 20261204010000_itwo_v2_rework_files.sql) สำหรับ /pilot-shell.html?sandbox=1&itwo=1
// ข้อมูลอยู่ในหน่วยความจำของหน้า (หายเมื่อโหลดหน้าใหม่) ใช้ลองหน้าจอ ไม่ใช่ตัวแทนฐานข้อมูลจริง: กฎเส้นทางอนุมัติ/ปุ่มที่ทำได้ตรงกับ migration
// (ผู้แจ้งเป็นผู้จัดการแผนก / แผนก IT / แผนกไม่มีผู้จัดการ / ผู้อนุมัติขั้น IT แจ้งเอง) แต่ตรวจสิทธิ์หลวมกว่า (ไม่มี RLS/ล็อก)
// รุ่น 2: ไม่รับประเภท system_access · เบ็ดเตล็ดต้องระบุงาน · แนบไฟล์ (app_itwo_add_attachment) · ขอแก้ไขงาน (app_itwo_request_rework) · ล้างข้อมูลทดสอบคืนรายการไฟล์
//
// createItwoMock ต้องไม่อ้างตัวแปรนอกฟังก์ชันของตัวเอง เพราะ mockSupabaseScript() ส่งซอร์สของมัน (Function#toString) ให้เบราว์เซอร์
// env = { fail(code|message), stamp() → ISO, now() → ms, persona() → แถว persona ปัจจุบัน, personas() → รายการ persona ทั้งหมด,
//         hasObject?(bucket, path) → ไฟล์อยู่ใน Storage จำลองไหน (ไม่ส่ง = ไม่ตรวจ), listObjects?(bucket) → path ของไฟล์ในบัคเก็ต }
// persona ของโมดูลนี้ (SBX-IT-*) มี id persona-it-staff / persona-it-admin / persona-it-approver · persona อื่นเป็นผู้แจ้ง (ผู้จัดการแผนก = role.code department_manager)
export function createItwoMock(env) {
  const { stamp, now } = env;
  // ข้อความไทยของฐานข้อมูลโยนเป็น Error ที่มี code เหมือน raise exception ... using errcode
  const reject = (message, code = "23514") => { throw Object.assign(new Error(message), { code }); };
  const IT_ADMIN_IDS = new Set(["persona-it-admin"]);
  const IT_APPROVER_IDS = new Set(["persona-it-approver"]);
  const TEST_BUCKET = "itwo-test-files";
  const ATTACH_WINDOW_MS = 30 * 60 * 1000;
  const MAX_FILES_PER_ROUND = 10;
  const MAX_FILE_BYTES = 20971520;
  // ตรงกับ private.itwo_allowed_mime_types / private.itwo_file_path_order_id
  const ALLOWED_MIME = [
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword", "application/vnd.ms-excel", "text/plain", "text/csv",
  ];
  const PATH_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|pdf|docx|xlsx|pptx|doc|xls|txt|csv)$/;
  const orders = [];
  const events = [];
  const access = new Map(); // ข้อมูลสิทธิ์ในระบบของใบเก่า (ถอดส่วนนี้แล้ว: ไม่มีทางเขียนใหม่ มีไว้ให้ทดสอบการแสดงผลอ่านอย่างเดียวผ่าน seedAccess)
  const reworks = [];
  const attachments = [];
  let eventId = 0;
  let uuidSeq = 0;
  const counter = { year: new Date(now() + 7 * 3600000).getUTCFullYear(), last: 0 };
  // ทีม IT ที่ seed ไว้ (SBX-IT-ADMIN, SBX-IT-APPROVER) · ค่าเริ่มต้นของโหมดทดสอบ
  const staff = [
    { employee_id: "persona-it-admin", employee_no: "SBX-IT-ADMIN", full_name: "ทดสอบ IT ผู้ดูแลงาน", department_name: "เทคโนโลยีสารสนเทศ", is_it_admin: true, is_it_approver: false, is_active: false },
    { employee_id: "persona-it-approver", employee_no: "SBX-IT-APPROVER", full_name: "ทดสอบ ผู้อนุมัติขั้น IT", department_name: "ฝ่ายบริหาร", is_it_admin: true, is_it_approver: true, is_active: false },
  ];

  const nameOf = (persona) => `${persona.first_name} ${persona.last_name}`;
  const deptOf = (persona) => persona?.department?.code ?? "";
  const deptNameOf = (persona) => persona?.department?.name_th ?? "";
  const isManager = (persona) => ["department_manager", "assistant_department_manager"].includes(persona?.role?.code);
  const isItAdmin = (persona) => IT_ADMIN_IDS.has(persona.id) || staff.some((row) => row.employee_id === persona.id && row.is_it_admin);
  const isItApprover = (persona) => IT_APPROVER_IDS.has(persona.id) || staff.some((row) => row.employee_id === persona.id && row.is_it_approver);
  const isStaff = (persona) => isItAdmin(persona) || isItApprover(persona);
  const deptApprovers = (dept) => env.personas().filter((persona) => deptOf(persona) === dept && isManager(persona)).map((persona) => persona.id);
  const byId = (id) => env.personas().find((persona) => persona.id === id);
  const actor = () => env.persona();
  const docNo = (year, seq) => `TEST-IT06-${String(year % 100).padStart(2, "0")}/${seq < 1000 ? String(seq).padStart(3, "0") : seq}`;
  const newId = () => `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, "0")}`;

  const eventsOf = (order) => events.filter((event) => event.work_order_id === order.id);
  const reworksOf = (order) => reworks.filter((round) => round.work_order_id === order.id);
  const stateOf = (order) => {
    const list = eventsOf(order);
    return { deptDone: list.some((e) => e.action === "dept_approved"), itDone: list.some((e) => e.action === "it_mgr_approved"), rejected: list.some((e) => ["dept_rejected", "it_mgr_rejected"].includes(e.action)) };
  };
  const addEvent = (order, who, action, reason = null) => events.push({ id: ++eventId, work_order_id: order.id, actor_id: who.id, action, reason, created_at: stamp() });
  const todayTh = () => new Date(now() + 7 * 3600000).toISOString().slice(0, 10);
  // ใบนี้มีการอนุมัติจริงจากผู้อื่นแล้วไหม (ตรงกับ private.itwo_has_real_approval)
  const hasRealApproval = (order) => eventsOf(order).some((e) => ["dept_approved", "it_mgr_approved"].includes(e.action) && e.actor_id !== order.requester_id);
  const withinWindow = (isoCreatedAt) => now() - Date.parse(isoCreatedAt) <= ATTACH_WINDOW_MS;

  // ตรงกับ private.itwo_approval_caps
  function caps(order, who) {
    const { deptDone, itDone, rejected } = stateOf(order);
    const deptIsIt = order.department_code === "IT";
    const approvers = deptApprovers(order.department_code);
    const hasDeptApprovers = approvers.some((id) => id !== order.requester_id);
    const actorIsDeptRole = approvers.includes(who.id);
    const open = order.requester_id !== who.id && ["pending_dept", "pending_it_mgr", "in_progress"].includes(order.status) && !rejected;
    return {
      canDept: open && !deptIsIt && actorIsDeptRole && !deptDone,
      canIt: open && isItApprover(who) && !itDone && (deptDone || deptIsIt || !hasDeptApprovers || actorIsDeptRole),
    };
  }
  // ตรงกับ private.itwo_allowed_actions (รุ่น 2: ไม่มี edit_access · it_closed ผู้แจ้งรับงานหรือขอแก้ไขได้)
  function allowed(order, who) {
    const list = [];
    const admin = isItAdmin(who);
    const pending = ["pending_dept", "pending_it_mgr"].includes(order.status);
    const { deptDone, itDone } = stateOf(order);
    if (order.requester_id === who.id && ["pending_dept", "pending_it_mgr", "approved", "in_progress"].includes(order.status)) list.push("cancel");
    const c = caps(order, who);
    if (c.canDept || c.canIt) list.push("approve", "reject");
    if (admin && (order.status === "approved" || (order.is_urgent && pending))) list.push("start");
    if (admin && order.status === "in_progress" && deptDone && itDone) list.push("complete");
    if (order.requester_id === who.id && order.status === "it_closed") list.push("receive", "request_rework");
    return list;
  }
  function canView(order, who) {
    return order.requester_id === who.id || isStaff(who) || deptApprovers(order.department_code).includes(who.id);
  }
  const find = (id) => orders.find((order) => order.id === id) ?? reject("ไม่พบใบสั่งงานนี้");
  const clean = (text) => { const value = String(text ?? "").trim(); return value === "" ? null : value; };
  const latestRework = (order) => reworksOf(order).reduce((best, round) => (!best || round.round_no > best.round_no ? round : best), null);
  const personName = (id) => { const person = byId(id); return person ? nameOf(person) : ""; };

  function decide(id, approve, reasonText) {
    const who = actor();
    const order = find(id);
    const reason = clean(reasonText);
    if (!approve && !reason) reject("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
    const c = caps(order, who);
    if (!c.canDept && !c.canIt) reject("คุณไม่มีสิทธิ์อนุมัติใบสั่งงานนี้ในขั้นนี้ หรือใบนี้ไม่ได้อยู่ในขั้นที่รออนุมัติ", "42501");
    const { deptDone } = stateOf(order);
    if (approve) {
      if (c.canDept) addEvent(order, who, "dept_approved");
      else if (c.canIt && !deptDone) addEvent(order, who, "dept_approved", "ผู้อนุมัติขั้น IT อนุมัติแทนทั้งสองขั้น");
      if (c.canIt) addEvent(order, who, "it_mgr_approved");
      const after = stateOf(order);
      if (after.deptDone && after.itDone) { if (order.status !== "in_progress") order.status = "approved"; }
      else if (after.deptDone && order.status === "pending_dept") order.status = "pending_it_mgr";
    } else {
      addEvent(order, who, c.canIt && !c.canDept ? "it_mgr_rejected" : "dept_rejected", reason);
      order.status = "rejected";
    }
  }

  const listFields = (order) => {
    const round = latestRework(order);
    return { misc_detail: order.misc_detail, rework_round: round ? round.round_no : 0, rework_due_date: round ? round.due_date : null };
  };

  const handlers = {
    app_itwo_my_role() {
      const who = actor();
      return {
        employee_id: who.id, employee_no: who.employee_no, full_name: nameOf(who), is_test: true,
        department: { id: deptOf(who), code: deptOf(who), name_th: deptNameOf(who) },
        is_it_department: deptOf(who) === "IT",
        is_dept_approver: isManager(who), is_it_admin: isItAdmin(who), is_it_approver: isItApprover(who),
      };
    },
    app_itwo_create({ p_request_type, p_order_ref, p_attachment_flag, p_attachment_note, p_details, p_needed_date, p_is_urgent, p_misc_detail = null }) {
      const who = actor();
      if (!["design", "system_access", "misc"].includes(p_request_type)) reject("กรุณาเลือกประเภทคำขอ");
      if (p_request_type === "system_access") reject("ใบสั่งงาน IT ไม่รับประเภท \"สิทธิ์การใช้งานในระบบคอมพิวเตอร์\" แล้ว (แยกเป็นโมดูลขอสิทธิ์ต่างหาก)");
      const miscDetail = p_request_type === "misc" ? clean(p_misc_detail) : null;
      if (p_request_type === "misc" && !miscDetail) reject("กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร");
      if (miscDetail && [...miscDetail].length > 200) reject("งานเบ็ดเตล็ดต้องไม่เกิน 200 ตัวอักษร");
      if (!["yes", "no", "other"].includes(p_attachment_flag)) reject("กรุณาเลือกเอกสารแนบ (มี / ไม่มี / อื่นๆ)");
      if (!clean(p_details)) reject("กรุณากรอกรายละเอียดงาน");
      if (p_attachment_flag === "other" && !clean(p_attachment_note)) reject("กรุณาระบุรายละเอียดเอกสารแนบ (เมื่อเลือก \"อื่นๆ\")");
      if (!p_needed_date) reject("กรุณาระบุวันที่ต้องการงาน");
      if (p_needed_date < todayTh()) reject("วันที่ต้องการงานต้องไม่ใช่วันที่ผ่านมาแล้ว");
      const dept = deptOf(who);
      const approvers = deptApprovers(dept);
      const actorIsDeptRole = approvers.includes(who.id);
      const hasDeptApprovers = approvers.some((id) => id !== who.id);
      let status;
      if (isItApprover(who)) status = "approved";
      else if (dept === "IT" || actorIsDeptRole || !hasDeptApprovers) status = "pending_it_mgr";
      else status = "pending_dept";
      counter.last += 1;
      const order = {
        id: newId(), is_test: true, doc_no: docNo(counter.year, counter.last), doc_year: counter.year, doc_seq: counter.last,
        requester_id: who.id, department_code: dept, department_name: deptNameOf(who), request_type: p_request_type, misc_detail: miscDetail, order_ref: clean(p_order_ref),
        attachment_flag: p_attachment_flag, attachment_note: p_attachment_flag === "other" ? clean(p_attachment_note) : null, details: clean(p_details),
        needed_date: p_needed_date, is_urgent: Boolean(p_is_urgent), status, created_at: stamp(),
      };
      orders.push(order);
      addEvent(order, who, "created", !isItApprover(who) && dept !== "IT" && !actorIsDeptRole && !hasDeptApprovers ? "แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ส่งให้ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น" : null);
      if (isItApprover(who)) {
        addEvent(order, who, "dept_approved", "ผู้แจ้งเป็นผู้อนุมัติขั้น IT อนุมัติในตัวเมื่อแจ้งงาน");
        addEvent(order, who, "it_mgr_approved", "ผู้แจ้งเป็นผู้อนุมัติขั้น IT อนุมัติในตัวเมื่อแจ้งงาน");
      } else if (actorIsDeptRole && dept !== "IT") {
        addEvent(order, who, "dept_approved", "ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนก อนุมัติในตัวเมื่อแจ้งงาน");
      }
      return [{ id: order.id, doc_no: order.doc_no }];
    },
    app_itwo_approve({ p_work_order_id }) { decide(p_work_order_id, true, null); return null; },
    app_itwo_reject({ p_work_order_id, p_reason }) { decide(p_work_order_id, false, p_reason); return null; },
    app_itwo_cancel({ p_work_order_id, p_reason }) {
      const who = actor();
      const order = find(p_work_order_id);
      if (order.requester_id !== who.id) reject("เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบสั่งงานได้", "42501");
      if (!["pending_dept", "pending_it_mgr", "approved", "in_progress"].includes(order.status)) reject("ใบสั่งงานนี้ไม่อยู่ในขั้นที่ทำรายการนี้ได้");
      if (!clean(p_reason)) reject("กรุณาระบุเหตุผลที่ยกเลิก");
      order.status = "cancelled";
      addEvent(order, who, "cancelled", clean(p_reason));
      return null;
    },
    app_itwo_start({ p_work_order_id }) {
      const who = actor();
      const order = find(p_work_order_id);
      if (!allowed(order, who).includes("start")) reject("เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้ และใบต้องอนุมัติครบ (หรือเป็นงานด่วน)", "42501");
      order.status = "in_progress";
      addEvent(order, who, "started");
      return null;
    },
    app_itwo_complete({ p_work_order_id }) {
      const who = actor();
      const order = find(p_work_order_id);
      if (!allowed(order, who).includes("complete")) reject("ปิดงานไม่ได้ ต้องรอผู้จัดการแผนกและผู้อนุมัติขั้น IT อนุมัติครบก่อน");
      order.status = "it_closed";
      addEvent(order, who, "completed");
      return null;
    },
    app_itwo_receive({ p_work_order_id }) {
      const who = actor();
      const order = find(p_work_order_id);
      if (!allowed(order, who).includes("receive")) reject("เฉพาะผู้แจ้งเท่านั้นที่ยืนยันการรับงานได้", "42501");
      order.status = "received";
      addEvent(order, who, "received");
      return null;
    },
    // ผู้แจ้งขอแก้ไขงานตอน IT ปิดงานแล้ว: สถานะกลับเป็น in_progress ทันที (ไม่ต้องอนุมัติใหม่) · ตรงกับ public.app_itwo_request_rework
    app_itwo_request_rework({ p_work_order_id, p_details, p_due_date }) {
      const who = actor();
      const order = find(p_work_order_id);
      if (order.requester_id !== who.id) reject("เฉพาะผู้แจ้งเท่านั้นที่ขอแก้ไขงานได้", "42501");
      if (order.status !== "it_closed") reject(order.status === "received" ? "ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ขอแก้ไขไม่ได้" : "ขอแก้ไขงานได้เมื่อ IT ปิดงานแล้วเท่านั้น");
      const details = clean(p_details);
      if (!details) reject("กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข");
      if ([...details].length > 2000) reject("รายละเอียดที่ต้องการให้แก้ไขต้องไม่เกิน 2,000 ตัวอักษร");
      if (!p_due_date) reject("กรุณาระบุวันที่ต้องการให้แก้ไขเสร็จ");
      if (p_due_date < todayTh()) reject("วันที่ต้องการให้แก้ไขเสร็จต้องไม่ใช่วันที่ผ่านมาแล้ว");
      const round = { id: newId(), work_order_id: order.id, round_no: (latestRework(order)?.round_no ?? 0) + 1, details, due_date: p_due_date, requested_by: who.id, created_at: stamp() };
      order.status = "in_progress";
      reworks.push(round);
      addEvent(order, who, "rework_requested", `ขอแก้ไขงานรอบที่ ${round.round_no} ต้องการภายใน ${p_due_date.slice(8, 10)}/${p_due_date.slice(5, 7)}/${p_due_date.slice(0, 4)}: ${[...details].slice(0, 300).join("")}`);
      return [{ id: round.id, round_no: round.round_no }];
    },
    // ลงทะเบียนไฟล์ที่อัปโหลดแล้ว: ผู้แจ้งเท่านั้น · ตอนแจ้ง (flag = yes, ภายใน 30 นาที, ยังไม่มีผู้อื่นอนุมัติ) หรือรอบแก้ไขล่าสุดของตัวเอง · ≤ 10 ไฟล์ต่อครั้งที่ส่ง · เรียกซ้ำ path เดิม = คืนทะเบียนเดิม
    app_itwo_add_attachment({ p_work_order_id, p_rework_id = null, p_storage_path, p_file_name, p_mime_type, p_size_bytes }) {
      const who = actor();
      const order = find(p_work_order_id);
      if (order.requester_id !== who.id) reject("เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบสั่งงานได้", "42501");
      const match = PATH_PATTERN.exec(String(p_storage_path ?? ""));
      if (!match || match[1] !== order.id) reject("ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้");
      const fileName = clean(p_file_name);
      if (!fileName) reject("กรุณาระบุชื่อไฟล์");
      if ([...fileName].length > 200) reject("ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร");
      const existing = attachments.find((item) => item.storage_path === p_storage_path);
      if (existing) {
        if (existing.work_order_id === order.id && (existing.rework_id ?? null) === (p_rework_id ?? null)) return existing.id;
        reject("ไฟล์นี้ถูกลงทะเบียนไว้แล้ว");
      }
      if (!p_rework_id) {
        if (order.attachment_flag !== "yes") reject("ใบสั่งงานนี้ไม่ได้เลือกเอกสารแนบเป็น \"มี\" จึงแนบไฟล์ไม่ได้");
        if (!["pending_dept", "pending_it_mgr", "approved", "in_progress"].includes(order.status)) reject("ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้");
        if (!withinWindow(order.created_at)) reject("หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งงาน)");
        if (hasRealApproval(order)) reject("มีผู้อนุมัติใบสั่งงานนี้แล้ว แนบไฟล์เพิ่มไม่ได้");
        if (attachments.filter((item) => item.work_order_id === order.id && !item.rework_id).length >= MAX_FILES_PER_ROUND) reject("แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง");
      } else {
        const round = reworks.find((item) => item.id === p_rework_id && item.work_order_id === order.id) ?? reject("ไม่พบรอบขอแก้ไขงานนี้");
        if (!["in_progress", "it_closed"].includes(order.status)) reject("ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้");
        if (round.requested_by !== who.id || round.round_no !== latestRework(order).round_no) reject("แนบไฟล์ได้เฉพาะรอบขอแก้ไขงานล่าสุดของคุณ");
        if (!withinWindow(round.created_at)) reject("หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังขอแก้ไขงาน)");
        if (attachments.filter((item) => item.rework_id === p_rework_id).length >= MAX_FILES_PER_ROUND) reject("แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง");
      }
      if (env.hasObject && !env.hasObject(TEST_BUCKET, p_storage_path)) reject("ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่");
      if (!ALLOWED_MIME.includes(p_mime_type)) reject("ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)");
      if (!(p_size_bytes > 0) || p_size_bytes > MAX_FILE_BYTES) reject("ไฟล์ต้องมีขนาดไม่เกิน 20 MB");
      const row = { id: newId(), work_order_id: order.id, rework_id: p_rework_id ?? null, storage_path: p_storage_path, file_name: fileName, mime_type: p_mime_type, size_bytes: p_size_bytes, uploaded_by: who.id, created_at: stamp() };
      attachments.push(row);
      return row.id;
    },
    // ส่วน "สิทธิ์ในระบบ" ถูกถอดออกจากใบสั่งงาน: ปฏิเสธทุกครั้ง (ผู้ที่ไม่ใช่ผู้ดูแลงาน IT ได้ข้อความไม่มีสิทธิ์เหมือนฐานข้อมูล)
    app_itwo_save_access_changes() {
      if (!isItAdmin(actor())) reject("เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกส่วนสำหรับแผนก IT ได้", "42501");
      reject("ส่วนสิทธิ์ในระบบถูกถอดออกจากใบสั่งงาน IT แล้ว (จะแยกเป็นโมดูลขอสิทธิ์ต่างหาก) บันทึกเพิ่มไม่ได้");
    },
    app_itwo_get_detail({ p_work_order_id }) {
      const who = actor();
      const order = orders.find((item) => item.id === p_work_order_id);
      if (!order || !canView(order, who)) reject("ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้", "42501");
      const requester = byId(order.requester_id);
      const list = eventsOf(order).map((event) => ({ id: event.id, action: event.action, reason: event.reason, created_at: event.created_at, actor_employee_no: byId(event.actor_id)?.employee_no, actor_full_name: nameOf(byId(event.actor_id)) }));
      const firstOf = (action) => { const hit = list.find((event) => event.action === action); return hit ? { by: hit.actor_full_name, at: hit.created_at, reason: hit.reason } : null; };
      const rounds = reworksOf(order).sort((a, b) => a.round_no - b.round_no);
      const latest = latestRework(order);
      const roundNoOf = (reworkId) => rounds.find((round) => round.id === reworkId)?.round_no ?? 0;
      return {
        id: order.id, is_test: true, doc_no: order.doc_no, doc_year: order.doc_year, doc_seq: order.doc_seq, requester_id: order.requester_id, department_id: order.department_code,
        request_type: order.request_type, misc_detail: order.misc_detail, order_ref: order.order_ref, attachment_flag: order.attachment_flag, attachment_note: order.attachment_note, details: order.details,
        needed_date: order.needed_date, is_urgent: order.is_urgent, status: order.status, created_at: order.created_at,
        rework_round: latest ? latest.round_no : 0, latest_due_date: latest ? latest.due_date : order.needed_date,
        requester: { employee_no: requester.employee_no, full_name: nameOf(requester) }, department: { code: order.department_code, name_th: order.department_name },
        events: list, access_changes: access.get(order.id) ?? [],
        reworks: rounds.map((round) => ({ id: round.id, round_no: round.round_no, details: round.details, due_date: round.due_date, created_at: round.created_at, requested_by_employee_no: byId(round.requested_by)?.employee_no, requested_by_full_name: personName(round.requested_by) })),
        attachments: attachments.filter((item) => item.work_order_id === order.id)
          .sort((a, b) => roundNoOf(a.rework_id) - roundNoOf(b.rework_id) || a.created_at.localeCompare(b.created_at))
          .map((item) => ({ id: item.id, rework_id: item.rework_id, round_no: roundNoOf(item.rework_id), storage_path: item.storage_path, bucket: TEST_BUCKET, file_name: item.file_name, mime_type: item.mime_type, size_bytes: item.size_bytes, created_at: item.created_at, uploaded_by_full_name: personName(item.uploaded_by) })),
        approvals: { dept: firstOf("dept_approved"), it_mgr: firstOf("it_mgr_approved") }, allowed_actions: allowed(order, who),
      };
    },
    app_itwo_list_mine() {
      const who = actor();
      return orders.filter((order) => order.requester_id === who.id).map((order) => ({ id: order.id, doc_no: order.doc_no, status: order.status, is_urgent: order.is_urgent, request_type: order.request_type, details: order.details, needed_date: order.needed_date, created_at: order.created_at, ...listFields(order) })).reverse();
    },
    app_itwo_list_pending_approvals() {
      const who = actor();
      return orders.filter((order) => order.requester_id !== who.id && ["pending_dept", "pending_it_mgr", "in_progress"].includes(order.status) && (caps(order, who).canDept || caps(order, who).canIt))
        .sort((a, b) => Number(b.is_urgent) - Number(a.is_urgent) || a.needed_date.localeCompare(b.needed_date) || a.created_at.localeCompare(b.created_at))
        .map((order) => ({ id: order.id, doc_no: order.doc_no, request_type: order.request_type, details: order.details, needed_date: order.needed_date, is_urgent: order.is_urgent, status: order.status, created_at: order.created_at, requester_name: nameOf(byId(order.requester_id)), department_name: order.department_name, pending_step: caps(order, who).canIt ? "it_mgr" : "dept", misc_detail: order.misc_detail }));
    },
    app_itwo_pending_count() { return handlers.app_itwo_list_pending_approvals().length; },
    app_itwo_list_it() {
      const who = actor();
      if (!isStaff(who)) reject("เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้", "42501");
      const dueOf = (order) => latestRework(order)?.due_date ?? order.needed_date;
      return orders.slice().sort((a, b) => Number(b.is_urgent) - Number(a.is_urgent) || dueOf(a).localeCompare(dueOf(b)) || a.created_at.localeCompare(b.created_at))
        .map((order) => ({ id: order.id, doc_no: order.doc_no, status: order.status, is_urgent: order.is_urgent, request_type: order.request_type, details: order.details, needed_date: order.needed_date, created_at: order.created_at, requester_full_name: nameOf(byId(order.requester_id)), department_name: order.department_name, has_dept_approved: stateOf(order).deptDone, has_it_mgr_approved: stateOf(order).itDone, ...listFields(order) }));
    },
    app_itwo_get_doc_counter() {
      if (!isItAdmin(actor())) reject("เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูตัวนับเลขที่เอกสารได้", "42501");
      return { year: counter.year, last_seq: counter.last, next_seq: counter.last + 1, next_doc_no: docNo(counter.year, counter.last + 1), is_test: true };
    },
    app_itwo_set_next_doc_seq({ p_next }) {
      if (!isItAdmin(actor())) reject("เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้", "42501");
      if (!Number.isInteger(p_next) || p_next < 1 || p_next > 9999) reject("เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999");
      if (p_next < counter.last + 1) reject(`ตั้งเลขถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ (เลขที่ใช้ไปแล้วถึง ${counter.last}, เลขถัดไปต้องไม่น้อยกว่า ${counter.last + 1})`);
      counter.last = p_next - 1;
      return { year: counter.year, next_seq: p_next, next_doc_no: docNo(counter.year, p_next), is_test: true };
    },
    app_itwo_list_staff() {
      if (!isItAdmin(actor())) reject("เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้", "42501");
      return staff.slice();
    },
    app_itwo_set_staff() { reject("ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้"); },
    // ล้างข้อมูลทดสอบ: ลบแถวทั้งหมด และคืน path ของ "ทุกไฟล์" ในบัคเก็ตทดสอบให้หน้าเว็บลบผ่าน Storage API ต่อ (ลบด้วย SQL ไม่ได้) · เรียกซ้ำได้รายการที่เหลือ
    app_sandbox_purge_itwo() {
      const deleted = orders.length + events.length + access.size + reworks.length + attachments.length;
      orders.length = 0; events.length = 0; access.clear(); reworks.length = 0; attachments.length = 0; counter.last = 0;
      return { deleted, files: env.listObjects ? env.listObjects(TEST_BUCKET) : [] };
    },
  };

  // persona ของโมดูลนี้ (SBX-IT-STAFF / ADMIN / APPROVER) เพิ่มต่อท้ายรายการของโหมดทดสอบ
  const personaRows = (template) => [
    ["persona-it-staff", "SBX-IT-STAFF", "ผู้แจ้งแผนก IT (ทดสอบ)", "IT", "เทคโนโลยีสารสนเทศ", "ผู้แจ้งแผนก IT"],
    ["persona-it-admin", "SBX-IT-ADMIN", "IT ผู้ดูแลงาน (ทดสอบ)", "IT", "เทคโนโลยีสารสนเทศ", "IT ผู้ดูแลงาน"],
    ["persona-it-approver", "SBX-IT-APPROVER", "ผู้อนุมัติขั้น IT (ทดสอบ)", "MGT", "ฝ่ายบริหาร", "ผู้อนุมัติขั้น IT"],
  ].map(([id, employee_no, job_title, code, name_th, last_name]) => ({
    ...template, id, employee_no, first_name: "ทดสอบ", last_name, job_title, role: { code: "staff", name_th: "พนักงาน" }, department: { code, name_th },
  }));

  // ใช้ในเทสต์/ภาพหน้าจอเท่านั้น: ใส่ข้อมูลสิทธิ์ในระบบของ "ใบเก่า" (ก่อนถอดส่วนนี้ออก) เพื่อดูการแสดงผลอ่านอย่างเดียว
  const seedAccess = (workOrderId, rows) => { access.set(workOrderId, rows.map((row, index) => ({ id: `ac-${workOrderId}-${index}`, ...row }))); };

  return { handlers, personaRows, seedAccess };
}
