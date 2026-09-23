# Security Runbook — Phase 1

Ordered procedure for applying the Phase 1 hardening to the production Supabase
project. Everything here is done by hand: there is no Docker and no local
database, so the migration files in `supabase/migrations/` are pasted into the
Supabase SQL editor rather than pushed with the CLI.

Read the whole document before starting. Steps 1–8 must be applied in order, in
a single sitting: step 1 enables RLS and step 5 supplies the policies, so the
window between them is a window in which the application cannot read its own
data.

## How to use the verification blocks

Every step ends with a **gate**: a `DO $$ ... raise exception ... $$;` block you
paste into the SQL editor immediately after the migration it guards.

A gate that passes prints a `NOTICE` and nothing else. A gate that fails throws
a red error with an explanation. This is deliberate — the previous version of
this runbook asked you to run a `SELECT` and eyeball the result, which is a
check that is trivially skipped by a tired operator at 11pm. **Do not continue
to the next step until the gate for the current step prints its success
notice.**

Each gate has a short plain-language explanation next to it saying what it is
actually protecting you from.

## Order matters, and it changed

The role bootstrap (step 4) now runs **before** the RLS rewrite (step 5). It
used to be last. That ordering was a self-lockout trap: the restrictive policies
went live first, and if the doctor promotion then failed for any reason, the
database was left staff-only with no account holding role `doctor` — and no way
to fix it from the application.

## What this fixes

| Before | After |
| --- | --- |
| Every RLS policy was `USING (true) WITH CHECK (true)` for role `authenticated`. Any patient signed in with a phone OTP could read and write every other patient's clinical record. | Staff get full access via `is_staff()`. A patient can read only the rows tied to their own `current_patient_id()`, and cannot write clinical tables at all. |
| A patient could `UPDATE` their own `profiles.role` to `'doctor'` and walk into the clinical dashboards. | `profiles` is read-own / read-all-for-staff. A trigger rejects any role change made by a non-staff caller. |
| `DoctorProtectedRoute` only checked that *a* session existed, so a patient session rendered the full doctor dashboard. | The route requires `profiles.role` to be `doctor` or `admin`. |
| `get_patient_id_by_phone()` was executable by `anon` with no pinned `search_path` — a phone enumeration oracle. | Grants revoked from `anon` and `authenticated`, `search_path` pinned. No application code calls it any more. |
| The `notify-appointment` edge function accepted any caller and logged the full Twilio response, including phone numbers and message bodies. | A shared-secret header is required (401 otherwise, constant-time compare). Only status codes and appointment ids are logged. |
| WhatsApp messages named the treatment. | The service name is gone from every message body. |
| Anonymous booking was broken (`patients` / `appointments` had no `anon` policy). | Booking goes through `request_appointment()`, a `SECURITY DEFINER` RPC that validates the slot and the service itself. |
| Two concurrent bookings could both pass the "is this slot free?" check and both insert — the slot was double-booked. | Every booking path takes a clinic-wide `pg_advisory_xact_lock()` before the check, so check-and-insert is one critical section. |
| The pending-request cap was skipped entirely for a phone with no record, so a script with a fresh fabricated phone per call could create unlimited patients and unlimited pending appointments — each holding a calendar slot and firing a billable WhatsApp send. | The per-patient cap applies to new phones too, plus two clinic-wide abuse ceilings (new patients per hour, total pending). |

## Before you start

Have ready:

1. **The doctor's login email** — the address used on the `/doctor` screen.
2. **A fresh webhook secret.** Generate one and keep it somewhere you can paste
   it twice:
   ```bash
   openssl rand -hex 32
   ```
3. **Your project ref** — the subdomain of your project URL, e.g. the
   `abcdefghijklmnop` in `https://abcdefghijklmnop.supabase.co`.

---

## Step 1 — Baseline schema

Paste `supabase/migrations/20260922180000_baseline_schema.sql`.

Every statement is `IF NOT EXISTS`, so against the existing database this only
creates missing indexes and enables RLS. Nothing is dropped.

