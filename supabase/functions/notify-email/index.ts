import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import nodemailer from "npm:nodemailer@6.9.16";

// ตัวส่งอีเมลแจ้งเตือนของ pilot web — ทำงานเป็น "คิว" ไม่ใช่ "ส่งตามคำสั่งของหน้าจอ"
//
// แถวใน public.notifications ถูก insert โดย RPC (security definer ตรวจสิทธิ์และเลือกผู้รับไว้แล้ว)
// ฟังก์ชันนี้จึงไม่คำนวณ "ใครควรได้รับ" ซ้ำ แค่ไล่ส่งแถวที่ email_status = 'pending'
//
// เรียกได้ 3 แบบ
//   POST {}                      → ไล่ส่งทุกแถวที่ยังค้างในคิว (ใช้ตอนเปิดแอป/หลัง action ที่ไม่มี request_id
//                                  เช่น คำร้องเปิดบัญชี ซึ่ง notifications.request_id เป็น NULL)
//   POST { requestId }           → จำกัดเฉพาะแถวของคำร้องนั้น (ใช้ทันทีหลัง action สำเร็จ)
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

// ส่งทั้ง html และ text เสมอ — อีเมลไคลเอนต์ที่ปิดรูปแบบ HTML หรือ screen reader จะใช้ text แทน
type Message = { subject: string; text: string; html: string };

