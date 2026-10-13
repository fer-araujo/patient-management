-- =============================================================================
-- 27 - Security hardening from the whole-codebase audit
-- =============================================================================
-- Problems this file fixes (audit findings in brackets):
--   [F1]  A patient could SELECT their own patients row, including the
--         doctor's private "Recordatorios Internos" (patients.notes). The
--         portal itself requested it on every dashboard load.
--   [F2]  Doctor-only mode closed the patient WRITE RPCs but not the reads:
--         a session holding the phone the doctor typed could still read the
--         record, the appointments, the prescriptions, the files and the
--         export while "the portal is closed".
--   [NV1] Patient identity rested on the JWT phone claim alone. A session
--         whose phone was never confirmed (for example a phone+password
--         sign-up with confirmations off) could claim any patient's phone.
--   [F3]  A patient could cancel or reschedule an appointment that had
--         already started, or that already carried a consultation record.
--   [F4]  Online booking trusted the browser for the opening hours, the
--         15-minute slot grid and how far ahead a visit may be booked.
--   [F5]  Patient reschedules were unlimited, and each one fires a billable
--         WhatsApp message.
--   [F6]  Patients saw DRAFT prescriptions, before the consultation closed.
--   [NV2] The admin could read inventory_movements.appointment_id (which
--         consultation used which supply). payments.note and the payment
--         ids were already closed by migration 26.
--   [NV3] The clinical_records bucket was never forced private.
--
-- Design:
--   * caller_phone_is_verified() (internal, no grant): true when the auth
--     user behind auth.uid() has phone_confirmed_at set AND its stored phone
--     matches the JWT phone claim (both normalized). The amr claim is NOT
--     used. current_patient_id() and register_me() require it.
--   * current_patient_id() also returns NULL while get_clinic_mode() is true.
--     It is the single choke point of every patient read policy
--     (*_select_own, the clinical_records storage read), export_my_data()
--     and every patient RPC, so doctor-only mode now closes them all. No
--     staff policy or staff RPC calls it (checked by the gate).
--   * patients_select_own is dropped: a patient reads NO patients row
--     directly. get_my_profile() (SECURITY DEFINER) returns id, first name,
--     last name, phone and email of the caller's own record, never notes or
--     any clinical column. The doctor's policy (patients_staff_all) is
--     unchanged, so she still reads and writes notes.
--   * prescriptions_select_own adds finalized_at is not null.
--   * inventory_movements_select_staff: the doctor reads every row; the
--     admin reads only rows with no appointment (purchases, adjustments,
--     manual uses), so Finanzas keeps its purchases. The item history goes
--     through get_item_movements(item), which returns every movement of the
--     item WITHOUT appointment_id, for doctor and admin alike.
--   * assert_patient_booking_window(start, minutes) (internal) enforces, in
--     America/Monterrey: at most booking_horizon_days() (120, the browser's
--     AVAILABILITY_WINDOW_DAYS) ahead; the 15-minute grid of
--     calendarUtils.buildDayCandidates (minute 0/15/30/45, no seconds); an
--     open weekday in clinic_settings.schedule (keys "0".."6", Sunday = 0,
--     "08:00 AM" times; the same row get_clinic_schedule() returns, or
--     settingsService.DEFAULT_SCHEDULE when none was saved); start at or
--     after opening and start + duration at or before closing. Only the
--     patient RPCs call it; the staff RPCs keep booking anywhere.
--   * appointments.patient_reschedule_count, written only by
--     reschedule_my_appointment(): a BEFORE trigger forces 0 on insert and
--     refuses any change unless the transaction-local flag
--     app.patient_reschedule holds that row's id (same pattern as
--     app.inventory_ledger; the API cannot set it). At most
--     patient_reschedule_limit() (3) online reschedules per appointment.
--   * cancel_my_appointment() and reschedule_my_appointment() refuse an
--     appointment whose start_time is not in the future, or that has a
--     clinical note or a prescription.
--   * storage.buckets: clinical_records and prescriber_private are forced to
--     public = false.
--   * The internal helpers, the two limit constants and the new trigger
--     function are not executable by anon, authenticated or service_role.
--     The gate repeats migration 26's surface check (by signature, guards
--     matched as code with comments and strings stripped) including the two
--     new RPCs, and exercises the booking window: a malformed schedule gives
--     the friendly message and a 00:00 closing time means midnight.
--
-- Function bodies are copied verbatim from their latest migration (named in
-- each section) and only the marked "Migration 27" lines are added.
--
-- DEPLOY ORDER: run this file, then deploy the frontend. The new portal reads
-- its profile through get_my_profile() and the item history through
-- get_item_movements(); an old frontend keeps working against this database
-- except the patient profile card (it read patients directly).
--
-- Note for maintainers: re-running migrations 02, 05, 18, 23 or 25 restores
-- older bodies of current_patient_id(), the patient policies,
-- inventory_movements_select_staff or the patient RPCs. Run this file again
-- afterwards.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- [NV1] caller_phone_is_verified - the caller's phone was confirmed by Auth
-- -----------------------------------------------------------------------------
create or replace function public.caller_phone_is_verified()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.phone_confirmed_at is not null
      and nullif(auth.jwt() ->> 'phone', '') is not null
      and public.normalize_phone(u.phone) = public.normalize_phone(auth.jwt() ->> 'phone')
  );
