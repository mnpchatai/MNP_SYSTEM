// ตัวเตรียมรูปแนบให้แนบจากโทรศัพท์ได้ทุกรุ่น — Pilot Web และ Next.js ใช้ไฟล์นี้ไฟล์เดียวกัน
//
// ปัญหาเดิม: ฟอร์มรับรูปแค่ JPEG/PNG/WebP และไม่เกิน 10 MB แต่รูปจากโทรศัพท์จริงมักไม่เข้าเกณฑ์
// - iPhone เก็บรูปเป็น HEIC/HEIF (ถ้าเลือกจากแอป Files หรือใช้เบราว์เซอร์อื่นบนคอมพิวเตอร์)
// - เบราว์เซอร์/ตัวเลือกไฟล์บางตัวส่งชนิดไฟล์ว่าง หรือไฟล์ไม่มีนามสกุล (เช่นรูปที่เซฟจาก LINE)
// - กล้องความละเอียดสูงให้ไฟล์เกิน 10 MB ได้ง่าย
//
// วิธีแก้: แปลงในเบราว์เซอร์ตอนผู้ใช้เลือกไฟล์ ให้ได้ JPEG ที่ระบบรับอยู่แล้ว ฝั่ง server และ bucket
// ยังตรวจชนิด/ขนาดเข้มเท่าเดิมทุกอย่าง (ไม่เชื่อสิ่งที่เบราว์เซอร์ส่งมา) จึงไม่ต้องแก้ฐานข้อมูล
//
// หลักการ:
// - ตัดสินชนิดจาก "เนื้อไฟล์" (magic bytes) ก่อน แล้วค่อยดู MIME และนามสกุล ไม่งั้นไฟล์ที่ชนิดว่างจะแปลงไม่ได้
// - JPEG/PNG/WebP ที่ไม่ใหญ่เกิน SAFE_BYTES ส่งต่อตามเดิม (ไม่บีบซ้ำ ภาพหน้าจอจะได้ไม่เบลอ)
// - ภาพชนิดอื่น (HEIC, AVIF, GIF, BMP, TIFF) และภาพที่ใหญ่เกิน แปลงเป็น JPEG ด้านยาวไม่เกิน MAX_EDGE
// - HEIC: ลองให้เบราว์เซอร์ถอดรหัสเองก่อน (Safari ทำได้) ถ้าไม่ได้ค่อยโหลด libheif-js มาถอดรหัสแทน
//   ใช้ build แบบ JavaScript ล้วน (ไม่มี eval/WebAssembly/worker) จึงใช้ได้ภายใต้ CSP เดิมของ index.html โดยไม่ต้องผ่อน
// - ไฟล์ที่ไม่ใช่ภาพ (PDF, DOCX ฯลฯ) ผ่านไปตามเดิม ให้การตรวจชนิดเดิมของแต่ละหน้าจัดการต่อ
//
// SAFE_BYTES ตั้งที่ 4 MB ไม่ใช่ 10 MB เพราะ Next.js บน Vercel รับ body ของ Server Action ได้ราว 4.5 MB
//
// Pilot Web: โหลดไฟล์นี้ก่อน app.js (ดู index.html) แล้ว app.js เรียก bindFileInputs() หนเดียว
// Next.js: คอมโพเนนต์ src/components/attachment-input.tsx เรียก normalizeAttachment() โดยส่งตัวโหลด
// libheif-js ของตัวเองเข้ามา — ไลบรารีนี้คัดลอกไว้ที่ vendor/libheif/ สำหรับ Pilot (ดู README ในโฟลเดอร์นั้น)
(function defineAttachmentImage(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MNP_ATTACHMENT_IMAGE = api;
})(typeof self !== "undefined" ? self : globalThis, function attachmentImageFactory(root) {
  const SAFE_BYTES = 4 * 1024 * 1024;
  const MAX_EDGE = 2560;
  const HEIC_TIMEOUT_MS = 60000; // โหลดไลบรารี/ถอดรหัสบนเครื่องช้าอาจใช้เวลาหลายวินาที ตั้งไว้เผื่อ
  const CANONICAL_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  const CANONICAL_EXTENSIONS = { jpeg: "jpg", png: "png", webp: "webp" };
  const KIND_BY_MIME = {
    "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/pjpeg": "jpeg",
    "image/png": "png", "image/x-png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp", "image/x-ms-bmp": "bmp",
    "image/heic": "heic", "image/heif": "heic", "image/heic-sequence": "heic", "image/heif-sequence": "heic",
    "image/avif": "avif",
    "image/tiff": "tiff",
  };
  const KIND_BY_EXTENSION = {
    jpg: "jpeg", jpeg: "jpeg", jpe: "jpeg", jfif: "jpeg",
    png: "png", webp: "webp", gif: "gif", bmp: "bmp",
    heic: "heic", heif: "heic", hif: "heic", avif: "avif", tif: "tiff", tiff: "tiff",
  };
  const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
  const AVIF_BRANDS = new Set(["avif", "avis"]);
  const MESSAGES = {
    preparing: "กำลังเตรียมรูป กรุณารอสักครู่",
    convertFailed: "แปลงรูปไม่สำเร็จ กรุณาบันทึกหรือถ่ายรูปเป็น JPG แล้วแนบใหม่",
    tooLarge: "รูปมีขนาดใหญ่เกินไป กรุณาลดขนาดรูปแล้วแนบใหม่",
  };

  // ---- ฟังก์ชันล้วน (ไม่แตะเบราว์เซอร์ ทดสอบได้ใน Node: scripts/tests/attachment-image.test.mjs) ----

  function ascii(bytes, start, end) {
    let text = "";
    for (let index = start; index < end && index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
    return text;
  }

  // ดูชนิดภาพจาก magic bytes ของไฟล์ ต้องส่งอย่างน้อย 64 ไบต์แรกมา คืน null ถ้าไม่ใช่ภาพที่รู้จัก
  function sniffImageType(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    if (ascii(bytes, 1, 4) === "PNG" && bytes[0] === 0x89) return "png";
    if (ascii(bytes, 0, 4) === "GIF8") return "gif";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
    if (ascii(bytes, 0, 2) === "BM") return "bmp";
    if ((ascii(bytes, 0, 2) === "II" && bytes[2] === 0x2a && bytes[3] === 0) ||
        (ascii(bytes, 0, 2) === "MM" && bytes[2] === 0 && bytes[3] === 0x2a)) return "tiff";
    if (ascii(bytes, 4, 8) === "ftyp") {
      // กล่อง ftyp: major brand ที่ไบต์ 8-11 ตามด้วย compatible brands ทีละ 4 ไบต์ไปจนจบกล่อง
      // AVIF บางไฟล์ใช้ major brand เป็น mif1 เหมือน HEIC จึงต้องไล่ดู compatible brands ด้วย
      const boxEnd = Math.min(bytes.length, ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
      const brands = [ascii(bytes, 8, 12)];
      for (let offset = 16; offset + 4 <= boxEnd; offset += 4) brands.push(ascii(bytes, offset, offset + 4));
      if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "avif";
      if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "heic";
    }
    return null;
  }

  function extensionOf(name) {
    const match = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ""));
    return match ? match[1].toLowerCase() : "";
  }

  // เนื้อไฟล์ก่อน แล้ว MIME แล้วนามสกุล คืน null = ไม่ใช่ภาพที่รู้จัก (ปล่อยผ่านให้การตรวจเดิมจัดการ)
  function detectImageKind(file, headBytes) {
    const sniffed = headBytes ? sniffImageType(headBytes) : null;
    if (sniffed) return sniffed;
    const mime = String(file?.type ?? "").toLowerCase();
    if (KIND_BY_MIME[mime]) return KIND_BY_MIME[mime];
    return KIND_BY_EXTENSION[extensionOf(file?.name)] ?? null;
  }

  // skip = ไม่ใช่ภาพ, keep = ใช้ไฟล์เดิม, retype = เนื้อไฟล์ถูกแต่ชนิด/นามสกุลผิด, convert = แปลงเป็น JPEG
  function planAction(kind, size, mimeType) {
    if (!kind) return "skip";
    if (!CANONICAL_TYPES[kind]) return "convert";
    if (size > SAFE_BYTES) return "convert";
    return String(mimeType ?? "") === CANONICAL_TYPES[kind] ? "keep" : "retype";
  }

  function fitWithin(width, height, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function baseName(name) {
    const base = String(name ?? "").replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]+$/, "").trim();
    return base || "photo";
  }

  function jpegName(name) {
    return `${baseName(name)}.jpg`;
  }

  // ใช้เมื่อเนื้อไฟล์เป็นภาพถูกชนิดแต่ไม่มีนามสกุลที่ตรงกัน (เช่นรูปที่เซฟจาก LINE ไม่มีนามสกุล)
  function withExtension(name, kind) {
    const wanted = CANONICAL_EXTENSIONS[kind];
    const current = KIND_BY_EXTENSION[extensionOf(name)];
    return current === kind ? String(name) : `${baseName(name)}.${wanted}`;
  }

  // ---- ส่วนที่ต้องใช้เบราว์เซอร์ ----

  const ownScript = typeof document !== "undefined" ? document.currentScript : null;
  let heicDecoderPromise = null;

  // Pilot Web: libheif-js (build JavaScript ล้วน) คัดลอกไว้ที่ vendor/libheif/ เพราะ CSP กำหนดให้สคริปต์ต้อง same-origin
  // ใช้ ?v= ชุดเดียวกับไฟล์นี้เพื่อให้ cache ขาดตามกันทุกครั้งที่เลื่อนรุ่นใน index.html
  // สคริปต์ประกาศตัวแปร libheif เป็นฟังก์ชันสร้างอินสแตนซ์ (ใน Node ต้อง require(...)() เช่นกัน)
  function libheifInstance() {
    const exported = root.libheif;
    return typeof exported === "function" ? exported() : exported;
  }

  function loadVendoredHeicDecoder() {
    if (!heicDecoderPromise) {
      heicDecoderPromise = new Promise((resolve, reject) => {
        if (root.libheif) return resolve(libheifInstance());
        if (!ownScript || !ownScript.src) return reject(new Error("HEIC_DECODER_UNAVAILABLE"));
        const url = new URL("../vendor/libheif/libheif.js", ownScript.src);
        url.search = new URL(ownScript.src).search;
        const script = document.createElement("script");
        script.src = url.href;
        script.onload = () => (root.libheif ? resolve(libheifInstance()) : reject(new Error("HEIC_DECODER_UNAVAILABLE")));
        script.onerror = () => reject(new Error("HEIC_DECODER_UNAVAILABLE"));
        document.head.appendChild(script);
      }).catch((error) => {
        heicDecoderPromise = null; // โหลดไม่สำเร็จ (เช่นเน็ตหลุด) ให้ลองใหม่ได้ในครั้งหน้า
        throw error;
      });
    }
    return heicDecoderPromise;
  }

  // คืน { source, width, height, close } หรือ null ถ้าเบราว์เซอร์ถอดรหัสไฟล์นี้ไม่ได้
  async function decodeImage(blob) {
    if (typeof root.createImageBitmap === "function") {
      try {
        const bitmap = await root.createImageBitmap(blob);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      } catch {
        // ถอดรหัสแบบ bitmap ไม่ได้ ลองผ่าน <img> ต่อ
      }
    }
    if (typeof document === "undefined") return null;
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
  }

  function drawToJpeg(source, width, height, quality) {
    if (typeof document === "undefined") return Promise.resolve(null);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return Promise.resolve(null);
    // JPEG ไม่มีความโปร่งใส ถ้าไม่ลงพื้นขาวก่อน พื้นโปร่งใสของ PNG/GIF จะกลายเป็นสีดำ
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }

  async function encodeWithinLimit(image, options) {
    const maxEdge = options.maxEdge ?? MAX_EDGE;
    const attempts = [[maxEdge, 0.85], [maxEdge, 0.7], [1920, 0.7], [1280, 0.6]];
    for (const [edge, quality] of attempts) {
      const { width, height } = fitWithin(image.width, image.height, edge);
      const blob = await drawToJpeg(image.source, width, height, quality);
      if (blob && blob.size <= SAFE_BYTES) return blob;
    }
    throw new Error(MESSAGES.tooLarge);
  }

  // กันค้าง: ถ้าโหลดไลบรารีหรือถอดรหัสไม่เสร็จในเวลา ให้แจ้งผู้ใช้ ไม่งั้นช่องแนบไฟล์ค้างที่ "กำลังเตรียมรูป"
  // และฟอร์มส่งไม่ได้อีกเลย
  function withTimeout(promise, milliseconds) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("HEIC_TIMEOUT")), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // ถอดรหัส HEIC/HEIF ด้วย libheif แล้ววาดลง canvas — คืนในรูปเดียวกับ decodeImage()
  async function decodeHeic(file, loadDecoder) {
    try {
      const libheif = await withTimeout(loadDecoder(), HEIC_TIMEOUT_MS);
      const images = new libheif.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
      const heif = images && images[0];
      if (!heif) throw new Error("HEIF_EMPTY");
      const width = heif.get_width();
      const height = heif.get_height();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      const pixels = context.createImageData(width, height);
      await withTimeout(new Promise((resolve, reject) => {
        heif.display(pixels, (result) => (result ? resolve() : reject(new Error("HEIF_DISPLAY_FAILED"))));
      }), HEIC_TIMEOUT_MS);
      context.putImageData(pixels, 0, 0);
      return { source: canvas, width, height, close() {} };
    } catch {
      throw new Error(MESSAGES.convertFailed);
    }
  }

  async function convertToJpeg(file, kind, options) {
    let image = await decodeImage(file);
    try {
      // เบราว์เซอร์ส่วนใหญ่ (ยกเว้นตระกูล WebKit/Safari) ถอดรหัส HEIC เองไม่ได้ ใช้ libheif แทน
      if (!image && kind === "heic") image = await decodeHeic(file, options.loadHeicDecoder ?? loadVendoredHeicDecoder);
      if (!image) throw new Error(MESSAGES.convertFailed);
      const blob = await encodeWithinLimit(image, options);
      return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
    } finally {
      if (image) image.close();
    }
  }

  // คืนไฟล์เดิมถ้าไม่ต้องแก้อะไร ไม่งั้นคืนไฟล์ใหม่ที่ระบบรับได้ ถ้าแปลงไม่ได้จะโยน Error ข้อความไทย
  async function normalizeAttachment(file, options = {}) {
    if (!file || typeof file.size !== "number" || file.size === 0) return file;
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const kind = detectImageKind(file, head);
    const action = planAction(kind, file.size, file.type);
    if (action === "skip" || action === "keep") return file;
    if (action === "retype") {
      return new File([file], withExtension(file.name, kind), { type: CANONICAL_TYPES[kind], lastModified: file.lastModified });
    }
    return convertToJpeg(file, kind, options);
  }

  // ---- Pilot Web: ดักทุก <input type="file"> ทั้งหน้าด้วย listener เดียว ----

  function showStatus(input, state, text) {
    let node = input.nextElementSibling;
    if (!node || !node.classList.contains("attachment-status")) {
      if (!text) return;
      node = document.createElement("small");
      node.className = "attachment-status";
      node.setAttribute("role", "status");
      input.insertAdjacentElement("afterend", node);
    }
    node.textContent = text;
    node.classList.toggle("error", state === "error");
    node.hidden = !text;
  }

  function bindFileInputs(options = {}) {
    if (typeof document === "undefined" || root.__mnpAttachmentImageBound) return;
    root.__mnpAttachmentImageBound = true;
    const notify = options.notify ?? (() => {});
    const latest = new WeakMap();
    document.addEventListener("change", async (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file" || input.multiple) return;
      const original = input.files && input.files[0];
      const sequence = (latest.get(input) ?? 0) + 1;
      latest.set(input, sequence);
      if (!original) {
        input.setCustomValidity("");
        showStatus(input, "idle", "");
        return;
      }
      // กันกดส่งฟอร์มระหว่างแปลง: ช่องที่ setCustomValidity ค้างอยู่ทำให้ฟอร์มส่งไม่ได้ (เบราว์เซอร์เตือนเอง)
      input.setCustomValidity(MESSAGES.preparing);
      showStatus(input, "busy", MESSAGES.preparing);
      try {
        const prepared = await normalizeAttachment(original, options);
        if (latest.get(input) !== sequence) return;
        if (prepared === original) {
          showStatus(input, "idle", "");
        } else {
          const transfer = new DataTransfer();
          transfer.items.add(prepared);
          input.files = transfer.files;
          showStatus(input, "done", `เตรียมรูปเป็น JPG แล้ว (${(prepared.size / 1048576).toFixed(1)} MB)`);
        }
      } catch (error) {
        if (latest.get(input) !== sequence) return;
        input.value = "";
        const message = error instanceof Error && error.message ? error.message : MESSAGES.convertFailed;
        showStatus(input, "error", message);
        notify(message, "error");
      } finally {
        if (latest.get(input) === sequence) input.setCustomValidity("");
      }
    }, true);
  }

  return {
    SAFE_BYTES, MAX_EDGE, MESSAGES,
    sniffImageType, detectImageKind, planAction, fitWithin, jpegName, withExtension,
    normalizeAttachment, bindFileInputs,
  };
});
