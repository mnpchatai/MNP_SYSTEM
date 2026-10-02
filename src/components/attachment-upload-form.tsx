"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AttachmentInput } from "@/components/attachment-input";
import { SubmitButton } from "@/components/submit-button";
import { describeUploadFailures, selectedFiles, uploadAttachments } from "@/lib/attachment-upload";

// ฟอร์มแนบไฟล์เพิ่มในหน้าคำร้อง: เลือกได้หลายไฟล์ แล้วอัปโหลดทีละไฟล์ผ่าน uploadAttachmentAction (ดูเหตุผลใน lib/attachment-upload.ts)
export function AttachmentUploadForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function submit(formData: FormData) {
    const files = selectedFiles(formData, "file");
    if (!files.length) {
      setMessage({ kind: "error", text: "กรุณาเลือกไฟล์" });
      return;
    }
    const failures = await uploadAttachments(requestId, files);
    setMessage(failures.length
      ? { kind: "error", text: describeUploadFailures(files.length, failures) }
      : { kind: "success", text: `อัปโหลดไฟล์แล้ว ${files.length} ไฟล์` });
    // โหลดรายการไฟล์แนบใหม่ให้เห็นไฟล์ที่อัปโหลดสำเร็จ (แม้บางไฟล์พลาด)
    router.refresh();
  }

  return (
    <form action={submit} className="stack">
      <AttachmentInput name="file" multiple required />
      <SubmitButton className="btn secondary small" pendingLabel="กำลังอัปโหลด...">อัปโหลดไฟล์</SubmitButton>
      {message && (
        <div className={`form-message ${message.kind}`} role="status">{message.text}</div>
      )}
    </form>
  );
}
