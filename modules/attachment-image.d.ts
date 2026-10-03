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
  /** normalizeAttachments เรียกก่อนเริ่มเตรียมแต่ละไฟล์ (นับจาก 1) ให้แสดงความคืบหน้า */
  onProgress?: (done: number, total: number) => void;
};

export const SAFE_BYTES: number;
export const MAX_EDGE: number;
/** ขนาดสูงสุดต่อไฟล์ (20 MB) — ต้องตรงกับ check constraint / bucket ในฐานข้อมูล */
export const MAX_FILE_BYTES: number;
/** จำนวนไฟล์สูงสุดต่อการแนบหนึ่งครั้ง */
export const MAX_BATCH_FILES: number;
/** ขนาดรวมสูงสุดของไฟล์ที่เตรียมแล้วต่อการแนบหนึ่งครั้ง (20 MB) */
export const MAX_BATCH_BYTES: number;
export const MESSAGES: {
  preparing: string;
  convertFailed: string;
  tooLarge: string;
  tooManyFiles: string;
  batchTooLarge: string;
};
/** ข้อความใต้ช่องแนบไฟล์ (จำกัดจำนวน/ขนาด และชนิดไฟล์ที่รับ) */
export const HINT: string;

export function normalizeAttachment(file: File, options?: NormalizeOptions): Promise<File>;
/** เตรียมหลายไฟล์ทีละไฟล์ แล้วตรวจจำนวนและขนาดรวม — โยน Error ข้อความไทยถ้าไฟล์ใดแปลงไม่ได้หรือเกินเพดาน */
export function normalizeAttachments(files: Iterable<File> | ArrayLike<File>, options?: NormalizeOptions): Promise<File[]>;
/** ตรวจจำนวนและขนาดรวมของไฟล์ที่เตรียมแล้ว คืนข้อความ error หรือ null */
export function checkBatch(files: Iterable<{ size: number }> | ArrayLike<{ size: number }>): string | null;
/** ข้อความสรุปใต้ช่องแนบหลายไฟล์ (จำนวน ขนาดรวม และจำนวนไฟล์ที่ระบบปรับให้) */
export function describeBatch(prepared: File[], originals: File[]): string;
export function bindFileInputs(
  options?: NormalizeOptions & {
    notify?: (message: string, type?: string) => void;
    /** เรียกหลังเตรียมไฟล์เสร็จด้วยไฟล์ที่จะส่งจริง ([] เมื่อล้าง/เลือกใหม่/ผิดพลาด) ใช้แสดงตัวอย่างก่อนอัปโหลด */
    onSelection?: (input: HTMLInputElement, files: File[]) => void;
  },
): void;
/** ลบไฟล์ลำดับที่ index ออกจาก input.files (ใช้กับปุ่ม × ในตัวอย่าง) พร้อมปรับข้อความสรุป คืนไฟล์ที่เหลือ */
export function removeSelectedFile(input: HTMLInputElement, index: number): File[];
/** ภาพย่อ (data URL JPEG) ของไฟล์รูปสำหรับแสดงตัวอย่างก่อนอัปโหลด ทำทีละไฟล์ผ่านคิว คืน null ถ้าถอดรหัสไม่ได้ */
export function createThumbnail(file: File, maxEdge?: number): Promise<string | null>;

export function sniffImageType(bytes: Uint8Array): string | null;
export function detectImageKind(file: { name?: string; type?: string }, headBytes?: Uint8Array): string | null;
export function planAction(kind: string | null, size: number, mimeType: string): "skip" | "keep" | "retype" | "convert";
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number };
export function jpegName(name: string): string;
export function withExtension(name: string, kind: string): string;
