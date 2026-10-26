// ส่วนที่เป็นกติกาล้วน ๆ ของ notify-push (ไม่แตะเครือข่าย/ฐานข้อมูล) แยกไว้ให้ทดสอบด้วย node ได้
// (scripts/tests/notify-push-payload.test.mjs) — index.ts ประกอบส่วนนี้เข้ากับ Supabase และไลบรารี Web Push

export type PushRow = {
  request_id: string | null;
  action_url: string | null;
  kind: string | null;
  digest: unknown;
};

// ปลายทางเมื่อกดแจ้งเตือน เป็น hash route "สัมพัทธ์" กับ scope ของ service worker (sw.js แปลงเป็น URL เต็มเอง)
// เพราะ Pilot เปิดจากทั้ง GitHub Pages (/MNP_SYSTEM/) และ Cloudflare Workers (/) จึงห้ามใส่ host หรือ path
// กติกาตรงกับ notificationHref() ใน app.js (กดในระฆังแล้วไปหน้าเดียวกับกดจาก push) ต่างกันแค่แจ้งเตือนที่ไม่มีหน้าปลายทาง
// ในแอปซึ่งที่นี่พาไปหน้าการแจ้งเตือนแทนที่จะไม่มีลิงก์
export function pushUrlFor(row: PushRow): string {
  if (row.request_id) return `#/request?id=${encodeURIComponent(row.request_id)}`;
  const action = row.action_url ?? "";
  if (action === "/admin") return "#/admin";
  if (action === "/profile") return "#/profile";
  if (action.startsWith("/ncr/")) return `#/ncr?id=${encodeURIComponent(action.slice(5))}`;
  if (action === "/") {
    // สรุปงานค้าง (reminder) ที่มีงานเดียวพาไปที่งานนั้นเลย (สำเนาถึงหัวหน้า kind=escalation ไปหน้าหลักเสมอ เพราะอาจไม่มีสิทธิ์เปิดเอกสาร)
    const items = Array.isArray(row.digest) ? row.digest : [];
    const only = items.length === 1 ? items[0] as { item_type?: unknown; item_id?: unknown } : null;
    if (row.kind === "reminder" && only && typeof only.item_id === "string") {
      if (only.item_type === "ncr") return `#/ncr?id=${encodeURIComponent(only.item_id)}`;
      if (only.item_type === "request") return `#/request?id=${encodeURIComponent(only.item_id)}`;
    }
    return "#/dashboard";
  }
  return "#/notifications";
}

// ข้อความบนหน้าจอล็อก = หัวเรื่องของแจ้งเตือน + เลขที่เอกสาร (ถ้ามีคำร้อง) เท่านั้น ไม่มีรายละเอียดอื่น
// ไม่ใส่ซ้ำถ้าหัวเรื่องมีเลขที่นั้นอยู่แล้ว และตัดความยาวไว้ไม่ให้ payload เกินขีดจำกัด ~4 KB ของ Web Push
const MAX_TITLE_LENGTH = 180;

export function pushTitle(title: string | null | undefined, requestNo: string | null | undefined): string {
  const base = String(title ?? "").replace(/\s+/g, " ").trim();
  const number = String(requestNo ?? "").trim();
  const text = number && !base.includes(number) ? `${base} · ${number}` : base;
  const fallback = text || "มีการแจ้งเตือนใหม่";
  return fallback.length > MAX_TITLE_LENGTH ? `${fallback.slice(0, MAX_TITLE_LENGTH - 1)}…` : fallback;
}

// endpoint ต้องมาจาก push service ของเบราว์เซอร์จริงเท่านั้น: ผู้ใช้ที่ล็อกอินแล้วบันทึก endpoint อะไรก็ได้ผ่าน RPC
// ฟังก์ชันนี้ถูกเซิร์ฟเวอร์ POST ไปหา endpoint ทุกอันจึงต้องกันไม่ให้ใช้เป็นช่อง SSRF ไปยัง host ภายใน/อื่น
// ฐานข้อมูลตรวจรายการเดียวกันตอนบันทึก (app_save_push_subscription ใน supabase/migrations/20261026010000_web_push_notifications.sql
// ซึ่งเข้มกว่าเล็กน้อย: ไม่รับพอร์ต) — เพิ่ม host ใหม่ต้องแก้ทั้งสองที่ให้ตรงกัน (ที่นี่ + migration ใหม่ที่ create or replace ฟังก์ชันนั้น)
//   FCM (Chrome/Edge/Opera/Brave/Samsung บน Android)  fcm.googleapis.com
//   Firefox                                           updates.push.services.mozilla.com
//   Safari/iOS                                        web.push.apple.com
//   Edge รุ่นเก่า/Windows                             *.notify.windows.com
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

// ผลการส่งไปที่เครื่องหนึ่ง
//   sent       push service รับแล้ว (2xx)
//   gone       เครื่องนี้ใช้ไม่ได้อีกแล้ว (404/410 หรือ endpoint ไม่อยู่ในรายการที่อนุญาต) ลบทิ้ง ไม่ลองซ้ำ
//   transient  ล้มเหลวชั่วคราว (เครือข่าย, 5xx, 429, กุญแจ VAPID ไม่ตรง ฯลฯ) ลองใหม่ได้
export type SendOutcome = { outcome: "sent" } | { outcome: "gone"; code: string } | { outcome: "transient"; code: string };

// เก็บเฉพาะ "รหัส" สั้น ๆ ลงฐานข้อมูล/log ไม่เก็บข้อความ error ดิบ เพราะมี endpoint (ที่อยู่ลับของเครื่อง) ติดมาได้
export function classifySendError(error: unknown): SendOutcome {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (status === 404 || status === 410) return { outcome: "gone", code: `HTTP_${status}` };
  if (typeof status === "number") return { outcome: "transient", code: `HTTP_${status}` };
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)) return { outcome: "transient", code: `NET_${code}` };
  return { outcome: "transient", code: "SEND_ERROR" };
}

export type RowSettlement = { status: "sent" | "skipped" | "pending" | "failed"; error: string | null };

// สรุปผลของแถวแจ้งเตือนหนึ่งแถวจากผลของทุกเครื่องของผู้รับ
//   - สำเร็จที่เครื่องใดเครื่องหนึ่ง = sent
//   - ไม่สำเร็จเลยและมีเครื่องที่ล้มแบบชั่วคราว = กลับเป็น pending ให้รอบหน้า หรือ failed เมื่อใช้โควตาครบ
//     (attempts คือจำนวนครั้งที่ลองรวมครั้งนี้ ฐานข้อมูลนับให้ตอนจองแถว)
//   - ทุกเครื่องหมดอายุ = skipped (ไม่มีที่ให้ส่งแล้ว)
export function settleRow(results: SendOutcome[], attempts: number, maxAttempts: number): RowSettlement {
  if (results.some((result) => result.outcome === "sent")) return { status: "sent", error: null };
  const transient = results.find((result) => result.outcome === "transient");
  if (transient) {
    return { status: attempts >= maxAttempts ? "failed" : "pending", error: transient.code };
  }
  return { status: "skipped", error: "SUBSCRIPTIONS_EXPIRED" };
}
