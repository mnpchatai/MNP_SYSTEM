// ตัวอย่างไฟล์แนบ "ก่อนอัปโหลด" ของ Pilot Web — แสดงใต้ช่องเลือกไฟล์หลังเตรียมไฟล์เสร็จ (ดู onSelection ใน modules/attachment-image.js)
//
// หน้าตาใช้คลาสเดียวกับแกลเลอรีไฟล์แนบในหน้ารายละเอียด (.attachment-grid / .attachment-tile ใน styles.css):
// รูป = ภาพย่อ, PDF = หน้าแรก (pdf.js ใน vendor/), TXT = ข้อความต้นไฟล์, Word/Excel = ป้ายชนิดไฟล์
// อ่านจากไฟล์ในเครื่องโดยตรง ไม่ผ่านเครือข่าย จึงไม่ต้องแก้ CSP (img-src มี data: อยู่แล้ว)
//
// แต่ละช่องทำทีละไฟล์ตามลำดับ (PDF ไม่เปิด worker พร้อมกันหลายตัว รูปไม่ถอดรหัสพร้อมกันจนหน่วยความจำหมด)
// เลือกไฟล์ใหม่ระหว่างที่ยังสร้างไม่เสร็จ งานชุดเก่าจะถูกทิ้ง
//
// ส่วนที่เป็นฟังก์ชันล้วน (kindOf, formatSize, excerpt) ทดสอบใน Node ได้: scripts/tests/attachment-preview.test.mjs
// ฝั่ง Next.js ใช้คอมโพเนนต์ src/components/attachment-selection-preview.tsx แทน (หน้าตา/กติกาเดียวกัน — แก้ที่หนึ่งให้แก้อีกที่)
(function defineAttachmentPreview(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MNP_ATTACHMENT_PREVIEW = api;
})(typeof self !== "undefined" ? self : globalThis, function attachmentPreviewFactory(root) {
  const THUMBNAIL_EDGE = 360;
  const PDF_WIDTH = 360;
  const TEXT_READ_BYTES = 4096;
  const TEXT_EXCERPT_CHARS = 600;
  const KIND_LABELS = { image: "รูปภาพ", pdf: "PDF", text: "ข้อความ", sheet: "Excel", doc: "Word", other: "ไฟล์แนบ" };
  const MESSAGES = { pending: "กำลังสร้างตัวอย่าง…", failed: "แสดงตัวอย่างไม่ได้", empty: "(ไฟล์ว่าง)" };

  // ---- ฟังก์ชันล้วน ----

  // ชนิดไฟล์สำหรับเลือกวิธีแสดงตัวอย่าง (เกณฑ์เดียวกับ attachmentKind ของแกลเลอรีใน app.js แต่รับ File)
  function kindOf(file) {
    const type = String(file?.type ?? "").toLowerCase();
    const name = String(file?.name ?? "").toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if (type.startsWith("text/") || name.endsWith(".txt")) return "text";
    if (type.includes("spreadsheet") || name.endsWith(".xlsx")) return "sheet";
    if (type.includes("wordprocessing") || name.endsWith(".docx")) return "doc";
    return "other";
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex += 1; }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
  }

  function excerpt(text) {
    return String(text ?? "").slice(0, TEXT_EXCERPT_CHARS) || MESSAGES.empty;
  }

  // ---- ส่วนที่ต้องใช้เบราว์เซอร์ ----

  const states = new WeakMap(); // input -> { container, token }

  function element(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function buildTile(file) {
    const kind = kindOf(file);
    const tile = element("figure", "attachment-tile");
    const preview = element("div", "attachment-preview");
    const state = element("span", "attachment-preview-state");
    const asynchronous = kind === "image" || kind === "pdf" || kind === "text";
    state.textContent = asynchronous ? MESSAGES.pending : KIND_LABELS[kind];
    const badge = element("span", "attachment-kind");
    badge.textContent = KIND_LABELS[kind];
    preview.append(state, badge);
    const caption = element("figcaption", "attachment-caption");
    const name = element("span", "attachment-name");
    name.textContent = file.name;
    name.title = file.name;
    const meta = element("span", "attachment-meta");
    meta.textContent = formatSize(file.size);
    caption.append(name, meta);
    tile.append(preview, caption);
    return { file, kind, tile, preview, state, badge };
  }

  function show(entry, node, badgeSuffix = "") {
    entry.state.remove();
    entry.preview.prepend(node);
    if (badgeSuffix) entry.badge.textContent += badgeSuffix;
  }

  function imageNode(src, alt) {
    const image = new Image();
    image.className = "attachment-preview-media";
    image.alt = alt;
    image.src = src;
    return image;
  }

  // หน้าแรกของ PDF จากไฟล์ในเครื่อง (ส่งเป็น data ไม่ใช่ URL — CSP ของ Pilot ไม่อนุญาตให้ pdf.js ดึง blob: ผ่าน connect-src)
  async function renderPdfFirstPage(file, loadPdfjs) {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    try {
      const page = await pdf.getPage(1);
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(PDF_WIDTH / unscaled.width, 4) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      try {
        await page.render({ canvas, viewport }).promise;
        return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), pageCount: pdf.numPages };
      } finally {
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
  }

  async function fill(entry, options) {
    const { file, kind } = entry;
    if (kind === "image") {
      const src = await root.MNP_ATTACHMENT_IMAGE?.createThumbnail(file, THUMBNAIL_EDGE);
      if (!src) throw new Error("THUMBNAIL_FAILED");
      show(entry, imageNode(src, file.name));
    } else if (kind === "pdf") {
      if (!options.loadPdfjs) {
        entry.state.textContent = KIND_LABELS.pdf;
        return;
      }
      const rendered = await renderPdfFirstPage(file, options.loadPdfjs);
      show(entry, imageNode(rendered.dataUrl, `ตัวอย่างหน้าแรกของ ${file.name}`), ` · ${rendered.pageCount} หน้า`);
    } else if (kind === "text") {
      const block = element("pre", "attachment-preview-text");
      block.textContent = excerpt(await file.slice(0, TEXT_READ_BYTES).text());
      show(entry, block);
    }
  }

  // กระเบื้องอยู่ท้ายกล่องของช่อง (ช่องใบเสร็จอะไหล่อยู่ในแถวที่มีปุ่ม จึงวางต่อท้ายกล่องที่ครอบแถวนั้น ไม่แทรกในแถว)
  function hostOf(input) {
    const row = input.closest(".parts-attachment-row");
    return row ? row.parentElement : input.parentElement;
  }

  // แสดงตัวอย่างของ files ใต้ input (files ว่าง = ล้าง) options.loadPdfjs: ฟังก์ชันโหลด pdf.js ของ app.js
  async function renderSelection(input, files, options = {}) {
    if (typeof document === "undefined" || !input) return;
    const previous = states.get(input);
    const token = (previous?.token ?? 0) + 1;
    let container = previous?.container ?? null;
    if (!files.length) {
      if (container) container.remove();
      states.set(input, { container: null, token });
      return;
    }
    if (!container || !container.isConnected) {
      const host = hostOf(input);
      if (!host) return; // ช่องถูกถอดออกจากหน้าไปแล้ว (หน้าโหลดใหม่ระหว่างเลือกไฟล์)
      container = element("div", "attachment-grid attachment-selection");
      container.setAttribute("aria-label", "ตัวอย่างไฟล์ที่เลือก");
      host.append(container);
    }
    container.replaceChildren();
    states.set(input, { container, token });
    const entries = files.map(buildTile);
    entries.forEach((entry) => container.append(entry.tile));
    for (const entry of entries) {
      if (states.get(input)?.token !== token) return; // เลือกใหม่แล้ว ทิ้งงานชุดเก่า
      try {
        await fill(entry, options);
      } catch {
        entry.state.textContent = MESSAGES.failed;
      }
    }
  }

  return { KIND_LABELS, MESSAGES, kindOf, formatSize, excerpt, renderSelection };
});
