-- =============================================================================
-- Security hardening check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 27 objects, that:
--   * [F1]  a patient reads NO patients row directly (so never the doctor's
--           private notes) and get_my_profile() returns their own id, names,
--           phone and email only;
--   * [F2]  with doctor-only mode ON, the same patient reads nothing: no
--           profile, appointment or prescription, and export_my_data() refuses;
--   * [NV1] a session whose phone was never confirmed by Auth (no
--           phone_confirmed_at) gets no patient identity, reads nothing and
--           cannot register;
--   * [F6]  a patient sees a finalized prescription but never a draft;
--   * [NV2] the admin reads no payment row (so no payments.note) and no
--           movement tied to a consultation; get_item_movements() gives it
--           the full history without appointment_id; the doctor still reads
--           both directly;
--   * [F3]  a patient cannot cancel or reschedule an appointment that already
--           started, or that has a consultation record;
--   * [F4]  a patient booking is refused past the 120-day horizon, off the
--           15-minute grid, on a closed day and outside the opening hours,
--           and accepted inside them;
--   * [F5]  three online reschedules work, the fourth is refused, and the
--           counter cannot be changed directly (not even by the doctor);
--   * [NV3] clinical_records and prescriber_private are private buckets.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users,
--     patients, service, inventory item, appointments, notes, prescriptions,
--     payment, movements, the clinic_settings changes (mode and a known test
--     schedule) and audit rows are never committed, pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The appointments_prevent_overlap trigger (migration 19) is disabled the
--     same way for the owner's fixture inserts. The patient RPCs still check
--     the slot with assert_slot_free(), so the script picks a test weekday,
--     100 to 118 days ahead, with no real appointment or block, and aborts if
--     there is none.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * ALTER TABLE ... DISABLE TRIGGER and the clinic_settings update hold
--     locks until the ROLLBACK. The script takes well under a second; run it
--     off-hours.
--
-- Expected output: a single notice that starts with "SECURITY HARDENING CHECK PASSED".
-- Any "SECURITY HARDENING CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Migration 27 applied; no outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.get_my_profile()') is null
     or to_regprocedure('public.assert_patient_booking_window(timestamptz,integer)') is null
     or to_regprocedure('public.get_finance_payments(timestamptz,timestamptz)') is null then
    raise exception 'SECURITY HARDENING CHECK ABORTED: migrations 26 and 27 are not both applied. Nothing was changed.';
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
        'public.services'::regclass, 'public.payments'::regclass,
        'public.inventory'::regclass, 'public.inventory_movements'::regclass,
        'public.clinical_notes'::regclass, 'public.prescriptions'::regclass,
        'public.clinic_settings'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'SECURITY HARDENING CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_tz         text := 'America/Monterrey';
  v_phone_p    text := '+529990002701';
  v_phone_u    text := '+529990002702';
  v_user_d     uuid := gen_random_uuid();
  v_user_a     uuid := gen_random_uuid();
  v_user_p     uuid := gen_random_uuid();
  v_user_u     uuid := gen_random_uuid();
  v_today      date := (now() at time zone 'America/Monterrey')::date;
  v_day        date;
  v_sunday     date;
  v_patient    uuid;
  v_patient_u  uuid;
  v_svc        uuid;
  v_item       uuid;
  v_appt_past  uuid;
  v_appt_noted uuid;
  v_appt_move  uuid;
