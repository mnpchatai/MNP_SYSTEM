// RubberFlow MES — โมดูล "แผนก RB" ของ Pilot Web ในโหมดทดสอบ (#/rubberflow?p=<หน้า>) ยกต้นแบบ prototypes/rubber-mes มาทั้งโปรเจค
// (ฟังก์ชันและ UI ทั้ง 15 หน้า) เป็น script ธรรมดา ไม่ใช้ React
//
// โครง: modules/rubberflow-rules.js (สเปก/สูตร) · rubberflow-actions.js (กฎธุรกิจ) · rubberflow-seed.js (ข้อมูลสาธิต) ·
// rubberflow-derive.js (แจ้งเตือน/ค้นหา/สืบย้อน) · rubberflow-store.js (บทบาทสาธิต + localStorage) · rubberflow-ui.js (ชิ้นส่วน HTML) ·
// rubberflow-pages-*.js และ rubberflow-documents.js (หน้าและ dialog ลงทะเบียนใน window.MNP_RUBBERFLOW_PAGES / _DIALOGS) · ไฟล์นี้ (shell เส้นทาง การผูก event)
//
// ในเบราว์เซอร์จริง (มี Supabase) ข้อมูลทั้ง 12 ชุด (วัตถุดิบ สูตรยางทุก revision ใบสั่งผลิต WO ล็อตวัตถุดิบ ใบเบิก ล็อตผลิต ใบส่งมอบ WIP กล่องสินค้า ผลตรวจ QC NCR แม่พิมพ์ ใบสั่งซื้อ)
// อยู่ในฐานข้อมูลผ่าน RPC app_rf_master / app_rf_master_since / app_rf_save (ชนกันรายระเบียน บันทึกคืนส่วนต่าง) บันทึกการใช้งานอ่านจาก app_rf_audit และ admin ล้างข้อมูลทดสอบได้ด้วย
// app_sandbox_purge_rf · ผู้ใช้คือบัญชีทดสอบ (persona) ของ admin ซึ่งบทบาทมาจากตำแหน่ง/แผนกของบัญชีนั้น (storeApi.personaUser) · ไม่มีข้อมูลธุรกิจเหลืออยู่ในเบราว์เซอร์
// ไม่มี Supabase (เทสต์ใน Node) ใช้ชุดสาธิตทั้งชุดใน localStorage และบทบาทสาธิต 9 คนของต้นแบบเหมือนเดิม
// บทบาทใช้ซ่อน/แสดงเมนูและปุ่มเท่านั้น (โหมดฐานข้อมูลซ่อนปุ่มและปิดฟอร์มของคำสั่งที่บัญชีไม่มีสิทธิ์ ดู applyRights) สิทธิ์จริงทุกชุดตัดสินที่ฐานข้อมูล — หน้า #/rubberflow ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
// (เมนูข้างโผล่เฉพาะโหมดทดสอบ nav.sandboxOnly แต่ URL พิมพ์เข้ามาได้)
//
// กติกา event (ทุกหน้าใช้ร่วมกัน ผูกโดย bindRoot):
//   <form data-rf-form="<action>" data-rf-success="ข้อความ {result}" data-rf-args='{...}'>  ส่งแล้วเรียก action ของ store พร้อมค่าจากฟอร์ม
//   <button data-rf-action="<action>" data-rf-args='{...}' data-rf-confirm="คำถาม">        เรียก action ทันที
//   <button data-rf-open="<dialog>" data-rf-args='{...}'>                                  เปิด dialog จาก window.MNP_RUBBERFLOW_DIALOGS
//   [data-spec data-lsl data-usl]                                                            ช่องตัวเลขเปลี่ยนสีตามสเปกขณะพิมพ์
// สำเร็จแล้ววาดหน้าใหม่ทั้งหน้า (renderRoute) dialog ที่เปิดอยู่จึงหายไปพร้อมกัน · ไม่ผ่านแสดง toast และคงฟอร์มไว้
// dialog เป็น <dialog> ของเบราว์เซอร์ (showModal) ปิดด้วย Escape/ปุ่มปิด/แตะฉากหลัง ไม่ปิดจาก blur (แตะบน iPhone ได้) ไม่มี popup ลอยอื่น
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, app, shell, bindShell, loadingShell, renderNotFound,
// escapeHtml, showToast, friendlyError, confirmDialog, renderRoute, currentRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerRubberFlowModule() {
  const PATH = "rubberflow";
  const TITLE = "RubberFlow MES";
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9l5 3V9l5 3V6h6v13H4Z"/><path d="M8 19v-3h3v3M15 19v-3h3v3"/></svg>`;

  const rules = window.MNP_RUBBERFLOW_RULES;
  const derive = window.MNP_RUBBERFLOW_DERIVE;
  const actions = window.MNP_RUBBERFLOW_ACTIONS;
  const seed = window.MNP_RUBBERFLOW_SEED;
  const storeApi = window.MNP_RUBBERFLOW_STORE;
  const ui = window.MNP_RUBBERFLOW_UI;
  const pages = (window.MNP_RUBBERFLOW_PAGES ??= {});
  const dialogs = (window.MNP_RUBBERFLOW_DIALOGS ??= {});

  const storage = (() => {
    try { return window.localStorage; } catch { return null; }
  })();
  // โหมดฐานข้อมูล: มี Supabase (CDN โหลดก่อนไฟล์นี้) · sb สร้างใน app.js หลังไฟล์นี้โหลด จึงอ้างตอนเรียกใช้เท่านั้น (เหมือน state)
  const remote = typeof window.supabase !== "undefined" ? {
    async load() {
      const { data, error } = await sb.rpc("app_rf_master");
      if (error) throw error;
      return data;
    },
    async save(changes, baseVersion, action, audit, epoch) {
      const { data, error } = await sb.rpc("app_rf_save", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null });
      if (error) throw error;
      return data;
    },
    async since(version) {
      const { data, error } = await sb.rpc("app_rf_master_since", { p_version: version });
      if (error) throw error;
      return data;
    },
    async audit(limit) {
      const { data, error } = await sb.rpc("app_rf_audit", { p_limit: limit });
      if (error) throw error;
      return data;
    },
    async purge() {
      const { data, error } = await sb.rpc("app_sandbox_purge_rf");
      if (error) throw error;
      return data;
    },
  } : null;
  // โหมดฐานข้อมูล: "ตอนนี้" ตามนาฬิกาเซิร์ฟเวอร์ (modules/server-clock.js จาก header Date ของคำตอบ Supabase) เพราะเวลาในข้อมูล (readyAt, createdAt)
  // ฐานข้อมูลประทับด้วยนาฬิกาเซิร์ฟเวอร์ ถ้านาฬิกาเครื่องคลาด เช่นช้ากว่า หลัง "ข้ามเวลาบ่ม" หน้าจอจะเห็นว่ายังบ่มอยู่ · โหมดในเครื่องใช้เวลาเครื่อง
  const clockNow = () => (remote && typeof window.MNP_SERVER_CLOCK?.now === "function" ? window.MNP_SERVER_CLOCK.now() : Date.now());
  const store = storeApi.createStore({
    storage, seed: () => seed.buildSeed(Date.now()), actions, remote, now: clockNow,
    persona: () => storeApi.personaUser(state.employee), shouldHold: () => isEditing(),
  });
  // context(params) ให้เทสต์เรียก dialog ด้วย ctx เดียวกับหน้า
  // bomJobOfAction / showBomFeedback: ขั้น "ตกแต่งผ่าน / QA ตัดสินผ่าน → ตามทัน BOM → แจ้งยอดที่งานได้รับ" (ให้เทสต์เรียกตรง)
  window.MNP_RUBBERFLOW = { runAction: (name, payload, successText) => runAction(name, payload, successText), store, PATH, url, context: (params) => makeContext(params), isEditing: () => isEditing(), bomJobOfAction: (name, payload) => bomJobOfAction(name, payload), showBomFeedback: (before) => showBomFeedback(before), checkMaterials: (options) => checkMaterials(options) };

  // โหมดฐานข้อมูล: โหลดเสร็จ/โหลดไม่สำเร็จ/บันทึกไม่สำเร็จ (ย้อนกลับแล้ว) วาดหน้าใหม่ · เริ่ม/เสร็จการบันทึกแค่เปลี่ยนข้อความสถานะ ไม่ทับฟอร์มที่ผู้ใช้กำลังกรอก
  const onRfRoute = () => { try { return currentRoute().path === PATH; } catch { return false; } };
  const syncText = () => (store.status() === "loading" ? "กำลังโหลดข้อมูล…" : store.isSaving() ? "กำลังบันทึก…" : "");
  const updateSync = () => document.querySelectorAll("[data-rf-sync]").forEach((node) => { node.textContent = syncText(); });
  // "กำลังแก้" = dirty: ติดตามจาก event ที่เบราว์เซอร์ส่งจริง (isTrusted) · ล้าง dirty เมื่อวาดหน้าใหม่ (บันทึกสำเร็จ โหลดใหม่ เปลี่ยนหน้า)
  // ระหว่าง dirty/มี dialog store ไม่รวมข้อมูลของผู้อื่นเข้า data และไม่ขยับเวอร์ชันฐาน การบันทึกจึงตรวจชนจากเวอร์ชันที่ฟอร์มวาดมา
  // เฉพาะตอนอยู่ที่หน้า RubberFlow และนับเฉพาะ dialog ของ RubberFlow เอง (data-rf-dialog): dialog ของหน้าอื่น เช่น "สร้าง WO" ของ BOM ไม่ใช่ฟอร์มของโมดูลนี้
  // ถ้านับด้วย store จะไม่ตามทันหลัง RF_STALE ที่เกิดจากเลข WO ซ้ำ ตราบที่ dialog ของ BOM ยังเปิดอยู่
  let dirty = false;
  const isEditing = () => onRfRoute() && (dirty || Boolean(document.querySelectorAll("dialog[data-rf-dialog][open]").length));
  // ช่องค้นหา/สแกน/ตัวเลือกบทบาทสาธิตไม่นับเป็นการแก้ · ปุ่มที่เปิดหน้า/dialog หรือสั่ง action เองไม่ได้แก้ฟอร์ม (dialog นับจากการเปิดอยู่)
  const NOT_EDITING = "[data-rf-search], [data-rf-scan], [data-rf-user], [data-rf-open], [data-rf-go], [data-rf-action], [data-rf-close], [data-rf-retry], [data-rf-reset], [data-rf-purge], [data-rf-audit-reload]";
  function markDirty(event) {
    if (!store.isRemote() || !event?.isTrusted || !onRfRoute()) return;
    const target = event.target;
    if (!target?.closest?.(".content") || target.closest(NOT_EDITING)) return;
    if (event.type === "click") {
      const button = target.closest("button");
      if (!button || button.type === "submit") return;
    }
    dirty = true;
  }
  for (const type of ["input", "change", "click"]) document.addEventListener?.(type, markDirty, true);
  const refreshForOthers = () => {
    if (isEditing()) showToast("มีผู้อื่นอัปเดตข้อมูล RubberFlow ข้อมูลล่าสุดจะแสดงเมื่อเปิดหน้านี้ใหม่");
    else renderRoute();
  };
  store.subscribe((event) => {
    if (!onRfRoute()) return;
    // บันทึกการใช้งานโหลดเสร็จ: วาดใหม่เฉพาะเมื่อผู้ใช้ยังอยู่ที่หน้านั้นและไม่ได้แก้ฟอร์มอื่นค้าง
    if (event.type === "audit") {
      if (currentPage(currentRoute().params) === "audit" && !isEditing()) renderRoute();
      return;
    }
    if (event.type === "purge-failed") { updateSync(); return; }
    if (event.type === "saving") updateSync();
    else if (event.type === "saved") {
      updateSync();
      // ผู้อื่นบันทึกระหว่างนั้น = แจ้งเมื่อกำลังแก้อยู่ · เนื้อหาต่างเพราะฐานข้อมูลประทับเวลา/ผู้บันทึกให้ระเบียนของเราเอง = วาดใหม่เงียบๆ เมื่อไม่ได้แก้อะไรค้าง
      if (event.held) return;
      if (event.others) refreshForOthers();
      else if (event.changed && !isEditing()) renderRoute();
    } else if (event.type === "pending") showToast("มีผู้อื่นบันทึกข้อมูล RubberFlow ไปแล้ว ระบบจะรวมข้อมูลล่าสุดให้เมื่อบันทึกหรือเปิดหน้านี้ใหม่");
    else if (event.type === "synced") refreshForOthers();
    else if (event.type === "reverted" && isEditing()) updateSync(); // ข้อมูลย้อนกลับแล้ว และ runAction แจ้งข้อความไทยของข้อผิดพลาดให้แล้ว
    else if (event.type !== "status") renderRoute();
  });
  // หน้ากลับมาโฟกัสขณะอยู่ที่หน้า RubberFlow: ตามทันการบันทึกของผู้อื่น (มีฟอร์มค้างไม่รวม แค่แจ้ง)
  const catchUpOnFocus = () => {
    if (store.isRemote() && onRfRoute() && !document.hidden) store.catchUp();
  };
  window.addEventListener?.("focus", catchUpOnFocus);
  document.addEventListener?.("visibilitychange", catchUpOnFocus);

  // ---------- URL ----------
  function url(page = "dashboard", extra = {}) {
    const query = new URLSearchParams();
    if (page && page !== "dashboard") query.set("p", page);
    for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
    const text = query.toString();
    return `#/${PATH}${text ? `?${text}` : ""}`;
  }
  const currentPage = (params) => storeApi.findModule(params.get("p") ?? "dashboard")?.id ?? null;

  // ---------- ค่าจากฟอร์ม ----------
  // name → ค่า · name[] → อาร์เรย์ · a.b → ออบเจ็กต์ซ้อน (ค่าทั้งหมดเป็นสตริง action แปลงเลขเอง)
  function formPayload(form) {
    const payload = {};
    for (const [rawKey, value] of new FormData(form).entries()) {
      const isList = rawKey.endsWith("[]");
      const key = isList ? rawKey.slice(0, -2) : rawKey;
      const path = key.split(".");
      let target = payload;
      for (const part of path.slice(0, -1)) target = (target[part] ??= {});
      const last = path.at(-1);
      if (isList) (target[last] ??= []).push(value);
      else target[last] = value;
    }
    return payload;
  }

  const listOf = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
  const itemsOf = (p) => listOf(p.materialCode).map((materialCode, index) => ({ materialCode, phr: listOf(p.phr)[index], stage: listOf(p.stage)[index] }));
  // ฟอร์มสูตรและฟอร์มผสมมีช่อง mixerTemp1 dumpTemp1 mixMin1 / ...2 (ขั้น 1 และขั้น 2) รวมเป็น stages
  const stagesOf = (p) => rules.MIX_STAGES.map((stage) => ({ stage, mixerTemp: p[`mixerTemp${stage}`], dumpTemp: p[`dumpTemp${stage}`], mixMin: p[`mixMin${stage}`] }));
  // ฟอร์มบางอันส่งค่าที่ action ต้องการคนละรูปแบบ (วันที่เป็น ms, รายการวัตถุดิบ, ตัวเลือกใช่/ไม่ใช่)
  const TRANSFORMS = {
    createOrder: (p) => ({ ...p, startDate: rules.fromInputDate(p.startDate), dueDate: rules.fromInputDate(p.dueDate) }),
    receiveMaterial: (p) => ({ ...p, expiry: rules.fromInputDate(p.expiry), coa: p.coa === "yes" }),
    // บรรทัดของซื้อไม่มีช่องวันหมดอายุ (รับเฉพาะปริมาณ)
    receivePurchaseLine: (p) => (p.expiry === undefined ? { ...p } : { ...p, expiry: rules.fromInputDate(p.expiry) }),
    // ฟอร์มสั่งซื้อ: materialCode[] source[] uom[] needKg[] availableKg[] shortageKg[] safetyKg[] qtyKg[] ตามลำดับแถว (เคมีก่อน ของซื้อตาม) → lines · safety = สต็อกขั้นต่ำที่แก้ไว้ต่อวัตถุดิบ (บันทึกเข้าวัตถุดิบ) · จำนวนสั่งที่ว่าง/0 ถูกข้ามใน action
    createPurchaseOrder: (p) => {
      const lines = listOf(p.materialCode).map((materialCode, index) => ({ materialCode, source: listOf(p.source)[index] === "bom" ? "bom" : "rf", uom: listOf(p.uom)[index] || undefined, storedSafetyKg: listOf(p.storedSafetyKg)[index], needKg: listOf(p.needKg)[index], availableKg: listOf(p.availableKg)[index], shortageKg: listOf(p.shortageKg)[index], safetyKg: listOf(p.safetyKg)[index], qtyKg: listOf(p.qtyKg)[index] }));
      return { lines, safety: Object.fromEntries(lines.map((line) => [line.materialCode, line.safetyKg])), sourcePi: p.sourcePi, sourceRequisition: p.sourceRequisition, note: p.note };
    },
    createRecipe: (p) => ({ ...p, items: itemsOf(p), stages: stagesOf(p) }),
    saveRecipe: (p) => ({ ...p, items: itemsOf(p), stages: stagesOf(p) }),
    recordMixing: (p) => ({ ...p, stages: stagesOf(p) }),
    saveMaterial: (p) => ({ ...p, active: p.active !== "0" }),
    shipBoxes: (p) => ({ ids: p.ids ?? [] }),
    createNcr: (p) => ({ ...p, whys: p.whys ?? [] }),
    addQcRecord: (p) => ({ ...p, values: p.values ?? {}, result: p.result || undefined }),
  };

  function runAction(name, payload, successText) {
    const result = store.run(name, payload);
    if (!result.ok) {
      showToast(friendlyError(result.error), "error");
      return false;
    }
    const report = () => {
      if (!store.isPersisted()) showToast("บันทึกในหน่วยความจำได้ แต่เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล (localStorage) รีเฟรชแล้วข้อมูลจะหาย", "error");
      else if (successText) showToast(String(successText).replaceAll("{result}", String(result.result ?? "")));
    };
    if (!result.saving) {
      report();
      return true;
    }
    // โหมดฐานข้อมูล: หน้าแสดงผลทันที (optimistic) แล้วแจ้งผลเมื่อฐานข้อมูลตอบ · ถ้าไม่สำเร็จ store ย้อนกลับและวาดหน้าใหม่ให้เอง
    const sentJob = bomJobOfAction(name, payload); // ก่อนบันทึก: งาน BOM ที่ผูกใบสั่งผลิตของล็อตตกแต่ง และยอดที่งานทำไว้
    result.saving.then((outcome) => {
      if (outcome.ok) {
        report();
        if (sentJob) showBomFeedback(sentJob);
        // ใบสั่งซื้อที่มีบรรทัดของซื้อแก้สต็อกขั้นต่ำ/ยอดคงเหลือฝั่ง BOM ในคำสั่งเดียวกัน: ตามทัน BOM ให้หน้าคลังของซื้อและหน้าต่างสั่งซื้อเห็นค่าล่าสุด
        if (name === "createPurchaseOrder" || name === "receivePurchaseLine") { try { bomStore()?.catchUp?.(); } catch { /* BOM ตามทันเองตอนเปิดหน้า */ } }
        if (name === "createPurchaseOrder") saveUnorderedPartSafety(payload);
      } else if (name === "createPurchaseOrder" && outcome.error?.code === "RF_FORBIDDEN" && !store.user()?.planner && (payload?.lines ?? []).some((line) => line?.source === "bom")) {
        // สมาชิก RB ไม่ได้แก้อะไร แต่ฝ่ายวางแผนเพิ่งเปลี่ยนสต็อกขั้นต่ำของซื้อ (หน้าต่างถือค่าเก่า): ตามทัน BOM แล้วบอกให้เปิดหน้าต่างใหม่ แทนข้อความเรื่องสิทธิ์
        try { bomStore()?.catchUp?.(); } catch { /* BOM ตามทันเองตอนเปิดหน้า */ }
        showToast("สต็อกขั้นต่ำของของซื้อเพิ่งถูกฝ่ายวางแผนเปลี่ยน กรุณาเปิดหน้าต่างสั่งซื้อใหม่แล้วสั่งอีกครั้ง", "error");
      } else showToast(friendlyError(outcome.error), "error");
    });
    return true;
  }

  // สต็อกขั้นต่ำของของซื้อที่แก้ในหน้าต่างสั่งซื้อแต่จำนวนสั่งเป็น 0 (ไม่อยู่ในบรรทัดใบสั่งซื้อ จึงเซิร์ฟเวอร์ไม่บันทึกให้ในคำสั่งเดียว):
  // บันทึกเข้าคลังของซื้อของ BOM ด้วย countPartStock (เฉพาะกลุ่มวางแผน ซึ่งเป็นผู้เดียวที่แก้ช่องนี้ได้) หลังใบสั่งซื้อสำเร็จ · ไม่สำเร็จ = แจ้ง ไม่ย้อนใบสั่งซื้อ
  async function saveUnorderedPartSafety(payload) {
    // ช่องที่ถูกล้างจนว่างไม่นับเป็น 0 (บรรทัดที่สั่งจริงที่ช่องว่างก็ถูกปฏิเสธ ไม่ใช่บันทึกเป็น 0)
    const counts = (payload?.lines ?? []).filter((line) => line?.source === "bom" && !(Number(line.qtyKg) > 0) && String(line.safetyKg ?? "").trim() !== "" && Number(line.safetyKg) >= 0 && Number(line.safetyKg) !== (Number(line.storedSafetyKg) || 0))
      .map((line) => ({ itemCode: line.materialCode, safetyQty: Number(line.safetyKg) }));
    const bom = bomStore();
    if (!counts.length || !bom) return;
    try {
      await bom.catchUp();
      const outcome = bom.run("countPartStock", { counts });
      if (!outcome.ok) throw outcome.error;
      const saved = await outcome.saving;
      if (saved && saved.ok === false) throw saved.error;
      showToast(`บันทึกสต็อกขั้นต่ำของซื้อ ${counts.length} รายการที่ไม่ได้สั่งแล้ว`);
    } catch (error) {
      showToast(`สั่งซื้อแล้ว แต่บันทึกสต็อกขั้นต่ำของของซื้อที่ไม่ได้สั่งไม่สำเร็จ: ${friendlyError(error)}`, "error");
    }
  }

  // ---------- ชิ้นงานผ่านสถานีสุดท้าย → รายงานเข้างาน BOM ----------
  // ฐานข้อมูลส่งยอดดีของล็อตตกแต่งที่ QC ผ่านและนับเข้าใบสั่งผลิต (ตอนบันทึกถ้าผ่านเลย หรือตอน QA ตัดสินเป็น pass) เข้ารายงานของงาน BOM ที่ผูกใบสั่งผลิตนั้นในธุรกรรมเดียวกัน
  // การรับมอบ WIP ระหว่างสถานีไม่แตะงาน BOM · หน้าจอไม่แตะงาน BOM · หลังบันทึกจึงตามทัน BOM แล้วบอกผล
  const bomStore = () => { try { const bom = window.MNP_BOM?.store; return bom?.isRemote?.() ? bom : null; } catch { return null; } };
  function bomJobOfAction(name, payload) {
    if (name !== "recordFinishing" && name !== "addQcRecord") return null;
    const bom = bomStore();
    if (!bom || bom.status() !== "ready" || !store.isRemote()) return null;
    const data = store.data();
    // บันทึกตกแต่ง: เฉพาะผลผ่าน (hold / fail รอ QA) · ผลตรวจ QC: เฉพาะล็อตตกแต่ง (เซิร์ฟเวอร์ป้อนเมื่อ QA ตัดสินเป็น pass ครั้งแรก ที่เหลือยอดไม่เพิ่มจึงไม่แจ้ง)
    let orderId = null;
    if (name === "recordFinishing") {
      if ((payload?.qcResult || "pass") !== "pass") return null;
      orderId = data.transfers.find((row) => row.id === payload?.transferId)?.orderId;
    } else {
      const lot = data.lots.find((row) => row.id === payload?.lotId);
      if (lot?.stage !== "finishing") return null;
      orderId = lot.orderId;
    }
    const jobId = data.orders.find((row) => row.id === orderId)?.sourceJobId;
    const job = jobId ? bom.data().jobs.find((row) => row.id === jobId) : null;
    return job ? { id: job.id, qtyDone: Number(job.qtyDone) || 0 } : null;
  }
  async function showBomFeedback(before) {
    const bom = bomStore();
    if (!bom) return;
    try { await bom.catchUp(); } catch { /* ไม่ได้ตามทัน: BOM จะเห็นยอดเมื่อเปิดหน้า BOM */ }
    const job = bom.data().jobs.find((row) => row.id === before.id);
    if (job && Number(job.qtyDone) > before.qtyDone) showToast(`งาน BOM ${job.id} รับยอดจากการผ่านตกแต่งแล้ว: ทำได้ ${job.qtyDone}/${job.qtyPlanned}${job.status === "done" ? " (งานครบแล้ว)" : ""}`);
  }

  // ---------- สิทธิ์ของปุ่มและฟอร์ม (โหมดฐานข้อมูล) ----------
  // บัญชีที่ไม่มีสิทธิ์ของคำสั่งนั้น: ซ่อนปุ่ม (คำสั่ง/เปิด dialog) และปิดฟอร์มพร้อมบอกครั้งเดียว · เป็นแค่ตัวช่วยไม่ให้กดผิด ฐานข้อมูลตัดสินสิทธิ์จริงอีกครั้งเสมอ
  // คำสั่งที่ไม่อยู่ในตารางสิทธิ์ (storeApi.rightForAction) ไม่ถูกจำกัดที่หน้าจอ · โหมดสาธิตไม่จำกัดสิทธิ์ของปุ่มเหล่านี้
  const NO_RIGHT_NOTE = "บัญชีนี้ดูข้อมูลได้อย่างเดียว ไม่มีสิทธิ์ทำรายการนี้";
  function applyRights(root, ctx) {
    if (!store.isRemote() || !ctx.user) return;
    const lacks = (right) => Boolean(right) && !storeApi.can(ctx.user, right);
    root.querySelectorAll("[data-rf-action]").forEach((button) => { if (lacks(storeApi.rightForAction(button.dataset.rfAction))) button.remove(); });
    root.querySelectorAll("[data-rf-open]").forEach((button) => { if (lacks(storeApi.rightForDialog(button.dataset.rfOpen))) button.remove(); });
    root.querySelectorAll("form[data-rf-form]").forEach((form) => {
      if (!lacks(storeApi.rightForAction(form.dataset.rfForm))) return;
      form.dataset.rfReadonly = "";
      form.querySelectorAll("input, select, textarea, button").forEach((node) => { node.disabled = true; });
      if (form.id) root.querySelectorAll(`button[form="${CSS.escape(form.id)}"]`).forEach((node) => { node.disabled = true; });
      if (!form.closest("dialog")) form.insertAdjacentHTML("beforebegin", `<p class="small muted" role="note">${NO_RIGHT_NOTE}</p>`);
    });
  }

  // ---------- ผูก event ----------
  function parseArgs(node) {
    try { return node.dataset.rfArgs ? JSON.parse(node.dataset.rfArgs) : {}; } catch { return {}; }
  }

  function bindSpecInputs(root) {
    root.querySelectorAll("[data-spec]").forEach((input) => {
      const paint = () => {
        const lsl = input.dataset.lsl === "" ? undefined : Number(input.dataset.lsl);
        const usl = input.dataset.usl === "" ? undefined : Number(input.dataset.usl);
        const filled = input.value !== "";
        const ok = filled && rules.inSpec(input.value, { min: lsl, max: usl });
        input.classList.toggle("rf-ok", filled && ok);
        input.classList.toggle("rf-out", filled && !ok);
      };
      input.addEventListener("input", paint);
      paint();
    });
  }

  function bindRoot(root, ctx) {
    applyRights(root, ctx);
    root.querySelectorAll("form[data-rf-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = form.dataset.rfForm;
      const transform = TRANSFORMS[name] ?? ((payload) => payload);
      let payload;
      try {
        payload = transform({ ...formPayload(form), ...parseArgs(form) });
      } catch (error) {
        showToast(friendlyError(error), "error");
        return;
      }
      if (!runAction(name, payload, form.dataset.rfSuccess)) return;
      // สำเร็จแล้วกันกดซ้ำ: ปิด dialog ที่ฟอร์มอยู่และล็อกปุ่มของฟอร์มทันที (renderRoute ของ app.js รอข้อมูลก่อนวาดใหม่)
      form.closest?.("dialog")?.close?.();
      form.querySelectorAll("button").forEach((node) => { node.disabled = true; });
      if (form.id) document.querySelectorAll(`button[form="${CSS.escape(form.id)}"]`).forEach((node) => { node.disabled = true; }); // ปุ่มส่งที่อยู่นอกฟอร์ม (เช่น ส่งมอบกล่อง)
      renderRoute();
    }));
    root.querySelectorAll("[data-rf-action]").forEach((button) => button.addEventListener("click", async () => {
      if (button.dataset.rfConfirm && !(await confirmDialog(ui.confirmOptions(button)))) return;
      if (!runAction(button.dataset.rfAction, parseArgs(button), button.dataset.rfSuccess)) return;
      button.disabled = true;
      renderRoute();
    }));
    root.querySelectorAll("[data-rf-open]").forEach((button) => button.addEventListener("click", () => openDialog(button.dataset.rfOpen, parseArgs(button), ctx)));
    root.querySelectorAll("[data-rf-go]").forEach((button) => button.addEventListener("click", () => { location.hash = button.dataset.rfGo; }));
    // ฟอร์มค้นหาในหน้า: ส่งแล้วใส่ q= ลง URL ของหน้าเดิม (คงแท็บ/รายการที่เลือกไว้)
    root.querySelectorAll("form[data-rf-search]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = String(new FormData(form).get("q") ?? "").trim().slice(0, 100);
      location.hash = ctx.pageUrl({ q: q || null });
    }));
    bindSpecInputs(root);
  }
  // dialog สแกนวาดผลลัพธ์ใหม่เองแล้วผูก event ซ้ำผ่านตัวนี้
  window.MNP_RUBBERFLOW_BIND = bindRoot;

  function openDialog(name, args, ctx) {
    const factory = dialogs[name];
    if (!factory) return;
    const built = factory(ctx, args ?? {});
    if (!built?.html) return;
    const host = document.querySelector(".content") ?? document.body;
    host.querySelectorAll("dialog[data-rf-dialog]").forEach((node) => { node.close?.(); node.remove(); });
    host.insertAdjacentHTML("beforeend", built.html);
    const dialog = host.lastElementChild;
    if (!dialog || dialog.tagName !== "DIALOG") return;
    dialog.querySelectorAll("[data-rf-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
    // แตะฉากหลัง (พื้นที่ของ dialog นอกกล่อง) = ปิด
    dialog.addEventListener("pointerdown", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => dialog.remove());
    bindRoot(dialog, ctx);
    ui.enhanceDates(dialog);
    built.bind?.(dialog, ctx);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector("input:not([type=hidden]), select, textarea")?.focus?.();
  }

  // ---------- โครงหน้า ----------
  const sidebarNav = (active) => {
    if (active !== PATH) return "";
    const user = store.user();
    if (!user) return "";
    const page = currentPage(currentRoute().params);
    const counts = navCounts(store.data());
    const groups = storeApi.GROUPS.map((group) => {
      const items = storeApi.MODULES.filter((entry) => entry.group === group && storeApi.canSee(user, entry.id));
      if (!items.length) return "";
      return `<li class="rf-nav-group"><span>${escapeHtml(group)}</span><ul>${items.map((entry) => `<li><a class="rf-nav-item${entry.id === page ? " is-active" : ""}" data-rf-mod="${escapeHtml(entry.id)}" href="${escapeHtml(url(entry.id))}"${entry.id === page ? ' aria-current="page"' : ""}><span class="rf-nav-ico" aria-hidden="true">${ui.icon(entry.id)}</span><span class="rf-nav-text">${escapeHtml(entry.label)}</span>${counts[entry.id] ? `<span class="rf-nav-count" title="${escapeHtml(countTitle(entry.id))}">${counts[entry.id]}</span>` : ""}</a></li>`).join("")}</ul></li>`;
    }).join("");
    // เมนูข้างอยู่ใน <aside> ของ shell (ไม่ใช่ลูกของ .rf-page) จึงใส่จานสี RubberFlow ที่ตัวเมนูเอง
    return `<div class="nav-sub rf-nav" data-module="rf"><ul class="rf-nav-list">${groups}</ul></div>`;
  };
  const navCounts = (data) => ({
    wip: data.transfers.filter((transfer) => transfer.status === "in_transit").length,
    requisition: data.requisitions.filter((requisition) => requisition.status === "weighing").length,
    quality: data.lots.filter((lot) => lot.qc === "hold").length,
  });
  const countTitle = (id) => ({ wip: "ใบส่งมอบรอรับ", requisition: "ใบเบิกเก่าที่ค้างจ่าย", quality: "ล็อตรอตัดสิน" })[id] ?? "";

  // แถบเครื่องมือของ RubberFlow ใต้หัวหน้า: ทำหน้าที่เป็น · สแกนรหัส · แจ้งเตือน · รีเซ็ต
  const canPurge = () => store.isRemote() && Boolean(state.sandbox?.active);
  function toolbarHtml(ctx) {
    const { data, user, now } = ctx;
    // โหมดฐานข้อมูล: ผู้ใช้คือบัญชีทดสอบที่ admin เลือกในระบบหลัก ไม่มีตัวเลือกบทบาทสาธิตและไม่มีรีเซ็ต (ข้อมูลหลักอยู่ในฐานข้อมูล) · ล้างข้อมูลทดสอบ = เฉพาะ admin ตัวจริงในโหมดทดสอบ (ฐานข้อมูลตรวจซ้ำ)
    if (store.isRemote()) {
      const alerts = user && store.status() === "ready" ? derive.buildAlerts(data, now) : [];
      const bad = alerts.some((alert) => alert.tone === "bad");
      const tools = user && store.status() === "ready" ? `<form class="rf-scan" data-rf-scan role="search"><label class="sr-only" for="rf-scan-code">สแกนหรือพิมพ์รหัส</label>${ui.input("code", { id: "rf-scan-code", placeholder: "สแกนหรือพิมพ์รหัส: ล็อต กล่อง ใบสั่งผลิต ล็อตวัตถุดิบ…", type: "search" })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>
        <div class="rf-row">${ui.openButton(`แจ้งเตือน${alerts.length ? ` (${alerts.length})` : ""}`, "alerts", {}, { className: `secondary rf-alerts-btn${bad ? " is-bad" : alerts.length ? " is-warn" : ""}` })}</div>` : "";
      return `<div class="rf-toolbar"><span class="small muted" role="status" data-rf-sync>${escapeHtml(syncText())}</span>${tools}</div>`;
    }
    const options = data.users.map((row) => ({ value: row.id, label: `${storeApi.ROLES[row.role]?.label ?? row.role} · ${row.name}` }));
    const persona = `<label class="rf-persona"><span>บทบาทสาธิต</span>${ui.select("user", options, { value: user?.id ?? "", placeholder: user ? null : "เลือกบทบาทสาธิต…", extra: "data-rf-user" })}</label>`;
    // ยังไม่เลือกบทบาท: มีแค่ช่องเลือกบทบาท (สแกน แจ้งเตือน และรีเซ็ตใช้ได้หลังรู้บทบาท)
    if (!user) return `<div class="rf-toolbar">${persona}</div>`;
    const alerts = derive.buildAlerts(data, now);
    const bad = alerts.some((alert) => alert.tone === "bad");
    return `<div class="rf-toolbar">
        ${persona}
        <form class="rf-scan" data-rf-scan role="search"><label class="sr-only" for="rf-scan-code">สแกนหรือพิมพ์รหัส</label>${ui.input("code", { id: "rf-scan-code", placeholder: "สแกนหรือพิมพ์รหัส: ล็อต กล่อง ใบสั่งผลิต ล็อตวัตถุดิบ…", type: "search" })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>
        <div class="rf-row">
          ${ui.openButton(`แจ้งเตือน${alerts.length ? ` (${alerts.length})` : ""}`, "alerts", {}, { className: `secondary rf-alerts-btn${bad ? " is-bad" : alerts.length ? " is-warn" : ""}` })}
        </div>
      </div>`;
  }

  // ปุ่มล้างข้อมูลทดสอบ/รีเซ็ตข้อมูลสาธิตอยู่ท้ายหน้าในกล่องพับ ไม่ใช่บนสุด (กดพลาดแล้วข้อมูลหาย) — ปุ่มและ handler เดิม
  function testDataHtml(ctx) {
    const button = store.isRemote()
      ? (canPurge() ? `<button class="btn rf-btn secondary" type="button" data-rf-purge title="ลบข้อมูลทั้งหมดของ RubberFlow ในฐานข้อมูล (วัตถุดิบ สูตร ใบสั่งผลิต ล็อต ใบเบิก ส่งมอบ กล่อง QC NCR แม่พิมพ์ ใบสั่งซื้อ) แล้วเริ่มใหม่จากศูนย์ (ประวัติการใช้งานคงไว้)">ล้างข้อมูล RubberFlow ทดสอบ</button>` : "")
      : (ctx.user ? `<button class="btn rf-btn secondary" type="button" data-rf-reset title="ล้างข้อมูลที่บันทึกในเบราว์เซอร์นี้แล้วสร้างข้อมูลสาธิตใหม่">รีเซ็ตข้อมูลสาธิต</button>` : "");
    return button ? `<details class="rf-testdata"><summary>จัดการข้อมูลทดสอบ</summary><div class="rf-row">${button}</div></details>` : "";
  }

  // ไม่ได้เลือกบทบาท: บอกว่าโมดูลนี้คืออะไร ส่วนการเลือกบทบาทสาธิตอยู่ในช่องของแถบเครื่องมือด้านบน (ไม่มีหน้าเลือกบทบาทแยก)
  function introHtml() {
    // คำอธิบายยาวอยู่หลังปุ่ม ⓘ · ข้อความที่ต้องรู้ทันที (ข้อมูลสมมติ) อยู่ใต้ชื่อ
    return `<section class="card rf-card rf-login">${ui.headingWithNote(TITLE, "แผนก RB · ควบคุมการผลิตยาง 4 สถานี ผสม → ฉีด → อบ → ตกแต่ง พร้อม FEFO (หมดอายุก่อนจ่ายก่อน) การชั่งแบบกันพลาด การกักกันล็อตอัตโนมัติ ด่านรับมอบ และการสืบย้อนกลับถึงล็อตวัตถุดิบ")}
      <p class="muted">ข้อมูลสมมติ เก็บในเบราว์เซอร์นี้เท่านั้น</p></section>`;
  }

  // โหมดฐานข้อมูล: กำลังโหลด หรือโหลดไม่สำเร็จ (ปุ่มลองใหม่) แทนเนื้อหาหน้า
  function loadStateHtml() {
    if (store.status() === "error") return `<section class="card rf-card" role="alert"><h1>โหลดข้อมูล RubberFlow ไม่สำเร็จ</h1><p class="muted">${escapeHtml(store.error()?.message ?? "")}</p><div class="rf-row"><button class="btn rf-btn" type="button" data-rf-retry>ลองอีกครั้ง</button></div></section>`;
    return ui.card(ui.empty("กำลังโหลดข้อมูล RubberFlow…"));
  }

  function deniedHtml(user) {
    return `<section class="card rf-card"><h1>ไม่มีสิทธิ์เข้าถึงโมดูลนี้</h1><p class="muted">บทบาท “${escapeHtml(storeApi.ROLES[user.role]?.label ?? user.role)}” เข้าถึงได้เฉพาะเมนูที่แสดงในแถบข้าง</p>
      <div class="rf-row"><a class="btn rf-btn" href="${escapeHtml(url(storeApi.homeOf(user)))}">กลับหน้าหลัก</a></div></section>`;
  }

  // แถบเมนูในหน้า (จอ 761–1040px ที่แถบข้างหุบจนเมนูย่อยหาย — ดู .rf-pagenav ใน styles.css)
  function pageNavHtml(user, page) {
    const items = storeApi.MODULES.filter((entry) => storeApi.canSee(user, entry.id));
    return `<nav class="rf-pagenav" aria-label="เมนู RubberFlow">${items.map((entry) => `<a class="filter${entry.id === page ? " active" : ""}" href="${escapeHtml(url(entry.id))}">${escapeHtml(entry.label)}</a>`).join("")}</nav>`;
  }

  function makeContext(params) {
    const data = store.data();
    const user = store.user();
    const now = clockNow();
    const page = currentPage(params);
    const ctx = {
      data, user, now, params, page,
      q: String(params.get("q") ?? "").trim().slice(0, 100),
      url,
      pageUrl: (extra = {}) => url(page ?? "dashboard", { ...Object.fromEntries([...params.entries()].filter(([key]) => key !== "p")), ...extra }),
      ui, rules, derive, actions, store,
      can: (permission) => storeApi.can(user, permission),
      canSee: (id) => storeApi.canSee(user, id),
      // ความต้องการของซื้อของใบ PI เทียบสต็อกใน BOM (โหมดฐานข้อมูลที่โหลด BOM แล้วเท่านั้น · null = ไม่มีข้อมูล) ใช้ในหน้าต่างสั่งซื้อและ checkMaterials
      bomPartNeeds: (sourcePi) => {
        try {
          const bom = bomStore();
          const partNeeds = window.MNP_BOM_RULES?.partNeeds;
          if (!sourcePi || !bom || bom.status() !== "ready" || typeof partNeeds !== "function") return null;
          const bomData = bom.data();
          return partNeeds({ jobs: bomData.jobs, orders: bomData.orders, stock: bomData.stock ?? [], purchaseOrders: data.purchaseOrders ?? [] }, sourcePi);
        } catch { return null; }
      },
      roleLabel: (role) => storeApi.ROLES[role]?.label ?? role,
    };
    ctx.openDialog = (name, args) => openDialog(name, args, ctx); // เปิด dialog จากโค้ดของหน้า (เช่น ปุ่ม "สั่งซื้อส่วนที่ขาด" ในใบเบิก)
    return ctx;
  }

  // ---------- ตรวจวัตถุดิบ → สั่งซื้อ ----------
  // เรียกจากฝั่ง BOM (หลังปล่อยผลิต PI และปุ่ม "ตรวจวัตถุดิบ" ของ PI) · ตามทัน RubberFlow ให้เห็น WO ที่เพิ่งเปิดก่อน แล้วเทียบความต้องการเคมีของ WO เหล่านั้นกับสต็อก (rules.chemicalNeeds)
  // auto = หลังปล่อยผลิต: ขาด → เปิด dialog สั่งซื้อ · ไม่ขาด → แจ้งสั้นๆ ว่าเคมีพอ · ปุ่มเรียกเอง (auto = false) เปิด dialog เสมอ · บัญชีที่ไม่มีสิทธิ์สั่งซื้อไม่เห็นอะไร
  async function checkMaterials({ woIds = [], sourcePi = "", skippedJobs = 0, auto = false } = {}) {
    try {
      const user = store.user();
      if (!user || !storeApi.can(user, "purchase")) return { ok: false, reason: "rights" };
      await store.ensureLoaded();
      if (store.status() !== "ready") return { ok: false, reason: "not-ready" };
      try { await store.catchUp(); } catch { /* ใช้ข้อมูลที่มี */ }
      if (store.isRemote() && woIds.some((id) => !store.data().orders.some((order) => order.id === id))) { try { await store.reload(); } catch { /* ใช้ข้อมูลที่มี */ } }
      if (store.status() !== "ready") return { ok: false, reason: "not-ready" };
      const ctx = makeContext(new URLSearchParams());
      const result = rules.chemicalNeeds(ctx.data, woIds, ctx.now, { remote: store.isRemote() });
      const parts = ctx.bomPartNeeds(sourcePi);
      if (auto && !result.anyShort && !parts?.anyShort) {
        const enough = [result.rows.length ? "เคมี" : "", parts?.rows.length ? "ของซื้อ" : ""].filter(Boolean);
        if (enough.length) showToast(enough.length === 2 ? "เคมีและของซื้อพอสำหรับใบนี้" : enough[0] === "เคมี" ? "เคมีพอสำหรับ WO ที่เปิด" : "ของซื้อพอสำหรับใบนี้");
        return { ok: true, opened: false, result, parts };
      }
      openDialog("purchase", { woIds, sourcePi, skippedJobs }, ctx);
      return { ok: true, opened: true, result };
    } catch (error) {
      showToast(friendlyError(error), "error");
      return { ok: false, reason: "error" };
    }
  }

  function bindPage(root, ctx) {
    bindRoot(root, ctx);
    root.querySelector("[data-rf-user]")?.addEventListener("change", (event) => {
      const user = store.setUser(event.target.value);
      const page = ctx.page ?? "dashboard";
      if (user && !storeApi.canSee(user, page)) location.hash = url(storeApi.homeOf(user));
      else renderRoute();
    });
    root.querySelector("[data-rf-scan]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = String(new FormData(event.currentTarget).get("code") ?? "").trim().slice(0, 60);
      event.currentTarget.reset();
      openDialog("scan", { code }, ctx);
    });
    root.querySelector("[data-rf-retry]")?.addEventListener("click", () => {
      store.reload();
      renderRoute();
    });
    root.querySelector("[data-rf-audit-reload]")?.addEventListener("click", () => { store.loadAudit(true); renderRoute(); });
    root.querySelector("[data-rf-purge]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!(await confirmDialog({ title: "ล้างข้อมูล RubberFlow ทดสอบทั้งหมด?", message: "ลบข้อมูล RubberFlow ในฐานข้อมูลทั้งหมด (วัตถุดิบ สูตรยางทุก revision ใบสั่งผลิต ล็อตวัตถุดิบ ใบเบิก ล็อตผลิต ใบส่งมอบ กล่องสินค้า ผลตรวจ QC NCR แม่พิมพ์ และใบสั่งซื้อ) แล้วเริ่มใหม่จากศูนย์ (ผู้ใช้อื่นที่เปิดหน้านี้อยู่ต้องโหลดใหม่) ย้อนกลับไม่ได้ · งาน BOM ที่ผูก WO เดิมไว้และยอดที่รายงานเข้างานแล้วไม่ถูกแตะ · ประวัติการใช้งาน (audit) ไม่ถูกลบและมีบรรทัดบันทึกการล้างเพิ่ม · ข้อมูลระบบจริงไม่ถูกแตะ", confirmLabel: "ล้างข้อมูล RubberFlow ทดสอบ", danger: true }))) return;
      button.disabled = true;
      const outcome = await store.purge();
      if (outcome.ok) showToast(`ล้างข้อมูล RubberFlow ทดสอบแล้ว ${outcome.deleted} รายการ`);
      else { button.disabled = false; showToast(friendlyError(outcome.error), "error"); }
      renderRoute();
    });
    root.querySelector("[data-rf-reset]")?.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "ล้างข้อมูลที่บันทึกทั้งหมดแล้วสร้างข้อมูลสาธิตใหม่?", confirmLabel: "ล้างข้อมูล", danger: true }))) return;
      store.reset();
      showToast("รีเซ็ตข้อมูลสาธิตเรียบร้อย");
      renderRoute();
    });
  }

  async function renderRubberFlow(params) {
    if (!state.employee?.isSandbox) return renderNotFound();
    store.ensureLoaded(); // โหมดฐานข้อมูล: โหลดข้อมูลหลักครั้งแรก (วาดหน้าใหม่เองเมื่อเสร็จ) · โหมดในเครื่องไม่ทำอะไร
    const ctx = makeContext(params);
    const { user, page } = ctx;
    const entry = page ? storeApi.findModule(page) : null;
    ui.module = entry && user ? page : ""; // ไอคอนหน้าชื่อหน้า (ui.pageHead)
    const title = entry && user ? `${TITLE} / ${entry.label}` : TITLE;
    let body;
    let bind = null;
    if (!user) body = introHtml();
    else if (!entry) {
      // หน้าไม่รู้จัก → หน้าแรกของบทบาท (ไม่แสดงหน้าว่าง)
      location.hash = url(storeApi.homeOf(user));
      return undefined;
    } else if (!storeApi.canSee(user, page)) body = deniedHtml(user);
    else if (store.status() !== "ready") body = `${pageNavHtml(user, page)}${loadStateHtml()}`;
    else {
      const render = pages[page];
      const built = render ? render(ctx) : { html: ui.card(ui.empty("หน้านี้ยังไม่พร้อม")) };
      body = `${pageNavHtml(user, page)}${built.html}`;
      bind = built.bind ?? null;
    }
    // ชื่อโมดูลอยู่ใน breadcrumb และเมนูข้างของระบบหลักแล้ว แถบนี้จึงมีแค่เครื่องมือ (บทบาทสาธิต สแกน แจ้งเตือน รีเซ็ต)
    const head = `<header class="rf-head">${toolbarHtml(ctx)}</header>`;
    dirty = false; // หน้าใหม่ = ไม่มีฟอร์มที่แก้ค้างแล้ว (บันทึกสำเร็จ โหลดใหม่ เปลี่ยนหน้า)
    app.innerHTML = shell(`<div class="rf-page" data-module="rf" data-rf-mod="${escapeHtml(entry && user ? page : "")}">${head}${body}${testDataHtml(ctx)}</div>`, PATH, title);
    bindShell();
    const root = document.querySelector(".content");
    bindPage(root, ctx);
    ui.enhanceDates(root);
    ui.labelTables(root);
    bind?.(root, ctx);
    scheduleReadyRefresh();
    // ระหว่างแก้ฟอร์มมีข้อมูลใหม่ของผู้อื่นค้าง (store ไม่ได้รวมให้): ฟอร์มจบแล้ว รวมตอนนี้ (ยังเปิด dialog อยู่ = ค้างต่อ)
    if (store.hasNewer()) store.catchUp();
    return undefined;
  }

  // นาฬิกาบ่มยาง/แจ้งเตือนเดินเองทุกนาที เฉพาะเมื่อแท็บมองเห็น อยู่หน้า RubberFlow ไม่มี dialog เปิด ไม่ได้พิมพ์อยู่ และไม่มีฟอร์มที่กรอกค้าง
  // ช่องพิมพ์ที่ modules/searchable-select.js สร้างแทน <select> (.ss-input) ตั้ง value เองโดยไม่มี attribute จึงไม่นับ ใช้ <select> ตัวจริงที่ซ่อนอยู่แทน
  const hasDraft = () => [...document.querySelectorAll(".rf-page input, .rf-page textarea, .rf-page select")]
    .some((node) => {
      if (node.classList.contains("ss-input")) return false;
      if (node.type === "checkbox" || node.type === "radio") return node.checked !== node.defaultChecked;
      if (node.tagName === "SELECT") return node.selectedIndex !== Math.max(0, [...node.options].findIndex((option) => option.defaultSelected)); // ไม่มี selected = ตัวแรก
      return node.value !== node.defaultValue;
    });
  const idleForRefresh = () => {
    if (document.hidden || !location.hash.startsWith(`#/${PATH}`) || !state.employee?.isSandbox) return false;
    if (document.querySelector("dialog[open]")) return false;
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return false;
    return !hasDraft();
  };
  window.setInterval(() => { if (idleForRefresh()) renderRoute(); }, 60000);

  // ล็อตผสมที่จะบ่มครบภายใน 5 นาที: วาดหน้าใหม่ตอนครบเลย ไม่รอรอบนาที ปุ่ม "ส่งต่อ" จึงขึ้นตรงเวลา
  // เวลาเทียบตามนาฬิกาเดียวกับหน้า (clockNow: นาฬิกาเซิร์ฟเวอร์ในโหมดฐานข้อมูล) ตัวตั้งเวลานับระยะห่าง จึงไม่ขึ้นกับนาฬิกาเครื่อง
  // ช่วยกรณีนาฬิกาเซิร์ฟเวอร์ยังไม่มีตัวอย่าง หรือคลาดเหลือไม่กี่ร้อยมิลลิวินาที · ตอนครบไม่ว่าง (dialog เปิด กำลังพิมพ์ ฟอร์มค้าง) = รอรอบนาทีเหมือนเดิม
  const READY_SOON_MS = 5 * 60000;
  let readyTimer = null;
  function scheduleReadyRefresh() {
    if (readyTimer !== null) window.clearTimeout?.(readyTimer);
    readyTimer = null;
    if (typeof window.setTimeout !== "function" || store.status() !== "ready") return;
    const now = clockNow();
    const next = Math.min(...store.data().lots.filter((lot) => lot.stage === "mixing" && lot.readyAt > now).map((lot) => lot.readyAt));
    if (!Number.isFinite(next) || next - now > READY_SOON_MS) return;
    readyTimer = window.setTimeout(() => {
      readyTimer = null;
      if (idleForRefresh()) renderRoute();
    }, next - now + 250);
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.RUBBERFLOW = {
    code: "RUBBERFLOW",
    enabled: true,
    standalone: true,
    // ข้อมูลทั้ง 12 ชุดอยู่ในตาราง/RPC ของ RubberFlow ที่รับเฉพาะ admin ในโหมดทดสอบ (RF_TEST_MODE_ONLY)
    sandbox: true,
    label: TITLE,
    palette: "rf",
    // group: หัวกลุ่ม "ทดสอบ" ในเมนูข้าง (โมดูลต้นแบบที่ข้อมูลอยู่ในเบราว์เซอร์) — sandboxOnly ต้องคงไว้: เห็นเฉพาะ admin ในโหมดทดสอบ
    nav: [{ path: PATH, label: "RubberFlow (แผนก RB)", icon: NAV_ICON, sandboxOnly: true, group: "ทดสอบ", subnav: sidebarNav }],
    pages: { [PATH]: renderRubberFlow },
  };
})();
