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
  const secretInput = ({ id, name, label, autocomplete = "off", hint = "" }) => `<div class="field" data-field="${esc(name)}"><label for="${esc(id)}">${esc(label)}</label><input class="input" id="${esc(id)}" name="${esc(name)}" type="password" autocomplete="${esc(autocomplete)}" autocapitalize="off" spellcheck="false" data-vault-input>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`;
  const vaultCard = (title, body) => `<section class="card itas-vault-card" id="itas-vault-card" aria-labelledby="itas-vault-title"><h2 id="itas-vault-title">${esc(title)}</h2><div id="itas-vault-message" role="status"></div>${body}</section>`;
  const busyLine = '<p class="muted small itas-busy" id="itas-vault-busy" role="status" hidden>กำลังคำนวณกุญแจ… อาจใช้เวลาไม่กี่วินาที (บนมือถือนานกว่า) อย่าปิดหน้านี้</p>';

  function vaultSetupForm({ isTest = false } = {}) {
    return vaultCard(isTest ? "ตั้งตู้เซฟทดสอบ" : "ตั้งตู้เซฟ", `
      <p class="muted small">รหัสตู้เซฟใช้ปลดล็อกช่องลับ ระบบไม่เก็บรหัสนี้ที่ใดเลย ${isTest ? "(โหมดทดสอบใช้รหัสคนละตัวกับของจริง และตู้เซฟทดสอบถูกล้างได้)" : ""}</p>
      <form id="itas-vault-setup-form" novalidate>
        ${secretInput({ id: "itas-vault-pass", name: "password", label: `รหัสตู้เซฟ (อย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร)`, autocomplete: "new-password", hint: model.PASSWORD_ADVICE })}
        <p class="itas-strength muted small" id="itas-vault-strength" aria-live="polite"></p>
        ${secretInput({ id: "itas-vault-pass2", name: "password2", label: "พิมพ์รหัสตู้เซฟอีกครั้ง", autocomplete: "new-password" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ต่อไป: สร้างรหัสกู้คืน</button></div>
      </form>`);
  }
  // แสดงรหัสกู้คืนครั้งเดียว + บังคับพิมพ์กลับเข้ามาเพื่อยืนยันว่าจดแล้ว · mode = "setup" | "recovery" (ออกรหัสใหม่)
  function recoveryShow({ code, mode = "setup" } = {}) {
    const submit = mode === "setup" ? "ยืนยันและตั้งตู้เซฟ" : "ยืนยันและเปลี่ยนรหัสกู้คืน";
    return vaultCard(mode === "setup" ? "จดรหัสกู้คืน" : "รหัสกู้คืนใหม่", `
      <p class="form-message warning" role="alert">รหัสกู้คืนนี้แสดงครั้งเดียว ระบบไม่เก็บไว้ · จดลงกระดาษแล้วเก็บในที่ปลอดภัย (ไม่ใช่ในเครื่องนี้) · ถ้าลืมรหัสตู้เซฟและทำรหัสกู้คืนหาย จะกู้ข้อมูลลับไม่ได้อีก</p>
      <p class="itas-recovery-code" id="itas-recovery-code" translate="no" aria-label="รหัสกู้คืน">${esc(code)}</p>
      <div class="itas-recovery-tools"><button type="button" class="btn secondary" id="itas-recovery-copy">คัดลอกรหัส</button></div>
      <form id="itas-recovery-form" novalidate>
        <div class="field" data-field="typed"><label for="itas-recovery-typed">พิมพ์รหัสกู้คืนกลับเข้ามาเพื่อยืนยันว่าจดแล้ว ${REQUIRED}</label><input class="input" id="itas-recovery-typed" name="typed" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-vault-input placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"></div>
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">${submit}</button></div>
      </form>`);
  }
  function unlockForm({ isTest = false } = {}) {
    return vaultCard(isTest ? "ปลดล็อกตู้เซฟทดสอบ" : "ปลดล็อกตู้เซฟ", `
      <form id="itas-vault-unlock-form" novalidate>
        ${secretInput({ id: "itas-vault-pass", name: "password", label: "รหัสตู้เซฟ", autocomplete: "current-password" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ปลดล็อก</button><button type="button" class="btn secondary" id="itas-vault-forgot">ลืมรหัส ใช้รหัสกู้คืน</button></div>
      </form>`);
  }
  // ลืมรหัสตู้เซฟ: รหัสกู้คืน + ตั้งรหัสตู้เซฟใหม่ (บังคับตั้งใหม่หลังใช้รหัสกู้คืน)
  function forgotForm() {
    return vaultCard("ปลดล็อกด้วยรหัสกู้คืน", `
      <p class="muted small">ใช้รหัสกู้คืนที่จดไว้ แล้วตั้งรหัสตู้เซฟใหม่ (รหัสกู้คืนเดิมยังใช้ได้อยู่)</p>
      <form id="itas-vault-forgot-form" novalidate>
        <div class="field" data-field="recovery"><label for="itas-vault-code">รหัสกู้คืน ${REQUIRED}</label><input class="input" id="itas-vault-code" name="recovery" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-vault-input></div>
        ${secretInput({ id: "itas-vault-pass", name: "password", label: `รหัสตู้เซฟใหม่ (อย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร)`, autocomplete: "new-password", hint: model.PASSWORD_ADVICE })}
        <p class="itas-strength muted small" id="itas-vault-strength" aria-live="polite"></p>
        ${secretInput({ id: "itas-vault-pass2", name: "password2", label: "พิมพ์รหัสตู้เซฟใหม่อีกครั้ง", autocomplete: "new-password" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ปลดล็อกและตั้งรหัสใหม่</button></div>
      </form>`);
  }
  // เปลี่ยนรหัสตู้เซฟ: ต้องกรอกรหัสปัจจุบันซ้ำทุกครั้ง (ไม่ใช้กุญแจที่ปลดล็อกค้างอยู่)
  function changeForm() {
    return vaultCard("เปลี่ยนรหัสตู้เซฟ", `
      <p class="muted small">ข้อมูลลับที่เก็บไว้ไม่ต้องเข้ารหัสใหม่ · ต้องกรอกรหัสตู้เซฟปัจจุบันอีกครั้งเพื่อยืนยัน</p>
      <form id="itas-vault-change-form" novalidate>
        ${secretInput({ id: "itas-vault-current", name: "current", label: "รหัสตู้เซฟปัจจุบัน", autocomplete: "current-password" })}
        ${secretInput({ id: "itas-vault-pass", name: "password", label: `รหัสตู้เซฟใหม่ (อย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร)`, autocomplete: "new-password", hint: model.PASSWORD_ADVICE })}
        <p class="itas-strength muted small" id="itas-vault-strength" aria-live="polite"></p>
        ${secretInput({ id: "itas-vault-pass2", name: "password2", label: "พิมพ์รหัสตู้เซฟใหม่อีกครั้ง", autocomplete: "new-password" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">เปลี่ยนรหัสตู้เซฟ</button></div>
      </form>`);
  }
  function newRecoveryForm() {
    return vaultCard("ออกรหัสกู้คืนใหม่", `
      <p class="muted small">รหัสกู้คืนเดิมจะใช้ไม่ได้อีก · ต้องกรอกรหัสตู้เซฟปัจจุบันเพื่อยืนยัน</p>
      <form id="itas-vault-recovery-form" novalidate>
        ${secretInput({ id: "itas-vault-current", name: "current", label: "รหัสตู้เซฟปัจจุบัน", autocomplete: "current-password" })}
        ${busyLine}
        <div class="form-actions"><button type="button" class="btn secondary" id="itas-vault-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">ต่อไป: สร้างรหัสกู้คืนใหม่</button></div>
      </form>`);
  }
  // ตัววัดความแข็งแรงของรหัส (ข้อความเท่านั้น) · strength จาก model.passwordStrength
  const strengthText = (strength) => (strength?.label ? `ความแข็งแรง: ${strength.label}` : "");

  /* ---------- รายการชนิด + ตารางทะเบียน ---------- */
  function typeList(types, selectedCode = "") {
    const list = Array.isArray(types) ? types : [];
    if (!list.length) return '<p class="muted small">ยังไม่มีชนิดอุปกรณ์</p>';
    return `<ul class="itas-types" id="itas-types">${list.map((type) => {
      const selected = type.code === selectedCode;
      return `<li><button type="button" class="itas-type${selected ? " is-selected" : ""}${type.is_active === false ? " is-off" : ""}" data-itas-type="${esc(type.code)}" aria-pressed="${selected ? "true" : "false"}"><span class="itas-type-name">${esc(type.name)}</span><span class="itas-type-count" aria-label="${esc(String(type.asset_count ?? 0))} รายการ">${esc(String(type.asset_count ?? 0))}</span></button></li>`;
    }).join("")}</ul>`;
  }
  function toolbar({ query = "", status = "", canAdd = true } = {}) {
    const options = [{ value: "", label: "ทุกสถานะ" }, ...model.STATUSES].map((item) => `<option value="${esc(item.value)}"${item.value === status ? " selected" : ""}>${esc(item.label)}</option>`).join("");
    return `<div class="itas-toolbar">
        <div class="field itas-search"><label class="sr-only" for="itas-search">ค้นหาอุปกรณ์</label><input class="input" id="itas-search" type="search" autocomplete="off" placeholder="ค้นหา เลขทะเบียน / รหัส / ชื่อ / รุ่น / Serial / ติดตั้งที่" value="${esc(query)}"></div>
        <div class="field itas-status-filter"><label class="sr-only" for="itas-status">กรองตามสถานะ</label><select class="select" id="itas-status">${options}</select></div>
        ${canAdd ? '<button type="button" class="btn" id="itas-add">เพิ่มอุปกรณ์</button>' : ""}
      </div>`;
  }
  // rows = แถวหลังกรอง/เรียง · sort = { key, direction } · ตารางกว้างเลื่อนในกล่องของตัวเอง (ไม่ดันทั้งหน้า)
  function assetTable({ rows, columns, sort = null, typeName = "" }) {
    if (!rows.length) return `<section class="card">${emptyBlock("ไม่พบอุปกรณ์", "ลองเปลี่ยนคำค้นหรือสถานะ หรือกด \"เพิ่มอุปกรณ์\"")}</section>`;
    const head = columns.map((column) => {
      const active = sort?.key === column.key;
      const aria = active ? ` aria-sort="${sort.direction === "descending" ? "descending" : "ascending"}"` : "";
      return `<th scope="col"${aria}><button type="button" class="itas-sort" data-itas-sort="${esc(column.key)}">${esc(column.label)}${active ? (sort.direction === "descending" ? " ▼" : " ▲") : ""}</button></th>`;
    }).join("");
    const body = rows.map((row) => `<tr class="itas-row status-${esc(row.status)}" data-itas-row="${esc(row.id)}" tabindex="0">${columns.map((column) => {
      const text = model.cellText(row, column);
      const inner = column.key === "status" ? `<span class="badge ${esc(model.statusBadgeClass(row.status))}">${esc(model.statusLabel(row.status))}</span>` : esc(text) || "—";
      return `<td data-label="${esc(column.label)}">${inner}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="table-wrap itas-scroll"><table class="itas-table" aria-label="${esc(typeName ? `ทะเบียน${typeName}` : "ทะเบียนอุปกรณ์")}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  /* ---------- ฟอร์มเพิ่ม/แก้อุปกรณ์ ---------- */
  const fieldId = (key) => `itas-f-${String(key).replace(/[^a-z0-9_]/gi, "-")}`;
  function inputFor(field, value, { name }) {
    const id = fieldId(name);
    if (field.type === "status") return `<select class="select" id="${id}" name="${esc(name)}">${model.STATUSES.map((item) => `<option value="${esc(item.value)}"${item.value === value ? " selected" : ""}>${esc(item.label)}</option>`).join("")}</select>`;
    if (field.type === "longtext") return `<textarea class="textarea" id="${id}" name="${esc(name)}" rows="3" maxlength="${field.max}">${esc(value)}</textarea>`;
    if (field.type === "date") return `<input class="input" id="${id}" name="${esc(name)}" type="text" data-date-text autocomplete="off" spellcheck="false" placeholder="วว/ดด/ปปปป" value="${esc(value)}">`;
    if (field.type === "choice") return `<select class="select" id="${id}" name="${esc(name)}"><option value=""></option>${(field.choices ?? []).map((choice) => `<option value="${esc(choice)}"${choice === value ? " selected" : ""}>${esc(choice)}</option>`).join("")}</select>`;
    const numeric = field.type === "number" ? ' inputmode="decimal"' : "";
    const code = field.code ? ' autocapitalize="characters" spellcheck="false"' : "";
    const max = field.type === "text" && field.max ? ` maxlength="${field.max}"` : "";
    return `<input class="input" id="${id}" name="${esc(name)}" type="text" autocomplete="off"${numeric}${code}${max} value="${esc(value)}">`;
  }
  function fieldBlock(field, value, name) {
    const hint = field.type === "date" ? `<small>${esc(model.DATE_INPUT_HINT)}</small>` : field.hint ? `<small>${esc(field.hint)}</small>` : "";
    return `<div class="field${field.type === "longtext" ? " itas-wide" : ""}" data-field="${esc(name)}"><label for="${fieldId(name)}">${esc(field.label)}</label>${inputFor(field, value, { name })}${hint}</div>`;
  }
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
            <input class="input" id="${inputId}" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" data-secret-input${has ? " hidden" : ""}>
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
  // mode = "add" | "edit" · type = นิยามชนิด · values = { core, attrs } (ข้อความ) · asset = แถวเดิม (edit)
  function assetForm({ mode = "add", type, values, asset = null, vaultStatus = "locked" }) {
    const edit = mode === "edit";
    const groups = model.GROUP_ORDER.map((groupKey) => {
      const fields = model.coreFieldsOf(type).filter((field) => field.group === groupKey);
      const extras = groupKey === "identity" ? model.plainFields(type) : [];
      if (!fields.length && !extras.length) return "";
      const core = fields.map((field) => fieldBlock(field, values.core[field.key] ?? "", field.key)).join("");
      const typed = extras.map((field) => fieldBlock({ ...field, max: field.type === "text" ? (field.max ?? 200) : field.max }, values.attrs[field.key] ?? "", `attrs.${field.key}`)).join("");
      return `<fieldset class="itas-group"><legend>${esc(model.GROUP_LABELS[groupKey])}</legend><div class="itas-grid">${core}${typed ? `<h3 class="itas-subhead itas-wide">ข้อมูลเฉพาะ${esc(type.name)}</h3>${typed}` : ""}</div></fieldset>`;
    }).join("");
    const title = edit ? `แก้ไข ${esc(asset?.reg_no || asset?.device_code || asset?.name || "อุปกรณ์")}` : `เพิ่ม${esc(type.name)}`;
    return `<section class="card itas-form-card" id="itas-form-card" aria-labelledby="itas-form-title">
        <h2 id="itas-form-title">${title}</h2>
        <div id="itas-form-message" role="status"></div>
        <form id="itas-form" novalidate>
          ${groups}
          <div id="itas-secrets-host">${secretsSection({ fields: model.secretFields(type), asset, vaultStatus })}</div>
          <div class="form-actions"><button type="button" class="btn secondary" id="itas-form-cancel">${edit ? "ปิด" : "ยกเลิก"}</button><button type="submit" class="btn is-primary">${edit ? "บันทึกการแก้ไข" : "เพิ่มอุปกรณ์"}</button></div>
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

  /* ---------- โครงหน้าหลัก ---------- */
  // ช่อง id ที่ module วาดทับเป็นส่วน ๆ: itas-vault-bar · itas-vault-panel · itas-types-host · itas-main · itas-form-area
  function mainPage({ isTest = false, vault = {}, content = "" } = {}) {
    return page(`${head({ isTest })}
      <div id="itas-vault-bar-host">${vaultBar(vault)}</div>
      <div id="itas-vault-panel"></div>
      ${content}
      ${isTest ? purgeRow() : ""}`);
  }
  const layout = ({ types, selectedCode, main }) => `<div class="itas-layout">
      <section class="card itas-types-card" aria-labelledby="itas-types-title"><h2 id="itas-types-title">ชนิดอุปกรณ์</h2><div id="itas-types-host">${typeList(types, selectedCode)}</div></section>
      <div class="itas-main" id="itas-main-host">${main}</div>
    </div>`;
  const mainPanel = ({ type, toolbarHtml, countText, tableHtml, notice = "" }) => `<div id="itas-form-area"></div>
      <section class="card itas-list-card" aria-labelledby="itas-list-title">
        <h2 id="itas-list-title">${esc(type?.name ?? "ทะเบียน")}${type?.is_active === false ? ' <span class="badge cancelled">ปิดใช้งาน</span>' : ""}</h2>
        ${toolbarHtml}
        <p class="muted small" id="itas-count" role="status">${esc(countText)}</p>
        ${notice ? `<p class="rf-callout is-warn">${esc(notice)}</p>` : ""}
        <div id="itas-table-host">${tableHtml}</div>
      </section>`;

  const api = {
    TITLE, MASK, head, page, errorCard, purgeRow, versionTag, devNotice, vaultBar, vaultSetupForm, recoveryShow, unlockForm, forgotForm, changeForm, newRecoveryForm, strengthText,
    typeList, toolbar, assetTable, fieldBlock, secretsSection, assetForm, historyPanel, mainPage, layout, mainPanel,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITAS_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
