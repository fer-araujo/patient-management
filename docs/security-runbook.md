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

---

# Phase 2 — Mexican legal compliance

Applies the consent record, audit trail, clinical-note integrity, ARCO rights
and upload limits described in `docs/compliance.md`. Same rules as Phase 1:
paste each file into the Supabase SQL editor **in order**, and do not continue
until it prints its success `NOTICE`.

Every Phase 2 migration ends with its own `DO $$ ... raise exception ... $$`
assertion, so **each migration file is its own gate**: if it runs to the end
and prints `Migration NN PASSED`, the gate passed. The extra checks in Gate
P2-6 exercise behavior that a catalog query cannot prove.

**No SQL placeholders in Phase 2.** None of the five files needs editing
before pasting. The placeholders that remain are in the privacy notice text
(`src/components/legal/PrivacyPolicyContent.tsx`: clinic address, contact
email, contact phone, Supabase region) and must be filled before production —
see the checklist in `docs/compliance.md`.

## Before you start

1. Phase 1 is applied and its post-deploy checks pass.
2. A frontend build from this branch is ready to deploy. **Step P2-2 changes
   the signature of `request_appointment`**: the moment it runs, the frontend
   currently deployed can no longer book anonymously ("function not found")
   until the new build is live. Run P2-2 and deploy the frontend together.
3. Have a doctor session and a patient session available for Gate P2-6.

> **Phase 1 Gate 7 is superseded.** It checks
> `request_appointment(text,text,text,text,uuid,timestamptz,text,text)`, which
> step P2-2 deliberately drops. If you ever re-run Gate 7, change that
> signature to the 10-argument form
> `(text,text,text,text,uuid,timestamptz,text,text,text,text)`.

## Step P2-1 — Audit trail

Paste `supabase/migrations/20260922180700_audit_log.sql`.

Expected: `Migration 08 PASSED: audit_log is append-only, staff-readable, and wired to 5 tables.`

*Protects against:* an audit log that staff, or anyone holding an API key,
could edit or erase; and clinical tables changing without leaving a trace.

## Step P2-2 — Consent record ⚠️ deploy the frontend now

Paste `supabase/migrations/20260922180800_consents.sql`, then deploy the new
frontend immediately.

Expected: `Migration 09 PASSED: consents table installed, request_appointment requires notice version 2026-09-23.`

*Protects against:* the old consent-less overload of `request_appointment`
staying callable by `anon`, which would let any script create a clinical record
without the patient ever accepting the privacy notice.

> The server accepts only the version returned by
> `public.privacy_notice_version()`, which must equal `PRIVACY_NOTICE_VERSION`
> in `src/lib/legal/privacyNotice.ts`. When the notice text changes, bump both
> in the same release.

## Step P2-3 — Clinical note integrity

Paste `supabase/migrations/20260922180900_clinical_integrity.sql`.

Expected: `Migration 10 PASSED: notes and prescriptions freeze on finalization, addenda are append-only.`

*Protects against:* a finalized note being silently rewritten. NOM-004
num. 5.11 forbids alterations; corrections must be addenda.

### Step P2-3b — (optional, IRREVERSIBLE) finalize historical notes

Notes written before Phase 2 are **not** frozen. The block below freezes every
note and prescription whose appointment is already `completed`. **It cannot be
undone** — afterwards those notes accept only addenda. Record the decision:

| Date | Who decided | Rows finalized |
| --- | --- | --- |
| | | |

```sql
do $$
declare
  v_notes integer;
  v_rx    integer;
begin
  update public.clinical_notes cn
     set finalized_at = now()
   where cn.finalized_at is null
     and exists (select 1 from public.appointments a
                 where a.id = cn.appointment_id and a.status = 'completed');
  get diagnostics v_notes = row_count;

  update public.prescriptions pr
     set finalized_at = now()
   where pr.finalized_at is null
     and exists (select 1 from public.appointments a
                 where a.id = pr.appointment_id and a.status = 'completed');
  get diagnostics v_rx = row_count;

  raise notice 'Back-fill done: % notes and % prescriptions finalized.', v_notes, v_rx;
end $$;
```

