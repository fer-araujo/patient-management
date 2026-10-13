-- =============================================================================
-- 29 - Re-audit fixes
-- =============================================================================
-- Problems this file fixes (re-audit findings in brackets):
--   [N1] export_my_data() returned every prescription of the patient,
--        drafts included. Migration 27 closed drafts for the direct read
--        (prescriptions_select_own) but the ARCO export kept the migration 24
--        body, so the doctor's work-in-progress medication list reached the
--        patient before the consultation was closed.
--   [N2] request -> cancel loops were unbounded. Each online request sends
--        "Recibimos tu solicitud" and each online cancellation sends
--        "CANCELADA": two paid WhatsApp messages per loop. Migration 27 capped
--        reschedules per appointment and request_my_appointment caps only the
--        PENDING requests (3), which a cancellation frees at once.
--   [O3] Supabase's default privileges grant EXECUTE on every NEW function to
--        PUBLIC, anon and authenticated. The surface gates of migrations
--        26-28 check only the functions that exist when they run, so a later
--        SECURITY DEFINER function that forgot its revoke would ship
--        callable by anon.
--
-- Design:
--   * [N1] export_my_data() = migration 24 body + "and pr.finalized_at is not
--     null" in the prescriptions block, the same rule as the direct read.
--   * [N2] Two markers on appointments, written only by the patient RPCs:
--       requested_online      true when request_my_appointment() inserted
--                             the row (staff bookings: false);
--       patient_cancelled_at  when cancel_my_appointment() cancelled it
--                             (staff cancellations: NULL).
--     A BEFORE trigger (appointments_guard_online_markers) forces both on
--     INSERT (requested_online stays true only while the transaction-local
--     flag app.patient_online_request is 'on'; patient_cancelled_at is
--     NULL), refuses any later change of requested_online and refuses a
--     change of patient_cancelled_at unless app.patient_cancel holds that
--     row's id. Same pattern as app.patient_reschedule (migration 27): the
--     API cannot set app.* settings, so not even the doctor can forge or
--     reset a marker through the API.
--     request_my_appointment() refuses a 4th online request within a
--     rolling 24 hours (requested_online rows created in the window, any
--     status) and cancel_my_appointment() refuses a 4th online cancellation
--     within a rolling 24 hours (patient_cancelled_at in the window).
--     cancel_my_appointment() now takes the booking advisory lock, like the
--     other patient RPCs, so two concurrent cancellations cannot both pass
--     the count. Staff RPCs and staff updates are not limited.
--     Why columns on appointments and not a separate ledger or audit_log:
--       - a new table would make the pre-production reset refuse to run (it
--         aborts on any public table it does not know) and needs its own
--         audit trigger, RLS and grants;
--       - audit_log has no marker for "cancelled by the patient online"
--         (the UPDATE logs column names only, and a reschedule also changes
--         status), and its action list is a CHECK constraint;
--       - appointments.updated_by is rewritten on EVERY update (the doctor's
--         confirmation turns 'patient' into 'doctor'), so it cannot count
--         requests.
--     Patients cannot insert, update or delete appointments directly (RLS:
--     SELECT only), so the counts cannot be lowered from the patient side.
--     Only a doctor deleting rows by hand would lower them; the app has no
--     delete for appointments. Requests and cancellations made before this
--     migration are not counted (no backfill): at most one day of slack.
--   * [O3] alter default privileges for role postgres:
--       - globally: revoke EXECUTE on functions from PUBLIC. Postgres ignores
--         a per-schema revoke of a privilege that is granted globally, and
--         the PUBLIC grant on functions is the built-in global default, so
--         only the global form removes it (and anon inherits PUBLIC). It
--         covers functions postgres creates in ANY schema.
--       - in schema public: revoke EXECUTE from anon and authenticated (this
--         is where Supabase grants them) and, globally too, in case a
--         project granted them without a schema.
--     authenticated is included because every existing function that
--     authenticated calls has an explicit "grant execute ... to
--     authenticated" in its migration (checked across migrations 01-28: no
--     function relies on the implicit grant; trigger functions need none).
--     service_role keeps its default grant (edge functions may need RPCs).
--     Existing functions keep their current grants: default privileges
--     apply only to functions created from now on. Every new function must
--     grant EXECUTE explicitly (see docs/security-runbook.md).
--   * The three redefined RPCs keep their signatures, so the reviewed list
--     of migrations 27/28 is unchanged. Their grants are re-stated and now
--     also revoked from service_role (nothing calls them with it; without a
--     user session current_patient_id() is NULL anyway).
--
-- Function bodies are copied verbatim from their latest migration (named in
-- each section) and only the marked "Migration 29" lines are added.
--
-- No frontend dependency: the portal already shows P0001 messages as they
-- are. Note for maintainers: re-running migrations 24 or 27 restores the
-- older bodies of export_my_data(), request_my_appointment() or
-- cancel_my_appointment(). Run this file again afterwards.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- [N1] export_my_data - migration 24 body + finalized prescriptions only
-- -----------------------------------------------------------------------------
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
               'dob', p.dob, 'address', p.address,
               'blood_type', p.blood_type,
               'allergies', p.allergies,
               'chronic_conditions', p.chronic_conditions,
               'family_history', p.family_history,
               'personal_pathological_history', p.personal_pathological_history,
               'non_pathological_history', p.non_pathological_history,
               'current_illness', p.current_illness,
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
    'prescriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'appointment_id', pr.appointment_id,
               'created_at', pr.created_at, 'finalized_at', pr.finalized_at,
               'medications', pr.medications)
             order by pr.created_at)
      from public.prescriptions pr
      where pr.patient_id = v_pid
        -- Migration 29: drafts stay with the doctor (same rule as
        -- prescriptions_select_own, migration 27).
        and pr.finalized_at is not null), '[]'::jsonb),
    -- Migration 24: the patient's body composition measurements. Explicit
    -- column list: the doctor's note on a measurement is not exported.
    'body_measurements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'measured_at', bm.measured_at,
               'weight_kg', bm.weight_kg, 'height_cm', bm.height_cm, 'bmi', bm.bmi,
               'body_fat_pct', bm.body_fat_pct, 'body_fat_kg', bm.body_fat_kg,
               'skeletal_muscle_kg', bm.skeletal_muscle_kg, 'lean_mass_kg', bm.lean_mass_kg,
               'waist_hip_ratio', bm.waist_hip_ratio,
               'visceral_fat_level', bm.visceral_fat_level, 'bmr_kcal', bm.bmr_kcal,
               'balance_upper_lower', bm.balance_upper_lower,
               'body_type', bm.body_type, 'cid_type', bm.cid_type)
             order by bm.measured_at, bm.created_at)
      from public.body_measurements bm where bm.patient_id = v_pid), '[]'::jsonb),
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

