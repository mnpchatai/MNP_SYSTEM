import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// รับผลทดสอบ Mooney จาก Apps Script ของสเปรดชีต Mooney_Test_Report (apps-script/lab-mooney/Code.gs)
// แล้วส่งต่อให้ฐานข้อมูล (RPC app_lab_mooney_import ซึ่งเรียกได้เฉพาะ service_role)
//
// ความปลอดภัย
//   - ผู้เรียกคือเซิร์ฟเวอร์ของ Google ไม่ใช่เบราว์เซอร์ จึงไม่เปิด CORS และไม่ใช้ JWT ของผู้ใช้
//     (supabase/config.toml ตั้ง verify_jwt = false สำหรับฟังก์ชันนี้) ตัวพิสูจน์ตัวตนคือ secret ใน header
//     x-lab-sync-secret ที่ต้องตรงกับ LAB_SYNC_SECRET (เก็บเป็น Edge Function secret และ Script Property
//     ของ Apps Script เท่านั้น ไม่อยู่ใน repo ไม่อยู่ในโค้ดฝั่งเว็บ)
//   - ไม่ตั้ง LAB_SYNC_SECRET (หรือสั้นกว่า 32 ตัวอักษร) = ปิดรับทั้งหมด (503) ไม่เคยรับแบบไม่มี secret
//   - service role key ใช้เรียก RPC เดียวนี้เท่านั้น ข้อมูลผลทดสอบและ secret ไม่ถูกบันทึกลง log
//   - การตรวจข้อมูลจริงอยู่ที่ฐานข้อมูล (ชนิด ช่วงค่า แถวซ้ำ ด่านกันลบเกินครึ่ง) ฟังก์ชันนี้ตรวจเพียงรูปร่างของคำขอ
//
// คำขอ: POST { "rows": [...], "force": false }  →  200 { ok: true, rows, inserted, updated, deleted }

const MAX_ROWS = 20000;
const MAX_BODY_CHARS = 8_000_000;
const MIN_SECRET_LENGTH = 32;

const knownImportErrors = new Set([
  "LAB_INVALID_PAYLOAD",
  "LAB_INVALID_ROW",
  "LAB_IMPORT_TOO_DESTRUCTIVE",
]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// เทียบ secret แบบเวลาคงที่: เทียบ SHA-256 ของสองฝั่ง (ความยาวเท่ากันเสมอ) ไม่เผยว่าตรงกันกี่ตัวอักษร
async function secretMatches(provided: string, expected: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const secret = Deno.env.get("LAB_SYNC_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (secret.length < MIN_SECRET_LENGTH || !supabaseUrl || !serviceRoleKey) {
    console.error("lab-sheet-sync: not configured (LAB_SYNC_SECRET missing or shorter than 32 characters)");
    return json({ ok: false, error: "NOT_CONFIGURED" }, 503);
  }

  const provided = request.headers.get("x-lab-sync-secret") ?? "";
  if (!(await secretMatches(provided, secret))) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "LAB_INVALID_PAYLOAD" }, 400);
  }
  if (!isRecord(body) || !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_ROWS
    || !body.rows.every(isRecord) || (body.force !== undefined && typeof body.force !== "boolean")) {
    return json({ ok: false, error: "LAB_INVALID_PAYLOAD" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("app_lab_mooney_import", {
    p_rows: body.rows,
    p_force: body.force === true,
  });
  if (error) {
    const code = [...knownImportErrors].find((item) => error.message.includes(item));
    if (code) return json({ ok: false, error: code }, 422);
    // ไม่ส่งข้อความดิบของฐานข้อมูลกลับไป และไม่ log เนื้อหาข้อมูล
    console.error("lab-sheet-sync: import failed", { code: error.code });
    return json({ ok: false, error: "IMPORT_FAILED" }, 500);
  }
  return json({ ok: true, ...(isRecord(data) ? data : {}) });
});
