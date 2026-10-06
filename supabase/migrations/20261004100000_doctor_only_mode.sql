-- =============================================================================
-- 23 - "Modo solo doctora" (doctor-only mode) and in-person consent
-- =============================================================================
-- Problems this file fixes:
--   1. The doctor wants the app to work even when patients use nothing online:
--      no portal, no online booking, nothing to confirm or accept. Until now
--      every patient RPC was always open, and a staff reschedule always sent
--      the appointment back to 'pending', waiting for a confirmation that, in
--      that way of working, nobody would ever give.
--   2. public.consents only receives rows from the patient's own RPCs
--      (register_me, accept_privacy_notice), so a patient who signs the
--      privacy notice ON PAPER at the clinic could not be recorded as having
--      consented (docs/compliance.md, gap G2).
--
-- Design:
--   * clinic_settings.doctor_only_mode boolean not null default false. The
--     table becomes single-row: a unique index on a constant expression
--     (clinic_settings_single_row) refuses a second row. The pre-flight
--     below aborts, changing nothing, when more than one row already exists.
--     settingsService's "update the row, insert one only when there is none"
--     keeps working unchanged.
--   * get_clinic_mode() returns ONLY that boolean (false when there is no
--     row). It is SECURITY DEFINER and executable by anon, authenticated and
--     service_role, like get_clinic_schedule(): the public site has to know
--     the mode before anyone signs in, and the notify-appointment edge
--     function reads it with its service-role client.
--   * set_clinic_mode(boolean) is the doctor's switch: is_staff() only (the
--     admin role is refused), updates the single row or creates it. The
--     clinic_settings_staff_all RLS policy is unchanged, so the doctor could
--     also write the column directly; nobody else can.
--   * assert_patient_portal_open(message) (internal, no API grant) raises a
--     Spanish P0001 while the mode is on. The six patient RPCs call it FIRST:
--       - request_my_appointment, reschedule_my_appointment
--           (bodies copied verbatim from migration 21),
--       - cancel_my_appointment (verbatim from migration 06),
--       - register_me (verbatim from migration 18),
--       - accept_privacy_notice (verbatim from migration 13),
--       - submit_arco_request (verbatim from migration 11).
--     No later migration redefines any of them. Nothing else in their bodies
--     changes.
--   * register_my_upload (verbatim from migration 12) also calls it first, and
--     the clinical_records_patient_upload_own storage policy (migration 03)
--     gets "and not public.get_clinic_mode()": in doctor-only mode a patient
--     can neither upload a file nor register one.
--   * ARCO rights do not depend on the mode: with the portal closed the
--     patient files the request in person, by phone, by e-mail or in writing,
--     and the doctor records it with staff_register_arco_request (is_staff()
--     only, works in both modes). arco_requests.channel (nullable;
--     'presencial' | 'telefono' | 'correo' | 'escrito') says how it arrived;
--     null means the patient filed it in the portal. created_at is the
--     server's now(), so the 20-business-day deadline counts from the moment
--     it is recorded.
--   * staff_reschedule_appointment (verbatim from migration 19) keeps the
--     appointment 'confirmed' while the mode is on (nobody would confirm it
--     online); with the mode off it still goes back to 'pending'.
--   * consents.method text not null default 'online' ('online' | 'in_person').
--     Existing rows are online acceptances, so the default is correct for
--     them. record_consent_in_person(patient_id) is a doctor-only RPC that
--     records the CURRENT privacy notice version with method 'in_person'. It
--     is idempotent: when the patient already holds a consent for the current
--     version it records nothing and returns false. It refuses an anonymized
--     record. The consents table stays append-only with no direct write
--     privilege for any API role; the insert is audited by the existing
--     audit_row_change trigger (actor = the doctor).
--   * Signatures, SECURITY DEFINER, the pinned search_path and the grants of
--     every redefined function are unchanged (restated below so a re-run
--     always ends in the same state). cancel_my_appointment is now also
--     revoked from anon explicitly, like its siblings.
--
-- Note for maintainers: re-running migrations 03, 06, 11, 12, 13, 18, 19 or 21 after
-- this file restores bodies WITHOUT the doctor-only checks. Run this file
-- again afterwards; its gate detects the missing checks.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pre-flight: clinic_settings must have at most one row
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_list  text;
begin
  select count(*),
         string_agg(format('  id=%s | updated_at=%s | has_schedule=%s', cs.id, cs.updated_at, cs.schedule is not null),
                    E'\n' order by cs.updated_at desc nulls last)
    into v_count, v_list
  from public.clinic_settings cs;

  if v_count > 1 then
    raise exception using
      errcode = 'P0001',
      message = format(
        E'Migration 23 ABORTED: clinic_settings has %s rows; it must have one. Nothing was changed.\n%s\n'
        'The public booking screen uses the most recently updated row with a schedule (the first one listed '
        'with has_schedule=true). Delete the other rows, then run this migration again.',
        v_count, v_list);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- clinic_settings: the mode, and a single row
