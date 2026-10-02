// โมดูล NCR (QA02-FM01 Rev.00) ของ Pilot Web — Phase 1
//
// ใบรายงานผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนดมี workflow ของตัวเองในตาราง ncr_* (ไม่ใช่ requests)
// ดู supabase/migrations/20261002020000_ncr_phase1.sql:
//   ส่วนที่ 1 ออก NCR (พนักงานทุกคน) -> ส่วนที่ 2 ผจก.โรงงานพิจารณา -> ส่วนที่ 3 ผจก.แผนกที่รับผิดชอบตอบ
//   -> ส่วนที่ 4 QA ติดตามผล -> ลงนาม ผจก.QA -> ผจก.โรงงาน -> ผจก.ทั่วไป -> ปิด
// การ์ด "NCR/CAR" ในหน้าสร้างคำร้องเปิดฟอร์ม NCR นี้แทนฟอร์มคำร้องทั่วไป ส่วนทะเบียน/รายละเอียด
// อยู่ที่ #/ncr และ #/ncr?id=<uuid> (app.js เรียกผ่าน pages.ncr)
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — ฟังก์ชันข้างในเรียก helper ของ app.js (sb, state, shell,
// bindShell, loadingShell, escapeHtml, formatDate, showToast, friendlyError, setFormBusy,
// loadEmployeeDirectory, personName, DEPT_MANAGER_ROLE_CODES) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// การคำนวณสิทธิ์ในไฟล์นี้ใช้ตัดสินว่าจะแสดงฟอร์มไหนเท่านั้น RPC ในฐานข้อมูลเป็นตัวบังคับสิทธิ์จริง
//
// CAR (MR04-FM01) ยังเป็นคำร้องทั่วไปจนถึง Phase 2 — คู่กับฝั่ง Next.js: src/lib/request-modules/module-ncr.ts
(function registerNcrCarModule() {
  const STATUS_LABELS = {
    awaiting_disposition: "รอ ผจก.โรงงานพิจารณา",
    awaiting_response: "รอแผนกตอบ",
    awaiting_followup: "รอ QA ติดตามผล",
    awaiting_signoff: "รอลงนามปิด",
    closed: "ปิดแล้ว",
    cancelled: "ยกเลิก",
  };
  const OPEN_STATUSES = ["awaiting_disposition", "awaiting_response", "awaiting_followup", "awaiting_signoff"];
  const SOURCES = { incoming: "In-Coming", in_process: "In-Process", final_fg: "Final FG", customer_reject: "Reject from Customer", other: "Other" };
  const UNITS = ["ชุด", "ชิ้น", "เซต", "ม้วน", "เส้น", "กก.", "ท่อน", "เมตร", "ลูก", "ใบ", "รายการ"];
  const DISPOSITIONS = { return: "ส่งคืนพ่อค้า", accept: "ยอมรับใช้สภาพตามนั้น", reproduce: "ผลิตเพิ่มตามจำนวนที่ขาด", exchange: "แลกเปลี่ยน", repair: "ซ่อมแซม", sort: "คัดแยก", scrap: "ทิ้ง / ทำลาย", sell: "จำหน่าย", other: "อื่นๆ" };
  const CAUSES = { man: "บุคลากร", machine: "เครื่องจักร", material: "วัตถุดิบ", method: "วิธีการ", measure: "การวัด", environment: "สิ่งแวดล้อม", other: "อื่นๆ" };
  const LOSS_TYPES = { scrap: "ของเสีย/ทิ้ง", rework: "ค่าแรงซ่อม/Rework", sort: "ค่าแรงคัดแยก", reproduce: "ผลิตทดแทน", logistics: "ขนส่ง/ส่งคืน", claim: "เคลม/ส่วนลดลูกค้า", downtime: "เครื่องหยุด/รอ", other: "อื่นๆ" };
  const LABOR_LOSS_TYPES = ["rework", "sort", "downtime"];
  const STATUS_BADGE_CLASS = { closed: "completed", cancelled: "cancelled" };

  const ERROR_MESSAGES = {
    NCR_NOT_FOUND: "ไม่พบ NCR นี้ หรือคุณไม่มีสิทธิ์เปิดดู",
    NCR_RETURN_NOTE_REQUIRED: "กรุณาระบุเหตุผลที่ส่งกลับให้แผนกแก้ไขคำตอบ",
    NCR_LOCKED: "NCR นี้ปิดหรือยกเลิกแล้ว แก้ไขความสูญเสียไม่ได้",
    INVALID_PRODUCT_NAME: "กรุณากรอกชื่อสินค้า/วัตถุดิบ 2–300 ตัวอักษร",
    INVALID_NCR_DESCRIPTION: "รายละเอียดปัญหาต้องมี 10–5,000 ตัวอักษร",
    INVALID_QUANTITY: "จำนวนไม่ถูกต้อง: จำนวนทั้งหมดและที่พบปัญหาต้องมากกว่า 0 และจำนวนสุ่ม/พบปัญหา/ส่งคืนต้องไม่เกินจำนวนทั้งหมด",
    INVALID_UNIT: "กรุณาเลือกหน่วย",
    INVALID_SOURCE: "กรุณาเลือกแหล่งที่พบ",
    INVALID_DEFECT_TYPE: "กรุณาเลือกประเภทข้อบกพร่อง",
    INVALID_DISPOSITION: "กรุณาเลือกวิธีจัดการอย่างน้อย 1 ข้อ",
    INVALID_RESPONSIBILITIES: "กรุณาเลือกแผนกที่รับผิดชอบอย่างน้อย 1 แผนก (ไม่เกิน 10 แผนก)",
    INVALID_CAUSES: "กรุณาเลือกสาเหตุ (4M) อย่างน้อย 1 ข้อ",
    INVALID_ROOT_CAUSE: "กรุณาระบุสาเหตุของปัญหา",
    INVALID_CORRECTION: "กรุณาระบุแนวทางการแก้ไขปัญหา",
    INVALID_PREVENTION: "กรุณาระบุแนวทางการป้องกันไม่ให้เกิดซ้ำ",
    INVALID_DUE_DATE: "กรุณาระบุกำหนดเสร็จ (ต้องไม่ก่อนวันที่ออก NCR)",
    INVALID_FOLLOWUP_RESULT: "กรุณาเลือกผลการติดตาม",
    INVALID_REASON: "กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร",
    INVALID_NOTE: "หมายเหตุยาวเกินไป",
    INVALID_LOSS_TYPE: "กรุณาเลือกประเภทความสูญเสีย",
    INVALID_LOSS: "จำนวนต้องมากกว่า 0 และราคาต่อหน่วยต้องไม่ติดลบ",
    LOSS_NOT_FOUND: "ไม่พบรายการความสูญเสียนี้",
    LOSS_ALREADY_VOIDED: "รายการนี้ถูกยกเลิกไปแล้ว",
    INVALID_ATTACHMENT: "ไฟล์แนบไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่",
    ATTACHMENT_NOT_UPLOADED: "อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่",
  };

  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>`;

  const roleCode = (employee) => employee?.role?.code ?? "";
  const isQa = (employee) => employee?.department?.code === "QA";
  const isDeptManager = (employee) => DEPT_MANAGER_ROLE_CODES.includes(roleCode(employee));
  const isQaManager = (employee) => isQa(employee) && isDeptManager(employee);
  const todayBangkok = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  // กำหนดตอบนับจากวันออกใบ (+5 วัน) จึงเกินกำหนดได้ตั้งแต่ยังรอ ผจก.โรงงานพิจารณา
  const RESPONSE_PENDING_STATUSES = ["awaiting_disposition", "awaiting_response"];
  const isOverdue = (ncr) => RESPONSE_PENDING_STATUSES.includes(ncr.status) && Boolean(ncr.response_due) && ncr.response_due < todayBangkok();
  const addDays = (iso, days) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  const ATTACHMENT_SECTION_BY_STATUS = { awaiting_disposition: "report", awaiting_response: "response" };
  const ATTACHMENT_ACCEPT = "image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx";
  const ATTACHMENT_HINT = "รูปภาพ (รวม HEIC จากมือถือ) PDF TXT DOCX XLSX ไม่เกิน 10 MB";
  const evidenceFieldHtml = (id, label) => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" name="evidence" type="file" accept="${ATTACHMENT_ACCEPT}"><small>${ATTACHMENT_HINT}</small></div>`;
  // อ่านไฟล์จากฟอร์มและตรวจขนาด/ชนิดก่อนเรียก RPC (optionalAttachment ของ app.js โยน error เป็นข้อความไทย)
  const evidenceOf = (form) => (form.elements.evidence ? optionalAttachment(form.elements.evidence.files[0]) : null);

  async function uploadNcrAttachment(ncrId, file, section) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storagePath = `${ncrId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await sb.storage.from("ncr-attachments").upload(storagePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await sb.rpc("app_ncr_add_attachment", { p_ncr_id: ncrId, p_section: section, p_storage_path: storagePath, p_file_name: file.name.slice(0, 255) });
    if (error) {
      await sb.storage.from("ncr-attachments").remove([storagePath]);
      throw error;
    }
  }
  const formatQty = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("th-TH", { maximumFractionDigits: 3 }));
  const formatBaht = (value) => `${Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
  const optionalText = (form, name) => {
    const value = String(new FormData(form).get(name) ?? "").trim();
    return value === "" ? null : value;
  };
  const optionalNumber = (form, name) => {
    const value = optionalText(form, name);
    return value === null ? null : Number(value.replaceAll(",", ""));
  };
  const checkedValues = (form, name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);

  function statusBadgeHtml(ncr) {
    const badge = `<span class="badge ${STATUS_BADGE_CLASS[ncr.status] ?? "pending_approval"}">${escapeHtml(STATUS_LABELS[ncr.status] ?? ncr.status)}</span>`;
    return isOverdue(ncr) ? `${badge} <span class="badge urgent-flag">เกินกำหนดตอบ</span>` : badge;
  }

  function checksHtml(name, options, selected = []) {
    return `<div class="ncr-checks">${Object.entries(options).map(([value, label]) => `<label class="ncr-check"><input type="checkbox" name="${name}" value="${escapeHtml(value)}"${selected.includes(value) ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("")}</div>`;
  }

  function radiosHtml(name, options) {
    return `<div class="ncr-checks">${Object.entries(options).map(([value, label]) => `<label class="ncr-check"><input type="radio" name="${name}" value="${escapeHtml(value)}" required><span>${escapeHtml(label)}</span></label>`).join("")}</div>`;
  }

  function showFormError(form, error) {
    const box = form.querySelector(".ncr-form-message");
    if (box) {
      box.innerHTML = `<div class="form-message error" role="alert">${escapeHtml(friendlyError(error))}</div>`;
      box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ---- ส่วนที่ 1: ฟอร์มออก NCR (ใช้ทั้งจากการ์ดในหน้าสร้างคำร้อง และ #/ncr?new=1) ----
  async function loadDefectTypes() {
    const { data, error } = await sb.from("ncr_defect_types").select("code,name_th").eq("is_active", true).order("sort_order");
    if (error) throw error;
    return data ?? [];
  }

  function issueFormHtml(defectTypes, employee) {
    return `
      <section class="card ncr-card"><form id="ncr-issue-form" novalidate>
        <div class="ncr-form-message"></div>
        <p class="muted small">ส่วนที่ 1 ผู้รายงาน/ผู้ตรวจสอบ (ตรวจตามค่า AQL Level 2.5) · ผู้รายงาน ${escapeHtml(`${employee.first_name} ${employee.last_name}`)} แผนก ${escapeHtml(employee.department?.code ?? "—")} · เลขที่ QAxxx/yy ออกให้เมื่อกดออก NCR</p>
        <div class="form-grid">
          <div class="field"><label for="ncr-product-code">รหัสสินค้า/วัตถุดิบ</label><input class="input" id="ncr-product-code" name="product_code" maxlength="100"></div>
          <div class="field"><label for="ncr-product-name">ชื่อสินค้า/วัตถุดิบ *</label><input class="input" id="ncr-product-name" name="product_name" minlength="2" maxlength="300" required></div>
          <div class="field"><label for="ncr-customer-name">ชื่อลูกค้า/พ่อค้า</label><input class="input" id="ncr-customer-name" name="customer_name" maxlength="200"></div>
          <div class="field"><label for="ncr-customer-code">รหัสลูกค้า</label><input class="input" id="ncr-customer-code" name="customer_code" maxlength="50"></div>
          <div class="field"><label for="ncr-po-no">เลขที่ใบสั่งซื้อ/ใบส่งของ</label><input class="input" id="ncr-po-no" name="po_no" maxlength="100"></div>
          <div class="field"><label for="ncr-lot-no">Lot</label><input class="input" id="ncr-lot-no" name="lot_no" maxlength="100"></div>
          <div class="field"><label for="ncr-qty-total">จำนวนทั้งหมด *</label><input class="input" id="ncr-qty-total" name="qty_total" type="number" min="0" step="any" inputmode="decimal" required></div>
          <div class="field"><label for="ncr-qty-sampled">จำนวนสุ่ม</label><input class="input" id="ncr-qty-sampled" name="qty_sampled" type="number" min="0" step="any" inputmode="decimal"></div>
          <div class="field"><label for="ncr-qty-defect">จำนวนที่พบปัญหา *</label><input class="input" id="ncr-qty-defect" name="qty_defect" type="number" min="0" step="any" inputmode="decimal" required></div>
          <div class="field"><label for="ncr-qty-returned">จำนวนที่ส่งคืน</label><input class="input" id="ncr-qty-returned" name="qty_returned" type="number" min="0" step="any" inputmode="decimal"></div>
          <div class="field"><label for="ncr-unit">หน่วย *</label><select class="select" id="ncr-unit" name="unit" required><option value="">— เลือก —</option>${UNITS.map((unit) => `<option>${escapeHtml(unit)}</option>`).join("")}</select></div>
          <div class="field"><label for="ncr-defect-type">ประเภทข้อบกพร่อง *</label><select class="select" id="ncr-defect-type" name="defect_type" required><option value="">— เลือก —</option>${defectTypes.map((type) => `<option value="${escapeHtml(type.code)}">${escapeHtml(type.name_th)}</option>`).join("")}</select></div>
          <fieldset class="field full ncr-fieldset"><legend>แหล่งที่พบ *</legend>${radiosHtml("source", SOURCES)}</fieldset>
          <div class="field full"><label for="ncr-description">รายละเอียด (ปัญหา สเปค และค่าที่วัดได้จริง) *</label><textarea class="textarea" id="ncr-description" name="description" minlength="10" maxlength="5000" required></textarea></div>
        </div>
        ${evidenceFieldHtml("ncr-issue-evidence", "แนบหลักฐาน (ถ้ามี) เช่น รูปชิ้นงาน ผลวัด")}
        <div class="form-actions"><a class="btn secondary" href="#/ncr">ยกเลิก</a><button class="btn" type="submit">ออก NCR</button></div>
      </form></section>`;
  }

  function bindIssueForm() {
    const form = document.querySelector("#ncr-issue-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      // อ่านค่าก่อน setFormBusy เสมอ — ช่องที่ถูก disable จะไม่อยู่ใน FormData
      const args = {
          p_product_name: optionalText(form, "product_name") ?? "",
          p_qty_total: optionalNumber(form, "qty_total"),
          p_qty_defect: optionalNumber(form, "qty_defect"),
          p_unit: optionalText(form, "unit") ?? "",
          p_source: checkedValues(form, "source")[0] ?? "",
          p_defect_type_code: optionalText(form, "defect_type") ?? "",
          p_description: optionalText(form, "description") ?? "",
          p_product_code: optionalText(form, "product_code"),
          p_customer_name: optionalText(form, "customer_name"),
          p_customer_code: optionalText(form, "customer_code"),
          p_po_no: optionalText(form, "po_no"),
          p_lot_no: optionalText(form, "lot_no"),
          p_qty_sampled: optionalNumber(form, "qty_sampled"),
          p_qty_returned: optionalNumber(form, "qty_returned"),
      };
      let evidence;
      try {
        evidence = evidenceOf(form);
      } catch (error) {
        showFormError(form, error);
        return;
      }
      setFormBusy(form, true);
      try {
        const { data, error } = await sb.rpc("app_ncr_issue", args);
        if (error) throw error;
        let message = `ออก NCR เลขที่ ${data.ncr_no} แล้ว`;
        if (evidence) {
          try {
            await uploadNcrAttachment(data.id, evidence, "report");
          } catch (uploadError) {
            message += ` แต่แนบไฟล์ไม่สำเร็จ (${friendlyError(uploadError)}) แนบใหม่ได้ในหน้า NCR`;
          }
        }
        showToast(message);
        location.hash = `#/ncr?id=${encodeURIComponent(data.id)}`;
      } catch (error) {
        setFormBusy(form, false);
        showFormError(form, error);
      }
    });
  }

  // ---- ทะเบียน NCR (QA02-FM02) ----
  const LIST_FILTERS = [["open", "ยังไม่ปิด"], ["overdue", "เกินกำหนดตอบ"], ["closed", "ปิดแล้ว"], ["cancelled", "ยกเลิก"], ["all", "ทั้งหมด"]];

  async function renderList(params) {
    loadingShell("ncr", "ทะเบียน NCR");
    const filter = LIST_FILTERS.some(([value]) => value === params.get("status")) ? params.get("status") : "open";
    let query = sb.from("ncr_reports")
      .select("id,ncr_no,status,issue_date,product_name,customer_name,qty_defect,unit,response_due,defect_type:ncr_defect_types(name_th),ncr_responsibilities(share,department:departments(code))")
      .order("issue_date", { ascending: false })
      .order("ncr_no", { ascending: false })
      .limit(300);
    if (filter === "open") query = query.in("status", OPEN_STATUSES);
    else if (filter === "overdue") query = query.in("status", RESPONSE_PENDING_STATUSES).lt("response_due", todayBangkok());
    else if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    const lossByNcr = new Map();
    if (rows.length) {
      const { data: losses, error: lossError } = await sb.from("ncr_losses").select("ncr_id,amount").is("voided_at", null).in("ncr_id", rows.map((row) => row.id));
      if (lossError) throw lossError;
      for (const loss of losses ?? []) lossByNcr.set(loss.ncr_id, (lossByNcr.get(loss.ncr_id) ?? 0) + Number(loss.amount));
    }
    const body = rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>เลขที่</th><th>วันที่</th><th>สินค้า / ลูกค้า</th><th>ข้อบกพร่อง</th><th>พบปัญหา</th><th>แผนกรับผิดชอบ</th><th>ความสูญเสีย</th><th>สถานะ</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td><a class="request-no" href="#/ncr?id=${encodeURIComponent(row.id)}">${escapeHtml(row.ncr_no)}</a></td>
          <td>${formatDate(row.issue_date)}</td>
          <td>${escapeHtml(row.product_name)}${row.customer_name ? `<div class="muted small">${escapeHtml(row.customer_name)}</div>` : ""}</td>
          <td>${escapeHtml(relation(row.defect_type)?.name_th ?? "—")}</td>
          <td>${formatQty(row.qty_defect)} ${escapeHtml(row.unit)}</td>
          <td>${escapeHtml((row.ncr_responsibilities ?? []).map((item) => relation(item.department)?.code).filter(Boolean).join(" + ") || "—")}</td>
          <td>${lossByNcr.has(row.id) ? formatBaht(lossByNcr.get(row.id)) : "—"}</td>
          <td>${statusBadgeHtml(row)}</td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="empty">ไม่มี NCR ในหมวดนี้ที่คุณมีสิทธิ์เห็น</div>`;
    const content = `
      <div class="page-heading"><div><div class="eyebrow">QA02-FM02</div><h1>ทะเบียน NCR</h1><p>ใบรายงานผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนดที่คุณเกี่ยวข้อง (ผู้รายงาน แผนก QA แผนกที่รับผิดชอบ และผู้บริหาร)</p></div><a class="btn" href="#/ncr?new=1">＋ ออก NCR</a></div>
      <div class="filters">${LIST_FILTERS.map(([value, label]) => `<a class="filter${filter === value ? " active" : ""}" href="#/ncr${value === "open" ? "" : `?status=${value}`}">${label}</a>`).join("")}</div>
      <section class="card flush">${body}</section>`;
    app.innerHTML = shell(content, "ncr", "ทะเบียน NCR");
    bindShell();
  }

  async function renderIssuePage() {
    loadingShell("ncr", "ออก NCR");
    const defectTypes = await loadDefectTypes();
    const content = `<div class="page-heading"><div><div class="eyebrow">QA02-FM01 Rev.00</div><h1>ออก NCR</h1><p>ใบรายงานผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนด (Non Conforming Report)</p></div></div>${issueFormHtml(defectTypes, state.employee)}`;
    app.innerHTML = shell(content, "ncr", "ออก NCR");
    bindShell();
    bindIssueForm();
  }

  // ---- รายละเอียด + ฟอร์มของแต่ละขั้น ----
  function definition(label, value) {
    return `<div class="definition"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
  }

  function nextSigner(ncr) {
    if (!ncr.signoff_qa_at) return { key: "qa", label: "ผู้จัดการแผนก QA" };
    if (!ncr.signoff_factory_at) return { key: "factory", label: "ผู้จัดการฝ่ายโรงงาน" };
    return { key: "gm", label: "ผู้จัดการทั่วไป" };
  }

  function canSignNext(ncr, employee) {
    const signer = nextSigner(ncr).key;
    if (signer === "qa") return isQaManager(employee);
    if (signer === "factory") return roleCode(employee) === "factory_manager";
    return roleCode(employee) === "general_manager";
  }

  function actionForms(ncr, employee, departments) {
    const forms = [];
    const myDeptResponsible = (ncr.ncr_responsibilities ?? []).some((item) => item.department_id === employee.department_id);
    if (ncr.status === "awaiting_disposition" && roleCode(employee) === "factory_manager") {
      forms.push(`<form class="ncr-action" data-action="dispose"><div class="ncr-form-message"></div>
        <h3>ส่วนที่ 2 — ความเห็นผู้บริหารโรงงาน</h3>
        <fieldset class="field ncr-fieldset"><legend>วิธีจัดการ *</legend>${checksHtml("dispositions", DISPOSITIONS)}</fieldset>
        <fieldset class="field ncr-fieldset"><legend>แผนกที่รับผิดชอบ * <small class="muted">(เลือกได้หลายแผนก ระบบแบ่งสัดส่วนเท่ากันให้)</small></legend>
          <div class="ncr-checks">${departments.map((department) => `<label class="ncr-check"><input type="checkbox" name="department_ids" value="${escapeHtml(department.id)}"><span>${escapeHtml(department.code)} · ${escapeHtml(department.name_th)}</span></label>`).join("")}</div>
        </fieldset>
        <div class="field"><label for="ncr-dispose-note">หมายเหตุ</label><input class="input" id="ncr-dispose-note" name="note" maxlength="1000"></div>
        <div class="form-actions"><button class="btn" type="submit">บันทึกและส่งแผนก (ตอบภายใน 7 วัน)</button></div></form>`);
    }
    if (ncr.status === "awaiting_response" && isDeptManager(employee) && myDeptResponsible) {
      forms.push(`<form class="ncr-action" data-action="respond"><div class="ncr-form-message"></div>
        <h3>ส่วนที่ 3 — ตอบ NCR</h3>
        <fieldset class="field ncr-fieldset"><legend>เกิดจาก (4M+E) *</legend>${checksHtml("causes", CAUSES, ncr.causes ?? [])}</fieldset>
        <div class="field"><label for="ncr-root-cause">สาเหตุของปัญหา *</label><textarea class="textarea" id="ncr-root-cause" name="root_cause" maxlength="5000">${escapeHtml(ncr.root_cause ?? "")}</textarea></div>
        <div class="form-grid">
          <div class="field full"><label for="ncr-correction">แนวทางการแก้ไขปัญหา *</label><textarea class="textarea" id="ncr-correction" name="correction" maxlength="5000">${escapeHtml(ncr.correction ?? "")}</textarea></div>

          <div class="field full"><label for="ncr-prevention">แนวทางการป้องกันไม่ให้เกิดซ้ำ *</label><textarea class="textarea" id="ncr-prevention" name="prevention" maxlength="5000">${escapeHtml(ncr.prevention ?? "")}</textarea></div>
        </div>
        <p class="ncr-due-note">กำหนดเสร็จตั้งให้อัตโนมัติ · แก้ไขปัญหา <strong>${formatDate(ncr.response_due)}</strong> (กำหนดตอบ 5 วันหลังออกใบ) · ป้องกันไม่ให้เกิดซ้ำ <strong>${ncr.response_due ? formatDate(addDays(ncr.response_due, 7)) : "—"}</strong> (ต่อจากนั้นอีก 7 วัน)</p>
        ${evidenceFieldHtml("ncr-respond-evidence", "แนบหลักฐาน (ถ้ามี) เช่น รูปหลังแก้ไข เอกสาร WI ที่ปรับ")}
        <div class="form-actions"><button class="btn" type="submit">ส่งคำตอบ</button></div></form>`);
    }
    if (ncr.status === "awaiting_followup" && isQa(employee)) {
      forms.push(`<form class="ncr-action" data-action="followup"><div class="ncr-form-message"></div>
        <h3>ส่วนที่ 4 — สรุปผลการติดตาม</h3>
        ${radiosHtml("result", { close: "ปิดประเด็นความไม่สอดคล้อง", return: "ส่งกลับให้แผนกแก้ไขคำตอบ" })}
        <p class="muted small">กรณีปิดประเด็นไม่ได้/เกิดซ้ำต้องออก CAR — ใช้การ์ด NCR/CAR ในหน้าสร้างคำร้องไปก่อนจนกว่า CAR จะย้ายเข้าระบบนี้ (Phase 2)</p>
        <div class="field"><label for="ncr-followup-note">บันทึกการติดตาม (จำเป็นเมื่อส่งกลับ)</label><input class="input" id="ncr-followup-note" name="note" maxlength="2000"></div>
        <div class="form-actions"><button class="btn" type="submit">บันทึกผล</button></div></form>`);
    }
    if (ncr.status === "awaiting_signoff" && canSignNext(ncr, employee)) {
      forms.push(`<form class="ncr-action" data-action="signoff"><div class="ncr-form-message"></div>
        <h3>ลงนามปิด NCR ในฐานะ${escapeHtml(nextSigner(ncr).label)}</h3>
        <div class="form-actions"><button class="btn" type="submit">ลงนาม</button></div></form>`);
    }
    if (OPEN_STATUSES.includes(ncr.status) && isQaManager(employee)) {
      forms.push(`<form class="ncr-action" data-action="cancel"><div class="ncr-form-message"></div>
        <h3>ยกเลิก NCR</h3><p class="muted small">เลขที่ยังอยู่ในทะเบียนพร้อมสถานะ "ยกเลิก" ไม่นำกลับมาใช้ใหม่</p>
        <div class="field"><label for="ncr-cancel-reason">เหตุผล *</label><input class="input" id="ncr-cancel-reason" name="reason" maxlength="1000"></div>
        <div class="form-actions"><button class="btn danger" type="submit">ยกเลิก NCR</button></div></form>`);
    }
    return forms;
  }

  function waitingText(ncr) {
    if (ncr.status === "awaiting_disposition") return `ผู้จัดการฝ่ายโรงงานพิจารณา (แผนกต้องตอบภายใน ${formatDate(ncr.response_due)})`;
    if (ncr.status === "awaiting_response") return `ผู้จัดการแผนก ${(ncr.ncr_responsibilities ?? []).map((item) => relation(item.department)?.code).join(" / ")} ตอบภายใน ${formatDate(ncr.response_due)}`;
    if (ncr.status === "awaiting_followup") return "แผนก QA ติดตามผล";
    if (ncr.status === "awaiting_signoff") return `${nextSigner(ncr).label} ลงนาม`;
    return "";
  }

  function canEditLosses(ncr, employee) {
    if (!OPEN_STATUSES.includes(ncr.status)) return false;
    if (isQa(employee) || roleCode(employee) === "factory_manager") return true;
    return isDeptManager(employee) && (ncr.ncr_responsibilities ?? []).some((item) => item.department_id === employee.department_id);
  }

  function lossSectionHtml(ncr, losses, directory, editable) {
    const active = losses.filter((loss) => !loss.voided_at);
    const total = active.reduce((sum, loss) => sum + Number(loss.amount), 0);
    const rows = losses.map((loss) => `<tr class="${loss.voided_at ? "ncr-voided" : ""}">
        <td>${escapeHtml(LOSS_TYPES[loss.loss_type] ?? loss.loss_type)}</td>
        <td>${formatQty(loss.quantity)} ${escapeHtml(loss.unit)}</td>
        <td>${formatBaht(loss.unit_cost)}</td>
        <td>${formatBaht(loss.amount)}</td>
        <td>${escapeHtml(loss.note ?? "")}${loss.voided_at ? `<div class="muted small">ยกเลิก: ${escapeHtml(loss.void_reason ?? "")} · ${escapeHtml(personName(directory, loss.voided_by))}</div>` : ""}</td>
        <td>${escapeHtml(personName(directory, loss.recorded_by))}<div class="muted small">${formatDate(loss.recorded_at)}</div></td>
        <td>${editable && !loss.voided_at ? `<button class="btn secondary small" type="button" data-void-loss="${escapeHtml(loss.id)}">ยกเลิก</button>` : ""}</td>
      </tr>`).join("");
    return `<section class="card ncr-card">
      <h2>ความสูญเสีย (Cost of Poor Quality)</h2>
      <p class="muted small">มูลค่า = จำนวน × ราคาต่อหน่วย ณ วันที่บันทึก · รายการที่ยกเลิกยังเก็บไว้ให้ตรวจสอบย้อนหลัง</p>
      ${losses.length ? `<div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>มูลค่า</th><th>หมายเหตุ</th><th>บันทึกโดย</th><th></th></tr></thead>
        <tbody>${rows}<tr><td colspan="3"><strong>รวม</strong></td><td><strong>${formatBaht(total)}</strong></td><td colspan="3"></td></tr></tbody></table></div>` : `<p class="muted small">ยังไม่มีรายการ</p>`}
      ${editable ? `<form class="ncr-action" data-action="add_loss"><div class="ncr-form-message"></div>
        <h3>เพิ่มรายการความสูญเสีย</h3>
        <div class="form-grid">
          <div class="field"><label for="ncr-loss-type">ประเภท *</label><select class="select" id="ncr-loss-type" name="loss_type">${Object.entries(LOSS_TYPES).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select></div>
          <div class="field"><label for="ncr-loss-qty">จำนวน *</label><input class="input" id="ncr-loss-qty" name="quantity" type="number" min="0" step="any" inputmode="decimal"></div>
          <div class="field"><label for="ncr-loss-unit">หน่วย *</label><input class="input" id="ncr-loss-unit" name="unit" maxlength="20" value="${escapeHtml(ncr.unit)}"></div>
          <div class="field"><label for="ncr-loss-cost">ราคาต่อหน่วย (บาท) *</label><input class="input" id="ncr-loss-cost" name="unit_cost" type="number" min="0" step="0.01" inputmode="decimal"></div>
          <div class="field full"><label for="ncr-loss-note">หมายเหตุ</label><input class="input" id="ncr-loss-note" name="note" maxlength="500"></div>
        </div>
        <div class="form-actions"><button class="btn" type="submit">บันทึก</button></div></form>` : ""}
    </section>`;
  }

  const HISTORY_LABELS = {
    issue: "ออก NCR", dispose: "ผจก.โรงงานพิจารณา", respond: "แผนกตอบ NCR", followup_close: "QA ปิดประเด็น",
    followup_return: "QA ส่งกลับให้แก้ไขคำตอบ", signoff_qa: "ผจก.แผนก QA ลงนาม", signoff_factory: "ผจก.โรงงานลงนาม",
    signoff_gm: "ผจก.ทั่วไปลงนาม · ปิด NCR", cancel: "ยกเลิก NCR", attachment: "แนบไฟล์หลักฐาน",
  };

  async function renderDetail(id) {
    loadingShell("ncr", "NCR");
    const employee = state.employee;
    const [ncrResult, lossResult, historyResult, attachmentResult, directory] = await Promise.all([
      sb.from("ncr_reports").select("*,defect_type:ncr_defect_types(name_th),reporter_department:departments!ncr_reports_reporter_department_id_fkey(code),ncr_responsibilities(share,department_id,department:departments(code,name_th))").eq("id", id).maybeSingle(),
      sb.from("ncr_losses").select("*").eq("ncr_id", id).order("recorded_at"),
      sb.from("ncr_status_history").select("*").eq("ncr_id", id).order("id"),
      sb.from("ncr_attachments").select("*").eq("ncr_id", id).order("created_at"),
      loadEmployeeDirectory(),
    ]);
    if (ncrResult.error) throw ncrResult.error;
    if (lossResult.error) throw lossResult.error;
    if (historyResult.error) throw historyResult.error;
    if (attachmentResult.error) throw attachmentResult.error;
    const attachments = attachmentResult.data ?? [];
    const ncr = ncrResult.data;
    if (!ncr) {
      app.innerHTML = shell(`<div class="empty"><h2>ไม่พบ NCR</h2><p>${escapeHtml(ERROR_MESSAGES.NCR_NOT_FOUND)}</p><a class="btn secondary" href="#/ncr">กลับไปทะเบียน NCR</a></div>`, "ncr", "NCR");
      bindShell();
      return;
    }
    let departments = [];
    if (ncr.status === "awaiting_disposition" && roleCode(employee) === "factory_manager") {
      const { data, error } = await sb.from("departments").select("id,code,name_th").eq("is_active", true).order("code");
      if (error) throw error;
      departments = data ?? [];
    }
    const forms = actionForms(ncr, employee, departments);
    const waiting = waitingText(ncr);
    const responsibilities = escapeHtml((ncr.ncr_responsibilities ?? []).map((item) => relation(item.department)?.code ?? "").join(" · "));
    const ng = ncr.qty_sampled ? (Number(ncr.qty_defect) / Number(ncr.qty_sampled)) * 100 : null;
    const signoff = (by, at) => (at ? `✓ ${escapeHtml(personName(directory, by))} · ${formatDate(at)}` : "—");
    const content = `
      <div class="page-heading"><div><div class="eyebrow">${escapeHtml(ncr.form_code)}</div><h1>${escapeHtml(ncr.ncr_no)}</h1><p>${escapeHtml(ncr.product_name)}</p></div><div class="ncr-heading-status">${statusBadgeHtml(ncr)}<a class="btn secondary" href="#/ncr">‹ ทะเบียน NCR</a></div></div>
      ${ncr.status === "cancelled" ? `<div class="form-message error">ยกเลิกโดย ${escapeHtml(personName(directory, ncr.cancelled_by))} · ${formatDate(ncr.cancelled_at)} · ${escapeHtml(ncr.cancel_reason ?? "")}</div>` : ""}
      ${forms.length ? `<section class="card ncr-card ncr-actions"><h2>สิ่งที่คุณต้องดำเนินการ</h2>${forms.join("")}</section>` : waiting ? `<p class="muted small ncr-waiting">ขั้นตอนนี้รอ: <strong>${escapeHtml(waiting)}</strong></p>` : ""}
      <section class="card ncr-card"><h2>ส่วนที่ 1 ผู้รายงาน/ผู้ตรวจสอบ</h2><dl class="definition-grid">
        ${definition("วันที่ออก", formatDate(ncr.issue_date))}
        ${definition("ผู้รายงาน / แผนก", `${escapeHtml(personName(directory, ncr.reporter_id))} / ${escapeHtml(relation(ncr.reporter_department)?.code ?? "—")}`)}
        ${definition("รหัส / ชื่อสินค้า", `${escapeHtml(ncr.product_code ?? "—")} · ${escapeHtml(ncr.product_name)}`)}
        ${definition("ลูกค้า/พ่อค้า", `${escapeHtml(ncr.customer_name ?? "—")}${ncr.customer_code ? ` (${escapeHtml(ncr.customer_code)})` : ""}`)}
        ${definition("ใบสั่งซื้อ/ใบส่งของ · Lot", `${escapeHtml(ncr.po_no ?? "—")} · ${escapeHtml(ncr.lot_no ?? "—")}`)}
        ${definition("แหล่งที่พบ · ข้อบกพร่อง", `${escapeHtml(SOURCES[ncr.source] ?? ncr.source)} · ${escapeHtml(relation(ncr.defect_type)?.name_th ?? "—")}`)}
        ${definition("จำนวน", `ทั้งหมด ${formatQty(ncr.qty_total)} · สุ่ม ${formatQty(ncr.qty_sampled)} · พบปัญหา ${formatQty(ncr.qty_defect)} · ส่งคืน ${formatQty(ncr.qty_returned)} ${escapeHtml(ncr.unit)}`)}
        ${definition("%NG จากการสุ่ม", ng === null ? "—" : `${ng.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`)}
      </dl><p class="ncr-text">${escapeHtml(ncr.description)}</p></section>
      <section class="card ncr-card"><h2>ส่วนที่ 2 ฝ่ายบริหารโรงงานพิจารณา</h2><dl class="definition-grid">
        ${definition("ความเห็น", escapeHtml((ncr.dispositions ?? []).map((value) => DISPOSITIONS[value] ?? value).join(", ") || "—"))}
        ${definition("แผนกที่รับผิดชอบ", responsibilities || "—")}
        ${definition("ผู้พิจารณา", ncr.disposed_at ? `${escapeHtml(personName(directory, ncr.disposed_by))} · ${formatDate(ncr.disposed_at)}` : "—")}
        ${definition("กำหนดตอบ", formatDate(ncr.response_due))}
      </dl>${ncr.disposition_note ? `<p class="ncr-text">${escapeHtml(ncr.disposition_note)}</p>` : ""}</section>
      <section class="card ncr-card"><h2>ส่วนที่ 3 ผู้รับเรื่องดำเนินการ</h2><dl class="definition-grid">
        ${definition("เกิดจาก", escapeHtml((ncr.causes ?? []).map((value) => CAUSES[value] ?? value).join(", ") || "—"))}
        ${definition("ผู้ตอบ", ncr.responded_at ? `${escapeHtml(personName(directory, ncr.responded_by))} · ${formatDate(ncr.responded_at)}` : "—")}
        ${definition("สาเหตุของปัญหา", escapeHtml(ncr.root_cause ?? "—"))}
        ${definition("แนวทางแก้ไข · กำหนดเสร็จ", `${escapeHtml(ncr.correction ?? "—")} · ${formatDate(ncr.correction_due)}`)}
        ${definition("แนวทางป้องกัน · กำหนดเสร็จ", `${escapeHtml(ncr.prevention ?? "—")} · ${formatDate(ncr.prevention_due)}`)}
      </dl></section>
      <section class="card ncr-card"><h2>ส่วนที่ 4 การตรวจติดตาม</h2><dl class="definition-grid">
        ${definition("ผู้ติดตาม", ncr.followed_up_at ? `${escapeHtml(personName(directory, ncr.followed_up_by))} · ${formatDate(ncr.followed_up_at)}` : "—")}
        ${definition("บันทึก", escapeHtml(ncr.followup_note ?? "—"))}
        ${definition("ผู้จัดการแผนก QA", signoff(ncr.signoff_qa_by, ncr.signoff_qa_at))}
        ${definition("ผู้จัดการฝ่ายโรงงาน", signoff(ncr.signoff_factory_by, ncr.signoff_factory_at))}
        ${definition("ผู้จัดการทั่วไป", signoff(ncr.signoff_gm_by, ncr.signoff_gm_at))}
        ${definition("วันที่ปิด", formatDate(ncr.closed_at))}
      </dl></section>
      <section class="card ncr-card"><h2>ไฟล์หลักฐาน</h2>
        <p class="muted small">ทุกคนที่เห็นใบนี้แนบไฟล์เพิ่มได้จนกว่าจะปิดใบ ไฟล์ที่แนบแล้วลบไม่ได้เพราะเป็นหลักฐาน · ผู้แนบและเวลาดูได้ในประวัติเอกสาร</p>
        ${attachmentGalleryHtml(attachments)}
        ${OPEN_STATUSES.includes(ncr.status) ? `<form class="ncr-action ncr-attach-form" data-action="attach"><div class="ncr-form-message"></div>${evidenceFieldHtml("ncr-attach-evidence", "แนบไฟล์เพิ่ม")}<div class="form-actions"><button class="btn secondary" type="submit">อัปโหลด</button></div></form>` : ""}
      </section>
      ${lossSectionHtml(ncr, lossResult.data ?? [], directory, canEditLosses(ncr, employee))}
      <section class="card ncr-card"><h2>ประวัติเอกสาร</h2><div class="timeline">${(historyResult.data ?? []).map((item) => `<div class="timeline-item"><strong>${escapeHtml(HISTORY_LABELS[item.action] ?? item.action)}</strong><p>${escapeHtml(personName(directory, item.changed_by))} · ${formatDate(item.changed_at, true)}</p>${item.note ? `<p class="timeline-item-detail">${escapeHtml(item.note)}</p>` : ""}</div>`).join("")}</div></section>`;
    app.innerHTML = shell(content, "ncr", ncr.ncr_no);
    bindShell();
    bindDetail(ncr);
    document.querySelector("#attachment-gallery")?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-attachment-open]");
      if (trigger) openAttachmentLightbox(trigger.dataset.attachmentOpen);
    });
    hydrateAttachmentGallery(attachments, "ncr-attachments").catch((error) => showToast(friendlyError(error), "error"));
  }

  function bindDetail(ncr) {
    const lossType = document.querySelector("#ncr-loss-type");
    lossType?.addEventListener("change", () => {
      document.querySelector("#ncr-loss-unit").value = LABOR_LOSS_TYPES.includes(lossType.value) ? "ชม." : ncr.unit;
    });

    const calls = {
      dispose: (form) => sb.rpc("app_ncr_dispose", {
        p_ncr_id: ncr.id,
        p_dispositions: checkedValues(form, "dispositions"),
        p_department_ids: checkedValues(form, "department_ids"),
        p_note: optionalText(form, "note"),
      }),
      respond: (form) => sb.rpc("app_ncr_respond", {
        p_ncr_id: ncr.id,
        p_causes: checkedValues(form, "causes"),
        p_root_cause: optionalText(form, "root_cause") ?? "",
        p_correction: optionalText(form, "correction") ?? "",
        p_prevention: optionalText(form, "prevention") ?? "",
      }),
      followup: (form) => sb.rpc("app_ncr_followup", { p_ncr_id: ncr.id, p_result: checkedValues(form, "result")[0] ?? "", p_note: optionalText(form, "note") }),
      signoff: () => sb.rpc("app_ncr_signoff", { p_ncr_id: ncr.id }),
      attach: async (form, evidence) => {
        if (!evidence) return { error: new Error("กรุณาเลือกไฟล์") };
        await uploadNcrAttachment(ncr.id, evidence, ATTACHMENT_SECTION_BY_STATUS[ncr.status] ?? "followup");
        return { error: null };
      },
      cancel: (form) => sb.rpc("app_ncr_cancel", { p_ncr_id: ncr.id, p_reason: optionalText(form, "reason") ?? "" }),
      add_loss: (form) => sb.rpc("app_ncr_add_loss", {
        p_ncr_id: ncr.id,
        p_loss_type: optionalText(form, "loss_type") ?? "",
        p_quantity: optionalNumber(form, "quantity"),
        p_unit: optionalText(form, "unit") ?? "",
        p_unit_cost: optionalNumber(form, "unit_cost"),
        p_note: optionalText(form, "note"),
      }),
    };
    const doneMessages = { attach: "แนบไฟล์แล้ว", dispose: "ส่งให้แผนกที่รับผิดชอบแล้ว", respond: "ส่งคำตอบแล้ว", followup: "บันทึกผลการติดตามแล้ว", signoff: "ลงนามแล้ว", cancel: "ยกเลิก NCR แล้ว", add_loss: "บันทึกความสูญเสียแล้ว" };

    document.querySelectorAll("form.ncr-action").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = form.dataset.action;
      if (action === "cancel" && !window.confirm(`ยืนยันยกเลิก ${ncr.ncr_no}?`)) return;
      let evidence;
      try {
        evidence = evidenceOf(form);
      } catch (error) {
        showFormError(form, error);
        return;
      }
      // เรียก RPC (ซึ่งอ่านค่าจากฟอร์มทันที) ก่อน setFormBusy — ช่องที่ถูก disable จะไม่อยู่ใน FormData
      const pending = calls[action](form, evidence);
      setFormBusy(form, true);
      try {
        const { error } = await pending;
        if (error) throw error;
        let message = doneMessages[action];
        // ไฟล์ที่แนบมากับคำตอบอัปโหลดหลังบันทึกคำตอบสำเร็จ ถ้าอัปโหลดไม่ผ่าน คำตอบยังอยู่และแนบใหม่ได้
        if (action === "respond" && evidence) {
          try {
            await uploadNcrAttachment(ncr.id, evidence, "response");
          } catch (uploadError) {
            message += ` แต่แนบไฟล์ไม่สำเร็จ (${friendlyError(uploadError)}) แนบใหม่ได้ที่ส่วนไฟล์หลักฐาน`;
          }
        }
        showToast(message);
        await renderDetail(ncr.id);
      } catch (error) {
        setFormBusy(form, false);
        showFormError(form, error);
      }
    }));

    document.querySelectorAll("[data-void-loss]").forEach((button) => button.addEventListener("click", async () => {
      const reason = window.prompt("เหตุผลที่ยกเลิกรายการนี้");
      if (reason === null) return;
      button.disabled = true;
      const { error } = await sb.rpc("app_ncr_void_loss", { p_loss_id: button.dataset.voidLoss, p_reason: reason.trim() });
      if (error) {
        button.disabled = false;
        showToast(friendlyError(error), "error");
        return;
      }
      showToast("ยกเลิกรายการแล้ว");
      await renderDetail(ncr.id);
    }));
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.NCR_CAR = {
    code: "NCR_CAR",
    enabled: true,
    // ไม่ระบุ label — ใช้ชื่อจาก request_types.name_th ("NCR/CAR") เหมือนเดิม
    theme: ["#facc15", "#a16207"],
    errorMessages: ERROR_MESSAGES,
    nav: [{ path: "ncr", label: "ทะเบียน NCR", icon: NAV_ICON }],

    // การ์ด NCR/CAR ในหน้าสร้างคำร้อง -> ฟอร์ม NCR (QA02-FM01) แทนฟอร์มคำร้องทั่วไป
    async prepareForm() {
      return { defectTypes: await loadDefectTypes() };
    },
    renderCreateForm({ defectTypes }, { employee }) {
      return issueFormHtml(defectTypes, employee);
    },
    bindCreateForm() {
      bindIssueForm();
    },

    // ป้ายกำกับ/ตัวช่วยที่ modules/module-ncr-dashboard.js ใช้ร่วม — แก้ที่นี่ที่เดียว
    shared: { STATUS_LABELS, OPEN_STATUSES, SOURCES, CAUSES, LOSS_TYPES, todayBangkok, isOverdue, formatQty, formatBaht },

    pages: {
      async ncr(params) {
        if (params.get("id")) return await renderDetail(params.get("id"));
        if (params.get("new")) return await renderIssuePage();
        return await renderList(params);
      },
    },
  };
})();
