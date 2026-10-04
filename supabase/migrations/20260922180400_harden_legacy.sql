-- =============================================================================
-- 05 - Harden legacy objects
-- =============================================================================
-- 1. get_patient_id_by_phone(text) was SECURITY DEFINER, had no pinned
--    search_path, and was executable by anon. That is a phone enumeration
--    oracle: anyone holding the public anon key could probe arbitrary numbers
--    and learn which ones belong to a patient of this clinic.
--
--    Every application caller has been removed (see
--    src/lib/services/patientBookingService.ts - the three call sites now use
--    request_appointment / request_my_appointment instead). The function is
--    kept, not dropped, in case a Database Webhook or saved query still refers
--    to it, but its grants are stripped so only service_role and the database
--    owner can reach it.
--
-- 2. appointments.updated_by is now derived server-side from the caller's role
--    instead of being trusted from the client. The WhatsApp edge function
--    branches on this value to decide the wording of the message, so a client
--    that could forge it could make a cancellation look like it came from the
--    doctor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. get_patient_id_by_phone
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_patient_id_by_phone'
      and pg_get_function_identity_arguments(p.oid) = 'p_phone text'
  ) then
    execute 'alter function public.get_patient_id_by_phone(text) set search_path = public, pg_temp';
    execute 'revoke all on function public.get_patient_id_by_phone(text) from public';
    execute 'revoke all on function public.get_patient_id_by_phone(text) from anon';
    execute 'revoke all on function public.get_patient_id_by_phone(text) from authenticated';
    raise notice 'get_patient_id_by_phone hardened: search_path pinned, anon/authenticated grants revoked.';
  else
    raise notice 'get_patient_id_by_phone not present, nothing to harden.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. appointments.updated_by is set by the database, never by the client
-- -----------------------------------------------------------------------------
create or replace function public.appointments_set_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is NULL for the anonymous booking RPC and for service_role
  -- callers such as the edge function; both are treated as non-staff, which is
  -- the safe default for the notification wording.
  new.updated_by := case when public.is_staff() then 'doctor' else 'patient' end;
  return new;
end;
$$;

drop trigger if exists appointments_set_updated_by on public.appointments;
create trigger appointments_set_updated_by
  before insert or update on public.appointments
  for each row execute function public.appointments_set_updated_by();