$$;

comment on function public.caller_phone_is_verified() is
  'True when the auth user behind auth.uid() has a confirmed phone equal to the JWT phone claim. Internal: called by current_patient_id() and register_me().';

revoke all on function public.caller_phone_is_verified() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- [NV1, F2] current_patient_id - migration 02 body + verified phone + mode
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
    -- Migration 27: the phone must be confirmed by Auth, and doctor-only mode
    -- closes every patient read and write.
    and public.caller_phone_is_verified()
    and not public.get_clinic_mode()
  order by p.created_at asc nulls last
  limit 1;
$$;

comment on function public.current_patient_id() is
  'The patients.id whose phone matches the caller''s CONFIRMED phone (auth.users.phone_confirmed_at), or NULL. Always NULL in doctor-only mode.';

revoke all on function public.current_patient_id() from public, anon, authenticated;
grant execute on function public.current_patient_id() to authenticated;

-- -----------------------------------------------------------------------------
-- [NV1] register_me - migration 23 body + verified phone
-- -----------------------------------------------------------------------------
create or replace function public.register_me(
  p_first_name             text,
  p_last_name              text,
  p_email                  text,
  p_referred_by            text,
  p_dob_year               integer,
  p_privacy_notice_version text,
  p_user_agent             text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone      text := public.normalize_phone(auth.jwt() ->> 'phone');
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_patient_id uuid;
begin
  -- Migration 23: no online registration in doctor-only mode.
  perform public.assert_patient_portal_open(
    'La clínica no está recibiendo registros en línea. Comunícate por teléfono.');

  if v_phone is null or length(v_phone) < 10 then
    raise exception 'No pudimos verificar tu número de teléfono. Vuelve a ingresarlo para continuar.'
      using errcode = 'P0001';
  end if;

  -- Migration 27: the phone must have been confirmed by Auth (OTP).
  if not public.caller_phone_is_verified() then
    raise exception 'No pudimos verificar tu número de teléfono. Vuelve a ingresarlo para continuar.'
      using errcode = 'P0001';
  end if;

  -- Doctor AND admin: no clinic staff account may become a patient record.
  if public.is_business_staff() then
    raise exception 'Las cuentas del personal de la clínica no pueden registrarse como pacientes.'
      using errcode = 'P0001';
  end if;

  perform public.assert_current_notice_version(p_privacy_notice_version);

  -- Serialize concurrent registrations of the SAME phone, so a double submit
  -- cannot create two records. Other phones are not blocked.
  perform pg_advisory_xact_lock(hashtextextended('register_me:' || v_phone, 0));

  v_patient_id := public.current_patient_id();

  if v_patient_id is null then
    if v_first_name is null then
      raise exception 'Escribe tu nombre para continuar.' using errcode = 'P0001';
    end if;

    if p_dob_year is not null
       and (p_dob_year < 1900 or p_dob_year > extract(year from now())::int) then
      raise exception 'El año de nacimiento no es válido.' using errcode = 'P0001';
    end if;

    -- Abuse ceiling: rolling-window cap on brand new clinical records.
    perform public.assert_new_patient_quota();

    insert into public.patients (
      first_name, last_name, phone, email, dob, status, referred_by
    )
    values (
      v_first_name,
      coalesce(nullif(btrim(coalesce(p_last_name, '')), ''), 'Sin apellido'),
      public.format_phone_e164(v_phone),
      nullif(btrim(coalesce(p_email, '')), ''),
      case when p_dob_year is null then null else make_date(p_dob_year, 1, 1) end,
      'active',
      nullif(btrim(coalesce(p_referred_by, '')), '')
    )
    returning id into v_patient_id;
  end if;

  if not public.has_current_consent(v_patient_id) then
    insert into public.consents (patient_id, document, version, user_agent)
    values (
      v_patient_id,
      'aviso_privacidad',
      p_privacy_notice_version,
      left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512)
    );
  end if;

  return v_patient_id;
end;
$$;