> After this step RLS is on and the old policies are still in place. The app
> keeps working. Do not stop here.

### Gate 1 — every managed table exists and has RLS on

*If a table is missing, a later migration's `CREATE POLICY` fails halfway
through and you end up with a partially hardened database. If RLS is off on a
table, the policies written in step 5 are never consulted and that table stays
world-readable to any authenticated session.*

```sql
do $$
declare
  managed text[] := array[
    'patients', 'profiles', 'services', 'inventory', 'appointments',
    'blocked_slots', 'patient_files', 'prescriptions', 'clinical_notes',
    'clinic_settings'
  ];
  t       text;
  v_on    boolean;
begin
  foreach t in array managed loop
    select c.relrowsecurity
      into v_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t;

    if v_on is null then
      raise exception 'Table public.% does not exist. Migration 01 did not apply cleanly.', t
        using errcode = 'P0001';
    end if;

    if not v_on then
      raise exception 'RLS is NOT enabled on public.%. Its policies would never be enforced.', t
        using errcode = 'P0001';
    end if;
  end loop;

  if not exists (select 1 from storage.buckets where id = 'clinical_records') then
    raise exception 'Bucket clinical_records is missing.' using errcode = 'P0001';
  end if;

  raise notice 'Gate 1 PASSED: % tables present with RLS enabled, bucket present.', array_length(managed, 1);
end $$;
```

## Step 2 — Authorization helpers

Paste `supabase/migrations/20260922180100_role_helpers.sql`.

Creates `is_staff()`, `current_patient_id()` and the phone normalization
helpers.

### Gate 2 — the helpers exist, are `SECURITY DEFINER`, and normalize correctly

*`is_staff()` must be `SECURITY DEFINER` or the policies on `profiles` recurse
into themselves. And if the two phone spellings below do not collapse to the
same value, `current_patient_id()` returns NULL for everyone and every patient
gets an empty portal the moment step 5 lands.*

```sql
do $$
declare
  v_a text := public.normalize_phone('+52 55 1234 5678');
  v_b text := public.normalize_phone('5215512345678');
begin
  if v_a is distinct from '525512345678' then
    raise exception 'normalize_phone(''+52 55 1234 5678'') returned %, expected 525512345678.', coalesce(v_a, 'NULL')
      using errcode = 'P0001';
  end if;

  if v_b is distinct from v_a then
    raise exception 'normalize_phone does not collapse the legacy 521 form: % vs %.', v_b, v_a
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_staff' and p.prosecdef
  ) then
    raise exception 'public.is_staff() is missing or is not SECURITY DEFINER (the profiles policies would recurse).'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_patient_id' and p.prosecdef
  ) then
    raise exception 'public.current_patient_id() is missing or is not SECURITY DEFINER.'
      using errcode = 'P0001';
  end if;

  raise notice 'Gate 2 PASSED: helpers installed, phone normalization agrees.';
end $$;
```

## Step 3 — Phone normalization audit  ⛔ HARD GATE

Paste `supabase/migrations/audit/phone_normalization_check.sql`.

This file is **read-only** and is **not** part of the numbered migration chain.
It runs `normalize_phone()` over the entire `patients` table and lists every row
whose normalized form is not `^52\d{10}$`.

*Why here: `normalize_phone` only special-cases the exactly-13-digit `521…`
shape. Anything else — a missing country code, a `+1` number, a typo — passes
through as raw digits and will never equal the Auth phone claim. Today that is
harmless, because the permissive policies are still live. After step 5 it is a
patient who signs in successfully and sees an **empty portal with no error at
all**. This is the last moment at which that is cheap to find.*

**You must get zero rows from query 2, or consciously accept the rows it
lists.** The `DO` block at the end of the file is the gate; it throws if there
are more offending rows than you have declared acceptable.

To accept known-bad rows, set `v_accept_known_bad` in that block to the exact
count and record the decision here:

| Date | Who accepted | Rows accepted | Why |
| --- | --- | --- | --- |
| | | | |

