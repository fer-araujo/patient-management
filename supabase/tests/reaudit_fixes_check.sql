-- =============================================================================
-- Re-audit fixes check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 29 objects, that:
--   * [N1] export_my_data() contains the patient's finalized prescription and
--          never a draft one;
--   * [N2] a patient makes 3 online requests and 3 online cancellations, and
--          the 4th request and the 4th cancellation within 24 hours are
--          refused with the "Alcanzaste el límite ..." message;
--          the doctor still books and cancels for that patient (staff paths
--          are not limited and leave no online marker), and cannot forge or
--          reset the markers directly; once the markers are older than 24
--          hours the patient can request and cancel again (rolling window);
--   * [O3] a function created now in public is not executable by anon or
--          authenticated, and pg_default_acl gives EXECUTE on new functions
--          to neither PUBLIC, anon nor authenticated.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users,
--     patient, service, appointments, note, prescriptions, the probe
--     function, the clinic_settings changes (mode and a known test schedule)
--     and audit rows are never committed, pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The appointments_prevent_overlap trigger (migration 19) is disabled the
--     same way for the owner's fixture inserts. The RPCs still check the slot
--     with assert_slot_free(), so the script picks a test weekday, 100 to 118
--     days ahead, with no real appointment or block, and aborts if there is
--     none.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * ALTER TABLE ... DISABLE TRIGGER and the clinic_settings update hold
--     locks until the ROLLBACK. The script takes well under a second; run it
--     off-hours.
--
-- Expected output: a single notice that starts with "REAUDIT FIXES CHECK PASSED".
-- Any "REAUDIT FIXES CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Migration 29 applied; no outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.patient_online_request_limit()') is null
     or to_regprocedure('public.appointments_guard_online_markers()') is null
     or to_regprocedure('public.get_my_profile()') is null then
    raise exception 'REAUDIT FIXES CHECK ABORTED: migrations 27 and 29 are not both applied. Nothing was changed.';
  end if;

  -- The default-privileges probe (section 6) is about functions postgres
  -- creates, so the script must run as postgres (the SQL editor does).
  if current_user <> 'postgres' then
    raise exception 'REAUDIT FIXES CHECK ABORTED: run this script as postgres (got %). Nothing was changed.', current_user;
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass and tgname = 'whatsapp_notifications'
  ) then
    execute 'alter table public.appointments disable trigger whatsapp_notifications';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass and tgname = 'appointments_prevent_overlap'
  ) then
    execute 'alter table public.appointments disable trigger appointments_prevent_overlap';
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
        'public.services'::regclass, 'public.clinical_notes'::regclass,
        'public.prescriptions'::regclass, 'public.clinic_settings'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'REAUDIT FIXES CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_tz          text := 'America/Monterrey';
  v_phone_p     text := '+529990002901';
  v_user_d      uuid := gen_random_uuid();
  v_user_p      uuid := gen_random_uuid();
  v_today       date := (now() at time zone 'America/Monterrey')::date;
  v_day         date;
  v_patient     uuid;
  v_svc         uuid;
  v_appt_past   uuid;
  v_appt_draft  uuid;
  v_appt_booked uuid;
