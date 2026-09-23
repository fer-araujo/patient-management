-- =============================================================================
-- 02 - Authorization helpers
-- =============================================================================
-- Every helper is SECURITY DEFINER with a pinned search_path.
--
-- is_staff() must be SECURITY DEFINER: the RLS policies on public.profiles call
-- it, and a SECURITY INVOKER function would re-enter those same policies and
-- recurse.
--
-- Phone normalization: patients.phone is stored E.164 with a leading '+'
-- (e.g. '+525512345678') while Supabase Auth exposes the verified phone claim
-- without it (e.g. '525512345678'). Mexican mobile numbers are additionally
-- seen both with and without the legacy '1' after the 52 country code
-- ('5215512345678'). normalize_phone() collapses all of those into the same
-- digits-only canonical form so both sides of the comparison agree.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- normalize_phone - digits only, legacy MX mobile '1' removed
-- -----------------------------------------------------------------------------
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
           when digits is null or digits = '' then null
           -- 52 + 1 + 10 digit mobile -> drop the legacy '1'
           when length(digits) = 13 and left(digits, 3) = '521'
             then '52' || right(digits, 10)
           else digits
         end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits) s;
$$;

comment on function public.normalize_phone(text) is
  'Canonical digits-only form of a phone number, used to match auth.jwt()->>phone against patients.phone.';

-- -----------------------------------------------------------------------------
-- format_phone_e164 - canonical digits back to storage format
-- -----------------------------------------------------------------------------
create or replace function public.format_phone_e164(p_digits text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case when coalesce(p_digits, '') = '' then null else '+' || p_digits end;
$$;

-- -----------------------------------------------------------------------------
-- is_staff - true when the caller's profile row grants clinic staff access
-- -----------------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('doctor', 'admin')
  );
$$;

comment on function public.is_staff() is
  'True when the caller is authenticated and their profiles.role is doctor or admin.';

-- -----------------------------------------------------------------------------
-- current_patient_id - the clinical record owned by the caller's verified phone
-- -----------------------------------------------------------------------------
create or replace function public.current_patient_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.patients p
  where nullif(auth.jwt() ->> 'phone', '') is not null
    and public.normalize_phone(p.phone) = public.normalize_phone(auth.jwt() ->> 'phone')
  order by p.created_at asc nulls last
  limit 1;
$$;

comment on function public.current_patient_id() is
  'The patients.id whose phone matches the caller''s verified phone claim, or NULL.';

-- -----------------------------------------------------------------------------
-- Grants: authenticated only. anon has no session, so these would always be
-- NULL/false for it anyway; withholding execute keeps the surface minimal.
-- -----------------------------------------------------------------------------
revoke all on function public.is_staff()           from public, anon, authenticated;
revoke all on function public.current_patient_id() from public, anon, authenticated;
revoke all on function public.normalize_phone(text)   from public, anon, authenticated;
revoke all on function public.format_phone_e164(text) from public, anon, authenticated;

grant execute on function public.is_staff()           to authenticated;
grant execute on function public.current_patient_id() to authenticated;

-- normalize_phone / format_phone_e164 are internal plumbing for the RPCs and
-- policies below; they run inside SECURITY DEFINER bodies and need no direct
-- client grant.
