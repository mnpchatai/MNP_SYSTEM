import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { linkEmployeeRichMenu } from "@/lib/line";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type LineTokenResponse = { access_token?: string; id_token?: string; error?: string };
type LineProfile = { userId: string; displayName?: string; pictureUrl?: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("line_oauth_state")?.value;
  cookieStore.delete("line_oauth_state");
  cookieStore.delete("line_oauth_nonce");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${siteUrl}/profile?line=invalid-state`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${siteUrl}/login`);

  const admin = createAdminClient();
  const { data: employee } = await admin.from("employees").select("id").eq("auth_user_id", user.id).eq("is_active", true).single();
  if (!employee) return NextResponse.redirect(`${siteUrl}/profile?line=no-employee`);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${siteUrl}/api/line/callback`,
    client_id: process.env.LINE_LOGIN_CHANNEL_ID ?? "",
    client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET ?? "",
  });
  const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const tokens = await tokenResponse.json() as LineTokenResponse;
  if (!tokenResponse.ok || !tokens.access_token) return NextResponse.redirect(`${siteUrl}/profile?line=token-error`);

  const profileResponse = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  });
  if (!profileResponse.ok) return NextResponse.redirect(`${siteUrl}/profile?line=profile-error`);
  const profile = await profileResponse.json() as LineProfile;

  const menuResult = await linkEmployeeRichMenu(profile.userId);
  const richMenuId = menuResult.ok ? process.env.LINE_EMPLOYEE_RICH_MENU_ID : null;
  const { error } = await admin.from("line_accounts").upsert({
    employee_id: employee.id,
    line_user_id: profile.userId,
    display_name: profile.displayName ?? null,
    picture_url: profile.pictureUrl ?? null,
    rich_menu_id: richMenuId,
    is_verified: true,
    linked_at: new Date().toISOString(),
  }, { onConflict: "employee_id" });
  if (error) return NextResponse.redirect(`${siteUrl}/profile?line=conflict`);

  return NextResponse.redirect(`${siteUrl}/profile?line=${menuResult.ok ? "linked" : "linked-no-menu"}`);
}