## Step P2-4 — ARCO rights

Paste `supabase/migrations/20260922181000_arco_rights.sql`.

Expected: `Migration 11 PASSED: ARCO RPCs installed, retention = 5 years.`

*Protects against:* ARCO requests being writable directly through the API, and
anonymization inside the NOM-004 retention window.

## Step P2-5 — Upload limits

Paste `supabase/migrations/20260922181100_storage_limits.sql`.

Expected: `Migration 12 PASSED: clinical_records limited to 10 MB and PDF/JPEG/PNG/HEIC.`

*Protects against:* arbitrary file types (HTML, executables) and very large
files landing in the clinical bucket.

## Gate P2-6 — behavior checks (after all five steps)

### P2-6a — the audit log really refuses deletes

*The migration checks that the trigger exists; this proves it fires. If the
delete ever succeeded, the final `raise` aborts the whole block, so the row is
rolled back either way.*

```sql
do $$
declare
  v_id      bigint;
  v_blocked boolean := false;
begin
  select id into v_id from public.audit_log order by id desc limit 1;
  if v_id is null then
    raise notice 'Gate P2-6a SKIPPED: audit_log is empty. Book one test appointment and re-run.';
    return;
  end if;

  begin
    delete from public.audit_log where id = v_id;
  exception when others then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAILED: an audit_log row could be deleted. The append-only trigger is not firing.'
      using errcode = 'P0001';
  end if;

  raise notice 'Gate P2-6a PASSED: audit_log refused DELETE.';
end $$;
```

### P2-6b — a finalized note cannot be edited

Run after the doctor has finished one consultation with the new frontend (or
after step P2-3b). Same rollback guarantee as P2-6a.

```sql
do $$
declare
  v_id      uuid;
  v_blocked boolean := false;
begin
  select id into v_id from public.clinical_notes where finalized_at is not null limit 1;
  if v_id is null then
    raise notice 'Gate P2-6b SKIPPED: no finalized note yet. Finish one consultation and re-run.';
    return;
  end if;

  begin
    update public.clinical_notes set plan = coalesce(plan, '') || ' ' where id = v_id;
  exception when others then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAILED: finalized note % was editable.', v_id using errcode = 'P0001';
  end if;

  raise notice 'Gate P2-6b PASSED: finalized note % refused the edit.', v_id;
end $$;
```

### P2-6c — consent is recorded with every anonymous booking

Book one appointment from the public site while logged out, then:

```sql
do $$
declare
  v_recent integer;
begin
  select count(*) into v_recent
  from public.consents
  where accepted_at > now() - interval '15 minutes'
    and version = public.privacy_notice_version();

  if v_recent = 0 then
    raise exception 'FAILED: no consent row in the last 15 minutes. Is the new frontend deployed?'
      using errcode = 'P0001';
  end if;

  raise notice 'Gate P2-6c PASSED: % recent consent row(s) with the current notice version.', v_recent;
end $$;
```

### P2-6d — manual checks in the app

1. **Doctor:** finish a consultation, then open the same patient from the
   Directorio de Pacientes. The note shows "Nota cerrada el ..." and the
   "Agregar una corrección" form. Save an addendum; it appears under the note.
2. **Doctor:** the "Recetas e Indicaciones" tab shows "Registro informativo
   del expediente. No es una receta médica oficial."
3. **Patient:** "Mis Medicamentos" shows the same notice, always at the top of the modal.
4. **Patient:** "Estudios" first explains that uploads join the record and
   cannot be deleted by the patient. A `.docx`, or any file over 10 MB, is
   refused with a Spanish message before uploading.
5. **Patient:** "Descargar mis datos" downloads a JSON file; Admin → "Bitácora"
   shows "El paciente descargó una copia de sus datos."
