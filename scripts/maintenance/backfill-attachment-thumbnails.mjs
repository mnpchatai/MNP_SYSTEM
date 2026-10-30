// สร้างภาพย่อย้อนหลังให้ไฟล์แนบที่อัปโหลดก่อนมีภาพย่อ (รูป และหน้าแรกของ PDF)
//
// ภาพย่อเก็บที่ <storage_path>.thumb.jpg ใน bucket เดียวกับไฟล์จริง (ดู THUMBNAIL_SUFFIX ใน modules/attachment-image.js)
// แกลเลอรีของ Pilot และ Next.js ใช้ภาพย่อแทนไฟล์เต็มเมื่อมี จึงลด Storage Egress ของไฟล์เก่าได้
//
// ครอบคลุม: request-attachments (ทุกคำร้อง) และ ncr-attachments (NCR จริง ไม่รวมข้อมูลทดสอบของ sandbox)
// ข้ามไฟล์ที่มีภาพย่ออยู่แล้ว จึงรันซ้ำได้ปลอดภัย ไม่เขียนทับ (upsert: false) ไม่แก้ตารางในฐานข้อมูล
//
// วิธีใช้ (ที่ root ของ repo หลัง npm ci, ต้องมี NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SECRET_KEY ใน .env.local):
//   node --env-file=.env.local scripts/maintenance/backfill-attachment-thumbnails.mjs          (ดูรายการอย่างเดียว)
//   node --env-file=.env.local scripts/maintenance/backfill-attachment-thumbnails.mjs --apply  (สร้างและอัปโหลดจริง)
//
// ย้อนกลับ: ลบไฟล์ *.thumb.jpg ที่สร้างขึ้น แกลเลอรีกลับไปใช้ไฟล์จริงเอง (ไม่มีอะไรอื่นอ้างถึงภาพย่อ)
// ค่าใช้จ่าย: ดาวน์โหลดไฟล์ต้นฉบับที่ยังไม่มีภาพย่อหนึ่งรอบ (นับเป็น Egress ครั้งเดียว)
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { thumbnailPath, THUMBNAIL_SUFFIX, THUMBNAIL_EDGE, MAX_THUMBNAIL_BYTES } = require("../../modules/attachment-image.js");

const JPEG_QUALITY = 80;

// ---- ฟังก์ชันล้วน (ทดสอบใน scripts/tests/backfill-thumbnails.test.mjs) ----

export function thumbnailKind(contentType, fileName = "") {
  const type = String(contentType ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || String(fileName).toLowerCase().endsWith(".pdf")) return "pdf";
  return null;
}

export function folderOf(storagePath) {
  const index = storagePath.lastIndexOf("/");
  return index < 0 ? "" : storagePath.slice(0, index);
}

// รายการที่ต้องทำ: ไฟล์ที่สร้างภาพย่อได้ และยังไม่มี <storage_path>.thumb.jpg ใน existing (Set ของพาธเต็มใน bucket นั้น)
export function planBackfill(attachments, existing) {
  return attachments
    .map((file) => ({ ...file, kind: thumbnailKind(file.content_type, file.file_name) }))
    .filter((file) => file.kind && !file.storage_path.endsWith(THUMBNAIL_SUFFIX) && !existing.has(thumbnailPath(file.storage_path)));
}

// ---- ส่วนที่แตะเครือข่าย/ถอดรหัสไฟล์ ----

async function loadModule(name, reason) {
  try {
    return await import(name);
  } catch {
    throw new Error(`โหลด ${name} ไม่ได้ (${reason}) กรุณารัน npm ci ที่ root ของ repo ก่อน`);
  }
}

async function imageThumbnail(buffer) {
  const sharp = (await loadModule("sharp", "ใช้ย่อรูป มากับ Next.js")).default;
  // rotate() ตาม EXIF ให้ภาพย่อหันทางเดียวกับที่เบราว์เซอร์แสดงไฟล์จริง
  return sharp(buffer)
    .rotate()
    .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

async function pdfThumbnail(buffer) {
  const pdfjs = await loadModule("pdfjs-dist/legacy/build/pdf.mjs", "ใช้อ่าน PDF");
  const { createCanvas } = await loadModule("@napi-rs/canvas", "ใช้วาดหน้า PDF มากับ pdfjs-dist");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(THUMBNAIL_EDGE / unscaled.width, 4) });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    page.cleanup();
    return canvas.encode("jpeg", JPEG_QUALITY);
  } finally {
    await pdf.destroy();
  }
}

