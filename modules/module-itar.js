// ใบขอสิทธิ์ IT (itar · ฟอร์ม IT01-FM08) ของ Pilot Web — หน้าอยู่ใต้ #/office?module=access-request (ระบบสำนักงาน › IT SUPPORT › ใบขอสิทธิ์ IT)
//
//   (ไม่มี view) / view=mine   ใบของฉัน (ใบที่ยื่นเอง + ใบที่ฉันเป็นผู้รับสิทธิ์) + ปุ่ม "ยื่นขอสิทธิ์ใหม่"
//   view=approvals             รออนุมัติ (ผู้อนุมัติขั้นแผนก / ขั้น IT / หัวหน้า IT)      view=it   งาน IT แยกตามสถานะ (ทีม IT)
//   view=settings              ตั้งค่า (it_admin): รายชื่อทีม IT (อ่านอย่างเดียว) + เลขที่เอกสารถัดไป
//   view=new                   ฟอร์มยื่น 2 ช่วง: (1) ประเภท + ผู้รับสิทธิ์ (2) ติ๊กสิทธิ์จากสิทธิ์ปัจจุบัน + เหตุผล + ไฟล์แนบ
//   view=order&id=<uuid>       รายละเอียดใบ + ตาราง ก่อน→หลัง + ไทม์ไลน์ + ถาม-ตอบ + ปุ่มตาม allowed_actions
//   (ส่วน B ยังไม่ทำ) ใบพิมพ์ USER-REQ / USER-Page · หน้าบันทึกลงทะเบียน (apply) · รับทราบสิทธิ์ / รับทราบด้วยกระดาษ
//
// คัดโครงจากใบแจ้งซ่อม IT (module-itrp.js): กติกา flow เหมือนกัน (อนุมัติ 2 ขั้น · ถาม-ตอบ · IT ยกเลิกแทนผู้ยื่น) ที่ต่าง: ไม่มีงานด่วน · ผู้ยื่นกับผู้รับสิทธิ์เป็นคนละคนได้ · IT บันทึกลงทะเบียน แล้วผู้รับสิทธิ์รับทราบ
// ฐานข้อมูล: supabase/migrations/20270107010000_itar_access_requests.sql ทุกอย่างเรียกผ่าน RPC app_itar_* (ตรวจบทบาท ลำดับขั้น เลขที่เอกสารที่ฝั่งฐานข้อมูล) · สัญญา: docs/itar-contract.md
// หน้าเว็บแค่ซ่อน/แสดงแท็บและปุ่มตาม app_itar_my_role กับ allowed_actions เป็น UX ล้วน สิทธิ์จริงตัดสินที่ RPC ทุกตัว
// ข้อมูลล้วนอยู่ที่ itar-model.js · HTML อยู่ที่ itar-pages.js · ไฟล์นี้ดูแลเฉพาะการเรียก RPC กล่องยืนยัน และผูกเหตุการณ์ของหน้า
// module-office.js เรียก MNP_ITAR.render(params) เมื่อเปิด ?module=access-request และ MNP_ITAR.loadCardSummary() เพื่อวาดตัวเลขบนการ์ด
//
// การแจ้งเตือน (อีเมล/Push/กระดิ่ง) ฝั่งฐานข้อมูลส่งให้เอง (trigger บน itar_events) ลิงก์เปิดใบตรง /office/access/<uuid> · โหมดทดสอบ: ข้อมูลแยกจากของจริงที่ฐานข้อมูล (is_test) ใบทดสอบมีป้าย "ทดสอบ"
// หน้าเว็บต้องทนกรณี RPC ยังไม่มี (เจ้าของ merge ก่อน apply migration): ทุกการเรียกอ่านแสดงข้อความไทย "ฐานข้อมูลยังไม่ได้อัปเดต" ไม่ทำให้ทั้งแอปพัง · ไม่มีรหัสผ่านหรือช่องลับใด ๆ ในโมดูลนี้
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound, showToast, friendlyError,
// confirmDialog, textPromptDialog, setFormBusy, setButtonBusy, renderRoute, bindFormCancel) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerItarModule() {
  const model = window.MNP_ITAR_MODEL;
  const pages = window.MNP_ITAR_PAGES;
  if (!model || !pages) return;

  const PATH = "office"; // หน้าของโมดูลนี้ใช้เส้นทางของระบบสำนักงาน (เมนูข้างไฮไลต์ "ระบบสำนักงาน")
  const TITLE = "ใบขอสิทธิ์ IT";
  const PURGE_TEXT = "ล้างข้อมูลใบขอสิทธิ์ทดสอบ";
  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ
  let pageHash = ""; // location.hash ตอนเริ่มวาดหน้าล่าสุด: ผู้ใช้ออกไปหน้าอื่นระหว่างรอข้อมูล หน้านี้ต้องไม่วาดทับหน้านั้น
  let unsavedProbe = null; // นับสิ่งที่กรอกค้างยังไม่ส่งของหน้าที่วาดอยู่ (app.js เรียกผ่าน MNP_ITAR.unsavedCount ก่อนออกจากหน้า)
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
    document.querySelector("#itar-retry")?.addEventListener("click", () => renderRoute());
  }

  /* ---------- ตัวเลขบนการ์ด (IT SUPPORT) ---------- */
  // ป้ายหลัก openCount = ใบที่ผู้ใช้เห็นและยังไม่จบ (รวมใบของฉัน + รออนุมัติ + งาน IT ตามสิทธิ์ แบบไม่นับซ้ำ) · อ่านแหล่งใดแหล่งหนึ่งไม่ได้ = null (การ์ดแสดง "ดูสถานะ")
  // ป้ายรอง (badge "N รอคุณ") นับงานที่รอ "ฉัน": รออนุมัติ + งาน IT ที่ต้องลงมือ + ใบที่รอฉันรับทราบสิทธิ์ + ใบที่รอฉันตอบคำถาม · อ่านส่วนไหนไม่ได้ส่วนนั้นไม่นับ
  // ฐานข้อมูลยังไม่มีฟังก์ชัน (ยังไม่ apply) = role อ่านไม่ได้ = null ทั้งก้อน การ์ดยังกดเข้าได้
  async function loadCardSummary() {
    let role;
    try {
      role = await rpc("app_itar_my_role");
    } catch {
      return null;
    }
    const hasApprovals = model.canApprove(role);
    const hasIt = model.canSeeAllOrders(role);
    const [approvals, approvalRows, itRows, mine] = await Promise.all([
      hasApprovals ? attempt(rpc("app_itar_pending_count")) : null,
      hasApprovals ? attempt(rpc("app_itar_list_pending_approvals")) : null,
      hasIt ? attempt(rpc("app_itar_list_it")) : null,
      attempt(rpc("app_itar_list_mine")),
    ]);
    // แหล่งที่ผู้ใช้มีสิทธิ์ดูต้องอ่านได้ครบจึงจะนับ (ไม่งั้นเลขขาดและทำให้เข้าใจผิด)
    const countable = Boolean(mine && (!hasApprovals || approvalRows) && (!hasIt || itRows));
    return model.cardSummary({
      openCount: countable ? model.openOrderCount(mine.value, hasApprovals ? approvalRows.value : [], hasIt ? itRows.value : []) : null,
      approvals: approvals ? approvals.value : null,
      // ตัวเลข "งาน IT ค้าง" นับให้เฉพาะผู้ดูแลงาน IT (ผู้ลงมือทำ) · ผู้อนุมัติขั้น IT/หัวหน้า IT ที่ไม่ใช่ผู้ดูแลงานเห็นรายการได้แต่ไม่มีงานให้ลงมือ
      itWork: itRows && role?.is_it_admin ? model.itActionableCount(itRows.value) : null,
      toAck: mine ? model.awaitingMyAckCount(mine.value) : null,
      toAnswer: mine ? model.awaitingMyAnswerCount(mine.value) : null,
    });
  }

  /* ---------- เส้นทาง ---------- */
  async function render(params) {
    pageVersion += 1;
    const version = pageVersion;
    pageHash = location.hash;
    unsavedProbe = null; // หน้าใหม่ = ของค้างของหน้าเก่าไม่เกี่ยวแล้ว (หน้ารายละเอียด/ฟอร์มตั้งใหม่เองเมื่อวาด)
    const view = model.readView(params);
    if (!view) return renderNotFound();
    loadingShell(PATH, TITLE);
    let role;
    try {
      role = await rpc("app_itar_my_role");
    } catch (error) {
      return errorPage(error, version);
    }
    // แท็บที่ไม่มีสิทธิ์เห็น (พิมพ์ URL เอง) พากลับ "ใบของฉัน" ก่อนเรียกข้อมูลใด ๆ
    if (!model.viewAllowed(view, role)) {
      navigate(model.accessUrl("mine"));
      return;
    }
    try {
      if (view === "new") return await renderNew(role, version);
      if (view === "order") return await renderOrder(params.get("id"), role, version);
      return await renderTab(view, role, version);
    } catch (error) {
      return errorPage(error, version);
    }
  }

  /* ---------- แท็บ: ใบของฉัน / รออนุมัติ / งาน IT / ตั้งค่า ---------- */
  async function renderTab(view, role, version) {
    const hasApprovals = model.canApprove(role);
    const hasIt = model.canSeeAllOrders(role);
    const mainCall = {
      mine: () => rpc("app_itar_list_mine"),
      approvals: () => rpc("app_itar_list_pending_approvals"),
      it: () => rpc("app_itar_list_it"),
      settings: () => Promise.all([rpc("app_itar_list_staff"), rpc("app_itar_get_doc_counter")]),
    }[view];
    // ตัวเลขบนแท็บอื่นอ่านขนานไปด้วย ไม่รอและไม่ทำให้หน้าล้ม
    const [main, approvalsCount, itRows, mineRows] = await Promise.all([
      mainCall(),
      hasApprovals && view !== "approvals" ? attempt(rpc("app_itar_pending_count")) : null,
      hasIt && view !== "it" ? attempt(rpc("app_itar_list_it")) : null,
      view !== "mine" ? attempt(rpc("app_itar_list_mine")) : null,
    ]);
    // ใบที่รอ "ฉัน" รับทราบสิทธิ์ + ใบที่รอฉันตอบคำถาม · แสดงบนแท็บ "ใบของฉัน" ทุกหน้า
    const mineParts = view === "mine" ? model.mineWaiting(main) : mineRows ? model.mineWaiting(mineRows.value) : null;
    const counts = {
      mine: mineParts ? mineParts.total : undefined,
      mineParts: mineParts ?? undefined,
      // แท็บรออนุมัติ: ใบที่ถามผู้ยื่นไปแล้ว (need_info) แสดงในรายการแต่ไม่ใช่ "รอคุณ" จึงไม่นับ (app_itar_pending_count ก็ไม่นับ)
      approvals: view === "approvals" ? model.waitingForMeCount(main) : approvalsCount?.value,
      // แท็บ "งาน IT" ของคนที่ไม่ใช่ผู้ดูแลงานเป็นแบบดูอย่างเดียว จึงไม่แสดงตัวเลขงานค้าง
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

  // ล้างข้อมูลใบขอสิทธิ์ทดสอบ: เฉพาะ admin ที่อยู่ในโหมดทดสอบ (ฐานข้อมูลตรวจซ้ำ) ลบเฉพาะแถวทดสอบ + ไฟล์ทดสอบ แล้วเริ่มนับเลข TEST- ใหม่
  // ไม่แตะทะเบียนสิทธิ์ (itua_*) ซึ่งล้างแยกที่ฝั่งทะเบียน
  function bindPurge() {
    document.querySelector("#itar-purge")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!(await confirmDialog({ title: `${PURGE_TEXT}?`, message: "ล้างเฉพาะใบขอสิทธิ์ทดสอบพร้อมประวัติ ถาม-ตอบ และไฟล์แนบ แล้วเริ่มนับเลข TEST- ใหม่ ข้อมูลจริงและทะเบียนสิทธิ์ไม่ถูกแตะ", confirmLabel: PURGE_TEXT, danger: true }))) return;
      setButtonBusy(button, true);
      try {
        const data = await rpc("app_sandbox_purge_itar");
        // ฐานข้อมูลลบแถวแล้ว แต่ไฟล์ใน Storage ลบด้วย SQL ไม่ได้ จึงได้รายการ path (files) มาให้หน้าเว็บลบผ่าน Storage API ต่อ
        const files = Array.isArray(data?.files) ? data.files : [];
        const removed = await removeTestFiles(files);
        const summary = model.purgeSummary({ deleted: data?.deleted ?? 0, total: files.length, removed });
        showToast(summary.message, summary.complete ? "success" : "error");
        if (!summary.complete) { setButtonBusy(button, false); return; } // ลบไฟล์ไม่ครบ: อยู่หน้าเดิมให้กดซ้ำ
        if (location.hash === model.accessUrl("mine")) await renderRoute();
        else navigate(model.accessUrl("mine"));
      } catch (error) {
        setButtonBusy(button, false);
        showToast(failure(error, { write: true }).message, "error");
      }
    });
  }

  /* ---------- อัปโหลดไฟล์แนบ (ใช้ทั้งตอนยื่นและถาม-ตอบ) ---------- */
  // ลำดับ: ใบ/ข้อความถาม-ตอบถูกสร้างก่อน → อัปโหลดขึ้น Storage ทีละไฟล์ → app_itar_add_attachment (ไฟล์ของข้อความ: app_itar_add_comment_attachment) ลงทะเบียนทีละไฟล์
  // ใบถูกบันทึกแล้ว ไฟล์เป็นส่วนเสริม: ไฟล์ที่ล้มไม่ทำให้ใบหาย ลองซ้ำได้จากแผงความคืบหน้า (ตัวไฟล์อยู่ในหน่วยความจำของหน้านี้ ลองซ้ำได้จนกว่าจะออกจากหน้า
  // และต้องอยู่ในหน้าต่างแนบ 30 นาทีที่ฐานข้อมูลกำหนด) · ลองซ้ำใช้ path เดิม ไม่เกิดไฟล์ซ้ำ และข้ามขั้นที่สำเร็จแล้ว
  // host = element ที่แผงวาดทับ · version = รุ่นหน้า: ผู้ใช้ออกไปหน้าอื่นระหว่างอัปโหลด งานเดินต่อเงียบ ๆ แต่ไม่วาดทับหน้าอื่น · commentId = id ข้อความถาม/ตอบ (ไม่ส่ง = ไฟล์ของใบ)
  async function attachFiles({ host, version, requestId, commentId = null, files, isTest, heading, intro, continueLabel = "ไปที่ใบขอสิทธิ์", onContinue }) {
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
        // เป็น application/vnd.ms-excel, docx บางเครื่องว่าง) ซึ่งไม่ตรงนามสกุล ฐานข้อมูลจะปฏิเสธ · จึงห่อเป็น File ใหม่ที่ type ตามนามสกุลก่อนส่ง (ตรงกับ private.itar_ext_matches_mime)
        upload: async (entry) => {
          const typed = new File([entry.file], entry.file.name, { type: model.fileMime(entry.file) });
          const { error } = await bucket.upload(entry.path, typed, { upsert: false });
          if (error) throw error;
        },
        register: (entry) => (commentId !== null
          ? rpc("app_itar_add_comment_attachment", {
            p_request_id: requestId, p_comment_id: commentId, p_storage_path: entry.path,
            p_file_name: entry.file.name.slice(-200), p_mime_type: model.fileMime(entry.file), p_size_bytes: entry.file.size,
          })
          : rpc("app_itar_add_attachment", {
            p_request_id: requestId, p_storage_path: entry.path,
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
      document.querySelector("#itar-upload-retry")?.addEventListener("click", () => run());
      document.querySelector("#itar-upload-continue")?.addEventListener("click", () => leave());
    }
    await run();
  }

  /* ---------- ยื่นขอสิทธิ์ใหม่ (2 ช่วง) ---------- */
  // ช่วงที่ 1 เลือกประเภท + ผู้รับสิทธิ์ → โหลด app_itar_form_context (ได้สิทธิ์ปัจจุบัน + แคตตาล็อก + นโยบาย) → ช่วงที่ 2 ติ๊กสิทธิ์ เหตุผล ไฟล์ → app_itar_create
  // สถานะของหน้าอยู่ในตัวแปรของ renderNew (ไม่มีร่างบนเครื่อง: ฟอร์มนี้ยาว แต่สิทธิ์ปัจจุบันเปลี่ยนได้ ร่างเก่าจะไม่ตรงกับทะเบียน) · ออกจากหน้าตอนกรอกค้างจะมีกล่องถามก่อนเสมอ
  async function renderNew(role, version) {
    const ui = {
      values: { type: "", mode: "self", pick: null, search: "", name_th: "", name_en: "", department_id: "", division: "" },
      search: { state: "idle", results: [], searched: false, message: "" },
      departments: [],
      ctx: null,
      choices: null,
      reason: "",
      submitted: false,
    };
    const requesterHead = () => pages.head({ title: "ยื่นขอสิทธิ์ใหม่", back: { href: model.accessUrl("mine"), label: "‹ ใบขอสิทธิ์" }, isTest: Boolean(role.is_test) });
    const drawPage = (inner) => paint(pages.page(`${requesterHead()}${inner}`), "ยื่นขอสิทธิ์ใหม่", version);
    const showMessage = (html) => {
      const box = document.querySelector("#itar-message");
      if (!box) return;
      box.innerHTML = html ? `<div class="form-message error" role="alert">${html}</div>` : "";
      if (html) box.scrollIntoView?.({ block: "nearest" });
    };
    const stillHere = () => version === pageVersion && location.hash === pageHash;

    /* ---- ช่วงที่ 1 ---- */
    function drawChooser() {
      unsavedProbe = null;
      if (!drawPage(pages.chooserForm({ role, values: ui.values, search: ui.search, departments: ui.departments }))) return;
      bindChooser();
    }
    function redrawSubject() {
      const box = document.querySelector("#itar-subject-body");
      if (box) box.innerHTML = pages.subjectBody({ role, values: ui.values, search: ui.search, departments: ui.departments });
      const modeBox = document.querySelector("#itar-mode-box");
      if (modeBox) modeBox.innerHTML = pages.modeBox({ role, values: ui.values });
    }
    // รายชื่อแผนกให้เลือก (ใช้เมื่อ IT กรอกผู้รับสิทธิ์ที่ไม่มีบัญชีเอง) · อ่านตารางแผนกที่ทุกคนอ่านได้ · ล้มก็แสดงข้อความ ฟอร์มส่วนอื่นยังใช้ได้
    async function ensureDepartments() {
      if (ui.departments.length) return;
      try {
        const { data, error } = await sb.from("departments").select("id,code,name_th").eq("is_active", true).order("code");
        if (error) throw error;
        ui.departments = data ?? [];
      } catch (error) {
        console.error(error);
        showMessage(escapeHtml("โหลดรายชื่อแผนกไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วเลือกโหมดผู้รับสิทธิ์อีกครั้ง"));
      }
      if (stillHere()) redrawSubject();
    }
    async function runSearch() {
      const input = document.querySelector("#itar-search");
      const text = String(input?.value ?? "").trim();
      ui.values.search = text;
      if (Array.from(text).length < 2) {
        ui.search = { state: "error", results: [], searched: false, message: "พิมพ์อย่างน้อย 2 ตัวอักษรก่อนค้นหา" };
        redrawSubject();
        return;
      }
      ui.search = { state: "loading", results: [], searched: false, message: "" };
      redrawSubject();
      try {
        const data = await rpc("app_itar_search_subjects", { p_search: text });
        if (!stillHere()) return;
        ui.search = { state: "idle", results: model.searchChoices(data), searched: true, message: "" };
      } catch (error) {
        if (!stillHere()) return;
        const info = failure(error);
        ui.search = { state: "error", results: [], searched: false, message: info.kind === "unknown" ? "" : info.message };
      }
      redrawSubject();
      document.querySelector("#itar-search")?.focus({ preventScroll: true });
    }
    function bindChooser() {
      const form = document.querySelector("#itar-chooser");
      if (!form) return;
      const steps = window.MNP_FORM_STEPS;
      form.addEventListener("change", (event) => {
        const target = event.target;
        if (target?.name === "request_type") {
          ui.values.type = target.value;
          // โหมดที่ประเภทใหม่ไม่รองรับ (เช่น กรอกเอง + ยกเลิกทั้งหมด) กลับเป็นตัวเอง
          if (!model.subjectModeAllowed(role, ui.values.type, ui.values.mode)) { ui.values.mode = "self"; ui.values.pick = null; }
          redrawSubject();
          return;
        }
        if (target?.name === "subject_mode") {
          ui.values.mode = target.value;
          ui.values.pick = null;
          ui.search = { state: "idle", results: [], searched: false, message: "" };
          redrawSubject();
          if (ui.values.mode === "manual") ensureDepartments();
          return;
        }
        if (target?.name === "department_id") ui.values.department_id = target.value;
        if (target?.name === "division") ui.values.division = target.value;
      });
      form.addEventListener("input", (event) => {
        const target = event.target;
        if (target?.name === "name_th") ui.values.name_th = target.value;
        else if (target?.name === "name_en") ui.values.name_en = target.value;
        else if (target?.name === "search") ui.values.search = target.value;
        if (target?.closest?.("[data-field]")) steps.clearFieldError(form, target.closest("[data-field]").dataset.field);
      });
      form.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.target?.id === "itar-search") { event.preventDefault(); runSearch(); }
      });
      form.addEventListener("click", (event) => {
        const target = event.target;
        if (target?.closest?.("#itar-search-go")) { event.preventDefault?.(); runSearch(); return; }
        const pick = target?.closest?.("[data-pick]");
        if (pick) {
          const chosen = ui.search.results.find((item) => item.key === pick.dataset.pick);
          if (chosen) { ui.values.pick = chosen; ui.search = { ...ui.search, results: [] }; redrawSubject(); }
          return;
        }
        if (target?.closest?.("#itar-pick-clear")) { ui.values.pick = null; redrawSubject(); }
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        showMessage("");
        const problem = model.subjectProblem(ui.values, role);
        if (problem) { showMessage(escapeHtml(problem)); return; }
        setFormBusy(form, true);
        try {
          const data = await rpc("app_itar_form_context", { p_request_type: ui.values.type, p_subject: model.subjectParams(ui.values, role) });
          if (!stillHere()) return;
          ui.ctx = model.normalizeContext(data);
          ui.choices = model.initialChoices(ui.ctx);
          ui.reason = "";
          drawRights();
        } catch (error) {
          setFormBusy(form, false);
          showMessage(escapeHtml(failure(error).message));
        }
      });
    }

    /* ---- ช่วงที่ 2 ---- */
    const changedCount = () => (ui.ctx ? model.buildItems(ui.ctx, ui.choices).items.length : 0);
    function drawRights(notice = "") {
      if (!drawPage(pages.rightsForm({ ctx: ui.ctx, choices: ui.choices, reasonText: ui.reason }))) return;
      bindRights();
      if (notice) showMessage(escapeHtml(notice));
    }
    function bindRights() {
      const form = document.querySelector("#itar-form");
      if (!form) return;
      const steps = window.MNP_FORM_STEPS;
      const ctx = ui.ctx;
      const filesInput = form.querySelector("#itar-files");
      const chosenFiles = () => Array.from(filesInput.files ?? []);
      const kinds = model.emailKindOptions(ctx);
      let submitting = false;
      const refreshPreview = () => {
        const box = form.querySelector("#itar-preview");
        if (!box) return;
        box.innerHTML = pages.previewTable(model.previewRows(ctx, model.buildItems(ctx, ui.choices).items));
      };
      // ช่องหมายเหตุ (เหตุผลขออินเทอร์เน็ต / ชื่อโปรแกรมอื่นๆ) โผล่เมื่อเลือก "ขอใช้" ที่ต่างจากค่าเดิม
      const syncNotes = () => {
        const internet = model.internetRow(ctx);
        const internetOn = ui.choices.internet === "yes" && ui.choices.internet !== internet.initial;
        const internetNote = form.querySelector('[data-note-for="internet"]');
        if (internetNote) { internetNote.hidden = !internetOn; if (!internetOn) steps.clearFieldError(form, "internet_note"); }
        for (const row of model.programRows(ctx)) {
          const field = form.querySelector(`[data-note-for="program:${row.code}"]`);
          if (!field) continue;
          const on = ui.choices.programs[row.code] === "yes" && ui.choices.programs[row.code] !== row.initial;
          field.hidden = !on;
          if (!on) steps.clearFieldError(form, "program_note");
        }
      };
      const markChanged = (select) => select.closest(".itar-right-row")?.classList.toggle("is-changed", select.value !== select.dataset.initial);
      const redrawEmails = (focusIndex = null) => {
        form.querySelector("#itar-email-adds").innerHTML = pages.emailAddRows(ui.choices.emailAdds, kinds);
        if (focusIndex !== null) form.querySelectorAll('[name="email_address"]')[focusIndex]?.focus();
      };
      form.addEventListener("change", (event) => {
        const target = event.target;
        if (target?.dataset?.folder !== undefined) ui.choices.folders[target.dataset.folder] = target.value;
        else if (target?.dataset?.internet !== undefined) ui.choices.internet = target.value;
        else if (target?.dataset?.program !== undefined) ui.choices.programs[target.dataset.program] = target.value;
        else if (target?.name === "email_close") ui.choices.emailCloses = [...form.querySelectorAll('[name="email_close"]:checked')].map((box) => box.value);
        else if (target?.name === "email_kind") { const index = Number(target.closest("[data-email-row]")?.dataset.emailRow); if (ui.choices.emailAdds[index]) ui.choices.emailAdds[index].kind = target.value; }
        else return;
        if (target.matches?.("select.itar-right-select")) markChanged(target);
        steps.clearFieldError(form, "items");
        syncNotes();
        refreshPreview();
      });
      form.addEventListener("input", (event) => {
        const target = event.target;
        if (target?.name === "reason") ui.reason = target.value;
        else if (target?.name === "internet_note") ui.choices.internetNote = target.value;
        else if (target?.dataset?.programNote !== undefined) ui.choices.programNotes[target.dataset.programNote] = target.value;
        else if (target?.name === "email_address") { const index = Number(target.closest("[data-email-row]")?.dataset.emailRow); if (ui.choices.emailAdds[index]) ui.choices.emailAdds[index].address = target.value; refreshPreview(); }
        const field = target?.closest?.("[data-field]");
        if (field) steps.clearFieldError(form, field.dataset.field);
      });
      form.addEventListener("click", async (event) => {
        const target = event.target;
        if (target?.closest?.("#itar-email-add")) {
          if (ui.choices.emailAdds.length >= 10) return;
          ui.choices.emailAdds.push({ address: "", kind: kinds[0]?.value ?? "extra" });
          redrawEmails(ui.choices.emailAdds.length - 1);
          return;
        }
        const remove = target?.closest?.("[data-email-remove]");
        if (remove) { ui.choices.emailAdds.splice(Number(remove.dataset.emailRemove), 1); redrawEmails(); refreshPreview(); return; }
        if (target?.closest?.("#itar-change-subject")) {
          const dirty = changedCount() > 0 || ui.reason.trim() !== "" || chosenFiles().length > 0;
          if (dirty && !(await confirmDialog({ title: "เปลี่ยนประเภท/ผู้รับสิทธิ์?", message: "สิทธิ์ที่เลือกไว้ในหน้านี้จะหายไป (ต้องเลือกใหม่ตามสิทธิ์ปัจจุบันของผู้รับสิทธิ์คนใหม่)", confirmLabel: "เปลี่ยน", danger: true }))) return;
          ui.ctx = null; ui.choices = null; ui.reason = "";
          drawChooser();
        }
      });
      syncNotes();
      refreshPreview();
      // ฟอร์มที่เลือก/พิมพ์ค้างอยู่ = มีของค้างที่ยังไม่ส่ง · ส่งแล้วหรือกำลังส่งไม่นับ
      const dirty = () => !ui.submitted && !submitting && (changedCount() > 0 || ui.reason.trim() !== "" || chosenFiles().length > 0);
      unsavedProbe = () => (dirty() ? 1 : 0);
      bindFormCancel(form, { title: "ทิ้งใบขอสิทธิ์ที่กรอกไว้?", isDirty: dirty, onDiscard: () => { ui.submitted = true; unsavedProbe = null; } });

      const showFormError = (html) => showMessage(html);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitting) return;
        showMessage("");
        steps.clearFieldErrors(form);
        const errors = steps.validate(model.requestRules(), { reason: ui.reason });
        const built = model.buildItems(ctx, ui.choices);
        // ลำดับข้อความผิดตามลำดับบนจอ: สิทธิ์ที่เลือก ก่อน เหตุผลรวม
        const problems = built.problems.map((problem) => ({ name: problem.name, message: problem.message }));
        const all = [...problems, ...errors];
        if (all.length) {
          const first = steps.showFieldErrors(form, all);
          first?.focus?.();
          if (!first) showFormError(escapeHtml(all[0].message));
          return;
        }
        const files = chosenFiles(); // อ่านก่อน setFormBusy (ช่องที่ถูก disable จะไม่ถูกอ่านค่า)
        // ฟอร์มเป็น novalidate: ระหว่างแปลงรูป (เช่น HEIC) attachment-image.js ตั้ง validationMessage ไว้ที่ช่องไฟล์ ส่งตอนนี้จะได้ไฟล์ที่ยังไม่แปลง
        if (files.length && filesInput.validationMessage) { showFormError(escapeHtml(model.FILES_PREPARING_MESSAGE)); return; }
        const fileProblem = model.validateFiles(files);
        if (fileProblem) { showFormError(escapeHtml(fileProblem)); return; }
        const typeLabel = model.requestTypeLabel(ctx.type);
        const summary = ctx.type === "revoke_all" ? model.revokeText(model.rightsSummary(ctx.rights)) : `${built.items.length} รายการ`;
        if (!(await confirmDialog({
          title: `ยื่นใบขอสิทธิ์ (${typeLabel})?`,
          message: `ผู้รับสิทธิ์: ${model.subjectName(ctx.subject)} · ${summary} · ระบบบันทึกชื่อ วันที่ และเวลาของคุณเป็นผู้ยื่น แล้วส่งให้ผู้จัดการแผนกและผู้อนุมัติขั้น IT อนุมัติตามลำดับ`,
          confirmLabel: "ส่งใบขอสิทธิ์",
        }))) return;
        const params = model.createParams({ type: ctx.type, reason: ui.reason, items: built.items, subject: model.subjectParams(ui.values, role) });
        submitting = true;
        setFormBusy(form, true);
        let created;
        try {
          const data = await rpc("app_itar_create", params);
          created = Array.isArray(data) ? data[0] : data;
          if (!created?.id) throw Object.assign(new Error("ไม่ได้รับเลขที่เอกสารจากระบบ"), { code: "" });
        } catch (error) {
          submitting = false;
          // สิทธิ์ปัจจุบันถูกแก้ไปแล้วระหว่างกรอก (40001): โหลดบริบทล่าสุดให้ เก็บสิ่งที่ผู้ใช้ตั้งใจเปลี่ยนไว้ แล้วให้ตรวจและส่งอีกครั้ง
          if (model.isStaleRights(error)) {
            const info = failure(error, { write: true });
            try {
              const fresh = model.normalizeContext(await rpc("app_itar_form_context", { p_request_type: ui.values.type, p_subject: model.subjectParams(ui.values, role) }));
              if (!stillHere()) return;
              ui.choices = model.carryChoices(ui.ctx, ui.choices, fresh);
              ui.ctx = fresh;
              drawRights(info.message);
              return;
            } catch (reloadError) {
              console.error(reloadError);
            }
          }
          const info = failure(error, { write: true });
          // ผลไม่แน่ชัด: ใบอาจถูกสร้างไปแล้ว ชวนไปตรวจที่ "ใบของฉัน" ก่อนกดส่งซ้ำ
          const check = info.kind === "unknown" ? ` <a href="${model.accessUrl("mine")}">ตรวจที่ใบของฉัน</a>` : "";
          showFormError(`${escapeHtml(info.message)}${check}`);
          setFormBusy(form, false);
          form.querySelector("[data-step-submit]")?.focus({ preventScroll: true });
          return;
        }
        // ใบถูกบันทึกแล้ว: ต่อจากนี้ห้ามเปิดฟอร์มให้ส่งซ้ำ (จะได้ใบใหม่ซ้ำ) ไฟล์ที่ล้มลองซ้ำที่แผงความคืบหน้า
        ui.submitted = true;
        unsavedProbe = null;
        showToast(`ยื่นใบขอสิทธิ์แล้ว · เลขที่ ${created.doc_no}`);
        const openOrder = () => navigate(model.accessUrl("order", { id: created.id }));
        if (!files.length) { openOrder(); return; }
        await attachFiles({
          host: document.querySelector("#itar-form-card"), version, requestId: created.id, files, isTest: Boolean(role.is_test),
          heading: `ยื่นใบขอสิทธิ์แล้ว · เลขที่ ${created.doc_no}`,
          intro: "ใบขอสิทธิ์ถูกบันทึกแล้ว ระบบกำลังแนบไฟล์ให้ ถ้าไฟล์ไหนแนบไม่สำเร็จลองใหม่ได้ภายใน 30 นาทีหลังยื่น",
          onContinue: openOrder,
        });
      });
    }
    drawChooser();
  }

  /* ---------- รายละเอียดใบ ---------- */
  // ปุ่มกลับ: มาจากรออนุมัติ/งาน IT กลับไปที่นั่น ไม่งั้นกลับ "ใบของฉัน"
  function backTarget() {
    const from = typeof previousPageHash === "string" ? previousPageHash : "";
    if (/^#\/office\?module=access-request&view=approvals$/.test(from)) return { href: from, label: "‹ รออนุมัติ" };
    if (/^#\/office\?module=access-request&view=it$/.test(from)) return { href: from, label: "‹ งาน IT" };
    return { href: model.accessUrl("mine"), label: "‹ ใบขอสิทธิ์" };
  }

  // ไฟล์แนบของใบ (ตอนยื่น ไฟล์ของข้อความถาม-ตอบ รูปใบรับทราบกระดาษ) ในกล่องดูไฟล์เดิมของ app.js: ขอ signed URL แล้วเติมตัวอย่าง/ลิงก์ดาวน์โหลด · บัคเก็ตตามโหมดของใบ (ฐานข้อมูลส่งชื่อมากับแต่ละไฟล์)
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
    if (!model.isUuid(id)) return renderNotFound("ไม่พบรหัสใบขอสิทธิ์");
    let detail;
    try {
      detail = await rpc("app_itar_get_detail", { p_request_id: id });
    } catch (error) {
      // ไม่มีสิทธิ์/ไม่พบใบ: ฐานข้อมูลตอบข้อความเดียวกันทั้งสองกรณี (ไม่บอกว่าใบมีอยู่หรือไม่)
      return errorPage(error, version);
    }
    const back = backTarget();
    const draw = () => {
      const html = pages.detailPage(detail, { back });
      if (!paint(html, TITLE, version, detail.doc_no)) return false;
      bindActions();
      bindInfoForm("ask");
      bindInfoForm("answer");
      hydrateFiles(detail);
      return true;
    };

    // ---- ปุ่มเปลี่ยนสถานะ: ทุกปุ่มมีกล่องยืนยัน · เหตุผล (ไม่อนุมัติ/ยกเลิก) ถามในกล่องเดียวกัน · "ถามผู้ยื่น" เปิดฟอร์มของตัวเอง ----
    async function runAction(button) {
      const action = button.dataset.itarAction;
      const spec = model.ACTION_BUTTONS[action];
      if (!spec) return;
      if (spec.opens === "ask") { openAsk(); return; }
      const args = { p_request_id: detail.id };
      if (spec.reason) {
        // ยกเลิก: IT ยกเลิกแทนผู้ยื่นใช้ข้อความ/ความยาวของตัวเอง · ปุ่มอื่นใช้ค่าเดิม
        const reasonSpec = action === "cancel" ? model.cancelReasonSpec(detail, role) : { ...spec.reason, maxLength: model.MAX_REASON };
        const reason = await textPromptDialog({ title: reasonSpec.title, label: reasonSpec.label, hint: reasonSpec.hint, minLength: 1, maxLength: reasonSpec.maxLength, confirmLabel: reasonSpec.confirmLabel, danger: true });
        if (reason === null) return;
        args.p_reason = reason;
      } else if (!(await confirmDialog({ title: spec.confirmTitle, message: model.confirmMessageFor(action, detail, role), confirmLabel: spec.label, danger: spec.tone === "danger" }))) {
        return;
      }
      const buttons = [...document.querySelectorAll("[data-itar-action]")];
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
      document.querySelectorAll("[data-itar-action]").forEach((button) => button.addEventListener("click", () => runAction(button)));
    }

    // ของค้างที่ยังไม่ส่งของหน้ารายละเอียดนี้ (ฟอร์มถาม / ตอบ) ให้ app.js ถามก่อนออกจากหน้า
    const unsavedProbes = [];
    function watchUnsaved(probe) {
      if (version !== pageVersion) return;
      unsavedProbes.push(probe);
      unsavedProbe = () => (unsavedProbes.some((item) => item()) ? 1 : 0);
    }

    // ---- ฟอร์มถามผู้ยื่น (ผู้อนุมัติ/IT: ซ่อนไว้จนกดปุ่ม "ถามผู้ยื่น") และฟอร์มตอบ (ผู้ยื่น: เปิดไว้ในการ์ดคำถาม) ----
    // ลำดับ: บันทึกข้อความ (ได้ comment_id) → อัปโหลดไฟล์ → app_itar_add_comment_attachment ทีละไฟล์ (ข้อความถูกบันทึกแล้ว ไฟล์ที่ล้มลองซ้ำได้ภายใน 30 นาที)
    function openAsk() {
      const card = document.querySelector("#itar-ask-card");
      if (!card) return;
      card.hidden = false;
      card.scrollIntoView?.({ block: "start", behavior: "smooth" });
      document.querySelector("#itar-ask-body")?.focus({ preventScroll: true });
    }
    function bindInfoForm(kind) {
      const card = document.querySelector(`#itar-${kind}-card`);
      const form = document.querySelector(`#itar-${kind}-form`);
      if (!card || !form) return;
      const message = document.querySelector(`#itar-${kind}-message`);
      const bodyInput = document.querySelector(`#itar-${kind}-body`);
      const filesInput = document.querySelector(`#itar-${kind}-files`);
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

      if (kind === "ask") document.querySelector("#itar-ask-cancel")?.addEventListener("click", () => { card.hidden = true; message.innerHTML = ""; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        message.innerHTML = "";
        const steps = window.MNP_FORM_STEPS;
        const errors = steps.validate(model.infoRules(kind), values());
        if (errors.length) { steps.showFieldErrors(form, errors); return; }
        steps.clearFieldErrors(form);
        const files = chosenFiles(); // อ่านก่อน setFormBusy
        if (files.length && filesInput.validationMessage) { showError(escapeHtml(model.FILES_PREPARING_MESSAGE)); return; } // ฟอร์ม novalidate: ยังแปลงรูปอยู่
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
        await attachFiles({
          host: card, version, requestId: detail.id, commentId, files, isTest: Boolean(detail.is_test || role.is_test),
          heading: kind === "answer" ? "ส่งคำตอบแล้ว" : "ส่งคำถามถึงผู้ยื่นแล้ว",
          intro: `${kind === "answer" ? "คำตอบ" : "คำถาม"}ถูกบันทึกแล้ว ระบบกำลังแนบไฟล์ให้ ถ้าไฟล์ไหนแนบไม่สำเร็จลองใหม่ได้ภายใน 30 นาทีหลังส่งข้อความ`,
          continueLabel: "กลับไปที่ใบขอสิทธิ์",
          onContinue: () => renderRoute(),
        });
      });
    }
    draw();
  }

  /* ---------- ตั้งค่า (it_admin) ---------- */
  // รายชื่อทีม IT อ่านอย่างเดียว (ชุดเดียวกับใบสั่งงาน IT) จึงมีแค่การตั้งเลขที่เอกสารถัดไป
  function bindSettings(counter) {
    const fail = (error) => showToast(failure(error, { write: true }).message, "error");
    // เลขที่เอกสารถัดไป: เดินหน้าอย่างเดียว ยืนยันพร้อมบอกเลขที่จะได้ก่อนบันทึก (ฐานข้อมูลออกเลขจริงเอง)
    const counterForm = document.querySelector("#itar-counter-form");
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
        await rpc("app_itar_set_next_doc_seq", { p_next: next, p_year: counter.year });
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
  // inDevelopment = ธง "กำลังพัฒนา" จาก itar-model.js (การ์ดอ่านค่านี้ไปแสดงป้าย)
  const api = Object.freeze({ render, loadCardSummary, unsavedCount, version: model.MODULE_VERSION, inDevelopment: model.IN_DEVELOPMENT });
  window.MNP_ITAR = api;
  // ประกาศตัวเองให้การ์ดในเมนู "ระบบสำนักงาน" (วิธีเพิ่มโมดูลใหม่ดูที่หัวไฟล์ modules/office-sections.js) key = รหัสโมดูลของการ์ด
  (window.MNP_OFFICE_CARDS ??= {}).IT_ACCESS_REQUEST = api;
})();
