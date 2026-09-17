-- Explicitly remove anonymous invocation. The functions also validate auth.uid(),
-- but keeping them absent from the anon API surface is defense in depth and
-- satisfies the Supabase security advisor.
revoke all on function public.app_create_request(uuid, text, text, text, jsonb) from anon;
revoke all on function public.app_approval_decision(uuid, text, text) from anon;
revoke all on function public.app_update_request_status(uuid, text) from anon;
