-- =============================================================================
-- NOM-004 consultation check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 20 objects, that:
--   * finalize_consultation() refuses a note with an empty diagnosis, a note
--     with an empty (blank) plan, and an appointment with no note at all, and
--     leaves those notes unfinalized;
--   * a complete note finalizes, and a second call is harmless (returns 0);
--   * finalize_consultation_with_payment() is all-or-nothing: an incomplete
--     note leaves NO payment row, a refused charge leaves the note
--     unfinalized, and a corrected retry stores both;
--   * after finalization prognosis and vital_signs are frozen like the SOAP
--     fields, for the doctor too;
--   * vital_signs only accepts an object of known numeric keys;
--   * the doctor can read the note author's name from public.profiles;
--   * a patient session cannot change their own clinical history or address,
--     and their export carries the address and the clinical history but not
--     the internal notes.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, patient,
--     service, appointments, notes and audit rows are never committed, pass or
--     fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The appointments_prevent_overlap trigger (migration 19) is disabled the
--     same way, so the fixture appointments cannot fail because real data
--     overlaps them. staff_booking_check.sql covers that trigger.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * ALTER TABLE ... DISABLE TRIGGER holds a lock on public.appointments until
--     the ROLLBACK. The script takes well under a second; run it off-hours.
--
-- Expected output: a single notice that starts with "NOM004 CHECK PASSED".
-- Any "NOM004 CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects, migration 20 applied
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_notes' and column_name = 'prognosis'
  ) then
    raise exception 'NOM004 CHECK ABORTED: migration 20 is not applied (clinical_notes.prognosis is missing).';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'whatsapp_notifications'
  ) then
    execute 'alter table public.appointments disable trigger whatsapp_notifications';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'appointments_prevent_overlap'
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
        'public.prescriptions'::regclass, 'public.payments'::regclass,
        'public.profiles'::regclass,
        'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'NOM004 CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- Five appointments: A (empty diagnosis), B (blank plan), C (no note),
