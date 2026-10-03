"use client";

import { ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createThumbnail } from "../../modules/attachment-image.js";
import { attachmentKind, KindIcon, kindLabels, PreviewPending } from "@/components/attachment-gallery";
import { formatFileSize } from "@/lib/format";
import { renderPdfFile } from "@/lib/pdf-preview";

// ตัวอย่างไฟล์ที่เลือก "ก่อนอัปโหลด" ใต้ช่องแนบไฟล์ — หน้าตาเดียวกับแกลเลอรีไฟล์แนบ (attachment-gallery.tsx)
// รูป = ภาพย่อ, PDF = หน้าแรก, TXT = ข้อความต้นไฟล์, Word/Excel = ป้ายชนิดไฟล์ อ่านจากไฟล์ในเครื่องโดยตรง ไม่เรียกเครือข่าย
// ฝั่ง Pilot Web ใช้ modules/attachment-preview.js แทน (กติกาเดียวกัน — แก้ที่หนึ่งให้แก้อีกที่)

const thumbnailEdge = 360;
const pdfWidth = 360;
const textReadBytes = 4096;
const textExcerptChars = 600;

type Loaded = { dataUrl?: string; text?: string; pageCount?: number; failed?: boolean };

async function loadPreview(file: File, kind: "image" | "pdf" | "text"): Promise<Loaded> {
  if (kind === "image") {
    const dataUrl = await createThumbnail(file, thumbnailEdge);
    return dataUrl ? { dataUrl } : { failed: true };
  }
  if (kind === "pdf") {
    const page = await renderPdfFile(file, pdfWidth);
    return { dataUrl: page.dataUrl, pageCount: page.pageCount };
  }
  return { text: (await file.slice(0, textReadBytes).text()).slice(0, textExcerptChars) };
}

export type SelectedFile = { id: number; file: File };

function SelectedTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const kind = attachmentKind({ file_name: file.name, content_type: file.type });
  // ผลที่โหลดเสร็จเก็บคู่กับไฟล์ที่เป็นเจ้าของ เปลี่ยนไฟล์แล้วจึงนับเป็น "ยังไม่เสร็จ" โดยไม่ต้องรีเซ็ต state ใน effect
  const [loaded, setLoaded] = useState<{ file: File; result: Loaded } | null>(null);
  const asynchronous = kind === "image" || kind === "pdf" || kind === "text";

  useEffect(() => {
    if (kind !== "image" && kind !== "pdf" && kind !== "text") return;
    let active = true;
    loadPreview(file, kind)
      .then((result) => {
        if (active) setLoaded({ file, result });
      })
      .catch(() => {
        if (active) setLoaded({ file, result: { failed: true } });
      });
    return () => {
      active = false;
    };
  }, [file, kind]);

  const result = loaded?.file === file ? loaded.result : null;
  let body: React.ReactNode;
  if (!asynchronous) {
    body = <span className="attachment-preview-state"><KindIcon kind={kind} size={26} /> {kindLabels[kind]}</span>;
  } else if (!result) {
    body = <PreviewPending />;
  } else if (result.failed) {
    body = <span className="attachment-preview-state"><ImageOff size={16} aria-hidden="true" /> แสดงตัวอย่างไม่ได้</span>;
  } else if (result.dataUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    body = <img className="attachment-preview-media" src={result.dataUrl} alt={kind === "pdf" ? `ตัวอย่างหน้าแรกของ ${file.name}` : file.name} />;
  } else {
    body = <pre className="attachment-preview-text">{result.text || "(ไฟล์ว่าง)"}</pre>;
  }

  return (
    <figure className="attachment-tile">
      <div className="attachment-preview">
        {body}
        <span className="attachment-kind">
          {kindLabels[kind]}
          {result?.pageCount ? ` · ${result.pageCount} หน้า` : ""}
        </span>
        {/* type="button" สำคัญ: ปุ่มอยู่ในฟอร์ม ถ้าไม่กำหนดจะกดแล้วส่งฟอร์ม */}
        <button
          className="attachment-remove"
          type="button"
          onClick={onRemove}
          title="ลบไฟล์นี้"
          aria-label={`ลบ ${file.name} ออกจากรายการแนบ`}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <figcaption className="attachment-caption">
        <span className="attachment-name" title={file.name}>{file.name}</span>
        <span className="attachment-meta">{formatFileSize(file.size)}</span>
      </figcaption>
    </figure>
  );
}

// ใช้ id คงที่เป็น key (ไม่ใช่ลำดับ) เพื่อให้กระเบื้องที่เหลือหลังลบไม่ถูกสร้างใหม่ — ไม่งั้นต้องถอดรหัสรูป/เรนเดอร์ PDF ซ้ำ
export function AttachmentSelectionPreview({ items, onRemove }: { items: SelectedFile[]; onRemove: (id: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="attachment-grid attachment-selection" aria-label="ตัวอย่างไฟล์ที่เลือก">
      {items.map((item) => (
        <SelectedTile file={item.file} key={item.id} onRemove={() => onRemove(item.id)} />
      ))}
    </div>
  );
}