6. **Patient:** send a request from "Pedir un cambio sobre mis datos"; Admin →
   "Solicitudes ARCO" lists it with its due date. Resolve it; the patient sees
   the answer in the portal.
7. **Doctor:** on a cancellation request, "Anonimizar expediente" for a
   patient seen within the last 5 years is refused with the date from which it
   becomes possible.

## Phase 2 behavior changes

1. **"Finalizar Consulta" freezes the note and the prescription.** Corrections
   are addenda, added from the patient's record in the Directorio de
   Pacientes. The back arrow in the consultation screen only saves a draft and
   never finalizes (gap G4, fixed).
2. **Anonymous booking requires the current privacy notice version.** A
   browser holding an old build gets "El Aviso de Privacidad se actualizó.
   Recarga la página...".
3. **Uploads are limited** to PDF, JPEG, PNG and HEIC up to 10 MB, for staff
   too.
4. **Uploads are registered in `patient_files`**, so they appear in the audit
   trail.
5. Patient uploads are allowed: Phase 1 migration 04 already grants patients
   INSERT into their own folder. Item 1 of the Phase 1 "Known behavior
   changes" list is out of date on that point.

## Rollback notes

- Steps P2-1, P2-3, P2-4 and P2-5 only add objects; the app keeps working
  without them except for the features they back.
- Step P2-2 cannot be rolled back independently of the frontend: the new
  frontend calls the 10-argument RPC. To roll back, redeploy the previous
  frontend AND re-run the `request_appointment` section of
  `20260922180500_booking_rpcs.sql`.
- Consents, addenda and audit rows are append-only by design; there is no
  supported way to remove them.

---

# Phase 3 — Verified booking

Retires anonymous booking. "Agendar Cita" now verifies the phone with an OTP
**before** anything else, and only then asks the server whether that number
already has a clinical record. Returning patients skip the registration form;
new patients register through `register_me()`, which reads the phone from the
session, never from the browser. Every booking goes through
`request_my_appointment()` and carries an optional "Motivo de la consulta".

> ⚠️ **OTP provider.** Until a paid Twilio account is configured in Supabase
> Auth, **only the Supabase test phone numbers can complete the OTP step**.
> With this phase applied, online booking therefore works end to end **only
> for those numbers**; any other visitor receives no code and cannot book.
> Configure Twilio before announcing online booking to patients, and delete
> the test numbers before production (see `docs/compliance.md`, section 8).

## Before you start

1. Phase 2 is applied and every Phase 2 gate passed.
2. A frontend build from this branch is ready to deploy. **This step drops
   `request_appointment`**: the moment it runs, the public booking page of the
   frontend currently deployed stops working ("function not found") until the
   new build is live. Run it and deploy the frontend together.
   The patient portal keeps working with an old bundle: `p_reason` defaults to
   `NULL`, so a two-argument call to `request_my_appointment` still resolves.
3. A Supabase test phone number (or a working SMS/WhatsApp provider) for the
   manual checks.

> **Phase 1 Gate 7 and Phase 2 step P2-2 are superseded.** Gate 7 checks the
> anonymous `request_appointment` and `request_my_appointment(uuid,timestamptz)`;
> this step drops the first and replaces the second with
> `request_my_appointment(uuid,timestamptz,text)`. Do not re-run Gate 7 or
> P2-6c after this step; Gate P3-1 below replaces them.

## Step P3-1 — Verified booking

Paste `supabase/migrations/20260922181200_verified_booking.sql`, then deploy
the new frontend immediately.

Expected: `Migration 13 PASSED: anonymous booking retired, verified booking RPCs installed for notice version 2026-09-23.`

The migration ends with its own `DO $$ ... raise exception ... $$` gate, which
fails the run unless:

- no function named `request_appointment` exists;
- exactly one `request_my_appointment` exists, it takes `p_reason`, takes the
  booking advisory lock and still enforces the per-patient pending cap;