revoke all on function public.export_my_data() from public, anon, authenticated, service_role;
grant execute on function public.export_my_data() to authenticated;

-- -----------------------------------------------------------------------------
-- [N2] Daily limits (internal constants)
-- -----------------------------------------------------------------------------
create or replace function public.patient_online_request_limit()
returns integer language sql immutable set search_path = pg_temp as $$ select 3 $$;

create or replace function public.patient_online_cancel_limit()
returns integer language sql immutable set search_path = pg_temp as $$ select 3 $$;

revoke all on function public.patient_online_request_limit() from public, anon, authenticated, service_role;
revoke all on function public.patient_online_cancel_limit()  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- [N2] appointments.requested_online / patient_cancelled_at, written only by
--      the patient RPCs
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column if not exists requested_online boolean not null default false;

alter table public.appointments
  add column if not exists patient_cancelled_at timestamptz;

comment on column public.appointments.requested_online is
  'True when the patient requested this appointment online (request_my_appointment). Set only by that RPC, never changed afterwards.';

comment on column public.appointments.patient_cancelled_at is
  'When the patient cancelled this appointment online (cancel_my_appointment). Written only by that RPC; NULL for staff cancellations.';

create or replace function public.appointments_guard_online_markers()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.patient_online_request', true), '') <> 'on' then
      new.requested_online := false;
    end if;
    new.patient_cancelled_at := null;
  else
    if new.requested_online is distinct from old.requested_online then
      raise exception 'El origen de la cita (en línea o en clínica) no se puede cambiar.'
        using errcode = '42501';
    end if;

    if new.patient_cancelled_at is distinct from old.patient_cancelled_at
       and coalesce(current_setting('app.patient_cancel', true), '') <> old.id::text then
      raise exception 'La fecha de cancelación en línea solo cambia al cancelar en línea.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.appointments_guard_online_markers() from public, anon, authenticated, service_role;

