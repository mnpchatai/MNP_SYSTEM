"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft, ChevronRight, Download, ExternalLink, FileSpreadsheet,
  FileText, FileType2, ImageOff, Loader2, X,
} from "lucide-react";
import { formatFileSize } from "@/lib/format";
import { renderPdfPage } from "@/lib/pdf-preview";

export type AttachmentItem = {
  id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
};

type AttachmentKind = "image" | "pdf" | "text" | "sheet" | "doc" | "other";

const kindLabels: Record<AttachmentKind, string> = {
  image: "รูปภาพ", pdf: "PDF", text: "ข้อความ", sheet: "Excel", doc: "Word", other: "ไฟล์แนบ",
};

function attachmentUrl(id: string, download = false) {
  return `/api/attachments/${id}${download ? "?download=1" : ""}`;
}

function attachmentKind(file: AttachmentItem): AttachmentKind {
  const type = (file.content_type ?? "").toLowerCase();
  const name = file.file_name.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("text/") || name.endsWith(".txt")) return "text";
  if (type.includes("spreadsheet") || name.endsWith(".xlsx")) return "sheet";
  if (type.includes("wordprocessing") || name.endsWith(".docx")) return "doc";
  return "other";
}

function KindIcon({ kind, size = 22 }: { kind: AttachmentKind; size?: number }) {
  if (kind === "sheet") return <FileSpreadsheet size={size} aria-hidden="true" />;
  if (kind === "doc") return <FileType2 size={size} aria-hidden="true" />;
  return <FileText size={size} aria-hidden="true" />;
}

function PreviewPending() {
  return <span className="attachment-preview-state"><Loader2 className="spin" size={16} aria-hidden="true" /> กำลังสร้างตัวอย่าง…</span>;
}

/** Renders page 1 of a PDF onto a canvas so the tile shows the document itself, not an icon. */
function PdfPreview({ file, width, page = 1, onPageCount }: {
  file: AttachmentItem; width: number; page?: number; onPageCount?: (count: number) => void;
}) {
  // The rendered page is stored with the key it belongs to, so a page or size change reads as
  // "still loading" without having to reset state from inside the effect.
  const renderKey = `${file.id}:${page}:${width}`;
  const [rendered, setRendered] = useState<{ key: string; dataUrl?: string; failed?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    renderPdfPage(attachmentUrl(file.id), page, width)
      .then((result) => {
        if (!active) return;
        setRendered({ key: renderKey, dataUrl: result.dataUrl });
        onPageCount?.(result.pageCount);
      })
      .catch(() => {
        if (active) setRendered({ key: renderKey, failed: true });
      });
    return () => {
      active = false;
    };
  }, [renderKey, file.id, page, width, onPageCount]);

  const current = rendered?.key === renderKey ? rendered : null;
  if (current?.failed) {
    return (
      <span className="attachment-preview-state">
        <ImageOff size={16} aria-hidden="true" /> แสดงตัวอย่างไม่ได้ กดเพื่อเปิดไฟล์
      </span>
    );
  }
  if (!current?.dataUrl) return <PreviewPending />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="attachment-preview-media" src={current.dataUrl} alt={`ตัวอย่างหน้า ${page} ของ ${file.file_name}`} />;
}

// Text previews download the whole file, so oversized notes fall back to an icon on the tile.
const textPreviewLimit = 512 * 1024;

