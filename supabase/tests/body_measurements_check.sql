-- =============================================================================
-- Body measurements check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 24 objects, that:
--   * the doctor turns weight tracking on and off for a patient;
--   * the doctor records, corrects and deletes a measurement; BMI is computed
--     by the database (and cannot be written), author_id is the doctor and
--     cannot be changed;
--   * typos are refused (700 kg, 95 % body fat, muscle heavier than the
--     weight, a value outside a closed list), and so are a future date, a
--     measurement moved to another patient and an appointment of another
--     patient;
--   * an anonymized record refuses new measurements, corrections, deletes
--     and a weight_tracking change;
--   * anonymize_patient() clears the doctor's note on every measurement of
--     the record (the measurements themselves stay);
--   * the admin reads no measurement, cannot write one and cannot change
--     weight_tracking;
--   * the patient reads no measurement directly, cannot write one, cannot
--     change their own weight_tracking, and their data export carries their
--     measurements (with BMI) but never the doctor's note;
--   * anon reads nothing;
--   * every insert, update and delete is audited.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users,
--     patients, service, appointments, measurements and audit rows are never
--     committed, pass or fail.
--   * The whatsapp_notifications and appointments_prevent_overlap triggers
--     are disabled INSIDE the transaction (DDL is transactional in Postgres),
--     so the test appointments can never send a WhatsApp message or collide
--     with real data. The ROLLBACK re-enables them automatically.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * ALTER TABLE ... DISABLE TRIGGER holds a lock on public.appointments until
--     the ROLLBACK. The script takes well under a second; run it off-hours.
--
-- Expected output: a single notice that starts with "BODY MEASUREMENTS CHECK PASSED".
-- Any "BODY MEASUREMENTS CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects, migration 24 applied
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.body_measurements') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'patients' and column_name = 'weight_tracking'
     ) then
    raise exception 'BODY MEASUREMENTS CHECK ABORTED: migration 24 is not applied (body_measurements or patients.weight_tracking is missing).';
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
        'public.services'::regclass, 'public.body_measurements'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'BODY MEASUREMENTS CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- Patient P (linked to a patient user by phone), patient O (another patient,
