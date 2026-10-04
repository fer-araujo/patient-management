-- =============================================================================
-- RLS check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real policies and RPCs, that:
--   * a patient reads only their own patients / appointments / prescriptions
--     rows and none of another patient's;
--   * a patient reads ZERO clinical_notes and clinical_note_addenda rows
--     (staff-only since migration 14);
--   * a patient cannot change their own profiles.role;
--   * anon cannot read patients, appointments or clinical notes;
--   * export_my_data() has no clinical_notes key and no profile.notes field;
--   * a staff session still sees everything.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, patients,
--     appointments, notes, prescriptions and audit rows it creates are never
--     committed. If any assertion fails the transaction aborts and nothing is
--     committed either.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The appointments_prevent_overlap trigger (migration 19) is disabled the
--     same way, so the fixture appointments, which sit at fixed offsets from
--     now(), cannot fail because a real appointment or blocked slot overlaps
--     them. staff_booking_check.sql covers that trigger.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * ALTER TABLE ... DISABLE TRIGGER holds a lock on public.appointments until
--     the ROLLBACK. The script takes well under a second; run it off-hours.
--
-- Expected output: a single notice that starts with "RLS CHECK PASSED".
-- Any "RLS CHECK FAILED: ..." error names the exact rule that broke.
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
        'public.clinical_notes'::regclass, 'public.prescriptions'::regclass,
        'public.clinical_note_addenda'::regclass, 'public.profiles'::regclass,
        'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'RLS CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- Throwaway phones in an unused range. Stored with '+' like the app does; the
-- JWT claim carries digits only, exactly like Supabase Auth, so the match goes
-- through normalize_phone() on both sides as it does in production.
do $$
declare
  v_phone_a  text := '+529990000101';
  v_phone_b  text := '+529990000102';
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_user_s   uuid := gen_random_uuid();
  v_pat_a    uuid;
  v_pat_b    uuid;
  v_appt_a   uuid;
  v_appt_b   uuid;
  v_note_a   uuid;
  v_note_b   uuid;
  v_svc      uuid;
