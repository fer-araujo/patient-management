-- =============================================================================
-- 13 - Verified booking (phone OTP before booking)
-- =============================================================================
-- The public "Agendar Cita" path used to be anonymous: request_appointment
-- (granted to anon) found or created the patient by a phone the visitor merely
-- TYPED. That had three consequences:
--   * it could not tell a returning patient from a new one without becoming a
--     "is this phone registered?" oracle, so returning patients retyped
--     everything;
--   * the privacy-notice consent it stored was tied to an unverified phone
--     (docs/compliance.md, gap G1);
--   * it was the booking-spam vector the abuse ceilings in migration 06 exist
--     for.
--
-- New flow: the visitor ALWAYS verifies the phone with an OTP first. Once the
-- session proves ownership of the number, it is safe to tell the caller whether
-- that number already has a clinical record, because the caller IS that number.
--
-- This file:
--   1. Adds appointments.reason ("Motivo de la consulta"), asked on every
--      booking instead of only once in patients.notes at registration.
--   2. get_my_booking_profile() - is the verified phone registered, the first
--      name to greet with, and whether the current privacy notice is accepted.
--   3. accept_privacy_notice()  - records consent for a returning patient.
--   4. register_me()            - creates the caller's own patient record and
--      its consent row atomically. The phone comes from the JWT, never from
--      the client.
--   5. request_my_appointment() - re-created with p_reason.
--   6. export_my_data()         - re-created so the ARCO access export includes
--      appointments.reason.
--   7. DROPS the anonymous request_appointment. anon can no longer create
--      patients or appointments at all.
--
-- >>> SIGNATURE CHANGE <<<
-- request_my_appointment(uuid, timestamptz) is dropped explicitly and replaced
-- by request_my_appointment(uuid, timestamptz, text). p_reason defaults to NULL,
-- so a portal bundle that still sends two named arguments keeps working. The
-- public booking page of an OLD bundle does not: it calls request_appointment,
-- which no longer exists. Deploy the frontend together with this file.
--
-- >>> OTP PROVIDER <<<
-- Until a paid Twilio account is configured, only the Supabase Auth test phone
-- numbers can complete the OTP step, so online booking works end to end only
-- for those numbers. See docs/security-runbook.md, Phase 3.
--
-- Abuse ceilings after this file: the per-patient pending cap stays in
-- request_my_appointment, and register_me keeps the rolling new-patient quota.
-- assert_public_booking_capacity() and booking_limit_pending_clinic_wide() are
-- no longer called by any path; they are left in place so Phase 1 Gate 7b
-- still runs and so the ceiling can be re-wired if ever needed.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- appointments.reason
-- -----------------------------------------------------------------------------
-- Free text typed by the patient. Stored per appointment so a returning patient
-- can explain every visit. The length cap matches the maxLength of the booking
-- textarea and the check in request_my_appointment.
alter table public.appointments add column if not exists reason text;

alter table public.appointments drop constraint if exists appointments_reason_length;
alter table public.appointments add constraint appointments_reason_length
  check (reason is null or char_length(reason) <= 1000);

comment on column public.appointments.reason is
  'Reason for the visit as typed by the patient when booking. Optional.';

-- -----------------------------------------------------------------------------
-- Internal: does a patient hold consent for the CURRENT privacy notice?
-- -----------------------------------------------------------------------------
create or replace function public.has_current_consent(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.consents c
    where c.patient_id = p_patient_id
      and c.document = 'aviso_privacidad'
      and c.version = public.privacy_notice_version()
  );
$$;

