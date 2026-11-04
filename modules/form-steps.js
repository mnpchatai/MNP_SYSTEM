// ฟอร์มแบบทีละขั้นบนจอแคบ (หน้าเดียวบนจอกว้าง) และการตรวจช่องเป็นภาษาไทยแทน validation ของเบราว์เซอร์
// กติกาล้วน (validate, stepView) ทดสอบได้ใน Node; ส่วน DOM (showFieldErrors) ใช้ในหน้าฟอร์ม
(function (root) {
  "use strict";

  // rules: [{ name, step, required, minLength, message }] เรียงตามลำดับที่อยู่บนจอ
  // คืนข้อผิดพลาดตามลำดับเดียวกัน ช่องแรกที่ผิดจึงเป็นช่องที่ต้องพาไป
  function validate(rules, values) {
    const errors = [];
    for (const rule of rules) {
      const raw = values[rule.name];
      const text = typeof raw === "string" ? raw.trim() : raw;
      const missing = text === undefined || text === null || text === "" || text === false;
      if (rule.required && missing) { errors.push({ name: rule.name, step: rule.step, message: rule.message }); continue; }
      if (!missing && rule.minLength && String(text).length < rule.minLength) errors.push({ name: rule.name, step: rule.step, message: rule.message });
    }
    return errors;
  }

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
      const target = focusTargetOf(container);
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
    focusTargetOf(container)?.removeAttribute("aria-invalid");
  }

  root.MNP_FORM_STEPS = Object.freeze({ validate, stepView, showFieldErrors, clearFieldErrors, clearFieldError });
})(typeof window !== "undefined" ? window : globalThis);