**Do not proceed to step 5 with an unrun or failing audit.**

## Step 4 — Role bootstrap  ⚠️ PLACEHOLDER #1

Open `supabase/migrations/20260922180200_bootstrap_roles.sql` and replace:

```
'REPLACE_WITH_DOCTOR_EMAIL'
```

with the doctor's real login email, e.g. `'dra.carmen@clinicatorres.mx'`. Keep
the single quotes.

> The file **raises and aborts** if you leave the placeholder in. That is
> intentional. It used to print a notice and continue, which meant a forgotten
> edit produced a green-looking run and a clinic with no doctor.

Then paste the file. It installs the `on_auth_user_created` trigger (every new
signup gets a `profiles` row with role `'patient'`), backfills profiles for
existing users, and promotes the doctor.

### Gate 4 — exactly one staff account, and it is the right one

*This is the gate that protects you from the self-lockout. Step 5 makes every
clinical table staff-only. If no profile holds `doctor` or `admin` when those
policies land, nobody can reach the clinic's own data and the only way back is
the SQL editor.*

The migration file already asserts that at least one staff row exists. Run this
afterwards to confirm it is the account you meant:

```sql
do $$
declare
  v_expected_email text := 'REPLACE_WITH_DOCTOR_EMAIL';  -- same address as above
  v_staff          integer;
  v_matches        integer;
  v_orphans        integer;
begin
  if v_expected_email = 'REPLACE_WITH_DOCTOR_EMAIL' then
    raise exception 'Edit v_expected_email in this gate before running it.'
      using errcode = 'P0001';
  end if;

  select count(*) into v_staff
  from public.profiles where role in ('doctor', 'admin');

  select count(*) into v_matches
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role in ('doctor', 'admin')
    and lower(u.email) = lower(v_expected_email);

  select count(*) into v_orphans
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null;

  if v_matches = 0 then
    raise exception 'No staff profile for %. The doctor would be bounced to /dashboard. Do NOT apply step 5.', v_expected_email
      using errcode = 'P0001';
  end if;

  if v_orphans > 0 then
    raise exception '% auth user(s) have no profiles row. is_staff() cannot evaluate for them.', v_orphans
      using errcode = 'P0001';
  end if;

  if v_staff > 1 then
    raise notice 'WARNING: % staff accounts exist, not 1. Confirm every one of them is intended:', v_staff;
  end if;

  raise notice 'Gate 4 PASSED: % is staff, no orphaned auth users.', v_expected_email;
end $$;
```

If that notice warns about more than one staff account, list them and check:

```sql
select u.email, p.role
from public.profiles p
join auth.users u on u.id = p.id
where p.role in ('doctor', 'admin');
```

## Step 5 — RLS rewrite

Paste `supabase/migrations/20260922180300_rls_policies.sql`.

This drops every existing policy on the ten managed tables (including the
`"Acceso total a usuarios autenticados"` ones) plus the `clinical_records`
policies on `storage.objects`, then creates the least-privilege replacements.

### Gate 5 — no permissive policy survived, and the escalation trigger is live

*A single leftover `USING (true)` policy on `patients` re-opens the entire
breach this phase exists to close — RLS is a union of policies, so the most
permissive one wins. The second half checks the trigger that stops a patient
from writing `role = 'doctor'` onto their own profile.*

```sql
do $$
declare
  r        record;
  v_leaks  text := '';
  v_count  integer := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'patients', 'profiles', 'services', 'inventory', 'appointments',
        'blocked_slots', 'patient_files', 'prescriptions', 'clinical_notes',
        'clinic_settings'
      )
      and policyname <> 'services_select_active_public'
      and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true')
  loop
    v_count := v_count + 1;
    v_leaks := v_leaks || format('%s.%s  ', r.tablename, r.policyname);
  end loop;

  if v_count > 0 then
    raise exception 'Permissive policy still present (% found): %', v_count, v_leaks
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and t.tgname = 'profiles_block_role_escalation' and not t.tgisinternal
  ) then
    raise exception 'profiles_block_role_escalation trigger is missing: role escalation is unblocked.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT'
  ) then
    raise exception 'profiles has a client INSERT policy. Rows must only come from the on_auth_user_created trigger.'
      using errcode = 'P0001';
  end if;

  raise notice 'Gate 5 PASSED: no permissive policy, escalation trigger installed.';
end $$;
```

