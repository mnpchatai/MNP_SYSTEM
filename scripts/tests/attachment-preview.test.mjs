// ทดสอบฟังก์ชันล้วนของ modules/attachment-preview.js (ตัวอย่างไฟล์ก่อนอัปโหลดของ Pilot Web) รันด้วย `npm run test:unit`
// ส่วนที่ต้องใช้เบราว์เซอร์ (วาดภาพย่อ, pdf.js, DOM) ทดสอบในเบราว์เซอร์จริง — ดู README หัวข้อ "ตัวอย่างไฟล์ก่อนอัปโหลด"
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { kindOf, formatSize, excerpt, KIND_LABELS, MESSAGES } = createRequire(import.meta.url)("../../modules/attachment-preview.js");

const file = (name, type = "") => new File([new Uint8Array(1)], name, { type });

test("kindOf picks the preview style from MIME type, falling back to the extension", () => {
  assert.equal(kindOf(file("a.jpg", "image/jpeg")), "image");
  assert.equal(kindOf(file("a.png", "image/png")), "image");
  assert.equal(kindOf(file("a.pdf", "application/pdf")), "pdf");
  assert.equal(kindOf(file("scan.PDF", "")), "pdf");
  assert.equal(kindOf(file("note.txt", "text/plain")), "text");
  assert.equal(kindOf(file("note.TXT", "")), "text");
  assert.equal(kindOf(file("book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")), "sheet");
  assert.equal(kindOf(file("book.xlsx", "")), "sheet");
  assert.equal(kindOf(file("letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")), "doc");
  assert.equal(kindOf(file("letter.docx", "")), "doc");
  assert.equal(kindOf(file("archive.bin", "application/octet-stream")), "other");
  assert.equal(kindOf(undefined), "other");
});

test("every kind has a Thai label (same wording as the attachment gallery)", () => {
  assert.deepEqual(Object.keys(KIND_LABELS).sort(), ["doc", "image", "other", "pdf", "sheet", "text"]);
  assert.equal(KIND_LABELS.image, "รูปภาพ");
  assert.equal(KIND_LABELS.sheet, "Excel");
});

test("formatSize matches the gallery's file size format", () => {
  assert.equal(formatSize(0), "—");
  assert.equal(formatSize(undefined), "—");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(300 * 1024), "300 KB");
  assert.equal(formatSize(3.2 * 1024 * 1024), "3.2 MB");
  assert.equal(formatSize(20 * 1024 * 1024), "20 MB");
});

test("excerpt keeps the first 600 characters and labels an empty file", () => {
  assert.equal(excerpt("hello"), "hello");
  assert.equal(excerpt("x".repeat(1000)).length, 600);
  assert.equal(excerpt(""), MESSAGES.empty);
  assert.equal(excerpt(undefined), MESSAGES.empty);
});