drop trigger if exists appointments_guard_online_markers on public.appointments;
create trigger appointments_guard_online_markers
  before insert or update on public.appointments
  for each row execute function public.appointments_guard_online_markers();

-- -----------------------------------------------------------------------------
-- [N2] request_my_appointment - migration 27 body + daily request limit
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
  v_recent_count   integer;
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

  -- Migration 29: each online request sends a WhatsApp message. Every
  -- request made online in the last 24 hours counts, whatever its status
  -- now (a cancelled one too).
  select count(*)
    into v_recent_count
  from public.appointments a
  where a.patient_id = v_patient_id
    and a.requested_online
    and a.created_at > now() - interval '24 hours';

  if v_recent_count >= public.patient_online_request_limit() then
    raise exception 'Alcanzaste el límite de solicitudes en línea por hoy. Comunícate con la clínica.'
      using errcode = 'P0001';
  end if;

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

  -- Migration 29: only this RPC may mark a row as requested online (see the
  -- guard trigger).
  perform set_config('app.patient_online_request', 'on', true);

  insert into public.appointments (patient_id, service_id, start_time, status, reason, requested_online)
  values (v_patient_id, p_service_id, p_start_time, 'pending', v_reason, true)
  returning id into v_appointment_id;

  perform set_config('app.patient_online_request', '', true);

  return v_appointment_id;
end;
$$;

