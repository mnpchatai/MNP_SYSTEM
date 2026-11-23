// ใบแจ้งซ่อมคอมพิวเตอร์ (itrp) — แท็บ "ประวัติการซ่อม" (ประวัติการซ่อมเครื่องคอมพิวเตอร์ IT01-FM02 + ทะเบียนเครื่อง) · HTML เป็นสตริงล้วน ไม่มี DOM/Supabase
// (เทสต์ที่ scripts/tests/itrp-history-pages.test.mjs) · การเรียก RPC และการผูกปุ่มอยู่ที่ modules/module-itrp.js · ข้อมูลล้วน/กติกาอยู่ที่ modules/itrp-model.js
// แยกจาก itrp-pages.js เพราะไฟล์นั้นใหญ่แล้ว · ใช้ page / head / tabs ฯลฯ ของ itrp-pages.js (โหลดก่อนไฟล์นี้) · สัญญา RPC: docs/itrp-contract.md (หัวข้อ "ประวัติการซ่อมเครื่อง")
//
// หน้าตา: ซ้าย/บน = ช่องค้นหา + รายการเครื่อง · ขวา/ล่าง = หัวใบ FM02 + ตาราง 7 คอลัมน์ของเครื่องที่เลือก (กว้างเกินจอให้เลื่อนในกล่องของตัวเอง)
// ใบพิมพ์ FM02 ใช้เปลือก .itrp-sheet ตัวเดียวกับใบแจ้งซ่อม (กฎซ่อมเมนู/ขอบกระดาษ A4 ตอนพิมพ์ใช้ร่วมกัน) เพิ่มเฉพาะตารางหัวซ้ำทุกหน้าและรหัสฟอร์มมุมล่าง
(function (root) {
  "use strict";

  const model = root.MNP_ITRP_MODEL;
  const itrpPages = () => root.MNP_ITRP_PAGES; // เรียกตอนวาดหน้า (ไฟล์นี้โหลดหลัง itrp-pages.js แต่เทสต์อาจโหลดทีหลัง)
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const REQUIRED = '<span class="field-required">(จำเป็น)</span>';
  const FORM_CODE = "IT01-FM02";
  const PRINT_TITLE = "ประวัติการซ่อมเครื่องคอมพิวเตอร์";
  const PRINT_SUBTITLE = "(Computer's Repair Record)";
  const MAX_LISTED = 300; // รายการเครื่องที่วาดพร้อมกันสูงสุด (เกินให้พิมพ์ค้นหาเพื่อกรอง) · รายการโหลดมาครบ ≤ 2,000 แถว
  const FM02_COLUMNS = Object.freeze(["เลขที่ใบแจ้งซ่อม", "วันที่", "อาการเสีย", "การแก้ไข", "ซ่อมเสร็จ", "ข้อเสนอแนะ", "ผู้แจ้ง"]);

  /* ---------- รายการเครื่อง ---------- */
  const orderHref = (id) => model.repairUrl("order", { id });
  const badge = (text, className = "") => `<span class="badge itrp-hist-badge${className ? ` ${className}` : ""}">${esc(text)}</span>`;
  // รายการเครื่องของแท็บ: ปุ่มต่อเครื่อง (data-hist-code) · เครื่องที่ยกเลิกการใช้งานแสดงจาง · รหัสที่มีประวัติแต่ไม่อยู่ในทะเบียนก็เลือกได้ (มีป้ายกำกับ)
  function deviceItems(devices, selectedCode = "") {
    const list = Array.isArray(devices) ? devices : [];
    if (!list.length) return '<li class="itrp-hist-none muted small">ไม่พบเครื่องที่ตรงกับคำค้น</li>';
    return list.slice(0, MAX_LISTED).map((device) => {
      const retired = device.status === "retired";
      const meta = [device.in_registry === false ? "" : model.deviceKindLabel(device.kind), device.user_name, device.division].filter(Boolean).join(" · ");
      const count = Number(device.history_count) || 0;
      const selected = selectedCode && device.code === selectedCode;
      return `<li><button type="button" class="itrp-hist-device${selected ? " is-selected" : ""}${retired ? " is-retired" : ""}" data-hist-code="${esc(device.code)}" aria-pressed="${selected ? "true" : "false"}">
          <span class="itrp-hist-device-top"><strong class="itrp-hist-code">${esc(device.code)}</strong>${device.in_registry === false ? badge("ไม่อยู่ในทะเบียน") : ""}${retired ? badge("ยกเลิกการใช้งาน") : ""}</span>
          ${meta ? `<span class="itrp-hist-device-meta">${esc(meta)}</span>` : ""}
          <span class="itrp-hist-device-count">${count ? `${count} รายการซ่อม${device.last_repair_on ? ` · ล่าสุด ${esc(model.formatDate(device.last_repair_on))}` : ""}` : "ยังไม่มีประวัติ"}</span>
        </button></li>`;
    }).join("") + (list.length > MAX_LISTED ? `<li class="itrp-hist-none muted small">แสดง ${MAX_LISTED} จาก ${list.length} เครื่อง พิมพ์ค้นหาเพื่อกรองให้แคบลง</li>` : "");
  }
  const countText = (shown, total) => (shown === total ? `${total} เครื่อง` : `พบ ${shown} จาก ${total} เครื่อง`);

  /* ---------- แผงประวัติของเครื่องที่เลือก ---------- */
  // ตาราง 7 คอลัมน์ตาม FM02 + ที่มา: ใบในระบบ = เลขที่เป็นลิงก์เปิดใบ · นำเข้า/ลงย้อนหลัง = ป้ายที่มา และ (it_admin) ปุ่มแก้ไข / ยกเลิกรายการ · "ดูรอยแก้" เห็นได้ทุกคนที่อ่านประวัติได้ (รวมผู้อนุมัติขั้น IT ที่แก้ไม่ได้)
  function historyTable(rows, canEdit) {
    if (!rows.length) return '<p class="muted itrp-hist-empty">ยังไม่มีประวัติการซ่อมของเครื่องนี้</p>';
    const revisionsButton = (row) => (row.revisionCount ? `<button type="button" class="btn secondary small" data-hist-revisions="${esc(row.entryId)}">ดูรอยแก้</button>` : "");
    const hasActions = rows.some((row) => row.editable && (canEdit || row.revisionCount));
    const body = rows.map((row) => {
      const docNo = row.source === "request" && row.requestId
        ? `<a class="request-no register-no-link" href="${esc(orderHref(row.requestId))}">${esc(row.docNo)}</a>`
        : esc(row.docNo);
      const tags = [badge(row.sourceLabel, `is-${esc(row.source)}`), row.requestStatus ? badge(row.requestStatus, "is-status") : "", row.revisionCount ? badge(`แก้ไขแล้ว ${row.revisionCount} ครั้ง`, "is-edited") : ""].join("");
      const actions = row.editable && (canEdit || row.revisionCount)
        ? `<div class="itrp-hist-actions">${canEdit ? `<button type="button" class="btn secondary small" data-hist-edit="${esc(row.entryId)}">แก้ไข</button><button type="button" class="btn danger small" data-hist-void="${esc(row.entryId)}">ยกเลิกรายการ</button>` : ""}${revisionsButton(row)}</div>`
        : "";
      return `<tr data-hist-row="${esc(row.key)}" data-source="${esc(row.source)}">
          <td data-label="${esc(FM02_COLUMNS[0])}">${docNo}<div class="itrp-hist-tags">${tags}</div></td>
          <td data-label="${esc(FM02_COLUMNS[1])}">${esc(row.reportedOn)}</td>
          <td data-label="${esc(FM02_COLUMNS[2])}" class="itrp-text">${esc(row.symptom)}</td>
          <td data-label="${esc(FM02_COLUMNS[3])}" class="itrp-text">${esc(row.action)}</td>
          <td data-label="${esc(FM02_COLUMNS[4])}">${esc(row.finishedOn)}</td>
          <td data-label="${esc(FM02_COLUMNS[5])}" class="itrp-text">${esc(row.remark)}</td>
          <td data-label="${esc(FM02_COLUMNS[6])}">${esc(row.reporter)}</td>
          ${hasActions ? `<td class="itrp-hist-act">${actions}</td>` : ""}
        </tr>`;
    }).join("");
    return `<div class="table-wrap itrp-hist-scroll"><table class="itrp-hist-table" aria-label="ประวัติการซ่อมของเครื่อง"><thead><tr>${FM02_COLUMNS.map((label) => `<th scope="col">${esc(label)}</th>`).join("")}${hasActions ? '<th scope="col"><span class="sr-only">จัดการ</span></th>' : ""}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const headFact = (label, value) => `<div class="definition"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  // data = ผลของ app_itrp_device_history · canEdit = it_admin (ปุ่มแก้ข้อมูลเครื่อง/เพิ่มเข้าทะเบียน และปุ่มจัดการแถว)
  function historyPanel(data, { canEdit = false } = {}) {
    const header = model.deviceHeader(data);
    const rows = model.historyRowsView(data?.rows);
    const retired = data?.device?.status === "retired";
    const deviceButton = canEdit ? `<button type="button" class="btn secondary" data-hist-edit-device>${header.inRegistry ? "แก้ข้อมูลเครื่อง" : "เพิ่มเข้าทะเบียนเครื่อง"}</button>` : "";
    return `<section class="card itrp-hist-card" aria-labelledby="itrp-hist-title" data-code="${esc(header.code)}">
        <div class="itrp-hist-card-head">
          <h2 id="itrp-hist-title">${esc(header.code)}${retired ? ` ${badge("ยกเลิกการใช้งาน")}` : ""}${header.inRegistry ? "" : ` ${badge("ไม่อยู่ในทะเบียน")}`}</h2>
          <div class="action-panel-buttons"><a class="btn secondary" id="itrp-hist-print" href="${esc(model.historyPrintUrl(header.code))}">พิมพ์ประวัติ (A4)</a>${deviceButton}</div>
        </div>
        <dl class="definition-grid itrp-hist-head-grid">
          ${headFact("เริ่มใช้วันที่", header.startedOn)}
          ${headFact("Computer Code", header.code)}
          ${headFact("User", header.user)}
          ${headFact("Section", header.section)}
          ${headFact("Processor", header.processor)}
          ${headFact("เลขทะเบียนทรัพย์สินทางบัญชี", header.assetNo)}
        </dl>
        ${header.inRegistry ? "" : '<p class="muted small">รหัสนี้ยังไม่อยู่ในทะเบียนเครื่อง หัวใบจึงเป็น "-" (เพิ่มเข้าทะเบียนได้ที่ปุ่มด้านบน)</p>'}
        ${historyTable(rows, canEdit)}
      </section>`;
  }
  const panelPlaceholder = () => '<section class="card itrp-hist-card itrp-hist-placeholder"><p class="muted">เลือกเครื่องจากรายการเพื่อดูประวัติการซ่อมและพิมพ์ใบ FM02</p></section>';
  const panelLoading = (code) => `<section class="card itrp-hist-card" aria-busy="true"><p class="muted" role="status">กำลังโหลดประวัติของ ${esc(code)}…</p></section>`;
  const panelError = (message, code) => `<section class="card itrp-hist-card"><div class="form-message error" role="alert">${esc(message)}</div><button type="button" class="btn secondary" data-hist-retry="${esc(code)}">ลองอีกครั้ง</button></section>`;

  // ตัวหน้าแท็บ · devices = ผลของ app_itrp_list_devices · selected = { code, data } | { code, error: ข้อความ } | null · query = คำค้นตั้งต้น
  function historyTab({ devices = [], selected = null, canEdit = false, query = "", isTest = false } = {}) {
    const list = model.filterDevices(devices, query);
    const empty = !devices.length;
    let panel = panelPlaceholder();
    if (selected?.data) panel = historyPanel(selected.data, { canEdit });
    else if (selected?.error) panel = panelError(selected.error, selected.code);
    const emptyHint = empty
      ? `<p class="muted small">ยังไม่มีเครื่องในทะเบียนและยังไม่มีประวัติการซ่อม${isTest ? " (โหมดทดสอบเริ่มจากทะเบียนว่าง ข้อมูลของจริงไม่ปนมา)" : ""}${canEdit ? " · กด \"เพิ่มเครื่อง\" หรือ \"ลงประวัติย้อนหลัง\" เพื่อเริ่ม" : ""}</p>`
      : "";
    return `<div class="itrp-hist" id="itrp-hist">
        ${canEdit ? '<div class="itrp-hist-toolbar"><button type="button" class="btn" id="itrp-hist-add-entry">ลงประวัติย้อนหลัง</button><button type="button" class="btn secondary" id="itrp-hist-add-device">เพิ่มเครื่อง</button></div>' : ""}
        <div id="itrp-hist-forms"></div>
        <div class="itrp-hist-layout">
          <section class="card itrp-hist-list-card" aria-labelledby="itrp-hist-list-title">
            <h2 id="itrp-hist-list-title">เครื่อง / อุปกรณ์</h2>
            <div class="field itrp-hist-search"><label class="sr-only" for="itrp-hist-search">ค้นหารหัสเครื่อง</label><input class="input" id="itrp-hist-search" type="search" autocomplete="off" placeholder="ค้นหา รหัสเครื่อง / ผู้ใช้ / แผนก / เลขทรัพย์สิน" value="${esc(query)}"></div>
            <p class="muted small" id="itrp-hist-count" role="status">${esc(countText(list.length, devices.length))}</p>
            ${emptyHint}
            <ul class="itrp-hist-devices" id="itrp-hist-devices">${empty ? "" : deviceItems(list, selected?.code ?? "")}</ul>
          </section>
          <p class="sr-only" id="itrp-hist-status" role="status" aria-live="polite"></p>
          <div class="itrp-hist-detail" id="itrp-hist-panel">${panel}</div>
        </div>
      </div>`;
  }

  /* ---------- ช่องวันที่แบบพิมพ์เอง ---------- */
  // ปฏิทินกลางเลื่อนได้ทีละเดือน ใช้กับวันที่ย้อนหลังหลายปีไม่ไหว → พิมพ์ วว/ดด/ปปปป เอง (พ.ศ. หรือ ค.ศ.) · ค่าที่ส่งต่อให้ฐานข้อมูลแปลงเป็น ISO ที่ model.normalizeDateField · ออกจากช่องแล้ว module เติมรูปแบบ พ.ศ. ให้เห็นว่าตีความเป็นปีไหน
  const dateField = ({ field, id, label, value, required = false }) => `<div class="field" data-field="${field}"><label for="${id}">${label}${required ? ` ${REQUIRED}` : ""}</label><input class="input" id="${id}" name="${field}" type="text" data-date-text autocomplete="off" spellcheck="false" placeholder="วว/ดด/ปปปป" aria-describedby="${id}-hint" value="${esc(model.dateInputText(value))}"><small id="${id}-hint">${esc(model.DATE_INPUT_HINT)}</small></div>`;

  /* ---------- ฟอร์ม: ลงประวัติย้อนหลัง / แก้ไขรายการ ---------- */
  // mode = "add" | "edit" · values = ค่าในฟอร์ม (model.EMPTY_HISTORY_FORM / historyFormValues) · deviceCodes = รหัสที่ให้เลือกใน datalist
  function historyFormCard({ mode = "add", values = model.EMPTY_HISTORY_FORM, deviceOptions = [] } = {}) {
    const edit = mode === "edit";
    return `<section class="card itrp-hist-form-card" id="itrp-hist-form-card" aria-labelledby="itrp-hist-form-title">
        <h2 id="itrp-hist-form-title">${edit ? "แก้ไขรายการประวัติการซ่อม" : "ลงประวัติย้อนหลัง"}</h2>
        <p class="muted small">${edit ? "ระบบเก็บฉบับเดิม ผู้แก้ และเวลาไว้ทุกครั้ง (ดูได้ที่ \"ดูรอยแก้\") ลบรายการไม่ได้ ทำได้แค่ยกเลิกรายการพร้อมเหตุผล" : "ลงรายการจากใบแจ้งซ่อมกระดาษที่ไม่ได้อยู่ในระบบ · ลงแล้วแก้ไขได้ (ระบบเก็บรอยแก้) แต่ลบไม่ได้"}</p>
        <div id="itrp-hist-form-message" role="status"></div>
        <form id="itrp-hist-form" novalidate>
          <div class="form-grid">
            <div class="field" data-field="doc_no"><label for="itrp-hist-doc-no">เลขที่ใบแจ้งซ่อม (กระดาษ)</label><input class="input" id="itrp-hist-doc-no" name="doc_no" maxlength="${model.MAX_DOC_NO}" autocomplete="off" placeholder="เช่น IT01-25/012" value="${esc(values.doc_no)}"></div>
            <div class="field" data-field="device_code"><label for="itrp-hist-code">รหัสเครื่อง ${REQUIRED}</label><input class="input" id="itrp-hist-code" name="device_code" list="itrp-hist-code-list" maxlength="${model.MAX_DEVICE_CODE}" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(values.device_code)}"><datalist id="itrp-hist-code-list">${itrpPages().codeOptions(deviceOptions)}</datalist></div>
            ${dateField({ field: "reported_on", id: "itrp-hist-reported", label: "วันที่แจ้งซ่อม", value: values.reported_on, required: true })}
            ${dateField({ field: "finished_on", id: "itrp-hist-finished", label: "ซ่อมเสร็จวันที่ (ไม่บังคับ)", value: values.finished_on })}
          </div>
          <div class="field" data-field="symptom"><label for="itrp-hist-symptom">อาการเสีย</label><textarea class="textarea" id="itrp-hist-symptom" name="symptom" rows="3" maxlength="2000">${esc(values.symptom)}</textarea><small>ต้องกรอกอาการเสียหรือการแก้ไขอย่างน้อยหนึ่งอย่าง</small></div>
          <div class="field" data-field="action"><label for="itrp-hist-action">การแก้ไข</label><textarea class="textarea" id="itrp-hist-action" name="action" rows="3" maxlength="2000">${esc(values.action)}</textarea></div>
          <div class="form-grid">
            <div class="field" data-field="remark"><label for="itrp-hist-remark">ข้อเสนอแนะ (ไม่บังคับ)</label><input class="input" id="itrp-hist-remark" name="remark" maxlength="${model.MAX_REMARK}" autocomplete="off" value="${esc(values.remark)}"></div>
            <div class="field" data-field="reporter_name"><label for="itrp-hist-reporter">ผู้แจ้ง (ไม่บังคับ)</label><input class="input" id="itrp-hist-reporter" name="reporter_name" maxlength="${model.MAX_REPORTER}" autocomplete="off" value="${esc(values.reporter_name)}"></div>
          </div>
          <div class="form-actions"><button type="button" class="btn secondary" id="itrp-hist-form-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">${edit ? "บันทึกการแก้ไข" : "ลงประวัติ"}</button></div>
        </form>
      </section>`;
  }

  /* ---------- ฟอร์ม: ทะเบียนเครื่อง ---------- */
  const optionList = (list, value) => list.map((item) => `<option value="${esc(item.value)}"${item.value === value ? " selected" : ""}>${esc(item.label)}</option>`).join("");
  // mode = "add" | "edit" (แก้เครื่องเดิม: รหัสแก้ไม่ได้) · values = ค่าครบทุกช่อง (ต้องโหลดค่าเดิมมาเต็มก่อนแก้ เพราะ RPC ล้างช่องที่ไม่ส่ง)
  function deviceFormCard({ mode = "add", values = model.EMPTY_DEVICE_FORM } = {}) {
    const edit = mode === "edit";
    return `<section class="card itrp-hist-form-card" id="itrp-device-form-card" aria-labelledby="itrp-device-form-title">
        <h2 id="itrp-device-form-title">${edit ? `แก้ข้อมูลเครื่อง ${esc(values.code)}` : "เพิ่มเครื่องเข้าทะเบียน"}</h2>
        <p class="muted small">ทะเบียนเครื่องอย่างย่อสำหรับหัวใบ FM02 · ห้ามใส่รหัสผ่านหรือ License key · ทุกการเพิ่ม/แก้มีบันทึกประวัติในระบบ ลบเครื่องไม่ได้ (เปลี่ยนสถานะเป็นยกเลิกการใช้งานแทน)</p>
        <div id="itrp-device-form-message" role="status"></div>
        <form id="itrp-device-form" novalidate>
          <div class="form-grid">
            <div class="field" data-field="code"><label for="itrp-device-code">รหัสเครื่อง ${edit ? "" : REQUIRED}</label><input class="input" id="itrp-device-code" name="code" maxlength="${model.MAX_DEVICE_CODE}" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(values.code)}"${edit ? " readonly" : ""}>${edit ? "<small>รหัสแก้ไม่ได้หลังสร้าง (ถ้าผิดให้เพิ่มรหัสใหม่)</small>" : ""}</div>
            <div class="field" data-field="kind"><label for="itrp-device-kind">ประเภท ${REQUIRED}</label><select class="select" id="itrp-device-kind" name="kind">${optionList(model.DEVICE_KINDS, values.kind)}</select></div>
            <div class="field" data-field="user_name"><label for="itrp-device-user">ผู้ใช้ (User)</label><input class="input" id="itrp-device-user" name="user_name" maxlength="200" autocomplete="off" value="${esc(values.user_name)}"></div>
            <div class="field" data-field="division"><label for="itrp-device-division">แผนก / ส่วนงาน (Section)</label><input class="input" id="itrp-device-division" name="division" maxlength="200" autocomplete="off" value="${esc(values.division)}"></div>
            <div class="field" data-field="cpu_name"><label for="itrp-device-cpu">Processor (CPU)</label><input class="input" id="itrp-device-cpu" name="cpu_name" maxlength="200" autocomplete="off" value="${esc(values.cpu_name)}"></div>
            <div class="field" data-field="cpu_model"><label for="itrp-device-cpu-model">รุ่น Processor</label><input class="input" id="itrp-device-cpu-model" name="cpu_model" maxlength="200" autocomplete="off" value="${esc(values.cpu_model)}"></div>
            ${dateField({ field: "started_on", id: "itrp-device-started", label: "เริ่มใช้วันที่ (ไม่บังคับ)", value: values.started_on })}
            <div class="field" data-field="asset_no"><label for="itrp-device-asset">เลขทะเบียนทรัพย์สินทางบัญชี</label><input class="input" id="itrp-device-asset" name="asset_no" maxlength="100" autocomplete="off" value="${esc(values.asset_no)}"></div>
            <div class="field" data-field="status"><label for="itrp-device-status">สถานะ ${REQUIRED}</label><select class="select" id="itrp-device-status" name="status">${optionList(model.DEVICE_STATUSES, values.status)}</select></div>
          </div>
          <div class="field" data-field="note"><label for="itrp-device-note">หมายเหตุ</label><textarea class="textarea" id="itrp-device-note" name="note" rows="2" maxlength="1000">${esc(values.note)}</textarea></div>
          <div class="form-actions"><button type="button" class="btn secondary" id="itrp-device-form-cancel">ยกเลิก</button><button type="submit" class="btn is-primary">${edit ? "บันทึกข้อมูลเครื่อง" : "เพิ่มเครื่อง"}</button></div>
        </form>
      </section>`;
  }

  // รอยแก้ของรายการประวัติ · data = ผลของ app_itrp_history_get · revisions = model.revisionsView(data) (เรียงเก่า → ใหม่ ฉบับก่อนแก้แต่ละครั้ง)
  function revisionsCard(data, revisions) {
    const entry = data?.entry ?? {};
    const meta = [`ลงโดย ${entry.created_by_full_name ?? "—"}`, entry.created_at ? model.formatDateTime(entry.created_at) : ""].filter(Boolean).join(" · ");
    const items = revisions.length
      ? revisions.map((revision) => `<article class="itrp-hist-revision" data-revision="${esc(revision.no)}">
          <h3>ครั้งที่ ${esc(revision.no)} · ${esc(revision.kindLabel)} <span class="muted small">โดย ${esc(revision.by)} · ${esc(revision.at)}</span></h3>
          ${revision.reason ? `<p class="itrp-text"><strong>เหตุผล:</strong> ${esc(revision.reason)}</p>` : ""}
          <p class="muted small">ฉบับเดิมก่อนการ${esc(revision.kindLabel)}ครั้งนี้</p>
          <dl class="definition-grid">${revision.fields.map((field) => `<div class="definition"><dt>${esc(field.label)}</dt><dd class="itrp-text">${esc(field.value)}</dd></div>`).join("")}</dl>
        </article>`).join("")
      : '<p class="muted">รายการนี้ยังไม่เคยถูกแก้ไข</p>';
    return `<section class="card itrp-hist-form-card" id="itrp-hist-revisions-card" aria-labelledby="itrp-hist-rev-title">
        <h2 id="itrp-hist-rev-title">รอยแก้ของรายการ${entry.doc_no ? ` ${esc(entry.doc_no)}` : ""} <span class="detail-section-count">${revisions.length}</span></h2>
        <p class="muted small">${esc(meta)}${entry.voided_at ? ` · ยกเลิกรายการแล้ว: ${esc(entry.void_reason ?? "")}` : ""}</p>
        ${items}
        <div class="form-actions"><button type="button" class="btn secondary" id="itrp-hist-rev-close">ปิด</button></div>
      </section>`;
  }

  /* ---------- ใบพิมพ์ FM02 (A4) ---------- */
  // หัวใบ: เริ่มใช้วันที่ / Computer Code / User / Section / Processor + กล่องเลขทะเบียนทรัพย์สินทางบัญชีทางขวา · ตาราง 7 คอลัมน์มีเส้น หัวตารางซ้ำทุกหน้า (CSS: display: table-header-group)
  // ไม่แสดงรายการที่ยกเลิก (RPC ไม่ส่งมาให้อยู่แล้ว) · ยาวเกินขึ้นหน้าใหม่ได้ · รหัสฟอร์มอยู่ใน tfoot (ตอนพิมพ์ซ้ำท้ายทุกหน้า ไม่ใช้ position: fixed เพราะอาจทับแถวสุดท้ายของตาราง)
  function printSheet(data) {
    const header = model.deviceHeader(data);
    const rows = model.historyRowsView(data?.rows);
    const isTest = Boolean(data?.is_test);
    const fields = [["เริ่มใช้วันที่", header.startedOn], ["Computer Code", header.code], ["User", header.user], ["Section", header.section], ["Processor", header.processor]];
    const body = rows.length
      ? rows.map((row) => `<tr>
          <td class="itrp-center">${esc(row.docNo)}</td>
          <td class="itrp-center">${esc(row.reportedOn)}</td>
          <td class="itrp-sheet-text">${esc(row.symptom)}</td>
          <td class="itrp-sheet-text">${esc(row.action)}</td>
          <td class="itrp-center">${esc(row.finishedOn)}</td>
          <td class="itrp-sheet-text">${esc(row.remark)}</td>
          <td>${esc(row.reporter)}</td></tr>`).join("")
      : `<tr><td colspan="${FM02_COLUMNS.length}" class="itrp-center">ยังไม่มีประวัติการซ่อม</td></tr>`;
    return `<article class="itrp-sheet itrp-fm02${isTest ? " is-test" : ""}" aria-label="${esc(PRINT_TITLE)} ${esc(header.code)}">
        ${isTest ? '<div class="itrp-watermark" aria-hidden="true">ทดสอบ</div>' : ""}
        <header class="itrp-sheet-title">
          <img class="itrp-sheet-logo" src="./icons/icon-192.png" alt="">
          <div class="itrp-fm02-title"><h1>${esc(PRINT_TITLE)}</h1><p>${esc(PRINT_SUBTITLE)}</p></div>
        </header>
        ${isTest ? '<p class="itrp-test-note">ข้อมูลทดสอบ — ไม่ใช่เอกสารจริง</p>' : ""}
        <div class="itrp-fm02-info">
          <dl class="itrp-fm02-fields">${fields.map(([label, value]) => `<div class="itrp-fm02-field"><dt>${esc(label)}:</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
          <div class="itrp-fm02-asset"><span>เลขทะเบียนทรัพย์สินทางบัญชี</span><strong>${esc(header.assetNo)}</strong></div>
        </div>
        <table class="itrp-sheet-table itrp-fm02-table"><thead><tr>${FM02_COLUMNS.map((label) => `<th scope="col">${esc(label)}</th>`).join("")}</tr></thead><tbody>${body}</tbody><tfoot><tr><td class="itrp-fm02-code" colspan="${FM02_COLUMNS.length}">${FORM_CODE}</td></tr></tfoot></table>
      </article>`;
  }
  function printPage(data) {
    const code = data?.code ?? "";
    return itrpPages().page(`<div class="itrp-print-toolbar no-print">
        <a class="btn secondary" href="${esc(model.historyUrl(code))}">‹ กลับไปประวัติการซ่อม</a>
        <button type="button" class="btn is-primary" id="itrp-history-print-button">พิมพ์</button>
      </div>
      ${printSheet(data)}`, { showDevNotice: false });
  }

  const api = {
    FM02_COLUMNS, FORM_CODE, deviceItems, countText, historyTable, historyPanel, panelPlaceholder, panelLoading, panelError, historyTab,
    historyFormCard, deviceFormCard, revisionsCard, printSheet, printPage,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITRP_HISTORY_PAGES = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
