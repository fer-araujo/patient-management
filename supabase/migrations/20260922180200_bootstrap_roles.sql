-- =============================================================================
-- 03 - Role bootstrap
-- =============================================================================
-- Two things:
--   1. Every new auth user gets a profiles row with role 'patient', so the
--      is_staff() check always has something to read and nobody ends up in the
--      undefined state of "authenticated but no profile".
--   2. The clinic's doctor account is promoted to role 'doctor'.
--
-- >>> ORDERING - THIS FILE RUNS BEFORE THE RLS REWRITE (migration 04) <<<
-- This used to be the last data migration, applied after the restrictive
-- policies were already live. That ordering was a self-lockout trap: if this
-- file failed for any reason, the database was left with least-privilege
-- policies in force and NO account holding role 'doctor'. The doctor could not
-- reach her own clinical area and could not fix it from the application.
--
-- Running the bootstrap first means the doctor's profile already says 'doctor'
-- by the time migration 04 installs the policies and the
-- profiles_block_role_escalation trigger, and it means this file executes with
-- the old permissive policies still in place, where nothing can block it.
--
-- >>> ACTION REQUIRED <<<
-- Replace REPLACE_WITH_DOCTOR_EMAIL below with the email the doctor uses on the
-- /doctor login screen, then run this file. Left unedited the file RAISES and
-- aborts on purpose: a forgotten placeholder must fail loudly here rather than
-- succeed quietly and strand the clinic behind migration 04's policies.
--
-- Until the doctor's profile says 'doctor', DoctorProtectedRoute will bounce
-- her to /dashboard. Do not skip this step, and do not continue to migration 04
-- until the assertion at the end of this file passes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Auto-provision a profile for every new auth user
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role, first_name, last_name)
  values (
    new.id,
    'patient',
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: existing auth users that never got a profile row.
-- Note this also creates the doctor's row with role 'patient'; block 2 below
-- promotes it, which is an UPDATE. See the request-context note in migration 04
-- for why that UPDATE is not blocked by profiles_block_role_escalation.
insert into public.profiles (id, role)
select u.id, 'patient'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- -----------------------------------------------------------------------------
-- 2. Promote the doctor
-- -----------------------------------------------------------------------------
do $$
declare
  v_email text := 'REPLACE_WITH_DOCTOR_EMAIL';
  v_id    uuid;
begin
  -- Edit ONLY the v_email line above. The guard checks for an '@' instead of
  -- comparing against the placeholder text, so a find-and-replace-all over
  -- this file cannot rewrite the guard into a false positive.
  if position('@' in v_email) = 0 then
    raise exception
      'Doctor promotion aborted: "%" is not an email address. Set v_email to the doctor''s real login email and run this file again BEFORE applying the RLS policies migration.', v_email
      using errcode = 'P0001';
  end if;

  select u.id into v_id
  from auth.users u
  where lower(u.email) = lower(v_email);

  if v_id is null then
    raise exception 'No auth.users row found for %. Create the account first, then run this file.', v_email;
  end if;

  insert into public.profiles (id, role)
  values (v_id, 'doctor')
  on conflict (id) do update set role = 'doctor';

  raise notice 'Promoted % to role doctor.', v_email;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Go/no-go assertion - at least one staff account must exist
-- -----------------------------------------------------------------------------
-- Migration 04 makes every clinical table staff-only. Applying it while no
-- profile holds 'doctor' or 'admin' locks the clinic out of its own data, so
-- this assertion is the gate between the two files.
-- -----------------------------------------------------------------------------
do $$
declare
  v_staff integer;
begin
  select count(*) into v_staff
  from public.profiles
  where role in ('doctor', 'admin');

  if v_staff = 0 then
    raise exception
      'No profile has role doctor or admin. Do NOT apply migration 04 (RLS policies) - it would lock the clinic out of every table.'
      using errcode = 'P0001';
  end if;

  raise notice 'Staff accounts present: %.', v_staff;
end $$;
