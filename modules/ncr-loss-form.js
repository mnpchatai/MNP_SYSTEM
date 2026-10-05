(function registerNcrLossForm() {
  const costs = window.MNP_NCR_COSTS;
  const options = (items, selected) => Object.entries(items).map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const numberField = (id, name, label, value = "", step = "any") => `<div class="field"><label for="${id}">${escapeHtml(label)}</label><input class="input" id="${id}" name="${name}" type="number" min="0" max="1000000000" step="${step}" inputmode="decimal" value="${escapeHtml(String(value))}" required></div>`;
  function render(ncr, losses, directory, editable, today, formatBaht, formatQty) {
    const summary = costs.summarize(losses);
    const rows = losses.map((loss) => `<tr class="${loss.voided_at ? "ncr-voided" : ""}">
      <td>${escapeHtml(loss.entry_kind === "recovery" ? "เงินชดเชย/เครดิต/ขายซาก" : costs.TYPES[loss.loss_type] ?? loss.loss_type)}<div class="muted small">${escapeHtml(costs.COMPONENTS[loss.component] ?? "รายการเดิม")} · ${escapeHtml(costs.STATUSES[loss.cost_status ?? "legacy"])}</div></td>
      <td>${formatDate(loss.incurred_on)}</td><td>${formatQty(loss.quantity)} ${escapeHtml(loss.unit)}</td><td>${formatBaht(loss.unit_cost)}</td><td>${formatBaht(loss.amount)}</td>
      <td>${escapeHtml(loss.evidence_ref ?? "—")}<div class="muted small">${escapeHtml(loss.note ?? "")}</div>${loss.voided_at ? `<div class="muted small">ยกเลิก: ${escapeHtml(loss.void_reason ?? "")} · ${escapeHtml(personName(directory, loss.voided_by))}</div>` : ""}</td>
      <td>${escapeHtml(personName(directory, loss.recorded_by))}<div class="muted small">${formatDate(loss.recorded_at)}</div>${loss.verified_at ? `<div class="muted small">ยืนยัน: ${escapeHtml(personName(directory, loss.verified_by))} · ${formatDate(loss.verified_at)}</div>` : ""}</td>
      <td>${editable && !loss.voided_at ? `<button class="btn secondary small" type="button" data-edit-loss="${escapeHtml(loss.id)}">แก้ไข/ยืนยันยอด</button> <button class="btn secondary small" type="button" data-void-loss="${escapeHtml(loss.id)}">ยกเลิก</button>` : ""}</td></tr>`).join("");
    return `<section class="card ncr-card"><h2>ความสูญเสีย (Cost of Poor Quality)</h2>
      <p class="muted small">หนึ่ง NCR เพิ่มได้หลายรายการ · ยืนยันยอดโดยอ้างอิงหลักฐาน · แก้ประมาณการเดิมเป็นยอดจริงในรายการเดิม</p>
      <dl class="definition-grid"><div><dt>สูญเสียยืนยันแล้ว</dt><dd>${formatBaht(summary.confirmed)}</dd></div><div><dt>ชดเชยยืนยันแล้ว</dt><dd>${formatBaht(summary.recovery)}</dd></div><div><dt>สุทธิยืนยันแล้ว</dt><dd>${formatBaht(summary.net)}${!ncr.outcome?.cost_reviewed || summary.pending ? ' <span class="muted small">(ประเมินยังไม่ครบ)</span>' : ""}</dd></div><div><dt>ประมาณการรอยืนยัน / ชดเชยคาดว่าจะได้รับ</dt><dd>${formatBaht(summary.estimated)} / ${formatBaht(summary.estimatedRecovery)}</dd></div><div><dt>รายการเดิมรอตรวจสอบ</dt><dd>${formatBaht(summary.legacy)}</dd></div></dl>
      ${losses.length ? `<div class="table-wrap"><table><thead><tr><th>ประเภท / สถานะ</th><th>วันที่เกิดค่าใช้จ่าย</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>มูลค่า</th><th>หลักฐาน / หมายเหตุ</th><th>ผู้บันทึก / ผู้ยืนยัน</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">ยังไม่ได้บันทึกค่าเสียหาย กรุณาประเมินก่อนสรุปว่าไม่มีความสูญเสีย</p>'}
      ${editable ? `<form class="ncr-action" data-action="add_loss" id="ncr-loss-form"><div class="ncr-form-message"></div><h3 id="ncr-loss-heading">เพิ่มรายการความสูญเสีย</h3><input type="hidden" name="loss_id">
        <div class="form-grid">
          <div class="field"><label for="ncr-loss-kind">รายการ *</label><select class="select" id="ncr-loss-kind" name="entry_kind">${options({ loss: "ค่าเสียหาย", recovery: "เงินชดเชย/เครดิตผู้ขาย/ขายซาก" }, "loss")}</select></div>
          <div class="field"><label for="ncr-loss-type">ประเภท *</label><select class="select" id="ncr-loss-type" name="loss_type">${options(costs.TYPES, "scrap")}</select></div>
          <div class="field"><label for="ncr-loss-component">ส่วนประกอบค่าใช้จ่าย *</label><select class="select" id="ncr-loss-component" name="component"></select></div>
          <div class="field"><label for="ncr-loss-status">สถานะยอดเงิน *</label><select class="select" id="ncr-loss-status" name="cost_status">${options({ estimated: costs.STATUSES.estimated, confirmed: costs.STATUSES.confirmed }, "estimated")}</select></div>
          <div class="field"><label for="ncr-loss-date">วันที่เกิดค่าใช้จ่าย *</label><input class="input" id="ncr-loss-date" name="incurred_on" type="date" value="${today}" required></div>
          ${numberField("ncr-loss-qty", "quantity", "จำนวนทิ้งจริง *")}
          <div class="field"><label for="ncr-loss-unit">หน่วย *</label><input class="input" id="ncr-loss-unit" name="unit" maxlength="20" value="${escapeHtml(ncr.unit)}" required></div>
          ${numberField("ncr-loss-cost", "unit_cost", "ต้นทุนต่อหน่วย (บาท) *", "", "0.01")}
          <div class="field full"><p class="muted small" id="ncr-loss-hint"></p><output id="ncr-loss-preview" aria-live="polite">มูลค่ารายการ: —</output></div>
          <div class="field full"><label for="ncr-loss-ref">หลักฐานอ้างอิง (จำเป็นเมื่อยืนยันยอด)</label><input class="input" id="ncr-loss-ref" name="evidence_ref" maxlength="200" placeholder="เลขที่ใบเสร็จ ใบต้นทุน ใบบันทึกเวลา หรือชื่อไฟล์หลักฐานที่แนบใน NCR"></div>
          <div class="field full"><label for="ncr-loss-note">รายละเอียด / หมายเหตุ</label><input class="input" id="ncr-loss-note" name="note" maxlength="500"></div>
        </div><div class="form-actions"><button class="btn" type="submit">บันทึกรายการ</button><button class="btn secondary" type="button" id="ncr-loss-reset" hidden>ยกเลิกการแก้ไข</button></div></form>` : ""}
    </section>`;
  }
  function outcomeHtml(ncr, editable, today, formatQty, directory) {
    const o = ncr.outcome;
    const quantities = { qty_sorted: "จำนวนที่คัดแยก", qty_repaired: "จำนวนซ่อมสำเร็จ", qty_scrapped: "จำนวนทิ้งจริง", qty_returned: "จำนวนส่งคืนจริง", qty_accepted: "จำนวนยอมรับใช้ได้" };
    return `<section class="card ncr-card"><h2>ผลดำเนินการจริง</h2><p class="muted small">จำนวนที่พบปัญหาเป็นข้อมูลผลตรวจ · จำนวนซ่อมสำเร็จ ทิ้ง ส่งคืน และยอมรับใช้ได้เป็นผลสุดท้าย ห้ามลงชิ้นเดียวกันซ้ำ · จำนวนคัดแยกเป็นกิจกรรมแยกต่างหาก</p>
      ${o ? `<p><strong>${o.result_status === "confirmed" ? "ยืนยันผลแล้ว" : "ร่างผลดำเนินการ"}</strong> · ${formatDate(o.result_date)} · ${escapeHtml(personName(directory, o.updated_by))}</p><dl class="definition-grid">${Object.entries(quantities).map(([key,label]) => `<div><dt>${label}</dt><dd>${formatQty(o[key])} ${escapeHtml(ncr.unit)}</dd></div>`).join("")}<div><dt>เครื่องหยุด/รอ</dt><dd>${formatQty(o.downtime_hours)} ชม.</dd></div><div><dt>ตรวจค่าเสียหายครบแล้ว</dt><dd>${o.cost_reviewed ? "ครบแล้ว" : "ยังไม่ครบ"}</dd></div><div><dt>หลักฐาน / หมายเหตุ</dt><dd>${escapeHtml(o.evidence_ref ?? "—")} · ${escapeHtml(o.note ?? "")}</dd></div></dl>` : '<p class="muted">ยังไม่มีผลดำเนินการจริง จึงยังสรุปจำนวนทิ้งหรือซ่อมไม่ได้</p>'}
      ${editable ? `<form class="ncr-action" data-action="save_outcome"><div class="ncr-form-message"></div><div class="form-grid">
        <div class="field"><label for="ncr-outcome-status">สถานะผล *</label><select class="select" id="ncr-outcome-status" name="result_status">${options({ draft: "ร่าง", confirmed: "ยืนยันผลแล้ว" }, o?.result_status ?? "draft")}</select></div>
        <div class="field"><label for="ncr-outcome-date">วันที่ผลดำเนินการ *</label><input class="input" id="ncr-outcome-date" name="result_date" type="date" max="${today}" value="${o?.result_date ?? today}" required></div>
        ${Object.entries(quantities).map(([key,label]) => numberField(`ncr-${key}`,key,`${label} (${ncr.unit})`,o?.[key] ?? 0)).join("")}
        ${numberField("ncr-outcome-hours","downtime_hours","เครื่องหยุด/รอ (ชั่วโมง)",o?.downtime_hours ?? 0)}
        <div class="field full"><label for="ncr-outcome-ref">หลักฐานผลดำเนินการ (จำเป็นเมื่อยืนยันผล)</label><input class="input" id="ncr-outcome-ref" name="evidence_ref" maxlength="200" value="${escapeHtml(o?.evidence_ref ?? "")}"></div>
        <div class="field full"><label for="ncr-outcome-note">รายละเอียด / เหตุผลกรณีไม่มีค่าเสียหาย</label><textarea class="textarea" id="ncr-outcome-note" name="note" maxlength="1000">${escapeHtml(o?.note ?? "")}</textarea></div>
        <label class="ncr-check field full"><input type="checkbox" name="cost_reviewed"${o?.cost_reviewed ? " checked" : ""}><span>ประเมินค่าเสียหายครบแล้ว (ต้องยืนยันผลและไม่มีรายการรอยืนยัน หากไม่มีค่าเสียหายให้ระบุเหตุผล)</span></label>
        </div><div class="form-actions"><button class="btn" type="submit">บันทึกผลดำเนินการ</button></div></form>` : ""}</section>`;
  }
  function readEntry(form) { return costs.makeEntry(Object.fromEntries(new FormData(form))); }
  function readOutcome(form) {
    const data = Object.fromEntries(new FormData(form));
    for (const key of ["qty_sorted","qty_repaired","qty_scrapped","qty_returned","qty_accepted","downtime_hours"]) {
      if (data[key] === undefined || data[key] === "") throw new Error("INVALID_OUTCOME");
      data[key] = Number(data[key]);
      if (!Number.isFinite(data[key]) || data[key] < 0) throw new Error("INVALID_OUTCOME");
    }
    data.cost_reviewed = form.elements.cost_reviewed.checked;
    if (data.result_status === "confirmed" && !data.evidence_ref.trim()) throw new Error("LOSS_EVIDENCE_REQUIRED");
    return data;
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
      form.elements.quantity.readOnly = Boolean(spec.fixedQuantity);
      if (reset) { form.elements.quantity.value = spec.fixedQuantity ? "1" : ""; form.elements.unit_cost.value = ""; form.elements.unit.value = spec.unit; }
      form.elements.evidence_ref.required = form.elements.cost_status.value === "confirmed";
      form.elements.incurred_on.max = form.elements.cost_status.value === "confirmed" ? ncr.today : "";
      preview();
    };
    const preview = () => {
      const q = form.elements.quantity.value, rate = form.elements.unit_cost.value;
      document.querySelector("#ncr-loss-preview").textContent = `มูลค่ารายการ: ${q && rate && Number.isFinite(Number(q)*Number(rate)) ? formatBaht(costs.round(costs.round(q,3)*costs.round(rate))) : "—"}`;
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
      form.elements.evidence_ref.value = loss.evidence_ref ?? ""; form.elements.note.value = loss.note ?? "";
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
  window.MNP_NCR_LOSS_UI = { render, outcomeHtml, bind, readEntry, readOutcome };
})();
