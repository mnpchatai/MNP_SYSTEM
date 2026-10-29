// RubberFlow MES — โมดูล "แผนก RB" ของ Pilot Web ในโหมดทดสอบ (#/rubberflow?p=<หน้า>) ยกต้นแบบ prototypes/rubber-mes มาทั้งโปรเจค
// (ฟังก์ชันและ UI ทั้ง 15 หน้า) เป็น script ธรรมดา ไม่ใช้ React
//
// โครง: modules/rubberflow-rules.js (สเปก/สูตร) · rubberflow-actions.js (กฎธุรกิจ) · rubberflow-seed.js (ข้อมูลสาธิต) ·
// rubberflow-derive.js (แจ้งเตือน/ค้นหา/สืบย้อน) · rubberflow-store.js (บทบาทสาธิต + localStorage) · rubberflow-ui.js (ชิ้นส่วน HTML) ·
// rubberflow-pages-*.js และ rubberflow-documents.js (หน้าและ dialog ลงทะเบียนใน window.MNP_RUBBERFLOW_PAGES / _DIALOGS) · ไฟล์นี้ (shell เส้นทาง การผูก event)
//
// ข้อมูลอยู่ใน localStorage ของเบราว์เซอร์ (ข้อมูลสมมติ เหมือนต้นแบบ) ไม่แตะฐานข้อมูล จึงไม่มี migration/RPC "ทำหน้าที่เป็น" คือบทบาทสาธิต 9 คน
// ของต้นแบบ ใช้ซ่อน/แสดงเมนูเท่านั้น ไม่ใช่การควบคุมสิทธิ์ของระบบจริง — หน้า #/rubberflow ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
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
// escapeHtml, showToast, friendlyError, renderRoute, currentRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerRubberFlowModule() {
  const PATH = "rubberflow";
  const TITLE = "RubberFlow MES";
  const SUBTITLE = "แผนก RB · ระบบควบคุมการผลิตยาง";
  const THEME = ["#0f766e", "#115e59"];
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
  const store = storeApi.createStore({ storage, seed: () => seed.buildSeed(Date.now()), actions });
  // context(params) ให้เทสต์เรียก dialog ด้วย ctx เดียวกับหน้า
  window.MNP_RUBBERFLOW = { store, PATH, url, context: (params) => makeContext(params) };

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

  // ฟอร์มบางอันส่งค่าที่ action ต้องการคนละรูปแบบ (วันที่เป็น ms, รายการวัตถุดิบ, ตัวเลือกใช่/ไม่ใช่)
  const TRANSFORMS = {
    createOrder: (p) => ({ ...p, startDate: rules.fromInputDate(p.startDate), dueDate: rules.fromInputDate(p.dueDate) }),
    receiveMaterial: (p) => ({ ...p, expiry: rules.fromInputDate(p.expiry), coa: p.coa === "yes" }),
    createRecipe: (p) => ({ ...p, items: (p.materialCode ?? []).map((materialCode, index) => ({ materialCode, phr: (p.phr ?? [])[index] })) }),
    weighLine: (p) => ({ ...p, index: Number(p.index) }),
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
    if (!store.isPersisted()) showToast("บันทึกในหน่วยความจำได้ แต่เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล (localStorage) รีเฟรชแล้วข้อมูลจะหาย", "error");
    else if (successText) showToast(String(successText).replaceAll("{result}", String(result.result ?? "")));
    return true;
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
    root.querySelectorAll("[data-rf-action]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.rfConfirm && !confirm(button.dataset.rfConfirm)) return;
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
      return `<li class="rf-nav-group"><span>${escapeHtml(group)}</span><ul>${items.map((entry) => `<li><a class="rf-nav-item${entry.id === page ? " is-active" : ""}" href="${escapeHtml(url(entry.id))}"${entry.id === page ? ' aria-current="page"' : ""}>${escapeHtml(entry.label)}${counts[entry.id] ? `<span class="rf-nav-count" title="${escapeHtml(countTitle(entry.id))}">${counts[entry.id]}</span>` : ""}</a></li>`).join("")}</ul></li>`;
    }).join("");
    return `<div class="nav-sub rf-nav"><ul class="rf-nav-list">${groups}</ul></div>`;
  };
  const navCounts = (data) => ({
    wip: data.transfers.filter((transfer) => transfer.status === "in_transit").length,
    requisition: data.requisitions.filter((requisition) => requisition.status === "weighing").length,
    quality: data.lots.filter((lot) => lot.qc === "hold").length,
  });
  const countTitle = (id) => ({ wip: "ใบส่งมอบรอรับ", requisition: "ใบเบิกกำลังชั่ง", quality: "ล็อตรอตัดสิน" })[id] ?? "";

  // แถบเครื่องมือของ RubberFlow ใต้หัวหน้า: ทำหน้าที่เป็น · สแกนรหัส · แจ้งเตือน · รีเซ็ต
  function toolbarHtml(ctx) {
    const { data, user, now } = ctx;
    const alerts = derive.buildAlerts(data, now);
    const options = data.users.map((row) => ({ value: row.id, label: `${storeApi.ROLES[row.role]?.label ?? row.role} · ${row.name}` }));
    const bad = alerts.some((alert) => alert.tone === "bad");
    return `<div class="rf-toolbar">
        <label class="rf-persona"><span>บทบาทสาธิต</span>${ui.select("user", options, { value: user?.id ?? "", placeholder: user ? null : "เลือกบทบาทสาธิต…", extra: "data-rf-user" })}</label>
        <form class="rf-scan" data-rf-scan role="search"><label class="sr-only" for="rf-scan-code">สแกนหรือพิมพ์รหัส</label>${ui.input("code", { id: "rf-scan-code", placeholder: "สแกนหรือพิมพ์รหัส: ล็อต กล่อง ใบสั่งผลิต ล็อตวัตถุดิบ…", type: "search" })}<button class="btn rf-btn secondary" type="submit">ค้นหา</button></form>
        <div class="rf-row">
          ${ui.openButton(`แจ้งเตือน${alerts.length ? ` (${alerts.length})` : ""}`, "alerts", {}, { className: `secondary rf-alerts-btn${bad ? " is-bad" : alerts.length ? " is-warn" : ""}` })}
          <button class="btn rf-btn secondary" type="button" data-rf-reset title="ล้างข้อมูลที่บันทึกในเบราว์เซอร์นี้แล้วสร้างข้อมูลสาธิตใหม่">รีเซ็ตข้อมูลสาธิต</button>
        </div>
      </div>`;
  }

  // ไม่ได้เลือกบทบาท: ตารางบทบาทสาธิต 9 คน (หน้า Login ของต้นแบบ โดยไม่มีรหัสผ่าน เพราะผู้ใช้ล็อกอินระบบจริงแล้ว)
  function chooserHtml(data) {
    const roles = data.users.map((row) => `<button class="rf-role" type="button" data-rf-user-pick="${escapeHtml(row.id)}"><strong>${escapeHtml(storeApi.ROLES[row.role]?.label ?? row.role)}</strong><span class="muted">${escapeHtml(row.name)}</span></button>`).join("");
    return `<section class="card rf-card rf-login"><h1>เลือกบทบาทสาธิต</h1>
      <p class="muted">RubberFlow ควบคุมการผลิตยาง 4 สถานี ผสม → รีด → อบ → ตกแต่ง พร้อม FEFO, ชั่งแบบ Poka-Yoke, QC Hold อัตโนมัติ, Gatekeeper ส่งมอบ WIP และสืบย้อนกลับถึงล็อตวัตถุดิบ ข้อมูลทั้งหมดเป็นข้อมูลสมมติ เก็บในเบราว์เซอร์นี้เท่านั้น</p>
      <div class="rf-role-grid">${roles}</div></section>`;
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
    const now = Date.now();
    const page = currentPage(params);
    return {
      data, user, now, params, page,
      q: String(params.get("q") ?? "").trim().slice(0, 100),
      url,
      pageUrl: (extra = {}) => url(page ?? "dashboard", { ...Object.fromEntries([...params.entries()].filter(([key]) => key !== "p")), ...extra }),
      ui, rules, derive, actions, store,
      can: (permission) => storeApi.can(user, permission),
      canSee: (id) => storeApi.canSee(user, id),
      roleLabel: (role) => storeApi.ROLES[role]?.label ?? role,
    };
  }

  function bindPage(root, ctx) {
    bindRoot(root, ctx);
    root.querySelector("[data-rf-user]")?.addEventListener("change", (event) => {
      const user = store.setUser(event.target.value);
      const page = ctx.page ?? "dashboard";
      if (user && !storeApi.canSee(user, page)) location.hash = url(storeApi.homeOf(user));
      else renderRoute();
    });
    root.querySelectorAll("[data-rf-user-pick]").forEach((button) => button.addEventListener("click", () => {
      const user = store.setUser(button.dataset.rfUserPick);
      location.hash = url(storeApi.homeOf(user));
      renderRoute();
    }));
    root.querySelector("[data-rf-scan]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = String(new FormData(event.currentTarget).get("code") ?? "").trim().slice(0, 60);
      event.currentTarget.reset();
      openDialog("scan", { code }, ctx);
    });
    root.querySelector("[data-rf-reset]")?.addEventListener("click", () => {
      if (!confirm("ล้างข้อมูลที่บันทึกทั้งหมดแล้วสร้างข้อมูลสาธิตใหม่?")) return;
      store.reset();
      showToast("รีเซ็ตข้อมูลสาธิตเรียบร้อย");
      renderRoute();
    });
  }

  async function renderRubberFlow(params) {
    if (!state.employee?.isSandbox) return renderNotFound();
    const ctx = makeContext(params);
    const { user, page } = ctx;
    const entry = page ? storeApi.findModule(page) : null;
    const title = entry && user ? `${TITLE} / ${entry.label}` : TITLE;
    let body;
    let bind = null;
    if (!user) body = chooserHtml(ctx.data);
    else if (!entry) {
      // หน้าไม่รู้จัก → หน้าแรกของบทบาท (ไม่แสดงหน้าว่าง)
      location.hash = url(storeApi.homeOf(user));
      return undefined;
    } else if (!storeApi.canSee(user, page)) body = deniedHtml(user);
    else {
      const render = pages[page];
      const built = render ? render(ctx) : { html: ui.card(ui.empty("หน้านี้ยังไม่พร้อม")) };
      body = `${pageNavHtml(user, page)}${built.html}`;
      bind = built.bind ?? null;
    }
    const head = `<header class="rf-head"><div class="rf-head-main"><div class="rf-title"><span class="rf-brand" aria-hidden="true">RB</span><strong class="rf-app-name">${escapeHtml(TITLE)}</strong></div><p class="rf-sub">${escapeHtml(SUBTITLE)}</p></div></header>`;
    app.innerHTML = shell(`<div class="rf-page">${head}${user ? toolbarHtml(ctx) : ""}${body}</div>`, PATH, title);
    bindShell();
    const root = document.querySelector(".content");
    bindPage(root, ctx);
    bind?.(root, ctx);
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
  window.setInterval(() => {
    if (document.hidden || !location.hash.startsWith(`#/${PATH}`) || !state.employee?.isSandbox) return;
    if (document.querySelector("dialog[open]")) return;
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
    if (hasDraft()) return;
    renderRoute();
  }, 60000);

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.RUBBERFLOW = {
    code: "RUBBERFLOW",
    enabled: true,
    standalone: true,
    // ไม่แตะฐานข้อมูล: ข้อมูลสาธิตอยู่ใน localStorage ของเบราว์เซอร์ จึงเปิดในโหมดทดสอบได้โดยไม่ต้องทำกติกา 5 ข้อของตาราง
    sandbox: true,
    label: TITLE,
    theme: THEME,
    nav: [{ path: PATH, label: "RubberFlow (แผนก RB)", icon: NAV_ICON, sandboxOnly: true, subnav: sidebarNav }],
    pages: { [PATH]: renderRubberFlow },
  };
})();
