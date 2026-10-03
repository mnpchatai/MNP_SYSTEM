import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // ไฟล์แนบสูงสุด 20 MB ต่อไฟล์ (modules/attachment-image.js MAX_FILE_BYTES) + ส่วนหัวของ multipart
      // หมายเหตุ: บน Vercel body จริงถูกจำกัดที่ราว 4.5 MB ก่อนถึง Next.js (รูปถูกบีบให้ไม่เกิน 4 MB จึงผ่าน)
      bodySizeLimit: "21mb",
    },
  },
};

export default nextConfig;

