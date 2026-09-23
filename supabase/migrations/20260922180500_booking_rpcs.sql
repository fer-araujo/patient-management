-- =============================================================================
-- 06 - Booking RPCs
-- =============================================================================
-- With the new RLS in place, anon has no table-level access at all and an
-- authenticated patient is read-only. Every write a patient legitimately needs
-- goes through one of the SECURITY DEFINER functions below, each of which
-- re-checks authorization itself.
--
-- All user-visible failures raise a Spanish message, because these strings are
-- surfaced verbatim in the booking UI. Internal problems raise nothing
-- descriptive.
--
-- Naming note: appointment overlap is evaluated against statuses other than
-- 'cancelled' AND 'rejected'. The spec only excluded 'cancelled', but a
-- rejected request that keeps holding its slot is a scheduling bug - a rejected
-- appointment is by definition not going to happen.
--
-- -----------------------------------------------------------------------------
-- Concurrency: why a clinic-wide advisory lock and not an exclusion constraint
-- -----------------------------------------------------------------------------
-- assert_slot_free() reads, then a separate INSERT writes. Under READ COMMITTED
-- two concurrent callers can both pass the check and both insert, double-booking
-- the same slot. Neither SERIALIZABLE (this runs behind PgBouncer in transaction
-- mode, and a serialization failure would surface to the visitor as an opaque
-- error) nor an EXCLUDE USING gist constraint fixes that cheaply: the busy
-- window is start_time + services.duration_mins, and an exclusion constraint
-- cannot reach into another table, so it would force duration_mins to be
-- denormalized onto appointments and kept in sync with a trigger.
--
-- Instead every booking path takes pg_advisory_xact_lock() on a single
-- clinic-wide key BEFORE the free-check, which serializes check-and-insert into
-- one critical section. The lock is transaction scoped, so it is released on
-- COMMIT or ROLLBACK with no cleanup path to get wrong. A single key means all
-- bookings serialize against each other; this is a solo-doctor practice with a
-- handful of bookings a day, so the contention is irrelevant and a coarse lock
-- is far easier to reason about than a per-slot one.
-- =============================================================================

-- =============================================================================
-- TUNABLE LIMITS - the only numbers in this file you should need to change
-- =============================================================================
-- Observed volume: this practice sees roughly 100 patients per MONTH (about
-- 3-4 bookings a day) and the doctor approves or rejects every request by hand.
--
-- The ceilings below are set roughly an ORDER OF MAGNITUDE above that normal
-- traffic. They are an ABUSE CEILING, NOT A BUSINESS RULE: they must never fire
-- for legitimate patients, and if one ever does fire it means something is
-- scripting the public booking endpoint. request_appointment is granted to
-- anon, so a script with a freshly fabricated phone on every call would
-- otherwise create unlimited patient records and unlimited pending
-- appointments - each one holding a real calendar slot and firing a billable
-- WhatsApp send.
--
-- (Supabase's CAPTCHA protection covers the auth endpoints only, not arbitrary
-- RPCs, so it cannot be relied on here.)
--
-- Every limit is enforced by refusing to create new rows. Nothing below ever
-- deletes, expires or rewrites existing data, so raising a number instantly and
-- completely undoes its effect.
-- -----------------------------------------------------------------------------

-- How many NEW patient records request_appointment may create clinic-wide in a
-- rolling 60-minute window. Normal traffic is ~100 NEW patients per month.
-- Note: the count is over patients.created_at, which cannot distinguish a row
-- created by the booking RPC from one the doctor typed in the staff UI. A bulk
-- manual import of more than this many patients within an hour would therefore
-- pause public booking until the window rolls forward. Accepted: it fails
-- closed on the public endpoint only, and staff entry is unaffected.
create or replace function public.booking_limit_new_patients_per_hour()
returns integer language sql immutable set search_path = pg_temp as $$ select 30 $$;

