// BOM รายแผนก (โหมดทดสอบ) — อ่านไฟล์ .xlsx/.xlsm ในเบราว์เซอร์โดยไม่ใช้ไลบรารี: แตก zip ด้วย DecompressionStream("deflate-raw")
// อ่านรายชื่อชีตจาก xl/workbook.xml แล้วแปลงชีตที่เลือกเป็นแถวข้อความ (ค่าที่ Excel คำนวณเก็บไว้ ไม่รันสูตรหรือมาโคร) ให้ rules.readFlatRows อ่านต่อ
// แตกเฉพาะไฟล์ที่ต้องใช้ทีละไฟล์และหยุดเมื่อเกินเพดาน (กัน zip bomb) · ไม่รองรับ zip64 และไฟล์เข้ารหัส · เทสต์: scripts/tests/bom-xlsx.test.mjs
(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  const MAX_FILE_BYTES = 40 * 1024 * 1024; // Material_*.xlsm จริงราว 20 MB
  const MAX_PART_BYTES = 128 * 1024 * 1024; // XML ของชีตหลังแตก (ชีต DATA ของใบ 25047 ราว 97 MB)

  const fail = (message) => { throw new Error(message); };
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  // ---------- zip ----------
  function zipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail("ไฟล์นี้ไม่ใช่ .xlsx/.xlsm (อ่านโครงสร้าง zip ไม่ได้)");
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    if (offset === 0xffffffff || count === 0xffff) fail("ไฟล์ใหญ่เกินรูปแบบที่อ่านได้ (zip64)");
    const decoder = new TextDecoder();
    const entries = new Map();
    for (let n = 0; n < count; n += 1) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) fail("โครงสร้างไฟล์เสียหาย");
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      entries.set(name, { name, flags, method, compressedSize, size, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return { bytes, view, entries };
  }

  async function readEntry(zip, name, limit = MAX_PART_BYTES) {
    const entry = zip.entries.get(name);
    if (!entry) return null;
    if (entry.flags & 1) fail("ไฟล์ถูกเข้ารหัส (ตั้งรหัสผ่านเปิดไฟล์) อ่านไม่ได้");
    if (entry.size > limit) fail(`ส่วน ${name} ใหญ่ ${mb(entry.size)} เกินที่อ่านได้ในเบราว์เซอร์ (${mb(limit)})`);
    const at = entry.localOffset;
    if (at + 30 > zip.bytes.length || zip.view.getUint32(at, true) !== 0x04034b50) fail("โครงสร้างไฟล์เสียหาย");
    const start = at + 30 + zip.view.getUint16(at + 26, true) + zip.view.getUint16(at + 28, true);
    const raw = zip.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method !== 8) fail(`ส่วน ${name} ใช้การบีบอัดที่ไม่รองรับ`);
    if (typeof DecompressionStream === "undefined") fail("เบราว์เซอร์นี้แตกไฟล์ Excel ไม่ได้ ให้คัดลอกจาก Excel มาวางแทน");
    // นับขนาดระหว่างแตก ไม่เชื่อขนาดที่ไฟล์บอก
    const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); fail(`ส่วน ${name} ใหญ่เกินที่อ่านได้ในเบราว์เซอร์ (${mb(limit)})`); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) { out.set(chunk, position); position += chunk.length; }
    return out;
  }

  async function readText(zip, name, limit) {
    const data = await readEntry(zip, name, limit);
    return data ? new TextDecoder().decode(data) : null;
  }

  // ---------- XML (โครงของ OOXML คงที่ จึงใช้ regex แทน DOMParser ให้ทำงานได้ทั้งเบราว์เซอร์และ node) ----------
  const decodeXml = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (whole, ref) => {
    const key = ref.toLowerCase();
    if (key[0] === "#") {
      const code = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }[key] ?? whole;
  });
  const attrsOf = (tag) => {
    const out = {};
    for (const match of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[match[1]] = decodeXml(match[2]);
    return out;
  };
  // ข้อความใน <si>/<is>: ต่อ <t> ทุก run ตัดคำอ่าน (rPh) ออก
  const runText = (xml) => decodeXml([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));

  function sharedStrings(xml) {
    if (!xml) return [];
    return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((match) => runText(match[1] ?? ""));
  }

  const columnIndex = (ref) => {
    let n = 0;
    for (const ch of ref) { const code = ch.charCodeAt(0); if (code < 65 || code > 90) break; n = n * 26 + code - 64; }
    return n - 1;
  };
  const numberText = (value) => {
    const n = Number(value);
    return value !== "" && Number.isFinite(n) ? String(n) : value; // 0.10100000000000001 → 0.101
  };

  // แถวของชีตเป็น array ของข้อความ (ช่องว่าง = "") ตามตำแหน่งคอลัมน์จริง แถวว่างทั้งแถวถูกข้าม
  function sheetRows(xml, strings) {
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      let next = 0;
      for (const cell of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = attrsOf(cell[1]);
        const index = attrs.r ? columnIndex(attrs.r) : next;
        next = index + 1;
        const body = cell[2] ?? "";
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (attrs.t === "s") value = raw == null ? "" : strings[Number(raw)] ?? "";
        else if (attrs.t === "inlineStr") value = runText(body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? "");
        else if (attrs.t === "e") value = ""; // #N/A #REF! ไม่ใช่ข้อมูล
        else if (attrs.t === "str" || attrs.t === "b") value = raw == null ? "" : decodeXml(raw);
        else value = raw == null ? "" : numberText(decodeXml(raw));
        if (index >= 0 && index < 16384) cells[index] = value.replace(/[\t\r\n]+/g, " ").trim();
      }
      if (cells.some((value) => value)) rows.push(Array.from(cells, (value) => value ?? ""));
    }
    return rows;
  }

  // ---------- workbook ----------
  async function openWorkbook(buffer) {
    if (buffer.byteLength > MAX_FILE_BYTES) fail(`ไฟล์ใหญ่ ${mb(buffer.byteLength)} เกิน ${mb(MAX_FILE_BYTES)}`);
    const zip = zipEntries(buffer);
    const workbook = await readText(zip, "xl/workbook.xml", 8 * 1024 * 1024);
    if (!workbook) fail("ไม่พบ xl/workbook.xml — ไฟล์นี้ไม่ใช่สมุดงาน Excel (.xlsx/.xlsm)");
    const rels = (await readText(zip, "xl/_rels/workbook.xml.rels", 8 * 1024 * 1024)) ?? "";
    const targets = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((match) => attrsOf(match[1])).map((rel) => [rel.Id, rel.Target]));
    const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match) => attrsOf(match[1])).map((sheet) => {
      const target = String(targets.get(sheet["r:id"]) ?? "");
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, "/");
      const entry = zip.entries.get(path);
      return { name: sheet.name ?? "", path, hidden: sheet.state === "hidden" || sheet.state === "veryHidden", size: entry?.size ?? 0 };
    }).filter((sheet) => sheet.name && zip.entries.has(sheet.path));
    let strings = null;
    return {
      sheets,
      // ชีตตั้งต้นสำหรับนำเข้า BOM: BOMSHEET (ใบต่อ PI) แล้ว DATA (master) แล้วชีตแรกที่มองเห็น
      defaultSheet: (sheets.find((sheet) => sheet.name.trim().toUpperCase() === "BOMSHEET") ?? sheets.find((sheet) => sheet.name.trim().toUpperCase() === "DATA") ?? sheets.find((sheet) => !sheet.hidden) ?? sheets[0])?.name ?? "",
      async rows(name) {
        const sheet = sheets.find((entry) => entry.name === name) ?? fail(`ไม่พบชีต ${name}`);
        strings ??= sharedStrings(await readText(zip, "xl/sharedStrings.xml"));
        return sheetRows(await readText(zip, sheet.path), strings);
      },
    };
  }

  const rowsToTsv = (rows) => rows.map((row) => row.join("\t")).join("\n");
  const isWorkbookName = (name) => /\.(xlsx|xlsm)$/i.test(String(name ?? ""));

  const api = { MAX_FILE_BYTES, MAX_PART_BYTES, openWorkbook, rowsToTsv, isWorkbookName, sheetRows, sharedStrings, columnIndex, decodeXml };
  if (isNode) module.exports = api;
  else root.MNP_BOM_XLSX = api;
})(typeof window !== "undefined" ? window : globalThis);
