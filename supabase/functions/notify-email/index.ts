import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import nodemailer from "npm:nodemailer@6.9.16";

// ตัวส่งอีเมลแจ้งเตือนของ pilot web — ทำงานเป็น "คิว" ไม่ใช่ "ส่งตามคำสั่งของหน้าจอ"
//
// แถวใน public.notifications ถูก insert โดย RPC (security definer ตรวจสิทธิ์และเลือกผู้รับไว้แล้ว)
// ฟังก์ชันนี้จึงไม่คำนวณ "ใครควรได้รับ" ซ้ำ แค่ไล่ส่งแถวที่ email_status = 'pending'
//
// เรียกได้ 2 แบบ
//   POST {}                      → ไล่ส่งทุกแถวที่ยังค้างในคิว (ใช้ตอนเปิดแอป/หลัง action ที่ไม่มี request_id
//                                  เช่น คำร้องเปิดบัญชี ซึ่ง notifications.request_id เป็น NULL)
//   POST { requestId }           → จำกัดเฉพาะแถวของคำร้องนั้น (เส้นทางเดิม ใช้ทันทีหลัง action สำเร็จ)
//   POST { action: "status" }    → บอกว่าตั้งค่าช่องทางส่งไว้หรือยัง + มีกี่แถวค้างคิว (ให้ Admin เห็นในหน้าเว็บ)
//
// สิทธิ์: ผู้ใช้ที่ล็อกอินแล้ว (ตรวจ JWT) หรือฝั่งเซิร์ฟเวอร์ที่ถือ service role key (pilot-auth เรียกมา
// ตอนมีคำร้องเปิดบัญชีใหม่ ซึ่งผู้ยื่นยังไม่มีบัญชีให้ล็อกอิน) ไม่มีการคืนเนื้อหาแจ้งเตือนหรืออีเมลผู้รับ
// กลับไปให้ผู้เรียก — คืนแค่ตัวเลขสรุป จึงไม่มีข้อมูลของคนอื่นรั่วออกไป

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 50;

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

/* ---------- ช่องทางส่ง ---------- */

// เลือกช่องทางจาก secret ที่ตั้งไว้ — มี RESEND_API_KEY ก็ใช้ Resend ก่อน (ไม่ต้องพึ่ง admin อีเมล
// ของบริษัท) ไม่มีค่อย fallback ไป Gmail SMTP ไม่ตั้งอะไรเลย = ไม่มีช่องทาง ไม่แตะคิว
type MailTransport = ReturnType<typeof nodemailer.createTransport>;
let cachedTransport: MailTransport | null | undefined;

function getGmailTransport(): MailTransport | null {
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

function transportName(): "resend" | "gmail_smtp" | null {
  if (Deno.env.get("RESEND_API_KEY")) return "resend";
  if (getGmailTransport()) return "gmail_smtp";
  return null;
}

async function sendViaResend(to: string, subject: string, text: string) {
  const from = Deno.env.get("NOTIFY_EMAIL_FROM") || "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendOne(to: string, subject: string, text: string) {
  if (transportName() === "resend") return sendViaResend(to, subject, text);
  const mailer = getGmailTransport();
  if (!mailer) throw new Error("NOT_CONFIGURED");
  const from = Deno.env.get("NOTIFY_EMAIL_FROM") || Deno.env.get("GMAIL_SMTP_USER");
  await mailer.sendMail({ from, to, subject, text });
}

/* ---------- ความถูกต้องของอีเมลปลายทาง ---------- */

// โดเมนสมมติที่ใช้ตอนทดสอบ (เช่น mnp0102@pilot.mnp.local) ส่งออกไปก็ไม่มีวันถึงใคร และถ้าปล่อยให้
// เข้าคิวจริงจะกลายเป็น error ซ้ำๆ จน retry หมดโควตา บังหน้าความผิดพลาดจริงที่ควรเห็น
// จึงตัดออกตั้งแต่ต้นทางและบันทึกเป็น skipped พร้อมเหตุผล ไม่ใช่ failed
const undeliverableSuffixes = [".local", ".invalid", ".test", ".example", ".localhost"];

function undeliverableReason(email: string | null | undefined): string | null {
  const value = String(email ?? "").trim().toLowerCase();
  if (!value) return "NO_EMAIL";
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) return `INVALID_EMAIL:${value}`;
  if (undeliverableSuffixes.some((suffix) => value.endsWith(suffix))) return `PLACEHOLDER_DOMAIN:${value}`;
  return null;
}

// ข้อความ error จากผู้ให้บริการมักมีอีเมลปลายทางติดมาด้วย เก็บลงฐานข้อมูลได้ (คนที่อ่านคือ Admin
// ที่เห็นอีเมลพนักงานอยู่แล้ว) แต่ไม่ส่งกลับไปให้ไคลเอนต์ที่เป็นใครก็ได้ที่ล็อกอินอยู่
function redactEmails(message: string) {
  return message.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]");
}

/* ---------- คิวงาน ---------- */

type RecipientRow = { email: string | null; is_active: boolean } | { email: string | null; is_active: boolean }[] | null;
type PendingNotification = {
  id: string;
  title: string;
  body: string;
  email_attempts: number;
  recipient: RecipientRow;
};

function firstRecipient(recipient: RecipientRow) {
  return Array.isArray(recipient) ? recipient[0] ?? null : recipient;
}

