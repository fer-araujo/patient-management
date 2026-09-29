-- =============================================================================
-- Service supplies check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 22 objects, that:
--   * set_service_supplies() saves, updates, merges and removes the supplies
--     of a service, and refuses a zero quantity or a cost;
--   * "Finalizar Consulta" with supplies decrements the stock and snapshots
--     each supply's cost on the server (weighted average of its purchases;
--     null when it was never purchased); a later purchase does not rewrite a
--     past snapshot;
--   * not enough stock rolls back EVERYTHING: the note stays open, no payment
--     and no movement is left, and no stock changes;
--   * a client cannot inject a cost: a supply carrying unit_cost/total_cost is
--     refused, a manual 'use' with a cost is refused, and staff cannot insert
--     movements directly;
--   * supplies are recorded once per consultation, and the consultation is
--     marked (clinical_notes.supplies_recorded_at) also when the confirmed
--     list is EMPTY; a finalize without the supplies step leaves it unmarked;
--   * record_consultation_supplies() ("Registrar insumos") works once for a
--     finalized, unmarked consultation: it lowers the stock and snapshots the
--     cost; it refuses a consultation that is not finalized and a second call;
--   * the marker cannot be changed directly;
--   * the admin reads and writes service_supplies and reads the per-procedure
--     profit, but still reads no appointment, patient or clinical note, and
--     cannot finalize a consultation;
--   * get_procedure_profit() adds up: times, charged, courtesies, supplies,
--     supplies without a cost, profit, and consultations without recorded
--     supplies, per service;
--   * anon cannot read service_supplies or call the new RPCs;
--   * the ledger still matches the stock and every service_supplies write is
--     audited.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, patient,
--     services, inventory items, appointments, notes, payments, movements and
--     audit rows are never committed, pass or fail.
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
-- Expected output: a single notice that starts with "SUPPLIES CHECK PASSED".
-- Any "SUPPLIES CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects, migration 22 applied
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.service_supplies') is null
     or to_regprocedure('public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)') is null
     or to_regprocedure('public.get_procedure_profit(timestamptz,timestamptz)') is null then
    raise exception 'SUPPLIES CHECK ABORTED: migration 22 is not applied (service_supplies or its RPCs are missing).';
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
        'public.inventory'::regclass, 'public.inventory_movements'::regclass,
        'public.service_supplies'::regclass, 'public.clinical_notes'::regclass,
        'public.prescriptions'::regclass, 'public.profiles'::regclass,
        'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'SUPPLIES CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- Services: A (price 1000) and B (price 500).
