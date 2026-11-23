// แถบช่วงที่แสดงของกราฟ MNP LAB (ใช้ร่วมกันระหว่างกราฟ Mooney และกราฟแนวโน้มรายวันของ MDR) — คณิตของช่วงและ HTML ของแถบ ข้อความล้วน ไม่มี DOM
// เทสต์ที่ scripts/tests/lab-range.test.mjs (และผ่านตัวห่อใน lab-mooney-chart.js ที่ scripts/tests/lab-mooney-views.test.mjs)
//
// ช่วง = { start, end } ตำแหน่งในรายการทั้งหมด (end ไม่รวม) เรียงเก่า → ใหม่ ทุกฟังก์ชันคืนช่วงใหม่ที่ผ่าน normalize แล้ว ไม่แก้ค่าเดิม
// min = จำนวนน้อยสุดที่ซูมเข้าได้ (Mooney = สองแถบ 12 ครั้ง, MDR = 3 วัน) แต่ละกราฟส่งของตัวเอง
// แถบ: ปุ่ม "ล่าสุด N" / "ทั้งหมด" + เดือน … ถึง … (<select> ของเบราว์เซอร์ แตะง่ายบน iPhone) + เลื่อน ‹ › + ซูม − + (คลาส .lab-zoom ใน styles.css)
(function (root) {
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // "YYYY-MM-DD…" → "YYYY-MM" (ไม่ใช่วันที่ = null)
  const monthOf = (date) => (typeof date === "string" && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null);

  // กว้างอย่างน้อย min (หรือเท่าที่มี) อย่างมากทั้งรายการ และไม่เลยขอบรายการ
  function normalize(range, total, min) {
    if (!(total > 0)) return { start: 0, end: 0 };
    const start = Math.floor(Number(range?.start));
    const end = Math.ceil(Number(range?.end));
    const width = clamp((Number.isFinite(end) ? end : total) - (Number.isFinite(start) ? start : 0), Math.min(min, total), total);
    const first = clamp(Number.isFinite(start) ? start : 0, 0, total - width);
    return { start: first, end: first + width };
  }

  const same = (a, b) => Boolean(a && b) && a.start === b.start && a.end === b.end;

  // months = เดือน ("YYYY-MM" หรือ null) ของแต่ละรายการตามลำดับ · ทุกรายการของเดือน from ถึงเดือน to (รวมทั้งสองเดือน) ไม่มีรายการใดในช่วงนั้น = null
  // น้อยกว่า min ถูกขยาย (normalize) จึงอาจเห็นเดือนข้างเคียงด้วย
  function forMonths(months, from, to, min) {
    let start = -1;
    let end = -1;
    months.forEach((month, index) => {
      if (!month) return;
      if (start < 0 && month >= from) start = index;
      if (month <= to) end = index + 1;
    });
    return start >= 0 && end > start ? normalize({ start, end }, months.length, min) : null;
  }

  // ช่วงจากตัวเลือกของผู้ใช้: "latest" = ล่าสุด latest รายการ, "all" = ทั้งหมด, "months" = เดือน from ถึงเดือน to (เดือนนั้นไม่มีข้อมูลแล้ว = ล่าสุด),
  // "custom" = ช่วงที่ซูม/เลื่อนมาเอง (follow = ติดขอบขวาอยู่ จึงขยับตามเมื่อมีรายการใหม่เข้ามา)
  // ตัวเลือกที่ไม่ใช่ custom คำนวณใหม่ทุกครั้งที่วาด จึงตามข้อมูลใหม่ (เดือนที่เลือกรับรายการใหม่ของเดือนนั้นเข้ามาเอง)
  // exactMonths = เดือนที่เลือกได้เฉพาะรายการของเดือนนั้นจริง แม้น้อยกว่า min (MDR: ต.ค. มี 2 วัน = 2 วัน ไม่เติมวันของ พ.ย.) Mooney ไม่ส่ง = ขยายถึง min เหมือนเดิม
  function resolve(zoom, months, { latest, min, exactMonths = false }) {
    const total = months.length;
    const kind = zoom?.kind ?? "latest";
    if (kind === "all") return normalize({ start: 0, end: total }, total, min);
    if (kind === "months") {
      const range = forMonths(months, zoom.from, zoom.to, exactMonths ? 1 : min);
      if (range) return range;
    }
    if (kind === "custom") {
      const size = Number(zoom.end) - Number(zoom.start);
      return normalize(zoom.follow ? { start: total - size, end: total } : zoom, total, min);
    }
    return normalize({ start: total - latest, end: total }, total, min);
  }

  // ซูมด้วยตัวคูณ factor (>1 = เข้า, <1 = ออก) โดยตรึงตำแหน่งที่ anchor (0 = ขอบซ้าย … 1 = ขอบขวาของช่วง) ไว้ที่เดิม
  function zoom(range, total, factor, anchor, min) {
    const current = normalize(range, total, min);
    const width = current.end - current.start;
    const next = clamp(Math.round(width / (Number(factor) > 0 ? factor : 1)), Math.min(min, total), total);
    if (next === width) return current;
    const at = clamp(Number.isFinite(anchor) ? anchor : 0.5, 0, 1);
    const start = Math.round(current.start + at * width - at * next);
    return normalize({ start, end: start + next }, total, min);
  }

  function pan(range, total, delta, min) {
    const current = normalize(range, total, min);
    const shift = Math.round(Number(delta) || 0);
    return normalize({ start: current.start + shift, end: current.end + shift }, total, min);
  }

  // ทำให้รายการที่ index อยู่ในช่วง: เลยขอบไปแค่หนึ่ง (กดลูกศรเลื่อนต่อ) ขยับให้พอดีขอบ ไกลกว่านั้นวางไว้กลางช่วง
  function reveal(range, total, index, min) {
    const current = normalize(range, total, min);
    if (!(index >= 0 && index < total) || (index >= current.start && index < current.end)) return current;
    const width = current.end - current.start;
    const first = index === current.start - 1 ? index : index === current.end ? index + 1 - width : Math.round(index - (width - 1) / 2);
    return normalize({ start: first, end: first + width }, total, min);
  }

  // ปุ่มที่ไปต่อไม่ได้ (ปิดไว้): เลื่อนซ้าย/ขวาสุดแล้ว ซูมออกเห็นทั้งหมดแล้ว ซูมเข้าถึง min แล้ว
  function limits(range, total, min) {
    const width = range.end - range.start;
    return { back: range.start <= 0, forward: range.end >= total, out: width >= total, in: width <= Math.min(min, total) };
  }

  // ปุ่มเลื่อนครึ่งช่วง (อย่างน้อย 1 รายการ)
  const panStep = (range, fraction) => Math.max(1, Math.round((range.end - range.start) * Math.abs(fraction))) * Math.sign(fraction);

  /* ---------- HTML ของแถบ ---------- */

  const STEP_ICONS = Object.freeze({
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
    forward: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`,
    out: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>`,
    in: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>`,
  });
  const STEP_LABELS = Object.freeze({ back: "เลื่อนไปช่วงก่อนหน้า", forward: "เลื่อนไปช่วงถัดไป", out: "ซูมออก (−)", in: "ซูมเข้า (+)" });

  // ids = { bar, from, to } · titles = { latest, all, in? } คำอธิบายปุ่ม (title) · ป้ายปุ่ม "ล่าสุด" ตั้งตอนวาด (จำนวนอาจตามความกว้างจอ)
  // label = ชื่อแถบสำหรับโปรแกรมอ่านหน้าจอ (หน้าที่มีสองแถบ เช่น MDR F1 ต้องบอกว่าแถบไหนของกราฟไหน)
  // แถบซ่อนไว้ (hidden) จนกว่าตัวควบคุมจะวาดช่วงแรก
  function toolbar({ ids, titles, latestLabel = "ล่าสุด", label = "ช่วงที่แสดงและการซูมของกราฟ" }) {
    const buttons = [{ key: "latest", label: latestLabel, title: titles.latest }, { key: "all", label: "ทั้งหมด", title: titles.all }];
    const ranges = buttons.map((button) => `<button type="button" class="lab-range-btn" data-range="${button.key}" aria-pressed="false" title="${esc(button.title)}">${esc(button.label)}</button>`).join("");
    const steps = ["back", "forward", "out", "in"].map((key) => {
      const label = key === "in" && titles.in ? titles.in : STEP_LABELS[key];
      return `<button type="button" class="lab-step" data-step="${key}" aria-label="${esc(label)}" title="${esc(label)}">${STEP_ICONS[key]}</button>`;
    }).join("");
    const months = `<div class="lab-months" role="group" aria-label="ช่วงเดือนที่แสดง"><select class="select lab-month" id="${esc(ids.from)}" data-native-select aria-label="ตั้งแต่เดือน"></select><span class="lab-month-to" aria-hidden="true">ถึง</span><select class="select lab-month" id="${esc(ids.to)}" data-native-select aria-label="ถึงเดือน"></select></div>`;
    return `<div class="lab-zoom" id="${esc(ids.bar)}" role="toolbar" aria-label="${esc(label)}" hidden><div class="lab-ranges" role="group" aria-label="ช่วงที่แสดง">${ranges}</div>${months}<div class="lab-steps">${steps}</div></div>`;
  }

  // ตัวเลือกของช่องเดือน (months = "YYYY-MM" เรียงเก่า → ใหม่) ป้ายจาก formatMonth ของแต่ละโมดูล
  const monthOptions = (months, selected, formatMonth) => months
    .map((month) => `<option value="${esc(month)}"${month === selected ? " selected" : ""}>${esc(formatMonth(month))}</option>`)
    .join("");

  // เปลี่ยนช่องเดือน: เลือกเดือนเริ่มหลังเดือนจบ อีกช่องย้ายตามมาเป็นเดือนเดียวกัน
  function pickMonths(from, to, changed) {
    if (from <= to) return { from, to };
    return changed === "from" ? { from, to: from } : { from: to, to };
  }

  const api = { monthOf, normalize, same, forMonths, resolve, zoom, pan, reveal, limits, panStep, toolbar, monthOptions, pickMonths };
  root.MNP_LAB_RANGE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
