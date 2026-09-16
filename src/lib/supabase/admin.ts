import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error("Missing server-side Supabase environment variables");
  }

  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

