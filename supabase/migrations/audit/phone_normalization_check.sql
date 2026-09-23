-- =============================================================================
-- AUDIT - phone normalization coverage
-- =============================================================================
-- READ ONLY. This script selects and raises. It never inserts, updates, deletes
-- or alters anything, and it is safe to run as many times as you like.
--
-- NOT PART OF THE NUMBERED MIGRATION CHAIN. It lives in this subdirectory on
-- purpose: `supabase db push` globs supabase/migrations/*.sql at the top level
-- only, so nothing here is ever applied automatically.
--
-- -----------------------------------------------------------------------------
-- Why this exists
-- -----------------------------------------------------------------------------
-- public.current_patient_id() matches the caller's verified Auth phone claim
-- against patients.phone by running public.normalize_phone() over both sides.
-- normalize_phone() strips non-digits and then special-cases exactly ONE shape:
-- a 13-digit string beginning '521', whose legacy mobile '1' it drops. Every
-- other stored variant passes through as raw digits.
--
-- That means a row stored as '+1 555...', '5512345678' (no country code),
-- '0052...', '+52 1 55 ...' with an unexpected digit count, or an empty string
-- normalizes to something the Auth claim will never equal. current_patient_id()
-- then returns NULL, and the consequence is SILENT: the patient signs in
-- successfully, every RLS policy evaluates to false, and they see an empty
-- portal with no error message and nothing in the logs. The doctor hears about
-- it as "the app is broken for my patient" weeks later.
--
-- Run this BEFORE applying the RLS policy migration
-- (20260922180300_rls_policies.sql). Before that migration the permissive
-- policies are still in place and a bad phone is harmless; after it, a bad
-- phone is a locked-out patient.
--
-- Expected canonical shape: ^52\d{10}$  (Mexico country code + 10-digit number)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Summary - how bad is it
-- -----------------------------------------------------------------------------
select count(*)                                                          as total_patients,
       count(*) filter (
         where public.normalize_phone(p.phone) ~ '^52[0-9]{10}$'
       )                                                                 as ok,
       count(*) filter (
         where public.normalize_phone(p.phone) is null
            or public.normalize_phone(p.phone) !~ '^52[0-9]{10}$'
       )                                                                 as needs_attention
from public.patients p;

-- -----------------------------------------------------------------------------
-- 2. The offending rows, with a diagnosis for each
-- -----------------------------------------------------------------------------
-- Every row returned here is a patient who would get an empty portal.
-- -----------------------------------------------------------------------------
select p.id,
       p.phone                                as raw_phone,
       public.normalize_phone(p.phone)        as normalized_phone,
       length(public.normalize_phone(p.phone)) as normalized_length,
       case
         when coalesce(btrim(p.phone), '') = ''                then 'empty or NULL phone'
         when public.normalize_phone(p.phone) is null          then 'no digits at all'
         when public.normalize_phone(p.phone) !~ '^52'         then 'missing or wrong country code'
         when length(public.normalize_phone(p.phone)) < 12     then 'too few digits after the 52'
         when length(public.normalize_phone(p.phone)) > 12     then 'too many digits (unhandled prefix?)'
         else 'unexpected shape'
       end                                    as diagnosis,
       p.first_name,
       p.last_name,
       p.created_at
from public.patients p
where public.normalize_phone(p.phone) is null
   or public.normalize_phone(p.phone) !~ '^52[0-9]{10}$'
order by p.created_at asc nulls last;

-- -----------------------------------------------------------------------------
-- 3. Go/no-go gate
-- -----------------------------------------------------------------------------
-- Run this last. It throws if query 2 returned anything, so the check cannot be
-- passed by not reading the output.
--
-- To proceed you must do ONE of:
--   (a) fix the listed rows so they normalize to ^52\d{10}$, re-run, get 0; or
--   (b) consciously accept them - those patients will have a non-functioning
--       portal until their phone is corrected. To record that decision, change
--       v_accept_known_bad below to the exact number of rows query 2 returned
--       and note in the runbook who accepted it and when.
-- -----------------------------------------------------------------------------
do $$
declare
  -- Set to the number of rows you are knowingly accepting. 0 means "none".
  v_accept_known_bad constant integer := 0;
  v_bad integer;
begin
  select count(*)
    into v_bad
  from public.patients p
  where public.normalize_phone(p.phone) is null
     or public.normalize_phone(p.phone) !~ '^52[0-9]{10}$';

  if v_bad > v_accept_known_bad then
    raise exception
      'Phone normalization audit FAILED: % of % patient rows do not normalize to ^52\d{10}$ (accepting %). Those patients would sign in to an empty portal once RLS lands. Fix them, or set v_accept_known_bad to % and record the decision.',
      v_bad,
      (select count(*) from public.patients),
      v_accept_known_bad,
      v_bad
      using errcode = 'P0001';
  end if;

  if v_bad > 0 then
    raise notice 'Phone normalization audit PASSED WITH ACCEPTED EXCEPTIONS: % row(s) knowingly accepted.', v_bad;
  else
    raise notice 'Phone normalization audit PASSED: every patient phone normalizes to the canonical form.';
  end if;
end $$;
