// งานของระบบสำนักงาน (ใบสั่งงาน IT, ใบแจ้งซ่อม IT, โมดูลถัด ๆ ไป) บนหน้าแรก "งานของคุณวันนี้" (app.js renderDashboard)
// ไฟล์นี้เป็นกติกาล้วน ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/office-home.test.mjs)
//
// ===== สัญญาของโมดูลที่อยากให้งานขึ้นหน้าแรก (ไม่ต้องแตะ app.js อีก) =====
//   (window.MNP_OFFICE_HOME ??= {})[<รหัสโมดูลของการ์ด เช่น IT_WORK_ORDER>] = { label: "ชื่อไทยของโมดูล", load: async (employee) => ({ tasks, mine }) }
//   - รหัสโมดูลต้องตรงกับรหัสใน modules/department-access.js (แผนกที่จำกัดโมดูล เช่นแผนก ID ไม่เห็นโมดูลที่ไม่อยู่ในรายการ · app.js กรองให้ก่อนเรียก load)
//   - load ไม่ต้องกันข้อผิดพลาดเอง: ล้ม/ช้าเกิน LOAD_TIMEOUT_MS = ซ่อนเฉพาะโมดูลนั้นและแจ้งผู้ใช้ หน้าแรกของส่วนอื่นขึ้นตามปกติ
//   - tasks = งานที่ "ต้องกดทำ" ขึ้นคิว "ต้องจัดการ" เป็นลิงก์ไปหน้าของใบ (ไม่มีปุ่มตัดสินใจบนหน้าแรก)
//       { id, docNo, typeCode, typeName, title, task, href, urgent, createdAt, meta }
//   - mine = ใบที่ผู้ใช้แจ้งเองและยังไม่จบ (ไม่ซ้ำกับ tasks) ขึ้น "ใบของฉันที่ยังไม่จบ" พร้อมแถบขั้นตอน
//       { id, at, docNo, typeCode, typeName, title, href, urgent, progressStatus, stages, label }
//   - โมดูลที่ลำดับขั้นเหมือนใบสั่งงาน IT เรียก MNP_OFFICE_HOME_RULES.build(...) ได้เลย (ใช้ model ของตัวเองเลือกงาน ไม่ต้องเขียนกติกาซ้ำ)
// ข้อความทุกช่องมาจากฐานข้อมูล: ตอนวาด HTML (mineRowHtml ใน app.js ผ่าน deps.escapeHtml, queue ผ่าน homeQueueItemHtml) ต้อง escape เสมอ
(function (root) {
  "use strict";

  // โมดูลที่ตอบช้ากว่านี้ถือว่าล้ม (ไม่ให้หน้าแรกของส่วนอื่นรอไม่จบ)
  const LOAD_TIMEOUT_MS = 3000;
  // ใบที่จบแล้ว (ไม่ใช่งานค้าง) ตรงกับ CLOSED_STATUSES ของ itwo-model.js / itrp-model.js
  const CLOSED_STATUSES = Object.freeze(["received", "rejected", "cancelled"]);

  // ขั้นของแถบ "ไปถึงไหนแล้ว" (รูปแบบเดียวกับ progressTracker ของ app.js: { statuses, label }) · แจ้งงาน → ผู้จัดการแผนก → ผู้อนุมัติ IT → IT ดำเนินการ → รอยืนยัน → จบ
  // "submitted" ไม่ใช่สถานะจริง (ขั้นแรกผ่านแล้วเสมอเมื่อมีใบ) ใช้เป็นชื่อกันไม่ให้ขั้นนี้ไปตรงกับสถานะใด
  const PROGRESS_STAGES = Object.freeze([
    Object.freeze({ statuses: Object.freeze(["submitted"]), label: "แจ้งงาน" }),
    Object.freeze({ statuses: Object.freeze(["pending_dept"]), label: "ผู้จัดการแผนก" }),
    Object.freeze({ statuses: Object.freeze(["pending_it_mgr"]), label: "ผู้อนุมัติ IT" }),
    Object.freeze({ statuses: Object.freeze(["approved", "in_progress"]), label: "IT ดำเนินการ" }),
    Object.freeze({ statuses: Object.freeze(["it_closed"]), label: "รอยืนยัน" }),
    Object.freeze({ statuses: Object.freeze(["received"]), label: "จบงาน" }),
  ]);
  // ใบที่รอผู้แจ้งตอบ (need_info) ค้างอยู่ที่ขั้นที่ถามมา: ดูจากสถานะที่ใบจะกลับไป ไม่มี = ดูจากขั้นของผู้ถาม
  const INFO_STAGE_STATUS = Object.freeze({ dept: "pending_dept", it_mgr: "pending_it_mgr", it: "in_progress" });

  const list = (value) => (Array.isArray(value) ? value : []);
  const joinMeta = (...parts) => parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(" · ");

  // สถานะที่ใช้ชี้ขั้นบนแถบ (ใบรอผู้แจ้งตอบอยู่ที่ขั้นที่ถาม ไม่ใช่ขั้นแยก)
  function progressStatusOf(row) {
    if (row?.status !== "need_info") return row?.status ?? "";
    return row.info_return_status || INFO_STAGE_STATUS[row.info_stage] || row.status;
  }

  // งานที่ IT (ผู้ดูแลงาน) ต้องกดทำของแถวในรายการงาน IT · คืน null = ไม่ใช่งานที่ต้องกด (รออนุมัติปกติ / รอผู้แจ้ง / จบแล้ว) ใช้กลุ่มเดียวกับตัวเลขบนแท็บ/การ์ด (model.itGroupOf)
  function itTaskLabel(model, row) {
    const group = model.itGroupOf(row);
    if (group === "to_start") return row.status === "approved" ? "เริ่มงาน" : "เริ่มงานก่อนอนุมัติ";
    if (group === "in_progress") return Number(row.rework_round) > 0 ? `แก้ไขงานครั้งที่ ${Number(row.rework_round)}` : "ส่งงาน";
    return null;
  }

  // เลือกงานของผู้ใช้จากรายการที่ RPC ส่งมา
  //   model   = MNP_ITWO_MODEL / MNP_ITRP_MODEL (กติกานับเดียวกับแท็บและการ์ด: canApprove, itGroupOf, myStatusLabel, reworkTag …)
  //   role    = ผลของ app_*_my_role · approvals/it/mine = ผลของ app_*_list_pending_approvals / list_it / list_mine (ไม่ได้เรียก = [])
  //   source  = { code, typeName, urlOf(id), titleOf(row) } ของโมดูลนั้น
  // งานที่ต้องกด (ไม่ซ้ำกันด้วย id): 1) รออนุมัติของฉัน (ตัดใบที่ถามผู้แจ้งไปแล้ว) 2) งาน IT (เฉพาะผู้ดูแลงาน IT) 3) ใบของฉันที่รอฉันตอบ/รอฉันยืนยันรับ
  // หัวหน้า IT ที่ดูอย่างเดียวไม่มีงาน IT (ฐานข้อมูลคืนรายการรออนุมัติให้เฉพาะใบที่กดได้จริง)
  function build({ model, role, approvals, it, mine, source }) {
    const tasks = [];
    const taken = new Set();
    const addTask = (row, task, meta) => {
      const id = String(row.id);
      if (taken.has(id)) return;
      taken.add(id);
      tasks.push({
        id: row.id,
        docNo: row.doc_no,
        typeCode: source.code,
        typeName: source.typeName,
        title: source.titleOf(row),
        task,
        href: source.urlOf(row.id),
        urgent: Boolean(row.is_urgent),
        createdAt: row.created_at,
        meta,
      });
    };
    if (model.canApprove(role)) {
      for (const row of list(approvals)) {
        if (row.status === "need_info") continue; // ถามผู้แจ้งไปแล้ว: รอคำตอบ ไม่ใช่งานที่ต้องกดอนุมัติ (ตรงกับ waitingForMeCount)
        addTask(row, "รออนุมัติ", joinMeta(row.requester_name, row.department_name));
      }
    }
    if (role?.is_it_admin) {
      for (const row of list(it)) {
        const task = itTaskLabel(model, row);
        if (task) addTask(row, task, joinMeta(row.requester_full_name, row.department_name));
      }
    }
    const mineRows = list(mine);
    for (const row of mineRows) {
      if (row.status === "need_info" || row.status === "it_closed") addTask(row, model.myStatusLabel(row.status), "");
    }
    // ใบของฉันที่ยังไม่จบ: ตัดใบที่อยู่ในคิว "ต้องจัดการ" แล้ว (กันซ้ำ)
    const mineOpen = mineRows
      .filter((row) => row.id !== null && row.id !== undefined && !CLOSED_STATUSES.includes(row.status) && !taken.has(String(row.id)))
      .map((row) => ({
        id: row.id,
        at: row.created_at,
        docNo: row.doc_no,
        typeCode: source.code,
        typeName: source.typeName,
        title: source.titleOf(row),
        href: source.urlOf(row.id),
        urgent: Boolean(row.is_urgent),
        progressStatus: progressStatusOf(row),
        stages: PROGRESS_STAGES,
        // ป้ายสถานะภาษาไทยจาก model (รอคุณตอบ ฯลฯ) + งานแก้ไข "แก้ไขครั้งที่ N · กำหนด …" ถ้ามี
        label: [model.myStatusLabel(row.status), model.reworkTag(row.rework_round, row.rework_due_date)].filter(Boolean).join(" · "),
      }));
    return { tasks, mine: mineOpen };
  }

  // งานของหน้าแรกจากทุกโมดูลที่ลงทะเบียนไว้ (แผนกที่ไม่ได้สิทธิ์โมดูลนั้นไม่ถูกเรียก) · ไม่ throw เสมอ
  // โมดูลที่ล้มหรือเกินเวลา = ข้ามโมดูลนั้น (เก็บชื่อไว้ใน failed ให้ผู้เรียกแจ้งผู้ใช้) ส่วนของโมดูลอื่นยังได้ครบ
  async function collect(registry, employee, { isAllowed = () => true, timeoutMs = LOAD_TIMEOUT_MS } = {}) {
    const entries = Object.entries(registry ?? {}).filter(([code, entry]) => typeof entry?.load === "function" && isAllowed(code));
    const settled = await Promise.all(entries.map(async ([code, entry]) => {
      let timer;
      try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("OFFICE_HOME_TIMEOUT")), timeoutMs); });
        const value = await Promise.race([Promise.resolve().then(() => entry.load(employee)), timeout]);
        return { code, value };
      } catch (error) {
        return { code, label: entry.label ?? code, error };
      } finally {
        clearTimeout(timer);
      }
    }));
    const tasks = [];
    const mine = [];
    const failed = [];
    for (const result of settled) {
      if (result.error) {
        failed.push({ code: result.code, label: result.label });
        continue;
      }
      // ลิงก์ต้องเป็นหน้าในแอป (#/…) เท่านั้น · แถวที่ไม่มี id/ลิงก์ที่ผิดรูปไม่ขึ้นหน้าแรก
      tasks.push(...list(result.value?.tasks).filter((task) => task?.id && typeof task.href === "string" && task.href.startsWith("#/")));
      mine.push(...list(result.value?.mine).filter((row) => row?.id && typeof row.href === "string" && row.href.startsWith("#/")));
    }
    return { tasks, mine, failed };
  }

  // งานของคิว "ต้องจัดการ" ในรูปเดียวกับแถว NCR ของ homeQueueItems (kind "office" = ลิงก์ไปหน้าของใบอย่างเดียว ไม่มีแถบตัดสินใจ/คีย์ลัด A/R)
  function queueItem(task) {
    return {
      kind: "office",
      id: task.id,
      href: task.href,
      task: task.task,
      flag: task.urgent ? "ด่วน" : null,
      meta: task.meta ?? "",
      request: { request_no: task.docNo, title: task.title, request_type: { code: task.typeCode, name_th: task.typeName } },
      priority: task.urgent ? "urgent" : null,
      createdAt: task.createdAt,
    };
  }

  // แถวใน "ใบของฉันที่ยังไม่จบ" หน้าตาเดียวกับแถวคำร้อง (home-mine-row) · deps ส่งมาจาก app.js: escapeHtml, requestTypeIcon, requestPalette, progressTracker
  function mineRowHtml(row, deps) {
    const { escapeHtml, requestTypeIcon, requestPalette, progressTracker } = deps;
    const urgent = row.urgent ? '<span class="badge urgent-flag">ด่วน</span>' : "";
    return `<li><a class="home-mine-row" href="${escapeHtml(row.href)}"><span class="home-mine-head"><span class="queue-item-icon" data-module="${escapeHtml(requestPalette(row.typeCode))}" title="${escapeHtml(row.typeName)}" aria-hidden="true">${requestTypeIcon(row.typeCode)}</span><span class="request-no">${escapeHtml(row.docNo)}</span>${urgent}</span><strong>${escapeHtml(row.title)}</strong>${progressTracker(row.progressStatus, false, { stages: row.stages, label: row.label })}</a></li>`;
  }

  root.MNP_OFFICE_HOME_RULES = Object.freeze({ LOAD_TIMEOUT_MS, PROGRESS_STAGES, progressStatusOf, itTaskLabel, build, collect, queueItem, mineRowHtml });
})(typeof window !== "undefined" ? window : globalThis);
