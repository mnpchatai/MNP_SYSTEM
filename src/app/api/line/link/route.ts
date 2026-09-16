import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!channelId || !siteUrl) return NextResponse.redirect(new URL("/profile?line=not-configured", request.url));

  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" };
  cookieStore.set("line_oauth_state", state, cookieOptions);
  cookieStore.set("line_oauth_nonce", nonce, cookieOptions);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: `${siteUrl}/api/line/callback`,
    state,
    scope: "profile openid",
    nonce,
    bot_prompt: "aggressive",
  });
  return NextResponse.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
}