/** Shows the opening lines of a text file so the tile is readable without opening it. */
function TextPreview({ file, full = false }: { file: AttachmentItem; full?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const skipped = !full && (file.size_bytes ?? 0) > textPreviewLimit;

  useEffect(() => {
    if (skipped) return;
    let active = true;
    fetch(attachmentUrl(file.id))
      .then((response) => {
        if (!response.ok) throw new Error("preview failed");
        return response.text();
      })
      .then((content) => {
        if (active) setText(full ? content : content.slice(0, 600));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [file.id, full, skipped]);

  if (skipped) return <span className="attachment-preview-state"><FileText size={26} aria-hidden="true" /> {kindLabels.text}</span>;
  if (failed) return <span className="attachment-preview-state"><ImageOff size={16} aria-hidden="true" /> แสดงตัวอย่างไม่ได้</span>;
  if (text === null) return <PreviewPending />;
  return <pre className="attachment-preview-text">{text || "(ไฟล์ว่าง)"}</pre>;
}

function AttachmentTile({ file, onOpen }: { file: AttachmentItem; onOpen: (file: AttachmentItem) => void }) {
  const kind = attachmentKind(file);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const handlePageCount = useCallback((count: number) => setPageCount(count), []);

  return (
    <figure className="attachment-tile">
      <button
        className="attachment-preview"
        type="button"
        onClick={() => onOpen(file)}
        aria-label={`ดูขนาดใหญ่: ${file.file_name}`}
      >
        {kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="attachment-preview-media" src={attachmentUrl(file.id)} alt={file.file_name} loading="lazy" />
        )}
        {kind === "pdf" && <PdfPreview file={file} width={640} onPageCount={handlePageCount} />}
        {kind === "text" && <TextPreview file={file} />}
        {(kind === "sheet" || kind === "doc" || kind === "other") && (
          <span className="attachment-preview-state"><KindIcon kind={kind} size={26} /> {kindLabels[kind]}</span>
        )}
        <span className="attachment-kind">
          {kindLabels[kind]}
          {kind === "pdf" && pageCount ? ` · ${pageCount} หน้า` : ""}
        </span>
      </button>
      <figcaption className="attachment-caption">
        <span className="attachment-name" title={file.file_name}>{file.file_name}</span>
        <span className="attachment-meta">
          {formatFileSize(file.size_bytes)}
          <a
            className="attachment-download"
            href={attachmentUrl(file.id, true)}
            aria-label={`ดาวน์โหลด ${file.file_name}`}
            download
          >
            <Download size={13} aria-hidden="true" />
          </a>
        </span>
      </figcaption>
    </figure>
  );
}

function Lightbox({ file, onClose }: { file: AttachmentItem; onClose: () => void }) {
  const kind = attachmentKind(file);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const handlePageCount = useCallback((count: number) => setPageCount(count), []);
  const lastPage = pageCount ?? 1;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (kind !== "pdf") return;
      if (event.key === "ArrowRight") setPage((current) => Math.min(current + 1, lastPage));
      if (event.key === "ArrowLeft") setPage((current) => Math.max(current - 1, 1));
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [kind, lastPage, onClose]);

  return (
    <div className="attachment-lightbox" role="dialog" aria-modal="true" aria-label={file.file_name} onClick={onClose}>
      <div className="attachment-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <header className="attachment-lightbox-bar">
          <span className="attachment-lightbox-title" title={file.file_name}>
            <KindIcon kind={kind} size={15} /> {file.file_name}
          </span>
          <span className="attachment-lightbox-actions">
            <a className="btn secondary small" href={attachmentUrl(file.id)} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" /> เปิดแท็บใหม่
            </a>
            <a className="btn secondary small" href={attachmentUrl(file.id, true)} download>
              <Download size={13} aria-hidden="true" /> ดาวน์โหลด
            </a>
            <button className="icon-button" type="button" onClick={onClose} aria-label="ปิด">
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        </header>
        <div className="attachment-lightbox-body">
          {kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="attachment-lightbox-media" src={attachmentUrl(file.id)} alt={file.file_name} />
          )}
          {kind === "pdf" && (
            <div className="attachment-lightbox-page">
              <PdfPreview file={file} width={1600} page={page} onPageCount={handlePageCount} />
            </div>
          )}
          {kind === "text" && <TextPreview file={file} full />}
          {(kind === "sheet" || kind === "doc" || kind === "other") && (
            <div className="attachment-lightbox-fallback">
              <KindIcon kind={kind} size={34} />
              <p>ไฟล์ {kindLabels[kind]} แสดงตัวอย่างในหน้าเว็บไม่ได้ กรุณาดาวน์โหลดเพื่อเปิดดู</p>
              <a className="btn small" href={attachmentUrl(file.id, true)} download>
                <Download size={13} aria-hidden="true" /> ดาวน์โหลดไฟล์
              </a>
            </div>
          )}
        </div>
        {kind === "pdf" && (
          <footer className="attachment-lightbox-nav">
            <button className="btn secondary small" type="button" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1}>
              <ChevronLeft size={14} aria-hidden="true" /> ก่อนหน้า
            </button>
            <span className="muted small">หน้า {page} / {pageCount ?? "…"}</span>
            <button className="btn secondary small" type="button" onClick={() => setPage((current) => Math.min(current + 1, lastPage))} disabled={pageCount !== null && page >= lastPage}>
              ถัดไป <ChevronRight size={14} aria-hidden="true" />
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

export function AttachmentGallery({ attachments }: { attachments: AttachmentItem[] }) {
  const [opened, setOpened] = useState<AttachmentItem | null>(null);
  const handleOpen = useCallback((file: AttachmentItem) => setOpened(file), []);
  const handleClose = useCallback(() => setOpened(null), []);

  if (!attachments.length) return <span className="muted small">ยังไม่มีไฟล์แนบ</span>;

  return (
    <>
      <div className="attachment-grid">
        {attachments.map((file) => <AttachmentTile file={file} onOpen={handleOpen} key={file.id} />)}
      </div>
      {opened && <Lightbox file={opened} onClose={handleClose} />}
    </>
  );
}
