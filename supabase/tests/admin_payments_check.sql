-- =============================================================================
-- Admin payments check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 26 objects, that:
--   * the doctor still reads payments directly, with the patient's name, and
--     also gets them through get_finance_payments();
--   * the admin reads ZERO payment rows directly, but get_finance_payments()
--     gives it each payment's date, status, method, amount, list price and
--     service name, and nothing else (no patient_id, appointment_id or note);
--   * a bad date range is refused;
--   * a patient and anon get nothing, directly or through the RPC;
--   * finalize_consultation() can no longer be called directly (doctor and
--     admin alike), while finalize_consultation_with_payment() still charges
--     and freezes the consultation in one call;
--   * no trigger function in public is executable by anon or authenticated.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, patient,
--     service, appointments, note, payments and audit rows are never
--     committed, pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The appointments_prevent_overlap trigger (migration 19) is disabled the
--     same way, so the fixture appointments cannot fail because a real
--     appointment or blocked slot overlaps them.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * ALTER TABLE ... DISABLE TRIGGER holds a lock on public.appointments until
--     the ROLLBACK. The script takes well under a second; run it off-hours.
--
-- Expected output: a single notice that starts with "ADMIN PAYMENTS CHECK PASSED".
-- Any "ADMIN PAYMENTS CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.get_finance_payments(timestamptz,timestamptz)') is null then
    raise exception 'ADMIN PAYMENTS CHECK ABORTED: migration 26 is not applied (get_finance_payments is missing). Nothing was changed.';
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
        'public.services'::regclass, 'public.payments'::regclass,
        'public.clinical_notes'::regclass, 'public.prescriptions'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'ADMIN PAYMENTS CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_phone   text := '+529990002601';
  v_user_d  uuid := gen_random_uuid();
  v_user_a  uuid := gen_random_uuid();
  v_user_p  uuid := gen_random_uuid();
  v_patient uuid;
  v_svc     uuid;
  v_appt_1  uuid;
  v_appt_2  uuid;
  v_appt_3  uuid;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) or exists (
    select 1 from auth.users where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'ADMIN PAYMENTS CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  -- on_auth_user_created provisions a 'patient' profile for each user.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'admin-payments-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'admin-payments-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone), null, '{}'::jsonb, '{}'::jsonb, now(), now());

  -- Migration 27: a patient session needs an auth user whose phone was
  -- confirmed by Auth (phone_confirmed_at). Harmless before migration 27.
  update auth.users set phone_confirmed_at = now()
   where id in (v_user_p) and phone is not null;

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, status)
  values ('ADMIN-PAYMENTS-CHECK', 'Patient', v_phone, 'active')
  returning id into v_patient;

  -- Inactive and uniquely named: only this script's payments are counted.
  insert into public.services (name, duration_mins, price, is_active)
  values ('ADMIN-PAYMENTS-CHECK service', 30, 5500, false)
  returning id into v_svc;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '41 days', 'confirmed')
  returning id into v_appt_1;
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '42 days', 'confirmed')
  returning id into v_appt_2;
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() + interval '43 days', 'confirmed')
  returning id into v_appt_3;

  perform set_config('admin_payments_check.user_d', v_user_d::text, true);
  perform set_config('admin_payments_check.user_a', v_user_a::text, true);
  perform set_config('admin_payments_check.user_p', v_user_p::text, true);
  perform set_config('admin_payments_check.patient', v_patient::text, true);
  perform set_config('admin_payments_check.appt_1', v_appt_1::text, true);
  perform set_config('admin_payments_check.appt_2', v_appt_2::text, true);
  perform set_config('admin_payments_check.appt_3', v_appt_3::text, true);
  perform set_config('admin_payments_check.claim_phone', public.normalize_phone(v_phone), true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor session: unchanged, plus the finalize path
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('admin_payments_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('admin_payments_check.patient')::uuid;
  v_appt_1  uuid := current_setting('admin_payments_check.appt_1')::uuid;
  v_appt_2  uuid := current_setting('admin_payments_check.appt_2')::uuid;
  v_appt_3  uuid := current_setting('admin_payments_check.appt_3')::uuid;
  v_row     public.payments;
  v_count   integer;
  v_state   text;
begin
  if not public.is_staff() then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the throwaway doctor is not clinical staff.';
  end if;

  perform public.record_payment(v_appt_1, 'paid', 5500, 'card', 'ADMIN-PAYMENTS-CHECK note');
  perform public.record_payment(v_appt_2, 'courtesy');

  -- 2a. Direct reads, with the patient's name.
  select count(*) into v_count
  from public.payments p
  join public.patients pt on pt.id = p.patient_id
  where p.appointment_id in (v_appt_1, v_appt_2)
    and pt.first_name = 'ADMIN-PAYMENTS-CHECK';
  if v_count <> 2 then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the doctor reads % named payment(s) directly, expected 2.', v_count;
  end if;

  -- 2b. The RPC answers the doctor too (business staff).
  select count(*) into v_count
  from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute') r
  where r.service_name = 'ADMIN-PAYMENTS-CHECK service';
  if v_count <> 2 then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: get_finance_payments() returned % row(s) to the doctor, expected 2.', v_count;
  end if;

  -- 2c. finalize_consultation() is no longer callable directly.
  v_state := null;
  begin
    perform public.finalize_consultation(v_appt_3);
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the doctor can still call finalize_consultation() directly.';
  end if;

  -- 2d. finalize_consultation_with_payment() still charges and freezes.
  insert into public.clinical_notes (appointment_id, patient_id, subjective, analysis, plan)
  values (v_appt_3, v_patient, 'ADMIN-PAYMENTS-CHECK note', 'ADMIN-PAYMENTS-CHECK diagnosis', 'ADMIN-PAYMENTS-CHECK plan');

  v_row := public.finalize_consultation_with_payment(v_appt_3, 'paid', 700, 'cash', null);
  if v_row.amount_charged <> 700 or v_row.status <> 'paid' then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: finalize_consultation_with_payment() stored % / %.',
      v_row.status, v_row.amount_charged;
  end if;
  if not exists (
    select 1 from public.clinical_notes
    where appointment_id = v_appt_3 and finalized_at is not null
  ) then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: finalize_consultation_with_payment() did not freeze the note.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin session: no direct rows, finance data through the RPC
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('admin_payments_check.user_a'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_appt_3 uuid := current_setting('admin_payments_check.appt_3')::uuid;
  v_count  integer;
  v_paid   numeric;
  v_forgone numeric;
  v_keys   text[];
  v_bad    text;
  v_state  text;
begin
  if public.is_staff() or not public.is_business_staff() then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the throwaway admin is not business-only staff.';
  end if;

  -- 3a. Zero rows directly: not even the bare ids.
  select count(*) into v_count from public.payments;
  if v_count <> 0 then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the admin reads % payment row(s) directly, expected 0.', v_count;
  end if;

  -- 3b. The RPC gives the three charges of the test service.
  select count(*),
         coalesce(sum(r.amount_charged) filter (where r.status = 'paid'), 0),
         coalesce(sum(r.list_price) filter (where r.status = 'courtesy'), 0)
    into v_count, v_paid, v_forgone
  from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute') r
  where r.service_name = 'ADMIN-PAYMENTS-CHECK service';
  if v_count <> 3 or v_paid <> 6200 or v_forgone <> 5500 then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the admin got % row(s), % paid and % forgone (expected 3, 6200, 5500).',
      v_count, v_paid, v_forgone;
  end if;

  if not exists (
    select 1
    from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute') r
    where r.service_name = 'ADMIN-PAYMENTS-CHECK service'
      and r.status = 'paid' and r.method = 'card' and r.amount_charged = 5500 and r.list_price = 5500
  ) or not exists (
    select 1
    from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute') r
    where r.service_name = 'ADMIN-PAYMENTS-CHECK service'
      and r.status = 'courtesy' and r.method is null and r.amount_charged = 0
  ) then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the admin''s rows do not carry status, method, amount and list price.';
  end if;

  -- 3c. Exactly the reviewed columns: no patient, appointment or note.
  select array(select k from jsonb_object_keys(to_jsonb(r)) as k order by k)
    into v_keys
  from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute') r
  where r.service_name = 'ADMIN-PAYMENTS-CHECK service'
  limit 1;
  if v_keys is distinct from array['amount_charged', 'created_at', 'id', 'list_price', 'method', 'service_name', 'status']::text[] then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: get_finance_payments() returns columns %.', v_keys;
  end if;

  select string_agg(distinct r.service_name, ', ') into v_bad
  from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute') r
  where r.service_name = 'ADMIN-PAYMENTS-CHECK service'
    and exists (select 1 from public.payments p where p.id = r.id);
  if v_bad is not null then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the admin can resolve a payment id returned by the RPC.';
  end if;

  -- 3d. A bad range is refused.
  v_state := null;
  begin
    perform * from public.get_finance_payments(now(), now() - interval '1 day');
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: an inverted range was not refused (state %).', v_state;
  end if;

  -- 3e. No direct finalize for the admin either.
  v_state := null;
  begin
    perform public.finalize_consultation(v_appt_3);
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the admin can call finalize_consultation().';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Patient session: nothing
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('admin_payments_check.user_p'),
    'role', 'authenticated',
    'phone', current_setting('admin_payments_check.claim_phone'))::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_count integer;
  v_state text;
begin
  select count(*) into v_count from public.payments;
  if v_count <> 0 then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the patient reads % payment row(s).', v_count;
  end if;

  begin
    perform * from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute');
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: the patient can call get_finance_payments().';
  end if;
end $$;

reset role;

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
  v_state text;
  v_count integer := 0;
begin
  begin
    perform * from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute');
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: anon can call get_finance_payments().';
  end if;

  begin
    select count(*) into v_count from public.payments;
  exception when insufficient_privilege then v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: anon reads % payment row(s).', v_count;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 6. Catalog: no trigger function is callable through the API
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'ADMIN PAYMENTS CHECK FAILED: trigger functions executable through the API: %.', v_bad;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'ADMIN PAYMENTS CHECK PASSED: the doctor reads payments directly with the patient''s name; the admin reads no payment row directly and gets date, status, method, amount, list price and service name (no patient, appointment or note) through get_finance_payments(); a bad range is refused; patients and anon get nothing; finalize_consultation() is not callable directly while finalize_consultation_with_payment() still charges and freezes the note; no trigger function is executable by anon or authenticated. All test data was rolled back.';
end $$;

rollback;
