// ใบขอสิทธิ์ IT (itar · ฟอร์ม IT01-FM08) — HTML ของหน้าต่าง ๆ เป็นสตริงล้วน ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itar-pages.test.mjs)
// การเชื่อมต่อ (เรียก RPC ผูกปุ่ม กล่องยืนยัน) อยู่ที่ modules/module-itar.js · ข้อมูลล้วน/กติกาอยู่ที่ modules/itar-model.js
// คัดโครงจากใบแจ้งซ่อม IT (itrp-pages.js): แท็บ ใบของฉัน/รออนุมัติ/งาน IT/ตั้งค่า · ถาม-ตอบ · แนบไฟล์ · ไทม์ไลน์
// ที่ต่าง: ฟอร์มยื่นมี 2 ช่วง (เลือกประเภท+ผู้รับสิทธิ์ → ติ๊กสิทธิ์จากสิทธิ์ปัจจุบัน) และหน้ารายละเอียดมีตาราง "ก่อน → หลัง"
// ส่วน B: หน้า "ปรับสิทธิ์ตามใบ" (applyForm) · การ์ดรับทราบสิทธิ์ (ackCard) · รับทราบด้วยกระดาษ + แนบรูปใบที่เซ็น (paperCard) · ใบพิมพ์ A4 ใบคำร้อง (printRequestSheet) และเอกสารชี้แจงสิทธิ์ (printRightsSheet)
// ไม่มีรหัสผ่านหรือช่องลับใด ๆ ในหน้าเหล่านี้ (ข้อมูลของใบไม่มีช่องลับอยู่แล้ว)
(function (root) {
  "use strict";

  const model = root.MNP_ITAR_MODEL;
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const iconOf = (name) => root.MNP_UI_ICONS?.icon(name) ?? "";
  const REQUIRED = '<span class="field-required">(จำเป็น)</span>';
  const PALETTE = "it";
  const TITLE = "ใบขอสิทธิ์ IT";
  const FORM_TITLE = "ใบขอสิทธิ์ IT";

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
  const testTag = (isTest) => (isTest ? '<span class="badge itar-test-tag" title="ข้อมูลทดสอบ แยกจากระบบจริง">ทดสอบ</span>' : "");
  // row = แถวของรายการ (ใส่ title ของป้าย "รอผู้ยื่นตอบ": ใครถาม ตอบแล้วใบกลับไปที่ไหน)
  const statusBadge = (status, mine = false, row = null) => {
    const title = row ? model.infoBadgeTitle({ ...row, status }, mine) : "";
    return `<span class="badge ${esc(model.statusBadgeClass(status))}"${title ? ` title="${esc(title)}"` : ""}>${esc(mine ? model.myStatusLabel(status, row) : model.statusLabel(status))}</span>`;
  };
  // เรื่องของแถวในรายการ: ชื่อผู้รับสิทธิ์เป็นหัวเรื่อง · ใต้เรื่องคือประเภท + จำนวนรายการ (ผู้ยื่น/แผนกต่อท้ายในหน้าที่คนอื่นเป็นคนดู)
  const subjectOf = (row) => model.clip(row.subject_name || "—", 90);
  const subjectNote = (row, ...more) => [model.requestTypeLabel(row.request_type), row.request_type === "revoke_all" ? "" : `${Number(row.item_count) || 0} รายการ`, ...more].filter(Boolean).join(" · ");
  const orderHref = (id) => model.accessUrl("order", { id });

  /* ---------- หัวหน้า ---------- */
  function head({ title = TITLE, back = { href: "#/office?module=it-support", label: "‹ IT SUPPORT" }, actions = "", isTest = false } = {}) {
    return `${back ? `<a class="request-back-link" href="${esc(back.href)}">${esc(back.label)}</a>` : ""}
      <div class="page-heading request-module-header itar-head" data-module="${PALETTE}">
        <div class="request-module-title"><span class="type-card-badge">${iconOf("lock")}</span><h1>${esc(title)}</h1>${testTag(isTest)}</div>
        ${actions ? `<div class="request-create-entry">${actions}</div>` : ""}
      </div>`;
  }
  const newButton = () => `<a class="btn" id="itar-new" href="${esc(model.accessUrl("new"))}"><span class="plus-icon" aria-hidden="true"></span> ยื่นขอสิทธิ์ใหม่</a>`;

  // แท็บตามสิทธิ์ · counts = { mine, approvals, it } ตัวเลขบนแท็บ (ไม่ระบุ/นับไม่ได้ = ไม่แสดง)
  const COUNT_NOTES = Object.freeze({ mine: " ที่รอคุณรับทราบ", approvals: " ที่รออนุมัติ", it: " ที่ต้องดำเนินการ" });
  function tabs(role, active, counts = {}) {
    const items = model.visibleTabs(role).map((tab) => {
      const count = counts[tab.key];
      const note = tab.key === "mine" && counts.mineParts ? model.mineWaitingNote(counts.mineParts) : COUNT_NOTES[tab.key] ?? "";
      const badge = Number.isFinite(count) && count > 0 ? ` <span class="itar-tab-count" aria-label="${count} รายการ${esc(note)}" title="${count} รายการ${esc(note)}">${count > 99 ? "99+" : count}</span>` : "";
      return `<a class="view-tab${tab.key === active ? " active" : ""}"${tab.key === active ? ' aria-current="page"' : ""} href="${esc(model.accessUrl(tab.key))}">${esc(tab.label)}${badge}</a>`;
    });
    // ผู้ใช้ที่มีแท็บเดียวไม่มีแถบแท็บ ยกเว้นมีใบรอคุณรับทราบ/รอคุณตอบ: ต้องเห็นตัวเลขว่างานกลับมาหาตัวเอง
    return items.length > 1 || counts.mine > 0 ? `<nav class="view-tabs" aria-label="หมวดใบขอสิทธิ์">${items.join("")}</nav>` : "";
  }

  // เลขเวอร์ชันของโมดูลท้ายหน้า ชิดขวา (ไม่พิมพ์ลงใบ A4) · วันที่ปล่อยอยู่ใน title
  const versionTag = () => `<p class="itar-version no-print" title="${FORM_TITLE} เวอร์ชัน ${esc(model.MODULE_VERSION)} · อัปเดต ${esc(model.formatDate(model.VERSION_DATE))}">V${esc(model.MODULE_VERSION)}</p>`;
  // แถบ "กำลังพัฒนา" บนสุดของทุกหน้า (ผูกกับธง IN_DEVELOPMENT ใน itar-model.js) · ไม่ขวางการใช้งาน และไม่พิมพ์ลงกระดาษ
  const DEV_NOTICE = "ระบบใบขอสิทธิ์ IT กำลังพัฒนาและทดสอบ ยังไม่เปิดใช้งานจริง";
  const devNotice = () => (model.IN_DEVELOPMENT ? `<p class="rf-callout is-warn itar-dev-notice no-print" role="status">${DEV_NOTICE}</p>` : "");
  const page = (inner, { showDevNotice = true } = {}) => `<div class="itar-page" data-module="${PALETTE}">${showDevNotice ? devNotice() : ""}${inner}${versionTag()}</div>`;
  const errorCard = (message, { retry = true } = {}) => `<section class="card"><div class="form-message error" role="alert">${esc(message)}</div>${retry ? '<button class="btn secondary" type="button" id="itar-retry">ลองอีกครั้ง</button>' : ""}</section>`;

  /* ---------- รายการ: ใบของฉัน / รออนุมัติ / งาน IT ---------- */
  function mineList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ยังไม่มีใบขอสิทธิ์ที่คุณยื่นหรือเป็นผู้รับสิทธิ์", "กด \"ยื่นขอสิทธิ์ใหม่\" เพื่อขอสิทธิ์โฟลเดอร์ อินเทอร์เน็ต โปรแกรม หรืออีเมล")}</section>`;
    return table({
      label: "ใบขอสิทธิ์ของฉัน",
      columns: [
        { key: "no", label: "เลขที่", role: "no" },
        { key: "subject", label: "ผู้รับสิทธิ์", role: "subject" },
        { key: "created", label: "ยื่นเมื่อ", sorted: "descending" },
        { key: "status", label: "สถานะ", role: "status" },
      ],
      rows: rows.map((row) => ({
        className: `status-${row.status}`,
        sort: { created: row.created_at ?? "" },
        cells: {
          no: noLink(row.doc_no, orderHref(row.id)),
          subject: subjectCell(subjectOf(row), orderHref(row.id), subjectNote(row, row.is_requester ? "" : `ยื่นโดย ${row.requester_name}`)),
          created: esc(model.formatDateTime(row.created_at)),
          status: `<span class="register-badges">${statusBadge(row.status, true, row)}</span>`,
        },
      })),
    });
  }

  // รออนุมัติ: ใบที่ "รอคุณ" เป็นตารางหลัก · ใบที่ถามผู้ยื่นไปแล้วและรอตอบ (need_info) แยกเป็นกลุ่มของตัวเอง (ไม่ใช่งานที่ต้องกดอนุมัติ ไม่นับบนแท็บ)
  function approvalsList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ไม่มีใบขอสิทธิ์ที่รออนุมัติจากคุณ")}</section>`;
    const waiting = rows.filter((row) => row.status !== "need_info");
    const asked = rows.filter((row) => row.status === "need_info");
    const build = (label, statusHeading, items) => table({
      label,
      columns: [
        { key: "no", label: "เลขที่", role: "no" },
        { key: "subject", label: "ผู้รับสิทธิ์", role: "subject" },
        { key: "created", label: "ยื่นเมื่อ", sorted: "descending" },
        { key: "status", label: statusHeading, role: "status" },
      ],
      rows: items.map((row) => ({
        className: `status-${row.status}`,
        sort: { created: row.created_at ?? "" },
        cells: {
          no: noLink(row.doc_no, orderHref(row.id)),
          subject: subjectCell(subjectOf(row), orderHref(row.id), subjectNote(row, `ยื่นโดย ${row.requester_name}`, row.department_name)),
          created: esc(model.formatDateTime(row.created_at)),
          status: `<span class="register-badges">${row.status === "need_info" ? statusBadge(row.status, false, row) : `<span class="badge pending_approval">${esc(model.pendingStepLabel(row.pending_step))}</span>`}</span>`,
        },
      })),
    });
    const waitingTable = waiting.length ? build("ใบขอสิทธิ์ที่รอคุณอนุมัติ", "รอคุณ", waiting) : "";
    if (!asked.length) return waitingTable;
    const askedLabel = model.statusLabel("need_info");
    return `<div class="stack">
      ${waitingTable || `<section class="card">${emptyBlock("ไม่มีใบขอสิทธิ์ที่รออนุมัติจากคุณ")}</section>`}
      <section class="card detail-section itar-group" data-group="awaiting_info" aria-labelledby="itar-g-awaiting-info"><h2 id="itar-g-awaiting-info">${esc(askedLabel)} <span class="detail-section-count">${asked.length}</span></h2>${build(askedLabel, "สถานะ", asked)}</section>
    </div>`;
  }

  // งาน IT แยกตามสถานะ · กลุ่ม "จบแล้ว" พับไว้ (ไม่ใช่งานที่ต้องลงมือ)
  function itList(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ยังไม่มีใบขอสิทธิ์")}</section>`;
    const groups = model.groupItOrders(rows);
    const sections = model.IT_GROUPS.filter((group) => groups[group.key].length).map((group) => {
      const items = groups[group.key];
      const closed = group.key === "closed";
      const content = table({
        label: group.label,
        columns: [
          { key: "no", label: "เลขที่", role: "no" },
          { key: "subject", label: "ผู้รับสิทธิ์", role: "subject" },
          { key: "approval", label: "อนุมัติ" },
          { key: "status", label: "สถานะ", role: "status" },
        ],
        rows: items.map((row) => ({
          className: `status-${row.status}`,
          cells: {
            no: noLink(row.doc_no, orderHref(row.id)),
            subject: subjectCell(subjectOf(row), orderHref(row.id), subjectNote(row, `ยื่นโดย ${row.requester_name}`, row.department_name)),
            approval: model.itApprovalProgress(row).map((step) => `<span class="itar-step${step.done ? " is-done" : ""}">${step.done ? "✓" : "○"} ${esc(step.label)}</span>`).join(""),
            status: `<span class="register-badges">${statusBadge(row.status, false, row)}</span>`,
          },
        })),
      });
      const title = `${esc(group.label)} <span class="detail-section-count">${items.length}</span>`;
      return closed
        ? `<details class="card detail-section itar-group" data-group="${group.key}"><summary><h2>${title}</h2></summary>${content}</details>`
        : `<section class="card detail-section itar-group" data-group="${group.key}" aria-labelledby="itar-g-${group.key}"><h2 id="itar-g-${group.key}">${title}</h2>${content}</section>`;
    });
    return `<div class="stack">${sections.join("")}</div>`;
  }

  /* ---------- ฟอร์มยื่นช่วงที่ 1: ประเภท + ผู้รับสิทธิ์ ---------- */
  function choiceGroup({ name, legend, options, value, required = false, field, withHint = false }) {
    return `<fieldset class="field" data-field="${field ?? name}">
      <legend>${esc(legend)} ${required ? REQUIRED : ""}</legend>
      <div class="itar-choices" data-invalid-target role="radiogroup" aria-label="${esc(legend)}">${options.map((option) => `<label class="itar-choice"><input type="radio" name="${name}" value="${esc(option.value)}"${option.value === value ? " checked" : ""}> <span>${esc(option.label)}${withHint && option.hint ? `<small class="muted itar-choice-hint">${esc(option.hint)}</small>` : ""}</span></label>`).join("")}</div>
    </fieldset>`;
  }
  const selectOptions = (options, value) => options.map((option) => `<option value="${esc(option.value)}"${String(option.value) === String(value ?? "") ? " selected" : ""}>${esc(option.label)}</option>`).join("");
  const divisionField = ({ type, value }) => `<div class="field" data-field="division"><label for="itar-division">ฝ่ายของผู้ใช้ ${type === "new" ? REQUIRED : "(ไม่บังคับ)"}</label>
      <select class="select" id="itar-division" name="division"><option value="">— เลือกฝ่าย —</option>${selectOptions(model.DIVISIONS, value)}</select></div>`;
  const nameEnField = ({ value }) => `<div class="field" data-field="name_en"><label for="itar-name-en">ชื่อ-นามสกุล (อังกฤษ) ใช้เป็นชื่อในทะเบียนสิทธิ์ (ไม่บังคับ)</label>
      <input class="input" id="itar-name-en" name="name_en" maxlength="${model.MAX_NAME}" autocomplete="off" value="${esc(value)}"></div>`;

  // ส่วนที่เปลี่ยนตามโหมดผู้รับสิทธิ์ (วาดใหม่เมื่อเปลี่ยนโหมด/ประเภท/ผลค้นหา)
  //   values = ค่าที่กรอกไว้ { type, mode, pick, search, name_th, name_en, department_id, division }
  //   search = { state: "idle" | "loading" | "error", results: [{ key, kind, id, name, meta }], message } · departments = รายชื่อแผนกให้เลือก (โหมดกรอกเอง)
  function subjectBody({ role, values, search = { state: "idle", results: [] }, departments = [] }) {
    const type = values.type;
    const mode = values.mode || "self";
    const extra = type === "new" ? `${divisionField({ type, value: values.division })}${nameEnField({ value: values.name_en })}` : "";
    if (mode === "self") {
      const who = [role?.full_name, role?.department?.name_th].filter(Boolean).join(" · ");
      return `<p class="muted small itar-subject-self">ผู้รับสิทธิ์: ${esc(who) || "ตัวคุณเอง"}</p>${extra}`;
    }
    if (mode === "other") {
      const picked = values.pick ? `<div class="itar-picked" role="status"><strong>${esc(values.pick.name)}</strong>${values.pick.meta ? `<span class="muted small"> · ${esc(values.pick.meta)}</span>` : ""} <button type="button" class="btn secondary small" id="itar-pick-clear">เปลี่ยนคน</button></div>` : "";
      const status = search.state === "loading" ? '<p class="muted small" role="status">กำลังค้นหา…</p>'
        : search.state === "error" ? `<p class="field-error" role="alert">${esc(search.message || "ค้นหาไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วกดค้นหาอีกครั้ง")}</p>`
          : search.searched && !search.results.length ? '<p class="muted small" role="status">ไม่พบผู้รับสิทธิ์ที่ตรงกับคำค้น</p>' : "";
      const results = search.results.length
        ? `<ul class="itar-results" aria-label="ผลการค้นหา">${search.results.map((item) => `<li><button type="button" class="itar-result" data-pick="${esc(item.key)}"><strong>${esc(item.name)}</strong>${item.meta ? `<span class="muted small">${esc(item.meta)}</span>` : ""}</button></li>`).join("")}</ul>`
        : "";
      return `<div class="field" data-field="pick">
          <label for="itar-search">ค้นหาผู้รับสิทธิ์ (ชื่อ หรือรหัสพนักงาน อย่างน้อย 2 ตัวอักษร) ${REQUIRED}</label>
          <div class="itar-search-row"><input class="input" id="itar-search" name="search" type="search" maxlength="100" autocomplete="off" value="${esc(values.search)}"><button type="button" class="btn secondary" id="itar-search-go">ค้นหา</button></div>
          <div id="itar-search-status" aria-live="polite">${status}</div>
          ${results}${picked}
        </div>${extra}`;
    }
    // manual: ผู้รับสิทธิ์ที่ไม่มีบัญชีและไม่มีในทะเบียน (เฉพาะผู้ดูแลงาน IT)
    return `<div class="field" data-field="name_th"><label for="itar-name-th">ชื่อ-นามสกุล (ไทย) ${REQUIRED}</label><input class="input" id="itar-name-th" name="name_th" maxlength="${model.MAX_NAME}" autocomplete="off" value="${esc(values.name_th)}"><small>กรอกชื่อไทยหรืออังกฤษอย่างน้อยหนึ่งอย่าง</small></div>
      ${nameEnField({ value: values.name_en })}
      <div class="field" data-field="department_id"><label for="itar-department">แผนก ${REQUIRED}</label>
        <select class="select" id="itar-department" name="department_id"><option value="">— เลือกแผนก —</option>${departments.map((department) => `<option value="${esc(department.id)}"${String(department.id) === String(values.department_id ?? "") ? " selected" : ""}>${esc(department.name_th)}${department.code ? ` (${esc(department.code)})` : ""}</option>`).join("")}</select></div>
      ${divisionField({ type, value: values.division })}
      <p class="muted small">ผู้รับสิทธิ์ที่ไม่มีบัญชีรับทราบด้วยกระดาษ: IT พิมพ์เอกสารให้เซ็นแล้วกดรับทราบแทนพร้อมแนบรูปใบที่เซ็น</p>`;
  }

  // ตัวเลือกผู้รับสิทธิ์ (ตัวเอง / ค้นรายชื่อ / กรอกเอง) · มีให้เลือกมากกว่า 1 อย่างเท่านั้นจึงแสดง (พนักงานทั่วไปได้แค่ตัวเอง)
  function modeBox({ role, values }) {
    const modes = model.subjectModes(role, values.type);
    return modes.length > 1 ? choiceGroup({ name: "subject_mode", field: "subject_mode", legend: "ผู้รับสิทธิ์", options: modes, value: values.mode || "self" }) : "";
  }
  // ฟอร์มช่วงที่ 1 · values = ค่าตั้งต้น/ที่กรอกไว้ · modes = model.subjectModes(role, type) (เปลี่ยนตามประเภท วาดใหม่ทั้งก้อนที่ module-itar.js)
  function chooserForm({ role, values, search, departments = [] }) {
    return `<section class="card form-card" id="itar-form-card"><div id="itar-message" role="status"></div>
      <form id="itar-chooser" class="itar-chooser" novalidate>
        <h2 class="itar-step-title">1. เลือกประเภทและผู้รับสิทธิ์</h2>
        ${choiceGroup({ name: "request_type", field: "request_type", legend: "ประเภทคำขอ", options: model.REQUEST_TYPES, value: values.type, required: true, withHint: true })}
        <div id="itar-mode-box">${modeBox({ role, values })}</div>
        <div id="itar-subject-body">${subjectBody({ role, values, search, departments })}</div>
        <div class="form-actions"><a class="btn secondary" href="${esc(model.accessUrl("mine"))}" data-form-cancel>ยกเลิก</a><button type="submit" class="btn is-primary" id="itar-next">ต่อไป · เลือกสิทธิ์ ›</button></div>
      </form></section>`;
  }

  /* ---------- ฟอร์มยื่นช่วงที่ 2: ติ๊กสิทธิ์ ---------- */
  // ช่องเลือกไฟล์: ปุ่มเดียวกับฟอร์มอื่นของ Pilot · modules/attachment-image.js ดักช่องไฟล์ทุกช่องทั้งหน้า · attachment-preview.js วาดรายการไฟล์ที่เลือกใต้ช่อง
  const fileField = ({ id, field, label = "ไฟล์แนบ", hidden = false }) => `<div class="field itar-file-field" data-field="${esc(field)}" id="${esc(id)}-field"${hidden ? " hidden" : ""}>
        <span class="field-label">${esc(label)}</span>
        <label class="btn secondary file-pick" for="${esc(id)}" title="${esc(model.FILE_HINT)}">${iconOf("camera")} ถ่ายรูป / เลือกไฟล์</label>
        <input class="file-pick-input" id="${esc(id)}" name="${esc(id)}" type="file" multiple data-attachment-limit="per-file" accept="${esc(model.FILE_ACCEPT)}">
        <small>${esc(model.FILE_HINT)}</small>
      </div>`;

  const subjectLine = (ctx) => {
    const subject = ctx.subject ?? {};
    return [model.subjectName(subject), subject.department_name, subject.division ? `ฝ่าย${model.divisionLabel(subject.division)}` : ""].filter(Boolean).join(" · ");
  };
  // สรุปสิทธิ์ที่มีอยู่ (ใบยกเลิกทั้งหมด / หลังบันทึก) เป็นรายการสั้น ๆ · summary = model.rightsSummary
  function rightsList(summary, { empty = "ไม่มีสิทธิ์ใดในทะเบียน" } = {}) {
    if (!summary) return "";
    const parts = [];
    if (summary.folders.length) parts.push(`<div class="itar-rights-group"><h4>โฟลเดอร์ <span class="detail-section-count">${summary.folders.length}</span></h4><ul class="itar-rights-list">${summary.folders.map((row) => `<li><strong>${esc(row.code)}</strong> ${esc(row.name)} <span class="badge itar-level is-${esc(row.level)}">${esc(row.level)}</span></li>`).join("")}</ul></div>`);
    parts.push(`<div class="itar-rights-group"><h4>อินเทอร์เน็ต</h4><p>${summary.internet ? "มีสิทธิ์" : "ไม่มี"}</p></div>`);
    if (summary.programs.length) parts.push(`<div class="itar-rights-group"><h4>โปรแกรม <span class="detail-section-count">${summary.programs.length}</span></h4><ul class="itar-rights-list">${summary.programs.map((row) => `<li>${esc(row.name)}${row.note ? ` <span class="muted small">· ${esc(row.note)}</span>` : ""}</li>`).join("")}</ul></div>`);
    if (summary.emails.length) parts.push(`<div class="itar-rights-group"><h4>อีเมล <span class="detail-section-count">${summary.emails.length}</span></h4><ul class="itar-rights-list">${summary.emails.map((row) => `<li>${esc(row.address)} <span class="muted small">· ${esc(row.kindLabel)}</span></li>`).join("")}</ul></div>`);
    const none = !summary.folders.length && !summary.programs.length && !summary.emails.length && !summary.internet;
    return none ? `<p class="muted small">${esc(empty)}</p>` : `<div class="itar-rights">${parts.join("")}</div>`;
  }

  // แถวโฟลเดอร์ · ผูกทะเบียนแล้ว: ค่าเริ่มต้นคือสิทธิ์ปัจจุบัน (ต่างจากเดิม = รายการที่ขอ ไฮไลต์แถว)
  function folderRow(row, value) {
    return `<div class="itar-right-row${value !== row.initial ? " is-changed" : ""}" data-row="folder:${esc(row.code)}">
        <label class="itar-right-name" for="itar-folder-${esc(row.code)}"><strong>${esc(row.code)}</strong> ${esc(row.name)}${row.active ? "" : ' <span class="badge cancelled">ปิดใช้งานแล้ว</span>'}${row.description ? `<small class="muted">${esc(row.description)}</small>` : ""}</label>
        <select class="select itar-right-select" id="itar-folder-${esc(row.code)}" name="folder:${esc(row.code)}" data-folder="${esc(row.code)}" data-initial="${esc(row.initial)}">${selectOptions(row.options, value)}</select>
      </div>`;
  }
  function boolRow({ id, name, label, dataAttr, row, value, noteField = "" }) {
    return `<div class="itar-right-row${value !== row.initial ? " is-changed" : ""}" data-row="${esc(name)}">
        <label class="itar-right-name" for="${esc(id)}">${label}</label>
        <select class="select itar-right-select" id="${esc(id)}" name="${esc(name)}" ${dataAttr} data-initial="${esc(row.initial)}">${selectOptions(row.options, value)}</select>
        ${noteField}
      </div>`;
  }
  const emailAddRow = (index, row, kinds) => `<li class="itar-email-add" data-email-row="${index}">
      <input class="input" name="email_address" type="email" inputmode="email" maxlength="${model.MAX_EMAIL}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="name@company.com" aria-label="ที่อยู่อีเมลที่ขอ แถวที่ ${index + 1}" value="${esc(row.address)}">
      <select class="select" name="email_kind" aria-label="ชนิดอีเมล แถวที่ ${index + 1}">${selectOptions(kinds, row.kind)}</select>
      <button type="button" class="btn secondary small" data-email-remove="${index}" aria-label="ลบแถวที่ ${index + 1}">ลบ</button>
    </li>`;
  const emailAddRows = (adds, kinds) => adds.map((row, index) => emailAddRow(index, row, kinds)).join("");

  // ฟอร์มช่วงที่ 2 · ctx = model.normalizeContext · choices = model.initialChoices (หรือที่กู้) · reasonText = ค่าที่กรอกแล้ว
  function rightsForm({ ctx, choices, reasonText = "" }) {
    const type = ctx.type;
    const typeLabel = model.requestTypeLabel(type);
    const summary = model.rightsSummary(ctx.rights);
    const linked = ctx.linked;
    const head = `<div class="itar-subject-box"><div><span class="muted small">ผู้รับสิทธิ์</span><strong>${esc(subjectLine(ctx))}</strong><span class="badge itar-type-tag">${esc(typeLabel)}</span></div><button type="button" class="btn secondary small" id="itar-change-subject">‹ เปลี่ยนประเภท/ผู้รับสิทธิ์</button></div>`;
    let body;
    if (type === "revoke_all") {
      body = `<section class="itar-section"><h2 class="itar-step-title">2. ยืนยันการยกเลิกสิทธิ์ทั้งหมด</h2>
          <p class="rf-callout is-warn" role="status">${esc(model.revokeText(summary))}</p>
          ${summary ? `<details class="itar-current"><summary>ดูสิทธิ์ปัจจุบันของผู้ใช้</summary>${rightsList(summary)}</details>` : '<p class="muted small">ผู้รับสิทธิ์ยังไม่ผูกกับทะเบียน IT จะเลือกผู้ใช้ในทะเบียนตอนบันทึก</p>'}
        </section>`;
    } else {
      const changeLinked = type === "change" && linked;
      const intro = changeLinked
        ? "ช่องแสดงสิทธิ์ปัจจุบันของผู้ใช้ (เขียนว่า \"ปัจจุบัน\") เปลี่ยนเฉพาะที่ต้องการ รายการที่ไม่เปลี่ยนไม่ต้องแตะ"
        : type === "new"
          ? "ผู้ใช้ใหม่ยังไม่มีสิทธิ์ใดในทะเบียน เลือกเฉพาะสิทธิ์ที่ต้องการ"
          : "ผู้รับสิทธิ์ยังไม่ผูกกับทะเบียนสิทธิ์ ระบบจึงไม่ทราบสิทธิ์ปัจจุบัน เลือกเฉพาะสิ่งที่ต้องการเปลี่ยน แล้ว IT จะตรวจกับทะเบียนตอนบันทึก";
      const folders = model.folderRows(ctx).map((row) => folderRow(row, choices.folders?.[row.code] ?? row.initial)).join("");
      const internet = model.internetRow(ctx);
      const internetValue = choices.internet ?? internet.initial;
      const programs = model.programRows(ctx).map((row) => boolRow({
        id: `itar-program-${row.code}`, name: `program:${row.code}`, label: esc(row.name), dataAttr: `data-program="${esc(row.code)}"`, row, value: choices.programs?.[row.code] ?? row.initial,
        noteField: row.isOther ? `<div class="field itar-note-field" data-field="program_note" data-note-for="program:${esc(row.code)}"${(choices.programs?.[row.code] ?? row.initial) === "yes" && (choices.programs?.[row.code] ?? row.initial) !== row.initial ? "" : " hidden"}><label for="itar-program-note-${esc(row.code)}">ระบุชื่อโปรแกรม ${REQUIRED}</label><input class="input" id="itar-program-note-${esc(row.code)}" name="program_note_${esc(row.code)}" data-program-note="${esc(row.code)}" maxlength="${model.MAX_NOTE}" autocomplete="off" value="${esc(choices.programNotes?.[row.code])}"></div>` : "",
      })).join("");
      const closes = model.currentEmails(ctx);
      const kinds = model.emailKindOptions(ctx);
      body = `<section class="itar-section"><h2 class="itar-step-title">2. เลือกสิทธิ์ที่ต้องการ</h2>
          <p class="muted small">${esc(intro)}</p>
          ${changeLinked && summary ? `<p class="muted small">สถานะผู้ใช้ในทะเบียน: ${summary.status === "active" ? "ใช้งานอยู่" : esc(summary.status ?? "—")}</p>` : ""}
          <fieldset class="itar-fieldset"><legend>โฟลเดอร์แชร์</legend>
            <p class="muted small">${esc(model.LEVEL_HELP)}</p>
            <div class="itar-right-list" id="itar-folders">${folders || '<p class="muted small">ไม่มีโฟลเดอร์ให้เลือก</p>'}</div>
          </fieldset>
          <fieldset class="itar-fieldset"><legend>อินเทอร์เน็ต</legend>
            ${boolRow({
    id: "itar-internet", name: "internet", label: "ใช้อินเทอร์เน็ต", dataAttr: 'data-internet="1"', row: internet, value: internetValue,
    noteField: `<div class="field itar-note-field" data-field="internet_note" data-note-for="internet"${internetValue === "yes" && internetValue !== internet.initial ? "" : " hidden"}><label for="itar-internet-note">เหตุผลที่ขอใช้อินเทอร์เน็ต ${REQUIRED}</label><input class="input" id="itar-internet-note" name="internet_note" maxlength="${model.MAX_NOTE}" autocomplete="off" value="${esc(choices.internetNote)}"></div>`,
  })}
          </fieldset>
          <fieldset class="itar-fieldset"><legend>โปรแกรม</legend><div class="itar-right-list" id="itar-programs">${programs || '<p class="muted small">ไม่มีโปรแกรมให้เลือก</p>'}</div></fieldset>
          <fieldset class="itar-fieldset" data-field="email_add"><legend>อีเมล</legend>
            ${closes.length ? `<div class="itar-email-closes"><span class="muted small">อีเมลที่ใช้งานอยู่ (ติ๊กถ้าต้องการปิด)</span>${closes.map((email, index) => `<label class="itar-choice"><input type="checkbox" name="email_close" value="${esc(email.address)}" data-email-close="${index}"${(choices.emailCloses ?? []).includes(email.address) ? " checked" : ""}> <span>ปิด ${esc(email.address)} <small class="muted">${esc(model.emailKindLabel(email.kind))}</small></span></label>`).join("")}</div>` : ""}
            <span class="muted small">ขออีเมลใหม่ (พิมพ์ที่อยู่ที่ต้องการ)</span>
            <ul class="itar-email-adds" id="itar-email-adds">${emailAddRows(choices.emailAdds ?? [], kinds)}</ul>
            <button type="button" class="btn secondary small" id="itar-email-add">+ ขออีเมลใหม่</button>
          </fieldset>
          <div class="field" data-field="items"></div>
        </section>`;
    }
    return `<section class="card form-card" id="itar-form-card"><div id="itar-message" role="status"></div>
      <form id="itar-form" class="itar-form" novalidate>
        ${head}
        ${body}
        <section class="itar-section"><h2 class="itar-step-title">3. เหตุผลและไฟล์แนบ</h2>
          <div class="field" data-field="reason"><label for="itar-reason">เหตุผลที่ขอ ${REQUIRED}</label><textarea class="textarea" id="itar-reason" name="reason" rows="4" maxlength="${model.MAX_REQUEST_REASON}">${esc(reasonText)}</textarea><small>บอกให้ชัดว่าทำไมต้องใช้สิทธิ์นี้ (ไม่เกิน ${model.MAX_REQUEST_REASON.toLocaleString("en-US")} ตัวอักษร) ผู้อนุมัติและ IT จะได้ไม่ต้องถามซ้ำ</small></div>
          ${fileField({ id: "itar-files", field: "attachment_files", label: "แนบไฟล์ประกอบ (ถ้ามี)" })}
        </section>
        ${type === "revoke_all" ? "" : '<section class="itar-section"><h2 class="itar-step-title">สรุปรายการที่ขอ</h2><div id="itar-preview" aria-live="polite"></div></section>'}
        <div class="form-actions"><a class="btn secondary" href="${esc(model.accessUrl("mine"))}" data-form-cancel>ยกเลิก</a><button type="submit" class="btn is-primary" data-step-submit>ส่งใบขอสิทธิ์</button></div>
      </form></section>`;
  }
  // ตารางสรุปรายการที่กำลังจะส่ง (แถวจาก model.previewRows) · ไม่มีรายการ = ข้อความเชิญชวน
  function previewTable(rows) {
    if (!rows.length) return '<p class="muted small">ยังไม่ได้เลือกสิทธิ์ที่ต้องการเปลี่ยน</p>';
    return changeTable(rows, { showResult: false });
  }

  /* ---------- ความคืบหน้าอัปโหลดไฟล์ (หลังสร้างใบ / ถาม-ตอบ) ---------- */
  const UPLOAD_STATE_TEXT = Object.freeze({ done: "แนบแล้ว", working: "กำลังแนบ…", waiting: "รอคิว", failed: "แนบไม่สำเร็จ" });
  function uploadPanel({ heading, intro = "", rows, busy = false, continueLabel = "ไปที่ใบขอสิทธิ์" }) {
    const done = rows.filter((row) => row.state === "done").length;
    const failed = rows.filter((row) => row.state === "failed").length;
    const summary = busy
      ? `กำลังแนบไฟล์ ${Math.min(done + 1, rows.length)} จาก ${rows.length}`
      : failed ? `แนบไม่สำเร็จ ${failed} จาก ${rows.length} ไฟล์ (แนบแล้ว ${done})` : `แนบครบ ${done} ไฟล์`;
    const items = rows.map((row) => `<li class="itar-upload-row is-${esc(row.state)}"><span class="itar-upload-name" title="${esc(row.name)}">${esc(row.name)} <span class="muted small">${esc(model.formatFileSize(row.size))}</span></span><span class="itar-upload-state">${esc(UPLOAD_STATE_TEXT[row.state] ?? "")}</span>${row.message ? `<span class="itar-upload-message">${esc(row.message)}</span>` : ""}</li>`).join("");
    return `<section class="itar-upload" aria-labelledby="itar-upload-title"${busy ? ' aria-busy="true"' : ""}>
        <h2 id="itar-upload-title">${esc(heading)}</h2>
        ${intro ? `<p class="muted small">${esc(intro)}</p>` : ""}
        <p class="itar-upload-summary" role="status">${esc(summary)}</p>
        <ul class="itar-upload-list">${items}</ul>
        ${busy ? "" : `<div class="form-actions">${failed ? '<button type="button" class="btn is-primary" id="itar-upload-retry">ลองแนบไฟล์ที่ไม่สำเร็จอีกครั้ง</button>' : ""}<button type="button" class="btn secondary" id="itar-upload-continue">${esc(continueLabel)}</button></div>`}
      </section>`;
  }

  /* ---------- หน้ารายละเอียด ---------- */
  const fact = (label, value, wide = false) => `<div class="definition${wide ? " wide" : ""}"><dt>${esc(label)}</dt><dd${wide ? ' class="itar-text"' : ""}>${value}</dd></div>`;

  function detailHead(detail, back = { href: model.accessUrl("mine"), label: "‹ ใบขอสิทธิ์" }) {
    const summary = model.approvalSummary(detail);
    const waiting = !["cancelled", "rejected", "done"].includes(detail.status);
    // ขั้นอนุมัติบอกเฉพาะที่ยังไม่เสร็จ (ผู้อนุมัติ/เวลาของขั้นที่เสร็จแล้วอยู่ในประวัติเอกสารแล้ว) · หลังอนุมัติครบไม่ต้องบอกอีก
    const pending = waiting && ["pending_dept", "pending_it_mgr", "need_info"].includes(detail.status) ? summary.filter((step) => step.state === "waiting").map((step) => step.label) : [];
    const meta = [`ยื่นโดย ${detail.requester?.full_name ?? "—"}`, detail.department?.name_th, `ยื่นเมื่อ ${model.formatDateTime(detail.created_at)}`].filter(Boolean).join(" · ");
    return `<a class="request-back-link" href="${esc(back.href)}">${esc(back.label)}</a>
      <header class="request-detail-head request-module-header itar-detail-head" data-module="${PALETTE}">
        <div class="request-detail-kicker">
          <span class="eyebrow"><span class="nowrap">${esc(FORM_TITLE)} · ${esc(model.requestTypeLabel(detail.request_type))}</span></span>
          <div class="request-detail-kicker-end">${statusBadge(detail.status)}${testTag(detail.is_test || model.isTestDoc(detail.doc_no))}</div>
        </div>
        <h1>${esc(detail.doc_no)}</h1>
        <p class="request-detail-meta">${esc(meta)}</p>
        ${pending.length ? `<p class="request-detail-meta itar-pending-steps">ยังไม่ได้อนุมัติ: ${esc(pending.join(" · "))}</p>` : ""}
      </header>`;
  }

  // ปุ่มการกระทำตาม allowed_actions (ทุกปุ่มมีกล่องยืนยันที่ module-itar.js · "ถามผู้ยื่น" เปิดฟอร์มของตัวเองแทนกล่องยืนยัน) · ไม่มีปุ่มก็ไม่แสดงการ์ด
  // inline = ปุ่มที่ฟอร์มของมันวาดเปิดไว้ในหน้าอยู่แล้ว (ตอบคำถาม) ไม่ซ้ำเป็นปุ่ม
  function actionsCard(allButtons) {
    const buttons = allButtons.filter((button) => !button.inline);
    if (!buttons.length) return "";
    return `<section class="card detail-actions itar-actions" aria-labelledby="itar-actions-title">
      <h2 id="itar-actions-title">สิ่งที่คุณทำได้กับใบนี้</h2>
      <div class="action-panel-buttons">${buttons.map((button) => {
        const tone = button.tone === "danger" ? " danger" : button.tone === "success" ? " success" : button.tone === "secondary" ? " secondary" : "";
        return `<button type="button" class="btn${tone}" data-itar-action="${esc(button.action)}">${esc(button.label)}</button>`;
      }).join("")}</div>
      <div class="form-message error" id="itar-action-error" role="alert" hidden></div>
    </section>`;
  }
  /* ---------- รับทราบสิทธิ์ (ผู้รับสิทธิ์ที่มีบัญชี) ---------- */
  // เอกสารชี้แจงสิทธิ์ในหน้า: สิทธิ์ทั้งหมดหลังเปลี่ยน + ข้อความนโยบาย + ปุ่มรับทราบ (วาดเมื่อ allowed_actions มี acknowledge)
  function ackCard(detail) {
    const summary = model.rightsSummary(model.rightsAfter(detail));
    const policy = model.policyOf(detail);
    const button = model.ACTION_BUTTONS.acknowledge;
    return `<section class="card itar-ack-card" id="itar-ack-card" aria-labelledby="itar-ack-title">
      <h2 id="itar-ack-title">เอกสารชี้แจงสิทธิ์ของคุณ</h2>
      <p class="muted small">IT บันทึกสิทธิ์ของคุณตามใบนี้แล้ว กรุณาตรวจสิทธิ์ทั้งหมดด้านล่าง ถ้าไม่ถูกต้องให้แจ้ง IT ก่อนกดรับทราบ</p>
      ${summary ? rightsList(summary, { empty: "ไม่มีสิทธิ์ใดในทะเบียน" }) : '<p class="muted small">ไม่พบข้อมูลสิทธิ์ของคุณ กรุณาติดต่อ IT ก่อนกดรับทราบ</p>'}
      <blockquote class="itar-policy"><p class="itar-text">${esc(policy.text)}</p>${policy.version ? `<small class="muted">นโยบายเวอร์ชัน ${esc(policy.version)}</small>` : ""}</blockquote>
      <div class="form-actions"><button type="button" class="btn success" id="itar-ack-button">${esc(button.label)}</button></div>
    </section>`;
  }

  /* ---------- รับทราบด้วยกระดาษ (IT: ผู้รับสิทธิ์ไม่มีบัญชีหรือบัญชีถูกปิดแล้ว) ---------- */
  // ขั้นตอน: พิมพ์เอกสารชี้แจงสิทธิ์ให้ผู้ใช้เซ็น → แนบรูป/ไฟล์ใบที่เซ็นแล้วอย่างน้อย 1 ไฟล์ → กด "รับทราบแล้ว (กระดาษ)" · ปุ่มรับทราบกดไม่ได้จนกว่าจะมีรูปที่แนบแล้ว
  function paperCard(detail) {
    const count = model.paperFileCount(detail);
    const canAttach = model.hasAction(detail, "add_paper_attachment");
    const canAck = model.hasAction(detail, "acknowledge_paper");
    const button = model.ACTION_BUTTONS.acknowledge_paper;
    return `<section class="card itar-paper-card" id="itar-paper-card" aria-labelledby="itar-paper-title">
      <h2 id="itar-paper-title">รับทราบด้วยกระดาษ</h2>
      <p class="muted small">ผู้รับสิทธิ์ไม่มีบัญชีใช้งานในระบบ จึงรับทราบด้วยกระดาษ: (1) พิมพ์เอกสารชี้แจงสิทธิ์ให้ผู้ใช้เซ็น (2) แนบรูปหรือไฟล์ใบที่เซ็นแล้วอย่างน้อย 1 ไฟล์ (3) กด "${esc(button.label)}"</p>
      <div class="action-panel-buttons"><a class="btn secondary" id="itar-paper-print" href="${esc(model.printUrl(detail.id, "page"))}">${esc(model.PRINT_FORM_LABELS.page)}</a></div>
      <div id="itar-paper-message" role="status"></div>
      ${canAttach ? `<form id="itar-paper-form" novalidate>
        ${fileField({ id: "itar-paper-files", field: "paper_files", label: "รูปหรือไฟล์ใบที่เซ็นแล้ว" })}
        <p class="muted small" id="itar-paper-count">${count ? `แนบแล้ว ${count} ไฟล์ (ดูที่การ์ด "รูปใบรับทราบที่เซ็นแล้ว")` : "ยังไม่ได้แนบรูปใบที่เซ็น"}</p>
        <div class="form-actions"><button type="submit" class="btn secondary" id="itar-paper-upload">แนบรูปใบที่เซ็นแล้ว</button></div>
      </form>` : ""}
      ${canAck ? `<div class="field" data-field="paper_note"><label for="itar-paper-note">หมายเหตุ (ไม่บังคับ)</label><input class="input" id="itar-paper-note" name="paper_note" maxlength="${model.MAX_PAPER_NOTE}" autocomplete="off"></div>
      <div class="form-actions"><button type="button" class="btn success" id="itar-paper-ack"${count ? "" : " disabled"}>${esc(button.label)}</button></div>` : ""}
    </section>`;
  }

  // พิมพ์: ใบคำร้องพิมพ์ได้เสมอ · เอกสารชี้แจงสิทธิ์พิมพ์ได้หลัง IT บันทึกลงทะเบียน (ใบยกเลิกทั้งหมดไม่มี)
  function printCard(detail) {
    return `<section class="card itar-print-card" aria-labelledby="itar-print-title"><h2 id="itar-print-title">เอกสาร</h2><div class="action-panel-buttons">${model.printForms(detail).map((form) => `<a class="btn secondary" id="itar-print-${form}" href="${esc(model.printUrl(detail.id, form))}">${esc(model.PRINT_FORM_LABELS[form])}</a>`).join("")}</div></section>`;
  }

  /* ---------- ไฟล์แนบ ---------- */
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
  // กระเบื้องแบบเดียวกับ attachmentGalleryHtml ของ app.js (สไตล์ + การเติมตัวอย่าง/ลิงก์ดาวน์โหลด/กล่องดูไฟล์ใช้ของเดิม) ต่างที่ไฟล์ของใบขอสิทธิ์ไม่มีภาพย่อ
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
  // #attachment-gallery (app.js: hydrateAttachmentGallery / กล่องดูไฟล์ หา id นี้) อยู่ที่คอลัมน์หลักของ detailPage ตัวเดียว ครอบทั้งไฟล์ตอนยื่น ไฟล์ของข้อความถาม-ตอบ และรูปใบรับทราบ
  function filesCard(detail) {
    const initial = Array.isArray(detail.attachments) ? detail.attachments : [];
    const paper = Array.isArray(detail.paper_attachments) ? detail.paper_attachments : [];
    if (!initial.length && !paper.length) return "";
    return `<div class="stack">
      ${initial.length ? `<section class="card itar-files" aria-labelledby="itar-files-title"><h2 id="itar-files-title">ไฟล์แนบ <span class="detail-section-count">${initial.length}</span></h2>${fileGrid(initial)}</section>` : ""}
      ${paper.length ? `<section class="card itar-files" aria-labelledby="itar-paper-title"><h2 id="itar-paper-title">รูปใบรับทราบที่เซ็นแล้ว <span class="detail-section-count">${paper.length}</span></h2>${fileGrid(paper)}</section>` : ""}
    </div>`;
  }

  /* ---------- ตาราง ก่อน → หลัง ---------- */
  // rows = model.itemRows / previewRows · showResult = มีคอลัมน์ผลที่ IT ตัดสิน (หลังบันทึกลงทะเบียน)
  function changeTable(rows, { showResult = true } = {}) {
    const hasResult = showResult && rows.some((row) => row.result);
    return `<div class="table-wrap"><table class="itar-table"><thead><tr><th scope="col">ลำดับ</th><th scope="col">รายการ</th><th scope="col">ก่อน</th><th scope="col">หลัง</th>${hasResult ? '<th scope="col">ผลที่ IT บันทึก</th>' : ""}</tr></thead><tbody>${rows.map((row) => `<tr${row.result?.decision === "rejected" ? ' class="is-rejected"' : ""}>
        <td data-label="ลำดับ">${esc(row.no)}</td>
        <td data-label="รายการ">${esc(row.label)}${row.note ? `<small class="muted itar-text">เหตุผล: ${esc(row.note)}</small>` : ""}</td>
        <td data-label="ก่อน">${esc(row.before)}</td>
        <td data-label="หลัง"><strong>${esc(row.after)}</strong></td>
        ${hasResult ? `<td data-label="ผลที่ IT บันทึก">${row.result ? `<span class="badge ${row.result.decision === "applied" ? "completed" : "rejected"}">${esc(row.result.label)}</span>${row.result.reason ? `<small class="muted itar-text">${esc(row.result.reason)}</small>` : ""}` : "—"}</td>` : ""}
      </tr>`).join("")}</tbody></table></div>`;
  }
  // การ์ด "รายการสิทธิ์ที่ขอ": ขอใหม่/เปลี่ยนแปลง = ตาราง ก่อน → หลัง · ยกเลิกทั้งหมด = "จะถอดสิทธิ์ทั้งหมด" พร้อมสิทธิ์ที่มี (ก่อนบันทึก: จากทะเบียนปัจจุบัน · หลังบันทึก: จากสิทธิ์ก่อนถอดที่ระบบเก็บไว้)
  function itemsCard(detail) {
    if (detail.request_type === "revoke_all") {
      const before = detail.applied_summary?.before ?? detail.subject_rights ?? null;
      const summary = model.rightsSummary(before);
      const applied = Boolean(detail.applied_summary);
      return `<section class="card itar-items" aria-labelledby="itar-items-title"><h2 id="itar-items-title">${applied ? "สิทธิ์ที่ถอดแล้ว" : "สิทธิ์ที่จะถูกถอด"}</h2>
        <p class="rf-callout is-warn" role="status">${esc(applied ? model.revokeText(summary).replace("จะถอด", "ถอด") : model.revokeText(summary))}</p>
        ${summary ? rightsList(summary) : '<p class="muted small">ผู้รับสิทธิ์ยังไม่ผูกกับทะเบียน IT จะเลือกผู้ใช้ในทะเบียนตอนบันทึก</p>'}
      </section>`;
    }
    const rows = model.itemRows(detail);
    return `<section class="card itar-items" aria-labelledby="itar-items-title"><h2 id="itar-items-title">รายการสิทธิ์ที่ขอ (ก่อน → หลัง) <span class="detail-section-count">${rows.length}</span></h2>
      ${rows.length ? changeTable(rows) : '<p class="muted small">ไม่มีรายการ</p>'}
      ${rows.some((row) => row.before === model.UNKNOWN_BEFORE) ? '<p class="muted small">ผู้รับสิทธิ์ยังไม่ผูกกับทะเบียนสิทธิ์ ระบบจึงไม่ทราบสิทธิ์เดิม IT จะตรวจกับทะเบียนตอนบันทึก</p>' : ""}
    </section>`;
  }
  // สิทธิ์หลังบันทึกลงทะเบียน (จาก applied_summary.after) · ยังไม่บันทึก = ไม่มี
  function afterCard(detail) {
    const summary = model.rightsSummary(detail.applied_summary?.after ?? null);
    if (!summary || detail.request_type === "revoke_all") return "";
    const applied = Number(detail.applied_summary?.applied_count) || 0;
    const rejected = Number(detail.applied_summary?.rejected_count) || 0;
    return `<section class="card itar-after" aria-labelledby="itar-after-title"><h2 id="itar-after-title">สิทธิ์ทั้งหมดของผู้ใช้หลังบันทึกลงทะเบียน</h2>
      <p class="muted small">IT บันทึก ${applied} รายการ${rejected ? ` · ไม่บันทึก ${rejected} รายการ` : ""}</p>
      ${rightsList(summary)}
    </section>`;
  }

  /* ---------- ถาม-ตอบ ---------- */
  // ฟอร์มถามผู้ยื่น (ผู้อนุมัติของขั้นที่ใบรออยู่ / IT) ซ่อนไว้จนกดปุ่ม "ถามผู้ยื่น" · ข้อความ (บังคับ) + ไฟล์ (ไม่บังคับ)
  function askFormCard() {
    return `<section class="card itar-ask-card" id="itar-ask-card" aria-labelledby="itar-ask-title" hidden>
      <h2 id="itar-ask-title">ถามผู้ยื่น</h2>
      <p class="muted small">ใบจะเปลี่ยนเป็น รอผู้ยื่นตอบ จนกว่าผู้ยื่นจะตอบ ผู้ยื่นเห็นคำถามนี้และแนบไฟล์ตอบได้</p>
      <div id="itar-ask-message" role="status"></div>
      <form id="itar-ask-form" novalidate>
        <div class="field" data-field="body"><label for="itar-ask-body">ข้อความที่ต้องการถาม ${REQUIRED}</label><textarea class="textarea" id="itar-ask-body" name="body" rows="4" maxlength="${model.MAX_INFO_BODY}"></textarea></div>
        ${fileField({ id: "itar-ask-files", field: "ask_files", label: "แนบไฟล์ (ถ้ามี)" })}
        <div class="form-actions"><button type="button" class="btn secondary" id="itar-ask-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ส่งคำถาม</button></div>
      </form>
    </section>`;
  }
  // คำถามที่รอผู้ยื่นตอบ (เห็นเด่นที่ผู้ยื่น) + ฟอร์มตอบที่เปิดไว้ · ตอบแล้วใบกลับสถานะเดิมก่อนถาม · pending = model.pendingQuestion(detail)
  function answerCard(pending) {
    return `<section class="card itar-answer-card" id="itar-answer-card" aria-labelledby="itar-answer-title">
      <h2 id="itar-answer-title">${esc(pending.stageLabel)} ถามคุณ</h2>
      <article class="itar-question" data-comment="${esc(pending.commentId)}">
        <p class="muted small">โดย ${esc(pending.askedBy)} · ${esc(model.formatDateTime(pending.askedAt))}</p>
        <p class="itar-text">${esc(pending.body)}</p>
        ${pending.files.length ? fileGrid(pending.files) : ""}
      </article>
      <div id="itar-answer-message" role="status"></div>
      <form id="itar-answer-form" novalidate>
        <div class="field" data-field="body"><label for="itar-answer-body">คำตอบของคุณ ${REQUIRED}</label><textarea class="textarea" id="itar-answer-body" name="body" rows="4" maxlength="${model.MAX_INFO_BODY}"></textarea>${pending.returnLabel ? `<small>ตอบแล้วใบจะกลับไปที่ ${esc(pending.returnLabel)}</small>` : ""}</div>
        ${fileField({ id: "itar-answer-files", field: "answer_files", label: "แนบไฟล์ (ถ้ามี)" })}
        <div class="form-actions"><button type="submit" class="btn is-primary">ส่งคำตอบ</button></div>
      </form>
    </section>`;
  }
  // ถาม-ตอบทุกข้อความตามลำดับ · hideId = ข้อความที่แสดงที่ฟอร์มตอบอยู่แล้ว (ไม่ซ้ำ) · ไม่มีข้อความ = ไม่วาด
  function commentsCard(rows, { pendingId = null, hideId = null } = {}) {
    const shown = rows.filter((row) => hideId === null || String(row.id) !== String(hideId));
    if (!shown.length) return "";
    return `<section class="card itar-comments" id="itar-comments" aria-labelledby="itar-comments-title"><h2 id="itar-comments-title">ถาม-ตอบ <span class="detail-section-count">${shown.length}</span></h2>
      ${shown.map((row) => `<article class="itar-comment is-${esc(row.kind)}" data-comment="${esc(row.id)}">
        <h3><span class="itar-comment-kind">${esc(row.kindLabel)}</span> · ${esc(row.stageLabel)}${pendingId !== null && String(row.id) === String(pendingId) ? ` <span class="badge more_info">ยังไม่ตอบ</span>` : ""}</h3>
        <p class="muted small">โดย ${esc(row.by)} · <time datetime="${esc(row.at)}">${esc(model.formatDateTime(row.at))}</time></p>
        <p class="itar-text">${esc(row.body)}</p>
        ${row.files.length ? fileGrid(row.files) : ""}
      </article>`).join("")}
    </section>`;
  }
  function historyCard(events, requester) {
    const items = events.map((event) => `<div class="timeline-item"><strong>${esc(model.eventLabelFor(event, requester))}</strong><p class="timeline-item-detail">โดย ${esc(event.actor_full_name)}</p>${event.reason ? `<p class="timeline-item-message">${esc(event.reason)}</p>` : ""}<time class="timeline-item-time" datetime="${esc(event.created_at)}">${esc(model.formatDateTime(event.created_at))}</time></div>`).join("");
    return `<section class="card detail-history" aria-labelledby="detail-history-title"><h2 id="detail-history-title">ประวัติเอกสาร</h2><div class="timeline">${items || '<div class="muted small">ยังไม่มีประวัติ</div>'}</div></section>`;
  }

  // ข้อมูลทั่วไปของใบ: ประเภท · ผู้รับสิทธิ์ (ชื่อไทย/อังกฤษ แผนก ฝ่าย มีบัญชีหรือไม่) · ผู้ยื่น · เหตุผล
  function factsCard(detail) {
    const subject = detail.subject ?? {};
    const other = model.filedForOther(detail);
    return `<section class="card itar-facts" aria-labelledby="itar-facts-title"><h2 id="itar-facts-title">ข้อมูลใบขอสิทธิ์</h2>
      <dl class="definition-grid">
        ${fact("ประเภทคำขอ", esc(model.requestTypeLabel(detail.request_type)))}
        ${fact("ผู้รับสิทธิ์", esc(model.subjectName(subject)))}
        ${fact("แผนกของผู้รับสิทธิ์", esc(subject.department_code ?? "—"))}
        ${fact("ฝ่าย", esc(subject.division ? model.divisionLabel(subject.division) : "—"))}
        ${fact("ผู้ยื่น", `${esc(detail.requester?.full_name ?? "—")}${other ? ' <span class="badge itar-type-tag">ยื่นแทน</span>' : ""}`)}
        ${fact("บัญชีในระบบ", subject.has_account ? "มี (รับทราบสิทธิ์ในระบบเอง)" : "ไม่มี (รับทราบด้วยกระดาษ)")}
        ${fact("เหตุผลที่ขอ", esc(detail.reason), true)}
      </dl></section>`;
  }

  // ใบทั้งใบ · ปุ่มซ่อนตาม allowed_actions อยู่แล้ว (ฟอร์มถามวาดเฉพาะผู้ที่มีปุ่มนั้น)
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
          ${has("acknowledge") ? ackCard(detail) : ""}
          ${has("acknowledge_paper") || has("add_paper_attachment") ? paperCard(detail) : ""}
          ${actionsCard(buttons)}
          ${has("request_info") ? askFormCard() : ""}
          ${factsCard(detail)}
          ${itemsCard(detail)}
          ${afterCard(detail)}
          ${commentsCard(comments, { pendingId: detail.info_pending?.comment_id ?? null, hideId: pending ? pending.commentId : null })}
          ${filesCard(detail)}
        </div>
        <aside class="stack">
          ${printCard(detail)}
          ${historyCard(detail.events ?? [], detail.requester)}
        </aside>
      </div>`);
  }

  /* ---------- หน้า "ปรับสิทธิ์ตามใบ" (IT) ---------- */
  // ตัวเลือกผู้ใช้ในทะเบียน (ปุ่มวิทยุ) · ผู้ใช้ที่ลาออกแล้วเลือกไม่ได้ (ฐานข้อมูลปฏิเสธ)
  function userChoices(candidates, selectedId) {
    if (!candidates.length) return '<p class="muted small">ไม่พบผู้ใช้ในทะเบียนที่น่าจะตรงกับผู้รับสิทธิ์ ค้นหาด้วยชื่อหรือ Auth. Name ด้านล่าง</p>';
    return candidates.map((user) => `<label class="itar-choice${user.active ? "" : " is-disabled"}"><input type="radio" name="user_id" value="${esc(user.id)}"${String(selectedId) === user.id ? " checked" : ""}${user.active ? "" : " disabled"}> <span><strong>${esc(user.authId)}</strong> ${esc(user.name)}${user.department ? ` · ${esc(user.department)}` : ""}${user.active ? "" : ' <span class="badge cancelled">ลาออกแล้ว</span>'}${user.linked ? ' <small class="muted">ผูกพนักงานแล้ว</small>' : ""}</span></label>`).join("");
  }
  // ข้อความสถานะใต้ช่องค้นหาผู้ใช้ทะเบียน · search = { state: "idle" | "loading" | "error", searched, message }
  function userSearchStatus(search) {
    if (search.state === "loading") return '<p class="muted small">กำลังค้นหา…</p>';
    if (search.state === "error") return `<p class="field-error" role="alert">${esc(search.message || "ค้นหาไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วกดค้นหาอีกครั้ง")}</p>`;
    return search.searched ? '<p class="muted small">แสดงผลที่พบรวมในรายการด้านบนแล้ว</p>' : "";
  }
  function applyRowHtml(row, decision) {
    const applied = decision.decision === "applied";
    const rejected = decision.decision === "rejected";
    return `<div class="itar-apply-row${row.warning ? " has-warning" : ""}" data-field="decision:${esc(row.id)}" data-item="${esc(row.id)}">
        <div class="itar-apply-main">
          <strong><span class="itar-apply-no">${esc(row.no)}.</span> ${esc(row.label)}</strong>
          ${row.note ? `<small class="muted itar-text">เหตุผลที่ขอ: ${esc(row.note)}</small>` : ""}
          <span class="itar-apply-change">ที่ขอ: ${esc(row.before)} → <strong>${esc(row.after)}</strong></span>
          <small class="muted">ทะเบียนตอนนี้: ${esc(row.current)}</small>
          ${row.warning ? `<small class="itar-apply-warning" role="note">${esc(row.warning)}</small>` : ""}
        </div>
        <div class="itar-choices itar-apply-decide" data-invalid-target role="radiogroup" aria-label="รายการที่ ${esc(row.no)}">
          <label class="itar-choice"><input type="radio" name="decision:${esc(row.id)}" value="applied"${applied ? " checked" : ""}> <span>บันทึกลงทะเบียน</span></label>
          <label class="itar-choice"><input type="radio" name="decision:${esc(row.id)}" value="rejected"${rejected ? " checked" : ""}> <span>ไม่บันทึก</span></label>
        </div>
        <div class="field itar-note-field" data-reason-for="${esc(row.id)}"${rejected ? "" : " hidden"}><label for="itar-reason-${esc(row.id)}">เหตุผลที่ไม่บันทึก ${REQUIRED}</label><input class="input" id="itar-reason-${esc(row.id)}" name="reason:${esc(row.id)}" maxlength="${model.MAX_DECISION_REASON}" autocomplete="off" value="${esc(decision.reason)}"></div>
      </div>`;
  }
  // ctx = model.normalizeApplyContext · state = model.initialApplyState · candidates = model.userCandidates · search = { state, searched, message } ผลค้นหาผู้ใช้ทะเบียน
  function applyForm({ ctx, state, candidates = [], search = { state: "idle", searched: false, message: "" } }) {
    const request = ctx.request;
    const revoke = request.request_type === "revoke_all";
    const subject = model.subjectName({ name_th: request.subject_name_th, name_en: request.subject_name_en });
    const summaryBox = `<div class="itar-subject-box"><div><span class="muted small">ใบขอสิทธิ์ ${esc(request.doc_no)}</span><strong>${esc(subject)}</strong><span class="muted small">${esc([request.subject_department_code, request.subject_division ? `ฝ่าย${model.divisionLabel(request.subject_division)}` : ""].filter(Boolean).join(" · "))}</span></div><span class="badge itar-type-tag">${esc(model.requestTypeLabel(request.request_type))}</span></div>`;
    const blocked = model.applyBlockedMessage(ctx);
    if (blocked) return `<section class="card form-card" id="itar-apply-card">${summaryBox}<p class="rf-callout is-warn" role="status">${esc(blocked)}</p></section>`;

    const userSection = ctx.needsUserChoice
      ? `<fieldset class="itar-fieldset itar-user-pick" data-field="user"><legend>ผู้ใช้ในทะเบียนสิทธิ์ ${REQUIRED}</legend>
          <p class="muted small">ผู้รับสิทธิ์ยังไม่ผูกกับผู้ใช้ในทะเบียน เลือกผู้ใช้ที่ตรงกับผู้รับสิทธิ์ (ระบบแนะนำจากชื่อ/บัญชีพนักงาน หรือค้นหาเอง)</p>
          <div class="itar-choices" id="itar-user-choices" role="radiogroup" data-invalid-target aria-label="ผู้ใช้ในทะเบียนสิทธิ์">${userChoices(candidates, state.userId)}</div>
          <div class="itar-search-row"><input class="input" id="itar-user-search" type="search" maxlength="100" autocomplete="off" placeholder="ค้นหาด้วยชื่อหรือ Auth. Name (อย่างน้อย 2 ตัวอักษร)" aria-label="ค้นหาผู้ใช้ในทะเบียน"><button type="button" class="btn secondary" id="itar-user-search-go">ค้นหา</button></div>
          <div id="itar-user-search-status" aria-live="polite">${userSearchStatus(search)}</div>
          <label class="itar-choice" id="itar-link-box"${model.canLinkEmployee(ctx, state, candidates) ? "" : " hidden"}><input type="checkbox" name="link"${state.link ? " checked" : ""}> <span>ผูกผู้ใช้ในทะเบียนนี้กับบัญชีพนักงานของผู้รับสิทธิ์ <small class="muted">(ใบต่อไปของคนนี้จะรู้สิทธิ์ปัจจุบันอัตโนมัติ)</small></span></label>
        </fieldset>`
      : "";
    const newUserSection = ctx.needsNewUser
      ? `<fieldset class="itar-fieldset" data-field="auth_id"><legend>ผู้ใช้ใหม่ในทะเบียนสิทธิ์</legend>
          <p class="muted small">ใบขอใหม่ ระบบจะสร้างผู้ใช้ใหม่ในทะเบียนพร้อมสิทธิ์ที่บันทึก ชื่อ แผนก และฝ่ายมาจากใบ</p>
          <div class="field"><label for="itar-new-auth">Auth. Name ${REQUIRED}</label><input class="input" id="itar-new-auth" name="new_auth_id" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="เช่น somchai.k" value="${esc(state.newUser.auth_id)}"><small>ตัวอักษรอังกฤษ ตัวเลข . _ - (ระบบแปลงเป็นตัวพิมพ์เล็กให้)</small></div>
          <div class="field" data-field="new_user_name"><label for="itar-new-name-th">ชื่อ (ไทย)</label><input class="input" id="itar-new-name-th" name="new_name_th" maxlength="${model.MAX_NAME}" autocomplete="off" value="${esc(state.newUser.name_th)}"></div>
          <div class="field"><label for="itar-new-name-en">ชื่อ (อังกฤษ)</label><input class="input" id="itar-new-name-en" name="new_name_en" maxlength="${model.MAX_NAME}" autocomplete="off" value="${esc(state.newUser.name_en)}"></div>
        </fieldset>`
      : "";

    let itemsSection;
    if (revoke) {
      const summary = model.rightsSummary(ctx.subjectRights);
      itemsSection = `<section class="itar-section"><h2 class="itar-step-title">สิทธิ์ที่จะถูกถอดทั้งหมด</h2>
          <p class="rf-callout is-warn" role="status">${esc(model.revokeText(summary))} · ผู้ใช้จะเปลี่ยนสถานะเป็นลาออกในทะเบียน และใบนี้จบงานทันที</p>
          ${summary ? rightsList(summary) : '<p class="muted small">ยังไม่ทราบสิทธิ์ของผู้ใช้ที่จะเลือก ระบบถอดสิทธิ์ทั้งหมดที่มีในทะเบียนตอนบันทึก</p>'}
        </section>`;
    } else {
      itemsSection = `<section class="itar-section" data-field="items"><h2 class="itar-step-title">รายการสิทธิ์ที่ขอ</h2>
          <p class="muted small">เปรียบเทียบสิ่งที่ผู้ยื่นขอกับทะเบียนตอนนี้ แล้วเลือกทีละรายการ: "บันทึกลงทะเบียน" ตามที่ขอ หรือ "ไม่บันทึก" (ต้องระบุเหตุผล) · ระบบบันทึกทุกรายการพร้อมกัน ถ้ามีรายการใดผิดจะไม่เปลี่ยนอะไรเลย</p>
          <div class="form-actions"><button type="button" class="btn secondary small" id="itar-apply-all">ยืนยันทุกรายการตามที่ขอ</button></div>
          <div class="itar-apply-list" id="itar-apply-list">${model.applyRows(ctx).map((row) => applyRowHtml(row, model.decisionOf(state, row.id))).join("")}</div>
        </section>`;
    }
    return `<section class="card form-card" id="itar-apply-card"><div id="itar-message" role="status"></div>
      <form id="itar-apply-form" novalidate>
        ${summaryBox}
        <p class="muted small itar-apply-reason"><strong>เหตุผลของผู้ยื่น:</strong> <span class="itar-text">${esc(request.reason)}</span></p>
        ${userSection}${newUserSection}${itemsSection}
        <div class="form-actions"><a class="btn secondary" href="${esc(model.accessUrl("order", { id: request.id }))}" data-form-cancel>ยกเลิก</a><button type="submit" class="btn is-primary" data-step-submit>บันทึกลงทะเบียน</button></div>
      </form></section>`;
  }

  /* ---------- ใบพิมพ์ A4 · USER-REQ (ใบคำร้อง) และ USER-Page (เอกสารชี้แจงสิทธิ์) ---------- */
  // ใช้เปลือกและตารางของใบแจ้งซ่อม (.itrp-sheet*) ร่วมกันเพื่อให้หน้าตา/การตั้งหน้า A4/การซ่อนเมนูตอนพิมพ์เหมือนกัน · ข้อมูลทั้งหมดมาจาก detail ของ app_itar_get_detail (ไม่มีรหัสผ่านหรือช่องลับ)
  const radio = (on) => `<span class="itrp-radio" aria-hidden="true">${on ? "●" : "○"}</span>`;
  const printChoices = (options, selected) => options.map((option) => `<span class="itrp-choice-print" data-option="${esc(option.value)}"${option.value === selected ? ' data-selected="1"' : ""}>${radio(option.value === selected)} ${esc(option.label)}</span>`).join("");
  // กล่องลายเซ็น: ชื่อ + วันที่และเวลาที่กดในระบบ · ว่าง = เว้นช่อง (เซ็นมือ) · typed = ชื่อพิมพ์ใต้เส้นเซ็นมือ · remark = หมายเหตุใต้ชื่อ
  const signBox = (key, label, sign) => `<div class="itrp-sign" data-slot="${key}">
        <div class="itrp-sign-label">${esc(label)}</div>
        <div class="itrp-sign-name">${esc(sign.name ?? "")}</div>
        ${sign.typed && !sign.name ? `<div class="itrp-sign-remark">(${esc(sign.typed)})</div>` : ""}
        ${sign.remark ? `<div class="itrp-sign-remark">(${esc(sign.remark)})</div>` : ""}
        <div class="itrp-sign-time">${sign.at ? esc(model.formatDateTime(sign.at)) : ""}</div>
      </div>`;
  const sheetHead = (title, detail, isTest) => `<header class="itrp-sheet-title">
          <img class="itrp-sheet-logo" src="./icons/icon-192.png" alt="">
          <h1>${esc(title)}</h1>
          <div class="itrp-docbox"><span>เลขที่ใบขอสิทธิ์</span><strong>${esc(detail.doc_no)}</strong></div>
        </header>
        ${isTest ? '<p class="itrp-test-note">ใบทดสอบ — ไม่ใช่เอกสารจริง</p>' : ""}`;
  const testMark = (isTest) => (isTest ? '<div class="itrp-watermark" aria-hidden="true">ทดสอบ</div>' : "");
  const PRINT_FOOTER = "ลงนามอิเล็กทรอนิกส์ผ่านระบบ (ชื่อและวันเวลาตามที่กดในระบบ)";
  const subjectDepartment = (detail) => [detail.subject?.department_code, detail.subject?.division ? `ฝ่าย${model.divisionLabel(detail.subject.division)}` : ""].filter(Boolean).join(" · ") || "—";

  // ประวัติถาม-ตอบย่อ: ข้อความยาวตัดที่ 200 ตัวอักษร (ฉบับเต็มอยู่ในระบบ) ไม่มีข้อความ = ไม่มีส่วนนี้
  const PRINT_COMMENT_CLIP = 200;
  function printComments(rows) {
    if (!rows.length) return "";
    return `<h2 class="itrp-sheet-section">ประวัติถาม-ตอบ (ย่อ)</h2>
        <table class="itrp-sheet-table itrp-sheet-comments"><thead><tr><th>ลำดับ</th><th>ถาม/ตอบ</th><th>ขั้น</th><th>โดย</th><th>วันเวลา</th><th>ข้อความ</th></tr></thead><tbody>${rows.map((row) => `<tr>
          <td class="itrp-center">${esc(row.no)}</td><td>${esc(row.kindLabel)}</td><td>${esc(row.stageLabel)}</td><td>${esc(row.by)}</td><td>${esc(model.formatDateTime(row.at))}</td>
          <td class="itrp-sheet-text">${esc(model.clip(row.body, PRINT_COMMENT_CLIP))}</td></tr>`).join("")}</tbody></table>`;
  }

  // ใบคำร้อง (USER-REQ): ผู้ยื่น/ผู้รับสิทธิ์ · ประเภท · เหตุผล · รายการก่อน→หลัง (+ผลที่ IT ตัดสิน) · ลงนาม 4 ช่อง · ถาม-ตอบย่อ
  function printRequestSheet(detail) {
    const isTest = Boolean(detail.is_test) || model.isTestDoc(detail.doc_no);
    const sign = model.requestSignoffs(detail);
    const rows = model.itemRows(detail);
    const hasResult = rows.some((row) => row.result);
    let itemsBlock;
    if (detail.request_type === "revoke_all") {
      const summary = model.rightsSummary(detail.applied_summary?.before ?? detail.subject_rights ?? null);
      const applied = Boolean(detail.applied_summary);
      itemsBlock = `<table class="itrp-sheet-table"><tbody><tr><th scope="row">รายการ</th><td>${esc(applied ? model.revokeText(summary).replace("จะถอด", "ถอด") : model.revokeText(summary))}</td></tr></tbody></table>`;
    } else {
      itemsBlock = `<table class="itrp-sheet-table itar-sheet-items"><thead><tr><th>ลำดับ</th><th>รายการสิทธิ์</th><th>ก่อน</th><th>หลัง</th>${hasResult ? "<th>ผลที่ IT บันทึก</th>" : ""}</tr></thead><tbody>${rows.map((row) => `<tr>
          <td class="itrp-center">${esc(row.no)}</td>
          <td>${esc(row.label)}${row.note ? `<br><small>เหตุผล: ${esc(row.note)}</small>` : ""}</td>
          <td>${esc(row.before)}</td><td><strong>${esc(row.after)}</strong></td>
          ${hasResult ? `<td>${row.result ? `${esc(row.result.label)}${row.result.reason ? `<br><small>${esc(row.result.reason)}</small>` : ""}` : ""}</td>` : ""}</tr>`).join("")}</tbody></table>`;
    }
    return `<article class="itrp-sheet itar-sheet${isTest ? " is-test" : ""}" data-form="req" aria-label="ใบขอสิทธิ์ ${esc(detail.doc_no)}">
        ${testMark(isTest)}
        ${sheetHead("ใบขอสิทธิ์การใช้งานระบบคอมพิวเตอร์", detail, isTest)}
        <table class="itrp-sheet-table"><tbody>
          <tr><th scope="row">ผู้ยื่นใบขอ</th><td>${esc(detail.requester?.full_name ?? "—")}</td><th scope="row">หน่วยงาน</th><td>${esc(detail.department?.name_th ?? "—")}</td></tr>
          <tr><th scope="row">วันที่ยื่น</th><td>${esc(model.formatDateOf(detail.created_at))}</td><th scope="row">เวลา</th><td>${esc(model.formatTimeOf(detail.created_at))}</td></tr>
          <tr><th scope="row">ผู้รับสิทธิ์</th><td>${esc(model.subjectName(detail.subject))}</td><th scope="row">แผนก / ฝ่าย</th><td>${esc(subjectDepartment(detail))}</td></tr>
          <tr><th scope="row">ประเภทคำขอ</th><td colspan="3">${printChoices(model.REQUEST_TYPES, detail.request_type)}</td></tr>
          <tr><th scope="row">เหตุผลที่ขอ</th><td colspan="3" class="itrp-sheet-text">${esc(detail.reason)}</td></tr>
        </tbody></table>
        <h2 class="itrp-sheet-section">รายการสิทธิ์ที่ขอ (ก่อน → หลัง)</h2>
        ${itemsBlock}
        <div class="itrp-signs itar-signs-4">
          ${signBox("requester", "ผู้ยื่นใบขอ", sign.requester)}
          ${signBox("dept", "ผู้อนุมัติ (ผู้จัดการแผนก)", sign.dept)}
          ${signBox("it_mgr", "ผู้อนุมัติขั้น IT", sign.itMgr)}
          ${signBox("applied", "IT ผู้ดำเนินการ", sign.applied)}
        </div>
        ${printComments(model.commentRows(detail))}
        <p class="itrp-sheet-note">${PRINT_FOOTER} · สถานะใบขอสิทธิ์ ณ ที่พิมพ์: ${esc(model.statusLabel(detail.status))}</p>
      </article>`;
  }

  // สิทธิ์ทั้งหมดของผู้ใช้ในตารางเล็ก ๆ: โฟลเดอร์เรียง 2 ชุดคอลัมน์ต่อแถว (ให้พอดีหน้าเดียว) · อินเทอร์เน็ต · โปรแกรม · อีเมล
  function printRightsTables(summary) {
    if (!summary) return '<p class="itrp-sheet-note">ไม่มีข้อมูลสิทธิ์ที่บันทึก</p>';
    const half = Math.ceil(summary.folders.length / 2);
    const left = summary.folders.slice(0, half);
    const right = summary.folders.slice(half);
    const cell = (row) => (row ? `<td>${esc(row.code)}</td><td>${esc(row.name)}</td><td class="itrp-center">${esc(row.level)}</td>` : "<td></td><td></td><td></td>");
    const folderRows = left.map((row, index) => `<tr>${cell(row)}${cell(right[index])}</tr>`).join("");
    return `<h2 class="itrp-sheet-section">สิทธิ์โฟลเดอร์แชร์ (R = อ่านอย่างเดียว · F = อ่าน-เขียน-แก้ไข-ลบ)</h2>
        ${summary.folders.length ? `<table class="itrp-sheet-table itar-sheet-folders"><thead><tr><th>รหัส</th><th>โฟลเดอร์</th><th>สิทธิ์</th><th>รหัส</th><th>โฟลเดอร์</th><th>สิทธิ์</th></tr></thead><tbody>${folderRows}</tbody></table>` : '<p class="itrp-sheet-note">ไม่มีสิทธิ์โฟลเดอร์แชร์</p>'}
        <table class="itrp-sheet-table"><tbody>
          <tr><th scope="row">อินเทอร์เน็ต</th><td>${summary.internet ? "มีสิทธิ์" : "ไม่มี"}</td></tr>
          <tr><th scope="row">โปรแกรม</th><td>${summary.programs.length ? esc(summary.programs.map((row) => (row.note ? `${row.name} (${row.note})` : row.name)).join(" · ")) : "ไม่มี"}</td></tr>
          <tr><th scope="row">อีเมล</th><td>${summary.emails.length ? esc(summary.emails.map((row) => `${row.address} (${row.kindLabel})`).join(" · ")) : "ไม่มี"}</td></tr>
        </tbody></table>`;
  }

  // เอกสารชี้แจงสิทธิ์ (USER-Page): สิทธิ์ทั้งหมดหลังเปลี่ยน · ข้อความนโยบาย · ลงนาม ผู้รับสิทธิ์ (รับทราบ) + IT ผู้บันทึกสิทธิ์
  function printRightsSheet(detail) {
    const isTest = Boolean(detail.is_test) || model.isTestDoc(detail.doc_no);
    const sign = model.rightsDocumentSignoffs(detail);
    const raw = model.rightsAfter(detail);
    const summary = model.rightsSummary(raw);
    const policy = model.policyOf(detail);
    return `<article class="itrp-sheet itar-sheet${isTest ? " is-test" : ""}" data-form="page" aria-label="เอกสารชี้แจงสิทธิ์ ${esc(detail.doc_no)}">
        ${testMark(isTest)}
        ${sheetHead("เอกสารชี้แจงสิทธิ์การใช้งานระบบคอมพิวเตอร์", detail, isTest)}
        <table class="itrp-sheet-table"><tbody>
          <tr><th scope="row">ผู้รับสิทธิ์</th><td>${esc(model.subjectName(detail.subject))}</td><th scope="row">Auth. Name</th><td>${esc(raw?.auth_id ?? "")}</td></tr>
          <tr><th scope="row">แผนก / ฝ่าย</th><td>${esc(subjectDepartment(detail))}</td><th scope="row">อ้างถึงใบขอสิทธิ์</th><td>${esc(detail.doc_no)}</td></tr>
          <tr><th scope="row">ประเภทคำขอ</th><td>${esc(model.requestTypeLabel(detail.request_type))}</td><th scope="row">IT บันทึกสิทธิ์เมื่อ</th><td>${esc(model.formatDateTime(detail.applied?.at))}</td></tr>
        </tbody></table>
        ${printRightsTables(summary)}
        <div class="itar-sheet-policy"><strong>นโยบาย${policy.version ? ` (${esc(policy.version)})` : ""}</strong>
          <p class="itrp-sheet-text">${esc(policy.text)}</p></div>
        <div class="itrp-signs itar-signs-2">
          ${signBox("recipient", "ผู้รับสิทธิ์ (รับทราบ)", sign.recipient)}
          ${signBox("applied", "IT ผู้บันทึกสิทธิ์", sign.applied)}
        </div>
        <p class="itrp-sheet-note">${PRINT_FOOTER}</p>
      </article>`;
  }

  // หน้าพิมพ์: แถบเครื่องมือ (กลับ · สลับใบ · พิมพ์) ไม่พิมพ์ลงกระดาษ · form = "req" | "page" (model.resolvePrintForm ตัดสินแล้ว)
  function printPage(detail, { form = "req" } = {}) {
    const other = model.printForms(detail).filter((item) => item !== form);
    return page(`<div class="itrp-print-toolbar no-print">
        <a class="btn secondary" href="${esc(model.accessUrl("order", { id: detail.id }))}">‹ กลับไปรายละเอียด</a>
        ${other.map((item) => `<a class="btn secondary" href="${esc(model.printUrl(detail.id, item))}">${esc(model.PRINT_FORM_LABELS[item])}</a>`).join("")}
        <button type="button" class="btn is-primary" id="itar-print-button">พิมพ์</button>
      </div>
      ${form === "page" ? printRightsSheet(detail) : printRequestSheet(detail)}`, { showDevNotice: false });
  }

  /* ---------- ตั้งค่า (it_admin) ---------- */
  // รายชื่อทีม IT อ่านอย่างเดียว: ชุดเดียวกับใบสั่งงาน IT (ตาราง itwo_staff) การแก้สิทธิ์ทำที่ใบสั่งงาน IT ไม่ใช่ที่นี่
  function staffTable({ staff }) {
    if (!staff.length) return emptyBlock("ยังไม่มีรายชื่อทีม IT");
    return table({
      label: "ทีม IT ของใบขอสิทธิ์",
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
  // counter = ผลของ app_itar_get_doc_counter · ตั้งเลขถัดไปได้เฉพาะเดินหน้า
  function docCounterCard(counter) {
    if (!counter) return "";
    return `<section class="card itar-counter" aria-labelledby="itar-counter-title"><h2 id="itar-counter-title">เลขที่เอกสารถัดไป</h2>
      <p class="itar-counter-no"><span class="request-no">${esc(counter.next_doc_no)}</span></p>
      <form id="itar-counter-form" novalidate>
        <div class="field" data-field="next_seq"><label for="itar-next-seq">ตั้งเลขถัดไปเป็น</label><input class="input" id="itar-next-seq" name="next_seq" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${esc(String(counter.next_seq + 1))}"><small>ตั้งได้เฉพาะเดินหน้า (ใช้ต่อจากทะเบียนกระดาษ) ถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ และมีบันทึกการตั้งเลขที่ลบไม่ได้</small></div>
        <div class="form-actions"><button type="submit" class="btn is-primary">ตั้งเลขถัดไป</button></div>
      </form></section>`;
  }
  function settingsPage({ staff, counter }) {
    return `<div class="stack">
      <section class="card" aria-labelledby="itar-staff-title"><h2 id="itar-staff-title">ทีม IT</h2>
        <p class="muted small">รายชื่อเดียวกับใบสั่งงาน IT (ดูอย่างเดียว) ถ้าต้องการเพิ่มหรือแก้สิทธิ์ ให้แก้ที่แท็บตั้งค่าของใบสั่งงาน IT</p>
        ${staffTable({ staff })}
      </section>
      ${docCounterCard(counter)}
    </div>`;
  }
  // ล้างข้อมูลใบขอสิทธิ์ทดสอบ: เฉพาะ admin ตัวจริงที่อยู่ในโหมดทดสอบ (state.sandbox ตั้งโดย app.js)
  const purgeRow = () => `<div class="itar-purge"><button type="button" class="btn danger small" id="itar-purge">ล้างข้อมูลใบขอสิทธิ์ทดสอบ</button></div>`;

  const api = {
    head, newButton, tabs, page, errorCard, mineList, approvalsList, itList, chooserForm, modeBox, subjectBody, rightsForm, emailAddRow, emailAddRows, previewTable, rightsList,
    uploadPanel, detailPage, detailHead, actionsCard, ackCard, paperCard, printCard, applyForm, userChoices, userSearchStatus, printRequestSheet, printRightsSheet, printPage, factsCard, itemsCard, afterCard, changeTable, askFormCard, answerCard, commentsCard, historyCard, filesCard,
    settingsPage, staffTable, docCounterCard, purgeRow, testTag, selectOptions, fileGrid,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITAR_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
