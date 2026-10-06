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
2. **Doctor:** the "Recetas e Indicaciones" tab shows the notice "Al
   finalizar la consulta, la receta se puede emitir en PDF con tus datos y tu
   firma. No recetes aquí medicamentos controlados (Grupos I a III)." (since
   migration 25; before it, the notice said the record was not an official
   prescription).
3. **Patient:** "Mis Medicamentos" shows, always at the top of the modal,
   "Registro de tus medicamentos. Tu receta oficial es el PDF firmado que te
   envía la doctora."
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

---

# Phase 5 — Finances

## Migration 17 — Consultation payments

**File:** `supabase/migrations/20260922181600_payments.sql`. Idempotent; paste
it into the SQL editor after migration 16.

- Expected: one notice starting with `Migration 17 PASSED`.
- A failure raises `Migration 17 FAILED: …` naming the broken rule.

What it adds:

- Table `public.payments`: one row per appointment (`appointment_id` is
  unique). `status` is `paid` (amount > 0 and a method: `cash`, `card` or
  `transfer`) or `courtesy` (amount 0, no method). Table checks enforce this
  even for the table owner. Foreign keys are `ON DELETE RESTRICT`, so a charge
  never disappears with its appointment, patient or service.
- RLS: staff can `SELECT`; nobody can `INSERT/UPDATE/DELETE` through the API.
  Patients and `anon` read nothing.
- RPC `record_payment(appointment, status, amount, method, note)`: staff only,
  `SECURITY DEFINER` with a pinned `search_path`. It upserts by appointment,
  so "Editar cobro" corrects the same row, and fills `patient_id`,
  `service_id` and `list_price` (the service price when the charge was first
  recorded) on the server. It refuses cancelled or rejected appointments.
- The existing `audit_row_change` trigger is attached to `payments`: every
  charge and correction appears in the Bitácora ("un cobro"), with column
  names only, never amounts.

**Deploy order:** run the migration BEFORE deploying the frontend. The new
"Finalizar Consulta" flow records the charge first and does not finalize if
`record_payment()` is missing.

**Rollback:** `drop function public.record_payment(uuid, text, numeric, text, text);`
disables charging (and therefore "Finalizar Consulta" in the new frontend).
Keep the table: it holds the income history.

## Finance check — `supabase/tests/finance_check.sql`

**Run:** paste the whole file into the SQL editor after migration 17. It runs
inside `begin; … rollback;` with throwaway staff and patient users, a patient,
a service and two appointments, and disables the `whatsapp_notifications`
trigger inside the transaction, so nothing is committed or sent.

- Expected: one notice starting with `FINANCE CHECK PASSED`.
- A failure raises `FINANCE CHECK FAILED: …` naming the broken rule.

It proves: staff record a paid charge and the server fills patient, service
and list price; a second call corrects the same row and keeps the original
list price; a courtesy is stored as 0 with no method; a paid charge of 0 or
without a method is refused; staff cannot insert or delete payments directly;
every write is audited; a patient reads zero payments and cannot call
`record_payment()`; `anon` reads nothing and cannot call it; the table rejects
inconsistent rows and a second payment for the same appointment.

---

# Role separation — doctor vs. admin

## Migration 18 — Separate the doctor and admin roles

**File:** `supabase/migrations/20260922181700_role_separation.sql`. Idempotent;
paste it into the SQL editor after migration 17.

- Expected: one notice starting with `Migration 18 PASSED`.
- `Migration 18 ABORTED: no profile has role doctor…` means nothing changed:
  promote the doctor first (migration 03), then run it again. Without a doctor
  the clinic would be locked out of its clinical data.
- A failure raises `Migration 18 FAILED: …` naming the broken rule.

What it changes:

- `public.is_staff()` now means **clinical staff = `doctor` only**. Every
  policy and RPC that already called it (patients, appointments, clinical
  notes and addenda, prescriptions, patient files, the `clinical_records`
  bucket, ARCO requests, consents, audit log, other profiles, clinic
  settings, blocked slots, role changes, `record_payment`,
  `finalize_consultation`, `resolve_arco_request`, `anonymize_patient`)
  excludes `admin` without being rewritten.
- New `public.is_business_staff()` = `doctor` or `admin`. It is used ONLY by
  `services_staff_all`, `inventory_staff_all`,
  `inventory_movements_select_staff`, `payments_select_staff` and inside
  `adjust_stock()`. `register_me()` also uses it, so neither staff role can
  register itself as a patient. The gate refuses any other use.
- An admin reading Finanzas gets amounts and the service, never the patient:
  `patients` is not readable, so the name embed comes back empty. The
  frontend does not even request it for an admin.

**Deploy order:** run the migration, then deploy the frontend (admins are
redirected from Centro Clínico to Administración). Nobody holds `admin` yet,
so the order is not critical today.

**Rollback:** re-run `20260922180100_role_helpers.sql` (restores `is_staff()`
for doctor and admin), then migrations 04, 16 and 17 to restore the business
policies and `adjust_stock()`. `is_business_staff()` can stay; nothing else
calls it after that.

## Roles check — `supabase/tests/roles_check.sql`

**Run:** paste the whole file into the SQL editor after migration 18. It runs
inside `begin; … rollback;` with throwaway doctor, admin and patient users and
disables the `whatsapp_notifications` trigger inside the transaction, so
nothing is committed or sent.

