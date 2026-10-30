import { uploadAttachmentAction } from "@/app/actions/requests";
import { renderPdfFile } from "@/lib/pdf-preview";
import { createUploadThumbnail, SAFE_BYTES, THUMBNAIL_EDGE } from "../../modules/attachment-image.js";

// ตัวช่วยฝั่ง client สำหรับอัปโหลดไฟล์แนบหลายไฟล์ผ่าน Server Action
// ส่งทีละไฟล์ ไม่รวมในคำขอเดียว เพราะ Server Action บน Vercel รับ body ได้ราว 4.5 MB (ขนาดรวมสูงสุด 20 MB ตรวจที่ช่องแนบไฟล์
// ก่อนส่ง ดู modules/attachment-image.js) ส่วนชนิดและขนาดต่อไฟล์ ตรวจจริงที่ uploadAttachmentAction และ bucket

export type AttachmentUploadFailure = { name: string; error: string };

/** ไฟล์ที่ผู้ใช้เลือกจริงจากช่องแนบไฟล์ (ตัดรายการไฟล์ว่างที่ฟอร์มส่งมาเมื่อไม่ได้เลือกอะไรออก) */
export function selectedFiles(formData: FormData, name: string): File[] {
  return formData.getAll(name).filter((value): value is File => value instanceof File && value.size > 0);
}

/** อัปโหลดทีละไฟล์ ไฟล์ไหนพลาดไม่ทำให้ไฟล์ที่เหลือหยุด คืนรายการไฟล์ที่ไม่สำเร็จ (ว่าง = สำเร็จหมด) */
export async function uploadAttachments(requestId: string, files: File[]): Promise<AttachmentUploadFailure[]> {
  const failures: AttachmentUploadFailure[] = [];
  for (const file of files) {
    const body = new FormData();
    body.set("request_id", requestId);
    body.set("file", file);
    // ภาพย่อสำหรับแกลเลอรี (ไม่มีก็อัปโหลดไฟล์จริงได้ตามปกติ) แนบเฉพาะไฟล์ไม่เกิน SAFE_BYTES (4 MB) เพื่อให้ไฟล์ + ภาพย่อ
    // (≤ 200 KB) ยังอยู่ในขีด body ราว 4.5 MB ของ Server Action ภาพย่อต้องไม่ทำให้ไฟล์ที่เคยส่งได้กลับส่งไม่ได้
    const thumbnail = file.size <= SAFE_BYTES
      ? await createUploadThumbnail(file, { renderPdf: async (pdf) => (await renderPdfFile(pdf, THUMBNAIL_EDGE)).dataUrl })
      : null;
    if (thumbnail) body.set("thumbnail", thumbnail, "thumbnail.jpg");
    try {
      const result = await uploadAttachmentAction(body);
      if (!result.ok) failures.push({ name: file.name, error: result.error });
    } catch {
      // คำสั่งล้มทั้งคำขอ (เช่น ไฟล์ใหญ่เกินที่แพลตฟอร์มรับได้ หรือเน็ตหลุด) ไม่มีข้อความจาก server ให้ใช้
      failures.push({ name: file.name, error: "ส่งไฟล์ไม่สำเร็จ ไฟล์อาจใหญ่เกินที่ระบบรับได้หรือการเชื่อมต่อขัดข้อง" });
    }
  }
  return failures;
}

export function describeUploadFailures(total: number, failures: AttachmentUploadFailure[]): string {
  const detail = failures.map((failure) => `${failure.name} (${failure.error})`).join(", ");
  return `แนบไฟล์ไม่สำเร็จ ${failures.length} จาก ${total} ไฟล์: ${detail}`;
}
