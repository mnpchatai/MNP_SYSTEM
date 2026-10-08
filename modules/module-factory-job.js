// ใบงานผลิตของฝ่ายโรงงาน (โหมดทดสอบ) ขั้น 4–8 ของ workflow: ฝ่ายวางแผนออกใบงาน → แต่ละแผนกทำขั้นตอนของตนตามลำดับ → รับผลผลิตเข้าคลัง
//
// view ที่ไฟล์นี้วาดให้รายการในเมนู Item master › ใบงานผลิต (modules/factory-item-master.js) และหน้าแผนก (#/factory?dept=<รหัส>):
//   job-queue  ใบงานผลิต-คิวแผนกของฉัน   ใบงานที่ถึงคิวแผนกของ persona ที่ทำหน้าที่อยู่ + งานที่กำลังจะมา
//   job-new    ใบงานผลิต-ใหม่            ฝ่ายวางแผนออกใบงาน (&wo=<id ใบสั่งผลิต> · &part=<id Item> &qty= เติมค่าตั้งต้นจากรายการที่เสนอ)
//   job        ใบงานผลิต-ดู              รายการ (กรองสถานะด้วย &status=) · &jb=<id> รายละเอียด ขั้นตอน และปุ่มทำขั้นตอน
//   department หน้าแผนก RB/GR/PT/BG/PK/PP  คิวของแผนกนั้น (module-factory.js เรียก)
//
// ผู้ใช้สลับ persona ที่แถบสีเหลือง (พนักงาน RB/SR/QA/GR/PT/BG/PK/WH หรือพนักงานวางแผน) เพื่อทำแต่ละขั้น ปุ่มที่เห็นเลือกจากแผนกของ persona
// (modules/factory-job-model.js) แต่การควบคุมสิทธิ์จริงอยู่ที่ RPC ใน supabase/migrations/20261007050000_factory_job_workflow.sql ซึ่งตรวจโหมดทดสอบ
// แผนก ลำดับขั้น version และค่าทุกช่องเอง ขั้นแรกตัดวัตถุดิบจริงและขั้นสุดท้ายรับผลผลิตเข้าคลังจริงในธุรกรรมเดียวกับการทำขั้นตอน — โหมดทดสอบไม่ส่งแจ้งเตือน
//
// โหลดหลัง modules/module-factory-material.js และก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (sb, state, escapeHtml, formatDate, showToast, friendlyError, setFormBusy, renderRoute) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// ทุก dropdown เป็น <select> ของเบราว์เซอร์ (แตะบน iPhone ได้ ไม่ต้องมีโค้ดปิด popup)
(function registerFactoryJobViews() {
  const model = window.MNP_FACTORY_JOB_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { loadData, options, notice } = window.MNP_FACTORY_UI;

  // ลำดับสำคัญ: friendlyError ใช้คีย์แรกที่ปรากฏอยู่ในข้อความ รหัสใหม่ต้องไม่เป็นส่วนหนึ่งของรหัสอื่นที่ลงทะเบียนไว้ก่อนหน้า (มีเทสต์ตรวจ)
  const ERROR_MESSAGES = {
    INVALID_JOB_QTY: "จำนวนที่ผลิตต้องมากกว่า 0 และไม่เกิน 1,000,000,000",
    INVALID_JOB_NOTE: "หมายเหตุ/เหตุผลยาวได้ไม่เกิน 1,000 ตัวอักษร",
    INVALID_JOB_OUTPUT_QTY: "จำนวนผลิตจริงต้องมากกว่า 0 และไม่เกิน 1,000,000,000 (ระบุได้เฉพาะขั้นสุดท้าย)",
    JOB_WORK_ORDER_UNKNOWN: "ไม่พบใบสั่งผลิตนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    JOB_WORK_ORDER_NOT_RELEASED: "ออกใบงานได้เฉพาะใบสั่งผลิตที่ออกใบสั่งงานแล้วและยังผลิตไม่ครบ",
    JOB_ITEM_UNKNOWN: "ไม่พบชิ้นงาน/สินค้าที่เลือก (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    JOB_ITEM_INVALID: "ชิ้นงาน/สินค้าต้องเป็น WIP หรือ FG ที่ใช้งานอยู่และผลิตเองได้",
    JOB_BOM_INVALID: "ชิ้นงาน/สินค้านี้ยังไม่มี BOM ที่อนุมัติแล้ว (ส่งขออนุมัติที่หน้าโครงสร้างสินค้าก่อน)",
    JOB_ROUTING_INVALID: "ชิ้นงาน/สินค้านี้ยังไม่มี Routing (ขั้นตอนการผลิต) ที่ใช้ได้",
    JOB_WAREHOUSE_UNKNOWN: "ไม่พบคลังที่เลือก กรุณาเลือกคลังที่รับผลผลิต",
    JOB_CANCEL_NOTE_REQUIRED: "กรุณาระบุเหตุผลที่ยกเลิก",
    JOB_NOT_CANCELLABLE: "ยกเลิกได้เฉพาะใบงานที่ยังไม่เสร็จ (ใบงานที่ผลิตเสร็จแล้วผลผลิตเข้าคลังไปแล้ว และใบที่ยกเลิกแล้วยกเลิกซ้ำไม่ได้)",
    JOB_NOT_FOUND: "ไม่พบใบงานนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    JOB_VERSION_CONFLICT: "ใบงานนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจรายการล่าสุดแล้วทำอีกครั้ง",
    JOB_NOT_ACTIVE: "ใบงานนี้จบแล้วหรือถูกยกเลิก ทำขั้นตอนไม่ได้",
    JOB_STEP_NOT_FOUND: "ไม่พบขั้นตอนนี้ในใบงาน",
    JOB_STEP_ALREADY_DONE: "ขั้นตอนนี้ทำเสร็จไปแล้ว",
    JOB_STEP_OUT_OF_ORDER: "ต้องทำขั้นตอนก่อนหน้าให้เสร็จก่อน",
    JOB_STEP_DEPARTMENT_ONLY: "ขั้นตอนนี้เป็นของแผนกอื่น — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานของแผนกที่ทำขั้นนี้",
    INVALID_JOB_QC_RESULT: "กรุณาเลือกผลตรวจ ผ่านหรือไม่ผ่าน",
    INVALID_JOB_QC_QTY: "จำนวนที่ตรวจต้องมากกว่า 0 และไม่เกิน 1,000,000,000 · ถ้าไม่ผ่านต้องระบุจำนวนที่ไม่ผ่านตั้งแต่ 1 ถึงจำนวนที่ตรวจ (ผลผ่านต้องไม่มีจำนวนที่ไม่ผ่าน)",
    INVALID_JOB_QC_NOTE: "บันทึกผลวัดยาวได้ไม่เกิน 1,000 ตัวอักษร",
    JOB_QC_DEFECT_TYPE_INVALID: "กรุณาเลือกประเภทข้อบกพร่อง (ตามระบบ NCR) เพื่อออก NCR",
    JOB_QC_DESCRIPTION_REQUIRED: "คำอธิบายความไม่ผ่านต้องยาว 10–4,000 ตัวอักษร (ใช้เป็นรายละเอียดของ NCR)",
    JOB_STEP_NOT_QC: "ขั้นนี้ไม่ใช่ขั้นตรวจ QC ให้ใช้ปุ่ม “ทำขั้นตอนนี้เสร็จ”",
    JOB_QC_INSPECTION_REQUIRED: "ขั้น QC ต้องบันทึกผลตรวจ (ผ่าน/ไม่ผ่าน) ในฟอร์มตรวจ QC ปิดด้วยปุ่มทำขั้นตอนเสร็จไม่ได้",
    JOB_INSUFFICIENT_STOCK: "วัตถุดิบหรือชิ้นงานที่ใช้ตามสูตรในคลังไม่พอ จึงเริ่มงานไม่ได้ (ยังไม่ได้ตัดอะไร) — ดูตารางวัตถุดิบในใบงาน ผลิตชิ้นงานที่ขาดหรือสั่งวัตถุดิบเพิ่มก่อน",
  };
  Object.assign(window.MNP_FACTORY_ERRORS, ERROR_MESSAGES);

  const q4 = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 4 });
  const dept = () => state.employee?.department?.code ?? null;
  const viewUrl = (id) => menu.url("job-view", { jb: id });
  const poUrl = (id) => menu.url("production-view", { po: id });
  const person = (name, at) => (name || at ? `${escapeHtml(name ?? "—")}${at ? ` · ${formatDate(at, true)}` : ""}` : "—");
  const statusBadge = (status) => `<span class="badge ${escapeHtml(model.BADGE_CLASS[status] ?? "")}">${escapeHtml(model.JOB_STATUSES[status] ?? status)}</span>`;
  const byId = (rows, id) => (rows ?? []).find((row) => row.id === id) ?? null;
  const progressHtml = (job) => {
    const { done, total, percent } = model.progress(job);
    return `<progress class="fm-progress" value="${done}" max="${total || 1}" aria-label="ความคืบหน้า ${percent}%"></progress> <span class="muted small">${done}/${total} ขั้น</span>`;
  };

  // ปุ่มเรียก RPC หนึ่งครั้ง: ปิดปุ่มระหว่างทำ สำเร็จแล้ววาดหน้าใหม่ ผิดพลาดแจ้งเตือนและวาดใหม่เมื่อสถานะในหน้าล้าสมัย
  const STALE_CODES = ["JOB_VERSION_CONFLICT", "JOB_NOT_", "JOB_STEP_ALREADY_DONE", "JOB_STEP_OUT_OF_ORDER", "JOB_STEP_NOT_FOUND"];
  async function runAction(root, rpc, args, successMessage) {
    const controls = root.querySelectorAll("[data-jb-action], .jb-form button");
    controls.forEach((control) => { control.disabled = true; });
    try {
      const { data, error } = await sb.rpc(rpc, args);
      if (error) throw error;
      showToast(typeof successMessage === "function" ? successMessage(data) : successMessage);
      await renderRoute();
    } catch (error) {
      showToast(friendlyError(error), "error");
      if (STALE_CODES.some((code) => String(error?.message ?? "").includes(code))) await renderRoute();
      else controls.forEach((control) => { control.disabled = false; });
    }
  }

  // ---------- คิวของแผนก ----------
  function queueRows(entries, columns) {
    return entries.map(({ job, step, mine }) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(viewUrl(job.id))}"><strong>${escapeHtml(job.code)}</strong><span>${escapeHtml(job.production_code)}</span></a></td>
        <td><strong>${escapeHtml(job.item_code)}</strong><br><span class="muted small">${escapeHtml(job.item_name)}</span></td>
        <td class="right">${q4(job.qty)} ${escapeHtml(job.unit_code)}</td>
        ${columns === "ready" ? `<td>${escapeHtml(step.name)}</td>` : `<td>${escapeHtml(step.name)}<br><span class="muted small">(${escapeHtml(step.department_code)})</span></td><td>${escapeHtml(mine.name)}</td>`}
        <td class="right"><a class="btn${columns === "ready" ? "" : " secondary"} small" href="${escapeHtml(viewUrl(job.id))}" aria-label="เปิด ${escapeHtml(job.code)}">${columns === "ready" ? "ทำขั้นตอน" : "เปิด"}</a></td>
      </tr>`).join("");
  }

  function queueHtml(data, code) {
    const { ready, upcoming } = model.deptQueue(data.jobs, code);
    const readyTable = ready.length
      ? `<div class="table-wrap"><table><thead><tr><th>ใบงาน</th><th>ผลิต</th><th class="right">จำนวน</th><th>ขั้นที่ถึงคิว</th><th class="right">จัดการ</th></tr></thead><tbody>${queueRows(ready, "ready")}</tbody></table></div>`
      : '<div class="empty">ไม่มีใบงานที่ถึงคิวของแผนกนี้</div>';
    const upcomingTable = upcoming.length
      ? `<div class="table-wrap"><table><thead><tr><th>ใบงาน</th><th>ผลิต</th><th class="right">จำนวน</th><th>ตอนนี้อยู่ที่ขั้น</th><th>ขั้นของแผนกนี้</th><th class="right">จัดการ</th></tr></thead><tbody>${queueRows(upcoming, "upcoming")}</tbody></table></div>`
      : '<div class="empty">ไม่มีใบงานที่กำลังจะมาถึงแผนกนี้</div>';
    return `<section class="card"><h2>ถึงคิวแผนก ${escapeHtml(code)} <span class="muted small">(${ready.length})</span></h2>
        <p class="muted small">ใบงานที่ขั้นถัดไปเป็นของแผนกนี้ เก่าสุดก่อน — เปิดใบงานแล้วกด “ทำขั้นตอนนี้เสร็จ” (ต้องสลับ “ทำหน้าที่เป็น” เป็นพนักงานแผนกนี้)</p>${readyTable}</section>
      <section class="card"><h2>กำลังจะมาถึง <span class="muted small">(${upcoming.length})</span></h2>
        <p class="muted small">ใบงานที่แผนกนี้ยังมีขั้นรอทำ แต่ขั้นก่อนหน้ายังไม่เสร็จ</p>${upcomingTable}</section>`;
  }

  // ---------- รายการ ----------
  const STATUS_FILTERS = ["all", ...Object.keys(model.JOB_STATUSES)];
  const listUrl = (status) => menu.url("job-view", { status: status !== "all" ? status : null });

  function listHtml(data, params) {
    const jobs = data.jobs ?? [];
    const wanted = STATUS_FILTERS.includes(params.get("status")) ? params.get("status") : "all";
    const counts = model.countByStatus(jobs);
    const rows = jobs.filter((job) => wanted === "all" || job.status === wanted);
    const filters = STATUS_FILTERS.map((status) => {
      const count = status === "all" ? jobs.length : counts[status];
      const text = status === "all" ? "ทั้งหมด" : model.JOB_STATUSES[status];
      return `<a class="filter${wanted === status ? " active" : ""}" href="${escapeHtml(listUrl(status))}"${wanted === status ? ' aria-current="page"' : ""}>${escapeHtml(text)} (${count})</a>`;
    }).join("");
    if (!jobs.length) {
      return `<section class="card"><div class="empty">ยังไม่มีใบงานผลิตในโหมดทดสอบ<br><small>ฝ่ายวางแผนออกใบงานได้เมื่อใบสั่งผลิตออกใบสั่งงานแล้ว (ขั้น 2.4)</small>
          <div class="fm-actions"><a class="btn" href="${escapeHtml(menu.url("job-new"))}"><span class="plus-icon" aria-hidden="true"></span> ออกใบงานผลิต</a>
          <a class="btn secondary" href="${escapeHtml(menu.url("production-view"))}">ไปที่ใบสั่งผลิต</a></div></div></section>`;
    }
    const body = rows.map((job) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(viewUrl(job.id))}"><strong>${escapeHtml(job.code)}</strong><span>${escapeHtml(job.production_code)}</span></a></td>
        <td><strong>${escapeHtml(job.item_code)}</strong><br><span class="muted small">${escapeHtml(job.item_name)}</span></td>
        <td class="right">${q4(job.qty)} ${escapeHtml(job.unit_code)}</td>
        <td>${progressHtml(job)}</td>
        <td>${statusBadge(job.status)}</td>
        <td class="right"><a class="btn secondary small" href="${escapeHtml(viewUrl(job.id))}" aria-label="เปิด ${escapeHtml(job.code)}">เปิด</a></td>
      </tr>`).join("");
    return `<section class="card">
        <nav class="filters" aria-label="สถานะใบงานผลิต">${filters}</nav>
        ${rows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>ใบงาน / ใบสั่งผลิต</th><th>ผลิต</th><th class="right">จำนวน</th><th>ความคืบหน้า</th><th>สถานะ</th><th class="right">จัดการ</th></tr></thead>
          <tbody>${body}</tbody></table></div>` : '<div class="empty">ไม่มีใบงานในสถานะนี้</div>'}
      </section>`;
  }

  // ---------- รายละเอียดและปุ่มตามสถานะ ----------
  function requirementsHtml(data, job) {
    if (job.status !== "open") return "";
    const need = model.jobRequirements(data, job.item_id, job.qty);
    if (!need) return "";
    const rows = need.rows.map((row) => `<tr><td><strong>${escapeHtml(row.code)}</strong> <span class="muted small">${escapeHtml(row.name)}</span></td>
        <td class="right">${q4(row.need)} ${escapeHtml(row.unit_code)}</td><td class="right">${q4(row.stock)}</td>
        <td class="${row.short ? "fm-short" : ""}">${row.short ? `<strong>ขาด ${q4(row.need - row.stock)}</strong>` : "พอ"}</td></tr>`).join("");
    return `<h3>วัตถุดิบที่จะตัดเมื่อทำขั้นแรกเสร็จ (BOM Rev. ${escapeHtml(need.bom.revision)})</h3>
      ${need.ready ? "" : notice("ยอดคงคลังไม่พอสำหรับบางรายการ ขั้นแรกจะไม่ผ่านจนกว่าจะผลิตชิ้นงานที่ขาดหรือรับวัตถุดิบเพิ่ม (ระบบไม่ตัดบางส่วน)")}
      <div class="table-wrap"><table><thead><tr><th>วัตถุดิบ / ชิ้นงาน</th><th class="right">ต้องใช้</th><th class="right">คงเหลือทุกคลัง</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function stepsHtml(job) {
    const next = model.nextStep(job);
    const rows = model.stepsOf(job).map((step) => `<tr${next && next.sequence === step.sequence ? ' aria-current="step"' : ""}>
        <td>${escapeHtml(step.sequence / 10)}</td>
        <td>${escapeHtml(step.name)}${step.instruction ? `<br><span class="muted small">${escapeHtml(step.instruction)}</span>` : ""}</td>
        <td>${escapeHtml(step.work_center_code)}${step.department_code !== step.work_center_code ? ` <span class="muted small">(แผนก ${escapeHtml(step.department_code)})</span>` : ""}</td>
        <td><span class="badge ${step.status === "done" ? "completed" : next && next.sequence === step.sequence ? "pending_approval" : ""}">${escapeHtml(next && next.sequence === step.sequence && step.status === "pending" ? "ถึงคิว" : model.STEP_STATUSES[step.status] ?? step.status)}</span></td>
        <td>${step.status === "done" ? person(step.completed_by_name, step.completed_at) : "—"}</td>
        <td class="fm-pre">${escapeHtml(step.note || "—")}</td>
      </tr>`).join("");
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th>ขั้นตอน</th><th>ศูนย์งาน</th><th>สถานะ</th><th>ทำโดย</th><th>บันทึก</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ฟอร์มตรวจ QC แทนปุ่ม "ทำขั้นตอนนี้เสร็จ" ที่ขั้นศูนย์งาน QC: ผ่าน = ปิดขั้น · ไม่ผ่าน = ออก NCR และขั้นรอตรวจซ้ำ
  function qcFormHtml(data, job, next, last) {
    const types = data.ncr_defect_types ?? [];
    return `<form class="fm-form jb-form" id="jb-qc-form" novalidate>
          <h3>${escapeHtml(next.name)} — บันทึกผลตรวจ QC</h3>
          ${notice("ผ่าน: ปิดขั้นนี้ · ไม่ผ่าน: ระบบออก NCR (แหล่งที่พบ: ระหว่างผลิต) ให้ในครั้งเดียว ขั้นนี้ยังรอ ตรวจซ้ำได้หรือให้ฝ่ายวางแผนยกเลิกใบงาน")}
          ${last ? notice(`ขั้นสุดท้าย: เมื่อตรวจผ่าน ระบบรับผลผลิตเข้าคลัง ${escapeHtml(job.warehouse_name)} ตามจำนวนผลิตจริง`) : ""}
          <div class="fm-form-error" id="jb-form-error" role="alert" hidden></div>
          <fieldset class="field full"><legend>ผลตรวจ *</legend>
            <label><input type="radio" name="result" value="pass" checked> ผ่าน</label>
            <label><input type="radio" name="result" value="fail"> ไม่ผ่าน (ออก NCR)</label></fieldset>
          <div class="field-row">
            <div class="field"><label for="jb-qc-checked">จำนวนที่ตรวจ (${escapeHtml(job.unit_code)}) *</label>
              <input class="input" id="jb-qc-checked" name="qty_checked" type="number" inputmode="decimal" min="0.0001" max="${model.MAX_QUANTITY}" step="any" value="${escapeHtml(job.qty)}" required></div>
            <div class="field full"><label for="jb-qc-measure">บันทึกผลวัด / ผลตรวจ (ไม่บังคับ)</label>
              <textarea class="textarea" id="jb-qc-measure" name="measurement" rows="2" maxlength="1000"></textarea></div>
            ${last ? `<div class="field" id="jb-qc-output-field"><label for="jb-output">จำนวนผลิตจริง (${escapeHtml(job.unit_code)})</label><input class="input" id="jb-output" name="output_qty" type="number" inputmode="decimal" min="0.0001" max="${model.MAX_QUANTITY}" step="any" placeholder="${escapeHtml(q4(job.qty))}"><small>เว้นว่าง = ตามจำนวนของใบงาน (ใช้เมื่อผ่านเท่านั้น)</small></div>` : ""}
          </div>
          <div class="field-row" id="jb-qc-fail-fields" hidden>
            <div class="field"><label for="jb-qc-defect">จำนวนที่ไม่ผ่าน (${escapeHtml(job.unit_code)}) *</label>
              <input class="input" id="jb-qc-defect" name="qty_defect" type="number" inputmode="decimal" min="0.0001" step="any"></div>
            <div class="field"><label for="jb-qc-type">ประเภทข้อบกพร่อง (NCR) *</label>
              <select class="select" id="jb-qc-type" name="defect_type_code">${options([["", "— เลือก —"], ...types.map((type) => [type.code, type.name_th])], "")}</select></div>
            <div class="field full"><label for="jb-qc-desc">อธิบายความไม่ผ่าน * (ใช้เป็นรายละเอียด NCR อย่างน้อย 10 ตัวอักษร)</label>
              <textarea class="textarea" id="jb-qc-desc" name="description" rows="3" maxlength="4000"></textarea></div>
          </div>
          <div class="fm-actions"><button class="btn" type="submit">บันทึกผลตรวจ</button></div>
        </form>`;
  }

  function actionsHtml(data, job) {
    const role = dept();
    const next = model.nextStep(job);
    const blocks = [];
    if (next && model.canRunStep(job, next, role) && model.isQcStep(next)) {
      blocks.push(qcFormHtml(data, job, next, model.isLastPending(job, next)));
    } else if (next && model.canRunStep(job, next, role)) {
      const last = model.isLastPending(job, next);
      blocks.push(`<form class="fm-form jb-form" id="jb-step-form" novalidate>
          <h3>${escapeHtml(next.name)}</h3>
          ${job.status === "open" ? notice("ขั้นแรก: เมื่อกดเสร็จ ระบบตัดวัตถุดิบตามสูตรออกจากคลัง (หยิบจากล็อตเก่าสุดก่อน)") : ""}
          ${last ? notice(`ขั้นสุดท้าย: เมื่อกดเสร็จ ระบบรับผลผลิตเข้าคลัง ${escapeHtml(job.warehouse_name)} ตามจำนวนผลิตจริง`) : ""}
          <div class="fm-form-error" id="jb-form-error" role="alert" hidden></div>
          <div class="field-row">
            <div class="field full"><label for="jb-note">บันทึกขั้นตอน (ไม่บังคับ)</label><textarea class="textarea" id="jb-note" name="note" rows="2" maxlength="1000"></textarea></div>
            ${last ? `<div class="field"><label for="jb-output">จำนวนผลิตจริง (${escapeHtml(job.unit_code)})</label><input class="input" id="jb-output" name="output_qty" type="number" inputmode="decimal" min="0.0001" max="${model.MAX_QUANTITY}" step="any" placeholder="${escapeHtml(q4(job.qty))}"><small>เว้นว่าง = ${escapeHtml(q4(job.qty))} ตามจำนวนของใบงาน</small></div>` : ""}
          </div>
          <div class="fm-actions"><button class="btn" type="submit">ทำขั้นตอนนี้เสร็จ</button></div>
        </form>`);
    } else if (next) {
      blocks.push(notice(`ขั้นถัดไป “${next.name}” เป็นของแผนก ${next.department_code} — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานแผนก ${next.department_code} เพื่อทำขั้นนี้`));
    }
    if (model.jobActions(job, role).includes("cancel")) {
      blocks.push(`<details class="fm-review-details"><summary>ยกเลิกใบงานนี้</summary><form class="fm-form jb-form" id="jb-cancel-form" novalidate>
          <div class="field full"><label for="jb-cancel-note">ยกเลิกใบงานนี้ — เหตุผล *</label>
            <textarea class="textarea" id="jb-cancel-note" name="note" rows="2" maxlength="1000" required></textarea>
            ${job.status === "in_progress" ? "<small>ใบงานนี้เริ่มแล้ว ยกเลิกแล้วระบบคืนวัตถุดิบที่ตัดไปกลับเข้าคลังและล็อตเดิมทั้งหมด ขั้นที่ทำเสร็จแล้วยังอยู่ในประวัติ ยกเลิกแล้วแก้กลับไม่ได้</small>" : ""}</div>
          <div class="fm-actions"><button class="btn danger" type="submit">ยกเลิกใบงาน</button></div>
        </form></details>`);
    }
    return blocks.length ? `<section class="card fm-decision"><h2>ขั้นถัดไป</h2>${blocks.join("")}</section>` : "";
  }

  // วัตถุดิบที่คืนเข้าคลังตอนยกเลิกใบงานที่เริ่มแล้ว (ใบที่ยกเลิกก่อนเริ่มไม่มีรายการคืน)
  function returnedText(job) {
    const rows = job.returned ?? [];
    if (!rows.length) return "";
    return ` — คืนวัตถุดิบเข้าคลังแล้ว: ${rows.map((row) => `${row.code} ${q4(row.quantity)} ${row.unit_code}`).join(", ")}`;
  }

  function statusNotice(job) {
    switch (job.status) {
      case "open": return notice("ออกใบงานแล้ว ยังไม่มีขั้นใดเสร็จ — ขั้นแรกเสร็จเมื่อไรระบบจะตัดวัตถุดิบตามสูตร");
      case "in_progress": return notice("กำลังผลิต วัตถุดิบถูกตัดออกจากคลังแล้ว ถ้ายกเลิกใบงาน (ฝ่ายวางแผน) ระบบจะคืนวัตถุดิบเข้าคลังให้ทั้งหมด");
      case "completed": return notice(`ผลิตเสร็จ รับเข้าคลัง ${job.warehouse_name} แล้ว ${q4(job.output_qty)} ${job.unit_code} — ยอดคงคลังเพิ่มแล้ว ดูที่ “สินค้าคงคลัง-ดู”`);
      case "cancelled": return notice(`ยกเลิกแล้ว${job.cancel_note ? ` เหตุผล: “${job.cancel_note}”` : ""}${returnedText(job)}`);
      default: return "";
    }
  }

  function timelineHtml(entries) {
    if (!entries.length) return '<p class="muted small">ยังไม่มีประวัติ</p>';
    return `<div class="table-wrap"><table>
        <thead><tr><th>เวลา</th><th>การกระทำ</th><th>ขั้น</th><th>รุ่น</th><th>ผู้ทำรายการ</th><th>หมายเหตุ / เหตุผล</th></tr></thead>
        <tbody>${entries.map((entry) => `<tr>
          <td>${formatDate(entry.created_at, true)}</td>
          <td>${escapeHtml(model.HISTORY_ACTIONS[entry.action] ?? entry.action)}</td>
          <td>${entry.step_sequence ? escapeHtml(entry.step_sequence / 10) : "—"}</td>
          <td>${escapeHtml(entry.version)}</td>
          <td>${escapeHtml(entry.changed_by_name ?? "—")}</td>
          <td class="fm-pre">${escapeHtml(entry.note || "—")}</td>
        </tr>`).join("")}</tbody></table></div>`;
  }

  const ncrLink = (row) => (row.ncr_id
    ? `<a href="#/ncr?id=${encodeURIComponent(row.ncr_id)}">${escapeHtml(row.ncr_no)}</a>`
    : escapeHtml(row.ncr_no ?? "—"));

  // ขั้น QC ที่ผลตรวจล่าสุดไม่ผ่าน: บอกทุกแผนกว่ารอตรวจซ้ำและ NCR ที่ออกแล้ว
  function holdNotice(data, job) {
    const hold = model.qcHold(job, data.job_inspections);
    if (!hold) return "";
    return `<p class="fm-notice" role="status">ตรวจ QC ไม่ผ่านล่าสุด (${q4(hold.qty_defect)} จาก ${q4(hold.qty_checked)} ${escapeHtml(job.unit_code)}) ออก NCR ${ncrLink(hold)} แล้ว — ขั้น QC รอตรวจซ้ำ หรือฝ่ายวางแผนยกเลิกใบงาน</p>`;
  }

  function inspectionsHtml(data, job) {
    const rows = model.inspectionsOf(data.job_inspections, job.id);
    if (!rows.length) return "";
    const body = rows.map((row) => `<tr>
        <td>${formatDate(row.inspected_at, true)}</td>
        <td>${escapeHtml(row.step_sequence / 10)}</td>
        <td><span class="badge ${row.result === "pass" ? "completed" : "cancelled"}">${row.result === "pass" ? "ผ่าน" : "ไม่ผ่าน"}</span></td>
        <td class="right">${q4(row.qty_checked)}</td>
        <td class="right">${row.result === "fail" ? q4(row.qty_defect) : "—"}</td>
        <td class="fm-pre">${escapeHtml([row.measurement, row.result === "fail" ? [row.defect_type_name, row.description].filter(Boolean).join(": ") : ""].filter(Boolean).join("\n") || "—")}</td>
        <td>${row.result === "fail" ? ncrLink(row) : "—"}</td>
        <td>${escapeHtml(row.inspected_by_name ?? "—")}</td>
      </tr>`).join("");
    return `<h3>ผลตรวจ QC</h3><div class="table-wrap"><table>
        <thead><tr><th>เวลา</th><th>ขั้น</th><th>ผล</th><th class="right">ตรวจ</th><th class="right">ไม่ผ่าน</th><th>บันทึก / สาเหตุ</th><th>NCR</th><th>ผู้ตรวจ</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  }

  // Read the job identity and stock impact before taking an action.
  function detailHtml(data, job) {
    return `<section class="card fm-detail">
        <div class="fm-detail-head"><div><div class="eyebrow">${escapeHtml(job.code)}</div>
          <h2>${escapeHtml(job.item_code)} · ${escapeHtml(job.item_name)}</h2></div>${statusBadge(job.status)}</div>
        ${statusNotice(job)}
        ${holdNotice(data, job)}
        ${model.nextStep(job) ? `<p class="fm-current-step"><strong>ขั้นปัจจุบัน: ${escapeHtml(model.nextStep(job).name)}</strong> · แผนก ${escapeHtml(model.nextStep(job).department_code)}</p>` : ""}
        <dl class="definition-grid">
          <div class="definition"><dt>ใบสั่งผลิต</dt><dd><a href="${escapeHtml(poUrl(job.production_order_id))}">${escapeHtml(job.production_code)}</a> · ${escapeHtml(job.order_item_code)}</dd></div>
          <div class="definition"><dt>จำนวนที่ผลิต</dt><dd>${q4(job.qty)} ${escapeHtml(job.unit_code)}</dd></div>
          <div class="definition"><dt>ผลิตจริง</dt><dd>${job.output_qty === null || job.output_qty === undefined ? "—" : `${q4(job.output_qty)} ${escapeHtml(job.unit_code)}`}</dd></div>
          <div class="definition"><dt>คลังที่รับผลผลิต</dt><dd>${escapeHtml(job.warehouse_name)} (${escapeHtml(job.warehouse_code)})</dd></div>
          <div class="definition"><dt>BOM / Routing</dt><dd><a href="${escapeHtml(menu.url("structure-view", { bom: job.bom_id, qty: job.qty }))}">BOM Rev. ${escapeHtml(job.bom_revision)}</a> · <a href="${escapeHtml(menu.url("routing-view", { routing: job.routing_id }))}">Routing Rev. ${escapeHtml(job.routing_revision)}</a></dd></div>
          <div class="definition"><dt>ความคืบหน้า</dt><dd>${progressHtml(job)}</dd></div>
          <div class="definition"><dt>ออกใบงานโดย (ฝ่ายวางแผน)</dt><dd>${person(job.created_by_name, job.created_at)}</dd></div>
          <div class="definition"><dt>เริ่มงาน</dt><dd>${job.started_at ? formatDate(job.started_at, true) : "—"}</dd></div>
          <div class="definition"><dt>เสร็จ</dt><dd>${job.completed_at ? formatDate(job.completed_at, true) : "—"}</dd></div>
        </dl>
        ${job.note ? `<h3>หมายเหตุ</h3><p class="fm-pre">${escapeHtml(job.note)}</p>` : ""}
      </section>`;
  }

  function supportingDetailsHtml(data, job) {
    const inspections = inspectionsHtml(data, job);
    return `<section class="card fm-detail">
      <details class="fm-review-details"><summary>ขั้นตอนการผลิตทั้งหมด · ${model.stepsOf(job).length} ขั้น</summary>${stepsHtml(job)}</details>
      ${inspections ? `<details class="fm-review-details"${model.qcHold(job, data.job_inspections) ? " open" : ""}><summary>ผลตรวจ QC และ NCR ที่เกี่ยวข้อง</summary>${inspections}</details>` : ""}
      <details class="fm-review-details"><summary>ประวัติของใบงานนี้</summary>${timelineHtml(model.jobTimeline(data.job_history, job.id))}</details>
    </section>`;
  }

  function bindDetail(root, job) {
    const args = { p_id: job.id, p_version: job.version };
    const qcForm = root.querySelector("#jb-qc-form");
    if (qcForm) {
      const failFields = root.querySelector("#jb-qc-fail-fields");
      const outputField = root.querySelector("#jb-qc-output-field");
      // ช่องของผลไม่ผ่านแสดงเมื่อเลือก "ไม่ผ่าน" · ช่องจำนวนผลิตจริงใช้เมื่อผ่านเท่านั้น
      root.querySelectorAll('#jb-qc-form input[name="result"]').forEach((radio) => radio.addEventListener("change", () => {
        const failing = radio.value === "fail" && radio.checked;
        if (radio.checked && failFields) failFields.hidden = !failing;
        if (radio.checked && outputField) outputField.hidden = failing;
      }));
      qcForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const errorBox = root.querySelector("#jb-form-error");
        if (errorBox) errorBox.hidden = true;
        const form = new FormData(qcForm);
        const values = Object.fromEntries(["result", "qty_checked", "qty_defect", "measurement", "defect_type_code", "description", "output_qty"].map((key) => [key, form.get(key)]));
        const next = model.nextStep(job);
        const parsed = model.qcPayload(values, model.isLastPending(job, next));
        if (parsed.error) {
          if (errorBox) { errorBox.textContent = parsed.error; errorBox.hidden = false; }
          return undefined;
        }
        if (parsed.args.p_result === "fail" && !confirm("บันทึกว่าไม่ผ่านและออก NCR ใหม่ใช่หรือไม่?")) return undefined;
        return runAction(root, "app_factory_record_qc", { ...args, p_sequence: next.sequence, ...parsed.args }, (result) => (parsed.args.p_result === "fail"
          ? `ตรวจ QC ไม่ผ่าน ออก NCR ${result?.ncr_no ?? ""} แล้ว ขั้นนี้รอตรวจซ้ำ`
          : model.isLastPending(job, next) ? `${job.code} ผลิตเสร็จ รับผลผลิตเข้าคลังแล้ว ยอดคงคลังเพิ่มขึ้น` : `ตรวจ “${next.name}” ผ่านแล้ว`));
      });
    }
    const next = model.nextStep(job);
    const stepForm = root.querySelector("#jb-step-form");
    const errorBox = root.querySelector("#jb-form-error");
    stepForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (errorBox) errorBox.hidden = true;
      const form = new FormData(stepForm);
      const output = model.outputQty(form.get("output_qty"));
      if (output.error) {
        errorBox.textContent = output.error;
        errorBox.hidden = false;
        return undefined;
      }
      return runAction(root, "app_factory_complete_job_step", { ...args, p_sequence: next.sequence, p_note: String(form.get("note") ?? ""), p_output_qty: output.value },
        model.isLastPending(job, next) ? `${job.code} ผลิตเสร็จ รับผลผลิตเข้าคลังแล้ว ยอดคงคลังเพิ่มขึ้น` : `ทำขั้น “${next.name}” เสร็จแล้ว`);
    });
    const cancelForm = root.querySelector("#jb-cancel-form");
    cancelForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const started = job.status === "in_progress";
      if (!cancelForm.reportValidity() || !confirm(started ? `ยกเลิก ${job.code}? ระบบจะคืนวัตถุดิบที่ตัดไปกลับเข้าคลัง` : `ยกเลิก ${job.code}?`)) return undefined;
      return runAction(root, "app_factory_cancel_job", { ...args, p_note: cancelForm.querySelector("textarea").value },
        (result) => (result?.returned_lines ? `ยกเลิก ${job.code} แล้ว คืนวัตถุดิบเข้าคลัง ${result.returned_lines} รายการ` : `ยกเลิก ${job.code} แล้ว`));
    });
  }

  // ---------- ฟอร์มออกใบงาน ----------
  function chooseHtml(data) {
    const orders = model.orderableOrders(data.production);
    if (!orders.length) {
      return `<section class="card"><div class="empty">ยังไม่มีใบสั่งผลิตที่ออกใบสั่งงานแล้ว<br><small>ฝ่ายขายออกใบ → ฝ่ายวางแผนรับ วางแผน และออกใบสั่งงาน (ขั้น 1–2) ก่อน</small>
        <div class="fm-actions"><a class="btn secondary" href="${escapeHtml(menu.url("production-view"))}">ไปที่ใบสั่งผลิต</a></div></div></section>`;
    }
    const rows = orders.map((order) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(poUrl(order.id))}"><strong>${escapeHtml(order.code)}</strong><span>${escapeHtml(order.work_order_no ? `ใบสั่งงาน ${order.work_order_no}` : "—")}</span></a></td>
        <td><strong>${escapeHtml(order.item_code)}</strong><br><span class="muted small">${escapeHtml(order.name)}</span></td>
        <td class="right">${q4(order.completed_qty)} / ${q4(order.planned_qty)} ${escapeHtml(order.unit_code)}</td>
        <td class="right">${model.jobsOf(data.jobs, order.id).length} ใบ</td>
        <td class="right"><a class="btn small" href="${escapeHtml(menu.url("job-new", { wo: order.id }))}">ออกใบงาน</a></td>
      </tr>`).join("");
    return `<section class="card"><h2>เลือกใบสั่งผลิตที่ต้องการออกใบงาน</h2>
        <p class="muted small">เฉพาะใบที่ออกใบสั่งงานแล้ว (ขั้น 2.4) และยังผลิตไม่ครบ · ระบบเสนอชิ้นงานที่ต้องผลิตตามผลสำรวจคงคลังของใบนั้น</p>
        <div class="table-wrap"><table><thead><tr><th>ใบสั่งผลิต</th><th>สินค้า</th><th class="right">ผลิตแล้ว / สั่ง</th><th class="right">ใบงาน</th><th class="right">จัดการ</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function suggestionsHtml(data, workOrder) {
    const suggestions = model.jobSuggestions(data, workOrder);
    if (!suggestions.length) return '<p class="muted small">ไม่มีชิ้นงานที่ต้องผลิตเพิ่ม (หรือใบสั่งผลิตนี้ไม่มี BOM ที่อนุมัติแล้ว)</p>';
    const rows = suggestions.map((row) => {
      const need = row.qty > 0 ? model.jobRequirements(data, row.item_id, row.qty) : null;
      return `<tr>
        <td><strong>${escapeHtml(row.code)}</strong> <span class="muted small">${escapeHtml(row.name)}</span><br><span class="muted small">${row.kind === "fg" ? "สินค้าสำเร็จรูป (ประกอบที่ PK)" : "ชิ้นงานระหว่างผลิต"}</span></td>
        <td class="right">${q4(row.need)} ${escapeHtml(row.unit_code)}</td>
        <td class="right">${q4(row.inJobs)}</td>
        <td>${row.qty <= 0 ? "ออกใบงานครบแล้ว" : need && !need.ready ? `<span class="fm-short">วัตถุดิบ/ชิ้นงานยังไม่พอ</span>` : "พร้อมเริ่ม"}</td>
        <td class="right">${row.qty > 0 ? `<a class="btn secondary small" href="${escapeHtml(menu.url("job-new", { wo: workOrder.id, part: row.item_id, qty: row.qty }))}">ออกใบงาน ${q4(row.qty)}</a>` : ""}</td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap"><table><thead><tr><th>ชิ้นงาน/สินค้า</th><th class="right">ต้องผลิต</th><th class="right">ออกใบงานไว้แล้ว (ยังไม่เสร็จ)</th><th>สถานะวัตถุดิบ</th><th class="right">จัดการ</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function formHtml(data, workOrder, params) {
    const items = model.jobItems(data);
    const wrongDept = dept() !== model.PLANNING_DEPARTMENT
      ? notice("ขั้นนี้เป็นของฝ่ายวางแผน (PP) — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานวางแผนก่อนบันทึก (ฐานข้อมูลจะปฏิเสธผู้ใช้แผนกอื่น)") : "";
    const part = items.some((item) => item.id === params.get("part")) ? params.get("part") : "";
    const chosen = items.find((item) => item.id === part);
    const routing = chosen ? (chosen.id === workOrder.item_id ? workOrder.routing_id : (data.routings ?? []).filter((row) => row.item_id === chosen.id && row.status !== "obsolete").sort((a, b) => String(b.revision).localeCompare(String(a.revision)))[0]?.id) : null;
    const warehouse = chosen ? model.defaultWarehouse(data, chosen, routing) : "WIP";
    const quantity = params.get("qty") ? Number(params.get("qty")) : "";
    const preview = chosen && quantity > 0 ? model.jobRequirements(data, chosen.id, quantity) : null;
    const previewHtml = preview ? `<p class="muted small">วัตถุดิบที่จะตัด: ${preview.rows.map((row) => `${escapeHtml(row.code)} ${q4(row.need)} ${escapeHtml(row.unit_code)}${row.short ? " (ไม่พอ)" : ""}`).join(" · ")}</p>` : "";
    return `<section class="card">
        ${wrongDept}
        <p class="muted small">ใบสั่งผลิต <a href="${escapeHtml(poUrl(workOrder.id))}"><strong>${escapeHtml(workOrder.code)}</strong></a> · ${escapeHtml(workOrder.item_code)} ${escapeHtml(workOrder.name)} · ผลิตแล้ว ${q4(workOrder.completed_qty)} / ${q4(workOrder.planned_qty)} ${escapeHtml(workOrder.unit_code)}</p>
        <h3>ชิ้นงานที่ควรออกใบงาน (ตามผลสำรวจคงคลัง)</h3>
        ${suggestionsHtml(data, workOrder)}
        <h3>ออกใบงาน</h3>
        <form class="fm-form jb-form" id="jb-form" novalidate>
          <div class="fm-form-error" id="jb-form-error" role="alert" hidden></div>
          <div class="field-row">
            <div class="field full"><label for="jb-item">ชิ้นงาน/สินค้าที่จะผลิต *</label><select class="select" id="jb-item" name="item_id" required>${options([["", "— เลือก —"], ...items.map((item) => [item.id, `${item.code} · ${item.name} (${item.item_type})`])], part)}</select></div>
            <div class="field"><label for="jb-qty">จำนวนที่ผลิต *</label><input class="input" id="jb-qty" name="qty" type="number" inputmode="decimal" required min="0.0001" max="${model.MAX_QUANTITY}" step="any" value="${quantity === "" ? "" : escapeHtml(quantity)}"></div>
            <div class="field"><label for="jb-warehouse">คลังที่รับผลผลิต *</label><select class="select" id="jb-warehouse" name="warehouse_code" required>${options((data.warehouses ?? []).map((row) => [row.code, `${row.code} · ${row.name}`]), warehouse)}</select></div>
            <div class="field full"><label for="jb-form-note">หมายเหตุ</label><textarea class="textarea" id="jb-form-note" name="note" rows="2" maxlength="1000"></textarea></div>
          </div>
          ${previewHtml}
          <p class="muted small">ขั้นตอนคัดลอกจาก Routing ของชิ้นงานนั้น (สินค้าของใบสั่งผลิตใช้ Routing ที่ผูกไว้ตอนวางแผน) · เลขที่ใบงานระบบออกให้</p>
          <div class="fm-actions"><button class="btn" type="submit">ออกใบงาน</button>
            <a class="btn secondary" href="${escapeHtml(poUrl(workOrder.id))}">ยกเลิก</a></div>
        </form>
      </section>`;
  }

  function bindForm(root, data, workOrder) {
    const form = root.querySelector("#jb-form");
    const errorBox = root.querySelector("#jb-form-error");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const payload = model.jobPayload({ ...Object.fromEntries(new FormData(form).entries()), production_order_id: workOrder.id });
      const problems = model.validateJobPayload(payload, data);
      if (problems.length) {
        errorBox.textContent = problems.join(" · ");
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: "nearest" });
        return;
      }
      setFormBusy(form, true);
      try {
        const { data: created, error } = await sb.rpc("app_factory_create_job", payload);
        if (error) throw error;
        showToast(`ออกใบงาน ${created.code} แล้ว`);
        location.hash = viewUrl(created.id).slice(1);
      } catch (error) {
        setFormBusy(form, false);
        errorBox.textContent = friendlyError(error);
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: "nearest" });
      }
    });
  }

  // ---------- ลงทะเบียน view ----------
  const gone = (back, text = ERROR_MESSAGES.JOB_NOT_FOUND) => ({ back, body: `<section class="card"><div class="empty">${escapeHtml(text)}</div></section>` });
  const newJobAction = () => `<a class="btn" href="${escapeHtml(menu.url("job-new"))}"><span class="plus-icon" aria-hidden="true"></span> ออกใบงานผลิต</a>`;

  const VIEWS = {
    async "job-queue"({ frame }) {
      frame.loading();
      const data = await loadData();
      const code = dept();
      if (!code) return frame.paint({ body: `<section class="card">${notice("ไม่พบแผนกของผู้ใช้ปัจจุบัน — เข้าโหมดทดสอบแล้วเลือก “ทำหน้าที่เป็น” พนักงานของแผนกที่ต้องการ")}</section>` });
      return frame.paint({ subtitle: `แผนก ${code}`, body: queueHtml(data, code) });
    },
    async job({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const id = params.get("jb");
      const back = { href: menu.url("job-view"), label: "‹ กลับรายการใบงานผลิต" };
      if (id) {
        const job = byId(data.jobs, id);
        if (!job) return frame.paint(gone(back));
        const root = frame.paint({ back, subtitle: job.code, body: `${detailHtml(data, job)}${job.status === "open" ? `<section class="card fm-detail">${requirementsHtml(data, job)}</section>` : ""}${actionsHtml(data, job)}${supportingDetailsHtml(data, job)}` });
        return bindDetail(root, job);
      }
      return frame.paint({ actions: newJobAction(), body: listHtml(data, params) });
    },
    async "job-new"({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const wo = params.get("wo");
      const back = { href: menu.url("job-view"), label: "‹ กลับรายการใบงานผลิต" };
      if (!wo) return frame.paint({ body: chooseHtml(data) });
      const workOrder = byId(data.production, wo);
      if (!workOrder) return frame.paint(gone(back, ERROR_MESSAGES.JOB_WORK_ORDER_UNKNOWN));
      if (!["released", "in_progress"].includes(workOrder.status)) {
        return frame.paint({ back, body: `<section class="card">${notice(ERROR_MESSAGES.JOB_WORK_ORDER_NOT_RELEASED)}<div class="fm-actions"><a class="btn secondary" href="${escapeHtml(poUrl(workOrder.id))}">ดูใบสั่งผลิต ${escapeHtml(workOrder.code)}</a></div></section>` });
      }
      const root = frame.paint({ back, subtitle: workOrder.code, body: formHtml(data, workOrder, params) });
      return bindForm(root, data, workOrder);
    },
    // หน้าแผนก (#/factory?dept=<รหัส>): คิวของแผนกนั้น + ทางลัดของฝ่ายวางแผน
    async department({ department, frame }) {
      frame.loading();
      const data = await loadData();
      const planning = department.code === model.PLANNING_DEPARTMENT
        ? `<section class="card"><h2>งานของฝ่ายวางแผน</h2><div class="fm-actions">
            <a class="btn" href="${escapeHtml(menu.url("production-planning"))}">คิวใบสั่งผลิต (รับ/วางแผน/ออกใบสั่งงาน)</a>
            <a class="btn secondary" href="${escapeHtml(menu.url("job-new"))}">ออกใบงานผลิต</a>
            <a class="btn secondary" href="${escapeHtml(menu.url("job-view"))}">รายการใบงานผลิต</a></div></section>` : "";
      return frame.paint({ body: `${planning}${queueHtml(data, department.code)}` });
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