revoke all on function public.request_my_appointment(uuid, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.request_my_appointment(uuid, timestamptz, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [N2] cancel_my_appointment - migration 27 body + daily cancellation limit
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
  v_patient_id   uuid := public.current_patient_id();
  v_current      timestamptz;
  v_recent_count integer;
begin
  -- Migration 23: no online changes in doctor-only mode.
  perform public.assert_patient_portal_open();

  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  -- Migration 29: serialize with the other patient RPCs so two concurrent
  -- cancellations cannot both pass the daily count below. Taken after the
  -- patient check so unlinked sessions never contend for the booking lock.
  perform pg_advisory_xact_lock(public.booking_lock_key());

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

  -- Migration 29: each online cancellation sends a WhatsApp message.
  select count(*)
    into v_recent_count
  from public.appointments a
  where a.patient_id = v_patient_id
    and a.patient_cancelled_at > now() - interval '24 hours';

  if v_recent_count >= public.patient_online_cancel_limit() then
    raise exception 'Alcanzaste el límite de cancelaciones en línea por hoy. Comunícate con la clínica.'
      using errcode = 'P0001';
  end if;

  -- Migration 29: only this RPC may stamp patient_cancelled_at (see the
  -- guard trigger).
  perform set_config('app.patient_cancel', p_appointment_id::text, true);

  update public.appointments a
     set status               = 'cancelled',
         cancel_reason        = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cancelada por el paciente'),
         patient_cancelled_at = now()
   where a.id = p_appointment_id
     and a.patient_id = v_patient_id
     and a.status in ('pending', 'confirmed')
     and a.start_time > now();

  if not found then
    raise exception 'No se pudo cancelar la cita. Actualiza la página e inténtalo de nuevo.'
      using errcode = 'P0001';
  end if;

  perform set_config('app.patient_cancel', '', true);
end;
$$;

revoke all on function public.cancel_my_appointment(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_my_appointment(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- [O3] New functions are not executable by PUBLIC, anon or authenticated
-- -----------------------------------------------------------------------------
-- Global form: the only one that removes the built-in PUBLIC grant.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres revoke execute on functions from anon, authenticated;
-- Per-schema form: where Supabase grants anon and authenticated.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- Keep the old behaviour for extensions enabled later from the dashboard
-- (pg_trgm, unaccent, ...): per-schema grants are additive, so functions
-- created in `extensions` stay executable as before. Only the app schema
-- (public) requires explicit grants.
alter default privileges for role postgres in schema extensions grant execute on functions to public;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn    text;
  v_clean text;
  v_bad   text;
  v_ok    boolean;
  v_rec   record;
begin
  -- 1. [N1] export_my_data(): SECURITY DEFINER, pinned search_path, only
  --    finalized prescriptions.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.export_my_data()'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'from public\.prescriptions pr where pr\.patient_id = v_pid and pr\.finalized_at is not null\)' then
    raise exception 'Migration 29 FAILED: export_my_data() must be SECURITY DEFINER with a pinned search_path and export finalized prescriptions only.'
      using errcode = 'P0001';
  end if;

  -- 2. [N2] Markers, guard trigger and limits.
  if (select count(*) from pg_attribute
      where attrelid = 'public.appointments'::regclass and not attisdropped
        and ((attname = 'requested_online' and atttypid = 'boolean'::regtype and attnotnull)
             or (attname = 'patient_cancelled_at' and atttypid = 'timestamptz'::regtype))) <> 2 then
    raise exception 'Migration 29 FAILED: appointments.requested_online (boolean not null) or patient_cancelled_at (timestamptz) is missing.'
      using errcode = 'P0001';
  end if;

  -- tgtype bits: 1 row, 2 before, 4 insert, 16 update.
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and not t.tgisinternal
      and t.tgname = 'appointments_guard_online_markers'
      and t.tgenabled <> 'D'
      and t.tgfoid = 'public.appointments_guard_online_markers()'::regprocedure
      and (t.tgtype::integer & 23) = 23
  ) then
    raise exception 'Migration 29 FAILED: the enabled BEFORE INSERT OR UPDATE FOR EACH ROW trigger appointments_guard_online_markers is missing.'
      using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.request_my_appointment(uuid,timestamptz,text)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'and a\.requested_online and a\.created_at > now\(\) - interval ; if v_recent_count >= public\.patient_online_request_limit\(\) then raise'
     or v_clean !~ 'perform set_config\( , , true\); insert into public\.appointments \(patient_id, service_id, start_time, status, reason, requested_online\)' then
    raise exception 'Migration 29 FAILED: request_my_appointment() must refuse the 4th online request in 24 hours and mark its rows as requested online.'
      using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.cancel_my_appointment(uuid,text)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'perform pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
     or v_clean !~ 'and a\.patient_cancelled_at > now\(\) - interval ; if v_recent_count >= public\.patient_online_cancel_limit\(\) then raise'
     or v_clean !~ 'patient_cancelled_at = now\(\)' then
    raise exception 'Migration 29 FAILED: cancel_my_appointment() must lock, refuse the 4th online cancellation in 24 hours and stamp patient_cancelled_at.'
      using errcode = 'P0001';
  end if;

  -- 3. The new internal functions and the redefined RPCs: no API role
  --    beyond authenticated (and authenticated only for the RPCs).
  foreach v_fn in array array[
    'public.patient_online_request_limit()',
    'public.patient_online_cancel_limit()',
    'public.appointments_guard_online_markers()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Migration 29 FAILED: % is executable by anon, authenticated or service_role.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  foreach v_fn in array array[
    'public.export_my_data()',
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.cancel_my_appointment(uuid,text)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 29 FAILED: % must be executable by authenticated only.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- 4. [O3] Default privileges for functions created by postgres.
  --    The global entry must exist (without it the built-in PUBLIC grant
  --    applies) and neither it nor the public-schema entry may give EXECUTE
  --    to PUBLIC (grantee 0), anon or authenticated.
  if not exists (
    select 1 from pg_default_acl d
    where d.defaclrole = 'postgres'::regrole::oid
      and d.defaclnamespace = 0::oid
      and d.defaclobjtype = 'f'
  ) then
    raise exception 'Migration 29 FAILED: postgres has no global default privileges for functions, so new functions stay executable by PUBLIC.'
      using errcode = 'P0001';
  end if;

  select string_agg(
           coalesce(nullif(d.defaclnamespace, 0::oid)::regnamespace::text, '(all schemas)')
           || ': ' || case when x.grantee = 0::oid then 'PUBLIC' else x.grantee::regrole::text end,
           ', ')
    into v_bad
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) x
  where d.defaclrole = 'postgres'::regrole::oid
    and d.defaclobjtype = 'f'
    and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
    and x.privilege_type = 'EXECUTE'
    and x.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid);
  if v_bad is not null then
    raise exception 'Migration 29 FAILED: default privileges still give EXECUTE on new functions to %.', v_bad
      using errcode = 'P0001';
  end if;

  --    Proof with a real function, when this file runs as postgres (the
  --    SQL editor does): a new function in public is not executable by anon
  --    or authenticated. It is dropped right away.
  if current_user = 'postgres' then
    drop function if exists public.migration_29_default_acl_probe();
    create function public.migration_29_default_acl_probe()
    returns integer language sql immutable set search_path = pg_temp as $probe$ select 1 $probe$;
    v_ok := not has_function_privilege('anon', 'public.migration_29_default_acl_probe()', 'execute')
            and not has_function_privilege('authenticated', 'public.migration_29_default_acl_probe()', 'execute');
    drop function public.migration_29_default_acl_probe();
    if not v_ok then
      raise exception 'Migration 29 FAILED: a function created now is still executable by anon or authenticated.'
        using errcode = 'P0001';
    end if;
  else
    raise notice 'Migration 29: running as %, not postgres; the new-function probe was skipped (the pg_default_acl checks above still ran).', current_user;
  end if;

  -- 5. Migration 26 rules still hold: no trigger function is executable by
  --    an API role.
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
    raise exception 'Migration 29 FAILED: trigger functions executable by anon, authenticated or service_role: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 6. Migration 27's SECURITY DEFINER surface, unchanged: this file adds
  --    no function anon or authenticated can execute and keeps every
  --    signature. Functions are matched by SIGNATURE (oid), never by name,
  --    so a new overload cannot slip in. The guard must be real code:
  --    comments and string literals are stripped from the body before
  --    matching, and staff RPCs need an actual "if not public.<guard>() then
  --    raise".
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
        -- Migration 31 (open clinical notes): listed here too so a re-run of this file still passes.
        ('public.close_clinical_note(uuid)', 'staff'),
        ('public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)', 'staff'),
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
      raise exception 'Migration 29 FAILED: unreviewed SECURITY DEFINER function executable by anon or authenticated: %. Nothing was changed.', v_rec.sig
        using errcode = 'P0001';
    end if;

    if v_rec.anon_x and v_rec.kind <> 'public' then
      raise exception 'Migration 29 FAILED: anon can execute %.', v_rec.sig using errcode = 'P0001';
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
      raise exception 'Migration 29 FAILED: % (%) has no internal % guard in its code.', v_rec.sig, v_rec.kind, v_rec.kind
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Migration 29 PASSED: export_my_data() exports finalized prescriptions only; request_my_appointment() refuses a 4th online request and cancel_my_appointment() a 4th online cancellation within a rolling 24 hours, counted from markers only those RPCs can write (staff paths unchanged); new functions created by postgres are not executable by PUBLIC, anon or authenticated; no trigger function is API-executable; the SECURITY DEFINER surface matches the reviewed list by signature.';
end $$;
