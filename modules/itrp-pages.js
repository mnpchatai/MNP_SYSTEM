// ใบแจ้งซ่อมคอมพิวเตอร์ (itrp) — HTML ของหน้าต่าง ๆ เป็นสตริงล้วน ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itrp-pages.test.mjs)
// การเชื่อมต่อ (เรียก RPC ผูกปุ่ม กล่องยืนยัน) อยู่ที่ modules/module-itrp.js · ข้อมูลล้วน/กติกาอยู่ที่ modules/itrp-model.js
// คัดโครงจากใบสั่งงาน IT (itwo-pages.js) แล้วปรับฟิลด์: ไม่มีวันที่ต้องการงาน/ออเดอร์/ส่วนสิทธิ์ · มีฟอร์มส่งงาน (บันทึกการซ่อม + ตารางอะไหล่) และใบพิมพ์ตามฟอร์มกระดาษ "ใบแจ้งซ่อมคอมพิวเตอร์"
//
// หน้าตาใช้คอมโพเนนต์เดิมของ Pilot: หัวโมดูล .request-module-header (data-module="it") · แท็บ .view-tabs · ตาราง .register-table
// (ผ่าน registerTableHtml ของ app.js ซึ่งมีเรียงคอลัมน์และการ์ดบนมือถือในตัว) · ไทม์ไลน์ .timeline · .definition-grid · ฟอร์มทีละขั้นของ MNP_FORM_STEPS
// ไฟล์นี้โหลดก่อน app.js: helper ของ app.js (registerTableHtml ฯลฯ) อ้างตอนวาดหน้าเท่านั้น ในเทสต์ Node ถอยไปใช้ตัวสำรองที่เรียบกว่า
(function (root) {
  "use strict";

  const model = root.MNP_ITRP_MODEL;
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const iconOf = (name) => root.MNP_UI_ICONS?.icon(name) ?? "";
  const REQUIRED = '<span class="field-required">(จำเป็น)</span>';
  const PALETTE = "it";
  const TITLE = "ใบแจ้งซ่อม";
  const FORM_TITLE = "ใบแจ้งซ่อมคอมพิวเตอร์";

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
  const testTag = (isTest) => (isTest ? '<span class="badge itrp-test-tag" title="ข้อมูลทดสอบ แยกจากระบบจริง">ทดสอบ</span>' : "");
  const urgentTag = (urgent) => (urgent ? '<span class="badge urgent-flag">ด่วน</span>' : "");
  // row = แถวของรายการ (ใช้ใส่ title ของป้าย "รอผู้แจ้งตอบ": ใครถาม ตอบแล้วใบกลับไปที่ไหน)
  const statusBadge = (status, mine = false, row = null) => {
    const title = row ? model.infoBadgeTitle({ ...row, status }, mine) : "";
    return `<span class="badge ${esc(model.statusBadgeClass(status))}"${title ? ` title="${esc(title)}"` : ""}>${esc(mine ? model.myStatusLabel(status) : model.statusLabel(status))}</span>`;
  };
  // เรื่องของแถวในรายการ: เครื่องที่แจ้ง (รหัส · ชื่อ) เป็นหัวเรื่อง · ใต้เรื่องคือประเภทคำขอ + อาการเสียย่อ (ผู้แจ้ง/แผนกต่อท้ายในหน้าที่คนอื่นเป็นคนดู)
  const subjectOf = (row) => model.clip(model.deviceText(row), 90);
  const subjectNote = (row, ...more) => [model.requestKindText(row.request_kind, row.request_kind_note), model.clip(row.symptom, 80), ...more].filter(Boolean).join(" · ");
  // ป้ายงานแก้ไข "แก้ไขครั้งที่ N · กำหนด วว/ดด/ปปปป" (ไม่เคยขอแก้ไข = ไม่มีป้าย)
  const reworkBadge = (roundNo, dueDate) => {
    const text = model.reworkTag(roundNo, dueDate);
    return text ? `<span class="badge itrp-rework-tag">${esc(text)}</span>` : "";
  };
  const orderHref = (id) => model.repairUrl("order", { id });

  /* ---------- หัวหน้า ---------- */
  // ชื่อโมดูลเป็น h1 ที่นี่ที่เดียว · isTest = ผู้ใช้อยู่ในโหมดทดสอบ (ข้อมูลของหน้านี้เป็นข้อมูลทดสอบทั้งหมด)
  function head({ title = TITLE, back = { href: "#/office?module=it-support", label: "‹ IT SUPPORT" }, actions = "", isTest = false } = {}) {
    return `${back ? `<a class="request-back-link" href="${esc(back.href)}">${esc(back.label)}</a>` : ""}
      <div class="page-heading request-module-header itrp-head" data-module="${PALETTE}">
        <div class="request-module-title"><span class="type-card-badge">${iconOf("monitor")}</span><h1>${esc(title)}</h1>${testTag(isTest)}</div>
        ${actions ? `<div class="request-create-entry">${actions}</div>` : ""}
      </div>`;
  }
  const newButton = () => `<a class="btn" id="itrp-new" href="${esc(model.repairUrl("new"))}"><span class="plus-icon" aria-hidden="true"></span> แจ้งซ่อมใหม่</a>`;

  // แท็บตามสิทธิ์ · counts = { mine, approvals, it } ตัวเลขบนแท็บ (ไม่ระบุ/นับไม่ได้ = ไม่แสดง)
  // mine = ใบที่ IT ส่งงานแล้วรอผู้แจ้ง (คุณ) ยืนยัน/ขอแก้ไข + ใบที่มีคนถามมารอคุณตอบ · counts.mineParts = { confirm, answer } บอกว่ารออะไร (ไม่ส่ง = รอยืนยัน)
  const COUNT_NOTES = Object.freeze({ mine: " ที่รอคุณยืนยัน", approvals: " ที่รออนุมัติ", it: " ที่ต้องดำเนินการ" });
  function tabs(role, active, counts = {}) {
    const items = model.visibleTabs(role).map((tab) => {
      const count = counts[tab.key];
      const note = tab.key === "mine" && counts.mineParts ? model.mineWaitingNote(counts.mineParts) : COUNT_NOTES[tab.key] ?? "";
      const badge = Number.isFinite(count) && count > 0 ? ` <span class="itrp-tab-count" aria-label="${count} รายการ${esc(note)}" title="${count} รายการ${esc(note)}">${count > 99 ? "99+" : count}</span>` : "";
      return `<a class="view-tab${tab.key === active ? " active" : ""}"${tab.key === active ? ' aria-current="page"' : ""} href="${esc(model.repairUrl(tab.key))}">${esc(tab.label)}${badge}</a>`;
    });
    // ผู้ใช้ที่มีแท็บเดียว (พนักงานทั่วไป) ไม่มีแถบแท็บ ยกเว้นมีใบรอคุณยืนยัน/รอคุณตอบ: ต้องเห็นตัวเลขว่างานกลับมาหาตัวเอง
    return items.length > 1 || counts.mine > 0 ? `<nav class="view-tabs" aria-label="หมวดใบแจ้งซ่อม">${items.join("")}</nav>` : "";
  }

  // ครอบทั้งหน้าด้วยจานสีของโมดูล + ข้อความข้อผิดพลาดของหน้า (ข้อความเดียว อยู่เหนือเนื้อหา)
  // เลขเวอร์ชันของโมดูลท้ายหน้า ชิดขวา (ไม่พิมพ์ลงใบ A4) · วันที่ปล่อยอยู่ใน title ไม่เป็นข้อความถาวร
  const versionTag = () => `<p class="itrp-version no-print" title="${FORM_TITLE} เวอร์ชัน ${esc(model.MODULE_VERSION)} · อัปเดต ${esc(model.formatDate(model.VERSION_DATE))}">V${esc(model.MODULE_VERSION)}</p>`;
  const page = (inner) => `<div class="itrp-page" data-module="${PALETTE}">${inner}${versionTag()}</div>`;
  const errorCard = (message, { retry = true } = {}) => `<section class="card"><div class="form-message error" role="alert">${esc(message)}</div>${retry ? '<button class="btn secondary" type="button" id="itrp-retry">ลองอีกครั้ง</button>' : ""}</section>`;

  /* ---------- รายการ: ใบของฉัน / รออนุมัติ / งาน IT ---------- */
  function mineList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ยังไม่มีใบแจ้งซ่อมที่คุณแจ้ง", "กด \"แจ้งซ่อมใหม่\" เพื่อสร้างใบแจ้งซ่อมคอมพิวเตอร์")}</section>`;
    return table({
      label: "ใบแจ้งซ่อมของฉัน",
      columns: [
        { key: "no", label: "เลขที่", role: "no" },
        { key: "subject", label: "เครื่อง", role: "subject" },
        { key: "created", label: "แจ้งเมื่อ", sorted: "descending" },
        { key: "status", label: "สถานะ", role: "status" },
      ],
      rows: rows.map((row) => ({
        className: `status-${row.status}`,
        sort: { created: row.created_at ?? "" },
        cells: {
          no: noLink(row.doc_no, orderHref(row.id)),
          subject: subjectCell(subjectOf(row), orderHref(row.id), subjectNote(row)),
          created: esc(model.formatDateTime(row.created_at)),
          status: `<span class="register-badges">${statusBadge(row.status, true, row)}${urgentTag(row.is_urgent)}${reworkBadge(row.rework_round, row.rework_due_date)}</span>`,
        },
      })),
    });
  }

  // รออนุมัติ: ใบที่ "รอคุณ" เป็นตารางหลัก · ใบที่ถามผู้แจ้งไปแล้วและรอผู้แจ้งตอบ (need_info) แยกเป็นกลุ่มของตัวเอง (ไม่ใช่งานที่ต้องกดอนุมัติ ไม่นับบนแท็บ)
  function approvalsList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ไม่มีใบแจ้งซ่อมที่รออนุมัติจากคุณ")}</section>`;
    const waiting = rows.filter((row) => row.status !== "need_info");
    const asked = rows.filter((row) => row.status === "need_info");
    const build = (label, statusHeading, items) => table({
      label,
      columns: [
        { key: "no", label: "เลขที่", role: "no" },
        { key: "subject", label: "เครื่อง", role: "subject" },
        { key: "created", label: "แจ้งเมื่อ", sorted: "descending" },
        { key: "status", label: statusHeading, role: "status" },
      ],
      rows: items.map((row) => ({
        className: `status-${row.status}`,
        sort: { created: row.created_at ?? "" },
        cells: {
          no: noLink(row.doc_no, orderHref(row.id)),
          subject: subjectCell(subjectOf(row), orderHref(row.id), subjectNote(row, row.requester_name, row.department_name)),
          created: esc(model.formatDateTime(row.created_at)),
          status: `<span class="register-badges">${row.status === "need_info" ? statusBadge(row.status, false, row) : `<span class="badge pending_approval">${esc(model.pendingStepLabel(row.pending_step))}</span>`}${urgentTag(row.is_urgent)}</span>`,
        },
      })),
    });
    const waitingTable = waiting.length ? build("ใบแจ้งซ่อมที่รอคุณอนุมัติ", "รอคุณ", waiting) : "";
    if (!asked.length) return waitingTable;
    const askedLabel = model.statusLabel("need_info");
    return `<div class="stack">
      ${waitingTable || `<section class="card">${emptyBlock("ไม่มีใบแจ้งซ่อมที่รออนุมัติจากคุณ")}</section>`}
      <section class="card detail-section itrp-group" data-group="awaiting_info" aria-labelledby="itrp-g-awaiting-info"><h2 id="itrp-g-awaiting-info">${esc(askedLabel)} <span class="detail-section-count">${asked.length}</span></h2>${build(askedLabel, "สถานะ", asked)}</section>
    </div>`;
  }

  // งาน IT แยกตามสถานะ งานด่วนอยู่บนสุดของแต่ละกลุ่ม · กลุ่ม "จบแล้ว" พับไว้ (ไม่ใช่งานที่ต้องลงมือ)
  function itList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ยังไม่มีใบแจ้งซ่อม")}</section>`;
    const groups = model.groupItOrders(rows);
    const sections = model.IT_GROUPS.filter((group) => groups[group.key].length).map((group) => {
      const items = groups[group.key];
      const closed = group.key === "closed";
      const content = table({
        label: group.label,
        columns: [
          { key: "no", label: "เลขที่", role: "no" },
          { key: "subject", label: "เครื่อง", role: "subject" },
          { key: "approval", label: "อนุมัติ" },
          { key: "status", label: "สถานะ", role: "status" },
        ],
        rows: items.map((row) => ({
          className: `status-${row.status}`,
          cells: {
            no: noLink(row.doc_no, orderHref(row.id)),
            subject: subjectCell(subjectOf(row), orderHref(row.id), subjectNote(row, row.requester_full_name, row.department_name)),
            approval: model.itApprovalProgress(row).map((step) => `<span class="itrp-step${step.done ? " is-done" : ""}">${step.done ? "✓" : "○"} ${esc(step.label)}</span>`).join(""),
            status: `<span class="register-badges">${statusBadge(row.status, false, row)}${urgentTag(row.is_urgent)}${reworkBadge(row.rework_round, row.rework_due_date)}</span>`,
          },
        })),
      });
      const title = `${esc(group.label)} <span class="detail-section-count">${items.length}</span>`;
      return closed
        ? `<details class="card detail-section itrp-group" data-group="${group.key}"><summary><h2>${title}</h2></summary>${content}</details>`
        : `<section class="card detail-section itrp-group" data-group="${group.key}" aria-labelledby="itrp-g-${group.key}"><h2 id="itrp-g-${group.key}">${title}</h2>${content}</section>`;
    });
    return `<div class="stack">${sections.join("")}</div>`;
  }

  /* ---------- ฟอร์มแจ้งซ่อมใหม่ (MNP_FORM_STEPS: 2 ขั้น + ทบทวน) ---------- */
  function choiceGroup({ name, legend, options, value, required = false, field }) {
    return `<fieldset class="field" data-field="${field ?? name}">
      <legend>${esc(legend)} ${required ? REQUIRED : ""}</legend>
      <div class="itrp-choices" data-invalid-target role="radiogroup" aria-label="${esc(legend)}">${options.map((option) => `<label class="itrp-choice"><input type="radio" name="${name}" value="${esc(option.value)}"${option.value === value ? " checked" : ""}> <span>${esc(option.label)}</span></label>`).join("")}</div>
    </fieldset>`;
  }

  // ช่องเลือกไฟล์: ปุ่มเดียวกับฟอร์มอื่นของ Pilot · modules/attachment-image.js ดักช่องไฟล์ทุกช่องทั้งหน้า (แปลงรูป HEIC/รูปใหญ่เป็น JPG ตรวจจำนวนและขนาด)
  // ช่องนี้ใส่ data-attachment-limit="per-file" = เพดานไฟล์ละ 20 MB (ไม่รวมกัน) ตรงกับ bucket/RPC ของใบแจ้งซ่อม ส่วนโมดูลอื่นยังใช้เพดานรวม 20 MB เหมือนเดิม
  // และ attachment-preview.js วาดรายการไฟล์ที่เลือกใต้ช่อง (มีปุ่ม × ลบออกจากรายการได้) จึงไม่ต้องเขียนรายการเองที่นี่
  const fileField = ({ id, field, label = "ไฟล์แนบ", hidden = false }) => `<div class="field itrp-file-field" data-field="${esc(field)}" id="${esc(id)}-field"${hidden ? " hidden" : ""}>
        <span class="field-label">${esc(label)}</span>
        <label class="btn secondary file-pick" for="${esc(id)}" title="${esc(model.FILE_HINT)}">${iconOf("camera")} ถ่ายรูป / เลือกไฟล์</label>
        <input class="file-pick-input" id="${esc(id)}" name="${esc(id)}" type="file" multiple data-attachment-limit="per-file" accept="${esc(model.FILE_ACCEPT)}">
        <small>${esc(model.FILE_HINT)}</small>
      </div>`;

  // requester = { name, department } จาก my_role · ระบบเติมชื่อ/แผนก/วันเวลาให้เอง จึงบอกไว้ครั้งเดียวที่ขั้นแรก
  function orderForm({ requester = null } = {}) {
    const steps = root.MNP_FORM_STEPS;
    const who = requester ? `${esc(requester.name)}${requester.department ? ` · ${esc(requester.department)}` : ""}` : "";
    return `<section class="card form-card" id="itrp-form-card"><div id="itrp-message" role="status"></div>
      <div class="draft-banner" id="itrp-draft" role="region" aria-label="ร่างที่ค้างอยู่" hidden></div>
      <form id="itrp-form" class="stepped-form" novalidate>
        ${steps?.headHtml?.() ?? ""}
        <fieldset class="form-step" data-step="1">
          <legend class="form-step-title">เครื่องที่แจ้งซ่อม</legend>
          ${who ? `<p class="muted small itrp-requester">ผู้แจ้ง ${who} · ระบบบันทึกวันและเวลาที่แจ้งให้เอง</p>` : ""}
          <div class="field" data-field="asset_code"><label for="itrp-asset-code">รหัสเครื่องคอมพิวเตอร์ (ไม่บังคับ)</label><input class="input" id="itrp-asset-code" name="asset_code" maxlength="${model.MAX_ASSET_CODE}" autocomplete="off"></div>
          <div class="field" data-field="device_name"><label for="itrp-device-name">ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์ ${REQUIRED}</label><input class="input" id="itrp-device-name" name="device_name" maxlength="${model.MAX_DEVICE_NAME}" autocomplete="off"></div>
          ${choiceGroup({ name: "request_kind", field: "request_kind", legend: "ประเภทคำขอ", options: model.REQUEST_KINDS, value: "", required: true })}
          <div class="field" data-field="request_kind_note" id="itrp-kind-note-field" hidden><label for="itrp-kind-note">ระบุประเภทคำขอ ${REQUIRED}</label><input class="input" id="itrp-kind-note" name="request_kind_note" maxlength="${model.MAX_NOTE}" autocomplete="off"></div>
          ${choiceGroup({ name: "repair_target", field: "repair_target", legend: "ประเภทงานซ่อม", options: model.REPAIR_TARGETS, value: "", required: true })}
          <div class="field" data-field="repair_target_note" id="itrp-target-note-field" hidden><label for="itrp-target-note">ระบุประเภทงานซ่อม ${REQUIRED}</label><input class="input" id="itrp-target-note" name="repair_target_note" maxlength="${model.MAX_NOTE}" autocomplete="off"></div>
        </fieldset>
        <fieldset class="form-step" data-step="2">
          <legend class="form-step-title">อาการเสีย</legend>
          <div class="field" data-field="symptom"><label for="itrp-symptom">ระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น ${REQUIRED}</label><textarea class="textarea" id="itrp-symptom" name="symptom" rows="5" maxlength="${model.MAX_SYMPTOM}"></textarea><small>บอกให้ชัดว่าเกิดอะไรขึ้น เพื่อให้ IT ไม่ต้องถามซ้ำ (ไม่เกิน ${model.MAX_SYMPTOM.toLocaleString("en-US")} ตัวอักษร)</small></div>
          ${fileField({ id: "itrp-files", field: "attachment_files", label: "แนบรูปหรือไฟล์ (ถ้ามี)" })}
          <div class="field"><label class="itrp-choice itrp-urgent"><input type="checkbox" id="itrp-urgent" name="is_urgent"> <span>งานด่วน</span></label><small>IT เริ่มทำได้ก่อนอนุมัติครบ แต่ผู้จัดการยังต้องอนุมัติตามหลัง และใบจะส่งงานได้เมื่ออนุมัติครบแล้วเท่านั้น</small></div>
        </fieldset>
        <fieldset class="form-step form-step-review" data-step="3">
          <legend class="form-step-title">ทบทวนก่อนส่ง</legend>
          <div id="itrp-review"></div>
        </fieldset>
        ${steps?.actionsHtml?.({ cancelHref: model.repairUrl("mine"), submitLabel: "ส่งใบแจ้งซ่อม" }) ?? ""}
      </form></section>`;
  }
  // รายการไฟล์ที่เลือก "ชื่อ (ขนาด)" คั่นด้วยจุลภาค · files = [{ name, size }]
  const fileListText = (files) => files.map((file) => `${file.name} (${model.formatFileSize(file.size)})`).join(", ");
  // ขั้นทบทวน: ช่องที่ไม่ได้กรอกไม่ขึ้น (รหัสเครื่อง ไฟล์) · values = ค่าในฟอร์ม · files = ไฟล์ที่เลือก
  function orderReview(values, files = []) {
    const row = (label, value, wide = false) => (value ? `<div class="definition${wide ? " wide" : ""}"><dt>${esc(label)}</dt><dd${wide ? ' class="review-text"' : ""}>${esc(value)}</dd></div>` : "");
    const attached = files.length ? `${files.length} ไฟล์: ${fileListText(files)}` : "";
    return `<dl class="definition-grid review-grid">
        ${row("รหัสเครื่องคอมพิวเตอร์", String(values.asset_code ?? "").trim())}
        ${row("ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์", String(values.device_name ?? "").trim())}
        ${row("ประเภทคำขอ", model.requestKindText(values.request_kind, values.request_kind_note))}
        ${row("ประเภทงานซ่อม", model.repairTargetText(values.repair_target, values.repair_target_note))}
        ${row("ไฟล์แนบ", attached, true)}
        ${row("ความเร่งด่วน", values.is_urgent ? "งานด่วน" : "ปกติ")}
        ${row("อาการเสีย", String(values.symptom ?? "").trim(), true)}
      </dl>
      <p class="muted small">ตรวจแล้วกดส่ง หรือย้อนกลับไปแก้</p>`;
  }

  /* ---------- ความคืบหน้าอัปโหลดไฟล์ (หลังสร้างใบ / ส่งคำขอแก้ไข / ถาม-ตอบ) ---------- */
  // rows = [{ name, size, state: "done" | "working" | "waiting" | "failed", message }] · busy = กำลังอัปโหลดอยู่
  // ใบ/รอบแก้ไขถูกบันทึกไปแล้ว ไฟล์เป็นส่วนเสริม: ล้มไฟล์ไหนลองซ้ำได้ (ภายใน 30 นาทีหลังแจ้ง) ไม่ทำให้ใบหาย
  const UPLOAD_STATE_TEXT = Object.freeze({ done: "แนบแล้ว", working: "กำลังแนบ…", waiting: "รอคิว", failed: "แนบไม่สำเร็จ" });
  function uploadPanel({ heading, intro = "", rows, busy = false, continueLabel = "ไปที่ใบแจ้งซ่อม" }) {
    const done = rows.filter((row) => row.state === "done").length;
    const failed = rows.filter((row) => row.state === "failed").length;
    const summary = busy
      ? `กำลังแนบไฟล์ ${Math.min(done + 1, rows.length)} จาก ${rows.length}`
      : failed ? `แนบไม่สำเร็จ ${failed} จาก ${rows.length} ไฟล์ (แนบแล้ว ${done})` : `แนบครบ ${done} ไฟล์`;
    const items = rows.map((row) => `<li class="itrp-upload-row is-${esc(row.state)}"><span class="itrp-upload-name" title="${esc(row.name)}">${esc(row.name)} <span class="muted small">${esc(model.formatFileSize(row.size))}</span></span><span class="itrp-upload-state">${esc(UPLOAD_STATE_TEXT[row.state] ?? "")}</span>${row.message ? `<span class="itrp-upload-message">${esc(row.message)}</span>` : ""}</li>`).join("");
    return `<section class="itrp-upload" aria-labelledby="itrp-upload-title"${busy ? ' aria-busy="true"' : ""}>
        <h2 id="itrp-upload-title">${esc(heading)}</h2>
        ${intro ? `<p class="muted small">${esc(intro)}</p>` : ""}
        <p class="itrp-upload-summary" role="status">${esc(summary)}</p>
        <ul class="itrp-upload-list">${items}</ul>
        ${busy ? "" : `<div class="form-actions">${failed ? '<button type="button" class="btn is-primary" id="itrp-upload-retry">ลองแนบไฟล์ที่ไม่สำเร็จอีกครั้ง</button>' : ""}<button type="button" class="btn secondary" id="itrp-upload-continue">${esc(continueLabel)}</button></div>`}
      </section>`;
  }

  /* ---------- หน้ารายละเอียด ---------- */
  const fact = (label, value, wide = false) => `<div class="definition${wide ? " wide" : ""}"><dt>${esc(label)}</dt><dd${wide ? ' class="itrp-text"' : ""}>${value}</dd></div>`;

  function detailHead(detail, back = { href: model.repairUrl("mine"), label: "‹ ใบแจ้งซ่อม" }) {
    const summary = model.approvalSummary(detail);
    const waiting = !["cancelled", "rejected", "received"].includes(detail.status);
    // ขั้นอนุมัติบอกเฉพาะที่ยังไม่เสร็จ (ผู้อนุมัติ/เวลาของขั้นที่เสร็จแล้วอยู่ในประวัติเอกสารแล้ว)
    const pending = waiting ? summary.filter((step) => step.state === "waiting").map((step) => step.label) : [];
    const meta = [`โดย ${detail.requester?.full_name ?? "—"}`, detail.department?.name_th, `แจ้งเมื่อ ${model.formatDateTime(detail.created_at)}`].filter(Boolean).join(" · ");
    return `<a class="request-back-link" href="${esc(back.href)}">${esc(back.label)}</a>
      <header class="request-detail-head request-module-header itrp-detail-head" data-module="${PALETTE}">
        <div class="request-detail-kicker">
          <span class="eyebrow"><span class="nowrap">${esc(FORM_TITLE)}</span></span>
          <div class="request-detail-kicker-end">${statusBadge(detail.status)}${urgentTag(detail.is_urgent)}${reworkBadge(detail.rework_round, detail.latest_due_date)}${testTag(detail.is_test || model.isTestDoc(detail.doc_no))}</div>
        </div>
        <h1>${esc(detail.doc_no)}</h1>
        <p class="request-detail-meta">${esc(meta)}</p>
        ${pending.length ? `<p class="request-detail-meta itrp-pending-steps">ยังไม่ได้อนุมัติ: ${esc(pending.join(" · "))}</p>` : ""}
      </header>`;
  }

  // ปุ่มการกระทำตาม allowed_actions (ทุกปุ่มมีกล่องยืนยันที่ module-itrp.js · "แก้ไขงาน" "ถามผู้แจ้ง" "ส่งงาน" เปิดฟอร์มของตัวเองแทนกล่องยืนยัน) · ไม่มีปุ่มก็ไม่แสดงการ์ด
  // inline = ปุ่มที่ฟอร์มของมันวาดเปิดไว้ในหน้าอยู่แล้ว (ตอบคำถาม) ไม่ซ้ำเป็นปุ่ม
  function actionsCard(allButtons) {
    const buttons = allButtons.filter((button) => !button.inline);
    if (!buttons.length) return "";
    return `<section class="card detail-actions itrp-actions" aria-labelledby="itrp-actions-title">
      <h2 id="itrp-actions-title">สิ่งที่คุณทำได้กับใบนี้</h2>
      <div class="action-panel-buttons">${buttons.map((button) => {
        const tone = button.tone === "danger" ? " danger" : button.tone === "success" ? " success" : button.tone === "secondary" ? " secondary" : "";
        return `<button type="button" class="btn${tone}" data-itrp-action="${esc(button.action)}">${esc(button.label)}</button>`;
      }).join("")}</div>
      <div class="form-message error" id="itrp-action-error" role="alert" hidden></div>
    </section>`;
  }

  /* ---------- ไฟล์แนบ (แยกตามรอบ) ---------- */
  // ชนิดไฟล์สำหรับป้ายบนกระเบื้อง (เกณฑ์เดียวกับ attachmentKind ใน app.js แต่อ่านจาก mime_type ของ itrp_attachments)
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
  // กระเบื้องแบบเดียวกับ attachmentGalleryHtml ของ app.js (สไตล์ + การเติมตัวอย่าง/ลิงก์ดาวน์โหลด/กล่องดูไฟล์ใช้ของเดิม) ต่างที่ไฟล์ของใบแจ้งซ่อมไม่มีภาพย่อ
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
    return `<section class="card itrp-reworks" aria-labelledby="itrp-reworks-title"><h2 id="itrp-reworks-title">ประวัติการแก้ไขงาน <span class="detail-section-count">${rounds.length}</span></h2>
      ${rounds.map((round) => `<article class="itrp-rework-round" data-round="${round.roundNo}">
        <h3>${esc(round.label)} <span class="muted small">· กำหนดเสร็จ ${esc(model.formatDate(round.dueDate))}</span></h3>
        <p class="itrp-text">${esc(round.details)}</p>
        <p class="muted small">ขอโดย ${esc(round.requestedBy)} · ${esc(model.formatDateTime(round.createdAt))}</p>
        ${round.files.length ? fileGrid(round.files) : ""}
      </article>`).join("")}
    </section>`;
  }

  // บล็อกไฟล์ + รอบแก้ไข · ไม่มีไฟล์และไม่มีรอบแก้ไข = ไม่วาดอะไร
  // #attachment-gallery (app.js: hydrateAttachmentGallery / กล่องดูไฟล์ หา id นี้) อยู่ที่คอลัมน์หลักของ detailPage ตัวเดียว ครอบทั้งไฟล์ตอนแจ้ง รอบแก้ไข และไฟล์ของข้อความถาม-ตอบ
  function filesAndReworks(detail) {
    const initial = (detail.attachments ?? []).filter((file) => !file.rework_id);
    const rounds = model.reworkRounds(detail);
    if (!initial.length && !rounds.length) return "";
    return `<div class="stack">
      ${initial.length ? `<section class="card itrp-files" aria-labelledby="itrp-files-title"><h2 id="itrp-files-title">ไฟล์แนบ <span class="detail-section-count">${initial.length}</span></h2>${fileGrid(initial)}</section>` : ""}
      ${rounds.length ? reworkRoundsCard(rounds) : ""}
    </div>`;
  }

  /* ---------- บันทึกการซ่อม (ส่วน "สำหรับแผนก IT") ---------- */
  // ตารางอะไหล่แบบอ่านอย่างเดียว · parts = reportView(...).parts
  function partsTable(parts) {
    if (!parts.length) return "";
    return `<div class="table-wrap"><table class="itrp-parts-table"><thead><tr><th scope="col">ลำดับ</th><th scope="col">รายการอะไหล่ / วัสดุที่ใช้</th><th scope="col">จำนวน</th><th scope="col">ราคาต่อหน่วย</th><th scope="col">หมายเหตุ</th></tr></thead><tbody>${parts.map((part) => `<tr>
        <td data-label="ลำดับ">${esc(part.no)}</td>
        <td data-label="รายการ">${esc(part.item)}</td>
        <td data-label="จำนวน">${esc(part.quantity) || "—"}</td>
        <td data-label="ราคาต่อหน่วย">${esc(part.price) || "—"}</td>
        <td data-label="หมายเหตุ">${esc(part.note) || "—"}</td></tr>`).join("")}</tbody></table></div>`;
  }
  // เนื้อหาของบันทึกการซ่อมหนึ่งชุด (ใช้ทั้งชุดล่าสุดและประวัติชุดก่อน) · duration = ผลของ model.repairDuration (เฉพาะชุดล่าสุด) หรือ null
  const reportBody = (view, duration = null) => `<dl class="definition-grid">
      ${fact("สาเหตุ", esc(view.cause), true)}
      ${fact("สรุปสาเหตุเกิดจาก", esc(view.causeKind))}
      ${fact("การตรวจซ่อม", esc(view.repairMethod))}
      ${fact("การซ่อม-แก้ไขที่เกิดขึ้น", esc(view.repairAction), true)}
      ${view.prPoNo ? fact("เอกสารอ้างอิง ใบ PR./PO.No.", esc(view.prPoNo)) : ""}
      ${duration ? fact("รวมเวลาในการซ่อม", esc(duration.text)) : ""}
    </dl>${partsTable(view.parts)}`;
  // การ์ดบันทึกการซ่อมล่าสุด + ประวัติชุดก่อน (พับไว้) · ยังไม่เคยส่งงาน = ไม่วาดอะไร
  function reportCards(detail) {
    const { latest, earlier } = model.repairReports(detail);
    if (!latest && !earlier.length) return "";
    const latestView = model.reportView(latest);
    const duration = model.repairDuration(detail.started?.at, detail.completed?.at);
    const history = earlier.length
      ? `<details class="card itrp-report-history"><summary><h2>บันทึกการซ่อมครั้งก่อน <span class="detail-section-count">${earlier.length}</span></h2></summary>
        ${earlier.map((report) => {
          const view = model.reportView(report);
          return `<article class="itrp-report-earlier" data-report="${esc(view.id)}"><h3>ส่งงานเมื่อ ${esc(model.formatDateTime(view.completedAt))} <span class="muted small">· โดย ${esc(view.completedBy)}</span></h3>${reportBody(view)}</article>`;
        }).join("")}</details>`
      : "";
    return `<div class="stack">
      ${latestView ? `<section class="card itrp-report" aria-labelledby="itrp-report-title"><h2 id="itrp-report-title">บันทึกการซ่อม (สำหรับแผนก IT)</h2>${reportBody(latestView, duration)}</section>` : ""}
      ${history}
    </div>`;
  }

  // ป้ายช่องชื่อผู้ซ่อม/สถานที่ส่งซ่อม (spec = model.vendorField) · เปลี่ยนตามการตรวจซ่อมที่เลือก
  const vendorLabel = (spec) => `${esc(spec.label)}${spec.required ? ` ${REQUIRED}` : ""}`;

  // แถวอะไหล่ในฟอร์มส่งงาน · index เริ่ม 0 (ลำดับที่แสดง = index + 1) · row = { item_name, quantity, price, note } ค่าที่กรอก
  function partRow(index, row = {}) {
    const no = index + 1;
    return `<tr class="itrp-part-row" data-part-row>
        <td class="itrp-part-no" data-label="ลำดับ">${no}</td>
        <td data-label="รายการ"><input class="input" name="part_item" maxlength="${model.MAX_NOTE}" autocomplete="off" aria-label="รายการอะไหล่ แถวที่ ${no}" value="${esc(row.item_name)}"></td>
        <td data-label="จำนวน"><input class="input" name="part_quantity" inputmode="decimal" maxlength="12" autocomplete="off" aria-label="จำนวน แถวที่ ${no}" value="${esc(row.quantity)}"></td>
        <td data-label="ราคาต่อหน่วย (บาท)"><input class="input" name="part_price" inputmode="decimal" maxlength="12" autocomplete="off" aria-label="ราคาต่อหน่วย (บาท) แถวที่ ${no}" value="${esc(row.price)}"></td>
        <td data-label="หมายเหตุ"><input class="input" name="part_note" maxlength="${model.MAX_NOTE}" autocomplete="off" aria-label="หมายเหตุ แถวที่ ${no}" value="${esc(row.note)}"></td>
        <td class="itrp-part-act"><button type="button" class="btn secondary small" data-part-remove aria-label="ลบแถวที่ ${no}">ลบ</button></td>
      </tr>`;
  }
  const partsEditor = () => `<div class="field itrp-parts" data-field="parts">
      <span class="field-label">รายการอะไหล่ / วัสดุที่ใช้ (ถ้ามี)</span>
      <div class="table-wrap"><table class="itrp-parts-edit"><thead><tr><th scope="col">ลำดับ</th><th scope="col">รายการ</th><th scope="col">จำนวน</th><th scope="col">ราคาต่อหน่วย (บาท)</th><th scope="col">หมายเหตุ</th><th scope="col"><span class="sr-only">ลบ</span></th></tr></thead>
        <tbody id="itrp-parts-body">${partRow(0)}</tbody></table></div>
      <div class="itrp-parts-tools"><button type="button" class="btn secondary small" id="itrp-part-add">เพิ่มแถว</button><small>ไม่เกิน ${model.MAX_PARTS} แถว · แถวที่ว่างทั้งแถวไม่ถูกบันทึก</small></div>
    </div>`;

  // ฟอร์มส่งงาน (ผู้ดูแลงาน IT) ซ่อนไว้จนกดปุ่ม "ส่งงาน" · ส่วน "สำหรับแผนก IT": สาเหตุ สรุปสาเหตุ การตรวจซ่อม การซ่อม-แก้ไข PR./PO. อะไหล่
  // ชื่อผู้ซ่อม/สถานที่ส่งซ่อมใช้ช่องเดียว: ซ่อมภายในซ่อนช่อง · เรียกผู้ซ่อมภายนอกไม่บังคับ · ส่งซ่อมที่บังคับ (ป้ายช่องเปลี่ยนที่ module-itrp.js)
  function completeFormCard() {
    return `<section class="card itrp-complete-card" id="itrp-complete-card" aria-labelledby="itrp-complete-title" hidden>
      <h2 id="itrp-complete-title">ส่งงาน · บันทึกการซ่อม (สำหรับแผนก IT)</h2>
      <p class="muted small">กรอกผลการซ่อมก่อนส่งใบกลับให้ผู้แจ้งตรวจ · ระบบบันทึกคุณเป็นช่างผู้ดำเนินการซ่อมพร้อมวันและเวลา</p>
      <div id="itrp-complete-message" role="status"></div>
      <form id="itrp-complete-form" novalidate>
        <div class="field" data-field="cause"><label for="itrp-cause">สาเหตุ ${REQUIRED}</label><textarea class="textarea" id="itrp-cause" name="cause" rows="3" maxlength="${model.MAX_LONG_TEXT}"></textarea></div>
        ${choiceGroup({ name: "cause_kind", field: "cause_kind", legend: "สรุปสาเหตุเกิดจาก", options: model.CAUSE_KINDS, value: "", required: true })}
        <div class="field" data-field="cause_kind_note" id="itrp-cause-note-field" hidden><label for="itrp-cause-note">ระบุสรุปสาเหตุ ${REQUIRED}</label><input class="input" id="itrp-cause-note" name="cause_kind_note" maxlength="${model.MAX_NOTE}" autocomplete="off"></div>
        ${choiceGroup({ name: "repair_method", field: "repair_method", legend: "การตรวจซ่อม", options: model.REPAIR_METHODS, value: "", required: true })}
        <div class="field" data-field="repair_vendor" id="itrp-vendor-field" hidden><label for="itrp-vendor" id="itrp-vendor-label">ชื่อผู้ซ่อม</label><input class="input" id="itrp-vendor" name="repair_vendor" maxlength="${model.MAX_NOTE}" autocomplete="off"></div>
        <div class="field" data-field="repair_action"><label for="itrp-repair-action">การซ่อม-แก้ไขที่เกิดขึ้น ${REQUIRED}</label><textarea class="textarea" id="itrp-repair-action" name="repair_action" rows="3" maxlength="${model.MAX_LONG_TEXT}"></textarea></div>
        <div class="field" data-field="pr_po_no"><label for="itrp-pr-po">เอกสารสำคัญอ้างอิง ใบ PR./PO.No. (ไม่บังคับ)</label><input class="input" id="itrp-pr-po" name="pr_po_no" maxlength="${model.MAX_PR_PO}" autocomplete="off"></div>
        ${partsEditor()}
        <div class="form-actions"><button type="button" class="btn secondary" id="itrp-complete-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ส่งงาน</button></div>
      </form>
    </section>`;
  }

  /* ---------- ฟอร์มแก้ไขงาน / ถาม / ตอบ ---------- */
  // ฟอร์มขอแก้ไขงาน (ผู้แจ้ง ตอน IT ส่งงานแล้ว) ซ่อนไว้จนกดปุ่ม "แก้ไขงาน" · กรอก 3 อย่าง: รายละเอียด วันที่กำหนดเสร็จ ไฟล์ (ไม่บังคับ)
  function reworkFormCard() {
    return `<section class="card itrp-rework-card" id="itrp-rework-card" aria-labelledby="itrp-rework-title" hidden>
      <h2 id="itrp-rework-title">แก้ไขงาน</h2>
      <p class="muted small">บอกสิ่งที่ต้องการให้ IT แก้ไข ใบจะกลับไปที่ IT ทันทีโดยไม่ต้องอนุมัติใหม่</p>
      <div id="itrp-rework-message" role="status"></div>
      <form id="itrp-rework-form" novalidate>
        <div class="field" data-field="details"><label for="itrp-rework-details">รายละเอียดที่ต้องแก้ ${REQUIRED}</label><textarea class="textarea" id="itrp-rework-details" name="details" rows="4" maxlength="${model.MAX_LONG_TEXT}"></textarea></div>
        <div class="field" data-field="due_date"><label for="itrp-rework-due">วันที่ต้องการให้แก้ไขเสร็จ ${REQUIRED}</label><input class="input" id="itrp-rework-due" name="due_date" type="date"></div>
        ${fileField({ id: "itrp-rework-files", field: "rework_files", label: "แนบไฟล์ (ถ้ามี)" })}
        <div class="form-actions"><button type="button" class="btn secondary" id="itrp-rework-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ส่งให้ IT แก้ไข</button></div>
      </form>
    </section>`;
  }

  // ฟอร์มถามผู้แจ้ง (ผู้อนุมัติของขั้นที่ใบรออยู่ / IT) ซ่อนไว้จนกดปุ่ม "ถามผู้แจ้ง" · ข้อความ (บังคับ) + ไฟล์ (ไม่บังคับ)
  function askFormCard() {
    return `<section class="card itrp-ask-card" id="itrp-ask-card" aria-labelledby="itrp-ask-title" hidden>
      <h2 id="itrp-ask-title">ถามผู้แจ้ง</h2>
      <p class="muted small">ใบจะเปลี่ยนเป็น รอผู้แจ้งตอบ จนกว่าผู้แจ้งจะตอบ ผู้แจ้งเห็นคำถามนี้และแนบไฟล์ตอบได้</p>
      <div id="itrp-ask-message" role="status"></div>
      <form id="itrp-ask-form" novalidate>
        <div class="field" data-field="body"><label for="itrp-ask-body">ข้อความที่ต้องการถาม ${REQUIRED}</label><textarea class="textarea" id="itrp-ask-body" name="body" rows="4" maxlength="${model.MAX_INFO_BODY}"></textarea></div>
        ${fileField({ id: "itrp-ask-files", field: "ask_files", label: "แนบไฟล์ (ถ้ามี)" })}
        <div class="form-actions"><button type="button" class="btn secondary" id="itrp-ask-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ส่งคำถาม</button></div>
      </form>
    </section>`;
  }

  // คำถามที่รอผู้แจ้งตอบ (เห็นเด่นที่ผู้แจ้ง) + ฟอร์มตอบที่เปิดไว้ · ตอบแล้วใบกลับสถานะเดิมก่อนถาม · pending = model.pendingQuestion(detail)
  function answerCard(pending) {
    return `<section class="card itrp-answer-card" id="itrp-answer-card" aria-labelledby="itrp-answer-title">
      <h2 id="itrp-answer-title">${esc(pending.stageLabel)} ถามคุณ</h2>
      <article class="itrp-question" data-comment="${esc(pending.commentId)}">
        <p class="muted small">โดย ${esc(pending.askedBy)} · ${esc(model.formatDateTime(pending.askedAt))}</p>
        <p class="itrp-text">${esc(pending.body)}</p>
        ${pending.files.length ? fileGrid(pending.files) : ""}
      </article>
      <div id="itrp-answer-message" role="status"></div>
      <form id="itrp-answer-form" novalidate>
        <div class="field" data-field="body"><label for="itrp-answer-body">คำตอบของคุณ ${REQUIRED}</label><textarea class="textarea" id="itrp-answer-body" name="body" rows="4" maxlength="${model.MAX_INFO_BODY}"></textarea>${pending.returnLabel ? `<small>ตอบแล้วใบจะกลับไปที่ ${esc(pending.returnLabel)}</small>` : ""}</div>
        ${fileField({ id: "itrp-answer-files", field: "answer_files", label: "แนบไฟล์ (ถ้ามี)" })}
        <div class="form-actions"><button type="submit" class="btn is-primary">ส่งคำตอบ</button></div>
      </form>
    </section>`;
  }

  // ถาม-ตอบทุกข้อความตามลำดับ (ถาม/ตอบ ขั้น ผู้เขียน วันเวลา ข้อความ ไฟล์ของข้อความนั้น) · hideId = ข้อความที่แสดงที่ฟอร์มตอบอยู่แล้ว (ไม่ซ้ำ) · ไม่มีข้อความ = ไม่วาด
  function commentsCard(rows, { pendingId = null, hideId = null } = {}) {
    const shown = rows.filter((row) => hideId === null || String(row.id) !== String(hideId));
    if (!shown.length) return "";
    return `<section class="card itrp-comments" id="itrp-comments" aria-labelledby="itrp-comments-title"><h2 id="itrp-comments-title">ถาม-ตอบ <span class="detail-section-count">${shown.length}</span></h2>
      ${shown.map((row) => `<article class="itrp-comment is-${esc(row.kind)}" data-comment="${esc(row.id)}">
        <h3><span class="itrp-comment-kind">${esc(row.kindLabel)}</span> · ${esc(row.stageLabel)}${pendingId !== null && String(row.id) === String(pendingId) ? ` <span class="badge more_info">ยังไม่ตอบ</span>` : ""}</h3>
        <p class="muted small">โดย ${esc(row.by)} · <time datetime="${esc(row.at)}">${esc(model.formatDateTime(row.at))}</time></p>
        <p class="itrp-text">${esc(row.body)}</p>
        ${row.files.length ? fileGrid(row.files) : ""}
      </article>`).join("")}
    </section>`;
  }

  function historyCard(events, requester) {
    const items = events.map((event) => `<div class="timeline-item"><strong>${esc(model.eventLabelFor(event, requester))}</strong><p class="timeline-item-detail">โดย ${esc(event.actor_full_name)}</p>${event.reason ? `<p class="timeline-item-message">${esc(event.reason)}</p>` : ""}<time class="timeline-item-time" datetime="${esc(event.created_at)}">${esc(model.formatDateTime(event.created_at))}</time></div>`).join("");
    return `<section class="card detail-history" aria-labelledby="detail-history-title"><h2 id="detail-history-title">ประวัติเอกสาร</h2><div class="timeline">${items || '<div class="muted small">ยังไม่มีประวัติ</div>'}</div></section>`;
  }

  // ใบทั้งใบ · ปุ่มซ่อนตาม allowed_actions อยู่แล้ว (ฟอร์มถาม/ส่งงาน/แก้ไขงานวาดเฉพาะผู้ที่มีปุ่มนั้น)
  function detailPage(detail, { back } = {}) {
    const buttons = model.actionButtons(detail.allowed_actions);
    const has = (action) => buttons.some((button) => button.action === action);
    const pending = has("provide_info") ? model.pendingQuestion(detail) : null;
    const comments = model.commentRows(detail);
    const hasFiles = model.allFiles(detail).length > 0;
    return page(`${detailHead(detail, back)}
      <div class="detail-grid">
        <div class="stack"${hasFiles ? ' id="attachment-gallery"' : ""}>
          ${pending ? answerCard(pending) : ""}
          ${actionsCard(buttons)}
          ${has("complete") ? completeFormCard() : ""}
          ${has("request_rework") ? reworkFormCard() : ""}
          ${has("request_info") ? askFormCard() : ""}
          <section class="card itrp-facts" aria-labelledby="itrp-facts-title"><h2 id="itrp-facts-title">ข้อมูลใบแจ้งซ่อม</h2>
            <dl class="definition-grid">
              ${fact("รหัสเครื่องคอมพิวเตอร์", esc(detail.asset_code ?? "") || "—")}
              ${fact("ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์", esc(detail.device_name))}
              ${fact("ประเภทคำขอ", esc(model.requestKindText(detail.request_kind, detail.request_kind_note)))}
              ${fact("ประเภทงานซ่อม", esc(model.repairTargetText(detail.repair_target, detail.repair_target_note)))}
              ${fact("อาการเสีย", esc(detail.symptom), true)}
            </dl>
          </section>
          ${reportCards(detail)}
          ${commentsCard(comments, { pendingId: detail.info_pending?.comment_id ?? null, hideId: pending ? pending.commentId : null })}
          ${filesAndReworks(detail)}
        </div>
        <aside class="stack">
          <section class="card itrp-print-card"><h2>เอกสาร</h2><div class="action-panel-buttons"><a class="btn secondary" id="itrp-print" href="${esc(model.repairUrl("print", { id: detail.id }))}">พิมพ์ใบแจ้งซ่อม (A4)</a></div></section>
          ${historyCard(detail.events ?? [], detail.requester)}
        </aside>
      </div>`);
  }

  /* ---------- หน้าพิมพ์ A4 (เลย์เอาต์ตามฟอร์มกระดาษ "ใบแจ้งซ่อมคอมพิวเตอร์" 1 หน้า) ---------- */
  // วงกลมทึบ = ตัวที่เลือก (ใช้ตัวอักษร ● ○ ไม่พึ่งสีพื้นหลัง จึงพิมพ์ขาวดำได้) · ☑ ☐ ใช้กับช่องสรุปผลการซ่อม
  const radio = (on) => `<span class="itrp-radio" aria-hidden="true">${on ? "●" : "○"}</span>`;
  const box = (checked) => `<span class="itrp-box" aria-hidden="true">${checked ? "☑" : "☐"}</span>`;
  // ตัวเลือกวงกลมบนกระดาษ: options = รายการตัวเลือก · selected = ค่าที่เลือก · extra(option) = ข้อความต่อท้ายตัวเลือกที่เลือก (เช่น "(ระบุ: …)") · ไม่มีค่าที่เลือก = วงกลมโล่งทั้งหมด
  const printChoices = (options, selected, extra = () => "") => options.map((option) => {
    const on = option.value === selected;
    const more = on ? extra(option) : "";
    return `<span class="itrp-choice-print" data-option="${esc(option.value)}"${on ? ' data-selected="1"' : ""}>${radio(on)} ${esc(option.label)}${more ? ` ${more}` : ""}</span>`;
  }).join("");
  const blank = (text) => (text ? esc(text) : '<span class="itrp-blank-line"></span>');
  const MIN_PART_ROWS = 4; // แถวอะไหล่ขั้นต่ำบนกระดาษ (เกินให้ต่อแถว)
  // กล่องลายเซ็น: ชื่อ + วันที่และเวลาที่กดในระบบ · ว่าง = เว้นช่อง · remark = หมายเหตุใต้ชื่อ (อนุมัติครั้งเดียวนับทั้งสองขั้น ฯลฯ)
  const signBox = (key, label, sign) => `<div class="itrp-sign" data-slot="${key}">
        <div class="itrp-sign-label">${esc(label)}</div>
        <div class="itrp-sign-name">${esc(sign.name ?? "")}</div>
        ${sign.remark ? `<div class="itrp-sign-remark">(${esc(sign.remark)})</div>` : ""}
        <div class="itrp-sign-time">${sign.at ? esc(model.formatDateTime(sign.at)) : ""}</div>
      </div>`;

  // ประวัติการแก้ไขงานบนกระดาษ: ตารางทุกรอบ (ครั้งที่ · วันที่ขอ · รายละเอียดที่ต้องแก้ · กำหนดเสร็จ) ไม่มีรอบ = ไม่มีส่วนนี้ · ต่อท้ายฟอร์ม (ถ้ามีจะล้นไปหน้าถัดไป)
  function printReworks(rounds) {
    if (!rounds.length) return "";
    return `<h2 class="itrp-sheet-section">ประวัติการแก้ไขงาน</h2>
        <table class="itrp-sheet-table itrp-sheet-reworks"><thead><tr><th>ครั้งที่</th><th>ขอเมื่อ / โดย</th><th>รายละเอียดที่ต้องแก้</th><th>กำหนดเสร็จ</th></tr></thead><tbody>${rounds.map((round) => `<tr>
          <td class="itrp-center">${round.roundNo}</td>
          <td>${esc(model.formatDateTime(round.createdAt))}<br>${esc(round.requestedBy)}</td>
          <td class="itrp-sheet-text">${esc(round.details)}</td>
          <td>${esc(model.formatDate(round.dueDate))}</td></tr>`).join("")}</tbody></table>`;
  }
  // ประวัติถาม-ตอบบนกระดาษ: ตารางทุกข้อความ (ลำดับ · ถาม/ตอบ · ขั้น · โดย · วันเวลา · ข้อความ) ไม่มีข้อความ = ไม่มีส่วนนี้
  function printComments(rows) {
    if (!rows.length) return "";
    return `<h2 class="itrp-sheet-section">ประวัติถาม-ตอบ</h2>
        <table class="itrp-sheet-table itrp-sheet-comments"><thead><tr><th>ลำดับ</th><th>ถาม/ตอบ</th><th>ขั้น</th><th>โดย</th><th>วันเวลา</th><th>ข้อความ</th></tr></thead><tbody>${rows.map((row) => `<tr>
          <td class="itrp-center">${row.no}</td>
          <td>${esc(row.kindLabel)}</td>
          <td>${esc(row.stageLabel)}</td>
          <td>${esc(row.by)}</td>
          <td>${esc(model.formatDateTime(row.at))}</td>
          <td class="itrp-sheet-text">${esc(row.body)}</td></tr>`).join("")}</tbody></table>`;
  }

  function printSheet(detail) {
    const isTest = Boolean(detail.is_test) || model.isTestDoc(detail.doc_no);
    const latest = model.repairReports(detail).latest;
    const report = model.reportView(latest);
    const sign = model.printSignoffs(detail);
    const outcome = model.printOutcome(detail);
    const duration = model.repairDuration(detail.started?.at, detail.completed?.at);
    // ข้อความ "(ระบุ: …)" ต่อท้ายเฉพาะตัวเลือก "อื่นๆ" ที่ถูกเลือก
    const otherNote = (note) => (option) => (option.value === "other" ? `(ระบุ: ${esc(note ?? "")})` : "");
    const kindChoices = printChoices(model.REQUEST_KINDS, detail.request_kind, otherNote(detail.request_kind_note));
    const targetChoices = printChoices(model.REPAIR_TARGETS, detail.repair_target, otherNote(detail.repair_target_note));
    // สรุปสาเหตุ/การตรวจซ่อม มาจากบันทึกการซ่อมชุดล่าสุด (ยังไม่เคยส่งงาน = วงกลมโล่งทั้งหมด) · ส่งซ่อมที่ = สถานที่ · เรียกผู้ซ่อมภายนอก = ชื่อผู้ซ่อมถ้ามี
    const causeChoices = printChoices(model.CAUSE_KINDS, latest?.cause_kind, otherNote(latest?.cause_kind_note));
    const methodChoices = printChoices(model.REPAIR_METHODS, latest?.repair_method, (option) => {
      const vendor = esc(latest?.repair_vendor ?? "");
      if (option.value === "sent_out") return `<span class="itrp-underline">${vendor}</span>`;
      return option.value === "external_onsite" && vendor ? `(${vendor})` : "";
    });
    const partRows = report?.parts ?? [];
    const blankRows = Math.max(0, MIN_PART_ROWS - partRows.length);
    const partsBody = [
      ...partRows.map((part) => `<tr><td class="itrp-center">${esc(part.no)}</td><td>${esc(part.item)}</td><td class="itrp-right">${esc(part.quantity)}</td><td class="itrp-right">${esc(part.price)}</td><td>${esc(part.note)}</td></tr>`),
      ...Array.from({ length: blankRows }, (_, index) => `<tr class="itrp-part-blank"><td class="itrp-center">${partRows.length + index + 1}</td><td></td><td></td><td></td><td></td></tr>`),
    ].join("");
    return `<article class="itrp-sheet${isTest ? " is-test" : ""}" aria-label="${esc(FORM_TITLE)} ${esc(detail.doc_no)}">
        ${isTest ? '<div class="itrp-watermark" aria-hidden="true">ทดสอบ</div>' : ""}
        <header class="itrp-sheet-title">
          <img class="itrp-sheet-logo" src="./icons/icon-192.png" alt="">
          <h1>${esc(FORM_TITLE)}${detail.is_urgent ? ' <span class="itrp-urgent-mark">(งานด่วน)</span>' : ""}</h1>
          <div class="itrp-docbox"><span>เลขที่ใบแจ้งซ่อม</span><strong>${esc(detail.doc_no)}</strong></div>
        </header>
        ${isTest ? '<p class="itrp-test-note">ใบทดสอบ — ไม่ใช่เอกสารจริง</p>' : ""}
        <table class="itrp-sheet-table"><tbody>
          <tr><th scope="row">ผู้แจ้งซ่อม</th><td>${esc(detail.requester?.full_name ?? "—")}</td><th scope="row">หน่วยงาน</th><td>${esc(detail.department?.name_th ?? "—")}</td></tr>
          <tr><th scope="row">วันที่แจ้งซ่อม</th><td>${esc(model.formatDateOf(detail.created_at))}</td><th scope="row">เวลา</th><td>${esc(model.formatTimeOf(detail.created_at))}</td></tr>
          <tr><th scope="row">รหัสเครื่องคอมพิวเตอร์</th><td>${esc(detail.asset_code ?? "")}</td><th scope="row">ชื่อเครื่อง / อุปกรณ์</th><td>${esc(detail.device_name)}</td></tr>
          <tr><th scope="row">ประเภทคำขอ</th><td colspan="3">${kindChoices}</td></tr>
          <tr><th scope="row">ประเภทงานซ่อม</th><td colspan="3">${targetChoices}</td></tr>
        </tbody></table>
        <div class="itrp-symptom-row">
          <div class="itrp-symptom"><div class="itrp-sheet-label">ระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น</div><div class="itrp-sheet-text itrp-symptom-text">${esc(detail.symptom)}</div></div>
          ${signBox("approver", "ลงชื่อผู้อนุมัติ", sign.approver)}
        </div>
        <div class="itrp-band">สำหรับแผนก IT.</div>
        <table class="itrp-sheet-table"><tbody>
          <tr><th scope="row">สาเหตุ</th><td class="itrp-sheet-text">${esc(report?.cause ?? "")}</td></tr>
          <tr><th scope="row">สรุปสาเหตุเกิดจาก</th><td>${causeChoices}</td></tr>
          <tr><th scope="row">การตรวจซ่อม</th><td>${methodChoices}</td></tr>
          <tr><th scope="row">การซ่อม-แก้ไขที่เกิดขึ้น</th><td class="itrp-sheet-text">${esc(report?.repairAction ?? "")}</td></tr>
          <tr><th scope="row">เอกสารสำคัญอ้างอิง ใบ PR./PO.No.</th><td>${esc(report?.prPoNo ?? "")}</td></tr>
        </tbody></table>
        <table class="itrp-sheet-table itrp-sheet-parts"><thead><tr><th>ลำดับ</th><th>รายการอะไหล่ / วัสดุที่ใช้</th><th>จำนวน</th><th>ราคา</th><th>หมายเหตุ</th></tr></thead><tbody>${partsBody}</tbody></table>
        <table class="itrp-sheet-table"><tbody>
          <tr><th scope="row">เริ่มดำเนินการซ่อม</th><td>วันที่ ${blank(model.formatDateOf(detail.started?.at))} เวลา ${blank(model.formatTimeOf(detail.started?.at))}</td><th scope="row">ซ่อมเสร็จ</th><td>วันที่ ${blank(model.formatDateOf(detail.completed?.at))} เวลา ${blank(model.formatTimeOf(detail.completed?.at))}</td></tr>
          <tr><th scope="row">รวมเวลาในการซ่อม</th><td>${blank(duration?.text ?? "")}</td><th scope="row">ช่างผู้ดำเนินการซ่อม</th><td>${blank(detail.completed?.by ?? "")}</td></tr>
        </tbody></table>
        <div class="itrp-outcome"><strong>สรุปผลการซ่อม</strong> <span class="itrp-outcome-item" data-outcome="complete">${box(outcome.complete)} ใช้งานได้สมบูรณ์</span> <span class="itrp-outcome-item" data-outcome="rework">${box(outcome.rework)} ส่งแก้ไข เลขที่ <span class="itrp-blank-line"></span></span></div>
        <div class="itrp-signs">
          ${signBox("delivered", "ส่งมอบงาน (แผนก IT)", sign.delivered)}
          ${signBox("received", "รับมอบงาน", sign.received)}
          ${signBox("acknowledged", "รับทราบ ฝ่ายบริหาร", sign.acknowledged)}
        </div>
        ${printReworks(model.reworkRounds(detail))}
        ${printComments(model.commentRows(detail))}
        <p class="itrp-sheet-note">ลงนามอิเล็กทรอนิกส์ผ่านระบบ (ชื่อและวันเวลาตามที่กดในระบบ) · สถานะใบแจ้งซ่อม ณ ที่พิมพ์: ${esc(model.statusLabel(detail.status))}</p>
      </article>`;
  }

  function printPage(detail) {
    return page(`<div class="itrp-print-toolbar no-print">
        <a class="btn secondary" href="${esc(orderHref(detail.id))}">‹ กลับไปรายละเอียด</a>
        <button type="button" class="btn is-primary" id="itrp-print-button">พิมพ์</button>
      </div>
      ${printSheet(detail)}`);
  }

  /* ---------- ตั้งค่า (it_admin) ---------- */
  // รายชื่อทีม IT อ่านอย่างเดียว: ใช้ชุดเดียวกับใบสั่งงาน IT (ตาราง itwo_staff) การแก้สิทธิ์ทำที่ใบสั่งงาน IT ไม่ใช่ที่นี่
  function staffTable({ staff }) {
    if (!staff.length) return emptyBlock("ยังไม่มีรายชื่อทีม IT");
    return table({
      label: "ทีม IT ของใบแจ้งซ่อม",
      columns: [
        { key: "who", label: "พนักงาน", role: "subject" },
        { key: "roles", label: "สิทธิ์" },
      ],
      rows: staff.map((row) => ({
        cells: {
          who: `<strong class="register-title">${esc(row.full_name)}</strong>${subText([row.employee_no, row.department_name, row.is_active ? "" : "ปิดใช้งานแล้ว"].filter(Boolean).join(" · "))}`,
          roles: esc(model.staffRoleText(row)),
        },
      })),
    });
  }

  // counter = ผลของ app_itrp_get_doc_counter · ตั้งเลขถัดไปได้เฉพาะเดินหน้า
  function docCounterCard(counter) {
    if (!counter) return "";
    return `<section class="card itrp-counter" aria-labelledby="itrp-counter-title"><h2 id="itrp-counter-title">เลขที่เอกสารถัดไป</h2>
      <p class="itrp-counter-no"><span class="request-no">${esc(counter.next_doc_no)}</span></p>
      <form id="itrp-counter-form" novalidate>
        <div class="field" data-field="next_seq"><label for="itrp-next-seq">ตั้งเลขถัดไปเป็น</label><input class="input" id="itrp-next-seq" name="next_seq" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${esc(String(counter.next_seq + 1))}"><small>ตั้งได้เฉพาะเดินหน้า (ใช้ต่อจากทะเบียนกระดาษ เช่น 51) ถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ และมีบันทึกการตั้งเลขที่ลบไม่ได้</small></div>
        <div class="form-actions"><button type="submit" class="btn is-primary">ตั้งเลขถัดไป</button></div>
      </form></section>`;
  }

  function settingsPage({ staff, counter }) {
    return `<div class="stack">
      <section class="card" aria-labelledby="itrp-staff-title"><h2 id="itrp-staff-title">ทีม IT</h2>
        <p class="muted small">รายชื่อเดียวกับใบสั่งงาน IT (ดูอย่างเดียว) ถ้าต้องการเพิ่มหรือแก้สิทธิ์ ให้แก้ที่แท็บตั้งค่าของใบสั่งงาน IT</p>
        ${staffTable({ staff })}
      </section>
      ${docCounterCard(counter)}
    </div>`;
  }

  // ล้างข้อมูลใบแจ้งซ่อมทดสอบ: เฉพาะ admin ตัวจริงที่อยู่ในโหมดทดสอบ (state.sandbox ตั้งโดย app.js)
  const purgeRow = () => `<div class="itrp-purge"><button type="button" class="btn danger small" id="itrp-purge">ล้างข้อมูลใบแจ้งซ่อมทดสอบ</button></div>`;

  const api = { head, newButton, tabs, page, errorCard, mineList, approvalsList, itList, orderForm, orderReview, uploadPanel, detailPage, detailHead, completeFormCard, partRow, vendorLabel, reworkFormCard, askFormCard, answerCard, commentsCard, reportCards, partsTable, printComments, reworkRoundsCard, filesAndReworks, historyCard, actionsCard, printSheet, printPage, settingsPage, staffTable, docCounterCard, purgeRow, testTag };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITRP_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