> **Note on the escalation trigger.** It enforces only when
> `current_setting('request.jwt.claims', true)` is present — that is, when the
> statement arrives through PostgREST as a real end-user request. Statements run
> from the SQL editor, from a migration or from psql carry no request context
> and are let through, because those callers are already database owners who
> could drop the trigger outright. It is *not* keyed on `auth.uid() is null`,
> because `anon` also has a null uid and that test would wave through exactly
> the caller the trigger exists to stop. The post-deploy check below verifies
> that a real patient session is still refused.

## Step 6 — Harden legacy objects

Paste `supabase/migrations/20260922180400_harden_legacy.sql`.

Revokes the grants on `get_patient_id_by_phone` and installs the trigger that
derives `appointments.updated_by` server-side.

### Gate 6 — the enumeration oracle is closed

*While `anon` can execute `get_patient_id_by_phone`, anyone holding the public
anon key can probe arbitrary phone numbers and learn which ones belong to a
patient of this clinic. And if `updated_by` is still client-supplied, a
cancellation can be made to look like it came from the doctor.*

```sql
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_patient_id_by_phone'
  ) then
    if has_function_privilege('anon', 'public.get_patient_id_by_phone(text)', 'execute') then
      raise exception 'anon can still execute get_patient_id_by_phone: the phone enumeration oracle is open.'
        using errcode = 'P0001';
    end if;
    if has_function_privilege('authenticated', 'public.get_patient_id_by_phone(text)', 'execute') then
      raise exception 'authenticated can still execute get_patient_id_by_phone.'
        using errcode = 'P0001';
    end if;
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'appointments'
      and t.tgname = 'appointments_set_updated_by' and not t.tgisinternal
  ) then
    raise exception 'appointments_set_updated_by trigger missing: updated_by is still client-controlled.'
      using errcode = 'P0001';
  end if;

  raise notice 'Gate 6 PASSED: legacy function locked down, updated_by derived server-side.';
end $$;
```

## Step 7 — Booking RPCs

Paste `supabase/migrations/20260922180500_booking_rpcs.sql`.

This is also where the anti-spam ceilings live. See **Anti-spam limits** below
before you change any of the numbers.

### Gate 7 — grants are exactly right and the race is closed

*`request_my_appointment` reachable by `anon` would let an unauthenticated
caller book as somebody else. `get_availability` unreachable by `anon` breaks
the public booking screen. And without the advisory lock, two people clicking
the same slot at the same moment both get it.*

```sql
do $$
declare
  v_src text;
begin
  if not has_function_privilege('anon', 'public.get_availability(timestamptz,timestamptz)', 'execute') then
    raise exception 'anon cannot execute get_availability: the public booking calendar will not render.'
      using errcode = 'P0001';
  end if;

  if not has_function_privilege('anon', 'public.get_clinic_schedule()', 'execute') then
    raise exception 'anon cannot execute get_clinic_schedule: the public booking screen has no opening hours.'
      using errcode = 'P0001';
  end if;

  if not has_function_privilege(
       'anon',
       'public.request_appointment(text,text,text,text,uuid,timestamptz,text,text)',
       'execute') then
    raise exception 'anon cannot execute request_appointment: anonymous booking is broken.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.request_my_appointment(uuid,timestamptz)', 'execute') then
    raise exception 'anon CAN execute request_my_appointment. It must be authenticated-only.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.cancel_my_appointment(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.reschedule_my_appointment(uuid,timestamptz)', 'execute') then
    raise exception 'anon can cancel or reschedule appointments. Both must be authenticated-only.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.assert_slot_free(timestamptz,integer,uuid)', 'execute')
     or has_function_privilege('anon', 'public.service_duration_or_fail(uuid)', 'execute') then
    raise exception 'internal helpers are exposed to anon.'
      using errcode = 'P0001';
  end if;

  -- The advisory lock must be taken by all three booking paths.
  foreach v_src in array array[
    'request_appointment', 'request_my_appointment', 'reschedule_my_appointment'
  ] loop
    if coalesce((select prosrc from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = v_src
                 limit 1), '') not like '%pg_advisory_xact_lock%' then
      raise exception 'public.% does not take the booking advisory lock: the double-booking race is open.', v_src
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Gate 7 PASSED: grants correct, all three booking paths serialized.';
end $$;
```

