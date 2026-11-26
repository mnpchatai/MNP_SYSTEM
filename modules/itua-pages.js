// ทะเบียนสิทธิ์ผู้ใช้ (itua) — HTML ของหน้าต่าง ๆ เป็นสตริงล้วน ไม่มี DOM/Supabase (เทสต์ที่ scripts/tests/itua-pages.test.mjs)
// การเชื่อมต่อ (เรียก RPC ผูกปุ่ม พิมพ์ ส่งออก) อยู่ที่ modules/module-itua.js · ข้อมูลล้วน/กติกาอยู่ที่ modules/itua-model.js
// หน้าตาใช้คอมโพเนนต์เดิมของ Pilot: หัวโมดูล .request-module-header (data-module="it") · ฟอร์ม .field/.input · ปุ่ม .btn · ป้าย .badge · ตารางเลื่อนในกล่องของตัวเอง
//
// กฎความปลอดภัยของไฟล์นี้: ทุกค่าที่แสดงผ่าน esc() · ไม่มีช่องลับ/รหัสผ่านในโมดูลนี้เลย
// ไม่ใส่ค่าที่ผู้ใช้พิมพ์ลงใน data-* attribute นอกจาก uuid และรหัส (โฟลเดอร์/โปรแกรม ที่ผ่าน esc แล้ว)
(function (root) {
  "use strict";

  const model = root.MNP_ITUA_MODEL;
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const iconOf = (name) => root.MNP_UI_ICONS?.icon(name) ?? "";
  const REQUIRED = '<span class="field-required">(จำเป็น)</span>';
  const PALETTE = "it";
  const TITLE = "ทะเบียนสิทธิ์ผู้ใช้";

  const emptyBlock = (text, hint = "") => (typeof emptyState === "function"
    ? emptyState(text, { hint })
    : `<div class="empty"><p>${esc(text)}</p>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`);
  const testTag = (isTest) => (isTest ? '<span class="badge itua-test-tag" title="ข้อมูลทดสอบ แยกจากระบบจริง">ทดสอบ</span>' : "");
  const statusPill = (status) => `<span class="badge itua-status is-${esc(model.statusTone(status))}">${esc(model.statusLabel(status))}</span>`;
  const levelPill = (level) => `<span class="itua-level is-${esc(String(level).toLowerCase())}" title="${esc(level === "F" ? "สิทธิ์เต็ม (F)" : "อ่านอย่างเดียว (R)")}">${esc(level)}</span>`;

  /* ---------- หัวหน้า / เปลือกหน้า ---------- */
  // backHref/backLabel: ค่าเริ่มต้นย้อนกลับไป IT SUPPORT · หน้าต่อคนย้อนไปรายการผู้ใช้
  function head({ title = TITLE, isTest = false, backHref = "#/office?module=it-support", backLabel = "‹ IT SUPPORT" } = {}) {
    return `<a class="request-back-link" href="${esc(backHref)}">${esc(backLabel)}</a>
      <div class="page-heading request-module-header itua-head" data-module="${PALETTE}">
        <div class="request-module-title"><span class="type-card-badge">${iconOf("shield")}</span><h1>${esc(title)}</h1>${testTag(isTest)}</div>
      </div>`;
  }
  // เลขเวอร์ชันท้ายหน้า ชิดขวา (ไม่พิมพ์) · แถบ "กำลังพัฒนา" ผูกกับธง IN_DEVELOPMENT ใน itua-model.js (ข้อความอย่างเดียว ไม่ปิดกั้นการใช้งาน)
  const versionTag = () => `<p class="itua-version no-print" title="${esc(TITLE)} เวอร์ชัน ${esc(model.MODULE_VERSION)} · อัปเดต ${esc(model.formatDate(model.VERSION_DATE))}">V${esc(model.MODULE_VERSION)}</p>`;
  const DEV_NOTICE = "ระบบทะเบียนสิทธิ์ผู้ใช้กำลังพัฒนาและทดสอบ ยังไม่เปิดใช้งานจริง";
  const devNotice = () => (model.IN_DEVELOPMENT ? `<p class="rf-callout is-warn itua-dev-notice no-print" role="status">${DEV_NOTICE}</p>` : "");
  const page = (inner) => `<div class="itua-page" data-module="${PALETTE}">${devNotice()}${inner}${versionTag()}</div>`;
  // กล่องข้อความผิดพลาดใต้หัวฟอร์ม (escape ทุกครั้ง) · reload = มีปุ่ม "โหลดข้อมูลล่าสุด" (แก้ชนกัน)
  const messageBox = (message, { reload = false } = {}) => `<div class="form-message error" role="alert">${esc(message)}${reload ? ' <button type="button" class="btn secondary small" id="itua-reload">โหลดข้อมูลล่าสุด</button>' : ""}</div>`;
  const errorCard = (message, { retry = true } = {}) => `<section class="card"><div class="form-message error" role="alert">${esc(message)}</div>${retry ? '<button class="btn secondary" type="button" id="itua-retry">ลองอีกครั้ง</button>' : ""}</section>`;
  const purgeRow = () => '<div class="itua-purge-row no-print"><button class="btn danger small" type="button" id="itua-purge">ล้างข้อมูลทะเบียนสิทธิ์ผู้ใช้ทดสอบ</button></div>';
  // แท็บของโมดูล (ลิงก์เส้นทางจริง: ปุ่มย้อนกลับของเบราว์เซอร์ใช้ได้) · view = list | matrix | catalog
  const tabs = (view) => `<nav class="itua-tabs no-print" aria-label="เมนูทะเบียนสิทธิ์ผู้ใช้">${model.TABS.map((tab) => `<a class="itua-tab${tab.view === view ? " is-current" : ""}" href="${esc(tab.url)}"${tab.view === view ? ' aria-current="page"' : ""}>${esc(tab.label)}</a>`).join("")}</nav>`;
  // หน้าต่อคน (view = user) ไม่มีแท็บ: ลิงก์ย้อนกลับพากลับรายการผู้ใช้ · ช่องฟอร์ม (itua-form-area) อยู่นอกส่วนที่วาดซ้ำ ฟอร์มที่เปิดค้างจึงไม่ถูกลบตอนรีเฟรชเนื้อหา
  const pageShell = ({ view, isTest = false, body }) => page(`${view === "user"
    ? head({ isTest, backHref: model.listUrl(), backLabel: "‹ ทะเบียนสิทธิ์ผู้ใช้" })
    : `${head({ isTest })}${tabs(view)}`}<div id="itua-form-area"></div><div id="itua-body-host">${body}</div>${isTest ? purgeRow() : ""}`);

  /* ---------- ตัวกรอง + ตารางผู้ใช้ ---------- */
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  // canOutput = ปุ่มพิมพ์/ส่งออก (ปิดไว้เมื่อไม่มีแถวตามตัวกรอง) · canAdd = ปุ่ม "+ เพิ่มผู้ใช้" (หน้ารายการเท่านั้น)
  function toolbar({ filters = {}, departments = [], canAdd = false, hasRows = true } = {}) {
    const dept = [option("", "ทุกแผนก", !filters.department), ...departments.map((code) => option(code, code, code === filters.department))].join("");
    const division = [option("", "ทุกฝ่าย", !filters.division), ...model.DIVISIONS.map((item) => option(item.value, item.label, item.value === filters.division))].join("");
    const status = [option("", "ทุกสถานะ", !filters.status), ...model.USER_STATUSES.map((item) => option(item.value, item.label, item.value === filters.status))].join("");
    return `<div class="itua-toolbar">
        <div class="field itua-search"><label class="sr-only" for="itua-search">ค้นหาผู้ใช้</label><input class="input" id="itua-search" type="search" autocomplete="off" placeholder="ค้นหา: Auth. Name / ชื่อ / แผนก / อีเมล" value="${esc(filters.query ?? "")}"></div>
        <div class="field itua-filter"><label class="sr-only" for="itua-dept">กรองตามแผนก</label><select class="select" id="itua-dept">${dept}</select></div>
        <div class="field itua-filter"><label class="sr-only" for="itua-division">กรองตามฝ่าย</label><select class="select" id="itua-division">${division}</select></div>
        <div class="field itua-filter"><label class="sr-only" for="itua-status">กรองตามสถานะ</label><select class="select" id="itua-status">${status}</select></div>
        <button type="button" class="btn secondary no-print" id="itua-print"${hasRows ? "" : " disabled"}>พิมพ์</button><button type="button" class="btn secondary no-print" id="itua-export"${hasRows ? "" : " disabled"}>ส่งออก Excel</button>
        ${canAdd ? '<button type="button" class="btn" id="itua-add">+ เพิ่มผู้ใช้</button>' : ""}
      </div>`;
  }
  const internetCell = (on) => (on ? '<span class="itua-yes" title="มีสิทธิ์อินเทอร์เน็ต">✓ มี</span>' : '<span class="muted">—</span>');
  // ตารางรวม: 1 แถวต่อผู้ใช้ · แถวกดเปิดหน้าต่อคน (ลิงก์ที่ Auth. Name) · มือถือแสดงเป็นการ์ดต่อแถว (data-label)
  function userTable(rows) {
    if (!rows.length) return `<section class="card">${emptyBlock("ไม่พบผู้ใช้", 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง หรือกด "+ เพิ่มผู้ใช้"')}</section>`;
    const body = rows.map((row) => {
      const sub = model.userSubName(row);
      return `<tr class="itua-row${row.status === "resigned" ? " is-resigned" : ""}" data-itua-row="${esc(row.id)}" tabindex="0">
        <td class="itua-mono" data-label="Auth. Name"><a href="${esc(model.userUrl(row.id))}">${esc(row.auth_id)}</a></td>
        <td class="itua-text" data-label="ชื่อ">${esc(model.userName(row))}${sub ? `<br><small class="muted">${esc(sub)}</small>` : ""}</td>
        <td class="itua-nowrap" data-label="แผนก">${esc(row.department_code || "—")}</td>
        <td class="itua-nowrap" data-label="ฝ่าย">${esc(model.divisionLabel(row.division))}</td>
        <td class="itua-nowrap" data-label="อินเทอร์เน็ต">${internetCell(row.internet)}</td>
        <td class="itua-mono itua-nowrap" data-label="โฟลเดอร์">${esc(model.folderSummaryText(row) || "—")}</td>
        <td class="itua-text itua-mono" data-label="อีเมลภายใน">${esc(row.internal_email || "—")}</td>
        <td data-label="สถานะ">${statusPill(row.status)}</td>
      </tr>`;
    }).join("");
    const heads = ["Auth. Name", "ชื่อ", "แผนก", "ฝ่าย", "อินเทอร์เน็ต", "โฟลเดอร์ (R/F)", "อีเมลภายใน", "สถานะ"].map((label) => `<th scope="col">${esc(label)}</th>`).join("");
    return `<div class="table-wrap itua-scroll"><table class="itua-table" aria-label="ทะเบียนสิทธิ์ผู้ใช้"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const listPanel = ({ title = "ผู้ใช้ในทะเบียน", toolbarHtml, countText, tableHtml }) => `<section class="card itua-list-card" aria-labelledby="itua-list-title">
        <h2 id="itua-list-title">${esc(title)}</h2>
        ${toolbarHtml}
        <p class="muted small" id="itua-count" role="status">${esc(countText)}</p>
        <div id="itua-table-host">${tableHtml}</div>
      </section>`;

  /* ---------- เมทริกซ์ ผู้ใช้ × โฟลเดอร์ ---------- */
  // หัวคอลัมน์ค้างด้านบน คอลัมน์ผู้ใช้ค้างซ้าย เลื่อนแนวนอน/แนวตั้งในกรอบของตัวเอง · ช่อง = R / F / ว่าง · ดูอย่างเดียว (แก้ที่หน้าต่อคน)
  function matrixTable({ rows, folders }) {
    if (!rows.length) return `<section class="card">${emptyBlock("ไม่พบผู้ใช้", "ลองเปลี่ยนคำค้นหาหรือตัวกรอง")}</section>`;
    if (!folders.length) return `<section class="card">${emptyBlock("ยังไม่มีรายการโฟลเดอร์", 'เพิ่มโฟลเดอร์ได้ที่แท็บ "ตั้งค่า"')}</section>`;
    const heads = folders.map((folder) => `<th scope="col" class="itua-col" title="${esc([folder.name, folder.description].filter(Boolean).join(" — "))}"><span>${esc(folder.name || folder.code)}</span></th>`).join("");
    const body = rows.map((row) => `<tr class="${row.status === "resigned" ? "is-resigned" : ""}">
        <th scope="row" class="itua-sticky-col"><a href="${esc(model.userUrl(row.user_id))}"><span class="itua-mono">${esc(row.auth_id)}</span> <span class="itua-matrix-name">${esc(model.userName(row))}</span></a></th>
        <td class="itua-matrix-dept">${esc(row.department_code || "")}</td>
        ${folders.map((folder) => {
    const level = model.levelOf(row, folder.code);
    return `<td class="itua-cell${level ? ` is-${level.toLowerCase()}` : ""}">${level ? esc(level) : ""}</td>`;
  }).join("")}
      </tr>`).join("");
    return `<div class="itua-matrix-scroll" tabindex="0" role="region" aria-label="เมทริกซ์สิทธิ์ผู้ใช้ต่อโฟลเดอร์ (เลื่อนดูได้)"><table class="itua-matrix"><thead><tr><th scope="col" class="itua-sticky-col itua-corner">ผู้ใช้</th><th scope="col" class="itua-matrix-dept">แผนก</th>${heads}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="muted small itua-legend">R = อ่านอย่างเดียว · F = เต็ม · ช่องว่าง = ไม่มีสิทธิ์ · แสดงเฉพาะโฟลเดอร์ที่ใช้งานอยู่ · แก้สิทธิ์ที่หน้าของแต่ละคน</p>`;
  }

  /* ---------- หน้าต่อคน ---------- */
  const fact = (label, value, { mono = false } = {}) => `<div><dt>${esc(label)}</dt><dd${mono ? ' class="itua-mono"' : ""}>${esc(value || "—")}</dd></div>`;
  const sectionTitle = (title, count) => `<h3 class="itua-section-title">${esc(title)}${count === undefined ? "" : ` <span class="detail-section-count">${esc(String(count))}</span>`}</h3>`;
  function foldersSection(detail, canEdit) {
    const items = Array.isArray(detail.folders) ? detail.folders : [];
    const chips = items.length
      ? `<ul class="itua-chips">${items.map((item) => `<li class="itua-grant is-${esc(String(item.level).toLowerCase())}${item.is_active === false ? " is-off" : ""}" title="${esc(item.is_active === false ? "โฟลเดอร์ปิดการใช้งานแล้ว" : item.name)}">${levelPill(item.level)}<span>${esc(item.name)}</span></li>`).join("")}</ul>`
      : '<p class="muted">ไม่มีสิทธิ์โฟลเดอร์แชร์</p>';
    const programs = Array.isArray(detail.programs) ? detail.programs : [];
    const programList = programs.length
      ? `<ul class="itua-chips">${programs.map((item) => `<li class="itua-grant is-program${item.is_active === false ? " is-off" : ""}"><span>${esc(item.name)}${item.note ? ` <small class="muted">(${esc(item.note)})</small>` : ""}</span></li>`).join("")}</ul>`
      : '<p class="muted">ไม่มีสิทธิ์โปรแกรม</p>';
    return `<section class="card itua-card" aria-label="สิทธิ์">
        <div class="itua-card-head"><h2>สิทธิ์การใช้งาน</h2>${canEdit ? '<button type="button" class="btn" id="itua-edit-grants">แก้ไขสิทธิ์</button>' : ""}</div>
        ${sectionTitle("โฟลเดอร์แชร์", items.length)}${chips}
        ${sectionTitle("อินเทอร์เน็ต")}<p>${detail.user.internet ? '<span class="itua-yes">✓ มีสิทธิ์อินเทอร์เน็ต</span>' : '<span class="muted">ไม่มีสิทธิ์อินเทอร์เน็ต</span>'}</p>
        ${sectionTitle("โปรแกรม", programs.length)}${programList}
      </section>`;
  }
  function emailsSection(detail, canEdit) {
    const emails = Array.isArray(detail.emails) ? detail.emails : [];
    const list = emails.length
      ? `<ul class="itua-emails">${emails.map((email) => `<li class="${email.status === "closed" ? "is-closed" : ""}"><span class="itua-mono">${esc(email.address)}</span> <span class="badge">${esc(model.emailKindLabel(email.kind))}</span>${email.status === "closed" ? ' <span class="badge cancelled">ปิดแล้ว</span>' : ""}${canEdit && email.status === "active" ? ` <button type="button" class="btn secondary small" data-itua-close-email="${esc(email.id)}">ปิดอีเมล</button>` : ""}</li>`).join("")}</ul>`
      : '<p class="muted">ยังไม่มีอีเมล</p>';
    return `<section class="card itua-card" aria-label="อีเมล">
        <div class="itua-card-head"><h2>อีเมล <span class="detail-section-count">${emails.filter((email) => email.status === "active").length}</span></h2>${canEdit ? '<button type="button" class="btn secondary" id="itua-add-email">+ เพิ่มอีเมล</button>' : ""}</div>
        ${list}
        <p class="muted small">ทะเบียนนี้ไม่เก็บรหัสผ่านอีเมล · อีเมลที่ปิดแล้วเปิดใหม่ไม่ได้ (เพิ่มเป็นรายการใหม่)</p>
      </section>`;
  }
  // ประวัติ: view = model.logView (escape ทุกค่า) · เรียงใหม่สุดก่อนตามที่ฐานข้อมูลส่งมา
  // limit = จำนวนสูงสุดที่ขอจากฐานข้อมูล (ถึงเพดานแล้วบอกว่าแสดงเฉพาะส่วนล่าสุด)
  function historySection(view, { limit = 0 } = {}) {
    const items = view.length
      ? view.map((entry) => `<article class="itua-log"><h4>${esc(entry.at)} <span class="muted small">โดย ${esc(entry.by)}${entry.docNo ? ` · ตามใบ ${esc(entry.docNo)}` : ""}</span></h4><ul>${entry.lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>${entry.reason ? `<p class="small"><span class="muted">เหตุผล:</span> ${esc(entry.reason)}</p>` : ""}</article>`).join("")
      : '<p class="muted">ยังไม่มีประวัติ</p>';
    return `<section class="card itua-card" aria-label="ประวัติ"><h2>ประวัติการเปลี่ยนแปลง <span class="detail-section-count">${view.length}</span></h2><p class="muted small">บันทึกสำหรับ ISO ลบหรือแก้ไม่ได้ · ใหม่สุดอยู่บน${limit && view.length >= limit ? ` · แสดง ${limit} รายการล่าสุด` : ""}</p>${items}</section>`;
  }
  function acknowledgementsSection(detail) {
    const items = Array.isArray(detail.acknowledgements) ? detail.acknowledgements : [];
    if (!items.length) return "";
    const rows = items.map((item) => `<li>${esc(model.formatDateTime(item.acknowledged_at))} · ${esc([item.acknowledged_by_employee_no, item.acknowledged_by_full_name].filter(Boolean).join(" "))}${item.policy_version ? ` · นโยบาย ${esc(item.policy_version)}` : ""}</li>`).join("");
    return `<section class="card itua-card" aria-label="การรับทราบสิทธิ์"><h2>การรับทราบสิทธิ์ <span class="detail-section-count">${items.length}</span></h2><ul>${rows}</ul></section>`;
  }
  // detail = ผลของ app_itua_get_user · logHtml = historySection(...) ที่ module เตรียมให้ · state: loading ฯลฯ ไม่อยู่ที่นี่
  function userBody({ detail, historyHtml }) {
    const user = detail.user;
    const resigned = user.status !== "active";
    const remaining = model.holdingsOf(detail);
    const warn = resigned && model.hasHoldings(remaining)
      ? `<p class="rf-callout is-warn" role="status">ผู้ใช้นี้ลาออกแล้วแต่ยังมีสิทธิ์เหลืออยู่: ${esc(model.holdingsText(remaining))} · ระบบไม่ถอดสิทธิ์ให้เอง กรุณากด "แก้ไขสิทธิ์" เพื่อถอนให้ครบ</p>`
      : resigned ? '<p class="rf-callout" role="status">ผู้ใช้นี้ลาออกแล้ว · ถอนสิทธิ์ได้อย่างเดียว เพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้</p>' : "";
    return `<section class="itua-user-bar" aria-labelledby="itua-user-title">
        <div class="itua-user-id">
          <span class="itua-user-glyph">${iconOf("user")}</span>
          <div class="itua-user-heading"><p class="itua-user-code itua-mono">${esc(user.auth_id)}</p><h2 id="itua-user-title">${esc(model.userName(user))}</h2></div>
          ${statusPill(user.status)}
        </div>
        <dl class="itua-facts">
          ${fact("ชื่อ (อังกฤษ)", user.name_en)}${fact("แผนก", user.department_code)}${fact("ฝ่าย", model.divisionLabel(user.division))}
          ${fact("เลขใบที่ให้สิทธิ์", user.granted_doc_no, { mono: true })}${fact("วันที่ให้สิทธิ์", user.granted_on ? model.formatDate(user.granted_on) : "")}
          ${fact("อัปเดตล่าสุด", `${model.formatDateTime(user.updated_at)}${user.updated_by_employee_no ? ` · ${user.updated_by_employee_no}` : ""}`)}
          ${user.note ? `<div class="itua-fact-wide"><dt>หมายเหตุ</dt><dd>${esc(user.note)}</dd></div>` : ""}
        </dl>
        <div class="itua-user-foot no-print"><button type="button" class="btn secondary" id="itua-edit-user">แก้ไขข้อมูลหลัก</button><button type="button" class="btn secondary" id="itua-change-status">${resigned ? "กลับมาใช้งาน" : "เปลี่ยนเป็นลาออก"}</button></div>
      </section>
      ${warn}
      ${foldersSection(detail, true)}
      ${emailsSection(detail, true)}
      ${acknowledgementsSection(detail)}
      ${historyHtml ?? ""}`;
  }

  /* ---------- ฟอร์ม (เปิดเหนือเนื้อหา ทีละฟอร์ม) ---------- */
  // หัวฟอร์มติดขอบบน (ย้อนกลับ + ชื่อ + บันทึก) ให้กดบันทึกได้โดยไม่ต้องเลื่อนลง · กล่องข้อความอยู่เหนือฟอร์ม
  function formShell({ id, title, submitLabel, body, extraActions = "" }) {
    return `<section class="card itua-form-card" id="itua-form-card" aria-labelledby="itua-form-title">
        <div id="itua-form-message" role="status"></div>
        <form id="${esc(id)}" class="itua-form" novalidate autocomplete="off">
          <div class="itua-form-head">
            <button type="button" class="btn secondary" id="itua-form-back">‹ ย้อนกลับ</button>
            <h2 id="itua-form-title">${esc(title)}</h2>
            <button type="submit" class="btn is-primary itua-form-head-save">${esc(submitLabel)}</button>
          </div>
          ${body}
          <div class="form-actions"><button type="button" class="btn secondary" id="itua-form-cancel">ยกเลิก</button>${extraActions}<button type="submit" class="btn is-primary">${esc(submitLabel)}</button></div>
        </form>
      </section>`;
  }
  const fieldId = (name) => `itua-f-${String(name).replace(/[^a-z0-9_]/gi, "-")}`;
  const textField = ({ name, label, value = "", required = false, hint = "", max = 0, type = "text", attrs = "", wide = false }) => `<div class="field${wide ? " itua-wide" : ""}" data-field="${esc(name)}"><label for="${fieldId(name)}">${esc(label)} ${required ? REQUIRED : ""}</label><input class="input" id="${fieldId(name)}" name="${esc(name)}" type="${type}" autocomplete="off"${max ? ` maxlength="${max}"` : ""}${attrs} value="${esc(value)}">${hint ? `<small>${esc(hint)}</small>` : ""}</div>`;
  const areaField = ({ name, label, value = "", required = false, hint = "", max = 0, rows = 3 }) => `<div class="field itua-wide" data-field="${esc(name)}"><label for="${fieldId(name)}">${esc(label)} ${required ? REQUIRED : ""}</label><textarea class="textarea" id="${fieldId(name)}" name="${esc(name)}" rows="${rows}"${max ? ` maxlength="${max}"` : ""}>${esc(value)}</textarea>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`;
  const reasonField = (hint = "บันทึกไว้ในประวัติสำหรับ ISO (ลบ/แก้ไม่ได้)", { required = true } = {}) => areaField({ name: "reason", label: "เหตุผล", required, hint, max: 1000, rows: 2 });

  // mode = add | edit · values = ข้อความต่อช่อง (model.userValuesFromUser / emptyUserValues)
  function userForm({ mode = "add", values, user = null }) {
    const fields = model.USER_FIELDS.map((field) => {
      const value = values[field.key] ?? "";
      if (field.type === "division") {
        return `<div class="field" data-field="division"><label for="${fieldId("division")}">${esc(field.label)} ${REQUIRED}</label><select class="select" id="${fieldId("division")}" name="division"><option value=""${value ? "" : " selected"}>— เลือกฝ่าย —</option>${model.DIVISIONS.map((item) => option(item.value, item.label, item.value === value)).join("")}</select></div>`;
      }
      if (field.type === "longtext") return areaField({ name: field.key, label: field.label, value, max: field.max });
      if (field.type === "date") return textField({ name: field.key, label: field.label, value, hint: model.DATE_INPUT_HINT, attrs: ' data-date-text spellcheck="false" placeholder="วว/ดด/ปปปป"' });
      return textField({ name: field.key, label: field.label, value, required: field.required, hint: field.hint ?? "", max: field.max, attrs: field.code ? ' autocapitalize="characters" spellcheck="false"' : field.key === "auth_id" ? ' autocapitalize="off" spellcheck="false"' : "" });
    }).join("");
    const edit = mode === "edit";
    return formShell({
      id: "itua-user-form",
      title: edit ? `แก้ไขข้อมูลหลัก ${user?.auth_id ?? ""}`.trim() : "เพิ่มผู้ใช้เข้าทะเบียน",
      submitLabel: edit ? "บันทึกการแก้ไข" : "เพิ่มผู้ใช้",
      body: `<div class="itua-grid">${fields}</div>${edit ? `<div class="itua-grid">${reasonField("ต้องระบุทุกครั้งที่แก้ข้อมูลผู้ใช้ (บันทึกสำหรับ ISO)")}</div>` : '<p class="muted small">เพิ่มผู้ใช้ใหม่แล้วจึงกำหนดสิทธิ์โฟลเดอร์/อินเทอร์เน็ต/โปรแกรม และอีเมล ที่หน้าของผู้ใช้</p>'}`,
    });
  }
  // เปลี่ยนสถานะ: remaining = model.holdingsOf(detail) (สิทธิ์ที่ยังถืออยู่ ใช้เตือนเมื่อเปลี่ยนเป็นลาออก)
  function statusForm({ user, target, remaining }) {
    const toResigned = target === "resigned";
    const warning = toResigned && model.hasHoldings(remaining)
      ? `<p class="rf-callout is-warn" role="status">ผู้ใช้นี้ยังมีสิทธิ์อยู่: ${esc(model.holdingsText(remaining))} · การเปลี่ยนสถานะ<strong>ไม่ถอดสิทธิ์ให้เอง</strong> หลังบันทึกให้กด "แก้ไขสิทธิ์" เพื่อถอนให้ครบ</p>`
      : "";
    return formShell({
      id: "itua-status-form",
      title: `${toResigned ? "เปลี่ยนเป็นลาออก" : "กลับมาใช้งาน"} · ${user.auth_id}`,
      submitLabel: toResigned ? "ยืนยันลาออก" : "ยืนยันกลับมาใช้งาน",
      body: `${warning}<div class="itua-grid">${reasonField("ต้องระบุเหตุผลที่เปลี่ยนสถานะ (บันทึกสำหรับ ISO)")}</div>`,
    });
  }
  // ฟอร์มสิทธิ์ (ชุดเดียว atomic): โฟลเดอร์เลือก ไม่มี/R/F · อินเทอร์เน็ต · โปรแกรม (+หมายเหตุ) · model = model.grantFormModel · next = สถานะที่ติ๊กอยู่ (ตั้งต้น = ค่าปัจจุบัน)
  function grantsForm({ user, formModel, next }) {
    const folderRows = formModel.folders.map((item) => {
      const value = next.folders[item.code] ?? "";
      const options = model.folderOptions(formModel, item).map((choice) => option(choice.value, choice.label, choice.value === value)).join("");
      const flags = [item.isActive ? "" : ' <span class="badge cancelled">ปิดใช้งาน</span>'].join("");
      return `<div class="field itua-grant-row" data-field="folder:${esc(item.code)}"><label for="${fieldId(`folder:${item.code}`)}">${esc(item.name)}${flags}${item.description ? ` <small class="muted">${esc(item.description)}</small>` : ""}</label><select class="select" id="${fieldId(`folder:${item.code}`)}" name="folder:${esc(item.code)}">${options}</select></div>`;
    }).join("");
    const internetDisabled = !model.canAddInternet(formModel) && !formModel.internet;
    const internet = `<div class="field itua-check" data-field="internet"><label class="itua-check-label" for="${fieldId("internet")}"><input type="checkbox" id="${fieldId("internet")}" name="internet"${next.internet ? " checked" : ""}${internetDisabled ? " disabled" : ""}> มีสิทธิ์ใช้อินเทอร์เน็ต</label></div>`;
    const programRows = formModel.programs.map((item) => {
      const state = next.programs[item.code] ?? { on: false, note: "" };
      const disabled = !model.canAddProgram(formModel, item) && !item.current;
      const isOther = item.code === model.OTHER_PROGRAM;
      return `<div class="field itua-check" data-field="program:${esc(item.code)}"><label class="itua-check-label" for="${fieldId(`program:${item.code}`)}"><input type="checkbox" id="${fieldId(`program:${item.code}`)}" name="program:${esc(item.code)}"${state.on ? " checked" : ""}${disabled ? " disabled" : ""}> ${esc(item.name)}${item.isActive ? "" : ' <span class="badge cancelled">ปิดใช้งาน</span>'}</label>
        <div class="itua-note-line" data-field="note:${esc(item.code)}"><label class="sr-only" for="${fieldId(`note:${item.code}`)}">หมายเหตุของ ${esc(item.name)}</label><input class="input" id="${fieldId(`note:${item.code}`)}" name="note:${esc(item.code)}" type="text" maxlength="500" autocomplete="off" placeholder="${isOther ? "ระบุว่าเป็นโปรแกรมอะไร (จำเป็น)" : "หมายเหตุ (ไม่บังคับ)"}" value="${esc(state.note)}"${disabled ? " disabled" : ""}></div></div>`;
    }).join("");
    const resignedNote = formModel.resigned ? '<p class="rf-callout is-warn" role="status">ผู้ใช้นี้ลาออกแล้ว: ถอนสิทธิ์ได้อย่างเดียว (เพิ่มหรือเปลี่ยนไม่ได้)</p>' : "";
    return formShell({
      id: "itua-grants-form",
      title: `แก้ไขสิทธิ์ · ${user.auth_id}`,
      submitLabel: "บันทึกสิทธิ์",
      body: `${resignedNote}
        <fieldset class="itua-group"><legend>โฟลเดอร์แชร์</legend>${folderRows || '<p class="muted">ยังไม่มีรายการโฟลเดอร์ (เพิ่มได้ที่แท็บ "ตั้งค่า")</p>'}</fieldset>
        <fieldset class="itua-group"><legend>อินเทอร์เน็ต</legend>${internet}</fieldset>
        <fieldset class="itua-group"><legend>โปรแกรม</legend>${programRows || '<p class="muted">ยังไม่มีรายการโปรแกรม</p>'}</fieldset>
        <div class="itua-grid">${reasonField("ต้องระบุเหตุผลที่เปลี่ยนสิทธิ์ (บันทึกสำหรับ ISO) · บันทึกทั้งชุดพร้อมกัน ถ้าข้อใดไม่ผ่านจะไม่เปลี่ยนอะไรเลย")}</div>`,
    });
  }
  function emailAddForm({ user, canInternet = true }) {
    return formShell({
      id: "itua-email-add-form",
      title: `เพิ่มอีเมล · ${user.auth_id}`,
      submitLabel: "เพิ่มอีเมล",
      body: `<div class="itua-grid">
          ${textField({ name: "address", label: "ที่อยู่อีเมล", required: true, type: "email", max: 200, attrs: ' inputmode="email" autocapitalize="off" spellcheck="false"' })}
          <div class="field" data-field="kind"><label for="${fieldId("kind")}">ชนิด ${REQUIRED}</label><select class="select" id="${fieldId("kind")}" name="kind">${model.EMAIL_KINDS.map((item) => option(item.value, item.label, item.value === (canInternet ? "internal" : "extra"))).join("")}</select>${canInternet ? "" : "<small>ผู้ใช้นี้มีอีเมลภายในที่ใช้งานอยู่แล้ว (ปิดอันเดิมก่อนจึงเพิ่มอีเมลภายในใหม่ได้)</small>"}</div>
          ${reasonField("ไม่บังคับ", { required: false })}
        </div>`,
    });
  }
  function emailCloseForm({ email }) {
    return formShell({
      id: "itua-email-close-form",
      title: `ปิดอีเมล · ${email.address}`,
      submitLabel: "ยืนยันปิดอีเมล",
      body: `<p class="rf-callout is-warn" role="status">อีเมลที่ปิดแล้วเปิดใหม่ไม่ได้ (ต้องเพิ่มเป็นรายการใหม่) · ประวัติยังอยู่ครบ</p><div class="itua-grid">${reasonField("ต้องระบุเหตุผลที่ปิดอีเมล (บันทึกสำหรับ ISO)")}</div>`,
    });
  }

  /* ---------- ตั้งค่า: รายการโฟลเดอร์ / โปรแกรม ---------- */
  const activeBadge = (active) => (active ? '<span class="badge itua-status is-ok">ใช้งาน</span>' : '<span class="badge itua-status is-off">ปิดใช้งาน</span>');
  function catalogPage({ catalog }) {
    const folders = Array.isArray(catalog?.folders) ? catalog.folders : [];
    const programs = Array.isArray(catalog?.programs) ? catalog.programs : [];
    const folderRows = folders.map((item) => `<tr><td class="itua-mono" data-label="รหัส">${esc(item.code)}</td><td class="itua-text" data-label="ชื่อ">${esc(item.name)}${item.description ? `<br><small class="muted">${esc(item.description)}</small>` : ""}</td><td data-label="ลำดับ">${esc(item.sort)}</td><td data-label="ผู้มีสิทธิ์">${esc(item.grant_count)}</td><td data-label="สถานะ">${activeBadge(item.is_active)}</td><td class="no-print"><button type="button" class="btn secondary small" data-itua-edit-folder="${esc(item.code)}">แก้ไข</button></td></tr>`).join("");
    const programRows = programs.map((item) => `<tr><td class="itua-mono" data-label="รหัส">${esc(item.code)}</td><td class="itua-text" data-label="ชื่อ">${esc(item.name)}</td><td data-label="ลำดับ">${esc(item.sort)}</td><td data-label="ผู้มีสิทธิ์">${esc(item.grant_count)}</td><td data-label="สถานะ">${activeBadge(item.is_active)}</td><td class="no-print"><button type="button" class="btn secondary small" data-itua-edit-program="${esc(item.code)}">แก้ไข</button></td></tr>`).join("");
    const heads = ["รหัส", "ชื่อ", "ลำดับ", "ผู้มีสิทธิ์", "สถานะ", ""].map((label) => `<th scope="col">${esc(label)}</th>`).join("");
    const table = (rows, label) => (rows ? `<div class="table-wrap itua-scroll"><table class="itua-table itua-catalog-table" aria-label="${esc(label)}"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">ยังไม่มีรายการ</p>`);
    return `<section class="card itua-card" aria-labelledby="itua-folders-title">
        <div class="itua-card-head"><h2 id="itua-folders-title">รายการโฟลเดอร์แชร์ <span class="detail-section-count">${folders.length}</span></h2><button type="button" class="btn" id="itua-add-folder">+ เพิ่มโฟลเดอร์</button></div>
        <p class="muted small">ลบไม่ได้ (ปิดการใช้งานแทน) · รหัสแก้ไม่ได้หลังสร้าง · โฟลเดอร์ที่ปิดแล้วผู้ที่มีสิทธิ์อยู่ยังถืออยู่จนกว่าจะถอน</p>
        ${table(folderRows, "รายการโฟลเดอร์")}
      </section>
      <section class="card itua-card" aria-labelledby="itua-programs-title">
        <div class="itua-card-head"><h2 id="itua-programs-title">รายการโปรแกรม <span class="detail-section-count">${programs.length}</span></h2><button type="button" class="btn" id="itua-add-program">+ เพิ่มโปรแกรม</button></div>
        <p class="muted small">รหัส OTHER (อื่นๆ) ต้องมีหมายเหตุว่าเป็นโปรแกรมอะไรทุกครั้งที่ให้สิทธิ์</p>
        ${table(programRows, "รายการโปรแกรม")}
      </section>`;
  }
  // kind = folder | program · mode = add | edit · values = model.emptyCatalogValues / catalogValuesFromItem
  function catalogForm({ kind, mode, values }) {
    const noun = kind === "folder" ? "โฟลเดอร์" : "โปรแกรม";
    const edit = mode === "edit";
    const code = edit
      ? `<div class="field" data-field="code"><span class="field-label">รหัส</span><p class="itua-mono">${esc(values.code)}</p><input type="hidden" name="code" value="${esc(values.code)}"><small>แก้รหัสไม่ได้</small></div>`
      : textField({ name: "code", label: "รหัส", required: true, value: values.code, max: 30, hint: "ตัวพิมพ์ใหญ่ A–Z ตัวเลข _ - เช่น ACC-SHARE (ระบบแปลงเป็นตัวพิมพ์ใหญ่ให้) · แก้ทีหลังไม่ได้", attrs: ' autocapitalize="characters" spellcheck="false"' });
    return formShell({
      id: "itua-catalog-form",
      title: edit ? `แก้ไข${noun} ${values.code}` : `เพิ่ม${noun}`,
      submitLabel: edit ? "บันทึกการแก้ไข" : `เพิ่ม${noun}`,
      body: `<div class="itua-grid">
          ${code}
          ${textField({ name: "name", label: `ชื่อ${noun}`, required: true, value: values.name, max: 200 })}
          ${kind === "folder" ? areaField({ name: "description", label: "คำอธิบาย", value: values.description, max: 1000, rows: 2 }) : ""}
          ${textField({ name: "sort", label: "ลำดับ (0–9999)", value: values.sort, attrs: ' inputmode="numeric"', hint: "เลขน้อยแสดงก่อน" })}
          <div class="field itua-check" data-field="is_active"><label class="itua-check-label" for="${fieldId("is_active")}"><input type="checkbox" id="${fieldId("is_active")}" name="is_active"${values.is_active ? " checked" : ""}> ใช้งานอยู่</label></div>
          ${edit ? reasonField("ต้องระบุเมื่อมีค่าเปลี่ยน (บันทึกสำหรับ ISO)") : ""}
        </div>`,
    });
  }

  /* ---------- ใบพิมพ์ A4 แนวนอน ---------- */
  // ใบพิมพ์ถูกแทรกเป็นลูกของ .itua-page ชั่วคราวตอนกดพิมพ์ (ซ่อนบนหน้าจอ แสดงเฉพาะตอนพิมพ์ ส่วนอื่นของหน้าถูกซ่อน)
  // ไม่มีช่องลับ · ทุกค่าผ่าน esc() · view = { columns, lines } จาก model.listPrint / matrixPrint
  const cellClass = (column) => (column.cls ? ` class="itua-sheet-${esc(column.cls)}"` : "");
  const sheetHeadRow = (columns) => `<tr>${columns.map((column) => `<th scope="col"${cellClass(column)}>${column.cls === "level" ? `<span>${esc(column.label)}</span>` : esc(column.label)}</th>`).join("")}</tr>`;
  const sheetRows = (columns, lines, emptyText) => (lines.length
    ? lines.map((line) => `<tr>${line.map((value, index) => `<td${cellClass(columns[index])}>${esc(value)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}">${esc(emptyText)}</td></tr>`);
  const metaItem = (label, value) => `<div><dt>${esc(label)}:</dt><dd>${esc(value)}</dd></div>`;
  function printSheet({ title, view, filters, countText, printedAt, isTest = false, matrix = false }) {
    return `<article class="itua-sheet${matrix ? " is-matrix" : ""}" aria-hidden="true">
        <div class="itua-sheet-title"><h2>${esc(title)}</h2></div>${isTest ? '<p class="itua-sheet-test">ข้อมูลทดสอบ (ไม่ใช่ทะเบียนจริง)</p>' : ""}
        <dl class="itua-sheet-meta">${filters.map(([label, value]) => metaItem(label, value)).join("")}${metaItem("จำนวน", countText)}${metaItem("วันที่พิมพ์", printedAt)}</dl>
        <table class="itua-sheet-table"><thead>${sheetHeadRow(view.columns)}</thead><tbody>${sheetRows(view.columns, view.lines, "ไม่มีรายการ")}</tbody></table>
        ${matrix ? '<p class="itua-sheet-legend">R = อ่านอย่างเดียว · F = เต็ม · ช่องว่าง = ไม่มีสิทธิ์ · ✓ = มีสิทธิ์อินเทอร์เน็ต</p>' : ""}
      </article>`;
  }

  const api = {
    TITLE, head, page, pageShell, tabs, messageBox, errorCard, purgeRow, versionTag, devNotice, statusPill, levelPill,
    toolbar, userTable, listPanel, matrixTable,
    userBody, foldersSection, emailsSection, historySection, acknowledgementsSection,
    formShell, userForm, statusForm, grantsForm, emailAddForm, emailCloseForm, catalogPage, catalogForm,
    printSheet,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITUA_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
