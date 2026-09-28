-- =============================================================================
-- Roles check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 18 objects, that the two staff roles are
-- separated:
--   * doctor: clinical staff AND business staff. Reads patients, appointments,
--     notes, addenda, prescriptions, files, ARCO requests, consents, the audit
--     log and other profiles; writes notes and prescriptions; records a charge,
--     finalizes a consultation, moves an ARCO request; reads inventory,
--     services and payments; adjusts stock.
--   * admin: business staff ONLY. Reads inventory, inventory movements, every
--     service (including inactive ones) and payments; adjusts stock; writes the
--     catalog. Reads NO patient, appointment, clinical note, addendum,
--     prescription, patient file, ARCO request, consent, audit entry, agenda
--     row (clinic_settings, blocked_slots), clinical_records object or other
--     profile. A payment joined to patients yields no name. Cannot write
--     patients or appointments, cannot promote itself, and cannot call
--     record_payment(), finalize_consultation(), resolve_arco_request(),
--     anonymize_patient() or export_my_data().
--   * patient and anon are not business staff.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, patient,
--     service, appointment, clinical rows, inventory item, payment and audit
--     rows are never committed, pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointment can never
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
-- Expected output: a single notice that starts with "ROLES CHECK PASSED".
-- Any "ROLES CHECK FAILED: ..." error names the exact rule that broke.
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
        'public.services'::regclass, 'public.payments'::regclass,
        'public.inventory'::regclass, 'public.inventory_movements'::regclass,
        'public.clinical_notes'::regclass, 'public.clinical_note_addenda'::regclass,
        'public.prescriptions'::regclass, 'public.patient_files'::regclass,
        'public.arco_requests'::regclass, 'public.consents'::regclass,
        'public.blocked_slots'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'ROLES CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_phone    text := '+529990000301';
  v_user_d   uuid := gen_random_uuid();
  v_user_a   uuid := gen_random_uuid();
  v_user_p   uuid := gen_random_uuid();
  v_patient  uuid;
  v_svc      uuid;
  v_appt     uuid;
  v_arco     uuid;
  v_slot     uuid;
  v_item     uuid;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) or exists (
    select 1 from auth.users where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'ROLES CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  -- on_auth_user_created provisions a 'patient' profile for each user.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'roles-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'roles-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone), null, '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, status)
  values ('ROLES-CHECK', 'Patient', v_phone, 'active')
  returning id into v_patient;

  -- Inactive on purpose: only staff policies (not the public one) can see it.
  insert into public.services (name, duration_mins, price, is_active)
  values ('ROLES-CHECK service', 30, 5500, false)
  returning id into v_svc;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '40 days', 'confirmed')
  returning id into v_appt;

  insert into public.consents (patient_id, document, version)
  values (v_patient, 'aviso_privacidad', public.privacy_notice_version());

  insert into public.arco_requests (patient_id, request_type, details)
  values (v_patient, 'access', 'ROLES-CHECK request')
  returning id into v_arco;

  insert into public.patient_files (patient_id, file_url, file_name, file_type, uploaded_by)
  values (v_patient, v_patient || '/roles-check.pdf', 'roles-check.pdf', 'application/pdf', 'doctor');

  insert into public.blocked_slots (start_time, end_time, reason)
  values (now() + interval '400 days', now() + interval '400 days 1 hour', 'personal')
  returning id into v_slot;

  -- Initial stock 5 becomes an "Inventario inicial" movement (migration 16).
  insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, is_active)
  values ('ROLES-CHECK item', 'Otro', 5, 1, 'piezas', true)
  returning id into v_item;

  perform set_config('roles_check.user_d', v_user_d::text, true);
  perform set_config('roles_check.user_a', v_user_a::text, true);
  perform set_config('roles_check.user_p', v_user_p::text, true);
  perform set_config('roles_check.patient', v_patient::text, true);
  perform set_config('roles_check.service', v_svc::text, true);
  perform set_config('roles_check.appt', v_appt::text, true);
  perform set_config('roles_check.arco', v_arco::text, true);
  perform set_config('roles_check.slot', v_slot::text, true);
  perform set_config('roles_check.item', v_item::text, true);
  perform set_config('roles_check.claim_phone', public.normalize_phone(v_phone), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor session: sees and does everything
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('roles_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('roles_check.patient')::uuid;
  v_svc     uuid := current_setting('roles_check.service')::uuid;
  v_appt    uuid := current_setting('roles_check.appt')::uuid;
  v_arco    uuid := current_setting('roles_check.arco')::uuid;
  v_slot    uuid := current_setting('roles_check.slot')::uuid;
  v_item    uuid := current_setting('roles_check.item')::uuid;
  v_user_a  uuid := current_setting('roles_check.user_a')::uuid;
  v_note    uuid;
  v_frozen  integer;
  v_stock   integer;
  v_count   integer;
  v_check   record;
  v_row     public.payments;
begin
  if not public.is_staff() or not public.is_business_staff() then
    raise exception 'ROLES CHECK FAILED: the doctor is not both clinical and business staff.';
  end if;

  -- Clinical writes.
  -- Diagnosis and plan are required to finalize (migration 20).
  insert into public.clinical_notes (appointment_id, patient_id, subjective, analysis, plan)
  values (v_appt, v_patient, 'ROLES-CHECK note', 'ROLES-CHECK diagnosis', 'ROLES-CHECK plan')
  returning id into v_note;

  insert into public.prescriptions (appointment_id, patient_id, medications)
  values (v_appt, v_patient, '[]'::jsonb);

  -- Clinical RPCs.
  v_row := public.record_payment(v_appt, 'paid', 5500, 'card', null);
  if v_row.amount_charged <> 5500 or v_row.patient_id is distinct from v_patient then
    raise exception 'ROLES CHECK FAILED: the doctor''s charge was stored as % for patient %.',
      v_row.amount_charged, v_row.patient_id;
  end if;

  v_frozen := public.finalize_consultation(v_appt);
  if v_frozen <> 2 then
    raise exception 'ROLES CHECK FAILED: finalize_consultation froze % rows, expected 2.', v_frozen;
  end if;

  insert into public.clinical_note_addenda (note_id, body) values (v_note, 'ROLES-CHECK addendum');

  perform public.resolve_arco_request(v_arco, 'in_progress', null);

  -- Business RPC.
  v_stock := public.adjust_stock(v_item, -1, 'use');
  if v_stock <> 4 then
    raise exception 'ROLES CHECK FAILED: the doctor''s adjust_stock left % units, expected 4.', v_stock;
  end if;

  -- Reads: one fixture row per table.
  for v_check in
    select * from (values
      ('patients',              (select count(*) from public.patients where id = v_patient)),
      ('appointments',          (select count(*) from public.appointments where id = v_appt)),
      ('clinical_notes',        (select count(*) from public.clinical_notes where id = v_note)),
      ('clinical_note_addenda', (select count(*) from public.clinical_note_addenda where note_id = v_note)),
      ('prescriptions',         (select count(*) from public.prescriptions where appointment_id = v_appt)),
      ('patient_files',         (select count(*) from public.patient_files where patient_id = v_patient)),
      ('arco_requests',         (select count(*) from public.arco_requests where id = v_arco)),
      ('consents',              (select count(*) from public.consents where patient_id = v_patient)),
      ('audit_log',             (select least(count(*), 1) from public.audit_log where patient_id = v_patient)),
      ('other profiles',        (select count(*) from public.profiles where id = v_user_a)),
      ('blocked_slots',         (select count(*) from public.blocked_slots where id = v_slot)),
      ('payments',              (select count(*) from public.payments where appointment_id = v_appt)),
      ('inventory',             (select count(*) from public.inventory where id = v_item)),
      ('inventory_movements',   (select least(count(*), 1) from public.inventory_movements where item_id = v_item)),
      ('inactive services',     (select count(*) from public.services where id = v_svc))
    ) as t(label, n)
  loop
    if v_check.n <> 1 then
      raise exception 'ROLES CHECK FAILED: the doctor reads % row(s) of %, expected 1.', v_check.n, v_check.label;
    end if;
  end loop;

  -- The doctor still sees the patient's name next to a payment.
  select count(*) into v_count
  from public.payments p
  join public.patients pt on pt.id = p.patient_id
  where p.appointment_id = v_appt and pt.first_name = 'ROLES-CHECK';
  if v_count <> 1 then
    raise exception 'ROLES CHECK FAILED: the doctor cannot resolve the patient of a payment.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin session: business only, no patient data
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('roles_check.user_a'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('roles_check.patient')::uuid;
  v_svc     uuid := current_setting('roles_check.service')::uuid;
  v_appt    uuid := current_setting('roles_check.appt')::uuid;
  v_arco    uuid := current_setting('roles_check.arco')::uuid;
  v_item    uuid := current_setting('roles_check.item')::uuid;
  v_new_svc uuid;
  v_stock   integer;
  v_count   integer;
  v_rows    integer;
  v_amount  numeric;
  v_name    text;
  v_state   text;
  v_check   record;
  v_rpc     record;
begin
  if public.is_staff() then
    raise exception 'ROLES CHECK FAILED: the admin is treated as clinical staff.';
  end if;
  if not public.is_business_staff() then
    raise exception 'ROLES CHECK FAILED: the admin is not business staff.';
  end if;

  -- 3a. Business reads.
  for v_check in
    select * from (values
      ('inventory',           (select count(*) from public.inventory where id = v_item)),
      ('inventory_movements', (select least(count(*), 1) from public.inventory_movements where item_id = v_item)),
      ('inactive services',   (select count(*) from public.services where id = v_svc)),
      ('payments',            (select count(*) from public.payments where appointment_id = v_appt))
    ) as t(label, n)
  loop
    if v_check.n <> 1 then
      raise exception 'ROLES CHECK FAILED: the admin reads % row(s) of %, expected 1.', v_check.n, v_check.label;
    end if;
  end loop;

  -- 3b. Finanzas: the amount is visible, the patient's name is not (the same
  --     LEFT JOIN a PostgREST embed performs resolves to null, not an error).
  select p.amount_charged, pt.first_name into v_amount, v_name
  from public.payments p
  left join public.patients pt on pt.id = p.patient_id
  where p.appointment_id = v_appt;
  if v_amount is distinct from 5500.00 or v_name is not null then
    raise exception 'ROLES CHECK FAILED: the admin sees amount % and patient name %.', v_amount, v_name;
  end if;

  -- 3c. Business writes.
  v_stock := public.adjust_stock(v_item, 3, 'purchase', 90);
  if v_stock <> 7 then
    raise exception 'ROLES CHECK FAILED: the admin''s purchase left % units, expected 7.', v_stock;
  end if;

  insert into public.services (name, duration_mins, price, is_active)
  values ('ROLES-CHECK admin service', 30, 100, false)
  returning id into v_new_svc;
  update public.services set price = 150 where id = v_new_svc;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'ROLES CHECK FAILED: the admin could not edit the catalog.';
  end if;

  -- 3d. No clinical, personal or agenda data at all.
  for v_check in
    select * from (values
      ('patients',              (select count(*) from public.patients)),
      ('appointments',          (select count(*) from public.appointments)),
      ('clinical_notes',        (select count(*) from public.clinical_notes)),
      ('clinical_note_addenda', (select count(*) from public.clinical_note_addenda)),
      ('prescriptions',         (select count(*) from public.prescriptions)),
      ('patient_files',         (select count(*) from public.patient_files)),
      ('arco_requests',         (select count(*) from public.arco_requests)),
      ('consents',              (select count(*) from public.consents)),
      ('audit_log',             (select count(*) from public.audit_log)),
      ('other profiles',        (select count(*) from public.profiles where id <> auth.uid())),
      ('clinic_settings',       (select count(*) from public.clinic_settings)),
      ('blocked_slots',         (select count(*) from public.blocked_slots))
    ) as t(label, n)
  loop
    if v_check.n <> 0 then
      raise exception 'ROLES CHECK FAILED: the admin reads % row(s) of %.', v_check.n, v_check.label;
    end if;
  end loop;

  begin
    select count(*) into v_count from storage.objects where bucket_id = 'clinical_records';
  exception when insufficient_privilege then v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'ROLES CHECK FAILED: the admin lists % clinical_records objects.', v_count;
  end if;

  -- 3e. No clinical writes.
  v_state := null;
  begin
    insert into public.patients (first_name, last_name, status) values ('ROLES-CHECK', 'Intruder', 'active');
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ROLES CHECK FAILED: the admin created a patient.';
  end if;

  update public.appointments set status = 'cancelled' where id = v_appt;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'ROLES CHECK FAILED: the admin changed an appointment.';
  end if;

  -- 3f. No self-promotion.
  v_state := null;
  begin
    update public.profiles set role = 'doctor' where id = auth.uid();
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ROLES CHECK FAILED: the admin promoted itself to doctor.';
  end if;

  -- 3g. No clinical RPCs (the doctor-only check raises 42501).
  for v_rpc in
    select * from (values
      ('record_payment',        format('select public.record_payment(%L::uuid, %L)', v_appt, 'courtesy')),
      ('finalize_consultation', format('select public.finalize_consultation(%L::uuid)', v_appt)),
      ('resolve_arco_request',  format('select public.resolve_arco_request(%L::uuid, %L, %L)', v_arco, 'rejected', 'x')),
      ('anonymize_patient',     format('select public.anonymize_patient(%L::uuid)', v_patient))
    ) as t(label, stmt)
  loop
    v_state := null;
    begin
      execute v_rpc.stmt;
    exception when insufficient_privilege then v_state := 'refused';
    end;
    if v_state is null then
      raise exception 'ROLES CHECK FAILED: the admin can call %().', v_rpc.label;
    end if;
  end loop;

  -- export_my_data() is resolved from a verified phone; a staff session has
  -- none, so it is refused (P0001) and exports nothing.
  v_state := null;
  begin
    perform public.export_my_data();
  exception when others then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ROLES CHECK FAILED: the admin exported patient data.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Patient session: not business staff
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('roles_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('roles_check.claim_phone'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_state text;
  v_count integer;
begin
  if public.is_staff() or public.is_business_staff() then
    raise exception 'ROLES CHECK FAILED: the patient is treated as staff.';
  end if;

  select (select count(*) from public.inventory)
       + (select count(*) from public.inventory_movements)
       + (select count(*) from public.payments)
       + (select count(*) from public.services where id = current_setting('roles_check.service')::uuid)
    into v_count;
  if v_count <> 0 then
    raise exception 'ROLES CHECK FAILED: the patient reads % business row(s).', v_count;
  end if;

  begin
    perform public.adjust_stock(current_setting('roles_check.item')::uuid, 1, 'adjustment');
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ROLES CHECK FAILED: the patient can call adjust_stock().';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 5. anon: cannot even ask
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end $$;
set local role anon;

do $$
declare
  v_state text;
begin
  begin
    perform public.is_business_staff();
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ROLES CHECK FAILED: anon can execute is_business_staff().';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'ROLES CHECK PASSED: the doctor reads and writes clinical and business data; the admin reads inventory, services and payment amounts, adjusts stock and edits the catalog, but reads no patient, appointment, clinical, ARCO, consent, audit, agenda or other-profile row, sees no patient name next to a payment, cannot promote itself and cannot call record_payment, finalize_consultation, resolve_arco_request, anonymize_patient or export_my_data. All test data was rolled back.';
end $$;

rollback;
