-- =============================================================================
-- 07 - WhatsApp notification trigger with an authenticated caller
-- =============================================================================
-- The existing whatsapp_notifications trigger posted to the notify-appointment
-- edge function with only a Content-type header. The function is deployed
-- without JWT verification (it is called by the database, not by a user), which
-- means anyone who knew the URL could POST a forged payload and make the clinic
-- send arbitrary WhatsApp messages to any number they chose.
--
-- This recreates the trigger with a shared secret header. The edge function
-- compares it against its WEBHOOK_SECRET env var and returns 401 on a mismatch.
--
-- >>> ACTION REQUIRED - two placeholders <<<
--   REPLACE_WITH_PROJECT_REF   your Supabase project ref (the subdomain in the
--                              project URL, e.g. abcdefghijklmnop)
--   REPLACE_WITH_WEBHOOK_SECRET  a freshly generated random string. The SAME
--                              value must be set as the WEBHOOK_SECRET secret
--                              on the edge function. See docs/security-runbook.md.
--
-- -----------------------------------------------------------------------------
-- DECISION (for the compliance audit): the secret stays in plaintext in the
-- trigger definition. Supabase Vault was considered and rejected for Phase 1.
-- -----------------------------------------------------------------------------
-- Where it is exposed: pg_get_triggerdef / pg_proc, readable by the database
-- owner and by service_role. Not readable by anon, by authenticated, or through
-- PostgREST, because neither pg_catalog nor supabase_functions is in the
-- exposed schema list.
--
-- Why that is acceptable: the audience that can read it is exactly the audience
-- that can already read the SUPABASE_SERVICE_ROLE_KEY, and the service role key
-- is strictly more powerful than this webhook secret - it grants full
-- read/write on every clinical table, whereas this secret only lets its holder
-- ask the edge function to send a notification for an appointment that already
-- exists. Moving it to Vault would therefore not shrink the set of principals
-- who can compromise the system; it would only add a decryption hop.
--
-- Why Vault is not free here: supabase_functions.http_request() takes its
-- headers as a literal string baked into the trigger definition. There is no
-- expression evaluation at fire time, so using Vault would mean replacing this
-- trigger with a PL/pgSQL wrapper function that reads
-- vault.decrypted_secrets and calls net.http_post() itself - more moving parts,
-- a new pg_net dependency, and a SECURITY DEFINER function whose whole purpose
-- is to hand out the secret. That is a Phase 2 change, not a hardening quick
-- win, and it is tracked as a residual risk in docs/security-runbook.md.
--
-- Operational rule: this value is single-purpose. Do not reuse it anywhere
-- else, and rotate it (both here and in the edge function secret) if anyone
-- with database owner access leaves the project.
-- =============================================================================

drop trigger if exists whatsapp_notifications on public.appointments;

create trigger whatsapp_notifications
  after insert or update on public.appointments
  for each row
  execute function supabase_functions.http_request(
    'https://REPLACE_WITH_PROJECT_REF.supabase.co/functions/v1/notify-appointment',
    'POST',
    '{"Content-type":"application/json","x-webhook-secret":"REPLACE_WITH_WEBHOOK_SECRET"}',
    '{}',
    '5000'
  );
