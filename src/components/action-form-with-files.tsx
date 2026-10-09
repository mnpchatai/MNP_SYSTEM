"use client";

import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AttachmentInput } from "@/components/attachment-input";
import { describeUploadFailures, selectedFiles, uploadAttachments } from "@/lib/attachment-upload";

const FILES_FIELD = "extra_files";

// ปิดทุกปุ่มในฟอร์มระหว่างที่ action + อัปโหลดไฟล์ยังไม่จบ กันกดซ้ำ (ปุ่มพิจารณา/เปลี่ยนสถานะเป็น <button> ธรรมดา ไม่มีสถานะรอเอง)
function PendingFieldset({ className, children }: { className?: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <fieldset className={className} disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {children}
    </fieldset>
  );
}

/**
 * ฟอร์มตอบกลับ/ความเห็น/กรอกข้อมูลในหน้าคำร้องที่แนบไฟล์เพิ่มเติมได้ (ใส่ <ExtraFilesField /> ไว้ในฟอร์ม)
 * ลำดับเหมือนฟอร์มสร้างคำร้อง: ทำ Server Action ก่อน แล้วอัปโหลดไฟล์ทีละไฟล์เข้าคำร้องเดิม
 * (Server Action บน Vercel รับ body ได้ราว 4.5 MB จึงไม่ส่งไฟล์ไปกับฟอร์ม — ดู lib/attachment-upload.ts)
 * ถ้า action ล้มเหลวจะไม่มีไฟล์ถูกอัปโหลด ถ้าไฟล์ใดแนบไม่สำเร็จ การกระทำยังบันทึกอยู่ และพาไปหน้าคำร้องพร้อมข้อความ
 */
export function ActionFormWithFiles({
  action,
  requestId,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  requestId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  async function submit(formData: FormData) {
    const files = selectedFiles(formData, FILES_FIELD);
    formData.delete(FILES_FIELD);
    await action(formData);
    const failures = files.length ? await uploadAttachments(requestId, files) : [];
    if (failures.length) {
      const message = `${describeUploadFailures(files.length, failures)} · บันทึกการดำเนินการแล้ว แนบไฟล์ที่ไม่สำเร็จใหม่ได้ที่ส่วน "ไฟล์แนบ"`;
      router.push(`/requests/${requestId}?error=${encodeURIComponent(message)}`);
    } else if (files.length) {
      router.refresh();
    }
  }

  return (
    <form action={submit}>
      <PendingFieldset className={className}>{children}</PendingFieldset>
    </form>
  );
}

export function ExtraFilesField({ id, label = "แนบไฟล์เพิ่มเติม (ถ้ามี)" }: { id: string; label?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <AttachmentInput id={id} name={FILES_FIELD} multiple />
    </div>
  );
}
