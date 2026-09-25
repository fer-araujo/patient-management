-- =============================================================================
-- Finance check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 17 objects, that:
--   * staff can record a paid consultation through record_payment(), and the
--     server fills patient, service and list price from the appointment;
--   * recording again for the same appointment CORRECTS the charge (one row
--     per appointment) and keeps the original list price;
--   * a courtesy is stored as amount 0 with no method, keeping the list price;
--   * record_payment() refuses a paid charge of 0 or without a method;
--   * nobody can INSERT into payments directly through the API, not even staff;
--   * a patient reads ZERO payments and cannot call record_payment();
--   * anon reads nothing and cannot call record_payment();
--   * the table's own checks reject inconsistent rows even for the table owner.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, patient,
--     service, appointments, payments and audit rows are never committed,
--     pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * ALTER TABLE ... DISABLE TRIGGER holds a lock on public.appointments until
--     the ROLLBACK. The script takes well under a second; run it off-hours.
--
-- Expected output: a single notice that starts with "FINANCE CHECK PASSED".
-- Any "FINANCE CHECK FAILED: ..." error names the exact rule that broke.
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
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgrelid in (
        'public.appointments'::regclass, 'public.patients'::regclass,
        'public.services'::regclass, 'public.payments'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'FINANCE CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_phone    text := '+529990000201';
  v_user_p   uuid := gen_random_uuid();
  v_user_s   uuid := gen_random_uuid();
  v_patient  uuid;
  v_svc      uuid;
  v_appt_1   uuid;
  v_appt_2   uuid;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) or exists (
    select 1 from auth.users where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'FINANCE CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  -- on_auth_user_created provisions a 'patient' profile for each user.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone), null, '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'finance-check-staff-' || v_user_s || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_s;

  insert into public.patients (first_name, last_name, phone, status)
  values ('FINANCE-CHECK', 'Patient', v_phone, 'active')
  returning id into v_patient;

  insert into public.services (name, duration_mins, price, is_active)
  values ('FINANCE-CHECK service', 30, 800, false)
  returning id into v_svc;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '40 days', 'confirmed')
  returning id into v_appt_1;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '41 days', 'confirmed')
  returning id into v_appt_2;

  perform set_config('finance_check.user_p', v_user_p::text, true);
  perform set_config('finance_check.user_s', v_user_s::text, true);
  perform set_config('finance_check.patient', v_patient::text, true);
  perform set_config('finance_check.service', v_svc::text, true);
  perform set_config('finance_check.appt_1', v_appt_1::text, true);
  perform set_config('finance_check.appt_2', v_appt_2::text, true);
  perform set_config('finance_check.claim_phone', public.normalize_phone(v_phone), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Staff session (authenticated doctor)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('finance_check.user_s'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_appt_1   uuid := current_setting('finance_check.appt_1')::uuid;
  v_appt_2   uuid := current_setting('finance_check.appt_2')::uuid;
  v_patient  uuid := current_setting('finance_check.patient')::uuid;
  v_svc      uuid := current_setting('finance_check.service')::uuid;
  v_row      public.payments;
  v_first_id uuid;
  v_count    integer;
  v_refused  boolean;
begin
  if not public.is_staff() then
    raise exception 'FINANCE CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- 2a. A paid consultation; patient, service and list price come from the server.
  v_row := public.record_payment(v_appt_1, 'paid', 800, 'card', 'Primera consulta');
  if v_row.status <> 'paid' or v_row.amount_charged <> 800.00 or v_row.method <> 'card'
     or v_row.patient_id is distinct from v_patient or v_row.service_id is distinct from v_svc
     or v_row.list_price is distinct from 800.00 then
    raise exception 'FINANCE CHECK FAILED: paid charge stored as % / % / % / patient % / service % / list %.',
      v_row.status, v_row.amount_charged, v_row.method, v_row.patient_id, v_row.service_id, v_row.list_price;
  end if;
  v_first_id := v_row.id;

  -- 2b. A correction updates the same row and keeps the original list price.
  update public.services set price = 900 where id = v_svc;
  v_row := public.record_payment(v_appt_1, 'paid', 750.004, 'cash', null);
  select count(*) into v_count from public.payments where appointment_id = v_appt_1;
  if v_count <> 1 or v_row.id <> v_first_id or v_row.amount_charged <> 750.00
     or v_row.method <> 'cash' or v_row.list_price <> 800.00 or v_row.note is not null then
    raise exception 'FINANCE CHECK FAILED: correction gave % row(s), amount %, method %, list %.',
      v_count, v_row.amount_charged, v_row.method, v_row.list_price;
  end if;

  -- 2c. A courtesy is amount 0 with no method, whatever the caller sent.
  v_row := public.record_payment(v_appt_2, 'courtesy', 500, 'card', 'Familiar');
  if v_row.status <> 'courtesy' or v_row.amount_charged <> 0 or v_row.method is not null
     or v_row.list_price <> 900.00 then
    raise exception 'FINANCE CHECK FAILED: courtesy stored as amount % / method % / list %.',
      v_row.amount_charged, v_row.method, v_row.list_price;
  end if;

  -- 2d. A paid charge of 0, or without a method, is refused.
  v_refused := false;
  begin
    perform public.record_payment(v_appt_2, 'paid', 0, 'cash');
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'FINANCE CHECK FAILED: a paid charge of 0 was accepted.';
  end if;

  v_refused := false;
  begin
    perform public.record_payment(v_appt_2, 'paid', 100, null);
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'FINANCE CHECK FAILED: a paid charge without a method was accepted.';
  end if;

  -- The refused calls changed nothing.
  select * into v_row from public.payments where appointment_id = v_appt_2;
  if v_row.status <> 'courtesy' then
    raise exception 'FINANCE CHECK FAILED: a refused call changed the courtesy to %.', v_row.status;
  end if;

  -- 2e. Staff cannot write the table directly.
  v_refused := false;
  begin
    insert into public.payments (appointment_id, status, amount_charged, method)
    values (v_appt_2, 'paid', 1, 'cash');
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then
    raise exception 'FINANCE CHECK FAILED: staff inserted a payment directly.';
  end if;

  v_refused := false;
  begin
    delete from public.payments where appointment_id = v_appt_1;
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then
    raise exception 'FINANCE CHECK FAILED: staff deleted a payment directly.';
  end if;

  -- 2f. Staff reads both rows, and each write left an audit entry.
  select count(*) into v_count from public.payments where appointment_id in (v_appt_1, v_appt_2);
  if v_count <> 2 then
    raise exception 'FINANCE CHECK FAILED: staff sees % payments, expected 2.', v_count;
  end if;

  select count(*) into v_count from public.audit_log
  where table_name = 'payments' and patient_id = v_patient;
  if v_count <> 3 then
    raise exception 'FINANCE CHECK FAILED: % audit entries for the 3 payment writes.', v_count;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Patient session (authenticated, phone claim of the test patient)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('finance_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('finance_check.claim_phone'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_count  integer;
  v_denied boolean := false;
begin
  if public.is_staff() then
    raise exception 'FINANCE CHECK FAILED: the test patient is treated as staff.';
  end if;

  -- Not even their own consultations' payments.
  select count(*) into v_count from public.payments;
  if v_count <> 0 then
    raise exception 'FINANCE CHECK FAILED: a patient reads % payments.', v_count;
  end if;

  begin
    perform public.record_payment(current_setting('finance_check.appt_1')::uuid, 'courtesy');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'FINANCE CHECK FAILED: a patient can call record_payment().';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. anon (public API key, no user)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end $$;
set local role anon;

do $$
declare
  v_count  integer;
  v_denied boolean := false;
begin
  begin
    select count(*) into v_count from public.payments;
  exception when insufficient_privilege then v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'FINANCE CHECK FAILED: anon reads % payments.', v_count;
  end if;

  begin
    perform public.record_payment(current_setting('finance_check.appt_1')::uuid, 'courtesy');
  exception
    when insufficient_privilege then v_denied := true;
    when others then v_denied := false;
  end;
  if not v_denied then
    raise exception 'FINANCE CHECK FAILED: anon can execute record_payment().';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 5. The table's checks reject inconsistent rows, even for the owner
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_appt_1  uuid := current_setting('finance_check.appt_1')::uuid;
  v_patient uuid := current_setting('finance_check.patient')::uuid;
  v_svc     uuid := current_setting('finance_check.service')::uuid;
  v_appt_x  uuid;
  v_case    record;
  v_state   text;
begin
  -- A fresh appointment so only the CHECK under test can fail (not the unique key).
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '42 days', 'confirmed')
  returning id into v_appt_x;

  for v_case in
    select * from (values
      ('paid with amount 0',        'paid',     0::numeric,   'cash'),
      ('paid without a method',     'paid',     100::numeric, null),
      ('courtesy with an amount',   'courtesy', 100::numeric, null),
      ('courtesy with a method',    'courtesy', 0::numeric,   'cash'),
      ('unknown method',            'paid',     100::numeric, 'bitcoin'),
      ('unknown status',            'refund',   100::numeric, 'cash'),
      ('negative amount',           'paid',     -5::numeric,  'cash')
    ) as t(label, status, amount, method)
  loop
    v_state := null;
    begin
      insert into public.payments (appointment_id, status, amount_charged, method)
      values (v_appt_x, v_case.status, v_case.amount, v_case.method);
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state is null then
      raise exception 'FINANCE CHECK FAILED: the table accepted a row with %.', v_case.label;
    end if;
  end loop;

  v_state := null;
  begin
    insert into public.payments (appointment_id, status, amount_charged, method)
    values (v_appt_1, 'courtesy', 0, null);
  exception when unique_violation then v_state := 'rejected';
  end;
  if v_state is null then
    raise exception 'FINANCE CHECK FAILED: a second payment for the same appointment was accepted.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'FINANCE CHECK PASSED: staff record and correct charges only through record_payment(), courtesies are free and keep their list price, patients and anon read nothing, and the table rejects inconsistent rows. All test data was rolled back.';
end $$;

rollback;