-- Hard ceiling on appointments sitting in status 'pending' across the whole
-- clinic. Every pending row holds a calendar slot until the doctor acts on it.
-- With 3-4 bookings a day and same-week triage, a real backlog never approaches
-- this number.
create or replace function public.booking_limit_pending_clinic_wide()
returns integer language sql immutable set search_path = pg_temp as $$ select 120 $$;

-- Maximum number of simultaneously pending requests ONE patient record may
-- hold. Enforced as `count >= limit`, i.e. the limit is the maximum allowed:
-- with 3, a patient holding 3 pending requests is refused a 4th. The previous
-- `count > 3` let a 4th through before refusing the 5th.
create or replace function public.booking_limit_pending_per_patient()
returns integer language sql immutable set search_path = pg_temp as $$ select 3 $$;

-- Advisory lock key for the booking critical section. Arbitrary but stable; it
-- only has to be unique against other pg_advisory_xact_lock users in this
-- database, and this application has none.
create or replace function public.booking_lock_key()
returns bigint language sql immutable set search_path = pg_temp as $$ select 5210092226180000::bigint $$;

revoke all on function public.booking_limit_new_patients_per_hour() from public, anon, authenticated;
revoke all on function public.booking_limit_pending_clinic_wide()   from public, anon, authenticated;
revoke all on function public.booking_limit_pending_per_patient()   from public, anon, authenticated;
revoke all on function public.booking_lock_key()                    from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Internal: the two clinic-wide abuse ceilings, raised in Spanish
-- -----------------------------------------------------------------------------
-- Only request_appointment calls this. request_my_appointment is deliberately
-- exempt from the clinic-wide ceilings: it requires a verified phone session,
-- so it is not the spam vector, and letting scripted abuse of the anonymous
-- endpoint lock real patients out of their own portal would turn a spam problem
-- into a denial of service against legitimate users. The per-patient cap still
-- applies there.
-- -----------------------------------------------------------------------------
create or replace function public.assert_public_booking_capacity()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pending_total integer;
begin
  select count(*)
    into v_pending_total
  from public.appointments a
  where a.status = 'pending';

  if v_pending_total >= public.booking_limit_pending_clinic_wide() then
    raise exception 'En este momento no podemos recibir más solicitudes de cita en línea. Por favor comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.assert_new_patient_quota()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent integer;
begin
  select count(*)
    into v_recent
  from public.patients p
  where p.created_at >= now() - interval '1 hour';

  if v_recent >= public.booking_limit_new_patients_per_hour() then
    raise exception 'En este momento no podemos registrar nuevos expedientes en línea. Por favor comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.assert_public_booking_capacity() from public, anon, authenticated;
revoke all on function public.assert_new_patient_quota()       from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Internal: resolve an active service's duration or fail in Spanish
-- -----------------------------------------------------------------------------
create or replace function public.service_duration_or_fail(p_service_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration integer;
begin
  select coalesce(s.duration_mins, 45)
    into v_duration
  from public.services s
  where s.id = p_service_id
    and s.is_active = true;

  if v_duration is null then
    raise exception 'El servicio seleccionado ya no está disponible.'
      using errcode = 'P0001';
  end if;

  return v_duration;
end;
$$;

-- -----------------------------------------------------------------------------
-- Internal: fail in Spanish when the requested window collides with anything
-- -----------------------------------------------------------------------------
create or replace function public.assert_slot_free(
  p_start                timestamptz,
  p_duration_mins        integer,
  p_exclude_appointment  uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_end timestamptz := p_start + make_interval(mins => p_duration_mins);
begin
  if p_start is null or p_start <= now() then
    raise exception 'La fecha y hora seleccionadas ya no están disponibles.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.appointments a
    join public.services s on s.id = a.service_id
    where a.status not in ('cancelled', 'rejected')
      and (p_exclude_appointment is null or a.id <> p_exclude_appointment)
      and a.start_time < v_end
      and a.start_time + make_interval(mins => coalesce(s.duration_mins, 45)) > p_start
  ) then
    raise exception 'El horario seleccionado acaba de ocuparse. Por favor elige otro.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.blocked_slots b
    where b.start_time < v_end
      and b.end_time > p_start
  ) then
    raise exception 'El horario seleccionado no está disponible. Por favor elige otro.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.service_duration_or_fail(uuid)                  from public, anon, authenticated;