revoke all on function public.has_current_consent(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Internal: fail in Spanish unless the version is the one on the server
-- -----------------------------------------------------------------------------
create or replace function public.assert_current_notice_version(p_version text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(coalesce(p_version, '')), '') is null then
    raise exception 'Debes leer y aceptar el Aviso de Privacidad para continuar.'
      using errcode = 'P0001';
  end if;

  if p_version <> public.privacy_notice_version() then
    raise exception 'El Aviso de Privacidad se actualizó. Recarga la página, léelo de nuevo y vuelve a aceptarlo.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.assert_current_notice_version(text) from public, anon, authenticated;

-- =============================================================================
-- get_my_booking_profile - what the booking screen needs after the OTP
-- =============================================================================
-- Scoped entirely by current_patient_id(), i.e. by the verified phone claim.
-- Takes no parameters, so it cannot be pointed at anybody else's number.
-- Returns exactly one row. A session without a phone claim (e.g. staff email
-- login) simply reads as "not registered".
-- =============================================================================
create or replace function public.get_my_booking_profile()
returns table (is_registered boolean, first_name text, needs_consent boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid uuid := public.current_patient_id();
begin
  if v_pid is null then
    return query select false, null::text, true;
    return;
  end if;

  return query
    select true,
           p.first_name,
           not public.has_current_consent(v_pid)
    from public.patients p
    where p.id = v_pid;
end;
$$;

-- =============================================================================
-- accept_privacy_notice - consent from a returning, verified patient
-- =============================================================================
-- Used when a registered patient has no consent row for the current notice
-- (registered before Phase 2, or the notice was bumped). Idempotent: a second
-- call for the same version records nothing new.
-- =============================================================================
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

-- =============================================================================
-- register_me - the caller creates their own clinical record
-- =============================================================================
-- The phone is read from the verified JWT claim; there is deliberately no phone
-- parameter. Patient and consent rows are written in one transaction.
--
-- Idempotent: when a record already exists for the verified phone (double
-- submit, or two tabs), its id is returned and the record is NOT modified. The
-- only thing that may still be written is the consent row, when that record
-- lacks one for the current notice - the caller has just accepted it on screen.
--
-- Birth year is stored as January 1st of that year, the same convention
-- anonymize_patient() uses; the booking form only asks for the year.
-- =============================================================================
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
  if v_phone is null or length(v_phone) < 10 then
    raise exception 'No pudimos verificar tu número de teléfono. Vuelve a ingresarlo para continuar.'
      using errcode = 'P0001';
  end if;

  if public.is_staff() then
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

-- =============================================================================
-- request_my_appointment - now the ONLY booking path, with a reason
-- =============================================================================
-- Same body as migration 06 plus p_reason. The patient is resolved from the
-- verified phone claim, so a session can only book for itself. The clinic-wide
-- ceilings stay out of this path (see migration 06); the per-patient pending cap
-- stays in.
-- =============================================================================
drop function if exists public.request_my_appointment(uuid, timestamptz);

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

-- =============================================================================
-- request_appointment - anonymous booking RETIRED
-- =============================================================================
-- Every overload is dropped. anon keeps get_availability / get_clinic_schedule
-- (the calendar renders before login) and nothing that writes.
-- =============================================================================
drop function if exists public.request_appointment(text, text, text, text, uuid, timestamptz, text, text);
drop function if exists public.request_appointment(text, text, text, text, uuid, timestamptz, text, text, text, text);

-- =============================================================================
-- export_my_data - include appointments.reason (LFPDPPP art. 22, access)
-- =============================================================================
-- Identical to migration 11 except for the 'reason' key on each appointment.
-- The patient typed it, so it belongs in their access export.
-- =============================================================================
create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid    uuid := public.current_patient_id();
  v_result jsonb;
begin
  if v_pid is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'privacy_notice_version', public.privacy_notice_version(),
    -- Explicit column list: patients.notes is the doctor's internal reminder
    -- pad ("Recordatorios Internos") and must never reach the patient export.
    'profile', (
      select jsonb_build_object(
               'first_name', p.first_name, 'last_name', p.last_name,
               'phone', p.phone, 'email', p.email, 'gender', p.gender,
               'dob', p.dob, 'blood_type', p.blood_type,
               'allergies', p.allergies,
               'chronic_conditions', p.chronic_conditions,
               'referred_by', p.referred_by, 'created_at', p.created_at)
      from public.patients p where p.id = v_pid),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'document', c.document, 'version', c.version,
               'accepted_at', c.accepted_at, 'user_agent', c.user_agent)
             order by c.accepted_at)
      from public.consents c where c.patient_id = v_pid), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'service', s.name, 'start_time', a.start_time,
               'status', a.status, 'reason', a.reason,
               'cancel_reason', a.cancel_reason,
               'created_at', a.created_at)
             order by a.start_time)
      from public.appointments a
      left join public.services s on s.id = a.service_id
      where a.patient_id = v_pid), '[]'::jsonb),
    'clinical_notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', cn.id, 'appointment_id', cn.appointment_id,
               'created_at', cn.created_at, 'finalized_at', cn.finalized_at,
               'subjective', cn.subjective, 'objective', cn.objective,
               'analysis', cn.analysis, 'plan', cn.plan,
               'addenda', coalesce((
                 select jsonb_agg(jsonb_build_object('created_at', ad.created_at, 'body', ad.body)
                                  order by ad.created_at)
                 from public.clinical_note_addenda ad where ad.note_id = cn.id), '[]'::jsonb))
             order by cn.created_at)
      from public.clinical_notes cn where cn.patient_id = v_pid), '[]'::jsonb),
    'prescriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'appointment_id', pr.appointment_id,
               'created_at', pr.created_at, 'finalized_at', pr.finalized_at,
               'medications', pr.medications)
             order by pr.created_at)
      from public.prescriptions pr where pr.patient_id = v_pid), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', o.name, 'uploaded_at', o.created_at,
               'mime_type', o.metadata ->> 'mimetype',
               'size_bytes', o.metadata ->> 'size')
             order by o.created_at)
      from storage.objects o
      where o.bucket_id = 'clinical_records'
        and (storage.foldername(o.name))[1] = v_pid::text), '[]'::jsonb),
    'file_records', coalesce((
      select jsonb_agg(jsonb_build_object(
               'file_name', pf.file_name, 'file_type', pf.file_type,
               'uploaded_by', pf.uploaded_by, 'created_at', pf.created_at)
             order by pf.created_at)
      from public.patient_files pf where pf.patient_id = v_pid), '[]'::jsonb),
    'arco_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'request_type', r.request_type, 'details', r.details,
               'status', r.status, 'created_at', r.created_at,
               'resolved_at', r.resolved_at, 'resolution_note', r.resolution_note)
             order by r.created_at)
      from public.arco_requests r where r.patient_id = v_pid), '[]'::jsonb)
  )
  into v_result;

  perform public.write_audit_event('EXPORT', 'patients', v_pid, v_pid, null);

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: authenticated only. Revoked from anon explicitly because Supabase's
-- default privileges grant EXECUTE on new functions to anon directly.
-- -----------------------------------------------------------------------------
revoke all on function public.get_my_booking_profile()                                          from public, anon, authenticated;
revoke all on function public.accept_privacy_notice(text, text)                                 from public, anon, authenticated;
revoke all on function public.register_me(text, text, text, text, integer, text, text)          from public, anon, authenticated;
revoke all on function public.request_my_appointment(uuid, timestamptz, text)                   from public, anon, authenticated;