async function sendViaResend(to: string, message: Message) {
  const from = Deno.env.get("NOTIFY_EMAIL_FROM") || "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text, html: message.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendOne(to: string, message: Message) {
  if (transportName() === "resend") return sendViaResend(to, message);
  const mailer = getGmailTransport();
  if (!mailer) throw new Error("NOT_CONFIGURED");
  const user = Deno.env.get("GMAIL_SMTP_USER");
  const address = Deno.env.get("NOTIFY_EMAIL_FROM") || user;
  await mailer.sendMail({
    from: address ? `"MNP Workspace" <${address}>` : undefined,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
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

/* ---------- ประกอบเนื้อหาอีเมล ---------- */

// ลิงก์กลับเข้าเว็บ ตั้งทับได้ด้วย secret APP_BASE_URL เผื่อย้าย host ภายหลัง
// pilot web เป็น hash router ลิงก์จึงต้องมี /#/ เสมอ (ดู currentRoute() ใน app.js)
function appBaseUrl() {
  return (Deno.env.get("APP_BASE_URL") || "https://mnpchatai.github.io/MNP_SYSTEM").replace(/\/+$/, "");
}

// ปลายทางของลิงก์ใช้กติกาเดียวกับ notificationHref() ใน app.js เพื่อให้กดจากอีเมลแล้วไปถึง
// หน้าเดียวกับที่กดจากในเว็บเป๊ะ ไม่ต้องไล่หาเองว่าต้องเปิดหน้าไหน
function linkFor(row: PendingNotification) {
  const base = appBaseUrl();
  if (row.request_id) return `${base}/#/request?id=${encodeURIComponent(row.request_id)}`;
  if (row.action_url === "/admin") return `${base}/#/admin`;
  if (row.action_url === "/profile") return `${base}/#/profile`;
  return `${base}/#/notifications`;
}

// หัวอีเมลต้องบอกให้ชัดว่า "เกิดอะไรขึ้นกับเอกสารไหน" และ "ผู้รับต้องทำอะไรต่อ" ไม่ใช่คำกลางๆ
// อย่าง "สถานะคำร้องมีการเปลี่ยนแปลง" ที่ผู้รับต้องเปิดอ่านเองว่าเปลี่ยนเป็นอะไร
//   heading = หัวอีเมลและหัวเรื่อง, lead = ประโยคอธิบาย, next = สิ่งที่ผู้รับต้องทำต่อ (null = ไม่แสดงกล่อง)
// doc คือชื่อเอกสารที่ผู้ใช้จำได้จากหน้าเลือกประเภทคำร้อง (ใบคำร้อง/แจ้งซ่อม MT, NCR/CAR ฯลฯ)
// ถ้าดึงรายละเอียดคำร้องไม่สำเร็จจะใช้คำกลางว่า "คำร้อง"
type Presentation = { emoji: string; color: string; heading: string; lead: string; next: string | null };
type DocContext = { doc: string; typeCode: string | null };

const colors = {
  info: "#1769e0",
  success: "#12854a",
  danger: "#d92d20",
  warning: "#b54708",
  account: "#6941c6",
  muted: "#475467",
};

// trigger private.log_request_status_change แจ้งผู้ยื่นทุกครั้งที่สถานะเปลี่ยน body เป็น
// "<เลขที่> เปลี่ยนเป็น <สถานะ>" ตั้งแต่ migration 20261001020000 สถานะเป็นคำไทย (statusLabels) และชื่อเรื่อง
// เป็นหัวข้อเฉพาะสถานะ (private.status_change_notification_title ซึ่งต้องตรงกับ heading ในตารางข้างล่าง)
// ส่วนแถวเก่าก่อนหน้านั้นสถานะเป็นรหัสอังกฤษ และชื่อเรื่องเป็นคำกลางข้างล่างนี้ รองรับทั้งสองแบบ
const STATUS_CHANGED_TITLE = "สถานะคำร้องมีการเปลี่ยนแปลง";
// private.notify_title เติมคำนำหน้านี้ให้คำร้องเร่งด่วน ต้องคงไว้บนหัวอีเมลเสมอ
const URGENT_PREFIX = "🚨 [ด่วน] ";

const NO_ACTION_TRACK = "ไม่ต้องดำเนินการเพิ่ม ติดตามความคืบหน้าได้จากหน้ารายการ";

function decisionChoices(ctx: DocContext) {
  return ctx.typeCode === "MANAGEMENT"
    ? "\"อนุมัติ\" \"ขอข้อมูลเพิ่ม\" \"รับทราบข้อมูล\" หรือ \"ไม่อนุมัติ\""
    : "\"อนุมัติ\" \"ขอข้อมูลเพิ่ม\" หรือ \"ไม่อนุมัติ\"";
}

// ผู้รับของแจ้งเตือนเปลี่ยนสถานะคือผู้ยื่นคำร้องเสมอ ข้อความจึงพูดกับผู้ยื่น
// heading ต้องตรงกับ private.status_change_notification_title (เว็บแสดงชื่อนั้น อีเมลแสดงชื่อนี้)
const statusChangePresentations: Record<string, (ctx: DocContext) => Presentation> = {
  pending_approval: ({ doc }) => ({
    emoji: "📨", color: colors.info,
    heading: `${doc} ส่งถึงผู้อนุมัติแล้ว`,
    lead: `${doc} ของคุณอยู่ระหว่างรอผู้อนุมัติพิจารณา`,
    next: "ไม่ต้องดำเนินการเพิ่ม ระบบจะแจ้งอีกครั้งเมื่อมีผลการพิจารณา",
  }),
  approved: ({ doc }) => ({
    emoji: "✅", color: colors.success,
    heading: `${doc} อนุมัติแล้ว`,
    lead: `${doc} ของคุณได้รับการอนุมัติเรียบร้อยแล้ว`,
    next: NO_ACTION_TRACK,
  }),
  more_info: ({ doc }) => ({
    emoji: "📝", color: colors.warning,
    heading: `${doc} ขอข้อมูลเพิ่มเติม`,
    lead: `ผู้อนุมัติขอข้อมูลเพิ่มเติมก่อนพิจารณา${doc} ของคุณต่อ`,
    next: "เปิดคำร้องเพื่ออ่านสิ่งที่ผู้อนุมัติขอ เพิ่ม/แก้ไขข้อมูล แล้วกด \"ส่งข้อมูลกลับให้พิจารณาอีกครั้ง\" — คำร้องจะหยุดรอจนกว่าคุณจะส่งข้อมูล",
  }),
  rejected: ({ doc }) => ({
    emoji: "❌", color: colors.danger,
    heading: `${doc} ไม่อนุมัติ`,
    lead: `${doc} ของคุณไม่ผ่านการอนุมัติ`,
    next: "เปิดคำร้องเพื่อดูเหตุผลจากผู้อนุมัติ หากยังต้องการดำเนินการ ให้ยื่นคำร้องใหม่โดยแก้ไขตามเหตุผลนั้น",
  }),
  acknowledged: ({ doc }) => ({
    emoji: "📘", color: colors.info,
    heading: `${doc} ฝ่ายบริหารรับทราบข้อมูลแล้ว`,
    lead: `ฝ่ายบริหารรับทราบข้อมูลใน${doc} ของคุณแล้ว โดยไม่มีการดำเนินการต่อ`,
    next: "ไม่ต้องดำเนินการเพิ่ม",
  }),
  pending_assign: ({ doc }) => ({
    emoji: "✅", color: colors.success,
    heading: `${doc} อนุมัติแล้ว รอมอบหมายช่าง`,
    lead: `${doc} ของคุณได้รับการอนุมัติครบแล้ว และรอหัวหน้าหน่วยงานมอบหมายช่าง`,
    next: NO_ACTION_TRACK,
  }),
  assigned: ({ doc }) => ({
    emoji: "🔧", color: colors.info,
    heading: `${doc} มอบหมายผู้รับผิดชอบแล้ว`,
    lead: `${doc} ของคุณมีผู้รับผิดชอบดำเนินงานแล้ว`,
    next: "ไม่ต้องดำเนินการเพิ่ม เมื่องานเสร็จระบบจะแจ้งให้คุณตรวจรับ",
  }),
  in_progress: ({ doc }) => ({
    emoji: "🔄", color: colors.info,
    heading: `${doc} อยู่ระหว่างดำเนินการ`,
    lead: `ผู้รับผิดชอบกำลังดำเนินงานตาม${doc} ของคุณ`,
    next: NO_ACTION_TRACK,
  }),
  pending_verify: ({ doc }) => ({
    emoji: "🔍", color: colors.warning,
    heading: `${doc} ดำเนินการเสร็จแล้ว รอคุณตรวจรับ`,
    lead: `งานตาม${doc} ของคุณเสร็จแล้ว และรอคุณตรวจรับ`,
    next: "เปิดรายการ ลองใช้งานจริง แล้วกด \"ผ่าน (ใช้งานได้ปกติ)\" หรือ \"ไม่ผ่าน (ต้องซ่อมเพิ่มเติม)\"",
  }),
  completed: ({ doc }) => ({
    emoji: "🏁", color: colors.success,
    heading: `${doc} เสร็จสิ้นแล้ว`,
    lead: `${doc} ของคุณดำเนินการเสร็จสิ้นและปิดงานแล้ว`,
    next: "ไม่ต้องดำเนินการเพิ่ม",
  }),
  cancelled: ({ doc }) => ({
    emoji: "⛔", color: colors.muted,
    heading: `${doc} ถูกยกเลิก`,
    lead: `${doc} ของคุณถูกยกเลิกแล้ว`,
    next: "ไม่ต้องดำเนินการเพิ่ม หากยังต้องการดำเนินการ ให้ยื่นคำร้องใหม่",
  }),
};

/** สถานะใหม่จาก body ของ trigger ("<เลขที่> เปลี่ยนเป็น <รหัสหรือคำไทย>") — ใช้ค่าตอนเกิดเหตุการณ์
 *  ไม่ใช่สถานะปัจจุบันของคำร้อง เพราะคิวอาจส่งช้ากว่า และคำร้องอาจเปลี่ยนสถานะต่อไปแล้ว
 *  แจ้งเตือนอื่นใช้ body รูป "<เลขที่> · <เรื่อง>" จึงไม่ตรงรูปนี้ */
function statusFromBody(body: string | null | undefined) {
  const value = /^\S+ เปลี่ยนเป็น (.+?)\s*$/.exec(body ?? "")?.[1];
  if (!value) return null;
  if (Object.hasOwn(statusLabels, value)) return value;
  return Object.keys(statusLabels).find((code) => statusLabels[code] === value) ?? null;
}

// แจ้งเตือนชนิดอื่นที่ RPC ส่ง (ดูชื่อใน supabase/migrations) จับจากคำในชื่อเรื่องตามลำดับ
// ลำดับมีผล: กฎที่เฉพาะเจาะจงกว่าต้องมาก่อน เช่น "ตรวจรับไม่ผ่าน" ก่อน "ตรวจรับผ่าน" ก่อน "รอตรวจรับ"
// และ "มอบหมายช่างให้...ของคุณ" (ถึงผู้แจ้ง) ก่อน "ได้รับมอบหมายงาน" (ถึงช่าง)
type TitleRule = { match: (title: string) => boolean; present: (ctx: DocContext) => Presentation };

const requestTitleRules: TitleRule[] = [
  {
    match: (t) => t.includes("รออนุมัติ"),
    present: (ctx) => ({
      emoji: "📋", color: colors.info,
      heading: `มี${ctx.doc} ส่งถึงท่าน รอท่านพิจารณาอนุมัติ`,
      lead: `มี${ctx.doc} รอการพิจารณาจากท่าน`,
      next: `เปิดคำร้องเพื่อพิจารณา แล้วเลือก ${decisionChoices(ctx)}`,
    }),
  },
  {
    match: (t) => t.includes("ส่งข้อมูลเพิ่มเติมแล้ว"),
    present: (ctx) => ({
      emoji: "📋", color: colors.info,
      heading: `${ctx.doc} ส่งข้อมูลเพิ่มเติมถึงท่านแล้ว`,
      lead: `ผู้ยื่นส่งข้อมูลเพิ่มเติมตามที่ขอแล้ว ${ctx.doc} กลับมารอการพิจารณาจากท่าน`,
      next: `เปิดคำร้องเพื่อตรวจข้อมูลที่ส่งมา แล้วเลือก ${decisionChoices(ctx)}`,
    }),
  },
  {
    match: (t) => t.includes("มอบหมายช่างให้"),
    present: ({ doc }) => ({
      emoji: "🔧", color: colors.info,
      heading: `${doc} มอบหมายช่างแล้ว`,
      lead: `${doc} ของคุณได้รับการมอบหมายช่างผู้รับผิดชอบแล้ว`,
      next: "ไม่ต้องดำเนินการเพิ่ม เมื่อซ่อมเสร็จระบบจะแจ้งให้คุณตรวจรับ",
    }),
  },
  {
    match: (t) => t.includes("รอมอบหมาย"),
    present: ({ doc }) => ({
      emoji: "🧑‍🔧", color: colors.warning,
      heading: `${doc} อนุมัติครบแล้ว รอท่านมอบหมายช่าง`,
      lead: `${doc} ผ่านการอนุมัติครบทุกขั้นแล้ว และรอท่านมอบหมายช่าง`,
      next: "เปิดรายการ เลือกช่างผู้รับผิดชอบ แล้วกด \"มอบหมายงาน\"",
    }),
  },
  {
    match: (t) => t.includes("ได้รับมอบหมายงาน"),
    present: ({ doc }) => ({
      emoji: "🔧", color: colors.warning,
      heading: `ท่านได้รับมอบหมายงาน: ${doc}`,
      lead: `ท่านได้รับมอบหมายให้ดำเนินงานตาม${doc}`,
      next: "เปิดรายการเพื่อดูรายละเอียดงาน เริ่มดำเนินการ และบันทึกความคืบหน้าในระบบจนงานเสร็จ",
    }),
  },
  {
    match: (t) => t.includes("ตรวจรับไม่ผ่าน"),
    present: ({ doc }) => ({
      emoji: "❌", color: colors.danger,
      heading: `${doc} ตรวจรับไม่ผ่าน ต้องซ่อมเพิ่มเติม`,
      lead: `ผู้แจ้งตรวจรับงานตาม${doc} แล้วไม่ผ่าน`,
      next: "เปิดรายการเพื่ออ่านหมายเหตุจากผู้ตรวจรับ แล้วดำเนินการซ่อมเพิ่มเติม",
    }),
  },
  {
    match: (t) => t.includes("ตรวจรับผ่าน") || t.includes("ปิดงาน"),
    present: ({ doc }) => ({
      emoji: "🏁", color: colors.success,
      heading: `${doc} ตรวจรับผ่าน ปิดงานแล้ว`,
      lead: `ผู้แจ้งตรวจรับงานตาม${doc} ผ่านแล้ว และปิดงานเรียบร้อย`,
      next: "ไม่ต้องดำเนินการเพิ่ม",
    }),
  },
  {
    match: (t) => t.includes("รอตรวจรับ"),
    present: ({ doc }) => ({
      emoji: "🔍", color: colors.warning,
      heading: `${doc} ซ่อมเสร็จแล้ว รอตรวจรับ`,
      lead: `งานตาม${doc} ซ่อมเสร็จแล้ว และรอผู้แจ้งตรวจรับ`,
      next: "ผู้แจ้ง: เปิดรายการ ลองใช้งานจริง แล้วกด \"ผ่าน (ใช้งานได้ปกติ)\" หรือ \"ไม่ผ่าน (ต้องซ่อมเพิ่มเติม)\"",
    }),
  },
  {
    match: (t) => t.includes("สำเนา"),
    present: ({ doc }) => ({
      emoji: "📄", color: colors.info,
      heading: `มี${doc} ส่งถึงท่าน (สำเนาเพื่อทราบ)`,
      lead: `${doc} นี้ผ่านการอนุมัติครบแล้ว และส่งสำเนาถึงแผนกของท่านเพื่อทราบ`,
      next: "ไม่ต้องดำเนินการ เปิดอ่านรายละเอียดได้จากหน้ารายการ",
    }),
  },
  {
    match: (t) => t.includes("ของที่สั่งซื้อมาส่งหรือยัง") || t.includes("เลื่อนวันที่คาดว่าของจะมาส่ง"),
    present: ({ doc }) => ({
      emoji: "📦", color: colors.warning,
      heading: `${doc} ถึงวันที่คาดว่าของจะมาส่งแล้ว`,
      lead: `${doc} ถึงวันที่คาดว่าของที่สั่งซื้อจะมาส่งแล้ว`,
      next: "เช็คของแล้วกดบันทึกในหน้ารายการ ถ้ายังไม่มาให้เลื่อนวันที่คาดว่าจะมาส่งใหม่",
    }),
  },
];

// แจ้งเตือนที่ไม่ผูกกับคำร้อง (เรื่องบัญชีผู้ใช้) หรือชื่อเรื่องที่ไม่ตรงกฎข้างบน คงหัวข้อเดิมไว้
// และเลือกแค่อีโมจิ/สีจากคำในชื่อ เพื่อให้แจ้งเตือนชนิดใหม่ที่ RPC เพิ่มภายหลังยังแสดงผลสมเหตุสมผล
function genericPresentation(title: string, doc: string | null): Presentation {
  const base = (emoji: string, color: string, lead: string) => ({ emoji, color, heading: title, lead, next: null });
  if (title.includes("ไม่ได้รับอนุมัติ") || title.includes("ไม่อนุมัติ") || title.includes("ไม่ผ่าน")) {
    return base("❌", colors.danger, doc ? `${doc} ไม่ผ่านการพิจารณา` : "รายการนี้ไม่ผ่านการพิจารณา");
  }
  if (title.includes("ได้รับการอนุมัติ") || title.includes("อนุมัติแล้ว")) {
    return base("✅", colors.success, doc ? `${doc} ได้รับการอนุมัติเรียบร้อยแล้ว` : "รายการนี้ได้รับการอนุมัติเรียบร้อยแล้ว");
  }
  if (title.includes("รหัสผ่าน") || title.includes("ID") || title.includes("บัญชี")) {
    return base(title.includes("บัญชี") ? "👤" : "🔑", colors.account, "มีรายการเกี่ยวกับบัญชีผู้ใช้ที่ต้องดำเนินการ");
  }
  return base("🔔", colors.info, doc ? `${doc} มีความเคลื่อนไหวที่เกี่ยวข้องกับคุณ` : "มีความเคลื่อนไหวที่เกี่ยวข้องกับคุณ");
}

function presentationFor(
  row: Pick<PendingNotification, "title" | "body" | "request_id">,
  detail: RequestDetail | undefined,
): Presentation {
  const urgent = row.title.startsWith(URGENT_PREFIX);
  const title = urgent ? row.title.slice(URGENT_PREFIX.length) : row.title;
  const type = relation(detail?.request_type ?? null);
  const moduleName = type?.name_th?.trim() || null;
  const ctx: DocContext = { doc: moduleName ?? "คำร้อง", typeCode: type?.code ?? null };

  let presentation: Presentation | null = null;
  if (row.request_id) {
    const changedTo = statusFromBody(row.body);
    if (changedTo || title === STATUS_CHANGED_TITLE) {
      const status = changedTo ?? detail?.status ?? null;
      presentation = (status && statusChangePresentations[status]?.(ctx)) || {
        emoji: "🔄", color: colors.info,
        heading: `${ctx.doc} มีการเปลี่ยนแปลงสถานะ`,
        lead: `${ctx.doc} ที่คุณเกี่ยวข้องมีการเปลี่ยนแปลงสถานะ`,
        next: "เปิดหน้ารายการเพื่อดูสถานะล่าสุด",
      };
    } else {
      presentation = requestTitleRules.find((rule) => rule.match(title))?.present(ctx) ?? null;
    }
  }
  presentation ??= genericPresentation(title, moduleName);
  return urgent ? { ...presentation, heading: URGENT_PREFIX + presentation.heading } : presentation;
}

// enum ในฐานข้อมูลเป็นภาษาอังกฤษ ผู้รับอีเมลอ่านไม่รู้เรื่อง แปลที่นี่แทนการไปแก้ RPC ทุกตัว
// (ชุดคำแปลตรงกับ statusLabels/priorityLabels ใน app.js เพื่อให้เว็บกับอีเมลพูดตรงกัน)
const statusLabels: Record<string, string> = {
  draft: "ฉบับร่าง",
  pending_approval: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  in_progress: "กำลังดำเนินการ",
  more_info: "ขอข้อมูลเพิ่ม",
  completed: "เสร็จแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
  pending_assign: "รอมอบหมายช่าง",
  assigned: "รอดำเนินการ",
  pending_verify: "รอผู้แจ้งตรวจสอบ",
  acknowledged: "รับทราบข้อมูล",
};
const priorityLabels: Record<string, string> = {
  low: "ต่ำ", normal: "ปกติ", high: "สูง", urgent: "เร่งด่วน",
};

/** แทนรหัสสถานะอังกฤษที่ RPC ใส่ไว้ใน body ด้วยคำไทย เช่น "เปลี่ยนเป็น approved" */
function localizeStatuses(text: string) {
  return text.replace(
    /\b(draft|pending_approval|approved|in_progress|more_info|completed|rejected|cancelled|pending_assign|assigned|pending_verify|acknowledged)\b/g,
    (code) => statusLabels[code] ?? code,
  );
}

// ชื่อเรื่อง/คำอธิบายคำร้องเป็นข้อความที่ผู้ใช้พิมพ์เอง ต้อง escape ก่อนวางลง HTML เสมอ
function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

type RequestDetail = {
  id: string;
  request_no: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  is_urgent: boolean | null;
  machine_code: string | null;
  machine_name: string | null;
  needed_date: string | null;
  created_at: string | null;
  requester_name: string | null;
  request_type: { name_th: string | null; code: string | null } | { name_th: string | null; code: string | null }[] | null;
  department: { code: string | null } | { code: string | null }[] | null;
  requester: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
};

// ดึงรายละเอียดคำร้องของทั้ง batch ในครั้งเดียว ไม่ยิงทีละแถว เพราะรอบหนึ่งส่งได้ถึง 50 ฉบับ
// และแจ้งเตือนหลายฉบับมักอ้างคำร้องใบเดียวกัน (ผู้อนุมัติหลายคน)
async function fetchRequestDetails(admin: Admin, ids: string[]) {
  const map = new Map<string, RequestDetail>();
  if (!ids.length) return map;
  const { data, error } = await admin
    .from("requests")
    .select(
      "id, request_no, title, status, priority, is_urgent, machine_code, machine_name, needed_date, created_at, requester_name," +
      " request_type:request_types(name_th, code)," +
      " department:departments(code)," +
      " requester:employees!requests_requester_id_fkey(first_name, last_name)",
    )
    .in("id", ids);
  if (error) {
    // รายละเอียดเป็นของเสริม ถ้าดึงไม่ได้ก็ยังส่งอีเมลได้ด้วย title/body เดิม อย่าให้ทั้งคิวล้ม
    console.warn("notify-email: fetch request details failed", { error: error.message });
    return map;
  }
  for (const row of (data ?? []) as unknown as RequestDetail[]) map.set(row.id, row);
  return map;
}

type Field = { label: string; value: string };

function fieldsFor(detail: RequestDetail | undefined): Field[] {
  if (!detail) return [];
  const type = relation(detail.request_type);
  const department = relation(detail.department);
  const requester = relation(detail.requester);
  const requesterName = detail.requester_name
    || [requester?.first_name, requester?.last_name].filter(Boolean).join(" ")
    || null;

  const fields: Field[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) fields.push({ label, value });
  };
  push("เลขที่", detail.request_no);
  push("ประเภท", type?.name_th);
  push("เรื่อง", detail.title);
  push("สถานะปัจจุบัน", detail.status ? statusLabels[detail.status] ?? detail.status : null);
  push("ความสำคัญ", detail.is_urgent ? "เร่งด่วน" : detail.priority ? priorityLabels[detail.priority] ?? detail.priority : null);
  push("ผู้ขอ", requesterName);
  push("หน่วยงาน", department?.code);
  push("เครื่องจักร", [detail.machine_code, detail.machine_name].filter(Boolean).join(" · ") || null);
  push("ต้องการภายใน", formatDate(detail.needed_date));
  push("ยื่นเมื่อ", formatDate(detail.created_at, true));
  return fields;
}

/* ---------- ลิงก์ตั้งรหัสผ่านใหม่ (อีเมลยืนยันการอนุมัติสิทธิ์) ---------- */

// อีเมลยืนยันการอนุมัติสิทธิ์แนบ "ID + ลิงก์ตั้งรหัสผ่านใหม่" ไม่ส่งรหัสผ่านตัวจริงออกทางอีเมลเด็ดขาด
// โทเค็นสร้างตอนส่งเท่านั้น เก็บในฐานข้อมูลเป็น SHA-256 (ตาราง password_setup_tokens เข้าถึงได้เฉพาะ
// service role) ใช้ได้ครั้งเดียวและหมดอายุใน SETUP_TOKEN_DAYS วัน ใส่ไว้ใน fragment (#) ของ URL
// จึงไม่ถูกส่งไปกับ request ที่เซิร์ฟเวอร์/CDN บันทึก log
const SETUP_TOKEN_DAYS = 7;

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type SetupInfo = { employeeNo: string; link: string; days: number };

async function issueSetupLink(admin: Admin, employeeId: string, employeeNo: string): Promise<SetupInfo> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ลิงก์เก่าที่ยังไม่ได้ใช้ของคนเดียวกันถูกแทนที่ด้วยฉบับล่าสุด (retry/ส่งซ้ำ จึงไม่มีลิงก์ค้างหลายอัน)
  const { error: cleanError } = await admin
    .from("password_setup_tokens")
    .delete()
    .eq("employee_id", employeeId)
    .is("used_at", null);
  if (cleanError) throw new Error(`SETUP_TOKEN_CLEAN_FAILED:${cleanError.message}`);

  const { error } = await admin.from("password_setup_tokens").insert({
    employee_id: employeeId,
    token_hash: await sha256Hex(token),
    expires_at: expiresAt,
  });
  if (error) throw new Error(`SETUP_TOKEN_CREATE_FAILED:${error.message}`);

  return { employeeNo, link: `${appBaseUrl()}/#/set-password?token=${token}`, days: SETUP_TOKEN_DAYS };
}

function buildMessage(row: PendingNotification, detail: RequestDetail | undefined, setup?: SetupInfo): Message {
  const accent = presentationFor(row, detail);
  const body = localizeStatuses(row.body ?? "");
  const link = setup ? setup.link : linkFor(row);
  const fields = setup ? [{ label: "ID เข้าใช้งาน", value: setup.employeeNo }] : fieldsFor(detail);
  const ref = detail?.request_no ? ` · ${detail.request_no}` : "";

  const lead = setup ? "ผู้ดูแลระบบอนุมัติสิทธิ์เข้าใช้งานระบบของคุณเรียบร้อยแล้ว" : accent.lead;
  const next = setup ? null : accent.next;
  const heading = accent.heading;

  const subject = `${accent.emoji} ${heading}${ref}`;
  const loginLink = appBaseUrl();

  const text = [
    `${accent.emoji} ${heading}`,
    "",
    lead,
    body ? `\n${body}` : "",
    next ? `\nสิ่งที่ต้องทำต่อ: ${next}` : "",
    fields.length ? "\n" + fields.map((f) => `${f.label}: ${f.value}`).join("\n") : "",
    "",
    ...(setup
      ? [
        "ตั้งรหัสผ่านใหม่ (ลิงก์ใช้ได้ครั้งเดียว และหมดอายุใน " + setup.days + " วัน):",
        link,
        "",
        "หากจำรหัสผ่านที่ตั้งไว้ตอนขอเปิดบัญชีได้ สามารถเข้าสู่ระบบด้วย ID ข้างต้นได้ทันทีโดยไม่ต้องตั้งใหม่:",
        loginLink,
        "",
        "เพื่อความปลอดภัย ระบบไม่ส่งรหัสผ่านทางอีเมล และอย่าส่งต่ออีเมลฉบับนี้ให้ผู้อื่น",
      ]
      : ["เปิดหน้ารายการนี้เพื่อดำเนินการต่อ:", link]),
    "",
    "— อีเมลฉบับนี้ส่งอัตโนมัติจาก MNP Workspace กรุณาอย่าตอบกลับ",
  ].filter((part) => part !== "").join("\n");

  // ใช้ table layout + inline style ล้วน เพราะ Outlook/Gmail ตัด <style> และไม่รองรับ flex/grid
  const rows = fields.map((f) => `
              <tr>
                <td style="padding:7px 0;color:#667085;font-size:13px;white-space:nowrap;vertical-align:top;width:132px">${escapeHtml(f.label)}</td>
                <td style="padding:7px 0;color:#101828;font-size:14px;font-weight:600;vertical-align:top">${escapeHtml(f.value)}</td>
              </tr>`).join("");

  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f7">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(lead)}${detail?.title ? ` — ${escapeHtml(detail.title)}` : ""}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f4f7;padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.1);font-family:'Segoe UI',Tahoma,Arial,sans-serif">

          <tr>
            <td style="background:${accent.color};padding:22px 28px">
              <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.75)">MNP Workspace</div>
              <div style="font-size:21px;font-weight:700;color:#ffffff;padding-top:6px;line-height:1.35">${accent.emoji} ${escapeHtml(heading)}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 28px 6px">
              <p style="margin:0;font-size:15px;line-height:1.65;color:#344054">${escapeHtml(lead)}</p>
              ${body ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#101828;font-weight:600">${escapeHtml(body)}</p>` : ""}
            </td>
          </tr>

          ${next ? `
          <tr>
            <td style="padding:16px 28px 0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:4px solid ${accent.color};background:#f9fafb;border-radius:8px">
                <tr><td style="padding:12px 16px">
                  <div style="font-size:12px;font-weight:700;letter-spacing:.04em;color:${accent.color}">สิ่งที่ต้องทำต่อ</div>
                  <div style="padding-top:4px;font-size:14px;line-height:1.65;color:#101828">${escapeHtml(next)}</div>
                </td></tr>
              </table>
            </td>
          </tr>` : ""}

          ${fields.length ? `
          <tr>
            <td style="padding:18px 28px 4px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border:1px solid #eaecf0;border-radius:10px">
                <tr><td style="padding:14px 18px">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
                  </table>
                </td></tr>
              </table>
            </td>
          </tr>` : ""}

          <tr>
            <td style="padding:22px 28px 6px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center" style="background:${accent.color};border-radius:9px">
                  <a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${setup ? "ตั้งรหัสผ่านใหม่ →" : "เปิดหน้ารายการนี้ →"}</a>
                </td></tr>
              </table>
              <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#98a2b3">${setup ? `ลิงก์ตั้งรหัสผ่านใช้ได้ครั้งเดียวและหมดอายุใน ${setup.days} วัน หากปุ่มใช้ไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์` : "กดปุ่มด้านบนเพื่อเข้าสู่หน้ารายการโดยตรง หากปุ่มใช้ไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์"}<br><span style="color:#667085;word-break:break-all">${escapeHtml(link)}</span></p>
              ${setup ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.65;color:#344054">หากจำรหัสผ่านที่ตั้งไว้ตอนขอเปิดบัญชีได้ สามารถ <a href="${escapeHtml(loginLink)}" style="color:${accent.color};font-weight:700">เข้าสู่ระบบ</a> ด้วย ID ข้างต้นได้ทันทีโดยไม่ต้องตั้งรหัสผ่านใหม่<br>เพื่อความปลอดภัย ระบบไม่ส่งรหัสผ่านทางอีเมล และโปรดอย่าส่งต่ออีเมลฉบับนี้ให้ผู้อื่น</p>` : ""}
            </td>
          </tr>

          <tr>
            <td style="padding:20px 28px 26px">
              <div style="border-top:1px solid #eaecf0;padding-top:14px;font-size:12px;line-height:1.6;color:#98a2b3">
                อีเมลฉบับนี้ส่งอัตโนมัติจากระบบคำร้อง MNP Workspace กรุณาอย่าตอบกลับ<br>
                หากคุณไม่เกี่ยวข้องกับรายการนี้ กรุณาแจ้งผู้ดูแลระบบ
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/* ---------- คิวงาน ---------- */

type RecipientInfo = { email: string | null; is_active: boolean; employee_no: string | null };
type RecipientRow = RecipientInfo | RecipientInfo[] | null;
type PendingNotification = {
  id: string;
  title: string;
  body: string;
  request_id: string | null;
  action_url: string | null;
  email_attempts: number;
  recipient_id: string | null;
  email_setup_link: boolean;
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
    .select("id, title, body, request_id, action_url, email_attempts, recipient_id, email_setup_link, recipient:employees!notifications_recipient_id_fkey(email, is_active, employee_no)")
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

  const details = await fetchRequestDetails(
    admin,
    [...new Set(rows.map((row) => row.request_id).filter((id): id is string => Boolean(id)))],
  );

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
      let setup: SetupInfo | undefined;
      if (row.email_setup_link) {
        if (!row.recipient_id || !recipient!.employee_no) throw new Error("SETUP_RECIPIENT_INVALID");
        setup = await issueSetupLink(admin, row.recipient_id, recipient!.employee_no);
      }
      await sendOne(String(recipient!.email), buildMessage(row, row.request_id ? details.get(row.request_id) : undefined, setup));
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
    return response(request, { ok: true, configured: Boolean(transport), transport, pending: count ?? 0, baseUrl: appBaseUrl() });
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