- Expected: one notice starting with `ROLES CHECK PASSED`.
- A failure raises `ROLES CHECK FAILED: …` naming the broken rule.

It proves: the doctor reads and writes every clinical and business table and
calls `record_payment`, `finalize_consultation`, `resolve_arco_request` and
`adjust_stock`; the admin reads inventory, movements, every service and
payment amounts, adjusts stock and edits the catalog, but reads zero rows of
patients, appointments, notes, addenda, prescriptions, files, ARCO requests,
consents, audit log, clinic settings, blocked slots, `clinical_records`
objects and other profiles, sees no patient name next to a payment, cannot
write patients or appointments, cannot promote itself, and cannot call
`record_payment`, `finalize_consultation`, `resolve_arco_request`,
`anonymize_patient` or `export_my_data`; patients and `anon` are not business
staff.

## Creating an admin account (later)

There is no admin user today. When administrative staff joins, create the
account from the **SQL editor only — never from the app** (the app has no
role screen on purpose, and `profiles_block_role_escalation` refuses role
changes from any session that is not the doctor):

1. Supabase dashboard → Authentication → Users → **Add user** with the
   person's email and a password (email login, no phone).
2. In the SQL editor:

   ```sql
   update public.profiles
      set role = 'admin'
    where id = (select id from auth.users where lower(email) = lower('person@example.com'));
   -- expected: UPDATE 1
   select role from public.profiles
    where id = (select id from auth.users where lower(email) = lower('person@example.com'));
   -- expected: admin
   ```

3. Sign in as that person: the header shows only "Administración", and
   `/doctor/dashboard` redirects to `/doctor/admin`.

To revoke access, set the role back to `patient` (or delete the auth user).
Never set `doctor` on anyone but the doctor: `doctor` sees every clinical
record.

---

# NOM-004 consultation record

## Migration 20 — Prognosis, vital signs, history, address, atomic finalize

**File:** `supabase/migrations/20260927110000_nom004_consultation.sql`.
Idempotent; paste it into the SQL editor after migration 19
(`20260927100000_staff_booking_overlap.sql`).

- Expected: one notice starting with `Migration 20 PASSED`.
- A failure raises `Migration 20 FAILED: …` naming the broken rule.

What it adds:

- `clinical_notes.prognosis` (text) and `clinical_notes.vital_signs` (jsonb
  object with numeric `bp_sys`, `bp_dia`, `spo2`, `weight_kg`, `height_cm`;
  a check refuses any other key or a non-number).
- `patients.address`, `family_history`, `personal_pathological_history`,
  `non_pathological_history`, `current_illness`. Patients still have no write
  policy on `patients`, so only the doctor edits them; the gate proves it.
- `clinical_notes_enforce_integrity()` re-created from migration 10 with
  `prognosis` and `vital_signs` in the frozen fields.