### Gate 7b — the anti-spam ceilings are installed and sane

*A ceiling set below current usage would refuse real patients. A ceiling that
does not exist at all leaves the anonymous endpoint unlimited.*

```sql
do $$
declare
  v_new_per_hour  integer := public.booking_limit_new_patients_per_hour();
  v_pending_cap   integer := public.booking_limit_pending_clinic_wide();
  v_per_patient   integer := public.booking_limit_pending_per_patient();
  v_pending_now   integer;
begin
  select count(*) into v_pending_now
  from public.appointments where status = 'pending';

  if v_pending_now >= v_pending_cap then
    raise exception 'There are already % pending appointments, at or above the cap of %. Online booking is refusing everyone right now. Triage the backlog or raise booking_limit_pending_clinic_wide().',
      v_pending_now, v_pending_cap
      using errcode = 'P0001';
  end if;

  raise notice 'Gate 7b PASSED: new patients/hour=%, pending cap=% (currently %), per-patient pending=%.',
    v_new_per_hour, v_pending_cap, v_pending_now, v_per_patient;
end $$;
```

## Step 8 — WhatsApp webhook secret  ⚠️ PLACEHOLDER #2 and #3

### 8a. Set the secret on the edge function

In the Supabase dashboard: **Edge Functions → notify-appointment → Secrets**,
or with the CLI:

```bash
supabase secrets set WEBHOOK_SECRET=<the value from openssl rand -hex 32>
```

### 8b. Deploy the updated function

```bash
supabase functions deploy notify-appointment --no-verify-jwt
```

`--no-verify-jwt` is correct here: the caller is the database trigger, not a
signed-in user. The shared secret is now what authenticates it.

### 8c. Recreate the trigger

Open `supabase/migrations/20260922180600_whatsapp_webhook_secret.sql` and
replace **both** placeholders:

- `REPLACE_WITH_PROJECT_REF` → your project ref
- `REPLACE_WITH_WEBHOOK_SECRET` → the *same* value you set in 8a

Then paste the file.

If the notification is wired as a **Database Webhook** in the dashboard rather
than as this trigger, add the header there instead: **Database → Webhooks →
notify-appointment → HTTP Headers**, add `x-webhook-secret` with the same value.

### Gate 8 — no placeholder survived

*A trigger still containing `REPLACE_WITH_…` posts to a nonexistent host with a
literal placeholder secret. Every notification silently fails and the edge
function rejects the ones that do arrive.*

```sql
do $$
declare
  v_def text;
begin
  select pg_get_triggerdef(t.oid)
    into v_def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'appointments'
    and t.tgname = 'whatsapp_notifications' and not t.tgisinternal;

  if v_def is null then
    raise notice 'Gate 8 SKIPPED: no whatsapp_notifications trigger. This is correct ONLY if the notification is wired as a dashboard Database Webhook instead - go check the x-webhook-secret header there.';
    return;
  end if;

  if v_def like '%REPLACE_WITH_%' then
    raise exception 'The whatsapp_notifications trigger still contains a REPLACE_WITH_ placeholder. Notifications will not be delivered.'
      using errcode = 'P0001';
  end if;

  if v_def not like '%x-webhook-secret%' then
    raise exception 'The whatsapp_notifications trigger does not send the x-webhook-secret header. The edge function will return 401 for every notification.'
      using errcode = 'P0001';
  end if;

  raise notice 'Gate 8 PASSED: trigger recreated with a real project ref and secret header.';
end $$;
```