revoke all on function public.assert_slot_free(timestamptz, integer, uuid)    from public, anon, authenticated;

-- =============================================================================
-- get_availability - the only calendar data a public visitor ever receives
-- =============================================================================
-- Returns opaque busy ranges. No patient, no service, no block reason, no id:
-- the caller learns that a window is taken, never why or by whom.
-- =============================================================================
create or replace function public.get_availability(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (start_time timestamptz, end_time timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Rango de fechas inválido.' using errcode = 'P0001';
  end if;

  -- Caps how much of the calendar one call can reveal.
  if p_to - p_from > interval '180 days' then
    raise exception 'El rango de fechas solicitado es demasiado amplio.'
      using errcode = 'P0001';
  end if;

  return query
    select a.start_time,
           a.start_time + make_interval(mins => coalesce(s.duration_mins, 45))
    from public.appointments a
    join public.services s on s.id = a.service_id
    where a.status not in ('cancelled', 'rejected')
      and a.start_time < p_to
      and a.start_time + make_interval(mins => coalesce(s.duration_mins, 45)) > p_from
    union all
    select b.start_time, b.end_time
    from public.blocked_slots b
    where b.start_time < p_to
      and b.end_time > p_from;
end;
$$;

-- =============================================================================
-- get_clinic_schedule - weekly opening hours, and nothing else
-- =============================================================================
-- clinic_settings is staff-only now, but the booking screen still has to know
-- which days and hours the clinic is open. This exposes just the schedule jsonb
-- and never doctor_id or any other column.
-- =============================================================================
create or replace function public.get_clinic_schedule()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           (select cs.schedule
            from public.clinic_settings cs
            where cs.schedule is not null
            order by cs.updated_at desc nulls last
            limit 1),
           '{}'::jsonb
         );
$$;

-- =============================================================================
-- request_appointment - anonymous booking
-- =============================================================================
-- Finds or creates the patient record by normalized phone and files a pending
-- appointment. The return value is only the appointment id: a caller can never
-- tell from the response whether the phone already had a clinical record, so
-- this is not an enumeration oracle the way get_patient_id_by_phone was.
-- =============================================================================
create or replace function public.request_appointment(
  p_phone       text,
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_service_id  uuid,
  p_start_time  timestamptz,
  p_reason      text,
  p_referred_by text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone          text;
  v_duration       integer;
  v_patient_id     uuid;
  v_pending_count  integer;
  v_appointment_id uuid;
  v_reason         text;
begin
  -- Serialize the whole check-and-insert against every other booking path.
  -- Taken first, before any read, so the free-check below cannot race.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  v_phone := public.normalize_phone(p_phone);

  if v_phone is null or length(v_phone) < 10 then
    raise exception 'El número de teléfono no es válido.' using errcode = 'P0001';
  end if;

  v_duration := public.service_duration_or_fail(p_service_id);

  -- Abuse ceiling: clinic-wide pending backlog. See TUNABLE LIMITS at the top.
  perform public.assert_public_booking_capacity();

  select p.id
    into v_patient_id
  from public.patients p
  where public.normalize_phone(p.phone) = v_phone
  order by p.created_at asc nulls last
  limit 1;

  -- Anti-spam: no record may stack up unconfirmed requests.
  --
  -- This used to run only when the phone already had a record, which made the
  -- cap trivially bypassable - a fabricated phone per call skipped it entirely.
  -- A phone with no record has zero pending appointments, so evaluating the
  -- same rule unconditionally is correct for both cases and removes the branch.
  select count(*)
    into v_pending_count
  from public.appointments a
  where a.patient_id = v_patient_id
    and a.status = 'pending';

  if v_pending_count >= public.booking_limit_pending_per_patient() then
    raise exception 'Tienes demasiadas solicitudes de cita pendientes de confirmación. Comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;

  perform public.assert_slot_free(p_start_time, v_duration);

  if v_patient_id is null then
    -- Abuse ceiling: rolling-window cap on brand new clinical records.
    perform public.assert_new_patient_quota();

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');

    insert into public.patients (
      first_name, last_name, phone, email, status, referred_by, notes
    )
    values (
      coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), 'Paciente'),
      coalesce(nullif(btrim(coalesce(p_last_name, '')), ''), 'Sin apellido'),
      public.format_phone_e164(v_phone),
      nullif(btrim(coalesce(p_email, '')), ''),
      'active',
      nullif(btrim(coalesce(p_referred_by, '')), ''),
      case when v_reason is not null then 'Motivo inicial: ' || v_reason else null end
    )
    returning id into v_patient_id;
  end if;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient_id, p_service_id, p_start_time, 'pending')
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

