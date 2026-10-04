-- =============================================================================
-- 21 - Archived, suspended and anonymized patients cannot be booked
-- =============================================================================
-- Problems this file fixes:
--   "Archivar Expediente" (Directorio de Pacientes) and the ARCO anonymization
--   set patients.status = 'archived': the record is inactive and only kept for
--   the legal retention period. "Suspender Paciente" sets status = 'blocked'
--   and promises the patient "no podrá agendar nuevas citas desde el portal
--   público". None of that was enforced on the server:
--     * the doctor could book an archived patient through
--       staff_create_appointment() (migration 19);
--     * an archived or suspended patient who still signs in with the verified
--       phone of the record could book or reschedule online through
--       request_my_appointment() (migration 12) and reschedule_my_appointment()
--       (migration 19);
--     * appointments_staff_all still lets the doctor write public.appointments
--       directly, bypassing any RPC check;
--     * "Restaurar Paciente" could turn an anonymized record back to 'active'.
--
-- Design:
--   * The three RPCs and the appointments_prevent_overlap() trigger function
--     are redefined with their CURRENT bodies copied verbatim
--       - staff_create_appointment, reschedule_my_appointment and
--         appointments_prevent_overlap from 20260927100000_staff_booking_overlap.sql,
--       - request_my_appointment from 20260922181200_verified_booking.sql,
--     (no later migration redefines any of them). The only change in each is
--     the status check marked "Migration 21", raising a Spanish P0001 message.
--   * Rules:
--       - 'archived': refused everywhere (staff RPC, patient RPCs, and any
--         direct INSERT / move / re-activation through the trigger). The doctor
--         restores the record first ("Restaurar Paciente").
--       - 'blocked' (Suspendido): refused only in the patient's own RPCs. The
--         doctor can still book or move a suspended patient from the calendar,
--         which is what the "Suspender" dialog promises.
--   * The trigger check sits AFTER the trigger's early returns, so status-only
--     changes of an existing appointment (confirm, complete, cancel, reject)
--     keep working for an archived patient; only an INSERT, a move (start_time
--     or service_id) or a re-activation of a cancelled/rejected row is refused.
--   * patients_keep_anonymized_archived: a BEFORE UPDATE trigger on
--     public.patients. Once anonymized_at is set, the record's status can only
--     stay (or become) 'archived', and anonymized_at itself cannot be changed
--     or cleared (that would reopen the restore path). anonymize_patient()
--     sets both columns in one UPDATE on a not-yet-anonymized row, so it is
--     unaffected; it already refuses an anonymized row itself.
--   * Signatures, SECURITY DEFINER, the pinned search_path and the grants are
--     unchanged (restated below so a re-run always ends in the same state).
--   * Re-running migration 19 or 12 after this one would drop these checks;
--     the gate at the end detects that when this file is re-run.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- staff_create_appointment - "Agendar Cita" in the staff calendar
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 19 plus the archived check.
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

  -- Migration 21: an archived record is inactive; it must be restored first.
  if exists (
    select 1 from public.patients p
    where p.id = p_patient_id
      and p.status = 'archived'
  ) then
    raise exception 'Este paciente está archivado. Restáuralo desde el Directorio de Pacientes para agendarle una cita.'
      using errcode = 'P0001';
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
-- request_my_appointment - the patient's own booking
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 12 plus the archived/suspended check.
-- -----------------------------------------------------------------------------
create or replace function public.request_my_appointment(
  p_service_id uuid,
  p_start_time timestamptz,
  p_reason     text default null
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
  v_reason         text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Same booking critical section as every other booking path; see migration 06.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  -- Migration 21: an archived record is inactive (the clinic restores it) and
  -- a suspended patient cannot book online.
  if exists (
    select 1 from public.patients p
    where p.id = v_patient_id
      and p.status = 'archived'
  ) then
    raise exception 'Tu expediente está inactivo. Comunícate por teléfono con la clínica para agendar tu cita.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.patients p
    where p.id = v_patient_id
      and p.status = 'blocked'
  ) then
    raise exception 'Tu cuenta no puede agendar citas en línea. Comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;

  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'El motivo de la consulta es demasiado largo. Resúmelo en menos de 1000 caracteres.'
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

  insert into public.appointments (patient_id, service_id, start_time, status, reason)
  values (v_patient_id, p_service_id, p_start_time, 'pending', v_reason)
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- reschedule_my_appointment - the patient moves their own appointment
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 19 plus the archived/suspended check.
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

  -- Migration 21: an archived record is inactive (the clinic restores it) and
  -- a suspended patient cannot book online.
  if exists (
    select 1 from public.patients p
    where p.id = v_patient_id
      and p.status = 'archived'
  ) then
    raise exception 'Tu expediente está inactivo. Comunícate por teléfono con la clínica para agendar tu cita.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.patients p
    where p.id = v_patient_id
      and p.status = 'blocked'
  ) then
    raise exception 'Tu cuenta no puede agendar citas en línea. Comunícate por teléfono con la clínica.'
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
-- appointments_prevent_overlap - also refuses archived patients
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 19 plus the archived check, placed after
-- the early returns: status-only changes of an existing appointment are never
-- refused. The trigger itself (BEFORE INSERT OR UPDATE OF start_time,
-- service_id, status) is unchanged and still points at this function.
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

  -- Migration 21: no appointment is created, moved or re-activated for an
  -- archived patient, whatever the write path.
  if exists (
    select 1 from public.patients p
    where p.id = new.patient_id
      and p.status = 'archived'
  ) then
    raise exception 'Este paciente está archivado. Restáuralo desde el Directorio de Pacientes para agendarle una cita.'
      using errcode = 'P0001';
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