-- D (complete note with prognosis and vital signs), E (charge + finalize).
do $$
declare
  v_phone    text := '+529990000501';
  v_user_d   uuid := gen_random_uuid();
  v_user_p   uuid := gen_random_uuid();
  v_patient  uuid;
  v_svc      uuid;
  v_appt_a   uuid;
  v_appt_b   uuid;
  v_appt_c   uuid;
  v_appt_d   uuid;
  v_appt_e   uuid;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) or exists (
    select 1 from auth.users where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'NOM004 CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  -- on_auth_user_created provisions a 'patient' profile for each user.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'nom004-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone), null, '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles
     set role = 'doctor', first_name = 'NOM004', last_name = 'Doctora'
   where id = v_user_d;

  insert into public.patients (
    first_name, last_name, phone, status, address,
    family_history, personal_pathological_history, non_pathological_history, current_illness
  )
  values (
    'NOM004-CHECK', 'Patient', v_phone, 'active', 'NOM004 address',
    'NOM004 family', 'NOM004 pathological', 'NOM004 non pathological', 'NOM004 illness'
  )
  returning id into v_patient;

  insert into public.services (name, duration_mins, price, is_active)
  values ('NOM004-CHECK service', 30, 500, false)
  returning id into v_svc;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '3100 days', 'confirmed')
  returning id into v_appt_a;
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '3101 days', 'confirmed')
  returning id into v_appt_b;
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '3102 days', 'confirmed')
  returning id into v_appt_c;
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '3103 days', 'confirmed')
  returning id into v_appt_d;
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '3104 days', 'confirmed')
  returning id into v_appt_e;

  perform set_config('nom004_check.user_d', v_user_d::text, true);
  perform set_config('nom004_check.user_p', v_user_p::text, true);
  perform set_config('nom004_check.patient', v_patient::text, true);
  perform set_config('nom004_check.appt_a', v_appt_a::text, true);
  perform set_config('nom004_check.appt_b', v_appt_b::text, true);
  perform set_config('nom004_check.appt_c', v_appt_c::text, true);
  perform set_config('nom004_check.appt_d', v_appt_d::text, true);
  perform set_config('nom004_check.appt_e', v_appt_e::text, true);
  perform set_config('nom004_check.claim_phone', public.normalize_phone(v_phone), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor session
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('nom004_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient  uuid := current_setting('nom004_check.patient')::uuid;
  v_appt_a   uuid := current_setting('nom004_check.appt_a')::uuid;
  v_appt_b   uuid := current_setting('nom004_check.appt_b')::uuid;
  v_appt_c   uuid := current_setting('nom004_check.appt_c')::uuid;
  v_appt_d   uuid := current_setting('nom004_check.appt_d')::uuid;
  v_appt_e   uuid := current_setting('nom004_check.appt_e')::uuid;
  v_note_d   uuid;
  v_pay      public.payments;
  v_frozen   integer;
  v_refused  boolean;
  v_name     text;
begin
  if not public.is_staff() then
    raise exception 'NOM004 CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  insert into public.clinical_notes (appointment_id, patient_id, subjective, analysis, plan)
  values (v_appt_a, v_patient, 'S', '', 'Plan A');
  insert into public.clinical_notes (appointment_id, patient_id, subjective, analysis, plan)
  values (v_appt_b, v_patient, 'S', 'Diagnosis B', '   ');

  -- 2a. Empty diagnosis, blank plan, and no note at all are refused.
  v_refused := false;
  begin
    perform public.finalize_consultation(v_appt_a);
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: finalize_consultation() accepted an empty diagnosis.';
  end if;

  v_refused := false;
  begin
    perform public.finalize_consultation(v_appt_b);
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: finalize_consultation() accepted a blank plan.';
  end if;

  v_refused := false;
  begin
    perform public.finalize_consultation(v_appt_c);
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: finalize_consultation() accepted an appointment with no note.';
  end if;

  if exists (
    select 1 from public.clinical_notes
    where appointment_id in (v_appt_a, v_appt_b) and finalized_at is not null
  ) then
    raise exception 'NOM004 CHECK FAILED: a refused finalization still froze a note.';
  end if;

  -- 2b. vital_signs accepts only known numeric keys.
  v_refused := false;
  begin
    update public.clinical_notes set vital_signs = '{"bp_sys": "120"}'::jsonb
     where appointment_id = v_appt_a;
  exception when others then v_refused := sqlstate = '23514';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: vital_signs accepted a text value.';
  end if;

  v_refused := false;
  begin
    update public.clinical_notes set vital_signs = '{"temp": 37}'::jsonb
     where appointment_id = v_appt_a;
  exception when others then v_refused := sqlstate = '23514';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: vital_signs accepted an unknown key.';
  end if;

  -- 2c. A complete note finalizes; a second call is harmless.
  insert into public.clinical_notes (
    appointment_id, patient_id, subjective, objective, analysis, plan, prognosis, vital_signs
  )
  values (
    v_appt_d, v_patient, 'S', 'O', 'Paciente sano', 'Alta', 'Favorable',
    '{"bp_sys": 120, "bp_dia": 80, "spo2": 98, "weight_kg": 70.5, "height_cm": 165}'::jsonb
  )
  returning id into v_note_d;

  v_frozen := public.finalize_consultation(v_appt_d);
  if v_frozen <> 1 then
    raise exception 'NOM004 CHECK FAILED: finalize_consultation froze % rows, expected 1.', v_frozen;
  end if;

  v_frozen := public.finalize_consultation(v_appt_d);
  if v_frozen <> 0 then
    raise exception 'NOM004 CHECK FAILED: a second finalize_consultation froze % rows, expected 0.', v_frozen;
  end if;

  -- 2d. prognosis and vital_signs are frozen after finalization.
  v_refused := false;
  begin
    update public.clinical_notes set prognosis = 'Reservado' where id = v_note_d;
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: prognosis changed after finalization.';
  end if;

  v_refused := false;
  begin
    update public.clinical_notes set vital_signs = '{"bp_sys": 140}'::jsonb where id = v_note_d;
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: vital_signs changed after finalization.';
  end if;

  v_refused := false;
  begin
    update public.clinical_notes set vital_signs = null where id = v_note_d;
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: vital_signs was cleared after finalization.';
  end if;

  -- 2e. Charge + finalize is all-or-nothing.
  --     An incomplete note (A) is refused and leaves NO payment row.
  v_refused := false;
  begin
    perform public.finalize_consultation_with_payment(v_appt_a, 'paid', 500, 'cash', null);
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: finalize_consultation_with_payment() accepted an empty diagnosis.';
  end if;
  if exists (select 1 from public.payments where appointment_id = v_appt_a) then
    raise exception 'NOM004 CHECK FAILED: a refused finalization left a payment row.';
  end if;

  --     A refused charge (paid with amount 0) leaves the complete note of E
  --     unfinalized and no payment row.
  insert into public.clinical_notes (appointment_id, patient_id, analysis, plan)
  values (v_appt_e, v_patient, 'Paciente sano', 'Alta');

  v_refused := false;
  begin
    perform public.finalize_consultation_with_payment(v_appt_e, 'paid', 0, 'cash', null);
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'NOM004 CHECK FAILED: finalize_consultation_with_payment() accepted a paid charge of 0.';
  end if;
  if exists (select 1 from public.clinical_notes where appointment_id = v_appt_e and finalized_at is not null)
     or exists (select 1 from public.payments where appointment_id = v_appt_e) then
    raise exception 'NOM004 CHECK FAILED: a refused charge still finalized the note or stored a payment.';
  end if;

  --     The corrected retry stores both.
  v_pay := public.finalize_consultation_with_payment(v_appt_e, 'paid', 650, 'card', 'NOM004');
  if v_pay.amount_charged <> 650 or v_pay.appointment_id is distinct from v_appt_e then
    raise exception 'NOM004 CHECK FAILED: the retry stored the charge as % for %.', v_pay.amount_charged, v_pay.appointment_id;
  end if;
  if not exists (select 1 from public.clinical_notes where appointment_id = v_appt_e and finalized_at is not null) then
    raise exception 'NOM004 CHECK FAILED: the retry charged but did not finalize the note.';
  end if;

  -- 2f. The doctor reads the author's name (NOM-004 5.10).
  select trim(concat_ws(' ', p.first_name, p.last_name)) into v_name
  from public.clinical_notes cn
  join public.profiles p on p.id = cn.author_id
  where cn.id = v_note_d;
  if v_name is distinct from 'NOM004 Doctora' then
    raise exception 'NOM004 CHECK FAILED: the doctor reads the note author as %, expected "NOM004 Doctora".', coalesce(v_name, 'nothing');
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Patient session: no write path to clinical history, export has address
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('nom004_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('nom004_check.claim_phone'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('nom004_check.patient')::uuid;
  v_export  jsonb;
begin
  if public.current_patient_id() is distinct from v_patient then
    raise exception 'NOM004 CHECK FAILED: the throwaway patient session does not resolve to its record.';
  end if;

  -- RLS has no patient UPDATE policy: the statement matches zero rows.
  begin
    update public.patients
       set family_history = 'PATIENT EDIT',
           personal_pathological_history = 'PATIENT EDIT',
           non_pathological_history = 'PATIENT EDIT',
           current_illness = 'PATIENT EDIT',
           allergies = 'PATIENT EDIT',
           address = 'PATIENT EDIT'
     where id = v_patient;
  exception when insufficient_privilege then null;
  end;

  v_export := public.export_my_data();
  if v_export -> 'profile' ->> 'address' is distinct from 'NOM004 address' then
    raise exception 'NOM004 CHECK FAILED: the patient export does not carry the address.';
  end if;
  if v_export -> 'profile' ->> 'family_history' is distinct from 'NOM004 family'
     or v_export -> 'profile' ->> 'personal_pathological_history' is distinct from 'NOM004 pathological'
     or v_export -> 'profile' ->> 'non_pathological_history' is distinct from 'NOM004 non pathological'
     or v_export -> 'profile' ->> 'current_illness' is distinct from 'NOM004 illness' then
    raise exception 'NOM004 CHECK FAILED: the patient export does not carry the clinical history.';
  end if;
  if (v_export -> 'profile') ? 'notes' or v_export ? 'clinical_notes' then
    raise exception 'NOM004 CHECK FAILED: the patient export carries internal notes or SOAP notes.';
  end if;
end $$;

reset role;

do $$
declare
  v_patient uuid := current_setting('nom004_check.patient')::uuid;
begin
  if exists (
    select 1 from public.patients
    where id = v_patient
      and 'PATIENT EDIT' in (family_history, personal_pathological_history,
                             non_pathological_history, current_illness,
                             coalesce(allergies, ''), address)
  ) then
    raise exception 'NOM004 CHECK FAILED: a patient session changed their own clinical history or address.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'NOM004 CHECK PASSED: finalize_consultation() refuses an empty diagnosis, a blank plan and a missing note; finalize_consultation_with_payment() leaves no payment when finalization fails and no frozen note when the charge fails; prognosis and vital_signs are frozen after finalization; vital_signs only takes known numeric keys; the doctor reads the author name; a patient cannot edit their clinical history or address and their export carries both but no internal or SOAP notes. All test data was rolled back.';
end $$;

rollback;
