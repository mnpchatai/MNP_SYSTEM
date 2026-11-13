// BOM รายแผนก — โมดูล Pilot Web ในโหมดทดสอบ (#/bom?p=<หน้า>) รุ่นทดสอบของ docs/BOM_SYSTEM_PLAN.md ก่อนขึ้นฐานข้อมูล
// โครงเดียวกับ RubberFlow: modules/bom-rules.js (กฎล้วน) · bom-actions.js (กฎธุรกิจ) · bom-seed.js (ข้อมูลสาธิต) · bom-store.js (บทบาท + localStorage) ·
// bom-pages.js (หน้าและ dialog ลงทะเบียนใน window.MNP_BOM_PAGES / _DIALOGS) · ไฟล์นี้ (shell เส้นทาง การผูก event)
// ใช้ชิ้นส่วน HTML และสไตล์ .rf-* ของ RubberFlow (window.MNP_RUBBERFLOW_UI) จึงใช้กติกา event ชื่อเดียวกัน (data-rf-form / data-rf-action / data-rf-open / data-rf-go)
// แต่ผูกกับ store ของ BOM เท่านั้น — ในเบราว์เซอร์จริง (มี Supabase) ข้อมูลทั้งหมด (ชิ้นงาน BOM สี แพ็กเกจ ขั้นตอนผลิต ลูกค้า ใบสั่งผลิต งาน) อยู่ในฐานข้อมูลผ่าน RPC
// app_bom_master / app_bom_master_since / app_bom_save_master (ชนกันรายระเบียน บันทึกคืนส่วนต่าง) บันทึกการใช้งานอ่านจาก app_bom_audit และ admin ล้างข้อมูลทดสอบได้ด้วย app_sandbox_purge_bom · ไม่มีอะไรเก็บใน localStorage ผู้ใช้คือบัญชีทดสอบ (persona) ของ admin
// และบทบาท BOM มาจากตำแหน่ง/แผนกของบัญชีนั้น (storeApi.personaUser) · ไม่มี Supabase (เทสต์ใน Node) ใช้ชุดสาธิตใน localStorage และบทบาทสาธิต 8 คนเหมือนเดิม
// การซ่อน/แสดงเมนูและปุ่มเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูล หน้า #/bom ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, app, shell, bindShell, renderNotFound, escapeHtml, showToast,
// friendlyError, confirmDialog, renderRoute, currentRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerBomModule() {
  const PATH = "bom";
  const TITLE = "BOM รายแผนก";
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
  window.MNP_BOM = { store, PATH, url, context: (params) => makeContext(params) };
  // โหมดฐานข้อมูล: โหลดเสร็จ/โหลดไม่สำเร็จ/บันทึกไม่สำเร็จ (ย้อนกลับแล้ว) วาดหน้าใหม่ · เริ่ม/เสร็จการบันทึกแค่เปลี่ยนข้อความสถานะ ไม่ทับฟอร์มที่ผู้ใช้กำลังกรอก
  // (บันทึกสำเร็จแต่ฐานข้อมูลตอบข้อมูลต่างจากที่แสดงอยู่ จึงวาดใหม่)
  const onBomRoute = () => { try { return currentRoute().path === PATH; } catch { return false; } };
  const updateSync = () => document.querySelectorAll("[data-bom-sync]").forEach((node) => { node.textContent = syncText(); });
  // ข้อมูลที่แสดงเปลี่ยนเพราะผู้อื่นบันทึก (ตามทันหรือส่วนต่างหลังบันทึก): วาดหน้าใหม่ เว้นแต่ผู้ใช้กำลังแก้ฟอร์ม/เปิด dialog อยู่ (ไม่ทับสิ่งที่พิมพ์) แจ้งแทน
  // "กำลังแก้" = dirty: ติดตามจาก event ที่เบราว์เซอร์ส่งจริง (isTrusted) ไม่ใช้ว่าช่องไหนมีโฟกัส เพราะตารางสร้าง BOM เก็บแถวไว้ใน DOM อย่างเดียว
  // ลบ/ลากแถวหรือแตะปุ่มแล้วโฟกัสหลุดไป body (บน iPhone ปุ่มที่แตะไม่ได้โฟกัสเลย) ฟอร์มก็ยังไม่ได้บันทึก · ล้าง dirty เมื่อวาดหน้าใหม่ (บันทึกสำเร็จ โหลดใหม่ เปลี่ยนหน้า)
  // ระหว่าง dirty/มี dialog store ไม่รวมข้อมูลของผู้อื่นเข้า data และไม่ขยับเวอร์ชันฐาน (store รู้จาก shouldHold ทั้งตอน catchUp และตอนคำตอบของการบันทึกมาถึง) การบันทึกจึงตรวจชนจากเวอร์ชันที่ฟอร์มวาดมา
  let dirty = false;
  const isEditing = () => dirty || Boolean(document.querySelectorAll("dialog[open]").length);
  const MOVE_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  // ช่องค้นหา/ตัวเลือกบทบาทสาธิตไม่นับเป็นการแก้ · ปุ่มที่เปิดหน้า/dialog หรือสั่ง action เองไม่ได้แก้ฟอร์ม (dialog นับจากการเปิดอยู่)
  const NOT_EDITING = "[data-rf-search], [data-rf-user], [data-rf-open], [data-rf-go], [data-rf-action], [data-rf-close], [data-bom-retry], [data-rf-reset], [data-bom-purge], [data-bom-audit-reload], [data-bom-rf-create], [data-bom-rf-check], [data-bom-parts-buy], [data-tree-toggle], [data-tree-pick], [data-tree-all], [data-hub-qty]";
  function markDirty(event) {
    if (!event?.isTrusted || !onBomRoute()) return;
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
  const refreshForOthers = () => {
    if (isEditing()) showToast("มีผู้อื่นอัปเดตข้อมูล BOM ข้อมูลล่าสุดจะแสดงเมื่อเปิดหน้านี้ใหม่");
    else renderRoute();
  };
  store.subscribe((event) => {
    if (!onBomRoute()) return;
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
      // held = store กันข้อมูลผู้อื่นไว้ไม่รวม (มีฟอร์มค้างตอนคำตอบมา) แจ้งด้วย event pending แล้ว
      if (event.held) return;
      if (event.others) refreshForOthers();
      else if (event.changed && !isEditing()) renderRoute();
    } else if (event.type === "pending") showToast("มีผู้อื่นบันทึกข้อมูล BOM ไปแล้ว ระบบจะรวมข้อมูลล่าสุดให้เมื่อบันทึกหรือเปิดหน้านี้ใหม่");
    else if (event.type === "synced") refreshForOthers();
    else if (event.type === "reverted" && isEditing()) updateSync(); // ข้อมูลย้อนกลับแล้ว และ runAction แจ้งข้อความไทยของข้อผิดพลาดให้แล้ว · ไม่วาดหน้าใหม่ทับสิ่งที่พิมพ์ค้างในฟอร์มอื่น
    else if (event.type !== "status") renderRoute();
  });
  // หน้ากลับมาโฟกัสขณะอยู่ที่หน้า BOM: ตามทันการบันทึกของผู้อื่น (store.catchUp วาดหน้าใหม่ผ่าน event synced เฉพาะเมื่อมีอะไรเปลี่ยน · มีฟอร์มค้างไม่รวม แค่แจ้ง)
  const catchUpOnFocus = () => {
    if (store.isRemote() && onBomRoute() && !document.hidden) store.catchUp();
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
  // เข้า #/bom เฉยๆ (ไม่มี p): หน้าแรกของบทบาท (สินค้า หรือ งานของฉัน) · หน้าภาพรวมเดิมไม่อยู่ในเมนูแล้ว แต่ยังเปิดได้ด้วย p=dashboard
  const defaultPage = () => { const home = storeApi.homeOf(store.user()); return pages[home] ? home : "dashboard"; };
  const currentPage = (params) => storeApi.findModule(params.get("p") ?? defaultPage())?.id ?? null;

  // name → ค่า · name[] → อาร์เรย์ · a.b → ออบเจ็กต์ซ้อน (ค่าเป็นสตริง action แปลงเลขเอง)
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
    const keepQty = (parentCode, childCode, qty) => {
      const line = actions.helpers.approvedBomOf(data, rules.canonicalCode(parentCode))?.lines.find((entry) => entry.childCode === rules.canonicalCode(childCode));
      return line && Math.abs(Number(qty) - line.qty) <= 1e-6 ? line.qty : qty;
    };
    const toNode = (row, parentCode) => {
      const item = actions.helpers.itemOf(data, row.code);
      const node = { code: row.code, qty: keepQty(parentCode, row.code, row.qty), scrapPct: row.scrapPct, note: row.note, step: row.step, children: rows.filter((other) => other.parentId === row.id && (other.code || other.name)).map((child) => toNode(child, row.code)) };
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
    return { code: p.code, item: { name: p.itemName, uom: p.itemUom, kind: p.itemKind }, note: p.note, nodes: rows.filter((row) => !row.parentId && (row.code || row.name)).map((row) => toNode(row, p.code)) };
  }
  // เพิ่มหนึ่งบรรทัดใต้ชิ้นแม่ p.code: บรรทัดเดิมส่งกลับตามที่เก็บ (ไม่มี children จึงไม่แตะ BOM ของชิ้นลูก) · รหัสที่ยังไม่มีในทะเบียนต้องมีชื่อ ชนิด หน่วย เพื่อสร้างชิ้นใหม่
  function treeFromLineAdd(p) {
    const data = store.data();
    const code = rules.canonicalCode(p.addCode);
    const current = actions.helpers.approvedBomOf(data, rules.canonicalCode(p.code))?.lines ?? [];
    if (current.some((line) => line.childCode === code)) throw new Error(`${code} อยู่ใน BOM นี้แล้ว แก้ปริมาณที่บรรทัดนั้นแทน`);
    const node = { code, qty: p.addQty, scrapPct: p.addScrap, note: "" };
    if (!actions.helpers.itemOf(data, code)) {
      if (!String(p.newName ?? "").trim()) throw new Error(`ยังไม่มีรหัส ${code} ในทะเบียน กรอกชื่อ ชนิด และหน่วยเพื่อสร้างชิ้นใหม่`);
      node.newItem = { kind: p.newKind, name: p.newName, uom: p.newUom };
    }
    return { code: p.code, note: p.note, nodes: [...current.map((line) => ({ code: line.childCode, qty: line.qty, scrapPct: line.scrapPct ?? 0, note: line.note ?? "", step: line.step ?? "" })), node] };
  }
  const listOf = (p, key) => (Array.isArray(p[key]) ? p[key] : p[key] === undefined ? [] : [p[key]]);
  const TRANSFORMS = {
    createOrder: (p) => ({ ...p, orderedAt: rules.fromInputDate(p.orderedAt), whDue: rules.fromInputDate(p.whDue), due: dueFrom(p.due), autoDue: p.autoDue === "1" || p.autoDue === "on" }),
    // ฟอร์ม "เพิ่มส่วนประกอบ" ของหน้าสินค้า (lineAdd) ใช้คำสั่งเดียวกัน: บรรทัดเดิมของ BOM อ่านจากข้อมูลล่าสุดตอนกดบันทึก แล้วต่อบรรทัดใหม่
    saveBomTree: (p) => (p.lineAdd ? treeFromLineAdd(p) : treeFromRows(p)),
    // ฟอร์มแก้บรรทัดเดียวของ BOM (หน้าสินค้า): childCode[] + qty[] + scrapPct[] + lineNote[] + lineStep[] ของทุกบรรทัด → lines ของ saveBom
    // บรรทัดที่แก้ (editCode) ถ้าปริมาณในฟอร์มต่างจากเดิม (origQty) ไม่ถึง 1e-6 ใช้ค่าเดิม คงอัตราส่วนเช่น 1/31 ไว้เต็มความละเอียด
    saveBom: (p) => (Array.isArray(p.lines) ? p : {
      itemCode: p.itemCode, note: p.note,
      lines: listOf(p, "childCode").map((childCode, index) => {
        const qty = listOf(p, "qty")[index];
        const keep = childCode === p.editCode && p.origQty !== undefined && Math.abs(Number(qty) - Number(p.origQty)) <= 1e-6;
        return { childCode, qty: keep ? Number(p.origQty) : qty, scrapPct: listOf(p, "scrapPct")[index] ?? "", note: listOf(p, "lineNote")[index] ?? "", step: listOf(p, "lineStep")[index] ?? "" };
      }),
    }),
    saveItem: (p) => ({ ...p, rubber: p.kind === "RB" || p.kind === "SE" ? p.rubber ?? null : null }),
    // ฟอร์มชุดสี: slotKey[] + slotColor[] → slots · ฟอร์มแพ็กเกจ: childCode[] + qty[] → lines (แถวว่างถูกข้าม)
    saveColorSet: (p) => ({ ...p, slots: listOf(p, "slotKey").map((key, index) => ({ key, color: listOf(p, "slotColor")[index] ?? "" })) }),
    setStockCounts: (p) => ({ ...p, counts: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "" })) }),
    // ฟอร์มคลังของซื้อ: itemCode[] + qty[] (+ safetyQty[] ถ้าแก้สต็อกขั้นต่ำได้) ตามลำดับแถว · ช่องว่าง = ไม่แตะค่าเดิม
    countPartStock: (p) => ({ counts: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "", safetyQty: listOf(p, "safetyQty")[index] ?? "" })) }),
    // ฟอร์มคืนของเหลือ: itemCode[] + qty[] ตามลำดับแถว → lines (เฉพาะแถวที่กรอกจำนวน · เว้นว่างหรือ 0 = ไม่คืนรายการนั้น)
    returnOrderParts: (p) => ({ orderId: p.orderId, reason: p.reason, lines: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "" })).filter((line) => String(line.qty).trim() !== "" && Number(line.qty) !== 0) }),
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

  function runAction(name, payload, successText) {
    const result = store.run(name, payload);
    if (!result.ok) {
      showToast(friendlyError(result.error), "error");
      return false;
    }
    const report = () => {
      if (!store.isPersisted()) showToast("บันทึกในหน่วยความจำได้ แต่เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล (localStorage เต็มหรือปิดอยู่) รีเฟรชแล้วข้อมูลจะหาย", "error");
      else if (successText) showToast(String(successText).replaceAll("{result}", String(result.result?.summary ?? result.result ?? "")));
    };
    if (!result.saving) {
      report();
      return true;
    }
    // โหมดฐานข้อมูล: หน้าแสดงผลทันที (optimistic) แล้วแจ้งผลเมื่อฐานข้อมูลตอบ · ถ้าไม่สำเร็จ store ย้อนกลับและวาดหน้าใหม่ให้เอง
    result.saving.then((outcome) => {
      if (!outcome.ok) { showToast(friendlyError(outcome.error), "error"); return; }
      report();
      const notice = actions.helpers.rubberflowNotice(name, payload, outcome.rubberflow);
      if (notice) showToast(notice.text, notice.type);
      // WO ที่ฐานข้อมูลเปิด/ยกเลิกให้ ตามทันฝั่ง RubberFlow ให้เลข WO และหน้าของ RubberFlow เป็นปัจจุบัน
      if (outcome.rubberflow) { try { window.MNP_RUBBERFLOW?.store?.catchUp?.(); } catch { /* RubberFlow ตามทันเองตอนเปิดหน้า */ } }
      // ปล่อยผลิตแล้วเปิด WO ให้งาน RB และ/หรือมีงานของซื้อ (ST): ตรวจเคมีที่ WO เหล่านั้นต้องใช้และของซื้อของใบเทียบสต็อก ขาด = เปิด dialog สั่งซื้อ (ผู้ที่สั่งซื้อไม่ได้ไม่เห็น) · ที่เหลือแจ้งสั้นๆ ว่าพอ
      const opened = name === "releaseOrder" && Array.isArray(outcome.rubberflow?.opened) ? outcome.rubberflow.opened : [];
      const hasParts = name === "releaseOrder" && store.isRemote() && store.data().jobs.some((job) => job.orderId === payload?.orderId && actions.helpers.isPartJob(job));
      if (opened.length || hasParts) {
        try { Promise.resolve(window.MNP_RUBBERFLOW?.checkMaterials?.({ woIds: opened.map((row) => row.woId), sourcePi: payload?.orderId ?? "", skippedJobs: outcome.rubberflow?.skipped?.length ?? 0, auto: true })).catch(() => {}); } catch { /* ตรวจเคมีไม่ได้: ปุ่ม "ตรวจวัตถุดิบ" ที่ใบ PI ยังใช้ได้ */ }
      }
    });
    return true;
  }
  function parseArgs(node) {
    try { return node.dataset.rfArgs ? JSON.parse(node.dataset.rfArgs) : {}; } catch { return {}; }
  }

  function bindRoot(root, ctx) {
    root.querySelectorAll("form[data-rf-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      // ตรวจช่องเป็นภาษาไทยใต้ช่องก่อน (ฟอร์มเป็น novalidate) · action ยังตรวจกติกาของตัวเองซ้ำ
      if (!ui.validateForm(form)) return;
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
      form.closest?.("dialog")?.close?.();
      form.querySelectorAll("button").forEach((node) => { node.disabled = true; });
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
    root.querySelectorAll("form[data-rf-search]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = String(new FormData(form).get("q") ?? "").trim().slice(0, 100);
      location.hash = ctx.pageUrl({ q: q || null });
    }));
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
    const counts = navCounts(store.data(), user);
    // เมนูหลัก 4 อัน (storeApi.NAV): หน้าที่ไม่อยู่ในเมนู (สร้าง BOM นับคงคลัง ฯลฯ) ทำให้เมนูแม่ของมันเป็นตัวที่เลือกอยู่
    const parent = storeApi.NAV_PARENT[page] ?? page;
    const items = navItems(user).map((id) => `<li><a class="rf-nav-item${id === parent ? " is-active" : ""}" data-rf-mod="bom-${escapeHtml(id)}" href="${escapeHtml(url(id))}"${id === page ? ' aria-current="page"' : ""}><span class="rf-nav-ico" aria-hidden="true">${pages.icon(id)}</span><span class="rf-nav-text">${escapeHtml(storeApi.navLabel(id))}</span>${counts[id] ? `<span class="rf-nav-count" title="${escapeHtml(countTitle(id))}">${counts[id]}</span>` : ""}</a></li>`).join("");
    // เมนูข้างอยู่ใน <aside> ของ shell (ไม่ใช่ลูกของ .rf-page) จึงใส่จานสี BOM ที่ตัวเมนูเอง
    return `<div class="nav-sub rf-nav" data-module="bom"><ul class="rf-nav-list">${items}</ul></div>`;
  };
  const navItems = (user) => storeApi.NAV.filter((id) => storeApi.canSee(user, id));
  const navCounts = (data, user) => ({
    // นับเป็นการ์ดของหน้างานของฉัน: เฉพาะใบที่ปล่อยผลิตแล้ว และของซื้อของใบเดียวกันนับเป็นหนึ่ง
    work: (() => {
      if (actions.helpers.canPlan(user)) return 0;
      const live = (job) => ["released", "in_progress"].includes(data.orders.find((order) => order.id === job.orderId)?.status);
      const mine = data.jobs.filter((job) => job.status !== "done" && job.dept === user.dept && live(job));
      return mine.filter((job) => !actions.helpers.isPartJob(job)).length + new Set(mine.filter((job) => actions.helpers.isPartJob(job)).map((job) => job.orderId)).size;
    })(),
  });
  const countTitle = (id) => ({ work: "งานค้างของแผนก" })[id] ?? "";

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
    // โหมดฐานข้อมูล: ผู้ใช้คือบัญชีทดสอบที่ admin เลือกในระบบหลัก ไม่มีตัวเลือกบทบาทสาธิตและไม่มีรีเซ็ต (ข้อมูลหลักอยู่ในฐานข้อมูล)
    if (store.isRemote()) {
      return `<div class="rf-toolbar"><span class="small muted" role="status" data-bom-sync>${escapeHtml(syncText())}</span>
        <div class="rf-row"><a class="btn rf-btn secondary" href="#/rubberflow?p=orders" title="ไปที่ใบสั่งผลิตของแผนก RB ใน RubberFlow">ใบสั่งผลิต (RubberFlow)</a></div></div>`;
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
    return `<section class="card rf-card rf-login">${ui.headingWithNote(TITLE, "รุ่นทดสอบของระบบ BOM รายแผนก: ทะเบียนชิ้นงานเดียว · BOM หลายชั้นที่แต่ละแผนกเป็นเจ้าของชั้นของตนและมีฉบับแก้ไข/อนุมัติ · ใบสั่งผลิต (PI) ระเบิด BOM แล้วปล่อยเป็นงานรายแผนก · งาน RB ส่งต่อเป็นใบสั่งผลิตใน RubberFlow · นำเข้า BOM จริงจากชีต Excel ได้ที่เมนู “นำเข้าจาก Excel”")}
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
      rubberflow: () => window.MNP_RUBBERFLOW ?? null,
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

  async function renderBom(params) {
    if (!state.employee?.isSandbox) return renderNotFound();
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
    // ข้อมูลหลักอยู่ในตาราง/RPC ของ BOM ที่รับเฉพาะ admin ในโหมดทดสอบ (BOM_TEST_MODE_ONLY) ไม่แตะตารางของโมดูลอื่น
    sandbox: true,
    label: TITLE,
    palette: "bom",
    // group: หัวกลุ่ม "ทดสอบ" ในเมนูข้าง — sandboxOnly ต้องคงไว้: เห็นเฉพาะ admin ในโหมดทดสอบ
    nav: [{ path: PATH, label: "BOM รายแผนก", icon: NAV_ICON, sandboxOnly: true, group: "ทดสอบ", subnav: sidebarNav }],
    pages: { [PATH]: renderBom },
  };
})();