-- -----------------------------------------------------------------------------
-- patients_keep_anonymized_archived - an anonymized record is never restored
-- -----------------------------------------------------------------------------
create or replace function public.patients_keep_anonymized_archived()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.anonymized_at is not null
     and (new.anonymized_at is distinct from old.anonymized_at
          or (new.status is distinct from old.status
              and new.status is distinct from 'archived')) then
    raise exception 'Este expediente fue anonimizado y no se puede restaurar.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists patients_keep_anonymized_archived on public.patients;
create trigger patients_keep_anonymized_archived
  before update of status, anonymized_at on public.patients
  for each row execute function public.patients_keep_anonymized_archived();

-- -----------------------------------------------------------------------------
-- Grants (unchanged from migrations 12 and 19; trigger functions: nobody)
-- -----------------------------------------------------------------------------
revoke all on function public.staff_create_appointment(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.request_my_appointment(uuid, timestamptz, text)   from public, anon, authenticated;
revoke all on function public.reschedule_my_appointment(uuid, timestamptz)      from public, anon;
revoke all on function public.appointments_prevent_overlap()                    from public, anon, authenticated;
revoke all on function public.patients_keep_anonymized_archived()               from public, anon, authenticated;

grant execute on function public.staff_create_appointment(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.request_my_appointment(uuid, timestamptz, text)   to authenticated;
grant execute on function public.reschedule_my_appointment(uuid, timestamptz)      to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn  text;
  v_src text;
begin
  -- Every redefined function exists, is SECURITY DEFINER with a pinned
  -- search_path, refuses archived patients and kept its lock/overlap check.
  foreach v_fn in array array[
    'public.staff_create_appointment(uuid,uuid,timestamptz)',
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.reschedule_my_appointment(uuid,timestamptz)',
    'public.appointments_prevent_overlap()'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Migration 21 FAILED: % is missing.', v_fn using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 21 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
        using errcode = 'P0001';
    end if;

    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;

    if v_src !~ 'p\.status = ''archived''' then
      raise exception 'Migration 21 FAILED: % does not refuse an archived patient.', v_fn using errcode = 'P0001';
    end if;

    if v_src !~ 'pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
       or v_src !~ 'public\.assert_slot_free\(' then
      raise exception 'Migration 21 FAILED: % lost its booking lock or overlap check.', v_fn using errcode = 'P0001';
    end if;

    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'Migration 21 FAILED: anon can execute %.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  -- The callable RPCs stay callable by signed-in users.
  foreach v_fn in array array[
    'public.staff_create_appointment(uuid,uuid,timestamptz)',
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.reschedule_my_appointment(uuid,timestamptz)'
  ] loop
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 21 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  -- The patient's own RPCs also refuse a suspended patient; the staff RPC and
  -- the trigger must NOT (the doctor can still book a suspended patient).
  foreach v_fn in array array[
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.reschedule_my_appointment(uuid,timestamptz)'
  ] loop
    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
    if v_src !~ 'p\.status = ''blocked''' then
      raise exception 'Migration 21 FAILED: % does not refuse a suspended patient.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  foreach v_fn in array array[
    'public.staff_create_appointment(uuid,uuid,timestamptz)',
    'public.appointments_prevent_overlap()'
  ] loop
    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
    if v_src ~ 'blocked' then
      raise exception 'Migration 21 FAILED: % refuses suspended patients; only the patient portal may.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  select prosrc into v_src from pg_proc
  where oid = 'public.staff_create_appointment(uuid,uuid,timestamptz)'::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff' then
    raise exception 'Migration 21 FAILED: staff_create_appointment() must check is_staff() (doctor only).'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.request_my_appointment(uuid,timestamptz,text)'::regprocedure;
  if v_src !~ 'public\.current_patient_id\(\)'
     or v_src !~ 'booking_limit_pending_per_patient\(\)'
     or v_src !~ 'reason' then
    raise exception 'Migration 21 FAILED: request_my_appointment() lost its patient resolution, per-patient cap or reason.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.reschedule_my_appointment(uuid,timestamptz)'::regprocedure;
  if v_src !~ 'public\.assert_slot_free\(p_start_time, v_duration, p_appointment_id\)'
     or v_src !~ 'a\.patient_id = v_patient_id'
     or (select count(*) from regexp_matches(v_src, 'a\.status in \(''pending'', ''confirmed''\)', 'g')) < 2
     or v_src !~ 'if not found then' then
    raise exception 'Migration 21 FAILED: reschedule_my_appointment() lost its overlap, ownership or status re-check.'
      using errcode = 'P0001';
  end if;

  -- PostgREST resolves request_my_appointment by name: exactly one overload.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'request_my_appointment') <> 1 then
    raise exception 'Migration 21 FAILED: request_my_appointment has more than one overload.'
      using errcode = 'P0001';
  end if;

  -- The trigger function keeps the migration 19 rules: early returns for
  -- cancelled/rejected rows and status-only updates, and the same overlap call.
  select prosrc into v_src from pg_proc
  where oid = 'public.appointments_prevent_overlap()'::regprocedure;
  if v_src !~ 'public\.assert_slot_free\(new\.start_time, coalesce\(v_duration, 45\), new\.id\)'
     or v_src !~ 'new\.status in \(''cancelled'', ''rejected''\)'
     or v_src !~ 'old\.status not in \(''cancelled'', ''rejected''\)'
     or strpos(v_src, 'old.status not in') > strpos(v_src, 'p.status = ''archived''') then
    raise exception 'Migration 21 FAILED: appointments_prevent_overlap() lost its early returns, or checks archived patients before them (status-only updates must keep working).'
      using errcode = 'P0001';
  end if;

  -- tgtype bits: 1 = row, 2 = before, 4 = insert, 16 = update.
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and t.tgname = 'appointments_prevent_overlap'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgfoid = 'public.appointments_prevent_overlap()'::regprocedure
      and (t.tgtype & 1)  = 1
      and (t.tgtype & 2)  = 2
      and (t.tgtype & 4)  = 4
      and (t.tgtype & 16) = 16
  ) then
    raise exception 'Migration 21 FAILED: appointments_prevent_overlap is not an enabled BEFORE INSERT OR UPDATE row trigger on public.appointments (apply migration 19 first).'
      using errcode = 'P0001';
  end if;

  -- An anonymized record cannot be restored.
  v_fn := 'public.patients_keep_anonymized_archived()';
  if to_regprocedure(v_fn) is null then
    raise exception 'Migration 21 FAILED: % is missing.', v_fn using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'Migration 21 FAILED: % is executable by anon or authenticated.', v_fn using errcode = 'P0001';
  end if;

  -- tgtype bits: 1 = row, 2 = before, 16 = update.
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.patients'::regclass
      and t.tgname = 'patients_keep_anonymized_archived'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgfoid = v_fn::regprocedure
      and (t.tgtype & 1)  = 1
      and (t.tgtype & 2)  = 2
      and (t.tgtype & 16) = 16
      and (
        select array_agg(att.attname::text)
        from pg_attribute att
        where att.attrelid = t.tgrelid
          and att.attnum = any (t.tgattr)
      ) @> array['status', 'anonymized_at']
  ) then
    raise exception 'Migration 21 FAILED: patients_keep_anonymized_archived is not an enabled BEFORE UPDATE OF status, anonymized_at row trigger on public.patients.'
      using errcode = 'P0001';
  end if;

  raise notice 'Migration 21 PASSED: archived patients cannot be booked, moved or re-activated by any path, suspended patients cannot book or reschedule online (the doctor still can), status-only appointment changes still work, and an anonymized record cannot be restored.';
end $$;
