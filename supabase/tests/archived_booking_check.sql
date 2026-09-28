-- =============================================================================
-- Archived booking check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 21 objects, that:
--   * ARCHIVED: staff_create_appointment(), a direct INSERT, a direct move, a
--     staff reschedule and a re-activation are all refused for an archived
--     patient, while status-only changes (confirm, cancel) still work;
--     request_my_appointment() and reschedule_my_appointment() refuse the
--     archived patient too; once restored, the patient books again;
--   * SUSPENDED: request_my_appointment() and reschedule_my_appointment()
--     refuse a suspended patient, but the doctor can still book them;
--   * ANONYMIZED: the record cannot be restored (status away from 'archived')
--     and anonymized_at cannot be cleared.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway user, patients,
--     service and appointments are never committed, pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call, or if a real appointment or
--     blocked slot sits near the far-future test window.
--   * ALTER TABLE ... DISABLE TRIGGER holds a lock on public.appointments until
--     the ROLLBACK. The script takes well under a second; run it off-hours.
--
-- Expected output: a single notice that starts with "ARCHIVED BOOKING CHECK PASSED".
-- Any "ARCHIVED BOOKING CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'whatsapp_notifications'
  ) then
    execute 'alter table public.appointments disable trigger whatsapp_notifications';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.patients'::regclass
      and tgname = 'patients_keep_anonymized_archived'
      and tgenabled <> 'D'
  ) then
    raise exception 'ARCHIVED BOOKING CHECK ABORTED: migration 21 is not applied (patients_keep_anonymized_archived is missing or disabled).';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgrelid in (
        'public.appointments'::regclass, 'public.patients'::regclass,
        'public.services'::regclass, 'public.profiles'::regclass,
        'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'ARCHIVED BOOKING CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- One doctor; an archived (X), a suspended (B), an active (A) and an
-- anonymized (N) patient; an active 30-minute service. X and B each have one
-- appointment, created before X was archived. Test slots sit ~8 years ahead.
do $$
declare
  v_phone_x   text := '+529990000501';
  v_phone_b   text := '+529990000502';
  v_phone_a   text := '+529990000503';
  v_user_s    uuid := gen_random_uuid();
  v_archived  uuid;
  v_blocked   uuid;
  v_active    uuid;
  v_anon      uuid;
  v_svc       uuid;
  v_appt_x    uuid;
  v_appt_b    uuid;
  v_start     timestamptz := date_trunc('hour', now()) + interval '3001 days';
begin
  if exists (
    select 1 from public.patients
    where public.normalize_phone(phone) in (
      public.normalize_phone(v_phone_x), public.normalize_phone(v_phone_b), public.normalize_phone(v_phone_a))
  ) then
    raise exception 'ARCHIVED BOOKING CHECK ABORTED: a throwaway test phone already exists. Nothing was changed.';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.start_time between v_start - interval '1 day' and v_start + interval '1 day'
  ) or exists (
    select 1 from public.blocked_slots b
    where b.start_time < v_start + interval '1 day' and b.end_time > v_start - interval '1 day'
  ) then
    raise exception 'ARCHIVED BOOKING CHECK ABORTED: real data sits near the test window %. Nothing was changed.', v_start;
  end if;

  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user_s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          null, 'archived-booking-check-' || v_user_s || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_s;

  -- Active: request_my_appointment() only books services in the catalog.
  insert into public.services (name, duration_mins, price, is_active)
  values ('ARCHIVED-BOOKING-CHECK service', 30, 500, true)
  returning id into v_svc;

  -- X: booked while active, then archived.
  insert into public.patients (first_name, last_name, phone, status)
  values ('ARCHIVED-BOOKING-CHECK', 'Archived', v_phone_x, 'active')
  returning id into v_archived;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_archived, v_svc, v_start + interval '4 hours', 'pending')
  returning id into v_appt_x;

  update public.patients set status = 'archived' where id = v_archived;

  -- B: suspended, with an appointment.
  insert into public.patients (first_name, last_name, phone, status)
  values ('ARCHIVED-BOOKING-CHECK', 'Suspended', v_phone_b, 'blocked')
  returning id into v_blocked;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_blocked, v_svc, v_start + interval '6 hours', 'pending')
  returning id into v_appt_b;

  insert into public.patients (first_name, last_name, phone, status)
  values ('ARCHIVED-BOOKING-CHECK', 'Active', v_phone_a, 'active')
  returning id into v_active;

  -- N: already anonymized (as anonymize_patient() leaves it).
  insert into public.patients (first_name, last_name, phone, status, anonymized_at)
  values ('Paciente', 'Anonimizado', null, 'archived', now())
  returning id into v_anon;

  perform set_config('archived_booking_check.user_s', v_user_s::text, true);
  perform set_config('archived_booking_check.archived', v_archived::text, true);
  perform set_config('archived_booking_check.blocked', v_blocked::text, true);
  perform set_config('archived_booking_check.active', v_active::text, true);
  perform set_config('archived_booking_check.anon', v_anon::text, true);
  perform set_config('archived_booking_check.service', v_svc::text, true);
  perform set_config('archived_booking_check.appt_x', v_appt_x::text, true);
  perform set_config('archived_booking_check.appt_b', v_appt_b::text, true);
  perform set_config('archived_booking_check.start', v_start::text, true);
  perform set_config('archived_booking_check.claim_phone_x', public.normalize_phone(v_phone_x), true);
  perform set_config('archived_booking_check.claim_phone_b', public.normalize_phone(v_phone_b), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Staff session (authenticated doctor, direct table writes allowed by RLS)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('archived_booking_check.user_s'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_archived uuid        := current_setting('archived_booking_check.archived')::uuid;
  v_blocked  uuid        := current_setting('archived_booking_check.blocked')::uuid;
  v_active   uuid        := current_setting('archived_booking_check.active')::uuid;
  v_anon     uuid        := current_setting('archived_booking_check.anon')::uuid;
  v_svc      uuid        := current_setting('archived_booking_check.service')::uuid;
  v_appt_x   uuid        := current_setting('archived_booking_check.appt_x')::uuid;
  v_start    timestamptz := current_setting('archived_booking_check.start')::timestamptz;
  v_refused  boolean;
  v_message  text;
  v_rows     integer;
begin
  if not public.is_staff() then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- 2a. staff_create_appointment() refuses an archived patient.
  v_refused := false; v_message := null;
  begin
    perform public.staff_create_appointment(v_archived, v_svc, v_start);
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'archivado' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: staff_create_appointment() booked an archived patient (or refused it for another reason: %).', v_message;
  end if;

  -- 2b. The same slot and service still work for an active patient.
  perform public.staff_create_appointment(v_active, v_svc, v_start);

  -- 2c. A direct INSERT for the archived patient is refused.
  v_refused := false; v_message := null;
  begin
    insert into public.appointments (patient_id, service_id, start_time, status)
    values (v_archived, v_svc, v_start + interval '8 hours', 'confirmed');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'archivado' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: a direct INSERT booked an archived patient (or was refused for another reason: %).', v_message;
  end if;

  -- 2d. A direct UPDATE moving the archived patient's appointment is refused.
  v_refused := false; v_message := null;
  begin
    update public.appointments set start_time = v_start + interval '9 hours' where id = v_appt_x;
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'archivado' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: a direct UPDATE moved an archived patient''s appointment (or was refused for another reason: %).', v_message;
  end if;

  -- 2e. Status-only changes still work for the archived patient.
  update public.appointments set status = 'confirmed' where id = v_appt_x;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: confirming an archived patient''s appointment did not work.';
  end if;

  -- 2f. staff_reschedule_appointment() cannot move it (the trigger refuses).
  v_refused := false; v_message := null;
  begin
    perform public.staff_reschedule_appointment(v_appt_x, v_start + interval '10 hours');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'archivado' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: staff_reschedule_appointment() moved an archived patient''s appointment (or refused it for another reason: %).', v_message;
  end if;

  update public.appointments set status = 'cancelled' where id = v_appt_x;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: cancelling an archived patient''s appointment did not work.';
  end if;

  -- 2g. Re-activating the cancelled appointment is refused.
  v_refused := false; v_message := null;
  begin
    update public.appointments set status = 'pending' where id = v_appt_x;
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'archivado' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: a cancelled appointment of an archived patient was re-activated (or refused for another reason: %).', v_message;
  end if;

  -- 2h. The doctor can still book a suspended patient.
  perform public.staff_create_appointment(v_blocked, v_svc, v_start + interval '12 hours');

  -- 2i. An anonymized record cannot be restored or un-anonymized.
  v_refused := false; v_message := null;
  begin
    update public.patients set status = 'active' where id = v_anon;
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'anonimizado' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: an anonymized record was restored (or refused for another reason: %).', v_message;
  end if;

  v_refused := false; v_message := null;
  begin
    update public.patients set anonymized_at = null where id = v_anon;
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'anonimizado' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: anonymized_at was cleared (or refused for another reason: %).', v_message;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Patient sessions: the archived and the suspended patient online
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'phone', current_setting('archived_booking_check.claim_phone_x'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_archived uuid        := current_setting('archived_booking_check.archived')::uuid;
  v_svc      uuid        := current_setting('archived_booking_check.service')::uuid;
  v_appt_x   uuid        := current_setting('archived_booking_check.appt_x')::uuid;
  v_start    timestamptz := current_setting('archived_booking_check.start')::timestamptz;
  v_refused  boolean;
  v_message  text;
begin
  if public.current_patient_id() is distinct from v_archived then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: the test session does not resolve to the archived record.';
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.request_my_appointment(v_svc, v_start + interval '2 hours', null);
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'inactivo' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: request_my_appointment() booked an archived patient (or refused it for another reason: %).', v_message;
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.reschedule_my_appointment(v_appt_x, v_start + interval '14 hours');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'inactivo' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: reschedule_my_appointment() did not refuse an archived patient (%).', v_message;
  end if;
end $$;

reset role;

do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'phone', current_setting('archived_booking_check.claim_phone_b'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_blocked  uuid        := current_setting('archived_booking_check.blocked')::uuid;
  v_svc      uuid        := current_setting('archived_booking_check.service')::uuid;
  v_appt_b   uuid        := current_setting('archived_booking_check.appt_b')::uuid;
  v_start    timestamptz := current_setting('archived_booking_check.start')::timestamptz;
  v_refused  boolean;
  v_message  text;
begin
  if public.current_patient_id() is distinct from v_blocked then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: the test session does not resolve to the suspended record.';
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.request_my_appointment(v_svc, v_start + interval '16 hours', null);
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'en línea' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: request_my_appointment() booked a suspended patient (or refused it for another reason: %).', v_message;
  end if;

  -- A valid move of their own pending appointment, refused only for the status.
  v_refused := false; v_message := null;
  begin
    perform public.reschedule_my_appointment(v_appt_b, v_start + interval '18 hours');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'en línea' then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: reschedule_my_appointment() moved a suspended patient''s appointment (or refused it for another reason: %).', v_message;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Nothing was written for the archived patient; restoring allows booking
-- -----------------------------------------------------------------------------
do $$
declare
  v_archived uuid        := current_setting('archived_booking_check.archived')::uuid;
  v_blocked  uuid        := current_setting('archived_booking_check.blocked')::uuid;
  v_appt_x   uuid        := current_setting('archived_booking_check.appt_x')::uuid;
  v_appt_b   uuid        := current_setting('archived_booking_check.appt_b')::uuid;
  v_start    timestamptz := current_setting('archived_booking_check.start')::timestamptz;
begin
  if (select count(*) from public.appointments where patient_id = v_archived) <> 1
     or not exists (
       select 1 from public.appointments
       where id = v_appt_x and status = 'cancelled' and start_time = v_start + interval '4 hours')
  then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: an appointment of the archived patient was created or moved.';
  end if;

  if not exists (
    select 1 from public.appointments
    where id = v_appt_b and status = 'pending' and start_time = v_start + interval '6 hours')
  or not exists (
    select 1 from public.appointments
    where patient_id = v_blocked and start_time = v_start + interval '12 hours' and status = 'confirmed')
  then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: the suspended patient''s appointments are not as expected.';
  end if;

  if not exists (
    select 1 from public.patients
    where id = current_setting('archived_booking_check.anon')::uuid
      and status = 'archived' and anonymized_at is not null)
  then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: the anonymized record changed.';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('archived_booking_check.user_s'),
    'role', 'authenticated')::text, true);
end $$;

-- "Restaurar Paciente" in the directory, as the doctor.
set local role authenticated;

do $$
declare
  v_rows integer;
begin
  update public.patients set status = 'active'
  where id = current_setting('archived_booking_check.archived')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: the doctor could not restore an archived (not anonymized) patient.';
  end if;
end $$;

reset role;

do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'phone', current_setting('archived_booking_check.claim_phone_x'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_svc      uuid        := current_setting('archived_booking_check.service')::uuid;
  v_start    timestamptz := current_setting('archived_booking_check.start')::timestamptz;
begin
  perform public.request_my_appointment(v_svc, v_start + interval '2 hours', null);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from public.appointments
    where patient_id = current_setting('archived_booking_check.archived')::uuid
      and status = 'pending'
  ) then
    raise exception 'ARCHIVED BOOKING CHECK FAILED: the restored patient could not book online.';
  end if;

  raise notice 'ARCHIVED BOOKING CHECK PASSED: an archived patient cannot be booked, moved or re-activated by any path (status-only changes still work), a suspended patient cannot book or reschedule online but the doctor can book them, an anonymized record cannot be restored, and a restored patient books again. All test data was rolled back.';
end $$;

rollback;