export async function makeThumbnail(kind, buffer) {
  const thumbnail = kind === "pdf" ? await pdfThumbnail(buffer) : await imageThumbnail(buffer);
  return thumbnail.length > 0 && thumbnail.length <= MAX_THUMBNAIL_BYTES ? thumbnail : null;
}

async function listExisting(supabase, bucket, folders) {
  const existing = new Set();
  for (const folder of folders) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
    if (error) throw new Error(`อ่านรายชื่อไฟล์ใน ${bucket}/${folder} ไม่ได้: ${error.message}`);
    for (const item of data ?? []) existing.add(folder ? `${folder}/${item.name}` : item.name);
  }
  return existing;
}

async function readAttachments(supabase) {
  const requests = await supabase.from("request_attachments").select("storage_path, content_type, file_name");
  if (requests.error) throw new Error(`อ่าน request_attachments ไม่ได้: ${requests.error.message}`);
  const ncr = await supabase
    .from("ncr_attachments")
    .select("storage_path, content_type, file_name, ncr_reports!inner(is_test)")
    .eq("ncr_reports.is_test", false);
  if (ncr.error) throw new Error(`อ่าน ncr_attachments ไม่ได้: ${ncr.error.message}`);
  return [
    { bucket: "request-attachments", files: requests.data ?? [] },
    { bucket: "ncr-attachments", files: (ncr.data ?? []).map(({ storage_path, content_type, file_name }) => ({ storage_path, content_type, file_name })) },
  ];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("ไม่พบ NEXT_PUBLIC_SUPABASE_URL หรือ SUPABASE_SECRET_KEY (รันด้วย node --env-file=.env.local ...)");
  const { createClient } = await loadModule("@supabase/supabase-js", "ใช้เชื่อม Supabase");
  const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log(`Supabase: ${new URL(url).host} · โหมด: ${apply ? "สร้างและอัปโหลดจริง (--apply)" : "ดูรายการอย่างเดียว"}`);
  const totals = { planned: 0, created: 0, skipped: 0, failed: 0 };
  for (const { bucket, files } of await readAttachments(supabase)) {
    const existing = await listExisting(supabase, bucket, [...new Set(files.map((file) => folderOf(file.storage_path)))]);
    const todo = planBackfill(files, existing);
    totals.planned += todo.length;
    console.log(`\n${bucket}: ไฟล์ทั้งหมด ${files.length} · ต้องสร้างภาพย่อ ${todo.length}`);
    for (const file of todo) {
      const label = `  ${file.kind.padEnd(5)} ${file.storage_path}`;
      if (!apply) {
        console.log(label);
        continue;
      }
      try {
        const download = await supabase.storage.from(bucket).download(file.storage_path);
        if (download.error) throw new Error(download.error.message);
        const thumbnail = await makeThumbnail(file.kind, Buffer.from(await download.data.arrayBuffer()));
        if (!thumbnail) {
          totals.skipped += 1;
          console.log(`${label} → ข้าม (ภาพย่อใหญ่เกิน ${MAX_THUMBNAIL_BYTES / 1024} KB)`);
          continue;
        }
        const upload = await supabase.storage
          .from(bucket)
          .upload(thumbnailPath(file.storage_path), thumbnail, { contentType: "image/jpeg", upsert: false });
        if (upload.error) throw new Error(upload.error.message);
        totals.created += 1;
        console.log(`${label} → ${Math.round(thumbnail.length / 1024)} KB`);
      } catch (error) {
        totals.failed += 1;
        console.log(`${label} → ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  console.log(apply
    ? `\nสรุป: สร้าง ${totals.created} · ข้าม ${totals.skipped} · ไม่สำเร็จ ${totals.failed} (จาก ${totals.planned})`
    : `\nสรุป: ต้องสร้าง ${totals.planned} ไฟล์ · รันอีกครั้งพร้อม --apply เพื่อสร้างจริง`);
  if (totals.failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
