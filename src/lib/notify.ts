import { createAdminClient } from "@/lib/supabase/admin";

/**
 * แจ้งเตือนทางอีเมล — แทนการ push เข้า LINE
 *
 * สัญญาของฟังก์ชันเหมือน notifyEmployeeOnLine เดิมทุกอย่าง: ไม่โยน error ออกไป และคืน
 * { ok, configured } ให้ผู้เรียกตัดสินใจเอง เพราะทุกจุดที่เรียกใช้อยู่ใน Promise.allSettled
 * ของ transaction ที่สำคัญกว่า — อีเมลส่งไม่ออกต้องไม่ทำให้คำร้องล้ม
 *
 * ช่องทางส่งเลือกจาก environment variable ไม่ผูกกับผู้ให้บริการรายใดรายหนึ่งในโค้ด
 *   1. RESEND_API_KEY + NOTIFY_EMAIL_FROM  → ส่งผ่าน Resend API
 *   2. NOTIFY_EMAIL_WEBHOOK_URL            → POST { to, subject, text } ไปที่ปลายทางที่กำหนด
 *      (ใช้ต่อกับ Apps Script ที่ส่งอีเมลอยู่แล้วได้ โดยไม่ต้องสมัครผู้ให้บริการใหม่)
 *   3. ไม่ตั้งอะไรเลย                        → ไม่ส่ง คืน configured:false เงียบๆ
 *      เหมือนตอน LINE ไม่มี token ระบบยังทำงานครบ แค่ไม่มีอีเมลออก
 */

type SendResult = { ok: boolean; configured: boolean; status?: number; error?: string };

/** หัวเรื่อง = บรรทัดแรกของข้อความ ซึ่งเป็นบรรทัดที่สรุปเรื่องอยู่แล้วในทุกจุดที่เรียก */
function subjectFrom(message: string) {
  const firstLine = message.split("\n")[0].trim();
  return (firstLine || "แจ้งเตือนระบบคำร้อง").slice(0, 200);
}

async function sendViaResend(to: string, subject: string, text: string): Promise<SendResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.NOTIFY_EMAIL_FROM, to: [to], subject, text }),
      cache: "no-store",
    });
    return { ok: response.ok, configured: true, status: response.status };
  } catch (error) {
    return { ok: false, configured: true, error: String(error) };
  }
}

async function sendViaWebhook(to: string, subject: string, text: string): Promise<SendResult> {
  try {
    const response = await fetch(String(process.env.NOTIFY_EMAIL_WEBHOOK_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, text }),
      cache: "no-store",
    });
    return { ok: response.ok, configured: true, status: response.status };
  } catch (error) {
    return { ok: false, configured: true, error: String(error) };
  }
}

export async function sendNotificationEmail(to: string, message: string): Promise<SendResult> {
  const subject = subjectFrom(message);
  if (process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_FROM) {
    return sendViaResend(to, subject, message);
  }
  if (process.env.NOTIFY_EMAIL_WEBHOOK_URL) {
    return sendViaWebhook(to, subject, message);
  }
  return { ok: false, configured: false };
}

/** ส่งถึงพนักงานหนึ่งคนด้วยอีเมลใน Employee Master — บัญชีที่ปิดใช้งานแล้วไม่ส่ง */
export async function notifyEmployeeByEmail(employeeId: string, message: string): Promise<SendResult> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("employees")
    .select("email, is_active")
    .eq("id", employeeId)
    .maybeSingle();
  if (!data?.is_active || !data.email) return { ok: false, configured: true };
  return sendNotificationEmail(data.email, message);
}
