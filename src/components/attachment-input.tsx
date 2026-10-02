"use client";

import { useEffect, useRef, useState } from "react";
import {
  HINT,
  MESSAGES,
  describeBatch,
  normalizeAttachment,
  normalizeAttachments,
  type HeicDecoder,
} from "../../modules/attachment-image.js";

// ช่องแนบไฟล์ที่เตรียมรูปจากโทรศัพท์ให้เข้าเกณฑ์ก่อนส่ง (HEIC ของ iPhone, ไฟล์ที่ไม่ระบุชนิด, รูปใหญ่)
// ใช้ตัวเตรียมรูปไฟล์เดียวกับ Pilot Web คือ modules/attachment-image.js — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
// ส่วนการตรวจชนิด/ขนาดไฟล์จริงยังอยู่ที่ server action และ bucket เหมือนเดิม ที่นี่แค่แปลงไฟล์ให้ผ่านการตรวจ
// ช่อง multiple เตรียมทุกไฟล์ทีละไฟล์ แล้วตรวจจำนวนและขนาดรวม (ไม่เกิน 20 MB) ก่อนปล่อยให้ส่งฟอร์ม
// ไฟล์ที่เตรียมแล้วเขียนกลับลง input.files ฟอร์มจึงอ่านได้ด้วย FormData เหมือนช่องไฟล์ทั่วไป

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
  multiple = false,
  accept = "image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx",
}: {
  id?: string;
  name: string;
  required?: boolean;
  multiple?: boolean;
  accept?: string;
}) {
  const [status, setStatus] = useState<Status>(null);
  const latest = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ฟอร์มถูกรีเซ็ต (React รีเซ็ตฟอร์มให้เองหลัง action สำเร็จ) ไฟล์ที่เลือกหายไปแล้ว สถานะเดิมต้องหายตาม
  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!input || !form) return;
    const clear = () => {
      latest.current += 1; // ผลของการเตรียมไฟล์ที่ค้างอยู่ถูกทิ้ง
      input.setCustomValidity("");
      setStatus(null);
    };
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const originals = Array.from(input.files ?? []);
    const sequence = ++latest.current;
    if (!originals.length) {
      input.setCustomValidity("");
      setStatus(null);
      return;
    }
    // ช่องที่ setCustomValidity ค้างอยู่ทำให้ฟอร์มส่งไม่ได้ (เบราว์เซอร์เตือนเอง) จึงกันกดส่งระหว่างแปลงได้
    input.setCustomValidity(MESSAGES.preparing);
    setStatus({ kind: "busy", text: MESSAGES.preparing });
    try {
      const prepared = multiple
        ? await normalizeAttachments(originals, {
            loadHeicDecoder,
            onProgress: (done, total) => {
              if (total > 1 && sequence === latest.current) {
                setStatus({ kind: "busy", text: `${MESSAGES.preparing} (${done}/${total})` });
              }
            },
          })
        : [await normalizeAttachment(originals[0], { loadHeicDecoder })];
      if (sequence !== latest.current) return;
      const changed = prepared.some((file, index) => file !== originals[index]);
      if (changed) {
        const transfer = new DataTransfer();
        prepared.forEach((file) => transfer.items.add(file));
        input.files = transfer.files;
      }
      if (multiple) {
        setStatus({ kind: "done", text: describeBatch(prepared, originals) });
      } else if (changed) {
        setStatus({ kind: "done", text: `เตรียมรูปเป็น JPG แล้ว (${(prepared[0].size / 1048576).toFixed(1)} MB)` });
      } else {
        setStatus(null);
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
      <input
        className="input"
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        multiple={multiple}
        ref={inputRef}
        onChange={handleChange}
      />
      {status && (
        <small className={`attachment-status${status.kind === "error" ? " error" : ""}`} role="status">
          {status.text}
        </small>
      )}
      {multiple && <small className="muted">{HINT}</small>}
    </>
  );
}
