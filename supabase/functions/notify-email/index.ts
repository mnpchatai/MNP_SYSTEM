import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import nodemailer from "npm:nodemailer@6.9.16";

// เรียกจาก pilot web หลังทำ action ที่มี insert เข้า public.notifications สำเร็จ
// (สร้างคำร้อง/อนุมัติ/มอบหมายช่าง/ตรวจรับ) ส่งมาแค่ request_id — ฟังก์ชันนี้ไปหา "แถวแจ้งเตือน
// ของคำร้องนั้นที่ยังไม่เคยส่งอีเมล" เอง แล้วส่งไปตาม employees.email ของผู้รับที่ RPC เลือกไว้แล้ว
// ไม่คำนวณ "ใครควรได้รับ" ซ้ำที่นี่ เพราะ RPC (security definer, ตรวจสิทธิ์ครบแล้ว) ทำไว้ถูกต้องแล้ว
// ที่ตอน insert แถวลง public.notifications — ดูไมเกรชัน notification_email_dispatch.sql

const allowedOrigins = new Set([
  "https://mnpchatai.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://mnpchatai.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

function bearerToken(request: Request) {
  return (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

type MailTransport = ReturnType<typeof nodemailer.createTransport>;
let cachedTransport: MailTransport | null | undefined;

// สร้าง transporter ครั้งเดียวต่อ instance ของ edge function แล้วใช้ซ้ำ (nodemailer แนะนำแบบนี้
// เพื่อ reuse การเชื่อมต่อ) คืน null ถ้ายังไม่ได้ตั้งค่า secret — ให้ผู้เรียกตัดสินใจว่าจะรายงานยังไง
function getTransport(): MailTransport | null {
  if (cachedTransport !== undefined) return cachedTransport;
  const user = Deno.env.get("GMAIL_SMTP_USER");
  const pass = Deno.env.get("GMAIL_SMTP_APP_PASSWORD");
  if (!user || !pass) {
    cachedTransport = null;
    return cachedTransport;
  }
  cachedTransport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return cachedTransport;
}

type RecipientRow = { email: string | null; is_active: boolean } | { email: string | null; is_active: boolean }[] | null;
type PendingNotification = { id: string; title: string; body: string; recipient: RecipientRow };

function firstRecipient(recipient: RecipientRow) {
  return Array.isArray(recipient) ? recipient[0] ?? null : recipient;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (request.method !== "POST") return response(request, { error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return response(request, { error: "SERVER_MISCONFIGURED" }, 500);

  const token = bearerToken(request);
  if (!token) return response(request, { error: "AUTH_REQUIRED" }, 401);
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData?.user) return response(request, { error: "AUTH_REQUIRED" }, 401);

  let body: { requestId?: string };
  try {
    body = await request.json();
  } catch {
    return response(request, { error: "INVALID_BODY" }, 400);
  }
  const requestId = String(body.requestId ?? "").trim();
  if (!requestId) return response(request, { error: "REQUEST_ID_REQUIRED" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: pending, error: pendingError } = await admin
    .from("notifications")
    .select("id, title, body, recipient:employees!notifications_recipient_id_fkey(email, is_active)")
    .eq("request_id", requestId)
    .is("email_sent_at", null);
  if (pendingError) return response(request, { error: pendingError.message }, 500);

  const rows = (pending ?? []) as PendingNotification[];
  if (!rows.length) return response(request, { ok: true, sent: 0, total: 0 });

  const mailer = getTransport();
  if (!mailer) {
    return response(request, {
      ok: true,
      sent: 0,
      total: rows.length,
      note: "ยังไม่ได้ตั้งค่า GMAIL_SMTP_USER/GMAIL_SMTP_APP_PASSWORD ให้ edge function นี้",
    });
  }

  const from = Deno.env.get("NOTIFY_EMAIL_FROM") || Deno.env.get("GMAIL_SMTP_USER");
  let sent = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const recipient = firstRecipient(row.recipient);
    // ปั๊มเวลาไว้เสมอแม้ส่งไม่สำเร็จ (บัญชีปิดใช้งาน/ไม่มีอีเมล/SMTP ล้ม) — กันไม่ให้วนส่งซ้ำไม่รู้จบ
    // ทุกครั้งที่ผู้ใช้เปิดหน้าเดิม เหมือนที่ notify.ts ฝั่ง Next.js ก็ไม่ retry เองเช่นกัน
    try {
      if (recipient?.is_active && recipient.email) {
        await mailer.sendMail({ from, to: recipient.email, subject: row.title, text: row.body });
        sent++;
      }
    } catch (mailError) {
      errors.push(String(mailError));
    } finally {
      await admin.from("notifications").update({ email_sent_at: new Date().toISOString() }).eq("id", row.id);
    }
  }

  return response(request, { ok: true, sent, total: rows.length, errors: errors.slice(0, 5) });
});
