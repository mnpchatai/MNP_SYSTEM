// ใบสั่งงาน IT (IT01-FM06) ของ Pilot Web — หน้าอยู่ใต้ #/office?module=work-order (ระบบสำนักงาน › IT SUPPORT › ใบสั่งงาน IT)
//
//   (ไม่มี view) / view=mine   ใบของฉัน + ปุ่ม "แจ้งงานใหม่"
//   view=approvals             รออนุมัติ (ผู้อนุมัติขั้นแผนก / ขั้น IT)         view=it        งาน IT แยกตามสถานะ (ทีม IT)
//   view=settings              ตั้งค่า (it_admin): รายชื่อทีม IT + เลขที่เอกสารถัดไป
//   view=new                   ฟอร์มแจ้งงานใหม่ (ตามฟอร์ม FM06)
//   view=order&id=<uuid>       รายละเอียดใบ + ไทม์ไลน์ + ปุ่มตาม allowed_actions + ส่วน "สำหรับแผนก IT"
//   view=print&id=<uuid>       หน้าพิมพ์ A4 เหมือนฟอร์ม IT01-FM06
//
// ฐานข้อมูล: supabase/migrations/20261203010000_itwo_work_orders.sql ทุกอย่างเรียกผ่าน RPC app_itwo_* (ตรวจบทบาท ลำดับขั้น เลขที่เอกสารที่ฝั่งฐานข้อมูล)
// หน้าเว็บแค่ซ่อน/แสดงแท็บและปุ่มตาม app_itwo_my_role กับ allowed_actions เป็น UX ล้วน สิทธิ์จริงตัดสินที่ RPC ทุกตัว
// ข้อมูลล้วนอยู่ที่ itwo-model.js · HTML อยู่ที่ itwo-pages.js · ไฟล์นี้ดูแลเฉพาะการเรียก RPC กล่องยืนยัน และผูกเหตุการณ์ของหน้า
// module-office.js เรียก MNP_ITWO.render(params) เมื่อเปิด ?module=work-order และ MNP_ITWO.loadCardSummary() เพื่อวาดตัวเลขบนการ์ด
//
// การแจ้งเตือน (อีเมล/Push/กระดิ่ง) ยังไม่ทำ: ตัวเลขบนการ์ดและแท็บเป็นตัวบอกงานค้าง · โหมดทดสอบ: ข้อมูลแยกจากของจริงที่ฐานข้อมูล (is_test) ใบทดสอบมีป้าย "ทดสอบ" ทุกหน้า
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound, showToast, friendlyError,
// confirmDialog, textPromptDialog, setFormBusy, setButtonBusy, renderRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerItwoModule() {
  const model = window.MNP_ITWO_MODEL;
  const pages = window.MNP_ITWO_PAGES;
  if (!model || !pages) return;

  const PATH = "office"; // หน้าของโมดูลนี้ใช้เส้นทางของระบบสำนักงาน (เมนูข้างไฮไลต์ "ระบบสำนักงาน")
  const TITLE = "ใบสั่งงาน IT";
  const PURGE_TEXT = "ล้างข้อมูลใบสั่งงาน IT ทดสอบ";
  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  // อ่านแบบไม่ทำให้หน้าล้ม (ตัวเลขบนแท็บ/การ์ดเป็นส่วนเสริม) ไม่สำเร็จ = null
  const attempt = (promise) => promise.then((value) => ({ value }), () => null);

  // ข้อความข้อผิดพลาดภาษาไทยจาก RPC: ข้อความไทยของฐานข้อมูลส่งต่อตรง ๆ · ไม่ได้คำตอบ (เน็ตหลุด) = "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ"
  // ข้อผิดพลาดที่ไม่ใช่ข้อความไทยของฐานข้อมูลส่งเข้า log ของ master (เหมือน friendlyError ของ app.js ที่ทำกับทุกที่)
  function failure(error, { write = false } = {}) {
    const info = model.describeError(error, { write });
    if (!info.forwarded) window.MNP_ERROR_LOG?.report(error);
    return info;
  }

  function paint(html, title, version, tabTitle = title) {
    if (version !== pageVersion) return false;
    app.innerHTML = shell(html, PATH, title, tabTitle);
    bindShell();
    return true;
  }
  const isSandbox = () => Boolean(state.sandbox?.active);
  const navigate = (hash) => { location.hash = hash; };

  function errorPage(error, version) {
    console.error(error);
    const info = failure(error);
    paint(pages.page(`${pages.head({ title: TITLE })}${pages.errorCard(info.message, { retry: info.kind === "unknown" })}`), TITLE, version);
    document.querySelector("#itwo-retry")?.addEventListener("click", () => renderRoute());
  }

  /* ---------- ตัวเลขบนการ์ด (IT SUPPORT) ---------- */
  // นับงานที่รอ "ฉัน": รออนุมัติ + งาน IT ที่ต้องลงมือ + ใบที่รอฉันยืนยันรับ · อ่านไม่ได้ = ไม่มีตัวเลข การ์ดยังกดเข้าได้
  async function loadCardSummary() {
    let role;
    try {
      role = await rpc("app_itwo_my_role");
    } catch {
      return null;
    }
    const [approvals, itRows, mine] = await Promise.all([
      role?.is_dept_approver || role?.is_it_approver ? attempt(rpc("app_itwo_pending_count")) : null,
      role?.is_it_admin || role?.is_it_approver ? attempt(rpc("app_itwo_list_it")) : null,
      attempt(rpc("app_itwo_list_mine")),
    ]);
    return model.cardSummary({
      approvals: approvals ? approvals.value : null,
      itWork: itRows ? model.itActionableCount(itRows.value) : null,
      toConfirm: mine ? model.awaitingMyReceiveCount(mine.value) : null,
    });
  }

  /* ---------- เส้นทาง ---------- */
  async function render(params) {
    pageVersion += 1;
    const version = pageVersion;
    const view = model.readView(params);
    if (!view) return renderNotFound();
    loadingShell(PATH, TITLE);
    let role;
    try {
      role = await rpc("app_itwo_my_role");
    } catch (error) {
      return errorPage(error, version);
    }
    // แท็บที่ไม่มีสิทธิ์เห็น (พิมพ์ URL เอง) พากลับ "ใบของฉัน" ก่อนเรียกข้อมูลใด ๆ
    if (!model.viewAllowed(view, role)) {
      navigate(model.workOrderUrl("mine"));
      return;
    }
    try {
      if (view === "new") return renderNew(role, version);
      if (view === "order") return await renderOrder(params.get("id"), role, version);
      if (view === "print") return await renderPrint(params.get("id"), version);
      return await renderTab(view, role, version);
    } catch (error) {
      return errorPage(error, version);
    }
  }

  /* ---------- แท็บ: ใบของฉัน / รออนุมัติ / งาน IT / ตั้งค่า ---------- */
  async function renderTab(view, role, version) {
    const hasApprovals = Boolean(role.is_dept_approver || role.is_it_approver);
    const hasIt = Boolean(role.is_it_admin || role.is_it_approver);
    const mainCall = {
      mine: () => rpc("app_itwo_list_mine"),
      approvals: () => rpc("app_itwo_list_pending_approvals"),
      it: () => rpc("app_itwo_list_it"),
      settings: () => Promise.all([rpc("app_itwo_list_staff"), rpc("app_itwo_get_doc_counter")]),
    }[view];
    // ตัวเลขบนแท็บอื่นอ่านขนานไปด้วย ไม่รอและไม่ทำให้หน้าล้ม
    const [main, approvalsCount, itRows] = await Promise.all([
      mainCall(),
      hasApprovals && view !== "approvals" ? attempt(rpc("app_itwo_pending_count")) : null,
      hasIt && view !== "it" ? attempt(rpc("app_itwo_list_it")) : null,
    ]);
    const counts = {
      approvals: view === "approvals" ? main.length : approvalsCount?.value,
      it: view === "it" ? model.itActionableCount(main) : itRows ? model.itActionableCount(itRows.value) : undefined,
    };
    let body;
    if (view === "mine") body = pages.mineList(main);
    else if (view === "approvals") body = pages.approvalsList(main);
    else if (view === "it") body = pages.itList(main);
    else body = pages.settingsPage({ staff: main[0], counter: main[1], myEmployeeId: role.employee_id, isTest: Boolean(role.is_test) });
    const html = pages.page(`${pages.head({ actions: pages.newButton(), isTest: Boolean(role.is_test) })}${pages.tabs(role, view, counts)}${body}${isSandbox() ? pages.purgeRow() : ""}`);
    if (!paint(html, TITLE, version)) return;
    bindPurge();
    if (view === "settings") bindSettings(role, main[1]);
  }

  // ล้างข้อมูลใบสั่งงาน IT ทดสอบ: เฉพาะ admin ที่อยู่ในโหมดทดสอบ (ฐานข้อมูลตรวจซ้ำ) ลบเฉพาะแถวทดสอบ แล้วเริ่มนับเลข TEST- ใหม่
  function bindPurge() {
    document.querySelector("#itwo-purge")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!(await confirmDialog({ title: `${PURGE_TEXT}?`, message: "ล้างเฉพาะใบสั่งงาน IT ทดสอบพร้อมประวัติ แล้วเริ่มนับเลข TEST- ใหม่ ข้อมูลจริงไม่ถูกแตะ", confirmLabel: PURGE_TEXT, danger: true }))) return;
      setButtonBusy(button, true);
      try {
        const data = await rpc("app_sandbox_purge_itwo");
        showToast(`ล้างข้อมูลทดสอบแล้ว ${data?.deleted ?? 0} แถว`);
        if (location.hash === model.workOrderUrl("mine")) await renderRoute();
        else navigate(model.workOrderUrl("mine"));
      } catch (error) {
        setButtonBusy(button, false);
        showToast(friendlyError(error), "error");
      }
    });
  }

  /* ---------- แจ้งงานใหม่ ---------- */
  function renderNew(role, version) {
    const requester = { name: role.full_name, department: role.department?.name_th };
    const html = pages.page(`${pages.head({ title: "แจ้งงานใหม่", back: { href: model.workOrderUrl("mine"), label: "‹ ใบสั่งงาน IT" }, isTest: Boolean(role.is_test) })}${pages.orderForm({ requester })}`);
    if (paint(html, "แจ้งงานใหม่", version)) bindOrderForm(role);
  }

  function bindOrderForm(role) {
    const form = document.querySelector("#itwo-form");
    const card = document.querySelector("#itwo-form-card");
    const message = document.querySelector("#itwo-message");
    const stepsApi = window.MNP_FORM_STEPS;
    const draftApi = window.MNP_FORM_DRAFT;
    const noteField = form.querySelector("#itwo-attachment-note-field");
    const noteInput = form.querySelector("#itwo-attachment-note");
    const neededDate = form.querySelector("#itwo-needed-date");
    const checked = (name) => form.querySelector(`[name="${name}"]:checked`)?.value ?? "";
    let submitted = false;
    let submitting = false; // กันกดส่งซ้ำระหว่างรอคำตอบ (ปุ่มถูกปิดด้วย setFormBusy อีกชั้น)

    // วันที่ต้องการงานย้อนหลังไม่ได้: ตัวเลือกวันที่เริ่มที่วันนี้ตามเวลาไทย และตรวจซ้ำตอนส่ง (ร่างเก่าอาจมีวันที่ผ่านไปแล้ว)
    neededDate.min = model.todayBangkok();
    window.MNP_DATE_PICKER?.enhance(neededDate);

    const currentValues = () => ({
      request_type: checked("request_type"),
      order_ref: form.querySelector("#itwo-order-ref").value,
      attachment_flag: checked("attachment_flag") || "no",
      attachment_note: noteInput.value,
      details: form.querySelector("#itwo-details").value,
      needed_date: neededDate.value,
      is_urgent: form.querySelector("#itwo-urgent").checked,
    });
    const syncNote = () => {
      const other = checked("attachment_flag") === "other";
      noteField.hidden = !other;
      if (!other) stepsApi.clearFieldError(form, "attachment_note");
    };
    // "ไม่มี" เป็นค่าเริ่มต้นของเอกสารแนบ จึงไม่นับเป็นการกรอก ร่างที่มีแค่ค่านี้ = ว่าง
    const ignoreForEmpty = ["attachment_flag"];
    const drafts = draftApi.createDraftStore({ key: draftApi.draftKey("ITWO", role.employee_id), ignoreForEmpty });
    const autosave = draftApi.createAutosave({ store: drafts, values: currentValues });
    form.addEventListener("input", () => autosave.schedule());
    form.addEventListener("change", () => { syncNote(); autosave.schedule(); });

    const restoreDraft = (values) => {
      const setRadio = (name, value) => form.querySelectorAll(`[name="${name}"]`).forEach((radio) => { radio.checked = radio.value === value; });
      setRadio("request_type", values.request_type);
      setRadio("attachment_flag", values.attachment_flag || "no");
      form.querySelector("#itwo-order-ref").value = values.order_ref ?? "";
      noteInput.value = values.attachment_note ?? "";
      form.querySelector("#itwo-details").value = values.details ?? "";
      neededDate.value = values.needed_date ?? "";
      neededDate.dispatchEvent(new Event("datepicker:refresh"));
      form.querySelector("#itwo-urgent").checked = Boolean(values.is_urgent);
      syncNote();
    };
    const draft = drafts.load();
    let draftPending = Boolean(draft);
    if (draft) {
      autosave.stop();
      draftApi.offerDraft({
        banner: document.querySelector("#itwo-draft"),
        message: `มีร่างใบสั่งงานค้างจาก ${formatDate(new Date(draft.savedAt).toISOString(), true)}`,
        onUse: () => { draftPending = false; autosave.start(); restoreDraft(draft.values); form.querySelector("#itwo-details").focus(); },
        onDiscard: () => { draftPending = false; autosave.start(); drafts.clear(); focusFirstStep(form); },
        // กรอกเองโดยไม่ตอบแถบ = เริ่มใบใหม่ ร่างเดิมถูกแทนด้วยสิ่งที่กรอก
        form,
        onEdit: () => { draftPending = false; autosave.start(); autosave.schedule(); },
        hasInput: () => !draftApi.isEmptyDraft(currentValues(), ignoreForEmpty),
      });
    }

    bindFormCancel(form, {
      title: "ทิ้งใบสั่งงานที่กรอกไว้?",
      isDirty: () => !submitted && !draftPending && !draftApi.isEmptyDraft(currentValues(), ignoreForEmpty),
      onDiscard: () => { autosave.stop(); drafts.clear(); },
    });

    const renderReview = () => { form.querySelector("#itwo-review").innerHTML = pages.orderReview(currentValues()); };
    const stepper = stepsApi.bindStepper({
      form, count: 3, rules: model.orderRules({ attachmentFlag: () => checked("attachment_flag") || "no" }), values: currentValues, onReview: renderReview, scrollTarget: card,
    });
    syncNote();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;
      message.innerHTML = "";
      if (!stepper.check("all")) return;
      const params = model.createParams(currentValues()); // อ่านก่อน setFormBusy: ช่องที่ถูก disable จะไม่ถูกอ่านค่า
      submitting = true;
      setFormBusy(form, true);
      try {
        const data = await rpc("app_itwo_create", params);
        const created = Array.isArray(data) ? data[0] : data;
        if (!created?.id) throw Object.assign(new Error("ไม่ได้รับเลขที่เอกสารจากระบบ"), { code: "" });
        submitted = true;
        autosave.stop();
        drafts.clear();
        showToast(`แจ้งงานแล้ว · เลขที่ ${created.doc_no}`);
        navigate(model.workOrderUrl("order", { id: created.id }));
      } catch (error) {
        const info = failure(error, { write: true });
        // ผลไม่แน่ชัด: ใบอาจถูกสร้างไปแล้ว ชวนไปตรวจที่ "ใบของฉัน" ก่อนกดส่งซ้ำ (ร่างยังอยู่ ไม่ถูกล้าง)
        const check = info.kind === "unknown" ? ` <a href="${model.workOrderUrl("mine")}">ตรวจที่ใบของฉัน</a>` : "";
        message.innerHTML = `<div class="form-message error" role="alert">${escapeHtml(info.message)}${check}</div>`;
        message.scrollIntoView?.({ block: "nearest" });
        submitting = false;
        setFormBusy(form, false);
        form.querySelector("[data-step-submit]")?.focus({ preventScroll: true });
      }
    });
  }

  /* ---------- รายละเอียดใบ ---------- */
  // ปุ่มกลับ: มาจากรออนุมัติ/งาน IT กลับไปที่นั่น ไม่งั้นกลับ "ใบของฉัน"
  function backTarget() {
    const from = typeof previousPageHash === "string" ? previousPageHash : "";
    if (/^#\/office\?module=work-order&view=approvals$/.test(from)) return { href: from, label: "‹ รออนุมัติ" };
    if (/^#\/office\?module=work-order&view=it$/.test(from)) return { href: from, label: "‹ งาน IT" };
    return { href: model.workOrderUrl("mine"), label: "‹ ใบสั่งงาน IT" };
  }

  async function loadDetail(id) {
    return rpc("app_itwo_get_detail", { p_work_order_id: id });
  }

  async function renderOrder(id, role, version) {
    if (!model.isUuid(id)) return renderNotFound("ไม่พบรหัสใบสั่งงาน");
    let detail;
    try {
      detail = await loadDetail(id);
    } catch (error) {
      // ไม่มีสิทธิ์/ไม่พบใบ: ฐานข้อมูลตอบข้อความเดียวกันทั้งสองกรณี (ไม่บอกว่าใบมีอยู่หรือไม่)
      return errorPage(error, version);
    }
    const back = backTarget();
    let access = null; // กำลังแก้ส่วน "สำหรับแผนก IT": { drafts, validation }
    let nextKey = 0;
    const draw = () => {
      const html = pages.detailPage(detail, { access, back });
      if (!paint(html, TITLE, version, detail.doc_no)) return false;
      bindActions();
      bindAccess();
      return true;
    };

    // ---- ปุ่มเปลี่ยนสถานะ: ทุกปุ่มมีกล่องยืนยัน · เหตุผล (ไม่อนุมัติ/ยกเลิก) ถามในกล่องเดียวกัน ----
    async function runAction(button) {
      const spec = model.ACTION_BUTTONS[button.dataset.itwoAction];
      if (!spec) return;
      const args = { p_work_order_id: detail.id };
      if (spec.reason) {
        const reason = await textPromptDialog({ title: spec.reason.title, label: spec.reason.label, hint: spec.reason.hint, minLength: 1, maxLength: model.MAX_REASON, confirmLabel: spec.reason.confirmLabel, danger: true });
        if (reason === null) return;
        args.p_reason = reason;
      } else if (!(await confirmDialog({ title: spec.confirmTitle, message: spec.confirmMessage, confirmLabel: spec.label, danger: spec.tone === "danger" }))) {
        return;
      }
      const buttons = [...document.querySelectorAll("[data-itwo-action]")];
      buttons.forEach((item) => { item.disabled = true; });
      setButtonBusy(button, true);
      try {
        await rpc(spec.rpc, args);
        showToast(spec.done);
      } catch (error) {
        showToast(failure(error, { write: true }).message, "error");
      }
      // สำเร็จหรือไม่ก็โหลดใบใหม่ ปุ่มจึงตรงกับสถานะจริง (ผลไม่แน่ชัด = เห็นว่าบันทึกไปแล้วหรือยัง)
      await renderRoute();
    }
    function bindActions() {
      document.querySelectorAll("[data-itwo-action]").forEach((button) => button.addEventListener("click", () => runAction(button)));
    }

    // ---- ส่วน "สำหรับแผนก IT" (it_admin แก้ได้เมื่อ allowed_actions มี edit_access) ----
    const accessRoot = () => document.querySelector(".itwo-access");
    function readDrafts() {
      return [...document.querySelectorAll("[data-access-row]")].map((row, index) => {
        const value = (name) => row.querySelector(`[data-access-field="${name}"]`)?.value ?? "";
        return { key: access.drafts[index]?.key ?? `new-${++nextKey}`, system: value("system"), action: value("action"), newUsername: value("newUsername"), oldUsername: value("oldUsername"), note: value("note") };
      });
    }
    function redrawAccess() {
      accessRoot().outerHTML = pages.accessSection({ changes: detail.access_changes ?? [], canEdit: model.canEditAccess(detail.allowed_actions), drafts: access?.drafts ?? null, validation: access?.validation });
      bindAccess();
    }
    function bindAccess() {
      document.querySelector("#itwo-access-edit")?.addEventListener("click", () => {
        const existing = model.draftsFromAccessChanges(detail.access_changes);
        access = { drafts: existing.length ? existing : [model.blankAccessDraft(`new-${++nextKey}`)], validation: { rows: {}, general: null } };
        redrawAccess();
      });
      const form = document.querySelector("#itwo-access-form");
      if (!form) return;
      form.querySelector("[data-access-add]")?.addEventListener("click", () => {
        access = { drafts: [...readDrafts(), model.blankAccessDraft(`new-${++nextKey}`)], validation: { rows: {}, general: null } };
        redrawAccess();
      });
      form.querySelector("[data-access-cancel]")?.addEventListener("click", () => { access = null; redrawAccess(); });
      form.querySelectorAll("[data-access-remove]").forEach((button) => button.addEventListener("click", () => {
        const drafts = readDrafts();
        drafts.splice(Number(button.dataset.accessRemove), 1);
        access = { drafts, validation: { rows: {}, general: null } };
        redrawAccess();
      }));
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const drafts = readDrafts();
        const validation = model.validateAccessChanges(drafts);
        access = { drafts, validation };
        if (model.hasAccessErrors(validation)) { redrawAccess(); return; }
        setFormBusy(form, true);
        try {
          await rpc("app_itwo_save_access_changes", { p_work_order_id: detail.id, p_changes: model.accessPayload(drafts) });
          showToast("บันทึกส่วนสำหรับแผนก IT แล้ว");
          await renderRoute();
        } catch (error) {
          showToast(failure(error, { write: true }).message, "error");
          setFormBusy(form, false);
        }
      });
    }
    draw();
  }

  /* ---------- หน้าพิมพ์ A4 ---------- */
  async function renderPrint(id, version) {
    if (!model.isUuid(id)) return renderNotFound("ไม่พบรหัสใบสั่งงาน");
    let detail;
    try {
      detail = await loadDetail(id);
    } catch (error) {
      return errorPage(error, version);
    }
    // ชื่อแท็บ = เลขที่ใบ (เป็นชื่อไฟล์เริ่มต้นเมื่อบันทึกเป็น PDF)
    if (!paint(pages.printPage(detail), "พิมพ์ใบสั่งงาน", version, detail.doc_no)) return;
    document.querySelector("#itwo-print-button")?.addEventListener("click", () => window.print());
  }

  /* ---------- ตั้งค่า (it_admin) ---------- */
  function bindSettings(role, counter) {
    const staffForm = document.querySelector("#itwo-staff-form");
    const fieldsOf = (form) => ({ no: form.querySelector('[name="employee_no"]'), admin: form.querySelector('[name="is_it_admin"]'), approver: form.querySelector('[name="is_it_approver"]') });
    const setStaff = async (employeeNo, isAdmin, isApprover) => {
      await rpc("app_itwo_set_staff", { p_employee_no: employeeNo, p_is_it_admin: isAdmin, p_is_it_approver: isApprover });
    };
    const fail = (error) => showToast(failure(error, { write: true }).message, "error");

    staffForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fields = fieldsOf(staffForm);
      const problem = model.validateStaffForm({ employeeNo: fields.no.value, isAdmin: fields.admin.checked, isApprover: fields.approver.checked });
      if (problem) { window.MNP_FORM_STEPS.showFieldErrors(staffForm, [{ name: "employee_no", message: problem }]); fields.no.focus(); return; }
      window.MNP_FORM_STEPS.clearFieldErrors(staffForm);
      const roles = [fields.admin.checked ? "ผู้ดูแลงาน IT" : "", fields.approver.checked ? "ผู้อนุมัติขั้น IT" : ""].filter(Boolean).join(" และ ");
      const no = fields.no.value.trim().toUpperCase();
      if (!(await confirmDialog({ title: `ตั้งสิทธิ์ทีม IT ให้ ${no}?`, message: `สิทธิ์: ${roles} · การตั้งสิทธิ์บันทึกในประวัติที่ลบไม่ได้`, confirmLabel: "บันทึกสิทธิ์" }))) return;
      setFormBusy(staffForm, true);
      try {
        await setStaff(no, fields.admin.checked, fields.approver.checked);
        showToast(`ตั้งสิทธิ์ทีม IT ให้ ${no} แล้ว`);
        await renderRoute();
      } catch (error) {
        fail(error);
        setFormBusy(staffForm, false);
      }
    });
    // "แก้ไข" เติมค่าของแถวนั้นลงฟอร์มเดียวกัน (ไม่มีกล่องลอย)
    document.querySelectorAll("[data-staff-edit]").forEach((button) => button.addEventListener("click", () => {
      const fields = fieldsOf(staffForm);
      fields.no.value = button.dataset.staffEdit;
      fields.admin.checked = button.dataset.staffAdmin === "1";
      fields.approver.checked = button.dataset.staffApprover === "1";
      staffForm.scrollIntoView?.({ block: "center" });
      fields.admin.focus({ preventScroll: true });
    }));
    document.querySelectorAll("[data-staff-remove]").forEach((button) => button.addEventListener("click", async () => {
      const no = button.dataset.staffRemove;
      if (!(await confirmDialog({ title: `ถอนสิทธิ์ทีม IT ของ ${no}?`, message: "ต้องเหลือผู้ดูแลงาน IT และผู้อนุมัติขั้น IT ที่ใช้งานอยู่อย่างน้อยอย่างละ 1 คน การถอนสิทธิ์บันทึกในประวัติที่ลบไม่ได้", confirmLabel: "ถอนสิทธิ์", danger: true }))) return;
      setButtonBusy(button, true);
      try {
        await setStaff(no, false, false);
        showToast(`ถอนสิทธิ์ทีม IT ของ ${no} แล้ว`);
        await renderRoute();
      } catch (error) {
        fail(error);
        setButtonBusy(button, false);
      }
    }));

    // เลขที่เอกสารถัดไป: เดินหน้าอย่างเดียว ยืนยันพร้อมบอกเลขที่จะได้ก่อนบันทึก (ฐานข้อมูลออกเลขจริงเอง)
    const counterForm = document.querySelector("#itwo-counter-form");
    counterForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = counterForm.querySelector('[name="next_seq"]');
      const problem = model.validateNextSeq(input.value, counter.next_seq);
      if (problem) { window.MNP_FORM_STEPS.showFieldErrors(counterForm, [{ name: "next_seq", message: problem }]); input.focus(); return; }
      window.MNP_FORM_STEPS.clearFieldErrors(counterForm);
      const next = Number(input.value.trim());
      const docNo = model.formatDocNo(Boolean(counter.is_test), counter.year, next);
      if (!(await confirmDialog({ title: `ตั้งเลขที่เอกสารถัดไปเป็น ${docNo}?`, message: "ตั้งได้เฉพาะเดินหน้า ย้อนกลับไม่ได้ และมีบันทึกการตั้งเลขที่ลบไม่ได้", confirmLabel: "ตั้งเลขถัดไป" }))) return;
      setFormBusy(counterForm, true);
      try {
        await rpc("app_itwo_set_next_doc_seq", { p_next: next, p_year: counter.year });
        showToast(`ตั้งเลขถัดไปเป็น ${docNo} แล้ว`);
        await renderRoute();
      } catch (error) {
        fail(error);
        setFormBusy(counterForm, false);
      }
    });
  }

  window.MNP_ITWO = Object.freeze({ render, loadCardSummary });
})();
