-- =============================================================================
-- Doctor-only mode check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 23 objects, that:
--   * anon can READ the mode (get_clinic_mode) but cannot change it, neither
--     through set_clinic_mode() nor by writing clinic_settings;
--   * with the mode ON, request_my_appointment(), reschedule_my_appointment(),
--     cancel_my_appointment(), register_me(), accept_privacy_notice(),
--     submit_arco_request() and register_my_upload() all refuse with a
--     Spanish message, the patient cannot write into their storage folder,
--     and nothing is written;
--   * with the mode ON, staff_reschedule_appointment() keeps the appointment
--     'confirmed' (a pending one becomes confirmed); with the mode OFF it goes
--     back to 'pending', as before;
--   * the admin and the patient cannot change the mode or record consents;
--   * record_consent_in_person() records ONE 'in_person' consent for the
--     current notice version (a second call records nothing), refuses an
--     anonymized record, and consents still cannot be inserted directly;
--   * the doctor (and only the doctor) records an ARCO request received
--     offline with staff_register_arco_request(), in both modes, with its
--     channel and a server-set created_at; bad input and anonymized records
--     are refused;
--   * with the mode OFF every patient RPC above works again (the upload is
--     registered for a file placed in the patient's folder by the owner).
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The mode change, the
--     throwaway users, patients, service, appointments, consents, ARCO
--     requests, the test storage object, file records and audit rows are never
--     committed, pass or fail. The clinic's
--     real mode is untouched after the ROLLBACK.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call, or if a real appointment or
--     blocked slot sits near the far-future test window.
--   * ALTER TABLE ... DISABLE TRIGGER and the clinic_settings update hold
--     locks until the ROLLBACK. The script takes well under a second; run it
--     off-hours.
--
-- Expected output: a single notice that starts with "DOCTOR ONLY MODE CHECK PASSED".
-- Any "DOCTOR ONLY MODE CHECK FAILED: ..." error names the exact rule that broke.
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

  if to_regprocedure('public.record_consent_in_person(uuid)') is null
     or to_regprocedure('public.set_clinic_mode(boolean)') is null
     or to_regprocedure('public.staff_register_arco_request(uuid,text,text,text)') is null then
    raise exception 'DOCTOR ONLY MODE CHECK ABORTED: migration 23 is not applied.';
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
        'public.consents'::regclass, 'public.arco_requests'::regclass,
        'public.clinic_settings'::regclass, 'public.patient_files'::regclass,
        'storage.objects'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'DOCTOR ONLY MODE CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- A doctor (D) and an admin (M); a patient with a verified phone (P) and two
-- appointments, A pending and B confirmed, ~8.5 years ahead; a staff-created
-- patient without consent (C); an anonymized record (N); a free phone for a
-- new online registration. Then the mode is turned ON.
do $$
declare
  v_phone_p   text := '+529990000601';
  v_phone_new text := '+529990000602';
  v_user_d    uuid := gen_random_uuid();
  v_user_m    uuid := gen_random_uuid();
  v_patient_p uuid;
  v_patient_c uuid;
  v_patient_n uuid;
  v_svc       uuid;
  v_appt_a    uuid;
  v_appt_b    uuid;
  v_start     timestamptz := date_trunc('hour', now()) + interval '3101 days';
begin
  if exists (
    select 1 from public.patients
    where public.normalize_phone(phone) in (public.normalize_phone(v_phone_p), public.normalize_phone(v_phone_new))
  ) then
    raise exception 'DOCTOR ONLY MODE CHECK ABORTED: a throwaway test phone already exists. Nothing was changed.';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.start_time between v_start - interval '1 day' and v_start + interval '1 day'
  ) or exists (
    select 1 from public.blocked_slots b
    where b.start_time < v_start + interval '1 day' and b.end_time > v_start - interval '1 day'
  ) then
    raise exception 'DOCTOR ONLY MODE CHECK ABORTED: real data sits near the test window %. Nothing was changed.', v_start;
  end if;

  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'doctor-only-check-d-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'doctor-only-check-m-' || v_user_m || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_m;

  insert into public.services (name, duration_mins, price, is_active)
  values ('DOCTOR-ONLY-CHECK service', 30, 500, true)
  returning id into v_svc;

  insert into public.patients (first_name, last_name, phone, status)
  values ('DOCTOR-ONLY-CHECK', 'Patient', v_phone_p, 'active')
  returning id into v_patient_p;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient_p, v_svc, v_start, 'pending')
  returning id into v_appt_a;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient_p, v_svc, v_start + interval '2 hours', 'confirmed')
  returning id into v_appt_b;

  insert into public.patients (first_name, last_name, phone, status)
  values ('DOCTOR-ONLY-CHECK', 'Paper', null, 'active')
  returning id into v_patient_c;

  insert into public.patients (first_name, last_name, phone, status, anonymized_at)
  values ('Paciente', 'Anonimizado', null, 'archived', now())
  returning id into v_patient_n;

  -- Mode ON for this transaction only.
  insert into public.clinic_settings (doctor_only_mode)
  select true where not exists (select 1 from public.clinic_settings);
  update public.clinic_settings set doctor_only_mode = true where id is not null;

  if not public.get_clinic_mode() then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the mode could not be turned on for the test.';
  end if;

  perform set_config('doctor_only_check.user_d', v_user_d::text, true);
  perform set_config('doctor_only_check.user_m', v_user_m::text, true);
  perform set_config('doctor_only_check.patient_p', v_patient_p::text, true);
  perform set_config('doctor_only_check.patient_c', v_patient_c::text, true);
  perform set_config('doctor_only_check.patient_n', v_patient_n::text, true);
  perform set_config('doctor_only_check.service', v_svc::text, true);
  perform set_config('doctor_only_check.appt_a', v_appt_a::text, true);
  perform set_config('doctor_only_check.appt_b', v_appt_b::text, true);
  perform set_config('doctor_only_check.start', v_start::text, true);
  perform set_config('doctor_only_check.claim_phone_p', public.normalize_phone(v_phone_p), true);
  perform set_config('doctor_only_check.claim_phone_new', public.normalize_phone(v_phone_new), true);
  -- Read as the owner: API roles cannot execute privacy_notice_version().
  perform set_config('doctor_only_check.notice_version', public.privacy_notice_version(), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. anon reads the mode, and changes nothing
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
end $$;
set local role anon;

do $$
declare
  v_refused boolean;
begin
  if public.get_clinic_mode() is distinct from true then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: anon does not read the mode as ON.';
  end if;

  v_refused := false;
  begin
    perform public.set_clinic_mode(false);
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: anon could call set_clinic_mode().';
  end if;

  begin
    update public.clinic_settings set doctor_only_mode = false where id is not null;
  exception when insufficient_privilege then
    null;
  end;

  v_refused := false;
  begin
    perform public.record_consent_in_person(current_setting('doctor_only_check.patient_c')::uuid);
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: anon could call record_consent_in_person().';
  end if;
end $$;

reset role;

do $$
begin
  if not public.get_clinic_mode() then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: anon turned the mode off by writing clinic_settings.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Mode ON: the patient's own RPCs refuse
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'phone', current_setting('doctor_only_check.claim_phone_p'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient_p uuid        := current_setting('doctor_only_check.patient_p')::uuid;
  v_svc       uuid        := current_setting('doctor_only_check.service')::uuid;
  v_appt_a    uuid        := current_setting('doctor_only_check.appt_a')::uuid;
  v_appt_b    uuid        := current_setting('doctor_only_check.appt_b')::uuid;
  v_start     timestamptz := current_setting('doctor_only_check.start')::timestamptz;
  v_refused   boolean;
  v_message   text;
begin
  if public.current_patient_id() is distinct from v_patient_p then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the test session does not resolve to the test patient.';
  end if;

  if public.get_clinic_mode() is distinct from true then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a signed-in patient does not read the mode as ON.';
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.request_my_appointment(v_svc, v_start + interval '8 hours', null);
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'no está recibiendo citas en línea' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: request_my_appointment() booked in doctor-only mode (or refused for another reason: %).', v_message;
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.reschedule_my_appointment(v_appt_a, v_start + interval '10 hours');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'no está recibiendo citas en línea' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: reschedule_my_appointment() worked in doctor-only mode (or refused for another reason: %).', v_message;
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.cancel_my_appointment(v_appt_b, null);
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'no está recibiendo citas en línea' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: cancel_my_appointment() worked in doctor-only mode (or refused for another reason: %).', v_message;
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.accept_privacy_notice(current_setting('doctor_only_check.notice_version'), 'doctor-only-check');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'no está recibiendo registros en línea' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: accept_privacy_notice() worked in doctor-only mode (or refused for another reason: %).', v_message;
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.submit_arco_request('access', 'Quiero una copia de mis datos.');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'no está recibiendo solicitudes en línea' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: submit_arco_request() worked in doctor-only mode (or refused for another reason: %).', v_message;
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.register_my_upload(v_patient_p::text || '/doctor-only-check.pdf', 'doctor-only-check.pdf');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'no está recibiendo archivos en línea' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: register_my_upload() worked in doctor-only mode (or refused for another reason: %).', v_message;
  end if;

  -- The storage policy: no upload into the patient's own folder either.
  v_refused := false;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('clinical_records', v_patient_p::text || '/doctor-only-check-direct.pdf',
            jsonb_build_object('mimetype', 'application/pdf', 'size', 10));
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a patient uploaded into their storage folder in doctor-only mode.';
  end if;

  v_refused := false;
  begin
    perform public.staff_register_arco_request(v_patient_p, 'access', 'Quiero una copia de mis datos.', 'telefono');
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a patient could call staff_register_arco_request().';
  end if;

  v_refused := false;
  begin
    perform public.set_clinic_mode(false);
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a patient could change the mode.';
  end if;
end $$;

reset role;

-- A brand new phone cannot register online either.
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'phone', current_setting('doctor_only_check.claim_phone_new'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_refused boolean := false;
  v_message text;
begin
  begin
    perform public.register_me('Nueva', 'Paciente', null, null, 1960, current_setting('doctor_only_check.notice_version'), 'doctor-only-check');
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'no está recibiendo registros en línea' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: register_me() registered in doctor-only mode (or refused for another reason: %).', v_message;
  end if;
end $$;

reset role;

do $$
declare
  v_patient_p uuid := current_setting('doctor_only_check.patient_p')::uuid;
begin
  if exists (select 1 from public.patients
             where public.normalize_phone(phone) = current_setting('doctor_only_check.claim_phone_new'))
     or exists (select 1 from public.consents where patient_id = v_patient_p)
     or exists (select 1 from public.arco_requests where patient_id = v_patient_p)
     or exists (select 1 from public.patient_files where patient_id = v_patient_p)
     or exists (select 1 from storage.objects
                where bucket_id = 'clinical_records'
                  and (storage.foldername(name))[1] = v_patient_p::text)
     or (select count(*) from public.appointments where patient_id = v_patient_p) <> 2
     or not exists (select 1 from public.appointments
                    where id = current_setting('doctor_only_check.appt_b')::uuid and status = 'confirmed') then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a refused patient call still wrote something.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. The admin cannot change the mode or record consents
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('doctor_only_check.user_m'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_refused boolean;
begin
  v_refused := false;
  begin
    perform public.set_clinic_mode(false);
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the admin could change the mode.';
  end if;

  v_refused := false;
  begin
    perform public.record_consent_in_person(current_setting('doctor_only_check.patient_c')::uuid);
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the admin could record a consent.';
  end if;

  v_refused := false;
  begin
    perform public.staff_register_arco_request(
      current_setting('doctor_only_check.patient_c')::uuid, 'access', 'Pidió una copia de sus datos.', 'telefono');
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the admin could register an ARCO request.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 5. Mode ON, the doctor: reschedule stays confirmed, paper consent once
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('doctor_only_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_appt_a    uuid        := current_setting('doctor_only_check.appt_a')::uuid;
  v_appt_b    uuid        := current_setting('doctor_only_check.appt_b')::uuid;
  v_patient_c uuid        := current_setting('doctor_only_check.patient_c')::uuid;
  v_patient_n uuid        := current_setting('doctor_only_check.patient_n')::uuid;
  v_start     timestamptz := current_setting('doctor_only_check.start')::timestamptz;
  v_refused   boolean;
  v_message   text;
  v_status    text;
  v_arco      uuid;
  v_case      text;
begin
  -- A was pending, B confirmed: both end up confirmed when moved by the doctor.
  perform public.staff_reschedule_appointment(v_appt_a, v_start + interval '4 hours');
  select status into v_status from public.appointments where id = v_appt_a;
  if v_status is distinct from 'confirmed' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a staff reschedule in doctor-only mode left the appointment %, expected confirmed.', v_status;
  end if;

  perform public.staff_reschedule_appointment(v_appt_b, v_start + interval '5 hours');
  select status into v_status from public.appointments where id = v_appt_b;
  if v_status is distinct from 'confirmed' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a confirmed appointment moved in doctor-only mode became %, expected confirmed.', v_status;
  end if;

  -- Paper consent: recorded once.
  if public.record_consent_in_person(v_patient_c) is distinct from true then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: record_consent_in_person() did not record the first consent.';
  end if;
  if public.record_consent_in_person(v_patient_c) is distinct from false then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: record_consent_in_person() recorded a second consent for the same notice.';
  end if;
  if (select count(*) from public.consents
      where patient_id = v_patient_c
        and method = 'in_person'
        and document = 'aviso_privacidad'
        and version = current_setting('doctor_only_check.notice_version')
        and user_agent is null) <> 1
     or (select count(*) from public.consents where patient_id = v_patient_c) <> 1 then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the paper consent is not exactly one in_person row for the current notice.';
  end if;

  v_refused := false; v_message := null;
  begin
    perform public.record_consent_in_person(v_patient_n);
  exception when others then
    v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
  end;
  if not v_refused or v_message !~ 'anonimizado' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a consent was recorded for an anonymized record (or refused for another reason: %).', v_message;
  end if;

  v_refused := false;
  begin
    insert into public.consents (patient_id, document, version, method)
    values (v_patient_c, 'aviso_privacidad', current_setting('doctor_only_check.notice_version'), 'in_person');
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the doctor inserted a consent directly, bypassing the RPC.';
  end if;

  -- ARCO request received by phone, recorded by the doctor with the mode ON.
  v_arco := public.staff_register_arco_request(v_patient_c, 'access', '  Pidió una copia de sus datos por teléfono.  ', 'telefono');
  if not exists (
    select 1 from public.arco_requests
    where id = v_arco and patient_id = v_patient_c and request_type = 'access'
      and channel = 'telefono' and status = 'received'
      and details = 'Pidió una copia de sus datos por teléfono.'
      and created_at = now() and resolved_at is null
  ) then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: staff_register_arco_request() did not record the request as received now, with its channel.';
  end if;

  foreach v_case in array array['no patient', 'anonymized', 'bad type', 'bad channel', 'no channel', 'short details'] loop
    v_refused := false; v_message := null;
    begin
      case v_case
        when 'no patient'    then perform public.staff_register_arco_request(gen_random_uuid(), 'access', 'Pidió una copia.', 'telefono');
        when 'anonymized'    then perform public.staff_register_arco_request(v_patient_n, 'access', 'Pidió una copia.', 'telefono');
        when 'bad type'      then perform public.staff_register_arco_request(v_patient_c, 'erase', 'Pidió una copia.', 'telefono');
        when 'bad channel'   then perform public.staff_register_arco_request(v_patient_c, 'access', 'Pidió una copia.', 'whatsapp');
        when 'no channel'    then perform public.staff_register_arco_request(v_patient_c, 'access', 'Pidió una copia.', null);
        else                      perform public.staff_register_arco_request(v_patient_c, 'access', ' abc ', 'correo');
      end case;
    exception when others then
      v_refused := sqlstate = 'P0001'; v_message := sqlerrm;
    end;
    if not v_refused then
      raise exception 'DOCTOR ONLY MODE CHECK FAILED: staff_register_arco_request() accepted the "%" case (%).', v_case, v_message;
    end if;
  end loop;

  if (select count(*) from public.arco_requests where patient_id in (v_patient_c, v_patient_n)) <> 1 then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a refused staff_register_arco_request() still wrote a request.';
  end if;

  -- The doctor turns the mode off.
  -- Two statements: get_clinic_mode() is STABLE, so inside the same expression
  -- it would still see the value from before set_clinic_mode() ran.
  if public.set_clinic_mode(false) is distinct from false then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: set_clinic_mode(false) did not return false.';
  end if;
  if public.get_clinic_mode() then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the doctor could not turn the mode off.';
  end if;

  -- Mode OFF: the doctor still records offline requests.
  perform public.staff_register_arco_request(v_patient_c, 'rectification', 'Entregó un escrito para corregir su domicilio.', 'escrito');
  if not exists (select 1 from public.arco_requests
                 where patient_id = v_patient_c and request_type = 'rectification' and channel = 'escrito') then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: staff_register_arco_request() did not work with the mode off.';
  end if;

  -- Mode OFF: a staff reschedule goes back to pending, as before.
  perform public.staff_reschedule_appointment(v_appt_b, v_start + interval '6 hours');
  select status into v_status from public.appointments where id = v_appt_b;
  if v_status is distinct from 'pending' then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: a staff reschedule with the mode off left the appointment %, expected pending.', v_status;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 6. Mode OFF: the patient's own RPCs work again
-- -----------------------------------------------------------------------------
-- The owner places a file in the patient's folder (the real upload goes
-- through the Storage API); the patient then registers it.
do $$
begin
  insert into storage.objects (bucket_id, name, metadata)
  values ('clinical_records', current_setting('doctor_only_check.patient_p') || '/doctor-only-check.pdf',
          jsonb_build_object('mimetype', 'application/pdf', 'size', 10));
end $$;

do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'phone', current_setting('doctor_only_check.claim_phone_p'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_svc    uuid        := current_setting('doctor_only_check.service')::uuid;
  v_appt_a uuid        := current_setting('doctor_only_check.appt_a')::uuid;
  v_start  timestamptz := current_setting('doctor_only_check.start')::timestamptz;
  v_new    uuid;
begin
  v_new := public.request_my_appointment(v_svc, v_start + interval '8 hours', null);
  perform public.cancel_my_appointment(v_new, null);
  perform public.reschedule_my_appointment(v_appt_a, v_start + interval '10 hours');
  perform public.accept_privacy_notice(current_setting('doctor_only_check.notice_version'), 'doctor-only-check');
  perform public.submit_arco_request('access', 'Quiero una copia de mis datos.');
  perform public.register_my_upload(current_setting('doctor_only_check.patient_p') || '/doctor-only-check.pdf', 'doctor-only-check.pdf');
end $$;

reset role;

do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'phone', current_setting('doctor_only_check.claim_phone_new'))::text, true);
end $$;
set local role authenticated;

do $$
begin
  perform public.register_me('Nueva', 'Paciente', null, null, 1960, current_setting('doctor_only_check.notice_version'), 'doctor-only-check');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
declare
  v_patient_p uuid := current_setting('doctor_only_check.patient_p')::uuid;
begin
  perform set_config('request.jwt.claims', '', true);

  if not exists (select 1 from public.appointments
                 where id = current_setting('doctor_only_check.appt_a')::uuid and status = 'pending')
     or (select count(*) from public.appointments where patient_id = v_patient_p and status = 'cancelled') <> 1
     or (select count(*) from public.arco_requests where patient_id = v_patient_p and channel is null) <> 1
     or not exists (select 1 from public.patient_files
                    where patient_id = v_patient_p and uploaded_by = 'patient'
                      and file_url = v_patient_p::text || '/doctor-only-check.pdf') then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: the patient RPCs did not all work with the mode off.';
  end if;

  if not exists (select 1 from public.consents where patient_id = v_patient_p and method = 'online')
     or not exists (
       select 1 from public.consents c
       join public.patients p on p.id = c.patient_id
       where public.normalize_phone(p.phone) = current_setting('doctor_only_check.claim_phone_new')
         and c.method = 'online') then
    raise exception 'DOCTOR ONLY MODE CHECK FAILED: online consents are not recorded with method online.';
  end if;

  raise notice 'DOCTOR ONLY MODE CHECK PASSED: anon reads the mode but cannot change it; with the mode on the seven patient RPCs and the patient storage upload refuse and write nothing, and a staff reschedule stays confirmed; only the doctor changes the mode, records a paper consent (once per notice version, never for an anonymized record) and registers ARCO requests received offline in both modes; with the mode off everything works as before. All test data was rolled back.';
end $$;

rollback;