-- -----------------------------------------------------------------------------
alter table public.clinic_settings
  add column if not exists doctor_only_mode boolean not null default false;

comment on column public.clinic_settings.doctor_only_mode is
  'Modo solo doctora: when true the patient portal and online booking are closed; patients only receive informational WhatsApp messages.';

create unique index if not exists clinic_settings_single_row
  on public.clinic_settings ((true));

-- -----------------------------------------------------------------------------
-- get_clinic_mode - the mode, and nothing else (public)
-- -----------------------------------------------------------------------------
create or replace function public.get_clinic_mode()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           (select cs.doctor_only_mode
            from public.clinic_settings cs
            order by cs.updated_at desc nulls last
            limit 1),
           false
         );
$$;

comment on function public.get_clinic_mode() is
  'True when the clinic works in doctor-only mode (no patient portal, no online booking). Exposes nothing else of clinic_settings.';

-- -----------------------------------------------------------------------------
-- set_clinic_mode - the doctor's switch
-- -----------------------------------------------------------------------------
create or replace function public.set_clinic_mode(p_doctor_only boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para cambiar el modo de la clínica.' using errcode = '42501';
  end if;

  if p_doctor_only is null then
    raise exception 'Indica si el modo solo doctora queda activado o desactivado.' using errcode = 'P0001';
  end if;

  -- Single row (clinic_settings_single_row). The WHERE keeps pg-safeupdate,
  -- which refuses an UPDATE without one, satisfied.
  update public.clinic_settings cs
     set doctor_only_mode = p_doctor_only,
         updated_at       = now()
   where cs.id is not null;

  if not found then
    -- No row yet (the schedule was never saved). The single-row index makes a
    -- concurrent second insert fail instead of creating a duplicate.
    insert into public.clinic_settings (doctor_only_mode) values (p_doctor_only);
  end if;

  return p_doctor_only;
end;
$$;

-- -----------------------------------------------------------------------------
-- Internal: refuse a patient action while the mode is on
-- -----------------------------------------------------------------------------
create or replace function public.assert_patient_portal_open(p_message text default null)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_clinic_mode() then
    raise exception '%', coalesce(p_message, 'La clínica no está recibiendo citas en línea. Comunícate por teléfono.')
      using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- request_my_appointment - the patient's own booking
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 21 plus the doctor-only check.
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
-- Body copied verbatim from migration 21 plus the doctor-only check.
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
-- cancel_my_appointment - the patient cancels their own appointment
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 06 plus the doctor-only check.
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
begin
  -- Migration 23: no online changes in doctor-only mode.
  perform public.assert_patient_portal_open();

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

-- -----------------------------------------------------------------------------
-- register_me - the caller creates their own clinical record
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 18 plus the doctor-only check.
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

-- -----------------------------------------------------------------------------
-- accept_privacy_notice - consent from a returning, verified patient
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 13 plus the doctor-only check. In
-- doctor-only mode the patient signs the notice on paper at the clinic and
-- the doctor records it with record_consent_in_person().
-- -----------------------------------------------------------------------------
create or replace function public.accept_privacy_notice(
  p_privacy_notice_version text,
  p_user_agent             text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid uuid := public.current_patient_id();
begin
  -- Migration 23: nothing is accepted online in doctor-only mode.
  perform public.assert_patient_portal_open(
    'La clínica no está recibiendo registros en línea. Comunícate por teléfono.');

  if v_pid is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  perform public.assert_current_notice_version(p_privacy_notice_version);

  if public.has_current_consent(v_pid) then
    return;
  end if;

  insert into public.consents (patient_id, document, version, user_agent)
  values (
    v_pid,
    'aviso_privacidad',
    p_privacy_notice_version,
    left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- submit_arco_request - patient files a request from the portal
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 11 plus the doctor-only check. ARCO
-- rights still apply: in doctor-only mode the patient files the request in
-- person or by phone (see docs/compliance.md).
-- -----------------------------------------------------------------------------
create or replace function public.submit_arco_request(
  p_request_type text,
  p_details      text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id uuid := public.current_patient_id();
  v_open       integer;
  v_details    text := btrim(coalesce(p_details, ''));
  v_id         uuid;
begin
  -- Migration 23: no online requests in doctor-only mode.
  perform public.assert_patient_portal_open(
    'La clínica no está recibiendo solicitudes en línea. Comunícate por teléfono o acude a la clínica para hacer tu solicitud.');

  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  if p_request_type is null
     or p_request_type not in ('access', 'rectification', 'cancellation', 'opposition', 'revocation') then
    raise exception 'Elige qué tipo de solicitud quieres hacer.' using errcode = 'P0001';
  end if;

  if length(v_details) < 5 then
    raise exception 'Describe brevemente tu solicitud para que la doctora pueda atenderla.'
      using errcode = 'P0001';
  end if;

  if length(v_details) > 4000 then
    raise exception 'Tu descripción es demasiado larga. Resúmela en menos de 4000 caracteres.'
      using errcode = 'P0001';
  end if;

  select count(*) into v_open
  from public.arco_requests r
  where r.patient_id = v_patient_id
    and r.status in ('received', 'in_progress');

  if v_open >= public.arco_limit_open_per_patient() then
    raise exception 'Ya tienes varias solicitudes en trámite. Espera la respuesta o comunícate con la clínica.'
      using errcode = 'P0001';
  end if;

  insert into public.arco_requests (patient_id, request_type, details)
  values (v_patient_id, p_request_type, v_details)
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- register_my_upload - the patient registers a file uploaded from the portal
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 12 plus the doctor-only check.
-- -----------------------------------------------------------------------------
create or replace function public.register_my_upload(
  p_object_name text,
  p_file_name   text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id uuid := public.current_patient_id();
  v_mime       text;
  v_id         uuid;
begin
  -- Migration 23: no portal uploads in doctor-only mode.
  perform public.assert_patient_portal_open(
    'La clínica no está recibiendo archivos en línea. Lleva tus estudios a tu próxima consulta.');

  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  select o.metadata ->> 'mimetype'
    into v_mime
  from storage.objects o
  where o.bucket_id = 'clinical_records'
    and o.name = p_object_name
    and (storage.foldername(o.name))[1] = v_patient_id::text;

  if not found then
    raise exception 'No se encontró el archivo subido.' using errcode = 'P0001';
  end if;

  select pf.id into v_id
  from public.patient_files pf
  where pf.patient_id = v_patient_id
    and pf.file_url = p_object_name;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.patient_files (patient_id, file_url, file_name, file_type, uploaded_by)
  values (
    v_patient_id,
    p_object_name,
    left(coalesce(nullif(btrim(coalesce(p_file_name, '')), ''), p_object_name), 255),
    v_mime,
    'patient'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage: the patient's own upload policy, closed in doctor-only mode
-- -----------------------------------------------------------------------------
-- Migration 03 policy plus "and not public.get_clinic_mode()". The staff
-- policy (clinical_records_staff_all) is unchanged: the doctor still uploads.
drop policy if exists "clinical_records_patient_upload_own" on storage.objects;
create policy "clinical_records_patient_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'clinical_records'
    and public.current_patient_id() is not null
    and (storage.foldername(name))[1] = public.current_patient_id()::text
    and not public.get_clinic_mode()
  );

-- -----------------------------------------------------------------------------
-- arco_requests.channel - how a request recorded by the doctor arrived
-- -----------------------------------------------------------------------------
alter table public.arco_requests add column if not exists channel text;

alter table public.arco_requests drop constraint if exists arco_requests_channel_check;
alter table public.arco_requests add constraint arco_requests_channel_check
  check (channel is null or channel in ('presencial', 'telefono', 'correo', 'escrito'));

comment on column public.arco_requests.channel is
  'How the request reached the clinic when the doctor recorded it (staff_register_arco_request): presencial, telefono, correo or escrito. Null: filed by the patient in the portal.';

-- -----------------------------------------------------------------------------
-- staff_register_arco_request - the doctor records a request made offline
-- -----------------------------------------------------------------------------
-- Works in both modes. Same type list, details limits and patient checks as
-- submit_arco_request; no per-patient cap (every request the clinic receives
-- must be recorded). The row's creation time is the server's now(): the legal
-- deadline counts from when the clinic records it.
-- -----------------------------------------------------------------------------
create or replace function public.staff_register_arco_request(
  p_patient_id   uuid,
  p_request_type text,
  p_details      text,
  p_channel      text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_anonymized_at timestamptz;
  v_details       text := btrim(coalesce(p_details, ''));
  v_id            uuid;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para registrar solicitudes ARCO.' using errcode = '42501';
  end if;

  select p.anonymized_at
    into v_anonymized_at
  from public.patients p
  where p.id = p_patient_id;

  if not found then
    raise exception 'Elige el paciente que hizo la solicitud.' using errcode = 'P0001';
  end if;

  if v_anonymized_at is not null then
    raise exception 'Este expediente fue anonimizado. No se puede registrar una solicitud.'
      using errcode = 'P0001';
  end if;

  if p_request_type is null
     or p_request_type not in ('access', 'rectification', 'cancellation', 'opposition', 'revocation') then
    raise exception 'Elige el tipo de solicitud.' using errcode = 'P0001';
  end if;

  if p_channel is null
     or p_channel not in ('presencial', 'telefono', 'correo', 'escrito') then
    raise exception 'Elige cómo llegó la solicitud.' using errcode = 'P0001';
  end if;

  if length(v_details) < 5 then
    raise exception 'Describe brevemente lo que pidió el paciente.' using errcode = 'P0001';
  end if;

  if length(v_details) > 4000 then
    raise exception 'La descripción es demasiado larga. Resúmela en menos de 4000 caracteres.'
      using errcode = 'P0001';
  end if;

  insert into public.arco_requests (patient_id, request_type, details, channel)
  values (p_patient_id, p_request_type, v_details, p_channel)
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- staff_reschedule_appointment - "Reprogramar" in the calendar and the inbox
-- -----------------------------------------------------------------------------
-- Body copied verbatim from migration 19. The only change is the status the
-- moved appointment gets: 'confirmed' in doctor-only mode (nobody confirms
-- online), 'pending' otherwise, as before.
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
  -- Migration 23: in doctor-only mode the moved appointment stays confirmed.
  update public.appointments a
     set start_time = p_start_time,
         status     = case when public.get_clinic_mode() then 'confirmed' else 'pending' end
   where a.id = p_appointment_id
     and a.status in ('pending', 'confirmed');

  if not found then
    raise exception 'No se pudo reprogramar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- consents.method - how the consent was given
-- -----------------------------------------------------------------------------
-- ADD COLUMN with a default does not fire the append-only row triggers; every
-- existing row came from an online RPC, so 'online' is correct for all of them.
alter table public.consents
  add column if not exists method text not null default 'online';

alter table public.consents drop constraint if exists consents_method_check;
alter table public.consents add constraint consents_method_check
  check (method in ('online', 'in_person'));

comment on column public.consents.method is
  'online: accepted by the patient in the portal (register_me / accept_privacy_notice). in_person: signed on paper at the clinic and recorded by the doctor (record_consent_in_person).';

-- -----------------------------------------------------------------------------
-- record_consent_in_person - the patient signed the notice on paper
-- -----------------------------------------------------------------------------
-- Returns true when a consent was recorded, false when the patient already
-- held one for the current notice version (nothing is written then).
-- -----------------------------------------------------------------------------
create or replace function public.record_consent_in_person(p_patient_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_anonymized_at timestamptz;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para registrar consentimientos.' using errcode = '42501';
  end if;

  -- Serialize per patient, so a double tap cannot record two consents.
  perform pg_advisory_xact_lock(hashtextextended('consent_in_person:' || coalesce(p_patient_id::text, ''), 0));

  select p.anonymized_at
    into v_anonymized_at
  from public.patients p
  where p.id = p_patient_id;

  if not found then
    raise exception 'No se encontró el paciente.' using errcode = 'P0001';
  end if;

  if v_anonymized_at is not null then
    raise exception 'Este expediente fue anonimizado. No se puede registrar un consentimiento.'
      using errcode = 'P0001';
  end if;

  if public.has_current_consent(p_patient_id) then
    return false;
  end if;

  insert into public.consents (patient_id, document, version, user_agent, method)
  values (p_patient_id, 'aviso_privacidad', public.privacy_notice_version(), null, 'in_person');

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Same as migrations 06, 11, 12, 13, 18, 19 and 21 for the redefined RPCs; anon is
-- revoked explicitly because Supabase grants new functions to anon directly.
revoke all on function public.get_clinic_mode()                                         from public, anon, authenticated, service_role;
revoke all on function public.set_clinic_mode(boolean)                                  from public, anon, authenticated, service_role;
revoke all on function public.assert_patient_portal_open(text)                          from public, anon, authenticated;
revoke all on function public.request_my_appointment(uuid, timestamptz, text)           from public, anon, authenticated;
revoke all on function public.reschedule_my_appointment(uuid, timestamptz)              from public, anon;
revoke all on function public.cancel_my_appointment(uuid, text)                         from public, anon;
revoke all on function public.register_me(text, text, text, text, integer, text, text)  from public, anon, authenticated;
revoke all on function public.accept_privacy_notice(text, text)                         from public, anon, authenticated;
revoke all on function public.submit_arco_request(text, text)                           from public, anon, authenticated;
revoke all on function public.register_my_upload(text, text)                            from public, anon, authenticated;
revoke all on function public.staff_register_arco_request(uuid, text, text, text)       from public, anon, authenticated, service_role;
revoke all on function public.staff_reschedule_appointment(uuid, timestamptz)           from public, anon, authenticated, service_role;
revoke all on function public.record_consent_in_person(uuid)                            from public, anon, authenticated, service_role;

-- Public read of the mode: the site decides what to show before any sign-in,
-- and the notify-appointment edge function reads it as service_role.
grant execute on function public.get_clinic_mode()                                       to anon, authenticated, service_role;
grant execute on function public.set_clinic_mode(boolean)                                to authenticated;
grant execute on function public.request_my_appointment(uuid, timestamptz, text)         to authenticated;
grant execute on function public.reschedule_my_appointment(uuid, timestamptz)            to authenticated;
grant execute on function public.cancel_my_appointment(uuid, text)                       to authenticated;
grant execute on function public.register_me(text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.accept_privacy_notice(text, text)                       to authenticated;
grant execute on function public.submit_arco_request(text, text)                         to authenticated;
grant execute on function public.register_my_upload(text, text)                          to authenticated;
grant execute on function public.staff_register_arco_request(uuid, text, text, text)     to authenticated;
grant execute on function public.staff_reschedule_appointment(uuid, timestamptz)         to authenticated;
grant execute on function public.record_consent_in_person(uuid)                          to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn   text;
  v_src  text;
  v_role text;
  v_priv text;
begin
  -- 1. The column, its default and the single-row index.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinic_settings'
      and column_name = 'doctor_only_mode' and data_type = 'boolean'
      and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'Migration 23 FAILED: clinic_settings.doctor_only_mode is not a NOT NULL boolean defaulting to false.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('public.clinic_settings_single_row')
      and i.indrelid = 'public.clinic_settings'::regclass
      and i.indisunique
      and i.indisvalid
  ) then
    raise exception 'Migration 23 FAILED: clinic_settings_single_row is not a valid unique index on clinic_settings.'
      using errcode = 'P0001';
  end if;

  if (select count(*) from public.clinic_settings) > 1 then
    raise exception 'Migration 23 FAILED: clinic_settings has more than one row.' using errcode = 'P0001';
  end if;

  -- 2. Every function of this file: SECURITY DEFINER with a pinned search_path.
  foreach v_fn in array array[
    'public.get_clinic_mode()',
    'public.set_clinic_mode(boolean)',
    'public.assert_patient_portal_open(text)',
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.reschedule_my_appointment(uuid,timestamptz)',
    'public.cancel_my_appointment(uuid,text)',
    'public.register_me(text,text,text,text,integer,text,text)',
    'public.accept_privacy_notice(text,text)',
    'public.submit_arco_request(text,text)',
    'public.register_my_upload(text,text)',
    'public.staff_register_arco_request(uuid,text,text,text)',
    'public.staff_reschedule_appointment(uuid,timestamptz)',
    'public.record_consent_in_person(uuid)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Migration 23 FAILED: % is missing.', v_fn using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 23 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- 3. Who may call what.
  if not has_function_privilege('anon', 'public.get_clinic_mode()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_clinic_mode()', 'execute')
     or not has_function_privilege('service_role', 'public.get_clinic_mode()', 'execute') then
    raise exception 'Migration 23 FAILED: anon, authenticated and service_role must be able to read the mode.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.assert_patient_portal_open(text)', 'execute')
     or has_function_privilege('authenticated', 'public.assert_patient_portal_open(text)', 'execute') then
    raise exception 'Migration 23 FAILED: assert_patient_portal_open() is callable through the API.'
      using errcode = 'P0001';
  end if;

  foreach v_fn in array array[
    'public.set_clinic_mode(boolean)',
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.reschedule_my_appointment(uuid,timestamptz)',
    'public.cancel_my_appointment(uuid,text)',
    'public.register_me(text,text,text,text,integer,text,text)',
    'public.accept_privacy_notice(text,text)',
    'public.submit_arco_request(text,text)',
    'public.register_my_upload(text,text)',
    'public.staff_register_arco_request(uuid,text,text,text)',
    'public.staff_reschedule_appointment(uuid,timestamptz)',
    'public.record_consent_in_person(uuid)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'Migration 23 FAILED: anon can execute %.', v_fn using errcode = 'P0001';
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 23 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  -- 4. The seven patient RPCs refuse in doctor-only mode, FIRST.
  foreach v_fn in array array[
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.reschedule_my_appointment(uuid,timestamptz)',
    'public.cancel_my_appointment(uuid,text)',
    'public.register_me(text,text,text,text,integer,text,text)',
    'public.accept_privacy_notice(text,text)',
    'public.submit_arco_request(text,text)',
    'public.register_my_upload(text,text)'
  ] loop
    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
    if v_src !~ 'perform public\.assert_patient_portal_open\(' then
      raise exception 'Migration 23 FAILED: % does not refuse in doctor-only mode.', v_fn using errcode = 'P0001';
    end if;
    -- Before any other rule, so the patient gets the clear "call the clinic"
    -- message instead of a different refusal.
    if strpos(v_src, 'raise exception') > 0
       and strpos(v_src, 'assert_patient_portal_open') > strpos(v_src, 'raise exception') then
      raise exception 'Migration 23 FAILED: % checks the mode after other rules.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  -- 5. The bodies kept what migrations 06, 11, 13, 18, 19 and 21 guarantee.
  select prosrc into v_src from pg_proc
  where oid = 'public.request_my_appointment(uuid,timestamptz,text)'::regprocedure;
  if v_src !~ 'pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
     or v_src !~ 'public\.assert_slot_free\(p_start_time, v_duration\)'
     or v_src !~ 'p\.status = ''archived'''
     or v_src !~ 'p\.status = ''blocked'''
     or v_src !~ 'booking_limit_pending_per_patient\(\)'
     or v_src !~ 'reason' then
    raise exception 'Migration 23 FAILED: request_my_appointment() lost its lock, overlap, status, cap or reason checks.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.reschedule_my_appointment(uuid,timestamptz)'::regprocedure;
  if v_src !~ 'pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
     or v_src !~ 'public\.assert_slot_free\(p_start_time, v_duration, p_appointment_id\)'
     or v_src !~ 'a\.patient_id = v_patient_id'
     or v_src !~ 'p\.status = ''archived'''
     or v_src !~ 'p\.status = ''blocked'''
     or (select count(*) from regexp_matches(v_src, 'a\.status in \(''pending'', ''confirmed''\)', 'g')) < 2
     or v_src !~ 'if not found then' then
    raise exception 'Migration 23 FAILED: reschedule_my_appointment() lost its lock, overlap, ownership, status or re-check.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.cancel_my_appointment(uuid,text)'::regprocedure;
  if v_src !~ 'a\.patient_id = v_patient_id'
     or v_src !~ 'a\.status in \(''pending'', ''confirmed''\)' then
    raise exception 'Migration 23 FAILED: cancel_my_appointment() lost its ownership or status check.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.register_me(text,text,text,text,integer,text,text)'::regprocedure;
  if v_src !~ 'public\.is_business_staff\(\)'
     or v_src !~ 'assert_current_notice_version'
     or v_src !~ 'assert_new_patient_quota'
     or v_src !~ 'has_current_consent' then
    raise exception 'Migration 23 FAILED: register_me() lost its staff refusal, notice check, quota or consent.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.accept_privacy_notice(text,text)'::regprocedure;
  if v_src !~ 'assert_current_notice_version' or v_src !~ 'has_current_consent' then
    raise exception 'Migration 23 FAILED: accept_privacy_notice() lost its notice check or idempotency.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.submit_arco_request(text,text)'::regprocedure;
  if v_src !~ 'arco_limit_open_per_patient\(\)' or v_src !~ 'current_patient_id\(\)' then
    raise exception 'Migration 23 FAILED: submit_arco_request() lost its patient resolution or per-patient cap.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.register_my_upload(text,text)'::regprocedure;
  if v_src !~ 'current_patient_id\(\)'
     or v_src !~ '\(storage\.foldername\(o\.name\)\)\[1\] = v_patient_id::text'
     or v_src !~ '''patient''' then
    raise exception 'Migration 23 FAILED: register_my_upload() lost its patient resolution or own-folder check.'
      using errcode = 'P0001';
  end if;

  -- The patient's storage upload policy is closed in doctor-only mode and
  -- still limited to the patient's own folder.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'clinical_records_patient_upload_own' and cmd = 'INSERT'
      and with_check ~ 'get_clinic_mode\(\)'
      and with_check ~ 'current_patient_id\(\)'
      and with_check ~ 'foldername'
  ) then
    raise exception 'Migration 23 FAILED: clinical_records_patient_upload_own does not refuse uploads in doctor-only mode.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.staff_reschedule_appointment(uuid,timestamptz)'::regprocedure;
  if v_src !~ '\mis_staff\('
     or v_src ~ 'is_business_staff'
     or v_src !~ 'pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
     or v_src !~ 'public\.assert_slot_free\(p_start_time, v_duration, p_appointment_id\)'
     or v_src !~ 'case when public\.get_clinic_mode\(\) then ''confirmed'' else ''pending'' end'
     or (select count(*) from regexp_matches(v_src, 'a\.status in \(''pending'', ''confirmed''\)', 'g')) < 2 then
    raise exception 'Migration 23 FAILED: staff_reschedule_appointment() lost its doctor check, lock, overlap or mode-aware status.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.set_clinic_mode(boolean)'::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff' then
    raise exception 'Migration 23 FAILED: set_clinic_mode() must check is_staff() (doctor only).'
      using errcode = 'P0001';
  end if;

  -- 6. In-person consent.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consents'
      and column_name = 'method' and is_nullable = 'NO'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.consents'::regclass and conname = 'consents_method_check'
  ) then
    raise exception 'Migration 23 FAILED: consents.method is missing, nullable or unchecked.' using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.record_consent_in_person(uuid)'::regprocedure;
  if v_src !~ '\mis_staff\('
     or v_src ~ 'is_business_staff'
     or v_src !~ 'has_current_consent\(p_patient_id\)'
     or v_src !~ 'public\.privacy_notice_version\(\)'
     or v_src !~ '''in_person''' then
    raise exception 'Migration 23 FAILED: record_consent_in_person() lost its doctor check, idempotency, version or method.'
      using errcode = 'P0001';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(v_role, 'public.consents', v_priv) then
        raise exception 'Migration 23 FAILED: role % holds % on consents.', v_role, v_priv using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  -- 7. Staff-recorded ARCO requests: doctor only, works in both modes.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'arco_requests'
      and column_name = 'channel' and is_nullable = 'YES'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.arco_requests'::regclass and conname = 'arco_requests_channel_check'
  ) then
    raise exception 'Migration 23 FAILED: arco_requests.channel is missing, not nullable or unchecked.' using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.staff_register_arco_request(uuid,text,text,text)'::regprocedure;
  if v_src !~ '\mis_staff\('
     or v_src ~ 'is_business_staff'
     or v_src ~ 'assert_patient_portal_open'
     or v_src ~ 'get_clinic_mode'
     or v_src !~ 'anonymized_at'
     or v_src ~ 'created_at' then
    raise exception 'Migration 23 FAILED: staff_register_arco_request() must check is_staff(), refuse anonymized records, ignore the mode and leave created_at to the server.'
      using errcode = 'P0001';
  end if;

  -- Every write goes through the RPCs (as since migration 11).
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(v_role, 'public.arco_requests', v_priv) then
        raise exception 'Migration 23 FAILED: role % holds % on arco_requests.', v_role, v_priv using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  -- 8. PostgREST resolves RPCs by name: exactly one overload of each new one.
  foreach v_fn in array array['get_clinic_mode', 'set_clinic_mode', 'record_consent_in_person', 'staff_reschedule_appointment', 'cancel_my_appointment', 'register_my_upload', 'staff_register_arco_request'] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_fn) <> 1 then
      raise exception 'Migration 23 FAILED: % has more than one overload.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Migration 23 PASSED: doctor-only mode installed (currently %), the seven patient RPCs and the patient storage upload refuse while it is on, a staff reschedule stays confirmed in that mode, the doctor can record a paper consent once per notice version and register an ARCO request received offline.',
    case when public.get_clinic_mode() then 'ON' else 'OFF' end;
end $$;
