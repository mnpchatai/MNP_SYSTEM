import { createAdminClient } from "@/lib/supabase/admin";

const LINE_API = "https://api.line.me";

async function messagingRequest(path: string, init: RequestInit = {}) {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, configured: false };
  const response = await fetch(`${LINE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  return { ok: response.ok, configured: true, status: response.status };
}

export async function linkEmployeeRichMenu(lineUserId: string) {
  const richMenuId = process.env.LINE_EMPLOYEE_RICH_MENU_ID;
  if (!richMenuId) return { ok: false, configured: false };
  return messagingRequest(`/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(richMenuId)}`, { method: "POST" });
}

export async function unlinkPerUserRichMenu(lineUserId: string) {
  return messagingRequest(`/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu`, { method: "DELETE" });
}

export async function pushLineMessage(lineUserId: string, message: string) {
  return messagingRequest("/v2/bot/message/push", {
    method: "POST",
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text: message.slice(0, 5000) }],
    }),
  });
}

export async function notifyEmployeeOnLine(employeeId: string, message: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("line_accounts")
    .select("line_user_id")
    .eq("employee_id", employeeId)
    .eq("is_verified", true)
    .maybeSingle();
  if (!data) return { ok: false, configured: true };
  return pushLineMessage(data.line_user_id, message);
}

