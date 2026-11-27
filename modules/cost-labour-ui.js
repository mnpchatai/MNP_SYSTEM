// ต้นทุนการผลิต เฟส 2 (โหมดทดสอบ) — ส่วนจอของค่าแรง ใช้ร่วมกันโดยหน้าสูตรยางของ RubberFlow (modules/rubberflow-pages-plan.js) และหน้าต้นทุน #/cost (modules/cost-pages.js)
//   · recipeSection(recipe): ตาราง "เวลามาตรฐานต่อชุดผสม" ของรหัสสินค้าของสูตร ในการ์ดสูตรยาง (ถัดจากค่ามาตรฐานการผสม) + ปุ่มเปิด dialog
//   · dialog "stationStandard" { productCode }: เวลามาตรฐาน 7 ขั้น (นาทีต่อชุดผสม + จำนวนคน) วันที่มีผล + ประวัติ · ผู้เห็นต้นทุน + หัวหน้าแผนก RB บันทึกได้ แผนก RB ดูอย่างเดียว
//   · dialog "labourRates": อัตราค่าแรง บาท/ชม. ต่อแผนก วันที่มีผล + ประวัติ · เฉพาะผู้เห็นต้นทุน (เปิดจากหน้าต้นทุน)
// เวลามาตรฐานผูกกับรหัสสินค้าของสูตร (เจ้าของสั่ง 2026-11-27) จึงใช้ร่วมกันทุกสูตรและทุก revision ที่รหัสสินค้าเดียวกัน · บันทึกแล้วแก้ไม่ได้ (แก้ = แถวใหม่)
// โหลดหลัง modules/cost-rules.js + modules/cost-data.js + modules/rubberflow-ui.js (ดู index.html) · state / renderRoute / showToast เป็น global ของ app.js (อ้างตอนเรียกเท่านั้น)
// การซ่อนปุ่ม/ช่องเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูล (RF_FORBIDDEN)
(function registerCostLabourUi(root) {
  const esc = (value) => root.escapeHtml(value);
  const C = () => root.MNP_COST_RULES;
  const D = () => root.MNP_COST_DATA;
  const UI = () => root.MNP_RUBBERFLOW_UI;
  const employeeNow = () => { try { return state.employee ?? null; } catch { return null; } };
  const today = () => C().bangkokDay(Date.now());
  const toast = (text, tone) => { try { showToast(text, tone); } catch { /* ไม่มีแถบแจ้ง */ } };
  // วาดหน้าเดิมใหม่เมื่อข้อมูลมาถึง / บันทึกเสร็จ (เฉพาะเมื่อยังอยู่หน้าเดิม)
  function repaintSoon() {
    const hash = root.location?.hash ?? "";
    return () => { try { if ((root.location?.hash ?? "") === hash) renderRoute(); } catch { /* ออกจากหน้าแล้ว */ } };
  }
  // ใช้ได้เมื่อ: โหมดทดสอบ + บัญชีเห็นเวลามาตรฐาน + มีตัวโหลดข้อมูล (หน้าที่ไม่มีไฟล์ต้นทุน = ไม่แสดงอะไร)
  const usable = () => { const employee = employeeNow(); return Boolean(C() && D() && UI() && employee?.isSandbox === true && C().canSeeStandards(employee)); };
  // ข้อมูลค่าแรงที่พร้อมใช้ หรือ null (กำลังโหลด / ไม่มีสิทธิ์ / ผิดพลาด) · สั่งโหลดเองเมื่อยังไม่มีหรือเก่า แล้ววาดหน้าใหม่
  function labourReady() {
    if (!usable()) return null;
    const data = D();
    if (data.needsLabour()) data.loadLabour().then(repaintSoon());
    const labour = data.labour();
    return labour.status === "ready" ? labour : null;
  }
  const DEC2 = /^\d+(\.\d{1,2})?$/;
  // ชื่อแผนกชุดเดียวกับ BOM (modules/bom-rules.js DEPT_LABEL) · หน้าที่ไม่มีไฟล์นั้น = รหัสแผนก
  const deptName = (code) => root.MNP_BOM_RULES?.DEPT_LABEL?.[code] ?? code;
  const by = (row) => `${esc(row.createdBy)}<div class="muted">${esc(C().fmtDay(row.createdAt))}</div>`;
  const tagOf = (ui, row, current, day) => (row === current ? ui.badge("good", "ใช้อยู่") : C().dayKey(row.effectiveFrom) > day ? ui.badge("info", "ยังไม่ถึงวันมีผล") : "");

  // ---------- ตารางเวลามาตรฐานในการ์ดสูตรยาง ----------
  function recipeSection(recipe) {
    if (!usable() || !recipe) return "";
    const rules = C();
    const ui = UI();
    const productCode = String(recipe.productCode ?? "").trim();
    const head = (action = "") => `<div class="rf-row rf-between"><strong>เวลามาตรฐานต่อชุดผสม</strong>${action}</div>`;
    if (!productCode) return `<div class="rf-stack rf-tight">${head()}<p class="small muted">สูตรนี้ยังไม่มีรหัสสินค้า เวลามาตรฐานผูกกับรหัสสินค้า กรอกรหัสสินค้าที่ "ค่ามาตรฐานการผสม" ของร่างสูตรก่อน</p></div>`;
    const labour = labourReady();
    if (!labour) {
      const status = D().labour().status;
      const text = status === "forbidden" ? "บัญชีนี้ไม่มีสิทธิ์ดูเวลามาตรฐาน" : status === "error" ? "โหลดเวลามาตรฐานไม่สำเร็จ เปิดหน้านี้ใหม่อีกครั้ง" : "กำลังโหลดเวลามาตรฐาน…";
      return `<div class="rf-stack rf-tight">${head()}<p class="small muted">${esc(text)}</p></div>`;
    }
    const day = today();
    const standard = rules.standardAt(labour.standards, productCode, day);
    const history = rules.standardHistory(labour.standards, productCode);
    const label = labour.canWriteStandards ? (history.length ? "แก้เวลามาตรฐาน" : "ตั้งเวลามาตรฐาน") : "ประวัติเวลามาตรฐาน";
    const button = labour.canWriteStandards || history.length ? ui.openButton(label, "stationStandard", { productCode }, { className: labour.canWriteStandards && !history.length ? "small" : "secondary small" }) : "";
    if (!standard) {
      const waiting = history.length ? `เวลามาตรฐานของสินค้า ${productCode} ยังไม่ถึงวันมีผล` : `สินค้า ${productCode} ยังไม่มีเวลามาตรฐาน`;
      return `<div class="rf-stack rf-tight">${head(button)}<p class="small muted">${esc(waiting)}</p></div>`;
    }
    const rows = rules.standardSteps(standard).map((step) => `<tr><td>${esc(step.label)}</td><td class="right rf-mono">${esc(rules.fmtMinutes(step.minutes))}</td><td class="right rf-mono">${esc(rules.fmtMinutes(step.workers))}</td></tr>`);
    const foot = `<p class="small muted">${esc(`สินค้า ${productCode} · รวม ${rules.fmtMinutes(rules.standardMinutes(standard))} นาที · มีผลตั้งแต่ ${rules.fmtDay(standard.effectiveFrom)}`)}</p>`;
    return `<div class="rf-stack rf-tight">${head(button)}${ui.table(["ขั้น", { label: "นาที / ชุดผสม", className: "right" }, { label: "จำนวนคน", className: "right" }], rows)}${foot}</div>`;
  }

  // ---------- dialog เวลามาตรฐานของรหัสสินค้า ----------
  function standardDialog({ productCode } = {}) {
    const code = String(productCode ?? "").trim();
    const labour = code ? labourReady() : null;
    if (!labour) return null;
    const rules = C();
    const ui = UI();
    const day = today();
    const current = rules.standardAt(labour.standards, code, day);
    const history = rules.standardHistory(labour.standards, code);
    // ค่าตั้งต้นของฟอร์ม = แถวที่บันทึกล่าสุด (รวมแถวล่วงหน้า) ไม่มี = เวลาว่าง คน 1
    const base = history[0] ? rules.standardSteps(history[0]) : null;
    const canWrite = labour.canWriteStandards;
    const formRows = rules.STEPS.map((step, index) => {
      const value = base?.[index];
      return `<tr><td>${esc(step.label)}</td><td>${ui.input(`minutes.${step.id}`, { type: "number", step: "any", min: "0", max: "100000", value: value ? String(value.minutes) : "", extra: `inputmode="decimal" aria-label="${esc(`${step.label} นาทีต่อชุดผสม`)}" title="ไม่ทำขั้นนี้ให้กรอก 0 หรือเว้นว่าง"` })}</td><td>${ui.input(`workers.${step.id}`, { type: "number", step: "any", min: "0", max: "1000", value: value ? String(value.workers) : "1", extra: `inputmode="decimal" aria-label="${esc(`${step.label} จำนวนคน`)}"` })}</td></tr>`;
    }).join("");
    const form = canWrite ? `<form novalidate id="cost-standard-form" data-cost-standard>
        <div class="table-wrap"><table class="rf-table"><thead><tr><th>ขั้น</th><th>นาที / ชุดผสม</th><th>จำนวนคน</th></tr></thead><tbody>${formRows}</tbody></table></div>
        <div class="rf-grid rf-g2">${ui.field("มีผลตั้งแต่", ui.input("effectiveFrom", { type: "date", value: day, required: true }), { required: true, hint: esc("บันทึกแล้วแก้ไม่ได้ ถ้าผิดให้บันทึกใหม่ (วันเดียวกันใช้ค่าที่บันทึกล่าสุด)") })}
        ${ui.field("หมายเหตุ", ui.input("note", { placeholder: "เช่น จับเวลาใหม่หลังเปลี่ยนเครื่อง", extra: 'maxlength="300"' }))}</div></form>` : "";
    const rows = history.map((row) => {
      const tag = tagOf(ui, row, current, day);
      const detail = rules.standardSteps(row).map((step) => `${step.label} ${rules.fmtMinutes(step.minutes)} นาที × ${rules.fmtMinutes(step.workers)} คน`).join("\n");
      return `<tr><td class="nowrap">${esc(rules.fmtDay(row.effectiveFrom))}${tag ? ` ${tag}` : ""}</td><td class="right rf-mono" title="${esc(detail)}">${esc(rules.fmtMinutes(rules.standardMinutes(row)))}</td><td class="small">${esc(row.note)}</td><td class="small">${by(row)}</td></tr>`;
    });
    const historyTable = ui.table(["มีผลตั้งแต่", { label: "รวม (นาที)", className: "right" }, "หมายเหตุ", "บันทึกโดย"], rows, { emptyText: "ยังไม่เคยบันทึกเวลามาตรฐาน" });
    const html = ui.dialog("stationStandard", `เวลามาตรฐาน · สินค้า ${code}`, `${form}${historyTable}`, { wide: true, footer: `${ui.closeButton(canWrite ? "ยกเลิก" : "ปิด")}${canWrite ? '<button class="btn rf-btn" type="submit" form="cost-standard-form">บันทึกเวลามาตรฐาน</button>' : ""}` });
    const bind = (dialog) => {
      const node = dialog.querySelector("form[data-cost-standard]");
      if (!node) return;
      node.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ui.validateForm(node)) return;
        const steps = [];
        for (const step of rules.STEPS) {
          const minutes = String(node.elements[`minutes.${step.id}`].value).trim() || "0";
          const workers = String(node.elements[`workers.${step.id}`].value).trim() || "0";
          if (!DEC2.test(minutes) || Number(minutes) > 100000) { toast(`${step.label}: เวลาต้องเป็น 0 ถึง 100,000 นาที ทศนิยมไม่เกิน 2 ตำแหน่ง`, "error"); return; }
          if (!DEC2.test(workers) || Number(workers) > 1000) { toast(`${step.label}: จำนวนคนต้องเป็น 0 ถึง 1,000 ทศนิยมไม่เกิน 2 ตำแหน่ง`, "error"); return; }
          steps.push({ step: step.id, minutes: Number(minutes), workers: Number(workers) });
        }
        if (!steps.some((step) => step.minutes > 0)) { toast("กรอกเวลาอย่างน้อยหนึ่งขั้น", "error"); return; }
        const buttons = [...dialog.querySelectorAll("button")];
        buttons.forEach((button) => { button.disabled = true; });
        const done = repaintSoon();
        const result = await D().saveStandard({ productCode: code, effectiveFrom: node.elements.effectiveFrom.value, steps, note: node.elements.note.value.trim() });
        if (!result.ok) { toast(result.message, "error"); buttons.forEach((button) => { button.disabled = false; }); return; }
        toast(`บันทึกเวลามาตรฐานของสินค้า ${code} แล้ว`);
        dialog.close?.();
        done();
      });
    };
    return { html, bind };
  }

  // ---------- dialog อัตราค่าแรงต่อแผนก (เฉพาะผู้เห็นต้นทุน) ----------
  function ratesDialog() {
    const labour = labourReady();
    if (!labour || !labour.canSeeRates) return null;
    const rules = C();
    const ui = UI();
    const day = today();
    const canWrite = labour.canWriteRates;
    const currentOf = new Map(rules.LABOUR_DEPTS.map((dept) => [dept, rules.rateAt(labour.rates, dept, day)]));
    const form = canWrite ? `<form novalidate id="cost-rate-form" data-cost-rate>
        <div class="rf-grid rf-g3">${ui.field("แผนก", ui.select("departmentCode", rules.LABOUR_DEPTS.map((dept) => ({ value: dept, label: deptName(dept) })), { value: rules.RB_DEPT }), { required: true })}
        ${ui.field("อัตรา (บาท/ชม. ต่อคน)", ui.input("ratePerHour", { type: "number", step: "any", min: "0.01", max: "100000", required: true, extra: 'inputmode="decimal"' }), { required: true })}
        ${ui.field("มีผลตั้งแต่", ui.input("effectiveFrom", { type: "date", value: day, required: true }), { required: true, hint: esc("บันทึกแล้วแก้ไม่ได้ ถ้าผิดให้บันทึกใหม่ (วันเดียวกันใช้ค่าที่บันทึกล่าสุด)") })}</div>
        ${ui.field("หมายเหตุ", ui.input("note", { placeholder: "เช่น ปรับตามค่าแรงขั้นต่ำ", extra: 'maxlength="300"' }))}</form>` : "";
    const rows = rules.LABOUR_DEPTS.flatMap((dept) => {
      const history = rules.rateHistory(labour.rates, dept);
      if (!history.length) return [`<tr><td>${esc(deptName(dept))}</td><td class="muted">—</td><td class="right">${ui.badge("warn", "ยังไม่มีอัตรา")}</td><td></td><td></td></tr>`];
      return history.map((row) => {
        const tag = tagOf(ui, row, currentOf.get(dept), day);
        return `<tr><td>${esc(deptName(dept))}</td><td class="nowrap">${esc(rules.fmtDay(row.effectiveFrom))}${tag ? ` ${tag}` : ""}</td><td class="right rf-mono">${esc(rules.fmtBaht(row.ratePerHour))}</td><td class="small">${esc(row.note)}</td><td class="small">${by(row)}</td></tr>`;
      });
    });
    const table = ui.table(["แผนก", "มีผลตั้งแต่", { label: "บาท/ชม.", className: "right" }, "หมายเหตุ", "บันทึกโดย"], rows);
    const html = ui.dialog("labourRates", "อัตราค่าแรงต่อแผนก", `${form}${table}`, { wide: true, footer: `${ui.closeButton(canWrite ? "ยกเลิก" : "ปิด")}${canWrite ? '<button class="btn rf-btn" type="submit" form="cost-rate-form">บันทึกอัตรา</button>' : ""}` });
    const bind = (dialog) => {
      const node = dialog.querySelector("form[data-cost-rate]");
      if (!node) return;
      node.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ui.validateForm(node)) return;
        const rate = String(node.elements.ratePerHour.value).trim();
        if (!DEC2.test(rate) || !(Number(rate) > 0) || Number(rate) > 100000) { toast("อัตราต้องมากกว่า 0 ไม่เกิน 100,000 และทศนิยมไม่เกิน 2 ตำแหน่ง", "error"); return; }
        const dept = node.elements.departmentCode.value;
        const buttons = [...dialog.querySelectorAll("button")];
        buttons.forEach((button) => { button.disabled = true; });
        const done = repaintSoon();
        const result = await D().saveRate({ departmentCode: dept, ratePerHour: Number(rate), effectiveFrom: node.elements.effectiveFrom.value, note: node.elements.note.value.trim() });
        if (!result.ok) { toast(result.message, "error"); buttons.forEach((button) => { button.disabled = false; }); return; }
        toast(`บันทึกอัตราค่าแรงของ ${dept} แล้ว`);
        dialog.close?.();
        done();
      });
    };
    return { html, bind };
  }

  const builders = { stationStandard: standardDialog, labourRates: ratesDialog };
  // เปิด dialog จากหน้าที่ไม่ได้ใช้ตัวเปิดของ RubberFlow (หน้าต้นทุน): วาง html ต่อท้าย .content ผูกปุ่มปิด แล้วเปิดแบบ modal (แบบเดียวกับ openDialog ของ RubberFlow)
  function open(name, args) {
    const built = builders[name]?.(args ?? {});
    if (!built?.html) return false;
    const host = document.querySelector(".content") ?? document.body;
    host.querySelectorAll("dialog[data-rf-dialog]").forEach((node) => { node.close?.(); node.remove(); });
    host.insertAdjacentHTML("beforeend", built.html);
    const dialog = host.lastElementChild;
    if (!dialog || dialog.tagName !== "DIALOG") return false;
    dialog.querySelectorAll("[data-rf-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("pointerdown", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => dialog.remove());
    UI().enhanceDates?.(dialog);
    built.bind?.(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector("input:not([type=hidden]):not([hidden]), select:not([hidden])")?.focus?.();
    return true;
  }

  // หน้าสูตรยางของ RubberFlow เปิดด้วยตัวเปิด dialog ของ RubberFlow เอง (ปุ่ม data-rf-open="stationStandard")
  (root.MNP_RUBBERFLOW_DIALOGS ??= {}).stationStandard = (ctx, args) => standardDialog(args);

  root.MNP_COST_LABOUR = Object.freeze({ usable, labourReady, recipeSection, standardDialog, ratesDialog, open });
})(window);