-- Items: S ("Sculptra", starts empty; bought by the doctor below) and
--        J ("Jeringas", 10 units of initial stock, never purchased -> no cost).
-- Appointments: 1 (A, paid + S and J), 2 (A, courtesy + S), 3 (B, paid,
-- supplies step skipped, then "Registrar insumos" + S), 4 (A, not enough
-- stock), 5 (B, cost injection, then paid + S), 6 (A, not finalized at first,
-- then paid with an EMPTY supplies list).
do $$
declare
  v_phone   text := '+529990000601';
  v_user_d  uuid := gen_random_uuid();
  v_user_a  uuid := gen_random_uuid();
  v_patient uuid;
  v_svc_a   uuid;
  v_svc_b   uuid;
  v_item_s  uuid;
  v_item_j  uuid;
  v_appt    uuid;
  i         integer;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) or exists (
    select 1 from auth.users where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'SUPPLIES CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  -- on_auth_user_created provisions a 'patient' profile for each user.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'supplies-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'supplies-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, status)
  values ('SUPPLIES-CHECK', 'Patient', v_phone, 'active')
  returning id into v_patient;

  insert into public.services (name, duration_mins, price, is_active)
  values ('SUPPLIES-CHECK service A', 30, 1000, false)
  returning id into v_svc_a;

  insert into public.services (name, duration_mins, price, is_active)
  values ('SUPPLIES-CHECK service B', 30, 500, false)
  returning id into v_svc_b;

  insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, is_active)
  values ('SUPPLIES-CHECK Sculptra', 'Otro', 0, 1, 'viales', true)
  returning id into v_item_s;

  -- Initial stock 10 becomes a cost-less "Inventario inicial" movement.
  insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, is_active)
  values ('SUPPLIES-CHECK Jeringas', 'Otro', 10, 1, 'piezas', true)
  returning id into v_item_j;

  for i in 1..6 loop
    insert into public.appointments (patient_id, service_id, start_time, status)
    values (v_patient, case when i in (3, 5) then v_svc_b else v_svc_a end,
            now() + make_interval(days => 3200 + i), 'confirmed')
    returning id into v_appt;
    perform set_config('supplies_check.appt_' || i, v_appt::text, true);
  end loop;

  perform set_config('supplies_check.user_d', v_user_d::text, true);
  perform set_config('supplies_check.user_a', v_user_a::text, true);
  perform set_config('supplies_check.patient', v_patient::text, true);
  perform set_config('supplies_check.svc_a', v_svc_a::text, true);
  perform set_config('supplies_check.svc_b', v_svc_b::text, true);
  perform set_config('supplies_check.item_s', v_item_s::text, true);
  perform set_config('supplies_check.item_j', v_item_j::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor session
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('supplies_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('supplies_check.patient')::uuid;
  v_svc_a   uuid := current_setting('supplies_check.svc_a')::uuid;
  v_svc_b   uuid := current_setting('supplies_check.svc_b')::uuid;
  v_item_s  uuid := current_setting('supplies_check.item_s')::uuid;
  v_item_j  uuid := current_setting('supplies_check.item_j')::uuid;
  v_appt_1  uuid := current_setting('supplies_check.appt_1')::uuid;
  v_appt_2  uuid := current_setting('supplies_check.appt_2')::uuid;
  v_appt_3  uuid := current_setting('supplies_check.appt_3')::uuid;
  v_appt_4  uuid := current_setting('supplies_check.appt_4')::uuid;
  v_appt_5  uuid := current_setting('supplies_check.appt_5')::uuid;
  v_appt_6  uuid := current_setting('supplies_check.appt_6')::uuid;
  v_n       integer;
  v_stock   integer;
  v_state   text;
  v_msg     text;
  v_mov     record;
  v_row     public.payments;
begin
  if not public.is_staff() then
    raise exception 'SUPPLIES CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- 2a. Catalog: save, update, remove, merge; refuse zero and a cost.
  v_n := public.set_service_supplies(v_svc_a, jsonb_build_array(
    jsonb_build_object('item_id', v_item_s, 'quantity', 1),
    jsonb_build_object('item_id', v_item_j, 'quantity', 2)));
  if v_n <> 2 then
    raise exception 'SUPPLIES CHECK FAILED: service A has % supplies after saving 2.', v_n;
  end if;

  v_n := public.set_service_supplies(v_svc_a, jsonb_build_array(
    jsonb_build_object('item_id', v_item_s, 'quantity', 1),
    jsonb_build_object('item_id', v_item_j, 'quantity', 3)));
  if (select quantity from public.service_supplies where service_id = v_svc_a and item_id = v_item_j) <> 3 then
    raise exception 'SUPPLIES CHECK FAILED: changing a quantity to 3 was not saved.';
  end if;

  v_n := public.set_service_supplies(v_svc_a, jsonb_build_array(
    jsonb_build_object('item_id', v_item_s, 'quantity', 1)));
  if v_n <> 1 or exists (select 1 from public.service_supplies where service_id = v_svc_a and item_id = v_item_j) then
    raise exception 'SUPPLIES CHECK FAILED: a removed supply is still linked to service A.';
  end if;

  -- The same item twice is merged into one line.
  v_n := public.set_service_supplies(v_svc_b, jsonb_build_array(
    jsonb_build_object('item_id', v_item_j, 'quantity', 1),
    jsonb_build_object('item_id', v_item_j, 'quantity', 1)));
  if v_n <> 1 or (select quantity from public.service_supplies where service_id = v_svc_b) <> 2 then
    raise exception 'SUPPLIES CHECK FAILED: a repeated item was not merged into one line of 2.';
  end if;

  v_state := null;
  begin
    perform public.set_service_supplies(v_svc_a, jsonb_build_array(
      jsonb_build_object('item_id', v_item_s, 'quantity', 0)));
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'SUPPLIES CHECK FAILED: a supply quantity of 0 was accepted.';
  end if;

  v_state := null;
  begin
    perform public.set_service_supplies(v_svc_a, jsonb_build_array(
      jsonb_build_object('item_id', v_item_s, 'quantity', 1, 'unit_cost', 5)));
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'SUPPLIES CHECK FAILED: a catalog supply carrying a cost was accepted.';
  end if;

  -- 2b. Buy S: 2 for 1000 and 2 for 1400 -> 4 units, average 600.
  perform public.adjust_stock(v_item_s, 2, 'purchase', 1000);
  perform public.adjust_stock(v_item_s, 2, 'purchase', 1400);

  insert into public.clinical_notes (appointment_id, patient_id, analysis, plan)
  select a, v_patient, 'Diagnóstico', 'Plan'
  from unnest(array[v_appt_1, v_appt_2, v_appt_3, v_appt_4, v_appt_5, v_appt_6]) a;

  -- 2c. Finalize with supplies: stock goes down, the cost is a server snapshot.
  v_row := public.finalize_consultation_with_payment(
    v_appt_1, 'paid', 1000, 'cash', null,
    jsonb_build_array(
      jsonb_build_object('item_id', v_item_s, 'quantity', 1),
      jsonb_build_object('item_id', v_item_j, 'quantity', 2)));

  if v_row.status <> 'paid' or v_row.amount_charged <> 1000.00 then
    raise exception 'SUPPLIES CHECK FAILED: the charge of appointment 1 was stored as % / %.', v_row.status, v_row.amount_charged;
  end if;
  if exists (select 1 from public.clinical_notes where appointment_id = v_appt_1 and finalized_at is null) then
    raise exception 'SUPPLIES CHECK FAILED: appointment 1 was not finalized.';
  end if;
  if exists (select 1 from public.clinical_notes where appointment_id = v_appt_1 and supplies_recorded_at is null) then
    raise exception 'SUPPLIES CHECK FAILED: finalizing with supplies did not mark appointment 1 as recorded.';
  end if;

  select stock_quantity into v_stock from public.inventory where id = v_item_s;
  if v_stock <> 3 then
    raise exception 'SUPPLIES CHECK FAILED: S has % units after using 1 of 4, expected 3.', v_stock;
  end if;
  select stock_quantity into v_stock from public.inventory where id = v_item_j;
  if v_stock <> 8 then
    raise exception 'SUPPLIES CHECK FAILED: J has % units after using 2 of 10, expected 8.', v_stock;
  end if;

  select * into v_mov from public.inventory_movements
  where appointment_id = v_appt_1 and item_id = v_item_s;
  if v_mov.type <> 'use' or v_mov.quantity <> -1
     or v_mov.unit_cost is distinct from 600.00 or v_mov.total_cost is distinct from 600.00 then
    raise exception 'SUPPLIES CHECK FAILED: S on appointment 1 recorded % % at % / %, expected use -1 at 600.00 / 600.00.',
      v_mov.type, v_mov.quantity, v_mov.unit_cost, v_mov.total_cost;
  end if;

  select * into v_mov from public.inventory_movements
  where appointment_id = v_appt_1 and item_id = v_item_j;
  if v_mov.quantity <> -2 or v_mov.unit_cost is not null or v_mov.total_cost is not null then
    raise exception 'SUPPLIES CHECK FAILED: J (never purchased) on appointment 1 recorded % at % / %, expected -2 with no cost.',
      v_mov.quantity, v_mov.unit_cost, v_mov.total_cost;
  end if;

  -- A later purchase (1 for 900 -> average 660) never rewrites that snapshot.
  perform public.adjust_stock(v_item_s, 1, 'purchase', 900);
  if (select total_cost from public.inventory_movements
      where appointment_id = v_appt_1 and item_id = v_item_s) <> 600.00 then
    raise exception 'SUPPLIES CHECK FAILED: a later purchase changed the cost snapshot of appointment 1.';
  end if;

  -- 2d. Not enough stock (S has 4) rolls back the note, the payment and every
  --     movement, including a supply that did fit (J).
  v_state := null;
  begin
    perform public.finalize_consultation_with_payment(
      v_appt_4, 'paid', 1000, 'card', null,
      jsonb_build_array(
        jsonb_build_object('item_id', v_item_j, 'quantity', 1),
        jsonb_build_object('item_id', v_item_s, 'quantity', 5)));
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001' or v_msg not like 'Solo hay 4 de %' then
    raise exception 'SUPPLIES CHECK FAILED: using 5 of 4 units was not refused cleanly (% / %).', v_state, v_msg;
  end if;
  if exists (select 1 from public.clinical_notes where appointment_id = v_appt_4 and finalized_at is not null)
     or exists (select 1 from public.payments where appointment_id = v_appt_4)
     or exists (select 1 from public.inventory_movements where appointment_id = v_appt_4)
     or exists (select 1 from public.clinical_notes where appointment_id = v_appt_4 and supplies_recorded_at is not null)
     or (select stock_quantity from public.inventory where id = v_item_s) <> 4
     or (select stock_quantity from public.inventory where id = v_item_j) <> 8 then
    raise exception 'SUPPLIES CHECK FAILED: a refused finalization left a frozen note, a payment, a movement or a stock change.';
  end if;

  -- 2e. A client cannot inject a cost.
  v_state := null;
  begin
    perform public.finalize_consultation_with_payment(
      v_appt_5, 'paid', 300, 'cash', null,
      jsonb_build_array(jsonb_build_object(
        'item_id', v_item_s, 'quantity', 1, 'unit_cost', 0.01, 'total_cost', 0)));
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001'
     or exists (select 1 from public.payments where appointment_id = v_appt_5)
     or exists (select 1 from public.inventory_movements where appointment_id = v_appt_5) then
    raise exception 'SUPPLIES CHECK FAILED: a supply carrying a cost was accepted or left data behind.';
  end if;

  v_state := null;
  begin
    perform public.adjust_stock(v_item_s, -1, 'use', 0.01);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' then
    raise exception 'SUPPLIES CHECK FAILED: a manual use with a cost was accepted.';
  end if;

  v_state := null;
  begin
    insert into public.inventory_movements (item_id, type, quantity, unit_cost, total_cost, appointment_id)
    values (v_item_s, 'use', -1, 0.01, 0.01, v_appt_5);
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'SUPPLIES CHECK FAILED: staff inserted a costed movement directly.';
  end if;

  -- The same consultation without the injected cost: the server's average
  -- (3300 / 5 = 660) is stored.
  perform public.finalize_consultation_with_payment(
    v_appt_5, 'paid', 300, 'cash', null,
    jsonb_build_array(jsonb_build_object('item_id', v_item_s, 'quantity', 1)));
  select * into v_mov from public.inventory_movements where appointment_id = v_appt_5;
  if v_mov.unit_cost is distinct from 660.00 or v_mov.total_cost is distinct from 660.00 then
    raise exception 'SUPPLIES CHECK FAILED: appointment 5 stored cost % / %, expected the server average 660.00.',
      v_mov.unit_cost, v_mov.total_cost;
  end if;

  -- 2f. A courtesy with supplies, and a charge with no supplies through the
  --     five-argument call the previous frontend used.
  perform public.finalize_consultation_with_payment(
    v_appt_2, 'courtesy', null, null, 'Familiar',
    jsonb_build_array(jsonb_build_object('item_id', v_item_s, 'quantity', 1)));
  perform public.finalize_consultation_with_payment(v_appt_3, 'paid', 500, 'card', null);

  if exists (select 1 from public.inventory_movements where appointment_id = v_appt_3) then
    raise exception 'SUPPLIES CHECK FAILED: a consultation without supplies recorded a movement.';
  end if;
  -- No supplies step (p_supplies null): the consultation stays pending.
  if exists (select 1 from public.clinical_notes where appointment_id = v_appt_3 and supplies_recorded_at is not null) then
    raise exception 'SUPPLIES CHECK FAILED: a finalize without the supplies step marked appointment 3 as recorded.';
  end if;

  -- 2g. Supplies are recorded once per consultation.
  v_state := null;
  begin
    perform public.finalize_consultation_with_payment(
      v_appt_1, 'paid', 1000, 'cash', null,
      jsonb_build_array(jsonb_build_object('item_id', v_item_j, 'quantity', 1)));
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' or (select stock_quantity from public.inventory where id = v_item_j) <> 8 then
    raise exception 'SUPPLIES CHECK FAILED: supplies of an already finalized consultation were discounted twice.';
  end if;

  -- 2h. Final stock and the ledger.
  if (select stock_quantity from public.inventory where id = v_item_s) <> 2 then
    raise exception 'SUPPLIES CHECK FAILED: S ended with % units, expected 2.',
      (select stock_quantity from public.inventory where id = v_item_s);
  end if;

  if exists (
    select 1 from public.inventory i
    where i.id in (v_item_s, v_item_j)
      and i.stock_quantity <> (select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id)
  ) then
    raise exception 'SUPPLIES CHECK FAILED: the ledger no longer matches the stock.';
  end if;

  -- The cash view counts purchases only: S's spending is still 1000 + 1400 + 900.
  if (select sum(total_cost) from public.inventory_movements
      where item_id = v_item_s and type = 'purchase') <> 3300.00 then
    raise exception 'SUPPLIES CHECK FAILED: supply spending of S changed after the uses.';
  end if;

  -- 2i. Record later ("Registrar insumos").
  --     Appointment 3 (service B has supplies configured) is counted as a
  --     consultation without recorded supplies.
  if (select unrecorded_consultations
      from public.get_procedure_profit(now() - interval '1 minute', now() + interval '1 minute')
      where service_id = v_svc_b) <> 1
     or (select unrecorded_consultations
         from public.get_procedure_profit(now() - interval '1 minute', now() + interval '1 minute')
         where service_id = v_svc_a) <> 0 then
    raise exception 'SUPPLIES CHECK FAILED: get_procedure_profit() does not count appointment 3 as the only consultation without recorded supplies.';
  end if;

  --     Not for a consultation that is not finalized (6 has only a draft).
  v_state := null;
  begin
    perform public.record_consultation_supplies(v_appt_6, '[]'::jsonb);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001'
     or exists (select 1 from public.clinical_notes where appointment_id = v_appt_6 and supplies_recorded_at is not null) then
    raise exception 'SUPPLIES CHECK FAILED: supplies were recorded for a consultation that is not finalized.';
  end if;

  --     Once for 3: stock goes down and the cost is the server average (660).
  v_n := public.record_consultation_supplies(v_appt_3,
    jsonb_build_array(jsonb_build_object('item_id', v_item_s, 'quantity', 1)));
  select * into v_mov from public.inventory_movements where appointment_id = v_appt_3;
  if v_n <> 1 or v_mov.type <> 'use' or v_mov.quantity <> -1
     or v_mov.unit_cost is distinct from 660.00 or v_mov.total_cost is distinct from 660.00
     or (select stock_quantity from public.inventory where id = v_item_s) <> 1
     or exists (select 1 from public.clinical_notes where appointment_id = v_appt_3 and supplies_recorded_at is null) then
    raise exception 'SUPPLIES CHECK FAILED: recording later gave % movement(s), % at % / %, and did not leave S at 1 with the consultation marked.',
      v_n, v_mov.quantity, v_mov.unit_cost, v_mov.total_cost;
  end if;

  --     A second call is refused and changes nothing.
  v_state := null;
  v_msg := null;
  begin
    perform public.record_consultation_supplies(v_appt_3,
      jsonb_build_array(jsonb_build_object('item_id', v_item_s, 'quantity', 1)));
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is distinct from 'P0001' or v_msg <> 'Los insumos de esta consulta ya estaban registrados.'
     or (select stock_quantity from public.inventory where id = v_item_s) <> 1 then
    raise exception 'SUPPLIES CHECK FAILED: a second "Registrar insumos" was not refused cleanly (% / %).', v_state, v_msg;
  end if;

  --     An EMPTY confirmed list marks the consultation too, and then it can
  --     no longer be recorded later.
  perform public.finalize_consultation_with_payment(v_appt_6, 'paid', 100, 'cash', null, '[]'::jsonb);
  if exists (select 1 from public.inventory_movements where appointment_id = v_appt_6)
     or exists (select 1 from public.clinical_notes where appointment_id = v_appt_6 and supplies_recorded_at is null) then
    raise exception 'SUPPLIES CHECK FAILED: finalizing with an empty supplies list did not mark appointment 6 (or recorded a movement).';
  end if;

  v_state := null;
  begin
    perform public.record_consultation_supplies(v_appt_6,
      jsonb_build_array(jsonb_build_object('item_id', v_item_j, 'quantity', 1)));
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0001' or (select stock_quantity from public.inventory where id = v_item_j) <> 8 then
    raise exception 'SUPPLIES CHECK FAILED: supplies were recorded later for a consultation confirmed with none.';
  end if;

  --     The marker cannot be changed directly, not even by the doctor.
  v_state := null;
  begin
    update public.clinical_notes set supplies_recorded_at = null where appointment_id = v_appt_3;
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'SUPPLIES CHECK FAILED: the doctor cleared supplies_recorded_at directly.';
  end if;

  if exists (
    select 1 from public.inventory i
    where i.id in (v_item_s, v_item_j)
      and i.stock_quantity <> (select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id)
  ) then
    raise exception 'SUPPLIES CHECK FAILED: the ledger no longer matches the stock after recording later.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin session: business data yes, clinical data no
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('supplies_check.user_a'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_svc_a  uuid := current_setting('supplies_check.svc_a')::uuid;
  v_svc_b  uuid := current_setting('supplies_check.svc_b')::uuid;
  v_item_s uuid := current_setting('supplies_check.item_s')::uuid;
  v_item_j uuid := current_setting('supplies_check.item_j')::uuid;
  v_appt_1 uuid := current_setting('supplies_check.appt_1')::uuid;
  v_count  integer;
  v_rows   integer;
  v_state  text;
begin
  if public.is_staff() or not public.is_business_staff() then
    raise exception 'SUPPLIES CHECK FAILED: the throwaway admin is not business-only staff.';
  end if;

  -- 3a. Reads and writes service_supplies.
  select count(*) into v_count from public.service_supplies where service_id in (v_svc_a, v_svc_b);
  if v_count <> 2 then
    raise exception 'SUPPLIES CHECK FAILED: the admin reads % supply lines, expected 2.', v_count;
  end if;

  insert into public.service_supplies (service_id, item_id, quantity) values (v_svc_b, v_item_s, 1);
  update public.service_supplies set quantity = 4 where service_id = v_svc_b and item_id = v_item_s;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'SUPPLIES CHECK FAILED: the admin could not change a supply quantity.';
  end if;
  delete from public.service_supplies where service_id = v_svc_b and item_id = v_item_s;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'SUPPLIES CHECK FAILED: the admin could not remove a supply.';
  end if;

  if public.set_service_supplies(v_svc_a, jsonb_build_array(
       jsonb_build_object('item_id', v_item_s, 'quantity', 2),
       jsonb_build_object('item_id', v_item_j, 'quantity', 1))) <> 2 then
    raise exception 'SUPPLIES CHECK FAILED: the admin could not save the supplies of a service.';
  end if;

  -- 3b. Still no clinical data: the movement's appointment resolves to nothing.
  select count(*) into v_count from public.inventory_movements where appointment_id = v_appt_1;
  if v_count <> 2 then
    raise exception 'SUPPLIES CHECK FAILED: the admin reads % movements of appointment 1, expected 2.', v_count;
  end if;

  select (select count(*) from public.appointments)
       + (select count(*) from public.patients)
       + (select count(*) from public.clinical_notes)
       + (select count(*) from public.inventory_movements m
          join public.appointments a on a.id = m.appointment_id)
    into v_count;
  if v_count <> 0 then
    raise exception 'SUPPLIES CHECK FAILED: the admin reads % clinical row(s).', v_count;
  end if;

  v_state := null;
  begin
    perform public.finalize_consultation_with_payment(v_appt_1, 'courtesy');
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'SUPPLIES CHECK FAILED: the admin can call finalize_consultation_with_payment().';
  end if;

  v_state := null;
  begin
    perform public.record_consultation_supplies(v_appt_1, '[]'::jsonb);
  exception when insufficient_privilege then v_state := 'refused';
  end;
  if v_state is null then
    raise exception 'SUPPLIES CHECK FAILED: the admin can call record_consultation_supplies().';
  end if;
end $$;

-- 3c. Profit per procedure, read by the admin (same session). Only the two
--     throwaway services are checked: real payments of the same minute may
--     exist.
--     A: #1 paid 1000 (S 600 + J with no cost), #2 courtesy of list 1000 (S 660),
--        #6 paid 100 (none)
--     B: #3 paid 500 (S 660, recorded later), #5 paid 300 (S 660)
do $$
declare
  v_svc_a uuid := current_setting('supplies_check.svc_a')::uuid;
  v_svc_b uuid := current_setting('supplies_check.svc_b')::uuid;
  v_r     record;
  v_found integer := 0;
  v_charged  numeric := 0;
  v_supplies numeric := 0;
begin
  for v_r in
    select * from public.get_procedure_profit(now() - interval '1 minute', now() + interval '1 minute')
    where service_id in (v_svc_a, v_svc_b)
  loop
    v_found := v_found + 1;
    v_charged := v_charged + v_r.charged;
    v_supplies := v_supplies + v_r.supplies_cost;

    if v_r.service_id = v_svc_a and (
         v_r.service_name <> 'SUPPLIES-CHECK service A' or v_r.times <> 3 or v_r.charged <> 1100.00
         or v_r.courtesy_value <> 1000.00 or v_r.supplies_cost <> 1260.00
         or v_r.uncosted_supplies <> 1 or v_r.profit <> -160.00 or v_r.unrecorded_consultations <> 0) then
      raise exception 'SUPPLIES CHECK FAILED: service A row is % (expected 3 times, 1100 charged, 1000 courtesy, 1260 supplies, 1 uncosted, -160 profit, 0 unrecorded).', row_to_json(v_r);
    end if;

    if v_r.service_id = v_svc_b and (
         v_r.times <> 2 or v_r.charged <> 800.00 or v_r.courtesy_value <> 0
         or v_r.supplies_cost <> 1320.00 or v_r.uncosted_supplies <> 0 or v_r.profit <> -520.00
         or v_r.unrecorded_consultations <> 0) then
      raise exception 'SUPPLIES CHECK FAILED: service B row is % (expected 2 times, 800 charged, 0 courtesy, 1320 supplies, 0 uncosted, -520 profit, 0 unrecorded).', row_to_json(v_r);
    end if;
  end loop;

  if v_found <> 2 then
    raise exception 'SUPPLIES CHECK FAILED: get_procedure_profit() returned % rows for the test services, expected 2.', v_found;
  end if;

  -- The rows add up to the payments and the cost of the uses themselves
  -- (the admin reads both tables, as Finanzas does).
  if v_charged <> (select sum(p.amount_charged) from public.payments p
                   where p.service_id in (v_svc_a, v_svc_b))
     or v_supplies <> (select sum(coalesce(m.total_cost, 0)) from public.inventory_movements m
                       join public.payments p on p.appointment_id = m.appointment_id
                       where p.service_id in (v_svc_a, v_svc_b) and m.type = 'use') then
    raise exception 'SUPPLIES CHECK FAILED: the per-procedure totals (% charged, % supplies) do not add up to the payments and uses.',
      v_charged, v_supplies;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. anon: nothing
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end $$;
set local role anon;

do $$
declare
  v_count integer;
  v_rpc   record;
  v_state text;
begin
  begin
    select count(*) into v_count from public.service_supplies;
  exception when insufficient_privilege then v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'SUPPLIES CHECK FAILED: anon reads % service_supplies rows.', v_count;
  end if;

  for v_rpc in
    select * from (values
      ('get_procedure_profit', 'select public.get_procedure_profit(now() - interval ''1 day'', now())'),
      ('set_service_supplies', format('select public.set_service_supplies(%L::uuid, ''[]''::jsonb)',
                                      current_setting('supplies_check.svc_a'))),
      ('finalize_consultation_with_payment', format('select public.finalize_consultation_with_payment(%L::uuid, %L)',
                                                    current_setting('supplies_check.appt_4'), 'courtesy')),
      ('record_consultation_supplies', format('select public.record_consultation_supplies(%L::uuid, ''[]''::jsonb)',
                                              current_setting('supplies_check.appt_3')))
    ) as t(label, stmt)
  loop
    v_state := null;
    begin
      execute v_rpc.stmt;
    exception
      when insufficient_privilege then v_state := 'refused';
      when others then v_state := null;
    end;
    if v_state is null then
      raise exception 'SUPPLIES CHECK FAILED: anon can execute %().', v_rpc.label;
    end if;
  end loop;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 5. Table rules and audit (owner, no request context)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_svc_a  uuid := current_setting('supplies_check.svc_a')::uuid;
  v_item_s uuid := current_setting('supplies_check.item_s')::uuid;
  v_user_d uuid := current_setting('supplies_check.user_d')::uuid;
  v_user_a uuid := current_setting('supplies_check.user_a')::uuid;
  v_state  text;
  v_doctor integer;
  v_admin  integer;
begin
  v_state := null;
  begin
    insert into public.service_supplies (service_id, item_id, quantity) values (v_svc_a, v_item_s, 0);
  exception when check_violation then v_state := 'rejected';
  end;
  if v_state is null then
    raise exception 'SUPPLIES CHECK FAILED: service_supplies accepted a quantity of 0.';
  end if;

  v_state := null;
  begin
    insert into public.service_supplies (service_id, item_id, quantity) values (v_svc_a, v_item_s, 1);
  exception when unique_violation then v_state := 'rejected';
  end;
  if v_state is null then
    raise exception 'SUPPLIES CHECK FAILED: the same item was linked twice to one service.';
  end if;

  -- Doctor: 2 inserts, 1 update, 1 delete (A) + 1 insert (B).
  -- Admin: insert, update, delete (B) + 1 update and 1 insert (A).
  select count(*) filter (where actor_id = v_user_d and actor_role = 'doctor'),
         count(*) filter (where actor_id = v_user_a and actor_role = 'admin')
    into v_doctor, v_admin
  from public.audit_log
  where table_name = 'service_supplies'
    and actor_id in (v_user_d, v_user_a);
  if v_doctor <> 5 or v_admin <> 5 then
    raise exception 'SUPPLIES CHECK FAILED: service_supplies audit has % doctor and % admin entries, expected 5 and 5.',
      v_doctor, v_admin;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'SUPPLIES CHECK PASSED: service supplies are saved and audited; finalizing with supplies decrements the stock, snapshots a server-side cost and marks the consultation (also for an empty list); not enough stock rolls back the note, the payment and every movement; a client cannot inject a cost; "Registrar insumos" works once for a finalized consultation and refuses a draft or a second call; the marker cannot be changed directly; the admin manages supplies and reads the per-procedure profit but no clinical data; the profit per procedure and its unrecorded consultations add up. All test data was rolled back.';
end $$;

rollback;
