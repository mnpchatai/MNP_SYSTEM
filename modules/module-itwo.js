// ใบสั่งงาน IT (IT01-FM06) ของ Pilot Web — หน้าอยู่ใต้ #/office?module=work-order (ระบบสำนักงาน › IT SUPPORT › ใบสั่งงาน IT)
//
//   (ไม่มี view) / view=mine   ใบของฉัน + ปุ่ม "แจ้งงานใหม่"
//   view=approvals             รออนุมัติ (ผู้อนุมัติขั้นแผนก / ขั้น IT)         view=it        งาน IT แยกตามสถานะ (ทีม IT)
//   view=settings              ตั้งค่า (it_admin): รายชื่อทีม IT + เลขที่เอกสารถัดไป
//   view=new                   ฟอร์มแจ้งงานใหม่ (ตามฟอร์ม FM06)
//   view=order&id=<uuid>       รายละเอียดใบ + ไทม์ไลน์ + ไฟล์แนบแยกตามรอบ + ปุ่มตาม allowed_actions (รวม "แก้ไขงาน" ของผู้แจ้งตอน IT ปิดงานแล้ว)
//   view=print&id=<uuid>       หน้าพิมพ์ A4 เหมือนฟอร์ม IT01-FM06
//
// รุ่น 2 (เจ้าของสั่ง 19/11/2026): ไม่มีประเภท "สิทธิ์ในระบบ" และไม่มีส่วน "สำหรับแผนก IT : สิทธิ์ในระบบ" แล้ว · เบ็ดเตล็ดต้องระบุงาน ·
// แนบไฟล์ได้เมื่อเอกสารแนบ = "มี" (สร้างใบ → อัปโหลดขึ้น Storage → app_itwo_add_attachment ทีละไฟล์) · ผู้แจ้งขอแก้ไขงานได้หลัง IT ปิดงาน (app_itwo_request_rework)
// ฐานข้อมูล: supabase/migrations/20261203010000_itwo_work_orders.sql + 20261204010000_itwo_v2_rework_files.sql ทุกอย่างเรียกผ่าน RPC app_itwo_* (ตรวจบทบาท ลำดับขั้น เลขที่เอกสารที่ฝั่งฐานข้อมูล)
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
  let pageHash = ""; // location.hash ตอนเริ่มวาดหน้าล่าสุด: ผู้ใช้ออกไปหน้าอื่น (เช่น IT SUPPORT) ระหว่างรอข้อมูล หน้านี้ต้องไม่วาดทับหน้านั้น
  let unsavedProbe = null; // นับสิ่งที่กรอกค้างยังไม่ส่งของหน้าที่วาดอยู่ (app.js เรียกผ่าน MNP_ITWO.unsavedCount ก่อนออกจากหน้า) · ตอนนี้ใช้กับฟอร์มขอแก้ไขงาน และไฟล์ที่อัปโหลดไม่สำเร็จ
  const REMOVE_CHUNK = 100; // ลบไฟล์ทดสอบใน Storage ครั้งละกี่ไฟล์

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
    // เทียบทั้งรุ่นของหน้า (มีหน้าของโมดูลนี้ใหม่กว่า) และ hash ปัจจุบัน (ผู้ใช้ไปหน้าอื่นนอกโมดูลนี้ ซึ่งไม่ทำให้รุ่นเปลี่ยน)
    if (version !== pageVersion || location.hash !== pageHash) return false;
    app.innerHTML = shell(html, PATH, title, tabTitle);
    bindShell();
    return true;
  }
  const isSandbox = () => Boolean(state.sandbox?.active);
  const navigate = (hash) => { location.hash = hash; };

  function errorPage(error, version) {
    console.error(error);
    const info = failure(error);
    if (!paint(pages.page(`${pages.head({ title: TITLE })}${pages.errorCard(info.message, { retry: info.kind === "unknown" })}`), TITLE, version)) return;
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
    pageHash = location.hash;
    unsavedProbe = null; // หน้าใหม่ = ของค้างของหน้าเก่าไม่เกี่ยวแล้ว (หน้ารายละเอียดตั้งใหม่เองเมื่อวาด)
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
      settings: () => Promise.all([rpc("app_itwo_list_staff"), rpc("app_itwo_get_doc_counter"), loadStaffCandidates(role)]),
    }[view];
    // ตัวเลขบนแท็บอื่นอ่านขนานไปด้วย ไม่รอและไม่ทำให้หน้าล้ม
    const [main, approvalsCount, itRows, mineRows] = await Promise.all([
      mainCall(),
      hasApprovals && view !== "approvals" ? attempt(rpc("app_itwo_pending_count")) : null,
      hasIt && view !== "it" ? attempt(rpc("app_itwo_list_it")) : null,
      view !== "mine" ? attempt(rpc("app_itwo_list_mine")) : null,
    ]);
    const counts = {
      // ใบที่ IT ปิดงานแล้วรอ "ฉัน" ยืนยันรับงานหรือขอแก้ไข (งานกลับมาหาผู้แจ้ง) · แสดงบนแท็บ "ใบของฉัน" ทุกหน้า
      mine: view === "mine" ? model.awaitingMyReceiveCount(main) : mineRows ? model.awaitingMyReceiveCount(mineRows.value) : undefined,
      approvals: view === "approvals" ? main.length : approvalsCount?.value,
      it: view === "it" ? model.itActionableCount(main) : itRows ? model.itActionableCount(itRows.value) : undefined,
    };
    let body;
    if (view === "mine") body = pages.mineList(main);
    else if (view === "approvals") body = pages.approvalsList(main);
    else if (view === "it") body = pages.itList(main);
    else body = pages.settingsPage({ staff: main[0], counter: main[1], myEmployeeId: role.employee_id, isTest: Boolean(role.is_test), candidates: main[2] });
    const html = pages.page(`${pages.head({ actions: pages.newButton(), isTest: Boolean(role.is_test) })}${pages.tabs(role, view, counts)}${body}${isSandbox() ? pages.purgeRow() : ""}`);
    if (!paint(html, TITLE, version)) return;
    bindPurge();
    if (view === "settings") bindSettings(role, main[1]);
  }

  // รายชื่อพนักงานสำหรับกล่องค้นหาในหน้าตั้งค่า (เฉพาะที่ยังใช้งานอยู่ ไม่ใช่บัญชีทดสอบ และไม่ถูกลบ) · โหมดทดสอบใช้บัญชีทดสอบ (persona) ที่ฐานข้อมูลส่งให้ admin
  // โหลดไม่สำเร็จ = [] หน้าตั้งค่ายังใช้ได้ด้วยช่องกรอกรหัสพนักงานเอง (ไม่ทำให้ทั้งหน้าล้ม)
  async function loadStaffCandidates(role) {
    try {
      if (role.is_test) return model.staffCandidateOptions(state.sandbox?.personas ?? []);
      const { data, error } = await sb.from("employees").select("employee_no,first_name,last_name,is_active,department:departments(name_th)").eq("is_active", true).eq("is_test", false).is("deleted_at", null);
      if (error) throw error;
      return model.staffCandidateOptions((data ?? []).map((person) => ({ ...person, department: Array.isArray(person.department) ? person.department[0] : person.department })));
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  // ลบไฟล์ในบัคเก็ตทดสอบเป็นชุด (ชุดละ REMOVE_CHUNK) คืนจำนวนไฟล์ที่ลบได้จริง · ชุดที่พลาดข้ามไปทำชุดต่อไป ไฟล์ที่เหลือลบได้ด้วยการกดล้างซ้ำ
  async function removeTestFiles(paths) {
    let removed = 0;
    const bucket = sb.storage.from(model.fileBucket(true));
    for (let index = 0; index < paths.length; index += REMOVE_CHUNK) {
      try {
        const { data, error } = await bucket.remove(paths.slice(index, index + REMOVE_CHUNK));
        if (!error) removed += Array.isArray(data) ? data.length : 0;
      } catch (error) {
        console.error(error);
      }
    }
    return removed;
  }

  // ล้างข้อมูลใบสั่งงาน IT ทดสอบ: เฉพาะ admin ที่อยู่ในโหมดทดสอบ (ฐานข้อมูลตรวจซ้ำ) ลบเฉพาะแถวทดสอบ + ไฟล์ทดสอบ แล้วเริ่มนับเลข TEST- ใหม่
  function bindPurge() {
    document.querySelector("#itwo-purge")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!(await confirmDialog({ title: `${PURGE_TEXT}?`, message: "ล้างเฉพาะใบสั่งงาน IT ทดสอบพร้อมประวัติและไฟล์แนบ แล้วเริ่มนับเลข TEST- ใหม่ ข้อมูลจริงไม่ถูกแตะ", confirmLabel: PURGE_TEXT, danger: true }))) return;
      setButtonBusy(button, true);
      try {
        const data = await rpc("app_sandbox_purge_itwo");
        // ฐานข้อมูลลบแถวแล้ว แต่ไฟล์ใน Storage ลบด้วย SQL ไม่ได้ จึงได้รายการ path (files) มาให้หน้าเว็บลบผ่าน Storage API ต่อ
        const files = Array.isArray(data?.files) ? data.files : [];
        const removed = await removeTestFiles(files);
        const summary = model.purgeSummary({ deleted: data?.deleted ?? 0, total: files.length, removed });
        showToast(summary.message, summary.complete ? "success" : "error");
        if (!summary.complete) { setButtonBusy(button, false); return; } // ลบไฟล์ไม่ครบ: อยู่หน้าเดิมให้กดซ้ำ (ครั้งถัดไปจะได้รายการไฟล์ที่เหลือ)
        if (location.hash === model.workOrderUrl("mine")) await renderRoute();
        else navigate(model.workOrderUrl("mine"));
      } catch (error) {
        setButtonBusy(button, false);
        showToast(friendlyError(error), "error");
      }
    });
  }

  /* ---------- อัปโหลดไฟล์แนบ (ใช้ทั้งตอนแจ้งงานและตอนขอแก้ไขงาน) ---------- */
  // ลำดับ: ใบ/รอบแก้ไขถูกสร้างก่อน → อัปโหลดขึ้น Storage ทีละไฟล์ → app_itwo_add_attachment ลงทะเบียนทีละไฟล์
  // ใบถูกบันทึกแล้ว ไฟล์เป็นส่วนเสริม: ไฟล์ที่ล้มไม่ทำให้ใบหาย ลองซ้ำได้จากแผงความคืบหน้า (ตัวไฟล์อยู่ในหน่วยความจำของหน้านี้ จึงลองซ้ำได้จนกว่าจะออกจากหน้า
  // และต้องอยู่ในหน้าต่างแนบ 30 นาทีที่ฐานข้อมูลกำหนด) · ลองซ้ำใช้ path เดิม ไม่เกิดไฟล์ซ้ำ และข้ามขั้นที่สำเร็จแล้ว
  // host = element ที่แผงวาดทับ · version = รุ่นหน้า: ผู้ใช้ออกไปหน้าอื่นระหว่างอัปโหลด งานเดินต่อเงียบ ๆ แต่ไม่วาดทับหน้าอื่น
  async function attachFiles({ host, version, workOrderId, reworkId = null, files, isTest, heading, intro, continueLabel = "ไปที่ใบสั่งงาน", onContinue }) {
    const bucket = sb.storage.from(model.fileBucket(isTest));
    const entries = model.makeUploadEntries(workOrderId, files, () => window.crypto.randomUUID());
    const stillHere = () => version === pageVersion && location.hash === pageHash;
    let current = null;
    let probe = null;
    const rows = () => entries.map((entry) => ({
      name: entry.file.name,
      size: entry.file.size,
      state: entry.registered ? "done" : entry === current ? "working" : entry.error ? "failed" : "waiting",
      message: entry.error ? model.describeUploadError(entry.error).message : "",
    }));
    const draw = (busy) => {
      if (!stillHere() || host.isConnected === false) return false;
      host.innerHTML = pages.uploadPanel({ heading, intro, rows: rows(), busy, continueLabel });
      return true;
    };
    const release = () => { if (probe && unsavedProbe === probe) unsavedProbe = null; };
    const leave = () => { release(); if (stillHere()) onContinue(); };

    async function run() {
      release();
      const failed = await model.runUploads(entries, {
        // upsert: false = เขียนทับไม่ได้ (ฐานข้อมูลไม่มี policy UPDATE) · contentType ตามนามสกุล ไม่เชื่อ file.type ของเบราว์เซอร์
        upload: async (entry) => {
          const { error } = await bucket.upload(entry.path, entry.file, { contentType: model.fileMime(entry.file), upsert: false });
          if (error) throw error;
        },
        register: (entry) => rpc("app_itwo_add_attachment", {
          p_work_order_id: workOrderId, p_rework_id: reworkId, p_storage_path: entry.path,
          p_file_name: entry.file.name.slice(-200), p_mime_type: model.fileMime(entry.file), p_size_bytes: entry.file.size,
        }),
        onStart: (entry) => { current = entry; draw(true); },
        onProgress: () => { current = null; },
      });
      current = null;
      if (!failed.length) {
        showToast(`แนบไฟล์ครบ ${entries.length} ไฟล์`);
        leave();
        return;
      }
      for (const entry of failed) console.error(entry.error);
      if (!draw(false)) return;
      // ไฟล์ที่ยังไม่ขึ้นระบบจะหายถ้าออกจากหน้านี้ ให้ app.js ถามก่อนออก
      probe = () => entries.filter((entry) => !entry.registered).length;
      unsavedProbe = probe;
      document.querySelector("#itwo-upload-retry")?.addEventListener("click", () => run());
      document.querySelector("#itwo-upload-continue")?.addEventListener("click", () => leave());
    }
    await run();
  }

  /* ---------- แจ้งงานใหม่ ---------- */
  function renderNew(role, version) {
    const requester = { name: role.full_name, department: role.department?.name_th };
    const html = pages.page(`${pages.head({ title: "แจ้งงานใหม่", back: { href: model.workOrderUrl("mine"), label: "‹ ใบสั่งงาน IT" }, isTest: Boolean(role.is_test) })}${pages.orderForm({ requester })}`);
    if (paint(html, "แจ้งงานใหม่", version)) bindOrderForm(role, version);
  }

  function bindOrderForm(role, version) {
    const form = document.querySelector("#itwo-form");
    const card = document.querySelector("#itwo-form-card");
    const message = document.querySelector("#itwo-message");
    const stepsApi = window.MNP_FORM_STEPS;
    const draftApi = window.MNP_FORM_DRAFT;
    const noteField = form.querySelector("#itwo-attachment-note-field");
    const noteInput = form.querySelector("#itwo-attachment-note");
    const miscField = form.querySelector("#itwo-misc-field");
    const miscInput = form.querySelector("#itwo-misc-detail");
    const filesField = form.querySelector("#itwo-files-field");
    const filesInput = form.querySelector("#itwo-files");
    const neededDate = form.querySelector("#itwo-needed-date");
    const checked = (name) => form.querySelector(`[name="${name}"]:checked`)?.value ?? "";
    // ไฟล์ที่ส่งจริง: เฉพาะเมื่อเอกสารแนบ = "มี" (เลือกไฟล์ไว้แล้วเปลี่ยนใจเป็น "ไม่มี" = ไม่ส่งไฟล์) · หลัง modules/attachment-image.js เตรียมไฟล์แล้ว
    const chosenFiles = () => (checked("attachment_flag") === "yes" ? Array.from(filesInput.files ?? []) : []);
    let submitted = false;
    let submitting = false; // กันกดส่งซ้ำระหว่างรอคำตอบ (ปุ่มถูกปิดด้วย setFormBusy อีกชั้น)

    // วันที่ต้องการงานย้อนหลังไม่ได้: ตัวเลือกวันที่เริ่มที่วันนี้ตามเวลาไทย และตรวจซ้ำตอนส่ง (ร่างเก่าอาจมีวันที่ผ่านไปแล้ว)
    neededDate.min = model.todayBangkok();
    window.MNP_DATE_PICKER?.enhance(neededDate);

    const currentValues = () => ({
      request_type: checked("request_type"),
      misc_detail: miscInput.value,
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
    // "เบ็ดเตล็ดอื่นๆ" ต้องระบุว่างานอะไร · ช่องไฟล์โผล่เมื่อเอกสารแนบ = "มี"
    const syncMisc = () => {
      const misc = checked("request_type") === "misc";
      miscField.hidden = !misc;
      if (!misc) stepsApi.clearFieldError(form, "misc_detail");
    };
    const syncFiles = () => { filesField.hidden = checked("attachment_flag") !== "yes"; };
    const syncFields = () => { syncNote(); syncMisc(); syncFiles(); };
    // "ไม่มี" เป็นค่าเริ่มต้นของเอกสารแนบ จึงไม่นับเป็นการกรอก ร่างที่มีแค่ค่านี้ = ว่าง
    const ignoreForEmpty = ["attachment_flag"];
    const drafts = draftApi.createDraftStore({ key: draftApi.draftKey("ITWO", role.employee_id), ignoreForEmpty });
    const autosave = draftApi.createAutosave({ store: drafts, values: currentValues });
    form.addEventListener("input", () => autosave.schedule());
    form.addEventListener("change", () => { syncFields(); autosave.schedule(); });

    const restoreDraft = (values) => {
      const setRadio = (name, value) => form.querySelectorAll(`[name="${name}"]`).forEach((radio) => { radio.checked = radio.value === value; });
      // ร่างเก่าที่เป็นประเภท "สิทธิ์ในระบบ" (ถอดออกแล้ว) ไม่ตรงตัวเลือกไหน: ไม่เลือกอะไร ให้ผู้ใช้เลือกใหม่
      setRadio("request_type", values.request_type);
      setRadio("attachment_flag", values.attachment_flag || "no");
      miscInput.value = values.misc_detail ?? "";
      form.querySelector("#itwo-order-ref").value = values.order_ref ?? "";
      noteInput.value = values.attachment_note ?? "";
      form.querySelector("#itwo-details").value = values.details ?? "";
      neededDate.value = values.needed_date ?? "";
      neededDate.dispatchEvent(new Event("datepicker:refresh"));
      form.querySelector("#itwo-urgent").checked = Boolean(values.is_urgent);
      syncFields();
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
      isDirty: () => !submitted && !draftPending && (!draftApi.isEmptyDraft(currentValues(), ignoreForEmpty) || chosenFiles().length > 0),
      onDiscard: () => { autosave.stop(); drafts.clear(); },
    });

    const renderReview = () => { form.querySelector("#itwo-review").innerHTML = pages.orderReview(currentValues(), chosenFiles().map((file) => ({ name: file.name, size: file.size }))); };
    const stepper = stepsApi.bindStepper({
      form, count: 3, rules: model.orderRules({ attachmentFlag: () => checked("attachment_flag") || "no", requestType: () => checked("request_type") }), values: currentValues, onReview: renderReview, scrollTarget: card,
    });
    syncFields();

    const showFormError = (html) => {
      message.innerHTML = `<div class="form-message error" role="alert">${html}</div>`;
      message.scrollIntoView?.({ block: "nearest" });
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;
      message.innerHTML = "";
      if (!stepper.check("all")) return;
      const files = chosenFiles(); // อ่านก่อน setFormBusy (ช่องที่ถูก disable จะไม่ถูกอ่านค่า)
      const fileProblem = model.validateFiles(files);
      if (fileProblem) { showFormError(escapeHtml(fileProblem)); return; }
      const params = model.createParams(currentValues());
      submitting = true;
      setFormBusy(form, true);
      let created;
      try {
        const data = await rpc("app_itwo_create", params);
        created = Array.isArray(data) ? data[0] : data;
        if (!created?.id) throw Object.assign(new Error("ไม่ได้รับเลขที่เอกสารจากระบบ"), { code: "" });
      } catch (error) {
        const info = failure(error, { write: true });
        // ผลไม่แน่ชัด: ใบอาจถูกสร้างไปแล้ว ชวนไปตรวจที่ "ใบของฉัน" ก่อนกดส่งซ้ำ (ร่างยังอยู่ ไม่ถูกล้าง)
        const check = info.kind === "unknown" ? ` <a href="${model.workOrderUrl("mine")}">ตรวจที่ใบของฉัน</a>` : "";
        showFormError(`${escapeHtml(info.message)}${check}`);
        submitting = false;
        setFormBusy(form, false);
        form.querySelector("[data-step-submit]")?.focus({ preventScroll: true });
        return;
      }
      // ใบถูกบันทึกแล้ว: ต่อจากนี้ห้ามเปิดฟอร์มให้ส่งซ้ำ (จะได้ใบใหม่ซ้ำ) ไฟล์ที่ล้มลองซ้ำที่แผงความคืบหน้า
      submitted = true;
      autosave.stop();
      drafts.clear();
      showToast(`แจ้งงานแล้ว · เลขที่ ${created.doc_no}`);
      const openOrder = () => navigate(model.workOrderUrl("order", { id: created.id }));
      if (!files.length) { openOrder(); return; }
      await attachFiles({
        host: card, version, workOrderId: created.id, files, isTest: Boolean(role.is_test),
        heading: `แจ้งงานแล้ว · เลขที่ ${created.doc_no}`,
        intro: "ใบสั่งงานถูกบันทึกแล้ว ระบบกำลังแนบไฟล์ให้ ถ้าไฟล์ไหนแนบไม่สำเร็จลองใหม่ได้ภายใน 30 นาทีหลังแจ้งงาน",
        onContinue: openOrder,
      });
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

  // ไฟล์แนบของใบ (ทุกรอบ) ในกล่องดูไฟล์เดิมของ app.js: ขอ signed URL แล้วเติมตัวอย่าง/ลิงก์ดาวน์โหลด (hydrateAttachmentGallery · ใบสั่งงานไม่มีภาพย่อ)
  // บัคเก็ตตามโหมดของใบ (ฐานข้อมูลส่งชื่อมากับแต่ละไฟล์)
  function hydrateFiles(detail) {
    const files = detail.attachments ?? [];
    if (!files.length || typeof hydrateAttachmentGallery !== "function") return;
    document.querySelector("#attachment-gallery")?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-attachment-open]");
      if (trigger) openAttachmentLightbox(trigger.dataset.attachmentOpen);
    });
    hydrateAttachmentGallery(files.map(model.galleryFile), files[0].bucket ?? model.fileBucket(Boolean(detail.is_test))).catch((error) => showToast(failure(error).message, "error"));
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
    const draw = () => {
      const html = pages.detailPage(detail, { back });
      if (!paint(html, TITLE, version, detail.doc_no)) return false;
      bindActions();
      bindRework();
      hydrateFiles(detail);
      return true;
    };

    // ---- ปุ่มเปลี่ยนสถานะ: ทุกปุ่มมีกล่องยืนยัน · เหตุผล (ไม่อนุมัติ/ยกเลิก) ถามในกล่องเดียวกัน · "แก้ไขงาน" เปิดฟอร์มของตัวเอง ----
    async function runAction(button) {
      const action = button.dataset.itwoAction;
      const spec = model.ACTION_BUTTONS[action];
      if (!spec) return;
      if (spec.opens === "rework") { openRework(); return; }
      const args = { p_work_order_id: detail.id };
      if (spec.reason) {
        const reason = await textPromptDialog({ title: spec.reason.title, label: spec.reason.label, hint: spec.reason.hint, minLength: 1, maxLength: model.MAX_REASON, confirmLabel: spec.reason.confirmLabel, danger: true });
        if (reason === null) return;
        args.p_reason = reason;
      } else if (!(await confirmDialog({ title: spec.confirmTitle, message: model.confirmMessageFor(action, detail, role), confirmLabel: spec.label, danger: spec.tone === "danger" }))) {
        return;
      }
      const buttons = [...document.querySelectorAll("[data-itwo-action]")];
      buttons.forEach((item) => { item.disabled = true; });
      setButtonBusy(button, true);
      try {
        await rpc(spec.rpc, args);
        // IT ปิดงาน = งานกลับไปหาผู้แจ้ง: บอกชื่อผู้แจ้ง (โหมดทดสอบบอกให้สลับบัญชีไปยืนยัน/ขอแก้ไข)
        showToast(action === "complete" ? model.completeToast(detail, Boolean(detail.is_test || role.is_test)) : spec.done);
      } catch (error) {
        showToast(failure(error, { write: true }).message, "error");
      }
      // สำเร็จหรือไม่ก็โหลดใบใหม่ ปุ่มจึงตรงกับสถานะจริง (ผลไม่แน่ชัด = เห็นว่าบันทึกไปแล้วหรือยัง)
      await renderRoute();
    }
    function bindActions() {
      document.querySelectorAll("[data-itwo-action]").forEach((button) => button.addEventListener("click", () => runAction(button)));
    }

    // ---- ฟอร์มขอแก้ไขงาน (ผู้แจ้ง ตอน IT ปิดงานแล้ว): ซ่อนไว้จนกดปุ่ม "แก้ไขงาน" ----
    function openRework() {
      const card = document.querySelector("#itwo-rework-card");
      if (!card) return;
      card.hidden = false;
      card.scrollIntoView?.({ block: "start", behavior: "smooth" });
      document.querySelector("#itwo-rework-details")?.focus({ preventScroll: true });
    }
    function bindRework() {
      const card = document.querySelector("#itwo-rework-card");
      const form = document.querySelector("#itwo-rework-form");
      if (!card || !form) return;
      const message = document.querySelector("#itwo-rework-message");
      const detailsInput = document.querySelector("#itwo-rework-details");
      const dueInput = document.querySelector("#itwo-rework-due");
      const filesInput = document.querySelector("#itwo-rework-files");
      let busy = false;
      const values = () => ({ details: detailsInput.value, due_date: dueInput.value });
      const chosenFiles = () => Array.from(filesInput.files ?? []);
      const showError = (html) => {
        message.innerHTML = `<div class="form-message error" role="alert">${html}</div>`;
        message.scrollIntoView?.({ block: "nearest" });
      };
      // วันที่กำหนดย้อนหลังไม่ได้ (ตามเวลาไทย) · อ่านวันนี้ใหม่ตอนตรวจทุกครั้งใน model.reworkRules
      dueInput.min = model.todayBangkok();
      window.MNP_DATE_PICKER?.enhance(dueInput);
      // ฟอร์มเปิดอยู่และพิมพ์ค้าง (หรือเลือกไฟล์ไว้) = มีของค้างที่ยังไม่ส่ง · ระหว่างส่งแผงจัดการเอง (ไม่นับ)
      if (version === pageVersion) unsavedProbe = () => (!card.hidden && !busy && (detailsInput.value.trim() !== "" || chosenFiles().length > 0) ? 1 : 0);

      document.querySelector("#itwo-rework-cancel")?.addEventListener("click", () => { card.hidden = true; message.innerHTML = ""; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        message.innerHTML = "";
        const steps = window.MNP_FORM_STEPS;
        const errors = steps.validate(model.reworkRules(), values());
        if (errors.length) { steps.showFieldErrors(form, errors); return; }
        steps.clearFieldErrors(form);
        const files = chosenFiles(); // อ่านก่อน setFormBusy
        const fileProblem = model.validateFiles(files);
        if (fileProblem) { showError(escapeHtml(fileProblem)); return; }
        if (!(await confirmDialog({ title: "ส่งใบกลับให้ IT แก้ไขงาน?", message: "ใบจะกลับไปสถานะกำลังดำเนินการทันที ไม่ต้องอนุมัติใหม่ · ระบบบันทึกชื่อ วันที่ และเวลาของคุณไว้ในประวัติเอกสาร แก้ไขย้อนหลังไม่ได้", confirmLabel: "ส่งให้ IT แก้ไข" }))) return;
        const params = model.reworkParams(detail.id, values());
        busy = true;
        setFormBusy(form, true);
        let created;
        try {
          const data = await rpc("app_itwo_request_rework", params);
          created = Array.isArray(data) ? data[0] : data;
          if (!created?.id) throw Object.assign(new Error("ไม่ได้รับเลขรอบแก้ไขจากระบบ"), { code: "" });
        } catch (error) {
          showError(escapeHtml(failure(error, { write: true }).message));
          busy = false;
          setFormBusy(form, false);
          return;
        }
        showToast(`ส่งใบกลับให้ IT แก้ไขแล้ว · แก้ไขครั้งที่ ${created.round_no}`);
        if (!files.length) { await renderRoute(); return; }
        await attachFiles({
          host: card, version, workOrderId: detail.id, reworkId: created.id, files, isTest: Boolean(detail.is_test || role.is_test),
          heading: `ส่งใบกลับให้ IT แก้ไขแล้ว · แก้ไขครั้งที่ ${created.round_no}`,
          intro: "คำขอแก้ไขถูกบันทึกแล้ว ระบบกำลังแนบไฟล์ให้ ถ้าไฟล์ไหนแนบไม่สำเร็จลองใหม่ได้ภายใน 30 นาทีหลังขอแก้ไข",
          continueLabel: "กลับไปที่ใบสั่งงาน",
          onContinue: () => renderRoute(),
        });
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
      const problem = model.validateStaffForm({ employeeNo: fields.no.value, isAdmin: fields.admin.checked, isApprover: fields.approver.checked, myEmployeeNo: role.employee_no });
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
      // กล่องค้นหาไม่มีรหัสนี้ในรายการ (เช่นโหลดรายชื่อไม่ครบ) เพิ่มตัวเลือกให้ ไม่งั้นค่าจะว่างเงียบ ๆ
      if (fields.no.tagName === "SELECT" && ![...fields.no.options].some((option) => option.value === button.dataset.staffEdit)) fields.no.add(new Option(button.dataset.staffEdit, button.dataset.staffEdit));
      fields.no.value = button.dataset.staffEdit;
      fields.no.dispatchEvent(new Event("change", { bubbles: true }));
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

  const unsavedCount = () => (unsavedProbe ? unsavedProbe() : 0);
  window.MNP_ITWO = Object.freeze({ render, loadCardSummary, unsavedCount });
})();