-- with an appointment), patient X (anonymized, with one old measurement),
-- patient Z (no appointments, one measurement with a note, anonymized by the
-- doctor in step 2h).
do $$
declare
  v_phone   text := '+529990000701';
  v_user_d  uuid := gen_random_uuid();
  v_user_a  uuid := gen_random_uuid();
  v_user_p  uuid := gen_random_uuid();
  v_patient uuid;
  v_other   uuid;
  v_anon    uuid;
  v_svc     uuid;
  v_appt_p  uuid;
  v_appt_o  uuid;
  v_meas_x  uuid;
  v_to_anon uuid;
  v_meas_z  uuid;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) or exists (
    select 1 from auth.users where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'BODY MEASUREMENTS CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  -- on_auth_user_created provisions a 'patient' profile for each user.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'body-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'body-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone), null, '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, status, gender)
  values ('BODY-CHECK', 'Patient', v_phone, 'active', 'Femenino')
  returning id into v_patient;

  insert into public.patients (first_name, last_name, status)
  values ('BODY-CHECK', 'Other', 'active')
  returning id into v_other;

  insert into public.patients (first_name, last_name, status)
  values ('BODY-CHECK', 'To anonymize', 'active')
  returning id into v_anon;

  insert into public.body_measurements (patient_id, measured_at, weight_kg)
  values (v_anon, date '2026-01-10', 80)
  returning id into v_meas_x;

  update public.patients
     set first_name = 'Paciente', last_name = 'Anonimizado', status = 'archived', anonymized_at = now()
   where id = v_anon;

  insert into public.patients (first_name, last_name, status, weight_tracking)
  values ('BODY-CHECK', 'Anonymize now', 'active', true)
  returning id into v_to_anon;

  insert into public.body_measurements (patient_id, measured_at, weight_kg, note)
  values (v_to_anon, date '2026-01-12', 75, 'BODY-CHECK note naming the patient')
  returning id into v_meas_z;

  insert into public.services (name, duration_mins, price, is_active)
  values ('BODY-CHECK service', 30, 500, false)
  returning id into v_svc;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '2 hours', 'confirmed')
  returning id into v_appt_p;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_other, v_svc, now() - interval '3 hours', 'confirmed')
  returning id into v_appt_o;

  perform set_config('body_check.user_d', v_user_d::text, true);
  perform set_config('body_check.user_a', v_user_a::text, true);
  perform set_config('body_check.user_p', v_user_p::text, true);
  perform set_config('body_check.claim_phone', public.normalize_phone(v_phone), true);
  perform set_config('body_check.patient', v_patient::text, true);
  perform set_config('body_check.other', v_other::text, true);
  perform set_config('body_check.anon', v_anon::text, true);
  perform set_config('body_check.meas_x', v_meas_x::text, true);
  perform set_config('body_check.to_anon', v_to_anon::text, true);
  perform set_config('body_check.meas_z', v_meas_z::text, true);
  perform set_config('body_check.appt_p', v_appt_p::text, true);
  perform set_config('body_check.appt_o', v_appt_o::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor session
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('body_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_user_d  uuid := current_setting('body_check.user_d')::uuid;
  v_patient uuid := current_setting('body_check.patient')::uuid;
  v_other   uuid := current_setting('body_check.other')::uuid;
  v_anon    uuid := current_setting('body_check.anon')::uuid;
  v_meas_x  uuid := current_setting('body_check.meas_x')::uuid;
  v_to_anon uuid := current_setting('body_check.to_anon')::uuid;
  v_meas_z  uuid := current_setting('body_check.meas_z')::uuid;
  v_appt_p  uuid := current_setting('body_check.appt_p')::uuid;
  v_appt_o  uuid := current_setting('body_check.appt_o')::uuid;
  v_today   date := (now() at time zone 'America/Monterrey')::date;
  v_id      uuid;
  v_gone    uuid;
  v_row     public.body_measurements;
  v_rows    integer;
  v_state   text;
  v_msg     text;
  c         text;
begin
  if not public.is_staff() then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- 2a. Weight tracking on and off.
  update public.patients set weight_tracking = true where id = v_patient;
  if not (select weight_tracking from public.patients where id = v_patient) then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the doctor could not turn weight tracking on.';
  end if;
  update public.patients set weight_tracking = false where id = v_other;
  update public.patients set weight_tracking = true where id = v_other;
  update public.patients set weight_tracking = false where id = v_other;
  if (select weight_tracking from public.patients where id = v_other) then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the doctor could not turn weight tracking off.';
  end if;

  -- 2b. Record: BMI generated, author is the doctor, linked to her appointment.
  insert into public.body_measurements (
    patient_id, measured_at, appointment_id, author_id, weight_kg, height_cm,
    body_fat_pct, body_fat_kg, skeletal_muscle_kg, lean_mass_kg, waist_hip_ratio,
    visceral_fat_level, bmr_kcal, balance_upper_lower, body_type, cid_type, note
  )
  values (
    v_patient, v_today, v_appt_p, gen_random_uuid(), 70, 170,
    30.5, 21.35, 26.1, 48.65, 0.88,
    8, 1350, 'equilibrado', 'sobrepeso', 'tipo_c', 'BODY-CHECK private note'
  )
  returning * into v_row;
  v_id := v_row.id;

  if v_row.bmi is distinct from 24.2 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: BMI of 70 kg at 170 cm is %, expected 24.2.', v_row.bmi;
  end if;
  if v_row.author_id is distinct from v_user_d then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: author_id is %, expected the doctor (a client-sent author must be ignored).', v_row.author_id;
  end if;

  -- An older measurement without a height: BMI stays null.
  insert into public.body_measurements (patient_id, measured_at, weight_kg)
  values (v_patient, v_today - 30, 72.4)
  returning * into v_row;
  if v_row.bmi is not null then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: a measurement without a height has BMI %.', v_row.bmi;
  end if;

  -- 2c. Correct: BMI follows, author cannot change.
  update public.body_measurements
     set weight_kg = 68.5, author_id = gen_random_uuid()
   where id = v_id
  returning * into v_row;
  if v_row.bmi is distinct from 23.7 or v_row.author_id is distinct from v_user_d then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: after a correction BMI is % and author %, expected 23.7 and the doctor.',
      v_row.bmi, v_row.author_id;
  end if;

  v_state := null;
  begin
    update public.body_measurements set bmi = 10 where id = v_id;
  exception when others then v_state := sqlstate;
  end;
  if v_state is null then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: BMI was written directly.';
  end if;

  -- 2d. Typos and closed lists.
  for c in
    select * from unnest(array['700 kg', '95 % fat', 'muscle above weight', 'unknown body type',
                               'unknown balance', 'unknown CID', 'visceral 0', 'year 1999'])
  loop
    v_state := null;
    begin
      if c = '700 kg' then
        insert into public.body_measurements (patient_id, measured_at, weight_kg) values (v_patient, v_today, 700);
      elsif c = '95 % fat' then
        insert into public.body_measurements (patient_id, measured_at, weight_kg, body_fat_pct) values (v_patient, v_today, 70, 95);
      elsif c = 'muscle above weight' then
        insert into public.body_measurements (patient_id, measured_at, weight_kg, skeletal_muscle_kg) values (v_patient, v_today, 70, 71);
      elsif c = 'unknown body type' then
        insert into public.body_measurements (patient_id, measured_at, weight_kg, body_type) values (v_patient, v_today, 70, 'gordito');
      elsif c = 'unknown balance' then
        insert into public.body_measurements (patient_id, measured_at, weight_kg, balance_upper_lower) values (v_patient, v_today, 70, 'raro');
      elsif c = 'unknown CID' then
        insert into public.body_measurements (patient_id, measured_at, weight_kg, cid_type) values (v_patient, v_today, 70, 'tipo_x');
      elsif c = 'visceral 0' then
        insert into public.body_measurements (patient_id, measured_at, weight_kg, visceral_fat_level) values (v_patient, v_today, 70, 0);
      else
        insert into public.body_measurements (patient_id, measured_at, weight_kg) values (v_patient, date '1999-12-31', 70);
      end if;
    exception when check_violation then v_state := '23514';
    end;
    if v_state is distinct from '23514' then
      raise exception 'BODY MEASUREMENTS CHECK FAILED: a measurement with % was accepted.', c;
    end if;
  end loop;

  -- 2e. Future date, another patient's appointment, moving a measurement.
  v_state := null;
  begin
    insert into public.body_measurements (patient_id, measured_at, weight_kg) values (v_patient, v_today + 1, 70);
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001' or v_msg <> 'La fecha de la medición no puede ser futura.' then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: a measurement dated tomorrow was not refused (% / %).', v_state, v_msg;
  end if;

  v_state := null;
  begin
    insert into public.body_measurements (patient_id, measured_at, appointment_id, weight_kg)
    values (v_patient, v_today, v_appt_o, 70);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: a measurement linked to another patient''s appointment was accepted.';
  end if;

  v_state := null;
  begin
    update public.body_measurements set patient_id = v_other where id = v_id;
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: a measurement was moved to another patient.';
  end if;

  -- 2f. Anonymized record: no new measurement, no correction, no delete.
  v_state := null;
  begin
    insert into public.body_measurements (patient_id, measured_at, weight_kg) values (v_anon, v_today, 70);
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001'
     or v_msg <> 'Este expediente fue anonimizado. Sus datos ya no se pueden editar.' then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: a measurement of an anonymized record was not refused (% / %).', v_state, v_msg;
  end if;

  foreach c in array array['update', 'delete'] loop
    v_state := null;
    begin
      if c = 'update' then
        update public.body_measurements set weight_kg = 81 where id = v_meas_x;
      else
        delete from public.body_measurements where id = v_meas_x;
      end if;
    exception when others then v_state := sqlstate;
    end;
    if v_state is distinct from 'P0001' then
      raise exception 'BODY MEASUREMENTS CHECK FAILED: an anonymized record''s measurement allowed an %.', c;
    end if;
  end loop;

  foreach c in array array['on', 'off'] loop
    v_state := null;
    v_msg := null;
    begin
      update public.patients set weight_tracking = (c = 'on') where id = v_anon;
    exception when others then
      v_state := sqlstate;
      v_msg := sqlerrm;
    end;
    -- Turning it off on a record that is already off changes nothing: allowed.
    if c = 'on' and (v_state is distinct from 'P0001'
                     or v_msg <> 'Este expediente fue anonimizado. Sus datos ya no se pueden editar.') then
      raise exception 'BODY MEASUREMENTS CHECK FAILED: weight tracking was turned on for an anonymized record (% / %).', v_state, v_msg;
    end if;
    if c = 'off' and v_state is not null then
      raise exception 'BODY MEASUREMENTS CHECK FAILED: a no-op weight_tracking write on an anonymized record failed (% / %).', v_state, v_msg;
    end if;
  end loop;

  -- 2h. anonymize_patient clears the measurement notes (and keeps the
  --     measurements), then the flag is frozen.
  perform public.anonymize_patient(v_to_anon);

  select * into v_row from public.body_measurements where id = v_meas_z;
  if v_row.id is null then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: anonymize_patient() removed the measurement.';
  end if;
  if v_row.note is not null then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: anonymize_patient() kept the measurement note.';
  end if;
  if v_row.weight_kg is distinct from 75.00 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: anonymize_patient() changed the measured weight (%).', v_row.weight_kg;
  end if;

  v_state := null;
  begin
    update public.patients set weight_tracking = false where id = v_to_anon;
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: weight tracking was turned off on a freshly anonymized record.';
  end if;

  -- 2g. Delete a measurement (the doctor may remove a wrong one).
  insert into public.body_measurements (patient_id, measured_at, weight_kg)
  values (v_patient, v_today, 69)
  returning id into v_gone;
  delete from public.body_measurements where id = v_gone;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the doctor could not delete a measurement.';
  end if;

  perform set_config('body_check.meas', v_id::text, true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin session: no clinical data
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('body_check.user_a'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('body_check.patient')::uuid;
  v_count   integer;
  v_rows    integer;
  v_state   text;
begin
  if public.is_staff() or not public.is_business_staff() then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the throwaway admin is not business-only staff.';
  end if;

  select count(*) into v_count from public.body_measurements;
  if v_count <> 0 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the admin reads % measurement(s).', v_count;
  end if;

  v_state := null;
  begin
    insert into public.body_measurements (patient_id, measured_at, weight_kg)
    values (v_patient, (now() at time zone 'America/Monterrey')::date, 70);
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the admin wrote a measurement.';
  end if;

  update public.patients set weight_tracking = false where id = v_patient;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the admin changed weight_tracking.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Patient session: no direct access, export carries the measurements
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('body_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('body_check.claim_phone'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('body_check.patient')::uuid;
  v_count   integer;
  v_state   text;
  v_export  jsonb;
  v_list    jsonb;
begin
  if public.current_patient_id() is distinct from v_patient then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the throwaway patient session does not resolve to its record.';
  end if;

  select count(*) into v_count from public.body_measurements;
  if v_count <> 0 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the patient reads % measurement(s) directly.', v_count;
  end if;

  v_state := null;
  begin
    insert into public.body_measurements (patient_id, measured_at, weight_kg)
    values (v_patient, (now() at time zone 'America/Monterrey')::date, 50);
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the patient wrote a measurement.';
  end if;

  -- RLS has no patient UPDATE policy: the statement matches zero rows.
  begin
    update public.patients set weight_tracking = false where id = v_patient;
  exception when insufficient_privilege then null;
  end;

  v_export := public.export_my_data();
  v_list := v_export -> 'body_measurements';
  if jsonb_typeof(v_list) is distinct from 'array' or jsonb_array_length(v_list) <> 2 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the export carries % measurement(s), expected 2.',
      coalesce(jsonb_array_length(v_list)::text, 'no list of');
  end if;
  -- Oldest first: 72.4 kg a month ago, then today's 68.5 kg with BMI 23.7.
  if (v_list -> 0 ->> 'weight_kg')::numeric <> 72.4
     or (v_list -> 1 ->> 'weight_kg')::numeric <> 68.5
     or (v_list -> 1 ->> 'bmi')::numeric <> 23.7
     or v_list -> 1 ->> 'body_type' is distinct from 'sobrepeso' then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the export measurements are wrong: %.', v_list;
  end if;
  if v_list::text like '%BODY-CHECK private note%' or (v_list -> 1) ? 'note' then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the export carries the doctor''s note.';
  end if;
end $$;

reset role;

do $$
begin
  if not (select weight_tracking from public.patients where id = current_setting('body_check.patient')::uuid) then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: a patient session changed their own weight_tracking.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. anon: nothing
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end $$;
set local role anon;

do $$
declare
  v_count integer;
begin
  begin
    select count(*) into v_count from public.body_measurements;
  exception when insufficient_privilege then v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: anon reads % measurement(s).', v_count;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 6. Audit (owner, no request context)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_user_d  uuid := current_setting('body_check.user_d')::uuid;
  v_patient uuid := current_setting('body_check.patient')::uuid;
  v_ins     integer;
  v_upd     integer;
  v_del     integer;
begin
  -- Doctor: 3 inserts, 1 update, 1 delete on patient P's measurements.
  select count(*) filter (where action = 'INSERT'),
         count(*) filter (where action = 'UPDATE'),
         count(*) filter (where action = 'DELETE')
    into v_ins, v_upd, v_del
  from public.audit_log
  where table_name = 'body_measurements'
    and actor_id = v_user_d
    and patient_id = v_patient;
  if v_ins <> 3 or v_upd <> 1 or v_del <> 1 then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: the audit has % insert(s), % update(s), % delete(s), expected 3, 1 and 1.',
      v_ins, v_upd, v_del;
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name = 'patients' and actor_id = v_user_d and row_id = v_patient
      and 'weight_tracking' = any (changed_columns)
  ) then
    raise exception 'BODY MEASUREMENTS CHECK FAILED: turning weight tracking on was not audited.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'BODY MEASUREMENTS CHECK PASSED: the doctor turns weight tracking on and off and records, corrects and deletes measurements with a database-computed BMI and a server-owned author; typos, closed-list values, future dates, foreign appointments, moved measurements and anonymized records (measurements and weight_tracking) are refused; anonymization clears the measurement notes; the admin and the patient read and write nothing directly; the patient export carries the measurements without the doctor''s note; anon reads nothing; every change is audited. All test data was rolled back.';
end $$;

rollback;
