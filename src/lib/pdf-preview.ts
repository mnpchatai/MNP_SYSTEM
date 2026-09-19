import type { PDFDocumentProxy } from "pdfjs-dist";

// pdf.js only runs in the browser, so the library is imported lazily and never lands in the
// server bundle. Documents are cached per URL so a thumbnail and its enlarged view share one parse.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const documents = new Map<string, Promise<PDFDocumentProxy>>();

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function loadDocument(url: string) {
  const cached = documents.get(url);
  if (cached) return cached;
  const pending = loadPdfjs().then((pdfjs) => pdfjs.getDocument({ url, isEvalSupported: false }).promise);
  documents.set(url, pending);
  pending.catch(() => documents.delete(url));
  return pending;
}

export type PdfPageImage = { dataUrl: string; pageCount: number; width: number; height: number };

export async function renderPdfPage(url: string, pageNumber: number, targetWidth: number): Promise<PdfPageImage> {
  const document_ = await loadDocument(url);
  const safePage = Math.min(Math.max(pageNumber, 1), document_.numPages);
  const page = await document_.getPage(safePage);
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(targetWidth / unscaled.width, 4) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  try {
    await page.render({ canvas, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.9),
      pageCount: document_.numPages,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    page.cleanup();
  }
}
