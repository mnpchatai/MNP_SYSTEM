// ฝ่ายวางแผน (PP) เดิมชื่อ BOM รายแผนก — โมดูล Pilot Web ในโหมดทดสอบ (#/pp?p=<หน้า> · ลิงก์เก่า #/bom พาไป #/pp) รุ่นทดสอบของ docs/BOM_SYSTEM_PLAN.md ก่อนขึ้นฐานข้อมูล
// โครงเดียวกับ RubberFlow: modules/bom-rules.js (กฎล้วน) · bom-actions.js (กฎธุรกิจ) · bom-seed.js (ข้อมูลสาธิต) · bom-store.js (บทบาท + localStorage) ·
// bom-pages.js (หน้าและ dialog ลงทะเบียนใน window.MNP_BOM_PAGES / _DIALOGS) · ไฟล์นี้ (shell เส้นทาง การผูก event)
// ใช้ชิ้นส่วน HTML และสไตล์ .rf-* ของ RubberFlow (window.MNP_RUBBERFLOW_UI) จึงใช้กติกา event ชื่อเดียวกัน (data-rf-form / data-rf-action / data-rf-open / data-rf-go)
// แต่ผูกกับ store ของ BOM เท่านั้น — ในเบราว์เซอร์จริง (มี Supabase) ข้อมูลทั้งหมด (ชิ้นงาน BOM สี แพ็กเกจ ขั้นตอนผลิต ลูกค้า ใบสั่งผลิต งาน) อยู่ในฐานข้อมูลผ่าน RPC
// app_bom_master / app_bom_master_since / app_bom_save_master (ชนกันรายระเบียน บันทึกคืนส่วนต่าง) บันทึกการใช้งานอ่านจาก app_bom_audit และ admin ล้างข้อมูลทดสอบได้ด้วย app_sandbox_purge_bom · ไม่มีอะไรเก็บใน localStorage ผู้ใช้คือบัญชีทดสอบ (persona) ของ admin
// และบทบาท BOM มาจากตำแหน่ง/แผนกของบัญชีนั้น (storeApi.personaUser) · ไม่มี Supabase (เทสต์ใน Node) ใช้ชุดสาธิตใน localStorage และบทบาทสาธิต 8 คนเหมือนเดิม
// ใช้งานจริง (20261130010000): พนักงานจริงใช้ได้ด้วยบัญชีของตัวเอง ข้อมูลจริงแยกจากข้อมูลทดสอบที่ฐานข้อมูล (is_test ตามโหมดของผู้เรียก) · เมนูและหน้า #/bom
// เปิดให้กลุ่มวางแผนและพนักงานแผนกในสายผลิตตาม storeApi.usesBom (โหมดทดสอบเห็นทุกบัญชีทดสอบเหมือนเดิม) · ล้างข้อมูลทดสอบมีเฉพาะ admin ในโหมดทดสอบ
// การซ่อน/แสดงเมนูและปุ่มเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูล
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, app, shell, bindShell, renderNotFound, escapeHtml, showToast,
// friendlyError, confirmDialog, renderRoute, currentRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerBomModule() {
  // โรงงานขั้น 8: BOM รายแผนก เปลี่ยนชื่อเป็นโมดูลฝ่ายวางแผน (PP) ที่ #/pp · ลิงก์เก่า #/bom… พาไป #/pp… (renderLegacyBom) · palette / data-module "bom" ของสไตล์คงเดิม
  const PATH = "pp";
  const LEGACY_PATH = "bom";
  const TITLE = "ฝ่ายวางแผน (PP)";
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v4H4zM14 3h6v4h-6zM14 10h6v4h-6zM14 17h6v4h-6z"/><path d="M10 7h2v13h2M12 12h2M12 5h2"/></svg>`;

  const rules = window.MNP_BOM_RULES;
  const actions = window.MNP_BOM_ACTIONS;
  const seed = window.MNP_BOM_SEED;
  const storeApi = window.MNP_BOM_STORE;
  const ui = window.MNP_RUBBERFLOW_UI;
  const pages = (window.MNP_BOM_PAGES ??= {});
  const dialogs = (window.MNP_BOM_DIALOGS ??= {});

  const storage = (() => {
    try { return window.localStorage; } catch { return null; }
  })();
  // โหมดฐานข้อมูล: มี Supabase (CDN โหลดก่อนไฟล์นี้) · sb สร้างใน app.js หลังไฟล์นี้โหลด จึงอ้างตอนเรียกใช้เท่านั้น (เหมือน state)
  const remote = typeof window.supabase !== "undefined" ? {
    async load() {
      const { data, error } = await sb.rpc("app_bom_master");
      if (error) throw error;
      return data;
    },
    async save(changes, baseVersion, action, audit, epoch) {
      const { data, error } = await sb.rpc("app_bom_save_master", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null });
      if (error) throw error;
      return data;
    },
    async since(version) {
      const { data, error } = await sb.rpc("app_bom_master_since", { p_version: version });
      if (error) throw error;
      return data;
    },
    async audit(limit) {
      const { data, error } = await sb.rpc("app_bom_audit", { p_limit: limit });
      if (error) throw error;
      return data;
    },
    async purge() {
      const { data, error } = await sb.rpc("app_sandbox_purge_bom");
      if (error) throw error;
      return data;
    },
  } : null;
  // WO ของ RubberFlow ที่โหลดจากฐานข้อมูลแล้ว (null = ยังไม่โหลด หรือเป็นโหมดในเครื่อง) · ใช้ตัดสินว่างานที่ผูก WO เริ่มแล้วหรือยัง
  const loadedRfOrders = () => {
    try {
      const rf = window.MNP_RUBBERFLOW?.store;
      return rf?.isRemote?.() && rf.status() === "ready" ? rf.data().orders ?? null : null;
    } catch { return null; }
  };
  const store = storeApi.createStore({ storage, seed: () => seed.buildSeed(Date.now()), actions, remote, persona: () => storeApi.personaUser(state.employee), shouldHold: () => isEditing(), rfOrders: loadedRfOrders });
  window.MNP_BOM = { store, PATH, url, context: (params) => makeContext(params), transforms: () => TRANSFORMS, isEditing: () => isEditing(), hasUnsavedInput: () => hasUnsavedInput(),
    // โมดูลแผนก (modules/factory-kit.js) ใช้หน้าของตัวเองแต่สั่งงานผ่านคำสั่งและ dialog ของ BOM ชุดเดียวกัน: เปิด dialog · ข้อความสถานะการบันทึก · หน้าใหม่ = ไม่มีฟอร์มที่แก้ค้าง
    openDialog: (name, args, ctx) => openDialog(name, args, ctx), syncText: () => syncText(), clearEditing: () => { dirty = false; repaintPending = false; } };
  // โหมดฐานข้อมูล: โหลดเสร็จ/โหลดไม่สำเร็จ/บันทึกไม่สำเร็จ (ย้อนกลับแล้ว) วาดหน้าใหม่ · เริ่ม/เสร็จการบันทึกแค่เปลี่ยนข้อความสถานะ ไม่ทับฟอร์มที่ผู้ใช้กำลังกรอก
  // (บันทึกสำเร็จแต่ฐานข้อมูลตอบข้อมูลต่างจากที่แสดงอยู่ จึงวาดใหม่)
  const onBomRoute = () => { try { return currentRoute().path === PATH; } catch { return false; } };
  // หน้าแรกของโมดูลแผนก (#/gr ฯลฯ) สั่งงาน BOM ได้เหมือนหน้า BOM จึงได้การวาดใหม่หลังบันทึก/ย้อนกลับและคำเตือนก่อนปิดหน้าชุดเดียวกัน
  // หน้า RubberFlow ก็นับเมื่อกำลังแสดงการ์ดงาน RB จาก BOM (หน้าภาพรวม) · หน้า RubberFlow อื่นไม่นับ
  const onOwnRoute = () => onBomRoute() || Boolean(window.MNP_FACTORY?.onDeptRoute?.()) || Boolean(window.MNP_RUBBERFLOW?.showsBomJobs?.());
  const updateSync = () => document.querySelectorAll("[data-bom-sync]").forEach((node) => { node.textContent = syncText(); });
  // ข้อมูลที่แสดงเปลี่ยนเพราะผู้อื่นบันทึก (ตามทันหรือส่วนต่างหลังบันทึก): วาดหน้าใหม่ เว้นแต่ผู้ใช้กำลังแก้ฟอร์ม/เปิด dialog อยู่ (ไม่ทับสิ่งที่พิมพ์) แจ้งแทน
  // "กำลังแก้" = dirty: ติดตามจาก event ที่เบราว์เซอร์ส่งจริง (isTrusted) ไม่ใช้ว่าช่องไหนมีโฟกัส เพราะตารางสร้าง BOM เก็บแถวไว้ใน DOM อย่างเดียว
  // ลบ/ลากแถวหรือแตะปุ่มแล้วโฟกัสหลุดไป body (บน iPhone ปุ่มที่แตะไม่ได้โฟกัสเลย) ฟอร์มก็ยังไม่ได้บันทึก · ล้าง dirty เมื่อวาดหน้าใหม่ (บันทึกสำเร็จ โหลดใหม่ เปลี่ยนหน้า)
  // ระหว่าง dirty/มี dialog store ไม่รวมข้อมูลของผู้อื่นเข้า data และไม่ขยับเวอร์ชันฐาน (store รู้จาก shouldHold ทั้งตอน catchUp และตอนคำตอบของการบันทึกมาถึง) การบันทึกจึงตรวจชนจากเวอร์ชันที่ฟอร์มวาดมา
  let dirty = false;
  // หน้าแผนก (#/gr ฯลฯ) ที่ BOM โหลดเสร็จ/ไม่สำเร็จระหว่างเปิด dialog: ไม่วาดทับ จำไว้แล้ววาดเมื่อ dialog ปิด (หรือเมื่อหน้าถูกวาดใหม่เอง) · store ส่ง event นี้ครั้งเดียว ไม่จำไว้หน้าจะค้างข้อมูลเก่า
  let repaintPending = false;
  const isEditing = () => dirty || Boolean(document.querySelectorAll("dialog[open]").length) || Boolean(window.MNP_RUBBERFLOW?.isEditing?.()); // หน้า RubberFlow ที่แสดงการ์ดงาน BOM: ฟอร์มที่แก้ค้างของ RubberFlow เองก็นับ (isEditing ของ RubberFlow นับเฉพาะเมื่ออยู่ที่หน้านั้น)
  const MOVE_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  // ช่องค้นหา/ตัวเลือกบทบาทสาธิตไม่นับเป็นการแก้ · ปุ่มที่เปิดหน้า/dialog หรือสั่ง action เองไม่ได้แก้ฟอร์ม (dialog นับจากการเปิดอยู่)
  const NOT_EDITING = "[data-rf-search], [data-rf-user], [data-rf-open], [data-rf-go], [data-rf-action], [data-rf-close], [data-bom-retry], [data-rf-reset], [data-bom-purge], [data-bom-audit-reload], [data-bom-rf-create], [data-bom-rf-check], [data-bom-parts-buy], [data-tree-toggle], [data-tree-pick], [data-tree-all], [data-hub-qty], [data-bom-draft-buy], [data-tree-split]";
  // หน้าของโมดูลแผนก (#/gr ฯลฯ) ก็นับ: ฟอร์มในหน้า (บันทึกผลรายวัน ตั้งค่าของ GR) ไม่ถูกวาดทับเมื่อผู้อื่นบันทึก · หน้าใหม่ล้างค่าที่ renderLanding (clearEditing)
  function markDirty(event) {
    if (!event?.isTrusted || !(onBomRoute() || window.MNP_FACTORY?.onDeptRoute?.())) return;
    const target = event.target;
    if (!target?.closest?.(".content") || target.closest(NOT_EDITING)) return;
    if (event.type === "click") {
      const button = target.closest("button");
      if (!button || button.type === "submit") return;
    } else if (event.type === "pointerdown") {
      if (!target.closest("[data-drag-handle]") || event.button > 0) return;
    } else if (event.type === "keydown") {
      if (!target.closest("[data-drag-handle]") || !MOVE_KEYS.includes(event.key)) return;
    }
    dirty = true;
  }
  for (const type of ["input", "change", "click", "pointerdown", "keydown"]) document.addEventListener?.(type, markDirty, true);
  // มีข้อมูลที่พิมพ์ไว้แต่ยังไม่ได้บันทึกจริงหรือไม่: ช่องในหน้า BOM และ dialog ที่เปิดอยู่ที่ค่าต่างจากค่าตั้งต้นของมัน (defaultValue / defaultChecked / defaultSelected)
  // ไม่ใช้ dirty ตรงๆ เพราะ dirty ตั้งเมื่อกดปุ่มใดก็ได้ · ฟอร์มที่บันทึกแล้วหรือ dialog ที่ปิดแล้วถูกวาดใหม่/ลบออกจากหน้า จึงไม่ค้างเตือน · ช่องค้นหา ตัวเลือกบทบาทสาธิต และช่องที่ไม่มีชื่อ (ตัวช่วยของหน้า) ไม่นับ
  const SKIP_INPUT_TYPES = ["hidden", "file", "button", "submit", "reset", "image"];
  const fieldChanged = (node) => {
    if (!node?.name || node.disabled || node.closest?.("[data-rf-search], [data-rf-user]")) return false;
    const tag = String(node.tagName ?? "").toUpperCase();
    // select ที่ไม่มีตัวเลือกใดติด selected: เบราว์เซอร์เลือกตัวแรกที่ไม่ disabled ให้เอง (defaultSelected ยังเป็น false) จึงถือตัวนั้นเป็นค่าตั้งต้น ไม่นับว่าเปลี่ยน
    if (tag === "SELECT") {
      const options = [...(node.options ?? [])];
      if (node.multiple) return options.some((option) => option.selected !== option.defaultSelected);
      const marked = options.findIndex((option) => option.defaultSelected);
      const initial = marked >= 0 ? marked : options.findIndex((option) => !option.disabled);
      return options.findIndex((option) => option.selected) !== initial;
    }
    if (tag === "INPUT" && SKIP_INPUT_TYPES.includes(node.type)) return false;
    if (tag === "INPUT" && (node.type === "checkbox" || node.type === "radio")) return node.checked !== node.defaultChecked;
    return node.value !== node.defaultValue;
  };
  function hasUnsavedInput() {
    try {
      return [...(document.querySelectorAll?.(".content input, .content textarea, .content select, dialog input, dialog textarea, dialog select") ?? [])].some(fieldChanged);
    } catch { return false; }
  }
  // รีเฟรช/ปิดแท็บขณะกรอกฟอร์มของ BOM: ให้เบราว์เซอร์ถามก่อน (ลงทะเบียนครั้งเดียว กันซ้ำเมื่อไฟล์นี้ถูกโหลดอีก)
  if (!window.__mnpBomUnloadGuard) {
    window.__mnpBomUnloadGuard = true;
    window.addEventListener?.("beforeunload", (event) => {
      if (!onOwnRoute() || !hasUnsavedInput()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }
  // ข้อความแจ้งของ store (ผู้อื่นบันทึก) ไม่ทับข้อผิดพลาดที่ยังแสดงอยู่: ข้อผิดพลาดค้างจนผู้ใช้กดปิด แต่ข้อความแจ้งหายเองใน 3.5 วินาที ทับแล้วข้อผิดพลาดหายไปด้วย
  const errorShowing = () => Boolean(document.querySelector?.("#toast")?.classList?.contains?.("error"));
  const noteToast = (text) => { if (!errorShowing()) showToast(text); };
  const refreshForOthers = () => {
    if (isEditing()) noteToast("มีผู้อื่นอัปเดตข้อมูล BOM ข้อมูลล่าสุดจะแสดงเมื่อเปิดหน้านี้ใหม่");
    else renderRoute();
  };
  // หน้า RubberFlow ภาพรวม: เติมเฉพาะช่องการ์ด BOM ใหม่ (อยู่นอก dialog และนอกฟอร์มของ RubberFlow จึงไม่ทับสิ่งที่พิมพ์ค้าง) · หน้าแผนก: จำไว้วาดเมื่อ dialog ปิด
  const deferLoadedRepaint = () => {
    updateSync();
    if (window.MNP_RUBBERFLOW?.showsBomJobs?.()) window.MNP_RUBBERFLOW.remountBomJobs?.();
    else repaintPending = true;
  };
  // close ไม่ลอยขึ้น แต่จับได้ที่ขั้นดักของ document · ยังมี dialog อื่นเปิดอยู่ (เช่น dialog ใหม่แทนที่อันเก่า) = รอต่อ
  // หน้า BOM ด้วย: บันทึกที่ย้อนกลับระหว่างเปิด dialog (ดู event reverted) วาดหน้าใหม่เมื่อ dialog ปิด หน้าจึงไม่ค้างผลที่ไม่ได้บันทึก
  document.addEventListener?.("close", () => {
    if (!repaintPending || !(onBomRoute() || window.MNP_FACTORY?.onDeptRoute?.()) || isEditing()) return;
    repaintPending = false;
    renderRoute();
  }, true);
  store.subscribe((event) => {
    if (!onOwnRoute()) return;
    // บันทึกการใช้งานโหลดเสร็จ: วาดใหม่เฉพาะเมื่อผู้ใช้ยังอยู่ที่หน้านั้นและไม่ได้แก้ฟอร์มอื่นค้าง (หน้าของ BOM เท่านั้น)
    if (event.type === "audit") {
      if (onBomRoute() && currentPage(currentRoute().params) === "audit" && !isEditing()) renderRoute();
      return;
    }
    if (event.type === "purge-failed") { updateSync(); return; }
    if (event.type === "saving") updateSync();
    else if (event.type === "saved") {
      updateSync();
      // ผู้อื่นบันทึกระหว่างนั้น = แจ้งเมื่อกำลังแก้อยู่ · เนื้อหาต่างเพราะฐานข้อมูลประทับเวลา/ผู้บันทึกให้ระเบียนของเราเอง = วาดใหม่เงียบๆ เมื่อไม่ได้แก้อะไรค้าง
      // held = store กันข้อมูลผู้อื่นไว้ไม่รวม (มีฟอร์มค้างตอนคำตอบมา) แจ้งด้วย event pending แล้ว
      if (event.held) return;
      if (event.others) refreshForOthers();
      else if (event.changed && !isEditing()) renderRoute();
    } else if (event.type === "pending") noteToast("มีผู้อื่นบันทึกข้อมูล BOM ไปแล้ว ระบบจะรวมข้อมูลล่าสุดให้เมื่อบันทึกหรือเปิดหน้านี้ใหม่");
    else if (event.type === "synced") refreshForOthers();
    else if (event.type === "reverted" && isEditing()) {
      // ข้อมูลย้อนกลับแล้ว และ runAction แจ้งข้อความไทยของข้อผิดพลาดให้แล้ว (และปล่อยปุ่มที่กดไว้) · ไม่วาดหน้าใหม่ทับสิ่งที่พิมพ์ค้างในฟอร์มอื่น
      // แต่จำไว้วาดเมื่อ dialog ปิด หน้าจึงไม่ค้างผลที่แสดงไว้ก่อน (optimistic) ซึ่งไม่ได้บันทึก
      updateSync();
      repaintPending = true;
    }
    // โหลดเสร็จ/โหลดไม่สำเร็จ: นอกหน้า BOM ที่เปิด dialog หรือกรอกฟอร์มค้างระหว่างรอ BOM ไม่วาดทับ (ดู deferLoadedRepaint) · หน้า BOM วาดเหมือนเดิม
    else if (event.type === "loaded" || event.type === "load-failed") {
      if (onBomRoute() || !isEditing()) renderRoute();
      else deferLoadedRepaint();
    } else if (event.type !== "status") renderRoute();
  });
  // หน้ากลับมาโฟกัสขณะอยู่ที่หน้า BOM: ตามทันการบันทึกของผู้อื่น (store.catchUp วาดหน้าใหม่ผ่าน event synced เฉพาะเมื่อมีอะไรเปลี่ยน · มีฟอร์มค้างไม่รวม แค่แจ้ง)
  const catchUpOnFocus = () => {
    if (store.isRemote() && onOwnRoute() && !document.hidden) store.catchUp();
  };
  window.addEventListener?.("focus", catchUpOnFocus);
  document.addEventListener?.("visibilitychange", catchUpOnFocus);

  function url(page = "dashboard", extra = {}) {
    const query = new URLSearchParams();
    if (page) query.set("p", page);
    for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
    const text = query.toString();
    return `#/${PATH}${text ? `?${text}` : ""}`;
  }
  // เข้า #/bom เฉยๆ (ไม่มี p): หน้าแรกของบทบาท (สินค้า หรือ ใบสั่งผลิต) · หน้าภาพรวมเดิมไม่อยู่ในเมนูแล้ว แต่ยังเปิดได้ด้วย p=dashboard
  // ลิงก์เก่า #/bom?p=work (งานของฉัน) ไปโมดูลของแผนก: ฝ่ายวางแผน/ผู้ดูแลตาม ?dept= ก่อน คนอื่นตามแผนกของตน · ไม่มีโมดูลของแผนกนั้น = หน้าแรกของ BOM
  const workRedirect = (user, params) => {
    const planner = actions.helpers.canPlan(user);
    // ไปเฉพาะโมดูลที่ผู้ใช้เปิดได้ (หัวหน้าแผนกเห็นแค่โมดูลของแผนกตัวเอง) ไม่งั้นไปโมดูลของแผนกตัวเอง หรือหน้าแรกของ BOM
    const reach = (dept) => (window.MNP_FACTORY?.deptLink ? window.MNP_FACTORY.deptLink(state.employee, dept) : storeApi.deptRoute(dept));
    const asked = planner ? reach(params.get("dept")) : null;
    return asked ?? reach(user?.dept) ?? url(storeApi.homeOf(user));
  };
  // ลิงก์เก่า #/bom?p=rods (หน้าคลังยางเส้นยาวเดิมของ BOM) ไปที่โมดูล SR หน้า "ในคลัง" ถ้าผู้ใช้เปิดโมดูล SR ได้ · ไม่ได้ก็ไปมุมมองอ่านอย่างเดียวในโมดูล GR · ไม่มีทั้งสอง = หน้าแรกของ BOM
  const rodsRedirect = (user) => {
    const factory = window.MNP_FACTORY;
    const reach = (dept) => (factory?.canOpenDeptModule?.(state.employee, dept, `FACTORY_${dept}`) ? storeApi.deptRoute(dept) : null);
    const sr = reach("SR");
    if (sr) return `${sr}?tab=stock`;
    const gr = reach("GR");
    return gr ? `${gr}?tab=rods` : url(storeApi.homeOf(user));
  };
  // ลิงก์เก่า #/bom?p=stock (หน้าคลังของซื้อเดิมของ BOM) ไปที่โมดูลคลังวัตถุดิบ (ST) หน้า "ในคลัง" ถ้าผู้ใช้เปิดหน้านั้นได้ (ผู้ใช้โมดูล ST และแผนก WH ที่นับของซื้อ) · ไม่ได้ = หน้าแรกของ BOM
  const stockRedirect = (user) => {
    const mode = window.MNP_ST_PAGES?.access?.(state.employee) ?? null;
    return mode === "full" || mode === "wh" ? `${storeApi.deptRoute("ST")}?tab=stock` : url(storeApi.homeOf(user));
  };
  const defaultPage = () => { const home = storeApi.homeOf(store.user()); return pages[home] ? home : "dashboard"; };
  const currentPage = (params) => storeApi.findModule(params.get("p") ?? defaultPage())?.id ?? null;

  const dueFrom = (due) => Object.fromEntries(Object.entries(due ?? {}).filter(([, value]) => value).map(([dept, value]) => [dept, rules.fromInputDate(value)]));
  // ตารางสร้าง BOM: แถว (rowId[]/parentId[] + ช่องต่อแถว) → ต้นไม้ { code, item, note, nodes[] } ของ action saveBomTree
  // ชิ้นที่ยังไม่มีใน item master ส่ง newItem (ชนิด ชื่อ หน่วย น้ำหนัก ข้อมูลยาง) · ชิ้น RB ที่มีอยู่ส่ง patch เฉพาะเมื่อข้อมูลการตัด/น้ำหนัก/ชื่อเปลี่ยน
  function treeFromRows(p) {
    const arr = (key) => (Array.isArray(p[key]) ? p[key] : p[key] === undefined ? [] : [p[key]]);
    const ids = arr("rowId");
    const rows = ids.map((id, index) => ({
      id, parentId: arr("parentId")[index] ?? "", code: String(arr("childCode")[index] ?? "").trim(), name: String(arr("name")[index] ?? "").trim(), kind: arr("kind")[index], uom: arr("uom")[index],
      qty: arr("qty")[index], scrapPct: arr("scrapPct")[index], note: arr("lineNote")[index], step: arr("lineStep")[index], weightG: arr("weightG")[index],
      rubber: { compound: arr("compound")[index], cutLengthCm: arr("cutLengthCm")[index], pcsPerRoll: arr("pcsPerRoll")[index], sePerGr: arr("sePerGr")[index], kgPerRoll: arr("kgPerRoll")[index] },
    }));
    const data = store.data();
    const same = (a, b) => String(a ?? "") === String(b ?? "");
    // ฟอร์มแสดงปริมาณด้วยทศนิยมจำกัด: ถ้าค่าในฟอร์มต่างจากบรรทัดเดิมของ BOM ไม่ถึง 1e-6 ใช้ค่าเดิม (คงอัตราส่วนเช่น 1/31 ไว้เต็มความละเอียด)
    const storedLine = (parentCode, childCode) => actions.helpers.approvedBomOf(data, rules.canonicalCode(parentCode))?.lines.find((entry) => entry.childCode === rules.canonicalCode(childCode));
    const keepQty = (parentCode, childCode, qty) => {
      const line = storedLine(parentCode, childCode);
      return line && Math.abs(Number(qty) - line.qty) <= 1e-6 ? line.qty : qty;
    };
    const toNode = (row, parentCode) => {
      const item = actions.helpers.itemOf(data, row.code);
      const node = { code: row.code, qty: keepQty(parentCode, row.code, row.qty), scrapPct: row.scrapPct, note: row.note, step: row.step, flags: storedLine(parentCode, row.code)?.flags, children: rows.filter((other) => other.parentId === row.id && (other.code || other.name)).map((child) => toNode(child, row.code)) };
      if (!item) node.newItem = { kind: row.kind, name: row.name, uom: row.uom, weightG: row.weightG, rubber: row.kind === "RB" ? row.rubber : undefined };
      else {
        const patch = {};
        if (row.name && row.name !== item.name) patch.name = row.name;
        if (item.kind === "RB") {
          const current = item.rubber ?? {};
          const changed = Object.entries(row.rubber).some(([key, value]) => !same(value, current[key] ?? ""));
          if (changed) patch.rubber = row.rubber;
          if (!same(row.weightG, item.weightG || "")) patch.weightG = row.weightG;
        }
        if (Object.keys(patch).length) node.patch = patch;
      }
      return node;
    };
    const nodes = rows.filter((row) => !row.parentId && (row.code || row.name)).map((row) => toNode(row, p.code));
    // ตารางกว้างเปลี่ยนสูตรของเส้นยางที่มีสูตรอยู่แล้วไม่ได้ (ทั้งช่องสูตรของแถวเส้นยาง และแถวสูตรยางใต้เส้นยาง ซึ่ง saveBomTree ใช้เขียนช่องสูตร): การเปลี่ยนสูตรต้องเห็นสูตรเดิม → ใหม่และยืนยันที่หน้าต่าง "ข้อมูลเส้นยาง"
    const kindOf = (node) => actions.helpers.itemOf(data, node.code)?.kind ?? node.newItem?.kind;
    const guardRod = (code, children, patchCompound) => {
      const rod = actions.helpers.itemOf(data, code);
      const before = rod?.kind === "RB" ? rules.canonicalCode(rod.rubber?.compound ?? "") : "";
      if (!before) return;
      const asked = [patchCompound, (children ?? []).find((child) => kindOf(child) === "CP")?.code].filter((value) => String(value ?? "").trim()).map((value) => rules.canonicalCode(value));
      if (asked.some((value) => value !== before)) throw new Error(`เปลี่ยนสูตรยางของ ${rod.code} (${before}) ที่ปุ่ม “แก้ข้อมูลเส้นยาง” ในหน้าของเส้นยาง ตารางนี้เปลี่ยนสูตรไม่ได้`);
    };
    const guard = (list) => list.forEach((node) => { guardRod(node.code, node.children, node.patch?.rubber?.compound); guard(node.children ?? []); });
    guardRod(p.code, nodes);
    guard(nodes);
    return { code: p.code, item: { name: p.itemName, uom: p.itemUom, kind: p.itemKind }, note: p.note, nodes };
  }
  // ---------- ฟอร์มเล็กของหน้าสินค้า → ต้นไม้ของ saveBomTree ----------
  // บรรทัดเดิมของ BOM ส่งกลับตามที่เก็บ รวม flags (ไม่มี children จึงไม่แตะ BOM ของชิ้นลูก)
  const lineNode = (line) => ({ code: line.childCode, qty: line.qty, scrapPct: line.scrapPct ?? 0, note: line.note ?? "", step: line.step ?? "", flags: line.flags ?? [] });
  const linesOf = (data, code) => actions.helpers.approvedBomOf(data, rules.canonicalCode(code))?.lines ?? [];
  // ชิ้นแม่ที่รับบรรทัดจากฟอร์มเล็กได้: มีในทะเบียน มีส่วนประกอบได้ และไม่ใช่เส้นยาง (บรรทัดเดียวของเส้นยางคือสูตรยาง แก้ที่หน้าต่าง "ข้อมูลเส้นยาง" ซึ่งให้ผู้ใช้ยืนยันการเปลี่ยนสูตร)
  function lineParent(data, rawCode) {
    const parent = actions.helpers.itemOf(data, rules.canonicalCode(rawCode));
    if (!parent) throw new Error(`ไม่พบ ${rules.canonicalCode(rawCode)} ในทะเบียนชิ้นงาน`);
    if (parent.kind === "RB") throw new Error("สูตรยางของเส้นยางแก้ที่ปุ่ม “ข้อมูลเส้นยาง”");
    if (actions.helpers.NO_BOM_KINDS.includes(parent.kind)) throw new Error(`${parent.code} เป็น${rules.KINDS[parent.kind]?.label ?? parent.kind} ไม่มีส่วนประกอบ`);
    return parent;
  }
  const RUBBER_CUT_KEYS = Object.freeze(["cutLengthCm", "pcsPerRoll", "sePerGr", "kgPerRoll"]);
  const compoundCode = (value) => {
    const code = rules.canonicalCode(value);
    if (!code) throw new Error("ระบุสูตรยางของเส้นยาง");
    if (code.length > 20) throw new Error(`รหัสสูตรยาง ${code} ยาวเกิน 20 ตัวอักษร`);
    return code;
  };
  // เพิ่มหนึ่งบรรทัดใต้ชิ้นแม่ p.code · รหัสที่ยังไม่มีในทะเบียนต้องมีชื่อ ชนิด หน่วย เพื่อสร้างชิ้นใหม่ · เส้นยางใหม่ต้องมีสูตรยาง (ข้อมูลการตัดและน้ำหนักใส่ได้เลยหรือเว้นไว้)
  function treeFromLineAdd(p) {
    const data = store.data();
    const parent = lineParent(data, p.code);
    const code = rules.canonicalCode(p.addCode);
    const current = linesOf(data, parent.code);
    if (current.some((line) => line.childCode === code)) throw new Error(`${code} อยู่ใน BOM นี้แล้ว แก้ปริมาณที่บรรทัดนั้นแทน`);
    const node = { code, qty: p.addQty, scrapPct: p.addScrap, note: "" };
    if (!actions.helpers.itemOf(data, code)) {
      if (!String(p.newName ?? "").trim()) throw new Error(`ยังไม่มีรหัส ${code} ในทะเบียน กรอกชื่อ ชนิด และหน่วยเพื่อสร้างชิ้นใหม่`);
      node.newItem = { kind: p.newKind, name: p.newName, uom: p.newUom };
      if (p.newKind === "RB") {
        if (!String(p.rbCompound ?? "").trim()) throw new Error(`เส้นยางใหม่ ${code} ต้องระบุสูตรยาง`);
        node.newItem.weightG = p.rbWeightG ?? "";
        node.newItem.rubber = { compound: compoundCode(p.rbCompound), ...Object.fromEntries(RUBBER_CUT_KEYS.map((key) => [key, p[`rb_${key}`] ?? ""])) };
      }
    }
    return { code: parent.code, note: p.note, nodes: [...current.map(lineNode), node] };
  }
  // วางหลายบรรทัดจาก Excel (หน้าต่าง linesPaste): pCode[] pQty[] pScrap[] pNote[] pName[] pKind[] pUom[] ตามลำดับแถวที่ตัวอย่างบอกว่าเพิ่มได้ · ตรวจซ้ำกับข้อมูลล่าสุดตอนกดบันทึก
  function treeFromPaste(p) {
    const data = store.data();
    const parent = lineParent(data, p.code);
    const current = linesOf(data, parent.code);
    const codes = listOf(p, "pCode");
    if (!codes.length) throw new Error("ยังไม่มีบรรทัดที่เพิ่มได้ วางข้อมูลแล้วดูผลการตรวจก่อน");
    const have = new Set(current.map((line) => line.childCode));
    const nodes = codes.map((raw, index) => {
      const code = rules.canonicalCode(raw);
      if (have.has(code)) throw new Error(`${code} อยู่ใน BOM นี้แล้ว`);
      have.add(code);
      const node = { code, qty: listOf(p, "pQty")[index], scrapPct: listOf(p, "pScrap")[index] ?? "", note: listOf(p, "pNote")[index] ?? "" };
      if (!actions.helpers.itemOf(data, code)) {
        const name = String(listOf(p, "pName")[index] ?? "").trim();
        const kind = listOf(p, "pKind")[index];
        if (!name) throw new Error(`ยังไม่มีรหัส ${code} ในทะเบียน กรอกชื่อเพื่อสร้างชิ้นใหม่`);
        if (kind === "RB") throw new Error(`เส้นยางใหม่ ${code} เพิ่มทีละชิ้นที่ “เพิ่มส่วนประกอบ” (ต้องระบุสูตรยาง)`);
        node.newItem = { kind, name, uom: listOf(p, "pUom")[index] || "pcs" };
      }
      return node;
    });
    return { code: parent.code, note: p.note, nodes: [...current.map(lineNode), ...nodes] };
  }
  // คัดลอกโครงสร้างจากสินค้า/ชิ้นงานอื่น (หน้าต่าง treeCopy): บรรทัดชั้นแรกของต้นแบบมาเป็นบรรทัดของ p.code · ชั้นที่ลึกกว่าเป็น BOM ของชิ้นลูกเอง จึงตามมาโดยไม่ถูกแก้
  // mode replace = แทนบรรทัดเดิมทั้งหมด · อื่น ๆ = ต่อท้ายบรรทัดเดิม ข้ามรหัสที่มีอยู่แล้ว · กฎต้นแบบ (มี BOM ไม่เลิกใช้ ไม่เป็นวงจร ชนิดเข้ากันได้) ใช้ชุดเดียวกับ "ตั้งต้นจาก" ของตารางเดิม (pages.tools.copyPlan)
  function treeFromCopy(p) {
    const data = store.data();
    const target = lineParent(data, p.code);
    const plan = pages.tools.copyPlan(makeContext(new URLSearchParams()), p.copyFrom, target.code, target.kind);
    if (plan.error) throw new Error(plan.error);
    const from = rules.canonicalCode(p.copyFrom);
    const current = linesOf(data, target.code);
    const keep = p.mode === "replace" ? [] : current;
    const have = new Set(keep.map((line) => line.childCode));
    const added = linesOf(data, from).filter((line) => !have.has(line.childCode));
    if (!added.length) throw new Error(`ทุกบรรทัดของ ${from} มีอยู่ใน BOM นี้แล้ว ไม่มีอะไรให้เพิ่ม`);
    const retired = added.map((line) => line.childCode).filter((code) => plan.retired.includes(code));
    if (retired.length) throw new Error(`${retired.join(", ")} เลิกใช้แล้ว เพิ่มเป็นบรรทัดใหม่ของ ${target.code} ไม่ได้`);
    return { code: target.code, note: String(p.note ?? "").trim() || `คัดลอกโครงสร้างจาก ${from}`, nodes: [...keep.map(lineNode), ...added.map(lineNode)] };
  }
  // ย้ายบรรทัด (หน้าต่าง lineMove): p.childCode ออกจาก BOM ของ p.fromCode ไปต่อท้าย BOM ของ p.toCode · ทั้งสองต้องอยู่ในโครงสร้างของ p.code (รายการที่เปิดอยู่)
  // ต้นไม้ที่ส่งให้ saveBomTree มี children เฉพาะกิ่งที่พาไปถึงชิ้นแม่ทั้งสอง (BOM อื่นไม่ถูกส่ง จึงไม่ถูกแตะ) · ชิ้นแม่เดิมต้องเหลืออย่างน้อย 1 บรรทัด
  const MAX_MOVE_DEPTH = 12;
  function treeFromLineMove(p) {
    const data = store.data();
    const rootItem = lineParent(data, p.code);
    const from = lineParent(data, p.fromCode);
    if (!String(p.toCode ?? "").trim()) throw new Error("เลือกชิ้นที่จะย้ายไปอยู่ใต้");
    const to = lineParent(data, p.toCode);
    const childCode = rules.canonicalCode(p.childCode);
    const child = actions.helpers.itemOf(data, childCode);
    const fromLines = linesOf(data, from.code);
    const line = fromLines.find((entry) => entry.childCode === childCode);
    if (!line || !child) throw new Error(`ไม่พบ ${childCode} ใน BOM ของ ${from.code} แล้ว ปิดหน้าต่างแล้วเปิดใหม่`);
    if (from.code === to.code) throw new Error("บรรทัดนี้อยู่ใต้ชิ้นนั้นอยู่แล้ว");
    if (fromLines.length < 2) throw new Error(`${from.code} มีบรรทัดเดียว ย้ายออกไม่ได้ (BOM ต้องมีอย่างน้อย 1 บรรทัด)`);
    const toLines = linesOf(data, to.code);
    if (toLines.some((entry) => entry.childCode === childCode)) throw new Error(`${childCode} อยู่ใน BOM ของ ${to.code} แล้ว`);
    const kindError = rules.childKindError(to.kind, child.kind);
    if (kindError) throw new Error(`${to.code} รับ ${childCode} ไม่ได้: ${kindError}`);
    // ย้ายเข้าไปใต้ตัวเองหรือใต้ส่วนประกอบของตัวเอง = วงจร · เดินทั้งโครงสร้างไม่จำกัดชั้น (กฎเดียวกับตอนบันทึก) จึงไม่มีกรณีที่ข้ามการตรวจเพราะลึกเกิน
    if (rules.reachedFrom(childCode, new Set([to.code]), (code) => ({ lines: linesOf(data, code) }))) throw new Error(`${to.code} อยู่ข้างใต้ ${childCode} ย้ายแล้วจะเป็นวงจร`);
    const edits = new Map([[from.code, fromLines.filter((entry) => entry !== line).map(lineNode)], [to.code, [...toLines.map(lineNode), { ...lineNode(line), step: "" }]]]);
    const nodesOf = (code) => edits.get(code) ?? linesOf(data, code).map(lineNode);
    const memo = new Map();
    const touches = (code) => {
      if (memo.has(code)) return memo.get(code);
      memo.set(code, false);
      const hit = edits.has(code) || nodesOf(code).some((node) => touches(node.code));
      memo.set(code, hit);
      return hit;
    };
    const reached = new Set();
    // ต้นไม้ที่ส่งไปมีลึกได้ไม่เกิน MAX_MOVE_DEPTH ชั้น: ถ้าชิ้นที่แก้อยู่ลึกกว่านั้น (cut) ปฏิเสธพร้อมบอกสาเหตุ ไม่ส่งต้นไม้ที่ขาดกิ่ง
    let cut = false;
    const build = (code, depth = 0) => {
      if (edits.has(code)) reached.add(code);
      return nodesOf(code).map((node) => {
        if (!touches(node.code)) return node;
        if (depth >= MAX_MOVE_DEPTH) { cut = true; return node; }
        return { ...node, children: build(node.code, depth + 1) };
      });
    };
    const nodes = build(rootItem.code);
    if (reached.size !== edits.size) throw new Error(cut ? `โครงสร้างลึกเกิน ${MAX_MOVE_DEPTH} ชั้น ย้ายบรรทัดจากหน้านี้ไม่ได้ เปิดหน้าของชิ้นที่ลึกลงไปแล้วย้ายจากที่นั่น` : "ชิ้นที่เลือกไม่อยู่ในโครงสร้างของรายการที่เปิดอยู่");
    return { code: rootItem.code, note: String(p.note ?? "").trim() || `ย้าย ${childCode} จาก ${from.code} ไป ${to.code}`, nodes };
  }
  // แทรก WIP คั่น (หน้าต่าง wipInsert): บรรทัด p.childCode ของชิ้นแม่ p.code ถูกแทนด้วยชิ้นใหม่ ซึ่งมีบรรทัดเดิมเป็นส่วนประกอบเดียว · บรรทัดอื่นของชิ้นแม่ส่งกลับตามที่เก็บ
  function treeFromWipInsert(p) {
    const data = store.data();
    const parent = lineParent(data, p.code);
    const current = linesOf(data, parent.code);
    const childCode = rules.canonicalCode(p.childCode);
    const line = current.find((entry) => entry.childCode === childCode);
    if (!line) throw new Error(`ไม่พบ ${childCode} ใน BOM ของ ${parent.code} แล้ว ปิดหน้าต่างแล้วเปิดใหม่`);
    const code = rules.canonicalCode(p.wipCode);
    if (!code) throw new Error("ระบุรหัสของชิ้นใหม่");
    if (actions.helpers.itemOf(data, code)) throw new Error(`มีรหัส ${code} อยู่แล้ว ใช้รหัสใหม่สำหรับชิ้นที่แทรก`);
    if (p.wipKind === "RB" || p.wipKind === "FG" || actions.helpers.NO_BOM_KINDS.includes(p.wipKind)) throw new Error("ชนิดนี้ใช้เป็นชิ้นที่แทรกคั่นไม่ได้");
    const childQty = p.childQty === undefined || p.childQty === "" || Math.abs(Number(p.childQty) - line.qty) <= 1e-6 ? line.qty : p.childQty;
    // ขั้นของชิ้นแม่ที่บรรทัดเดิมเข้า: "ขั้นที่" ของบรรทัด หรือขั้นตอนผลิตที่ติ๊กบรรทัดนี้ไว้ (routing inputs อ้างรหัสลูก ซึ่งจะไม่ใช่ลูกของชิ้นแม่แล้ว) ชิ้นใหม่จึงเข้าที่ขั้นเดียวกัน
    const routed = (actions.helpers.routingOf(data, parent.code)?.steps ?? []).findIndex((step) => (step.inputs ?? []).includes(childCode));
    const step = line.step || (routed >= 0 && routed < 20 ? routed + 1 : "");
    const node = { code, qty: p.wipQty, scrapPct: 0, note: "", step, newItem: { kind: p.wipKind, name: p.wipName, uom: p.wipUom, ownerDept: p.wipDept || undefined }, children: [{ ...lineNode(line), qty: childQty, step: "" }] };
    return { code: parent.code, note: String(p.note ?? "").trim() || `แทรก ${code} คั่นก่อน ${childCode}`, nodes: current.map((entry) => (entry === line ? node : lineNode(entry))) };
  }
  // ขั้นตอนผลิตของชิ้นแม่ที่อ้างรหัสบรรทัดเดิมอยู่: หลังแทรก WIP รหัสนั้นไม่ใช่ลูกของชิ้นแม่แล้ว ให้ขั้นตอนอ้างรหัส WIP แทน (revision ใหม่ของ routing)
  // คืน payload ของ saveRouting (คำสั่งเดิมที่ฐานข้อมูลรับอยู่แล้ว) หรือ null เมื่อชิ้นแม่ไม่มีขั้นตอนผลิตที่อ้างบรรทัดนี้ · คำนวณก่อนบันทึก BOM ขณะที่ routing เดิมยังอยู่ แล้วส่งหลังบันทึก BOM สำเร็จ
  function routingAfterWipInsert(p) {
    const parentCode = rules.canonicalCode(p.code);
    const childCode = rules.canonicalCode(p.childCode);
    const wipCode = rules.canonicalCode(p.wipCode);
    const routing = actions.helpers.routingOf(store.data(), parentCode);
    if (!routing || !wipCode || !routing.steps.some((step) => (step.inputs ?? []).includes(childCode))) return null;
    return { itemCode: parentCode, steps: routing.steps.map((step) => ({ processCode: step.processCode, minutesPerPc: step.minutesPerPc, note: step.note ?? "", inputs: (step.inputs ?? []).map((code) => (code === childCode ? wipCode : code)) })) };
  }
  // หน้าต่าง "ข้อมูลเส้นยาง": สูตรยาง + ข้อมูลการตัด + น้ำหนัก · เปลี่ยนสูตรที่มีอยู่ต้องติ๊กยืนยันในฟอร์ม (confirmCompound) ไม่เช่นนั้นไม่ส่งคำสั่ง
  function rubberForm(p) {
    const data = store.data();
    const item = actions.helpers.itemOf(data, rules.canonicalCode(p.code));
    if (!item || item.kind !== "RB") throw new Error("รายการนี้ไม่ใช่เส้นยาง");
    const compound = compoundCode(p.compound);
    const before = rules.canonicalCode(item.rubber?.compound ?? "") || (linesOf(data, item.code)[0]?.childCode ?? "");
    if (before && compound !== before && !["1", "on", "true"].includes(String(p.confirmCompound ?? ""))) throw new Error(`ติ๊กยืนยันการเปลี่ยนสูตรยางจาก ${before} เป็น ${compound} ก่อนบันทึก`);
    return { data, item, compound, cut: Object.fromEntries(RUBBER_CUT_KEYS.map((key) => [key, p[key] ?? ""])) };
  }
  // เส้นยางที่มีบรรทัดสูตรยางใน BOM: ช่องสูตรและบรรทัดสูตรยางเปลี่ยนพร้อมกันในคำสั่งเดียว (saveBomTree: พ่อ = เส้นยาง บรรทัดเดียว = สูตรยาง)
  function treeFromRubberEdit(p) {
    const { data, item, compound, cut } = rubberForm(p);
    const line = linesOf(data, item.code)[0];
    if (!line) throw new Error("ข้อมูลของเส้นยางนี้เปลี่ยนไปแล้ว ปิดหน้าต่างแล้วเปิดใหม่");
    const qty = p.compoundQty === undefined || p.compoundQty === "" || Math.abs(Number(p.compoundQty) - line.qty) <= 1e-6 ? line.qty : p.compoundQty;
    const node = { ...lineNode(line), code: compound, qty };
    if (!actions.helpers.itemOf(data, compound)) node.newItem = { kind: "CP", name: data.compounds.find((entry) => entry.code === compound)?.name ?? compound, uom: "kg" };
    return { code: item.code, note: p.note, item: { weightG: p.weightG ?? "", rubber: cut }, nodes: [node] };
  }
  // เส้นยางที่ยังไม่มีบรรทัดสูตรยาง (เช่น นำเข้าจาก Excel): สูตรเก็บที่ช่องสูตรของเส้นยางอย่างเดียว บันทึกด้วย saveItem
  function itemFromRubberEdit(p) {
    const { data, item, compound, cut } = rubberForm(p);
    if (linesOf(data, item.code).length) throw new Error("ข้อมูลของเส้นยางนี้เปลี่ยนไปแล้ว ปิดหน้าต่างแล้วเปิดใหม่");
    return { code: item.code, kind: "RB", name: item.name, uom: item.uom, weightG: p.weightG ?? "", rubber: { compound, ...cut } };
  }
  const listOf = (p, key) => (Array.isArray(p[key]) ? p[key] : p[key] === undefined ? [] : [p[key]]);
  const TRANSFORMS = {
    // แปรรูปยาง GR (modules/gr-pages.js · 20261216010000): ขั้นตอนของงาน = ช่องติ๊ก code[] ตามลำดับขั้น + ต้องทำ qty.<รหัสขั้น>
    setGrJobSteps: (p) => ({ jobId: p.jobId, steps: listOf(p, "code").map((code) => ({ code, qtyTarget: p.qty?.[code] ?? "" })) }),
    // ตั้งค่า GR: แถวขั้นตอน step.code[] step.name[] step.kind[] step.active[] (1 / 0) ตามลำดับในฟอร์ม · เหตุผลของเสียหนึ่งบรรทัดต่อข้อ · แถวเป้า target.* (แถวว่างทั้งแถวถูกข้าม)
    // ฟอร์มรุ่นก่อนที่ไม่มีช่องจำนวนคน = people "" (action ถือเป็น 1)
    saveGrConfig: (p) => {
      const step = p.step ?? {};
      const target = p.target ?? {};
      return {
        ...(p.dept ? { dept: p.dept } : {}), // PT / BG / PK (20261224010000): แผนกของตั้งค่า (ฟอร์มส่ง data-rf-args)
        steps: listOf(step, "name").map((name, index) => ({ code: listOf(step, "code")[index] ?? "", name, kind: listOf(step, "kind")[index] ?? "main", active: listOf(step, "active")[index] !== "0" })),
        reasons: String(p.reasons ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        // จำนวนคนของเป้า target.people[] (ต้นทุนเฟส 3): ช่องตั้งต้นเป็น 1 จึงไม่ใช้ตัดสินว่าแถวว่าง
        targets: listOf(target, "itemCode").map((itemCode, index) => ({ itemCode, stepCode: listOf(target, "stepCode")[index] ?? "", perHour: listOf(target, "perHour")[index] ?? "", people: listOf(target, "people")[index] ?? "" }))
          .filter((row) => String(row.itemCode).trim() || String(row.perHour).trim()),
      };
    },
    createOrder: (p) => ({ ...p, orderedAt: rules.fromInputDate(p.orderedAt), whDue: rules.fromInputDate(p.whDue), due: dueFrom(p.due), autoDue: p.autoDue === "1" || p.autoDue === "on" }),
    // แก้หัวใบ (โมดูลฝ่ายขาย · ฝ่ายวางแผน): วันส่งมอบคลังจากช่องวันที่ · ช่องที่ไม่ส่งมาคงเดิม
    updateOrderHeader: (p) => ({ ...p, ...(p.whDue !== undefined ? { whDue: rules.fromInputDate(p.whDue) } : {}) }),
    // ฟอร์ม "เพิ่มส่วนประกอบ" ของหน้าสินค้า (lineAdd) ใช้คำสั่งเดียวกัน: บรรทัดเดิมของ BOM อ่านจากข้อมูลล่าสุดตอนกดบันทึก แล้วต่อบรรทัดใหม่
    // หน้าต่างของหน้าสินค้าอีกสามแบบใช้คำสั่งเดียวกัน: วางหลายบรรทัด (linesPaste) คัดลอกโครงสร้าง (treeCopy) ข้อมูลเส้นยางที่มีบรรทัดสูตรยาง (rubberEdit)
    saveBomTree: (p) => (p.lineAdd ? treeFromLineAdd(p) : p.linesPaste ? treeFromPaste(p) : p.treeCopy ? treeFromCopy(p) : p.rubberEdit ? treeFromRubberEdit(p) : p.wipInsert ? treeFromWipInsert(p) : p.lineMove ? treeFromLineMove(p) : treeFromRows(p)),
    // ฟอร์มแก้บรรทัดเดียวของ BOM (หน้าสินค้า): childCode[] + qty[] + scrapPct[] + lineNote[] + lineStep[] ของทุกบรรทัด → lines ของ saveBom
    // บรรทัดที่แก้ (editCode) ถ้าปริมาณในฟอร์มต่างจากเดิม (origQty) ไม่ถึง 1e-6 ใช้ค่าเดิม คงอัตราส่วนเช่น 1/31 ไว้เต็มความละเอียด
    saveBom: (p) => (Array.isArray(p.lines) ? p : {
      itemCode: p.itemCode, note: p.note,
      lines: listOf(p, "childCode").map((childCode, index) => {
        // flags ของบรรทัดเดิมไม่อยู่ในฟอร์ม: คงค่าที่เก็บไว้
        const flags = actions.helpers.approvedBomOf(store.data(), rules.canonicalCode(p.itemCode))?.lines.find((line) => line.childCode === childCode)?.flags;
        const qty = listOf(p, "qty")[index];
        const keep = childCode === p.editCode && p.origQty !== undefined && Math.abs(Number(qty) - Number(p.origQty)) <= 1e-6;
        return { childCode, qty: keep ? Number(p.origQty) : qty, scrapPct: listOf(p, "scrapPct")[index] ?? "", note: listOf(p, "lineNote")[index] ?? "", step: listOf(p, "lineStep")[index] ?? "", flags };
      }),
    }),
    // rubberEdit = หน้าต่าง "ข้อมูลเส้นยาง" ของเส้นยางที่ยังไม่มีบรรทัดสูตรยางใน BOM (มีบรรทัดแล้วไปทาง saveBomTree ข้างบน)
    saveItem: (p) => {
      if (p.rubberEdit) return itemFromRubberEdit(p);
      // ฟอร์มข้อมูลชิ้นงานทั่วไป: สูตรยางของเส้นยางที่มีสูตรอยู่แล้วเปลี่ยนจากที่นี่ไม่ได้ (ต้องเห็นสูตรเดิม → ใหม่และยืนยันที่หน้าต่าง "ข้อมูลเส้นยาง")
      const stored = actions.helpers.itemOf(store.data(), rules.canonicalCode(p.code ?? ""));
      // สลับชนิดออกจาก/เข้าเป็นเส้นยางพร้อมเปลี่ยนสูตรก็ไม่ได้ (ไม่งั้นเปลี่ยนชนิดสองรอบคือทางอ้อม)
      const before = stored && (stored.kind === "RB" || p.kind === "RB") ? rules.canonicalCode(stored.rubber?.compound ?? "") : "";
      const next = p.rubber?.compound === undefined ? before : rules.canonicalCode(p.rubber.compound ?? "");
      if (before && next !== before) throw new Error(`เปลี่ยนสูตรยางของ ${stored.code} ที่ปุ่ม “แก้ข้อมูลเส้นยาง” ในหน้าของเส้นยาง`);
      // เส้นยางที่มีสูตรแล้วเปลี่ยนชนิดจากฟอร์มนี้ไม่ได้ (รวมเป็นชิ้นยาง SE): พอไม่ใช่เส้นยาง ช่องสูตรแก้หรือถูกล้างได้ แล้วกลับมาเป็นเส้นยางด้วยสูตรใหม่ได้โดยไม่ผ่านการยืนยัน (ชิ้นที่ลงชนิดผิดให้เลิกใช้แล้วสร้างรหัสใหม่)
      if (before && stored.kind === "RB" && p.kind !== "RB") throw new Error(`${stored.code} เป็นเส้นยางที่มีสูตรยาง ${before} แล้ว เปลี่ยนชนิดไม่ได้ ถ้าลงชนิดผิด ให้เลิกใช้ชิ้นงานนี้แล้วสร้างรหัสใหม่`);
      // สูตรเดิมที่พิมพ์ต่างรูป (ช่องว่าง ตัวพิมพ์) เก็บตามที่เก็บอยู่ ไม่เขียนทับด้วยรูปที่พิมพ์
      if (before && p.rubber && p.rubber.compound !== undefined) p = { ...p, rubber: { ...p.rubber, compound: stored.rubber.compound } };
      return { ...p, rubber: p.kind === "RB" || p.kind === "SE" ? p.rubber ?? null : null };
    },
    // ฟอร์มชุดสี: slotKey[] + slotColor[] → slots · ฟอร์มแพ็กเกจ: childCode[] + qty[] → lines (แถวว่างถูกข้าม)
    saveColorSet: (p) => ({ ...p, slots: listOf(p, "slotKey").map((key, index) => ({ key, color: listOf(p, "slotColor")[index] ?? "" })) }),
    setStockCounts: (p) => ({ ...p, counts: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "" })) }),
    // เปิดงานเพิ่ม (20261227010000): itemCode[] + qty[] ของยอดที่ใช้จากสต็อกกับส่วนที่เพิ่ม → use (ช่องว่าง = ไม่ใช้)
    addJobsForChanges: (p) => ({ orderId: p.orderId, use: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "" })) }),
    // ฟอร์มคลังของซื้อ: itemCode[] + qty[] (+ safetyQty[] ถ้าแก้สต็อกขั้นต่ำได้) ตามลำดับแถว · ช่องว่าง = ไม่แตะค่าเดิม
    countPartStock: (p) => ({ counts: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "", safetyQty: listOf(p, "safetyQty")[index] ?? "" })) }),
    // ฟอร์มเบิกจ่ายของซื้อ: itemCode[] + qty[] ของบรรทัดที่เลือก (บรรทัดที่ไม่เลือกถูก disabled จึงไม่อยู่ในฟอร์ม) → lines · ไม่เลือกเลย = lines ว่าง (action แจ้งให้เลือก)
    issueOrderParts: (p) => ({ orderId: p.orderId, lines: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "" })) }),
    // ฟอร์มคืนของเหลือ: itemCode[] + qty[] ตามลำดับแถว → lines (เฉพาะแถวที่กรอกจำนวน · เว้นว่างหรือ 0 = ไม่คืนรายการนั้น)
    returnOrderParts: (p) => ({ orderId: p.orderId, reason: p.reason, lines: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "" })).filter((line) => String(line.qty).trim() !== "" && Number(line.qty) !== 0) }),
    // ฟอร์มรับเข้าคลัง / ส่งมอบสินค้าสำเร็จรูป: fgCode[] + qty[] ตามลำดับแถว (มีเฉพาะแถวที่มีของให้รับ/ส่ง) → lines (เว้นว่างหรือ 0 = ไม่รับ/ส่งรายการนั้น)
    receiveFg: (p) => ({ orderId: p.orderId, lines: fgLines(p) }),
    // ส่งมอบกล่องสินค้าของ RubberFlow: กล่องที่ติ๊ก (ids[])
    shipBoxes: (p) => ({ ids: p.ids ?? [] }),
    // overConfirm = ติ๊กยืนยันส่งมอบเกินจำนวนที่สั่ง (ช่องในฟอร์ม) · action deliverFg ปฏิเสธการส่งเกินที่ไม่ได้ยืนยัน
    deliverFg: (p) => ({ orderId: p.orderId, lines: fgLines(p), overConfirm: p.overConfirm === "1" }),
    // ฟอร์มขั้นตอนผลิต: processCode[] + minutesPerPc[] → steps ตามลำดับแถว (แถวที่ไม่เลือกขั้นตอนถูกข้าม)
    // inputCode[] + inputStep[] → step.inputs (ส่วนประกอบที่เลือก "ขั้นแรก" ไม่ถูกผูก จึงแสดงที่ขั้นแรก)
    saveRouting: (p) => {
      const inputSteps = listOf(p, "inputStep");
      const inputCodes = listOf(p, "inputCode");
      return {
        itemCode: p.itemCode,
        steps: listOf(p, "processCode").map((processCode, index) => ({ processCode, minutesPerPc: listOf(p, "minutesPerPc")[index] ?? "", inputs: inputCodes.filter((_, at) => processCode && inputSteps[at] === processCode) })).filter((step) => String(step.processCode ?? "").trim()),
      };
    },
    savePackage: (p) => ({ ...p, lines: listOf(p, "childCode").map((childCode, index) => ({ childCode, qty: listOf(p, "qty")[index] ?? "" })).filter((line) => String(line.childCode ?? "").trim()) }),
  };

  // กล่องสินค้าของ RubberFlow ที่โมดูล WH สั่ง (รับเข้า ส่งมอบ ย้อน · modules/wh-pages.js): คำสั่งอยู่ใน store ของ RubberFlow ไม่ใช่ของ BOM จึงส่งต่อให้ runAction ของ RubberFlow (แจ้งผลและกันเสียงซ้ำเอง)
  const RF_BOX_ACTIONS = Object.freeze(["receiveBoxes", "shipBoxes", "reverseBoxReceipt", "reverseBoxShip"]);
  const fgLines = (p) => listOf(p, "fgCode").map((fgCode, index) => ({ fgCode, qty: listOf(p, "qty")[index] ?? "" })).filter((line) => String(line.qty).trim() !== "" && Number(line.qty) !== 0);
  // after(ผลของคำสั่ง) = ทำต่อหลังคำสั่งนี้บันทึกสำเร็จ (โหมดในเครื่อง: ทันที · โหมดฐานข้อมูล: หลังฐานข้อมูลตอบ) ใช้ต่อคำสั่งที่ต้องเห็นผลของคำสั่งก่อนหน้า เช่น ขั้นตอนผลิตหลังแทรก WIP
  // failNote = บอกผู้ใช้ว่าการทำต่อนี้ล้มแล้วเหลืออะไรค้าง (ใช้กับคำสั่งที่ทำต่อจากคำสั่งก่อนหน้า เช่น ขั้นตอนผลิตหลังแทรก WIP) นำหน้าข้อความผิดพลาดตามปกติ
  function runAction(name, payload, successText, after = null, failNote = "") {
    if (RF_BOX_ACTIONS.includes(name)) {
      const rubberflow = window.MNP_RUBBERFLOW;
      if (!rubberflow?.runAction) { showToast("ไม่มีข้อมูล RubberFlow ทำรายการนี้ไม่ได้", "error"); return false; }
      return rubberflow.runAction(name, payload, successText);
    }
    const errorText = (error) => (failNote ? `${failNote} (${friendlyError(error)})` : friendlyError(error));
    const result = store.run(name, payload);
    if (!result.ok) {
      showToast(errorText(result.error), "error");
      return false;
    }
    const report = () => {
      if (!store.isPersisted()) showToast("บันทึกในหน่วยความจำได้ แต่เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล (localStorage เต็มหรือปิดอยู่) รีเฟรชแล้วข้อมูลจะหาย", "error");
      else if (successText) showToast(String(successText).replaceAll("{result}", String(result.result?.summary ?? result.result ?? "")));
    };
    if (!result.saving) {
      report();
      after?.(result.result);
      return true;
    }
    // โหมดฐานข้อมูล: หน้าแสดงผลทันที (optimistic) แล้วแจ้งผลเมื่อฐานข้อมูลตอบ · ถ้าไม่สำเร็จ store ย้อนกลับและวาดหน้าใหม่ให้เอง (event reverted มาก่อนข้อความนี้ จึงไม่ลบข้อความ)
    // ปุ่มที่กดส่งไว้ (factory-kit holdButtons) กดได้อีก: ส่วนที่ไม่ได้วาดใหม่ (ฟอร์มที่พิมพ์ค้าง เช่น ออกใบสั่งผลิตของฝ่ายขาย) ไม่ค้างปุ่มที่กดไม่ได้
    result.saving.then((outcome) => {
      if (!outcome.ok) {
        window.MNP_FACTORY?.releasePending?.();
        showToast(errorText(outcome.error), "error");
        return;
      }
      report();
      after?.(result.result);
      const notice = actions.helpers.rubberflowNotice(name, payload, outcome.rubberflow);
      if (notice) showToast(notice.text, notice.type);
      // WO ที่ฐานข้อมูลเปิด/ยกเลิกให้ ตามทันฝั่ง RubberFlow ให้เลข WO และหน้าของ RubberFlow เป็นปัจจุบัน
      if (outcome.rubberflow) { try { window.MNP_RUBBERFLOW?.store?.catchUp?.(); } catch { /* RubberFlow ตามทันเองตอนเปิดหน้า */ } }
      // ปล่อยผลิตแล้วเปิด WO ให้งาน RB และ/หรือมีงานของซื้อ (ST): ตรวจเคมีที่ WO เหล่านั้นต้องใช้และของซื้อของใบเทียบสต็อก ขาด = เปิด dialog สั่งซื้อให้ผู้ที่สั่งได้ (ST) ผู้ที่ดูได้อย่างเดียวได้ข้อความแจ้งสั้นๆ · ที่เหลือแจ้งสั้นๆ ว่าพอ
      const opened = name === "releaseOrder" && Array.isArray(outcome.rubberflow?.opened) ? outcome.rubberflow.opened : [];
      const hasParts = name === "releaseOrder" && store.isRemote() && store.data().jobs.some((job) => job.orderId === payload?.orderId && actions.helpers.isPartJob(job));
      if (opened.length || hasParts) {
        try { Promise.resolve(window.MNP_RUBBERFLOW?.checkMaterials?.({ woIds: opened.map((row) => row.woId), sourcePi: payload?.orderId ?? "", skippedJobs: outcome.rubberflow?.skipped?.length ?? 0, auto: true })).catch(() => {}); } catch { /* ตรวจเคมีไม่ได้: ปุ่ม "ตรวจวัตถุดิบ" ที่ใบ PI ยังใช้ได้ */ }
      }
    });
    return true;
  }
  // ตัวผูก event data-rf-* ใช้ร่วมกับทุกโมดูลโรงงาน (modules/factory-kit.js) · ที่นี่เหลือแค่ตะขอของ BOM ก่อนส่งคำสั่ง:
  // แทรก WIP (บันทึกขั้นตอนผลิตต่อ) และเปิดใบใหม่แล้วไปที่หน้าของใบนั้น
  function beforeSubmit(name, raw) {
    // แทรก WIP: ขั้นตอนผลิตของชิ้นแม่ที่อ้างบรรทัดเดิมเปลี่ยนไปอ้างรหัส WIP ด้วย (บันทึกต่อจาก BOM ด้วย saveRouting)
    const wipRouting = name === "saveBomTree" && raw.wipInsert ? routingAfterWipInsert(raw) : null;
    // ถ้าบันทึกขั้นตอนผลิตต่อไม่สำเร็จ BOM มี WIP ที่แทรกแล้ว แต่ขั้นตอนผลิตของชิ้นแม่ยังอ้างชิ้นเดิม: บอกตรงๆ ว่าอะไรเสร็จแล้ว อะไรค้าง และต้องทำอะไรต่อ
    const wipFail = wipRouting ? `แทรก WIP ${rules.canonicalCode(raw.wipCode)} ใน BOM ของ ${wipRouting.itemCode} แล้ว แต่ยังไม่ได้ปรับขั้นตอนผลิตของ ${wipRouting.itemCode} ให้อ้าง WIP นี้แทน ${rules.canonicalCode(raw.childCode)} · เปิดหน้าของ ${wipRouting.itemCode} แล้วแก้ขั้นตอนผลิตเองที่ขั้นที่ยังอ้าง ${rules.canonicalCode(raw.childCode)}` : "";
    // ขั้นตอนผลิตบันทึกต่อเมื่อ BOM บันทึกสำเร็จแล้วเท่านั้น (runAction เรียก after หลังฐานข้อมูลตอบและ store รวมคำตอบแล้ว) และคำนวณจากข้อมูลตอนนั้น ไม่ใช่ค่าตอนกดบันทึก:
    // คำตอบของการบันทึก BOM อาจพาขั้นตอนผลิตที่ผู้อื่นเพิ่งแก้มาด้วย ส่งขั้นตอนที่คำนวณไว้ก่อนบนเวอร์ชันใหม่ = ทับของผู้อื่นเงียบๆ
    // ขั้นตอนตอนนี้ไม่อ้างบรรทัดเดิมแล้ว = ไม่มีอะไรต้องปรับ · BOM ใน store ไม่มี WIP (ไม่ควรเกิด) = แจ้งว่าค้างอะไรแทนการส่ง
    const wipFollowUp = wipRouting ? () => {
      const wipCode = rules.canonicalCode(raw.wipCode);
      const bom = actions.helpers.approvedBomOf(store.data(), wipRouting.itemCode);
      if (!bom?.lines.some((line) => line.childCode === wipCode)) { showToast(wipFail, "error"); return; }
      const routingPayload = routingAfterWipInsert(raw);
      if (routingPayload) runAction("saveRouting", routingPayload, `ขั้นตอนผลิตของ ${routingPayload.itemCode} อ้างชิ้นใหม่แล้ว`, null, wipFail);
    } : null;
    // เปิดใบใหม่แล้วไปที่หน้าของใบนั้นเลย (ไม่ค้างที่รายการ) · โหมดฐานข้อมูลไปหลังฐานข้อมูลตอบ และไปเฉพาะเมื่อผู้ใช้ยังอยู่ที่รายการใบสั่งผลิต ไม่ดึงออกจากหน้าอื่น
    const openCreated = name === "createOrder" ? (id) => {
      const route = currentRoute();
      if (id && route.path === PATH && route.params.get("p") === "orders" && !route.params.get("sel")) location.hash = url("orders", { sel: id });
    } : null;
    return { after: wipFollowUp ?? openCreated };
  }
  function bindRoot(root, ctx) {
    window.MNP_FACTORY.bindRoot(root, ctx, { run: runAction, transforms: TRANSFORMS, beforeSubmit, openDialog, ui });
  }

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
    dialog.addEventListener("pointerdown", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => dialog.remove());
    bindRoot(dialog, ctx);
    ui.enhanceDates(dialog);
    built.bind?.(dialog, ctx);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector("input:not([type=hidden]):not([hidden]), select:not([hidden]), textarea, .date-pick-button")?.focus?.();
  }

  // ---------- โครงหน้า ----------
  const sidebarNav = (active) => {
    if (active !== PATH) return "";
    const user = store.user();
    if (!user) return "";
    const page = currentPage(currentRoute().params);
    // เมนูหลัก 3 อัน (storeApi.NAV): หน้าที่ไม่อยู่ในเมนู (สร้าง BOM นับคงคลัง ฯลฯ) ทำให้เมนูแม่ของมันเป็นตัวที่เลือกอยู่
    const parent = storeApi.NAV_PARENT[page] ?? page;
    const items = navItems(user).map((id) => `<li><a class="rf-nav-item${id === parent ? " is-active" : ""}" data-rf-mod="bom-${escapeHtml(id)}" href="${escapeHtml(url(id))}"${id === page ? ' aria-current="page"' : ""}><span class="rf-nav-ico" aria-hidden="true">${pages.icon(id)}</span><span class="rf-nav-text">${escapeHtml(storeApi.navLabel(id))}</span></a></li>`).join("");
    // เมนูข้างอยู่ใน <aside> ของ shell (ไม่ใช่ลูกของ .rf-page) จึงใส่จานสี BOM ที่ตัวเมนูเอง
    return `<div class="nav-sub rf-nav" data-module="bom"><ul class="rf-nav-list">${items}</ul></div>`;
  };
  const navItems = (user) => storeApi.NAV.filter((id) => storeApi.canSee(user, id));

  // สถานะการติดต่อฐานข้อมูล (โหมดฐานข้อมูล): ว่างเมื่อไม่มีอะไรค้าง · อัปเดตที่ [data-bom-sync] โดยไม่วาดหน้าใหม่
  // คำสั่งใหญ่ (นำเข้าชีตทั้งไฟล์) ส่งหลายครั้ง: บอกว่าถึงส่วนไหนแล้ว
  const syncText = () => {
    if (store.status() === "loading") return "กำลังโหลดข้อมูล…";
    if (!store.isSaving()) return "";
    const progress = store.saveProgress?.();
    return progress ? `กำลังบันทึก ส่วนที่ ${progress.done + 1} จาก ${progress.total}…` : "กำลังบันทึก…";
  };
  const canPurge = () => store.isRemote() && Boolean(state.sandbox?.active);
  function toolbarHtml(ctx) {
    const { data, user } = ctx;
    // โหมดฐานข้อมูล: ผู้ใช้คือพนักงานที่ล็อกอิน (หรือบัญชีทดสอบที่ admin เลือกในโหมดทดสอบ) ไม่มีตัวเลือกบทบาทสาธิตและไม่มีรีเซ็ต (ข้อมูลหลักอยู่ในฐานข้อมูล)
    if (store.isRemote()) {
      // ลิงก์ไป RubberFlow เฉพาะผู้ที่เปิดหน้า RubberFlow ได้ (แผนก RB · PP · ผู้จัดการ · โรงงานขั้น 6)
      const rfLink = (window.MNP_RUBBERFLOW_STORE?.canOpenRubberFlowPage?.(state.employee) ?? true)
        ?`<div class="rf-row"><a class="btn rf-btn secondary" href="#/rubberflow?p=orders" title="ไปที่ใบสั่งผลิตของแผนก RB ใน RubberFlow">ใบสั่งผลิต (RubberFlow)</a></div>`
        : "";
      return `<div class="rf-toolbar"><span class="small muted" role="status" data-bom-sync>${escapeHtml(syncText())}</span>
        ${rfLink}</div>`;
    }
    const options = data.users.map((row) => ({ value: row.id, label: `${storeApi.ROLES[row.role]?.label ?? row.role} · ${row.name}` }));
    const persona = `<label class="rf-persona"><span>บทบาทสาธิต</span>${ui.select("user", options, { value: user?.id ?? "", placeholder: user ? null : "เลือกบทบาทสาธิต…", extra: "data-rf-user" })}</label>`;
    // ยังไม่เลือกบทบาท: มีแค่ช่องเลือกบทบาท
    if (!user) return `<div class="rf-toolbar">${persona}</div>`;
    return `<div class="rf-toolbar">
        ${persona}
        <div class="rf-row">
          <a class="btn rf-btn secondary" href="#/rubberflow?p=orders" title="ไปที่ใบสั่งผลิตของแผนก RB ใน RubberFlow">ใบสั่งผลิต (RubberFlow)</a>
        </div>
      </div>`;
  }
  // ปุ่มล้างข้อมูลทดสอบ/รีเซ็ตข้อมูลสาธิตอยู่ท้ายหน้าในกล่องพับ ไม่ใช่บนสุด (กดพลาดแล้วข้อมูลหาย) — ปุ่มและ handler เดิม
  // ล้างข้อมูล BOM ทดสอบ: เฉพาะ admin ที่อยู่ในโหมดทดสอบ (state.sandbox มีเฉพาะ admin ตัวจริง ไม่ว่าตอนนี้ทำหน้าที่เป็นบัญชีทดสอบใคร)
  function testDataHtml(ctx) {
    const button = store.isRemote()
      ? (canPurge() ? `<button class="btn rf-btn secondary" type="button" data-bom-purge title="ลบใบสั่งผลิต งาน ชิ้นงาน BOM ลูกค้า และข้อมูลทดสอบอื่นของ BOM ทั้งหมดในฐานข้อมูล แล้วเริ่มใหม่จากศูนย์ (ประวัติการใช้งานคงไว้)">ล้างข้อมูล BOM ทดสอบ</button>` : "")
      : (ctx.user ? `<button class="btn rf-btn secondary" type="button" data-rf-reset title="ล้างข้อมูลที่บันทึกในเบราว์เซอร์นี้ (รวมที่นำเข้าจาก Excel) แล้วสร้างข้อมูลสาธิตใหม่">รีเซ็ตข้อมูลสาธิต</button>` : "");
    return button ? `<details class="rf-testdata"><summary>จัดการข้อมูลทดสอบ</summary><div class="rf-row">${button}</div></details>` : "";
  }

  // ไม่ได้เลือกบทบาท: บอกว่าโมดูลนี้คืออะไร ส่วนการเลือกบทบาทสาธิตอยู่ในช่องของแถบเครื่องมือด้านบน (ไม่มีหน้าเลือกบทบาทแยก)
  function introHtml() {
    // คำอธิบายยาวอยู่หลังปุ่ม ⓘ · ข้อความที่ต้องรู้ทันที (ข้อมูลสมมติ) อยู่ใต้ชื่อ
    return `<section class="card rf-card rf-login">${ui.headingWithNote(TITLE, "รุ่นทดสอบของระบบ BOM รายแผนก: ทะเบียนชิ้นงานเดียว · BOM หลายชั้นที่แต่ละแผนกเป็นเจ้าของชั้นของตนและมีฉบับแก้ไข/อนุมัติ · ใบสั่งผลิต (PI) คำนวณวัตถุดิบแล้วปล่อยเป็นงานรายแผนก · งาน RB ส่งต่อเป็นใบสั่งผลิตใน RubberFlow · นำเข้า BOM จริงจากชีต Excel ได้ที่เมนู “ข้อมูลตั้งต้น” (นำเข้าจาก Excel)")}
      <p class="muted">ข้อมูลสมมติ เก็บในเบราว์เซอร์นี้เท่านั้น</p></section>`;
  }
  function deniedHtml(user) {
    return `<section class="card rf-card"><h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1><p class="muted">บทบาท “${escapeHtml(storeApi.ROLES[user.role]?.label ?? user.role)}” เข้าถึงได้เฉพาะเมนูที่แสดงในแถบข้าง</p>
      <div class="rf-row"><a class="btn rf-btn" href="${escapeHtml(url(storeApi.homeOf(user)))}">กลับหน้าหลัก</a></div></section>`;
  }
  // โหมดฐานข้อมูล: กำลังโหลด หรือโหลดไม่สำเร็จ (ปุ่มลองใหม่) แทนเนื้อหาหน้า
  function loadStateHtml() {
    if (store.status() === "error") return `<section class="card rf-card" role="alert"><h1>โหลดข้อมูล BOM ไม่สำเร็จ</h1><p class="muted">${escapeHtml(store.error()?.message ?? "")}</p><div class="rf-row"><button class="btn rf-btn" type="button" data-bom-retry>ลองอีกครั้ง</button></div></section>`;
    return ui.card(ui.empty("กำลังโหลดข้อมูล BOM…"));
  }
  // โหมดฐานข้อมูลที่ยังไม่มีชิ้นงานเลย: หน้าที่อ่านข้อมูลหลักบอกทางไปหน้านำเข้า (ผู้ที่นำเข้าได้) แทนตารางว่างหลายใบ
  const EMPTY_MASTER_PAGES = Object.freeze(["dashboard", "items", "product", "structure", "variants", "find"]);
  // หัวหน้าแบบเดียวกับหน้า BOM อื่น (ก้อนสีโมดูล + ไอคอน + ชื่อหน้า) บอกว่ายังว่างและทางไปหน้านำเข้า
  function emptyMasterHtml(user, page, label) {
    const canImport = actions.helpers.canPlan(user);
    // ปุ่มอยู่ติดข้อความที่ชวนให้นำเข้า (ที่เดียว ไม่ซ้ำที่หัวหน้า) · ผู้ที่นำเข้าไม่ได้ไม่เห็นปุ่ม
    const next = canImport ? `<a class="btn rf-btn" href="${escapeHtml(url("import"))}">นำเข้าจาก Excel</a>` : "";
    const hint = canImport ? "ยังไม่มีข้อมูล BOM ในฐานข้อมูล · เริ่มจากนำเข้าไฟล์ Excel" : "ยังไม่มีข้อมูล BOM ในฐานข้อมูล · ให้ฝ่ายวางแผนหรือผู้จัดการนำเข้า";
    return `<header class="rf-pagehead"><div class="rf-pagehead-main"><span class="rf-mod-ico" aria-hidden="true">${pages.icon(page)}</span><div><h1>${escapeHtml(label)}</h1></div></div></header>${ui.card(ui.empty(hint, next))}`;
  }
  function pageNavHtml(user, page) {
    const parent = storeApi.NAV_PARENT[page] ?? page;
    return `<nav class="rf-pagenav" aria-label="เมนู BOM">${navItems(user).map((id) => `<a class="filter${id === parent ? " active" : ""}" href="${escapeHtml(url(id))}"${id === page ? ' aria-current="page"' : ""}>${escapeHtml(storeApi.navLabel(id))}</a>`).join("")}</nav>`;
  }

  function makeContext(params) {
    const data = store.data();
    const user = store.user();
    const page = currentPage(params);
    const ctx = {
      data, user, now: Date.now(), params, page,
      q: String(params.get("q") ?? "").trim().slice(0, 100),
      url,
      pageUrl: (extra = {}) => url(page ?? "dashboard", { ...Object.fromEntries([...params.entries()].filter(([key]) => key !== "p")), ...extra }),
      ui, rules, actions, store,
      helpers: actions.helpers,
      canSee: (id) => storeApi.canSee(user, id),
      roleLabel: (role) => storeApi.ROLES[role]?.label ?? role,
      // RubberFlow (ถ้าโหลดอยู่): สร้าง WO จากงาน RB และอ่านสูตรที่อนุมัติ
      // ใช้งานจริง: พนักงานที่อ่าน RubberFlow ไม่ได้ (GR PT BG PK · private.rf_can_read) ไม่ได้ RubberFlow เลย = ไม่มีส่วนเคมี / WO แทน "กำลังโหลด" ค้าง
      rubberflow: () => ((window.MNP_RUBBERFLOW_STORE?.usesRubberFlow?.(state.employee) ?? true) ? window.MNP_RUBBERFLOW ?? null : null),
      runAction,
    };
    ctx.openDialog = (name, args) => openDialog(name, args, ctx); // เปิด dialog จากโค้ดของหน้า (เช่น เมนูคลิกขวา) แทนปุ่ม data-rf-open
    return ctx;
  }

  function bindPage(root, ctx) {
    bindRoot(root, ctx);
    root.querySelector("[data-rf-user]")?.addEventListener("change", (event) => {
      const user = store.setUser(event.target.value);
      const page = ctx.page ?? "dashboard";
      if (user && !storeApi.canSee(user, page)) location.hash = url(storeApi.homeOf(user));
      else renderRoute();
    });
    root.querySelector("[data-bom-retry]")?.addEventListener("click", () => {
      store.reload();
      renderRoute();
    });
    root.querySelector("[data-bom-audit-reload]")?.addEventListener("click", () => { store.loadAudit(true); renderRoute(); });
    root.querySelector("[data-bom-purge]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!(await confirmDialog({ title: "ล้างข้อมูล BOM ทดสอบทั้งหมด?", message: "ลบใบสั่งผลิต งานรายแผนก ลูกค้า ชิ้นงาน BOM สี แพ็กเกจ ขั้นตอนผลิต และข้อมูลทดสอบอื่นของ BOM ในฐานข้อมูลทั้งหมด แล้วเริ่มใหม่จากศูนย์ (ผู้ใช้อื่นที่เปิดหน้านี้อยู่ต้องโหลดใหม่) ย้อนกลับไม่ได้ · ประวัติการใช้งาน (audit) ไม่ถูกลบและมีบรรทัดบันทึกการล้างเพิ่ม · ข้อมูลระบบจริงไม่ถูกแตะ", confirmLabel: "ล้างข้อมูล BOM ทดสอบ", danger: true }))) return;
      button.disabled = true;
      const outcome = await store.purge();
      if (outcome.ok) showToast(`ล้างข้อมูล BOM ทดสอบแล้ว ${outcome.deleted} รายการ`);
      else { button.disabled = false; showToast(friendlyError(outcome.error), "error"); }
      renderRoute();
    });
    root.querySelector("[data-rf-reset]")?.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "ล้างข้อมูลที่บันทึกทั้งหมด (รวมที่นำเข้าจาก Excel) แล้วสร้างข้อมูลสาธิตใหม่?", confirmLabel: "ล้างข้อมูล", danger: true }))) return;
      store.reset();
      showToast("รีเซ็ตข้อมูลสาธิตเรียบร้อย");
      renderRoute();
    });
  }

  // ลิงก์เก่า #/bom?… → #/pp?… (คงคำค้นทั้งหมด · location.replace ไม่ทิ้งหน้าเก่าไว้ในประวัติ) · ทะเบียนลูกค้า (?p=customers) ย้ายไปโมดูลฝ่ายขาย #/sa?tab=customers
  function legacyTarget(params) {
    if (params.get("p") === "customers") {
      const q = String(params.get("q") ?? "").trim();
      return `#/sa?tab=customers${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    }
    const text = params.toString();
    return `#/${PATH}${text ? `?${text}` : ""}`;
  }
  function renderLegacyBom(params) {
    const target = legacyTarget(params);
    if (typeof location.replace === "function") location.replace(target);
    else location.hash = target;
    return undefined;
  }
  async function renderBom(params) {
    if (!storeApi.usesBom(state.employee)) return renderNotFound();
    if (params.get("p") === "customers") return renderLegacyBom(params);
    if (["work", "rods", "stock"].includes(params.get("p")) && store.user()) {
      // งานของฉัน คลังยางเส้นยาว และคลังของซื้อ ย้ายไปอยู่ที่โมดูลของแผนกแล้ว: เปลี่ยนที่อยู่แทนรายการเดิม (กดย้อนกลับไม่วนกลับมาหน้านี้)
      const p = params.get("p");
      const target = p === "rods" ? rodsRedirect(store.user()) : p === "stock" ? stockRedirect(store.user()) : workRedirect(store.user(), params);
      if (typeof location.replace === "function") location.replace(target);
      else location.hash = target;
      return undefined;
    }
    store.ensureLoaded(); // โหมดฐานข้อมูล: โหลดข้อมูลหลักครั้งแรก (วาดหน้าใหม่เองเมื่อเสร็จ) · โหมดในเครื่องไม่ทำอะไร
    const ctx = makeContext(params);
    const { user, page } = ctx;
    const entry = page ? storeApi.findModule(page) : null;
    ui.module = ""; // ไอคอนหน้าชื่อหน้าใส่เองใน pages (ไอคอนของ RubberFlow ไม่ตรงกับหน้า BOM)
    const title = entry && user ? `${TITLE} / ${entry.label}` : TITLE;
    let body;
    let bind = null;
    if (!user) body = introHtml();
    else if (!entry) {
      location.hash = url(storeApi.homeOf(user));
      return undefined;
    } else if (!storeApi.canSee(user, page)) body = deniedHtml(user);
    else if (store.status() !== "ready") body = `${pageNavHtml(user, page)}${loadStateHtml()}`;
    else if (store.isRemote() && !ctx.data.items.length && EMPTY_MASTER_PAGES.includes(page)) body = `${pageNavHtml(user, page)}${emptyMasterHtml(user, page, entry?.label ?? title)}`;
    else {
      const render = pages[page];
      const built = render ? render(ctx) : { html: ui.card(ui.empty("หน้านี้ยังไม่พร้อม")) };
      body = `${pageNavHtml(user, page)}${built.html}`;
      bind = built.bind ?? null;
    }
    // ชื่อโมดูลอยู่ในเมนูข้างของระบบหลักแล้ว แถบนี้จึงมีแค่เครื่องมือ (บทบาทสาธิต ลิงก์ RubberFlow รีเซ็ต)
    const head = `<header class="rf-head">${toolbarHtml(ctx)}</header>`;
    dirty = false; // หน้าใหม่ = ไม่มีฟอร์มที่แก้ค้างแล้ว (บันทึกสำเร็จ โหลดใหม่ เปลี่ยนหน้า)
    app.innerHTML = shell(`<div class="rf-page bom-page" data-module="bom" data-rf-mod="${escapeHtml(entry && user ? `bom-${page}` : "")}">${head}${body}${testDataHtml(ctx)}</div>`, PATH, title);
    bindShell();
    const root = document.querySelector(".content");
    bindPage(root, ctx);
    ui.enhanceDates(root);
    ui.labelTables(root);
    bind?.(root, ctx);
    // ระหว่างแก้ฟอร์มมีข้อมูลใหม่ของผู้อื่นค้าง (store ไม่ได้รวมให้): ฟอร์มจบแล้ว รวมตอนนี้ (ยังเปิด dialog อยู่ = ค้างต่อ)
    if (store.hasNewer()) store.catchUp();
    return undefined;
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.BOM = {
    code: "BOM",
    enabled: true,
    standalone: true,
    // ข้อมูลอยู่ในตาราง/RPC ของ BOM ที่แยกข้อมูลทดสอบ (is_test) ตามโหมดของผู้เรียก ไม่แตะตารางของโมดูลอื่น จึงเปิดในโหมดทดสอบได้
    sandbox: true,
    label: TITLE,
    palette: "bom",
    // เมนูเห็นเฉพาะผู้ที่ใช้ BOM (storeApi.usesBom: ทุกบัญชีทดสอบ · ใช้งานจริง = กลุ่มวางแผนและแผนกในสายผลิต)
    // โหมดทดสอบ: โมดูลนี้เป็นของฝ่ายวางแผน (PP) เมนูจึงเห็นเฉพาะฝ่ายวางแผนและผู้จัดการ (factory-kit canSeeDept) · แผนกอื่นยังเปิดลิงก์ที่โมดูลของตนสร้างมาได้ (ซ่อนแค่เมนู)
    navAllowed: (employee) => storeApi.usesBom(employee) && (employee?.isSandbox !== true || window.MNP_FACTORY?.canSeeDept?.(employee, "PP") !== false),
    // หัวกลุ่มของเมนูข้าง: "โรงงาน" ในโหมดทดสอบ (sandboxOnly · เรียงตามลำดับในผังงาน flowNo 2 = PP ร่วมกับโมดูลรายแผนก ดู factory-kit.js) · "การผลิต" เมื่อใช้งานจริง (realOnly) — รายการเดียวกัน แสดงทีละโหมด
    nav: [
      { path: PATH, label: TITLE, icon: NAV_ICON, sandboxOnly: true, group: "โรงงาน", flowNo: 2, subnav: sidebarNav },
      { path: PATH, label: TITLE, icon: NAV_ICON, realOnly: true, group: "การผลิต", subnav: sidebarNav },
    ],
    pages: { [PATH]: renderBom, [LEGACY_PATH]: renderLegacyBom },
  };
})();
