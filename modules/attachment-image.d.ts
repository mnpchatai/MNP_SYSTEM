// ชนิดของ modules/attachment-image.js สำหรับฝั่ง Next.js (ไฟล์จริงเป็น JS ล้วนเพื่อให้ Pilot Web โหลดได้ตรงๆ)

/** ส่วนของ libheif-js ที่ใช้ถอดรหัส HEIC/HEIF */
export type HeicDecoder = {
  HeifDecoder: new () => {
    decode(data: Uint8Array): Array<{
      get_width(): number;
      get_height(): number;
      display(target: ImageData, callback: (result: ImageData | null) => void): void;
    }>;
  };
};

export type NormalizeOptions = {
  /** ตัวโหลด libheif-js — Pilot Web ไม่ต้องส่ง (ใช้ไฟล์ใน vendor/ ให้เอง) Next.js ส่ง dynamic import เข้ามา */
  loadHeicDecoder?: () => Promise<HeicDecoder>;
  /** ด้านยาวสูงสุดของรูปที่แปลง (พิกเซล) ค่าเริ่มต้น 2560 */
  maxEdge?: number;
};

export const SAFE_BYTES: number;
export const MAX_EDGE: number;
export const MESSAGES: { preparing: string; convertFailed: string; tooLarge: string };

export function normalizeAttachment(file: File, options?: NormalizeOptions): Promise<File>;
export function bindFileInputs(options?: NormalizeOptions & { notify?: (message: string, type?: string) => void }): void;

export function sniffImageType(bytes: Uint8Array): string | null;
export function detectImageKind(file: { name?: string; type?: string }, headBytes?: Uint8Array): string | null;
export function planAction(kind: string | null, size: number, mimeType: string): "skip" | "keep" | "retype" | "convert";
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number };
export function jpegName(name: string): string;
export function withExtension(name: string, kind: string): string;