### 8d. Verify the 401

From any terminal, call the function without the secret:

```bash
curl -i -X POST \
  "https://<PROJECT_REF>.supabase.co/functions/v1/notify-appointment" \
  -H "Content-Type: application/json" \
  -d '{"type":"INSERT","record":{"id":"00000000-0000-0000-0000-000000000000","patient_id":"00000000-0000-0000-0000-000000000000","start_time":"2026-01-01T10:00:00Z","status":"pending"}}'
```

Expected:

```
HTTP/2 401
{"error":"Unauthorized."}
```

Then repeat with `-H "x-webhook-secret: <the secret>"`. You should get a
non-401 response (422 for the fake patient id above — that is the function
getting past authentication and failing to find the record, which is what you
want to see).

A wrong-but-present secret must also return 401.

---

## Anti-spam limits

Three tunable numbers live at the top of
`supabase/migrations/20260922180500_booking_rpcs.sql`. They exist because
`request_appointment` is granted to `anon`, and before Phase 1 the per-phone
pending cap was skipped entirely when the phone had no record — so a script
sending a fresh fabricated phone on every call could create unlimited patient
rows and unlimited pending appointments, each one holding a real calendar slot
and firing a billable WhatsApp send.

Supabase's CAPTCHA protection covers the **auth** endpoints only, not arbitrary
RPCs, so it does not help here.

| Constant | Default | What it caps |
| --- | --- | --- |
| `booking_limit_new_patients_per_hour()` | **30** | New `patients` rows created clinic-wide in a rolling 60 minutes. |
| `booking_limit_pending_clinic_wide()` | **120** | Total appointments sitting in status `pending`, clinic-wide. |
| `booking_limit_pending_per_patient()` | **3** | Simultaneous pending requests for one patient record. Now applied to new phones too. |

This practice sees roughly **100 patients per month** (3–4 bookings a day), so
the first two numbers sit about an order of magnitude above normal traffic.
**They are an abuse ceiling, not a business rule.** If one ever fires for a real
patient, something is wrong — either the clinic's volume has changed
fundamentally, or somebody is scripting the booking endpoint. Check before you
raise them.

Each ceiling raises a Spanish message telling the visitor to phone the clinic.
Nothing here deletes, expires or rewrites existing data, so raising a number
takes effect immediately and completely undoes its effect. To change one, edit
the `select <n>` in the corresponding function and re-run just that statement.

The `> 3` off-by-one in the old per-patient check (which allowed a 4th pending
request before refusing the 5th) is fixed: the comparison is now `>= limit`, so
the limit is the maximum number allowed.

---

## Post-deploy verification

### Anonymous booking works again

Open the site logged out and book an appointment end to end. The slot list must
render (that is `get_availability` + `get_clinic_schedule` working for `anon`)
and the booking must land as a `pending` appointment.

### Anonymous access is actually closed

With the anon key from `.env`:

```bash
curl "https://<PROJECT_REF>.supabase.co/rest/v1/patients?select=*" \
  -H "apikey: <ANON_KEY>"
# expected: []  (RLS returns no rows, not an error)

curl "https://<PROJECT_REF>.supabase.co/rest/v1/blocked_slots?select=*" \
  -H "apikey: <ANON_KEY>"
# expected: []
```

### `anon` cannot touch a role

```bash
curl -i -X PATCH "https://<PROJECT_REF>.supabase.co/rest/v1/profiles?id=eq.<ANY_USER_ID>" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"role":"doctor"}'
# expected: no row updated (anon has no UPDATE policy on profiles at all)
```

### A patient cannot escalate or snoop

Sign in through the patient portal with a real phone, grab the access token from
the browser devtools (Application → Local Storage → `sb-*-auth-token`), then:

