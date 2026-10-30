// ทดสอบสคริปต์สร้างภาพย่อย้อนหลัง (scripts/maintenance/backfill-attachment-thumbnails.mjs) โดยไม่แตะ Supabase
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { folderOf, makeThumbnail, planBackfill, thumbnailKind } from "../maintenance/backfill-attachment-thumbnails.mjs";

test("thumbnailKind covers images and PDFs only", () => {
  assert.equal(thumbnailKind("image/jpeg"), "image");
  assert.equal(thumbnailKind("image/webp"), "image");
  assert.equal(thumbnailKind("application/pdf"), "pdf");
  assert.equal(thumbnailKind("", "ใบเสนอราคา.PDF"), "pdf");
  assert.equal(thumbnailKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx"), null);
  assert.equal(thumbnailKind("text/plain", "a.txt"), null);
});

test("planBackfill skips files that already have a thumbnail and files that cannot have one", () => {
  const files = [
    { storage_path: "r1/a.jpg", content_type: "image/jpeg", file_name: "a.jpg" },
    { storage_path: "r1/b.pdf", content_type: "application/pdf", file_name: "b.pdf" },
    { storage_path: "r1/c.xlsx", content_type: "application/vnd.ms-excel", file_name: "c.xlsx" },
    { storage_path: "r2/d.png", content_type: "image/png", file_name: "d.png" },
  ];
  const todo = planBackfill(files, new Set(["r1/a.jpg", "r1/a.jpg.thumb.jpg", "r1/b.pdf"]));
  assert.deepEqual(todo.map((file) => [file.storage_path, file.kind]), [["r1/b.pdf", "pdf"], ["r2/d.png", "image"]]);
  assert.equal(folderOf("r1/uuid-a.jpg"), "r1");
  assert.equal(folderOf("a.jpg"), "");
});

test("image thumbnails are JPEG, at most 360px, and follow EXIF orientation", async () => {
  // 800x400 ที่ EXIF บอกให้หมุน 90° → ภาพที่ผู้ใช้เห็นเป็นแนวตั้ง
  const source = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#3366cc" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const thumbnail = await makeThumbnail("image", source);
  const meta = await sharp(thumbnail).metadata();
  assert.equal(meta.format, "jpeg");
  assert.deepEqual([meta.width, meta.height], [180, 360]);
});

test("small images are not enlarged", async () => {
  const source = await sharp({ create: { width: 120, height: 80, channels: 4, background: "#00000000" } }).png().toBuffer();
  const meta = await sharp(await makeThumbnail("image", source)).metadata();
  assert.deepEqual([meta.width, meta.height], [120, 80]);
});

function minimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>",
  ];
  const stream = "0 0 1 rg 50 50 200 200 re f";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

test("PDF thumbnails render page 1 to a 360px-wide JPEG", async () => {
  const meta = await sharp(await makeThumbnail("pdf", minimalPdf())).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 360);
  assert.equal(meta.height, Math.ceil(842 * (360 / 595)));
});
