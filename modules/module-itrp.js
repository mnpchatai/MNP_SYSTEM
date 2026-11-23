// ใบแจ้งซ่อมคอมพิวเตอร์ (itrp) ของ Pilot Web — หน้าอยู่ใต้ #/office?module=repair (ระบบสำนักงาน › IT SUPPORT › ใบแจ้งซ่อม IT)
//
//   (ไม่มี view) / view=mine   ใบของฉัน + ปุ่ม "แจ้งซ่อมใหม่"
//   view=approvals             รออนุมัติ (ผู้อนุมัติขั้นแผนก / ขั้น IT)         view=it        งาน IT แยกตามสถานะ (ทีม IT)
//   view=settings              ตั้งค่า (it_admin): รายชื่อทีม IT (อ่านอย่างเดียว) + เลขที่เอกสารถัดไป
//   view=new                   ฟอร์มแจ้งซ่อม (เครื่อง · ประเภทคำขอ · ประเภทงานซ่อม · อาการเสีย · แนบไฟล์ · งานด่วน)
//   view=order&id=<uuid>       รายละเอียดใบ + ไทม์ไลน์ + บันทึกการซ่อม + ปุ่มตาม allowed_actions (รวมฟอร์ม "ส่งงาน" ของ IT · "แก้ไขงาน" ของผู้แจ้ง · "ถามผู้แจ้ง" ของผู้อนุมัติ/IT · ฟอร์มตอบ)
//   view=print&id=<uuid>       หน้าพิมพ์ A4 เหมือนฟอร์มกระดาษ "ใบแจ้งซ่อมคอมพิวเตอร์"
//
// คัดโครงจากใบสั่งงาน IT (module-itwo.js) กติกา flow เหมือนกัน (อนุมัติ 2 ขั้น · งานด่วน · ถาม-ตอบ · ส่งงาน/ยืนยันรับ/ขอแก้ไข · IT ยกเลิกแทนผู้แจ้งตอนรอตอบ)
// ที่ต่าง: ไม่มีวันที่ต้องการงาน/ออเดอร์/ส่วนสิทธิ์ในระบบ · "ส่งงาน" เปิดฟอร์มบันทึกการซ่อม (สำหรับแผนก IT + ตารางอะไหล่ ≤10 แถว) แล้วเรียก app_itrp_complete ครั้งเดียว · ใบพิมพ์คนละเลย์เอาต์
// ทีม IT/ผู้อนุมัติขั้น IT อ่านจากตาราง itwo_staff ชุดเดียวกับใบสั่งงาน IT จึงไม่มีฟอร์มแก้สิทธิ์ที่นี่
// ฐานข้อมูล: supabase/migrations/20261212010000_itrp_repair_requests.sql ทุกอย่างเรียกผ่าน RPC app_itrp_* (ตรวจบทบาท ลำดับขั้น เลขที่เอกสารที่ฝั่งฐานข้อมูล) · สัญญา: docs/itrp-contract.md
// หน้าเว็บแค่ซ่อน/แสดงแท็บและปุ่มตาม app_itrp_my_role กับ allowed_actions เป็น UX ล้วน สิทธิ์จริงตัดสินที่ RPC ทุกตัว
// ข้อมูลล้วนอยู่ที่ itrp-model.js · HTML อยู่ที่ itrp-pages.js · ไฟล์นี้ดูแลเฉพาะการเรียก RPC กล่องยืนยัน และผูกเหตุการณ์ของหน้า
// module-office.js เรียก MNP_ITRP.render(params) เมื่อเปิด ?module=repair และ MNP_ITRP.loadCardSummary() เพื่อวาดตัวเลขบนการ์ด
//
// การแจ้งเตือน (อีเมล/Push/กระดิ่ง) ฝั่งฐานข้อมูลส่งให้เอง (trigger บน itrp_events) ลิงก์เปิดใบตรง /office/repair/<uuid> · โหมดทดสอบ: ข้อมูลแยกจากของจริงที่ฐานข้อมูล (is_test) ใบทดสอบมีป้าย "ทดสอบ" ทุกหน้า
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound, showToast, friendlyError,
// confirmDialog, textPromptDialog, setFormBusy, setButtonBusy, renderRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerItrpModule() {
  const model = window.MNP_ITRP_MODEL;
  const pages = window.MNP_ITRP_PAGES;
  if (!model || !pages) return;

  const PATH = "office"; // หน้าของโมดูลนี้ใช้เส้นทางของระบบสำนักงาน (เมนูข้างไฮไลต์ "ระบบสำนักงาน")
  const TITLE = "ใบแจ้งซ่อม";
  const PURGE_TEXT = "ล้างข้อมูลใบแจ้งซ่อมทดสอบ";
  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ
  let pageHash = ""; // location.hash ตอนเริ่มวาดหน้าล่าสุด: ผู้ใช้ออกไปหน้าอื่น (เช่น IT SUPPORT) ระหว่างรอข้อมูล หน้านี้ต้องไม่วาดทับหน้านั้น
  let unsavedProbe = null; // นับสิ่งที่กรอกค้างยังไม่ส่งของหน้าที่วาดอยู่ (app.js เรียกผ่าน MNP_ITRP.unsavedCount ก่อนออกจากหน้า) · ใช้กับฟอร์มส่งงาน ขอแก้ไขงาน ถาม/ตอบ และไฟล์ที่อัปโหลดไม่สำเร็จ
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
    document.querySelector("#itrp-retry")?.addEventListener("click", () => renderRoute());
  }

  /* ---------- ตัวเลขบนการ์ด (IT SUPPORT) ---------- */
  // ป้ายหลัก openCount = ใบที่ผู้ใช้เห็นและยังไม่จบ (รวมใบของฉัน + รออนุมัติ + งาน IT ตามสิทธิ์ แบบไม่นับซ้ำ) · อ่านแหล่งใดแหล่งหนึ่งไม่ได้ = null (การ์ดแสดง "ดูสถานะ" ไม่แสดงเลขที่นับขาด)
  // ป้ายรอง (badge "N รอคุณ") นับงานที่รอ "ฉัน": รออนุมัติ + งาน IT ที่ต้องลงมือ + ใบที่รอฉันยืนยันรับ + ใบที่รอฉันตอบคำถาม · อ่านส่วนไหนไม่ได้ส่วนนั้นไม่นับ
  // โหมดทดสอบ: RPC ทุกตัวแยกข้อมูลทดสอบให้ที่ฐานข้อมูลอยู่แล้ว จึงนับเฉพาะใบทดสอบเอง · role อ่านไม่ได้ = null ทั้งก้อน การ์ดยังกดเข้าได้
  async function loadCardSummary() {
    let role;
    try {
      role = await rpc("app_itrp_my_role");
    } catch {
      return null;
    }
    const hasApprovals = Boolean(role?.is_dept_approver || role?.is_it_approver);
    const hasIt = Boolean(role?.is_it_admin || role?.is_it_approver);
    const [approvals, approvalRows, itRows, mine] = await Promise.all([
      hasApprovals ? attempt(rpc("app_itrp_pending_count")) : null,
      hasApprovals ? attempt(rpc("app_itrp_list_pending_approvals")) : null,
      hasIt ? attempt(rpc("app_itrp_list_it")) : null,
      attempt(rpc("app_itrp_list_mine")),
    ]);
    // แหล่งที่ผู้ใช้มีสิทธิ์ดูต้องอ่านได้ครบจึงจะนับ (ไม่งั้นเลขขาดและทำให้เข้าใจผิด)
    const countable = Boolean(mine && (!hasApprovals || approvalRows) && (!hasIt || itRows));
    return model.cardSummary({
      openCount: countable ? model.openOrderCount(mine.value, hasApprovals ? approvalRows.value : [], hasIt ? itRows.value : []) : null,
      approvals: approvals ? approvals.value : null,
      // ตัวเลข "งาน IT ค้าง" นับให้เฉพาะผู้ดูแลงาน IT (ผู้ลงมือทำ) · ผู้อนุมัติขั้น IT ที่ไม่ใช่ผู้ดูแลงานเห็นรายการได้แต่ไม่มีงานให้ลงมือ
      itWork: itRows && role?.is_it_admin ? model.itActionableCount(itRows.value) : null,
      toConfirm: mine ? model.awaitingMyReceiveCount(mine.value) : null,
      toAnswer: mine ? model.awaitingMyAnswerCount(mine.value) : null,
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
      role = await rpc("app_itrp_my_role");
    } catch (error) {
      return errorPage(error, version);
    }
    // แท็บที่ไม่มีสิทธิ์เห็น (พิมพ์ URL เอง) พากลับ "ใบของฉัน" ก่อนเรียกข้อมูลใด ๆ
    if (!model.viewAllowed(view, role)) {
      navigate(model.repairUrl("mine"));
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
      mine: () => rpc("app_itrp_list_mine"),
      approvals: () => rpc("app_itrp_list_pending_approvals"),
      it: () => rpc("app_itrp_list_it"),
      settings: () => Promise.all([rpc("app_itrp_list_staff"), rpc("app_itrp_get_doc_counter")]),
    }[view];
    // ตัวเลขบนแท็บอื่นอ่านขนานไปด้วย ไม่รอและไม่ทำให้หน้าล้ม
    const [main, approvalsCount, itRows, mineRows] = await Promise.all([
      mainCall(),
      hasApprovals && view !== "approvals" ? attempt(rpc("app_itrp_pending_count")) : null,
      hasIt && view !== "it" ? attempt(rpc("app_itrp_list_it")) : null,
      view !== "mine" ? attempt(rpc("app_itrp_list_mine")) : null,
    ]);
    // ใบที่รอ "ฉัน" ยืนยันรับงาน/ขอแก้ไข (IT ส่งงานแล้ว) + ใบที่รอฉันตอบคำถาม (งานกลับมาหาผู้แจ้ง) · แสดงบนแท็บ "ใบของฉัน" ทุกหน้า
    const mineParts = view === "mine" ? model.mineWaiting(main) : mineRows ? model.mineWaiting(mineRows.value) : null;
    const counts = {
      mine: mineParts ? mineParts.total : undefined,
      mineParts: mineParts ?? undefined,
      // แท็บรออนุมัติ: ใบที่ถามผู้แจ้งไปแล้ว (need_info) แสดงในรายการแต่ไม่ใช่ "รอคุณ" จึงไม่นับ (app_itrp_pending_count ก็ไม่นับ)
      approvals: view === "approvals" ? model.waitingForMeCount(main) : approvalsCount?.value,
      // แท็บ "งาน IT" ของผู้อนุมัติขั้น IT ที่ไม่ใช่ผู้ดูแลงานเป็นแบบดูอย่างเดียว (ปุ่มลงมือมาจาก allowed_actions ซึ่งฐานข้อมูลไม่ให้) จึงไม่แสดงตัวเลขงานค้าง
      it: !role.is_it_admin ? undefined : view === "it" ? model.itActionableCount(main) : itRows ? model.itActionableCount(itRows.value) : undefined,
    };
    let body;
    if (view === "mine") body = pages.mineList(main);
    else if (view === "approvals") body = pages.approvalsList(main);
    else if (view === "it") body = pages.itList(main);
    else body = pages.settingsPage({ staff: main[0], counter: main[1] });
    const html = pages.page(`${pages.head({ actions: pages.newButton(), isTest: Boolean(role.is_test) })}${pages.tabs(role, view, counts)}${body}${isSandbox() ? pages.purgeRow() : ""}`);
    if (!paint(html, TITLE, version)) return;
    bindPurge();
    if (view === "settings") bindSettings(main[1]);
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

  // ล้างข้อมูลใบแจ้งซ่อมทดสอบ: เฉพาะ admin ที่อยู่ในโหมดทดสอบ (ฐานข้อมูลตรวจซ้ำ) ลบเฉพาะแถวทดสอบ + ไฟล์ทดสอบ แล้วเริ่มนับเลข TEST- ใหม่
  function bindPurge() {
    document.querySelector("#itrp-purge")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!(await confirmDialog({ title: `${PURGE_TEXT}?`, message: "ล้างเฉพาะใบแจ้งซ่อมทดสอบพร้อมประวัติ บันทึกการซ่อม และไฟล์แนบ แล้วเริ่มนับเลข TEST- ใหม่ ข้อมูลจริงไม่ถูกแตะ", confirmLabel: PURGE_TEXT, danger: true }))) return;
      setButtonBusy(button, true);
      try {
        const data = await rpc("app_sandbox_purge_itrp");
        // ฐานข้อมูลลบแถวแล้ว แต่ไฟล์ใน Storage ลบด้วย SQL ไม่ได้ จึงได้รายการ path (files) มาให้หน้าเว็บลบผ่าน Storage API ต่อ
        const files = Array.isArray(data?.files) ? data.files : [];
        const removed = await removeTestFiles(files);
        const summary = model.purgeSummary({ deleted: data?.deleted ?? 0, total: files.length, removed });
        showToast(summary.message, summary.complete ? "success" : "error");
        if (!summary.complete) { setButtonBusy(button, false); return; } // ลบไฟล์ไม่ครบ: อยู่หน้าเดิมให้กดซ้ำ (ครั้งถัดไปจะได้รายการไฟล์ที่เหลือ)
        if (location.hash === model.repairUrl("mine")) await renderRoute();
        else navigate(model.repairUrl("mine"));
      } catch (error) {
        setButtonBusy(button, false);
        showToast(friendlyError(error), "error");
      }
    });
  }

  /* ---------- อัปโหลดไฟล์แนบ (ใช้ทั้งตอนแจ้งซ่อม ขอแก้ไขงาน และถาม-ตอบ) ---------- */
  // ลำดับ: ใบ/รอบแก้ไข/ข้อความถาม-ตอบถูกสร้างก่อน → อัปโหลดขึ้น Storage ทีละไฟล์ → app_itrp_add_attachment (ไฟล์ของข้อความถาม-ตอบ: app_itrp_add_comment_attachment) ลงทะเบียนทีละไฟล์
  // ใบถูกบันทึกแล้ว ไฟล์เป็นส่วนเสริม: ไฟล์ที่ล้มไม่ทำให้ใบหาย ลองซ้ำได้จากแผงความคืบหน้า (ตัวไฟล์อยู่ในหน่วยความจำของหน้านี้ จึงลองซ้ำได้จนกว่าจะออกจากหน้า
  // และต้องอยู่ในหน้าต่างแนบ 30 นาทีที่ฐานข้อมูลกำหนด) · ลองซ้ำใช้ path เดิม ไม่เกิดไฟล์ซ้ำ และข้ามขั้นที่สำเร็จแล้ว
  // host = element ที่แผงวาดทับ · version = รุ่นหน้า: ผู้ใช้ออกไปหน้าอื่นระหว่างอัปโหลด งานเดินต่อเงียบ ๆ แต่ไม่วาดทับหน้าอื่น
  // commentId = id ข้อความถาม/ตอบ (ได้จาก request_info / provide_info) · ไม่ส่ง = ไฟล์ของใบ/รอบแก้ไข
  async function attachFiles({ host, version, requestId, reworkId = null, commentId = null, files, isTest, heading, intro, continueLabel = "ไปที่ใบแจ้งซ่อม", onContinue }) {
    const bucket = sb.storage.from(model.fileBucket(isTest));
    const entries = model.makeUploadEntries(requestId, files, () => window.crypto.randomUUID());
    const stillHere = () => version === pageVersion && location.hash === pageHash;
    let current = null;
    let probe = null;
    const rows = () => entries.map((entry) => ({
      name: entry.file.name,
      size: entry.file.size,
      state: entry.registered ? "done" : entry === current ? "working" : entry.error ? "failed" : "waiting",
      message: entry.error ? model.describeUploadError(entry.error, { comment: commentId !== null }).message : "",
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
        // upsert: false = เขียนทับไม่ได้ (ฐานข้อมูลไม่มี policy UPDATE)
        // ชนิดไฟล์: supabase-js ส่ง File/Blob ผ่าน FormData และไม่ใช้ options.contentType → Storage จดชนิดจาก file.type ของเบราว์เซอร์ (CSV บน Windows
        // เป็น application/vnd.ms-excel, docx บางเครื่องว่าง) ซึ่งไม่ตรงนามสกุล ฐานข้อมูลจะปฏิเสธ · จึงห่อเป็น File ใหม่ที่ type ตามนามสกุลก่อนส่ง (ตรงกับ private.itrp_ext_matches_mime)
        upload: async (entry) => {
          const typed = new File([entry.file], entry.file.name, { type: model.fileMime(entry.file) });
          const { error } = await bucket.upload(entry.path, typed, { upsert: false });
          if (error) throw error;
        },
        register: (entry) => (commentId !== null
          ? rpc("app_itrp_add_comment_attachment", {
            p_request_id: requestId, p_comment_id: commentId, p_storage_path: entry.path,
            p_file_name: entry.file.name.slice(-200), p_mime_type: model.fileMime(entry.file), p_size_bytes: entry.file.size,
          })
          : rpc("app_itrp_add_attachment", {
            p_request_id: requestId, p_rework_id: reworkId, p_storage_path: entry.path,
            p_file_name: entry.file.name.slice(-200), p_mime_type: model.fileMime(entry.file), p_size_bytes: entry.file.size,
          })),
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
      document.querySelector("#itrp-upload-retry")?.addEventListener("click", () => run());
      document.querySelector("#itrp-upload-continue")?.addEventListener("click", () => leave());
    }
    await run();
  }

  /* ---------- แจ้งซ่อมใหม่ ---------- */
  function renderNew(role, version) {
    const requester = { name: role.full_name, department: role.department?.name_th };
    const html = pages.page(`${pages.head({ title: "แจ้งซ่อมใหม่", back: { href: model.repairUrl("mine"), label: "‹ ใบแจ้งซ่อม" }, isTest: Boolean(role.is_test) })}${pages.orderForm({ requester })}`);
    if (paint(html, "แจ้งซ่อมใหม่", version)) bindOrderForm(role, version);
  }

  function bindOrderForm(role, version) {
    const form = document.querySelector("#itrp-form");
    const card = document.querySelector("#itrp-form-card");
    const message = document.querySelector("#itrp-message");
    const stepsApi = window.MNP_FORM_STEPS;
    const draftApi = window.MNP_FORM_DRAFT;
    const kindNoteField = form.querySelector("#itrp-kind-note-field");
    const kindNoteInput = form.querySelector("#itrp-kind-note");
    const targetNoteField = form.querySelector("#itrp-target-note-field");
    const targetNoteInput = form.querySelector("#itrp-target-note");
    const filesInput = form.querySelector("#itrp-files");
    const checked = (name) => form.querySelector(`[name="${name}"]:checked`)?.value ?? "";
    // ไฟล์ที่ส่งจริง: หลัง modules/attachment-image.js เตรียมไฟล์แล้ว (แนบได้เสมอ ไม่มีตัวเลือก "มี/ไม่มี")
    const chosenFiles = () => Array.from(filesInput.files ?? []);
    let submitted = false;
    let submitting = false; // กันกดส่งซ้ำระหว่างรอคำตอบ (ปุ่มถูกปิดด้วย setFormBusy อีกชั้น)

    const currentValues = () => ({
      asset_code: form.querySelector("#itrp-asset-code").value,
      device_name: form.querySelector("#itrp-device-name").value,
      request_kind: checked("request_kind"),
      request_kind_note: kindNoteInput.value,
      repair_target: checked("repair_target"),
      repair_target_note: targetNoteInput.value,
      symptom: form.querySelector("#itrp-symptom").value,
      is_urgent: form.querySelector("#itrp-urgent").checked,
    });
    // เลือก "อื่นๆ" ต้องระบุ: ช่องข้อความโผล่เมื่อเลือก (ซ่อนแล้วล้างข้อผิดพลาดของช่องนั้น)
    const syncNotes = () => {
      const kindOther = checked("request_kind") === "other";
      kindNoteField.hidden = !kindOther;
      if (!kindOther) stepsApi.clearFieldError(form, "request_kind_note");
      const targetOther = checked("repair_target") === "other";
      targetNoteField.hidden = !targetOther;
      if (!targetOther) stepsApi.clearFieldError(form, "repair_target_note");
    };
    const drafts = draftApi.createDraftStore({ key: draftApi.draftKey("ITRP", role.employee_id) });
    const autosave = draftApi.createAutosave({ store: drafts, values: currentValues });
    form.addEventListener("input", () => autosave.schedule());
    form.addEventListener("change", () => { syncNotes(); autosave.schedule(); });

    const restoreDraft = (values) => {
      const setRadio = (name, value) => form.querySelectorAll(`[name="${name}"]`).forEach((radio) => { radio.checked = radio.value === value; });
      form.querySelector("#itrp-asset-code").value = values.asset_code ?? "";
      form.querySelector("#itrp-device-name").value = values.device_name ?? "";
      setRadio("request_kind", values.request_kind);
      kindNoteInput.value = values.request_kind_note ?? "";
      setRadio("repair_target", values.repair_target);
      targetNoteInput.value = values.repair_target_note ?? "";
      form.querySelector("#itrp-symptom").value = values.symptom ?? "";
      form.querySelector("#itrp-urgent").checked = Boolean(values.is_urgent);
      syncNotes();
    };
    const draft = drafts.load();
    let draftPending = Boolean(draft);
    if (draft) {
      autosave.stop();
      draftApi.offerDraft({
        banner: document.querySelector("#itrp-draft"),
        message: `มีร่างใบแจ้งซ่อมค้างจาก ${formatDate(new Date(draft.savedAt).toISOString(), true)}`,
        onUse: () => { draftPending = false; autosave.start(); restoreDraft(draft.values); form.querySelector("#itrp-device-name").focus(); },
        onDiscard: () => { draftPending = false; autosave.start(); drafts.clear(); focusFirstStep(form); },
        // กรอกเองโดยไม่ตอบแถบ = เริ่มใบใหม่ ร่างเดิมถูกแทนด้วยสิ่งที่กรอก
        form,
        onEdit: () => { draftPending = false; autosave.start(); autosave.schedule(); },
        hasInput: () => !draftApi.isEmptyDraft(currentValues()),
      });
    }

    bindFormCancel(form, {
      title: "ทิ้งใบแจ้งซ่อมที่กรอกไว้?",
      isDirty: () => !submitted && !draftPending && (!draftApi.isEmptyDraft(currentValues()) || chosenFiles().length > 0),
      onDiscard: () => { autosave.stop(); drafts.clear(); },
    });

    const renderReview = () => { form.querySelector("#itrp-review").innerHTML = pages.orderReview(currentValues(), chosenFiles().map((file) => ({ name: file.name, size: file.size }))); };
    const stepper = stepsApi.bindStepper({
      form, count: 3, rules: model.repairRules({ requestKind: () => checked("request_kind"), repairTarget: () => checked("repair_target") }), values: currentValues, onReview: renderReview, scrollTarget: card,
    });
    syncNotes();

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
      // ฟอร์มเป็น novalidate: ระหว่างแปลงรูป (เช่น HEIC) attachment-image.js ตั้ง validationMessage ไว้ที่ช่องไฟล์ ส่งตอนนี้จะได้ไฟล์ที่ยังไม่แปลง
      if (files.length && filesInput.validationMessage) { showFormError(escapeHtml(model.FILES_PREPARING_MESSAGE)); return; }
      const fileProblem = model.validateFiles(files);
      if (fileProblem) { showFormError(escapeHtml(fileProblem)); return; }
      const params = model.createParams(currentValues());
      submitting = true;
      setFormBusy(form, true);
      let created;
      try {
        const data = await rpc("app_itrp_create", params);
        created = Array.isArray(data) ? data[0] : data;
        if (!created?.id) throw Object.assign(new Error("ไม่ได้รับเลขที่เอกสารจากระบบ"), { code: "" });
      } catch (error) {
        const info = failure(error, { write: true });
        // ผลไม่แน่ชัด: ใบอาจถูกสร้างไปแล้ว ชวนไปตรวจที่ "ใบของฉัน" ก่อนกดส่งซ้ำ (ร่างยังอยู่ ไม่ถูกล้าง)
        const check = info.kind === "unknown" ? ` <a href="${model.repairUrl("mine")}">ตรวจที่ใบของฉัน</a>` : "";
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
      showToast(`แจ้งซ่อมแล้ว · เลขที่ ${created.doc_no}`);
      const openOrder = () => navigate(model.repairUrl("order", { id: created.id }));
      if (!files.length) { openOrder(); return; }
      await attachFiles({
        host: card, version, requestId: created.id, files, isTest: Boolean(role.is_test),
        heading: `แจ้งซ่อมแล้ว · เลขที่ ${created.doc_no}`,
        intro: "ใบแจ้งซ่อมถูกบันทึกแล้ว ระบบกำลังแนบไฟล์ให้ ถ้าไฟล์ไหนแนบไม่สำเร็จลองใหม่ได้ภายใน 30 นาทีหลังแจ้งซ่อม",
        onContinue: openOrder,
      });
    });
  }

  /* ---------- รายละเอียดใบ ---------- */
  // ปุ่มกลับ: มาจากรออนุมัติ/งาน IT กลับไปที่นั่น ไม่งั้นกลับ "ใบของฉัน"
  function backTarget() {
    const from = typeof previousPageHash === "string" ? previousPageHash : "";
    if (/^#\/office\?module=repair&view=approvals$/.test(from)) return { href: from, label: "‹ รออนุมัติ" };
    if (/^#\/office\?module=repair&view=it$/.test(from)) return { href: from, label: "‹ งาน IT" };
    return { href: model.repairUrl("mine"), label: "‹ ใบแจ้งซ่อม" };
  }

  async function loadDetail(id) {
    return rpc("app_itrp_get_detail", { p_request_id: id });
  }

  // ไฟล์แนบของใบ (ตอนแจ้ง ทุกรอบแก้ไข และไฟล์ของข้อความถาม-ตอบ) ในกล่องดูไฟล์เดิมของ app.js: ขอ signed URL แล้วเติมตัวอย่าง/ลิงก์ดาวน์โหลด (hydrateAttachmentGallery · ใบแจ้งซ่อมไม่มีภาพย่อ)
  // บัคเก็ตตามโหมดของใบ (ฐานข้อมูลส่งชื่อมากับแต่ละไฟล์)
  function hydrateFiles(detail) {
    const files = model.allFiles(detail);
    if (!files.length || typeof hydrateAttachmentGallery !== "function") return;
    document.querySelector("#attachment-gallery")?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-attachment-open]");
      if (trigger) openAttachmentLightbox(trigger.dataset.attachmentOpen);
    });
    hydrateAttachmentGallery(files.map(model.galleryFile), files[0].bucket ?? model.fileBucket(Boolean(detail.is_test))).catch((error) => showToast(failure(error).message, "error"));
  }

  async function renderOrder(id, role, version) {
    if (!model.isUuid(id)) return renderNotFound("ไม่พบรหัสใบแจ้งซ่อม");
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
      bindComplete();
      bindRework();
      bindInfoForm("ask");
      bindInfoForm("answer");
      hydrateFiles(detail);
      return true;
    };

    // ---- ปุ่มเปลี่ยนสถานะ: ทุกปุ่มมีกล่องยืนยัน · เหตุผล (ไม่อนุมัติ/ยกเลิก) ถามในกล่องเดียวกัน · "ส่งงาน" "แก้ไขงาน" "ถามผู้แจ้ง" เปิดฟอร์มของตัวเอง ----
    async function runAction(button) {
      const action = button.dataset.itrpAction;
      const spec = model.ACTION_BUTTONS[action];
      if (!spec) return;
      if (spec.opens === "complete") { openComplete(); return; }
      if (spec.opens === "rework") { openRework(); return; }
      if (spec.opens === "ask") { openAsk(); return; }
      const args = { p_request_id: detail.id };
      if (spec.reason) {
        // ยกเลิก: IT ยกเลิกแทนผู้แจ้ง (ใบรอผู้แจ้งตอบ) ใช้ข้อความ/ความยาวของตัวเอง · ปุ่มอื่นใช้ค่าเดิม
        const reasonSpec = action === "cancel" ? model.cancelReasonSpec(detail, role) : { ...spec.reason, maxLength: model.MAX_REASON };
        const reason = await textPromptDialog({ title: reasonSpec.title, label: reasonSpec.label, hint: reasonSpec.hint, minLength: 1, maxLength: reasonSpec.maxLength, confirmLabel: reasonSpec.confirmLabel, danger: true });
        if (reason === null) return;
        args.p_reason = reason;
      } else if (!(await confirmDialog({ title: spec.confirmTitle, message: model.confirmMessageFor(action, detail, role), confirmLabel: spec.label, danger: spec.tone === "danger" }))) {
        return;
      }
      const buttons = [...document.querySelectorAll("[data-itrp-action]")];
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
      document.querySelectorAll("[data-itrp-action]").forEach((button) => button.addEventListener("click", () => runAction(button)));
    }

    // ของค้างที่ยังไม่ส่งของหน้ารายละเอียดนี้ (ฟอร์มส่งงาน / ขอแก้ไข / ถาม / ตอบ รวมกัน) ให้ app.js ถามก่อนออกจากหน้า
    const unsavedProbes = [];
    function watchUnsaved(probe) {
      if (version !== pageVersion) return;
      unsavedProbes.push(probe);
      unsavedProbe = () => (unsavedProbes.some((item) => item()) ? 1 : 0);
    }

    // ---- ฟอร์มส่งงาน (ผู้ดูแลงาน IT): ซ่อนไว้จนกดปุ่ม "ส่งงาน" · ส่วน "สำหรับแผนก IT" + ตารางอะไหล่ แล้วเรียก app_itrp_complete ครั้งเดียว ----
    let deviceOptionsRequested = false;
    async function loadDeviceOptions() {
      if (deviceOptionsRequested) return;
      deviceOptionsRequested = true;
      const result = await attempt(rpc("app_itrp_list_devices", {})); // ล้มเหลว (เช่น สิทธิ์/เครือข่าย) = ไม่มีรายการให้เลือก ฟอร์มยังใช้ได้
      const list = document.querySelector("#itrp-device-codes");
      if (!result || !Array.isArray(result.value) || !list || list.isConnected === false) return;
      list.innerHTML = pages.codeOptions(result.value);
    }
    function openComplete() {
      const card = document.querySelector("#itrp-complete-card");
      if (!card) return;
      card.hidden = false;
      card.scrollIntoView?.({ block: "start", behavior: "smooth" });
      document.querySelector("#itrp-cause")?.focus({ preventScroll: true });
      loadDeviceOptions();
    }
    function bindComplete() {
      const card = document.querySelector("#itrp-complete-card");
      const form = document.querySelector("#itrp-complete-form");
      if (!card || !form) return;
      const message = document.querySelector("#itrp-complete-message");
      const stepsApi = window.MNP_FORM_STEPS;
      const partsBody = form.querySelector("#itrp-parts-body");
      const addButton = form.querySelector("#itrp-part-add");
      const devicesBody = form.querySelector("#itrp-devices-body");
      const devicesWrap = form.querySelector("#itrp-devices-wrap");
      const deviceAddButton = form.querySelector("#itrp-device-add");
      const noDevice = form.querySelector("#itrp-no-device");
      const causeNoteField = form.querySelector("#itrp-cause-note-field");
      const vendorField = form.querySelector("#itrp-vendor-field");
      const vendorLabel = form.querySelector("#itrp-vendor-label");
      const checked = (name) => form.querySelector(`[name="${name}"]:checked`)?.value ?? "";
      let busy = false;
      const values = () => ({
        cause: form.querySelector("#itrp-cause").value,
        cause_kind: checked("cause_kind"),
        cause_kind_note: form.querySelector("#itrp-cause-note").value,
        repair_method: checked("repair_method"),
        repair_vendor: form.querySelector("#itrp-vendor").value,
        repair_action: form.querySelector("#itrp-repair-action").value,
        pr_po_no: form.querySelector("#itrp-pr-po").value,
      });
      const partRows = () => [...partsBody.querySelectorAll("[data-part-row]")].map((row) => ({
        item_name: row.querySelector('[name="part_item"]').value,
        quantity: row.querySelector('[name="part_quantity"]').value,
        price: row.querySelector('[name="part_price"]').value,
        note: row.querySelector('[name="part_note"]').value,
      }));
      // เครื่อง/อุปกรณ์ที่ซ่อม (แถวละเครื่อง) · ชื่อช่องตรงกับ model.normalizeDevices
      const deviceRows = () => [...devicesBody.querySelectorAll("[data-device-row]")].map((row) => ({
        device_code: row.querySelector('[name="device_code"]').value,
        remark: row.querySelector('[name="device_remark"]').value,
        symptom_note: row.querySelector('[name="device_symptom"]').value,
        action_note: row.querySelector('[name="device_action"]').value,
      }));
      const DEVICE_INPUT_NAME = { device_code: "device_code", remark: "device_remark", symptom_note: "device_symptom", action_note: "device_action" };
      // เหมือน markInvalidParts: กรอบแดงเฉพาะช่องที่ผิดจริง (กลไกกลางตั้งไว้ที่ช่องแรกของตารางเสมอ) คืนช่องแรกที่ผิด
      const markInvalidDevices = (invalid) => {
        devicesBody.querySelectorAll("[aria-invalid='true']").forEach((node) => node.removeAttribute("aria-invalid"));
        const rows = [...devicesBody.querySelectorAll("[data-device-row]")];
        const inputs = invalid.map(({ row, field }) => rows[row]?.querySelector(`[name="${DEVICE_INPUT_NAME[field]}"]`)).filter(Boolean);
        inputs.forEach((input) => input.setAttribute("aria-invalid", "true"));
        // ช่องอาการ/การแก้ไขอยู่ในส่วนที่พับ: ถ้าผิดที่ช่องนั้นให้เปิดส่วนที่พับก่อน ไม่งั้นมองไม่เห็นกรอบแดง
        inputs.forEach((input) => { const details = input.closest?.("details"); if (details) details.open = true; });
        return inputs[0] ?? null;
      };
      // ชื่อช่องในตารางอะไหล่ ตรงกับ `invalid[].field` ของ model.normalizeParts
      const PART_INPUT_NAME = { item_name: "part_item", quantity: "part_quantity", price: "part_price", note: "part_note" };
      // ทำ aria-invalid (กรอบแดง) เฉพาะช่องที่ผิดจริง คืนช่องแรกที่ผิด · เรียกหลัง showFieldErrors เพราะมันตั้งกรอบแดงที่ช่องแรกของตารางไว้ก่อนแล้ว
      const markInvalidParts = (invalid) => {
        partsBody.querySelectorAll("[aria-invalid='true']").forEach((node) => node.removeAttribute("aria-invalid"));
        const rows = [...partsBody.querySelectorAll("[data-part-row]")];
        const inputs = invalid.map(({ row, field }) => rows[row]?.querySelector(`[name="${PART_INPUT_NAME[field]}"]`)).filter(Boolean);
        inputs.forEach((input) => input.setAttribute("aria-invalid", "true"));
        return inputs[0] ?? null;
      };
      const showError = (html) => {
        message.innerHTML = `<div class="form-message error" role="alert">${html}</div>`;
        message.scrollIntoView?.({ block: "nearest" });
      };
      // ช่องข้อความระบุตามตัวเลือก: "อื่นๆ" (สรุปสาเหตุ) ต้องระบุ · ช่องผู้ซ่อม/สถานที่ส่งซ่อมเปลี่ยนป้ายและบังคับตามการตรวจซ่อม
      const syncChoices = () => {
        const causeOther = checked("cause_kind") === "other";
        causeNoteField.hidden = !causeOther;
        if (!causeOther) stepsApi.clearFieldError(form, "cause_kind_note");
        const vendor = model.vendorField(checked("repair_method"));
        vendorField.hidden = !vendor.visible;
        if (vendor.visible) vendorLabel.innerHTML = pages.vendorLabel(vendor);
        else stepsApi.clearFieldError(form, "repair_vendor");
        // ติ๊ก "งานนี้ไม่มีรหัสเครื่อง" = ซ่อนตารางเครื่อง (ค่าที่กรอกไว้ยังอยู่ ติ๊กออกแล้วกลับมา) และไม่ส่งรายการเครื่อง
        devicesWrap.hidden = noDevice.checked;
        if (noDevice.checked) stepsApi.clearFieldError(form, "devices");
      };
      // วาดตารางอะไหล่ใหม่จากข้อมูล (ลำดับ/ป้ายของช่องเรียงใหม่เสมอ) · ครบ MAX_PARTS แถวปิดปุ่มเพิ่ม · ลบแถวสุดท้ายแล้วเหลือแถวว่าง 1 แถว
      const drawParts = (rows, focusIndex = null) => {
        const list = rows.length ? rows : [{}];
        partsBody.innerHTML = list.map((row, index) => pages.partRow(index, row)).join("");
        addButton.disabled = list.length >= model.MAX_PARTS;
        if (focusIndex !== null) partsBody.querySelectorAll('[name="part_item"]')[focusIndex]?.focus();
      };
      // วาดแถวเครื่องใหม่จากข้อมูล (ลำดับ/ป้ายของช่องเรียงใหม่เสมอ) · ครบ MAX_DEVICES แถวปิดปุ่มเพิ่ม · ลบแถวสุดท้ายแล้วเหลือแถวว่าง 1 แถว
      const drawDevices = (rows, focusIndex = null) => {
        const list = rows.length ? rows : [{}];
        devicesBody.innerHTML = list.map((row, index) => pages.deviceRow(index, row)).join("");
        deviceAddButton.disabled = list.length >= model.MAX_DEVICES;
        if (focusIndex !== null) devicesBody.querySelectorAll('[name="device_code"]')[focusIndex]?.focus();
      };
      deviceAddButton.addEventListener("click", () => {
        const rows = deviceRows();
        if (rows.length >= model.MAX_DEVICES) return;
        stepsApi.clearFieldError(form, "devices");
        drawDevices([...rows, {}], rows.length);
      });
      devicesBody.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-device-remove]");
        if (!remove) return;
        const rows = deviceRows();
        const index = [...devicesBody.querySelectorAll("[data-device-row]")].indexOf(remove.closest("[data-device-row]"));
        if (index < 0) return;
        rows.splice(index, 1);
        stepsApi.clearFieldError(form, "devices");
        drawDevices(rows, Math.min(index, rows.length - 1) >= 0 ? Math.min(index, rows.length - 1) : 0);
      });
      // แก้ช่องไหนในตารางเครื่อง กรอบแดงของช่องนั้นหาย · แก้ครบทุกช่องที่ผิดแล้วข้อความใต้ตารางหายตาม
      devicesBody.addEventListener("input", (event) => {
        event.target.removeAttribute?.("aria-invalid");
        if (!devicesBody.querySelector("[aria-invalid='true']")) stepsApi.clearFieldError(form, "devices");
      });
      addButton.addEventListener("click", () => {
        const rows = partRows();
        if (rows.length >= model.MAX_PARTS) return;
        stepsApi.clearFieldError(form, "parts");
        drawParts([...rows, {}], rows.length);
      });
      partsBody.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-part-remove]");
        if (!remove) return;
        const rows = partRows();
        const index = [...partsBody.querySelectorAll("[data-part-row]")].indexOf(remove.closest("[data-part-row]"));
        if (index < 0) return;
        rows.splice(index, 1);
        stepsApi.clearFieldError(form, "parts");
        drawParts(rows, Math.min(index, rows.length - 1) >= 0 ? Math.min(index, rows.length - 1) : 0);
      });
      form.addEventListener("change", syncChoices);
      // แก้ช่องไหนในตารางอะไหล่ กรอบแดงของช่องนั้นหาย · แก้ครบทุกช่องที่ผิดแล้วข้อความใต้ตารางหายตาม
      partsBody.addEventListener("input", (event) => {
        event.target.removeAttribute?.("aria-invalid");
        if (!partsBody.querySelector("[aria-invalid='true']")) stepsApi.clearFieldError(form, "parts");
      });
      syncChoices();
      // ฟอร์มเปิดอยู่และพิมพ์ค้าง = มีของค้างที่ยังไม่ส่ง · ระหว่างส่งแผงจัดการเอง (ไม่นับ)
      // แถวเครื่องแรกถูกเติมรหัสที่ผู้แจ้งกรอกไว้ให้ จึงเทียบกับค่าตั้งต้น (ไม่นับว่าพิมพ์ค้าง) · ติ๊ก "ไม่มีรหัสเครื่อง" นับว่าแก้แล้ว
      const initialDevices = JSON.stringify(deviceRows());
      const hasInput = () => Object.values(values()).some((value) => String(value ?? "").trim() !== "") || partRows().some((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""))
        || noDevice.checked || JSON.stringify(deviceRows()) !== initialDevices;
      watchUnsaved(() => (card.isConnected && !card.hidden && !busy && hasInput() ? 1 : 0));

      document.querySelector("#itrp-complete-cancel")?.addEventListener("click", () => { card.hidden = true; message.innerHTML = ""; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        message.innerHTML = "";
        const current = values();
        const errors = stepsApi.validate(model.completeRules({ causeKind: () => current.cause_kind, repairMethod: () => current.repair_method }), current);
        // เครื่องที่ซ่อม (ตามลำดับบนจอ: ก่อนอะไหล่) ต้องมี ≥1 เครื่อง หรือติ๊ก "ไม่มีรหัสเครื่อง"
        const devices = model.normalizeDevices(deviceRows(), { noDevice: noDevice.checked });
        if (devices.errors.length) errors.push({ name: "devices", message: devices.errors[0] });
        const parts = model.normalizeParts(partRows());
        if (parts.errors.length) errors.push({ name: "parts", message: parts.errors[0] }); // แสดงข้อผิดพลาดแถวแรกที่พบ แก้แล้วกดส่งใหม่เพื่อดูแถวถัดไป
        if (errors.length) {
          const firstTarget = stepsApi.showFieldErrors(form, errors);
          // กลไกกลางทำกรอบแดงที่ช่องแรกของตารางเครื่อง/อะไหล่เสมอ → ย้ายไปที่ช่องที่ผิดจริงทุกช่อง (ข้อความใต้ตารางคงเดิม)
          const firstDeviceInput = markInvalidDevices(devices.invalid);
          const firstPartInput = markInvalidParts(parts.invalid);
          const focusTarget = errors[0].name === "parts" ? firstPartInput : errors[0].name === "devices" ? firstDeviceInput : firstTarget;
          focusTarget?.focus?.();
          return;
        }
        stepsApi.clearFieldErrors(form);
        const spec = model.ACTION_BUTTONS.complete;
        if (!(await confirmDialog({ title: spec.confirmTitle, message: spec.confirmMessage, confirmLabel: spec.confirmLabel }))) return;
        busy = true;
        setFormBusy(form, true);
        try {
          await rpc(spec.rpc, model.completeParams(detail.id, current, parts.rows, devices.rows));
        } catch (error) {
          showError(escapeHtml(failure(error, { write: true }).message));
          busy = false;
          setFormBusy(form, false);
          return;
        }
        // IT ส่งงาน = งานกลับไปหาผู้แจ้ง: บอกชื่อผู้แจ้ง (โหมดทดสอบบอกให้สลับบัญชีไปยืนยัน/ขอแก้ไข)
        showToast(model.completeToast(detail, Boolean(detail.is_test || role.is_test)));
        await renderRoute();
      });
    }

    // ---- ฟอร์มขอแก้ไขงาน (ผู้แจ้ง ตอน IT ส่งงานแล้ว): ซ่อนไว้จนกดปุ่ม "แก้ไขงาน" ----
    function openRework() {
      const card = document.querySelector("#itrp-rework-card");
      if (!card) return;
      card.hidden = false;
      card.scrollIntoView?.({ block: "start", behavior: "smooth" });
      document.querySelector("#itrp-rework-details")?.focus({ preventScroll: true });
    }
    function bindRework() {
      const card = document.querySelector("#itrp-rework-card");
      const form = document.querySelector("#itrp-rework-form");
      if (!card || !form) return;
      const message = document.querySelector("#itrp-rework-message");
      const detailsInput = document.querySelector("#itrp-rework-details");
      const dueInput = document.querySelector("#itrp-rework-due");
      const filesInput = document.querySelector("#itrp-rework-files");
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
      watchUnsaved(() => (card.isConnected && !card.hidden && !busy && (detailsInput.value.trim() !== "" || chosenFiles().length > 0) ? 1 : 0));

      document.querySelector("#itrp-rework-cancel")?.addEventListener("click", () => { card.hidden = true; message.innerHTML = ""; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        message.innerHTML = "";
        const steps = window.MNP_FORM_STEPS;
        const errors = steps.validate(model.reworkRules(), values());
        if (errors.length) { steps.showFieldErrors(form, errors); return; }
        steps.clearFieldErrors(form);
        const files = chosenFiles(); // อ่านก่อน setFormBusy
        if (files.length && filesInput.validationMessage) { showError(escapeHtml(model.FILES_PREPARING_MESSAGE)); return; } // ฟอร์ม novalidate: ยังแปลงรูปอยู่ (ดูฟอร์มแจ้งซ่อม)
        const fileProblem = model.validateFiles(files);
        if (fileProblem) { showError(escapeHtml(fileProblem)); return; }
        if (!(await confirmDialog({ title: "ส่งใบกลับให้ IT แก้ไขงาน?", message: "ใบจะกลับไปสถานะกำลังดำเนินการทันที ไม่ต้องอนุมัติใหม่ · ระบบบันทึกชื่อ วันที่ และเวลาของคุณไว้ในประวัติเอกสาร แก้ไขย้อนหลังไม่ได้", confirmLabel: "ส่งให้ IT แก้ไข" }))) return;
        const params = model.reworkParams(detail.id, values());
        busy = true;
        setFormBusy(form, true);
        let created;
        try {
          const data = await rpc("app_itrp_request_rework", params);
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
          host: card, version, requestId: detail.id, reworkId: created.id, files, isTest: Boolean(detail.is_test || role.is_test),
          heading: `ส่งใบกลับให้ IT แก้ไขแล้ว · แก้ไขครั้งที่ ${created.round_no}`,
          intro: "คำขอแก้ไขถูกบันทึกแล้ว ระบบกำลังแนบไฟล์ให้ ถ้าไฟล์ไหนแนบไม่สำเร็จลองใหม่ได้ภายใน 30 นาทีหลังขอแก้ไข",
          continueLabel: "กลับไปที่ใบแจ้งซ่อม",
          onContinue: () => renderRoute(),
        });
      });
    }
    // ---- ฟอร์มถามผู้แจ้ง (ผู้อนุมัติ/IT: ซ่อนไว้จนกดปุ่ม "ถามผู้แจ้ง") และฟอร์มตอบ (ผู้แจ้ง: เปิดไว้ในการ์ดคำถาม) ----
    // ลำดับ: บันทึกข้อความ (ได้ comment_id) → อัปโหลดไฟล์ → app_itrp_add_comment_attachment ทีละไฟล์ (ข้อความถูกบันทึกแล้ว ไฟล์ที่ล้มลองซ้ำได้ภายใน 30 นาที)
    function openAsk() {
      const card = document.querySelector("#itrp-ask-card");
      if (!card) return;
      card.hidden = false;
      card.scrollIntoView?.({ block: "start", behavior: "smooth" });
      document.querySelector("#itrp-ask-body")?.focus({ preventScroll: true });
    }
    function bindInfoForm(kind) {
      const card = document.querySelector(`#itrp-${kind}-card`);
      const form = document.querySelector(`#itrp-${kind}-form`);
      if (!card || !form) return;
      const message = document.querySelector(`#itrp-${kind}-message`);
      const bodyInput = document.querySelector(`#itrp-${kind}-body`);
      const filesInput = document.querySelector(`#itrp-${kind}-files`);
      const spec = model.ACTION_BUTTONS[kind === "ask" ? "request_info" : "provide_info"];
      const pending = kind === "answer" ? model.pendingQuestion(detail) : null;
      let busy = false;
      const values = () => ({ body: bodyInput.value });
      const chosenFiles = () => Array.from(filesInput.files ?? []);
      const showError = (html) => {
        message.innerHTML = `<div class="form-message error" role="alert">${html}</div>`;
        message.scrollIntoView?.({ block: "nearest" });
      };
      watchUnsaved(() => (card.isConnected && !card.hidden && !busy && (bodyInput.value.trim() !== "" || chosenFiles().length > 0) ? 1 : 0));

      if (kind === "ask") document.querySelector("#itrp-ask-cancel")?.addEventListener("click", () => { card.hidden = true; message.innerHTML = ""; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        message.innerHTML = "";
        const steps = window.MNP_FORM_STEPS;
        const errors = steps.validate(model.infoRules(kind), values());
        if (errors.length) { steps.showFieldErrors(form, errors); return; }
        steps.clearFieldErrors(form);
        const files = chosenFiles(); // อ่านก่อน setFormBusy
        if (files.length && filesInput.validationMessage) { showError(escapeHtml(model.FILES_PREPARING_MESSAGE)); return; } // ฟอร์ม novalidate: ยังแปลงรูปอยู่ (ดูฟอร์มแจ้งซ่อม)
        const fileProblem = model.validateFiles(files);
        if (fileProblem) { showError(escapeHtml(fileProblem)); return; }
        if (!(await confirmDialog({ title: spec.confirmTitle, message: spec.confirmMessage, confirmLabel: spec.confirmLabel }))) return;
        busy = true;
        setFormBusy(form, true);
        let commentId;
        try {
          const data = await rpc(spec.rpc, model.infoParams(detail.id, values()));
          commentId = (Array.isArray(data) ? data[0] : data)?.comment_id;
          if (commentId === undefined || commentId === null) throw Object.assign(new Error("ไม่ได้รับเลขข้อความจากระบบ"), { code: "" });
        } catch (error) {
          showError(escapeHtml(failure(error, { write: true }).message));
          busy = false;
          setFormBusy(form, false);
          return;
        }
        showToast(kind === "answer" ? model.answerToast(pending?.stage) : spec.done);
        if (!files.length) { await renderRoute(); return; }
        const heading = kind === "answer" ? "ส่งคำตอบแล้ว" : "ส่งคำถามถึงผู้แจ้งแล้ว";
        await attachFiles({
          host: card, version, requestId: detail.id, commentId, files, isTest: Boolean(detail.is_test || role.is_test),
          heading,
          intro: `${kind === "answer" ? "คำตอบ" : "คำถาม"}ถูกบันทึกแล้ว ระบบกำลังแนบไฟล์ให้ ถ้าไฟล์ไหนแนบไม่สำเร็จลองใหม่ได้ภายใน 30 นาทีหลังส่งข้อความ`,
          continueLabel: "กลับไปที่ใบแจ้งซ่อม",
          onContinue: () => renderRoute(),
        });
      });
    }
    draw();
  }

  /* ---------- หน้าพิมพ์ A4 ---------- */
  async function renderPrint(id, version) {
    if (!model.isUuid(id)) return renderNotFound("ไม่พบรหัสใบแจ้งซ่อม");
    let detail;
    try {
      detail = await loadDetail(id);
    } catch (error) {
      return errorPage(error, version);
    }
    // ชื่อแท็บ = เลขที่ใบ (เป็นชื่อไฟล์เริ่มต้นเมื่อบันทึกเป็น PDF)
    if (!paint(pages.printPage(detail), "พิมพ์ใบแจ้งซ่อม", version, detail.doc_no)) return;
    document.querySelector("#itrp-print-button")?.addEventListener("click", () => window.print());
  }

  /* ---------- ตั้งค่า (it_admin) ---------- */
  // รายชื่อทีม IT อ่านอย่างเดียว (ชุดเดียวกับใบสั่งงาน IT) จึงมีแค่การตั้งเลขที่เอกสารถัดไป
  function bindSettings(counter) {
    const fail = (error) => showToast(failure(error, { write: true }).message, "error");
    // เลขที่เอกสารถัดไป: เดินหน้าอย่างเดียว ยืนยันพร้อมบอกเลขที่จะได้ก่อนบันทึก (ฐานข้อมูลออกเลขจริงเอง)
    const counterForm = document.querySelector("#itrp-counter-form");
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
        await rpc("app_itrp_set_next_doc_seq", { p_next: next, p_year: counter.year });
        showToast(`ตั้งเลขถัดไปเป็น ${docNo} แล้ว`);
        await renderRoute();
      } catch (error) {
        fail(error);
        setFormBusy(counterForm, false);
      }
    });
  }

  // ผู้ใช้ยืนยัน "ออกโดยไม่ส่ง" ไปหน้านอกโมดูลนี้แล้ว หน้านี้ไม่ได้อยู่ในจอ (hash ไม่ตรงหน้าที่วาดล่าสุด) → ตัวตรวจต้องเลิกนับและถูกล้างทิ้ง
  // ไม่อย่างนั้นยังอ่านค่าจากฟอร์มที่ถูกถอดออกจากหน้า และ app.js ถามก่อนออกซ้ำทั้งแอปจนกว่าจะรีโหลด (หน้าอื่นในโมดูลวาดใหม่ผ่าน render() ซึ่งล้างตัวตรวจเอง)
  const unsavedCount = () => {
    if (!unsavedProbe) return 0;
    if (location.hash !== pageHash) {
      unsavedProbe = null;
      return 0;
    }
    return unsavedProbe();
  };
  // inDevelopment = ธง "กำลังพัฒนา" จาก itrp-model.js (การ์ดอ่านค่านี้ไปแสดงป้าย)
  const api = Object.freeze({ render, loadCardSummary, unsavedCount, version: model.MODULE_VERSION, inDevelopment: model.IN_DEVELOPMENT });
  window.MNP_ITRP = api;
  // ประกาศตัวเองให้การ์ดในเมนู "ระบบสำนักงาน" (วิธีเพิ่มโมดูลใหม่ดูที่หัวไฟล์ modules/office-sections.js) key = รหัสโมดูลของการ์ด
  // version = เลขเวอร์ชัน (ป้าย V…) · loadCardSummary() คืน { openCount, badge, title } หรือ null ถ้าอ่านไม่ได้ (การ์ดแสดง "ดูสถานะ")
  (window.MNP_OFFICE_CARDS ??= {}).IT_COMPUTER_REPAIR = api;
})();
