// ทดสอบตรรกะล้วนของ modules/attachment-image.js (ตัวเตรียมรูปแนบ) รันด้วย `npm run test:unit`
// ส่วนที่ต้องใช้เบราว์เซอร์ (ถอดรหัส/วาด canvas) ไม่ได้ทดสอบที่นี่ — ดูวิธีทดสอบในเบราว์เซอร์ใน README หัวข้อ "รูปแนบจากโทรศัพท์"
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const attachmentImage = createRequire(import.meta.url)("../../modules/attachment-image.js");
const {
  sniffImageType, detectImageKind, planAction, fitWithin, jpegName, withExtension, SAFE_BYTES,
  checkBatch, describeBatch, normalizeAttachments, MAX_BATCH_FILES, MAX_BATCH_BYTES, MESSAGES, HINT,
} = attachmentImage;

function bytes(...parts) {
  const out = [];
  for (const part of parts) {
    if (typeof part === "string") for (const char of part) out.push(char.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}

// กล่อง ftyp: ขนาด 4 ไบต์ + "ftyp" + major brand + minor version + compatible brands
function ftyp(major, ...compatible) {
  const size = 16 + compatible.length * 4;
  return bytes([0, 0, 0, size], "ftyp", major, [0, 0, 0, 0], ...compatible);
}

test("sniffImageType recognises phone photo formats from file content", () => {
  assert.equal(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe1], "Exif")), "jpeg");
  assert.equal(sniffImageType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])), "png");
  assert.equal(sniffImageType(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")), "webp");
  assert.equal(sniffImageType(bytes("GIF89a")), "gif");
  assert.equal(sniffImageType(bytes("BM", [0, 0, 0, 0])), "bmp");
  assert.equal(sniffImageType(bytes("II", [0x2a, 0])), "tiff");
  assert.equal(sniffImageType(bytes("MM", [0, 0x2a])), "tiff");
});

test("sniffImageType tells HEIC and AVIF apart, including the shared mif1 brand", () => {
  assert.equal(sniffImageType(ftyp("heic", "mif1", "heic")), "heic"); // iPhone
  assert.equal(sniffImageType(ftyp("heix", "mif1")), "heic");
  assert.equal(sniffImageType(ftyp("mif1", "heic")), "heic");
  assert.equal(sniffImageType(ftyp("avif", "mif1", "miaf")), "avif");
  assert.equal(sniffImageType(ftyp("mif1", "miaf", "avif")), "avif"); // major brand mif1 แต่เป็น AVIF
  assert.equal(sniffImageType(ftyp("isom", "mp41")), null); // วิดีโอ MP4 ไม่ใช่ภาพ
});

test("sniffImageType returns null for non-images and tiny input", () => {
  assert.equal(sniffImageType(bytes("%PDF-1.4")), null);
  assert.equal(sniffImageType(bytes("PK", [3, 4])), null); // DOCX/XLSX เป็น zip
  assert.equal(sniffImageType(new Uint8Array(0)), null);
  assert.equal(sniffImageType(bytes([0xff])), null);
});

test("detectImageKind trusts content over a wrong MIME type or extension", () => {
  const jpegBytes = bytes([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(detectImageKind({ name: "image", type: "" }, jpegBytes), "jpeg"); // รูปที่เซฟจาก LINE
  assert.equal(detectImageKind({ name: "photo.png", type: "image/png" }, jpegBytes), "jpeg");
  assert.equal(detectImageKind({ name: "IMG_1.HEIC", type: "" }, ftyp("heic", "mif1")), "heic");
});

test("detectImageKind falls back to MIME type then extension when content is unreadable", () => {
  const unknown = bytes("????????");
  assert.equal(detectImageKind({ name: "x", type: "image/heif" }, unknown), "heic");
  assert.equal(detectImageKind({ name: "x", type: "image/jpg" }, unknown), "jpeg");
  assert.equal(detectImageKind({ name: "IMG_1.HEIC", type: "" }, unknown), "heic");
  assert.equal(detectImageKind({ name: "a.JPEG", type: "application/octet-stream" }, unknown), "jpeg");
  assert.equal(detectImageKind({ name: "report.pdf", type: "application/pdf" }, bytes("%PDF")), null);
  assert.equal(detectImageKind({ name: "noext", type: "" }, unknown), null);
});

test("planAction keeps small supported images and converts everything else", () => {
  assert.equal(planAction(null, 1000, "application/pdf"), "skip");
  assert.equal(planAction("jpeg", 1000, "image/jpeg"), "keep");
  assert.equal(planAction("png", 1000, "image/png"), "keep");
  assert.equal(planAction("webp", 1000, "image/webp"), "keep");
  assert.equal(planAction("jpeg", 1000, ""), "retype");
  assert.equal(planAction("png", 1000, "image/x-png"), "retype");
  assert.equal(planAction("jpeg", SAFE_BYTES, "image/jpeg"), "keep");
  assert.equal(planAction("jpeg", SAFE_BYTES + 1, "image/jpeg"), "convert");
  assert.equal(planAction("png", SAFE_BYTES + 1, "image/png"), "convert");
  for (const kind of ["heic", "avif", "gif", "bmp", "tiff"]) assert.equal(planAction(kind, 1000, `image/${kind}`), "convert");
});

test("fitWithin shrinks the long edge, keeps the ratio and never upscales", () => {
  assert.deepEqual(fitWithin(6000, 4000, 2560), { width: 2560, height: 1707 });
  assert.deepEqual(fitWithin(3000, 4000, 2560), { width: 1920, height: 2560 });
  assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 2560), { width: 2560, height: 1 });
});

