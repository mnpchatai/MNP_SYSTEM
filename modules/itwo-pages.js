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
  const subjectOf = (row) => model.clip(row.details, 90) || model.requestTypeLabel(row.request_type);
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

  // แท็บตามสิทธิ์ · counts = { approvals, it } ตัวเลขบนแท็บ (ไม่ระบุ/นับไม่ได้ = ไม่แสดง)
  function tabs(role, active, counts = {}) {
    const items = model.visibleTabs(role).map((tab) => {
      const count = counts[tab.key];
      const badge = Number.isFinite(count) && count > 0 ? ` <span class="itwo-tab-count" aria-label="${count} รายการ">${count > 99 ? "99+" : count}</span>` : "";
      return `<a class="view-tab${tab.key === active ? " active" : ""}"${tab.key === active ? ' aria-current="page"' : ""} href="${esc(model.workOrderUrl(tab.key))}">${esc(tab.label)}${badge}</a>`;
    });
    return items.length > 1 ? `<nav class="view-tabs" aria-label="หมวดใบสั่งงาน IT">${items.join("")}</nav>` : "";
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
          subject: subjectCell(subjectOf(row), orderHref(row.id), model.requestTypeLabel(row.request_type)),
          needed: esc(model.formatDate(row.needed_date)),
          created: esc(model.formatDateTime(row.created_at)),
          status: `<span class="register-badges">${statusBadge(row.status, true)}${urgentTag(row.is_urgent)}</span>`,
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
          subject: subjectCell(subjectOf(row), orderHref(row.id), [row.requester_name, row.department_name].filter(Boolean).join(" · ")),
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
          sort: { needed: row.needed_date ?? "" },
          cells: {
            no: noLink(row.doc_no, orderHref(row.id)),
            subject: subjectCell(subjectOf(row), orderHref(row.id), [row.requester_full_name, row.department_name].filter(Boolean).join(" · ")),
            needed: esc(model.formatDate(row.needed_date)),
            approval: model.itApprovalProgress(row).map((step) => `<span class="itwo-step${step.done ? " is-done" : ""}">${step.done ? "✓" : "○"} ${esc(step.label)}</span>`).join(""),
            status: `<span class="register-badges">${statusBadge(row.status)}${urgentTag(row.is_urgent)}</span>`,
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
          <div class="field" data-field="order_ref"><label for="itwo-order-ref">ออเดอร์ (ไม่บังคับ)</label><input class="input" id="itwo-order-ref" name="order_ref" maxlength="${model.MAX_ORDER_REF}" autocomplete="off"></div>
          ${choiceGroup({ name: "attachment_flag", field: "attachment_flag", legend: "เอกสารแนบ", options: model.ATTACHMENT_FLAGS, value: "no" })}
          <div class="field" data-field="attachment_note" id="itwo-attachment-note-field" hidden><label for="itwo-attachment-note">ระบุเอกสารแนบ ${REQUIRED}</label><input class="input" id="itwo-attachment-note" name="attachment_note" maxlength="${model.MAX_ATTACHMENT_NOTE}" autocomplete="off"></div>
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
  // ขั้นทบทวน: ช่องที่ไม่ได้กรอกไม่ขึ้น (ออเดอร์ หมายเหตุเอกสารแนบ) · values = ค่าในฟอร์ม
  function orderReview(values) {
    const row = (label, value, wide = false) => (value ? `<div class="definition${wide ? " wide" : ""}"><dt>${esc(label)}</dt><dd${wide ? ' class="review-text"' : ""}>${esc(value)}</dd></div>` : "");
    const attachment = values.attachment_flag === "other" && values.attachment_note ? `${model.attachmentFlagLabel("other")} (${values.attachment_note})` : model.attachmentFlagLabel(values.attachment_flag);
    return `<dl class="definition-grid review-grid">
        ${row("ประเภทคำขอ", model.requestTypeLabel(values.request_type))}
        ${row("ออเดอร์", String(values.order_ref ?? "").trim())}
        ${row("เอกสารแนบ", attachment)}
        ${row("วันที่ต้องการงาน", model.formatDate(values.needed_date))}
        ${row("ความเร่งด่วน", values.is_urgent ? "งานด่วน" : "ปกติ")}
        ${row("รายละเอียด", String(values.details ?? "").trim(), true)}
      </dl>
      <p class="muted small">ตรวจแล้วกดส่ง หรือย้อนกลับไปแก้</p>`;
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
          <div class="request-detail-kicker-end">${statusBadge(detail.status)}${urgentTag(detail.is_urgent)}${testTag(detail.is_test || model.isTestDoc(detail.doc_no))}</div>
        </div>
        <h1>${esc(detail.doc_no)}</h1>
        <p class="request-detail-meta">${esc(meta)}</p>
        ${pending.length ? `<p class="request-detail-meta itwo-pending-steps">ยังไม่ได้อนุมัติ: ${esc(pending.join(" · "))}</p>` : ""}
      </header>`;
  }

  // ปุ่มการกระทำตาม allowed_actions (ทุกปุ่มมีกล่องยืนยันที่ module-itwo.js) · ไม่มีปุ่มก็ไม่แสดงการ์ด
  function actionsCard(buttons) {
    if (!buttons.length) return "";
    return `<section class="card detail-actions itwo-actions" aria-labelledby="itwo-actions-title">
      <h2 id="itwo-actions-title">สิ่งที่คุณทำได้กับใบนี้</h2>
      <div class="action-panel-buttons">${buttons.map((button) => {
        const tone = button.tone === "danger" ? " danger" : button.tone === "success" ? " success" : "";
        return `<button type="button" class="btn${tone}" data-itwo-action="${esc(button.action)}">${esc(button.label)}</button>`;
      }).join("")}</div>
      <div class="form-message error" id="itwo-action-error" role="alert" hidden></div>
    </section>`;
  }

  function accessRowsView(changes) {
    if (!changes.length) return '<p class="muted small">IT ยังไม่ได้บันทึกสิทธิ์ในระบบสำหรับใบนี้</p>';
    return `<div class="table-wrap"><table class="itwo-access-table"><thead><tr><th scope="col">ระบบ</th><th scope="col">การดำเนินการ</th><th scope="col">ชื่อผู้ใช้ใหม่</th><th scope="col">ชื่อผู้ใช้เดิม</th><th scope="col">หมายเหตุ</th></tr></thead><tbody>${changes.map((change) => `<tr>
        <td data-label="ระบบ">${esc(model.accessSystemLabel(change.system))}</td>
        <td data-label="การดำเนินการ">${esc(model.accessActionLabel(change.action))}</td>
        <td data-label="ชื่อผู้ใช้ใหม่">${esc(change.new_username ?? "") || "—"}</td>
        <td data-label="ชื่อผู้ใช้เดิม">${esc(change.old_username ?? "") || "—"}</td>
        <td data-label="หมายเหตุ">${esc(change.note ?? "") || "—"}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function accessRowEditor(draft, index, error = "") {
    const select = (name, label, options, value) => `<div class="field"><label for="itwo-ac-${name}-${index}">${label}</label><select class="select" id="itwo-ac-${name}-${index}" data-access-field="${name}"><option value="">เลือก</option>${options.map((option) => `<option value="${esc(option.value)}"${option.value === value ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select></div>`;
    const input = (name, label, value, max) => `<div class="field"><label for="itwo-ac-${name}-${index}">${label}</label><input class="input" id="itwo-ac-${name}-${index}" data-access-field="${name}" maxlength="${max}" value="${esc(value)}" autocomplete="off"></div>`;
    return `<fieldset class="itwo-access-row" data-access-row="${index}">
      <legend>รายการที่ ${index + 1}</legend>
      <div class="form-grid">
        ${select("system", "ระบบ", model.ACCESS_SYSTEMS, draft.system)}
        ${select("action", "การดำเนินการ", model.ACCESS_ACTIONS, draft.action)}
        ${input("newUsername", "ชื่อผู้ใช้ใหม่", draft.newUsername, 100)}
        ${input("oldUsername", "ชื่อผู้ใช้เดิม", draft.oldUsername, 100)}
      </div>
      ${input("note", "หมายเหตุ", draft.note, 500)}
      ${error ? `<p class="field-error" role="alert">${esc(error)}</p>` : ""}
      <button type="button" class="btn secondary small" data-access-remove="${index}">ลบรายการนี้</button>
    </fieldset>`;
  }

  // ส่วน "สำหรับแผนก IT": ทุกคนที่เห็นใบอ่านได้ · แก้ได้เมื่อ allowed_actions มี edit_access (editing = กำลังเปิดฟอร์มแก้)
  function accessSection({ changes, canEdit, drafts = null, validation = { rows: {}, general: null } }) {
    const editing = canEdit && Array.isArray(drafts);
    const body = editing
      ? `<form id="itwo-access-form" novalidate>
          ${drafts.map((draft, index) => accessRowEditor(draft, index, validation.rows[index])).join("")}
          ${validation.general ? `<p class="field-error" role="alert">${esc(validation.general)}</p>` : ""}
          <div class="form-actions"><button type="button" class="btn secondary" data-access-add${drafts.length >= model.MAX_ACCESS_ROWS ? " disabled" : ""}>เพิ่มรายการ</button><button type="button" class="btn secondary" data-access-cancel>ยกเลิกการแก้</button><button type="submit" class="btn is-primary">บันทึกส่วนของ IT</button></div>
        </form>`
      : `${accessRowsView(changes)}${canEdit ? '<div class="form-actions"><button type="button" class="btn secondary" id="itwo-access-edit">แก้ไขสิทธิ์ในระบบ</button></div>' : ""}`;
    return `<section class="card itwo-access" aria-labelledby="itwo-access-title"><h2 id="itwo-access-title">สำหรับแผนก IT : สิทธิ์ในระบบ</h2>${body}</section>`;
  }

  function historyCard(events) {
    const items = events.map((event) => `<div class="timeline-item"><strong>${esc(model.eventLabel(event.action))}</strong><p class="timeline-item-detail">โดย ${esc(event.actor_full_name)}</p>${event.reason ? `<p class="timeline-item-message">${esc(event.reason)}</p>` : ""}<time class="timeline-item-time" datetime="${esc(event.created_at)}">${esc(model.formatDateTime(event.created_at))}</time></div>`).join("");
    return `<section class="card detail-history" aria-labelledby="detail-history-title"><h2 id="detail-history-title">ประวัติเอกสาร</h2><div class="timeline">${items || '<div class="muted small">ยังไม่มีประวัติ</div>'}</div></section>`;
  }

  // ใบทั้งใบ · access = { drafts, validation } ถ้ากำลังแก้ส่วนของ IT · isViewOnly = ไม่ใช่เรื่องของหน้านี้ (ปุ่มซ่อนตาม allowed_actions อยู่แล้ว)
  function detailPage(detail, { access = null, back } = {}) {
    const buttons = model.actionButtons(detail.allowed_actions);
    const canEdit = model.canEditAccess(detail.allowed_actions);
    const attachment = detail.attachment_flag === "other" && detail.attachment_note
      ? `${model.attachmentFlagLabel("other")} (${esc(detail.attachment_note)})`
      : esc(model.attachmentFlagLabel(detail.attachment_flag));
    return page(`${detailHead(detail, back)}
      <div class="detail-grid">
        <div class="stack">
          ${actionsCard(buttons)}
          <section class="card itwo-facts" aria-labelledby="itwo-facts-title"><h2 id="itwo-facts-title">ข้อมูลใบสั่งงาน</h2>
            <dl class="definition-grid">
              ${fact("ประเภทคำขอ", esc(model.requestTypeLabel(detail.request_type)))}
              ${fact("วันที่ต้องการงาน", esc(model.formatDate(detail.needed_date)))}
              ${fact("ออเดอร์", esc(detail.order_ref ?? "") || "—")}
              ${fact("เอกสารแนบ", attachment)}
              ${fact("รายละเอียด", esc(detail.details), true)}
            </dl>
            <p class="muted small itwo-duration">หมายเหตุ: ระยะเวลาทำงาน ${esc(model.DURATION_NOTE)}</p>
          </section>
          ${accessSection({ changes: detail.access_changes ?? [], canEdit, drafts: access?.drafts ?? null, validation: access?.validation })}
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
        <div class="itwo-signature-name">${esc(slot.name ?? "")}</div>
        <div class="itwo-signature-time">${slot.at ? esc(model.formatDateTime(slot.at)) : ""}</div>
      </div>`).join("")}</div>`;
  }

  function printSheet(detail) {
    const isTest = Boolean(detail.is_test) || model.isTestDoc(detail.doc_no);
    const attachmentChoices = model.ATTACHMENT_FLAGS.map((flag) => `<span class="itwo-choice-print">${box(detail.attachment_flag === flag.value)} ${esc(flag.label)}${flag.value === "other" && detail.attachment_flag === "other" && detail.attachment_note ? ` (${esc(detail.attachment_note)})` : ""}</span>`).join("");
    const typeChoices = model.REQUEST_TYPES.map((type) => `<span class="itwo-choice-print">${box(detail.request_type === type.value)} ${esc(type.label)}</span>`).join("");
    const accessRows = model.accessPrintRows(detail.access_changes ?? []).map((row) => `<tr>
        <td>${row.showSystemLabel ? esc(row.systemLabel) : ""}</td>
        ${model.ACCESS_ACTIONS.map((action) => `<td class="itwo-center">${box(row.action === action.value)}</td>`).join("")}
        <td>${esc(row.newUsername)}</td><td>${esc(row.oldUsername)}</td><td>${esc(row.note)}</td></tr>`).join("");
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
          <tr><th scope="row">รายละเอียด</th><td colspan="3" class="itwo-sheet-details">${esc(detail.details)}</td></tr>
          <tr><th scope="row">วันที่ต้องการงาน</th><td>${esc(model.formatDate(detail.needed_date))}</td><th scope="row">งานด่วน</th><td>${box(detail.is_urgent)} ด่วน</td></tr>
        </tbody></table>
        <h2 class="itwo-sheet-section">สำหรับแผนก IT : สิทธิ์ในระบบ</h2>
        <table class="itwo-sheet-table itwo-sheet-access"><thead>
          <tr><th rowspan="2">ระบบ</th><th colspan="${model.ACCESS_ACTIONS.length}">การดำเนินการ</th><th rowspan="2">ชื่อผู้ใช้ใหม่</th><th rowspan="2">ชื่อผู้ใช้เดิม</th><th rowspan="2">หมายเหตุ</th></tr>
          <tr>${model.ACCESS_ACTIONS.map((action) => `<th>${esc(action.label)}</th>`).join("")}</tr>
        </thead><tbody>${accessRows}</tbody></table>
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

  function staffForm({ isTest }) {
    return `<form id="itwo-staff-form" novalidate>
      <div class="form-grid">
        <div class="field" data-field="employee_no"><label for="itwo-staff-no">รหัสพนักงาน</label><input class="input" id="itwo-staff-no" name="employee_no" maxlength="20" autocomplete="off"${isTest ? " disabled" : ""}></div>
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

  function settingsPage({ staff, counter, myEmployeeId, isTest }) {
    return `<div class="stack">
      <section class="card" aria-labelledby="itwo-staff-title"><h2 id="itwo-staff-title">ทีม IT</h2>
        ${staffTable({ staff, myEmployeeId, isTest })}
      </section>
      <section class="card" aria-labelledby="itwo-staff-form-title"><h2 id="itwo-staff-form-title">เพิ่มหรือแก้สิทธิ์</h2>
        ${isTest ? '<p class="muted small">ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้ (ใช้ได้เฉพาะระบบจริง)</p>' : ""}
        ${staffForm({ isTest })}
      </section>
      ${docCounterCard(counter)}
    </div>`;
  }

  // ล้างข้อมูลใบสั่งงาน IT ทดสอบ: เฉพาะ admin ตัวจริงที่อยู่ในโหมดทดสอบ (state.sandbox ตั้งโดย app.js)
  const purgeRow = () => `<div class="itwo-purge"><button type="button" class="btn danger small" id="itwo-purge">ล้างข้อมูลใบสั่งงาน IT ทดสอบ</button></div>`;

  const api = { head, newButton, tabs, page, errorCard, mineList, approvalsList, itList, orderForm, orderReview, detailPage, detailHead, accessSection, accessRowEditor, historyCard, actionsCard, printSheet, printPage, signatureGrid, settingsPage, staffTable, docCounterCard, purgeRow, testTag };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITWO_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
