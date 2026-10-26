import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "npm:web-push@3.6.7";
import {
  classifySendError,
  isAllowedPushEndpoint,
  pushTitle,
  pushUrlFor,
  settleRow,
  type PushRow,
  type SendOutcome,
} from "./payload.ts";

// ตัวส่ง Web Push ของ pilot web — ทำงานเป็น "คิว" เหมือน notify-email
//
// แถวใน public.notifications ถูก insert โดย RPC (ตรวจสิทธิ์และเลือกผู้รับไว้แล้ว) ฟังก์ชันนี้ไม่คำนวณ "ใครควรได้รับ" ซ้ำ
// pg_cron เรียกทุกนาทีผ่าน private.drain_pending_push_notifications() (เฉพาะเมื่อมีแถว pending) ด้วย service role key
//   1) จองแถวด้วย public.app_claim_push_notifications() — ฐานข้อมูลกันสองรอบจองแถวเดียวกันและนับจำนวนครั้งให้
//   2) ส่งไปทุกเครื่อง (push_subscriptions) ของผู้รับ: 404/410 ลบเครื่องนั้นทิ้ง, สำเร็จเครื่องใดเครื่องหนึ่ง = sent
//   3) ล้มชั่วคราว = กลับเป็น pending (ลองใหม่หลังหมดเวลาเช่า 10 นาที) ครบ 3 ครั้งเป็น failed
//
// สิทธิ์: service role key เท่านั้น (ไม่มีผู้ใช้เรียกเอง จึงไม่มี CORS) ตอบเฉพาะตัวเลขสรุป
// ไม่คืนเนื้อหาแจ้งเตือน endpoint หรือรายชื่อผู้รับกลับไป และไม่ log ค่าเหล่านั้น
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (base64url จาก `npx web-push generate-vapid-keys`), VAPID_SUBJECT (mailto:… หรือ https://…)
// ยังตั้งไม่ครบ = ตอบ configured=false โดยไม่แตะคิว

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 50;
const ROW_CONCURRENCY = 10;
const SEND_TIMEOUT_MS = 10_000;
// เวลาทำงานนานสุดของหนึ่งรอบ ≈ ceil(50 แถว / 10 พร้อมกัน) × (ส่ง 10 วินาที + อัปเดตฐานข้อมูล) ≈ 1–2 นาที ต่ำกว่าเพดาน wall-clock ของ Edge Function (ราว 400 วินาที)
// มาก และเวลาเช่าของแถวที่จอง (10 นาทีใน app_claim_push_notifications) ยาวกว่าเพดานนั้นอีก จึงไม่มีรอบอื่นจองแถวที่รอบนี้ยังส่งอยู่
// push ที่ค้างที่ push service เกิน 12 ชั่วโมงไม่มีประโยชน์ ปล่อยให้หมดอายุเอง
const PUSH_TTL_SECONDS = 12 * 60 * 60;

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any>;

type ClaimedRow = PushRow & {
  id: string;
  recipient_id: string;
  title: string;
  push_attempts: number;
};

type Subscription = { id: string; employee_id: string; endpoint: string; p256dh: string; auth: string; failure_count: number };

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// เทียบแบบเวลาคงที่ (hash ก่อนเทียบ) กันเดาคีย์จากเวลาตอบ
async function sameSecret(actual: string, expected: string) {
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([actual, expected].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(value)))));
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

let vapidReady: boolean | undefined;

function configureVapid(): boolean {
  if (vapidReady !== undefined) return vapidReady;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  const subject = Deno.env.get("VAPID_SUBJECT")?.trim();
  if (!publicKey || !privateKey || !subject) {
    vapidReady = false;
    return vapidReady;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidReady = true;
  } catch {
    // รูปแบบกุญแจหรือ subject ผิด — ไม่ log ค่าใด ๆ
    console.warn("notify-push: VAPID_INVALID");
    vapidReady = false;
  }
  return vapidReady;
}

