// ใบสั่งงาน IT (IT01-FM06) — HTML ของหน้าต่าง ๆ เป็นสตริงล้วน ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itwo-pages.test.mjs)
// การเชื่อมต่อ (เรียก RPC ผูกปุ่ม กล่องยืนยัน) อยู่ที่ modules/module-itwo.js · ข้อมูลล้วน/กติกาอยู่ที่ modules/itwo-model.js
//
// หน้าตาใช้คอมโพเนนต์เดิมของ Pilot: หัวโมดูล .request-module-header (data-module="it") · แท็บ .view-tabs · ตาราง .register-table
// (ผ่าน registerTableHtml ของ app.js ซึ่งมีเรียงคอลัมน์และการ์ดบนมือถือในตัว) · ไทม์ไลน์ .timeline · .definition-grid · ฟอร์มทีละขั้นของ MNP_FORM_STEPS
// ไฟล์นี้โหลดก่อน app.js: helper ของ app.js (registerTableHtml ฯลฯ) อ้างตอนวาดหน้าเท่านั้น ในเทสต์ Node ถอยไปใช้ตัวสำรองที่เรียบกว่า
(function (root) {
  "use strict";

  const model = root.MNP_ITWO_MODEL;
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const iconOf = (name) => root.MNP_UI_ICONS?.icon(name) ?? "";
  const REQUIRED = '<span class="field-required">(จำเป็น)</span>';
  const PALETTE = "it";

  /* ---------- ตัวช่วยร่วม ---------- */
  // ตารางรายการ: ใช้ registerTableHtml ของ app.js ถ้ามี (เรียงคอลัมน์ + การ์ดมือถือ) ไม่มี (เทสต์) ใช้ตารางเรียบ ๆ ชุด class เดียวกัน
  function table({ label, columns, rows }) {
    if (typeof registerTableHtml === "function") return registerTableHtml({ label, columns, rows });
    const head = columns.map((column) => `<th scope="col">${esc(column.label)}</th>`).join("");
    const body = rows.map((row) => `<tr>${columns.map((column) => `<td class="register-${column.role ?? "meta"}" data-label="${esc(column.label)}">${row.cells[column.key] || "—"}</td>`).join("")}</tr>`).join("");
    return `<div class="register-wrap"><table class="register-table" aria-label="${esc(label)}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const emptyBlock = (text, hint = "") => (typeof emptyState === "function"
    ? emptyState(text, { hint })
    : `<div class="empty"><p>${esc(text)}</p>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`);
  const noLink = (docNo, href) => `<a class="request-no register-no-link" href="${esc(href)}">${esc(docNo)}</a>`;
  const subText = (text) => `<span class="register-sub" title="${esc(text)}">${esc(text)}</span>`;
  const subjectCell = (main, href, secondary) => `<a class="register-title" href="${esc(href)}">${esc(main)}</a>${secondary ? subText(secondary) : ""}`;
  const testTag = (isTest) => (isTest ? '<span class="badge itwo-test-tag" title="ข้อมูลทดสอบ แยกจากระบบจริง">ทดสอบ</span>' : "");
  const urgentTag = (urgent) => (urgent ? '<span class="badge urgent-flag">ด่วน</span>' : "");
  const statusBadge = (status, mine = false) => `<span class="badge ${esc(model.statusBadgeClass(status))}">${esc(mine ? model.myStatusLabel(status) : model.statusLabel(status))}</span>`;
  const subjectOf = (row) => model.clip(row.details, 90) || model.requestTypeText(row.request_type, row.misc_detail);
  // ป้ายงานแก้ไข "แก้ไขครั้งที่ N · กำหนด วว/ดด/ปปปป" (ไม่เคยขอแก้ไข = ไม่มีป้าย)
  const reworkBadge = (roundNo, dueDate) => {
    const text = model.reworkTag(roundNo, dueDate);
    return text ? `<span class="badge itwo-rework-tag">${esc(text)}</span>` : "";
  };
  // เบ็ดเตล็ด: ระบุว่างานอะไรไว้ใต้เรื่อง (ประเภทอื่นไม่ต้องบอกซ้ำ เพราะเรื่องบอกอยู่แล้ว)
  const miscNote = (row) => (row.request_type === "misc" ? model.requestTypeText("misc", row.misc_detail) : "");
  const orderHref = (id) => model.workOrderUrl("order", { id });

  /* ---------- หัวหน้า ---------- */
  // ชื่อโมดูลเป็น h1 ที่นี่ที่เดียว · isTest = ผู้ใช้อยู่ในโหมดทดสอบ (ข้อมูลของหน้านี้เป็นข้อมูลทดสอบทั้งหมด)
  function head({ title = "ใบสั่งงาน IT", back = { href: "#/office?module=it-support", label: "‹ IT SUPPORT" }, actions = "", isTest = false } = {}) {
    return `${back ? `<a class="request-back-link" href="${esc(back.href)}">${esc(back.label)}</a>` : ""}
      <div class="page-heading request-module-header itwo-head" data-module="${PALETTE}">
        <div class="request-module-title"><span class="type-card-badge">${iconOf("clipboard-check")}</span><h1>${esc(title)}</h1>${testTag(isTest)}</div>
        ${actions ? `<div class="request-create-entry">${actions}</div>` : ""}
      </div>`;
  }
  const newButton = () => `<a class="btn" id="itwo-new" href="${esc(model.workOrderUrl("new"))}"><span class="plus-icon" aria-hidden="true"></span> แจ้งงานใหม่</a>`;

  // แท็บตามสิทธิ์ · counts = { mine, approvals, it } ตัวเลขบนแท็บ (ไม่ระบุ/นับไม่ได้ = ไม่แสดง)
  // mine = ใบที่ IT ปิดงานแล้วรอผู้แจ้ง (คุณ) ยืนยัน/ขอแก้ไข · ตัวเลขบนแท็บบอกว่ามีงานกลับมาหาคุณ
  const COUNT_NOTES = Object.freeze({ mine: " ที่รอคุณยืนยัน", approvals: " ที่รออนุมัติ", it: " ที่ต้องดำเนินการ" });
  function tabs(role, active, counts = {}) {
    const items = model.visibleTabs(role).map((tab) => {
      const count = counts[tab.key];
      const badge = Number.isFinite(count) && count > 0 ? ` <span class="itwo-tab-count" aria-label="${count} รายการ${COUNT_NOTES[tab.key] ?? ""}" title="${count} รายการ${COUNT_NOTES[tab.key] ?? ""}">${count > 99 ? "99+" : count}</span>` : "";
      return `<a class="view-tab${tab.key === active ? " active" : ""}"${tab.key === active ? ' aria-current="page"' : ""} href="${esc(model.workOrderUrl(tab.key))}">${esc(tab.label)}${badge}</a>`;
    });
    // ผู้ใช้ที่มีแท็บเดียว (พนักงานทั่วไป) ไม่มีแถบแท็บ ยกเว้นมีใบรอคุณยืนยัน: ต้องเห็นตัวเลขว่างานกลับมาหาตัวเอง
    return items.length > 1 || counts.mine > 0 ? `<nav class="view-tabs" aria-label="หมวดใบสั่งงาน IT">${items.join("")}</nav>` : "";
  }

  // ครอบทั้งหน้าด้วยจานสีของโมดูล + ข้อความข้อผิดพลาดของหน้า (ข้อความเดียว อยู่เหนือเนื้อหา)
  const page = (inner) => `<div class="itwo-page" data-module="${PALETTE}">${inner}</div>`;
  const errorCard = (message, { retry = true } = {}) => `<section class="card"><div class="form-message error" role="alert">${esc(message)}</div>${retry ? '<button class="btn secondary" type="button" id="itwo-retry">ลองอีกครั้ง</button>' : ""}</section>`;

  /* ---------- รายการ: ใบของฉัน / รออนุมัติ / งาน IT ---------- */
  function mineList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ยังไม่มีใบสั่งงานที่คุณแจ้ง", "กด \"แจ้งงานใหม่\" เพื่อสร้างใบสั่งงาน IT")}</section>`;
    return table({
      label: "ใบสั่งงานของฉัน",
      columns: [
        { key: "no", label: "เลขที่", role: "no" },
        { key: "subject", label: "เรื่อง", role: "subject" },
        { key: "needed", label: "ต้องการงาน" },
        { key: "created", label: "แจ้งเมื่อ", sorted: "descending" },
        { key: "status", label: "สถานะ", role: "status" },
      ],
      rows: rows.map((row) => ({
        className: `status-${row.status}`,
        sort: { created: row.created_at ?? "", needed: row.needed_date ?? "" },
        cells: {
          no: noLink(row.doc_no, orderHref(row.id)),
          subject: subjectCell(subjectOf(row), orderHref(row.id), model.requestTypeText(row.request_type, row.misc_detail)),
          needed: esc(model.formatDate(row.needed_date)),
          created: esc(model.formatDateTime(row.created_at)),
          status: `<span class="register-badges">${statusBadge(row.status, true)}${urgentTag(row.is_urgent)}${reworkBadge(row.rework_round, row.rework_due_date)}</span>`,
        },
      })),
    });
  }

  function approvalsList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ไม่มีใบสั่งงานที่รออนุมัติจากคุณ")}</section>`;
    return table({
      label: "ใบสั่งงานที่รอคุณอนุมัติ",
      columns: [
        { key: "no", label: "เลขที่", role: "no" },
        { key: "subject", label: "เรื่อง", role: "subject" },
        { key: "needed", label: "ต้องการงาน" },
        { key: "created", label: "แจ้งเมื่อ", sorted: "descending" },
        { key: "status", label: "รอคุณ", role: "status" },
      ],
      rows: rows.map((row) => ({
        className: `status-${row.status}`,
        sort: { created: row.created_at ?? "", needed: row.needed_date ?? "" },
        cells: {
          no: noLink(row.doc_no, orderHref(row.id)),
          subject: subjectCell(subjectOf(row), orderHref(row.id), [miscNote(row), row.requester_name, row.department_name].filter(Boolean).join(" · ")),
          needed: esc(model.formatDate(row.needed_date)),
          created: esc(model.formatDateTime(row.created_at)),
          status: `<span class="register-badges"><span class="badge pending_approval">${esc(model.pendingStepLabel(row.pending_step))}</span>${urgentTag(row.is_urgent)}</span>`,
        },
      })),
    });
  }

  // งาน IT แยกตามสถานะ งานด่วนอยู่บนสุดของแต่ละกลุ่ม · กลุ่ม "จบแล้ว" พับไว้ (ไม่ใช่งานที่ต้องลงมือ)
  function itList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ยังไม่มีใบสั่งงาน")}</section>`;
    const groups = model.groupItOrders(rows);
    const sections = model.IT_GROUPS.filter((group) => groups[group.key].length).map((group) => {
      const items = groups[group.key];
      const closed = group.key === "closed";
      const content = table({
        label: group.label,
        columns: [
          { key: "no", label: "เลขที่", role: "no" },
          { key: "subject", label: "เรื่อง", role: "subject" },
          { key: "needed", label: "ต้องการงาน" },
          { key: "approval", label: "อนุมัติ" },
          { key: "status", label: "สถานะ", role: "status" },
        ],
        rows: items.map((row) => ({
          className: `status-${row.status}`,
          sort: { needed: (row.rework_round > 0 && row.rework_due_date ? row.rework_due_date : row.needed_date) ?? "" },
          cells: {
            no: noLink(row.doc_no, orderHref(row.id)),
            subject: subjectCell(subjectOf(row), orderHref(row.id), [miscNote(row), row.requester_full_name, row.department_name].filter(Boolean).join(" · ")),
            needed: esc(model.formatDate(row.needed_date)),
            approval: model.itApprovalProgress(row).map((step) => `<span class="itwo-step${step.done ? " is-done" : ""}">${step.done ? "✓" : "○"} ${esc(step.label)}</span>`).join(""),
            status: `<span class="register-badges">${statusBadge(row.status)}${urgentTag(row.is_urgent)}${reworkBadge(row.rework_round, row.rework_due_date)}</span>`,
          },
        })),
      });
      const title = `${esc(group.label)} <span class="detail-section-count">${items.length}</span>`;
      return closed
        ? `<details class="card detail-section itwo-group" data-group="${group.key}"><summary><h2>${title}</h2></summary>${content}</details>`
        : `<section class="card detail-section itwo-group" data-group="${group.key}" aria-labelledby="itwo-g-${group.key}"><h2 id="itwo-g-${group.key}">${title}</h2>${content}</section>`;
    });
    return `<div class="stack">${sections.join("")}</div>`;
  }

  /* ---------- ฟอร์มแจ้งงานใหม่ (MNP_FORM_STEPS: 2 ขั้น + ทบทวน) ---------- */
  function choiceGroup({ name, legend, options, value, required = false, field }) {
    return `<fieldset class="field" data-field="${field ?? name}">
      <legend>${esc(legend)} ${required ? REQUIRED : ""}</legend>
      <div class="itwo-choices" data-invalid-target role="radiogroup" aria-label="${esc(legend)}">${options.map((option) => `<label class="itwo-choice"><input type="radio" name="${name}" value="${esc(option.value)}"${option.value === value ? " checked" : ""}> <span>${esc(option.label)}</span></label>`).join("")}</div>
    </fieldset>`;
  }

  // ช่องเลือกไฟล์: ปุ่มเดียวกับฟอร์มอื่นของ Pilot · modules/attachment-image.js ดักช่องไฟล์ทุกช่องทั้งหน้า (แปลงรูป HEIC/รูปใหญ่เป็น JPG ตรวจจำนวนและขนาดรวม)
  // และ attachment-preview.js วาดรายการไฟล์ที่เลือกใต้ช่อง (มีปุ่ม × ลบออกจากรายการได้) จึงไม่ต้องเขียนรายการเองที่นี่
  const fileField = ({ id, field, label = "ไฟล์แนบ", hidden = false }) => `<div class="field itwo-file-field" data-field="${esc(field)}" id="${esc(id)}-field"${hidden ? " hidden" : ""}>
        <span class="field-label">${esc(label)}</span>
        <label class="btn secondary file-pick" for="${esc(id)}" title="${esc(model.FILE_HINT)}">${iconOf("camera")} ถ่ายรูป / เลือกไฟล์</label>
        <input class="file-pick-input" id="${esc(id)}" name="${esc(id)}" type="file" multiple accept="${esc(model.FILE_ACCEPT)}">
        <small>${esc(model.FILE_HINT)}</small>
      </div>`;

  // requester = { name, department } จาก my_role · ระบบเติมชื่อ/แผนก/วันเวลาให้เอง จึงบอกไว้ครั้งเดียวที่ขั้นแรก
  function orderForm({ requester = null } = {}) {
    const steps = root.MNP_FORM_STEPS;
    const who = requester ? `${esc(requester.name)}${requester.department ? ` · ${esc(requester.department)}` : ""}` : "";
    return `<section class="card form-card" id="itwo-form-card"><div id="itwo-message" role="status"></div>
      <div class="draft-banner" id="itwo-draft" role="region" aria-label="ร่างที่ค้างอยู่" hidden></div>
      <form id="itwo-form" class="stepped-form" novalidate>
        ${steps?.headHtml?.() ?? ""}
        <fieldset class="form-step" data-step="1">
          <legend class="form-step-title">งานอะไร</legend>
          ${who ? `<p class="muted small itwo-requester">ผู้แจ้ง ${who} · ระบบบันทึกวันและเวลาที่แจ้งให้เอง</p>` : ""}
          ${choiceGroup({ name: "request_type", field: "request_type", legend: "ประเภทคำขอ", options: model.REQUEST_TYPES, value: "", required: true })}
          <div class="field" data-field="misc_detail" id="itwo-misc-field" hidden><label for="itwo-misc-detail">ระบุว่างานอะไร ${REQUIRED}</label><input class="input" id="itwo-misc-detail" name="misc_detail" maxlength="${model.MAX_MISC_DETAIL}" autocomplete="off"></div>
          <div class="field" data-field="order_ref"><label for="itwo-order-ref">ออเดอร์ (ไม่บังคับ)</label><input class="input" id="itwo-order-ref" name="order_ref" maxlength="${model.MAX_ORDER_REF}" autocomplete="off"></div>
          ${choiceGroup({ name: "attachment_flag", field: "attachment_flag", legend: "เอกสารแนบ", options: model.ATTACHMENT_FLAGS, value: "no" })}
          <div class="field" data-field="attachment_note" id="itwo-attachment-note-field" hidden><label for="itwo-attachment-note">ระบุเอกสารแนบ ${REQUIRED}</label><input class="input" id="itwo-attachment-note" name="attachment_note" maxlength="${model.MAX_ATTACHMENT_NOTE}" autocomplete="off"></div>
          ${fileField({ id: "itwo-files", field: "attachment_files", hidden: true })}
          <div class="field" data-field="details"><label for="itwo-details">รายละเอียด ${REQUIRED}</label><textarea class="textarea" id="itwo-details" name="details" rows="5" maxlength="${model.MAX_DETAILS}"></textarea><small>บอกให้ชัดว่าต้องการอะไร เพื่อให้ IT ไม่ต้องถามซ้ำ (ไม่เกิน ${model.MAX_DETAILS.toLocaleString("en-US")} ตัวอักษร)</small></div>
        </fieldset>
        <fieldset class="form-step" data-step="2">
          <legend class="form-step-title">ต้องการเมื่อไร</legend>
          <div class="field" data-field="needed_date"><label for="itwo-needed-date">วันที่ต้องการงาน ${REQUIRED}</label><input class="input" id="itwo-needed-date" name="needed_date" type="date"></div>
          <div class="field"><label class="itwo-choice itwo-urgent"><input type="checkbox" id="itwo-urgent" name="is_urgent"> <span>งานด่วน</span></label><small>IT เริ่มทำได้ก่อนอนุมัติครบ แต่ผู้จัดการยังต้องอนุมัติตามหลัง และใบจะปิดได้เมื่ออนุมัติครบแล้วเท่านั้น</small></div>
          <p class="muted small itwo-duration">หมายเหตุ: ระยะเวลาทำงาน ${esc(model.DURATION_NOTE)}</p>
        </fieldset>
        <fieldset class="form-step form-step-review" data-step="3">
          <legend class="form-step-title">ทบทวนก่อนส่ง</legend>
          <div id="itwo-review"></div>
        </fieldset>
        ${steps?.actionsHtml?.({ cancelHref: model.workOrderUrl("mine"), submitLabel: "ส่งใบสั่งงาน" }) ?? ""}
      </form></section>`;
  }
  // รายการไฟล์ที่เลือก "ชื่อ (ขนาด)" คั่นด้วยจุลภาค · files = [{ name, size }]
  const fileListText = (files) => files.map((file) => `${file.name} (${model.formatFileSize(file.size)})`).join(", ");
  // ขั้นทบทวน: ช่องที่ไม่ได้กรอกไม่ขึ้น (ออเดอร์ หมายเหตุเอกสารแนบ) · values = ค่าในฟอร์ม · files = ไฟล์ที่เลือก (นับเฉพาะเมื่อเอกสารแนบ = "มี")
  function orderReview(values, files = []) {
    const row = (label, value, wide = false) => (value ? `<div class="definition${wide ? " wide" : ""}"><dt>${esc(label)}</dt><dd${wide ? ' class="review-text"' : ""}>${esc(value)}</dd></div>` : "");
    const attachment = values.attachment_flag === "other" && values.attachment_note ? `${model.attachmentFlagLabel("other")} (${values.attachment_note})` : model.attachmentFlagLabel(values.attachment_flag);
    const attached = values.attachment_flag === "yes" && files.length ? `${files.length} ไฟล์: ${fileListText(files)}` : "";
    return `<dl class="definition-grid review-grid">
        ${row("ประเภทคำขอ", model.requestTypeText(values.request_type, String(values.misc_detail ?? "").trim()))}
        ${row("ออเดอร์", String(values.order_ref ?? "").trim())}
        ${row("เอกสารแนบ", attachment)}
        ${row("ไฟล์แนบ", attached, true)}
        ${row("วันที่ต้องการงาน", model.formatDate(values.needed_date))}
        ${row("ความเร่งด่วน", values.is_urgent ? "งานด่วน" : "ปกติ")}
        ${row("รายละเอียด", String(values.details ?? "").trim(), true)}
      </dl>
      <p class="muted small">ตรวจแล้วกดส่ง หรือย้อนกลับไปแก้</p>`;
  }

  /* ---------- ความคืบหน้าอัปโหลดไฟล์ (หลังสร้างใบ / ส่งคำขอแก้ไข) ---------- */
  // rows = [{ name, size, state: "done" | "working" | "waiting" | "failed", message }] · busy = กำลังอัปโหลดอยู่
  // ใบ/รอบแก้ไขถูกบันทึกไปแล้ว ไฟล์เป็นส่วนเสริม: ล้มไฟล์ไหนลองซ้ำได้ (ภายใน 30 นาทีหลังแจ้ง) ไม่ทำให้ใบหาย
  const UPLOAD_STATE_TEXT = Object.freeze({ done: "แนบแล้ว", working: "กำลังแนบ…", waiting: "รอคิว", failed: "แนบไม่สำเร็จ" });
  function uploadPanel({ heading, intro = "", rows, busy = false, continueLabel = "ไปที่ใบสั่งงาน" }) {
    const done = rows.filter((row) => row.state === "done").length;
    const failed = rows.filter((row) => row.state === "failed").length;
    const summary = busy
      ? `กำลังแนบไฟล์ ${Math.min(done + 1, rows.length)} จาก ${rows.length}`
      : failed ? `แนบไม่สำเร็จ ${failed} จาก ${rows.length} ไฟล์ (แนบแล้ว ${done})` : `แนบครบ ${done} ไฟล์`;
    const items = rows.map((row) => `<li class="itwo-upload-row is-${esc(row.state)}"><span class="itwo-upload-name" title="${esc(row.name)}">${esc(row.name)} <span class="muted small">${esc(model.formatFileSize(row.size))}</span></span><span class="itwo-upload-state">${esc(UPLOAD_STATE_TEXT[row.state] ?? "")}</span>${row.message ? `<span class="itwo-upload-message">${esc(row.message)}</span>` : ""}</li>`).join("");
    return `<section class="itwo-upload" aria-labelledby="itwo-upload-title"${busy ? ' aria-busy="true"' : ""}>
        <h2 id="itwo-upload-title">${esc(heading)}</h2>
        ${intro ? `<p class="muted small">${esc(intro)}</p>` : ""}
        <p class="itwo-upload-summary" role="status">${esc(summary)}</p>
        <ul class="itwo-upload-list">${items}</ul>
        ${busy ? "" : `<div class="form-actions">${failed ? '<button type="button" class="btn is-primary" id="itwo-upload-retry">ลองแนบไฟล์ที่ไม่สำเร็จอีกครั้ง</button>' : ""}<button type="button" class="btn secondary" id="itwo-upload-continue">${esc(continueLabel)}</button></div>`}
      </section>`;
  }

  /* ---------- หน้ารายละเอียด ---------- */
  const fact = (label, value, wide = false) => `<div class="definition${wide ? " wide" : ""}"><dt>${esc(label)}</dt><dd${wide ? ' class="itwo-text"' : ""}>${value}</dd></div>`;

  function detailHead(detail, back = { href: model.workOrderUrl("mine"), label: "‹ ใบสั่งงาน IT" }) {
    const summary = model.approvalSummary(detail);
    const waiting = !["cancelled", "rejected", "received"].includes(detail.status);
    // ขั้นอนุมัติบอกเฉพาะที่ยังไม่เสร็จ (ผู้อนุมัติ/เวลาของขั้นที่เสร็จแล้วอยู่ในประวัติเอกสารแล้ว)
    const pending = waiting ? summary.filter((step) => step.state === "waiting").map((step) => step.label) : [];
    const meta = [`โดย ${detail.requester?.full_name ?? "—"}`, detail.department?.name_th, `แจ้งเมื่อ ${model.formatDateTime(detail.created_at)}`].filter(Boolean).join(" · ");
    return `<a class="request-back-link" href="${esc(back.href)}">${esc(back.label)}</a>
      <header class="request-detail-head request-module-header itwo-detail-head" data-module="${PALETTE}">
        <div class="request-detail-kicker">
          <span class="eyebrow"><span class="nowrap">IT01-FM06</span></span>
          <div class="request-detail-kicker-end">${statusBadge(detail.status)}${urgentTag(detail.is_urgent)}${reworkBadge(detail.rework_round, detail.latest_due_date)}${testTag(detail.is_test || model.isTestDoc(detail.doc_no))}</div>
        </div>
        <h1>${esc(detail.doc_no)}</h1>
        <p class="request-detail-meta">${esc(meta)}</p>
        ${pending.length ? `<p class="request-detail-meta itwo-pending-steps">ยังไม่ได้อนุมัติ: ${esc(pending.join(" · "))}</p>` : ""}
      </header>`;
  }

  // ปุ่มการกระทำตาม allowed_actions (ทุกปุ่มมีกล่องยืนยันที่ module-itwo.js · "แก้ไขงาน" เปิดฟอร์มขอแก้ไขแทนกล่องยืนยัน) · ไม่มีปุ่มก็ไม่แสดงการ์ด
  function actionsCard(buttons) {
    if (!buttons.length) return "";
    return `<section class="card detail-actions itwo-actions" aria-labelledby="itwo-actions-title">
      <h2 id="itwo-actions-title">สิ่งที่คุณทำได้กับใบนี้</h2>
      <div class="action-panel-buttons">${buttons.map((button) => {
        const tone = button.tone === "danger" ? " danger" : button.tone === "success" ? " success" : button.tone === "secondary" ? " secondary" : "";
        return `<button type="button" class="btn${tone}" data-itwo-action="${esc(button.action)}">${esc(button.label)}</button>`;
      }).join("")}</div>
      <div class="form-message error" id="itwo-action-error" role="alert" hidden></div>
    </section>`;
  }

  // สิทธิ์ในระบบของใบเก่า (อ่านอย่างเดียว ไม่มีปุ่มแก้) · ใบที่ไม่มีข้อมูลไม่เรียกฟังก์ชันนี้ (ไม่แสดงหัวข้อ)
  function accessRowsView(changes) {
    return `<div class="table-wrap"><table class="itwo-access-table"><thead><tr><th scope="col">ระบบ</th><th scope="col">การดำเนินการ</th><th scope="col">ชื่อผู้ใช้ใหม่</th><th scope="col">ชื่อผู้ใช้เดิม</th><th scope="col">หมายเหตุ</th></tr></thead><tbody>${changes.map((change) => `<tr>
        <td data-label="ระบบ">${esc(model.accessSystemLabel(change.system))}</td>
        <td data-label="การดำเนินการ">${esc(model.accessActionLabel(change.action))}</td>
        <td data-label="ชื่อผู้ใช้ใหม่">${esc(change.new_username ?? "") || "—"}</td>
        <td data-label="ชื่อผู้ใช้เดิม">${esc(change.old_username ?? "") || "—"}</td>
        <td data-label="หมายเหตุ">${esc(change.note ?? "") || "—"}</td></tr>`).join("")}</tbody></table></div>`;
  }
  const legacyAccessSection = (changes) => (changes.length
    ? `<section class="card itwo-access" aria-labelledby="itwo-access-title"><h2 id="itwo-access-title">สำหรับแผนก IT : สิทธิ์ในระบบ</h2><p class="muted small">ข้อมูลที่ IT บันทึกไว้ก่อนถอดส่วนนี้ออกจากใบสั่งงาน (ดูอย่างเดียว)</p>${accessRowsView(changes)}</section>`
    : "");

  /* ---------- ไฟล์แนบ (แยกตามรอบ) ---------- */
  // ชนิดไฟล์สำหรับป้ายบนกระเบื้อง (เกณฑ์เดียวกับ attachmentKind ใน app.js แต่อ่านจาก mime_type ของ itwo_attachments)
  const FILE_KIND_LABELS = Object.freeze({ image: "รูปภาพ", pdf: "PDF", text: "ข้อความ", sheet: "Excel", doc: "Word", other: "ไฟล์แนบ" });
  function fileKind(file) {
    const type = String(file.mime_type ?? "").toLowerCase();
    const name = String(file.file_name ?? "").toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv")) return "text";
    if (type.includes("spreadsheet") || name.endsWith(".xlsx") || name.endsWith(".xls")) return "sheet";
    if (type.includes("wordprocessing") || name.endsWith(".docx") || name.endsWith(".doc")) return "doc";
    return "other";
  }
  // กระเบื้องแบบเดียวกับ attachmentGalleryHtml ของ app.js (สไตล์ + การเติมตัวอย่าง/ลิงก์ดาวน์โหลด/กล่องดูไฟล์ใช้ของเดิม) ต่างที่ไฟล์ของใบสั่งงานไม่มีภาพย่อ
  const fileTile = (file) => `<figure class="attachment-tile" data-attachment="${esc(file.id)}">
        <button class="attachment-preview" type="button" data-attachment-open="${esc(file.id)}" aria-label="ดูขนาดใหญ่: ${esc(file.file_name)}">
          <span class="attachment-preview-state">กำลังสร้างตัวอย่าง…</span>
          <span class="attachment-kind">${esc(FILE_KIND_LABELS[fileKind(file)])}</span>
        </button>
        <figcaption class="attachment-caption">
          <span class="attachment-name" title="${esc(file.file_name)}">${esc(file.file_name)}</span>
          <span class="attachment-meta"><span>${esc(model.formatFileSize(file.size_bytes))}</span><a class="attachment-download" data-attachment-download="${esc(file.id)}" hidden download>ดาวน์โหลด</a></span>
        </figcaption>
      </figure>`;
  const fileGrid = (files) => `<div class="attachment-grid">${files.map(fileTile).join("")}</div>`;

  // รอบแก้ไขงาน: ทุกรอบเรียงตามลำดับ (รายละเอียดที่ต้องแก้ วันที่กำหนด ผู้ขอ ไฟล์ของรอบนั้น)
  function reworkRoundsCard(rounds) {
    return `<section class="card itwo-reworks" aria-labelledby="itwo-reworks-title"><h2 id="itwo-reworks-title">ประวัติการแก้ไขงาน <span class="detail-section-count">${rounds.length}</span></h2>
      ${rounds.map((round) => `<article class="itwo-rework-round" data-round="${round.roundNo}">
        <h3>${esc(round.label)} <span class="muted small">· กำหนดเสร็จ ${esc(model.formatDate(round.dueDate))}</span></h3>
        <p class="itwo-text">${esc(round.details)}</p>
        <p class="muted small">ขอโดย ${esc(round.requestedBy)} · ${esc(model.formatDateTime(round.createdAt))}</p>
        ${round.files.length ? fileGrid(round.files) : ""}
      </article>`).join("")}
    </section>`;
  }

  // บล็อกไฟล์ + รอบแก้ไข ห่อด้วย #attachment-gallery ตัวเดียว: app.js (hydrateAttachmentGallery / กล่องดูไฟล์) หา id นี้ ไม่มีไฟล์และไม่มีรอบแก้ไข = ไม่วาดอะไร
  function filesAndReworks(detail) {
    const initial = (detail.attachments ?? []).filter((file) => !file.rework_id);
    const rounds = model.reworkRounds(detail);
    if (!initial.length && !rounds.length) return "";
    return `<div class="stack" id="attachment-gallery">
      ${initial.length ? `<section class="card itwo-files" aria-labelledby="itwo-files-title"><h2 id="itwo-files-title">ไฟล์แนบ <span class="detail-section-count">${initial.length}</span></h2>${fileGrid(initial)}</section>` : ""}
      ${rounds.length ? reworkRoundsCard(rounds) : ""}
    </div>`;
  }

  // ฟอร์มขอแก้ไขงาน (ผู้แจ้ง ตอน IT ปิดงานแล้ว) ซ่อนไว้จนกดปุ่ม "แก้ไขงาน" · กรอก 3 อย่าง: รายละเอียด วันที่กำหนดเสร็จ ไฟล์ (ไม่บังคับ)
  function reworkFormCard() {
    return `<section class="card itwo-rework-card" id="itwo-rework-card" aria-labelledby="itwo-rework-title" hidden>
      <h2 id="itwo-rework-title">แก้ไขงาน</h2>
      <p class="muted small">บอกสิ่งที่ต้องการให้ IT แก้ไข ใบจะกลับไปที่ IT ทันทีโดยไม่ต้องอนุมัติใหม่</p>
      <div id="itwo-rework-message" role="status"></div>
      <form id="itwo-rework-form" novalidate>
        <div class="field" data-field="details"><label for="itwo-rework-details">รายละเอียดที่ต้องแก้ ${REQUIRED}</label><textarea class="textarea" id="itwo-rework-details" name="details" rows="4" maxlength="${model.MAX_DETAILS}"></textarea></div>
        <div class="field" data-field="due_date"><label for="itwo-rework-due">วันที่ต้องการให้แก้ไขเสร็จ ${REQUIRED}</label><input class="input" id="itwo-rework-due" name="due_date" type="date"></div>
        ${fileField({ id: "itwo-rework-files", field: "rework_files", label: "แนบไฟล์ (ถ้ามี)" })}
        <div class="form-actions"><button type="button" class="btn secondary" id="itwo-rework-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ส่งให้ IT แก้ไข</button></div>
      </form>
    </section>`;
  }

  function historyCard(events) {
    const items = events.map((event) => `<div class="timeline-item"><strong>${esc(model.eventLabel(event.action))}</strong><p class="timeline-item-detail">โดย ${esc(event.actor_full_name)}</p>${event.reason ? `<p class="timeline-item-message">${esc(event.reason)}</p>` : ""}<time class="timeline-item-time" datetime="${esc(event.created_at)}">${esc(model.formatDateTime(event.created_at))}</time></div>`).join("");
    return `<section class="card detail-history" aria-labelledby="detail-history-title"><h2 id="detail-history-title">ประวัติเอกสาร</h2><div class="timeline">${items || '<div class="muted small">ยังไม่มีประวัติ</div>'}</div></section>`;
  }

  // ใบทั้งใบ · isViewOnly = ไม่ใช่เรื่องของหน้านี้ (ปุ่มซ่อนตาม allowed_actions อยู่แล้ว)
  function detailPage(detail, { back } = {}) {
    const buttons = model.actionButtons(detail.allowed_actions);
    const canRework = buttons.some((button) => button.action === "request_rework");
    const attachment = detail.attachment_flag === "other" && detail.attachment_note
      ? `${model.attachmentFlagLabel("other")} (${esc(detail.attachment_note)})`
      : esc(model.attachmentFlagLabel(detail.attachment_flag));
    return page(`${detailHead(detail, back)}
      <div class="detail-grid">
        <div class="stack">
          ${actionsCard(buttons)}
          ${canRework ? reworkFormCard() : ""}
          <section class="card itwo-facts" aria-labelledby="itwo-facts-title"><h2 id="itwo-facts-title">ข้อมูลใบสั่งงาน</h2>
            <dl class="definition-grid">
              ${fact("ประเภทคำขอ", esc(model.requestTypeText(detail.request_type, detail.misc_detail)))}
              ${fact("วันที่ต้องการงาน", esc(model.formatDate(detail.needed_date)))}
              ${fact("ออเดอร์", esc(detail.order_ref ?? "") || "—")}
              ${fact("เอกสารแนบ", attachment)}
              ${fact("รายละเอียด", esc(detail.details), true)}
            </dl>
            <p class="muted small itwo-duration">หมายเหตุ: ระยะเวลาทำงาน ${esc(model.DURATION_NOTE)}</p>
          </section>
          ${filesAndReworks(detail)}
          ${legacyAccessSection(model.legacyAccessChanges(detail))}
        </div>
        <aside class="stack">
          <section class="card itwo-print-card"><h2>เอกสาร</h2><div class="action-panel-buttons"><a class="btn secondary" id="itwo-print" href="${esc(model.workOrderUrl("print", { id: detail.id }))}">พิมพ์ใบสั่งงาน (A4)</a></div></section>
          ${historyCard(detail.events ?? [])}
        </aside>
      </div>`);
  }

  /* ---------- หน้าพิมพ์ A4 (เลย์เอาต์เหมือนฟอร์ม IT01-FM06) ---------- */
  const box = (checked) => `<span class="itwo-box" aria-hidden="true">${checked ? "☑" : "☐"}</span>`;
  function signatureGrid(events) {
    return `<div class="itwo-signatures">${model.signatureSlots(events).map((slot) => `<div class="itwo-signature" data-slot="${slot.key}">
        <div class="itwo-signature-label">${esc(slot.label)}</div>
        ${slot.note ? `<div class="itwo-signature-note">${esc(slot.note.label)}: ${esc(slot.note.name)} ${esc(model.formatDateTime(slot.note.at))}</div>` : ""}
        ${slot.remark ? `<div class="itwo-signature-note itwo-signature-remark">(${esc(slot.remark)})</div>` : ""}
        <div class="itwo-signature-name">${esc(slot.name ?? "")}</div>
        <div class="itwo-signature-time">${slot.at ? esc(model.formatDateTime(slot.at)) : ""}</div>
      </div>`).join("")}</div>`;
  }

  // รายชื่อไฟล์แนบบนกระดาษ (ไม่แสดงรูป): "ชื่อไฟล์ (ขนาด)" บรรทัดละไฟล์ · files = รายการจาก get_detail
  const printFileList = (files) => `<ul class="itwo-sheet-files">${files.map((file) => `<li>${esc(file.file_name)} <span class="itwo-sheet-file-size">(${esc(model.formatFileSize(file.size_bytes))})</span></li>`).join("")}</ul>`;

  // ประวัติการแก้ไขงานบนกระดาษ: ตารางทุกรอบ (ครั้งที่ · วันที่ขอ · รายละเอียดที่ต้องแก้ · กำหนดเสร็จ · ไฟล์) ไม่มีรอบ = ไม่มีส่วนนี้
  // แถวไม่ถูกตัดกลางหน้า และหัวตารางซ้ำเมื่อขึ้นหน้าใหม่ (CSS ที่ styles.css)
  function printReworks(rounds) {
    if (!rounds.length) return "";
    return `<h2 class="itwo-sheet-section">ประวัติการแก้ไขงาน</h2>
        <table class="itwo-sheet-table itwo-sheet-reworks"><thead><tr><th>ครั้งที่</th><th>ขอเมื่อ / โดย</th><th>รายละเอียดที่ต้องแก้</th><th>กำหนดเสร็จ</th><th>ไฟล์แนบ</th></tr></thead><tbody>${rounds.map((round) => `<tr>
          <td class="itwo-center">${round.roundNo}</td>
          <td>${esc(model.formatDateTime(round.createdAt))}<br>${esc(round.requestedBy)}</td>
          <td class="itwo-sheet-details">${esc(round.details)}</td>
          <td>${esc(model.formatDate(round.dueDate))}</td>
          <td>${round.files.length ? printFileList(round.files) : "—"}</td></tr>`).join("")}</tbody></table>`;
  }

  // ฟอร์มพิมพ์ตาม FM06: ประเภทคำขอมีแค่ งานออกแบบ / เบ็ดเตล็ดอื่นๆ (ใบเก่าที่เป็นสิทธิ์ในระบบแสดงตัวเลือกนั้นเพิ่มให้ติ๊กตรงกับใบ) · ส่วนสิทธิ์ในระบบพิมพ์เฉพาะใบเก่าที่มีข้อมูล
  function printSheet(detail) {
    const isTest = Boolean(detail.is_test) || model.isTestDoc(detail.doc_no);
    const attachmentChoices = model.ATTACHMENT_FLAGS.map((flag) => `<span class="itwo-choice-print">${box(detail.attachment_flag === flag.value)} ${esc(flag.label)}${flag.value === "other" && detail.attachment_flag === "other" && detail.attachment_note ? ` (${esc(detail.attachment_note)})` : ""}</span>`).join("");
    const typeChoices = model.printRequestTypes(detail.request_type).map((type) => `<span class="itwo-choice-print">${box(detail.request_type === type.value)} ${esc(type.label)}${type.value === "misc" && detail.request_type === "misc" && detail.misc_detail ? ` (ระบุ: ${esc(detail.misc_detail)})` : ""}</span>`).join("");
    const initialFiles = (detail.attachments ?? []).filter((file) => !file.rework_id);
    const accessChanges = model.legacyAccessChanges(detail);
    const accessRows = model.accessPrintRows(accessChanges).map((row) => `<tr>
        <td>${row.showSystemLabel ? esc(row.systemLabel) : ""}</td>
        ${model.ACCESS_ACTIONS.map((action) => `<td class="itwo-center">${box(row.action === action.value)}</td>`).join("")}
        <td>${esc(row.newUsername)}</td><td>${esc(row.oldUsername)}</td><td>${esc(row.note)}</td></tr>`).join("");
    const accessSection = accessChanges.length ? `<h2 class="itwo-sheet-section">สำหรับแผนก IT : สิทธิ์ในระบบ</h2>
        <table class="itwo-sheet-table itwo-sheet-access"><thead>
          <tr><th rowspan="2">ระบบ</th><th colspan="${model.ACCESS_ACTIONS.length}">การดำเนินการ</th><th rowspan="2">ชื่อผู้ใช้ใหม่</th><th rowspan="2">ชื่อผู้ใช้เดิม</th><th rowspan="2">หมายเหตุ</th></tr>
          <tr>${model.ACCESS_ACTIONS.map((action) => `<th>${esc(action.label)}</th>`).join("")}</tr>
        </thead><tbody>${accessRows}</tbody></table>` : "";
    return `<article class="itwo-sheet${isTest ? " is-test" : ""}" aria-label="ใบสั่งงาน ${esc(detail.doc_no)}">
        ${isTest ? '<div class="itwo-watermark" aria-hidden="true">ทดสอบ</div>' : ""}
        <header class="itwo-sheet-title">
          <div class="itwo-form-code">IT01-FM06</div>
          <h1>ใบสั่งงานแผนก IT</h1>
          ${isTest ? '<p class="itwo-test-note">ใบทดสอบ — ไม่ใช่เอกสารจริง</p>' : ""}
        </header>
        <table class="itwo-sheet-table"><tbody>
          <tr><th scope="row">เลขที่</th><td><strong>${esc(detail.doc_no)}</strong>${detail.is_urgent ? ' <strong class="itwo-urgent-mark">(งานด่วน)</strong>' : ""}</td><th scope="row">วันที่แจ้ง</th><td>${esc(model.formatDateTime(detail.created_at))}</td></tr>
          <tr><th scope="row">ผู้แจ้ง</th><td>${esc(detail.requester?.full_name ?? "—")}</td><th scope="row">แผนก</th><td>${esc(detail.department?.name_th ?? "—")}</td></tr>
          <tr><th scope="row">ประเภทคำขอ</th><td colspan="3">${typeChoices}</td></tr>
          <tr><th scope="row">ออเดอร์</th><td>${esc(detail.order_ref ?? "") || "—"}</td><th scope="row">เอกสารแนบ</th><td>${attachmentChoices}</td></tr>
          ${initialFiles.length ? `<tr><th scope="row">ไฟล์แนบ</th><td colspan="3">${printFileList(initialFiles)}</td></tr>` : ""}
          <tr><th scope="row">รายละเอียด</th><td colspan="3" class="itwo-sheet-details">${esc(detail.details)}</td></tr>
          <tr><th scope="row">วันที่ต้องการงาน</th><td>${esc(model.formatDate(detail.needed_date))}</td><th scope="row">งานด่วน</th><td>${box(detail.is_urgent)} ด่วน</td></tr>
        </tbody></table>
        ${accessSection}
        ${printReworks(model.reworkRounds(detail))}
        <h2 class="itwo-sheet-section">ลายเซ็น</h2>
        ${signatureGrid(detail.events ?? [])}
        <p class="itwo-sheet-note">ลงนามอิเล็กทรอนิกส์ผ่านระบบ (ชื่อและวันเวลาตามที่กดในระบบ)</p>
        <p class="itwo-sheet-note">หมายเหตุ: ระยะเวลาทำงาน ${esc(model.DURATION_NOTE)}</p>
        <p class="itwo-sheet-note itwo-sheet-status">สถานะใบสั่งงาน ณ ที่พิมพ์: ${esc(model.statusLabel(detail.status))}</p>
      </article>`;
  }

  function printPage(detail) {
    return page(`<div class="itwo-print-toolbar no-print">
        <a class="btn secondary" href="${esc(orderHrefOf(detail))}">‹ กลับไปรายละเอียด</a>
        <button type="button" class="btn is-primary" id="itwo-print-button">พิมพ์</button>
      </div>
      ${printSheet(detail)}`);
  }
  const orderHrefOf = (detail) => orderHref(detail.id);

  /* ---------- ตั้งค่า (it_admin) ---------- */
  function staffTable({ staff, myEmployeeId, isTest }) {
    if (!staff.length) return emptyBlock("ยังไม่มีรายชื่อทีม IT");
    return table({
      label: "ทีม IT ของใบสั่งงาน",
      columns: [
        { key: "who", label: "พนักงาน", role: "subject" },
        { key: "roles", label: "สิทธิ์" },
        { key: "act", label: "จัดการ" },
      ],
      rows: staff.map((row) => {
        const block = model.staffEditBlock({ row, myEmployeeId, isTest });
        const disabled = block ? ` disabled title="${esc(block)}"` : "";
        const note = block ? `<span class="register-sub">${esc(block)}</span>` : "";
        return {
          cells: {
            who: `<strong class="register-title">${esc(row.full_name)}</strong>${subText([row.employee_no, row.department_name, row.is_active ? "" : "ปิดใช้งานแล้ว"].filter(Boolean).join(" · "))}`,
            roles: esc(model.staffRoleText(row)),
            act: `<span class="register-badges"><button type="button" class="btn secondary small" data-staff-edit="${esc(row.employee_no)}" data-staff-admin="${row.is_it_admin ? "1" : "0"}" data-staff-approver="${row.is_it_approver ? "1" : "0"}"${disabled}>แก้ไข</button><button type="button" class="btn danger small" data-staff-remove="${esc(row.employee_no)}"${disabled}>ถอนสิทธิ์</button></span>${note}`,
          },
        };
      }),
    });
  }

  // candidates = [{ value: รหัสพนักงาน, label }] จาก model.staffCandidateOptions: มีรายชื่อ = กล่องเลือกที่พิมพ์ค้นหาได้ (searchable-select เสริม <select> ให้เอง)
  // โหลดรายชื่อไม่ได้ = ช่องกรอกรหัสพนักงานเองเหมือนเดิม
  function staffForm({ isTest, candidates = [] }) {
    const picker = candidates.length
      ? `<select class="select" id="itwo-staff-no" name="employee_no"${isTest ? " disabled" : ""}><option value="">ค้นหาด้วยรหัสหรือชื่อ</option>${candidates.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join("")}</select>`
      : `<input class="input" id="itwo-staff-no" name="employee_no" maxlength="20" autocomplete="off"${isTest ? " disabled" : ""}>`;
    return `<form id="itwo-staff-form" novalidate>
      <div class="form-grid">
        <div class="field" data-field="employee_no"><label for="itwo-staff-no">พนักงาน</label>${picker}</div>
        <fieldset class="field" data-field="roles"><legend>สิทธิ์</legend>
          <div class="itwo-choices" data-invalid-target>
            <label class="itwo-choice"><input type="checkbox" name="is_it_admin"${isTest ? " disabled" : ""}> <span>ผู้ดูแลงาน IT</span></label>
            <label class="itwo-choice"><input type="checkbox" name="is_it_approver"${isTest ? " disabled" : ""}> <span>ผู้อนุมัติขั้น IT</span></label>
          </div>
        </fieldset>
      </div>
      <div class="form-actions"><button type="submit" class="btn is-primary"${isTest ? " disabled" : ""}>บันทึกสิทธิ์</button></div>
    </form>`;
  }

  // counter = ผลของ app_itwo_get_doc_counter · ตั้งเลขถัดไปได้เฉพาะเดินหน้า
  function docCounterCard(counter) {
    if (!counter) return "";
    return `<section class="card itwo-counter" aria-labelledby="itwo-counter-title"><h2 id="itwo-counter-title">เลขที่เอกสารถัดไป</h2>
      <p class="itwo-counter-no"><span class="request-no">${esc(counter.next_doc_no)}</span></p>
      <form id="itwo-counter-form" novalidate>
        <div class="field" data-field="next_seq"><label for="itwo-next-seq">ตั้งเลขถัดไปเป็น</label><input class="input" id="itwo-next-seq" name="next_seq" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${esc(String(counter.next_seq + 1))}"><small>ตั้งได้เฉพาะเดินหน้า (ใช้ต่อจากทะเบียนกระดาษ เช่น 101) ถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ และมีบันทึกการตั้งเลขที่ลบไม่ได้</small></div>
        <div class="form-actions"><button type="submit" class="btn is-primary">ตั้งเลขถัดไป</button></div>
      </form></section>`;
  }

  function settingsPage({ staff, counter, myEmployeeId, isTest, candidates = [] }) {
    return `<div class="stack">
      <section class="card" aria-labelledby="itwo-staff-title"><h2 id="itwo-staff-title">ทีม IT</h2>
        ${staffTable({ staff, myEmployeeId, isTest })}
      </section>
      <section class="card" aria-labelledby="itwo-staff-form-title"><h2 id="itwo-staff-form-title">เพิ่มหรือแก้สิทธิ์</h2>
        ${isTest ? '<p class="muted small">ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้ (ใช้ได้เฉพาะระบบจริง)</p>' : ""}
        ${staffForm({ isTest, candidates })}
      </section>
      ${docCounterCard(counter)}
    </div>`;
  }

  // ล้างข้อมูลใบสั่งงาน IT ทดสอบ: เฉพาะ admin ตัวจริงที่อยู่ในโหมดทดสอบ (state.sandbox ตั้งโดย app.js)
  const purgeRow = () => `<div class="itwo-purge"><button type="button" class="btn danger small" id="itwo-purge">ล้างข้อมูลใบสั่งงาน IT ทดสอบ</button></div>`;

  const api = { head, newButton, tabs, page, errorCard, mineList, approvalsList, itList, orderForm, orderReview, uploadPanel, detailPage, detailHead, reworkFormCard, reworkRoundsCard, filesAndReworks, legacyAccessSection, historyCard, actionsCard, printSheet, printPage, signatureGrid, settingsPage, staffTable, docCounterCard, purgeRow, testTag };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITWO_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
