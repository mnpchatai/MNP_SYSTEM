// RubberFlow MES (แผนก RB โหมดทดสอบ) — ชิ้นส่วน HTML ที่ใช้ร่วมกันทุกหน้า (ui.jsx ของต้นแบบ แปลงจาก React เป็นสตริง HTML)
// รวมกราฟ SVG (แทน recharts) และบาร์โค้ด Code 39 (แทน QR ของต้นแบบ: ไม่ต้องใช้ไลบรารี พิมพ์ได้ และกล้อง BarcodeDetector อ่านได้)
// ไม่แตะ DOM เอง: ทุกฟังก์ชันคืน HTML ส่วนการผูก event อยู่ที่ modules/module-rubberflow.js
// โหลดหลัง modules/rubberflow-rules.js ก่อนไฟล์หน้า — ใช้ escapeHtml ของ app.js (เทสต์ส่ง stub เข้ามาทาง globalThis)
(function (root) {
  const rules = root.MNP_RUBBERFLOW_RULES;
  const esc = (value) => root.escapeHtml(value);
  const attr = (value) => esc(value ?? "");
  const n2 = (number) => String(Math.round(Number(number) * 100) / 100);

  // ---------- ป้ายสถานะ ----------
  const STATUS = Object.freeze({
    planned: ["", "วางแผน"], released: ["info", "ปล่อยผลิต"], in_progress: ["accent", "กำลังผลิต"], on_hold: ["warn", "พักงาน"],
    completed: ["good", "เสร็จสิ้น"], cancelled: ["bad", "ยกเลิก"],
    pass: ["good", "ผ่าน"], hold: ["warn", "กักกัน (Hold)"], fail: ["bad", "ไม่ผ่าน"],
    weighing: ["warn", "กำลังชั่ง"], issued: ["info", "จ่ายครบ รอผสม"], consumed: ["good", "ใช้ผสมแล้ว"],
    in_transit: ["warn", "รอรับมอบ"], received: ["good", "รับมอบแล้ว"],
    open: ["bad", "เปิดอยู่"], closed: ["good", "ปิดแล้ว"],
    available: ["good", "พร้อมใช้"], expired: ["bad", "หมดอายุ (บล็อก)"], empty: ["", "หมด"],
    in_stock: ["good", "ในคลัง"], shipped: ["info", "ส่งมอบแล้ว"],
    draft: ["warn", "รออนุมัติ"], approved: ["good", "อนุมัติแล้ว"],
    critical: ["bad", "Critical"], major: ["warn", "Major"], minor: ["", "Minor"],
  });
  const badge = (tone, text) => `<span class="rf-badge${tone ? ` is-${esc(tone)}` : ""}">${esc(text)}</span>`;
  const status = (value) => {
    const [tone, label] = STATUS[value] ?? ["", value];
    return badge(tone, label);
  };
  const statusLabel = (value) => STATUS[value]?.[1] ?? String(value ?? "");

  // ---------- ไอคอน (SVG เส้นเดียวกันทั้งชุด ใช้ในเมนูข้าง หัวหน้า และกล่องแจ้งเตือน ดีไซน์ทดสอบ data-rf-design ใน styles.css) ----------
  const ICONS = Object.freeze({
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9zM9 11h6M9 15h6M9 19h3"/>',
    recipes: '<path d="M9.5 3h5M11 3v6l-5.3 9.2A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.3-2.3L13 9V3M8.5 15h7"/>',
    requisition: '<path d="M12 4v16M7 20h10M4 8h16M6 8l-2.5 6a2.8 2.8 0 0 0 5 0L6 8M18 8l-2.5 6a2.8 2.8 0 0 0 5 0L18 8"/>',
    mixing: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/>',
    extrusion: '<rect x="3" y="7" width="8" height="10" rx="1.5"/><path d="M11 12h10M17 8l4 4-4 4"/>',
    curing: '<path d="M12 3c1 3 5 5.5 5 10a5 5 0 0 1-10 0c0-2 .8-3.6 2-4.8 0 2 1 3.2 2 3.2 0-3-1-5-1-8.4Z"/>',
    finishing: '<path d="M3 8l9-4 9 4-9 4-9-4ZM3 8v8l9 4 9-4V8M12 12v8"/>',
    wip: '<path d="M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3"/>',
    quality: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
    spc: '<path d="M3 20h18M4 16l5-5 4 3 7-8"/><circle cx="20" cy="6" r="1.5"/>',
    trace: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m21 21-5-5M8 10.5h5M10.5 8v5"/>',
    warehouse: '<path d="M3 20V9l9-5 9 5v11M3 20h18M8 20v-6h8v6M10 14v-3h4v3"/>',
    molds: '<circle cx="7.5" cy="7.5" r="3.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><path d="M4 20l3.5-6 3.5 6zM16.5 13v7M13 16.5h7"/>',
    audit: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    warn: '<path d="M12 4 3 19h18L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
    bad: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
    good: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  });
  const icon = (id) => (ICONS[id] ? `<svg class="rf-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>` : "");

  // ---------- โครงหน้า ----------
  // api.module = หน้าปัจจุบัน (shell ตั้งก่อนวาด) ใช้ใส่ไอคอนของหน้าไว้หน้าชื่อ ดีไซน์แบบเดิมซ่อนไอคอนด้วย CSS
  const pageHead = (title, desc = "", actions = "") => `<header class="rf-pagehead"><div class="rf-pagehead-main">${api.module && ICONS[api.module] ? `<span class="rf-mod-ico" aria-hidden="true">${icon(api.module)}</span>` : ""}<div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ""}</div></div>${actions ? `<div class="rf-row">${actions}</div>` : ""}</header>`;
  // การ์ด: title/actions เป็น HTML ที่ escape แล้ว (ชื่อการ์ดบางอันมีป้าย) body เป็น HTML
  const card = (body, { title = "", actions = "", flush = false, className = "" } = {}) => `<section class="card rf-card${className ? ` ${className}` : ""}">${title || actions ? `<div class="rf-card-head"><h3>${title}</h3><div class="rf-row">${actions}</div></div>` : ""}<div class="rf-card-body${flush ? " is-flush" : ""}">${body}</div></section>`;
  const stat = ({ label, value, sub = "", tone = "" }) => `<div class="card rf-stat${tone ? ` is-${esc(tone)}` : ""}"><span class="rf-stat-label">${esc(label)}</span><strong class="rf-stat-value">${esc(value)}</strong>${sub ? `<span class="rf-stat-sub">${esc(sub)}</span>` : ""}</div>`;
  const stats = (items) => `<div class="rf-grid rf-g4">${items.map(stat).join("")}</div>`;
  const callout = (tone, html) => `<div class="rf-callout is-${esc(tone)}" role="note"><span class="rf-callout-ico" aria-hidden="true">${icon(tone)}</span><div class="rf-callout-body">${html}</div></div>`;
  const empty = (text) => `<div class="empty rf-empty">${esc(text)}</div>`;
  const kv = (pairs) => `<dl class="rf-kv">${pairs.filter(Boolean).map(([key, value]) => `<dt>${esc(key)}</dt><dd>${value}</dd>`).join("")}</dl>`;
  const progress = (value, max, tone = "") => `<div class="rf-bar${tone ? ` is-${esc(tone)}` : ""}" role="img" aria-label="${attr(`${rules.fmtNum(value)} จาก ${rules.fmtNum(max)}`)}"><div style="width:${n2(max ? Math.min(100, (Number(value) / Number(max)) * 100) : 0)}%"></div></div>`;
  const table = (head, rows, { emptyText = "ไม่มีข้อมูล", colSpan = head.length, className = "" } = {}) => `<div class="table-wrap"><table class="rf-table${className ? ` ${className}` : ""}"><thead><tr>${head.map((cell) => (typeof cell === "string" ? `<th>${esc(cell)}</th>` : `<th class="${attr(cell.className ?? "")}">${esc(cell.label ?? "")}</th>`)).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${colSpan}" class="empty rf-empty">${esc(emptyText)}</td></tr>`}</tbody></table></div>`;
  // แท็บเป็นลิงก์ธรรมดา (?tab=) หน้าโหลดใหม่ตาม URL ไม่มี popup
  const tabs = (items, current, urlOf) => `<nav class="rf-tabs" role="tablist">${items.map((tab) => `<a class="rf-tab${tab.id === current ? " is-active" : ""}" role="tab" aria-selected="${tab.id === current}" href="${attr(urlOf(tab.id))}">${esc(tab.label)}</a>`).join("")}</nav>`;
  const mono = (text) => `<span class="rf-mono">${esc(text)}</span>`;

  // ---------- ฟอร์ม ----------
  // ช่องกรอก: ชื่อ name= เป็นคีย์ของ FormData ตอนส่ง hint = ข้อความใต้ช่อง (HTML)
  const field = (label, control, { hint = "", id = "", className = "" } = {}) => `<div class="field rf-field${className ? ` ${className}` : ""}">${label ? `<label${id ? ` for="${attr(id)}"` : ""}>${esc(label)}</label>` : ""}${control}${hint ? `<small class="rf-hint">${hint}</small>` : ""}</div>`;
  const input = (name, { value = "", type = "text", placeholder = "", step = "", min = "", max = "", required = false, id = "", list = "", className = "", extra = "" } = {}) =>
    `<input class="input rf-input${className ? ` ${className}` : ""}" name="${attr(name)}"${id ? ` id="${attr(id)}"` : ""} type="${attr(type)}" value="${attr(value)}"${placeholder ? ` placeholder="${attr(placeholder)}"` : ""}${step ? ` step="${attr(step)}"` : ""}${min !== "" ? ` min="${attr(min)}"` : ""}${max !== "" ? ` max="${attr(max)}"` : ""}${type === "number" ? ' inputmode="decimal"' : ""}${required ? " required" : ""}${list ? ` list="${attr(list)}"` : ""} autocomplete="off"${extra ? ` ${extra}` : ""}>`;
  const textarea = (name, { value = "", placeholder = "", rows = 3 } = {}) => `<textarea class="textarea rf-textarea" name="${attr(name)}" rows="${rows}"${placeholder ? ` placeholder="${attr(placeholder)}"` : ""}>${esc(value)}</textarea>`;
  // options: สตริง หรือ { value, label, disabled }
  const select = (name, options, { value = "", placeholder = null, id = "", className = "", extra = "" } = {}) => {
    const rows = options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));
    return `<select class="select rf-select${className ? ` ${className}` : ""}" name="${attr(name)}"${id ? ` id="${attr(id)}"` : ""}${extra ? ` ${extra}` : ""}>${placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : ""}${rows.map((option) => `<option value="${attr(option.value)}"${String(option.value) === String(value) ? " selected" : ""}${option.disabled ? " disabled" : ""}>${esc(option.label)}</option>`).join("")}</select>`;
  };
  // ช่องตัวเลขที่เปลี่ยนสีตามสเปกขณะพิมพ์ (module-rubberflow.js ผูก input event จาก data-spec)
  const specInput = (name, label, spec, { value = "", step = "any" } = {}) => {
    const limits = rules.specLimits(spec);
    const data = `data-spec data-lsl="${limits.lsl ?? ""}" data-usl="${limits.usl ?? ""}"`;
    return field(`${label} (${spec.unit})`, input(name, { value, type: "number", step, extra: data }), { hint: esc(`มาตรฐาน ${rules.specText(spec)}`) });
  };
  const submitButton = (text, { className = "", disabled = false } = {}) => `<button class="btn rf-btn${className ? ` ${className}` : ""}" type="submit"${disabled ? " disabled" : ""}>${esc(text)}</button>`;
  const button = (text, { action = "", args = {}, className = "secondary", confirmText = "", type = "button", ariaLabel = "" } = {}) =>
    `<button class="btn rf-btn ${className}" type="${type}"${action ? ` data-rf-action="${attr(action)}"` : ""}${Object.keys(args).length ? ` data-rf-args="${attr(JSON.stringify(args))}"` : ""}${confirmText ? ` data-rf-confirm="${attr(confirmText)}"` : ""}${ariaLabel ? ` aria-label="${attr(ariaLabel)}"` : ""}>${esc(text)}</button>`;
  // ปุ่มเปิด dialog (module-rubberflow.js หา data-rf-open แล้วเรียก dialog ตามชื่อ)
  const openButton = (text, dialog, args = {}, { className = "secondary", ariaLabel = "" } = {}) => `<button class="btn rf-btn ${className}" type="button" data-rf-open="${attr(dialog)}"${Object.keys(args).length ? ` data-rf-args="${attr(JSON.stringify(args))}"` : ""}${ariaLabel ? ` aria-label="${attr(ariaLabel)}"` : ""}>${esc(text)}</button>`;
  const link = (text, href, className = "") => `<a${className ? ` class="${attr(className)}"` : ""} href="${attr(href)}">${esc(text)}</a>`;

  // dialog ของเบราว์เซอร์ (showModal): ปิดด้วย Escape/ปุ่มปิด/แตะฉากหลัง ไม่ปิดจาก blur (แตะบน iPhone ได้)
  const dialog = (name, title, body, { footer = "", wide = false } = {}) => `<dialog class="rf-modal${wide ? " is-wide" : ""}" data-rf-dialog="${attr(name)}" aria-label="${attr(title)}"><div class="rf-modal-box"><div class="rf-modal-head"><h3>${esc(title)}</h3><button class="rf-modal-close" type="button" data-rf-close aria-label="ปิด">×</button></div><div class="rf-modal-body">${body}</div>${footer ? `<div class="rf-modal-foot">${footer}</div>` : ""}</div></dialog>`;
  const closeButton = (text = "ยกเลิก") => `<button class="btn rf-btn secondary" type="button" data-rf-close>${esc(text)}</button>`;

  // ---------- บาร์โค้ด Code 39 (A–Z 0–9 - . $ / + % และช่องว่าง) ----------
  const CODE39 = {
    "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
    "8": "wnnwnnwnn", "9": "nnwwnnwnn", A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn",
    G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
    O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn", U: "wwnnnnnnw", V: "nwwnnnnnw",
    W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn",
    "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn",
  };
  // คืน SVG ของบาร์โค้ด (ตัวอักษรที่ Code 39 ไม่รองรับถูกแทนด้วย "-") สูง height px
  function barcode(text, { height = 44, showText = true } = {}) {
    const raw = String(text ?? "").toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, "-");
    const chars = ["*", ...raw.split(""), "*"];
    const narrow = 1;
    const wide = 2.6;
    let x = 0;
    const bars = [];
    chars.forEach((char) => {
      const pattern = CODE39[char] ?? CODE39["-"];
      pattern.split("").forEach((width, index) => {
        const w = width === "w" ? wide : narrow;
        if (index % 2 === 0) bars.push(`<rect x="${n2(x)}" y="0" width="${n2(w)}" height="${height}"/>`);
        x += w;
      });
      x += narrow; // ช่องว่างระหว่างตัวอักษร
    });
    const width = x - narrow;
    const textHeight = showText ? 14 : 0;
    return `<svg class="rf-barcode" viewBox="0 0 ${n2(width)} ${height + textHeight}" width="${n2(width * 1.6)}" height="${height + textHeight}" role="img" aria-label="${attr(`บาร์โค้ด ${raw}`)}" shape-rendering="crispEdges"><g fill="currentColor">${bars.join("")}</g>${showText ? `<text x="${n2(width / 2)}" y="${height + 11}" text-anchor="middle" font-size="10" font-family="ui-monospace, monospace" fill="currentColor">${esc(raw)}</text>` : ""}</svg>`;
  }

  // ---------- กราฟ SVG ----------
  // แกน x เป็นลำดับ (labels) ซ้าย: series หลัก (แท่ง/พื้นที่) ขวา: series รอง (เส้น ค่า null เว้น) ใช้ niceScale จาก rules
  function dualChart({ labels, bars = null, area = null, line = null, leftName = "", rightName = "", rightDomain = null, unitLeft = "", unitRight = "", height = 220 }) {
    const W = 720;
    const box = { left: 46, right: rightName ? 46 : 16, top: 14, bottom: 30, height: height - 44 };
    const plotWidth = W - box.left - box.right;
    const n = labels.length;
    const slot = n ? plotWidth / n : plotWidth;
    const leftValues = [...(bars ?? []), ...(area ?? [])].filter((value) => value !== null && value !== undefined);
    const leftScale = rules.niceScale(Math.min(0, ...leftValues), Math.max(1, ...leftValues), 4);
    const yLeft = (value) => box.top + (1 - (value - leftScale.min) / (leftScale.max - leftScale.min)) * box.height;
    const rightValues = (line ?? []).filter((value) => value !== null && value !== undefined);
    const rightScale = rightDomain ? { min: rightDomain[0], max: rightDomain[1], ticks: [rightDomain[0], (rightDomain[0] + rightDomain[1]) / 2, rightDomain[1]] } : rules.niceScale(Math.min(...rightValues), Math.max(...rightValues), 3);
    const yRight = (value) => box.top + (1 - (value - rightScale.min) / (rightScale.max - rightScale.min)) * box.height;
    const xMid = (index) => box.left + slot * (index + 0.5);
    const grid = leftScale.ticks.map((tick) => `<line class="rf-spc-grid" x1="${box.left}" x2="${n2(W - box.right)}" y1="${n2(yLeft(tick))}" y2="${n2(yLeft(tick))}"/><text class="rf-spc-tick" x="${box.left - 6}" y="${n2(yLeft(tick) + 4)}" text-anchor="end">${esc(rules.fmtNum(tick))}</text>`).join("");
    const rightTicks = rightName && rightValues.length ? rightScale.ticks.map((tick) => `<text class="rf-spc-tick" x="${n2(W - box.right + 6)}" y="${n2(yRight(tick) + 4)}">${esc(rules.fmtNum(tick, 1))}</text>`).join("") : "";
    const barsHtml = bars ? bars.map((value, index) => `<rect class="rf-chart-bar" x="${n2(xMid(index) - slot * 0.3)}" y="${n2(yLeft(value))}" width="${n2(slot * 0.6)}" height="${n2(yLeft(leftScale.min) - yLeft(value))}"><title>${esc(`${labels[index]} · ${rules.fmtNum(value, 2)}${unitLeft ? ` ${unitLeft}` : ""}`)}</title></rect>`).join("") : "";
    const areaPoints = area ? area.map((value, index) => `${n2(xMid(index))},${n2(yLeft(value))}`) : [];
    const areaHtml = area && area.length ? `<path class="rf-chart-area" d="M${n2(xMid(0))},${n2(yLeft(leftScale.min))} L${areaPoints.join(" L")} L${n2(xMid(area.length - 1))},${n2(yLeft(leftScale.min))} Z"/><polyline class="rf-chart-line" points="${areaPoints.join(" ")}"/>${area.map((value, index) => `<circle class="rf-chart-dot" cx="${n2(xMid(index))}" cy="${n2(yLeft(value))}" r="3"><title>${esc(`${labels[index]} · ${leftName} ${rules.fmtNum(value)}${unitLeft ? ` ${unitLeft}` : ""}`)}</title></circle>`).join("")}` : "";
    const lineSegments = [];
    let current = [];
    (line ?? []).forEach((value, index) => {
      if (value === null || value === undefined) return;
      current.push(`${n2(xMid(index))},${n2(yRight(value))}`);
      if (index === (line.length - 1)) lineSegments.push(current);
    });
    if (current.length && !lineSegments.includes(current)) lineSegments.push(current);
    const lineHtml = line ? `${lineSegments.map((points) => `<polyline class="rf-chart-line2" points="${points.join(" ")}"/>`).join("")}${line.map((value, index) => (value === null || value === undefined ? "" : `<circle class="rf-chart-dot2" cx="${n2(xMid(index))}" cy="${n2(yRight(value))}" r="3"><title>${esc(`${labels[index]} · ${rightName} ${rules.fmtNum(value, 1)}${unitRight ? ` ${unitRight}` : ""}`)}</title></circle>`)).join("")}` : "";
    const xLabels = labels.map((label, index) => (n > 12 && index % 2 ? "" : `<text class="rf-spc-tick" x="${n2(xMid(index))}" y="${height - 10}" text-anchor="middle">${esc(label)}</text>`)).join("");
    const legend = [leftName ? `<span class="rf-legend-left">${esc(leftName)}</span>` : "", rightName ? `<span class="rf-legend-right">${esc(rightName)}</span>` : ""].filter(Boolean).join("");
    return `<div class="rf-chart-wrap">${legend ? `<div class="rf-legend">${legend}</div>` : ""}<svg class="rf-spc-chart rf-chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${attr(`${leftName}${rightName ? ` และ ${rightName}` : ""} ${n} ช่วง`)}">${grid}${rightTicks}${barsHtml}${areaHtml}${lineHtml}${xLabels}</svg></div>`;
  }

  // I-chart (points = [{ id, label, v }]) พร้อมเส้น USL/LSL/UCL/LCL/X̄ (สไตล์ .rf-spc-* ใน styles.css)
  function controlChart(points, { lsl, usl, stat: s, unit = "" }) {
    const W = 720;
    const box = { left: 52, right: 74, top: 12, height: 190, bottom: 26 };
    const plotWidth = W - box.left - box.right;
    const values = points.map((point) => point.v);
    const marks = [s?.ucl, s?.lcl, lsl, usl].filter((mark) => mark !== null && mark !== undefined && Number.isFinite(mark));
    const scale = rules.niceScale(Math.min(...values, ...marks), Math.max(...values, ...marks), 5);
    const x = (index) => box.left + (values.length === 1 ? plotWidth / 2 : (index / (values.length - 1)) * plotWidth);
    const y = (value) => box.top + (1 - (value - scale.min) / (scale.max - scale.min)) * box.height;
    const right = box.left + plotWidth;
    const LABEL_GAP = 13;
    const refs = [[usl, `USL ${rules.fmtNum(usl, 2)}`, "spec"], [s?.ucl, `UCL ${rules.fmtNum(s?.ucl, 2)}`, "limit"], [s?.mean, "X̄", "center"], [s?.lcl, `LCL ${rules.fmtNum(s?.lcl, 2)}`, "limit"], [lsl, `LSL ${rules.fmtNum(lsl, 2)}`, "spec"]]
      .filter(([number]) => number !== null && number !== undefined && Number.isFinite(number)).map(([number, name, cls]) => ({ at: y(number), name, cls })).sort((a, b) => a.at - b.at);
    refs.forEach((ref, position) => { ref.labelAt = position ? Math.max(ref.at, refs[position - 1].labelAt + LABEL_GAP) : ref.at; });
    const lines = refs.map((ref) => `<line class="rf-spc-${ref.cls}" x1="${box.left}" x2="${n2(right)}" y1="${n2(ref.at)}" y2="${n2(ref.at)}"/><text class="rf-spc-label rf-spc-${ref.cls}-label" x="${n2(right + 6)}" y="${n2(ref.labelAt + 4)}">${esc(ref.name)}</text>`).join("");
    const grid = scale.ticks.map((tick) => `<line class="rf-spc-grid" x1="${box.left}" x2="${n2(right)}" y1="${n2(y(tick))}" y2="${n2(y(tick))}"/><text class="rf-spc-tick" x="${box.left - 6}" y="${n2(y(tick) + 4)}" text-anchor="end">${esc(rules.fmtNum(tick, 2))}</text>`).join("");
    const polyline = `<polyline class="rf-spc-line" points="${points.map((point, index) => `${n2(x(index))},${n2(y(point.v))}`).join(" ")}"/>`;
    const dots = points.map((point, index) => {
      const oos = (usl !== undefined && point.v > usl) || (lsl !== undefined && point.v < lsl);
      const ooc = !oos && s && (point.v > s.ucl || point.v < s.lcl);
      const zone = oos ? "oos" : ooc ? "ooc" : "ok";
      const cx = n2(x(index));
      const cy = n2(y(point.v));
      const mark = zone === "ok" ? `<circle cx="${cx}" cy="${cy}" r="3.5"/>` : zone === "ooc" ? `<rect x="${n2(x(index) - 4)}" y="${n2(y(point.v) - 4)}" width="8" height="8"/>` : `<rect x="${n2(x(index) - 4.5)}" y="${n2(y(point.v) - 4.5)}" width="9" height="9" transform="rotate(45 ${cx} ${cy})"/>`;
      return `<g class="rf-spc-pt is-${zone}"><title>${esc(`${point.id} · ${point.label} · ${rules.fmtNum(point.v, 3)}${unit ? ` ${unit}` : ""}`)}</title>${mark}</g>`;
    }).join("");
    const height = box.top + box.height + box.bottom;
    const axisY = box.top + box.height + 18;
    return `<div class="rf-spc-scroll"><svg class="rf-spc-chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${attr(`I-chart ${values.length} ค่า`)}">${grid}${lines}${polyline}${dots}<text class="rf-spc-tick" x="${box.left}" y="${axisY}">${esc(points[0]?.label ?? "")}</text><text class="rf-spc-tick" x="${n2(right)}" y="${axisY}" text-anchor="end">${esc(points.at(-1)?.label ?? "")}</text></svg></div>`;
  }

  // ฮิสโตแกรม (bins = [{ bin, count, oos }])
  function histogram(bins, { unit = "" } = {}) {
    const W = 560;
    const box = { left: 36, right: 10, top: 10, bottom: 26, height: 150 };
    const plotWidth = W - box.left - box.right;
    const max = Math.max(1, ...bins.map((bin) => bin.count));
    const scale = rules.niceScale(0, max, 3);
    const y = (value) => box.top + (1 - value / scale.max) * box.height;
    const slot = bins.length ? plotWidth / bins.length : plotWidth;
    const grid = scale.ticks.map((tick) => `<line class="rf-spc-grid" x1="${box.left}" x2="${n2(W - box.right)}" y1="${n2(y(tick))}" y2="${n2(y(tick))}"/><text class="rf-spc-tick" x="${box.left - 6}" y="${n2(y(tick) + 4)}" text-anchor="end">${esc(String(tick))}</text>`).join("");
    const bars = bins.map((bin, index) => `<rect class="rf-spc-bar${bin.oos ? " is-oos" : ""}" x="${n2(box.left + slot * index + slot * 0.1)}" y="${n2(y(bin.count))}" width="${n2(slot * 0.8)}" height="${n2(y(0) - y(bin.count))}"><title>${esc(`${bin.bin}${unit ? ` ${unit}` : ""} · ${bin.count} ค่า`)}</title></rect><text class="rf-spc-tick" x="${n2(box.left + slot * (index + 0.5))}" y="${box.top + box.height + 16}" text-anchor="middle">${esc(String(bin.bin))}</text>`).join("");
    return `<svg class="rf-spc-chart rf-spc-hist" viewBox="0 0 ${W} ${box.top + box.height + box.bottom}" role="img" aria-label="${attr(`ฮิสโตแกรม ${bins.length} ช่วง`)}">${grid}${bars}</svg>`;
  }

  const api = {
    module: "",
    STATUS, ICONS, icon, badge, status, statusLabel, pageHead, card, stat, stats, callout, empty, kv, progress, table, tabs, mono,
    field, input, textarea, select, specInput, submitButton, button, openButton, link, dialog, closeButton,
    barcode, dualChart, controlChart, histogram,
  };
  root.MNP_RUBBERFLOW_UI = api;
})(typeof window !== "undefined" ? window : globalThis);