begin
  if exists (
    select 1 from public.patients
    where public.normalize_phone(phone) in (public.normalize_phone(v_phone_a), public.normalize_phone(v_phone_b))
  ) or exists (
    select 1 from auth.users
    where public.normalize_phone(phone) in (public.normalize_phone(v_phone_a), public.normalize_phone(v_phone_b))
  ) then
    raise exception 'RLS CHECK ABORTED: the throwaway test phones % / % already exist. Nothing was changed.',
      v_phone_a, v_phone_b;
  end if;

  -- Auth users. on_auth_user_created provisions a 'patient' profile for each.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone_a), null, '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone_b), null, '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'rls-check-staff-' || v_user_s || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  -- No request claims are set yet, so the escalation trigger lets the owner
  -- role promote the throwaway staff account (same path as migration 03).
  update public.profiles set role = 'doctor' where id = v_user_s;

  insert into public.patients (first_name, last_name, phone, notes, status)
  values ('RLS-CHECK', 'Patient A', v_phone_a, 'RLS-CHECK INTERNAL NOTE A', 'active')
  returning id into v_pat_a;

  insert into public.patients (first_name, last_name, phone, notes, status)
  values ('RLS-CHECK', 'Patient B', v_phone_b, 'RLS-CHECK INTERNAL NOTE B', 'active')
  returning id into v_pat_b;

  -- appointments.service_id is NOT NULL; a throwaway inactive service keeps
  -- the check independent of the real catalog (rolled back with the rest).
  insert into public.services (name, duration_mins, is_active)
  values ('RLS-CHECK service', 30, false)
  returning id into v_svc;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_pat_a, v_svc, now() + interval '30 days', 'confirmed')
  returning id into v_appt_a;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_pat_b, v_svc, now() + interval '31 days', 'confirmed')
  returning id into v_appt_b;

  insert into public.clinical_notes (appointment_id, patient_id, subjective, objective, analysis, plan)
  values (v_appt_a, v_pat_a, 'RLS-CHECK SOAP A', 'O', 'A', 'P')
  returning id into v_note_a;

  insert into public.clinical_notes (appointment_id, patient_id, subjective, objective, analysis, plan)
  values (v_appt_b, v_pat_b, 'RLS-CHECK SOAP B', 'O', 'A', 'P')
  returning id into v_note_b;

  insert into public.prescriptions (appointment_id, patient_id, medications)
  values
    (v_appt_a, v_pat_a, '[{"nombre": "RLS-CHECK MED A", "dosis": "1", "indicaciones": "x"}]'::jsonb),
    (v_appt_b, v_pat_b, '[{"nombre": "RLS-CHECK MED B", "dosis": "1", "indicaciones": "x"}]'::jsonb);

  -- Addenda only exist on finalized notes and need an authenticated author:
  -- finalize A's note, then insert the addendum under the staff user's id.
  update public.clinical_notes set finalized_at = now() where id = v_note_a;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user_s, 'role', 'authenticated')::text, true);
  insert into public.clinical_note_addenda (note_id, body)
  values (v_note_a, 'RLS-CHECK ADDENDUM A');
  perform set_config('request.jwt.claims', '', true);

  -- Transaction-local settings the later blocks read (visible to any role).
  perform set_config('rls_check.user_a', v_user_a::text, true);
  perform set_config('rls_check.user_b', v_user_b::text, true);
  perform set_config('rls_check.user_s', v_user_s::text, true);
  perform set_config('rls_check.patient_a', v_pat_a::text, true);
  perform set_config('rls_check.patient_b', v_pat_b::text, true);
  perform set_config('rls_check.claim_phone_a', public.normalize_phone(v_phone_a), true);
  perform set_config('rls_check.claim_phone_b', public.normalize_phone(v_phone_b), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Patient A (authenticated, phone claim of A)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('rls_check.user_a'),
    'role', 'authenticated',
    'phone', current_setting('rls_check.claim_phone_a'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_a       uuid := current_setting('rls_check.patient_a')::uuid;
  v_b       uuid := current_setting('rls_check.patient_b')::uuid;
  v_total   integer;
  v_own     integer;
  v_rows    integer;
  v_role    text;
  v_export  jsonb;
begin
  if public.current_patient_id() is distinct from v_a then
    raise exception 'RLS CHECK FAILED: current_patient_id() for patient A is %, expected %.',
      public.current_patient_id(), v_a;
  end if;

  if public.is_staff() then
    raise exception 'RLS CHECK FAILED: patient A is treated as staff.';
  end if;

  -- patients: exactly their own row, none of B's.
  select count(*), count(*) filter (where id = v_a) into v_total, v_own from public.patients;
  if v_total <> 1 or v_own <> 1 then
    raise exception 'RLS CHECK FAILED: patient A sees % patients rows (% own), expected exactly their own.', v_total, v_own;
  end if;

  -- appointments
  select count(*), count(*) filter (where patient_id = v_a) into v_total, v_own from public.appointments;
  if v_total <> 1 or v_own <> 1 then
    raise exception 'RLS CHECK FAILED: patient A sees % appointments rows (% own), expected exactly their own.', v_total, v_own;
  end if;

  -- prescriptions
  select count(*), count(*) filter (where patient_id = v_a) into v_total, v_own from public.prescriptions;
  if v_total <> 1 or v_own <> 1 then
    raise exception 'RLS CHECK FAILED: patient A sees % prescriptions rows (% own), expected exactly their own.', v_total, v_own;
  end if;

  -- Explicitly by B's id, in case the totals above ever change shape.
  if exists (select 1 from public.patients where id = v_b)
     or exists (select 1 from public.appointments where patient_id = v_b)
     or exists (select 1 from public.prescriptions where patient_id = v_b) then
    raise exception 'RLS CHECK FAILED: patient A can read patient B''s rows.';
  end if;

  -- clinical notes and addenda are staff-only (migration 14): zero rows,
  -- including the patient's OWN note and addendum.
  begin
    select count(*) into v_total from public.clinical_notes;
  exception when insufficient_privilege then v_total := 0;
  end;
  if v_total <> 0 then
    raise exception 'RLS CHECK FAILED: patient A reads % clinical_notes rows, expected 0.', v_total;
  end if;

  begin
    select count(*) into v_total from public.clinical_note_addenda;
  exception when insufficient_privilege then v_total := 0;
  end;
  if v_total <> 0 then
    raise exception 'RLS CHECK FAILED: patient A reads % clinical_note_addenda rows, expected 0.', v_total;
  end if;

  -- Cannot write to another patient's record.
  begin
    update public.patients set first_name = 'RLS-CHECK HIJACK' where id = v_b;
    get diagnostics v_rows = row_count;
  exception when insufficient_privilege then v_rows := 0;
  end;
  if v_rows <> 0 then
    raise exception 'RLS CHECK FAILED: patient A updated patient B''s record.';
  end if;

  -- Cannot promote themselves. The escalation trigger raises 42501; an update
  -- that silently touches zero rows would also be safe.
  begin
    update public.profiles set role = 'doctor' where id = auth.uid();
  exception when insufficient_privilege then null;
  end;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'patient' then
    raise exception 'RLS CHECK FAILED: patient A''s own profiles.role is now %, expected patient.', v_role;
  end if;
  if public.is_staff() then
    raise exception 'RLS CHECK FAILED: patient A became staff after a role update.';
  end if;

  -- The data export never includes clinical notes or the internal notes pad.
  v_export := public.export_my_data();
  if v_export ? 'clinical_notes' then
    raise exception 'RLS CHECK FAILED: export_my_data() still has a clinical_notes key.';
  end if;
  if (v_export -> 'profile') ? 'notes' then
    raise exception 'RLS CHECK FAILED: export_my_data() exposes profile.notes.';
  end if;
  if v_export::text like '%RLS-CHECK SOAP%'
     or v_export::text like '%RLS-CHECK ADDENDUM%'
     or v_export::text like '%RLS-CHECK INTERNAL NOTE%' then
    raise exception 'RLS CHECK FAILED: export_my_data() leaks a clinical note, addendum or internal note.';
  end if;
  if v_export::text like '%Patient B%' or v_export::text like '%RLS-CHECK MED B%' then
    raise exception 'RLS CHECK FAILED: export_my_data() for patient A contains patient B''s data.';
  end if;
  if v_export -> 'profile' ->> 'last_name' is distinct from 'Patient A' then
    raise exception 'RLS CHECK FAILED: export_my_data() did not return patient A''s own profile.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Patient B (symmetric: sees only B)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('rls_check.user_b'),
    'role', 'authenticated',
    'phone', current_setting('rls_check.claim_phone_b'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_a uuid := current_setting('rls_check.patient_a')::uuid;
  v_b uuid := current_setting('rls_check.patient_b')::uuid;
begin
  if (select count(*) from public.patients) <> 1
     or not exists (select 1 from public.patients where id = v_b) then
    raise exception 'RLS CHECK FAILED: patient B does not see exactly their own patients row.';
  end if;
  if exists (select 1 from public.patients where id = v_a)
     or exists (select 1 from public.appointments where patient_id = v_a)
     or exists (select 1 from public.prescriptions where patient_id = v_a) then
    raise exception 'RLS CHECK FAILED: patient B can read patient A''s rows.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Staff (doctor profile): still sees both patients and their notes
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('rls_check.user_s'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_a uuid := current_setting('rls_check.patient_a')::uuid;
  v_b uuid := current_setting('rls_check.patient_b')::uuid;
begin
  if not public.is_staff() then
    raise exception 'RLS CHECK FAILED: the doctor test account is not recognized as staff.';
  end if;
  if (select count(*) from public.patients where id in (v_a, v_b)) <> 2 then
    raise exception 'RLS CHECK FAILED: staff cannot read both test patients.';
  end if;
  if (select count(*) from public.clinical_notes where patient_id in (v_a, v_b)) <> 2 then
    raise exception 'RLS CHECK FAILED: staff cannot read both test clinical notes.';
  end if;
  if not exists (
    select 1 from public.clinical_note_addenda ad
    join public.clinical_notes cn on cn.id = ad.note_id
    where cn.patient_id = v_a
  ) then
    raise exception 'RLS CHECK FAILED: staff cannot read the test addendum.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 5. anon (public API key, no user)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end $$;
set local role anon;

do $$
declare
  v_table  text;
  v_count  integer;
  v_denied boolean := false;
begin
  foreach v_table in array array[
    'patients', 'appointments', 'clinical_notes', 'clinical_note_addenda',
    'prescriptions', 'profiles'
  ] loop
    begin
      execute format('select count(*) from public.%I', v_table) into v_count;
    exception when insufficient_privilege then v_count := 0;
    end;
    if v_count <> 0 then
      raise exception 'RLS CHECK FAILED: anon reads % rows from public.%.', v_count, v_table;
    end if;
  end loop;

  -- Must be refused for lack of EXECUTE, not merely fail inside the function.
  begin
    perform public.export_my_data();
  exception
    when insufficient_privilege then v_denied := true;
    when others then v_denied := false;
  end;
  if not v_denied then
    raise exception 'RLS CHECK FAILED: anon can execute export_my_data().';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'RLS CHECK PASSED: patients see only their own rows, clinical notes and addenda are staff-only, roles cannot be self-escalated, anon reads nothing, and export_my_data() excludes clinical notes. All test data was rolled back.';
end $$;

rollback;