grant execute on function public.get_my_booking_profile()                                       to authenticated;
grant execute on function public.accept_privacy_notice(text, text)                              to authenticated;
grant execute on function public.register_me(text, text, text, text, integer, text, text)       to authenticated;
grant execute on function public.request_my_appointment(uuid, timestamptz, text)                to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go assertion
-- -----------------------------------------------------------------------------
do $$
declare
  f      text;
  v_def  boolean;
  v_cfg  text[];
begin
  -- 1. The anonymous booking surface is gone.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'request_appointment'
  ) then
    raise exception 'request_appointment still exists: anonymous booking was not retired.'
      using errcode = 'P0001';
  end if;

  -- 2. Exactly one request_my_appointment, and it takes p_reason.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'request_my_appointment') <> 1 then
    raise exception 'request_my_appointment has more than one overload: PostgREST calls would be ambiguous.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'request_my_appointment'
      and pg_get_function_identity_arguments(p.oid) like '%p_reason%'
      and p.prosrc like '%pg_advisory_xact_lock%'
      and p.prosrc like '%booking_limit_pending_per_patient%'
  ) then
    raise exception 'request_my_appointment lost p_reason, the advisory lock or the per-patient cap.'
      using errcode = 'P0001';
  end if;

  -- 3. Grants and SECURITY DEFINER hygiene on every new or re-created RPC.
  foreach f in array array[
    'public.get_my_booking_profile()',
    'public.accept_privacy_notice(text,text)',
    'public.register_me(text,text,text,text,integer,text,text)',
    'public.request_my_appointment(uuid,timestamptz,text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'anon can execute %: it must be authenticated-only.', f using errcode = 'P0001';
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'authenticated cannot execute %: online booking will fail.', f using errcode = 'P0001';
    end if;

    select p.prosecdef, p.proconfig into v_def, v_cfg
    from pg_proc p where p.oid = f::regprocedure;

    if not v_def or not exists (select 1 from unnest(v_cfg) c where c like 'search_path=%') then
      raise exception '% must be SECURITY DEFINER with a pinned search_path.', f using errcode = 'P0001';
    end if;
  end loop;

  -- 4. register_me never takes a phone from the client.
  if pg_get_function_identity_arguments('public.register_me(text,text,text,text,integer,text,text)'::regprocedure)
     like '%phone%' then
    raise exception 'register_me accepts a phone argument: it must read the phone from the JWT only.'
      using errcode = 'P0001';
  end if;

  -- 5. Internal helpers are not exposed.
  if has_function_privilege('anon', 'public.has_current_consent(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.has_current_consent(uuid)', 'execute')
     or has_function_privilege('anon', 'public.assert_current_notice_version(text)', 'execute')
     or has_function_privilege('authenticated', 'public.assert_current_notice_version(text)', 'execute') then
    raise exception 'internal consent helpers are exposed through the API.' using errcode = 'P0001';
  end if;

  -- 6. appointments.reason exists and the export carries it.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'reason'
  ) then
    raise exception 'appointments.reason is missing.' using errcode = 'P0001';
  end if;

  if coalesce((select p.prosrc from pg_proc p where p.oid = 'public.export_my_data()'::regprocedure), '')
     not like '%a.reason%' then
    raise exception 'export_my_data does not include appointments.reason.' using errcode = 'P0001';
  end if;

  raise notice 'Migration 13 PASSED: anonymous booking retired, verified booking RPCs installed for notice version %.',
    public.privacy_notice_version();
end $$;
