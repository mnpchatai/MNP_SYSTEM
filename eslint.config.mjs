import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  // supabase/functions/** รันบน Deno ไม่ใช่ Next.js — ตรวจด้วย `deno check` แยกต่างหาก
  // และ tsconfig.json ก็ exclude ไว้อยู่แล้ว จึงให้ ESLint ชุดของ Next ข้ามไปด้วยให้ตรงกัน
  globalIgnores([".next/**", "node_modules/**", "supabase/functions/**"]),
]);