- `finalize_consultation()` re-created: it refuses (P0001, "Para finalizar la
  consulta, escribe el diagnóstico y el plan.") when the note has an empty
  diagnosis or plan, or when the appointment has no note. An already
  finalized consultation still returns 0.
- New RPC `finalize_consultation_with_payment(appointment, status, amount,
  method, note)`: doctor only, `SECURITY DEFINER` with a pinned
  `search_path`. It calls `finalize_consultation()` and then
  `record_payment()` in one call, so both succeed or neither does; both keep
  their own audit rows. "Finalizar Consulta" uses only this RPC now.
- `export_my_data()` re-created from migration 14 with the address and the
  four antecedentes (never `patients.notes`, never SOAP notes).
- `anonymize_patient()` re-created from migration 11: it also clears
  `address`.

**Deploy order:** run the migration BEFORE deploying the frontend. The new
"Finalizar Consulta" calls `finalize_consultation_with_payment()` and fails
(nothing saved, the doctor sees an error) while it is missing. After the
migration, re-run `supabase/tests/roles_check.sql`: its fixture note now has a
diagnosis and a plan, which `finalize_consultation()` requires.

**Rollback:** `drop function public.finalize_consultation_with_payment(uuid, text, numeric, text, text);`
disables "Finalizar Consulta" in the new frontend. Re-running migration 10
restores the old freeze trigger and `finalize_consultation()` (no diagnosis or
plan check; `prognosis` and `vital_signs` would no longer be frozen), and
migrations 13/14 and 11 the previous `export_my_data()` and
`anonymize_patient()`. Keep the new columns: they hold clinical data.

## NOM-004 check — `supabase/tests/nom004_check.sql`

**Run:** paste the whole file into the SQL editor after migration 20. It runs
inside `begin; … rollback;` with throwaway doctor and patient users, a
patient, a service and five appointments, and disables the
`whatsapp_notifications` and `appointments_prevent_overlap` triggers inside
the transaction, so nothing is committed or sent.

- Expected: one notice starting with `NOM004 CHECK PASSED`.
- A failure raises `NOM004 CHECK FAILED: …` naming the broken rule.

It proves: `finalize_consultation()` refuses an empty diagnosis, a blank plan
and an appointment with no note, and leaves those notes open; a complete note
finalizes and a second call returns 0; `finalize_consultation_with_payment()`
leaves no payment row when finalization fails, leaves the note open when the
charge is refused, and stores both on a corrected retry; `prognosis` and
`vital_signs` cannot change after finalization; `vital_signs` refuses text
values and unknown keys; the doctor reads the author's name; a patient cannot
change their own clinical history or address, and their export carries the
address and the antecedentes but no internal notes and no SOAP notes.

---

# Supplies per service and profit per procedure

## Migration 22 — Supplies per service, supplies used, profit per procedure

**File:** `supabase/migrations/20260928110000_service_supplies.sql`.
Idempotent; paste it into the SQL editor after migration 21
(`20260928100000_block_archived_booking.sql`).

- Expected: one notice starting with `Migration 22 PASSED`.
- `Migration 22 ABORTED: … movement(s) that are not purchases carry a cost`
  means nothing changed: those rows cannot come from `adjust_stock()`; review
  them, then run it again.
- A failure raises `Migration 22 FAILED: …` naming the broken rule.

What it adds:

- Table `public.service_supplies` (`service_id`, `item_id`, `quantity > 0`,
  unique per service and item, foreign keys to `services` and `inventory`).
  RLS policy `service_supplies_business_all`: doctor and admin read and write
  it (`is_business_staff()`); `anon` has no privilege at all. Every change is
  written to the Bitácora by `audit_row_change` ("los insumos de un
  tratamiento"), column names only.
- RPC `set_service_supplies(service, supplies)`: business staff only. Saves the
  whole "Insumos que usa" list of one service in one call (adds, changes,
  removes; unchanged lines are not rewritten).
- `inventory_movements.appointment_id` (nullable, `ON DELETE RESTRICT`): the
  consultation a `use` was recorded for.
- `inventory_movements_cost_check` still requires a cost on purchases and
  refuses it on manual uses and adjustments; only a `use` linked to a
  consultation may carry a cost, and that cost is computed by the server.
  `inventory_movements_appointment_check` allows `appointment_id` only on a
  `use` that removes stock.
- Internal helper `apply_stock_movement()` (no grant to any API role): the
  body of `adjust_stock()` that changes stock, moved as-is (ledger flag,
  single atomic UPDATE, no negative stock, no archived items, same messages).
  `adjust_stock()` keeps its signature, permission check and validation and
  now calls it, so stock still changes in exactly one place and the ledger
  still sums to the stock.
- `clinical_notes.supplies_recorded_at` (nullable): set when the supplies of
  a consultation are confirmed, also with an EMPTY list ("used none"). Null
  on a finalized note = the consultation was closed without that step (for
  example the inventory did not load). It is on the note, not on the
  appointment, because every UPDATE of `appointments` fires the WhatsApp
  webhook (a confirmed appointment would get "CONFIRMADA" again). Trigger
  `clinical_notes_guard_supplies_marker` refuses any direct change (42501);
  only the supplies RPCs write it.
- **Old data:** the column is created with the migration time as a stored
  default, so every existing note is marked WITHOUT an UPDATE (no Bitácora
  entry per note, no trigger), then the default is dropped and only open
  drafts are reset to null. Consultations finalized before this migration
  therefore never turn red. This runs only when the column is created, so a
  re-run never marks newer pending consultations.
- Internal helper `record_supplies_used()` (no grant to any API role) is the
  supplies step: it locks the consultation, refuses it when the supplies
  were already recorded ("Los insumos de esta consulta ya estaban
  registrados."), records one `use` per supply linked to the appointment with
  `unit_cost`/`total_cost` = the weighted average of that item's purchases
  (null when the item was never purchased), and stamps the marker. Any other
  key in a supply (for example a cost) is refused.
- `finalize_consultation_with_payment()` re-created from migration 20 (body
  copied verbatim) with a new last parameter `p_supplies jsonb DEFAULT NULL`
  (`[{"item_id": …, "quantity": …}]`). A list, even empty, runs the supplies
  step in the same transaction as the note and the charge; null (what a
  5-argument call sends) leaves the consultation pending. Not enough stock
  ("Solo hay N de … en inventario."), an archived item or a bad list aborts
  everything: no frozen note, no payment, no movement, no marker. The old
  5-argument overload is dropped; a call with 5 arguments reaches the new
  function through the default.
- RPC `record_consultation_supplies(appointment, supplies)`: doctor only
  (`is_staff()`). "Registrar insumos" in the calendar: only for a finalized
  consultation whose supplies were never recorded, through the same
  `record_supplies_used()`. A second call is refused.
- RPC `get_procedure_profit(from, to)`: business staff only. One row per
  service for the payments recorded in the range: times, charged, value of
  courtesies, cost of the supplies used on those consultations, supplies with
  no registered cost, charged minus supplies, and how many consultations of
  a service with supplies configured never had their supplies recorded
  (Finanzas warns that the profit may be incomplete). No patient data, so the
  admin sees it too. The cash view (income − purchases) is unchanged; uses are
  never counted as spending.

**Deploy order:** run the migration BEFORE deploying the frontend. The new
Catálogo saves supplies through `set_service_supplies()`, "Finalizar
Consulta" sends `p_supplies` whenever the supplies step was shown, the
calendar reads `clinical_notes.supplies_recorded_at` and calls
`record_consultation_supplies()`, and Finanzas calls
`get_procedure_profit()` (its table shows an error while the function is
missing; the rest of Finanzas keeps working).

**Re-running older files:** migration 18's gate whitelists every user of
`is_business_staff()` as of migration 18, so re-running 18 after this file
reports `service_supplies_business_all`, `set_service_supplies()` and
`get_procedure_profit()`. Re-running 16, 18 or 20 would also bring back the
older `adjust_stock()` or the 5-argument finalize overload; run this file
again afterwards (the old-data marking does not run again).

**Rollback:**

```sql
drop function public.get_procedure_profit(timestamptz, timestamptz);
drop function public.set_service_supplies(uuid, jsonb);
drop function public.record_consultation_supplies(uuid, jsonb);
drop function public.finalize_consultation_with_payment(uuid, text, numeric, text, text, jsonb);
drop function public.record_supplies_used(uuid, jsonb);
```

then re-run migration 20 (restores the 5-argument finalize). `adjust_stock()`
and `apply_stock_movement()` can stay: together they behave exactly like the
migration 18 `adjust_stock()`. Keep `service_supplies` and
`inventory_movements.appointment_id` and `clinical_notes.supplies_recorded_at`:
they hold catalog data and the history of what was used.

## Service supplies check — `supabase/tests/service_supplies_check.sql`

**Run:** paste the whole file into the SQL editor after migration 22. It runs
inside `begin; … rollback;` with throwaway doctor and admin users, a patient,
two services, two items and six appointments, and disables the
`whatsapp_notifications` and `appointments_prevent_overlap` triggers inside
the transaction, so nothing is committed or sent.

- Expected: one notice starting with `SUPPLIES CHECK PASSED`.
- A failure raises `SUPPLIES CHECK FAILED: …` naming the broken rule.

It proves: `set_service_supplies()` saves, changes, merges and removes lines
and refuses a quantity of 0 or a cost; finalizing with supplies lowers the
stock and stores the server's average cost (600.00 from purchases of 1000 and
1400 for 4 units), a never-purchased item is stored with no cost, and a later
purchase does not change a past snapshot; using 5 of 4 units rolls back the
note, the payment, every movement and every stock change; a supply carrying
`unit_cost`/`total_cost`, a manual `use` with a cost and a direct movement
insert are all refused; supplies of a consultation cannot be discounted
twice; finalizing with supplies or with an EMPTY list marks the consultation,
and a finalize without the step leaves it unmarked;
`record_consultation_supplies()` refuses a consultation that is not
finalized, works once (stock down, cost snapshot 660.00, marker set) and
refuses a second call; the doctor cannot change the marker directly; the
admin reads and writes `service_supplies` and reads the profit per procedure
but reads no appointment, patient or clinical note and cannot finalize or
record supplies; `get_procedure_profit()` counts the consultation without
recorded supplies, then returns the expected times, charged, courtesies,
supplies, uncosted supplies, profit and 0 unrecorded consultations, and its
rows add up to
the payments and the uses; `anon` reads nothing and cannot call the new RPCs;
the ledger still matches the stock and every `service_supplies` write is
audited.

# Doctor-only mode ("Modo solo doctora")

## Migration 23 — Doctor-only mode and paper consent

**File:** `supabase/migrations/20261004100000_doctor_only_mode.sql`.
Idempotent; paste it into the SQL editor after migration 22
(`20260928110000_service_supplies.sql`).

- Expected: one notice starting with `Migration 23 PASSED` (it also prints
  whether the mode is currently ON or OFF; it is OFF after the first run).
- `Migration 23 ABORTED: clinic_settings has N rows` means nothing changed:
  the table must hold one row. The message lists them; the public booking
  page uses the most recently updated row with `has_schedule=true`. Delete the
  others (`delete from public.clinic_settings where id = '…';`), then run it
  again.
- A failure raises `Migration 23 FAILED: …` naming the broken rule.

What it adds:

- `clinic_settings.doctor_only_mode` (boolean, not null, default false) and
  the unique index `clinic_settings_single_row`, so the table can never hold
  a second row. The "Horarios de Clínica" save (update the row, insert only
  when there is none) is unchanged.
- RPC `get_clinic_mode()`: returns only that boolean. `anon`,
  `authenticated` and `service_role` may call it (the public site decides
  what to show before sign-in; the WhatsApp edge function reads it).
- RPC `set_clinic_mode(boolean)`: doctor only (`is_staff()`; the admin gets
  42501). Updates the single row, or creates it when the schedule was never
  saved. `clinic_settings_staff_all` is unchanged: the doctor could also write
  the column directly, nobody else can.
- Internal helper `assert_patient_portal_open(message)` (no API grant). While
  the mode is ON, these RPCs refuse FIRST with a Spanish P0001:
  `request_my_appointment`, `reschedule_my_appointment`,
  `cancel_my_appointment` ("La clínica no está recibiendo citas en línea.
  Comunícate por teléfono."), `register_me`, `accept_privacy_notice` ("… no
  está recibiendo registros en línea …"), `submit_arco_request` ("… no está
  recibiendo solicitudes en línea …"), `register_my_upload` ("… no está
  recibiendo archivos en línea …"). Their bodies are copied verbatim from
  migrations 21, 06, 18, 13, 11 and 12; nothing else changes.
- Storage policy `clinical_records_patient_upload_own` (migration 03) is
  re-created with `and not public.get_clinic_mode()`: with the mode ON a
  patient cannot upload into their folder either. The doctor's
  `clinical_records_staff_all` is unchanged.
- `arco_requests.channel` (nullable; `presencial` | `telefono` | `correo` |
  `escrito`; null = filed in the portal) and RPC
  `staff_register_arco_request(patient, type, details, channel)`: doctor only
  (`is_staff()`), works with the mode ON or OFF, same type list and details
  limits as the portal form, refuses an anonymized record, no per-patient
  cap; `created_at` is the server's `now()`, so the legal deadline counts
  from when it is recorded. Shown as "Registrar solicitud" in "Solicitudes
  ARCO".
- `staff_reschedule_appointment()` (verbatim from migration 19): with the
  mode ON the moved appointment stays (or becomes) `confirmed`; OFF it goes
  back to `pending` as before.
- `consents.method` (`online` | `in_person`, not null, default `online`;
  every existing row is an online acceptance). RPC
  `record_consent_in_person(patient)`: doctor only; records the CURRENT
  notice version with method `in_person`; returns false and records nothing
  when the patient already holds a consent for that version; refuses an
  anonymized record. `consents` stays append-only with no direct write for
  any API role; the insert is in the Bitácora with the doctor as actor.
- `cancel_my_appointment` is now revoked from `anon` explicitly, like its
  siblings (it was only revoked from `public`).

**Deploy order:**

1. Run the migration (the mode stays OFF: nothing changes for patients).
2. Deploy the frontend (switch in Centro de Comando, `/` follows the mode,
   paper-consent checkbox, directory indicator, "Registrar solicitud"). The
   "Solicitudes ARCO" list selects `arco_requests.channel`, so it needs the
   migration first.
3. Deploy the edge function: `supabase functions deploy notify-appointment --no-verify-jwt`.
   With the mode ON it never sends "pendiente de confirmación" and replaces
   every "entra a tu portal" with "Si necesitas cambiarla, comunícate con la
   clínica." (or "Para agendar otra cita, …" after a cancellation). If it
   cannot read the mode it uses that wording too but skips nothing (the
   pending notice does not mention the portal; a 500 would make the webhook
   retry and could send the other messages twice). OFF: unchanged messages.
4. Only then turn the mode ON from Centro de Comando.

The frontend reads the mode once per page load (two retries on a failed
read): a browser that was already open shows the old screens until it is
reloaded, but the database refuses every patient action immediately. If the
mode still cannot be read the site falls back to the normal screens (the
database keeps refusing patient actions if it is ON) and the doctor's switch
says "No se pudo leer el modo" with "Reintentar" instead of a state.

**Re-running older files:** re-running migrations 03, 06, 11, 12, 13, 18, 19
or 21 after this file restores bodies (or the storage policy) without the
doctor-only checks (and 19 the `pending`-only staff reschedule). Run this
file again afterwards; its gate reports any missing check.

**Rollback:** turn the mode off (`select public.set_clinic_mode(false);` as
the doctor, or `update public.clinic_settings set doctor_only_mode = false where id is not null;`
in the SQL editor). That alone restores the previous behavior. To remove the
objects: re-run migrations 21, 06 (only `cancel_my_appointment` matters),
18, 13, 11, 12 and 19 in that order, re-create the migration 03
`clinical_records_patient_upload_own` policy, then

```sql
drop function public.staff_register_arco_request(uuid, text, text, text);
drop function public.record_consent_in_person(uuid);
drop function public.set_clinic_mode(boolean);
drop function public.assert_patient_portal_open(text);
drop function public.get_clinic_mode();
```

Keep `consents.method` (it is evidence of how each consent was given),
`arco_requests.channel` (how each recorded request arrived) and the column
and index on `clinic_settings` (harmless when OFF).

## Doctor-only mode check — `supabase/tests/doctor_only_mode_check.sql`

**Run:** paste the whole file into the SQL editor after migration 23. It runs
inside `begin; … rollback;` with throwaway doctor and admin users, three
patients, a service and two appointments, turns the mode ON inside the
transaction and disables the `whatsapp_notifications` trigger there, so
nothing is committed or sent and the clinic's real mode is untouched.

- Expected: one notice starting with `DOCTOR ONLY MODE CHECK PASSED`.
- A failure raises `DOCTOR ONLY MODE CHECK FAILED: …` naming the broken rule.

It proves: `anon` reads the mode but cannot change it (RPC or table write)
nor record consents; with the mode ON the seven patient RPCs refuse with
their Spanish message and write nothing (no appointment, consent, ARCO
request, file record or new patient) and a direct patient insert into their
storage folder is refused; the patient and the admin cannot change the mode,
record consents or call `staff_register_arco_request`; the doctor records an
offline request (channel, trimmed details, `created_at` = now, status
received) in both modes, and a missing patient, an anonymized record, an
unknown type or channel and too-short details are refused; a staff reschedule keeps a pending and a confirmed
appointment `confirmed`; `record_consent_in_person()` records exactly one
`in_person` row for the current notice, records nothing the second time,
refuses an anonymized record, and a direct insert into `consents` is refused;
the doctor turns the mode OFF, after which a staff reschedule goes back to
`pending` and every patient RPC works again (online consents carry method
`online`; a portal request has no channel; a file the owner placed in the
patient's folder is registered by the patient).

`archived_booking_check.sql` and `staff_booking_check.sql` now turn the mode
off inside their own transaction first (they prove the mode-OFF rules), so
they keep passing whatever the clinic's current mode is.

# Weight tracking (InBody)

## Migration 24 — Body composition measurements

**File:** `supabase/migrations/20261004110000_body_measurements.sql`.
Idempotent; paste it into the SQL editor after migration 23
(`20261004100000_*`). It does not depend on migration 23.

- Expected: one notice starting with `Migration 24 PASSED`.
- A failure raises `Migration 24 FAILED: …` naming the broken rule.

What it adds:

- `patients.weight_tracking` (boolean, not null, default false): the doctor
  marks the patients whose weight she follows ("Llevar control de peso").
  Written through the existing `patients_staff_all` policy (doctor only); the
  patient has no write policy on `patients` and the admin has no access to
  `patients`, and the gate fails if that ever changes. The change is written
  to the Bitácora by the `patients` audit trigger.
- Table `public.body_measurements`: date (`measured_at`, clinic calendar,
  never in the future), weight (required), and the optional InBody values:
  height, BMI, body fat % and kg, skeletal muscle, lean mass, waist-hip
  ratio, visceral fat level, basal metabolic rate, upper/lower balance, body
  type, C/I/D shape, and a note. `bmi` is a stored generated column
  (weight / height², one decimal), so nobody can write a BMI that disagrees
  with the weight and height. Range checks catch typos (e.g. 700 kg) and
  masses heavier than the weight; balance, body type and C/I/D are closed
  lists.
- `body_type` and `cid_type` are two columns because the InBody sheet prints
  both readings and they are independent (the body-type chart uses BMI and
  body fat %, the C/I/D shape compares weight, muscle and fat).
- RLS policy `body_measurements_staff_all`: `is_staff()` only — the doctor
  reads and writes; the admin never sees it; the patient never reads the
  table directly; `anon` has no privilege at all.
- Measurements are follow-up data, not a frozen consultation note: the doctor
  may correct or delete one. Every insert, update and delete is written to
  the Bitácora by `audit_row_change` (column names only).
- Trigger `body_measurements_guard` (SECURITY DEFINER, pinned `search_path`,
  no API grant): refuses any write on an anonymized record ("Este expediente
  fue anonimizado. Sus datos ya no se pueden editar."), a future date, a
  measurement moved to another patient and an appointment of another
  patient; the server sets `author_id` (the caller, never changed later),
  `created_at` and `updated_at`.
- `anonymize_patient()` re-created from its migration 20 body: it also
  clears `body_measurements.note` (free text that can name the patient)
  BEFORE it sets `anonymized_at` — after that the guard freezes the record.
  The measurements themselves stay. The ANONYMIZE audit event lists
  `body_measurements.note`.
- Trigger `patients_keep_weight_tracking` (BEFORE UPDATE OF
  `weight_tracking`, SECURITY DEFINER, no API grant): the flag cannot change
  on an anonymized record.
- `export_my_data()` re-created from its migration 20 body with a new
  `body_measurements` list (the patient's own rows, oldest first, with BMI).
  The doctor's note on a measurement is not exported, like the SOAP notes and
  the internal reminders. The printable "Mis datos" document shows them.

**Deploy order:** run the migration BEFORE deploying the frontend. The
Directorio list selects `patients.weight_tracking` (its "Control de peso"
label) and fails to load without it; the consultation screen and "Editar
datos" read the flag and `body_measurements`.

**Re-running older files:** re-running migration 20 would restore the
`export_my_data()` without measurements and the `anonymize_patient()` that
leaves measurement notes; run this file again afterwards.

**Rollback:**

```sql
drop trigger patients_keep_weight_tracking on public.patients;
drop function public.patients_keep_weight_tracking();
drop table public.body_measurements;
drop function public.body_measurements_guard();
alter table public.patients drop column weight_tracking;
```

then re-run migration 20 (restores the previous `export_my_data()` and
`anonymize_patient()`; the latter must be restored, since it references the
dropped table). Dropping
the table deletes every recorded measurement: export them first.

## Body measurements check — `supabase/tests/body_measurements_check.sql`

**Run:** paste the whole file into the SQL editor after migration 24. It runs
inside `begin; … rollback;` with throwaway doctor, admin and patient users,
three patients (one anonymized), a service and two appointments, and disables
the `whatsapp_notifications` and `appointments_prevent_overlap` triggers
inside the transaction, so nothing is committed or sent.

- Expected: one notice starting with `BODY MEASUREMENTS CHECK PASSED`.
- A failure raises `BODY MEASUREMENTS CHECK FAILED: …` naming the broken rule.

It proves: the doctor turns weight tracking on and off; she records a
measurement (BMI 24.2 for 70 kg at 170 cm, no BMI without a height, the
author is her even when another id is sent), corrects it (BMI follows, the
author does not change, BMI cannot be written) and deletes one; 700 kg, 95 %
body fat, muscle heavier than the weight, unknown closed-list values, a
visceral level of 0, a 1999 date, a future date, another patient's
appointment and moving a measurement to another patient are refused; an
anonymized record refuses new measurements, corrections, deletes and turning
`weight_tracking` on; `anonymize_patient()` run by the doctor clears the
note of the record's measurement, keeps the measurement, and then the flag
is frozen; the
admin reads none, cannot write one and cannot change `weight_tracking`; the
patient reads none directly, cannot write one or change their own
`weight_tracking`, and their export carries both measurements (oldest first,
with BMI) without the doctor's note; `anon` reads nothing; the Bitácora has 3
inserts, 1 update and 1 delete by the doctor and the `weight_tracking` change.

# Digital prescription (receta oficial en PDF)

## Migration 25 — Prescriber data, versioned signature, issue snapshot, folio

**File:** `supabase/migrations/20261005100000_digital_prescription.sql`.
Idempotent; paste it into the SQL editor after migration 24
(`20261004110000_*`). It redefines no earlier function.

- Expected: one notice starting with `Migration 25 PASSED`.
- A failure raises `Migration 25 FAILED: …` naming the broken rule.

What it adds:

- Table `public.prescriber_profile` — the doctor's printed prescription data
  (RIS art. 29): `full_name`, `cedula_profesional`, `especialidad`,
  `cedula_especialidad`, `institucion_titulo`, `consultorio_domicilio`,
  `telefono`, `signature_path` (the CURRENT signature version). **A new
  table, not columns on `clinic_settings`**, because `clinic_settings` feeds
  public RPCs (`get_clinic_schedule`, `get_clinic_mode`): keeping the
  doctor's personal data elsewhere means no present or future public RPC can
  expose it, its changes get their own audit trigger, and its access rules
  are checked in isolation.
  - Single row: `singleton boolean` (always true, unique); the browser
    upserts `on conflict (singleton)`.
  - RLS policy `prescriber_profile_staff_all`: `is_staff()` only (the
    doctor). The admin and patients read nothing; `anon` has no privilege.
    `authenticated` has SELECT/INSERT/UPDATE but **no DELETE**.
  - `prescriber_profile_values_check`: lengths; cédulas are 4–12 digits; a
    specialty cédula needs its specialty; phone digits/spaces/+()-;
    `signature_path` must match `^signature-[A-Za-z0-9_-]+\.png$`.
  - Trigger `prescriber_profile_guard` (SECURITY DEFINER, pinned
    `search_path`, no API grant): the server sets `updated_by`, `created_at`
    and `updated_at`. `audit_row_change` logs every change (column names
    only) in the Bitácora.
- Private Storage bucket `prescriber_private`: `public = false`, 256 KB,
  `image/png` only. **Versioned signatures:** every "Guardar firma" uploads a
  NEW object `signature-<id>.png` and points `signature_path` to it; older
  versions are kept, because issued prescriptions still use them. Two
  storage policies, both doctor-only (`is_staff()`):
  `prescriber_private_staff_read` (SELECT) and
  `prescriber_private_staff_insert` (INSERT, name must match
  `^signature-[A-Za-z0-9_-]+\.png$`: no folders, no other name). **No
  UPDATE and no DELETE policy**: a saved version can never be replaced or
  removed through the API. The app reads it with an authenticated download,
  never a public or signed URL.
- **Issue snapshot** on `public.prescriptions` (new columns
  `prescriber_snapshot jsonb`, `signature_path text`, `issued_at
  timestamptz`, `folio bigint`): an issued prescription never changes when
  the doctor later edits her data or draws a new signature.
  - RPC `issue_prescription(p_prescription_id uuid)` (SECURITY DEFINER,
    pinned `search_path`, `authenticated` only, `is_staff()`): only for a
    FINALIZED prescription with at least one medication. The first call
    (first "Ver / imprimir" or "Enviar por WhatsApp") locks the row, checks
    the prescriber data is complete and the signature object exists (else
    `Faltan datos de la receta.` with hint `prescriber_incomplete`), and
    stores the printed fields, the current signature version, `issued_at`
    and `folio = nextval('prescription_folio_seq')`. Later calls return the
    stored snapshot unchanged (idempotent; two taps at once get one folio).
  - The PDF is always rendered from the snapshot and its signature file.
  - `prescriptions_folio_key` (unique) and `prescriptions_issue_check` (all
    four set together, only on a finalized row, valid signature name,
    folio > 0).
  - Trigger `prescriptions_issue_guard` (SECURITY DEFINER, pinned
    `search_path`, no API grant): the four columns are refused on INSERT,
    and on UPDATE they are write-once and accepted only while
    `issue_prescription()` has set the transaction-local flag
    `app.issuing_prescription` to that row's id (same pattern as
    `app.inventory_ledger`). The API cannot set that flag. Refusals use
    `42501`.
  - Sequence `prescription_folio_seq`: no privilege for `anon` or
    `authenticated`. Folios are unique and increasing but **not gapless**
    (a failed or rolled-back issue — including each run of the check script,
    which uses up 2 — skips a number). Shown as "Folio 000123"; the file is
    `receta-000123.pdf`.
  - The patient can read these columns of her own prescriptions
    (`prescriptions_select_own`): they hold exactly what is printed on the
    PDF she receives, plus the signature object name, which only the doctor
    can download.
- RPC `log_prescription_shared(p_prescription_id uuid, p_channel text)`
  (SECURITY DEFINER, pinned `search_path`, `authenticated` only):
  `is_staff()`; refuses unknown prescriptions, drafts, prescriptions that
  were never issued and channels other than `share_sheet` (share sheet
  finished), `whatsapp_link` (the WhatsApp chat really opened and the PDF
  was downloaded), `download` (only downloaded: the share sheet failed or
  the browser blocked the chat) and `print` (opened in a tab). Writes an
  `EXPORT` audit event on `prescriptions` (row = prescription, patient = its
  patient) whose only "columns" are the channel, `folio:000123` and
  `issued_at:<UTC time>`. No clinical or personal value is logged. The
  Bitácora shows it as e.g. "Compartió la receta en PDF (folio 000123)"; the
  first issue appears as "Emitió la receta oficial (asignó folio)".
- Medications get optional `presentacion`, `via`, `frecuencia`, `duracion`
  inside `prescriptions.medications` (jsonb). No table change; the
  frozen-prescription trigger is unchanged. Items copied from an older
  prescription without route or frequency are marked "Incompleto" with a
  "Completar" button, and the consultation cannot be finalized until they
  are completed. A prescription holds at most 30 medications.

The gate also refuses to pass if any `storage.objects` policy does not name a
bucket where it matters: a SELECT / UPDATE / DELETE / ALL policy whose USING
lacks `bucket_id`, or an INSERT / UPDATE / ALL policy whose WITH CHECK (or,
when absent, its USING, which Postgres then applies to new rows) lacks
`bucket_id`; or if any other policy mentions `prescriber_private`. Its
rolled-back behavior block proves the guard: snapshot columns refused on
insert and outside the RPC, write-once inside it.

**Deploy order:** run the migration BEFORE deploying the frontend: the
Centro de Comando reads `prescriber_profile` for "Datos de la receta" and the
PDF buttons call `issue_prescription`.

**After deploying:** the doctor opens Centro de Comando → "Datos de la
receta", fills her data and draws her signature once. Until then "Ver /
imprimir" and "Enviar por WhatsApp" explain what is missing and link there.

**Re-running older files:** nothing earlier is redefined, so any earlier file
can be re-run; run this one again afterwards only if the earlier file drops
storage policies (migration 04 drops every `storage.objects` policy).

**Rollback** (issued snapshots and folios are lost; the PDFs already sent
are not affected):

```sql
drop function public.log_prescription_shared(uuid, text);
drop function public.issue_prescription(uuid);
drop trigger prescriptions_issue_guard on public.prescriptions;
drop function public.prescriptions_issue_guard();
alter table public.prescriptions
  drop constraint prescriptions_issue_check,
  drop constraint prescriptions_folio_key,
  drop column prescriber_snapshot,
  drop column signature_path,
  drop column issued_at,
  drop column folio;
drop sequence public.prescription_folio_seq;
drop policy "prescriber_private_staff_read" on storage.objects;
drop policy "prescriber_private_staff_insert" on storage.objects;
drop table public.prescriber_profile;
drop function public.prescriber_profile_guard();
```

Then delete the `signature-*.png` objects from the `prescriber_private`
bucket in the Storage dashboard and delete the bucket. Audit rows already
written stay (the log is append-only).

## Digital prescription check — `supabase/tests/digital_prescription_check.sql`

**Run:** paste the whole file into the SQL editor after migration 25. It runs
inside `begin; … rollback;` with throwaway doctor, admin and patient users, a
patient, a service, four appointments and four prescriptions (three
finalized, one draft), and disables the `whatsapp_notifications` and
`appointments_prevent_overlap` triggers inside the transaction, so nothing
is committed or sent. An existing real `prescriber_profile` row is removed
only inside the transaction and comes back with the rollback. The folio
sequence is not rolled back: each run uses up 2 folio numbers.

- Expected: one notice starting with `DIGITAL PRESCRIPTION CHECK PASSED`.
- A failure raises `DIGITAL PRESCRIPTION CHECK FAILED: …` naming the broken
  rule.
- `DIGITAL PRESCRIPTION CHECK ABORTED: …` means it could not set up its test
  data (e.g. the doctor's two signature objects were not stored, which it
  verifies as owner right after the upload). Nothing was proven; report the
  message.

Refusals that are privilege decisions (RLS, missing grants, the snapshot
guard) are caught ONLY as `insufficient_privilege` (42501), so an unrelated
error can never count as a refusal.

It proves: the doctor creates and corrects the single prescription data row
by upsert and the server owns `updated_by`; a cédula with letters, a bad
phone, a signature path outside `signature-<id>.png` (including the old
`signature.png` and a `../` path) and a specialty cédula without a specialty
are refused; a second row is impossible and the doctor cannot delete the
row; the doctor's two signature versions exist (checked as owner); every
other object name (`signature.png`, `other.png`, folders, `../`, `.jpg`,
spaces, `signature-.png`) is refused; she can neither rename nor delete a
saved version; `issue_prescription()` stores the snapshot on first issue and
returns it unchanged on the second call AND after she edits her name and
draws a new signature, while the next prescription uses the new data; folios
increase and a duplicate folio is refused by the unique constraint; drafts
and unknown prescriptions cannot be issued; direct writes to the snapshot
columns (edit an issued snapshot or folio, issue by hand, issue a draft,
insert with a folio, or set the internal flag on an issued row) are refused;
`log_prescription_shared()` logs an issued prescription once per channel
(4 events) with exactly channel, folio and issue time, and refuses a draft,
a finalized-but-not-issued prescription, an unknown prescription and an
unknown or null channel; the admin, the patient and `anon` read no
prescription data, see no signature object, cannot write one, and cannot
issue or log; the Bitácora has the doctor's profile insert, her
`signature_path` update and the issue (an UPDATE with `folio`).
