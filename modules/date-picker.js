// ตัวเลือกวันที่แบบไทย (เดือนไทย ปี พ.ศ.) แทน input type=date ของเบราว์เซอร์ที่แสดง mm/dd/yyyy
// เสริมจาก input เดิม: ค่าในฟอร์มยังเป็น YYYY-MM-DD ใน input ตัวเดิม (ซ่อนไว้) ไม่มี JS = ใช้ input ของเบราว์เซอร์ตามเดิม
// รายการวันเป็น popup (data-popup) อยู่ในกรอบเดียวกับปุ่ม ปิดด้วยกติกา closePopup ของ app.js (แตะ/โฟกัสนอกกรอบ, Esc)
(function (root) {
  "use strict";

  const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const WEEKDAYS_FULL = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const BE_OFFSET = 543;

  const pad = (value) => String(value).padStart(2, "0");
  const isIso = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

  // วันที่เป็นวันปฏิทินล้วน (ไม่มีเวลา) คำนวณด้วย UTC จะไม่เลื่อนวันตามเขตเวลาเครื่อง
  function parts(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return { year, month, day };
  }
  function toIso(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  function weekday(iso) {
    const { year, month, day } = parts(iso);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }
  function shiftDays(iso, days) {
    const { year, month, day } = parts(iso);
    return toIso(year, month, day + days);
  }
  // เลื่อนเดือน: วันที่ 31 ไปเดือนที่มี 30 วันได้วันสุดท้ายของเดือนนั้น ไม่ล้นไปเดือนถัดไป
  function shiftMonths(iso, months) {
    const { year, month, day } = parts(iso);
    const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
    return toIso(year, month + months, Math.min(day, lastDay));
  }
  function todayIso(now = Date.now()) {
    const bangkok = new Date(now + 7 * 60 * 60 * 1000);
    return `${bangkok.getUTCFullYear()}-${pad(bangkok.getUTCMonth() + 1)}-${pad(bangkok.getUTCDate())}`;
  }
  function label(iso) {
    if (!isIso(iso)) return "";
    const { year, month, day } = parts(iso);
    return `${day} ${MONTHS_SHORT[month - 1]} ${year + BE_OFFSET}`;
  }
  function fullLabel(iso) {
    const { year, month, day } = parts(iso);
    return `วัน${WEEKDAYS_FULL[weekday(iso)]}ที่ ${day} ${MONTHS[month - 1]} ${year + BE_OFFSET}`;
  }
  function monthTitle(iso) {
    const { year, month } = parts(iso);
    return `${MONTHS[month - 1]} ${year + BE_OFFSET}`;
  }
  // 6 สัปดาห์ เริ่มวันอาทิตย์ (แบบปฏิทินไทย) ครอบเดือนของวันที่ให้มา
  function monthMatrix(iso) {
    const { year, month } = parts(iso);
    const first = toIso(year, month, 1);
    const start = shiftDays(first, -weekday(first));
    return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (__, dayIndex) => {
      const date = shiftDays(start, week * 7 + dayIndex);
      return { iso: date, inMonth: parts(date).month === month };
    }));
  }

  // ---- DOM ----
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  let instance = 0;

  function enhance(input) {
    if (!input || input.dataset.datePicker === "on") return;
    input.dataset.datePicker = "on";
    instance += 1;
    const id = `date-pick-${instance}`;
    const wrapper = document.createElement("div");
    wrapper.className = "date-pick";
    input.before(wrapper);
    wrapper.append(input);
    input.hidden = true;
    input.tabIndex = -1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "input date-pick-button";
    button.dataset.focus = "";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", `${id}-popup`);
    const labelled = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
    if (labelled) {
      if (!labelled.id) labelled.id = `${input.id}-label`;
      button.id = `${input.id}-button`;
      labelled.htmlFor = button.id;
      button.setAttribute("aria-describedby", `${id}-value`);
    }
    const popup = document.createElement("div");
    popup.className = "date-pick-popup";
    popup.id = `${id}-popup`;
    popup.dataset.popup = "";
    popup.hidden = true;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "เลือกวันที่");
    wrapper.append(button, popup);
    let focused = input.value || todayIso();

    const paintButton = () => {
      button.innerHTML = `<span id="${id}-value">${input.value ? escapeHtml(label(input.value)) : '<span class="date-pick-empty">เลือกวันที่</span>'}</span><span class="date-pick-icon" aria-hidden="true">${root.MNP_UI_ICONS?.icon("calendar") ?? ""}</span>`;
    };
    const paintPopup = () => {
      const today = todayIso();
      popup.innerHTML = `<div class="date-pick-head">
          <button type="button" class="icon-button" data-move="-1" aria-label="เดือนก่อน">‹</button>
          <strong aria-live="polite">${escapeHtml(monthTitle(focused))}</strong>
          <button type="button" class="icon-button" data-move="1" aria-label="เดือนถัดไป">›</button>
        </div>
        <table class="date-pick-grid" role="grid" aria-label="${escapeHtml(monthTitle(focused))}">
          <thead><tr>${WEEKDAYS.map((day, index) => `<th scope="col" abbr="${WEEKDAYS_FULL[index]}">${day}</th>`).join("")}</tr></thead>
          <tbody>${monthMatrix(focused).map((week) => `<tr>${week.map((cell) => `<td><button type="button" class="date-pick-day${cell.inMonth ? "" : " is-outside"}${cell.iso === today ? " is-today" : ""}" data-date="${cell.iso}" tabindex="${cell.iso === focused ? 0 : -1}" aria-selected="${cell.iso === input.value}" aria-label="${escapeHtml(fullLabel(cell.iso))}${cell.iso === today ? " (วันนี้)" : ""}">${parts(cell.iso).day}</button></td>`).join("")}</tr>`).join("")}</tbody>
        </table>
        <div class="date-pick-foot"><button type="button" class="btn secondary small" data-pick="today">วันนี้</button>${input.value ? `<button type="button" class="btn secondary small" data-pick="clear">ล้าง</button>` : ""}</div>`;
    };
    const focusDay = () => popup.querySelector(`[data-date="${focused}"]`)?.focus();
    const close = ({ restoreFocus = true } = {}) => {
      if (popup.hidden) return;
      if (typeof root.closePopup === "function") root.closePopup(popup);
      else { popup.hidden = true; button.setAttribute("aria-expanded", "false"); }
      if (restoreFocus) button.focus();
    };
    const open = () => {
      focused = input.value || todayIso();
      paintPopup();
      popup.hidden = false;
      button.setAttribute("aria-expanded", "true");
      focusDay();
    };
    const choose = (iso) => {
      input.value = iso;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      paintButton();
      close();
    };
    const move = (next) => {
      focused = next;
      paintPopup();
      focusDay();
    };

    button.addEventListener("click", () => (popup.hidden ? open() : close()));
    popup.addEventListener("click", (event) => {
      const day = event.target.closest("[data-date]");
      if (day) return choose(day.dataset.date);
      const monthButton = event.target.closest("[data-move]");
      if (monthButton) {
        focused = shiftMonths(focused, Number(monthButton.dataset.move));
        paintPopup();
        popup.querySelector(`[data-move="${monthButton.dataset.move}"]`)?.focus();
        return;
      }
      const pick = event.target.closest("[data-pick]")?.dataset.pick;
      if (pick === "today") choose(todayIso());
      if (pick === "clear") choose("");
    });
    popup.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (!event.target.matches("[data-date]")) return;
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (event.key in steps) { event.preventDefault(); move(shiftDays(focused, steps[event.key])); return; }
      if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); move(shiftMonths(focused, event.key === "PageUp" ? -1 : 1)); return; }
      if (event.key === "Home") { event.preventDefault(); move(shiftDays(focused, -weekday(focused))); return; }
      if (event.key === "End") { event.preventDefault(); move(shiftDays(focused, 6 - weekday(focused))); }
    });
    // ค่าที่ตั้งจากโค้ด (เช่น คืนร่าง) ต้องแสดงบนปุ่มด้วย
    input.addEventListener("datepicker:refresh", paintButton);
    paintButton();
  }

  root.MNP_DATE_PICKER = Object.freeze({ label, fullLabel, monthTitle, monthMatrix, shiftDays, shiftMonths, todayIso, weekday, isIso, enhance });
})(typeof window !== "undefined" ? window : globalThis);
