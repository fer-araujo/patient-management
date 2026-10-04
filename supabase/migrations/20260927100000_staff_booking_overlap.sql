-- =============================================================================
-- 19 - Staff bookings go through the same locked overlap check as patients
-- =============================================================================
-- Problem this file fixes:
--   Patient bookings and reschedules run inside the booking critical section
--   of migration 06: pg_advisory_xact_lock(booking_lock_key()) followed by
--   assert_slot_free(). The staff agenda, however, wrote to public.appointments
--   directly (INSERT for "Agendar Cita", UPDATE for "Reprogramar"), with no
--   overlap check at all. The doctor could double-book a slot, and a staff
--   write could race a patient booking for the same slot.
--
-- Design:
--   * staff_create_appointment() and staff_reschedule_appointment() are the
--     staff counterparts of request_my_appointment() and
--     reschedule_my_appointment(). They take the SAME advisory lock and call
--     the SAME assert_slot_free(), so the overlap rules are identical:
--       - busy = any appointment whose status is not 'cancelled'/'rejected',
--         for start_time + services.duration_mins (45 when null);
--       - any overlapping blocked_slots row is busy;
--       - the start must be in the future.
--   * The permission check (is_staff(), doctor only) runs BEFORE the lock, so
--     a caller without rights can never hold the clinic-wide booking lock.
--   * Duration is read from services.duration_mins with the same 45-minute
--     fallback, WITHOUT the is_active filter of service_duration_or_fail():
--     the doctor may still book or move an appointment for a service that is
--     hidden from the public catalog, as the direct INSERT allowed before.
--   * A staff booking is created 'confirmed'; a staff reschedule sets the
--     appointment back to 'pending', exactly like the previous direct UPDATE.
--   * Both reschedule RPCs (staff_reschedule_appointment and the patient's
--     reschedule_my_appointment, redefined here) repeat the status predicate
--     in their final UPDATE and fail when it matches nothing. The lock does not
--     serialize status changes (confirm/cancel are plain UPDATEs), so an
--     appointment cancelled between the SELECT and the UPDATE is no longer
--     silently moved back to 'pending'.
--   * The appointments_staff_all RLS policy is unchanged, so the doctor can
--     still write public.appointments directly. The appointments_prevent_overlap
--     trigger closes that path: any INSERT, or any UPDATE that moves an
--     appointment, changes its service or re-activates a cancelled/rejected
--     one, takes the same lock and runs the same assert_slot_free(). Status-only
--     changes of an active appointment (confirm, complete, cancel, reject) and
--     updates of other columns (anonymization clears cancel_reason) skip it.
--     The RPCs above already checked; the trigger re-checks inside the same
--     transaction, and advisory xact locks are re-entrant, so that is harmless.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- staff_create_appointment - "Agendar Cita" in the staff calendar
-- -----------------------------------------------------------------------------
create or replace function public.staff_create_appointment(
  p_patient_id uuid,
  p_service_id uuid,
  p_start_time timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration       integer;
  v_appointment_id uuid;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para agendar citas.' using errcode = '42501';
  end if;

  -- Same booking critical section as request_my_appointment; see migration 06.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  if p_patient_id is null
     or not exists (select 1 from public.patients p where p.id = p_patient_id) then
    raise exception 'No se encontró el paciente.' using errcode = 'P0001';
  end if;

  select coalesce(s.duration_mins, 45)
    into v_duration
  from public.services s
  where s.id = p_service_id;

  if not found then
    raise exception 'El servicio seleccionado no existe en el catálogo.' using errcode = 'P0001';
  end if;

  perform public.assert_slot_free(p_start_time, v_duration);

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (p_patient_id, p_service_id, p_start_time, 'confirmed')
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- staff_reschedule_appointment - "Reprogramar" in the calendar and the inbox
-- -----------------------------------------------------------------------------
create or replace function public.staff_reschedule_appointment(
  p_appointment_id uuid,
  p_start_time     timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration integer;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para reprogramar citas.' using errcode = '42501';
  end if;

  -- Same booking critical section as reschedule_my_appointment; see migration 06.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  select coalesce(s.duration_mins, 45)
    into v_duration
  from public.appointments a
  join public.services s on s.id = a.service_id
  where a.id = p_appointment_id
    and a.status in ('pending', 'confirmed');

  if not found then
    raise exception 'No se pudo reprogramar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;

  -- The appointment being moved must not collide with its own current slot.
  perform public.assert_slot_free(p_start_time, v_duration, p_appointment_id);

  -- Repeat the status predicate: the lock does not serialize confirm/cancel,
  -- so the appointment may have been cancelled since the SELECT above.
  update public.appointments a
     set start_time = p_start_time,
         status     = 'pending'
   where a.id = p_appointment_id
     and a.status in ('pending', 'confirmed');

  if not found then
    raise exception 'No se pudo reprogramar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- reschedule_my_appointment - redefined from migration 06
-- -----------------------------------------------------------------------------
-- Body copied verbatim from 20260922180500_booking_rpcs.sql (no later
-- migration redefines it). The only change is the status predicate on the
-- final UPDATE plus the not-found raise, for the same reason as above.
-- -----------------------------------------------------------------------------
create or replace function public.reschedule_my_appointment(
  p_appointment_id uuid,
  p_start_time     timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id uuid := public.current_patient_id();
  v_service_id uuid;
  v_duration   integer;
begin
  -- Same booking critical section as request_appointment; see the header note.
  -- A reschedule is a check-and-write against the same slot space, so it has to
  -- serialize against new bookings as well as against other reschedules.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  select a.service_id
    into v_service_id
  from public.appointments a
  where a.id = p_appointment_id
    and a.patient_id = v_patient_id
    and a.status in ('pending', 'confirmed');

  if v_service_id is null then
    raise exception 'No se pudo reprogramar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;

  v_duration := public.service_duration_or_fail(v_service_id);
  perform public.assert_slot_free(p_start_time, v_duration, p_appointment_id);

  update public.appointments a
     set start_time = p_start_time,
         status     = 'pending'
   where a.id = p_appointment_id
     and a.patient_id = v_patient_id
     and a.status in ('pending', 'confirmed');

  if not found then
    raise exception 'No se pudo reprogramar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- appointments_prevent_overlap - the same rule for direct table writes
-- -----------------------------------------------------------------------------
-- appointments_staff_all still lets the doctor INSERT/UPDATE the table through
-- the API. This trigger makes the overlap rule hold for every write, not just
-- for the RPCs.
--
-- Skipped (returns early, no lock):
--   * the row ends up 'cancelled' or 'rejected': it holds no slot;
--   * an UPDATE of an already active row that keeps start_time and service_id:
--     confirm/complete must keep working for appointments already in the past.
-- Checked (lock + assert_slot_free, excluding the row itself):
--   * every INSERT of an active row;
--   * an UPDATE that changes start_time or service_id;
--   * an UPDATE that re-activates a cancelled/rejected row, since it takes its
--     slot back. That is why status is in the trigger's column list.
--
-- assert_slot_free() also refuses a start in the past. That is intended here:
-- inserting, moving or re-activating an appointment into the past is not a
-- flow the application has, and the rule matches the RPCs. The owner role can
-- still backfill history by disabling the trigger inside its own transaction.
-- -----------------------------------------------------------------------------
create or replace function public.appointments_prevent_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration integer;
begin
  if new.status in ('cancelled', 'rejected') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.start_time is not distinct from old.start_time
     and new.service_id is not distinct from old.service_id
     and old.status not in ('cancelled', 'rejected') then
    return new;
  end if;

  -- Same booking critical section as every booking RPC; see migration 06.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  select coalesce(s.duration_mins, 45)
    into v_duration
  from public.services s
  where s.id = new.service_id;

  perform public.assert_slot_free(new.start_time, coalesce(v_duration, 45), new.id);

  return new;
end;
$$;

drop trigger if exists appointments_prevent_overlap on public.appointments;
create trigger appointments_prevent_overlap
  before insert or update of start_time, service_id, status on public.appointments
  for each row execute function public.appointments_prevent_overlap();

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.staff_create_appointment(uuid, uuid, timestamptz)  from public, anon, authenticated, service_role;
revoke all on function public.staff_reschedule_appointment(uuid, timestamptz)    from public, anon, authenticated, service_role;
revoke all on function public.appointments_prevent_overlap()                     from public, anon, authenticated;

grant execute on function public.staff_create_appointment(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.staff_reschedule_appointment(uuid, timestamptz)   to authenticated;

-- Unchanged from migration 06.
-- anon is revoked explicitly: Supabase grants new functions to anon by default,
-- and an anonymous call would otherwise take the clinic-wide booking lock.
revoke all on function public.reschedule_my_appointment(uuid, timestamptz)    from public, anon;
grant execute on function public.reschedule_my_appointment(uuid, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn  text;
  v_src text;
begin
  foreach v_fn in array array[
    'public.staff_create_appointment(uuid,uuid,timestamptz)',
    'public.staff_reschedule_appointment(uuid,timestamptz)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Migration 19 FAILED: % is missing.', v_fn using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 19 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
        using errcode = 'P0001';
    end if;

    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;

    if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff' then
      raise exception 'Migration 19 FAILED: % must check is_staff() (doctor only).', v_fn using errcode = 'P0001';
    end if;

    if v_src !~ 'pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)' then
      raise exception 'Migration 19 FAILED: % does not take the booking lock.', v_fn using errcode = 'P0001';
    end if;

    if v_src !~ 'public\.assert_slot_free\(' then
      raise exception 'Migration 19 FAILED: % does not call assert_slot_free().', v_fn using errcode = 'P0001';
    end if;

    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 19 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
    end if;

    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'Migration 19 FAILED: anon can execute %.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  -- Both reschedule RPCs re-check the status in the final UPDATE and fail when
  -- it matched nothing (the SELECT and the UPDATE each carry the predicate).
  foreach v_fn in array array[
    'public.staff_reschedule_appointment(uuid,timestamptz)',
    'public.reschedule_my_appointment(uuid,timestamptz)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Migration 19 FAILED: % is missing.', v_fn using errcode = 'P0001';
    end if;

    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;

    if (select count(*) from regexp_matches(v_src, 'a\.status in \(''pending'', ''confirmed''\)', 'g')) < 2
       or v_src !~ 'update public\.appointments a'
       or v_src !~ 'if not found then' then
      raise exception 'Migration 19 FAILED: % can still move an appointment whose status changed after it was read.', v_fn
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 19 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
        using errcode = 'P0001';
    end if;

    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 19 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
    end if;

    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'Migration 19 FAILED: anon can execute %.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  select prosrc into v_src from pg_proc
  where oid = 'public.reschedule_my_appointment(uuid,timestamptz)'::regprocedure;
  if v_src !~ 'pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
     or v_src !~ 'public\.assert_slot_free\(p_start_time, v_duration, p_appointment_id\)'
     or v_src !~ 'a\.patient_id = v_patient_id' then
    raise exception 'Migration 19 FAILED: reschedule_my_appointment() lost its lock, overlap check or ownership check.'
      using errcode = 'P0001';
  end if;

  -- The table-level trigger: a direct write cannot bypass the overlap rule.
  v_fn := 'public.appointments_prevent_overlap()';
  if to_regprocedure(v_fn) is null then
    raise exception 'Migration 19 FAILED: % is missing.', v_fn using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = v_fn::regprocedure
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 19 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
  if v_src !~ 'pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
     or v_src !~ 'public\.assert_slot_free\(new\.start_time, coalesce\(v_duration, 45\), new\.id\)' then
    raise exception 'Migration 19 FAILED: % does not take the booking lock and run assert_slot_free().', v_fn
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'Migration 19 FAILED: % is executable by anon or authenticated.', v_fn using errcode = 'P0001';
  end if;

  -- tgtype bits: 1 = row, 2 = before, 4 = insert, 16 = update.
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and t.tgname = 'appointments_prevent_overlap'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgfoid = v_fn::regprocedure
      and (t.tgtype & 1)  = 1
      and (t.tgtype & 2)  = 2
      and (t.tgtype & 4)  = 4
      and (t.tgtype & 16) = 16
      and (
        select array_agg(att.attname::text)
        from pg_attribute att
        where att.attrelid = t.tgrelid
          and att.attnum = any (t.tgattr)
      ) @> array['start_time', 'service_id', 'status']
  ) then
    raise exception 'Migration 19 FAILED: appointments_prevent_overlap is not an enabled BEFORE INSERT OR UPDATE OF start_time, service_id, status row trigger on public.appointments.'
      using errcode = 'P0001';
  end if;

  -- The overlap rule these RPCs rely on must still be the one from migration 06.
  select prosrc into v_src from pg_proc
  where oid = 'public.assert_slot_free(timestamptz,integer,uuid)'::regprocedure;
  if v_src !~ 'not in \(''cancelled'', ''rejected''\)' then
    raise exception 'Migration 19 FAILED: assert_slot_free() no longer treats every status but cancelled/rejected as busy.'
      using errcode = 'P0001';
  end if;

  raise notice 'Migration 19 PASSED: staff bookings and reschedules take the booking lock and run assert_slot_free(), both reschedule RPCs refuse an appointment whose status changed, and the appointments_prevent_overlap trigger applies the same overlap rule to direct table writes.';
end $$;
