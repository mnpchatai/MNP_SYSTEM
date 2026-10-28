// หน้า "ล็อตวัตถุดิบ" ฝ่ายโรงงาน (โหมดทดสอบ) — วันหมดอายุ การกักกัน/ปลดกักกันล็อต และลำดับ FEFO
//
// view "lots" ของรายการ คลังสินค้า › ล็อตวัตถุดิบ (modules/factory-item-master.js) กรองด้วย ?q= และ ?status=
// ตารางเรียงตามลำดับที่ขั้นแรกของใบงานจะตัดวัตถุดิบ (FEFO: วันหมดอายุใกล้สุดก่อน ข้ามล็อตที่กักกัน/หมดอายุ) แสดงเฉพาะล็อตที่ยังมีของ
// แผนก ST/QA ตั้ง/ล้างวันหมดอายุ · QA กักกัน/ปลดกักกันพร้อมเหตุผล — ฟอร์มอยู่ใน <details> ของแต่ละแถว (แตะบน iPhone ได้ ไม่มี popup ลอย)
// การควบคุมสิทธิ์จริงอยู่ที่ RPC ใน supabase/migrations/20261030010000_factory_lot_fefo_quarantine.sql (ซ่อนปุ่มไม่ใช่การควบคุมสิทธิ์)
// ตรรกะที่ทดสอบได้อยู่ที่ modules/factory-lot-model.js
//
// โหลดหลัง modules/factory-lot-model.js และ modules/module-factory-master.js ก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (sb, escapeHtml, formatDate, showToast, friendlyError, renderRoute) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactoryLotViews() {
  const model = window.MNP_FACTORY_LOT_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { qty, notice, fold, listToolbar, bindListToolbar } = window.MNP_FACTORY_UI;

  const ENTRY = "inventory-lots";
  // ลำดับสำคัญ: friendlyError ใช้คีย์แรกที่ปรากฏอยู่ในข้อความ รหัสใหม่ต้องไม่เป็นส่วนหนึ่งของรหัสอื่นที่ลงทะเบียนไว้ก่อนหน้า (มีเทสต์ตรวจ)
  const ERROR_MESSAGES = {
    LOT_EXPIRY_STORES_OR_QA_ONLY: "ตั้งวันหมดอายุได้เฉพาะแผนก ST และ QA — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองก่อน",
    LOT_HOLD_QA_ONLY: "กักกันหรือปลดกักกันล็อตได้เฉพาะแผนก QA — สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองก่อน",
    INVALID_LOT_EXPIRY: "วันหมดอายุไม่ถูกต้อง: ต้องอยู่ระหว่างปี 2000–2100 และไม่ก่อนวันที่รับของ",
    LOT_EXPIRY_UNCHANGED: "วันหมดอายุเหมือนเดิม",
    LOT_HOLD_NOTE_REQUIRED: "กรุณาระบุเหตุผล 10–1,000 ตัวอักษร",
    INVALID_LOT_HOLD: "คำสั่งกักกันไม่ถูกต้อง",
    LOT_ALREADY_HELD: "ล็อตนี้ถูกกักกันอยู่แล้ว",
    LOT_NOT_HELD: "ล็อตนี้ไม่ได้ถูกกักกัน",
    LOT_NOT_FOUND: "ไม่พบล็อตนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    LOT_STALE: "ล็อตนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจข้อมูลล่าสุดแล้วทำอีกครั้ง",
  };
  Object.assign(window.MNP_FACTORY_ERRORS, ERROR_MESSAGES);
  const STALE_CODES = ["LOT_STALE", "LOT_NOT_FOUND", "LOT_ALREADY_HELD", "LOT_NOT_HELD", "LOT_EXPIRY_UNCHANGED"];

  const LABELS = { ...model.STATUSES, near: "ใกล้หมดอายุ" };
  const badge = (status) => `<span class="badge ${escapeHtml(model.BADGE_CLASS[status] ?? "")}">${escapeHtml(LABELS[status] ?? status)}</span>`;
  const day = (value) => (value ? escapeHtml(formatDate(value)) : "—");

  async function loadLots() {
    const { data, error } = await sb.rpc("app_factory_lots");
    if (error) throw error;
    return data;
  }

  // ฟอร์มของแถว: วันหมดอายุ (ST/QA) และกักกันหรือปลดกักกัน (QA) — ไม่มีสิทธิ์ใดเลย = ไม่มีคอลัมน์จัดการ
  function formsHtml(lot, data) {
    const can = model.actionsFor(lot, data);
    const id = escapeHtml(lot.id);
    const parts = [];
    if (can.expiry) {
      parts.push(`<form class="lot-form" data-lot-form="expiry" data-lot-id="${id}">
          <label for="lot-exp-${id}">วันหมดอายุ</label>
          <input class="input" id="lot-exp-${id}" name="expiry" type="date" min="${escapeHtml(lot.received_date ?? "")}" max="2100-12-31" value="${escapeHtml(lot.expiry_date ?? "")}">
          <button class="btn secondary" type="submit" title="เว้นว่างแล้วบันทึก = ล้างวันหมดอายุ">บันทึก</button>
        </form>`);
    }
    if (can.hold || can.release) {
      const verb = can.hold ? "กักกันล็อต" : "ปลดกักกัน";
      parts.push(`<form class="lot-form" data-lot-form="${can.hold ? "hold" : "release"}" data-lot-id="${id}">
          <label for="lot-note-${id}">เหตุผลที่${escapeHtml(verb)}</label>
          <textarea class="input" id="lot-note-${id}" name="note" rows="2" minlength="${model.NOTE_MIN}" maxlength="${model.NOTE_MAX}" required></textarea>
          <button class="btn${can.hold ? " danger" : ""}" type="submit">${escapeHtml(verb)}</button>
        </form>`);
    }
    return parts.length ? fold("จัดการ", parts.join("")) : "";
  }

  function lotsHtml(data, filters) {
    const list = model.rows(data, filters);
    const manage = data.can_set_expiry || data.can_hold;
    const rowsHtml = list.map((lot) => `<tr>
        <td><strong>${escapeHtml(lot.lot_number)}</strong>${lot.on_hold && lot.hold_reason ? `<div class="muted small">${escapeHtml(lot.hold_reason)}</div>` : ""}</td>
        <td data-label="Item"><a href="${escapeHtml(menu.url("item-list", { id: lot.item_id }))}">${escapeHtml(lot.item_code)}</a> <span class="muted small">${escapeHtml(lot.item_name)}</span></td>
        <td class="right" data-label="คงเหลือ">${qty(lot.balance)} ${escapeHtml(lot.unit_code)}</td>
        <td data-label="รับเมื่อ">${day(lot.received_date)}</td>
        <td data-label="หมดอายุ">${day(lot.expiry_date)}</td>
        <td data-label="สถานะ">${badge(lot.display)}</td>
        ${manage ? `<td data-label="จัดการ">${formsHtml(lot, data)}</td>` : ""}
      </tr>`).join("");
    const history = (data.history ?? []).slice(0, 50).map((row) => `<li><span class="fm-feed-time">${escapeHtml(formatDate(row.created_at, true))}</span>
        <span>${escapeHtml(model.HISTORY_ACTIONS[row.action] ?? row.action)} <strong>${escapeHtml(row.lot_number)}</strong> · ${escapeHtml(row.item_code)}${
          row.action === "expiry" ? ` · ${day(row.expiry_before)} → ${day(row.expiry_after)}` : row.note ? ` · ${escapeHtml(row.note)}` : ""}</span>
        <span class="muted small">${escapeHtml(row.changed_by_name ?? "—")}</span></li>`).join("");
    return `<section class="card">
        ${listToolbar({ entry: ENTRY, q: filters.q, status: filters.status, statuses: model.FILTERS, placeholder: "ค้นหาเลขล็อต รหัส หรือชื่อ Item…" })}
        ${manage ? "" : notice("ดูได้อย่างเดียว — ตั้งวันหมดอายุได้เฉพาะแผนก ST/QA และกักกันล็อตได้เฉพาะ QA (สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเพื่อลองบทบาทนั้น)")}
        ${rowsHtml ? `<div class="table-wrap"><table class="fm-table lot-table" title="เรียงตามลำดับที่ขั้นแรกของใบงานจะตัดวัตถุดิบ (FEFO) แสดงเฉพาะล็อตที่ยังมีของ">
            <thead><tr><th>ล็อต</th><th>Item</th><th class="right">คงเหลือ</th><th>รับเมื่อ</th><th>หมดอายุ</th><th>สถานะ</th>${manage ? "<th>จัดการ</th>" : ""}</tr></thead>
            <tbody>${rowsHtml}</tbody></table></div>`
          : '<p class="muted small">ไม่มีล็อตที่ตรงกับตัวกรอง</p>'}
      </section>
      <section class="card"><h2>ประวัติล็อต</h2>
        ${history ? `<ul class="fm-feed">${history}</ul>` : '<p class="muted small">ยังไม่มีการเปลี่ยนวันหมดอายุหรือการกักกัน</p>'}</section>`;
  }

  async function runAction(root, rpc, args, successMessage) {
    const controls = root.querySelectorAll("form[data-lot-form] button");
    controls.forEach((control) => { control.disabled = true; });
    try {
      const { error } = await sb.rpc(rpc, args);
      if (error) throw error;
      showToast(successMessage);
      await renderRoute();
    } catch (error) {
      showToast(friendlyError(error), "error");
      if (STALE_CODES.some((code) => String(error?.message ?? "").includes(code))) await renderRoute();
      else controls.forEach((control) => { control.disabled = false; });
    }
  }

  function bindForms(root, data) {
    const lots = new Map((data.lots ?? []).map((lot) => [lot.id, lot]));
    root?.querySelectorAll?.("form[data-lot-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const lot = lots.get(form.dataset.lotId);
        if (!lot) return;
        const values = new FormData(form);
        const kind = form.dataset.lotForm;
        const payload = kind === "expiry" ? model.expiryPayload(lot, values.get("expiry")) : model.holdPayload(lot, kind === "hold", values.get("note"));
        if (payload.error) { showToast(payload.error, "error"); return; }
        if (kind === "expiry") await runAction(root, "app_factory_set_lot_expiry", payload.args, payload.args.p_expiry_date ? `บันทึกวันหมดอายุของ ${lot.lot_number}` : `ล้างวันหมดอายุของ ${lot.lot_number}`);
        else await runAction(root, "app_factory_set_lot_hold", payload.args, kind === "hold" ? `กักกันล็อต ${lot.lot_number}` : `ปลดกักกันล็อต ${lot.lot_number}`);
      });
    });
  }

  const VIEWS = {
    async lots({ params, frame }) {
      frame.loading();
      const data = await loadLots();
      const filters = { q: String(params.get("q") ?? "").trim().slice(0, 100), status: model.filterOf(params.get("status")) };
      const root = frame.paint({ body: lotsHtml(data, filters) });
      bindListToolbar(root);
      bindForms(root, data);
      return root;
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