test("jpegName and withExtension keep the base name and fix the extension", () => {
  assert.equal(jpegName("IMG_0001.HEIC"), "IMG_0001.jpg");
  assert.equal(jpegName("รูปหน้างาน.heic"), "รูปหน้างาน.jpg");
  assert.equal(jpegName("image"), "image.jpg");
  assert.equal(jpegName(""), "photo.jpg");
  assert.equal(jpegName("C:\\fakepath\\a.b.png"), "a.b.jpg");
  assert.equal(withExtension("image", "jpeg"), "image.jpg");
  assert.equal(withExtension("photo.JPEG", "jpeg"), "photo.JPEG");
  assert.equal(withExtension("photo.dat", "png"), "photo.png");
});

// ---- แนบหลายไฟล์พร้อมกัน (ขนาดรวมไม่เกิน 20 MB) ----
// ใช้ไฟล์ PDF จำลองเพราะไม่ใช่ภาพ จึงผ่านตัวเตรียมรูปโดยไม่ต้องใช้เบราว์เซอร์ (ไฟล์ภาพที่ต้องแปลงต้องทดสอบในเบราว์เซอร์)

const pdfFile = (name, size) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
const MB = 1024 * 1024;

test("the combined limit is 20 MB and the hint tells users about it", () => {
  assert.equal(MAX_BATCH_BYTES, 20 * MB);
  assert.match(HINT, /20 MB/);
  assert.match(MESSAGES.batchTooLarge, /20 MB/);
});

test("checkBatch accepts a total up to exactly 20 MB and rejects anything above", () => {
  assert.equal(checkBatch([]), null);
  assert.equal(checkBatch([{ size: 10 * MB }, { size: 10 * MB }]), null);
  assert.equal(checkBatch([{ size: 10 * MB }, { size: 10 * MB + 1 }]), MESSAGES.batchTooLarge);
  assert.equal(checkBatch(undefined), null);
});

test("checkBatch limits the number of files", () => {
  const files = (count) => Array.from({ length: count }, () => ({ size: 1 }));
  assert.equal(checkBatch(files(MAX_BATCH_FILES)), null);
  assert.equal(checkBatch(files(MAX_BATCH_FILES + 1)), MESSAGES.tooManyFiles);
});

test("normalizeAttachments keeps order and returns untouched files as the same objects", async () => {
  const files = [pdfFile("a.pdf", 5 * MB), pdfFile("b.pdf", 5 * MB), pdfFile("c.pdf", 5 * MB)];
  const progress = [];
  const prepared = await normalizeAttachments(files, { onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(prepared.length, 3);
  prepared.forEach((file, index) => assert.equal(file, files[index]));
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
});

test("normalizeAttachments rejects a combined size over 20 MB", async () => {
  const files = [pdfFile("a.pdf", 8 * MB), pdfFile("b.pdf", 8 * MB), pdfFile("c.pdf", 8 * MB)];
  await assert.rejects(normalizeAttachments(files), { message: MESSAGES.batchTooLarge });
});

test("normalizeAttachments rejects too many files before preparing any of them", async () => {
  const files = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, index) => pdfFile(`f${index}.pdf`, 10));
  let started = 0;
  await assert.rejects(normalizeAttachments(files, { onProgress: () => { started += 1; } }), { message: MESSAGES.tooManyFiles });
  assert.equal(started, 0);
});

test("normalizeAttachments names the file that cannot be prepared and returns nothing partial", async () => {
  // HEIC ที่ไม่มีตัวถอดรหัส (ใน Node ไม่มี canvas/libheif) แปลงไม่ได้ — ต้องบอกชื่อไฟล์ ไม่ใช่แค่ข้อความรวม
  const heic = new File([Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63])], "IMG_0002.HEIC", { type: "" });
  const files = [pdfFile("a.pdf", 10), heic];
  await assert.rejects(
    normalizeAttachments(files, { loadHeicDecoder: () => Promise.reject(new Error("no decoder")) }),
    { message: `IMG_0002.HEIC: ${MESSAGES.convertFailed}` },
  );
});

test("normalizeAttachments does not prefix the file name when only one file is given", async () => {
  const heic = new File([Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63])], "IMG_0002.HEIC", { type: "" });
  await assert.rejects(
    normalizeAttachments([heic], { loadHeicDecoder: () => Promise.reject(new Error("no decoder")) }),
    { message: MESSAGES.convertFailed },
  );
});

test("describeBatch summarises count, total size against the limit and adjusted files", () => {
  const a = pdfFile("a.pdf", 3 * MB);
  const b = pdfFile("b.pdf", 5 * MB);
  assert.equal(describeBatch([a, b], [a, b]), "เลือก 2 ไฟล์ · รวม 8.0 จาก 20 MB");
  const converted = new File([new Uint8Array(1 * MB)], "b.jpg", { type: "image/jpeg" });
  assert.equal(describeBatch([a, converted], [a, b]), "เลือก 2 ไฟล์ · รวม 4.0 จาก 20 MB · เตรียมรูปให้ระบบรับได้แล้ว 1 ไฟล์");
});
