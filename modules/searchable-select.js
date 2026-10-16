// dropdown ค้นหาได้ของ Pilot Web — ทุก <select> ในหน้าเว็บถูกเสริมเป็นช่องพิมพ์ค้นหา + รายการเลือก (combobox) อัตโนมัติ
//
// หลักการ: <select> เดิมยังอยู่ในฟอร์มทุกอย่าง (name, id, required, value, event "change") แค่ถูกซ่อนแบบยังรับ focus ได้
// โค้ดของทุกโมดูลจึงทำงานเหมือนเดิมโดยไม่ต้องแก้: อ่าน/ตั้ง select.value ได้ ฟัง "change" ได้ และ FormData ส่งค่าเดิม
//   * เลือกจากรายการ → ตั้ง select.value แล้วยิง "input" + "change" (bubbles) เหมือนผู้ใช้เลือกจาก dropdown เดิม
//   * โค้ดตั้ง select.value / selectedIndex เอง, สร้าง <option> ใหม่, ปิด/เปิด disabled หรือ reset ฟอร์ม → ข้อความในช่องตามให้เอง
//   * กด <label for> หรือ reportValidity() ที่ focus <select> → ย้าย focus ไปช่องค้นหา
// รายการเลือกเป็น popup (data-popup) อยู่ในกรอบเดียวกับช่องค้นหา ปิดด้วยกฎกลาง closePopup ของ app.js เท่านั้น
// (แตะ/คลิกหรือย้าย focus ออกนอกกรอบ) ห้ามปิดจาก blur เพราะ iPhone ไม่ย้าย focus ไปที่ปุ่มที่ถูกแตะ (AGENTS.md)
// รายการวางแบบ position: fixed ตามตำแหน่งช่อง จึงไม่ถูกตัดโดยตาราง/การ์ดที่เลื่อนได้
// ไม่เสริม: <select multiple>, <select size> มากกว่า 1 และ <select data-native-select> (ทางออกถ้าจุดไหนต้องการ dropdown ของเบราว์เซอร์)
//
// ส่วนที่ไม่มี DOM (normalizeText, matches, filterOptions, stepIndex) เทสต์ที่ scripts/tests/searchable-select.test.mjs
// โหลดก่อน app.js (ดู index.html) — เรียก closePopup ของ app.js ตอนผู้ใช้กดเท่านั้น
(function (root) {
  // ข้อความสำหรับค้นหา: ตัดช่องว่างหัวท้าย ยุบช่องว่างซ้อน ไม่สนตัวพิมพ์ (รวมตัวอักษรไทย/อังกฤษปนกัน)
  function normalizeText(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("th-TH");
  }

  // ทุกคำในคำค้น (คั่นด้วยช่องว่าง) ต้องอยู่ในข้อความของตัวเลือก — คำค้นว่าง = ตรงทุกตัว
  function matches(label, query) {
    const words = normalizeText(query).split(" ").filter(Boolean);
    if (!words.length) return true;
    const text = normalizeText(label);
    return words.every((word) => text.includes(word));
  }

  // options: [{ label, disabled }] → ลำดับ (index เดิม) ของตัวเลือกที่ตรงคำค้น คงลำดับเดิมของ <select>
  function filterOptions(options, query) {
    const result = [];
    (options ?? []).forEach((option, index) => {
      if (matches(option.label, query)) result.push(index);
    });
    return result;
  }

  // เลื่อนตัวเลือกที่ไฮไลต์ (ลูกศรขึ้น/ลง) ข้ามตัวที่ปิดใช้งาน วนรอบ — ไม่มีตัวที่เลือกได้คืน -1
  // visible: index ของตัวเลือกที่แสดงอยู่ · current: ตำแหน่งใน visible (-1 = ยังไม่ไฮไลต์) · step: 1 หรือ -1
  function stepIndex(visible, options, current, step) {
    const count = visible.length;
    if (!count) return -1;
    let position = current;
    for (let tries = 0; tries < count; tries += 1) {
      position = position < 0 ? (step > 0 ? 0 : count - 1) : (position + step + count) % count;
      if (!options[visible[position]]?.disabled) return position;
    }
    return -1;
  }

  const api = { normalizeText, matches, filterOptions, stepIndex };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.MNP_SEARCHABLE_SELECT = api;
  if (typeof document === "undefined") return;

  // ---------- ส่วนที่ทำงานในเบราว์เซอร์ ----------
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const nativeIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  let counter = 0;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  const optionLabel = (option) => (option.label || option.textContent || "").trim();
  // จำนวนช่องที่เห็นจริง: สระบน/ล่างและวรรณยุกต์ไทยซ้อนอยู่บนตัวอักษร ไม่กินความกว้าง
  const visibleLength = (text) => text.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
  const skip = (select) => select.multiple || select.size > 1 || select.hasAttribute("data-native-select") || select.dataset.ssDone === "1";

  // วางรายการ (position: fixed) ใต้ช่อง หรือเหนือช่องเมื่อที่ว่างด้านล่างไม่พอ กว้างอย่างน้อยเท่าช่อง สูงไม่เกินที่ว่างบนจอ
  // (หักคีย์บอร์ดมือถือด้วย visualViewport) — ใช้ร่วมกับ combobox อื่นที่ใช้ class .ss-list เช่น ช่องค้นหาวัสดุของ MNP LAB
  // ผู้เรียกต้องเรียกซ้ำเมื่อเลื่อนหน้า/ปรับขนาดจอขณะรายการเปิดอยู่
  function placeList(anchor, list) {
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
    const below = height - rect.bottom - 8;
    const above = rect.top - 8;
    const openUp = below < 200 && above > below;
    const room = Math.max(120, Math.min(320, openUp ? above : below));
    list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8))}px`;
    list.style.width = `${Math.max(rect.width, 220)}px`;
    list.style.maxHeight = `${room}px`;
    list.style.top = openUp ? "" : `${rect.bottom + 4}px`;
    list.style.bottom = openUp ? `${height - rect.top + 4}px` : "";
  }

  function labelText(select) {
    const own = select.getAttribute("aria-label") || select.title;
    if (own) return own;
    return [...(select.labels ?? [])].map((label) => label.textContent.trim()).filter(Boolean).join(" ") || "เลือกรายการ";
  }

  function enhance(select) {
    if (skip(select)) return;
    select.dataset.ssDone = "1";
    counter += 1;
    const id = `ss-${counter}`;
    const wrapper = document.createElement("div");
    wrapper.className = "ss";
    select.before(wrapper);
    const input = document.createElement("input");
    input.type = "text";
    input.className = `${select.className} ss-input`.trim();
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", `${id}-list`);
    input.setAttribute("aria-label", labelText(select));
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("enterkeyhint", "done");
    input.placeholder = "พิมพ์เพื่อค้นหา…";
    const list = document.createElement("div");
    list.className = "ss-list";
    list.id = `${id}-list`;
    list.setAttribute("role", "listbox");
    list.setAttribute("data-popup", "");
    list.hidden = true;
    wrapper.append(input, select, list);
    select.classList.add("ss-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    let options = [];
    let visible = [];
    let active = -1;
    let typed = false;

    const currentLabel = () => {
      const option = select.options[nativeIndex.get.call(select)];
      return option ? optionLabel(option) : "";
    };
    const sync = () => {
      if (list.hidden || !typed) input.value = currentLabel();
      // กว้างตามตัวเลือกที่ยาวที่สุดเหมือน <select> เดิม (ใช้เมื่อ CSS ให้ width: auto) +2 เผื่อลูกศร
      input.size = Math.min(40, Math.max(4, ...[...select.options].map((option) => visibleLength(optionLabel(option)))) + 2);
      input.disabled = select.disabled;
      input.required = select.required;
      input.setAttribute("aria-label", labelText(select));
    };

    // select.value / selectedIndex ที่โค้ดตั้งเอง (เช่น ฟอร์มแก้ไขที่เติมค่าเดิม) ไม่มี event → ดักที่ตัว element นี้ให้ข้อความตาม
    Object.defineProperty(select, "value", { configurable: true, get() { return nativeValue.get.call(this); }, set(value) { nativeValue.set.call(this, value); sync(); } });
    Object.defineProperty(select, "selectedIndex", { configurable: true, get() { return nativeIndex.get.call(this); }, set(value) { nativeIndex.set.call(this, value); sync(); } });

    function place() {
      if (!input.isConnected) return stopTracking();
      placeList(input, list);
    }
    const startTracking = () => {
      window.addEventListener("scroll", place, true);
      window.addEventListener("resize", place);
      window.visualViewport?.addEventListener("resize", place);
    };
    function stopTracking() {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    }

    function setActive(position, scroll = true) {
      active = position;
      list.querySelectorAll(".ss-option").forEach((node) => node.classList.toggle("is-active", Number(node.dataset.pos) === position));
      const node = list.querySelector(`.ss-option[data-pos="${position}"]`);
      if (node) {
        input.setAttribute("aria-activedescendant", node.id);
        if (scroll) node.scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function render(query) {
      options = [...select.options].map((option) => ({ label: optionLabel(option), disabled: option.disabled }));
      visible = filterOptions(options, query);
      const selected = nativeIndex.get.call(select);
      list.innerHTML = visible.length
        ? visible.map((index, position) => `<button type="button" tabindex="-1" class="ss-option${index === selected ? " is-selected" : ""}" id="${id}-o${index}" role="option" data-pos="${position}" aria-selected="${index === selected}"${options[index].disabled ? ' aria-disabled="true" disabled' : ""}>${esc(options[index].label) || "&nbsp;"}</button>`).join("")
        : `<div class="ss-empty">${options.length ? "ไม่พบรายการที่ค้นหา" : "ไม่มีตัวเลือก"}</div>`;
      // ยังไม่พิมพ์ = ไฮไลต์ตัวที่เลือกอยู่ · พิมพ์แล้ว = ไฮไลต์ตัวแรกที่ตรง (กด Enter เลือกได้ทันที)
      const start = query ? stepIndex(visible, options, -1, 1) : visible.indexOf(selected);
      setActive(start);
    }

    function open() {
      if (input.disabled) return;
      if (list.hidden) {
        typed = false;
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        startTracking();
        render("");
        place();
        input.select();
        return;
      }
      place();
    }

    // ปิดผ่านกฎกลางของ app.js เสมอ (ตั้ง aria-expanded และส่ง "popup-close")
    function close() {
      if (typeof window.closePopup === "function") window.closePopup(list);
      else list.hidden = true;
    }

    function choose(position) {
      const index = visible[position];
      if (index === undefined || options[index]?.disabled) return;
      const changed = nativeIndex.get.call(select) !== index;
      nativeIndex.set.call(select, index);
      typed = false;
      close();
      input.value = currentLabel();
      if (changed) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // ปิดด้วยกฎกลางของ app.js (แตะนอกกรอบ / focus ออกนอกกรอบ) หรือ Escape → ทิ้งคำค้น แสดงตัวที่เลือกอยู่
    list.addEventListener("popup-close", () => {
      stopTracking();
      typed = false;
      input.value = currentLabel();
    });

    input.addEventListener("click", open);
    input.addEventListener("input", () => {
      typed = true;
      if (list.hidden) {
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        startTracking();
        place();
      }
      render(input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (list.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        input.select();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (list.hidden) return open();
        const next = stepIndex(visible, options, active, event.key === "ArrowDown" ? 1 : -1);
        if (next >= 0) setActive(next);
        return;
      }
      if (event.key === "Enter") {
        // Enter ไม่ส่งฟอร์มจากช่องนี้ (dropdown เดิมก็ไม่ส่ง) — เปิดรายการ หรือเลือกตัวที่ไฮไลต์
        event.preventDefault();
        if (list.hidden) return open();
        if (active >= 0) choose(active);
      }
    });
    // กดค้างบนรายการไม่ให้ช่องค้นหาเสีย focus (คีย์บอร์ดมือถือไม่หุบแล้วเด้งกลับตอนเลือก)
    list.addEventListener("mousedown", (event) => event.preventDefault());
    list.addEventListener("click", (event) => {
      const node = event.target.closest(".ss-option");
      if (!node || node.disabled) return;
      choose(Number(node.dataset.pos));
    });
    list.addEventListener("mousemove", (event) => {
      const node = event.target.closest(".ss-option");
      if (node && !node.disabled && Number(node.dataset.pos) !== active) setActive(Number(node.dataset.pos), false);
    });

    select.addEventListener("focus", () => input.focus());
    select.addEventListener("change", sync);
    select.form?.addEventListener("reset", () => setTimeout(sync, 0));
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "required", "aria-label", "label"] });
    sync();
  }

  function enhanceAll(scope) {
    if (scope?.matches?.("select")) enhance(scope);
    scope?.querySelectorAll?.("select").forEach(enhance);
  }

  root.MNP_SEARCHABLE_SELECT.placeList = placeList;
  root.MNP_SEARCHABLE_SELECT.enhance = enhance;
  root.MNP_SEARCHABLE_SELECT.enhanceAll = enhanceAll;
  // ทุกหน้าที่วาดใหม่ (app.innerHTML) และแถวที่เพิ่มทีหลัง (เช่น บรรทัดส่วนประกอบของ BOM) ถูกเสริมเองเมื่อเข้ามาใน DOM
  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach((node) => { if (node.nodeType === 1) enhanceAll(node); });
  }).observe(document.body, { childList: true, subtree: true });
  enhanceAll(document.body);
})(typeof window !== "undefined" ? window : globalThis);