async function sendToSubscription(subscription: Subscription, payload: string): Promise<SendOutcome> {
  // endpoint ที่ไม่ใช่ push service จริง (ผู้ใช้บันทึกผ่าน RPC ได้) ไม่ถูกเรียก และถูกลบทิ้ง
  if (!isAllowedPushEndpoint(subscription.endpoint)) return { outcome: "gone", code: "ENDPOINT_NOT_ALLOWED" };
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
      { TTL: PUSH_TTL_SECONDS, urgency: "high", timeout: SEND_TIMEOUT_MS },
    );
    return { outcome: "sent" };
  } catch (error) {
    return classifySendError(error);
  }
}

async function loadRequestNumbers(admin: Admin, rows: ClaimedRow[]) {
  const ids = [...new Set(rows.map((row) => row.request_id).filter((id): id is string => Boolean(id)))];
  const numbers = new Map<string, string>();
  if (!ids.length) return numbers;
  const { data, error } = await admin.from("requests").select("id, request_no").in("id", ids);
  // เลขที่เอกสารเป็นของเสริม: ดึงไม่ได้ก็ยังส่งได้ด้วยหัวเรื่องอย่างเดียว
  if (error) {
    console.warn("notify-push: request numbers unavailable");
    return numbers;
  }
  for (const item of (data ?? []) as { id: string; request_no: string | null }[]) {
    if (item.request_no) numbers.set(item.id, item.request_no);
  }
  return numbers;
}

