// ใบสั่งวัตถุดิบของแผนก ST (โหมดทดสอบ) ขั้น 3.1 ของ workflow: สั่งวัตถุดิบตามความต้องการของใบสั่งผลิตที่ออกใบสั่งงานแล้ว → รับของเข้าคลัง
//
// view ที่ไฟล์นี้วาดให้รายการในเมนู Item master › สั่งวัตถุดิบ (modules/factory-item-master.js):
//   material-new  ใบสั่งวัตถุดิบ-ใหม่  เลือกใบสั่งผลิต (&wo=<id>) แล้วกรอกฟอร์มที่เสนอรายการขาดให้ · &mo=<id> แก้ฉบับร่าง
//   material      ใบสั่งวัตถุดิบ-ดู    รายการทุกใบ (กรองสถานะด้วย &status=) · &mo=<id> รายละเอียด + ปุ่มตามสถานะ
//
// ผู้ใช้สลับ persona เป็นพนักงาน ST ที่แถบสีเหลืองเพื่อทำแต่ละขั้น ปุ่มที่เห็นเลือกจากแผนกของ persona (modules/factory-material-model.js)
// แต่การควบคุมสิทธิ์จริงอยู่ที่ RPC ใน supabase/migrations/20261007040000_factory_material_order_workflow.sql ซึ่งตรวจโหมดทดสอบ แผนก สถานะ
// version และค่าทุกช่องเอง การรับของเพิ่มยอดคงคลังจริงในธุรกรรมเดียวกับการเปลี่ยนสถานะ — โหมดทดสอบไม่ส่งแจ้งเตือน
//
// โหลดหลัง modules/module-factory-production.js และก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (sb, state, escapeHtml, formatDate, showToast, friendlyError, setFormBusy, renderRoute) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// ทุก dropdown เป็น <select> ของเบราว์เซอร์ (แตะบน iPhone ได้ ไม่ต้องมีโค้ดปิด popup)
(function registerFactoryMaterialViews() {
  const model = window.MNP_FACTORY_MATERIAL_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { loadData, options, notice } = window.MNP_FACTORY_UI;

  // ลำดับสำคัญ: friendlyError ใช้คีย์แรกที่ปรากฏอยู่ในข้อความ รหัสใหม่ต้องไม่เป็นส่วนหนึ่งของรหัสอื่นที่ลงทะเบียนไว้ก่อนหน้า (มีเทสต์ตรวจ)
  const ERROR_MESSAGES = {
    MATERIAL_STORES_ONLY: "ขั้นนี้ทำได้เฉพาะแผนก ST (สั่งวัตถุดิบ) — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงาน ST",
    INVALID_MATERIAL_ORDER_DATE: "วันที่คาดว่าจะได้รับต้องไม่ก่อนวันนี้ และไม่เกิน 10 ปี",
    INVALID_MATERIAL_ORDER_SUPPLIER: "ชื่อผู้ขายยาวได้ไม่เกิน 200 ตัวอักษร",
    INVALID_MATERIAL_ORDER_NOTE: "หมายเหตุ/เหตุผลยาวได้ไม่เกิน 1,000 ตัวอักษร",
    INVALID_MATERIAL_ORDER_LINES: "รายการวัตถุดิบไม่ถูกต้อง (มีได้ไม่เกิน 100 รายการ)",
    INVALID_MATERIAL_ORDER_QTY: "ปริมาณต้องมากกว่า 0 และไม่เกิน 1,000,000,000",
    MATERIAL_ORDER_NO_LINES: "ต้องมีวัตถุดิบอย่างน้อย 1 รายการ",
    MATERIAL_ORDER_LINE_DUPLICATE: "มีวัตถุดิบซ้ำกันในใบเดียว",
    MATERIAL_ORDER_LINE_UNKNOWN: "ไม่พบวัตถุดิบที่เลือก (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    MATERIAL_ORDER_LINE_INVALID: "มีวัตถุดิบที่หยุดใช้งานหรือไม่ได้จัดซื้อ (ผลิตเอง) กรุณาตรวจ Item นั้นแล้วแก้ใบ",
    MATERIAL_WORK_ORDER_UNKNOWN: "ไม่พบใบสั่งผลิตนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    MATERIAL_WORK_ORDER_NOT_RELEASED: "สั่งวัตถุดิบได้เฉพาะใบสั่งผลิตที่ออกใบสั่งงานแล้ว",
    MATERIAL_ORDER_NOT_FOUND: "ไม่พบใบสั่งวัตถุดิบนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    MATERIAL_ORDER_VERSION_CONFLICT: "ใบสั่งวัตถุดิบนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจรายการล่าสุดแล้วทำอีกครั้ง",
    MATERIAL_ORDER_NOT_EDITABLE: "แก้ไขได้เฉพาะฉบับร่าง (สั่งแล้วให้ยกเลิกแล้วออกใบใหม่)",
    MATERIAL_ORDER_NOT_DRAFT: "สั่งวัตถุดิบได้เฉพาะฉบับร่าง",
    MATERIAL_ORDER_NOT_ORDERED: "รับของได้เฉพาะใบที่สั่งแล้วและยังไม่ได้รับของ (อาจรับไปแล้วหรือยกเลิกแล้ว)",
    MATERIAL_ORDER_NOT_CANCELLABLE: "ยกเลิกได้เฉพาะใบที่เป็นฉบับร่างหรือสั่งแล้วและยังไม่ได้รับของ",
    MATERIAL_CANCEL_NOTE_REQUIRED: "กรุณาระบุเหตุผลที่ยกเลิก",
  };
  Object.assign(window.MNP_FACTORY_ERRORS, ERROR_MESSAGES);

  const q4 = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 4 });
  const dept = () => state.employee?.department?.code ?? null;
  const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const viewUrl = (id) => menu.url("material-view", { mo: id });
  const poUrl = (id) => menu.url("production-view", { po: id });
  const person = (name, at) => (name || at ? `${escapeHtml(name ?? "—")}${at ? ` · ${formatDate(at, true)}` : ""}` : "—");
  const statusBadge = (status) => `<span class="badge ${escapeHtml(model.BADGE_CLASS[status] ?? "")}">${escapeHtml(model.MATERIAL_STATUSES[status] ?? status)}</span>`;
  const byId = (rows, id) => (rows ?? []).find((row) => row.id === id) ?? null;

  // ปุ่มเรียก RPC หนึ่งครั้ง: ปิดปุ่มระหว่างทำ สำเร็จแล้ววาดหน้าใหม่ ผิดพลาดแจ้งเตือนและวาดใหม่เมื่อสถานะในหน้าล้าสมัย
  const STALE_CODES = ["MATERIAL_ORDER_VERSION_CONFLICT", "MATERIAL_ORDER_NOT_", "MATERIAL_ORDER_NOT_FOUND"];
  // files = ไฟล์ที่แนบมากับการกระทำ (ช่องแนบของฟอร์มยกเลิก) อัปโหลดหลังการกระทำสำเร็จ พลาดไม่ย้อนการกระทำ
  async function runAction(root, rpc, args, successMessage, files = []) {
    const controls = root.querySelectorAll("[data-mo-action], .mo-form button");
    controls.forEach((control) => { control.disabled = true; });
    try {
      const { error } = await sb.rpc(rpc, args);
      if (error) throw error;
      const warning = await window.MNP_FACTORY_ATTACHMENTS.upload("material_order", args.p_id, files);
      showToast(warning || successMessage, warning ? "error" : "success");
      await renderRoute();
    } catch (error) {
      showToast(friendlyError(error), "error");
      if (STALE_CODES.some((code) => String(error?.message ?? "").includes(code))) await renderRoute();
      else controls.forEach((control) => { control.disabled = false; });
    }
  }

  // ---------- รายการ ----------
  const STATUS_FILTERS = ["all", ...Object.keys(model.MATERIAL_STATUSES)];
  const listUrl = (status) => menu.url("material-view", { status: status !== "all" ? status : null });

  function listHtml(data, params) {
    const orders = data.material_orders ?? [];
    const wanted = STATUS_FILTERS.includes(params.get("status")) ? params.get("status") : "all";
    const counts = model.countByStatus(orders);
    const rows = orders.filter((order) => wanted === "all" || order.status === wanted);
    const filters = STATUS_FILTERS.map((status) => {
      const count = status === "all" ? orders.length : counts[status];
      const text = status === "all" ? "ทั้งหมด" : model.MATERIAL_STATUSES[status];
      return `<a class="filter${wanted === status ? " active" : ""}" href="${escapeHtml(listUrl(status))}"${wanted === status ? ' aria-current="page"' : ""}>${escapeHtml(text)} (${count})</a>`;
    }).join("");
    if (!orders.length) {
      return `<section class="card"><div class="empty">ยังไม่มีใบสั่งวัตถุดิบในโหมดทดสอบ<br><small>ใบสั่งผลิตต้องออกใบสั่งงานแล้ว (ขั้น 1–2) แผนก ST จึงออกใบสั่งวัตถุดิบได้</small>
          <div class="fm-actions"><a class="btn" href="${escapeHtml(menu.url("material-new"))}"><span class="plus-icon" aria-hidden="true"></span> ออกใบสั่งวัตถุดิบ</a>
          <a class="btn secondary" href="${escapeHtml(menu.url("production-view"))}">ไปที่ใบสั่งผลิต</a></div></div></section>`;
    }
    const body = rows.map((order) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(viewUrl(order.id))}"><strong>${escapeHtml(order.code)}</strong><span>${escapeHtml(order.supplier || "—")}</span></a></td>
        <td><a href="${escapeHtml(poUrl(order.production_order_id))}">${escapeHtml(order.production_code)}</a><br><span class="muted small">${escapeHtml(order.item_code)}</span></td>
        <td class="right">${(order.lines ?? []).length} รายการ</td>
        <td>${formatDate(order.expected_date)}</td>
        <td>${statusBadge(order.status)}</td>
        <td class="right"><a class="btn secondary small" href="${escapeHtml(viewUrl(order.id))}" aria-label="เปิด ${escapeHtml(order.code)}">เปิด</a></td>
      </tr>`).join("");
    return `<section class="card">
        <nav class="filters" aria-label="สถานะใบสั่งวัตถุดิบ">${filters}</nav>
        ${rows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>เลขที่ใบ / ผู้ขาย</th><th>ใบสั่งผลิต</th><th class="right">รายการ</th><th>คาดว่าจะได้รับ</th><th>สถานะ</th><th class="right">จัดการ</th></tr></thead>
          <tbody>${body}</tbody></table></div>` : '<div class="empty">ไม่มีใบสั่งวัตถุดิบในสถานะนี้</div>'}
      </section>`;
  }

  // ---------- รายละเอียดและปุ่มตามสถานะ ----------
  function actionsHtml(order) {
    const actions = model.materialActions(order, dept());
    const buttons = [];
    if (actions.includes("edit")) buttons.push(`<a class="btn secondary" href="${escapeHtml(menu.url("material-new", { mo: order.id }))}">แก้ไขฉบับร่าง</a>`);
    if (actions.includes("place")) buttons.push('<button class="btn" type="button" data-mo-action="place">สั่งวัตถุดิบ</button>');
    if (actions.includes("receive")) buttons.push('<button class="btn" type="button" data-mo-action="receive">ยืนยันรับของเข้าคลัง</button>');
    const hint = !actions.length && model.OPEN_STATUSES.includes(order.status)
      ? notice("ใบนี้เป็นงานของแผนก ST — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองด้านบนเป็นพนักงาน ST เพื่อสั่ง รับของ หรือยกเลิก") : "";
    const cancelForm = actions.includes("cancel")
      ? `<form class="fm-form mo-form" id="mo-cancel-form" novalidate>
          <div class="field full"><label for="mo-cancel-note">ยกเลิกใบนี้ — เหตุผล *</label>
            <textarea class="textarea" id="mo-cancel-note" name="note" rows="2" maxlength="1000" required></textarea></div>
          ${window.MNP_FACTORY_ATTACHMENTS.fieldHtml("mo-cancel-files")}
          <div class="fm-actions"><button class="btn danger" type="submit">ยกเลิกใบสั่งวัตถุดิบ</button></div>
        </form>` : "";
    if (!buttons.length && !cancelForm && !hint) return "";
    return `<section class="card fm-decision"><h2>ขั้นถัดไป</h2>${hint}
        ${buttons.length ? `<div class="fm-actions">${buttons.join("")}</div>` : ""}${cancelForm}</section>`;
  }

  function statusNotice(order) {
    switch (order.status) {
      case "draft": return notice("ฉบับร่าง ยังไม่ได้สั่งผู้ขาย แก้ไขได้ — กด “สั่งวัตถุดิบ” เมื่อพร้อม");
      case "ordered": return notice("สั่งผู้ขายแล้ว รอของมาถึง — เมื่อได้รับของให้กด “ยืนยันรับของเข้าคลัง” ระบบจะเพิ่มยอดคงคลังเข้าคลัง RM (แก้ไขไม่ได้แล้ว ถ้าสั่งผิดให้ยกเลิกแล้วออกใบใหม่)");
      case "received": return notice("รับของเข้าคลังแล้ว ยอดคงคลังเพิ่มตามใบนี้ — ดูที่ “สินค้าคงคลัง-ดู”");
      case "cancelled": return notice(`ยกเลิกแล้ว${order.cancel_note ? ` เหตุผล: “${order.cancel_note}”` : ""}`);
      default: return "";
    }
  }

  function timelineHtml(entries) {
    if (!entries.length) return '<p class="muted small">ยังไม่มีประวัติ</p>';
    return `<div class="table-wrap"><table>
        <thead><tr><th>เวลา</th><th>การกระทำ</th><th>รุ่น</th><th>ผู้ทำรายการ</th><th>หมายเหตุ / เหตุผล</th></tr></thead>
        <tbody>${entries.map((entry) => `<tr>
          <td>${formatDate(entry.created_at, true)}</td>
          <td>${escapeHtml(model.HISTORY_ACTIONS[entry.action] ?? entry.action)}</td>
          <td>${escapeHtml(entry.version)}</td>
          <td>${escapeHtml(entry.changed_by_name ?? "—")}</td>
          <td class="fm-pre">${escapeHtml(entry.note || "—")}</td>
        </tr>`).join("")}</tbody></table></div>`;
  }

  function detailHtml(data, order) {
    const lines = (order.lines ?? []).map((line) => `<tr>
        <td>${escapeHtml(line.line_no)}</td><td><strong>${escapeHtml(line.code)}</strong> <span class="muted small">${escapeHtml(line.name)}</span></td>
        <td class="right">${q4(line.quantity)} ${escapeHtml(line.unit_code)}</td></tr>`).join("");
    return `<section class="card fm-detail">
        <div class="fm-detail-head"><div><div class="eyebrow">${escapeHtml(order.code)}</div>
          <h2>สั่งวัตถุดิบสำหรับ <a href="${escapeHtml(poUrl(order.production_order_id))}">${escapeHtml(order.production_code)}</a> · ${escapeHtml(order.item_code)}</h2></div>${statusBadge(order.status)}</div>
        ${statusNotice(order)}
        <dl class="definition-grid">
          <div class="definition"><dt>ผู้ขาย</dt><dd>${escapeHtml(order.supplier || "—")}</dd></div>
          <div class="definition"><dt>คาดว่าจะได้รับ</dt><dd>${formatDate(order.expected_date)}</dd></div>
          <div class="definition"><dt>ออกใบโดย (แผนก ST)</dt><dd>${person(order.created_by_name, order.created_at)}</dd></div>
          <div class="definition"><dt>สั่งผู้ขาย</dt><dd>${person(order.ordered_by_name, order.ordered_at)}</dd></div>
          <div class="definition"><dt>รับของเข้าคลัง</dt><dd>${person(order.received_by_name, order.received_at)}</dd></div>
          <div class="definition"><dt>ยกเลิก</dt><dd>${person(order.cancelled_by_name, order.cancelled_at)}</dd></div>
        </dl>
        ${order.note ? `<h3>หมายเหตุ</h3><p class="fm-pre">${escapeHtml(order.note)}</p>` : ""}
        <h3>วัตถุดิบที่สั่ง</h3>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>วัตถุดิบ</th><th class="right">ปริมาณ</th></tr></thead><tbody>${lines}</tbody></table></div>
        <h3>ประวัติของใบนี้</h3>
        ${timelineHtml(model.orderTimeline(data.material_history, order.id))}
      </section>
      ${window.MNP_FACTORY_ATTACHMENTS.panelHtml("material_order", order.id)}`;
  }

  function bindDetail(root, order) {
    const args = { p_id: order.id, p_version: order.version };
    const act = (name, rpc, message) => root.querySelector(`[data-mo-action="${name}"]`)?.addEventListener("click", () => runAction(root, rpc, args, message));
    act("place", "app_factory_place_material_order", `สั่งวัตถุดิบตาม ${order.code} แล้ว`);
    act("receive", "app_factory_receive_material_order", `รับของตาม ${order.code} เข้าคลังแล้ว ยอดคงคลังเพิ่มขึ้น`);
    const cancelForm = root.querySelector("#mo-cancel-form");
    cancelForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!cancelForm.reportValidity()) return;
      let files;
      try {
        files = window.MNP_FACTORY_ATTACHMENTS.read(cancelForm.elements.extra_files);
      } catch (error) {
        showToast(friendlyError(error), "error");
        return;
      }
      if (!confirm(`ยกเลิก ${order.code}?`)) return;
      runAction(root, "app_factory_cancel_material_order", { ...args, p_note: cancelForm.querySelector("textarea").value }, `ยกเลิก ${order.code} แล้ว`, files);
    });
  }

  // ---------- ฟอร์มออกใบ ----------
  // แถวของรายการ: ที่เสนอจากผลสำรวจคงคลัง + ที่อยู่ในฉบับร่างเดิม (ปริมาณตั้งต้น = ของเดิม ถ้าไม่มี = ที่เสนอ) ผู้ใช้แก้ปริมาณหรือเว้นว่างเพื่อไม่สั่ง
  function lineRows(data, workOrder, order) {
    const calculated = model.materialNeeds(data, workOrder, order?.id ?? null);
    const needs = calculated ?? [];
    const existing = new Map((order?.lines ?? []).map((line) => [line.item_id, line]));
    const rows = needs.filter((need) => need.purchasable).map((need) => ({ ...need, value: existing.has(need.item_id) ? Number(existing.get(need.item_id).quantity) : need.suggest }));
    for (const line of order?.lines ?? []) {
      if (!rows.some((row) => row.item_id === line.item_id)) rows.push({ item_id: line.item_id, code: line.code, name: line.name, unit_code: line.unit_code, net: 0, onOrder: 0, suggest: 0, value: Number(line.quantity), purchasable: true });
    }
    return { rows, blocked: needs.filter((need) => !need.purchasable), hasBom: calculated !== null };
  }

  function formHtml(data, workOrder, order) {
    const editing = Boolean(order);
    const { rows, blocked, hasBom } = lineRows(data, workOrder, order);
    const items = model.purchasableItems(data.items);
    const wrongDept = dept() !== model.STORES_DEPARTMENT
      ? notice("ขั้นนี้เป็นของแผนก ST — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงาน ST ก่อนบันทึก (ฐานข้อมูลจะปฏิเสธผู้ใช้แผนกอื่น)") : "";
    const suggestedRows = rows.map((row) => `<tr>
        <td><strong>${escapeHtml(row.code)}</strong> <span class="muted small">${escapeHtml(row.name)}</span></td>
        <td class="right">${q4(row.net)} ${escapeHtml(row.unit_code)}</td>
        <td class="right">${q4(row.onOrder)}</td>
        <td class="right"><label class="sr-only" for="mo-qty-${escapeHtml(row.item_id)}">ปริมาณที่สั่ง ${escapeHtml(row.code)}</label>
          <input class="input" id="mo-qty-${escapeHtml(row.item_id)}" name="qty:${escapeHtml(row.item_id)}" type="number" inputmode="decimal" min="0" max="${model.MAX_QUANTITY}" step="any" value="${row.value > 0 ? escapeHtml(row.value) : ""}"> ${escapeHtml(row.unit_code)}</td>
      </tr>`).join("");
    const itemOptions = [["", "— เลือกวัตถุดิบเพิ่ม —"], ...items.map((item) => [item.id, `${item.code} · ${item.name} (${item.unit_code})`])];
    const extraRows = Array.from({ length: model.EXTRA_ROWS }, (_, index) => {
      const n = index + 1;
      return `<div class="field-row"><div class="field"><label for="mo-extra-item-${n}">เพิ่มรายการ ${n}</label><select class="select" id="mo-extra-item-${n}" name="extra_item_${n}">${options(itemOptions, "")}</select></div>
          <div class="field"><label for="mo-extra-qty-${n}">ปริมาณ</label><input class="input" id="mo-extra-qty-${n}" name="extra_qty_${n}" type="number" inputmode="decimal" min="0" max="${model.MAX_QUANTITY}" step="any"></div></div>`;
    }).join("");
    const blockedNote = blocked.length
      ? notice(`ต้องผลิตเอง/ทำ BOM ก่อน สั่งซื้อไม่ได้: ${blocked.map((row) => `${row.code} ขาด ${q4(row.net)} ${row.unit_code}`).join(", ")}`) : "";
    return `<section class="card">
        ${wrongDept}
        <form class="fm-form mo-form" id="mo-form" novalidate>
          <p class="muted small">ใบสั่งผลิต <a href="${escapeHtml(poUrl(workOrder.id))}"><strong>${escapeHtml(workOrder.code)}</strong></a> · ${escapeHtml(workOrder.item_code)} ${escapeHtml(workOrder.name)} · ${q4(workOrder.planned_qty)} ${escapeHtml(workOrder.unit_code)} · เลขที่ใบสั่งวัตถุดิบระบบออกให้เมื่อบันทึกครั้งแรก</p>
          <div class="fm-form-error" id="mo-form-error" role="alert" hidden></div>
          <div class="field-row">
            <div class="field"><label for="mo-supplier">ผู้ขาย</label><input class="input" id="mo-supplier" name="supplier" maxlength="200" value="${escapeHtml(order?.supplier ?? "")}"></div>
            <div class="field"><label for="mo-date">คาดว่าจะได้รับ *</label><input class="input" id="mo-date" name="expected_date" type="date" required min="${today()}" value="${escapeHtml(order?.expected_date ?? "")}"></div>
          </div>
          <h3>วัตถุดิบที่ขาดตามผลสำรวจคงคลัง</h3>
          ${hasBom ? "" : notice("ใบสั่งผลิตนี้ไม่มี BOM ที่อนุมัติแล้ว จึงคำนวณรายการที่ขาดให้ไม่ได้ — เพิ่มรายการเองด้านล่าง")}
          ${blockedNote}
          ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>วัตถุดิบ</th><th class="right">ขาด</th><th class="right">สั่งไว้แล้ว (ยังไม่รับ)</th><th class="right">ปริมาณที่สั่ง</th></tr></thead><tbody>${suggestedRows}</tbody></table></div>
            <p class="muted small">ปริมาณตั้งต้น = ขาด − สั่งไว้แล้ว เว้นว่างหรือ 0 = ไม่สั่งรายการนั้น</p>`
            : '<p class="muted small">ไม่มีรายการที่ต้องสั่งเพิ่มตามผลสำรวจ (ของพอ หรือสั่งไว้แล้ว)</p>'}
          <h3>เพิ่มวัตถุดิบอื่น</h3>
          ${extraRows}
          <div class="field full"><label for="mo-note">หมายเหตุ</label><textarea class="textarea" id="mo-note" name="note" rows="2" maxlength="1000">${escapeHtml(order?.note ?? "")}</textarea></div>
          ${window.MNP_FACTORY_ATTACHMENTS.fieldHtml("mo-files")}
          <div class="fm-actions">
            <button class="btn secondary" type="submit" data-intent="save">บันทึกฉบับร่าง</button>
            <button class="btn" type="submit" data-intent="place">บันทึกและสั่งวัตถุดิบ</button>
            <a class="btn secondary" href="${escapeHtml(editing ? viewUrl(order.id) : menu.url("material-view"))}">ยกเลิก</a>
          </div>
        </form>
      </section>`;
  }

  function chooseHtml(data) {
    const orders = model.orderableWorkOrders(data.production);
    if (!orders.length) {
      return `<section class="card"><div class="empty">ยังไม่มีใบสั่งผลิตที่ออกใบสั่งงานแล้ว<br><small>ฝ่ายขายออกใบ → ฝ่ายวางแผนรับ วางแผน และออกใบสั่งงาน (ขั้น 1–2) ก่อน</small>
        <div class="fm-actions"><a class="btn secondary" href="${escapeHtml(menu.url("production-view"))}">ไปที่ใบสั่งผลิต</a></div></div></section>`;
    }
    const rows = orders.map((order) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(poUrl(order.id))}"><strong>${escapeHtml(order.code)}</strong><span>${escapeHtml(order.work_order_no ? `ใบสั่งงาน ${order.work_order_no}` : "—")}</span></a></td>
        <td><strong>${escapeHtml(order.item_code)}</strong><br><span class="muted small">${escapeHtml(order.name)}</span></td>
        <td class="right">${q4(order.planned_qty)} ${escapeHtml(order.unit_code)}</td>
        <td class="right">${model.ordersOf(data.material_orders, order.id).length} ใบ</td>
        <td class="right"><a class="btn small" href="${escapeHtml(menu.url("material-new", { wo: order.id }))}">สั่งวัตถุดิบ</a></td>
      </tr>`).join("");
    return `<section class="card"><h2>เลือกใบสั่งผลิตที่ต้องการสั่งวัตถุดิบ</h2>
        <p class="muted small">เฉพาะใบที่ออกใบสั่งงานแล้ว (ขั้น 2.4) · ระบบเสนอรายการที่ขาดตามผลสำรวจคงคลังของใบนั้น</p>
        <div class="table-wrap"><table><thead><tr><th>ใบสั่งผลิต</th><th>สินค้า</th><th class="right">จำนวน</th><th class="right">ใบสั่งวัตถุดิบ</th><th class="right">จัดการ</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function bindForm(root, data, workOrder, order) {
    const form = root.querySelector("#mo-form");
    const errorBox = root.querySelector("#mo-form-error");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const intent = event.submitter?.dataset?.intent ?? "save";
      const values = { ...Object.fromEntries(new FormData(form).entries()), production_order_id: workOrder.id };
      const payload = model.materialPayload(values, order);
      const problems = model.validateMaterialPayload(payload, data.items, data.production, today());
      let files = [];
      try {
        files = window.MNP_FACTORY_ATTACHMENTS.read(form.elements.extra_files);
      } catch (fileError) {
        problems.push(friendlyError(fileError));
      }
      if (problems.length) {
        errorBox.textContent = problems.join(" · ");
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: "nearest" });
        return;
      }
      setFormBusy(form, true);
      let saved = null;
      let fileWarning = "";
      try {
        const result = await sb.rpc("app_factory_save_material_order", payload);
        if (result.error) throw result.error;
        saved = result.data;
        fileWarning = await window.MNP_FACTORY_ATTACHMENTS.upload("material_order", saved.id, files);
        if (intent === "place") {
          const placed = await sb.rpc("app_factory_place_material_order", { p_id: saved.id, p_version: saved.version });
          if (placed.error) throw placed.error;
          showToast(fileWarning || `สั่งวัตถุดิบตาม ${saved.code} แล้ว`, fileWarning ? "error" : "success");
        } else {
          showToast(fileWarning || (order ? "บันทึกฉบับร่างแล้ว" : `ออกใบสั่งวัตถุดิบ ${saved.code} (ฉบับร่าง) แล้ว`), fileWarning ? "error" : "success");
        }
        location.hash = viewUrl(saved.id).slice(1);
      } catch (error) {
        // ฉบับร่างที่บันทึกสำเร็จแต่สั่งไม่สำเร็จยังอยู่ในระบบ: พาไปหน้าใบเพื่อสั่งใหม่ ไม่ปล่อยให้กดบันทึกซ้ำจนเกิดใบซ้ำ
        if (saved) {
          showToast(`บันทึก ${saved.code} เป็นฉบับร่างแล้ว แต่สั่งไม่สำเร็จ: ${friendlyError(error)}${fileWarning ? ` · ${fileWarning}` : ""}`, "error");
          location.hash = viewUrl(saved.id).slice(1);
          return;
        }
        setFormBusy(form, false);
        errorBox.textContent = friendlyError(error);
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: "nearest" });
      }
    });
  }

  // ---------- ลงทะเบียน view ----------
  const newOrderAction = () => `<a class="btn" href="${escapeHtml(menu.url("material-new"))}"><span class="plus-icon" aria-hidden="true"></span> ออกใบสั่งวัตถุดิบ</a>`;
  const gone = (back, text = ERROR_MESSAGES.MATERIAL_ORDER_NOT_FOUND) => ({ back, body: `<section class="card"><div class="empty">${escapeHtml(text)}</div></section>` });

  const VIEWS = {
    async material({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const id = params.get("mo");
      const back = { href: menu.url("material-view"), label: "‹ กลับรายการใบสั่งวัตถุดิบ" };
      if (id) {
        const order = byId(data.material_orders, id);
        if (!order) return frame.paint(gone(back));
        const root = frame.paint({ back, subtitle: order.code, body: `${actionsHtml(order)}${detailHtml(data, order)}` });
        return bindDetail(root, order);
      }
      return frame.paint({ actions: newOrderAction(), body: listHtml(data, params) });
    },
    async "material-new"({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const mo = params.get("mo");
      const wo = params.get("wo");
      const back = { href: menu.url("material-view"), label: "‹ กลับรายการใบสั่งวัตถุดิบ" };
      if (mo) {
        const order = byId(data.material_orders, mo);
        if (!order) return frame.paint(gone(back));
        const detailBack = { href: viewUrl(order.id), label: "‹ กลับรายละเอียด" };
        if (order.status !== "draft") {
          return frame.paint({ back: detailBack, subtitle: order.code,
            body: `<section class="card">${notice(ERROR_MESSAGES.MATERIAL_ORDER_NOT_EDITABLE)}<div class="fm-actions"><a class="btn secondary" href="${escapeHtml(viewUrl(order.id))}">ดูใบนี้</a></div></section>` });
        }
        const workOrder = byId(data.production, order.production_order_id);
        if (!workOrder) return frame.paint(gone(detailBack, ERROR_MESSAGES.MATERIAL_WORK_ORDER_UNKNOWN));
        const root = frame.paint({ back: detailBack, subtitle: `แก้ไข ${order.code}`, body: `${statusNotice(order)}${formHtml(data, workOrder, order)}` });
        return bindForm(root, data, workOrder, order);
      }
      if (wo) {
        const workOrder = byId(data.production, wo);
        if (!workOrder) return frame.paint(gone(back, ERROR_MESSAGES.MATERIAL_WORK_ORDER_UNKNOWN));
        if (!["released", "in_progress"].includes(workOrder.status)) {
          return frame.paint({ back, body: `<section class="card">${notice(ERROR_MESSAGES.MATERIAL_WORK_ORDER_NOT_RELEASED)}<div class="fm-actions"><a class="btn secondary" href="${escapeHtml(poUrl(workOrder.id))}">ดูใบสั่งผลิต ${escapeHtml(workOrder.code)}</a></div></section>` });
        }
        const root = frame.paint({ back, subtitle: workOrder.code, body: formHtml(data, workOrder, null) });
        return bindForm(root, data, workOrder, null);
      }
      return frame.paint({ body: chooseHtml(data) });
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