-- =============================================================================
-- request_my_appointment - booking from the logged-in patient dashboard
-- =============================================================================
-- Same validation, but the patient is resolved from the verified phone claim
-- instead of being passed in, so a session can only book for itself.
-- =============================================================================
create or replace function public.request_my_appointment(
  p_service_id uuid,
  p_start_time timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id     uuid := public.current_patient_id();
  v_duration       integer;
  v_pending_count  integer;
  v_appointment_id uuid;
begin
  -- Same booking critical section as request_appointment; see the header note.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  v_duration := public.service_duration_or_fail(p_service_id);

  select count(*)
    into v_pending_count
  from public.appointments a
  where a.patient_id = v_patient_id
    and a.status = 'pending';

  if v_pending_count >= public.booking_limit_pending_per_patient() then
    raise exception 'Tienes demasiadas solicitudes de cita pendientes de confirmación. Comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;

  perform public.assert_slot_free(p_start_time, v_duration);

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient_id, p_service_id, p_start_time, 'pending')
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

-- =============================================================================
-- cancel_my_appointment / reschedule_my_appointment
-- =============================================================================
-- Patients have no UPDATE privilege on appointments any more, but the portal
-- has always let them cancel and reschedule their own. These two RPCs preserve
-- that behavior while proving ownership server-side.
-- =============================================================================
create or replace function public.cancel_my_appointment(
  p_appointment_id uuid,
  p_reason         text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id uuid := public.current_patient_id();
begin
  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  update public.appointments a
     set status        = 'cancelled',
         cancel_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cancelada por el paciente')
   where a.id = p_appointment_id
     and a.patient_id = v_patient_id
     and a.status in ('pending', 'confirmed');

  if not found then
    raise exception 'No se pudo cancelar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;
end;
$$;

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
     and a.patient_id = v_patient_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.get_availability(timestamptz, timestamptz)      from public;
revoke all on function public.get_clinic_schedule()                           from public;
revoke all on function public.request_appointment(text, text, text, text, uuid, timestamptz, text, text) from public;
revoke all on function public.request_my_appointment(uuid, timestamptz)       from public;
revoke all on function public.cancel_my_appointment(uuid, text)               from public;
revoke all on function public.reschedule_my_appointment(uuid, timestamptz)    from public;

grant execute on function public.get_availability(timestamptz, timestamptz)   to anon, authenticated;
grant execute on function public.get_clinic_schedule()                        to anon, authenticated;
grant execute on function public.request_appointment(text, text, text, text, uuid, timestamptz, text, text) to anon, authenticated;
grant execute on function public.request_my_appointment(uuid, timestamptz)    to authenticated;
grant execute on function public.cancel_my_appointment(uuid, text)            to authenticated;
grant execute on function public.reschedule_my_appointment(uuid, timestamptz) to authenticated;