async function drainQueue(admin: Admin) {
  const { data, error } = await admin.rpc("app_claim_push_notifications", { p_limit: BATCH_LIMIT });
  if (error) throw new Error("CLAIM_FAILED");
  const rows = (data ?? []) as ClaimedRow[];
  const summary = { claimed: rows.length, sent: 0, skipped: 0, retry: 0, failed: 0, removedSubscriptions: 0 };
  if (!rows.length) return summary;

  const recipientIds = [...new Set(rows.map((row) => row.recipient_id))];
  const [requestNumbers, employeesResult, subscriptionsResult] = await Promise.all([
    loadRequestNumbers(admin, rows),
    admin.from("employees").select("id, is_active").in("id", recipientIds),
    admin.from("push_subscriptions").select("id, employee_id, endpoint, p256dh, auth, failure_count").in("employee_id", recipientIds),
  ]);
  if (employeesResult.error || subscriptionsResult.error) throw new Error("LOOKUP_FAILED");

  const activeEmployees = new Set(
    ((employeesResult.data ?? []) as { id: string; is_active: boolean }[]).filter((item) => item.is_active).map((item) => item.id),
  );
  const subscriptionsByEmployee = new Map<string, Subscription[]>();
  for (const item of (subscriptionsResult.data ?? []) as Subscription[]) {
    const list = subscriptionsByEmployee.get(item.employee_id) ?? [];
    list.push(item);
    subscriptionsByEmployee.set(item.employee_id, list);
  }

  // ปิดผลเฉพาะเมื่อแถวยังเป็น "การจองครั้งนี้" (ยัง pending และ push_attempts เท่าตอนจอง) — ถ้าเวลาเช่าหมดระหว่างส่งและรอบอื่นจองไปแล้ว
  // (push_attempts เพิ่ม) รอบนี้ต้องไม่เขียนทับผลของรอบนั้น
  const settle = async (row: ClaimedRow, status: "sent" | "skipped" | "pending" | "failed", pushError: string | null) => {
    const { data: updated, error: updateError } = await admin.from("notifications").update({
      push_status: status,
      push_error: pushError,
      push_attempted_at: new Date().toISOString(),
    }).eq("id", row.id).eq("push_status", "pending").eq("push_attempts", row.push_attempts).select("id");
    if (updateError) {
      // ปิดผลไม่สำเร็จ = แถวคงสถานะ pending ที่ถูกเช่าอยู่ จะถูกจองซ้ำหลังหมดเวลาเช่า (อาจส่งซ้ำได้หนึ่งครั้ง ดีกว่าหายไป)
      console.error("notify-push: settle failed", { notificationId: row.id });
    } else if (!updated?.length) {
      console.warn("notify-push: claim lost, result discarded", { notificationId: row.id });
      return;
    }
    if (status === "pending") summary.retry++;
    else summary[status]++;
  };

  const handle = async (row: ClaimedRow) => {
    try {
      if (!activeEmployees.has(row.recipient_id)) return await settle(row, "skipped", "RECIPIENT_INACTIVE");
      const subscriptions = subscriptionsByEmployee.get(row.recipient_id) ?? [];
      if (!subscriptions.length) return await settle(row, "skipped", "NO_SUBSCRIPTION");

      const payload = JSON.stringify({
        title: pushTitle(row.title, row.request_id ? requestNumbers.get(row.request_id) : null),
        url: pushUrlFor(row),
        // tag ผูกกับแถวแจ้งเตือน: แจ้งเตือนคนละเรื่องไม่ทับกันบนหน้าจอ แต่ส่งซ้ำแถวเดิมไม่ขึ้นสองอัน
        tag: `n-${row.id}`,
      });

      // ส่งทุกเครื่องของผู้รับพร้อมกัน (สูงสุด 10 เครื่อง) เพื่อให้เวลาต่อแถวไม่เกินเวลา timeout ของการส่งหนึ่งครั้ง
      const results: SendOutcome[] = await Promise.all(subscriptions.map(async (subscription) => {
        const result = await sendToSubscription(subscription, payload);
        if (result.outcome === "gone") {
          await admin.from("push_subscriptions").delete().eq("id", subscription.id);
          summary.removedSubscriptions++;
        } else {
          await admin.from("push_subscriptions").update(
            result.outcome === "sent"
              ? { last_success_at: new Date().toISOString(), failure_count: 0 }
              // นับครั้งที่ล้มเพื่อวินิจฉัย (ไม่ลบเครื่องเพียงเพราะล้มชั่วคราว)
              : { failure_count: subscription.failure_count + 1 },
          ).eq("id", subscription.id);
        }
        return result;
      }));
      const settlement = settleRow(results, row.push_attempts, MAX_ATTEMPTS);
      await settle(row, settlement.status, settlement.error);
    } catch {
      // ข้อผิดพลาดที่ไม่คาดคิดนับเป็นการล้มชั่วคราว ไม่ log เนื้อหา
      console.error("notify-push: unexpected error", { notificationId: row.id });
      await settle(row, row.push_attempts >= MAX_ATTEMPTS ? "failed" : "pending", "UNEXPECTED");
    }
  };

  // ส่งหลายแถวพร้อมกันแต่จำกัดจำนวน — ผู้รับต่างคนไม่ต้องรอกัน แต่ไม่ยิง push service ถล่ม
  const queue = [...rows];
  await Promise.all(Array.from({ length: Math.min(ROW_CONCURRENCY, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) await handle(row);
  }));
  return summary;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return reply({ error: "SERVER_MISCONFIGURED" }, 500);

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !(await sameSecret(token, serviceKey))) return reply({ error: "AUTH_REQUIRED" }, 401);

  // ยังไม่ตั้งกุญแจ VAPID = ไม่ใช่ความผิดของแถวไหน ไม่จองและไม่แตะคิว
  if (!configureVapid()) return reply({ ok: true, configured: false });

  try {
    const result = await drainQueue(createClient(supabaseUrl, serviceKey));
    return reply({ ok: true, configured: true, ...result });
  } catch (processError) {
    console.error("notify-push: failed", { reason: processError instanceof Error ? processError.message : "UNKNOWN" });
    return reply({ error: "PUSH_FAILED" }, 500);
  }
});