```bash
# must return ONLY that patient's own row
curl "https://<PROJECT_REF>.supabase.co/rest/v1/patients?select=id,first_name" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <PATIENT_JWT>"

# must fail or change nothing
curl -X PATCH "https://<PROJECT_REF>.supabase.co/rest/v1/profiles?id=eq.<THEIR_USER_ID>" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <PATIENT_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"role":"doctor"}'
# expected: 403 / "No tienes permisos para modificar el rol de una cuenta."
```

**Both of those must be run.** They are what proves that relaxing the escalation
trigger for no-request-context callers did not relax it for real users: a
PostgREST request always carries `request.jwt.claims`, including an anonymous
one, so both of these still hit the check.

Also confirm `clinical_notes` and `prescriptions` return only that patient's
rows, and that browsing to `/doctor/dashboard` as that patient redirects to
`/dashboard` with the Spanish "sin acceso" toast.

### The doctor still has everything

Sign in as the doctor and confirm the calendar, inbox, patients tab, inventory,
catalog and clinical records all load and save.

### The patient portal is not empty

For at least one real patient, sign in and confirm the dashboard shows their
appointments. An empty portal here means `current_patient_id()` returned NULL —
go back to step 3.

---

## Known behavior changes

1. **Patients can no longer upload files.** `storage.objects` grants patients
   `SELECT` on their own folder only. The upload control in the patient
   dashboard will now fail. If the doctor wants patient uploads back, uncomment
   `clinical_records_patient_upload_own` at the bottom of
   `20260922180300_rls_policies.sql` and re-run that policy block.
2. **The public "Agendar Cita" button no longer recognizes returning patients.**
   It goes straight to the registration form. The server still matches the
   record by phone inside `request_appointment`, so no duplicate file is
   created — but the visitor re-types their name. This is the price of not
   leaking whether a number is registered. Returning patients should use
   "Entrar a mi Portal".
3. **Pending appointments now block their slot.** The old client-side
   calculation only treated `confirmed` appointments as busy, so two people
   could request the same slot. `get_availability` counts everything that is not
   `cancelled` or `rejected`.
4. **`updated_by` is ignored if sent by a client.** The trigger overwrites it.
5. **Bookings serialize.** All three booking paths take one clinic-wide
   `pg_advisory_xact_lock()`, so simultaneous requests queue behind each other
   for a few milliseconds. At 3–4 bookings a day this is unobservable.
6. **A patient may hold at most 3 pending requests**, including a brand-new
   phone. The 4th is refused with a Spanish message pointing at the phone.

## Residual risks (not covered by Phase 1)

- **The abuse ceilings are clinic-wide, not per-caller.** A determined attacker
  can still burn the hourly new-patient allowance and make online registration
  unavailable to genuine visitors for the rest of that hour (booking for
  *existing* patients keeps working). That is a deliberate trade: failing closed
  costs an hour of online sign-ups, while failing open costs real calendar slots
  and real WhatsApp spend. Per-IP rate limiting belongs at the edge and is Phase
  2 work.
- **The new-patient counter uses `patients.created_at`** and cannot tell a
  booking-RPC row from one the doctor typed in the staff UI. Importing more than
  30 patients by hand inside an hour would pause public booking until the window
  rolls forward.
- **The webhook secret lives in the trigger definition**, readable by anyone
  with database owner access. The decision to keep it in plaintext, and why
  Supabase Vault was rejected for Phase 1, is documented in the header of
  `20260922180600_whatsapp_webhook_secret.sql`. Moving it into Vault is Phase 2.
- **Phone normalization is implemented twice.** `public.normalize_phone()` in
  SQL canonicalizes `+521…` down to `+52…`; `notify-appointment/index.ts` rewrites
  it back up for Twilio delivery. They are mirror images with no shared code and
  must be changed together. Both sites carry a comment pointing at the other.
- **`.vite/deps` is committed to the repository.** Harmless to security, but it
  is generated build cache and should be removed from version control and added
  to `.gitignore`.
