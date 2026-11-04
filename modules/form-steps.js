// ฟอร์มแบบทีละขั้นบนจอแคบ (หน้าเดียวบนจอกว้าง) และการตรวจช่องเป็นภาษาไทยแทน validation ของเบราว์เซอร์
// กติกาล้วน (validate, stepView) ทดสอบได้ใน Node; ส่วน DOM (showFieldErrors) ใช้ในหน้าฟอร์ม
(function (root) {
  "use strict";

  // rules: [{ name, step, required, minLength, message, check, checkMessage }] เรียงตามลำดับที่อยู่บนจอ
  // check(value, values) = กติกาของค่าที่กรอกแล้ว (เช่น ไม่เกินอีกช่อง ไม่ก่อนวันนี้) ข้ามเมื่อช่องว่าง; ไม่ผ่านใช้ checkMessage
  // คืนข้อผิดพลาดตามลำดับเดียวกัน ช่องแรกที่ผิดจึงเป็นช่องที่ต้องพาไป
  function validate(rules, values) {
    const errors = [];
    for (const rule of rules) {
      const raw = values[rule.name];
      const text = typeof raw === "string" ? raw.trim() : raw;
      const missing = text === undefined || text === null || text === "" || text === false;
      const fail = (message) => errors.push({ name: rule.name, step: rule.step, message });
      if (rule.required && missing) { fail(rule.message); continue; }
      if (missing) continue;
      if (rule.minLength && String(text).length < rule.minLength) { fail(rule.message); continue; }
      if (rule.check && !rule.check(text, values)) fail(rule.checkMessage ?? rule.message);
    }
    return errors;
  }

  // ตัวเลขจากช่องกรอก (รับจุลภาคคั่นหลักพัน แบบเดียวกับที่ส่งให้ฐานข้อมูล) ไม่ใช่ตัวเลข = NaN
  const numberOf = (value) => (value === undefined || value === null || String(value).trim() === "" ? NaN : Number(String(value).replaceAll(",", "")));

  // ขั้นไหนแสดง และปุ่มไหนมี: จอแคบทีละขั้น (ขั้นสุดท้ายคือทบทวน), จอกว้างทุกขั้นที่กรอกได้ในหน้าเดียวไม่มีขั้นทบทวน
  function stepView({ current, count, narrow, reviewStep = count }) {
    if (!narrow) {
      const visible = Array.from({ length: count }, (_, index) => index + 1).filter((step) => step !== reviewStep);
      return { visible, showBack: false, showNext: false, showSubmit: true, label: "" };
    }
    const step = Math.min(Math.max(1, current), count);
    return { visible: [step], showBack: step > 1, showNext: step < count, showSubmit: step === count, label: `ขั้นที่ ${step} จาก ${count}` };
  }

  // แสดงข้อผิดพลาดใต้ช่อง: กล่อง [data-field="<name>"] รับข้อความ ช่องที่โฟกัสได้ ([data-focus] หรือ input แรก) ได้ aria-invalid
  function clearFieldErrors(form) {
    form.querySelectorAll(".field-error[data-generated]").forEach((node) => node.remove());
    form.querySelectorAll("[aria-invalid='true']").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  // ช่องที่โฟกัสได้จริง: ไม่ปิดใช้ และไม่อยู่ในส่วนที่ซ่อน (เช่น กล่องเพิ่มเครื่องจักรที่ยังไม่เปิด)
  function focusTargetOf(container) {
    if (!container) return null;
    const usable = (selector) => [...container.querySelectorAll(selector)].find((node) => !node.closest("[hidden]"));
    return usable("[data-focus]:not([disabled])") ?? usable("input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])") ?? null;
  }

  function showFieldErrors(form, errors) {
    clearFieldErrors(form);
    errors.forEach((error) => {
      const container = form.querySelector(`[data-field="${error.name}"]`);
      if (!container) return;
      const id = `${form.id || "form"}-${error.name}-error`;
      const message = document.createElement("p");
      message.className = "field-error";
      message.id = id;
      message.dataset.generated = "";
      message.textContent = error.message;
      container.append(message);
      // กลุ่มปุ่ม (เช่น แผนก) รับ aria-invalid ที่ตัวกลุ่ม [data-invalid-target] เพราะปุ่มไม่รองรับ attribute นี้
      const target = container.querySelector("[data-invalid-target]") ?? focusTargetOf(container);
      if (target) {
        target.setAttribute("aria-invalid", "true");
        const describedBy = new Set((target.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean));
        describedBy.add(id);
        target.setAttribute("aria-describedby", [...describedBy].join(" "));
      }
    });
    return focusTargetOf(form.querySelector(`[data-field="${errors[0]?.name}"]`));
  }

  // ลบข้อผิดพลาดของช่องนั้นเมื่อผู้ใช้แก้แล้ว
  function clearFieldError(form, name) {
    const container = form.querySelector(`[data-field="${name}"]`);
    container?.querySelector(".field-error[data-generated]")?.remove();
    container?.querySelectorAll("[aria-invalid='true']").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  // ---- ส่วนที่ฟอร์มทีละขั้นทุกโมดูลใช้ร่วมกัน (MT, คำร้องทั่วไป IT/MG, NCR) ----
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  // หัว "ขั้นที่ n จาก N" (แสดงเฉพาะจอแคบ) — ชื่อขั้นอยู่ที่ legend ของแต่ละขั้นแล้ว หัวนี้บอกแค่ลำดับ
  function headHtml() {
    return `<div class="form-steps-head" data-steps-head hidden><span class="form-steps-label" data-steps-label aria-live="polite"></span></div>`;
  }

  // แถวปุ่มล่างฟอร์ม: ยกเลิก · ย้อนกลับ · ถัดไป · ส่ง (bindStepper ซ่อน/แสดงตามขั้น บนจอแคบติดล่างจอ)
  function actionsHtml({ cancelHref, submitLabel }) {
    return `<div class="form-actions stepped-actions">
      <a class="btn secondary" href="${escapeHtml(cancelHref)}" data-form-cancel>ยกเลิก</a>
      <button type="button" class="btn secondary" data-step-back hidden>‹ ย้อนกลับ</button>
      <button type="button" class="btn is-primary" data-step-next hidden>ถัดไป ›</button>
      <button type="submit" class="btn is-primary" data-step-submit>${escapeHtml(submitLabel)}</button>
    </div>`;
  }

  // ตัวคุมฟอร์มทีละขั้น: วาดขั้นตามความกว้างจอ, ปุ่มย้อนกลับ/ถัดไป, ตรวจช่องของขั้นก่อนไปต่อ,
  // Enter ในช่องก่อนขั้นสุดท้าย = ถัดไป (ไม่ส่งข้ามขั้นทบทวน), ล้างข้อความผิดเมื่อแก้ช่องนั้น
  // rules: กติกาของ validate(); values(): ค่าปัจจุบันของฟอร์ม; onReview(): วาดขั้นทบทวนเมื่อมองเห็น
  function bindStepper({ form, count, reviewStep = count, rules, values, onReview, scrollTarget = form, query = "(max-width: 1040px)" }) {
    const narrowQuery = root.matchMedia(query);
    let current = 1;
    const paint = () => {
      // ออกจากหน้าแล้ว (หรือใบเสร็จแทนที่ฟอร์ม): เลิกฟังการย่อขยายจอ
      if (!form.isConnected) { narrowQuery.removeEventListener?.("change", paint); return; }
      const narrow = narrowQuery.matches;
      const view = stepView({ current, count, narrow, reviewStep });
      form.classList.toggle("is-stepped", narrow);
      form.querySelectorAll("[data-step]").forEach((section) => { section.hidden = !view.visible.includes(Number(section.dataset.step)); });
      const head = form.querySelector("[data-steps-head]");
      if (head) {
        head.hidden = !narrow;
        head.querySelector("[data-steps-label]").textContent = view.label;
      }
      form.querySelector("[data-step-back]").hidden = !view.showBack;
      form.querySelector("[data-step-next]").hidden = !view.showNext;
      form.querySelector("[data-step-submit]").hidden = !view.showSubmit;
      if (view.visible.includes(reviewStep)) onReview?.();
    };
    const goTo = (step, { focus = true } = {}) => {
      current = Math.min(Math.max(1, step), count);
      paint();
      if (focus && narrowQuery.matches) {
        const legend = form.querySelector(`[data-step="${current}"] legend`);
        if (legend) {
          legend.tabIndex = -1;
          legend.focus();
        }
        scrollTarget.scrollIntoView({ block: "start", behavior: "auto" });
      }
    };
    // step = เลขขั้น หรือ "all" (ก่อนส่ง) — ผิดแล้วพาไปขั้นที่มีช่องผิดช่องแรก และโฟกัสช่องนั้น
    const check = (step) => {
      const errors = validate(rules.filter((rule) => step === "all" || rule.step === step), values());
      if (!errors.length) { clearFieldErrors(form); return true; }
      goTo(errors[0].step, { focus: false });
      showFieldErrors(form, errors)?.focus();
      return false;
    };
    form.querySelector("[data-step-next]").addEventListener("click", () => { if (check(current)) goTo(current + 1); });
    form.querySelector("[data-step-back]").addEventListener("click", () => goTo(current - 1));
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      // ปุ่มเลือกไฟล์ใช้ Enter เปิดตัวเลือกไฟล์ (คีย์บอร์ดต่อ iPad) จึงไม่นับ
      if (!event.target.matches("input:not([type=file])") || !narrowQuery.matches || current >= count) return;
      event.preventDefault();
      form.querySelector("[data-step-next]").click();
    });
    const clearOnEdit = (event) => {
      const name = event.target.closest?.("[data-field]")?.dataset.field;
      if (name) clearFieldError(form, name);
    };
    form.addEventListener("input", clearOnEdit);
    form.addEventListener("change", clearOnEdit);
    narrowQuery.addEventListener?.("change", paint);
    paint();
    return { goTo, check, paint, get current() { return current; } };
  }

  // ใบเสร็จหลังส่ง: แทนที่การ์ดฟอร์ม บอกเลขที่และขั้นที่รอ พร้อม ดูใบ / ทำอีกใบ / หน้าหลัก แล้วโฟกัสหัวใบเสร็จ
  function showReceipt(card, { title, number = "", waitingOn = "", warning = "", viewHref, viewLabel, againLabel, onAgain }) {
    const check = root.MNP_UI_ICONS?.icon("check") ?? "";
    const facts = [number ? `<span class="request-no">${escapeHtml(number)}</span>` : "", waitingOn ? `รอ${escapeHtml(waitingOn)}` : ""].filter(Boolean).join(" · ");
    card.classList.add("form-receipt");
    card.innerHTML = `<div class="decision-receipt" role="status">
        <span class="decision-receipt-icon" aria-hidden="true">${check}</span>
        <div>
          <h2 tabindex="-1" data-receipt-title>${escapeHtml(title)}</h2>
          ${facts ? `<p>${facts}</p>` : ""}
          ${warning ? `<p class="form-message error">${escapeHtml(warning)}</p>` : ""}
        </div>
      </div>
      <div class="action-panel-buttons"><a class="btn is-primary" href="${escapeHtml(viewHref)}">${escapeHtml(viewLabel)}</a><button type="button" class="btn secondary" data-again>${escapeHtml(againLabel)}</button><a class="btn secondary" href="#/">หน้าหลัก</a></div>`;
    card.querySelector("[data-again]").addEventListener("click", onAgain);
    card.querySelector("[data-receipt-title]").focus();
  }

  root.MNP_FORM_STEPS = Object.freeze({ validate, numberOf, stepView, showFieldErrors, clearFieldErrors, clearFieldError, headHtml, actionsHtml, bindStepper, showReceipt });
})(typeof window !== "undefined" ? window : globalThis);
