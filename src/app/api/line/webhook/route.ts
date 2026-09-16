import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { linkEmployeeRichMenu } from "@/lib/line";
import { createAdminClient } from "@/lib/supabase/admin";

type LineEvent = {
  webhookEventId?: string;
  type: string;
  source?: { userId?: string };
};

export async function POST(request: Request) {
  const secret = process.env.LINE_MESSAGING_CHANNEL_SECRET;
  const signature = request.headers.get("x-line-signature");
  const rawBody = await request.text();
  if (!secret || !signature) return new NextResponse("Missing signature", { status: 401 });

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "base64"); } catch { return new NextResponse("Invalid signature", { status: 401 }); }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody) as { events?: LineEvent[] };
  const admin = createAdminClient();
  for (const event of payload.events ?? []) {
    await admin.from("line_webhook_events").upsert({
      line_event_id: event.webhookEventId ?? null,
      event_type: event.type,
      line_user_id: event.source?.userId ?? null,
      payload: event,
      processed_at: new Date().toISOString(),
    }, { onConflict: "line_event_id", ignoreDuplicates: true });

    if (event.type === "follow" && event.source?.userId) {
      const { data } = await admin.from("line_accounts").select("id").eq("line_user_id", event.source.userId).maybeSingle();
      if (data) await linkEmployeeRichMenu(event.source.userId);
    }
  }
  return NextResponse.json({ ok: true });
}