- `get_my_booking_profile()`, `accept_privacy_notice(text,text)`,
  `register_me(text,text,text,text,integer,text,text)` and
  `request_my_appointment(uuid,timestamptz,text)` are executable by
  `authenticated`, NOT by `anon`, and are `SECURITY DEFINER` with a pinned
  `search_path`;
- `register_me` has no phone argument;
- the internal helpers `has_current_consent(uuid)` and
  `assert_current_notice_version(text)` are not executable through the API;
- `appointments.reason` exists and `export_my_data()` includes it.

*Protects against:* anonymous creation of patients and appointments (the
booking-spam vector); consent tied to a phone nobody proved to own (gap G1);
and the booking page acting as a "is this phone a patient?" oracle.

| RPC | Grant | What it does |
| --- | --- | --- |
| `get_my_booking_profile()` | `authenticated` | One row: `is_registered`, `first_name`, `needs_consent` for the caller's verified phone. |
| `accept_privacy_notice(p_privacy_notice_version, p_user_agent)` | `authenticated` | Records consent for a returning patient. No-op if the current version is already accepted. |
| `register_me(p_first_name, p_last_name, p_email, p_referred_by, p_dob_year, p_privacy_notice_version, p_user_agent)` | `authenticated` | Creates the caller's patient row and consent row atomically. Returns the existing id untouched if the phone already has a record. |
| `request_my_appointment(p_service_id, p_start_time, p_reason)` | `authenticated` | The only booking path. `p_reason` is optional, max 1000 characters. |

## Gate P3-2 — manual checks in the app

1. **Logged out, new number (test phone):** "Agendar Cita" → the toast says
   "Te enviamos un código de verificación." → enter the code → the
   registration form appears (no "Motivo de la consulta" on it) → service →
   date/time with "Motivo de la consulta (Opcional)" above "Confirmar Cita" →
   success. "Ir a mi Perfil" opens `/dashboard` directly.
2. **Logged out, returning number:** after the code the visitor goes straight
   to the services with "¡Hola de nuevo, …!". If that patient has no consent
   for the current notice, only the consent checkbox is shown first.
3. **Already signed in as a patient:** opening `/` skips the phone step.
4. **Doctor:** the request inbox shows the reason under the service.
5. **"Entrar a mi Portal"** still logs in and lands on `/dashboard`.
6. **Consent evidence:** after steps 1 and 2 (with consent), this returns at
   least one row per booking visitor:

```sql
select c.patient_id, c.version, c.accepted_at
from public.consents c
where c.accepted_at > now() - interval '15 minutes'
order by c.accepted_at desc;
```

## Anti-spam after Phase 3

`anon` can no longer write anything, so the clinic-wide ceilings of Phase 1 no
longer guard a public endpoint. What still applies:

- `booking_limit_pending_per_patient()` in `request_my_appointment`;
- `booking_limit_new_patients_per_hour()` in `register_me`;
- Supabase Auth's own OTP rate limits (and CAPTCHA, if enabled), which do
  cover the OTP endpoints.

`assert_public_booking_capacity()` and `booking_limit_pending_clinic_wide()`
are no longer called by any path. They are left in place so Phase 1 Gate 7b
still runs; they can be removed in a later clean-up.

## Phase 3 behavior changes

1. Booking requires a verified phone. Nothing is revealed about a number until
   its owner enters the code.
2. The reason for the visit is stored per appointment (`appointments.reason`)
   instead of once in `patients.notes` at registration.
3. The birth year from the registration form is now stored, as January 1st of
   that year in `patients.dob` (the anonymous RPC used to discard it).
4. "Agendar otra cita" on the success screen starts at the service, since the
   visitor is still signed in.

## Rollback notes

- Rolling back requires the previous frontend AND re-running the
  `request_appointment` section of `20260922180800_consents.sql` and the
  `request_my_appointment` section of `20260922180500_booking_rpcs.sql`
  (drop the three-argument version first).
