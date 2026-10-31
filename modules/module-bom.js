// BOM รายแผนก — โมดูล Pilot Web ในโหมดทดสอบ (#/bom?p=<หน้า>) รุ่นทดสอบของ docs/BOM_SYSTEM_PLAN.md ก่อนขึ้นฐานข้อมูล
// โครงเดียวกับ RubberFlow: modules/bom-rules.js (กฎล้วน) · bom-actions.js (กฎธุรกิจ) · bom-seed.js (ข้อมูลสาธิต) · bom-store.js (บทบาท + localStorage) ·
// bom-pages.js (หน้าและ dialog ลงทะเบียนใน window.MNP_BOM_PAGES / _DIALOGS) · ไฟล์นี้ (shell เส้นทาง การผูก event)
// ใช้ชิ้นส่วน HTML และสไตล์ .rf-* ของ RubberFlow (window.MNP_RUBBERFLOW_UI) จึงใช้กติกา event ชื่อเดียวกัน (data-rf-form / data-rf-action / data-rf-open / data-rf-go)
// แต่ผูกกับ store ของ BOM เท่านั้น — ข้อมูลอยู่ใน localStorage (คีย์ mnp-bom-v1) ไม่แตะฐานข้อมูล จึงไม่มี migration/RPC
// "ทำหน้าที่เป็น" คือบทบาทสาธิต 8 คน ใช้ซ่อน/แสดงเมนูและปุ่มเท่านั้น ไม่ใช่การควบคุมสิทธิ์ของระบบจริง หน้า #/bom ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, app, shell, bindShell, renderNotFound, escapeHtml, showToast,
// friendlyError, renderRoute, currentRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerBomModule() {
  const PATH = "bom";
  const TITLE = "BOM รายแผนก";
  const SUBTITLE = "item master · BOM หลายชั้น · ใบสั่งผลิต · งานรายแผนก (รุ่นทดสอบ)";
  const THEME = ["#3f51b5", "#283593"];
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
  const store = storeApi.createStore({ storage, seed: () => seed.buildSeed(Date.now()), actions });
  window.MNP_BOM = { store, PATH, url, context: (params) => makeContext(params) };

  function url(page = "dashboard", extra = {}) {
    const query = new URLSearchParams();
    if (page && page !== "dashboard") query.set("p", page);
    for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
    const text = query.toString();
    return `#/${PATH}${text ? `?${text}` : ""}`;
  }
  const currentPage = (params) => storeApi.findModule(params.get("p") ?? "dashboard")?.id ?? null;

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
    return { code: p.code, item: { name: p.itemName, uom: p.itemUom }, note: p.note, nodes: rows.filter((row) => !row.parentId && (row.code || row.name)).map((row) => toNode(row, p.code)) };
  }
  const listOf = (p, key) => (Array.isArray(p[key]) ? p[key] : p[key] === undefined ? [] : [p[key]]);
  const TRANSFORMS = {
    createOrder: (p) => ({ ...p, orderedAt: rules.fromInputDate(p.orderedAt), whDue: rules.fromInputDate(p.whDue), due: dueFrom(p.due), autoDue: p.autoDue === "1" || p.autoDue === "on" }),
    saveBomTree: treeFromRows,
    saveItem: (p) => ({ ...p, rubber: p.kind === "RB" || p.kind === "SE" ? p.rubber ?? null : null }),
    // ฟอร์มชุดสี: slotKey[] + slotColor[] → slots · ฟอร์มแพ็กเกจ: childCode[] + qty[] → lines (แถวว่างถูกข้าม)
    saveColorSet: (p) => ({ ...p, slots: listOf(p, "slotKey").map((key, index) => ({ key, color: listOf(p, "slotColor")[index] ?? "" })) }),
    setStockCounts: (p) => ({ ...p, counts: listOf(p, "itemCode").map((itemCode, index) => ({ itemCode, qty: listOf(p, "qty")[index] ?? "" })) }),
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
    if (!store.isPersisted()) showToast("บันทึกในหน่วยความจำได้ แต่เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล (localStorage เต็มหรือปิดอยู่) รีเฟรชแล้วข้อมูลจะหาย", "error");
    else if (successText) showToast(String(successText).replaceAll("{result}", String(result.result?.summary ?? result.result ?? "")));
    return true;
  }
  function parseArgs(node) {
    try { return node.dataset.rfArgs ? JSON.parse(node.dataset.rfArgs) : {}; } catch { return {}; }
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
      form.closest?.("dialog")?.close?.();
      form.querySelectorAll("button").forEach((node) => { node.disabled = true; });
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
    const counts = navCounts(store.data(), user);
    const groups = storeApi.GROUPS.map((group) => {
      const items = storeApi.MODULES.filter((entry) => entry.group === group && storeApi.canSee(user, entry.id));
      if (!items.length) return "";
      return `<li class="rf-nav-group"><span>${escapeHtml(group)}</span><ul>${items.map((entry) => `<li><a class="rf-nav-item${entry.id === page ? " is-active" : ""}" data-rf-mod="bom-${escapeHtml(entry.id)}" href="${escapeHtml(url(entry.id))}"${entry.id === page ? ' aria-current="page"' : ""}><span class="rf-nav-ico" aria-hidden="true">${pages.icon(entry.id)}</span><span class="rf-nav-text">${escapeHtml(entry.label)}</span>${counts[entry.id] ? `<span class="rf-nav-count" title="${escapeHtml(countTitle(entry.id))}">${counts[entry.id]}</span>` : ""}</a></li>`).join("")}</ul></li>`;
    }).join("");
    return `<div class="nav-sub rf-nav"><ul class="rf-nav-list">${groups}</ul></div>`;
  };
  const navCounts = (data, user) => ({
    jobs: data.jobs.filter((job) => job.status !== "done" && (actions.helpers.isBoss(user) ? false : job.dept === user.dept || (job.dept === "PK" && user.role === "planner"))).length,
  });
  const countTitle = (id) => ({ jobs: "งานค้างของแผนก" })[id] ?? "";

  function toolbarHtml(ctx) {
    const { data, user } = ctx;
    const options = data.users.map((row) => ({ value: row.id, label: `${storeApi.ROLES[row.role]?.label ?? row.role} · ${row.name}` }));
    return `<div class="rf-toolbar">
        <label class="rf-persona"><span>บทบาทสาธิต</span>${ui.select("user", options, { value: user?.id ?? "", placeholder: user ? null : "เลือกบทบาทสาธิต…", extra: "data-rf-user" })}</label>
        <div class="rf-row">
          <a class="btn rf-btn secondary" href="#/rubberflow?p=orders" title="เปิด RubberFlow (ใบสั่งผลิตของแผนก RB)">RubberFlow ↗</a>
          <button class="btn rf-btn secondary" type="button" data-rf-reset title="ล้างข้อมูลที่บันทึกในเบราว์เซอร์นี้ (รวมที่นำเข้าจาก Excel) แล้วสร้างข้อมูลสาธิตใหม่">รีเซ็ตข้อมูลสาธิต</button>
        </div>
      </div>`;
  }
  function chooserHtml(data) {
    const roles = data.users.map((row) => `<button class="rf-role" type="button" data-rf-user-pick="${escapeHtml(row.id)}"><strong>${escapeHtml(storeApi.ROLES[row.role]?.label ?? row.role)}</strong><span class="muted">${escapeHtml(row.name)}</span></button>`).join("");
    return `<section class="card rf-card rf-login"><h1>เลือกบทบาทสาธิต</h1>
      <p class="muted">รุ่นทดสอบของระบบ BOM รายแผนก: item master เดียว · BOM หลายชั้นที่แต่ละแผนกเป็นเจ้าของชั้นของตนและมี revision/อนุมัติ · ใบสั่งผลิต (PI) ระเบิด BOM แล้วปล่อยเป็นงานรายแผนก · งาน RB ส่งต่อเป็นใบสั่งผลิตใน RubberFlow ข้อมูลเป็นข้อมูลสมมติ เก็บในเบราว์เซอร์นี้เท่านั้น (นำเข้า BOM จริงจากชีต Excel ได้ที่เมนู “นำเข้าจาก Excel”)</p>
      <div class="rf-role-grid">${roles}</div></section>`;
  }
  function deniedHtml(user) {
    return `<section class="card rf-card"><h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1><p class="muted">บทบาท “${escapeHtml(storeApi.ROLES[user.role]?.label ?? user.role)}” เข้าถึงได้เฉพาะเมนูที่แสดงในแถบข้าง</p>
      <div class="rf-row"><a class="btn rf-btn" href="${escapeHtml(url(storeApi.homeOf(user)))}">กลับหน้าหลัก</a></div></section>`;
  }
  function pageNavHtml(user, page) {
    const items = storeApi.MODULES.filter((entry) => storeApi.canSee(user, entry.id));
    return `<nav class="rf-pagenav" aria-label="เมนู BOM">${items.map((entry) => `<a class="filter${entry.id === page ? " active" : ""}" href="${escapeHtml(url(entry.id))}">${escapeHtml(entry.label)}</a>`).join("")}</nav>`;
  }

  function makeContext(params) {
    const data = store.data();
    const user = store.user();
    const page = currentPage(params);
    return {
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
    root.querySelector("[data-rf-reset]")?.addEventListener("click", () => {
      if (!confirm("ล้างข้อมูลที่บันทึกทั้งหมด (รวมที่นำเข้าจาก Excel) แล้วสร้างข้อมูลสาธิตใหม่?")) return;
      store.reset();
      showToast("รีเซ็ตข้อมูลสาธิตเรียบร้อย");
      renderRoute();
    });
  }

  async function renderBom(params) {
    if (!state.employee?.isSandbox) return renderNotFound();
    const ctx = makeContext(params);
    const { user, page } = ctx;
    const entry = page ? storeApi.findModule(page) : null;
    ui.module = ""; // ไอคอนหน้าชื่อหน้าใส่เองใน pages (ไอคอนของ RubberFlow ไม่ตรงกับหน้า BOM)
    const title = entry && user ? `${TITLE} / ${entry.label}` : TITLE;
    let body;
    let bind = null;
    if (!user) body = chooserHtml(ctx.data);
    else if (!entry) {
      location.hash = url(storeApi.homeOf(user));
      return undefined;
    } else if (!storeApi.canSee(user, page)) body = deniedHtml(user);
    else {
      const render = pages[page];
      const built = render ? render(ctx) : { html: ui.card(ui.empty("หน้านี้ยังไม่พร้อม")) };
      body = `${pageNavHtml(user, page)}${built.html}`;
      bind = built.bind ?? null;
    }
    const head = `<header class="rf-head"><div class="rf-head-main"><div class="rf-title"><span class="rf-brand" aria-hidden="true">BOM</span><strong class="rf-app-name">${escapeHtml(TITLE)}</strong></div><p class="rf-sub">${escapeHtml(SUBTITLE)}</p></div></header>`;
    app.innerHTML = shell(`<div class="rf-page bom-page" data-rf-mod="${escapeHtml(entry && user ? `bom-${page}` : "")}">${head}${user ? toolbarHtml(ctx) : ""}${body}</div>`, PATH, title);
    bindShell();
    const root = document.querySelector(".content");
    bindPage(root, ctx);
    bind?.(root, ctx);
    return undefined;
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.BOM = {
    code: "BOM",
    enabled: true,
    standalone: true,
    // ไม่แตะฐานข้อมูล: ข้อมูลสาธิตอยู่ใน localStorage จึงเปิดในโหมดทดสอบได้โดยไม่ต้องทำกติกา 5 ข้อของตารางโหมดทดสอบ
    sandbox: true,
    label: TITLE,
    theme: THEME,
    nav: [{ path: PATH, label: "BOM รายแผนก", icon: NAV_ICON, sandboxOnly: true, subnav: sidebarNav }],
    pages: { [PATH]: renderBom },
  };
})();