// ไม่มี generated types ของ schema ในโปรเจกต์นี้ จึงปล่อยเป็น client ที่ไม่ผูก schema
// (ReturnType<typeof createClient> จะได้ schema เป็น never แล้ว update() ทุกตัวจะ type error)
// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any>;

async function pendingRows(admin: Admin, requestId: string | null) {
  // ตัวกรองทั้งหมดต้องต่อให้ครบก่อน order/limit เพราะ postgrest-js คืน transform builder หลัง order()
  // ซึ่งไม่มีเมธอดกรองอย่าง eq() ให้ต่อท้ายอีกแล้ว
  const base = admin
    .from("notifications")
    .select("id, title, body, email_attempts, recipient:employees!notifications_recipient_id_fkey(email, is_active)")
    .eq("email_status", "pending")
    .lt("email_attempts", MAX_ATTEMPTS);
  const filtered = requestId ? base.eq("request_id", requestId) : base;
  return await filtered.order("created_at", { ascending: true }).limit(BATCH_LIMIT);
}

async function dispatch(admin: Admin, requestId: string | null) {
  const transport = transportName();
  const { data, error } = await pendingRows(admin, requestId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PendingNotification[];

  if (!rows.length) return { transport, configured: Boolean(transport), pending: 0, sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  // ยังไม่ได้ตั้งค่าช่องทางส่ง = ไม่ใช่ความผิดของแถวไหน อย่าไปเพิ่ม attempts หรือปิดสถานะทิ้ง
  // ปล่อยค้างคิวไว้อย่างนั้น พอ Admin ตั้ง secret เสร็จ การเรียกครั้งถัดไปจะส่งย้อนหลังให้เองทั้งหมด
  if (!transport) {
    console.warn("notify-email: NOT_CONFIGURED", { requestId, pending: rows.length });
    return { transport: null, configured: false, pending: rows.length, sent: 0, skipped: 0, failed: 0, errors: [] as string[] };
  }

  const now = () => new Date().toISOString();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const recipient = firstRecipient(row.recipient);
    const attempts = (row.email_attempts ?? 0) + 1;

    const reason = !recipient
      ? "RECIPIENT_NOT_FOUND"
      : !recipient.is_active
        ? "RECIPIENT_INACTIVE"
        : undeliverableReason(recipient.email);
    if (reason) {
      skipped++;
      console.warn("notify-email: skipped", { requestId, notificationId: row.id, reason });
      await admin.from("notifications").update({
        email_status: "skipped",
        email_attempts: attempts,
        email_attempted_at: now(),
        email_error: reason,
      }).eq("id", row.id);
      continue;
    }

    try {
      await sendOne(String(recipient!.email), row.title, row.body);
      sent++;
      console.log("notify-email: sent", { requestId, notificationId: row.id, transport, to: recipient!.email });
      await admin.from("notifications").update({
        email_status: "sent",
        email_sent_at: now(),
        email_attempts: attempts,
        email_attempted_at: now(),
        email_error: null,
      }).eq("id", row.id);
    } catch (mailError) {
      const message = String(mailError).slice(0, 500);
      // ยังไม่ครบโควตา retry → คงสถานะ pending ไว้ให้รอบถัดไปหยิบไปส่งใหม่ ครบแล้วค่อยปิดเป็น failed
      const exhausted = attempts >= MAX_ATTEMPTS;
      if (exhausted) failed++;
      errors.push(redactEmails(message));
      console.error("notify-email: send failed", { requestId, notificationId: row.id, transport, attempts, exhausted, error: message });
      await admin.from("notifications").update({
        email_status: exhausted ? "failed" : "pending",
        email_attempts: attempts,
        email_attempted_at: now(),
        email_error: message,
      }).eq("id", row.id);
    }
  }

  return { transport, configured: true, pending: rows.length, sent, skipped, failed, errors: errors.slice(0, 5) };
}

/* ---------- HTTP ---------- */

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (request.method !== "POST") return response(request, { error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return response(request, { error: "SERVER_MISCONFIGURED" }, 500);

  const token = bearerToken(request);
  if (!token) return response(request, { error: "AUTH_REQUIRED" }, 401);
  // service role key = ฝั่งเซิร์ฟเวอร์เรียกกันเอง (pilot-auth) ไม่ต้องมี session ของผู้ใช้
  if (token !== serviceKey) {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user) return response(request, { error: "AUTH_REQUIRED" }, 401);
  }

  let body: { requestId?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const admin = createClient(supabaseUrl, serviceKey);

  if (body.action === "status") {
    const transport = transportName();
    const { count, error } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("email_status", "pending");
    if (error) return response(request, { error: error.message }, 500);
    return response(request, { ok: true, configured: Boolean(transport), transport, pending: count ?? 0 });
  }

  // ไม่ส่ง requestId มา = ไล่ทั้งคิว ครอบคลุมแจ้งเตือนที่ไม่ผูกกับคำร้อง (คำร้องเปิดบัญชี/แก้ไข ID)
  // และแถวที่ตกค้างจากตอนที่ยังไม่ได้ตั้งค่า secret หรือผู้ใช้ปิดเบราว์เซอร์ก่อนยิงสำเร็จ
  const requestId = String(body.requestId ?? "").trim() || null;
  try {
    const result = await dispatch(admin, requestId);
    return response(request, { ok: true, ...result });
  } catch (dispatchError) {
    console.error("notify-email: dispatch failed", { requestId, error: String(dispatchError) });
    return response(request, { error: redactEmails(String(dispatchError)) }, 500);
  }
});