- `appointments.reason` can stay; the previous frontend ignores it.

---

## Migration 14 — Clinical notes are staff-only

Paste `supabase/migrations/20260922181300_clinical_notes_staff_only.sql`. It
ends with its own gate and must print:

`Migration 14 PASSED: clinical notes and addenda are staff-only; the patient export no longer includes them.`

What it changes:

- Drops `clinical_notes_select_own` and `clinical_note_addenda_select_own`, so a
  patient session can no longer read SOAP notes or their addenda through the API.
- Redefines `export_my_data()` without the `clinical_notes` key.
- A patient asks for a clinical summary through the portal request form
  (request type `access`, shown as "Resumen clínico"); the doctor answers it
  from Admin → "Solicitudes ARCO" (NOM-004-SSA3-2012, 5.5).

No patient screen read those tables, so nothing in the portal breaks.
Prescriptions stay visible to the patient in "Mis Medicamentos".

---

## Migration 15 — One patient record per phone

**Why:** `current_patient_id()` matches the verified phone and, when two records
share a number, silently returns the OLDEST. The other record becomes
unreachable from the portal (its appointments, prescriptions and files never
appear). Duplicates exist today (two test patients share `+525512345678`).

**Run:** paste `supabase/migrations/20260922181400_unique_patient_phone.sql`.

- If duplicates exist it stops with `Migration 15 ABORTED`, lists every record
  (id, name, phone, created_at) grouped by phone, and changes NOTHING. For each
  group, pick the record to keep, move the others' appointments, notes,
  prescriptions, files and consents to it (or correct the phone if they are
  different people), then run the file again. The migration never deletes or
  edits data.
- Otherwise it must print:
  `Migration 15 PASSED: public.patients now allows only one record per canonical phone number.`

**What it changes:**

- A unique index on `public.normalize_phone(phone)`. `+52 1 55…`, `52155…` and
  `+5255…` count as the same number. Patients without a phone (anonymized) are
  not affected.
- `authenticated` gets `EXECUTE` on `normalize_phone(text)`. Postgres runs an
  index expression with the privileges of the role writing the row, and staff
  write `patients` directly; without the grant every staff insert/edit would
  fail with "permission denied for function normalize_phone".

**Behavior change:** creating a patient from the admin panel with a phone that
already belongs to another patient now fails ("Error al crear el paciente.")
instead of creating an unreachable duplicate.

**Rollback:** `drop index public.patients_phone_normalized_key;` (the grant can
stay; it is harmless).

---

## RLS check — `supabase/tests/rls_check.sql`

A single script that proves the access rules against the real policies. There
is no local Docker, so `supabase test db` / pgTAP cannot run; this replaces it.

**Run:** open the Supabase SQL editor, paste the whole file, run it once.

- Expected: one notice starting with `RLS CHECK PASSED`.
- A failure raises `RLS CHECK FAILED: …` naming the broken rule.
- `RLS CHECK ABORTED: …` means a safety pre-check stopped it before any change.

**What it does:**

1. `begin;` … `rollback;` around everything: the throwaway auth users, two test
   patients (phones `+529990000101` / `+529990000102`), their appointments,
   clinical notes, an addendum, prescriptions and the audit rows they generate
   are never committed, pass or fail.
2. Disables the `whatsapp_notifications` trigger INSIDE the transaction (DDL is
   transactional, so the rollback re-enables it) and aborts if any other
   enabled trigger on the touched tables makes HTTP calls. No WhatsApp message
   can be sent.