begin
  if exists (
    select 1 from public.patients
    where public.normalize_phone(phone) = public.normalize_phone(v_phone_p)
  ) or exists (
    select 1 from auth.users
    where public.normalize_phone(phone) = public.normalize_phone(v_phone_p)
  ) then
    raise exception 'REAUDIT FIXES CHECK ABORTED: the throwaway test phone already exists. Nothing was changed.';
  end if;

  -- A weekday 100-118 days ahead with no real appointment or block.
  v_day := null;
  for i in 100..118 loop
    if extract(dow from v_today + i) not in (0, 6)
       and not exists (
         select 1 from public.appointments a
         where a.start_time >= ((v_today + i)::timestamp) at time zone v_tz
           and a.start_time <  ((v_today + i + 1)::timestamp) at time zone v_tz
       ) and not exists (
         select 1 from public.blocked_slots b
         where b.start_time < ((v_today + i + 1)::timestamp) at time zone v_tz
           and b.end_time   > ((v_today + i)::timestamp) at time zone v_tz
       ) then
      v_day := v_today + i;
      exit;
    end if;
  end loop;
  if v_day is null then
    raise exception 'REAUDIT FIXES CHECK ABORTED: no free weekday 100-118 days ahead. Nothing was changed.';
  end if;

  -- Mode OFF and a known schedule for this transaction (Mon-Sat 08:00-18:00,
  -- Sunday closed); the ROLLBACK restores the clinic's own.
  update public.clinic_settings
     set doctor_only_mode = false,
         schedule = '{
           "0": {"isOpen": false, "start": "08:00 AM", "end": "06:00 PM"},
           "1": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
           "2": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
           "3": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
           "4": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
           "5": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"},
           "6": {"isOpen": true,  "start": "08:00 AM", "end": "06:00 PM"}
         }'::jsonb,
         updated_at = now()
   where id is not null;
  if not found then
    raise exception 'REAUDIT FIXES CHECK ABORTED: clinic_settings has no row; save the schedule in the app first. Nothing was changed.';
  end if;

  -- Users: doctor and patient P (confirmed phone).
  insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, email,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, null, 'reaudit-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone_p), now(), null, '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;

  insert into public.patients (first_name, last_name, phone, status)
  values ('REAUDIT-CHECK', 'Patient', v_phone_p, 'active')
  returning id into v_patient;

  insert into public.services (name, duration_mins, price, is_active)
  values ('REAUDIT-CHECK service', 30, 700, true)
  returning id into v_svc;

  -- Started an hour ago, with a FINALIZED note and prescription.
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '1 hour', 'confirmed')
  returning id into v_appt_past;
  insert into public.clinical_notes (appointment_id, patient_id, subjective, analysis, plan)
  values (v_appt_past, v_patient, 'S', 'REAUDIT-CHECK diagnosis', 'REAUDIT-CHECK plan');
  -- The prescription must exist before the note is finalized: once the
  -- consultation is finalized, prescriptions_enforce_integrity refuses inserts.
  insert into public.prescriptions (appointment_id, patient_id, medications)
  values (v_appt_past, v_patient, '[{"nombre": "REAUDIT-CHECK FINAL", "dosis": "1"}]'::jsonb);
  update public.clinical_notes set finalized_at = now() where appointment_id = v_appt_past;
  update public.prescriptions set finalized_at = now() where appointment_id = v_appt_past;

  -- In the future, with a DRAFT note and prescription.
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, (v_day + time '15:00') at time zone v_tz, 'confirmed')
  returning id into v_appt_draft;
  insert into public.clinical_notes (appointment_id, patient_id, subjective)
  values (v_appt_draft, v_patient, 'REAUDIT-CHECK draft');
  insert into public.prescriptions (appointment_id, patient_id, medications)
  values (v_appt_draft, v_patient, '[{"nombre": "REAUDIT-CHECK DRAFT", "dosis": "1"}]'::jsonb);

  -- In the future, clean, booked by the clinic: the 4th cancellation.
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, (v_day + time '16:00') at time zone v_tz, 'confirmed')
  returning id into v_appt_booked;

  if exists (select 1 from public.appointments
             where patient_id = v_patient and (requested_online or patient_cancelled_at is not null)) then
    raise exception 'REAUDIT FIXES CHECK FAILED: an owner insert got an online marker.';
  end if;

  perform set_config('reaudit_check.user_d', v_user_d::text, true);
  perform set_config('reaudit_check.user_p', v_user_p::text, true);
  perform set_config('reaudit_check.patient', v_patient::text, true);
  perform set_config('reaudit_check.service', v_svc::text, true);
  perform set_config('reaudit_check.appt_past', v_appt_past::text, true);
  perform set_config('reaudit_check.appt_draft', v_appt_draft::text, true);
  perform set_config('reaudit_check.appt_booked', v_appt_booked::text, true);
  perform set_config('reaudit_check.day', v_day::text, true);
  perform set_config('reaudit_check.phone_p', public.normalize_phone(v_phone_p), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Patient P (confirmed phone), mode OFF: export, then the daily limits
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('reaudit_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('reaudit_check.phone_p'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_tz          text := 'America/Monterrey';
  v_patient     uuid := current_setting('reaudit_check.patient')::uuid;
  v_svc         uuid := current_setting('reaudit_check.service')::uuid;
  v_appt_past   uuid := current_setting('reaudit_check.appt_past')::uuid;
  v_appt_booked uuid := current_setting('reaudit_check.appt_booked')::uuid;
  v_day         date := current_setting('reaudit_check.day')::date;
  v_export      jsonb;
  v_ids         uuid[] := '{}';
  v_id          uuid;
  v_message     text;
begin
  if public.current_patient_id() is distinct from v_patient then
    raise exception 'REAUDIT FIXES CHECK FAILED: the confirmed patient has no identity (%).', public.current_patient_id();
  end if;

  -- [N1] The export carries the finalized prescription, never the draft.
  v_export := public.export_my_data() -> 'prescriptions';
  if jsonb_array_length(v_export) <> 1
     or (v_export -> 0 ->> 'appointment_id')::uuid is distinct from v_appt_past
     or v_export -> 0 ->> 'finalized_at' is null
     or v_export::text not like '%REAUDIT-CHECK FINAL%' then
    raise exception 'REAUDIT FIXES CHECK FAILED: export_my_data() does not carry exactly the finalized prescription (got: %).', v_export;
  end if;
  if v_export::text like '%REAUDIT-CHECK DRAFT%' then
    raise exception 'REAUDIT FIXES CHECK FAILED: export_my_data() carries the draft prescription.';
  end if;

  -- [N2] Three online requests, each marked as online.
  v_ids := v_ids || public.request_my_appointment(v_svc, (v_day + time '09:00') at time zone v_tz, null);
  v_ids := v_ids || public.request_my_appointment(v_svc, (v_day + time '10:00') at time zone v_tz, null);
  v_ids := v_ids || public.request_my_appointment(v_svc, (v_day + time '11:00') at time zone v_tz, null);

  if (select count(*) from public.appointments
      where id = any (v_ids) and requested_online and status = 'pending') <> 3 then
    raise exception 'REAUDIT FIXES CHECK FAILED: the three online requests are not pending and marked as online.';
  end if;

  -- [N2] Three online cancellations (they also free the pending slots, so
  -- the 4th request below can only hit the daily limit).
  foreach v_id in array v_ids loop
    perform public.cancel_my_appointment(v_id, null);
  end loop;

  if (select count(*) from public.appointments
      where id = any (v_ids) and status = 'cancelled' and patient_cancelled_at is not null) <> 3 then
    raise exception 'REAUDIT FIXES CHECK FAILED: the three online cancellations are not stamped.';
  end if;

  -- [N2] The 4th request in 24 hours: refused.
  v_message := null;
  begin
    perform public.request_my_appointment(v_svc, (v_day + time '12:00') at time zone v_tz, null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Alcanzaste el límite de solicitudes en línea por hoy. Comunícate con la clínica.' then
    raise exception 'REAUDIT FIXES CHECK FAILED: the 4th online request was not refused by the daily limit (got: %).', v_message;
  end if;

  -- [N2] The 4th cancellation in 24 hours: refused, the appointment stays.
  v_message := null;
  begin
    perform public.cancel_my_appointment(v_appt_booked, null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Alcanzaste el límite de cancelaciones en línea por hoy. Comunícate con la clínica.' then
    raise exception 'REAUDIT FIXES CHECK FAILED: the 4th online cancellation was not refused by the daily limit (got: %).', v_message;
  end if;

  if not exists (select 1 from public.appointments
                 where id = v_appt_booked and status = 'confirmed' and patient_cancelled_at is null) then
    raise exception 'REAUDIT FIXES CHECK FAILED: the refused cancellation changed the appointment.';
  end if;

  if (select count(*) from public.appointments where patient_id = v_patient and requested_online) <> 3 then
    raise exception 'REAUDIT FIXES CHECK FAILED: the refused request inserted a row.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Doctor: staff paths are not limited and cannot touch the markers
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('reaudit_check.user_d'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_tz        text := 'America/Monterrey';
  v_patient   uuid := current_setting('reaudit_check.patient')::uuid;
  v_svc       uuid := current_setting('reaudit_check.service')::uuid;
  v_day       date := current_setting('reaudit_check.day')::date;
  v_staff     uuid;
  v_forged    uuid;
  v_online    uuid;
  v_state     text;
begin
  -- The patient is at both limits; the doctor still books and cancels.
  v_staff := public.staff_create_appointment(v_patient, v_svc, (v_day + time '17:00') at time zone v_tz);

  update public.appointments
     set status = 'cancelled', cancel_reason = 'REAUDIT-CHECK staff cancel'
   where id = v_staff;

  if not exists (select 1 from public.appointments
                 where id = v_staff and status = 'cancelled'
                   and not requested_online and patient_cancelled_at is null) then
    raise exception 'REAUDIT FIXES CHECK FAILED: the staff booking or cancellation failed or got an online marker.';
  end if;

  -- A direct insert cannot claim to be an online request.
  insert into public.appointments (patient_id, service_id, start_time, status, requested_online, patient_cancelled_at)
  values (v_patient, v_svc, (v_day + time '17:30') at time zone v_tz, 'confirmed', true, now())
  returning id into v_forged;

  if not exists (select 1 from public.appointments
                 where id = v_forged and not requested_online and patient_cancelled_at is null) then
    raise exception 'REAUDIT FIXES CHECK FAILED: a direct insert set an online marker.';
  end if;

  -- The markers of the patient's own rows cannot be reset directly.
  select id into v_online
  from public.appointments
  where patient_id = v_patient and requested_online and patient_cancelled_at is not null
  limit 1;

  v_state := null;
  begin
    update public.appointments set requested_online = false where id = v_online;
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'REAUDIT FIXES CHECK FAILED: requested_online was changed directly (%).', v_state;
  end if;

  v_state := null;
  begin
    update public.appointments set patient_cancelled_at = null where id = v_online;
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'REAUDIT FIXES CHECK FAILED: patient_cancelled_at was changed directly (%).', v_state;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Owner: age the patient's markers past 24 hours
-- -----------------------------------------------------------------------------
do $$
declare
  v_patient uuid := current_setting('reaudit_check.patient')::uuid;
  v_id      uuid;
begin
  perform set_config('request.jwt.claims', '', true);

  update public.appointments
     set created_at = now() - interval '25 hours'
   where patient_id = v_patient and requested_online;

  for v_id in
    select id from public.appointments
    where patient_id = v_patient and patient_cancelled_at is not null
  loop
    perform set_config('app.patient_cancel', v_id::text, true);
    update public.appointments
       set patient_cancelled_at = now() - interval '25 hours'
     where id = v_id;
  end loop;
  perform set_config('app.patient_cancel', '', true);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Patient P again: the window is rolling
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('reaudit_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('reaudit_check.phone_p'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_tz          text := 'America/Monterrey';
  v_svc         uuid := current_setting('reaudit_check.service')::uuid;
  v_appt_booked uuid := current_setting('reaudit_check.appt_booked')::uuid;
  v_day         date := current_setting('reaudit_check.day')::date;
  v_new         uuid;
begin
  v_new := public.request_my_appointment(v_svc, (v_day + time '12:00') at time zone v_tz, null);
  if v_new is null then
    raise exception 'REAUDIT FIXES CHECK FAILED: a request was refused after the window rolled over.';
  end if;

  perform public.cancel_my_appointment(v_appt_booked, null);
  if not exists (select 1 from public.appointments
                 where id = v_appt_booked and status = 'cancelled' and patient_cancelled_at is not null) then
    raise exception 'REAUDIT FIXES CHECK FAILED: a cancellation was refused after the window rolled over.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 6. Catalog: grants and default privileges for new functions
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn  text;
  v_bad text;
begin
  perform set_config('request.jwt.claims', '', true);

  foreach v_fn in array array[
    'public.export_my_data()',
    'public.request_my_appointment(uuid,timestamptz,text)',
    'public.cancel_my_appointment(uuid,text)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'REAUDIT FIXES CHECK FAILED: % must be executable by authenticated only.', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.patient_online_request_limit()',
    'public.patient_online_cancel_limit()',
    'public.appointments_guard_online_markers()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'REAUDIT FIXES CHECK FAILED: % is executable by an API role.', v_fn;
    end if;
  end loop;

  -- [O3] pg_default_acl: nothing gives EXECUTE on new functions to PUBLIC,
  -- anon or authenticated (globally or in public), and the global entry
  -- that removes the built-in PUBLIC grant exists.
  if not exists (
    select 1 from pg_default_acl d
    where d.defaclrole = 'postgres'::regrole::oid
      and d.defaclnamespace = 0::oid
      and d.defaclobjtype = 'f'
  ) then
    raise exception 'REAUDIT FIXES CHECK FAILED: postgres has no global default privileges for functions (PUBLIC keeps EXECUTE).';
  end if;

  select string_agg(case when x.grantee = 0::oid then 'PUBLIC' else x.grantee::regrole::text end, ', ')
    into v_bad
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) x
  where d.defaclrole = 'postgres'::regrole::oid
    and d.defaclobjtype = 'f'
    and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
    and x.privilege_type = 'EXECUTE'
    and x.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid);
  if v_bad is not null then
    raise exception 'REAUDIT FIXES CHECK FAILED: default privileges give EXECUTE on new functions to %.', v_bad;
  end if;

  -- [O3] A real function created now by postgres (rolled back with
  -- everything else).
  create function public.reaudit_check_default_acl_probe()
  returns integer language sql immutable set search_path = pg_temp as $probe$ select 1 $probe$;
  if has_function_privilege('anon', 'public.reaudit_check_default_acl_probe()', 'execute')
     or has_function_privilege('authenticated', 'public.reaudit_check_default_acl_probe()', 'execute') then
    raise exception 'REAUDIT FIXES CHECK FAILED: a new function in public is executable by anon or authenticated.';
  end if;

  raise notice 'REAUDIT FIXES CHECK PASSED: export_my_data() carries the finalized prescription and never the draft; the 4th online request and the 4th online cancellation within 24 hours are refused with the daily-limit message, the window is rolling, the doctor books and cancels without limit and cannot forge or reset the online markers; a new function in public is not executable by anon or authenticated and pg_default_acl grants new functions to neither PUBLIC, anon nor authenticated. All test data was rolled back.';
end $$;

rollback;
