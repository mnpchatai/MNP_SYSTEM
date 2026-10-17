(function registerNcrLossForm() {
  const costs = window.MNP_NCR_COSTS;
  const options = (items, selected) => Object.entries(items).map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const numberField = (id, name, label, value = "", step = "any") => `<div class="field"><label for="${id}">${escapeHtml(label)}</label><input class="input" id="${id}" name="${name}" type="number" min="0" max="1000000000" step="${step}" inputmode="decimal" value="${escapeHtml(String(value))}" required></div>`;
  // ช่องแนบไฟล์เพิ่มเติมของฟอร์มบันทึกต้นทุน/ผลดำเนินการ ใช้ชุดเดียวกับฟอร์มอื่นของ NCR (รองรับทั้งข้อมูลจริงและโหมดทดสอบ)
  // ไฟล์อัปโหลดหลังบันทึกสำเร็จโดย submit handler กลางใน module-ncr.js
  const extraFilesField = (id) => (window.MNP_REQUEST_MODULES?.NCR_CAR?.shared?.evidenceFieldHtml?.(id, "แนบไฟล์เพิ่มเติม (ถ้ามี)") ?? "").replace('class="field"', 'class="field full"');
  // ผู้ที่กรอกต้นทุนได้ ตรงกับ private.can_edit_ncr_losses (module-ncr.js canEditLosses) — แสดงให้ผู้ที่อ่านอย่างเดียวรู้ว่าต้องไปตามใคร
  const EDITORS_TEXT = "ผจก.ทั่วไป, ผจก.โรงงาน, ผช.ผจก.โรงงาน และ ผจก./ผช.ผจก.แผนก QA";
  function render(ncr, losses, directory, editable, today, formatBaht, formatQty) {
    const summary = costs.summarize(losses);
    const rows = losses.map((loss) => `<tr class="${loss.voided_at ? "ncr-voided" : ""}">
      <td>${escapeHtml(loss.entry_kind === "recovery" ? "เงินชดเชย/เครดิต/ขายซาก" : costs.TYPES[loss.loss_type] ?? loss.loss_type)}<div class="muted small">${escapeHtml(costs.COMPONENTS[loss.component] ?? "รายการเดิม")} · ${escapeHtml(costs.STATUSES[loss.cost_status ?? "legacy"])}</div></td>
      <td>${formatDate(loss.incurred_on)}</td><td>${formatQty(loss.quantity)} ${escapeHtml(loss.unit)}</td><td>${formatBaht(loss.unit_cost)}</td><td>${formatBaht(loss.amount)}</td>
      <td>${escapeHtml(loss.evidence_ref ?? "—")}<div class="muted small">${escapeHtml(loss.note ?? "")}</div>${loss.voided_at ? `<div class="muted small">ยกเลิก: ${escapeHtml(loss.void_reason ?? "")} · ${escapeHtml(personName(directory, loss.voided_by))}</div>` : ""}</td>
      <td>${escapeHtml(personName(directory, loss.recorded_by))}<div class="muted small">${formatDate(loss.recorded_at)}</div>${loss.verified_at ? `<div class="muted small">ยืนยัน: ${escapeHtml(personName(directory, loss.verified_by))} · ${formatDate(loss.verified_at)}</div>` : ""}</td>
      <td>${editable && !loss.voided_at ? `<button class="btn secondary small" type="button" data-edit-loss="${escapeHtml(loss.id)}">แก้ไข/ยืนยันยอด</button> <button class="btn secondary small" type="button" data-void-loss="${escapeHtml(loss.id)}">ยกเลิก</button>` : ""}</td></tr>`).join("");
    return `<section class="card ncr-card ncr-loss-card"><h2>ความสูญเสีย (Cost of Poor Quality)</h2>
      <p class="muted small">หนึ่ง NCR เพิ่มได้หลายรายการ · ยืนยันยอดโดยอ้างอิงหลักฐาน · แก้ประมาณการเดิมเป็นยอดจริงในรายการเดิม</p>
      <div class="ncr-loss-overview"><dl class="ncr-loss-summary${editable ? " is-editable" : ""}" aria-label="สรุปความสูญเสีย">
        <div><dt>สูญเสียยืนยันแล้ว</dt><dd>${formatBaht(summary.confirmed)}</dd></div>
        <div><dt>ชดเชยยืนยันแล้ว</dt><dd>${formatBaht(summary.recovery)}</dd></div>
        <div class="ncr-loss-net"><dt>สุทธิยืนยันแล้ว</dt><dd>${formatBaht(summary.net)}</dd></div>
        ${editable ? '<div class="ncr-loss-draft"><dt id="ncr-loss-preview-label">รายการที่กำลังกรอก <span>ยังไม่บันทึก</span></dt><dd><output id="ncr-loss-preview" form="ncr-loss-form" for="ncr-loss-qty ncr-loss-cost ncr-loss-headcount ncr-loss-hours" aria-labelledby="ncr-loss-preview-label" aria-live="polite">—</output></dd></div>' : ""}
      </dl>
      <dl class="ncr-loss-pending"><div><dt>ประมาณการรอยืนยัน</dt><dd>${formatBaht(summary.estimated)}</dd></div><div><dt>ชดเชยคาดว่าจะได้รับ</dt><dd>${formatBaht(summary.estimatedRecovery)}</dd></div><div><dt>รายการเดิมรอตรวจสอบ</dt><dd>${formatBaht(summary.legacy)}</dd></div></dl></div>
      ${!ncr.outcome?.cost_reviewed || summary.pending ? `<p class="muted small">ประเมินค่าเสียหายยังไม่ครบ${editable ? "" : ` · ผู้กรอกได้: ${EDITORS_TEXT}`}</p>` : ""}
      ${losses.length ? `<div class="table-wrap"><table><thead><tr><th>ประเภท / สถานะ</th><th>วันที่เกิดค่าใช้จ่าย</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>มูลค่า</th><th>หลักฐาน / หมายเหตุ</th><th>ผู้บันทึก / ผู้ยืนยัน</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">ยังไม่ได้บันทึกค่าเสียหาย กรุณาประเมินก่อนสรุปว่าไม่มีความสูญเสีย</p>'}
      ${editable ? `<form class="ncr-action" data-action="add_loss" id="ncr-loss-form"><div class="ncr-form-message"></div><h3 id="ncr-loss-heading">เพิ่มรายการความสูญเสีย</h3><input type="hidden" name="loss_id">
        <div class="form-grid">
          <div class="field"><label for="ncr-loss-kind">รายการ *</label><select class="select" id="ncr-loss-kind" name="entry_kind">${options({ loss: "ค่าเสียหาย", recovery: "เงินชดเชย/เครดิตผู้ขาย/ขายซาก" }, "loss")}</select></div>
          <div class="field"><label for="ncr-loss-type">ประเภท *</label><select class="select" id="ncr-loss-type" name="loss_type">${options(costs.TYPES, "scrap")}</select></div>
          <div class="field"><label for="ncr-loss-component">ส่วนประกอบค่าใช้จ่าย *</label><select class="select" id="ncr-loss-component" name="component"></select></div>
          <div class="field"><label for="ncr-loss-status">สถานะยอดเงิน *</label><select class="select" id="ncr-loss-status" name="cost_status">${options({ estimated: costs.STATUSES.estimated, confirmed: costs.STATUSES.confirmed }, "estimated")}</select></div>
          <div class="field"><label for="ncr-loss-date">วันที่เกิดค่าใช้จ่าย *</label><input class="input" id="ncr-loss-date" name="incurred_on" type="date" value="${today}" required></div>
          <div class="field" data-labor-field hidden><label for="ncr-loss-headcount">จำนวนพนักงาน (คน) *</label><input class="input" id="ncr-loss-headcount" name="labor_headcount" type="number" min="0" max="1000000" step="any" inputmode="decimal" disabled></div>
          <div class="field" data-labor-field hidden><label for="ncr-loss-hours">ชม.ทำงาน/วัน (ต่อคน) *</label><input class="input" id="ncr-loss-hours" name="labor_hours" type="number" min="0" max="24" step="any" inputmode="decimal" disabled></div>
          ${numberField("ncr-loss-qty", "quantity", "จำนวนทิ้งจริง *")}
          <div class="field"><label for="ncr-loss-unit">หน่วย *</label><input class="input" id="ncr-loss-unit" name="unit" maxlength="20" value="${escapeHtml(ncr.unit)}" required></div>
          ${numberField("ncr-loss-cost", "unit_cost", "ต้นทุนต่อหน่วย (บาท) *", "", "0.01")}
          <div class="field full"><p class="muted small" id="ncr-loss-hint"></p></div>
          <div class="field full"><label for="ncr-loss-ref">หลักฐานอ้างอิง (จำเป็นเมื่อยืนยันยอด)</label><input class="input" id="ncr-loss-ref" name="evidence_ref" maxlength="200" placeholder="เลขที่ใบเสร็จ ใบต้นทุน ใบบันทึกเวลา หรือชื่อไฟล์หลักฐานที่แนบใน NCR"></div>
          <div class="field full"><label for="ncr-loss-note">รายละเอียด / หมายเหตุ</label><input class="input" id="ncr-loss-note" name="note" maxlength="500"></div>
          ${extraFilesField("ncr-loss-files")}
        </div><div class="form-actions"><button class="btn" type="submit">บันทึกรายการ</button><button class="btn secondary" type="button" id="ncr-loss-reset" hidden>ยกเลิกการแก้ไข</button></div></form>` : ""}
      ${reviewHtml(ncr, editable, directory, formatQty)}
    </section>`;
  }
  // ยืนยันว่าประเมินค่าเสียหายครบ (app_ncr_review_costs) อยู่ท้ายส่วนความสูญเสีย แทนฟอร์ม "ผลดำเนินการจริง" เดิม
  // จำนวนทิ้งนับจากรายการประเภทของเสีย/ทิ้ง ชั่วโมงเครื่องหยุดลงเป็นรายการประเภทเครื่องหยุด/รอ จึงไม่ต้องกรอกซ้ำที่อื่น
  // ใบเก่าที่เคยบันทึกจำนวนผลดำเนินการไว้ยังเห็นค่าเดิมแบบอ่านอย่างเดียว
  const LEGACY_OUTCOME = { qty_sorted: "คัดแยก", qty_repaired: "ซ่อมสำเร็จ", qty_scrapped: "ทิ้ง", qty_returned: "ส่งคืน", qty_accepted: "ยอมรับใช้ได้" };
  function reviewHtml(ncr, editable, directory, formatQty) {
    const o = ncr.outcome;
    const legacy = o && (Object.keys(LEGACY_OUTCOME).some((key) => Number(o[key]) > 0) || Number(o.downtime_hours) > 0);
    const status = o?.cost_reviewed
      ? `<p><strong>ประเมินครบแล้ว</strong> · ${escapeHtml(personName(directory, o.updated_by))} · ${formatDate(o.updated_at)}</p>`
      : '<p class="muted">ยังไม่ได้ยืนยันว่าประเมินค่าเสียหายครบ</p>';
    return `<div class="ncr-cost-review"><h3>สรุปการประเมินค่าเสียหาย</h3>${status}
      ${o?.note && !editable ? `<p class="muted small">${escapeHtml(o.note)}</p>` : ""}
      ${legacy ? `<details class="ncr-legacy-outcome"><summary>ผลดำเนินการที่บันทึกไว้เดิม (${o.result_status === "confirmed" ? "ยืนยันแล้ว" : "ร่าง"} · ${formatDate(o.result_date)})</summary>
        <p class="muted small">${Object.entries(LEGACY_OUTCOME).map(([key, label]) => `${label} ${formatQty(o[key])}`).join(" · ")} ${escapeHtml(ncr.unit)} · เครื่องหยุด/รอ ${formatQty(o.downtime_hours)} ชม.${o.evidence_ref ? ` · หลักฐาน ${escapeHtml(o.evidence_ref)}` : ""}</p></details>` : ""}
      ${editable ? `<form class="ncr-action" data-action="review_costs"><div class="ncr-form-message"></div><div class="form-grid">
        <label class="ncr-check field full"><input type="checkbox" name="cost_reviewed"${o?.cost_reviewed ? " checked" : ""}><span>ประเมินค่าเสียหายครบแล้ว (ต้องยืนยันยอดทุกรายการก่อน)</span></label>
        <div class="field full"><label for="ncr-review-note">หมายเหตุ / เหตุผลกรณีไม่มีค่าเสียหาย</label><textarea class="textarea" id="ncr-review-note" name="note" maxlength="1000">${escapeHtml(o?.note ?? "")}</textarea></div>
        </div><div class="form-actions"><button class="btn secondary" type="submit">บันทึกสรุปการประเมิน</button></div></form>` : ""}</div>`;
  }
  function readEntry(form) {
    const data = Object.fromEntries(new FormData(form));
    if (form.elements.labor_headcount.disabled) return costs.makeEntry(data);
    const quantity = costs.laborQuantity(data.labor_headcount, data.labor_hours);
    if (quantity === null) throw new Error("INVALID_LOSS");
    return costs.makeEntry({ ...data, quantity, unit: "คน-ชม.", note: costs.withLaborTag(data.note, data.labor_headcount, data.labor_hours) });
  }
  // กฎเดียวกับ app_ncr_review_costs ตรวจก่อนส่งเพื่อแจ้งผู้ใช้ทันที (ฐานข้อมูลตรวจซ้ำเสมอ)
  function readReview(form, losses) {
    const reviewed = form.elements.cost_reviewed.checked;
    const note = form.elements.note.value.trim();
    const summary = costs.summarize(losses);
    if (reviewed && summary.pending) throw new Error("COST_REVIEW_PENDING");
    if (reviewed && !summary.count && !note) throw new Error("ZERO_COST_REASON_REQUIRED");
    return { reviewed, note: note || null };
  }
  function bind(ncr, losses, formatBaht) {
    const form = document.querySelector("#ncr-loss-form");
    if (!form) return;
    const components = () => {
      const allowed = costs.allowedComponents(form.elements.loss_type.value, form.elements.entry_kind.value);
      const selected = allowed.includes(form.elements.component.value) ? form.elements.component.value : allowed[0];
      form.elements.component.innerHTML = options(Object.fromEntries(allowed.map((key) => [key,costs.COMPONENTS[key]])), selected);
    };
    const configure = (reset) => {
      const spec = costs.fieldSpec(form.elements.loss_type.value,form.elements.component.value,form.elements.entry_kind.value,ncr.unit);
      document.querySelector('label[for="ncr-loss-qty"]').textContent = `${spec.quantity} *`;
      document.querySelector('label[for="ncr-loss-cost"]').textContent = `${spec.rate} *`;
      document.querySelector("#ncr-loss-hint").textContent = spec.hint;
      form.elements.quantity.readOnly = Boolean(spec.fixedQuantity || spec.labor);
      form.elements.unit.readOnly = Boolean(spec.labor);
      document.querySelectorAll("[data-labor-field]").forEach((field) => { field.hidden = !spec.labor; field.querySelector("input").disabled = !spec.labor; field.querySelector("input").required = Boolean(spec.labor); });
      if (reset) { form.elements.quantity.value = spec.fixedQuantity ? "1" : ""; form.elements.unit_cost.value = ""; form.elements.unit.value = spec.unit; form.elements.labor_headcount.value = ""; form.elements.labor_hours.value = ""; }
      form.elements.evidence_ref.required = form.elements.cost_status.value === "confirmed";
      form.elements.incurred_on.max = form.elements.cost_status.value === "confirmed" ? ncr.today : "";
      preview();
    };
    const preview = () => {
      if (!form.elements.labor_headcount.disabled) form.elements.quantity.value = costs.laborQuantity(form.elements.labor_headcount.value, form.elements.labor_hours.value) ?? "";
      const q = form.elements.quantity.value, rate = form.elements.unit_cost.value;
      document.querySelector("#ncr-loss-preview").textContent = q && rate && Number.isFinite(Number(q)*Number(rate)) ? formatBaht(costs.round(costs.round(q,3)*costs.round(rate))) : "—";
    };
    components(); configure(true);
    form.addEventListener("change", (event) => {
      if (["entry_kind","loss_type"].includes(event.target.name)) { components(); configure(true); }
      else if (event.target.name === "component") configure(true);
      else if (event.target.name === "cost_status") configure(false);
    });
    form.addEventListener("input", preview);
    document.querySelectorAll("[data-edit-loss]").forEach((button) => button.addEventListener("click", () => {
      const loss = losses.find((item) => item.id === button.dataset.editLoss);
      form.reset(); form.elements.loss_id.value = loss.id;
      form.elements.entry_kind.value = loss.entry_kind ?? "loss"; form.elements.loss_type.value = loss.loss_type;
      components();
      if (costs.allowedComponents(loss.loss_type,loss.entry_kind).includes(loss.component)) form.elements.component.value = loss.component;
      // Legacy generic quantities must be reviewed against the new component's units.
      configure(true);
      const spec = costs.fieldSpec(loss.loss_type,form.elements.component.value,loss.entry_kind,ncr.unit);
      form.elements.quantity.value = spec.fixedQuantity ? "1" : loss.quantity;
      form.elements.unit_cost.value = spec.fixedQuantity ? loss.amount : loss.unit_cost;
      form.elements.unit.value = loss.cost_status === "legacy" ? spec.unit : loss.unit;
      form.elements.incurred_on.value = loss.incurred_on;
      form.elements.cost_status.value = loss.cost_status === "confirmed" ? "confirmed" : "estimated";
      const labor = spec.labor ? costs.splitLaborTag(loss.note) : { headcount: "", hours: "", note: loss.note ?? "" };
      if (spec.labor) { form.elements.labor_headcount.value = labor.headcount; form.elements.labor_hours.value = labor.hours; if (!labor.headcount) form.elements.quantity.value = ""; }
      form.elements.evidence_ref.value = loss.evidence_ref ?? ""; form.elements.note.value = labor.note;
      document.querySelector("#ncr-loss-heading").textContent = "แก้ไขรายการ / ยืนยันยอดเดิม";
      document.querySelector("#ncr-loss-reset").hidden = false; configure(false);
      form.scrollIntoView({block:"start",behavior:"smooth"});
    }));
    document.querySelector("#ncr-loss-reset").addEventListener("click", () => {
      form.reset(); form.elements.loss_id.value = ""; components(); configure(true);
      document.querySelector("#ncr-loss-heading").textContent = "เพิ่มรายการความสูญเสีย";
      document.querySelector("#ncr-loss-reset").hidden = true;
      form.querySelector(".ncr-form-message").replaceChildren();
    });
  }
  window.MNP_NCR_LOSS_UI = { render, bind, readEntry, readReview };
})();