3. Impersonates each caller with `set local role authenticated|anon` and
   `request.jwt.claims` (`sub`, `phone`), exactly like PostgREST does, and
   asserts:
   - patient A reads only their own `patients`, `appointments` and
     `prescriptions` rows and none of patient B's (and vice versa);
   - patient A reads ZERO `clinical_notes` and `clinical_note_addenda` rows,
     including their own (staff-only since migration 14);
   - patient A cannot update patient B or change their own `profiles.role`;
   - `export_my_data()` for patient A has no `clinical_notes` key, no
     `profile.notes`, and nothing of patient B;
   - a doctor account still sees both patients, both notes and the addendum;
   - `anon` reads zero rows from patients, appointments, clinical notes,
     addenda, prescriptions and profiles, and cannot execute `export_my_data()`.

**When to run it:** after applying any migration that touches policies,
`current_patient_id()`, `is_staff()` or `export_my_data()`, and before each
release. It holds a lock on `appointments` for the duration of the transaction
(well under a second); run it off-hours.

---

# Phase 4 — Inventory ledger

## Migration 16 — Stock changes go through a ledger

**Why:** the app wrote an absolute stock value computed in the browser, so fast
+/- clicks or two open tabs overwrote each other; `last_restock_date` was
stamped even when stock went down; and nothing recorded what supplies cost,
which Phase 5 (Finances) needs as its expense source.

**Run:** paste `supabase/migrations/20260922181500_inventory_movements.sql`.

- If an item has negative stock it stops with `Migration 16 ABORTED`, lists the
  items and changes NOTHING. Correct their `stock_quantity` and run it again.
- Otherwise it must print:
  `Migration 16 PASSED: stock changes only through adjust_stock(), every change is in the append-only inventory_movements ledger, and the ledger matches current stock.`

**What it changes:**

- New `public.inventory_movements`: append-only (no UPDATE/DELETE/TRUNCATE for
  any role, same guard as `audit_log`), staff can only SELECT it through the
  API. `quantity` is signed; purchases store `total_cost` and `unit_cost`.
- New RPC `adjust_stock(item, delta, type, total_cost, note)` (staff only,
  `authenticated` only). It adds the delta to the CURRENT stock in one atomic
  UPDATE, refuses negative stock and archived items, stamps
  `last_restock_date` only for purchases, and writes the movement in the same
  transaction.
- Trigger `inventory_guard_stock` refuses any other change to
  `inventory.stock_quantity`. Name, category, unit, alert level and archive
  still edit directly.
- Trigger `inventory_record_initial_stock` records the stock given when an item
  is created as an "Inventario inicial" movement.
- Backfill: every existing item gets one "Inventario inicial" movement for its
  current stock, so the ledger sums to the stock from day one.
- `inventory.stock_quantity` gets a `>= 0` check.

**Deploy order:** run the migration BEFORE deploying the frontend. The previous
frontend writes stock directly and its +/- buttons would fail after the
migration; the new frontend needs `adjust_stock()`.

**Fixing a count from the SQL editor:** prefer the app ("Editar" → Stock
Actual, recorded as "Ajuste manual"). A raw fix must run in one transaction
after `select set_config('app.inventory_ledger', 'on', true);` and should be
paired with a matching `inventory_movements` row, or the ledger will no longer
match the stock.

**Rollback:** `drop trigger inventory_guard_stock on public.inventory;` restores
direct stock writes (needed only if the previous frontend is redeployed). Keep
the ledger table: it holds purchase costs.

## Inventory check — `supabase/tests/inventory_check.sql`

**Run:** paste the whole file into the SQL editor after migration 16. It runs
inside `begin; … rollback;` with a throwaway doctor and test item, so nothing
is committed.

- Expected: one notice starting with `INVENTORY CHECK PASSED`.
- A failure raises `INVENTORY CHECK FAILED: …` naming the broken rule.

It proves: a change from a stale screen adds up instead of overwriting (read 10,
+5, −1 → 14); stock cannot go negative; a direct `UPDATE … stock_quantity` is
refused while a rename still works; a purchase of 4 for $100 stamps
`last_restock_date` and records unit cost 25.00; staff cannot insert, update or
delete movements directly; the ledger sums to the stock; `anon` cannot call
`adjust_stock()`.