begin
  if exists (
    select 1 from public.patients
    where public.normalize_phone(phone) in (public.normalize_phone(v_phone_p), public.normalize_phone(v_phone_u))
  ) or exists (
    select 1 from auth.users
    where public.normalize_phone(phone) in (public.normalize_phone(v_phone_p), public.normalize_phone(v_phone_u))
  ) then
    raise exception 'SECURITY HARDENING CHECK ABORTED: a throwaway test phone already exists. Nothing was changed.';
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
    raise exception 'SECURITY HARDENING CHECK ABORTED: no free weekday 100-118 days ahead. Nothing was changed.';
  end if;
  v_sunday := v_today + 7 - extract(dow from v_today)::integer;

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
    raise exception 'SECURITY HARDENING CHECK ABORTED: clinic_settings has no row; save the schedule in the app first. Nothing was changed.';
  end if;

  -- Users: doctor, admin, patient P (confirmed phone), patient U (never confirmed).
  insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, email,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, null, 'security-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, null, 'security-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone_p), now(), null, '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone_u), null, null, '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, notes, status)
  values ('SECURITY-CHECK', 'Patient', v_phone_p, 'SECURITY-CHECK INTERNAL NOTE', 'active')
  returning id into v_patient;

  insert into public.patients (first_name, last_name, phone, notes, status)
  values ('SECURITY-CHECK', 'Unconfirmed', v_phone_u, 'SECURITY-CHECK INTERNAL NOTE U', 'active')
  returning id into v_patient_u;

  insert into public.services (name, duration_mins, price, is_active)
  values ('SECURITY-CHECK service', 30, 700, true)
  returning id into v_svc;

  -- Started an hour ago, with a FINALIZED note and prescription.
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '1 hour', 'confirmed')
  returning id into v_appt_past;
  insert into public.clinical_notes (appointment_id, patient_id, subjective, analysis, plan)
  values (v_appt_past, v_patient, 'S', 'SECURITY-CHECK diagnosis', 'SECURITY-CHECK plan');
  -- The prescription must exist before the note is finalized: once the
  -- consultation is finalized, prescriptions_enforce_integrity refuses inserts.
  insert into public.prescriptions (appointment_id, patient_id, medications)
  values (v_appt_past, v_patient, '[{"nombre": "SECURITY-CHECK FINAL", "dosis": "1"}]'::jsonb);
  update public.clinical_notes set finalized_at = now() where appointment_id = v_appt_past;
  update public.prescriptions set finalized_at = now() where appointment_id = v_appt_past;

  -- In the future, with a DRAFT note and prescription.
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, (v_day + time '15:00') at time zone v_tz, 'confirmed')
  returning id into v_appt_noted;
  insert into public.clinical_notes (appointment_id, patient_id, subjective)
  values (v_appt_noted, v_patient, 'SECURITY-CHECK draft');
  insert into public.prescriptions (appointment_id, patient_id, medications)
  values (v_appt_noted, v_patient, '[{"nombre": "SECURITY-CHECK DRAFT", "dosis": "1"}]'::jsonb);

  -- In the future, clean: the one the patient reschedules.
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, (v_day + time '09:00') at time zone v_tz, 'confirmed')
  returning id into v_appt_move;

  -- An item (its initial stock is a movement with no appointment) and a
  -- supply used on the past consultation, recorded the way finalize does.
  insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, is_active)
  values ('SECURITY-CHECK item', 'Otro', 5, 0, 'piezas', true)
  returning id into v_item;
  perform public.apply_stock_movement(v_item, -1, 'use', 10, 10, 'Usado en consulta', v_appt_past);

  perform set_config('security_check.user_d', v_user_d::text, true);
  perform set_config('security_check.user_a', v_user_a::text, true);
  perform set_config('security_check.user_p', v_user_p::text, true);
  perform set_config('security_check.user_u', v_user_u::text, true);
  perform set_config('security_check.patient', v_patient::text, true);
  perform set_config('security_check.patient_u', v_patient_u::text, true);
  perform set_config('security_check.service', v_svc::text, true);
  perform set_config('security_check.item', v_item::text, true);
  perform set_config('security_check.appt_past', v_appt_past::text, true);
  perform set_config('security_check.appt_noted', v_appt_noted::text, true);
  perform set_config('security_check.appt_move', v_appt_move::text, true);
  perform set_config('security_check.day', v_day::text, true);
  perform set_config('security_check.sunday', v_sunday::text, true);
  perform set_config('security_check.phone_p', public.normalize_phone(v_phone_p), true);
  perform set_config('security_check.phone_u', public.normalize_phone(v_phone_u), true);
  perform set_config('security_check.notice_version', public.privacy_notice_version(), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor: charges with a note; reads payments and every movement
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('security_check.user_d'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_appt_past uuid := current_setting('security_check.appt_past')::uuid;
  v_appt_move uuid := current_setting('security_check.appt_move')::uuid;
  v_item      uuid := current_setting('security_check.item')::uuid;
  v_state     text;
begin
  perform public.record_payment(v_appt_past, 'paid', 700, 'cash', 'SECURITY-CHECK payment note');

  if not exists (select 1 from public.payments where appointment_id = v_appt_past
                 and note = 'SECURITY-CHECK payment note') then
    raise exception 'SECURITY HARDENING CHECK FAILED: the doctor cannot read the payment and its note.';
  end if;

  if (select count(*) from public.inventory_movements where item_id = v_item and appointment_id = v_appt_past) <> 1 then
    raise exception 'SECURITY HARDENING CHECK FAILED: the doctor cannot read the consultation use of a supply.';
  end if;

  -- [F5] The counter is not writable directly, not even by the doctor.
  v_state := null;
  begin
    update public.appointments set patient_reschedule_count = 0 where id = v_appt_move;
    v_state := 'no error';
    update public.appointments set patient_reschedule_count = 5 where id = v_appt_move;
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'SECURITY HARDENING CHECK FAILED: the reschedule counter was changed directly (%).', v_state;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin: no payment rows, no consultation movements
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('security_check.user_a'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_item  uuid := current_setting('security_check.item')::uuid;
  v_count integer;
begin
  if public.is_staff() or not public.is_business_staff() then
    raise exception 'SECURITY HARDENING CHECK FAILED: the throwaway admin is not business-only staff.';
  end if;

  select count(*) into v_count from public.payments where note is not null;
  if v_count <> 0 then
    raise exception 'SECURITY HARDENING CHECK FAILED: the admin reads payments.note (% row(s)).', v_count;
  end if;

  select count(*) into v_count from public.inventory_movements where appointment_id is not null;
  if v_count <> 0 then
    raise exception 'SECURITY HARDENING CHECK FAILED: the admin reads % movement(s) tied to a consultation.', v_count;
  end if;

  -- Still the movements without an appointment (the initial stock).
  if (select count(*) from public.inventory_movements where item_id = v_item) <> 1 then
    raise exception 'SECURITY HARDENING CHECK FAILED: the admin lost the movements without an appointment.';
  end if;

  -- The full history, without the appointment.
  select count(*) into v_count from public.get_item_movements(v_item);
  if v_count <> 2 then
    raise exception 'SECURITY HARDENING CHECK FAILED: get_item_movements() returned % rows, expected 2.', v_count;
  end if;
  if exists (select 1 from public.get_item_movements(v_item) m where to_jsonb(m) ? 'appointment_id') then
    raise exception 'SECURITY HARDENING CHECK FAILED: get_item_movements() returns appointment_id.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Patient P (confirmed phone), mode OFF
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('security_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('security_check.phone_p'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_tz         text := 'America/Monterrey';
  v_patient    uuid := current_setting('security_check.patient')::uuid;
  v_svc        uuid := current_setting('security_check.service')::uuid;
  v_appt_past  uuid := current_setting('security_check.appt_past')::uuid;
  v_appt_noted uuid := current_setting('security_check.appt_noted')::uuid;
  v_appt_move  uuid := current_setting('security_check.appt_move')::uuid;
  v_day        date := current_setting('security_check.day')::date;
  v_sunday     date := current_setting('security_check.sunday')::date;
  v_today      date := (now() at time zone 'America/Monterrey')::date;
  v_count      integer;
  v_message    text;
  v_case       record;
  v_new        uuid;
begin
  if public.current_patient_id() is distinct from v_patient then
    raise exception 'SECURITY HARDENING CHECK FAILED: the confirmed patient has no identity (%).', public.current_patient_id();
  end if;

  -- [F1] No direct row, so never the notes; the profile through the RPC.
  select count(*) into v_count from public.patients;
  if v_count <> 0 then
    raise exception 'SECURITY HARDENING CHECK FAILED: the patient reads % patients row(s) directly.', v_count;
  end if;
  if exists (select 1 from public.patients where notes is not null) then
    raise exception 'SECURITY HARDENING CHECK FAILED: the patient reads the doctor''s notes.';
  end if;
  if (select count(*) from public.get_my_profile() p where p.id = v_patient and p.last_name = 'Patient') <> 1
     or exists (select 1 from public.get_my_profile() p where to_jsonb(p) ? 'notes')
     or exists (select 1 from public.get_my_profile() p where to_jsonb(p)::text like '%INTERNAL NOTE%') then
    raise exception 'SECURITY HARDENING CHECK FAILED: get_my_profile() is wrong or carries notes.';
  end if;

  -- [F6] The finalized prescription, never the draft.
  if (select count(*) from public.prescriptions) <> 1
     or not exists (select 1 from public.prescriptions where appointment_id = v_appt_past)
     or exists (select 1 from public.prescriptions where appointment_id = v_appt_noted) then
    raise exception 'SECURITY HARDENING CHECK FAILED: the patient does not see exactly the finalized prescription.';
  end if;

  -- [F3] Started, or with a consultation record: no cancel, no reschedule.
  for v_case in
    select * from (values
      ('cancel started',        format('select public.cancel_my_appointment(%L::uuid, null)', v_appt_past), '%ya comenzó%'),
      ('reschedule started',    format('select public.reschedule_my_appointment(%L::uuid, %L::timestamptz)', v_appt_past,
                                       (v_day + time '13:00') at time zone v_tz), '%ya comenzó%'),
      ('cancel recorded',       format('select public.cancel_my_appointment(%L::uuid, null)', v_appt_noted), '%registro de consulta%'),
      ('reschedule recorded',   format('select public.reschedule_my_appointment(%L::uuid, %L::timestamptz)', v_appt_noted,
                                       (v_day + time '13:00') at time zone v_tz), '%registro de consulta%'),
      -- [F4] The booking window.
      ('past the horizon',      format('select public.request_my_appointment(%L::uuid, %L::timestamptz, null)', v_svc,
                                       ((v_today + 125) + time '10:00') at time zone v_tz), '%anticipación%'),
      ('off the grid',          format('select public.request_my_appointment(%L::uuid, %L::timestamptz, null)', v_svc,
                                       (v_day + time '10:10') at time zone v_tz), '%horarios disponibles%'),
      ('closed day',            format('select public.request_my_appointment(%L::uuid, %L::timestamptz, null)', v_svc,
                                       (v_sunday + time '10:00') at time zone v_tz), '%no abre%'),
      ('before opening',        format('select public.request_my_appointment(%L::uuid, %L::timestamptz, null)', v_svc,
                                       (v_day + time '07:00') at time zone v_tz), '%fuera del horario%'),
      ('past closing',          format('select public.request_my_appointment(%L::uuid, %L::timestamptz, null)', v_svc,
                                       (v_day + time '17:45') at time zone v_tz), '%fuera del horario%')
    ) as t(label, stmt, expected)
  loop
    v_message := null;
    begin
      execute v_case.stmt;
    exception when others then v_message := sqlerrm;
    end;
    if v_message is null or v_message not like v_case.expected then
      raise exception 'SECURITY HARDENING CHECK FAILED: % was not refused as expected (got: %).', v_case.label, v_message;
    end if;
  end loop;

  if exists (select 1 from public.appointments where id in (v_appt_past, v_appt_noted) and status <> 'confirmed') then
    raise exception 'SECURITY HARDENING CHECK FAILED: a refused cancel or reschedule changed an appointment.';
  end if;

  -- [F4] Inside the window: accepted.
  v_new := public.request_my_appointment(v_svc, (v_day + time '10:00') at time zone v_tz, null);
  if v_new is null then
    raise exception 'SECURITY HARDENING CHECK FAILED: a valid booking inside the opening hours was refused.';
  end if;

  -- [F5] Three reschedules, then refused.
  perform public.reschedule_my_appointment(v_appt_move, (v_day + time '11:00') at time zone v_tz);
  perform public.reschedule_my_appointment(v_appt_move, (v_day + time '11:30') at time zone v_tz);
  perform public.reschedule_my_appointment(v_appt_move, (v_day + time '12:00') at time zone v_tz);

  v_message := null;
  begin
    perform public.reschedule_my_appointment(v_appt_move, (v_day + time '12:30') at time zone v_tz);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is null or v_message not like '%reprogramaste esta cita 3 veces%' then
    raise exception 'SECURITY HARDENING CHECK FAILED: the fourth reschedule was not refused (got: %).', v_message;
  end if;

  if not exists (
    select 1 from public.appointments
    where id = v_appt_move and status = 'pending' and patient_reschedule_count = 3
      and start_time = (v_day + time '12:00') at time zone v_tz
  ) then
    raise exception 'SECURITY HARDENING CHECK FAILED: the rescheduled appointment is not at its third time with a count of 3.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 5. Patient P with doctor-only mode ON: reads nothing
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  update public.clinic_settings set doctor_only_mode = true, updated_at = now() where id is not null;
  if not public.get_clinic_mode() then
    raise exception 'SECURITY HARDENING CHECK FAILED: the mode could not be turned on for the test.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('security_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('security_check.phone_p'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_state text;
begin
  if public.current_patient_id() is not null then
    raise exception 'SECURITY HARDENING CHECK FAILED: current_patient_id() answers in doctor-only mode.';
  end if;

  if (select count(*) from public.get_my_profile()) <> 0
     or (select count(*) from public.appointments) <> 0
     or (select count(*) from public.prescriptions) <> 0
     or (select count(*) from public.consents) <> 0 then
    raise exception 'SECURITY HARDENING CHECK FAILED: the patient reads data in doctor-only mode.';
  end if;

  v_state := null;
  begin
    perform public.export_my_data();
  exception when others then v_state := sqlstate;
  end;
  if v_state is null then
    raise exception 'SECURITY HARDENING CHECK FAILED: export_my_data() answered in doctor-only mode.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 6. Patient U (phone never confirmed), mode OFF: no identity at all
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  update public.clinic_settings set doctor_only_mode = false, updated_at = now() where id is not null;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('security_check.user_u'),
    'role', 'authenticated',
    'phone', current_setting('security_check.phone_u'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_message text;
begin
  if public.current_patient_id() is not null then
    raise exception 'SECURITY HARDENING CHECK FAILED: an unconfirmed phone got a patient identity.';
  end if;

  if (select count(*) from public.get_my_profile()) <> 0
     or (select count(*) from public.patients) <> 0
     or (select count(*) from public.appointments) <> 0 then
    raise exception 'SECURITY HARDENING CHECK FAILED: an unconfirmed phone reads patient data.';
  end if;

  v_message := null;
  begin
    perform public.register_me('Intruso', 'Prueba', null, null, null,
      current_setting('security_check.notice_version'), 'security-check');
  exception when others then v_message := sqlerrm;
  end;
  if v_message is null or v_message not like 'No pudimos verificar tu número%' then
    raise exception 'SECURITY HARDENING CHECK FAILED: register_me() accepted an unconfirmed phone (got: %).', v_message;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 7. Catalog: private buckets
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);

  if exists (
    select 1 from (values ('clinical_records'), ('prescriber_private')) as b(id)
    where not exists (select 1 from storage.buckets sb where sb.id = b.id and sb.public = false)
  ) then
    raise exception 'SECURITY HARDENING CHECK FAILED: clinical_records or prescriber_private is missing or public.';
  end if;

  raise notice 'SECURITY HARDENING CHECK PASSED: patients read no patients row (get_my_profile has no notes) and only finalized prescriptions; doctor-only mode and an unconfirmed phone leave a patient session with nothing; the admin reads no payment row and no consultation movement while get_item_movements() gives the history without appointment_id; started or recorded appointments cannot be cancelled or moved online; patient bookings respect the horizon, the grid, the open days and the hours; the fourth online reschedule is refused and the counter cannot be changed directly; both buckets are private. All test data was rolled back.';
end $$;

rollback;
