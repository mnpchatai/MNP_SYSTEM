// ทะเบียนอุปกรณ์ IT (itas) — HTML ของหน้าต่าง ๆ เป็นสตริงล้วน ไม่มี DOM/Supabase/Web Crypto (เทสต์ที่ scripts/tests/itas-pages.test.mjs)
// การเชื่อมต่อ (เรียก RPC ผูกปุ่ม ตู้เซฟ) อยู่ที่ modules/module-itas.js · ข้อมูลล้วน/กติกาอยู่ที่ modules/itas-model.js · เข้ารหัสอยู่ที่ modules/itas-vault.js
// หน้าตาใช้คอมโพเนนต์เดิมของ Pilot: หัวโมดูล .request-module-header (data-module="it") · ฟอร์ม .field/.input · ปุ่ม .btn · ป้าย .badge · ตารางเลื่อนในกล่องของตัวเอง
//
// กฎความปลอดภัยของไฟล์นี้: ทุกค่าที่แสดงผ่าน esc() · ไม่มีค่าลับ/รหัส/กุญแจในไฟล์นี้เลย (ช่องลับแสดงเป็น "••••" เท่านั้น ค่าที่ถอดแล้ว module ใส่ด้วย textContent)
// ไม่ใส่ค่าที่ผู้ใช้พิมพ์ลงใน data-* attribute นอกจากรหัส/คีย์ของข้อมูลที่ไม่ลับ (รหัสชนิด key ของช่อง uuid)
(function (root) {
  "use strict";

  const model = root.MNP_ITAS_MODEL;
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const iconOf = (name) => root.MNP_UI_ICONS?.icon(name) ?? "";
  const REQUIRED = '<span class="field-required">(จำเป็น)</span>';
  const PALETTE = "it";
  const TITLE = "ทะเบียนอุปกรณ์ IT";
  const MASK = "••••••••";

  const emptyBlock = (text, hint = "") => (typeof emptyState === "function"
    ? emptyState(text, { hint })
    : `<div class="empty"><p>${esc(text)}</p>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`);
  // ไอคอนเส้นต่อชนิด (path จาก model.TYPE_ICON_PATHS ไม่มีข้อมูลผู้ใช้) · ป้ายหมวดสี: ชิ้นส่วนภายใน = ม่วง, อุปกรณ์ต่อพ่วง = เขียวอมฟ้า, เครื่องคอมพิวเตอร์ = น้ำเงิน
  const glyph = (code) => `<svg class="ui-icon itas-glyph" viewBox="0 0 24 24" aria-hidden="true">${model.typeIconPaths(code)}</svg>`;
  // ป้ายชนิดในตารางใช้ชื่อสั้น (model.typeShortName) ชื่อเต็มอยู่ใน title
  const kindPill = (code, label) => `<span class="itas-kind is-${esc(model.typeKind(code))}" title="${esc(label)}">${glyph(code)}<span>${esc(model.typeShortName(label))}</span></span>`;
  // ป้ายสถานะ: ใช้งาน เขียว · สำรอง ฟ้า · ชำรุด แดง · ยกเลิกใช้งาน เทา (สีมาจากโทนใน model ไม่ใช่คลาส badge เดิมที่ใช้สีผิดความหมาย)
  // แถวของชนิดสิ้นเปลือง (หมึก/โทนเนอร์) ไม่มีป้ายสถานะ: แสดง "ซื้อ วว/ดด/ปปปป" หรือว่าง
  const rowStatusPill = (row) => (model.isConsumableType(row?.type_code) ? esc(model.consumablePurchaseText(row)) : statusPill(row?.status));
  const statusPill = (status) => `<span class="badge itas-status is-${esc(model.statusTone(status))}">${esc(model.statusLabel(status))}</span>`;
  const testTag = (isTest) => (isTest ? '<span class="badge itas-test-tag" title="ข้อมูลทดสอบ แยกจากระบบจริง">ทดสอบ</span>' : "");

  /* ---------- หัวหน้า / เปลือกหน้า ---------- */
  function head({ title = TITLE, isTest = false, actions = "" } = {}) {
    return `<a class="request-back-link" href="#/office?module=it-support">‹ IT SUPPORT</a>
      <div class="page-heading request-module-header itas-head" data-module="${PALETTE}">
        <div class="request-module-title"><span class="type-card-badge">${iconOf("box")}</span><h1>${esc(title)}</h1>${testTag(isTest)}</div>
        ${actions ? `<div class="request-create-entry">${actions}</div>` : ""}
      </div>`;
  }
  // เลขเวอร์ชันท้ายหน้า ชิดขวา (ไม่พิมพ์) · แถบ "กำลังพัฒนา" ผูกกับธง IN_DEVELOPMENT ใน itas-model.js (ข้อความอย่างเดียว ไม่ปิดกั้นการใช้งาน)
  const versionTag = () => `<p class="itas-version no-print" title="${esc(TITLE)} เวอร์ชัน ${esc(model.MODULE_VERSION)} · อัปเดต ${esc(model.formatDate(model.VERSION_DATE))}">V${esc(model.MODULE_VERSION)}</p>`;
  const DEV_NOTICE = "ระบบทะเบียนอุปกรณ์ IT กำลังพัฒนาและทดสอบ ยังไม่เปิดใช้งานจริง";
  const devNotice = () => (model.IN_DEVELOPMENT ? `<p class="rf-callout is-warn itas-dev-notice no-print" role="status">${DEV_NOTICE}</p>` : "");
  const page = (inner) => `<div class="itas-page" data-module="${PALETTE}">${devNotice()}${inner}${versionTag()}</div>`;
  // กล่องข้อความผิดพลาดใต้หัวฟอร์ม (escape ทุกครั้ง) · reload = มีปุ่ม "โหลดข้อมูลล่าสุด" (แก้ชนกัน)
  const messageBox = (message, { reload = false } = {}) => `<div class="form-message error" role="alert">${esc(message)}${reload ? ' <button type="button" class="btn secondary small" id="itas-reload-asset">โหลดข้อมูลล่าสุด</button>' : ""}</div>`;
  const errorCard = (message, { retry = true } = {}) => `<section class="card"><div class="form-message error" role="alert">${esc(message)}</div>${retry ? '<button class="btn secondary" type="button" id="itas-retry">ลองอีกครั้ง</button>' : ""}</section>`;
  const purgeRow = () => '<div class="itas-purge-row no-print"><button class="btn danger small" type="button" id="itas-purge">ล้างข้อมูลทะเบียนอุปกรณ์ทดสอบ</button></div>';

  /* ---------- ตู้เซฟ ---------- */
  const STATUS_TEXT = Object.freeze({ unknown: "กำลังตรวจสอบ…", uninitialized: "ยังไม่ตั้ง", locked: "ล็อก", unlocked: "ปลดล็อกอยู่" });
  // แถบสถานะตู้เซฟ (แสดงตลอดในหน้าโมดูล) · snapshot = { status, isTest }
  function vaultBar({ status = "unknown", isTest = null } = {}) {
    const locked = status === "locked";
    const buttons = status === "uninitialized"
      ? '<button type="button" class="btn" id="itas-vault-setup">ตั้งตู้เซฟ</button>'
      : locked ? '<button type="button" class="btn" id="itas-vault-unlock">ปลดล็อกตู้เซฟ</button>'
        : status === "unlocked" ? '<button type="button" class="btn secondary" id="itas-vault-lock">ล็อก</button><button type="button" class="btn secondary" id="itas-vault-change">เปลี่ยนรหัสตู้เซฟ</button><button type="button" class="btn secondary" id="itas-vault-recovery">ออกรหัสกู้คืนใหม่</button>'
          : "";
    const scope = isTest === true ? "ตู้เซฟทดสอบ" : "ตู้เซฟ";
    return `<div class="itas-vault-bar is-${esc(status)}" role="status">
        <span class="itas-vault-state">${iconOf("lock")} <strong>${esc(scope)}:</strong> ${esc(STATUS_TEXT[status] ?? STATUS_TEXT.unknown)}</span>
        <span class="itas-vault-note muted small">${status === "unlocked" ? "ล็อกเองเมื่อไม่ใช้งาน 10 นาที หรือเมื่อออกจากหน้านี้" : "ช่องลับ (รหัสผ่าน/License key/IP) เก็บแบบเข้ารหัสในเบราว์เซอร์ ปลดล็อกจึงจะดูและแก้ได้"}</span>
        <span class="itas-vault-actions">${buttons}</span>
      </div>`;
  }
  // ชุดแอตทริบิวต์ของช่องรหัส/ค่าลับทุกช่อง: ไม่ให้เบราว์เซอร์/ตัวจัดการรหัสผ่านเติมหรือเสนอเก็บ (autocomplete=off + data-lpignore ของ LastPass + data-1p-ignore ของ 1Password + data-form-type=other ของ Dashlane/Bitwarden) และไม่ให้แก้/เติมคำอัตโนมัติ
  // markup ตั้งต้นเป็น type=password (ปิดบังแน่นอนแม้สคริปต์ไม่ทำงาน) · module เปลี่ยนเป็น type=text + CSS .itas-mask เมื่อเบราว์เซอร์รองรับ -webkit-text-security เพื่อไม่ให้ถูกเสนอ "บันทึกรหัสผ่าน" (ดู hardenSecretInputs ใน module-itas.js)
  const NO_AUTOFILL = 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other"';
  const secretInput = ({ id, name, label, hint = "" }) => `<div class="field" data-field="${esc(name)}"><label for="${esc(id)}">${esc(label)}</label><input class="input" id="${esc(id)}" name="${esc(name)}" type="password" ${NO_AUTOFILL} data-vault-input data-mask>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`;
  const vaultCard = (title, body) => `<section class="card itas-vault-card" id="itas-vault-card" aria-labelledby="itas-vault-title"><h2 id="itas-vault-title">${esc(title)}</h2><div id="itas-vault-message" role="status"></div>${body}</section>`;
  const busyLine = '<p class="muted small itas-busy" id="itas-vault-busy" role="status" hidden>กำลังคำนวณกุญแจ… อาจใช้เวลาไม่กี่วินาที (บนมือถือนานกว่า) อย่าปิดหน้านี้</p>';

  function vaultSetupForm({ isTest = false } = {}) {
    return vaultCard(isTest ? "ตั้งตู้เซฟทดสอบ" : "ตั้งตู้เซฟ", `
      <p class="muted small">รหัสตู้เซฟใช้ปลดล็อกช่องลับ ระบบไม่เก็บรหัสนี้ที่ใดเลย ${isTest ? "(โหมดทดสอบใช้รหัสคนละตัวกับของจริง และตู้เซฟทดสอบถูกล้างได้)" : ""}</p>
      <form id="itas-vault-setup-form" novalidate autocomplete="off">
        ${secretInput({ id: "itas-vault-pass", name: "password", label: `รหัสตู้เซฟ (อย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร)`, hint: model.PASSWORD_ADVICE })}
        <p class="itas-strength muted small" id="itas-vault-strength" aria-live="polite"></p>
        ${secretInput({ id: "itas-vault-pass2", name: "password2", label: "พิมพ์รหัสตู้เซฟอีกครั้ง" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ต่อไป: สร้างรหัสกู้คืน</button></div>
      </form>`);
  }
  // แสดงรหัสกู้คืนครั้งเดียว + บังคับพิมพ์กลับเข้ามาเพื่อยืนยันว่าจดแล้ว · mode = "setup" | "recovery" (ออกรหัสใหม่)
  function recoveryShow({ code, mode = "setup" } = {}) {
    const submit = mode === "setup" ? "ยืนยันและตั้งตู้เซฟ" : "ยืนยันและเปลี่ยนรหัสกู้คืน";
    return vaultCard(mode === "setup" ? "จดรหัสกู้คืน" : "รหัสกู้คืนใหม่", `
      <p class="form-message warning" role="alert">รหัสกู้คืนนี้แสดงครั้งเดียว ระบบไม่เก็บไว้ · จดด้วยมือลงกระดาษแล้วเก็บในที่ปลอดภัย (ไม่ใช่ในเครื่องนี้ และไม่ควรคัดลอกหรือถ่ายภาพหน้าจอเก็บไว้) · ถ้าลืมรหัสตู้เซฟและทำรหัสกู้คืนหาย จะกู้ข้อมูลลับไม่ได้อีก</p>
      <p class="itas-recovery-code" id="itas-recovery-code" translate="no" aria-label="รหัสกู้คืน">${esc(code)}</p>
      <form id="itas-recovery-form" novalidate autocomplete="off">
        <div class="field" data-field="typed"><label for="itas-recovery-typed">พิมพ์รหัสกู้คืนกลับเข้ามาเพื่อยืนยันว่าจดแล้ว ${REQUIRED}</label><input class="input" id="itas-recovery-typed" name="typed" type="text" ${NO_AUTOFILL.replace('autocapitalize="off"', 'autocapitalize="characters"')} data-vault-input placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"></div>
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">${submit}</button></div>
      </form>`);
  }
  function unlockForm({ isTest = false } = {}) {
    return vaultCard(isTest ? "ปลดล็อกตู้เซฟทดสอบ" : "ปลดล็อกตู้เซฟ", `
      <form id="itas-vault-unlock-form" novalidate autocomplete="off">
        ${secretInput({ id: "itas-vault-pass", name: "password", label: "รหัสตู้เซฟ" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ปลดล็อก</button><button type="button" class="btn secondary" id="itas-vault-forgot">ลืมรหัส ใช้รหัสกู้คืน</button></div>
      </form>`);
  }
  // ลืมรหัสตู้เซฟ: รหัสกู้คืน + ตั้งรหัสตู้เซฟใหม่ (บังคับตั้งใหม่หลังใช้รหัสกู้คืน)
  function forgotForm() {
    return vaultCard("ปลดล็อกด้วยรหัสกู้คืน", `
      <p class="muted small">ใช้รหัสกู้คืนที่จดไว้ แล้วตั้งรหัสตู้เซฟใหม่ (รหัสกู้คืนเดิมยังใช้ได้อยู่)</p>
      <form id="itas-vault-forgot-form" novalidate autocomplete="off">
        <div class="field" data-field="recovery"><label for="itas-vault-code">รหัสกู้คืน ${REQUIRED}</label><input class="input" id="itas-vault-code" name="recovery" type="text" ${NO_AUTOFILL.replace('autocapitalize="off"', 'autocapitalize="characters"')} data-vault-input></div>
        ${secretInput({ id: "itas-vault-pass", name: "password", label: `รหัสตู้เซฟใหม่ (อย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร)`, hint: model.PASSWORD_ADVICE })}
        <p class="itas-strength muted small" id="itas-vault-strength" aria-live="polite"></p>
        ${secretInput({ id: "itas-vault-pass2", name: "password2", label: "พิมพ์รหัสตู้เซฟใหม่อีกครั้ง" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ปลดล็อกและตั้งรหัสใหม่</button></div>
      </form>`);
  }
  // เปลี่ยนรหัสตู้เซฟ: ต้องกรอกรหัสปัจจุบันซ้ำทุกครั้ง (ไม่ใช้กุญแจที่ปลดล็อกค้างอยู่)
  function changeForm() {
    return vaultCard("เปลี่ยนรหัสตู้เซฟ", `
      <p class="muted small">ข้อมูลลับที่เก็บไว้ไม่ต้องเข้ารหัสใหม่ · ต้องกรอกรหัสตู้เซฟปัจจุบันอีกครั้งเพื่อยืนยัน</p>
      <form id="itas-vault-change-form" novalidate autocomplete="off">
        ${secretInput({ id: "itas-vault-current", name: "current", label: "รหัสตู้เซฟปัจจุบัน" })}
        ${secretInput({ id: "itas-vault-pass", name: "password", label: `รหัสตู้เซฟใหม่ (อย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร)`, hint: model.PASSWORD_ADVICE })}
        <p class="itas-strength muted small" id="itas-vault-strength" aria-live="polite"></p>
        ${secretInput({ id: "itas-vault-pass2", name: "password2", label: "พิมพ์รหัสตู้เซฟใหม่อีกครั้ง" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">เปลี่ยนรหัสตู้เซฟ</button></div>
      </form>`);
  }
  function newRecoveryForm() {
    return vaultCard("ออกรหัสกู้คืนใหม่", `
      <p class="muted small">รหัสกู้คืนเดิมจะใช้ไม่ได้อีก · ต้องกรอกรหัสตู้เซฟปัจจุบันเพื่อยืนยัน</p>
      <form id="itas-vault-recovery-form" novalidate autocomplete="off">
        ${secretInput({ id: "itas-vault-current", name: "current", label: "รหัสตู้เซฟปัจจุบัน" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ต่อไป: สร้างรหัสกู้คืนใหม่</button></div>
      </form>`);
  }
  // ตัววัดความแข็งแรงของรหัส (ข้อความเท่านั้น) · strength จาก model.passwordStrength
  const strengthText = (strength) => (strength?.label ? `ความแข็งแรง: ${strength.label}` : "");

  /* ---------- รายการชนิด + ตารางทะเบียน ---------- */
  // แถบกรองชนิดแบบชิปเล็ก ๆ (มือถือเลื่อนแนวนอนในแถบเอง): "ทั้งหมด" + ชนิดที่มีของ + ปุ่ม "ชนิดอื่นๆ" ที่พับชนิดว่างไว้ (กดแล้วขยาย)
  // total = จำนวนอุปกรณ์ทั้งหมด · showEmpty = ขยายชนิดว่างอยู่ · ชนิดที่เลือกอยู่แล้วว่างจะขยายให้เองโดย module
  function typeChips({ types, selectedCode = "", total = 0, showEmpty = false } = {}) {
    const { used, empty } = model.typeChipGroups(types);
    const chip = (code, label, count, { off = false, short = false } = {}) => {
      const selected = code === selectedCode;
      const kind = code ? ` is-${esc(model.typeKind(code))}` : "";
      return `<button type="button" class="itas-chip${kind}${selected ? " is-selected" : ""}${off ? " is-off" : ""}" data-itas-type="${esc(code)}" aria-pressed="${selected ? "true" : "false"}"${short ? ` title="${esc(label)}"` : ""}>${code ? glyph(code) : ""}<span class="itas-chip-name">${esc(short ? model.typeShortName(label) : label)}</span><span class="itas-chip-count" aria-label="${esc(String(count))} รายการ">${esc(String(count))}</span></button>`;
    };
    const typeChip = (type) => chip(type.code, type.name, type.asset_count ?? 0, { off: type.is_active === false, short: true });
    const more = empty.length
      ? `<button type="button" class="itas-chip itas-chip-more" id="itas-types-more" aria-expanded="${showEmpty ? "true" : "false"}">ชนิดอื่นๆ (${empty.length}) ${showEmpty ? "▴" : "▾"}</button>${showEmpty ? empty.map(typeChip).join("") : ""}`
      : "";
    return `<div class="itas-chips" role="group" aria-label="กรองตามชนิดอุปกรณ์">${chip("", model.TYPE_ALL_LABEL, total)}${used.map(typeChip).join("")}${more}</div>`;
  }
  // canOutput = แสดงปุ่ม "พิมพ์" และ "ส่งออก Excel" (ตามตัวกรองปัจจุบัน) · hasRows = false ปิดปุ่มไว้ (ไม่มีอะไรให้พิมพ์/ส่งออก) module สลับเองเมื่อตัวกรองเปลี่ยน
  function toolbar({ query = "", status = "", canAdd = true, canOutput = true, hasRows = true } = {}) {
    const options = [{ value: "", label: "ทุกสถานะ" }, ...model.STATUSES].map((item) => `<option value="${esc(item.value)}"${item.value === status ? " selected" : ""}>${esc(item.label)}</option>`).join("");
    return `<div class="itas-toolbar">
        <div class="field itas-search"><label class="sr-only" for="itas-search">ค้นหาอุปกรณ์ทุกชนิด</label><input class="input" id="itas-search" type="search" autocomplete="off" placeholder="ค้นหาทุกชนิด: เลขทะเบียน / รหัส / ชื่อ / ยี่ห้อ รุ่น / ผู้ใช้ / สถานที่" value="${esc(query)}"></div>
        <div class="field itas-status-filter"><label class="sr-only" for="itas-status">กรองตามสถานะ</label><select class="select" id="itas-status">${options}</select></div>
        ${canOutput ? `<button type="button" class="btn secondary no-print" id="itas-print"${hasRows ? "" : " disabled"}>พิมพ์</button><button type="button" class="btn secondary no-print" id="itas-export"${hasRows ? "" : " disabled"}>ส่งออก Excel</button>` : ""}
        ${canAdd ? '<button type="button" class="btn" id="itas-add">+ เพิ่มอุปกรณ์</button>' : ""}
      </div>`;
  }
  // รหัส/เลขทะเบียน/Serial แสดงเป็นฟอนต์ monospace (กลิ่นไอที) · ช่องชิ้นส่วนของแถวที่ไม่ใช่เครื่องคอมเป็นค่าว่าง (ซ่อนบนมือถือ)
  const MONO_COLUMNS = new Set(["reg_no", "device_code", "serial", "host_code"]);
  function cellHtml(row, column) {
    const text = model.cellText(row, column);
    if (column.key === "status") {
      if (model.isConsumableType(row.type_code)) { const bought = model.consumablePurchaseText(row); return bought ? { inner: esc(bought), cls: " itas-nowrap" } : { inner: "", cls: " itas-cell-empty" }; }
      return { inner: statusPill(row.status), cls: "" };
    }
    if (column.role === "type") return { inner: text ? kindPill(row.type_code, text) : "—", cls: "" };
    if (column.role === "parts") return text ? { inner: `<span class="itas-partcount itas-mono">${esc(text)}</span>`, cls: "" } : { inner: "", cls: " itas-cell-empty" };
    // รหัส/เลขทะเบียน (itas-mono) ห้ามตัดกลางคำ · วันที่ไม่ตัด · คอลัมน์ข้อความยาว (ชื่อ ยี่ห้อ ผู้ใช้ สถานที่) ตัดบรรทัดตามคำได้ (itas-text)
    if (MONO_COLUMNS.has(column.key)) return { inner: esc(text) || "—", cls: " itas-mono" };
    if (column.key === "install_date") return { inner: esc(text) || "—", cls: " itas-nowrap" };
    return { inner: esc(text) || "—", cls: " itas-text" };
  }
  // rows = แถวหลังกรอง/เรียง · sort = { key, direction } · ตารางกว้างเลื่อนในกล่องของตัวเอง (ไม่ดันทั้งหน้า) · แถวเครื่องคอมพิวเตอร์ (is-host) กดแล้วเปิดหน้ารายละเอียดเครื่อง
  function assetTable({ rows, columns, sort = null, typeName = "" }) {
    if (!rows.length) return `<section class="card">${emptyBlock("ไม่พบอุปกรณ์", "ลองเปลี่ยนคำค้นหรือสถานะ หรือกด \"เพิ่มอุปกรณ์\"")}</section>`;
    const head = columns.map((column) => {
      const active = sort?.key === column.key;
      const aria = active ? ` aria-sort="${sort.direction === "descending" ? "descending" : "ascending"}"` : "";
      return `<th scope="col"${aria}><button type="button" class="itas-sort" data-itas-sort="${esc(column.key)}">${esc(column.label)}${active ? (sort.direction === "descending" ? " ▼" : " ▲") : ""}</button></th>`;
    }).join("");
    const body = rows.map((row) => `<tr class="itas-row${model.isConsumableType(row.type_code) ? "" : ` status-${esc(row.status)}`}${model.isHostTypeCode(row.type_code) ? " is-host" : ""}" data-itas-row="${esc(row.id)}" tabindex="0">${columns.map((column) => {
      const { inner, cls } = cellHtml(row, column);
      return `<td${cls.trim() ? ` class="${cls.trim()}"` : ""} data-label="${esc(column.label)}">${inner}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="table-wrap itas-scroll"><table class="itas-table" aria-label="${esc(typeName ? `ทะเบียน${typeName}` : "ทะเบียนอุปกรณ์")}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  /* ---------- ฟอร์มเพิ่ม/แก้อุปกรณ์ ---------- */
  const fieldId = (key) => `itas-f-${String(key).replace(/[^a-z0-9_]/gi, "-")}`;
  // รหัส datalist ของช่อง (ชื่อช่องมี "." ได้ จึงแปลงเป็น "-")
  const listIdOf = (name) => `itas-dl-${String(name).replace(/[^a-z0-9_]/gi, "-")}`;
  function inputFor(field, value, { name, listId = "" }) {
    const id = fieldId(name);
    if (field.type === "status") return `<select class="select" id="${id}" name="${esc(name)}">${model.STATUSES.map((item) => `<option value="${esc(item.value)}"${item.value === value ? " selected" : ""}>${esc(item.label)}</option>`).join("")}</select>`;
    if (field.type === "longtext") return `<textarea class="textarea" id="${id}" name="${esc(name)}" rows="3" maxlength="${field.max}">${esc(value)}</textarea>`;
    if (field.type === "date") return `<input class="input" id="${id}" name="${esc(name)}" type="text" data-date-text autocomplete="off" spellcheck="false" placeholder="วว/ดด/ปปปป" value="${esc(value)}">`;
    if (field.type === "choice") return `<select class="select" id="${id}" name="${esc(name)}"><option value=""></option>${(field.choices ?? []).map((choice) => `<option value="${esc(choice)}"${choice === value ? " selected" : ""}>${esc(choice)}</option>`).join("")}</select>`;
    const numeric = field.type === "number" ? ' inputmode="decimal"' : "";
    const code = field.code ? ' autocapitalize="characters" spellcheck="false"' : "";
    const max = field.type === "text" && field.max ? ` maxlength="${field.max}"` : "";
    const list = listId ? ` list="${esc(listId)}"` : "";
    return `<input class="input" id="${id}" name="${esc(name)}" type="text" autocomplete="off"${list}${numeric}${code}${max} value="${esc(value)}">`;
  }
  // listId = datalist ของคำแนะนำ (ถ้ามี) · ใส่เฉพาะช่องข้อความธรรมดา
  function fieldBlock(field, value, name, { listId = "" } = {}) {
    const hint = field.type === "date" ? `<small>${esc(model.DATE_INPUT_HINT)}</small>` : field.hint ? `<small>${esc(field.hint)}</small>` : "";
    return `<div class="field${field.type === "longtext" ? " itas-wide" : ""}" data-field="${esc(name)}"><label for="${fieldId(name)}">${esc(field.label)}</label>${inputFor(field, value, { name, listId })}${hint}</div>`;
  }
  // คำแนะนำช่องพิมพ์: <datalist> ต่อช่อง (ค่าทุกตัวผ่าน esc) · suggestions = { core:{key:[…]}, attrs:{key:[…]} }
  function suggestionLists(suggestions) {
    const lists = [];
    for (const [part, prefix] of [["core", ""], ["attrs", "attrs."]]) {
      for (const [key, items] of Object.entries(suggestions?.[part] ?? {})) {
        if (!items.length) continue;
        lists.push(`<datalist id="${esc(listIdOf(`${prefix}${key}`))}">${items.map((item) => `<option value="${esc(item)}"></option>`).join("")}</datalist>`);
      }
    }
    return lists.join("");
  }
  // ข้อความบอกว่าระบบเติมค่าจากรายการล่าสุดให้ + ปุ่มล้าง (applied = [{ label, value }])
  const rememberedNotice = (applied) => (applied?.length
    ? `<p class="rf-callout itas-remembered" id="itas-remembered" role="status">เติมให้จากรายการล่าสุดของชนิดนี้: ${applied.map((item) => `<strong>${esc(item.label)}</strong> ${esc(item.value)}`).join(" · ")} <button type="button" class="btn secondary small" id="itas-clear-remembered">ล้างค่าที่เติมให้</button></p>`
    : "");
  // ช่องลับของฟอร์ม (วาดใหม่ทุกครั้งที่สถานะตู้เซฟเปลี่ยน: ล็อก = ไม่มีช่องกรอก/ค่าไม่ค้างในหน้า)
  // asset = แถวเดิม (secrets เป็น ciphertext แค่ใช้ดูว่า "มีค่า") หรือ null (เพิ่มใหม่) · vaultStatus = unknown|uninitialized|locked|unlocked
  function secretsSection({ fields, asset = null, vaultStatus = "locked" }) {
    if (!fields.length) return "";
    const unlocked = vaultStatus === "unlocked";
    const hint = unlocked ? "" : vaultStatus === "uninitialized" ? "ตั้งตู้เซฟก่อนจึงจะกรอกหรือดูช่องลับได้" : vaultStatus === "locked" ? "ปลดล็อกตู้เซฟเพื่อดู/แก้ช่องลับ (บันทึกช่องอื่นได้โดยไม่ต้องปลดล็อก)" : "กำลังตรวจสอบตู้เซฟ…";
    const rows = fields.map((field) => {
      const has = Boolean(asset?.secrets?.[field.key]);
      const state = has ? "มีค่าอยู่" : "ยังไม่มีค่า";
      if (!unlocked) return `<div class="field itas-secret" data-secret="${esc(field.key)}"><span class="field-label">${esc(field.label)} <span class="badge">ลับ</span></span><span class="itas-secret-mask" aria-label="ปลดล็อกเพื่อดู/แก้">•••• (ปลดล็อกเพื่อดู/แก้)</span><small>${state}</small></div>`;
      const inputId = fieldId(`secret-${field.key}`);
      return `<div class="field itas-secret" data-secret="${esc(field.key)}" data-has-value="${has ? "1" : "0"}">
          <label for="${inputId}">${esc(field.label)} <span class="badge">ลับ</span></label>
          <div class="itas-secret-line">
            <span class="itas-secret-shown" data-secret-shown aria-live="polite">${has ? MASK : "—"}</span>
            <input class="input" id="${inputId}" type="password" ${NO_AUTOFILL} data-secret-input data-mask${has ? " hidden" : ""}>
            ${has ? `<span class="itas-secret-actions">
              <button type="button" class="btn secondary small" data-secret-act="show">แสดง</button>
              <button type="button" class="btn secondary small" data-secret-act="edit">ตั้งค่าใหม่</button>
              <button type="button" class="btn secondary small" data-secret-act="clear">ลบค่า</button>
            </span>` : ""}
          </div>
          <small data-secret-note>${state}</small>
        </div>`;
    }).join("");
    return `<fieldset class="itas-group itas-secrets" id="itas-secrets"><legend>ช่องลับ (เข้ารหัสในเบราว์เซอร์)</legend>${hint ? `<p class="muted small">${esc(hint)}</p>` : ""}<div class="itas-grid">${rows}</div></fieldset>`;
  }
  // เลือกชนิดในฟอร์มเพิ่ม (เปลี่ยนแล้วฟอร์มเปลี่ยนช่องตามชนิด · ค่าที่พิมพ์แล้วที่ชื่อช่องตรงกันถูกยกไปให้) · เฉพาะชนิดที่เปิดใช้งาน · ชนิดที่มีของขึ้นก่อน
  function typeSelect(types, selectedCode) {
    const { used, empty } = model.typeChipGroups((Array.isArray(types) ? types : []).filter((type) => type.is_active !== false));
    const option = (type) => `<option value="${esc(type.code)}"${type.code === selectedCode ? " selected" : ""}>${esc(type.name)}</option>`;
    return `<div class="field itas-wide" data-field="type_code"><label for="itas-f-type_code">ชนิดอุปกรณ์ ${REQUIRED}</label><select class="select" id="itas-f-type_code" name="type_code">${used.map(option).join("")}${empty.length ? `<optgroup label="ชนิดอื่นๆ (ยังไม่มีรายการ)">${empty.map(option).join("")}</optgroup>` : ""}</select></div>`;
  }
  // mode = "add" | "edit" · type = นิยามชนิด · values = { core, attrs } (ข้อความ) · asset = แถวเดิม (edit) · types = ทุกชนิด (ใช้เลือกชนิดในฟอร์มเพิ่ม)
  // เพิ่มหลายเครื่องรุ่นเดียวกัน (เฉพาะฟอร์มเพิ่ม · ไม่มีช่องลับ): ติ๊กแล้วกรอกรายการ 1 บรรทัด = 1 เครื่อง · batch = { on, columns, lines }
  function batchSection(type, batch = {}) {
    const on = Boolean(batch.on);
    const options = model.batchColumnOptions(type);
    const current = model.batchOptionOf(type, batch.columns);
    return `<div class="itas-batch" id="itas-batch">
        <label class="itas-batch-toggle" for="itas-batch-toggle"><input type="checkbox" id="itas-batch-toggle" name="batch_on"${on ? " checked" : ""}> เพิ่มหลายเครื่องรุ่นเดียวกัน</label>
        <div id="itas-batch-panel"${on ? "" : " hidden"}>
          <p class="muted small">กรอกช่องอื่นด้านบน (ชื่อ ยี่ห้อ/รุ่น ผู้ใช้ ฯลฯ) ครั้งเดียว ใช้ร่วมกันทุกเครื่อง · เฉพาะช่องที่ต่างกันต่อเครื่องให้พิมพ์ในรายการนี้ · เลขทะเบียน/รหัสอุปกรณ์ในช่องด้านบนต้องเว้นว่าง · ไม่รองรับช่องลับ (ใส่ทีหลังทีละเครื่อง) · ครั้งละไม่เกิน ${model.MAX_BATCH} เครื่อง</p>
          <div class="field" data-field="batch_columns"><label for="itas-f-batch_columns">แต่ละบรรทัดคือ</label><select class="select" id="itas-f-batch_columns" name="batch_columns">${options.map((option) => `<option value="${esc(option.value)}"${option.value === current.value ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select></div>
          <div class="field" data-field="batch_lines"><label for="itas-f-batch_lines">รายการ (บรรทัดละ 1 เครื่อง)</label><textarea class="textarea" id="itas-f-batch_lines" name="batch_lines" rows="6" spellcheck="false" autocapitalize="characters" placeholder="${esc(current.example)}">${esc(batch.lines ?? "")}</textarea></div>
          <div id="itas-batch-result" role="status"></div>
        </div>
      </div>`;
  }
  // ผลการเพิ่มหลายรายการ: result = { added, failed:[{ line, label, message }], notTried:[{ line, label }] } (escape ทุกค่า)
  function batchResult({ added = 0, failed = [], notTried = [] } = {}) {
    const parts = [`<p><strong>เพิ่มสำเร็จ ${esc(String(added))} รายการ</strong>${failed.length || notTried.length ? ` · ยังไม่สำเร็จ ${esc(String(failed.length + notTried.length))} รายการ (คงไว้ในกล่องรายการให้แก้แล้วกดเพิ่มอีกครั้ง)` : ""}</p>`];
    // อ้างถึงรายการด้วยค่าที่พิมพ์ (ไม่ใช้เลขบรรทัด เพราะกล่องรายการถูกเหลือแต่ที่ยังไม่สำเร็จ เลขบรรทัดจึงเปลี่ยน)
    if (failed.length) parts.push(`<ul class="itas-batch-failed">${failed.map((item) => `<li><strong>${esc(item.label)}</strong>: ${esc(item.message)}</li>`).join("")}</ul>`);
    if (notTried.length) parts.push(`<p class="muted small">หยุดก่อน จึงยังไม่ได้ส่ง: ${notTried.map((item) => esc(item.label)).join(", ")}</p>`);
    return `<div class="form-message ${failed.length || notTried.length ? "error" : "success"}" role="status">${parts.join("")}</div>`;
  }
  // ปัญหาของรายการที่ตรวจพบก่อนส่ง (ยังไม่ได้ส่งอะไรขึ้นฐานข้อมูล)
  const batchProblems = (errors) => `<div class="form-message error" role="alert"><p>ยังไม่ได้เพิ่มอะไร กรุณาแก้ตามนี้แล้วกดเพิ่มอีกครั้ง</p><ul class="itas-batch-failed">${errors.map((error) => `<li>${esc(error.message)}</li>`).join("")}</ul></div>`;
  // ช่องหลัก 4 อย่างที่เจ้าของกำหนด (รหัส ชื่อ ยี่ห้อ/รุ่น ผู้ใช้ + สถานะ) เห็นเสมอ · ช่องที่เหลือพับไว้ใต้ "รายละเอียดเพิ่มเติม" (openMore = เปิดอยู่)
  // ช่องลับอยู่นอกส่วนที่พับ เหมือนเดิม
  const attrFieldOf = (field) => ({ ...field, max: field.type === "text" ? (field.max ?? 200) : field.max });
  function assetForm({ mode = "add", type, values, asset = null, vaultStatus = "locked", types = null, openMore = false, notice = "", suggestions = null, remembered = null, batch = null, hostLink = null }) {
    const edit = mode === "edit";
    const coreList = model.coreFieldsOf(type);
    const attrList = model.plainFields(type);
    const consumable = model.isConsumableType(type?.code);
    const listOf = (part, key) => (suggestions?.[part]?.[key]?.length ? { listId: listIdOf(part === "attrs" ? `attrs.${key}` : key) } : {});
    const blockOf = (name) => {
      if (name.startsWith("attrs.")) {
        const field = attrList.find((item) => `attrs.${item.key}` === name);
        return field ? fieldBlock(attrFieldOf(field), values.attrs[field.key] ?? "", name, listOf("attrs", field.key)) : "";
      }
      const field = coreList.find((item) => item.key === name);
      if (!field) return "";
      const label = model.PRIMARY_LABEL_OVERRIDES[name];
      return fieldBlock(label ? { ...field, label } : field, values.core[name] ?? "", name, listOf("core", name));
    };
    const primary = `<fieldset class="itas-group itas-primary"><legend>ข้อมูลหลัก</legend><div class="itas-grid">${model.primaryFieldNames(type).map(blockOf).join("")}</div></fieldset>`;
    const groups = model.GROUP_ORDER.map((groupKey) => {
      const fields = coreList.filter((field) => field.group === groupKey && !model.isPrimaryField(type, field.key) && !(consumable && field.key === "status"));
      const extras = groupKey === "identity" ? attrList.filter((field) => !model.isPrimaryField(type, `attrs.${field.key}`)) : [];
      if (!fields.length && !extras.length) return "";
      const core = fields.map((field) => fieldBlock(field, values.core[field.key] ?? "", field.key, listOf("core", field.key))).join("");
      const typed = extras.map((field) => fieldBlock(attrFieldOf(field), values.attrs[field.key] ?? "", `attrs.${field.key}`, listOf("attrs", field.key))).join("");
      return `<fieldset class="itas-group"><legend>${esc(model.GROUP_LABELS[groupKey])}</legend><div class="itas-grid">${core}${typed ? `<h3 class="itas-subhead itas-wide">ข้อมูลเฉพาะ${esc(type.name)}</h3>${typed}` : ""}</div></fieldset>`;
    }).join("");
    const more = `<details class="itas-more" id="itas-more"${openMore ? " open" : ""}><summary>รายละเอียดเพิ่มเติม <span class="muted small">(Serial สถานที่ วันที่ ราคา ประกัน หมายเหตุ ฯลฯ)</span></summary>${groups}</details>`;
    const title = edit ? `แก้ไข ${esc(asset?.reg_no || asset?.device_code || asset?.name || "อุปกรณ์")}` : "เพิ่มอุปกรณ์";
    // ชิ้นส่วน/อุปกรณ์ต่อพ่วงที่ติดตั้งกับเครื่องคอมที่พบในรายการ: กดไปหน้ารายละเอียดเครื่องนั้นได้ (hostLink = { id, label })
    const installed = edit && hostLink?.id ? ` · ติดตั้งอยู่ที่ <button type="button" class="itas-link" data-itas-host="${esc(hostLink.id)}">${esc(hostLink.label)}</button>` : "";
    const typeBlock = edit ? `<p class="muted small itas-type-line">ชนิด: <strong>${esc(type.name)}</strong>${installed}</p>` : types ? `<div class="itas-grid">${typeSelect(types, type.code)}</div>` : "";
    return `<section class="card itas-form-card" id="itas-form-card" aria-labelledby="itas-form-title">
        <div id="itas-form-message" role="status"></div>
        <form id="itas-form" novalidate autocomplete="off">
          <div class="itas-form-head">
            <button type="button" class="btn secondary" id="itas-form-back">‹ ย้อนกลับ</button>
            <h2 id="itas-form-title">${title}</h2>
            <button type="submit" class="btn is-primary itas-form-head-save">${edit ? "บันทึก" : "เพิ่ม"}</button>
          </div>
          ${notice ? `<p class="rf-callout itas-form-notice" id="itas-form-notice" role="status">${esc(notice)}</p>` : ""}
          ${rememberedNotice(remembered)}
          ${typeBlock}
          ${primary}
          ${consumable ? `<input type="hidden" name="status" value="${esc(values.core.status || "in_use")}">` : ""}
          ${edit ? "" : batchSection(type, batch ?? {})}
          ${more}
          ${suggestionLists(suggestions)}
          <div id="itas-secrets-host"${batch?.on ? " hidden" : ""}>${secretsSection({ fields: model.secretFields(type), asset, vaultStatus })}</div>
          <div class="form-actions"><button type="button" class="btn secondary" id="itas-form-cancel">${edit ? "ปิด" : "ยกเลิก"}</button>${edit ? '<button type="button" class="btn secondary" id="itas-copy-asset">คัดลอกเป็นเครื่องใหม่</button>' : ""}<button type="submit" class="btn is-primary">${edit ? "บันทึกการแก้ไข" : "เพิ่มอุปกรณ์"}</button></div>
        </form>
        ${edit ? `<div class="itas-history" id="itas-history"><button type="button" class="btn secondary" id="itas-history-load">ดูประวัติการแก้ไขและการย้าย</button></div>` : ""}
      </section>`;
  }

  /* ---------- ประวัติของอุปกรณ์ ---------- */
  function historyPanel(view) {
    const log = view.log.length
      ? view.log.map((entry) => `<article class="itas-log"><h4>${esc(entry.actionLabel)} <span class="muted small">โดย ${esc(entry.by || "—")} · ${esc(entry.at)}</span></h4>${entry.changes.length && !entry.created
        ? `<ul>${entry.changes.map((change) => `<li><strong>${esc(change.label)}:</strong> ${change.secret ? esc(change.to) : `${esc(change.from)} → ${esc(change.to)}`}</li>`).join("")}</ul>`
        : entry.created ? '<p class="muted small">สร้างรายการนี้</p>' : '<p class="muted small">ไม่มีการเปลี่ยนค่าที่แสดงได้</p>'}</article>`).join("")
      : '<p class="muted">ยังไม่มีประวัติการแก้ไข</p>';
    const moves = view.moves.length
      ? view.moves.map((move) => `<article class="itas-log"><h4>${esc(move.at)} <span class="muted small">โดย ${esc(move.by || "—")}</span></h4><ul>${move.parts.map((part) => `<li>${esc(part)}</li>`).join("")}</ul></article>`).join("")
      : '<p class="muted">ยังไม่มีประวัติการย้าย</p>';
    return `<div class="itas-history-body"><h3>ประวัติการแก้ไข <span class="detail-section-count">${view.log.length}</span></h3>${log}<h3>ประวัติการย้าย / เปลี่ยนสถานะ <span class="detail-section-count">${view.moves.length}</span></h3>${moves}</div>`;
  }

  /* ---------- หน้ารายละเอียดเครื่องคอมพิวเตอร์ (ชิ้นส่วนภายใน + อุปกรณ์ต่อพ่วง) ---------- */
  // ไม่แสดงช่องลับเลย (ใช้เฉพาะช่องที่ไม่ลับ) · ทุกค่าผ่าน esc() · data-* มีแค่ uuid
  const hostBack = '<div class="itas-host-nav no-print"><button type="button" class="btn secondary" id="itas-host-back">‹ กลับไปทะเบียนอุปกรณ์</button></div>';
  const hostLoading = () => `${hostBack}<section class="card itas-host-card"><p class="muted" role="status">กำลังโหลดข้อมูลเครื่อง…</p></section>`;
  const hostError = (message) => `${hostBack}<section class="card itas-host-card"><div class="form-message error" role="alert">${esc(message)}</div><button type="button" class="btn secondary" id="itas-host-retry">ลองอีกครั้ง</button></section>`;
  function partButton(row, types) {
    const type = (Array.isArray(types) ? types : []).find((item) => item.code === row.type_code);
    const spec = model.partSpecText(row, type);
    const code = row.reg_no || row.device_code || "";
    // การ์ดชิ้นส่วนเรียงใน grid เดียวกันทุกชนิด จึงมีป้ายชนิด (ไอคอน + ชื่อ) บนการ์ดเอง
    const typeLabel = row.type_name || type?.name || row.type_code || "";
    return `<li><button type="button" class="itas-part is-${esc(model.typeKind(row.type_code))}${row.status === "retired" ? " is-retired" : ""}" data-itas-part="${esc(row.id)}">
        <span class="itas-part-type">${glyph(row.type_code)}<span>${esc(typeLabel)}</span>${row.slot ? `<span class="itas-part-slot" title="ช่อง/ตำแหน่ง">${esc(row.slot)}</span>` : ""}</span>
        <span class="itas-part-main"><span class="itas-part-top"><span class="itas-mono itas-part-code">${esc(code || "—")}</span>${row.name ? `<span class="itas-part-name">${esc(row.name)}</span>` : ""}</span>${spec ? `<span class="itas-mono itas-part-spec">${esc(spec)}</span>` : ""}</span>
        <span class="itas-part-foot">${rowStatusPill(row)}</span>
      </button></li>`;
  }
  // รวมการ์ดของทุกชนิดในหมวดเดียวเป็น grid เดียว (เรียงชนิดต่อกัน) · ชื่อชนิดดึงจากกลุ่มที่จัดไว้แล้ว
  function partGroupCard(kind, groups, count, types) {
    const label = model.KIND_LABELS[kind];
    const items = groups.flatMap((group) => group.items.map((row) => ({ ...row, type_name: group.type_name })));
    const inner = items.length
      ? `<ul class="itas-parts">${items.map((row) => partButton(row, types)).join("")}</ul>`
      : `<p class="muted small">ไม่มี${esc(label)}ที่ผูกกับเครื่องนี้</p>`;
    return `<section class="card itas-group-card is-${esc(kind)}" aria-label="${esc(label)}"><h3 class="itas-group-title"><span class="itas-kind is-${esc(kind)}">${esc(label)}</span><span class="detail-section-count">${esc(String(count))}</span></h3>${inner}</section>`;
  }
  // ประวัติการย้าย (รวมจากประวัติรายชิ้น): moves = null ยังไม่ได้โหลด · { status: "loading" | "error" | "ready", message, items }
  function hostMovesSection(moves, hasParts) {
    if (!hasParts) return "";
    const note = '<p class="muted small">รวมจากประวัติของชิ้นส่วนที่ติดตั้งอยู่ในเครื่องนี้ตอนนี้ (ชิ้นที่ย้ายออกไปแล้วไม่แสดงที่นี่ · ดูประวัติของแต่ละชิ้นได้ในหน้าแก้ไขชิ้นนั้น)</p>';
    let inner;
    if (!moves) inner = `${note}<button type="button" class="btn secondary" id="itas-host-moves-load">ดูประวัติการย้ายชิ้นส่วน</button>`;
    else if (moves.status === "loading") inner = '<p class="muted" role="status">กำลังโหลดประวัติ…</p>';
    else if (moves.status === "error") inner = `<div class="form-message error" role="alert">${esc(moves.message)}</div><button type="button" class="btn secondary" id="itas-host-moves-load">ลองอีกครั้ง</button>`;
    else {
      const items = Array.isArray(moves.items) ? moves.items : [];
      inner = `${note}${items.length
        ? items.map((item) => `<article class="itas-log"><h4>${esc(item.at)} <span class="muted small">โดย ${esc(item.by || "—")}</span></h4><p class="itas-mono itas-log-part">${esc(item.part)}</p><ul>${item.details.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></article>`).join("")
        : '<p class="muted">ยังไม่มีประวัติการย้ายของชิ้นส่วนในเครื่องนี้</p>'}`;
    }
    return `<section class="card itas-host-history" aria-label="ประวัติการย้ายชิ้นส่วน"><h3>ประวัติการย้ายชิ้นส่วน</h3>${inner}</section>`;
  }
  // host = เครื่องที่โหลดมาใหม่ · parts = ชิ้นส่วนที่ผูกกับเครื่อง (ทั้งหมดที่ฐานข้อมูลส่งมา รวมที่ยกเลิกใช้งาน) · types = ทุกชนิด · moves = ดูด้านบน · partsNotice = ข้อความเตือนถ้ารายการถูกตัด
  function hostBody({ host, type, parts, types, moves = null, partsNotice = "" }) {
    const grouped = model.groupParts(parts, types);
    const counts = grouped.counts;
    const code = host.device_code || host.reg_no || "";
    const title = host.name || host.model || type?.name || "เครื่องคอมพิวเตอร์";
    const facts = model.hostFacts(host, type);
    const retired = counts.retired ? ` · เลิกใช้ ${counts.retired}` : "";
    const hasParts = grouped.internal.length + grouped.peripheral.length > 0;
    const groupsHtml = hasParts
      ? `${partGroupCard("internal", grouped.internal, counts.internal, types)}${partGroupCard("peripheral", grouped.peripheral, counts.peripheral, types)}`
      : `<section class="card itas-group-card">${emptyBlock("ยังไม่มีชิ้นส่วนหรืออุปกรณ์ต่อพ่วงที่ผูกกับเครื่องนี้", code ? `ใส่ "ติดตั้งที่" = ${code} ที่ชิ้นส่วน/อุปกรณ์นั้น แล้วจะมาแสดงที่นี่` : "เครื่องนี้ยังไม่มีรหัสอุปกรณ์หรือเลขทะเบียน จึงผูกชิ้นส่วนไม่ได้")}</section>`;
    return `${hostBack}
      <section class="itas-host-bar" aria-labelledby="itas-host-title">
        <div class="itas-host-id">
          <span class="itas-host-glyph">${glyph(host.type_code)}</span>
          <div class="itas-host-heading"><p class="itas-host-code itas-mono">${esc(code || "—")}</p><h2 id="itas-host-title">${esc(title)}</h2></div>
          ${statusPill(host.status)}
        </div>
        ${facts.length ? `<dl class="itas-facts">${facts.map((fact) => `<div><dt>${esc(fact.label)}</dt><dd class="itas-mono">${esc(fact.value)}</dd></div>`).join("")}</dl>` : ""}
        <div class="itas-host-foot"><span class="itas-host-counts itas-mono">${esc(`${model.partsSummaryText(counts)}${retired}`)}</span><span class="itas-host-buttons"><button type="button" class="btn secondary" id="itas-host-print">พิมพ์</button><button type="button" class="btn" id="itas-host-edit">แก้ไขเครื่องนี้</button></span></div>
      </section>
      ${partsNotice ? `<p class="rf-callout is-warn">${esc(partsNotice)}</p>` : ""}
      ${groupsHtml}
      ${hostMovesSection(moves, hasParts)}`;
  }
  // เปลือกหน้า: ช่องฟอร์ม (แก้ไขเครื่อง/ชิ้นส่วน) อยู่นอกส่วนที่วาดซ้ำ เพื่อไม่ให้ฟอร์มที่เปิดค้างถูกลบตอนรีเฟรชรายการชิ้นส่วน
  const hostShell = (bodyHtml) => `<div id="itas-form-area"></div><div id="itas-host-host">${bodyHtml}</div>`;

  /* ---------- ใบพิมพ์ A4 (รุ่น 1.06) ---------- */
  // ใบพิมพ์ถูกแทรกเป็นลูกของ .itas-page ชั่วคราวตอนกดพิมพ์ (ซ่อนบนหน้าจอ แสดงเฉพาะตอนพิมพ์ ส่วนอื่นของหน้าถูกซ่อน)
  // ไม่มีช่องลับ: ใช้เฉพาะข้อมูลที่ model เตรียมให้ (ช่องไม่ลับ) · ทุกค่าผ่าน esc()
  const sheetHead = (title, isTest) => `<div class="itas-sheet-title"><h2>${esc(title)}</h2></div>${isTest ? '<p class="itas-sheet-test">ข้อมูลทดสอบ (ไม่ใช่ทะเบียนจริง)</p>' : ""}`;
  const cellClass = (column) => (column.cls ? ` class="itas-sheet-${esc(column.cls)}"` : "");
  const sheetHeadRow = (columns) => `<tr>${columns.map((column) => `<th scope="col"${cellClass(column)}>${esc(column.label)}</th>`).join("")}</tr>`;
  const sheetRows = (columns, lines, emptyText) => (lines.length
    ? lines.map((line) => `<tr>${line.map((value, index) => `<td${cellClass(columns[index])}>${esc(value)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}">${esc(emptyText)}</td></tr>`);
  const metaItem = (label, value) => `<div><dt>${esc(label)}:</dt><dd>${esc(value)}</dd></div>`;
  // ตารางรายการ (A4 แนวนอน): หัวตารางซ้ำทุกหน้า (thead = table-header-group ใน CSS) · แถวไม่ถูกตัดกลาง
  // view = model.printList · filters = model.printFilterItems · notice = ข้อความเตือนเมื่อรายการที่โหลดมาไม่ครบ
  function printListSheet({ view, filters, countText, printedAt, notice = "", isTest = false }) {
    return `<article class="itas-sheet itas-sheet-list" aria-hidden="true">
        ${sheetHead(TITLE, isTest)}
        <dl class="itas-sheet-meta">${filters.map(([label, value]) => metaItem(label, value)).join("")}${metaItem("จำนวน", countText)}${metaItem("วันที่พิมพ์", printedAt)}</dl>
        ${notice ? `<p class="itas-sheet-notice">${esc(notice)}</p>` : ""}
        <table class="itas-sheet-table"><thead>${sheetHeadRow(view.columns)}</thead><tbody>${sheetRows(view.columns, view.lines, "ไม่มีรายการ")}</tbody></table>
      </article>`;
  }
  // ใบสรุปเครื่อง (A4 แนวตั้ง): หัวเครื่อง + ข้อมูลเครื่อง + ตารางชิ้นส่วนภายใน + ตารางอุปกรณ์ต่อพ่วง · view = model.hostPrint
  function printHostSheet({ view, printedAt, isTest = false }) {
    const facts = view.facts.length ? `<dl class="itas-sheet-meta">${view.facts.map((fact) => metaItem(fact.label, fact.value)).join("")}</dl>` : "";
    const sections = view.sections.map((section) => `<h3 class="itas-sheet-section">${esc(section.label)} (${esc(String(section.count))})</h3><table class="itas-sheet-table"><thead>${sheetHeadRow(view.columns)}</thead><tbody>${sheetRows(view.columns, section.lines, `ไม่มี${section.label}ที่ผูกกับเครื่องนี้`)}</tbody></table>`).join("");
    return `<article class="itas-sheet itas-sheet-host" aria-hidden="true">
        ${sheetHead("ใบสรุปเครื่องคอมพิวเตอร์", isTest)}
        <dl class="itas-sheet-meta itas-sheet-machine">${metaItem("รหัสเครื่อง", view.code || "—")}${metaItem("ชื่อ", view.title)}${metaItem("สถานะ", view.status)}${metaItem("ชิ้นส่วน", view.summary)}${metaItem("วันที่พิมพ์", printedAt)}</dl>
        ${facts}
        ${sections}
      </article>`;
  }

  /* ---------- โครงหน้าหลัก ---------- */
  // ช่อง id ที่ module วาดทับเป็นส่วน ๆ: itas-vault-bar · itas-vault-panel · itas-types-host · itas-main · itas-form-area
  function mainPage({ isTest = false, vault = {}, content = "" } = {}) {
    return page(`${head({ isTest })}
      <div id="itas-vault-bar-host">${vaultBar(vault)}</div>
      <div id="itas-vault-panel"></div>
      ${content}
      ${isTest ? purgeRow() : ""}`);
  }
  const layout = ({ main }) => `<div class="itas-layout"><div class="itas-main" id="itas-main-host">${main}</div></div>`;
  const listTitle = (type) => `${esc(type?.name ?? "อุปกรณ์ทั้งหมด")}${type?.is_active === false ? ' <span class="badge cancelled">ปิดใช้งาน</span>' : ""}`;
  // เรียงบนลงล่าง: ช่องค้นหา + ปุ่มเพิ่ม → ชิปกรองชนิด → จำนวน → ตาราง (ฟอร์มเพิ่ม/แก้เปิดเหนือรายการ)
  const mainPanel = ({ type, toolbarHtml, chipsHtml, countText, tableHtml, notice = "" }) => `<div id="itas-form-area"></div>
      <section class="card itas-list-card" aria-labelledby="itas-list-title">
        <h2 id="itas-list-title">${listTitle(type)}</h2>
        ${toolbarHtml}
        <div id="itas-types-host">${chipsHtml}</div>
        <p class="muted small" id="itas-count" role="status">${esc(countText)}</p>
        ${notice ? `<p class="rf-callout is-warn" id="itas-notice">${esc(notice)}</p>` : ""}
        <div id="itas-table-host">${tableHtml}</div>
      </section>`;

  const api = {
    TITLE, MASK, head, page, messageBox, errorCard, purgeRow, versionTag, devNotice, vaultBar, vaultSetupForm, recoveryShow, unlockForm, forgotForm, changeForm, newRecoveryForm, strengthText,
    typeChips, toolbar, assetTable, printListSheet, printHostSheet, glyph, kindPill, statusPill, hostLoading, hostError, hostBody, hostShell, hostMovesSection, partButton, fieldBlock, suggestionLists, batchSection, batchResult, batchProblems, secretsSection, assetForm, historyPanel, mainPage, layout, mainPanel, listTitle,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITAS_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
