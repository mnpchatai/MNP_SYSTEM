// ใบสั่งผลิตของฝ่ายโรงงาน (โหมดทดสอบ) ขั้น 1–2 ของ workflow: ฝ่ายขายออกใบ/ส่ง → ฝ่ายวางแผนรับ/สำรวจคงคลัง/เลือก BOM+Routing/ออกใบสั่งงาน
//
// view ที่ไฟล์นี้วาดให้รายการในเมนู Item master › ใบสั่งผลิต (modules/factory-item-master.js):
//   production-new       ใบสั่งผลิต-ใหม่           ฟอร์มออกใบ (ฝ่ายขาย SA) · &po=<id> แก้ฉบับร่าง
//   production-planning  ใบสั่งผลิต-ฝ่ายวางแผน     คิวของฝ่ายวางแผน (PP): รอรับ · กำลังวางแผน · รอออกใบสั่งงาน
//   production           ใบสั่งผลิต-ดู             รายการทุกใบ (กรองสถานะด้วย &status=) · &po=<id> รายละเอียด + ปุ่มตามสถานะและแผนก
//
// ผู้ใช้สลับ persona ที่แถบสีเหลือง (พนักงานขาย SA / พนักงานวางแผน PP) เพื่อทำแต่ละขั้น ปุ่มที่เห็นเลือกจากแผนกของ persona (ตรรกะใน
// modules/factory-production-model.js) แต่การควบคุมสิทธิ์จริงอยู่ที่ RPC ใน supabase/migrations/20261007030000_factory_production_order_workflow.sql
// ซึ่งตรวจโหมดทดสอบ แผนก สถานะปัจจุบัน version และค่าทุกช่องเอง — โหมดทดสอบไม่ส่งแจ้งเตือน ฝ่ายวางแผนเห็นใบที่ส่งมาจากคิวหน้า "ฝ่ายวางแผน"
//
// โหลดหลัง modules/module-factory-master.js / module-factory-bom.js และก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (sb, state, escapeHtml, formatDate, showToast, friendlyError, setFormBusy, renderRoute) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// ทุก dropdown เป็น <select> ของเบราว์เซอร์ (แตะบน iPhone ได้ ไม่ต้องมีโค้ดปิด popup)
(function registerFactoryProductionViews() {
  const model = window.MNP_FACTORY_PRODUCTION_MODEL;
  const master = window.MNP_FACTORY_MASTER_MODEL;
  const materials = window.MNP_FACTORY_MATERIAL_MODEL;
  const jobs = window.MNP_FACTORY_JOB_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { loadData, options, notice } = window.MNP_FACTORY_UI;

  // ลำดับสำคัญ: friendlyError ใช้คีย์แรกที่ปรากฏอยู่ในข้อความ รหัสใหม่ต้องไม่เป็นส่วนหนึ่งของรหัสอื่นที่ลงทะเบียนไว้ก่อนหน้า (มีเทสต์ตรวจ)
  const ERROR_MESSAGES = {
    PRODUCTION_SALES_ONLY: "ขั้นนี้ทำได้เฉพาะแผนกขาย (SA) — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานขาย",
    PRODUCTION_PLANNING_ONLY: "ขั้นนี้ทำได้เฉพาะฝ่ายวางแผน (PP) — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานวางแผน",
    INVALID_PRODUCTION_QTY: "จำนวนที่สั่งผลิตต้องมากกว่า 0 และไม่เกิน 1,000,000,000",
    INVALID_PRODUCTION_DUE_DATE: "กำหนดเสร็จต้องไม่ก่อนวันนี้ และไม่เกิน 10 ปี",
    INVALID_PRODUCTION_CUSTOMER: "ชื่อลูกค้า/อ้างอิงยาวได้ไม่เกิน 200 ตัวอักษร",
    INVALID_PRODUCTION_NOTE: "หมายเหตุยาวได้ไม่เกิน 1,000 ตัวอักษร",
    PRODUCTION_PRODUCT_NOT_FOUND: "ไม่พบสินค้านี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    PRODUCTION_ITEM_INVALID: "สินค้าต้องเป็นสินค้าสำเร็จรูป (FG) ที่ใช้งานอยู่และผลิตเองได้",
    PRODUCTION_ORDER_NOT_FOUND: "ไม่พบใบสั่งผลิตนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    PRODUCTION_ORDER_VERSION_CONFLICT: "ใบสั่งผลิตนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจรายการล่าสุดแล้วทำอีกครั้ง",
    PRODUCTION_ORDER_NOT_EDITABLE: "แก้ไขได้เฉพาะฉบับร่าง (ถ้าส่งไปแล้วให้ถอนกลับมาแก้ไขก่อน)",
    PRODUCTION_ORDER_NOT_DRAFT: "ส่งให้ฝ่ายวางแผนได้เฉพาะฉบับร่าง",
    PRODUCTION_ORDER_NOT_SUBMITTED: "ใบนี้ไม่ได้อยู่ในสถานะรอฝ่ายวางแผนรับแล้ว (ฝ่ายวางแผนอาจรับไปแล้ว)",
    PRODUCTION_ORDER_NOT_RECEIVABLE: "ส่งกลับได้เฉพาะใบที่รอรับหรือกำลังวางแผน",
    PRODUCTION_ORDER_NOT_PLANNING: "วางแผนได้เฉพาะใบที่ฝ่ายวางแผนรับแล้ว และยังไม่ออกใบสั่งงาน",
    PRODUCTION_ORDER_NOT_PLANNED: "ออกใบสั่งงานได้เฉพาะใบที่วางแผนแล้ว",
    PRODUCTION_RETURN_NOTE_REQUIRED: "กรุณาระบุเหตุผลที่ส่งกลับ",
    PRODUCTION_CANCEL_NOTE_REQUIRED: "กรุณาระบุเหตุผลที่ยกเลิกใบสั่งผลิต",
    PRODUCTION_ORDER_NOT_CANCELLABLE: "ยกเลิกได้เฉพาะใบที่ฝ่ายวางแผนรับแล้วจนถึงกำลังผลิต (ฉบับร่าง/รอรับให้ฝ่ายขายถอนกลับหรือฝ่ายวางแผนส่งกลับ) ใบที่ผลิตเสร็จหรือยกเลิกไปแล้วยกเลิกไม่ได้",
    PRODUCTION_ORDER_HAS_JOBS: "ยกเลิกไม่ได้เพราะยังมีใบงานผลิตที่ยังไม่ยกเลิก (ยกเลิกใบงานก่อน ใบงานที่ผลิตเสร็จแล้วมีผลผลิตเข้าคลัง จึงยกเลิกใบสั่งผลิตไม่ได้)",
    PRODUCTION_ORDER_HAS_MATERIAL_ORDERS: "ยกเลิกไม่ได้เพราะยังมีใบสั่งวัตถุดิบที่ยังไม่รับของหรือยังไม่ยกเลิก (ให้แผนก ST ยกเลิกก่อน)",
    PRODUCTION_SURVEY_REQUIRED: "กรุณาบันทึกผลสำรวจคงคลังก่อนวางแผน",
    PRODUCTION_BOM_INVALID: "BOM ต้องเป็นฉบับที่อนุมัติแล้วของสินค้านี้ (ถ้าถูกเลิกใช้ ให้เลือกฉบับล่าสุดและวางแผนใหม่)",
    PRODUCTION_ROUTING_INVALID: "Routing ต้องเป็นของสินค้านี้และยังไม่เลิกใช้",
  };
  Object.assign(window.MNP_FACTORY_ERRORS, ERROR_MESSAGES);

  const q4 = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 4 });
  const dept = () => state.employee?.department?.code ?? null;
  const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const viewUrl = (id) => menu.url("production-view", { po: id });
  const person = (name, at) => (name || at ? `${escapeHtml(name ?? "—")}${at ? ` · ${formatDate(at, true)}` : ""}` : "—");
  const statusBadge = (status) => `<span class="badge ${escapeHtml(model.BADGE_CLASS[status] ?? "")}">${escapeHtml(model.ORDER_STATUSES[status] ?? status)}</span>`;
  const deptName = (code) => (code === model.SALES_DEPARTMENT ? "ฝ่ายขาย (SA)" : code === model.PLANNING_DEPARTMENT ? "ฝ่ายวางแผน (PP)" : "แผนกอื่น");
  const byId = (rows, id) => (rows ?? []).find((row) => row.id === id) ?? null;

  // ปุ่มเรียก RPC หนึ่งครั้ง: ปิดปุ่มระหว่างทำ สำเร็จแล้ววาดหน้าใหม่ ผิดพลาดแจ้งเตือนและวาดใหม่เมื่อสถานะในหน้าล้าสมัย
  const STALE_CODES = ["PRODUCTION_ORDER_VERSION_CONFLICT", "PRODUCTION_ORDER_NOT_", "PRODUCTION_ORDER_NOT_FOUND"];
  // files = ไฟล์ที่แนบมากับการกระทำ (ช่องแนบของฟอร์มส่งกลับ/ยกเลิก/วางแผน) อัปโหลดหลังการกระทำสำเร็จ พลาดไม่ย้อนการกระทำ
  async function runAction(root, rpc, args, successMessage, files = []) {
    const controls = root.querySelectorAll("[data-po-action], .po-form button");
    controls.forEach((control) => { control.disabled = true; });
    try {
      const { error } = await sb.rpc(rpc, args);
      if (error) throw error;
      const warning = await window.MNP_FACTORY_ATTACHMENTS.upload("production_order", args.p_id, files);
      showToast(warning || successMessage, warning ? "error" : "success");
      await renderRoute();
    } catch (error) {
      showToast(friendlyError(error), "error");
      if (STALE_CODES.some((code) => String(error?.message ?? "").includes(code))) await renderRoute();
      else controls.forEach((control) => { control.disabled = false; });
    }
  }

  // ---------- รายการ ----------
  const STATUS_FILTERS = ["all", ...Object.keys(model.ORDER_STATUSES)];

  function listUrl(status) {
    return menu.url("production-view", { status: status !== "all" ? status : null });
  }

  function listHtml(data, params) {
    const orders = data.production ?? [];
    const wanted = STATUS_FILTERS.includes(params.get("status")) ? params.get("status") : "all";
    const counts = model.countByStatus(orders);
    const rows = orders.filter((order) => wanted === "all" || order.status === wanted)
      .slice().sort((a, b) => String(b.code).localeCompare(String(a.code)));
    const filters = STATUS_FILTERS.map((status) => {
      const count = status === "all" ? orders.length : counts[status];
      const text = status === "all" ? "ทั้งหมด" : model.ORDER_STATUSES[status];
      return `<a class="filter${wanted === status ? " active" : ""}" href="${escapeHtml(listUrl(status))}"${wanted === status ? ' aria-current="page"' : ""}>${escapeHtml(text)} (${count})</a>`;
    }).join("");
    if (!orders.length) {
      return `<section class="card"><div class="empty">ยังไม่มีใบสั่งผลิตในโหมดทดสอบ<br><small>ฝ่ายขายออกใบใหม่ได้ที่เมนู “ใบสั่งผลิต-ใหม่” (สลับเป็นพนักงานขาย) หรือเติมชุดทดลองที่ทะเบียนสินค้า</small>
          <div class="fm-actions"><a class="btn" href="${escapeHtml(menu.url("production-new"))}"><span class="plus-icon" aria-hidden="true"></span> ออกใบสั่งผลิต</a>
          <a class="btn secondary" href="${escapeHtml(menu.url("item-list"))}">ไปที่ทะเบียนสินค้า</a></div></div></section>`;
    }
    const body = rows.map((order) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(viewUrl(order.id))}"><strong>${escapeHtml(order.code)}</strong><span>${escapeHtml(order.work_order_no ? `ใบสั่งงาน ${order.work_order_no}` : order.customer || "—")}</span></a></td>
        <td><strong>${escapeHtml(order.item_code)}</strong><br><span class="muted small">${escapeHtml(order.name)}</span></td>
        <td class="right">${q4(order.planned_qty)} ${escapeHtml(order.unit_code)}</td>
        <td>${formatDate(order.due_date)}</td>
        <td>${statusBadge(order.status)}</td>
        <td class="right"><a class="btn secondary small" href="${escapeHtml(viewUrl(order.id))}" aria-label="เปิด ${escapeHtml(order.code)}">เปิด</a></td>
      </tr>`).join("");
    return `<section class="card">
        <nav class="filters" aria-label="สถานะใบสั่งผลิต">${filters}</nav>
        ${rows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>เลขที่ใบ</th><th>สินค้า</th><th class="right">จำนวน</th><th>กำหนดเสร็จ</th><th>สถานะ</th><th class="right">จัดการ</th></tr></thead>
          <tbody>${body}</tbody></table></div>` : '<div class="empty">ไม่มีใบสั่งผลิตในสถานะนี้</div>'}
      </section>`;
  }

  // ---------- รายละเอียดและปุ่มตามสถานะ ----------
  function surveyHtml(survey, order) {
    if (!survey) return "";
    const rows = survey.rows.map((row) => `<tr>
        <td>${"— ".repeat(Math.max(0, row.level - 1))}<strong>${escapeHtml(row.code)}</strong> <span class="muted small">${escapeHtml(row.name)}</span></td>
        <td class="right">${q4(row.gross)} ${escapeHtml(row.unit_code)}</td>
        <td class="right">${q4(row.onHand)}</td>
        <td class="right${row.net > 0 && !row.hasBom ? " fm-short" : ""}"><strong>${q4(row.net)}</strong></td>
        <td>${row.hasBom ? "มีสูตร (แตกต่อ)" : row.net > 0 ? "<strong>ต้องจัดหา</strong>" : "พอ"}</td>
      </tr>`).join("");
    return `<div class="table-wrap"><table>
        <thead><tr><th>ส่วนประกอบ (ตามสูตรที่อนุมัติ)</th><th class="right">ต้องการ</th><th class="right">คงเหลือทุกคลัง</th><th class="right">ขาด / ต้องผลิตเพิ่ม</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">สูตรไม่มีส่วนประกอบ</td></tr>'}</tbody></table></div>
      <p class="muted small">คำนวณจากจำนวนที่สั่ง ${q4(order.planned_qty)} ${escapeHtml(order.unit_code)} ตามสูตรที่อนุมัติของทุกชั้น เผื่อสูญเสียแบบบวกเพิ่ม และหักคงเหลือของแต่ละ Item ก่อนแตกสูตรต่อ — เป็นตัวเลขช่วยตัดสินใจ ผลสำรวจที่บันทึกคือข้อความที่ฝ่ายวางแผนยืนยัน</p>`;
  }

  function planFormHtml(data, order) {
    const bom = model.approvedBom(data.boms, order.item_id);
    const routings = model.routingChoices(data.routings, order.item_id);
    const survey = bom ? model.surveyRequirements(data, order.item_id, order.planned_qty) : null;
    const blockers = [];
    if (!bom) blockers.push(`สินค้านี้ยังไม่มี BOM ที่อนุมัติแล้ว (ขั้น 2.3 จัดทำ BOM) — <a href="${escapeHtml(menu.url("structure-view"))}">ดูโครงสร้างสินค้า</a> แล้วส่งขออนุมัติที่ <a href="${escapeHtml(menu.url("structure-new"))}">โครงสร้างสินค้า-ใหม่</a> ให้ผู้ดูแลระบบอนุมัติก่อน`);
    if (!routings.length) blockers.push("สินค้านี้ยังไม่มี Routing (ขั้นตอนการผลิต) ที่ใช้ได้");
    const surveyText = order.survey_note || model.surveySummary(survey);
    return `<section class="card po-plan">
        <h2>วางแผน (ขั้น 2.2–2.3)</h2>
        <h3>2.2 สำรวจคงคลังก่อนกำหนดการสั่งผลิต</h3>
        ${bom ? surveyHtml(survey, order) : ""}
        <h3>2.3 BOM และขั้นตอนการผลิตที่ใช้</h3>
        ${blockers.map((text) => `<p class="fm-notice" role="alert">${text}</p>`).join("")}
        <form class="fm-form po-form" id="po-plan-form" novalidate>
          <div class="field-row">
            <div class="field"><label>BOM ที่อนุมัติแล้ว</label>
              <p>${bom ? `<a href="${escapeHtml(menu.url("structure-view", { bom: bom.id, qty: order.planned_qty }))}"><strong>${escapeHtml(bom.code)} Rev. ${escapeHtml(bom.revision)}</strong></a> · ผลผลิตต่อสูตร ${q4(bom.output_qty)} ${escapeHtml(bom.unit_code)}` : "—"}</p></div>
            <div class="field"><label for="po-routing">Routing *</label>
              <select class="select" id="po-routing" name="routing_id" required${routings.length ? "" : " disabled"}>${options(routings.map((routing) => [routing.id, `Rev. ${routing.revision}`]), order.routing_id ?? routings[0]?.id)}</select></div>
            <div class="field full"><label for="po-survey">ผลสำรวจคงคลัง *</label>
              <textarea class="textarea" id="po-survey" name="survey_note" rows="3" maxlength="1000" required>${escapeHtml(surveyText)}</textarea>
              <small>ข้อความตั้งต้นสรุปจากตารางด้านบน แก้ให้ตรงกับที่ตรวจจริงก่อนบันทึก</small></div>
          </div>
          ${window.MNP_FACTORY_ATTACHMENTS.fieldHtml("po-plan-files")}
          <div class="fm-actions"><button class="btn" type="submit"${blockers.length ? " disabled" : ""}>${order.status === "planned" ? "บันทึกการวางแผนใหม่" : "บันทึกการวางแผน"}</button></div>
        </form>
      </section>`;
  }

  function actionsHtml(data, order) {
    const role = dept();
    const actions = model.orderActions(order, role);
    const buttons = [];
    if (actions.includes("edit")) buttons.push(`<a class="btn secondary" href="${escapeHtml(menu.url("production-new", { po: order.id }))}">แก้ไขฉบับร่าง</a>`);
    if (actions.includes("submit")) buttons.push('<button class="btn" type="button" data-po-action="submit">ส่งให้ฝ่ายวางแผน</button>');
    if (actions.includes("withdraw")) buttons.push('<button class="btn secondary" type="button" data-po-action="withdraw">ถอนกลับมาแก้ไข</button>');
    if (actions.includes("receive")) buttons.push('<button class="btn" type="button" data-po-action="receive">รับใบสั่งผลิต</button>');
    if (actions.includes("release")) buttons.push('<button class="btn" type="button" data-po-action="release">ออกใบสั่งงานให้ฝ่ายผลิต</button>');
    const waiting = model.waitingFor(order);
    const hint = !actions.length && waiting
      ? notice(`ใบนี้รอ${deptName(waiting)} — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองด้านบนเป็นผู้ใช้แผนก ${waiting} เพื่อทำขั้นถัดไป`)
      : "";
    const returnForm = actions.includes("return")
      ? `<form class="fm-form po-form" id="po-return-form" novalidate>
          <div class="field full"><label for="po-return-note">ส่งกลับฝ่ายขายแก้ไข — เหตุผล *</label>
            <textarea class="textarea" id="po-return-note" name="note" rows="2" maxlength="1000" required></textarea></div>
          ${window.MNP_FACTORY_ATTACHMENTS.fieldHtml("po-return-files")}
          <div class="fm-actions"><button class="btn danger" type="submit">ส่งกลับฝ่ายขาย</button></div>
        </form>`
      : "";
    const cancelForm = actions.includes("cancel")
      ? `<form class="fm-form po-form" id="po-cancel-form" novalidate>
          <div class="field full"><label for="po-cancel-note">ยกเลิกใบสั่งผลิตนี้ — เหตุผล *</label>
            <textarea class="textarea" id="po-cancel-note" name="note" rows="2" maxlength="1000" required></textarea>
            <small>ยกเลิกได้เมื่อไม่มีใบงานผลิตที่ยังไม่ยกเลิก และไม่มีใบสั่งวัตถุดิบที่ยังไม่รับของหรือยังไม่ยกเลิก (ใบสั่งวัตถุดิบที่รับของแล้วคงยอดคลังไว้) ยกเลิกแล้วแก้กลับไม่ได้</small></div>
          ${window.MNP_FACTORY_ATTACHMENTS.fieldHtml("po-cancel-files")}
          <div class="fm-actions"><button class="btn danger" type="submit">ยกเลิกใบสั่งผลิต</button></div>
        </form>`
      : "";
    if (!buttons.length && !returnForm && !cancelForm && !hint) return "";
    return `<section class="card fm-decision">
        <h2>ขั้นถัดไป</h2>
        ${hint}
        ${buttons.length ? `<div class="fm-actions">${buttons.join("")}</div>` : ""}
        ${returnForm}
        ${cancelForm}
      </section>`;
  }

  // ขั้น 3 (แผนก ST): วัตถุดิบที่ขาดตามผลสำรวจและใบสั่งวัตถุดิบของใบนี้ — แสดงให้ทุกแผนกเห็น ปุ่มออกใบอยู่ที่หน้าใบสั่งวัตถุดิบ
  function materialSectionHtml(data, order) {
    if (!["released", "in_progress"].includes(order.status) || !materials) return "";
    const needs = materials.materialNeeds(data, order);
    const linked = materials.ordersOf(data.material_orders, order.id);
    const needRows = (needs ?? []).map((need) => `<tr>
        <td><strong>${escapeHtml(need.code)}</strong> <span class="muted small">${escapeHtml(need.name)}</span></td>
        <td class="right fm-short">${q4(need.net)} ${escapeHtml(need.unit_code)}</td>
        <td class="right">${q4(need.onOrder)}</td>
        <td>${need.purchasable ? (need.suggest > 0 ? `<strong>ควรสั่งเพิ่ม ${q4(need.suggest)}</strong>` : "สั่งครบแล้ว") : "ต้องผลิตเอง (ทำ BOM)"}</td>
      </tr>`).join("");
    const linkedRows = linked.map((material) => `<tr>
        <td><a href="${escapeHtml(menu.url("material-view", { mo: material.id }))}"><strong>${escapeHtml(material.code)}</strong></a></td>
        <td><span class="badge ${escapeHtml(materials.BADGE_CLASS[material.status] ?? "")}">${escapeHtml(materials.MATERIAL_STATUSES[material.status] ?? material.status)}</span></td>
        <td>${formatDate(material.expected_date)}</td><td class="right">${(material.lines ?? []).length} รายการ</td></tr>`).join("");
    return `<section class="card po-material">
        <h2>สั่งวัตถุดิบ (ขั้น 3 แผนก ST)</h2>
        ${needs === null ? notice("ใบนี้ไม่มี BOM ที่อนุมัติแล้ว จึงคำนวณวัตถุดิบที่ขาดไม่ได้")
          : needRows ? `<div class="table-wrap"><table><thead><tr><th>วัตถุดิบที่ขาด</th><th class="right">ขาด</th><th class="right">สั่งไว้แล้ว (ยังไม่รับ)</th><th>สถานะ</th></tr></thead><tbody>${needRows}</tbody></table></div>`
          : '<p class="muted small">วัตถุดิบและชิ้นงานตามสูตรมีเพียงพอ ไม่ต้องสั่งเพิ่ม</p>'}
        ${linkedRows ? `<h3>ใบสั่งวัตถุดิบของใบนี้</h3><div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>สถานะ</th><th>คาดว่าจะได้รับ</th><th class="right">รายการ</th></tr></thead><tbody>${linkedRows}</tbody></table></div>` : ""}
        <div class="fm-actions"><a class="btn secondary" href="${escapeHtml(menu.url("material-new", { wo: order.id }))}">ออกใบสั่งวัตถุดิบ (แผนก ST)</a></div>
      </section>`;
  }

  // ขั้น 4–8: ใบงานผลิตของใบนี้ และชิ้นงานที่ควรออกใบงานตามผลสำรวจ — แสดงให้ทุกแผนกเห็น ปุ่มออกใบงานอยู่ที่หน้าใบงานผลิต (ฝ่ายวางแผน)
  function jobSectionHtml(data, order) {
    if (!["released", "in_progress", "completed"].includes(order.status) || !jobs) return "";
    const linked = jobs.jobsOf(data.jobs, order.id);
    const suggestions = order.status === "completed" ? [] : jobs.jobSuggestions(data, order).filter((row) => row.qty > 0);
    const suggestionRows = suggestions.map((row) => `<tr><td><strong>${escapeHtml(row.code)}</strong> <span class="muted small">${escapeHtml(row.name)}</span></td>
        <td class="right">${q4(row.qty)} ${escapeHtml(row.unit_code)}</td>
        <td class="right"><a class="btn secondary small" href="${escapeHtml(menu.url("job-new", { wo: order.id, part: row.item_id, qty: row.qty }))}">ออกใบงาน</a></td></tr>`).join("");
    const linkedRows = linked.map((job) => `<tr>
        <td><a href="${escapeHtml(menu.url("job-view", { jb: job.id }))}"><strong>${escapeHtml(job.code)}</strong></a></td>
        <td>${escapeHtml(job.item_code)}</td><td class="right">${q4(job.qty)} ${escapeHtml(job.unit_code)}</td>
        <td><span class="badge ${escapeHtml(jobs.BADGE_CLASS[job.status] ?? "")}">${escapeHtml(jobs.JOB_STATUSES[job.status] ?? job.status)}</span></td>
        <td>${jobs.progress(job).done}/${jobs.progress(job).total} ขั้น</td></tr>`).join("");
    return `<section class="card po-jobs">
        <h2>ใบงานผลิต (ขั้น 4–8 สายผลิต)</h2>
        ${suggestionRows ? `<h3>ชิ้นงานที่ควรออกใบงาน</h3><div class="table-wrap"><table><thead><tr><th>ชิ้นงาน/สินค้า</th><th class="right">จำนวนที่ยังไม่ได้ออกใบงาน</th><th class="right">จัดการ</th></tr></thead><tbody>${suggestionRows}</tbody></table></div>` : ""}
        ${linkedRows ? `<h3>ใบงานของใบนี้</h3><div class="table-wrap"><table><thead><tr><th>ใบงาน</th><th>ผลิต</th><th class="right">จำนวน</th><th>สถานะ</th><th>ความคืบหน้า</th></tr></thead><tbody>${linkedRows}</tbody></table></div>`
          : '<p class="muted small">ยังไม่มีใบงานผลิตของใบนี้ — ฝ่ายวางแผนออกใบงานให้สายผลิตตามลำดับ (ชิ้นงานก่อน แล้วค่อยประกอบสินค้าที่ PK)</p>'}
        ${order.status === "completed" ? "" : `<div class="fm-actions"><a class="btn secondary" href="${escapeHtml(menu.url("job-new", { wo: order.id }))}">ออกใบงานผลิต (ฝ่ายวางแผน)</a></div>`}
      </section>`;
  }

  function timelineHtml(entries) {
    if (!entries.length) return '<p class="muted small">ยังไม่มีประวัติ (ใบจากชุดทดลองยังไม่เคยเปลี่ยนสถานะผ่านหน้าจอ)</p>';
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

  function statusNotice(order) {
    switch (order.status) {
      case "draft": return notice(order.return_note
        ? `ฉบับร่าง ฝ่ายวางแผนส่งกลับพร้อมเหตุผล: “${order.return_note}”`
        : "ฉบับร่าง ยังไม่ถึงฝ่ายวางแผน ต้องส่งก่อน");
      case "submitted": return notice("ส่งให้ฝ่ายวางแผนแล้ว รอฝ่ายวางแผนรับใบ (ถอนกลับมาแก้ไขได้จนกว่าจะรับ)");
      case "planning": return notice("ฝ่ายวางแผนรับใบแล้ว กำลังสำรวจคงคลัง จัดทำ/เลือก BOM และ Routing");
      case "planned": return notice("วางแผนแล้ว ผูก BOM และ Routing เรียบร้อย รอออกใบสั่งงานให้ฝ่ายผลิต");
      case "released": return notice(`ออกใบสั่งงานแล้ว${order.work_order_no ? ` เลขที่ ${order.work_order_no}` : ""} — ขั้นถัดไปคือแผนก ST สั่งวัตถุดิบ (หัวข้อ “สั่งวัตถุดิบ”) และฝ่ายวางแผนออกใบงานให้สายผลิต (หัวข้อ “ใบงานผลิต”) ด้านล่าง`);
      case "in_progress": return notice(`กำลังผลิต${order.work_order_no ? ` ใบสั่งงาน ${order.work_order_no}` : ""} — ติดตามที่หัวข้อ “ใบงานผลิต” ด้านล่าง`);
      case "completed": return notice("ผลิตครบตามจำนวนที่สั่งแล้ว รับสินค้าสำเร็จรูปเข้าคลังแล้ว");
      case "cancelled": return notice(`ยกเลิกแล้ว${order.cancel_note ? ` เหตุผล: “${order.cancel_note}”` : ""}${order.cancelled_by_name ? ` โดย ${order.cancelled_by_name}` : ""}`);
      default: return "";
    }
  }

  function detailHtml(data, order) {
    const bom = byId(data.boms, order.bom_id);
    const routing = byId(data.routings, order.routing_id);
    const planning = ["planning", "planned"].includes(order.status) && dept() === model.PLANNING_DEPARTMENT;
    const timeline = model.orderTimeline(data.production_history, order.id);
    return `<section class="card fm-detail">
        <div class="fm-detail-head"><div><div class="eyebrow">${escapeHtml(order.code)}${order.work_order_no ? ` · ใบสั่งงาน ${escapeHtml(order.work_order_no)}` : ""}</div>
          <h2>${escapeHtml(order.item_code)} · ${escapeHtml(order.name)}</h2></div>${statusBadge(order.status)}</div>
        ${statusNotice(order)}
        <dl class="definition-grid">
          <div class="definition"><dt>จำนวนที่สั่งผลิต</dt><dd>${q4(order.planned_qty)} ${escapeHtml(order.unit_code)}</dd></div>
          <div class="definition"><dt>กำหนดเสร็จ</dt><dd>${formatDate(order.due_date)}</dd></div>
          <div class="definition"><dt>ลูกค้า / อ้างอิง</dt><dd>${escapeHtml(order.customer || "—")}</dd></div>
          <div class="definition"><dt>BOM</dt><dd>${bom ? `<a href="${escapeHtml(menu.url("structure-view", { bom: bom.id, qty: order.planned_qty }))}">Rev. ${escapeHtml(bom.revision)}</a> · ${escapeHtml(master.DOCUMENT_STATUSES[bom.status] ?? bom.status)}` : "ยังไม่ผูก"}</dd></div>
          <div class="definition"><dt>Routing</dt><dd>${routing ? `<a href="${escapeHtml(menu.url("routing-view", { routing: routing.id }))}">Rev. ${escapeHtml(routing.revision)}</a>` : "ยังไม่ผูก"}</dd></div>
          <div class="definition"><dt>ผลิตแล้ว</dt><dd>${q4(order.completed_qty)} / ${q4(order.planned_qty)} ${escapeHtml(order.unit_code)}</dd></div>
          <div class="definition"><dt>ออกใบโดย (ฝ่ายขาย)</dt><dd>${person(order.created_by_name, order.created_at)}</dd></div>
          <div class="definition"><dt>ส่งให้ฝ่ายวางแผน</dt><dd>${person(order.submitted_by_name, order.submitted_at)}</dd></div>
          <div class="definition"><dt>ฝ่ายวางแผนรับ</dt><dd>${person(order.received_by_name, order.received_at)}</dd></div>
          <div class="definition"><dt>วางแผนโดย</dt><dd>${person(order.planned_by_name, order.planned_at)}</dd></div>
          <div class="definition"><dt>ออกใบสั่งงานโดย</dt><dd>${person(order.released_by_name, order.released_at)}</dd></div>
          ${order.status === "cancelled" ? `<div class="definition"><dt>ยกเลิกโดย</dt><dd>${person(order.cancelled_by_name, order.cancelled_at)}</dd></div>` : ""}
        </dl>
        ${order.note ? `<h3>หมายเหตุ</h3><p class="fm-pre">${escapeHtml(order.note)}</p>` : ""}
        ${order.survey_note && !planning ? `<h3>ผลสำรวจคงคลัง</h3><p class="fm-pre">${escapeHtml(order.survey_note)}</p>` : ""}
        <h3>ประวัติของใบนี้</h3>
        ${timelineHtml(timeline)}
      </section>
      ${window.MNP_FACTORY_ATTACHMENTS.panelHtml("production_order", order.id)}`;
  }

  function bindDetail(root, data, order) {
    const args = { p_id: order.id, p_version: order.version };
    const act = (name, rpc, message) => root.querySelector(`[data-po-action="${name}"]`)?.addEventListener("click", () => runAction(root, rpc, args, message));
    act("submit", "app_factory_submit_production_order", `ส่ง ${order.code} ให้ฝ่ายวางแผนแล้ว`);
    act("withdraw", "app_factory_withdraw_production_order", "ถอนกลับมาเป็นฉบับร่างแล้ว");
    act("receive", "app_factory_receive_production_order", `รับ ${order.code} แล้ว ต่อไปสำรวจคงคลังและวางแผน`);
    act("release", "app_factory_release_production_order", `ออกใบสั่งงานของ ${order.code} แล้ว`);
    // ตรวจไฟล์ก่อนยิง RPC: ไฟล์ผิดต้องไม่ทำให้การกระทำสำเร็จไปครึ่งเดียว
    const filesOf = (form) => {
      try {
        return window.MNP_FACTORY_ATTACHMENTS.read(form.elements.extra_files);
      } catch (error) {
        showToast(friendlyError(error), "error");
        return null;
      }
    };
    const returnForm = root.querySelector("#po-return-form");
    returnForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!returnForm.reportValidity()) return;
      const files = filesOf(returnForm);
      if (!files || !confirm(`ส่ง ${order.code} กลับให้ฝ่ายขายแก้ไข?`)) return;
      runAction(root, "app_factory_return_production_order", { ...args, p_note: returnForm.querySelector("textarea").value }, `ส่ง ${order.code} กลับฝ่ายขายแล้ว`, files);
    });
    const cancelForm = root.querySelector("#po-cancel-form");
    cancelForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!cancelForm.reportValidity()) return;
      const files = filesOf(cancelForm);
      if (!files || !confirm(`ยกเลิก ${order.code}? ยกเลิกแล้วแก้กลับไม่ได้`)) return;
      runAction(root, "app_factory_cancel_production_order", { ...args, p_note: cancelForm.querySelector("textarea").value }, `ยกเลิก ${order.code} แล้ว`, files);
    });
    const planForm = root.querySelector("#po-plan-form");
    planForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!planForm.reportValidity()) return;
      const files = filesOf(planForm);
      if (!files) return;
      const bom = model.approvedBom(data.boms, order.item_id);
      const form = new FormData(planForm);
      runAction(root, "app_factory_plan_production_order", {
        ...args, p_bom_id: bom?.id ?? null, p_routing_id: String(form.get("routing_id") ?? "") || null, p_survey_note: String(form.get("survey_note") ?? ""),
      }, `บันทึกการวางแผนของ ${order.code} แล้ว`, files);
    });
  }

  // ---------- ฟอร์มออกใบ ----------
  function formHtml(data, order) {
    const editing = Boolean(order);
    const value = (key, fallback = "") => escapeHtml(order?.[key] ?? fallback);
    const items = model.orderableItems(data.items);
    const soldTo = editing ? order.item_id : items[0]?.id;
    const wrongDept = dept() !== model.SALES_DEPARTMENT
      ? notice(`ขั้นนี้เป็นของ${deptName(model.SALES_DEPARTMENT)} — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานขายก่อนบันทึก (ฐานข้อมูลจะปฏิเสธผู้ใช้แผนกอื่น)`)
      : "";
    if (!items.length) {
      return `<section class="card"><div class="empty">ยังไม่มีสินค้าสำเร็จรูป (FG) ที่ผลิตเองได้<br><small>เติมข้อมูลตัวอย่างหรือเพิ่ม Item ที่ทะเบียนสินค้าก่อน</small>
        <div class="fm-actions"><a class="btn secondary" href="${escapeHtml(menu.url("item-list"))}">ไปที่ทะเบียนสินค้า</a></div></div></section>`;
    }
    return `<section class="card">
        ${wrongDept}
        <form class="fm-form po-form" id="po-form" novalidate>
          <p class="muted small">ช่องที่มี * จำเป็นต้องกรอก · เลขที่ใบสั่งผลิตระบบออกให้เมื่อบันทึกครั้งแรก</p>
          <div class="fm-form-error" id="po-form-error" role="alert" hidden></div>
          <div class="field-row">
            <div class="field full"><label for="po-item">สินค้า *</label><select class="select" id="po-item" name="item_id" required>${options(items.map((item) => [item.id, `${item.code} · ${item.name}`]), soldTo)}</select></div>
            <div class="field"><label for="po-qty">จำนวนที่สั่งผลิต *</label><input class="input" id="po-qty" name="planned_qty" type="number" inputmode="decimal" required min="0.0001" max="${model.MAX_QUANTITY}" step="any" value="${value("planned_qty")}"></div>
            <div class="field"><label for="po-due">กำหนดเสร็จ *</label><input class="input" id="po-due" name="due_date" type="date" required min="${today()}" value="${value("due_date")}"></div>
            <div class="field full"><label for="po-customer">ลูกค้า / อ้างอิงใบสั่งขาย</label><input class="input" id="po-customer" name="customer" maxlength="200" value="${value("customer")}"></div>
            <div class="field full"><label for="po-note">หมายเหตุ</label><textarea class="textarea" id="po-note" name="note" rows="3" maxlength="1000">${value("note")}</textarea></div>
          </div>
          ${window.MNP_FACTORY_ATTACHMENTS.fieldHtml("po-files")}
          <div class="fm-actions">
            <button class="btn secondary" type="submit" data-intent="save">บันทึกฉบับร่าง</button>
            <button class="btn" type="submit" data-intent="send">บันทึกและส่งให้ฝ่ายวางแผน</button>
            <a class="btn secondary" href="${escapeHtml(editing ? viewUrl(order.id) : menu.url("production-view"))}">ยกเลิก</a>
          </div>
        </form>
      </section>`;
  }

  function bindForm(root, data, order) {
    const form = root.querySelector("#po-form");
    const errorBox = root.querySelector("#po-form-error");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const intent = event.submitter?.dataset?.intent ?? "save";
      const payload = model.orderPayload(Object.fromEntries(new FormData(form).entries()), order);
      const problems = model.validateOrderPayload(payload, data.items, today());
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
        const result = await sb.rpc("app_factory_save_production_order", payload);
        if (result.error) throw result.error;
        saved = result.data;
        fileWarning = await window.MNP_FACTORY_ATTACHMENTS.upload("production_order", saved.id, files);
        if (intent === "send") {
          const sent = await sb.rpc("app_factory_submit_production_order", { p_id: saved.id, p_version: saved.version });
          if (sent.error) throw sent.error;
          showToast(fileWarning || `ส่ง ${saved.code} ให้ฝ่ายวางแผนแล้ว`, fileWarning ? "error" : "success");
        } else {
          showToast(fileWarning || (order ? "บันทึกฉบับร่างแล้ว" : `ออกใบสั่งผลิต ${saved.code} (ฉบับร่าง) แล้ว`), fileWarning ? "error" : "success");
        }
        location.hash = viewUrl(saved.id).slice(1);
      } catch (error) {
        // ฉบับร่างที่บันทึกสำเร็จแต่ส่งไม่สำเร็จยังอยู่ในระบบ: พาไปหน้าใบเพื่อส่งใหม่ ไม่ปล่อยให้กดบันทึกซ้ำจนเกิดใบซ้ำ
        if (saved) {
          showToast(`บันทึก ${saved.code} เป็นฉบับร่างแล้ว แต่ส่งไม่สำเร็จ: ${friendlyError(error)}${fileWarning ? ` · ${fileWarning}` : ""}`, "error");
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

  // ---------- คิวของฝ่ายวางแผน ----------
  function queueCard(title, hint, rows, emptyText) {
    const body = rows.map((order) => `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(viewUrl(order.id))}"><strong>${escapeHtml(order.code)}</strong><span>${escapeHtml(order.customer || "—")}</span></a></td>
        <td><strong>${escapeHtml(order.item_code)}</strong><br><span class="muted small">${escapeHtml(order.name)}</span></td>
        <td class="right">${q4(order.planned_qty)} ${escapeHtml(order.unit_code)}</td>
        <td>${formatDate(order.due_date)}</td>
        <td class="right"><a class="btn secondary small" href="${escapeHtml(viewUrl(order.id))}" aria-label="เปิด ${escapeHtml(order.code)}">เปิด</a></td>
      </tr>`).join("");
    return `<section class="card"><h2>${escapeHtml(title)} <span class="muted small">(${rows.length})</span></h2><p class="muted small">${escapeHtml(hint)}</p>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>เลขที่ใบ</th><th>สินค้า</th><th class="right">จำนวน</th><th>กำหนดเสร็จ</th><th class="right">จัดการ</th></tr></thead><tbody>${body}</tbody></table></div>`
          : `<div class="empty">${escapeHtml(emptyText)}</div>`}</section>`;
  }

  function planningHtml(data) {
    const queue = model.planningQueue(data.production);
    const hint = dept() === model.PLANNING_DEPARTMENT ? ""
      : notice(`หน้านี้เป็นคิวของ${deptName(model.PLANNING_DEPARTMENT)} — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานวางแผนเพื่อรับใบและวางแผน (โหมดทดสอบไม่ส่งแจ้งเตือน ใบที่ฝ่ายขายส่งมาเห็นที่คิวนี้)`);
    const waiting = queue.submitted.length
      ? `<p class="fm-notice" role="status">มีใบสั่งผลิตรอรับ <strong>${queue.submitted.length}</strong> ใบ</p>` : "";
    return `${hint}${waiting}
      ${queueCard("รอรับ", "ฝ่ายขายส่งมาแล้ว เรียงตามที่ส่งมานานสุดก่อน (ขั้น 2.1 รับใบสั่งผลิต)", queue.submitted, "ไม่มีใบรอรับ")}
      ${queueCard("กำลังวางแผน", "รับแล้ว ต้องสำรวจคงคลัง เลือก BOM และ Routing (ขั้น 2.2–2.3)", queue.planning, "ไม่มีใบที่กำลังวางแผน")}
      ${queueCard("วางแผนแล้ว รอออกใบสั่งงาน", "ผูก BOM และ Routing แล้ว (ขั้น 2.4 ออกใบสั่งงานให้ฝ่ายผลิต)", queue.planned, "ไม่มีใบที่รอออกใบสั่งงาน")}`;
  }

  // ---------- ลงทะเบียน view ----------
  const newOrderAction = () => `<a class="btn" href="${escapeHtml(menu.url("production-new"))}"><span class="plus-icon" aria-hidden="true"></span> ออกใบสั่งผลิต</a>`;
  const gone = (back) => ({ back, body: `<section class="card"><div class="empty">${escapeHtml(ERROR_MESSAGES.PRODUCTION_ORDER_NOT_FOUND)}</div></section>` });

  const VIEWS = {
    async production({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const id = params.get("po");
      const back = { href: menu.url("production-view"), label: "‹ กลับรายการใบสั่งผลิต" };
      if (id) {
        const order = byId(data.production, id);
        if (!order) return frame.paint(gone(back));
        const planning = ["planning", "planned"].includes(order.status) && dept() === model.PLANNING_DEPARTMENT;
        const root = frame.paint({ back, subtitle: order.code, body: `${actionsHtml(data, order)}${planning ? planFormHtml(data, order) : ""}${detailHtml(data, order)}${materialSectionHtml(data, order)}${jobSectionHtml(data, order)}` });
        return bindDetail(root, data, order);
      }
      const root = frame.paint({ actions: newOrderAction(), body: listHtml(data, params) });
      return root;
    },
    async "production-new"({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const id = params.get("po");
      if (id) {
        const order = byId(data.production, id);
        const back = { href: menu.url("production-view"), label: "‹ กลับรายการใบสั่งผลิต" };
        if (!order) return frame.paint(gone(back));
        if (order.status !== "draft") {
          return frame.paint({ back: { href: viewUrl(order.id), label: "‹ กลับรายละเอียด" }, subtitle: order.code,
            body: `<section class="card">${notice(ERROR_MESSAGES.PRODUCTION_ORDER_NOT_EDITABLE)}<div class="fm-actions"><a class="btn secondary" href="${escapeHtml(viewUrl(order.id))}">ดูใบนี้</a></div></section>` });
        }
        const root = frame.paint({ back: { href: viewUrl(order.id), label: "‹ กลับรายละเอียด" }, subtitle: `แก้ไข ${order.code}`, body: `${statusNotice(order)}${formHtml(data, order)}` });
        return bindForm(root, data, order);
      }
      const root = frame.paint({ body: formHtml(data, null) });
      return bindForm(root, data, null);
    },
    async "production-planning"({ frame }) {
      frame.loading();
      const data = await loadData();
      return frame.paint({ body: planningHtml(data) });
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
