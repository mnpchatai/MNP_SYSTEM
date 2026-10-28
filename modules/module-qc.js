// โมดูล "ใบตรวจ QC" (Data Inspection Report, ฟอร์ม QA01-PM11) ของ Pilot Web — เปิดเฉพาะโหมดทดสอบของผู้ดูแลระบบ
//
// หน้า #/qc (ฐานข้อมูล: supabase/migrations/20261027010000_qc_inspection_reports.sql ทุกอย่างเรียกผ่าน RPC app_qc_*)
//   (ว่าง)            รายการใบตรวจ กรองสถานะ/Part/Lot · สร้างใบ · ลิงก์แม่แบบ · ล้างข้อมูลทดสอบ QC (สองขั้น)
//   view=templates    รายการแม่แบบตรวจต่อ Part     view=template[&id=]  ฟอร์มแม่แบบ (หัว + ตารางรายการ เพิ่ม/ลบแถวได้)
//   view=new          ใบตรวจใหม่ (เลือก Part จากแม่แบบ กรอกค่า point 1–5 คำนวณ min/max/average/Judge สด เลือก Lot ยางผสม)
//   view=edit&id=     แก้ใบฉบับร่าง (ฟอร์มเดียวกับ new)
//   view=report&id=   ใบตรวจ: หัวใบแบบฟอร์มกระดาษ · ผล Mooney ของแต่ละ Lot · ตารางรายการ · ช่องลงนาม 4 ช่อง · ประวัติ · ปุ่มตามสถานะและสิทธิ์
//
// ปุ่มที่เห็นเลือกจากสิทธิ์ของ persona ที่ทำหน้าที่อยู่ (app_qc_access) แต่ตัวบังคับสิทธิ์/สถานะ/version จริงคือ RPC แต่ละตัว
// ค่า min / max / average / Judge / ผลรวมที่เห็นสดตอนกรอกคำนวณโดย modules/qc-model.js เพื่อดูประกอบเท่านั้น ฐานข้อมูลคำนวณซ้ำเอง
// ไฟล์นี้โหลดหลัง modules/qc-model.js และ modules/qc-sheet.js ก่อน app.js (ดู index.html) และเรียก helper ของ app.js
// (sb, state, app, shell, bindShell, loadingShell, renderNotFound, escapeHtml, formatDate, showToast, friendlyError,
// setFormBusy, renderRoute, closePopup) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// popup รายการ Lot เป็น [data-popup] อยู่ในกรอบเดียวกับช่องค้นหา ปิดด้วยกฎกลาง closePopup ของ app.js เท่านั้น (ห้ามปิดจาก blur — iPhone)
(function registerQcModule() {
  const model = window.MNP_QC_MODEL;
  const sheet = window.MNP_QC_SHEET;
  const PATH = "qc";
  const TITLE = "ใบตรวจ QC";
  const THEME = ["#0f766e", "#134e4a"];
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 12.5l2.2 2.2 4.3-4.6M8.5 18h7"/></svg>`;
  const HEAD_STYLE = `background:linear-gradient(135deg, ${THEME[0]}, ${THEME[1]})`;
  const RESULT_BADGE = { ok: "completed", ng: "rejected", accept: "pending_approval" };
  // รหัสที่แปลว่าหน้าที่เห็นอยู่ล้าสมัย (มีคนเปลี่ยนใบไปแล้ว) — วาดหน้าใหม่ให้เห็นสถานะล่าสุด
  const STALE_CODES = ["QC_VERSION_CONFLICT", "QC_NOT_DRAFT", "QC_STEP_NOT_CURRENT", "QC_NOT_REJECTED", "QC_NOT_CANCELLABLE", "QC_NCR_EXISTS", "QC_NCR_LINKED", "QC_NOT_SUBMITTED", "QC_NOT_ACTIVE", "QC_NOT_FOUND"];
  const LOT_SEARCH_DELAY = 250;

  // helper ของ app.js (escapeHtml ฯลฯ) ยังไม่ถูกนิยามตอนไฟล์นี้โหลด (index.html โหลดโมดูลก่อน app.js)
  // จึงต้องอ้างตอนเรียกใช้เท่านั้น ห้ามคัดลอกอ้างอิงตอนโหลด (เทสต์ใน qc-pages.test.mjs โหลดไฟล์โดยไม่มี helper)
  const esc = (value) => escapeHtml(value);
  const num = (value) => (value === null || value === undefined || value === "" ? "" : String(Number(value)));
  const orDash = (value) => (value === null || value === undefined || value === "" ? "—" : value);
  const fullName = (person) => [person?.first_name, person?.last_name].filter(Boolean).join(" ");
  const urlFor = (query = {}) => {
    const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value)).toString();
    return `#/${PATH}${search ? `?${search}` : ""}`;
  };

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function loadAccess() {
    const data = await rpc("app_qc_access");
    return { read: data?.read === true, edit: data?.edit === true, steps: Array.isArray(data?.steps) ? data.steps : [] };
  }

  function paint(title, content) {
    app.innerHTML = shell(content, PATH, title);
    bindShell();
    return document.querySelector(".content");
  }

  // หัวหน้าแบบแถบสีของโมดูล (.request-module-header) + ปุ่มย้อนกลับ — ชื่อโมดูลอยู่ที่ breadcrumb แล้ว h1 บอกหน้าที่เปิดอยู่
  function headHtml({ title, back = null, actions = "", badge = "" }) {
    return `${back ? `<a class="request-back-link" href="${esc(back.href)}">${esc(back.label)}</a>` : ""}
      <div class="page-heading request-module-header qc-head" style="${HEAD_STYLE}">
        <div class="request-module-title"><h1>${esc(title)}</h1>${badge}</div>
        ${actions ? `<div class="request-create-entry">${actions}</div>` : ""}
      </div>`;
  }

  const statusBadge = (status) => `<span class="badge ${esc(model.statusBadgeClass(status))}">${esc(model.STATUS_LABELS[status] ?? status)}</span>`;
  const resultBadge = (result) => (result
    ? `<span class="badge ${esc(RESULT_BADGE[result] ?? "")}">${esc(model.RESULT_LABELS[result] ?? result)}</span>`
    : "—");
  const notice = (message) => `<div class="empty">${esc(message)}</div>`;
  const errorBox = (id = "qc-form-error") => `<div class="form-message error" id="${id}" role="alert" hidden></div>`;
  function showError(root, message, id = "#qc-form-error") {
    const box = root?.querySelector?.(id);
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView?.({ block: "nearest" });
  }

  function errorPage(error) {
    console.error(error);
    // PGRST202 = ฐานข้อมูลยังไม่ได้ขึ้น migration ของโมดูลนี้ (deploy หน้าเว็บก่อน apply migration)
    const message = error?.code === "PGRST202"
      ? "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับใบตรวจ QC กรุณา apply migration ล่าสุดก่อน"
      : friendlyError(error);
    paint(TITLE, `${headHtml({ title: TITLE })}<section class="card">${notice(message)}</section>`);
  }

  // ปุ่มเรียก RPC หนึ่งครั้ง: ปิดปุ่มระหว่างทำ สำเร็จแล้ววาดหน้าใหม่ ผิดพลาดแจ้งเตือนและวาดใหม่เมื่อหน้าล้าสมัย
  async function runAction(root, rpcName, args, successMessage) {
    const controls = root.querySelectorAll(".qc-actions button");
    controls.forEach((control) => { control.disabled = true; });
    try {
      const data = await rpc(rpcName, args);
      showToast(typeof successMessage === "function" ? successMessage(data) : successMessage);
      await renderRoute();
    } catch (error) {
      showToast(friendlyError(error), "error");
      if (STALE_CODES.some((code) => String(error?.message ?? "").includes(code))) await renderRoute();
      else controls.forEach((control) => { control.disabled = false; });
    }
  }

  // ---------- รายการใบตรวจ ----------
  const STATUS_FILTERS = [["", "ทุกสถานะ"], ...Object.entries(model.STATUS_LABELS)];

  function lotText(lots) {
    return (lots ?? []).join(", ");
  }

  function reportRows(reports) {
    return reports.map((report) => `<tr>
        <td><a class="request-no" href="${esc(urlFor({ view: "report", id: report.id }))}">${esc(report.report_no)}</a></td>
        <td>${report.part_number
          ? `<strong>${esc(report.part_number)}</strong><br><span class="muted small">${esc(report.part_name)}</span>`
          : `<strong>${esc(report.part_name)}</strong>`}</td>
        <td>${esc(orDash(report.customer))}</td>
        <td>${esc(orDash(report.order_no))}</td>
        <td>${esc(orDash(lotText(report.compound_lots)))}</td>
        <td>${esc(orDash(report.inspector_name))}</td>
        <td>${report.inspected_at ? esc(formatDate(report.inspected_at, true)) : "—"}</td>
        <td>${resultBadge(report.result)}</td>
        <td>${statusBadge(report.status)}</td>
      </tr>`).join("");
  }

  function filterHtml(filter) {
    return `<form class="qc-filter" id="qc-filter" role="search">
        <div class="field"><label for="qc-f-status">สถานะ</label>
          <select class="select" id="qc-f-status" name="status">${STATUS_FILTERS.map(([value, label]) => `<option value="${esc(value)}"${value === filter.status ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
        <div class="field"><label for="qc-f-part">Part Number</label><input class="input" id="qc-f-part" name="part" maxlength="60" value="${esc(filter.part)}" autocomplete="off"></div>
        <div class="field"><label for="qc-f-lot">Lot ยางผสม</label><input class="input" id="qc-f-lot" name="lot" maxlength="60" value="${esc(filter.lot)}" autocomplete="off"></div>
        <div class="qc-filter-actions"><button class="btn" type="submit">ค้นหา</button><a class="btn secondary" href="${esc(urlFor())}">ล้าง</a></div>
      </form>`;
  }

  // ล้างข้อมูลทดสอบ QC แบบสองขั้น: กดครั้งแรกแสดงสิ่งที่จะลบ กดยืนยันอีกครั้งจึงเรียก RPC (แผงอยู่ในหน้า ไม่ใช่ popup ลอย)
  function purgeHtml() {
    return `<section class="card qc-purge" aria-labelledby="qc-purge-title">
        <h2 id="qc-purge-title">ล้างข้อมูลทดสอบ QC</h2>
        <p class="muted small">ลบใบตรวจและแม่แบบตรวจ QC ทั้งหมดของโหมดทดสอบ แล้วเริ่มนับเลข TEST-QC ใหม่ ข้อมูลจริงและ NCR ทดสอบไม่ถูกแตะ</p>
        <button class="btn danger" type="button" id="qc-purge-review">ล้างข้อมูลทดสอบ QC</button>
        <div class="qc-purge-panel" id="qc-purge-panel" hidden></div>
      </section>`;
  }

  function bindPurge(root) {
    const review = root.querySelector("#qc-purge-review");
    const panel = root.querySelector("#qc-purge-panel");
    if (!review || !panel) return;
    const close = () => {
      panel.hidden = true;
      panel.innerHTML = "";
      review.hidden = false;
    };
    review.addEventListener("click", () => {
      panel.innerHTML = `<h3 tabindex="-1">ยืนยันล้างข้อมูลทดสอบ QC</h3>
        <ul class="qc-purge-notes"><li>ลบใบตรวจ รายการตรวจ ลายเซ็นและประวัติของใบตรวจทดสอบทั้งหมด รวมถึงแม่แบบตรวจทุก Part</li>
        <li>เลขที่ใบ TEST-QC เริ่มนับใหม่ · ใบ NCR ที่เปิดจากใบตรวจไม่ถูกลบ (ล้างแยกที่แถบสีเหลือง)</li>
        <li>ย้อนกลับไม่ได้</li></ul>
        <div class="qc-purge-actions"><button class="btn danger" type="button" id="qc-purge-confirm">ยืนยันล้างข้อมูล</button>
        <button class="btn secondary" type="button" id="qc-purge-cancel">ยกเลิก</button></div>`;
      panel.hidden = false;
      review.hidden = true;
      panel.querySelector("h3")?.focus?.();
      panel.querySelector("#qc-purge-cancel")?.addEventListener("click", close);
      const confirmButton = panel.querySelector("#qc-purge-confirm");
      confirmButton?.addEventListener("click", async () => {
        const cancel = panel.querySelector("#qc-purge-cancel");
        confirmButton.disabled = true;
        if (cancel) cancel.disabled = true;
        try {
          const data = await rpc("app_sandbox_purge_qc");
          showToast(`ล้างข้อมูลทดสอบ QC แล้ว: ใบตรวจ ${data?.deleted_reports ?? 0} ใบ แม่แบบ ${data?.deleted_templates ?? 0} รายการ`);
          await renderRoute();
        } catch (error) {
          confirmButton.disabled = false;
          if (cancel) cancel.disabled = false;
          showToast(friendlyError(error), "error");
        }
      });
    });
  }

  async function listView({ params, access }) {
    const status = STATUS_FILTERS.some(([value]) => value === params.get("status")) ? params.get("status") : "";
    const filter = { status, part: String(params.get("part") ?? "").trim().slice(0, 60), lot: String(params.get("lot") ?? "").trim().slice(0, 60) };
    const data = await rpc("app_qc_reports", { p_filter: { status: filter.status, part_number: filter.part, lot: filter.lot } });
    const reports = data?.reports ?? [];
    const filtered = Boolean(filter.status || filter.part || filter.lot);
    const actions = `${access.edit ? `<a class="btn" href="${esc(urlFor({ view: "new" }))}"><span class="plus-icon" aria-hidden="true"></span> สร้างใบตรวจ</a>` : ""}
      <a class="btn" href="${esc(urlFor({ view: "templates" }))}">แม่แบบตรวจ</a>`;
    const table = reports.length
      ? `<div class="table-wrap"><table class="qc-table"><thead><tr><th>เลขที่</th><th>Part</th><th>ลูกค้า</th><th>Order No.</th><th>Lot ยางผสม</th><th>ผู้ตรวจ</th><th>วันที่ตรวจ</th><th>ผล</th><th>สถานะ</th></tr></thead><tbody>${reportRows(reports)}</tbody></table></div>`
      : `<div class="empty">${filtered ? "ไม่พบใบตรวจที่ตรงกับตัวกรอง" : "ยังไม่มีใบตรวจ QC ในโหมดทดสอบ"}${filtered || !access.edit ? "" : `<br><small>สร้างแม่แบบตรวจของ Part ก่อน แล้วจึงสร้างใบตรวจ</small>`}</div>`;
    const root = paint(TITLE, `<div class="qc-page">${headHtml({ title: TITLE, actions })}
      <section class="card">${filterHtml(filter)}${table}</section>
      ${state.sandbox?.active ? purgeHtml() : ""}</div>`);
    root?.querySelector?.("#qc-filter")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      location.hash = urlFor({ status: form.get("status"), part: String(form.get("part") ?? "").trim(), lot: String(form.get("lot") ?? "").trim() });
    });
    if (root) bindPurge(root);
  }

  // ---------- แม่แบบตรวจ ----------
  const templatesBack = { href: urlFor(), label: "‹ กลับรายการใบตรวจ" };

  async function templatesView({ access }) {
    const templates = await rpc("app_qc_templates");
    const rows = (templates ?? []).map((template) => `<tr>
        <td>${template.part_number ? `<a class="request-no" href="${esc(urlFor({ view: "template", id: template.id }))}">${esc(template.part_number)}</a>` : "—"}</td>
        <td>${template.part_number ? esc(template.part_name) : `<a class="request-no" href="${esc(urlFor({ view: "template", id: template.id }))}">${esc(template.part_name)}</a>`}</td>
        <td>${esc(orDash(template.customer))}</td>
        <td class="right">${esc((template.items ?? []).length)}</td>
        <td><span class="badge ${template.status === "active" ? "completed" : ""}">${template.status === "active" ? "ใช้งาน" : "ปิดใช้งาน"}</span></td>
      </tr>`).join("");
    const actions = access.edit ? `<a class="btn" href="${esc(urlFor({ view: "template" }))}"><span class="plus-icon" aria-hidden="true"></span> สร้างแม่แบบ</a>` : "";
    paint(`${TITLE} / แม่แบบตรวจ`, `<div class="qc-page">${headHtml({ title: "แม่แบบตรวจ", back: templatesBack, actions })}
      <section class="card">${rows
        ? `<div class="table-wrap"><table class="qc-table"><thead><tr><th>Part Number</th><th>Part Name</th><th>customer</th><th class="right">รายการตรวจ</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty">ยังไม่มีแม่แบบตรวจ${access.edit ? "<br><small>สร้างแม่แบบของ Part (รายการ A, B, C… พร้อมสเปก MIN/STD/MAX) เพื่อใช้สร้างใบตรวจ</small>" : ""}</div>`}</section></div>`);
  }

  // รหัสรายการถัดไป: A..Z แล้ว AA..AZ (ตรงกับ ITEM No. ของฟอร์ม และ check ของฐานข้อมูล ^[A-Z]{1,2}$)
  function nextItemNo(used) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const candidates = [...letters, ...[...letters].map((letter) => `A${letter}`)];
    return candidates.find((candidate) => !used.includes(candidate)) ?? "";
  }

  function templateRowHtml(item, editable) {
    const disabled = editable ? "" : " disabled";
    const cell = (name, label, value, extra = "") => `<td><input class="input" name="${name}" aria-label="${esc(label)}" value="${esc(value)}"${extra}${disabled}></td>`;
    const spec = (name, label, value) => cell(name, label, num(value), ' type="number" inputmode="decimal" step="any"');
    return `<tr data-qc-trow>
        ${cell("item_no", "ITEM No.", item.item_no, ' maxlength="2" required')}
        ${cell("name", "Inspection Item", item.name, ' maxlength="100" required')}
        ${cell("instrument", "Instrument", item.instrument, ' maxlength="100"')}
        ${cell("unit", "หน่วย", item.unit, ' maxlength="20"')}
        ${spec("spec_min", "Specification MIN", item.spec_min)}
        ${spec("spec_std", "Specification STD", item.spec_std)}
        ${spec("spec_max", "Specification MAX", item.spec_max)}
        ${cell("points_required", "จำนวนจุดวัด", item.points_required ?? 5, ' type="number" inputmode="numeric" min="1" max="5" step="1"')}
        <td>${editable ? `<button class="btn secondary small" type="button" data-remove-row aria-label="ลบรายการ ${esc(item.item_no)}">ลบ</button>` : ""}</td>
      </tr>`;
  }

  async function templateFormView({ params, access }) {
    const id = params.get("id") ?? "";
    const templates = await rpc("app_qc_templates");
    const template = id ? (templates ?? []).find((row) => row.id === id) : null;
    if (id && !template) {
      paint(`${TITLE} / แม่แบบตรวจ`, `<div class="qc-page">${headHtml({ title: "แม่แบบตรวจ", back: { href: urlFor({ view: "templates" }), label: "‹ กลับรายการแม่แบบ" } })}<section class="card">${notice(model.ERROR_MESSAGES.QC_NOT_FOUND)}</section></div>`);
      return;
    }
    const editable = access.edit;
    const items = template?.items?.length ? template.items : [{ item_no: "A", name: "", instrument: "", unit: "", spec_min: null, spec_std: null, spec_max: null, points_required: 5 }];
    const back = { href: urlFor({ view: "templates" }), label: "‹ กลับรายการแม่แบบ" };
    const title = template ? template.part_number || template.part_name : "สร้างแม่แบบ";
    const root = paint(`${TITLE} / แม่แบบตรวจ`, `<div class="qc-page">${headHtml({ title, back })}
      <form class="card" id="qc-form" novalidate>
        ${errorBox()}
        ${editable ? "" : `<p class="muted small">ตำแหน่งที่ทำหน้าที่อยู่ดูแม่แบบได้อย่างเดียว (แก้ไขได้เฉพาะแผนก QA และผู้ดูแลระบบ)</p>`}
        <div class="form-grid">
          <div class="field"><label for="qc-t-part">Part Number (ไม่บังคับ)</label><input class="input" id="qc-t-part" name="part_number" maxlength="60" value="${esc(template?.part_number)}"${editable ? "" : " disabled"}></div>
          <div class="field"><label for="qc-t-name">Part Name *</label><input class="input" id="qc-t-name" name="part_name" maxlength="200" required value="${esc(template?.part_name)}"${editable ? "" : " disabled"}></div>
          <div class="field"><label for="qc-t-customer">customer</label><input class="input" id="qc-t-customer" name="customer" maxlength="100" value="${esc(template?.customer)}"${editable ? "" : " disabled"}></div>
          <div class="field"><label for="qc-t-status">สถานะ</label><select class="select" id="qc-t-status" name="status"${editable ? "" : " disabled"}>
            <option value="active"${template?.status === "inactive" ? "" : " selected"}>ใช้งาน</option><option value="inactive"${template?.status === "inactive" ? " selected" : ""}>ปิดใช้งาน (ไม่แสดงตอนสร้างใบ)</option></select></div>
          <div class="field full"><label for="qc-t-note">คำอธิบายจุดวัด</label><textarea class="textarea" id="qc-t-note" name="drawing_note" rows="2" maxlength="500"${editable ? "" : " disabled"}>${esc(template?.drawing_note)}</textarea></div>
        </div>
        <h2>รายการตรวจ</h2>
        <div class="table-wrap"><table class="qc-table qc-template-table"><thead><tr><th>ITEM No.</th><th>Inspection Item</th><th>Instrument</th><th>หน่วย</th><th>MIN</th><th>STD</th><th>MAX</th><th>จุดวัด</th><th></th></tr></thead>
          <tbody id="qc-template-rows">${items.map((item) => templateRowHtml(item, editable)).join("")}</tbody></table></div>
        ${editable ? `<div class="qc-row-actions"><button class="btn secondary small" type="button" id="qc-add-row">+ เพิ่มรายการตรวจ</button></div>
          <div class="form-actions"><a class="btn secondary" href="${esc(urlFor({ view: "templates" }))}">ยกเลิก</a><button class="btn" type="submit">บันทึกแม่แบบ</button></div>` : ""}
      </form></div>`);
    if (!root || !editable) return;
    const form = root.querySelector("#qc-form");
    const body = root.querySelector("#qc-template-rows");
    root.querySelector("#qc-add-row")?.addEventListener("click", () => {
      const used = [...body.querySelectorAll('[name="item_no"]')].map((input) => input.value.trim().toUpperCase());
      body.insertAdjacentHTML("beforeend", templateRowHtml({ item_no: nextItemNo(used), name: "", instrument: "", unit: "", points_required: 5 }, true));
    });
    body.addEventListener("click", (event) => {
      event.target.closest?.("[data-remove-row]")?.closest("tr")?.remove();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const read = (row, name) => row.querySelector(`[name="${name}"]`)?.value ?? "";
      const parsed = model.templatePayload({
        id: template?.id, version: template?.version,
        part_number: form.elements.part_number.value, part_name: form.elements.part_name.value, customer: form.elements.customer.value,
        drawing_note: form.elements.drawing_note.value, status: form.elements.status.value,
        items: [...body.querySelectorAll("tr")].map((row) => Object.fromEntries(["item_no", "name", "instrument", "unit", "spec_min", "spec_std", "spec_max", "points_required"].map((name) => [name, read(row, name)]))),
      });
      if (parsed.error) return showError(root, parsed.error);
      setFormBusy(form, true);
      try {
        await rpc("app_qc_save_template", { p_payload: parsed.payload });
        showToast(template ? "บันทึกแม่แบบแล้ว" : "สร้างแม่แบบแล้ว");
        location.hash = urlFor({ view: "templates" });
      } catch (error) {
        setFormBusy(form, false);
        showError(root, friendlyError(error));
      }
      return undefined;
    });
  }

  // ---------- ฟอร์มใบตรวจ (new / edit) ----------
  const POINT_COLUMNS = [1, 2, 3, 4, 5];

  function tableHeadHtml(sampleLabel, withNote) {
    return `<thead>
        <tr><th rowspan="2">ITEM No.</th><th rowspan="2">Inspection Item</th><th rowspan="2">Instrument</th><th colspan="3" class="center">Specification</th>
          <th colspan="5" class="center">Sample (${esc(sampleLabel || "2M")})</th><th rowspan="2" class="right">min</th><th rowspan="2" class="right">max</th><th rowspan="2" class="right">average</th><th rowspan="2">Judge</th>${withNote ? '<th rowspan="2">หมายเหตุ</th>' : ""}</tr>
        <tr><th class="right">MIN</th><th class="right">STD</th><th class="right">MAX</th>${POINT_COLUMNS.map((point) => `<th class="center">${point}</th>`).join("")}</tr>
      </thead>`;
  }

  // แถวกรอกค่า: spec = สเปกของรายการ, value = ค่าที่กรอกไว้ ({ points[], note, accept }), slots = จำนวนช่อง point ที่เปิดให้กรอก
  function entryRowHtml(spec, value, slots) {
    const points = value?.points ?? [];
    const cells = POINT_COLUMNS.map((point) => (point <= slots
      ? `<td><input class="input qc-point" type="number" inputmode="decimal" step="any" data-point aria-label="รายการ ${esc(spec.item_no)} จุดที่ ${point}" value="${esc(num(points[point - 1]))}"></td>`
      : '<td class="qc-point-off"></td>')).join("");
    return `<tr data-item="${esc(spec.item_no)}">
        <th scope="row">${esc(spec.item_no)}</th>
        <td>${esc(spec.name)}${spec.unit ? ` <span class="muted small">(${esc(spec.unit)})</span>` : ""}</td>
        <td>${esc(orDash(spec.instrument))}</td>
        <td class="right">${esc(orDash(num(spec.spec_min)))}</td><td class="right">${esc(orDash(num(spec.spec_std)))}</td><td class="right">${esc(orDash(num(spec.spec_max)))}</td>
        ${cells}
        <td class="right" data-calc="min">—</td><td class="right" data-calc="max">—</td><td class="right" data-calc="avg">—</td>
        <td><span class="qc-judge" data-calc="judge">—</span>
          <label class="qc-accept" data-accept-label hidden><input type="checkbox" data-accept${value?.accept ? " checked" : ""}> ยอมรับ (AC)</label></td>
        <td><input class="input qc-note" data-note maxlength="500" aria-label="หมายเหตุรายการ ${esc(spec.item_no)}" value="${esc(value?.note)}"></td>
      </tr>`;
  }

  function lotsHtml() {
    return `<section class="card qc-lots"><h2>Lot ยางผสม</h2>
        <p class="muted small">เลือกจาก Lot ที่มีผลทดสอบ Mooney หรือพิมพ์ Lot เองแล้วกด Enter / “เพิ่ม” (ใส่ได้ไม่เกิน ${model.MAX_LOTS} Lot)</p>
        <div class="qc-chips" id="qc-lot-chips"></div>
        <div class="qc-lot-combo">
          <input class="input" id="qc-lot-input" type="text" maxlength="60" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="qc-lot-popup" aria-label="ค้นหาหรือพิมพ์ Lot ยางผสม" placeholder="ค้นหา Lot">
          <button class="btn secondary" type="button" id="qc-lot-add">เพิ่ม</button>
          <div class="qc-lot-popup" id="qc-lot-popup" data-popup role="listbox" hidden></div>
        </div>
      </section>`;
  }

  // Lot ยางผสม: chip รายการที่เลือก + ช่องค้นหา Lot จากผล Mooney (app_qc_lots) — popup ปิดด้วยกฎกลาง closePopup เท่านั้น
  function bindLots(root, lots) {
    const input = root.querySelector("#qc-lot-input");
    const popup = root.querySelector("#qc-lot-popup");
    const chips = root.querySelector("#qc-lot-chips");
    if (!input || !popup || !chips) return;
    let requestId = 0;
    let timer = null;

    const renderChips = () => {
      chips.innerHTML = lots.length
        ? lots.map((lot) => `<span class="qc-chip">${esc(lot)}<button type="button" data-remove-lot="${esc(lot)}" aria-label="เอา Lot ${esc(lot)} ออก">×</button></span>`).join("")
        : '<span class="muted small">ยังไม่ได้เลือก Lot</span>';
    };
    const addLot = (value) => {
      const lot = String(value ?? "").trim();
      if (!lot) return;
      if (lot.length > 60) return showToast("Lot ยางผสมต้องไม่เกิน 60 ตัวอักษร", "error");
      if (lots.includes(lot)) return showToast("เลือก Lot นี้ไว้แล้ว", "error");
      if (lots.length >= model.MAX_LOTS) return showToast(`ใส่ Lot ยางผสมได้ไม่เกิน ${model.MAX_LOTS} Lot`, "error");
      lots.push(lot);
      renderChips();
      clearTimeout(timer);
      input.value = "";
      if (!popup.hidden) closePopup(popup);
      return undefined;
    };
    const optionsHtml = (rows) => (rows.length
      ? rows.map((row) => `<button type="button" class="ss-option${lots.includes(row.lot_number) ? " is-selected" : ""}" role="option" data-lot="${esc(row.lot_number)}">
          <span><strong>${esc(row.lot_number)}</strong><br><small class="muted">${esc([row.material, `${row.tests} ครั้ง`, row.latest_test_date ? formatDate(row.latest_test_date) : ""].filter(Boolean).join(" · "))}</small></span></button>`).join("")
      : '<div class="ss-empty">ไม่พบ Lot ในผล Mooney — พิมพ์ Lot เองแล้วกด Enter ได้</div>');
    const showPopup = async () => {
      requestId += 1;
      const mine = requestId;
      popup.hidden = false;
      input.setAttribute("aria-expanded", "true");
      popup.innerHTML = '<div class="ss-empty">กำลังค้นหา…</div>';
      try {
        const rows = await rpc("app_qc_lots", { p_search: input.value.trim() });
        if (mine === requestId) popup.innerHTML = optionsHtml(Array.isArray(rows) ? rows : []);
      } catch (error) {
        if (mine === requestId) popup.innerHTML = `<div class="ss-empty">${esc(friendlyError(error))}</div>`;
      }
    };

    renderChips();
    input.addEventListener("focus", showPopup);
    input.addEventListener("click", () => { if (popup.hidden) showPopup(); });
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(showPopup, LOT_SEARCH_DELAY);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addLot(input.value);
      } else if (event.key === "Escape" && !popup.hidden) {
        closePopup(popup);
      }
    });
    root.querySelector("#qc-lot-add")?.addEventListener("click", () => addLot(input.value));
    popup.addEventListener("click", (event) => {
      const option = event.target.closest?.("[data-lot]");
      if (option) addLot(option.dataset.lot);
    });
    chips.addEventListener("click", (event) => {
      const remove = event.target.closest?.("[data-remove-lot]");
      if (!remove) return;
      const index = lots.indexOf(remove.dataset.removeLot);
      if (index >= 0) lots.splice(index, 1);
      renderChips();
    });
  }

  async function reportFormView({ params, access, view }) {
    const id = view === "edit" ? params.get("id") ?? "" : "";
    const back = { href: id ? urlFor({ view: "report", id }) : urlFor(), label: id ? "‹ กลับใบตรวจ" : "‹ กลับรายการใบตรวจ" };
    const [templates, report] = await Promise.all([rpc("app_qc_templates"), id ? rpc("app_qc_report", { p_id: id }) : null]);
    const gate = (message) => paint(`${TITLE} / ${id ? "แก้ไขใบตรวจ" : "สร้างใบตรวจ"}`, `<div class="qc-page">${headHtml({ title: id ? "แก้ไขใบตรวจ" : "สร้างใบตรวจ", back })}<section class="card">${notice(message)}</section></div>`);
    if (!access.edit) return gate("ตำแหน่งที่ทำหน้าที่อยู่สร้าง/แก้ไขใบตรวจไม่ได้ (ทำได้เฉพาะแผนก QA และผู้ดูแลระบบ) — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลือง");
    if (report && report.status !== "draft") return gate(model.ERROR_MESSAGES.QC_NOT_DRAFT);

    const known = templates ?? [];
    const requested = report?.template_id ?? params.get("template") ?? "";
    // แม่แบบที่ปิดใช้งานเลือกใหม่ไม่ได้ ยกเว้นที่ใบนี้ใช้อยู่
    const choices = known.filter((template) => template.status === "active" || template.id === report?.template_id);
    let current = choices.find((template) => template.id === requested) ?? null;
    // สเปกในใบเป็นภาพถ่าย ณ วันตรวจ (แก้ในใบได้) ใบที่เปิดแก้ใช้สเปกของใบเอง ส่วนใบใหม่/เปลี่ยน Part ใช้สเปกของแม่แบบ
    let specs = report ? report.items : (current?.items ?? []);
    // จำนวนช่อง point: ตามแม่แบบ แต่ไม่น้อยกว่าจำนวนค่าที่ใบเก็บไว้ (แม่แบบถูกลดจุดทีหลัง ค่าที่วัดแล้วต้องไม่หายเงียบ ๆ)
    const slotsFor = (item) => {
      const required = current?.items?.find((row) => row.item_no === item.item_no)?.points_required ?? model.MAX_POINTS;
      return Math.min(model.MAX_POINTS, Math.max(required, (item.points ?? []).length));
    };
    const values = new Map((report?.items ?? []).map((item) => [item.item_no, {
      points: item.points ?? [], note: item.note, accept: item.judge === "AC",
    }]));
    const lots = [...(report?.compound_lots ?? [])];
    const sampleLabel = report?.sample_label ?? "2M";
    const entryTableHtml = (label) => `${tableHeadHtml(label, true)}<tbody>${specs.length
      ? specs.map((spec) => entryRowHtml(spec, values.get(spec.item_no), slotsFor(spec))).join("")
      : `<tr><td colspan="15" class="muted">เลือก Part เพื่อแสดงรายการตรวจจากแม่แบบ</td></tr>`}</tbody>`;
    const orphan = report && !current ? model.partLabel(report.part_number, report.part_name) : "";
    const options = [`<option value=""${current ? "" : " selected"}>${esc(orphan || "— เลือก Part —")}</option>`,
      ...choices.map((template) => `<option value="${esc(template.id)}"${template.id === current?.id ? " selected" : ""}>${esc(model.partLabel(template.part_number, template.part_name))}</option>`)].join("");

    const root = paint(`${TITLE} / ${report ? `แก้ไข ${report.report_no}` : "สร้างใบตรวจ"}`, `<div class="qc-page">${headHtml({ title: report ? `แก้ไข ${report.report_no}` : "สร้างใบตรวจ", back })}
      <form id="qc-form" novalidate>
        ${errorBox()}
        <section class="card"><div class="form-grid">
          <div class="field"><label for="qc-r-template">Part / แม่แบบ *</label><select class="select" id="qc-r-template" name="template_id">${options}</select>
            <input type="hidden" name="part_number" value="${esc(report?.part_number ?? current?.part_number)}"></div>
          <div class="field"><label for="qc-r-name">Part Name *</label><input class="input" id="qc-r-name" name="part_name" maxlength="200" required value="${esc(report?.part_name ?? current?.part_name)}"></div>
          <div class="field"><label for="qc-r-customer">customer</label><input class="input" id="qc-r-customer" name="customer" maxlength="100" value="${esc(report?.customer ?? current?.customer)}"></div>
          <div class="field"><label for="qc-r-order">Order No.</label><input class="input" id="qc-r-order" name="order_no" maxlength="60" value="${esc(report?.order_no)}"></div>
          <div class="field"><label for="qc-r-code">Code</label><input class="input" id="qc-r-code" name="code" maxlength="60" value="${esc(report?.code)}"></div>
          <div class="field"><label for="qc-r-sample">Sample</label><input class="input" id="qc-r-sample" name="sample_label" maxlength="30" value="${esc(sampleLabel)}"></div>
          <div class="field"><label for="qc-r-date">inspection Date</label><input class="input" id="qc-r-date" name="inspected_at" type="datetime-local" value="${esc(model.bangkokInputValue(report?.inspected_at ?? undefined))}"></div>
        </div></section>
        ${lotsHtml()}
        <section class="card"><h2>ผลการตรวจ</h2>
          <div class="table-wrap"><table class="qc-table qc-entry-table" id="qc-entry-table">${entryTableHtml(sampleLabel)}</table></div>
          <p class="qc-result" id="qc-result" aria-live="polite"></p>
        </section>
        <section class="card"><div class="field"><label for="qc-r-remark">REMARK</label><textarea class="textarea" id="qc-r-remark" name="remark" rows="3" maxlength="2000">${esc(report?.remark)}</textarea></div>
          <div class="form-actions"><a class="btn secondary" href="${esc(back.href)}">ยกเลิก</a><button class="btn" type="submit">บันทึกร่าง</button></div>
        </section>
      </form></div>`);
    if (!root) return;

    const form = root.querySelector("#qc-form");
    const table = root.querySelector("#qc-entry-table");
    const resultNode = root.querySelector("#qc-result");

    const rowValue = (row) => ({
      item_no: row.dataset.item,
      points: [...row.querySelectorAll("[data-point]")].map((input) => input.value),
      note: row.querySelector("[data-note]")?.value ?? "",
      accept: row.querySelector("[data-accept]")?.checked === true,
    });
    const rows = () => [...table.querySelectorAll("tbody tr[data-item]")];
    // คำนวณแถวเดียวสด และคืนผลของรายการ (AC เมื่อผู้ตรวจยอมรับรายการที่เป็น N)
    const refreshRow = (row) => {
      const spec = specs.find((item) => item.item_no === row.dataset.item);
      const entry = rowValue(row);
      const calc = model.computeItem({ points: entry.points, spec_min: spec?.spec_min, spec_max: spec?.spec_max });
      const label = row.querySelector("[data-accept-label]");
      const checkbox = row.querySelector("[data-accept]");
      if (label) label.hidden = calc.judge !== "N";
      if (calc.judge !== "N" && checkbox) checkbox.checked = false;
      const judge = calc.judge === "N" && checkbox?.checked ? "AC" : calc.judge;
      const set = (name, text) => { const node = row.querySelector(`[data-calc="${name}"]`); if (node) node.textContent = text; };
      set("min", calc.min === null ? "—" : String(calc.min));
      set("max", calc.max === null ? "—" : String(calc.max));
      set("avg", calc.avg === null ? "—" : String(calc.avg));
      const judgeNode = row.querySelector('[data-calc="judge"]');
      if (judgeNode) {
        judgeNode.textContent = judge ?? "—";
        judgeNode.className = `qc-judge ${judge ? model.JUDGE_CLASSES[judge] : ""}`;
        judgeNode.title = judge ? model.JUDGE_LABELS[judge] : "";
      }
      return judge;
    };
    const refreshAll = () => {
      const result = model.computeResult(rows().map(refreshRow));
      if (resultNode) resultNode.innerHTML = result ? `ผลรวม ${resultBadge(result)}` : "ผลรวม — (กรอกค่าที่วัดได้)";
    };
    const drawTable = () => {
      table.innerHTML = entryTableHtml(form.elements.sample_label.value);
      refreshAll();
    };
    refreshAll();
    bindLots(root, lots);

    table.addEventListener("input", (event) => { if (event.target.closest?.("tr[data-item]")) refreshAll(); });
    table.addEventListener("change", (event) => { if (event.target.closest?.("tr[data-item]")) refreshAll(); });
    form.elements.sample_label.addEventListener("input", () => {
      const head = table.querySelector("thead th[colspan='5']");
      if (head) head.textContent = `Sample (${form.elements.sample_label.value.trim() || "2M"})`;
    });
    // เปลี่ยน Part: ใช้สเปกของแม่แบบใหม่ ค่าที่กรอกไว้ของรายการที่ ITEM No. ตรงกันยังอยู่
    form.elements.template_id.addEventListener("change", () => {
      for (const row of rows()) values.set(row.dataset.item, rowValue(row));
      current = choices.find((template) => template.id === form.elements.template_id.value) ?? null;
      if (current) {
        form.elements.part_number.value = current.part_number;
        form.elements.part_name.value = current.part_name;
        form.elements.customer.value = current.customer ?? "";
        specs = current.items;
      } else {
        specs = [];
      }
      drawTable();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const parsed = model.reportPayload({
        id: report?.id, version: report?.version, template_id: form.elements.template_id.value,
        part_number: form.elements.part_number.value, part_name: form.elements.part_name.value, customer: form.elements.customer.value,
        order_no: form.elements.order_no.value, code: form.elements.code.value, sample_label: form.elements.sample_label.value,
        inspected_at: form.elements.inspected_at.value, remark: form.elements.remark.value, compound_lots: lots,
        items: rows().map(rowValue),
      }, specs.map((spec) => ({ ...spec })));
      if (parsed.error) return showError(root, parsed.error);
      setFormBusy(form, true);
      try {
        const saved = await rpc("app_qc_save_report", { p_payload: parsed.payload });
        showToast(report ? "บันทึกฉบับร่างแล้ว" : `สร้างใบตรวจ ${saved?.report_no ?? ""} แล้ว (ฉบับร่าง)`);
        location.hash = urlFor({ view: "report", id: saved.id });
      } catch (error) {
        setFormBusy(form, false);
        showError(root, friendlyError(error));
      }
      return undefined;
    });
  }

  // ---------- หน้าใบตรวจ ----------
  const definition = (label, value) => `<div class="definition"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

  function infoHtml(report) {
    return `<section class="card"><dl class="definition-grid">
        ${definition("Part Number", esc(model.partNumberText(report.part_number)))}
        ${definition("Part Name", esc(report.part_name))}
        ${definition("customer", esc(orDash(report.customer)))}
        ${definition("Order No.", esc(orDash(report.order_no)))}
        ${definition("Code", esc(orDash(report.code)))}
        ${definition("Inspecter By", esc(orDash(report.inspector_name)))}
        ${definition("inspection Date", report.inspected_at ? esc(formatDate(report.inspected_at, true)) : "—")}
        ${definition("Results", resultBadge(report.result))}
        ${report.ncr_no ? definition("NCR", `<a href="#/ncr?id=${encodeURIComponent(report.ncr_id)}">${esc(report.ncr_no)}</a>`) : ""}
      </dl></section>`;
  }

  // หน้านี้เปิดได้เฉพาะโหมดทดสอบ ซึ่ง persona ไม่มีสิทธิ์ MNP LAB และ #/lab ไม่ใช่ route ของโหมดทดสอบ จึงแสดงชื่อวัสดุเป็นข้อความ
  function materialLinks(material) {
    const names = String(material ?? "").split(", ").filter(Boolean);
    return names.length ? esc(names.join(", ")) : "—";
  }

  const reading = (value) => (value === null || value === undefined ? "—" : esc(window.MNP_LAB_MOONEY?.formatReading?.(value) ?? Number(value).toFixed(2)));

  function mooneyHtml(report) {
    const lab = report.lab ?? [];
    if (!lab.length) return "";
    const rows = lab.map((row) => (row.found
      ? `<tr><td><strong>${esc(row.lot_number)}</strong></td><td>${materialLinks(row.material)}</td><td class="right">${esc(row.tests)}</td>
          <td>${row.latest_test_date ? esc(formatDate(row.latest_test_date)) : "—"}</td><td class="right">${reading(row.avg_mh)}</td><td class="right">${reading(row.avg_mv)}</td></tr>`
      : `<tr><td><strong>${esc(row.lot_number)}</strong></td><td colspan="5" class="muted">ยังไม่มีผล Mooney ของ Lot นี้ในระบบ</td></tr>`)).join("");
    return `<section class="card"><h2>ยางผสม (Mooney)</h2><div class="table-wrap"><table class="qc-table">
        <thead><tr><th>Lot</th><th>วัสดุ</th><th class="right">ผลทดสอบ (ครั้ง)</th><th>ทดสอบล่าสุด</th><th class="right">AVG MH</th><th class="right">AVG MV</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function itemsHtml(report) {
    const body = (report.items ?? []).map((item) => {
      const cells = POINT_COLUMNS.map((point) => `<td class="right">${esc(num((item.points ?? [])[point - 1]))}</td>`).join("");
      return `<tr><th scope="row">${esc(item.item_no)}</th>
        <td>${esc(item.name)}${item.unit ? ` <span class="muted small">(${esc(item.unit)})</span>` : ""}</td>
        <td>${esc(orDash(item.instrument))}</td>
        <td class="right">${esc(num(item.spec_min))}</td><td class="right">${esc(num(item.spec_std))}</td><td class="right">${esc(num(item.spec_max))}</td>
        ${cells}
        <td class="right">${esc(num(item.point_min))}</td><td class="right">${esc(num(item.point_max))}</td><td class="right">${esc(num(item.point_avg))}</td>
        <td><span class="qc-judge ${esc(model.JUDGE_CLASSES[item.judge] ?? "")}" title="${esc(model.JUDGE_LABELS[item.judge] ?? "")}">${esc(item.judge === "NA" ? "—" : item.judge)}</span></td>
        <td class="qc-pre">${esc(item.note)}</td></tr>`;
    }).join("");
    return `<section class="card"><div class="table-wrap"><table class="qc-table">${tableHeadHtml(report.sample_label, true)}<tbody>${body || '<tr><td colspan="15" class="muted">ใบนี้ยังไม่มีรายการตรวจ</td></tr>'}</tbody></table></div>
        <h3>REMARK</h3><p class="qc-pre">${esc(report.remark) || "—"}</p></section>`;
  }

  // ช่องลงนาม 4 ช่องตามฟอร์ม: Inspector (ลงนามเมื่อส่งใบ) + 3 ขั้นอนุมัติ ตามแบบ signoff ของ module-ncr.js
  function signHtml(report) {
    const submitted = report.status !== "draft" && report.status !== "cancelled" && report.inspected_by;
    const box = (role, inner) => `<div class="qc-sign"><span class="qc-sign-role">${esc(role)}</span>${inner}</div>`;
    // ชื่อและวันที่ของผู้ตรวจอยู่ในหัวใบแล้ว (Inspecter By / inspection Date) ช่องนี้บอกแค่ว่าลงนามแล้ว
    const inspector = box("Inspector", submitted ? "<strong>✓ ลงนามแล้ว</strong>" : "<strong>—</strong>");
    const steps = model.STEPS.map((step) => {
      const approval = (report.approvals ?? []).find((row) => row.step_order === step.order);
      const name = fullName(approval);
      let inner = "<strong>—</strong>";
      if (approval?.status === "approved") inner = `<strong>✓ ${esc(name)}</strong><span class="muted small">${esc(formatDate(approval.acted_at, true))}</span>`;
      else if (approval?.status === "rejected") inner = `<strong class="qc-sign-no">✗ ไม่อนุมัติ · ${esc(name)}</strong><span class="muted small">${esc(formatDate(approval.acted_at, true))}</span>${approval.comment ? `<span class="small qc-pre">${esc(approval.comment)}</span>` : ""}`;
      else if (report.status === step.pending) inner = '<strong class="qc-sign-wait">รออนุมัติ</strong>';
      return box(step.label, inner);
    });
    return `<section class="card"><h2>ลงนาม</h2><div class="qc-sign-grid">${[inspector, ...steps].join("")}</div></section>`;
  }

  function historyHtml(report) {
    const entries = report.history ?? [];
    if (!entries.length) return "";
    return `<section class="card"><h2>ประวัติ</h2><div class="timeline">${entries.map((entry) => `<div class="timeline-item"><strong>${esc(model.HISTORY_LABELS[entry.action] ?? entry.action)}</strong>
        <p>${esc(orDash(entry.changed_by_name))} · ${esc(formatDate(entry.created_at, true))}</p>${entry.note ? `<p class="timeline-item-detail">${esc(entry.note)}</p>` : ""}</div>`).join("")}</div></section>`;
  }

  function defaultNcrDescription(report) {
    if (String(report.remark ?? "").trim()) return report.remark;
    const failed = (report.items ?? []).filter((item) => item.judge === "N");
    return failed.map((item) => `${item.item_no} ${item.name} วัดได้ ${num(item.point_min)}–${num(item.point_max)} สเปก ${orDash(num(item.spec_min))}–${orDash(num(item.spec_max))}`).join("; ");
  }

  function ncrFormHtml(report, defectTypes, typesFailed) {
    const unit = (report.items ?? []).map((item) => item.unit).find((value) => model.NCR_UNITS.includes(value)) ?? "";
    return `<details class="fm-review-details"><summary>เปิด NCR (ผลรวมไม่ผ่าน)</summary>
      <form class="qc-action-form" id="qc-ncr-form" novalidate>
        ${errorBox("qc-ncr-error")}
        ${typesFailed ? '<p class="form-message error">โหลดประเภทข้อบกพร่องของ NCR ไม่สำเร็จ ลองเปิดหน้านี้ใหม่</p>' : ""}
        <div class="form-grid">
          <div class="field"><label for="qc-ncr-total">จำนวนที่ตรวจ *</label><input class="input" id="qc-ncr-total" name="qty_total" type="number" inputmode="decimal" min="0" step="any" required></div>
          <div class="field"><label for="qc-ncr-defect">จำนวนเสีย *</label><input class="input" id="qc-ncr-defect" name="qty_defect" type="number" inputmode="decimal" min="0" step="any" required></div>
          <div class="field"><label for="qc-ncr-unit">หน่วย *</label><select class="select" id="qc-ncr-unit" name="unit"><option value="">— เลือก —</option>${model.NCR_UNITS.map((value) => `<option${value === unit ? " selected" : ""}>${esc(value)}</option>`).join("")}</select></div>
          <div class="field"><label for="qc-ncr-type">ประเภทข้อบกพร่อง *</label><select class="select" id="qc-ncr-type" name="defect_type_code"><option value="">— เลือก —</option>${defectTypes.map((type) => `<option value="${esc(type.code)}">${esc(type.name_th)}</option>`).join("")}</select></div>
          <div class="field full"><label for="qc-ncr-desc">คำอธิบายความไม่ผ่าน * (อย่างน้อย 10 ตัวอักษร ใช้เป็นรายละเอียดของ NCR)</label><textarea class="textarea" id="qc-ncr-desc" name="description" rows="3" maxlength="4000">${esc(defaultNcrDescription(report))}</textarea></div>
        </div>
        <div class="form-actions"><button class="btn" type="submit">เปิด NCR</button></div>
      </form></details>`;
  }

  function cancelFormHtml() {
    return `<details class="fm-review-details"><summary>ยกเลิกใบนี้</summary>
      <form class="qc-action-form" id="qc-cancel-form" novalidate>
        <div class="field full"><label for="qc-cancel-note">เหตุผลที่ยกเลิก * (อย่างน้อย 5 ตัวอักษร)</label><textarea class="textarea" id="qc-cancel-note" name="note" rows="2" maxlength="1000"></textarea></div>
        <div class="form-actions"><button class="btn danger" type="submit">ยกเลิกใบตรวจ</button></div>
      </form></details>`;
  }

  // เปิด NCR ได้เมื่อผลรวมไม่ผ่าน ยังไม่มี NCR และส่งอนุมัติแล้ว (pending_* หรือ approved) — ใบร่าง/ไม่อนุมัติ/ยกเลิกเปิดไม่ได้
  const canIssueNcr = (report, access) => access.edit && report.result === "ng" && !report.ncr_id
    && (report.status === "approved" || model.STEPS.some((step) => step.pending === report.status));

  // ปุ่มตามสถานะ + สิทธิ์ของ persona (ตัวบังคับจริงคือ RPC)
  function actionsHtml(report, access, defectTypes, typesFailed) {
    const blocks = [];
    const pendingStep = model.STEPS.find((step) => step.pending === report.status);
    if (report.status === "draft" && access.edit) {
      blocks.push(`<div class="qc-action-row"><a class="btn secondary" href="${esc(urlFor({ view: "edit", id: report.id }))}">แก้ไข</a>
        <button class="btn" type="button" data-qc-action="submit">ส่งอนุมัติ</button></div>`);
    }
    if (pendingStep && access.steps.includes(pendingStep.code)) {
      blocks.push([report.inspected_by, report.created_by].includes(state.employee?.id)
        ? `<p class="muted small">${esc(model.ERROR_MESSAGES.QC_SELF_APPROVAL)}</p>`
        : `<form class="qc-action-form" id="qc-decide-form" novalidate>
            <h3>พิจารณา: ${esc(pendingStep.label)}</h3>
            ${errorBox("qc-decide-error")}
            <div class="field full"><label for="qc-decide-comment">ความเห็น (จำเป็นเมื่อไม่อนุมัติ อย่างน้อย 5 ตัวอักษร)</label><textarea class="textarea" id="qc-decide-comment" name="comment" rows="2" maxlength="1000"></textarea></div>
            <div class="form-actions"><button class="btn danger" type="button" data-decision="reject">ไม่อนุมัติ</button><button class="btn" type="button" data-decision="approve">อนุมัติ</button></div>
          </form>`);
    }
    if (report.status === "rejected" && access.edit) {
      blocks.push('<div class="qc-action-row"><button class="btn" type="button" data-qc-action="reopen">เปิดแก้ไขใหม่</button></div>');
    }
    if (["draft", "rejected"].includes(report.status) && !report.ncr_id && access.edit) blocks.push(cancelFormHtml());
    if (canIssueNcr(report, access)) blocks.push(ncrFormHtml(report, defectTypes, typesFailed));
    return blocks.length ? `<section class="card qc-actions"><h2>สิ่งที่ทำได้</h2>${blocks.join("")}</section>` : "";
  }

  async function loadDefectTypes() {
    const { data, error } = await sb.from("ncr_defect_types").select("code,name_th").eq("is_active", true).order("sort_order");
    if (error) throw error;
    return data ?? [];
  }

  function bindReport(root, report) {
    const args = { p_id: report.id, p_version: report.version };
    root.querySelector('[data-qc-action="submit"]')?.addEventListener("click", () => {
      if (confirm(`ส่ง ${report.report_no} ขออนุมัติ? หลังส่งแล้วแก้ไขไม่ได้จนกว่าจะไม่อนุมัติ`)) runAction(root, "app_qc_submit_report", args, "ส่งขออนุมัติแล้ว");
    });
    root.querySelector('[data-qc-action="reopen"]')?.addEventListener("click", () => {
      if (confirm(`เปิด ${report.report_no} กลับเป็นฉบับร่างเพื่อแก้ไข? ลายเซ็นเดิมจะถูกล้าง`)) runAction(root, "app_qc_reopen_report", args, "เปิดกลับเป็นฉบับร่างแล้ว");
    });
    root.querySelectorAll("[data-decision]").forEach((button) => button.addEventListener("click", () => {
      const decision = button.dataset.decision;
      const comment = root.querySelector("#qc-decide-comment")?.value ?? "";
      if (decision === "reject" && comment.trim().length < 5) return showError(root, model.ERROR_MESSAGES.QC_REJECT_COMMENT_REQUIRED, "#qc-decide-error");
      if (!confirm(decision === "approve" ? `อนุมัติ ${report.report_no}?` : `ไม่อนุมัติ ${report.report_no}?`)) return undefined;
      return runAction(root, "app_qc_decide_report", { ...args, p_decision: decision, p_comment: comment.trim() }, decision === "approve" ? "อนุมัติแล้ว" : "ไม่อนุมัติแล้ว");
    }));
    root.querySelector("#qc-cancel-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const note = root.querySelector("#qc-cancel-note")?.value.trim() ?? "";
      if (note.length < 5) return showToast(model.ERROR_MESSAGES.QC_CANCEL_NOTE_REQUIRED, "error");
      if (!confirm(`ยกเลิก ${report.report_no}? แก้กลับไม่ได้`)) return undefined;
      return runAction(root, "app_qc_cancel_report", { ...args, p_note: note }, `ยกเลิก ${report.report_no} แล้ว`);
    });
    root.querySelector("#qc-ncr-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const parsed = model.ncrArgs(Object.fromEntries(["qty_total", "qty_defect", "unit", "defect_type_code", "description"].map((name) => [name, form.elements[name]?.value])));
      if (parsed.error) return showError(root, parsed.error, "#qc-ncr-error");
      if (!confirm("เปิด NCR จากใบตรวจนี้? ใบละ 1 NCR เปิดซ้ำไม่ได้")) return undefined;
      return runAction(root, "app_qc_issue_ncr", { ...args, ...parsed.args }, (data) => `เปิด NCR ${data?.ncr_no ?? ""} แล้ว`);
    });
    const exportButton = root.querySelector("#qc-export");
    exportButton?.addEventListener("click", () => sheet.downloadXlsx(exportButton, model.buildFormExport(report), { showToast, friendlyError }));
  }

  async function reportView({ params, access }) {
    const id = params.get("id") ?? "";
    const back = { href: urlFor(), label: "‹ กลับรายการใบตรวจ" };
    const gone = () => paint(`${TITLE} / ใบตรวจ`, `<div class="qc-page">${headHtml({ title: "ใบตรวจ", back })}<section class="card">${notice(model.ERROR_MESSAGES.QC_NOT_FOUND)}</section></div>`);
    if (!id) return gone();
    let report;
    try {
      report = await rpc("app_qc_report", { p_id: id });
    } catch (error) {
      if (String(error?.message ?? "").includes("QC_NOT_FOUND")) return gone();
      throw error;
    }
    let defectTypes = [];
    let typesFailed = false;
    if (canIssueNcr(report, access)) {
      try {
        defectTypes = await loadDefectTypes();
      } catch (error) {
        console.warn("โหลดประเภทข้อบกพร่อง NCR ไม่สำเร็จ", error);
        typesFailed = true;
      }
    }
    const exportButton = sheet.EXPORT_URL ? '<button class="btn" type="button" id="qc-export" title="ดาวน์โหลดเป็นแบบฟอร์ม QA01-PM11">ดาวน์โหลด Excel</button>' : "";
    const root = paint(`${TITLE} / ${report.report_no}`, `<div class="qc-page">${headHtml({ title: report.report_no, back, actions: exportButton, badge: statusBadge(report.status) })}
      ${infoHtml(report)}${mooneyHtml(report)}${itemsHtml(report)}${signHtml(report)}${actionsHtml(report, access, defectTypes, typesFailed)}${historyHtml(report)}</div>`);
    if (root) bindReport(root, report);
    // หน้านี้ถูกวาดใหม่หลังบันทึกและหลังทุกการกระทำ จึงสำเนาไปสเปรดชีตตรงนี้ที่เดียว (modules/qc-sheet.js)
    // เป็นแค่สำเนาสำรอง ผิดพลาดต้องไม่ทำให้หน้าใบตรวจพัง
    try {
      sheet.sync(model.buildSheetRecord(report));
    } catch (error) {
      console.warn("เตรียมข้อมูลใบตรวจ QC สำหรับสเปรดชีตไม่สำเร็จ", error);
    }
    return undefined;
  }

  // ---------- หน้า #/qc ----------
  const VIEWS = { "": listView, templates: templatesView, template: templateFormView, new: reportFormView, edit: reportFormView, report: reportView };

  async function renderQc(params) {
    // เมนูข้างโผล่เฉพาะโหมดทดสอบ แต่ URL พิมพ์เข้ามาเองได้ — ผู้ใช้นอกโหมดทดสอบต้องไม่เห็นหน้านี้
    if (!state.employee?.isSandbox) return renderNotFound();
    const view = params.get("view") ?? "";
    loadingShell(PATH, TITLE);
    try {
      const access = await loadAccess();
      if (!access.read) {
        paint(TITLE, `${headHtml({ title: TITLE })}<section class="card">${notice("ตำแหน่งที่ทำหน้าที่อยู่ดูใบตรวจ QC ไม่ได้ (เฉพาะแผนก QA, ผจก.โรงงาน, ผจก.ทั่วไป และผู้ดูแลระบบ) — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลือง")}</section>`);
        return undefined;
      }
      const handler = Object.hasOwn(VIEWS, view) ? VIEWS[view] : listView;
      await handler({ params, access, view });
    } catch (error) {
      errorPage(error);
    }
    return undefined;
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.QC = {
    code: "QC",
    enabled: true,
    // ตาราง qc_* แยกข้อมูลทดสอบด้วย is_test แล้ว (20261027010000) และเปิดเฉพาะโหมดทดสอบ
    sandbox: true,
    standalone: true,
    label: TITLE,
    theme: THEME,
    errorMessages: model.ERROR_MESSAGES,
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON, sandboxOnly: true }],
    pages: { [PATH]: renderQc },
  };
})();
