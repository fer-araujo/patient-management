-- =============================================================================
-- Past visits check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 30 objects, that:
--   * the doctor records a visit that already happened: the appointment is
--     'completed' at that start, and its charge is stored with
--     received_at = the visit's start (not today); a courtesy is stored as 0
--     with no method; Finanzas (get_finance_payments, get_procedure_profit)
--     counts both on the visit's day and not today; no clinical note and no
--     inventory movement are written;
--   * it works in doctor-only mode;
--   * a start in the future, an overlap with an existing visit, an overlap
--     with a block, an archived patient, an anonymized patient and a bad
--     charge (paid with 0 or without a method) are refused, and a refused
--     charge leaves no appointment behind;
--   * the admin (not the doctor) cannot call it;
--   * a direct past INSERT and a move into the past are still refused by the
--     appointments_prevent_overlap trigger;
--   * received_at is not client-settable: authenticated cannot insert or
--     update payments, the owner cannot change it either (trigger, 42501), a
--     correction through record_payment() keeps it, and a normal charge gets
--     now().
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users,
--     patients, service, block, appointments, payments, the clinic_settings
--     change (doctor-only mode on) and audit rows are never committed, pass
--     or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so no WhatsApp can ever be sent.
--     The ROLLBACK re-enables it automatically. The overlap trigger stays ON:
--     it is part of what this script proves.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * The test days are a weekday 100 to 118 days AGO and one 100 to 118 days
--     ahead, each with no real appointment or block; the script aborts if
--     there is none.
--
-- Expected output: a single notice that starts with "PAST VISITS CHECK PASSED".
-- Any "PAST VISITS CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Migration 30 applied; no outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)') is null
     or to_regprocedure('public.payments_guard_received_at()') is null then
    raise exception 'PAST VISITS CHECK ABORTED: migration 30 is not applied. Nothing was changed.';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass and tgname = 'whatsapp_notifications'
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
        'public.blocked_slots'::regclass, 'public.clinic_settings'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'PAST VISITS CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_tz        text := 'America/Monterrey';
  v_user_d    uuid := gen_random_uuid();
  v_user_a    uuid := gen_random_uuid();
  v_today     date := (now() at time zone 'America/Monterrey')::date;
  v_past      date;
  v_future    date;
  v_patient   uuid;
  v_archived  uuid;
  v_anonym    uuid;
  v_svc       uuid;
  v_day       date;