revoke all on function public.register_me(text, text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.register_me(text, text, text, text, integer, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [F1] patients: no direct patient read; get_my_profile instead
-- -----------------------------------------------------------------------------
drop policy if exists "patients_select_own" on public.patients;

create or replace function public.get_my_profile()
returns table (
  id         uuid,
  first_name text,
  last_name  text,
  phone      text,
  email      text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.first_name, p.last_name, p.phone, p.email
  from public.patients p
  where p.id = public.current_patient_id();
$$;

comment on function public.get_my_profile() is
  'The caller''s own patient record for the portal: id, names, phone and email. Never notes or any clinical column. Empty without a verified phone or in doctor-only mode.';

revoke all on function public.get_my_profile() from public, anon, authenticated, service_role;
grant execute on function public.get_my_profile() to authenticated;

-- -----------------------------------------------------------------------------
-- [F6] prescriptions_select_own - migration 05 body + finalized only
-- -----------------------------------------------------------------------------
drop policy if exists "prescriptions_select_own" on public.prescriptions;
create policy "prescriptions_select_own"
  on public.prescriptions for select to authenticated
  using (patient_id = public.current_patient_id() and finalized_at is not null);

-- -----------------------------------------------------------------------------
-- [NV2] inventory_movements: consultation uses are doctor-only
-- -----------------------------------------------------------------------------
-- Migration 18 body (is_business_staff()) narrowed for the admin to rows that
-- are not tied to an appointment.
drop policy if exists "inventory_movements_select_staff" on public.inventory_movements;
create policy "inventory_movements_select_staff"
  on public.inventory_movements for select to authenticated
  using (public.is_staff() or (public.is_business_staff() and appointment_id is null));

create or replace function public.get_item_movements(p_item_id uuid)
returns table (
  id          uuid,
  item_id     uuid,
  type        text,
  quantity    integer,
  unit_cost   numeric,
  total_cost  numeric,
  note        text,
  created_by  uuid,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_business_staff() then
    raise exception 'No tienes permisos para ver el inventario.' using errcode = '42501';
  end if;

  return query
  select m.id, m.item_id, m.type, m.quantity, m.unit_cost, m.total_cost,
         m.note, m.created_by, m.created_at
  from public.inventory_movements m
  where m.item_id = p_item_id
  order by m.created_at desc, m.id desc;
end;
$$;

comment on function public.get_item_movements(uuid) is
  'Stock history of one item for business staff, without the consultation (appointment_id) a use was recorded for.';

revoke all on function public.get_item_movements(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_item_movements(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [F4] Booking window for the patient RPCs
-- -----------------------------------------------------------------------------
create or replace function public.booking_horizon_days()
returns integer language sql immutable set search_path = pg_temp as $$ select 120 $$;

create or replace function public.patient_reschedule_limit()
returns integer language sql immutable set search_path = pg_temp as $$ select 3 $$;

revoke all on function public.booking_horizon_days()     from public, anon, authenticated, service_role;
revoke all on function public.patient_reschedule_limit() from public, anon, authenticated, service_role;

create or replace function public.assert_patient_booking_window(
  p_start         timestamptz,
  p_duration_mins integer
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_local    timestamp := p_start at time zone 'America/Monterrey';
  v_today    date      := (now() at time zone 'America/Monterrey')::date;
  v_schedule jsonb;
  v_day      jsonb;
  v_is_open  boolean;
  v_open     time;
  v_close    time;
  v_close_at timestamp;
begin
  if p_start is null or p_duration_mins is null or p_duration_mins <= 0 then
    raise exception 'Elige uno de los horarios disponibles.' using errcode = 'P0001';
  end if;

  if v_local::date >= v_today + public.booking_horizon_days() then
    raise exception 'Solo puedes agendar con hasta % días de anticipación.', public.booking_horizon_days()
      using errcode = 'P0001';
  end if;

  -- The 15-minute grid of calendarUtils.buildDayCandidates.
  if extract(second from v_local) <> 0 or extract(minute from v_local)::integer % 15 <> 0 then
    raise exception 'Elige uno de los horarios disponibles.' using errcode = 'P0001';
  end if;

  -- The same row get_clinic_schedule() publishes.
  select cs.schedule
    into v_schedule
  from public.clinic_settings cs
  where cs.schedule is not null
  order by cs.updated_at desc nulls last
  limit 1;

  if v_schedule is null or v_schedule = '{}'::jsonb then
    -- settingsService.DEFAULT_SCHEDULE: what the browser shows when no
    -- schedule was saved. Keep both in sync.
    v_schedule := '{
      "0": {"isOpen": false, "start": "09:00 AM", "end": "06:00 PM"},
      "1": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
      "2": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
      "3": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
      "4": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
      "5": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
      "6": {"isOpen": true,  "start": "09:00 AM", "end": "02:00 PM"}
    }'::jsonb;
  end if;

  v_day := v_schedule -> (extract(dow from v_local)::integer)::text;

  -- Every cast of the stored schedule is guarded: a malformed value means the
  -- schedule is broken, not the request, and the patient gets a clear
  -- message. The time type reads both "08:00 AM" (what the settings screen
  -- saves) and "18:00".
  begin
    v_is_open := coalesce((v_day ->> 'isOpen')::boolean, false);
    if v_is_open then
      v_open  := (v_day ->> 'start')::time;
      v_close := (v_day ->> 'end')::time;
    end if;
  exception when others then
    raise exception 'No pudimos leer el horario de la clínica. Comunícate por teléfono para agendar.'
      using errcode = 'P0001';
  end;

  if not v_is_open then
    raise exception 'La clínica no abre ese día. Elige otra fecha.' using errcode = 'P0001';
  end if;

  if v_open is null or v_close is null then
    raise exception 'No pudimos leer el horario de la clínica. Comunícate por teléfono para agendar.'
      using errcode = 'P0001';
  end if;

  -- A closing time of 00:00 ("12:00 AM") means midnight at the END of the day.
  v_close_at := case
                  when v_close = time '00:00' then v_local::date + interval '1 day'
                  else v_local::date + v_close
                end;

  if v_local::time < v_open
     or v_local + make_interval(mins => p_duration_mins) > v_close_at then
    raise exception 'Ese horario está fuera del horario de atención. Elige otra hora.' using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.assert_patient_booking_window(timestamptz, integer) is
  'Patient bookings only: within booking_horizon_days(), on the 15-minute grid, on an open weekday and inside its opening hours (America/Monterrey). Internal.';

revoke all on function public.assert_patient_booking_window(timestamptz, integer) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- [F5] appointments.patient_reschedule_count, written only by the RPC
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column if not exists patient_reschedule_count integer not null default 0;

alter table public.appointments drop constraint if exists appointments_patient_reschedule_count_check;
alter table public.appointments add constraint appointments_patient_reschedule_count_check
  check (patient_reschedule_count >= 0);

comment on column public.appointments.patient_reschedule_count is
  'Online reschedules made by the patient (reschedule_my_appointment). Written only by that RPC.';

create or replace function public.appointments_guard_reschedule_count()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.patient_reschedule_count := 0;
  elsif new.patient_reschedule_count is distinct from old.patient_reschedule_count
        and coalesce(current_setting('app.patient_reschedule', true), '') <> old.id::text then
    raise exception 'El número de reprogramaciones solo cambia al reprogramar en línea.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.appointments_guard_reschedule_count() from public, anon, authenticated, service_role;

drop trigger if exists appointments_guard_reschedule_count on public.appointments;
create trigger appointments_guard_reschedule_count
  before insert or update on public.appointments
  for each row execute function public.appointments_guard_reschedule_count();

-- -----------------------------------------------------------------------------
-- [F4] request_my_appointment - migration 23 body + booking window
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
  -- Migration 23: no online booking in doctor-only mode.
  perform public.assert_patient_portal_open();

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

  -- Migration 27: opening hours, slot grid and horizon, on the server.
  perform public.assert_patient_booking_window(p_start_time, v_duration);

  perform public.assert_slot_free(p_start_time, v_duration);

  insert into public.appointments (patient_id, service_id, start_time, status, reason)
  values (v_patient_id, p_service_id, p_start_time, 'pending', v_reason)
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

revoke all on function public.request_my_appointment(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.request_my_appointment(uuid, timestamptz, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [F3, F4, F5] reschedule_my_appointment - migration 23 body + checks
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
  v_current    timestamptz;
  v_count      integer;
  v_rows       integer;
begin
  -- Migration 23: no online changes in doctor-only mode.
  perform public.assert_patient_portal_open();

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

  select a.service_id, a.start_time, a.patient_reschedule_count
    into v_service_id, v_current, v_count
  from public.appointments a
  where a.id = p_appointment_id
    and a.patient_id = v_patient_id
    and a.status in ('pending', 'confirmed');

  if v_service_id is null then
    raise exception 'No se pudo reprogramar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;

  -- Migration 27: a visit that started or has a consultation record stays put.
  if v_current <= now() then
    raise exception 'Esta cita ya comenzó o ya pasó; no se puede reprogramar en línea. Comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.clinical_notes cn where cn.appointment_id = p_appointment_id)
     or exists (select 1 from public.prescriptions rx where rx.appointment_id = p_appointment_id) then
    raise exception 'Esta cita ya tiene registro de consulta; no se puede reprogramar en línea. Comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;

  -- Migration 27: each online reschedule sends a WhatsApp message.
  if v_count >= public.patient_reschedule_limit() then
    raise exception 'Ya reprogramaste esta cita % veces. Para cambiarla de nuevo, comunícate por teléfono con la clínica.',
      public.patient_reschedule_limit()
      using errcode = 'P0001';
  end if;

  v_duration := public.service_duration_or_fail(v_service_id);

  -- Migration 27: opening hours, slot grid and horizon, on the server.
  perform public.assert_patient_booking_window(p_start_time, v_duration);

  perform public.assert_slot_free(p_start_time, v_duration, p_appointment_id);

  -- Migration 27: only this RPC may move the counter (see the guard trigger).
  perform set_config('app.patient_reschedule', p_appointment_id::text, true);

  update public.appointments a
     set start_time               = p_start_time,
         status                   = 'pending',
         patient_reschedule_count = a.patient_reschedule_count + 1
   where a.id = p_appointment_id
     and a.patient_id = v_patient_id
     and a.status in ('pending', 'confirmed')
     and a.start_time > now()
     and a.patient_reschedule_count < public.patient_reschedule_limit();

  get diagnostics v_rows = row_count;
  perform set_config('app.patient_reschedule', '', true);

  if v_rows = 0 then
    raise exception 'No se pudo reprogramar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.reschedule_my_appointment(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reschedule_my_appointment(uuid, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- [F3] cancel_my_appointment - migration 23 body + started / recorded checks
-- -----------------------------------------------------------------------------
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
  v_current    timestamptz;
begin
  -- Migration 23: no online changes in doctor-only mode.
  perform public.assert_patient_portal_open();

  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  -- Migration 27: a visit that started or has a consultation record stays.
  select a.start_time
    into v_current
  from public.appointments a
  where a.id = p_appointment_id
    and a.patient_id = v_patient_id
    and a.status in ('pending', 'confirmed');

  if found then
    if v_current <= now() then
      raise exception 'Esta cita ya comenzó o ya pasó; no se puede cancelar en línea. Comunícate por teléfono con la clínica.'
        using errcode = 'P0001';
    end if;

    if exists (select 1 from public.clinical_notes cn where cn.appointment_id = p_appointment_id)
       or exists (select 1 from public.prescriptions rx where rx.appointment_id = p_appointment_id) then
      raise exception 'Esta cita ya tiene registro de consulta; no se puede cancelar en línea. Comunícate por teléfono con la clínica.'
        using errcode = 'P0001';
    end if;
  end if;

  update public.appointments a
     set status        = 'cancelled',
         cancel_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cancelada por el paciente')
   where a.id = p_appointment_id
     and a.patient_id = v_patient_id
     and a.status in ('pending', 'confirmed')
     and a.start_time > now();

  if not found then
    raise exception 'No se pudo cancelar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.cancel_my_appointment(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_my_appointment(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [NV3] Private buckets stay private
-- -----------------------------------------------------------------------------
update storage.buckets
   set public = false
 where id in ('clinical_records', 'prescriber_private')
   and public is distinct from false;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
-- Function bodies are matched as CODE: comments and string literals are
-- stripped, the case is lowered and whitespace collapsed, so a guard that only
-- appears in a comment or a message never passes. Functions are identified
-- by signature (regprocedure), never by name.
do $$
declare
  v_fn    text;
  v_src   text;
  v_clean text;
  v_bad   text;
  v_state text;
  v_cols  text[];
  v_ok    boolean;
  v_rec   record;
  v_day   date := (now() at time zone 'America/Monterrey')::date + 7;
begin
  -- 1. [NV1, F2] current_patient_id: verified phone and the mode.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') into v_clean from pg_proc where oid = 'public.current_patient_id()'::regprocedure;
  if v_clean !~ 'and public\.caller_phone_is_verified\(\)' or v_clean !~ 'and not public\.get_clinic_mode\(\)' then
    raise exception 'Migration 27 FAILED: current_patient_id() must require a verified phone and return NULL in doctor-only mode.'
      using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') into v_clean from pg_proc where oid = 'public.caller_phone_is_verified()'::regprocedure;
  if v_clean !~ 'u\.id = auth\.uid\(\)' or v_clean !~ 'u\.phone_confirmed_at is not null' or v_clean ~ 'amr' then
    raise exception 'Migration 27 FAILED: caller_phone_is_verified() must check auth.users.phone_confirmed_at for auth.uid().'
      using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') into v_clean from pg_proc
  where oid = 'public.register_me(text,text,text,text,integer,text,text)'::regprocedure;
  if v_clean !~ 'if not public\.caller_phone_is_verified\(\) then raise'
     or v_clean !~ 'perform public\.assert_patient_portal_open\('
     or v_clean !~ 'if public\.is_business_staff\(\) then raise' then
    raise exception 'Migration 27 FAILED: register_me() must require a verified phone and keep its mode and staff checks.'
      using errcode = 'P0001';
  end if;

  -- Internal helpers: nobody calls them through the API.
  foreach v_fn in array array[
    'public.caller_phone_is_verified()',
    'public.assert_patient_booking_window(timestamptz,integer)',
    'public.booking_horizon_days()',
    'public.patient_reschedule_limit()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Migration 27 FAILED: internal helper % is executable by anon, authenticated or service_role.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- No staff function depends on current_patient_id() (register_me only
  -- refuses staff; it is matched by signature).
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid <> 'public.register_me(text,text,text,text,integer,text,text)'::regprocedure
    and regexp_replace(lower(regexp_replace(coalesce(p.prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') ~ 'public\.current_patient_id\(\)'
    and regexp_replace(lower(regexp_replace(coalesce(p.prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') ~ '\mis_(business_)?staff\(';
  if v_bad is not null then
    raise exception 'Migration 27 FAILED: staff functions depend on current_patient_id(): %.', v_bad using errcode = 'P0001';
  end if;

  -- With no request context the caller is nobody: NULL.
  if public.current_patient_id() is not null then
    raise exception 'Migration 27 FAILED: current_patient_id() answered a caller with no session.' using errcode = 'P0001';
  end if;

  -- 2. [F1] No direct patient read of patients; get_my_profile has no notes.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'patients'
      and policyname <> 'patients_staff_all'
  ) then
    raise exception 'Migration 27 FAILED: patients has a policy other than patients_staff_all.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'patients' and policyname = 'patients_staff_all'
      and qual ~ '\mis_staff\(' and qual !~ 'is_business_staff'
  ) then
    raise exception 'Migration 27 FAILED: patients_staff_all is missing or not doctor-only.' using errcode = 'P0001';
  end if;

  v_fn := 'public.get_my_profile()';
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g'),
         array(select a.name from unnest(proargnames, proargmodes) as a(name, mode)
               where a.mode = 't' order by a.name)
    into v_clean, v_cols
  from pg_proc where oid = to_regprocedure(v_fn) and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null or v_clean !~ 'where p\.id = public\.current_patient_id\(\)' or v_clean ~ '\mnotes\M'
     or v_cols is distinct from array['email', 'first_name', 'id', 'last_name', 'phone']::text[] then
    raise exception 'Migration 27 FAILED: get_my_profile() must be SECURITY DEFINER, filter by current_patient_id() and return only id, names, phone and email.'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'Migration 27 FAILED: get_my_profile() must be executable by authenticated only.' using errcode = 'P0001';
  end if;

  -- 3. [F6] Patients see finalized prescriptions only.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'prescriptions' and policyname = 'prescriptions_select_own'
      and cmd = 'SELECT' and qual ~ 'current_patient_id\(\)' and qual ~ 'finalized_at IS NOT NULL'
  ) then
    raise exception 'Migration 27 FAILED: prescriptions_select_own must require finalized_at is not null.' using errcode = 'P0001';
  end if;

  -- 4. [NV2] Admin: no payment rows, no consultation movements.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments'
      and (coalesce(qual, '') ~ 'is_business_staff' or coalesce(with_check, '') ~ 'is_business_staff')
  ) then
    raise exception 'Migration 27 FAILED: a payments policy lets the admin read rows (payments.note, ids). Re-run migration 26.'
      using errcode = 'P0001';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'inventory_movements') <> 1
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'inventory_movements'
         and policyname = 'inventory_movements_select_staff' and cmd = 'SELECT'
         and qual ~ '\mis_staff\(' and qual ~ 'is_business_staff\(\) AND \(appointment_id IS NULL\)'
     ) then
    raise exception 'Migration 27 FAILED: inventory_movements_select_staff must give the admin only rows with no appointment.'
      using errcode = 'P0001';
  end if;

  v_fn := 'public.get_item_movements(uuid)';
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g'),
         array(select a.name from unnest(proargnames, proargmodes) as a(name, mode)
               where a.mode = 't' order by a.name)
    into v_clean, v_cols
  from pg_proc where oid = to_regprocedure(v_fn) and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null or v_clean !~ 'if not public\.is_business_staff\(\) then raise' or v_clean ~ 'appointment'
     or 'appointment_id' = any (v_cols) then
    raise exception 'Migration 27 FAILED: get_item_movements() must be SECURITY DEFINER, refuse non business staff and never return appointment_id.'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'Migration 27 FAILED: get_item_movements() must be executable by authenticated only.' using errcode = 'P0001';
  end if;

  -- 5. [F3, F4, F5] Patient booking RPCs.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') into v_clean from pg_proc where oid = 'public.request_my_appointment(uuid,timestamptz,text)'::regprocedure;
  if v_clean !~ 'perform public\.assert_patient_booking_window\(p_start_time, v_duration\)'
     or v_clean !~ 'perform public\.assert_patient_portal_open\(' then
    raise exception 'Migration 27 FAILED: request_my_appointment() must check the booking window.' using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') into v_clean from pg_proc where oid = 'public.reschedule_my_appointment(uuid,timestamptz)'::regprocedure;
  if v_clean !~ 'perform public\.assert_patient_booking_window\(p_start_time, v_duration\)'
     or v_clean !~ 'if v_current <= now\(\) then raise'
     or v_clean !~ 'exists \(select 1 from public\.clinical_notes cn where cn\.appointment_id = p_appointment_id\)'
     or v_clean !~ 'if v_count >= public\.patient_reschedule_limit\(\) then raise'
     or v_clean !~ 'set_config\( ?, p_appointment_id::text, true\)' then
    raise exception 'Migration 27 FAILED: reschedule_my_appointment() must check the window, the start, the consultation record and the reschedule limit.'
      using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g') into v_clean from pg_proc where oid = 'public.cancel_my_appointment(uuid,text)'::regprocedure;
  if v_clean !~ 'if v_current <= now\(\) then raise'
     or v_clean !~ 'exists \(select 1 from public\.clinical_notes cn where cn\.appointment_id = p_appointment_id\)'
     or v_clean !~ 'and a\.start_time > now\(\)' then
    raise exception 'Migration 27 FAILED: cancel_my_appointment() must refuse a started or recorded appointment.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'appointments_guard_reschedule_count' and tgenabled <> 'D'
      and tgfoid = 'public.appointments_guard_reschedule_count()'::regprocedure
  ) then
    raise exception 'Migration 27 FAILED: the reschedule counter guard trigger is missing or disabled.' using errcode = 'P0001';
  end if;

  -- Behavior of the window, as the owner (no session needed).
  v_state := null;
  begin
    perform public.assert_patient_booking_window(now() + make_interval(days => public.booking_horizon_days() + 1), 30);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'Migration 27 FAILED: a booking past the horizon was not refused.' using errcode = 'P0001';
  end if;

  v_state := null;
  begin
    perform public.assert_patient_booking_window((v_day + time '10:07') at time zone 'America/Monterrey', 30);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'Migration 27 FAILED: a start off the 15-minute grid was not refused.' using errcode = 'P0001';
  end if;

  v_state := null;
  begin
    perform public.assert_patient_booking_window((v_day + time '03:00') at time zone 'America/Monterrey', 30);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'Migration 27 FAILED: a 03:00 booking was not refused.' using errcode = 'P0001';
  end if;

  -- A malformed schedule gives the friendly message, and a closing time of
  -- 00:00 means midnight at the end of the day. Both run on a test schedule
  -- inside a sub-transaction that is always rolled back.
  if exists (select 1 from public.clinic_settings) then
    begin
      update public.clinic_settings
         set schedule = jsonb_build_object((extract(dow from v_day)::integer)::text,
                          jsonb_build_object('isOpen', 'maybe', 'start', '08:00 AM', 'end', '06:00 PM')),
             updated_at = now()
       where id is not null;
      v_state := null;
      begin
        perform public.assert_patient_booking_window((v_day + time '10:00') at time zone 'America/Monterrey', 30);
      exception when others then v_state := sqlerrm;
      end;
      if v_state is null or v_state not like 'No pudimos leer el horario%' then
        raise exception 'Migration 27 FAILED: a malformed schedule did not give the friendly message (got: %).', v_state
          using errcode = 'P0001';
      end if;

      update public.clinic_settings
         set schedule = jsonb_build_object((extract(dow from v_day)::integer)::text,
                          jsonb_build_object('isOpen', true, 'start', '08:00 AM', 'end', '12:00 AM')),
             updated_at = now()
       where id is not null;
      perform public.assert_patient_booking_window((v_day + time '23:30') at time zone 'America/Monterrey', 30);

      raise exception using errcode = 'P0001', message = 'MIGRATION_27_GATE_ROLLBACK';
    exception when others then
      if sqlerrm <> 'MIGRATION_27_GATE_ROLLBACK' then
        raise;
      end if;
    end;
  end if;

  -- 6. [NV3] Private buckets.
  if exists (
    select 1 from (values ('clinical_records'), ('prescriber_private')) as b(id)
    where not exists (select 1 from storage.buckets sb where sb.id = b.id and sb.public = false)
  ) then
    raise exception 'Migration 27 FAILED: clinical_records and prescriber_private must exist and be private.' using errcode = 'P0001';
  end if;

  -- 7. Migration 26 rules still hold for the new functions.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute'))
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    );
  if v_bad is not null then
    raise exception 'Migration 27 FAILED: trigger functions executable by anon, authenticated or service_role: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 8. The SECURITY DEFINER surface matches the reviewed list. Functions
  --    are matched by SIGNATURE (oid), never by name, so a new overload
  --    cannot slip in. The guard must be real code: comments and string
  --    literals are stripped from the body before matching, and staff RPCs
  --    need an actual "if not public.<guard>() then raise".
  for v_rec in
    with reviewed (sig, kind) as (
      values
        -- anon and authenticated: public reads that return no identity.
        ('public.get_availability(timestamptz,timestamptz)', 'public'),
        ('public.get_clinic_schedule()', 'public'),
        ('public.get_clinic_mode()', 'public'),
        -- Helpers RLS policies call as the requesting role.
        ('public.is_staff()', 'helper'),
        ('public.is_business_staff()', 'helper'),
        ('public.current_patient_id()', 'helper'),
        -- Doctor only.
        ('public.anonymize_patient(uuid)', 'staff'),
        ('public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)', 'staff'),
        ('public.issue_prescription(uuid)', 'staff'),
        ('public.log_prescription_shared(uuid,text)', 'staff'),
        ('public.record_consent_in_person(uuid)', 'staff'),
        ('public.record_consultation_supplies(uuid,jsonb)', 'staff'),
        ('public.record_payment(uuid,text,numeric,text,text)', 'staff'),
        ('public.resolve_arco_request(uuid,text,text)', 'staff'),
        ('public.set_clinic_mode(boolean)', 'staff'),
        ('public.staff_create_appointment(uuid,uuid,timestamptz)', 'staff'),
        -- Migration 30 (staff_record_past_visit): listed here too so a re-run of this file still passes.
        ('public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'staff'),
        ('public.staff_register_arco_request(uuid,text,text,text)', 'staff'),
        ('public.staff_reschedule_appointment(uuid,timestamptz)', 'staff'),
        -- Doctor or admin.
        ('public.adjust_stock(uuid,integer,text,numeric,text)', 'business'),
        ('public.get_finance_payments(timestamptz,timestamptz)', 'business'),
        ('public.get_item_movements(uuid)', 'business'),
        ('public.get_procedure_profit(timestamptz,timestamptz)', 'business'),
        ('public.set_service_supplies(uuid,jsonb)', 'business'),
        -- The caller's own patient record.
        ('public.accept_privacy_notice(text,text)', 'patient'),
        ('public.cancel_my_appointment(uuid,text)', 'patient'),
        ('public.export_my_data()', 'patient'),
        ('public.get_my_booking_profile()', 'patient'),
        ('public.register_my_upload(text,text)', 'patient'),
        ('public.request_my_appointment(uuid,timestamptz,text)', 'patient'),
        ('public.reschedule_my_appointment(uuid,timestamptz)', 'patient'),
        ('public.submit_arco_request(text,text)', 'patient'),
        ('public.get_my_profile()', 'patient_sql'),
        ('public.register_me(text,text,text,text,integer,text,text)', 'register')
    )
    select p.oid::regprocedure::text as sig,
           p.prosrc,
           has_function_privilege('anon', p.oid, 'execute') as anon_x,
           r.kind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join reviewed r on to_regprocedure(r.sig) = p.oid
    where n.nspname = 'public'
      and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    if v_rec.kind is null then
      raise exception 'Migration 27 FAILED: unreviewed SECURITY DEFINER function executable by anon or authenticated: %. Nothing was changed.', v_rec.sig
        using errcode = 'P0001';
    end if;

    if v_rec.anon_x and v_rec.kind <> 'public' then
      raise exception 'Migration 27 FAILED: anon can execute %.', v_rec.sig using errcode = 'P0001';
    end if;

    -- Code only: no comments, no string literals, lower case, single spaces.
    v_clean := regexp_replace(
                 lower(regexp_replace(v_rec.prosrc,
                       $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')),
                 '\s+', ' ', 'g');

    v_ok := case v_rec.kind
      when 'staff'       then v_clean ~ 'if not public\.is_staff\(\) then raise'
      when 'business'    then v_clean ~ 'if not public\.is_business_staff\(\) then raise'
      when 'patient'     then v_clean ~ '(\w+) uuid := public\.current_patient_id\(\);.*\mif \1 is null then (raise|return)'
      when 'patient_sql' then v_clean ~ 'where p\.id = public\.current_patient_id\(\)'
      when 'register'    then v_clean ~ 'if public\.is_business_staff\(\) then raise'
                              and v_clean ~ 'if v_phone is null or length\(v_phone\) < 10 then raise'
      else true
    end;

    if not v_ok then
      raise exception 'Migration 27 FAILED: % (%) has no internal % guard in its code.', v_rec.sig, v_rec.kind, v_rec.kind
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Migration 27 PASSED: current_patient_id() needs a phone confirmed by Auth and is NULL in doctor-only mode (closing every patient read); register_me() needs a verified phone; patients have no direct read and get_my_profile() returns no notes; patients see finalized prescriptions only; the admin reads no payment row and no consultation movement (get_item_movements() has no appointment_id); patient bookings and reschedules respect the opening hours (a malformed schedule gives a clear message, 00:00 closes at midnight), the 15-minute grid and a % day horizon; started or recorded visits cannot be cancelled or moved online; at most % online reschedules per appointment; clinical_records and prescriber_private are private; the SECURITY DEFINER surface matches the reviewed list by signature.',
    public.booking_horizon_days(), public.patient_reschedule_limit();
end $$;
