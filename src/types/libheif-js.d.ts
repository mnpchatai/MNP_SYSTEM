// libheif-js ไม่มีไฟล์ type ให้ entry ที่ใช้ (มีเฉพาะ libheif-wasm/libheif.d.ts ซึ่งต้อง import ตรงจากไฟล์ build)
// เราใช้แค่ส่วนที่ถอดรหัส HEIC ผ่านชนิด HeicDecoder ใน modules/attachment-image.d.ts จึงประกาศโมดูลไว้เปล่าๆ ตรงนี้
declare module "libheif-js/wasm-bundle";
