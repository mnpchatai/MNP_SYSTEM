import { handleSync } from "./handler.ts";

Deno.serve((request: Request) => handleSync(request, {
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  secret: Deno.env.get("LAB_SHEET_SYNC_SECRET") ?? "",
}));