begin
  -- A weekday 100-118 days ago and one 100-118 days ahead, both free.
  foreach v_day in array array[v_today - 100, v_today + 100] loop
    for i in 0..18 loop
      if extract(dow from v_day + (case when v_day < v_today then -i else i end)) not in (0, 6)
         and not exists (
           select 1 from public.appointments a
           where a.start_time >= ((v_day + (case when v_day < v_today then -i else i end))::timestamp) at time zone v_tz
             and a.start_time <  ((v_day + (case when v_day < v_today then -i else i end) + 1)::timestamp) at time zone v_tz
         ) and not exists (
           select 1 from public.blocked_slots b
           where b.start_time < ((v_day + (case when v_day < v_today then -i else i end) + 1)::timestamp) at time zone v_tz
             and b.end_time   > ((v_day + (case when v_day < v_today then -i else i end))::timestamp) at time zone v_tz
         ) then
        if v_day < v_today then
          v_past := v_day - i;
        else
          v_future := v_day + i;
        end if;
        exit;
      end if;
    end loop;
  end loop;
  if v_past is null or v_future is null then
    raise exception 'PAST VISITS CHECK ABORTED: no free weekday 100-118 days ago or ahead. Nothing was changed.';
  end if;

  -- Doctor-only mode ON: the staff RPC must not be blocked by it.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinic_settings'
      and column_name = 'doctor_only_mode'
  ) then
    execute 'update public.clinic_settings set doctor_only_mode = true where id is not null';
  end if;

  insert into auth.users (id, instance_id, aud, role, phone, email,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'past-visits-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'past-visits-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, status)
  values ('PAST-CHECK', 'Patient', null, 'active')
  returning id into v_patient;

  insert into public.patients (first_name, last_name, phone, status)
  values ('PAST-CHECK', 'Archived', null, 'archived')
  returning id into v_archived;

  insert into public.patients (first_name, last_name, phone, status, anonymized_at)
  values ('PAST-CHECK', 'Anonymized', null, 'archived', now())
  returning id into v_anonym;

  insert into public.services (name, duration_mins, price, is_active)
  values ('PAST-CHECK service', 30, 800, true)
  returning id into v_svc;

  -- A lunch block on the past day, 12:00-13:00.
  insert into public.blocked_slots (start_time, end_time, reason)
  values ((v_past + time '12:00') at time zone v_tz, (v_past + time '13:00') at time zone v_tz, 'comida');

  perform set_config('past_check.user_d', v_user_d::text, true);
  perform set_config('past_check.user_a', v_user_a::text, true);
  perform set_config('past_check.patient', v_patient::text, true);
  perform set_config('past_check.archived', v_archived::text, true);
  perform set_config('past_check.anonym', v_anonym::text, true);
  perform set_config('past_check.service', v_svc::text, true);
  perform set_config('past_check.past', v_past::text, true);
  perform set_config('past_check.future', v_future::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor: record past visits, refusals, direct writes, finance
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('past_check.user_d'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_tz        text := 'America/Monterrey';
  v_patient   uuid := current_setting('past_check.patient')::uuid;
  v_archived  uuid := current_setting('past_check.archived')::uuid;
  v_anonym    uuid := current_setting('past_check.anonym')::uuid;
  v_svc       uuid := current_setting('past_check.service')::uuid;
  v_past      date := current_setting('past_check.past')::date;
  v_future    date := current_setting('past_check.future')::date;
  v_from      timestamptz;
  v_to        timestamptz;
  v_paid      uuid;
  v_courtesy  uuid;
  v_future_id uuid;
  v_pay       public.payments;
  v_message   text;
  v_state     text;
  v_count     integer;
  v_profit    record;
begin
  v_from := (v_past::timestamp) at time zone v_tz;
  v_to   := ((v_past + 1)::timestamp) at time zone v_tz;

  -- A paid past visit at 10:00.
  v_paid := public.staff_record_past_visit(
    v_patient, v_svc, (v_past + time '10:00') at time zone v_tz, 'paid', 750, 'cash', 'PAST-CHECK note');

  if not exists (select 1 from public.appointments
                 where id = v_paid and status = 'completed'
                   and start_time = (v_past + time '10:00') at time zone v_tz) then
    raise exception 'PAST VISITS CHECK FAILED: the past visit is not completed at its start time.';
  end if;

  select * into v_pay from public.payments where appointment_id = v_paid;
  if v_pay.id is null
     or v_pay.status <> 'paid' or v_pay.amount_charged <> 750 or v_pay.method <> 'cash'
     or v_pay.list_price <> 800 or v_pay.note <> 'PAST-CHECK note'
     or v_pay.received_at <> (v_past + time '10:00') at time zone v_tz
     or v_pay.created_at <> now() then
    raise exception 'PAST VISITS CHECK FAILED: the paid charge is wrong or not dated to the visit (got: %).', row_to_json(v_pay);
  end if;

  -- A back-to-back courtesy at 10:30; an amount sent with it is stored as 0.
  v_courtesy := public.staff_record_past_visit(
    v_patient, v_svc, (v_past + time '10:30') at time zone v_tz, 'courtesy', 500, 'card', null);

  select * into v_pay from public.payments where appointment_id = v_courtesy;
  if v_pay.id is null
     or v_pay.status <> 'courtesy' or v_pay.amount_charged <> 0 or v_pay.method is not null
     or v_pay.received_at <> (v_past + time '10:30') at time zone v_tz then
    raise exception 'PAST VISITS CHECK FAILED: the courtesy is wrong or not dated to the visit (got: %).', row_to_json(v_pay);
  end if;

  -- No clinical note and no supplies for a backfilled visit.
  if exists (select 1 from public.clinical_notes where appointment_id in (v_paid, v_courtesy))
     or exists (select 1 from public.inventory_movements where appointment_id in (v_paid, v_courtesy)) then
    raise exception 'PAST VISITS CHECK FAILED: a past visit wrote a clinical note or an inventory movement.';
  end if;

  -- Refusals. Each one must leave no appointment at that time.
  v_message := null;
  begin
    perform public.staff_record_past_visit(v_patient, v_svc, now() + interval '1 hour', 'paid', 100, 'cash', null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Una cita pasada debe tener una fecha y hora que ya pasaron.' then
    raise exception 'PAST VISITS CHECK FAILED: a future start was not refused (got: %).', v_message;
  end if;

  v_message := null;
  begin
    perform public.staff_record_past_visit(v_patient, v_svc, (v_past + time '10:15') at time zone v_tz, 'paid', 100, 'cash', null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Ya hay una cita o un bloqueo en ese horario. Revisa la hora.' then
    raise exception 'PAST VISITS CHECK FAILED: an overlap with an existing visit was not refused (got: %).', v_message;
  end if;

  v_message := null;
  begin
    perform public.staff_record_past_visit(v_patient, v_svc, (v_past + time '12:15') at time zone v_tz, 'paid', 100, 'cash', null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Ya hay una cita o un bloqueo en ese horario. Revisa la hora.' then
    raise exception 'PAST VISITS CHECK FAILED: an overlap with a block was not refused (got: %).', v_message;
  end if;

  foreach v_state in array array[v_archived::text, v_anonym::text] loop
    v_message := null;
    begin
      perform public.staff_record_past_visit(v_state::uuid, v_svc, (v_past + time '15:00') at time zone v_tz, 'paid', 100, 'cash', null);
    exception when others then v_message := sqlerrm;
    end;
    if v_message is distinct from 'Este paciente está archivado. Restáuralo desde el Directorio de Pacientes para registrarle una cita.' then
      raise exception 'PAST VISITS CHECK FAILED: an archived or anonymized patient was not refused (got: %).', v_message;
    end if;
  end loop;

  v_message := null;
  begin
    perform public.staff_record_past_visit(v_patient, v_svc, (v_past + time '16:00') at time zone v_tz, 'paid', 0, 'cash', null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Indica cuánto cobraste (más de 0).' then
    raise exception 'PAST VISITS CHECK FAILED: a paid visit with 0 was not refused by record_payment (got: %).', v_message;
  end if;

  v_message := null;
  begin
    perform public.staff_record_past_visit(v_patient, v_svc, (v_past + time '16:00') at time zone v_tz, 'paid', 100, null, null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Indica cómo te pagaron (efectivo, tarjeta o transferencia).' then
    raise exception 'PAST VISITS CHECK FAILED: a paid visit without a method was not refused (got: %).', v_message;
  end if;

  select count(*) into v_count
  from public.appointments
  where patient_id in (v_patient, v_archived, v_anonym);
  if v_count <> 2 then
    raise exception 'PAST VISITS CHECK FAILED: a refused call left an appointment behind (% rows, expected 2).', v_count;
  end if;

  -- The trigger still refuses the past for every other write path.
  foreach v_state in array array['completed', 'confirmed'] loop
    v_message := null;
    begin
      insert into public.appointments (patient_id, service_id, start_time, status)
      values (v_patient, v_svc, (v_past + time '14:00') at time zone v_tz, v_state);
    exception when others then v_message := sqlerrm;
    end;
    if v_message is distinct from 'La fecha y hora seleccionadas ya no están disponibles.' then
      raise exception 'PAST VISITS CHECK FAILED: a direct % insert in the past was not refused by the trigger (got: %).', v_state, v_message;
    end if;
  end loop;

  v_message := null;
  begin
    update public.appointments
       set start_time = (v_past + time '15:00') at time zone v_tz
     where id = v_paid;
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'La fecha y hora seleccionadas ya no están disponibles.' then
    raise exception 'PAST VISITS CHECK FAILED: moving a past visit to another past time was not refused (got: %).', v_message;
  end if;

  -- received_at is not writable by the API role.
  v_state := null;
  begin
    update public.payments set received_at = now() where appointment_id = v_paid;
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'PAST VISITS CHECK FAILED: authenticated could update payments.received_at (%).', v_state;
  end if;

  v_state := null;
  begin
    insert into public.payments (appointment_id, status, amount_charged, method, received_at)
    values (v_courtesy, 'paid', 1, 'cash', now() - interval '1 year');
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'PAST VISITS CHECK FAILED: authenticated could insert a payment (%).', v_state;
  end if;

  -- "Editar cobro" on a past visit keeps its date.
  perform public.record_payment(v_paid, 'paid', 900, 'card', null);
  if (select received_at from public.payments where appointment_id = v_paid)
       <> (v_past + time '10:00') at time zone v_tz then
    raise exception 'PAST VISITS CHECK FAILED: a correction through record_payment() changed received_at.';
  end if;

  -- A normal booking charged now is dated now.
  v_future_id := public.staff_create_appointment(v_patient, v_svc, (v_future + time '09:00') at time zone v_tz);
  perform public.record_payment(v_future_id, 'paid', 300, 'transfer', null);
  if (select received_at from public.payments where appointment_id = v_future_id) <> now() then
    raise exception 'PAST VISITS CHECK FAILED: a normal charge did not get received_at = now().';
  end if;

  -- Finanzas counts the past visits on their day, not today.
  select count(*) into v_count
  from public.get_finance_payments(v_from, v_to) r
  where r.created_at in ((v_past + time '10:00') at time zone v_tz, (v_past + time '10:30') at time zone v_tz);
  if v_count <> 2 then
    raise exception 'PAST VISITS CHECK FAILED: get_finance_payments() does not return both past visits on their day (% rows).', v_count;
  end if;

  select count(*) into v_count
  from public.get_finance_payments(now() - interval '1 minute', now() + interval '1 minute') r
  where r.created_at < v_to;
  if v_count <> 0 then
    raise exception 'PAST VISITS CHECK FAILED: get_finance_payments() returns past visits today.';
  end if;

  select * into v_profit
  from public.get_procedure_profit(v_from, v_to) r
  where r.service_id = v_svc;
  if v_profit is null
     or v_profit.times <> 2 or v_profit.charged <> 900 or v_profit.courtesy_value <> 800
     or v_profit.supplies_cost <> 0 or v_profit.unrecorded_consultations <> 0 then
    raise exception 'PAST VISITS CHECK FAILED: get_procedure_profit() for the past day is wrong (got: %).', row_to_json(v_profit);
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin: not the doctor, refused
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('past_check.user_a'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_tz      text := 'America/Monterrey';
  v_patient uuid := current_setting('past_check.patient')::uuid;
  v_svc     uuid := current_setting('past_check.service')::uuid;
  v_past    date := current_setting('past_check.past')::date;
  v_state   text;
begin
  v_state := null;
  begin
    perform public.staff_record_past_visit(v_patient, v_svc, (v_past + time '17:00') at time zone v_tz, 'paid', 100, 'cash', null);
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'PAST VISITS CHECK FAILED: the admin could record a past visit (%).', v_state;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Owner: even the SQL editor cannot change received_at
-- -----------------------------------------------------------------------------
do $$
declare
  v_patient uuid := current_setting('past_check.patient')::uuid;
  v_state   text;
begin
  perform set_config('request.jwt.claims', '', true);

  v_state := null;
  begin
    update public.payments set received_at = now() where patient_id = v_patient;
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'PAST VISITS CHECK FAILED: the owner could change payments.received_at (%).', v_state;
  end if;

  if has_function_privilege('anon', 'public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.assert_slot_free_at(timestamptz,integer,uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.payments_guard_received_at()', 'execute') then
    raise exception 'PAST VISITS CHECK FAILED: a migration 30 function has the wrong grants.';
  end if;

  raise notice 'PAST VISITS CHECK PASSED: the doctor records a completed past visit with its charge dated to the visit (paid and courtesy), in doctor-only mode, with no note or supplies, and Finanzas counts it on that day; a future start, an overlap with a visit or a block, archived and anonymized patients and a bad charge are refused without leaving an appointment; the admin cannot call it; direct past inserts and moves are still refused; received_at cannot be set by the API or changed even by the owner, survives a correction and is now() for a normal charge. All test data was rolled back.';
end $$;

rollback;
