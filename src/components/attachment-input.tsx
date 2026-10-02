"use client";

import { useRef, useState } from "react";
import { MESSAGES, normalizeAttachment, type HeicDecoder } from "../../modules/attachment-image.js";

// ช่องแนบไฟล์ที่เตรียมรูปจากโทรศัพท์ให้เข้าเกณฑ์ก่อนส่ง (HEIC ของ iPhone, ไฟล์ที่ไม่ระบุชนิด, รูปใหญ่)
// ใช้ตัวเตรียมรูปไฟล์เดียวกับ Pilot Web คือ modules/attachment-image.js — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
// ส่วนการตรวจชนิด/ขนาดไฟล์จริงยังอยู่ที่ server action และ bucket เหมือนเดิม ที่นี่แค่แปลงไฟล์ให้ผ่านการตรวจ

type Status = { kind: "busy" | "done" | "error"; text: string } | null;

// libheif-js โหลดเมื่อมีรูป HEIC ที่เบราว์เซอร์ถอดรหัสเองไม่ได้เท่านั้น (Safari/iOS ถอดรหัสเองได้ จึงไม่โหลด)
// ใช้ build แบบ wasm-bundle (รวม .wasm ไว้ในไฟล์ JS) เพราะ build JavaScript ล้วนที่ Pilot Web ใช้อยู่ require("fs")
// ซึ่ง bundler ของ Next.js หาไม่เจอในฝั่งเบราว์เซอร์ — Next.js ไม่มี CSP ที่ห้าม WebAssembly จึงใช้ wasm ได้
async function loadHeicDecoder(): Promise<HeicDecoder> {
  const loaded = (await import("libheif-js/wasm-bundle")) as { default?: unknown };
  const exported = (loaded.default ?? loaded) as HeicDecoder | (() => HeicDecoder);
  return typeof exported === "function" ? exported() : exported;
}

export function AttachmentInput({
  id,
  name,
  required,
  accept = "image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx",
}: {
  id?: string;
  name: string;
  required?: boolean;
  accept?: string;
}) {
  const [status, setStatus] = useState<Status>(null);
  const latest = useRef(0);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const sequence = ++latest.current;
    if (!file) {
      input.setCustomValidity("");
      setStatus(null);
      return;
    }
    // ช่องที่ setCustomValidity ค้างอยู่ทำให้ฟอร์มส่งไม่ได้ (เบราว์เซอร์เตือนเอง) จึงกันกดส่งระหว่างแปลงได้
    input.setCustomValidity(MESSAGES.preparing);
    setStatus({ kind: "busy", text: MESSAGES.preparing });
    try {
      const prepared = await normalizeAttachment(file, { loadHeicDecoder });
      if (sequence !== latest.current) return;
      if (prepared === file) {
        setStatus(null);
      } else {
        const transfer = new DataTransfer();
        transfer.items.add(prepared);
        input.files = transfer.files;
        setStatus({ kind: "done", text: `เตรียมรูปเป็น JPG แล้ว (${(prepared.size / 1048576).toFixed(1)} MB)` });
      }
    } catch (error) {
      if (sequence !== latest.current) return;
      input.value = "";
      setStatus({ kind: "error", text: error instanceof Error && error.message ? error.message : MESSAGES.convertFailed });
    } finally {
      if (sequence === latest.current) input.setCustomValidity("");
    }
  }

  return (
    <>
      <input className="input" id={id} name={name} type="file" accept={accept} required={required} onChange={handleChange} />
      {status && (
        <small className={`attachment-status${status.kind === "error" ? " error" : ""}`} role="status">
          {status.text}
        </small>
      )}
    </>
  );
}
